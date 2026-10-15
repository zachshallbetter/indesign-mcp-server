/**
 * Adjustment and fill types as Action Manager descriptors, shared by the
 * Image > Adjustments commands (adjust_layers) and by adjustment and fill
 * layers (create_adjustment_layer, edit_adjustment_layer, create_fill_layer,
 * edit_fill_layer).
 *
 * Each type lists its options as [schema, default, converter] and builds the
 * descriptor entries from the converted values. `has(name)` says whether an
 * option should be written: always when creating or applying, and only for
 * the options given when editing an existing layer, so the rest keep their
 * values.
 *
 * Descriptor keys follow Photoshop's own recordings (ScriptListener and
 * Alchemist captures of each Properties panel and adjustment dialog).
 */
import { num } from 'adobe-mcp-core';
import { COLOR_SCHEMA } from './args.js';
import { t, conv, entries, gradientDescriptor, GRADIENT_SCHEMA, INTERPOLATION, amColor } from './am.js';

const n = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description ? { description } : {}) });
const B = (description) => ({ type: 'boolean', ...(description ? { description } : {}) });
const oneOf = (list, description) => ({ type: 'string', enum: list, ...(description ? { description } : {}) });
const nums = (count, min, max, description) => ({ type: 'array', items: { type: 'number', minimum: min, maximum: max }, minItems: count, maxItems: count, description });

/** Option helpers: [schema, default, converter]. */
const num_ = (min, max, def, description) => [n(min, max, description), def, conv.num(min, max)];
const bool_ = (def, description) => [B(description), def, conv.bool()];
const enum_ = (list, def, description) => [oneOf(list, description), def, conv.oneOf(list)];
const color_ = (def, description) => [{ ...COLOR_SCHEMA, ...(description ? { description: `${description}: ${COLOR_SCHEMA.description}` } : {}) }, def, conv.color()];
const nums_ = (count, min, max, def, description) => [nums(count, min, max, description), def, conv.nums(count, min, max)];

const PRESET_CUSTOM = ['presetKind', t.enm('presetKindType', 'presetKindCustom')];

/** Channels for Levels and Curves. */
export const CHANNELS = { composite: '@Cmps', red: '@Rd  ', green: '@Grn ', blue: '@Bl  ', cyan: '@Cyn ', magenta: '@Mgnt', yellow: '@Yllw', black: '@Blck' };
const channelRef = (c) => t.ref([['enum', '@Chnl', '@Chnl', CHANNELS[c]]]);
const CHANNEL_OPTION = enum_(Object.keys(CHANNELS), 'composite', 'Channel. Default composite (RGB, CMYK or Gray)');

/** Photo Filter presets and the colour each applies. */
export const PHOTO_FILTERS = {
    warming_85: '#EC8A00', warming_lba: '#FA9600', warming_81: '#EBB113', cooling_80: '#006DFF', cooling_lbb: '#005DFF',
    cooling_82: '#00B5FF', red: '#EA1A1A', orange: '#F28F17', yellow: '#F9E31C', green: '#19C919', cyan: '#1DCBEA',
    blue: '#1D35EA', violet: '#9B1DEA', magenta: '#E31DE3', sepia: '#AC7A33', deep_red: '#FF0000', deep_blue: '#0022CD',
    deep_emerald: '#008C00', deep_yellow: '#FFD500', underwater: '#00C1B1',
};
export const PHOTO_FILTER_OPTION = [oneOf(Object.keys(PHOTO_FILTERS), 'A Filter preset; overrides color'), undefined, conv.oneOf(Object.keys(PHOTO_FILTERS))];

/** Hue/Saturation colour ranges: localRange index and the default range (beginRamp, beginSustain, endSustain, endRamp). */
const HUE_RANGES = { reds: [1, [315, 345, 15, 45]], yellows: [2, [15, 45, 75, 105]], greens: [3, [75, 105, 135, 165]], cyans: [4, [135, 165, 195, 225]], blues: [5, [195, 225, 255, 285]], magentas: [6, [255, 285, 315, 345]] };
const RANGE_SCHEMA = {
    type: 'object',
    description: 'Hue/Saturation for one colour range (the Properties panel range menu)',
    properties: { hue: n(-180, 180), saturation: n(-100, 100), lightness: n(-100, 100), range: nums(4, 0, 360, 'Hue range in degrees: [beginRamp, beginSustain, endSustain, endRamp]. Default the range\'s own') },
};
const rangesConv = (v, name) => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`'${name}' must be an object keyed by ${Object.keys(HUE_RANGES).join(', ')}`);
    return Object.entries(v).map(([key, r]) => {
        if (!(key in HUE_RANGES)) throw new Error(`'${name}' has no range ${key}. Ranges: ${Object.keys(HUE_RANGES).join(', ')}`);
        const p = r ?? {};
        const extra = Object.keys(p).filter((k) => !['hue', 'saturation', 'lightness', 'range'].includes(k));
        if (extra.length) throw new Error(`'${name}.${key}' has no ${extra.join(', ')}`);
        const [index, def] = HUE_RANGES[key];
        const range = p.range === undefined ? def : conv.nums(4, 0, 360)(p.range, `${name}.${key}.range`);
        return t.obj('@Hst2', [
            ['@LclR', t.int(index)], ['@BgnR', t.int(range[0])], ['@BgnS', t.int(range[1])], ['@EndS', t.int(range[2])], ['@EndR', t.int(range[3])],
            ['@H   ', t.int(num(p.hue ?? 0, { min: -180, max: 180, name: `${name}.${key}.hue` }))],
            ['@Strt', t.int(num(p.saturation ?? 0, { min: -100, max: 100, name: `${name}.${key}.saturation` }))],
            ['@Lght', t.int(num(p.lightness ?? 0, { min: -100, max: 100, name: `${name}.${key}.lightness` }))],
        ]);
    });
};

const pointsConv = (v, name) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length < 2 || v.length > 16) throw new Error(`'${name}' needs 2 to 16 [input, output] pairs`);
    return v.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`'${name}[${i}]' must be [input, output]`);
        return p.map((x, j) => Number(num(x, { min: 0, max: 255, name: `${name}[${i}][${j}]` })));
    });
};
const POINTS_SCHEMA = { type: 'array', minItems: 2, maxItems: 16, items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2 }, description: '[[input, output], ...], 0-255, e.g. [[0,0],[128,160],[255,255]]' };

const SELECTIVE = { reds: 'reds', yellows: 'yellows', greens: 'greens', cyans: 'cyans', blues: 'blues', magentas: 'magentas', whites: 'whites', neutrals: 'neutrals', blacks: 'blacks' };
const cmyk = (d) => nums_(4, -100, 100, [0, 0, 0, 0], d);

const mix = (a) => t.obj('@ChMx', [['@Rd  ', t.pct(a[0])], ['@Grn ', t.pct(a[1])], ['@Bl  ', t.pct(a[2])], ['@Cnst', t.pct(a[3])]]);
const mixOpt = (def, d) => nums_(4, -200, 200, def, `${d}: [red, green, blue, constant] percent, -200 to 200`);

/** Write `key` only when `has(name)`. */
const w = (has, name, key, value) => (has(name) ? [key, value] : null);
const anyOf = (has, names) => names.some(has);

/**
 * Adjustment types. `cls` is the adjustment-layer class (also the class of the
 * `to` descriptor when editing); `event` the Image > Adjustments command;
 * `classOnly` types are created with no settings.
 */
export const TYPES = {
    brightness_contrast: {
        cls: '@BrgC', event: 'brightnessEvent', kind: 'BRIGHTNESSCONTRAST', features: ['photoshop.adjustments.brightness_contrast_layer'],
        options: { brightness: num_(-150, 150, 0), contrast: num_(-50, 100, 0), useLegacy: bool_(false, 'Use Legacy (the pre-CS3 behaviour)') },
        build: (o, has) => entries([w(has, 'brightness', '@Brgh', t.int(o.brightness)), w(has, 'contrast', '@Cntr', t.int(o.contrast)), w(has, 'useLegacy', 'useLegacy', t.bool(o.useLegacy))]),
    },
    levels: {
        cls: '@Lvls', event: 'levels', kind: 'LEVELS', features: ['photoshop.adjustments.levels_layer'],
        options: {
            channel: CHANNEL_OPTION, inputBlack: num_(0, 253, 0), inputWhite: num_(2, 255, 255), gamma: num_(0.1, 9.99, 1), outputBlack: num_(0, 255, 0), outputWhite: num_(0, 255, 255),
            auto: bool_(false, 'Auto: let Photoshop set this channel\'s levels; the input and output values are then ignored'),
        },
        build: (o, has) => {
            if (!anyOf(has, ['channel', 'inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite', 'auto'])) return [];
            if (o.inputBlack >= o.inputWhite) throw new Error('Levels inputBlack must be below inputWhite');
            const entry = o.auto
                ? [['@Chnl', channelRef(o.channel)], ['@Auto', t.bool(true)]]
                : [['@Chnl', channelRef(o.channel)], ['@Inpt', t.list([t.int(o.inputBlack), t.int(o.inputWhite)])], ['@Gmm ', t.dbl(o.gamma)], ['@Otpt', t.list([t.int(o.outputBlack), t.int(o.outputWhite)])]];
            return [PRESET_CUSTOM, ['@Adjs', t.list([t.obj('@LvlA', entry)])]];
        },
    },
    curves: {
        cls: '@Crvs', event: 'curves', kind: 'CURVES', features: ['photoshop.adjustments.curves_layer'],
        options: { channel: CHANNEL_OPTION, points: [POINTS_SCHEMA, [[0, 0], [255, 255]], pointsConv] },
        build: (o, has) => {
            if (!anyOf(has, ['channel', 'points'])) return [];
            const curve = o.points.map(([h, v]) => t.obj('@CrPt', [['@Hrzn', t.dbl(h)], ['@Vrtc', t.dbl(v)]]));
            return [PRESET_CUSTOM, ['@Adjs', t.list([t.obj('@CrvA', [['@Chnl', channelRef(o.channel)], ['@Crv ', t.list(curve)]])])]];
        },
    },
    exposure: {
        cls: '@Exps', event: 'exposure', kind: 'EXPOSURE', features: ['photoshop.adjustments.exposure_layer'],
        options: { exposure: num_(-20, 20, 0, 'Exposure, stops'), offset: num_(-0.5, 0.5, 0, 'Offset'), gamma: num_(0.01, 9.99, 1, 'Gamma Correction') },
        build: (o, has) => {
            const out = entries([w(has, 'exposure', '@Exps', t.dbl(o.exposure)), w(has, 'offset', '@Ofst', t.dbl(o.offset)), w(has, 'gamma', 'gammaCorrection', t.dbl(o.gamma))]);
            return out.length ? [PRESET_CUSTOM, ...out] : [];
        },
    },
    vibrance: {
        cls: 'vibrance', event: 'vibrance', kind: 'VIBRANCE', features: ['photoshop.adjustments.vibrance_layer'],
        options: { vibrance: num_(-100, 100, 0), saturation: num_(-100, 100, 0) },
        build: (o, has) => entries([w(has, 'vibrance', 'vibrance', t.int(o.vibrance)), w(has, 'saturation', '@Strt', t.int(o.saturation))]),
    },
    hue_saturation: {
        cls: '@HStr', event: 'hueSaturation', kind: 'HUESATURATION', features: ['photoshop.adjustments.hue_saturation_layer'],
        options: {
            hue: num_(-180, 360, 0, 'Master hue, -180 to 180 (0 to 360 with colorize)'), saturation: num_(-100, 100, 0, 'Master saturation, -100 to 100 (0 to 100 with colorize)'),
            lightness: num_(-100, 100, 0, 'Master lightness'), colorize: bool_(false, 'Colorize'),
            ranges: [{ type: 'object', description: `Per colour range: ${Object.keys(HUE_RANGES).join(', ')}, each { hue, saturation, lightness, range }`, properties: Object.fromEntries(Object.keys(HUE_RANGES).map((k) => [k, RANGE_SCHEMA])) }, undefined, rangesConv],
        },
        build: (o, has) => {
            if (o.colorize && (o.hue < 0 || o.saturation < 0)) throw new Error('With colorize, hue is 0 to 360 and saturation 0 to 100');
            if (!o.colorize && has('colorize') && o.hue > 180) throw new Error('Hue is -180 to 180 (0 to 360 only with colorize)');
            const list = anyOf(has, ['hue', 'saturation', 'lightness', 'ranges'])
                ? t.list([t.obj('@Hst2', [['@H   ', t.int(o.hue)], ['@Strt', t.int(o.saturation)], ['@Lght', t.int(o.lightness)]]), ...(o.ranges ?? [])])
                : undefined;
            if (o.colorize && o.ranges?.length) throw new Error('Colorize has no colour ranges');
            return entries([has('colorize') || list ? PRESET_CUSTOM : null, w(has, 'colorize', '@Clrz', t.bool(o.colorize)), list ? ['@Adjs', list] : null]);
        },
    },
    color_balance: {
        cls: '@ClrB', event: 'colorBalance', kind: 'COLORBALANCE', features: ['photoshop.adjustments.color_balance_layer'],
        options: {
            shadows: nums_(3, -100, 100, [0, 0, 0], 'Shadows: cyan-red, magenta-green, yellow-blue, -100 to 100'), midtones: nums_(3, -100, 100, [0, 0, 0], 'Midtones'),
            highlights: nums_(3, -100, 100, [0, 0, 0], 'Highlights'), preserveLuminosity: bool_(true, 'Preserve Luminosity'),
        },
        build: (o, has) => entries([
            w(has, 'shadows', '@ShdL', t.list(o.shadows.map(t.int))), w(has, 'midtones', '@MdtL', t.list(o.midtones.map(t.int))),
            w(has, 'highlights', '@HghL', t.list(o.highlights.map(t.int))), w(has, 'preserveLuminosity', '@PrsL', t.bool(o.preserveLuminosity)),
        ]),
    },
    black_and_white: {
        cls: '@BanW', event: 'blackAndWhite', kind: 'BLACKANDWHITE', features: ['photoshop.adjustments.black_and_white_layer'],
        options: {
            reds: num_(-200, 300, 40), yellows: num_(-200, 300, 60), greens: num_(-200, 300, 40), cyans: num_(-200, 300, 60), blues: num_(-200, 300, 20), magentas: num_(-200, 300, 80),
            tint: bool_(false, 'Tint'), tintColor: color_('#E1D3B3', 'Tint colour'),
        },
        build: (o, has) => {
            const sliders = anyOf(has, ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'])
                ? [['@Rd  ', t.int(o.reds)], ['@Yllw', t.int(o.yellows)], ['@Grn ', t.int(o.greens)], ['@Cyn ', t.int(o.cyans)], ['@Bl  ', t.int(o.blues)], ['@Mgnt', t.int(o.magentas)]]
                : [];
            const rest = entries([w(has, 'tint', 'useTint', t.bool(o.tint)), w(has, 'tintColor', 'tintColor', o.tintColor)]);
            return sliders.length || rest.length ? [PRESET_CUSTOM, ...sliders, ...rest] : [];
        },
    },
    photo_filter: {
        cls: 'photoFilter', event: 'photoFilter', kind: 'PHOTOFILTER', features: ['photoshop.adjustments.photo_filter_layer'],
        options: { filter: PHOTO_FILTER_OPTION, color: color_('#EC8A00', 'Filter colour'), density: num_(1, 100, 25, 'Density, percent'), preserveLuminosity: bool_(true, 'Preserve Luminosity') },
        build: (o, has) => entries([
            has('filter') && o.filter ? ['@Clr ', amColor(PHOTO_FILTERS[o.filter])] : w(has, 'color', '@Clr ', o.color),
            w(has, 'density', '@Dnst', t.int(o.density)), w(has, 'preserveLuminosity', '@PrsL', t.bool(o.preserveLuminosity)),
        ]),
    },
    channel_mixer: {
        cls: '@ChnM', event: 'channelMixer', kind: 'CHANNELMIXER', features: ['photoshop.adjustments.channel_mixer_layer'],
        options: {
            monochrome: bool_(false, 'Monochrome: mix into gray using the gray option'),
            red: mixOpt([100, 0, 0, 0], 'Red output'), green: mixOpt([0, 100, 0, 0], 'Green output'), blue: mixOpt([0, 0, 100, 0], 'Blue output'), gray: mixOpt([40, 40, 20, 0], 'Gray output, with monochrome'),
        },
        build: (o, has) => {
            const out = entries([w(has, 'monochrome', '@Mnch', t.bool(o.monochrome))]);
            if (o.monochrome) { if (has('gray') || has('monochrome')) out.push(['@Gry ', mix(o.gray)]); } else {
                for (const [k, key] of [['red', '@Rd  '], ['green', '@Grn '], ['blue', '@Bl  ']]) if (has(k)) out.push([key, mix(o[k])]);
            }
            return out.length ? [PRESET_CUSTOM, ...out] : [];
        },
    },
    selective_color: {
        cls: '@SlcC', event: 'selectiveColor', kind: 'SELECTIVECOLOR', features: ['photoshop.adjustments.selective_color_layer'],
        options: {
            method: enum_(['relative', 'absolute'], 'relative', 'Relative or Absolute'),
            ...Object.fromEntries(Object.keys(SELECTIVE).map((k) => [k, cmyk(`${k}: [cyan, magenta, yellow, black], -100 to 100`)])),
        },
        build: (o, has) => {
            const touched = Object.keys(SELECTIVE).filter(has);
            const list = touched.map((k) => t.obj('@ClrC', [['@Clrs', t.enm('@Clrs', SELECTIVE[k])], ['@Cyn ', t.pct(o[k][0])], ['@Mgnt', t.pct(o[k][1])], ['@Ylw ', t.pct(o[k][2])], ['@Blck', t.pct(o[k][3])]]));
            const out = entries([w(has, 'method', '@Mthd', t.enm('@CrcM', o.method === 'absolute' ? '@Absl' : '@Rltv')), list.length ? ['@ClrC', t.list(list)] : null]);
            return out.length ? [PRESET_CUSTOM, ...out] : [];
        },
    },
    gradient_map: {
        cls: '@GdMp', event: 'gradientMapEvent', kind: 'GRADIENTMAP', features: ['photoshop.adjustments.gradient_map_layer'],
        options: {
            gradient: [GRADIENT_SCHEMA, undefined, (v, name) => (v === undefined ? undefined : gradientDescriptor(v, name))],
            reverse: bool_(false, 'Reverse'), dither: bool_(false, 'Dither'),
            method: enum_(Object.keys(INTERPOLATION), undefined, 'Gradient interpolation Method. Default Photoshop\'s'),
        },
        build: (o, has, creating) => entries([
            o.gradient || creating ? ['@Grad', o.gradient ?? gradientDescriptor({})] : null,
            w(has, 'reverse', '@Rvrs', t.bool(o.reverse)), w(has, 'dither', '@Dthr', t.bool(o.dither)),
            o.method ? ['gradientsInterpolationMethod', t.enm('gradientInterpolationMethodType', INTERPOLATION[o.method])] : null,
        ]),
    },
    posterize: {
        cls: '@Pstr', event: 'posterization', kind: 'POSTERIZE', features: ['photoshop.adjustments.posterize_layer'],
        options: { levels: num_(2, 255, 4) },
        build: (o, has) => entries([w(has, 'levels', '@Lvls', t.int(o.levels))]),
    },
    threshold: {
        cls: '@Thrs', event: 'thresholdClassEvent', kind: 'THRESHOLD', features: ['photoshop.adjustments.threshold_layer'],
        options: { level: num_(1, 255, 128) },
        build: (o, has) => entries([w(has, 'level', '@Lvl ', t.int(o.level))]),
    },
    invert: { cls: '@Invr', classOnly: true, kind: 'INVERSION', features: ['photoshop.adjustments.invert_layer'], options: {} },
    color_lookup: { cls: 'colorLookup', classOnly: true, kind: 'COLORLOOKUP', features: ['photoshop.adjustments.color_lookup_layer'], options: {} },
    clarity_and_dehaze: { cls: 'clarity', classOnly: true, features: ['photoshop.adjustments.clarity_and_dehaze_layer'], options: {} },
    grain: { cls: 'grainAdjustment', classOnly: true, features: ['photoshop.adjustments.grain_layer'], options: {} },
};

const GRADIENT_STYLES = { linear: '@Lnr ', radial: '@Rdl ', angle: '@Angl', reflected: '@Rflc', diamond: '@Dmnd' };

/** Fill layer types (Layer > New Fill Layer). */
export const FILL_TYPES = {
    solid_color: {
        cls: 'solidColorLayer', kind: 'SOLIDFILL', features: ['photoshop.color.solid_color_fill_layer'],
        options: { color: [COLOR_SCHEMA, undefined, conv.color()] },
        build: (o, has, creating) => {
            if (creating && !o.color) throw new Error('A solid colour fill needs options.color');
            return entries([w(has, 'color', '@Clr ', o.color)]);
        },
    },
    gradient: {
        cls: 'gradientLayer', kind: 'GRADIENTFILL', features: ['photoshop.color.gradient_fill_layer'],
        options: {
            gradient: [GRADIENT_SCHEMA, undefined, (v, name) => (v === undefined ? undefined : gradientDescriptor(v, name))],
            style: enum_(Object.keys(GRADIENT_STYLES), 'linear', 'Style'),
            angle: num_(-180, 180, 90, 'Angle, degrees'),
            scale: num_(10, 150, 100, 'Scale, percent'),
            reverse: bool_(false, 'Reverse'), dither: bool_(false, 'Dither'),
            alignWithLayer: bool_(true, 'Align with layer'),
            method: enum_(Object.keys(INTERPOLATION), undefined, 'Interpolation Method. Default Photoshop\'s'),
            offset: nums_(2, -100, 100, undefined, 'Offset [x, y], percent of the layer'),
        },
        build: (o, has, creating) => entries([
            o.gradient || creating ? ['@Grad', o.gradient ?? gradientDescriptor({})] : null,
            w(has, 'style', '@Type', t.enm('@GrdT', GRADIENT_STYLES[o.style])),
            w(has, 'angle', '@Angl', t.angle(o.angle)), w(has, 'scale', '@Scl ', t.pct(o.scale)),
            w(has, 'reverse', '@Rvrs', t.bool(o.reverse)), w(has, 'dither', '@Dthr', t.bool(o.dither)),
            w(has, 'alignWithLayer', '@Algn', t.bool(o.alignWithLayer)),
            o.method ? ['gradientsInterpolationMethod', t.enm('gradientInterpolationMethodType', INTERPOLATION[o.method])] : null,
            o.offset ? ['@Ofst', t.obj('@Pnt ', [['@Hrzn', t.pct(o.offset[0])], ['@Vrtc', t.pct(o.offset[1])]])] : null,
        ]),
    },
    pattern: {
        cls: 'patternLayer', kind: 'PATTERNFILL', features: ['photoshop.color.pattern_fill_layer'],
        options: {
            pattern: [{ type: 'string', description: 'Pattern name, as in the Patterns panel or as define_pattern named it' }, undefined, conv.str()],
            patternId: [{ type: 'string', description: 'Pattern id, when known; otherwise Photoshop looks the pattern up by name' }, undefined, conv.str()],
            scale: num_(1, 1000, 100, 'Scale, percent'),
            linked: bool_(true, 'Link with Layer'),
        },
        build: (o, has, creating) => {
            if (creating && !o.pattern) throw new Error('A pattern fill needs options.pattern (a pattern name)');
            if (has('patternId') && !has('pattern')) throw new Error('Give options.pattern with options.patternId');
            return entries([
                has('pattern') ? ['@Ptrn', t.obj('@Ptrn', entries([['@Nm  ', t.str(o.pattern)], o.patternId ? ['@Idnt', t.str(o.patternId)] : null]))] : null,
                w(has, 'scale', '@Scl ', t.pct(o.scale)), w(has, 'linked', '@Lnkd', t.bool(o.linked)),
            ]);
        },
    },
};

/**
 * Check `options` against a type's option specs. `partial` (editing) keeps
 * unset options undefined; otherwise they take their defaults. Returns
 * { values, has }.
 */
export function resolveOptions(spec, options, label, { partial = false } = {}) {
    const given = options ?? {};
    if (typeof given !== 'object' || Array.isArray(given)) throw new Error("'options' must be an object");
    const names = Object.keys(spec.options);
    const unknown = Object.keys(given).filter((k) => !names.includes(k));
    if (unknown.length) throw new Error(`${label} has no option ${unknown.join(', ')}. Options: ${names.join(', ') || 'none'}`);
    const values = {};
    for (const name of names) {
        const [, def, convert] = spec.options[name];
        values[name] = convert(given[name] ?? (partial ? undefined : def), `options.${name}`);
    }
    // When editing, options a build reads together (a slider group) need values: fill those from defaults.
    if (partial) for (const name of names) if (values[name] === undefined) values[name] = spec.options[name][2](spec.options[name][1], `options.${name}`);
    const has = (name) => !partial || given[name] !== undefined;
    return { values, has };
}

/** Descriptor entries for a type with checked options. */
export function typeEntries(spec, options, label, { partial = false } = {}) {
    const { values, has } = resolveOptions(spec, options, label, { partial });
    return spec.build ? spec.build(values, has, !partial) : [];
}
