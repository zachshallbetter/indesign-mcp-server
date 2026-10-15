import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const L = { indexes: [1] };

/** The literal a script assigns to a variable, parsed. */
function literal(s, name) {
    const m = new RegExp(`${name} = (\\[.*?\\]|\\{.*?\\}|null), `).exec(s);
    assert.ok(m, `${name} not found`);
    return JSON.parse(m[1]);
}

test('set_masks sets mask switches, unlocks while editing and can lock the others', async () => {
    const [s, unlockAll] = await scriptsFor([
        ['set_masks', { layers: L, masks: { indexes: [2] }, mode: 'intersect', color: '#00FF00', rotoBezier: true, motionBlur: 'same_as_layer', featherFalloff: 'smooth', lockOthers: true }],
        ['set_masks', { layers: L, locked: false }],
    ]);
    assert.match(s, /spec = \{"indexes":\[2\]\}/);
    assert.match(s, /m\.maskMode = MaskMode\.INTERSECT;/);
    assert.match(s, /m\.color = \[0,1,0\];/);
    assert.match(s, /m\.rotoBezier = true;/);
    assert.match(s, /m\.maskMotionBlur = MaskMotionBlur\.SAME_AS_LAYER;/);
    assert.match(s, /m\.maskFeatherFalloff = MaskFeatherFalloff\.FFO_SMOOTH;/);
    assert.match(s, /m\.locked = false;[\s\S]*m\.locked = wasLocked;/);
    assert.match(s, /if \(!chosen\[o\]\) parade\.property\(o\)\.locked = true;/);
    assert.match(unlockAll, /spec = \{\}/);
    assert.match(unlockAll, /m\.locked = false;\n {4}list\.push/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_masks', { layers: L }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_masks', { layers: L, motionBlur: 'sometimes' }), /Allowed: same_as_layer, on, off/);
    await assert.rejects(mcp.handleToolCall('set_masks', { layers: L, masks: { indexes: [0] }, inverted: true }), /start at 1/);
});

test('manage_masks deletes from the last mask up, moves the selection and references masks from effects', async () => {
    const [del, next, prev, hide, ref] = await scriptsFor([
        ['manage_masks', { layers: L, action: 'delete' }],
        ['manage_masks', { layers: L, action: 'select_next' }],
        ['manage_masks', { layers: L, action: 'select_previous' }],
        ['manage_masks', { layers: L, action: 'toggle_hide_locked' }],
        ['manage_masks', { layers: L, masks: { names: ['Mask 2'] }, action: 'reference_in_effect', effect: 2 }],
    ]);
    assert.match(del, /ix\.sort\(function \(x, y\) \{ return y - x; \}\);/);
    assert.match(del, /m\.remove\(\);/);
    assert.match(next, /var next = cur >= n \? 1 : cur \+ 1;/);
    assert.match(prev, /var next = cur <= 1 \? n : cur - 1;/);
    assert.match(hide, /app\.executeCommand\(2524\);/);
    assert.match(ref, /property\("ADBE Effect Parade"\)\.property\(2\)/);
    assert.match(ref, /addProperty\("ADBE Effect Mask"\)\.property\("ADBE Effect Path Stream Ref"\)\.setValue\(ms\[j\]\.propertyIndex\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_masks', { layers: L, action: 'reference_in_effect' }), /needs 'effect'/);
    await assert.rejects(mcp.handleToolCall('manage_masks', { layers: L, action: 'shred' }), /Allowed: delete/);
});

test('set_bezier_path edits mask and shape paths: first vertex, direction, transform and feather points', async () => {
    const [mask, shape] = await scriptsFor([
        ['set_bezier_path', { layers: L, mask: 'Mask 1', firstVertex: 2, featherPoints: [{ segment: 1, radius: 25, hold: true, tension: 0.3, inner: true }], allKeyframes: true }],
        ['set_bezier_path', { layers: L, property: ['ADBE Root Vectors Group', 'Shape 1', 'ADBE Vectors Group', 'Path 1', 'ADBE Vector Shape'], reverse: true, transform: { scale: [200, 200], rotation: 90 }, time: 1 }],
    ]);
    const op = literal(mask, 'op');
    assert.equal(op.first, 2);
    assert.deepEqual(op.feather, { featherSegLocs: [1], featherRelSegLocs: [0.5], featherRadii: [25], featherInterps: [1], featherTensions: [0.3], featherTypes: [1], featherRelCornerAngles: [0] });
    assert.match(mask, /property\("ADBE Mask Parade"\)|__parade\(ls\[i\]\)\.property\("Mask 1"\)/);
    assert.match(mask, /p\.setValueAtKey\(k, __editShape\(p\.keyValue\(k\), op\)\)/);
    const op2 = literal(shape, 'op');
    assert.equal(op2.reverse, true);
    assert.deepEqual(op2.xf, { apply: true, anchor: null, rotation: 90, scale: [200, 200], offset: [0, 0] });
    assert.match(shape, /__prop\(ls\[i\], \["ADBE Root Vectors Group","Shape 1","ADBE Vectors Group","Path 1","ADBE Vector Shape"\]\)/);
    assert.match(shape, /t = 1, out/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_bezier_path', { layers: L, reverse: true }), /Give mask/);
    await assert.rejects(mcp.handleToolCall('set_bezier_path', { layers: L, property: ['ADBE Root Vectors Group'], featherPoints: [] }), /masks only/);
    await assert.rejects(mcp.handleToolCall('set_bezier_path', { layers: L, mask: 1 }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_bezier_path', { layers: L, mask: 1, vertices: [[0, 0], [1, 1]], inTangents: [[0, 0]] }), /one entry per vertex/);
    await assert.rejects(mcp.handleToolCall('set_bezier_path', { layers: L, mask: 1, featherPoints: [{ segment: 0, radius: 5, tension: 2 }] }), /tension/);
});

test('add_shape_content builds groups of paths, paint and operations with their settings', async () => {
    const [s] = await scriptsFor([['add_shape_content', {
        layerName: 'Logo',
        items: [{
            type: 'group', name: 'Ring', rotation: 45,
            items: [
                { type: 'ellipse', size: [200, 200] },
                { type: 'stroke', color: '#FF0000', width: 8, lineCap: 'round', dashes: [10, 4], taper: { startWidth: 0, lengthUnits: 'pixels' }, wave: { units: 'cycles', wavelength: 6 } },
                { type: 'merge_paths', mergeMode: 'exclude_intersections' },
                { type: 'zig_zag', amount: 10, pointType: 'smooth' },
                { type: 'wiggle_paths', correlation: 20 },
                { type: 'offset_paths', copies: 3, copyOffset: 2 },
            ],
        }],
    }]]);
    assert.match(s, /c\.layers\.addShape\(\); l\.name = "Logo";/);
    const [ring] = literal(s, 'tree');
    assert.equal(ring.matchName, 'ADBE Vector Group');
    assert.deepEqual(ring.settings, [{ type: 'set', path: ['ADBE Vector Transform Group', 'ADBE Vector Rotation'], value: 45 }]);
    const [ellipse, stroke, merge, zig, wiggle, offset] = ring.items;
    assert.equal(ellipse.matchName, 'ADBE Vector Shape - Ellipse');
    assert.deepEqual(stroke.settings, [
        { type: 'set', path: ['ADBE Vector Stroke Color'], value: [1, 0, 0, 1] },
        { type: 'set', path: ['ADBE Vector Stroke Width'], value: 8 },
        { type: 'set', path: ['ADBE Vector Stroke Line Cap'], value: 2 },
        { type: 'dash', path: ['ADBE Vector Stroke Dashes', 'ADBE Vector Stroke Dash 1'], value: 10 },
        { type: 'dash', path: ['ADBE Vector Stroke Dashes', 'ADBE Vector Stroke Gap 1'], value: 4 },
        { type: 'set', path: ['ADBE Vector Stroke Taper', 'ADBE Vector Taper Start Width'], value: 0 },
        { type: 'set', path: ['ADBE Vector Stroke Taper', 'ADBE Vector Taper Length Units'], value: 2 },
        { type: 'set', path: ['ADBE Vector Stroke Wave', 'ADBE Vector Taper Wave Units'], value: 2 },
        { type: 'set', path: ['ADBE Vector Stroke Wave', 'ADBE Vector Taper Wavelength'], value: 6 },
    ]);
    assert.deepEqual(merge.settings, [{ type: 'set', path: ['ADBE Vector Merge Type'], value: 5 }]);
    assert.deepEqual(zig.settings.map((o) => o.path[0]), ['ADBE Vector Zigzag Size', 'ADBE Vector Zigzag Points']);
    assert.deepEqual(wiggle.settings, [{ type: 'set', path: ['ADBE Vector Correlation'], value: 20 }]);
    assert.deepEqual(offset.settings.map((o) => o.path[0]), ['ADBE Vector Offset Copies', 'ADBE Vector Offset Copy Offset']);
    assert.match(s, /if \(!p\.canAddProperty\(op\.path\[j\]\)\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_shape_content', { items: [{ type: 'fill', width: 3 }] }), /width does not apply to fill/);
    await assert.rejects(mcp.handleToolCall('add_shape_content', { items: [{ type: 'blob' }] }), /Allowed: group, rectangle/);
    await assert.rejects(mcp.handleToolCall('add_shape_content', { items: [{ type: 'stroke', dashes: [1, 2, 3, 4, 5, 6, 7] }] }), /1 to 6 numbers/);
    await assert.rejects(mcp.handleToolCall('add_shape_content', { items: [{ type: 'rectangle', items: [] }] }), /only a group holds items/);
    await assert.rejects(mcp.handleToolCall('add_shape_content', { items: [] }), /1 to 200 items/);
});

test('set_shape_content applies options by item type and refuses options no item takes', async () => {
    const [s] = await scriptsFor([['set_shape_content', { layers: L, group: ['Shape 1', 2], items: ['Stroke 1', 3], width: 4, lineJoin: 'bevel' }]]);
    assert.match(s, /path = \["Shape 1",2\], names = \["Stroke 1",3\]/);
    const byMatch = literal(s, 'byMatch');
    assert.deepEqual(Object.keys(byMatch).sort(), ['ADBE Vector Graphic - G-Stroke', 'ADBE Vector Graphic - Stroke']);
    assert.deepEqual(byMatch['ADBE Vector Graphic - Stroke'][1], { type: 'set', path: ['ADBE Vector Stroke Line Join'], value: 3 });
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_shape_content', { layers: L, items: ['Rectangle 1'], size: [10, 10], width: 2 }), /No shape item takes all of: size, width/);
    await assert.rejects(mcp.handleToolCall('set_shape_content', { layers: L, items: ['Rectangle 1'] }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_shape_content', { layers: L, items: [0], width: 2 }), /indexes start at 1/);
});

test('arrange_shape_content groups, ungroups and converts through the Mask and Shape Path commands', async () => {
    const [group, convert, move] = await scriptsFor([
        ['arrange_shape_content', { layers: L, items: ['Rectangle 1', 'Fill 1'], action: 'group' }],
        ['arrange_shape_content', { layers: L, group: ['Shape 1'], items: ['Rectangle Path 1'], action: 'convert_to_bezier' }],
        ['arrange_shape_content', { layers: L, items: [2], action: 'move', toIndex: 1 }],
    ]);
    assert.match(group, /c\.openInViewer\(\);/);
    assert.match(group, /its\[j\]\.selected = true;[\s\S]*app\.executeCommand\(3741\);/);
    assert.match(convert, /app\.executeCommand\(4162\);/);
    assert.match(move, /its\[0\]\.moveTo\(1\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('arrange_shape_content', { layers: L, items: ['A', 'B'], action: 'move', toIndex: 1 }), /move takes one item/);
    await assert.rejects(mcp.handleToolCall('arrange_shape_content', { layers: L, items: ['A'], action: 'explode' }), /Allowed: delete/);
});

test('create_shapes_from_vector_layer runs Create Shapes from Vector Layer on each selected footage layer', async () => {
    const [s] = await scriptsFor([['create_shapes_from_vector_layer', { layers: { indexes: [3] } }]]);
    assert.match(s, /l\.selected = true;[\s\S]*app\.executeCommand\(3973\);/);
    assert.match(s, /l\.source instanceof FootageItem/);
});

test('select_drawing_tool sets the Tools panel tool and opens paint panels', async () => {
    const [pen, roto, caf] = await scriptsFor([
        ['select_drawing_tool', { tool: 'pen' }],
        ['select_drawing_tool', { tool: 'refine_edge', panel: 'paint' }],
        ['select_drawing_tool', { panel: 'content_aware_fill' }],
    ]);
    assert.match(pen, /app\.project\.toolType = ToolType\.Tool_Pen;/);
    assert.match(roto, /app\.project\.toolType = ToolType\.Tool_Hairbrush;/);
    assert.match(roto, /var id = 3045;/);
    assert.match(caf, /var id = app\.findMenuCommandId\("Content-Aware Fill"\);/);
    assert.doesNotMatch(caf, /toolType/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_drawing_tool', {}), /Give tool, panel or both/);
    await assert.rejects(mcp.handleToolCall('select_drawing_tool', { tool: 'lasso' }), /Allowed: selection/);
});

test('set_paint_strokes keyframes stroke and clone settings found by match name or name', async () => {
    const [s] = await scriptsFor([['set_paint_strokes', { layers: L, strokes: ['Clone 1', 2], end: 0, clonePosition: [10, 20], cloneTimeShift: -1, time: 0.5 }]]);
    const settings = literal(s, 'settings');
    assert.deepEqual(settings, [
        { name: 'end', names: ['ADBE Paint End', 'End'], value: 0 },
        { name: 'clonePosition', names: ['ADBE Paint Clone Position', 'Clone Position'], value: [10, 20] },
        { name: 'cloneTimeShift', names: ['ADBE Paint Clone Time Shift', 'Clone Time Shift'], value: -1 },
    ]);
    assert.match(s, /want = \["Clone 1",2\]/);
    assert.match(s, /__effects\(ls\[i\], "ADBE Paint", null\)/);
    assert.match(s, /p\.setValueAtTime\(t, settings\[k\]\.value\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_paint_strokes', { layers: L }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_paint_strokes', { layers: L, opacity: 150 }), /out of range/);
});

test('set_roto_brush finds settings by name, in the chosen matte group', async () => {
    const [s] = await scriptsFor([['set_roto_brush', { layers: L, effect: 'Roto Brush & Refine Edge', matte: 'refine', settings: { feather: 15, viewMap: true, motionDamping: 40 } }]]);
    const list = literal(s, 'list');
    assert.deepEqual(list[0], { name: 'feather', names: ['Feather'], scope: ['Refine Edge Matte'], value: 15 });
    assert.deepEqual(list[1], { name: 'viewMap', names: ['View Decontamination Map', 'View Map'], scope: [], value: 1 });
    assert.match(s, /__effects\(ls\[i\], "ADBE Samurai", "Roto Brush & Refine Edge"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_roto_brush', { layers: L, settings: { sparkle: 1 } }), /not a Roto Brush setting/);
    await assert.rejects(mcp.handleToolCall('set_roto_brush', { layers: L }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_roto_brush', { layers: L, settings: { viewMap: 'yes' } }), /true or false/);
});

test('mask, shape and paint listings are read-only and destructive tools say so', async () => {
    const { toolDefinitions } = await import('../src/server.js');
    const by = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['list_masks', 'list_shape_content', 'list_paint_strokes']) assert.equal(by[n].readOnlyHint, true, n);
    for (const n of ['manage_masks', 'arrange_shape_content']) assert.equal(by[n].destructiveHint, true, n);
    const [list] = await scriptsFor([['list_masks', { layers: L, paths: true }]]);
    assert.doesNotMatch(list, /beginUndoGroup/);
    assert.match(list, /__maskInfo\(ms\[j\], true\)/);
});
