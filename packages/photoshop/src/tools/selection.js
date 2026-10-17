/**
 * Selections: make, modify, transform, fill, stroke, store and load them, and
 * copy, cut, paste and clear through them; Color Range, Select Subject, Sky
 * and Focus Area, Select and Mask, layer transparency; and choosing a tool.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM_HELPERS } from '../actions.js';
import { COLOR_SCHEMA, RECT_SCHEMA, TARGET_SCHEMA, colorSpec, rect, targetSpec } from '../args.js';

const COMBINE = { replace: 'REPLACE', add: 'EXTEND', subtract: 'DIMINISH', intersect: 'INTERSECT' };
const COMBINE_SCHEMA = { type: 'string', enum: Object.keys(COMBINE), description: 'How it combines with the current selection. Default replace' };
export const FILL_BLEND = {
    normal: 'NORMAL', dissolve: 'DISSOLVE', behind: 'BEHIND', clear: 'CLEAR', darken: 'DARKEN', multiply: 'MULTIPLY', color_burn: 'COLORBURN',
    linear_burn: 'LINEARBURN', lighten: 'LIGHTEN', screen: 'SCREEN', color_dodge: 'COLORDODGE', linear_dodge: 'LINEARDODGE', overlay: 'OVERLAY',
    soft_light: 'SOFTLIGHT', hard_light: 'HARDLIGHT', difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION',
    color: 'COLOR', luminosity: 'LUMINOSITY',
};

// Tools by Application.currentTool id.
const TOOLS = {
    move: 'moveTool', rectangular_marquee: 'marqueeRectTool', elliptical_marquee: 'marqueeEllipTool', single_row_marquee: 'marqueeSingleRowTool',
    single_column_marquee: 'marqueeSingleColumnTool', lasso: 'lassoTool', polygonal_lasso: 'polySelTool', magnetic_lasso: 'magneticLassoTool',
    quick_selection: 'quickSelectTool', magic_wand: 'magicWandTool', crop: 'cropTool', perspective_crop: 'perspectiveCropTool',
    eyedropper: 'eyedropperTool', color_sampler: 'colorSamplerTool', ruler: 'rulerTool', count: 'countTool',
};
// Color Range's Select menu presets (colors enum), by charID.
const RANGE_PRESETS = {
    reds: 'Rds ', yellows: 'Ylws', greens: 'Grns', cyans: 'Cyns', blues: 'Bls ', magentas: 'Mgnt',
    highlights: 'Hghl', midtones: 'Mdtn', shadows: 'Shdw', out_of_gamut: 'OtOf',
};
const TONAL = ['highlights', 'midtones', 'shadows'];
const AUTO_SELECT = { subject: 'autoCutout', sky: 'selectSky', focus_area: 'focusMask' };
// Select and Mask's Output To (refineEdgeOutput).
const REFINE_OUTPUT = {
    selection: 'selectionOutputToSelection', layer_mask: 'selectionOutputToUserMask', new_layer: 'selectionOutputToNewLayer',
    new_layer_with_mask: 'selectionOutputToNewLayerWithUserMask', new_document: 'selectionOutputToNewDocument',
    new_document_with_mask: 'selectionOutputToNewDocumentWithUserMask',
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

const CLIPBOARD_ACTIONS = ['copy', 'copy_merged', 'cut', 'clear', 'paste', 'paste_into', 'paste_in_place', 'paste_outside'];

export const tools = [
    {
        name: 'select_area',
        description: 'Select a rectangle, an ellipse, a polygon or freehand outline (the Polygonal Lasso and Lasso tools), or a one-pixel row or column (Single Row and Single Column Marquee tools), in pixels from the document\'s top-left corner, combined with the current selection. The ellipse is a fine polygon, so its edge is close to but not exactly the Elliptical Marquee\'s',
        inputSchema: {
            type: 'object',
            properties: {
                shape: { type: 'string', enum: ['rectangle', 'ellipse', 'polygon', 'row', 'column'], description: 'Default rectangle' },
                bounds: { ...RECT_SCHEMA, description: 'Rectangle or ellipse bounds' },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 3, description: 'Polygon or lasso outline, [[x, y], ...]' },
                y: { type: 'number', minimum: 0, description: 'row: the row\'s top edge, pixels from the top' },
                x: { type: 'number', minimum: 0, description: 'column: the column\'s left edge, pixels from the left' },
                combine: COMBINE_SCHEMA,
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels. Default 0' },
                antiAlias: { type: 'boolean', default: true },
            },
        },
        features: ['photoshop.selection.rectangular_marquee_tool', 'photoshop.selection.elliptical_marquee_tool', 'photoshop.selection.polygonal_lasso_tool', 'photoshop.selection.selection_modes', 'photoshop.selection.feather_option', 'photoshop.selection.anti_alias',
            'photoshop.selection.lasso_tool', 'photoshop.selection.single_row_marquee_tool', 'photoshop.selection.single_column_marquee_tool'],
        handler: (a) => {
            const shape = enumOf(a.shape ?? 'rectangle', ['rectangle', 'ellipse', 'polygon', 'row', 'column'], { name: 'shape' });
            let pts = null, line = '';
            if (shape === 'polygon') {
                if (!Array.isArray(a.points) || a.points.length < 3) throw new Error('A polygon needs at least three points');
                pts = a.points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
            } else if (shape === 'row') {
                if (a.y === undefined) throw new Error("'row' needs y");
                const y = num(a.y, { min: 0, max: 300000, name: 'y' });
                line = `var w = __px(doc.width), y0 = ${y}; if (y0 >= __px(doc.height)) throw new Error("y is below the canvas"); var pts = [[0, y0], [w, y0], [w, y0 + 1], [0, y0 + 1]];`;
            } else if (shape === 'column') {
                if (a.x === undefined) throw new Error("'column' needs x");
                const x = num(a.x, { min: 0, max: 300000, name: 'x' });
                line = `var h = __px(doc.height), x0 = ${x}; if (x0 >= __px(doc.width)) throw new Error("x is right of the canvas"); var pts = [[x0, 0], [x0 + 1, 0], [x0 + 1, h], [x0, h]];`;
            } else {
                const r = rect(a.bounds, 'bounds');
                pts = shape === 'rectangle' ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : ellipsePoints(r);
            }
            return run('Select area', script(`
${line}
doc.selection.select(${pts ? json(pts) : 'pts'}, SelectionType.${COMBINE[enumOf(a.combine ?? 'replace', Object.keys(COMBINE), { name: 'combine' })]}, ${num(a.feather ?? 0, { min: 0, max: 1000, name: 'feather' })}, ${bool(a.antiAlias ?? true)});
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
        features: ['photoshop.selection.save_selection', 'photoshop.selection.load_selection', 'photoshop.selection.selection_modes', 'photoshop.channels.alpha_channel', 'photoshop.channels.save_selection_as_channel', 'photoshop.channels.load_channel_as_selection'],
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
        description: 'Copy, copy merged, cut or clear the selection on the active layer, or paste as a new layer: paste, paste_into the selection, paste_in_place (Edit > Paste Special > Paste in Place: at the copied pixels\' original position) or paste_outside the selection (Paste Outside: the selection is masked out)',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: CLIPBOARD_ACTIONS, description: 'What to do' } },
            required: ['action'],
        },
        features: ['photoshop.documents.copy', 'photoshop.documents.copy_merged', 'photoshop.documents.cut', 'photoshop.documents.clear', 'photoshop.documents.paste', 'photoshop.documents.paste_into', 'photoshop.documents.paste_in_place', 'photoshop.documents.paste_outside'],
        handler: (a) => {
            const action = enumOf(a.action, CLIPBOARD_ACTIONS, { name: 'action' });
            return run('Clipboard', script(`
${{
        copy: 'doc.selection.copy(false);', copy_merged: 'doc.selection.copy(true);', cut: 'doc.selection.cut();', clear: 'doc.selection.clear();',
        paste: 'var pasted = doc.paste(false);', paste_into: 'var pasted = doc.paste(true);',
        paste_in_place: `var pd = new ActionDescriptor();
pd.putBoolean(app.stringIDToTypeID("inPlace"), true);
app.executeAction(app.stringIDToTypeID("paste"), pd, DialogModes.NO);`,
        paste_outside: `try { doc.selection.bounds; } catch (e) { throw new Error("Paste Outside needs a selection"); }
app.executeAction(app.stringIDToTypeID("pasteOutside"), new ActionDescriptor(), DialogModes.NO);`,
    }[action]}
__result__ = { action: ${str(action)}, layer: ${action.startsWith('paste') ? '__layerInfo(doc.activeLayer)' : 'null'} };`));
        },
    },
    {
        name: 'activate_tool',
        description: 'Choose a tool in the Tools panel, such as a marquee, lasso, Quick Selection, Magic Wand, Crop, Perspective Crop, Eyedropper, Color Sampler, Ruler or Count tool, so it is ready for the user. Using a tool on the canvas is the user\'s; select_area, crop_image and manage_count_items do the same work by numbers',
        inputSchema: { type: 'object', properties: { tool: { type: 'string', enum: Object.keys(TOOLS) } }, required: ['tool'] },
        hints: { idempotent: true },
        features: ['photoshop.selection.selection_tools_overview', 'photoshop.selection.lasso_tool', 'photoshop.selection.single_row_marquee_tool', 'photoshop.selection.single_column_marquee_tool',
            'photoshop.image.crop_tool', 'photoshop.image.perspective_crop_tool', 'photoshop.image.ruler_tool', 'photoshop.image.count_tool'],
        handler: (a) => run('Activate tool', script(`
app.currentTool = ${str(TOOLS[enumOf(a.tool, Object.keys(TOOLS), { name: 'tool' })])};
__result__ = { currentTool: app.currentTool };`, { needsDocument: false })),
    },
    {
        name: 'select_color_range',
        description: 'Select by colour (Select > Color Range): pixels near a sampled colour within a fuzziness, or a preset range (reds ... magentas, highlights, midtones, shadows, out of gamut), optionally inverted. Works inside the current selection when there is one, and samples the active layer',
        inputSchema: {
            type: 'object',
            properties: {
                color: { ...COLOR_SCHEMA, description: 'The colour to select (Sampled Colors). ' + COLOR_SCHEMA.description },
                preset: { type: 'string', enum: Object.keys(RANGE_PRESETS), description: 'A preset range instead of a colour' },
                fuzziness: { type: 'integer', minimum: 0, maximum: 200, description: 'Sampled colours and highlights/midtones/shadows: how far from the colour or tone still counts. Default 40' },
                range: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 }, minItems: 2, maxItems: 2, description: 'highlights, midtones or shadows: the [lower, upper] tonal limits, 0-255' },
                invert: { type: 'boolean', description: 'Select everything else. Default false', default: false },
            },
        },
        auditArgs: { color: '#3366CC', preset: undefined, range: undefined },
        features: ['photoshop.selection.color_range'],
        handler: (a) => {
            if ((a.color === undefined) === (a.preset === undefined)) throw new Error('Give color or preset');
            const lines = [];
            if (a.color !== undefined) {
                if (a.range !== undefined) throw new Error('range is for the highlights, midtones and shadows presets');
                lines.push(`var lab = __color(${colorSpec(a.color)}).lab, c = new ActionDescriptor();`,
                    'c.putDouble(__c("Lmnc"), lab.L);', 'c.putDouble(__c("A   "), lab.A);', 'c.putDouble(__c("B   "), lab.B);',
                    `d.putInteger(__c("Fzns"), ${num(a.fuzziness ?? 40, { min: 0, max: 200, name: 'fuzziness' })});`,
                    'd.putObject(__c("Mnm "), __c("LbCl"), c);', 'd.putObject(__c("Mxm "), __c("LbCl"), c);');
            } else {
                const preset = enumOf(a.preset, Object.keys(RANGE_PRESETS), { name: 'preset' });
                lines.push(`d.putEnumerated(__c("Clrs"), __c("Clrs"), __c(${str(RANGE_PRESETS[preset])}));`);
                if (TONAL.includes(preset)) {
                    if (a.fuzziness !== undefined) lines.push(`d.putInteger(__s(${str(`${preset}Fuzziness`)}), ${num(a.fuzziness, { min: 0, max: 100, name: 'fuzziness' })});`);
                    if (a.range !== undefined) {
                        if (!Array.isArray(a.range) || a.range.length !== 2) throw new Error('range is [lower, upper]');
                        const [lo, hi] = a.range.map((v, i) => Number(num(v, { min: 0, max: 255, name: `range[${i}]` })));
                        if (lo > hi) throw new Error('range: lower must not exceed upper');
                        lines.push(`d.putInteger(__s(${str(`${preset}LowerLimit`)}), ${lo});`, `d.putInteger(__s(${str(`${preset}UpperLimit`)}), ${hi});`);
                    }
                } else if (a.fuzziness !== undefined || a.range !== undefined) {
                    throw new Error(`'${preset}' takes no fuzziness or range`);
                }
            }
            return run('Select color range', script(`${AM_HELPERS}
var d = new ActionDescriptor();
${lines.join('\n')}
d.putInteger(__s("colorModel"), 0);
d.putBoolean(__c("Invr"), ${bool(a.invert)});
__do(__s("colorRange"), d);
${RESULT}`));
        },
    },
    {
        name: 'select_content',
        description: 'Select automatically: the main subject (Select > Subject), the sky (Select > Sky), or the in-focus areas with Focus Area\'s automatic settings (Select > Focus Area). Subject uses the device or cloud processing chosen in Preferences > Image Processing',
        inputSchema: {
            type: 'object',
            properties: {
                what: { type: 'string', enum: Object.keys(AUTO_SELECT) },
                sampleAllLayers: { type: 'boolean', description: 'subject and sky: look at every layer, not only the active one. Default false', default: false },
            },
            required: ['what'],
        },
        features: ['photoshop.selection.select_subject', 'photoshop.selection.select_sky', 'photoshop.selection.focus_area'],
        handler: (a) => {
            const what = enumOf(a.what, Object.keys(AUTO_SELECT), { name: 'what' });
            if (what === 'focus_area' && a.sampleAllLayers) throw new Error('sampleAllLayers is for subject and sky');
            return run('Select content', script(`${AM_HELPERS}
var d = new ActionDescriptor();
${what !== 'focus_area' ? `d.putBoolean(__s("sampleAllLayers"), ${bool(a.sampleAllLayers)});` : ''}
__do(__s(${str(AUTO_SELECT[what])}), d);
${RESULT}`));
        },
    },
    {
        name: 'refine_selection',
        description: 'Refine the selection\'s edge as Select and Mask does, without opening the workspace: edge detection radius (optionally smart), smooth, feather, contrast, shift edge and colour decontamination, output to the selection, a layer mask, a new layer or a new document',
        inputSchema: {
            type: 'object',
            properties: {
                radius: { type: 'integer', minimum: 0, maximum: 250, description: 'Edge detection radius, pixels. Default 0' },
                smartRadius: { type: 'boolean', description: 'Smart Radius. Default false', default: false },
                smooth: { type: 'integer', minimum: 0, maximum: 100, description: 'Default 0' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels. Default 0' },
                contrast: { type: 'number', minimum: 0, maximum: 100, description: 'Percent. Default 0' },
                shiftEdge: { type: 'number', minimum: -100, maximum: 100, description: 'Percent; negative moves the edge inward. Default 0' },
                decontaminate: { type: 'boolean', description: 'Decontaminate Colors (needs an output to a new layer or document). Default false', default: false },
                decontaminateAmount: { type: 'number', minimum: 0, maximum: 100, description: 'Percent. Default 100' },
                sampleAllLayers: { type: 'boolean', description: 'Default false', default: false },
                output: { type: 'string', enum: Object.keys(REFINE_OUTPUT), description: 'Default selection' },
            },
        },
        auditArgs: { decontaminate: false, output: 'layer_mask' },
        features: ['photoshop.selection.select_and_mask'],
        handler: (a) => {
            const output = enumOf(a.output ?? 'selection', Object.keys(REFINE_OUTPUT), { name: 'output' });
            if (a.decontaminate && !output.startsWith('new_')) throw new Error('decontaminate needs output to a new layer or document');
            return run('Refine selection', script(`${AM_HELPERS}
if (!__hasSelection(doc)) throw new Error("Select and Mask needs a selection");
var d = new ActionDescriptor();
d.putEnumerated(__s("presetKind"), __s("presetKindType"), __s("presetKindCustom"));
d.putInteger(__s("smartBrushRadius"), ${num(a.radius ?? 0, { min: 0, max: 250, name: 'radius' })});
d.putInteger(__s("smartBrushSmooth"), ${num(a.smooth ?? 0, { min: 0, max: 100, name: 'smooth' })});
d.putUnitDouble(__s("smartBrushFeather"), __s("pixelsUnit"), ${num(a.feather ?? 0, { min: 0, max: 1000, name: 'feather' })});
d.putUnitDouble(__s("smartBrushContrast"), __s("percentUnit"), ${num(a.contrast ?? 0, { min: 0, max: 100, name: 'contrast' })});
d.putUnitDouble(__s("smartBrushShiftEdge"), __s("percentUnit"), ${num(a.shiftEdge ?? 0, { min: -100, max: 100, name: 'shiftEdge' })});
d.putBoolean(__s("sampleAllLayers"), ${bool(a.sampleAllLayers)});
d.putBoolean(__s("smartBrushUseSmartRadius"), ${bool(a.smartRadius)});
d.putBoolean(__s("smartBrushDecontaminate"), ${bool(a.decontaminate)});
d.putUnitDouble(__s("smartBrushDeconAmount"), __s("percentUnit"), ${num(a.decontaminateAmount ?? 100, { min: 0, max: 100, name: 'decontaminateAmount' })});
d.putEnumerated(__s("refineEdgeOutput"), __s("refineEdgeOutput"), __s(${str(REFINE_OUTPUT[output])}));
__do(__s("smartBrushWorkspace"), d);
var out = { output: ${str(output)}, activeLayer: null, selection: null };
try { out.activeLayer = __layerInfo(app.activeDocument.activeLayer); } catch (e) {}
try { var b = app.activeDocument.selection.bounds; out.selection = { x: __px(b[0]), y: __px(b[1]), width: __px(b[2]) - __px(b[0]), height: __px(b[3]) - __px(b[1]) }; } catch (e2) {}
__result__ = out;`));
        },
    },
    {
        name: 'select_layer_pixels',
        description: 'Load layers\' transparency as the selection, as Cmd/Ctrl-clicking a layer thumbnail does: replace, add to, subtract from or intersect with the current selection. With several layers, replace selects all of their pixels together',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, combine: COMBINE_SCHEMA }, required: ['target'] },
        auditArgs: { target: { ids: [3, 4] } },
        features: ['photoshop.selection.load_layer_transparency'],
        handler: (a) => {
            const combine = enumOf(a.combine ?? 'replace', Object.keys(COMBINE), { name: 'combine' });
            return run('Select layer pixels', script(`${AM_HELPERS}
var items = __targets(doc, ${targetSpec(a.target)}), combine = ${str(combine)};
for (var i = 0; i < items.length; i++) {
  var t = new ActionReference(), sel = new ActionReference(), d = new ActionDescriptor();
  t.putEnumerated(__s("channel"), __s("channel"), __s("transparencyEnum"));
  t.putIdentifier(__s("layer"), items[i].id);
  sel.putProperty(__s("channel"), __s("selection"));
  var mode = combine === "replace" && i > 0 ? "add" : combine;
  if (mode === "replace") { d.putReference(__s("null"), sel); d.putReference(__s("to"), t); __do(__s("set"), d); }
  else if (mode === "add") { d.putReference(__s("null"), t); d.putReference(__s("to"), sel); __do(__s("add"), d); }
  else if (mode === "subtract") { d.putReference(__s("null"), t); d.putReference(__s("from"), sel); __do(__s("subtract"), d); }
  else { d.putReference(__s("null"), t); d.putReference(__s("with"), sel); __do(__s("interfaceIconFrameDimmed"), d); }
}
${RESULT}`));
        },
    },
];
