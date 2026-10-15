/**
 * Whole-image operations: Image Size, Canvas Size, crop, trim, rotate and flip
 * the canvas, colour mode and bit depth (with the Indexed Color and Bitmap
 * conversion options), the colour table, pixel aspect ratio, colour profiles,
 * flatten and merge, the histogram and colour sampling.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM_HELPERS } from '../actions.js';
import { COLOR_SCHEMA, RECT_SCHEMA, colorSpec, rect } from '../args.js';

const RESAMPLE = {
    automatic: 'AUTOMATIC', preserve_details: 'PRESERVEDETAILS', bicubic_smoother: 'BICUBICSMOOTHER', bicubic_sharper: 'BICUBICSHARPER',
    bicubic: 'BICUBIC', bilinear: 'BILINEAR', nearest_neighbor: 'NEARESTNEIGHBOR', none: 'NONE',
};
const ANCHORS = {
    top_left: 'TOPLEFT', top: 'TOPCENTER', top_right: 'TOPRIGHT', left: 'MIDDLELEFT', center: 'MIDDLECENTER',
    right: 'MIDDLERIGHT', bottom_left: 'BOTTOMLEFT', bottom: 'BOTTOMCENTER', bottom_right: 'BOTTOMRIGHT',
};
const MODES = { rgb: 'RGB', cmyk: 'CMYK', grayscale: 'GRAYSCALE', lab: 'LAB', bitmap: 'BITMAP', indexed: 'INDEXEDCOLOR', multichannel: 'MULTICHANNEL' };
const DEPTHS = { 1: 'ONE', 8: 'EIGHT', 16: 'SIXTEEN', 32: 'THIRTYTWO' };
const INTENTS = { perceptual: 'PERCEPTUAL', saturation: 'SATURATION', relative_colorimetric: 'RELATIVECOLORIMETRIC', absolute_colorimetric: 'ABSOLUTECOLORIMETRIC' };

// Image Size's interpolation enum (interpolationType) for each resample method.
const INTERPOLATION = {
    automatic: 'automaticInterpolation', preserve_details: 'preserveDetailsUpscale', bicubic_smoother: 'bicubicSmoother', bicubic_sharper: 'bicubicSharper',
    bicubic: 'bicubic', bilinear: 'bilinear', nearest_neighbor: 'nearestNeighbor',
};
// Canvas Size: anchor to horizontalLocation / verticalLocation, and the extension colours.
const CANVAS_H = { top_left: 'left', top: 'center', top_right: 'right', left: 'left', center: 'center', right: 'right', bottom_left: 'left', bottom: 'center', bottom_right: 'right' };
const CANVAS_V = { top_left: 'top', top: 'top', top_right: 'top', left: 'center', center: 'center', right: 'center', bottom_left: 'bottom', bottom: 'bottom', bottom_right: 'bottom' };
const EXTENSION_COLORS = { foreground: 'foregroundColor', background: 'backgroundColor', white: 'white', black: 'black', gray: 'gray' };

const PALETTES = {
    exact: 'EXACT', mac_os: 'MACOSPALETTE', windows: 'WINDOWSPALETTE', web: 'WEBPALETTE', uniform: 'UNIFORM', local_perceptual: 'LOCALPERCEPTUAL',
    local_selective: 'LOCALSELECTIVE', local_adaptive: 'LOCALADAPTIVE', master_perceptual: 'MASTERPERCEPTUAL', master_selective: 'MASTERSELECTIVE',
    master_adaptive: 'MASTERADAPTIVE', previous: 'PREVIOUSPALETTE',
};
const FORCED = { none: 'NONE', black_white: 'BLACKWHITE', primaries: 'PRIMARIES', web: 'WEB' };
const MATTES = { none: 'NONE', foreground: 'FOREGROUND', background: 'BACKGROUND', white: 'WHITE', black: 'BLACK', fifty_percent_gray: 'SEMIGRAY', netscape_gray: 'NETSCAPE' };
const DITHERS = { none: 'NONE', diffusion: 'DIFFUSION', pattern: 'PATTERN', noise: 'NOISE' };
const BITMAP_METHODS = { threshold: 'HALFTHRESHOLD', pattern_dither: 'PATTERNDITHER', diffusion_dither: 'DIFFUSIONDITHER', halftone_screen: 'HALFTONESCREEN', custom_pattern: 'CUSTOMPATTERN' };
const HALFTONE_SHAPES = { round: 'ROUND', diamond: 'DIAMOND', ellipse: 'ELLIPSE', line: 'LINE', square: 'SQUARE', cross: 'CROSS' };

const RESULT = '__result__ = __docInfo(doc);';

/** `var o = new IndexedConversionOptions()` (or Bitmap) statements for change_mode, or ''. */
function conversionOptionLines(a, mode) {
    if (a.indexed !== undefined && a.bitmap !== undefined) throw new Error('Give indexed or bitmap options, not both');
    if (a.indexed !== undefined) {
        if (mode !== 'indexed') throw new Error('indexed options need mode "indexed"');
        const o = a.indexed ?? {};
        const lines = ['var o = new IndexedConversionOptions();'];
        lines.push(`o.palette = PaletteType.${PALETTES[enumOf(o.palette ?? 'local_selective', Object.keys(PALETTES), { name: 'indexed.palette' })]};`);
        if (o.colors !== undefined) lines.push(`o.colors = ${num(o.colors, { min: 2, max: 256, name: 'indexed.colors' })};`);
        if (o.forced !== undefined) lines.push(`o.forced = ForcedColors.${FORCED[enumOf(o.forced, Object.keys(FORCED), { name: 'indexed.forced' })]};`);
        if (o.transparency !== undefined) lines.push(`o.transparency = ${bool(o.transparency)};`);
        if (o.matte !== undefined) lines.push(`o.matte = MatteType.${MATTES[enumOf(o.matte, Object.keys(MATTES), { name: 'indexed.matte' })]};`);
        if (o.dither !== undefined) lines.push(`o.dither = Dither.${DITHERS[enumOf(o.dither, Object.keys(DITHERS), { name: 'indexed.dither' })]};`);
        if (o.ditherAmount !== undefined) lines.push(`o.ditherAmount = ${num(o.ditherAmount, { min: 1, max: 100, name: 'indexed.ditherAmount' })};`);
        if (o.preserveExactColors !== undefined) lines.push(`o.preserveExactColors = ${bool(o.preserveExactColors)};`);
        return lines.join('\n');
    }
    if (a.bitmap !== undefined) {
        if (mode !== 'bitmap') throw new Error('bitmap options need mode "bitmap"');
        const o = a.bitmap ?? {};
        const method = enumOf(o.method ?? 'diffusion_dither', Object.keys(BITMAP_METHODS), { name: 'bitmap.method' });
        if (method === 'custom_pattern' && !o.patternName) throw new Error('bitmap.method "custom_pattern" needs bitmap.patternName');
        const lines = ['var o = new BitmapConversionOptions();', `o.method = BitmapConversionType.${BITMAP_METHODS[method]};`];
        if (o.resolution !== undefined) lines.push(`o.resolution = ${num(o.resolution, { min: 1, max: 10000, name: 'bitmap.resolution' })};`);
        if (o.frequency !== undefined) lines.push(`o.frequency = ${num(o.frequency, { min: 1, max: 999.999, name: 'bitmap.frequency' })};`);
        if (o.angle !== undefined) lines.push(`o.angle = ${num(o.angle, { min: -180, max: 180, name: 'bitmap.angle' })};`);
        if (o.shape !== undefined) lines.push(`o.shape = BitmapHalfToneType.${HALFTONE_SHAPES[enumOf(o.shape, Object.keys(HALFTONE_SHAPES), { name: 'bitmap.shape' })]};`);
        if (o.patternName !== undefined) lines.push(`o.patternName = ${str(o.patternName)};`);
        return lines.join('\n');
    }
    return '';
}

export const tools = [
    {
        name: 'resize_image',
        description: 'Resize the image (Image > Image Size): width and/or height in pixels (the other follows the aspect ratio when omitted), resolution, and the resampling method, with noise reduction for Preserve Details and optionally scaling layer styles (Scale Styles). With resample "none", only the resolution changes and the pixels stay as they are',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                scale: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Percent of the current size, instead of width and height' },
                resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'Pixels per inch' },
                resample: { type: 'string', enum: Object.keys(RESAMPLE), description: 'Default automatic' },
                reduceNoise: { type: 'number', minimum: 0, maximum: 100, description: 'Reduce Noise for resample "preserve_details", 0-100' },
                scaleStyles: { type: 'boolean', description: 'Scale layer styles with the image (Scale Styles). Given either way, the resize runs through the Image Size command; the aspect ratio is kept, so give width, height or scale, not both width and height' },
            },
        },
        features: ['photoshop.image.image_size', 'photoshop.image.image_size_dimensions', 'photoshop.image.image_size_resample', 'photoshop.image.image_size_constrain', 'photoshop.image.image_size_reduce_noise', 'photoshop.image.image_size_scale_styles'],
        handler: (a) => {
            if (a.scale !== undefined && (a.width !== undefined || a.height !== undefined)) throw new Error('Give scale, or width and/or height, not both');
            if (a.scale === undefined && a.width === undefined && a.height === undefined && a.resolution === undefined) throw new Error('Give width, height, scale or resolution');
            const resample = enumOf(a.resample ?? 'automatic', Object.keys(RESAMPLE), { name: 'resample' });
            const method = RESAMPLE[resample];
            if (method === 'NONE' && (a.width !== undefined || a.height !== undefined || a.scale !== undefined)) throw new Error('With resample "none" only the resolution can change');
            if (a.reduceNoise !== undefined && resample !== 'preserve_details') throw new Error('reduceNoise needs resample "preserve_details"');
            const sizing = `
var w0 = __px(doc.width), h0 = __px(doc.height), w = null, h = null;
${a.scale !== undefined ? `w = w0 * ${num(a.scale, { min: 0.1, max: 10000, name: 'scale' })} / 100; h = h0 * ${num(a.scale, { min: 0.1, max: 10000, name: 'scale' })} / 100;` : ''}
${a.width !== undefined ? `w = ${num(a.width, { min: 1, max: 300000, name: 'width' })};` : ''}
${a.height !== undefined ? `h = ${num(a.height, { min: 1, max: 300000, name: 'height' })};` : ''}
if (w !== null && h === null) h = h0 * w / w0;
if (h !== null && w === null) w = w0 * h / h0;`;
            const res = a.resolution !== undefined ? num(a.resolution, { min: 1, max: 10000, name: 'resolution' }) : null;
            if (a.scaleStyles !== undefined) {
                if (a.width !== undefined && a.height !== undefined) throw new Error('With scaleStyles the aspect ratio is kept: give width, height or scale, not both width and height');
                if (method === 'NONE') throw new Error('scaleStyles needs resampling; drop resample "none"');
                if (a.reduceNoise !== undefined) throw new Error('reduceNoise and scaleStyles cannot be combined; drop one');
                return run('Resize image', script(`${AM_HELPERS}${sizing}
var d = new ActionDescriptor();
if (w !== null) d.putUnitDouble(__s("width"), __s("pixelsUnit"), w);
${res !== null ? `d.putUnitDouble(__s("resolution"), __s("densityUnit"), ${res});` : ''}
d.putBoolean(__s("scaleStyles"), ${bool(a.scaleStyles)});
d.putBoolean(__s("constrainProportions"), true);
d.putEnumerated(__s("interpolation"), __s("interpolationType"), __s(${str(INTERPOLATION[resample])}));
__do(__s("imageSize"), d);
${RESULT}`));
            }
            return run('Resize image', script(`${sizing}
doc.resizeImage(w === null ? undefined : new UnitValue(w, "px"), h === null ? undefined : new UnitValue(h, "px"), ${res ?? 'undefined'}, ResampleMethod.${method}${a.reduceNoise !== undefined ? `, ${num(a.reduceNoise, { min: 0, max: 100, name: 'reduceNoise' })}` : ''});
${RESULT}`));
        },
    },
    {
        name: 'resize_canvas',
        description: 'Change the canvas size (Image > Canvas Size) in pixels, keeping the image anchored at a side or corner. New areas take the Canvas Extension Color on a background layer (the background colour unless extensionColor is given) and stay transparent elsewhere',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels (added to the current width when relative)' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels (added to the current height when relative)' },
                relative: { type: 'boolean', description: 'Width and height are added to the current size. Default false', default: false },
                anchor: { type: 'string', enum: Object.keys(ANCHORS), description: 'Default center' },
                extensionColor: { type: 'string', enum: Object.keys(EXTENSION_COLORS), description: 'Canvas Extension Color for new areas of a background layer. Default: the background colour' },
            },
        },
        features: ['photoshop.image.canvas_size', 'photoshop.image.canvas_size_relative', 'photoshop.image.canvas_size_anchor', 'photoshop.image.canvas_extension_color'],
        handler: (a) => {
            if (a.width === undefined && a.height === undefined) throw new Error('Give width, height or both');
            const lim = a.relative ? { min: -300000, max: 300000 } : { min: 1, max: 300000 };
            const anchor = enumOf(a.anchor ?? 'center', Object.keys(ANCHORS), { name: 'anchor' });
            const size = `
var w = __px(doc.width), h = __px(doc.height);
${a.width !== undefined ? `w = ${a.relative ? 'w + ' : ''}${num(a.width, { ...lim, name: 'width' })};` : ''}
${a.height !== undefined ? `h = ${a.relative ? 'h + ' : ''}${num(a.height, { ...lim, name: 'height' })};` : ''}
if (w < 1 || h < 1) throw new Error("The canvas would be smaller than 1 pixel");`;
            if (a.extensionColor !== undefined) {
                const color = EXTENSION_COLORS[enumOf(a.extensionColor, Object.keys(EXTENSION_COLORS), { name: 'extensionColor' })];
                return run('Resize canvas', script(`${AM_HELPERS}${size}
var d = new ActionDescriptor();
d.putUnitDouble(__s("width"), __s("pixelsUnit"), w);
d.putUnitDouble(__s("height"), __s("pixelsUnit"), h);
d.putEnumerated(__s("horizontal"), __s("horizontalLocation"), __s(${str(CANVAS_H[anchor])}));
d.putEnumerated(__s("vertical"), __s("verticalLocation"), __s(${str(CANVAS_V[anchor])}));
d.putEnumerated(__s("canvasExtensionColorType"), __s("canvasExtensionColorType"), __s(${str(color)}));
__do(__s("canvasSize"), d);
${RESULT}`));
            }
            return run('Resize canvas', script(`${size}
doc.resizeCanvas(new UnitValue(w, "px"), new UnitValue(h, "px"), AnchorPosition.${ANCHORS[anchor]});
${RESULT}`));
        },
    },
    {
        name: 'crop_image',
        description: 'Crop the image to a rectangle (Image > Crop, or the Crop tool), optionally rotating the crop and resampling the result to a size. Bounds reaching outside the canvas extend it, as dragging the Crop tool past the edge does',
        inputSchema: {
            type: 'object',
            properties: {
                bounds: RECT_SCHEMA,
                angle: { type: 'number', minimum: -360, maximum: 360, description: 'Rotate the crop, in degrees' },
                width: { type: 'number', minimum: 1, description: 'Resample the result to this width in pixels' },
                height: { type: 'number', minimum: 1, description: 'Resample the result to this height in pixels' },
            },
            required: ['bounds'],
        },
        hints: { destructive: true },
        features: ['photoshop.image.crop_command', 'photoshop.image.straighten', 'photoshop.image.crop_tool', 'photoshop.image.extend_canvas_with_crop'],
        handler: (a) => {
            const [l, t, r, b] = rect(a.bounds, 'bounds');
            return run('Crop image', script(`
doc.crop([new UnitValue(${l}, "px"), new UnitValue(${t}, "px"), new UnitValue(${r}, "px"), new UnitValue(${b}, "px")], ${a.angle !== undefined ? num(a.angle, { min: -360, max: 360, name: 'angle' }) : 'undefined'}${a.width !== undefined || a.height !== undefined ? `, ${a.width !== undefined ? `new UnitValue(${num(a.width, { min: 1, name: 'width' })}, "px")` : 'undefined'}, ${a.height !== undefined ? `new UnitValue(${num(a.height, { min: 1, name: 'height' })}, "px")` : 'undefined'}` : ''});
${RESULT}`));
        },
    },
    {
        name: 'trim_image',
        description: 'Trim away transparent pixels, or pixels the colour of the top-left or bottom-right corner, from any of the four sides (Image > Trim)',
        inputSchema: {
            type: 'object',
            properties: {
                basedOn: { type: 'string', enum: ['transparent', 'top_left', 'bottom_right'], description: 'Default transparent' },
                top: { type: 'boolean', default: true }, left: { type: 'boolean', default: true },
                bottom: { type: 'boolean', default: true }, right: { type: 'boolean', default: true },
            },
        },
        hints: { destructive: true },
        features: ['photoshop.image.trim'],
        handler: (a) => {
            const type = { transparent: 'TRANSPARENT', top_left: 'TOPLEFT', bottom_right: 'BOTTOMRIGHT' }[enumOf(a.basedOn ?? 'transparent', ['transparent', 'top_left', 'bottom_right'], { name: 'basedOn' })];
            return run('Trim image', script(`
doc.trim(TrimType.${type}, ${bool(a.top ?? true)}, ${bool(a.left ?? true)}, ${bool(a.bottom ?? true)}, ${bool(a.right ?? true)});
${RESULT}`));
        },
    },
    {
        name: 'rotate_canvas',
        description: 'Rotate the whole image by an angle in degrees (Image > Image Rotation); positive is clockwise. Or flip the canvas horizontally or vertically',
        inputSchema: {
            type: 'object',
            properties: {
                angle: { type: 'number', minimum: -360, maximum: 360 },
                flip: { type: 'string', enum: ['horizontal', 'vertical'] },
            },
        },
        features: ['photoshop.image.image_rotation', 'photoshop.image.rotate_180', 'photoshop.image.rotate_90_cw', 'photoshop.image.rotate_90_ccw', 'photoshop.image.rotate_arbitrary', 'photoshop.image.flip_canvas_horizontal', 'photoshop.image.flip_canvas_vertical'],
        handler: (a) => {
            if ((a.angle === undefined) === (a.flip === undefined)) throw new Error('Give angle or flip');
            return run('Rotate canvas', script(`
${a.angle !== undefined ? `doc.rotateCanvas(${num(a.angle, { min: -360, max: 360, name: 'angle' })});` : `doc.flipCanvas(Direction.${enumOf(a.flip, ['horizontal', 'vertical'], { name: 'flip' }).toUpperCase()});`}
${RESULT}`));
        },
    },
    {
        name: 'change_mode',
        description: 'Convert the image to another colour mode (Image > Mode): RGB, CMYK, Grayscale, Lab, Bitmap, Indexed Color or Multichannel, and/or another bit depth. Indexed Color takes the palette, colours, forced colours, transparency, matte and dither of its dialog; Bitmap (from Grayscale) takes the method, output resolution and halftone screen. Returns the document with its mode. Converting can flatten or discard information',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: Object.keys(MODES) },
                bitsPerChannel: { type: 'integer', enum: [1, 8, 16, 32] },
                indexed: {
                    type: 'object',
                    description: 'Indexed Color options (mode "indexed")',
                    properties: {
                        palette: { type: 'string', enum: Object.keys(PALETTES), description: 'Default local_selective' },
                        colors: { type: 'integer', minimum: 2, maximum: 256, description: 'Number of colours, for the local and master palettes and uniform' },
                        forced: { type: 'string', enum: Object.keys(FORCED), description: 'Colours always kept in the table' },
                        transparency: { type: 'boolean', description: 'Keep transparent areas transparent' },
                        matte: { type: 'string', enum: Object.keys(MATTES), description: 'Colour that fills antialiased edges next to transparent areas' },
                        dither: { type: 'string', enum: Object.keys(DITHERS), description: 'How to simulate colours not in the table' },
                        ditherAmount: { type: 'number', minimum: 1, maximum: 100, description: 'Percent, for diffusion dither' },
                        preserveExactColors: { type: 'boolean', description: 'With diffusion dither, keep colours that are in the table undithered' },
                    },
                },
                bitmap: {
                    type: 'object',
                    description: 'Bitmap options (mode "bitmap"; the image must be Grayscale)',
                    properties: {
                        method: { type: 'string', enum: Object.keys(BITMAP_METHODS), description: 'Default diffusion_dither' },
                        resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'Output resolution, pixels per inch' },
                        frequency: { type: 'number', minimum: 1, maximum: 999.999, description: 'Halftone screen frequency, lines per inch' },
                        angle: { type: 'number', minimum: -180, maximum: 180, description: 'Halftone screen angle, degrees' },
                        shape: { type: 'string', enum: Object.keys(HALFTONE_SHAPES), description: 'Halftone dot shape' },
                        patternName: { type: 'string', description: 'Pattern for method custom_pattern' },
                    },
                },
            },
        },
        auditArgs: { mode: 'indexed', bitmap: undefined },
        hints: { destructive: true },
        features: ['photoshop.image.mode', 'photoshop.image.mode_rgb', 'photoshop.image.mode_cmyk', 'photoshop.image.mode_grayscale', 'photoshop.image.mode_lab', 'photoshop.image.mode_bitmap', 'photoshop.image.mode_indexed', 'photoshop.image.mode_multichannel', 'photoshop.image.bit_depth', 'photoshop.image.bits_8', 'photoshop.image.bits_16', 'photoshop.image.bits_32',
            'photoshop.image.color_mode_concepts', 'photoshop.image.indexed_color_options', 'photoshop.image.indexed_palette', 'photoshop.image.indexed_forced', 'photoshop.image.indexed_dither', 'photoshop.image.indexed_matte', 'photoshop.image.bitmap_options', 'photoshop.image.halftone_screen_bitmap'],
        handler: (a) => {
            if (a.mode === undefined && a.bitsPerChannel === undefined) throw new Error('Give mode, bitsPerChannel or both');
            const mode = a.mode !== undefined ? enumOf(a.mode, Object.keys(MODES), { name: 'mode' }) : undefined;
            const options = conversionOptionLines(a, mode);
            return run('Change mode', script(`
${options}
${mode !== undefined ? `doc.changeMode(ChangeMode.${MODES[mode]}${options ? ', o' : ''});` : ''}
${a.bitsPerChannel !== undefined ? `doc.bitsPerChannel = BitsPerChannelType.${DEPTHS[enumOf(String(a.bitsPerChannel), Object.keys(DEPTHS), { name: 'bitsPerChannel' })]};` : ''}
${RESULT}`));
        },
    },
    {
        name: 'convert_profile',
        description: 'Convert the image to another colour profile (Edit > Convert to Profile) with a rendering intent, black point compensation and dither',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Destination profile name, e.g. "sRGB IEC61966-2.1", "Working CMYK"' },
                intent: { type: 'string', enum: Object.keys(INTENTS), description: 'Default relative_colorimetric' },
                blackPointCompensation: { type: 'boolean', default: true },
                dither: { type: 'boolean', default: true },
            },
            required: ['profile'],
        },
        features: ['photoshop.color_management.convert_to_profile', 'photoshop.color_management.conversion_options', 'photoshop.color_management.rendering_intent'],
        handler: (a) => run('Convert profile', script(`
doc.convertProfile(${str(a.profile)}, Intent.${INTENTS[enumOf(a.intent ?? 'relative_colorimetric', Object.keys(INTENTS), { name: 'intent' })]}, ${bool(a.blackPointCompensation ?? true)}, ${bool(a.dither ?? true)});
${RESULT}`)),
    },
    {
        name: 'flatten_image',
        description: 'Flatten every layer into a background layer (Layer > Flatten Image), or merge only the visible layers (Merge Visible)',
        inputSchema: { type: 'object', properties: { visibleOnly: { type: 'boolean', description: 'Merge visible layers only. Default false', default: false } } },
        hints: { destructive: true },
        features: ['photoshop.layers.flatten_image', 'photoshop.layers.merge_visible'],
        handler: (a) => run('Flatten image', script(`
${a.visibleOnly ? 'doc.mergeVisibleLayers();' : 'doc.flatten();'}
${RESULT}`)),
    },
    {
        name: 'reveal_all',
        description: 'Enlarge the canvas to show every pixel that extends beyond it (Image > Reveal All)',
        inputSchema: { type: 'object', properties: {} },
        features: ['photoshop.image.reveal_all'],
        handler: () => run('Reveal all', script(`
doc.revealAll();
${RESULT}`)),
    },
    {
        name: 'set_color_table',
        description: 'Replace the colour table of an Indexed Color image (Image > Mode > Color Table) with a list of colours, in table order',
        inputSchema: {
            type: 'object',
            properties: { colors: { type: 'array', items: COLOR_SCHEMA, minItems: 1, maxItems: 256, description: 'Up to 256 colours; each is stored as RGB' } },
            required: ['colors'],
        },
        auditArgs: { colors: ['#FF0000', 'gray(50)'] },
        features: ['photoshop.image.color_table'],
        handler: (a) => {
            if (!Array.isArray(a.colors) || !a.colors.length || a.colors.length > 256) throw new Error('colors must list 1 to 256 colours');
            const specs = a.colors.map((c, i) => colorSpec(c, `colors[${i}]`));
            return run('Set color table', script(`${AM_HELPERS}
if (__enumName(doc.mode) !== "INDEXEDCOLOR") throw new Error("The colour table belongs to Indexed Color images; convert with change_mode first");
var specs = [${specs.join(', ')}], list = new ActionList();
for (var i = 0; i < specs.length; i++) {
  var c = __color(specs[i]), e = new ActionDescriptor();
  e.putDouble(__c("Rd  "), c.rgb.red);
  e.putDouble(__c("Grn "), c.rgb.green);
  e.putDouble(__c("Bl  "), c.rgb.blue);
  list.putObject(__c("RGBC"), e);
}
var r = new ActionReference();
r.putProperty(__c("Clr "), __c("ClrT"));
var d = new ActionDescriptor();
d.putReference(__c("null"), r);
d.putList(__c("T   "), list);
__do(__c("setd"), d);
__result__ = { colors: specs.length, document: __docInfo(doc) };`));
        },
    },
    {
        name: 'set_pixel_aspect_ratio',
        description: 'Set the document\'s pixel aspect ratio (View > Pixel Aspect Ratio), for video work with non-square pixels, and/or toggle View > Pixel Aspect Ratio Correction, which previews the image with those pixels',
        inputSchema: {
            type: 'object',
            properties: {
                ratio: { type: 'number', minimum: 0.1, maximum: 10, description: 'Pixel width divided by height: 1 is square, e.g. 0.91 for D1/DV NTSC, 1.09 for D1/DV PAL, 2 for anamorphic 2:1' },
                toggleCorrection: { type: 'boolean', description: 'Toggle Pixel Aspect Ratio Correction (on if it was off, off if it was on)' },
            },
        },
        features: ['photoshop.image.pixel_aspect_ratio', 'photoshop.image.pixel_aspect_ratio_correction'],
        handler: (a) => {
            if (a.ratio === undefined && !a.toggleCorrection) throw new Error('Give ratio, toggleCorrection or both');
            return run('Set pixel aspect ratio', script(`
${a.ratio !== undefined ? `doc.pixelAspectRatio = ${num(a.ratio, { min: 0.1, max: 10, name: 'ratio' })};` : ''}
${a.toggleCorrection ? 'app.runMenuItem(app.stringIDToTypeID("toggleProofVideo"));' : ''}
__result__ = { pixelAspectRatio: doc.pixelAspectRatio };`));
        },
    },
    {
        name: 'get_histogram',
        description: 'Read the histogram (Histogram panel) of the composite image or of one channel: the pixel count at each of the 256 levels, with the total, mean and median',
        inputSchema: {
            type: 'object',
            properties: { channel: { type: 'string', description: 'Channel name, e.g. "Red" or an alpha channel (list_channels). Default the composite' } },
        },
        hints: { readOnly: true, idempotent: true },
        features: ['photoshop.image.histogram'],
        handler: (a) => run('Get histogram', script(`
var src = doc, label = "composite";
${a.channel !== undefined ? `try { src = doc.channels.getByName(${str(a.channel)}); } catch (e) { throw new Error("No channel named " + ${str(a.channel)}); }
label = ${str(a.channel)};` : ''}
var hist = src.histogram, total = 0, sum = 0;
for (var i = 0; i < hist.length; i++) { total += hist[i]; sum += i * hist[i]; }
var median = null, seen = 0;
for (var j = 0; j < hist.length; j++) { seen += hist[j]; if (median === null && seen * 2 >= total) median = j; }
var levels = [];
for (var k = 0; k < hist.length; k++) levels.push(hist[k]);
__result__ = { channel: label, pixels: total, mean: total ? sum / total : null, median: median, levels: levels };`)),
    },
];
