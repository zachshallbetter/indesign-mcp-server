import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { arcPoints, spiralPoints, dividerFractions, rectGridLines, polarGridGeometry } from '../src/tools/shapes.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

test('arcs follow the Arc Segment Tool Options', () => {
    // Base along x, convex: leaves the start horizontally, bulging toward the top-right corner.
    assert.deepEqual(arcPoints({ x: 0, y: 0, width: 100, height: 50 }), [
        { anchor: [0, 0], rightDirection: [50, 0] },
        { anchor: [100, 50], leftDirection: [100, 25] },
    ]);
    // Closed adds the corner the arc curves around.
    assert.deepEqual(arcPoints({ x: 0, y: 0, width: 100, height: 50, closed: true })[2], { anchor: [0, 50] });
    // Concave bulges toward that corner; base along y swaps it.
    const concave = arcPoints({ x: 0, y: 0, width: 100, height: 50, baseAlong: 'y', slope: -100 });
    assert.deepEqual(concave[0].rightDirection, [100, 0]);
    assert.deepEqual(concave[1].leftDirection, [100, 0]);
    // Slope 0 is a straight line; the start corner sets the direction.
    const flat = arcPoints({ x: 10, y: 10, width: 40, height: 20, slope: 0, startCorner: 'bottom_right' });
    assert.deepEqual(flat.map((p) => p.anchor), [[50, 30], [10, 10]]);
    assert.deepEqual(flat[0].rightDirection, [50, 30]);
});

test('spirals are quarter turns that shrink by the decay', () => {
    const s = spiralPoints({ centerX: 0, centerY: 0, radius: 100, decay: 50, segments: 3, style: 'clockwise' });
    assert.equal(s.length, 4, 'segments are quarter turns: one more anchor than segments');
    assert.deepEqual(s[0].anchor, [100, 0], 'starts at the outermost point');
    assert.deepEqual(s[1].anchor, [0, 100], 'clockwise on screen (y down)');
    assert.deepEqual(s[2].anchor, [-50, 50], 'the second segment has half the radius');
    assert.deepEqual(s[3].anchor, [-25, 25]);
    // A 100% decay is a circle.
    const circle = spiralPoints({ centerX: 0, centerY: 0, radius: 10, decay: 100, segments: 4 });
    assert.deepEqual(circle[4].anchor, circle[0].anchor);
    assert.deepEqual(circle[1].anchor, [0, -10], 'counterclockwise goes up first');
});

test('dividers skew toward one side', () => {
    assert.deepEqual(dividerFractions(3, 0), [0.25, 0.5, 0.75]);
    assert.deepEqual(dividerFractions(0, 50), []);
    const f = dividerFractions(2, 100);
    close(f[0], 1 / 7);
    close(f[1], 3 / 7);
    const grid = rectGridLines({ x: 0, y: 0, width: 100, height: 100, horizontalDividers: 1, horizontalSkew: 100, verticalDividers: 1, verticalSkew: 100 });
    close(grid.horizontal[0][0][1], 100 / 3);
    close(grid.vertical[0][0][0], 200 / 3);
    assert.deepEqual(grid.frame, { left: 0, top: 0, width: 100, height: 100 });
    const open = rectGridLines({ x: 0, y: 0, width: 100, height: 100, horizontalDividers: 2, verticalDividers: 0, frame: false });
    assert.equal(open.horizontal.length, 4, 'without a frame the top and bottom edges are lines');
    assert.equal(open.vertical.length, 2);
    const polar = polarGridGeometry({ x: 0, y: 0, width: 100, height: 60, concentricDividers: 1, radialDividers: 4 });
    assert.deepEqual(polar.ellipses[1], { left: 25, top: 15, width: 50, height: 30 });
    assert.deepEqual(polar.radial.map((l) => l[1]), [[50, 0], [0, 30], [50, 60], [100, 30]]);
});

test('arc, spiral and grid scripts draw through the object model', async () => {
    const [arc, spiral, rect, open, polar, compound, line] = await scriptsFor([
        ['create_arc', { x: 0, y: 0, width: 80, height: 40, closed: true, fill: '#FF0000' }],
        ['create_spiral', { centerX: 50, centerY: 50, radius: 40, decay: 70, segments: 8 }],
        ['create_rectangular_grid', { x: 0, y: 0, width: 100, height: 80, horizontalDividers: 3, verticalDividers: 2, fill: 'gray(20)', name: 'Grid' }],
        ['create_rectangular_grid', { x: 0, y: 0, width: 100, height: 80, frame: false }],
        ['create_polar_grid', { x: 0, y: 0, width: 100, height: 100, concentricDividers: 3, radialDividers: 6 }],
        ['create_polar_grid', { x: 0, y: 0, width: 100, height: 100, compoundPath: true, fill: '#000000' }],
        ['create_line', { x1: 10, y1: 10, length: 50, angle: 45 }],
    ]);
    assert.match(arc, /__drawPath\(layer, .*, true\)/);
    assert.match(arc, /it\.filled = true; it\.fillColor = __color/);
    assert.match(spiral, /__drawPath\(layer, .*, false\)/);
    assert.match(spiral, /PointType\.SMOOTH/);
    assert.match(rect, /g\.pathItems\.rectangle\(tl\[1\], tl\[0\]/);
    assert.match(rect, /if \(closed\) \{ p\.filled = true;/);
    assert.match(rect, /g\.name = "Grid"/);
    assert.doesNotMatch(open, /pathItems\.rectangle/);
    assert.match(polar, /parent\.pathItems\.ellipse/);
    assert.doesNotMatch(polar, /compoundPathItems/);
    assert.match(compound, /g\.compoundPathItems\.add\(\)/);
    assert.match(compound, /pair\[k\]\.evenodd = true/);
    assert.match(line, /var len = 50, rad = 45 \* Math\.PI \/ 180;/);
    const [between] = await scriptsFor([['create_line', { x1: 0, y1: 0, x2: 30, y2: 40 }]]);
    assert.match(between, /var e = \[30, 40\];/);
});

test('live shapes convert and expand through Object > Shape', async () => {
    const [convert, expand, widget] = await scriptsFor([
        ['convert_live_shapes', { target: { ids: ['1'] }, operation: 'convert_to_shape' }],
        ['convert_live_shapes', { target: { selection: true }, operation: 'expand_shape' }],
        ['toggle_corner_widget', {}],
    ]);
    assert.match(convert, /app\.executeMenuCommand\("Convert to Shape"\);/);
    assert.match(convert, /items\[k\]\.selected = true/);
    assert.match(expand, /app\.executeMenuCommand\("Expand Shape"\);/);
    assert.match(widget, /app\.executeMenuCommand\("Live Corner Annotator"\);/);
    const { toolDefinitions } = await import('../src/server.js');
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    assert.equal(byName.convert_live_shapes.destructiveHint, true);
    assert.equal(byName.create_arc.readOnlyHint, false);
});

test('shape arguments are checked', async () => {
    const mcp = await server();
    const refuse = (name, args, re) => assert.rejects(mcp.handleToolCall(name, args), re);
    await refuse('create_arc', { x: 0, y: 0, width: 10, height: 10, slope: 150 }, /slope.*out of range/);
    await refuse('create_arc', { x: 0, y: 0, width: 10, height: 10, baseAlong: 'z' }, /Allowed: x, y/);
    await refuse('create_arc', { x: 0, y: 0, width: 10, height: 10, startCorner: 'middle' }, /Allowed: top_left/);
    await refuse('create_arc', { x: 0, y: 0, width: -1, height: 10 }, /width.*out of range/);
    await refuse('create_spiral', { centerX: 0, centerY: 0, radius: 10, decay: 2 }, /decay.*out of range/);
    await refuse('create_spiral', { centerX: 0, centerY: 0, radius: 10, segments: 0 }, /segments' must be at least 1/);
    await refuse('create_spiral', { centerX: 0, centerY: 0, radius: 10, style: 'sideways' }, /Allowed: counterclockwise, clockwise/);
    await refuse('create_rectangular_grid', { x: 0, y: 0, width: 10, height: 10, horizontalSkew: 600 }, /horizontalSkew.*out of range/);
    await refuse('create_rectangular_grid', { x: 0, y: 0, width: 10, height: 10, verticalDividers: 2.5 }, /verticalDividers/);
    await refuse('create_polar_grid', { x: 0, y: 0, width: 10, height: 10, radialDividers: 501 }, /radialDividers/);
    await refuse('create_polar_grid', { x: 0, y: 0, width: 10, height: 10, fill: 'rgb(300,0,0)' }, /out of range/);
    await refuse('create_line', { x1: 0, y1: 0 }, /end point x2, y2, or a length/);
    await refuse('create_line', { x1: 0, y1: 0, x2: 5, y2: 5, length: 5 }, /not both/);
    await refuse('convert_live_shapes', { target: { selection: true }, operation: 'round_corners' }, /Allowed: convert_to_shape, expand_shape/);
    await refuse('convert_live_shapes', { operation: 'expand_shape' }, /Choose the items/);
});
