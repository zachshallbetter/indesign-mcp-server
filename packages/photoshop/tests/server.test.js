import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolTable, toolDefinitions } from '../src/server.js';
import { colorSpec, targetSpec, rect } from '../src/args.js';
import { script } from '../src/script.js';
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
        assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
        assert.ok(t.title);
    }
});

test('every tool claims atlas features that exist', async () => {
    for (const t of toolTable) {
        if (t.name === 'help') continue;
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
    }
    const { ADJUSTMENTS, FILTERS } = await import('../src/tools/adjust.js');
    for (const [k, entry] of Object.entries({ ...ADJUSTMENTS, ...FILTERS })) assert.ok(entry.features?.length, `${k} claims no feature`);
});

test('destructive and read-only tools are annotated as such', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['close_document', 'delete_layers', 'flatten_image', 'crop_image', 'merge_layers', 'execute_photoshop_code']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['list_layers', 'get_document_info', 'list_documents', 'list_fonts', 'list_history', 'photoshop_status']) assert.equal(byName[n].readOnlyHint, true, n);
});

test('colours parse the way designers write them', () => {
    assert.deepEqual(JSON.parse(colorSpec('#FF6600')), { kind: 'rgb', v: [255, 102, 0] });
    assert.deepEqual(JSON.parse(colorSpec('cmyk(0, 60, 100, 0)')), { kind: 'cmyk', v: [0, 60, 100, 0] });
    assert.deepEqual(JSON.parse(colorSpec('hsb(200,50,40)')), { kind: 'hsb', v: [200, 50, 40] });
    assert.deepEqual(JSON.parse(colorSpec('lab(60,-20,35)')), { kind: 'lab', v: [60, -20, 35] });
    assert.throws(() => colorSpec('rgb(300,0,0)'), /out of range/);
    assert.throws(() => colorSpec('lab(60,200,0)'), /out of range/);
    assert.throws(() => colorSpec('red'), /not a colour/);
});

test('targets and rectangles must be complete', () => {
    assert.deepEqual(JSON.parse(targetSpec({ ids: [3], active: true })), { ids: [3], active: true });
    assert.throws(() => targetSpec({}), /Choose the layers/);
    assert.deepEqual(rect({ x: 10, y: 20, width: 30, height: 40 }), [10, 20, 40, 60]);
    assert.throws(() => rect({ x: 0, y: 0, width: 0, height: 5 }), /above 0/);
});

test('the prelude turns dialogs off, works in pixels and restores both, and parses as ES5', () => {
    const s = script('__result__ = 1;');
    assert.match(s, /app\.displayDialogs = DialogModes\.NO;/);
    assert.match(s, /app\.preferences\.rulerUnits = Units\.PIXELS;/);
    assert.match(s, /\} finally \{\n {2}app\.preferences\.typeUnits = __prevType;\n {2}app\.preferences\.rulerUnits = __prevRuler;\n {2}app\.displayDialogs = __prevDialogs;/);
    assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings), []);
});

test('the static script audit finds nothing', async () => {
    const report = await audit();
    assert.deepEqual(report.problems, []);
    assert.ok(report.scripts > 40);
});

test('an MCP client can list tools and call help', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.js', import.meta.url).pathname] }));
    try {
        const { tools } = await client.listTools();
        assert.ok(tools.some((t) => t.name === 'list_layers'));
        const r = await client.callTool({ name: 'help', arguments: { tool: 'apply_filter' } });
        assert.match(r.content[0].text, /gaussian_blur/);
    } finally {
        await client.close();
    }
});

test('server.json meets the MCP Registry limits and matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    assert.ok(server.description.length <= 100);
    assert.equal(server.name, pkg.mcpName);
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0].identifier, pkg.name);
    assert.equal(server.packages[0].version, pkg.version);
});

test('every adjustment and filter generates a valid script with its defaults', async () => {
    const { ADJUSTMENTS, FILTERS } = await import('../src/tools/adjust.js');
    // Filters with an option that has no default.
    const NEEDS = { displace: { mapFile: `${home}/Documents/map.psd` }, shear: { curve: [[0, 0], [10, 128], [0, 255]] }, custom: { matrix: [...Array(12).fill(0), 1, ...Array(12).fill(0)] } };
    // Adjustments with an option that has no default.
    const ADJ_NEEDS = { curves: { points: [[0, 0], [128, 160], [255, 255]] }, replace_color: { color: '#FF0000' } };
    const calls = [
        ...Object.keys(ADJUSTMENTS).map((adjustment) => ['adjust_layers', { adjustment, options: ADJ_NEEDS[adjustment] ?? {} }]),
        ...Object.keys(FILTERS).map((filter) => ['apply_filter', { filter, target: { ids: [4] }, ...(NEEDS[filter] ? { options: NEEDS[filter] } : {}) }]),
    ];
    const sent = await scriptsFor(calls);
    assert.equal(sent.length, calls.length);
    assert.match(sent[0], /l\.adjustBrightnessContrast\(0, 0\);/);
    assert.ok(sent.some((s) => /l\.applyGaussianBlur\(2\);/.test(s)));
    assert.ok(sent.some((s) => /l\.adjustCurves\(\[\[0,0\],\[128,160\],\[255,255\]\]\);/.test(s)));
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'gaussian_blur', options: { radius: 2, amount: 3 } }), /has no option amount/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'curves' }), /needs options\.points/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'gaussian_blur', options: { radius: 5000 } }), /out of range/);
});

test('saving maps each format to its save options', async () => {
    const [tif, png, jpg, pdf] = await scriptsFor([
        ['save_document', { filePath: `${home}/Documents/a.tif`, compression: 'zip', layers: false }],
        ['save_document', { filePath: `${home}/Documents/a.png`, compression: 9 }],
        ['save_document', { filePath: `${home}/Documents/a.jpg`, quality: 12, format: 'progressive', asCopy: true }],
        ['save_document', { filePath: `${home}/Documents/a.pdf`, preset: '[High Quality Print]', standard: 'x4-2008' }],
    ]);
    assert.match(tif, /new TiffSaveOptions\(\);\no\.imageCompression = TIFFEncoding\.TIFFZIP;\no\.layers = false;/);
    assert.match(png, /o\.compression = 9;/);
    assert.match(jpg, /o\.quality = 12;\no\.formatOptions = FormatOptions\.PROGRESSIVE;/);
    assert.match(jpg, /doc\.saveAs\(target, o, true, Extension\.LOWERCASE\);/);
    assert.match(pdf, /o\.presetFile = "\[High Quality Print\]";\no\.PDFStandard = PDFStandard\.PDFX42008;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.heic` }), /must end in/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.png`, compression: 'lzw' }), /PNG 'compression' is a number/);
});

test('image size follows the aspect ratio and refuses impossible combinations', async () => {
    const [w, res] = await scriptsFor([
        ['resize_image', { width: 1200 }],
        ['resize_image', { resolution: 300, resample: 'none' }],
    ]);
    assert.match(w, /w = 1200;[\s\S]*if \(w !== null && h === null\) h = h0 \* w \/ w0;/);
    assert.match(res, /ResampleMethod\.NONE/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('resize_image', { width: 100, resample: 'none' }), /only the resolution/);
    await assert.rejects(mcp.handleToolCall('resize_image', {}), /Give width/);
});

test('selections: ellipses become fine polygons, and combine modes map to the object model', async () => {
    const [ellipse, sub] = await scriptsFor([
        ['select_area', { shape: 'ellipse', bounds: { x: 0, y: 0, width: 400, height: 200 } }],
        ['select_area', { bounds: { x: 10, y: 10, width: 5, height: 5 }, combine: 'subtract', feather: 2 }],
    ]);
    const pts = JSON.parse(/select\((\[\[.*?\]\]), /.exec(ellipse)[1]);
    assert.ok(pts.length >= 32);
    for (const [x, y] of pts) assert.ok(Math.abs(((x - 200) / 200) ** 2 + ((y - 100) / 100) ** 2 - 1) < 0.01);
    assert.match(sub, /SelectionType\.DIMINISH, 2, true\);/);
});

test('text keeps line breaks as paragraphs and sets paragraph boxes', async () => {
    const [t] = await scriptsFor([['create_text_layer', { text: 'Line one\nLine two', x: 20, y: 40, width: 300, height: 100, font: 'MyriadPro-Bold', size: 36, color: '#112233' }]]);
    assert.match(t, /t\.kind = TextType\.PARAGRAPHTEXT;/);
    assert.match(t, /t\.contents = "Line one\\rLine two";/);
    assert.match(t, /t\.size = new UnitValue\(36, "px"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_text_layer', { text: 'x', x: 0, y: 0, width: 100 }), /width and height/);
});
