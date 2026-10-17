/**
 * Camera Raw and the image-processing commands beside it: opening a raw file
 * with Camera Raw settings, the Camera Raw Filter, Neural Filters, Sky
 * Replacement and Remove Background.
 *
 * Opening a raw file uses the object model's CameraRAWOpenOptions, which
 * covers the older Camera Raw controls. The rest are Action Manager events
 * whose descriptors come from published captures, not from Adobe
 * documentation: the Camera Raw Filter keys and version handshake from a
 * Camera Raw 18.2 capture, the Neural Filters stack from Adobe's UXP sample,
 * and the Sky Replacement keys from a published script.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { str, num, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

const CR = 'photoshop.camera_raw.';
const OPT = `${CR}camera_raw_open_options_option.`;

/** CameraRAWOpenOptions values: property, range and the feature each one performs. */
const RAW_NUMBERS = {
    temperature: ['temperature', 2000, 50000, 'temperature', 'White balance temperature in kelvin, 2000-50000'],
    tint: ['tint', -150, 150, 'tint', 'White balance tint, -150 to 150'],
    exposure: ['exposure', -4, 4, 'exposure_all', 'Exposure in stops, -4 to 4'],
    shadows: ['shadows', 0, 100, 'shadows_pv2012', 'Shadows, 0-100'],
    brightness: ['brightness', 0, 150, 'brightness_pv2010_and_pv2003', 'Brightness, 0-150 (process versions 2003 and 2010)'],
    contrast: ['contrast', -50, 100, 'contrast_all', 'Contrast, -50 to 100'],
    saturation: ['saturation', -100, 100, 'saturation', 'Saturation, -100 to 100'],
    sharpness: ['sharpness', 0, 100, 'sharpening', 'Sharpening amount, 0-100'],
    luminanceSmoothing: ['luminanceSmoothing', 0, 100, 'luminance', 'Luminance noise reduction, 0-100'],
    colorNoiseReduction: ['colorNoiseReduction', 0, 100, 'color', 'Color noise reduction, 0-100'],
    chromaticAberrationRC: ['chromaticAberrationRC', -100, 100, 'defringe', 'Chromatic aberration red/cyan, -100 to 100'],
    chromaticAberrationBY: ['chromaticAberrationBY', -100, 100, 'defringe', 'Chromatic aberration blue/yellow, -100 to 100'],
    vignettingAmount: ['vignettingAmount', -100, 100, null, 'Lens vignetting amount, -100 to 100'],
    vignettingMidpoint: ['vignettingMidpoint', -100, 100, null, 'Lens vignetting midpoint, -100 to 100'],
    resolution: ['resolution', 1, 10000, 'workflow_options', 'Workflow Options: resolution, pixels per inch'],
};
const CALIBRATION = ['redHue', 'redSaturation', 'greenHue', 'greenSaturation', 'blueHue', 'blueSaturation', 'shadowTint'];
const RAW_SETTINGS = { camera: 'CAMERA', selected_image: 'SELECTEDIMAGE', custom: 'CUSTOM' };
const WHITE_BALANCE = { as_shot: 'ASSHOT', auto: 'AUTO', daylight: 'DAYLIGHT', cloudy: 'CLOUDY', shade: 'SHADE', tungsten: 'TUNGSTEN', fluorescent: 'FLUORESCENT', flash: 'FLASH', custom: 'CUSTOM' };
const COLOR_SPACES = { srgb: 'SRGB', adobe_rgb: 'ADOBERGB', prophoto_rgb: 'PROPHOTORGB', colormatch_rgb: 'COLORMATCHRGB' };
const RAW_SIZES = { minimum: 'MINIMUM', small: 'SMALL', medium: 'MEDIUM', large: 'LARGE', extra_large: 'EXTRALARGE', maximum: 'MAXIMUM' };
const RAW_DEPTHS = { 8: 'EIGHT', 16: 'SIXTEEN' };

/**
 * Camera Raw Filter settings: the four-character key inside the
 * "Adobe Camera Raw Filter" descriptor, range, and whether it is a double.
 */
const ACR = {
    temperature: ['Temp', -100, 100, false, 'Basic: Temperature (relative), -100 to 100'],
    tint: ['Tint', -100, 100, false, 'Basic: Tint, -100 to 100'],
    exposure: ['Ex12', -5, 5, true, 'Basic: Exposure in stops, -5 to 5'],
    contrast: ['Cr12', -100, 100, false, 'Basic: Contrast'],
    highlights: ['Hi12', -100, 100, false, 'Basic: Highlights'],
    shadows: ['Sh12', -100, 100, false, 'Basic: Shadows'],
    whites: ['Wh12', -100, 100, false, 'Basic: Whites'],
    blacks: ['Bk12', -100, 100, false, 'Basic: Blacks'],
    texture: ['CrTx', -100, 100, false, 'Basic: Texture'],
    clarity: ['Cl12', -100, 100, false, 'Basic: Clarity'],
    dehaze: ['Dhze', -100, 100, false, 'Basic: Dehaze'],
    vibrance: ['Vibr', -100, 100, false, 'Basic: Vibrance'],
    sharpenAmount: ['Shrp', 0, 150, false, 'Detail: Sharpening amount, 0-150'],
    sharpenRadius: ['ShpR', 0.5, 3, true, 'Detail: Sharpening radius, 0.5-3'],
    sharpenDetail: ['ShpD', 0, 100, false, 'Detail: Sharpening detail'],
    sharpenMasking: ['ShpM', 0, 100, false, 'Detail: Sharpening masking'],
    luminanceNoiseReduction: ['LNR ', 0, 100, false, 'Detail: Noise Reduction (luminance)'],
    colorNoiseReduction: ['CNR ', 0, 100, false, 'Detail: Color Noise Reduction'],
    vignetteAmount: ['PCVA', -100, 100, false, 'Effects: Vignette amount'],
    vignetteMidpoint: ['PCVM', 0, 100, false, 'Effects: Vignette midpoint'],
    vignetteFeather: ['PCVF', 0, 100, false, 'Effects: Vignette feather'],
    grainAmount: ['GRNA', 0, 100, false, 'Effects: Grain amount'],
    grainSize: ['GRNS', 0, 100, false, 'Effects: Grain size'],
    grainRoughness: ['GRNF', 0, 100, false, 'Effects: Grain roughness'],
    saturation: ['Strt', -100, 100, false, 'Basic: Saturation'],
    curveHighlights: ['PC_H', -100, 100, false, 'Curve, parametric: Highlights'],
    curveLights: ['PC_L', -100, 100, false, 'Curve, parametric: Lights'],
    curveDarks: ['PC_D', -100, 100, false, 'Curve, parametric: Darks'],
    curveShadows: ['PC_S', -100, 100, false, 'Curve, parametric: Shadows'],
    curveShadowSplit: ['PC_1', 0, 100, false, 'Curve, parametric: split between shadows and darks. Default 25'],
    curveMidtoneSplit: ['PC_2', 0, 100, false, 'Curve, parametric: split between darks and lights. Default 50'],
    curveHighlightSplit: ['PC_3', 0, 100, false, 'Curve, parametric: split between lights and highlights. Default 75'],
    refineSaturation: ['crfs', 0, 100, false, 'Curve: Refine Saturation. Default 100'],
    luminanceDetail: ['LNRD', 0, 100, false, 'Detail: Noise Reduction detail'],
    luminanceContrast: ['LNRC', 0, 100, false, 'Detail: Noise Reduction contrast'],
    colorNoiseDetail: ['CNRD', 0, 100, false, 'Detail: Color Noise Reduction detail'],
    colorNoiseSmoothness: ['CNRS', 0, 100, false, 'Detail: Color Noise Reduction smoothness'],
    lensVignetteAmount: ['VigA', -100, 100, false, 'Optics: lens Vignetting amount'],
    lensVignetteMidpoint: ['VigM', 0, 100, false, 'Optics: lens Vignetting midpoint'],
    defringePurpleAmount: ['DfPA', 0, 20, false, 'Optics: Defringe purple amount, 0-20'],
    defringePurpleHueLow: ['DPHL', 0, 100, false, 'Optics: Defringe purple hue, low end'],
    defringePurpleHueHigh: ['DPHH', 0, 100, false, 'Optics: Defringe purple hue, high end'],
    defringeGreenAmount: ['DfGA', 0, 20, false, 'Optics: Defringe green amount, 0-20'],
    defringeGreenHueLow: ['DPGL', 0, 100, false, 'Optics: Defringe green hue, low end'],
    defringeGreenHueHigh: ['DPGH', 0, 100, false, 'Optics: Defringe green hue, high end'],
    vignetteRoundness: ['PCVR', -100, 100, false, 'Effects: Vignette roundness'],
};

/** Parametric curve region keys, and the split points sent with them (with Camera Raw's defaults). */
const CURVE_REGIONS = ['curveHighlights', 'curveLights', 'curveDarks', 'curveShadows'];
const CURVE_SPLITS = [['curveShadowSplit', 25], ['curveMidtoneSplit', 50], ['curveHighlightSplit', 75]];

/** Color Mixer (HSL) colour ranges and their key suffixes. */
const HSL_RANGES = { red: 'R', orange: 'O', yellow: 'Y', green: 'G', aqua: 'A', blue: 'B', purple: 'P', magenta: 'M' };
const HSL_KEYS = { hue: 'HA_', saturation: 'SA_', luminance: 'LA_' };

/** Color Grading wheels: hue, saturation and luminance keys. */
const GRADING = {
    shadows: ['STSH', 'STSS', 'CgSL'], midtones: ['CgMH', 'CgMS', 'CgML'],
    highlights: ['STHH', 'STHS', 'CgHL'], global: ['CgGH', 'CgGS', 'CgGL'],
};

/** Point curve channels and their keys (each a flat list of input, output pairs). */
const POINT_CURVES = { rgb: 'Crv ', red: 'CrvR', green: 'CrvG', blue: 'CrvB' };

/** Masking: local sliders, their XMP attribute and the divisor from the panel's value to the stored one. */
const LOCAL = {
    exposure: ['LocalExposure2012', 4, -4, 4], hue: ['LocalHue', 180, -180, 180], saturation: ['LocalSaturation', 100],
    sharpness: ['LocalSharpness', 100], contrast: ['LocalContrast2012', 100], highlights: ['LocalHighlights2012', 100],
    shadows: ['LocalShadows2012', 100], whites: ['LocalWhites2012', 100], blacks: ['LocalBlacks2012', 100],
    clarity: ['LocalClarity2012', 100], dehaze: ['LocalDehaze', 100], noise: ['LocalLuminanceNoise', 100],
    moire: ['LocalMoire', 100], defringe: ['LocalDefringe', 100], temperature: ['LocalTemperature', 100],
    tint: ['LocalTint', 100], texture: ['LocalTexture', 100], grain: ['LocalGrain', 100], glow: ['LocalGlow', 100],
};
/** Every correction carries these attributes, in this order: fixed values, or a LOCAL slider by name. */
const LOCAL_ORDER = [
    ['LocalExposure', '0'], 'hue', 'saturation', ['LocalContrast', '0'], ['LocalClarity', '0'], 'sharpness', ['LocalBrightness', '0'],
    ['LocalToningHue', '0'], ['LocalToningSaturation', '0'], 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
    'clarity', 'dehaze', 'noise', 'moire', 'defringe', 'temperature', 'tint', 'texture', 'grain', ['LocalCorrectedDepth', '0'], 'glow',
    ['LocalCurveRefineSaturation', '100'],
];
const MASK_TYPES = ['linear', 'radial', 'luminance_range'];

/** Neural filters: the filter id in the stack and its slider keys (spl::...), range and default. */
const NEURAL = {
    depth_blur: {
        id: 'internal.Hazy',
        feature: 'nf_depth_blur',
        options: { aperture: ['spl::slideAperture', 0, 100, 50], focalDistance: ['spl::slideFocalDist', 0, 100, 50], focalRange: ['spl::slideFocalRange', 0, 100, 50], haze: ['spl::sliderHaze', 0, 100, 0] },
        fixed: 'v.putInteger(__s("spl::sliderSelectResolutionLevel"), 2);\nv.putBoolean(__s("spl::generateDepthMap"), false);',
        nulls: ['spl::focalSelector', 'spl::sliderBrightness', 'spl::sliderSaturation', 'spl::sliderWarmness'],
    },
    style_transfer: {
        id: 'internal.StyleTransfer',
        feature: 'nf_style_transfer',
        options: { brushSize: ['spl::brushSize', 0, 100, 100], preserveWeight: ['spl::preserveWeight', 0, 100, 100], blur: ['spl::sliderBlur', 0, 100, 0] },
        fixed: 'v.putString(__s("spl::style_transfer_option"), "style_transfer");\nv.putInteger(__s("spl::sliderMultipleIterations"), 0);',
        nulls: ['spl::refImageAndCrop', 'spl::sliderBrightness', 'spl::sliderSaturation'],
    },
    photo_restoration: {
        id: 'internal.PhotoRestoration',
        feature: 'nf_photo_restoration',
        options: {
            enhance: ['spl::enhance', 0, 100, 100], faceEnhance: ['spl::faceEnhance', 0, 100, 60], scratches: ['spl::scratches', 0, 100, 100],
            luminanceNoise: ['spl::luminanceNoise', 0, 100, 100], colorNoise: ['spl::colorNoise', 0, 100, 100],
            halftoning: ['spl::halftoning', 0, 100, 100], removeJpeg: ['spl::removeJpeg', 0, 100, 100],
        },
        fixed: '',
        nulls: [],
    },
};

/** Sky Replacement settings: descriptor key, put method, range and default. */
const SKY = {
    shiftEdge: ['app.stringIDToTypeID("shiftEdge")', 'putDouble', -100, 100, 0, 'shift_edge', 'Shift Edge, -100 to 100'],
    fadeEdge: ['app.stringIDToTypeID("borderSmoothness")', 'putInteger', 0, 100, 25, 'fade_edge', 'Fade Edge, 0-100'],
    brightness: ['app.charIDToTypeID("Brgh")', 'putInteger', -100, 100, 0, 'brightness', 'Sky brightness, -100 to 100'],
    temperature: ['app.stringIDToTypeID("temperature")', 'putInteger', -100, 100, 0, 'temperature', 'Sky temperature, -100 to 100'],
    foregroundLighting: ['app.stringIDToTypeID("foregroundLightingOpacity")', 'putInteger', 0, 100, 50, 'foreground_lighting', 'Foreground Lighting adjustment, 0-100'],
    edgeLighting: ['app.stringIDToTypeID("edgeLightingOpacity")', 'putInteger', 0, 100, 50, 'edge_lighting', 'Edge Lighting, 0-100'],
    colorAdjustment: ['app.stringIDToTypeID("harmonizationOpacity")', 'putInteger', 0, 100, 50, 'color_adjustment', 'Color Adjustment, 0-100'],
};
const SKY_OUTPUT = { new_layers: 'skyReplacementOutputToNewSheets', duplicate_layer: 'skyReplacementOutputToDuplicateSheet' };
const LIGHTING = { screen: 'Scrn', multiply: 'Mltp' };

const numberSchema = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, description });
const objectOf = (keys, item, description) => ({ type: 'object', description, properties: Object.fromEntries(keys.map((k) => [k, item])) });
const POINT_SCHEMA = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };

/** A plain object argument, or a clear error. */
function plain(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    return value;
}

/** A whole number in range, as a number. */
const whole = (value, min, max, name) => Math.round(Number(num(value, { min, max, name })));

/** An XML attribute value, escaped. */
const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A number as Camera Raw writes it in XMP. */
const xmpNumber = (n) => String(Math.round(n * 1e6) / 1e6).replace(/^-0$/, '0');

/** A 32-digit hexadecimal sync id. */
const syncId = () => randomUUID().replace(/-/g, '').toUpperCase();

/**
 * One mask as XMP: pieces that are strings, or { px, axis } for a pixel
 * position the script divides by the document's width or height.
 */
function maskXmp(mask, name) {
    const m = plain(mask, name);
    const type = enumOf(m.type, MASK_TYPES, { name: `${name}.type` });
    const allowed = { linear: ['type', 'from', 'to', 'inverted'], radial: ['type', 'bounds', 'angle', 'feather', 'roundness', 'inverted'], luminance_range: ['type', 'min', 'max', 'softness', 'inverted'] }[type];
    const extra = Object.keys(m).filter((k) => !allowed.includes(k));
    if (extra.length) throw new Error(`'${name}' (${type}) has no ${extra.join(', ')}. Keys: ${allowed.join(', ')}`);
    if (m.inverted !== undefined && typeof m.inverted !== 'boolean') throw new Error(`'${name}.inverted' must be true or false`);
    const head = (what, label) => [
        `crs:What="${what}" crs:MaskActive="true" crs:MaskName="${xml(label)}" crs:MaskBlendMode="0" crs:MaskInverted="${m.inverted ? 'true' : 'false'}" crs:MaskSyncID="${syncId()}" crs:MaskValue="1"`,
    ];
    const px = (v, axis, key) => ({ px: Number(num(v, { min: -100000, max: 100000, name: key })), axis });
    const at = (p, key) => {
        plain(p, key);
        return [px(p.x, 'w', `${key}.x`), px(p.y, 'h', `${key}.y`)];
    };
    if (type === 'linear') {
        const [fx, fy] = at(m.from, `${name}.from`), [tx, ty] = at(m.to, `${name}.to`);
        return ['<rdf:li ', ...head('Mask/Gradient', 'Linear Gradient'), ' crs:ZeroX="', fx, '" crs:ZeroY="', fy, '" crs:FullX="', tx, '" crs:FullY="', ty, '"/>'];
    }
    if (type === 'radial') {
        const b = plain(m.bounds, `${name}.bounds`);
        const x = Number(num(b.x, { min: -100000, max: 100000, name: `${name}.bounds.x` })), y = Number(num(b.y, { min: -100000, max: 100000, name: `${name}.bounds.y` }));
        const bw = Number(num(b.width, { min: 1, max: 300000, name: `${name}.bounds.width` })), bh = Number(num(b.height, { min: 1, max: 300000, name: `${name}.bounds.height` }));
        const angle = Number(num(m.angle ?? 0, { min: -360, max: 360, name: `${name}.angle` }));
        const feather = Number(num(m.feather ?? 50, { min: 0, max: 100, name: `${name}.feather` }));
        const roundness = Number(num(m.roundness ?? 0, { min: 0, max: 100, name: `${name}.roundness` }));
        return ['<rdf:li ', ...head('Mask/CircularGradient', 'Radial Gradient'), ' crs:Top="', { px: y, axis: 'h' }, '" crs:Left="', { px: x, axis: 'w' }, '" crs:Bottom="', { px: y + bh, axis: 'h' }, '" crs:Right="', { px: x + bw, axis: 'w' },
            `" crs:Angle="${xmpNumber(angle)}" crs:Midpoint="50" crs:Roundness="${xmpNumber(roundness)}" crs:Feather="${xmpNumber(feather)}" crs:Flipped="false" crs:Version="2"/>`];
    }
    const low = Number(num(m.min ?? 0, { min: 0, max: 100, name: `${name}.min` })) / 100;
    const high = Number(num(m.max ?? 100, { min: 0, max: 100, name: `${name}.max` })) / 100;
    if (low > high) throw new Error(`'${name}.min' must not be above '${name}.max'`);
    const soft = Number(num(m.softness ?? 0, { min: 0, max: 100, name: `${name}.softness` })) / 100;
    const range = [Math.max(0, low - soft), low, high, Math.min(1, high + soft)].map((v) => v.toFixed(6)).join(' ');
    return ['<rdf:li><rdf:Description ', ...head('Mask/RangeMask', 'Luminance Range'), `><crs:CorrectionRangeMask crs:Version="4" crs:Type="2" crs:Invert="false" crs:SampleType="2" crs:LumRange="${range}"/></rdf:Description></rdf:li>`];
}

/** The Masking panel's local corrections as one crs:MaskGroupBasedCorrections XMP packet (pieces, as maskXmp). */
function localCorrectionsXmp(list) {
    if (!Array.isArray(list) || !list.length || list.length > 20) throw new Error("'localCorrections' takes 1 to 20 corrections");
    const pieces = ['<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"><crs:MaskGroupBasedCorrections><rdf:Seq>'];
    list.forEach((entry, i) => {
        const name = `localCorrections[${i}]`;
        const e = plain(entry, name);
        const extra = Object.keys(e).filter((k) => !['mask', 'amount', 'name', ...Object.keys(LOCAL)].includes(k));
        if (extra.length) throw new Error(`'${name}' has no ${extra.join(', ')}. Keys: mask, amount, name, ${Object.keys(LOCAL).join(', ')}`);
        const amount = Number(num(e.amount ?? 100, { min: 0, max: 100, name: `${name}.amount` })) / 100;
        if (e.name !== undefined && typeof e.name !== 'string') throw new Error(`'${name}.name' must be a string`);
        const attrs = LOCAL_ORDER.map((slot) => {
            if (Array.isArray(slot)) return `crs:${slot[0]}="${slot[1]}"`;
            const [key, divisor, min = -100, max = 100] = LOCAL[slot];
            const value = e[slot] === undefined ? 0 : Number(num(e[slot], { min, max, name: `${name}.${slot}` })) / divisor;
            return `crs:${key}="${xmpNumber(value)}"`;
        });
        pieces.push(`<rdf:li><rdf:Description crs:What="Correction" crs:CorrectionAmount="${xmpNumber(amount)}" crs:CorrectionActive="true" crs:CorrectionName="${xml(e.name ?? `Mask ${i + 1}`)}" crs:CorrectionSyncID="${syncId()}" ${attrs.join(' ')}><crs:CorrectionMasks><rdf:Seq>`,
            ...maskXmp(e.mask, `${name}.mask`), '</rdf:Seq></crs:CorrectionMasks></rdf:Description></rdf:li>');
    });
    pieces.push('</rdf:Seq></crs:MaskGroupBasedCorrections></rdf:Description></rdf:RDF></x:xmpmeta>');
    return pieces;
}

/** XMP pieces as one ES3 string expression; pixel positions become fractions of the document (w, h in the script). */
const xmpExpression = (pieces) => pieces.map((p) => (typeof p === 'string' ? str(p) : `__xn(${p.px} / ${p.axis})`)).join(' + ');

/** The Camera Raw Filter settings beyond the flat sliders, as descriptor statements on `d`. */
function extraSettings(a, puts) {
    if (a.hsl !== undefined) {
        for (const [range, values] of Object.entries(plain(a.hsl, 'hsl'))) {
            const suffix = HSL_RANGES[enumOf(range, Object.keys(HSL_RANGES), { name: 'hsl' })];
            for (const [k, v] of Object.entries(plain(values, `hsl.${range}`))) {
                const prefix = HSL_KEYS[enumOf(k, Object.keys(HSL_KEYS), { name: `hsl.${range}` })];
                puts.push(`d.putInteger(app.charIDToTypeID(${str(prefix + suffix)}), ${whole(v, -100, 100, `hsl.${range}.${k}`)});`);
            }
        }
    }
    if (a.colorGrading !== undefined) {
        for (const [k, v] of Object.entries(plain(a.colorGrading, 'colorGrading'))) {
            if (k === 'blending') { puts.push(`d.putInteger(app.charIDToTypeID("CgBl"), ${whole(v, 0, 100, 'colorGrading.blending')});`); continue; }
            if (k === 'balance') { puts.push(`d.putInteger(app.charIDToTypeID("STB "), ${whole(v, -100, 100, 'colorGrading.balance')});`); continue; }
            const keys = GRADING[enumOf(k, [...Object.keys(GRADING), 'blending', 'balance'], { name: 'colorGrading' })];
            for (const [part, x] of Object.entries(plain(v, `colorGrading.${k}`))) {
                const i = ['hue', 'saturation', 'luminance'].indexOf(enumOf(part, ['hue', 'saturation', 'luminance'], { name: `colorGrading.${k}` }));
                const [min, max] = [[0, 360], [0, 100], [-100, 100]][i];
                puts.push(`d.putInteger(app.charIDToTypeID(${str(keys[i])}), ${whole(x, min, max, `colorGrading.${k}.${part}`)});`);
            }
        }
    }
    if (a.pointCurve !== undefined) {
        for (const [channel, points] of Object.entries(plain(a.pointCurve, 'pointCurve'))) {
            const key = POINT_CURVES[enumOf(channel, Object.keys(POINT_CURVES), { name: 'pointCurve' })];
            const name = `pointCurve.${channel}`;
            if (!Array.isArray(points) || points.length < 2 || points.length > 16) throw new Error(`'${name}' needs 2 to 16 [input, output] points`);
            const flat = points.flatMap((p, i) => {
                if (!Array.isArray(p) || p.length !== 2) throw new Error(`'${name}[${i}]' must be [input, output]`);
                return p.map((x, j) => whole(x, 0, 255, `${name}[${i}][${j}]`));
            });
            for (let i = 2; i < flat.length; i += 2) if (flat[i] <= flat[i - 2]) throw new Error(`'${name}' inputs must increase`);
            puts.push(`var cl = new ActionList();
  ${flat.map((x) => `cl.putInteger(${x});`).join(' ')}
  d.putList(app.charIDToTypeID(${str(key)}), cl);`);
        }
    }
    if (a.localCorrections !== undefined) {
        puts.push(`var w = __px(doc.width), h = __px(doc.height);
  d.putString(app.charIDToTypeID("LCs "), ${xmpExpression(localCorrectionsXmp(a.localCorrections))});`);
    }
}

/** Make each target layer active in turn and run `body` (which sees `l`). */
const eachTarget = (target, body) => `
var items = __targets(doc, ${targetSpec(target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  doc.activeLayer = l;
  ${body}
  out.push(__layerInfo(doc.activeLayer));
}`;

export const tools = [
    {
        name: 'open_raw_file',
        description: 'Open a camera raw file through Camera Raw without its dialog, with the camera\'s defaults, the settings last used, or custom Basic, Detail, Lens and Calibration values and Workflow Options (colour space, bit depth, size, resolution). These are the object model\'s older Camera Raw controls',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path to the raw file' },
                settings: { type: 'string', enum: Object.keys(RAW_SETTINGS), description: 'camera (Camera Raw defaults), selected_image (the settings last used) or custom (the values given). Default custom when values are given, otherwise camera' },
                whiteBalance: { type: 'string', enum: Object.keys(WHITE_BALANCE), description: 'White balance preset' },
                ...Object.fromEntries(Object.entries(RAW_NUMBERS).map(([k, v]) => [k, numberSchema(v[1], v[2], v[4])])),
                calibration: {
                    type: 'object',
                    description: 'Calibration: hue and saturation of each primary and the shadow tint, each -100 to 100',
                    properties: Object.fromEntries(CALIBRATION.map((k) => [k, numberSchema(-100, 100, k)])),
                },
                colorSpace: { type: 'string', enum: Object.keys(COLOR_SPACES), description: 'Workflow Options: colour space' },
                bitsPerChannel: { type: 'integer', enum: [8, 16], description: 'Workflow Options: bit depth' },
                size: { type: 'string', enum: Object.keys(RAW_SIZES), description: 'Workflow Options: image size' },
            },
            required: ['filePath'],
        },
        auditArgs: { settings: 'custom', temperature: 5500, exposure: 0.5, calibration: { redHue: 5, shadowTint: -3 }, bitsPerChannel: 16 },
        features: [...new Set([
            `${CR}camera_raw`, `${CR}camera_raw_open_options`, `${CR}workflow_options`,
            ...['white_balance', 'calibration', 'workflow_options'].map((f) => OPT + f),
            ...Object.values(RAW_NUMBERS).map((v) => v[3]).filter(Boolean).map((f) => OPT + f),
        ])],
        handler: (a) => {
            const file = paths.validate(a.filePath);
            const lines = [];
            const set = (prop, value) => lines.push(`o.${prop} = ${value};`);
            let custom = false;
            for (const [k, [prop, min, max]] of Object.entries(RAW_NUMBERS)) {
                if (a[k] === undefined) continue;
                set(prop, num(a[k], { min, max, name: k }));
                if (k !== 'resolution') custom = true;
            }
            if (a.calibration !== undefined) {
                if (!a.calibration || typeof a.calibration !== 'object' || Array.isArray(a.calibration)) throw new Error("'calibration' is an object");
                for (const [k, v] of Object.entries(a.calibration)) {
                    set(enumOf(k, CALIBRATION, { name: 'calibration' }), num(v, { min: -100, max: 100, name: `calibration.${k}` }));
                    custom = true;
                }
            }
            if (a.whiteBalance !== undefined) {
                set('whiteBalance', `WhiteBalanceType.${WHITE_BALANCE[enumOf(a.whiteBalance, Object.keys(WHITE_BALANCE), { name: 'whiteBalance' })]}`);
                custom = true;
            }
            if (a.colorSpace !== undefined) set('colorSpace', `ColorSpaceType.${COLOR_SPACES[enumOf(a.colorSpace, Object.keys(COLOR_SPACES), { name: 'colorSpace' })]}`);
            if (a.bitsPerChannel !== undefined) set('bitsPerChannel', `BitsPerChannelType.${RAW_DEPTHS[enumOf(String(a.bitsPerChannel), Object.keys(RAW_DEPTHS), { name: 'bitsPerChannel' })]}`);
            if (a.size !== undefined) set('size', `CameraRAWSize.${RAW_SIZES[enumOf(a.size, Object.keys(RAW_SIZES), { name: 'size' })]}`);
            const settings = enumOf(a.settings ?? (custom ? 'custom' : 'camera'), Object.keys(RAW_SETTINGS), { name: 'settings' });
            if (custom && settings !== 'custom') throw new Error(`Adjustment values need settings: custom (got ${settings})`);
            return run('Open raw file', script(`
var f = new File(${jsxPath(file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var o = new CameraRAWOpenOptions();
o.settings = CameraRAWSettingsType.${RAW_SETTINGS[settings]};
${lines.join('\n')}
var d = app.open(f, o);
__result__ = __docInfo(d);`, { needsDocument: false }));
        },
    },
    {
        name: 'apply_camera_raw_settings',
        description: 'Apply Filter > Camera Raw Filter to layers without its dialog, with the settings of its panels: Basic (white balance, exposure, contrast, highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance, saturation), Curve (parametric regions and splits, point curves, refine saturation), Detail (sharpening, noise reduction), Color Mixer (HSL), Color Grading (wheels, blending, balance), Optics (lens vignetting, defringe), Effects (vignette, grain) and Masking (local corrections through linear gradient, radial gradient and luminance range masks; these replace any local corrections the filter had). On a smart object it is added as an editable smart filter; on a pixel layer it changes the pixels. Settings not given stay at Camera Raw\'s defaults',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Pixel or smart object layers. Default the active layer' },
                settings: { type: 'object', description: 'Camera Raw slider values. Temperature and tint are relative (-100 to 100) and set white balance to Custom', properties: Object.fromEntries(Object.entries(ACR).map(([k, v]) => [k, numberSchema(v[1], v[2], v[4])])) },
                whiteBalance: { type: 'string', enum: ['as_shot', 'custom'], description: 'Basic: White Balance. as_shot uses the camera\'s; custom goes with temperature and tint (the default when they are given)' },
                hsl: objectOf(Object.keys(HSL_RANGES), objectOf(Object.keys(HSL_KEYS), numberSchema(-100, 100)), 'Color Mixer, HSL: per colour range { hue, saturation, luminance }, each -100 to 100, e.g. { "blue": { "saturation": -30 } }'),
                colorGrading: {
                    type: 'object',
                    description: 'Color Grading: shadows, midtones, highlights and global wheels { hue 0-360, saturation 0-100, luminance -100 to 100 }, blending 0-100 and balance -100 to 100',
                    properties: { ...Object.fromEntries(Object.keys(GRADING).map((k) => [k, { type: 'object', properties: { hue: numberSchema(0, 360), saturation: numberSchema(0, 100), luminance: numberSchema(-100, 100) } }])), blending: numberSchema(0, 100, 'Blending'), balance: numberSchema(-100, 100, 'Balance') },
                },
                pointCurve: objectOf(Object.keys(POINT_CURVES), { type: 'array', minItems: 2, maxItems: 16, items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2 } }, 'Curve, point curve per channel (rgb, red, green, blue): [[input, output], ...], 0-255, inputs increasing'),
                localCorrections: {
                    type: 'array', minItems: 1, maxItems: 20,
                    description: 'Masking: local corrections, each a mask and the sliders it applies. mask: { type: "linear", from: { x, y } (no effect), to: { x, y } (full effect) }, { type: "radial", bounds: { x, y, width, height }, angle, feather 0-100 (default 50), roundness 0-100 }, or { type: "luminance_range", min, max, softness } (0-100); positions in document pixels; inverted: true flips any mask. Sliders: exposure (-4 to 4), hue (-180 to 180), and -100 to 100 for the rest. amount 0-100 (default 100) scales them',
                    items: {
                        type: 'object',
                        properties: {
                            mask: { type: 'object', properties: { type: { type: 'string', enum: MASK_TYPES }, from: POINT_SCHEMA, to: POINT_SCHEMA, bounds: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } }, angle: { type: 'number' }, feather: { type: 'number' }, roundness: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, softness: { type: 'number' }, inverted: { type: 'boolean' } }, required: ['type'] },
                            amount: numberSchema(0, 100, 'Amount, percent'),
                            name: { type: 'string', description: 'Mask name in the Masking panel' },
                            ...Object.fromEntries(Object.entries(LOCAL).map(([k, v]) => [k, numberSchema(v[2] ?? -100, v[3] ?? 100)])),
                        },
                        required: ['mask'],
                    },
                },
            },
        },
        auditArgs: { settings: { exposure: 0.5, contrast: 20, temperature: 10, sharpenRadius: 1.2 }, whiteBalance: undefined, hsl: undefined, colorGrading: undefined, pointCurve: undefined, localCorrections: undefined },
        features: [
            `${CR}camera_raw_filter_settings`, `${CR}panel_basic_option.exposure_all`,
            ...['basic', 'curve', 'detail', 'color_mixer', 'color_grading', 'optics', 'effects', 'masking'].map((k) => `${CR}panel_${k}`),
            ...['as_shot', 'temperature', 'tint', 'contrast_all', 'highlights_pv2012', 'shadows_pv2012', 'whites_pv2012', 'blacks_pv2012', 'clarity', 'vibrance', 'saturation', 'dehaze'].map((k) => `${CR}panel_basic_option.${k}`),
            ...['parametric_curve', 'point_curve', 'refine_saturation'].map((k) => `${CR}panel_curve_option.${k}`),
            `${CR}panel_color_mixer_option.hsl`, `${CR}panel_color_grading_option.blending`, `${CR}panel_color_grading_option.balance`,
        ],
        handler: (a) => {
            const given = a.settings ?? {};
            if (typeof given !== 'object' || Array.isArray(given)) throw new Error("'settings' must be an object");
            const extras = ['whiteBalance', 'hsl', 'colorGrading', 'pointCurve', 'localCorrections'].filter((k) => a[k] !== undefined);
            if (!Object.keys(given).length && !extras.length) throw new Error(`Give at least one setting: settings (${Object.keys(ACR).join(', ')}), whiteBalance, hsl, colorGrading, pointCurve or localCorrections`);
            const values = {};
            const puts = Object.entries(given).map(([k, v]) => {
                const [key, min, max, double] = ACR[enumOf(k, Object.keys(ACR), { name: 'settings' })];
                const n = num(v, { min, max, name: `settings.${k}` });
                values[k] = Number(n);
                return `d.${double ? 'putDouble' : 'putInteger'}(app.charIDToTypeID(${str(key)}), ${double ? n : Math.round(Number(n))});`;
            });
            const wb = a.whiteBalance === undefined ? undefined : enumOf(a.whiteBalance, ['as_shot', 'custom'], { name: 'whiteBalance' });
            const relative = given.temperature !== undefined || given.tint !== undefined;
            if (wb === 'as_shot' && relative) throw new Error('whiteBalance as_shot takes no temperature or tint');
            if (wb === 'as_shot') puts.unshift('d.putEnumerated(app.charIDToTypeID("WBal"), app.charIDToTypeID("WBal"), app.charIDToTypeID("AsSh"));');
            else if (relative || wb === 'custom') puts.unshift('d.putEnumerated(app.charIDToTypeID("WBal"), app.charIDToTypeID("WBal"), app.charIDToTypeID("Cst "));');
            if (CURVE_REGIONS.some((k) => given[k] !== undefined) || CURVE_SPLITS.some(([k]) => given[k] !== undefined)) {
                const splits = CURVE_SPLITS.map(([k, fallback]) => values[k] ?? fallback);
                if (!(splits[0] < splits[1] && splits[1] < splits[2])) throw new Error('The parametric curve splits must increase: curveShadowSplit < curveMidtoneSplit < curveHighlightSplit');
                CURVE_SPLITS.forEach(([k, fallback]) => { if (given[k] === undefined) puts.push(`d.putInteger(app.charIDToTypeID(${str(ACR[k][0])}), ${fallback});`); });
            }
            for (const hue of ['Purple', 'Green']) {
                const lo = values[`defringe${hue}HueLow`], hi = values[`defringe${hue}HueHigh`];
                if (lo !== undefined && hi !== undefined && lo >= hi) throw new Error(`settings.defringe${hue}HueLow must be below settings.defringe${hue}HueHigh`);
            }
            extraSettings(a, puts);
            const helpers = a.localCorrections !== undefined ? 'var __xn = function (v) { return String(Math.round(v * 1000000) / 1000000); };\n' : '';
            return run('Camera Raw Filter', script(helpers + eachTarget(a.target, `var d = new ActionDescriptor();
  d.putString(app.charIDToTypeID("CrVe"), "18.2.2");
  d.putInteger(app.charIDToTypeID("PrVN"), 6);
  d.putInteger(app.charIDToTypeID("PrVe"), 251920384);
  ${puts.join('\n  ')}
  app.executeAction(app.stringIDToTypeID("Adobe Camera Raw Filter"), d, DialogModes.NO);`) + `
__result__ = { applied: ${puts.length}, layers: out };`));
        },
    },
    {
        name: 'apply_neural_filter',
        description: 'Run a Neural Filter (Filter > Neural Filters) on the active layer without its workspace: Depth Blur, Style Transfer or Photo Restoration. The filter must already be downloaded in the Neural Filters panel; some filters process in the cloud and need a signed-in Adobe account',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string', enum: Object.keys(NEURAL), description: 'The filter' },
                style: { type: 'string', description: 'style_transfer: preset style id. Default "style28_crop"' },
                preserveColor: { type: 'boolean', description: 'style_transfer: keep the image\'s colours. Default false' },
                options: { type: 'object', description: 'Sliders, 0-100. depth_blur: aperture, focalDistance, focalRange, haze. style_transfer: brushSize, preserveWeight, blur. photo_restoration: enhance (Photo Enhancement), faceEnhance (Enhance Face), scratches (Scratch Reduction), luminanceNoise, colorNoise, halftoning (Halftone Artifacts Reduction), removeJpeg (JPEG Artifacts Reduction)' },
            },
            required: ['filter'],
        },
        hints: { openWorld: true },
        auditArgs: { filter: 'style_transfer', options: { blur: 10 } },
        features: [`${CR}neural_filters`, `${CR}nf_depth_blur`, `${CR}nf_style_transfer`, `${CR}nf_photo_restoration`],
        handler: (a) => {
            const key = enumOf(a.filter, Object.keys(NEURAL), { name: 'filter' });
            const spec = NEURAL[key];
            const given = a.options ?? {};
            if (typeof given !== 'object' || Array.isArray(given)) throw new Error("'options' is an object");
            for (const k of Object.keys(given)) enumOf(k, Object.keys(spec.options), { name: `${key} options` });
            if (key !== 'style_transfer' && (a.style !== undefined || a.preserveColor !== undefined)) throw new Error('style and preserveColor are style_transfer settings');
            const lines = Object.entries(spec.options).map(([k, [id, min, max, fallback]]) => `v.putInteger(__s(${str(id)}), ${Math.round(Number(num(given[k] ?? fallback, { min, max, name: `options.${k}` })))});`);
            if (key === 'style_transfer') {
                lines.push(`v.putString(__s("spl::style"), ${str(a.style ?? 'style28_crop')});`, `v.putBoolean(__s("spl::preserveColor"), ${bool(a.preserveColor)});`);
            }
            lines.push(...(spec.fixed ? [spec.fixed] : []), ...spec.nulls.map((n) => `v.putClass(__s(${str(n)}), __s("jsonNull"));`));
            return run('Neural filter', script(`
var __s = function (id) { return app.stringIDToTypeID(id); };
var before = 0;
__eachLayer(doc, function () { before++; });
var v = new ActionDescriptor();
${lines.join('\n')}
var crop = new ActionDescriptor();
crop.putString(__s("spl::cropId"), "layer1");
crop.putObject(__s("spl::values"), __s("spl::values"), v);
var crops = new ActionList();
crops.putObject(__s("spl::cropStates"), crop);
var f = new ActionDescriptor();
f.putList(__s("spl::cropStates"), crops);
f.putBoolean(__s("spl::enabled"), true);
f.putString(__s("spl::id"), ${str(spec.id)});
f.putString(__s("spl::version"), "1.0");
var stack = new ActionList();
stack.putObject(__s("spl::filterStack"), f);
var ui = new ActionDescriptor();
ui.putList(__s("spl::filterStack"), stack);
ui.putString(__s("spl::version"), "1.0.6");
var d = new ActionDescriptor();
d.putObject(__s("NF_UI_DATA"), __s("NF_UI_DATA"), ui);
d.putInteger(__s("NF_OUTPUT_TYPE"), 2);
app.executeAction(__s("neuralGalleryFilters"), d, DialogModes.NO);
var after = 0;
__eachLayer(app.activeDocument, function () { after++; });
__result__ = { filter: ${str(key)}, layersBefore: before, layersAfter: after, activeLayer: __layerInfo(app.activeDocument.activeLayer) };`));
        },
    },
    {
        name: 'replace_sky',
        description: 'Replace the sky in the active document (Edit > Sky Replacement) with an image file, without the dialog. Photoshop finds the sky, adds a Sky Replacement group with the new sky and lighting and colour layers, and returns it. Edge, brightness, temperature, lighting and colour settings match the dialog\'s',
        inputSchema: {
            type: 'object',
            properties: {
                skyFile: { type: 'string', description: 'Absolute path to the sky image (a Sky_Presets image or any JPEG or PNG)' },
                ...Object.fromEntries(Object.entries(SKY).map(([k, v]) => [k, { ...numberSchema(v[2], v[3], `${v[6]}. Default ${v[4]}`), default: v[4] }])),
                lightingMode: { type: 'string', enum: Object.keys(LIGHTING), description: 'Lighting mode for the foreground lighting layer. Default screen; Photoshop may choose its own blend from the sky', default: 'screen' },
                output: { type: 'string', enum: Object.keys(SKY_OUTPUT), description: 'Output to new layers (default) or a duplicate layer', default: 'new_layers' },
            },
            required: ['skyFile'],
        },
        hints: { openWorld: true },
        features: [`${CR}sky_replacement`, ...Object.values(SKY).map((v) => `${CR}sky_replacement_option.${v[5]}`), `${CR}sky_replacement_option.lighting_mode`, `${CR}sky_replacement_option.output`],
        handler: (a) => {
            const sky = paths.validate(a.skyFile);
            const puts = Object.entries(SKY).map(([k, [key, put, min, max, fallback]]) => {
                const n = num(a[k] ?? fallback, { min, max, name: k });
                return `d.${put}(${key}, ${put === 'putInteger' ? Math.round(Number(n)) : n});`;
            });
            const mode = LIGHTING[enumOf(a.lightingMode ?? 'screen', Object.keys(LIGHTING), { name: 'lightingMode' })];
            const output = SKY_OUTPUT[enumOf(a.output ?? 'new_layers', Object.keys(SKY_OUTPUT), { name: 'output' })];
            return run('Sky replacement', script(`
var f = new File(${jsxPath(sky)});
if (!f.exists) throw new Error("Sky image not found: " + f.fsName);
var known = {};
__eachLayer(doc, function (x) { known["i" + x.id] = true; });
var d = new ActionDescriptor();
${puts.join('\n')}
d.putEnumerated(app.stringIDToTypeID("lightingMode"), app.charIDToTypeID("BlnM"), app.charIDToTypeID(${str(mode)}));
d.putEnumerated(app.stringIDToTypeID("skyReplacementOutput"), app.stringIDToTypeID("skyReplacementOutput"), app.stringIDToTypeID(${str(output)}));
d.putString(app.charIDToTypeID("Idnt"), ${str(randomUUID())});
d.putString(app.charIDToTypeID("Nm  "), ${str(path.basename(sky))});
d.putPath(app.charIDToTypeID("File"), f);
app.executeAction(app.stringIDToTypeID("skyReplacement"), d, DialogModes.NO);
var added = [];
__eachLayer(doc, function (x) { if (!known["i" + x.id]) added.push(__layerInfo(x)); });
if (!added.length) throw new Error("Sky Replacement made no layers: the image may have no sky Photoshop can find");
__result__ = { sky: f.fsName, added: added };`));
        },
    },
    {
        name: 'remove_background',
        description: 'Remove the background of layers (the Properties panel\'s Remove Background quick action): Photoshop finds the subject and adds a layer mask hiding the rest. It uses the Select Subject model, which may process in the cloud depending on Preferences > Image Processing',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Layers. Default the active layer' } } },
        hints: { openWorld: true },
        features: [`${CR}remove_background`, 'photoshop.generative.generate_background_option.remove_background'],
        handler: (a) => run('Remove background', script(eachTarget(a.target, 'app.executeAction(app.stringIDToTypeID("removeBackground"), new ActionDescriptor(), DialogModes.NO);') + `
__result__ = { layers: out };`)),
    },
];
