/**
 * Typography: the Character, OpenType, Paragraph and Tabs panels, character and
 * paragraph styles, Area Type Options and threaded text.
 *
 * Formatting tools act on whole text frames, on a character range of each frame
 * (range: { start, length }) or on some of its paragraphs (paragraphs:
 * { start, length }). When text is selected with the Type tool, target:
 * { selection: true } acts on that text instead of on whole frames.
 *
 * Area Type Options, Hyphenation and Justification open dialogs; their settings
 * are TextFrame and ParagraphAttributes members, so they are set directly.
 * Font Size Step Up and Down, Fit Headline, and Release Selection and Remove
 * Threading open no dialog and run as menu commands on the targets.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { paths } from './documents.js';

const JUSTIFICATION = ['LEFT', 'CENTER', 'RIGHT', 'FULLJUSTIFY', 'FULLJUSTIFYLASTLINELEFT', 'FULLJUSTIFYLASTLINECENTER', 'FULLJUSTIFYLASTLINERIGHT'];

const LANGUAGES = [
    'ENGLISH', 'UKENGLISH', 'FINNISH', 'STANDARDFRENCH', 'CANADIANFRENCH', 'STANDARDGERMAN', 'OLDGERMAN', 'GERMAN2006REFORM',
    'SWISSGERMAN', 'SWISSGERMAN2006REFORM', 'ITALIAN', 'BOKMALNORWEGIAN', 'NYNORSKNORWEGIAN', 'STANDARDPORTUGUESE',
    'BRAZILLIANPORTUGUESE', 'SPANISH', 'SWEDISH', 'DANISH', 'DUTCH', 'DUTCH2005REFORM', 'CATALAN', 'RUSSIAN', 'UKRANIAN',
    'BULGARIAN', 'SERBIAN', 'CZECH', 'POLISH', 'RUMANIAN', 'GREEK', 'TURKISH', 'ICELANDIC', 'HUNGARIAN', 'CHINESE',
    'JAPANESE', 'ARABIC', 'FARSI', 'HINDI', 'MARATHI', 'BENGALIINDIA', 'PUNJABI', 'GUJARATI', 'ORIYA', 'TAMIL', 'TELUGU',
    'KANNADA', 'MALAYALAM',
];

/*
 * Attribute tables. Each entry maps a caller key to an object-model member:
 *   bool / num: assigned as given; enum: a caller word mapped to a member of `type`;
 *   group: { minimum, desired, maximum } mapped to three members.
 */
const CHARACTER = {
    size: { member: 'size', kind: 'num', min: 0.1, max: 1296, description: 'Font size in points' },
    leading: { member: 'leading', kind: 'num', min: 0, max: 5000, description: 'Leading in points (turns off auto leading)' },
    autoLeading: { member: 'autoLeading', kind: 'bool', description: 'Auto leading' },
    tracking: { member: 'tracking', kind: 'num', min: -1000, max: 10000, description: 'Tracking in thousandths of an em' },
    kerningMethod: {
        member: 'kerningMethod', kind: 'enum', type: 'AutoKernType', description: 'Automatic kerning: Metrics (metrics), Optical, Metrics - Roman Only, or none (0)',
        values: { metrics: 'AUTO', optical: 'OPTICAL', metrics_roman_only: 'METRICSROMANONLY', none: 'NOAUTOKERN' },
    },
    horizontalScale: { member: 'horizontalScale', kind: 'num', min: 1, max: 10000, description: 'Horizontal scale, percent (100 = normal)' },
    verticalScale: { member: 'verticalScale', kind: 'num', min: 1, max: 10000, description: 'Vertical scale, percent (100 = normal)' },
    baselineShift: { member: 'baselineShift', kind: 'num', min: -5000, max: 5000, description: 'Baseline shift in points (positive raises)' },
    rotation: { member: 'rotation', kind: 'num', min: -360, max: 360, description: 'Character rotation in degrees' },
    language: { member: 'language', kind: 'enum', type: 'LanguageType', values: Object.fromEntries(LANGUAGES.map((l) => [l, l])), description: 'Language for spelling and hyphenation' },
    capitalization: {
        member: 'capitalization', kind: 'enum', type: 'FontCapsOption', description: 'All Caps / Small Caps',
        values: { normal: 'NORMALCAPS', all_caps: 'ALLCAPS', small_caps: 'SMALLCAPS', all_small_caps: 'ALLSMALLCAPS' },
    },
    position: {
        member: 'baselinePosition', kind: 'enum', type: 'FontBaselineOption', description: 'Superscript / Subscript',
        values: { normal: 'NORMALBASELINE', superscript: 'SUPERSCRIPT', subscript: 'SUBSCRIPT' },
    },
    underline: { member: 'underline', kind: 'bool' },
    strikethrough: { member: 'strikeThrough', kind: 'bool' },
    color: { member: 'fillColor', kind: 'color', description: `Fill colour. ${COLOR_SCHEMA.description}` },
    strokeColor: { member: 'strokeColor', kind: 'color', description: `Character stroke colour. ${COLOR_SCHEMA.description}` },
    strokeWeight: { member: 'strokeWeight', kind: 'num', min: 0, max: 1000, description: 'Character stroke weight in points' },
    noBreak: { member: 'noBreak', kind: 'bool', description: 'No Break: keep these characters on one line' },
    overprintFill: { member: 'overprintFill', kind: 'bool' },
    overprintStroke: { member: 'overprintStroke', kind: 'bool' },
    syntheticItalics: { member: 'italics', kind: 'bool', description: 'Synthetic italics (slants Japanese OpenType characters)' },
    // OpenType panel
    ligatures: { member: 'ligature', kind: 'bool', description: 'Standard Ligatures' },
    contextualAlternates: { member: 'contextualLigature', kind: 'bool' },
    discretionaryLigatures: { member: 'discretionaryLigature', kind: 'bool' },
    swash: { member: 'swash', kind: 'bool' },
    stylisticAlternates: { member: 'stylisticAlternates', kind: 'bool' },
    titlingAlternates: { member: 'titling', kind: 'bool' },
    ordinals: { member: 'ordinals', kind: 'bool' },
    fractions: { member: 'fractions', kind: 'bool' },
    ornaments: { member: 'ornaments', kind: 'bool' },
    proportionalMetrics: { member: 'proportionalMetrics', kind: 'bool', description: 'Proportional metrics (Asian OpenType fonts)' },
    connectionForms: { member: 'connectionForms', kind: 'bool', description: 'Connection forms (Arabic and other joining scripts)' },
    figureStyle: {
        member: 'figureStyle', kind: 'enum', type: 'FigureStyleType', description: 'OpenType figure style',
        values: { default: 'DEFAULTFIGURESTYLE', tabular_lining: 'TABULAR', proportional_lining: 'PROPORTIONAL', proportional_oldstyle: 'PROPORTIONALOLDSTYLE', tabular_oldstyle: 'TABULAROLDSTYLE' },
    },
    openTypePosition: {
        member: 'openTypePosition', kind: 'enum', type: 'FontOpenTypePositionOption', description: 'OpenType position: superior, inferior, numerator or denominator glyphs',
        values: { default: 'OPENTYPEDEFAULT', superscript: 'OPENTYPESUPERSCRIPT', subscript: 'OPENTYPESUBSCRIPT', numerator: 'NUMERATOR', denominator: 'DENOMINATOR' },
    },
    alternateGlyphs: {
        member: 'alternateGlyphs', kind: 'enum', type: 'AlternateGlyphsForm', description: 'Alternate glyph forms (Asian OpenType fonts)',
        values: {
            default: 'DEFAULTFORM', traditional: 'TRADITIONAL', expert: 'EXPERT', jis78: 'JIS78FORM', jis83: 'JIS83FORM', jis90: 'JIS90FORM', jis04: 'JIS04FORM',
            full_width: 'FULLWIDTH', half_width: 'HALFWIDTH', third_width: 'THIRDWIDTH', quarter_width: 'QUARTERWIDTH', proportional_width: 'PROPORTIONALWIDTH',
        },
    },
    kashidas: { member: 'kashidas', kind: 'enum', type: 'KashidasType', values: { default: 'DEFAULT_KASHIDAS', on: 'KASHIDAS_ON', off: 'KASHIDAS_OFF' }, description: 'Kashida insertion for Arabic justification' },
    // CJK options
    tsume: { member: 'Tsume', kind: 'num', min: 0, max: 100, description: 'Tsume: percent of space removed around Japanese characters' },
    insertSpaceLeft: { member: 'akiLeft', kind: 'num', min: 0, max: 10, description: 'Insert Space (Left), in ems' },
    insertSpaceRight: { member: 'akiRight', kind: 'num', min: 0, max: 10, description: 'Insert Space (Right), in ems' },
    tateChuYokoHorizontal: { member: 'tateChuYokoHorizontal', kind: 'num', min: -1000, max: 1000, description: 'Tate-chu-yoko horizontal offset in points' },
    tateChuYokoVertical: { member: 'tateChuYokoVertical', kind: 'num', min: -1000, max: 1000, description: 'Tate-chu-yoko vertical offset in points' },
    warichu: { member: 'wariChuEnabled', kind: 'bool', description: 'Warichu: set the characters as inline notes' },
    warichuLines: { member: 'wariChuLines', kind: 'int', min: 1, max: 100, description: 'Warichu lines' },
    warichuScale: { member: 'wariChuScale', kind: 'num', min: 1, max: 1000, description: 'Warichu scale, percent' },
    warichuLineGap: { member: 'wariChuLineGap', kind: 'num', min: -1000, max: 1000, description: 'Warichu line gap in points' },
    warichuCharactersBeforeBreak: { member: 'wariChuCharactersBeforeBreak', kind: 'int', min: 1, max: 100 },
    warichuCharactersAfterBreak: { member: 'wariChuCharactersAfterBreak', kind: 'int', min: 1, max: 100 },
    warichuJustification: {
        member: 'wariChuJustification', kind: 'enum', type: 'WariChuJustificationType', description: 'Warichu justification',
        values: {
            auto: 'WARICHUAUTOJUSTIFY', left: 'Left', center: 'Center', right: 'Right', full_justify: 'WARICHUFULLJUSTIFY',
            full_justify_last_left: 'WARICHUFULLJUSTIFYLASTLINELEFT', full_justify_last_center: 'WARICHUFULLJUSTIFYLASTLINECENTER', full_justify_last_right: 'WARICHUFULLJUSTIFYLASTLINERIGHT',
        },
    },
    baselineDirection: {
        member: 'baselineDirection', kind: 'enum', type: 'BaselineDirectionType', description: 'Characters in vertical text: standard, tate-chu-yoko or rotated',
        values: { standard: 'Standard', tate_chu_yoko: 'TateChuYoko', vertical_rotated: 'VerticalRotated' },
    },
    characterAlignment: {
        member: 'alignment', kind: 'enum', type: 'StyleRunAlignmentType', description: 'Character alignment of mixed sizes in a line',
        values: { roman_baseline: 'ROMANBASELINE', em_box_top: 'top', em_box_center: 'center', em_box_bottom: 'bottom', icf_top: 'icfTop', icf_bottom: 'icfBottom' },
    },
};

const PARAGRAPH = {
    justification: { member: 'justification', kind: 'enum', type: 'Justification', values: Object.fromEntries(JUSTIFICATION.map((j) => [j, j])) },
    leftIndent: { member: 'leftIndent', kind: 'num', min: -5000, max: 5000, description: 'Left indent in points' },
    rightIndent: { member: 'rightIndent', kind: 'num', min: -5000, max: 5000, description: 'Right indent in points' },
    firstLineIndent: { member: 'firstLineIndent', kind: 'num', min: -5000, max: 5000, description: 'First-line left indent in points' },
    spaceBefore: { member: 'spaceBefore', kind: 'num', min: -5000, max: 5000, description: 'Space before the paragraph in points' },
    spaceAfter: { member: 'spaceAfter', kind: 'num', min: -5000, max: 5000, description: 'Space after the paragraph in points' },
    hyphenate: { member: 'hyphenation', kind: 'bool', description: 'Automatic hyphenation' },
    wordsLongerThan: { member: 'minimumHyphenatedWordSize', kind: 'int', min: 1, max: 100, description: 'Hyphenate words longer than this many letters' },
    afterFirst: { member: 'minimumBeforeHyphen', kind: 'int', min: 1, max: 100, description: 'At least this many letters before a hyphen' },
    beforeLast: { member: 'minimumAfterHyphen', kind: 'int', min: 1, max: 100, description: 'At least this many letters after a hyphen' },
    hyphenLimit: { member: 'maximumConsecutiveHyphens', kind: 'int', min: 0, max: 100, description: 'Most consecutive hyphenated lines (0 = no limit)' },
    hyphenationZone: { member: 'hyphenationZone', kind: 'num', min: 0, max: 5000, description: 'Hyphenation zone in points' },
    hyphenateCapitalizedWords: { member: 'hyphenateCapitalizedWords', kind: 'bool' },
    hyphenationPreference: { member: 'hyphenationPreference', kind: 'num', min: 0, max: 1, description: 'Better Spacing (0) to Fewer Hyphens (1)' },
    wordSpacing: { kind: 'group', members: ['minimumWordSpacing', 'desiredWordSpacing', 'maximumWordSpacing'], min: 0, max: 1000, description: 'Justification word spacing, percent' },
    letterSpacing: { kind: 'group', members: ['minimumLetterSpacing', 'desiredLetterSpacing', 'maximumLetterSpacing'], min: -100, max: 500, description: 'Justification letter spacing, percent' },
    glyphScaling: { kind: 'group', members: ['minimumGlyphScaling', 'desiredGlyphScaling', 'maximumGlyphScaling'], min: 50, max: 200, description: 'Justification glyph scaling, percent' },
    autoLeadingAmount: { member: 'autoLeadingAmount', kind: 'num', min: 0, max: 500, description: 'Auto leading, percent of the font size' },
    singleWordJustification: {
        member: 'singleWordJustification', kind: 'enum', type: 'Justification', description: 'How a line holding a single word is justified',
        values: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', FULLJUSTIFY: 'FULLJUSTIFY' },
    },
    romanHangingPunctuation: { member: 'romanHanging', kind: 'bool' },
    leadingType: { member: 'leadingType', kind: 'enum', type: 'AutoLeadingType', values: { top_to_top: 'TOPTOTOP', bottom_to_bottom: 'BOTTOMTOBOTTOM' }, description: 'Leading measured top to top or bottom to bottom' },
    kinsoku: { member: 'kinsoku', kind: 'name', description: 'Kinsoku Shori set by name, e.g. "None", "Hard", "Soft"' },
    kinsokuType: { member: 'kinsokuOrder', kind: 'enum', type: 'KinsokuOrderEnum', values: { push_in: 'PUSHIN', push_out_first: 'PUSHOUTFIRST', push_out_only: 'PUSHOUTONLY' } },
    mojikumi: { member: 'mojikumi', kind: 'name', description: 'Mojikumi set by name' },
    burasagari: { member: 'burasagariType', kind: 'enum', type: 'BurasagariTypeEnum', values: { none: 'None', standard: 'Standard', forced: 'Forced' } },
    bunriKinshi: { member: 'bunriKinshi', kind: 'bool' },
    kurikaeshiMojiShori: { member: 'kurikaeshiMojiShori', kind: 'bool' },
    kashidaWidth: {
        member: 'kashidaWidth', kind: 'enum', type: 'KashidaWidthType', description: 'Kashida width for justified Arabic text',
        values: { none: 'kashidaNone', small: 'kashidaSmall', medium: 'kashidaMedium', long: 'kashidaLong', stylistic: 'kashidaStylistic' },
    },
};

/** Composer menu choices: every-line or single-line, Latin/CJK or Middle Eastern and South Asian (World-Ready). */
const COMPOSERS = ['single_line', 'every_line', 'middle_eastern_single_line', 'middle_eastern_every_line'];

/** JSON schema for one table entry. */
function entrySchema(e) {
    const d = e.description ? { description: e.description } : {};
    switch (e.kind) {
        case 'bool': return { type: 'boolean', ...d };
        case 'num': return { type: 'number', minimum: e.min, maximum: e.max, ...d };
        case 'int': return { type: 'integer', minimum: e.min, maximum: e.max, ...d };
        case 'enum': return { type: 'string', enum: Object.keys(e.values), ...d };
        case 'color': return { type: 'string', ...d };
        case 'name': return { type: 'string', ...d };
        case 'group': return {
            type: 'object', ...d,
            properties: { minimum: { type: 'number' }, desired: { type: 'number' }, maximum: { type: 'number' } },
        };
    }
    throw new Error(`unknown kind ${e.kind}`);
}

const schemaOf = (table) => Object.fromEntries(Object.entries(table).map(([k, e]) => [k, entrySchema(e)]));

const FONT_PROPS = {
    font: { type: 'string', description: 'PostScript font name, e.g. "MyriadPro-Regular" (see list_fonts)' },
};
const CHARACTER_PROPS = { ...FONT_PROPS, ...schemaOf(CHARACTER) };
const PARAGRAPH_PROPS = {
    ...schemaOf(PARAGRAPH),
    composer: { type: 'string', enum: COMPOSERS, description: 'Composer: Adobe Single-line or Every-line, or the Middle Eastern and South Asian ones' },
};

/** JSX statements setting the table's attributes from `a` on the attributes object `obj`. */
function tableStatements(table, a, obj) {
    const out = [];
    for (const [key, e] of Object.entries(table)) {
        const v = a[key];
        if (v === undefined || v === null) continue;
        switch (e.kind) {
            case 'bool': out.push(`${obj}.${e.member} = ${bool(v)};`); break;
            case 'num': out.push(`${obj}.${e.member} = ${num(v, { min: e.min, max: e.max, name: key })};`); break;
            case 'int': {
                if (!Number.isInteger(Number(v))) throw new Error(`'${key}' must be a whole number: ${JSON.stringify(v)}`);
                out.push(`${obj}.${e.member} = ${num(v, { min: e.min, max: e.max, name: key })};`);
                break;
            }
            case 'enum': out.push(`${obj}.${e.member} = ${e.type}.${e.values[enumOf(v, Object.keys(e.values), { name: key })]};`); break;
            case 'color': out.push(`${obj}.${e.member} = __color(doc, ${colorSpec(v, key)});`); break;
            case 'name': {
                if (String(v).length > 200) throw new Error(`'${key}' is too long`);
                out.push(`${obj}.${e.member} = ${str(v)};`);
                break;
            }
            case 'group': {
                if (typeof v !== 'object') throw new Error(`'${key}' takes { minimum, desired, maximum }`);
                ['minimum', 'desired', 'maximum'].forEach((part, i) => {
                    if (v[part] !== undefined) out.push(`${obj}.${e.members[i]} = ${num(v[part], { min: e.min, max: e.max, name: `${key}.${part}` })};`);
                });
                break;
            }
        }
    }
    return out;
}

/** JSX statements for character attributes on `ca` (the range is `tr`, when there is one). */
function characterStatements(a, ca, { tr = null } = {}) {
    const out = [];
    if (a.font) out.push(`${ca}.textFont = __font(${str(a.font)});`);
    if (a.fontStyle && tr) out.push(`${ca}.textFont = __face(${tr}, ${str(a.fontStyle)});`);
    // Leading turns auto leading off; an explicit autoLeading wins.
    if (a.leading !== undefined && a.autoLeading === undefined) out.push(`${ca}.autoLeading = false;`);
    out.push(...tableStatements(CHARACTER, a, ca));
    if (a.kerning !== undefined && tr) out.push(`${tr}.kerning = ${num(a.kerning, { min: -1000, max: 10000, name: 'kerning' })};`);
    return out;
}

/** JSX statements for paragraph attributes on `pa`. */
function paragraphStatements(a, pa) {
    const out = tableStatements(PARAGRAPH, a, pa);
    if (a.composer) {
        const c = enumOf(a.composer, COMPOSERS, { name: 'composer' });
        out.push(`${pa}.everyLineComposer = ${bool(c.endsWith('every_line'))};`);
        out.push(c.startsWith('middle_eastern')
            ? `${pa}.composerEngine = ComposerEngineType.optycaComposer;`
            : `if (${pa}.composerEngine == ComposerEngineType.optycaComposer) ${pa}.composerEngine = ComposerEngineType.latinCJKComposer;`);
    }
    return out;
}

/** Object-model members read back by get_text_attributes and copied by create_text_style. */
const CHARACTER_MEMBERS = [...new Set(['textFont', ...Object.values(CHARACTER).map((e) => e.member)])];
const PARAGRAPH_MEMBERS = [...new Set([...Object.values(PARAGRAPH).flatMap((e) => e.members ?? [e.member]), 'everyLineComposer', 'composerEngine'])];

const RANGE_SCHEMA = {
    type: 'object',
    description: 'Characters to format in each frame (or in the selected text): start is the 0-based character offset; length defaults to the rest of the text. Default: all the text',
    properties: { start: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1 } },
};
const PARAGRAPHS_SCHEMA = {
    type: 'object',
    description: 'Paragraphs to format in each frame: start is the 0-based paragraph index; length defaults to the rest. Default: every paragraph',
    properties: { start: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1 } },
};
const TEXT_TARGET = { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. Text frames inside groups are included; with selection: true and text selected with the Type tool, the selected text is used` };

/** A { start, length } spec as a JSX literal, or null. */
function spanSpec(value, name) {
    if (value === undefined || value === null) return 'null';
    if (typeof value !== 'object') throw new Error(`'${name}' takes { start, length }`);
    return json({
        start: Number(index(value.start ?? 0, { name: `${name}.start`, max: 10000000 })),
        length: value.length === undefined ? null : Number(index(value.length, { name: `${name}.length`, max: 10000000 })),
    });
}

/** ES3 helpers: the text frames among the targets, the selected text, character and paragraph ranges, fonts and styles. */
const TEXT_FNS = `
function __frames(doc, spec) {
  var out = [];
  var walk = function (it) {
    if (it.typename === "TextFrame") out.push(it);
    else if (it.typename === "GroupItem") for (var g = 0; g < it.pageItems.length; g++) walk(it.pageItems[g]);
  };
  var items = __targets(doc, spec);
  for (var i = 0; i < items.length; i++) walk(items[i]);
  if (!out.length) throw new Error("None of the items is a text frame");
  return out;
}
function __selectedText(doc, spec) {
  if (!spec.selection) return null;
  var sel = doc.selection;
  return (sel && sel.typename === "TextRange") ? sel : null;
}
function __sources(doc, spec) {
  var picked = __selectedText(doc, spec);
  if (picked) return [picked];
  var fr = __frames(doc, spec), out = [];
  for (var i = 0; i < fr.length; i++) out.push(fr[i].textRange);
  return out;
}
function __span(list, span, what) {
  var n = list.length, out = [];
  if (span.start >= n) throw new Error("The text has " + n + " " + what + "; start " + span.start + " is past the end");
  var end = span.length === null ? n : Math.min(n, span.start + span.length);
  for (var i = span.start; i < end; i++) out.push(list[i]);
  return out;
}
function __charRanges(doc, spec, span) {
  var src = __sources(doc, spec), out = [];
  for (var i = 0; i < src.length; i++) {
    if (!span) { out.push(src[i]); continue; }
    var part = __span(src[i].characters, span, "characters");
    for (var j = 0; j < part.length; j++) out.push(part[j]);
  }
  return out;
}
function __paraRanges(doc, spec, span) {
  var src = __sources(doc, spec), out = [];
  for (var i = 0; i < src.length; i++) {
    if (!span) { out.push(src[i]); continue; }
    var part = __span(src[i].paragraphs, span, "paragraphs");
    for (var j = 0; j < part.length; j++) if (part[j].length > 0) out.push(part[j]);
  }
  return out;
}
function __font(name) {
  try { return app.textFonts.getByName(name); } catch (e) { throw new Error("Font not found: " + name + ". Use list_fonts for PostScript names"); }
}
var __faces = {};
function __face(tr, style) {
  var cur = tr.characters.length ? tr.characters[0].characterAttributes.textFont : tr.characterAttributes.textFont;
  var key = cur.family + "|" + style.toLowerCase();
  if (__faces[key]) return __faces[key];
  for (var i = 0; i < app.textFonts.length; i++) {
    var f = app.textFonts[i];
    if (f.family === cur.family && f.style.toLowerCase() === style.toLowerCase()) { __faces[key] = f; return f; }
  }
  throw new Error("The " + cur.family + " family has no " + style + " style. Use list_fonts to see its styles");
}
function __styles(doc, kind) {
  return kind === "character" ? doc.characterStyles : doc.paragraphStyles;
}
function __style(doc, kind, name) {
  var s = null;
  try { s = __styles(doc, kind).getByName(name); } catch (e) { s = null; }
  if (!s) throw new Error("No " + kind + " style named " + name + ". Use list_text_styles");
  return s;
}
function __value(v) {
  if (v === null || v === undefined) return null;
  var t = typeof v;
  if (t === "number" || t === "boolean" || t === "string") return v;
  if (v.typename === "TextFont") return v.name;
  if (v.typename && /Color$/.test(v.typename)) return __colorInfo(v);
  return String(v);
}
function __read(obj, names) {
  var out = {};
  for (var i = 0; i < names.length; i++) {
    try { out[names[i]] = __value(obj[names[i]]); } catch (e) { out[names[i]] = null; }
  }
  return out;
}
function __tabs(pa) {
  var out = [], ts = pa.tabStops;
  for (var i = 0; i < ts.length; i++) out.push({ position: ts[i].position, alignment: String(ts[i].alignment), leader: ts[i].leader, decimalCharacter: ts[i].decimalCharacter });
  return out;
}`;

const KINDS = ['character', 'paragraph'];

const STYLE_SCHEMA = {
    character: { type: 'object', description: 'Character attributes, as set_character_attributes takes them', properties: CHARACTER_PROPS },
    paragraph: { type: 'object', description: 'Paragraph attributes, as set_paragraph_attributes takes them (paragraph styles only)', properties: PARAGRAPH_PROPS },
};

/** JSX statements setting a style's attributes. */
function styleStatements(kind, a) {
    const lines = [];
    for (const k of ['fontStyle', 'kerning']) {
        if (a.character?.[k] !== undefined) throw new Error(`Styles cannot hold character.${k}: give a font (PostScript name) or tracking instead`);
    }
    if (a.character) lines.push(...characterStatements(a.character, 'st.characterAttributes'));
    if (a.paragraph) {
        if (kind !== 'paragraph') throw new Error('Character styles hold character attributes only: move these into a paragraph style, or drop paragraph');
        lines.push(...paragraphStatements(a.paragraph, 'st.paragraphAttributes'));
    }
    return lines;
}

function styleName(value, name = 'name') {
    const v = String(value ?? '').trim();
    if (!v || v.length > 200) throw new Error(`'${name}' must be a style name of 1-200 characters`);
    return v;
}

const TAB_ALIGN = { left: 'Left', center: 'Center', right: 'Right', decimal: 'Decimal' };

const ADJUST = {
    size_up: 'Increase the font size by amount points (default 2)',
    size_down: 'Decrease the font size by amount points (default 2)',
    size_step_up: 'Font Size Step Up: the next size in the font size menu (whole frames)',
    size_step_down: 'Font Size Step Down (whole frames)',
    kern_looser: 'Add amount (default 20) thousandths of an em of kerning at each character',
    kern_tighter: 'Remove amount (default 20) thousandths of an em of kerning at each character',
    track_looser: 'Add amount (default 20) to the tracking',
    track_tighter: 'Remove amount (default 20) from the tracking',
    clear_tracking: 'Set tracking to 0',
    uniform_type: 'Set horizontal and vertical scale to 100%',
    fit_headline: 'Fit Headline: track the paragraph to fill the width of its area type',
};
const STEP_COMMANDS = { size_step_up: 'sizeStepUp', size_step_down: 'sizeStepDown' };

const FIRST_BASELINE = {
    ascent: 'BASELINEASCENT', cap_height: 'BASELINECAPHEIGHT', leading: 'BASELINELEADING', x_height: 'BASELINEXHEIGHT',
    em_box_height: 'BASELINEEMBOXHEIGHT', fixed: 'BASELINEFIXED', legacy: 'BASELINELEGACY',
};
const ANTIALIAS = { none: 'NONE', sharp: 'SHARP', crisp: 'CRISP', strong: 'STRONG' };
const THREAD_COMMANDS = { release: 'releaseThreadedTextSelection', remove: 'removeThreading' };

export const tools = [
    {
        name: 'set_character_attributes',
        description: 'Set Character panel, OpenType panel and CJK character attributes on text frames, a character range of each, or the selected text: font and style, size, leading, kerning, tracking, scales, baseline shift, rotation, language, caps, superscript and subscript, underline, strikethrough, fill and stroke, no break, overprint, ligatures, alternates, swashes, figure styles, fractions, ordinals, tsume, aki, tate-chu-yoko and warichu',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET,
                range: RANGE_SCHEMA,
                ...CHARACTER_PROPS,
                fontStyle: { type: 'string', description: 'A style of the text\'s current font family, e.g. "Bold", "Italic" or "Bold Italic" (the family of the first character of each range)' },
                kerning: { type: 'number', minimum: -1000, maximum: 10000, description: 'Manual kerning in thousandths of an em, at each character of the range' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.typography.bold',
            'illustrator.typography.italic',
            'illustrator.typography.underline',
            'illustrator.typography.subscript',
            'illustrator.typography.superscript',
            'illustrator.typography.subscript2',
            'illustrator.typography.superscript2',
            'illustrator.typography.kerning_manual',
            'illustrator.typography.transform_text',
            'illustrator.typography.underline_strike_options',
            'illustrator.typography.character.kerning',
            'illustrator.typography.character.vertical_scale',
            'illustrator.typography.character.horizontal_scale',
            'illustrator.typography.character.baseline_shift',
            'illustrator.typography.character.character_rotation',
            'illustrator.typography.character.language',
            'illustrator.typography.character.all_caps_small_caps',
            'illustrator.typography.character.superscript_subscript',
            'illustrator.typography.character.underline',
            'illustrator.typography.character.strikethrough',
            'illustrator.typography.character.character_stroke_color',
            'illustrator.typography.character.character_stroke_weight',
            'illustrator.typography.character.no_break',
            'illustrator.typography.character.character_overprint_fill',
            'illustrator.typography.character.character_overprint_stroke',
            'illustrator.typography.character.synthetic_italics',
            'illustrator.typography.character.tsume',
            'illustrator.typography.character.insert_space_left',
            'illustrator.typography.character.insert_space_right',
            'illustrator.typography.character.tate_chu_yoko_horizontal_offset',
            'illustrator.typography.character.tate_chu_yoko_vertical_offset',
            'illustrator.typography.character.warichu',
            'illustrator.typography.character.warichu_lines',
            'illustrator.typography.character.warichu_scale',
            'illustrator.typography.character.warichu_line_gap',
            'illustrator.typography.character.warichu_justification',
            'illustrator.typography.character.baseline_direction',
            'illustrator.typography.character.character_alignment',
            'illustrator.typography.character.font_family_and_style',
            'illustrator.typography.character.font_size',
            'illustrator.typography.character.leading',
            'illustrator.typography.character.auto_leading',
            'illustrator.typography.character.tracking',
            'illustrator.typography.character.character_fill_color',
            'illustrator.typography.character_panel',
            'illustrator.typography.text_range_object',
            'illustrator.typography.opentype_panel',
            'illustrator.typography.opentype.standard_ligatures',
            'illustrator.typography.opentype.contextual_alternates',
            'illustrator.typography.opentype.discretionary_ligatures',
            'illustrator.typography.opentype.swash',
            'illustrator.typography.opentype.stylistic_alternates',
            'illustrator.typography.opentype.titling_alternates',
            'illustrator.typography.opentype.figure',
            'illustrator.typography.opentype.position',
            'illustrator.typography.opentype.ordinals',
            'illustrator.typography.opentype.fractions',
            'illustrator.typography.opentype.ornaments',
            'illustrator.typography.opentype.proportional_metrics',
            'illustrator.typography.opentype.connection_forms',
            'illustrator.typography.opentype.alternate_glyph_forms',
            'illustrator.typography.ligatures_workflow',
            'illustrator.typography.swash_workflow',
            'illustrator.typography.character_sets',
            'illustrator.typography.kashida',
        ],
        hints: { idempotent: true },
        handler: (a) => {
            const lines = characterStatements(a, 'ca', { tr: 'tr' });
            if (!lines.length) throw new Error('Give at least one character attribute to set (see help for set_character_attributes)');
            return run('Set character attributes', script(`${TEXT_FNS}
var ranges = __charRanges(doc, ${targetSpec(a.target)}, ${spanSpec(a.range, 'range')});
for (var i = 0; i < ranges.length; i++) {
  var tr = ranges[i], ca = tr.characterAttributes;
  ${lines.join('\n  ')}
}
__result__ = { ranges: ranges.length };`));
        },
    },
    {
        name: 'adjust_text',
        description: 'Step text formatting up or down the way the Type keyboard commands do: font size up or down by points or by Font Size Step Up/Down, kern or track looser or tighter, Clear Tracking, Uniform Type (scales back to 100%), and Fit Headline (Type > Fit Headline, area type)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET,
                range: RANGE_SCHEMA,
                operation: { type: 'string', enum: Object.keys(ADJUST), description: Object.entries(ADJUST).map(([k, v]) => `${k}: ${v}`).join('; ') },
                amount: { type: 'number', minimum: 0, maximum: 1000, description: 'Points for size_up/size_down (default 2); thousandths of an em for kern and track operations (default 20)' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.typography.point_size_up',
            'illustrator.typography.point_size_down',
            'illustrator.typography.size_step_up',
            'illustrator.typography.size_step_down',
            'illustrator.typography.kern_looser',
            'illustrator.typography.kern_tighter',
            'illustrator.typography.clear_tracking',
            'illustrator.typography.uniform_type',
            'illustrator.typography.fit_headline',
        ],
        menuCommands: [...Object.values(STEP_COMMANDS), 'fitHeadline'],
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(ADJUST), { name: 'operation' });
            const spec = targetSpec(a.target);
            if (STEP_COMMANDS[op]) {
                if (a.range) throw new Error(`${op} steps whole text frames: drop range, or use size_up/size_down with an amount`);
                return run('Adjust text', script(`${TEXT_FNS}
var frames = __frames(doc, ${spec});
doc.selection = null;
for (var i = 0; i < frames.length; i++) frames[i].selected = true;
app.executeMenuCommand(${str(STEP_COMMANDS[op])});
var sizes = [];
for (var j = 0; j < frames.length; j++) sizes.push(frames[j].textRange.characterAttributes.size);
__result__ = { frames: frames.length, sizes: sizes };`));
            }
            if (op === 'fit_headline') {
                return run('Fit headline', script(`${TEXT_FNS}
var ranges = __charRanges(doc, ${spec}, ${spanSpec(a.range, 'range')});
var done = 0;
for (var i = 0; i < ranges.length; i++) {
  var fr = ranges[i].story.textFrames[0];
  if (fr.kind != TextType.AREATEXT) throw new Error("Fit Headline works on area type: convert " + (fr.name || "the frame") + " with set_text_frame_options { convertTo: \\"area\\" }");
  ranges[i].select();
  app.executeMenuCommand("fitHeadline");
  done++;
}
doc.selection = null;
__result__ = { fitted: done };`));
            }
            const amt = (d) => num(a.amount ?? d, { min: 0, max: 1000, name: 'amount' });
            const perChar = {
                size_up: `c.characterAttributes.size = Math.min(1296, c.characterAttributes.size + ${amt(2)});`,
                size_down: `c.characterAttributes.size = Math.max(0.1, c.characterAttributes.size - ${amt(2)});`,
                kern_looser: `c.kerning = c.kerning + ${amt(20)};`,
                kern_tighter: `c.kerning = c.kerning - ${amt(20)};`,
                track_looser: `c.characterAttributes.tracking = c.characterAttributes.tracking + ${amt(20)};`,
                track_tighter: `c.characterAttributes.tracking = c.characterAttributes.tracking - ${amt(20)};`,
            }[op];
            const whole = {
                clear_tracking: 'tr.characterAttributes.tracking = 0;',
                uniform_type: 'tr.characterAttributes.horizontalScale = 100; tr.characterAttributes.verticalScale = 100;',
            }[op];
            return run('Adjust text', script(`${TEXT_FNS}
var ranges = __charRanges(doc, ${spec}, ${spanSpec(a.range, 'range')}), n = 0;
for (var i = 0; i < ranges.length; i++) {
  var tr = ranges[i];
  ${perChar ? `for (var k = 0; k < tr.characters.length; k++) { var c = tr.characters[k]; ${perChar} n++; }` : `${whole} n += tr.length;`}
}
__result__ = { characters: n };`));
        },
    },
    {
        name: 'set_paragraph_attributes',
        description: 'Set Paragraph panel attributes on text frames, some of their paragraphs, or the selected text: alignment, indents, space before and after, hyphenation (the Hyphenation dialog), word and letter spacing, glyph scaling and auto leading (the Justification dialog), single-word justification, composer, Roman hanging punctuation, kashida width, and the CJK options (kinsoku, mojikumi, burasagari, bunri-kinshi, kurikaeshi moji shori, leading type)',
        inputSchema: {
            type: 'object',
            properties: { target: TEXT_TARGET, paragraphs: PARAGRAPHS_SCHEMA, ...PARAGRAPH_PROPS },
            required: ['target'],
        },
        features: [
            'illustrator.typography.paragraph_panel',
            'illustrator.typography.paragraph.alignment_and_justification',
            'illustrator.typography.toggle_auto_hyphen',
            'illustrator.typography.toggle_line_composer',
            'illustrator.typography.paragraph.left_indent',
            'illustrator.typography.paragraph.right_indent',
            'illustrator.typography.paragraph.first_line_left_indent',
            'illustrator.typography.paragraph.space_before_paragraph',
            'illustrator.typography.paragraph.space_after_paragraph',
            'illustrator.typography.paragraph.hyphenate',
            'illustrator.typography.paragraph.words_longer_than',
            'illustrator.typography.paragraph.after_first',
            'illustrator.typography.paragraph.before_last',
            'illustrator.typography.paragraph.hyphen_limit',
            'illustrator.typography.paragraph.hyphenation_zone',
            'illustrator.typography.paragraph.hyphenate_capitalized_words',
            'illustrator.typography.paragraph.better_spacing_fewer_hyphens',
            'illustrator.typography.paragraph.word_spacing_desired',
            'illustrator.typography.paragraph.word_spacing_minimum',
            'illustrator.typography.paragraph.word_spacing_maximum',
            'illustrator.typography.paragraph.letter_spacing_desired',
            'illustrator.typography.paragraph.letter_spacing_minimum',
            'illustrator.typography.paragraph.letter_spacing_maximum',
            'illustrator.typography.paragraph.glyph_scaling_desired',
            'illustrator.typography.paragraph.glyph_scaling_minimum',
            'illustrator.typography.paragraph.glyph_scaling_maximum',
            'illustrator.typography.paragraph.auto_leading_percentage',
            'illustrator.typography.paragraph.single_word_justification',
            'illustrator.typography.paragraph.adobe_every_line_composer',
            'illustrator.typography.paragraph.roman_hanging_punctuation',
            'illustrator.typography.paragraph.leading_type',
            'illustrator.typography.paragraph.kinsoku_shori',
            'illustrator.typography.paragraph.kinsoku_type',
            'illustrator.typography.paragraph.mojikumi',
            'illustrator.typography.paragraph.burasagari',
            'illustrator.typography.paragraph.bunri_kinshi',
            'illustrator.typography.paragraph.kurikaeshi_moji_shori',
            'illustrator.typography.hyphenation_dialog',
            'illustrator.typography.justification_dialog',
            'illustrator.typography.composers',
            'illustrator.typography.middle_eastern_composer',
            'illustrator.typography.indent_text',
            'illustrator.typography.paragraph_spacing',
            'illustrator.typography.kashida',
        ],
        hints: { idempotent: true },
        auditArgs: { hyphenationPreference: 0.5, glyphScaling: { minimum: 95, desired: 100, maximum: 105 }, composer: 'middle_eastern_every_line' },
        handler: (a) => {
            const lines = paragraphStatements(a, 'pa');
            if (!lines.length) throw new Error('Give at least one paragraph attribute to set (see help for set_paragraph_attributes)');
            return run('Set paragraph attributes', script(`${TEXT_FNS}
var ranges = __paraRanges(doc, ${targetSpec(a.target)}, ${spanSpec(a.paragraphs, 'paragraphs')});
for (var i = 0; i < ranges.length; i++) {
  var pa = ranges[i].paragraphAttributes;
  ${lines.join('\n  ')}
}
__result__ = { ranges: ranges.length };`));
        },
    },
    {
        name: 'set_tab_stops',
        description: 'Set the tab stops of text frames, some of their paragraphs, or the selected text (Tabs panel): left, centre, right and decimal tabs, leaders, the decimal character, and Repeat Tab. Replaces the existing stops; an empty list clears them',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET,
                paragraphs: PARAGRAPHS_SCHEMA,
                stops: {
                    type: 'array',
                    description: 'Tab stops. position is in points from the left edge of the text',
                    items: {
                        type: 'object',
                        properties: {
                            position: { type: 'number', minimum: 0, maximum: 16000 },
                            alignment: { type: 'string', enum: Object.keys(TAB_ALIGN), default: 'left' },
                            leader: { type: 'string', maxLength: 8, description: 'Characters repeated to fill the space before the stop, e.g. "." (up to 8)' },
                            decimalCharacter: { type: 'string', maxLength: 1, description: 'Decimal tabs: the character to align on. Default "."' },
                        },
                        required: ['position'],
                    },
                },
                repeat: { type: 'integer', minimum: 0, maximum: 200, description: 'Repeat Tab: add this many stops after the last one, each at the distance between the last two stops (or from 0 with one stop)' },
            },
            required: ['target', 'stops'],
        },
        features: [
            'illustrator.typography.paragraph.tab_stops',
            'illustrator.typography.tabs_panel',
            'illustrator.typography.tab_option.left_justified_tab',
            'illustrator.typography.tab_option.center_justified_tab',
            'illustrator.typography.tab_option.right_justified_tab',
            'illustrator.typography.tab_option.decimal_justified_tab',
            'illustrator.typography.tab_option.leader',
            'illustrator.typography.tab_option.repeat_tab',
            'illustrator.typography.decimal_tabs',
        ],
        hints: { idempotent: true },
        auditArgs: { stops: [{ position: 36, alignment: 'decimal', leader: '.', decimalCharacter: ',' }, { position: 72, alignment: 'right' }], repeat: 2 },
        handler: (a) => {
            if (!Array.isArray(a.stops)) throw new Error("'stops' must be a list of { position, alignment, leader, decimalCharacter }; [] clears the tab stops");
            const stops = a.stops.map((s, i) => {
                if (!s || typeof s !== 'object') throw new Error(`stops[${i}] must be an object with a position`);
                const leader = String(s.leader ?? '');
                if (leader.length > 8) throw new Error(`stops[${i}].leader is at most 8 characters`);
                const dec = String(s.decimalCharacter ?? '.');
                if (dec.length !== 1) throw new Error(`stops[${i}].decimalCharacter must be one character`);
                return {
                    position: Number(num(s.position, { min: 0, max: 16000, name: `stops[${i}].position` })),
                    alignment: TAB_ALIGN[enumOf(s.alignment ?? 'left', Object.keys(TAB_ALIGN), { name: `stops[${i}].alignment` })],
                    leader, dec,
                };
            }).sort((x, y) => x.position - y.position);
            const repeat = Number(index(a.repeat ?? 0, { name: 'repeat', max: 200 }));
            if (repeat) {
                if (!stops.length) throw new Error('repeat needs at least one stop to repeat');
                const last = stops[stops.length - 1];
                const step = last.position - (stops.length > 1 ? stops[stops.length - 2].position : 0);
                if (step <= 0) throw new Error('repeat needs the last two stops at different positions');
                for (let r = 1; r <= repeat; r++) stops.push({ ...last, position: last.position + step * r });
                if (stops[stops.length - 1].position > 16000) throw new Error('Repeated stops run past 16000 pt: use fewer repeats');
            }
            const make = stops.map((s) => `t = new TabStopInfo(); t.position = ${s.position}; t.alignment = TabStopAlignment.${s.alignment}; t.leader = ${str(s.leader)}; t.decimalCharacter = ${str(s.dec)}; out.push(t);`);
            return run('Set tab stops', script(`${TEXT_FNS}
var __makeTabs = function () {
  var out = [], t;
  ${make.join('\n  ')}
  return out;
};
var ranges = __paraRanges(doc, ${targetSpec(a.target)}, ${spanSpec(a.paragraphs, 'paragraphs')});
for (var i = 0; i < ranges.length; i++) ranges[i].paragraphAttributes.tabStops = __makeTabs();
__result__ = { ranges: ranges.length, tabStops: ranges.length ? __tabs(ranges[0].paragraphAttributes) : [] };`));
        },
    },
    {
        name: 'get_text_attributes',
        description: 'Read the formatting of text frames or the selected text: character and paragraph attributes (of the first character and paragraph of the range), tab stops, the character and paragraph styles in use, and the frame\'s area type options and threads',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET,
                range: RANGE_SCHEMA,
                limit: { type: 'integer', minimum: 1, maximum: 200, default: 20, description: 'Most ranges to report' },
            },
            required: ['target'],
        },
        features: ['illustrator.typography.character_panel', 'illustrator.typography.paragraph_panel', 'illustrator.typography.tabs_panel', 'illustrator.typography.text_range_object'],
        hints: { readOnly: true },
        handler: (a) => run('Get text attributes', script(`${TEXT_FNS}
var ranges = __charRanges(doc, ${targetSpec(a.target)}, ${spanSpec(a.range, 'range')}), out = [];
var cm = ${json(CHARACTER_MEMBERS)}, pm = ${json(PARAGRAPH_MEMBERS)};
var max = Math.min(ranges.length, ${index(a.limit ?? 20, { name: 'limit', max: 200 })});
for (var i = 0; i < max; i++) {
  var tr = ranges[i], first = tr.characters.length ? tr.characters[0] : tr, para = tr.paragraphs.length ? tr.paragraphs[0] : tr;
  var fr = tr.story.textFrames[0];
  var r = { frame: fr.name, frameId: null, contents: tr.contents.length > 200 ? tr.contents.substr(0, 200) + "..." : tr.contents, characters: tr.characters.length, paragraphs: tr.paragraphs.length };
  try { r.frameId = fr.uuid; } catch (e) {}
  r.character = __read(first.characterAttributes, cm);
  try { r.character.kerning = first.kerning; } catch (e) {}
  r.paragraph = __read(para.paragraphAttributes, pm);
  r.tabStops = __tabs(para.paragraphAttributes);
  r.characterStyles = []; r.paragraphStyles = [];
  for (var c = 0; c < tr.characterStyles.length; c++) r.characterStyles.push(tr.characterStyles[c].name);
  for (var p = 0; p < tr.paragraphStyles.length; p++) r.paragraphStyles.push(tr.paragraphStyles[p].name);
  r.kind = String(fr.kind);
  r.opticalMarginAlignment = fr.opticalAlignment;
  r.antiAliasing = String(fr.antialias);
  if (fr.kind == TextType.AREATEXT) {
    var f = __sf(doc);
    r.areaType = { width: fr.textPath.width * f, height: fr.textPath.height * f, rows: fr.rowCount, rowGutter: fr.rowGutter * f, columns: fr.columnCount, columnGutter: fr.columnGutter * f,
      inset: fr.spacing * f, firstBaseline: String(fr.firstBaseline), firstBaselineMin: fr.firstBaselineMin * f, flowByRows: fr.flowLinksHorizontally };
  }
  r.previousFrame = fr.previousFrame ? (fr.previousFrame.name || fr.previousFrame.uuid) : null;
  r.nextFrame = fr.nextFrame ? (fr.nextFrame.name || fr.nextFrame.uuid) : null;
  out.push(r);
}
__result__ = { total: ranges.length, ranges: out };`)),
    },

    // Styles
    {
        name: 'list_text_styles',
        description: 'List the document\'s character and paragraph styles (Character Styles and Paragraph Styles panels), optionally with their attributes',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: [...KINDS, 'both'], default: 'both' },
                attributes: { type: 'boolean', default: false, description: 'Include each style\'s attributes' },
            },
        },
        features: [
            'illustrator.typography.character_styles_panel',
            'illustrator.typography.paragraph_styles_panel',
            'illustrator.typography.character_style_object',
            'illustrator.typography.paragraph_style_object',
        ],
        hints: { readOnly: true },
        handler: (a) => {
            const kind = enumOf(a.kind ?? 'both', [...KINDS, 'both'], { name: 'kind' });
            return run('List text styles', script(`${TEXT_FNS}
var kinds = ${json(kind === 'both' ? KINDS : [kind])}, withAttrs = ${bool(a.attributes)}, out = {};
var cm = ${json(CHARACTER_MEMBERS)}, pm = ${json(PARAGRAPH_MEMBERS)};
for (var k = 0; k < kinds.length; k++) {
  var col = __styles(doc, kinds[k]), list = [];
  for (var i = 0; i < col.length; i++) {
    var s = { name: col[i].name };
    if (withAttrs) {
      s.character = __read(col[i].characterAttributes, cm);
      if (kinds[k] === "paragraph") { s.paragraph = __read(col[i].paragraphAttributes, pm); s.tabStops = __tabs(col[i].paragraphAttributes); }
    }
    list.push(s);
  }
  out[kinds[k]] = list;
}
__result__ = out;`));
        },
    },
    {
        name: 'create_text_style',
        description: 'Create a character or paragraph style (New Character Style, New Paragraph Style), optionally from the formatting of existing text (its first character and paragraph), then with the given attributes, and optionally apply it to that text',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: KINDS },
                name: { type: 'string' },
                from: { ...TEXT_TARGET, description: 'Text whose formatting the style starts from. ' + TEXT_TARGET.description },
                apply: { type: 'boolean', default: false, description: 'Apply the new style to the from text' },
                ...STYLE_SCHEMA,
            },
            required: ['kind', 'name'],
        },
        auditArgs: { kind: 'paragraph', apply: true, character: { font: 'MyriadPro-Bold', size: 14, color: '#336699' }, paragraph: { hyphenationPreference: 0.5, spaceAfter: 6, composer: 'every_line' } },
        features: [
            'illustrator.typography.character_style_object',
            'illustrator.typography.paragraph_style_object',
            'illustrator.typography.character_styles_menu.new_character_style',
            'illustrator.typography.paragraph_styles_menu.new_paragraph_style',
        ],
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const name = styleName(a.name);
            if (a.apply && !a.from) throw new Error('apply needs from: the text to apply the new style to');
            return run('Create text style', script(`${TEXT_FNS}
var existing = null;
try { existing = __styles(doc, ${str(kind)}).getByName(${str(name)}); } catch (e) { existing = null; }
if (existing) throw new Error("A ${kind} style named " + ${str(name)} + " already exists: use edit_text_style");
var src = ${a.from ? `__charRanges(doc, ${targetSpec(a.from)}, null)` : '[]'};
var st = __styles(doc, ${str(kind)}).add(${str(name)});
try {
  if (src.length) {
    var first = src[0].characters.length ? src[0].characters[0] : src[0];
    var cm = ${json(CHARACTER_MEMBERS)};
    for (var c = 0; c < cm.length; c++) { try { var cv = first.characterAttributes[cm[c]]; if (cv !== undefined && cv !== null) st.characterAttributes[cm[c]] = cv; } catch (e1) {} }
    ${kind === 'paragraph' ? `var pa = (src[0].paragraphs.length ? src[0].paragraphs[0] : src[0]).paragraphAttributes, pm = ${json([...PARAGRAPH_MEMBERS, 'tabStops'])};
    for (var p = 0; p < pm.length; p++) { try { var pv = pa[pm[p]]; if (pv !== undefined && pv !== null) st.paragraphAttributes[pm[p]] = pv; } catch (e2) {} }` : ''}
  }
  ${styleStatements(kind, a).join('\n  ')}
} catch (e) { st.remove(); throw e; }
${a.apply ? 'for (var i = 0; i < src.length; i++) st.applyTo(src[i], false);' : ''}
__result__ = { kind: ${str(kind)}, name: st.name, applied: ${a.apply ? 'src.length' : '0'} };`));
        },
    },
    {
        name: 'edit_text_style',
        description: 'Change a character or paragraph style (Character Style Options, Paragraph Style Options): rename it and set attributes. reset first removes every attribute the style holds, so it keeps only the ones given',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: KINDS },
                name: { type: 'string' },
                newName: { type: 'string' },
                reset: { type: 'boolean', default: false },
                ...STYLE_SCHEMA,
            },
            required: ['kind', 'name'],
        },
        features: [
            'illustrator.typography.character_styles_menu.character_style_options',
            'illustrator.typography.paragraph_styles_menu.paragraph_style_options',
            'illustrator.typography.character_style_object',
            'illustrator.typography.paragraph_style_object',
        ],
        hints: { idempotent: true },
        auditArgs: { kind: 'paragraph', reset: true, character: { tracking: 20 }, paragraph: { hyphenationPreference: 1, leftIndent: 12 } },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const lines = styleStatements(kind, a);
            if (!lines.length && !a.newName && !a.reset) throw new Error('Give newName, reset, character or paragraph attributes to change');
            return run('Edit text style', script(`${TEXT_FNS}
var st = __style(doc, ${str(kind)}, ${str(styleName(a.name))});
${a.reset ? 'st.clear();' : ''}
${lines.join('\n')}
${a.newName ? `st.name = ${str(styleName(a.newName, 'newName'))};` : ''}
__result__ = { kind: ${str(kind)}, name: st.name };`));
        },
    },
    {
        name: 'delete_text_styles',
        description: 'Delete character or paragraph styles by name (Delete Character Style, Delete Paragraph Style). Text using them keeps its look as local formatting; the [Normal] styles cannot be deleted',
        inputSchema: {
            type: 'object',
            properties: { kind: { type: 'string', enum: KINDS }, names: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            required: ['kind', 'names'],
        },
        features: ['illustrator.typography.character_styles_menu.delete_character_style', 'illustrator.typography.paragraph_styles_menu.delete_paragraph_style'],
        hints: { destructive: true },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one style");
            return run('Delete text styles', script(`${TEXT_FNS}
var names = ${json(a.names.map((n) => styleName(n, 'names')))}, deleted = [], missing = [], refused = [];
for (var i = 0; i < names.length; i++) {
  var s = null;
  try { s = __styles(doc, ${str(kind)}).getByName(names[i]); } catch (e) { s = null; }
  if (!s) { missing.push(names[i]); continue; }
  try { s.remove(); deleted.push(names[i]); } catch (e2) { refused.push(names[i]); }
}
__result__ = { deleted: deleted, notFound: missing, notDeleted: refused };`));
        },
    },
    {
        name: 'apply_text_style',
        description: 'Apply a character style to text frames, a character range or the selected text, or a paragraph style to their paragraphs. clearOverrides removes local formatting that differs from the style. Without name, the text\'s current styles are reapplied with overrides cleared (Clear Overrides)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: KINDS },
                name: { type: 'string', description: 'Style to apply. Omit to clear overrides on the current styles' },
                target: TEXT_TARGET,
                range: { ...RANGE_SCHEMA, description: `Character styles: ${RANGE_SCHEMA.description}` },
                paragraphs: { ...PARAGRAPHS_SCHEMA, description: `Paragraph styles: ${PARAGRAPHS_SCHEMA.description}` },
                clearOverrides: { type: 'boolean', default: false },
            },
            required: ['kind', 'target'],
        },
        features: [
            'illustrator.typography.apply_styles',
            'illustrator.typography.character_styles_menu.clear_overrides',
            'illustrator.typography.character_style_object',
            'illustrator.typography.paragraph_style_object',
        ],
        hints: { destructive: true, idempotent: true },
        auditArgs: { paragraphs: undefined },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const spec = targetSpec(a.target);
            const ranges = kind === 'character'
                ? `__charRanges(doc, ${spec}, ${spanSpec(a.range, 'range')})`
                : `__paraRanges(doc, ${spec}, ${spanSpec(a.paragraphs, 'paragraphs')})`;
            if (kind === 'character' && a.paragraphs) throw new Error('Character styles take range, not paragraphs');
            if (kind === 'paragraph' && a.range) throw new Error('Paragraph styles take paragraphs, not range');
            if (a.name !== undefined) {
                return run('Apply text style', script(`${TEXT_FNS}
var st = __style(doc, ${str(kind)}, ${str(styleName(a.name))});
var ranges = ${ranges};
for (var i = 0; i < ranges.length; i++) st.applyTo(ranges[i], ${bool(a.clearOverrides)});
__result__ = { style: st.name, ranges: ranges.length };`));
            }
            // Clear Overrides: reapply each run's (or paragraph's) own style, clearing.
            return run('Clear text overrides', script(`${TEXT_FNS}
var ranges = ${ranges}, n = 0;
for (var i = 0; i < ranges.length; i++) {
  ${kind === 'character'
        ? 'var runs = ranges[i].textRanges;\n  for (var j = 0; j < runs.length; j++) if (runs[j].characterStyles.length) { runs[j].characterStyles[0].applyTo(runs[j], true); n++; }'
        : 'var ps = ranges[i].paragraphs;\n  for (var j = 0; j < ps.length; j++) if (ps[j].length > 0 && ps[j].paragraphStyles.length) { ps[j].paragraphStyles[0].applyTo(ps[j], true); n++; }'}
}
__result__ = { cleared: n };`));
        },
    },
    {
        name: 'load_text_styles',
        description: 'Load character styles, paragraph styles or both from another Illustrator file (Load Character Styles, Load Paragraph Styles, Load All Styles). Styles with the same name are replaced',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of an .ai file' },
                kind: { type: 'string', enum: ['all', ...KINDS], default: 'all' },
            },
            required: ['filePath'],
        },
        features: [
            'illustrator.typography.character_styles_menu.load_character_styles',
            'illustrator.typography.character_styles_menu.load_all_styles',
            'illustrator.typography.paragraph_styles_menu.load_paragraph_styles',
        ],
        hints: { destructive: true, idempotent: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'styles.ai') },
        handler: (a) => {
            const kind = enumOf(a.kind ?? 'all', ['all', ...KINDS], { name: 'kind' });
            const p = paths.validate(a.filePath);
            if (!/\.(ai|ait)$/i.test(path.extname(p))) throw new Error(`Styles load from an Illustrator file (.ai or .ait): ${a.filePath}`);
            return run('Load text styles', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var before = { character: doc.characterStyles.length, paragraph: doc.paragraphStyles.length };
${kind !== 'paragraph' ? 'doc.importCharacterStyles(f);' : ''}
${kind !== 'character' ? 'doc.importParagraphStyles(f);' : ''}
__result__ = { characterStyles: doc.characterStyles.length, paragraphStyles: doc.paragraphStyles.length,
  added: { character: doc.characterStyles.length - before.character, paragraph: doc.paragraphStyles.length - before.paragraph } };`));
        },
    },

    // Area type and threads
    {
        name: 'set_text_frame_options',
        description: 'Set text frame options: convert between point and area type (Type > Convert To Area Type / Point Type), resize the type area without scaling the text, Area Type Options (rows, columns, gutters, inset spacing, first baseline, text flow), Optical Margin Alignment and anti-aliasing',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                convertTo: { type: 'string', enum: ['area', 'point'], description: 'Convert point type to area type or back first' },
                width: { type: 'number', minimum: 1, description: 'Area type: width of the type area in points' },
                height: { type: 'number', minimum: 1, description: 'Area type: height of the type area in points' },
                rows: { type: 'integer', minimum: 1, maximum: 100 },
                rowGutter: { type: 'number', minimum: 0, description: 'Points' },
                columns: { type: 'integer', minimum: 1, maximum: 100 },
                columnGutter: { type: 'number', minimum: 0, description: 'Points' },
                inset: { type: 'number', minimum: 0, description: 'Inset spacing in points' },
                firstBaseline: { type: 'string', enum: Object.keys(FIRST_BASELINE) },
                firstBaselineMin: { type: 'number', minimum: 0, description: 'First baseline minimum offset in points' },
                textFlow: { type: 'string', enum: ['by_rows', 'by_columns'], description: 'Text flow across rows first or down columns first' },
                opticalMarginAlignment: { type: 'boolean', description: 'Type > Optical Margin Alignment' },
                antiAliasing: { type: 'string', enum: Object.keys(ANTIALIAS), description: 'Anti-aliasing of the type in raster output' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.typography.convert_area_point',
            'illustrator.typography.area_type_options',
            'illustrator.typography.area_type_option.rows_number',
            'illustrator.typography.area_type_option.rows_gutter',
            'illustrator.typography.area_type_option.columns_number',
            'illustrator.typography.area_type_option.columns_gutter',
            'illustrator.typography.area_type_option.inset_spacing',
            'illustrator.typography.area_type_option.first_baseline',
            'illustrator.typography.area_type_option.first_baseline_min',
            'illustrator.typography.area_type_option.text_flow',
            'illustrator.typography.resize_text_area',
            'illustrator.typography.optical_margin',
            'illustrator.typography.anti_aliasing',
            'illustrator.typography.point_type',
            'illustrator.typography.area_type',
        ],
        auditArgs: { rows: 2, columns: 3, rowGutter: 6, columnGutter: 12 },
        handler: (a) => {
            const len = (k, min = 0) => `__len(doc, ${num(a[k], { min, max: 16000, name: k })})`;
            const area = [];
            if (a.width !== undefined) area.push(`f.textPath.width = ${len('width', 1)};`);
            if (a.height !== undefined) area.push(`f.textPath.height = ${len('height', 1)};`);
            if (a.rows !== undefined) area.push(`f.rowCount = ${num(a.rows, { min: 1, max: 100, name: 'rows' })};`);
            if (a.rowGutter !== undefined) area.push(`f.rowGutter = ${len('rowGutter')};`);
            if (a.columns !== undefined) area.push(`f.columnCount = ${num(a.columns, { min: 1, max: 100, name: 'columns' })};`);
            if (a.columnGutter !== undefined) area.push(`f.columnGutter = ${len('columnGutter')};`);
            if (a.inset !== undefined) area.push(`f.spacing = ${len('inset')};`);
            if (a.firstBaseline) area.push(`f.firstBaseline = FirstBaselineType.${FIRST_BASELINE[enumOf(a.firstBaseline, Object.keys(FIRST_BASELINE), { name: 'firstBaseline' })]};`);
            if (a.firstBaselineMin !== undefined) area.push(`f.firstBaselineMin = ${len('firstBaselineMin')};`);
            if (a.textFlow) area.push(`f.flowLinksHorizontally = ${bool(enumOf(a.textFlow, ['by_rows', 'by_columns'], { name: 'textFlow' }) === 'by_rows')};`);
            const any = [];
            if (a.opticalMarginAlignment !== undefined) any.push(`f.opticalAlignment = ${bool(a.opticalMarginAlignment)};`);
            if (a.antiAliasing) any.push(`f.antialias = TextAntialias.${ANTIALIAS[enumOf(a.antiAliasing, Object.keys(ANTIALIAS), { name: 'antiAliasing' })]};`);
            const to = a.convertTo ? enumOf(a.convertTo, ['area', 'point'], { name: 'convertTo' }) : null;
            if (!to && !area.length && !any.length) throw new Error('Give convertTo or at least one option to set');
            return run('Set text frame options', script(`${TEXT_FNS}
var frames = __frames(doc, ${targetSpec(a.target)}), out = [], notArea = [];
for (var i = 0; i < frames.length; i++) {
  var f = frames[i];
  ${to === 'area' ? 'if (f.kind == TextType.POINTTEXT) f = f.convertPointObjectToAreaObject();' : ''}
  ${to === 'point' ? 'if (f.kind == TextType.AREATEXT) f = f.convertAreaObjectToPointObject();' : ''}
  ${any.join('\n  ')}
  ${area.length ? `if (f.kind == TextType.AREATEXT) {
    ${area.join('\n    ')}
  } else notArea.push(f.name || f.uuid);` : ''}
  var info = __itemInfo(doc, f);
  info.kind = f.kind == TextType.AREATEXT ? "area" : (f.kind == TextType.POINTTEXT ? "point" : "path");
  out.push(info);
}
__result__ = { frames: out };
if (notArea.length) __result__.warnings = ["Area type options were skipped on frames that are not area type: " + notArea.join(", ")];`));
        },
    },
    {
        name: 'thread_text_frames',
        description: 'Thread text between area or path type frames (Type > Threaded Text): link flows text through the frames in the order given; release takes the frames out of their threads, keeping the rest linked (Release Selection); remove breaks every thread through them, leaving the text in place (Remove Threading)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. For link, give ids in reading order` },
                operation: { type: 'string', enum: ['link', 'release', 'remove'] },
                separateParagraphs: { type: 'boolean', default: true, description: 'link: end each frame\'s text with a paragraph return before the next frame\'s text joins it' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.typography.thread_create',
            'illustrator.typography.thread_release',
            'illustrator.typography.thread_remove',
            'illustrator.typography.text_threads',
        ],
        menuCommands: Object.values(THREAD_COMMANDS),
        handler: (a) => {
            const op = enumOf(a.operation, ['link', 'release', 'remove'], { name: 'operation' });
            const spec = targetSpec(a.target);
            const report = `
var out = [];
for (var r = 0; r < frames.length; r++) {
  var info = __itemInfo(doc, frames[r]);
  info.previousFrame = frames[r].previousFrame ? frames[r].previousFrame.uuid : null;
  info.nextFrame = frames[r].nextFrame ? frames[r].nextFrame.uuid : null;
  out.push(info);
}
__result__ = { frames: out };`;
            if (op === 'link') {
                return run('Thread text', script(`${TEXT_FNS}
var frames = __frames(doc, ${spec});
if (frames.length < 2) throw new Error("Give at least two text frames, in reading order");
for (var i = 0; i < frames.length; i++) {
  if (frames[i].kind == TextType.POINTTEXT) throw new Error("Point type cannot be threaded: convert " + (frames[i].name || frames[i].uuid) + " with set_text_frame_options { convertTo: \\"area\\" }");
}
for (var j = 0; j < frames.length - 1; j++) {
  var cur = frames[j], nx = frames[j + 1];
  ${a.separateParagraphs === false ? '' : `if (nx.contents.length && cur.contents.length && !/[\\r\\n]$/.test(cur.contents)) cur.insertionPoints[cur.insertionPoints.length - 1].characters.add("\\r");`}
  cur.nextFrame = nx;
}
${report}`));
            }
            return run('Thread text', script(`${TEXT_FNS}
var frames = __frames(doc, ${spec});
doc.selection = null;
for (var i = 0; i < frames.length; i++) frames[i].selected = true;
app.executeMenuCommand(${str(THREAD_COMMANDS[op])});
${report}`));
        },
    },
];
