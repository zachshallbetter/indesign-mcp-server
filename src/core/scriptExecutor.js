/**
 * Core script execution for Adobe InDesign.
 *
 * Backends (INDESIGN_BACKEND):
 *   - extendscript (default): macOS AppleScript or Windows COM
 *   - uxp: HTTP bridge + UXP plugin (see uxp/)
 *   - auto: use UXP when plugin connected, else ExtendScript
 *
 * executeInDesignScript(script) returns a plain string (legacy).
 * executeInDesignScriptStructured(script) wraps the script and returns
 * { ok, result|error, raw }.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const IS_WINDOWS = process.platform === 'win32';

const INDESIGN_PROGIDS = [
    'InDesign.Application.2026',
    'InDesign.Application.2025',
    'InDesign.Application.2024',
    'InDesign.Application.2023',
    'InDesign.Application',
];

// ScriptLanguage.javascript = 1246973031
const JS_LANG_ID = 1246973031;

const TEMP_PREFIX = 'indesign_mcp_';

/** @typedef {'extendscript' | 'uxp' | 'auto'} BackendMode */

function readBackendMode() {
    const raw = String(process.env.INDESIGN_BACKEND || 'extendscript').toLowerCase().trim();
    if (raw === 'uxp' || raw === 'extendscript' || raw === 'auto') return raw;
    return 'extendscript';
}

function uxpBridgeUrl() {
    return (process.env.UXP_BRIDGE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

function uxpBridgeHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = process.env.BRIDGE_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}


/**
 * Last code character of a line — strings and comments skipped.
 * Returns '' for lines without code.
 */
function lastCodeChar(line) {
    let last = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '/' && line[i + 1] === '/') break;
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < line.length) {
                if (line[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (line[i] === quote) break;
                i++;
            }
            last = quote;
            continue;
        }
        if (!/\s/.test(ch)) last = ch;
    }
    return last;
}

const NON_EXPRESSION =
    /^(var|let|const|if|for|while|do|switch|function|try|return|throw|break|continue|with)\b/;

/**
 * Assign a script's trailing expression to __result__.
 * Scripts that already set __result__ are left alone.
 */
export function autoCaptureResult(script) {
    if (/\b__result__\b/.test(script)) return script;

    const lines = script.split('\n');

    let end = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t && !t.startsWith('//') && !t.startsWith('}')) {
            end = i;
            break;
        }
    }
    if (end < 0) return script;

    let start = end;
    for (;;) {
        let prev = -1;
        for (let i = start - 1; i >= 0; i--) {
            if (lines[i].trim()) {
                prev = i;
                break;
            }
        }
        if (prev < 0) break;
        const ch = lastCodeChar(lines[prev]);
        if (ch === '' || ch === ';' || ch === '{' || ch === '}') break;
        start = prev;
    }

    const head = lines[start].trim();
    if (NON_EXPRESSION.test(head) || /^[)\]}]/.test(head)) return script;

    lines[start] = lines[start].replace(/^(\s*)/, '$1var __result__ = ');
    return lines.join('\n');
}

/**
 * Wrap a handler script so ExtendScript always yields a JSON string:
 * {"ok":true,"result":...} or {"ok":false,"error":"..."}.
 */
export function wrapScriptForStructuredResult(script) {
    const captured = autoCaptureResult(script);
    return [
        'var __result__;',
        'try {',
        captured,
        '  if (typeof __result__ === "undefined") { __result__ = ""; }',
        '  function __mcpEscape(s) {',
        '    s = String(s);',
        '    var out = "";',
        '    for (var i = 0; i < s.length; i++) {',
        '      var c = s.charAt(i);',
        '      var code = s.charCodeAt(i);',
        '      if (c === "\\\\") out += "\\\\\\\\";',
        '      else if (c === "\\"") out += "\\\\\\"";',
        '      else if (c === "\\n") out += "\\\\n";',
        '      else if (c === "\\r") out += "\\\\r";',
        '      else if (c === "\\t") out += "\\\\t";',
        '      else if (code < 32) out += "\\\\u" + ("0000" + code.toString(16)).slice(-4);',
        '      else out += c;',
        '    }',
        '    return out;',
        '  }',
        '  var __payload = "{\\"ok\\":true,\\"result\\":\\"" + __mcpEscape(__result__) + "\\"}";',
        '  __payload;',
        '} catch (__mcpErr) {',
        '  var __msg = (__mcpErr && __mcpErr.message) ? __mcpErr.message : String(__mcpErr);',
        '  function __mcpEscapeErr(s) {',
        '    s = String(s);',
        '    var out = "";',
        '    for (var i = 0; i < s.length; i++) {',
        '      var c = s.charAt(i);',
        '      if (c === "\\\\") out += "\\\\\\\\";',
        '      else if (c === "\\"") out += "\\\\\\"";',
        '      else if (c === "\\n") out += "\\\\n";',
        '      else if (c === "\\r") out += "\\\\r";',
        '      else out += c;',
        '    }',
        '    return out;',
        '  }',
        '  "{\\"ok\\":false,\\"error\\":\\"" + __mcpEscapeErr(__msg) + "\\"}";',
        '}',
    ].join('\n');
}

export function parseStructuredResult(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) {
        return { ok: false, error: 'Empty response from InDesign', raw: text };
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
            return {
                ok: Boolean(parsed.ok),
                result: parsed.result,
                error: parsed.error,
                raw: text,
            };
        }
        return { ok: true, result: parsed, raw: text };
    } catch {
        const isError =
            /^ERROR:/i.test(text) ||
            /^Error /i.test(text) ||
            (/failed/i.test(text) && /error/i.test(text));
        if (isError) {
            return { ok: false, error: text, raw: text };
        }
        return { ok: true, result: text, raw: text };
    }
}

export class ScriptExecutor {
    static _appName = null;
    /** @type {string|null} cached resolved backend for this process */
    static _resolvedBackend = null;

    /**
     * Resolve the installed / running InDesign application name (macOS).
     * Priority:
     *   1. INDESIGN_APP_NAME env override
     *   2. An InDesign process that is already running
     *   3. Newest "Adobe InDesign <year>.app" on disk
     *   4. Fallback default
     */
    static resolveAppName() {
        if (this._appName) return this._appName;

        if (process.env.INDESIGN_APP_NAME) {
            this._appName = process.env.INDESIGN_APP_NAME;
            return this._appName;
        }

        if (IS_WINDOWS) {
            this._appName = 'Adobe InDesign';
            return this._appName;
        }

        try {
            const running = execSync(
                `osascript -e 'tell application "System Events" to get name of (processes whose name starts with "Adobe InDesign")'`,
                { encoding: 'utf8', timeout: 10000 }
            ).trim();
            if (running) {
                this._appName = running.split(',')[0].trim();
                return this._appName;
            }
        } catch {
            // nothing running
        }

        const candidates = [];
        const bases = ['/Applications', path.join(os.homedir(), 'Applications')];
        for (const base of bases) {
            let entries;
            try {
                entries = fs.readdirSync(base);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!/^Adobe InDesign/.test(entry)) continue;
                if (/\.app$/.test(entry)) {
                    candidates.push(entry.replace(/\.app$/, ''));
                    continue;
                }
                try {
                    for (const inner of fs.readdirSync(path.join(base, entry))) {
                        if (/^Adobe InDesign.*\.app$/.test(inner)) {
                            candidates.push(inner.replace(/\.app$/, ''));
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }

        if (candidates.length) {
            const ver = (n) => parseInt((n.match(/\d+/) || ['0'])[0], 10) || 0;
            candidates.sort((a, b) => ver(b) - ver(a));
            this._appName = candidates[0];
            return this._appName;
        }

        this._appName = 'Adobe InDesign 2025';
        return this._appName;
    }

    /** Clear cached app name (tests / env changes). */
    static resetAppNameCache() {
        this._appName = null;
    }


    /** Clear cached backend resolution (tests / env changes). */
    static resetBackendCache() {
        this._resolvedBackend = null;
    }

    /**
     * Configured backend mode from env (extendscript | uxp | auto).
     * @returns {BackendMode}
     */
    static getConfiguredBackend() {
        return readBackendMode();
    }

    /**
     * Whether the UXP bridge reports the plugin as connected.
     * @returns {Promise<boolean>}
     */
    static async isUXPAvailable() {
        try {
            const response = await fetch(`${uxpBridgeUrl()}/status`, {
                headers: uxpBridgeHeaders(),
                signal: AbortSignal.timeout(1500),
            });
            if (!response.ok) return false;
            const data = await response.json();
            return data.connected === true;
        } catch {
            return false;
        }
    }

    /**
     * Resolve effective backend for this process.
     * @param {{ forceRefresh?: boolean }} [opts]
     * @returns {Promise<'extendscript'|'uxp'>}
     */
    static async resolveBackend(opts = {}) {
        if (!opts.forceRefresh && this._resolvedBackend) {
            return this._resolvedBackend;
        }
        const mode = readBackendMode();
        if (mode === 'extendscript') {
            this._resolvedBackend = 'extendscript';
            return this._resolvedBackend;
        }
        if (mode === 'uxp') {
            this._resolvedBackend = 'uxp';
            return this._resolvedBackend;
        }
        // auto
        const available = await this.isUXPAvailable();
        this._resolvedBackend = available ? 'uxp' : 'extendscript';
        return this._resolvedBackend;
    }

    /**
     * Execute JS inside InDesign via the UXP HTTP bridge.
     * @param {string} code
     * @returns {Promise<any>}
     */
    static async executeViaUXP(code) {
        let response;
        try {
            response = await fetch(`${uxpBridgeUrl()}/execute`, {
                method: 'POST',
                headers: uxpBridgeHeaders(),
                body: JSON.stringify({ code }),
                signal: AbortSignal.timeout(35000),
            });
        } catch (err) {
            if (err.name === 'TimeoutError' || err.name === 'TypeError' || err.code === 'ECONNREFUSED') {
                throw new Error(
                    'UXP bridge not reachable. Start it with: npm run uxp:bridge (and load uxp/plugin in InDesign)'
                );
            }
            throw err;
        }

        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error(`UXP bridge returned non-JSON (HTTP ${response.status})`);
        }

        if (!response.ok) {
            throw new Error(data.error || `UXP bridge error: ${response.status}`);
        }

        return data.result;
    }


    /**
     * Host/environment status without requiring a full tool call surface.
     * probeInDesign=true attempts a lightweight ExtendScript round-trip.
     */
    static async getStatus({ probeInDesign = false } = {}) {
        const configuredBackend = readBackendMode();
        const resolvedBackend = await this.resolveBackend({ forceRefresh: true });
        const uxpConnected = configuredBackend === 'extendscript'
            ? false
            : await this.isUXPAvailable();

        const status = {
            ok: true,
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            isWindows: IS_WINDOWS,
            isMac: process.platform === 'darwin',
            backend: {
                configured: configuredBackend,
                resolved: resolvedBackend,
                uxpBridgeUrl: uxpBridgeUrl(),
                uxpConnected,
            },
            appName: null,
            appNameSource: null,
            envOverride: process.env.INDESIGN_APP_NAME || null,
            allowedDirs: process.env.INDESIGN_ALLOWED_DIRS || null,
            tempDir: os.tmpdir(),
            indesign: {
                reachable: false,
                running: false,
                version: null,
                documentCount: null,
                activeDocument: null,
                error: null,
            },
        };

        if (process.env.INDESIGN_APP_NAME) {
            status.appName = process.env.INDESIGN_APP_NAME;
            status.appNameSource = 'env';
        } else if (IS_WINDOWS) {
            status.appName = 'Adobe InDesign (COM)';
            status.appNameSource = 'windows-com';
        } else {
            status.appName = this.resolveAppName();
            status.appNameSource = 'resolved';
        }

        if (!IS_WINDOWS) {
            try {
                const running = execSync(
                    `osascript -e 'tell application "System Events" to (name of processes whose name starts with "Adobe InDesign") is not {}'`,
                    { encoding: 'utf8', timeout: 5000 }
                ).trim();
                status.indesign.running = running === 'true';
            } catch {
                status.indesign.running = false;
            }
        }

        if (probeInDesign) {
            try {
                const script = [
                    'var __info = {};',
                    'try { __info.version = String(app.version); } catch (e) { __info.version = null; }',
                    'try { __info.documentCount = app.documents.length; } catch (e) { __info.documentCount = 0; }',
                    'try {',
                    '  if (app.documents.length > 0) {',
                    '    var d = app.activeDocument;',
                    '    __info.activeDocument = d ? String(d.name) : null;',
                    '  } else {',
                    '    __info.activeDocument = null;',
                    '  }',
                    '} catch (e) { __info.activeDocument = null; }',
                    '"VERSION=" + __info.version + ";DOCS=" + __info.documentCount + ";ACTIVE=" + __info.activeDocument;',
                ].join('\n');
                const raw = await this.executeInDesignScript(script);
                status.indesign.reachable = true;
                status.indesign.running = true;
                const versionMatch = String(raw).match(/VERSION=([^;]*)/);
                const docsMatch = String(raw).match(/DOCS=([^;]*)/);
                const activeMatch = String(raw).match(/ACTIVE=(.*)$/);
                status.indesign.version = versionMatch ? versionMatch[1] : null;
                status.indesign.documentCount = docsMatch ? Number(docsMatch[1]) : null;
                status.indesign.activeDocument =
                    activeMatch && activeMatch[1] !== 'null' ? activeMatch[1] : null;
            } catch (error) {
                status.ok = false;
                status.indesign.reachable = false;
                status.indesign.error = error.message;
            }
        }

        return status;
    }

    /** Remove leftover temp scripts from prior crashes. */
    static cleanupTempScripts() {
        const dir = os.tmpdir();
        let removed = 0;
        try {
            for (const name of fs.readdirSync(dir)) {
                if (!name.startsWith(TEMP_PREFIX)) continue;
                if (!name.endsWith('.jsx') && !name.endsWith('.txt')) continue;
                try {
                    fs.unlinkSync(path.join(dir, name));
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

    static async executeAppleScript(script) {
        if (IS_WINDOWS) {
            throw new Error('AppleScript is unavailable on Windows');
        }
        try {
            const escaped = script.replace(/'/g, "'\"'\"'");
            const result = execSync(`osascript -e '${escaped}'`, {
                encoding: 'utf8',
                timeout: 120000,
            });
            return result.trim();
        } catch (error) {
            throw new Error(`AppleScript execution failed: ${error.message}`);
        }
    }

    static async executeWindowsCOM(script) {
        const tempScriptPath = path.join(
            os.tmpdir(),
            `${TEMP_PREFIX}${Date.now()}_${process.pid}.jsx`
        );
        fs.writeFileSync(tempScriptPath, script, 'utf8');

        const escapedPath = tempScriptPath.replace(/'/g, "''");
        const progIdList = INDESIGN_PROGIDS.map((id) => `'${id}'`).join(',');

        const psScript = [
            `$progIds = @(${progIdList})`,
            '$app = $null',
            'foreach ($id in $progIds) {',
            '  try { $app = New-Object -ComObject $id; break } catch {}',
            '}',
            'if ($null -eq $app) { Write-Error "Adobe InDesign not found. Check installation."; exit 1 }',
            'try {',
            `  $result = $app.DoScript('${escapedPath}', ${JS_LANG_ID})`,
            '  if ($null -ne $result) { Write-Output $result }',
            '} catch {',
            '  Write-Error $_.Exception.Message',
            '  exit 1',
            '}',
        ].join('; ');

        try {
            const result = execSync(
                `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${JSON.stringify(psScript)}`,
                { encoding: 'utf8', timeout: 120000 }
            );
            return result.trim();
        } catch (error) {
            const detail = error.stderr || error.message;
            throw new Error(`COM execution failed: ${detail}`);
        } finally {
            try {
                fs.unlinkSync(tempScriptPath);
            } catch {
                // ignore
            }
        }
    }

    /**
     * Execute an ExtendScript against InDesign (legacy string return).
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeInDesignScript(script) {
        try {
            const backend = await this.resolveBackend();
            if (backend === 'uxp') {
                const result = await this.executeViaUXP(script);
                if (result == null) return '';
                if (typeof result === 'string') return result;
                try {
                    return JSON.stringify(result);
                } catch {
                    return String(result);
                }
            }

            if (IS_WINDOWS) {
                return await this.executeWindowsCOM(script);
            }

            const tempScriptPath = path.join(
                os.tmpdir(),
                `${TEMP_PREFIX}${Date.now()}_${process.pid}.jsx`
            );
            fs.writeFileSync(tempScriptPath, script, 'utf8');

            try {
                const appName = this.resolveAppName();
                const posixPath = tempScriptPath.replace(/\\/g, '/');
                const appleScript = `
        tell application "${appName}"
          activate
          do script POSIX file "${posixPath}" language javascript
        end tell
      `;
                return await this.executeAppleScript(appleScript);
            } finally {
                try {
                    fs.unlinkSync(tempScriptPath);
                } catch {
                    // ignore
                }
            }
        } catch (error) {
            throw new Error(`Error executing tool: ${error.message}`);
        }
    }


    static async executeInDesignScriptStructured(script) {
        const wrapped = wrapScriptForStructuredResult(script);
        const raw = await this.executeInDesignScript(wrapped);
        return parseStructuredResult(raw);
    }
}
