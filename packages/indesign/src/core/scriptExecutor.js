/**
 * Core script execution for Adobe InDesign.
 *
 * Backends (INDESIGN_BACKEND):
 *   - extendscript (default): macOS AppleScript or Windows COM
 *   - uxp: HTTP bridge + UXP plugin (see uxp/)
 *   - auto: use UXP when plugin connected, else ExtendScript
 *
 * The ExtendScript transport (temporary .jsx file, AppleScript `do script` or
 * COM DoScript, application detection, timeouts) is adobe-mcp-core's executor,
 * shared with the other servers. Backend selection and the UXP bridge are
 * InDesign's own and stay here.
 *
 * executeInDesignScript(script) returns a plain string (legacy).
 * executeInDesignScriptStructured(script) wraps the script and returns
 * { ok, result|error, raw }.
 */
import os from 'os';
import {
    createExecutor,
    appleScriptString,
    powerShellString,
    autoCaptureResult,
    wrapScriptForStructuredResult,
    parseStructuredResult as coreParseStructuredResult,
} from 'adobe-mcp-core';

const IS_WINDOWS = process.platform === 'win32';

// ScriptLanguage.javascript = 1246973031
const JS_LANG_ID = 1246973031;

/** The ExtendScript transport: AppleScript on macOS, COM through PowerShell on Windows. */
const transport = createExecutor({
    label: 'InDesign',
    envPrefix: 'INDESIGN',
    appNamePrefix: 'Adobe InDesign',
    defaultAppName: 'Adobe InDesign 2025',
    macScript: ({ scriptPath }) => `do script POSIX file ${appleScriptString(scriptPath)} language javascript`,
    winProgIds: [
        'InDesign.Application.2026',
        'InDesign.Application.2025',
        'InDesign.Application.2024',
        'InDesign.Application.2023',
        'InDesign.Application',
    ],
    winInvoke: ({ scriptPath }) => `$app.DoScript(${powerShellString(scriptPath)}, ${JS_LANG_ID})`,
    winProcessName: 'InDesign.exe',
});

export { autoCaptureResult, wrapScriptForStructuredResult };

/** Parse a wrapped script's output: { ok, result | error, raw }. */
export function parseStructuredResult(raw) {
    return coreParseStructuredResult(raw, { appLabel: 'InDesign' });
}

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

export class ScriptExecutor {
    /** @type {string|null} cached resolved backend for this process */
    static _resolvedBackend = null;
    /** @type {number} when _resolvedBackend was set (ms since epoch) */
    static _resolvedAt = 0;
    /** In auto mode, re-check the bridge when the cached choice is older than this. */
    static autoRecheckMs = 5000;

    /**
     * Resolve the installed / running InDesign application name (macOS).
     * Priority:
     *   1. INDESIGN_APP_NAME env override
     *   2. An InDesign process that is already running
     *   3. Newest "Adobe InDesign <year>.app" on disk
     *   4. Fallback default
     * @returns {Promise<string>}
     */
    static resolveAppName() {
        return transport.resolveAppName();
    }

    /** Clear cached app name (tests / env changes). */
    static resetAppNameCache() {
        transport.resetAppNameCache();
    }

    /** Clear cached backend resolution (tests / env changes). */
    static resetBackendCache() {
        this._resolvedBackend = null;
        this._resolvedAt = 0;
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
        const mode = readBackendMode();
        const stale = mode === 'auto' && Date.now() - this._resolvedAt >= this.autoRecheckMs;
        if (!opts.forceRefresh && this._resolvedBackend && !stale) {
            return this._resolvedBackend;
        }
        if (mode === 'extendscript') {
            this._resolvedBackend = 'extendscript';
        } else if (mode === 'uxp') {
            this._resolvedBackend = 'uxp';
        } else {
            // auto: re-checked every autoRecheckMs, so starting or stopping the
            // bridge or plugin takes effect without restarting the server.
            const available = await this.isUXPAvailable();
            this._resolvedBackend = available ? 'uxp' : 'extendscript';
        }
        this._resolvedAt = Date.now();
        return this._resolvedBackend;
    }

    /**
     * Execute JS inside InDesign via the UXP HTTP bridge.
     * The plugin evaluates the script like ExtendScript and returns its
     * completion value. Errors that guarantee the script did not run (bridge
     * unreachable, plugin not connected) carry code 'UXP_UNAVAILABLE'.
     * @param {string} code
     * @returns {Promise<any>}
     */
    static async executeViaUXP(code) {
        const unavailable = (message) => Object.assign(new Error(message), { code: 'UXP_UNAVAILABLE' });
        let response;
        try {
            response = await fetch(`${uxpBridgeUrl()}/execute`, {
                method: 'POST',
                headers: uxpBridgeHeaders(),
                body: JSON.stringify({ code }),
                signal: AbortSignal.timeout(35000),
            });
        } catch (err) {
            if (err.name === 'TimeoutError') {
                throw new Error('UXP bridge did not answer within 35s');
            }
            if (err.name === 'TypeError' || err.code === 'ECONNREFUSED') {
                throw unavailable(
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

        if (response.status === 503) {
            throw unavailable(data.error || 'UXP plugin not connected');
        }
        if (!response.ok) {
            throw new Error(data.error || `UXP bridge error: ${response.status}`);
        }

        return data.result;
    }

    /**
     * Run a script over the UXP bridge and return the result as the
     * ExtendScript transports do: a string, trimmed like their stdout.
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeUXPScript(script) {
        const result = await this.executeViaUXP(script);
        if (result == null) return '';
        if (typeof result === 'string') return result.trim();
        try {
            return JSON.stringify(result);
        } catch {
            return String(result);
        }
    }

    /**
     * Host/environment status without requiring a full tool call surface.
     * probeInDesign=true attempts a lightweight ExtendScript round-trip and,
     * on the UXP backend, adds backend.uxpProbe (see probeUXP).
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
            status.appName = await this.resolveAppName();
            status.appNameSource = 'resolved';
        }

        if (!IS_WINDOWS) {
            status.indesign.running = (await transport.isRunning()) === true;
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
            if (resolvedBackend === 'uxp') {
                status.backend.uxpProbe = await this.probeUXP();
            }
        }

        return status;
    }

    /**
     * Ask the UXP plugin how this InDesign's DOM differs from ExtendScript
     * (uxp/plugin/runtime.js probe()): enum equality, collection indexing,
     * constructor names, fs path forms, Promise-returning methods. The report
     * lists `problems` (tools will misbehave) and `handled` differences.
     * @returns {Promise<object>}
     */
    static async probeUXP() {
        try {
            const report = await this.executeViaUXP('return await uxpRuntime.probe();');
            if (report && typeof report === 'object') return report;
            return { error: `Unexpected probe result: ${JSON.stringify(report)}` };
        } catch (error) {
            const old = /uxpRuntime is not defined/.test(error.message);
            return {
                error: old
                    ? 'The InDesign Bridge plugin predates the probe (plugin 1.2.0). Reload uxp/plugin from this package.'
                    : error.message,
            };
        }
    }

    /** Remove leftover temp scripts from prior crashes. */
    static cleanupTempScripts() {
        return transport.cleanupTempScripts();
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
                try {
                    return await this.executeUXPScript(script);
                } catch (error) {
                    // In auto mode, fall back only when the script cannot have run.
                    if (error.code !== 'UXP_UNAVAILABLE' || readBackendMode() !== 'auto') throw error;
                    this._resolvedBackend = 'extendscript';
                    this._resolvedAt = Date.now();
                }
            }
            return await this.executeViaExtendScript(script);
        } catch (error) {
            throw new Error(`Error executing tool: ${error.message}`);
        }
    }

    /**
     * Run a script through AppleScript (macOS) or COM (Windows).
     * @param {string} script
     * @returns {Promise<string>}
     */
    static async executeViaExtendScript(script) {
        return transport.runExtendScript(script);
    }

    static async executeInDesignScriptStructured(script) {
        const wrapped = wrapScriptForStructuredResult(script);
        const raw = await this.executeInDesignScript(wrapped);
        return parseStructuredResult(raw);
    }
}
