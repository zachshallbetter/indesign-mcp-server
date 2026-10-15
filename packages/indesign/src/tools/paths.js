/**
 * Paths and pathfinder: drawing paths point by point (Pen and Pencil tools),
 * editing anchor points and direction handles, cutting, joining, opening,
 * closing and reversing paths, compound paths, the Pathfinder operations,
 * Convert Shape, live corners, clipping paths and Create Outlines.
 *
 * Points are [x, y] in mm from the top-left of the item's page (of the page
 * drawn on, for draw_path); an item on the pasteboard is measured from the
 * ruler origin. Point and path indexes are 0-based.
 */
import { enumOf, num, index, bool, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';

/** Atlas feature ids of this area. */
const geo = (ids) => ids.map((f) => `indesign.geometry.${f}`);

const has = (v) => v !== undefined && v !== null;

/** Refuse option keys a schema does not define. */
function known(o, keys, name) {
    for (const k of Object.keys(o)) {
        if (!keys.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${keys.join(', ')}`);
    }
}

/** A boolean argument, refusing anything else. */
function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

/** An [x, y] point in mm as a JSX array literal. */
function xy(p, name) {
    if (!Array.isArray(p) || p.length !== 2) throw new Error(`'${name}' must be [x, y] in mm`);
    return `[${num(p[0], { name: `${name}[0]`, min: -10000, max: 10000 })}, ${num(p[1], { name: `${name}[1]`, min: -10000, max: 10000 })}]`;
}

/** Anchor point types (Object > Convert Point; Convert Direction Point tool). */
export const POINT_TYPES = { plain: 'PLAIN', corner: 'CORNER', smooth: 'SMOOTH', symmetrical: 'SYMMETRICAL' };

const POINT_SCHEMA = {
    type: 'object',
    properties: {
        anchor: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Anchor point [x, y] (mm)' },
        left: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Incoming direction handle [x, y] (mm); defaults to the anchor (no curve)' },
        right: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Outgoing direction handle [x, y] (mm); defaults to the anchor (no curve)' },
        type: { type: 'string', enum: Object.keys(POINT_TYPES), description: 'Point type: plain, corner, smooth or symmetrical' },
    },
    required: ['anchor'],
};

/**
 * Validate one point and return { triple, type }: the JSX literal of
 * [left, anchor, right] in document coordinates (through __toDoc with page
 * bounds `b`), and its PointType member or null.
 */
function pointSpec(p, name) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new Error(`'${name}' must be { anchor, left?, right?, type? }`);
    known(p, ['anchor', 'left', 'right', 'type'], name);
    const a = xy(p.anchor, `${name}.anchor`);
    const l = has(p.left) ? xy(p.left, `${name}.left`) : a;
    const r = has(p.right) ? xy(p.right, `${name}.right`) : a;
    const type = has(p.type) ? POINT_TYPES[enumOf(p.type, Object.keys(POINT_TYPES), { name: `${name}.type` })] : null;
    return { triple: `[__toDoc(b, ${l}), __toDoc(b, ${a}), __toDoc(b, ${r})]`, type };
}

/** ES3 helpers: page offsets, points as [left, anchor, right], and reading paths. */
const HELPERS = String.raw`
var __base = function (it) { var pg = __pageOf(it); return pg ? pg.bounds : [0, 0, 0, 0]; };
var __toDoc = function (b, p) { return [b[1] + p[0], b[0] + p[1]]; };
var __fromDoc = function (b, p) { return [p[0] - b[1], p[1] - b[0]]; };
var __triples = function (path) {
  var out = [], pts = path.pathPoints;
  for (var i = 0; i < pts.length; i++) { var q = pts.item(i); out.push([q.leftDirection, q.anchor, q.rightDirection]); }
  return out;
};
var __pathOf = function (it, i) {
  var ps = it.paths;
  if (i < 0 || i >= ps.length) throw new Error("Item " + it.id + " has " + ps.length + " path(s); there is no path " + i);
  return ps.item(i);
};
var __pointIndex = function (path, i) {
  if (i < 0 || i >= path.pathPoints.length) throw new Error("The path has " + path.pathPoints.length + " points; there is no point " + i);
  return i;
};
var __paths = function (it) {
  var b = __base(it), out = [];
  for (var i = 0; i < it.paths.length; i++) {
    var p = it.paths.item(i), pts = [];
    for (var j = 0; j < p.pathPoints.length; j++) {
      var q = p.pathPoints.item(j);
      pts.push({ anchor: __fromDoc(b, q.anchor), left: __fromDoc(b, q.leftDirection), right: __fromDoc(b, q.rightDirection), type: __enumName(q.pointType) });
    }
    out.push({ index: i, type: __enumName(p.pathType), points: pts });
  }
  return out;
};
var __pathSummary = function (it) {
  var info = __itemInfo(it), ps = [];
  try { for (var i = 0; i < it.paths.length; i++) ps.push({ type: __enumName(it.paths.item(i).pathType), points: it.paths.item(i).pathPoints.length }); } catch (e) {}
  info.paths = ps;
  return info;
};
`;

const body = (code, opts) => script(HELPERS + code, opts);

const EDIT_ACTIONS = ['open', 'close', 'reverse', 'set_point_type', 'add_point', 'move_point', 'delete_point', 'cut', 'join'];

/** The options each edit_path action accepts besides target and action. */
const EDIT_OPTIONS = {
    open: ['path'], close: ['path'], reverse: ['path'],
    set_point_type: ['path', 'points', 'pointType'],
    add_point: ['path', 'segment', 't', 'point', 'at'],
    move_point: ['path', 'points', 'point'],
    delete_point: ['path', 'points'],
    cut: ['path', 'points'],
    join: ['joinMode'],
};

/** Build the edit_path statements run on `it` (single item) or `items`. */
export function editStatements(a) {
    const action = enumOf(a.action, EDIT_ACTIONS, { name: 'action' });
    const allowed = EDIT_OPTIONS[action];
    for (const k of ['path', 'points', 'pointType', 'segment', 't', 'point', 'at', 'joinMode']) {
        if (has(a[k]) && !allowed.includes(k)) throw new Error(`'${k}' does not apply to ${action}`);
    }
    const path = has(a.path) ? index(a.path, { name: 'path', max: 10000 }) : null;
    const pts = () => {
        if (!Array.isArray(a.points) || !a.points.length) throw new Error(`${action} needs points: a non-empty list of point indexes`);
        return a.points.map((p, i) => Number(index(p, { name: `points[${i}]`, max: 100000 })));
    };
    const onePoint = () => {
        const list = pts();
        if (list.length !== 1) throw new Error(`${action} takes one point index`);
        return list[0];
    };
    const single = true;

    if (action === 'open' || action === 'close' || action === 'reverse') {
        const stmt = action === 'reverse' ? 'p.reverse();' : `p.pathType = PathType.${action === 'open' ? 'OPEN_PATH' : 'CLOSED_PATH'};`;
        return {
            action, single: false,
            lines: [
                'for (var k = 0; k < items.length; k++) {',
                '  var it = items[k];',
                path !== null
                    ? `  var p = __pathOf(it, ${path}); ${stmt}`
                    : `  for (var pi = 0; pi < it.paths.length; pi++) { var p = it.paths.item(pi); ${stmt} }`,
                '}',
            ],
        };
    }
    const pathLine = `var p = __pathOf(it, ${path ?? 0}), b = __base(it);`;
    if (action === 'set_point_type') {
        const type = POINT_TYPES[enumOf(a.pointType, Object.keys(POINT_TYPES), { name: 'pointType' })];
        const lines = ['for (var k = 0; k < items.length; k++) {', '  var it = items[k];', `  ${pathLine}`];
        if (has(a.points)) {
            lines.push(`  var idx = ${json(pts())};`);
            lines.push(`  for (var i = 0; i < idx.length; i++) p.pathPoints.item(__pointIndex(p, idx[i])).pointType = PointType.${type};`);
        } else {
            lines.push(`  for (var i = 0; i < p.pathPoints.length; i++) p.pathPoints.item(i).pointType = PointType.${type};`);
        }
        lines.push('}');
        return { action, single: false, lines };
    }
    if (action === 'add_point') {
        if (has(a.segment) === has(a.point)) throw new Error('add_point needs segment (add on the path, keeping its shape) or point (a new anchor point), not both');
        if (has(a.segment)) {
            if (has(a.at)) throw new Error("'at' applies with point, not segment");
            const seg = index(a.segment, { name: 'segment', max: 100000 });
            const t = num(a.t ?? 0.5, { name: 't', min: 0.01, max: 0.99 });
            return {
                action, single,
                lines: [
                    pathLine,
                    'var P = __triples(p), n = P.length, kind = p.pathType;',
                    `var s = ${seg}, t = ${t};`,
                    'var last = kind == PathType.CLOSED_PATH ? n - 1 : n - 2;',
                    'if (s > last) throw new Error("The path has no segment " + s + "; segments run from 0 to " + last);',
                    'var e = (s + 1) % n;',
                    'var lerp = function (u, v) { return [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]; };',
                    'var p01 = lerp(P[s][1], P[s][2]), p12 = lerp(P[s][2], P[e][0]), p23 = lerp(P[e][0], P[e][1]);',
                    'var p012 = lerp(p01, p12), p123 = lerp(p12, p23), mid = lerp(p012, p123);',
                    'P[s][2] = p01; P[e][0] = p23;',
                    'P.splice(s + 1, 0, [p012, mid, p123]);',
                    'p.entirePath = P; p.pathType = kind;',
                ],
            };
        }
        if (has(a.t)) throw new Error("'t' applies with segment");
        const { triple, type } = pointSpec(a.point, 'point');
        const at = has(a.at) ? index(a.at, { name: 'at', max: 100000 }) : null;
        return {
            action, single,
            lines: [
                pathLine,
                'var P = __triples(p), kind = p.pathType;',
                `var at = ${at ?? 'P.length'};`,
                'if (at > P.length) throw new Error("Insert position " + at + " is past the end of the path (" + P.length + " points)");',
                `P.splice(at, 0, ${triple});`,
                'p.entirePath = P; p.pathType = kind;',
                ...(type ? [`p.pathPoints.item(at).pointType = PointType.${type};`] : []),
            ],
        };
    }
    if (action === 'move_point') {
        const i = onePoint();
        const pt = a.point;
        if (typeof pt !== 'object' || pt === null || Array.isArray(pt)) throw new Error("move_point needs point: { anchor?, left?, right?, type? }");
        known(pt, ['anchor', 'left', 'right', 'type'], 'point');
        if (!has(pt.anchor) && !has(pt.left) && !has(pt.right) && !has(pt.type)) throw new Error('move_point: give point.anchor, point.left, point.right or point.type');
        const lines = [pathLine, `var q = p.pathPoints.item(__pointIndex(p, ${i}));`];
        lines.push('var A = q.anchor, L = q.leftDirection, R = q.rightDirection;');
        if (has(pt.anchor)) {
            // The handles move with the anchor unless they are given.
            lines.push(`var na = __toDoc(b, ${xy(pt.anchor, 'point.anchor')}), dx = na[0] - A[0], dy = na[1] - A[1];`);
            lines.push('A = na; L = [L[0] + dx, L[1] + dy]; R = [R[0] + dx, R[1] + dy];');
        }
        if (has(pt.left)) lines.push(`L = __toDoc(b, ${xy(pt.left, 'point.left')});`);
        if (has(pt.right)) lines.push(`R = __toDoc(b, ${xy(pt.right, 'point.right')});`);
        lines.push('q.anchor = A; q.leftDirection = L; q.rightDirection = R;');
        if (has(pt.type)) lines.push(`q.pointType = PointType.${POINT_TYPES[enumOf(pt.type, Object.keys(POINT_TYPES), { name: 'point.type' })]};`);
        return { action, single, lines };
    }
    if (action === 'delete_point') {
        const list = [...new Set(pts())].sort((x, y) => y - x);
        return {
            action, single,
            lines: [
                pathLine,
                `var idx = ${json(list)};`,
                'if (p.pathPoints.length - idx.length < 2) throw new Error("A path keeps at least two points; delete the item instead");',
                'for (var i = 0; i < idx.length; i++) p.pathPoints.item(__pointIndex(p, idx[i])).remove();',
            ],
        };
    }
    if (action === 'cut') {
        const i = onePoint();
        return {
            action, single,
            lines: [
                pathLine,
                'var P = __triples(p), n = P.length, c = ' + i + ', copy = null;',
                '__pointIndex(p, c);',
                'if (p.pathType == PathType.CLOSED_PATH) {',
                '  var Q = P.slice(c).concat(P.slice(0, c + 1));',
                '  p.pathType = PathType.OPEN_PATH; p.entirePath = Q;',
                '} else {',
                '  if (c === 0 || c === n - 1) throw new Error("Point " + c + " is an end point of an open path; there is nothing to cut");',
                '  if (it.paths.length !== 1) throw new Error("Cutting an open path into two items needs an item with a single path");',
                '  copy = it.duplicate();',
                '  p.entirePath = P.slice(0, c + 1);',
                '  copy.paths.item(0).entirePath = P.slice(c);',
                '}',
            ],
        };
    }
    // join
    const mode = enumOf(a.joinMode ?? 'connect', ['connect', 'combine'], { name: 'joinMode' });
    return {
        action, single: false,
        lines: [
            'if (items.length > 2) throw new Error("Join takes one item (to close its path, or join its two paths) or two items");',
            'var it = items[0];',
            'if (items.length === 2) it = it.makeCompoundPath([items[1]]);',
            'if (it.paths.length === 1) {',
            '  if (it.paths.item(0).pathType == PathType.CLOSED_PATH) throw new Error("The path is already closed");',
            '  it.paths.item(0).pathType = PathType.CLOSED_PATH;',
            '} else {',
            '  if (it.paths.length !== 2) throw new Error("Join needs two open paths; the item has " + it.paths.length);',
            '  var p0 = it.paths.item(0), p1 = it.paths.item(1);',
            '  if (p0.pathType == PathType.CLOSED_PATH || p1.pathType == PathType.CLOSED_PATH) throw new Error("Only open paths can be joined");',
            '  var ends0 = [p0.pathPoints.firstItem(), p0.pathPoints.lastItem()], ends1 = [p1.pathPoints.firstItem(), p1.pathPoints.lastItem()];',
            '  var best = null, bd = 0;',
            '  for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {',
            '    var u = ends0[i].anchor, v = ends1[j].anchor, d = (u[0] - v[0]) * (u[0] - v[0]) + (u[1] - v[1]) * (u[1] - v[1]);',
            '    if (best === null || d < bd) { best = [ends0[i], ends1[j]]; bd = d; }',
            '  }',
            `  best[0].join(best[1], JoinOptions.${mode.toUpperCase()});`,
            '}',
        ],
        result: 'it',
    };
}

const SHAPES = {
    rectangle: 'CONVERT_TO_RECTANGLE',
    rounded_rectangle: 'CONVERT_TO_ROUNDED_RECTANGLE',
    beveled_rectangle: 'CONVERT_TO_BEVELED_RECTANGLE',
    inverse_rounded_rectangle: 'CONVERT_TO_INVERSE_ROUNDED_RECTANGLE',
    ellipse: 'CONVERT_TO_OVAL',
    triangle: 'CONVERT_TO_TRIANGLE',
    polygon: 'CONVERT_TO_POLYGON',
    line: 'CONVERT_TO_LINE',
    orthogonal_line: 'CONVERT_TO_STRAIGHT_LINE',
    open_path: 'CONVERT_TO_OPEN_PATH',
    closed_path: 'CONVERT_TO_CLOSED_PATH',
};
const CORNER_SHAPES = ['rounded_rectangle', 'beveled_rectangle', 'inverse_rounded_rectangle'];

/** Pathfinder and compound path operations, as SplineItem methods. */
export const COMBINE = {
    add: 'addPath',
    subtract: 'subtractPath',
    intersect: 'intersectPath',
    exclude_overlap: 'excludeOverlapPath',
    minus_back: 'minusBack',
    make_compound_path: 'makeCompoundPath',
    release_compound_path: 'releaseCompoundPath',
};

const CORNERS = { top_left: 'topLeft', top_right: 'topRight', bottom_left: 'bottomLeft', bottom_right: 'bottomRight' };
const CORNER_OPTIONS = { none: 'NONE', rounded: 'ROUNDED_CORNER', inverse_rounded: 'INVERSE_ROUNDED_CORNER', inset: 'INSET_CORNER', bevel: 'BEVEL_CORNER', fancy: 'FANCY_CORNER' };

const CLIPPING_TYPES = { none: 'NONE', detect_edges: 'DETECT_EDGES', alpha_channel: 'ALPHA_CHANNEL', photoshop_path: 'PHOTOSHOP_PATH' };

export const tools = [
    {
        name: 'draw_path',
        description: 'Draw a path from anchor points with optional direction handles, open or closed, as with the Pen or Pencil tool; it takes the document\'s default object style unless colours are given. Returns the new item',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: 'Page to draw on (0-based)' },
                points: { type: 'array', minItems: 2, maxItems: 1000, items: POINT_SCHEMA, description: 'The anchor points in order (at least two)' },
                closed: { type: 'boolean', description: 'Close the path (default false: an open path)' },
                fillColor: COLOR_SCHEMA,
                strokeColor: COLOR_SCHEMA,
                name: { type: 'string', description: 'A name for the item (Layers panel)' },
            },
            required: ['pageIndex', 'points'],
        },
        features: geo(['path', 'path_point', 'pen_tool', 'pencil_tool']),
        hints: { readOnly: false, idempotent: false },
        auditArgs: { points: [{ anchor: [10, 10] }, { anchor: [50, 20], left: [40, 5], right: [60, 35], type: 'smooth' }] },
        handler: (a) => {
            const page = index(a.pageIndex, { name: 'pageIndex' });
            if (!Array.isArray(a.points) || a.points.length < 2 || a.points.length > 1000) throw new Error("'points' needs 2 to 1000 points");
            const specs = a.points.map((p, i) => pointSpec(p, `points[${i}]`));
            const closed = has(a.closed) && flag(a.closed, 'closed') === 'true';
            const lines = [];
            const colors = [];
            if (has(a.fillColor)) { colors.push(`var __fill = __swatch(doc, ${colorSpec(a.fillColor, 'fillColor')});`); lines.push('it.fillColor = __fill;'); }
            if (has(a.strokeColor)) { colors.push(`var __stroke = __swatch(doc, ${colorSpec(a.strokeColor, 'strokeColor')});`); lines.push('it.strokeColor = __stroke;'); }
            if (has(a.name)) {
                const n = String(a.name);
                if (!n.trim() || n.length > 200) throw new Error("'name' must be 1 to 200 characters");
                lines.push(`it.name = ${json(n)};`);
            }
            specs.forEach((s, i) => { if (s.type) lines.push(`it.paths.item(0).pathPoints.item(${i}).pointType = PointType.${s.type};`); });
            return run('Draw path', body(`
var page = __page(doc, ${page}), b = page.bounds;
${colors.join('\n')}
var it = ${closed ? 'page.polygons.add()' : 'page.graphicLines.add()'};
it.paths.item(0).entirePath = [${specs.map((s) => s.triple).join(', ')}];
it.paths.item(0).pathType = PathType.${closed ? 'CLOSED_PATH' : 'OPEN_PATH'};
${lines.join('\n')}
__result__ = __pathSummary(it);`));
        },
    },
    {
        name: 'edit_path',
        description: 'Edit paths: open, close, reverse or join them, cut them with the scissors, add, move or delete anchor points, and convert points (Object > Paths, Object > Convert Point; Add, Delete and Convert Direction Point tools, Scissors tool)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                action: {
                    type: 'string', enum: EDIT_ACTIONS,
                    description: 'open, close or reverse paths (Object > Paths; reversing a subpath of a compound path fills or empties its holes); set_point_type (Convert Point); add_point, move_point, delete_point (anchor point tools); cut (Scissors tool, at a point); join (Object > Paths > Join: close one open path, or join two open paths at their nearest end points). add_point, move_point, delete_point and cut act on one item',
                },
                path: { type: 'integer', minimum: 0, description: 'Path index within the item (a compound path has several). open, close and reverse: default every path; others: default 0' },
                points: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Point indexes: the points to convert (default all), to delete, to move (one) or to cut at (one)' },
                pointType: { type: 'string', enum: Object.keys(POINT_TYPES), description: 'set_point_type: plain, corner, smooth or symmetrical' },
                segment: { type: 'integer', minimum: 0, description: 'add_point: add a point on segment n (from point n to the next), keeping the path\'s shape' },
                t: { type: 'number', minimum: 0.01, maximum: 0.99, description: 'add_point with segment: where on the segment (0 to 1, default 0.5)' },
                point: { type: 'object', properties: POINT_SCHEMA.properties, description: 'add_point: a new anchor point with optional handles; move_point: new anchor (handles follow unless given), handles and type' },
                at: { type: 'integer', minimum: 0, description: 'add_point with point: insert at this index (default at the end)' },
                joinMode: { type: 'string', enum: ['connect', 'combine'], description: 'join: connect the end points with a segment (default), or combine them into one point' },
            },
            required: ['target', 'action'],
        },
        features: geo([
            'path_point', 'add_anchor_point_tool', 'delete_anchor_point_tool', 'convert_direction_point_tool', 'scissors_tool',
            'join_path', 'open_path', 'close_path', 'reverse_path', 'compound_path_holes',
            'convert_point_plain', 'convert_point_corner', 'convert_point_smooth', 'convert_point_symmetrical',
        ]),
        hints: { readOnly: false, idempotent: false },
        auditArgs: { action: 'add_point', points: undefined, pointType: undefined, t: 0.25, point: undefined, at: undefined, joinMode: undefined },
        handler: (a) => {
            const target = targetSpec(a.target);
            const e = editStatements(a);
            const head = e.single
                ? 'if (items.length !== 1) throw new Error("' + e.action + ' acts on one item; the target has " + items.length);\nvar it = items[0];'
                : '';
            let result;
            if (e.result === 'it') result = '__result__ = { action: "join", items: [__pathSummary(it)] };';
            else if (e.action === 'cut') result = '__result__ = { action: "cut", items: copy ? [__pathSummary(it), __pathSummary(copy)] : [__pathSummary(it)] };';
            else result = `var out = [];\nfor (var z = 0; z < items.length; z++) out.push(__pathSummary(items[z]));\n__result__ = { action: "${e.action}", items: out };`;
            return run('Edit path', body(`
var items = __targets(doc, ${target});
for (var lk = 0; lk < items.length; lk++) if (items[lk].locked) throw new Error("Item " + items[lk].id + " is locked");
${head}
${e.lines.join('\n')}
${result}`));
        },
    },
    {
        name: 'get_path_info',
        description: 'Read items\' paths: whether each is open or closed, and every anchor point with its direction handles and point type',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA },
            required: ['target'],
        },
        features: geo(['path']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const target = targetSpec(a.target);
            return run('Get path info', body(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  var info = __itemInfo(items[i]);
  try { info.paths = __paths(items[i]); } catch (e) { info.paths = []; info.note = "This item has no paths"; }
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'combine_paths',
        description: 'Combine shapes with the Pathfinder (add, subtract, intersect, exclude overlap, minus back), or make or release a compound path (Object > Pathfinder, Object > Paths, Pathfinder panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: {
                    type: 'string', enum: Object.keys(COMBINE),
                    description: 'Pathfinder operation, or make_compound_path / release_compound_path. Pathfinder results follow the stacking order as in the Pathfinder panel (subtract removes front shapes from the backmost; minus back removes back shapes from the frontmost)',
                },
            },
            required: ['target', 'operation'],
        },
        features: geo([
            'pathfinder_panel', 'pathfinder_add', 'pathfinder_subtract', 'pathfinder_intersect', 'pathfinder_exclude_overlap',
            'pathfinder_minus_back', 'make_compound_path', 'release_compound_path',
        ]),
        hints: { readOnly: false, destructive: true, idempotent: false },
        handler: (a) => {
            const target = targetSpec(a.target);
            const op = enumOf(a.operation, Object.keys(COMBINE), { name: 'operation' });
            const code = op === 'release_compound_path'
                ? `
var out = [];
for (var i = 0; i < items.length; i++) {
  if (items[i].paths.length < 2) throw new Error("Item " + items[i].id + " is not a compound path");
  var parts = items[i].releaseCompoundPath();
  for (var j = 0; j < parts.length; j++) out.push(__pathSummary(parts[j]));
}`
                : `
if (items.length < 2) throw new Error("${op} needs at least two items");
var rest = [];
for (var i = 1; i < items.length; i++) rest.push(items[i]);
var out = [__pathSummary(items[0].${COMBINE[op]}(rest))];`;
            return run('Combine paths', body(`
var items = __targets(doc, ${target});
for (var lk = 0; lk < items.length; lk++) if (items[lk].locked) throw new Error("Item " + items[lk].id + " is locked");
${code}
__result__ = { operation: "${op}", items: out };`));
        },
    },
    {
        name: 'convert_shape',
        description: 'Convert items to another shape: rectangle, rounded, beveled or inverse rounded rectangle, ellipse, triangle, polygon, line or orthogonal line, or an open or closed path (Object > Convert Shape; Pathfinder panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                shape: { type: 'string', enum: Object.keys(SHAPES), description: 'The new shape' },
                sides: { type: 'integer', minimum: 3, maximum: 100, description: 'polygon: number of sides' },
                starInset: { type: 'number', minimum: 0, maximum: 100, description: 'polygon: star inset (%)' },
                cornerRadius: { type: 'number', minimum: 0, maximum: 1000, description: 'Rounded, beveled or inverse rounded rectangle: corner size (mm)' },
            },
            required: ['target', 'shape'],
        },
        features: geo([
            'convert_shape', 'convert_shape_rectangle', 'convert_shape_rounded_rectangle', 'convert_shape_beveled_rectangle',
            'convert_shape_inverse_rounded_rectangle', 'convert_shape_ellipse', 'convert_shape_triangle', 'convert_shape_polygon',
            'convert_shape_line', 'convert_shape_orthogonal_line', 'open_path', 'close_path', 'pathfinder_panel',
        ]),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { shape: 'polygon', cornerRadius: undefined },
        handler: (a) => {
            const target = targetSpec(a.target);
            const shape = enumOf(a.shape, Object.keys(SHAPES), { name: 'shape' });
            if ((has(a.sides) || has(a.starInset)) && shape !== 'polygon') throw new Error("'sides' and 'starInset' apply to shape: polygon");
            if (has(a.cornerRadius) && !CORNER_SHAPES.includes(shape)) throw new Error(`'cornerRadius' applies to ${CORNER_SHAPES.join(', ')}`);
            const sides = has(a.sides) ? index(a.sides, { name: 'sides', max: 100 }) : 'undefined';
            if (has(a.sides) && Number(sides) < 3) throw new Error("'sides' must be 3 to 100");
            const inset = has(a.starInset) ? num(a.starInset, { name: 'starInset', min: 0, max: 100 }) : 'undefined';
            const radius = has(a.cornerRadius) ? num(a.cornerRadius, { name: 'cornerRadius', min: 0, max: 1000 }) : 'undefined';
            const args = [`ConvertShapeOptions.${SHAPES[shape]}`, sides, inset, radius];
            while (args[args.length - 1] === 'undefined') args.pop();
            return run('Convert shape', body(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  if (items[i].locked) throw new Error("Item " + items[i].id + " is locked");
  items[i].convertShape(${args.join(', ')});
  out.push(__pathSummary(items[i]));
}
__result__ = { shape: "${shape}", items: out };`));
        },
    },
    {
        name: 'set_corner_options',
        description: 'Set the corner shape and size of items\' corners, all at once or individually (Object > Corner Options; live corners)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                shape: { type: 'string', enum: Object.keys(CORNER_OPTIONS), description: 'Corner shape' },
                radius: { type: 'number', minimum: 0, maximum: 1000, description: 'Corner size (mm)' },
                corners: { type: 'array', items: { type: 'string', enum: Object.keys(CORNERS) }, description: 'Which corners (default all four)' },
            },
            required: ['target'],
        },
        features: geo(['live_corners']),
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const target = targetSpec(a.target);
            if (!has(a.shape) && !has(a.radius)) throw new Error('Give shape, radius or both');
            const shape = has(a.shape) ? CORNER_OPTIONS[enumOf(a.shape, Object.keys(CORNER_OPTIONS), { name: 'shape' })] : null;
            const radius = has(a.radius) ? num(a.radius, { name: 'radius', min: 0, max: 1000 }) : null;
            let corners = Object.keys(CORNERS);
            if (has(a.corners)) {
                if (!Array.isArray(a.corners) || !a.corners.length) throw new Error("'corners' must be a non-empty list");
                corners = [...new Set(a.corners.map((c, i) => enumOf(c, Object.keys(CORNERS), { name: `corners[${i}]` })))];
            }
            const lines = [];
            for (const c of corners) {
                if (shape) lines.push(`  it.${CORNERS[c]}CornerOption = CornerOptions.${shape};`);
                if (radius !== null) lines.push(`  it.${CORNERS[c]}CornerRadius = ${radius};`);
            }
            const read = Object.entries(CORNERS).map(([k, p]) => `${k}: { shape: __enumName(it.${p}CornerOption), radius: it.${p}CornerRadius }`).join(', ');
            return run('Set corner options', body(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (it.locked) throw new Error("Item " + it.id + " is locked");
${lines.join('\n')}
  var info = __itemInfo(it);
  info.corners = { ${read} };
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'set_clipping_path',
        description: 'Set an image\'s clipping path: none, detect edges, an alpha channel or a Photoshop path, with threshold, tolerance, inset and options, or convert the clipping path to a frame (Object > Clipping Path > Options; Convert Clipping Path to Frame)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}: graphic frames, or the placed images themselves` },
                type: { type: 'string', enum: Object.keys(CLIPPING_TYPES), description: 'Clipping path type' },
                pathName: { type: 'string', description: 'The Photoshop path or alpha channel to use (photoshop_path, alpha_channel)' },
                threshold: { type: 'integer', minimum: 0, maximum: 255, description: 'Threshold (detect edges, alpha channel)' },
                tolerance: { type: 'number', minimum: 0, maximum: 10, description: 'Tolerance (detect edges, alpha channel)' },
                insetFrame: { type: 'number', minimum: -3527, maximum: 3527, description: 'Inset Frame (mm)' },
                invertPath: { type: 'boolean', description: 'Invert' },
                includeInsideEdges: { type: 'boolean', description: 'Include Inside Edges' },
                restrictToFrame: { type: 'boolean', description: 'Restrict to Frame' },
                useHighResolutionImage: { type: 'boolean', description: 'Use High Resolution Image' },
                convertToFrame: { type: 'boolean', description: 'Afterwards, convert the clipping path to the graphic frame (Object > Clipping Path > Convert Clipping Path to Frame)' },
            },
            required: ['target'],
        },
        features: geo(['clipping_path_options', 'convert_clipping_path_to_frame']),
        hints: { readOnly: false, idempotent: false },
        auditArgs: { type: 'detect_edges', pathName: undefined },
        handler: (a) => {
            const target = targetSpec(a.target);
            const lines = [];
            const type = has(a.type) ? enumOf(a.type, Object.keys(CLIPPING_TYPES), { name: 'type' }) : null;
            if (type) lines.push(`cp.clippingType = ClippingPathType.${CLIPPING_TYPES[type]};`);
            if (has(a.pathName)) {
                if (type && type !== 'photoshop_path' && type !== 'alpha_channel') throw new Error("'pathName' applies to photoshop_path and alpha_channel");
                const n = String(a.pathName);
                if (!n || n.length > 255) throw new Error("'pathName' must be 1 to 255 characters");
                lines.push(`cp.appliedPathName = ${json(n)};`);
            }
            if (has(a.threshold)) lines.push(`cp.threshold = ${index(a.threshold, { name: 'threshold', max: 255 })};`);
            if (has(a.tolerance)) lines.push(`cp.tolerance = ${num(a.tolerance, { name: 'tolerance', min: 0, max: 10 })};`);
            if (has(a.insetFrame)) lines.push(`cp.insetFrame = ${num(a.insetFrame, { name: 'insetFrame', min: -3527, max: 3527 })};`);
            for (const k of ['invertPath', 'includeInsideEdges', 'restrictToFrame', 'useHighResolutionImage']) {
                if (has(a[k])) lines.push(`cp.${k} = ${flag(a[k], k)};`);
            }
            const convert = has(a.convertToFrame) && flag(a.convertToFrame, 'convertToFrame') === 'true';
            if (convert) lines.push('cp.convertToFrame();');
            if (!lines.length) throw new Error('Nothing to set: give type, pathName, threshold, tolerance, insetFrame, the options, or convertToFrame: true');
            return run('Set clipping path', body(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], g = it.allGraphics.length ? it.allGraphics[0] : it, cp = null;
  try { cp = g.clippingPath; } catch (e) {}
  if (!cp) throw new Error("Item " + it.id + " holds no image with a clipping path");
${lines.map((l) => `  ${l}`).join('\n')}
  var info = __itemInfo(it);
  try {
    info.clippingPath = { type: __enumName(cp.clippingType), pathName: cp.appliedPathName, threshold: cp.threshold, tolerance: cp.tolerance, insetFrame: cp.insetFrame,
      photoshopPaths: cp.photoshopPathNames, alphaChannels: cp.alphaChannelPathNames };
  } catch (e) {}
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'create_outlines',
        description: 'Convert text frames\' text to outlines (compound paths), replacing the text or keeping it (Type > Create Outlines)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}: text frames` },
                keepText: { type: 'boolean', description: 'Keep the original text frame and add the outlines over it (default false: the text is replaced)' },
            },
            required: ['target'],
        },
        features: geo(['create_outlines']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        handler: (a) => {
            const target = targetSpec(a.target);
            const keep = has(a.keepText) && flag(a.keepText, 'keepText') === 'true';
            return run('Create outlines', body(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  if (items[i].constructor.name !== "TextFrame") throw new Error("Item " + items[i].id + " is not a text frame");
  if (items[i].locked) throw new Error("Item " + items[i].id + " is locked");
}
for (var j = 0; j < items.length; j++) {
  var made = items[j].createOutlines(${bool(!keep)});
  for (var k = 0; k < made.length; k++) out.push(__pathSummary(made[k]));
}
__result__ = { keptText: ${bool(keep)}, items: out };`));
        },
    },
];
