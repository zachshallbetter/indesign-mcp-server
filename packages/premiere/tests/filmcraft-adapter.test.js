import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { handlers, client } from '../src/artcraft/filmcraft-adapter.js';

describe('FilmCraft Adapter', () => {
    it('handles status when server is unreachable', async () => {
        const origPort = client.port;
        try {
            client.port = 65433;
            const res = await handlers.premiere_status({});
            assert.equal(res.success, true);
            assert.equal(res.result.connected, false);
            assert.equal(res.result.app, 'FilmCraft');
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
            const resStatus = await handlers.premiere_status({});
            assert.equal(resStatus.success, true);
            assert.equal(resStatus.result.connected, true);
            assert.equal(resStatus.result.app, 'FilmCraft');

            const resSeq = await handlers.create_sequence({ name: 'Sequence 1' });
            assert.equal(resSeq.success, true);

            const resMedia = await handlers.import_media({ filePaths: ['/tmp/clip1.mov'] });
            assert.equal(resMedia.success, true);

            const resFrame = await handlers.render_frame({ seconds: 2.5 });
            assert.equal(resFrame.success, true);

            assert.ok(received.length >= 3);
        } finally {
            client.port = origPort;
            client.disconnect();
            await new Promise((r) => server.close(r));
        }
    });
});
