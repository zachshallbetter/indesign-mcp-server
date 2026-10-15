/**
 * Image adjustments and filters on pixel layers, through the object model's
 * ArtLayer.adjust... and ArtLayer.apply... methods. Both act on the selected
 * area when there is a selection, otherwise on the whole layer.
 */
import { num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const n = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description ? { description } : {}) });
const triple = (description) => ({ type: 'array', items: { type: 'number', minimum: -100, maximum: 100 }, minItems: 3, maxItems: 3, description });

/**
 * Each adjustment: its options (with defaults) and the call it makes on `l`.
 * `v(name)` returns the checked option as a script literal.
 */
export const ADJUSTMENTS = {
    brightness_contrast: { options: { brightness: [n(-150, 150), 0], contrast: [n(-50, 100), 0] }, call: (v) => `l.adjustBrightnessContrast(${v('brightness')}, ${v('contrast')})` },
    levels: {
        options: { inputBlack: [n(0, 253), 0], inputWhite: [n(2, 255), 255], gamma: [n(0.1, 9.99), 1], outputBlack: [n(0, 255), 0], outputWhite: [n(0, 255), 255] },
        call: (v) => `l.adjustLevels(${v('inputBlack')}, ${v('inputWhite')}, ${v('gamma')}, ${v('outputBlack')}, ${v('outputWhite')})`,
    },
    curves: { options: { points: [{ type: 'array', items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2 }, minItems: 2, description: '[[input, output], ...], 0-255, e.g. [[0,0],[128,160],[255,255]]' }, null] }, call: (v) => `l.adjustCurves(${v('points')})` },
    color_balance: {
        options: { shadows: [triple('Cyan-red, magenta-green, yellow-blue, -100 to 100'), [0, 0, 0]], midtones: [triple(), [0, 0, 0]], highlights: [triple(), [0, 0, 0]], preserveLuminosity: [{ type: 'boolean' }, true] },
        call: (v) => `l.adjustColorBalance(${v('shadows')}, ${v('midtones')}, ${v('highlights')}, ${v('preserveLuminosity')})`,
    },
    photo_filter: { options: { color: [COLOR_SCHEMA, '#EC8A00'], density: [n(1, 100), 25], preserveLuminosity: [{ type: 'boolean' }, true] }, call: (v) => `l.photoFilter(${v('color')}, ${v('density')}, ${v('preserveLuminosity')})` },
    shadows_highlights: {
        options: { shadowAmount: [n(0, 100), 35], highlightAmount: [n(0, 100), 0], shadowWidth: [n(0, 100), 50], highlightWidth: [n(0, 100), 50], shadowRadius: [n(0, 2500), 30], highlightRadius: [n(0, 2500), 30], colorCorrection: [n(-100, 100), 20], midtoneContrast: [n(-100, 100), 0] },
        call: (v) => `l.shadowHighlight(${v('shadowAmount')}, ${v('shadowWidth')}, ${v('shadowRadius')}, ${v('highlightAmount')}, ${v('highlightWidth')}, ${v('highlightRadius')}, ${v('colorCorrection')}, ${v('midtoneContrast')})`,
    },
    posterize: { options: { levels: [n(2, 255), 4] }, call: (v) => `l.posterize(${v('levels')})` },
    threshold: { options: { level: [n(1, 255), 128] }, call: (v) => `l.threshold(${v('level')})` },
    desaturate: { options: {}, call: () => 'l.desaturate()' },
    invert: { options: {}, call: () => 'l.invert()' },
    equalize: { options: {}, call: () => 'l.equalize()' },
    auto_levels: { options: {}, call: () => 'l.autoLevels()' },
    auto_contrast: { options: {}, call: () => 'l.autoContrast()' },
};

const DISTRIBUTION = { uniform: 'UNIFORM', gaussian: 'GAUSSIAN' };

export const FILTERS = {
    gaussian_blur: { options: { radius: [n(0.1, 1000), 2] }, call: (v) => `l.applyGaussianBlur(${v('radius')})` },
    motion_blur: { options: { angle: [n(-360, 360), 0], distance: [n(1, 2000), 10] }, call: (v) => `l.applyMotionBlur(${v('angle')}, ${v('distance')})` },
    smart_blur: { options: { radius: [n(0.1, 100), 3], threshold: [n(0.1, 100), 25] }, call: (v) => `l.applySmartBlur(${v('radius')}, ${v('threshold')}, SmartBlurQuality.MEDIUM, SmartBlurMode.NORMAL)` },
    blur: { options: {}, call: () => 'l.applyBlur()' },
    blur_more: { options: {}, call: () => 'l.applyBlurMore()' },
    average: { options: {}, call: () => 'l.applyAverage()' },
    unsharp_mask: { options: { amount: [n(1, 500), 100], radius: [n(0.1, 1000), 1], threshold: [n(0, 255), 0] }, call: (v) => `l.applyUnSharpMask(${v('amount')}, ${v('radius')}, ${v('threshold')})` },
    sharpen: { options: {}, call: () => 'l.applySharpen()' },
    sharpen_more: { options: {}, call: () => 'l.applySharpenMore()' },
    sharpen_edges: { options: {}, call: () => 'l.applySharpenEdges()' },
    high_pass: { options: { radius: [n(0.1, 1000), 10] }, call: (v) => `l.applyHighPass(${v('radius')})` },
    add_noise: { options: { amount: [n(0.1, 400), 10], distribution: [{ type: 'string', enum: Object.keys(DISTRIBUTION) }, 'uniform'], monochromatic: [{ type: 'boolean' }, false] }, call: (v) => `l.applyAddNoise(${v('amount')}, ${v('distribution')}, ${v('monochromatic')})` },
    median: { options: { radius: [n(1, 500), 1] }, call: (v) => `l.applyMedianNoise(${v('radius')})` },
    despeckle: { options: {}, call: () => 'l.applyDespeckle()' },
    dust_and_scratches: { options: { radius: [n(1, 500), 1], threshold: [n(0, 255), 0] }, call: (v) => `l.applyDustAndScratches(${v('radius')}, ${v('threshold')})` },
    maximum: { options: { radius: [n(1, 500), 1] }, call: (v) => `l.applyMaximum(${v('radius')})` },
    minimum: { options: { radius: [n(1, 500), 1] }, call: (v) => `l.applyMinimum(${v('radius')})` },
    pinch: { options: { amount: [n(-100, 100), 50] }, call: (v) => `l.applyPinch(${v('amount')})` },
    twirl: { options: { angle: [n(-999, 999), 50] }, call: (v) => `l.applyTwirl(${v('angle')})` },
    ocean_ripple: { options: { size: [n(1, 15), 9], magnitude: [n(0, 20), 9] }, call: (v) => `l.applyOceanRipple(${v('size')}, ${v('magnitude')})` },
    diffuse_glow: { options: { graininess: [n(0, 10), 6], glowAmount: [n(0, 20), 10], clearAmount: [n(0, 20), 15] }, call: (v) => `l.applyDiffuseGlow(${v('graininess')}, ${v('glowAmount')}, ${v('clearAmount')})` },
    offset: { options: { horizontal: [n(-30000, 30000), 0], vertical: [n(-30000, 30000), 0], undefinedAreas: [{ type: 'string', enum: ['wrap_around', 'repeat_edge', 'set_to_background'] }, 'wrap_around'] }, call: (v) => `l.applyOffset(new UnitValue(${v('horizontal')}, "px"), new UnitValue(${v('vertical')}, "px"), ${v('undefinedAreas')})` },
    clouds: { options: {}, call: () => 'l.applyClouds()' },
    difference_clouds: { options: {}, call: () => 'l.applyDifferenceClouds()' },
    ntsc_colors: { options: {}, call: () => 'l.applyNTSC()' },
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
        const [schema, fallback] = spec.options[name];
        const value = given[name] ?? fallback;
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
        features: [],
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
        description: 'Apply a filter from the Filter menu to pixel layers (inside the selection, if there is one).',
        table: FILTERS,
    }),
];
