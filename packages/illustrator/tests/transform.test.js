import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { shearMatrix, freeDistortXml } from '../src/tools/transform.js';

const sel = { selection: true };

test('transform_each scales, rotates and moves each item around its own reference point', async () => {
    const [plain, random] = await scriptsFor([
        ['transform_each', { target: sel, scaleX: 150, scaleY: 50, angle: 30, moveX: 10, moveY: 20, origin: 'topLeft', apply: 'patterns', scaleStrokes: false }],
        ['transform_each', { target: sel, scaleX: 120, random: true, copy: true, flipHorizontal: true, scaleCorners: true }],
    ]);
    assert.match(plain, /it\.resize\(sx, sy, false, true, false, true, lwOn \? Math\.sqrt\(Math\.abs\(sx \* sy\)\) : 100, Transformation\.TOPLEFT\);/);
    assert.match(plain, /it\.rotate\(ang, false, true, false, true, Transformation\.TOPLEFT\);/);
    assert.match(plain, /it\.translate\(__len\(doc, mx\), -__len\(doc, my\), false, true, false, true\);/);
    assert.match(plain, /var lwOn = false;/);
    assert.match(plain, /return 1; \};/);
    assert.match(random, /return Math\.random\(\); \};/);
    assert.match(random, /var it = items\[i\]\.duplicate\(\);/);
    assert.match(random, /sx = -sx;/);
    assert.match(random, /app\.preferences\.setIntegerPreference\("policyForPreservingCorners", 1\);/);
    assert.match(random, /finally \{\n {2}app\.preferences\.setIntegerPreference\("policyForPreservingCorners", __corners\);/);
    assert.match(random, /app\.preferences\.getBooleanPreference\("scaleLineWeight"\)/);
});

test('shear and matrix tools build an Illustrator Matrix in document coordinates', async () => {
    const [shear, matrix] = await scriptsFor([
        ['shear_items', { target: sel, angle: 45, axis: 'horizontal', origin: 'bottom' }],
        ['apply_matrix', { target: sel, matrix: [1, 0.5, 0, 1, 10, 20], apply: 'objects' }],
    ]);
    assert.match(shear, /var m = app\.getIdentityMatrix\(\);/);
    assert.match(shear, /m\.mValueC = 0\.9999999999999999|m\.mValueC = 1;/);
    assert.match(shear, /items\[i\]\.transform\(m, true, true, true, true, 100, Transformation\.BOTTOM\);/);
    // y down for callers, y up for Illustrator: b, c and ty change sign.
    assert.match(matrix, /m\.mValueA = 1; m\.mValueB = -0\.5;/);
    assert.match(matrix, /m\.mValueTX = __len\(doc, 10\); m\.mValueTY = -__len\(doc, 20\);/);
    assert.match(matrix, /items\[i\]\.transform\(m, true, false, true, false, lwOn \? 100 : 100, Transformation\.CENTER\);/);
    const v = shearMatrix(30, 90);
    assert.ok(Math.abs(v[0] - 1) < 1e-9 && Math.abs(v[1] + Math.tan(Math.PI / 6)) < 1e-9 && v[2] === 0);
});

test('Transform panel tools: resize, bounds, nudge, options, reset bounding box', async () => {
    const [resize, bounds, nudge, options, reset, again] = await scriptsFor([
        ['resize_items', { target: sel, width: 200, origin: 'right' }],
        ['get_bounds', { target: sel, artboardIndex: 1 }],
        ['nudge_items', { target: sel, direction: 'left', steps: 3, large: true }],
        ['set_transform_options', { referencePoint: 'bottomRight', scaleCorners: false, showBoundingBox: true }],
        ['reset_bounding_box', { target: sel }],
        ['repeat_transform', { target: sel, count: 4 }],
    ]);
    assert.match(resize, /var sx = \(200\) \/ cw \* 100;/);
    assert.match(resize, /if \(sy === null\) sy = sx;/);
    assert.match(resize, /it\.resize\(sx, sy, true, true, true, true, lwOn \? Math\.sqrt\(sx \* sy\) : 100, Transformation\.RIGHT\);/);
    assert.match(resize, /getBooleanPreference\("includeStrokeInBounds"\)/);
    assert.match(bounds, /control: __rect\(doc, it\.controlBounds, ab\)/);
    assert.match(nudge, /getRealPreference\("cursorKeyLength"\) \* 3 \* 10;/);
    assert.match(nudge, /translate\(-1 \* __len\(doc, d\), 0 \* __len\(doc, d\)\)/);
    assert.match(options, /setIntegerPreference\("plugin\/Transform\/AnchorPoint", 8\);/);
    assert.match(options, /setIntegerPreference\("policyForPreservingCorners", 2\);/);
    assert.match(options, /if \(p\.getBooleanPreference\("showBoundingBox"\) !== true\) app\.executeMenuCommand\("AI Bounding Box Toggle"\);/);
    assert.match(reset, /app\.executeMenuCommand\("AI Reset Bounding Box"\);/);
    assert.equal(again.match(/app\.executeMenuCommand\("transformagain"\)/g).length, 1);
    assert.match(again, /n < 4; n\+\+/);
});

test('align_items aligns to a key object and centres both ways', async () => {
    const [key, geometric] = await scriptsFor([
        ['align_items', { target: sel, edge: 'center_middle', to: 'key_object', keyObjectId: 'abc' }],
        ['align_items', { target: sel, edge: 'left', usePreviewBounds: false }],
    ]);
    assert.match(key, /var key = doc\.getPageItemFromUuid\("abc"\);/);
    assert.match(key, /dx = \(L \+ R\) \/ 2 - \(g\[0\] \+ g\[2\]\) \/ 2; dy = \(T \+ B\) \/ 2 - \(g\[1\] \+ g\[3\]\) \/ 2;/);
    assert.match(geometric, /g = items\[i\]\.geometricBounds;/);
    assert.doesNotMatch(geometric, /visibleBounds/);
});

test('distribute_items spaces by edges, centres or an exact gap', async () => {
    const [edges, even, gap] = await scriptsFor([
        ['distribute_items', { target: sel, by: 'vcenter' }],
        ['distribute_items', { target: sel, by: 'hspace' }],
        ['distribute_items', { target: sel, by: 'vspace', spacing: 12, keyObjectId: 'k1', usePreviewBounds: false }],
    ]);
    assert.match(edges, /var step = \(list\[n - 1\]\.mid - list\[0\]\.mid\) \/ \(n - 1\);/);
    assert.match(edges, /return \{ lo: -b\[1\], hi: -b\[3\] \};/);
    assert.match(even, /var gap = \(list\[n - 1\]\.hi - list\[0\]\.lo - total\) \/ \(n - 1\)/);
    assert.match(gap, /var gap = __len\(doc, 12\), key = 0;/);
    assert.match(gap, /list\[k\]\.it\.uuid === "k1"/);
    assert.match(gap, /it\.geometricBounds/);
});

test('envelopes and objects on a path run their menu commands on the targets', async () => {
    const [make, release, edit, expand] = await scriptsFor([
        ['make_envelope', { target: { ids: ['a', 'b'] }, shapeId: 'shape' }],
        ['edit_envelope', { target: sel, operation: 'release' }],
        ['edit_envelope', { target: sel, operation: 'edit_contents' }],
        ['expand_objects_on_path', { target: sel }],
    ]);
    assert.match(make, /shape\.move\(items\[0\]\.parent, ElementPlacement\.PLACEATBEGINNING\);/);
    assert.match(make, /app\.executeMenuCommand\("Make Envelope"\);/);
    assert.match(release, /app\.executeMenuCommand\("Release Envelope"\);/);
    assert.match(edit, /app\.executeMenuCommand\("Edit Envelope Contents"\);/);
    assert.match(expand, /app\.executeMenuCommand\("Expand Objects on Path"\);/);
});

test('distort_items applies Free Distort with normalised corners', async () => {
    assert.equal(freeDistortXml([[0.2, 0], [0.8, 0], [0, 1], [1, 1]]),
        '<LiveEffect name="Adobe Free Distort"><Dict data="R src0h 0 R src0v 0 R src1h 1 R src1v 0 R src2h 0 R src2v -1 R src3h 1 R src3v -1 '
        + 'R dst0h 0.2 R dst0v 0 R dst1h 0.8 R dst1v 0 R dst2h 0 R dst2v -1 R dst3h 1 R dst3v -1 "/></LiveEffect>');
    const [persp, free] = await scriptsFor([
        ['distort_items', { target: sel, mode: 'perspective', edge: 'top', amount: 20 }],
        ['distort_items', { target: sel, mode: 'free', corners: { bottomRight: [1.5, 1.25] }, expand: false }],
    ]);
    assert.match(persp, /R dst0h 0\.2 R dst0v 0 R dst1h 0\.8 R dst1v 0 /);
    assert.match(persp, /app\.executeMenuCommand\("expandStyle"\);/);
    assert.match(free, /R dst3h 1\.5 R dst3v -1\.25 /);
    assert.doesNotMatch(free, /expandStyle/);
});

test('bad arguments are refused before anything runs', async () => {
    const mcp = await server();
    const refused = [
        ['transform_each', { target: sel }, /Nothing to do/],
        ['transform_each', { target: sel, scaleX: -5 }, /out of range/],
        ['transform_each', { target: sel, angle: 5, origin: 'middle' }, /Allowed: topLeft/],
        ['transform_each', { target: sel, angle: 5, apply: 'all' }, /Allowed: both, objects, patterns/],
        ['shear_items', { target: sel, angle: 90 }, /out of range/],
        ['shear_items', { target: sel, angle: 10, axis: 'angle' }, /needs axisAngle/],
        ['apply_matrix', { target: sel, matrix: [1, 0, 0, 1] }, /six numbers/],
        ['apply_matrix', { target: sel, matrix: [1, 2, 2, 4, 0, 0] }, /singular/],
        ['apply_matrix', { target: sel, matrix: [1, 0, 0, 'x', 0, 0] }, /Invalid number/],
        ['resize_items', { target: sel }, /Give width, height/],
        ['resize_items', { target: sel, width: 0 }, /out of range/],
        ['nudge_items', { target: sel, direction: 'north' }, /Allowed: up/],
        ['repeat_transform', { target: sel, count: 0 }, /at least 1/],
        ['repeat_transform', { target: sel, count: 101 }, /Invalid index/],
        ['set_transform_options', { referencePoint: 'middle' }, /Allowed: topLeft/],
        ['align_items', { target: sel, edge: 'left', to: 'key_object' }, /needs keyObjectId/],
        ['distribute_items', { target: sel, by: 'left', spacing: 4 }, /hspace and vspace only/],
        ['distribute_items', { target: sel, by: 'hspace', keyObjectId: 'a' }, /keyObjectId needs spacing/],
        ['distribute_items', { target: sel, by: 'diagonal' }, /Allowed: left/],
        ['edit_envelope', { target: sel, operation: 'warp' }, /Allowed: release, expand, edit_contents/],
        ['distort_items', { target: sel, mode: 'free' }, /needs corners/],
        ['distort_items', { target: sel, mode: 'free', corners: { middle: [0, 0] } }, /corners has no middle/],
        ['distort_items', { target: sel, mode: 'free', corners: { topLeft: [0] } }, /must be \[x, y\]/],
        ['distort_items', { target: sel, mode: 'perspective', edge: 'top', amount: 60 }, /out of range/],
        ['distort_items', { target: sel, mode: 'perspective', edge: 'centre', amount: 10 }, /Allowed: top/],
        ['make_envelope', { target: {} }, /Choose the items/],
    ];
    for (const [name, args, re] of refused) await assert.rejects(mcp.handleToolCall(name, args), re, `${name} ${JSON.stringify(args)}`);
});

test('a key object id or shape id cannot break out of its string', async () => {
    const [s] = await scriptsFor([['align_items', { target: sel, edge: 'top', to: 'key_object', keyObjectId: '"); app.quit(); ("' }]]);
    assert.match(s, /getPageItemFromUuid\("\\"\); app\.quit\(\); \(\\""\)/);
});
