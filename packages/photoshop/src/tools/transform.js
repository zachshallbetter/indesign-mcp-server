/**
 * Transformations through the Action Manager: align and distribute, auto-align
 * and auto-blend, numeric transforms with skew (layers or paths, Transform
 * Again, duplicate while transforming), warp presets, Perspective Warp and
 * Content-Aware Scale. Plain move, scale, rotate and flip are transform_layers.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM_HELPERS, QCS_ANCHORS } from '../actions.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

// alignDistributeSelector values for each edge.
const EDGES = {
    top: 'ADSTops', vertical_center: 'ADSCentersV', bottom: 'ADSBottoms',
    left: 'ADSLefts', horizontal_center: 'ADSCentersH', right: 'ADSRights',
};
// Auto-Align projections (charIDs) and Auto-Blend methods (autoBlendType).
const PROJECTIONS = { auto: 'Auto', perspective: 'Prsp' };
const BLEND_METHODS = { panorama: 'panorama', stack: 'maxDOF' };
const WARP_STYLES = {
    arc: 'warpArc', arc_lower: 'warpArcLower', arc_upper: 'warpArcUpper', arch: 'warpArch', bulge: 'warpBulge',
    shell_lower: 'warpShellLower', shell_upper: 'warpShellUpper', flag: 'warpFlag', wave: 'warpWave', fish: 'warpFish',
    rise: 'warpRise', fisheye: 'warpFisheye', inflate: 'warpInflate', squeeze: 'warpSqueeze', twist: 'warpTwist',
};

const ANCHOR_SCHEMA = { type: 'string', enum: QCS_ANCHORS, description: 'Reference point. Default center' };
const POINT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };
const QUAD_SCHEMA = { type: 'array', items: POINT, minItems: 4, maxItems: 4 };

const RESULT = `
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`;

/** Statements that start transform descriptor `d` on reference `ref` around an anchor. */
function transformStart(anchor) {
    return `var d = new ActionDescriptor();
d.putReference(__s("null"), ref);
d.putEnumerated(__s("freeTransformCenterState"), __s("quadCenterState"), __qcs(${str(enumOf(anchor ?? 'center', QCS_ANCHORS, { name: 'anchor' }))}));`;
}

/** Statements adding offset, scale, angle and skew to transform descriptor `d`. */
function transformValues(a) {
    const lines = [];
    lines.push('var off = new ActionDescriptor();',
        `off.putUnitDouble(__s("horizontal"), __s("pixelsUnit"), ${num(a.dx ?? 0, { min: -300000, max: 300000, name: 'dx' })});`,
        `off.putUnitDouble(__s("vertical"), __s("pixelsUnit"), ${num(a.dy ?? 0, { min: -300000, max: 300000, name: 'dy' })});`,
        'd.putObject(__s("offset"), __s("offset"), off);');
    if (a.scaleX !== undefined) lines.push(`d.putUnitDouble(__s("width"), __s("percentUnit"), ${num(a.scaleX, { min: -10000, max: 10000, name: 'scaleX' })});`);
    if (a.scaleY !== undefined) lines.push(`d.putUnitDouble(__s("height"), __s("percentUnit"), ${num(a.scaleY, { min: -10000, max: 10000, name: 'scaleY' })});`);
    if (a.angle !== undefined) lines.push(`d.putUnitDouble(__s("angle"), __s("angleUnit"), ${num(a.angle, { min: -360, max: 360, name: 'angle' })});`);
    if (a.skewX !== undefined || a.skewY !== undefined) {
        lines.push('var sk = new ActionDescriptor();',
            `sk.putUnitDouble(__s("horizontal"), __s("angleUnit"), ${num(a.skewX ?? 0, { min: -89, max: 89, name: 'skewX' })});`,
            `sk.putUnitDouble(__s("vertical"), __s("angleUnit"), ${num(a.skewY ?? 0, { min: -89, max: 89, name: 'skewY' })});`,
            'd.putObject(__s("skew"), __c("Pnt "), sk);');
    }
    return lines.join('\n');
}

/** Four [x, y] points, checked. */
function quad(points, name) {
    if (!Array.isArray(points) || points.length !== 4) throw new Error(`'${name}' needs four [x, y] corners: top-left, top-right, bottom-right, bottom-left`);
    return points.map((p, i) => [Number(num(p?.[0], { min: -300000, max: 300000, name: `${name}[${i}][0]` })), Number(num(p?.[1], { min: -300000, max: 300000, name: `${name}[${i}][1]` }))]);
}

export const tools = [
    {
        name: 'align_layers',
        description: 'Align layers by their top, vertical centre, bottom, left, horizontal centre or right edges (Layer > Align), or distribute them evenly by those edges (Layer > Distribute; three or more layers). With toSelection, align them to the selection (Layer > Align Layers To Selection)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                edge: { type: 'string', enum: Object.keys(EDGES) },
                distribute: { type: 'boolean', description: 'Distribute instead of align. Default false', default: false },
                toSelection: { type: 'boolean', description: 'Align to the current selection. Default false; Photoshop aligns to a selection whenever there is one, so without toSelection the call refuses when something is selected', default: false },
            },
            required: ['target', 'edge'],
        },
        auditArgs: { target: { ids: [3, 4, 5] }, toSelection: false },
        features: ['photoshop.transformations.align_top_edges', 'photoshop.transformations.align_vertical_centers', 'photoshop.transformations.align_bottom_edges', 'photoshop.transformations.align_left_edges',
            'photoshop.transformations.align_horizontal_centers', 'photoshop.transformations.align_right_edges', 'photoshop.transformations.distribute_top_edges', 'photoshop.transformations.distribute_vertical_centers',
            'photoshop.transformations.distribute_bottom_edges', 'photoshop.transformations.distribute_left_edges', 'photoshop.transformations.distribute_horizontal_centers', 'photoshop.transformations.distribute_right_edges',
            'photoshop.transformations.align_layers_to_selection'],
        handler: (a) => {
            const edge = EDGES[enumOf(a.edge, Object.keys(EDGES), { name: 'edge' })];
            if (a.distribute && a.toSelection) throw new Error('Distribute works between layers; drop toSelection');
            const min = a.distribute ? 3 : a.toSelection ? 1 : 2;
            return run(a.distribute ? 'Distribute layers' : 'Align layers', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < ${min}) throw new Error("${a.distribute ? 'Distributing needs at least three layers' : 'Aligning needs at least two layers, or toSelection'}");
${a.toSelection ? 'if (!__hasSelection(doc)) throw new Error("Nothing is selected to align to");' : 'if (__hasSelection(doc)) throw new Error("There is a selection, so Photoshop would align to it: pass toSelection: true, or deselect first");'}
__selectLayers(items);
var d = new ActionDescriptor();
d.putReference(__s("null"), __targetRef());
d.putEnumerated(__s("using"), __s("alignDistributeSelector"), __s(${str(edge)}));
__do(${a.distribute ? '__c("Dstr")' : '__s("align")'}, d);
${RESULT}`));
        },
    },
    {
        name: 'auto_align_layers',
        description: 'Line up overlapping photos of the same scene (Edit > Auto-Align Layers) by their content, with the Auto or Perspective projection, optionally removing vignetting and correcting geometric distortion. Pixel layers only: not adjustment, vector or Smart Object layers',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                projection: { type: 'string', enum: Object.keys(PROJECTIONS), description: 'Default auto' },
                removeVignette: { type: 'boolean', description: 'Vignette Removal. Default false', default: false },
                geometricDistortion: { type: 'boolean', description: 'Geometric Distortion correction. Default false', default: false },
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [3, 4] } },
        features: ['photoshop.transformations.auto_align_layers'],
        handler: (a) => run('Auto-align layers', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < 2) throw new Error("Auto-Align needs at least two layers");
__selectLayers(items);
var d = new ActionDescriptor();
d.putReference(__s("null"), __targetRef());
d.putEnumerated(__c("Usng"), __c("ADSt"), __s("ADSContent"));
d.putEnumerated(__c("Aply"), __s("projection"), __c(${str(PROJECTIONS[enumOf(a.projection ?? 'auto', Object.keys(PROJECTIONS), { name: 'projection' })])}));
d.putBoolean(__s("vignette"), ${bool(a.removeVignette)});
d.putBoolean(__s("radialDistort"), ${bool(a.geometricDistortion)});
__do(__c("Algn"), d);
${RESULT}`)),
    },
    {
        name: 'auto_blend_layers',
        description: 'Blend aligned layers into one seamless image (Edit > Auto-Blend Layers): a panorama, or a focus stack that keeps the sharpest areas of each layer, with Seamless Tones and Colors. RGB or Grayscale; not for Smart Objects, video, 3D or the background layer',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                method: { type: 'string', enum: Object.keys(BLEND_METHODS), description: 'Default panorama' },
                seamlessTones: { type: 'boolean', description: 'Seamless Tones and Colors. Default true', default: true },
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [3, 4] } },
        features: ['photoshop.transformations.auto_blend_layers'],
        handler: (a) => run('Auto-blend layers', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < 2) throw new Error("Auto-Blend needs at least two layers");
for (var i = 0; i < items.length; i++) if (items[i].typename === "ArtLayer" && items[i].isBackgroundLayer) throw new Error("Auto-Blend cannot use the background layer");
__selectLayers(items);
var d = new ActionDescriptor();
d.putEnumerated(__c("Aply"), __s("autoBlendType"), __s(${str(BLEND_METHODS[enumOf(a.method ?? 'panorama', Object.keys(BLEND_METHODS), { name: 'method' })])}));
d.putBoolean(__c("ClrC"), ${bool(a.seamlessTones ?? true)});
__do(__s("mergeAlignedLayers"), d);
__result__ = { activeLayer: __layerInfo(doc.activeLayer) };`)),
    },
    {
        name: 'apply_transform',
        description: 'Transform layers or a path numerically, as Free Transform\'s options bar does: move, scale, rotate and skew (Edit > Transform > Skew) around a reference point; repeat the last transform (Edit > Transform > Again); or transform a duplicate, keeping the original. With path, transforms the path\'s points (Edit > Transform Path)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: TARGET_SCHEMA.description + '. Each layer transforms around its own reference point' },
                path: { type: 'string', description: 'A path name (Paths panel) to transform instead of layers' },
                dx: { type: 'number', description: 'Move right, pixels' },
                dy: { type: 'number', description: 'Move down, pixels' },
                scaleX: { type: 'number', minimum: -10000, maximum: 10000, description: 'Width, percent; negative flips' },
                scaleY: { type: 'number', minimum: -10000, maximum: 10000, description: 'Height, percent; negative flips' },
                angle: { type: 'number', minimum: -360, maximum: 360, description: 'Degrees, clockwise' },
                skewX: { type: 'number', minimum: -89, maximum: 89, description: 'Horizontal skew, degrees' },
                skewY: { type: 'number', minimum: -89, maximum: 89, description: 'Vertical skew, degrees' },
                anchor: ANCHOR_SCHEMA,
                again: { type: 'boolean', description: 'Repeat the last transform instead of giving values (Transform Again)', default: false },
                duplicate: { type: 'boolean', description: 'Layers: transform a copy of each layer, placed above it. Default false', default: false },
            },
        },
        auditArgs: { target: { ids: [3] }, path: undefined, again: false },
        features: ['photoshop.transformations.transform_skew', 'photoshop.transformations.transform_again', 'photoshop.transformations.transform_path_points', 'photoshop.transformations.duplicate_while_transforming'],
        handler: (a) => {
            const hasValues = ['dx', 'dy', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY'].some((k) => a[k] !== undefined);
            if (a.again && hasValues) throw new Error('again repeats the last transform; give no values with it');
            if (!a.again && !hasValues) throw new Error('Give dx/dy, scaleX/scaleY, angle, skewX/skewY, or again');
            if ((a.path !== undefined) === (a.target !== undefined)) throw new Error('Give target (layers) or path');
            if (a.path !== undefined && a.duplicate) throw new Error('duplicate is for layers');
            const body = a.again ? 'd.putBoolean(__s("lastTransform"), true);' : transformValues(a);
            if (a.path !== undefined) {
                return run('Transform path', script(`${AM_HELPERS}
try { doc.pathItems.getByName(${str(a.path)}); } catch (e) { throw new Error("No path named " + ${str(a.path)}); }
var ref = new ActionReference();
ref.putName(__s("path"), ${str(a.path)});
${transformStart(a.anchor)}
${body}
__do(__s("transform"), d);
__result__ = { path: ${str(a.path)} };`));
            }
            return run('Transform layers', script(`${AM_HELPERS}
var src = __targets(doc, ${targetSpec(a.target)}), items = [];
for (var i = 0; i < src.length; i++) {
  var l = ${a.duplicate ? 'src[i].duplicate(src[i], ElementPlacement.PLACEBEFORE)' : 'src[i]'};
  __selectLayers([l]);
  var ref = __targetRef();
  ${transformStart(a.anchor).split('\n').join('\n  ')}
  ${body.split('\n').join('\n  ')}
  __do(__s("transform"), d);
  items.push(l);
}
${RESULT}`));
        },
    },
    {
        name: 'warp_layers',
        description: 'Warp layers with a preset style (Edit > Transform > Warp): arc, arch, bulge, flag, wave, fisheye, twist and the rest, with bend and horizontal and vertical distortion in percent, horizontal or vertical. Warping a Smart Object stays editable',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                style: { type: 'string', enum: Object.keys(WARP_STYLES) },
                bend: { type: 'number', minimum: -100, maximum: 100, description: 'Percent. Default 50' },
                horizontalDistortion: { type: 'number', minimum: -100, maximum: 100, description: 'Percent. Default 0' },
                verticalDistortion: { type: 'number', minimum: -100, maximum: 100, description: 'Percent. Default 0' },
                orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Default horizontal' },
            },
            required: ['target', 'style'],
        },
        auditArgs: { target: { ids: [3] } },
        features: ['photoshop.transformations.warp', 'photoshop.transformations.warp_presets', 'photoshop.transformations.warp_orientation_numeric'],
        handler: (a) => {
            const style = WARP_STYLES[enumOf(a.style, Object.keys(WARP_STYLES), { name: 'style' })];
            const orientation = enumOf(a.orientation ?? 'horizontal', ['horizontal', 'vertical'], { name: 'orientation' });
            return run('Warp layers', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var l = items[i], b = __bounds(l);
  if (!b.width || !b.height) throw new Error(l.name + " is empty");
  __selectLayers([l]);
  var ref = __targetRef();
  ${transformStart('center').split('\n').join('\n  ')}
  var off = new ActionDescriptor();
  off.putUnitDouble(__s("horizontal"), __s("pixelsUnit"), 0);
  off.putUnitDouble(__s("vertical"), __s("pixelsUnit"), 0);
  d.putObject(__s("offset"), __s("offset"), off);
  var w = new ActionDescriptor(), r = new ActionDescriptor();
  w.putEnumerated(__s("warpStyle"), __s("warpStyle"), __s(${str(style)}));
  w.putDouble(__s("warpValue"), ${num(a.bend ?? 50, { min: -100, max: 100, name: 'bend' })});
  w.putDouble(__s("warpPerspective"), ${num(a.horizontalDistortion ?? 0, { min: -100, max: 100, name: 'horizontalDistortion' })});
  w.putDouble(__s("warpPerspectiveOther"), ${num(a.verticalDistortion ?? 0, { min: -100, max: 100, name: 'verticalDistortion' })});
  w.putEnumerated(__s("warpRotate"), __s("orientation"), __s(${str(orientation)}));
  r.putDouble(__s("top"), b.y);
  r.putDouble(__s("left"), b.x);
  r.putDouble(__s("bottom"), b.y + b.height);
  r.putDouble(__s("right"), b.x + b.width);
  w.putObject(__s("bounds"), __s("classFloatRect"), r);
  w.putInteger(__s("uOrder"), 4);
  w.putInteger(__s("vOrder"), 4);
  d.putObject(__s("warp"), __s("warp"), w);
  __do(__s("transform"), d);
}
${RESULT}`));
        },
    },
    {
        name: 'warp_perspective',
        description: 'Correct or change a layer\'s perspective (Edit > Perspective Warp) with one quad: four corners in the image move to four new positions, e.g. to square up a photographed sign. Corners go top-left, top-right, bottom-right, bottom-left, in pixels. Needs the graphics processor enabled',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One layer' },
                from: { ...QUAD_SCHEMA, description: 'The quad\'s corners in the image now, [[x, y] x 4]' },
                to: { ...QUAD_SCHEMA, description: 'Where those corners go, [[x, y] x 4]' },
            },
            required: ['target', 'from', 'to'],
        },
        auditArgs: { target: { ids: [3] }, from: [[10, 10], [200, 20], [190, 150], [5, 140]], to: [[0, 0], [200, 0], [200, 150], [0, 150]] },
        features: ['photoshop.transformations.perspective_warp'],
        handler: (a) => {
            const from = quad(a.from, 'from'), to = quad(a.to, 'to');
            const xs = from.map((p) => p[0]), ys = from.map((p) => p[1]);
            const box = { top: Math.min(...ys), left: Math.min(...xs), bottom: Math.max(...ys), right: Math.max(...xs) };
            if (box.right - box.left < 1 || box.bottom - box.top < 1) throw new Error("'from' must enclose an area");
            return run('Perspective warp', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1) throw new Error("Perspective Warp works on one layer at a time");
__selectLayers(items);
var from = ${json(from)}, to = ${json(to)}, box = ${json(box)};
var d = new ActionDescriptor(), rect = new ActionDescriptor(), verts = new ActionList(), warped = new ActionList(), idx = new ActionList();
d.putReference(__s("null"), __targetRef());
d.putEnumerated(__s("mode"), __s("perspectiveWarpMode"), __s("warp"));
rect.putUnitDouble(__s("top"), __s("pixelsUnit"), box.top);
rect.putUnitDouble(__s("left"), __s("pixelsUnit"), box.left);
rect.putUnitDouble(__s("bottom"), __s("pixelsUnit"), box.bottom);
rect.putUnitDouble(__s("right"), __s("pixelsUnit"), box.right);
d.putObject(__s("referenceRect"), __s("rectangle"), rect);
for (var i = 0; i < 4; i++) {
  var p = new ActionDescriptor(), q = new ActionDescriptor();
  p.putUnitDouble(__s("horizontal"), __s("pixelsUnit"), from[i][0]);
  p.putUnitDouble(__s("vertical"), __s("pixelsUnit"), from[i][1]);
  verts.putObject(__s("point"), p);
  q.putUnitDouble(__s("horizontal"), __s("pixelsUnit"), to[i][0]);
  q.putUnitDouble(__s("vertical"), __s("pixelsUnit"), to[i][1]);
  warped.putObject(__s("point"), q);
  idx.putInteger(i);
}
d.putList(__s("vertices"), verts);
d.putList(__s("warpedVertices"), warped);
var qd = new ActionDescriptor(), quads = new ActionList();
qd.putList(__s("indices"), idx);
quads.putObject(__s("perspectiveWarpQuad"), qd);
d.putList(__s("quads"), quads);
__do(__s("perspectiveWarpTransform"), d);
__result__ = __layerInfo(doc.activeLayer);`));
        },
    },
    {
        name: 'scale_content_aware',
        description: 'Resize a layer while keeping important content such as people and buildings unchanged (Edit > Content-Aware Scale): width and height in percent, the Amount of content-aware against normal scaling, Protect Skin Tones, and an alpha channel to protect',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One layer' },
                scaleX: { type: 'number', minimum: 1, maximum: 1000, description: 'Width, percent. Default 100' },
                scaleY: { type: 'number', minimum: 1, maximum: 1000, description: 'Height, percent. Default 100' },
                amount: { type: 'number', minimum: 0, maximum: 100, description: 'Percent of content-aware scaling. Default 100' },
                protectSkinTones: { type: 'boolean', description: 'Default false', default: false },
                protectChannel: { type: 'string', description: 'Alpha channel whose white areas are protected (list_channels)' },
                anchor: ANCHOR_SCHEMA,
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [3] } },
        features: ['photoshop.transformations.content_aware_scale'],
        handler: (a) => {
            if (a.scaleX === undefined && a.scaleY === undefined) throw new Error('Give scaleX, scaleY or both');
            const scale = {
                scaleX: Number(num(a.scaleX ?? 100, { min: 1, max: 1000, name: 'scaleX' })),
                scaleY: Number(num(a.scaleY ?? 100, { min: 1, max: 1000, name: 'scaleY' })),
            };
            return run('Content-aware scale', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1) throw new Error("Content-Aware Scale works on one layer at a time");
var l = items[0], selected = false;
if (l.typename !== "ArtLayer") throw new Error(l.name + " is a group");
${a.protectChannel !== undefined ? `try { doc.channels.getByName(${str(a.protectChannel)}); } catch (e) { throw new Error("No channel named " + ${str(a.protectChannel)}); }` : ''}
__selectLayers(items);
if (l.isBackgroundLayer && !__hasSelection(doc)) { doc.selection.selectAll(); selected = true; }
var ref = __targetRef();
${transformStart(a.anchor)}
${transformValues(scale)}
d.putBoolean(__s("contentAware"), true);
d.putBoolean(__s("skinTone"), ${bool(a.protectSkinTones)});
d.putDouble(__s("amount"), ${num(a.amount ?? 100, { min: 0, max: 100, name: 'amount' })});
${a.protectChannel !== undefined ? `d.putString(__s("channelName"), ${str(a.protectChannel)});` : ''}
try { __do(__s("transform"), d); } finally { if (selected) doc.selection.deselect(); }
__result__ = __layerInfo(l);`));
        },
    },
];
