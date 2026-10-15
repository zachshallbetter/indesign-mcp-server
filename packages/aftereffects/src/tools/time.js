/**
 * Time: time remapping and freeze frames, time stretching, frame blending, and
 * aligning video to data.
 */
import { num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec } from '../args.js';
import { SELECT_ONLY, AT_SCHEMA, atTime } from './layer-edits.js';

const REMAP_ACTIONS = ['enable', 'disable', 'freeze_frame', 'freeze_on_last_frame', 'hold', 'set_keyframes'];
const BLENDING = { off: 'NO_FRAME_BLEND', frame_mix: 'FRAME_MIX', pixel_motion: 'PIXEL_MOTION' };
const HOLD_AT = ['in_point', 'current_time', 'out_point'];

const RESULT = `
var out = [];
for (var k = 0; k < ls.length; k++) out.push(__layerInfo(ls[k]));
__result__ = { layers: out };`;

/** ES3: turn on time remapping for layer l and return its Time Remap property. */
const REMAP = `
function __remap(l) {
  if (!(l instanceof AVLayer) || !l.canSetTimeRemapEnabled) throw new Error(l.name + " cannot be time-remapped (still images, text, shapes, cameras and lights cannot)");
  if (!l.timeRemapEnabled) l.timeRemapEnabled = true;
  return l.property("ADBE Time Remapping");
}
function __hold(p, t, v) {
  p.setValueAtTime(t, v);
  var ki = p.nearestKeyIndex(t);
  p.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
}`;

/**
 * ES3: record and restore every keyframe on a layer (except markers and Time
 * Remap) at its composition time, with interpolation, easing and spatial tangents.
 */
const KEEP_KEYS = `
function __collectKeys(g, list) {
  for (var i = 1; i <= g.numProperties; i++) {
    var p = g.property(i);
    if (p.propertyType === PropertyType.PROPERTY) {
      if (p.numKeys > 0 && p.matchName !== "ADBE Marker" && p.matchName !== "ADBE Time Remapping") {
        var keys = [];
        for (var k = 1; k <= p.numKeys; k++) {
          var r = { t: p.keyTime(k), v: p.keyValue(k), i: p.keyInInterpolationType(k), o: p.keyOutInterpolationType(k), ie: null, oe: null, it: null, ot: null };
          try { r.ie = p.keyInTemporalEase(k); r.oe = p.keyOutTemporalEase(k); } catch (e1) {}
          if (p.isSpatial) try { r.it = p.keyInSpatialTangent(k); r.ot = p.keyOutSpatialTangent(k); } catch (e2) {}
          keys.push(r);
        }
        list.push({ p: p, keys: keys });
      }
    } else __collectKeys(p, list);
  }
  return list;
}
function __restoreKeys(list) {
  for (var j = 0; j < list.length; j++) {
    var p = list[j].p, keys = list[j].keys, k;
    for (k = p.numKeys; k >= 1; k--) p.removeKey(k);
    for (k = 0; k < keys.length; k++) {
      var r = keys[k];
      p.setValueAtTime(r.t, r.v);
      var ki = p.nearestKeyIndex(r.t);
      p.setInterpolationTypeAtKey(ki, r.i, r.o);
      if (r.ie) try { p.setTemporalEaseAtKey(ki, r.ie, r.oe); } catch (e3) {}
      if (r.it) try { p.setSpatialTangentsAtKey(ki, r.it, r.ot); } catch (e4) {}
    }
  }
}`;

export const tools = [
    {
        name: 'remap_layer_time',
        description: 'Time remapping (Layer > Time): enable or disable it, Freeze Frame at a time, Freeze On Last Frame (extend the layer to the composition end holding its last frame), hold one frame between two times and then resume, or set Time Remap keyframes saying which source time shows at each composition time (as the Layer panel\'s remap marker does)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                action: { type: 'string', enum: REMAP_ACTIONS, description: 'enable, disable, freeze_frame (at), freeze_on_last_frame, hold (from, to), set_keyframes (keyframes)' },
                at: { ...AT_SCHEMA, description: 'freeze_frame: the frame to hold. ' + AT_SCHEMA.description },
                from: { type: 'number', description: 'hold: composition time (seconds) whose frame is held' },
                to: { type: 'number', description: 'hold: composition time (seconds) where playback resumes' },
                keyframes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    description: 'set_keyframes: Time Remap keyframes',
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'number', description: 'Composition time, seconds' },
                            sourceTime: { type: 'number', minimum: 0, description: 'Source time shown then, seconds' },
                            hold: { type: 'boolean', description: 'Hold this frame until the next keyframe' },
                        },
                        required: ['time', 'sourceTime'],
                    },
                },
            },
            required: ['layers', 'action'],
        },
        auditArgs: { action: 'freeze_frame', at: 1 },
        features: [
            'aftereffects.time.enable_time_remapping',
            'aftereffects.time.time_remap_property',
            'aftereffects.time.freeze_frame',
            'aftereffects.time.freeze_on_last_frame',
            'aftereffects.time.freeze_middle_frame',
            'aftereffects.time.remap_in_layer_panel',
        ],
        handler: (a) => {
            const action = enumOf(a.action, REMAP_ACTIONS, { name: 'action' });
            let body;
            if (action === 'enable') body = '__remap(l);';
            else if (action === 'disable') body = 'if (l instanceof AVLayer && l.timeRemapEnabled) l.timeRemapEnabled = false;';
            else if (action === 'freeze_frame') {
                body = `var p = __remap(l), t = ${atTime(a.at)}, v = p.valueAtTime(t, false);
for (var k = p.numKeys; k >= 1; k--) p.removeKey(k);
__hold(p, t, v);`;
            } else if (action === 'freeze_on_last_frame') {
                body = `var p = __remap(l), last = l.outPoint - c.frameDuration, v = p.valueAtTime(last, false);
for (var k = p.numKeys; k >= 1; k--) if (p.keyTime(k) > last) p.removeKey(k);
__hold(p, last, v);
l.outPoint = Math.max(l.outPoint, c.duration);`;
            } else if (action === 'hold') {
                if (a.from === undefined || a.to === undefined) throw new Error("hold needs 'from' and 'to'");
                const from = Number(num(a.from, { min: -100000, max: 100000, name: 'from' }));
                const to = Number(num(a.to, { min: -100000, max: 100000, name: 'to' }));
                if (to <= from) throw new Error("'to' must be later than 'from'");
                body = `var p = __remap(l), v = p.valueAtTime(${from}, false);
__hold(p, ${from}, v);
p.setValueAtTime(${to}, v);`;
            } else {
                if (!Array.isArray(a.keyframes) || !a.keyframes.length || a.keyframes.length > 500) throw new Error("set_keyframes needs 'keyframes', 1 to 500 of them");
                const keys = a.keyframes.map((k, i) => {
                    if (!k || typeof k !== 'object') throw new Error(`keyframes[${i}] must be an object`);
                    return { t: Number(num(k.time, { min: -100000, max: 100000, name: `keyframes[${i}].time` })), v: Number(num(k.sourceTime, { min: 0, max: 100000, name: `keyframes[${i}].sourceTime` })), i: Boolean(k.hold) };
                });
                body = `var p = __remap(l), keys = ${json(keys)};
for (var k = 0; k < keys.length; k++) { if (keys[k].i) __hold(p, keys[k].t, keys[k].v); else p.setValueAtTime(keys[k].t, keys[k].v); }`;
            }
            return run('Time remapping', script(`${REMAP}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  ${body}
}
var res = [];
for (var j = 0; j < ls.length; j++) {
  var info = __layerInfo(ls[j]);
  info.timeRemapEnabled = (ls[j] instanceof AVLayer) ? ls[j].timeRemapEnabled : false;
  if (info.timeRemapEnabled) {
    var tr = ls[j].property("ADBE Time Remapping"), keyList = [];
    for (var q = 1; q <= tr.numKeys && q <= 200; q++) keyList.push({ time: tr.keyTime(q), sourceTime: tr.keyValue(q), hold: tr.keyOutInterpolationType(q) === KeyframeInterpolationType.HOLD });
    info.timeRemapKeys = keyList;
  }
  res.push(info);
}
__result__ = { layers: res };`, { undo: 'Time remapping' }));
        },
    },
    {
        name: 'set_frame_blending',
        description: 'Frame blending (Layer > Frame Blending): set layers to Off, Frame Mix or Pixel Motion (the layer\'s Frame Blending switch), and turn the composition\'s Enable Frame Blending switch on or off, without which layer frame blending is not previewed',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Layers based on motion footage or compositions. ' + LAYERS_SCHEMA.description },
                mode: { type: 'string', enum: Object.keys(BLENDING), description: 'For the layers: off, frame_mix or pixel_motion' },
                compSwitch: { type: 'boolean', description: 'The composition\'s Enable Frame Blending switch' },
            },
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.time.frame_blending_off',
            'aftereffects.time.frame_blending_frame_mix',
            'aftereffects.time.frame_blending_pixel_motion',
            'aftereffects.time.frame_blending_switch',
            'aftereffects.time.enable_frame_blending_comp',
        ],
        handler: (a) => {
            if ((a.layers === undefined) !== (a.mode === undefined)) throw new Error('Give layers and mode together');
            if (a.mode === undefined && a.compSwitch === undefined) throw new Error('Give layers and mode, or compSwitch');
            const mode = a.mode !== undefined ? BLENDING[enumOf(a.mode, Object.keys(BLENDING), { name: 'mode' })] : null;
            return run('Frame blending', script(`
var c = __comp(${compSpec(a.comp)}), ls = ${mode ? `__layers(c, ${layerSpec(a.layers)})` : '[]'};
${a.compSwitch !== undefined ? `c.frameBlending = ${a.compSwitch ? 'true' : 'false'};` : ''}
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof AVLayer)) throw new Error(ls[i].name + " cannot use frame blending");
  ls[i].frameBlendingType = FrameBlendingType.${mode ?? 'NO_FRAME_BLEND'};
}
var res = [];
for (var j = 0; j < ls.length; j++) { var info = __layerInfo(ls[j]); info.frameBlending = __enumName(ls[j].frameBlendingType); res.push(info); }
__result__ = { comp: c.name, compFrameBlending: c.frameBlending, layers: res };`, { undo: 'Frame blending' }));
        },
    },
    {
        name: 'stretch_layers',
        description: 'Time-stretch layers (Layer > Time > Time Stretch, the Stretch column): to a percentage or a new length, holding the In point, the current time or the Out point in place; or stretch so the In or Out point lands on a time (Ctrl/Cmd+Shift+, and +.). Optionally keep keyframes at their original times, or conform the source footage\'s frame rate instead',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                percent: { type: 'number', minimum: -10000, maximum: 10000, description: 'Stretch factor percent (100 is normal speed, 200 half speed, negative plays backwards)' },
                duration: { type: 'number', minimum: 0.001, maximum: 100000, description: 'New length between In and Out points, seconds' },
                holdInPlace: { type: 'string', enum: HOLD_AT, description: 'percent and duration: which point stays put. Default in_point' },
                edge: { type: 'string', enum: ['in', 'out'], description: 'Stretch so this end lands on at, keeping the other end in place' },
                at: AT_SCHEMA,
                keepKeyframeTimes: { type: 'boolean', description: 'Leave keyframes at their composition times instead of stretching them with the layer' },
                conformFrameRate: { type: 'number', minimum: 0, maximum: 999, description: 'Instead of stretching: conform the layers\' source footage to this frame rate (Interpret Footage; 0 uses the file\'s rate). Affects every layer using that footage' },
            },
            required: ['layers'],
        },
        auditArgs: { percent: 200, duration: undefined, edge: undefined, at: undefined, conformFrameRate: undefined },
        features: [
            'aftereffects.time.stretch_to_current_time',
            'aftereffects.time.stretch_column',
            'aftereffects.time.stretch_without_keyframes',
            'aftereffects.time.convert_frame_rate',
        ],
        handler: (a) => {
            const given = ['percent', 'duration', 'edge', 'conformFrameRate'].filter((k) => a[k] !== undefined);
            if (given.length !== 1) throw new Error('Give one of percent, duration, edge (with at) or conformFrameRate');
            if (a.conformFrameRate !== undefined) {
                return run('Conform frame rate', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var s = (ls[i] instanceof AVLayer) ? ls[i].source : null;
  if (!(s instanceof FootageItem) || s.mainSource.isStill) throw new Error(ls[i].name + " is not based on motion footage");
  s.mainSource.conformFrameRate = ${num(a.conformFrameRate, { min: 0, max: 999, name: 'conformFrameRate' })};
}
${RESULT}`, { undo: 'Conform frame rate' }));
            }
            // s2: the new stretch; h: the composition time that keeps showing the same source frame.
            let calc;
            if (a.edge !== undefined) {
                const edge = enumOf(a.edge, ['in', 'out'], { name: 'edge' });
                calc = edge === 'in'
                    ? `var t = ${atTime(a.at)}; if (t >= l.outPoint) throw new Error(l.name + ": the In point must stay before the Out point"); var s2 = l.stretch * (l.outPoint - t) / (l.outPoint - l.inPoint), h = l.outPoint;`
                    : `var t = ${atTime(a.at)}; if (t <= l.inPoint) throw new Error(l.name + ": the Out point must stay after the In point"); var s2 = l.stretch * (t - l.inPoint) / (l.outPoint - l.inPoint), h = l.inPoint;`;
            } else {
                const hold = { in_point: 'l.inPoint', current_time: 'c.time', out_point: 'l.outPoint' }[enumOf(a.holdInPlace ?? 'in_point', HOLD_AT, { name: 'holdInPlace' })];
                if (a.percent !== undefined && Number(a.percent) === 0) throw new Error("'percent' cannot be 0");
                calc = a.percent !== undefined
                    ? `var s2 = ${num(a.percent, { min: -10000, max: 10000, name: 'percent' })}, h = ${hold};`
                    : `var s2 = l.stretch * ${num(a.duration, { min: 0.001, max: 100000, name: 'duration' })} / (l.outPoint - l.inPoint), h = ${hold};`;
            }
            return run('Time stretch', script(`${a.keepKeyframeTimes ? KEEP_KEYS : ''}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  if (l.locked) throw new Error(l.name + " is locked");
  ${calc}
  if (!s2 || Math.abs(s2) > 10000) throw new Error(l.name + ": the stretch would be " + s2 + "%, outside -10000 to 10000");
  var src = (h - l.startTime) / l.stretch, i0 = l.inPoint, o0 = l.outPoint;
  ${a.keepKeyframeTimes ? 'var kept = __collectKeys(l, []);' : ''}
  l.stretch = s2;
  l.startTime = h - src * s2;
  ${a.keepKeyframeTimes ? '__restoreKeys(kept);' : ''}
}
${RESULT}`, { undo: 'Time stretch' }));
        },
    },
    {
        name: 'align_video_to_data',
        description: 'Align Video to Data (Layer > Time): offset video layers in time by the frame counts their names have in a data layer\'s mgJSON videoSyncTimeList. Selects the data layer and the video layers and makes the composition active',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                dataLayer: { type: 'integer', minimum: 1, description: 'Index of the mgJSON data layer' },
                layers: { ...LAYERS_SCHEMA, description: 'The video layers to align. ' + LAYERS_SCHEMA.description },
            },
            required: ['dataLayer', 'layers'],
        },
        auditArgs: { dataLayer: 3 },
        features: ['aftereffects.time.align_video_to_data'],
        handler: (a) => run('Align video to data', script(`${SELECT_ONLY}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), di = ${index(a.dataLayer, { name: 'dataLayer', max: 10000 })};
if (di < 1 || di > c.numLayers) throw new Error("Layer " + di + " does not exist; the composition has " + c.numLayers);
var sel = [c.layer(di)];
for (var i = 0; i < ls.length; i++) if (ls[i].index !== di) sel.push(ls[i]);
__selectOnly(c, sel);
app.executeCommand(4041);
${RESULT}`, { undo: 'Align video to data' })),
    },
];
