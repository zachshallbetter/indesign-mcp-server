/**
 * Paths and shapes: draw shape layers, paths or filled pixels from rectangles,
 * ellipses, triangles, polygons, stars, lines, custom shapes and pen points;
 * list, rename, duplicate, delete, select, fill and stroke paths; load them as
 * selections, make work paths and clipping paths; edit anchor points.
 *
 * Path coordinates are pixels from the document's top-left corner. Photoshop
 * reads path point positions in points (1/72 inch), so scripts that build or
 * read paths set the document to 72 ppi without resampling while they work,
 * which makes points and pixels equal, and restore the resolution afterwards.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';

/** Bezier handle length for a quarter circle, as a fraction of the radius. */
const KAPPA = 0.5522847498;
const OPERATIONS = ['combine', 'subtract', 'intersect', 'exclude'];
const SHAPES = ['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'points', 'custom'];
const COMBINE = { replace: 'REPLACE', add: 'EXTEND', subtract: 'DIMINISH', intersect: 'INTERSECT' };
const STROKE_TOOLS = {
    brush: 'BRUSH', pencil: 'PENCIL', eraser: 'ERASER', background_eraser: 'BACKGROUNDERASER', clone_stamp: 'CLONESTAMP',
    pattern_stamp: 'PATTERNSTAMP', healing_brush: 'HEALINGBRUSH', history_brush: 'HISTORYBRUSH', art_history_brush: 'ARTHISTORYBRUSH',
    smudge: 'SMUDGE', blur: 'BLUR', sharpen: 'SHARPEN', dodge: 'DODGE', burn: 'BURN', sponge: 'SPONGE', color_replacement: 'COLORREPLACEMENTTOOL',
};
const XY = {
    type: 'object',
    properties: { x: { type: 'number', description: 'Pixels from the left' }, y: { type: 'number', description: 'Pixels from the top' } },
    required: ['x', 'y'],
};
const POINT_SCHEMA = {
    type: 'object',
    description: 'An anchor point, with optional direction handles',
    properties: {
        x: { type: 'number', description: 'Pixels from the left' },
        y: { type: 'number', description: 'Pixels from the top' },
        handleIn: { ...XY, description: 'Direction point of the segment arriving at this anchor. Default: the anchor (no curve)' },
        handleOut: { ...XY, description: 'Direction point of the segment leaving this anchor. Default: the anchor (no curve)' },
        smooth: { type: 'boolean', description: 'A smooth point (handles move together) rather than a corner point' },
    },
    required: ['x', 'y'],
};

const COMPONENT_SCHEMA = {
    type: 'object',
    description: 'One path component. rectangle, ellipse, triangle, polygon, star and custom fill the box x, y, width, height; line runs from "from" to "to"; points follows the anchor points as the Pen tools draw them',
    properties: {
        shape: { type: 'string', enum: SHAPES, description: 'Rectangle, Ellipse, Triangle, Polygon, Star, Line or Custom Shape tool, or pen points' },
        x: { type: 'number', description: 'Box left, pixels' },
        y: { type: 'number', description: 'Box top, pixels' },
        width: { type: 'number', minimum: 0.01, description: 'Box width (W), pixels' },
        height: { type: 'number', minimum: 0.01, description: 'Box height (H), pixels' },
        cornerRadius: {
            description: 'rectangle: radius of the rounded corners in pixels, one number or [top-left, top-right, bottom-right, bottom-left]',
            oneOf: [{ type: 'number', minimum: 0 }, { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 4, maxItems: 4 }],
        },
        sides: { type: 'integer', minimum: 3, maximum: 100, description: 'polygon: number of sides; star: number of points. Default 5' },
        indent: { type: 'number', minimum: 1, maximum: 99, description: 'star: indent sides by this percent of the radius. Default 50' },
        from: { ...XY, description: 'line: start point' },
        to: { ...XY, description: 'line: end point' },
        weight: { type: 'number', minimum: 0.01, maximum: 1000, description: 'line: thickness in pixels. Default 1' },
        points: { type: 'array', items: POINT_SCHEMA, minItems: 2, maxItems: 5000, description: 'points: anchor points in drawing order' },
        closed: { type: 'boolean', description: 'points: close the path back to the first point. Default true' },
        curve: { type: 'boolean', description: 'points: give points without handles smooth curves through their neighbours, as the Curvature and Freeform Pen tools do. Default false' },
        name: { type: 'string', description: 'custom: the custom shape preset name (Shapes panel)' },
        operation: { type: 'string', enum: OPERATIONS, description: 'Path operation with the components before it: combine shapes (default), subtract front shape, intersect shape areas or exclude overlapping shapes' },
    },
    required: ['shape'],
};

/** A finite pixel coordinate, checked. */
const coord = (v, name) => Number(num(v, { min: -300000, max: 300000, name }));
/** An anchor point with no handles: { a, l, r, smooth } as the scripts expect. */
const corner = (x, y) => ({ a: [x, y], l: [x, y], r: [x, y], smooth: false });
const xy = (p, name) => {
    if (!p || typeof p !== 'object') throw new Error(`'${name}' must be { x, y }`);
    return [coord(p.x, `${name}.x`), coord(p.y, `${name}.y`)];
};

/** The checked box of a component. */
function box(c, name) {
    const x = coord(c.x, `${name}.x`), y = coord(c.y, `${name}.y`);
    const w = Number(num(c.width, { min: 0.01, max: 300000, name: `${name}.width` }));
    const h = Number(num(c.height, { min: 0.01, max: 300000, name: `${name}.height` }));
    return { x, y, w, h };
}

/** Rectangle points clockwise from the top-left, rounding corners with radius > 0. */
function rectanglePoints({ x, y, w, h }, radii) {
    const corners = [[x, y, x, y + radii[0], x + radii[0], y], [x + w, y, x + w - radii[1], y, x + w, y + radii[1]],
        [x + w, y + h, x + w, y + h - radii[2], x + w - radii[2], y + h], [x, y + h, x + radii[3], y + h, x, y + h - radii[3]]];
    const pts = [];
    corners.forEach(([cx, cy, ex, ey, xx, xy2], i) => {
        if (!radii[i]) { pts.push(corner(cx, cy)); return; }
        const toward = (px, py) => [px + KAPPA * (cx - px), py + KAPPA * (cy - py)];
        pts.push({ a: [ex, ey], l: [ex, ey], r: toward(ex, ey), smooth: false });
        pts.push({ a: [xx, xy2], l: toward(xx, xy2), r: [xx, xy2], smooth: false });
    });
    return pts;
}

/** Ellipse points clockwise from the top. */
function ellipsePoints({ x, y, w, h }) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, kx = KAPPA * rx, ky = KAPPA * ry;
    return [
        { a: [cx, y], l: [cx - kx, y], r: [cx + kx, y], smooth: true },
        { a: [x + w, cy], l: [x + w, cy - ky], r: [x + w, cy + ky], smooth: true },
        { a: [cx, y + h], l: [cx + kx, y + h], r: [cx - kx, y + h], smooth: true },
        { a: [x, cy], l: [x, cy + ky], r: [x, cy - ky], smooth: true },
    ];
}

/** Regular polygon or star points inscribed in the box, the first at the top. */
function radialPoints({ x, y, w, h }, count, inner) {
    const cx = x + w / 2, cy = y + h / 2, n = inner === null ? count : count * 2;
    return Array.from({ length: n }, (_, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n, k = inner !== null && i % 2 ? inner : 1;
        return corner(cx + (w / 2) * k * Math.cos(angle), cy + (h / 2) * k * Math.sin(angle));
    });
}

/** Handles for points that have none, from their neighbours (a Catmull-Rom curve). */
function smoothCurve(pts, given, closed) {
    const n = pts.length;
    return pts.map((p, i) => {
        if (given[i]) return p;
        const prev = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)].a, next = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)].a;
        const tx = (next[0] - prev[0]) / 6, ty = (next[1] - prev[1]) / 6;
        return { a: p.a, l: [p.a[0] - tx, p.a[1] - ty], r: [p.a[0] + tx, p.a[1] + ty], smooth: true };
    });
}

/** One component as { closed, op, pts }, checked. */
function component(c, i) {
    const name = `components[${i}]`;
    if (!c || typeof c !== 'object') throw new Error(`'${name}' must be an object`);
    const shape = enumOf(c.shape, SHAPES, { name: `${name}.shape` });
    const op = enumOf(c.operation ?? 'combine', OPERATIONS, { name: `${name}.operation` });
    const out = { shape, closed: true, op };
    if (shape === 'rectangle') {
        const b = box(c, name);
        const r = c.cornerRadius === undefined ? [0, 0, 0, 0] : Array.isArray(c.cornerRadius) ? c.cornerRadius : [c.cornerRadius, c.cornerRadius, c.cornerRadius, c.cornerRadius];
        if (r.length !== 4) throw new Error(`'${name}.cornerRadius' takes one number or four`);
        const radii = r.map((v) => Math.min(Number(num(v, { min: 0, max: 300000, name: `${name}.cornerRadius` })), b.w / 2, b.h / 2));
        return { ...out, box: b, radii, pts: rectanglePoints(b, radii) };
    }
    if (shape === 'ellipse') { const b = box(c, name); return { ...out, box: b, pts: ellipsePoints(b) }; }
    if (shape === 'triangle') { const b = box(c, name); return { ...out, pts: [corner(b.x + b.w / 2, b.y), corner(b.x + b.w, b.y + b.h), corner(b.x, b.y + b.h)] }; }
    if (shape === 'polygon' || shape === 'star') {
        const b = box(c, name);
        const count = Number(index(c.sides ?? 5, { name: `${name}.sides`, max: 100 }));
        if (count < 3) throw new Error(`'${name}.sides' must be 3 or more`);
        const inner = shape === 'star' ? 1 - Number(num(c.indent ?? 50, { min: 1, max: 99, name: `${name}.indent` })) / 100 : null;
        return { ...out, pts: radialPoints(b, count, inner) };
    }
    if (shape === 'line') {
        const [x1, y1] = xy(c.from, `${name}.from`), [x2, y2] = xy(c.to, `${name}.to`);
        const weight = Number(num(c.weight ?? 1, { min: 0.01, max: 1000, name: `${name}.weight` }));
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (!len) throw new Error(`'${name}': from and to are the same point`);
        const nx = (-(y2 - y1) / len) * (weight / 2), ny = ((x2 - x1) / len) * (weight / 2);
        return { ...out, pts: [corner(x1 + nx, y1 + ny), corner(x2 + nx, y2 + ny), corner(x2 - nx, y2 - ny), corner(x1 - nx, y1 - ny)] };
    }
    if (shape === 'custom') {
        if (typeof c.name !== 'string' || !c.name) throw new Error(`'${name}.name' must name a custom shape preset`);
        return { ...out, box: box(c, name), preset: c.name };
    }
    if (!Array.isArray(c.points) || c.points.length < 2) throw new Error(`'${name}.points' needs at least 2 points`);
    if (c.points.length > 5000) throw new Error(`'${name}.points' takes at most 5000 points`);
    const given = [];
    let pts = c.points.map((p, j) => {
        const pn = `${name}.points[${j}]`;
        const a = xy(p, pn);
        given.push(p.handleIn !== undefined || p.handleOut !== undefined);
        return { a, l: p.handleIn !== undefined ? xy(p.handleIn, `${pn}.handleIn`) : a, r: p.handleOut !== undefined ? xy(p.handleOut, `${pn}.handleOut`) : a, smooth: Boolean(p.smooth) };
    });
    const closed = c.closed ?? true;
    if (c.curve) pts = smoothCurve(pts, given, closed);
    return { ...out, closed: Boolean(closed), pts };
}

/** JSX helpers shared by the path tools. */
const PATH_HELPERS = `
var __OPS = { combine: ShapeOperation.SHAPEADD, subtract: ShapeOperation.SHAPESUBTRACT, intersect: ShapeOperation.SHAPEINTERSECT, exclude: ShapeOperation.SHAPEXOR };
var __at72 = function (fn) {
  var res = doc.resolution;
  if (res !== 72) doc.resizeImage(undefined, undefined, 72, ResampleMethod.NONE);
  try { return fn(); } finally { if (res !== 72) doc.resizeImage(undefined, undefined, res, ResampleMethod.NONE); }
};
var __subPaths = function (comps) {
  var subs = [];
  for (var i = 0; i < comps.length; i++) {
    var c = comps[i], pts = [];
    for (var j = 0; j < c.pts.length; j++) {
      var p = c.pts[j], info = new PathPointInfo();
      info.kind = p.smooth ? PointKind.SMOOTHPOINT : PointKind.CORNERPOINT;
      info.anchor = p.a;
      info.leftDirection = p.l;
      info.rightDirection = p.r;
      pts.push(info);
    }
    var sp = new SubPathInfo();
    sp.closed = c.closed;
    sp.operation = __OPS[c.op];
    sp.entireSubPath = pts;
    subs.push(sp);
  }
  return subs;
};
var __opName = function (op) {
  for (var k in __OPS) if (__OPS.hasOwnProperty(k) && __OPS[k] === op) return k;
  return null;
};
var __xy = function (v) { return [Math.round(Number(v[0]) * 1000) / 1000, Math.round(Number(v[1]) * 1000) / 1000]; };
var __readPath = function (path) {
  var comps = [];
  for (var i = 0; i < path.subPathItems.length; i++) {
    var s = path.subPathItems[i], pts = [];
    for (var j = 0; j < s.pathPoints.length; j++) {
      var q = s.pathPoints[j];
      pts.push({ a: __xy(q.anchor), l: __xy(q.leftDirection), r: __xy(q.rightDirection), smooth: q.kind === PointKind.SMOOTHPOINT });
    }
    comps.push({ closed: s.closed, op: __opName(s.operation), pts: pts });
  }
  return comps;
};
var __pathInfo = function (path, i, withPoints) {
  var info = { index: i, name: path.name, kind: __enumName(path.kind), subpaths: path.subPathItems.length };
  if (withPoints) info.components = __at72(function () { return __readPath(path); });
  return info;
};
var __pathIndex = function (path) {
  for (var i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].name === path.name) return i;
  return -1;
};
var __findPath = function (spec) {
  var i;
  if (spec.index !== undefined) {
    if (spec.index >= doc.pathItems.length) throw new Error("No path at index " + spec.index + "; the document has " + doc.pathItems.length);
    return doc.pathItems[spec.index];
  }
  for (i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].name === spec.name) return doc.pathItems[i];
  throw new Error("No path named " + spec.name);
};
var __freeName = function (base) {
  var taken = {}, i;
  for (i = 0; i < doc.pathItems.length; i++) taken[doc.pathItems[i].name] = true;
  if (!taken[base]) return base;
  for (i = 2; taken[base + " " + i]; i++) {}
  return base + " " + i;
};`;

/** The path a tool acts on, from `path` (name) or `pathIndex`, as a JSX literal. */
function pathSpec(a) {
    if (a.path !== undefined && a.pathIndex !== undefined) throw new Error('Give path or pathIndex, not both');
    if (a.pathIndex !== undefined) return json({ index: Number(index(a.pathIndex, { name: 'pathIndex', max: 10000 })) });
    if (typeof a.path === 'string' && a.path) return json({ name: a.path });
    throw new Error('Choose the path: path (its name, from list_paths) or pathIndex');
}

const PATH_TARGET = {
    path: { type: 'string', description: 'Path name, as in the Paths panel (list_paths)' },
    pathIndex: { type: 'integer', minimum: 0, description: 'Path index from list_paths, instead of its name' },
};

/**
 * JSX helpers that make shape layers through the Action Manager: make a
 * contentLayer filled with a solid colour, from an explicit shape descriptor,
 * or from the path selected in the Paths panel when no shape is given.
 */
const SHAPE_HELPERS = `
var __sid = function (s) { return app.stringIDToTypeID(s); };
var __shapeLayer = function (color, shapeClass, shape) {
  var d = new ActionDescriptor(), r = new ActionReference(), u = new ActionDescriptor(), fill = new ActionDescriptor(), rgb = new ActionDescriptor();
  r.putClass(__sid("contentLayer"));
  d.putReference(app.charIDToTypeID("null"), r);
  rgb.putDouble(__sid("red"), color.rgb.red);
  rgb.putDouble(__sid("grain"), color.rgb.green);
  rgb.putDouble(__sid("blue"), color.rgb.blue);
  fill.putObject(__sid("color"), __sid("RGBColor"), rgb);
  u.putObject(__sid("type"), __sid("solidColorLayer"), fill);
  if (shape) u.putObject(__sid("shape"), __sid(shapeClass), shape);
  d.putObject(__sid("using"), __sid("contentLayer"), u);
  app.executeAction(__sid("make"), d, DialogModes.NO);
  return doc.activeLayer;
};
var __bounds4 = function (s, b) {
  s.putInteger(__sid("unitValueQuadVersion"), 1);
  s.putUnitDouble(__sid("top"), __sid("pixelsUnit"), b[1]);
  s.putUnitDouble(__sid("left"), __sid("pixelsUnit"), b[0]);
  s.putUnitDouble(__sid("bottom"), __sid("pixelsUnit"), b[1] + b[3]);
  s.putUnitDouble(__sid("right"), __sid("pixelsUnit"), b[0] + b[2]);
  return s;
};`;

/** JSX statements that make a live rectangle, ellipse or custom shape layer. */
function liveShape(c) {
    const b = json([c.box.x, c.box.y, c.box.w, c.box.h]);
    if (c.shape === 'ellipse') return `var l = __shapeLayer(color, "ellipse", __bounds4(new ActionDescriptor(), ${b}));`;
    if (c.shape === 'custom') {
        return `var s = __bounds4(new ActionDescriptor(), ${b});
s.putString(__sid("name"), ${str(c.preset)});
var l = __shapeLayer(color, "customShape", s);`;
    }
    const [tl, tr, br, bl] = c.radii;
    return `var s = __bounds4(new ActionDescriptor(), ${b});
s.putUnitDouble(__sid("topLeft"), __sid("pixelsUnit"), ${tl});
s.putUnitDouble(__sid("topRight"), __sid("pixelsUnit"), ${tr});
s.putUnitDouble(__sid("bottomRight"), __sid("pixelsUnit"), ${br});
s.putUnitDouble(__sid("bottomLeft"), __sid("pixelsUnit"), ${bl});
var l = __shapeLayer(color, "rectangle", s);`;
}

/** The edit_path_points operations and the JSX that applies each to subpath `s`. */
const POINT_EDITS = ['add_point', 'delete_point', 'move_point', 'convert_point', 'set_operation'];

function editLines(a) {
    const op = enumOf(a.operation, POINT_EDITS, { name: 'operation' });
    if (op === 'set_operation') {
        return `s.op = ${str(enumOf(a.pathOperation, OPERATIONS, { name: 'pathOperation' }))};`;
    }
    const at = Number(index(a.point, { name: 'point', max: 5000 }));
    const anchor = a.x !== undefined || a.y !== undefined ? [coord(a.x, 'x'), coord(a.y, 'y')] : null;
    const hin = a.handleIn !== undefined ? xy(a.handleIn, 'handleIn') : null;
    const hout = a.handleOut !== undefined ? xy(a.handleOut, 'handleOut') : null;
    if (anchor && (a.x === undefined || a.y === undefined)) throw new Error('Give both x and y');
    const check = `if (${at} >= s.pts.length) throw new Error("Point ${at} is past the subpath's " + s.pts.length + " points");`;
    if (op === 'add_point') {
        if (anchor) {
            return `if (${at} > s.pts.length) throw new Error("Point ${at} is past the subpath's " + s.pts.length + " points");
s.pts.splice(${at}, 0, ${json({ a: anchor, l: hin ?? anchor, r: hout ?? anchor, smooth: Boolean(a.smooth) })});`;
        }
        // Split the segment that leaves point `at` in half, keeping the path's shape (Add Anchor Point tool).
        return `${check}
if (!s.closed && ${at} === s.pts.length - 1) throw new Error("Point ${at} ends an open subpath: no segment follows it");
var A = s.pts[${at}], B = s.pts[(${at} + 1) % s.pts.length];
var mid = function (u, v) { return [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]; };
var q0 = mid(A.a, A.r), q1 = mid(A.r, B.l), q2 = mid(B.l, B.a), r0 = mid(q0, q1), r1 = mid(q1, q2);
A.r = q0; B.l = q2;
s.pts.splice(${at} + 1, 0, { a: mid(r0, r1), l: r0, r: r1, smooth: true });`;
    }
    if (op === 'delete_point') {
        return `${check}
if (s.pts.length <= 2) throw new Error("A subpath needs at least 2 points");
s.pts.splice(${at}, 1);`;
    }
    if (op === 'move_point') {
        if (!anchor && !hin && !hout) throw new Error('move_point needs x and y, handleIn or handleOut');
        return `${check}
var p = s.pts[${at}];
${anchor ? `var dx = ${anchor[0]} - p.a[0], dy = ${anchor[1]} - p.a[1];
p.a = ${json(anchor)};
p.l = [p.l[0] + dx, p.l[1] + dy];
p.r = [p.r[0] + dx, p.r[1] + dy];` : ''}
${hin ? `p.l = ${json(hin)};` : ''}
${hout ? `p.r = ${json(hout)};` : ''}`;
    }
    const kind = enumOf(a.kind, ['smooth', 'corner'], { name: 'kind' });
    if (kind === 'corner' && !hin && !hout) {
        return `${check}
var p = s.pts[${at}];
p.l = [p.a[0], p.a[1]]; p.r = [p.a[0], p.a[1]]; p.smooth = false;`;
    }
    return `${check}
var p = s.pts[${at}], n = s.pts.length;
p.smooth = ${bool(kind === 'smooth')};
${hin || hout ? `${hin ? `p.l = ${json(hin)};` : ''}${hout ? `p.r = ${json(hout)};` : ''}` : `var pv = s.pts[s.closed ? (${at} - 1 + n) % n : Math.max(${at} - 1, 0)].a, nx = s.pts[s.closed ? (${at} + 1) % n : Math.min(${at} + 1, n - 1)].a;
var tx = (nx[0] - pv[0]) / 6, ty = (nx[1] - pv[1]) / 6;
p.l = [p.a[0] - tx, p.a[1] - ty]; p.r = [p.a[0] + tx, p.a[1] + ty];`}`;
}

const PATH_ACTIONS = ['rename', 'duplicate', 'delete', 'select', 'deselect', 'make_selection', 'make_work_path', 'make_clipping_path', 'fill', 'stroke', 'define_custom_shape', 'toggle_panel'];

export const tools = [
    {
        name: 'draw_vector_shape',
        description: 'Draw with the shape and pen tools: rectangles (with rounded corners), ellipses, triangles, polygons, stars, lines, custom shape presets and pen points, combined with path operations. Mode shape makes a shape layer filled with a colour; path adds a path to the Paths panel; pixels fills the shape on the active layer',
        inputSchema: {
            type: 'object',
            properties: {
                components: { type: 'array', items: COMPONENT_SCHEMA, minItems: 1, maxItems: 100, description: 'The shape\'s components, drawn in order; each one\'s operation combines it with those before it' },
                mode: { type: 'string', enum: ['shape', 'path', 'pixels'], description: 'Tool mode: shape layer (default), path, or pixels' },
                color: { ...COLOR_SCHEMA, description: 'Fill colour for shape and pixels modes. Default: the foreground colour' },
                name: { type: 'string', description: 'Name of the new shape layer, or of the new path (default "Path", numbered if taken)' },
                opacity: { type: 'number', minimum: 1, maximum: 100, description: 'pixels: fill opacity percent. Default 100' },
                antiAlias: { type: 'boolean', description: 'pixels: smooth the edges. Default true' },
            },
            required: ['components'],
        },
        auditArgs: {
            components: [{ shape: 'star', x: 10, y: 10, width: 100, height: 100, sides: 5, indent: 40 }, { shape: 'ellipse', x: 40, y: 40, width: 40, height: 40, operation: 'subtract' }],
            mode: 'shape', color: '#336699', opacity: undefined, antiAlias: undefined,
        },
        features: ['photoshop.vector.pen_tool', 'photoshop.vector.freeform_pen_tool', 'photoshop.vector.curvature_pen_tool', 'photoshop.vector.rectangle_tool', 'photoshop.vector.ellipse_tool', 'photoshop.vector.triangle_tool', 'photoshop.vector.polygon_tool', 'photoshop.vector.star_tool', 'photoshop.vector.line_tool', 'photoshop.vector.custom_shape_tool', 'photoshop.vector.mode_shape', 'photoshop.vector.mode_path', 'photoshop.vector.mode_pixels', 'photoshop.vector.shape_fill', 'photoshop.vector.shape_width_height', 'photoshop.vector.rounded_corner_radius', 'photoshop.vector.path_op_combine_shapes', 'photoshop.vector.path_op_subtract_front_shape', 'photoshop.vector.path_op_intersect_shape_areas', 'photoshop.vector.path_op_exclude_overlapping_shapes', 'photoshop.vector.shape_layer', 'photoshop.vector.new_path', 'photoshop.vector.path_object', 'photoshop.vector.subpath_component', 'photoshop.vector.anchor_point'],
        handler: (a) => {
            if (!Array.isArray(a.components) || !a.components.length) throw new Error("'components' needs at least one shape");
            if (a.components.length > 100) throw new Error("'components' takes at most 100 shapes");
            const mode = enumOf(a.mode ?? 'shape', ['shape', 'path', 'pixels'], { name: 'mode' });
            const comps = a.components.map(component);
            if (mode !== 'pixels' && (a.opacity !== undefined || a.antiAlias !== undefined)) throw new Error('opacity and antiAlias apply only to mode: pixels');
            if (mode === 'path' && a.color !== undefined) throw new Error('A path has no colour: use mode shape or pixels');
            if (comps.some((c) => c.shape === 'custom') && (comps.length > 1 || mode !== 'shape')) {
                throw new Error('A custom shape preset is drawn alone, as a shape layer (mode: shape)');
            }
            const color = a.color !== undefined ? `__color(${colorSpec(a.color)})` : 'app.foregroundColor';
            const opacity = num(a.opacity ?? 100, { min: 1, max: 100, name: 'opacity' });
            const data = json(comps.map(({ closed, op, pts }) => ({ closed, op, pts })));
            const live = mode === 'shape' && comps.length === 1 && ['rectangle', 'ellipse', 'custom'].includes(comps[0].shape);
            let body;
            if (live) {
                body = `var color = ${color};
${liveShape(comps[0])}
${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(l);`;
            } else if (mode === 'shape') {
                body = `var color = ${color};
var tmp = __at72(function () { return doc.pathItems.add(__freeName("Shape Path"), __subPaths(${data})); });
var l;
try { tmp.select(); l = __shapeLayer(color, null, null); } finally { tmp.remove(); }
${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(l);`;
            } else if (mode === 'path') {
                body = `var path = __at72(function () { return doc.pathItems.add(__freeName(${str(a.name ?? 'Path')}), __subPaths(${data})); });
__result__ = __pathInfo(path, __pathIndex(path), false);`;
            } else {
                body = `var tmp = __at72(function () { return doc.pathItems.add(__freeName("Fill Path"), __subPaths(${data})); });
try { tmp.fillPath(${color}, ColorBlendMode.NORMAL, ${opacity}, false, 0, ${bool(a.antiAlias ?? true)}, true); } finally { tmp.remove(); }
__result__ = __layerInfo(doc.activeLayer);`;
            }
            return run('Draw vector shape', script(`${PATH_HELPERS}${SHAPE_HELPERS}
${body}`));
        },
    },
    {
        name: 'list_paths',
        description: 'List the Paths panel: each path\'s index, name and kind (saved path, work path, clipping path, vector or type mask) and its number of components; optionally every component\'s anchor points and direction handles, in pixels',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'boolean', description: 'Include each component\'s operation, closed state and anchor points. Default false' },
                ...PATH_TARGET,
            },
        },
        hints: { readOnly: true },
        auditArgs: { path: undefined, pathIndex: undefined },
        features: ['photoshop.vector.path_object', 'photoshop.vector.work_path', 'photoshop.vector.subpath_component', 'photoshop.vector.anchor_point'],
        handler: (a) => {
            const one = a.path !== undefined || a.pathIndex !== undefined;
            return run('List paths', script(`${PATH_HELPERS}
${one ? `var path = __findPath(${pathSpec(a)});
__result__ = __pathInfo(path, __pathIndex(path), ${bool(a.points)});` : `var out = [];
for (var i = 0; i < doc.pathItems.length; i++) out.push(__pathInfo(doc.pathItems[i], i, ${bool(a.points)}));
__result__ = { paths: out };`}`));
        },
    },
    {
        name: 'manage_paths',
        description: 'Paths panel commands: rename, duplicate or delete a path; select or deselect it (Path Selection); load it as a selection (Make Selection); make a work path from the selection (Make Work Path); make it the clipping path; fill or stroke it on the active layer; save it as a custom shape preset (Edit > Define Custom Shape); or show/hide the Paths panel',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: PATH_ACTIONS, description: 'The command' },
                ...PATH_TARGET,
                newName: { type: 'string', description: 'rename: the new name; duplicate: the copy\'s name; define_custom_shape: the preset name' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'make_selection and fill: feather radius in pixels. Default 0' },
                antiAlias: { type: 'boolean', description: 'make_selection and fill: anti-aliased edges. Default true' },
                combine: { type: 'string', enum: Object.keys(COMBINE), description: 'make_selection: how it combines with the current selection. Default replace' },
                tolerance: { type: 'number', minimum: 0.5, maximum: 10, description: 'make_work_path: tolerance in pixels (lower follows the selection more closely). Default 2' },
                flatness: { type: 'number', minimum: 0.2, maximum: 100, description: 'make_clipping_path: flatness in device pixels. Default: the printer\'s' },
                color: { ...COLOR_SCHEMA, description: 'fill: colour. Default: the foreground colour' },
                opacity: { type: 'number', minimum: 1, maximum: 100, description: 'fill: opacity percent. Default 100' },
                preserveTransparency: { type: 'boolean', description: 'fill: leave transparent pixels transparent. Default false' },
                tool: { type: 'string', enum: Object.keys(STROKE_TOOLS), description: 'stroke: the painting tool, with its current settings. Default brush' },
                simulatePressure: { type: 'boolean', description: 'stroke: taper the stroke as pen pressure would. Default false' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        auditArgs: { action: 'make_selection', path: 'Path 1', pathIndex: undefined, combine: 'add', color: '#FF0000' },
        features: ['photoshop.vector.paths_panel', 'photoshop.vector.path_selection_tool', 'photoshop.vector.rename_path', 'photoshop.vector.select_deselect_path', 'photoshop.vector.duplicate_path', 'photoshop.vector.delete_path', 'photoshop.vector.make_selection_from_path', 'photoshop.vector.make_work_path_from_selection', 'photoshop.vector.work_path', 'photoshop.vector.clipping_path', 'photoshop.vector.define_custom_shape'],
        handler: (a) => {
            const action = enumOf(a.action, PATH_ACTIONS, { name: 'action' });
            if (action === 'toggle_panel') {
                return run('Toggle Paths panel', script(`
app.runMenuItem(app.stringIDToTypeID("togglePathsPalette"));
__result__ = { toggled: "paths" };`, { needsDocument: false }));
            }
            if (action === 'make_work_path') {
                return run('Make work path', script(`${PATH_HELPERS}
var hasSelection = true;
try { doc.selection.bounds; } catch (e) { hasSelection = false; }
if (!hasSelection) throw new Error("Make Work Path needs a selection");
doc.selection.makeWorkPath(${num(a.tolerance ?? 2, { min: 0.5, max: 10, name: 'tolerance' })});
var path = null;
for (var i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].kind === PathKind.WORKPATH) path = __pathInfo(doc.pathItems[i], i, false);
__result__ = path;`));
            }
            const spec = pathSpec(a);
            const needName = ['rename', 'define_custom_shape'].includes(action);
            if (needName && (typeof a.newName !== 'string' || !a.newName)) throw new Error(`${action} needs newName`);
            const body = {
                rename: `path.name = ${str(a.newName)};
__result__ = __pathInfo(path, __pathIndex(path), false);`,
                duplicate: `var copy = path.duplicate(${a.newName ? str(a.newName) : '__freeName(path.name + " copy")'});
__result__ = __pathInfo(copy, __pathIndex(copy), false);`,
                delete: `var gone = path.name;
path.remove();
__result__ = { deleted: gone, remaining: doc.pathItems.length };`,
                select: `path.select();
__result__ = __pathInfo(path, __pathIndex(path), false);`,
                deselect: `path.deselect();
__result__ = __pathInfo(path, __pathIndex(path), false);`,
                make_selection: `path.makeSelection(${num(a.feather ?? 0, { min: 0, max: 1000, name: 'feather' })}, ${bool(a.antiAlias ?? true)}, SelectionType.${COMBINE[enumOf(a.combine ?? 'replace', Object.keys(COMBINE), { name: 'combine' })]});
var b = null;
try { b = __bounds({ bounds: doc.selection.bounds }); } catch (e) {}
__result__ = { path: path.name, selection: b };`,
                make_clipping_path: `path.makeClippingPath(${a.flatness !== undefined ? num(a.flatness, { min: 0.2, max: 100, name: 'flatness' }) : ''});
__result__ = __pathInfo(path, __pathIndex(path), false);`,
                fill: `path.fillPath(${a.color !== undefined ? `__color(${colorSpec(a.color)})` : 'app.foregroundColor'}, ColorBlendMode.NORMAL, ${num(a.opacity ?? 100, { min: 1, max: 100, name: 'opacity' })}, ${bool(a.preserveTransparency)}, ${num(a.feather ?? 0, { min: 0, max: 1000, name: 'feather' })}, ${bool(a.antiAlias ?? true)}, true);
__result__ = { path: path.name, layer: __layerInfo(doc.activeLayer) };`,
                stroke: `path.strokePath(ToolType.${STROKE_TOOLS[enumOf(a.tool ?? 'brush', Object.keys(STROKE_TOOLS), { name: 'tool' })]}, ${bool(a.simulatePressure)});
__result__ = { path: path.name, layer: __layerInfo(doc.activeLayer) };`,
                define_custom_shape: `path.select();
var d = new ActionDescriptor();
d.putString(app.stringIDToTypeID("name"), ${str(a.newName)});
app.executeAction(app.stringIDToTypeID("defineCustomShape"), d, DialogModes.NO);
__result__ = { path: path.name, customShape: ${str(a.newName)} };`,
            }[action];
            return run('Manage paths', script(`${PATH_HELPERS}
var path = __findPath(${spec});
${body}`));
        },
    },
    {
        name: 'edit_path_points',
        description: 'Edit a path\'s anchor points, as the Add Anchor Point, Delete Anchor Point, Convert Point and Direct Selection tools do: add a point (splitting a segment in half without changing its shape, or at a position), delete one, move a point or its direction handles, convert it between smooth and corner, or change a component\'s path operation. The path is rebuilt under its name; a work path becomes a saved path',
        inputSchema: {
            type: 'object',
            properties: {
                ...PATH_TARGET,
                component: { type: 'integer', minimum: 0, description: 'Component (subpath) index from list_paths. Default 0' },
                operation: { type: 'string', enum: POINT_EDITS, description: 'The edit' },
                point: { type: 'integer', minimum: 0, description: 'Point index in the component. add_point: without x and y, splits the segment after this point; with them, inserts the new point at this index' },
                x: { type: 'number', description: 'add_point and move_point: anchor position, pixels from the left' },
                y: { type: 'number', description: 'add_point and move_point: anchor position, pixels from the top' },
                handleIn: { ...XY, description: 'Direction point of the arriving segment, pixels' },
                handleOut: { ...XY, description: 'Direction point of the leaving segment, pixels' },
                smooth: { type: 'boolean', description: 'add_point with x and y: make a smooth point. Default false' },
                kind: { type: 'string', enum: ['smooth', 'corner'], description: 'convert_point: smooth computes handles from the neighbouring points unless handles are given; corner retracts the handles unless handles are given' },
                pathOperation: { type: 'string', enum: OPERATIONS, description: 'set_operation: combine, subtract, intersect or exclude' },
            },
            required: ['operation'],
        },
        auditArgs: { path: 'Path 1', pathIndex: undefined, operation: 'add_point', point: 0, x: undefined, y: undefined, handleIn: undefined, handleOut: undefined },
        features: ['photoshop.vector.add_anchor_point_tool', 'photoshop.vector.delete_anchor_point_tool', 'photoshop.vector.convert_point_tool', 'photoshop.vector.direct_selection_tool', 'photoshop.vector.anchor_point', 'photoshop.vector.subpath_component'],
        handler: (a) => {
            const spec = pathSpec(a);
            const sub = Number(index(a.component ?? 0, { name: 'component', max: 10000 }));
            const lines = editLines(a);
            return run('Edit path points', script(`${PATH_HELPERS}
var path = __findPath(${spec});
if (path.kind === PathKind.VECTORMASK || path.kind === PathKind.TEXTMASK) throw new Error(path.name + " is a vector or type mask: edit saved paths and work paths");
var name = path.name, wasClipping = path.kind === PathKind.CLIPPINGPATH;
var rebuilt = __at72(function () {
  var comps = __readPath(path);
  if (${sub} >= comps.length) throw new Error(name + " has " + comps.length + " component(s)");
  var s = comps[${sub}];
  ${lines.split('\n').join('\n  ')}
  var fresh = doc.pathItems.add(__freeName(name + " edit"), __subPaths(comps));
  path.remove();
  fresh.name = name;
  return fresh;
});
if (wasClipping) rebuilt.makeClippingPath();
__result__ = __pathInfo(rebuilt, __pathIndex(rebuilt), true);`));
        },
    },
];
