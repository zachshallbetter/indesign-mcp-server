/**
 * Transformations: rotate and flip in fixed steps, clear transformations,
 * scale, shear, rotate and move by exact amounts, Transform Again, nudging,
 * align and distribute, and the transform preferences.
 */
import { enumOf, num, index, bool, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

/** Object > Transform commands, as object-model calls on `it`. */
export const TURNS = {
    rotate_90_cw: 'it.rotationAngle = it.rotationAngle - 90;',
    rotate_90_ccw: 'it.rotationAngle = it.rotationAngle + 90;',
    rotate_180: 'it.rotationAngle = it.rotationAngle + 180;',
    flip_horizontal: 'it.flipItem(Flip.HORIZONTAL);',
    flip_vertical: 'it.flipItem(Flip.VERTICAL);',
    clear_transformations: 'it.clearTransformations();',
};

export const tools = [
    {
        name: 'turn_items',
        description: 'Rotate items 90° clockwise, 90° counter-clockwise or 180°, flip them horizontally or vertically, or clear their transformations (Object > Transform)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(TURNS), description: 'What to do to each item' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'indesign.transformations.rotate_90_cw',
            'indesign.transformations.rotate_90_ccw',
            'indesign.transformations.rotate_180',
            'indesign.transformations.flip_horizontal',
            'indesign.transformations.flip_vertical',
            'indesign.transformations.clear_transformations',
        ],
        hints: { readOnly: false },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(TURNS), { name: 'operation' });
            return run('Turn items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${TURNS[op]}
  out.push(__itemInfo(it));
}
__result__ = { operation: "${op}", items: out };`));
        },
    },
];

// ---------------------------------------------------------------------------
// Exact transformations, Transform Again, nudging, align and distribute, and
// transform preferences.
//
// Transformations are applied in pasteboard coordinates, along the page's
// horizontal and vertical axes, around a reference point. Distances are
// millimetres; angles are degrees, positive counter-clockwise as in InDesign.
// ---------------------------------------------------------------------------

/** Atlas feature ids of this area. */
const tx = (ids) => ids.map((f) => `indesign.transformations.${f}`);

const has = (v) => v !== undefined && v !== null;

/** Refuse option keys a schema does not define. */
function known(o, keys, name) {
    for (const k of Object.keys(o)) {
        if (!keys.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${keys.join(', ')}`);
    }
}

/** A boolean argument, refusing anything else. */
function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

/** Millimetres to points, for transform members measured in points. */
const pt = (mm) => Math.round(mm * (72 / 25.4) * 10000) / 10000;

/** The nine reference points of the proxy, as fractions of the bounding box (x, y). */
export const REFERENCE_POINTS = {
    top_left: [0, 0], top: [0.5, 0], top_right: [1, 0],
    left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
    bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1],
};

/** The same reference points as AnchorPoint members. */
const ANCHOR_POINT = {
    top_left: 'TOP_LEFT_ANCHOR', top: 'TOP_CENTER_ANCHOR', top_right: 'TOP_RIGHT_ANCHOR',
    left: 'LEFT_CENTER_ANCHOR', center: 'CENTER_ANCHOR', right: 'RIGHT_CENTER_ANCHOR',
    bottom_left: 'BOTTOM_LEFT_ANCHOR', bottom: 'BOTTOM_CENTER_ANCHOR', bottom_right: 'BOTTOM_RIGHT_ANCHOR',
};

const REFERENCE_SCHEMA = {
    type: 'string', enum: Object.keys(REFERENCE_POINTS),
    description: 'Reference point on the bounding box that stays fixed (the reference point proxy); default center',
};

const REFERENCE_AT_SCHEMA = {
    type: 'object',
    description: 'A fixed reference point on a page instead of a point of the bounding box (as when clicking with the Rotate, Scale or Shear tool): { pageIndex, x, y }, all required',
    properties: {
        pageIndex: { type: 'integer', minimum: 0, description: 'Page the point is measured on (0-based)' },
        x: { type: 'number', description: 'mm from the left edge of the page' },
        y: { type: 'number', description: 'mm from the top edge of the page' },
    },
};

/**
 * A reference point as a JSX literal for __tfOrigin(): fractions of the
 * bounding box, or a page point in points (page -1 when not used).
 */
export function referenceSpec(point, at) {
    if (has(point) && has(at)) throw new Error("Give referencePoint or referenceAt, not both");
    if (has(at)) {
        if (typeof at !== 'object' || Array.isArray(at)) throw new Error("'referenceAt' must be { pageIndex, x, y }");
        known(at, ['pageIndex', 'x', 'y'], 'referenceAt');
        const page = Number(index(at.pageIndex, { name: 'referenceAt.pageIndex' }));
        const x = Number(num(at.x, { name: 'referenceAt.x', min: -10000, max: 10000 }));
        const y = Number(num(at.y, { name: 'referenceAt.y', min: -10000, max: 10000 }));
        return json({ fx: 0, fy: 0, page, x: pt(x), y: pt(y) });
    }
    const [fx, fy] = REFERENCE_POINTS[enumOf(point ?? 'center', Object.keys(REFERENCE_POINTS), { name: 'referencePoint' })];
    return json({ fx, fy, page: -1, x: 0, y: 0 });
}

/**
 * ES3 helpers: the bounding box of items in pasteboard coordinates (points,
 * stroke included when the Transform panel's Dimensions Include Stroke Weight
 * is on), the reference point for a set of items, and applying a matrix to
 * the items as one selection or each around its own reference point.
 */
const TF_HELPERS = String.raw`
var __tfBox = function (items) {
  var cs = CoordinateSpaces.PASTEBOARD_COORDINATES, b = null;
  var bk = app.transformPreferences.dimensionsIncludeStrokeWeight ? BoundingBoxLimits.OUTER_STROKE_BOUNDS : BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS;
  for (var i = 0; i < items.length; i++) {
    var tl = items[i].resolve([AnchorPoint.TOP_LEFT_ANCHOR, bk, cs], cs)[0];
    var br = items[i].resolve([AnchorPoint.BOTTOM_RIGHT_ANCHOR, bk, cs], cs)[0];
    if (!b) { b = [tl[0], tl[1], br[0], br[1]]; continue; }
    b[0] = Math.min(b[0], tl[0]); b[1] = Math.min(b[1], tl[1]);
    b[2] = Math.max(b[2], br[0]); b[3] = Math.max(b[3], br[1]);
  }
  return b;
};
var __tfOrigin = function (doc, items, ref) {
  if (ref.page >= 0) {
    var o = __page(doc, ref.page).resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.PASTEBOARD_COORDINATES)[0];
    return [o[0] + ref.x, o[1] + ref.y];
  }
  var b = __tfBox(items);
  return [b[0] + ref.fx * (b[2] - b[0]), b[1] + ref.fy * (b[3] - b[1])];
};
var __tfApply = function (doc, items, ref, each, m) {
  var cs = CoordinateSpaces.PASTEBOARD_COORDINATES, i, o;
  if (!each) o = __tfOrigin(doc, items, ref);
  for (i = 0; i < items.length; i++) {
    items[i].transform(cs, [each ? __tfOrigin(doc, [items[i]], ref) : o, cs], m);
  }
};
`;

/** ES3 helper refusing locked items. */
const UNLOCKED = String.raw`
var __tfUnlocked = function (items) {
  for (var i = 0; i < items.length; i++) if (items[i].locked) throw new Error("Item " + items[i].id + " is locked");
  return items;
};
`;

/** A script with the lock check, and the transform helpers when the body applies matrices. */
const tf = (code) => script(UNLOCKED + (code.includes('__tfApply(') ? TF_HELPERS : '') + code);

/**
 * Validate transform_items arguments and build the statements applied to the
 * item list `items`, in the order scale, shear, rotate, matrix, move.
 */
export function transformStatements(a) {
    const lines = [];
    const done = [];
    const ref = referenceSpec(a.referencePoint, a.referenceAt);
    const each = a.each === undefined ? 'false' : flag(a.each, 'each');
    const apply = (matrix) => lines.push(`__tfApply(doc, items, ${ref}, ${each}, app.transformationMatrices.add(${matrix}));`);
    const pct = (v, name) => {
        const n = Number(num(v, { name, min: -100000, max: 100000 }));
        if (Math.abs(n) < 0.01) throw new Error(`'${name}' must not be 0`);
        return n / 100;
    };

    if (has(a.scale) && (has(a.scaleX) || has(a.scaleY))) throw new Error('Give scale (proportional) or scaleX/scaleY, not both');
    if (has(a.scale) || has(a.scaleX) || has(a.scaleY)) {
        const sx = has(a.scale) ? pct(a.scale, 'scale') : has(a.scaleX) ? pct(a.scaleX, 'scaleX') : 1;
        const sy = has(a.scale) ? sx : has(a.scaleY) ? pct(a.scaleY, 'scaleY') : 1;
        apply(json({ horizontalScaleFactor: sx, verticalScaleFactor: sy }));
        done.push('scale');
    }
    if (has(a.shearAxis) && !has(a.shearAngle)) throw new Error("'shearAxis' needs shearAngle");
    if (has(a.shearAngle)) {
        const angle = Number(num(a.shearAngle, { name: 'shearAngle', min: -89, max: 89 }));
        const axis = enumOf(a.shearAxis ?? 'horizontal', ['horizontal', 'vertical'], { name: 'shearAxis' });
        if (axis === 'horizontal') apply(json({ clockwiseShearAngle: angle }));
        else {
            // A shear along the vertical axis: the horizontal shear turned a quarter turn.
            lines.push('var __q = app.transformationMatrices.add({ counterclockwiseRotationAngle: 90 });');
            lines.push(`var __sv = __q.invertMatrix().catenateMatrix(app.transformationMatrices.add(${json({ clockwiseShearAngle: angle })})).catenateMatrix(__q);`);
            lines.push(`__tfApply(doc, items, ${ref}, ${each}, __sv);`);
        }
        done.push('shear');
    }
    if (has(a.rotate)) {
        apply(json({ counterclockwiseRotationAngle: Number(num(a.rotate, { name: 'rotate', min: -360, max: 360 })) }));
        done.push('rotate');
    }
    if (has(a.matrix)) {
        if (!Array.isArray(a.matrix) || a.matrix.length !== 6) throw new Error("'matrix' must be [a, b, c, d, tx, ty]");
        const m = a.matrix.map((v, i) => Number(num(v, { name: `matrix[${i}]`, min: i < 4 ? -1000 : -10000, max: i < 4 ? 1000 : 10000 })));
        apply(json({ matrixValues: [m[0], m[1], m[2], m[3], pt(m[4]), pt(m[5])] }));
        done.push('matrix');
    }
    if (has(a.moveContent) && !has(a.move)) throw new Error("'moveContent' needs move");
    if (has(a.move)) {
        const mv = a.move;
        if (typeof mv !== 'object' || Array.isArray(mv)) throw new Error("'move' must be { x, y } or { distance, angle }");
        known(mv, ['x', 'y', 'distance', 'angle'], 'move');
        const byXY = has(mv.x) || has(mv.y);
        const byPolar = has(mv.distance) || has(mv.angle);
        if (byXY === byPolar) throw new Error("'move': give x and/or y, or distance and angle");
        let dx;
        let dy;
        if (byXY) {
            dx = Number(num(mv.x ?? 0, { name: 'move.x', min: -10000, max: 10000 }));
            dy = Number(num(mv.y ?? 0, { name: 'move.y', min: -10000, max: 10000 }));
        } else {
            if (!has(mv.distance) || !has(mv.angle)) throw new Error("'move' needs both distance and angle");
            const d = Number(num(mv.distance, { name: 'move.distance', min: -10000, max: 10000 }));
            const r = (Number(num(mv.angle, { name: 'move.angle', min: -360, max: 360 })) * Math.PI) / 180;
            dx = Math.round(d * Math.cos(r) * 10000) / 10000;
            dy = Math.round(-d * Math.sin(r) * 10000) / 10000;
        }
        const content = has(a.moveContent) && flag(a.moveContent, 'moveContent') === 'true';
        lines.push('for (var mi = 0; mi < items.length; mi++) {');
        if (content) {
            lines.push('  var mc = items[mi].graphics.length ? items[mi].graphics[0] : (items[mi].pageItems.length ? items[mi].pageItems[0] : null);');
            lines.push('  if (!mc) throw new Error("Item " + items[mi].id + " has no content to move");');
            lines.push(`  mc.move(undefined, [${dx}, ${dy}]);`);
        } else {
            lines.push(`  items[mi].move(undefined, [${dx}, ${dy}]);`);
        }
        lines.push('}');
        done.push(content ? 'move_content' : 'move');
    }
    if (has(a.redefineScaling)) {
        if (flag(a.redefineScaling, 'redefineScaling') === 'true') {
            lines.push('for (var ri = 0; ri < items.length; ri++) items[ri].redefineScaling([1, 1]);');
            done.push('redefine_scaling');
        }
    }
    if (!done.length) throw new Error('Nothing to do: give scale, scaleX/scaleY, shearAngle, rotate, matrix, move or redefineScaling: true');
    return { lines, done };
}

const NUDGE = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const NUDGE_STEP = { normal: 1, fine: 0.1, coarse: 10 };

/** Transform Again commands (Object > Transform Again), as PageItem methods. */
export const AGAIN = {
    again: 'transformAgain',
    again_individually: 'transformAgainIndividually',
    sequence_again: 'transformSequenceAgain',
    sequence_again_individually: 'transformSequenceAgainIndividually',
};

const ALIGN = {
    left: 'LEFT_EDGES', horizontal_centers: 'HORIZONTAL_CENTERS', right: 'RIGHT_EDGES',
    top: 'TOP_EDGES', vertical_centers: 'VERTICAL_CENTERS', bottom: 'BOTTOM_EDGES',
};
const DISTRIBUTE = {
    left: 'LEFT_EDGES', horizontal_centers: 'HORIZONTAL_CENTERS', right: 'RIGHT_EDGES',
    top: 'TOP_EDGES', vertical_centers: 'VERTICAL_CENTERS', bottom: 'BOTTOM_EDGES',
    horizontal_space: 'HORIZONTAL_SPACE', vertical_space: 'VERTICAL_SPACE',
};
const ALIGN_TO = {
    selection: 'ITEM_BOUNDS', key_object: 'KEY_OBJECT', margins: 'MARGIN_BOUNDS', page: 'PAGE_BOUNDS', spread: 'SPREAD_BOUNDS',
};

/** Transform panel and preferences settings (app.transformPreferences). */
const TRANSFORM_PREFS = {
    transformationsAreTotals: 'Transformations are Totals (Transform panel menu): rotation and shear are shown relative to the pasteboard, including those of the frame, rather than nested values',
    dimensionsIncludeStrokeWeight: 'Dimensions Include Stroke Weight (Transform panel menu)',
    showContentOffset: 'Show Content Offset (Transform panel menu)',
    adjustStrokeWeightWhenScaling: 'Adjust Stroke Weight when Scaling (Preferences > General > When Scaling)',
    adjustEffectsWhenScaling: 'Adjust Effects when Scaling (Preferences > General > When Scaling)',
};
const WHEN_SCALING = { apply_to_content: 'APPLY_TO_CONTENT', adjust_scaling_percentage: 'ADJUST_SCALING_PERCENTAGE' };

/** JSX expression: the active layout window's reference point, as a name or [x, y]. */
const READ_REFERENCE = String.raw`
var __refName = null;
try {
  var __w = app.activeWindow, __rp = __w.transformReferencePoint;
  __refName = (__rp instanceof Array) ? __rp : __enumName(__rp);
} catch (e) {}
`;

const transformPrefsResult = `{ ${Object.keys(TRANSFORM_PREFS).map((k) => `${k}: tp.${k}`).join(', ')}, whenScaling: __enumName(tp.whenScaling), referencePoint: __refName }`;

tools.push(
    {
        name: 'transform_items',
        description: 'Scale, shear, rotate, move or transform items by exact amounts around a reference point, optionally on a copy (Object > Transform > Scale, Rotate, Shear and Move dialogs; Rotate, Scale, Shear and Free Transform tools; Transform panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scale: { type: 'number', description: 'Scale proportionally (%), frame and content together' },
                scaleX: { type: 'number', description: 'Horizontal scale (%), frame and content together (Scale X)' },
                scaleY: { type: 'number', description: 'Vertical scale (%), frame and content together (Scale Y)' },
                shearAngle: { type: 'number', minimum: -89, maximum: 89, description: 'Shear angle (degrees), as in the Shear dialog' },
                shearAxis: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Axis to shear along (default horizontal)' },
                rotate: { type: 'number', minimum: -360, maximum: 360, description: 'Rotation angle (degrees, positive counter-clockwise)' },
                matrix: {
                    type: 'array', items: { type: 'number' }, minItems: 6, maxItems: 6,
                    description: 'A transformation matrix [a, b, c, d, tx, ty] applied in pasteboard coordinates; tx and ty in mm',
                },
                move: {
                    type: 'object',
                    description: 'Move by an offset: { x, y } in mm (Horizontal / Vertical) or { distance, angle } (mm, degrees counter-clockwise from the right)',
                    properties: {
                        x: { type: 'number', description: 'Horizontal offset (mm, positive to the right)' },
                        y: { type: 'number', description: 'Vertical offset (mm, positive downward)' },
                        distance: { type: 'number', description: 'Distance to move (mm)' },
                        angle: { type: 'number', description: 'Direction (degrees, 0 = right, 90 = up)' },
                    },
                },
                moveContent: { type: 'boolean', description: 'Move only each frame\'s content, not the frame (Move dialog > Move Content)' },
                referencePoint: REFERENCE_SCHEMA,
                referenceAt: REFERENCE_AT_SCHEMA,
                each: { type: 'boolean', description: 'Transform each item around its own reference point instead of the items together as one selection (default false)' },
                copy: { type: 'boolean', description: 'Transform copies and leave the originals in place (the dialogs\' Copy button)' },
                redefineScaling: { type: 'boolean', description: 'Afterwards, apply the items\' scaling to them and show it as 100% (Transform panel menu > Redefine Scaling as 100%)' },
            },
            required: ['target'],
        },
        features: tx([
            'rotate_tool', 'scale_tool', 'shear_tool', 'free_transform_tool', 'transform_dialog_tool',
            'scale_cmd', 'rotate_cmd', 'shear_cmd', 'transform_matrix', 'transform_multiple', 'resize_frame_and_content',
            'reference_point', 'redefine_scaling',
            'move_dlg_horizontal_vertical_move', 'move_dlg_distance_angle_move', 'move_dlg_move_content', 'move_dlg_copy_move_dialog',
            'transform_dlg_scale_x_scale_y', 'transform_dlg_angle_rotate', 'transform_dlg_shear_angle', 'transform_dlg_axis_shear',
            'transform_dlg_copy_transform_dialogs',
        ]),
        hints: { readOnly: false, idempotent: false },
        auditArgs: { target: { ids: [1] }, scale: undefined, scaleX: 120, scaleY: undefined, referenceAt: undefined, shearAngle: 10, shearAxis: 'vertical', rotate: 30, matrix: [1, 0, 0, 1, 5, 5], move: { distance: 10, angle: 45 }, moveContent: true, copy: true, redefineScaling: true },
        handler: (a) => {
            const target = targetSpec(a.target);
            const copy = has(a.copy) && flag(a.copy, 'copy') === 'true';
            const { lines, done } = transformStatements(a);
            return run('Transform items', tf(`
var items = __tfUnlocked(__targets(doc, ${target}));
${copy ? 'var __src = items; items = [];\nfor (var ci = 0; ci < __src.length; ci++) items.push(__src[ci].duplicate());' : ''}
${lines.join('\n')}
var out = [];
for (var i = 0; i < items.length; i++) out.push(__itemInfo(items[i]));
__result__ = { applied: ${json(done)}, copies: ${bool(copy)}, items: out };`));
        },
    },
    {
        name: 'nudge_items',
        description: 'Nudge items by the keyboard increment, or step their scale or size by 1% or 5%, as the arrow keys and scale shortcuts do (Preferences > Units & Increments > Cursor Key; Object Editing shortcuts)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                action: {
                    type: 'string',
                    enum: ['nudge_up', 'nudge_down', 'nudge_left', 'nudge_right', 'scale_up', 'scale_down', 'size_up', 'size_down'],
                    description: 'Nudge in a direction; scale frame and content up or down; or resize the frame up or down',
                },
                step: { type: 'string', enum: ['normal', 'fine', 'coarse'], description: 'Nudge: the cursor key increment, a tenth of it, or ten times it. Scale and size: normal 1%, coarse 5%. Default normal' },
                times: { type: 'integer', minimum: 1, maximum: 100, description: 'How many times to repeat (default 1)' },
                referencePoint: REFERENCE_SCHEMA,
            },
            required: ['target', 'action'],
        },
        features: tx(['nudge', 'scale_keyboard_actions']),
        hints: { readOnly: false, idempotent: false },
        auditArgs: { action: 'size_up', step: 'coarse', times: 2 },
        handler: (a) => {
            const target = targetSpec(a.target);
            const action = enumOf(a.action, ['nudge_up', 'nudge_down', 'nudge_left', 'nudge_right', 'scale_up', 'scale_down', 'size_up', 'size_down'], { name: 'action' });
            const step = enumOf(a.step ?? 'normal', Object.keys(NUDGE_STEP), { name: 'step' });
            const times = Number(index(a.times ?? 1, { name: 'times', max: 100 }));
            if (times < 1) throw new Error("'times' must be at least 1");
            const [verb, dir] = action.split('_');
            let body;
            if (verb === 'nudge') {
                if (has(a.referencePoint)) throw new Error("'referencePoint' applies to scale and size steps, not nudging");
                const [ux, uy] = NUDGE[dir];
                const f = NUDGE_STEP[step] * times;
                body = `
var inc = Number(doc.viewPreferences.cursorKeyIncrement) * ${f};
for (var i = 0; i < items.length; i++) items[i].move(undefined, [${ux} * inc, ${uy} * inc]);`;
            } else {
                if (step === 'fine') throw new Error("'step: fine' applies only to nudging; scale and size steps are normal (1%) or coarse (5%)");
                const pctStep = step === 'coarse' ? 0.05 : 0.01;
                const f = Math.pow(dir === 'up' ? 1 + pctStep : 1 - pctStep, times);
                const factor = Math.round(f * 1e8) / 1e8;
                if (verb === 'scale') {
                    body = `__tfApply(doc, items, ${referenceSpec(a.referencePoint)}, true, app.transformationMatrices.add(${json({ horizontalScaleFactor: factor, verticalScaleFactor: factor })}));`;
                } else {
                    const anchor = ANCHOR_POINT[enumOf(a.referencePoint ?? 'center', Object.keys(ANCHOR_POINT), { name: 'referencePoint' })];
                    body = `
for (var i = 0; i < items.length; i++) {
  items[i].resize([CoordinateSpaces.INNER_COORDINATES, BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS], AnchorPoint.${anchor}, ResizeMethods.MULTIPLYING_CURRENT_DIMENSIONS_BY, [${factor}, ${factor}]);
}`;
                }
            }
            return run('Nudge items', tf(`
var items = __tfUnlocked(__targets(doc, ${target}));
${body}
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(items[j]));
__result__ = { action: "${action}", step: "${step}", times: ${times}, items: out };`));
        },
    },
    {
        name: 'transform_again',
        description: 'Repeat the last transformation or sequence of transformations on items, together or each individually (Object > Transform Again)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                mode: { type: 'string', enum: Object.keys(AGAIN), description: 'Transform Again, Transform Again Individually, Transform Sequence Again or Transform Sequence Again Individually' },
                times: { type: 'integer', minimum: 1, maximum: 100, description: 'How many times to repeat (default 1)' },
            },
            required: ['target', 'mode'],
        },
        features: tx(['transform_again', 'transform_again_individually', 'transform_sequence_again', 'transform_sequence_again_individually', 'transform_multiple']),
        hints: { readOnly: false, idempotent: false },
        handler: (a) => {
            const target = targetSpec(a.target);
            const mode = enumOf(a.mode, Object.keys(AGAIN), { name: 'mode' });
            const times = Number(index(a.times ?? 1, { name: 'times', max: 100 }));
            if (times < 1) throw new Error("'times' must be at least 1");
            return run('Transform again', tf(`
var items = __tfUnlocked(__targets(doc, ${target}));
for (var n = 0; n < ${times}; n++) {
  for (var i = 0; i < items.length; i++) items[i].${AGAIN[mode]}();
}
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(items[j]));
__result__ = { mode: "${mode}", times: ${times}, items: out };`));
        },
    },
    {
        name: 'align_items',
        description: 'Align or distribute items relative to each other, a key object, the margins, the page or the spread, optionally with a fixed spacing (Align panel; Align and Distribute shortcuts)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                align: { type: 'string', enum: Object.keys(ALIGN), description: 'Align Objects: which edges or centres to line up' },
                distribute: { type: 'string', enum: Object.keys(DISTRIBUTE), description: 'Distribute Objects by edges or centres, or Distribute Spacing (horizontal_space, vertical_space)' },
                alignTo: { type: 'string', enum: Object.keys(ALIGN_TO), description: 'Align To: the items themselves (default), a key object, the margins, the page or the spread' },
                keyObject: { type: 'integer', minimum: 0, description: 'Id of the key object, for alignTo key_object; defaults to the selection\'s key object when the target is the selection. With a selection target it also becomes the selection\'s key object' },
                spacing: { type: 'number', description: 'Use Spacing: a fixed distance between the items (mm) when distributing' },
            },
            required: ['target'],
        },
        features: tx(['align_panel', 'align_objects', 'distribute_objects', 'distribute_spacing', 'key_object', 'align_keyboard_actions']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { target: { selection: true }, align: 'left', distribute: 'horizontal_space', alignTo: 'key_object', keyObject: 3, spacing: 5 },
        handler: (a) => {
            const target = targetSpec(a.target);
            if (!has(a.align) && !has(a.distribute)) throw new Error('Give align, distribute or both');
            const align = has(a.align) ? ALIGN[enumOf(a.align, Object.keys(ALIGN), { name: 'align' })] : null;
            const distribute = has(a.distribute) ? DISTRIBUTE[enumOf(a.distribute, Object.keys(DISTRIBUTE), { name: 'distribute' })] : null;
            const to = enumOf(a.alignTo ?? (has(a.keyObject) ? 'key_object' : 'selection'), Object.keys(ALIGN_TO), { name: 'alignTo' });
            if (has(a.keyObject) && to !== 'key_object') throw new Error("'keyObject' needs alignTo: key_object");
            if (has(a.spacing) && !distribute) throw new Error("'spacing' applies when distributing");
            const spacing = has(a.spacing) ? num(a.spacing, { name: 'spacing', min: -5000, max: 5000 }) : null;
            const key = has(a.keyObject) ? index(a.keyObject, { name: 'keyObject', max: 1e9 }) : null;
            const lines = [];
            if (to === 'key_object') {
                if (key !== null) {
                    lines.push(`var key = __item(doc, ${key});`);
                    if (a.target?.selection) lines.push('try { doc.selectionKeyObject = key; } catch (e) {}');
                } else {
                    lines.push('var key = doc.selectionKeyObject;');
                    lines.push('if (!key || key == NothingEnum.NOTHING) throw new Error("No key object: pass keyObject, or set one in the selection");');
                }
            } else {
                lines.push('if (bounds == AlignDistributeBounds.ITEM_BOUNDS && items.length < 2) throw new Error("Aligning or distributing items to each other needs at least two items");');
            }
            const ref = to === 'key_object' ? ', key' : '';
            if (align) lines.push(`doc.align(items, AlignOptions.${align}, bounds${ref});`);
            if (distribute) {
                lines.push(spacing !== null
                    ? `doc.distribute(items, DistributeOptions.${distribute}, bounds, true, "${spacing}mm"${ref});`
                    : `doc.distribute(items, DistributeOptions.${distribute}, bounds, false, 0${ref});`);
            }
            return run('Align items', script(`
var items = __targets(doc, ${target});
var bounds = AlignDistributeBounds.${ALIGN_TO[to]};
${lines.join('\n')}
var out = [];
for (var i = 0; i < items.length; i++) out.push(__itemInfo(items[i]));
__result__ = { align: ${json(a.align ?? null)}, distribute: ${json(a.distribute ?? null)}, alignTo: "${to}", items: out };`));
        },
    },
    {
        name: 'set_transform_preferences',
        description: 'Set how transformations behave and are shown: Transformations are Totals, Dimensions Include Stroke Weight, Show Content Offset, When Scaling options and the reference point (Transform panel menu; Preferences > General)',
        inputSchema: {
            type: 'object',
            properties: {
                ...Object.fromEntries(Object.entries(TRANSFORM_PREFS).map(([k, d]) => [k, { type: 'boolean', description: d }])),
                whenScaling: { type: 'string', enum: Object.keys(WHEN_SCALING), description: 'When Scaling: apply to content, or adjust the scaling percentage' },
                referencePoint: { type: 'string', enum: Object.keys(ANCHOR_POINT), description: 'The reference point of the active layout window (reference point proxy)' },
            },
        },
        features: tx([
            'transformations_are_totals', 'dimensions_include_stroke', 'show_content_offset',
            'adjust_stroke_when_scaling', 'adjust_effects_when_scaling', 'when_scaling', 'reference_point',
        ]),
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const lines = [];
            for (const k of Object.keys(TRANSFORM_PREFS)) if (has(a[k])) lines.push(`tp.${k} = ${flag(a[k], k)};`);
            if (has(a.whenScaling)) lines.push(`tp.whenScaling = WhenScalingOptions.${WHEN_SCALING[enumOf(a.whenScaling, Object.keys(WHEN_SCALING), { name: 'whenScaling' })]};`);
            if (has(a.referencePoint)) {
                const anchor = ANCHOR_POINT[enumOf(a.referencePoint, Object.keys(ANCHOR_POINT), { name: 'referencePoint' })];
                lines.push('if (app.layoutWindows.length === 0) throw new Error("No layout window is open to set the reference point in");');
                lines.push(`app.activeWindow.transformReferencePoint = AnchorPoint.${anchor};`);
            }
            if (!lines.length) throw new Error(`Nothing to set: give ${[...Object.keys(TRANSFORM_PREFS), 'whenScaling', 'referencePoint'].join(', ')}`);
            return run('Set transform preferences', script(`
var tp = app.transformPreferences;
${lines.join('\n')}
${READ_REFERENCE}
__result__ = ${transformPrefsResult};`, { needsDocument: false }));
        },
    },
    {
        name: 'get_transform_info',
        description: 'Read the transform preferences and reference point, and optionally items\' rotation, shear, scale, flip and transformation matrix (Transform panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. Optional: without it only the preferences are returned` },
            },
        },
        features: tx(['transform_panel']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const target = has(a.target) ? targetSpec(a.target) : null;
            return run('Get transform info', script(`
var tp = app.transformPreferences;
${READ_REFERENCE}
__result__ = { preferences: ${transformPrefsResult} };
${target ? `var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], info = __itemInfo(it);
  info.rotationAngle = it.rotationAngle; info.shearAngle = it.shearAngle;
  info.horizontalScale = it.horizontalScale; info.verticalScale = it.verticalScale;
  try { info.absoluteRotationAngle = it.absoluteRotationAngle; info.absoluteShearAngle = it.absoluteShearAngle; } catch (e) {}
  try { info.flip = __enumName(it.absoluteFlip); } catch (e) {}
  try {
    var m = it.transformValuesOf(CoordinateSpaces.PASTEBOARD_COORDINATES)[0].matrixValues;
    info.matrix = [m[0], m[1], m[2], m[3], m[4] * 25.4 / 72, m[5] * 25.4 / 72];
  } catch (e) {}
  out.push(info);
}
__result__.items = out;` : ''}`, { needsDocument: !!target }));
        },
    },
);
