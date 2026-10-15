/**
 * Type options, type conversions, find and replace, Type menu commands, and
 * paths and shapes: generated scripts and argument checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

/** The components array a draw_vector_shape script passes to __subPaths. */
const components = (s) => JSON.parse(/__subPaths\((\[.*?\])\)\); \}\);/.exec(s)[1]);

test('type options map to TextItem members', async () => {
    const [s] = await scriptsFor([['set_type_options', {
        target: { active: true }, antiAlias: 'crisp', orientation: 'vertical', warpOrientation: 'horizontal', kerning: 'optical',
        language: 'brazilian_portuguese', noBreak: true, ligatures: false, discretionaryLigatures: true, oldStyle: true,
        boxWidth: 300, boxHeight: 120, leftIndent: 10, rightIndent: 5, firstLineIndent: -12, spaceBefore: 4, spaceAfter: 8,
        hyphenate: true, hyphenation: { wordsLongerThan: 6, afterFirst: 2, beforeLast: 3, limit: 2, zone: 36, capitalizedWords: false },
        justificationSpacing: { wordSpacing: { minimum: 80, desired: 100, maximum: 133 }, autoLeading: 120 },
        hangingPunctuation: true, composer: 'single_line',
    }]]);
    for (const line of [
        't.antiAliasMethod = AntiAlias.CRISP;', 't.direction = Direction.VERTICAL;', 't.warpDirection = Direction.HORIZONTAL;',
        't.autoKerning = AutoKernType.OPTICAL;', 't.language = Language.BRAZILLIANPORTUGUESE;', 't.noBreak = true;', 't.ligatures = false;',
        't.alternateLigatures = true;', 't.oldStyle = true;', 't.width = new UnitValue(300, "px");', 't.height = new UnitValue(120, "px");',
        't.firstLineIndent = new UnitValue(-12, "px");', 't.spaceAfter = new UnitValue(8, "px");', 't.hyphenation = true;',
        't.hyphenateWordsLongerThan = 6;', 't.hyphenateBeforeLast = 3;', 't.hyphenLimit = 2;', 't.hyphenationZone = new UnitValue(36, "px");',
        't.hyphenateCapitalWords = false;', 't.autoLeadingAmount = 120;', 't.hangingPuntuation = true;', 't.textComposer = TextComposer.ADOBESINGLELINE;',
        '__setScaling(t, ["minimumWordScaling","desiredWordScaling","maximumWordScaling"], [80,100,133]);',
    ]) assert.ok(s.includes(line), line);
    assert.match(s, /is point type: convert it to paragraph type first/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_type_options', { target: { active: true } }), /at least one option/);
    await assert.rejects(mcp.handleToolCall('set_type_options', { target: { active: true }, antiAlias: 'blurry' }), /Allowed: none, sharp/);
    await assert.rejects(mcp.handleToolCall('set_type_options', { target: { active: true }, justificationSpacing: { wordSpacing: { minimum: 120, maximum: 100 } } }), /minimum <= desired <= maximum/);
    await assert.rejects(mcp.handleToolCall('set_type_options', { target: { active: true }, hyphenation: { afterFirst: 30 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_type_options', { antiAlias: 'smooth' }), /Choose the layers/);
});

test('type converts to paragraph, shape, work path or a selection', async () => {
    const [para, shape, path, sel] = await scriptsFor([
        ['convert_type_layer', { target: { ids: [4] }, to: 'paragraph' }],
        ['convert_type_layer', { target: { ids: [4, 5] }, to: 'shape' }],
        ['convert_type_layer', { target: { names: ['Title'] }, to: 'work_path' }],
        ['convert_type_layer', { target: { ids: [4] }, to: 'selection', combine: 'subtract', removeLayer: true }],
    ]);
    assert.match(para, /l\.textItem\.kind = TextType\.PARAGRAPHTEXT;/);
    assert.match(shape, /l\.textItem\.convertToShape\(\);/);
    assert.match(path, /l\.textItem\.createPath\(\);/);
    assert.match(path, /one type layer at a time/);
    assert.match(sel, /wp\.makeSelection\(0, true, i === 0 \? SelectionType\.DIMINISH : SelectionType\.EXTEND\);\n {2}wp\.remove\(\);/);
    assert.match(sel, /l\.remove\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('convert_type_layer', { target: { active: true }, to: 'outline' }), /Allowed: paragraph/);
    await assert.rejects(mcp.handleToolCall('convert_type_layer', { target: { active: true }, to: 'shape', combine: 'add' }), /only to: selection/);
});

test('find and replace runs the findReplace event over all type layers or one', async () => {
    const [all, one] = await scriptsFor([
        ['find_replace_layer_text', { find: 'Summer', replace: 'Winter\nSale', caseSensitive: true }],
        ['find_replace_layer_text', { find: 'a', replace: '', target: { ids: [9] }, wholeWord: true }],
    ]);
    assert.match(all, /app\.executeAction\(app\.stringIDToTypeID\("findReplace"\), d, DialogModes\.NO\);/);
    assert.match(all, /o\.putString\(app\.stringIDToTypeID\("replace"\), "Winter\\rSale"\);/);
    assert.match(all, /o\.putBoolean\(app\.stringIDToTypeID\("checkAll"\), true\);/);
    assert.match(all, /o\.putBoolean\(app\.stringIDToTypeID\("caseSensitive"\), true\);/);
    assert.match(one, /o\.putBoolean\(app\.stringIDToTypeID\("checkAll"\), false\);/);
    assert.match(one, /o\.putBoolean\(app\.stringIDToTypeID\("wholeWord"\), true\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('find_replace_layer_text', { find: '', replace: 'x' }), /non-empty/);
    await assert.rejects(mcp.handleToolCall('find_replace_layer_text', { find: 'x' }), /'replace' must be text/);
});

test('Type menu commands, type panels and filling type with an image', async () => {
    const [update, fonts, panel, fill] = await scriptsFor([
        ['run_type_menu_command', { command: 'update_all_text_layers' }],
        ['run_type_menu_command', { command: 'replace_all_missing_fonts' }],
        ['toggle_type_panels', { panel: 'paragraph_styles' }],
        ['fill_type_with_image', { target: { ids: [2] }, image: { names: ['Photo'] } }],
    ]);
    assert.match(update, /app\.executeAction\(app\.stringIDToTypeID\("updateLayouts"\), new ActionDescriptor\(\), DialogModes\.NO\);/);
    assert.match(fonts, /stringIDToTypeID\("replaceSubstitutes"\)/);
    assert.match(panel, /app\.runMenuItem\(app\.stringIDToTypeID\("toggleParagraphStylesPalette"\)\);/);
    assert.match(fill, /im\.move\(l, ElementPlacement\.PLACEBEFORE\);\nim\.grouped = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_type_menu_command', { command: 'check_spelling' }), /Allowed: update_all_text_layers/);
    await assert.rejects(mcp.handleToolCall('toggle_type_panels', { panel: 'glyphs' }), /Allowed: character/);
    await assert.rejects(mcp.handleToolCall('fill_type_with_image', { target: { ids: [2] }, image: {} }), /Choose the layers/);
});

test('shapes: live rectangles and ellipses, path-built shapes, paths and pixels', async () => {
    const [rect, ellipse, star, path, pixels, custom] = await scriptsFor([
        ['draw_vector_shape', { components: [{ shape: 'rectangle', x: 10, y: 20, width: 200, height: 100, cornerRadius: [8, 8, 0, 0] }], color: '#FF0000', name: 'Button' }],
        ['draw_vector_shape', { components: [{ shape: 'ellipse', x: 0, y: 0, width: 50, height: 50 }] }],
        ['draw_vector_shape', { components: [{ shape: 'star', x: 0, y: 0, width: 100, height: 100, sides: 5, indent: 50 }, { shape: 'polygon', x: 40, y: 40, width: 20, height: 20, sides: 6, operation: 'exclude' }] }],
        ['draw_vector_shape', { mode: 'path', name: 'Outline', components: [{ shape: 'points', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 100 }], closed: false, curve: true }] }],
        ['draw_vector_shape', { mode: 'pixels', opacity: 50, antiAlias: false, components: [{ shape: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, weight: 4 }, { shape: 'triangle', x: 0, y: 0, width: 10, height: 10, operation: 'intersect' }] }],
        ['draw_vector_shape', { components: [{ shape: 'custom', name: 'Heart Card', x: 5, y: 5, width: 60, height: 60 }] }],
    ]);
    assert.match(rect, /__shapeLayer\(color, "rectangle", s\);/);
    assert.match(rect, /s\.putUnitDouble\(__sid\("topLeft"\), __sid\("pixelsUnit"\), 8\);/);
    assert.match(rect, /s\.putUnitDouble\(__sid\("bottomRight"\), __sid\("pixelsUnit"\), 0\);/);
    assert.match(rect, /__bounds4\(new ActionDescriptor\(\), \[10,20,200,100\]\)/);
    assert.match(rect, /l\.name = "Button";/);
    assert.match(ellipse, /__shapeLayer\(color, "ellipse", /);
    assert.match(ellipse, /var color = app\.foregroundColor;/);
    assert.match(custom, /s\.putString\(__sid\("name"\), "Heart Card"\);\nvar l = __shapeLayer\(color, "customShape", s\);/);

    assert.match(star, /tmp\.select\(\); l = __shapeLayer\(color, null, null\);/);
    const [starPts, hex] = components(star);
    assert.equal(starPts.pts.length, 10);
    assert.deepEqual(starPts.pts[0].a, [50, 0]);
    assert.ok(Math.abs(Math.hypot(starPts.pts[1].a[0] - 50, starPts.pts[1].a[1] - 50) - 25) < 1e-9);
    assert.equal(hex.op, 'exclude');
    assert.equal(hex.pts.length, 6);

    assert.match(path, /doc\.pathItems\.add\(__freeName\("Outline"\)/);
    const [curve] = components(path);
    assert.equal(curve.closed, false);
    assert.ok(curve.pts.every((p) => p.smooth));
    assert.deepEqual(curve.pts[1].l, [100, 50 - 100 / 6]);

    assert.match(pixels, /tmp\.fillPath\(app\.foregroundColor, ColorBlendMode\.NORMAL, 50, false, 0, false, true\);/);
    const [line, tri] = components(pixels);
    assert.deepEqual(line.pts.map((p) => p.a), [[0, 2], [100, 2], [100, -2], [0, -2]]);
    assert.equal(tri.op, 'intersect');
    assert.match(pixels, /ResampleMethod\.NONE/);
});

test('rounded rectangles in path mode are built from bezier corners', async () => {
    const [s] = await scriptsFor([['draw_vector_shape', { mode: 'path', components: [{ shape: 'rectangle', x: 0, y: 0, width: 100, height: 40, cornerRadius: 50 }] }]]);
    const [r] = components(s);
    assert.equal(r.pts.length, 8);
    assert.deepEqual(r.pts[0].a, [0, 20]);
    assert.deepEqual(r.pts[1].a, [20, 0]);
});

test('draw_vector_shape refuses incomplete or contradictory shapes', async () => {
    const mcp = await server();
    const call = (args) => mcp.handleToolCall('draw_vector_shape', args);
    await assert.rejects(call({ components: [] }), /at least one shape/);
    await assert.rejects(call({ components: [{ shape: 'blob' }] }), /Allowed: rectangle/);
    await assert.rejects(call({ components: [{ shape: 'rectangle', x: 0, y: 0, width: 0, height: 10 }] }), /out of range/);
    await assert.rejects(call({ components: [{ shape: 'polygon', x: 0, y: 0, width: 10, height: 10, sides: 2 }] }), /3 or more/);
    await assert.rejects(call({ components: [{ shape: 'line', from: { x: 1, y: 1 }, to: { x: 1, y: 1 } }] }), /same point/);
    await assert.rejects(call({ components: [{ shape: 'points', points: [{ x: 1, y: 1 }] }] }), /at least 2 points/);
    await assert.rejects(call({ components: [{ shape: 'points', points: [{ x: 1, y: 1 }, { x: 'a', y: 2 }] }] }), /Invalid number/);
    await assert.rejects(call({ components: [{ shape: 'ellipse', x: 0, y: 0, width: 5, height: 5, operation: 'merge' }] }), /Allowed: combine/);
    await assert.rejects(call({ mode: 'path', color: '#000000', components: [{ shape: 'ellipse', x: 0, y: 0, width: 5, height: 5 }] }), /no colour/);
    await assert.rejects(call({ mode: 'pixels', components: [{ shape: 'custom', name: 'Heart', x: 0, y: 0, width: 5, height: 5 }] }), /custom shape preset/);
    await assert.rejects(call({ components: [{ shape: 'custom', x: 0, y: 0, width: 5, height: 5 }] }), /name a custom shape/);
    await assert.rejects(call({ opacity: 50, components: [{ shape: 'ellipse', x: 0, y: 0, width: 5, height: 5 }] }), /only to mode: pixels/);
});

test('paths: list, Paths panel commands and refusals', async () => {
    const scripts = await scriptsFor([
        ['list_paths', {}],
        ['list_paths', { pathIndex: 1, points: true }],
        ['manage_paths', { action: 'rename', path: 'Path 1', newName: 'Logo' }],
        ['manage_paths', { action: 'duplicate', pathIndex: 0 }],
        ['manage_paths', { action: 'delete', path: 'Old' }],
        ['manage_paths', { action: 'select', path: 'Logo' }],
        ['manage_paths', { action: 'deselect', path: 'Logo' }],
        ['manage_paths', { action: 'make_selection', path: 'Logo', feather: 2, combine: 'intersect' }],
        ['manage_paths', { action: 'make_work_path', tolerance: 1 }],
        ['manage_paths', { action: 'make_clipping_path', path: 'Logo', flatness: 2 }],
        ['manage_paths', { action: 'fill', path: 'Logo', color: 'gray(40)', opacity: 80 }],
        ['manage_paths', { action: 'stroke', path: 'Logo', tool: 'pencil', simulatePressure: true }],
        ['manage_paths', { action: 'define_custom_shape', path: 'Logo', newName: 'Brand mark' }],
        ['manage_paths', { action: 'toggle_panel' }],
    ]);
    const [list, one, rename, dup, del, sel, desel, mksel, work, clip, fill, stroke, define, panel] = scripts;
    assert.match(list, /out\.push\(__pathInfo\(doc\.pathItems\[i\], i, false\)\);/);
    assert.match(one, /__findPath\(\{"index":1\}\)/);
    assert.match(one, /__pathInfo\(path, __pathIndex\(path\), true\)/);
    assert.match(rename, /path\.name = "Logo";/);
    assert.match(dup, /path\.duplicate\(__freeName\(path\.name \+ " copy"\)\)/);
    assert.match(del, /path\.remove\(\);/);
    assert.match(sel, /path\.select\(\);/);
    assert.match(desel, /path\.deselect\(\);/);
    assert.match(mksel, /path\.makeSelection\(2, true, SelectionType\.INTERSECT\);/);
    assert.match(work, /doc\.selection\.makeWorkPath\(1\);/);
    assert.match(clip, /path\.makeClippingPath\(2\);/);
    assert.match(fill, /path\.fillPath\(__color\(\{"kind":"gray","v":\[40\]\}\), ColorBlendMode\.NORMAL, 80, false, 0, true, true\);/);
    assert.match(stroke, /path\.strokePath\(ToolType\.PENCIL, true\);/);
    assert.match(define, /app\.executeAction\(app\.stringIDToTypeID\("defineCustomShape"\), d, DialogModes\.NO\);/);
    assert.match(panel, /app\.runMenuItem\(app\.stringIDToTypeID\("togglePathsPalette"\)\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_paths', { action: 'rename', path: 'Logo' }), /needs newName/);
    await assert.rejects(mcp.handleToolCall('manage_paths', { action: 'select' }), /Choose the path/);
    await assert.rejects(mcp.handleToolCall('manage_paths', { action: 'select', path: 'A', pathIndex: 0 }), /not both/);
    await assert.rejects(mcp.handleToolCall('manage_paths', { action: 'make_work_path', tolerance: 20 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('manage_paths', { action: 'stroke', path: 'Logo', tool: 'airbrush' }), /Allowed: brush/);
});

test('anchor point edits rebuild the path under its name', async () => {
    const [split, insert, del, move, smooth, cornerPt, op] = await scriptsFor([
        ['edit_path_points', { path: 'Logo', operation: 'add_point', point: 1 }],
        ['edit_path_points', { path: 'Logo', component: 1, operation: 'add_point', point: 2, x: 5, y: 6, smooth: true }],
        ['edit_path_points', { pathIndex: 0, operation: 'delete_point', point: 3 }],
        ['edit_path_points', { path: 'Logo', operation: 'move_point', point: 0, x: 10, y: 12, handleOut: { x: 20, y: 12 } }],
        ['edit_path_points', { path: 'Logo', operation: 'convert_point', point: 2, kind: 'smooth' }],
        ['edit_path_points', { path: 'Logo', operation: 'convert_point', point: 2, kind: 'corner' }],
        ['edit_path_points', { path: 'Logo', operation: 'set_operation', pathOperation: 'subtract' }],
    ]);
    assert.match(split, /s\.pts\.splice\(1 \+ 1, 0, \{ a: mid\(r0, r1\), l: r0, r: r1, smooth: true \}\);/);
    assert.match(split, /fresh = doc\.pathItems\.add\(__freeName\(name \+ " edit"\), __subPaths\(comps\)\);\n {2}path\.remove\(\);\n {2}fresh\.name = name;/);
    assert.match(split, /if \(wasClipping\) rebuilt\.makeClippingPath\(\);/);
    assert.match(insert, /var s = comps\[1\];/);
    assert.match(insert, /s\.pts\.splice\(2, 0, \{"a":\[5,6\],"l":\[5,6\],"r":\[5,6\],"smooth":true\}\);/);
    assert.match(del, /s\.pts\.splice\(3, 1\);/);
    assert.match(move, /p\.a = \[10,12\];[\s\S]*p\.r = \[20,12\];/);
    assert.match(smooth, /p\.smooth = true;[\s\S]*var tx = /);
    assert.match(cornerPt, /p\.l = \[p\.a\[0\], p\.a\[1\]\]; p\.r = \[p\.a\[0\], p\.a\[1\]\]; p\.smooth = false;/);
    assert.match(op, /s\.op = "subtract";/);

    const mcp = await server();
    const call = (args) => mcp.handleToolCall('edit_path_points', { path: 'Logo', ...args });
    await assert.rejects(call({ operation: 'twist' }), /Allowed: add_point/);
    await assert.rejects(call({ operation: 'move_point', point: 0 }), /needs x and y/);
    await assert.rejects(call({ operation: 'add_point', point: 0, x: 4 }), /Invalid number for 'y'|both x and y/);
    await assert.rejects(call({ operation: 'convert_point', point: 0, kind: 'cusp' }), /Allowed: smooth, corner/);
    await assert.rejects(call({ operation: 'set_operation' }), /Allowed: combine/);
    await assert.rejects(mcp.handleToolCall('edit_path_points', { operation: 'delete_point', point: 0 }), /Choose the path/);
});
