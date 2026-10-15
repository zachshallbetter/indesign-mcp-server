/**
 * Run ExtendScript in a desktop Adobe application.
 *
 * The script is written to a temporary .jsx file and run by the application:
 * through AppleScript (osascript) on macOS, or a COM object driven from
 * PowerShell on Windows. Each application supplies how it is told to run a
 * script file, because they differ: InDesign takes `do script ... language
 * javascript` and DoScript(file, language); Illustrator takes `do javascript`
 * and DoJavaScriptFile(file), and its AppleScript `do script` plays an Action.
 *
 * Processes are started with execFile (no shell), so script paths and
 * AppleScript source never pass through shell quoting, and a slow script does
 * not block the server's event loop.
 *
 * Further backends (InDesign's UXP bridge, for one) plug in through `backends`.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapScriptForStructuredResult, parseStructuredResult } from './structured.js';

const IS_WINDOWS = process.platform === 'win32';

/** Run a process; resolves with trimmed stdout, rejects with an Error carrying stderr. */
export function runProcess(file, args, { timeoutMs }) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                error.timedOut = Boolean(error.killed && timeoutMs);
                reject(error);
                return;
            }
            resolve(String(stdout).trim());
        });
    });
}

/** A string as an AppleScript string literal. */
export function appleScriptString(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A string as a PowerShell single-quoted literal. */
export function powerShellString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {object} app
 * @param {string} app.label            "Illustrator", used in messages
 * @param {string} app.envPrefix        "ILLUSTRATOR": reads <PREFIX>_APP_NAME, <PREFIX>_SCRIPT_TIMEOUT_MS, <PREFIX>_BACKEND
 * @param {string} app.appNamePrefix    "Adobe Illustrator": process and bundle names start with this
 * @param {string} app.defaultAppName   used when nothing is running or installed
 * @param {(o: { appName: string, scriptPath: string }) => string} app.macScript
 *        AppleScript statement(s) that run the .jsx at scriptPath inside `tell application appName`
 * @param {string[]} app.winProgIds     COM ProgIDs, newest first
 * @param {(o: { scriptPath: string }) => string} app.winInvoke
 *        PowerShell expression run against $app that runs the .jsx and yields its result
 * @param {string} [app.macBundleId]    e.g. "com.adobe.illustrator": address the app by bundle id
 *        (`tell application id ...`) unless <PREFIX>_APP_NAME names a specific copy
 * @param {string} [app.winProcessName] image name for tasklist, e.g. "Illustrator.exe"
 * @param {(o: { scriptPath: string, run: typeof runProcess, timeoutMs: number }) => Promise<string>} [app.winRun]
 *        Windows: run the .jsx at scriptPath another way and resolve with its result, for an
 *        application without a COM scripting object (After Effects runs scripts with AfterFX.exe -r)
 * @param {boolean} [app.activate=true] bring the application to the front first (menu commands need it)
 * @param {number} [app.timeoutMs=120000]
 * @param {Array<{ name: string, isAvailable: () => Promise<boolean>, run: (script: string) => Promise<string>, isUnavailableError?: (e: Error) => boolean }>} [app.backends]
 * @param {typeof runProcess} [app.run] process runner (tests replace it)
 */
export function createExecutor(app) {
    const {
        label, envPrefix, appNamePrefix, defaultAppName,
        macScript, macBundleId, winProgIds = [], winInvoke, winProcessName, winRun,
        activate = true, backends = [],
    } = app;
    const run = app.run ?? runProcess;
    const tempPrefix = `${envPrefix.toLowerCase()}_mcp_`;
    const env = (name) => process.env[`${envPrefix}_${name}`];

    let appName = null;
    let resolved = null;
    let resolvedAt = 0;

    const timeoutMs = () => {
        const n = Number(env('SCRIPT_TIMEOUT_MS'));
        return Number.isFinite(n) && n > 0 ? n : app.timeoutMs ?? 120000;
    };

    function failure(error, transport) {
        if (error.timedOut) {
            return new Error(
                `${label} did not answer within ${Math.round(timeoutMs() / 1000)}s. ` +
                `A dialog may be open in ${label}: dismiss it and try again, or raise ${envPrefix}_SCRIPT_TIMEOUT_MS.`
            );
        }
        const detail = String(error.stderr || error.message || error).trim();
        return new Error(`${transport} execution failed: ${detail}`);
    }

    /**
     * The application name AppleScript addresses (macOS). Priority:
     *   1. <PREFIX>_APP_NAME
     *   2. a running process whose name starts with appNamePrefix
     *   3. the newest matching .app in /Applications or ~/Applications
     *   4. defaultAppName
     */
    async function resolveAppName() {
        if (appName) return appName;
        if (env('APP_NAME')) return (appName = env('APP_NAME'));
        if (IS_WINDOWS) return (appName = appNamePrefix);

        try {
            const running = await run('osascript', ['-e',
                `tell application "System Events" to get name of (processes whose name starts with ${appleScriptString(appNamePrefix)})`,
            ], { timeoutMs: 10000 });
            if (running) return (appName = running.split(',')[0].trim());
        } catch {
            // nothing running
        }

        const candidates = [];
        for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
            let entries;
            try {
                entries = fs.readdirSync(base);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.startsWith(appNamePrefix)) continue;
                if (entry.endsWith('.app')) {
                    candidates.push({ name: entry.slice(0, -4), year: entry });
                    continue;
                }
                try {
                    for (const inner of fs.readdirSync(path.join(base, entry))) {
                        if (inner.startsWith(appNamePrefix) && inner.endsWith('.app')) {
                            candidates.push({ name: inner.slice(0, -4), year: entry });
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }
        if (candidates.length) {
            const ver = (s) => parseInt((s.match(/\d{4}/) || ['0'])[0], 10);
            candidates.sort((a, b) => ver(b.year) - ver(a.year));
            return (appName = candidates[0].name);
        }
        return (appName = defaultAppName);
    }

    /** Whether the application is running, without starting it. */
    async function isRunning() {
        try {
            if (IS_WINDOWS) {
                if (!winProcessName) return null;
                const out = await run('tasklist', ['/FI', `IMAGENAME eq ${winProcessName}`, '/NH'], { timeoutMs: 10000 });
                return out.toLowerCase().includes(winProcessName.toLowerCase());
            }
            const out = await run('osascript', ['-e',
                `tell application "System Events" to (name of processes whose name starts with ${appleScriptString(appNamePrefix)}) is not {}`,
            ], { timeoutMs: 5000 });
            return out === 'true';
        } catch {
            return false;
        }
    }

    function writeTemp(script) {
        const file = path.join(os.tmpdir(), `${tempPrefix}${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}.jsx`);
        fs.writeFileSync(file, script, 'utf8');
        return file;
    }

    /** Run a script through AppleScript or COM. Returns the script's result as a string. */
    async function runExtendScript(script) {
        const scriptPath = writeTemp(script);
        try {
            if (IS_WINDOWS && winRun) {
                try {
                    return await winRun({ scriptPath, run, timeoutMs: timeoutMs() });
                } catch (error) {
                    throw failure(error, label);
                }
            }
            if (IS_WINDOWS) {
                const ps = [
                    `$progIds = @(${winProgIds.map(powerShellString).join(',')})`,
                    '$app = $null',
                    'foreach ($id in $progIds) { try { $app = New-Object -ComObject $id; break } catch {} }',
                    `if ($null -eq $app) { Write-Error ${powerShellString(`Adobe ${label} not found. Check the installation.`)}; exit 1 }`,
                    'try {',
                    `  $result = ${winInvoke({ scriptPath })}`,
                    '  if ($null -ne $result) { Write-Output $result }',
                    '} catch { Write-Error $_.Exception.Message; exit 1 }',
                ].join('; ');
                try {
                    return await run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeoutMs: timeoutMs() });
                } catch (error) {
                    throw failure(error, 'COM');
                }
            }

            const byId = macBundleId && !env('APP_NAME');
            const name = byId ? macBundleId : await resolveAppName();
            const seconds = Math.ceil(timeoutMs() / 1000);
            const source = [
                `with timeout of ${seconds} seconds`,
                `  tell application ${byId ? `id ${appleScriptString(macBundleId)}` : appleScriptString(name)}`,
                ...(activate ? ['    activate'] : []),
                `    ${macScript({ appName: name, scriptPath: scriptPath.replace(/\\/g, '/') })}`,
                '  end tell',
                'end timeout',
            ].join('\n');
            try {
                return await run('osascript', ['-e', source], { timeoutMs: timeoutMs() + 5000 });
            } catch (error) {
                throw failure(error, 'AppleScript');
            }
        } finally {
            try {
                fs.unlinkSync(scriptPath);
            } catch {
                // ignore
            }
        }
    }

    /** Configured backend: "extendscript", "auto", or the name of one of `backends`. */
    function configuredBackend() {
        const raw = String(env('BACKEND') || 'extendscript').toLowerCase().trim();
        return raw === 'auto' || raw === 'extendscript' || backends.some((b) => b.name === raw) ? raw : 'extendscript';
    }

    async function resolveBackend({ forceRefresh = false } = {}) {
        const mode = configuredBackend();
        const stale = mode === 'auto' && Date.now() - resolvedAt >= 5000;
        if (!forceRefresh && resolved && !stale) return resolved;
        if (mode !== 'auto') {
            resolved = mode;
        } else {
            resolved = 'extendscript';
            for (const b of backends) {
                if (await b.isAvailable().catch(() => false)) {
                    resolved = b.name;
                    break;
                }
            }
        }
        resolvedAt = Date.now();
        return resolved;
    }

    /**
     * Run a script on the resolved backend. In auto mode a backend that could
     * not have run the script (isUnavailableError) falls back to ExtendScript.
     * @returns {Promise<string>}
     */
    async function runScript(script) {
        const backendName = await resolveBackend();
        const backend = backends.find((b) => b.name === backendName);
        if (backend) {
            try {
                return await backend.run(script);
            } catch (error) {
                if (configuredBackend() !== 'auto' || !backend.isUnavailableError?.(error)) throw error;
                resolved = 'extendscript';
                resolvedAt = Date.now();
            }
        }
        return await runExtendScript(script);
    }

    /** Run a script wrapped for a structured result: { ok, result | error, raw }. */
    async function runStructured(script) {
        const raw = await executor.runScript(wrapScriptForStructuredResult(script));
        return parseStructuredResult(raw, { appLabel: label });
    }

    /** Remove temporary scripts left behind by a crash. */
    function cleanupTempScripts() {
        let removed = 0;
        try {
            for (const name of fs.readdirSync(os.tmpdir())) {
                if (!name.startsWith(tempPrefix) || !name.endsWith('.jsx')) continue;
                try {
                    fs.unlinkSync(path.join(os.tmpdir(), name));
                    removed++;
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }
        return removed;
    }

    /** Environment and backend status, without contacting the application. */
    async function status() {
        return {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            appName: IS_WINDOWS ? `Adobe ${label} (COM)` : await resolveAppName(),
            appNameSource: env('APP_NAME') ? 'env' : IS_WINDOWS ? 'windows-com' : 'resolved',
            running: await isRunning(),
            backend: { configured: configuredBackend(), resolved: await resolveBackend({ forceRefresh: true }) },
            timeoutMs: timeoutMs(),
            tempDir: os.tmpdir(),
        };
    }

    const executor = {
        label,
        envPrefix,
        resolveAppName,
        resetAppNameCache: () => { appName = null; },
        resetBackendCache: () => { resolved = null; resolvedAt = 0; },
        isRunning,
        runExtendScript,
        resolveBackend,
        runScript,
        runStructured,
        cleanupTempScripts,
        status,
    };
    return executor;
}
