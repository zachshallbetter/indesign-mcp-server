/**
 * Layer edits: selection, trimming, moving and splitting in time, fit and flip,
 * whole-composition switches, opening layers, solid settings, source
 * replacement, layer styles and the Tools panel tools for layers.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

/**
 * ES3: make composition `c` the active one and select exactly the layers in
 * `ls`, for menu commands, which act on the active composition's selection.
 */
export const SELECT_ONLY = `
function __selectOnly(c, ls) {
  c.openInViewer();
  if (!proj.activeItem || proj.activeItem.id !== c.id) throw new Error("Could not make " + c.name + " the active composition");
  for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
  for (var j = 0; j < ls.length; j++) ls[j].selected = true;
}`;

const AT_KEYWORDS = ['current_time', 'comp_start', 'comp_end'];

/** Schema for a time that may also be the current time or either end of the composition. */
export const AT_SCHEMA = {
    description: 'Seconds, or "current_time" (the default), "comp_start" or "comp_end"',
    oneOf: [{ type: 'number' }, { type: 'string', enum: AT_KEYWORDS }],
};

/** A time as a JSX expression over composition `c`. */
export function atTime(value, name = 'at') {
    if (value === undefined || value === 'current_time') return 'c.time';
    if (value === 'comp_start') return '0';
    if (value === 'comp_end') return 'c.duration';
    if (typeof value === 'string') throw new Error(`'${name}': use seconds or one of ${AT_KEYWORDS.join(', ')}`);
    return num(value, { min: -100000, max: 100000, name });
}

const RESULT = `
var out = [];
for (var k = 0; k < ls.length; k++) out.push(__layerInfo(ls[k]));
__result__ = { layers: out };`;

const SWITCH_ACTIONS = ['unlock_all', 'show_all_video', 'hide_other_video'];
const OPEN_TARGETS = ['layer', 'source', 'reveal_source'];
const SELECT_ACTIONS = ['set', 'add', 'remove', 'invert', 'children', 'next', 'previous', 'extend_next', 'extend_previous', 'all', 'none'];
const MOVE_MODES = ['in_point_to', 'out_point_to', 'offset', 'stagger', 'slip'];
/** Layer > Transform commands by action; flips are done through Scale instead. */
const REFRAME_COMMANDS = { fit_to_comp: 2156, fit_to_comp_width: 2732, fit_to_comp_height: 2733, center_in_view: 3819, center_anchor_point: 10312 };
const REFRAME_ACTIONS = [...Object.keys(REFRAME_COMMANDS), 'flip_horizontal', 'flip_vertical'];
/**
 * Layer > Layer Styles: menu name, command id and the style's match name. The ids
 * come from the published command lists; names that only Layer Styles uses are
 * looked up at run time in case the id differs.
 */
const STYLES = {
    drop_shadow: { menu: 'Drop Shadow', id: 9000, match: 'dropShadow/enabled', unique: false },
    inner_shadow: { menu: 'Inner Shadow', id: 9001, match: 'innerShadow/enabled', unique: true },
    outer_glow: { menu: 'Outer Glow', id: 9002, match: 'outerGlow/enabled', unique: true },
    inner_glow: { menu: 'Inner Glow', id: 9003, match: 'innerGlow/enabled', unique: true },
    bevel_and_emboss: { menu: 'Bevel and Emboss', id: 9004, match: 'bevelEmboss/enabled', unique: false },
    satin: { menu: 'Satin', id: 9005, match: 'chromeFX/enabled', unique: true },
    color_overlay: { menu: 'Color Overlay', id: 9006, match: 'solidFill/enabled', unique: true },
    gradient_overlay: { menu: 'Gradient Overlay', id: 9007, match: 'gradientFill/enabled', unique: true },
    stroke: { menu: 'Stroke', id: 9008, match: 'frameFX/enabled', unique: false },
};
/** Blending Options values: [path below Blending Options, min, max] (switches are 0 or 1). */
const BLENDING = {
    globalLightAngle: [['ADBE Global Angle2'], -36000, 36000],
    globalLightAltitude: [['ADBE Global Altitude2'], 0, 90],
    fillOpacity: [['ADBE Adv Blend Group', 'ADBE Layer Fill Opacity2'], 0, 100],
    red: [['ADBE Adv Blend Group', 'ADBE R Channel Blend']],
    green: [['ADBE Adv Blend Group', 'ADBE G Channel Blend']],
    blue: [['ADBE Adv Blend Group', 'ADBE B Channel Blend']],
    blendInteriorStylesAsGroup: [['ADBE Adv Blend Group', 'ADBE Blend Interior']],
    useBlendRangesFromSource: [['ADBE Adv Blend Group', 'ADBE Blend Ranges']],
};
const LAYER_TOOLS = { rotation: 'Tool_Rotate', pan_behind: 'Tool_PanBehind', selection: 'Tool_Arrow' };

export const tools = [
    {
        name: 'switch_all_layers',
        description: 'Apply a switch to every layer in a composition (Layer > Switches): Unlock All Layers, Show All Video, or Hide Other Video (turn video off for every layer except the given ones)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                action: { type: 'string', enum: SWITCH_ACTIONS, description: 'unlock_all, show_all_video, or hide_other_video' },
                layers: { ...LAYERS_SCHEMA, description: 'hide_other_video: the layers to keep visible. ' + LAYERS_SCHEMA.description },
            },
            required: ['action'],
        },
        hints: { idempotent: true },
        auditArgs: { layers: undefined },
        features: ['aftereffects.layers.unlock_all_layers', 'aftereffects.layers.show_all_video', 'aftereffects.layers.hide_other_video'],
        handler: (a) => {
            const action = enumOf(a.action, SWITCH_ACTIONS, { name: 'action' });
            if (action === 'hide_other_video' && !a.layers) throw new Error("hide_other_video needs 'layers', the layers to keep visible");
            const body = {
                unlock_all: 'l.locked = false;',
                show_all_video: 'if (l.hasVideo) { var wl = l.locked; l.locked = false; l.enabled = true; l.locked = wl; }',
                hide_other_video: 'if (l.hasVideo && !keep[l.index]) { var wl = l.locked; l.locked = false; l.enabled = false; l.locked = wl; }',
            }[action];
            return run('Switch all layers', script(`
var c = __comp(${compSpec(a.comp)}), keep = {};
${action === 'hide_other_video' ? `var kl = __layers(c, ${layerSpec(a.layers)}); for (var j = 0; j < kl.length; j++) keep[kl[j].index] = true;` : ''}
var ls = [];
for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i); ${body} ls.push(l); }
${RESULT}`, { undo: 'Switch all layers' }));
        },
    },
    {
        name: 'open_layer',
        description: 'Open a layer (Layer > Open Layer) in the Layer panel, open its source (Layer > Open Layer Source: footage in the Footage panel, a pre-composition in the Composition panel), or select its source item in the Project panel (Reveal Layer Source In Project)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'One layer. ' + LAYERS_SCHEMA.description },
                target: { type: 'string', enum: OPEN_TARGETS, description: 'layer (Layer panel, the default), source, or reveal_source' },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        auditArgs: { layers: { indexes: [1] } },
        features: [
            'aftereffects.layers.open_layer',
            'aftereffects.layers.layer_panel',
            'aftereffects.layers.open_layer_source',
            'aftereffects.layers.open_composition',
            'aftereffects.layers.reveal_layer_source_in_project',
        ],
        handler: (a) => {
            const target = enumOf(a.target ?? 'layer', OPEN_TARGETS, { name: 'target' });
            const body = {
                layer: `if (!(l instanceof AVLayer) || !l.openInViewer()) throw new Error(l.name + " cannot be opened in a Layer panel: text, shape, camera, light and continuously rasterized layers have none");
__result__ = { opened: "layer", layer: __layerInfo(l) };`,
                source: `if (!(l instanceof AVLayer) || !l.source) throw new Error(l.name + " has no source item");
if (!l.source.openInViewer()) throw new Error("After Effects did not open " + l.source.name);
__result__ = { opened: l.source instanceof CompItem ? "composition" : "footage", item: __itemInfo(l.source) };`,
                reveal_source: `if (!(l instanceof AVLayer) || !l.source) throw new Error(l.name + " has no source item");
for (var i = 1; i <= proj.numItems; i++) proj.item(i).selected = false;
l.source.selected = true;
__result__ = { revealed: __itemInfo(l.source) };`,
            }[target];
            return run('Open layer', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
if (ls.length !== 1) throw new Error("Choose one layer; got " + ls.length);
var l = ls[0];
${body}`));
        },
    },
    {
        name: 'select_layers',
        description: 'Change which layers are selected in the Timeline: select given layers (by number, as typing it on the keypad), add or remove them, invert the selection, select children of parents, move the selection to the next or previous layer or extend it, select all or none',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                action: { type: 'string', enum: SELECT_ACTIONS, description: 'set, add, remove (toggle with layers); children (of layers, or of the selection); invert; next, previous, extend_next, extend_previous (from the selection); all; none' },
                layers: { ...LAYERS_SCHEMA, description: 'For set, add, remove and children. ' + LAYERS_SCHEMA.description },
            },
            required: ['action'],
        },
        hints: { idempotent: true },
        auditArgs: { action: 'set' },
        features: [
            'aftereffects.layers.select_layer_by_number',
            'aftereffects.layers.invert_selection',
            'aftereffects.layers.select_children',
            'aftereffects.layers.select_next_layer',
            'aftereffects.layers.select_previous_layer',
            'aftereffects.layers.extend_selection_next_layer',
            'aftereffects.layers.extend_selection_previous_layer',
        ],
        handler: (a) => {
            const action = enumOf(a.action, SELECT_ACTIONS, { name: 'action' });
            if (['set', 'add', 'remove'].includes(action) && !a.layers) throw new Error(`'${action}' needs 'layers'`);
            const given = a.layers ? `__layers(c, ${layerSpec(a.layers)})` : '[]';
            const body = {
                set: 'for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;\nfor (i = 0; i < ls.length; i++) ls[i].selected = true;',
                add: 'for (i = 0; i < ls.length; i++) ls[i].selected = true;',
                remove: 'for (i = 0; i < ls.length; i++) ls[i].selected = false;',
                invert: 'for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = !c.layer(i).selected;',
                all: 'for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = true;',
                none: 'for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;',
                children: `var parents = {}, src = ls.length ? ls : sel;
if (!src.length) throw new Error("No parent layers: pass layers, or select them first");
for (i = 0; i < src.length; i++) parents[src[i].index] = true;
for (i = 1; i <= c.numLayers; i++) {
  for (var up = c.layer(i).parent; up; up = up.parent) if (parents[up.index]) { c.layer(i).selected = true; break; }
}`,
                next: 'var to = sel.length ? Math.min(c.numLayers, last + 1) : 1;\nfor (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;\nc.layer(to).selected = true;',
                previous: 'var to = sel.length ? Math.max(1, first - 1) : c.numLayers;\nfor (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;\nc.layer(to).selected = true;',
                extend_next: 'if (!sel.length) throw new Error("No layer is selected");\nc.layer(Math.min(c.numLayers, last + 1)).selected = true;',
                extend_previous: 'if (!sel.length) throw new Error("No layer is selected");\nc.layer(Math.max(1, first - 1)).selected = true;',
            }[action];
            return run('Select layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = ${given}, sel = [], i;
if (!c.numLayers) throw new Error(c.name + " has no layers");
for (i = 0; i < c.selectedLayers.length; i++) sel.push(c.selectedLayers[i]);
var first = c.numLayers + 1, last = 0;
for (i = 0; i < sel.length; i++) { if (sel[i].index < first) first = sel[i].index; if (sel[i].index > last) last = sel[i].index; }
${body}
var now = [];
for (i = 0; i < c.selectedLayers.length; i++) now.push(c.selectedLayers[i].index);
__result__ = { comp: c.name, selected: now };`));
        },
    },
    {
        name: 'trim_layers',
        description: 'Trim or extend layers\' In or Out point to a time (Alt+[ and Alt+]: trim to the current time), or trim a set of layers together so the earliest In point or latest Out point lands there, keeping their offsets. Trimming never changes the source',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                edge: { type: 'string', enum: ['in', 'out'], description: 'Which end to trim' },
                at: AT_SCHEMA,
                asSet: { type: 'boolean', description: 'Trim the layers as a set: the earliest In (or latest Out) point goes to the time and the others keep their offsets. Default false' },
            },
            required: ['layers', 'edge'],
        },
        auditArgs: { at: 2 },
        features: [
            'aftereffects.layers.trim_extend_layer',
            'aftereffects.layers.trim_in_point',
            'aftereffects.layers.trim_out_point',
            'aftereffects.layers.trim_set_earliest_in_point',
            'aftereffects.layers.trim_set_latest_out_point',
        ],
        handler: (a) => {
            const edge = enumOf(a.edge, ['in', 'out'], { name: 'edge' });
            const key = edge === 'in' ? 'inPoint' : 'outPoint';
            const t = atTime(a.at);
            return run('Trim layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), t = ${t}, i;
var ref = ls[0].${key};
for (i = 1; i < ls.length; i++) ref = ${edge === 'in' ? 'Math.min' : 'Math.max'}(ref, ls[i].${key});
for (i = 0; i < ls.length; i++) {
  if (ls[i].locked) throw new Error(ls[i].name + " is locked");
  ls[i].${key} = ${a.asSet ? `ls[i].${key} + (t - ref)` : 't'};
}
${RESULT}`, { undo: 'Trim layers' }));
        },
    },
    {
        name: 'move_layers',
        description: 'Move layers in time without changing their length: put the In or Out point at a time ([ and ]: the current time; or the composition start or end), alone or as a set keeping offsets; nudge by frames (Alt+Page Up/Down) or seconds; stagger them in order (Quick Offset); or slip-edit the source under fixed In and Out points',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                mode: { type: 'string', enum: MOVE_MODES, description: 'in_point_to, out_point_to (use at), offset (by frames or seconds), stagger (each layer one step later than the one before, in the order given), slip (move the source by frames or seconds inside the In and Out points)' },
                at: AT_SCHEMA,
                asSet: { type: 'boolean', description: 'in_point_to and out_point_to: move the layers together so the earliest In point (or latest Out point) lands on the time. Default false' },
                frames: { type: 'integer', minimum: -100000, maximum: 100000, description: 'offset, stagger, slip: frames (negative is earlier)' },
                seconds: { type: 'number', description: 'offset, stagger, slip: seconds instead of frames' },
            },
            required: ['layers', 'mode'],
        },
        auditArgs: { mode: 'in_point_to', at: 'comp_start', seconds: undefined },
        features: [
            'aftereffects.layers.move_in_point_to_current_time',
            'aftereffects.layers.move_out_point_to_current_time',
            'aftereffects.layers.move_set_earliest_in_point',
            'aftereffects.layers.move_set_latest_out_point',
            'aftereffects.layers.move_in_point_to_comp_start',
            'aftereffects.layers.move_out_point_to_comp_end',
            'aftereffects.layers.nudge_layer_one_frame',
            'aftereffects.layers.nudge_layer_ten_frames',
            'aftereffects.layers.quick_offset',
            'aftereffects.layers.slip_edit',
        ],
        handler: (a) => {
            const mode = enumOf(a.mode, MOVE_MODES, { name: 'mode' });
            let body;
            if (mode === 'in_point_to' || mode === 'out_point_to') {
                const key = mode === 'in_point_to' ? 'inPoint' : 'outPoint';
                body = `var t = ${atTime(a.at)}, ref = ls[0].${key};
for (i = 1; i < ls.length; i++) ref = ${key === 'inPoint' ? 'Math.min' : 'Math.max'}(ref, ls[i].${key});
for (i = 0; i < ls.length; i++) ls[i].startTime += ${a.asSet ? 't - ref' : `t - ls[i].${key}`};`;
            } else {
                if ((a.frames === undefined) === (a.seconds === undefined)) throw new Error(`'${mode}' needs frames or seconds (one of them)`);
                const step = a.frames !== undefined ? `${index(Math.abs(a.frames), { name: 'frames', max: 100000 })} * ${a.frames < 0 ? -1 : 1} * c.frameDuration` : num(a.seconds, { min: -100000, max: 100000, name: 'seconds' });
                body = {
                    offset: `for (i = 0; i < ls.length; i++) ls[i].startTime += ${step};`,
                    stagger: `for (i = 0; i < ls.length; i++) ls[i].startTime += i * (${step});`,
                    slip: `for (i = 0; i < ls.length; i++) {
  var l = ls[i], i0 = l.inPoint, o0 = l.outPoint;
  l.startTime += ${step};
  l.inPoint = i0; l.outPoint = o0;
}`,
                }[mode];
            }
            return run('Move layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), i;
for (i = 0; i < ls.length; i++) if (ls[i].locked) throw new Error(ls[i].name + " is locked");
${body}
${RESULT}`, { undo: 'Move layers' }));
        },
    },
    {
        name: 'split_layers',
        description: 'Split layers at a time (Edit > Split Layer): each becomes two layers, the original ending at the time and a duplicate above it starting there, both keeping all keyframes',
        inputSchema: {
            type: 'object',
            properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, at: AT_SCHEMA },
            required: ['layers'],
        },
        auditArgs: { at: 1.5 },
        features: ['aftereffects.layers.split_layer'],
        handler: (a) => run('Split layers', script(`
var c = __comp(${compSpec(a.comp)}), src = __layers(c, ${layerSpec(a.layers)}), t = ${atTime(a.at)}, ls = [], skipped = [];
for (var i = 0; i < src.length; i++) {
  var l = src[i];
  if (l.locked) throw new Error(l.name + " is locked");
  if (t <= l.inPoint || t >= l.outPoint) { skipped.push(l.name); continue; }
  var d = l.duplicate();
  l.outPoint = t;
  d.inPoint = t;
  ls.push(l); ls.push(d);
}
var out = [];
for (var k = 0; k < ls.length; k++) out.push(__layerInfo(ls[k]));
__result__ = { layers: out, skipped: skipped };`, { undo: 'Split layer' })),
    },
    {
        name: 'reframe_layers',
        description: 'Fit, centre or flip layers (Layer > Transform): Fit to Comp, Fit to Comp Width, Fit to Comp Height, Center In View, Center Anchor Point in Layer Content, Flip Horizontal, Flip Vertical. The fit and centre commands select the layers and make their composition active',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                action: { type: 'string', enum: REFRAME_ACTIONS, description: 'What to do' },
            },
            required: ['layers', 'action'],
        },
        features: [
            'aftereffects.layers.fit_to_comp',
            'aftereffects.layers.fit_to_comp_width',
            'aftereffects.layers.fit_to_comp_height',
            'aftereffects.layers.center_in_view',
            'aftereffects.layers.center_anchor_point',
            'aftereffects.layers.flip_horizontal',
            'aftereffects.layers.flip_vertical',
        ],
        handler: (a) => {
            const action = enumOf(a.action, REFRAME_ACTIONS, { name: 'action' });
            let body;
            if (action.startsWith('flip_')) {
                // Mirror around the anchor point by negating one Scale component, at every keyframe if animated.
                const axis = action === 'flip_horizontal' ? 0 : 1;
                body = `for (var i = 0; i < ls.length; i++) {
  var p = ls[i].property("ADBE Transform Group").property("ADBE Scale"), v, k;
  if (p.numKeys > 0) for (k = 1; k <= p.numKeys; k++) { v = p.keyValue(k); v[${axis}] = -v[${axis}]; p.setValueAtKey(k, v); }
  else { v = p.value; v[${axis}] = -v[${axis}]; p.setValue(v); }
}`;
            } else {
                body = `${SELECT_ONLY}
__selectOnly(c, ls);
app.executeCommand(${REFRAME_COMMANDS[action]});`;
            }
            return run('Reframe layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
${body}
${RESULT}`, { undo: 'Reframe layers' }));
        },
    },
    {
        name: 'replace_layer_source',
        description: 'Replace layers\' source with another footage item or composition (Alt/Option-drag in the Project panel), keeping their properties, effects and keyframes',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                item: { type: 'integer', minimum: 1, description: 'The new source: a project item id (from list_items)' },
                fixExpressions: { type: 'boolean', description: 'Update expressions that refer to the old source name. Default true', default: true },
            },
            required: ['layers', 'item'],
        },
        hints: { idempotent: true },
        features: ['aftereffects.layers.replace_layer_source'],
        handler: (a) => run('Replace layer source', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), it = proj.itemByID(${index(a.item, { name: 'item' })});
if (!(it instanceof AVItem)) throw new Error("item must be footage or a composition");
if (it.id === c.id) throw new Error("A composition cannot contain itself");
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof AVLayer) || !ls[i].source) throw new Error(ls[i].name + " has no source to replace");
  ls[i].replaceSource(it, ${bool(a.fixExpressions ?? true)});
}
${RESULT}`, { undo: 'Replace layer source' })),
    },
    {
        name: 'set_solid_settings',
        description: 'Change a solid layer\'s solid (Layer > Solid Settings): name, colour and size, either for every layer that uses the solid (Affect All Layers That Use This Solid) or for these layers only, through a new solid',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                name: { type: 'string', description: 'Solid name' },
                color: COLOR_SCHEMA,
                width: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels' },
                height: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels' },
                affectAllLayers: { type: 'boolean', description: 'Change the solid itself, so every layer using it changes (default true); false gives these layers a new solid', default: true },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        auditArgs: { color: '#FF8800' },
        features: ['aftereffects.layers.solid_settings'],
        handler: (a) => {
            if (a.name === undefined && a.color === undefined && a.width === undefined && a.height === undefined) throw new Error('Give name, color, width or height');
            const name = a.name !== undefined ? str(a.name) : null;
            const color = a.color !== undefined ? colorValue(a.color) : null;
            const w = a.width !== undefined ? index(a.width, { name: 'width', max: 30000 }) : null;
            const h = a.height !== undefined ? index(a.height, { name: 'height', max: 30000 }) : null;
            const edit = [
                name ? `s.name = ${name};` : '',
                color ? `s.mainSource.color = ${color};` : '',
                w ? `s.width = ${w};` : '',
                h ? `s.height = ${h};` : '',
            ].filter(Boolean).join('\n  ');
            const fresh = `var nl = c.layers.addSolid(${color ?? 's.mainSource.color'}, ${name ?? 's.name'}, ${w ?? 's.width'}, ${h ?? 's.height'}, s.pixelAspect, 1);
  var ns = nl.source; nl.remove();
  l.replaceSource(ns, false);`;
            return run('Solid settings', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var l = ls[i], s = (l instanceof AVLayer) ? l.source : null;
  if (!(s instanceof FootageItem) || !(s.mainSource instanceof SolidSource)) throw new Error(l.name + " is not a solid, adjustment or null layer");
  ${a.affectAllLayers === false ? fresh : edit}
}
${RESULT}`, { undo: 'Solid settings' }));
        },
    },
    {
        name: 'set_layer_styles',
        description: 'Add Photoshop-style layer styles (Layer > Layer Styles: Drop Shadow, Inner Shadow, Outer Glow, Inner Glow, Bevel and Emboss, Satin, Color Overlay, Gradient Overlay, Stroke), Remove All, Convert to Editable Styles, and set Blending Options (Global Light, Fill Opacity, channels, Blend Interior Styles as Group, Use Blend Ranges from Source). The style commands select the layers and make their composition active; set each style\'s own values with set_property',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                removeAll: { type: 'boolean', description: 'First remove every layer style (Remove All)' },
                convertToEditable: { type: 'boolean', description: 'Turn styles merged from a Photoshop layer into editable styles (Convert to Editable Styles)' },
                add: { type: 'array', items: { type: 'string', enum: Object.keys(STYLES) }, maxItems: 9, description: 'Styles to add' },
                blending: {
                    type: 'object',
                    description: 'Blending Options (present once a layer has a style)',
                    properties: {
                        globalLightAngle: { type: 'number', description: 'Degrees' },
                        globalLightAltitude: { type: 'number', minimum: 0, maximum: 90, description: 'Degrees' },
                        fillOpacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent: fades the contents but not the styles' },
                        red: { type: 'boolean', description: 'Red channel takes part in blending' },
                        green: { type: 'boolean', description: 'Green channel takes part in blending' },
                        blue: { type: 'boolean', description: 'Blue channel takes part in blending' },
                        blendInteriorStylesAsGroup: { type: 'boolean', description: 'Interior styles use the layer blending mode' },
                        useBlendRangesFromSource: { type: 'boolean', description: 'Use the blend ranges stored in the Photoshop source' },
                    },
                },
            },
            required: ['layers'],
        },
        auditArgs: { add: ['drop_shadow', 'satin'], blending: { fillOpacity: 40, red: false, globalLightAngle: 120 } },
        features: [
            'aftereffects.layers.layer_style_drop_shadow',
            'aftereffects.layers.layer_style_inner_shadow',
            'aftereffects.layers.layer_style_outer_glow',
            'aftereffects.layers.layer_style_inner_glow',
            'aftereffects.layers.layer_style_bevel_and_emboss',
            'aftereffects.layers.layer_style_satin',
            'aftereffects.layers.layer_style_color_overlay',
            'aftereffects.layers.layer_style_gradient_overlay',
            'aftereffects.layers.layer_style_stroke',
            'aftereffects.layers.convert_to_editable_styles',
            'aftereffects.layers.remove_all_layer_styles',
            'aftereffects.layers.layer_style_blending_options',
            'aftereffects.layers.layer_style_fill_opacity',
            'aftereffects.layers.blend_interior_styles_as_group',
            'aftereffects.layers.use_blend_ranges_from_source',
            'aftereffects.layers.exclude_channels_from_blending',
        ],
        handler: (a) => {
            const add = (a.add ?? []).map((s, i) => STYLES[enumOf(s, Object.keys(STYLES), { name: `add[${i}]` })]);
            const blend = Object.entries(a.blending ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => {
                const spec = BLENDING[enumOf(k, Object.keys(BLENDING), { name: 'blending' })];
                const value = spec.length === 3 ? Number(num(v, { min: spec[1], max: spec[2], name: `blending.${k}` })) : (v ? 1 : 0);
                return { name: k, path: spec[0], value };
            });
            if (!add.length && !blend.length && !a.removeAll && !a.convertToEditable) throw new Error('Give add, blending, removeAll or convertToEditable');
            const commands = [];
            if (a.removeAll) commands.push('app.executeCommand(2072);');
            if (a.convertToEditable) commands.push('var ce = app.findMenuCommandId("Convert to Editable Styles"); app.executeCommand(ce ? ce : 3740);');
            for (const s of add) {
                commands.push(s.unique
                    ? `var sid = app.findMenuCommandId(${str(s.menu)}); app.executeCommand(sid ? sid : ${s.id});`
                    : `app.executeCommand(${s.id});`);
            }
            return run('Layer styles', script(`${SELECT_ONLY}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), blend = ${json(blend)}, i, k;
var __styles = function (l) { var g = l.property("ADBE Layer Styles"); if (!g) g = l.property("Layer Styles"); return g; };
for (i = 0; i < ls.length; i++) if (!(ls[i] instanceof AVLayer) || !__styles(ls[i])) throw new Error(ls[i].name + " cannot take layer styles");
${commands.length ? `${add.some((s) => !s.unique) ? `// Drop Shadow, Bevel and Emboss and Stroke share their names with effects, so check the numbering through Satin.
var check = app.findMenuCommandId("Satin");
if (check && check !== 9005) throw new Error("This After Effects numbers the Layer Styles commands differently; add the style from Layer > Layer Styles");` : ''}
__selectOnly(c, ls);
${commands.join('\n')}` : ''}
var out = [];
for (i = 0; i < ls.length; i++) {
  var g = __styles(ls[i]), info = { layer: ls[i].index, styles: [] };
  var names = ${json(Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.match])))};
  for (var sn in names) { if (!names.hasOwnProperty(sn)) continue; var sg = g.property(names[sn]); if (sg && sg.enabled) info.styles.push(sn); }
  if (blend.length) {
    var bo = g.property("ADBE Blend Options Group");
    if (!bo) throw new Error(ls[i].name + ": Blending Options appear once the layer has a layer style; add one first");
    for (k = 0; k < blend.length; k++) {
      var p = bo;
      for (var d = 0; d < blend[k].path.length; d++) { p = p.property(blend[k].path[d]); if (!p) throw new Error(ls[i].name + " has no Blending Options property for " + blend[k].name); }
      if (p.numKeys > 0) p.setValueAtTime(c.time, blend[k].value); else p.setValue(blend[k].value);
    }
  }
  out.push(info);
}
__result__ = { layers: out };`, { undo: 'Layer styles' }));
        },
    },
    {
        name: 'choose_layer_tool',
        description: 'Choose a layer tool in the Tools panel: Rotation, Pan Behind (Anchor Point) or Selection, for the user\'s next drag in the Composition panel. To rotate or move an anchor point from here, use set_transform',
        inputSchema: {
            type: 'object',
            properties: { tool: { type: 'string', enum: Object.keys(LAYER_TOOLS), description: 'rotation, pan_behind or selection' } },
            required: ['tool'],
        },
        hints: { idempotent: true },
        features: ['aftereffects.layers.rotation_tool', 'aftereffects.layers.pan_behind_tool'],
        // ToolType's members are mixed case (Tool_Rotate), which the static audit does not read from the typings, so they are indexed by name.
        handler: (a) => run('Choose tool', script(`
proj.toolType = ToolType[${str(LAYER_TOOLS[enumOf(a.tool, Object.keys(LAYER_TOOLS), { name: 'tool' })])}];
__result__ = { tool: ${str(a.tool)} };`)),
    },
];
