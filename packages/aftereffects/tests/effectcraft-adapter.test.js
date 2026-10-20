import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { handlers, client } from '../src/artcraft/effectcraft-adapter.js';

describe('EffectCraft Adapter', () => {
    it('handles status when server is unreachable', async () => {
        const origPort = client.port;
        try {
            client.port = 65432;
            const res = await handlers.aftereffects_status({});
            assert.equal(res.success, true);
            assert.equal(res.result.connected, false);
            assert.equal(res.result.app, 'EffectCraft');
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
            const resStatus = await handlers.aftereffects_status({});
            assert.equal(resStatus.success, true);
            assert.equal(resStatus.result.connected, true);
            assert.equal(resStatus.result.app, 'EffectCraft');

            const resComp = await handlers.create_composition({ name: 'Test Comp', width: 1920, height: 1080 });
            assert.equal(resComp.success, true);

            const resInfo = await handlers.get_project_info();
            assert.equal(resInfo.success, true);

            const resRender = await handlers.render_frame({ time: 1.5 });
            assert.equal(resRender.success, true);

            assert.ok(received.length >= 3);
        } finally {
            client.port = origPort;
            client.disconnect();
            await new Promise((r) => server.close(r));
        }
    });
});
