import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { handlers, client } from '../../src/artcraft/designcraft-adapter.js';

describe('DesignCraft Adapter', () => {
    it('handles status when server is unreachable', async () => {
        const origPort = client.port;
        try {
            client.port = 65431; // closed port
            const res = await handlers.indesign_status({});
            assert.equal(res.success, true);
            assert.equal(res.result.connected, false);
            assert.equal(res.result.app, 'DesignCraft');
        } finally {
            client.port = origPort;
        }
    });

    it('routes commands over mock control protocol', async () => {
        const received = [];
        const server = net.createServer((sock) => {
            sock.on('data', (buf) => {
                const lines = buf.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const req = JSON.parse(line);
                        received.push(req);
                        sock.write(JSON.stringify({ id: req.id, ok: true, result: { success: true, method: req.method } }) + '\n');
                    } catch {}
                }
            });
        });

        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;
        const origPort = client.port;

        try {
            client.port = port;
            const resStatus = await handlers.indesign_status({});
            assert.equal(resStatus.success, true);
            assert.equal(resStatus.result.connected, true);
            assert.equal(resStatus.result.app, 'DesignCraft');

            const resDoc = await handlers.create_document({ width: 210, height: 297, pages: 4 });
            assert.equal(resDoc.success, true);

            const resOpen = await handlers.open_document({ path: '/tmp/test.designcraft' });
            assert.equal(resOpen.success, true);

            const resInfo = await handlers.get_document_info();
            assert.equal(resInfo.success, true);

            assert.ok(received.length >= 3);
        } finally {
            client.port = origPort;
            client.disconnect();
            await new Promise((r) => server.close(r));
        }
    });
});
