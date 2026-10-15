/**
 * Type layers: create point or paragraph type, edit its text and formatting,
 * warp it, set Character and Paragraph panel options, convert type to paths,
 * shapes and selections, find and replace text, run the Type menu commands,
 * and list fonts.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
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

const ANTI_ALIAS = { none: 'NONE', sharp: 'SHARP', crisp: 'CRISP', strong: 'STRONG', smooth: 'SMOOTH' };
const DIRECTIONS = { horizontal: 'HORIZONTAL', vertical: 'VERTICAL' };
const KERNING = { metrics: 'METRICS', optical: 'OPTICAL', manual: 'MANUAL' };
const COMPOSERS = { every_line: 'ADOBEEVERYLINE', single_line: 'ADOBESINGLELINE' };
const LANGUAGES = {
    english_usa: 'ENGLISHUSA', english_uk: 'ENGLISHUK', french: 'FRENCH', canadian_french: 'CANADIANFRENCH', german: 'GERMAN',
    old_german: 'OLDGERMAN', swiss_german: 'SWISSGERMAN', italian: 'ITALIAN', spanish: 'SPANISH', portuguese: 'PORTUGUESE',
    brazilian_portuguese: 'BRAZILLIANPORTUGUESE', dutch: 'DUTCH', danish: 'DANISH', finnish: 'FINNISH', norwegian: 'NORWEGIAN',
    nynorsk_norwegian: 'NYNORSKNORWEGIAN', swedish: 'SWEDISH',
};
const SELECTION_COMBINE = { replace: 'REPLACE', add: 'EXTEND', subtract: 'DIMINISH', intersect: 'INTERSECT' };

/** Minimum, desired and maximum percentages for one Justification dialog row. */
const spacingSchema = (what, min, max) => ({
    type: 'object',
    description: `${what}: percentages from ${min} to ${max}, minimum <= desired <= maximum`,
    properties: {
        minimum: { type: 'number', minimum: min, maximum: max, description: 'Minimum percent' },
        desired: { type: 'number', minimum: min, maximum: max, description: 'Desired percent' },
        maximum: { type: 'number', minimum: min, maximum: max, description: 'Maximum percent' },
    },
});

const TYPE_OPTIONS = {
    antiAlias: { type: 'string', enum: Object.keys(ANTI_ALIAS), description: 'Anti-aliasing method (Type > Anti-Alias)' },
    orientation: { type: 'string', enum: Object.keys(DIRECTIONS), description: 'Text orientation (Type > Orientation): vertical gives vertical type' },
    warpOrientation: { type: 'string', enum: Object.keys(DIRECTIONS), description: 'Orientation of the warp (Warp Text dialog)' },
    kerning: { type: 'string', enum: Object.keys(KERNING), description: 'Kerning (Character panel): metrics, optical or manual' },
    language: { type: 'string', enum: Object.keys(LANGUAGES), description: 'Language for hyphenation and spelling (Character panel)' },
    noBreak: { type: 'boolean', description: 'No Break: keep words from breaking at line ends (Character panel menu)' },
    ligatures: { type: 'boolean', description: 'OpenType Standard Ligatures (Character panel)' },
    discretionaryLigatures: { type: 'boolean', description: 'OpenType Discretionary Ligatures (Character panel)' },
    oldStyle: { type: 'boolean', description: 'OpenType Oldstyle figures (Character panel)' },
    boxWidth: { type: 'number', minimum: 1, maximum: 300000, description: 'Paragraph type: bounding box width in pixels' },
    boxHeight: { type: 'number', minimum: 1, maximum: 300000, description: 'Paragraph type: bounding box height in pixels' },
    leftIndent: { type: 'number', minimum: -5000, maximum: 5000, description: 'Indent left margin in pixels (Paragraph panel)' },
    rightIndent: { type: 'number', minimum: -5000, maximum: 5000, description: 'Indent right margin in pixels (Paragraph panel)' },
    firstLineIndent: { type: 'number', minimum: -5000, maximum: 5000, description: 'Indent first line in pixels (Paragraph panel)' },
    spaceBefore: { type: 'number', minimum: -5000, maximum: 5000, description: 'Add space before paragraph, pixels (Paragraph panel)' },
    spaceAfter: { type: 'number', minimum: -5000, maximum: 5000, description: 'Add space after paragraph, pixels (Paragraph panel)' },
    hyphenate: { type: 'boolean', description: 'Hyphenate (Paragraph panel)' },
    hyphenation: {
        type: 'object',
        description: 'Hyphenation dialog (Paragraph panel menu > Hyphenation)',
        properties: {
            wordsLongerThan: { type: 'integer', minimum: 2, maximum: 25, description: 'Only hyphenate words with at least this many letters' },
            afterFirst: { type: 'integer', minimum: 1, maximum: 15, description: 'Letters before a hyphen' },
            beforeLast: { type: 'integer', minimum: 1, maximum: 15, description: 'Letters after a hyphen' },
            limit: { type: 'integer', minimum: 0, maximum: 25, description: 'Most consecutive hyphenated lines; 0 for no limit' },
            zone: { type: 'number', minimum: 0, maximum: 10000, description: 'Hyphenation zone in pixels (Single-line Composer only)' },
            capitalizedWords: { type: 'boolean', description: 'Hyphenate capitalized words' },
        },
    },
    justificationSpacing: {
        type: 'object',
        description: 'Justification dialog (Paragraph panel menu > Justification)',
        properties: {
            wordSpacing: spacingSchema('Word spacing', 0, 1000),
            letterSpacing: spacingSchema('Letter spacing', -100, 500),
            glyphScaling: spacingSchema('Glyph scaling', 50, 200),
            autoLeading: { type: 'number', minimum: 0, maximum: 500, description: 'Auto leading, percent of the type size' },
        },
    },
    hangingPunctuation: { type: 'boolean', description: 'Roman Hanging Punctuation (Paragraph panel menu)' },
    composer: { type: 'string', enum: Object.keys(COMPOSERS), description: 'Adobe Every-line or Single-line Composer (Paragraph panel menu)' },
};

const SPACING = { wordSpacing: ['Word', 0, 1000], letterSpacing: ['Letter', -100, 500], glyphScaling: ['Glyph', 50, 200] };

/** Statements that apply TYPE_OPTIONS to TextItem `t` of layer `l`. */
function typeOptionLines(a) {
    const lines = [];
    const px = (v, name, min = -5000, max = 5000) => `new UnitValue(${num(v, { min, max, name })}, "px")`;
    const pick = (v, table, name) => table[enumOf(v, Object.keys(table), { name })];
    if (a.orientation !== undefined) lines.push(`t.direction = Direction.${pick(a.orientation, DIRECTIONS, 'orientation')};`);
    if (a.warpOrientation !== undefined) lines.push(`t.warpDirection = Direction.${pick(a.warpOrientation, DIRECTIONS, 'warpOrientation')};`);
    if (a.antiAlias !== undefined) lines.push(`t.antiAliasMethod = AntiAlias.${pick(a.antiAlias, ANTI_ALIAS, 'antiAlias')};`);
    if (a.kerning !== undefined) lines.push(`t.autoKerning = AutoKernType.${pick(a.kerning, KERNING, 'kerning')};`);
    if (a.language !== undefined) lines.push(`t.language = Language.${pick(a.language, LANGUAGES, 'language')};`);
    if (a.noBreak !== undefined) lines.push(`t.noBreak = ${bool(a.noBreak)};`);
    if (a.ligatures !== undefined) lines.push(`t.ligatures = ${bool(a.ligatures)};`);
    if (a.discretionaryLigatures !== undefined) lines.push(`t.alternateLigatures = ${bool(a.discretionaryLigatures)};`);
    if (a.oldStyle !== undefined) lines.push(`t.oldStyle = ${bool(a.oldStyle)};`);
    if (a.boxWidth !== undefined || a.boxHeight !== undefined) {
        lines.push('if (t.kind !== TextType.PARAGRAPHTEXT) throw new Error(l.name + " is point type: convert it to paragraph type first (convert_type_layer)");');
        if (a.boxWidth !== undefined) lines.push(`t.width = ${px(a.boxWidth, 'boxWidth', 1, 300000)};`);
        if (a.boxHeight !== undefined) lines.push(`t.height = ${px(a.boxHeight, 'boxHeight', 1, 300000)};`);
    }
    for (const k of ['leftIndent', 'rightIndent', 'firstLineIndent', 'spaceBefore', 'spaceAfter']) {
        if (a[k] !== undefined) lines.push(`t.${k} = ${px(a[k], k)};`);
    }
    if (a.hyphenate !== undefined) lines.push(`t.hyphenation = ${bool(a.hyphenate)};`);
    const h = a.hyphenation;
    if (h !== undefined) {
        if (!h || typeof h !== 'object') throw new Error("'hyphenation' must be an object");
        if (h.wordsLongerThan !== undefined) lines.push(`t.hyphenateWordsLongerThan = ${num(h.wordsLongerThan, { min: 2, max: 25, name: 'hyphenation.wordsLongerThan' })};`);
        if (h.afterFirst !== undefined) lines.push(`t.hyphenateAfterFirst = ${num(h.afterFirst, { min: 1, max: 15, name: 'hyphenation.afterFirst' })};`);
        if (h.beforeLast !== undefined) lines.push(`t.hyphenateBeforeLast = ${num(h.beforeLast, { min: 1, max: 15, name: 'hyphenation.beforeLast' })};`);
        if (h.limit !== undefined) lines.push(`t.hyphenLimit = ${num(h.limit, { min: 0, max: 25, name: 'hyphenation.limit' })};`);
        if (h.zone !== undefined) lines.push(`t.hyphenationZone = ${px(h.zone, 'hyphenation.zone', 0, 10000)};`);
        if (h.capitalizedWords !== undefined) lines.push(`t.hyphenateCapitalWords = ${bool(h.capitalizedWords)};`);
    }
    const j = a.justificationSpacing;
    if (j !== undefined) {
        if (!j || typeof j !== 'object') throw new Error("'justificationSpacing' must be an object");
        for (const [key, [member, min, max]] of Object.entries(SPACING)) {
            const row = j[key];
            if (row === undefined) continue;
            const v = {};
            for (const part of ['minimum', 'desired', 'maximum']) {
                if (row[part] !== undefined) v[part] = Number(num(row[part], { min, max, name: `justificationSpacing.${key}.${part}` }));
            }
            if ((v.minimum ?? -Infinity) > (v.desired ?? v.maximum ?? Infinity) || (v.desired ?? -Infinity) > (v.maximum ?? Infinity)) {
                throw new Error(`'justificationSpacing.${key}' needs minimum <= desired <= maximum`);
            }
            const parts = Object.keys(v);
            if (parts.length) lines.push(`__setScaling(t, ${json(parts.map((p) => `${p}${member}Scaling`))}, ${json(parts.map((p) => v[p]))});`);
        }
        if (j.autoLeading !== undefined) lines.push(`t.autoLeadingAmount = ${num(j.autoLeading, { min: 0, max: 500, name: 'justificationSpacing.autoLeading' })};`);
    }
    if (a.hangingPunctuation !== undefined) lines.push(`t.hangingPuntuation = ${bool(a.hangingPunctuation)};`);
    if (a.composer !== undefined) lines.push(`t.textComposer = TextComposer.${pick(a.composer, COMPOSERS, 'composer')};`);
    return lines;
}

/** Type menu commands that run without a dialog, by their Action Manager event. */
const TYPE_COMMANDS = {
    update_all_text_layers: 'updateLayouts',
    replace_all_missing_fonts: 'replaceSubstitutes',
    save_default_type_styles: 'textSaveDefaultTypeStyles',
    load_default_type_styles: 'textLoadDefaultTypeStyles',
};

/** Window menu items that show or hide the type panels. */
const TYPE_PANELS = {
    character: 'toggleCharacterPalette',
    paragraph: 'toggleParagraphPalette',
    character_styles: 'toggleCharacterStylesPalette',
    paragraph_styles: 'toggleParagraphStylesPalette',
};

/**
 * Sets related Justification values (minimum, desired, maximum) in passes, so
 * an order that briefly puts minimum above maximum does not stick.
 */
const SET_SCALING = `
var __setScaling = function (t, names, values) {
  for (var pass = 0; pass < 3; pass++) {
    var done = true;
    for (var k = 0; k < names.length; k++) {
      try { t[names[k]] = values[k]; } catch (e) {}
      if (Math.abs(t[names[k]] - values[k]) > 0.01) done = false;
    }
    if (done) return;
  }
  throw new Error("Photoshop did not accept " + names.join(", ") + " = " + values.join(", "));
};`;

/** Fails unless `l` is a type layer. */
const NEED_TYPE = 'if (l.typename !== "ArtLayer" || l.kind !== LayerKind.TEXT) throw new Error(l.name + " is not a type layer");';

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
        features: ['photoshop.type.type_layer', 'photoshop.type.horizontal_type_tool', 'photoshop.type.insert_emoji', 'photoshop.type.point_type', 'photoshop.type.paragraph_type', 'photoshop.type.font', 'photoshop.type.font_size', 'photoshop.type.text_color', 'photoshop.type.tracking', 'photoshop.type.leading', 'photoshop.type.paragraph_alignment', 'photoshop.type.paragraph_justification', 'photoshop.type.faux_bold', 'photoshop.type.faux_italic', 'photoshop.type.all_caps_small_caps', 'photoshop.type.underline', 'photoshop.type.strikethrough', 'photoshop.type.baseline_shift', 'photoshop.type.horizontal_scale', 'photoshop.type.vertical_scale'],
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
        features: ['photoshop.type.type_layer', 'photoshop.type.insert_emoji', 'photoshop.type.copy_paste_text', 'photoshop.type.change_font_multiple_layers', 'photoshop.type.font', 'photoshop.type.font_size', 'photoshop.type.text_color', 'photoshop.type.tracking', 'photoshop.type.leading', 'photoshop.type.paragraph_alignment', 'photoshop.type.paragraph_justification', 'photoshop.type.faux_bold', 'photoshop.type.faux_italic', 'photoshop.type.all_caps_small_caps', 'photoshop.type.underline', 'photoshop.type.strikethrough', 'photoshop.type.baseline_shift', 'photoshop.type.horizontal_scale', 'photoshop.type.vertical_scale', 'photoshop.type.warp_text', 'photoshop.type.warp_style_arc', 'photoshop.type.warp_style_arclower', 'photoshop.type.warp_style_arcupper', 'photoshop.type.warp_style_arch', 'photoshop.type.warp_style_bulge', 'photoshop.type.warp_style_shelllower', 'photoshop.type.warp_style_shellupper', 'photoshop.type.warp_style_flag', 'photoshop.type.warp_style_wave', 'photoshop.type.warp_style_fish', 'photoshop.type.warp_style_rise', 'photoshop.type.warp_style_fisheye', 'photoshop.type.warp_style_inflate', 'photoshop.type.warp_style_squeeze', 'photoshop.type.warp_style_twist', 'photoshop.type.warp_bend', 'photoshop.type.warp_horizontal_distortion', 'photoshop.type.warp_vertical_distortion', 'photoshop.type.unwarp_text'],
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
    {
        name: 'set_type_options',
        description: 'Set Character and Paragraph panel options on type layers: anti-aliasing, text and warp orientation (vertical type), kerning, language, No Break, OpenType ligatures and oldstyle figures, the paragraph type box size, indents, paragraph spacing, hyphenation, justification spacing, hanging punctuation and the composer',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, ...TYPE_OPTIONS },
            required: ['target'],
        },
        hints: { idempotent: true },
        auditArgs: {
            hyphenation: { wordsLongerThan: 6, afterFirst: 2, beforeLast: 2, limit: 2, zone: 36, capitalizedWords: false },
            justificationSpacing: { wordSpacing: { minimum: 80, desired: 100, maximum: 133 }, letterSpacing: { minimum: 0, desired: 0, maximum: 0 }, glyphScaling: { minimum: 100, desired: 100, maximum: 100 }, autoLeading: 120 },
        },
        features: ['photoshop.type.vertical_type_tool', 'photoshop.type.transform_type_bounding_box', 'photoshop.type.warp_orientation', 'photoshop.type.text_orientation', 'photoshop.type.anti_aliasing', 'photoshop.type.kerning', 'photoshop.type.language', 'photoshop.type.no_break', 'photoshop.type.opentype_standard_ligatures', 'photoshop.type.opentype_discretionary_ligatures', 'photoshop.type.opentype_old_style', 'photoshop.type.indent_left', 'photoshop.type.indent_right', 'photoshop.type.indent_first_line', 'photoshop.type.space_before_paragraph', 'photoshop.type.space_after_paragraph', 'photoshop.type.hyphenate', 'photoshop.type.hyphenation_options', 'photoshop.type.justification_settings', 'photoshop.type.roman_hanging_punctuation', 'photoshop.type.composer'],
        handler: (a) => {
            const lines = typeOptionLines(a);
            if (!lines.length) throw new Error('Give at least one option to set');
            return run('Set type options', script(`${SET_SCALING}
var items = __targets(doc, ${targetSpec(a.target)}), l;
for (var i = 0; i < items.length; i++) {
  l = items[i];
  ${NEED_TYPE}
  var t = l.textItem;
  ${lines.join('\n  ')}
}
${TEXT_RESULT}`));
        },
    },
    {
        name: 'convert_type_layer',
        description: 'Convert type layers (Type menu): to paragraph or point type, to a shape layer (Convert to Shape), to a work path (Create Work Path, which replaces the current work path), or to a selection shaped like the text, as the Type Mask tools make',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                to: { type: 'string', enum: ['paragraph', 'point', 'shape', 'work_path', 'selection'], description: 'What to convert the type into' },
                combine: { type: 'string', enum: Object.keys(SELECTION_COMBINE), description: 'selection: how the text outline combines with the current selection. Default replace' },
                removeLayer: { type: 'boolean', description: 'selection: delete the type layers afterwards, leaving only the selection (as the Type Mask tools do). Default false' },
            },
            required: ['target', 'to'],
        },
        hints: { destructive: true },
        auditArgs: { to: 'selection', combine: 'add' },
        features: ['photoshop.type.convert_point_paragraph', 'photoshop.type.create_work_path_from_type', 'photoshop.type.convert_type_to_shape', 'photoshop.type.horizontal_type_mask_tool', 'photoshop.type.vertical_type_mask_tool'],
        handler: (a) => {
            const to = enumOf(a.to, ['paragraph', 'point', 'shape', 'work_path', 'selection'], { name: 'to' });
            if (to !== 'selection' && (a.combine !== undefined || a.removeLayer !== undefined)) throw new Error('combine and removeLayer apply only to: selection');
            const first = `SelectionType.${SELECTION_COMBINE[enumOf(a.combine ?? 'replace', Object.keys(SELECTION_COMBINE), { name: 'combine' })]}`;
            const step = {
                paragraph: 'l.textItem.kind = TextType.PARAGRAPHTEXT; out.push(__layerInfo(l));',
                point: 'l.textItem.kind = TextType.POINTTEXT; out.push(__layerInfo(l));',
                shape: 'l.textItem.convertToShape(); out.push(__layerInfo(doc.activeLayer));',
                work_path: 'l.textItem.createPath(); var wp = __workPath(); out.push({ path: wp.name, kind: __enumName(wp.kind), subpaths: wp.subPathItems.length });',
                selection: `l.textItem.createPath(); var wp = __workPath();
  wp.makeSelection(0, true, i === 0 ? ${first} : SelectionType.EXTEND);
  wp.remove();
  out.push({ id: l.id, name: l.name });
  ${a.removeLayer ? 'l.remove();' : ''}`,
            }[to];
            return run('Convert type layer', script(`
var __workPath = function () {
  for (var k = 0; k < doc.pathItems.length; k++) if (doc.pathItems[k].kind === PathKind.WORKPATH) return doc.pathItems[k];
  throw new Error("Photoshop made no work path from the type (fonts without outlines cannot be converted)");
};
var items = __targets(doc, ${targetSpec(a.target)}), out = [], l;
${to === 'work_path' ? 'if (items.length !== 1) throw new Error("A document has one work path: convert one type layer at a time");' : ''}
for (var i = 0; i < items.length; i++) {
  l = items[i];
  ${NEED_TYPE}
}
for (var i = 0; i < items.length; i++) {
  l = items[i];
  doc.activeLayer = l;
  ${step}
}
__result__ = { converted: out${to === 'selection' ? ', selection: (function () { try { return __bounds({ bounds: doc.selection.bounds }); } catch (e) { return null; } })()' : ''} };`));
        },
    },
    {
        name: 'find_replace_layer_text',
        description: 'Find and replace text in type layers (Edit > Find and Replace Text), keeping each layer\'s formatting. Searches every visible, unlocked type layer, or one layer. Line breaks in the replacement start new paragraphs',
        inputSchema: {
            type: 'object',
            properties: {
                find: { type: 'string', minLength: 1, description: 'Text to find' },
                replace: { type: 'string', description: 'Replacement text; empty deletes the matches' },
                target: { ...TARGET_SCHEMA, description: 'Search only this type layer instead of all of them (one layer)' },
                caseSensitive: { type: 'boolean', description: 'Match case. Default false' },
                wholeWord: { type: 'boolean', description: 'Whole words only. Default false' },
                ignoreAccents: { type: 'boolean', description: 'Ignore accents. Default false' },
            },
            required: ['find', 'replace'],
        },
        auditArgs: { target: undefined },
        features: ['photoshop.type.find_replace_text'],
        handler: (a) => {
            if (typeof a.find !== 'string' || !a.find.length) throw new Error("'find' must be non-empty text");
            if (typeof a.replace !== 'string') throw new Error("'replace' must be text (empty to delete)");
            const one = a.target !== undefined;
            const sID = (s) => `app.stringIDToTypeID("${s}")`;
            return run('Find and replace text', script(`
var layers = [], before = [], prev = doc.activeLayer, l;
__eachLayer(doc, function (x) { if (x.typename === "ArtLayer" && x.kind === LayerKind.TEXT) { layers.push(x); before.push(x.textItem.contents); } });
if (!layers.length) throw new Error("The document has no type layers");
${one ? `var hits = __targets(doc, ${targetSpec(a.target)});
if (hits.length !== 1) throw new Error("Give one type layer to search");
l = hits[0];
${NEED_TYPE}
doc.activeLayer = l;` : 'if (prev.typename !== "ArtLayer" || prev.kind !== LayerKind.TEXT) doc.activeLayer = layers[0];'}
var d = new ActionDescriptor(), r = new ActionReference(), o = new ActionDescriptor();
r.putProperty(${sID('property')}, ${sID('findReplace')});
r.putEnumerated(${sID('textLayer')}, ${sID('ordinal')}, ${sID('targetEnum')});
d.putReference(${sID('target')}, r);
o.putString(${sID('find')}, ${textLiteral(a.find)});
o.putString(${sID('replace')}, ${textLiteral(a.replace)});
o.putBoolean(${sID('checkAll')}, ${bool(!one)});
o.putBoolean(${sID('forward')}, true);
o.putBoolean(${sID('caseSensitive')}, ${bool(a.caseSensitive)});
o.putBoolean(${sID('wholeWord')}, ${bool(a.wholeWord)});
o.putBoolean(${sID('ignoreAccents')}, ${bool(a.ignoreAccents)});
d.putObject(${sID('using')}, ${sID('findReplace')}, o);
app.executeAction(${sID('findReplace')}, d, DialogModes.NO);
${one ? '' : 'try { doc.activeLayer = prev; } catch (e) {}'}
var changed = [];
for (var i = 0; i < layers.length; i++) if (layers[i].textItem.contents !== before[i]) changed.push({ id: layers[i].id, name: layers[i].name, text: layers[i].textItem.contents });
__result__ = { changedLayers: changed.length, layers: changed };`));
        },
    },
    {
        name: 'run_type_menu_command',
        description: 'Run a Type menu command: Update All Text Layers (also updates legacy and Asian text layers for vector output), Replace All Missing Fonts, Save Default Type Styles or Load Default Type Styles',
        inputSchema: {
            type: 'object',
            properties: { command: { type: 'string', enum: Object.keys(TYPE_COMMANDS), description: 'The Type menu command' } },
            required: ['command'],
        },
        features: ['photoshop.type.update_all_text_layers', 'photoshop.type.update_cjk_text_layers', 'photoshop.type.replace_all_missing_fonts', 'photoshop.type.save_default_type_styles', 'photoshop.type.load_default_type_styles'],
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(TYPE_COMMANDS), { name: 'command' });
            return run('Type menu command', script(`
app.executeAction(app.stringIDToTypeID(${str(TYPE_COMMANDS[command])}), new ActionDescriptor(), DialogModes.NO);
__result__ = { command: ${str(command)}, document: __docInfo(doc) };`));
        },
    },
    {
        name: 'fill_type_with_image',
        description: 'Fill type with an image: move an image layer directly above a type layer and clip it to the type (Layer > Create Clipping Mask), so the image shows only through the letters',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The type layer (one layer)' },
                image: { ...TARGET_SCHEMA, description: 'The image layer to show through the type (one pixel or smart object layer)' },
            },
            required: ['target', 'image'],
        },
        hints: { idempotent: true },
        auditArgs: { target: { ids: [3] }, image: { ids: [4] } },
        features: ['photoshop.type.fill_type_with_image'],
        handler: (a) => run('Fill type with image', script(`
var tl = __targets(doc, ${targetSpec(a.target)}), im = __targets(doc, ${targetSpec(a.image)}), l;
if (tl.length !== 1 || im.length !== 1) throw new Error("Give one type layer and one image layer");
l = tl[0]; im = im[0];
${NEED_TYPE}
if (im.typename !== "ArtLayer") throw new Error(im.name + " is a group: give a single image layer");
if (im.id === l.id) throw new Error("The image layer must differ from the type layer");
if (im.isBackgroundLayer) throw new Error("The background layer cannot be clipped: convert it first (convert_background_layer)");
im.move(l, ElementPlacement.PLACEBEFORE);
im.grouped = true;
__result__ = { type: __layerInfo(l), image: __layerInfo(im) };`)),
    },
    {
        name: 'toggle_type_panels',
        description: 'Show or hide a type panel (Window > Character, Paragraph, Character Styles or Paragraph Styles). Each call switches the panel between shown and hidden',
        inputSchema: {
            type: 'object',
            properties: { panel: { type: 'string', enum: Object.keys(TYPE_PANELS), description: 'The panel to show or hide' } },
            required: ['panel'],
        },
        features: ['photoshop.type.character_panel', 'photoshop.type.paragraph_panel', 'photoshop.type.character_styles_panel', 'photoshop.type.paragraph_styles_panel'],
        handler: (a) => {
            const panel = enumOf(a.panel, Object.keys(TYPE_PANELS), { name: 'panel' });
            return run('Toggle type panel', script(`
app.runMenuItem(app.stringIDToTypeID(${str(TYPE_PANELS[panel])}));
__result__ = { toggled: ${str(panel)} };`, { needsDocument: false }));
        },
    },
];
