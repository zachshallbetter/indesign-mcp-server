import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolTable, toolDefinitions } from '../src/server.js';
import { compSpec, layerSpec, propertyPath, colorValue, propertyValue } from '../src/args.js';
import { script } from '../src/script.js';
import { resultWrapper } from '../src/executor.js';
import { checkScript } from 'adobe-mcp-core/testing';
import { wrapScriptForStructuredResult } from 'adobe-mcp-core';
import { audit, typings } from './audit.js';
import { scriptsFor, server, home } from './helpers.js';

const featureIds = new Set(JSON.parse(readFileSync(new URL('./fixtures/feature-ids.json', import.meta.url), 'utf8')).ids);

test('every tool is well-formed', () => {
    const names = new Set();
    for (const t of toolDefinitions) {
        assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
        assert.ok(!names.has(t.name), `duplicate ${t.name}`);
        names.add(t.name);
        assert.ok(t.description.length > 20, `${t.name} needs a description`);
        assert.equal(t.inputSchema.type, 'object', t.name);
        for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name}: required ${r} is not a property`);
        assert.ok(t.title);
    }
});

test('every tool claims atlas features that exist', () => {
    for (const t of toolTable) {
        if (t.name === 'help') continue;
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
    }
});

test('destructive and read-only tools are annotated as such', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['delete_layers', 'manage_items', 'open_project', 'execute_aftereffects_code', 'remove_keyframes']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['list_layers', 'list_items', 'get_project_info', 'get_property', 'list_effects', 'aftereffects_status']) assert.equal(byName[n].readOnlyHint, true, n);
});

test('arguments become safe script values', () => {
    assert.deepEqual(JSON.parse(compSpec({ id: 5 })), { id: 5 });
    assert.deepEqual(JSON.parse(compSpec(undefined)), {});
    assert.deepEqual(JSON.parse(layerSpec({ indexes: [1, 3] })), { indexes: [1, 3] });
    assert.throws(() => layerSpec({ indexes: [0] }), /out of range/);
    assert.throws(() => layerSpec({}), /Choose the layers/);
    assert.deepEqual(JSON.parse(propertyPath('position')), ['ADBE Transform Group', 'ADBE Position']);
    assert.deepEqual(JSON.parse(propertyPath(['ADBE Effect Parade', 'Gaussian Blur', 'Blurriness'])), ['ADBE Effect Parade', 'Gaussian Blur', 'Blurriness']);
    assert.throws(() => propertyPath('wobble'), /unknown shortcut/);
    assert.deepEqual(JSON.parse(colorValue('#FF0000')), [1, 0, 0]);
    assert.deepEqual(JSON.parse(colorValue('rgb(0,255,0)')), [0, 1, 0]);
    assert.throws(() => colorValue('red'), /#RRGGBB/);
    assert.throws(() => propertyValue([1, 2, 3, 4, 5]), /1 to 4 numbers/);
    assert.throws(() => propertyValue({}), /must be a number/);
});

test('the prelude suppresses dialogs and closes its undo group, and parses as ES5', () => {
    const s = script('__result__ = 1;', { undo: 'Test' });
    assert.match(s, /^app\.beginSuppressDialogs\(\);\napp\.beginUndoGroup\("Test"\);/);
    assert.match(s, /\} finally \{\n {2}app\.endUndoGroup\(\);\n {2}app\.endSuppressDialogs\(false\);\n\}$/);
    assert.doesNotMatch(script('__result__ = 1;'), /UndoGroup/, 'read-only tools open no undo group');
    assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings), []);
});

test('Windows: the result wrapper runs the script and writes its result to a file', () => {
    const w = resultWrapper('C:\\Temp\\a.jsx', 'C:\\Temp\\a.result.txt');
    assert.match(w, /\$\.evalFile\(new File\("C:\/Temp\/a\.jsx"\)\)/);
    assert.match(w, /new File\("C:\/Temp\/a\.result\.txt"\)/);
    assert.deepEqual(checkScript(w, typings), []);
});

test('the static script audit finds nothing', async () => {
    const report = await audit();
    assert.deepEqual(report.problems, []);
    assert.ok(report.scripts > 35);
});

test('an MCP client can list tools and call help', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.js', import.meta.url).pathname] }));
    try {
        const { tools } = await client.listTools();
        assert.ok(tools.some((t) => t.name === 'set_keyframes'));
        const r = await client.callTool({ name: 'help', arguments: { tool: 'add_layer' } });
        assert.match(r.content[0].text, /solid/);
    } finally {
        await client.close();
    }
});

test('server.json meets the MCP Registry limits and matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const sj = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    assert.ok(sj.description.length <= 100);
    assert.equal(sj.name, pkg.mcpName);
    assert.equal(sj.version, pkg.version);
    assert.equal(sj.packages[0].identifier, pkg.name);
});

test('keyframes carry interpolation and easing; spatial properties take one ease', async () => {
    const [s] = await scriptsFor([['set_keyframes', { layers: { indexes: [1] }, property: 'scale', keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [100, 100], interpolation: 'bezier', easeInfluence: 75 }] }]]);
    const keys = JSON.parse(/keys = (\[.*?\]), out = \[\]/.exec(s)[1]);
    assert.deepEqual(keys[1], { t: 1, v: [100, 100], i: 'BEZIER', e: 75 });
    assert.match(s, /var dims = \(p\.value instanceof Array && !p\.isSpatial\) \? p\.value\.length : 1;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_keyframes', { layers: { indexes: [1] }, property: 'scale', keyframes: [] }), /at least one keyframe/);
    await assert.rejects(mcp.handleToolCall('set_keyframes', { layers: { indexes: [1] }, property: 'scale', keyframes: [{ time: 0, value: [1], interpolation: 'spring' }] }), /Allowed: linear, bezier, hold/);
});

test('layer switches unlock first and restore the lock', async () => {
    const [plain, locking] = await scriptsFor([
        ['set_layer_properties', { layers: { indexes: [2] }, shy: true }],
        ['set_layer_properties', { layers: { indexes: [2] }, solo: true, locked: true }],
    ]);
    assert.match(plain, /var wasLocked = l\.locked; l\.locked = false;\n {2}l\.shy = true;\n {2}l\.locked = wasLocked;/);
    assert.match(locking, /l\.solo = true;\n {2}l\.locked = true;/);
});

test('masks: ellipses are four bezier points; rendering refuses paths outside the allowed folders', async () => {
    const [m] = await scriptsFor([['add_mask', { layers: { indexes: [1] }, shape: 'ellipse', bounds: { x: 0, y: 0, width: 200, height: 100 }, mode: 'subtract', feather: 5 }]]);
    assert.match(m, /sh\.vertices = \[\[100,0\],\[200,50\],\[100,100\],\[0,50\]\];/);
    assert.match(m, /m\.maskMode = MaskMode\.SUBTRACT;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('queue_render', { outputFile: '/etc/out.mov' }), /outside|allowed|not permitted/i);
    await assert.rejects(mcp.handleToolCall('save_project', { filePath: `${home}/Documents/a.txt` }), /\.aep/);
});
