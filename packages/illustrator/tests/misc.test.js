/**
 * Graphs, clipping masks, meshes, blend spines and text, trapping, flattening,
 * prepress views and document ink options.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('graphs are listed with their graph variable and redrawn from a data set', async () => {
    const [list, load, show] = await scriptsFor([
        ['list_graphs', {}],
        ['apply_graph_data', { filePath: `${home}/Documents/sales.xml`, dataSet: 'Q2' }],
        ['apply_graph_data', { index: 1 }],
    ]);
    assert.match(list, /doc\.graphItems\[i\]/);
    assert.match(list, /v = gi\.contentVariable;/);
    assert.match(load, /doc\.importVariables\(f\);[\s\S]*ds = doc\.dataSets\.getByName\("Q2"\);[\s\S]*ds\.display\(\);/);
    assert.match(load, /if \(doc\.variablesLocked\) throw/);
    assert.doesNotMatch(show, /importVariables/);
    assert.match(show, /var at = 1;[\s\S]*ds = doc\.dataSets\[at\];\nds\.display\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_graph_data', { dataSet: 'Q2', index: 0 }), /not both/);
    await assert.rejects(mcp.handleToolCall('apply_graph_data', { filePath: `${home}/Documents/sales.csv` }), /must end in \.xml/);
    await assert.rejects(mcp.handleToolCall('apply_graph_data', { filePath: '/etc/sales.xml' }), /outside|allowed|not allowed/i);
});

test('clipping masks: release, edit, add, draw inside and remove', async () => {
    const [release, mask, contents, add, remove] = await scriptsFor([
        ['release_clipping_mask', { target: { ids: ['g1'] } }],
        ['edit_clipping_mask', { target: { ids: ['g1'] }, part: 'mask' }],
        ['edit_clipping_mask', { target: { ids: ['g1'] }, part: 'contents' }],
        ['add_to_clipping_mask', { containerId: 'p1', target: { ids: ['a', 'b'] } }],
        ['remove_from_clipping_mask', { target: { ids: ['a'] } }],
    ]);
    assert.match(release, /__clipGroup\(items\[i\], "Release"\);[\s\S]*app\.executeMenuCommand\("releaseMask"\);/);
    assert.match(mask, /\n {2}picked\.push\(mask\);\n/);
    assert.doesNotMatch(mask, /g\.pageItems\[c\] !== mask/);
    assert.match(contents, /if \(g\.pageItems\[c\] !== mask\) picked\.push\(g\.pageItems\[c\]\);/);
    assert.match(add, /g = c\.parent\.groupItems\.add\(\);\n {2}g\.move\(c, ElementPlacement\.PLACEBEFORE\);\n {2}c\.move\(g, ElementPlacement\.PLACEATBEGINNING\);\n {2}g\.clipped = true;/);
    assert.match(add, /items\[j\]\.move\(mask, ElementPlacement\.PLACEAFTER\);/);
    assert.match(remove, /items\[k\]\.move\(items\[k\]\.parent, ElementPlacement\.PLACEBEFORE\);/);
    assert.match(remove, /if \(__isMask\(items\[i\]\)\) throw/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_clipping_mask', { target: { ids: ['g1'] }, part: 'outline' }), /mask or contents/);
    await assert.rejects(mcp.handleToolCall('add_to_clipping_mask', { target: { ids: ['a'] } }), /Give containerId/);
    await assert.rejects(mcp.handleToolCall('release_clipping_mask', { target: {} }), /Choose the items/);
});

test('meshes are listed', async () => {
    const [s] = await scriptsFor([['list_meshes', {}]]);
    assert.match(s, /doc\.meshItems\.length/);
});

test('blends: replace spine selects the blend and the path; outlineText outlines text first', async () => {
    const [spine, text, plain] = await scriptsFor([
        ['replace_blend_spine', { blendId: 'b1', pathId: 'p1' }],
        ['make_blend', { target: { ids: ['t1', 't2'] }, outlineText: true, steps: 10 }],
        ['make_blend', { target: { ids: ['t1', 't2'] } }],
    ]);
    assert.match(spine, /blend\.selected = true;\nspine\.selected = true;\napp\.executeMenuCommand\("Path Blend Replace Spine"\);/);
    assert.match(spine, /if \(spine\.typename !== "PathItem"\)/);
    assert.match(text, /if \(true\) for[^\n]*items\[t\] = items\[t\]\.createOutline\(\);[\s\S]*Path Blend Make/);
    assert.match(plain, /if \(false\) for/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('replace_blend_spine', { blendId: 'b1' }), /Give blendId and pathId/);
    await assert.rejects(mcp.handleToolCall('replace_blend_spine', { blendId: 'x', pathId: 'x' }), /must be different/);
});

test('trap strokes overprint in the fill colour', async () => {
    const [round, square] = await scriptsFor([
        ['make_trap_stroke', { target: { selection: true }, weight: 0.6 }],
        ['make_trap_stroke', { target: { selection: true }, round: false }],
    ]);
    assert.match(round, /p\.strokeColor = p\.fillColor;\n {2}p\.strokeWidth = 0\.6;\n {2}p\.strokeCap = StrokeCap\.ROUNDENDCAP; p\.strokeJoin = StrokeJoin\.ROUNDENDJOIN;\n {2}p\.strokeOverprint = true;/);
    assert.match(square, /p\.strokeWidth = 0\.5;\n {2}\n {2}p\.strokeOverprint = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('make_trap_stroke', { target: { selection: true }, weight: 100 }), /out of range/);
});

test('flatten_transparency plays the recorded event with the resolution given, then unloads it', async () => {
    const [s] = await scriptsFor([['flatten_transparency', { target: { selection: true }, resolution: 600 }]]);
    assert.match(s, /\/internalName \(ai_plugin_flatten_transparency\)/);
    assert.match(s, /\/key 1919253100\\n\\t\\t\\t\/showInPalette 4294967295\\n\\t\\t\\t\/type \(unit real\)\\n\\t\\t\\t\/value 600\.0\\n\\t\\t\\t\/unit 592342629/);
    assert.match(s, /\/showDialog 0/);
    assert.match(s, /app\.doScript\("flattenTransparency", "adobe-mcp-flatten"\);\n\} finally \{\n {2}try \{ app\.unloadAction\("adobe-mcp-flatten", ""\); \} catch \(e\) \{\}/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('flatten_transparency', { target: { selection: true }, resolution: 20 }), /out of range/);
});

test('prepress views: print tiling is set from its state, the others switch', async () => {
    const [tiles, toggleTiles, overprint, seps] = await scriptsFor([
        ['toggle_prepress_view', { view: 'print_tiling', show: false }],
        ['toggle_prepress_view', { view: 'print_tiling' }],
        ['toggle_prepress_view', { view: 'overprint_preview' }],
        ['toggle_prepress_view', { view: 'separations_preview' }],
    ]);
    assert.match(tiles, /var before = doc\.printTiles;\nif \(before !== false\) app\.executeMenuCommand\("pagetiling"\);/);
    assert.match(toggleTiles, /if \(true\) app\.executeMenuCommand\("pagetiling"\);/);
    assert.match(overprint, /app\.executeMenuCommand\("ink"\);/);
    assert.match(seps, /app\.executeMenuCommand\("Adobe Separation Preview Panel"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('toggle_prepress_view', { view: 'overprint_preview', show: true }), /print_tiling only/);
    await assert.rejects(mcp.handleToolCall('toggle_prepress_view', { view: 'trapping' }), /Allowed: overprint_preview/);
});

test('print_document sets document ink options on the separation options', async () => {
    const [s] = await scriptsFor([['print_document', {
        outputFile: `${home}/Documents/seps.ps`,
        output: { mode: 'separations', inks: [{ name: 'Process Black', status: 'skip' }, { name: 'PANTONE 185 C', status: 'convert', frequency: 150, angle: 45 }] },
    }]]);
    assert.match(s, /o\.colorSeparationOptions = new PrintColorSeparationOptions\(\);/);
    assert.match(s, /__ink\("Process Black"\)\.printingStatus = InkPrintStatus\.DISABLEINK;/);
    assert.match(s, /__ink\("PANTONE 185 C"\)\.printingStatus = InkPrintStatus\.CONVERTINK;\n__ink\("PANTONE 185 C"\)\.frequency = 150;\n__ink\("PANTONE 185 C"\)\.angle = 45;/);
    assert.match(s, /o\.colorSeparationOptions\.inkList = __inks;/);
    const mcp = await server();
    const call = (inks) => mcp.handleToolCall('print_document', { outputFile: `${home}/Documents/seps.ps`, output: { inks } });
    await assert.rejects(call([]), /at least one ink/);
    await assert.rejects(call([{ status: 'skip' }]), /needs a name/);
    await assert.rejects(call([{ name: 'Process Cyan' }]), /give status, frequency or angle/);
    await assert.rejects(call([{ name: 'Process Cyan', status: 'off' }]), /Allowed: print, skip, convert/);
    await assert.rejects(call([{ name: 'Process Cyan', dotShape: 'round' }]), /has no option dotShape/);
});

test('select_tool knows the graph, mesh, blend and print tiling tools', async () => {
    const sent = await scriptsFor([
        ['select_tool', { tool: 'Column Graph Tool' }],
        ['select_tool', { tool: 'Mesh Tool' }],
        ['select_tool', { tool: 'Print Tiling Tool' }],
        ['select_tool', { tool: 'Blend Tool' }],
    ]);
    assert.deepEqual(sent.map((s) => s.match(/app\.selectTool\("([^"]+)"\)/)[1]), ['Adobe Column Graph Tool', 'Adobe Mesh Editing Tool', 'Adobe Page Tool', 'Adobe Blend Tool']);
});
