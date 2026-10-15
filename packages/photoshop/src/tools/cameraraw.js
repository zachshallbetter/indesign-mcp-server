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
};

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
        description: 'Apply Filter > Camera Raw Filter to layers without its dialog: Basic (white balance, exposure, contrast, highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance), Detail (sharpening, noise reduction) and Effects (vignette, grain). On a smart object it is added as an editable smart filter; on a pixel layer it changes the pixels. Settings not given stay at zero',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Pixel or smart object layers. Default the active layer' },
                settings: { type: 'object', description: 'Camera Raw values', properties: Object.fromEntries(Object.entries(ACR).map(([k, v]) => [k, numberSchema(v[1], v[2], v[4])])) },
            },
            required: ['settings'],
        },
        auditArgs: { settings: { exposure: 0.5, contrast: 20, temperature: 10, sharpenRadius: 1.2 } },
        features: [`${CR}camera_raw_filter_settings`, `${CR}panel_basic_option.exposure_all`],
        handler: (a) => {
            const given = a.settings;
            if (!given || typeof given !== 'object' || Array.isArray(given) || !Object.keys(given).length) throw new Error(`'settings' needs at least one of ${Object.keys(ACR).join(', ')}`);
            const puts = Object.entries(given).map(([k, v]) => {
                const [key, min, max, double] = ACR[enumOf(k, Object.keys(ACR), { name: 'settings' })];
                const n = num(v, { min, max, name: `settings.${k}` });
                return `d.${double ? 'putDouble' : 'putInteger'}(app.charIDToTypeID(${str(key)}), ${double ? n : Math.round(Number(n))});`;
            });
            if (given.temperature !== undefined || given.tint !== undefined) puts.unshift('d.putEnumerated(app.charIDToTypeID("WBal"), app.charIDToTypeID("WBal"), app.charIDToTypeID("Cst "));');
            return run('Camera Raw Filter', script(eachTarget(a.target, `var d = new ActionDescriptor();
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
        description: 'Run a Neural Filter (Filter > Neural Filters) on the active layer without its workspace: Depth Blur or Style Transfer. The filter must already be downloaded in the Neural Filters panel; some filters process in the cloud and need a signed-in Adobe account',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string', enum: Object.keys(NEURAL), description: 'The filter' },
                style: { type: 'string', description: 'style_transfer: preset style id. Default "style28_crop"' },
                preserveColor: { type: 'boolean', description: 'style_transfer: keep the image\'s colours. Default false' },
                options: { type: 'object', description: 'Sliders, 0-100. depth_blur: aperture, focalDistance, focalRange, haze. style_transfer: brushSize, preserveWeight, blur' },
            },
            required: ['filter'],
        },
        hints: { openWorld: true },
        auditArgs: { filter: 'style_transfer', options: { blur: 10 } },
        features: [`${CR}neural_filters`, `${CR}nf_depth_blur`, `${CR}nf_style_transfer`],
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
            lines.push(spec.fixed, ...spec.nulls.map((n) => `v.putClass(__s(${str(n)}), __s("jsonNull"));`));
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
