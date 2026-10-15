/**
 * How this server runs a script in Premiere Pro: through the UXP plugin, over
 * the WebSocket bridge in bridge.js. The bridge starts with the server (or on
 * the first call, inside adobe-mcp-suite) and is configured from the
 * environment: PREMIERE_WS_PORT, BRIDGE_TOKEN, PREMIERE_SCRIPT_TIMEOUT_MS,
 * PREMIERE_CONNECT_WAIT_MS.
 */
import { fileURLToPath } from 'node:url';
import { formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { createBridge, bridgeConfig } from './bridge.js';

/** The plugin folder to load in the UXP Developer Tool. */
export const PLUGIN_DIR = fileURLToPath(new URL('../uxp/plugin/', import.meta.url));

let bridge = null;

function current() {
    bridge ??= createBridge({ ...bridgeConfig(), pluginDir: PLUGIN_DIR });
    return bridge;
}

export const executor = {
    label: 'Premiere Pro',

    /**
     * Send a script to the plugin. Resolves { ok: true, result } or
     * { ok: false, error }; rejects when Premiere Pro cannot be reached.
     * Tests replace this.
     */
    runScript: (source) => current().execute(source),

    /** As runScript, normalised to { ok, result | error }. */
    async runStructured(source) {
        const r = await executor.runScript(source);
        if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
        return { ok: true, result: r ?? null };
    },

    /** Listen for the plugin now (the standalone server does this at startup). */
    start: () => current().start(),

    /** Where the bridge listens and what is connected. */
    status: () => current().status(),

    /** Close the port and drop the plugin connection. */
    async stop() {
        if (bridge) await bridge.stop();
        bridge = null;
    },

    /** Replace the bridge (tests: another port, token or timeout). */
    async configure(options) {
        await executor.stop();
        bridge = createBridge({ ...bridgeConfig(), pluginDir: PLUGIN_DIR, ...options });
        return bridge;
    },

    cleanupTempScripts() { /* scripts are sent as text; there are no files to clean up */ },
};

/**
 * Run a tool script and return a tool result.
 * @param {string} operation e.g. "Insert clip"
 * @param {string} source a script built with script()
 * @param {{ since?: string }} [opts] the Premiere Pro version the tool needs, named when a call fails because a method is missing
 */
export async function run(operation, source, { since } = {}) {
    const r = await executor.runStructured(source);
    if (r.ok) return formatResponse(r.result, operation, () => false);
    let error = r.error;
    if (since && /is not a function|undefined is not|Cannot read properties of undefined/i.test(error)) {
        error += ` (this tool needs Premiere Pro ${since} or later)`;
    }
    return formatErrorResponse(error, operation);
}
