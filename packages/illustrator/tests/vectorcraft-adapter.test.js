import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from '../src/server.js';
import { executor } from '../src/executor.js';
import { client as vectorcraftClient } from '../src/artcraft/vectorcraft-adapter.js';

test('VectorCraft adapter: tool calls route to VectorCraft when backend is artcraft', async () => {
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
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { id: 1, width: req.params.params.width, height: req.params.params.height } }) + '\n');
                } else if (req.method === 'engine.execute' && req.params.command === 'shape.rectangle') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { id: 2, kind: 'rectangle' } }) + '\n');
                } else if (req.method === 'engine.execute' && req.params.command === 'shape.ellipse') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { id: 3, kind: 'ellipse' } }) + '\n');
                } else if (req.method === 'doc_inspect') {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: { name: 'VectorArt.vcraft', width: 612, height: 792, artboards: [{ index: 0 }], layers: [{ id: 1, name: 'Layer 1' }] } }) + '\n');
                } else {
                    sock.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + '\n');
                }
            }
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const oldPort = vectorcraftClient.port;
    const oldBackend = process.env.ILLUSTRATOR_BACKEND;
    vectorcraftClient.port = port;
    process.env.ILLUSTRATOR_BACKEND = 'artcraft';
    executor.resetBackendCache();

    try {
        const mcp = createServer();

        // 1. Status
        const statusRes = await mcp.handleToolCall('illustrator_status', { probe: true });
        assert.equal(statusRes.success, true);
        assert.equal(statusRes.result.connected, true);
        assert.equal(statusRes.result.app, 'VectorCraft');
        assert.equal(statusRes.result.vectorcraft.activeDocument, 'VectorArt.vcraft');

        // 2. Create document
        const createRes = await mcp.handleToolCall('create_document', { width: 800, height: 600, title: 'Poster' });
        assert.equal(createRes.success, true);
        assert.equal(createRes.result.width, 800);
        assert.equal(createRes.result.height, 600);

        // 3. Create rectangle
        const rectRes = await mcp.handleToolCall('create_rectangle', { x: 10, y: 20, width: 100, height: 50 });
        assert.equal(rectRes.success, true);
        assert.equal(rectRes.result.id, 2);

        // 4. Create ellipse
        const ellRes = await mcp.handleToolCall('create_ellipse', { x: 50, y: 50, width: 80, height: 80 });
        assert.equal(ellRes.success, true);
        assert.equal(ellRes.result.id, 3);

        // 5. Unsupported tool on VectorCraft
        const unsuppRes = await mcp.handleToolCall('execute_illustrator_code', { code: 'alert("hi")' });
        assert.equal(unsuppRes.success, false);
        assert.match(unsuppRes.error, /not supported on VectorCraft/);

        // Verify wire commands
        const cmdNames = receivedCalls.map((c) => c.params?.command || c.method);
        assert.ok(cmdNames.includes('doc_inspect'));
        assert.ok(cmdNames.includes('file.new'));
        assert.ok(cmdNames.includes('shape.rectangle'));
        assert.ok(cmdNames.includes('shape.ellipse'));
    } finally {
        vectorcraftClient.disconnect();
        vectorcraftClient.port = oldPort;
        if (oldBackend !== undefined) process.env.ILLUSTRATOR_BACKEND = oldBackend;
        else delete process.env.ILLUSTRATOR_BACKEND;
        executor.resetBackendCache();
        await new Promise((resolve) => server.close(resolve));
    }
});
