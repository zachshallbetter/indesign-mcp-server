/**
 * Motion tracking and stabilisation: set up point, mask and property tracks
 * from the Animation menu, apply and configure Warp Stabilizer VFX and the 3D
 * Camera Tracker, and read and edit tracker and face-tracking data.
 *
 * Analysis that needs a person (placing track points, the Tracker panel's
 * Analyze buttons, Mocha) stays interactive; what a script can start or set is
 * here.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, PROPERTY_SCHEMA, compSpec, layerSpec, propertyPath } from '../args.js';

/** Menu commands for start_tracking: a fixed id, or English names to look up (plug-in and Window ids vary by install). */
const TRACK_ACTIONS = {
    track_motion: { id: 2568, layer: true, label: 'Animation > Track Motion' },
    track_mask: { id: 10311, layer: true, label: 'Animation > Track Mask' },
    track_property: { id: 2643, layer: true, label: 'Animation > Track this Property' },
    paste_mocha_mask: { names: ['Paste Mocha mask', 'Paste mocha mask'], layer: true, label: 'Edit > Paste Mocha mask' },
    track_in_mocha: { names: ['Track in Boris FX Mocha', 'Track in mocha AE'], layer: true, label: 'Animation > Track in Boris FX Mocha' },
    tracker_panel: { names: ['Tracker'], layer: false, label: 'Window > Tracker' },
    workspace: { names: ['Motion Tracking'], layer: false, label: 'Window > Workspace > Motion Tracking' },
};

/** Track point properties: key, match name, display name. */
const TRACK_POINT_PROPS = [
    ['featureCenter', 'ADBE MTracker Pt Feature Center', 'Feature Center'],
    ['featureSize', 'ADBE MTracker Pt Feature Size', 'Feature Size'],
    ['searchOffset', 'ADBE MTracker Pt Search Ofst', 'Search Offset'],
    ['searchSize', 'ADBE MTracker Pt Search Size', 'Search Size'],
    ['confidence', 'ADBE MTracker Pt Confidence', 'Confidence'],
    ['attachPoint', 'ADBE MTracker Pt Attach Pt', 'Attach Point'],
    ['attachPointOffset', 'ADBE MTracker Pt Attach Pt Ofst', 'Attach Point Offset'],
];
const EDITABLE_POINT_PROPS = TRACK_POINT_PROPS.filter(([k]) => k !== 'confidence');

/** Warp Stabilizer VFX popup menus, in menu order (popup values are 1-based). */
const WARP_MENUS = {
    result: ['smooth_motion', 'no_motion'],
    method: ['position', 'position_scale_rotation', 'perspective', 'subspace_warp'],
    framing: ['stabilize_only', 'stabilize_crop', 'stabilize_crop_auto_scale', 'stabilize_synthesize_edges'],
    rollingShutterRipple: ['automatic_reduction', 'enhanced_reduction'],
    objective: ['stabilize', 'reversible_stabilization', 'reverse_stabilization', 'apply_motion_to_target', 'apply_motion_to_target_over_original'],
};

/** 3D Camera Tracker Solve Method, in menu order. */
const SOLVE_METHODS = ['auto_detect', 'typical', 'mostly_flat_scene', 'tripod_pan'];

const ONE_LAYER = { ...LAYERS_SCHEMA, description: 'The layer: one index (1-based, from list_layers), name, or selected: true' };
const TIME_SCHEMA = { type: 'number', minimum: 0, description: 'Composition time in seconds' };

/** ES3: one layer from a spec, opened and selected alone in its composition, for menu commands. */
const FOCUS = `
function __oneLayer(c, spec) {
  var ls = __layers(c, spec);
  if (ls.length !== 1) throw new Error("Choose one layer; got " + ls.length);
  return ls[0];
}
function __focus(c, l) {
  c.openInViewer();
  var sel = c.selectedLayers;
  for (var i = sel.length - 1; i >= 0; i--) sel[i].selected = false;
  l.selected = true;
  var sp = l.selectedProperties;
  for (var j = sp.length - 1; j >= 0; j--) sp[j].selected = false;
}
function __commandId(names) {
  for (var i = 0; i < names.length; i++) { var id = app.findMenuCommandId(names[i]); if (id) return id; }
  throw new Error("After Effects has no menu command named " + names.join(" or ") + " (is the plug-in installed?)");
}
`;

/** ES3: find an effect by match name on a layer, or add it; set controls by display name. */
const EFFECT_HELPERS = `
function __effectOn(l, matchName, addNew) {
  var parade = l.property("ADBE Effect Parade");
  if (!addNew) for (var f = 1; f <= parade.numProperties; f++) if (parade.property(f).matchName === matchName) return { fx: parade.property(f), added: false };
  if (!parade.canAddProperty(matchName)) throw new Error("Cannot add " + matchName + " to layer " + l.name);
  return { fx: parade.addProperty(matchName), added: true };
}
function __setControls(fx, pairs, time) {
  var done = [];
  for (var k = 0; k < pairs.length; k++) {
    var p = fx.property(pairs[k][0]);
    if (!p) throw new Error(fx.name + " has no control " + pairs[k][0]);
    if (p.numKeys > 0) p.setValueAtTime(time, pairs[k][1]); else p.setValue(pairs[k][1]);
    done.push(pairs[k][0]);
  }
  return done;
}
function __controls(fx) {
  var out = [];
  for (var p = 1; p <= fx.numProperties; p++) {
    var pr = fx.property(p);
    if (pr.propertyType !== PropertyType.PROPERTY || pr.propertyValueType === PropertyValueType.NO_VALUE) continue;
    var v = null;
    try { v = pr.value; } catch (e) {}
    out.push({ name: pr.name, value: v });
  }
  return out;
}`;

/** Popup value (1-based) for an enum option, or undefined. */
function menuValue(list, value, name) {
    if (value === undefined) return undefined;
    return list.indexOf(enumOf(value, list, { name })) + 1;
}

/** A number within range, as a JS number, or undefined. */
function optNum(value, name, min, max) {
    return value === undefined ? undefined : Number(num(value, { name, min, max }));
}

/** A tracker or track point chosen by 1-based index or name; default 1. */
function pick(value, name) {
    if (value === undefined) return 1;
    if (typeof value === 'string' && value.length) return value;
    const n = Number(index(value, { name, max: 10000 }));
    if (n < 1) throw new Error(`'${name}' is 1-based`);
    return n;
}

/** A 2D point or size as [x, y]. */
function pair(value, name) {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`'${name}' takes [x, y]`);
    return value.map((v) => Number(num(v, { name })));
}

export const tools = [
    {
        name: 'start_tracking',
        description: 'Set up tracking from the Animation menu on one layer: Track Motion (adds a point tracker and opens the layer in the Layer panel), Track Mask (the mask tracker for the chosen masks), Track this Property (a track that drives the chosen property), Paste Mocha mask (Edit menu), Track in Boris FX Mocha; or open the Tracker panel or the Motion Tracking workspace (Window menu). The analysis itself runs from the Tracker panel; read and edit the resulting track points with get_tracking_data and set_track_point',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: Object.keys(TRACK_ACTIONS), description: 'track_motion, track_mask, track_property, paste_mocha_mask, track_in_mocha, tracker_panel (Window > Tracker) or workspace (Motion Tracking workspace)' },
                comp: COMP_SCHEMA,
                layers: ONE_LAYER,
                masks: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'track_mask: mask indexes (1-based); omit for every mask on the layer' },
                property: { ...PROPERTY_SCHEMA, description: `track_property: the property the track drives. ${PROPERTY_SCHEMA.description}` },
                time: { ...TIME_SCHEMA, description: 'Move the current time here first (tracking starts from the current time)' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'track_mask', masks: [1], property: undefined },
        features: [
            'aftereffects.motion_tracking.tracker_panel',
            'aftereffects.motion_tracking.track_motion',
            'aftereffects.motion_tracking.track_this_property',
            'aftereffects.motion_tracking.track_mask',
            'aftereffects.motion_tracking.mocha_ae',
            'aftereffects.motion_tracking.paste_mocha_mask',
            'aftereffects.motion_tracking.motion_tracking_workspace',
        ],
        handler: (a) => {
            const action = enumOf(a.action, Object.keys(TRACK_ACTIONS), { name: 'action' });
            const def = TRACK_ACTIONS[action];
            if (a.masks !== undefined && action !== 'track_mask') throw new Error("'masks' applies only to action track_mask");
            if (a.property !== undefined && action !== 'track_property') throw new Error("'property' applies only to action track_property");
            if (action === 'track_property' && a.property === undefined) throw new Error("track_property needs 'property'");
            if (!def.layer && a.layers !== undefined) throw new Error(`'layers' does not apply to ${action}`);
            const masks = (a.masks ?? []).map((m) => Number(index(m, { name: 'masks', max: 10000 })));
            if (masks.includes(0)) throw new Error("'masks' are 1-based");
            const idExpr = def.id ? String(def.id) : `__commandId(${json(def.names)})`;
            const time = a.time !== undefined ? num(a.time, { name: 'time', min: 0 }) : null;
            let body;
            if (!def.layer) {
                body = `var id = ${idExpr};
app.executeCommand(id);
__result__ = { action: ${str(action)}, command: id };`;
            } else {
                body = `var c = __comp(${compSpec(a.comp)}), l = __oneLayer(c, ${layerSpec(a.layers)});
${time !== null ? `c.time = ${time};` : ''}
__focus(c, l);
${action === 'track_mask' ? `var mg = l.property("ADBE Mask Parade"), want = ${json(masks)};
if (!mg || mg.numProperties === 0) throw new Error("Layer " + l.name + " has no masks: add one with add_mask");
if (!want.length) for (var m = 1; m <= mg.numProperties; m++) want.push(m);
for (var w = 0; w < want.length; w++) {
  if (want[w] > mg.numProperties) throw new Error("Mask " + want[w] + " does not exist; the layer has " + mg.numProperties);
  mg.property(want[w]).selected = true;
}` : ''}
${action === 'track_property' ? `var tp = __prop(l, ${propertyPath(a.property)});
if (tp.propertyType !== PropertyType.PROPERTY) throw new Error(tp.name + " is a group; choose a property");
tp.selected = true;` : ''}
var id = ${idExpr};
app.executeCommand(id);
var mt = l.property("ADBE MTrackers");
__result__ = { action: ${str(action)}, command: id, layer: l.index, trackers: mt ? mt.numProperties : 0 };`;
            }
            return run('Start tracking', script(FOCUS + body, { undo: 'Start tracking' }));
        },
    },
    {
        name: 'apply_warp_stabilizer',
        description: 'Apply Warp Stabilizer VFX to layers (Animation > Warp Stabilizer VFX), or change the one already applied, and set its controls: Result, Smoothness, Method, Preserve Scale, Framing, Auto-scale, Additional Scale, Detailed Analysis, Rolling Shutter Ripple, Crop Less <-> Smooth More, synthesis options, Objective, Target Layer, Track Point Size, Auto-delete Points and Hide Warning Banner. After Effects analyses the layer in the background after the effect is added or its analysis settings change',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                addNew: { type: 'boolean', description: 'Add another instance even when the layer already has Warp Stabilizer. Default false: change the existing one' },
                result: { type: 'string', enum: WARP_MENUS.result, description: 'Result: smooth the camera move or remove it' },
                smoothness: { type: 'number', minimum: 0, maximum: 1000, description: 'Smoothness percent (Smooth Motion)' },
                method: { type: 'string', enum: WARP_MENUS.method, description: 'Method: the most complex stabilization allowed' },
                preserveScale: { type: 'boolean', description: 'Preserve Scale' },
                framing: { type: 'string', enum: WARP_MENUS.framing, description: 'Framing: how moving edges are handled' },
                maximumScale: { type: 'number', minimum: 100, maximum: 1000, description: 'Auto-scale > Maximum Scale percent' },
                actionSafeMargin: { type: 'number', minimum: 0, maximum: 100, description: 'Auto-scale > Action-Safe Margin percent' },
                additionalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Additional Scale percent' },
                detailedAnalysis: { type: 'boolean', description: 'Advanced > Detailed Analysis' },
                rollingShutterRipple: { type: 'string', enum: WARP_MENUS.rollingShutterRipple, description: 'Advanced > Rolling Shutter Ripple' },
                cropLessSmoothMore: { type: 'number', minimum: 0, maximum: 100, description: 'Advanced > Crop Less <-> Smooth More percent' },
                synthesisInputRange: { type: 'number', minimum: 0, maximum: 100, description: 'Advanced > Synthesis Input Range, seconds' },
                synthesisEdgeFeather: { type: 'number', minimum: 0, maximum: 100, description: 'Advanced > Synthesis Edge Feather' },
                synthesisEdgeCropping: {
                    type: 'object',
                    description: 'Advanced > Synthesis Edge Cropping, pixels trimmed from each edge',
                    properties: { left: { type: 'number', description: 'Left' }, top: { type: 'number', description: 'Top' }, right: { type: 'number', description: 'Right' }, bottom: { type: 'number', description: 'Bottom' } },
                },
                objective: { type: 'string', enum: WARP_MENUS.objective, description: 'Objective: stabilize, reverse, or apply the motion to a target layer' },
                targetLayer: { type: 'integer', minimum: 1, description: 'Target Layer index for the apply_motion_to_target objectives' },
                trackPointSize: { type: 'number', minimum: 0, maximum: 1000, description: 'Advanced > Track Point Size percent' },
                autoDeletePoints: { type: 'boolean', description: 'Advanced > Auto-delete Points Across Time' },
                hideWarningBanner: { type: 'boolean', description: 'Advanced > Hide Warning Banner' },
            },
            required: ['layers'],
        },
        auditArgs: { synthesisEdgeCropping: { left: 4 }, maximumScale: 150, objective: 'apply_motion_to_target', targetLayer: 1 },
        features: [
            'aftereffects.motion_tracking.warp_stabilizer',
            'aftereffects.motion_tracking.warp_stabilizer_option.result',
            'aftereffects.motion_tracking.warp_stabilizer_option.smoothness',
            'aftereffects.motion_tracking.warp_stabilizer_option.method',
            'aftereffects.motion_tracking.warp_stabilizer_option.preserve_scale',
            'aftereffects.motion_tracking.warp_stabilizer_option.framing',
            'aftereffects.motion_tracking.warp_stabilizer_option.auto_scale',
            'aftereffects.motion_tracking.warp_stabilizer_option.additional_scale',
            'aftereffects.motion_tracking.warp_stabilizer_option.detailed_analysis',
            'aftereffects.motion_tracking.warp_stabilizer_option.rolling_shutter_ripple',
            'aftereffects.motion_tracking.warp_stabilizer_option.crop_less_smooth_more',
            'aftereffects.motion_tracking.warp_stabilizer_option.synthesis_input_range_seconds',
            'aftereffects.motion_tracking.warp_stabilizer_option.synthesis_edge_feather',
            'aftereffects.motion_tracking.warp_stabilizer_option.synthesis_edge_cropping',
            'aftereffects.motion_tracking.warp_stabilizer_option.objective',
            'aftereffects.motion_tracking.warp_stabilizer_option.target_layer',
            'aftereffects.motion_tracking.warp_stabilizer_option.track_point_size',
            'aftereffects.motion_tracking.warp_stabilizer_option.auto_delete_points_across_time',
            'aftereffects.motion_tracking.warp_stabilizer_option.hide_warning_banner',
        ],
        handler: (a) => {
            const crop = a.synthesisEdgeCropping ?? {};
            if (typeof crop !== 'object' || Array.isArray(crop)) throw new Error("'synthesisEdgeCropping' takes { left, top, right, bottom }");
            for (const k of Object.keys(crop)) if (!['left', 'top', 'right', 'bottom'].includes(k)) throw new Error(`'synthesisEdgeCropping': unknown edge ${k}`);
            if (a.targetLayer !== undefined && a.objective !== undefined && !String(a.objective).startsWith('apply_motion')) throw new Error("'targetLayer' is used only by the apply_motion_to_target objectives");
            const entries = [
                ['Result', menuValue(WARP_MENUS.result, a.result, 'result')],
                ['Smoothness', optNum(a.smoothness, 'smoothness', 0, 1000)],
                ['Method', menuValue(WARP_MENUS.method, a.method, 'method')],
                ['Preserve Scale', a.preserveScale === undefined ? undefined : !!a.preserveScale],
                ['Framing', menuValue(WARP_MENUS.framing, a.framing, 'framing')],
                ['Maximum Scale', optNum(a.maximumScale, 'maximumScale', 100, 1000)],
                ['Action-Safe Margin', optNum(a.actionSafeMargin, 'actionSafeMargin', 0, 100)],
                ['Additional Scale', optNum(a.additionalScale, 'additionalScale', 1, 1000)],
                ['Detailed Analysis', a.detailedAnalysis === undefined ? undefined : !!a.detailedAnalysis],
                ['Rolling Shutter Ripple', menuValue(WARP_MENUS.rollingShutterRipple, a.rollingShutterRipple, 'rollingShutterRipple')],
                ['Crop Less <-> Smooth More', optNum(a.cropLessSmoothMore, 'cropLessSmoothMore', 0, 100)],
                ['Synthesis Input Range (seconds)', optNum(a.synthesisInputRange, 'synthesisInputRange', 0, 100)],
                ['Synthesis Edge Feather', optNum(a.synthesisEdgeFeather, 'synthesisEdgeFeather', 0, 100)],
                ['Left', optNum(crop.left, 'synthesisEdgeCropping.left', 0, 10000)],
                ['Top', optNum(crop.top, 'synthesisEdgeCropping.top', 0, 10000)],
                ['Right', optNum(crop.right, 'synthesisEdgeCropping.right', 0, 10000)],
                ['Bottom', optNum(crop.bottom, 'synthesisEdgeCropping.bottom', 0, 10000)],
                ['Objective', menuValue(WARP_MENUS.objective, a.objective, 'objective')],
                ['Track Point Size', optNum(a.trackPointSize, 'trackPointSize', 0, 1000)],
                ['Auto-delete Points Across Time', a.autoDeletePoints === undefined ? undefined : !!a.autoDeletePoints],
                ['Hide Warning Banner', a.hideWarningBanner === undefined ? undefined : !!a.hideWarningBanner],
            ].filter(([, v]) => v !== undefined);
            const target = a.targetLayer !== undefined ? Number(index(a.targetLayer, { name: 'targetLayer', max: 10000 })) : null;
            if (target === 0) throw new Error("'targetLayer' is 1-based");
            return run('Warp Stabilizer', script(`${EFFECT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), pairs = ${json(entries)}, out = [];
${target !== null ? `if (${target} > c.numLayers) throw new Error("Target layer ${target} does not exist; the composition has " + c.numLayers);
pairs.push(["Target Layer", ${target}]);` : ''}
for (var i = 0; i < ls.length; i++) {
  var hit = __effectOn(ls[i], "ADBE SubspaceStabilizer", ${bool(a.addNew)});
  var set = __setControls(hit.fx, pairs, c.time);
  out.push({ layer: ls[i].index, effect: hit.fx.name, index: hit.fx.propertyIndex, added: hit.added, set: set, controls: __controls(hit.fx) });
}
__result__ = { layers: out };`, { undo: 'Warp Stabilizer' }));
        },
    },
    {
        name: 'apply_camera_tracker',
        description: 'Track the camera of footage layers (Animation > Track Camera): apply the 3D Camera Tracker effect, or change the one already applied, and set Solve Method, Detailed Analysis, Auto-delete Points Across Time and Hide Warning Banner. After Effects analyses the layer in the background; creating a camera or content from the solved points is done in the Composition panel',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                addNew: { type: 'boolean', description: 'Add another instance even when the layer already has 3D Camera Tracker. Default false: change the existing one' },
                solveMethod: { type: 'string', enum: SOLVE_METHODS, description: 'Advanced > Solve Method: a hint about the scene' },
                detailedAnalysis: { type: 'boolean', description: 'Advanced > Detailed Analysis' },
                autoDeletePoints: { type: 'boolean', description: 'Advanced > Auto-delete Points Across Time' },
                hideWarningBanner: { type: 'boolean', description: 'Advanced > Hide Warning Banner' },
            },
            required: ['layers'],
        },
        features: [
            'aftereffects.motion_tracking.track_camera',
            'aftereffects.motion_tracking.camera_tracker_option.solve_method',
            'aftereffects.motion_tracking.camera_tracker_option.detailed_analysis',
            'aftereffects.motion_tracking.camera_tracker_option.auto_delete_points_across_time',
            'aftereffects.motion_tracking.camera_tracker_option.hide_warning_banner',
        ],
        handler: (a) => {
            const entries = [
                ['Solve Method', menuValue(SOLVE_METHODS, a.solveMethod, 'solveMethod')],
                ['Detailed Analysis', a.detailedAnalysis === undefined ? undefined : !!a.detailedAnalysis],
                ['Auto-delete Points Across Time', a.autoDeletePoints === undefined ? undefined : !!a.autoDeletePoints],
                ['Hide Warning Banner', a.hideWarningBanner === undefined ? undefined : !!a.hideWarningBanner],
            ].filter(([, v]) => v !== undefined);
            return run('3D Camera Tracker', script(`${EFFECT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), pairs = ${json(entries)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var hit = __effectOn(ls[i], "ADBE 3D Tracker", ${bool(a.addNew)});
  var set = __setControls(hit.fx, pairs, c.time);
  out.push({ layer: ls[i].index, effect: hit.fx.name, index: hit.fx.propertyIndex, added: hit.added, set: set, controls: __controls(hit.fx) });
}
__result__ = { layers: out };`, { undo: '3D Camera Tracker' }));
        },
    },
    {
        name: 'get_tracking_data',
        description: 'Read tracking results from layers: each tracker\'s track points (Feature Center, Feature Size, Search Offset, Search Size, Confidence, Attach Point, Attach Point Offset), or the Face Measurements and Face Track Points that detailed face tracking records, at a time and optionally every keyframe',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                source: { type: 'string', enum: ['trackers', 'face'], default: 'trackers', description: 'trackers (Motion Trackers) or face (the face-tracking effects)' },
                time: { ...TIME_SCHEMA, description: 'Read values at this time in seconds. Default: the current time' },
                keyframes: { type: 'boolean', description: 'Also list each property\'s keyframes (time and value)' },
                limit: { type: 'integer', minimum: 1, maximum: 10000, default: 200, description: 'Most keyframes per property' },
            },
            required: ['layers'],
        },
        hints: { readOnly: true },
        auditArgs: { source: 'trackers', keyframes: true },
        features: [
            'aftereffects.motion_tracking.tracker_object',
            'aftereffects.motion_tracking.track_point_property.feature_center',
            'aftereffects.motion_tracking.track_point_property.feature_size',
            'aftereffects.motion_tracking.track_point_property.search_offset',
            'aftereffects.motion_tracking.track_point_property.search_size',
            'aftereffects.motion_tracking.track_point_property.confidence',
            'aftereffects.motion_tracking.track_point_property.attach_point',
            'aftereffects.motion_tracking.track_point_property.attach_point_offset',
            'aftereffects.motion_tracking.face_measurement.face_offset',
            'aftereffects.motion_tracking.face_measurement.face_orientation',
            'aftereffects.motion_tracking.face_measurement.left_eye',
            'aftereffects.motion_tracking.face_measurement.right_eye',
            'aftereffects.motion_tracking.face_measurement.mouth',
        ],
        handler: (a) => {
            const source = enumOf(a.source ?? 'trackers', ['trackers', 'face'], { name: 'source' });
            const time = a.time !== undefined ? num(a.time, { name: 'time', min: 0 }) : 'c.time';
            const limit = index(a.limit ?? 200, { name: 'limit', max: 10000 });
            const read = `
function __read(p) {
  var r = { value: p.valueAtTime(t, false), numKeys: p.numKeys };
  ${a.keyframes ? `var keys = [];
  for (var k = 1; k <= p.numKeys && k <= max; k++) keys.push([p.keyTime(k), p.keyValue(k)]);
  r.keys = keys;` : ''}
  return r;
}`;
            const body = source === 'trackers' ? `
var props = ${json(TRACK_POINT_PROPS)};
for (var i = 0; i < ls.length; i++) {
  var mt = ls[i].property("ADBE MTrackers"), trackers = [];
  if (mt) for (var g = 1; g <= mt.numProperties; g++) {
    var tr = mt.property(g), points = [];
    for (var n = 1; n <= tr.numProperties; n++) {
      var pt = tr.property(n), info = { index: n, name: pt.name };
      for (var q = 0; q < props.length; q++) {
        var p = pt.property(props[q][1]) || pt.property(props[q][2]);
        if (p) info[props[q][0]] = __read(p);
      }
      points.push(info);
    }
    trackers.push({ index: g, name: tr.name, trackPoints: points });
  }
  out.push({ layer: ls[i].index, trackers: trackers });
}` : `
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), fxs = [];
  for (var f = 1; f <= parade.numProperties; f++) {
    var fx = parade.property(f);
    if (fx.name.indexOf("Face") !== 0 && fx.matchName.indexOf("Face") < 0) continue;
    var group = null, values = [];
    for (var p = 1; p <= fx.numProperties; p++) {
      var pr = fx.property(p);
      if (pr.propertyType !== PropertyType.PROPERTY) continue;
      if (pr.propertyValueType === PropertyValueType.NO_VALUE) { if (pr.name) group = pr.name; continue; }
      var r = __read(pr);
      values.push({ name: pr.name, group: group, value: r.value, numKeys: r.numKeys, keys: r.keys });
    }
    fxs.push({ index: f, name: fx.name, matchName: fx.matchName, values: values });
  }
  out.push({ layer: ls[i].index, effects: fxs });
}`;
            return run('Get tracking data', script(`${read}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), t = ${time}, max = ${limit}, out = [];
${body}
__result__ = { time: t, layers: out };`));
        },
    },
    {
        name: 'set_track_point',
        description: 'Edit a track point on a layer\'s tracker (created by start_tracking track_motion): Feature Center, Feature Size, Search Offset, Search Size, Attach Point and Attach Point Offset, in pixels. With a time, or when the property is already keyframed, it sets a keyframe; otherwise the static value',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: ONE_LAYER,
                tracker: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }], description: 'Tracker index (1-based) or name, e.g. "Tracker 1". Default 1' },
                point: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }], description: 'Track point index (1-based) or name, e.g. "Track Point 1". Default 1' },
                time: { ...TIME_SCHEMA, description: 'Set keyframes at this time in seconds' },
                featureCenter: { type: 'array', items: { type: 'number' }, description: 'Feature Center [x, y]' },
                featureSize: { type: 'array', items: { type: 'number' }, description: 'Feature Size [width, height]' },
                searchOffset: { type: 'array', items: { type: 'number' }, description: 'Search Offset [x, y] from the feature centre' },
                searchSize: { type: 'array', items: { type: 'number' }, description: 'Search Size [width, height]' },
                attachPoint: { type: 'array', items: { type: 'number' }, description: 'Attach Point [x, y]' },
                attachPointOffset: { type: 'array', items: { type: 'number' }, description: 'Attach Point Offset [x, y] from the feature centre' },
            },
            required: ['layers'],
        },
        auditArgs: { tracker: 1, point: 'Track Point 1', time: 1, featureCenter: [100, 120], featureSize: [40, 40], searchOffset: undefined, searchSize: undefined, attachPoint: undefined, attachPointOffset: undefined },
        features: [
            'aftereffects.motion_tracking.tracker_object',
            'aftereffects.motion_tracking.track_point_property.feature_center',
            'aftereffects.motion_tracking.track_point_property.feature_size',
            'aftereffects.motion_tracking.track_point_property.search_offset',
            'aftereffects.motion_tracking.track_point_property.search_size',
            'aftereffects.motion_tracking.track_point_property.attach_point',
            'aftereffects.motion_tracking.track_point_property.attach_point_offset',
        ],
        handler: (a) => {
            const values = EDITABLE_POINT_PROPS.filter(([k]) => a[k] !== undefined).map(([k, match, display]) => [match, display, pair(a[k], k)]);
            if (!values.length) throw new Error(`Give at least one of ${EDITABLE_POINT_PROPS.map(([k]) => k).join(', ')}`);
            const tracker = pick(a.tracker, 'tracker');
            const point = pick(a.point, 'point');
            const time = a.time !== undefined ? num(a.time, { name: 'time', min: 0 }) : null;
            return run('Set track point', script(`${FOCUS}
var c = __comp(${compSpec(a.comp)}), l = __oneLayer(c, ${layerSpec(a.layers)}), values = ${json(values)}, set = [];
var mt = l.property("ADBE MTrackers");
if (!mt || mt.numProperties === 0) throw new Error("Layer " + l.name + " has no trackers: start one with start_tracking track_motion");
var tr = mt.property(${json(tracker)});
if (!tr) throw new Error("No tracker " + ${json(tracker)} + " on layer " + l.name + "; it has " + mt.numProperties);
var pt = tr.property(${json(point)});
if (!pt) throw new Error("No track point " + ${json(point)} + " on " + tr.name + "; it has " + tr.numProperties);
for (var i = 0; i < values.length; i++) {
  var p = pt.property(values[i][0]) || pt.property(values[i][1]);
  if (!p) throw new Error(pt.name + " has no " + values[i][1]);
  ${time !== null ? `p.setValueAtTime(${time}, values[i][2]);` : 'if (p.numKeys > 0) p.setValueAtTime(c.time, values[i][2]); else p.setValue(values[i][2]);'}
  set.push(values[i][1]);
}
__result__ = { layer: l.index, tracker: tr.name, point: pt.name, set: set };`, { undo: 'Set track point' }));
        },
    },
];
