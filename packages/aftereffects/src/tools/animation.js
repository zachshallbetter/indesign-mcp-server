/**
 * Properties, keyframes and expressions: read and set any property, add and
 * remove keyframes with their interpolation and easing, and write expressions.
 */
import { num, bool, enumOf, json, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, PROPERTY_SCHEMA, compSpec, layerSpec, propertyPath, propertyValue } from '../args.js';

const INTERP = { linear: 'LINEAR', bezier: 'BEZIER', hold: 'HOLD' };

const TARGET = { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, property: PROPERTY_SCHEMA };

/** ES3: describe a property's value and keyframes. */
const PROP_INFO = `
function __propInfo(p) {
  var info = { name: p.name, matchName: p.matchName, numKeys: p.numKeys, expression: p.canSetExpression ? p.expression : null, expressionEnabled: p.canSetExpression ? p.expressionEnabled : null };
  try { var v = p.value; info.value = (v instanceof TextDocument) ? v.text : (v instanceof MarkerValue ? v.comment : v); } catch (e) {}
  var keys = [];
  for (var k = 1; k <= p.numKeys && k <= 500; k++) {
    var kv = p.keyValue(k);
    keys.push({ index: k, time: p.keyTime(k), value: (kv instanceof TextDocument) ? kv.text : kv, in: __enumName(p.keyInInterpolationType(k)), out: __enumName(p.keyOutInterpolationType(k)) });
  }
  info.keys = keys;
  return info;
}`;

export const tools = [
    {
        name: 'get_property',
        description: 'Read a layer property: its value, keyframes (time, value, interpolation) and expression. Properties are named by a shortcut or a path of match names or names',
        inputSchema: { type: 'object', properties: { ...TARGET, time: { type: 'number', description: 'Also read the value at this time (seconds)' } }, required: ['layers', 'property'] },
        hints: { readOnly: true },
        auditArgs: { property: 'position', time: 1 },
        features: ['aftereffects.animation.property_keyframes_object'],
        handler: (a) => run('Get property', script(`${PROP_INFO}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path), info = __propInfo(p);
  info.layer = ls[i].index;
  ${a.time !== undefined ? `info.valueAtTime = p.valueAtTime(${num(a.time, { name: 'time' })}, false);` : ''}
  out.push(info);
}
__result__ = { properties: out };`)),
    },
    {
        name: 'set_property',
        description: 'Set a property\'s value: with no time and no keyframes the static value, otherwise a keyframe at the time (or the current time). Text layers\' Source Text takes a string',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, value: { description: 'A number, an array of numbers, text, or true/false' }, time: { type: 'number', description: 'Seconds: set a keyframe at this time' } },
            required: ['layers', 'property', 'value'],
        },
        auditArgs: { property: 'opacity', value: 50 },
        features: [
            'aftereffects.layers.edit_value',
            'aftereffects.animation.add_property_keyframe',
            'aftereffects.text.source_text',
            'aftereffects.three_d.stereo_rig_option.stereo_scene_depth',
            'aftereffects.three_d.stereo_rig_option.converge_cameras',
            'aftereffects.three_d.stereo_rig_option.converge_to',
            'aftereffects.three_d.stereo_rig_option.configuration',
        ],
        handler: (a) => {
            const v = propertyValue(a.value);
            return run('Set property', script(`${PROP_INFO}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path), v = ${v};
  if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) { var td = p.value; td.text = String(v); v = td; }
  ${a.time !== undefined ? `p.setValueAtTime(${num(a.time, { name: 'time' })}, v);` : 'if (p.numKeys > 0) p.setValueAtTime(c.time, v); else p.setValue(v);'}
  var info = __propInfo(p); info.layer = ls[i].index; out.push(info);
}
__result__ = { properties: out };`, { undo: 'Set property' }));
        },
    },
    {
        name: 'set_keyframes',
        description: 'Add keyframes to a property at several times, with their values, and optionally the interpolation (linear, bezier, hold) and easing (Easy Ease influence and speed) for each',
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                keyframes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'number', description: 'Seconds' },
                            value: { description: 'A number, an array of numbers, text or true/false' },
                            interpolation: { type: 'string', enum: Object.keys(INTERP) },
                            easeInfluence: { type: 'number', minimum: 0.1, maximum: 100, description: 'Easy Ease: influence percent for both sides (33.33 is Easy Ease)' },
                        },
                        required: ['time', 'value'],
                    },
                },
            },
            required: ['layers', 'property', 'keyframes'],
        },
        auditArgs: { property: 'position', keyframes: [{ time: 0, value: [100, 100] }, { time: 1, value: [500, 300], interpolation: 'bezier', easeInfluence: 33.33 }] },
        features: [
            'aftereffects.animation.add_property_keyframe',
            'aftereffects.animation.stopwatch',
            'aftereffects.animation.keyframe_interpolation_dialog',
            'aftereffects.animation.interpolation_linear',
            'aftereffects.animation.interpolation_bezier',
            'aftereffects.animation.interpolation_hold',
            'aftereffects.animation.keyframe_velocity_dialog',
            'aftereffects.animation.easy_ease',
        ],
        handler: (a) => {
            if (!Array.isArray(a.keyframes) || !a.keyframes.length) throw new Error("'keyframes' must list at least one keyframe");
            const keys = a.keyframes.map((k, i) => {
                if (!k || typeof k !== 'object') throw new Error(`keyframes[${i}] must be an object`);
                return {
                    t: Number(num(k.time, { name: `keyframes[${i}].time` })),
                    v: JSON.parse(propertyValue(k.value, `keyframes[${i}].value`)),
                    i: k.interpolation === undefined ? null : INTERP[enumOf(k.interpolation, Object.keys(INTERP), { name: `keyframes[${i}].interpolation` })],
                    e: k.easeInfluence === undefined ? null : Number(num(k.easeInfluence, { min: 0.1, max: 100, name: `keyframes[${i}].easeInfluence` })),
                };
            });
            return run('Set keyframes', script(`${PROP_INFO}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, keys = ${json(keys)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (!p.canVaryOverTime) throw new Error(p.name + " cannot be animated");
  for (var k = 0; k < keys.length; k++) {
    var v = keys[k].v;
    if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) { var td = p.value; td.text = String(v); v = td; }
    p.setValueAtTime(keys[k].t, v);
    var ki = p.nearestKeyIndex(keys[k].t);
    if (keys[k].i) p.setInterpolationTypeAtKey(ki, KeyframeInterpolationType[keys[k].i], KeyframeInterpolationType[keys[k].i]);
    if (keys[k].e !== null) {
      // One ease per dimension, except spatial properties, which take one.
      var dims = (p.value instanceof Array && !p.isSpatial) ? p.value.length : 1;
      var ease = [], j;
      for (j = 0; j < dims; j++) ease.push(new KeyframeEase(0, keys[k].e));
      p.setTemporalEaseAtKey(ki, ease, ease);
    }
  }
  var info = __propInfo(p); info.layer = ls[i].index; out.push(info);
}
__result__ = { properties: out };`, { undo: 'Set keyframes' }));
        },
    },
    {
        name: 'remove_keyframes',
        description: 'Remove keyframes from a property: all of them, or those between two times',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, from: { type: 'number', description: 'Seconds' }, to: { type: 'number', description: 'Seconds' } },
            required: ['layers', 'property'],
        },
        auditArgs: { property: 'scale' },
        hints: { destructive: true },
        features: ['aftereffects.animation.delete_keyframes'],
        handler: (a) => run('Remove keyframes', script(`${PROP_INFO}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, out = [];
var from = ${a.from !== undefined ? num(a.from, { name: 'from' }) : '-1e9'}, to = ${a.to !== undefined ? num(a.to, { name: 'to' }) : '1e9'};
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path), removed = 0;
  for (var k = p.numKeys; k >= 1; k--) { var t = p.keyTime(k); if (t >= from && t <= to) { p.removeKey(k); removed++; } }
  var info = __propInfo(p); info.layer = ls[i].index; info.removed = removed; out.push(info);
}
__result__ = { properties: out };`, { undo: 'Remove keyframes' })),
    },
    {
        name: 'set_expression',
        description: 'Write an expression on a property (or clear it with an empty string), and report any expression error After Effects finds',
        inputSchema: {
            type: 'object',
            properties: { ...TARGET, expression: { type: 'string', description: 'Expression source; "" removes it' }, enabled: { type: 'boolean', description: 'Default true', default: true } },
            required: ['layers', 'property', 'expression'],
        },
        auditArgs: { property: 'rotation', expression: 'time * 90' },
        features: [
            'aftereffects.expressions.expressions',
            'aftereffects.expressions.add_expression',
            'aftereffects.expressions.remove_expression',
            'aftereffects.expressions.enable_expression_switch',
            'aftereffects.expressions.expression_errors',
        ],
        handler: (a) => run('Set expression', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), path = ${propertyPath(a.property)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var p = __prop(ls[i], path);
  if (!p.canSetExpression) throw new Error(p.name + " cannot take an expression");
  p.expression = ${str(a.expression ?? '')};
  p.expressionEnabled = ${bool(a.enabled ?? true)} && p.expression !== "";
  out.push({ layer: ls[i].index, property: p.name, expression: p.expression, enabled: p.expressionEnabled, error: p.expressionError || null });
}
__result__ = { properties: out };`, { undo: 'Set expression' })),
    },
];

