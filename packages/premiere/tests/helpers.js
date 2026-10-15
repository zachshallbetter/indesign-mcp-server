/**
 * Shared test helpers. Test files are tests/*.test.js.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import WebSocket from 'ws';
import { checkScript } from './audit.js';

export const home = process.env.HOME ?? '/tmp';
export const docs = path.join(home, 'Documents');

/** A fresh server, for calling tools whose arguments should be refused. */
export async function server() {
    return (await import('../src/server.js')).createServer();
}

/**
 * Run tool calls against a stubbed executor (Premiere Pro is never contacted).
 * Each call must succeed and each generated script must pass the audit.
 * Returns the scripts, in call order.
 */
export async function scriptsFor(calls, result = {}) {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return { ok: true, result }; };
    try {
        for (const [name, args] of calls) {
            const r = await mcp.handleToolCall(name, args);
            assert.equal(r.success, true, `${name}: ${JSON.stringify(r)}`);
        }
    } finally {
        executor.runScript = original;
    }
    for (const s of sent) assert.deepEqual(checkScript(s).problems, []);
    return sent;
}

/** The tool body of a generated script (after the shared helpers). */
export const body = (s) => s.slice(s.indexOf('// ---- tool'));

/** The plugin's runtime.js, loaded as the plugin loads it (CommonJS, no UXP). */
export function loadRuntime() {
    const file = new URL('../uxp/plugin/runtime.js', import.meta.url);
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(file, 'utf8'), { module, exports: module.exports, JSON, Object, Promise, WeakSet, String, Error, Date, setTimeout, clearTimeout }, { filename: file.pathname });
    return module.exports;
}

/**
 * A plugin stand-in: connects to the bridge over a real WebSocket, authenticates
 * as the panel does, and answers each script with onExecute(code) (or with the
 * real runtime when given one).
 */
export function fakePlugin(port, { token = '', client = { plugin: '0.1.0', host: 'premierepro', hostVersion: '26.3.0', uxp: '8.1.0' }, onExecute, runtime, sendAuth = true } = {}) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const received = [];
    const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    const ready = new Promise((resolve, reject) => {
        ws.on('open', () => { if (sendAuth) ws.send(JSON.stringify({ type: 'auth', token, client })); else resolve(); });
        ws.on('error', reject);
        ws.on('message', async (data) => {
            const msg = JSON.parse(data.toString());
            received.push(msg);
            if (msg.type === 'auth-ok') resolve();
            if (msg.type !== 'execute' && msg.type !== 'ping') return;
            if (runtime) { runtime.handleMessage(msg, (out) => ws.send(out)); return; }
            try {
                const result = await onExecute(msg.code);
                ws.send(JSON.stringify({ type: 'result', id: msg.id, result }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', id: msg.id, error: e.message }));
            }
        });
        closed.then(resolve);
    });
    return { ws, ready, closed, received, close: () => ws.close() };
}
