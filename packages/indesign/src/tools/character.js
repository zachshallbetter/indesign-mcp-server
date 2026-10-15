/**
 * Character formatting and type commands: Character panel, OpenType, CJK and
 * Middle Eastern character options, keyboard type commands, special
 * characters and glyphs, Change Case, fonts, story options, tabs, GREP styles,
 * and bullets and numbering (Type menu; Character, Paragraph, Story, Tabs and
 * Glyphs panels).
 *
 * Text is chosen with TEXT_SCHEMA: text frames by id (their text, or the whole
 * story), stories by id, or the selection, optionally narrowed to a character
 * or paragraph range. Measurements are millimetres; type sizes, leading,
 * baseline shift and stroke weights are points.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, COLOR_SCHEMA, colorSpec } from './run.js';

// ---------------------------------------------------------------------------
// Choosing text
// ---------------------------------------------------------------------------

/** Text chosen by frame id, story id or the selection, optionally narrowed to a range. */
export const TEXT_SCHEMA = {
    type: 'object',
    description: 'Which text to act on. Give text frame ids, story ids, or selection: true; optionally narrow each to a character range (start/end) or a paragraph range (paragraphs)',
    properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Text frame ids (PageItem.id); acts on the text in each frame, or its whole story with wholeStory' },
        storyIds: { type: 'array', items: { type: 'integer' }, description: 'Story ids (from get_document_stories)' },
        selection: { type: 'boolean', description: 'Use the selected text, or the text of the selected text frames' },
        wholeStory: { type: 'boolean', description: 'For frames and selected text, act on the whole story they belong to' },
        start: { type: 'integer', minimum: 0, description: 'First character (0-based, within each chosen text)' },
        end: { type: 'integer', minimum: 0, description: 'Last character, inclusive (default: the end of the text)' },
        paragraphs: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2, description: '[first, last] paragraph indexes (0-based, inclusive) within each chosen text' },
    },
};

/** A text choice as a JSX literal for __texts(); every key is present. */
export function textSpec(text) {
    const t = text ?? {};
    const ints = (v, name) => (Array.isArray(v) && v.length ? v.map((x) => Number(index(x, { name, max: 1e9 }))) : null);
    const out = {
        ids: ints(t.ids, 'text.ids'),
        storyIds: ints(t.storyIds, 'text.storyIds'),
        selection: !!t.selection,
        wholeStory: !!t.wholeStory,
        start: null,
        end: null,
        paragraphs: null,
    };
    if (!out.ids && !out.storyIds && !out.selection) throw new Error('Choose the text: text.ids (text frames), text.storyIds, or text.selection: true');
    const has = (v) => v !== undefined && v !== null;
    if (has(t.paragraphs)) {
        if (has(t.start) || has(t.end)) throw new Error('Give either a character range (text.start/text.end) or text.paragraphs, not both');
        if (!Array.isArray(t.paragraphs) || t.paragraphs.length !== 2) throw new Error('text.paragraphs must be [first, last]');
        const [a, b] = t.paragraphs.map((x) => Number(index(x, { name: 'text.paragraphs', max: 1e7 })));
        if (b < a) throw new Error('text.paragraphs: last comes before first');
        out.paragraphs = [a, b];
    } else if (has(t.start) || has(t.end)) {
        out.start = has(t.start) ? Number(index(t.start, { name: 'text.start', max: 1e9 })) : 0;
        if (has(t.end)) {
            out.end = Number(index(t.end, { name: 'text.end', max: 1e9 }));
            if (out.end < out.start) throw new Error('text.end comes before text.start');
        }
    }
    return json(out);
}

/**
 * ES3 helpers for text. __texts() returns entries { story, start, end } in
 * story indexes (end exclusive); __range() is a specifier for setting
 * attributes, __text() a single Text object for methods, __first() the first
 * character (or the insertion point), __paras() the paragraphs touched.
 */
const TEXT_HELPERS = String.raw`
var __TEXT_KINDS = ",Text,Character,Word,Line,Paragraph,TextColumn,TextStyleRange,InsertionPoint,Story,";
function __texts(doc, spec) {
  var bases = [], out = [], i, it, nm;
  var addBase = function (o) {
    var kind = o.constructor.name;
    if (kind === "Story") { bases.push({ obj: o, story: o, start: 0, end: o.length }); return; }
    var len = kind === "InsertionPoint" ? 0 : o.length;
    bases.push({ obj: o, story: o.parentStory, start: o.index, end: o.index + len });
  };
  if (spec.selection) {
    var sel = app.selection;
    for (i = 0; i < sel.length; i++) {
      it = sel[i]; nm = it.constructor.name;
      if (nm === "TextFrame" || nm === "TextPath") addBase(spec.wholeStory ? it.parentStory : it.texts[0]);
      else if (__TEXT_KINDS.indexOf("," + nm + ",") >= 0) addBase(spec.wholeStory && nm !== "Story" ? it.parentStory : it);
      else throw new Error("The selection holds a " + nm + ", not text or a text frame");
    }
  }
  if (spec.ids) for (i = 0; i < spec.ids.length; i++) {
    it = __item(doc, spec.ids[i]); nm = it.constructor.name;
    if (nm !== "TextFrame") throw new Error("Item " + spec.ids[i] + " is a " + nm + ", not a text frame");
    addBase(spec.wholeStory ? it.parentStory : it.texts[0]);
  }
  if (spec.storyIds) for (i = 0; i < spec.storyIds.length; i++) {
    var st = doc.stories.itemByID(spec.storyIds[i]);
    if (!st.isValid) throw new Error("Story " + spec.storyIds[i] + " not found");
    addBase(st.getElements()[0]);
  }
  if (!bases.length) throw new Error("No text to act on: pass ids, storyIds, or selection: true with text or a text frame selected");
  for (i = 0; i < bases.length; i++) {
    var b = bases[i];
    if (spec.paragraphs) {
      var pc = b.obj.paragraphs;
      if (spec.paragraphs[0] >= pc.length) throw new Error("Paragraph " + spec.paragraphs[0] + " is out of range; the text has " + pc.length + " paragraphs");
      var fp = pc[spec.paragraphs[0]], lp = pc[Math.min(spec.paragraphs[1], pc.length - 1)];
      out.push({ story: b.story, start: fp.index, end: lp.index + lp.length });
    } else if (spec.start !== null) {
      var a = b.start + spec.start;
      if (a > b.end) throw new Error("Character " + spec.start + " is out of range; the text has " + (b.end - b.start) + " characters");
      var z = spec.end === null ? b.end : Math.min(b.start + spec.end + 1, b.end);
      out.push({ story: b.story, start: a, end: Math.max(a, z) });
    } else {
      out.push({ story: b.story, start: b.start, end: b.end });
    }
  }
  return out;
}
function __range(e) {
  return e.end > e.start ? e.story.characters.itemByRange(e.start, e.end - 1) : e.story.insertionPoints[e.start];
}
function __text(e) {
  if (e.end <= e.start) return e.story.insertionPoints[e.start];
  return e.story.texts.itemByRange(e.story.characters[e.start], e.story.characters[e.end - 1]).getElements()[0];
}
function __first(e) {
  return e.end > e.start ? e.story.characters[e.start] : e.story.insertionPoints[e.start];
}
function __paras(e) {
  var a = e.story.insertionPoints[e.start].paragraphs[0];
  var b = e.end > e.start ? e.story.characters[e.end - 1].paragraphs[0] : a;
  return e.story.paragraphs.itemByRange(a, b).getElements();
}
function __textInfo(e) {
  return { storyId: e.story.id, start: e.start, length: e.end - e.start };
}
`;

/** ES3 helpers for fonts and character styles by name. */
const NAME_HELPERS = String.raw`
function __fontOf(name) {
  var f = app.fonts.itemByName(name);
  if (f.isValid) return f;
  if (name.indexOf("\t") < 0) return name;
  throw new Error("Font " + name.replace("\t", " ") + " is not installed (give \"Family\\tStyle\" or a family name)");
}
function __charStyle(doc, name) {
  var all = doc.allCharacterStyles;
  for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
  throw new Error("No character style named " + name);
}
`;

/** A tool body with the text and name helpers. */
const textScript = (body, opts) => script(TEXT_HELPERS + NAME_HELPERS + body, opts);

/** Font names given as "Family\tStyle" (or with a literal backslash-t) or a family name. */
export function fontName(value, name = 'fontName') {
    const v = String(value ?? '').replace(/\\t/g, '\t').trim();
    if (!v) throw new Error(`'${name}' is empty`);
    if (v.length > 200) throw new Error(`'${name}' is too long`);
    return v;
}

/** A Unicode code point given as a number, "2022", "U+2022" or "0x2022". */
export function codePoint(value, name = 'unicode') {
    let n = value;
    if (typeof value === 'string') {
        const m = /^(?:U\+|0x)?([0-9a-f]{1,6})$/i.exec(value.trim());
        if (!m) throw new Error(`'${name}' must be a hexadecimal code point such as "2022" or "U+2022"`);
        n = parseInt(m[1], 16);
    }
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error(`'${name}' is not a valid Unicode code point: ${JSON.stringify(value)}`);
    return n;
}

/** A JSX string literal for a code point, written as \u escapes only. */
function codePointLiteral(cp) {
    const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    return '"' + units.map((u) => '\\u' + u.toString(16).padStart(4, '0')).join('') + '"';
}

const has = (v) => v !== undefined && v !== null;

// ---------------------------------------------------------------------------
// set_character_attributes
// ---------------------------------------------------------------------------

const N = (prop, min, max, description, integer = false) => ({ prop, kind: 'num', min, max, description, integer });
const B = (prop, description) => ({ prop, kind: 'bool', description });
const E = (prop, enumName, values, description) => ({ prop, kind: 'enum', enumName, values, description });
const S = (prop, description, maxLength = 200) => ({ prop, kind: 'str', description, maxLength });
const F = (prop, description) => ({ prop, kind: 'font', description });
const C = (prop, description) => ({ prop, kind: 'color', description });

const OT_POSITION = ['NORMAL', 'SUPERSCRIPT', 'SUBSCRIPT', 'OT_SUPERSCRIPT', 'OT_SUBSCRIPT', 'OT_NUMERATOR', 'OT_DENOMINATOR'];

/** Character panel, Advanced Character Formats and Character Color attributes. */
export const CHARACTER_ATTRIBUTES = {
    fontName: F('appliedFont', 'Font as "Family\\tStyle" (e.g. "Minion Pro\\tBold") or a family name; a composite font name also works'),
    fontStyle: S('fontStyle', 'Font style within the family, e.g. "Bold Italic"', 100),
    pointSize: N('pointSize', 0.1, 1296, 'Font size in points'),
    leading: N('leading', 0, 5000, 'Leading in points'),
    autoLeading: { prop: 'leading', kind: 'auto', description: 'true sets leading to Auto' },
    kerningMethod: { prop: 'kerningMethod', kind: 'map', map: { metrics: '$ID/Metric', optical: '$ID/Optical', none: 'None' }, description: 'Pair kerning: metrics, optical or none (manual)' },
    kerningValue: N('kerningValue', -1000, 10000, 'Manual kerning in thousandths of an em (applies between characters; set at an insertion point or on a range)'),
    tracking: N('tracking', -1000, 10000, 'Tracking in thousandths of an em'),
    horizontalScale: N('horizontalScale', 1, 1000, 'Horizontal scale, percent'),
    verticalScale: N('verticalScale', 1, 1000, 'Vertical scale, percent'),
    baselineShift: N('baselineShift', -5000, 5000, 'Baseline shift in points (positive raises)'),
    skew: N('skew', -85, 85, 'Skew (false italic) angle in degrees'),
    characterRotation: N('characterRotation', -360, 360, 'Character rotation in degrees, counter-clockwise'),
    capitalization: E('capitalization', 'Capitalization', ['NORMAL', 'ALL_CAPS', 'SMALL_CAPS', 'CAP_TO_SMALL_CAP'], 'Case: NORMAL, ALL_CAPS, SMALL_CAPS, or CAP_TO_SMALL_CAP (OpenType All Small Caps)'),
    position: E('position', 'Position', OT_POSITION, 'Position: NORMAL, SUPERSCRIPT, SUBSCRIPT, or the OpenType OT_SUPERSCRIPT (superior), OT_SUBSCRIPT (inferior), OT_NUMERATOR, OT_DENOMINATOR'),
    ligatures: B('ligatures', 'Standard ligatures (fi, fl; also Arabic and Hebrew ligature formation)'),
    noBreak: B('noBreak', 'No Break: keep the text on one line'),
    strikethrough: B('strikeThru', 'Strikethrough on or off'),
    language: { prop: 'appliedLanguage', kind: 'language', description: 'Language for spelling and hyphenation, e.g. "English: USA" or "German: 2006 Reform"' },
    fillColor: C('fillColor', 'Text fill colour'),
    fillTint: N('fillTint', 0, 100, 'Fill tint, percent'),
    strokeColor: C('strokeColor', 'Text stroke colour'),
    strokeTint: N('strokeTint', 0, 100, 'Stroke tint, percent'),
    strokeWeight: N('strokeWeight', 0, 800, 'Text stroke weight in points'),
    strokeAlignment: E('strokeAlignment', 'TextStrokeAlign', ['CENTER_ALIGNMENT', 'OUTSIDE_ALIGNMENT'], 'Text stroke alignment'),
    strokeJoin: E('endJoin', 'OutlineJoin', ['MITER_END_JOIN', 'ROUND_END_JOIN', 'BEVEL_END_JOIN'], 'Text stroke join'),
    miterLimit: N('miterLimit', 1, 500, 'Miter limit for text strokes'),
    overprintFill: B('overprintFill', 'Overprint the text fill'),
    overprintStroke: B('overprintStroke', 'Overprint the text stroke'),
    designAxes: { prop: 'designAxes', kind: 'numList', description: 'Variable font axis values, in the font\'s axis order (see manage_fonts list for axis names)' },
};

/** Character panel menu > OpenType. */
export const OPENTYPE_ATTRIBUTES = {
    discretionaryLigatures: B('otfDiscretionaryLigature', 'Discretionary ligatures'),
    fractions: B('otfFraction', 'Fractions'),
    ordinals: B('otfOrdinal', 'Ordinal'),
    swash: B('otfSwash', 'Swash'),
    titlingAlternates: B('otfTitling', 'Titling alternates'),
    contextualAlternates: B('otfContextualAlternate', 'Contextual alternates'),
    slashedZero: B('otfSlashedZero', 'Slashed zero'),
    stylisticSets: { prop: 'otfStylisticSets', kind: 'sets', description: 'Stylistic sets to turn on, numbers 1-20; [] turns them all off' },
    positionalForm: E('positionalForm', 'PositionalForms', ['NONE', 'CALCULATE', 'INITIAL', 'MEDIAL', 'FINAL', 'ISOLATED'], 'Positional forms: NONE (general), CALCULATE (automatic), INITIAL, MEDIAL, FINAL, ISOLATED'),
    figureStyle: E('otfFigureStyle', 'OTFFigureStyle', ['DEFAULT_VALUE', 'TABULAR_LINING', 'PROPORTIONAL_OLDSTYLE', 'PROPORTIONAL_LINING', 'TABULAR_OLDSTYLE'], 'Figure style'),
    historicalAlternates: B('otfHistorical', 'Historical alternates'),
    stylisticAlternates: B('otfStylisticAlternate', 'Stylistic alternates'),
    justificationAlternates: B('otfJustificationAlternate', 'Justification alternates'),
    proportionalMetrics: B('otfProportionalMetrics', 'Proportional metrics (CJK)'),
    romanItalics: B('otfRomanItalics', 'Roman italics (CJK fonts)'),
    localizedForms: B('otfLocale', 'Localized forms for the applied language'),
    overlapSwash: B('otfOverlapSwash', 'Overlap swash'),
    stretchedAlternates: B('otfStretchedAlternate', 'Stretched alternates'),
    markPositioning: B('otfMark', 'Mark positioning'),
    hvKana: B('otfHVKana', 'Horizontal or vertical kana alternates'),
    glyphForm: E('glyphForm', 'AlternateGlyphForms', ['NONE', 'TRADITIONAL_FORM', 'EXPERT_FORM', 'JIS78_FORM', 'JIS83_FORM', 'JIS90_FORM', 'JIS04_FORM', 'NLC_FORM', 'FULL_WIDTH_FORM', 'PROPORTIONAL_WIDTH_FORM', 'MONOSPACED_HALF_WIDTH_FORM', 'THIRD_WIDTH_FORM', 'QUARTER_WIDTH_FORM'], 'Alternate glyph form substituted for the standard glyphs'),
};

/** Character panel menu CJK options: ruby, kenten, warichu, shatai, tate-chu-yoko, mojikumi, kinsoku, aki, tsume. */
export const CJK_ATTRIBUTES = {
    tsume: N('tsume', 0, 100, 'Tsume: horizontal compression around the character, percent'),
    leadingAki: N('leadingAki', -1, 100, 'Aki before each character (-1 for automatic)'),
    trailingAki: N('trailingAki', -1, 100, 'Aki after each character (-1 for automatic)'),
    characterAlignment: E('characterAlignment', 'CharacterAlignment', ['ALIGN_BASELINE', 'ALIGN_EM_TOP', 'ALIGN_EM_CENTER', 'ALIGN_EM_BOTTOM', 'ALIGN_ICF_TOP', 'ALIGN_ICF_BOTTOM'], 'Alignment of small characters to the largest in the line'),
    bunriKinshi: B('bunriKinshi', 'Bunri-kinshi: keep .., ... and -- from separating at a line break'),
    rotateRoman: B('rotateSingleByteCharacters', 'Rotate half-width Roman characters upright in vertical text'),
    rensuuji: B('rensuuji', 'Rensuuji: no line breaks inside multi-digit numbers'),
    cjkGridTracking: B('cjkGridTracking', 'Use grid tracking for CJK characters in frame grids'),
    jidori: N('jidori', 0, 1000, 'Jidori: number of grid squares to arrange the text in', true),
    gridGyoudori: N('gridGyoudori', 0, 100, 'Gyoudori: number of grid lines a line occupies', true),
    paragraphGyoudori: B('paragraphGyoudori', 'Apply gyoudori to the whole paragraph rather than each line'),
    mojikumi: { prop: 'mojikumi', kind: 'table', tables: 'mojikumiTables', enumName: 'MojikumiTableDefaults', label: 'mojikumi set', description: 'Mojikumi set: a mojikumi table name in the document, or a MojikumiTableDefaults name such as LINE_END_ALL_ONE_HALF_EM_ENUM; NOTHING turns it off' },
    kinsokuSet: { prop: 'kinsokuSet', kind: 'table', tables: 'kinsokuTables', enumName: 'KinsokuSet', label: 'kinsoku set', description: 'Kinsoku set: a kinsoku table name, or HARD_KINSOKU, SOFT_KINSOKU, KOREAN_KINSOKU, SIMPLIFIED_CHINESE_KINSOKU, TRADITIONAL_CHINESE_KINSOKU or NOTHING' },
    kinsokuType: E('kinsokuType', 'KinsokuType', ['KINSOKU_PUSH_IN_FIRST', 'KINSOKU_PUSH_OUT_FIRST', 'KINSOKU_PUSH_OUT_ONLY', 'KINSOKU_PRIORITIZE_ADJUSTMENT_AMOUNT'], 'Kinsoku processing type'),
    kinsokuHangType: E('kinsokuHangType', 'KinsokuHangTypes', ['NONE', 'KINSOKU_HANG_REGULAR', 'KINSOKU_HANG_FORCE'], 'Hanging punctuation under kinsoku'),
    tateChuYoko: B('tatechuyoko', 'Tate-chu-yoko: set the characters horizontally in vertical text'),
    tateChuYokoXOffset: N('tatechuyokoXOffset', -1000, 1000, 'Tate-chu-yoko horizontal offset'),
    tateChuYokoYOffset: N('tatechuyokoYOffset', -1000, 1000, 'Tate-chu-yoko vertical offset'),
    autoTcy: N('autoTcy', 0, 9, 'Auto tate-chu-yoko: run this many half-width characters or fewer horizontally (0 off)', true),
    autoTcyIncludeRoman: B('autoTcyIncludeRoman', 'Auto tate-chu-yoko includes Roman characters'),
    shataiMagnification: N('shataiMagnification', 0, 100, 'Shatai obliquing amount, percent'),
    shataiAngle: N('shataiDegreeAngle', 0, 360, 'Shatai lens angle in degrees'),
    shataiAdjustRotation: B('shataiAdjustRotation', 'Shatai: adjust rotation'),
    shataiAdjustTsume: B('shataiAdjustTsume', 'Shatai: adjust tsume'),
    warichu: B('warichu', 'Warichu: set the text as inline notes in several small lines'),
    warichuLines: N('warichuLines', 1, 100, 'Warichu lines', true),
    warichuSize: N('warichuSize', 1, 100, 'Warichu size, percent of the parent text'),
    warichuLineSpacing: N('warichuLineSpacing', -1000, 1000, 'Gap between warichu lines in points'),
    warichuAlignment: E('warichuAlignment', 'WarichuAlignment', ['AUTO', 'LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'LEFT_JUSTIFIED', 'CENTER_JUSTIFIED', 'RIGHT_JUSTIFIED', 'FULLY_JUSTIFIED'], 'Warichu alignment'),
    warichuCharsBeforeBreak: N('warichuCharsBeforeBreak', 1, 100, 'Minimum warichu characters before a line break', true),
    warichuCharsAfterBreak: N('warichuCharsAfterBreak', 1, 100, 'Minimum warichu characters after a line break', true),
    kentenKind: E('kentenKind', 'KentenCharacter', ['NONE', 'KENTEN_SESAME_DOT', 'KENTEN_WHITE_SESAME_DOT', 'KENTEN_BLACK_CIRCLE', 'KENTEN_WHITE_CIRCLE', 'KENTEN_BLACK_TRIANGLE', 'KENTEN_WHITE_TRIANGLE', 'KENTEN_BULLSEYE', 'KENTEN_FISHEYE', 'KENTEN_SMALL_BLACK_CIRCLE', 'KENTEN_SMALL_WHITE_CIRCLE', 'CUSTOM'], 'Kenten (emphasis mark) character; NONE removes kenten'),
    kentenCustomCharacter: S('kentenCustomCharacter', 'Custom kenten character (with kentenKind CUSTOM)', 10),
    kentenCharacterSet: E('kentenCharacterSet', 'KentenCharacterSet', ['CHARACTER_INPUT', 'SHIFT_JIS', 'JIS', 'KUTEN', 'UNICODE'], 'How the custom kenten character is given'),
    kentenPosition: E('kentenPosition', 'RubyKentenPosition', ['ABOVE_RIGHT', 'BELOW_LEFT'], 'Kenten position'),
    kentenAlignment: E('kentenAlignment', 'KentenAlignment', ['ALIGN_KENTEN_LEFT', 'ALIGN_KENTEN_CENTER'], 'Kenten alignment'),
    kentenFontName: F('kentenFont', 'Kenten font ("Family\\tStyle" or family)'),
    kentenFontSize: N('kentenFontSize', 0.1, 1296, 'Kenten size in points'),
    kentenColor: C('kentenFillColor', 'Kenten colour'),
    kentenPlacement: N('kentenPlacement', -1000, 1000, 'Distance between kenten and the characters'),
    kentenXScale: N('kentenXScale', 1, 1000, 'Kenten horizontal scale, percent'),
    kentenYScale: N('kentenYScale', 1, 1000, 'Kenten vertical scale, percent'),
    ruby: B('rubyFlag', 'Ruby on or off'),
    rubyString: S('rubyString', 'Ruby text', 500),
    rubyType: E('rubyType', 'RubyTypes', ['GROUP_RUBY', 'PER_CHARACTER_RUBY'], 'Group or per-character (mono) ruby'),
    rubyAlignment: E('rubyAlignment', 'RubyAlignments', ['RUBY_LEFT', 'RUBY_CENTER', 'RUBY_RIGHT', 'RUBY_FULL_JUSTIFY', 'RUBY_JIS', 'RUBY_EQUAL_AKI', 'RUBY_1_AKI'], 'Ruby alignment'),
    rubyPosition: E('rubyPosition', 'RubyKentenPosition', ['ABOVE_RIGHT', 'BELOW_LEFT'], 'Ruby position'),
    rubyFontName: F('rubyFont', 'Ruby font ("Family\\tStyle" or family)'),
    rubyFontSize: N('rubyFontSize', 0.1, 1296, 'Ruby size in points'),
    rubyColor: C('rubyFill', 'Ruby colour'),
    rubyXOffset: N('rubyXOffset', -1000, 1000, 'Horizontal space between ruby and parent'),
    rubyYOffset: N('rubyYOffset', -1000, 1000, 'Vertical space between ruby and parent'),
    rubyXScale: N('rubyXScale', 1, 1000, 'Ruby horizontal scale, percent'),
    rubyYScale: N('rubyYScale', 1, 1000, 'Ruby vertical scale, percent'),
    rubyParentSpacing: E('rubyParentSpacing', 'RubyParentSpacing', ['RUBY_PARENT_NO_ADJUSTMENT', 'RUBY_PARENT_BOTH_SIDES', 'RUBY_PARENT_121_AKI', 'RUBY_PARENT_EQUAL_AKI', 'RUBY_PARENT_FULL_JUSTIFY'], 'Spacing of the parent text under ruby'),
    rubyOverhang: E('rubyParentOverhangAmount', 'RubyOverhang', ['NONE', 'RUBY_OVERHANG_ONE_RUBY', 'RUBY_OVERHANG_HALF_RUBY', 'RUBY_OVERHANG_ONE_CHAR', 'RUBY_OVERHANG_HALF_CHAR', 'RUBY_OVERHANG_NO_LIMIT'], 'How far ruby may overhang the parent text'),
    rubyAutoAlign: B('rubyAutoAlign', 'Auto-align ruby'),
    rubyAutoScaling: B('rubyAutoScaling', 'Scale ruby to rubyParentScalingPercent of the parent size'),
    rubyParentScalingPercent: N('rubyParentScalingPercent', 1, 1000, 'Ruby size as a percent of the parent text size'),
};

/** Middle Eastern (World-Ready) character options. */
export const WORLD_READY_ATTRIBUTES = {
    characterDirection: E('characterDirection', 'CharacterDirectionOptions', ['DEFAULT_DIRECTION', 'LEFT_TO_RIGHT_DIRECTION', 'RIGHT_TO_LEFT_DIRECTION'], 'Character direction'),
    keyboardDirection: E('keyboardDirection', 'CharacterDirectionOptions', ['DEFAULT_DIRECTION', 'LEFT_TO_RIGHT_DIRECTION', 'RIGHT_TO_LEFT_DIRECTION'], 'Keyboard direction'),
    digitsType: E('digitsType', 'DigitsTypeOptions', ['DEFAULT_DIGITS', 'ARABIC_DIGITS', 'HINDI_DIGITS', 'FARSI_DIGITS', 'FULL_FARSI_DIGITS', 'NATIVE_DIGITS', 'DEVANAGARI_DIGITS', 'BENGALI_DIGITS', 'GUJARATI_DIGITS', 'GURMUKHI_DIGITS', 'KANNADA_DIGITS', 'MALAYALAM_DIGITS', 'ORIYA_DIGITS', 'TAMIL_DIGITS', 'TELUGU_DIGITS', 'THAI_DIGITS', 'LAO_DIGITS', 'KHMER_DIGITS', 'BURMESE_DIGITS', 'TIBETAN_DIGITS'], 'Digits'),
    kashidas: E('kashidas', 'KashidasOptions', ['DEFAULT_KASHIDAS', 'KASHIDAS_OFF'], 'Insert kashidas for justification'),
    kashidaWidth: N('paragraphKashidaWidth', 0, 3, 'Paragraph kashida width: 0 none, 1 short, 2 medium, 3 long', true),
    diacriticPosition: E('diacriticPosition', 'DiacriticPositionOptions', ['DEFAULT_POSITION', 'LOOSE_POSITION', 'MEDIUM_POSITION', 'TIGHT_POSITION', 'OPENTYPE_POSITION', 'OPENTYPE_POSITION_FROM_BASELINE'], 'Diacritic positioning'),
    diacriticXOffset: N('xOffsetDiacritic', -1000, 1000, 'Diacritic horizontal offset'),
    diacriticYOffset: N('yOffsetDiacritic', -1000, 1000, 'Diacritic vertical offset'),
};

const ATTRIBUTE_GROUPS = {
    character: { table: CHARACTER_ATTRIBUTES, description: 'Character panel, Advanced Character Formats and Character Color options' },
    opentype: { table: OPENTYPE_ATTRIBUTES, description: 'Character panel menu > OpenType options (applied when the font has the feature)' },
    cjk: { table: CJK_ATTRIBUTES, description: 'CJK options: ruby, kenten, warichu, shatai, tate-chu-yoko, mojikumi, kinsoku, aki, tsume, gyoudori' },
    worldReady: { table: WORLD_READY_ATTRIBUTES, description: 'Middle Eastern and Indic options: direction, digits, kashidas, diacritics' },
};

/** JSON schema for one attribute. */
function attributeSchema(a) {
    switch (a.kind) {
        case 'num': return { type: a.integer ? 'integer' : 'number', minimum: a.min, maximum: a.max, description: a.description };
        case 'bool': case 'auto': return { type: 'boolean', description: a.description };
        case 'enum': return { type: 'string', enum: a.values, description: a.description };
        case 'map': return { type: 'string', enum: Object.keys(a.map), description: a.description };
        case 'color': return { ...COLOR_SCHEMA, description: `${a.description}: ${COLOR_SCHEMA.description}` };
        case 'numList': return { type: 'array', items: { type: 'number' }, description: a.description };
        case 'sets': return { type: 'array', items: { type: 'integer', minimum: 1, maximum: 20 }, description: a.description };
        default: return { type: 'string', description: a.description };
    }
}

const groupSchema = (g) => ({
    type: 'object',
    description: g.description,
    properties: Object.fromEntries(Object.entries(g.table).map(([k, a]) => [k, attributeSchema(a)])),
    additionalProperties: false,
});

/**
 * Statements setting the attributes on `t`, plus statements run once before
 * the loop (fonts, swatches, languages and tables resolved once).
 */
export function attributeStatements(args) {
    const pre = [], set = [], names = [];
    let n = 0;
    for (const [group, { table }] of Object.entries(ATTRIBUTE_GROUPS)) {
        const given = args?.[group];
        if (!has(given)) continue;
        if (typeof given !== 'object' || Array.isArray(given)) throw new Error(`'${group}' must be an object`);
        for (const [key, value] of Object.entries(given)) {
            if (!has(value)) continue;
            const a = table[key];
            const label = `${group}.${key}`;
            if (!a) throw new Error(`Unknown ${group} attribute '${key}'. Known: ${Object.keys(table).join(', ')}`);
            names.push(label);
            const v = `__v${n++}`;
            switch (a.kind) {
                case 'num': {
                    const x = num(value, { min: a.min, max: a.max, name: label });
                    if (a.integer && !Number.isInteger(Number(x))) throw new Error(`'${label}' must be a whole number`);
                    set.push(`t.${a.prop} = ${x};`);
                    break;
                }
                case 'bool':
                    if (typeof value !== 'boolean') throw new Error(`'${label}' must be true or false`);
                    set.push(`t.${a.prop} = ${bool(value)};`);
                    break;
                case 'auto':
                    if (value !== true) throw new Error(`'${label}' only takes true (give character.leading for a fixed value)`);
                    set.push(`t.${a.prop} = Leading.AUTO;`);
                    break;
                case 'enum':
                    set.push(`t.${a.prop} = ${a.enumName}.${enumOf(value, a.values, { name: label })};`);
                    break;
                case 'map':
                    set.push(`t.${a.prop} = ${str(a.map[enumOf(value, Object.keys(a.map), { name: label })])};`);
                    break;
                case 'str': {
                    const s = String(value);
                    if (s.length > a.maxLength) throw new Error(`'${label}' is too long`);
                    set.push(`t.${a.prop} = ${str(s)};`);
                    break;
                }
                case 'font':
                    pre.push(`var ${v} = __fontOf(${str(fontName(value, label))});`);
                    set.push(`t.${a.prop} = ${v};`);
                    break;
                case 'color':
                    pre.push(`var ${v} = __swatch(doc, ${colorSpec(value, label)});`);
                    set.push(`t.${a.prop} = ${v};`);
                    break;
                case 'language': {
                    const s = String(value);
                    if (!s || s.length > 100) throw new Error(`'${label}' must be a language name`);
                    pre.push(`var ${v} = app.languagesWithVendors.itemByName(${str(s)});`,
                        `if (!${v}.isValid) throw new Error(${str(`No language named ${s}`)});`);
                    set.push(`t.${a.prop} = ${v};`);
                    break;
                }
                case 'numList':
                    if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error(`'${label}' must be a list of 1 to 16 numbers`);
                    set.push(`t.${a.prop} = [${value.map((x) => num(x, { name: label })).join(', ')}];`);
                    break;
                case 'sets': {
                    if (!Array.isArray(value)) throw new Error(`'${label}' must be a list of set numbers 1-20`);
                    let mask = 0;
                    for (const s of value) mask |= 1 << (Number(index(s, { name: label, max: 20 })) - 1);
                    if (value.some((s) => Number(s) < 1)) throw new Error(`'${label}': stylistic sets are numbered 1-20`);
                    set.push(`t.${a.prop} = ${mask >>> 0};`);
                    break;
                }
                case 'table': {
                    const s = String(value);
                    if (!s || s.length > 200) throw new Error(`'${label}' must be a name`);
                    // A set name in the document, or one of the built-in sets by enum name.
                    const lookup = `{ ${v} = doc.${a.tables}.itemByName(${str(s)}); if (!${v}.isValid) throw new Error(${str(`No ${a.label} named ${s}`)}); }`;
                    pre.push(/^[A-Z][A-Z0-9_]*$/.test(s)
                        ? `var ${v} = ${a.enumName}[${str(s)}];\nif (${v} === undefined) ${lookup}`
                        : `var ${v};\n${lookup}`);
                    set.push(`t.${a.prop} = ${v};`);
                    break;
                }
                default:
                    throw new Error(`Unhandled attribute kind ${a.kind}`);
            }
        }
    }
    if (!names.length) throw new Error('Give at least one attribute in character, opentype, cjk or worldReady');
    return { pre, set, names };
}

// ---------------------------------------------------------------------------
// apply_type_command
// ---------------------------------------------------------------------------

/** Helpers for type commands: step a property run by run, toggle from the first character. */
const COMMAND_HELPERS = String.raw`
function __mapRuns(e, prop, fn) {
  if (e.end <= e.start) { var ip = e.story.insertionPoints[e.start]; ip[prop] = fn(ip[prop], ip); return; }
  var vals = e.story.characters.itemByRange(e.start, e.end - 1)[prop];
  if (!(vals instanceof Array)) vals = [vals];
  var from = 0;
  for (var k = 1; k <= vals.length; k++) {
    if (k < vals.length && vals[k] == vals[from]) continue;
    var ch = e.story.characters[e.start + from];
    var nv = fn(vals[from], ch);
    if (nv !== vals[from]) e.story.characters.itemByRange(e.start + from, e.start + k - 1)[prop] = nv;
    from = k;
  }
}
function __step(e, prop, delta, lo, hi) {
  __mapRuns(e, prop, function (v, ch) {
    if (prop === "leading" && v == Leading.AUTO) v = ch.pointSize * ch.autoLeading / 100;
    return Math.max(lo, Math.min(hi, Number(v) + delta));
  });
}
function __face(e, pick, warnings) {
  __mapRuns(e, "fontStyle", function (v, ch) {
    var want = pick(String(v)), fam = null;
    try { fam = ch.appliedFont.fontFamily; } catch (x) {}
    if (fam && !app.fonts.itemByName(fam + "\t" + want).isValid) { warnings.push(fam + " has no " + want + " face"); return v; }
    return want;
  });
}
`;

const COMPOSER = {
    paragraph: '$ID/HL Composer',
    single: '$ID/HL Single',
    wrParagraph: '$ID/HL Composer Optyca',
    wrSingle: '$ID/HL Single Optyca',
};

const toggleEnum = (prop, enumName, on, off) =>
    `__range(e).${prop} = (__first(e).${prop} == ${enumName}.${on}) ? ${enumName}.${off} : ${enumName}.${on};`;
const toggleBool = (prop) => `__range(e).${prop} = !__first(e).${prop};`;
const justify = (v) => `__range(e).justification = Justification.${v};`;

/**
 * Type commands as object-model statements on entry `e`; `amt` is the step
 * (the caller's amount, or the command's default) and `warnings` collects notes.
 * [statements, default step or null]
 */
export const TYPE_COMMANDS = {
    increase_size: ['__step(e, "pointSize", amt, 0.1, 1296);', 2],
    decrease_size: ['__step(e, "pointSize", -amt, 0.1, 1296);', 2],
    increase_leading: ['__step(e, "leading", amt, 0, 5000);', 2],
    decrease_leading: ['__step(e, "leading", -amt, 0, 5000);', 2],
    auto_leading: ['__range(e).leading = Leading.AUTO;', null],
    increase_kerning_tracking: ['if (e.end <= e.start) __step(e, "kerningValue", amt, -1000, 10000); else __step(e, "tracking", amt, -1000, 10000);', 20],
    decrease_kerning_tracking: ['if (e.end <= e.start) __step(e, "kerningValue", -amt, -1000, 10000); else __step(e, "tracking", -amt, -1000, 10000);', 20],
    reset_kerning_tracking: ['var km = String(__first(e).kerningMethod); var r = __range(e); r.kerningMethod = /optical/i.test(km) ? "$ID/Optical" : "$ID/Metric"; r.tracking = 0;', null],
    raise_baseline: ['__step(e, "baselineShift", amt, -5000, 5000);', 2],
    lower_baseline: ['__step(e, "baselineShift", -amt, -5000, 5000);', 2],
    increase_horizontal_scale: ['__step(e, "horizontalScale", amt, 1, 1000);', 5],
    decrease_horizontal_scale: ['__step(e, "horizontalScale", -amt, 1, 1000);', 5],
    increase_vertical_scale: ['__step(e, "verticalScale", amt, 1, 1000);', 5],
    decrease_vertical_scale: ['__step(e, "verticalScale", -amt, 1, 1000);', 5],
    reset_horizontal_scale: ['__range(e).horizontalScale = 100;', null],
    reset_vertical_scale: ['__range(e).verticalScale = 100;', null],
    bold: ['__face(e, function (s) { return /italic|oblique/i.test(s) ? "Bold Italic" : "Bold"; }, warnings);', null],
    italic: ['__face(e, function (s) { return /bold/i.test(s) ? "Bold Italic" : "Italic"; }, warnings);', null],
    normal: ['__face(e, function (s) { return "Regular"; }, warnings);', null],
    toggle_all_caps: [toggleEnum('capitalization', 'Capitalization', 'ALL_CAPS', 'NORMAL'), null],
    toggle_small_caps: [toggleEnum('capitalization', 'Capitalization', 'SMALL_CAPS', 'NORMAL'), null],
    toggle_superscript: [toggleEnum('position', 'Position', 'SUPERSCRIPT', 'NORMAL'), null],
    toggle_subscript: [toggleEnum('position', 'Position', 'SUBSCRIPT', 'NORMAL'), null],
    toggle_ligatures: [toggleBool('ligatures'), null],
    toggle_no_break: [toggleBool('noBreak'), null],
    align_left: [justify('LEFT_ALIGN'), null],
    align_center: [justify('CENTER_ALIGN'), null],
    align_right: [justify('RIGHT_ALIGN'), null],
    justify_left: [justify('LEFT_JUSTIFIED'), null],
    justify_center: [justify('CENTER_JUSTIFIED'), null],
    justify_right: [justify('RIGHT_JUSTIFIED'), null],
    justify_all: [justify('FULLY_JUSTIFIED'), null],
    align_towards_spine: [justify('TO_BINDING_SIDE'), null],
    align_away_from_spine: [justify('AWAY_FROM_BINDING_SIDE'), null],
    toggle_align_to_grid: [toggleEnum('gridAlignment', 'GridAlignment', 'ALIGN_BASELINE', 'NONE'), null],
    toggle_hyphenation: [toggleBool('hyphenation'), null],
    toggle_ignore_optical_margin: [toggleBool('ignoreEdgeAlignment'), null],
    paragraph_composer: [`__range(e).composer = ${str(COMPOSER.paragraph)};`, null],
    single_line_composer: [`__range(e).composer = ${str(COMPOSER.single)};`, null],
    world_ready_paragraph_composer: [`__range(e).composer = ${str(COMPOSER.wrParagraph)};`, null],
    world_ready_single_line_composer: [`__range(e).composer = ${str(COMPOSER.wrSingle)};`, null],
    switch_composer: ['var c = String(__first(e).composer); __range(e).composer = "$ID/HL " + (/single/i.test(c) ? "Composer" : "Single") + (/optyca|world/i.test(c) ? " Optyca" : "");', null],
    left_to_right_paragraph: ['__range(e).paragraphDirection = ParagraphDirectionOptions.LEFT_TO_RIGHT_DIRECTION;', null],
    right_to_left_paragraph: ['__range(e).paragraphDirection = ParagraphDirectionOptions.RIGHT_TO_LEFT_DIRECTION;', null],
    set_up_right_to_left: [`var r = __range(e); r.paragraphDirection = ParagraphDirectionOptions.RIGHT_TO_LEFT_DIRECTION; r.composer = ${str(COMPOSER.wrParagraph)};`, null],
    reset_indents: ['var r = __range(e); r.leftIndent = 0; r.firstLineIndent = 0; r.rightIndent = 0;', null],
};

// ---------------------------------------------------------------------------
// insert_special_character
// ---------------------------------------------------------------------------

/** Type > Insert Special Character, Insert White Space and Insert Break Character (SpecialCharacters). */
export const SPECIAL_CHARACTERS = [
    // Break characters
    'COLUMN_BREAK', 'FRAME_BREAK', 'PAGE_BREAK', 'ODD_PAGE_BREAK', 'EVEN_PAGE_BREAK', 'FORCED_LINE_BREAK', 'DISCRETIONARY_LINE_BREAK',
    // Hyphens and dashes
    'DISCRETIONARY_HYPHEN', 'NONBREAKING_HYPHEN', 'EM_DASH', 'EN_DASH',
    // White space
    'EM_SPACE', 'EN_SPACE', 'NONBREAKING_SPACE', 'FIXED_WIDTH_NONBREAKING_SPACE', 'HAIR_SPACE', 'SIXTH_SPACE', 'THIN_SPACE',
    'QUARTER_SPACE', 'THIRD_SPACE', 'PUNCTUATION_SPACE', 'FIGURE_SPACE', 'FLUSH_SPACE',
    // Quotation marks
    'DOUBLE_LEFT_QUOTE', 'DOUBLE_RIGHT_QUOTE', 'SINGLE_LEFT_QUOTE', 'SINGLE_RIGHT_QUOTE', 'DOUBLE_STRAIGHT_QUOTE', 'SINGLE_STRAIGHT_QUOTE',
    // Symbols
    'BULLET_CHARACTER', 'COPYRIGHT_SYMBOL', 'DEGREE_SYMBOL', 'ELLIPSIS_CHARACTER', 'PARAGRAPH_SYMBOL', 'REGISTERED_TRADEMARK', 'SECTION_SYMBOL', 'TRADEMARK_SYMBOL',
    // Other
    'RIGHT_INDENT_TAB', 'INDENT_HERE_TAB', 'END_NESTED_STYLE', 'ZERO_WIDTH_NONJOINER', 'ZERO_WIDTH_JOINER', 'DOTTED_CIRCLE',
    // Middle Eastern
    'ARABIC_KASHIDA', 'ARABIC_COMMA', 'ARABIC_SEMICOLON', 'ARABIC_QUESTION_MARK', 'HEBREW_MAQAF', 'HEBREW_GERESH', 'HEBREW_GERSHAYIM', 'HEBREW_SOF_PASUK',
    'LEFT_TO_RIGHT_MARK', 'RIGHT_TO_LEFT_MARK', 'LEFT_TO_RIGHT_EMBEDDING', 'RIGHT_TO_LEFT_EMBEDDING', 'LEFT_TO_RIGHT_OVERRIDE', 'RIGHT_TO_LEFT_OVERRIDE', 'POP_DIRECTIONAL_FORMATTING',
];

// ---------------------------------------------------------------------------
// Glyphs panel menu
// ---------------------------------------------------------------------------

/** Glyphs panel menu commands (ids from the command list; none opens a dialog). */
export const GLYPH_PANEL_COMMANDS = {
    insert_recent_glyph_1: [53712, 'Insert Most Recent Glyph', true],
    insert_recent_glyph_2: [53713, 'Insert 2nd Most Recent Glyph', true],
    insert_recent_glyph_3: [53714, 'Insert 3rd Most Recent Glyph', true],
    insert_recent_glyph_4: [53715, 'Insert 4th Most Recent Glyph', true],
    insert_recent_glyph_5: [53716, 'Insert 5th Most Recent Glyph', true],
    sort_by_unicode: [53721, 'By Unicode', false],
    sort_by_glyph_id: [53720, 'By CID / GID', false],
    clear_recently_used: [53723, 'Clear All Recently Used', false],
};

// ---------------------------------------------------------------------------
// Bullets and numbering
// ---------------------------------------------------------------------------

const LIST_TYPES = ['BULLET_LIST', 'NUMBERED_LIST', 'NO_LIST'];
const NUMBER_FORMATS = ['ARABIC', 'SINGLE_LEADING_ZEROS', 'DOUBLE_LEADING_ZEROS', 'TRIPLE_LEADING_ZEROS', 'UPPER_ROMAN', 'LOWER_ROMAN', 'UPPER_LETTERS', 'LOWER_LETTERS',
    'KANJI', 'KATAKANA_MODERN', 'KATAKANA_TRADITIONAL', 'ARABIC_ALIF_BA_TAH', 'ARABIC_ABJAD', 'HEBREW_BIBLICAL', 'HEBREW_NON_STANDARD', 'FORMAT_NONE'];
const LIST_ALIGNMENTS = ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN'];
const RESTART_POLICIES = ['ANY_PREVIOUS_LEVEL', 'AFTER_SPECIFIC_LEVEL', 'RANGE_OF_LEVELS'];
const TAB_ALIGNMENTS = ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'CHARACTER_ALIGN'];

/** A short string option with a length limit. */
function shortStr(value, name, max) {
    const s = String(value);
    if (s.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return s;
}

/** Statements setting bullets and numbering on paragraph `p`, plus pre-loop statements. */
function bulletStatements(a) {
    const pre = [], set = [];
    if (has(a.listType)) set.push(`p.bulletsAndNumberingListType = ListType.${enumOf(a.listType, LIST_TYPES, { name: 'listType' })};`);
    if (has(a.list)) {
        const name = shortStr(a.list, 'list', 200);
        pre.push(`var __list = doc.numberingLists.itemByName(${str(name)});`,
            `if (!__list.isValid) throw new Error(${str(`No list named ${name}; create it with manage_numbering_lists`)});`);
        set.push('p.appliedNumberingList = __list;');
    }
    if (has(a.level)) set.push(`p.numberingLevel = ${num(a.level, { min: 1, max: 9, name: 'level' })};`);
    if (has(a.bullet)) {
        const b = a.bullet;
        if (typeof b !== 'object') throw new Error("'bullet' must be an object");
        if (has(b.glyphId)) {
            if (!has(b.fontName)) throw new Error('bullet.glyphId needs bullet.fontName');
            set.push('p.bulletChar.characterType = BulletCharacterType.GLYPH_WITH_FONT;',
                `p.bulletChar.characterValue = ${index(b.glyphId, { name: 'bullet.glyphId', max: 65535 })};`);
        } else if (has(b.unicode)) {
            set.push(`p.bulletChar.characterType = BulletCharacterType.${has(b.fontName) ? 'UNICODE_WITH_FONT' : 'UNICODE_ONLY'};`,
                `p.bulletChar.characterValue = ${codePoint(b.unicode, 'bullet.unicode')};`);
        } else {
            throw new Error('bullet needs unicode (e.g. "2022") or glyphId');
        }
        if (has(b.fontName)) {
            const f = fontName(b.fontName, 'bullet.fontName');
            const [family, style] = f.split('\t');
            set.push(`p.bulletChar.bulletsFont = ${str(family)};`);
            if (style) set.push(`p.bulletChar.bulletsFontStyle = ${str(style)};`);
        }
    }
    if (has(a.textAfter)) set.push(`p.bulletsTextAfter = ${str(shortStr(a.textAfter, 'textAfter', 100))};`);
    if (has(a.characterStyle)) {
        pre.push(`var __cs = __charStyle(doc, ${str(shortStr(a.characterStyle, 'characterStyle', 200))});`);
        set.push('p.bulletsCharacterStyle = __cs;', 'p.numberingCharacterStyle = __cs;');
    }
    if (has(a.numberExpression)) set.push(`p.numberingExpression = ${str(shortStr(a.numberExpression, 'numberExpression', 200))};`);
    if (has(a.numberFormat)) set.push(`p.numberingFormat = NumberingStyle.${enumOf(a.numberFormat, NUMBER_FORMATS, { name: 'numberFormat' })};`);
    if (has(a.mode)) {
        const mode = enumOf(a.mode, ['continue', 'start_at'], { name: 'mode' });
        set.push(`p.numberingContinue = ${bool(mode === 'continue')};`);
        if (mode === 'start_at') set.push(`p.numberingStartAt = ${index(a.startAt ?? 1, { name: 'startAt', max: 1e6 })};`);
    } else if (has(a.startAt) && a.action !== 'restart') {
        set.push('p.numberingContinue = false;', `p.numberingStartAt = ${index(a.startAt, { name: 'startAt', max: 1e6 })};`);
    }
    if (has(a.restartAfter)) {
        const r = a.restartAfter;
        if (typeof r !== 'object') throw new Error("'restartAfter' must be an object");
        if (r.enabled === false) {
            set.push('p.numberingApplyRestartPolicy = false;');
        } else {
            set.push('p.numberingApplyRestartPolicy = true;',
                `p.numberingRestartPolicies.numberingPolicy = RestartPolicy.${enumOf(r.policy ?? 'ANY_PREVIOUS_LEVEL', RESTART_POLICIES, { name: 'restartAfter.policy' })};`);
            if (has(r.lowerLevel)) set.push(`p.numberingRestartPolicies.numberingLowerLevel = ${num(r.lowerLevel, { min: 1, max: 9, name: 'restartAfter.lowerLevel' })};`);
            if (has(r.upperLevel)) set.push(`p.numberingRestartPolicies.numberingUpperLevel = ${num(r.upperLevel, { min: 1, max: 9, name: 'restartAfter.upperLevel' })};`);
        }
    }
    if (has(a.numberAlignment)) {
        const al = enumOf(a.numberAlignment, LIST_ALIGNMENTS, { name: 'numberAlignment' });
        set.push(`p.bulletsAlignment = ListAlignment.${al};`, `p.numberingAlignment = ListAlignment.${al};`);
    }
    if (has(a.leftIndent)) set.push(`p.leftIndent = ${num(a.leftIndent, { min: -5000, max: 5000, name: 'leftIndent' })};`);
    if (has(a.firstLineIndent)) set.push(`p.firstLineIndent = ${num(a.firstLineIndent, { min: -5000, max: 5000, name: 'firstLineIndent' })};`);
    if (has(a.tabPosition)) {
        const x = num(a.tabPosition, { min: 0, max: 5000, name: 'tabPosition' });
        set.push(`for (var __k = p.tabStops.length - 1; __k >= 0; __k--) if (Math.abs(p.tabStops[__k].position - ${x}) < 0.01) p.tabStops[__k].remove();`,
            `p.tabStops.add({ position: ${x}, alignment: TabStopAlignment.LEFT_ALIGN });`);
    }
    return { pre, set };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const OTF_FEATURES = [
    'otf_discretionary_ligatures', 'otf_fractions', 'otf_ordinal', 'otf_swash', 'otf_titling_alternates', 'otf_contextual_alternates',
    'otf_all_small_caps', 'otf_slashed_zero', 'otf_stylistic_sets', 'otf_positional_forms', 'otf_superscript_superior', 'otf_subscript_inferior',
    'otf_numerator', 'otf_denominator', 'otf_figure_style', 'otf_historical_alternates', 'otf_stylistic_alternates', 'otf_justification_alternates',
    'otf_proportional_metrics', 'otf_roman_italics', 'otf_localized_forms', 'otf_overlap_swash', 'otf_stretched_alternates', 'otf_mark_positioning',
    'otf_cs5_menu',
];
const T = (ids) => ids.map((id) => `indesign.typography.${id}`);

/** Unique stories of the entries, as `stories` (an array) in the script. */
const UNIQUE_STORIES = `
var stories = [], seenStory = {};
for (var i = 0; i < targets.length; i++) {
  var sid = targets[i].story.id;
  if (!seenStory[sid]) { seenStory[sid] = true; stories.push(targets[i].story); }
}`;

/** Unique paragraphs of the entries, as `paras` (an array) in the script. */
const UNIQUE_PARAS = `
var paras = [], seenPara = {};
for (var i = 0; i < targets.length; i++) {
  var ps = __paras(targets[i]);
  for (var j = 0; j < ps.length; j++) {
    var key = ps[j].parentStory.id + ":" + ps[j].index;
    if (!seenPara[key]) { seenPara[key] = true; paras.push(ps[j]); }
  }
}`;

const AUDIT_TEXT = { text: { ids: [1] } };

export const tools = [
    {
        name: 'set_character_attributes',
        description: 'Set character formatting on text: font, size, leading, kerning, tracking, scale, baseline shift, skew, rotation, case, position, ligatures, No Break, strikethrough, language, fill and stroke (Character panel, Advanced Character Formats); OpenType options; CJK options (ruby, kenten, warichu, shatai, tate-chu-yoko, mojikumi, kinsoku, aki, tsume, gyoudori); and Middle Eastern options (direction, digits, kashidas, diacritics). Only the attributes you pass change.',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                character: groupSchema(ATTRIBUTE_GROUPS.character),
                opentype: groupSchema(ATTRIBUTE_GROUPS.opentype),
                cjk: groupSchema(ATTRIBUTE_GROUPS.cjk),
                worldReady: groupSchema(ATTRIBUTE_GROUPS.worldReady),
            },
            required: ['text'],
        },
        features: T([
            'character_panel', 'basic_char_kerning', 'basic_char_tracking', 'basic_char_case', 'basic_char_position', 'basic_char_ligatures',
            'basic_char_no_break', 'basic_char_strikethrough', 'adv_char_horizontal_scale', 'adv_char_vertical_scale', 'adv_char_baseline_shift',
            'adv_char_skew_false_italic', 'adv_char_character_rotation', 'adv_char_language', 'char_color_stroke_alignment_text',
            'char_color_stroke_join_text', 'char_color_overprint_fill_text', 'char_color_overprint_stroke_text', 'variable_fonts',
            'contextual_glyph_alternates', 'stylistic_set_cmds', ...OTF_FEATURES,
            'ruby', 'warichu', 'kenten', 'shatai', 'tate_chu_yoko', 'gyoudori', 'character_alignment_cjk', 'tsume', 'aki', 'bunri_kinshi', 'rotate_roman',
            'character_direction', 'digits_type', 'kashida', 'diacritic_position', 'arabic_ligatures',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            ...AUDIT_TEXT,
            character: { fontName: 'Minion Pro\tBold', pointSize: 12, autoLeading: true, kerningMethod: 'optical', capitalization: 'SMALL_CAPS', position: 'OT_NUMERATOR', fillColor: 'Black', language: 'English: USA', designAxes: [400, 100] },
            opentype: { fractions: true, stylisticSets: [1, 3], figureStyle: 'TABULAR_LINING', glyphForm: 'JIS04_FORM' },
            cjk: { ruby: true, rubyString: 'ruby', rubyFontName: 'Kozuka Mincho Pr6N', mojikumi: 'LINE_END_ALL_ONE_HALF_EM_ENUM', kinsokuSet: 'My kinsoku', kentenColor: '#FF0000', tsume: 25 },
            worldReady: { characterDirection: 'RIGHT_TO_LEFT_DIRECTION', digitsType: 'ARABIC_DIGITS', kashidas: 'KASHIDAS_OFF', kashidaWidth: 2 },
        },
        handler: (a) => {
            const spec = textSpec(a.text);
            const { pre, set, names } = attributeStatements(a);
            return run('Set character attributes', textScript(`
var targets = __texts(doc, ${spec}), out = [];
${pre.join('\n')}
for (var i = 0; i < targets.length; i++) {
  var t = __range(targets[i]);
  ${set.join('\n  ')}
  out.push(__textInfo(targets[i]));
}
__result__ = { set: ${json(names)}, texts: out };`));
        },
    },
    {
        name: 'apply_type_command',
        description: 'Run a type keyboard command on text: step size, leading, kerning/tracking, baseline shift or scale; auto leading; reset kerning and tracking or scale; bold, italic, normal; toggle all caps, small caps, superscript, subscript, ligatures, No Break; paragraph alignment (incl. towards/away from spine); toggle align to baseline grid, hyphenation, Ignore Optical Margin; choose or switch composer (Paragraph, Single-line, World-Ready); paragraph direction; reset indents',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                command: { type: 'string', enum: Object.keys(TYPE_COMMANDS), description: 'The command. Toggles read the first character and set every chosen character the same way; steps apply run by run' },
                amount: { type: 'number', minimum: 0.001, maximum: 1000, description: 'Step for increase/decrease commands: points for size, leading and baseline shift (default 2), thousandths of an em for kerning/tracking (default 20), percent for scale (default 5)' },
            },
            required: ['text', 'command'],
        },
        features: T([
            'font_size_shortcut', 'leading_shortcut', 'auto_leading_shortcut', 'kern_track_shortcut', 'reset_kerning_tracking', 'baseline_shift_shortcut',
            'bold_shortcut', 'italic_shortcut', 'normal_shortcut', 'all_caps_shortcut', 'small_caps_shortcut', 'superscript_shortcut', 'subscript_shortcut',
            'reset_scale_shortcut', 'ligatures_menu', 'no_break_menu', 'text_size_keyboard_actions', 'align_shortcuts', 'align_to_grid_shortcut',
            'auto_hyphenate_shortcut', 'align_towards_spine', 'adobe_paragraph_composer', 'adobe_single_line_composer', 'world_ready_composer',
            'switch_composer', 'ignore_optical_margin', 'text_direction', 'middle_eastern_setup', 'reset_indents',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { ...AUDIT_TEXT, command: 'bold', amount: undefined },
        handler: (a) => {
            const cmd = enumOf(a.command, Object.keys(TYPE_COMMANDS), { name: 'command' });
            const [body, step] = TYPE_COMMANDS[cmd];
            if (has(a.amount) && step === null) throw new Error(`'${cmd}' takes no amount`);
            const amt = step === null ? 0 : num(a.amount ?? step, { min: 0.001, max: 1000, name: 'amount' });
            const spec = textSpec(a.text);
            return run('Type command', textScript(`${COMMAND_HELPERS}
var targets = __texts(doc, ${spec}), out = [], warnings = [], amt = ${amt};
for (var i = 0; i < targets.length; i++) {
  var e = targets[i];
  ${body}
  out.push(__textInfo(e));
}
__result__ = { command: ${str(cmd)}, texts: out, warnings: warnings };`));
        },
    },
    {
        name: 'set_story_options',
        description: 'Set story options for the stories holding the chosen text: Optical Margin Alignment and its size, and story direction (Type > Story panel)',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                opticalMarginAlignment: { type: 'boolean', description: 'Hang punctuation and letter edges outside the frame' },
                opticalMarginSize: { type: 'number', minimum: 0.1, maximum: 1296, description: 'Type size (points) optical margin alignment is based on' },
                storyDirection: { type: 'string', enum: ['LEFT_TO_RIGHT_DIRECTION', 'RIGHT_TO_LEFT_DIRECTION'], description: 'Story direction' },
            },
            required: ['text'],
        },
        features: T(['story_panel', 'optical_margin_alignment', 'text_direction']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { ...AUDIT_TEXT, storyDirection: 'RIGHT_TO_LEFT_DIRECTION' },
        handler: (a) => {
            const set = [];
            if (has(a.opticalMarginAlignment)) set.push(`sp.opticalMarginAlignment = ${bool(a.opticalMarginAlignment)};`);
            if (has(a.opticalMarginSize)) set.push(`sp.opticalMarginSize = ${num(a.opticalMarginSize, { min: 0.1, max: 1296, name: 'opticalMarginSize' })};`);
            if (has(a.storyDirection)) set.push(`sp.storyDirection = StoryDirectionOptions.${enumOf(a.storyDirection, ['LEFT_TO_RIGHT_DIRECTION', 'RIGHT_TO_LEFT_DIRECTION'], { name: 'storyDirection' })};`);
            if (!set.length) throw new Error('Give opticalMarginAlignment, opticalMarginSize or storyDirection');
            const spec = textSpec(a.text);
            return run('Set story options', textScript(`
var targets = __texts(doc, ${spec}), out = [];
${UNIQUE_STORIES}
for (var s = 0; s < stories.length; s++) {
  var sp = stories[s].storyPreferences;
  ${set.join('\n  ')}
  out.push({ storyId: stories[s].id, opticalMarginAlignment: sp.opticalMarginAlignment, opticalMarginSize: sp.opticalMarginSize, storyDirection: __enumName(sp.storyDirection) });
}
__result__ = { stories: out };`));
        },
    },
    {
        name: 'set_type_preferences',
        description: 'Set type preferences: Type Contextual Controls (alternates and fraction badges on selected text), font locking for Roman and Asian characters, and the HarfBuzz shaping engine for Indic and Latin text. Returns the current values; with no arguments it only reports them',
        inputSchema: {
            type: 'object',
            properties: {
                showAlternates: { type: 'boolean', description: 'Show the contextual badge for OpenType alternates on selected text (Type > Type Contextual Controls > Show Adornment)' },
                showFractions: { type: 'boolean', description: 'Show the contextual badge for fractions' },
                fontChangeLocking: { type: 'boolean', description: 'Font locking: keep Roman fonts off Asian characters (and the reverse) when changing fonts' },
                fontInputLocking: { type: 'boolean', description: 'Font locking while typing' },
                harfbuzzShaping: { type: 'boolean', description: 'Shape Indic and Latin text with the HarfBuzz engine (default shaping engine)' },
                scope: { type: 'string', enum: ['application', 'document'], description: 'Where harfbuzzShaping is set: the application default or the active document', default: 'application' },
            },
        },
        features: T(['type_contextual_controls', 'show_adornment', 'font_locking', 'default_shaping_engine']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'application', ['application', 'document'], { name: 'scope' });
            const set = [];
            const b = (k, target) => { if (has(a[k])) set.push(`${target} = ${bool(a[k])};`); };
            b('showAlternates', 'app.typeContextualUiPrefs.showAlternatesUi');
            b('showFractions', 'app.typeContextualUiPrefs.showFractionsUi');
            b('fontChangeLocking', 'app.fontLockingPreferences.fontChangeLocking');
            b('fontInputLocking', 'app.fontLockingPreferences.fontInputLocking');
            b('harfbuzzShaping', 'tp.shapeIndicAndLatinWithHarbuzz');
            return run('Set type preferences', script(`
var tp = ${scope === 'document' ? '__doc().textPreferences' : 'app.textPreferences'};
${set.join('\n')}
__result__ = {
  showAlternates: app.typeContextualUiPrefs.showAlternatesUi,
  showFractions: app.typeContextualUiPrefs.showFractionsUi,
  fontChangeLocking: app.fontLockingPreferences.fontChangeLocking,
  fontInputLocking: app.fontLockingPreferences.fontInputLocking,
  harfbuzzShaping: tp.shapeIndicAndLatinWithHarbuzz,
  scope: ${str(scope)}
};`, { needsDocument: false }));
        },
    },
    {
        name: 'insert_special_character',
        description: 'Insert a special character, white space or break character (Type > Insert Special Character / Insert White Space / Insert Break Character), or any glyph by Unicode code point, optionally in a given font (Glyphs panel). Inserts before or after the chosen text, or replaces it (replace characters with a glyph)',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                character: { type: 'string', enum: SPECIAL_CHARACTERS, description: 'The special character (InDesign SpecialCharacters name)' },
                glyph: {
                    type: 'object',
                    description: 'A glyph instead of a special character: { unicode, fontName }',
                    properties: {
                        unicode: { type: 'string', description: 'Unicode code point, e.g. "2022" or "U+1F600"' },
                        fontName: { type: 'string', description: 'Font for the glyph, as "Family\\tStyle" or a family name (default: the surrounding text)' },
                    },
                },
                at: { type: 'string', enum: ['end', 'start', 'replace'], description: 'Insert after the chosen text (end), before it (start), or replace it', default: 'end' },
                count: { type: 'integer', minimum: 1, maximum: 100, description: 'How many to insert', default: 1 },
            },
            required: ['text'],
        },
        features: T([
            'glyphs_panel', 'replace_with_glyph', 'insert_special_character', 'insert_white_space', 'insert_break_character', 'column_break', 'frame_break',
            'page_break', 'odd_even_page_break', 'forced_line_break', 'discretionary_line_break', 'discretionary_hyphen', 'nonbreaking_hyphen', 'em_en_dash',
            'symbols', 'quotation_marks', 'end_nested_style_here', 'non_joiner', 'white_space_types', 'right_indent_tab', 'indent_to_here',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { ...AUDIT_TEXT, glyph: undefined },
        handler: (a) => {
            if (has(a.character) === has(a.glyph)) throw new Error('Give either character or glyph');
            if (has(a.glyph) && (typeof a.glyph !== 'object' || !has(a.glyph.unicode))) throw new Error('glyph needs unicode, e.g. { unicode: "2022" }');
            const value = has(a.character)
                ? `SpecialCharacters.${enumOf(a.character, SPECIAL_CHARACTERS, { name: 'character' })}`
                : codePointLiteral(codePoint(a.glyph.unicode, 'glyph.unicode'));
            const at = enumOf(a.at ?? 'end', ['end', 'start', 'replace'], { name: 'at' });
            const count = index(a.count ?? 1, { name: 'count', max: 100 });
            if (Number(count) < 1) throw new Error("'count' must be at least 1");
            const font = has(a.glyph?.fontName) ? `__fontOf(${str(fontName(a.glyph.fontName, 'glyph.fontName'))})` : 'null';
            const spec = textSpec(a.text);
            return run('Insert special character', textScript(`
var targets = __texts(doc, ${spec}), out = [], font = ${font};
targets.sort(function (x, y) { return y.start - x.start; });
for (var i = 0; i < targets.length; i++) {
  var e = targets[i], pos = ${at === 'start' ? 'e.start' : 'e.end'};
  ${at === 'replace' ? 'if (e.end > e.start) { e.story.characters.itemByRange(e.start, e.end - 1).remove(); } pos = e.start;' : ''}
  var before = e.story.length;
  for (var k = 0; k < ${count}; k++) e.story.insertionPoints[pos].contents = ${value};
  var added = e.story.length - before;
  if (font !== null && added > 0) e.story.characters.itemByRange(pos, pos + added - 1).appliedFont = font;
  out.push({ storyId: e.story.id, at: pos, inserted: added });
}
__result__ = { texts: out };`));
        },
    },
    {
        name: 'run_glyphs_panel_command',
        description: 'Run a Glyphs panel menu command: insert one of the five most recently used glyphs at the text selection, sort the panel by Unicode or by glyph ID, or clear the Recently Used row (Type > Glyphs)',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(GLYPH_PANEL_COMMANDS), description: 'The Glyphs panel command; insert_recent_glyph_N needs a text insertion point or text selection' },
            },
            required: ['command'],
        },
        features: T(['insert_recent_glyph', 'glyph_by_unicode', 'context_clear_recent_glyphs']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const cmd = enumOf(a.command, Object.keys(GLYPH_PANEL_COMMANDS), { name: 'command' });
            const [id, label, needsText] = GLYPH_PANEL_COMMANDS[cmd];
            return run('Glyphs panel command', script(`
${needsText ? 'if (app.documents.length === 0 || app.selection.length === 0) throw new Error("Select text or place the insertion point first");' : ''}
var ma = app.menuActions.itemByID(${id});
if (!ma.isValid) throw new Error(${str(`The Glyphs panel command ${label} is not available in this InDesign`)});
if (!ma.enabled) throw new Error(${str(`${label} is not available now (the Glyphs panel has nothing for it, or the selection does not allow it)`)});
ma.invoke();
__result__ = { command: ${str(cmd)}, menuAction: ${str(label)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'change_case',
        description: 'Change the case of text to UPPERCASE, lowercase, Title Case or Sentence case (Type > Change Case)',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                mode: { type: 'string', enum: ['UPPERCASE', 'LOWERCASE', 'TITLECASE', 'SENTENCECASE'], description: 'The case to change to' },
            },
            required: ['text', 'mode'],
        },
        features: T(['change_case', 'change_case_uppercase', 'change_case_lowercase', 'change_case_title_case', 'change_case_sentence_case']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: AUDIT_TEXT,
        handler: (a) => {
            const mode = enumOf(a.mode, ['UPPERCASE', 'LOWERCASE', 'TITLECASE', 'SENTENCECASE'], { name: 'mode' });
            const spec = textSpec(a.text);
            return run('Change case', textScript(`
var targets = __texts(doc, ${spec}), out = [];
for (var i = 0; i < targets.length; i++) {
  if (targets[i].end <= targets[i].start) continue;
  __text(targets[i]).changecase(ChangecaseMode.${mode});
  out.push(__textInfo(targets[i]));
}
__result__ = { mode: ${str(mode)}, texts: out };`));
        },
    },
    {
        name: 'manage_fonts',
        description: 'Work with fonts: list the fonts used in the document or installed (family, style, type, status, variable axes), replace one font with another throughout the document and its styles (Type > Find Font), rescan font folders for missing fonts, or recompose every story',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'replace', 'update_missing', 'recompose'], description: 'list fonts; replace a font; update_missing rescans font folders (Update missing font list); recompose recomposes all stories' },
                scope: { type: 'string', enum: ['document', 'application'], description: 'For list: fonts used in the active document, or every installed font', default: 'document' },
                missingOnly: { type: 'boolean', description: 'For list: only fonts that are not installed, substituted or fauxed' },
                nameContains: { type: 'string', description: 'For list: only fonts whose name contains this text (case-insensitive)' },
                maxFonts: { type: 'integer', minimum: 1, maximum: 5000, description: 'For list: the most fonts to return', default: 200 },
                from: { type: 'string', description: 'For replace: the font to replace, as "Family\\tStyle" or a family (every style)' },
                to: { type: 'string', description: 'For replace: the replacement, as "Family\\tStyle" or a family (keeps each style)' },
                includeStyles: { type: 'boolean', description: 'For replace: also change paragraph and character styles that use the font', default: true },
            },
            required: ['action'],
        },
        features: T(['font_object', 'update_missing_fonts', 'recompose_all']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'replace', from: 'Arial\tRegular', to: 'Minion Pro' },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'replace', 'update_missing', 'recompose'], { name: 'action' });
            if (action === 'update_missing') {
                return run('Update missing fonts', script('app.updateFonts();\n__result__ = { updated: true };', { needsDocument: false }));
            }
            if (action === 'recompose') {
                return run('Recompose', script('doc.recompose();\n__result__ = { recomposed: doc.stories.length };'));
            }
            if (action === 'list') {
                const scope = enumOf(a.scope ?? 'document', ['document', 'application'], { name: 'scope' });
                const max = index(a.maxFonts ?? 200, { name: 'maxFonts', max: 5000 });
                const filter = has(a.nameContains) ? shortStr(a.nameContains, 'nameContains', 200).toLowerCase() : '';
                return run('List fonts', script(`
var all = ${scope === 'document' ? '__doc().fonts' : 'app.fonts'}.everyItem().getElements(), out = [], total = 0;
for (var i = 0; i < all.length; i++) {
  var f = all[i], info = {};
  try {
    info.name = f.name; info.status = __enumName(f.status);
    if (${bool(a.missingOnly)} && info.status === "INSTALLED") continue;
    if (${str(filter)} && info.name.toLowerCase().indexOf(${str(filter)}) < 0) continue;
    total++;
    if (out.length >= ${max}) continue;
    info.family = f.fontFamily; info.style = f.fontStyleName; info.type = __enumName(f.fontType); info.postscriptName = f.postscriptName;
    if (f.numDesignAxes > 0) { info.designAxes = f.designAxesName; info.designAxesRange = f.designAxesRange; }
  } catch (x) { info.error = x.message; }
  out.push(info);
}
__result__ = { scope: ${str(scope)}, total: total, fonts: out };`, { needsDocument: false }));
            }
            if (!has(a.from) || !has(a.to)) throw new Error('replace needs from and to');
            const [fromFamily, fromStyle = ''] = fontName(a.from, 'from').split('\t');
            const [toFamily, toStyle = ''] = fontName(a.to, 'to').split('\t');
            const styles = a.includeStyles ?? true;
            return run('Replace font', script(`
var installed = false;
${toStyle
        ? `installed = app.fonts.itemByName(${str(toFamily + '\t' + toStyle)}).isValid;`
        : `var fams = app.fonts.everyItem().fontFamily;\nfor (var i = 0; i < fams.length && !installed; i++) if (fams[i] === ${str(toFamily)}) installed = true;`}
if (!installed) throw new Error(${str(`Font ${toFamily}${toStyle ? ' ' + toStyle : ''} is not installed`)});
var famOf = function (f) { try { return typeof f === "string" ? f.split("\\t")[0] : f.fontFamily; } catch (x) { return ""; } };
var changed = 0, stylesChanged = 0;
app.findTextPreferences = NothingEnum.NOTHING;
app.changeTextPreferences = NothingEnum.NOTHING;
try {
  app.findTextPreferences.appliedFont = ${str(fromFamily)};
  ${fromStyle ? `app.findTextPreferences.fontStyle = ${str(fromStyle)};` : ''}
  app.changeTextPreferences.appliedFont = ${str(toFamily)};
  ${toStyle ? `app.changeTextPreferences.fontStyle = ${str(toStyle)};` : ''}
  changed = doc.changeText().length;
} finally {
  app.findTextPreferences = NothingEnum.NOTHING;
  app.changeTextPreferences = NothingEnum.NOTHING;
}
if (${bool(styles)}) {
  var lists = [doc.allParagraphStyles, doc.allCharacterStyles];
  for (var l = 0; l < lists.length; l++) for (var s = 0; s < lists[l].length; s++) {
    var st = lists[l][s];
    if (famOf(st.appliedFont) !== ${str(fromFamily)}) continue;
    if (${str(fromStyle)} && st.fontStyle !== ${str(fromStyle)}) continue;
    st.appliedFont = ${str(toFamily)};
    ${toStyle ? `st.fontStyle = ${str(toStyle)};` : ''}
    stylesChanged++;
  }
}
__result__ = { from: ${str(a.from)}, to: ${str(a.to)}, textRangesChanged: changed, stylesChanged: stylesChanged };`));
        },
    },
    {
        name: 'manage_cjk_sets',
        description: 'List, create, update or delete composite fonts (Type > Composite Fonts), mojikumi sets with detailed aki overrides per character class (Type > Mojikumi Settings) and kinsoku sets (Type > Kinsoku Shori Settings) in the active document. Apply them to text with set_character_attributes',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['composite_font', 'mojikumi', 'kinsoku'], description: 'What to work with' },
                action: { type: 'string', enum: ['list', 'create', 'update', 'delete'], description: 'What to do' },
                name: { type: 'string', description: 'The set or composite font name (not needed for list)' },
                entries: {
                    type: 'array',
                    description: 'Composite font entries to set: name (Kanji, Kana, Full-width Punctuation, Full-width Symbols, Half-width Roman, Half-width Numerals, or a custom set), fontName ("Family\\tStyle" or family), relativeSize, baselineShift, horizontalScale, verticalScale (percents and points), scaleOption, customCharacters (for a new custom set)',
                    items: { type: 'object' },
                },
                basedOn: { type: 'string', description: 'Mojikumi: the MojikumiTableDefaults set a new set starts from, e.g. LINE_END_ALL_ONE_HALF_EM_ENUM' },
                akiOverrides: {
                    type: 'array',
                    description: 'Mojikumi detailed settings: aki between character classes (yakumono classes), each { targetClass, sideClass, sideIsAfterTarget, minimum, desired, maximum, compressionPriority, akiDoesNotFloat }; replaces the existing overrides',
                    items: { type: 'object' },
                },
                cantBeginLineChars: { type: 'string', description: 'Kinsoku: characters that cannot begin a line' },
                cantEndLineChars: { type: 'string', description: 'Kinsoku: characters that cannot end a line' },
                hangingPunctuationChars: { type: 'string', description: 'Kinsoku: hanging punctuation characters' },
                cantBeSeparatedChars: { type: 'string', description: 'Kinsoku: characters that cannot be separated' },
            },
            required: ['kind', 'action'],
        },
        features: T(['composite_fonts', 'mojikumi', 'mojikumi_basic_detailed', 'yakumono', 'kinsoku']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { kind: 'composite_font', action: 'create', name: 'Mixed', entries: [{ name: 'Kanji', fontName: 'Kozuka Mincho Pr6N\tR' }, { name: 'Half-width Roman', fontName: 'Minion Pro', relativeSize: 105, baselineShift: -1 }] },
        handler: (a) => cjkSetsHandler(a),
    },
    {
        name: 'set_tab_stops',
        description: 'Set tab stops on the paragraphs of the chosen text (Type > Tabs): add or replace stops with alignment (left, centre, right, align on a character), leader and align-on character; delete stops; clear all; repeat a stop across the column (Repeat Tab); or list them. Positions are mm from the left edge of the text column',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                action: { type: 'string', enum: ['add', 'replace', 'delete', 'clear', 'repeat', 'list'], description: 'add stops, replace all stops, delete stops at positions, clear all stops, repeat a stop, or list stops' },
                tabs: {
                    type: 'array',
                    description: 'For add and replace: stops as { position (mm), alignment (LEFT_ALIGN, CENTER_ALIGN, RIGHT_ALIGN, CHARACTER_ALIGN), leader (up to 8 characters, e.g. "."), alignOn (the character a CHARACTER_ALIGN stop aligns on, e.g. ".") }',
                    items: { type: 'object' },
                },
                positions: { type: 'array', items: { type: 'number' }, description: 'For delete: positions (mm) of the stops to remove' },
                repeatIndex: { type: 'integer', minimum: 0, description: 'For repeat: which stop to repeat (0-based; default the last)' },
                until: { type: 'number', minimum: 0, maximum: 5000, description: 'For repeat: add stops up to this position in mm (default: the column width less the right indent)' },
            },
            required: ['text', 'action'],
        },
        features: T(['tabs_panel', 'tab_alignment', 'tab_leader', 'tab_align_on', 'repeat_tab', 'clear_all_tabs', 'delete_tab']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { ...AUDIT_TEXT, action: 'replace', tabs: [{ position: 20, alignment: 'CHARACTER_ALIGN', leader: '.', alignOn: ',' }, { position: 60, alignment: 'RIGHT_ALIGN' }] },
        handler: (a) => tabsHandler(a),
    },
    {
        name: 'set_grep_styles',
        description: 'Add, replace, clear or list GREP styles: character styles applied automatically to text matching a GREP expression (Paragraph panel menu > GREP Styles), on the paragraphs of the chosen text or on a paragraph style',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                paragraphStyle: { type: 'string', description: 'A paragraph style name to change instead of (or as well as) paragraphs' },
                action: { type: 'string', enum: ['add', 'replace', 'clear', 'list'], description: 'add to the existing GREP styles, replace them, clear them, or list them' },
                styles: {
                    type: 'array',
                    description: 'For add and replace: { expression (GREP), characterStyle (name) } in order',
                    items: { type: 'object' },
                },
            },
            required: ['action'],
        },
        features: T(['grep_styles_dialog']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { ...AUDIT_TEXT, paragraphStyle: 'Body', action: 'replace', styles: [{ expression: '\\d+', characterStyle: 'Numbers' }] },
        handler: (a) => grepStylesHandler(a),
    },
    {
        name: 'set_bullets_and_numbering',
        description: 'Apply and format bullets and numbering on the paragraphs of the chosen text (Type > Bulleted & Numbered Lists; Bullets and Numbering dialog): list type, list and level, bullet character and font, number expression and format, text after, character style, start/continue, restart after levels, alignment, indents and tab position; or restart numbering, continue numbering, or convert bullets and numbers to text',
        inputSchema: {
            type: 'object',
            properties: {
                text: TEXT_SCHEMA,
                action: { type: 'string', enum: ['set', 'restart', 'continue', 'convert_to_text'], description: 'set the options below; restart numbering at the first chosen paragraph (at startAt, default 1); continue numbering from the previous list; or convert the bullets and numbers to ordinary text', default: 'set' },
                listType: { type: 'string', enum: LIST_TYPES, description: 'Bulleted list, numbered list, or no list' },
                list: { type: 'string', description: 'Name of a list (Define Lists) the paragraphs belong to, so numbering runs across frames or stories' },
                level: { type: 'integer', minimum: 1, maximum: 9, description: 'Level for multi-level lists' },
                bullet: { type: 'object', description: 'Bullet character: { unicode ("2022") or glyphId, fontName ("Family\\tStyle" or family; needed with glyphId) }' },
                textAfter: { type: 'string', description: 'Text after the bullet (metacharacters such as ^t for a tab)' },
                characterStyle: { type: 'string', description: 'Character style for the bullet or number' },
                numberExpression: { type: 'string', description: 'Number pattern with placeholders: ^# this level, ^1-^9 the number at that level, ^H chapter number, ^t tab; e.g. "^1.^#.^t"' },
                numberFormat: { type: 'string', enum: NUMBER_FORMATS, description: 'Numbering format' },
                mode: { type: 'string', enum: ['continue', 'start_at'], description: 'Continue from the previous number, or start at startAt' },
                startAt: { type: 'integer', minimum: 0, description: 'Starting number (with mode start_at or action restart)' },
                restartAfter: { type: 'object', description: 'Restart numbers at this level: { enabled (false turns it off), policy (ANY_PREVIOUS_LEVEL, AFTER_SPECIFIC_LEVEL, RANGE_OF_LEVELS), lowerLevel, upperLevel }' },
                numberAlignment: { type: 'string', enum: LIST_ALIGNMENTS, description: 'Bullet or number position: its alignment in its space' },
                leftIndent: { type: 'number', description: 'Left indent in mm' },
                firstLineIndent: { type: 'number', description: 'First line indent in mm (negative for a hanging bullet)' },
                tabPosition: { type: 'number', minimum: 0, description: 'Tab position in mm after the bullet or number' },
            },
            required: ['text'],
        },
        features: T([
            'apply_bullets', 'apply_numbers', 'restart_numbering', 'continue_numbering', 'convert_numbering_to_text', 'multi_level_lists',
            'numbering_placeholder_menus', 'bullets_list_type', 'bullets_list', 'bullets_level', 'bullets_bullet_character', 'bullets_text_after',
            'bullets_character_style_bullet_or_number', 'bullets_number', 'bullets_format', 'bullets_mode', 'bullets_restart_numbers_at_this_level_after',
            'bullets_bullet_or_number_position', 'bullets_left_indent_first_line_indent_tab_position', 'bullets_numbering_dialog',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            ...AUDIT_TEXT, action: 'set', listType: 'NUMBERED_LIST', list: 'Figures', level: 2, bullet: { unicode: '2022', fontName: 'Minion Pro\tRegular' },
            characterStyle: 'Numbers', numberExpression: '^1.^#.^t', numberFormat: 'LOWER_ROMAN', mode: 'start_at', startAt: 3,
            restartAfter: { policy: 'AFTER_SPECIFIC_LEVEL', lowerLevel: 1 }, numberAlignment: 'RIGHT_ALIGN', leftIndent: 8, firstLineIndent: -8, tabPosition: 8,
        },
        handler: (a) => bulletsHandler(a),
    },
    {
        name: 'manage_numbering_lists',
        description: 'List, create, update or delete numbering lists (Type > Bulleted & Numbered Lists > Define Lists): named lists whose numbers can continue across stories, or across documents in a book, for running lists of figures and tables',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'update', 'delete'], description: 'What to do' },
                name: { type: 'string', description: 'The list name (not needed for list)' },
                newName: { type: 'string', description: 'For update: a new name' },
                continueAcrossStories: { type: 'boolean', description: 'Continue numbers across stories' },
                continueAcrossDocuments: { type: 'boolean', description: 'Continue numbers from the previous document in the book' },
                replaceWith: { type: 'string', description: 'For delete: the list that paragraphs using the deleted list move to' },
            },
            required: ['action'],
        },
        features: T(['define_lists', 'running_lists']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'create', name: 'Figures', continueAcrossStories: true, continueAcrossDocuments: false },
        handler: (a) => numberingListsHandler(a),
    },
];

// ---------------------------------------------------------------------------
// Handlers too long to sit inline
// ---------------------------------------------------------------------------

function requireName(a, what) {
    if (!has(a.name) || !String(a.name).trim()) throw new Error(`Give the ${what} name`);
    return shortStr(String(a.name).trim(), 'name', 200);
}

/** manage_cjk_sets */
function cjkSetsHandler(a) {
    const kind = enumOf(a.kind, ['composite_font', 'mojikumi', 'kinsoku'], { name: 'kind' });
    const action = enumOf(a.action, ['list', 'create', 'update', 'delete'], { name: 'action' });
    const coll = { composite_font: 'compositeFonts', mojikumi: 'mojikumiTables', kinsoku: 'kinsokuTables' }[kind];
    if (action === 'list') {
        const extra = kind === 'composite_font'
            ? 'var en = it.compositeFontEntries.everyItem().getElements(); info.entries = []; for (var j = 0; j < en.length; j++) { var fn = en[j].appliedFont; info.entries.push({ name: en[j].name, font: typeof fn === "string" ? fn : fn.name, relativeSize: en[j].relativeSize, baselineShift: en[j].baselineShift }); }'
            : kind === 'kinsoku'
                ? 'info.cantBeginLineChars = it.cantBeginLineChars; info.cantEndLineChars = it.cantEndLineChars; info.hangingPunctuationChars = it.hangingPunctuationChars; info.cantBeSeparatedChars = it.cantBeSeparatedChars;'
                : 'info.akiOverrides = it.overrideMojikumiAkiList.length;';
        return run('List CJK sets', script(`
var all = doc.${coll}.everyItem().getElements(), out = [];
for (var i = 0; i < all.length; i++) { var it = all[i], info = { name: it.name }; try { ${extra} } catch (x) {} out.push(info); }
__result__ = { kind: ${str(kind)}, sets: out };`));
    }
    const name = requireName(a, kind.replace('_', ' '));
    const find = `var it = doc.${coll}.itemByName(${str(name)});`;
    if (action === 'delete') {
        return run('Delete CJK set', script(`${find}
if (!it.isValid) throw new Error(${str(`No ${kind.replace('_', ' ')} named ${name}`)});
it.remove();
__result__ = { deleted: ${str(name)} };`));
    }
    const set = [];
    let create;
    if (kind === 'composite_font') {
        create = `it = doc.compositeFonts.add({ name: ${str(name)} });`;
        const entries = a.entries ?? [];
        if (!Array.isArray(entries) || entries.length > 50) throw new Error("'entries' must be a list of up to 50 entries");
        entries.forEach((en, i) => {
            const label = `entries[${i}]`;
            if (!en || typeof en !== 'object' || !has(en.name)) throw new Error(`${label} needs a name`);
            const nm = shortStr(en.name, `${label}.name`, 100);
            set.push(`var en = it.compositeFontEntries.itemByName(${str(nm)});`,
                `if (!en.isValid) en = it.compositeFontEntries.add({ name: ${str(nm)}${has(en.customCharacters) ? `, customCharacters: ${str(shortStr(en.customCharacters, `${label}.customCharacters`, 5000))}` : ''} });`);
            if (has(en.fontName)) {
                const [family, style] = fontName(en.fontName, `${label}.fontName`).split('\t');
                set.push(`en.appliedFont = ${str(family)};`);
                if (style) set.push(`en.fontStyle = ${str(style)};`);
            }
            for (const [k, lo, hi] of [['relativeSize', 1, 1000], ['baselineShift', -1000, 1000], ['horizontalScale', 1, 1000], ['verticalScale', 1, 1000]]) {
                if (has(en[k])) set.push(`en.${k} = ${num(en[k], { min: lo, max: hi, name: `${label}.${k}` })};`);
            }
            if (has(en.scaleOption)) set.push(`en.scaleOption = ${bool(en.scaleOption)};`);
        });
    } else if (kind === 'mojikumi') {
        const based = has(a.basedOn) ? enumOf(a.basedOn, MOJIKUMI_DEFAULTS, { name: 'basedOn' }) : null;
        create = `it = doc.mojikumiTables.add(${str(name)}, {${based ? ` basedOnMojikumiSet: MojikumiTableDefaults.${based} ` : ''}});`;
        if (based && action === 'update') set.push(`it.basedOnMojikumiSet = MojikumiTableDefaults.${based};`);
        if (has(a.akiOverrides)) {
            if (!Array.isArray(a.akiOverrides) || a.akiOverrides.length > 500) throw new Error("'akiOverrides' must be a list");
            const rows = a.akiOverrides.map((o, i) => {
                const l = `akiOverrides[${i}]`;
                if (!o || typeof o !== 'object') throw new Error(`${l} must be an object`);
                return `[${index(o.targetClass, { name: `${l}.targetClass`, max: 100 })}, ${index(o.sideClass, { name: `${l}.sideClass`, max: 100 })}, ${bool(o.sideIsAfterTarget)}, `
                    + `${num(o.minimum ?? 0, { min: -100, max: 100, name: `${l}.minimum` })}, ${num(o.desired ?? 0, { min: -100, max: 100, name: `${l}.desired` })}, `
                    + `${num(o.maximum ?? 0, { min: -100, max: 100, name: `${l}.maximum` })}, ${index(o.compressionPriority ?? 0, { name: `${l}.compressionPriority`, max: 100 })}, ${bool(o.akiDoesNotFloat)}]`;
            });
            set.push(`it.overrideMojikumiAkiList = [${rows.join(', ')}];`);
        }
    } else {
        const props = {};
        for (const k of ['cantBeginLineChars', 'cantEndLineChars', 'hangingPunctuationChars', 'cantBeSeparatedChars']) {
            if (has(a[k])) props[k] = shortStr(a[k], k, 5000);
        }
        create = `it = doc.kinsokuTables.add(${str(name)}, ${json(props)});`;
        if (action === 'update') for (const [k, v] of Object.entries(props)) set.push(`it.${k} = ${str(v)};`);
    }
    if (action === 'update' && !set.length) throw new Error('Nothing to update: give the new settings');
    const label = kind.replace('_', ' ');
    return run(action === 'create' ? 'Create CJK set' : 'Update CJK set', script(`${find}
${action === 'create'
        ? `if (it.isValid) throw new Error(${str(`A ${label} named ${name} already exists; use action update`)});\n${create}`
        : `if (!it.isValid) throw new Error(${str(`No ${label} named ${name}`)});`}
${set.join('\n')}
__result__ = { kind: ${str(kind)}, name: it.name, action: ${str(action)} };`));
}

const MOJIKUMI_DEFAULTS = ['LINE_END_ALL_ONE_EM_ENUM', 'LINE_END_ALL_ONE_HALF_EM_ENUM', 'LINE_END_PERIOD_ONE_EM_ENUM', 'LINE_END_UKE_NO_FLOAT_ENUM',
    'ONE_EM_INDENT_LINE_END_ALL_NO_FLOAT_ENUM', 'ONE_EM_INDENT_LINE_END_ALL_ONE_EM_ENUM', 'ONE_EM_INDENT_LINE_END_ALL_ONE_HALF_EM_ENUM',
    'ONE_EM_INDENT_LINE_END_PERIOD_ONE_EM_ENUM', 'ONE_EM_INDENT_LINE_END_UKE_NO_FLOAT_ENUM', 'ONE_EM_INDENT_LINE_END_UKE_ONE_HALF_EM_ENUM',
    'ONE_OR_ONE_HALF_EM_INDENT_LINE_END_ALL_ONE_EM_ENUM', 'ONE_OR_ONE_HALF_EM_INDENT_LINE_END_PERIOD_ONE_EM_ENUM',
    'ONE_OR_ONE_HALF_EM_INDENT_LINE_END_UKE_NO_FLOAT_ENUM', 'ONE_OR_ONE_HALF_EM_INDENT_LINE_END_UKE_ONE_HALF_EM_ENUM',
    'SIMP_CHINESE_DEFAULT', 'TRAD_CHINESE_DEFAULT'];

/** set_tab_stops */
function tabsHandler(a) {
    const action = enumOf(a.action, ['add', 'replace', 'delete', 'clear', 'repeat', 'list'], { name: 'action' });
    const spec = textSpec(a.text);
    const body = [];
    const clear = 'for (var k = p.tabStops.length - 1; k >= 0; k--) p.tabStops[k].remove();';
    if (action === 'add' || action === 'replace') {
        if (!Array.isArray(a.tabs) || !a.tabs.length || a.tabs.length > 100) throw new Error("Give 'tabs': a list of 1 to 100 stops");
        if (action === 'replace') body.push(clear);
        a.tabs.forEach((s, i) => {
            const l = `tabs[${i}]`;
            if (!s || typeof s !== 'object') throw new Error(`${l} must be an object`);
            const props = [`position: ${num(s.position, { min: 0, max: 5000, name: `${l}.position` })}`,
                `alignment: TabStopAlignment.${enumOf(s.alignment ?? 'LEFT_ALIGN', TAB_ALIGNMENTS, { name: `${l}.alignment` })}`];
            if (has(s.leader)) props.push(`leader: ${str(shortStr(s.leader, `${l}.leader`, 8))}`);
            if (has(s.alignOn)) {
                if (String(s.alignOn).length !== 1) throw new Error(`${l}.alignOn must be one character`);
                props.push(`alignmentCharacter: ${str(s.alignOn)}`);
            }
            body.push(`p.tabStops.add({ ${props.join(', ')} });`);
        });
    } else if (action === 'clear') {
        body.push(clear);
    } else if (action === 'delete') {
        if (!Array.isArray(a.positions) || !a.positions.length) throw new Error("Give 'positions' (mm) of the stops to delete");
        const xs = a.positions.map((x) => num(x, { min: 0, max: 5000, name: 'positions' }));
        body.push(`var gone = [${xs.join(', ')}];`,
            'for (var k = p.tabStops.length - 1; k >= 0; k--) for (var g = 0; g < gone.length; g++) if (Math.abs(p.tabStops[k].position - gone[g]) < 0.01) { p.tabStops[k].remove(); removed++; break; }');
    } else if (action === 'repeat') {
        const which = has(a.repeatIndex) ? index(a.repeatIndex, { name: 'repeatIndex', max: 1000 }) : null;
        const until = has(a.until) ? num(a.until, { min: 0, max: 5000, name: 'until' }) : null;
        body.push(
            'var ts = p.tabStops; if (!ts.length) throw new Error("The paragraph has no tab stop to repeat");',
            `var w = ${which === null ? 'ts.length - 1' : which}; if (w >= ts.length) throw new Error("No tab stop " + w + "; the paragraph has " + ts.length);`,
            'var src = ts[w], prev = w > 0 ? ts[w - 1].position : p.leftIndent, step = src.position - prev;',
            'if (step <= 0.01) throw new Error("The stop is not to the right of the previous stop or the left indent");',
            `var limit = ${until === null ? '__columnWidth(p) - p.rightIndent' : until};`,
            'var al = src.alignment, ld = src.leader, ac = src.alignmentCharacter;',
            'for (var k = ts.length - 1; k > w; k--) ts[k].remove();',
            'for (var x = src.position + step; x <= limit + 0.001; x += step) { p.tabStops.add({ position: x, alignment: al, leader: ld, alignmentCharacter: ac }); }',
        );
    }
    const helper = action === 'repeat' ? String.raw`
function __columnWidth(p) {
  var fr = p.parentTextFrames;
  if (!fr.length) throw new Error("The paragraph is not in a frame; give until");
  var f = fr[0], g = f.geometricBounds, tp = f.textFramePreferences, ins = tp.insetSpacing;
  var l = ins instanceof Array ? ins[1] : ins, r = ins instanceof Array ? ins[3] : ins;
  var n = tp.textColumnCount;
  return (g[3] - g[1] - l - r - tp.textColumnGutter * (n - 1)) / n;
}` : '';
    return run('Set tab stops', textScript(`${helper}
var targets = __texts(doc, ${spec}), out = [], removed = 0;
${UNIQUE_PARAS}
for (var i = 0; i < paras.length; i++) {
  var p = paras[i];
  ${body.join('\n  ')}
  var list = [];
  for (var k = 0; k < p.tabStops.length; k++) { var s = p.tabStops[k]; list.push({ position: s.position, alignment: __enumName(s.alignment), leader: s.leader, alignOn: s.alignmentCharacter }); }
  out.push({ storyId: p.parentStory.id, paragraphStart: p.index, tabs: list });
}
__result__ = { action: ${str(action)}, paragraphs: out${action === 'delete' ? ', removed: removed' : ''} };`));
}

/** set_grep_styles */
function grepStylesHandler(a) {
    const action = enumOf(a.action, ['add', 'replace', 'clear', 'list'], { name: 'action' });
    if (!has(a.text) && !has(a.paragraphStyle)) throw new Error('Choose text, a paragraphStyle, or both');
    const spec = has(a.text) ? textSpec(a.text) : null;
    const pre = [], body = [];
    if (action === 'add' || action === 'replace') {
        if (!Array.isArray(a.styles) || !a.styles.length || a.styles.length > 50) throw new Error("Give 'styles': a list of 1 to 50 { expression, characterStyle }");
        if (action === 'replace') body.push('for (var k = o.nestedGrepStyles.length - 1; k >= 0; k--) o.nestedGrepStyles[k].remove();');
        a.styles.forEach((s, i) => {
            const l = `styles[${i}]`;
            if (!s || typeof s !== 'object' || !has(s.expression) || !String(s.expression)) throw new Error(`${l} needs an expression`);
            if (!has(s.characterStyle)) throw new Error(`${l} needs a characterStyle`);
            pre.push(`var __g${i} = __charStyle(doc, ${str(shortStr(s.characterStyle, `${l}.characterStyle`, 200))});`);
            body.push(`o.nestedGrepStyles.add({ grepExpression: ${str(shortStr(s.expression, `${l}.expression`, 2000))}, appliedCharacterStyle: __g${i} });`);
        });
    } else if (action === 'clear') {
        body.push('for (var k = o.nestedGrepStyles.length - 1; k >= 0; k--) o.nestedGrepStyles[k].remove();');
    }
    const report = 'var gl = []; for (var k = 0; k < o.nestedGrepStyles.length; k++) { var gs = o.nestedGrepStyles[k]; gl.push({ expression: gs.grepExpression, characterStyle: gs.appliedCharacterStyle.name }); }';
    const styleName = has(a.paragraphStyle) ? shortStr(a.paragraphStyle, 'paragraphStyle', 200) : null;
    return run('GREP styles', (spec ? textScript : (b) => script(NAME_HELPERS + b))(`
${pre.join('\n')}
var objs = [], out = [];
${spec ? `var targets = __texts(doc, ${spec});\n${UNIQUE_PARAS}\nfor (var i = 0; i < paras.length; i++) objs.push(paras[i]);` : ''}
${styleName ? `var ps = null, all = doc.allParagraphStyles;
for (var i = 0; i < all.length; i++) if (all[i].name === ${str(styleName)}) ps = all[i];
if (!ps) throw new Error(${str(`No paragraph style named ${styleName}`)});
objs.push(ps);` : ''}
for (var n = 0; n < objs.length; n++) {
  var o = objs[n];
  ${body.join('\n  ')}
  ${report}
  out.push(o.constructor.name === "ParagraphStyle" ? { paragraphStyle: o.name, grepStyles: gl } : { storyId: o.parentStory.id, paragraphStart: o.index, grepStyles: gl });
}
__result__ = { action: ${str(action)}, targets: out };`));
}

/** set_bullets_and_numbering */
function bulletsHandler(a) {
    const action = enumOf(a.action ?? 'set', ['set', 'restart', 'continue', 'convert_to_text'], { name: 'action' });
    const spec = textSpec(a.text);
    let pre = [], set = [], firstOnly = [];
    if (action === 'set') {
        ({ pre, set } = bulletStatements(a));
        if (!set.length) throw new Error('Give at least one bullets and numbering option to set');
    } else {
        const extra = ['listType', 'list', 'level', 'bullet', 'textAfter', 'characterStyle', 'numberExpression', 'numberFormat', 'mode', 'restartAfter', 'numberAlignment', 'leftIndent', 'firstLineIndent', 'tabPosition']
            .filter((k) => has(a[k]));
        if (extra.length) throw new Error(`'${action}' takes no formatting options (${extra.join(', ')}); use action set`);
        if (action === 'restart') firstOnly = ['p.numberingContinue = false;', `p.numberingStartAt = ${index(a.startAt ?? 1, { name: 'startAt', max: 1e6 })};`];
        if (action === 'continue') firstOnly = ['p.numberingContinue = true;'];
        if (action === 'convert_to_text') set = ['p.convertBulletsAndNumberingToText();'];
    }
    return run('Bullets and numbering', textScript(`
var targets = __texts(doc, ${spec}), out = [];
${pre.join('\n')}
${firstOnly.length ? `for (var i = 0; i < targets.length; i++) {
  var p = __paras(targets[i])[0];
  ${firstOnly.join('\n  ')}
  out.push({ storyId: p.parentStory.id, paragraphStart: p.index });
}` : `${UNIQUE_PARAS}
for (var i = 0; i < paras.length; i++) {
  var p = paras[i];
  ${set.join('\n  ')}
  out.push({ storyId: p.parentStory.id, paragraphStart: p.index, listType: __enumName(p.bulletsAndNumberingListType) });
}`}
__result__ = { action: ${str(action)}, paragraphs: out };`));
}

/** manage_numbering_lists */
function numberingListsHandler(a) {
    const action = enumOf(a.action, ['list', 'create', 'update', 'delete'], { name: 'action' });
    if (action === 'list') {
        return run('List numbering lists', script(`
var all = doc.numberingLists.everyItem().getElements(), out = [];
for (var i = 0; i < all.length; i++) out.push({ name: all[i].name, continueAcrossStories: all[i].continueNumbersAcrossStories, continueAcrossDocuments: all[i].continueNumbersAcrossDocuments });
__result__ = { lists: out };`));
    }
    const name = requireName(a, 'list');
    const find = `var nl = doc.numberingLists.itemByName(${str(name)});`;
    const report = '__result__ = { name: nl.name, continueAcrossStories: nl.continueNumbersAcrossStories, continueAcrossDocuments: nl.continueNumbersAcrossDocuments };';
    if (action === 'create') {
        return run('Create numbering list', script(`${find}
if (nl.isValid) throw new Error(${str(`A list named ${name} already exists; use action update`)});
nl = doc.numberingLists.add(${str(name)}, ${bool(a.continueAcrossStories)}, ${bool(a.continueAcrossDocuments)}, {});
${report}`));
    }
    if (action === 'delete') {
        if (!has(a.replaceWith)) throw new Error("delete needs 'replaceWith': the list paragraphs move to");
        const other = shortStr(a.replaceWith, 'replaceWith', 200);
        return run('Delete numbering list', script(`${find}
if (!nl.isValid) throw new Error(${str(`No list named ${name}`)});
var rw = doc.numberingLists.itemByName(${str(other)});
if (!rw.isValid) throw new Error(${str(`No list named ${other}`)});
nl.remove(rw);
__result__ = { deleted: ${str(name)}, replacedWith: ${str(other)} };`));
    }
    const set = [];
    if (has(a.newName)) set.push(`nl.name = ${str(shortStr(a.newName, 'newName', 200))};`);
    if (has(a.continueAcrossStories)) set.push(`nl.continueNumbersAcrossStories = ${bool(a.continueAcrossStories)};`);
    if (has(a.continueAcrossDocuments)) set.push(`nl.continueNumbersAcrossDocuments = ${bool(a.continueAcrossDocuments)};`);
    if (!set.length) throw new Error('Nothing to update: give newName, continueAcrossStories or continueAcrossDocuments');
    return run('Update numbering list', script(`${find}
if (!nl.isValid) throw new Error(${str(`No list named ${name}`)});
${set.join('\n')}
${report}`));
}
