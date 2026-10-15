/**
 * The plugin's runtime (uxp/plugin/runtime.js), loaded as plain CommonJS in a
 * Node vm: transact's lock and transaction handling, results made JSON-safe,
 * one script at a time; then tools end to end, from the MCP handler through
 * the bridge and a WebSocket to the runtime and a fake Premiere DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime, fakePlugin } from './helpers.js';
import { fakePremiere } from './fake-premiere.js';
import { executor } from '../src/executor.js';
import { createServer } from '../src/server.js';

const { createRuntime, serializeResult } = loadRuntime();

test('transact creates actions inside the lock and runs them as one named transaction', async () => {
    const fake = fakePremiere();
    const rt = createRuntime({ ppro: fake.ppro });
    const n = rt.transact(fake.project, 'Set in and out', (add) => {
        add(fake.sequence.createSetInPointAction({ seconds: 2 }));
        add(fake.sequence.createSetOutPointAction({ seconds: 8 }));
    });
    assert.equal(n, 2);
    assert.deepEqual(fake.undo, ['Set in and out']);
    assert.equal(fake.sequence.inPoint.seconds, 2);
    assert.equal(fake.sequence.outPoint.seconds, 8);
    assert.equal(rt.transact(fake.project, 'Nothing', () => {}), 0, 'an empty build runs no transaction');
    assert.deepEqual(fake.undo, ['Set in and out']);
});

test('transact reports a failed build, a missing action and a refused transaction', () => {
    const fake = fakePremiere();
    const rt = createRuntime({ ppro: fake.ppro });
    assert.throws(() => rt.transact(fake.project, 'X', () => { throw new Error('bad clip'); }), /bad clip/);
    assert.throws(() => rt.transact(fake.project, 'Trim', (add) => add(null)), /could not prepare part of "Trim"/);
    const refusing = { ...fake.project, executeTransaction: () => false };
    assert.throws(() => rt.transact(refusing, 'Move', (add) => add({})), /did not apply "Move"/);
    assert.throws(() => rt.transact({}, 'X', () => {}), /transact needs a Project/);
    assert.equal(fake.undo.length, 0);
});

test('results are made JSON-safe', () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    assert.deepEqual(serializeResult(cyclic), { a: 1 });
    assert.deepEqual(serializeResult({ n: 10n, f() {}, u: undefined, d: [1, 'x', null] }), { n: '10', d: [1, 'x', null] });
    assert.equal(serializeResult(undefined), null);
});

test('scripts run with ppro and transact in scope, one at a time, and errors come back as messages', async () => {
    const fake = fakePremiere();
    const rt = createRuntime({ ppro: fake.ppro });
    const out = [];
    const send = (s) => out.push(JSON.parse(s));
    rt.handleMessage({ type: 'execute', id: '1', code: 'await new Promise((r) => setTimeout(r, 30)); return (await ppro.Project.getActiveProject()).name;' }, send);
    rt.handleMessage({ type: 'execute', id: '2', code: 'throw new Error("No sequence named X");' }, send);
    rt.handleMessage({ type: 'execute', id: '3', code: 'return typeof transact;' }, send);
    await rt.handleMessage({ type: 'ping', id: 'p' }, send);
    assert.deepEqual(out, [
        { type: 'pong', id: 'p' },
        { type: 'result', id: '1', result: 'Documentary' },
        { type: 'error', id: '2', error: 'No sequence named X' },
        { type: 'result', id: '3', result: 'function' },
    ]);
});

test('tools run end to end against a fake Premiere Pro', async () => {
    const fake = fakePremiere();
    const bridge = await executor.configure({ port: 0, token: 'k', connectWaitMs: 1000, timeoutMs: 5000, log: () => {} });
    await executor.start();
    const plugin = fakePlugin(bridge.port, { token: 'k', runtime: createRuntime({ ppro: fake.ppro }) });
    await plugin.ready;
    const mcp = createServer();
    try {
        const seqs = await mcp.handleToolCall('list_sequences', {});
        assert.equal(seqs.success, true, JSON.stringify(seqs));
        assert.equal(seqs.result.count, 1);
        assert.deepEqual(
            { name: seqs.result.sequences[0].name, guid: seqs.result.sequences[0].guid, active: seqs.result.sequences[0].active, width: seqs.result.sequences[0].width },
            { name: 'Main edit', guid: 'seq-1', active: true, width: 1920 },
        );

        const added = await mcp.handleToolCall('add_marker', { start: 12.5, name: 'Applause', duration: 2, comments: 'Cut here', color: 'magenta' });
        assert.equal(added.success, true, JSON.stringify(added));
        assert.equal(added.result.marker.name, 'Applause');
        assert.equal(added.result.marker.start, 12.5);
        assert.equal(added.result.marker.colorIndex, 2);
        assert.deepEqual(fake.undo, ['Add marker', 'Marker colour']);

        const listed = await mcp.handleToolCall('list_markers', { type: 'Comment' });
        assert.equal(listed.result.count, 1);

        const times = await mcp.handleToolCall('set_sequence_times', { inPoint: 4, outPoint: 30, playhead: 10 });
        assert.equal(times.success, true, JSON.stringify(times));
        assert.deepEqual([times.result.inPoint, times.result.outPoint, times.result.playhead], [4, 30, 10]);

        const removed = await mcp.handleToolCall('remove_markers', { all: true });
        assert.equal(removed.result.removed, 1);
        assert.equal(fake.markerList.length, 0);

        const missing = await mcp.handleToolCall('open_sequence', { sequence: { name: 'Trailer' } });
        assert.equal(missing.success, false);
        assert.match(missing.result, /No sequence named Trailer/);

        const status = await mcp.handleToolCall('premiere_status', {});
        assert.equal(status.success, true, JSON.stringify(status));
        assert.equal(status.result.plugin.hostVersion, '26.3.0');
        assert.equal(status.result.premiere.project.name, 'Documentary');
    } finally {
        plugin.close();
        await executor.stop();
    }
});
