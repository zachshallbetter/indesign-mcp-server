/**
 * Arcs, spirals, rectangular and polar grids, and live shapes.
 *
 * The Arc, Spiral, Rectangular Grid and Polar Grid tools have no object-model
 * constructor, and their options dialogs cannot be driven by a script. These
 * tools build the same artwork from geometry, taking the options each dialog
 * offers. Geometry is computed here in artboard points (y down) and drawn in
 * the script.
 *
 * Live shapes: Object > Shape > Convert to Shape and Expand Shape run on the
 * selection without a dialog. The object model has no live-shape properties
 * (width, height, angle, corner radii), so they cannot be read or set.
 */
import { num, index, bool, enumOf, json, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec, colorSpec } from '../args.js';
import { STYLE_PROPS, PLACEMENT_PROPS, styleStatements, placement } from './artwork.js';
import { SELECT, SELECTION } from './paths.js';

/** Bezier handle length for a quarter circle, as a fraction of its radius. */
const KAPPA = 0.5522847498;

const CORNERS = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];
const LIVE_SHAPE_COMMANDS = { convert_to_shape: 'Convert to Shape', expand_shape: 'Expand Shape' };

const round = (v) => Math.round(v * 10000) / 10000;
const pt = (p) => [round(p[0]), round(p[1])];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** ES3: draw a path from points { anchor, leftDirection?, rightDirection? } in artboard points. */
const DRAW = `
function __drawPath(parent, pts, closed) {
  var p = parent.pathItems.add();
  for (var i = 0; i < pts.length; i++) {
    var q = pts[i], pp = p.pathPoints.add();
    pp.anchor = __toDoc(doc, ab, q.anchor[0], q.anchor[1]);
    pp.leftDirection = q.leftDirection ? __toDoc(doc, ab, q.leftDirection[0], q.leftDirection[1]) : pp.anchor;
    pp.rightDirection = q.rightDirection ? __toDoc(doc, ab, q.rightDirection[0], q.rightDirection[1]) : pp.anchor;
    pp.pointType = (q.leftDirection && q.rightDirection) ? PointType.SMOOTH : PointType.CORNER;
  }
  p.closed = closed;
  return p;
}
function __drawLine(parent, a, b) {
  var p = parent.pathItems.add();
  p.setEntirePath([__toDoc(doc, ab, a[0], a[1]), __toDoc(doc, ab, b[0], b[1])]);
  return p;
}`;

/**
 * Arc geometry (Arc Segment Tool Options). The arc runs from the start corner
 * of its width x height box to the opposite corner. Base along x leaves the
 * start point horizontally (y: vertically). Positive slope bulges away from
 * the base corner (convex), negative bulges toward it (concave), 0 is a
 * straight line; |slope| is the handle length as a percentage of the way to
 * the corner it bulges toward. A closed arc adds the base corner.
 */
export function arcPoints({ x, y, width, height, startCorner = 'top_left', baseAlong = 'x', slope = 50, closed = false }) {
    const left = startCorner.endsWith('left'), top = startCorner.startsWith('top');
    const sx = left ? 1 : -1, sy = top ? 1 : -1;
    const S = [left ? x : x + width, top ? y : y + height];
    const E = [S[0] + sx * width, S[1] + sy * height];
    const alongX = [S[0] + sx * width, S[1]], alongY = [S[0], S[1] + sy * height];
    const convex = baseAlong === 'x' ? alongX : alongY;
    const base = baseAlong === 'x' ? alongY : alongX;
    const k = Math.abs(slope) / 100, toward = slope >= 0 ? convex : base;
    const pts = [
        { anchor: pt(S), rightDirection: pt(lerp(S, toward, k)) },
        { anchor: pt(E), leftDirection: pt(lerp(E, toward, k)) },
    ];
    if (closed) pts.push({ anchor: pt(base) });
    return pts;
}

/**
 * Spiral geometry (Spiral dialog): segments quarter turns of circular arc,
 * each segment's radius decay times the one before, joined smoothly. The
 * first segment is centred on the centre point with the given radius, so the
 * spiral starts at its outermost point (3 o'clock) and winds inward.
 */
export function spiralPoints({ centerX, centerY, radius, decay = 80, segments = 10, style = 'counterclockwise' }) {
    const d = decay / 100, dir = style === 'clockwise' ? -1 : 1;
    // Artboard y runs down: a point at angle t (counterclockwise on screen) is (cx + r cos t, cy - r sin t).
    const at = (c, r, t) => [c[0] + r * Math.cos(t), c[1] - r * Math.sin(t)];
    const tangent = (t) => [-Math.sin(t) * dir, -Math.cos(t) * dir];
    let c = [centerX, centerY], r = radius, t = 0;
    const pts = [{ anchor: at(c, r, t), rIn: 0, rOut: r, t }];
    for (let i = 0; i < segments; i++) {
        const t2 = t + dir * Math.PI / 2, end = at(c, r, t2), r2 = r * d;
        pts.push({ anchor: end, rIn: r, rOut: r2, t: t2 });
        // The next arc shares the tangent at end: its centre lies on the same radius line.
        c = [end[0] - r2 * Math.cos(t2), end[1] + r2 * Math.sin(t2)];
        r = r2; t = t2;
    }
    return pts.map((p, i) => {
        const tg = tangent(p.t), out = { anchor: pt(p.anchor) };
        if (i > 0) out.leftDirection = pt([p.anchor[0] - tg[0] * KAPPA * p.rIn, p.anchor[1] - tg[1] * KAPPA * p.rIn]);
        if (i < pts.length - 1) out.rightDirection = pt([p.anchor[0] + tg[0] * KAPPA * p.rOut, p.anchor[1] + tg[1] * KAPPA * p.rOut]);
        return out;
    });
}

/**
 * Where n dividers fall, as fractions 0..1 measured from the side they crowd
 * toward. Skew 0 spaces them evenly; otherwise each gap is (1 + |skew|/100)
 * times the one before it, starting from the crowded side.
 */
export function dividerFractions(n, skew = 0) {
    if (n <= 0) return [];
    const q = 1 + Math.abs(skew) / 100;
    const gaps = Array.from({ length: n + 1 }, (_, k) => q ** (k - n));
    const total = gaps.reduce((s, g) => s + g, 0);
    const out = [];
    let acc = 0;
    for (let k = 0; k < n; k++) { acc += gaps[k]; out.push(acc / total); }
    return out;
}

/** Rectangular grid geometry: frame corners and divider lines, in artboard points. */
export function rectGridLines({ x, y, width, height, horizontalDividers = 5, horizontalSkew = 0, verticalDividers = 5, verticalSkew = 0, frame = true }) {
    const bottom = y + height, right = x + width;
    // Positive horizontal skew crowds rows toward the top; positive vertical skew crowds columns toward the right.
    const ys = dividerFractions(horizontalDividers, horizontalSkew).map((f) => (horizontalSkew >= 0 ? y + f * height : bottom - f * height));
    const xs = dividerFractions(verticalDividers, verticalSkew).map((f) => (verticalSkew >= 0 ? right - f * width : x + f * width));
    const horizontal = ys.map((v) => [pt([x, v]), pt([right, v])]);
    const vertical = xs.map((v) => [pt([v, y]), pt([v, bottom])]);
    if (!frame) {
        horizontal.unshift([pt([x, y]), pt([right, y])]);
        horizontal.push([pt([x, bottom]), pt([right, bottom])]);
        vertical.unshift([pt([x, y]), pt([x, bottom])]);
        vertical.push([pt([right, y]), pt([right, bottom])]);
    }
    return { horizontal, vertical, frame: frame ? { left: x, top: y, width, height } : null };
}

/**
 * Polar grid geometry: ellipse boxes from the outside in, and radial lines
 * from the centre to the outer ellipse. Positive concentric skew crowds the
 * rings toward the outside. Radial lines start at 12 o'clock; going
 * counterclockwise, positive radial skew makes each sector smaller than the
 * one before, negative larger.
 */
export function polarGridGeometry({ x, y, width, height, concentricDividers = 5, concentricSkew = 0, radialDividers = 5, radialSkew = 0 }) {
    const cx = x + width / 2, cy = y + height / 2;
    const rings = dividerFractions(concentricDividers, concentricSkew)
        .map((f) => (concentricSkew >= 0 ? 1 - f : f))
        .sort((a, b) => b - a);
    const ellipses = [1, ...rings].map((s) => ({ left: round(cx - (width * s) / 2), top: round(cy - (height * s) / 2), width: round(width * s), height: round(height * s) }));
    // n radial lines cut the circle into n sectors.
    const n = radialDividers;
    const fr = n > 0 ? [0, ...dividerFractions(n - 1, radialSkew).map((f) => (radialSkew >= 0 ? 1 - f : f))].sort((a, b) => a - b) : [];
    const radial = fr.map((f) => {
        const t = Math.PI / 2 + f * 2 * Math.PI;
        return [pt([cx, cy]), pt([cx + (width / 2) * Math.cos(t), cy - (height / 2) * Math.sin(t)])];
    });
    return { ellipses, radial };
}

/** JSX statements painting path `p` with the fill and stroke arguments. Fill applies only when `closed`. */
function paintStatements(a) {
    const lines = ['p.filled = false; p.stroked = true;'];
    if (a.fill !== undefined) {
        const spec = colorSpec(a.fill, 'fill');
        if (JSON.parse(spec).kind !== 'none') lines.push(`if (closed) { p.filled = true; p.fillColor = __color(doc, ${spec}); }`);
    }
    if (a.stroke !== undefined) {
        const spec = colorSpec(a.stroke, 'stroke');
        lines.push(JSON.parse(spec).kind === 'none' ? 'p.stroked = false;' : `p.strokeColor = __color(doc, ${spec});`);
    }
    if (a.strokeWeight !== undefined) lines.push(`p.strokeWidth = __len(doc, ${num(a.strokeWeight, { min: 0, max: 1000, name: 'strokeWeight' })});`);
    return `function __paint(p, closed) { ${lines.join(' ')} }`;
}

/** JSX statements naming the group `g` and setting its opacity. */
function groupStatements(a) {
    const lines = [];
    if (a.opacity !== undefined) lines.push(`g.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
    if (a.name) lines.push(`g.name = ${str(a.name)};`);
    return lines.join('\n');
}

const BOX = (what) => ({
    x: { type: 'number', description: `Left edge of the ${what}, points from the artboard's left` },
    y: { type: 'number', description: `Top edge of the ${what}, points from the artboard's top` },
});
const SKEW = (pos, neg) => ({ type: 'number', minimum: -500, maximum: 500, description: `Skew, -500 to 500 percent. 0 spaces the dividers evenly; positive crowds them toward ${pos}, negative toward ${neg}, each gap being (1 + |skew|/100) times its neighbour. Default 0` });
const DIVIDERS = (what) => ({ type: 'integer', minimum: 0, maximum: 500, description: `Number of ${what}. Default 5` });

/** A validated whole number from `a[key]` within [min, max]. */
function count(a, key, def, min, max) {
    const v = Number(index(a[key] ?? def, { name: key, max }));
    if (v < min) throw new Error(`'${key}' must be at least ${min}`);
    return v;
}

/** A validated number from `a[key]` within [min, max]. */
const number = (a, key, def, min, max) => Number(num(a[key] ?? def, { name: key, min, max }));

export const tools = [
    {
        name: 'create_arc',
        description: 'Draw an arc (Arc tool, with the Arc Segment Tool Options): the arc spans a width x height box (Length X-Axis, Length Y-Axis) from the start corner to the opposite corner. baseAlong x leaves the start point horizontally, y vertically. slope: positive is convex, negative concave, 0 a straight line. closed adds the corner the arc curves around (a pie-slice shape). With fill, the arc is filled (Fill Arc)',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                ...BOX('box'),
                width: { type: 'number', minimum: 0, description: 'Length X-Axis in points' },
                height: { type: 'number', minimum: 0, description: 'Length Y-Axis in points' },
                startCorner: { type: 'string', enum: CORNERS, description: 'Corner of the box where the arc starts (the dialog\'s reference point). Default top_left' },
                closed: { type: 'boolean', description: 'Type: true for a closed arc, false for open. Default false', default: false },
                baseAlong: { type: 'string', enum: ['x', 'y'], description: 'Base Along: the axis the arc leaves its start point along. Default x' },
                slope: { type: 'number', minimum: -100, maximum: 100, description: 'Slope, -100 (concave) to 100 (convex). About 55 approximates a quarter ellipse. Default 50' },
                ...STYLE_PROPS,
            },
            required: ['x', 'y', 'width', 'height'],
        },
        features: [
            'illustrator.shapes.arc_tool',
            'illustrator.shapes.arc_option.length_x_axis',
            'illustrator.shapes.arc_option.length_y_axis',
            'illustrator.shapes.arc_option.type_arc',
            'illustrator.shapes.arc_option.base_along',
            'illustrator.shapes.arc_option.slope',
            'illustrator.shapes.arc_option.fill_arc',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { startCorner: 'bottom_right', baseAlong: 'y', slope: -40, closed: true, fill: '#FF6600' },
        handler: (a) => {
            const pts = arcPoints({
                x: number(a, 'x', undefined, -1e6, 1e6), y: number(a, 'y', undefined, -1e6, 1e6),
                width: number(a, 'width', undefined, 0, 1e6), height: number(a, 'height', undefined, 0, 1e6),
                startCorner: enumOf(a.startCorner ?? 'top_left', CORNERS, { name: 'startCorner' }),
                baseAlong: enumOf(a.baseAlong ?? 'x', ['x', 'y'], { name: 'baseAlong' }),
                slope: number(a, 'slope', 50, -100, 100),
                closed: Boolean(a.closed),
            });
            return run('Create arc', script(`${placement(a)}${DRAW}
var it = __drawPath(layer, ${json(pts)}, ${bool(a.closed)});
it.filled = false; it.stroked = true;
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`));
        },
    },
    {
        name: 'create_spiral',
        description: 'Draw a spiral (Spiral tool, with its dialog\'s options): radius from the centre to the outermost point, decay (each quarter-turn segment\'s radius as a percentage of the one before), segments (quarter turns; four make one wind) and style (direction). It starts at its outermost point, to the right of the centre, and winds inward',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                centerX: { type: 'number' }, centerY: { type: 'number' },
                radius: { type: 'number', minimum: 0, description: 'Points from the centre to the outermost point' },
                decay: { type: 'number', minimum: 5, maximum: 100, description: 'Percent, 5-100. 100 draws a circle. Default 80' },
                segments: { type: 'integer', minimum: 1, maximum: 1000, description: 'Quarter-turn segments. Default 10' },
                style: { type: 'string', enum: ['counterclockwise', 'clockwise'], description: 'Direction the spiral winds in from its outer end. Default counterclockwise' },
                ...STYLE_PROPS,
            },
            required: ['centerX', 'centerY', 'radius'],
        },
        features: [
            'illustrator.shapes.spiral_tool',
            'illustrator.shapes.spiral_option.radius_spiral',
            'illustrator.shapes.spiral_option.decay',
            'illustrator.shapes.spiral_option.segments',
            'illustrator.shapes.spiral_option.style_spiral',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { decay: 75, segments: 12, style: 'clockwise' },
        handler: (a) => {
            const pts = spiralPoints({
                centerX: number(a, 'centerX', undefined, -1e6, 1e6), centerY: number(a, 'centerY', undefined, -1e6, 1e6),
                radius: number(a, 'radius', undefined, 0, 1e6),
                decay: number(a, 'decay', 80, 5, 100),
                segments: count(a, 'segments', 10, 1, 1000),
                style: enumOf(a.style ?? 'counterclockwise', ['counterclockwise', 'clockwise'], { name: 'style' }),
            });
            return run('Create spiral', script(`${placement(a)}${DRAW}
var it = __drawPath(layer, ${json(pts)}, false);
it.filled = false; it.stroked = true;
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`));
        },
    },
    {
        name: 'create_rectangular_grid',
        description: 'Draw a rectangular grid (Rectangular Grid tool, with its options dialog) as a group: horizontal and vertical dividers with skew, and the outside edges as one rectangle (Use Outside Rectangle As Frame) or as four lines. With fill, the frame is filled (Fill Grid)',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                ...BOX('grid'),
                width: { type: 'number', minimum: 0, description: 'Default Size: width in points' },
                height: { type: 'number', minimum: 0, description: 'Default Size: height in points' },
                horizontalDividers: DIVIDERS('horizontal lines between the top and bottom edges'),
                horizontalSkew: SKEW('the top', 'the bottom'),
                verticalDividers: DIVIDERS('vertical lines between the left and right edges'),
                verticalSkew: SKEW('the right', 'the left'),
                frame: { type: 'boolean', description: 'Use Outside Rectangle As Frame: draw the outside edges as one rectangle. Default true', default: true },
                ...STYLE_PROPS,
            },
            required: ['x', 'y', 'width', 'height'],
        },
        features: [
            'illustrator.shapes.rectangular_grid_tool',
            'illustrator.shapes.rect_grid_option.default_size_grid',
            'illustrator.shapes.rect_grid_option.horizontal_dividers',
            'illustrator.shapes.rect_grid_option.vertical_dividers',
            'illustrator.shapes.rect_grid_option.use_outside_rectangle_as_frame',
            'illustrator.shapes.rect_grid_option.fill_grid',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { horizontalDividers: 4, horizontalSkew: 30, verticalDividers: 3, verticalSkew: -20, frame: true, fill: 'gray(10)' },
        handler: (a) => {
            const g = {
                x: number(a, 'x', undefined, -1e6, 1e6), y: number(a, 'y', undefined, -1e6, 1e6),
                width: number(a, 'width', undefined, 0, 1e6), height: number(a, 'height', undefined, 0, 1e6),
                horizontalDividers: count(a, 'horizontalDividers', 5, 0, 500), horizontalSkew: number(a, 'horizontalSkew', 0, -500, 500),
                verticalDividers: count(a, 'verticalDividers', 5, 0, 500), verticalSkew: number(a, 'verticalSkew', 0, -500, 500),
                frame: a.frame ?? true,
            };
            const lines = rectGridLines(g);
            return run('Create rectangular grid', script(`${placement(a)}${DRAW}
${paintStatements(a)}
var lines = ${json(lines)}, g = layer.groupItems.add(), i;
${g.frame ? `var tl = __toDoc(doc, ab, lines.frame.left, lines.frame.top);
__paint(g.pathItems.rectangle(tl[1], tl[0], __len(doc, lines.frame.width), __len(doc, lines.frame.height)), true);` : ''}
for (i = 0; i < lines.horizontal.length; i++) __paint(__drawLine(g, lines.horizontal[i][0], lines.horizontal[i][1]), false);
for (i = 0; i < lines.vertical.length; i++) __paint(__drawLine(g, lines.vertical[i][0], lines.vertical[i][1]), false);
${groupStatements(a)}
var info = __itemInfo(doc, g);
info.horizontalLines = lines.horizontal.length; info.verticalLines = lines.vertical.length; info.frame = ${bool(g.frame)};
__result__ = info;`));
        },
    },
    {
        name: 'create_polar_grid',
        description: 'Draw a polar grid (Polar Grid tool, with its options dialog) as a group: concentric ellipses and radial lines, each with skew. compoundPath makes every other ring a compound path (Create Compound Path From Ellipses). With fill, the ellipses are filled (Fill Grid)',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                ...BOX('grid'),
                width: { type: 'number', minimum: 0, description: 'Default Size: width in points' },
                height: { type: 'number', minimum: 0, description: 'Default Size: height in points' },
                concentricDividers: DIVIDERS('ellipses inside the outer one'),
                concentricSkew: SKEW('the outside', 'the inside'),
                radialDividers: DIVIDERS('lines from the centre to the edge. The first points to 12 o\'clock'),
                radialSkew: { type: 'number', minimum: -500, maximum: 500, description: 'Skew, -500 to 500 percent. 0 spaces the lines evenly. Going counterclockwise from 12 o\'clock, positive makes each sector 1 + |skew|/100 times smaller than the one before, negative that much larger. Default 0' },
                compoundPath: { type: 'boolean', description: 'Create Compound Path From Ellipses: pair the ellipses from the outside in as compound paths, so alternate rings are filled. Default false', default: false },
                ...STYLE_PROPS,
            },
            required: ['x', 'y', 'width', 'height'],
        },
        features: [
            'illustrator.shapes.polar_grid_tool',
            'illustrator.shapes.polar_grid_option.concentric_dividers',
            'illustrator.shapes.polar_grid_option.radial_dividers',
            'illustrator.shapes.polar_grid_option.create_compound_path_from_ellipses',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { concentricDividers: 4, concentricSkew: 25, radialDividers: 8, radialSkew: -10, compoundPath: true, fill: '#3366CC' },
        handler: (a) => {
            const geo = polarGridGeometry({
                x: number(a, 'x', undefined, -1e6, 1e6), y: number(a, 'y', undefined, -1e6, 1e6),
                width: number(a, 'width', undefined, 0, 1e6), height: number(a, 'height', undefined, 0, 1e6),
                concentricDividers: count(a, 'concentricDividers', 5, 0, 500), concentricSkew: number(a, 'concentricSkew', 0, -500, 500),
                radialDividers: count(a, 'radialDividers', 5, 0, 500), radialSkew: number(a, 'radialSkew', 0, -500, 500),
            });
            return run('Create polar grid', script(`${placement(a)}${DRAW}
${paintStatements(a)}
var geo = ${json(geo)}, g = layer.groupItems.add(), i, rings = 0;
var ellipse = function (parent, e) {
  var tl = __toDoc(doc, ab, e.left, e.top);
  return parent.pathItems.ellipse(tl[1], tl[0], __len(doc, e.width), __len(doc, e.height));
};
${a.compoundPath ? `
for (i = 0; i < geo.ellipses.length; i += 2) {
  var cp = g.compoundPathItems.add();
  var pair = [ellipse(cp, geo.ellipses[i])];
  if (i + 1 < geo.ellipses.length) pair.push(ellipse(cp, geo.ellipses[i + 1]));
  for (var k = 0; k < pair.length; k++) { pair[k].evenodd = true; __paint(pair[k], true); }
  rings++;
}` : `
for (i = 0; i < geo.ellipses.length; i++) __paint(ellipse(g, geo.ellipses[i]), true);`}
for (i = 0; i < geo.radial.length; i++) __paint(__drawLine(g, geo.radial[i][0], geo.radial[i][1]), false);
${groupStatements(a)}
var info = __itemInfo(doc, g);
info.ellipses = geo.ellipses.length; info.radialLines = geo.radial.length; info.compoundPaths = rings;
__result__ = info;`));
        },
    },
    {
        name: 'convert_live_shapes',
        description: 'Turn paths that resemble rectangles, rounded rectangles, ellipses, polygons or lines into live shapes (Object > Shape > Convert to Shape), or turn live shapes back into ordinary paths (Object > Shape > Expand Shape). Live-shape properties (width, height, angle, corner radii in the Transform panel) cannot be read or set by a script; move_items, rotate_items and scale_items transform live shapes',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(LIVE_SHAPE_COMMANDS), description: 'convert_to_shape or expand_shape' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.shapes.live_shape',
            'illustrator.shapes.convert_to_shape',
            'illustrator.shapes.expand_shape',
        ],
        menuCommands: Object.values(LIVE_SHAPE_COMMANDS),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { operation: 'expand_shape' },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(LIVE_SHAPE_COMMANDS), { name: 'operation' });
            return run('Convert live shapes', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand(${str(LIVE_SHAPE_COMMANDS[op])});
${SELECTION}
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
    {
        name: 'toggle_corner_widget',
        description: 'Show or hide the corner widget, the on-canvas control for rounding live-shape corners (View > Show / Hide Corner Widget). It flips the current state; Illustrator does not report which state results',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.shapes.corner_widget'],
        menuCommands: ['Live Corner Annotator'],
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: () => run('Toggle corner widget', script(`
app.executeMenuCommand("Live Corner Annotator");
__result__ = { toggled: true };`)),
    },
];
