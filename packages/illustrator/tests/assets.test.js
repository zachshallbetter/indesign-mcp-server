import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';
import { toolDefinitions } from '../src/server.js';

const folder = path.join(home, 'Documents', 'screens');

test('export_for_screens exports assets, the full document and artboards with the scale type given', async () => {
    const [assets, all, doc] = await scriptsFor([
        ['export_for_screens', { outputFolder: folder, assets: [3, 7], formats: ['png', 'jpg20'], scales: [512, 1024], scaleBy: 'width' }],
        ['export_for_screens', { outputFolder: folder }],
        ['export_for_screens', { outputFolder: folder, fullDocument: true, artboards: '2', formats: ['svg'], openFolder: true }],
    ]);
    assert.match(assets, /item\.artboards = "";/, 'only the assets when no artboards are asked for');
    assert.match(assets, /var assetIds = \[3,7\];/);
    assert.match(assets, /doc\.assets\.getByID\(assetIds\[ai\]\)/);
    assert.match(assets, /item\.assets = assetIds;/);
    assert.match(assets, /ExportForScreensScaleType\.SCALEBYWIDTH/);
    assert.match(assets, /tags = \["512w-","1024w-"\]/);
    assert.match(assets, /"SE_JPEG20"/);
    assert.match(all, /item\.artboards = "all";/);
    assert.match(all, /item\.document = false;/);
    assert.match(all, /ExportForScreensScaleType\.SCALEBYFACTOR/);
    assert.doesNotMatch(all, /folder\.execute\(\)/);
    assert.match(doc, /item\.artboards = "2";/);
    assert.match(doc, /item\.document = true;/);
    assert.match(doc, /folder\.execute\(\);/);
});

test('export_for_screens applies Advanced Settings to the matching format only', async () => {
    const [s] = await scriptsFor([['export_for_screens', {
        outputFolder: folder,
        formats: ['png', 'jpg', 'svg', 'pdf'],
        advanced: {
            png: { antiAliasing: 'type', backgroundBlack: true },
            jpeg: { compression: 'progressive', scans: 4 },
            svg: { styling: 'presentation_attributes', decimals: 3, responsive: false },
            pdf: { preset: '[Smallest File Size]' },
        },
    }]]);
    assert.match(s, /if \(fmt === "SE_PNG24"\) \{ o\.antiAliasing = AntiAliasingMethod\.TYPEOPTIMIZED; o\.backgroundBlack = true; \}/);
    assert.match(s, /if \(fmt\.indexOf\("SE_JPEG"\) === 0\) \{ o\.compressionMethod = JPEGCompressionMethodType\.PROGRESSIVE; o\.progressiveScan = 4; \}/);
    assert.match(s, /o\.cssProperties = SVGCSSPropertyLocation\.PRESENTATIONATTRIBUTES; o\.coordinatePrecision = 3; o\.svgResponsive = false;/);
    assert.match(s, /var preset = "\[Smallest File Size\]"/);
    assert.match(s, /o\.pdfPreset = preset;/);
    assert.match(s, /__advanced\(formats\[f\], opts\);/);
});

test('export_for_screens refuses bad scales, assets and advanced settings', async () => {
    const mcp = await server();
    const call = (args) => mcp.handleToolCall('export_for_screens', { outputFolder: folder, ...args });
    await assert.rejects(call({ scaleBy: 'height' }), /Give scales for scaleBy height/);
    await assert.rejects(call({ scales: [20] }), /out of range \[0\.1, 10\]/);
    await assert.rejects(call({ scaleBy: 'resolution', scales: [5000] }), /out of range \[1, 2400\]/);
    await assert.rejects(call({ scales: [] }), /non-empty list/);
    await assert.rejects(call({ assets: ['hero'] }), /Invalid index for 'assets'/);
    await assert.rejects(call({ formats: ['obj'] }), /Allowed: png/);
    await assert.rejects(call({ advanced: { gif: {} } }), /has no format gif/);
    await assert.rejects(call({ advanced: { png: { quality: 3 } } }), /'advanced\.png' has no option quality/);
    await assert.rejects(call({ advanced: { jpeg: { compression: 'lossless' } } }), /Allowed: baseline, optimized, progressive/);
    await assert.rejects(call({ advanced: { svg: { decimals: 9 } } }), /out of range \[1, 7\]/);
});

test('assets are collected, listed, renamed and removed through Document.assets', async () => {
    const [list, single, multiple, rename, remove, removeAll] = await scriptsFor([
        ['list_assets', {}],
        ['collect_assets', { target: { ids: ['a', 'b'] }, names: ['Hero'] }],
        ['collect_assets', { target: { selection: true }, as: 'multiple' }],
        ['rename_asset', { id: 4, name: 'Logo "dark"' }],
        ['remove_assets', { ids: [4, 5] }],
        ['remove_assets', { all: true }],
    ]);
    assert.match(list, /__assetInfo\(doc\.assets\[i\]\)/);
    assert.match(list, /s\.getNormalizedName\(\)/);
    assert.match(single, /doc\.assets\.add\(items\.length === 1 \? items\[0\] : items\)/);
    assert.match(single, /if \(true\) \{/);
    assert.match(multiple, /if \(false\) \{/);
    assert.match(multiple, /doc\.assets\.add\(items\[i\]\)/);
    assert.match(rename, /doc\.assets\.getByID\(4\)/);
    assert.match(rename, /s\.assetName = "Logo \\"dark\\"";/);
    assert.match(remove, /var ids = \[4,5\]/);
    assert.match(remove, /found\[j\]\.remove\(\);/);
    assert.match(removeAll, /doc\.assets\.removeAll\(\);/);
});

test('asset tools refuse what they cannot do', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('collect_assets', { target: { selection: true }, names: ['a', 'b'] }), /single asset takes one name/);
    await assert.rejects(mcp.handleToolCall('collect_assets', { target: { selection: true }, as: 'many' }), /Allowed: single, multiple/);
    await assert.rejects(mcp.handleToolCall('collect_assets', {}), /Choose the items/);
    await assert.rejects(mcp.handleToolCall('rename_asset', { id: 1, name: ' ' }), /Give 'name'/);
    await assert.rejects(mcp.handleToolCall('rename_asset', { id: -1, name: 'x' }), /Invalid index for 'id'/);
    await assert.rejects(mcp.handleToolCall('remove_assets', {}), /Give ids/);
    await assert.rejects(mcp.handleToolCall('remove_assets', { ids: [1], all: true }), /not both/);
});

test('export_selection writes PNG or Illustrator files only', async () => {
    const [png, ai] = await scriptsFor([
        ['export_selection', { outputFile: path.join(home, 'Documents', 'sel.png'), target: { ids: ['x'] } }],
        ['export_selection', { outputFile: path.join(home, 'Documents', 'sel.ai') }],
    ]);
    assert.match(png, /doc\.exportSelectionAsPNG\(f\);/);
    assert.match(png, /__targets\(doc, \{"ids":\["x"\]\}\)/);
    assert.match(ai, /doc\.exportSelectionAsAi\(f\);/);
    assert.match(ai, /Nothing is selected/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('export_selection', { outputFile: path.join(home, 'Documents', 'sel.jpg') }), /\.png or \.ai/);
    await assert.rejects(mcp.handleToolCall('export_selection', { outputFile: '/etc/sel.png' }));
});

test('slice commands run without dialogs, and create_region slices a rectangle', async () => {
    const actions = ['make', 'release', 'create_from_selection', 'create_from_guides', 'duplicate', 'combine', 'clip_to_artboard', 'delete_all', 'toggle_visibility', 'toggle_lock'];
    const sent = await scriptsFor([
        ...actions.map((action) => ['edit_slices', { action, target: { ids: ['s1'] } }]),
        ['edit_slices', { action: 'create_region', x: 10, y: 20, width: 300, height: 100, artboardIndex: 1 }],
        ['list_slices', {}],
    ]);
    const commands = ['AISlice Make Slice', 'AISlice Release Slice', 'AISlice Create from Selection', 'AISlice Create from Guides', 'AISlice Duplicate', 'AISlice Combine',
        'AISlice Clip to Artboard', 'AISlice Delete All Slices', 'AISlice Feedback Menu', 'AISlice Lock Menu'];
    commands.forEach((c, i) => assert.ok(sent[i].includes(`app.executeMenuCommand("${c}");`), c));
    for (const s of sent) assert.doesNotMatch(s, /AISlice Divide|AISlice Slice Options|Save Selected Slices/);
    assert.match(sent[0], /make acts on the selection/);
    assert.doesNotMatch(sent[7], /acts on the selection/);
    const region = sent[actions.length];
    assert.match(region, /__artboard\(doc, 1\)/);
    assert.match(region, /__toDoc\(doc, ab, 10, 20\)/);
    assert.match(region, /pathItems\.rectangle\(tl\[1\], tl\[0\], __len\(doc, 300\), __len\(doc, 100\)\)/);
    assert.match(region, /app\.executeMenuCommand\("AISlice Create from Selection"\);\nbox\.remove\(\);/);
    assert.match(sent[actions.length + 1], /on = it\.sliced;/);
    assert.match(sent[actions.length + 1], /doc\.layers\[j\]\.sliced/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_slices', { action: 'divide' }), /Allowed: make/);
    await assert.rejects(mcp.handleToolCall('edit_slices', { action: 'create_region', x: 0, y: 0, width: 10 }), /'height' is missing/);
    await assert.rejects(mcp.handleToolCall('edit_slices', { action: 'create_region', x: 0, y: 0, width: 0, height: 10 }), /out of range/);
});

test('set_item_url sets PageItem.URL and refuses control characters', async () => {
    const [set, clear] = await scriptsFor([
        ['set_item_url', { target: { names: ['Buy'] }, url: 'https://example.com/a?b="c"' }],
        ['set_item_url', { target: { selection: true }, url: '' }],
    ]);
    assert.match(set, /items\[i\]\.URL = "https:\/\/example\.com\/a\?b=\\"c\\"";/);
    assert.match(clear, /items\[i\]\.URL = "";/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_item_url', { target: { selection: true }, url: 'a\nb' }), /control characters/);
    await assert.rejects(mcp.handleToolCall('set_item_url', { target: { selection: true }, url: 'x'.repeat(3000) }), /longer than 2048/);
});

test('asset and slice tools carry the right annotations', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['list_assets', 'list_slices']) assert.equal(byName[n].readOnlyHint, true, n);
    for (const n of ['remove_assets', 'edit_slices']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['collect_assets', 'set_item_url', 'export_selection']) assert.equal(byName[n].destructiveHint, false, n);
});
