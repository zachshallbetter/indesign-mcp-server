/**
 * Transformations beyond move, scale, rotate and reflect: Transform Each,
 * shear, matrices, Transform Again, Transform panel options and bounds,
 * distribution, envelopes, objects on a path, and free or perspective distort.
 *
 * Transform Each, Shear and the Transform panel are dialogs or panels, so they
 * are done through the object model (resize, rotate, translate, transform).
 * Transform Again, Reset Bounding Box, Make with Top Object, Release, Expand,
 * Edit Contents and Objects on Path > Expand run without a dialog and go
 * through executeMenuCommand on the targets.
 *
 * Preference keys follow published scripts:
 *   plugin/Transform/AnchorPoint  integer 0-8, top-left to bottom-right row by row
 *     (creold/illustrator-scripts ResizeToSize.jsx)
 *   policyForPreservingCorners    integer, 1 scale corners, 2 do not
 *     (creold/illustrator-scripts Rescale.jsx, ResizeToSize.jsx)
 *   showBoundingBox               boolean, toggled with "AI Bounding Box Toggle"
 *     (creold/illustrator-scripts SelectPointsByType.jsx)
 * Free Distort is LiveEffect "Adobe Free Distort" with source and destination
 * corners R src0h ... R dst3v, normalised to the bounding box (0-1, y up,
 * order top-left, top-right, bottom-left, bottom-right), as in
 * swwwitch/illustrator-scripts SmartFreeDistort.jsx.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';

/** Reference points, in the Transform panel's order (preference value 0-8). */
const ORIGINS = { topLeft: 'TOPLEFT', top: 'TOP', topRight: 'TOPRIGHT', left: 'LEFT', center: 'CENTER', right: 'RIGHT', bottomLeft: 'BOTTOMLEFT', bottom: 'BOTTOM', bottomRight: 'BOTTOMRIGHT' };
const ORIGIN_SCHEMA = { type: 'string', enum: Object.keys(ORIGINS), description: 'Reference point each item transforms around. Default center' };
const origin = (v) => `Transformation.${ORIGINS[enumOf(v ?? 'center', Object.keys(ORIGINS), { name: 'origin' })]}`;

/** Transform Both, Object Only or Pattern Only: changePositions, fill patterns, fill gradients, stroke patterns. */
const APPLY = { both: [true, true, true, true], objects: [true, false, true, false], patterns: [false, true, false, true] };
const APPLY_SCHEMA = { type: 'string', enum: Object.keys(APPLY), description: 'What to transform: both (default), objects only, or pattern fills only (Transform panel menu)' };
const flags = (v) => APPLY[enumOf(v ?? 'both', Object.keys(APPLY), { name: 'apply' })].map(bool).join(', ');

const SCALE_CORNERS_SCHEMA = { type: 'boolean', description: 'Scale live corner radii with the object (Scale Corners). Default: the current setting' };

/** Run body with Scale Corners set for its duration, restoring the user's setting afterwards. */
function withCorners(scaleCorners, body) {
    if (scaleCorners === undefined) return body;
    return `
var __corners = app.preferences.getIntegerPreference("policyForPreservingCorners");
app.preferences.setIntegerPreference("policyForPreservingCorners", ${scaleCorners ? 1 : 2});
try {
${body}
} finally {
  app.preferences.setIntegerPreference("policyForPreservingCorners", __corners);
}`;
}

/** ES3: scale stroke weights, from the argument or the Scale Strokes & Effects preference. */
const strokes = (v) => `var lwOn = ${v === undefined ? 'app.preferences.getBooleanPreference("scaleLineWeight")' : bool(v)};`;

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the selection as item info. */
const SELECTION = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));`;

/** ES3: a bounds rectangle in artboard points, y down. */
const RECT = `
function __rect(doc, g, ab) {
  var f = __sf(doc);
  return { x: (g[0] - ab.left) * f, y: (ab.top - g[1]) * f, width: (g[2] - g[0]) * f, height: (g[1] - g[3]) * f };
}`;

/** A 2x2 matrix [a, b, c, d] (x' = a x + c y, y' = b x + d y) times another. */
const mul = ([a1, b1, c1, d1], [a2, b2, c2, d2]) => [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2];

/** Shear by angle along an axis at axisAngle degrees, both counter-clockwise, y up. */
export function shearMatrix(angle, axisAngle) {
    const t = Math.tan((angle * Math.PI) / 180), r = (axisAngle * Math.PI) / 180;
    const R = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
    const Rinv = [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)];
    return mul(mul(R, [1, 0, t, 1]), Rinv).map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
}

/** ES3: build a Matrix from a, b, c, d and a translation in document units. */
const matrix = (m, tx = '0', ty = '0') => `
var m = app.getIdentityMatrix();
m.mValueA = ${num(m[0], { name: 'matrix a' })}; m.mValueB = ${num(m[1], { name: 'matrix b' })};
m.mValueC = ${num(m[2], { name: 'matrix c' })}; m.mValueD = ${num(m[3], { name: 'matrix d' })};
m.mValueTX = ${tx}; m.mValueTY = ${ty};`;

const DISTRIBUTE = {
    left: ['x', 'lo'], hcenter: ['x', 'mid'], right: ['x', 'hi'], hspace: ['x', 'space'],
    top: ['y', 'lo'], vcenter: ['y', 'mid'], bottom: ['y', 'hi'], vspace: ['y', 'space'],
};

const ENVELOPE = { release: 'Release Envelope', expand: 'Expand Envelope', edit_contents: 'Edit Envelope Contents' };

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const UNIT = { topLeft: [0, 0], topRight: [1, 0], bottomLeft: [0, 1], bottomRight: [1, 1] };
const POINT_SCHEMA = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

/** Destination corners for a free or perspective distort, as fractions of the bounding box (y down). */
function distortCorners(a) {
    const mode = enumOf(a.mode, ['free', 'perspective'], { name: 'mode' });
    if (mode === 'free') {
        const c = a.corners && typeof a.corners === 'object' ? a.corners : {};
        const unknown = Object.keys(c).filter((k) => !CORNERS.includes(k));
        if (unknown.length) throw new Error(`corners has no ${unknown.join(', ')}. Give topLeft, topRight, bottomLeft, bottomRight as [x, y]`);
        if (!Object.keys(c).length) throw new Error('Free distort needs corners: e.g. { topLeft: [0.2, 0] } moves the top-left corner 20% of the width right');
        return CORNERS.map((k) => {
            const p = c[k] ?? UNIT[k];
            if (!Array.isArray(p) || p.length !== 2) throw new Error(`corners.${k} must be [x, y]`);
            return p.map((v, i) => Number(num(v, { min: -10, max: 10, name: `corners.${k}[${i}]` })));
        });
    }
    const edge = enumOf(a.edge, ['top', 'bottom', 'left', 'right'], { name: 'edge' });
    const t = Number(num(a.amount, { min: -100, max: 49, name: 'amount' })) / 100;
    const out = CORNERS.map((k) => [...UNIT[k]]);
    const pairs = { top: [[0, 0, t], [1, 0, -t]], bottom: [[2, 0, t], [3, 0, -t]], left: [[0, 1, t], [2, 1, -t]], right: [[1, 1, t], [3, 1, -t]] };
    for (const [i, axis, d] of pairs[edge]) out[i][axis] += d;
    return out;
}

/** The Free Distort LiveEffect XML for destination corners (fractions, y down). */
export function freeDistortXml(dest) {
    const parts = [];
    CORNERS.forEach((k, i) => parts.push(`R src${i}h ${UNIT[k][0]} R src${i}v ${-UNIT[k][1]}`));
    dest.forEach(([x, y], i) => parts.push(`R dst${i}h ${x} R dst${i}v ${y === 0 ? 0 : -y}`));
    return `<LiveEffect name="Adobe Free Distort"><Dict data="${parts.join(' ')} "/></LiveEffect>`;
}

export const tools = [
    {
        name: 'transform_each',
        description: 'Scale, move, rotate and flip each item around its own reference point (Object > Transform > Transform Each). With random, each item gets a random amount between none and the value given. With copy, transformed copies are made and the originals stay',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scaleX: { type: 'number', description: 'Horizontal scale in percent. Default 100' },
                scaleY: { type: 'number', description: 'Vertical scale in percent. Default 100' },
                moveX: { type: 'number', description: 'Horizontal move in points, right positive. Default 0' },
                moveY: { type: 'number', description: 'Vertical move in points, down positive. Default 0' },
                angle: { type: 'number', description: 'Rotation in degrees, counter-clockwise. Default 0' },
                flipHorizontal: { type: 'boolean', description: 'Mirror left-right' },
                flipVertical: { type: 'boolean', description: 'Mirror top-bottom' },
                origin: ORIGIN_SCHEMA,
                random: { type: 'boolean', description: 'Random amounts per item. Default false', default: false },
                copy: { type: 'boolean', description: 'Transform copies, leaving the originals. Default false', default: false },
                apply: APPLY_SCHEMA,
                scaleStrokes: { type: 'boolean', description: 'Scale stroke weights. Default: the Scale Strokes & Effects preference' },
                scaleCorners: SCALE_CORNERS_SCHEMA,
            },
            required: ['target'],
        },
        features: [
            'illustrator.transformations.transform_each',
            'illustrator.transformations.transform_each_option.scale_transform_each',
            'illustrator.transformations.transform_each_option.move_transform_each',
            'illustrator.transformations.transform_each_option.rotate_transform_each',
            'illustrator.transformations.transform_each_option.reference_point_transform_each',
            'illustrator.transformations.transform_panel_option.transform_object_only',
            'illustrator.transformations.transform_panel_option.transform_pattern_only',
            'illustrator.transformations.transform_panel_option.transform_both',
            'illustrator.transformations.transform_panel_option.scale_corners',
        ],
        auditArgs: { scaleX: 120, scaleY: 80, moveX: 5, angle: 15, flipHorizontal: true, random: true, copy: true, apply: 'objects', scaleCorners: true },
        handler: (a) => {
            const sx = num(a.scaleX ?? 100, { min: 0.01, max: 100000, name: 'scaleX' });
            const sy = num(a.scaleY ?? 100, { min: 0.01, max: 100000, name: 'scaleY' });
            const mx = num(a.moveX ?? 0, { min: -1e6, max: 1e6, name: 'moveX' });
            const my = num(a.moveY ?? 0, { min: -1e6, max: 1e6, name: 'moveY' });
            const ang = num(a.angle ?? 0, { min: -3600, max: 3600, name: 'angle' });
            if (sx === '100' && sy === '100' && mx === '0' && my === '0' && ang === '0' && !a.flipHorizontal && !a.flipVertical) {
                throw new Error('Nothing to do: give scaleX/scaleY, moveX/moveY, angle, flipHorizontal or flipVertical');
            }
            const f = flags(a.apply), o = origin(a.origin);
            return run('Transform each', script(`
var items = __targets(doc, ${targetSpec(a.target)}), ids = [];
${strokes(a.scaleStrokes)}
var rnd = function () { return ${a.random ? 'Math.random()' : '1'}; };
${withCorners(a.scaleCorners, `
for (var i = 0; i < items.length; i++) {
  var it = ${a.copy ? 'items[i].duplicate()' : 'items[i]'};
  var sx = 100 + (${sx} - 100) * rnd(), sy = 100 + (${sy} - 100) * rnd();
  ${a.flipHorizontal ? 'sx = -sx;' : ''}
  ${a.flipVertical ? 'sy = -sy;' : ''}
  if (sx !== 100 || sy !== 100) it.resize(sx, sy, ${f}, lwOn ? Math.sqrt(Math.abs(sx * sy)) : 100, ${o});
  var ang = ${ang} * rnd();
  if (ang !== 0) it.rotate(ang, ${f}, ${o});
  var mx = ${mx} * rnd(), my = ${my} * rnd();
  if (mx !== 0 || my !== 0) it.translate(__len(doc, mx), -__len(doc, my), ${f});
  ids.push(it.uuid);
}`)}
__result__ = { transformed: ids.length, copies: ${bool(a.copy)}, ids: ids };`));
        },
    },
    {
        name: 'shear_items',
        description: 'Shear (slant) items by an angle along a horizontal, vertical or angled axis (Object > Transform > Shear). On a horizontal axis a positive angle leans the item\'s vertical edges to the right',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                angle: { type: 'number', minimum: -89, maximum: 89, description: 'Shear angle in degrees' },
                axis: { type: 'string', enum: ['horizontal', 'vertical', 'angle'], description: 'Default horizontal', default: 'horizontal' },
                axisAngle: { type: 'number', description: 'With axis: angle, the axis direction in degrees counter-clockwise from horizontal' },
                origin: ORIGIN_SCHEMA,
                apply: APPLY_SCHEMA,
            },
            required: ['target', 'angle'],
        },
        features: [
            'illustrator.transformations.shear',
            'illustrator.transformations.transform_panel_option.transform_object_only',
            'illustrator.transformations.transform_panel_option.transform_pattern_only',
            'illustrator.transformations.transform_panel_option.transform_both',
        ],
        handler: (a) => {
            const axis = enumOf(a.axis ?? 'horizontal', ['horizontal', 'vertical', 'angle'], { name: 'axis' });
            if (axis === 'angle' && a.axisAngle === undefined) throw new Error('axis: angle needs axisAngle in degrees');
            const axisAngle = axis === 'horizontal' ? 0 : axis === 'vertical' ? 90 : Number(num(a.axisAngle, { min: -360, max: 360, name: 'axisAngle' }));
            const m = shearMatrix(Number(num(a.angle, { min: -89, max: 89, name: 'angle' })), axisAngle);
            return run('Shear items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${matrix(m)}
for (var i = 0; i < items.length; i++) items[i].transform(m, ${flags(a.apply)}, 100, ${origin(a.origin)});
__result__ = { sheared: items.length, angle: ${num(a.angle, { name: 'angle' })}, axisAngle: ${num(axisAngle, { name: 'axisAngle' })} };`));
        },
    },
    {
        name: 'apply_matrix',
        description: 'Transform items by an affine matrix [a, b, c, d, tx, ty] in artboard terms (x right, y down): x\' = a·x + c·y + tx, y\' = b·x + d·y + ty, applied around the reference point. tx and ty are points',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                matrix: { type: 'array', items: { type: 'number' }, minItems: 6, maxItems: 6, description: '[a, b, c, d, tx, ty]; [1, 0, 0, 1, 0, 0] leaves items unchanged' },
                origin: ORIGIN_SCHEMA,
                apply: APPLY_SCHEMA,
                scaleStrokes: { type: 'boolean', description: 'Scale stroke weights by the matrix\'s area change. Default: the Scale Strokes & Effects preference' },
            },
            required: ['target', 'matrix'],
        },
        features: [
            'illustrator.transformations.transform_matrix',
            'illustrator.transformations.transform_panel_option.transform_object_only',
            'illustrator.transformations.transform_panel_option.transform_pattern_only',
            'illustrator.transformations.transform_panel_option.transform_both',
        ],
        auditArgs: { matrix: [1, 0.2, 0, 1, 10, 5] },
        handler: (a) => {
            if (!Array.isArray(a.matrix) || a.matrix.length !== 6) throw new Error('matrix must be six numbers [a, b, c, d, tx, ty]');
            const [ma, mb, mc, md, tx, ty] = a.matrix.map((v, i) => Number(num(v, { min: -1e6, max: 1e6, name: `matrix[${i}]` })));
            const det = ma * md - mb * mc;
            if (Math.abs(det) < 1e-9) throw new Error('matrix is singular (a·d - b·c is 0): it would flatten the items');
            // Artboard y runs down, document y runs up: conjugate by a vertical flip.
            return run('Apply matrix', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${strokes(a.scaleStrokes)}
${matrix([ma, -mb, -mc, md], `__len(doc, ${num(tx, { name: 'tx' })})`, `-__len(doc, ${num(ty, { name: 'ty' })})`)}
for (var i = 0; i < items.length; i++) items[i].transform(m, ${flags(a.apply)}, lwOn ? ${num(Math.sqrt(Math.abs(det)) * 100, { name: 'stroke scale' })} : 100, ${origin(a.origin)});
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(doc, items[j]));
__result__ = out;`));
        },
    },
    {
        name: 'repeat_transform',
        description: 'Repeat the last transformation on the targets (Object > Transform > Transform Again), count times. It repeats what Illustrator recorded as the last move, scale, rotate, reflect, shear or Transform Each, usually one made by hand or in a Transform dialog; transformations made by other tools may not be recorded',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                count: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.transform_again'],
        menuCommands: ['transformagain'],
        handler: (a) => {
            const count = index(a.count ?? 1, { name: 'count', max: 100 });
            if (count === '0') throw new Error('count must be at least 1');
            return run('Repeat transform', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
for (var n = 0; n < ${count}; n++) app.executeMenuCommand("transformagain");
${SELECTION}
__result__ = { repeated: ${count}, selected: out };`));
        },
    },
    {
        name: 'resize_items',
        description: 'Set items\' width and height in points (Transform panel W and H) around a reference point. With constrainProportions and one dimension, the other follows. With relative, the values are added to the current size (e.g. width: 10 makes it 10 pt wider). For percentages use scale_items',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                width: { type: 'number', description: 'Points' },
                height: { type: 'number', description: 'Points' },
                relative: { type: 'boolean', description: 'Add width and height to the current size. Default false', default: false },
                constrainProportions: { type: 'boolean', description: 'Keep the width to height ratio when only one is given (Constrain Width and Height Proportions). Default true', default: true },
                origin: ORIGIN_SCHEMA,
                usePreviewBounds: { type: 'boolean', description: 'Measure including strokes and effects. Default: the Use Preview Bounds preference' },
                transformPatterns: { type: 'boolean', description: 'Scale pattern fills too. Default true', default: true },
                scaleStrokes: { type: 'boolean', description: 'Scale stroke weights. Default: the Scale Strokes & Effects preference' },
                scaleCorners: SCALE_CORNERS_SCHEMA,
            },
            required: ['target'],
        },
        features: [
            'illustrator.transformations.transform_panel',
            'illustrator.transformations.relative_absolute_scale',
            'illustrator.transformations.transform_panel_option.constrain_width_and_height_proportions',
            'illustrator.transformations.transform_panel_option.reference_point',
            'illustrator.transformations.transform_panel_option.scale_corners',
            'illustrator.transformations.constrain_mode',
        ],
        auditArgs: { width: 120, height: undefined, relative: false, scaleCorners: false },
        handler: (a) => {
            if (a.width === undefined && a.height === undefined) throw new Error('Give width, height, or both');
            const keep = (a.constrainProportions ?? true) && (a.width === undefined || a.height === undefined);
            const min = a.relative ? -1e6 : 0.001;
            const w = a.width !== undefined ? num(a.width, { min, max: 1e6, name: 'width' }) : null;
            const h = a.height !== undefined ? num(a.height, { min, max: 1e6, name: 'height' }) : null;
            const pat = bool(a.transformPatterns ?? true);
            return run('Resize items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
${strokes(a.scaleStrokes)}
var preview = ${a.usePreviewBounds === undefined ? 'app.preferences.getBooleanPreference("includeStrokeInBounds")' : bool(a.usePreviewBounds)};
${withCorners(a.scaleCorners, `
for (var i = 0; i < items.length; i++) {
  var it = items[i], g = preview ? it.visibleBounds : it.geometricBounds, f = __sf(doc);
  var cw = (g[2] - g[0]) * f, ch = (g[1] - g[3]) * f;
  if (cw <= 0 || ch <= 0) throw new Error("Item " + it.uuid + " has no width or height to resize");
  var sx = ${w === null ? 'null' : `(${a.relative ? `cw + ${w}` : w}) / cw * 100`};
  var sy = ${h === null ? 'null' : `(${a.relative ? `ch + ${h}` : h}) / ch * 100`};
  if (sx === null) sx = ${keep ? 'sy' : '100'};
  if (sy === null) sy = ${keep ? 'sx' : '100'};
  if (sx <= 0 || sy <= 0) throw new Error("The new size of " + it.uuid + " would be zero or negative");
  it.resize(sx, sy, true, ${pat}, true, ${pat}, lwOn ? Math.sqrt(sx * sy) : 100, ${origin(a.origin)});
  out.push(__itemInfo(doc, it));
}`)}
__result__ = out;`));
        },
    },
    {
        name: 'get_bounds',
        description: 'Report items\' geometric bounds (paths only), visible bounds (with strokes and effects) and control bounds (with handles), in points from an artboard\'s top-left corner',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                artboardIndex: { ...ARTBOARD_SCHEMA, description: 'Measure from this artboard (0-based). Default: the artboard each item is on' },
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.bounds', 'illustrator.transformations.transform_panel'],
        hints: { readOnly: true },
        handler: (a) => run('Get bounds', script(`${RECT}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length && i < 500; i++) {
  var it = items[i], g = it.geometricBounds;
  var abi = ${a.artboardIndex !== undefined ? index(a.artboardIndex, { name: 'artboardIndex' }) : '__artboardOf(doc, g)'};
  var ab = abi >= 0 ? __artboard(doc, abi) : { left: 0, top: 0 };
  out.push({ id: it.uuid, name: it.name, type: it.typename, artboardIndex: abi, geometric: __rect(doc, g, ab), visible: __rect(doc, it.visibleBounds, ab), control: __rect(doc, it.controlBounds, ab) });
}
__result__ = { count: items.length, items: out };`)),
    },
    {
        name: 'nudge_items',
        description: 'Move items as the arrow keys do: by the Keyboard Increment preference, times steps, times 10 with large (Shift + arrow)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                steps: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
                large: { type: 'boolean', description: 'Ten times the increment, like Shift + arrow. Default false', default: false },
            },
            required: ['target', 'direction'],
        },
        features: ['illustrator.transformations.move_arrow_keys'],
        handler: (a) => {
            const dir = enumOf(a.direction, ['up', 'down', 'left', 'right'], { name: 'direction' });
            const [ux, uy] = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[dir];
            return run('Nudge items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
var d = app.preferences.getRealPreference("cursorKeyLength") * ${index(a.steps ?? 1, { name: 'steps', max: 1000 })} * ${a.large ? 10 : 1};
for (var i = 0; i < items.length; i++) items[i].translate(${ux} * __len(doc, d), ${uy} * __len(doc, d));
__result__ = { moved: items.length, direction: ${str(dir)}, distance: d };`));
        },
    },
    {
        name: 'set_transform_options',
        description: 'Set Transform panel options: the reference point, Scale Corners, and whether the bounding box shows (View > Show / Hide Bounding Box). Returns the current options, including Scale Strokes & Effects, Transform Patterns and Use Preview Bounds (set those with set_preferences); call with no options just to read them',
        inputSchema: {
            type: 'object',
            properties: {
                referencePoint: { type: 'string', enum: Object.keys(ORIGINS), description: 'The Transform panel\'s reference point' },
                scaleCorners: { type: 'boolean', description: 'Scale live corner radii when scaling (Scale Corners)' },
                showBoundingBox: { type: 'boolean', description: 'Show the bounding box handles around selections' },
            },
        },
        features: [
            'illustrator.transformations.transform_panel_option.reference_point',
            'illustrator.transformations.transform_panel_option.scale_corners',
            'illustrator.transformations.bounding_box',
        ],
        menuCommands: ['AI Bounding Box Toggle'],
        hints: { idempotent: true },
        handler: (a) => {
            const names = Object.keys(ORIGINS);
            return run('Set transform options', script(`
var p = app.preferences, names = ${json(names)};
${a.referencePoint !== undefined ? `p.setIntegerPreference("plugin/Transform/AnchorPoint", ${names.indexOf(enumOf(a.referencePoint, names, { name: 'referencePoint' }))});` : ''}
${a.scaleCorners !== undefined ? `p.setIntegerPreference("policyForPreservingCorners", ${a.scaleCorners ? 1 : 2});` : ''}
${a.showBoundingBox !== undefined ? `if (p.getBooleanPreference("showBoundingBox") !== ${bool(a.showBoundingBox)}) app.executeMenuCommand("AI Bounding Box Toggle");` : ''}
var rp = p.getIntegerPreference("plugin/Transform/AnchorPoint");
__result__ = {
  referencePoint: rp >= 0 && rp < names.length ? names[rp] : rp,
  scaleCorners: p.getIntegerPreference("policyForPreservingCorners") === 1,
  showBoundingBox: p.getBooleanPreference("showBoundingBox"),
  scaleStrokesAndEffects: p.getBooleanPreference("scaleLineWeight"),
  transformPatterns: p.getBooleanPreference("transformPatterns"),
  usePreviewBounds: p.getBooleanPreference("includeStrokeInBounds")
};`, { needsDocument: false }));
        },
    },
    {
        name: 'reset_bounding_box',
        description: 'Square the bounding box of rotated items back to the page (Object > Transform > Reset Bounding Box). The artwork does not move',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.transformations.reset_bounding_box'],
        menuCommands: ['AI Reset Bounding Box'],
        hints: { idempotent: true },
        handler: (a) => run('Reset bounding box', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand("AI Reset Bounding Box");
${SELECTION}
__result__ = { reset: items.length, selected: out };`)),
    },
    {
        name: 'distribute_items',
        description: 'Distribute items evenly (Object > Distribute, Align panel): by left, horizontal centre or right edges, top, vertical centre or bottom edges, or equal horizontal or vertical space between them. The outermost items stay put. With spacing (hspace, vspace), items are set exactly that many points apart, starting from the key object (or the first item), which does not move',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                by: { type: 'string', enum: Object.keys(DISTRIBUTE) },
                spacing: { type: 'number', description: 'hspace or vspace: the exact gap in points (Distribute Spacing)' },
                keyObjectId: { type: 'string', description: 'With spacing: the id of the item that stays still (Key Object). Default the leftmost or topmost item' },
                usePreviewBounds: { type: 'boolean', description: 'Measure including strokes and effects (Use Preview Bounds). Default true', default: true },
            },
            required: ['target', 'by'],
        },
        features: [
            'illustrator.transformations.distribute_left',
            'illustrator.transformations.distribute_hcenter',
            'illustrator.transformations.distribute_right',
            'illustrator.transformations.distribute_top',
            'illustrator.transformations.distribute_vcenter',
            'illustrator.transformations.distribute_bottom',
            'illustrator.transformations.distribute_hspace',
            'illustrator.transformations.distribute_vspace',
            'illustrator.transformations.distribute_by_distance',
            'illustrator.transformations.align_option.key_object',
            'illustrator.transformations.align_option.use_preview_bounds',
        ],
        auditArgs: { by: 'hspace', spacing: 12 },
        handler: (a) => {
            const by = enumOf(a.by, Object.keys(DISTRIBUTE), { name: 'by' });
            const [axis, kind] = DISTRIBUTE[by];
            if (a.spacing !== undefined && kind !== 'space') throw new Error('spacing applies to hspace and vspace only');
            if (a.keyObjectId !== undefined && a.spacing === undefined) throw new Error('keyObjectId needs spacing: the key object is the item the others are spaced from');
            const gap = a.spacing !== undefined ? num(a.spacing, { min: -1e5, max: 1e5, name: 'spacing' }) : null;
            // Work in one dimension, increasing right (x) or down (y); move() maps back to document units.
            return run('Distribute items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < 2) throw new Error("Distributing needs at least two items");
var preview = ${bool(a.usePreviewBounds ?? true)};
var span = function (it) { var b = preview ? it.visibleBounds : it.geometricBounds; return ${axis === 'x' ? '{ lo: b[0], hi: b[2] }' : '{ lo: -b[1], hi: -b[3] }'}; };
var move = function (it, d) { it.translate(${axis === 'x' ? 'd, 0' : '0, -d'}); };
var list = [];
for (var i = 0; i < items.length; i++) { var s = span(items[i]); list.push({ it: items[i], lo: s.lo, hi: s.hi, mid: (s.lo + s.hi) / 2 }); }
list.sort(function (p, q) { return p.${kind === 'space' ? 'lo' : kind} - q.${kind === 'space' ? 'lo' : kind}; });
var n = list.length, k;
${kind !== 'space' ? `
var step = (list[n - 1].${kind} - list[0].${kind}) / (n - 1);
for (k = 1; k < n - 1; k++) move(list[k].it, list[0].${kind} + k * step - list[k].${kind});` : gap === null ? `
var total = 0;
for (k = 0; k < n; k++) total += list[k].hi - list[k].lo;
var gap = (list[n - 1].hi - list[0].lo - total) / (n - 1), at = list[0].hi;
for (k = 1; k < n - 1; k++) { move(list[k].it, at + gap - list[k].lo); at += gap + list[k].hi - list[k].lo; }` : `
var gap = __len(doc, ${gap}), key = 0;
${a.keyObjectId !== undefined ? `
key = -1;
for (k = 0; k < n; k++) if (list[k].it.uuid === ${str(a.keyObjectId)}) key = k;
if (key < 0) throw new Error("The key object must be one of the targets");` : ''}
var edge = list[key].hi;
for (k = key + 1; k < n; k++) { move(list[k].it, edge + gap - list[k].lo); edge += gap + list[k].hi - list[k].lo; }
edge = list[key].lo;
for (k = key - 1; k >= 0; k--) { move(list[k].it, edge - gap - list[k].hi); edge -= gap + list[k].hi - list[k].lo; }`}
__result__ = { distributed: n, by: ${str(by)}${gap === null ? '' : `, spacing: ${gap}`} };`));
        },
    },
    {
        name: 'make_envelope',
        description: 'Distort items into the shape of a top object (Object > Envelope Distort > Make with Top Object). Give the contents as target and the shape as shapeId; the shape is brought to the front of the first item\'s layer or group, so keep them together. Without shapeId, the frontmost target is the shape. Make with Warp and Make with Mesh open dialogs and are not offered',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                shapeId: { type: 'string', description: 'Id of the path to use as the envelope' },
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.envelope_top_object', 'illustrator.transformations.envelope_object'],
        menuCommands: ['Make Envelope'],
        handler: (a) => run('Make envelope', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${a.shapeId !== undefined ? `
var shape = doc.getPageItemFromUuid(${str(a.shapeId)});
if (!shape) throw new Error("Shape " + ${str(a.shapeId)} + " not found");
shape.move(items[0].parent, ElementPlacement.PLACEATBEGINNING);
items.push(shape);` : 'if (items.length < 2) throw new Error("Give the contents and a shape: shapeId, or at least two targets");'}
${SELECT}
app.executeMenuCommand("Make Envelope");
${SELECTION}
if (!out.length) throw new Error("Illustrator made no envelope from these items");
__result__ = { envelope: out };`)),
    },
    {
        name: 'edit_envelope',
        description: 'Work with envelopes (Object > Envelope Distort): release (separate the contents from the envelope shape), expand (apply the distortion as plain artwork), or edit_contents (switch between editing the contents and the envelope; run again to switch back)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(ENVELOPE) },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.transformations.envelope_release',
            'illustrator.transformations.envelope_expand',
            'illustrator.transformations.envelope_edit_contents',
            'illustrator.transformations.envelope_object',
        ],
        menuCommands: Object.values(ENVELOPE),
        hints: { destructive: true },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(ENVELOPE), { name: 'operation' });
            return run('Edit envelope', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand(${str(ENVELOPE[op])});
${SELECTION}
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
    {
        name: 'expand_objects_on_path',
        description: 'Turn objects attached to a path into independent objects in place (Object > Objects on Path > Expand; Illustrator 2025 or later). Attaching and the Objects on Path options open a dialog or need clicks, so they are not offered',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.transformations.objects_on_path_expand'],
        menuCommands: ['Expand Objects on Path'],
        hints: { destructive: true },
        handler: (a) => run('Expand objects on path', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand("Expand Objects on Path");
${SELECTION}
__result__ = { selected: out };`)),
    },
    {
        name: 'distort_items',
        description: 'Distort items by moving the corners of their bounding box, as the Free Transform tool\'s Free Distort and Perspective Distort do. free: give corners as [x, y] fractions of the box (0,0 top-left, 1,1 bottom-right). perspective: one edge narrows (positive amount) or widens (negative) symmetrically. Applied as the Free Distort effect; expand (default) makes it plain artwork',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                mode: { type: 'string', enum: ['free', 'perspective'] },
                corners: {
                    type: 'object',
                    description: 'free: new corner positions; corners left out stay put. E.g. { topRight: [1.2, -0.1] }',
                    properties: Object.fromEntries(CORNERS.map((k) => [k, POINT_SCHEMA])),
                },
                edge: { type: 'string', enum: ['top', 'bottom', 'left', 'right'], description: 'perspective: the edge whose corners move' },
                amount: { type: 'number', minimum: -100, maximum: 49, description: 'perspective: percent of the width (or height) each corner moves inward; negative moves outward' },
                expand: { type: 'boolean', description: 'Expand the effect into plain artwork. Default true', default: true },
            },
            required: ['target', 'mode'],
        },
        features: [
            'illustrator.transformations.free_distort_mode',
            'illustrator.transformations.perspective_distort_mode',
        ],
        menuCommands: ['expandStyle'],
        hints: { destructive: true },
        auditArgs: { mode: 'perspective', edge: 'top', amount: 20, corners: undefined },
        handler: (a) => {
            const xml = freeDistortXml(distortCorners(a));
            const expand = a.expand ?? true;
            return run('Distort items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var target = items[i];
  target.applyEffect(${str(xml)});
  ${expand ? `
  doc.selection = null;
  target.selected = true;
  app.executeMenuCommand("expandStyle");
  var sel = doc.selection;
  if (!sel || !sel.length) throw new Error("Expanding produced no artwork");
  for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));` : 'out.push(__itemInfo(doc, target));'}
}
__result__ = { mode: ${str(a.mode)}, expanded: ${bool(expand)}, items: out };`));
        },
    },
];
