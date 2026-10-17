/**
 * Image adjustments and filters on pixel layers, through the object model's
 * ArtLayer.adjust... and ArtLayer.apply... methods, and through the Action
 * Manager for the adjustments the object model lacks. Both act on the
 * selected area when there is a selection, otherwise on the whole layer.
 */
import { num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { AM_HELPERS, amCall, t, conv } from '../am.js';
import { TYPES, PHOTO_FILTERS, PHOTO_FILTER_OPTION } from '../adjustment-types.js';
import { MORE_FILTERS, PRESERVE, choice, preserveShape, am } from './filters.js';

const n = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description ? { description } : {}) });
const triple = (description) => ({ type: 'array', items: { type: 'number', minimum: -100, maximum: 100 }, minItems: 3, maxItems: 3, description });

/** Run an Action Manager adjustment on the active layer `l` (the script includes AM_HELPERS when this is used). */
const onLayer = (event, entries) => `doc.activeLayer = l; ${amCall(event, entries)}`;

const c = (id) => `app.charIDToTypeID(${JSON.stringify(id)})`;

/** Auto Color Correction Options algorithms: the levels key each one turns on. */
const AUTO_ALGORITHMS = { monochromatic_contrast: '@AuCo', per_channel_contrast: '@Auto', dark_and_light_colors: 'autoBlackWhite' };

/** An adjustment from TYPES, applied with the type's own event and options. */
const amAdjustment = (type, features) => ({
    features,
    options: TYPES[type].options,
    call: (v) => onLayer(TYPES[type].event, TYPES[type].build(Object.fromEntries(Object.keys(TYPES[type].options).map((k) => [k, v(k)])), () => true, true)),
});

/**
 * Each adjustment: the atlas features it performs, its options (with defaults)
 * and the call it makes on `l`. `v(name)` returns the checked option as a
 * script literal, or, for an option with its own converter (a third element),
 * the converted value.
 */
export const ADJUSTMENTS = {
    brightness_contrast: {
        features: ['photoshop.adjustments.brightness_contrast', 'photoshop.adjustments.brightness_contrast_option.brightness', 'photoshop.adjustments.brightness_contrast_option.contrast', 'photoshop.adjustments.brightness_contrast_option.use_legacy'],
        options: { brightness: [n(-150, 150), 0], contrast: [n(-50, 100), 0], useLegacy: TYPES.brightness_contrast.options.useLegacy },
        call: (v) => (v('useLegacy')
            ? onLayer('brightnessEvent', [['@Brgh', t.int(v('brightness'))], ['@Cntr', t.int(v('contrast'))], ['useLegacy', t.bool(true)]])
            : `l.adjustBrightnessContrast(${v('brightness')}, ${v('contrast')})`),
    },
    levels: {
        features: ['photoshop.adjustments.levels', 'photoshop.adjustments.levels_option.input_levels', 'photoshop.adjustments.levels_option.output_levels', 'photoshop.adjustments.levels_option.channel', 'photoshop.adjustments.levels_option.auto'],
        options: { inputBlack: [n(0, 253), 0], inputWhite: [n(2, 255), 255], gamma: [n(0.1, 9.99), 1], outputBlack: [n(0, 255), 0], outputWhite: [n(0, 255), 255], channel: TYPES.levels.options.channel, auto: TYPES.levels.options.auto },
        call: (v) => (v('channel') === 'composite' && !v('auto')
            ? `l.adjustLevels(${v('inputBlack')}, ${v('inputWhite')}, ${v('gamma')}, ${v('outputBlack')}, ${v('outputWhite')})`
            : onLayer('levels', TYPES.levels.build({ channel: v('channel'), auto: v('auto'), ...Object.fromEntries(['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'].map((k) => [k, Number(v(k))])) }, () => true))),
    },
    curves: {
        features: ['photoshop.adjustments.curves'],
        options: { points: [{ type: 'array', items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2 }, minItems: 2, description: '[[input, output], ...], 0-255, e.g. [[0,0],[128,160],[255,255]]' }, null], channel: TYPES.curves.options.channel },
        call: (v) => (v('channel') === 'composite'
            ? `l.adjustCurves(${v('points')})`
            : onLayer('curves', TYPES.curves.build({ channel: v('channel'), points: JSON.parse(v('points')) }, () => true))),
    },
    color_balance: {
        features: ['photoshop.adjustments.color_balance', 'photoshop.adjustments.color_balance_option.tone', 'photoshop.adjustments.color_balance_option.color_sliders', 'photoshop.adjustments.color_balance_option.preserve_luminosity'],
        options: { shadows: [triple('Cyan-red, magenta-green, yellow-blue, -100 to 100'), [0, 0, 0]], midtones: [triple(), [0, 0, 0]], highlights: [triple(), [0, 0, 0]], preserveLuminosity: [{ type: 'boolean' }, true] },
        call: (v) => `l.adjustColorBalance(${v('shadows')}, ${v('midtones')}, ${v('highlights')}, ${v('preserveLuminosity')})`,
    },
    photo_filter: {
        features: ['photoshop.adjustments.photo_filter', 'photoshop.adjustments.photo_filter_option.color', 'photoshop.adjustments.photo_filter_option.density', 'photoshop.adjustments.photo_filter_option.preserve_luminosity', 'photoshop.adjustments.photo_filter_option.filter'],
        options: { color: [COLOR_SCHEMA, '#EC8A00'], density: [n(1, 100), 25], preserveLuminosity: [{ type: 'boolean' }, true], filter: PHOTO_FILTER_OPTION },
        call: (v) => `l.photoFilter(${v('filter') ? `__color(${colorSpec(PHOTO_FILTERS[v('filter')])})` : v('color')}, ${v('density')}, ${v('preserveLuminosity')})`,
    },
    shadows_highlights: {
        features: ['photoshop.adjustments.shadows_highlights', 'photoshop.adjustments.shadows_highlights_option.amount', 'photoshop.adjustments.shadows_highlights_option.tonal_width', 'photoshop.adjustments.shadows_highlights_option.radius', 'photoshop.adjustments.shadows_highlights_option.midtone_contrast', 'photoshop.adjustments.shadows_highlights_option.black_clip_and_white_clip'],
        options: { shadowAmount: [n(0, 100), 35], highlightAmount: [n(0, 100), 0], shadowWidth: [n(0, 100), 50], highlightWidth: [n(0, 100), 50], shadowRadius: [n(0, 2500), 30], highlightRadius: [n(0, 2500), 30], colorCorrection: [n(-100, 100), 20], midtoneContrast: [n(-100, 100), 0], blackClip: [n(0, 50, 'Black Clip, percent'), 0.01], whiteClip: [n(0, 50, 'White Clip, percent'), 0.01] },
        call: (v) => `l.shadowHighlight(${v('shadowAmount')}, ${v('shadowWidth')}, ${v('shadowRadius')}, ${v('highlightAmount')}, ${v('highlightWidth')}, ${v('highlightRadius')}, ${v('colorCorrection')}, ${v('midtoneContrast')}, ${v('blackClip')}, ${v('whiteClip')})`,
    },
    posterize: { features: ['photoshop.adjustments.posterize', 'photoshop.adjustments.posterize_option.levels'], options: { levels: [n(2, 255), 4] }, call: (v) => `l.posterize(${v('levels')})` },
    threshold: { features: ['photoshop.adjustments.threshold', 'photoshop.adjustments.threshold_option.threshold_level'], options: { level: [n(1, 255), 128] }, call: (v) => `l.threshold(${v('level')})` },
    desaturate: { features: ['photoshop.adjustments.desaturate'], options: {}, call: () => 'l.desaturate()' },
    invert: { features: ['photoshop.adjustments.invert'], options: {}, call: () => 'l.invert()' },
    equalize: { features: ['photoshop.adjustments.equalize'], options: {}, call: () => 'l.equalize()' },
    auto_levels: { features: ['photoshop.adjustments.auto_tone'], options: {}, call: () => 'l.autoLevels()' },
    auto_contrast: { features: ['photoshop.adjustments.auto_contrast'], options: {}, call: () => 'l.autoContrast()' },
    auto_color: { features: ['photoshop.adjustments.auto_color'], options: {}, call: () => onLayer('levels', [['autoBlackWhite', t.bool(true)], ['autoNeutrals', t.bool(true)]]) },
    auto_color_correction: {
        features: ['photoshop.adjustments.auto_color_correction_options', 'photoshop.adjustments.auto_color_correction_options_option.enhance_monochromatic_contrast', 'photoshop.adjustments.auto_color_correction_options_option.enhance_per_channel_contrast', 'photoshop.adjustments.auto_color_correction_options_option.find_dark_and_light_colors', 'photoshop.adjustments.auto_color_correction_options_option.snap_neutral_midtones'],
        options: {
            algorithm: choice(AUTO_ALGORITHMS, 'per_channel_contrast', 'Algorithm (Auto Color Correction Options)'),
            snapNeutralMidtones: [{ type: 'boolean', description: 'Snap Neutral Midtones' }, false, conv.bool()],
        },
        call: (v) => onLayer('levels', [[v('algorithm'), t.bool(true)], ...(v('snapNeutralMidtones') ? [['autoNeutrals', t.bool(true)]] : [])]),
    },
    match_color: {
        features: ['photoshop.adjustments.match_color', 'photoshop.adjustments.match_color_option.luminance', 'photoshop.adjustments.match_color_option.color_intensity', 'photoshop.adjustments.match_color_option.fade', 'photoshop.adjustments.match_color_option.neutralize'],
        options: {
            luminance: [n(1, 200, 'Luminance'), 100],
            colorIntensity: [n(1, 200, 'Color Intensity'), 100],
            fade: [n(0, 100, 'Fade'), 0],
            neutralize: [{ type: 'boolean', description: 'Neutralize: remove a colour cast' }, false, conv.bool()],
        },
        call: (v) => `if (doc.mode !== DocumentMode.RGB) throw new Error("Match Color needs an RGB document");
  ${onLayer('matchColor', [['@Lght', t.int(v('luminance'))], ['@ClrR', t.int(v('colorIntensity'))], ['@Fade', t.int(v('fade'))], ['neutralizeColor', t.bool(v('neutralize'))], ['noReference', t.bool(true)]])}`,
    },
    replace_color: {
        features: ['photoshop.adjustments.replace_color', 'photoshop.adjustments.replace_color_option.fuzziness', 'photoshop.adjustments.replace_color_option.hue', 'photoshop.adjustments.replace_color_option.saturation', 'photoshop.adjustments.replace_color_option.lightness'],
        options: {
            color: [{ ...COLOR_SCHEMA, description: `The colour to replace (what the dialog's eyedropper samples): ${COLOR_SCHEMA.description}` }, null],
            fuzziness: [n(0, 200, 'Fuzziness: how far related colours are included'), 40],
            hue: [n(-180, 180, 'Replacement hue shift'), 0],
            saturation: [n(-100, 100, 'Replacement saturation'), 0],
            lightness: [n(-100, 100, 'Replacement lightness'), 0],
        },
        call: (v) => am(`app.stringIDToTypeID("replaceColor")`, [
            `var rc = ${v('color')}.lab, lab = new ActionDescriptor();`,
            `lab.putDouble(${c('Lmnc')}, rc.L);`,
            `lab.putDouble(${c('A   ')}, rc.A);`,
            `lab.putDouble(${c('B   ')}, rc.B);`,
            `d.putInteger(${c('Fzns')}, ${Math.round(Number(v('fuzziness')))});`,
            `d.putObject(${c('Mnm ')}, ${c('LbCl')}, lab);`,
            `d.putObject(${c('Mxm ')}, ${c('LbCl')}, lab);`,
            `d.putInteger(${c('H   ')}, ${Math.round(Number(v('hue')))});`,
            `d.putInteger(${c('Strt')}, ${Math.round(Number(v('saturation')))});`,
            `d.putInteger(${c('Lght')}, ${Math.round(Number(v('lightness')))});`,
        ]),
    },
    exposure: amAdjustment('exposure', ['photoshop.adjustments.exposure', 'photoshop.adjustments.exposure_option.exposure', 'photoshop.adjustments.exposure_option.offset', 'photoshop.adjustments.exposure_option.gamma']),
    vibrance: amAdjustment('vibrance', ['photoshop.adjustments.vibrance', 'photoshop.adjustments.vibrance_option.vibrance', 'photoshop.adjustments.vibrance_option.saturation']),
    hue_saturation: amAdjustment('hue_saturation', ['photoshop.adjustments.hue_saturation', 'photoshop.adjustments.hue_saturation_option.master', 'photoshop.adjustments.hue_saturation_option.hue', 'photoshop.adjustments.hue_saturation_option.saturation', 'photoshop.adjustments.hue_saturation_option.lightness', 'photoshop.adjustments.hue_saturation_option.colorize', 'photoshop.adjustments.hue_saturation_option.color_range']),
    black_and_white: amAdjustment('black_and_white', ['photoshop.adjustments.black_and_white', 'photoshop.adjustments.black_and_white_option.tint', 'photoshop.adjustments.black_and_white_option.color_sliders']),
    channel_mixer: {
        features: ['photoshop.adjustments.channel_mixer', 'photoshop.adjustments.channel_mixer_option.monochrome'],
        options: TYPES.channel_mixer.options,
        call: (v) => (v('monochrome') ? `l.mixChannels(${json([v('gray')])}, true)` : `l.mixChannels(${json([v('red'), v('green'), v('blue')])}, false)`),
    },
    selective_color: {
        features: ['photoshop.adjustments.selective_color', 'photoshop.adjustments.selective_color_option.relative', 'photoshop.adjustments.selective_color_option.absolute'],
        options: TYPES.selective_color.options,
        call: (v) => `l.selectiveColor(AdjustmentReference.${v('method') === 'absolute' ? 'ABSOLUTE' : 'RELATIVE'}, ${['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].map((k) => json(v(k))).join(', ')})`,
    },
    gradient_map: amAdjustment('gradient_map', ['photoshop.adjustments.gradient_map', 'photoshop.adjustments.gradient_map_option.dither', 'photoshop.adjustments.gradient_map_option.reverse', 'photoshop.color.gradient_editor', 'photoshop.color.gradient_editor_option.solid', 'photoshop.color.gradient_editor_option.noise', 'photoshop.color.gradient_editor_option.transparency', 'photoshop.color.gradient_editor_option.roughness', 'photoshop.color.gradient_editor_option.color_model', 'photoshop.color.gradient_editor_option.restrict_colors', 'photoshop.color.gradient_editor_option.add_transparency', 'photoshop.color.gradient_editor_option.randomize', 'photoshop.color.gradient_editor_option.perceptual', 'photoshop.color.gradient_editor_option.linear', 'photoshop.color.gradient_editor_option.classic', 'photoshop.color.gradient_interpolation']),
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
            return run(label === 'adjustment' ? 'Adjust layers' : 'Apply filter', script(`${call.includes('__amDo') ? AM_HELPERS : ''}
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
        description: 'Apply an Image > Adjustments command to pixel layers (inside the selection, if there is one). This changes the pixels; it does not add an adjustment layer. auto_color_correction applies Auto with an algorithm from Auto Color Correction Options, once; match_color adjusts the layer on its own (Match Color with Source: None, RGB only); replace_color changes one colour and the colours within its fuzziness (Replace Color).',
        table: ADJUSTMENTS,
    }),
    layerTool({
        name: 'apply_filter',
        label: 'filter',
        description: 'Apply a filter from the Filter menu to pixel layers (inside the selection, if there is one). The Filter Gallery filters (Artistic, Brush Strokes, Sketch, Texture, glowing_edges), filter_gallery (the whole gallery stack), shape_blur, mezzotint and adaptive_wide_angle have no options here: they use the settings last used in their dialog or the Filter Gallery. diffuse, extrude and lens_correction (Filter > Lens Correction) apply only the settings given; the rest keep the values last used in the dialog. Filters without an object-model method act through the active layer, which ends on the last target.',
        table: FILTERS,
    }),
];
