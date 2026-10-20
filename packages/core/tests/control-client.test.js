import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ControlClient, createControlClient } from '../src/control-client.js';

test('ControlClient: isAvailable detects listening port', async () => {
    const server = net.createServer((sock) => sock.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const client = new ControlClient({ port });
        assert.equal(await client.isAvailable(300), true);

        const deadClient = new ControlClient({ port: port + 1 });
        assert.equal(await deadClient.isAvailable(200), false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('ControlClient: roundtrips JSON-lines call and auth', async () => {
    let receivedAuth = null;
    const server = net.createServer((sock) => {
        let buf = '';
        sock.on('data', (d) => {
            buf += d.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) continue;
                const req = JSON.parse(line);
                if (req.method === 'auth') {
                    receivedAuth = req.params.token;
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { authenticated: true } }) + '\n');
                } else if (req.method === 'engine.execute') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { executed: req.params.command } }) + '\n');
                }
            }
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const client = new ControlClient({ port, token: 'secret-token-123' });
        const res = await client.execute('doc.create', { width: 100 });
        assert.equal(receivedAuth, 'secret-token-123');
        assert.deepEqual(res, { executed: 'doc.create' });
        client.disconnect();
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('createControlClient reads environment variables', () => {
    const client = createControlClient({
        appPrefix: 'PHOTOCRAFT',
        defaultPort: 7878,
        env: { PHOTOCRAFT_CONTROL_PORT: '8888', PHOTOCRAFT_CONTROL_TOKEN: 'tok123' },
    });
    assert.equal(client.port, 8888);
    assert.equal(client.token, 'tok123');
});
