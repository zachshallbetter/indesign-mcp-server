/**
 * Transformations, paths and pathfinder tools: the object-model statements
 * their scripts carry, and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];

await test('transform_items scales, shears, rotates, applies a matrix and moves in order', async () => {
    const s = await one('transform_items', {
        target: T, scaleX: 150, shearAngle: 20, rotate: 30, matrix: [1, 0, 0, 1, 25.4, 0], move: { x: 5, y: -2 }, referencePoint: 'top_left',
    });
    assert.match(s, /app\.transformationMatrices\.add\(\{"horizontalScaleFactor":1\.5,"verticalScaleFactor":1\}\)/);
    assert.match(s, /add\(\{"clockwiseShearAngle":20\}\)/);
    assert.match(s, /add\(\{"counterclockwiseRotationAngle":30\}\)/);
    assert.match(s, /"matrixValues":\[1,0,0,1,72,0\]/);
    assert.match(s, /\{"fx":0,"fy":0,"page":-1,"x":0,"y":0\}, false/);
    assert.match(s, /items\[mi\]\.move\(undefined, \[5, -2\]\);/);
    assert.match(s, /items\[i\]\.transform\(cs, \[each \? __tfOrigin\(doc, \[items\[i\]\], ref\) : o, cs\], m\);/);
    assert.match(s, /resolve\(\[AnchorPoint\.TOP_LEFT_ANCHOR, bk, cs\], cs\)/);
    assert.ok(s.indexOf('horizontalScaleFactor') < s.indexOf('clockwiseShearAngle'), 'scale before shear');
    assert.ok(s.indexOf('counterclockwiseRotationAngle') < s.indexOf('matrixValues'), 'rotate before matrix');
    assert.doesNotMatch(s, /duplicate\(\)/);
});

await test('transform_items copies, shears vertically, moves by distance and angle and redefines scaling', async () => {
    const s = await one('transform_items', {
        target: T, scale: 50, shearAngle: 10, shearAxis: 'vertical', move: { distance: 10, angle: 90 }, moveContent: true,
        referenceAt: { pageIndex: 1, x: 25.4, y: 0 }, each: true, copy: true, redefineScaling: true,
    });
    assert.match(s, /items\.push\(__src\[ci\]\.duplicate\(\)\);/);
    assert.match(s, /"horizontalScaleFactor":0\.5,"verticalScaleFactor":0\.5/);
    assert.match(s, /var __sv = __q\.invertMatrix\(\)\.catenateMatrix\(app\.transformationMatrices\.add\(\{"clockwiseShearAngle":10\}\)\)\.catenateMatrix\(__q\);/);
    assert.match(s, /\{"fx":0,"fy":0,"page":1,"x":72,"y":0\}, true/);
    assert.match(s, /mc\.move\(undefined, \[0, -10\]\);/);
    assert.match(s, /items\[ri\]\.redefineScaling\(\[1, 1\]\);/);
});

await test('transform_items refuses bad arguments', () => {
    const tr = tool('transform_items').handler;
    assert.throws(() => tr({ target: T }), /Nothing to do/);
    assert.throws(() => tr({ target: {}, rotate: 10 }), /Choose the items/);
    assert.throws(() => tr({ target: T, scale: 50, scaleX: 20 }), /not both/);
    assert.throws(() => tr({ target: T, scale: 0 }), /must not be 0/);
    assert.throws(() => tr({ target: T, rotate: 400 }), /out of range/);
    assert.throws(() => tr({ target: T, shearAngle: 90 }), /out of range/);
    assert.throws(() => tr({ target: T, shearAxis: 'vertical' }), /needs shearAngle/);
    assert.throws(() => tr({ target: T, shearAngle: 5, shearAxis: 'diagonal' }), /Allowed: horizontal, vertical/);
    assert.throws(() => tr({ target: T, matrix: [1, 0, 0, 1] }), /\[a, b, c, d, tx, ty\]/);
    assert.throws(() => tr({ target: T, move: { x: 1, distance: 3 } }), /give x and\/or y, or distance and angle/);
    assert.throws(() => tr({ target: T, move: { distance: 3 } }), /both distance and angle/);
    assert.throws(() => tr({ target: T, move: { z: 3 } }), /Unknown option 'move\.z'/);
    assert.throws(() => tr({ target: T, moveContent: true }), /needs move/);
    assert.throws(() => tr({ target: T, rotate: 5, referencePoint: 'middle' }), /Allowed: top_left/);
    assert.throws(() => tr({ target: T, rotate: 5, referencePoint: 'center', referenceAt: { pageIndex: 0, x: 0, y: 0 } }), /not both/);
    assert.throws(() => tr({ target: T, rotate: 5, referenceAt: { pageIndex: -1, x: 0, y: 0 } }), /Invalid index/);
    assert.throws(() => tr({ target: T, rotate: 5, copy: 'yes' }), /true or false/);
});

await test('nudge_items nudges by the cursor key increment and steps scale and size', async () => {
    const [n, sc, sz] = await scriptsFor([
        ['nudge_items', { target: T, action: 'nudge_left', step: 'coarse', times: 2 }],
        ['nudge_items', { target: T, action: 'scale_up' }],
        ['nudge_items', { target: T, action: 'size_down', step: 'coarse', referencePoint: 'bottom_right' }],
    ]);
    assert.match(n, /var inc = Number\(doc\.viewPreferences\.cursorKeyIncrement\) \* 20;/);
    assert.match(n, /items\[i\]\.move\(undefined, \[-1 \* inc, 0 \* inc\]\);/);
    assert.match(sc, /"horizontalScaleFactor":1\.01,"verticalScaleFactor":1\.01/);
    assert.match(sz, /AnchorPoint\.BOTTOM_RIGHT_ANCHOR, ResizeMethods\.MULTIPLYING_CURRENT_DIMENSIONS_BY, \[0\.95, 0\.95\]/);
    const nudge = tool('nudge_items').handler;
    assert.throws(() => nudge({ target: T, action: 'spin' }), /Allowed: nudge_up/);
    assert.throws(() => nudge({ target: T, action: 'scale_up', step: 'fine' }), /applies only to nudging/);
    assert.throws(() => nudge({ target: T, action: 'nudge_up', referencePoint: 'center' }), /not nudging/);
    assert.throws(() => nudge({ target: T, action: 'nudge_up', times: 0 }), /at least 1/);
    assert.throws(() => nudge({ target: T, action: 'nudge_up', times: 500 }), /Invalid index/);
});

await test('transform_again calls the chosen Transform Again method', async () => {
    const s = await one('transform_again', { target: T, mode: 'sequence_again_individually', times: 3 });
    assert.match(s, /for \(var n = 0; n < 3; n\+\+\)/);
    assert.match(s, /items\[i\]\.transformSequenceAgainIndividually\(\);/);
    assert.throws(() => tool('transform_again').handler({ target: T, mode: 'twice' }), /Allowed: again/);
});

await test('align_items aligns and distributes to the chosen bounds', async () => {
    const [a, b, c] = await scriptsFor([
        ['align_items', { target: T, align: 'left', alignTo: 'page' }],
        ['align_items', { target: { selection: true }, distribute: 'horizontal_space', spacing: 4, keyObject: 9 }],
        ['align_items', { target: { selection: true }, align: 'vertical_centers', alignTo: 'key_object' }],
    ]);
    assert.match(a, /var bounds = AlignDistributeBounds\.PAGE_BOUNDS;/);
    assert.match(a, /doc\.align\(items, AlignOptions\.LEFT_EDGES, bounds\);/);
    assert.match(b, /var bounds = AlignDistributeBounds\.KEY_OBJECT;/);
    assert.match(b, /var key = __item\(doc, 9\);/);
    assert.match(b, /doc\.selectionKeyObject = key;/);
    assert.match(b, /doc\.distribute\(items, DistributeOptions\.HORIZONTAL_SPACE, bounds, true, "4mm", key\);/);
    assert.match(c, /var key = doc\.selectionKeyObject;/);
    assert.match(c, /doc\.align\(items, AlignOptions\.VERTICAL_CENTERS, bounds, key\);/);
    const al = tool('align_items').handler;
    assert.throws(() => al({ target: T }), /Give align, distribute or both/);
    assert.throws(() => al({ target: T, align: 'middle' }), /Allowed: left/);
    assert.throws(() => al({ target: T, align: 'left', spacing: 3 }), /when distributing/);
    assert.throws(() => al({ target: T, align: 'left', alignTo: 'page', keyObject: 3 }), /needs alignTo: key_object/);
    assert.throws(() => al({ target: T, distribute: 'left', alignTo: 'galaxy' }), /Allowed: selection/);
});

await test('set_transform_preferences writes app.transformPreferences and the reference point', async () => {
    const s = await one('set_transform_preferences', {
        transformationsAreTotals: false, dimensionsIncludeStrokeWeight: true, showContentOffset: true,
        adjustStrokeWeightWhenScaling: false, adjustEffectsWhenScaling: true, whenScaling: 'adjust_scaling_percentage', referencePoint: 'top_right',
    });
    assert.match(s, /tp\.transformationsAreTotals = false;/);
    assert.match(s, /tp\.dimensionsIncludeStrokeWeight = true;/);
    assert.match(s, /tp\.adjustEffectsWhenScaling = true;/);
    assert.match(s, /tp\.whenScaling = WhenScalingOptions\.ADJUST_SCALING_PERCENTAGE;/);
    assert.match(s, /app\.activeWindow\.transformReferencePoint = AnchorPoint\.TOP_RIGHT_ANCHOR;/);
    assert.doesNotMatch(s, /var doc = __doc\(\);/);
    const set = tool('set_transform_preferences').handler;
    assert.throws(() => set({}), /Nothing to set/);
    assert.throws(() => set({ showContentOffset: 'on' }), /true or false/);
    assert.throws(() => set({ whenScaling: 'stretch' }), /Allowed: apply_to_content/);
});

await test('get_transform_info reads preferences, and items when given', async () => {
    const [prefs, items] = await scriptsFor([['get_transform_info', {}], ['get_transform_info', { target: T }]]);
    assert.match(prefs, /whenScaling: __enumName\(tp\.whenScaling\)/);
    assert.doesNotMatch(prefs, /var items = __targets/);
    assert.match(items, /it\.transformValuesOf\(CoordinateSpaces\.PASTEBOARD_COORDINATES\)\[0\]\.matrixValues/);
});

await test('draw_path builds the path from points with handles and point types', async () => {
    const s = await one('draw_path', {
        pageIndex: 1, closed: true, strokeColor: '#00ff00', name: 'Wave',
        points: [{ anchor: [10, 10] }, { anchor: [40, 20], left: [30, 5], right: [50, 35], type: 'symmetrical' }, { anchor: [10, 40] }],
    });
    assert.match(s, /var page = __page\(doc, 1\), b = page\.bounds;/);
    assert.match(s, /var it = page\.polygons\.add\(\);/);
    assert.match(s, /entirePath = \[\[__toDoc\(b, \[10, 10\]\), __toDoc\(b, \[10, 10\]\), __toDoc\(b, \[10, 10\]\)\], \[__toDoc\(b, \[30, 5\]\), __toDoc\(b, \[40, 20\]\), __toDoc\(b, \[50, 35\]\)\]/);
    assert.match(s, /pathType = PathType\.CLOSED_PATH;/);
    assert.match(s, /pathPoints\.item\(1\)\.pointType = PointType\.SYMMETRICAL;/);
    assert.match(s, /it\.strokeColor = __stroke;/);
    assert.match(s, /it\.name = "Wave";/);
    const open = await one('draw_path', { pageIndex: 0, points: [{ anchor: [0, 0] }, { anchor: [5, 5] }] });
    assert.match(open, /page\.graphicLines\.add\(\)/);
    assert.match(open, /PathType\.OPEN_PATH/);
    const draw = tool('draw_path').handler;
    assert.throws(() => draw({ pageIndex: 0, points: [{ anchor: [0, 0] }] }), /2 to 1000 points/);
    assert.throws(() => draw({ pageIndex: 0, points: [{ anchor: [0] }, { anchor: [1, 1] }] }), /\[x, y\]/);
    assert.throws(() => draw({ pageIndex: 0, points: [{ anchor: [0, 0], type: 'cusp' }, { anchor: [1, 1] }] }), /Allowed: plain/);
    assert.throws(() => draw({ pageIndex: 0, points: [{ anchor: [0, 0], handle: [1, 1] }, { anchor: [1, 1] }] }), /Unknown option/);
    assert.throws(() => draw({ pageIndex: -1, points: [{ anchor: [0, 0] }, { anchor: [1, 1] }] }), /Invalid index/);
});

await test('edit_path opens, closes, reverses and converts points', async () => {
    const [op, rev, conv] = await scriptsFor([
        ['edit_path', { target: T, action: 'open' }],
        ['edit_path', { target: T, action: 'reverse', path: 1 }],
        ['edit_path', { target: T, action: 'set_point_type', points: [0, 2], pointType: 'corner' }],
    ]);
    assert.match(op, /var p = it\.paths\.item\(pi\); p\.pathType = PathType\.OPEN_PATH;/);
    assert.match(rev, /var p = __pathOf\(it, 1\); p\.reverse\(\);/);
    assert.match(conv, /p\.pathPoints\.item\(__pointIndex\(p, idx\[i\]\)\)\.pointType = PointType\.CORNER;/);
    assert.match(conv, /var idx = \[0,2\];/);
});

await test('edit_path adds, moves and deletes anchor points, cuts and joins', async () => {
    const [seg, pt, mv, del, cut, join] = await scriptsFor([
        ['edit_path', { target: T, action: 'add_point', segment: 2, t: 0.25 }],
        ['edit_path', { target: T, action: 'add_point', point: { anchor: [5, 5], type: 'smooth' }, at: 1 }],
        ['edit_path', { target: T, action: 'move_point', points: [3], point: { anchor: [12, 8], right: [15, 8] } }],
        ['edit_path', { target: T, action: 'delete_point', points: [1, 4, 1] }],
        ['edit_path', { target: T, action: 'cut', points: [2] }],
        ['edit_path', { target: { ids: [5, 6] }, action: 'join', joinMode: 'combine' }],
    ]);
    assert.match(seg, /var s = 2, t = 0\.25;/);
    assert.match(seg, /P\.splice\(s \+ 1, 0, \[p012, mid, p123\]\);/);
    assert.match(seg, /p\.entirePath = P; p\.pathType = kind;/);
    assert.match(seg, /if \(items\.length !== 1\)/);
    assert.match(pt, /var at = 1;/);
    assert.match(pt, /P\.splice\(at, 0, \[__toDoc\(b, \[5, 5\]\), __toDoc\(b, \[5, 5\]\), __toDoc\(b, \[5, 5\]\)\]\);/);
    assert.match(pt, /p\.pathPoints\.item\(at\)\.pointType = PointType\.SMOOTH;/);
    assert.match(mv, /var q = p\.pathPoints\.item\(__pointIndex\(p, 3\)\);/);
    assert.match(mv, /var na = __toDoc\(b, \[12, 8\]\)/);
    assert.match(mv, /R = __toDoc\(b, \[15, 8\]\);/);
    assert.match(mv, /q\.anchor = A; q\.leftDirection = L; q\.rightDirection = R;/);
    assert.match(del, /var idx = \[4,1\];/);
    assert.match(del, /\.remove\(\);/);
    assert.match(cut, /copy = it\.duplicate\(\);/);
    assert.match(cut, /p\.pathType = PathType\.OPEN_PATH; p\.entirePath = Q;/);
    assert.match(join, /it = it\.makeCompoundPath\(\[items\[1\]\]\);/);
    assert.match(join, /best\[0\]\.join\(best\[1\], JoinOptions\.COMBINE\);/);
});

await test('edit_path refuses bad arguments', () => {
    const ed = tool('edit_path').handler;
    assert.throws(() => ed({ target: T, action: 'bend' }), /Allowed: open/);
    assert.throws(() => ed({ target: T, action: 'open', points: [1] }), /'points' does not apply to open/);
    assert.throws(() => ed({ target: T, action: 'set_point_type' }), /Allowed: plain/);
    assert.throws(() => ed({ target: T, action: 'add_point' }), /segment .* or point/);
    assert.throws(() => ed({ target: T, action: 'add_point', segment: 1, point: { anchor: [0, 0] } }), /not both/);
    assert.throws(() => ed({ target: T, action: 'add_point', segment: 1, t: 1 }), /out of range/);
    assert.throws(() => ed({ target: T, action: 'add_point', point: { anchor: [0, 0] }, t: 0.5 }), /applies with segment/);
    assert.throws(() => ed({ target: T, action: 'move_point', points: [1, 2], point: { anchor: [0, 0] } }), /one point index/);
    assert.throws(() => ed({ target: T, action: 'move_point', points: [1], point: {} }), /give point\.anchor/);
    assert.throws(() => ed({ target: T, action: 'delete_point' }), /non-empty list/);
    assert.throws(() => ed({ target: T, action: 'cut', points: [-1] }), /Invalid index/);
    assert.throws(() => ed({ target: T, action: 'join', joinMode: 'weld' }), /Allowed: connect, combine/);
});

await test('get_path_info reads the paths of the items', async () => {
    const s = await one('get_path_info', { target: T });
    assert.match(s, /info\.paths = __paths\(items\[i\]\);/);
    assert.match(s, /type: __enumName\(q\.pointType\)/);
});

await test('combine_paths runs the Pathfinder and compound path methods', async () => {
    const [sub, rel] = await scriptsFor([
        ['combine_paths', { target: { ids: [1, 2, 3] }, operation: 'subtract' }],
        ['combine_paths', { target: T, operation: 'release_compound_path' }],
    ]);
    assert.match(sub, /var out = \[__pathSummary\(items\[0\]\.subtractPath\(rest\)\)\];/);
    assert.match(sub, /needs at least two items/);
    assert.match(rel, /var parts = items\[i\]\.releaseCompoundPath\(\);/);
    for (const [op, m] of [['add', 'addPath'], ['intersect', 'intersectPath'], ['exclude_overlap', 'excludeOverlapPath'], ['minus_back', 'minusBack'], ['make_compound_path', 'makeCompoundPath']]) {
        const s = await one('combine_paths', { target: { ids: [1, 2] }, operation: op });
        assert.match(s, new RegExp(`items\\[0\\]\\.${m}\\(rest\\)`), op);
    }
    assert.throws(() => tool('combine_paths').handler({ target: T, operation: 'merge' }), /Allowed: add/);
});

await test('convert_shape passes the shape and its options', async () => {
    const [poly, round, line] = await scriptsFor([
        ['convert_shape', { target: T, shape: 'polygon', sides: 5, starInset: 40 }],
        ['convert_shape', { target: T, shape: 'rounded_rectangle', cornerRadius: 3 }],
        ['convert_shape', { target: T, shape: 'orthogonal_line' }],
    ]);
    assert.match(poly, /convertShape\(ConvertShapeOptions\.CONVERT_TO_POLYGON, 5, 40\);/);
    assert.match(round, /convertShape\(ConvertShapeOptions\.CONVERT_TO_ROUNDED_RECTANGLE, undefined, undefined, 3\);/);
    assert.match(line, /convertShape\(ConvertShapeOptions\.CONVERT_TO_STRAIGHT_LINE\);/);
    const cs = tool('convert_shape').handler;
    assert.throws(() => cs({ target: T, shape: 'star' }), /Allowed: rectangle/);
    assert.throws(() => cs({ target: T, shape: 'ellipse', sides: 5 }), /apply to shape: polygon/);
    assert.throws(() => cs({ target: T, shape: 'rectangle', cornerRadius: 2 }), /'cornerRadius' applies to/);
    assert.throws(() => cs({ target: T, shape: 'polygon', sides: 2 }), /3 to 100/);
});

await test('set_corner_options writes the chosen corners', async () => {
    const s = await one('set_corner_options', { target: T, shape: 'bevel', radius: 4, corners: ['top_left', 'bottom_right'] });
    assert.match(s, /it\.topLeftCornerOption = CornerOptions\.BEVEL_CORNER;/);
    assert.match(s, /it\.bottomRightCornerRadius = 4;/);
    assert.doesNotMatch(s, /it\.topRightCornerOption = /);
    const co = tool('set_corner_options').handler;
    assert.throws(() => co({ target: T }), /Give shape, radius or both/);
    assert.throws(() => co({ target: T, shape: 'wavy' }), /Allowed: none/);
    assert.throws(() => co({ target: T, radius: 2, corners: ['middle'] }), /Allowed: top_left/);
    assert.throws(() => co({ target: T, radius: -1 }), /out of range/);
});

await test('set_clipping_path writes the clipping path settings', async () => {
    const s = await one('set_clipping_path', { target: T, type: 'photoshop_path', pathName: 'Path 1', insetFrame: 0.5, invertPath: true, convertToFrame: true });
    assert.match(s, /cp\.clippingType = ClippingPathType\.PHOTOSHOP_PATH;/);
    assert.match(s, /cp\.appliedPathName = "Path 1";/);
    assert.match(s, /cp\.insetFrame = 0\.5;/);
    assert.match(s, /cp\.invertPath = true;/);
    assert.match(s, /cp\.convertToFrame\(\);/);
    const cp = tool('set_clipping_path').handler;
    assert.throws(() => cp({ target: T }), /Nothing to set/);
    assert.throws(() => cp({ target: T, type: 'magic' }), /Allowed: none/);
    assert.throws(() => cp({ target: T, type: 'detect_edges', pathName: 'A' }), /applies to photoshop_path and alpha_channel/);
    assert.throws(() => cp({ target: T, threshold: 300 }), /Invalid index/);
    assert.throws(() => cp({ target: T, tolerance: 11 }), /out of range/);
});

await test('create_outlines converts text frames, keeping the text when asked', async () => {
    const [replace, keep] = await scriptsFor([
        ['create_outlines', { target: T }],
        ['create_outlines', { target: T, keepText: true }],
    ]);
    assert.match(replace, /items\[j\]\.createOutlines\(true\);/);
    assert.match(keep, /items\[j\]\.createOutlines\(false\);/);
    assert.throws(() => tool('create_outlines').handler({ target: T, keepText: 1 }), /true or false/);
});

done();
