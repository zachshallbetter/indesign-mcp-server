/**
 * Live Effects applied with PageItem.applyEffect(liveEffectXML).
 *
 * Adobe does not document the LiveEffect XML. Each definition below follows
 * the parameters published scripts use, recorded with their sources in the
 * adobe-capability-atlas (Illustrator effects and geometry records):
 *   Offset Path     R ofst (pt), I jntp (0 round, 1 bevel, 2 miter), R mlim
 *   Round Corners   R radius (pt)
 *   Drop Shadow     I blnd, R opac (0-1), R horz, R vert, R blur (pt), I csrc (1 darkness, 0 colour), R dark (%), Entry sclr
 *   Roughen         R asiz / size (%), R absoluteness 0, R dtal (per inch), R roundness (0 corner, 1 smooth)
 *   Transform       scale %, move (pt, up positive), rotate, numCopies, pinPoint 4 (centre)
 *   Gaussian Blur   R blur (px), PrevDocScale, PrevDres
 *   Pathfinder      I Command 0-12 with Precision, RemovePoints, ExtractUnpainted, Mix, Trap*
 *
 * From mark1bean/live-effect-functions-for-illustrator (MIT, each marked as
 * working in its notes), several also used by swwwitch/illustrator-scripts:
 *   Inner Glow      "Adobe Inner Glow": I blnd, I gtyp (0 centre, 1 edge), R opac, R blur, Entry gclr
 *   Outer Glow      "Adobe Outer Glow": I blnd, R opac, R blur, B usePSLBlur, Entry sclr
 *   Feather         "Adobe Fuzzy Mask": R Radius (pt)
 *   Scribble        "Adobe Scribble Fill": Angle, EdgeOverlap(Variation), StrokeWidth, Scribbliness (0-1),
 *                   ScribbleVariation, Spacing, SpacingVariation
 *   Convert to Shape "Adobe Shape Effects" isPre: I Shape (0 rectangle, 1 rounded, 2 ellipse), Rel/AbsWidth,
 *                   Rel/AbsHeight, Absolute, CornerRadius
 *   Free Distort    "Adobe Free Distort": src/dst corners of the unit square, v negated
 *   Pucker & Bloat  "Adobe Punk and Bloat": R d_factor (%)
 *   Tweak           "Adobe Scribble and Tweak" isPre: horz/vert, ahor/aver, absoluteness, B in, out, anch
 *   Twist           "Adobe Twirl" isPre: R angle (degrees)
 *   Zig Zag         "Adobe Zigzag": amount, relAmount, absoluteness, ridges, roundness
 *   Warp            "Adobe Deform": S DisplayString Warp:<name>, I DeformStyle (menu order + 1), B Rotate,
 *                   R DeformValue, DeformHoriz, DeformVert (fractions)
 *   Outline Object  "Adobe Outline Type"; Outline Stroke "Adobe Outline Stroke"; Crop Marks "Adobe Trim Marks"
 *   Rasterize       "Adobe Rasterize": I colr (+4 transparent), B alis, I dpi., B mask, R padd, I optn (16 type)
 *
 * Blend modes (I blnd) are numbered as the object model's BlendModes enum:
 * 1 multiply (Drop Shadow's default), 2 screen (the glows' default) and
 * 3 overlay agree with the published scripts and Adobe Community posts.
 * Effect colours (Fill color) are a colour type then components from 0 to 1:
 * 0 gray, 1 CMYK, 5 RGB.
 *
 * The builders return ES3 expressions, not strings: distances are divided by
 * the document's scale factor inside the script, so large-canvas documents get
 * the size the caller asked for.
 */
import { num, index, enumOf } from 'adobe-mcp-core';
import { colorSpec } from './args.js';

const JOINS = { round: 0, bevel: 1, miter: 2 };

/** A number as a script expression: `${value} / __sf(doc)` for distances. */
const dist = (v, name) => `(${num(v, { min: -10000, max: 10000, name })} / __sf(doc))`;
const pct = (v, name, max = 100) => num(v, { min: 0, max, name });
const dict = (parts) => parts.map(([type, key, expr]) => `"${type} ${key} " + ${expr}`).join(' + " " + ');

/** Blend modes (I blnd), numbered as the object model's BlendModes enum. */
export const BLEND_MODES = {
    normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4, hard_light: 5, color_dodge: 6, color_burn: 7,
    darken: 8, lighten: 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15,
};
const MODE_PARAM = (def) => ({ type: 'string', enum: Object.keys(BLEND_MODES), default: def, description: 'Blending mode, as listed under modes' });
const mode = (v, def) => String(BLEND_MODES[enumOf(v ?? def, Object.keys(BLEND_MODES), { name: 'mode' })]);

/** A boolean option as a Dict value (1 or 0). */
const flag = (v, def, name) => {
    const b = v ?? def;
    if (typeof b !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return b ? '1' : '0';
};

/** An effect colour as a script expression: __fxColor() turns a colour spec into a Fill colour string. */
const fxColor = (v, def, name = 'color') => {
    const spec = colorSpec(v ?? def, name);
    if (JSON.parse(spec).kind === 'none') throw new Error(`'${name}' needs a colour, not none`);
    return `__fxColor(doc, ${spec})`;
};
const colorEntry = (entry, expr) => `'"><Entry name="${entry}" valueType="F"><Fill color="' + ${expr} + '"/></Entry></Dict></LiveEffect>'`;

/** ES3: a colour spec as an effect Fill colour (0 gray, 1 CMYK, 5 RGB, components 0-1). */
export const FX_COLOR_FN = `
function __fxColor(doc, spec) {
  var c = __color(doc, spec);
  if (c.typename === "SpotColor") c = c.spot.color;
  if (c.typename === "RGBColor") return "5 " + c.red / 255 + " " + c.green / 255 + " " + c.blue / 255;
  if (c.typename === "CMYKColor") return "1 " + c.cyan / 100 + " " + c.magenta / 100 + " " + c.yellow / 100 + " " + c.black / 100;
  if (c.typename === "GrayColor") return "0 " + c.gray / 100;
  throw new Error("Effect colours must be RGB, CMYK, gray, or a process or spot swatch");
}`;

const COLOR_PARAM = (def) => ({ type: 'string', default: def, description: 'Colour: a swatch name, "#RRGGBB", "rgb()", "cmyk()" or "gray()"' });

/** Shape numbers and display names in the "Adobe Shape Effects" (Convert to Shape) effect. */
const SHAPES = { rectangle: [0, 'Rectangle'], rounded_rectangle: [1, 'RoundedRectangle'], ellipse: [2, 'Ellipse'] };

/** Warp styles in Effect > Warp order; DeformStyle is the position plus one. Display names have no spaces. */
export const WARP_STYLES = {
    arc: 'Arc', arc_lower: 'ArcLower', arc_upper: 'ArcUpper', arch: 'Arch', bulge: 'Bulge', shell_lower: 'ShellLower',
    shell_upper: 'ShellUpper', flag: 'Flag', wave: 'Wave', fish: 'Fish', rise: 'Rise', fisheye: 'FishEye',
    inflate: 'Inflate', squeeze: 'Squeeze', twist: 'Twist',
};

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const UNIT_SQUARE = { topLeft: [0, 0], topRight: [1, 0], bottomLeft: [0, 1], bottomRight: [1, 1] };

/** A Live Effect with no options. */
const plain = (label, xml) => ({ label, params: {}, build: () => `'${xml}'` });

export const EFFECTS = {
    drop_shadow: {
        label: 'Drop Shadow',
        raster: true,
        params: {
            mode: MODE_PARAM('multiply'),
            opacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Percent' },
            x: { type: 'number', default: 7, description: 'Horizontal offset in points' },
            y: { type: 'number', default: 7, description: 'Vertical offset in points (down is positive)' },
            blur: { type: 'number', minimum: 0, maximum: 144, default: 5, description: 'Blur in points' },
            darkness: { type: 'number', minimum: 0, maximum: 100, default: 100, description: 'Percent of black mixed into the shadow (when no color is given)' },
            color: { type: 'string', description: 'Shadow colour instead of darkness: a swatch name, "#RRGGBB", "rgb()", "cmyk()" or "gray()"' },
        },
        build: (o) => `'<LiveEffect name="Adobe Drop Shadow"><Dict data="' + ${dict([
            ['I', 'blnd', mode(o.mode, 'multiply')],
            ['R', 'opac', `(${pct(o.opacity ?? 75, 'opacity')} / 100)`],
            ['R', 'horz', dist(o.x ?? 7, 'x')],
            ['R', 'vert', dist(o.y ?? 7, 'y')],
            ['R', 'blur', dist(o.blur ?? 5, 'blur')],
            ['B', 'usePSLBlur', '1'],
            ['I', 'csrc', o.color === undefined ? '1' : '0'],
            ['R', 'dark', pct(o.darkness ?? 100, 'darkness')],
            ['B', 'pair', '1'],
        ])} + ' ' + ${colorEntry('sclr', o.color === undefined
            ? '(doc.documentColorSpace === DocumentColorSpace.CMYK ? "0 0 0 1" : "0 0 0")'
            : fxColor(o.color))}`,
    },
    inner_glow: {
        label: 'Inner Glow',
        raster: true,
        params: {
            mode: MODE_PARAM('screen'),
            color: COLOR_PARAM('#FFFFFF'),
            opacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Percent' },
            blur: { type: 'number', minimum: 0, maximum: 144, default: 5, description: 'Blur in points' },
            source: { type: 'string', enum: ['center', 'edge'], default: 'edge', description: 'Glow from the centre or the edges' },
        },
        build: (o) => `'<LiveEffect name="Adobe Inner Glow"><Dict data="' + ${dict([
            ['I', 'blnd', mode(o.mode, 'screen')],
            ['I', 'gtyp', enumOf(o.source ?? 'edge', ['center', 'edge'], { name: 'source' }) === 'center' ? '0' : '1'],
            ['R', 'opac', `(${pct(o.opacity ?? 75, 'opacity')} / 100)`],
            ['R', 'blur', dist(o.blur ?? 5, 'blur')],
        ])} + ' ' + ${colorEntry('gclr', fxColor(o.color, '#FFFFFF'))}`,
    },
    outer_glow: {
        label: 'Outer Glow',
        raster: true,
        params: {
            mode: MODE_PARAM('screen'),
            color: COLOR_PARAM('#000000'),
            opacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Percent' },
            blur: { type: 'number', minimum: 0, maximum: 144, default: 5, description: 'Blur in points' },
        },
        build: (o) => `'<LiveEffect name="Adobe Outer Glow"><Dict data="' + ${dict([
            ['I', 'blnd', mode(o.mode, 'screen')],
            ['R', 'opac', `(${pct(o.opacity ?? 75, 'opacity')} / 100)`],
            ['R', 'blur', dist(o.blur ?? 5, 'blur')],
            ['B', 'usePSLBlur', '1'],
        ])} + ' ' + ${colorEntry('sclr', fxColor(o.color, '#000000'))}`,
    },
    feather: {
        label: 'Feather',
        raster: true,
        params: { radius: { type: 'number', minimum: 0, maximum: 1000, description: 'Points' } },
        required: ['radius'],
        build: (o) => `'<LiveEffect name="Adobe Fuzzy Mask"><Dict data="' + ${dict([['R', 'Radius', dist(pct(o.radius, 'radius', 1000), 'radius')]])} + ' "/></LiveEffect>'`,
    },
    scribble: {
        label: 'Scribble',
        params: {
            angle: { type: 'number', minimum: -360, maximum: 360, default: 30, description: 'Degrees' },
            pathOverlap: { type: 'number', minimum: -1000, maximum: 1000, default: 0, description: 'Points; negative keeps lines inside the path' },
            pathOverlapVariation: { type: 'number', minimum: 0, maximum: 1000, default: 5, description: 'Points' },
            strokeWidth: { type: 'number', minimum: 0, maximum: 1000, default: 3, description: 'Points' },
            curviness: { type: 'number', minimum: 0, maximum: 100, default: 5, description: 'Percent' },
            curvinessVariation: { type: 'number', minimum: 0, maximum: 100, default: 1, description: 'Percent' },
            spacing: { type: 'number', minimum: 0, maximum: 1000, default: 5, description: 'Points' },
            spacingVariation: { type: 'number', minimum: 0, maximum: 1000, default: 0.5, description: 'Points' },
        },
        build: (o) => `'<LiveEffect name="Adobe Scribble Fill"><Dict data="' + ${dict([
            ['R', 'Spacing', dist(pct(o.spacing ?? 5, 'spacing', 1000), 'spacing')],
            ['R', 'Angle', num(o.angle ?? 30, { min: -360, max: 360, name: 'angle' })],
            ['R', 'Scribbliness', `(${pct(o.curviness ?? 5, 'curviness')} / 100)`],
            ['R', 'StrokeWidth', dist(pct(o.strokeWidth ?? 3, 'strokeWidth', 1000), 'strokeWidth')],
            ['R', 'EdgeOverlap', dist(o.pathOverlap ?? 0, 'pathOverlap')],
            ['R', 'ScribbleVariation', `(${pct(o.curvinessVariation ?? 1, 'curvinessVariation')} / 100)`],
            ['R', 'SpacingVariation', dist(pct(o.spacingVariation ?? 0.5, 'spacingVariation', 1000), 'spacingVariation')],
            ['R', 'EdgeOverlapVariation', dist(pct(o.pathOverlapVariation ?? 5, 'pathOverlapVariation', 1000), 'pathOverlapVariation')],
        ])} + ' "/></LiveEffect>'`,
    },
    convert_to_shape: {
        label: 'Convert to Shape',
        params: {
            shape: { type: 'string', enum: Object.keys(SHAPES) },
            size: { type: 'string', enum: ['relative', 'absolute'], default: 'relative', description: 'relative: width and height are extra space around the object; absolute: they are the shape\'s size' },
            width: { type: 'number', minimum: 0, maximum: 10000, description: 'Points. Default 0 (relative); required when absolute' },
            height: { type: 'number', minimum: 0, maximum: 10000, description: 'Points. Default 0 (relative); required when absolute' },
            cornerRadius: { type: 'number', minimum: 0, maximum: 10000, default: 9, description: 'Rounded rectangle corner radius in points' },
        },
        required: ['shape'],
        build: (o) => {
            const [n, name] = SHAPES[enumOf(o.shape, Object.keys(SHAPES), { name: 'shape' })];
            const absolute = enumOf(o.size ?? 'relative', ['relative', 'absolute'], { name: 'size' }) === 'absolute';
            if (absolute && (o.width === undefined || o.height === undefined)) throw new Error('convert_to_shape with size absolute needs options.width and options.height');
            const w = dist(pct(o.width ?? 0, 'width', 10000), 'width');
            const h = dist(pct(o.height ?? 0, 'height', 10000), 'height');
            return `'<LiveEffect name="Adobe Shape Effects" isPre="1"><Dict data="' + ${dict([
                ['U', 'DisplayString', `"${name}"`],
                ['I', 'Shape', String(n)],
                ['R', 'RelWidth', absolute ? '0' : w], ['R', 'RelHeight', absolute ? '0' : h],
                ['R', 'AbsWidth', absolute ? w : '0'], ['R', 'AbsHeight', absolute ? h : '0'],
                ['R', 'Absolute', absolute ? '1' : '0'],
                ['R', 'CornerRadius', dist(pct(o.cornerRadius ?? 9, 'cornerRadius', 10000), 'cornerRadius')],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    free_distort: {
        label: 'Free Distort',
        params: {
            corners: {
                type: 'object',
                description: 'Where each corner of the bounding box moves: topLeft, topRight, bottomLeft, bottomRight as [x, y] fractions of the width and height from the top-left (y down); omitted corners stay put. E.g. { topRight: [1.2, -0.1] }',
                properties: Object.fromEntries(CORNERS.map((c) => [c, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }])),
            },
        },
        required: ['corners'],
        build: (o) => {
            const corners = o.corners && typeof o.corners === 'object' ? o.corners : {};
            const unknown = Object.keys(corners).filter((k) => !CORNERS.includes(k));
            if (unknown.length) throw new Error(`free_distort corners are ${CORNERS.join(', ')}; not ${unknown.join(', ')}`);
            const parts = [];
            CORNERS.forEach((c, i) => parts.push(['R', `src${i}h`, String(UNIT_SQUARE[c][0])], ['R', `src${i}v`, String(-UNIT_SQUARE[c][1])]));
            CORNERS.forEach((c, i) => {
                const p = corners[c] ?? UNIT_SQUARE[c];
                if (!Array.isArray(p) || p.length !== 2) throw new Error(`free_distort corners.${c} must be [x, y]`);
                parts.push(['R', `dst${i}h`, num(p[0], { min: -10, max: 10, name: `corners.${c}` })],
                    ['R', `dst${i}v`, String(-Number(num(p[1], { min: -10, max: 10, name: `corners.${c}` })))]);
            });
            return `'<LiveEffect name="Adobe Free Distort"><Dict data="' + ${dict(parts)} + ' "/></LiveEffect>'`;
        },
    },
    pucker_bloat: {
        label: 'Pucker & Bloat',
        params: { amount: { type: 'number', minimum: -200, maximum: 200, description: 'Percent: negative puckers, positive bloats' } },
        required: ['amount'],
        build: (o) => `'<LiveEffect name="Adobe Punk and Bloat"><Dict data="' + ${dict([['R', 'd_factor', num(o.amount, { min: -200, max: 200, name: 'amount' })]])} + ' "/></LiveEffect>'`,
    },
    tweak: {
        label: 'Tweak',
        params: {
            horizontal: { type: 'number', minimum: 0, maximum: 1000, default: 10, description: 'Percent, or points when relative is false' },
            vertical: { type: 'number', minimum: 0, maximum: 1000, default: 10, description: 'Percent, or points when relative is false' },
            relative: { type: 'boolean', default: true, description: 'Amounts relative to the object\'s size (false: absolute points)' },
            anchors: { type: 'boolean', default: true, description: 'Move anchor points' },
            inHandles: { type: 'boolean', default: true, description: 'Move "in" control points' },
            outHandles: { type: 'boolean', default: true, description: 'Move "out" control points' },
        },
        build: (o) => {
            const relative = flag(o.relative, true, 'relative') === '1';
            const amount = (v, name) => (relative ? pct(v ?? 10, name, 1000) : dist(pct(v ?? 10, name, 1000), name));
            const h = amount(o.horizontal, 'horizontal'), v = amount(o.vertical, 'vertical');
            return `'<LiveEffect name="Adobe Scribble and Tweak" isPre="1"><Dict data="' + ${dict([
                ['R', 'horz', h], ['R', 'vert', v], ['R', 'ahor', h], ['R', 'aver', v],
                ['R', 'absoluteness', relative ? '0' : '1'],
                ['B', 'in', flag(o.inHandles, true, 'inHandles')],
                ['B', 'out', flag(o.outHandles, true, 'outHandles')],
                ['B', 'anch', flag(o.anchors, true, 'anchors')],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    twist: {
        label: 'Twist',
        params: { angle: { type: 'number', minimum: -3600, maximum: 3600, description: 'Degrees' } },
        required: ['angle'],
        build: (o) => `'<LiveEffect name="Adobe Twirl" isPre="1"><Dict data="' + ${dict([['R', 'angle', num(o.angle, { min: -3600, max: 3600, name: 'angle' })]])} + ' "/></LiveEffect>'`,
    },
    zig_zag: {
        label: 'Zig Zag',
        params: {
            size: { type: 'number', minimum: 0, maximum: 1000, default: 10, description: 'Points, or percent when relative is true' },
            relative: { type: 'boolean', default: false, description: 'Size relative to the object (false: absolute points)' },
            ridges: { type: 'integer', minimum: 0, maximum: 100, default: 4, description: 'Ridges per segment' },
            smooth: { type: 'boolean', default: false, description: 'Smooth waves (false: sharp corners)' },
        },
        build: (o) => {
            const relative = flag(o.relative, false, 'relative') === '1';
            const size = relative ? pct(o.size ?? 10, 'size', 1000) : dist(pct(o.size ?? 10, 'size', 1000), 'size');
            return `'<LiveEffect name="Adobe Zigzag"><Dict data="' + ${dict([
                ['R', 'amount', size],
                ['R', 'relAmount', relative ? size : '0'],
                ['R', 'absoluteness', relative ? '0' : '1'],
                ['R', 'ridges', index(o.ridges ?? 4, { name: 'ridges', max: 100 })],
                ['R', 'roundness', flag(o.smooth, false, 'smooth')],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    warp: {
        label: 'Warp',
        params: {
            style: { type: 'string', enum: Object.keys(WARP_STYLES) },
            bend: { type: 'number', minimum: -100, maximum: 100, default: 50, description: 'Percent' },
            vertical: { type: 'boolean', default: false, description: 'Warp along the vertical axis (false: horizontal)' },
            horizontalDistortion: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Percent' },
            verticalDistortion: { type: 'number', minimum: -100, maximum: 100, default: 0, description: 'Percent' },
        },
        required: ['style'],
        build: (o) => {
            const style = enumOf(o.style, Object.keys(WARP_STYLES), { name: 'style' });
            const frac = (v, name, def) => `(${num(v ?? def, { min: -100, max: 100, name })} / 100)`;
            return `'<LiveEffect name="Adobe Deform"><Dict data="' + ${dict([
                ['S', 'DisplayString', `"Warp:${WARP_STYLES[style]}"`],
                ['I', 'DeformStyle', String(Object.keys(WARP_STYLES).indexOf(style) + 1)],
                ['B', 'Rotate', flag(o.vertical, false, 'vertical')],
                ['R', 'DeformValue', frac(o.bend, 'bend', 50)],
                ['R', 'DeformHoriz', frac(o.horizontalDistortion, 'horizontalDistortion', 0)],
                ['R', 'DeformVert', frac(o.verticalDistortion, 'verticalDistortion', 0)],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    outline_object: plain('Outline Object', '<LiveEffect name="Adobe Outline Type"><Dict data=" "/></LiveEffect>'),
    outline_stroke: plain('Outline Stroke', '<LiveEffect name="Adobe Outline Stroke"><Dict data=" "/></LiveEffect>'),
    crop_marks: plain('Crop Marks', '<LiveEffect name="Adobe Trim Marks"><Dict data="I styl 0 "/></LiveEffect>'),
    rasterize: {
        label: 'Rasterize',
        raster: true,
        params: {
            colorModel: { type: 'string', enum: ['document', 'grayscale', 'bitmap'], default: 'document', description: 'document: RGB or CMYK, as the document' },
            resolution: { type: 'integer', minimum: 72, maximum: 2400, description: 'Pixels per inch. Default: the document raster effects resolution' },
            transparent: { type: 'boolean', default: false, description: 'Transparent background (false: white)' },
            antiAlias: { type: 'string', enum: ['none', 'art', 'type'], default: 'art', description: 'none, art optimized or type optimized' },
            clippingMask: { type: 'boolean', default: false, description: 'Create a clipping mask' },
            padding: { type: 'number', minimum: 0, maximum: 1000, default: 0, description: 'Points added around the object' },
        },
        build: (o) => {
            const model = enumOf(o.colorModel ?? 'document', ['document', 'grayscale', 'bitmap'], { name: 'colorModel' });
            const aa = enumOf(o.antiAlias ?? 'art', ['none', 'art', 'type'], { name: 'antiAlias' });
            const colr = { document: '(doc.documentColorSpace === DocumentColorSpace.CMYK ? 1 : 0)', grayscale: '2', bitmap: '3' }[model];
            const dpi = o.resolution === undefined ? 'Math.round(doc.rasterEffectSettings.resolution)' : index(o.resolution, { name: 'resolution', max: 2400 });
            if (o.resolution !== undefined && o.resolution < 72) throw new Error("Value for 'resolution' out of range [72, 2400]");
            return `'<LiveEffect name="Adobe Rasterize"><Dict data="' + ${dict([
                ['I', 'colr', `(${colr} + ${flag(o.transparent, false, 'transparent') === '1' ? 4 : 0})`],
                ['B', 'alis', aa === 'none' ? '0' : '1'],
                ['I', 'dpi.', dpi],
                ['B', 'mask', flag(o.clippingMask, false, 'clippingMask')],
                ['R', 'padd', dist(pct(o.padding ?? 0, 'padding', 1000), 'padding')],
                ['I', 'optn', aa === 'type' ? '16' : '0'],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    ntsc_colors: {
        label: 'NTSC Colors',
        raster: true,
        params: {},
        menu: 'Live PSAdapter_plugin_NTSC',
    },
    offset_path: {
        label: 'Offset Path',
        params: {
            offset: { type: 'number', description: 'Points; negative shrinks the shape' },
            joins: { type: 'string', enum: Object.keys(JOINS), default: 'miter' },
            miterLimit: { type: 'number', minimum: 1, maximum: 500, default: 4 },
        },
        required: ['offset'],
        build: (o) => `'<LiveEffect name="Adobe Offset Path"><Dict data="' + ${dict([
            ['R', 'ofst', dist(o.offset, 'offset')],
            ['I', 'jntp', String(JOINS[enumOf(o.joins ?? 'miter', Object.keys(JOINS), { name: 'joins' })])],
            ['R', 'mlim', num(o.miterLimit ?? 4, { min: 1, max: 500, name: 'miterLimit' })],
        ])} + ' "/></LiveEffect>'`,
    },
    round_corners: {
        label: 'Round Corners',
        params: { radius: { type: 'number', minimum: 0, description: 'Points' } },
        required: ['radius'],
        build: (o) => `'<LiveEffect name="Adobe Round Corners"><Dict data="' + ${dict([['R', 'radius', dist(o.radius, 'radius')]])} + ' "/></LiveEffect>'`,
    },
    roughen: {
        label: 'Roughen',
        params: {
            size: { type: 'number', minimum: 0, maximum: 100, default: 5, description: 'Percent of the object\'s size' },
            detail: { type: 'number', minimum: 0, maximum: 100, default: 10, description: 'Points per inch' },
            smooth: { type: 'boolean', default: true, description: 'Smooth points (false: corner points)' },
        },
        build: (o) => `'<LiveEffect name="Adobe Roughen"><Dict data="' + ${dict([
            ['R', 'asiz', pct(o.size ?? 5, 'size')],
            ['R', 'size', pct(o.size ?? 5, 'size')],
            ['R', 'absoluteness', '0'],
            ['R', 'dtal', pct(o.detail ?? 10, 'detail')],
            ['R', 'roundness', o.smooth === false ? '0' : '1'],
        ])} + ' "/></LiveEffect>'`,
    },
    transform: {
        label: 'Transform',
        params: {
            scale: { type: 'number', minimum: 0, maximum: 4000, default: 100, description: 'Percent' },
            moveX: { type: 'number', default: 0, description: 'Points' },
            moveY: { type: 'number', default: 0, description: 'Points (down is positive)' },
            rotate: { type: 'number', minimum: -360, maximum: 360, default: 0, description: 'Degrees' },
            copies: { type: 'integer', minimum: 0, maximum: 1000, default: 0, description: 'Extra transformed copies (0: transform only)' },
        },
        build: (o) => {
            const s = num(o.scale ?? 100, { min: 0, max: 4000, name: 'scale' });
            const r = num(o.rotate ?? 0, { min: -360, max: 360, name: 'rotate' });
            return `'<LiveEffect name="Adobe Transform"><Dict data="' + ${dict([
                ['R', 'scaleH_Percent', s], ['R', 'scaleV_Percent', s],
                ['R', 'scaleH_Factor', `(${s} / 100)`], ['R', 'scaleV_Factor', `(${s} / 100)`],
                ['R', 'moveH_Pts', dist(o.moveX ?? 0, 'moveX')],
                ['R', 'moveV_Pts', `(-${dist(o.moveY ?? 0, 'moveY')})`],
                ['R', 'rotate_Degrees', r], ['R', 'rotate_Radians', `(${r} * Math.PI / 180)`],
                ['I', 'numCopies', index(o.copies ?? 0, { name: 'copies', max: 1000 })],
                ['I', 'pinPoint', '4'],
                ['B', 'scaleLines', '1'], ['B', 'transformPatterns', '1'], ['B', 'transformObjects', '1'],
                ['B', 'reflectX', '0'], ['B', 'reflectY', '0'], ['B', 'randomize', '0'],
            ])} + ' "/></LiveEffect>'`;
        },
    },
    gaussian_blur: {
        label: 'Gaussian Blur',
        raster: true,
        params: { radius: { type: 'number', minimum: 0.1, maximum: 250, description: 'Pixels' } },
        required: ['radius'],
        build: (o) => `'<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="' + ${dict([
            ['R', 'blur', num(o.radius, { min: 0.1, max: 250, name: 'radius' })],
            ['R', 'PrevDocScale', '1'],
            ['I', 'PrevDres', '300'],
        ])} + ' "/></LiveEffect>'`,
    },
};

/** Pathfinder operations and their Command numbers in the "Adobe Pathfinder" effect. */
export const PATHFINDER_COMMANDS = {
    unite: 0, intersect: 1, exclude: 2, minus_front: 3, minus_back: 4,
    divide: 5, outline: 6, trim: 7, merge: 8, crop: 9, hard_mix: 10,
};
/** Pathfinder effects whose menu commands open a dialog, so only the effect route applies them. */
export const PATHFINDER_EFFECT_ONLY = { soft_mix: 11, trap: 12 };
const PATHFINDER_ALL = { ...PATHFINDER_COMMANDS, ...PATHFINDER_EFFECT_ONLY };
const PATHFINDER_NAMES = ['Add', 'Intersect', 'Exclude', 'Minus Front', 'Minus Back', 'Divide', 'Outline', 'Trim', 'Merge', 'Crop', 'Hard Mix', 'Soft Mix', 'Trap'];

/**
 * The "Adobe Pathfinder" effect as a script expression. Soft Mix reads Mix
 * (0-1); Trap reads TrapThickness (pt), TrapAspect (height/width, 1 = 100%),
 * TrapTint (tint reduction, 0-1) and TrapReverse, with mark1bean's defaults
 * matching the Trap dialog's.
 */
export function pathfinderEffect(operation, {
    precision = 10, removeRedundantPoints = false, removeUnpainted = false,
    mixRate = 50, trapThickness = 0.25, trapHeightWidth = 100, trapTintReduction = 40, trapReverse = false,
} = {}) {
    const command = PATHFINDER_ALL[enumOf(operation, Object.keys(PATHFINDER_ALL), { name: 'operation' })];
    const trap = command === 12 ? [
        ['R', 'TrapAspect', `(${num(trapHeightWidth, { min: 25, max: 400, name: 'trapHeightWidth' })} / 100)`],
        ['B', 'TrapConvertCustom', '1'],
        ['R', 'TrapMaxTint', '1'],
        ['B', 'TrapReverse', trapReverse ? '1' : '0'],
        ['R', 'TrapThickness', num(trapThickness, { min: 0.01, max: 5000, name: 'trapThickness' })],
        ['R', 'TrapTint', `(${num(trapTintReduction, { min: 0, max: 100, name: 'trapTintReduction' })} / 100)`],
        ['R', 'TrapTintTolerance', '0.05'],
    ] : [];
    return `'<LiveEffect name="Adobe Pathfinder" isPre="1"><Dict data="' + ${dict([
        ['I', 'Command', String(command)],
        ['B', 'ConvertCustom', '1'],
        ['B', 'ExtractUnpainted', removeUnpainted ? '1' : '0'],
        ['R', 'Mix', `(${num(mixRate, { min: 0, max: 100, name: 'mixRate' })} / 100)`],
        ['R', 'Precision', num(precision, { min: 0.001, max: 100, name: 'precision' })],
        ['B', 'RemovePoints', removeRedundantPoints ? '1' : '0'],
        ...trap,
    ])} + '"><Entry name="DisplayString" value="${PATHFINDER_NAMES[command]}" valueType="S"/></Dict></LiveEffect>'`;
}

/** One line per effect for the tool description: its options, defaults and units. */
export function effectOptionsHelp() {
    const option = (e, k, v) => `${k}${(e.required ?? []).includes(k) ? ' (required)' : ''}${v.enum && v.enum.length < 16 ? ` ${v.enum.join('|')}` : ''}${v.default !== undefined ? ` = ${v.default}` : ''}${v.description ? ` [${v.description}]` : ''}`;
    return [
        ...Object.entries(EFFECTS).map(([id, e]) => {
            const opts = Object.entries(e.params).map(([k, v]) => option(e, k, v));
            return `${id}${e.raster ? ' (raster)' : ''}: ${opts.length ? opts.join(', ') : 'no options'}`;
        }),
        `modes: ${Object.keys(BLEND_MODES).join('|')}`,
    ].join('; ');
}
