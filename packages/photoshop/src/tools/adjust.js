/**
 * Image adjustments and filters on pixel layers, through the object model's
 * ArtLayer.adjust... and ArtLayer.apply... methods. Both act on the selected
 * area when there is a selection, otherwise on the whole layer.
 */
import { num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { MORE_FILTERS, PRESERVE, choice, preserveShape } from './filters.js';

const n = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description ? { description } : {}) });
const triple = (description) => ({ type: 'array', items: { type: 'number', minimum: -100, maximum: 100 }, minItems: 3, maxItems: 3, description });

/**
 * Each adjustment: the atlas features it performs, its options (with defaults)
 * and the call it makes on `l`. `v(name)` returns the checked option as a
 * script literal.
 */
export const ADJUSTMENTS = {
    brightness_contrast: { features: ['photoshop.adjustments.brightness_contrast', 'photoshop.adjustments.brightness_contrast_option.brightness', 'photoshop.adjustments.brightness_contrast_option.contrast'], options: { brightness: [n(-150, 150), 0], contrast: [n(-50, 100), 0] }, call: (v) => `l.adjustBrightnessContrast(${v('brightness')}, ${v('contrast')})` },
    levels: {
        features: ['photoshop.adjustments.levels', 'photoshop.adjustments.levels_option.input_levels', 'photoshop.adjustments.levels_option.output_levels'],
        options: { inputBlack: [n(0, 253), 0], inputWhite: [n(2, 255), 255], gamma: [n(0.1, 9.99), 1], outputBlack: [n(0, 255), 0], outputWhite: [n(0, 255), 255] },
        call: (v) => `l.adjustLevels(${v('inputBlack')}, ${v('inputWhite')}, ${v('gamma')}, ${v('outputBlack')}, ${v('outputWhite')})`,
    },
    curves: { features: ['photoshop.adjustments.curves'], options: { points: [{ type: 'array', items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2 }, minItems: 2, description: '[[input, output], ...], 0-255, e.g. [[0,0],[128,160],[255,255]]' }, null] }, call: (v) => `l.adjustCurves(${v('points')})` },
    color_balance: {
        features: ['photoshop.adjustments.color_balance', 'photoshop.adjustments.color_balance_option.tone', 'photoshop.adjustments.color_balance_option.color_sliders', 'photoshop.adjustments.color_balance_option.preserve_luminosity'],
        options: { shadows: [triple('Cyan-red, magenta-green, yellow-blue, -100 to 100'), [0, 0, 0]], midtones: [triple(), [0, 0, 0]], highlights: [triple(), [0, 0, 0]], preserveLuminosity: [{ type: 'boolean' }, true] },
        call: (v) => `l.adjustColorBalance(${v('shadows')}, ${v('midtones')}, ${v('highlights')}, ${v('preserveLuminosity')})`,
    },
    photo_filter: { features: ['photoshop.adjustments.photo_filter', 'photoshop.adjustments.photo_filter_option.color', 'photoshop.adjustments.photo_filter_option.density', 'photoshop.adjustments.photo_filter_option.preserve_luminosity'], options: { color: [COLOR_SCHEMA, '#EC8A00'], density: [n(1, 100), 25], preserveLuminosity: [{ type: 'boolean' }, true] }, call: (v) => `l.photoFilter(${v('color')}, ${v('density')}, ${v('preserveLuminosity')})` },
    shadows_highlights: {
        features: ['photoshop.adjustments.shadows_highlights', 'photoshop.adjustments.shadows_highlights_option.amount', 'photoshop.adjustments.shadows_highlights_option.tonal_width', 'photoshop.adjustments.shadows_highlights_option.radius', 'photoshop.adjustments.shadows_highlights_option.midtone_contrast'],
        options: { shadowAmount: [n(0, 100), 35], highlightAmount: [n(0, 100), 0], shadowWidth: [n(0, 100), 50], highlightWidth: [n(0, 100), 50], shadowRadius: [n(0, 2500), 30], highlightRadius: [n(0, 2500), 30], colorCorrection: [n(-100, 100), 20], midtoneContrast: [n(-100, 100), 0] },
        call: (v) => `l.shadowHighlight(${v('shadowAmount')}, ${v('shadowWidth')}, ${v('shadowRadius')}, ${v('highlightAmount')}, ${v('highlightWidth')}, ${v('highlightRadius')}, ${v('colorCorrection')}, ${v('midtoneContrast')})`,
    },
    posterize: { features: ['photoshop.adjustments.posterize', 'photoshop.adjustments.posterize_option.levels'], options: { levels: [n(2, 255), 4] }, call: (v) => `l.posterize(${v('levels')})` },
    threshold: { features: ['photoshop.adjustments.threshold', 'photoshop.adjustments.threshold_option.threshold_level'], options: { level: [n(1, 255), 128] }, call: (v) => `l.threshold(${v('level')})` },
    desaturate: { features: ['photoshop.adjustments.desaturate'], options: {}, call: () => 'l.desaturate()' },
    invert: { features: ['photoshop.adjustments.invert'], options: {}, call: () => 'l.invert()' },
    equalize: { features: ['photoshop.adjustments.equalize'], options: {}, call: () => 'l.equalize()' },
    auto_levels: { features: ['photoshop.adjustments.auto_tone'], options: {}, call: () => 'l.autoLevels()' },
    auto_contrast: { features: ['photoshop.adjustments.auto_contrast'], options: {}, call: () => 'l.autoContrast()' },
};

const DISTRIBUTION = { uniform: 'UNIFORM', gaussian: 'GAUSSIAN' };

export const FILTERS = {
    gaussian_blur: { features: ['photoshop.filters.gaussian_blur', 'photoshop.filters.gaussian_blur_option.radius'], options: { radius: [n(0.1, 1000), 2] }, call: (v) => `l.applyGaussianBlur(${v('radius')})` },
    motion_blur: { features: ['photoshop.filters.motion_blur', 'photoshop.filters.motion_blur_option.angle', 'photoshop.filters.motion_blur_option.distance'], options: { angle: [n(-360, 360), 0], distance: [n(1, 2000), 10] }, call: (v) => `l.applyMotionBlur(${v('angle')}, ${v('distance')})` },
    smart_blur: {
        features: ['photoshop.filters.smart_blur', 'photoshop.filters.smart_blur_option.radius', 'photoshop.filters.smart_blur_option.threshold', 'photoshop.filters.smart_blur_option.quality', 'photoshop.filters.smart_blur_option.mode', 'photoshop.filters.smart_blur_option.edge_only', 'photoshop.filters.smart_blur_option.overlay_edge'],
        options: { radius: [n(0.1, 100), 3], threshold: [n(0.1, 100), 25], quality: choice({ low: 'SmartBlurQuality.LOW', medium: 'SmartBlurQuality.MEDIUM', high: 'SmartBlurQuality.HIGH' }, 'medium', 'Quality'), mode: choice({ normal: 'SmartBlurMode.NORMAL', edge_only: 'SmartBlurMode.EDGEONLY', overlay_edge: 'SmartBlurMode.OVERLAYEDGE' }, 'normal', 'Mode') },
        call: (v) => `l.applySmartBlur(${v('radius')}, ${v('threshold')}, ${v('quality')}, ${v('mode')})`,
    },
    blur: { features: ['photoshop.filters.blur'], options: {}, call: () => 'l.applyBlur()' },
    blur_more: { features: ['photoshop.filters.blur_more'], options: {}, call: () => 'l.applyBlurMore()' },
    average: { features: ['photoshop.filters.average'], options: {}, call: () => 'l.applyAverage()' },
    unsharp_mask: { features: ['photoshop.filters.unsharp_mask', 'photoshop.filters.unsharp_mask_option.amount', 'photoshop.filters.unsharp_mask_option.radius', 'photoshop.filters.unsharp_mask_option.threshold'], options: { amount: [n(1, 500), 100], radius: [n(0.1, 1000), 1], threshold: [n(0, 255), 0] }, call: (v) => `l.applyUnSharpMask(${v('amount')}, ${v('radius')}, ${v('threshold')})` },
    sharpen: { features: ['photoshop.filters.sharpen'], options: {}, call: () => 'l.applySharpen()' },
    sharpen_more: { features: ['photoshop.filters.sharpen_more'], options: {}, call: () => 'l.applySharpenMore()' },
    sharpen_edges: { features: ['photoshop.filters.sharpen_edges'], options: {}, call: () => 'l.applySharpenEdges()' },
    high_pass: { features: ['photoshop.filters.high_pass', 'photoshop.filters.high_pass_option.radius'], options: { radius: [n(0.1, 1000), 10] }, call: (v) => `l.applyHighPass(${v('radius')})` },
    add_noise: { features: ['photoshop.filters.add_noise', 'photoshop.filters.add_noise_option.amount', 'photoshop.filters.add_noise_option.uniform', 'photoshop.filters.add_noise_option.gaussian', 'photoshop.filters.add_noise_option.monochromatic'], options: { amount: [n(0.1, 400), 10], distribution: [{ type: 'string', enum: Object.keys(DISTRIBUTION) }, 'uniform'], monochromatic: [{ type: 'boolean' }, false] }, call: (v) => `l.applyAddNoise(${v('amount')}, ${v('distribution')}, ${v('monochromatic')})` },
    median: { features: ['photoshop.filters.median', 'photoshop.filters.median_option.radius'], options: { radius: [n(1, 500), 1] }, call: (v) => `l.applyMedianNoise(${v('radius')})` },
    despeckle: { features: ['photoshop.filters.despeckle'], options: {}, call: () => 'l.applyDespeckle()' },
    dust_and_scratches: { features: ['photoshop.filters.dust_and_scratches', 'photoshop.filters.dust_and_scratches_option.radius', 'photoshop.filters.dust_and_scratches_option.threshold'], options: { radius: [n(1, 500), 1], threshold: [n(0, 255), 0] }, call: (v) => `l.applyDustAndScratches(${v('radius')}, ${v('threshold')})` },
    maximum: { features: ['photoshop.filters.maximum', 'photoshop.filters.maximum_option.radius', 'photoshop.filters.maximum_option.squareness', 'photoshop.filters.maximum_option.roundness'], options: { radius: [n(1, 500), 1], preserve: PRESERVE }, call: (v) => (v('preserve') ? preserveShape('maximum', v) : `l.applyMaximum(${v('radius')})`) },
    minimum: { features: ['photoshop.filters.minimum', 'photoshop.filters.minimum_option.radius', 'photoshop.filters.minimum_option.squareness', 'photoshop.filters.minimum_option.roundness'], options: { radius: [n(1, 500), 1], preserve: PRESERVE }, call: (v) => (v('preserve') ? preserveShape('minimum', v) : `l.applyMinimum(${v('radius')})`) },
    pinch: { features: ['photoshop.filters.pinch', 'photoshop.filters.pinch_option.amount'], options: { amount: [n(-100, 100), 50] }, call: (v) => `l.applyPinch(${v('amount')})` },
    twirl: { features: ['photoshop.filters.twirl', 'photoshop.filters.twirl_option.angle'], options: { angle: [n(-999, 999), 50] }, call: (v) => `l.applyTwirl(${v('angle')})` },
    ocean_ripple: { features: ['photoshop.filters.ocean_ripple', 'photoshop.filters.ocean_ripple_option.ripple_size', 'photoshop.filters.ocean_ripple_option.ripple_magnitude'], options: { size: [n(1, 15), 9], magnitude: [n(0, 20), 9] }, call: (v) => `l.applyOceanRipple(${v('size')}, ${v('magnitude')})` },
    diffuse_glow: { features: ['photoshop.filters.diffuse_glow', 'photoshop.filters.diffuse_glow_option.graininess', 'photoshop.filters.diffuse_glow_option.glow_amount', 'photoshop.filters.diffuse_glow_option.clear_amount'], options: { graininess: [n(0, 10), 6], glowAmount: [n(0, 20), 10], clearAmount: [n(0, 20), 15] }, call: (v) => `l.applyDiffuseGlow(${v('graininess')}, ${v('glowAmount')}, ${v('clearAmount')})` },
    offset: { features: ['photoshop.filters.offset', 'photoshop.filters.offset_option.horizontal', 'photoshop.filters.offset_option.vertical', 'photoshop.filters.offset_option.wrap_around', 'photoshop.filters.offset_option.repeat_edge_pixels', 'photoshop.filters.offset_option.set_to_background'], options: { horizontal: [n(-30000, 30000), 0], vertical: [n(-30000, 30000), 0], undefinedAreas: [{ type: 'string', enum: ['wrap_around', 'repeat_edge', 'set_to_background'] }, 'wrap_around'] }, call: (v) => `l.applyOffset(new UnitValue(${v('horizontal')}, "px"), new UnitValue(${v('vertical')}, "px"), ${v('undefinedAreas')})` },
    clouds: { features: ['photoshop.filters.clouds'], options: {}, call: () => 'l.applyClouds()' },
    difference_clouds: { features: ['photoshop.filters.difference_clouds'], options: {}, call: () => 'l.applyDifferenceClouds()' },
    ntsc_colors: { features: ['photoshop.filters.ntsc_colors'], options: {}, call: () => 'l.applyNTSC()' },
    ...MORE_FILTERS,
};

const OFFSET_AREAS = { wrap_around: 'WRAPAROUND', repeat_edge: 'REPEATEDGEPIXELS', set_to_background: 'SETTOBACKGROUND' };

/** Check the options for one table entry and return a getter of script literals. */
function optionValues(table, key, options, label) {
    const spec = table[key];
    const given = options ?? {};
    if (typeof given !== 'object' || Array.isArray(given)) throw new Error("'options' must be an object");
    const unknown = Object.keys(given).filter((k) => !(k in spec.options));
    if (unknown.length) throw new Error(`${label} ${key} has no option ${unknown.join(', ')}. Options: ${Object.keys(spec.options).join(', ') || 'none'}`);
    return (name) => {
        const [schema, fallback, convert] = spec.options[name];
        const value = given[name] ?? fallback;
        if (convert) return convert(value, `options.${name}`);
        if (value === null || value === undefined) throw new Error(`${label} ${key} needs options.${name}`);
        if (name === 'color') return `__color(${colorSpec(value, 'options.color')})`;
        if (name === 'distribution') return `NoiseDistribution.${DISTRIBUTION[enumOf(value, Object.keys(DISTRIBUTION), { name: 'options.distribution' })]}`;
        if (name === 'undefinedAreas') return `OffsetUndefinedAreas.${OFFSET_AREAS[enumOf(value, Object.keys(OFFSET_AREAS), { name: 'options.undefinedAreas' })]}`;
        if (schema.type === 'boolean') return bool(value);
        if (name === 'points') {
            if (!Array.isArray(value) || value.length < 2) throw new Error('options.points needs at least two [input, output] pairs');
            return json(value.map((p, i) => [Number(num(p?.[0], { min: 0, max: 255, name: `points[${i}][0]` })), Number(num(p?.[1], { min: 0, max: 255, name: `points[${i}][1]` }))]));
        }
        if (schema.type === 'array') {
            if (!Array.isArray(value) || value.length !== 3) throw new Error(`options.${name} takes three numbers`);
            return json(value.map((x) => Number(num(x, { min: -100, max: 100, name: `options.${name}` }))));
        }
        return num(value, { min: schema.minimum, max: schema.maximum, name: `options.${name}` });
    };
}

function optionsHelp(table) {
    return Object.entries(table).map(([k, s]) => `${k}${Object.keys(s.options).length ? ` (${Object.keys(s.options).join(', ')})` : ''}`).join('; ');
}

function layerTool({ name, label, description, table }) {
    return {
        name,
        description: `${description} Options by type: ${optionsHelp(table)}`,
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Pixel layers. Default the active layer' },
                [label]: { type: 'string', enum: Object.keys(table) },
                options: { type: 'object', description: 'Settings for the chosen type; omitted settings use the defaults Photoshop opens its dialog with' },
            },
            required: [label],
        },
        features: [...new Set(Object.values(table).flatMap((entry) => entry.features))],
        handler: (a) => {
            const key = enumOf(a[label], Object.keys(table), { name: label });
            const call = table[key].call(optionValues(table, key, a.options, label));
            return run(label === 'adjustment' ? 'Adjust layers' : 'Apply filter', script(`
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename !== "ArtLayer" || l.kind !== LayerKind.NORMAL) throw new Error(l.name + " is not a pixel layer; rasterize it or use an adjustment layer");
  ${call};
}
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { ${label}: ${JSON.stringify(key)}, layers: out };`));
        },
    };
}

export const tools = [
    layerTool({
        name: 'adjust_layers',
        label: 'adjustment',
        description: 'Apply an Image > Adjustments command to pixel layers (inside the selection, if there is one). This changes the pixels; it does not add an adjustment layer.',
        table: ADJUSTMENTS,
    }),
    layerTool({
        name: 'apply_filter',
        label: 'filter',
        description: 'Apply a filter from the Filter menu to pixel layers (inside the selection, if there is one). The Filter Gallery filters (Artistic, Brush Strokes, Sketch, Texture, glowing_edges), shape_blur, mezzotint, diffuse and extrude have no options here: they use the settings last used in their dialog or the Filter Gallery. Filters without an object-model method act through the active layer, which ends on the last target.',
        table: FILTERS,
    }),
];
