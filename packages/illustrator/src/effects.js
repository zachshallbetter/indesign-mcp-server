/**
 * Live Effects applied with PageItem.applyEffect(liveEffectXML).
 *
 * Adobe does not document the LiveEffect XML. Each definition below follows
 * the parameters published scripts use, recorded with their sources in the
 * adobe-capability-atlas (Illustrator effects and geometry records):
 *   Offset Path     R ofst (pt), I jntp (0 round, 1 bevel, 2 miter), R mlim
 *   Round Corners   R radius (pt)
 *   Drop Shadow     I blnd (1 multiply), R opac (0-1), R horz, R vert, R blur (pt), R dark (%)
 *   Roughen         R asiz / size (%), R absoluteness 0, R dtal (per inch), R roundness (0 corner, 1 smooth)
 *   Transform       scale %, move (pt, up positive), rotate, numCopies, pinPoint 4 (centre)
 *   Gaussian Blur   R blur (px), PrevDocScale, PrevDres
 *   Pathfinder      I Command 0-9 with Precision, RemovePoints, ExtractUnpainted
 *
 * The builders return ES3 expressions, not strings: distances are divided by
 * the document's scale factor inside the script, so large-canvas documents get
 * the size the caller asked for.
 */
import { num, index, enumOf } from 'adobe-mcp-core';

const JOINS = { round: 0, bevel: 1, miter: 2 };

/** A number as a script expression: `${value} / __sf(doc)` for distances. */
const dist = (v, name) => `(${num(v, { min: -10000, max: 10000, name })} / __sf(doc))`;
const pct = (v, name, max = 100) => num(v, { min: 0, max, name });
const dict = (parts) => parts.map(([type, key, expr]) => `"${type} ${key} " + ${expr}`).join(' + " " + ');

export const EFFECTS = {
    drop_shadow: {
        label: 'Drop Shadow',
        params: {
            opacity: { type: 'number', minimum: 0, maximum: 100, default: 75, description: 'Percent' },
            x: { type: 'number', default: 7, description: 'Horizontal offset in points' },
            y: { type: 'number', default: 7, description: 'Vertical offset in points (down is positive)' },
            blur: { type: 'number', minimum: 0, maximum: 144, default: 5, description: 'Blur in points' },
            darkness: { type: 'number', minimum: 0, maximum: 100, default: 100, description: 'Percent of black mixed into the shadow' },
        },
        build: (o) => `'<LiveEffect name="Adobe Drop Shadow"><Dict data="' + ${dict([
            ['I', 'blnd', '1'],
            ['R', 'opac', `(${pct(o.opacity ?? 75, 'opacity')} / 100)`],
            ['R', 'horz', dist(o.x ?? 7, 'x')],
            ['R', 'vert', dist(o.y ?? 7, 'y')],
            ['R', 'blur', dist(o.blur ?? 5, 'blur')],
            ['B', 'usePSLBlur', '1'],
            ['I', 'csrc', '1'],
            ['R', 'dark', pct(o.darkness ?? 100, 'darkness')],
            ['B', 'pair', '1'],
        ])} + ' "><Entry name="sclr" valueType="F"><Fill color="' + (doc.documentColorSpace === DocumentColorSpace.CMYK ? "0 0 0 1" : "0 0 0") + '"/></Entry></Dict></LiveEffect>'`,
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
    divide: 5, outline: 6, trim: 7, merge: 8, crop: 9,
};
const PATHFINDER_NAMES = ['Add', 'Intersect', 'Exclude', 'Minus Front', 'Minus Back', 'Divide', 'Outline', 'Trim', 'Merge', 'Crop'];

/** The "Adobe Pathfinder" effect as a script expression. */
export function pathfinderEffect(operation, { precision = 10, removeRedundantPoints = false, removeUnpainted = false } = {}) {
    const command = PATHFINDER_COMMANDS[enumOf(operation, Object.keys(PATHFINDER_COMMANDS), { name: 'operation' })];
    return `'<LiveEffect name="Adobe Pathfinder" isPre="1"><Dict data="' + ${dict([
        ['I', 'Command', String(command)],
        ['B', 'ConvertCustom', '1'],
        ['B', 'ExtractUnpainted', removeUnpainted ? '1' : '0'],
        ['R', 'Mix', '0.5'],
        ['R', 'Precision', num(precision, { min: 0.001, max: 100, name: 'precision' })],
        ['B', 'RemovePoints', removeRedundantPoints ? '1' : '0'],
    ])} + '"><Entry name="DisplayString" value="${PATHFINDER_NAMES[command]}" valueType="S"/></Dict></LiveEffect>'`;
}

/** One line per effect for the tool description: its options, defaults and units. */
export function effectOptionsHelp() {
    return Object.entries(EFFECTS).map(([id, e]) => `${id}: ${Object.entries(e.params).map(([k, v]) =>
        `${k}${(e.required ?? []).includes(k) ? ' (required)' : ''}${v.enum ? ` ${v.enum.join('|')}` : ''}${v.default !== undefined ? ` = ${v.default}` : ''}${v.description ? ` [${v.description}]` : ''}`).join(', ')}`).join('; ');
}
