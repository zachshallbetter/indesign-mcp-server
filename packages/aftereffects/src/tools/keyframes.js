/**
 * Keyframe editing: interpolation, easing, roving, labels and values of existing
 * keyframes, keyframe selection and navigation, copying keyframes, expressions
 * and property links between properties, Separate Dimensions, Sequence Layers,
 * the Puppet tools, and the Animation menu commands that act on the selection.
 */
import { num, index, bool, enumOf, json, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, PROPERTY_SCHEMA, compSpec, layerSpec, propertyPath, propertyValue } from '../args.js';

const TARGET = { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, property: PROPERTY_SCHEMA };

const INTERP = { linear: 'LINEAR', bezier: 'BEZIER', hold: 'HOLD' };

export const KEYS_SCHEMA = {
    type: 'object',
    description: 'Which keyframes of the property: those matching any of indexes, the from/to time range, times or selected. Omit for all of them',
    properties: {
        indexes: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Keyframe indexes, 1 = first (from get_property)' },
        from: { type: 'number', description: 'Keyframes at or after this time (seconds)' },
        to: { type: 'number', description: 'Keyframes at or before this time (seconds)' },
        times: { type: 'array', items: { type: 'number' }, maxItems: 500, description: 'Keyframes at these times (seconds)' },
        selected: { type: 'boolean', description: 'The keyframes selected in the Timeline panel' },
    },
};

/** A keyframe selector as a JSX literal for __pickKeys(). */
export function keysSpec(keys, name = 'keys') {
    const k = keys ?? {};
    if (typeof k !== 'object' || Array.isArray(k)) throw new Error(`'${name}' must be an object`);
    const list = (v, field, check) => {
        if (v === undefined) return null;
        if (!Array.isArray(v) || !v.length || v.length > 500) throw new Error(`'${name}.${field}' must list 1 to 500 values`);
        return v.map((x) => Number(check(x)));
    };
    return json({
        idx: list(k.indexes, 'indexes', (x) => index(x, { name: `${name}.indexes`, max: 100000 })),
        from: k.from === undefined ? null : Number(num(k.from, { name: `${name}.from` })),
        to: k.to === undefined ? null : Number(num(k.to, { name: `${name}.to` })),
        times: list(k.times, 'times', (x) => num(x, { name: `${name}.times` })),
        sel: Boolean(k.selected),
    });
}

/**
 * ES3 helpers shared by the keyframe tools.
 * __keyRec(p, k): everything about keyframe k, to write it elsewhere.
 * __putKey(p, t, r, rev): write a record at time t; rev swaps incoming and
 *   outgoing (for time-reversed keyframes).
 * __keyList(p): keyframes as reported to the caller.
 * __pathOf(p): the property's path from its layer, usable as `property`.
 */
export const KEY_HELPERS = `
var __keyRec = function (p, k) {
  var r = { t: p.keyTime(k), v: p.keyValue(k), inT: p.keyInInterpolationType(k), outT: p.keyOutInterpolationType(k),
    inE: null, outE: null, tc: false, tab: false, inS: null, outS: null, sc: false, sab: false, rov: false, lab: 0 };
  try { r.inE = p.keyInTemporalEase(k); r.outE = p.keyOutTemporalEase(k); r.tc = p.keyTemporalContinuous(k); r.tab = p.keyTemporalAutoBezier(k); } catch (e) {}
  if (p.isSpatial) {
    try { r.inS = p.keyInSpatialTangent(k); r.outS = p.keyOutSpatialTangent(k); r.sc = p.keySpatialContinuous(k); r.sab = p.keySpatialAutoBezier(k); r.rov = p.keyRoving(k); } catch (e) {}
  }
  try { r.lab = p.keyLabel(k); } catch (e) {}
  return r;
};
var __putKey = function (p, t, r, rev) {
  p.setValueAtTime(t, r.v);
  var k = p.nearestKeyIndex(t);
  p.setInterpolationTypeAtKey(k, rev ? r.outT : r.inT, rev ? r.inT : r.outT);
  if (r.inE) { try { p.setTemporalEaseAtKey(k, rev ? r.outE : r.inE, rev ? r.inE : r.outE); p.setTemporalContinuousAtKey(k, r.tc); p.setTemporalAutoBezierAtKey(k, r.tab); } catch (e) {} }
  if (p.isSpatial && r.inS) {
    p.setSpatialTangentsAtKey(k, rev ? r.outS : r.inS, rev ? r.inS : r.outS);
    p.setSpatialContinuousAtKey(k, r.sc); p.setSpatialAutoBezierAtKey(k, r.sab);
    try { p.setRovingAtKey(k, r.rov); } catch (e) {}
  }
  try { p.setLabelAtKey(k, r.lab); } catch (e) {}
  return k;
};
var __keyList = function (p) {
  var keys = [];
  for (var k = 1; k <= p.numKeys && k <= 500; k++) {
    var kv = p.keyValue(k), info = { index: k, time: p.keyTime(k), value: (kv instanceof TextDocument) ? kv.text : kv,
      in: __enumName(p.keyInInterpolationType(k)), out: __enumName(p.keyOutInterpolationType(k)), selected: p.keySelected(k) };
    try { info.label = p.keyLabel(k); } catch (e) {}
    if (p.isSpatial) { try { info.roving = p.keyRoving(k); } catch (e) {} }
    keys.push(info);
  }
  return keys;
};
var __pathOf = function (p) {
  var path = [];
  for (var q = p; q && q.propertyDepth > 0; q = q.parentProperty) {
    var parent = q.parentProperty;
    path.unshift(parent && parent.propertyType === PropertyType.INDEXED_GROUP ? q.name : q.matchName);
  }
  return path;
};`;

/**
 * ES3 __pickKeys(p, ks, create): indexes of the keyframes ks (a keysSpec()
 * literal) selects, ascending; with create, a time in ks.times that has no
 * keyframe gets one holding the value there.
 */
export const PICK_KEYS = `
var __pickKeys = function (p, ks, create) {
  var times = [], out = [], k, j, t, want;
  var all = !ks.idx && !ks.times && ks.from === null && ks.to === null && !ks.sel;
  if (ks.idx) for (j = 0; j < ks.idx.length; j++) if (ks.idx[j] < 1 || ks.idx[j] > p.numKeys) throw new Error("Keyframe " + ks.idx[j] + " does not exist; " + p.name + " has " + p.numKeys);
  for (k = 1; k <= p.numKeys; k++) {
    t = p.keyTime(k);
    want = all;
    if (ks.idx) for (j = 0; j < ks.idx.length; j++) if (ks.idx[j] === k) want = true;
    if ((ks.from !== null || ks.to !== null) && (ks.from === null || t >= ks.from - 0.0005) && (ks.to === null || t <= ks.to + 0.0005)) want = true;
    if (ks.sel && p.keySelected(k)) want = true;
    if (want) times.push(t);
  }
  if (ks.times) for (j = 0; j < ks.times.length; j++) {
    var hit = p.numKeys ? p.nearestKeyIndex(ks.times[j]) : 0;
    if (!hit || Math.abs(p.keyTime(hit) - ks.times[j]) > 0.0005) {
      if (!create) throw new Error("No keyframe at " + ks.times[j] + "s on " + p.name);
      if (!p.canVaryOverTime) throw new Error(p.name + " cannot be animated");
      p.addKey(ks.times[j]);
    }
    times.push(ks.times[j]);
  }
  for (j = 0; j < times.length; j++) {
    k = p.nearestKeyIndex(times[j]);
    var dup = false;
    for (var m = 0; m < out.length; m++) if (out[m] === k) dup = true;
    if (!dup) out.push(k);
  }
  out.sort(function (a, b) { return a - b; });
  if (!out.length) throw new Error(p.numKeys ? "No keyframes of " + p.name + " match" : p.name + " has no keyframes");
  return out;
};`;

/** Default ease influence of Easy Ease, Easy Ease In and Easy Ease Out. */
const EASY = 33.33;

const PRESETS = ['linear', 'bezier', 'auto_bezier', 'continuous_bezier', 'hold', 'toggle_hold', 'easy_ease', 'easy_ease_in', 'easy_ease_out'];

const EASE_SCHEMA = {
    type: 'object',
    description: 'Temporal ease for every dimension: speed (units per second) and influence (percent)',
    properties: {
        speed: { type: 'number', description: 'Speed in the property\'s units per second. Default 0' },
        influence: { type: 'number', minimum: 0.1, maximum: 100, description: 'Influence percent, 0.1 to 100' },
    },
    required: ['influence'],
};

/** A KeyframeEase literal for one side, checked. */
function easeArgs(e, name) {
    if (!e || typeof e !== 'object') throw new Error(`'${name}' must be { speed, influence }`);
    return [num(e.speed ?? 0, { name: `${name}.speed` }), num(e.influence, { min: 0.1, max: 100, name: `${name}.influence` })];
}

/** A [x, y] or [x, y, z] tangent, checked. */
function tangent(v, name) {
    if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new Error(`'${name}' must be [x, y] or [x, y, z]`);
    return json(v.map((x) => Number(num(x, { name }))));
}

/** One layer, by index or name, as a layer spec. */
function oneLayer(layer, name) {
    if (typeof layer === 'number') return layerSpec({ indexes: [layer] });
    if (typeof layer === 'string' && layer) return layerSpec({ names: [layer] });
    throw new Error(`'${name}' must be a layer index (1 = top) or name`);
}

const COMMANDS = {
    toggle_auto_keyframe: { id: 4015, since: 13.5 },
    select_equal_keyframes: { id: 2934, since: 13.5 },
    select_previous_keyframes: { id: 3072, since: 13.5 },
    select_following_keyframes: { id: 3073, since: 13.5 },
    select_label_group: { id: 4220, since: 23 },
    label_group_on_selected_layers: { id: 4221, since: 23 },
    label_group_on_all_layers: { id: 4222, since: 23 },
    label_group_visible_on_selected_layers: { id: 4223, since: 25 },
    label_group_visible_on_all_layers: { id: 4224, since: 25 },
    exponential_scale: { name: 'Exponential Scale' },
    rpf_camera_import: { name: 'RPF Camera Import' },
    create_keyframes_from_data: { id: 4036, since: 15 },
    reveal_in_timeline: { id: 2536, since: 13.5 },
    reveal_animating_properties: { id: 4011, since: 13.5 },
    reveal_modified_properties: { id: 2771, since: 13.5 },
    reveal_expression_errors: { id: 2731, since: 15 },
};

const PIN_TOOLS = { position: 'Tool_Pin', starch: 'Tool_PinStarch', overlap: 'Tool_PinDepth', advanced: 'Tool_PinAdvanced', bend: 'Tool_PinBend' };

export const tools = [
    {
        name: 'edit_keyframes',
        description: 'Change existing keyframes of a property (Animation > Keyframe Interpolation, Keyframe Velocity, Keyframe Assistant, the Graph Editor buttons and the keyframe context menu): interpolation presets such as Easy Ease, Easy Ease In/Out, Auto Bezier, Continuous Bezier, Linear and Toggle Hold Keyframe; incoming and outgoing interpolation and ease (speed and influence of the Bezier handles); Rove Across Time; motion path tangents; keyframe colour label; the value of every chosen keyframe (Edit Value); and Time-Reverse Keyframes. keys.times adds a keyframe where none exists, holding the value there, as the keyframe navigator or the Pen tool on a motion path does',
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                keys: KEYS_SCHEMA,
                timeReverse: { type: 'boolean', description: 'Time-Reverse Keyframes: mirror the chosen keyframes in time within their span (done before the other changes)' },
                preset: { type: 'string', enum: PRESETS, description: 'linear, bezier, auto_bezier, continuous_bezier, hold (both sides), toggle_hold (outgoing Hold, or back to Auto Bezier), easy_ease, easy_ease_in, easy_ease_out' },
                inInterpolation: { type: 'string', enum: Object.keys(INTERP), description: 'Incoming interpolation' },
                outInterpolation: { type: 'string', enum: Object.keys(INTERP), description: 'Outgoing interpolation' },
                easeIn: { ...EASE_SCHEMA, description: 'Incoming temporal ease (Keyframe Velocity dialog, Graph Editor handle): speed and influence for every dimension' },
                easeOut: { ...EASE_SCHEMA, description: 'Outgoing temporal ease: speed and influence for every dimension' },
                temporalContinuous: { type: 'boolean', description: 'Continuous Bezier in time' },
                temporalAutoBezier: { type: 'boolean', description: 'Auto Bezier in time' },
                spatialContinuous: { type: 'boolean', description: 'Continuous Bezier on the motion path (spatial properties only)' },
                spatialAutoBezier: { type: 'boolean', description: 'Auto Bezier on the motion path (spatial properties only)' },
                spatialTangents: {
                    type: 'object',
                    description: 'Motion path direction handles, relative to the keyframe, in pixels (spatial properties only)',
                    properties: {
                        in: { type: 'array', items: { type: 'number' }, description: 'Incoming tangent [x, y] or [x, y, z]' },
                        out: { type: 'array', items: { type: 'number' }, description: 'Outgoing tangent [x, y] or [x, y, z]' },
                    },
                    required: ['in', 'out'],
                },
                roving: { type: 'boolean', description: 'Rove Across Time (spatial properties; the first and last keyframes never rove)' },
                label: { type: 'integer', minimum: 0, maximum: 16, description: 'Keyframe colour label, 0 (none) to 16' },
                value: { description: 'New value for every chosen keyframe: a number, an array of numbers, text or true/false' },
            },
            required: ['layers', 'property'],
        },
        auditArgs: {
            property: 'position', keys: { indexes: [1], times: [0.5] }, timeReverse: true, preset: 'easy_ease', outInterpolation: 'bezier',
            easeIn: { speed: 0, influence: 50 }, temporalContinuous: true, spatialTangents: { in: [-20, 0], out: [20, 0] }, roving: false, label: 3, value: [100, 200],
        },
        features: [
            'aftereffects.animation.keyframe_ease_object',
            'aftereffects.animation.keyframe_interpolation_type_enum',
            'aftereffects.animation.graph_interpolation_buttons',
            'aftereffects.animation.bezier_direction_handles',
            'aftereffects.animation.interpolation_continuous_bezier',
            'aftereffects.animation.interpolation_auto_bezier',
            'aftereffects.animation.toggle_hold_keyframe',
            'aftereffects.animation.roving_keyframes',
            'aftereffects.animation.easy_ease_in',
            'aftereffects.animation.easy_ease_out',
            'aftereffects.animation.keyframe_color_labels',
            'aftereffects.animation.edit_keyframe_value',
            'aftereffects.animation.change_multiple_keyframe_values',
            'aftereffects.animation.motion_paths',
            'aftereffects.animation.add_keyframe_with_pen_on_motion_path',
            'aftereffects.animation.time_reverse_keyframes',
        ],
        handler: (a) => {
            const preset = a.preset === undefined ? null : enumOf(a.preset, PRESETS, { name: 'preset' });
            const inI = a.inInterpolation === undefined ? null : INTERP[enumOf(a.inInterpolation, Object.keys(INTERP), { name: 'inInterpolation' })];
            const outI = a.outInterpolation === undefined ? null : INTERP[enumOf(a.outInterpolation, Object.keys(INTERP), { name: 'outInterpolation' })];
            const easeIn = a.easeIn === undefined ? null : easeArgs(a.easeIn, 'easeIn');
            const easeOut = a.easeOut === undefined ? null : easeArgs(a.easeOut, 'easeOut');
            const tans = a.spatialTangents === undefined ? null : [tangent(a.spatialTangents?.in, 'spatialTangents.in'), tangent(a.spatialTangents?.out, 'spatialTangents.out')];
            const value = a.value === undefined ? null : propertyValue(a.value);
            const label = a.label === undefined ? null : index(a.label, { name: 'label', max: 16 });
            const flags = ['temporalContinuous', 'temporalAutoBezier', 'spatialContinuous', 'spatialAutoBezier', 'roving'].filter((f) => a[f] !== undefined);
            const spatial = tans || a.spatialContinuous !== undefined || a.spatialAutoBezier !== undefined || a.roving !== undefined;
            const hasTimes = Array.isArray(a.keys?.times) && a.keys.times.length;
            if (!a.timeReverse && !preset && !inI && !outI && !easeIn && !easeOut && !tans && value === null && label === null && !flags.length && !hasTimes) {
                throw new Error('Nothing to change: give preset, inInterpolation, outInterpolation, easeIn, easeOut, a continuity or auto-bezier flag, spatialTangents, roving, label, value, timeReverse or keys.times');
            }
            const ease = (inArgs, outArgs) => `
    var ei = p.keyInTemporalEase(k), eo = p.keyOutTemporalEase(k), d;
    ${inArgs ? `ei = []; for (d = 0; d < p.keyInTemporalEase(k).length; d++) ei.push(new KeyframeEase(${inArgs[0]}, ${inArgs[1]}));` : ''}
    ${outArgs ? `eo = []; for (d = 0; d < p.keyOutTemporalEase(k).length; d++) eo.push(new KeyframeEase(${outArgs[0]}, ${outArgs[1]}));` : ''}
    p.setTemporalEaseAtKey(k, ei, eo);`;
            const B = 'KeyframeInterpolationType.BEZIER', H = 'KeyframeInterpolationType.HOLD', L = 'KeyframeInterpolationType.LINEAR';
            const presetCode = {
                linear: `p.setInterpolationTypeAtKey(k, ${L}, ${L});`,
                bezier: `p.setInterpolationTypeAtKey(k, ${B}, ${B}); p.setTemporalAutoBezierAtKey(k, false); p.setTemporalContinuousAtKey(k, false);`,
                auto_bezier: `p.setInterpolationTypeAtKey(k, ${B}, ${B}); p.setTemporalAutoBezierAtKey(k, true); if (p.isSpatial) p.setSpatialAutoBezierAtKey(k, true);`,
                continuous_bezier: `p.setInterpolationTypeAtKey(k, ${B}, ${B}); p.setTemporalAutoBezierAtKey(k, false); p.setTemporalContinuousAtKey(k, true); if (p.isSpatial) p.setSpatialContinuousAtKey(k, true);`,
                hold: `p.setInterpolationTypeAtKey(k, ${H}, ${H});`,
                toggle_hold: `if (p.keyOutInterpolationType(k) === ${H}) { if (p.isInterpolationTypeValid(${B})) { p.setInterpolationTypeAtKey(k, ${B}, ${B}); p.setTemporalAutoBezierAtKey(k, true); } } else p.setInterpolationTypeAtKey(k, p.keyInInterpolationType(k), ${H});`,
                easy_ease: `p.setInterpolationTypeAtKey(k, ${B}, ${B}); p.setTemporalAutoBezierAtKey(k, false);${ease(['0', String(EASY)], ['0', String(EASY)])}`,
                easy_ease_in: `p.setInterpolationTypeAtKey(k, ${B}, p.keyOutInterpolationType(k)); p.setTemporalAutoBezierAtKey(k, false);${ease(['0', String(EASY)], null)}`,
                easy_ease_out: `p.setInterpolationTypeAtKey(k, p.keyInInterpolationType(k), ${B}); p.setTemporalAutoBezierAtKey(k, false);${ease(null, ['0', String(EASY)])}`,
            };
            const per = [];
            if (value !== null) per.push(`var v = ${value}; if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) { var td = p.keyValue(k); td.text = String(v); v = td; } p.setValueAtKey(k, v);`);
            if (preset) per.push(presetCode[preset]);
            if (inI || outI) per.push(`p.setInterpolationTypeAtKey(k, ${inI ? `KeyframeInterpolationType.${inI}` : 'p.keyInInterpolationType(k)'}, ${outI ? `KeyframeInterpolationType.${outI}` : 'p.keyOutInterpolationType(k)'});`);
            if (easeIn || easeOut) per.push(ease(easeIn, easeOut));
            if (a.temporalContinuous !== undefined) per.push(`p.setTemporalContinuousAtKey(k, ${bool(a.temporalContinuous)});`);
            if (a.temporalAutoBezier !== undefined) per.push(`p.setTemporalAutoBezierAtKey(k, ${bool(a.temporalAutoBezier)});`);
            if (tans) per.push(`p.setSpatialTangentsAtKey(k, ${tans[0]}, ${tans[1]});`);
            if (a.spatialContinuous !== undefined) per.push(`p.setSpatialContinuousAtKey(k, ${bool(a.spatialContinuous)});`);
            if (a.spatialAutoBezier !== undefined) per.push(`p.setSpatialAutoBezierAtKey(k, ${bool(a.spatialAutoBezier)});`);
            if (a.roving !== undefined) per.push(`if (k > 1 && k < p.numKeys) p.setRovingAtKey(k, ${bool(a.roving)});`);
            if (label !== null) per.push(`p.setLabelAtKey(k, ${label});`);
            return run('Edit keyframes', script(`${KEY_HELPERS}
${PICK_KEYS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, ks = ${keysSpec(a.keys)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (p.propertyType !== PropertyType.PROPERTY) throw new Error(p.name + " is a group, not a property");
  ${spatial ? 'if (!p.isSpatial) throw new Error(p.name + " is not a spatial property: motion path tangents, spatial interpolation and roving apply to Position-like properties");' : ''}
  var picked = __pickKeys(p, ks, true), j;
  ${a.timeReverse ? `var recs = [], t0 = p.keyTime(picked[0]), t1 = p.keyTime(picked[picked.length - 1]), times = [];
  for (j = 0; j < picked.length; j++) recs.push(__keyRec(p, picked[j]));
  for (j = picked.length - 1; j >= 0; j--) p.removeKey(picked[j]);
  for (j = 0; j < recs.length; j++) { __putKey(p, t0 + t1 - recs[j].t, recs[j], true); times.push(t0 + t1 - recs[j].t); }
  picked = [];
  for (j = 0; j < times.length; j++) picked.push(p.nearestKeyIndex(times[j]));` : ''}
  for (j = 0; j < picked.length; j++) {
    var k = picked[j];
    ${per.join('\n    ')}
  }
  out.push({ layer: ls[i].index, property: p.name, changed: picked.length, keys: __keyList(p) });
}
__result__ = { properties: out };`, { undo: 'Edit keyframes' }));
        },
    },
    {
        name: 'select_keyframes',
        description: 'Select or deselect keyframes of a property in the Timeline panel, or deselect every keyframe, property and property group (Edit > Deselect All in the Timeline). Selected keyframes are what run_animation_command\'s keyframe commands act on',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `${LAYERS_SCHEMA.description}. With deselectAll and no layers, every layer` },
                property: { ...PROPERTY_SCHEMA, description: `${PROPERTY_SCHEMA.description}. Omit to only deselect` },
                keys: KEYS_SCHEMA,
                mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'replace (default): only these keyframes of the property are selected; add; remove', default: 'replace' },
                deselectAll: { type: 'boolean', description: 'First deselect every keyframe, property and property group on the layers' },
            },
        },
        auditArgs: { property: 'opacity', keys: { from: 0, to: 2 }, mode: 'add', deselectAll: true },
        hints: { idempotent: true },
        features: ['aftereffects.animation.select_keyframes', 'aftereffects.animation.deselect_all_keyframes'],
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'replace', ['replace', 'add', 'remove'], { name: 'mode' });
            if (a.property === undefined && !a.deselectAll) throw new Error("Give property (with keys) to select keyframes, or deselectAll: true");
            if (a.property !== undefined && a.layers === undefined) throw new Error("Choose the layers whose property's keyframes to select");
            const layers = a.layers === undefined ? 'null' : layerSpec(a.layers);
            return run('Select keyframes', script(`${a.property !== undefined ? PICK_KEYS : ''}
var c = __comp(${compSpec(a.comp)}), spec = ${layers}, ls = [], out = [], i, j;
if (spec) ls = __layers(c, spec); else for (i = 1; i <= c.numLayers; i++) ls.push(c.layer(i));
${a.deselectAll ? `var __clear = function (g) {
  for (var n = 1; n <= g.numProperties; n++) {
    var q = g.property(n);
    if (q.propertyType === PropertyType.PROPERTY) { var sk = q.selectedKeys; for (var m = 0; m < sk.length; m++) q.setSelectedAtKey(sk[m], false); }
    else __clear(q);
  }
};
for (i = 0; i < ls.length; i++) {
  __clear(ls[i]);
  var sp = ls[i].selectedProperties;
  for (j = sp.length - 1; j >= 0; j--) sp[j].selected = false;
}` : ''}
${a.property !== undefined ? `var path = ${propertyPath(a.property)}, ks = ${keysSpec(a.keys)};
for (i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (p.propertyType !== PropertyType.PROPERTY) throw new Error(p.name + " is a group, not a property");
  var picked = __pickKeys(p, ks, false);
  ${mode === 'replace' ? 'for (j = 1; j <= p.numKeys; j++) p.setSelectedAtKey(j, false);' : ''}
  for (j = 0; j < picked.length; j++) p.setSelectedAtKey(picked[j], ${mode === 'remove' ? 'false' : 'true'});
  out.push({ layer: ls[i].index, property: p.name, selectedKeys: p.selectedKeys });
}` : ''}
__result__ = { properties: out, deselectedAll: ${bool(a.deselectAll)} };`, { undo: 'Select keyframes' }));
        },
    },
    {
        name: 'go_to_keyframe',
        description: 'Move the current time to the previous, next, first or last keyframe (the keyframe navigator arrows, J and K): of one property, or of every animated property of the layers (the selected layers by default)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `${LAYERS_SCHEMA.description}. Default the selected layers` },
                property: { ...PROPERTY_SCHEMA, description: `${PROPERTY_SCHEMA.description}. Omit for every animated property` },
                direction: { type: 'string', enum: ['previous', 'next', 'first', 'last'], description: 'Where to go' },
            },
            required: ['direction'],
        },
        auditArgs: { property: 'position', direction: 'next' },
        features: ['aftereffects.animation.keyframe_navigator', 'aftereffects.animation.jump_to_keyframes_selected_layers'],
        handler: (a) => {
            const dir = enumOf(a.direction, ['previous', 'next', 'first', 'last'], { name: 'direction' });
            return run('Go to keyframe', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers ?? { selected: true })}), times = [], i, k;
var __collect = function (g) {
  for (var n = 1; n <= g.numProperties; n++) {
    var q = g.property(n);
    if (q.propertyType === PropertyType.PROPERTY) { for (var m = 1; m <= q.numKeys; m++) times.push(q.keyTime(m)); }
    else __collect(q);
  }
};
for (i = 0; i < ls.length; i++) {
  ${a.property !== undefined ? `var p = __prop(ls[i], ${propertyPath(a.property)}); for (k = 1; k <= p.numKeys; k++) times.push(p.keyTime(k));` : '__collect(ls[i]);'}
}
var now = c.time, best = null, eps = c.frameDuration / 2;
for (i = 0; i < times.length; i++) {
  var t = times[i];
  ${{
        next: 'if (t > now + eps && (best === null || t < best)) best = t;',
        previous: 'if (t < now - eps && (best === null || t > best)) best = t;',
        first: 'if (best === null || t < best) best = t;',
        last: 'if (best === null || t > best) best = t;',
    }[dir]}
}
if (best !== null) c.time = best;
__result__ = { time: c.time, moved: best !== null, keyframes: times.length };`));
        },
    },
    {
        name: 'copy_animation',
        description: 'Copy from one layer\'s property to properties on other layers: its keyframes (Edit > Copy and Paste, or Paste Reverse Keyframes with reverse), its expression only (Edit > Copy Expression Only), or a link: an expression on each target that follows the source, as Edit > Copy With Property Links then Paste, or dragging the expression pick whip, would write',
        inputSchema: {
            type: 'object',
            properties: {
                from: {
                    type: 'object',
                    description: 'The source',
                    properties: {
                        comp: COMP_SCHEMA,
                        layer: { type: ['integer', 'string'], description: 'Layer index (1 = top) or name' },
                        property: PROPERTY_SCHEMA,
                    },
                    required: ['layer', 'property'],
                },
                to: {
                    type: 'object',
                    description: 'The targets',
                    properties: {
                        comp: COMP_SCHEMA,
                        layers: LAYERS_SCHEMA,
                        property: { ...PROPERTY_SCHEMA, description: `${PROPERTY_SCHEMA.description}. Default the source's path` },
                    },
                    required: ['layers'],
                },
                what: { type: 'string', enum: ['keyframes', 'expression', 'link'], description: 'keyframes, expression (the expression only), or link (a property link expression)' },
                keys: { ...KEYS_SCHEMA, description: `With what: keyframes, which source keyframes. ${KEYS_SCHEMA.description}` },
                time: { type: 'number', description: 'With what: keyframes, where the first pasted keyframe lands (seconds). Default the source times' },
                reverse: { type: 'boolean', description: 'With what: keyframes, paste them in reverse time order (Paste Reverse Keyframes)' },
            },
            required: ['from', 'to', 'what'],
        },
        auditArgs: { from: { layer: 1, property: 'position' }, to: { layers: { indexes: [2] } }, what: 'keyframes', keys: { from: 0, to: 2 }, time: 1, reverse: true },
        features: [
            'aftereffects.animation.reverse_paste_keyframes',
            'aftereffects.expressions.copy_expression_only',
            'aftereffects.expressions.copy_with_property_links',
            'aftereffects.expressions.expression_pick_whip',
        ],
        handler: (a) => {
            const what = enumOf(a.what, ['keyframes', 'expression', 'link'], { name: 'what' });
            if (!a.from || typeof a.from !== 'object') throw new Error("'from' must be { layer, property }");
            if (!a.to || typeof a.to !== 'object') throw new Error("'to' must be { layers }");
            const srcPath = propertyPath(a.from.property, 'from.property');
            const dstPath = a.to.property === undefined ? srcPath : propertyPath(a.to.property, 'to.property');
            const body = {
                keyframes: `if (!d.canVaryOverTime) throw new Error(d.name + " cannot be animated");
  for (k = 0; k < recs.length; k++) __putKey(d, at + (${bool(a.reverse)} ? (t1 - recs[k].t) : (recs[k].t - t0)), recs[k], ${bool(a.reverse)});
  out.push({ layer: dl[i].index, property: d.name, pasted: recs.length });`,
                expression: `if (!d.canSetExpression) throw new Error(d.name + " cannot take an expression");
  d.expression = s.expression; d.expressionEnabled = s.expression !== "" && s.expressionEnabled;
  out.push({ layer: dl[i].index, property: d.name, expression: d.expression, error: d.expressionError || null });`,
                link: `if (!d.canSetExpression) throw new Error(d.name + " cannot take an expression");
  d.expression = link; d.expressionEnabled = true;
  out.push({ layer: dl[i].index, property: d.name, expression: d.expression, error: d.expressionError || null });`,
            }[what];
            return run('Copy animation', script(`${KEY_HELPERS}
${what === 'keyframes' ? PICK_KEYS : ''}
var sc = __comp(${compSpec(a.from.comp)}), sl = __layers(sc, ${oneLayer(a.from.layer, 'from.layer')})[0], s = __prop(sl, ${srcPath});
if (s.propertyType !== PropertyType.PROPERTY) throw new Error(s.name + " is a group, not a property");
var dc = __comp(${compSpec(a.to.comp)}), dl = __layers(dc, ${layerSpec(a.to.layers)}), dpath = ${dstPath}, out = [], i, k;
${what === 'keyframes' ? `var picked = __pickKeys(s, ${keysSpec(a.keys)}, false), recs = [];
for (k = 0; k < picked.length; k++) recs.push(__keyRec(s, picked[k]));
var t0 = recs[0].t, t1 = recs[recs.length - 1].t, at = ${a.time === undefined ? 't0' : num(a.time, { name: 'time' })};` : ''}
${what === 'expression' ? 'if (!s.canSetExpression || s.expression === "") throw new Error(s.name + " has no expression");' : ''}
${what === 'link' ? `var q = function (x) { return "\\"" + String(x).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"") + "\\""; };
var sp = __pathOf(s), link = "comp(" + q(sc.name) + ").layer(" + q(sl.name) + ")";
for (k = 0; k < sp.length; k++) link += "(" + q(sp[k]) + ")";` : ''}
for (i = 0; i < dl.length; i++) {
  var d = __prop(dl[i], dpath);
  if (d === s) throw new Error("The source and the target are the same property");
  ${body}
}
__result__ = { source: { layer: sl.index, property: s.name }, targets: out };`, { undo: 'Copy animation' }));
        },
    },
    {
        name: 'separate_dimensions',
        description: 'Separate a Position property into X, Y (and Z) Position so each can be keyframed alone, or join them again (Animation > Separate Dimensions)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                property: { ...PROPERTY_SCHEMA, description: `${PROPERTY_SCHEMA.description}. Default position` },
                separate: { type: 'boolean', description: 'true separates, false joins. Default true', default: true },
            },
            required: ['layers'],
        },
        auditArgs: { property: 'position' },
        hints: { idempotent: true },
        features: ['aftereffects.animation.separate_dimensions'],
        handler: (a) => run('Separate dimensions', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property ?? 'position')}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (!p.isSeparationLeader) throw new Error(p.name + " cannot be separated into dimensions");
  p.dimensionsSeparated = ${bool(a.separate ?? true)};
  var followers = [];
  if (p.dimensionsSeparated) for (var d = 0; d < 3; d++) { try { followers.push(p.getSeparationFollower(d).name); } catch (e) {} }
  out.push({ layer: ls[i].index, property: p.name, separated: p.dimensionsSeparated, dimensions: followers });
}
__result__ = { properties: out };`, { undo: 'Separate dimensions' })),
    },
    {
        name: 'sequence_layers',
        description: 'Arrange layers one after another in time, in the order given, optionally overlapping with an opacity dissolve (Animation > Keyframe Assistant > Sequence Layers)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `${LAYERS_SCHEMA.description}. The first plays first` },
                overlap: { type: 'number', minimum: 0, description: 'Seconds each layer overlaps the one before. Default 0' },
                transition: { type: 'string', enum: ['off', 'dissolve_front', 'cross_dissolve'], description: 'With an overlap: off (default), dissolve_front (the upper layer fades), or cross_dissolve (both fade)' },
                start: { type: 'number', description: 'When the first layer starts (seconds). Default its current in point' },
            },
            required: ['layers'],
        },
        auditArgs: { overlap: 0.5, transition: 'cross_dissolve', start: 0 },
        features: ['aftereffects.animation.sequence_layers'],
        handler: (a) => {
            const overlap = num(a.overlap ?? 0, { min: 0, max: 10800, name: 'overlap' });
            const tr = enumOf(a.transition ?? 'off', ['off', 'dissolve_front', 'cross_dissolve'], { name: 'transition' });
            if (tr !== 'off' && Number(overlap) === 0) throw new Error('A transition needs an overlap greater than 0');
            return run('Sequence layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), ov = ${overlap}, out = [], i;
if (ls.length < 2) throw new Error("Sequence Layers needs two or more layers");
var t = ${a.start === undefined ? 'ls[0].inPoint' : num(a.start, { name: 'start' })};
for (i = 0; i < ls.length; i++) {
  if (ov > 0 && ls[i].outPoint - ls[i].inPoint <= ov) throw new Error(ls[i].name + " is not longer than the overlap");
  ls[i].startTime += t - ls[i].inPoint;
  t = ls[i].outPoint - ov;
}
var __fade = function (l, from, to, a0, a1) {
  var o = l.property("ADBE Transform Group").property("ADBE Opacity");
  o.setValueAtTime(from, a0); o.setValueAtTime(to, a1);
};
for (i = 1; i < ls.length; i++) {
  var prev = ls[i - 1], next = ls[i], s = next.inPoint, e = prev.outPoint;
  ${tr === 'cross_dissolve' ? '__fade(prev, s, e, 100, 0); __fade(next, s, e, 0, 100);' : ''}
  ${tr === 'dissolve_front' ? 'if (prev.index < next.index) __fade(prev, s, e, 100, 0); else __fade(next, s, e, 0, 100);' : ''}
}
for (i = 0; i < ls.length; i++) out.push({ layer: ls[i].index, name: ls[i].name, inPoint: ls[i].inPoint, outPoint: ls[i].outPoint });
__result__ = { layers: out };`, { undo: 'Sequence layers' }));
        },
    },
    {
        name: 'run_animation_command',
        description: 'Run an Animation or Timeline command that acts on the selection: Enable Auto-keyframe (toggle), Select Equal / Previous / Following Keyframes, Select Keyframe Label Group (and its On Selected Layers, On All Layers and Visible Keyframes variants), Keyframe Assistant > Exponential Scale, RPF Camera Import and Create Keyframes from Data, Reveal in Timeline, Reveal Properties with Animation, Reveal All Modified Properties and Reveal Expression Errors. Select keyframes first with select_keyframes; layers (and property) given here are selected before the command runs',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(COMMANDS), description: 'The command' },
                comp: { ...COMP_SCHEMA, description: `${COMP_SCHEMA.description}. It is opened in the Timeline first` },
                layers: { ...LAYERS_SCHEMA, description: 'Select only these layers first (indexes, names, or selected: true to keep the selection)' },
                property: { ...PROPERTY_SCHEMA, description: `With layers, also select this property (Reveal in Timeline). ${PROPERTY_SCHEMA.description}` },
            },
            required: ['command'],
        },
        auditArgs: { command: 'reveal_animating_properties', property: 'position' },
        features: [
            'aftereffects.animation.enable_auto_keyframe',
            'aftereffects.animation.select_equal_keyframes',
            'aftereffects.animation.select_previous_keyframes',
            'aftereffects.animation.select_following_keyframes',
            'aftereffects.animation.select_keyframe_label_group',
            'aftereffects.animation.label_group_on_selected_layers',
            'aftereffects.animation.label_group_on_all_layers',
            'aftereffects.animation.label_group_visible_selected_layers',
            'aftereffects.animation.label_group_visible_all_layers',
            'aftereffects.animation.exponential_scale',
            'aftereffects.animation.rpf_camera_import',
            'aftereffects.animation.create_keyframes_from_data',
            'aftereffects.animation.reveal_in_timeline',
            'aftereffects.animation.reveal_animating_properties',
            'aftereffects.animation.reveal_modified_properties',
            'aftereffects.expressions.reveal_expression_errors',
        ],
        handler: (a) => {
            const cmd = COMMANDS[enumOf(a.command, Object.keys(COMMANDS), { name: 'command' })];
            if (a.property !== undefined && a.layers === undefined) throw new Error("'property' needs 'layers'");
            const needComp = a.comp !== undefined || a.layers !== undefined;
            return run('Animation command', script(`
${needComp ? `var c = __comp(${compSpec(a.comp)}); c.openInViewer();` : ''}
${a.layers !== undefined ? `var ls = __layers(c, ${layerSpec(a.layers)}), i;
for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
for (i = 0; i < ls.length; i++) ls[i].selected = true;
${a.property !== undefined ? `for (i = 0; i < ls.length; i++) __prop(ls[i], ${propertyPath(a.property)}).selected = true;` : ''}` : ''}
${cmd.name ? `var id = app.findMenuCommandId(${str(cmd.name)});
if (!id) throw new Error("This version of After Effects has no ${cmd.name} command");` : `if (parseFloat(app.version) < ${cmd.since}) throw new Error(${str(`${a.command} needs After Effects ${cmd.since} or later`)});
var id = ${cmd.id};`}
app.executeCommand(id);
__result__ = { command: ${str(a.command)}, id: id };`, { undo: 'Animation command' }));
        },
    },
    {
        name: 'manage_puppet',
        description: 'Puppet tools: add an empty Puppet effect to layers, choose a Puppet pin tool in the Tools panel (Position, Starch, Overlap, Advanced or Bend Pin) so pins can be placed in the Composition panel, duplicate a Puppet mesh, or list the meshes and pins with their paths for set_keyframes',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add_effect', 'choose_tool', 'duplicate_mesh', 'list'], description: 'What to do' },
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `${LAYERS_SCHEMA.description}. For add_effect, duplicate_mesh and list` },
                tool: { type: 'string', enum: Object.keys(PIN_TOOLS), description: 'For choose_tool: position, starch, overlap, advanced or bend' },
                mesh: { type: 'integer', minimum: 1, description: 'For duplicate_mesh: the mesh number, 1 = first. Default 1' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'duplicate_mesh', mesh: 1 },
        features: [
            'aftereffects.animation.puppet_effect',
            'aftereffects.animation.puppet_position_pin_tool',
            'aftereffects.animation.puppet_starch_pin_tool',
            'aftereffects.animation.puppet_overlap_pin_tool',
            'aftereffects.animation.puppet_advanced_pin_tool',
            'aftereffects.animation.puppet_bend_pin_tool',
            'aftereffects.animation.puppet_duplicate_mesh',
        ],
        handler: (a) => {
            const action = enumOf(a.action, ['add_effect', 'choose_tool', 'duplicate_mesh', 'list'], { name: 'action' });
            if (action === 'choose_tool') {
                const tool = PIN_TOOLS[enumOf(a.tool, Object.keys(PIN_TOOLS), { name: 'tool' })];
                return run('Puppet tool', script(`proj.toolType = ToolType.${tool};
__result__ = { tool: ${str(a.tool)} };`));
            }
            if (a.layers === undefined) throw new Error(`${action} needs 'layers'`);
            const find = `var __find = function (g, mn, depth) {
  if (g.matchName === mn) return g;
  if (depth > 6 || g.propertyType === PropertyType.PROPERTY) return null;
  for (var n = 1; n <= g.numProperties; n++) { var hit = __find(g.property(n), mn, depth + 1); if (hit) return hit; }
  return null;
};
var __puppet = function (l) {
  var fx = __find(l.property("ADBE Effect Parade"), "ADBE FreePin3", 0);
  if (!fx) throw new Error(l.name + " has no Puppet effect: add one with action add_effect or a Puppet tool");
  return fx;
};`;
            const bodies = {
                add_effect: `var parade = ls[i].property("ADBE Effect Parade");
  if (!parade.canAddProperty("ADBE FreePin3")) throw new Error(ls[i].name + " cannot take the Puppet effect");
  var fx = parade.addProperty("ADBE FreePin3");
  out.push({ layer: ls[i].index, effect: fx.name, index: fx.propertyIndex });`,
                duplicate_mesh: `var meshes = __find(__puppet(ls[i]), "ADBE FreePin3 Mesh Group", 0);
  if (!meshes || meshes.numProperties < ${index(a.mesh ?? 1, { name: 'mesh', max: 1000 })}) throw new Error(ls[i].name + " has no mesh ${Number(a.mesh ?? 1)}: place a pin with a Puppet tool first");
  var copy = meshes.property(${index(a.mesh ?? 1, { name: 'mesh', max: 1000 })}).duplicate();
  out.push({ layer: ls[i].index, mesh: copy.name, meshes: meshes.numProperties });`,
                list: `var pins = [];
  var __pins = function (g) {
    for (var n = 1; n <= g.numProperties && pins.length < 500; n++) {
      var q = g.property(n);
      if (q.propertyType === PropertyType.PROPERTY) { if (q.isSpatial) pins.push({ name: q.parentProperty.name, path: __pathOf(q), value: q.value, numKeys: q.numKeys }); }
      else __pins(q);
    }
  };
  var pfx = __puppet(ls[i]);
  __pins(pfx);
  out.push({ layer: ls[i].index, effect: pfx.name, pins: pins });`,
            };
            return run('Puppet', script(`${KEY_HELPERS}
${find}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  ${bodies[action]}
}
__result__ = { layers: out };`, action === 'list' ? {} : { undo: 'Puppet' }));
        },
    },
];
