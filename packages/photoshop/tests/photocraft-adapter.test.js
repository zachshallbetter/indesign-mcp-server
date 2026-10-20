import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer, createRoutedHandlers, toolTable } from '../src/server.js';
import { executor } from '../src/executor.js';
import { client as photocraftClient } from '../src/artcraft/photocraft-adapter.js';

test('PhotoCraft adapter: tool calls route to PhotoCraft when backend is artcraft', async () => {
    const receivedCalls = [];
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
                receivedCalls.push(req);
                if (req.method === 'engine.execute' && req.params.command === 'file.new') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { width: req.params.params.width, height: req.params.params.height } }) + '\n');
                } else if (req.method === 'engine.execute' && req.params.command === 'image.imageSize') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { resized: true } }) + '\n');
                } else if (req.method === 'ui.inspect') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { document: { name: 'TestDoc.pcraft', width: 800, height: 600 } } }) + '\n');
                } else {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + '\n');
                }
            }
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const oldPort = photocraftClient.port;
    const oldBackend = process.env.PHOTOSHOP_BACKEND;
    photocraftClient.port = port;
    process.env.PHOTOSHOP_BACKEND = 'artcraft';
    executor.resetBackendCache();

    try {
        const mcp = createServer();

        // 1. Status
        const statusRes = await mcp.handleToolCall('photoshop_status', { probe: true });
        assert.equal(statusRes.success, true);
        assert.equal(statusRes.result.connected, true);
        assert.equal(statusRes.result.app, 'PhotoCraft');
        assert.equal(statusRes.result.photocraft.activeDocument, 'TestDoc.pcraft');

        // 2. Create document
        const createRes = await mcp.handleToolCall('create_document', { width: 1200, height: 800, fill: 'white' });
        assert.equal(createRes.success, true);
        assert.equal(createRes.result.width, 1200);
        assert.equal(createRes.result.height, 800);

        // 3. Resize image
        const resizeRes = await mcp.handleToolCall('resize_image', { width: 600, height: 400 });
        assert.equal(resizeRes.success, true);
        assert.equal(resizeRes.result.resized, true);

        // 4. Unsupported tool on PhotoCraft
        const unsuppRes = await mcp.handleToolCall('play_action', { action: 'Test', set: 'Default' });
        assert.equal(unsuppRes.success, false);
        assert.match(unsuppRes.error, /not supported on PhotoCraft/);

        // Verify calls sent over wire
        const cmdNames = receivedCalls.map((c) => c.params?.command || c.method);
        assert.ok(cmdNames.includes('ui.inspect'));
        assert.ok(cmdNames.includes('file.new'));
        assert.ok(cmdNames.includes('image.imageSize'));
    } finally {
        photocraftClient.disconnect();
        photocraftClient.port = oldPort;
        if (oldBackend !== undefined) process.env.PHOTOSHOP_BACKEND = oldBackend;
        else delete process.env.PHOTOSHOP_BACKEND;
        executor.resetBackendCache();
        await new Promise((resolve) => server.close(resolve));
    }
});
