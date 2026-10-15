/**
 * Type layers: create point or paragraph type, edit its text and formatting,
 * warp it, and list fonts.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const JUSTIFY = {
    left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify_left: 'LEFTJUSTIFIED', justify_center: 'CENTERJUSTIFIED',
    justify_right: 'RIGHTJUSTIFIED', justify_all: 'FULLYJUSTIFIED',
};
const CASES = { normal: 'NORMAL', all_caps: 'ALLCAPS', small_caps: 'SMALLCAPS' };
const WARPS = {
    none: 'NONE', arc: 'ARC', arc_lower: 'ARCLOWER', arc_upper: 'ARCUPPER', arch: 'ARCH', bulge: 'BULGE', shell_lower: 'SHELLLOWER',
    shell_upper: 'SHELLUPPER', flag: 'FLAG', wave: 'WAVE', fish: 'FISH', rise: 'RISE', fisheye: 'FISHEYE', inflate: 'INFLATE',
    squeeze: 'SQUEEZE', twist: 'TWIST',
};

const STYLE = {
    font: { type: 'string', description: 'PostScript font name (list_fonts), e.g. "MyriadPro-Regular"' },
    size: { type: 'number', minimum: 0.1, maximum: 1296, description: 'Pixels' },
    color: COLOR_SCHEMA,
    tracking: { type: 'number', minimum: -1000, maximum: 10000, description: 'Thousandths of an em' },
    leading: { type: 'number', minimum: 0.1, maximum: 5000, description: 'Pixels; turns auto leading off' },
    justification: { type: 'string', enum: Object.keys(JUSTIFY) },
    fauxBold: { type: 'boolean' },
    fauxItalic: { type: 'boolean' },
    capitalization: { type: 'string', enum: Object.keys(CASES) },
    underline: { type: 'boolean' },
    strikethrough: { type: 'boolean' },
    baselineShift: { type: 'number', minimum: -1000, maximum: 1000, description: 'Pixels' },
    horizontalScale: { type: 'number', minimum: 0, maximum: 1000, description: 'Percent' },
    verticalScale: { type: 'number', minimum: 0, maximum: 1000, description: 'Percent' },
};

/** Statements that apply STYLE options to TextItem `t`. */
function styleLines(a) {
    const lines = [];
    if (a.font !== undefined) lines.push(`t.font = ${str(a.font)};`);
    if (a.size !== undefined) lines.push(`t.size = new UnitValue(${num(a.size, { min: 0.1, max: 1296, name: 'size' })}, "px");`);
    if (a.color !== undefined) lines.push(`t.color = __color(${colorSpec(a.color)});`);
    if (a.tracking !== undefined) lines.push(`t.tracking = ${num(a.tracking, { min: -1000, max: 10000, name: 'tracking' })};`);
    if (a.leading !== undefined) lines.push(`t.useAutoLeading = false; t.leading = new UnitValue(${num(a.leading, { min: 0.1, max: 5000, name: 'leading' })}, "px");`);
    if (a.justification !== undefined) lines.push(`t.justification = Justification.${JUSTIFY[enumOf(a.justification, Object.keys(JUSTIFY), { name: 'justification' })]};`);
    if (a.fauxBold !== undefined) lines.push(`t.fauxBold = ${bool(a.fauxBold)};`);
    if (a.fauxItalic !== undefined) lines.push(`t.fauxItalic = ${bool(a.fauxItalic)};`);
    if (a.capitalization !== undefined) lines.push(`t.capitalization = Case.${CASES[enumOf(a.capitalization, Object.keys(CASES), { name: 'capitalization' })]};`);
    if (a.underline !== undefined) lines.push(`t.underline = UnderlineType.${a.underline ? 'UNDERLINERIGHT' : 'UNDERLINEOFF'};`);
    if (a.strikethrough !== undefined) lines.push(`t.strikeThru = StrikeThruType.${a.strikethrough ? 'STRIKEHEIGHT' : 'STRIKEOFF'};`);
    if (a.baselineShift !== undefined) lines.push(`t.baselineShift = new UnitValue(${num(a.baselineShift, { min: -1000, max: 1000, name: 'baselineShift' })}, "px");`);
    if (a.horizontalScale !== undefined) lines.push(`t.horizontalScale = ${num(a.horizontalScale, { min: 0, max: 1000, name: 'horizontalScale' })};`);
    if (a.verticalScale !== undefined) lines.push(`t.verticalScale = ${num(a.verticalScale, { min: 0, max: 1000, name: 'verticalScale' })};`);
    return lines;
}

/** Text with line breaks as Photoshop stores them (carriage returns). */
const textLiteral = (s) => str(String(s).replace(/\r\n|\n/g, '\r'));

const TEXT_RESULT = `
var info = __layerInfo(l), t = l.textItem;
info.text = { contents: t.contents, kind: __enumName(t.kind) };
try { info.text.font = t.font; info.text.size = __px(t.size); info.text.color = __colorInfo(t.color); info.text.position = [__px(t.position[0]), __px(t.position[1])]; } catch (e) {}
__result__ = info;`;

export const tools = [
    {
        name: 'create_text_layer',
        description: 'Add a type layer: point type at a position, or paragraph type in a box (width and height), with its font, size, colour and formatting. Line breaks in text start new paragraphs',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string' },
                x: { type: 'number', description: 'Pixels from the left: the baseline start for point type, the box\'s left edge for paragraph type' },
                y: { type: 'number', description: 'Pixels from the top' },
                width: { type: 'number', minimum: 1, description: 'Paragraph type: box width in pixels' },
                height: { type: 'number', minimum: 1, description: 'Paragraph type: box height in pixels' },
                name: { type: 'string' },
                ...STYLE,
            },
            required: ['text', 'x', 'y'],
        },
        auditArgs: { color: '#202020', width: 400, height: 120 },
        features: ['photoshop.type.type_layer', 'photoshop.type.point_type', 'photoshop.type.paragraph_type', 'photoshop.type.font', 'photoshop.type.font_size', 'photoshop.type.text_color', 'photoshop.type.tracking', 'photoshop.type.leading', 'photoshop.type.paragraph_alignment', 'photoshop.type.paragraph_justification', 'photoshop.type.faux_bold', 'photoshop.type.faux_italic', 'photoshop.type.all_caps_small_caps', 'photoshop.type.underline', 'photoshop.type.strikethrough', 'photoshop.type.baseline_shift', 'photoshop.type.horizontal_scale', 'photoshop.type.vertical_scale'],
        handler: (a) => {
            const paragraph = a.width !== undefined || a.height !== undefined;
            if (paragraph && (a.width === undefined || a.height === undefined)) throw new Error('Paragraph type needs width and height');
            return run('Create text layer', script(`
var l = doc.artLayers.add();
l.kind = LayerKind.TEXT;
var t = l.textItem;
${paragraph ? `t.kind = TextType.PARAGRAPHTEXT;
t.width = new UnitValue(${num(a.width, { min: 1, name: 'width' })}, "px");
t.height = new UnitValue(${num(a.height, { min: 1, name: 'height' })}, "px");` : ''}
t.contents = ${textLiteral(a.text)};
t.position = [new UnitValue(${num(a.x, { name: 'x' })}, "px"), new UnitValue(${num(a.y, { name: 'y' })}, "px")];
${styleLines(a).join('\n')}
${a.name ? `l.name = ${str(a.name)};` : ''}
${TEXT_RESULT}`));
        },
    },
    {
        name: 'set_text',
        description: 'Change a type layer\'s text and/or formatting (applied to the whole layer), its position, and its warp (Type > Warp Text)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                text: { type: 'string' },
                x: { type: 'number' }, y: { type: 'number' },
                warp: { type: 'string', enum: Object.keys(WARPS) },
                warpBend: { type: 'number', minimum: -100, maximum: 100 },
                warpHorizontalDistortion: { type: 'number', minimum: -100, maximum: 100 },
                warpVerticalDistortion: { type: 'number', minimum: -100, maximum: 100 },
                ...STYLE,
            },
            required: ['target'],
        },
        hints: { idempotent: true },
        auditArgs: { color: 'rgb(200,30,30)', warp: 'arc' },
        features: ['photoshop.type.type_layer', 'photoshop.type.change_font_multiple_layers', 'photoshop.type.font', 'photoshop.type.font_size', 'photoshop.type.text_color', 'photoshop.type.tracking', 'photoshop.type.leading', 'photoshop.type.paragraph_alignment', 'photoshop.type.paragraph_justification', 'photoshop.type.faux_bold', 'photoshop.type.faux_italic', 'photoshop.type.all_caps_small_caps', 'photoshop.type.underline', 'photoshop.type.strikethrough', 'photoshop.type.baseline_shift', 'photoshop.type.horizontal_scale', 'photoshop.type.vertical_scale', 'photoshop.type.warp_text', 'photoshop.type.warp_style_arc', 'photoshop.type.warp_style_arclower', 'photoshop.type.warp_style_arcupper', 'photoshop.type.warp_style_arch', 'photoshop.type.warp_style_bulge', 'photoshop.type.warp_style_shelllower', 'photoshop.type.warp_style_shellupper', 'photoshop.type.warp_style_flag', 'photoshop.type.warp_style_wave', 'photoshop.type.warp_style_fish', 'photoshop.type.warp_style_rise', 'photoshop.type.warp_style_fisheye', 'photoshop.type.warp_style_inflate', 'photoshop.type.warp_style_squeeze', 'photoshop.type.warp_style_twist', 'photoshop.type.warp_bend', 'photoshop.type.warp_horizontal_distortion', 'photoshop.type.warp_vertical_distortion', 'photoshop.type.unwarp_text'],
        handler: (a) => {
            const lines = styleLines(a);
            if (a.text !== undefined) lines.unshift(`t.contents = ${textLiteral(a.text)};`);
            if (a.x !== undefined || a.y !== undefined) lines.push(`t.position = [new UnitValue(${a.x !== undefined ? num(a.x, { name: 'x' }) : '__px(t.position[0])'}, "px"), new UnitValue(${a.y !== undefined ? num(a.y, { name: 'y' }) : '__px(t.position[1])'}, "px")];`);
            if (a.warp !== undefined) lines.push(`t.warpStyle = WarpStyle.${WARPS[enumOf(a.warp, Object.keys(WARPS), { name: 'warp' })]};`);
            if (a.warpBend !== undefined) lines.push(`t.warpBend = ${num(a.warpBend, { min: -100, max: 100, name: 'warpBend' })};`);
            if (a.warpHorizontalDistortion !== undefined) lines.push(`t.warpHorizontalDistortion = ${num(a.warpHorizontalDistortion, { min: -100, max: 100, name: 'warpHorizontalDistortion' })};`);
            if (a.warpVerticalDistortion !== undefined) lines.push(`t.warpVerticalDistortion = ${num(a.warpVerticalDistortion, { min: -100, max: 100, name: 'warpVerticalDistortion' })};`);
            if (!lines.length) throw new Error('Give text, a position, a warp or formatting');
            return run('Set text', script(`
var items = __targets(doc, ${targetSpec(a.target)}), l;
for (var i = 0; i < items.length; i++) {
  l = items[i];
  if (l.typename !== "ArtLayer" || l.kind !== LayerKind.TEXT) throw new Error(l.name + " is not a type layer");
  var t = l.textItem;
  ${lines.join('\n  ')}
}
${TEXT_RESULT}`));
        },
    },
    {
        name: 'list_fonts',
        description: 'List installed fonts with their PostScript name, family and style, filtered by a search string',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 } },
        },
        hints: { readOnly: true },
        features: ['photoshop.type.font_list'],
        handler: (a) => run('List fonts', script(`
var q = ${str(String(a.query ?? '').toLowerCase())}, max = ${index(a.limit ?? 50, { name: 'limit', max: 1000 })}, out = [], total = 0;
for (var i = 0; i < app.fonts.length; i++) {
  var f = app.fonts[i];
  if (q && (f.postScriptName + " " + f.family + " " + f.style).toLowerCase().indexOf(q) < 0) continue;
  total++;
  if (out.length < max) out.push({ postScriptName: f.postScriptName, family: f.family, style: f.style });
}
__result__ = { total: total, fonts: out };`, { needsDocument: false })),
    },
];
