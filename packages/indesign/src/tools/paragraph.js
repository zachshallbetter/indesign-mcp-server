/**
 * Paragraph formatting: everything on the Paragraph panel and its menu
 * (indents and spacing, alignment, justification, hyphenation, keep options,
 * paragraph rules, borders and shading, span and split columns, drop caps and
 * nested styles), a reader for the same settings, and underline and
 * strikethrough options.
 *
 * Text is chosen by story id, by text frame id, or from the selection, and can
 * be narrowed to a range of paragraphs. Distances (indents, spacing, offsets,
 * gutters, corner radii) are millimetres; line weights and underline or
 * strikethrough offsets are points. Values are sent with their unit ("5mm",
 * "0.5pt"), so they do not depend on the script's measurement unit.
 */
import { str, num, json, enumOf } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, colorSpec } from './run.js';

/** Which text to act on. */
export const TEXT_TARGET_SCHEMA = {
    type: 'object',
    description: 'Which text to act on. Give storyIds (get_document_stories), frameIds (text frame ids from list_page_items), or selection: true; optionally narrow to a range of paragraphs',
    properties: {
        storyIds: { type: 'array', items: { type: 'integer' }, description: 'Whole stories, by story id' },
        frameIds: { type: 'array', items: { type: 'integer' }, description: 'Text frames, by page item id: the text in each frame' },
        selection: { type: 'boolean', description: 'Use the selected text, or the text of the selected text frames' },
        wholeStory: { type: 'boolean', description: 'Widen frames and selected text to their whole stories' },
        paragraphs: {
            type: 'object',
            description: 'Only these paragraphs of each text (0-based)',
            properties: {
                start: { type: 'integer', description: 'First paragraph, 0-based' },
                count: { type: 'integer', description: 'How many paragraphs (default: to the end)' },
            },
        },
    },
};

/** A text target as a JSX literal for __texts(); every key is always present, so the script can read each one. */
export function textSpec(target) {
    const t = target ?? {};
    if (typeof t !== 'object' || Array.isArray(t)) throw new Error("'target' must be an object");
    const ids = (list, name) => {
        if (list === undefined || list === null) return null;
        if (!Array.isArray(list)) throw new Error(`'${name}' must be a list of ids`);
        return list.length ? list.map((id) => Number(num(id, { min: 0, max: 1e9, name }))) : null;
    };
    const out = {
        storyIds: ids(t.storyIds, 'target.storyIds'),
        frameIds: ids(t.frameIds, 'target.frameIds'),
        selection: t.selection === true,
        wholeStory: t.wholeStory === true,
        start: null,
        count: -1,
    };
    if (out.storyIds) out.storyIds.forEach((n) => { if (!Number.isInteger(n)) throw new Error('target.storyIds: ids are integers'); });
    if (out.frameIds) out.frameIds.forEach((n) => { if (!Number.isInteger(n)) throw new Error('target.frameIds: ids are integers'); });
    if (!out.storyIds && !out.frameIds && !out.selection) {
        throw new Error('Choose the text: target.storyIds, target.frameIds, or target.selection: true');
    }
    if (t.paragraphs !== undefined && t.paragraphs !== null) {
        const p = t.paragraphs;
        if (typeof p !== 'object' || Array.isArray(p)) throw new Error("'target.paragraphs' must be { start, count }");
        const start = Number(num(p.start ?? 0, { min: 0, max: 1e7, name: 'target.paragraphs.start' }));
        const count = p.count === undefined || p.count === null ? -1 : Number(num(p.count, { min: 1, max: 1e7, name: 'target.paragraphs.count' }));
        if (!Number.isInteger(start) || !Number.isInteger(count)) throw new Error('target.paragraphs: start and count are whole numbers');
        out.start = start;
        out.count = count;
    }
    return json(out);
}

/**
 * Script helpers for text targets: __texts(doc, spec, wholeParagraphs) returns
 * [{ unit, story, first, count }], where unit is the text to set properties on
 * (whole paragraphs when wholeParagraphs is true); plus lookups for stroke
 * styles and character styles, and a property setter that names the property
 * when InDesign refuses a value.
 */
const TEXT_HELPERS = String.raw`
var __textOf = function (item, whole) {
  var n = item.constructor.name;
  if (n === "Story") return item;
  if (n === "TextFrame" || n === "TextPath") return whole ? item.parentStory : item.texts[0];
  if (n === "Text" || n === "Character" || n === "Word" || n === "Line" || n === "Paragraph" || n === "TextColumn" || n === "TextStyleRange" || n === "InsertionPoint") return whole ? item.parentStory : item;
  if (n === "Cell") return item.texts[0];
  throw new Error("The selection includes a " + n + ", which holds no text");
};
var __texts = function (doc, spec, wholeParagraphs) {
  var raw = [], out = [], i;
  if (spec.storyIds) for (i = 0; i < spec.storyIds.length; i++) {
    var st = doc.stories.itemByID(spec.storyIds[i]);
    if (!st.isValid) throw new Error("Story " + spec.storyIds[i] + " not found");
    raw.push(st.getElements()[0]);
  }
  if (spec.frameIds) for (i = 0; i < spec.frameIds.length; i++) {
    var fr = __item(doc, spec.frameIds[i]);
    if (fr.constructor.name !== "TextFrame" && fr.constructor.name !== "TextPath") throw new Error("Item " + spec.frameIds[i] + " is a " + fr.constructor.name + ", not a text frame");
    raw.push(__textOf(fr, spec.wholeStory));
  }
  if (spec.selection) {
    var sel = app.selection;
    if (!sel.length) throw new Error("Nothing is selected");
    for (i = 0; i < sel.length; i++) raw.push(__textOf(sel[i], spec.wholeStory));
  }
  for (i = 0; i < raw.length; i++) {
    var tx = raw[i], ps = tx.paragraphs, n = ps.length, sid = null;
    try { sid = (tx.constructor.name === "Story") ? tx.id : tx.parentStory.id; } catch (e0) {}
    if (spec.start !== null) {
      var a = spec.start;
      if (a >= n) throw new Error("Paragraph " + a + " is out of range; the text has " + n + " paragraphs");
      var b = spec.count < 0 ? n - 1 : Math.min(n - 1, a + spec.count - 1);
      out.push({ unit: ps.itemByRange(a, b), story: sid, first: a, count: b - a + 1 });
    } else if (wholeParagraphs) {
      if (n) out.push({ unit: ps.itemByRange(0, n - 1), story: sid, first: 0, count: n });
    } else {
      out.push({ unit: tx, story: sid, first: 0, count: n });
    }
  }
  if (!out.length) throw new Error("The chosen text has no paragraphs");
  return out;
};
var __set = function (t, p, v) {
  try { t[p] = v; } catch (e) { throw new Error(p + ": " + e.message); }
};
var __setRange = function (t, names, vals) {
  var i;
  try { for (i = 0; i < names.length; i++) t[names[i]] = vals[i]; } catch (e) {
    try { for (i = names.length - 1; i >= 0; i--) t[names[i]] = vals[i]; } catch (e2) { throw new Error(names.join(", ") + ": " + e2.message); }
  }
};
var __stroke = function (doc, name) {
  var s = doc.strokeStyles.itemByName(name);
  if (!s.isValid) throw new Error("No stroke style named " + name + " (use a Stroke panel type such as Solid, Dashed, Dotted or Thick - Thin)");
  return s.getElements()[0];
};
var __cstyle = function (doc, name) {
  var all = doc.allCharacterStyles;
  for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
  throw new Error("No character style named " + name);
};
var __bit = function (p, b, on) {
  var d = Number(p.dropcapDetail) || 0;
  p.dropcapDetail = on ? (d | b) : (d & ~b);
};
var __firstChar = function (t) {
  var e = t.getElements()[0];
  try { if (e.characters.length) return e.characters[0]; } catch (x) {}
  return e;
};
`;

/**
 * Script helpers that read settings described by a descriptor list
 * [[path, property, kind, extra, unit]] into a plain object, with enum names
 * mapped back to this tool's option values through __inv.
 */
const READ_HELPERS = String.raw`
var __put = function (o, path, v) {
  var c = o;
  for (var i = 0; i < path.length - 1; i++) { if (!c[path[i]]) c[path[i]] = {}; c = c[path[i]]; }
  c[path[path.length - 1]] = v;
};
var __rv = function (p, d) {
  var v;
  try { v = p[d[1]]; } catch (e) { return null; }
  if (v === null || v === undefined) return null;
  var k = d[2];
  if (k === "obj") { try { var nm = v.name; return nm === undefined ? String(v) : nm; } catch (e2) { return String(v); } }
  if (k === "bit") return (Number(v) & d[3]) !== 0;
  if (k === "samespace") return (v == Spacing.SETIGNORE) ? "ignore" : v;
  if (k === "spancount") return (v == SpanColumnCountOptions.ALL) ? "all" : v;
  if (k === "enum" || k === "str") {
    var s = k === "str" ? String(v) : __enumName(v), m = __inv[d[3]];
    return (m && m[s] !== undefined) ? m[s] : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  return __enumName(v);
};
var __read = function (p, desc, o) {
  var i;
  for (i = 0; i < desc.length; i++) if (desc[i][4] !== "pt") __put(o, desc[i][0], __rv(p, desc[i]));
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    for (i = 0; i < desc.length; i++) if (desc[i][4] === "pt") __put(o, desc[i][0], __rv(p, desc[i]));
  } finally {
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
  }
  return o;
};
`;

// ---------------------------------------------------------------------------
// Option tables: each option names the InDesign property it sets and how its
// value is checked. The same tables build the input schema, the setter
// statements and the reader.

const mm = (p, d, min = -5000, max = 5000) => ({ k: 'mm', p, d, min, max });
const pt = (p, d, min = 0, max = 1000) => ({ k: 'pt', p, d, min, max });
const flag = (p, d) => ({ k: 'bool', p, d });
const int = (p, d, min, max) => ({ k: 'int', p, d, min, max });
const numeric = (p, d, min, max) => ({ k: 'num', p, d, min, max });
const choice = (p, type, map, d) => ({ k: 'enum', p, type, map, d });
const swatch = (p, d) => ({ k: 'color', p, d });
const stroke = (p, d) => ({ k: 'stroke', p, d });
const cstyle = (p, d) => ({ k: 'cstyle', p, d });
const sides = (pre, post, unit, d) => ({ k: 'sides', pre, post, unit, d });
const corners = (pre, d) => ({ k: 'corners', pre, d });
const spread = (mid, d, min, max) => ({ k: 'triple', mid, d, min, max });

/** Paragraph alignment: InDesign Justification names, as the server's other alignment parameters take. */
export const JUSTIFY = Object.fromEntries([
    'LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED',
    'TO_BINDING_SIDE', 'AWAY_FROM_BINDING_SIDE',
].map((n) => [n, n]));
const GRID = {
    none: 'NONE', baseline: 'ALIGN_BASELINE', em_box_top: 'ALIGN_EM_TOP', em_box_center: 'ALIGN_EM_CENTER',
    em_box_bottom: 'ALIGN_EM_BOTTOM', icf_top: 'ALIGN_ICF_TOP', icf_bottom: 'ALIGN_ICF_BOTTOM',
};
const DIRECTION = { left_to_right: 'LEFT_TO_RIGHT_DIRECTION', right_to_left: 'RIGHT_TO_LEFT_DIRECTION' };
const SINGLE_WORD = { left: 'LEFT_ALIGN', center: 'CENTER_ALIGN', right: 'RIGHT_ALIGN', full: 'FULLY_JUSTIFIED' };
const KASHIDAS = { default: 'DEFAULT_KASHIDAS', off: 'KASHIDAS_OFF' };
const ARABIC = {
    default: 'DEFAULT_JUSTIFICATION', arabic: 'ARABIC_JUSTIFICATION', naskh: 'NASKH_JUSTIFICATION',
    naskh_kashida: 'NASKH_KASHIDA_JUSTIFICATION', naskh_kashida_fractional: 'NASKH_KASHIDA_JUSTIFICATION_FRAC',
    naskh_tatweel: 'NASKH_TATWEEL_JUSTIFICATION', naskh_tatweel_fractional: 'NASKH_TATWEEL_JUSTIFICATION_FRAC',
};
/** Composer names as InDesign's scripting expects them (locale-independent $ID/ keys). */
export const COMPOSERS = {
    paragraph: '$ID/HL Composer',
    single_line: '$ID/HL Single',
    world_ready_paragraph: '$ID/HL Composer Optyca',
    world_ready_single_line: '$ID/HL Single Optyca',
};
const COMPOSER_NAMES = {
    'Adobe Paragraph Composer': 'paragraph',
    'Adobe Single-line Composer': 'single_line',
    'Adobe World-Ready Paragraph Composer': 'world_ready_paragraph',
    'Adobe World-Ready Single-line Composer': 'world_ready_single_line',
};
const HYPH_STYLE = {
    all: 'HYPH_ALL', all_but_unaesthetic: 'HYPH_ALL_BUT_UNAESTHETIC',
    aesthetic: 'HYPH_AESTHETIC', preferred_aesthetic: 'HYPH_PREFERRED_AESTHETIC',
};
const START = {
    anywhere: 'ANYWHERE', next_column: 'NEXT_COLUMN', next_frame: 'NEXT_FRAME',
    next_page: 'NEXT_PAGE', next_odd_page: 'NEXT_ODD_PAGE', next_even_page: 'NEXT_EVEN_PAGE',
};
const WIDTH = { column: 'COLUMN_WIDTH', text: 'TEXT_WIDTH' };
const TOP_EDGE = { ascent: 'ASCENT_TOP_ORIGIN', baseline: 'BASELINE_TOP_ORIGIN', leading: 'LEADING_TOP_ORIGIN' };
const BOTTOM_EDGE = { baseline: 'BASELINE_BOTTOM_ORIGIN', descent: 'DESCENT_BOTTOM_ORIGIN' };
const CORNER = {
    none: 'NONE', rounded: 'ROUNDED_CORNER', inverse_rounded: 'INVERSE_ROUNDED_CORNER',
    inset: 'INSET_CORNER', bevel: 'BEVEL_CORNER', fancy: 'FANCY_CORNER',
};
const CAP = { butt: 'BUTT_END_CAP', round: 'ROUND_END_CAP', projecting: 'PROJECTING_END_CAP' };
const JOIN = { miter: 'MITER_END_JOIN', round: 'ROUND_END_JOIN', bevel: 'BEVEL_END_JOIN' };
const LAYOUT = { single_column: 'SINGLE_COLUMN', span_columns: 'SPAN_COLUMNS', split_column: 'SPLIT_COLUMNS' };
export const DELIMITERS = {
    any_character: 'ANY_CHARACTER', any_word: 'ANY_WORD', sentence: 'SENTENCE', letters: 'LETTERS', digits: 'DIGITS',
    tabs: 'TABS', forced_line_break: 'FORCED_LINE_BREAK', indent_here_tab: 'INDENT_HERE_TAB', em_space: 'EM_SPACE',
    en_space: 'EN_SPACE', nonbreaking_space: 'NONBREAKING_SPACE', inline_graphic: 'INLINE_GRAPHIC',
    auto_page_number: 'AUTO_PAGE_NUMBER', section_marker: 'SECTION_MARKER', end_nested_style: 'END_NESTED_STYLE',
    dropcap: 'DROPCAP', repeat: 'REPEAT',
};

const STROKE_TYPE = 'Stroke type by name, as in the Stroke panel (Solid, Dashed, Dotted, Thick - Thin, ...)';
const COLOR_DOC = 'a swatch name in the document, "None", or "#RRGGBB" (creates an RGB colour swatch)';

/** A paragraph rule (above or below), from the Paragraph Rules dialog. */
const rule = (P, where) => ({
    on: flag(P, `Turn the rule ${where} on or off (Rule On)`),
    weight: pt(`${P}LineWeight`, 'Line weight'),
    type: stroke(`${P}Type`, STROKE_TYPE),
    color: swatch(`${P}Color`, 'Rule colour'),
    tint: numeric(`${P}Tint`, 'Rule tint, percent', 0, 100),
    overprint: flag(`${P}Overprint`, 'Overprint the rule'),
    gapColor: swatch(`${P}GapColor`, 'Colour of the gaps in dashed, dotted or striped rules'),
    gapTint: numeric(`${P}GapTint`, 'Gap tint, percent', 0, 100),
    gapOverprint: flag(`${P}GapOverprint`, 'Overprint the gap'),
    width: choice(`${P}Width`, 'RuleWidth', WIDTH, 'Rule width: the column or the text'),
    offset: mm(`${P}Offset`, `Offset from the baseline ${where === 'above' ? 'of the first line' : 'of the last line'}`),
    leftIndent: mm(`${P}LeftIndent`, 'Left indent of the rule'),
    rightIndent: mm(`${P}RightIndent`, 'Right indent of the rule'),
    ...(where === 'above' ? { keepInFrame: flag('keepRuleAboveInFrame', 'Keep the rule above inside the frame (Keep In Frame)') } : {}),
});

/** Paragraph Borders and Shading: options both share. */
const boxed = (P, what) => ({
    corners: corners(P, `${what} corners`),
    offsets: sides(P, 'Offset', 'mm', `${what} offsets from the text`),
    topEdge: choice(`${P}TopOrigin`, `${P === 'paragraphBorder' ? 'ParagraphBorder' : 'ParagraphShading'}TopOriginEnum`, TOP_EDGE, `Where the ${what.toLowerCase()} starts at the top (Top Edge)`),
    bottomEdge: choice(`${P}BottomOrigin`, `${P === 'paragraphBorder' ? 'ParagraphBorder' : 'ParagraphShading'}BottomOriginEnum`, BOTTOM_EDGE, `Where the ${what.toLowerCase()} ends at the bottom (Bottom Edge)`),
    width: choice(`${P}Width`, P === 'paragraphBorder' ? 'ParagraphBorderEnum' : 'ParagraphShadingWidthEnum', WIDTH, `${what} width: the column or the text`),
});

/** Option groups of set_paragraph_formatting, with the atlas features each performs. */
export const GROUPS = {
    indents: {
        d: 'Indents and spacing (Paragraph panel; Paragraph Formatting > Indents and Spacing)',
        fields: {
            left: mm('leftIndent', 'Left indent'),
            right: mm('rightIndent', 'Right indent'),
            firstLine: mm('firstLineIndent', 'First line left indent'),
            lastLineRight: mm('lastLineIndent', 'Last line right indent'),
            spaceBefore: mm('spaceBefore', 'Space before', 0),
            spaceAfter: mm('spaceAfter', 'Space after', 0),
            sameStyleSpacing: { k: 'samespace', p: 'sameParaStyleSpacing', d: 'Space between paragraphs using the same style, in mm, or "ignore" to use space before and after' },
            alignToGrid: choice('gridAlignment', 'GridAlignment', GRID, 'Align to baseline grid (Align to Grid)'),
            firstLineOnlyToGrid: flag('gridAlignFirstLineOnly', 'Only align the first line to the grid'),
        },
        features: [
            'para_indents_left_indent', 'para_indents_right_indent', 'para_indents_first_line_indent',
            'para_indents_last_line_right_indent', 'para_indents_space_between_paragraphs_using_same_style',
            'para_indents_align_to_grid', 'para_indents_only_align_first_line_to_grid',
        ],
    },
    align: {
        d: 'Alignment and direction (Paragraph panel)',
        fields: {
            alignment: choice('justification', 'Justification', JUSTIFY, 'Paragraph alignment (TO_BINDING_SIDE and AWAY_FROM_BINDING_SIDE follow the spine)'),
            balanceRaggedLines: flag('balanceRaggedLines', 'Balance ragged lines'),
            ignoreOpticalMargin: flag('ignoreEdgeAlignment', 'Ignore optical margin alignment'),
            direction: choice('paragraphDirection', 'ParagraphDirectionOptions', DIRECTION, 'Paragraph direction'),
        },
        features: ['para_indents_balance_ragged_lines', 'para_indents_ignore_optical_margin', 'para_indents_paragraph_direction'],
    },
    justification: {
        d: 'Justification (Paragraph panel menu > Justification)',
        fields: {
            wordSpacing: spread('WordSpacing', 'Word spacing, percent of a normal space', 0, 1000),
            letterSpacing: spread('LetterSpacing', 'Letter spacing, percent', -100, 500),
            glyphScaling: spread('GlyphScaling', 'Glyph scaling, percent', 50, 200),
            autoLeading: numeric('autoLeading', 'Auto leading, percent of the type size', 0, 500),
            singleWordJustification: choice('singleWordJustification', 'SingleWordJustification', SINGLE_WORD, 'How a line holding a single word is justified'),
            composer: { k: 'strmap', p: 'composer', map: COMPOSERS, d: 'Composer' },
            kashidas: choice('kashidas', 'KashidasOptions', KASHIDAS, 'Kashida insertion for Arabic text'),
            method: choice('paragraphJustification', 'ParagraphJustificationOptions', ARABIC, 'Justification method for Arabic text'),
        },
        features: [
            'para_just_word_spacing', 'para_just_letter_spacing', 'para_just_glyph_scaling', 'para_just_auto_leading',
            'para_just_single_word_justification', 'para_just_composer', 'para_just_kashidas',
        ],
    },
    hyphenation: {
        d: 'Hyphenation (Paragraph panel menu > Hyphenation)',
        fields: {
            hyphenate: flag('hyphenation', 'Hyphenate'),
            wordsLongerThan: int('hyphenateWordsLongerThan', 'Words with at least this many letters', 3, 25),
            afterFirst: int('hyphenateAfterFirst', 'After first N letters', 1, 15),
            beforeLast: int('hyphenateBeforeLast', 'Before last N letters', 1, 15),
            limit: int('hyphenateLadderLimit', 'Hyphen limit: consecutive hyphens (0 for no limit)', 0, 25),
            zone: mm('hyphenationZone', 'Hyphenation zone (single-line composer)', 0),
            spacingVsHyphens: numeric('hyphenWeight', 'Better spacing (0) to fewer hyphens (10)', 0, 10),
            capitalizedWords: flag('hyphenateCapitalizedWords', 'Hyphenate capitalized words'),
            lastWord: flag('hyphenateLastWord', 'Hyphenate the last word of a paragraph'),
            acrossColumns: flag('hyphenateAcrossColumns', 'Hyphenate across a column'),
            style: choice('providerHyphenationStyle', 'HyphenationStyleEnum', HYPH_STYLE, 'Hyphenation style for the Duden dictionary (German)'),
        },
        features: [
            'para_hyph_hyphenate', 'para_hyph_words_with_at_least', 'para_hyph_after_first', 'para_hyph_before_last',
            'para_hyph_hyphen_limit', 'para_hyph_hyphenation_zone', 'para_hyph_better_spacing_fewer_hyphens',
            'para_hyph_hyphenate_capitalized_words', 'para_hyph_hyphenate_last_word', 'para_hyph_hyphenate_across_column',
            'para_hyph_hyphenation_style_duden',
        ],
    },
    keep: {
        d: 'Keep options (Paragraph panel menu > Keep Options)',
        fields: {
            withPrevious: flag('keepWithPrevious', 'Keep with previous'),
            withNextLines: int('keepWithNext', 'Keep with next N lines', 0, 5),
            linesTogether: flag('keepLinesTogether', 'Keep lines together'),
            allLines: flag('keepAllLinesTogether', 'true: all lines in paragraph; false: at start/end of paragraph'),
            startLines: int('keepFirstLines', 'At start of paragraph: keep this many lines together', 1, 50),
            endLines: int('keepLastLines', 'At end of paragraph: keep this many lines together', 1, 50),
            start: choice('startParagraph', 'StartParagraph', START, 'Start paragraph'),
        },
        features: [
            'para_keep_keep_with_previous', 'para_keep_keep_with_next_lines', 'para_keep_keep_lines_together',
            'para_keep_all_lines_in_paragraph', 'para_keep_at_start_end_of_paragraph', 'para_keep_start_paragraph',
        ],
    },
    ruleAbove: {
        d: 'Rule above (Paragraph panel menu > Paragraph Rules)',
        fields: rule('ruleAbove', 'above'),
        features: [
            'para_rules_rule_above', 'para_rules_rule_above_weight', 'para_rules_rule_above_type', 'para_rules_rule_above_color',
            'para_rules_rule_above_gap_color', 'para_rules_rule_above_overprint', 'para_rules_rule_above_width',
            'para_rules_rule_above_offset', 'para_rules_rule_above_indents', 'para_rules_keep_in_frame', 'paragraph_rules_dialog',
        ],
    },
    ruleBelow: {
        d: 'Rule below (Paragraph panel menu > Paragraph Rules)',
        fields: rule('ruleBelow', 'below'),
        features: [
            'para_rules_rule_below', 'para_rules_rule_below_weight', 'para_rules_rule_below_type', 'para_rules_rule_below_color',
            'para_rules_rule_below_gap_color', 'para_rules_rule_below_overprint', 'para_rules_rule_below_width',
            'para_rules_rule_below_offset', 'para_rules_rule_below_indents', 'paragraph_rules_dialog',
        ],
    },
    border: {
        d: 'Paragraph border (Paragraph panel menu > Paragraph Borders and Shading)',
        fields: {
            on: flag('paragraphBorderOn', 'Turn the border on or off'),
            weights: sides('paragraphBorder', 'LineWeight', 'pt', 'Stroke weight of each side'),
            type: stroke('paragraphBorderType', STROKE_TYPE),
            color: swatch('paragraphBorderColor', 'Border colour'),
            tint: numeric('paragraphBorderTint', 'Border tint, percent', 0, 100),
            overprint: flag('paragraphBorderOverprint', 'Overprint the border'),
            gapColor: swatch('paragraphBorderGapColor', 'Colour of the gaps in dashed, dotted or striped borders'),
            gapTint: numeric('paragraphBorderGapTint', 'Gap tint, percent', 0, 100),
            gapOverprint: flag('paragraphBorderGapOverprint', 'Overprint the gap'),
            cap: choice('paragraphBorderStrokeEndCap', 'EndCap', CAP, 'Stroke cap'),
            join: choice('paragraphBorderStrokeEndJoin', 'EndJoin', JOIN, 'Stroke join'),
            ...boxed('paragraphBorder', 'Border'),
            displayIfSplits: flag('paragraphBorderDisplayIfSplits', 'Display the border if the paragraph splits across frames or columns'),
            mergeConsecutive: flag('mergeConsecutiveParaBorders', 'Merge consecutive borders and shading'),
        },
        features: [
            'para_border_border', 'para_border_border_stroke_weights', 'para_border_border_type', 'para_border_border_color',
            'para_border_border_overprint', 'para_border_border_gap_color', 'para_border_border_cap_and_join',
            'para_border_border_corners', 'para_border_border_offsets', 'para_border_border_top_edge_bottom_edge',
            'para_border_border_width', 'para_border_display_border_if_paragraph_splits_across_frames_columns',
            'para_border_merge_consecutive_borders_and_shading', 'paragraph_borders_shading_dialog',
        ],
    },
    shading: {
        d: 'Paragraph shading (Paragraph panel menu > Paragraph Borders and Shading)',
        fields: {
            on: flag('paragraphShadingOn', 'Turn the shading on or off'),
            color: swatch('paragraphShadingColor', 'Shading colour'),
            tint: numeric('paragraphShadingTint', 'Shading tint, percent', 0, 100),
            overprint: flag('paragraphShadingOverprint', 'Overprint the shading'),
            ...boxed('paragraphShading', 'Shading'),
            clipToFrame: flag('paragraphShadingClipToFrame', 'Clip the shading to the frame'),
            suppressPrinting: flag('paragraphShadingSuppressPrinting', 'Do not print or export the shading'),
        },
        features: [
            'para_shading_shading', 'para_shading_shading_color', 'para_shading_shading_overprint', 'para_shading_shading_corners',
            'para_shading_shading_offsets', 'para_shading_shading_top_edge_bottom_edge', 'para_shading_shading_width',
            'para_shading_clip_to_frame', 'para_shading_do_not_print_or_export', 'paragraph_borders_shading_dialog',
        ],
    },
    columns: {
        d: 'Span or split columns (Paragraph panel menu > Span Columns)',
        fields: {
            layout: choice('spanColumnType', 'SpanColumnTypeOptions', LAYOUT, 'Paragraph layout'),
            count: { k: 'spancount', p: 'spanSplitColumnCount', d: 'Columns to span, or sub-columns to split into (1-40), or "all" to span every column' },
            spaceBefore: mm('spanColumnMinSpaceBefore', 'Space before the span or split', 0),
            spaceAfter: mm('spanColumnMinSpaceAfter', 'Space after the span or split', 0),
            insideGutter: mm('splitColumnInsideGutter', 'Gutter between split sub-columns', 0),
            outsideGutter: mm('splitColumnOutsideGutter', 'Gutter outside split sub-columns', 0),
        },
        features: [
            'para_span_paragraph_layout', 'para_span_span', 'para_span_space_before_span', 'para_span_space_after_span',
            'para_span_inside_gutter', 'para_span_outside_gutter',
        ],
    },
    dropCap: {
        d: 'Drop caps (Paragraph panel; Paragraph panel menu > Drop Caps and Nested Styles)',
        fields: {
            lines: int('dropCapLines', 'Drop cap height in lines (0 for none)', 0, 25),
            characters: int('dropCapCharacters', 'Number of drop cap characters', 0, 150),
            characterStyle: cstyle('dropCapStyle', 'Character style for the drop cap (a name, or "[None]")'),
            alignLeftEdge: { k: 'bit', p: 'dropcapDetail', bit: 1, d: 'Align the drop cap to the left edge' },
            scaleForDescenders: { k: 'bit', p: 'dropcapDetail', bit: 2, d: 'Scale the drop cap for descenders' },
        },
        features: [
            'para_dropcap_drop_cap_lines', 'para_dropcap_drop_cap_characters', 'para_dropcap_drop_cap_character_style',
            'para_dropcap_align_left_edge', 'para_dropcap_scale_for_descenders',
        ],
    },
};

const PARA_FEATURES = [
    'indesign.typography.paragraph_panel',
    ...new Set(Object.values(GROUPS).flatMap((g) => g.features.map((f) => `indesign.typography.${f}`))),
    'indesign.typography.para_dropcap_nested_styles',
    'indesign.typography.para_dropcap_nested_line_styles',
];

const SIDES = ['top', 'left', 'bottom', 'right'];
const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** The JSON schema of one option. */
function fieldSchema(f) {
    switch (f.k) {
        case 'mm': return { type: 'number', description: `${f.d} (mm)` };
        case 'pt': return { type: 'number', minimum: f.min, description: `${f.d} (points)` };
        case 'bool': case 'bit': return { type: 'boolean', description: f.d };
        case 'int': return { type: 'integer', minimum: f.min, maximum: f.max, description: f.d };
        case 'num': return { type: 'number', minimum: f.min, maximum: f.max, description: f.d };
        case 'enum': case 'strmap': return { type: 'string', enum: Object.keys(f.map), description: f.d };
        case 'color': return { type: 'string', description: `${f.d}: ${COLOR_DOC}` };
        case 'stroke': case 'cstyle': return { type: 'string', description: f.d };
        case 'samespace': return { anyOf: [{ type: 'number', minimum: 0 }, { type: 'string', enum: ['ignore'] }], description: f.d };
        case 'spancount': return { anyOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'string', enum: ['all'] }], description: f.d };
        case 'sides': return {
            type: 'object',
            description: `${f.d} (${f.unit === 'pt' ? 'points' : 'mm'}); give any of top, left, bottom, right`,
            properties: Object.fromEntries(SIDES.map((s) => [s, { type: 'number', description: `${cap(s)} side` }])),
        };
        case 'corners': {
            const one = {
                option: { type: 'string', enum: Object.keys(CORNER), description: 'Corner shape' },
                radius: { type: 'number', description: 'Corner size (mm)' },
            };
            return {
                type: 'object',
                description: `${f.d}: option and radius for all four corners, and optionally per corner`,
                properties: {
                    ...one,
                    ...Object.fromEntries(CORNERS.map((c) => [c, { type: 'object', description: `${c} corner only`, properties: one }])),
                },
            };
        }
        case 'triple': return {
            type: 'object',
            description: `${f.d}: minimum, desired and maximum`,
            properties: Object.fromEntries(['minimum', 'desired', 'maximum'].map((x) => [x, { type: 'number', description: cap(x) }])),
        };
        default: throw new Error(`unknown option kind ${f.k}`);
    }
}

const groupSchema = (g) => ({
    type: 'object',
    description: g.d,
    properties: Object.fromEntries(Object.entries(g.fields).map(([k, f]) => [k, fieldSchema(f)])),
});

/** Compile-time state for one tool call: statements per text unit, per paragraph, and lookups made once. */
function newContext() {
    return { pre: [], set: [], perPara: [], props: [], n: 0 };
}

/** Check one option value and add the statements that set it. */
function compileField(ctx, name, f, v, p = f.p) {
    const put = (expr, prop = p) => {
        ctx.set.push(`__set(t, ${str(prop)}, ${expr});`);
        ctx.props.push(prop);
    };
    const isNum = (x, label) => {
        if (typeof x !== 'number') throw new Error(`'${label}' must be a number`);
        return x;
    };
    const isBool = (x, label) => {
        if (typeof x !== 'boolean') throw new Error(`'${label}' must be true or false`);
        return x;
    };
    const isObj = (x, label, keys) => {
        if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`'${label}' must be an object`);
        for (const k of Object.keys(x)) if (!keys.includes(k)) throw new Error(`Unknown option '${label}.${k}'. Known: ${keys.join(', ')}`);
        return x;
    };
    const isName = (x, label) => {
        if (typeof x !== 'string' || !x.trim()) throw new Error(`'${label}' must be a name`);
        if (x.length > 200) throw new Error(`'${label}': name too long`);
        return x;
    };
    switch (f.k) {
        case 'mm':
            return put(str(`${num(isNum(v, name), { min: f.min, max: f.max, name })}mm`));
        case 'pt':
            return put(str(`${num(isNum(v, name), { min: f.min, max: f.max, name })}pt`));
        case 'bool':
            return put(isBool(v, name) ? 'true' : 'false');
        case 'int':
            if (!Number.isInteger(v)) throw new Error(`'${name}' must be a whole number`);
            return put(num(v, { min: f.min, max: f.max, name }));
        case 'num':
            return put(num(isNum(v, name), { min: f.min, max: f.max, name }));
        case 'enum':
            return put(`${f.type}.${f.map[enumOf(v, Object.keys(f.map), { name })]}`);
        case 'strmap':
            return put(str(f.map[enumOf(v, Object.keys(f.map), { name })]));
        case 'color': {
            const id = `__c${ctx.n++}`;
            ctx.pre.push(`var ${id} = __swatch(doc, ${colorSpec(v, name)});`);
            return put(id);
        }
        case 'stroke': {
            const id = `__s${ctx.n++}`;
            ctx.pre.push(`var ${id} = __stroke(doc, ${str(isName(v, name))});`);
            return put(id);
        }
        case 'cstyle': {
            const id = `__k${ctx.n++}`;
            ctx.pre.push(`var ${id} = __cstyle(doc, ${str(isName(v, name))});`);
            return put(id);
        }
        case 'samespace':
            if (v === 'ignore') return put('Spacing.SETIGNORE');
            return put(str(`${num(isNum(v, name), { min: 0, max: 5000, name })}mm`));
        case 'spancount':
            if (v === 'all') return put('SpanColumnCountOptions.ALL');
            if (!Number.isInteger(v)) throw new Error(`'${name}' must be a whole number from 1 to 40, or "all"`);
            return put(num(v, { min: 1, max: 40, name }));
        case 'bit':
            ctx.perPara.push(`__bit(p, ${f.bit}, ${isBool(v, name) ? 'true' : 'false'});`);
            ctx.props.push(`dropcapDetail (${name.split('.').pop()})`);
            return undefined;
        case 'sides':
            isObj(v, name, SIDES);
            for (const s of SIDES) {
                if (v[s] === undefined || v[s] === null) continue;
                compileField(ctx, `${name}.${s}`, f.unit === 'pt' ? pt(null, '') : mm(null, ''), v[s], `${f.pre}${cap(s)}${f.post}`);
            }
            return undefined;
        case 'corners': {
            isObj(v, name, ['option', 'radius', ...CORNERS]);
            const one = (c, o, label) => {
                if (o.option !== undefined && o.option !== null) compileField(ctx, `${label}.option`, choice(null, 'CornerOptions', CORNER, ''), o.option, `${f.pre}${cap(c)}CornerOption`);
                if (o.radius !== undefined && o.radius !== null) compileField(ctx, `${label}.radius`, mm(null, '', 0), o.radius, `${f.pre}${cap(c)}CornerRadius`);
            };
            for (const c of CORNERS) one(c, v, name);
            for (const c of CORNERS) {
                if (v[c] === undefined || v[c] === null) continue;
                one(c, isObj(v[c], `${name}.${c}`, ['option', 'radius']), `${name}.${c}`);
            }
            return undefined;
        }
        case 'triple': {
            isObj(v, name, ['minimum', 'desired', 'maximum']);
            const given = ['minimum', 'desired', 'maximum'].filter((x) => v[x] !== undefined && v[x] !== null);
            if (!given.length) return undefined;
            const vals = given.map((x) => num(isNum(v[x], `${name}.${x}`), { min: f.min, max: f.max, name: `${name}.${x}` }));
            for (let i = 1; i < given.length; i++) {
                if (v[given[i - 1]] > v[given[i]]) throw new Error(`'${name}': ${given[i - 1]} must not exceed ${given[i]}`);
            }
            // Set in rising order, or falling order if InDesign refuses a minimum above the current desired value.
            const props = given.map((x) => `${x}${f.mid}`);
            ctx.set.push(`__setRange(t, ${json(props)}, [${vals.join(', ')}]);`);
            ctx.props.push(...props);
            return undefined;
        }
        default:
            throw new Error(`unknown option kind ${f.k}`);
    }
}

/** Check one group of options. */
function compileGroup(ctx, gname, fields, value) {
    if (value === undefined || value === null) return;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${gname}' must be an object`);
    for (const [key, v] of Object.entries(value)) {
        const f = fields[key];
        if (!f) throw new Error(`Unknown option '${gname}.${key}'. Known: ${Object.keys(fields).join(', ')}`);
        if (v === undefined || v === null) continue;
        compileField(ctx, `${gname}.${key}`, f, v);
    }
}

/** Nested styles and nested line styles: each list replaces the paragraph's own. */
function compileNested(ctx, nested, lineStyles) {
    const style = (x, label) => {
        if (typeof x !== 'string' || !x.trim() || x.length > 200) throw new Error(`'${label}' must be a character style name`);
        const id = `__k${ctx.n++}`;
        ctx.pre.push(`var ${id} = __cstyle(doc, ${str(x)});`);
        return id;
    };
    if (nested !== undefined && nested !== null) {
        if (!Array.isArray(nested)) throw new Error("'nestedStyles' must be a list");
        if (nested.length > 50) throw new Error("'nestedStyles': at most 50 entries");
        ctx.perPara.push('for (var __n = p.nestedStyles.length - 1; __n >= 0; __n--) p.nestedStyles[__n].remove();');
        nested.forEach((e, i) => {
            const label = `nestedStyles[${i}]`;
            if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new Error(`'${label}' must be an object`);
            for (const k of Object.keys(e)) {
                if (!['characterStyle', 'delimiter', 'characters', 'repetition', 'inclusive'].includes(k)) throw new Error(`Unknown option '${label}.${k}'`);
            }
            if (e.delimiter !== undefined && e.characters !== undefined) throw new Error(`'${label}': give delimiter or characters, not both`);
            let delim;
            if (e.characters !== undefined) {
                if (typeof e.characters !== 'string' || !e.characters.length || e.characters.length > 10) throw new Error(`'${label}.characters' must be 1 to 10 characters`);
                delim = str(e.characters);
            } else {
                delim = `NestedStyleDelimiters.${DELIMITERS[enumOf(e.delimiter ?? 'any_word', Object.keys(DELIMITERS), { name: `${label}.delimiter` })]}`;
            }
            const rep = e.repetition ?? 1;
            if (!Number.isInteger(rep)) throw new Error(`'${label}.repetition' must be a whole number`);
            if (e.inclusive !== undefined && typeof e.inclusive !== 'boolean') throw new Error(`'${label}.inclusive' must be true or false`);
            const cs = style(e.characterStyle, `${label}.characterStyle`);
            ctx.perPara.push(`p.nestedStyles.add({ appliedCharacterStyle: ${cs}, delimiter: ${delim}, repetition: ${num(rep, { min: 1, max: 999, name: `${label}.repetition` })}, inclusive: ${e.inclusive === false ? 'false' : 'true'} });`);
        });
        ctx.props.push('nestedStyles');
    }
    if (lineStyles !== undefined && lineStyles !== null) {
        if (!Array.isArray(lineStyles)) throw new Error("'nestedLineStyles' must be a list");
        if (lineStyles.length > 50) throw new Error("'nestedLineStyles': at most 50 entries");
        ctx.perPara.push('for (var __m = p.nestedLineStyles.length - 1; __m >= 0; __m--) p.nestedLineStyles[__m].remove();');
        lineStyles.forEach((e, i) => {
            const label = `nestedLineStyles[${i}]`;
            if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new Error(`'${label}' must be an object`);
            for (const k of Object.keys(e)) if (!['characterStyle', 'lines'].includes(k)) throw new Error(`Unknown option '${label}.${k}'`);
            const lines = e.lines ?? 1;
            if (!Number.isInteger(lines)) throw new Error(`'${label}.lines' must be a whole number`);
            const cs = style(e.characterStyle, `${label}.characterStyle`);
            ctx.perPara.push(`p.nestedLineStyles.add({ appliedCharacterStyle: ${cs}, lineCount: ${num(lines, { min: 1, max: 999, name: `${label}.lines` })} });`);
        });
        ctx.props.push('nestedLineStyles');
    }
}

/** The apply loop shared by the setters; `each` runs after each text is set. */
function applyBody(spec, wholeParagraphs, ctx, each = '') {
    return `${TEXT_HELPERS}
var __tx = __texts(doc, ${spec}, ${wholeParagraphs ? 'true' : 'false'});
${ctx.pre.join('\n')}
var __paras = 0, __now = [];
for (var __i = 0; __i < __tx.length; __i++) {
  var t = __tx[__i].unit;
  ${ctx.set.join('\n  ')}
  ${ctx.perPara.length ? `var __ps = t.getElements();
  for (var __j = 0; __j < __ps.length; __j++) {
    var p = __ps[__j];
    ${ctx.perPara.join('\n    ')}
  }` : ''}
  __paras += __tx[__i].count;
  ${each}
}`;
}

// ---------------------------------------------------------------------------
// Reading

/** Descriptor entries [[path], property, kind, extra, unit] for the reader. */
function describe(prefix, fields) {
    const out = [];
    for (const [key, f] of Object.entries(fields)) {
        const path = [...prefix, key];
        switch (f.k) {
            case 'mm': out.push([path, f.p, 'v', null, 'mm']); break;
            case 'pt': out.push([path, f.p, 'v', null, 'pt']); break;
            case 'bool': case 'int': case 'num': out.push([path, f.p, 'v', null, 'mm']); break;
            case 'enum': out.push([path, f.p, 'enum', f.type, 'mm']); break;
            case 'strmap': out.push([path, f.p, 'str', f.p, 'mm']); break;
            case 'color': case 'stroke': case 'cstyle': out.push([path, f.p, 'obj', null, 'mm']); break;
            case 'samespace': out.push([path, f.p, 'samespace', null, 'mm']); break;
            case 'spancount': out.push([path, f.p, 'spancount', null, 'mm']); break;
            case 'bit': out.push([path, f.p, 'bit', f.bit, 'mm']); break;
            case 'sides': for (const s of SIDES) out.push([[...path, s], `${f.pre}${cap(s)}${f.post}`, 'v', null, f.unit]); break;
            case 'corners': for (const c of CORNERS) {
                out.push([[...path, c, 'option'], `${f.pre}${cap(c)}CornerOption`, 'enum', 'CornerOptions', 'mm']);
                out.push([[...path, c, 'radius'], `${f.pre}${cap(c)}CornerRadius`, 'v', null, 'mm']);
            } break;
            case 'triple': for (const x of ['minimum', 'desired', 'maximum']) out.push([[...path, x], `${x}${f.mid}`, 'v', null, 'mm']); break;
            default: throw new Error(`unknown option kind ${f.k}`);
        }
    }
    return out;
}

/** Enum names back to option values, for every enum type the tables use. */
function inverseMaps(groupList) {
    const inv = { CornerOptions: Object.fromEntries(Object.entries(CORNER).map(([k, v]) => [v, k])) };
    for (const fields of groupList) {
        for (const f of Object.values(fields)) {
            if (f.k === 'enum') inv[f.type] = Object.fromEntries(Object.entries(f.map).map(([k, v]) => [v, k]));
            if (f.k === 'strmap') inv[f.p] = { ...Object.fromEntries(Object.entries(f.map).map(([k, v]) => [v, k])), ...COMPOSER_NAMES };
        }
    }
    return inv;
}

const READ_GROUPS = [...Object.keys(GROUPS), 'nestedStyles'];

/** Underline and strikethrough options, from the Character panel menu. */
const lineOptions = (on, P, what) => ({
    on: flag(on, `Turn ${what} on or off`),
    weight: pt(`${P}Weight`, `${cap(what)} weight`),
    offset: pt(`${P}Offset`, `${cap(what)} offset from the baseline`, -1000, 1000),
    type: stroke(`${P}Type`, STROKE_TYPE),
    color: swatch(`${P}Color`, `${cap(what)} colour`),
    tint: numeric(`${P}Tint`, 'Tint, percent', 0, 100),
    overprint: flag(`${P}Overprint`, 'Overprint the stroke'),
    gapColor: swatch(`${P}GapColor`, 'Colour of the gaps in dashed, dotted or striped lines'),
    gapTint: numeric(`${P}GapTint`, 'Gap tint, percent', 0, 100),
    gapOverprint: flag(`${P}GapOverprint`, 'Overprint the gap'),
});
export const LINE_GROUPS = {
    underline: { d: 'Underline (Character panel menu > Underline Options; Type shortcut Shift+Cmd+U)', fields: lineOptions('underline', 'underline', 'underline') },
    strikethrough: { d: 'Strikethrough (Character panel menu > Strikethrough Options; Type shortcut)', fields: lineOptions('strikeThru', 'strikeThrough', 'strikethrough') },
};
const lineGroupSchema = (g) => {
    const s = groupSchema(g);
    s.properties.toggle = { type: 'boolean', description: 'Toggle on or off, as the keyboard shortcut does: turns it on unless the first character already has it' };
    return s;
};

export const tools = [
    {
        name: 'set_paragraph_formatting',
        description: 'Set paragraph formatting on text: indents and spacing, alignment, justification, hyphenation, keep options, rules above and below, borders and shading, span and split columns, drop caps and nested styles (Paragraph panel and its menu: Justification, Hyphenation, Keep Options, Paragraph Rules, Paragraph Borders and Shading, Span Columns, Drop Caps and Nested Styles). Only the options given change. Distances are mm, line weights points',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET_SCHEMA,
                ...Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, groupSchema(g)])),
                nestedStyles: {
                    type: 'array',
                    description: 'Nested styles (Drop Caps and Nested Styles); replaces the paragraphs\' nested styles, [] clears them',
                    items: {
                        type: 'object',
                        properties: {
                            characterStyle: { type: 'string', description: 'Character style name' },
                            delimiter: { type: 'string', enum: Object.keys(DELIMITERS), description: 'Where the style ends (default any_word)' },
                            characters: { type: 'string', description: 'Or: end at these literal characters (1 to 10)' },
                            repetition: { type: 'integer', description: 'How many delimiters (default 1)' },
                            inclusive: { type: 'boolean', description: 'true: through the delimiter (default); false: up to it' },
                        },
                        required: ['characterStyle'],
                    },
                },
                nestedLineStyles: {
                    type: 'array',
                    description: 'Nested line styles (Drop Caps and Nested Styles); replaces the paragraphs\' nested line styles, [] clears them',
                    items: {
                        type: 'object',
                        properties: {
                            characterStyle: { type: 'string', description: 'Character style name' },
                            lines: { type: 'integer', description: 'For how many lines (default 1)' },
                        },
                        required: ['characterStyle'],
                    },
                },
            },
            required: ['target'],
        },
        features: PARA_FEATURES,
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            target: { storyIds: [1], paragraphs: { start: 0, count: 2 } },
            indents: { left: 5, right: 2, firstLine: 3, lastLineRight: 1, spaceBefore: 2, spaceAfter: 1, sameStyleSpacing: 'ignore', alignToGrid: 'baseline', firstLineOnlyToGrid: true },
            align: { alignment: 'LEFT_JUSTIFIED', balanceRaggedLines: true, ignoreOpticalMargin: false, direction: 'left_to_right' },
            justification: { wordSpacing: { minimum: 80, desired: 100, maximum: 133 }, letterSpacing: { minimum: 0, desired: 0, maximum: 0 }, glyphScaling: { minimum: 100, desired: 100, maximum: 100 }, autoLeading: 120, singleWordJustification: 'left', composer: 'paragraph', kashidas: 'default', method: 'default' },
            hyphenation: { hyphenate: true, wordsLongerThan: 5, afterFirst: 2, beforeLast: 2, limit: 3, zone: 12.7, spacingVsHyphens: 5, capitalizedWords: true, lastWord: true, acrossColumns: true, style: 'all' },
            keep: { withPrevious: false, withNextLines: 1, linesTogether: true, allLines: false, startLines: 2, endLines: 2, start: 'next_column' },
            ruleAbove: { on: true, weight: 1, type: 'Solid', color: 'Black', tint: 100, overprint: false, gapColor: 'None', gapTint: 100, gapOverprint: false, width: 'column', offset: 2, leftIndent: 0, rightIndent: 0, keepInFrame: true },
            ruleBelow: { on: true, weight: 0.5, type: 'Dashed', color: '#336699', width: 'text', offset: 1 },
            border: { on: true, weights: { top: 1, left: 1, bottom: 1, right: 1 }, type: 'Solid', color: 'Black', tint: 100, overprint: false, gapColor: 'None', gapTint: 100, gapOverprint: false, cap: 'butt', join: 'miter', corners: { option: 'rounded', radius: 2, topLeft: { option: 'none' } }, offsets: { top: 1, left: 1, bottom: 1, right: 1 }, topEdge: 'ascent', bottomEdge: 'descent', width: 'column', displayIfSplits: true, mergeConsecutive: true },
            shading: { on: true, color: 'Paper', tint: 20, overprint: false, corners: { option: 'bevel', radius: 1 }, offsets: { top: 1, bottom: 1 }, topEdge: 'leading', bottomEdge: 'baseline', width: 'text', clipToFrame: true, suppressPrinting: false },
            columns: { layout: 'span_columns', count: 'all', spaceBefore: 2, spaceAfter: 2, insideGutter: 4, outsideGutter: 0 },
            dropCap: { lines: 3, characters: 1, characterStyle: 'Drop', alignLeftEdge: true, scaleForDescenders: false },
            nestedStyles: [{ characterStyle: 'Lead', delimiter: 'sentence', repetition: 1, inclusive: true }, { characterStyle: '[None]', characters: ':' }],
            nestedLineStyles: [{ characterStyle: 'Small Caps', lines: 2 }],
        },
        handler: (a) => {
            const spec = textSpec(a.target);
            const ctx = newContext();
            for (const [k, g] of Object.entries(GROUPS)) compileGroup(ctx, k, g.fields, a[k]);
            compileNested(ctx, a.nestedStyles, a.nestedLineStyles);
            const known = new Set(['target', ...Object.keys(GROUPS), 'nestedStyles', 'nestedLineStyles']);
            for (const k of Object.keys(a)) if (!known.has(k)) throw new Error(`Unknown option '${k}'. Known: ${[...known].join(', ')}`);
            if (!ctx.props.length) throw new Error(`Nothing to set: give at least one option in ${[...known].filter((k) => k !== 'target').join(', ')}`);
            return run('Set paragraph formatting', script(`${applyBody(spec, true, ctx)}
__result__ = { texts: __tx.length, paragraphs: __paras, set: ${json(ctx.props)} };`));
        },
    },
    {
        name: 'get_paragraph_formatting',
        description: 'Read the paragraph formatting of text, paragraph by paragraph: indents and spacing, alignment, justification, hyphenation, keep options, rules, borders, shading, span and split columns, drop caps and nested styles (Paragraph panel and its menu). Distances are mm, line weights points',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET_SCHEMA,
                groups: { type: 'array', items: { type: 'string', enum: READ_GROUPS }, description: 'Which groups of settings to read (default: all)' },
                maxParagraphs: { type: 'integer', minimum: 1, maximum: 500, default: 20, description: 'Read at most this many paragraphs' },
            },
            required: ['target'],
        },
        features: ['indesign.typography.paragraph_panel'],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { target: { frameIds: [10], wholeStory: true }, groups: READ_GROUPS, maxParagraphs: 20 },
        handler: (a) => {
            const spec = textSpec(a.target);
            const asked = a.groups === undefined || a.groups === null ? READ_GROUPS : a.groups;
            if (!Array.isArray(asked) || !asked.length) throw new Error("'groups' must be a non-empty list");
            const groups = [...new Set(asked.map((g) => enumOf(g, READ_GROUPS, { name: 'groups' })))];
            const max = num(a.maxParagraphs ?? 20, { min: 1, max: 500, name: 'maxParagraphs' });
            if (!Number.isInteger(Number(max))) throw new Error("'maxParagraphs' must be a whole number");
            const chosen = groups.filter((g) => GROUPS[g]);
            const desc = chosen.flatMap((g) => describe([g], GROUPS[g].fields));
            const inv = { ...inverseMaps(chosen.map((g) => GROUPS[g].fields)), NestedStyleDelimiters: Object.fromEntries(Object.entries(DELIMITERS).map(([k, v]) => [v, k])) };
            const nested = groups.includes('nestedStyles');
            return run('Get paragraph formatting', script(`${TEXT_HELPERS}
var __inv = ${json(inv)};
${READ_HELPERS}
var __tx = __texts(doc, ${spec}, true), __desc = ${json(desc)}, __max = ${max}, out = [], more = 0;
for (var __i = 0; __i < __tx.length; __i++) {
  var __ps = __tx[__i].unit.getElements();
  for (var __j = 0; __j < __ps.length; __j++) {
    if (out.length >= __max) { more++; continue; }
    var p = __ps[__j], o = {};
    o.story = __tx[__i].story;
    o.paragraph = __tx[__i].first + __j;
    try { o.style = p.appliedParagraphStyle.name; } catch (e1) { o.style = null; }
    o.text = String(p.contents).substring(0, 60);
    __read(p, __desc, o);
    ${nested ? `o.nestedStyles = [];
    for (var __n = 0; __n < p.nestedStyles.length; __n++) {
      var ns = p.nestedStyles[__n], d = ns.delimiter, e = { characterStyle: ns.appliedCharacterStyle.name, repetition: ns.repetition, inclusive: ns.inclusive };
      if (typeof d === "string") e.characters = d; else e.delimiter = __inv["NestedStyleDelimiters"][__enumName(d)] || __enumName(d);
      o.nestedStyles.push(e);
    }
    o.nestedLineStyles = [];
    for (var __m = 0; __m < p.nestedLineStyles.length; __m++) {
      var nl = p.nestedLineStyles[__m];
      o.nestedLineStyles.push({ characterStyle: nl.appliedCharacterStyle.name, lines: nl.lineCount });
    }` : ''}
    out.push(o);
  }
}
__result__ = { paragraphs: out, notListed: more };`));
        },
    },
    {
        name: 'set_underline_and_strikethrough',
        description: 'Turn underline and strikethrough on, off or toggle them, and set their options: weight, offset, type, colour, tint, overprint, gap colour, gap tint and gap overprint (Character panel menu > Underline Options and Strikethrough Options; the Underline and Strikethrough shortcuts). Weights and offsets are points',
        inputSchema: {
            type: 'object',
            properties: {
                target: TEXT_TARGET_SCHEMA,
                underline: lineGroupSchema(LINE_GROUPS.underline),
                strikethrough: lineGroupSchema(LINE_GROUPS.strikethrough),
            },
            required: ['target'],
        },
        features: [
            'indesign.typography.underline_shortcut', 'indesign.typography.strikethrough_shortcut',
            'indesign.typography.underline_options', 'indesign.typography.strikethrough_options',
            ...['on', 'weight', 'offset', 'type', 'color', 'overprint_stroke', 'gap_color', 'overprint_gap'].flatMap((x) => [
                `indesign.typography.underline_underline_${x}`, `indesign.typography.strikethrough_strikethrough_${x}`,
            ]),
        ],
        hints: { readOnly: false },
        auditArgs: {
            target: { selection: true },
            underline: { on: true, weight: 1, offset: -2, type: 'Solid', color: 'Black', tint: 100, overprint: false, gapColor: 'None', gapTint: 100, gapOverprint: false },
            strikethrough: { toggle: true, weight: 0.5, offset: 3, type: 'Dotted', color: '#FF0000', tint: 50, overprint: true, gapColor: 'Paper', gapTint: 100, gapOverprint: false },
        },
        handler: (a) => {
            const spec = textSpec(a.target);
            const ctx = newContext();
            for (const k of Object.keys(a)) if (!['target', 'underline', 'strikethrough'].includes(k)) throw new Error(`Unknown option '${k}'. Known: target, underline, strikethrough`);
            for (const [k, g] of Object.entries(LINE_GROUPS)) {
                const v = a[k];
                if (v === undefined || v === null) continue;
                if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`'${k}' must be an object`);
                const { toggle, ...rest } = v;
                if (toggle !== undefined && toggle !== null) {
                    if (typeof toggle !== 'boolean') throw new Error(`'${k}.toggle' must be true or false`);
                    if (rest.on !== undefined && rest.on !== null) throw new Error(`'${k}': give on or toggle, not both`);
                    if (toggle) {
                        ctx.set.push(`__set(t, ${str(g.fields.on.p)}, !__firstChar(t)[${str(g.fields.on.p)}]);`);
                        ctx.props.push(`${g.fields.on.p} (toggled)`);
                    }
                }
                compileGroup(ctx, k, g.fields, rest);
            }
            if (!ctx.props.length) throw new Error('Nothing to set: give underline or strikethrough options');
            const desc = Object.entries(LINE_GROUPS).flatMap(([k, g]) => describe([k], g.fields));
            return run('Set underline and strikethrough', script(`var __inv = {};
${READ_HELPERS}
var __desc = ${json(desc)};
${applyBody(spec, false, ctx, '__now.push(__read(__firstChar(t), __desc, { story: __tx[__i].story }));')}
__result__ = { texts: __tx.length, set: ${json(ctx.props)}, atStart: __now };`));
        },
    },
];
