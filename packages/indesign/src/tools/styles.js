/**
 * Styles: create and edit paragraph, character, object, table and cell styles
 * with their option groups; duplicate, delete and group them; apply them with
 * or without clearing overrides; clear overrides; redefine a style from the
 * selection or break the link to it; nested, line and GREP styles; export
 * tags; load styles from another document; find and change styles; default
 * object and text styles; table of contents styles; Quick Apply; and the
 * style panels' own commands.
 *
 * A style is named by its name, or by "Group/Style" for a style inside a
 * style group ("Group/Sub/Style" for nested groups). Built-in styles keep
 * their bracketed names ("[Basic Paragraph]", "[None]").
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';
import { TABLE_SCHEMA, CELLS_SCHEMA, tableSpec, cellsSpec, TABLE_JSX, CELLS_JSX } from './tables.js';

const KINDS = ['paragraph', 'character', 'object', 'table', 'cell'];
const LABEL = { paragraph: 'paragraph style', character: 'character style', object: 'object style', table: 'table style', cell: 'cell style' };
const PANEL = { paragraph: 'Paragraph Styles', character: 'Character Styles', object: 'Object Styles', table: 'Table Styles', cell: 'Cell Styles' };

const has = (v) => v !== undefined && v !== null && v !== '';

// ---------------------------------------------------------------------------
// ExtendScript helpers. Each is a `var` function expression, because the
// prelude runs the body inside a try block.

/** Style lookup by name or "Group/Style" path, style groups, and style info. */
const STYLE_JSX = String.raw`
var __SK = {
  paragraph: { all: "allParagraphStyles", own: "paragraphStyles", groups: "paragraphStyleGroups", label: "paragraph style" },
  character: { all: "allCharacterStyles", own: "characterStyles", groups: "characterStyleGroups", label: "character style" },
  object: { all: "allObjectStyles", own: "objectStyles", groups: "objectStyleGroups", label: "object style" },
  table: { all: "allTableStyles", own: "tableStyles", groups: "tableStyleGroups", label: "table style" },
  cell: { all: "allCellStyles", own: "cellStyles", groups: "cellStyleGroups", label: "cell style" }
};
var __group = function (doc, kind, path, create) {
  var owner = doc, parts = String(path || "").split("/");
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var g = owner[__SK[kind].groups].itemByName(parts[i]);
    if (!g.isValid) {
      if (!create) throw new Error("No " + __SK[kind].label + " group " + path);
      g = owner[__SK[kind].groups].add({ name: parts[i] });
    }
    owner = g;
  }
  return owner;
};
var __findStyle = function (doc, kind, ref) {
  var all = doc[__SK[kind].all];
  for (var i = 0; i < all.length; i++) if (all[i].name === ref) return all[i];
  var cut = ref.lastIndexOf("/");
  if (cut > 0) {
    var g = null;
    try { g = __group(doc, kind, ref.substring(0, cut), false); } catch (e) {}
    if (g) {
      var s = g[__SK[kind].own].itemByName(ref.substring(cut + 1));
      if (s.isValid) return s;
    }
  }
  return null;
};
var __style = function (doc, kind, ref) {
  var s = __findStyle(doc, kind, ref);
  if (!s) throw new Error("No " + __SK[kind].label + " named " + ref);
  return s;
};
var __styleName = function (v) {
  try { return typeof v === "string" ? v : v.name; } catch (e) { return null; }
};
var __stylePath = function (s) {
  var p = s.name, o = s.parent;
  while (o && o.constructor.name.indexOf("Group") > 0) { p = o.name + "/" + p; o = o.parent; }
  return p;
};
var __styleInfo = function (s, kind) {
  var info = { kind: kind, name: s.name, path: __stylePath(s) };
  try { info.basedOn = __styleName(s.basedOn); } catch (e) {}
  if (kind === "paragraph") { try { info.nextStyle = __styleName(s.nextStyle); } catch (e2) {} }
  return info;
};
var __strokeStyle = function (doc, name) {
  var st = doc.strokeStyles.itemByName(name);
  if (!st.isValid) throw new Error("No stroke style named " + name);
  return st;
};
var __builtIn = function (s) {
  if (s.name.charAt(0) === "[") throw new Error(s.name + " is a built-in style and cannot be changed this way");
};
`;

/** Text chosen by text frame id (frame or story, paragraph or character range) or selection. */
const TEXT_JSX = String.raw`
var __text = function (doc, spec) {
  if (spec.selection) {
    var sel = app.selection;
    if (!sel.length) throw new Error("Nothing is selected");
    var s0 = sel[0], c = s0.constructor.name;
    if (c === "TextFrame") return s0.texts[0];
    if (c === "InsertionPoint" || c === "Character" || c === "Word" || c === "Line" || c === "Paragraph" || c === "TextColumn" || c === "TextStyleRange" || c === "Text" || c === "Story") return s0;
    throw new Error("Select text or a text frame (the selection is a " + c + ")");
  }
  var fr = __item(doc, spec.frameId);
  if (fr.constructor.name !== "TextFrame") throw new Error("Item " + spec.frameId + " is not a text frame");
  var base = spec.story ? fr.parentStory : fr;
  if (spec.paragraphs) {
    var ps = base.paragraphs, a = spec.paragraphs[0], b = spec.paragraphs[1];
    if (b >= ps.length) throw new Error("Paragraph " + b + " is out of range; there are " + ps.length);
    var first = ps[a].characters[0], last = ps[b].characters[-1];
    return first.parentStory.characters.itemByRange(first.index, last.index).texts[0];
  }
  if (spec.characters) {
    var cs = base.characters, x = spec.characters[0], y = spec.characters[1];
    if (y >= cs.length) throw new Error("Character " + y + " is out of range; there are " + cs.length);
    return cs.itemByRange(x, y).texts[0];
  }
  return base.texts[0];
};
`;

/** Menu actions and panels, for the commands only a style panel's menu offers. */
const MENU_JSX = String.raw`
var __showPanel = function (name) {
  try { var p = app.panels.itemByName(name); if (p.isValid) p.visible = true; } catch (e) {}
};
var __invoke = function (ids, what) {
  for (var i = 0; i < ids.length; i++) {
    var m = app.menuActions.itemByID(ids[i]);
    if (m.isValid && m.enabled) { m.invoke(); return m.name; }
  }
  throw new Error(what + " is not available for the current selection");
};
`;

/** Applying a style of each kind, with the panel's clearing variants. */
const APPLY_JSX = String.raw`
var __clearCharStyles = function (doc, t) {
  var rs = t.textStyleRanges.everyItem().getElements(), none = doc.characterStyles[0], spans = [], i;
  for (i = 0; i < rs.length; i++) {
    var cs = null;
    try { cs = rs[i].appliedCharacterStyle; } catch (e) {}
    if (cs && typeof cs !== "string" && cs.id !== none.id) spans.push([rs[i].characters[0].index, rs[i].characters[-1].index]);
  }
  var story = t.parentStory;
  for (i = 0; i < spans.length; i++) {
    var r = story.characters.itemByRange(spans[i][0], spans[i][1]).texts[0];
    r.applyCharacterStyle(none);
    r.clearOverrides(OverrideType.CHARACTER_ONLY);
  }
  return spans.length;
};
var __applyPara = function (doc, t, s, clear) {
  if (clear === "character_styles" || clear === "all") __clearCharStyles(doc, t);
  t.applyParagraphStyle(s, clear === "overrides" || clear === "all");
};
var __applyParaNext = function (doc, t, s, clear) {
  var ps = t.paragraphs.everyItem().getElements(), cur = s;
  for (var i = 0; i < ps.length; i++) {
    __applyPara(doc, ps[i].texts[0], cur, clear);
    var n = cur.nextStyle;
    if (n && typeof n !== "string" && n.isValid) cur = n;
  }
  return ps.length;
};
`;

// ---------------------------------------------------------------------------
// Argument checking and schema pieces.

function styleRef(value, name) {
    const v = String(value ?? '').trim();
    if (!v) throw new Error(`'${name}' is required: a style name, or "Group/Style"`);
    if (v.length > 500) throw new Error(`'${name}' is too long`);
    return v;
}

function int(value, { min = 0, max = 100000, name }) {
    const n = Number(num(value, { min, max, name }));
    if (!Number.isInteger(n)) throw new Error(`'${name}' must be a whole number`);
    return String(n);
}

function pair(value, name) {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`'${name}' must be [first, last]`);
    const a = Number(int(value[0], { name }));
    const b = Number(int(value[1], { name }));
    if (b < a) throw new Error(`'${name}': last must not be before first`);
    return [a, b];
}

function obj(value, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    return value;
}

const RANGE = (what) => ({ type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2, description: `First and last ${what} (0-based, inclusive)` });
const STYLE = (what) => ({ type: 'string', description: `${what}: a style name, or "Group/Style" for a style inside a style group` });
const KIND = { type: 'string', enum: KINDS, description: 'Which kind of style' };
const TARGET_KIND = { ...KIND, description: 'Which kind of style. Give text for paragraph and character styles, target for object styles, table for table styles and cells for cell styles' };

const TEXT_SCHEMA = {
    type: 'object',
    description: 'Which text: a text frame by id (the text in the frame, or its whole story), optionally narrowed to a paragraph or character range; or selection: true for the selected text',
    properties: {
        frameId: { type: 'integer', minimum: 0, description: 'Text frame id (PageItem.id, from list_page_items)' },
        story: { type: 'boolean', description: 'Use the whole story the frame belongs to, not only the text in the frame' },
        paragraphs: RANGE('paragraph index within the frame or story'),
        characters: RANGE('character index within the frame or story'),
        selection: { type: 'boolean', description: 'Use the selected text, or the text of the selected text frame' },
    },
};

/** A text choice as a JSX literal for __text(). */
function textSpec(t, name = 'text') {
    const v = obj(t, name) ?? {};
    const out = { selection: !!v.selection, frameId: null, story: !!v.story, paragraphs: pair(v.paragraphs, `${name}.paragraphs`), characters: pair(v.characters, `${name}.characters`) };
    if (!out.selection) {
        if (!has(v.frameId)) throw new Error(`Choose the text: ${name}.frameId (a text frame id) or ${name}.selection: true`);
        out.frameId = Number(int(v.frameId, { name: `${name}.frameId`, max: 1e9 }));
    }
    if (out.paragraphs && out.characters) throw new Error(`Give ${name}.paragraphs or ${name}.characters, not both`);
    return json(out);
}

// ---------------------------------------------------------------------------
// Attribute tables: InDesign property names, their value types and ranges.
// Types: bool, num, int, pt (points, sent as "Npt"), mm (script units are mm),
// mm4 (one value or [top, left, bottom, right]), str, enum, color, stroke
// (a stroke style name), cstyle / pstyle (a character / paragraph style),
// leading (points or "auto"), span (a column count or "all").

const E = {
    Capitalization: ['NORMAL', 'SMALL_CAPS', 'ALL_CAPS', 'CAP_TO_SMALL_CAP'],
    Position: ['NORMAL', 'SUPERSCRIPT', 'SUBSCRIPT', 'OT_SUPERSCRIPT', 'OT_SUBSCRIPT', 'OT_NUMERATOR', 'OT_DENOMINATOR'],
    Justification: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED', 'TO_BINDING_SIDE', 'AWAY_FROM_BINDING_SIDE'],
    StartParagraph: ['ANYWHERE', 'NEXT_COLUMN', 'NEXT_FRAME', 'NEXT_PAGE', 'NEXT_ODD_PAGE', 'NEXT_EVEN_PAGE'],
    SingleWordJustification: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'FULLY_JUSTIFIED'],
    RuleWidth: ['COLUMN_WIDTH', 'TEXT_WIDTH'],
    SpanColumnTypeOptions: ['SINGLE_COLUMN', 'SPAN_COLUMNS', 'SPLIT_COLUMNS'],
    ListType: ['NO_LIST', 'BULLET_LIST', 'NUMBERED_LIST'],
    VerticalJustification: ['TOP_ALIGN', 'CENTER_ALIGN', 'BOTTOM_ALIGN', 'JUSTIFY_ALIGN'],
    FirstBaseline: ['ASCENT_OFFSET', 'CAP_HEIGHT', 'EMBOX_HEIGHT', 'FIXED_HEIGHT', 'LEADING_OFFSET', 'X_HEIGHT'],
    BaselineFrameGridRelativeOption: ['TOP_OF_PAGE', 'TOP_OF_MARGIN', 'TOP_OF_FRAME', 'TOP_OF_INSET'],
    AutoSizingTypeEnum: ['OFF', 'HEIGHT_ONLY', 'WIDTH_ONLY', 'HEIGHT_AND_WIDTH', 'HEIGHT_AND_WIDTH_PROPORTIONALLY'],
    AutoSizingReferenceEnum: ['TOP_LEFT_POINT', 'TOP_CENTER_POINT', 'TOP_RIGHT_POINT', 'LEFT_CENTER_POINT', 'CENTER_POINT', 'RIGHT_CENTER_POINT', 'BOTTOM_LEFT_POINT', 'BOTTOM_CENTER_POINT', 'BOTTOM_RIGHT_POINT'],
    TextWrapModes: ['NONE', 'BOUNDING_BOX_TEXT_WRAP', 'CONTOUR', 'JUMP_OBJECT_TEXT_WRAP', 'NEXT_COLUMN_TEXT_WRAP'],
    TextWrapSideOptions: ['BOTH_SIDES', 'LEFT_SIDE', 'RIGHT_SIDE', 'SIDE_TOWARDS_SPINE', 'SIDE_AWAY_FROM_SPINE', 'LARGEST_AREA'],
    AnchorPosition: ['INLINE_POSITION', 'ABOVE_LINE', 'ANCHORED'],
    AnchorPoint: ['TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR', 'LEFT_CENTER_ANCHOR', 'CENTER_ANCHOR', 'RIGHT_CENTER_ANCHOR', 'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR'],
    AnchoredRelativeTo: ['ANCHOR_LOCATION', 'COLUMN_EDGE', 'PAGE_EDGE', 'PAGE_MARGINS', 'TEXT_FRAME'],
    VerticallyRelativeTo: ['CAPHEIGHT', 'COLUMN_EDGE', 'EMBOX_BOTTOM', 'EMBOX_MIDDLE', 'EMBOX_TOP', 'LINE_ASCENT', 'LINE_BASELINE', 'LINE_XHEIGHT', 'PAGE_EDGE', 'PAGE_MARGINS', 'TEXT_FRAME', 'TOP_OF_LEADING'],
    HorizontalAlignment: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'TEXT_ALIGN'],
    VerticalAlignment: ['TOP_ALIGN', 'CENTER_ALIGN', 'BOTTOM_ALIGN'],
    EmptyFrameFittingOptions: ['NONE', 'CONTENT_TO_FRAME', 'FILL_PROPORTIONALLY', 'PROPORTIONALLY'],
    SourceType: ['SOURCE_CUSTOM', 'SOURCE_XML_STRUCTURE', 'SOURCE_XMP_ALT_TEXT', 'SOURCE_XMP_DESCRIPTION', 'SOURCE_XMP_EXTENDED_DESCRIPTION', 'SOURCE_XMP_HEADLINE', 'SOURCE_XMP_OTHER', 'SOURCE_XMP_TITLE'],
    TagType: ['TAG_ARTIFACT', 'TAG_BASED_ON_OBJECT', 'TAG_FROM_STRUCTURE'],
    PreserveAppearanceFromLayoutEnum: ['PRESERVE_APPEARANCE_DEFAULT', 'PRESERVE_APPEARANCE_RASTERIZE_CONTAINER', 'PRESERVE_APPEARANCE_RASTERIZE_CONTENT', 'PRESERVE_APPEARANCE_USE_EXISTING_IMAGE'],
    CornerOptions: ['NONE', 'ROUNDED_CORNER', 'INVERSE_ROUNDED_CORNER', 'INSET_CORNER', 'BEVEL_CORNER', 'FANCY_CORNER'],
    StrokeOrderTypes: ['BEST_JOINS', 'ROW_ON_TOP', 'COLUMN_ON_TOP', 'INDESIGN_2_COMPATIBILITY'],
    PageNumberPosition: ['AFTER_ENTRY', 'BEFORE_ENTRY', 'NONE'],
    NumberedParagraphsOptions: ['INCLUDE_FULL_PARAGRAPH', 'INCLUDE_NUMBERS_ONLY', 'EXCLUDE_NUMBERS'],
};

const en = (e, d) => ({ t: 'enum', e, d: `${d} (${e})` });

/** Character attributes, shared by character and paragraph styles. */
const CHAR_ATTRS = {
    appliedFont: { t: 'str', d: 'Font family, or "Family\\tStyle"' },
    fontStyle: { t: 'str', d: 'Font style name, such as Bold or Italic' },
    pointSize: { t: 'pt', min: 0.1, max: 1296, d: 'Font size in points' },
    leading: { t: 'leading', d: 'Leading in points, or "auto"' },
    tracking: { t: 'num', min: -1000, max: 10000, d: 'Tracking in thousandths of an em' },
    capitalization: en('Capitalization', 'Case'),
    position: en('Position', 'Superscript, subscript or OpenType position'),
    underline: { t: 'bool', d: 'Underline' },
    strikeThru: { t: 'bool', d: 'Strikethrough' },
    ligatures: { t: 'bool', d: 'Use ligatures' },
    noBreak: { t: 'bool', d: 'No Break' },
    horizontalScale: { t: 'num', min: 1, max: 1000, d: 'Horizontal scale in percent' },
    verticalScale: { t: 'num', min: 1, max: 1000, d: 'Vertical scale in percent' },
    baselineShift: { t: 'pt', min: -5000, max: 5000, d: 'Baseline shift in points' },
    skew: { t: 'num', min: -85, max: 85, d: 'Skew (false italic) in degrees' },
    appliedLanguage: { t: 'str', d: 'Language name, such as "English: USA"' },
    fillColor: { t: 'color', d: 'Character colour: a swatch name or #RRGGBB' },
    fillTint: { t: 'num', min: -1, max: 100, d: 'Character colour tint in percent (-1 = none)' },
    strokeColor: { t: 'color', d: 'Character stroke colour: a swatch name or #RRGGBB' },
    strokeTint: { t: 'num', min: -1, max: 100, d: 'Character stroke tint in percent' },
    strokeWeight: { t: 'pt', min: 0, max: 1000, d: 'Character stroke weight in points' },
};

/** Paragraph-only attributes (Indents and Spacing, Keep Options, Hyphenation, ...). */
const PARA_ATTRS = {
    ...CHAR_ATTRS,
    justification: en('Justification', 'Alignment'),
    leftIndent: { t: 'mm', min: -5000, max: 5000, d: 'Left indent in mm' },
    rightIndent: { t: 'mm', min: -5000, max: 5000, d: 'Right indent in mm' },
    firstLineIndent: { t: 'mm', min: -5000, max: 5000, d: 'First line indent in mm' },
    lastLineIndent: { t: 'mm', min: -5000, max: 5000, d: 'Last line indent in mm' },
    spaceBefore: { t: 'mm', min: 0, max: 5000, d: 'Space before in mm' },
    spaceAfter: { t: 'mm', min: 0, max: 5000, d: 'Space after in mm' },
    alignToBaseline: { t: 'bool', d: 'Align to baseline grid' },
    balanceRaggedLines: { t: 'bool', d: 'Balance ragged lines' },
    keepWithNext: { t: 'int', min: 0, max: 5, d: 'Keep with next N lines' },
    keepLinesTogether: { t: 'bool', d: 'Keep lines together' },
    keepAllLinesTogether: { t: 'bool', d: 'Keep all lines in the paragraph together' },
    keepFirstLines: { t: 'int', min: 1, max: 50, d: 'Keep the first N lines together' },
    keepLastLines: { t: 'int', min: 1, max: 50, d: 'Keep the last N lines together' },
    startParagraph: en('StartParagraph', 'Where the paragraph starts'),
    hyphenation: { t: 'bool', d: 'Hyphenate' },
    hyphenateWordsLongerThan: { t: 'int', min: 3, max: 25, d: 'Hyphenate words with at least N letters' },
    hyphenateAfterFirst: { t: 'int', min: 1, max: 15, d: 'Letters before a hyphen' },
    hyphenateBeforeLast: { t: 'int', min: 1, max: 15, d: 'Letters after a hyphen' },
    hyphenateLadderLimit: { t: 'int', min: 0, max: 25, d: 'Hyphen limit (consecutive hyphens, 0 = no limit)' },
    hyphenationZone: { t: 'mm', min: 0, max: 1000, d: 'Hyphenation zone in mm' },
    hyphenateCapitalizedWords: { t: 'bool', d: 'Hyphenate capitalised words' },
    hyphenateLastWord: { t: 'bool', d: 'Hyphenate the last word' },
    hyphenateAcrossColumns: { t: 'bool', d: 'Hyphenate across columns' },
    minimumWordSpacing: { t: 'num', min: 0, max: 1000, d: 'Minimum word spacing in percent' },
    desiredWordSpacing: { t: 'num', min: 0, max: 1000, d: 'Desired word spacing in percent' },
    maximumWordSpacing: { t: 'num', min: 0, max: 1000, d: 'Maximum word spacing in percent' },
    minimumLetterSpacing: { t: 'num', min: -100, max: 500, d: 'Minimum letter spacing in percent' },
    desiredLetterSpacing: { t: 'num', min: -100, max: 500, d: 'Desired letter spacing in percent' },
    maximumLetterSpacing: { t: 'num', min: -100, max: 500, d: 'Maximum letter spacing in percent' },
    minimumGlyphScaling: { t: 'num', min: 50, max: 200, d: 'Minimum glyph scaling in percent' },
    desiredGlyphScaling: { t: 'num', min: 50, max: 200, d: 'Desired glyph scaling in percent' },
    maximumGlyphScaling: { t: 'num', min: 50, max: 200, d: 'Maximum glyph scaling in percent' },
    autoLeading: { t: 'num', min: 0, max: 500, d: 'Auto leading in percent of the font size' },
    singleWordJustification: en('SingleWordJustification', 'Single word justification'),
    composer: { t: 'str', d: 'Composer name, such as "Adobe Paragraph Composer"' },
    dropCapLines: { t: 'int', min: 0, max: 25, d: 'Drop cap height in lines' },
    dropCapCharacters: { t: 'int', min: 0, max: 150, d: 'Drop cap characters' },
    dropCapStyle: { t: 'cstyle', d: 'Character style for the drop cap' },
    ruleAbove: { t: 'bool', d: 'Rule above on' },
    ruleAboveLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Rule above weight in points' },
    ruleAboveColor: { t: 'color', d: 'Rule above colour' },
    ruleAboveTint: { t: 'num', min: -1, max: 100, d: 'Rule above tint in percent' },
    ruleAboveOffset: { t: 'mm', min: -1000, max: 1000, d: 'Rule above offset in mm' },
    ruleAboveLeftIndent: { t: 'mm', min: -1000, max: 1000, d: 'Rule above left indent in mm' },
    ruleAboveRightIndent: { t: 'mm', min: -1000, max: 1000, d: 'Rule above right indent in mm' },
    ruleAboveWidth: en('RuleWidth', 'Rule above width'),
    ruleBelow: { t: 'bool', d: 'Rule below on' },
    ruleBelowLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Rule below weight in points' },
    ruleBelowColor: { t: 'color', d: 'Rule below colour' },
    ruleBelowTint: { t: 'num', min: -1, max: 100, d: 'Rule below tint in percent' },
    ruleBelowOffset: { t: 'mm', min: -1000, max: 1000, d: 'Rule below offset in mm' },
    ruleBelowLeftIndent: { t: 'mm', min: -1000, max: 1000, d: 'Rule below left indent in mm' },
    ruleBelowRightIndent: { t: 'mm', min: -1000, max: 1000, d: 'Rule below right indent in mm' },
    ruleBelowWidth: en('RuleWidth', 'Rule below width'),
    spanColumnType: en('SpanColumnTypeOptions', 'Span or split columns'),
    spanSplitColumnCount: { t: 'span', d: 'Columns to span or split into: a number, or "all"' },
    paragraphShadingOn: { t: 'bool', d: 'Paragraph shading on' },
    paragraphShadingColor: { t: 'color', d: 'Paragraph shading colour' },
    paragraphShadingTint: { t: 'num', min: -1, max: 100, d: 'Paragraph shading tint in percent' },
    paragraphBorderOn: { t: 'bool', d: 'Paragraph border on' },
    paragraphBorderColor: { t: 'color', d: 'Paragraph border colour' },
    paragraphBorderTopLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Paragraph border top weight in points' },
    paragraphBorderBottomLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Paragraph border bottom weight in points' },
    paragraphBorderLeftLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Paragraph border left weight in points' },
    paragraphBorderRightLineWeight: { t: 'pt', min: 0, max: 1000, d: 'Paragraph border right weight in points' },
    bulletsAndNumberingListType: en('ListType', 'Bullets and numbering list type'),
    bulletsTextAfter: { t: 'str', d: 'Text after the bullet or number, such as "^t"' },
    bulletsCharacterStyle: { t: 'cstyle', d: 'Character style for bullets' },
    numberingFormat: { t: 'str', d: 'Numbering format, such as "1, 2, 3, 4..."' },
    numberingExpression: { t: 'str', d: 'Number expression, such as "^#.^t"' },
    numberingStartAt: { t: 'int', min: 0, max: 1e6, d: 'Number to start at' },
    numberingLevel: { t: 'int', min: 1, max: 9, d: 'List level' },
    numberingCharacterStyle: { t: 'cstyle', d: 'Character style for numbers' },
    splitDocument: { t: 'bool', d: 'Split the EPUB document at this style' },
    emitCss: { t: 'bool', d: 'Emit CSS for the style on export' },
    includeClass: { t: 'bool', d: 'Include the class in exported HTML' },
};

/** A JSX expression for one attribute value, checked against its entry. */
function valueExpr(spec, value, name) {
    switch (spec.t) {
        case 'bool':
            if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
            return bool(value);
        case 'num':
            return num(value, { min: spec.min, max: spec.max, name });
        case 'int':
            return int(value, { min: spec.min, max: spec.max, name });
        case 'pt':
            return str(`${num(value, { min: spec.min, max: spec.max, name })}pt`);
        case 'mm':
            return num(value, { min: spec.min ?? -10000, max: spec.max ?? 10000, name });
        case 'mm4': {
            if (Array.isArray(value)) {
                if (value.length !== 4) throw new Error(`'${name}' must be one value or [top, left, bottom, right]`);
                return `[${value.map((v) => num(v, { min: 0, max: 10000, name })).join(', ')}]`;
            }
            return num(value, { min: 0, max: 10000, name });
        }
        case 'str': {
            const v = String(value);
            if (v.length > 1000) throw new Error(`'${name}' is too long`);
            return str(v);
        }
        case 'enum':
            return `${spec.e}.${enumOf(value, E[spec.e], { name })}`;
        case 'color':
            return `__swatch(doc, ${colorSpec(value, name)})`;
        case 'stroke':
            return `__strokeStyle(doc, ${str(styleRef(value, name))})`;
        case 'cstyle':
            return `__style(doc, "character", ${str(styleRef(value, name))})`;
        case 'pstyle':
            return `__style(doc, "paragraph", ${str(styleRef(value, name))})`;
        case 'cellstyle':
            return `__style(doc, "cell", ${str(styleRef(value, name))})`;
        case 'leading':
            if (String(value).toLowerCase() === 'auto') return 'Leading.AUTO';
            return str(`${num(value, { min: 0, max: 5000, name })}pt`);
        case 'span':
            if (String(value).toLowerCase() === 'all') return 'SpanColumnCountOptions.ALL';
            return int(value, { min: 1, max: 40, name });
        default:
            throw new Error(`internal: unknown attribute type ${spec.t}`);
    }
}

/**
 * Statements setting each attribute in `attrs` on `target`, from `table`.
 * Entries may name another property (`prop`), several (`props`), another
 * object (`on`), and the object style category the attribute belongs to
 * (`en`, collected into `enables`).
 */
function assign(target, attrs, table, where, enables) {
    const a = obj(attrs, where);
    if (!a) return [];
    const out = [];
    for (const [key, value] of Object.entries(a)) {
        const spec = table[key];
        if (!spec) throw new Error(`Unknown ${where} attribute '${key}'. Known: ${Object.keys(table).join(', ')}`);
        if (value === undefined || value === null) continue;
        const expr = valueExpr(spec, value, `${where}.${key}`);
        for (const prop of spec.props ?? [spec.prop ?? key]) out.push(`${spec.on ?? target}.${prop} = ${expr};`);
        if (enables && spec.en) enables.add(spec.en);
    }
    return out;
}

/** A JSON schema for an attribute table. */
function schemaOf(table, description) {
    const properties = {};
    for (const [key, spec] of Object.entries(table)) {
        const p = { description: spec.d };
        if (spec.t === 'bool') p.type = 'boolean';
        else if (spec.t === 'num' || spec.t === 'pt' || spec.t === 'mm') p.type = 'number';
        else if (spec.t === 'int') p.type = 'integer';
        else if (spec.t === 'enum') { p.type = 'string'; p.enum = E[spec.e]; }
        else if (spec.t === 'color') { p.type = 'string'; p.description = `${spec.d} (${COLOR_SCHEMA.description})`; }
        else if (spec.t === 'mm4') { p.anyOf = [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }]; }
        else if (spec.t === 'leading' || spec.t === 'span') { p.anyOf = [{ type: 'number' }, { type: 'string' }]; }
        else p.type = 'string';
        properties[key] = p;
    }
    return { type: 'object', description, properties };
}

/** Line settings (count, weight, colour, stroke type, tint) as statements on `prefix`*. */
function lineAssign(prefix, line, where, { fields = ['weight', 'color', 'type', 'tint'], typeProp } = {}) {
    const v = obj(line, where);
    if (!v) return [];
    const out = [];
    for (const k of Object.keys(v)) if (!fields.includes(k)) throw new Error(`Unknown ${where} field '${k}'. Known: ${fields.join(', ')}`);
    if (has(v.count)) out.push(`${prefix}Count = ${int(v.count, { min: 0, max: 1000, name: `${where}.count` })};`);
    if (has(v.weight)) out.push(`${prefix}Weight = ${valueExpr({ t: 'pt', min: 0, max: 1000 }, v.weight, `${where}.weight`)};`);
    if (has(v.color)) out.push(`${prefix}Color = ${valueExpr({ t: 'color' }, v.color, `${where}.color`)};`);
    if (has(v.type)) out.push(`${typeProp ?? `${prefix}Type`} = ${valueExpr({ t: 'stroke' }, v.type, `${where}.type`)};`);
    if (has(v.tint)) out.push(`${prefix}Tint = ${num(v.tint, { min: 0, max: 100, name: `${where}.tint` })};`);
    return out;
}

const LINE_SCHEMA = (what, { count = false, fill = false } = {}) => ({
    type: 'object',
    description: what,
    properties: {
        ...(count ? { count: { type: 'integer', minimum: 0, description: 'How many rows or columns this part of the pattern covers' } } : {}),
        ...(fill ? {} : { weight: { type: 'number', minimum: 0, description: 'Weight in points' } }),
        color: { type: 'string', description: `Colour: ${COLOR_SCHEMA.description}` },
        ...(fill ? {} : { type: { type: 'string', description: 'Stroke type: a stroke style name, such as Solid or Dashed' } }),
        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint in percent' },
    },
});

// ---------------------------------------------------------------------------
// Creating or opening the style a set_*_style call edits.

const COMMON_STYLE_PROPS = (kind) => ({
    style: STYLE(`The ${LABEL[kind]} to edit (or to create, with create: true)`),
    create: { type: 'boolean', description: 'Create the style when it does not exist yet' },
    group: { type: 'string', description: 'Style group path for a new style, such as "Headings" or "Body/Lists" (groups are created as needed). Without it, a "Group/Style" name puts the style in that group' },
    name: { type: 'string', description: 'Rename the style (Style Name)' },
    basedOn: STYLE(`Based On: the parent ${LABEL[kind]}`),
});

/** Statements that find (or create) the style as `s`, then rename and re-parent it. */
function openStyle(kind, a) {
    const ref = styleRef(a.style, 'style');
    let group = has(a.group) ? String(a.group) : '';
    let leaf = ref;
    if (!has(a.group) && ref.lastIndexOf('/') > 0) {
        group = ref.slice(0, ref.lastIndexOf('/'));
        leaf = ref.slice(ref.lastIndexOf('/') + 1);
    }
    const lines = [`var s = __findStyle(doc, "${kind}", ${str(ref)}), created = false;`, 'if (!s) {'];
    if (a.create) {
        lines.push(
            `  var owner = __group(doc, "${kind}", ${str(group)}, true);`,
            `  s = owner[__SK["${kind}"].own].add({ name: ${str(leaf)} });`,
            '  created = true;',
        );
    } else {
        lines.push(`  throw new Error(${str(`No ${LABEL[kind]} named ${ref}; pass create: true to make it`)});`);
    }
    lines.push('}');
    if (has(a.name)) lines.push('__builtIn(s);', `s.name = ${str(styleRef(a.name, 'name'))};`);
    if (has(a.basedOn)) lines.push(`s.basedOn = __style(doc, "${kind}", ${str(styleRef(a.basedOn, 'basedOn'))});`);
    return lines;
}

/** Reset To Base: copy the parent style's attributes onto the style. */
const RESET_TO_BASE = String.raw`
var __base = s.basedOn;
if (typeof __base === "string" || !__base.isValid) throw new Error(s.name + " is not based on another style");
var __bp = __base.properties, __skip = { name: true, basedOn: true, nextStyle: true, id: true, index: true, parent: true, label: true, isValid: true, imported: true, styleUniqueId: true, properties: true, events: true, eventListeners: true, preferences: true, styleExportTagMaps: true };
for (var __k in __bp) {
  if (__skip[__k] === true) continue;
  try { s[__k] = __bp[__k]; } catch (e) {}
}`;

// ---------------------------------------------------------------------------
// Object style sections (Object Style Options categories).

const OS_SECTIONS = {
    fill: {
        d: 'Fill category', on: 's', en: 'enableFill',
        attrs: { fillColor: { t: 'color', d: 'Fill colour' }, fillTint: { t: 'num', min: -1, max: 100, d: 'Fill tint in percent' } },
    },
    stroke: {
        d: 'Stroke category', on: 's', en: 'enableStroke',
        attrs: {
            strokeColor: { t: 'color', d: 'Stroke colour' },
            strokeWeight: { t: 'pt', min: 0, max: 1000, d: 'Stroke weight in points' },
            strokeTint: { t: 'num', min: -1, max: 100, d: 'Stroke tint in percent' },
            strokeType: { t: 'stroke', d: 'Stroke type: a stroke style name, such as Solid or Dashed' },
        },
    },
    corners: {
        d: 'Stroke & Corner Options category: the same corner shape and size on all four corners', on: 's', en: 'enableStrokeAndCornerOptions',
        attrs: {
            cornerOption: { ...en('CornerOptions', 'Corner shape'), props: ['topLeftCornerOption', 'topRightCornerOption', 'bottomLeftCornerOption', 'bottomRightCornerOption'] },
            cornerRadius: { t: 'mm', min: 0, max: 5000, d: 'Corner size in mm', props: ['topLeftCornerRadius', 'topRightCornerRadius', 'bottomLeftCornerRadius', 'bottomRightCornerRadius'] },
        },
    },
    paragraphStyle: {
        d: 'Paragraph Styles category: the paragraph style for text in frames with this style', on: 's', en: 'enableParagraphStyle',
        attrs: {
            style: { t: 'pstyle', prop: 'appliedParagraphStyle', d: 'Paragraph style name or "Group/Style"' },
            applyNextStyle: { t: 'bool', prop: 'applyNextParagraphStyle', d: 'Apply Next Style to the following paragraphs' },
        },
    },
    textFrame: {
        d: 'Text Frame General Options category', on: 's.textFramePreferences', en: 'enableTextFrameGeneralOptions',
        attrs: {
            textColumnCount: { t: 'int', min: 1, max: 40, d: 'Number of columns' },
            textColumnGutter: { t: 'mm', min: 0, max: 1000, d: 'Column gutter in mm' },
            textColumnFixedWidth: { t: 'mm', min: 0, max: 5000, d: 'Fixed column width in mm' },
            useFixedColumnWidth: { t: 'bool', d: 'Use a fixed column width' },
            insetSpacing: { t: 'mm4', d: 'Inset spacing in mm: one value or [top, left, bottom, right]' },
            verticalJustification: en('VerticalJustification', 'Vertical justification'),
            verticalThreshold: { t: 'mm', min: 0, max: 1000, d: 'Paragraph spacing limit in mm (justify alignment)' },
            verticalBalanceColumns: { t: 'bool', d: 'Balance columns' },
            ignoreWrap: { t: 'bool', d: 'Ignore text wrap' },
        },
    },
    baseline: {
        d: 'Text Frame Baseline Options category', on: 's.textFramePreferences', en: 'enableTextFrameBaselineOptions',
        attrs: {
            firstBaselineOffset: en('FirstBaseline', 'First baseline offset'),
            minimumFirstBaselineOffset: { t: 'mm', min: 0, max: 1000, d: 'Minimum first baseline offset in mm' },
            useCustomBaselineFrameGrid: { t: 'bool', on: 's.baselineFrameGridOptions', d: 'Use a custom baseline grid' },
            startingOffsetForBaselineFrameGrid: { t: 'mm', min: 0, max: 1000, on: 's.baselineFrameGridOptions', d: 'Custom grid start in mm' },
            baselineFrameGridIncrement: { t: 'pt', min: 1, max: 1000, on: 's.baselineFrameGridOptions', d: 'Custom grid increment in points' },
            baselineFrameGridRelativeOption: { ...en('BaselineFrameGridRelativeOption', 'Custom grid relative to'), on: 's.baselineFrameGridOptions' },
        },
    },
    autoSize: {
        d: 'Text Frame Auto-Size Options category', on: 's.textFramePreferences', en: 'enableTextFrameAutoSizingOptions',
        attrs: {
            autoSizingType: en('AutoSizingTypeEnum', 'Auto-sizing'),
            autoSizingReferencePoint: en('AutoSizingReferenceEnum', 'Auto-sizing reference point'),
            useMinimumHeightForAutoSizing: { t: 'bool', d: 'Use a minimum height' },
            minimumHeightForAutoSizing: { t: 'mm', min: 0, max: 5000, d: 'Minimum height in mm' },
            useMinimumWidthForAutoSizing: { t: 'bool', d: 'Use a minimum width' },
            minimumWidthForAutoSizing: { t: 'mm', min: 0, max: 5000, d: 'Minimum width in mm' },
            useNoLineBreaksForAutoSizing: { t: 'bool', d: 'No line breaks' },
        },
    },
    columnRules: {
        d: 'Text Frame Column Rules category', on: 's.textFramePreferences', en: 'enableTextFrameColumnRuleOptions',
        attrs: {
            columnRuleOverride: { t: 'bool', d: 'Turn column rules on' },
            columnRuleStrokeWidth: { t: 'pt', min: 0, max: 1000, d: 'Rule weight in points' },
            columnRuleStrokeColor: { t: 'color', d: 'Rule colour' },
            columnRuleStrokeTint: { t: 'num', min: 0, max: 100, d: 'Rule tint in percent' },
            columnRuleStrokeType: { t: 'stroke', d: 'Rule type: a stroke style name' },
            columnRuleOffset: { t: 'mm', min: -1000, max: 1000, d: 'Horizontal offset in mm' },
            columnRuleTopInset: { t: 'mm', min: 0, max: 1000, d: 'Top inset in mm' },
            columnRuleBottomInset: { t: 'mm', min: 0, max: 1000, d: 'Bottom inset in mm' },
            columnRuleInsetChainOverride: { t: 'bool', d: 'Use the same top and bottom inset' },
        },
    },
    story: {
        d: 'Story Options category', on: 's.storyPreferences', en: 'enableStoryOptions',
        attrs: {
            opticalMarginAlignment: { t: 'bool', d: 'Optical margin alignment' },
            opticalMarginSize: { t: 'pt', min: 0.1, max: 1296, d: 'Optical margin size in points' },
        },
    },
    textWrap: {
        d: 'Text Wrap & Other category', on: 's.textWrapPreferences', en: 'enableTextWrapAndOthers',
        attrs: {
            textWrapMode: en('TextWrapModes', 'Wrap type'),
            textWrapOffset: { t: 'mm4', d: 'Wrap offsets in mm: one value or [top, left, bottom, right]' },
            textWrapSide: en('TextWrapSideOptions', 'Wrap to'),
            inverse: { t: 'bool', d: 'Invert the wrap' },
            nonprinting: { t: 'bool', on: 's', d: 'Nonprinting' },
        },
    },
    anchored: {
        d: 'Anchored Object Options category', on: 's.anchoredObjectSettings', en: 'enableAnchoredObjectOptions',
        attrs: {
            anchoredPosition: en('AnchorPosition', 'Position: inline, above line or custom'),
            anchorPoint: en('AnchorPoint', 'Anchored object reference point'),
            horizontalReferencePoint: en('AnchoredRelativeTo', 'X relative to'),
            verticalReferencePoint: en('VerticallyRelativeTo', 'Y relative to'),
            horizontalAlignment: en('HorizontalAlignment', 'Horizontal alignment (above line)'),
            verticalAlignment: en('VerticalAlignment', 'Vertical alignment'),
            anchorXoffset: { t: 'mm', min: -5000, max: 5000, d: 'X offset in mm' },
            anchorYoffset: { t: 'mm', min: -5000, max: 5000, d: 'Y offset in mm' },
            anchorSpaceAbove: { t: 'mm', min: -5000, max: 5000, d: 'Space before (above line) in mm' },
            lockPosition: { t: 'bool', d: 'Prevent manual positioning' },
            spineRelative: { t: 'bool', d: 'Relative to spine' },
            pinPosition: { t: 'bool', d: 'Keep within top and bottom column boundaries' },
        },
    },
    frameFitting: {
        d: 'Frame Fitting Options category', on: 's.frameFittingOptions', en: 'enableFrameFittingOptions',
        attrs: {
            fittingOnEmptyFrame: en('EmptyFrameFittingOptions', 'Fitting on empty frame'),
            fittingAlignment: en('AnchorPoint', 'Fitting reference point'),
            autoFit: { t: 'bool', d: 'Auto-fit' },
            topCrop: { t: 'mm', min: -5000, max: 5000, d: 'Top crop in mm' },
            leftCrop: { t: 'mm', min: -5000, max: 5000, d: 'Left crop in mm' },
            bottomCrop: { t: 'mm', min: -5000, max: 5000, d: 'Bottom crop in mm' },
            rightCrop: { t: 'mm', min: -5000, max: 5000, d: 'Right crop in mm' },
        },
    },
    export: {
        d: 'Export Options categories (Alt Text, Tagged PDF, EPUB and HTML)', on: 's.objectExportOptions',
        attrs: {
            altTextSourceType: { ...en('SourceType', 'Alt text source'), en: 'enableObjectExportAltTextOptions' },
            customAltText: { t: 'str', d: 'Custom alt text', en: 'enableObjectExportAltTextOptions' },
            applyTagType: { ...en('TagType', 'Tagged PDF: apply tag'), en: 'enableObjectExportTaggedPdfOptions' },
            actualTextSourceType: { ...en('SourceType', 'Tagged PDF: actual text source'), en: 'enableObjectExportTaggedPdfOptions' },
            customActualText: { t: 'str', d: 'Tagged PDF: custom actual text', en: 'enableObjectExportTaggedPdfOptions' },
            preserveAppearanceFromLayout: { ...en('PreserveAppearanceFromLayoutEnum', 'EPUB and HTML: preserve appearance from layout'), en: 'enableObjectExportEpubOptions' },
            epubType: { t: 'str', d: 'EPUB type, such as "sidebar"', en: 'enableObjectExportEpubOptions' },
        },
    },
};

const OS_CATEGORIES = {
    fill: 'enableFill',
    stroke: 'enableStroke',
    strokeAndCornerOptions: 'enableStrokeAndCornerOptions',
    paragraphStyle: 'enableParagraphStyle',
    textFrameGeneralOptions: 'enableTextFrameGeneralOptions',
    textFrameBaselineOptions: 'enableTextFrameBaselineOptions',
    textFrameAutoSizingOptions: 'enableTextFrameAutoSizingOptions',
    textFrameColumnRuleOptions: 'enableTextFrameColumnRuleOptions',
    textFrameFootnoteOptions: 'enableTextFrameFootnoteOptions',
    storyOptions: 'enableStoryOptions',
    textWrapAndOthers: 'enableTextWrapAndOthers',
    anchoredObjectOptions: 'enableAnchoredObjectOptions',
    frameFittingOptions: 'enableFrameFittingOptions',
    exportAltText: 'enableObjectExportAltTextOptions',
    exportTaggedPdf: 'enableObjectExportTaggedPdfOptions',
    exportEpub: 'enableObjectExportEpubOptions',
    exportTagging: 'enableExportTagging',
    transformAttributes: 'enableTransformAttributes',
};

// ---------------------------------------------------------------------------
// Table and cell style options.

const REGIONS = {
    header: ['headerRegionCellStyle', 'headerRegionSameAsBodyRegion'],
    footer: ['footerRegionCellStyle', 'footerRegionSameAsBodyRegion'],
    body: ['bodyRegionCellStyle', null],
    leftColumn: ['leftColumnRegionCellStyle', 'leftColumnRegionSameAsBodyRegion'],
    rightColumn: ['rightColumnRegionCellStyle', 'rightColumnRegionSameAsBodyRegion'],
};

function tableStyleStatements(a) {
    const out = [];
    const regions = obj(a.cellStyles, 'cellStyles');
    if (regions) {
        for (const [k, v] of Object.entries(regions)) {
            const r = REGIONS[k];
            if (!r) throw new Error(`Unknown cellStyles region '${k}'. Known: ${Object.keys(REGIONS).join(', ')}`);
            if (!has(v)) continue;
            if (v === 'same_as_body') {
                if (!r[1]) throw new Error("cellStyles.body cannot be 'same_as_body'");
                out.push(`s.${r[1]} = true;`);
            } else {
                if (r[1]) out.push(`s.${r[1]} = false;`);
                out.push(`s.${r[0]} = __style(doc, "cell", ${str(styleRef(v, `cellStyles.${k}`))});`);
            }
        }
    }
    const setup = obj(a.tableSetup, 'tableSetup');
    if (setup) {
        const known = ['border', 'topBorder', 'leftBorder', 'bottomBorder', 'rightBorder', 'spaceBefore', 'spaceAfter', 'strokeOrder'];
        for (const k of Object.keys(setup)) if (!known.includes(k)) throw new Error(`Unknown tableSetup field '${k}'. Known: ${known.join(', ')}`);
        for (const side of ['top', 'left', 'bottom', 'right']) {
            out.push(...lineAssign(`s.${side}BorderStroke`, setup.border, 'tableSetup.border'));
            out.push(...lineAssign(`s.${side}BorderStroke`, setup[`${side}Border`], `tableSetup.${side}Border`));
        }
        if (has(setup.spaceBefore)) out.push(`s.spaceBefore = ${num(setup.spaceBefore, { min: -1000, max: 1000, name: 'tableSetup.spaceBefore' })};`);
        if (has(setup.spaceAfter)) out.push(`s.spaceAfter = ${num(setup.spaceAfter, { min: -1000, max: 1000, name: 'tableSetup.spaceAfter' })};`);
        if (has(setup.strokeOrder)) out.push(`s.strokeOrder = StrokeOrderTypes.${enumOf(setup.strokeOrder, E.StrokeOrderTypes, { name: 'tableSetup.strokeOrder' })};`);
    }
    for (const [key, axis] of [['rowStrokes', 'Row'], ['columnStrokes', 'Column']]) {
        const p = obj(a[key], key);
        if (!p) continue;
        const known = ['first', 'next', 'skipFirst', 'skipLast'];
        for (const k of Object.keys(p)) if (!known.includes(k)) throw new Error(`Unknown ${key} field '${k}'. Known: ${known.join(', ')}`);
        const fields = ['count', 'weight', 'color', 'type', 'tint'];
        out.push(...lineAssign(`s.start${axis}Stroke`, p.first, `${key}.first`, { fields }));
        out.push(...lineAssign(`s.end${axis}Stroke`, p.next, `${key}.next`, { fields, typeProp: axis === 'Column' ? 's.endColumnLineStyle' : undefined }));
        if (has(p.skipFirst)) out.push(`s.skipFirstAlternatingStroke${axis}s = ${int(p.skipFirst, { max: 1000, name: `${key}.skipFirst` })};`);
        if (has(p.skipLast)) out.push(`s.skipLastAlternatingStroke${axis}s = ${int(p.skipLast, { max: 1000, name: `${key}.skipLast` })};`);
    }
    const fills = obj(a.fills, 'fills');
    if (fills) {
        const known = ['direction', 'first', 'next', 'skipFirst', 'skipLast'];
        for (const k of Object.keys(fills)) if (!known.includes(k)) throw new Error(`Unknown fills field '${k}'. Known: ${known.join(', ')}`);
        const dir = enumOf(fills.direction ?? 'rows', ['rows', 'columns'], { name: 'fills.direction' });
        const axis = dir === 'rows' ? 'Row' : 'Column';
        const fields = ['count', 'color', 'tint'];
        out.push(`s.columnFillsPriority = ${bool(dir === 'columns')};`);
        out.push(...lineAssign(`s.start${axis}Fill`, fills.first, 'fills.first', { fields }));
        out.push(...lineAssign(`s.end${axis}Fill`, fills.next, 'fills.next', { fields }));
        if (has(fills.skipFirst)) out.push(`s.skipFirstAlternatingFill${axis}s = ${int(fills.skipFirst, { max: 1000, name: 'fills.skipFirst' })};`);
        if (has(fills.skipLast)) out.push(`s.skipLastAlternatingFill${axis}s = ${int(fills.skipLast, { max: 1000, name: 'fills.skipLast' })};`);
    }
    return out;
}

const CELL_TEXT = {
    topInset: { t: 'mm', min: 0, max: 1000, d: 'Top inset in mm' },
    leftInset: { t: 'mm', min: 0, max: 1000, d: 'Left inset in mm' },
    bottomInset: { t: 'mm', min: 0, max: 1000, d: 'Bottom inset in mm' },
    rightInset: { t: 'mm', min: 0, max: 1000, d: 'Right inset in mm' },
    verticalJustification: en('VerticalJustification', 'Vertical justification'),
    paragraphSpacingLimit: { t: 'mm', min: 0, max: 1000, d: 'Paragraph spacing limit in mm' },
    firstBaselineOffset: en('FirstBaseline', 'First baseline offset'),
    minimumFirstBaselineOffset: { t: 'mm', min: 0, max: 1000, d: 'Minimum first baseline offset in mm' },
    clipContentToTextCell: { t: 'bool', d: 'Clip contents to cell' },
};

const CELL_GRAPHIC = {
    graphicTopInset: { t: 'mm', min: 0, max: 1000, d: 'Top inset in mm' },
    graphicLeftInset: { t: 'mm', min: 0, max: 1000, d: 'Left inset in mm' },
    graphicBottomInset: { t: 'mm', min: 0, max: 1000, d: 'Bottom inset in mm' },
    graphicRightInset: { t: 'mm', min: 0, max: 1000, d: 'Right inset in mm' },
    clipContentToGraphicCell: { t: 'bool', d: 'Clip contents to cell' },
};

function cellStyleStatements(a) {
    const out = [];
    if (has(a.paragraphStyle)) out.push(`s.appliedParagraphStyle = __style(doc, "paragraph", ${str(styleRef(a.paragraphStyle, 'paragraphStyle'))});`);
    const text = obj(a.text, 'text');
    if (text) {
        const { rotation, ...rest } = text;
        out.push(...assign('s', rest, CELL_TEXT, 'text'));
        if (has(rotation)) {
            const r = Number(rotation);
            if (![0, 90, 180, 270].includes(r)) throw new Error("'text.rotation' must be 0, 90, 180 or 270");
            out.push(`s.rotationAngle = ${r};`);
        }
    }
    out.push(...assign('s', a.graphic, CELL_GRAPHIC, 'graphic'));
    const strokes = obj(a.strokes, 'strokes');
    if (strokes) {
        const known = ['all', 'top', 'left', 'bottom', 'right'];
        for (const k of Object.keys(strokes)) if (!known.includes(k)) throw new Error(`Unknown strokes edge '${k}'. Known: ${known.join(', ')}`);
        for (const side of ['top', 'left', 'bottom', 'right']) {
            out.push(...lineAssign(`s.${side}EdgeStroke`, strokes.all, 'strokes.all'));
            out.push(...lineAssign(`s.${side}EdgeStroke`, strokes[side], `strokes.${side}`));
        }
    }
    const fill = obj(a.fill, 'fill');
    if (fill) {
        for (const k of Object.keys(fill)) if (!['color', 'tint', 'overprint'].includes(k)) throw new Error(`Unknown fill field '${k}'. Known: color, tint, overprint`);
        if (has(fill.color)) out.push(`s.fillColor = ${valueExpr({ t: 'color' }, fill.color, 'fill.color')};`);
        if (has(fill.tint)) out.push(`s.fillTint = ${num(fill.tint, { min: 0, max: 100, name: 'fill.tint' })};`);
        if (has(fill.overprint)) out.push(`s.overprintFill = ${valueExpr({ t: 'bool' }, fill.overprint, 'fill.overprint')};`);
    }
    const diag = obj(a.diagonal, 'diagonal');
    if (diag) {
        const { topLeft, topRight, inFront, ...line } = diag;
        if (has(topLeft)) out.push(`s.topLeftDiagonalLine = ${valueExpr({ t: 'bool' }, topLeft, 'diagonal.topLeft')};`);
        if (has(topRight)) out.push(`s.topRightDiagonalLine = ${valueExpr({ t: 'bool' }, topRight, 'diagonal.topRight')};`);
        if (has(inFront)) out.push(`s.diagonalLineInFront = ${valueExpr({ t: 'bool' }, inFront, 'diagonal.inFront')};`);
        out.push(...lineAssign('s.diagonalLineStroke', line, 'diagonal'));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Applying and clearing.

const CLEARS = {
    paragraph: ['none', 'overrides', 'character_styles', 'all'],
    character: ['none'],
    object: ['none', 'overrides', 'not_defined', 'all'],
    table: ['none', 'overrides', 'cell_styles', 'all'],
    cell: ['none', 'overrides', 'not_defined'],
};

/** Statements applying style `s` of `kind` to the resolved target (t, items, tb or cells). */
function applyStatements(kind, clear, thenNextStyle) {
    switch (kind) {
        case 'paragraph':
            return [
                thenNextStyle
                    ? `var count = __applyParaNext(doc, t, s, ${str(clear)});`
                    : `__applyPara(doc, t, s, ${str(clear)}); var count = t.paragraphs.length;`,
            ];
        case 'character':
            return ['t.applyCharacterStyle(s);', 'var count = t.characters.length;'];
        case 'object':
            return [
                `for (var i = 0; i < items.length; i++) items[i].applyObjectStyle(s, ${bool(clear === 'overrides' || clear === 'all')}, ${bool(clear === 'not_defined' || clear === 'all')});`,
                'var count = items.length;',
            ];
        case 'table':
            return [
                'tb.appliedTableStyle = s;',
                ...(clear === 'overrides' || clear === 'all' ? ['tb.clearTableStyleOverrides();'] : []),
                ...(clear === 'cell_styles' || clear === 'all' ? ['tb.cells.everyItem().appliedCellStyle = doc.cellStyles[0];'] : []),
                'var count = 1;',
            ];
        case 'cell':
            return [
                'for (var i = 0; i < cells.length; i++) {',
                '  cells[i].appliedCellStyle = s;',
                ...(clear === 'overrides' ? ['  cells[i].clearCellStyleOverrides(false);'] : []),
                ...(clear === 'not_defined' ? ['  cells[i].clearCellStyleOverrides(true);'] : []),
                '}',
                'var count = cells.length;',
            ];
        default:
            throw new Error(`internal: kind ${kind}`);
    }
}

/** Table and cell literals for the tables module's helpers; selected cells imply the selection's table. */
function tableAndCells(a, needCells) {
    const cellSel = a.cells?.selection === true;
    const table = has(a.table) ? a.table : (cellSel ? { selection: true } : a.table);
    if (cellSel && table?.selection !== true) throw new Error("cells.selection uses the selection's table: drop table or set table.selection: true");
    return needCells ? [tableSpec(table), cellsSpec(a.cells)] : [tableSpec(table)];
}

/**
 * The helpers and statements that resolve a kind's target from the call's
 * arguments into t (text), items (page items), tb (a table) or tb and cells.
 */
function targetFor(kind, a) {
    switch (kind) {
        case 'paragraph':
        case 'character':
            return { helpers: TEXT_JSX, lines: [`var t = __text(doc, ${textSpec(a.text, 'text')});`] };
        case 'object':
            return { helpers: '', lines: [`var items = __targets(doc, ${targetSpec(a.target)});`] };
        case 'table': {
            const [tl] = tableAndCells(a, false);
            return { helpers: TABLE_JSX, lines: [`var tb = __table(doc, ${tl});`] };
        }
        case 'cell': {
            const [tl, cl] = tableAndCells(a, true);
            return { helpers: TABLE_JSX + CELLS_JSX, lines: [`var tb = __table(doc, ${tl}), cr = __cells(tb, ${cl}), cells = cr.range.getElements();`] };
        }
        default:
            throw new Error(`internal: kind ${kind}`);
    }
}

/** Arguments meaning "the selection", for each kind (Quick Apply). */
const SELECTION_ARGS = {
    paragraph: { text: { selection: true } },
    character: { text: { selection: true } },
    object: { target: { selection: true } },
    table: { table: { selection: true } },
    cell: { cells: { selection: true } },
};

/** Statements that select the target (for a style panel's menu command). */
function selectStatements(kind) {
    switch (kind) {
        case 'paragraph':
            return ['t.select();', 'var applied = __styleName(t.paragraphs[0].appliedParagraphStyle);'];
        case 'character':
            return ['t.select();', 'var applied = __styleName(t.appliedCharacterStyle);'];
        case 'object':
            return ['app.select(items);', 'var applied = __styleName(items[0].appliedObjectStyle);'];
        case 'table':
            return ['tb.select();', 'var applied = __styleName(tb.appliedTableStyle);'];
        case 'cell':
            return ['cr.range.select();', 'var applied = __styleName(cells[0].appliedCellStyle);'];
        default:
            throw new Error(`internal: kind ${kind}`);
    }
}

const REDEFINE_IDS = { paragraph: [8486, 8458], character: [8459], object: [113176, 113158], table: [132151, 132102], cell: [132152, 132126] };
const BREAK_LINK_IDS = { paragraph: [8500], character: [8501], object: [113166], table: [132107], cell: [132129] };

const PANEL_COMMANDS = {
    open_all_groups: { paragraph: 8503, character: 8509, object: 113197, table: 132144, cell: 132143 },
    close_all_groups: { paragraph: 8504, character: 8510, object: 113198, table: 132145, cell: 132146 },
    sort_by_name: { paragraph: 8505, character: 8511, object: 113168, table: 132113, cell: 132133 },
    small_panel_rows: { paragraph: 8461, character: 8460, object: 113163, table: 132115, cell: 132134 },
    select_all_unused: { paragraph: 8474, character: 8454, object: 113167, cell: 132131 },
};

const QUICK_APPLY_FILTERS = {
    paragraphStyles: 127949,
    characterStyles: 127948,
    objectStyles: 127950,
    tableStyles: 132153,
    cellStyles: 132154,
    menuCommands: 127951,
    hiddenMenuCommands: 127953,
    scripts: 127954,
    textVariables: 47276,
    conditions: 133129,
};

const IMPORT_FORMATS = {
    paragraph: 'PARAGRAPH_STYLES_FORMAT',
    character: 'CHARACTER_STYLES_FORMAT',
    text: 'TEXT_STYLES_FORMAT',
    object: 'OBJECT_STYLES_FORMAT',
    table: 'TABLE_STYLES_FORMAT',
    cell: 'CELL_STYLES_FORMAT',
    table_and_cell: 'TABLE_AND_CELL_STYLES_FORMAT',
    toc: 'TOC_STYLES_FORMAT',
    stroke: 'STROKE_STYLES_FORMAT',
};
const CLASH = { rename: 'LOAD_ALL_WITH_RENAME', overwrite: 'LOAD_ALL_WITH_OVERWRITE', skip: 'DO_NOT_LOAD_THE_STYLE' };

const NESTED_DELIMITERS = ['ANY_CHARACTER', 'ANY_WORD', 'AUTO_PAGE_NUMBER', 'DIGITS', 'DROPCAP', 'EM_SPACE', 'END_NESTED_STYLE', 'EN_SPACE', 'FORCED_LINE_BREAK', 'INDENT_HERE_TAB', 'INLINE_GRAPHIC', 'LETTERS', 'NONBREAKING_SPACE', 'REPEAT', 'SECTION_MARKER', 'SENTENCE', 'TABS'];
const NESTED = {
    nested: { coll: 'nestedStyles', fields: ['characterStyle', 'delimiter', 'repetition', 'inclusive'] },
    line: { coll: 'nestedLineStyles', fields: ['characterStyle', 'lineCount', 'repeatLast'] },
    grep: { coll: 'nestedGrepStyles', fields: ['characterStyle', 'grepExpression'] },
};

/** The properties object for one nested, line or GREP style entry. */
function nestedEntry(type, e, i) {
    const where = `entries[${i}]`;
    const v = obj(e, where);
    if (!v) throw new Error(`'${where}' must be an object`);
    for (const k of Object.keys(v)) if (!NESTED[type].fields.includes(k)) throw new Error(`Unknown ${where} field '${k}' for ${type} styles. Known: ${NESTED[type].fields.join(', ')}`);
    const props = [`appliedCharacterStyle: __style(doc, "character", ${str(styleRef(v.characterStyle, `${where}.characterStyle`))})`];
    if (type === 'nested') {
        const d = String(v.delimiter ?? 'ANY_WORD');
        if (NESTED_DELIMITERS.includes(d)) props.push(`delimiter: NestedStyleDelimiters.${d}`);
        else {
            if (!d.length || d.length > 20) throw new Error(`'${where}.delimiter' must be a NestedStyleDelimiters name or 1 to 20 characters`);
            props.push(`delimiter: ${str(d)}`);
        }
        if (has(v.repetition)) props.push(`repetition: ${int(v.repetition, { min: 1, max: 999, name: `${where}.repetition` })}`);
        if (has(v.inclusive)) props.push(`inclusive: ${valueExpr({ t: 'bool' }, v.inclusive, `${where}.inclusive`)}`);
    } else if (type === 'line') {
        props.push(`lineCount: ${int(v.lineCount ?? 1, { min: 1, max: 999, name: `${where}.lineCount` })}`);
        if (has(v.repeatLast)) props.push(`repeatLast: ${int(v.repeatLast, { min: 0, max: 999, name: `${where}.repeatLast` })}`);
    } else {
        const g = String(v.grepExpression ?? '');
        if (!g || g.length > 2000) throw new Error(`'${where}.grepExpression' is required (up to 2000 characters)`);
        props.push(`grepExpression: ${str(g)}`);
    }
    return `{ ${props.join(', ')} }`;
}

// ---------------------------------------------------------------------------

const EDIT_HINTS = { readOnly: false, destructive: false, idempotent: true };

export const tools = [
    {
        name: 'set_paragraph_style',
        description: 'Create or edit a paragraph style without applying it (Paragraph Style Options): name, Based On, Next Style, Reset To Base, and its character, indents and spacing, keep, hyphenation, justification, drop cap, rule, span column, shading, border and bullets and numbering attributes',
        inputSchema: {
            type: 'object',
            properties: {
                ...COMMON_STYLE_PROPS('paragraph'),
                nextStyle: STYLE('Next Style: the paragraph style for the paragraph that follows'),
                resetToBase: { type: 'boolean', description: 'Reset To Base: make the style match its Based On style before applying attributes' },
                attributes: schemaOf(PARA_ATTRS, 'Paragraph attributes to set, by InDesign property name'),
                applyToSelection: { type: 'boolean', description: 'Apply Style to Selection: also apply the style to the selected text' },
            },
            required: ['style'],
        },
        features: [
            'indesign.styles.ps_general_based_on',
            'indesign.styles.ps_general_next_style',
            'indesign.styles.ps_general_reset_to_base',
            'indesign.styles.ps_general_apply_style_to_selection',
            'indesign.styles.paragraph_styles_menu_style_options',
            'indesign.styles.context_edit_style_without_applying',
        ],
        hints: EDIT_HINTS,
        auditArgs: { style: 'Body', create: true, group: '', name: null, basedOn: '[Basic Paragraph]', nextStyle: 'Body', attributes: { pointSize: 10, leading: 'auto', justification: 'LEFT_ALIGN', fillColor: 'Black', spaceAfter: 2, dropCapStyle: 'Initial', spanSplitColumnCount: 'all' } },
        handler: (a) => {
            const body = [...openStyle('paragraph', a)];
            if (has(a.nextStyle)) body.push(`s.nextStyle = __style(doc, "paragraph", ${str(styleRef(a.nextStyle, 'nextStyle'))});`);
            if (a.resetToBase) body.push(RESET_TO_BASE);
            body.push(...assign('s', a.attributes, PARA_ATTRS, 'attributes'));
            if (a.applyToSelection) body.push(`var sel = __text(doc, ${textSpec({ selection: true })});`, 'sel.applyParagraphStyle(s, false);');
            body.push('__result__ = { style: __styleInfo(s, "paragraph"), created: created };');
            return run('Set paragraph style', script(STYLE_JSX + (a.applyToSelection ? TEXT_JSX : '') + body.join('\n')));
        },
    },
    {
        name: 'set_character_style',
        description: 'Create or edit a character style without applying it (Character Style Options): name, Based On, Reset To Base, and its font, size, leading, tracking, case, position, scale, colour and stroke attributes',
        inputSchema: {
            type: 'object',
            properties: {
                ...COMMON_STYLE_PROPS('character'),
                resetToBase: { type: 'boolean', description: 'Reset To Base: make the style match its Based On style before applying attributes' },
                attributes: schemaOf(CHAR_ATTRS, 'Character attributes to set, by InDesign property name'),
                applyToSelection: { type: 'boolean', description: 'Apply Style to Selection: also apply the style to the selected text' },
            },
            required: ['style'],
        },
        features: [
            'indesign.styles.cs_general_based_on',
            'indesign.styles.character_styles_menu_style_options',
        ],
        hints: EDIT_HINTS,
        auditArgs: { style: 'Emphasis', create: true, group: 'Inline', name: null, basedOn: null, attributes: { fontStyle: 'Italic', pointSize: 9, fillColor: '#cc0000', capitalization: 'SMALL_CAPS' } },
        handler: (a) => {
            const body = [...openStyle('character', a)];
            if (a.resetToBase) body.push(RESET_TO_BASE);
            body.push(...assign('s', a.attributes, CHAR_ATTRS, 'attributes'));
            if (a.applyToSelection) body.push(`var sel = __text(doc, ${textSpec({ selection: true })});`, 'sel.applyCharacterStyle(s);');
            body.push('__result__ = { style: __styleInfo(s, "character"), created: created };');
            return run('Set character style', script(STYLE_JSX + (a.applyToSelection ? TEXT_JSX : '') + body.join('\n')));
        },
    },
    {
        name: 'set_object_style',
        description: 'Create or edit an object style without applying it (Object Style Options): name, Based On, which categories it includes, and its fill, stroke, corner, paragraph style, text frame general, baseline, auto-size and column rule, story, text wrap and other, anchored object, frame fitting and export options',
        inputSchema: {
            type: 'object',
            properties: {
                ...COMMON_STYLE_PROPS('object'),
                categories: {
                    type: 'object',
                    description: 'Turn categories on or off (the check boxes in Object Style Options). Setting a section below turns its category on unless it is set here',
                    properties: Object.fromEntries(Object.keys(OS_CATEGORIES).map((k) => [k, { type: 'boolean', description: `Include ${k}` }])),
                },
                ...Object.fromEntries(Object.entries(OS_SECTIONS).map(([k, sec]) => [k, schemaOf(sec.attrs, sec.d)])),
            },
            required: ['style'],
        },
        features: [
            'indesign.styles.os_general_based_on',
            'indesign.styles.os_basic_paragraph_styles_object_style',
            'indesign.styles.os_basic_text_frame_general_options_object_style',
            'indesign.styles.os_basic_text_frame_baseline_options_object_style',
            'indesign.styles.os_basic_text_frame_auto_size_options_object_style',
            'indesign.styles.os_basic_text_frame_column_rules_object_style',
            'indesign.styles.os_basic_story_options_object_style',
            'indesign.styles.os_basic_text_wrap_and_other_object_style',
            'indesign.styles.os_basic_anchored_object_options_object_style',
            'indesign.styles.os_basic_frame_fitting_options_object_style',
            'indesign.styles.os_basic_export_options_object_style',
            'indesign.styles.object_styles_menu_style_options',
        ],
        hints: EDIT_HINTS,
        auditArgs: {
            style: 'Sidebar', create: true, group: null, name: null, basedOn: '[Basic Text Frame]',
            categories: { fill: true, stroke: false },
            fill: { fillColor: 'Paper', fillTint: 20 },
            stroke: { strokeColor: 'Black', strokeWeight: 0.5, strokeType: 'Solid' },
            corners: { cornerOption: 'ROUNDED_CORNER', cornerRadius: 2 },
            paragraphStyle: { style: 'Body', applyNextStyle: true },
            textFrame: { textColumnCount: 2, textColumnGutter: 4, insetSpacing: [2, 2, 2, 2], verticalJustification: 'TOP_ALIGN' },
            baseline: { firstBaselineOffset: 'LEADING_OFFSET', useCustomBaselineFrameGrid: true, baselineFrameGridIncrement: 12, baselineFrameGridRelativeOption: 'TOP_OF_INSET' },
            autoSize: { autoSizingType: 'HEIGHT_ONLY', autoSizingReferencePoint: 'TOP_CENTER_POINT' },
            columnRules: { columnRuleOverride: true, columnRuleStrokeWidth: 0.5, columnRuleStrokeColor: 'Black', columnRuleStrokeType: 'Solid' },
            story: { opticalMarginAlignment: true, opticalMarginSize: 12 },
            textWrap: { textWrapMode: 'BOUNDING_BOX_TEXT_WRAP', textWrapOffset: 3, textWrapSide: 'BOTH_SIDES', nonprinting: false },
            anchored: { anchoredPosition: 'ANCHORED', anchorPoint: 'TOP_LEFT_ANCHOR', horizontalReferencePoint: 'TEXT_FRAME', verticalReferencePoint: 'LINE_BASELINE', anchorXoffset: 0 },
            frameFitting: { fittingOnEmptyFrame: 'FILL_PROPORTIONALLY', fittingAlignment: 'CENTER_ANCHOR', autoFit: true },
            export: { altTextSourceType: 'SOURCE_CUSTOM', customAltText: 'Sidebar', applyTagType: 'TAG_ARTIFACT', preserveAppearanceFromLayout: 'PRESERVE_APPEARANCE_DEFAULT' },
        },
        handler: (a) => {
            const body = [...openStyle('object', a)];
            const enables = new Set();
            for (const [k, sec] of Object.entries(OS_SECTIONS)) {
                const lines = assign(sec.on, a[k], sec.attrs, k, enables);
                if (lines.length && sec.en) enables.add(sec.en);
                body.push(...lines);
            }
            const cats = obj(a.categories, 'categories') ?? {};
            for (const k of Object.keys(cats)) if (!OS_CATEGORIES[k]) throw new Error(`Unknown category '${k}'. Known: ${Object.keys(OS_CATEGORIES).join(', ')}`);
            const explicit = new Set(Object.keys(cats).filter((k) => has(cats[k])).map((k) => OS_CATEGORIES[k]));
            for (const p of enables) if (!explicit.has(p)) body.push(`s.${p} = true;`);
            for (const [k, v] of Object.entries(cats)) if (has(v)) body.push(`s.${OS_CATEGORIES[k]} = ${valueExpr({ t: 'bool' }, v, `categories.${k}`)};`);
            body.push('__result__ = { style: __styleInfo(s, "object"), created: created };');
            return run('Set object style', script(STYLE_JSX + body.join('\n')));
        },
    },
    {
        name: 'set_table_style',
        description: 'Create or edit a table style without applying it (New Table Style, Table Style Options): name, Based On, the cell styles for header, footer, body, left and right column regions, table setup (border, space before and after, stroke drawing order), alternating row and column strokes, and alternating fills',
        inputSchema: {
            type: 'object',
            properties: {
                ...COMMON_STYLE_PROPS('table'),
                cellStyles: {
                    type: 'object',
                    description: 'Cell styles by region; each is a cell style name, or "same_as_body" (not for body)',
                    properties: Object.fromEntries(Object.keys(REGIONS).map((k) => [k, { type: 'string', description: `Cell style for ${k} cells` }])),
                },
                tableSetup: {
                    type: 'object',
                    description: 'Table Setup: border, spacing and stroke drawing order',
                    properties: {
                        border: LINE_SCHEMA('Table border on all four sides'),
                        topBorder: LINE_SCHEMA('Top border'),
                        leftBorder: LINE_SCHEMA('Left border'),
                        bottomBorder: LINE_SCHEMA('Bottom border'),
                        rightBorder: LINE_SCHEMA('Right border'),
                        spaceBefore: { type: 'number', description: 'Space before the table in mm' },
                        spaceAfter: { type: 'number', description: 'Space after the table in mm' },
                        strokeOrder: { type: 'string', enum: E.StrokeOrderTypes, description: 'Stroke drawing order' },
                    },
                },
                rowStrokes: {
                    type: 'object',
                    description: 'Row Strokes: an alternating pattern of two row strokes',
                    properties: {
                        first: LINE_SCHEMA('First rows: count and stroke', { count: true }),
                        next: LINE_SCHEMA('Next rows: count and stroke', { count: true }),
                        skipFirst: { type: 'integer', minimum: 0, description: 'Skip first N rows' },
                        skipLast: { type: 'integer', minimum: 0, description: 'Skip last N rows' },
                    },
                },
                columnStrokes: {
                    type: 'object',
                    description: 'Column Strokes: an alternating pattern of two column strokes',
                    properties: {
                        first: LINE_SCHEMA('First columns: count and stroke', { count: true }),
                        next: LINE_SCHEMA('Next columns: count and stroke', { count: true }),
                        skipFirst: { type: 'integer', minimum: 0, description: 'Skip first N columns' },
                        skipLast: { type: 'integer', minimum: 0, description: 'Skip last N columns' },
                    },
                },
                fills: {
                    type: 'object',
                    description: 'Fills: an alternating pattern of two fills, by rows or by columns',
                    properties: {
                        direction: { type: 'string', enum: ['rows', 'columns'], description: 'Alternate by rows or by columns', default: 'rows' },
                        first: LINE_SCHEMA('First rows or columns: count and fill', { count: true, fill: true }),
                        next: LINE_SCHEMA('Next rows or columns: count and fill', { count: true, fill: true }),
                        skipFirst: { type: 'integer', minimum: 0, description: 'Skip first N rows or columns' },
                        skipLast: { type: 'integer', minimum: 0, description: 'Skip last N rows or columns' },
                    },
                },
            },
            required: ['style'],
        },
        features: [
            'indesign.styles.tbs_style_name_table_style',
            'indesign.styles.tbs_based_on_table_style',
            'indesign.styles.tbs_cell_styles_header_rows_footer_rows_body_rows_left_column_right_column',
            'indesign.styles.tbs_table_setup_table_style',
            'indesign.styles.tbs_row_strokes_table_style',
            'indesign.styles.tbs_column_strokes_table_style',
            'indesign.styles.tbs_fills_table_style',
            'indesign.styles.table_styles_menu_new_table_style',
            'indesign.styles.table_styles_menu_style_options',
        ],
        hints: EDIT_HINTS,
        auditArgs: {
            style: 'Data', create: true, group: null, name: 'Data table', basedOn: '[Basic Table]',
            cellStyles: { header: 'Head', body: 'Body cell', footer: 'same_as_body' },
            tableSetup: { border: { weight: 1, color: 'Black', type: 'Solid', tint: 100 }, spaceBefore: 2, strokeOrder: 'BEST_JOINS' },
            rowStrokes: { first: { count: 1, weight: 0.5, color: 'Black', type: 'Solid' }, next: { count: 1, weight: 0.25, type: 'Dashed' }, skipFirst: 1 },
            columnStrokes: { first: { count: 1, weight: 0.5 }, next: { count: 1, type: 'Solid' } },
            fills: { direction: 'rows', first: { count: 1, color: 'Paper' }, next: { count: 1, color: '#eeeeee', tint: 50 }, skipFirst: 1 },
        },
        handler: (a) => {
            const body = [...openStyle('table', a), ...tableStyleStatements(a), '__result__ = { style: __styleInfo(s, "table"), created: created };'];
            return run('Set table style', script(STYLE_JSX + body.join('\n')));
        },
    },
    {
        name: 'set_cell_style',
        description: 'Create or edit a cell style without applying it (New Cell Style, Cell Style Options): name, Based On, paragraph style, text (insets, vertical justification, first baseline, clipping, rotation), graphic insets and clipping, edge strokes and fill, and diagonal lines',
        inputSchema: {
            type: 'object',
            properties: {
                ...COMMON_STYLE_PROPS('cell'),
                paragraphStyle: STYLE('Paragraph style for text in cells with this style'),
                text: (() => {
                    const t = schemaOf(CELL_TEXT, 'Text options: insets, vertical justification, first baseline, clipping and rotation');
                    t.properties.rotation = { type: 'integer', enum: [0, 90, 180, 270], description: 'Text rotation in degrees' };
                    return t;
                })(),
                graphic: schemaOf(CELL_GRAPHIC, 'Graphic cell options'),
                strokes: {
                    type: 'object',
                    description: 'Cell edge strokes',
                    properties: {
                        all: LINE_SCHEMA('All four edges'),
                        top: LINE_SCHEMA('Top edge'),
                        left: LINE_SCHEMA('Left edge'),
                        bottom: LINE_SCHEMA('Bottom edge'),
                        right: LINE_SCHEMA('Right edge'),
                    },
                },
                fill: {
                    type: 'object',
                    description: 'Cell fill',
                    properties: {
                        color: { type: 'string', description: `Fill colour: ${COLOR_SCHEMA.description}` },
                        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Fill tint in percent' },
                        overprint: { type: 'boolean', description: 'Overprint the fill' },
                    },
                },
                diagonal: {
                    type: 'object',
                    description: 'Diagonal lines',
                    properties: {
                        topLeft: { type: 'boolean', description: 'Line from top left to bottom right' },
                        topRight: { type: 'boolean', description: 'Line from top right to bottom left' },
                        inFront: { type: 'boolean', description: 'Draw the lines in front of the cell contents' },
                        weight: { type: 'number', minimum: 0, description: 'Line weight in points' },
                        color: { type: 'string', description: `Line colour: ${COLOR_SCHEMA.description}` },
                        type: { type: 'string', description: 'Line type: a stroke style name' },
                        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Line tint in percent' },
                    },
                },
            },
            required: ['style'],
        },
        features: [
            'indesign.styles.cls_style_name_cell_style',
            'indesign.styles.cls_based_on_cell_style',
            'indesign.styles.cls_paragraph_style_cell_style',
            'indesign.styles.cls_text_cell_style',
            'indesign.styles.cls_graphic_cell_style',
            'indesign.styles.cls_strokes_and_fills_cell_style',
            'indesign.styles.cls_diagonal_lines_cell_style',
            'indesign.styles.cell_styles_menu_new_cell_style',
            'indesign.styles.cell_styles_menu_style_options',
        ],
        hints: EDIT_HINTS,
        auditArgs: {
            style: 'Head', create: true, group: 'Tables', name: null, basedOn: '[None]', paragraphStyle: 'Table head',
            text: { topInset: 1, leftInset: 1, bottomInset: 1, rightInset: 1, verticalJustification: 'CENTER_ALIGN', firstBaselineOffset: 'CAP_HEIGHT', clipContentToTextCell: true, rotation: 90 },
            graphic: { graphicTopInset: 0.5, clipContentToGraphicCell: true },
            strokes: { all: { weight: 0.5, color: 'Black', type: 'Solid' }, bottom: { weight: 1 } },
            fill: { color: '#ddeeff', tint: 100, overprint: false },
            diagonal: { topLeft: true, topRight: false, inFront: true, weight: 0.25, color: 'Black', type: 'Solid', tint: 50 },
        },
        handler: (a) => {
            const body = [...openStyle('cell', a), ...cellStyleStatements(a), '__result__ = { style: __styleInfo(s, "cell"), created: created };'];
            return run('Set cell style', script(STYLE_JSX + body.join('\n')));
        },
    },
    {
        name: 'manage_styles',
        description: 'Duplicate, delete (with a replacement style), move or copy styles into a style group, for any kind of style (Duplicate Style, Delete Style, Copy to Group in the Paragraph, Character, Object, Table and Cell Styles panels); and turn a paragraph style\'s bullets and numbering into text',
        inputSchema: {
            type: 'object',
            properties: {
                kind: KIND,
                action: { type: 'string', enum: ['duplicate', 'delete', 'move_to_group', 'copy_to_group', 'convert_bullets_to_text'], description: 'What to do with each style' },
                styles: { type: 'array', items: { type: 'string' }, description: 'Style names (or "Group/Style" paths)' },
                newName: { type: 'string', description: 'duplicate: name for the copy (one style only); without it InDesign names the copy' },
                group: { type: 'string', description: 'move_to_group / copy_to_group: style group path, created when missing; "" for the top level' },
                replaceWith: STYLE('delete: the style that replaces the deleted one where it is used'),
            },
            required: ['kind', 'action', 'styles'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_duplicate_style',
            'indesign.styles.paragraph_styles_menu_delete_style',
            'indesign.styles.paragraph_styles_menu_copy_to_group',
            'indesign.styles.paragraph_styles_menu_convert_bullets_and_numbering_to_text',
            'indesign.styles.character_styles_menu_duplicate_style',
            'indesign.styles.character_styles_menu_delete_style',
            'indesign.styles.character_styles_menu_copy_to_group',
            'indesign.styles.object_styles_menu_duplicate_style',
            'indesign.styles.object_styles_menu_delete_style',
            'indesign.styles.object_styles_menu_copy_to_group',
            'indesign.styles.table_styles_menu_duplicate_style',
            'indesign.styles.table_styles_menu_delete_style',
            'indesign.styles.table_styles_menu_copy_to_group',
            'indesign.styles.cell_styles_menu_duplicate_style',
            'indesign.styles.cell_styles_menu_delete_style',
            'indesign.styles.cell_styles_menu_copy_to_group',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { kind: 'paragraph', action: 'copy_to_group', styles: ['Body', 'Caption'], group: 'Archive', newName: null, replaceWith: null },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const action = enumOf(a.action, ['duplicate', 'delete', 'move_to_group', 'copy_to_group', 'convert_bullets_to_text'], { name: 'action' });
            if (!Array.isArray(a.styles) || !a.styles.length) throw new Error("'styles' must list at least one style");
            const refs = a.styles.map((s, i) => styleRef(s, `styles[${i}]`));
            if (action === 'convert_bullets_to_text' && kind !== 'paragraph') throw new Error('convert_bullets_to_text is for paragraph styles');
            if (has(a.newName) && (action !== 'duplicate' || refs.length !== 1)) throw new Error('newName is for duplicating one style');
            const lines = [`var refs = ${json(refs)}, out = [];`];
            if (action === 'move_to_group' || action === 'copy_to_group') lines.push(`var g = __group(doc, "${kind}", ${str(String(a.group ?? ''))}, true);`);
            if (action === 'delete' && has(a.replaceWith)) lines.push(`var rep = __style(doc, "${kind}", ${str(styleRef(a.replaceWith, 'replaceWith'))});`);
            lines.push('for (var i = 0; i < refs.length; i++) {', `  var s = __style(doc, "${kind}", refs[i]);`);
            switch (action) {
                case 'duplicate':
                    lines.push('  var d = s.duplicate();', ...(has(a.newName) ? [`  d.name = ${str(styleRef(a.newName, 'newName'))};`] : []), `  out.push(__styleInfo(d, "${kind}"));`);
                    break;
                case 'delete':
                    lines.push('  __builtIn(s);', '  var nm = __stylePath(s);', has(a.replaceWith) ? '  s.remove(rep);' : '  s.remove();', '  out.push({ deleted: nm });');
                    break;
                case 'move_to_group':
                    lines.push('  __builtIn(s);', '  var m = s.move(LocationOptions.AT_END, g);', '  if (m && m.isValid) s = m;', `  out.push(__styleInfo(s, "${kind}"));`);
                    break;
                case 'copy_to_group':
                    lines.push(
                        `  if (g[__SK["${kind}"].own].itemByName(s.name).isValid) throw new Error("The group already has a style named " + s.name);`,
                        '  var c = s.duplicate(), nm2 = s.name;',
                        '  var m2 = c.move(LocationOptions.AT_END, g);',
                        '  if (m2 && m2.isValid) c = m2;',
                        '  c.name = nm2;',
                        `  out.push(__styleInfo(c, "${kind}"));`,
                    );
                    break;
                case 'convert_bullets_to_text':
                    lines.push('  s.convertBulletsAndNumberingToText();', `  out.push(__styleInfo(s, "${kind}"));`);
                    break;
                default:
                    break;
            }
            lines.push('}', `__result__ = { kind: "${kind}", action: "${action}", styles: out };`);
            return run('Manage styles', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'manage_style_groups',
        description: 'Create, rename, duplicate or delete style groups, or make a group from styles, for any kind of style (New Style Group, New Group from Styles, Style Group Options, Duplicate Group, Delete Group in the style panels)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: KIND,
                action: { type: 'string', enum: ['create', 'create_from_styles', 'rename', 'duplicate', 'delete'], description: 'What to do' },
                group: { type: 'string', description: 'The group path, such as "Headings" or "Body/Lists". For create and create_from_styles, the new group (parents are created as needed)' },
                name: { type: 'string', description: 'rename: the new name; duplicate: a name for the copy' },
                styles: { type: 'array', items: { type: 'string' }, description: 'create_from_styles: the styles to move into the new group' },
                replaceWith: STYLE('delete: the style that replaces the group\'s styles where they are used'),
            },
            required: ['kind', 'action', 'group'],
        },
        features: [
            'indesign.styles.style_groups',
            'indesign.styles.paragraph_styles_menu_new_style_group',
            'indesign.styles.paragraph_styles_menu_new_group_from_styles',
            'indesign.styles.paragraph_styles_menu_style_group_options',
            'indesign.styles.paragraph_styles_menu_duplicate_group',
            'indesign.styles.paragraph_styles_menu_delete_group',
            'indesign.styles.character_styles_menu_new_style_group',
            'indesign.styles.character_styles_menu_new_group_from_styles',
            'indesign.styles.object_styles_menu_new_style_group',
            'indesign.styles.object_styles_menu_new_group_from_styles',
            'indesign.styles.object_styles_menu_style_group_options',
            'indesign.styles.object_styles_menu_duplicate_group',
            'indesign.styles.object_styles_menu_delete_group',
            'indesign.styles.table_styles_menu_new_style_group',
            'indesign.styles.table_styles_menu_new_group_from_styles',
            'indesign.styles.table_styles_menu_style_group_options',
            'indesign.styles.table_styles_menu_duplicate_style_group',
            'indesign.styles.table_styles_menu_delete_style_group',
            'indesign.styles.cell_styles_menu_new_style_group',
            'indesign.styles.cell_styles_menu_new_group_from_styles',
            'indesign.styles.cell_styles_menu_style_group_options',
            'indesign.styles.cell_styles_menu_duplicate_style_group',
            'indesign.styles.cell_styles_menu_delete_style_group',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { kind: 'object', action: 'create_from_styles', group: 'Frames/Sidebars', styles: ['Sidebar', 'Callout'], name: null, replaceWith: null },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const action = enumOf(a.action, ['create', 'create_from_styles', 'rename', 'duplicate', 'delete'], { name: 'action' });
            const path = String(a.group ?? '').trim();
            if (!path) throw new Error("'group' is required: a style group path");
            if (path.length > 500) throw new Error("'group' is too long");
            const lines = [];
            switch (action) {
                case 'create':
                    lines.push(`var g = __group(doc, "${kind}", ${str(path)}, true);`);
                    break;
                case 'create_from_styles': {
                    if (!Array.isArray(a.styles) || !a.styles.length) throw new Error("create_from_styles needs 'styles'");
                    const refs = a.styles.map((s, i) => styleRef(s, `styles[${i}]`));
                    lines.push(
                        `var refs = ${json(refs)}, list = [];`,
                        `for (var i = 0; i < refs.length; i++) { var st = __style(doc, "${kind}", refs[i]); __builtIn(st); list.push(st); }`,
                        `var g = __group(doc, "${kind}", ${str(path)}, true);`,
                        'for (var j = 0; j < list.length; j++) list[j].move(LocationOptions.AT_END, g);',
                    );
                    break;
                }
                case 'rename':
                    lines.push(`var g = __group(doc, "${kind}", ${str(path)}, false);`, `g.name = ${str(styleRef(a.name, 'name'))};`);
                    break;
                case 'duplicate':
                    lines.push(`var g = __group(doc, "${kind}", ${str(path)}, false).duplicate();`, ...(has(a.name) ? [`g.name = ${str(styleRef(a.name, 'name'))};`] : []));
                    break;
                case 'delete':
                    lines.push(
                        `var g = __group(doc, "${kind}", ${str(path)}, false), gone = g.name;`,
                        has(a.replaceWith) ? `g.remove(__style(doc, "${kind}", ${str(styleRef(a.replaceWith, 'replaceWith'))}));` : 'g.remove();',
                        `__result__ = { kind: "${kind}", action: "delete", deleted: gone };`,
                    );
                    return run('Manage style groups', script(STYLE_JSX + lines.join('\n')));
                default:
                    break;
            }
            lines.push(
                `var names = [], own = g[__SK["${kind}"].all];`,
                'for (var k = 0; k < own.length; k++) names.push(own[k].name);',
                `__result__ = { kind: "${kind}", action: "${action}", group: g.name, styles: names };`,
            );
            return run('Manage style groups', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'apply_style',
        description: 'Apply a paragraph, character, object, table or cell style, optionally clearing overrides, character styles, cell styles or attributes the style does not define, and for paragraph styles Apply Style then Next Style (the style panels\' Apply commands)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: TARGET_KIND,
                style: STYLE('The style to apply'),
                text: TEXT_SCHEMA,
                target: TARGET_SCHEMA,
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
                clear: {
                    type: 'string',
                    enum: ['none', 'overrides', 'character_styles', 'cell_styles', 'not_defined', 'all'],
                    description: 'What to clear while applying. Paragraph: overrides, character_styles or all. Object: overrides (Clear All), not_defined (Clear Attributes Not Defined by Style) or all. Table: overrides, cell_styles or all. Cell: overrides (Clear All) or not_defined',
                    default: 'none',
                },
                thenNextStyle: { type: 'boolean', description: 'Paragraph styles: Apply Style then Next Style across the chosen paragraphs' },
            },
            required: ['kind', 'style'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_apply_style_clear_overrides',
            'indesign.styles.paragraph_styles_menu_apply_style_clear_character_styles',
            'indesign.styles.paragraph_styles_menu_apply_style_clear_all',
            'indesign.styles.paragraph_styles_menu_apply_style_then_next_style',
            'indesign.styles.sequential_styles',
            'indesign.styles.context_apply_clear_overrides',
            'indesign.styles.object_styles_menu_apply_style_clear_attributes_not_defined_by_style',
            'indesign.styles.object_styles_menu_apply_style_clear_all',
            'indesign.styles.table_styles_menu_apply_style',
            'indesign.styles.table_styles_menu_apply_style_clear_overrides',
            'indesign.styles.table_styles_menu_apply_style_clear_cell_styles',
            'indesign.styles.table_styles_menu_apply_style_clear_all',
            'indesign.styles.cell_styles_menu_apply_style',
            'indesign.styles.cell_styles_menu_apply_style_clear_all',
            'indesign.styles.cell_styles_menu_apply_style_clear_attributes_not_defined_by_style',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { kind: 'paragraph', style: 'Body', text: { frameId: 12, story: true, paragraphs: [0, 3] }, target: null, table: null, cells: null, clear: 'all', thenNextStyle: true },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const clear = enumOf(a.clear ?? 'none', CLEARS[kind], { name: `clear (for ${kind} styles)` });
            if (a.thenNextStyle && kind !== 'paragraph') throw new Error('thenNextStyle is for paragraph styles');
            const { helpers, lines } = targetFor(kind, a);
            const body = [
                `var s = __style(doc, "${kind}", ${str(styleRef(a.style, 'style'))});`,
                ...lines,
                ...applyStatements(kind, clear, !!a.thenNextStyle),
                `__result__ = { style: __styleInfo(s, "${kind}"), clear: "${clear}", count: count };`,
            ];
            return run('Apply style', script(STYLE_JSX + helpers + APPLY_JSX + body.join('\n')));
        },
    },
    {
        name: 'clear_style_overrides',
        description: 'Clear local formatting that differs from the applied style: all, character-only or paragraph-only overrides on text; object style overrides or attributes not defined by the style; table style overrides; cell style overrides or attributes not defined by the style (Clear Overrides in the style panels)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['text', 'object', 'table', 'cell'], description: 'What to clear overrides on' },
                text: TEXT_SCHEMA,
                target: TARGET_SCHEMA,
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
                what: {
                    type: 'string',
                    enum: ['all', 'character', 'paragraph', 'overrides', 'not_defined'],
                    description: 'Text: all, character or paragraph overrides. Object and cell: overrides, or not_defined (Clear Attributes Not Defined by Style). Table: overrides',
                },
            },
            required: ['kind'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_clear_overrides',
            'indesign.styles.clear_overrides',
            'indesign.styles.clear_character_overrides',
            'indesign.styles.clear_paragraph_overrides',
            'indesign.styles.clear_all_overrides',
            'indesign.styles.clear_object_style_overrides',
            'indesign.styles.clear_attributes_not_defined',
            'indesign.styles.table_styles_menu_clear_overrides',
            'indesign.styles.cell_styles_menu_clear_overrides',
            'indesign.styles.cell_styles_menu_clear_attributes_not_defined_by_style',
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { kind: 'text', text: { frameId: 12 }, target: null, table: null, cells: null, what: 'character' },
        handler: (a) => {
            const kind = enumOf(a.kind, ['text', 'object', 'table', 'cell'], { name: 'kind' });
            const allowed = { text: ['all', 'character', 'paragraph'], object: ['overrides', 'not_defined'], table: ['overrides'], cell: ['overrides', 'not_defined'] }[kind];
            const what = enumOf(a.what ?? allowed[0], allowed, { name: `what (for ${kind})` });
            let helpers = '';
            let lines;
            if (kind === 'text') {
                helpers = TEXT_JSX;
                const type = { all: 'ALL', character: 'CHARACTER_ONLY', paragraph: 'PARAGRAPH_ONLY' }[what];
                lines = [`var t = __text(doc, ${textSpec(a.text)});`, `t.clearOverrides(OverrideType.${type});`, 'var count = t.paragraphs.length;'];
            } else if (kind === 'object') {
                lines = [
                    `var items = __targets(doc, ${targetSpec(a.target)});`,
                    'for (var i = 0; i < items.length; i++) {',
                    what === 'overrides' ? '  items[i].clearObjectStyleOverrides();' : '  items[i].applyObjectStyle(items[i].appliedObjectStyle, false, true);',
                    '}',
                    'var count = items.length;',
                ];
            } else if (kind === 'table') {
                const r = targetFor('table', a);
                helpers = r.helpers;
                lines = [...r.lines, 'tb.clearTableStyleOverrides();', 'var count = 1;'];
            } else {
                const r = targetFor('cell', a);
                helpers = r.helpers;
                lines = [
                    ...r.lines,
                    `for (var i = 0; i < cells.length; i++) cells[i].clearCellStyleOverrides(${bool(what === 'not_defined')});`,
                    'var count = cells.length;',
                ];
            }
            lines.push(`__result__ = { kind: "${kind}", cleared: "${what}", count: count };`);
            return run('Clear style overrides', script(helpers + lines.join('\n')));
        },
    },
    {
        name: 'redefine_style',
        description: 'Redefine a style to match the formatting of the chosen text, object, table or cell (Redefine Style in the Paragraph, Character, Object, Table and Cell Styles panel menus). The chosen target is selected first; the style redefined is the one applied to it',
        inputSchema: {
            type: 'object',
            properties: {
                kind: TARGET_KIND,
                text: TEXT_SCHEMA,
                target: TARGET_SCHEMA,
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
            },
            required: ['kind'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_redefine_style',
            'indesign.styles.character_styles_menu_redefine_style',
            'indesign.styles.object_styles_menu_redefine_style',
            'indesign.styles.table_styles_menu_redefine_style',
            'indesign.styles.cell_styles_menu_redefine_style',
            'indesign.styles.redefine_paragraph_style_shortcut',
            'indesign.styles.redefine_character_style_shortcut',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { kind: 'paragraph', text: { frameId: 12, paragraphs: [0, 0] }, target: null, table: null, cells: null },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const { helpers, lines } = targetFor(kind, a);
            const body = [
                ...lines,
                ...selectStatements(kind),
                `__showPanel(${str(PANEL[kind])});`,
                `var used = __invoke(${json(REDEFINE_IDS[kind])}, "Redefine Style");`,
                `__result__ = { kind: "${kind}", redefined: applied, menuAction: used };`,
            ];
            return run('Redefine style', script(STYLE_JSX + helpers + MENU_JSX + body.join('\n')));
        },
    },
    {
        name: 'break_link_to_style',
        description: 'Break the link between the chosen text, objects, table or cells and their style, keeping the current formatting (Break Link to Style in the Paragraph, Character, Object, Table and Cell Styles panel menus). The chosen target is selected first',
        inputSchema: {
            type: 'object',
            properties: {
                kind: TARGET_KIND,
                text: TEXT_SCHEMA,
                target: TARGET_SCHEMA,
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
            },
            required: ['kind'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_break_link_to_style',
            'indesign.styles.character_styles_menu_break_link_to_style',
            'indesign.styles.object_styles_menu_break_link_to_style',
            'indesign.styles.table_styles_menu_break_link_to_style',
            'indesign.styles.cell_styles_menu_break_link_to_style',
            'indesign.styles.break_link_to_style',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { kind: 'cell', text: null, target: null, table: { frameId: 12, index: 0 }, cells: { rows: [0, 1], columns: [0, 2] } },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const { helpers, lines } = targetFor(kind, a);
            const body = [
                ...lines,
                ...selectStatements(kind),
                `__showPanel(${str(PANEL[kind])});`,
                `var used = __invoke(${json(BREAK_LINK_IDS[kind])}, "Break Link to Style");`,
                `__result__ = { kind: "${kind}", unlinkedFrom: applied, menuAction: used };`,
            ];
            return run('Break link to style', script(STYLE_JSX + helpers + MENU_JSX + body.join('\n')));
        },
    },
    {
        name: 'load_styles',
        description: 'Load styles from another InDesign document or template: paragraph, character, all text, object, table, cell, table and cell, TOC or stroke styles, choosing how name conflicts resolve (Load Styles in the style panel menus)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'The InDesign document (.indd) or template (.indt) to load from' },
                types: {
                    type: 'array',
                    items: { type: 'string', enum: Object.keys(IMPORT_FORMATS) },
                    description: 'Which styles to load: text loads paragraph and character styles, table_and_cell loads both table and cell styles',
                },
                conflicts: { type: 'string', enum: Object.keys(CLASH), description: 'When a style with the same name exists: rename the incoming one, overwrite the existing one, or skip it', default: 'rename' },
            },
            required: ['filePath', 'types'],
        },
        features: [
            'indesign.styles.load_styles',
            'indesign.styles.paragraph_styles_menu_load_paragraph_styles',
            'indesign.styles.paragraph_styles_menu_load_all_text_styles',
            'indesign.styles.character_styles_menu_load_character_styles',
            'indesign.styles.character_styles_menu_load_all_text_styles',
            'indesign.styles.object_styles_menu_load_object_styles',
            'indesign.styles.table_styles_menu_load_table_styles',
            'indesign.styles.table_styles_menu_load_table_and_cell_styles',
            'indesign.styles.cell_styles_menu_load_cell_styles',
            'indesign.styles.cell_styles_menu_load_table_and_cell_styles',
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        handler: (a) => {
            const path = jsxPath(validateFilePath(a.filePath));
            if (!Array.isArray(a.types) || !a.types.length) throw new Error("'types' must list at least one kind of style");
            const types = [...new Set(a.types.map((t) => enumOf(t, Object.keys(IMPORT_FORMATS), { name: 'types' })))];
            const clash = CLASH[enumOf(a.conflicts ?? 'rename', Object.keys(CLASH), { name: 'conflicts' })];
            const body = [
                `var f = File(${path});`,
                'if (!f.exists) throw new Error("File not found: " + f.fsName);',
                ...types.map((t) => `doc.importStyles(ImportFormat.${IMPORT_FORMATS[t]}, f, GlobalClashResolutionStrategy.${clash});`),
                `__result__ = { file: f.fsName, loaded: ${json(types)}, conflicts: "${clash}", paragraphStyles: doc.allParagraphStyles.length, characterStyles: doc.allCharacterStyles.length, objectStyles: doc.allObjectStyles.length, tableStyles: doc.allTableStyles.length, cellStyles: doc.allCellStyles.length };`,
            ];
            return run('Load styles', script(body.join('\n')));
        },
    },
    {
        name: 'set_nested_styles',
        description: 'Set a paragraph style\'s nested styles (a character style up to a delimiter), nested line styles (a character style for N lines) or GREP styles (a character style wherever a GREP pattern matches): replace, add, remove one or clear them; or insert an End Nested Style Here character into text (Drop Caps and Nested Styles, GREP Style)',
        inputSchema: {
            type: 'object',
            properties: {
                style: STYLE('The paragraph style'),
                type: { type: 'string', enum: Object.keys(NESTED), description: 'nested, line or GREP styles', default: 'nested' },
                action: { type: 'string', enum: ['replace', 'add', 'remove', 'clear', 'insert_end_marker'], description: 'replace all entries, add entries, remove the entry at removeIndex, clear all, or insert End Nested Style Here at the end of text', default: 'replace' },
                entries: {
                    type: 'array',
                    description: 'Entries in order. Nested: characterStyle, delimiter (a NestedStyleDelimiters name such as ANY_WORD, SENTENCE, TABS, REPEAT, END_NESTED_STYLE, or literal characters), repetition, inclusive. Line: characterStyle, lineCount, repeatLast. GREP: characterStyle, grepExpression',
                    items: {
                        type: 'object',
                        properties: {
                            characterStyle: { type: 'string', description: 'Character style name ("[None]" for none)' },
                            delimiter: { type: 'string', description: 'Nested: what the style runs up to' },
                            repetition: { type: 'integer', minimum: 1, description: 'Nested: how many delimiters (or, with REPEAT, how many previous entries to loop)' },
                            inclusive: { type: 'boolean', description: 'Nested: include the delimiter (Through) rather than stop before it (Up to)' },
                            lineCount: { type: 'integer', minimum: 1, description: 'Line: number of lines' },
                            repeatLast: { type: 'integer', minimum: 0, description: 'Line: repeat the last N entries' },
                            grepExpression: { type: 'string', description: 'GREP: the pattern' },
                        },
                    },
                },
                removeIndex: { type: 'integer', minimum: 0, description: 'remove: the entry to delete (0-based)' },
                text: TEXT_SCHEMA,
            },
        },
        features: [
            'indesign.styles.nested_styles',
            'indesign.styles.nested_line_styles',
            'indesign.styles.grep_styles',
            'indesign.styles.end_nested_style',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { style: 'Body', type: 'nested', action: 'replace', entries: [{ characterStyle: 'Bold', delimiter: 'ANY_WORD', repetition: 2, inclusive: true }, { characterStyle: '[None]', delimiter: ':' }], removeIndex: null, text: null },
        handler: (a) => {
            const action = enumOf(a.action ?? 'replace', ['replace', 'add', 'remove', 'clear', 'insert_end_marker'], { name: 'action' });
            if (action === 'insert_end_marker') {
                return run('Insert end nested style', script(TEXT_JSX + [
                    `var t = __text(doc, ${textSpec(a.text)});`,
                    't.insertionPoints[-1].contents = SpecialCharacters.END_NESTED_STYLE;',
                    '__result__ = { inserted: "END_NESTED_STYLE" };',
                ].join('\n')));
            }
            const type = enumOf(a.type ?? 'nested', Object.keys(NESTED), { name: 'type' });
            const coll = NESTED[type].coll;
            const lines = [`var s = __style(doc, "paragraph", ${str(styleRef(a.style, 'style'))}), c = s.${coll};`];
            if (action === 'replace' || action === 'clear') lines.push('for (var i = c.length - 1; i >= 0; i--) c[i].remove();');
            if (action === 'replace' || action === 'add') {
                if (!Array.isArray(a.entries) || !a.entries.length) throw new Error(`${action} needs 'entries'`);
                a.entries.forEach((e, i) => lines.push(`c.add(${nestedEntry(type, e, i)});`));
            }
            if (action === 'remove') {
                const i = int(a.removeIndex, { name: 'removeIndex', max: 1000 });
                lines.push(`if (${i} >= c.length) throw new Error("Entry ${i} is out of range; there are " + c.length);`, `c[${i}].remove();`);
            }
            const read = {
                nested: 'o.delimiter = typeof e.delimiter === "string" ? e.delimiter : __enumName(e.delimiter); o.repetition = e.repetition; o.inclusive = e.inclusive;',
                line: 'o.lineCount = e.lineCount; o.repeatLast = e.repeatLast;',
                grep: 'o.grepExpression = e.grepExpression;',
            }[type];
            lines.push(
                'var out = [];',
                'for (var j = 0; j < c.length; j++) {',
                '  var e = c[j], o = { characterStyle: __styleName(e.appliedCharacterStyle) };',
                `  ${read}`,
                '  out.push(o);',
                '}',
                `__result__ = { style: __styleInfo(s, "paragraph"), type: "${type}", entries: out };`,
            );
            return run('Set nested styles', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'set_style_export_tags',
        description: 'Set export tagging for paragraph and character styles in one call: the HTML/EPUB tag, class and attributes, the PDF tag, and whether to emit CSS or split the EPUB (Export Tagging in Style Options, Edit All Export Tags)',
        inputSchema: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    description: 'One entry per style and export type',
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: ['paragraph', 'character'], description: 'Style kind' },
                            style: { type: 'string', description: 'Style name or "Group/Style"' },
                            exportType: { type: 'string', enum: ['EPUB', 'PDF'], description: 'EPUB and HTML, or PDF' },
                            tag: { type: 'string', description: 'Export tag, such as p, h1, span, or [Automatic]' },
                            className: { type: 'string', description: 'EPUB and HTML: the class' },
                            attributes: { type: 'string', description: 'EPUB and HTML: extra attributes' },
                            remove: { type: 'boolean', description: 'Remove this export type\'s mapping instead' },
                            emitCss: { type: 'boolean', description: 'Emit CSS for the style' },
                            splitDocument: { type: 'boolean', description: 'Paragraph styles: split the EPUB at this style' },
                        },
                    },
                },
            },
            required: ['entries'],
        },
        features: [
            'indesign.styles.style_export_tagging',
            'indesign.styles.edit_all_export_tags',
            'indesign.styles.paragraph_styles_menu_edit_all_export_tags',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { entries: [{ kind: 'paragraph', style: 'Heading 1', exportType: 'EPUB', tag: 'h1', className: 'chapter', emitCss: true, splitDocument: true }, { kind: 'character', style: 'Emphasis', exportType: 'PDF', remove: true }] },
        handler: (a) => {
            if (!Array.isArray(a.entries) || !a.entries.length) throw new Error("'entries' must list at least one style");
            const fields = ['kind', 'style', 'exportType', 'tag', 'className', 'attributes', 'remove', 'emitCss', 'splitDocument'];
            const lines = ['var out = [], s, maps, hit, k;'];
            a.entries.forEach((raw, i) => {
                const w = `entries[${i}]`;
                const e = obj(raw, w);
                if (!e) throw new Error(`'${w}' must be an object`);
                for (const k of Object.keys(e)) if (!fields.includes(k)) throw new Error(`Unknown ${w} field '${k}'. Known: ${fields.join(', ')}`);
                const kind = enumOf(e.kind ?? 'paragraph', ['paragraph', 'character'], { name: `${w}.kind` });
                const type = enumOf(e.exportType ?? 'EPUB', ['EPUB', 'PDF'], { name: `${w}.exportType` });
                const text = (v, n) => { const t = String(v ?? ''); if (t.length > 500) throw new Error(`'${w}.${n}' is too long`); return str(t); };
                lines.push(
                    `s = __style(doc, "${kind}", ${str(styleRef(e.style, `${w}.style`))}); maps = s.styleExportTagMaps; hit = null;`,
                    `for (k = 0; k < maps.length; k++) if (maps[k].exportType === "${type}") hit = maps[k];`,
                );
                if (e.remove) lines.push('if (hit) hit.remove();');
                else {
                    lines.push(
                        `if (!hit) hit = maps.add("${type}", ${text(e.tag, 'tag')}, ${text(e.className, 'className')}, ${text(e.attributes, 'attributes')});`,
                        ...(has(e.tag) ? [`hit.exportTag = ${text(e.tag, 'tag')};`] : []),
                        ...(has(e.className) ? [`hit.exportClass = ${text(e.className, 'className')};`] : []),
                        ...(has(e.attributes) ? [`hit.exportAttributes = ${text(e.attributes, 'attributes')};`] : []),
                    );
                }
                if (has(e.emitCss)) lines.push(`s.emitCss = ${valueExpr({ t: 'bool' }, e.emitCss, `${w}.emitCss`)};`);
                if (has(e.splitDocument)) {
                    if (kind !== 'paragraph') throw new Error(`'${w}.splitDocument' is for paragraph styles`);
                    lines.push(`s.splitDocument = ${valueExpr({ t: 'bool' }, e.splitDocument, `${w}.splitDocument`)};`);
                }
                lines.push(
                    'var tags = [];',
                    'for (k = 0; k < maps.length; k++) tags.push({ exportType: maps[k].exportType, tag: maps[k].exportTag, className: maps[k].exportClass, attributes: maps[k].exportAttributes });',
                    `out.push({ style: __styleInfo(s, "${kind}"), tags: tags });`,
                );
            });
            lines.push('__result__ = { styles: out };');
            return run('Set style export tags', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'find_change_style',
        description: 'Find text by paragraph or character style (and optionally by text) in the document or one story, and change it to another paragraph or character style (Find/Change with Find Format and Change Format styles). Without change, only counts the matches',
        inputSchema: {
            type: 'object',
            properties: {
                find: {
                    type: 'object',
                    description: 'What to find; give at least one',
                    properties: {
                        paragraphStyle: STYLE('Paragraph style to find'),
                        characterStyle: STYLE('Character style to find'),
                        text: { type: 'string', description: 'Text to find (empty finds any text with the styles)' },
                    },
                },
                change: {
                    type: 'object',
                    description: 'What to change matches to; leave out to only find',
                    properties: {
                        paragraphStyle: STYLE('Paragraph style to apply'),
                        characterStyle: STYLE('Character style to apply'),
                    },
                },
                frameId: { type: 'integer', minimum: 0, description: 'Search only the story of this text frame (default: the whole document)' },
            },
            required: ['find'],
        },
        features: ['indesign.styles.find_change_styles'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { find: { paragraphStyle: 'Body old', text: '' }, change: { paragraphStyle: 'Body', characterStyle: '[None]' }, frameId: null },
        handler: (a) => {
            const f = obj(a.find, 'find') ?? {};
            const c = obj(a.change, 'change');
            for (const k of Object.keys(f)) if (!['paragraphStyle', 'characterStyle', 'text'].includes(k)) throw new Error(`Unknown find field '${k}'`);
            if (c) for (const k of Object.keys(c)) if (!['paragraphStyle', 'characterStyle'].includes(k)) throw new Error(`Unknown change field '${k}'`);
            if (!has(f.paragraphStyle) && !has(f.characterStyle) && !has(f.text)) throw new Error("'find' needs a paragraphStyle, characterStyle or text");
            if (c && !has(c.paragraphStyle) && !has(c.characterStyle)) throw new Error("'change' needs a paragraphStyle or characterStyle");
            if (has(f.text) && String(f.text).length > 1000) throw new Error("'find.text' is too long");
            const lines = [
                'app.findTextPreferences = NothingEnum.NOTHING;',
                'app.changeTextPreferences = NothingEnum.NOTHING;',
                'try {',
                ...(has(f.paragraphStyle) ? [`  app.findTextPreferences.appliedParagraphStyle = __style(doc, "paragraph", ${str(styleRef(f.paragraphStyle, 'find.paragraphStyle'))});`] : []),
                ...(has(f.characterStyle) ? [`  app.findTextPreferences.appliedCharacterStyle = __style(doc, "character", ${str(styleRef(f.characterStyle, 'find.characterStyle'))});`] : []),
                ...(has(f.text) ? [`  app.findTextPreferences.findWhat = ${str(String(f.text))};`] : []),
                ...(c && has(c.paragraphStyle) ? [`  app.changeTextPreferences.appliedParagraphStyle = __style(doc, "paragraph", ${str(styleRef(c.paragraphStyle, 'change.paragraphStyle'))});`] : []),
                ...(c && has(c.characterStyle) ? [`  app.changeTextPreferences.appliedCharacterStyle = __style(doc, "character", ${str(styleRef(c.characterStyle, 'change.characterStyle'))});`] : []),
                has(a.frameId) ? `  var where = __item(doc, ${int(a.frameId, { name: 'frameId', max: 1e9 })}).parentStory;` : '  var where = doc;',
                c ? '  var hits = where.changeText();' : '  var hits = where.findText();',
                '  var samples = [];',
                '  for (var i = 0; i < hits.length && i < 20; i++) samples.push(String(hits[i].contents).substring(0, 80));',
                `  __result__ = { changed: ${bool(!!c)}, count: hits.length, samples: samples };`,
                '} finally {',
                '  app.findTextPreferences = NothingEnum.NOTHING;',
                '  app.changeTextPreferences = NothingEnum.NOTHING;',
                '}',
            ];
            return run('Find and change style', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'set_style_defaults',
        description: 'Set the default object styles for new text and graphic frames, the default paragraph and character styles for new text, and whether applying an object style always clears overrides (Default Text Frame Style, Default Graphic Frame Style, Clear Overrides When Applying Style); returns the current defaults',
        inputSchema: {
            type: 'object',
            properties: {
                textFrameStyle: STYLE('Object style new text frames get'),
                graphicFrameStyle: STYLE('Object style new graphic frames get'),
                paragraphStyle: STYLE('Paragraph style new text gets'),
                characterStyle: STYLE('Character style new text gets'),
                clearOverridesWhenApplying: { type: 'boolean', description: 'Clear Overrides When Applying Style (an application preference)' },
            },
        },
        features: [
            'indesign.styles.default_text_frame_style',
            'indesign.styles.default_graphic_frame_style',
            'indesign.styles.clear_overrides_when_applying',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const lines = ['var d = doc.pageItemDefaults, td = doc.textDefaults;'];
            if (has(a.textFrameStyle)) lines.push(`d.appliedTextObjectStyle = __style(doc, "object", ${str(styleRef(a.textFrameStyle, 'textFrameStyle'))});`);
            if (has(a.graphicFrameStyle)) lines.push(`d.appliedGraphicObjectStyle = __style(doc, "object", ${str(styleRef(a.graphicFrameStyle, 'graphicFrameStyle'))});`);
            if (has(a.paragraphStyle)) lines.push(`td.appliedParagraphStyle = __style(doc, "paragraph", ${str(styleRef(a.paragraphStyle, 'paragraphStyle'))});`);
            if (has(a.characterStyle)) lines.push(`td.appliedCharacterStyle = __style(doc, "character", ${str(styleRef(a.characterStyle, 'characterStyle'))});`);
            if (has(a.clearOverridesWhenApplying)) lines.push(`app.clearOverridesWhenApplyingStyle = ${valueExpr({ t: 'bool' }, a.clearOverridesWhenApplying, 'clearOverridesWhenApplying')};`);
            lines.push('__result__ = { textFrameStyle: __styleName(d.appliedTextObjectStyle), graphicFrameStyle: __styleName(d.appliedGraphicObjectStyle), paragraphStyle: __styleName(td.appliedParagraphStyle), characterStyle: __styleName(td.appliedCharacterStyle), clearOverridesWhenApplying: app.clearOverridesWhenApplyingStyle };');
            return run('Set style defaults', script(STYLE_JSX + lines.join('\n')));
        },
    },
    {
        name: 'quick_apply_style',
        description: 'Quick Apply for styles: find paragraph, character, object, table and cell styles whose names match a query (optionally prefixed p:, c:, o:, t: or e: to search one kind) and apply the best match to the selection, or only list the matches (Edit > Quick Apply)',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Words to match in style names, such as "head 2" or "p:body"' },
                kinds: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Kinds of style to search (default: all, or the one named by a prefix)' },
                apply: { type: 'boolean', description: 'Apply the best match to the selection (false only lists matches)', default: true },
                clearOverrides: { type: 'boolean', description: 'Clear overrides while applying (paragraph, object, table and cell styles)' },
            },
            required: ['query'],
        },
        features: ['indesign.styles.quick_apply'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { query: 'p:body', kinds: null, apply: true, clearOverrides: true },
        handler: (a) => {
            let q = String(a.query ?? '').trim();
            if (!q) throw new Error("'query' is required");
            if (q.length > 200) throw new Error("'query' is too long");
            const prefixes = { p: 'paragraph', c: 'character', o: 'object', t: 'table', e: 'cell' };
            let kinds = Array.isArray(a.kinds) && a.kinds.length ? a.kinds.map((k) => enumOf(k, KINDS, { name: 'kinds' })) : KINDS;
            const m = /^([pcote]):\s*/i.exec(q);
            if (m) { kinds = [prefixes[m[1].toLowerCase()]]; q = q.slice(m[0].length); }
            if (!q) throw new Error("'query' has no words after its prefix");
            const words = q.toLowerCase().split(/\s+/).filter(Boolean);
            const apply = a.apply !== false;
            const clear = !!a.clearOverrides;
            const sel = (k) => [...targetFor(k, SELECTION_ARGS[k]).lines, ...applyStatements(k, clear && k !== 'character' ? 'overrides' : 'none', false)];
            const lines = [
                `var kinds = ${json(kinds)}, words = ${json(words)}, q = ${str(q.toLowerCase())}, hits = [];`,
                'for (var ki = 0; ki < kinds.length; ki++) {',
                '  var all = doc[__SK[kinds[ki]].all];',
                '  for (var si = 0; si < all.length; si++) {',
                '    var path = __stylePath(all[si]), low = path.toLowerCase(), ok = true;',
                '    for (var w = 0; w < words.length; w++) if (low.indexOf(words[w]) < 0) { ok = false; break; }',
                '    if (!ok) continue;',
                '    var nm = all[si].name.toLowerCase();',
                '    hits.push({ kind: kinds[ki], path: path, index: si, score: nm === q ? 0 : (nm.indexOf(q) === 0 ? 1 : 2) });',
                '  }',
                '}',
                'hits.sort(function (x, y) { return x.score !== y.score ? x.score - y.score : x.path.length - y.path.length; });',
                'if (!hits.length) throw new Error("No style matches " + q);',
                'var best = hits[0], applied = null, count = 0;',
            ];
            if (apply) {
                lines.push('var s = doc[__SK[best.kind].all][best.index];');
                for (const k of kinds) {
                    lines.push(`if (best.kind === "${k}") {`, ...sel(k).map((l) => `  ${l}`), '  applied = best.path;', '}');
                }
            }
            lines.push('var list = [];', 'for (var h = 0; h < hits.length && h < 20; h++) list.push({ kind: hits[h].kind, style: hits[h].path });', '__result__ = { matches: list, applied: applied, kind: best.kind, count: count };');
            const need = new Set(kinds);
            const helpers = (need.has('paragraph') || need.has('character') ? TEXT_JSX : '') + (need.has('table') || need.has('cell') ? TABLE_JSX : '') + (need.has('cell') ? CELLS_JSX : '');
            return run('Quick apply style', script(STYLE_JSX + (apply ? helpers + APPLY_JSX : '') + lines.join('\n')));
        },
    },
    {
        name: 'set_quick_apply_filters',
        description: 'Choose which kinds of items Quick Apply searches: paragraph, character, object, table and cell styles, menu commands (and hidden ones), scripts, text variables and conditions (the Include options in the Quick Apply menu); returns each filter\'s state',
        inputSchema: {
            type: 'object',
            properties: Object.fromEntries(Object.keys(QUICK_APPLY_FILTERS).map((k) => [k, { type: 'boolean', description: `Include ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}` }])),
        },
        features: ['indesign.styles.quick_apply_filters'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const lines = [
                'var out = {};',
                'var __filter = function (key, id, want) {',
                '  var m = app.menuActions.itemByID(id);',
                '  if (!m.isValid) throw new Error("Quick Apply filter " + key + " is not available in this InDesign version");',
                '  if (want !== null && m.checked !== want) {',
                '    if (!m.enabled) throw new Error("Quick Apply filter " + key + " cannot be changed now");',
                '    m.invoke();',
                '  }',
                '  out[key] = m.checked;',
                '};',
            ];
            for (const [k, id] of Object.entries(QUICK_APPLY_FILTERS)) {
                const want = has(a[k]) ? valueExpr({ t: 'bool' }, a[k], k) : 'null';
                lines.push(`__filter("${k}", ${id}, ${want});`);
            }
            lines.push('__result__ = out;');
            return run('Set Quick Apply filters', script(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'style_panel_command',
        description: 'Run a style panel menu command: Open All Style Groups, Close All Style Groups, Sort by Name, Small Panel Rows or Select All Unused, in the Paragraph, Character, Object, Table or Cell Styles panel (the panel is shown first)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: KIND,
                command: { type: 'string', enum: Object.keys(PANEL_COMMANDS), description: 'The panel menu command (select_all_unused is not in the Table Styles panel)' },
            },
            required: ['kind', 'command'],
        },
        features: [
            'indesign.styles.paragraph_styles_menu_open_all_style_groups',
            'indesign.styles.paragraph_styles_menu_close_all_style_groups',
            'indesign.styles.paragraph_styles_menu_sort_by_name',
            'indesign.styles.paragraph_styles_menu_small_panel_rows',
            'indesign.styles.paragraph_styles_menu_select_all_unused',
            'indesign.styles.character_styles_menu_open_all_style_groups',
            'indesign.styles.character_styles_menu_close_all_style_groups',
            'indesign.styles.character_styles_menu_sort_by_name',
            'indesign.styles.character_styles_menu_small_panel_rows',
            'indesign.styles.character_styles_menu_select_all_unused',
            'indesign.styles.object_styles_menu_open_all_groups',
            'indesign.styles.object_styles_menu_close_all_groups',
            'indesign.styles.object_styles_menu_sort_by_name',
            'indesign.styles.object_styles_menu_small_panel_rows',
            'indesign.styles.object_styles_menu_select_all_unused',
            'indesign.styles.table_styles_menu_open_all_style_groups',
            'indesign.styles.table_styles_menu_close_all_style_groups',
            'indesign.styles.table_styles_menu_sort_by_name',
            'indesign.styles.table_styles_menu_small_panel_rows',
            'indesign.styles.cell_styles_menu_open_all_style_groups',
            'indesign.styles.cell_styles_menu_close_all_style_groups',
            'indesign.styles.cell_styles_menu_sort_by_name',
            'indesign.styles.cell_styles_menu_small_panel_rows',
            'indesign.styles.cell_styles_menu_select_all_unused',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const kind = enumOf(a.kind, KINDS, { name: 'kind' });
            const command = enumOf(a.command, Object.keys(PANEL_COMMANDS), { name: 'command' });
            const id = PANEL_COMMANDS[command][kind];
            if (!id) throw new Error(`The ${PANEL[kind]} panel has no ${command} command`);
            const lines = [
                `__showPanel(${str(PANEL[kind])});`,
                `var used = __invoke([${id}], ${str(`${command} (${PANEL[kind]} panel)`)});`,
                `__result__ = { kind: "${kind}", command: "${command}", menuAction: used };`,
            ];
            return run('Style panel command', script(MENU_JSX + lines.join('\n')));
        },
    },
];
