/**
 * Masks: add rectangle, ellipse or path masks to layers; list them; set their
 * mode, feather, colour, lock, motion blur and RotoBezier; delete, duplicate,
 * select and reference them from effects; and edit mask and shape paths
 * (vertices, first vertex, direction, variable-width feather points and a free
 * transform of the points).
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, PROPERTY_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, propertyPath, colorValue } from '../args.js';

const MODES = { add: 'ADD', subtract: 'SUBTRACT', intersect: 'INTERSECT', lighten: 'LIGHTEN', darken: 'DARKEN', difference: 'DIFFERENCE', none: 'NONE' };
const KAPPA = 0.5522847498;

/** Vertices and tangents for a rectangle or ellipse in layer coordinates. */
function shapeOf(kind, b, points) {
    if (kind === 'path') {
        if (!Array.isArray(points) || points.length < 2) throw new Error('A path mask needs at least two points');
        const v = points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
        return { v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
    }
    const x = Number(num(b?.x, { name: 'bounds.x' })), y = Number(num(b?.y, { name: 'bounds.y' }));
    const w = Number(num(b?.width, { min: 0.1, name: 'bounds.width' })), h = Number(num(b?.height, { min: 0.1, name: 'bounds.height' }));
    if (kind === 'rectangle') return { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]] };
    const cx = x + w / 2, cy = y + h / 2, kx = (w / 2) * KAPPA, ky = (h / 2) * KAPPA;
    return {
        v: [[cx, y], [x + w, cy], [cx, y + h], [x, cy]],
        i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    };
}

const MOTION_BLUR = { same_as_layer: 'SAME_AS_LAYER', on: 'ON', off: 'OFF' };
const FALLOFF = { smooth: 'FFO_SMOOTH', linear: 'FFO_LINEAR' };

const MASKS_SCHEMA = {
    type: 'object',
    description: 'Which masks on each layer: indexes (1-based, as in the Timeline) or names. Omit for every mask',
    properties: {
        indexes: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Mask indexes, 1 = first' },
        names: { type: 'array', items: { type: 'string' }, description: 'Mask names' },
    },
};

const XY = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

/** A mask spec as a JSX literal for __masks(). */
function maskSpec(masks) {
    const m = masks ?? {};
    const out = {};
    if (Array.isArray(m.indexes) && m.indexes.length) {
        out.indexes = m.indexes.map((i) => {
            const n = Number(index(i, { name: 'masks.indexes', max: 10000 }));
            if (n < 1) throw new Error("'masks.indexes' start at 1");
            return n;
        });
    }
    if (Array.isArray(m.names) && m.names.length) out.names = m.names.map(String);
    return json(out);
}

/** A list of [x, y] pairs, checked. */
function points(value, name, length) {
    if (!Array.isArray(value) || !value.length || value.length > 10000) throw new Error(`'${name}' must list [x, y] points`);
    if (length !== undefined && value.length !== length) throw new Error(`'${name}' must have one entry per vertex (${length})`);
    return value.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`'${name}[${i}]' must be [x, y]`);
        return [Number(num(p[0], { name: `${name}[${i}][0]` })), Number(num(p[1], { name: `${name}[${i}][1]` }))];
    });
}

/**
 * A Bezier path from vertices, tangents (relative to their vertex; default
 * none) and a closed flag (default true), as plain data for a script.
 */
export function pathValue(a, where = 'path') {
    if (!a || typeof a !== 'object') throw new Error(`'${where}' needs vertices`);
    const vertices = points(a.vertices, `${where}.vertices`);
    const zero = vertices.map(() => [0, 0]);
    return {
        vertices,
        inTangents: a.inTangents === undefined ? zero : points(a.inTangents, `${where}.inTangents`, vertices.length),
        outTangents: a.outTangents === undefined ? zero : points(a.outTangents, `${where}.outTangents`, vertices.length),
        closed: a.closed === undefined ? true : Boolean(a.closed),
    };
}

/** Variable-width feather points as the Shape object's parallel arrays. */
function featherArrays(list) {
    if (!Array.isArray(list) || list.length > 1000) throw new Error("'featherPoints' must be a list (empty to remove them)");
    const f = { featherSegLocs: [], featherRelSegLocs: [], featherRadii: [], featherInterps: [], featherTensions: [], featherTypes: [], featherRelCornerAngles: [] };
    list.forEach((p, i) => {
        const w = `featherPoints[${i}]`;
        if (!p || typeof p !== 'object') throw new Error(`'${w}' must be an object`);
        f.featherSegLocs.push(Number(index(p.segment, { name: `${w}.segment`, max: 10000 })));
        f.featherRelSegLocs.push(Number(num(p.position ?? 0.5, { min: 0, max: 1, name: `${w}.position` })));
        f.featherRadii.push(Number(num(p.radius, { min: -10000, max: 10000, name: `${w}.radius` })));
        f.featherInterps.push(p.hold ? 1 : 0);
        f.featherTensions.push(Number(num(p.tension ?? 0, { min: 0, max: 1, name: `${w}.tension` })));
        f.featherTypes.push(p.inner ? 1 : 0);
        f.featherRelCornerAngles.push(Number(num(p.cornerAngle ?? 0, { min: 0, max: 100, name: `${w}.cornerAngle` })));
    });
    return f;
}

/** ES3: choose masks on a layer, and name the mask enums. */
const MASK_HELPERS = `
var __maskModes = { none: MaskMode.NONE, add: MaskMode.ADD, subtract: MaskMode.SUBTRACT, intersect: MaskMode.INTERSECT, lighten: MaskMode.LIGHTEN, darken: MaskMode.DARKEN, difference: MaskMode.DIFFERENCE };
var __blurs = { same_as_layer: MaskMotionBlur.SAME_AS_LAYER, on: MaskMotionBlur.ON, off: MaskMotionBlur.OFF };
var __falloffs = { smooth: MaskFeatherFalloff.FFO_SMOOTH, linear: MaskFeatherFalloff.FFO_LINEAR };
var __nameOf = function (table, v) {
  for (var k in table) if (table.hasOwnProperty(k) && table[k] === v) return k;
  return String(v);
};
var __parade = function (layer) {
  var parade = layer.property("ADBE Mask Parade");
  if (!parade) throw new Error(layer.name + " cannot take masks");
  return parade;
};
var __masks = function (layer, spec) {
  var parade = __parade(layer), out = [], i;
  if (!spec.indexes && !spec.names) {
    for (i = 1; i <= parade.numProperties; i++) out.push(parade.property(i));
    return out;
  }
  if (spec.indexes) for (i = 0; i < spec.indexes.length; i++) {
    if (spec.indexes[i] > parade.numProperties) throw new Error(layer.name + " has no mask " + spec.indexes[i] + "; it has " + parade.numProperties);
    out.push(parade.property(spec.indexes[i]));
  }
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var m = parade.property(spec.names[i]);
    if (!m) throw new Error(layer.name + " has no mask named " + spec.names[i]);
    out.push(m);
  }
  return out;
};
var __feather = function (sh) {
  var pts = [];
  for (var f = 0; f < sh.featherSegLocs.length; f++) pts.push({ segment: sh.featherSegLocs[f], position: sh.featherRelSegLocs[f], radius: sh.featherRadii[f],
    hold: sh.featherInterps[f] === 1, tension: sh.featherTensions[f], inner: sh.featherTypes[f] === 1, cornerAngle: sh.featherRelCornerAngles[f] });
  return pts;
};
var __maskInfo = function (m, withPath) {
  var shp = m.property("ADBE Mask Shape"), sh = shp.value;
  var info = { index: m.propertyIndex, name: m.name, mode: __nameOf(__maskModes, m.maskMode), inverted: m.inverted, locked: m.locked,
    rotoBezier: m.rotoBezier, motionBlur: __nameOf(__blurs, m.maskMotionBlur), featherFalloff: __nameOf(__falloffs, m.maskFeatherFalloff),
    color: m.color, selected: m.selected, feather: m.property("ADBE Mask Feather").value, opacity: m.property("ADBE Mask Opacity").value,
    expansion: m.property("ADBE Mask Offset").value, vertices: sh.vertices.length, closed: sh.closed, pathKeys: shp.numKeys,
    featherPoints: sh.featherSegLocs.length };
  if (withPath) info.path = { vertices: sh.vertices, inTangents: sh.inTangents, outTangents: sh.outTangents, closed: sh.closed, featherPoints: __feather(sh) };
  return info;
};`;

/** ES3: a new Shape from an old one with an edit applied (see set_bezier_path). */
const SHAPE_EDIT = `
var __turn = function (a, k) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[(i + k) % a.length]); return o; };
var __flip = function (a) { var o = []; for (var i = a.length - 1; i >= 0; i--) o.push(a[i]); return o; };
var __editShape = function (old, op) {
  var s = new Shape(), src = op.replace || old, i;
  var v = src.vertices, it = src.inTangents, ot = src.outTangents, n = v.length;
  s.closed = src.closed;
  var fe = op.feather || (op.replace ? null : old);
  var seg = [], rel = [], rds = [], itp = [], ten = [], typ = [], ang = [];
  if (fe) { seg = fe.featherSegLocs; rel = fe.featherRelSegLocs; rds = fe.featherRadii; itp = fe.featherInterps; ten = fe.featherTensions; typ = fe.featherTypes; ang = fe.featherRelCornerAngles; }
  if (op.first > 0) {
    if (!s.closed) throw new Error("Only a closed path can start at another vertex");
    if (op.first >= n) throw new Error("The path has " + n + " vertices; firstVertex must be below " + n);
    v = __turn(v, op.first); it = __turn(it, op.first); ot = __turn(ot, op.first);
    var seg1 = [];
    for (i = 0; i < seg.length; i++) seg1.push((seg[i] - op.first + n) % n);
    seg = seg1;
  }
  if (op.reverse) {
    var swap = __flip(it);
    v = __flip(v); it = __flip(ot); ot = swap;
    var seg2 = [], rel2 = [];
    for (i = 0; i < seg.length; i++) { seg2.push(s.closed && seg[i] === n - 1 ? n - 1 : n - 2 - seg[i]); rel2.push(1 - rel[i]); }
    seg = seg2; rel = rel2;
  }
  if (op.xf.apply) {
    var x0 = v[0][0], y0 = v[0][1], x1 = x0, y1 = y0;
    for (i = 1; i < n; i++) { x0 = Math.min(x0, v[i][0]); y0 = Math.min(y0, v[i][1]); x1 = Math.max(x1, v[i][0]); y1 = Math.max(y1, v[i][1]); }
    var ax = op.xf.anchor ? op.xf.anchor[0] : (x0 + x1) / 2, ay = op.xf.anchor ? op.xf.anchor[1] : (y0 + y1) / 2;
    var r = op.xf.rotation * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), sx = op.xf.scale[0] / 100, sy = op.xf.scale[1] / 100;
    var nv = [], ni = [], no = [];
    for (i = 0; i < n; i++) {
      var px = (v[i][0] - ax) * sx, py = (v[i][1] - ay) * sy;
      nv.push([ax + px * cs - py * sn + op.xf.offset[0], ay + px * sn + py * cs + op.xf.offset[1]]);
      var ix = it[i][0] * sx, iy = it[i][1] * sy, ox = ot[i][0] * sx, oy = ot[i][1] * sy;
      ni.push([ix * cs - iy * sn, ix * sn + iy * cs]);
      no.push([ox * cs - oy * sn, ox * sn + oy * cs]);
    }
    v = nv; it = ni; ot = no;
  }
  s.vertices = v; s.inTangents = it; s.outTangents = ot;
  if (seg.length) {
    s.featherSegLocs = seg; s.featherRelSegLocs = rel; s.featherRadii = rds; s.featherInterps = itp;
    s.featherTensions = ten; s.featherTypes = typ; s.featherRelCornerAngles = ang;
  }
  return s;
};`;

export const tools = [
    {
        name: 'add_mask',
        description: 'Add a mask to layers: a rectangle or ellipse from bounds, or a path from points, all in the layer\'s own pixel coordinates; with its mode, feather, opacity, expansion and inversion',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                shape: { type: 'string', enum: ['rectangle', 'ellipse', 'path'], description: 'Default rectangle' },
                bounds: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, description: 'Rectangle or ellipse bounds' },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Path points [[x, y], ...]' },
                closed: { type: 'boolean', description: 'Path: closed. Default true', default: true },
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Default add' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels' },
                opacity: { type: 'number', minimum: 0, maximum: 100 },
                expansion: { type: 'number', minimum: -1000, maximum: 1000, description: 'Pixels' },
                inverted: { type: 'boolean' },
                name: { type: 'string' },
            },
            required: ['layers'],
        },
        auditArgs: { shape: 'ellipse', bounds: { x: 10, y: 10, width: 200, height: 100 } },
        features: [
            'aftereffects.masks_shapes.new_mask',
            'aftereffects.masks_shapes.mask_shape_dialog',
            'aftereffects.masks_shapes.mask_path',
            'aftereffects.masks_shapes.closed_path',
            'aftereffects.masks_shapes.mask_mode_none',
            'aftereffects.masks_shapes.mask_mode_add',
            'aftereffects.masks_shapes.mask_mode_subtract',
            'aftereffects.masks_shapes.mask_mode_intersect',
            'aftereffects.masks_shapes.mask_mode_lighten',
            'aftereffects.masks_shapes.mask_mode_darken',
            'aftereffects.masks_shapes.mask_mode_difference',
            'aftereffects.masks_shapes.mask_feather',
            'aftereffects.masks_shapes.mask_opacity',
            'aftereffects.masks_shapes.mask_expansion',
            'aftereffects.masks_shapes.mask_inverted',
            'aftereffects.masks_shapes.rename_mask',
        ],
        handler: (a) => {
            const kind = enumOf(a.shape ?? 'rectangle', ['rectangle', 'ellipse', 'path'], { name: 'shape' });
            const s = shapeOf(kind, a.bounds, a.points);
            return run('Add mask', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var masks = ls[i].property("ADBE Mask Parade");
  if (!masks) throw new Error(ls[i].name + " cannot take masks");
  var m = masks.addProperty("ADBE Mask Atom"), sh = new Shape();
  sh.vertices = ${json(s.v)}; sh.inTangents = ${json(s.i)}; sh.outTangents = ${json(s.o)}; sh.closed = ${kind === 'path' ? bool(a.closed ?? true) : 'true'};
  m.property("ADBE Mask Shape").setValue(sh);
  m.maskMode = MaskMode.${MODES[enumOf(a.mode ?? 'add', Object.keys(MODES), { name: 'mode' })]};
  ${a.feather !== undefined ? `m.property("ADBE Mask Feather").setValue([${num(a.feather, { min: 0, max: 1000, name: 'feather' })}, ${num(a.feather, { min: 0, max: 1000, name: 'feather' })}]);` : ''}
  ${a.opacity !== undefined ? `m.property("ADBE Mask Opacity").setValue(${num(a.opacity, { min: 0, max: 100, name: 'opacity' })});` : ''}
  ${a.expansion !== undefined ? `m.property("ADBE Mask Offset").setValue(${num(a.expansion, { min: -1000, max: 1000, name: 'expansion' })});` : ''}
  ${a.inverted !== undefined ? `m.inverted = ${bool(a.inverted)};` : ''}
  ${a.name ? `m.name = ${str(a.name)};` : ''}
  out.push({ layer: ls[i].index, mask: m.name, index: m.propertyIndex });
}
__result__ = { masks: out };`, { undo: 'Add mask' }));
        },
    },
    {
        name: 'list_masks',
        description: 'List the masks on layers (Timeline panel, Masks group): index, name, mode, inversion, lock, colour, RotoBezier, motion blur, feather falloff, feather, opacity, expansion, selection and vertex count; optionally each path\'s vertices, tangents and feather points',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, masks: MASKS_SCHEMA,
                paths: { type: 'boolean', description: 'Include each mask path: vertices, tangents, closed and variable-width feather points. Default false' },
            },
            required: ['layers'],
        },
        hints: { readOnly: true },
        auditArgs: { masks: undefined, paths: true },
        features: ['aftereffects.masks_shapes.mask_object'],
        handler: (a) => run('List masks', script(`${MASK_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), spec = ${maskSpec(a.masks)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var ms = __masks(ls[i], spec), list = [];
  for (var j = 0; j < ms.length; j++) list.push(__maskInfo(ms[j], ${bool(a.paths)}));
  out.push({ layer: ls[i].index, name: ls[i].name, masks: list });
}
__result__ = { layers: out };`)),
    },
    {
        name: 'set_masks',
        description: 'Change masks on layers (Layer > Mask): mode, inversion, lock (or lock every other mask: Lock Other Masks; unlock them all: Unlock All Masks), outline colour, RotoBezier, Motion Blur (same as layer, on, off), Feather Falloff (smooth, linear), feather, opacity, expansion, name and selection',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, masks: MASKS_SCHEMA,
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Mask mode' },
                inverted: { type: 'boolean', description: 'Invert the mask' },
                locked: { type: 'boolean', description: 'Lock or unlock the masks (false with masks omitted: Unlock All Masks)' },
                lockOthers: { type: 'boolean', description: 'Lock every other mask on the layer (Lock Other Masks)' },
                color: { ...COLOR_SCHEMA, description: 'Mask outline colour in the viewers and Timeline, "#RRGGBB" or "rgb(r,g,b)"' },
                rotoBezier: { type: 'boolean', description: 'RotoBezier: curves calculated through the vertices' },
                motionBlur: { type: 'string', enum: Object.keys(MOTION_BLUR), description: 'Mask motion blur (Layer > Mask > Motion Blur)' },
                featherFalloff: { type: 'string', enum: Object.keys(FALLOFF), description: 'Feather falloff curve (Layer > Mask > Feather Falloff)' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Feather in pixels, both directions' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Mask opacity, percent' },
                expansion: { type: 'number', minimum: -1000, maximum: 1000, description: 'Mask expansion in pixels' },
                name: { type: 'string', description: 'Rename the mask (one mask per layer only)' },
                selected: { type: 'boolean', description: 'Select or deselect the masks' },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        auditArgs: { masks: { indexes: [1] }, mode: 'subtract', lockOthers: true, color: '#FF8800', motionBlur: 'on', featherFalloff: 'linear', feather: 12 },
        features: [
            'aftereffects.masks_shapes.mask_color',
            'aftereffects.masks_shapes.mask_locked',
            'aftereffects.masks_shapes.lock_other_masks',
            'aftereffects.masks_shapes.unlock_all_masks',
            'aftereffects.masks_shapes.mask_motion_blur',
            'aftereffects.masks_shapes.feather_falloff',
            'aftereffects.paint_roto.rotobezier',
        ],
        handler: (a) => {
            const L = [];
            if (a.mode !== undefined) L.push(`m.maskMode = MaskMode.${MODES[enumOf(a.mode, Object.keys(MODES), { name: 'mode' })]};`);
            if (a.inverted !== undefined) L.push(`m.inverted = ${bool(a.inverted)};`);
            if (a.rotoBezier !== undefined) L.push(`m.rotoBezier = ${bool(a.rotoBezier)};`);
            if (a.motionBlur !== undefined) L.push(`m.maskMotionBlur = MaskMotionBlur.${MOTION_BLUR[enumOf(a.motionBlur, Object.keys(MOTION_BLUR), { name: 'motionBlur' })]};`);
            if (a.featherFalloff !== undefined) L.push(`m.maskFeatherFalloff = MaskFeatherFalloff.${FALLOFF[enumOf(a.featherFalloff, Object.keys(FALLOFF), { name: 'featherFalloff' })]};`);
            if (a.color !== undefined) L.push(`m.color = ${colorValue(a.color)};`);
            if (a.feather !== undefined) { const f = num(a.feather, { min: 0, max: 1000, name: 'feather' }); L.push(`m.property("ADBE Mask Feather").setValue([${f}, ${f}]);`); }
            if (a.opacity !== undefined) L.push(`m.property("ADBE Mask Opacity").setValue(${num(a.opacity, { min: 0, max: 100, name: 'opacity' })});`);
            if (a.expansion !== undefined) L.push(`m.property("ADBE Mask Offset").setValue(${num(a.expansion, { min: -1000, max: 1000, name: 'expansion' })});`);
            if (a.name !== undefined) L.push(`if (ms.length > 1) throw new Error("name renames one mask; choose one per layer"); m.name = ${str(a.name)};`);
            if (a.selected !== undefined) L.push(`m.selected = ${bool(a.selected)};`);
            if (!L.length && a.locked === undefined && !a.lockOthers) throw new Error('Nothing to change: give mode, inverted, locked, lockOthers, color, rotoBezier, motionBlur, featherFalloff, feather, opacity, expansion, name or selected');
            return run('Set masks', script(`${MASK_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), spec = ${maskSpec(a.masks)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var ms = __masks(ls[i], spec), chosen = {}, list = [];
  for (var j = 0; j < ms.length; j++) {
    var m = ms[j], wasLocked = m.locked;
    chosen[m.propertyIndex] = true;
    m.locked = false;
    ${L.join('\n    ')}
    m.locked = ${a.locked !== undefined ? bool(a.locked) : 'wasLocked'};
    list.push(__maskInfo(m, false));
  }
  ${a.lockOthers ? `var parade = __parade(ls[i]);
  for (var o = 1; o <= parade.numProperties; o++) if (!chosen[o]) parade.property(o).locked = true;` : ''}
  out.push({ layer: ls[i].index, masks: list });
}
__result__ = { layers: out };`, { undo: 'Set masks' }));
        },
    },
    {
        name: 'manage_masks',
        description: 'Delete masks (or all of them: Layer > Masks > Remove All Masks), duplicate them (Edit > Duplicate), select them or move the selection to the next or previous mask, toggle Layer > Mask > Hide Locked Masks, or limit an effect to masks (the effect\'s Compositing Options > Mask Reference)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, masks: MASKS_SCHEMA,
                action: { type: 'string', enum: ['delete', 'duplicate', 'select', 'select_next', 'select_previous', 'toggle_hide_locked', 'reference_in_effect'], description: 'delete (every mask when masks is omitted), duplicate, select (only these), select_next or select_previous (from the selected mask on each layer), toggle_hide_locked (Hide Locked Masks on the layers), reference_in_effect (add the masks to an effect\'s Mask Reference list)' },
                effect: { type: ['string', 'integer'], description: 'reference_in_effect: the effect on the layer, by name or 1-based index in the Effect Controls panel' },
            },
            required: ['layers', 'action'],
        },
        hints: { destructive: true },
        auditArgs: { masks: { names: ['Mask 1'] }, action: 'reference_in_effect', effect: 'Gaussian Blur' },
        features: [
            'aftereffects.masks_shapes.delete_mask',
            'aftereffects.masks_shapes.remove_all_masks',
            'aftereffects.masks_shapes.duplicate_mask',
            'aftereffects.masks_shapes.select_next_previous_mask',
            'aftereffects.masks_shapes.hide_locked_masks',
            'aftereffects.masks_shapes.mask_reference',
        ],
        handler: (a) => {
            const action = enumOf(a.action, ['delete', 'duplicate', 'select', 'select_next', 'select_previous', 'toggle_hide_locked', 'reference_in_effect'], { name: 'action' });
            const head = `${MASK_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), spec = ${maskSpec(a.masks)}, out = [];
var __indexes = function (ms) { var ix = []; for (var q = 0; q < ms.length; q++) ix.push(ms[q].propertyIndex); ix.sort(function (x, y) { return y - x; }); return ix; };`;
            let body;
            if (action === 'delete' || action === 'duplicate') {
                body = `
for (var i = 0; i < ls.length; i++) {
  var ix = __indexes(__masks(ls[i], spec)), names = [];
  for (var j = 0; j < ix.length; j++) {
    var m = __parade(ls[i]).property(ix[j]);
    names.push(m.name);
    ${action === 'delete' ? 'm.remove();' : 'm.duplicate();'}
  }
  out.push({ layer: ls[i].index, ${action === 'delete' ? 'removed' : 'duplicated'}: names, masks: __parade(ls[i]).numProperties });
}`;
            } else if (action === 'select') {
                body = `
for (var i = 0; i < ls.length; i++) {
  var parade = __parade(ls[i]), ms = __masks(ls[i], spec), names = [];
  for (var o = 1; o <= parade.numProperties; o++) parade.property(o).selected = false;
  for (var j = 0; j < ms.length; j++) { ms[j].selected = true; names.push(ms[j].name); }
  out.push({ layer: ls[i].index, selected: names });
}`;
            } else if (action === 'select_next' || action === 'select_previous') {
                body = `
for (var i = 0; i < ls.length; i++) {
  var parade = __parade(ls[i]), n = parade.numProperties, cur = 0;
  if (!n) throw new Error(ls[i].name + " has no masks");
  for (var o = 1; o <= n; o++) if (parade.property(o).selected) { cur = o; ${action === 'select_next' ? '' : 'break;'} }
  var next = ${action === 'select_next' ? 'cur >= n ? 1 : cur + 1' : 'cur <= 1 ? n : cur - 1'};
  for (o = 1; o <= n; o++) parade.property(o).selected = false;
  parade.property(next).selected = true;
  out.push({ layer: ls[i].index, selected: parade.property(next).name, index: next });
}`;
            } else if (action === 'toggle_hide_locked') {
                body = `
c.openInViewer();
for (var s = c.selectedLayers.length - 1; s >= 0; s--) c.selectedLayers[s].selected = false;
for (var i = 0; i < ls.length; i++) { ls[i].selected = true; out.push({ layer: ls[i].index }); }
app.executeCommand(2524);`;
            } else {
                if (a.effect === undefined || a.effect === '') throw new Error("reference_in_effect needs 'effect'");
                const fx = typeof a.effect === 'number' ? index(a.effect, { name: 'effect', max: 1000 }) : str(a.effect);
                body = `
for (var i = 0; i < ls.length; i++) {
  var ms = __masks(ls[i], spec), refs = [];
  if (!ms.length) throw new Error(ls[i].name + " has no masks");
  for (var j = 0; j < ms.length; j++) {
    var fx = ls[i].property("ADBE Effect Parade").property(${fx});
    if (!fx) throw new Error(ls[i].name + " has no effect " + ${fx});
    var group = fx.property("ADBE Effect Built In Params").property("ADBE Effect Mask Parade");
    if (!group.canAddProperty("ADBE Effect Mask")) throw new Error(fx.name + " cannot take a mask reference");
    group.addProperty("ADBE Effect Mask").property("ADBE Effect Path Stream Ref").setValue(ms[j].propertyIndex);
    refs.push(ms[j].name);
  }
  out.push({ layer: ls[i].index, effect: fx.name, masks: refs });
}`;
            }
            return run('Manage masks', script(`${head}${body}
__result__ = { action: ${str(action)}, layers: out };`, { undo: 'Manage masks' }));
        },
    },
    {
        name: 'set_bezier_path',
        description: 'Edit a mask path or a shape layer\'s Path property: replace its vertices and tangents, make another vertex the first (Layer > Mask and Shape Path > Set First Vertex), reverse its direction, move, scale and rotate all its points about an anchor (as Free Transform Points does), or set variable-width feather points on a mask (Mask Feather tool: extent, tension, Hold, inner or outer). Points are in the layer\'s own pixels; tangents are relative to their vertex; vertex and segment numbers start at 0',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                mask: { type: ['string', 'integer'], description: 'The mask, by name or 1-based index' },
                property: { ...PROPERTY_SCHEMA, description: 'Instead of mask: a shape layer Path property, a path of match names or names from the layer, e.g. ["ADBE Root Vectors Group", "Shape 1", "ADBE Vectors Group", "Path 1", "ADBE Vector Shape"]' },
                vertices: { type: 'array', items: XY, description: 'Replace the path: vertices [[x, y], ...]' },
                inTangents: { type: 'array', items: XY, description: 'With vertices: in tangents relative to each vertex; default none' },
                outTangents: { type: 'array', items: XY, description: 'With vertices: out tangents relative to each vertex; default none' },
                closed: { type: 'boolean', description: 'With vertices: closed path. Default true' },
                firstVertex: { type: 'integer', minimum: 0, description: 'Make this vertex (0-based) the first one of a closed path' },
                reverse: { type: 'boolean', description: 'Reverse the order of the vertices (the path direction)' },
                transform: {
                    type: 'object',
                    description: 'Transform every point together about an anchor, as Free Transform Points does',
                    properties: {
                        offset: { ...XY, description: 'Move by [dx, dy] pixels' },
                        scale: { ...XY, description: 'Scale [x, y] percent. Default [100, 100]' },
                        rotation: { type: 'number', description: 'Degrees clockwise' },
                        anchor: { ...XY, description: 'Point to scale and rotate about; default the centre of the points' },
                    },
                },
                featherPoints: {
                    type: 'array',
                    description: 'Masks: replace the variable-width feather points ([] removes them)',
                    items: {
                        type: 'object',
                        properties: {
                            segment: { type: 'integer', minimum: 0, description: 'Path segment, 0 = from the first vertex to the second' },
                            position: { type: 'number', minimum: 0, maximum: 1, description: 'Where on the segment, 0 to 1. Default 0.5' },
                            radius: { type: 'number', description: 'Feather extent in pixels' },
                            inner: { type: 'boolean', description: 'Inner feather point. Default outer' },
                            hold: { type: 'boolean', description: 'Hold: keep this radius to the next feather point' },
                            tension: { type: 'number', minimum: 0, maximum: 1, description: 'Tension, 0 to 1. Default 0' },
                            cornerAngle: { type: 'number', minimum: 0, maximum: 100, description: 'Corner angle percent (100 = 180 degrees). Default 0' },
                        },
                        required: ['segment', 'radius'],
                    },
                },
                time: { type: 'number', description: 'Seconds: set a keyframe at this time. Default: the static value, or a keyframe at the current time when the path is animated' },
                allKeyframes: { type: 'boolean', description: 'Apply firstVertex, reverse, transform or featherPoints to every keyframe of an animated path' },
            },
            required: ['layers'],
        },
        auditArgs: { mask: 1, property: undefined, vertices: [[0, 0], [100, 0], [100, 100]], inTangents: undefined, outTangents: undefined, firstVertex: 1, reverse: true, transform: { offset: [10, 0], scale: [50, 50], rotation: 45 }, featherPoints: [{ segment: 0, radius: 20, hold: true, tension: 0.5 }], time: undefined, allKeyframes: false },
        features: [
            'aftereffects.masks_shapes.shape_object',
            'aftereffects.masks_shapes.set_first_vertex',
            'aftereffects.masks_shapes.free_transform_points',
            'aftereffects.masks_shapes.feather_points',
            'aftereffects.masks_shapes.feather_point_extent',
            'aftereffects.masks_shapes.feather_point_tension',
            'aftereffects.masks_shapes.feather_point_hold',
        ],
        handler: (a) => {
            if ((a.mask === undefined) === (a.property === undefined)) throw new Error('Give mask (a mask name or index) or property (a shape layer Path property)');
            if (a.property !== undefined && a.featherPoints !== undefined) throw new Error('featherPoints apply to masks only');
            const xf = { apply: false, anchor: null, rotation: 0, scale: [100, 100], offset: [0, 0] };
            if (a.transform !== undefined) {
                const t = a.transform ?? {};
                xf.apply = true;
                if (t.anchor !== undefined) xf.anchor = points([t.anchor], 'transform.anchor')[0];
                if (t.rotation !== undefined) xf.rotation = Number(num(t.rotation, { min: -36000, max: 36000, name: 'transform.rotation' }));
                if (t.scale !== undefined) xf.scale = points([t.scale], 'transform.scale')[0];
                if (t.offset !== undefined) xf.offset = points([t.offset], 'transform.offset')[0];
            }
            const op = {
                replace: a.vertices !== undefined ? pathValue(a) : null,
                feather: a.featherPoints !== undefined ? featherArrays(a.featherPoints) : null,
                first: a.firstVertex !== undefined ? Number(index(a.firstVertex, { name: 'firstVertex', max: 10000 })) : 0,
                reverse: Boolean(a.reverse),
                xf,
            };
            if (!op.replace && !op.feather && !op.first && !op.reverse && !xf.apply) throw new Error('Nothing to change: give vertices, firstVertex, reverse, transform or featherPoints');
            if (op.replace && a.allKeyframes) throw new Error('vertices replace the path at one time; leave allKeyframes off');
            const target = a.property !== undefined
                ? `__prop(ls[i], ${propertyPath(a.property)})`
                : `(function () { var mk = __parade(ls[i]).property(${typeof a.mask === 'number' ? index(a.mask, { name: 'mask', max: 10000 }) : str(a.mask)}); if (!mk) throw new Error(ls[i].name + " has no mask " + ${str(a.mask)}); return mk.property("ADBE Mask Shape"); })()`;
            const t = a.time !== undefined ? num(a.time, { name: 'time' }) : 'null';
            return run('Set path', script(`${MASK_HELPERS}${SHAPE_EDIT}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), op = ${json(op)}, t = ${t}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = ${target};
  if (p.propertyValueType !== PropertyValueType.SHAPE) throw new Error(p.name + " is not a mask or shape path");
  if (${bool(a.allKeyframes)} && p.numKeys > 0) { for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, __editShape(p.keyValue(k), op)); }
  else if (t !== null) p.setValueAtTime(t, __editShape(p.valueAtTime(t, false), op));
  else if (p.numKeys > 0) p.setValueAtTime(c.time, __editShape(p.valueAtTime(c.time, false), op));
  else p.setValue(__editShape(p.value, op));
  var sh = p.valueAtTime(t !== null ? t : c.time, false);
  out.push({ layer: ls[i].index, property: p.name, vertices: sh.vertices, inTangents: sh.inTangents, outTangents: sh.outTangents, closed: sh.closed, featherPoints: __feather(sh), keys: p.numKeys });
}
__result__ = { paths: out };`, { undo: 'Set path' }));
        },
    },
];
