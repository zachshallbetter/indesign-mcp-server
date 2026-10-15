/**
 * Layers: list, add every layer type, set switches and timing, transform,
 * parent, track mattes, arrange, duplicate and delete.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

const LAYER_TYPES = ['solid', 'null', 'adjustment', 'text', 'shape', 'camera', 'light', 'item'];
const BLEND = [
    'NORMAL', 'DISSOLVE', 'DANCING_DISSOLVE', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'CLASSIC_COLOR_BURN', 'LINEAR_BURN', 'DARKER_COLOR',
    'ADD', 'LIGHTEN', 'SCREEN', 'COLOR_DODGE', 'CLASSIC_COLOR_DODGE', 'LINEAR_DODGE', 'LIGHTER_COLOR', 'OVERLAY', 'SOFT_LIGHT',
    'HARD_LIGHT', 'LINEAR_LIGHT', 'VIVID_LIGHT', 'PIN_LIGHT', 'HARD_MIX', 'DIFFERENCE', 'CLASSIC_DIFFERENCE', 'EXCLUSION', 'SUBTRACT',
    'DIVIDE', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY', 'STENCIL_ALPHA', 'STENCIL_LUMA', 'SILHOUETE_ALPHA', 'SILHOUETTE_LUMA',
    'ALPHA_ADD', 'LUMINESCENT_PREMUL',
];
/** The blending mode features set_layer_properties covers, one per BLEND value. */
const BLEND_FEATURES = BLEND.map((b) => `aftereffects.layers.blending_mode_${b === 'SILHOUETE_ALPHA' ? 'silhouette_alpha' : b.toLowerCase()}`);
const MATTES = { alpha: 'ALPHA', alpha_inverted: 'ALPHA_INVERTED', luma: 'LUMA', luma_inverted: 'LUMA_INVERTED', none: 'NO_TRACK_MATTE' };
const QUALITY = { best: 'BEST', draft: 'DRAFT', wireframe: 'WIREFRAME' };
const LIGHTS = { parallel: 'PARALLEL', spot: 'SPOT', point: 'POINT', ambient: 'AMBIENT' };

const RESULT = `
var out = [];
for (var k = 0; k < ls.length; k++) out.push(__layerInfo(ls[k]));
__result__ = { layers: out };`;

export const tools = [
    {
        name: 'list_layers',
        description: 'List a composition\'s layers, top to bottom, with index, id, type, switches, timing, parent, blending mode and track matte. Indexes are what other tools take',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA } },
        hints: { readOnly: true },
        features: ['aftereffects.layers.layer_collection_object', 'aftereffects.layers.layer_object'],
        handler: (a) => run('List layers', script(`
var c = __comp(${compSpec(a.comp)}), out = [];
for (var i = 1; i <= c.numLayers; i++) out.push(__layerInfo(c.layer(i)));
var sel = [];
for (var s = 0; s < c.selectedLayers.length; s++) sel.push(c.selectedLayers[s].index);
__result__ = { comp: __itemInfo(c), selected: sel, layers: out };`)),
    },
    {
        name: 'add_layer',
        description: 'Add a layer (Layer > New): solid, null, adjustment, text, shape, camera or light, or a project item (footage or composition) as a layer, at the top of the composition',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                type: { type: 'string', enum: LAYER_TYPES },
                name: { type: 'string' },
                item: { type: 'integer', description: 'type item: the project item id to add' },
                color: { ...COLOR_SCHEMA, description: 'Solid and adjustment colour. Default white' },
                width: { type: 'integer', minimum: 1, maximum: 30000, description: 'Solid size; default the composition size' },
                height: { type: 'integer', minimum: 1, maximum: 30000 },
                text: { type: 'string', description: 'type text: the text' },
                lightType: { type: 'string', enum: Object.keys(LIGHTS), description: 'type light. Default point' },
                duration: { type: 'number', minimum: 0.01, description: 'Seconds; default the composition duration' },
            },
            required: ['type'],
        },
        auditArgs: { type: 'solid', color: '#3366FF', item: undefined },
        features: [
            'aftereffects.layers.new_solid',
            'aftereffects.layers.new_null_object',
            'aftereffects.layers.new_adjustment_layer',
            'aftereffects.layers.new_text_layer',
            'aftereffects.layers.new_shape_layer',
            'aftereffects.layers.new_camera',
            'aftereffects.layers.new_light',
            'aftereffects.three_d.light_type',
            'aftereffects.layers.create_layers_from_footage',
            'aftereffects.compositions.nest_composition',
        ],
        handler: (a) => {
            const type = enumOf(a.type, LAYER_TYPES, { name: 'type' });
            if (type === 'item' && a.item === undefined) throw new Error("type item needs 'item'");
            const dur = a.duration !== undefined ? num(a.duration, { min: 0.01, name: 'duration' }) : 'c.duration';
            const make = {
                solid: `c.layers.addSolid(${colorValue(a.color ?? '#FFFFFF')}, ${str(a.name ?? 'Solid')}, ${a.width !== undefined ? index(a.width, { name: 'width', max: 30000 }) : 'c.width'}, ${a.height !== undefined ? index(a.height, { name: 'height', max: 30000 }) : 'c.height'}, c.pixelAspect, ${dur})`,
                adjustment: `(function () { var l = c.layers.addSolid(${colorValue(a.color ?? '#FFFFFF')}, ${str(a.name ?? 'Adjustment Layer')}, c.width, c.height, c.pixelAspect, ${dur}); l.adjustmentLayer = true; return l; })()`,
                null: `c.layers.addNull(${dur})`,
                text: `c.layers.addText(${str(a.text ?? '')})`,
                shape: 'c.layers.addShape()',
                camera: `c.layers.addCamera(${str(a.name ?? 'Camera')}, [c.width / 2, c.height / 2])`,
                light: `(function () { var l = c.layers.addLight(${str(a.name ?? 'Light')}, [c.width / 2, c.height / 2]); l.lightType = LightType.${LIGHTS[enumOf(a.lightType ?? 'point', Object.keys(LIGHTS), { name: 'lightType' })]}; return l; })()`,
                item: `(function () { var it = proj.itemByID(${a.item !== undefined ? index(a.item, { name: 'item' }) : 0}); if (!(it instanceof AVItem)) throw new Error("item must be footage or a composition"); return c.layers.add(it${a.duration !== undefined ? `, ${dur}` : ''}); })()`,
            }[type];
            return run('Add layer', script(`
var c = __comp(${compSpec(a.comp)});
var l = ${make};
${a.name !== undefined && !['solid', 'adjustment', 'camera', 'light'].includes(type) ? `l.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(l);`, { undo: 'Add layer' }));
        },
    },
    {
        name: 'set_layer_properties',
        description: 'Set layer switches and timing: name, enabled (video), audio, solo, shy, lock, 3D, motion blur, adjustment layer, quality, blending mode, label, in and out points, start time, stretch',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                name: { type: 'string' },
                enabled: { type: 'boolean' }, audioEnabled: { type: 'boolean' }, solo: { type: 'boolean' }, shy: { type: 'boolean' }, locked: { type: 'boolean' },
                threeD: { type: 'boolean' }, motionBlur: { type: 'boolean' }, adjustmentLayer: { type: 'boolean' }, guideLayer: { type: 'boolean' },
                quality: { type: 'string', enum: Object.keys(QUALITY) },
                blendingMode: { type: 'string', enum: BLEND.map((b) => b.toLowerCase()) },
                label: { type: 'integer', minimum: 0, maximum: 16 },
                inPoint: { type: 'number', description: 'Seconds' }, outPoint: { type: 'number', description: 'Seconds' },
                startTime: { type: 'number', description: 'Seconds' },
                stretch: { type: 'number', minimum: -10000, maximum: 10000, description: 'Time stretch percent; negative reverses' },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.layers.rename_layer',
            'aftereffects.layers.video_switch',
            'aftereffects.layers.audio_switch',
            'aftereffects.layers.solo_switch',
            'aftereffects.layers.shy_switch',
            'aftereffects.layers.lock_switch',
            'aftereffects.three_d.three_d_layer',
            'aftereffects.layers.motion_blur_switch',
            'aftereffects.layers.adjustment_layer_switch',
            'aftereffects.layers.guide_layer',
            'aftereffects.layers.quality_best',
            'aftereffects.layers.quality_draft',
            'aftereffects.layers.quality_wireframe',
            'aftereffects.layers.blending_mode_menu',
            ...BLEND_FEATURES,
            'aftereffects.layers.layer_label_color',
            'aftereffects.layers.set_in_out_numerically',
            'aftereffects.time.time_stretch',
            'aftereffects.time.time_reverse_layer',
        ],
        handler: (a) => {
            const L = [];
            if (a.name !== undefined) L.push(`l.name = ${str(a.name)};`);
            for (const k of ['enabled', 'audioEnabled', 'solo', 'shy']) if (a[k] !== undefined) L.push(`l.${k} = ${bool(a[k])};`);
            for (const k of ['threeD', 'motionBlur', 'adjustmentLayer', 'guideLayer']) if (a[k] !== undefined) L.push(`if (l instanceof AVLayer) l.${k === 'threeD' ? 'threeDLayer' : k} = ${bool(a[k])};`);
            if (a.quality !== undefined) L.push(`if (l instanceof AVLayer) l.quality = LayerQuality.${QUALITY[enumOf(a.quality, Object.keys(QUALITY), { name: 'quality' })]};`);
            if (a.blendingMode !== undefined) L.push(`if (l instanceof AVLayer) l.blendingMode = BlendingMode.${enumOf(String(a.blendingMode).toUpperCase(), BLEND, { name: 'blendingMode' })};`);
            if (a.label !== undefined) L.push(`l.label = ${index(a.label, { name: 'label', max: 16 })};`);
            if (a.startTime !== undefined) L.push(`l.startTime = ${num(a.startTime, { name: 'startTime' })};`);
            if (a.stretch !== undefined) L.push(`l.stretch = ${num(a.stretch, { min: -10000, max: 10000, name: 'stretch' })};`);
            if (a.inPoint !== undefined) L.push(`l.inPoint = ${num(a.inPoint, { name: 'inPoint' })};`);
            if (a.outPoint !== undefined) L.push(`l.outPoint = ${num(a.outPoint, { name: 'outPoint' })};`);
            // A locked layer cannot change: unlock first, lock last.
            if (a.locked === true) L.push('l.locked = true;');
            if (!L.length && a.locked === undefined) throw new Error('Give at least one property to set');
            L.unshift(a.locked === false ? 'l.locked = false;' : 'var wasLocked = l.locked; l.locked = false;');
            if (a.locked === undefined) L.push('l.locked = wasLocked;');
            return run('Set layer properties', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  ${L.join('\n  ')}
}
${RESULT}`, { undo: 'Set layer properties' }));
        },
    },
    {
        name: 'set_transform',
        description: 'Set layer transform values without keyframes: anchor point, position, scale (percent), rotation (degrees), opacity (percent), and 3D orientation and rotations. Animated properties are set at the current time',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                anchorPoint: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
                position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: 'Pixels from the top-left' },
                scale: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: 'Percent per axis' },
                rotation: { type: 'number' },
                opacity: { type: 'number', minimum: 0, maximum: 100 },
                orientation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '3D layers' },
                xRotation: { type: 'number' }, yRotation: { type: 'number' },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.layers.transform_properties',
            'aftereffects.layers.anchor_point',
            'aftereffects.layers.position_property',
            'aftereffects.layers.scale_property',
            'aftereffects.layers.rotation_property',
            'aftereffects.layers.opacity_property',
        ],
        handler: (a) => {
            const vec = (v, k) => json(v.map((x) => Number(num(x, { name: k }))));
            const L = [];
            const set = (prop, v) => L.push(`__setNow(l.property("ADBE Transform Group").property(${str(prop)}), ${v});`);
            if (a.anchorPoint) set('ADBE Anchor Point', vec(a.anchorPoint, 'anchorPoint'));
            if (a.position) set('ADBE Position', vec(a.position, 'position'));
            if (a.scale) set('ADBE Scale', vec(a.scale, 'scale'));
            if (a.rotation !== undefined) set('ADBE Rotate Z', num(a.rotation, { name: 'rotation' }));
            if (a.opacity !== undefined) set('ADBE Opacity', num(a.opacity, { min: 0, max: 100, name: 'opacity' }));
            if (a.orientation) set('ADBE Orientation', vec(a.orientation, 'orientation'));
            if (a.xRotation !== undefined) set('ADBE Rotate X', num(a.xRotation, { name: 'xRotation' }));
            if (a.yRotation !== undefined) set('ADBE Rotate Y', num(a.yRotation, { name: 'yRotation' }));
            if (!L.length) throw new Error('Give at least one transform value');
            return run('Set transform', script(`
function __setNow(p, v) { if (p.numKeys > 0) p.setValueAtTime(p.propertyGroup(p.propertyDepth).containingComp.time, v); else p.setValue(v); }
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  ${L.join('\n  ')}
}
${RESULT}`, { undo: 'Set transform' }));
        },
    },
    {
        name: 'parent_layers',
        description: 'Parent layers to another layer (or remove the parent), keeping their current position on screen',
        inputSchema: {
            type: 'object',
            properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, parent: { type: 'integer', minimum: 1, description: 'Parent layer index; omit to remove the parent' } },
            required: ['layers'],
        },
        hints: { idempotent: true },
        features: ['aftereffects.layers.parent_layer'],
        handler: (a) => run('Parent layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
var parent = ${a.parent !== undefined ? `c.layer(${index(a.parent, { name: 'parent', max: 10000 })})` : 'null'};
for (var i = 0; i < ls.length; i++) { if (parent === ls[i]) throw new Error("A layer cannot be its own parent"); ls[i].parent = parent; }
${RESULT}`, { undo: 'Parent layers' })),
    },
    {
        name: 'set_track_matte',
        description: 'Use another layer as a layer\'s track matte (alpha, alpha inverted, luma, luma inverted), or remove the matte',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                matteLayer: { type: 'integer', minimum: 1, description: 'Matte layer index' },
                type: { type: 'string', enum: Object.keys(MATTES), description: 'Default alpha; none removes the matte' },
            },
            required: ['layers'],
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.layers.track_matte',
            'aftereffects.layers.track_matte_alpha_matte',
            'aftereffects.layers.track_matte_alpha_inverted_matte',
            'aftereffects.layers.track_matte_luma_matte',
            'aftereffects.layers.track_matte_luma_inverted_matte',
            'aftereffects.layers.track_matte_none',
        ],
        handler: (a) => {
            const type = MATTES[enumOf(a.type ?? 'alpha', Object.keys(MATTES), { name: 'type' })];
            if (type !== 'NO_TRACK_MATTE' && a.matteLayer === undefined) throw new Error("Give matteLayer, or type 'none' to remove the matte");
            return run('Track matte', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
for (var i = 0; i < ls.length; i++) {
  ${type === 'NO_TRACK_MATTE' ? 'ls[i].removeTrackMatte();' : `ls[i].setTrackMatte(c.layer(${index(a.matteLayer ?? 1, { name: 'matteLayer', max: 10000 })}), TrackMatteType.${type});`}
}
${RESULT}`, { undo: 'Track matte' }));
        },
    },
    {
        name: 'arrange_layers',
        description: 'Change the stacking order: move layers to the top, to the bottom, or before or after another layer',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                order: { type: 'string', enum: ['top', 'bottom', 'before', 'after'] },
                relativeTo: { type: 'integer', minimum: 1, description: 'Layer index, for before and after' },
            },
            required: ['layers', 'order'],
        },
        features: [
            'aftereffects.layers.bring_layer_to_front',
            'aftereffects.layers.send_layer_to_back',
            'aftereffects.layers.bring_layer_forward',
            'aftereffects.layers.send_layer_backward',
        ],
        handler: (a) => {
            const order = enumOf(a.order, ['top', 'bottom', 'before', 'after'], { name: 'order' });
            if ((order === 'before' || order === 'after') && a.relativeTo === undefined) throw new Error(`'${order}' needs relativeTo`);
            const move = { top: 'ls[i].moveToBeginning();', bottom: 'ls[i].moveToEnd();', before: 'ls[i].moveBefore(ref);', after: 'ls[i].moveAfter(ref);' }[order];
            return run('Arrange layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)});
${a.relativeTo !== undefined ? `var ref = c.layer(${index(a.relativeTo, { name: 'relativeTo', max: 10000 })});` : ''}
for (var i = 0; i < ls.length; i++) ${move}
${RESULT}`, { undo: 'Arrange layers' }));
        },
    },
    {
        name: 'duplicate_layers',
        description: 'Duplicate layers (Edit > Duplicate), or copy them into another composition',
        inputSchema: {
            type: 'object',
            properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, toComp: { type: 'integer', description: 'Copy into this composition (id) instead' } },
            required: ['layers'],
        },
        features: ['aftereffects.layers.duplicate_layer'],
        handler: (a) => run('Duplicate layers', script(`
var c = __comp(${compSpec(a.comp)}), src = __layers(c, ${layerSpec(a.layers)}), ls = [];
${a.toComp !== undefined ? `var dest = __comp({ id: ${index(a.toComp, { name: 'toComp' })} });
for (var i = src.length - 1; i >= 0; i--) { src[i].copyToComp(dest); ls.push(dest.layer(1)); }` : 'for (var i = 0; i < src.length; i++) ls.push(src[i].duplicate());'}
${RESULT}`, { undo: 'Duplicate layers' })),
    },
    {
        name: 'delete_layers',
        description: 'Delete layers from a composition',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA }, required: ['layers'] },
        hints: { destructive: true },
        features: ['aftereffects.application.clear'],
        handler: (a) => run('Delete layers', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), names = [];
for (var i = ls.length - 1; i >= 0; i--) { names.push(ls[i].name); ls[i].locked = false; ls[i].remove(); }
__result__ = { deleted: names, remaining: c.numLayers };`, { undo: 'Delete layers' })),
    },
];
