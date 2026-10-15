/**
 * Whole-image operations: Image Size, Canvas Size, crop, trim, rotate and flip
 * the canvas, colour mode and bit depth, colour profiles, flatten and merge.
 */
import { str, num, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { RECT_SCHEMA, rect } from '../args.js';

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

const RESULT = '__result__ = __docInfo(doc);';

export const tools = [
    {
        name: 'resize_image',
        description: 'Resize the image (Image > Image Size): width and/or height in pixels (the other follows the aspect ratio when omitted), resolution, and the resampling method. With resample "none", only the resolution changes and the pixels stay as they are',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                scale: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Percent of the current size, instead of width and height' },
                resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'Pixels per inch' },
                resample: { type: 'string', enum: Object.keys(RESAMPLE), description: 'Default automatic' },
            },
        },
        features: ['photoshop.image.image_size', 'photoshop.image.image_size_dimensions', 'photoshop.image.image_size_resample', 'photoshop.image.image_size_constrain'],
        handler: (a) => {
            if (a.scale !== undefined && (a.width !== undefined || a.height !== undefined)) throw new Error('Give scale, or width and/or height, not both');
            if (a.scale === undefined && a.width === undefined && a.height === undefined && a.resolution === undefined) throw new Error('Give width, height, scale or resolution');
            const method = RESAMPLE[enumOf(a.resample ?? 'automatic', Object.keys(RESAMPLE), { name: 'resample' })];
            if (method === 'NONE' && (a.width !== undefined || a.height !== undefined || a.scale !== undefined)) throw new Error('With resample "none" only the resolution can change');
            return run('Resize image', script(`
var w0 = __px(doc.width), h0 = __px(doc.height), w = null, h = null;
${a.scale !== undefined ? `w = w0 * ${num(a.scale, { min: 0.1, max: 10000, name: 'scale' })} / 100; h = h0 * ${num(a.scale, { min: 0.1, max: 10000, name: 'scale' })} / 100;` : ''}
${a.width !== undefined ? `w = ${num(a.width, { min: 1, max: 300000, name: 'width' })};` : ''}
${a.height !== undefined ? `h = ${num(a.height, { min: 1, max: 300000, name: 'height' })};` : ''}
if (w !== null && h === null) h = h0 * w / w0;
if (h !== null && w === null) w = w0 * h / h0;
doc.resizeImage(w === null ? undefined : new UnitValue(w, "px"), h === null ? undefined : new UnitValue(h, "px"), ${a.resolution !== undefined ? num(a.resolution, { min: 1, max: 10000, name: 'resolution' }) : 'undefined'}, ResampleMethod.${method});
${RESULT}`));
        },
    },
    {
        name: 'resize_canvas',
        description: 'Change the canvas size (Image > Canvas Size) in pixels, keeping the image anchored at a side or corner. New areas take the background colour on a background layer and stay transparent elsewhere',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000 },
                height: { type: 'number', minimum: 1, maximum: 300000 },
                relative: { type: 'boolean', description: 'Width and height are added to the current size. Default false', default: false },
                anchor: { type: 'string', enum: Object.keys(ANCHORS), description: 'Default center' },
            },
        },
        features: ['photoshop.image.canvas_size', 'photoshop.image.canvas_size_relative', 'photoshop.image.canvas_size_anchor'],
        handler: (a) => {
            if (a.width === undefined && a.height === undefined) throw new Error('Give width, height or both');
            const lim = a.relative ? { min: -300000, max: 300000 } : { min: 1, max: 300000 };
            return run('Resize canvas', script(`
var w = __px(doc.width), h = __px(doc.height);
${a.width !== undefined ? `w = ${a.relative ? 'w + ' : ''}${num(a.width, { ...lim, name: 'width' })};` : ''}
${a.height !== undefined ? `h = ${a.relative ? 'h + ' : ''}${num(a.height, { ...lim, name: 'height' })};` : ''}
if (w < 1 || h < 1) throw new Error("The canvas would be smaller than 1 pixel");
doc.resizeCanvas(new UnitValue(w, "px"), new UnitValue(h, "px"), AnchorPosition.${ANCHORS[enumOf(a.anchor ?? 'center', Object.keys(ANCHORS), { name: 'anchor' })]});
${RESULT}`));
        },
    },
    {
        name: 'crop_image',
        description: 'Crop the image to a rectangle (Image > Crop, or the Crop tool), optionally rotating the crop and resampling the result to a size',
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
        features: ['photoshop.image.crop_command', 'photoshop.image.straighten'],
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
        description: 'Convert the image to another colour mode (Image > Mode): RGB, CMYK, Grayscale, Lab, Bitmap, Indexed Color or Multichannel, and/or another bit depth. Converting can flatten or discard information',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: Object.keys(MODES) },
                bitsPerChannel: { type: 'integer', enum: [1, 8, 16, 32] },
            },
        },
        hints: { destructive: true },
        features: ['photoshop.image.mode', 'photoshop.image.mode_rgb', 'photoshop.image.mode_cmyk', 'photoshop.image.mode_grayscale', 'photoshop.image.mode_lab', 'photoshop.image.mode_bitmap', 'photoshop.image.mode_indexed', 'photoshop.image.mode_multichannel', 'photoshop.image.bit_depth', 'photoshop.image.bits_8', 'photoshop.image.bits_16', 'photoshop.image.bits_32'],
        handler: (a) => {
            if (a.mode === undefined && a.bitsPerChannel === undefined) throw new Error('Give mode, bitsPerChannel or both');
            return run('Change mode', script(`
${a.mode !== undefined ? `doc.changeMode(ChangeMode.${MODES[enumOf(a.mode, Object.keys(MODES), { name: 'mode' })]});` : ''}
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
];
