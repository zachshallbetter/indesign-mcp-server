/**
 * The bridge over real sockets: a fake plugin connects with ws, and the tests
 * check authentication, the close codes the panel acts on, the result and
 * error round trip, timeouts, what happens without a plugin, and a second MCP
 * server process forwarding to the first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createBridge, bridgeConfig, CLOSE_UNAUTHORIZED, CLOSE_AUTH_TIMEOUT, CLOSE_ALREADY_CONNECTED } from '../src/bridge.js';
import { fakePlugin } from './helpers.js';

const quiet = () => {};
const make = (opts = {}) => createBridge({ port: 0, connectWaitMs: 300, timeoutMs: 2000, authTimeoutMs: 300, pluginDir: '/plugins/premiere', log: quiet, ...opts });

function get(port, path, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
        }).on('error', reject);
    });
}

test('configuration comes from the environment and is checked', () => {
    assert.deepEqual(bridgeConfig({}), { port: 3011, token: null, timeoutMs: 120000, connectWaitMs: 4000, authTimeoutMs: 5000 });
    assert.equal(bridgeConfig({ PREMIERE_WS_PORT: '4100', BRIDGE_TOKEN: 'a' }).port, 4100);
    assert.equal(bridgeConfig({ BRIDGE_TOKEN: 'a', PREMIERE_BRIDGE_TOKEN: 'b' }).token, 'b');
    assert.throws(() => bridgeConfig({ PREMIERE_WS_PORT: '70000' }), /PREMIERE_WS_PORT must be a whole number from 0 to 65535/);
    assert.throws(() => bridgeConfig({ PREMIERE_SCRIPT_TIMEOUT_MS: 'soon' }), /PREMIERE_SCRIPT_TIMEOUT_MS/);
});

test('a script goes to the plugin and its result or error comes back', async () => {
    const bridge = make();
    await bridge.start();
    const plugin = fakePlugin(bridge.port, {
        onExecute: async (code) => {
            if (code.includes('boom')) throw new Error('No project is open in Premiere Pro');
            return { echoed: code };
        },
    });
    await plugin.ready;
    try {
        assert.deepEqual(await bridge.execute('return 1;'), { ok: true, result: { echoed: 'return 1;' } });
        assert.deepEqual(await bridge.execute('boom'), { ok: false, error: 'No project is open in Premiere Pro' });
        const status = await bridge.status();
        assert.equal(status.connected, true);
        assert.equal(status.mode, 'host');
        assert.equal(status.plugin.hostVersion, '26.3.0');
        assert.equal(status.host, '127.0.0.1');
    } finally {
        plugin.close();
        await bridge.stop();
    }
});

test('scripts run one at a time, in order', async () => {
    const bridge = make();
    await bridge.start();
    let running = 0;
    let most = 0;
    const plugin = fakePlugin(bridge.port, {
        onExecute: async (code) => {
            running++;
            most = Math.max(most, running);
            await new Promise((r) => setTimeout(r, 20));
            running--;
            return code;
        },
    });
    await plugin.ready;
    try {
        const results = await Promise.all(['a', 'b', 'c'].map((c) => bridge.execute(c)));
        assert.deepEqual(results.map((r) => r.result), ['a', 'b', 'c']);
        assert.equal(most, 1);
    } finally {
        plugin.close();
        await bridge.stop();
    }
});

test('without a plugin a call fails after the wait and says how to connect', async () => {
    const bridge = make({ connectWaitMs: 100 });
    try {
        await assert.rejects(bridge.execute('return 1;'), (e) => {
            assert.equal(e.code, 'NOT_CONNECTED');
            assert.match(e.message, /Premiere Pro is not connected/);
            assert.match(e.message, /\/plugins\/premiere/);
            assert.match(e.message, /UXP Developer Tool/);
            assert.match(e.message, /MCP Bridge panel/);
            return true;
        });
    } finally {
        await bridge.stop();
    }
});

test('a plugin that connects while a call waits receives the script', async () => {
    const bridge = make({ connectWaitMs: 2000 });
    await bridge.start();
    const pending = bridge.execute('return 2;');
    await new Promise((r) => setTimeout(r, 50));
    const plugin = fakePlugin(bridge.port, { onExecute: async () => 2 });
    try {
        assert.deepEqual(await pending, { ok: true, result: 2 });
    } finally {
        plugin.close();
        await bridge.stop();
    }
});

test('a script that does not answer times out, and a late answer is ignored', async () => {
    const bridge = make({ timeoutMs: 150 });
    await bridge.start();
    const plugin = fakePlugin(bridge.port, {
        onExecute: async (code) => {
            if (code === 'slow') await new Promise((r) => setTimeout(r, 400));
            return code;
        },
    });
    await plugin.ready;
    try {
        await assert.rejects(bridge.execute('slow'), (e) => e.code === 'TIMEOUT' && /did not answer within 150 ms/.test(e.message) && /dialog may be open/.test(e.message));
        await new Promise((r) => setTimeout(r, 400));
        assert.deepEqual(await bridge.execute('fast'), { ok: true, result: 'fast' });
    } finally {
        plugin.close();
        await bridge.stop();
    }
});

test('a plugin that disconnects mid-script fails that call', async () => {
    const bridge = make();
    await bridge.start();
    const plugin = fakePlugin(bridge.port, { onExecute: () => new Promise(() => {}) });
    await plugin.ready;
    try {
        const call = bridge.execute('return 1;');
        await new Promise((r) => setTimeout(r, 50));
        plugin.ws.terminate();
        await assert.rejects(call, (e) => e.code === 'DISCONNECTED' && /disconnected while the script was running/.test(e.message));
    } finally {
        await bridge.stop();
    }
});

test('with a token: the right token connects; a wrong one closes 4001; silence closes 4002', async () => {
    const bridge = make({ token: 'secret' });
    await bridge.start();
    try {
        const wrong = fakePlugin(bridge.port, { token: 'nope' });
        assert.equal((await wrong.closed).code, CLOSE_UNAUTHORIZED);
        assert.ok(wrong.received.some((m) => m.type === 'auth-error'));

        const silent = fakePlugin(bridge.port, { sendAuth: false });
        assert.equal((await silent.closed).code, CLOSE_AUTH_TIMEOUT);

        const right = fakePlugin(bridge.port, { token: 'secret', onExecute: async () => 'ok' });
        await right.ready;
        assert.ok(right.received.some((m) => m.type === 'auth-ok'));
        assert.deepEqual(await bridge.execute('x'), { ok: true, result: 'ok' });
        right.close();
    } finally {
        await bridge.stop();
    }
});

test('without a token the first message must still be an auth message', async () => {
    const bridge = make();
    await bridge.start();
    try {
        const plugin = fakePlugin(bridge.port, { sendAuth: false });
        await plugin.ready;
        plugin.ws.send(JSON.stringify({ type: 'result', id: 'x', result: 1 }));
        assert.equal((await plugin.closed).code, CLOSE_UNAUTHORIZED);
    } finally {
        await bridge.stop();
    }
});

test('a connected plugin is never replaced: a second one is closed with 4009', async () => {
    const bridge = make();
    await bridge.start();
    const first = fakePlugin(bridge.port, { onExecute: async () => 'first' });
    await first.ready;
    try {
        const second = fakePlugin(bridge.port, { onExecute: async () => 'second' });
        assert.equal((await second.closed).code, CLOSE_ALREADY_CONNECTED);
        assert.deepEqual(await bridge.execute('x'), { ok: true, result: 'first' });
    } finally {
        first.close();
        await bridge.stop();
    }
});

test('HTTP: status and execute need the token, and web pages are refused', async () => {
    const bridge = make({ token: 'secret' });
    await bridge.start();
    try {
        assert.equal((await get(bridge.port, '/status')).status, 401);
        const ok = await get(bridge.port, '/status', { Authorization: 'Bearer secret' });
        assert.equal(ok.status, 200);
        assert.equal(ok.json.service, 'adobe-mcp-premiere');
        assert.equal(ok.json.connected, false);
        const browser = await get(bridge.port, '/status', { Authorization: 'Bearer secret', Origin: 'https://example.com' });
        assert.equal(browser.status, 403);
        assert.equal((await get(bridge.port, '/nothing', { Authorization: 'Bearer secret' })).status, 404);
    } finally {
        await bridge.stop();
    }
});

test('a second server on the same port forwards to the first, and takes the port over when the first stops', async () => {
    const first = make({ token: 't' });
    await first.start();
    const port = first.port;
    const plugin = fakePlugin(port, { token: 't', onExecute: async (code) => `ran ${code}` });
    await plugin.ready;
    const second = make({ port, token: 't', connectWaitMs: 1500 });
    try {
        assert.equal(await second.start(), 'forward');
        assert.deepEqual(await second.execute('a'), { ok: true, result: 'ran a' });
        const status = await second.status();
        assert.equal(status.mode, 'forward');
        assert.equal(status.connected, true);
        assert.match(status.via, /already listening on port/);

        await first.stop();
        await plugin.closed;
        // The panel would reconnect within 3 s; here a new fake plugin dials in once the port is free.
        const call = second.execute('b');
        let again;
        for (let i = 0; i < 50 && !second.connected; i++) {
            await new Promise((r) => setTimeout(r, 20));
            if (second.mode === 'host' && !again) again = fakePlugin(port, { token: 't', onExecute: async (code) => `again ${code}` });
        }
        assert.deepEqual(await call, { ok: true, result: 'again b' });
        assert.equal(second.mode, 'host');
        again.close();
    } finally {
        await second.stop();
        await first.stop();
    }
});

test('a second server with the wrong token is told so', async () => {
    const first = make({ token: 'right' });
    await first.start();
    const second = make({ port: first.port, token: 'wrong' });
    try {
        await assert.rejects(second.start(), /needs a different BRIDGE_TOKEN/);
    } finally {
        await second.stop();
        await first.stop();
    }
});

test('a port held by another program is reported', async () => {
    const other = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi'));
    await new Promise((r) => other.listen(0, '127.0.0.1', r));
    const bridge = make({ port: other.address().port });
    try {
        await assert.rejects(bridge.execute('x'), (e) => e.code === 'PORT_IN_USE' && /in use by another program/.test(e.message) && /PREMIERE_WS_PORT/.test(e.message));
    } finally {
        await bridge.stop();
        other.close();
    }
});
