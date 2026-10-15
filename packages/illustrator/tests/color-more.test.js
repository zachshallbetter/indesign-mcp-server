import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';
import { swatchLibrary, PROOF_SETUPS } from '../src/tools/color.js';

test('swatch options, duplicate, merge and unused swatches use the object model', async () => {
    const [edit, toProcess, dup, merge, unused, current] = await scriptsFor([
        ['edit_swatch', { name: 'Brand Blue', newName: 'Brand Navy', color: 'cmyk(100,80,0,20)' }],
        ['edit_swatch', { name: 'Brand Navy', type: 'process' }],
        ['duplicate_swatches', { names: ['Brand Navy', 'Sky'] }],
        ['merge_swatches', { names: ['Brand Navy', 'Old Blue', 'Blue 2'] }],
        ['find_unused_swatches', {}],
        ['add_current_color', { source: 'stroke', type: 'global' }],
    ]);
    assert.match(edit, /if \(sw\.color\.typename === "SpotColor"\) sw\.color\.spot\.color = nc; else sw\.color = nc;/);
    assert.match(edit, /sw\.color\.spot\.name = "Brand Navy"; else sw\.name = "Brand Navy";/);
    assert.match(toProcess, /var value = __cloneColor\(doc, sw\.color\.spot\.color\);\n {4}sw\.remove\(\);/);
    assert.match(toProcess, /sp\.colorType = want === "spot" \? ColorModel\.SPOT : ColorModel\.PROCESS;/);
    assert.match(dup, /var nm = names\[i\] \+ " copy"/);
    assert.match(dup, /var copy = __copySwatch\(doc, sw, nm, false\)/);
    assert.match(merge, /if \(keepBase\) \{ var n = new SpotColor\(\); n\.spot = keep\.color\.spot; n\.tint = tint; return n; \}/);
    assert.match(merge, /__eachPaint\(doc, swap, counts, true\);/);
    assert.match(merge, /others\[j\]\.remove\(\);/);
    assert.match(unused, /if \(!used\) unused\.push/);
    assert.ok(!/\.remove\(\)/.test(unused.split('var keys = {}')[1]), 'find_unused_swatches deletes nothing');
    assert.match(current, /c = it\.strokeColor;/);
    assert.match(current, /if \(!c\) c = doc\.defaultStrokeColor;/);
    assert.match(current, /sp\.colorType = ColorModel\.PROCESS;/);
});

test('swatch tools refuse bad arguments', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_swatch', { name: 'A' }), /at least one of newName, color, type/);
    await assert.rejects(mcp.handleToolCall('edit_swatch', { name: 'A', color: 'none' }), /colour value/);
    await assert.rejects(mcp.handleToolCall('edit_swatch', { name: 'A', type: 'tint' }), /Allowed: process, global, spot/);
    await assert.rejects(mcp.handleToolCall('duplicate_swatches', { names: [] }), /at least one swatch/);
    await assert.rejects(mcp.handleToolCall('merge_swatches', { names: ['A'] }), /at least one to merge/);
    await assert.rejects(mcp.handleToolCall('merge_swatches', { names: ['A', 'B', 'A'] }), /lists a swatch twice/);
    await assert.rejects(mcp.handleToolCall('add_current_color', { source: 'both' }), /Allowed: fill, stroke/);
    await assert.rejects(mcp.handleToolCall('edit_swatch_group', { name: 'Brand' }), /Give newName, add, delete or deleteGroup/);
    await assert.rejects(mcp.handleToolCall('edit_swatch_group', { name: 'Brand', deleteGroup: true, add: ['A'] }), /give it alone/);
});

test('colour groups: add, delete and delete the group', async () => {
    const [edit, gone] = await scriptsFor([
        ['edit_swatch_group', { name: 'Brand', newName: 'Brand 2', add: ['Sky'], delete: ['Old'] }],
        ['edit_swatch_group', { name: 'Brand', deleteGroup: true }],
    ]);
    assert.match(edit, /inGroup\[dels\[e\]\]\.remove\(\);/);
    assert.match(edit, /__addToGroup\(doc, grp, doc\.swatches\.getByName\(adds\[y\]\)\);/);
    assert.match(edit, /grp\.name = "Brand 2";/);
    assert.match(gone, /members\[r\]\.remove\(\); \}\ngrp\.remove\(\);/);
});

test('swatch libraries: open the panel, load from a library, save as a library', async () => {
    const [open, load, loadFile, save] = await scriptsFor([
        ['open_swatch_library', { library: 'Gradients > Water' }],
        ['load_swatch_library', { library: 'gradients/wood', swatches: ['Wood 1'] }],
        ['load_swatch_library', { filePath: `${home}/Documents/Brand.ai`, replace: true }],
        ['save_swatch_library', { filePath: `${home}/Documents/Brand.ai`, ifExists: 'replace' }],
    ]);
    assert.match(open, /app\.executeMenuCommand\("_Swatch Library Menu Item 78"\);/);
    assert.match(load, /var f = __libraryFile\(\["Gradients","Wood"\]\);/);
    assert.match(load, /res = __copyInto\(doc, lib, \["Wood 1"\], false\);/);
    assert.match(load, /lib\.close\(SaveOptions\.DONOTSAVECHANGES\); doc\.activate\(\);/);
    assert.match(loadFile, /__copyInto\(doc, lib, null, true\)/);
    assert.match(save, /lib = app\.documents\.add\(doc\.documentColorSpace\);/);
    assert.match(save, /lib\.saveAs\(f, new IllustratorSaveOptions\(\)\);/);
    assert.match(save, /res = __copyInto\(lib, doc, null, true\);/);
});

test('swatch library names resolve and bad ones are refused', async () => {
    assert.equal(swatchLibrary('Water').command, '_Swatch Library Menu Item 78');
    assert.equal(swatchLibrary('Color Books > PANTONE+ Solid Coated').name, 'Color Books > PANTONE+ Solid Coated');
    assert.throws(() => swatchLibrary('Seasons'), /Did you mean: Gradients > Seasons; Nature > Seasons/);
    assert.throws(() => swatchLibrary('Other Library...'), /Unknown swatch library/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('load_swatch_library', {}), /Give 'library'/);
    await assert.rejects(mcp.handleToolCall('load_swatch_library', { library: 'Water', filePath: `${home}/a.ai` }), /not both/);
    await assert.rejects(mcp.handleToolCall('load_swatch_library', { library: 'PANTONE+ Solid Coated' }), /colour book/);
    await assert.rejects(mcp.handleToolCall('load_swatch_library', { filePath: `${home}/Documents/a.ase` }), /\.ai\) swatch library/);
    await assert.rejects(mcp.handleToolCall('load_swatch_library', { filePath: '/etc/a.ai' }), /outside|allowed|not permitted/i);
    await assert.rejects(mcp.handleToolCall('save_swatch_library', { filePath: `${home}/Documents/a.ai`, ifExists: 'append' }), /Allowed: error, replace, merge/);
    await assert.rejects(mcp.handleToolCall('open_swatch_library', { library: 'Nope' }), /Unknown swatch library/);
});

test('adjust_colors follows each Edit Colors command', async () => {
    const [sat, bal, comp, web, print, group] = await scriptsFor([
        ['adjust_colors', { operation: 'saturate', target: { selection: true }, amount: 20 }],
        ['adjust_colors', { operation: 'adjust_balance', target: { selection: true }, mode: 'rgb', red: 10, stroke: false }],
        ['adjust_colors', { operation: 'complement', target: { ids: ['a'] } }],
        ['adjust_colors', { operation: 'web_safe', target: { selection: true }, gradients: true }],
        ['adjust_colors', { operation: 'printable', target: { selection: true } }],
        ['adjust_colors', { operation: 'saturate', swatchGroup: 'Brand', amount: -50 }],
    ]);
    assert.match(sat, /var n, f = 1\.2;/);
    assert.match(sat, /n\.cyan = __clamp\(c\.cyan \* f, 100\)/);
    assert.match(sat, /n\.tint = __clamp\(c\.tint \* f, 100\)/);
    assert.match(bal, /n\.red = __clamp\(c\.red \+ 10 \* 2\.55, 255\); n\.green = __clamp\(c\.green \+ 0 \* 2\.55, 255\)/);
    assert.ok(!bal.includes('p.strokeColor = r'), 'stroke: false leaves strokes');
    assert.match(comp, /s = Math\.max\(c\.red, c\.green, c\.blue\) \+ Math\.min\(c\.red, c\.green, c\.blue\);/);
    assert.match(comp, /n\.black = c\.black;/);
    assert.match(web, /Math\.round\(c\.red \/ 51\) \* 51/);
    assert.match(web, /if \(true && !done\.hasOwnProperty\(c\.gradient\.name\)\)/);
    assert.match(print, /app\.convertSampleColor\(ImageColorSpace\.RGB, \[c\.red, c\.green, c\.blue\], ImageColorSpace\.CMYK, ColorConvertPurpose\.defaultpurpose\)/);
    assert.match(group, /var n, f = 0\.5;/);
    assert.match(group, /r = __adjust\(c\.spot\.color\); if \(r\) c\.spot\.color = r;/);
});

test('adjust_colors and overprint_black refuse bad arguments', async () => {
    const mcp = await server();
    const t = { selection: true };
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'saturate', amount: 10 }), /target \(items\) or swatchGroup/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'saturate', target: t, swatchGroup: 'B', amount: 10 }), /not both/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'saturate', target: t }), /needs 'amount'/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'saturate', target: t, amount: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'adjust_balance', target: t, cyan: 5 }), /'mode'/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'adjust_balance', target: t, mode: 'cmyk', red: 5 }), /red do not apply/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'adjust_balance', target: t, mode: 'cmyk' }), /at least one of cyan/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'complement', target: t, amount: 5 }), /applies to saturate/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'hue_shift', target: t }), /Allowed: saturate/);
    await assert.rejects(mcp.handleToolCall('adjust_colors', { operation: 'complement', target: t, fill: false, stroke: false }), /fill, stroke or both/);
    await assert.rejects(mcp.handleToolCall('overprint_black', { target: t, percentage: 120 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('overprint_black', { target: t, fill: false, stroke: false }), /fill, stroke or both/);
});

test('overprint_black sets overprint on qualifying blacks', async () => {
    const [add, remove] = await scriptsFor([
        ['overprint_black', { target: { selection: true }, percentage: 95 }],
        ['overprint_black', { target: { selection: true }, remove: true, stroke: false, includeCmyBlacks: true, includeSpotBlacks: true }],
    ]);
    assert.match(add, /return c\.black >= 95 && \(false \|\| \(c\.cyan === 0 && c\.magenta === 0 && c\.yellow === 0\)\);/);
    assert.match(add, /p\.fillOverprint = true;/);
    assert.match(add, /ca\.overprintStroke = true;/);
    assert.match(remove, /p\.fillOverprint = false;/);
    assert.ok(!remove.includes('p.strokeOverprint'), 'stroke: false leaves strokes');
    assert.match(remove, /if \(true && c\.typename === "SpotColor"\)/);
});

test('apply_gradient places one gradient across objects or along a drag', async () => {
    const [across, drag, lib] = await scriptsFor([
        ['apply_gradient', { target: { selection: true }, gradient: 'Sunset', across: true, angle: 90 }],
        ['apply_gradient', { target: { ids: ['a'] }, gradient: 'Sunset', from: { x: 10, y: 20 }, to: { x: 110, y: 20 }, stroke: true, artboardIndex: 1 }],
        ['apply_gradient', { target: { selection: true }, gradient: 'Water 3', library: 'Gradients > Water' }],
    ]);
    assert.match(across, /var radial = g\.type === GradientType\.RADIAL, ang = 90;/);
    assert.match(across, /fixed = place\(u\);/);
    assert.match(across, /gc\.origin = pl\.origin;\n {2}gc\.angle = pl\.angle;\n {2}gc\.length = pl\.length;/);
    assert.match(across, /list\[k\]\.path\.fillColor = gc;/);
    assert.match(drag, /var ab = __artboard\(doc, 1\), p0 = __toDoc\(doc, ab, 10, 20\), p1 = __toDoc\(doc, ab, 110, 20\);/);
    assert.match(drag, /list\[k\]\.path\.strokeColor = gc;/);
    assert.match(lib, /var f = __libraryFile\(\["Gradients","Water"\]\);/);
    assert.match(lib, /res = __copyInto\(doc, lib, \["Water 3"\], false\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_gradient', { target: { selection: true }, gradient: 'G', from: { x: 0, y: 0 } }), /both 'from' and 'to'/);
    await assert.rejects(mcp.handleToolCall('apply_gradient', { target: { selection: true }, gradient: 'G', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, angle: 30 }), /'angle' or 'from'/);
    await assert.rejects(mcp.handleToolCall('apply_gradient', { target: { selection: true }, gradient: 'G', angle: 400 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_gradient', { target: { selection: true }, gradient: 'G', library: 'Nowhere' }), /Unknown swatch library/);
    await assert.rejects(mcp.handleToolCall('apply_gradient', { gradient: 'G' }), /Choose the items/);
});

test('colour settings and proofing', async () => {
    const [get, byName, byFile, view] = await scriptsFor([
        ['get_color_settings', {}],
        ['load_color_settings', { name: 'North America General Purpose 2' }],
        ['load_color_settings', { filePath: `${home}/Documents/Press.csf` }],
        ['set_color_view', { proofSetup: 'deuteranopia', toggleProofColors: true, toggleGradientAnnotator: true }],
    ]);
    assert.match(get, /var files = app\.colorSettingsList/);
    assert.match(get, /profile: ad\.colorProfileName/);
    assert.ok(!get.includes('var doc = __doc();'), 'works without a document');
    assert.match(byName, /var want = "north america general purpose 2"/);
    assert.match(byName, /app\.loadColorSettings\(f\);/);
    assert.match(byFile, /var f = new File\(".*Press\.csf"\);/);
    assert.match(view, /app\.executeMenuCommand\("proof-colorblindd"\);\napp\.executeMenuCommand\("proofColors"\);\napp\.executeMenuCommand\("Gradient Feedback"\);/);
    assert.equal(Object.keys(PROOF_SETUPS).length, 6);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('load_color_settings', {}), /'name' or 'filePath'/);
    await assert.rejects(mcp.handleToolCall('load_color_settings', { filePath: `${home}/Documents/a.icc` }), /\.csf/);
    await assert.rejects(mcp.handleToolCall('set_color_view', {}), /Give proofSetup/);
    await assert.rejects(mcp.handleToolCall('set_color_view', { proofSetup: 'custom' }), /Allowed: working_cmyk/);
});
