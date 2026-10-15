/**
 * Selections: make, modify, transform, fill, stroke, store and load them, and
 * copy, cut, paste and clear through them.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, RECT_SCHEMA, colorSpec, rect } from '../args.js';

const COMBINE = { replace: 'REPLACE', add: 'EXTEND', subtract: 'DIMINISH', intersect: 'INTERSECT' };
const COMBINE_SCHEMA = { type: 'string', enum: Object.keys(COMBINE), description: 'How it combines with the current selection. Default replace' };
const FILL_BLEND = {
    normal: 'NORMAL', dissolve: 'DISSOLVE', behind: 'BEHIND', clear: 'CLEAR', darken: 'DARKEN', multiply: 'MULTIPLY', color_burn: 'COLORBURN',
    linear_burn: 'LINEARBURN', lighten: 'LIGHTEN', screen: 'SCREEN', color_dodge: 'COLORDODGE', linear_dodge: 'LINEARDODGE', overlay: 'OVERLAY',
    soft_light: 'SOFTLIGHT', hard_light: 'HARDLIGHT', difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION',
    color: 'COLOR', luminosity: 'LUMINOSITY',
};

/** The selection's bounds afterwards, or null when nothing is selected. */
const RESULT = `
var sb = null;
try { var b = doc.selection.bounds; sb = { x: __px(b[0]), y: __px(b[1]), width: __px(b[2]) - __px(b[0]), height: __px(b[3]) - __px(b[1]) }; } catch (e) { sb = null; }
__result__ = { selection: sb };`;

/** Points of an ellipse inscribed in [l, t, r, b], as a polygon fine enough to read as a curve. */
function ellipsePoints([l, t, r, b]) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
    const n = Math.max(32, Math.min(360, Math.round((rx + ry) / 2)));
    return Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        return [Math.round((cx + rx * Math.cos(a)) * 100) / 100, Math.round((cy + ry * Math.sin(a)) * 100) / 100];
    });
}

export const tools = [
    {
        name: 'select_area',
        description: 'Select a rectangle, an ellipse or a polygon, in pixels from the document\'s top-left corner, combined with the current selection. The ellipse is a fine polygon, so its edge is close to but not exactly the Elliptical Marquee\'s',
        inputSchema: {
            type: 'object',
            properties: {
                shape: { type: 'string', enum: ['rectangle', 'ellipse', 'polygon'], description: 'Default rectangle' },
                bounds: { ...RECT_SCHEMA, description: 'Rectangle or ellipse bounds' },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 3, description: 'Polygon corners, [[x, y], ...]' },
                combine: COMBINE_SCHEMA,
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels. Default 0' },
                antiAlias: { type: 'boolean', default: true },
            },
        },
        features: ['photoshop.selection.rectangular_marquee_tool', 'photoshop.selection.elliptical_marquee_tool', 'photoshop.selection.polygonal_lasso_tool', 'photoshop.selection.selection_modes', 'photoshop.selection.feather_option', 'photoshop.selection.anti_alias'],
        handler: (a) => {
            const shape = enumOf(a.shape ?? 'rectangle', ['rectangle', 'ellipse', 'polygon'], { name: 'shape' });
            let pts;
            if (shape === 'polygon') {
                if (!Array.isArray(a.points) || a.points.length < 3) throw new Error('A polygon needs at least three points');
                pts = a.points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
            } else {
                const r = rect(a.bounds, 'bounds');
                pts = shape === 'rectangle' ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : ellipsePoints(r);
            }
            return run('Select area', script(`
doc.selection.select(${json(pts)}, SelectionType.${COMBINE[enumOf(a.combine ?? 'replace', Object.keys(COMBINE), { name: 'combine' })]}, ${num(a.feather ?? 0, { min: 0, max: 1000, name: 'feather' })}, ${bool(a.antiAlias ?? true)});
${RESULT}`));
        },
    },
    {
        name: 'select_all',
        description: 'Select the whole canvas (Select > All), deselect (Select > Deselect), or invert the selection (Select > Inverse)',
        inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['all', 'none', 'inverse'] } }, required: ['action'] },
        hints: { idempotent: true },
        features: ['photoshop.selection.select_all', 'photoshop.selection.deselect', 'photoshop.selection.inverse'],
        handler: (a) => {
            const action = enumOf(a.action, ['all', 'none', 'inverse'], { name: 'action' });
            return run('Select', script(`
${{ all: 'doc.selection.selectAll();', none: 'doc.selection.deselect();', inverse: 'doc.selection.invert();' }[action]}
${RESULT}`));
        },
    },
    {
        name: 'modify_selection',
        description: 'Modify the selection (Select > Modify): expand, contract, feather, smooth or border by pixels; grow or select similar colours by tolerance',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['expand', 'contract', 'feather', 'smooth', 'border', 'grow', 'similar'] },
                amount: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels (radius or width); tolerance 0-255 for grow and similar' },
            },
            required: ['operation', 'amount'],
        },
        features: ['photoshop.selection.expand', 'photoshop.selection.contract', 'photoshop.selection.feather', 'photoshop.selection.smooth', 'photoshop.selection.border', 'photoshop.selection.grow', 'photoshop.selection.similar'],
        handler: (a) => {
            const op = enumOf(a.operation, ['expand', 'contract', 'feather', 'smooth', 'border', 'grow', 'similar'], { name: 'operation' });
            const v = num(a.amount, { min: 0, max: op === 'grow' || op === 'similar' ? 255 : 1000, name: 'amount' });
            const call = {
                expand: `doc.selection.expand(new UnitValue(${v}, "px"));`,
                contract: `doc.selection.contract(new UnitValue(${v}, "px"));`,
                feather: `doc.selection.feather(new UnitValue(${v}, "px"));`,
                smooth: `doc.selection.smooth(${v});`,
                border: `doc.selection.selectBorder(new UnitValue(${v}, "px"));`,
                grow: `doc.selection.grow(${v}, true);`,
                similar: `doc.selection.similar(${v}, true);`,
            }[op];
            return run('Modify selection', script(`
${call}
${RESULT}`));
        },
    },
    {
        name: 'transform_selection',
        description: 'Move, scale or rotate the selection outline (Select > Transform Selection), or the selected pixels themselves',
        inputSchema: {
            type: 'object',
            properties: {
                pixels: { type: 'boolean', description: 'Transform the selected pixels, not just the outline. Default false', default: false },
                dx: { type: 'number' }, dy: { type: 'number' },
                scaleX: { type: 'number', minimum: 1, maximum: 10000, description: 'Percent' },
                scaleY: { type: 'number', minimum: 1, maximum: 10000, description: 'Percent' },
                angle: { type: 'number', minimum: -360, maximum: 360 },
            },
        },
        features: ['photoshop.selection.transform_selection', 'photoshop.selection.move_selection_border', 'photoshop.transformations.transform_masks_channels', 'photoshop.transformations.transform_scale', 'photoshop.transformations.transform_rotate'],
        handler: (a) => {
            const b = a.pixels ? '' : 'Boundary';
            const lines = [];
            if (a.scaleX !== undefined || a.scaleY !== undefined) lines.push(`doc.selection.resize${b}(${num(a.scaleX ?? 100, { min: 1, max: 10000, name: 'scaleX' })}, ${num(a.scaleY ?? 100, { min: 1, max: 10000, name: 'scaleY' })}, AnchorPosition.MIDDLECENTER);`);
            if (a.angle !== undefined) lines.push(`doc.selection.rotate${b}(${num(a.angle, { min: -360, max: 360, name: 'angle' })}, AnchorPosition.MIDDLECENTER);`);
            if (a.dx !== undefined || a.dy !== undefined) lines.push(`doc.selection.translate${b}(new UnitValue(${num(a.dx ?? 0, { name: 'dx' })}, "px"), new UnitValue(${num(a.dy ?? 0, { name: 'dy' })}, "px"));`);
            if (!lines.length) throw new Error('Give dx/dy, scaleX/scaleY or angle');
            return run('Transform selection', script(`
${lines.join('\n')}
${RESULT}`));
        },
    },
    {
        name: 'fill_selection',
        description: 'Fill the selection on the active layer with a colour (Edit > Fill), with a blend mode, opacity and optionally preserving transparency',
        inputSchema: {
            type: 'object',
            properties: {
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Default the foreground colour' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Default normal' },
                opacity: { type: 'number', minimum: 1, maximum: 100, default: 100 },
                preserveTransparency: { type: 'boolean', default: false },
            },
        },
        features: ['photoshop.painting.fill', 'photoshop.painting.fill_option.contents', 'photoshop.painting.fill_option.color', 'photoshop.painting.fill_option.foreground_color', 'photoshop.painting.fill_option.mode', 'photoshop.painting.fill_option.opacity', 'photoshop.painting.fill_option.preserve_transparency'],
        handler: (a) => run('Fill selection', script(`
doc.selection.fill(${a.color !== undefined ? `__color(${colorSpec(a.color)})` : 'app.foregroundColor'}, ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${num(a.opacity ?? 100, { min: 1, max: 100, name: 'opacity' })}, ${bool(a.preserveTransparency)});
${RESULT}`)),
    },
    {
        name: 'stroke_selection',
        description: 'Stroke the selection\'s edge on the active layer (Edit > Stroke): colour, width in pixels, inside, centre or outside, blend mode and opacity',
        inputSchema: {
            type: 'object',
            properties: {
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Default the foreground colour' },
                width: { type: 'number', minimum: 1, maximum: 250 },
                location: { type: 'string', enum: ['inside', 'center', 'outside'], description: 'Default center' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Default normal' },
                opacity: { type: 'number', minimum: 1, maximum: 100, default: 100 },
                preserveTransparency: { type: 'boolean', default: false },
            },
            required: ['width'],
        },
        features: ['photoshop.painting.stroke', 'photoshop.painting.stroke_option.width', 'photoshop.painting.stroke_option.color', 'photoshop.painting.stroke_option.inside', 'photoshop.painting.stroke_option.center', 'photoshop.painting.stroke_option.outside', 'photoshop.painting.stroke_option.mode', 'photoshop.painting.stroke_option.opacity', 'photoshop.painting.stroke_option.preserve_transparency'],
        handler: (a) => run('Stroke selection', script(`
doc.selection.stroke(${a.color !== undefined ? `__color(${colorSpec(a.color)})` : 'app.foregroundColor'}, ${num(a.width, { min: 1, max: 250, name: 'width' })}, StrokeLocation.${enumOf(a.location ?? 'center', ['inside', 'center', 'outside'], { name: 'location' }).toUpperCase()}, ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${num(a.opacity ?? 100, { min: 1, max: 100, name: 'opacity' })}, ${bool(a.preserveTransparency)});
${RESULT}`)),
    },
    {
        name: 'save_selection',
        description: 'Store the selection in an alpha channel (Select > Save Selection), or load a channel as the selection (Select > Load Selection), combined with the current one',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['save', 'load'] },
                channel: { type: 'string', description: 'Alpha channel name. Saving to a new name creates the channel' },
                combine: COMBINE_SCHEMA,
                invert: { type: 'boolean', description: 'Load: invert the channel. Default false', default: false },
            },
            required: ['action', 'channel'],
        },
        features: ['photoshop.selection.save_selection', 'photoshop.selection.load_selection', 'photoshop.selection.selection_modes', 'photoshop.channels.alpha_channel'],
        handler: (a) => {
            const action = enumOf(a.action, ['save', 'load'], { name: 'action' });
            const combine = `SelectionType.${COMBINE[enumOf(a.combine ?? 'replace', Object.keys(COMBINE), { name: 'combine' })]}`;
            return run('Save or load selection', script(`
var ch = null;
try { ch = doc.channels.getByName(${str(a.channel)}); } catch (e) { ch = null; }
${action === 'save' ? `
if (!ch) { ch = doc.channels.add(); ch.name = ${str(a.channel)}; doc.selection.store(ch, SelectionType.REPLACE); }
else doc.selection.store(ch, ${combine});` : `
if (!ch) throw new Error("No channel named " + ${str(a.channel)});
doc.selection.load(ch, ${combine}, ${bool(a.invert)});`}
${RESULT}`));
        },
    },
    {
        name: 'clipboard',
        description: 'Copy, copy merged, cut or clear the selection on the active layer, or paste (optionally into the selection) as a new layer',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['copy', 'copy_merged', 'cut', 'clear', 'paste', 'paste_into'] } },
            required: ['action'],
        },
        features: ['photoshop.documents.copy', 'photoshop.documents.copy_merged', 'photoshop.documents.cut', 'photoshop.documents.clear', 'photoshop.documents.paste', 'photoshop.documents.paste_into'],
        handler: (a) => {
            const action = enumOf(a.action, ['copy', 'copy_merged', 'cut', 'clear', 'paste', 'paste_into'], { name: 'action' });
            return run('Clipboard', script(`
${{
        copy: 'doc.selection.copy(false);', copy_merged: 'doc.selection.copy(true);', cut: 'doc.selection.cut();', clear: 'doc.selection.clear();',
        paste: 'var pasted = doc.paste(false);', paste_into: 'var pasted = doc.paste(true);',
    }[action]}
__result__ = { action: ${str(action)}, layer: ${action.startsWith('paste') ? '__layerInfo(doc.activeLayer)' : 'null'} };`));
        },
    },
];
