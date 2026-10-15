/**
 * Adjustment and fill layers: create them with their settings (Layer > New
 * Adjustment Layer, Layer > New Fill Layer, the Adjustments panel) and change
 * the settings later (the Properties panel). Neither the object model nor its
 * typings can create these layers, so the Action Manager does: make with a
 * class reference and a `using` descriptor, then set on the targeted layer.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { BLEND_MODES } from './layers.js';
import { AM_HELPERS, amCall, t, targetRef } from '../am.js';
import { TYPES, FILL_TYPES, typeEntries } from '../adjustment-types.js';

const LAYER_OPTIONS = {
    name: { type: 'string', description: 'Layer name. Default Photoshop\'s (e.g. "Levels 1")' },
    opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Layer opacity, percent' },
    blendMode: { type: 'string', enum: Object.keys(BLEND_MODES), description: 'Blend mode' },
    clip: { type: 'boolean', description: 'Use Previous Layer to Create Clipping Mask: affect only the layer below' },
};

/** Statements that set the new or edited layer `l`'s name, opacity, blend mode and clipping. */
function layerLines(a) {
    const lines = [];
    if (a.name !== undefined) lines.push(`l.name = ${str(a.name)};`);
    if (a.opacity !== undefined) lines.push(`l.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
    if (a.blendMode !== undefined) lines.push(`l.blendMode = BlendMode.${BLEND_MODES[enumOf(a.blendMode, Object.keys(BLEND_MODES), { name: 'blendMode' })]};`);
    if (a.clip !== undefined) lines.push(`if (l.grouped !== ${bool(a.clip)}) l.grouped = ${bool(a.clip)};`);
    return lines;
}

/** Help text listing each type's options. */
const optionsHelp = (table) => Object.entries(table).map(([k, s]) => `${k}${Object.keys(s.options).length ? ` (${Object.keys(s.options).join(', ')})` : ''}`).join('; ');

/** Create a layer of `layerClass` (adjustmentLayer or contentLayer) holding a `spec` with `entries`. */
function createScript(layerClass, spec, entries, a) {
    const type = spec.classOnly ? t.cls(spec.cls) : t.obj(spec.cls, entries);
    const set = !spec.classOnly && entries.length
        ? `${amCall('set', [['null', targetRef(layerClass)], ['to', t.obj(spec.cls, entries)]])};`
        : '';
    return script(`${AM_HELPERS}
${a.above !== undefined ? `doc.activeLayer = __targets(doc, ${targetSpec(a.above)})[0];` : ''}
${amCall('make', [['null', t.ref([['class', layerClass]])], ['using', t.obj(layerClass, [['type', type]])]])};
var l = doc.activeLayer;
${set}
${layerLines(a).join('\n')}
__result__ = __layerInfo(l);`);
}

/** Apply `entries` to each target layer of the right kind. */
function editScript(layerClass, spec, type, entries, a) {
    return script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
var before = doc.activeLayer;
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename !== "ArtLayer" || l.kind !== LayerKind.${spec.kind}) throw new Error(l.name + " is not a " + ${json(type.replace(/_/g, ' '))} + " layer");
  doc.activeLayer = l;
  ${entries.length ? `${amCall('set', [['null', targetRef(layerClass)], ['to', t.obj(spec.cls, entries)]])};` : ''}
  ${layerLines(a).join('\n  ')}
}
doc.activeLayer = before;
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`);
}

const ADJ_FEATURES = [
    'photoshop.adjustments.adjustment_layer', 'photoshop.adjustments.new_adjustment_layer', 'photoshop.adjustments.create_new_fill_or_adjustment_layer',
    'photoshop.adjustments.properties_panel_adjustments_option.use_previous_layer_to_create_clipping_mask',
];
const OPTION_FEATURES = [
    'photoshop.adjustments.brightness_contrast_option.use_legacy', 'photoshop.adjustments.levels_option.channel', 'photoshop.adjustments.levels_option.auto',
    'photoshop.adjustments.exposure_option.exposure', 'photoshop.adjustments.exposure_option.offset', 'photoshop.adjustments.exposure_option.gamma',
    'photoshop.adjustments.vibrance_option.vibrance', 'photoshop.adjustments.vibrance_option.saturation',
    'photoshop.adjustments.hue_saturation_option.master', 'photoshop.adjustments.hue_saturation_option.hue', 'photoshop.adjustments.hue_saturation_option.saturation',
    'photoshop.adjustments.hue_saturation_option.lightness', 'photoshop.adjustments.hue_saturation_option.colorize', 'photoshop.adjustments.hue_saturation_option.color_range',
    'photoshop.adjustments.black_and_white_option.tint', 'photoshop.adjustments.black_and_white_option.color_sliders', 'photoshop.adjustments.photo_filter_option.filter',
    'photoshop.adjustments.channel_mixer_option.monochrome', 'photoshop.adjustments.selective_color_option.relative', 'photoshop.adjustments.selective_color_option.absolute',
    'photoshop.adjustments.gradient_map_option.dither', 'photoshop.adjustments.gradient_map_option.reverse',
];
const GRADIENT_FEATURES = [
    'photoshop.color.gradient_editor', 'photoshop.color.gradient_editor_option.solid', 'photoshop.color.gradient_editor_option.noise', 'photoshop.color.gradient_editor_option.transparency',
    'photoshop.color.gradient_editor_option.roughness', 'photoshop.color.gradient_editor_option.color_model', 'photoshop.color.gradient_editor_option.restrict_colors',
    'photoshop.color.gradient_editor_option.add_transparency', 'photoshop.color.gradient_editor_option.randomize', 'photoshop.color.gradient_editor_option.perceptual',
    'photoshop.color.gradient_editor_option.linear', 'photoshop.color.gradient_editor_option.classic', 'photoshop.color.gradient_interpolation',
];
const typeFeatures = (table) => Object.values(table).flatMap((s) => s.features);
const EDITABLE = Object.fromEntries(Object.entries(TYPES).filter(([, s]) => s.kind && !s.classOnly));

const OPTIONS_SCHEMA = (what) => ({ type: 'object', description: `Settings for the chosen ${what}; see the list in this tool's description. Omitted settings use Photoshop's defaults` });

export const tools = [
    {
        name: 'create_adjustment_layer',
        description: `Add an adjustment layer above the active layer (Layer > New Adjustment Layer, or the Adjustments panel), with its settings, optionally clipped to the layer below. Adjustment layers change the look of the layers beneath without changing their pixels. Options by type: ${optionsHelp(TYPES)}. Color Lookup, Clarity and Dehaze and Grain are created with Photoshop's defaults; choose their settings in the Properties panel.`,
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: Object.keys(TYPES), description: 'Adjustment type' },
                options: OPTIONS_SCHEMA('type'),
                above: { ...TARGET_SCHEMA, description: 'Add it above this layer (the first match) instead of the active layer' },
                ...LAYER_OPTIONS,
            },
            required: ['type'],
        },
        auditArgs: { above: undefined, options: {} },
        features: [...ADJ_FEATURES, ...typeFeatures(TYPES), ...OPTION_FEATURES, ...GRADIENT_FEATURES],
        handler: (a) => {
            const type = enumOf(a.type, Object.keys(TYPES), { name: 'type' });
            const spec = TYPES[type];
            const entries = typeEntries(spec, a.options, type);
            return run('Create adjustment layer', createScript('adjustmentLayer', spec, entries, a));
        },
    },
    {
        name: 'edit_adjustment_layer',
        description: `Change the settings of existing adjustment layers (the Properties panel). Only the options given change; the rest keep their values. Also sets name, opacity, blend mode and clipping. Options by type: ${optionsHelp(EDITABLE)}.`,
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Adjustment layers of the given type' },
                type: { type: 'string', enum: Object.keys(EDITABLE), description: 'Their adjustment type' },
                options: OPTIONS_SCHEMA('type'),
                ...LAYER_OPTIONS,
            },
            required: ['target', 'type'],
        },
        auditArgs: { target: { ids: [12] }, type: 'levels', options: { gamma: 1.2 }, name: undefined },
        hints: { idempotent: true },
        features: ['photoshop.adjustments.adjustment_layer', 'photoshop.adjustments.properties_panel_adjustments_option.use_previous_layer_to_create_clipping_mask', ...typeFeatures(EDITABLE), ...OPTION_FEATURES, ...GRADIENT_FEATURES],
        handler: (a) => {
            const type = enumOf(a.type, Object.keys(EDITABLE), { name: 'type' });
            const spec = EDITABLE[type];
            const entries = typeEntries(spec, a.options, type, { partial: true });
            if (!entries.length && !layerLines(a).length) throw new Error('Give options or a layer property to change');
            if (a.name !== undefined && (a.target?.ids?.length ?? 0) + (a.target?.names?.length ?? 0) + (a.target?.active ? 1 : 0) > 1) throw new Error('Rename one layer at a time');
            return run('Edit adjustment layer', editScript('adjustmentLayer', spec, type, entries, a));
        },
    },
    {
        name: 'create_fill_layer',
        description: `Add a fill layer above the active layer (Layer > New Fill Layer): a solid colour, a gradient (defined as in the Gradient Editor) or a pattern, optionally clipped to the layer below. Options by type: ${optionsHelp(FILL_TYPES)}.`,
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: Object.keys(FILL_TYPES), description: 'Fill type' },
                options: OPTIONS_SCHEMA('fill. solid_color needs color; pattern needs pattern (a name)'),
                above: { ...TARGET_SCHEMA, description: 'Add it above this layer (the first match) instead of the active layer' },
                ...LAYER_OPTIONS,
            },
            required: ['type'],
        },
        auditArgs: { above: undefined, options: { color: '#336699' } },
        features: ['photoshop.adjustments.create_new_fill_or_adjustment_layer', ...typeFeatures(FILL_TYPES), ...GRADIENT_FEATURES],
        handler: (a) => {
            const type = enumOf(a.type, Object.keys(FILL_TYPES), { name: 'type' });
            const entries = typeEntries(FILL_TYPES[type], a.options, type);
            return run('Create fill layer', createScript('contentLayer', FILL_TYPES[type], entries, a));
        },
    },
    {
        name: 'edit_fill_layer',
        description: `Change existing fill layers: colour, gradient and its placement, or pattern (double-clicking the layer thumbnail). Only the options given change. Options by type: ${optionsHelp(FILL_TYPES)}.`,
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Fill layers of the given type' },
                type: { type: 'string', enum: Object.keys(FILL_TYPES), description: 'Their fill type' },
                options: OPTIONS_SCHEMA('fill'),
                ...LAYER_OPTIONS,
            },
            required: ['target', 'type'],
        },
        auditArgs: { target: { ids: [12] }, type: 'gradient', options: { angle: 45, style: 'radial' }, name: undefined },
        hints: { idempotent: true },
        features: [...typeFeatures(FILL_TYPES), ...GRADIENT_FEATURES],
        handler: (a) => {
            const type = enumOf(a.type, Object.keys(FILL_TYPES), { name: 'type' });
            const spec = FILL_TYPES[type];
            const entries = typeEntries(spec, a.options, type, { partial: true });
            if (!entries.length && !layerLines(a).length) throw new Error('Give options or a layer property to change');
            if (a.name !== undefined && (a.target?.ids?.length ?? 0) + (a.target?.names?.length ?? 0) + (a.target?.active ? 1 : 0) > 1) throw new Error('Rename one layer at a time');
            return run('Edit fill layer', editScript('contentLayer', spec, type, entries, a));
        },
    },
];
