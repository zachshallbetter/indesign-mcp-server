/**
 * Shared test helpers. Test files are tests/*.test.js; each area's tools can
 * have its own file.
 */
import assert from 'node:assert/strict';
import { checkScript } from 'adobe-mcp-core/testing';
import { typings } from './audit.js';

export const home = process.env.HOME ?? '/tmp';

/** A fresh server, for calling tools whose arguments should be refused. */
export async function server() {
    return (await import('../src/server.js')).createServer();
}

/**
 * Run tool calls against a stubbed executor (Illustrator is never contacted).
 * Each call must succeed and each generated script must pass the object-model
 * audit. Returns the scripts, in call order.
 */
export async function scriptsFor(calls) {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        for (const [name, args] of calls) {
            const r = await mcp.handleToolCall(name, args);
            assert.equal(r.success, true, `${name}: ${JSON.stringify(r)}`);
        }
    } finally {
        executor.runScript = original;
    }
    for (const s of sent) assert.deepEqual(checkScript(s, typings), []);
    return sent;
}
