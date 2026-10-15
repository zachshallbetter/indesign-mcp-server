import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolTable, toolDefinitions, annotations, SERVER_INSTRUCTIONS } from '../src/server.js';
import { colorSpec, targetSpec } from '../src/args.js';
import { script } from '../src/script.js';
import { checkScript } from 'adobe-mcp-core/testing';
import { wrapScriptForStructuredResult } from 'adobe-mcp-core';
import { audit, typings } from './audit.js';

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
        assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
        assert.ok(t.title);
    }
    assert.deepEqual(annotations.unknownAnnotationNames([...names]), []);
});

test('every tool claims atlas features that exist', () => {
    for (const t of toolTable) {
        if (t.name === 'help') continue;
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
    }
});

test('destructive tools are annotated as such', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['close_document', 'delete_items', 'delete_layer', 'delete_artboard', 'execute_illustrator_code', 'convert_text_to_outlines']) {
        assert.equal(byName[n].destructiveHint, true, n);
        assert.equal(byName[n].readOnlyHint, false, n);
    }
    for (const n of ['list_items', 'get_document_info', 'list_fonts']) assert.equal(byName[n].readOnlyHint, true, n);
});

test('colours parse the way designers write them', () => {
    assert.deepEqual(JSON.parse(colorSpec('#FF6600')), { kind: 'rgb', v: [255, 102, 0] });
    assert.deepEqual(JSON.parse(colorSpec('cmyk(0, 60, 100, 0)')), { kind: 'cmyk', v: [0, 60, 100, 0] });
    assert.deepEqual(JSON.parse(colorSpec('rgb(1,2,3)')), { kind: 'rgb', v: [1, 2, 3] });
    assert.deepEqual(JSON.parse(colorSpec('gray(40)')), { kind: 'gray', v: [40] });
    assert.deepEqual(JSON.parse(colorSpec('none')), { kind: 'none' });
    assert.deepEqual(JSON.parse(colorSpec('PANTONE 185 C')), { kind: 'swatch', name: 'PANTONE 185 C' });
    assert.throws(() => colorSpec('cmyk(0,60,100)'), /takes 4 value/);
    assert.throws(() => colorSpec('rgb(300,0,0)'), /out of range/);
    assert.equal(colorSpec(undefined), null);
});

test('a swatch name cannot break out of its string', () => {
    const spec = colorSpec('x"}); app.quit(); ({"');
    assert.equal(JSON.parse(spec).name, 'x"}); app.quit(); ({"');
});

test('targets must name something', () => {
    assert.deepEqual(JSON.parse(targetSpec({ ids: ['a'], selection: true })), { ids: ['a'], selection: true });
    assert.throws(() => targetSpec({}), /Choose the items/);
    assert.throws(() => targetSpec(undefined), /Choose the items/);
});

test('the prelude restores the user\'s settings and parses as ES5', () => {
    const s = script('__result__ = 1;');
    assert.match(s, /app\.userInteractionLevel = UserInteractionLevel\.DONTDISPLAYALERTS/);
    assert.match(s, /\} finally \{\n {2}app\.coordinateSystem = __prevCS;\n {2}app\.userInteractionLevel = __prevUI;/);
    assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings), []);
});

test('the static script audit finds nothing', async () => {
    const report = await audit();
    assert.deepEqual(report.problems, []);
    assert.equal(report.tools, toolDefinitions.length);
});

test('an MCP client can list tools and call the ones that need no Illustrator', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.js', import.meta.url).pathname] }));
    try {
        assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
        const { tools } = await client.listTools();
        assert.equal(tools.length, toolDefinitions.length);

        const help = await client.callTool({ name: 'help', arguments: { tool: 'create_rectangle' } });
        assert.equal(help.isError, false);
        assert.ok(JSON.parse(help.content[0].text).result.parameters.cornerRadius);

        const found = await client.callTool({ name: 'find_menu_commands', arguments: { query: 'outlines' } });
        assert.ok(JSON.parse(found.content[0].text).result.commands.some((c) => c.command === 'outline'));

        const unknown = await client.callTool({ name: 'execute_menu_command', arguments: { command: 'notACommand' } });
        assert.equal(unknown.isError, true);
        assert.match(unknown.content[0].text, /would ignore it silently/);

        const bad = await client.callTool({ name: 'create_rectangle', arguments: { x: 'ten', y: 0, width: 10, height: 10 } });
        assert.equal(bad.isError, true);
        assert.match(bad.content[0].text, /Invalid number for 'x'/);

        const warned = await client.callTool({ name: 'help', arguments: { tol: 'x' } });
        assert.match(warned.content[0].text, /did you mean 'tool'/);
    } finally {
        await client.close();
    }
});

test('server.json meets the MCP Registry limits and matches package.json', () => {
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(server.description.length <= 100, `description is ${server.description.length} characters; the registry allows 100`);
    assert.equal(server.name, pkg.mcpName);
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0].identifier, pkg.name);
    assert.equal(server.packages[0].version, pkg.version);
});

test('every Live Effect and both Pathfinder methods generate valid scripts', async () => {
    const { EFFECTS, PATHFINDER_COMMANDS } = await import('../src/effects.js');
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        const required = { offset_path: { offset: 3 }, round_corners: { radius: 4 }, gaussian_blur: { radius: 2 } };
        for (const effect of Object.keys(EFFECTS)) {
            for (const expand of [false, true]) {
                const r = await mcp.handleToolCall('apply_effect', { target: { selection: true }, effect, options: required[effect] ?? {}, expand });
                assert.equal(r.success, true, `${effect}: ${JSON.stringify(r)}`);
            }
        }
        for (const operation of Object.keys(PATHFINDER_COMMANDS)) {
            for (const method of ['effect', 'menu']) {
                const r = await mcp.handleToolCall('pathfinder', { target: { selection: true }, operation, method, removeUnpainted: true });
                assert.equal(r.success, true, `${operation} ${method}`);
            }
        }
    } finally {
        executor.runScript = original;
    }
    assert.equal(sent.length, Object.keys(EFFECTS).length * 2 + 10 * 2);
    for (const s of sent) assert.deepEqual(checkScript(s, typings), []);
});

test('effect options are checked before anything runs', async () => {
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'offset_path', options: {} }), /needs options\.offset/);
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'round_corners', options: { radius: 2, size: 3 } }), /has no option size/);
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'offset_path', options: { offset: 2, joins: 'square' } }), /Allowed: round, bevel, miter/);
});

test('the Live Effect XML carries the published parameters', async () => {
    const { EFFECTS, pathfinderEffect } = await import('../src/effects.js');
    // Evaluate the generated expression with a stand-in document (scale factor 1, CMYK).
    const evalXml = (expr) => Function('doc', 'DocumentColorSpace', '__sf', `return ${expr};`)({ documentColorSpace: 'CMYK' }, { CMYK: 'CMYK' }, () => 1);
    assert.equal(evalXml(EFFECTS.offset_path.build({ offset: -2.5, joins: 'round', miterLimit: 4 })),
        '<LiveEffect name="Adobe Offset Path"><Dict data="R ofst -2.5 I jntp 0 R mlim 4 "/></LiveEffect>');
    assert.match(evalXml(EFFECTS.drop_shadow.build({ opacity: 50 })), /R opac 0\.5 .*<Fill color="0 0 0 1"\/>/);
    assert.match(evalXml(pathfinderEffect('divide', { removeUnpainted: true })), /I Command 5 B ConvertCustom 1 B ExtractUnpainted 1 .*value="Divide"/);
    assert.match(evalXml(EFFECTS.transform.build({ moveY: 10 })), /R moveV_Pts -10 /, 'down is positive for callers, up for the effect');
});

test('preferences: only known keys, with their stored types', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        await mcp.handleToolCall('set_preferences', { usePreviewBounds: true, keyboardIncrement: 0.5 });
        assert.match(sent[0], /p\.setBooleanPreference\("includeStrokeInBounds", true\);/);
        assert.match(sent[0], /p\.setRealPreference\("cursorKeyLength", 0\.5\);/);
        const none = await mcp.handleToolCall('set_preferences', { madeUpKey: 1 });
        assert.equal(none.success, false);
        assert.match(none.warnings.join(), /Unknown parameter 'madeUpKey'/);
    } finally {
        executor.runScript = original;
    }
});

test('select_tool matches Illustrator tool names loosely and refuses unknown ones', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const original = executor.runScript;
    let sent = '';
    executor.runScript = async (s) => { sent = s; return '{"ok":true,"result":"{}"}'; };
    try {
        await mcp.handleToolCall('select_tool', { tool: 'pen' });
        assert.match(sent, /app\.selectTool\("Adobe Pen Tool"\);/);
        const r = await mcp.handleToolCall('select_tool', { tool: 'Lasso of Truth' });
        assert.equal(r.success, false);
    } finally {
        executor.runScript = original;
    }
});
