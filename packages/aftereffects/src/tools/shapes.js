/**
 * Shape layers: list the Contents tree; add groups, paths (rectangle, ellipse,
 * polystar, free path), paint (fill, stroke, gradient fill and stroke) and path
 * operations (merge, offset, pucker and bloat, repeater, round corners, trim,
 * twist, wiggle paths, wiggle transform, zig zag) with their settings; change
 * those settings; delete, duplicate, reorder, group, ungroup and convert paths;
 * and convert vector footage layers to shape layers.
 *
 * Shape content is addressed by a group path from the layer's Contents (group
 * names or 1-based indexes) and items within it. Positions are pixels in the
 * layer's (or enclosing group's) own coordinates.
 */
import { str, num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue, propertyValue } from '../args.js';
import { pathValue } from './masks.js';

const T = 'ADBE Vector Transform Group';
const RT = 'ADBE Vector Repeater Transform';
const TAPER = 'ADBE Vector Stroke Taper';
const WAVE = 'ADBE Vector Stroke Wave';
const DASHES = 'ADBE Vector Stroke Dashes';
const DIR = 'ADBE Vector Shape Direction';
const DASH_NAMES = ['ADBE Vector Stroke Dash 1', 'ADBE Vector Stroke Gap 1', 'ADBE Vector Stroke Dash 2', 'ADBE Vector Stroke Gap 2', 'ADBE Vector Stroke Dash 3', 'ADBE Vector Stroke Gap 3'];

// Menu values of the shape properties' pop-ups, numbered from 1 as After Effects stores them.
const LINE_CAP = { butt: 1, round: 2, projecting: 3 };
const LINE_JOIN = { miter: 1, round: 2, bevel: 3 };
const FILL_RULE = { non_zero: 1, even_odd: 2 };
const COMPOSITE = { below: 1, above: 2 };
const GRADIENT = { linear: 1, radial: 2 };
const STAR = { star: 1, polygon: 2 };
const MERGE = { merge: 1, add: 2, subtract: 3, intersect: 4, exclude_intersections: 5 };
const TRIM = { simultaneously: 1, individually: 2 };
const POINTS = { corner: 1, smooth: 2 };
const LENGTH_UNITS = { percent: 1, pixels: 2 };
const WAVE_UNITS = { pixels: 1, cycles: 2 };

const XY = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

/** Option kinds: a schema and a converter from the caller's value to a property value. */
const number = (description, min = -1e6, max = 1e6) => ({
    schema: { type: 'number', minimum: min, maximum: max, description },
    value: (v, name) => Number(num(v, { min, max, name })),
});
const pair = (description) => ({
    schema: { ...XY, description },
    value: (v, name) => {
        if (!Array.isArray(v) || v.length !== 2) throw new Error(`'${name}' must be [x, y]`);
        return v.map((x, i) => Number(num(x, { name: `${name}[${i}]` })));
    },
});
const choice = (description, map) => ({
    schema: { type: 'string', enum: Object.keys(map), description },
    value: (v, name) => map[enumOf(v, Object.keys(map), { name })],
});
const colour = (description) => ({
    schema: { ...COLOR_SCHEMA, description },
    value: (v, name) => [...JSON.parse(colorValue(v, name)), 1],
});

/** Every option an item can take; TYPES says which apply to which item. */
const OPTIONS = {
    size: pair('Rectangle, ellipse: [width, height] pixels'),
    position: pair('Rectangle, ellipse, polystar: centre; group, repeater: Transform Position'),
    roundness: number('Rectangle: corner roundness, pixels', 0),
    reversed: { schema: { type: 'boolean', description: 'Rectangle, ellipse, polystar, path: Reverse Path Direction' }, value: (v) => (v ? 3 : 1) },
    starType: choice('Polystar: star or polygon', STAR),
    starPoints: number('Polystar: number of points', 3, 1000),
    rotation: number('Polystar: rotation; group, repeater: Transform Rotation, degrees'),
    outerRadius: number('Polystar: outer radius, pixels', 0),
    innerRadius: number('Polystar (star): inner radius, pixels', 0),
    outerRoundness: number('Polystar: outer roundness, percent', -10000, 10000),
    innerRoundness: number('Polystar (star): inner roundness, percent', -10000, 10000),
    anchor: pair('Group, repeater: Transform Anchor Point'),
    scale: pair('Group, repeater: Transform Scale [x, y] percent'),
    skew: number('Group: Transform Skew', -85, 85),
    skewAxis: number('Group: Transform Skew Axis, degrees'),
    opacity: number('Group: Transform Opacity; fill, stroke, gradients: Opacity, percent', 0, 100),
    blendMode: { schema: { type: 'integer', minimum: 1, maximum: 50, description: 'Group, fill, stroke, gradients: Blend Mode, as numbered in its menu (1 = Normal)' }, value: (v, name) => Number(index(v, { name, max: 50 })) },
    color: colour('Fill, stroke: colour, "#RRGGBB" or "rgb(r,g,b)"'),
    fillRule: choice('Fill, gradient fill: Fill Rule', FILL_RULE),
    composite: choice('Fill, stroke, gradients: Composite (below or above previous in same group); repeater: copies stack below or above', COMPOSITE),
    width: number('Stroke, gradient stroke: Stroke Width, pixels', 0, 10000),
    lineCap: choice('Stroke, gradient stroke: Line Cap', LINE_CAP),
    lineJoin: choice('Stroke, gradient stroke, offset paths: Line Join', LINE_JOIN),
    miterLimit: number('Stroke, gradient stroke, offset paths: Miter Limit', 1, 100),
    gradientType: choice('Gradients: linear or radial', GRADIENT),
    startPoint: pair('Gradients: Start Point'),
    endPoint: pair('Gradients: End Point'),
    highlightLength: number('Gradients (radial): Highlight Length, percent', -100, 100),
    highlightAngle: number('Gradients (radial): Highlight Angle, degrees'),
    mergeMode: choice('Merge Paths: Mode', MERGE),
    amount: number('Offset Paths: Amount (pixels); Pucker & Bloat: Amount (percent); Wiggle Paths, Zig Zag: Size (pixels)'),
    copies: number('Offset Paths, repeater: Copies', 0, 10000),
    copyOffset: number('Offset Paths: Copy Offset'),
    offset: number('Repeater: Offset (copies); Trim Paths: Offset (degrees)'),
    startOpacity: number('Repeater: Transform Start Opacity, percent', 0, 100),
    endOpacity: number('Repeater: Transform End Opacity, percent', 0, 100),
    radius: number('Round Corners: Radius, pixels', 0),
    start: number('Trim Paths: Start, percent', 0, 100),
    end: number('Trim Paths: End, percent', 0, 100),
    trimMultiple: choice('Trim Paths: Trim Multiple Shapes', TRIM),
    angle: number('Twist: Angle, degrees'),
    center: pair('Twist: Center'),
    detail: number('Wiggle Paths: Detail; Zig Zag: Ridges per segment', 0, 10000),
    pointType: choice('Wiggle Paths, Zig Zag: Points', POINTS),
    wigglesPerSecond: number('Wiggle Paths, Wiggle Transform: Wiggles/Second', -1000, 1000),
    correlation: number('Wiggle Paths, Wiggle Transform: Correlation, percent', 0, 100),
    temporalPhase: number('Wiggle Paths, Wiggle Transform: Temporal Phase, degrees'),
    spatialPhase: number('Wiggle Paths, Wiggle Transform: Spatial Phase, degrees'),
    randomSeed: number('Wiggle Paths, Wiggle Transform: Random Seed', 0, 1e6),
};

/** Options with their own handling: the path, dashes, taper and wave. */
const SPECIAL = {
    path: {
        type: 'object',
        description: 'Path: { vertices: [[x, y], ...], inTangents, outTangents (relative to each vertex), closed (default true) }',
        properties: { vertices: { type: 'array', items: XY }, inTangents: { type: 'array', items: XY }, outTangents: { type: 'array', items: XY }, closed: { type: 'boolean' } },
    },
    dashes: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 1, maxItems: 6, description: 'Stroke, gradient stroke: Dashes as [dash, gap, dash, gap, dash, gap], up to three pairs' },
    dashOffset: { type: 'number', description: 'Stroke, gradient stroke: dash Offset, pixels' },
    taper: {
        type: 'object',
        description: 'Stroke, gradient stroke: Taper',
        properties: {
            startLength: { type: 'number', description: 'Start Length' }, endLength: { type: 'number', description: 'End Length' },
            startWidth: { type: 'number', description: 'Start Width, percent' }, endWidth: { type: 'number', description: 'End Width, percent' },
            startEase: { type: 'number', description: 'Start Ease, percent' }, endEase: { type: 'number', description: 'End Ease, percent' },
            lengthUnits: { type: 'string', enum: Object.keys(LENGTH_UNITS), description: 'Length Units' },
        },
    },
    wave: {
        type: 'object',
        description: 'Stroke, gradient stroke: Wave',
        properties: {
            amount: { type: 'number', description: 'Amount, percent' }, units: { type: 'string', enum: Object.keys(WAVE_UNITS), description: 'Units' },
            wavelength: { type: 'number', description: 'Wavelength (pixels, or cycles)' }, phase: { type: 'number', description: 'Phase, degrees' },
        },
    },
};
const TAPER_NAMES = {
    startLength: 'ADBE Vector Taper Start Length', endLength: 'ADBE Vector Taper End Length', startWidth: 'ADBE Vector Taper Start Width',
    endWidth: 'ADBE Vector Taper End Width', startEase: 'ADBE Vector Taper Start Ease', endEase: 'ADBE Vector Taper End Ease', lengthUnits: 'ADBE Vector Taper Length Units',
};
const WAVE_NAMES = { amount: 'ADBE Vector Taper Wave Amount', units: 'ADBE Vector Taper Wave Units', wavelength: 'ADBE Vector Taper Wavelength', phase: 'ADBE Vector Taper Wave Phase' };

const PAINT = { blendMode: ['ADBE Vector Blend Mode'], composite: ['ADBE Vector Composite Order'] };
const LINE = { width: ['ADBE Vector Stroke Width'], lineCap: ['ADBE Vector Stroke Line Cap'], lineJoin: ['ADBE Vector Stroke Line Join'], miterLimit: ['ADBE Vector Stroke Miter Limit'], dashes: true, dashOffset: true, taper: true, wave: true };
const GRAD = { gradientType: ['ADBE Vector Grad Type'], startPoint: ['ADBE Vector Grad Start Pt'], endPoint: ['ADBE Vector Grad End Pt'], highlightLength: ['ADBE Vector Grad HiLite Length'], highlightAngle: ['ADBE Vector Grad HiLite Angle'] };
const WIGGLE = { correlation: ['ADBE Vector Correlation'], temporalPhase: ['ADBE Vector Temporal Phase'], spatialPhase: ['ADBE Vector Spatial Phase'], randomSeed: ['ADBE Vector Random Seed'] };

/** Item types: match name and, per option, the property path from the item (true: special). */
const TYPES = {
    group: ['ADBE Vector Group', { blendMode: ['ADBE Vector Blend Mode'], anchor: [T, 'ADBE Vector Anchor'], position: [T, 'ADBE Vector Position'], scale: [T, 'ADBE Vector Scale'], skew: [T, 'ADBE Vector Skew'], skewAxis: [T, 'ADBE Vector Skew Axis'], rotation: [T, 'ADBE Vector Rotation'], opacity: [T, 'ADBE Vector Group Opacity'] }],
    rectangle: ['ADBE Vector Shape - Rect', { size: ['ADBE Vector Rect Size'], position: ['ADBE Vector Rect Position'], roundness: ['ADBE Vector Rect Roundness'], reversed: [DIR] }],
    ellipse: ['ADBE Vector Shape - Ellipse', { size: ['ADBE Vector Ellipse Size'], position: ['ADBE Vector Ellipse Position'], reversed: [DIR] }],
    polystar: ['ADBE Vector Shape - Star', {
        starType: ['ADBE Vector Star Type'], starPoints: ['ADBE Vector Star Points'], position: ['ADBE Vector Star Position'], rotation: ['ADBE Vector Star Rotation'],
        innerRadius: ['ADBE Vector Star Inner Radius'], outerRadius: ['ADBE Vector Star Outer Radius'],
        innerRoundness: ['ADBE Vector Star Inner Roundess'], outerRoundness: ['ADBE Vector Star Outer Roundess'], reversed: [DIR],
    }],
    path: ['ADBE Vector Shape - Group', { path: true, reversed: [DIR] }],
    fill: ['ADBE Vector Graphic - Fill', { ...PAINT, color: ['ADBE Vector Fill Color'], opacity: ['ADBE Vector Fill Opacity'], fillRule: ['ADBE Vector Fill Rule'] }],
    stroke: ['ADBE Vector Graphic - Stroke', { ...PAINT, ...LINE, color: ['ADBE Vector Stroke Color'], opacity: ['ADBE Vector Stroke Opacity'] }],
    gradient_fill: ['ADBE Vector Graphic - G-Fill', { ...PAINT, ...GRAD, opacity: ['ADBE Vector Fill Opacity'], fillRule: ['ADBE Vector Fill Rule'] }],
    gradient_stroke: ['ADBE Vector Graphic - G-Stroke', { ...PAINT, ...GRAD, ...LINE, opacity: ['ADBE Vector Stroke Opacity'] }],
    merge_paths: ['ADBE Vector Filter - Merge', { mergeMode: ['ADBE Vector Merge Type'] }],
    offset_paths: ['ADBE Vector Filter - Offset', { amount: ['ADBE Vector Offset Amount'], lineJoin: ['ADBE Vector Offset Line Join'], miterLimit: ['ADBE Vector Offset Miter Limit'], copies: ['ADBE Vector Offset Copies'], copyOffset: ['ADBE Vector Offset Copy Offset'] }],
    pucker_bloat: ['ADBE Vector Filter - PB', { amount: ['ADBE Vector PuckerBloat Amount'] }],
    repeater: ['ADBE Vector Filter - Repeater', {
        copies: ['ADBE Vector Repeater Copies'], offset: ['ADBE Vector Repeater Offset'], composite: ['ADBE Vector Repeater Order'],
        anchor: [RT, 'ADBE Vector Repeater Anchor'], position: [RT, 'ADBE Vector Repeater Position'], scale: [RT, 'ADBE Vector Repeater Scale'],
        rotation: [RT, 'ADBE Vector Repeater Rotation'], startOpacity: [RT, 'ADBE Vector Repeater Opacity 1'], endOpacity: [RT, 'ADBE Vector Repeater Opacity 2'],
    }],
    round_corners: ['ADBE Vector Filter - RC', { radius: ['ADBE Vector RoundCorner Radius'] }],
    trim_paths: ['ADBE Vector Filter - Trim', { start: ['ADBE Vector Trim Start'], end: ['ADBE Vector Trim End'], offset: ['ADBE Vector Trim Offset'], trimMultiple: ['ADBE Vector Trim Type'] }],
    twist: ['ADBE Vector Filter - Twist', { angle: ['ADBE Vector Twist Angle'], center: ['ADBE Vector Twist Center'] }],
    wiggle_paths: ['ADBE Vector Filter - Roughen', { ...WIGGLE, amount: ['ADBE Vector Roughen Size'], detail: ['ADBE Vector Roughen Detail'], pointType: ['ADBE Vector Roughen Points'], wigglesPerSecond: ['ADBE Vector Temporal Freq'] }],
    wiggle_transform: ['ADBE Vector Filter - Wiggler', { ...WIGGLE, wigglesPerSecond: ['ADBE Vector Xform Temporal Freq'] }],
    zig_zag: ['ADBE Vector Filter - Zigzag', { amount: ['ADBE Vector Zigzag Size'], detail: ['ADBE Vector Zigzag Detail'], pointType: ['ADBE Vector Zigzag Points'] }],
};
const TYPE_NAMES = Object.keys(TYPES);
/** Match name to type name, for listing. */
const KIND = Object.fromEntries(Object.entries(TYPES).map(([k, [m]]) => [m, k]));
const NOT_OPTIONS = new Set(['type', 'name', 'items', 'properties', 'item', 'enabled']);

/** The settings features that add_shape_content and set_shape_content both cover. */
const SETTING_FEATURES = [
    'shape_group_transform', 'shape_group_blend_mode', 'gradient_mapping', 'dashed_stroke', 'line_cap', 'line_join', 'fill_rule',
    'composite_order', 'reverse_path_direction', 'stroke_taper', 'taper_length_units', 'taper_start_end_length', 'taper_start_end_width',
    'taper_start_end_ease', 'stroke_wave', 'wave_amount', 'wave_units', 'wavelength', 'wave_phase', 'merge_paths_mode', 'repeater_options',
    'trim_multiple_shapes', 'offset_paths_copies', 'zig_zag_points', 'wiggle_paths_correlation',
].map((f) => `aftereffects.masks_shapes.${f}`);

/** Item option schemas, shared by add_shape_content and set_shape_content. */
const OPTION_SCHEMAS = {
    ...Object.fromEntries(Object.entries(OPTIONS).map(([k, o]) => [k, o.schema])),
    ...SPECIAL,
    properties: { type: 'object', description: 'Any other property of the item by match name or name (a nested one as "Group > Property"), to a number, array, text or true/false' },
};

const GROUP_SCHEMA = {
    type: 'array',
    items: { type: ['string', 'integer'] },
    maxItems: 20,
    description: 'The group to work in: names or 1-based indexes of nested groups from the layer\'s Contents, e.g. ["Shape 1"]. Omit for Contents itself',
};

/**
 * Property operations for one item's options, or null when an option does not
 * apply to the type. Each is { type, path, value }: type "set", "dash" (adds
 * the dash property when missing) or "shape"; path match names from the item.
 */
function opsFor(type, spec, where, strict) {
    const table = TYPES[type][1];
    const ops = [];
    for (const [key, value] of Object.entries(spec)) {
        if (NOT_OPTIONS.has(key) || value === undefined) continue;
        if (!(key in OPTIONS) && !(key in SPECIAL)) throw new Error(`${where}: unknown option ${key}`);
        if (!table[key]) {
            if (strict) throw new Error(`${where}: ${key} does not apply to ${type}`);
            return null;
        }
        const name = `${where}.${key}`;
        if (key === 'path') ops.push({ type: 'shape', path: ['ADBE Vector Shape'], value: pathValue(value, name) });
        else if (key === 'dashes') {
            if (!Array.isArray(value) || !value.length || value.length > 6) throw new Error(`'${name}' lists 1 to 6 numbers: dash, gap, dash, gap, dash, gap`);
            value.forEach((d, i) => ops.push({ type: 'dash', path: [DASHES, DASH_NAMES[i]], value: Number(num(d, { min: 0, max: 1e6, name: `${name}[${i}]` })) }));
        } else if (key === 'dashOffset') ops.push({ type: 'dash', path: [DASHES, 'ADBE Vector Stroke Offset'], value: Number(num(value, { name })) });
        else if (key === 'taper' || key === 'wave') {
            if (!value || typeof value !== 'object') throw new Error(`'${name}' must be an object`);
            const names = key === 'taper' ? TAPER_NAMES : WAVE_NAMES;
            for (const [sub, v] of Object.entries(value)) {
                if (!names[sub]) throw new Error(`'${name}': unknown ${sub}. Use ${Object.keys(names).join(', ')}`);
                let val;
                if (sub === 'lengthUnits') val = LENGTH_UNITS[enumOf(v, Object.keys(LENGTH_UNITS), { name: `${name}.${sub}` })];
                else if (sub === 'units') val = WAVE_UNITS[enumOf(v, Object.keys(WAVE_UNITS), { name: `${name}.${sub}` })];
                else val = Number(num(v, { min: -1e6, max: 1e6, name: `${name}.${sub}` }));
                ops.push({ type: 'set', path: [key === 'taper' ? TAPER : WAVE, names[sub]], value: val });
            }
        } else ops.push({ type: 'set', path: table[key], value: OPTIONS[key].value(value, name) });
    }
    if (spec.properties !== undefined) {
        if (!spec.properties || typeof spec.properties !== 'object' || Array.isArray(spec.properties)) throw new Error(`${where}.properties must be an object`);
        for (const [k, v] of Object.entries(spec.properties)) {
            ops.push({ type: 'set', path: String(k).split('>').map((s) => s.trim()).filter(Boolean), value: JSON.parse(propertyValue(v, `${where}.properties.${k}`)) });
        }
    }
    return ops;
}

/** An item tree for add_shape_content: { matchName, name, settings, items }. */
function itemTree(list, where, depth = 0) {
    if (!Array.isArray(list) || !list.length || list.length > 200) throw new Error(`'${where}' must list 1 to 200 items`);
    if (depth > 8) throw new Error(`'${where}': groups nest at most 8 deep`);
    return list.map((spec, i) => {
        const w = `${where}[${i}]`;
        if (!spec || typeof spec !== 'object') throw new Error(`'${w}' must be an object`);
        const type = enumOf(spec.type, TYPE_NAMES, { name: `${w}.type` });
        if (spec.items !== undefined && type !== 'group') throw new Error(`'${w}.items': only a group holds items`);
        return {
            matchName: TYPES[type][0],
            name: spec.name === undefined ? null : String(spec.name),
            settings: opsFor(type, spec, w, true),
            items: spec.items === undefined ? [] : itemTree(spec.items, `${w}.items`, depth + 1),
        };
    });
}

/** The group path as a JSX literal. */
function groupPath(group) {
    if (group === undefined) return '[]';
    if (!Array.isArray(group) || group.length > 20) throw new Error("'group' must be a list of group names or indexes");
    return json(group.map((g, i) => (typeof g === 'number' ? Number(index(g, { name: `group[${i}]`, max: 10000 })) : String(g))));
}

/** Items in a group, by names or 1-based indexes, as a JSX literal. */
function itemList(items, name = 'items') {
    if (!Array.isArray(items) || !items.length || items.length > 500) throw new Error(`'${name}' must list item names or 1-based indexes`);
    return json(items.map((g, i) => {
        if (typeof g === 'number') {
            const n = Number(index(g, { name: `${name}[${i}]`, max: 10000 }));
            if (n < 1) throw new Error(`'${name}' indexes start at 1`);
            return n;
        }
        return String(g);
    }));
}

/** ES3: find shape layers' contents and groups, and apply property operations. */
const SHAPE_HELPERS = `
var __contents = function (layer, path) {
  if (!(layer instanceof ShapeLayer)) throw new Error(layer.name + " is not a shape layer");
  var g = layer.property("ADBE Root Vectors Group");
  for (var i = 0; i < path.length; i++) {
    var grp = g.property(path[i]);
    if (!grp || grp.matchName !== "ADBE Vector Group") throw new Error("No group " + path.slice(0, i + 1).join(" > ") + " in " + layer.name);
    g = grp.property("ADBE Vectors Group");
  }
  return g;
};
var __items = function (g, names, layer) {
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var it = g.property(names[i]);
    if (!it) throw new Error(layer.name + " has no shape item " + names[i] + " here");
    out.push(it);
  }
  return out;
};
var __apply = function (item, ops, t, now) {
  for (var o = 0; o < ops.length; o++) {
    var op = ops[o], p = item;
    for (var j = 0; j < op.path.length; j++) {
      var next = p.property(op.path[j]);
      if (!next && op.type === "dash" && j === op.path.length - 1) {
        if (!p.canAddProperty(op.path[j])) throw new Error(item.name + ": cannot add " + op.path[j]);
        next = p.addProperty(op.path[j]);
      }
      if (!next) throw new Error(item.name + " has no property " + op.path.slice(0, j + 1).join(" > "));
      p = next;
    }
    var v = op.value;
    if (op.type === "shape") { var s = new Shape(); s.vertices = v.vertices; s.inTangents = v.inTangents; s.outTangents = v.outTangents; s.closed = v.closed; v = s; }
    if (t !== null) p.setValueAtTime(t, v);
    else if (p.numKeys > 0) p.setValueAtTime(now, v);
    else p.setValue(v);
  }
};`;

/** ES3: an item's property values as a nested object. */
export const PROPERTY_TREE = `
var __tree = function (g, depth) {
  var o = {};
  for (var i = 1; i <= g.numProperties; i++) {
    var p = g.property(i);
    if (p.propertyType === PropertyType.PROPERTY) {
      try {
        var v = p.value;
        if (v instanceof Shape) v = { vertices: v.vertices, inTangents: v.inTangents, outTangents: v.outTangents, closed: v.closed };
        o[p.name] = p.numKeys > 0 ? { value: v, keys: p.numKeys } : v;
      } catch (e) {}
    } else if (depth < 4 && p.matchName !== "ADBE Vectors Group") o[p.name] = __tree(p, depth + 1);
  }
  return o;
};`;

const LAYER_TARGET = { ...LAYERS_SCHEMA, description: 'Which shape layers: indexes (1-based), names, or selected: true' };

export const tools = [
    {
        name: 'list_shape_content',
        description: 'List a shape layer\'s Contents (Timeline panel): groups, paths, fills, strokes and path operations as a tree with their type and match name, optionally with every property value',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYER_TARGET, group: GROUP_SCHEMA,
                values: { type: 'boolean', description: 'Include each item\'s property values. Default false' },
            },
            required: ['layers'],
        },
        hints: { readOnly: true },
        auditArgs: { group: ['Shape 1'], values: true },
        features: ['aftereffects.masks_shapes.shape_layer_object'],
        handler: (a) => run('List shape content', script(`${SHAPE_HELPERS}${PROPERTY_TREE}
var kinds = ${json(KIND)}, withValues = ${a.values ? 'true' : 'false'};
var __list = function (g, depth) {
  var out = [];
  for (var i = 1; i <= g.numProperties; i++) {
    var p = g.property(i), e = { index: i, name: p.name, type: kinds[p.matchName] || null, matchName: p.matchName, enabled: p.enabled };
    if (withValues) e.values = __tree(p, 0);
    if (p.matchName === "ADBE Vector Group" && depth < 20) e.items = __list(p.property("ADBE Vectors Group"), depth + 1);
    out.push(e);
  }
  return out;
};
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${groupPath(a.group)}, out = [];
for (var i = 0; i < ls.length; i++) out.push({ layer: ls[i].index, name: ls[i].name, items: __list(__contents(ls[i], path), 0) });
__result__ = { layers: out };`)),
    },
    {
        name: 'add_shape_content',
        description: 'Add shapes to shape layers (the Timeline panel\'s Add menu), or to a new shape layer: groups (which can hold items of their own), rectangle, ellipse, polystar and free paths, fill, stroke, gradient fill and gradient stroke, and the path operations Merge Paths, Offset Paths, Pucker & Bloat, Repeater, Round Corners, Trim Paths, Twist, Wiggle Paths, Wiggle Transform and Zig Zag, each with its settings. Items are added in order at the end of the group. Gradient colours are set in the Gradient Editor',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYER_TARGET, description: 'Shape layers to add to; omit to create a new shape layer' },
                layerName: { type: 'string', description: 'Name of the new shape layer when layers is omitted' },
                group: GROUP_SCHEMA,
                items: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 200,
                    description: 'Items to add, in order (paint and operations act on the paths above them in the same group)',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: TYPE_NAMES, description: 'What to add' },
                            name: { type: 'string', description: 'Item name' },
                            items: { type: 'array', items: { type: 'object' }, description: 'Group: items inside it, in the same form' },
                            ...OPTION_SCHEMAS,
                        },
                        required: ['type'],
                    },
                },
                time: { type: 'number', description: 'Seconds: set the values as keyframes at this time' },
            },
            required: ['items'],
        },
        auditArgs: {
            layers: undefined, layerName: 'Badge', group: undefined, time: undefined,
            items: [{
                type: 'group', name: 'Badge', position: [0, 0], blendMode: 1,
                items: [
                    { type: 'polystar', starType: 'star', starPoints: 5, outerRadius: 100, innerRadius: 50 },
                    { type: 'path', path: { vertices: [[0, 0], [50, 50]], closed: false }, reversed: true },
                    { type: 'gradient_fill', gradientType: 'radial', startPoint: [0, 0], endPoint: [100, 0], highlightLength: 20, fillRule: 'even_odd' },
                    { type: 'stroke', color: '#FFFFFF', width: 4, lineCap: 'round', lineJoin: 'bevel', dashes: [10, 5], dashOffset: 2, taper: { startLength: 20, lengthUnits: 'pixels' }, wave: { amount: 10, units: 'cycles' }, composite: 'above' },
                    { type: 'repeater', copies: 5, offset: 0, composite: 'above', position: [120, 0], startOpacity: 100, endOpacity: 20 },
                    { type: 'trim_paths', start: 0, end: 50, trimMultiple: 'individually' },
                ],
            }],
        },
        features: [
            'aftereffects.masks_shapes.shape_layer_object',
            'aftereffects.masks_shapes.add_group_empty',
            'aftereffects.masks_shapes.add_rectangle',
            'aftereffects.masks_shapes.add_ellipse',
            'aftereffects.masks_shapes.add_polystar',
            'aftereffects.masks_shapes.add_path',
            'aftereffects.masks_shapes.add_fill',
            'aftereffects.masks_shapes.add_stroke',
            'aftereffects.masks_shapes.add_gradient_fill',
            'aftereffects.masks_shapes.add_gradient_stroke',
            'aftereffects.masks_shapes.add_merge_paths',
            'aftereffects.masks_shapes.add_offset_paths',
            'aftereffects.masks_shapes.add_pucker_bloat',
            'aftereffects.masks_shapes.add_repeater',
            'aftereffects.masks_shapes.add_round_corners',
            'aftereffects.masks_shapes.add_trim_paths',
            'aftereffects.masks_shapes.add_twist',
            'aftereffects.masks_shapes.add_wiggle_paths',
            'aftereffects.masks_shapes.add_wiggle_transform',
            'aftereffects.masks_shapes.add_zig_zag',
            ...SETTING_FEATURES,
        ],
        handler: (a) => {
            const tree = itemTree(a.items, 'items');
            const layers = a.layers === undefined
                ? `[(function () { var l = c.layers.addShape(); ${a.layerName !== undefined ? `l.name = ${str(a.layerName)};` : ''} return l; })()]`
                : `__layers(c, ${layerSpec(a.layers)})`;
            return run('Add shape content', script(`${SHAPE_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = ${layers}, path = ${groupPath(a.group)}, tree = ${json(tree)}, t = ${a.time !== undefined ? num(a.time, { name: 'time' }) : 'null'}, out = [];
var __add = function (g, list) {
  var added = [];
  for (var k = 0; k < list.length; k++) {
    if (!g.canAddProperty(list[k].matchName)) throw new Error("Cannot add " + list[k].matchName + " here");
    var it = g.addProperty(list[k].matchName);
    if (list[k].name !== null) it.name = list[k].name;
    __apply(it, list[k].settings, t, c.time);
    var e = { name: it.name, index: it.propertyIndex, matchName: it.matchName };
    if (list[k].items.length) e.items = __add(it.property("ADBE Vectors Group"), list[k].items);
    added.push(e);
  }
  return added;
};
for (var i = 0; i < ls.length; i++) out.push({ layer: ls[i].index, name: ls[i].name, added: __add(__contents(ls[i], path), tree) });
__result__ = { layers: out };`, { undo: 'Add shape content' }));
        },
    },
    {
        name: 'set_shape_content',
        description: 'Change settings of existing shape items: group Transform and Blend Mode; rectangle, ellipse, polystar and path geometry and Reverse Path Direction; fill and stroke colour, opacity, Stroke Width, Line Cap, Line Join, Dashes, Taper, Wave, Fill Rule and Composite; gradient type, Start and End Point and Highlight; and the path operations\' settings (Merge Paths Mode, Repeater copies, offset and composite, Trim Multiple Shapes, Offset Paths copies, Zig Zag points, Wiggle Paths correlation, ...). Each option must apply to every item named',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYER_TARGET, group: GROUP_SCHEMA,
                items: { type: 'array', items: { type: ['string', 'integer'] }, minItems: 1, description: 'Items in the group, by name or 1-based index' },
                name: { type: 'string', description: 'Rename the item (one item only)' },
                enabled: { type: 'boolean', description: 'Turn the items on or off (eye switch)' },
                ...OPTION_SCHEMAS,
                time: { type: 'number', description: 'Seconds: set keyframes at this time. Default: static values, or keyframes at the current time on animated properties' },
            },
            required: ['layers', 'items'],
        },
        hints: { idempotent: true },
        auditArgs: {
            ...Object.fromEntries(Object.keys(OPTION_SCHEMAS).map((k) => [k, undefined])),
            group: ['Shape 1'], items: ['Stroke 1'], name: undefined, enabled: true, time: undefined,
            width: 6, lineCap: 'round', dashes: [4, 4], dashOffset: 2, taper: { endWidth: 0 }, wave: { units: 'cycles' }, properties: { 'Miter Limit': 4 },
        },
        features: [...SETTING_FEATURES, 'aftereffects.masks_shapes.stroke_width_tools_panel'],
        handler: (a) => {
            const spec = Object.fromEntries(Object.entries(a).filter(([k]) => k in OPTION_SCHEMAS));
            const byMatch = {};
            for (const type of TYPE_NAMES) {
                const ops = opsFor(type, spec, 'options', false);
                if (ops) byMatch[TYPES[type][0]] = ops;
            }
            const opCount = Object.values(byMatch)[0]?.length ?? 0;
            if (!Object.keys(byMatch).length) throw new Error(`No shape item takes all of: ${Object.keys(spec).join(', ')}`);
            if (!opCount && a.name === undefined && a.enabled === undefined) throw new Error('Nothing to change: give options, properties, name or enabled');
            return run('Set shape content', script(`${SHAPE_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${groupPath(a.group)}, names = ${itemList(a.items)}, byMatch = ${json(byMatch)}, t = ${a.time !== undefined ? num(a.time, { name: 'time' }) : 'null'}, out = [];
${a.name !== undefined ? 'if (names.length > 1) throw new Error("name renames one item; name one");' : ''}
for (var i = 0; i < ls.length; i++) {
  var its = __items(__contents(ls[i], path), names, ls[i]), done = [];
  for (var j = 0; j < its.length; j++) {
    var ops = byMatch[its[j].matchName];
    if (!ops) throw new Error(its[j].name + " (" + its[j].matchName + ") does not take these options");
    __apply(its[j], ops, t, c.time);
    ${a.enabled !== undefined ? `its[j].enabled = ${a.enabled ? 'true' : 'false'};` : ''}
    ${a.name !== undefined ? `its[j].name = ${str(a.name)};` : ''}
    done.push({ name: its[j].name, index: its[j].propertyIndex, matchName: its[j].matchName });
  }
  out.push({ layer: ls[i].index, items: done });
}
__result__ = { layers: out };`, { undo: 'Set shape content' }));
        },
    },
    {
        name: 'arrange_shape_content',
        description: 'Rearrange shape items in a group: delete, duplicate, move to a position, Group Shapes (wrap the items in a new group), Ungroup Shapes (dissolve groups) or Convert To Bezier Path (turn a rectangle, ellipse or polystar into a free path). Grouping, ungrouping and converting open the composition and run the Layer > Mask and Shape Path command on the items',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYER_TARGET, group: GROUP_SCHEMA,
                items: { type: 'array', items: { type: ['string', 'integer'] }, minItems: 1, description: 'Items in the group, by name or 1-based index' },
                action: { type: 'string', enum: ['delete', 'duplicate', 'move', 'group', 'ungroup', 'convert_to_bezier'], description: 'What to do with the items' },
                toIndex: { type: 'integer', minimum: 1, description: 'move: the new 1-based position in the group' },
            },
            required: ['layers', 'items', 'action'],
        },
        hints: { destructive: true },
        auditArgs: { group: undefined, items: ['Rectangle 1', 'Fill 1'], action: 'group', toIndex: undefined },
        features: ['aftereffects.masks_shapes.group_shapes', 'aftereffects.masks_shapes.ungroup_shapes', 'aftereffects.masks_shapes.convert_to_bezier_path'],
        handler: (a) => {
            const action = enumOf(a.action, ['delete', 'duplicate', 'move', 'group', 'ungroup', 'convert_to_bezier'], { name: 'action' });
            const names = itemList(a.items);
            if (action === 'move' && (a.toIndex === undefined || a.items.length !== 1)) throw new Error("move takes one item and 'toIndex'");
            const select = `
c.openInViewer();
var sp = c.selectedProperties;
for (var s = sp.length - 1; s >= 0; s--) { try { sp[s].selected = false; } catch (e) {} }
for (s = c.selectedLayers.length - 1; s >= 0; s--) c.selectedLayers[s].selected = false;`;
            const each = {
                delete: `
  var order = [];
  for (j = 0; j < its.length; j++) order.push(its[j].propertyIndex);
  order.sort(function (x, y) { return y - x; });
  for (j = 0; j < order.length; j++) { done.push(g.property(order[j]).name); g.property(order[j]).remove(); }`,
                duplicate: `
  for (j = 0; j < its.length; j++) { done.push(its[j].name); its[j].duplicate(); }`,
                move: `
  if (${num(a.toIndex ?? 1, { min: 1, max: 10000, name: 'toIndex' })} > g.numProperties) throw new Error("toIndex is past the last item (" + g.numProperties + ")");
  done.push(its[0].name); its[0].moveTo(${num(a.toIndex ?? 1, { min: 1, max: 10000, name: 'toIndex' })});`,
                group: `${select}
  for (j = 0; j < its.length; j++) { its[j].selected = true; done.push(its[j].name); }
  app.executeCommand(3741);`,
                ungroup: `
  for (j = its.length - 1; j >= 0; j--) {
    var gi = __contents(ls[i], path).property(names[j]);
    if (!gi || gi.matchName !== "ADBE Vector Group") throw new Error(names[j] + " is not a group");
    ${select.trim().split('\n').join('\n    ')}
    done.push(gi.name); gi.selected = true;
    app.executeCommand(3742);
  }`,
                convert_to_bezier: `
  for (j = its.length - 1; j >= 0; j--) {
    var pi = __contents(ls[i], path).property(names[j]);
    if (!pi || !(pi.matchName === "ADBE Vector Shape - Rect" || pi.matchName === "ADBE Vector Shape - Ellipse" || pi.matchName === "ADBE Vector Shape - Star")) throw new Error(names[j] + " is not a rectangle, ellipse or polystar path");
    ${select.trim().split('\n').join('\n    ')}
    done.push(pi.name); pi.selected = true;
    app.executeCommand(4162);
  }`,
            }[action];
            return run('Arrange shape content', script(`${SHAPE_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${groupPath(a.group)}, names = ${names}, out = [];
for (var i = 0; i < ls.length; i++) {
  var g = __contents(ls[i], path), its = __items(g, names, ls[i]), done = [], j, after = [];
  ${each.trim()}
  g = __contents(ls[i], path);
  for (j = 1; j <= g.numProperties; j++) after.push(g.property(j).name);
  out.push({ layer: ls[i].index, items: done, contents: after });
}
__result__ = { action: ${str(action)}, layers: out };`, { undo: 'Arrange shape content' }));
        },
    },
    {
        name: 'create_shapes_from_vector_layer',
        description: 'Convert Illustrator, PDF or SVG footage layers to shape layers (Layer > Create > Create Shapes from Vector Layer). Each new shape layer is placed above its source, which is turned off',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: { ...LAYERS_SCHEMA, description: 'Vector footage layers: indexes (1-based), names, or selected: true' } }, required: ['layers'] },
        features: ['aftereffects.masks_shapes.create_shapes_from_vector_layer'],
        handler: (a) => run('Create shapes from vector layer', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
c.openInViewer();
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  if (!(l instanceof AVLayer) || !(l.source instanceof FootageItem)) throw new Error(l.name + " is not a footage layer");
  for (var s = c.selectedLayers.length - 1; s >= 0; s--) c.selectedLayers[s].selected = false;
  l.selected = true;
  var before = c.numLayers;
  app.executeCommand(3973);
  if (c.numLayers === before) throw new Error("No shape layer was made from " + l.name + ": it must be Illustrator, PDF or SVG footage");
  out.push({ source: l.index, shapeLayer: __layerInfo(c.layer(l.index - 1)) });
}
__result__ = { converted: out };`, { undo: 'Create shapes from vector layer' })),
    },
];
