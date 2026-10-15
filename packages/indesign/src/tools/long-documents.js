/**
 * Long documents: tables of contents, footnotes and endnotes, the index,
 * conditional text, hyperlinks, cross-references and bookmarks, text
 * variables and captions, and books (book contents and chapter numbering).
 *
 * Text is chosen with a text location (textSchema): the first or nth match of
 * some text in the document, a story or text frame with an optional character
 * range, or the current text selection. Styles, conditions, formats and
 * variables are chosen by name.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, colorSpec } from './run.js';
import { validateFilePath, jsxPath, ALLOWED } from '../utils/jsxSafe.js';

/** Atlas feature ids in this area. */
const F = (...ids) => ids.map((id) => `indesign.long_documents.${id}`);

// ---------------------------------------------------------------- schemas

const S = (description) => ({ type: 'string', description });
const B = (description) => ({ type: 'boolean', description });
const N = (description) => ({ type: 'number', description });
const I = (description, minimum = 0) => ({ type: 'integer', minimum, description });
const E = (values, description) => ({ type: 'string', enum: values, description });
const NAMES = (description) => ({ type: 'array', items: { type: 'string' }, description });

const TEXT_PROPS = {
    find: S('Text to find in the document (matched case-sensitively); the match is used'),
    occurrence: I('With find: which match to use, 1 for the first (default 1)', 1),
    storyId: I('A story id (get_document_stories lists them); its text is used'),
    frameId: I('A text frame id; the text in that frame is used'),
    start: I('With storyId or frameId: the first character, counted from 0'),
    length: I('With start: how many characters; 0 or absent means the point at start'),
    selection: B('Use the current text selection or text cursor'),
};

/**
 * A text location parameter. With `insertion`, the location is a point: after
 * the chosen text unless `before` is set.
 */
function textSchema(description, { insertion = false } = {}) {
    const properties = { ...TEXT_PROPS };
    if (insertion) properties.before = B('Use the point before the chosen text instead of the point after it');
    return { type: 'object', description, properties };
}

// ------------------------------------------------------------- validation

function text(v, name, { max = 2000, empty = true } = {}) {
    if (typeof v !== 'string') throw new Error(`'${name}' must be a string`);
    if (!empty && !v.trim()) throw new Error(`'${name}' is empty`);
    if (v.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return str(v);
}

function integer(v, name, min = 0, max = 1e9) {
    const n = Number(v);
    if (v === null || v === '' || !Number.isInteger(n) || n < min || n > max) {
        throw new Error(`'${name}' must be a whole number from ${min} to ${max}: ${JSON.stringify(v)}`);
    }
    return String(n);
}

const given = (v) => v !== undefined && v !== null;

/** A name (style, condition, format...) as a JSX string literal. */
const nameLit = (v, name) => text(v, name, { max: 300, empty: false });

/** A list of names as a JSX array literal. */
function nameList(v, name, { min = 1, max = 200 } = {}) {
    if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`'${name}' must list ${min} to ${max} names`);
    return `[${v.map((s, i) => nameLit(s, `${name}[${i}]`)).join(', ')}]`;
}

/** A caller's file path, checked against the server's path policy, as a JSX literal. */
const pathLit = (p, name) => {
    if (typeof p !== 'string' || !p) throw new Error(`'${name}' is required`);
    return jsxPath(validateFilePath(p));
};

/** A UIColors name (any case) or "#RRGGBB", as a JSX value. */
function uiColor(v, name) {
    const s = String(v ?? '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
        const n = parseInt(m[1], 16);
        return `[${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}]`;
    }
    return `UIColors.${enumOf(s.toUpperCase().replace(/[\s-]+/g, '_'), ALLOWED.uiColor, { name })}`;
}

/**
 * A text location as a JSX literal for __ldText()/__ldPoint(). Every field is
 * written (null when unused) so the helpers read only fields the literal has.
 */
function textSpec(t, name) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
        throw new Error(`'${name}' must be a text location: { find }, { storyId }, { frameId } or { selection: true }`);
    }
    const ways = ['find', 'storyId', 'frameId', 'selection'].filter((k) => given(t[k]) && t[k] !== false);
    if (ways.length !== 1) throw new Error(`'${name}': give exactly one of find, storyId, frameId or selection: true`);
    const out = { find: null, occurrence: 1, storyId: null, frameId: null, selection: false, start: null, length: 0, before: false };
    if (given(t.find)) {
        text(t.find, `${name}.find`, { max: 1000, empty: false });
        out.find = t.find.replace(/\^/g, '^^'); // ^ starts a metacharacter in Find/Change
        if (given(t.occurrence)) out.occurrence = Number(integer(t.occurrence, `${name}.occurrence`, 1, 100000));
    }
    if (given(t.storyId)) out.storyId = Number(integer(t.storyId, `${name}.storyId`));
    if (given(t.frameId)) out.frameId = Number(integer(t.frameId, `${name}.frameId`));
    if (t.selection === true) out.selection = true;
    else if (given(t.selection) && t.selection !== false) throw new Error(`'${name}.selection' must be true or false`);
    if (given(t.start)) {
        if (out.storyId === null && out.frameId === null) throw new Error(`'${name}.start' goes with storyId or frameId`);
        out.start = Number(integer(t.start, `${name}.start`));
    }
    if (given(t.length)) {
        if (out.start === null) throw new Error(`'${name}.length' needs start`);
        out.length = Number(integer(t.length, `${name}.length`));
    }
    if (t.before === true) out.before = true;
    return json(out);
}

/** Page placement (pageIndex, x, y in mm from the page's top-left) as JSX statements defining `page` and `pt`. */
function placement(a) {
    const page = given(a.pageIndex) ? integer(a.pageIndex, 'pageIndex', 0, 100000) : '0';
    const x = given(a.x) ? num(a.x, { min: -5000, max: 5000, name: 'x' }) : 'page.marginPreferences.left';
    const y = given(a.y) ? num(a.y, { min: -5000, max: 5000, name: 'y' }) : 'page.marginPreferences.top';
    return [
        `var page = __page(doc, ${page});`,
        `var pt = __toPage(page, ${x}, ${y});`,
        `var layer = ${given(a.layer) ? `__ldNamed(doc.layers, ${nameLit(a.layer, 'layer')}, "layer")` : 'doc.activeLayer'};`,
    ].join('\n');
}

const PLACEMENT_PROPS = {
    pageIndex: I('Page to place it on, 0-based (default 0)'),
    x: N('Left edge in mm from the page\'s left edge (default: the left margin)'),
    y: N('Top edge in mm from the page\'s top edge (default: the top margin)'),
    layer: S('Layer to place it on (default: the active layer)'),
};

// ---------------------------------------------------------- option tables

/**
 * An option maps a caller key to an object-model property. Types: string,
 * bool (invert flips it), mm, pt (written as "Npt"), pct (0-100), int, enum
 * (enumName.values), pstyle / cstyle (style by name), swatch, stroke (stroke
 * style by name), uicolor, object (a nested table on the same target).
 */
const opt = (key, prop, type, description, extra = {}) => ({ key, prop, type, description, ...extra });
const eopt = (key, prop, enumName, values, description) => opt(key, prop, 'enum', description, { enumName, values });

const FOOTNOTE_NUMBERING = ['ARABIC', 'ARABIC_ABJAD', 'ARABIC_ALIF_BA_TAH', 'ASTERISKS', 'DOUBLE_LEADING_ZEROS', 'FULL_WIDTH_ARABIC', 'HEBREW_BIBLICAL', 'HEBREW_NON_STANDARD', 'KANJI', 'LOWER_LETTERS', 'LOWER_ROMAN', 'SINGLE_LEADING_ZEROS', 'SYMBOLS', 'UPPER_LETTERS', 'UPPER_ROMAN'];
const PREFIX_SUFFIX = ['NO_PREFIX_SUFFIX', 'PREFIX_SUFFIX_BOTH', 'PREFIX_SUFFIX_MARKER', 'PREFIX_SUFFIX_REFERENCE'];
const MARKER_POSITION = ['NORMAL_MARKER', 'RUBY_MARKER', 'SUBSCRIPT_MARKER', 'SUPERSCRIPT_MARKER'];
const NUMBERING_STYLE = ['ARABIC', 'ARABIC_ABJAD', 'ARABIC_ALIF_BA_TAH', 'DOUBLE_LEADING_ZEROS', 'FORMAT_NONE', 'HEBREW_BIBLICAL', 'HEBREW_NON_STANDARD', 'KANJI', 'KATAKANA_MODERN', 'KATAKANA_TRADITIONAL', 'LOWER_LETTERS', 'LOWER_ROMAN', 'SINGLE_LEADING_ZEROS', 'TRIPLE_LEADING_ZEROS', 'UPPER_LETTERS', 'UPPER_ROMAN'];
const VARIABLE_NUMBERING = ['ARABIC', 'CURRENT', 'DOUBLE_LEADING_ZEROS', 'FULL_WIDTH_ARABIC', 'KANJI', 'LOWER_LETTERS', 'LOWER_ROMAN', 'SINGLE_LEADING_ZEROS', 'UPPER_LETTERS', 'UPPER_ROMAN'];
const UI_COLOR_HELP = 'An InDesign UI colour name (e.g. LIGHT_BLUE, RED, GRID_GREEN) or "#RRGGBB"';

/** Rule Above options for the first footnote in a column (prefix "rule") or continued footnotes ("continuingRule"). */
const ruleTable = (p) => [
    opt('on', `${p}On`, 'bool', 'Draw the rule'),
    opt('weight', `${p}LineWeight`, 'pt', 'Rule weight in points'),
    opt('type', `${p}Type`, 'stroke', 'Stroke style name (e.g. "Solid", "Dashed")'),
    opt('color', `${p}Color`, 'swatch', 'Rule colour: a swatch name or "#RRGGBB"'),
    opt('tint', `${p}Tint`, 'pct', 'Rule tint, 0-100'),
    opt('overprint', `${p}Overprint`, 'bool', 'Overprint the rule'),
    opt('gapColor', `${p}GapColor`, 'swatch', 'Gap colour for dashed or dotted rules: a swatch name or "#RRGGBB"'),
    opt('gapTint', `${p}GapTint`, 'pct', 'Gap tint, 0-100'),
    opt('gapOverprint', `${p}GapOverprint`, 'bool', 'Overprint the gap'),
    opt('width', `${p}Width`, 'mm', 'Rule width in mm'),
    opt('offset', `${p}Offset`, 'mm', 'Rule offset in mm'),
    opt('leftIndent', `${p}LeftIndent`, 'mm', 'Rule left indent in mm'),
];

const FOOTNOTE_OPTIONS = [
    eopt('numberingStyle', 'footnoteNumberingStyle', 'FootnoteNumberingStyle', FOOTNOTE_NUMBERING, 'Numbering style'),
    opt('startAt', 'startAt', 'int', 'First footnote number', { min: 1 }),
    eopt('restartNumbering', 'restartNumbering', 'FootnoteRestarting', ['DONT_RESTART', 'PAGE_RESTART', 'SPREAD_RESTART', 'SECTION_RESTART'], 'Restart numbering every page, spread or section, or never'),
    eopt('showPrefixSuffix', 'showPrefixSuffix', 'FootnotePrefixSuffix', PREFIX_SUFFIX, 'Where the prefix and suffix appear: the reference, the footnote, both or neither'),
    opt('prefix', 'prefix', 'string', 'Prefix before the number'),
    opt('suffix', 'suffix', 'string', 'Suffix after the number'),
    eopt('markerPosition', 'markerPositioning', 'FootnoteMarkerPositioning', MARKER_POSITION, 'Position of the reference number in the text'),
    opt('markerCharacterStyle', 'footnoteMarkerStyle', 'cstyle', 'Character style for the reference number'),
    opt('paragraphStyle', 'footnoteTextStyle', 'pstyle', 'Paragraph style for footnote text'),
    opt('separator', 'separatorText', 'string', 'Text between the footnote number and its text (^t is a tab)'),
    opt('spaceBefore', 'spacer', 'mm', 'Minimum space before the first footnote, in mm'),
    opt('spaceBetween', 'spaceBetween', 'mm', 'Space between footnotes, in mm'),
    eopt('firstBaselineOffset', 'footnoteFirstBaselineOffset', 'FootnoteFirstBaseline', ['ASCENT_OFFSET', 'CAP_HEIGHT', 'EMBOX_HEIGHT', 'FIXED_HEIGHT', 'LEADING_OFFSET', 'X_HEIGHT'], 'First baseline offset of footnote text'),
    opt('firstBaselineMinimum', 'footnoteMinimumFirstBaselineOffset', 'mm', 'Minimum first baseline offset, in mm'),
    opt('placeAtBottomOfText', 'eosPlacement', 'bool', 'Place end-of-story footnotes at the bottom of the text instead of the column'),
    opt('allowSplit', 'noSplitting', 'bool', 'Allow footnotes to split across columns', { invert: true }),
    opt('spanColumns', 'enableStraddling', 'bool', 'Span footnotes across the columns of multi-column frames'),
    opt('ruleAbove', null, 'object', 'Rule above the first footnote in a column', { table: ruleTable('rule') }),
    opt('continuedRuleAbove', null, 'object', 'Rule above continued footnotes', { table: ruleTable('continuingRule') }),
];

const ENDNOTE_OPTIONS = [
    eopt('numberingStyle', 'endnoteNumberingStyle', 'FootnoteNumberingStyle', FOOTNOTE_NUMBERING, 'Numbering style'),
    opt('startAt', 'startEndnoteNumberAt', 'int', 'First endnote number', { min: 1 }),
    eopt('restartNumbering', 'restartEndnoteNumbering', 'EndnoteRestarting', ['CONTINUOUS', 'STORY_RESTART'], 'Number continuously or restart in each story'),
    eopt('showPrefixSuffix', 'showEndnotePrefixSuffix', 'FootnotePrefixSuffix', PREFIX_SUFFIX, 'Where the prefix and suffix appear'),
    opt('prefix', 'endnotePrefix', 'string', 'Prefix before the number'),
    opt('suffix', 'endnoteSuffix', 'string', 'Suffix after the number'),
    eopt('markerPosition', 'endnoteMarkerPositioning', 'FootnoteMarkerPositioning', MARKER_POSITION, 'Position of the reference number in the text'),
    opt('markerCharacterStyle', 'endnoteMarkerStyle', 'cstyle', 'Character style for the reference number'),
    opt('paragraphStyle', 'endnoteTextStyle', 'pstyle', 'Paragraph style for endnote text'),
    opt('separator', 'endnoteSeparatorText', 'string', 'Text between the endnote number and its text (^t is a tab)'),
    opt('title', 'endnoteTitle', 'string', 'Endnote header text'),
    opt('titleStyle', 'endnoteTitleStyle', 'pstyle', 'Paragraph style for the endnote header'),
    eopt('scope', 'scopeValue', 'EndnoteScope', ['ENDNOTE_DOCUMENT_SCOPE', 'STORY_SCOPE'], 'Endnotes for the whole document or per story'),
    eopt('frame', 'frameCreateOption', 'EndnoteFrameCreate', ['NEW_PAGE', 'LOAD_ENDNOTE_PLACE_GUN'], 'Put endnotes on a new page at the end, or load them in the place cursor (needs someone to place them)'),
];

const WORD_IMPORT_OPTIONS = [
    opt('importFootnotes', 'importFootnotes', 'bool', 'Import Word footnotes as footnotes'),
    opt('importEndnotes', 'importEndnotes', 'bool', 'Import Word endnotes'),
    opt('importAsStaticEndnotes', 'importAsStaticEndnotes', 'bool', 'Import endnotes as static text instead of live endnotes'),
];

const TOC_STYLE_OPTIONS = [
    opt('title', 'title', 'string', 'Title text above the table of contents'),
    opt('titleStyle', 'titleStyle', 'pstyle', 'Paragraph style for the title'),
    opt('createBookmarks', 'createBookmarks', 'bool', 'Create PDF bookmarks from the entries'),
    opt('runIn', 'runIn', 'bool', 'Run all entries into one paragraph'),
    opt('includeHiddenLayers', 'includeHidden', 'bool', 'Include text on hidden layers'),
    opt('includeBookDocuments', 'includeBookDocuments', 'bool', 'Include every document of the book this document belongs to'),
    opt('makeAnchor', 'makeAnchor', 'bool', 'Make a text anchor in each source paragraph so entries link to it'),
    opt('removeForcedLineBreak', 'removeForcedLineBreak', 'bool', 'Remove forced line breaks from entries'),
    eopt('numberedParagraphs', 'numberedParagraphs', 'NumberedParagraphsOptions', ['INCLUDE_FULL_PARAGRAPH', 'INCLUDE_NUMBERS_ONLY', 'EXCLUDE_NUMBERS'], 'What to keep of numbered paragraphs'),
    eopt('frameDirection', 'setStoryDirection', 'HorizontalOrVertical', ['HORIZONTAL', 'VERTICAL'], 'Text direction of the generated frame'),
];

const TOC_ENTRY_OPTIONS = [
    opt('entryStyle', 'formatStyle', 'pstyle', 'Paragraph style for the entries'),
    opt('level', 'level', 'int', 'Entry level, 1 for the top', { min: 1, max: 20 }),
    eopt('pageNumber', 'pageNumberPosition', 'PageNumberPosition', ['AFTER_ENTRY', 'BEFORE_ENTRY', 'NONE'], 'Where the page number goes'),
    opt('pageNumberStyle', 'pageNumberStyle', 'cstyle', 'Character style for the page number'),
    opt('separator', 'separator', 'string', 'Text between entry and number (^t is a tab, ^y right-indent tab)'),
    opt('separatorStyle', 'separatorStyle', 'cstyle', 'Character style for the separator'),
    opt('sortAlphabetically', 'sortAlphabet', 'bool', 'Sort entries at this level alphabetically'),
];

const INDEX_OPTIONS = [
    opt('title', 'title', 'string', 'Index title'),
    opt('titleStyle', 'titleStyle', 'pstyle', 'Paragraph style for the title'),
    opt('replaceExisting', 'replaceExistingIndex', 'bool', 'Replace the index already generated instead of placing a new one'),
    opt('includeBookDocuments', 'includeBookDocuments', 'bool', 'Index every document of the book'),
    opt('includeHiddenEntries', 'includeHiddenEntries', 'bool', 'Include entries on hidden layers'),
    eopt('format', 'indexFormat', 'IndexFormat', ['NESTED_FORMAT', 'RUNIN_FORMAT'], 'Nested (one line per subentry) or run-in'),
    opt('includeSectionHeadings', 'includeSectionHeadings', 'bool', 'Include section headings (A, B, C...)'),
    opt('includeEmptySections', 'includeEmptyIndexSections', 'bool', 'Include sections with no entries'),
    opt('level1Style', 'level1Style', 'pstyle', 'Paragraph style for level 1 entries'),
    opt('level2Style', 'level2Style', 'pstyle', 'Paragraph style for level 2 entries'),
    opt('level3Style', 'level3Style', 'pstyle', 'Paragraph style for level 3 entries'),
    opt('level4Style', 'level4Style', 'pstyle', 'Paragraph style for level 4 entries'),
    opt('sectionHeadingStyle', 'sectionHeadingStyle', 'pstyle', 'Paragraph style for section headings'),
    opt('pageNumberStyle', 'pageNumberStyle', 'cstyle', 'Character style for page numbers'),
    opt('crossReferenceStyle', 'crossReferenceStyle', 'cstyle', 'Character style for cross-reference words (See, See also)'),
    opt('crossReferenceTopicStyle', 'crossReferenceTopicStyle', 'cstyle', 'Character style for the referenced topic'),
    opt('followingTopicSeparator', 'followingTopicSeparator', 'string', 'Separator after the topic (^t, ^> and other metacharacters work)'),
    opt('betweenPageNumbersSeparator', 'betweenPageNumbersSeparator', 'string', 'Separator between page numbers'),
    opt('betweenEntriesSeparator', 'betweenEntriesSeparator', 'string', 'Separator between run-in entries'),
    opt('beforeCrossReferenceSeparator', 'beforeCrossReferenceSeparator', 'string', 'Separator before a cross-reference'),
    opt('pageRangeSeparator', 'pageRangeSeparator', 'string', 'Separator in page ranges'),
    opt('entryEndSeparator', 'entryEndSeparator', 'string', 'Text at the end of each entry'),
];

const CONDITION_OPTIONS = [
    opt('visible', 'visible', 'bool', 'Show the condition\'s text'),
    eopt('indicatorMethod', 'indicatorMethod', 'ConditionIndicatorMethod', ['USE_HIGHLIGHT', 'USE_UNDERLINE'], 'Indicate the text with a highlight or an underline'),
    opt('indicatorColor', 'indicatorColor', 'uicolor', `Indicator colour: ${UI_COLOR_HELP}`),
    eopt('underlineAppearance', 'underlineIndicatorAppearance', 'ConditionUnderlineIndicatorAppearance', ['SOLID', 'DASHED', 'WAVY'], 'Underline style when indicating with an underline'),
];

const HYPERLINK_APPEARANCE = [
    opt('visible', 'visible', 'bool', 'Show a visible rectangle around the source'),
    eopt('highlight', 'highlight', 'HyperlinkAppearanceHighlight', ['NONE', 'INVERT', 'OUTLINE', 'INSET'], 'Highlight when clicked'),
    opt('color', 'borderColor', 'uicolor', `Rectangle colour: ${UI_COLOR_HELP}`),
    eopt('width', 'width', 'HyperlinkAppearanceWidth', ['THIN', 'MEDIUM', 'THICK'], 'Rectangle line width'),
    eopt('style', 'borderStyle', 'HyperlinkAppearanceStyle', ['SOLID', 'DASHED'], 'Rectangle line style'),
];

/** Text variable types: the caller's name, VariableTypes member and the options each takes. */
const VARIABLE_TYPES = {
    custom_text: ['CUSTOM_TEXT_TYPE', ['text']],
    file_name: ['FILE_NAME_TYPE', ['includePath', 'includeExtension', 'textBefore', 'textAfter']],
    last_page_number: ['LAST_PAGE_NUMBER_TYPE', ['scope', 'numberFormat', 'textBefore', 'textAfter']],
    chapter_number: ['CHAPTER_NUMBER_TYPE', ['numberFormat', 'textBefore', 'textAfter']],
    creation_date: ['CREATION_DATE_TYPE', ['dateFormat', 'textBefore', 'textAfter']],
    modification_date: ['MODIFICATION_DATE_TYPE', ['dateFormat', 'textBefore', 'textAfter']],
    output_date: ['OUTPUT_DATE_TYPE', ['dateFormat', 'textBefore', 'textAfter']],
    running_header_paragraph: ['MATCH_PARAGRAPH_STYLE_TYPE', ['paragraphStyle', 'use', 'changeCase', 'deleteEndPunctuation', 'textBefore', 'textAfter']],
    running_header_character: ['MATCH_CHARACTER_STYLE_TYPE', ['characterStyle', 'use', 'changeCase', 'deleteEndPunctuation', 'textBefore', 'textAfter']],
    metadata_caption: ['LIVE_CAPTION_TYPE', ['metadataField', 'textBefore', 'textAfter']],
};

const VARIABLE_OPTIONS = [
    opt('text', 'contents', 'string', 'custom_text: the text'),
    opt('includePath', 'includePath', 'bool', 'file_name: include the folder path'),
    opt('includeExtension', 'includeExtension', 'bool', 'file_name: include the file extension'),
    eopt('scope', 'scope', 'VariableScopes', ['DOCUMENT_SCOPE', 'SECTION_SCOPE'], 'last_page_number: last page of the document or of the section'),
    eopt('numberFormat', 'format', 'VariableNumberingStyles', VARIABLE_NUMBERING, 'last_page_number, chapter_number: number style (CURRENT follows the section or chapter setting)'),
    opt('dateFormat', 'format', 'string', 'Dates: a date pattern such as "MMMM d, yyyy" or "dd/MM/yy h:mm a"'),
    opt('paragraphStyle', 'appliedParagraphStyle', 'pstyle', 'running_header_paragraph: the paragraph style to pick up'),
    opt('characterStyle', 'appliedCharacterStyle', 'cstyle', 'running_header_character: the character style to pick up'),
    eopt('use', 'searchStrategy', 'SearchStrategies', ['FIRST_ON_PAGE', 'LAST_ON_PAGE'], 'Running headers: use the first or last match on the page'),
    eopt('changeCase', 'changeCase', 'ChangeCaseOptions', ['NONE', 'UPPERCASE', 'LOWERCASE', 'TITLECASE', 'SENTENCECASE'], 'Running headers: change the case'),
    opt('deleteEndPunctuation', 'deleteEndPunctuation', 'bool', 'Running headers: delete punctuation at the end'),
    opt('metadataField', 'metadataProviderName', 'string', 'metadata_caption: the metadata field, e.g. "Name", "Description", "Headline", "Credit"'),
    opt('textBefore', 'textBefore', 'string', 'Text before the value (every type except custom_text)'),
    opt('textAfter', 'textAfter', 'string', 'Text after the value (every type except custom_text)'),
];

function propSchema(o) {
    switch (o.type) {
        case 'bool': return B(o.description);
        case 'mm': case 'pt': case 'pct': return N(o.description);
        case 'int': return I(o.description, o.min ?? 0);
        case 'enum': return E(o.values, o.description);
        case 'object': return objectSchema(o.table, o.description);
        default: return S(o.description);
    }
}

function objectSchema(table, description) {
    return { type: 'object', description, properties: Object.fromEntries(table.map((o) => [o.key, propSchema(o)])) };
}

/** One option value as a JSX expression. */
function optionValue(o, v, name) {
    switch (o.type) {
        case 'string': return text(v, name);
        case 'bool':
            if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
            return bool(o.invert ? !v : v);
        case 'mm': return num(v, { min: o.min ?? -5000, max: o.max ?? 5000, name });
        case 'pt': return str(`${num(v, { min: 0, max: 1000, name })}pt`);
        case 'pct': return num(v, { min: 0, max: 100, name });
        case 'int': return integer(v, name, o.min ?? 0, o.max ?? 100000);
        case 'enum': return `${o.enumName}.${enumOf(v, o.values, { name })}`;
        case 'pstyle': return `__ldStyle(doc, "p", ${nameLit(v, name)})`;
        case 'cstyle': return `__ldStyle(doc, "c", ${nameLit(v, name)})`;
        case 'swatch': return `__swatch(doc, ${colorSpec(v, name)})`;
        case 'stroke': return `__ldNamed(doc.strokeStyles, ${nameLit(v, name)}, "stroke style")`;
        case 'uicolor': return uiColor(v, name);
        default: throw new Error(`Unhandled option type ${o.type}`);
    }
}

/** Assignments `target.prop = value;` for the options a caller gave, refusing unknown keys. */
function optionLines(target, values, table, label, allowedKeys = null) {
    if (!given(values)) return [];
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error(`'${label}' must be an object`);
    const byKey = new Map(table.filter((o) => !allowedKeys || allowedKeys.includes(o.key)).map((o) => [o.key, o]));
    const lines = [];
    for (const [k, v] of Object.entries(values)) {
        if (!given(v)) continue;
        const o = byKey.get(k);
        if (!o) throw new Error(`Unknown option '${label}.${k}'. Allowed: ${[...byKey.keys()].join(', ')}`);
        if (o.type === 'object') lines.push(...optionLines(target, v, o.table, `${label}.${k}`));
        else lines.push(`${target}.${o.prop} = ${optionValue(o, v, `${label}.${k}`)};`);
    }
    return lines;
}

// ------------------------------------------------------------ JSX helpers

/**
 * This area's helpers, each as [name, source]. A script gets the ones its body
 * calls (and the ones those call), after the shared prelude.
 */
const LD_HELPERS = [
    ['__ldNamed', String.raw`
var __ldNamed = function (coll, name, what) {
  var x = coll.itemByName(name);
  if (!x.isValid) throw new Error("No " + what + " named " + name);
  return x;
};
`],
    ['__ldStyle', String.raw`
var __ldStyle = function (doc, kind, name) {
  var all = kind === "p" ? doc.allParagraphStyles : doc.allCharacterStyles;
  for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
  throw new Error("No " + (kind === "p" ? "paragraph" : "character") + " style named " + name);
};
`],
    ['__ldName', String.raw`
var __ldName = function (v) {
  if (v === null || v === undefined) return null;
  try { if (v.name !== undefined) return String(v.name); } catch (e) {}
  return String(v);
};
`],
    ['__ldSnippet', String.raw`
var __ldSnippet = function (s) {
  s = String(s);
  return s.length > 100 ? s.substring(0, 100) + "..." : s;
};
`],
    ['__ldPageIndex', String.raw`
var __ldPageIndex = function (t) {
  try {
    var f = t.parentTextFrames;
    if (f.length && f[0].parentPage) return f[0].parentPage.documentOffset;
  } catch (e) {}
  return null;
};
`],
    ['__ldPageName', String.raw`
var __ldPageName = function (t) {
  try {
    var f = t.parentTextFrames;
    if (f.length && f[0].parentPage) return f[0].parentPage.name;
  } catch (e) {}
  return null;
};
`],
    ['__ldFind', String.raw`
var __ldFind = function (doc, what, occurrence) {
  var o = app.findChangeTextOptions, cs = o.caseSensitive, ww = o.wholeWord, hits;
  app.findTextPreferences = NothingEnum.NOTHING;
  app.changeTextPreferences = NothingEnum.NOTHING;
  try {
    o.caseSensitive = true;
    o.wholeWord = false;
    app.findTextPreferences.findWhat = what;
    hits = doc.findText();
  } finally {
    app.findTextPreferences = NothingEnum.NOTHING;
    o.caseSensitive = cs;
    o.wholeWord = ww;
  }
  if (hits.length < occurrence) throw new Error("Text not found: " + what + (occurrence > 1 ? " (match " + occurrence + "; there are " + hits.length + ")" : ""));
  return hits[occurrence - 1];
};
`],
    ['__ldText', String.raw`
var __ldText = function (doc, spec) {
  if (spec.find !== null) return __ldFind(doc, spec.find, spec.occurrence);
  if (spec.selection) {
    var sel = app.selection;
    if (!sel.length || !sel[0].hasOwnProperty("baseline")) throw new Error("Select some text, or click in text, first");
    return sel[0];
  }
  var base;
  if (spec.storyId !== null) {
    base = doc.stories.itemByID(spec.storyId);
    if (!base.isValid) throw new Error("No story with id " + spec.storyId);
  } else {
    base = __item(doc, spec.frameId);
    if (!base.hasOwnProperty("parentStory")) throw new Error("Item " + spec.frameId + " is not a text frame");
  }
  var all = base.texts[0];
  if (spec.start === null) return all;
  var n = all.characters.length;
  if (spec.start > n) throw new Error("start " + spec.start + " is past the end of the text (" + n + " characters)");
  if (!spec.length) return all.insertionPoints[spec.start];
  if (spec.start + spec.length > n) throw new Error("start + length runs past the end of the text (" + n + " characters)");
  return all.characters.itemByRange(spec.start, spec.start + spec.length - 1).texts[0];
};
`],
    ['__ldPoint', String.raw`
var __ldPoint = function (doc, spec) {
  var t = __ldText(doc, spec);
  return spec.before ? t.insertionPoints.firstItem() : t.insertionPoints.lastItem();
};
`],
    ['__ldBook', String.raw`
var __ldBook = function (path) {
  var f = File(path);
  for (var i = 0; i < app.books.length; i++) {
    try { if (app.books[i].fullName.fsName === f.fsName) return app.books[i]; } catch (e) {}
  }
  if (!f.exists) throw new Error("Book not found: " + path);
  return app.open(f);
};
`],
    ['__ldIndex', String.raw`
var __ldIndex = function (doc) {
  return doc.indexes.length ? doc.indexes[0] : doc.indexes.add();
};
`],
    ['__ldTopic', String.raw`
var __ldTopic = function (ix, path, create, sortOrder) {
  var parent = ix, t = null;
  for (var i = 0; i < path.length; i++) {
    t = parent.topics.itemByName(path[i]);
    if (!t.isValid) {
      if (!create) throw new Error("No index topic " + path.slice(0, i + 1).join(" > "));
      t = (i === path.length - 1 && sortOrder) ? parent.topics.add(path[i], sortOrder) : parent.topics.add(path[i]);
    }
    parent = t;
  }
  return t;
};
`],
    ['__ldBookmark', String.raw`
var __ldBookmark = function (coll, name) {
  for (var i = 0; i < coll.length; i++) {
    if (coll[i].name === name) return coll[i];
    var sub = __ldBookmark(coll[i].bookmarks, name);
    if (sub) return sub;
  }
  return null;
};
`],
    ['__ldLink', String.raw`
var __ldLink = function (doc, name, id) {
  var l = id !== null ? doc.hyperlinks.itemByID(id) : doc.hyperlinks.itemByName(name);
  if (!l.isValid) throw new Error("No hyperlink " + (id !== null ? "with id " + id : "named " + name));
  return l;
};
`],
    ['__ldNoteBody', String.raw`
var __ldNoteBody = function (s) {
  return String(s).replace(/^[\u0000-   -​　﻿]+/, "");
};
`],
    ['__ldIn', String.raw`
var __ldIn = function (list, v) {
  if (list === null) return true;
  for (var i = 0; i < list.length; i++) if (list[i] === v) return true;
  return false;
};
`],
];

/** A tool script: the shared prelude, the helpers the body uses, then the body. */
function ld(body, opts) {
    const used = new Set();
    let scan = body;
    for (let changed = true; changed;) {
        changed = false;
        for (const [name, src] of LD_HELPERS) {
            if (!used.has(name) && new RegExp(`\\b${name}\\b`).test(scan)) {
                used.add(name);
                scan += src;
                changed = true;
            }
        }
    }
    const helpers = LD_HELPERS.filter(([name]) => used.has(name)).map(([, src]) => src).join('\n');
    return script(`${helpers}\n${body}`, opts);
}

// ------------------------------------------------------------------ tools

const NOTE_ACTIONS = ['convert_to_endnotes', 'convert_to_footnotes', 'convert_to_text', 'delete', 'show_reference', 'show_text'];
const INDEX_ACTIONS = ['add_topic', 'add_page_reference', 'index_text', 'add_cross_reference', 'duplicate_topic', 'delete_topic', 'capitalize', 'remove_unused_topics', 'import_topics', 'update_preview', 'show_page_reference', 'set_sort_options'];
const CONDITION_ACTIONS = ['create', 'edit', 'delete', 'show_all', 'hide_all', 'set_indicators', 'load', 'create_set', 'redefine_set', 'activate_set', 'delete_set'];
const HYPERLINK_ACTIONS = ['rename', 'set_appearance', 'set_destination', 'set_format', 'reset_source', 'delete', 'show_source', 'show_destination', 'update_cross_references', 'rename_destination'];
const BOOKMARK_ACTIONS = ['add', 'delete', 'rename', 'show', 'move', 'sort'];
const BOOK_ACTIONS = ['document_info', 'remove_document', 'replace_document', 'save_as', 'close'];
const INFO_SECTIONS = ['toc_styles', 'notes', 'index', 'conditions', 'cross_references', 'hyperlinks', 'bookmarks', 'text_variables', 'chapter_numbering'];

const INDEX_REF_TYPES = ['CURRENT_PAGE', 'TO_NEXT_STYLE_CHANGE', 'TO_NEXT_USE_OF_STYLE', 'TO_END_OF_STORY', 'TO_END_OF_DOCUMENT', 'TO_END_OF_SECTION', 'FOR_NEXT_N_PARAGRAPHS', 'FOR_NEXT_N_PAGES', 'SUPPRESS_PAGE_NUMBERS'];
const INDEX_XREF_TYPES = ['SEE', 'SEE_ALSO', 'SEE_OR_ALSO_BRACKET', 'SEE_HEREIN', 'SEE_ALSO_HEREIN', 'CUSTOM_CROSS_REFERENCE', 'CUSTOM_CROSS_REFERENCE_BEFORE', 'CUSTOM_CROSS_REFERENCE_AFTER'];
const INDEX_CAPS = ['ALL_ENTRIES', 'ALL_LEVEL_1_ENTRIES', 'INCLUDE_SUBENTRIES', 'SELECTED_ENTRY'];
const HEADER_TYPES = ['BASIC_LATIN', 'BELARUSIAN', 'BULGARIAN', 'CHINESE_PINYIN', 'CHINESE_STROKE_COUNT', 'CROATIAN', 'CZECH', 'DANISH_NORWEGIAN', 'ESTONIAN', 'FINNISH_SWEDISH', 'HIRAGANA_ALL', 'HIRAGANA_CONSONANTS_ONLY', 'HUNGARIAN', 'KATAKANA_ALL', 'KATAKANA_CONSONANTS_ONLY', 'KOREAN_CONSONANT', 'KOREAN_CONSONANT_PLUS_VOWEL', 'LATVIAN', 'LITHUANIAN', 'POLISH', 'ROMANIAN', 'RUSSIAN', 'SLOVAK', 'SLOVENIAN', 'SPANISH', 'TURKISH', 'UKRAINIAN'];

const BLOCK_TYPES = {
    paragraph_text: 'PARAGRAPH_TEXT_BUILDING_BLOCK',
    full_paragraph: 'FULL_PARAGRAPH_BUILDING_BLOCK',
    paragraph_number: 'PARAGRAPH_NUMBER_BUILDING_BLOCK',
    page_number: 'PAGE_NUMBER_BUILDING_BLOCK',
    chapter_number: 'CHAPTER_NUMBER_BUILDING_BLOCK',
    file_name: 'FILE_NAME_BUILDING_BLOCK',
    bookmark_name: 'BOOKMARK_NAME_BUILDING_BLOCK',
    custom_text: 'CUSTOM_STRING_BUILDING_BLOCK',
};

const CHAPTER_SOURCES = { start_at: 'USER_DEFINED', continue: 'CONTINUE_FROM_PREVIOUS_DOCUMENT', same_as_previous: 'SAME_AS_PREVIOUS_DOCUMENT' };

/** Panel menu commands with no object-model equivalent: menu action id, atlas feature, and what must be open first. */
export const PANEL_COMMANDS = {
    index_show_find_field: [78101, 'index_menu_show_find_field', 'open the Index panel'],
    index_show_unused_topics: [78140, 'index_menu_show_unused_topics', 'open the Index panel'],
    conditions_show_options: [133140, 'conditional_text_menu_show_options', 'open the Conditional Text panel'],
    conditions_select_all_unused: [133143, 'conditional_text_menu_select_all_unused', 'open the Conditional Text panel'],
    hyperlinks_update_hyperlink: [79373, 'hyperlinks_menu_update_hyperlink', 'select a hyperlink in the Hyperlinks panel'],
    hyperlinks_sort_manually: [79374, 'hyperlinks_menu_sort_manually', 'open the Hyperlinks panel'],
    hyperlinks_sort_by_name: [79375, 'hyperlinks_menu_sort_by_name', 'open the Hyperlinks panel'],
    hyperlinks_sort_by_type: [79376, 'hyperlinks_menu_sort_by_type', 'open the Hyperlinks panel'],
    hyperlinks_small_panel_rows: [79369, 'hyperlinks_menu_small_panel_rows', 'open the Hyperlinks panel'],
    book_reveal_in_finder: [65821, 'book_menu_reveal_in_finder', 'select a document in the Book panel'],
    book_small_panel_rows: [65810, 'book_menu_small_panel_rows', 'open a book'],
    paste_as_cross_reference: [79428, 'paste_as_cross_reference', 'copy text from a paragraph, then click in text where the cross-reference goes'],
};

/** The destination of a hyperlink or bookmark as JSX defining `dest`. */
function destinationLines(d, name, { url = true, paragraph = true, text: allowText = false } = {}) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`'${name}' must be an object`);
    const kinds = ['url', 'pageIndex', 'anchor', 'paragraph', 'text'].filter((k) => given(d[k]));
    if (kinds.length !== 1) throw new Error(`'${name}': give exactly one destination`);
    const k = kinds[0];
    if (k === 'url') {
        if (!url) throw new Error(`'${name}.url' is not allowed here`);
        const u = String(d.url);
        if (!/^(https?|mailto|ftp):/i.test(u)) throw new Error(`'${name}.url' must start with http:, https:, mailto: or ftp:`);
        return `var dest = doc.hyperlinkURLDestinations.add(${text(u, `${name}.url`, { empty: false })});`;
    }
    if (k === 'pageIndex') return `var dest = doc.hyperlinkPageDestinations.add(__page(doc, ${integer(d.pageIndex, `${name}.pageIndex`, 0, 100000)}));`;
    if (k === 'anchor') return `var dest = __ldNamed(doc.hyperlinkTextDestinations, ${nameLit(d.anchor, `${name}.anchor`)}, "text anchor");`;
    if (k === 'paragraph') {
        if (!paragraph) throw new Error(`'${name}.paragraph' is not allowed here`);
        return `var dest = doc.paragraphDestinations.add(__ldText(doc, ${textSpec(d.paragraph, `${name}.paragraph`)}).paragraphs[0]);`;
    }
    if (!allowText) throw new Error(`'${name}.text' is not allowed here`);
    return `var dest = doc.hyperlinkTextDestinations.add(__ldText(doc, ${textSpec(d.text, `${name}.text`)}));`;
}

/** Hyperlink chosen by name or id, as JSX arguments for __ldLink(). */
function linkArgs(a) {
    if (given(a.id)) return `null, ${integer(a.id, 'id')}`;
    if (given(a.name)) return `${nameLit(a.name, 'name')}, null`;
    throw new Error("Choose the hyperlink: 'name' or 'id'");
}

/** Index topic path (top level first) as a JSX array literal. */
const topicPath = (v, name) => nameList(v, name, { min: 1, max: 4 });

export const tools = [
    // ----------------------------------------------------- tables of contents
    {
        name: 'define_toc_style',
        description: 'Create or change a table of contents style: its title, the paragraph styles it collects, and the level, entry style, page number and separator of each (Layout > Table of Contents Styles). Keep one style per table (contents, figures, tables) to build several.',
        inputSchema: {
            type: 'object',
            properties: {
                name: S('TOC style name; created when it does not exist'),
                newName: S('Rename the style'),
                options: objectSchema(TOC_STYLE_OPTIONS, 'Style options; only the ones given change'),
                entries: {
                    type: 'array',
                    description: 'Paragraph styles to include, in order. An entry for a style the TOC style already includes is updated',
                    items: { ...objectSchema(TOC_ENTRY_OPTIONS, 'One included paragraph style'), properties: { paragraphStyle: S('The paragraph style to collect (e.g. "Heading 1")'), ...objectSchema(TOC_ENTRY_OPTIONS, '').properties }, required: ['paragraphStyle'] },
                },
                replaceEntries: B('Remove the style\'s current entries before adding these'),
                epubNavigation: B('Also use this style for EPUB navigation (the TOC style in EPUB export options)'),
            },
            required: ['name'],
        },
        features: F('toc_toc_style', 'toc_title', 'toc_title_style', 'toc_include_paragraph_styles', 'toc_entry_style', 'toc_page_number',
            'toc_page_number_style', 'toc_between_entry_and_number', 'toc_sort_entries_in_alphabetical_order', 'toc_level',
            'toc_create_pdf_bookmarks', 'toc_run_in', 'toc_include_text_on_hidden_layers', 'toc_include_book_documents',
            'toc_make_text_anchor_in_source_paragraph', 'toc_remove_forced_line_break', 'toc_numbered_paragraphs', 'toc_frame_direction',
            'toc_planning', 'multiple_tocs', 'export_tocs'),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { entries: [{ paragraphStyle: 'Heading 1', level: 1, pageNumber: 'AFTER_ENTRY', separator: '^t' }] },
        handler: (a) => {
            const name = nameLit(a.name, 'name');
            const lines = optionLines('st', a.options, TOC_STYLE_OPTIONS, 'options');
            if (given(a.entries) && !Array.isArray(a.entries)) throw new Error("'entries' must be a list");
            const entryKeys = new Set(['paragraphStyle', ...TOC_ENTRY_OPTIONS.map((o) => o.key)]);
            const entries = (a.entries ?? []).map((e, i) => {
                if (!e || typeof e !== 'object') throw new Error(`'entries[${i}]' must be an object`);
                const { paragraphStyle, ...rest } = e;
                for (const k of Object.keys(rest)) if (!entryKeys.has(k)) throw new Error(`Unknown option 'entries[${i}].${k}'. Allowed: ${[...entryKeys].join(', ')}`);
                return [
                    `var ps = __ldStyle(doc, "p", ${nameLit(paragraphStyle, `entries[${i}].paragraphStyle`)});`,
                    'var en = st.tocStyleEntries.itemByName(ps.name);',
                    'if (!en.isValid) en = st.tocStyleEntries.add(ps.name);',
                    ...optionLines('en', rest, TOC_ENTRY_OPTIONS, `entries[${i}]`),
                ].join('\n');
            });
            return run('Define TOC style', ld(`
var st = doc.tocStyles.itemByName(${name}), created = false;
if (!st.isValid) { st = doc.tocStyles.add({ name: ${name} }); created = true; }
${lines.join('\n')}
${a.replaceEntries ? 'for (var r = st.tocStyleEntries.length - 1; r >= 0; r--) st.tocStyleEntries[r].remove();' : ''}
${entries.join('\n')}
${a.epubNavigation ? 'doc.epubExportPreferences.tocStyleName = st.name;' : ''}
${given(a.newName) ? `st.name = ${nameLit(a.newName, 'newName')};` : ''}
var ents = [];
for (var e = 0; e < st.tocStyleEntries.length; e++) {
  var x = st.tocStyleEntries[e];
  ents.push({ paragraphStyle: x.name, level: x.level, entryStyle: __ldName(x.formatStyle), pageNumber: __enumName(x.pageNumberPosition) });
}
__result__ = { name: st.name, created: created, title: st.title, createBookmarks: st.createBookmarks, entries: ents };`));
        },
    },
    {
        name: 'create_toc',
        description: 'Generate a table of contents from a TOC style and place it on a page, or update the one already in the document (Layout > Table of Contents, Layout > Update Table of Contents). Can take entries from every document of a book and make the table interactive (PDF bookmarks and links).',
        inputSchema: {
            type: 'object',
            properties: {
                style: S('TOC style name (default "[Default]")'),
                replaceExisting: B('Update (replace) the table of contents already generated with this style'),
                ...PLACEMENT_PROPS,
                bookPath: S('Build the table from every document of this book (.indb); the book is opened if needed'),
                includeOverset: B('Include entries from overset text'),
                interactive: B('Make the table interactive: PDF bookmarks and anchors to the source paragraphs, and turn on bookmarks and hyperlinks in PDF export'),
            },
        },
        features: F('table_of_contents', 'update_toc', 'toc_interactivity', 'toc_planning'),
        hints: { readOnly: false },
        auditArgs: { style: '[Default]' },
        handler: (a) => {
            const style = nameLit(a.style ?? '[Default]', 'style');
            const book = given(a.bookPath) ? `__ldBook(${pathLit(a.bookPath, 'bookPath')})` : 'undefined';
            return run('Create table of contents', ld(`
var st = __ldNamed(doc.tocStyles, ${style}, "TOC style");
${a.interactive ? 'st.createBookmarks = true;\nst.makeAnchor = true;\napp.pdfExportPreferences.includeBookmarks = true;\napp.pdfExportPreferences.includeHyperlinks = true;' : ''}
${placement(a)}
var stories = doc.createTOC(st, ${bool(a.replaceExisting)}, ${book}, pt, ${bool(a.includeOverset)}, layer);
var out = [];
for (var i = 0; i < stories.length; i++) {
  var s = stories[i], frames = [];
  for (var j = 0; j < s.textContainers.length; j++) frames.push(s.textContainers[j].id);
  out.push({ storyId: s.id, frameIds: frames, characters: s.characters.length, overset: s.overflows });
}
__result__ = { style: st.name, stories: out };`));
        },
    },

    // ------------------------------------------------- footnotes and endnotes
    {
        name: 'set_note_options',
        description: 'Set footnote and endnote options: numbering, prefix and suffix, reference and text styles, separator, spacing, rules, and the endnote header, scope and frame (Type > Document Footnote Options, Type > Document Endnote Options); and whether Word footnotes and endnotes come in on import (Word Import Options).',
        inputSchema: {
            type: 'object',
            properties: {
                footnotes: objectSchema(FOOTNOTE_OPTIONS, 'Footnote options; only the ones given change'),
                endnotes: objectSchema(ENDNOTE_OPTIONS, 'Endnote options; only the ones given change'),
                wordImport: objectSchema(WORD_IMPORT_OPTIONS, 'Word and RTF import options for notes (application preferences)'),
            },
        },
        features: [
            ...F('fn_num_style_footnote_numbering', 'fn_num_start_at_footnotes', 'fn_num_restart_numbering_every', 'fn_num_show_prefix_suffix_in',
                'fn_num_prefix_footnote', 'fn_num_suffix_footnote', 'fn_num_position_reference_number', 'fn_num_character_style_reference_number',
                'fn_num_paragraph_style_footnote', 'fn_num_separator', 'fn_layout_minimum_space_before_first_footnote', 'fn_layout_space_between_footnotes',
                'fn_layout_first_baseline_offset_footnote', 'fn_layout_place_end_of_story_footnotes_at_bottom_of_text', 'fn_layout_allow_split_footnotes',
                'fn_layout_span_footnotes_across_columns', 'fn_layout_rule_above_first_footnote_in_column', 'fn_layout_rule_above_continued_footnotes'),
            ...F('en_style_endnote_numbering', 'en_start_at_endnotes', 'en_restart_every_endnotes', 'en_show_prefix_suffix_endnote',
                'en_position_endnote_reference', 'en_character_style_endnote_reference', 'en_paragraph_style_endnote', 'en_separator_endnote',
                'en_endnote_header', 'en_scope', 'en_endnote_frame'),
            ...F('document_footnote_options', 'document_endnote_options', 'import_word_footnotes'),
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            footnotes: { numberingStyle: 'ARABIC', startAt: 1, separator: '^t', ruleAbove: { on: true, weight: 0.5, color: 'Black' } },
            endnotes: { title: 'Notes', scope: 'ENDNOTE_DOCUMENT_SCOPE' },
        },
        handler: (a) => {
            const fn = optionLines('fo', a.footnotes, FOOTNOTE_OPTIONS, 'footnotes');
            const en = optionLines('eo', a.endnotes, ENDNOTE_OPTIONS, 'endnotes');
            const wi = optionLines('wp', a.wordImport, WORD_IMPORT_OPTIONS, 'wordImport');
            if (!fn.length && !en.length && !wi.length) throw new Error('Nothing to set: give footnotes, endnotes or wordImport options');
            return run('Set note options', ld(`
var fo = doc.footnoteOptions, eo = doc.endnoteOptions, wp = app.wordRTFImportPreferences;
${[...fn, ...en, ...wi].join('\n')}
__result__ = {
  footnotes: { numberingStyle: __enumName(fo.footnoteNumberingStyle), startAt: fo.startAt, restartNumbering: __enumName(fo.restartNumbering), separator: fo.separatorText, paragraphStyle: __ldName(fo.footnoteTextStyle), ruleAbove: fo.ruleOn },
  endnotes: { numberingStyle: __enumName(eo.endnoteNumberingStyle), startAt: eo.startEndnoteNumberAt, title: eo.endnoteTitle, scope: __enumName(eo.scopeValue), frame: __enumName(eo.frameCreateOption) },
  wordImport: { importFootnotes: wp.importFootnotes, importEndnotes: wp.importEndnotes, importAsStaticEndnotes: wp.importAsStaticEndnotes }
};`));
        },
    },
    {
        name: 'insert_note',
        description: 'Insert a footnote or an endnote at a point in text, with its text (Type > Insert Footnote, Type > Insert Endnote). The reference number goes at the point; the note text follows the document\'s note options.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: E(['footnote', 'endnote'], 'Footnote (at the bottom of the column) or endnote (collected at the end)'),
                at: textSchema('Where the reference goes: after the chosen text unless before is true', { insertion: true }),
                text: S('The note text'),
            },
            required: ['kind', 'at'],
        },
        features: F('footnote', 'insert_footnote', 'endnote', 'insert_endnote'),
        hints: { readOnly: false },
        auditArgs: { at: { find: 'Sample' } },
        handler: (a) => {
            const kind = enumOf(a.kind, ['footnote', 'endnote'], { name: 'kind' });
            const at = textSpec(a.at, 'at');
            const body = given(a.text) ? text(a.text, 'text', { max: 100000 }) : null;
            const add = kind === 'footnote'
                ? `var note = ip.footnotes.add();\n${body ? `note.insertionPoints.lastItem().contents = ${body};` : ''}`
                : `var note = ip.createEndnote();\n${body ? `note.insertTextInEndnote(note.insertionPoints.lastItem(), ${body});` : ''}`;
            return run(`Insert ${kind}`, ld(`
var ip = __ldPoint(doc, ${at});
${add}
__result__ = { kind: "${kind}", id: note.id, storyId: ip.parentStory.id, page: __ldPageName(ip), text: __ldSnippet(note.texts[0].contents) };`));
        },
    },
    {
        name: 'manage_notes',
        description: 'Work with existing footnotes and endnotes: convert footnotes to endnotes or back (Type > Convert Footnote and Endnote), turn footnotes into ordinary text, delete notes, or go to a note\'s reference or text (Go to Footnote Reference / Go to Endnote Reference). Note ids come from get_long_document_info.',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(NOTE_ACTIONS, 'What to do. Conversions move each note\'s plain text (local formatting is not kept) and keep its reference position'),
                kind: E(['footnote', 'endnote'], 'Which notes delete, show_reference and show_text act on'),
                ids: { type: 'array', items: { type: 'integer' }, description: 'Note ids; for conversions and delete, absent means every note in scope' },
                storyId: I('Limit to the notes of one story'),
            },
            required: ['action'],
        },
        features: F('convert_footnote_endnote', 'go_to_footnote', 'context_go_to_endnote_reference', 'footnote', 'endnote'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { ids: [1] },
        handler: (a) => {
            const action = enumOf(a.action, NOTE_ACTIONS, { name: 'action' });
            let ids = 'null';
            if (given(a.ids)) {
                if (!Array.isArray(a.ids) || !a.ids.length) throw new Error("'ids' must list note ids");
                ids = `[${a.ids.map((v, i) => integer(v, `ids[${i}]`)).join(', ')}]`;
            }
            let kind = { convert_to_endnotes: 'footnote', convert_to_footnotes: 'endnote', convert_to_text: 'footnote' }[action];
            if (!kind) kind = enumOf(a.kind, ['footnote', 'endnote'], { name: 'kind' });
            if (action.startsWith('show_') && (ids === 'null' || a.ids.length !== 1)) throw new Error(`'${action}' needs exactly one note id in 'ids'`);
            if (action === 'delete' && ids === 'null' && !given(a.storyId)) throw new Error("'delete' needs 'ids' or 'storyId'");
            const coll = kind === 'footnote' ? 'footnotes' : 'endnotes';
            const per = {
                convert_to_endnotes: 'var ip = n.storyOffset, body = __ldNoteBody(n.texts[0].contents);\nvar made = ip.createEndnote();\nif (body) made.insertTextInEndnote(made.insertionPoints.lastItem(), body);\nn.remove();\nout.push({ from: id, to: made.id });',
                convert_to_footnotes: 'var ip = n.storyOffset, body = __ldNoteBody(n.texts[0].contents);\nvar made = ip.footnotes.add();\nif (body) made.insertionPoints.lastItem().contents = body;\nn.deleteEndnote();\nout.push({ from: id, to: made.id });',
                convert_to_text: 'n.convertToText();\nout.push({ id: id });',
                delete: kind === 'footnote' ? 'n.remove();\nout.push({ id: id });' : 'n.deleteEndnote();\nout.push({ id: id });',
                show_reference: 'n.storyOffset.showText();\nout.push({ id: id, page: __ldPageName(n.storyOffset) });',
                show_text: 'n.texts[0].showText();\nout.push({ id: id });',
            }[action];
            const stories = given(a.storyId)
                ? `var one = doc.stories.itemByID(${integer(a.storyId, 'storyId')});\nif (!one.isValid) throw new Error("No story with that id");\nvar stories = [one];`
                : 'var stories = doc.stories.everyItem().getElements();';
            return run('Manage notes', ld(`
var ids = ${ids}, out = [];
${stories}
for (var s = 0; s < stories.length; s++) {
  var notes = stories[s].${coll};
  for (var i = notes.length - 1; i >= 0; i--) {
    var n = notes[i], id = n.id;
    if (!__ldIn(ids, id)) continue;
    ${per}
  }
}
if (ids !== null && out.length < ids.length) throw new Error("Some ${kind} ids were not found" + (out.length ? " (done: " + out.length + ")" : ""));
__result__ = { action: "${action}", kind: "${kind}", notes: out.reverse() };`));
        },
    },

    // -------------------------------------------------------------- the index
    {
        name: 'manage_index',
        description: 'Build the index (Window > Type & Tables > Index): add topics, page references and cross-references (New Page Reference, New Cross-reference), index selected text as a topic or a proper name (Last, First), duplicate, delete or capitalize topics, remove unused topics, import topics from another document, update the preview, go to a page reference\'s marker, and set sort options.',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(INDEX_ACTIONS, 'What to do'),
                topic: NAMES('Topic path, top level first, up to 4 levels (e.g. ["Fruit", "Apples"]). Created when missing for add_* actions; for index_text, the parent topic of the new entry'),
                sortOrder: S('add_topic, add_page_reference: sort the new topic as this text instead of its name'),
                text: textSchema('add_page_reference: the text the reference marks (a marker goes before it); index_text: the text to index'),
                referenceType: E(INDEX_REF_TYPES, 'Page reference range (default CURRENT_PAGE)'),
                referenceCount: I('FOR_NEXT_N_PARAGRAPHS / FOR_NEXT_N_PAGES: how many', 1),
                referenceStyle: S('TO_NEXT_USE_OF_STYLE: the paragraph style that ends the range'),
                pageNumberStyle: S('Character style for this reference\'s page number (number style override)'),
                properName: B('index_text: index a name as "Last, First"'),
                crossReferenceType: E(INDEX_XREF_TYPES, 'add_cross_reference: the kind (default SEE)'),
                referencedTopic: NAMES('add_cross_reference: the topic path referred to (created when missing)'),
                customText: S('add_cross_reference with a CUSTOM_* type: the custom text'),
                newName: S('duplicate_topic: the copy\'s name (default "<name> copy")'),
                capitalization: E(INDEX_CAPS, 'capitalize: which entries; with a topic, SELECTED_ENTRY or INCLUDE_SUBENTRIES (default ALL_ENTRIES)'),
                filePath: S('import_topics: an InDesign document whose index topics to import'),
                referenceIndex: I('show_page_reference: which of the topic\'s page references, 0-based (default 0)'),
                sortOptions: {
                    type: 'array',
                    description: 'set_sort_options: index sort groups to change',
                    items: {
                        type: 'object',
                        properties: {
                            name: S('Sort group name as InDesign lists it (e.g. "Symbol", "Numeric", "Roman", "Greek", "Cyrillic")'),
                            include: B('Include this group'),
                            priority: I('Sort priority, 0 first'),
                            headerType: E(HEADER_TYPES, 'Header type for the group'),
                        },
                    },
                },
            },
            required: ['action'],
        },
        features: F('index_panel', 'index_object', 'topic', 'index_cross_reference', 'index_menu_new_page_reference', 'index_menu_new_cross_reference',
            'index_menu_duplicate_topic', 'index_menu_delete_topic', 'index_menu_go_to_selected_marker', 'index_menu_update_preview',
            'index_menu_import_topics', 'index_menu_remove_unused_topics', 'index_menu_capitalize', 'index_menu_sort_options', 'index_sort_options',
            'page_reference', 'new_page_reference', 'quick_index_entry', 'proper_name_index_entry'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { topic: ['Fruit'] },
        handler: (a) => {
            const action = enumOf(a.action, INDEX_ACTIONS, { name: 'action' });
            const needTopic = () => topicPath(a.topic, 'topic');
            const sortOrder = given(a.sortOrder) ? text(a.sortOrder, 'sortOrder', { max: 300 }) : 'null';
            const refLines = () => {
                const type = enumOf(a.referenceType ?? 'CURRENT_PAGE', INDEX_REF_TYPES, { name: 'referenceType' });
                const out = [`var pr = t.pageReferences.add(src, PageReferenceType.${type});`];
                if (type === 'FOR_NEXT_N_PARAGRAPHS' || type === 'FOR_NEXT_N_PAGES') out.push(`pr.pageReferenceLimit = ${integer(a.referenceCount ?? 1, 'referenceCount', 1, 10000)};`);
                if (type === 'TO_NEXT_USE_OF_STYLE') out.push(`pr.pageReferenceLimit = __ldStyle(doc, "p", ${nameLit(a.referenceStyle, 'referenceStyle')});`);
                if (given(a.pageNumberStyle)) out.push(`pr.pageNumberStyleOverride = __ldStyle(doc, "c", ${nameLit(a.pageNumberStyle, 'pageNumberStyle')});`);
                out.push('out.page = __ldPageName(src);');
                return out.join('\n');
            };
            let body;
            switch (action) {
                case 'add_topic':
                    body = `var t = __ldTopic(ix, ${needTopic()}, true, ${sortOrder});\nout.topic = t.name;`;
                    break;
                case 'add_page_reference':
                    body = `var src = __ldText(doc, ${textSpec(a.text, 'text')});\nvar t = __ldTopic(ix, ${needTopic()}, true, ${sortOrder});\n${refLines()}\nout.topic = t.name;`;
                    break;
                case 'index_text': {
                    const parent = given(a.topic) ? `__ldTopic(ix, ${needTopic()}, true, null)` : 'ix';
                    body = `var src = __ldText(doc, ${textSpec(a.text, 'text')});
var name = String(src.contents).replace(/^\\s+|\\s+$/g, "");
if (!name) throw new Error("The chosen text is empty");
${a.properName ? 'var parts = name.split(/\\s+/);\nif (parts.length > 1) name = parts.pop() + ", " + parts.join(" ");' : ''}
var parent = ${parent};
var t = parent.topics.itemByName(name);
if (!t.isValid) t = parent.topics.add(name);
${refLines()}
out.topic = t.name;`;
                    break;
                }
                case 'add_cross_reference': {
                    const type = enumOf(a.crossReferenceType ?? 'SEE', INDEX_XREF_TYPES, { name: 'crossReferenceType' });
                    const custom = given(a.customText) ? text(a.customText, 'customText', { max: 300 }) : '""';
                    body = `var t = __ldTopic(ix, ${needTopic()}, true, null);
var target = __ldTopic(ix, ${topicPath(a.referencedTopic, 'referencedTopic')}, true, null);
var xr = t.crossReferences.add(target, CrossReferenceType.${type}, ${custom});
out.topic = t.name;
out.crossReference = __enumName(xr.crossReferenceType) + " " + target.name;`;
                    break;
                }
                case 'duplicate_topic':
                    body = `var t = __ldTopic(ix, ${needTopic()}, false, null);
var parent = t.parent;
var copyName = ${given(a.newName) ? nameLit(a.newName, 'newName') : 't.name + " copy"'};
if (parent.topics.itemByName(copyName).isValid) throw new Error("A topic named " + copyName + " already exists there");
var c = t.sortOrder ? parent.topics.add(copyName, t.sortOrder) : parent.topics.add(copyName);
for (var r = 0; r < t.pageReferences.length; r++) {
  var p = t.pageReferences[r];
  var q = c.pageReferences.add(p.sourceText, p.pageReferenceType);
  try { q.pageReferenceLimit = p.pageReferenceLimit; } catch (e1) {}
  try { if (p.pageNumberStyleOverride) q.pageNumberStyleOverride = p.pageNumberStyleOverride; } catch (e2) {}
}
for (var x = 0; x < t.crossReferences.length; x++) {
  var cr = t.crossReferences[x];
  c.crossReferences.add(cr.referencedTopic, cr.crossReferenceType, cr.customTypeString);
}
out.topic = c.name;
out.pageReferences = c.pageReferences.length;`;
                    break;
                case 'delete_topic':
                    body = `var t = __ldTopic(ix, ${needTopic()}, false, null);\nout.topic = t.name;\nt.remove();`;
                    break;
                case 'capitalize': {
                    const cap = enumOf(a.capitalization ?? (given(a.topic) ? 'SELECTED_ENTRY' : 'ALL_ENTRIES'), INDEX_CAPS, { name: 'capitalization' });
                    body = given(a.topic)
                        ? `var t = __ldTopic(ix, ${needTopic()}, false, null);\nt.capitalize(IndexCapitalizationOptions.${cap});\nout.topic = t.name;`
                        : `ix.capitalize(IndexCapitalizationOptions.${cap});`;
                    break;
                }
                case 'remove_unused_topics':
                    body = 'var before = ix.allTopics.length;\nix.removeUnusedTopics();\nout.removed = before - ix.allTopics.length;';
                    break;
                case 'import_topics':
                    body = `var f = File(${pathLit(a.filePath, 'filePath')});\nif (!f.exists) throw new Error("File not found: " + f.fsName);\nvar before = ix.allTopics.length;\nix.importTopics(f);\nout.imported = ix.allTopics.length - before;`;
                    break;
                case 'update_preview':
                    body = 'ix.update();';
                    break;
                case 'show_page_reference':
                    body = `var t = __ldTopic(ix, ${needTopic()}, false, null);
var k = ${given(a.referenceIndex) ? integer(a.referenceIndex, 'referenceIndex') : '0'};
if (k >= t.pageReferences.length) throw new Error("Topic " + t.name + " has " + t.pageReferences.length + " page references");
var src = t.pageReferences[k].sourceText;
src.showText();
out.topic = t.name;
out.page = __ldPageName(src);`;
                    break;
                case 'set_sort_options': {
                    if (!Array.isArray(a.sortOptions) || !a.sortOptions.length) throw new Error("'sortOptions' must list sort groups");
                    body = a.sortOptions.map((o, i) => {
                        const lines = [`var so = __ldNamed(doc.indexingSortOptions, ${nameLit(o?.name, `sortOptions[${i}].name`)}, "index sort group");`];
                        if (given(o.include)) lines.push(`so.include = ${bool(o.include === true)};`);
                        if (given(o.priority)) lines.push(`so.priority = ${integer(o.priority, `sortOptions[${i}].priority`, 0, 1000)};`);
                        if (given(o.headerType)) lines.push(`so.headerType = HeaderTypes.${enumOf(o.headerType, HEADER_TYPES, { name: `sortOptions[${i}].headerType` })};`);
                        return lines.join('\n');
                    }).join('\n') + '\nvar all = [];\nfor (var g = 0; g < doc.indexingSortOptions.length; g++) { var o = doc.indexingSortOptions[g]; all.push({ name: o.name, include: o.include, priority: o.priority }); }\nout.sortOptions = all;';
                    break;
                }
            }
            return run('Manage index', ld(`
var ix = __ldIndex(doc), out = { action: "${action}" };
${body}
out.topics = ix.allTopics.length;
__result__ = out;`));
        },
    },
    {
        name: 'generate_index',
        description: 'Generate the index from its topics and place it on a page, or replace the index already generated (Index panel menu > Generate Index): title and title style, nested or run-in, section headings, level, heading, page number and cross-reference styles, and every separator.',
        inputSchema: {
            type: 'object',
            properties: {
                options: objectSchema(INDEX_OPTIONS, 'Generate Index options; only the ones given change'),
                ...PLACEMENT_PROPS,
                autoflow: B('Add pages and frames until the whole index is placed'),
                includeOverset: B('Include entries in overset text'),
            },
        },
        features: F('index_menu_generate_index', 'gen_index_title_index', 'gen_index_title_style_index', 'gen_index_replace_existing_index',
            'gen_index_include_book_documents_index', 'gen_index_include_entries_on_hidden_layers', 'gen_index_nested_or_run_in',
            'gen_index_include_index_section_headings', 'gen_index_include_empty_index_sections', 'gen_index_level_style',
            'gen_index_section_heading_style', 'gen_index_page_number_style', 'gen_index_cross_reference_style', 'gen_index_following_topic_separator',
            'gen_index_between_page_numbers', 'gen_index_between_entries', 'gen_index_before_cross_reference', 'gen_index_page_range_separator',
            'gen_index_entry_end', 'index_object'),
        hints: { readOnly: false },
        auditArgs: { options: { title: 'Index', format: 'NESTED_FORMAT', level1Style: 'Index Level 1', pageRangeSeparator: '^=' }, layer: 'Layer 1' },
        handler: (a) => {
            const lines = optionLines('io', a.options, INDEX_OPTIONS, 'options');
            return run('Generate index', ld(`
var ix = __ldIndex(doc), io = doc.indexGenerationOptions;
if (!ix.allTopics.length) throw new Error("The index has no topics; add some with manage_index first");
${lines.join('\n')}
${placement(a)}
var stories = ix.generate(page, pt, layer, ${bool(a.autoflow)}, ${bool(a.includeOverset)});
var out = [];
for (var i = 0; i < stories.length; i++) {
  var s = stories[i], frames = [];
  for (var j = 0; j < s.textContainers.length; j++) frames.push(s.textContainers[j].id);
  out.push({ storyId: s.id, frameIds: frames, overset: s.overflows });
}
__result__ = { topics: ix.allTopics.length, format: __enumName(io.indexFormat), stories: out };`));
        },
    },

    // ------------------------------------------------------- conditional text
    {
        name: 'manage_conditions',
        description: 'Manage conditional text (Window > Type & Tables > Conditional Text): create, change and delete conditions and their indicators, show or hide all, show, hide or print indicators, load conditions and sets from another document, and create, redefine, activate and delete condition sets.',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(CONDITION_ACTIONS, 'What to do'),
                name: S('The condition (create, edit, delete) or condition set (*_set actions)'),
                newName: S('edit, redefine_set: a new name'),
                options: objectSchema(CONDITION_OPTIONS, 'create, edit: condition options'),
                replaceWith: S('delete: give the deleted condition\'s text this condition instead of none'),
                indicators: E(['SHOW_INDICATORS', 'HIDE_INDICATORS', 'SHOW_AND_PRINT_INDICATORS'], 'set_indicators: show, hide, or show and print the indicators'),
                filePath: S('load: an InDesign document to load conditions from'),
                includeSets: B('load: also load its condition sets'),
                visibility: {
                    type: 'array',
                    description: 'create_set, redefine_set: condition visibility to record in the set; other conditions keep their current visibility',
                    items: { type: 'object', properties: { condition: S('Condition name'), visible: B('Shown in this set') } },
                },
            },
            required: ['action'],
        },
        features: F('conditional_text_panel', 'condition', 'condition_sets', 'conditional_text_menu_new_condition', 'conditional_text_menu_condition_options',
            'conditional_text_menu_delete_condition', 'conditional_text_menu_load_conditions', 'conditional_text_menu_load_conditions_and_sets',
            'conditional_text_menu_show_all', 'conditional_text_menu_hide_all', 'conditional_text_menu_hide_indicators',
            'conditional_text_menu_show_indicators', 'conditional_text_menu_show_and_print_indicators'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { name: 'Print only', options: { visible: true, indicatorColor: 'LIGHT_BLUE', indicatorMethod: 'USE_HIGHLIGHT' } },
        handler: (a) => {
            const action = enumOf(a.action, CONDITION_ACTIONS, { name: 'action' });
            const name = () => nameLit(a.name, 'name');
            const visibility = () => {
                if (!given(a.visibility)) return '';
                if (!Array.isArray(a.visibility)) throw new Error("'visibility' must be a list");
                return a.visibility.map((v, i) => `__ldNamed(doc.conditions, ${nameLit(v?.condition, `visibility[${i}].condition`)}, "condition").visible = ${bool(v.visible === true)};`).join('\n');
            };
            const rename = (v) => (given(a.newName) ? `${v}.name = ${nameLit(a.newName, 'newName')};` : '');
            let body;
            switch (action) {
                case 'create': {
                    const lines = optionLines('c', a.options, CONDITION_OPTIONS, 'options');
                    body = `if (doc.conditions.itemByName(${name()}).isValid) throw new Error("A condition named " + ${name()} + " already exists");\nvar c = doc.conditions.add({ name: ${name()} });\n${lines.join('\n')}\nout.condition = c.name;`;
                    break;
                }
                case 'edit': {
                    const lines = optionLines('c', a.options, CONDITION_OPTIONS, 'options');
                    if (!lines.length && !given(a.newName)) throw new Error("'edit' needs options or newName");
                    body = `var c = __ldNamed(doc.conditions, ${name()}, "condition");\n${lines.join('\n')}\n${rename('c')}\nout.condition = c.name;`;
                    break;
                }
                case 'delete':
                    body = `var c = __ldNamed(doc.conditions, ${name()}, "condition");\n${given(a.replaceWith) ? `c.remove(__ldNamed(doc.conditions, ${nameLit(a.replaceWith, 'replaceWith')}, "condition"));` : 'c.remove();'}\nout.deleted = ${name()};`;
                    break;
                case 'show_all':
                case 'hide_all':
                    body = `for (var i = 0; i < doc.conditions.length; i++) doc.conditions[i].visible = ${bool(action === 'show_all')};\nout.conditions = doc.conditions.length;`;
                    break;
                case 'set_indicators':
                    body = `doc.conditionalTextPreferences.showConditionIndicators = ConditionIndicatorMode.${enumOf(a.indicators, ['SHOW_INDICATORS', 'HIDE_INDICATORS', 'SHOW_AND_PRINT_INDICATORS'], { name: 'indicators' })};`;
                    break;
                case 'load':
                    body = `var f = File(${pathLit(a.filePath, 'filePath')});\nif (!f.exists) throw new Error("File not found: " + f.fsName);\ndoc.loadConditions(f, ${bool(a.includeSets)});\nout.conditions = doc.conditions.length;\nout.sets = doc.conditionSets.length;`;
                    break;
                case 'create_set':
                    body = `if (doc.conditionSets.itemByName(${name()}).isValid) throw new Error("A condition set named " + ${name()} + " already exists");\n${visibility()}\nvar cs = doc.conditionSets.add({ name: ${name()} });\nout.set = cs.name;`;
                    break;
                case 'redefine_set':
                    body = `var cs = __ldNamed(doc.conditionSets, ${name()}, "condition set");\n${visibility()}\ncs.redefine();\n${rename('cs')}\nout.set = cs.name;`;
                    break;
                case 'activate_set':
                    body = `var cs = __ldNamed(doc.conditionSets, ${name()}, "condition set");\ndoc.conditionalTextPreferences.activeConditionSet = cs;\nout.set = cs.name;`;
                    break;
                case 'delete_set':
                    body = `var cs = __ldNamed(doc.conditionSets, ${name()}, "condition set");\ncs.remove();\nout.deleted = ${name()};`;
                    break;
            }
            return run('Manage conditions', ld(`
var out = { action: "${action}" };
${body}
out.indicators = __enumName(doc.conditionalTextPreferences.showConditionIndicators);
__result__ = out;`));
        },
    },
    {
        name: 'apply_conditions',
        description: 'Apply conditions to text, add or remove some, or clear them all (Conditional Text panel; Remove Condition from selection). Text whose conditions are all hidden disappears from the layout.',
        inputSchema: {
            type: 'object',
            properties: {
                text: textSchema('The text to change'),
                conditions: NAMES('Condition names'),
                mode: E(['apply', 'add', 'remove', 'clear'], 'apply: exactly these conditions; add: keep existing ones too; remove: take these off; clear: remove every condition (default apply)'),
            },
            required: ['text'],
        },
        features: F('conditional_text_menu_remove_condition_from_selection', 'conditional_text_panel', 'condition'),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { text: { find: 'Sample' }, conditions: ['Print only'] },
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'apply', ['apply', 'add', 'remove', 'clear'], { name: 'mode' });
            const spec = textSpec(a.text, 'text');
            const names = mode === 'clear' ? '[]' : nameList(a.conditions, 'conditions');
            const apply = {
                apply: 't.applyConditions(conds, true);',
                add: 't.applyConditions(conds, false);',
                remove: 'var cur = t.appliedConditions, keep = [];\nif (cur instanceof Array) for (var k = 0; k < cur.length; k++) if (!__ldIn(names, cur[k].name)) keep.push(cur[k]);\nt.applyConditions(keep, true);',
                clear: 't.applyConditions([], true);',
            }[mode];
            return run('Apply conditions', ld(`
var t = __ldText(doc, ${spec});
var names = ${names}, conds = [];
for (var i = 0; i < names.length; i++) conds.push(__ldNamed(doc.conditions, names[i], "condition"));
${apply}
var now = t.appliedConditions, list = [];
if (now instanceof Array) for (var j = 0; j < now.length; j++) list.push(now[j].name);
__result__ = { mode: "${mode}", conditions: list, text: __ldSnippet(t.contents) };`));
        },
    },

    // --------------------------------- hyperlinks, cross-references, bookmarks
    {
        name: 'manage_cross_reference_formats',
        description: 'Create, change, delete or load cross-reference formats and their building blocks: paragraph text or number, page or chapter number, file or bookmark name, custom text, each with an optional character style (Hyperlinks panel menu > Define Cross-Reference Formats, Load Cross-Reference Formats).',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(['create', 'edit', 'delete', 'load'], 'What to do'),
                name: S('Format name'),
                newName: S('edit: a new name'),
                characterStyle: S('create, edit: character style for the whole cross-reference'),
                blocks: {
                    type: 'array',
                    description: 'create, edit: the format\'s building blocks in order (edit replaces them all), e.g. [{type:"custom_text",text:"see page "},{type:"page_number"}]',
                    items: {
                        type: 'object',
                        properties: {
                            type: E(Object.keys(BLOCK_TYPES), 'Building block'),
                            text: S('custom_text: the text'),
                            characterStyle: S('Character style for this block'),
                            delimiter: S('paragraph_text: stop at this character'),
                            includeDelimiter: B('paragraph_text: include the delimiter'),
                        },
                        required: ['type'],
                    },
                },
                filePath: S('load: an InDesign document to load formats from'),
            },
            required: ['action'],
        },
        features: F('cross_reference_formats', 'cross_reference_building_blocks', 'load_cross_reference_formats'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { name: 'See page', blocks: [{ type: 'custom_text', text: 'see page ' }, { type: 'page_number', characterStyle: 'Emphasis' }, { type: 'paragraph_text', delimiter: '.', includeDelimiter: false }] },
        handler: (a) => {
            const action = enumOf(a.action, ['create', 'edit', 'delete', 'load'], { name: 'action' });
            if (action === 'load') {
                return run('Load cross-reference formats', ld(`
var f = File(${pathLit(a.filePath, 'filePath')});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var before = doc.crossReferenceFormats.length;
doc.importFormats(f);
__result__ = { action: "load", formats: doc.crossReferenceFormats.length, added: doc.crossReferenceFormats.length - before };`));
            }
            const name = nameLit(a.name, 'name');
            if (action === 'delete') {
                return run('Delete cross-reference format', ld(`
var fm = __ldNamed(doc.crossReferenceFormats, ${name}, "cross-reference format");
fm.remove();
__result__ = { action: "delete", deleted: ${name} };`));
            }
            const lines = [];
            if (given(a.characterStyle)) lines.push(`fm.appliedCharacterStyle = __ldStyle(doc, "c", ${nameLit(a.characterStyle, 'characterStyle')});`);
            if (given(a.blocks)) {
                if (!Array.isArray(a.blocks) || !a.blocks.length) throw new Error("'blocks' must list building blocks");
                lines.push('for (var r = fm.buildingBlocks.length - 1; r >= 0; r--) fm.buildingBlocks[r].remove();');
                a.blocks.forEach((b, i) => {
                    const type = enumOf(b?.type, Object.keys(BLOCK_TYPES), { name: `blocks[${i}].type` });
                    lines.push(`var b = fm.buildingBlocks.add(BuildingBlockTypes.${BLOCK_TYPES[type]});`);
                    if (type === 'custom_text') lines.push(`b.customText = ${text(b.text ?? '', `blocks[${i}].text`)};`);
                    if (given(b.characterStyle)) lines.push(`b.appliedCharacterStyle = __ldStyle(doc, "c", ${nameLit(b.characterStyle, `blocks[${i}].characterStyle`)});`);
                    if (given(b.delimiter)) lines.push(`b.appliedDelimiter = ${text(b.delimiter, `blocks[${i}].delimiter`, { max: 10, empty: false })};`);
                    if (given(b.includeDelimiter)) lines.push(`b.includeDelimiter = ${bool(b.includeDelimiter === true)};`);
                });
            }
            if (given(a.newName)) lines.push(`fm.name = ${nameLit(a.newName, 'newName')};`);
            if (action === 'edit' && !lines.length) throw new Error("'edit' needs characterStyle, blocks or newName");
            const open = action === 'create'
                ? `if (doc.crossReferenceFormats.itemByName(${name}).isValid) throw new Error("A cross-reference format named " + ${name} + " already exists");\nvar fm = doc.crossReferenceFormats.add(${name});`
                : `var fm = __ldNamed(doc.crossReferenceFormats, ${name}, "cross-reference format");`;
            return run('Define cross-reference format', ld(`
${open}
${lines.join('\n')}
var blocks = [];
for (var k = 0; k < fm.buildingBlocks.length; k++) {
  var bb = fm.buildingBlocks[k];
  blocks.push({ type: __enumName(bb.blockType), text: bb.customText });
}
__result__ = { action: "${action}", name: fm.name, characterStyle: __ldName(fm.appliedCharacterStyle), blocks: blocks };`));
        },
    },
    {
        name: 'insert_cross_reference',
        description: 'Insert a cross-reference at a point in text that points to a paragraph or to a text anchor and shows it through a cross-reference format (Type > Hyperlinks & Cross-References > Insert Cross-Reference).',
        inputSchema: {
            type: 'object',
            properties: {
                at: textSchema('Where the cross-reference text goes: after the chosen text unless before is true', { insertion: true }),
                destination: {
                    type: 'object',
                    description: 'What it points to: one of paragraph or anchor',
                    properties: {
                        paragraph: textSchema('A paragraph: the paragraph holding this text'),
                        anchor: S('The name of an existing text anchor'),
                    },
                },
                format: S('Cross-reference format name (e.g. "Full Paragraph & Page Number", "Page Number")'),
                name: S('Name for the cross-reference in the Hyperlinks panel'),
            },
            required: ['at', 'destination', 'format'],
        },
        features: F('insert_cross_reference', 'cross_references_panel'),
        hints: { readOnly: false },
        auditArgs: { at: { find: 'see' }, destination: { paragraph: { find: 'Chapter 2' } }, format: 'Page Number' },
        handler: (a) => {
            const at = textSpec(a.at, 'at');
            const dest = destinationLines(a.destination, 'destination', { url: false });
            const format = nameLit(a.format, 'format');
            return run('Insert cross-reference', ld(`
var ip = __ldPoint(doc, ${at});
var fm = __ldNamed(doc.crossReferenceFormats, ${format}, "cross-reference format");
${dest}
var src = doc.crossReferenceSources.add(ip, fm);
var link = doc.hyperlinks.add(src, dest);
${given(a.name) ? `link.name = ${nameLit(a.name, 'name')};` : ''}
__result__ = { id: link.id, name: link.name, format: fm.name, text: __ldSnippet(src.sourceText.contents), page: __ldPageName(src.sourceText) };`));
        },
    },
    {
        name: 'manage_hyperlinks',
        description: 'Change existing hyperlinks and cross-references (Window > Interactive > Hyperlinks): rename, set the appearance, point to a new URL, page, anchor or paragraph (Hyperlink Options, Edit Hyperlink, Relink Cross-Reference), change a cross-reference\'s format (Cross-Reference Options), reset the source to other text, delete, go to the source or destination, update cross-references, and rename a text anchor (Hyperlink Destination Options).',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(HYPERLINK_ACTIONS, 'What to do'),
                name: S('The hyperlink or cross-reference name (rename_destination: the text anchor\'s name)'),
                id: I('The hyperlink id, instead of name'),
                newName: S('rename, rename_destination: the new name'),
                appearance: objectSchema(HYPERLINK_APPEARANCE, 'set_appearance: the source rectangle and highlight'),
                destination: {
                    type: 'object',
                    description: 'set_destination: one of url, pageIndex, anchor or paragraph',
                    properties: {
                        url: S('A URL (http:, https:, mailto: or ftp:)'),
                        pageIndex: I('A page, 0-based'),
                        anchor: S('An existing text anchor name'),
                        paragraph: textSchema('A paragraph: the paragraph holding this text (relinks a cross-reference)'),
                    },
                },
                format: S('set_format: cross-reference format name'),
                source: textSchema('reset_source: the text that becomes the hyperlink source'),
            },
            required: ['action'],
        },
        features: F('hyperlink_appearance', 'hyperlinks_menu_delete_hyperlink_cross_reference', 'hyperlinks_menu_reset_hyperlink',
            'hyperlinks_menu_rename_hyperlink', 'hyperlinks_menu_hyperlink_options', 'hyperlinks_menu_cross_reference_options',
            'hyperlinks_menu_go_to_source', 'hyperlinks_menu_go_to_destination', 'hyperlinks_menu_hyperlink_destination_options',
            'update_cross_references', 'relink_cross_reference', 'context_edit_hyperlink', 'cross_references_panel'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { id: null, name: 'Link 1', appearance: { visible: true, color: 'RED', width: 'THIN' } },
        handler: (a) => {
            const action = enumOf(a.action, HYPERLINK_ACTIONS, { name: 'action' });
            if (action === 'update_cross_references' && !given(a.name) && !given(a.id)) {
                return run('Update cross-references', ld(`
doc.updateCrossReferences();
__result__ = { action: "update_cross_references", crossReferences: doc.crossReferenceSources.length };`));
            }
            if (action === 'rename_destination') {
                return run('Rename text anchor', ld(`
var d = __ldNamed(doc.hyperlinkTextDestinations, ${nameLit(a.name, 'name')}, "text anchor");
d.name = ${nameLit(a.newName, 'newName')};
__result__ = { action: "rename_destination", name: d.name };`));
            }
            let body;
            switch (action) {
                case 'rename': body = `link.name = ${nameLit(a.newName, 'newName')};`; break;
                case 'set_appearance': {
                    const lines = optionLines('link', a.appearance, HYPERLINK_APPEARANCE, 'appearance');
                    if (!lines.length) throw new Error("'set_appearance' needs appearance options");
                    body = lines.join('\n');
                    break;
                }
                case 'set_destination':
                    body = `${destinationLines(a.destination, 'destination')}\nlink.destination = dest;`;
                    break;
                case 'set_format':
                    body = `if (link.source.constructor.name !== "CrossReferenceSource") throw new Error(link.name + " is not a cross-reference");\nlink.source.appliedFormat = __ldNamed(doc.crossReferenceFormats, ${nameLit(a.format, 'format')}, "cross-reference format");\nlink.source.update();`;
                    break;
                case 'reset_source':
                    body = `var old = link.source;\nlink.source = doc.hyperlinkTextSources.add(__ldText(doc, ${textSpec(a.source, 'source')}));\ntry { old.remove(); } catch (e) {}`;
                    break;
                case 'delete':
                    body = 'var s = link.source;\nout.deleted = link.name;\nlink.remove();\ntry { if (s && s.isValid) s.remove(); } catch (e) {}';
                    break;
                case 'show_source': body = 'link.showSource();'; break;
                case 'show_destination': body = 'link.showDestination();'; break;
                case 'update_cross_references':
                    body = 'if (link.source.constructor.name !== "CrossReferenceSource") throw new Error(link.name + " is not a cross-reference");\nlink.source.update();';
                    break;
            }
            const describe = action === 'delete' ? '' : 'out.name = link.name;\nout.source = link.source.constructor.name;\ntry { out.destination = __ldName(link.destination); } catch (e) {}';
            return run('Manage hyperlinks', ld(`
var link = __ldLink(doc, ${linkArgs(a)}), out = { action: "${action}" };
${body}
${describe}
__result__ = out;`));
        },
    },
    {
        name: 'manage_bookmarks',
        description: 'Manage PDF bookmarks (Window > Interactive > Bookmarks): add a bookmark to a page, text anchor or text, nested under another; delete, rename, go to, move (arrange and nest) and sort bookmarks by page order or name.',
        inputSchema: {
            type: 'object',
            properties: {
                action: E(BOOKMARK_ACTIONS, 'What to do'),
                name: S('The bookmark (add: the new bookmark\'s name)'),
                newName: S('rename: the new name'),
                destination: {
                    type: 'object',
                    description: 'add: one of pageIndex, anchor or text',
                    properties: {
                        pageIndex: I('A page, 0-based'),
                        anchor: S('An existing text anchor name'),
                        text: textSchema('Text: a text anchor is made at it'),
                    },
                },
                parent: S('add, sort: the parent bookmark (default: top level)'),
                position: E(['before', 'after', 'at_beginning', 'at_end'], 'move: where to move it, relative to reference'),
                reference: S('move: the bookmark to move it before or after, or into (at_beginning / at_end); absent with at_beginning / at_end means the top level'),
                sortBy: E(['page', 'name'], 'sort: page order (as the panel\'s Sort Bookmarks does) or name (default page)'),
            },
            required: ['action'],
        },
        features: F('bookmarks_menu_new_bookmark', 'bookmarks_menu_delete_bookmark', 'bookmarks_menu_rename_bookmark',
            'bookmarks_menu_go_to_selected_bookmark', 'bookmarks_menu_sort_bookmarks', 'bookmarks_panel', 'bookmark_sort_arrange'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { name: 'Chapter 1', destination: { pageIndex: 0 }, parent: null },
        handler: (a) => {
            const action = enumOf(a.action, BOOKMARK_ACTIONS, { name: 'action' });
            const find = (v, label) => `var __bm = __ldBookmark(doc.bookmarks, ${nameLit(v, label)});\nif (!__bm) throw new Error("No bookmark named " + ${nameLit(v, label)});`;
            const parentRef = given(a.parent) ? `${find(a.parent, 'parent')}\nvar parentRef = __bm, coll = __bm.bookmarks;` : 'var parentRef = doc, coll = doc.bookmarks;';
            let body;
            switch (action) {
                case 'add': {
                    const d = a.destination ?? {};
                    const dest = given(d.pageIndex) && Object.keys(d).filter((k) => given(d[k])).length === 1
                        ? `var dest = __page(doc, ${integer(d.pageIndex, 'destination.pageIndex', 0, 100000)});`
                        : destinationLines(d, 'destination', { url: false, paragraph: false, text: true });
                    body = `${parentRef}\n${dest}\nvar bm = coll.add(dest);\nbm.name = ${nameLit(a.name, 'name')};\nout.name = bm.name;\nout.indent = bm.indent;`;
                    break;
                }
                case 'delete': body = `${find(a.name, 'name')}\n__bm.remove();\nout.deleted = ${nameLit(a.name, 'name')};`; break;
                case 'rename': body = `${find(a.name, 'name')}\n__bm.name = ${nameLit(a.newName, 'newName')};\nout.name = __bm.name;`; break;
                case 'show': body = `${find(a.name, 'name')}\n__bm.showBookmark();\nout.name = __bm.name;`; break;
                case 'move': {
                    const pos = enumOf(a.position, ['before', 'after', 'at_beginning', 'at_end'], { name: 'position' });
                    if ((pos === 'before' || pos === 'after') && !given(a.reference)) throw new Error(`'${pos}' needs reference`);
                    const ref = given(a.reference)
                        ? `var ref = __ldBookmark(doc.bookmarks, ${nameLit(a.reference, 'reference')});\nif (!ref) throw new Error("No bookmark named " + ${nameLit(a.reference, 'reference')});`
                        : 'var ref = doc;';
                    body = `${find(a.name, 'name')}\n${ref}\n__bm.move(LocationOptions.${pos.toUpperCase()}, ref);\nout.name = __bm.name;\nout.indent = __bm.indent;`;
                    break;
                }
                case 'sort': {
                    const by = enumOf(a.sortBy ?? 'page', ['page', 'name'], { name: 'sortBy' });
                    body = `${parentRef}
var items = coll.everyItem().getElements(), keyed = [];
for (var i = 0; i < items.length; i++) {
  var key = 999999;
  ${by === 'name' ? 'key = String(items[i].name).toLowerCase();' : `try {
    var d = items[i].destination;
    if (d.hasOwnProperty("documentOffset")) key = d.documentOffset;
    else if (d.hasOwnProperty("destinationPage")) key = d.destinationPage.documentOffset;
    else if (d.hasOwnProperty("destinationText")) { var p = __ldPageIndex(d.destinationText); if (p !== null) key = p; }
  } catch (e) {}`}
  keyed.push({ key: key, at: i, bm: items[i] });
}
keyed.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : x.at - y.at; });
var order = [];
for (var j = 0; j < keyed.length; j++) { keyed[j].bm.move(LocationOptions.AT_END, parentRef); order.push(keyed[j].bm.name); }
out.order = order;`;
                    break;
                }
            }
            return run('Manage bookmarks', ld(`
var out = { action: "${action}" };
${body}
__result__ = out;`));
        },
    },

    // ---------------------------------------------------- text variables, captions
    {
        name: 'define_text_variable',
        description: 'Create or change a text variable (Type > Text Variables > Define): custom text, file name, last page number, chapter number, creation / modification / output date with its format, running header from a paragraph or character style, or a metadata caption; with text before and after.',
        inputSchema: {
            type: 'object',
            properties: {
                name: S('Variable name; created when it does not exist'),
                type: E(Object.keys(VARIABLE_TYPES), 'Variable type (required when creating)'),
                options: objectSchema(VARIABLE_OPTIONS, 'Options for the type; only the ones given change'),
                newName: S('Rename the variable'),
            },
            required: ['name'],
        },
        features: F('textvar_running_header_paragraph_style', 'textvar_running_header_character_style', 'textvar_last_page_number',
            'textvar_chapter_number', 'textvar_creation_date_modification_date_output_date', 'textvar_file_name', 'textvar_custom_text',
            'textvar_metadata_caption', 'textvar_text_before_text_after', 'text_variable', 'define_text_variables', 'variable_format_menus'),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { type: 'running_header_paragraph', options: { paragraphStyle: 'Heading 1', use: 'FIRST_ON_PAGE', changeCase: 'UPPERCASE', textBefore: '' } },
        handler: (a) => {
            const name = nameLit(a.name, 'name');
            const type = given(a.type) ? enumOf(a.type, Object.keys(VARIABLE_TYPES), { name: 'type' }) : null;
            const lines = optionLines('vo', a.options, VARIABLE_OPTIONS, 'options', type ? VARIABLE_TYPES[type][1] : null);
            const vt = type ? `VariableTypes.${VARIABLE_TYPES[type][0]}` : null;
            return run('Define text variable', ld(`
var v = doc.textVariables.itemByName(${name}), created = false;
if (!v.isValid) {
  ${vt ? `v = doc.textVariables.add({ name: ${name}, variableType: ${vt} });` : `throw new Error("No text variable named " + ${name} + "; give a type to create it");`}
  created = true;
} ${vt ? `else if (v.variableType !== ${vt}) v.variableType = ${vt};` : ''}
var vo = v.variableOptions;
${lines.join('\n')}
${given(a.newName) ? `v.name = ${nameLit(a.newName, 'newName')};` : ''}
__result__ = { name: v.name, type: __enumName(v.variableType), created: created, instances: v.associatedInstances.length };`));
        },
    },
    {
        name: 'insert_text_variable',
        description: 'Insert a text variable at a point in text, such as a running header, chapter number or last page number (Type > Text Variables > Insert Variable).',
        inputSchema: {
            type: 'object',
            properties: {
                name: S('The text variable (e.g. "Running Header", "Last Page Number", or one made with define_text_variable)'),
                at: textSchema('Where it goes: after the chosen text unless before is true', { insertion: true }),
            },
            required: ['name', 'at'],
        },
        features: F('insert_text_variable'),
        hints: { readOnly: false },
        auditArgs: { at: { frameId: 1 } },
        handler: (a) => run('Insert text variable', ld(`
var v = __ldNamed(doc.textVariables, ${nameLit(a.name, 'name')}, "text variable");
var ip = __ldPoint(doc, ${textSpec(a.at, 'at')});
var inst = ip.textVariableInstances.add({ associatedTextVariable: v });
__result__ = { id: inst.id, variable: v.name, resultText: inst.resultText, storyId: ip.parentStory.id };`)),
    },
    {
        name: 'convert_text_variables',
        description: 'Convert text variables to ordinary text: every instance of one variable, or the instances inside some text (Type > Text Variables > Convert Variable to Text). Optionally delete the variable afterwards.',
        inputSchema: {
            type: 'object',
            properties: {
                name: S('The variable whose instances to convert (with text: only that variable\'s instances there)'),
                text: textSchema('Convert only the instances inside this text'),
                deleteVariable: B('After converting every instance, delete the variable (needs name, not text)'),
            },
        },
        features: F('convert_variable_to_text'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { text: null },
        handler: (a) => {
            if (!given(a.name) && !given(a.text)) throw new Error("Give 'name', 'text', or both");
            if (a.deleteVariable && given(a.text)) throw new Error("'deleteVariable' converts every instance; leave out 'text'");
            const name = given(a.name) ? nameLit(a.name, 'name') : 'null';
            const body = given(a.text)
                ? `var t = __ldText(doc, ${textSpec(a.text, 'text')});
var insts = t.textVariableInstances.everyItem().getElements();
for (var i = insts.length - 1; i >= 0; i--) {
  if (name !== null && insts[i].associatedTextVariable.name !== name) continue;
  insts[i].convertToText();
  n++;
}`
                : `var v = __ldNamed(doc.textVariables, name, "text variable");
n = v.associatedInstances.length;
v.convertToText();
${a.deleteVariable ? 'v.remove();\ndeleted = true;' : ''}`;
            return run('Convert text variables', ld(`
var name = ${name}, n = 0, deleted = false;
${body}
__result__ = { converted: n, variable: name, deleted: deleted };`));
        },
    },
    {
        name: 'generate_captions',
        description: 'Make captions for images from their metadata (Object > Captions > Caption Setup, Generate Live Caption, Generate Static Caption): a text frame beside each item with a live metadata caption variable, or its text; or convert live captions to static text (Convert to Static Caption). Can number captions through a numbering list that runs across stories (Figure 1, Figure 2...).',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                mode: E(['live', 'static', 'convert_to_static'], 'live: caption follows the metadata; static: plain text; convert_to_static: target is caption frames whose live captions become text'),
                metadataField: S('Metadata field to show (default "Name"; e.g. "Description", "Headline", "Credit", "Copyright")'),
                textBefore: S('Text before the metadata'),
                textAfter: S('Text after the metadata'),
                position: E(['below', 'above', 'left', 'right'], 'Where the caption frame goes (default below)'),
                offset: N('Gap between item and caption in mm (default 2)'),
                size: N('Caption frame height (below/above) or width (left/right) in mm (default 10)'),
                paragraphStyle: S('Paragraph style for the caption'),
                group: B('Group each caption with its item'),
                variableName: S('Name of the caption variable to use or create (default "Caption: <metadataField>")'),
                numbering: {
                    type: 'object',
                    description: 'Number captions (needs paragraphStyle): the style numbers paragraphs through this list',
                    properties: {
                        list: S('Numbering list name, created when missing (e.g. "Figures")'),
                        expression: S('Number format, e.g. "Figure ^#: " (^# is the number)'),
                        acrossDocuments: B('Continue numbering from the previous document in a book'),
                    },
                },
            },
            required: ['target'],
        },
        features: F('caption_setup', 'generate_live_caption', 'generate_static_caption', 'convert_to_static_caption', 'running_captions'),
        hints: { readOnly: false },
        auditArgs: { target: { ids: [1] }, paragraphStyle: 'Caption', numbering: { list: 'Figures', expression: 'Figure ^#: ', acrossDocuments: false } },
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'live', ['live', 'static', 'convert_to_static'], { name: 'mode' });
            const target = targetSpec(a.target);
            if (mode === 'convert_to_static') {
                return run('Convert captions to static', ld(`
var items = __targets(doc, ${target}), out = [];
for (var i = 0; i < items.length; i++) {
  var frames = items[i].hasOwnProperty("parentStory") ? [items[i]] : (items[i].hasOwnProperty("textFrames") ? items[i].textFrames.everyItem().getElements() : []);
  for (var f = 0; f < frames.length; f++) {
    var insts = frames[f].texts[0].textVariableInstances.everyItem().getElements(), n = 0;
    for (var k = insts.length - 1; k >= 0; k--) {
      if (insts[k].associatedTextVariable.variableType !== VariableTypes.LIVE_CAPTION_TYPE) continue;
      insts[k].convertToText();
      n++;
    }
    out.push({ frameId: frames[f].id, converted: n });
  }
}
__result__ = { mode: "convert_to_static", frames: out };`));
            }
            const field = given(a.metadataField) ? a.metadataField : 'Name';
            const varName = nameLit(a.variableName ?? `Caption: ${field}`, 'variableName');
            const position = enumOf(a.position ?? 'below', ['below', 'above', 'left', 'right'], { name: 'position' });
            const off = num(a.offset ?? 2, { min: -1000, max: 1000, name: 'offset' });
            const size = num(a.size ?? 10, { min: 1, max: 2000, name: 'size' });
            const bounds = {
                below: `[g[2] + ${off}, g[1], g[2] + ${off} + ${size}, g[3]]`,
                above: `[g[0] - ${off} - ${size}, g[1], g[0] - ${off}, g[3]]`,
                left: `[g[0], g[1] - ${off} - ${size}, g[2], g[1] - ${off}]`,
                right: `[g[0], g[3] + ${off}, g[2], g[3] + ${off} + ${size}]`,
            }[position];
            const style = [];
            if (given(a.paragraphStyle)) style.push(`var ps = __ldStyle(doc, "p", ${nameLit(a.paragraphStyle, 'paragraphStyle')});`);
            if (given(a.numbering)) {
                if (!given(a.paragraphStyle)) throw new Error("'numbering' needs paragraphStyle");
                const nb = a.numbering;
                const list = nameLit(nb.list, 'numbering.list');
                style.push(
                    `var nl = doc.numberingLists.itemByName(${list});`,
                    `if (!nl.isValid) nl = doc.numberingLists.add(${list});`,
                    'nl.continueNumbersAcrossStories = true;',
                    `nl.continueNumbersAcrossDocuments = ${bool(nb.acrossDocuments === true)};`,
                    'ps.bulletsAndNumberingListType = ListType.NUMBERED_LIST;',
                    'ps.appliedNumberingList = nl;',
                );
                if (given(nb.expression)) style.push(`ps.numberingExpression = ${text(nb.expression, 'numbering.expression', { max: 200 })};`);
            }
            return run('Generate captions', ld(`
var items = __targets(doc, ${target}), out = [];
var v = doc.textVariables.itemByName(${varName});
if (!v.isValid) v = doc.textVariables.add({ name: ${varName}, variableType: VariableTypes.LIVE_CAPTION_TYPE });
if (v.variableType !== VariableTypes.LIVE_CAPTION_TYPE) throw new Error(v.name + " is not a metadata caption variable");
var vo = v.variableOptions;
vo.metadataProviderName = ${text(field, 'metadataField', { max: 200, empty: false })};
${given(a.textBefore) ? `vo.textBefore = ${text(a.textBefore, 'textBefore', { max: 300 })};` : ''}
${given(a.textAfter) ? `vo.textAfter = ${text(a.textAfter, 'textAfter', { max: 300 })};` : ''}
${style.join('\n')}
for (var i = 0; i < items.length; i++) {
  var it = items[i], page = __pageOf(it);
  if (!page) throw new Error("Item " + it.id + " is not on a page");
  var g = it.geometricBounds;
  var tf = page.textFrames.add({ geometricBounds: ${bounds} });
  try { tf.itemLayer = it.itemLayer; } catch (e) {}
  var inst = tf.insertionPoints.firstItem().textVariableInstances.add({ associatedTextVariable: v });
  ${given(a.paragraphStyle) ? 'tf.texts[0].appliedParagraphStyle = ps;' : ''}
  var captionText = inst.resultText;
  ${mode === 'static' ? 'inst.convertToText();' : ''}
  var grouped = null;
  ${a.group ? 'try { grouped = page.groups.add([it, tf]).id; } catch (e) {}' : ''}
  out.push({ itemId: it.id, captionFrameId: tf.id, groupId: grouped, text: captionText });
}
__result__ = { mode: "${mode}", variable: v.name, captions: out };`));
        },
    },

    // ------------------------------------------------------------------ books
    {
        name: 'manage_book_contents',
        description: 'Work with a book\'s documents and the book file (Book panel menu): document information (path, size, date, status, pages), remove or replace a document, save the book under a new name (Save Book As), or close the book.',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: S('Path to the book (.indb); opened if it is not open'),
                action: E(BOOK_ACTIONS, 'What to do'),
                documentIndex: I('The document\'s position in the book, 0-based (document_info: absent means every document)'),
                replacementPath: S('replace_document: the InDesign document that takes its place'),
                outputPath: S('save_as: the new book path'),
                save: B('close: save changes first (default true)'),
            },
            required: ['bookPath', 'action'],
        },
        features: F('book_menu_remove_document', 'book_menu_replace_document', 'book_menu_save_book_as', 'book_menu_close_book', 'book_menu_document_information'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'document_info', documentIndex: null },
        handler: (a) => {
            const book = pathLit(a.bookPath, 'bookPath');
            const action = enumOf(a.action, BOOK_ACTIONS, { name: 'action' });
            const content = () => {
                const i = integer(a.documentIndex, 'documentIndex', 0, 10000);
                return `if (${i} >= book.bookContents.length) throw new Error("The book has " + book.bookContents.length + " documents");\nvar c = book.bookContents[${i}];`;
            };
            let body;
            switch (action) {
                case 'document_info':
                    body = `var list = ${given(a.documentIndex) ? `[book.bookContents[${integer(a.documentIndex, 'documentIndex', 0, 10000)}]]` : 'book.bookContents.everyItem().getElements()'};
if (!list[0] || !list[0].isValid) throw new Error("No such document in the book");
var docs = [];
for (var i = 0; i < list.length; i++) {
  var c = list[i], info = { index: c.index, name: c.name, status: __enumName(c.status), pages: c.documentPageRange };
  try { info.path = c.fullName.fsName; } catch (e1) {}
  try { info.folder = c.filePath.fsName; } catch (e2) {}
  try { info.size = c.size; } catch (e3) {}
  try { info.date = String(c.date); } catch (e4) {}
  docs.push(info);
}
out.documents = docs;`;
                    break;
                case 'remove_document':
                    body = `${content()}\nout.removed = c.name;\nc.remove();\nbook.save();`;
                    break;
                case 'replace_document':
                    body = `${content()}\nvar f = File(${pathLit(a.replacementPath, 'replacementPath')});\nif (!f.exists) throw new Error("File not found: " + f.fsName);\nvar at = c.index;\nout.replaced = c.name;\nc.replace(f);\nbook.save();\nout.now = book.bookContents[at].name;`;
                    break;
                case 'save_as':
                    body = `var f = File(${pathLit(a.outputPath, 'outputPath')});\nbook.save(f);\nout.path = book.fullName.fsName;`;
                    break;
                case 'close':
                    body = `out.closed = book.name;\nbook.close(${a.save === false ? 'SaveOptions.NO' : 'SaveOptions.YES'});`;
                    break;
            }
            return run('Manage book contents', ld(`
var book = __ldBook(${book}), out = { action: "${action}" };
${action === 'close' ? '' : 'out.book = book.name;'}
${body}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'set_chapter_numbering',
        description: 'Set a document\'s chapter number, its style, and whether it continues from or matches the previous document in its book (Book panel menu > Document Numbering Options; Layout > Numbering & Section Options). Acts on the active document, or opens, changes and saves the document at documentPath.',
        inputSchema: {
            type: 'object',
            properties: {
                documentPath: S('An InDesign document to change and save (default: the active document, not saved)'),
                source: E(Object.keys(CHAPTER_SOURCES), 'start_at: use chapterNumber; continue: one more than the previous document in the book; same_as_previous: the same number'),
                chapterNumber: I('Chapter number (with source start_at)', 1),
                format: E(NUMBERING_STYLE, 'Chapter number style'),
            },
        },
        features: F('chapter_chapter_number', 'chapter_chapter_number_style', 'chapter_chapter_numbering_automatic_continue_same_as_previous', 'book_menu_document_numbering_options'),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { documentPath: null, source: 'start_at', chapterNumber: 3 },
        handler: (a) => {
            const lines = [];
            if (given(a.source)) lines.push(`cp.chapterNumberSource = ChapterNumberSources.${CHAPTER_SOURCES[enumOf(a.source, Object.keys(CHAPTER_SOURCES), { name: 'source' })]};`);
            if (given(a.chapterNumber)) lines.push(`cp.chapterNumber = ${integer(a.chapterNumber, 'chapterNumber', 1, 100000)};`);
            if (given(a.format)) lines.push(`cp.chapterNumberFormat = NumberingStyle.${enumOf(a.format, NUMBERING_STYLE, { name: 'format' })};`);
            if (!lines.length) throw new Error('Nothing to set: give source, chapterNumber or format');
            const open = given(a.documentPath)
                ? `var f = File(${pathLit(a.documentPath, 'documentPath')}), d = null, opened = false;
for (var i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName === f.fsName) d = app.documents[i]; } catch (e) {} }
if (!d) { if (!f.exists) throw new Error("File not found: " + f.fsName); d = app.open(f, false); opened = true; }`
                : 'var d = __doc(), opened = false;';
            return run('Set chapter numbering', ld(`
${open}
var cp = d.chapterNumberPreferences;
${lines.join('\n')}
var result = { document: d.name, source: __enumName(cp.chapterNumberSource), chapterNumber: cp.chapterNumber, format: __ldName(cp.chapterNumberFormat) };
${given(a.documentPath) ? 'd.save();\nif (opened) d.close(SaveOptions.NO);\nresult.saved = true;' : ''}
__result__ = result;`, { needsDocument: false }));
        },
    },

    // ------------------------------------------------------------ panel menus
    {
        name: 'invoke_long_document_command',
        description: 'Run a long-document panel menu command that has no scripting equivalent: Index panel Show Find Field / Show Unused Topics; Conditional Text panel Show Options / Select All Unused; Hyperlinks panel Update Hyperlink, sort and Small Panel Rows; Book panel Reveal in Finder / Small Panel Rows; Paste as Cross-Reference. Each needs its panel open (or a selection) and fails with what to do when it is not available.',
        inputSchema: {
            type: 'object',
            properties: {
                command: E(Object.keys(PANEL_COMMANDS), 'The command'),
            },
            required: ['command'],
        },
        features: F(...Object.values(PANEL_COMMANDS).map((c) => c[1])),
        hints: { readOnly: false },
        handler: (a) => {
            const cmd = enumOf(a.command, Object.keys(PANEL_COMMANDS), { name: 'command' });
            const [id, , needs] = PANEL_COMMANDS[cmd];
            return run('Run panel command', ld(`
var ma = app.menuActions.itemByID(${id});
if (!ma.isValid) throw new Error("This InDesign version has no menu action ${id} (${cmd})");
if (!ma.enabled) throw new Error(ma.name + " is not available now: ${needs}");
ma.invoke();
__result__ = { command: "${cmd}", menuAction: ma.name };`, { needsDocument: false }));
        },
    },

    // ------------------------------------------------------------------ read
    {
        name: 'get_long_document_info',
        description: 'Report a document\'s long-document structure: TOC styles, footnotes and endnotes (with ids), index topics and sort options (Index panel), conditions, condition sets and hidden conditional text (Conditional Text panel), cross-reference formats, hyperlinks and text anchors (Hyperlinks and Cross-References panels), bookmarks (Bookmarks panel), text variables and chapter numbering.',
        inputSchema: {
            type: 'object',
            properties: {
                sections: { type: 'array', items: { type: 'string', enum: INFO_SECTIONS }, description: `Which parts to report (default all): ${INFO_SECTIONS.join(', ')}` },
                limit: I('Most items to list per kind (default 200)', 1),
            },
        },
        features: F('index_panel', 'conditional_text_panel', 'cross_references_panel', 'bookmarks_panel', 'hidden_text'),
        hints: { readOnly: true, idempotent: true },
        auditArgs: { sections: INFO_SECTIONS, limit: 50 },
        handler: (a) => {
            const sections = given(a.sections) ? a.sections.map((s, i) => enumOf(s, INFO_SECTIONS, { name: `sections[${i}]` })) : INFO_SECTIONS;
            const limit = given(a.limit) ? integer(a.limit, 'limit', 1, 10000) : '200';
            const parts = {
                toc_styles: `var ts = [];
for (var i = 0; i < doc.tocStyles.length && i < LIMIT; i++) {
  var st = doc.tocStyles[i], ents = [];
  for (var e = 0; e < st.tocStyleEntries.length; e++) ents.push({ paragraphStyle: st.tocStyleEntries[e].name, level: st.tocStyleEntries[e].level });
  ts.push({ name: st.name, title: st.title, createBookmarks: st.createBookmarks, entries: ents });
}
out.tocStyles = ts;
try { out.epubTocStyle = doc.epubExportPreferences.tocStyleName; } catch (e0) {}`,
                notes: `var fns = [], ens = [], stories = doc.stories.everyItem().getElements();
for (var s = 0; s < stories.length; s++) {
  for (var f = 0; f < stories[s].footnotes.length && fns.length < LIMIT; f++) { var fn = stories[s].footnotes[f]; fns.push({ id: fn.id, storyId: stories[s].id, page: __ldPageName(fn.storyOffset), text: __ldSnippet(__ldNoteBody(fn.texts[0].contents)) }); }
  for (var n = 0; n < stories[s].endnotes.length && ens.length < LIMIT; n++) { var en = stories[s].endnotes[n]; ens.push({ id: en.id, storyId: stories[s].id, page: __ldPageName(en.storyOffset), text: __ldSnippet(__ldNoteBody(en.texts[0].contents)) }); }
}
out.footnotes = fns;
out.endnotes = ens;`,
                index: `var count = 0;
var topics = function (coll, depth) {
  var list = [];
  for (var i = 0; i < coll.length && count < LIMIT; i++, count++) {
    var t = coll[i], pages = [], xr = [];
    for (var r = 0; r < t.pageReferences.length; r++) pages.push(__ldPageName(t.pageReferences[r].sourceText));
    for (var c = 0; c < t.crossReferences.length; c++) xr.push(__enumName(t.crossReferences[c].crossReferenceType) + " " + t.crossReferences[c].referencedTopic.name);
    list.push({ name: t.name, sortOrder: t.sortOrder || null, pages: pages, crossReferences: xr, subtopics: depth < 4 ? topics(t.topics, depth + 1) : [] });
  }
  return list;
};
out.index = doc.indexes.length ? topics(doc.indexes[0].topics, 1) : [];
var so = [];
for (var g = 0; g < doc.indexingSortOptions.length; g++) { var o = doc.indexingSortOptions[g]; so.push({ name: o.name, include: o.include, priority: o.priority }); }
out.indexSortOptions = so;`,
                conditions: `var cs = [], sets = [], hidden = [];
for (var i = 0; i < doc.conditions.length; i++) { var c = doc.conditions[i]; cs.push({ name: c.name, visible: c.visible, indicatorMethod: __enumName(c.indicatorMethod), indicatorColor: __ldName(c.indicatorColor) }); }
for (var j = 0; j < doc.conditionSets.length; j++) sets.push(doc.conditionSets[j].name);
var stories = doc.stories.everyItem().getElements();
for (var s = 0; s < stories.length && hidden.length < LIMIT; s++) {
  var h = stories[s].hiddenTexts;
  if (h.length) hidden.push({ storyId: stories[s].id, count: h.length, first: __ldSnippet(h[0].texts[0].contents) });
}
out.conditions = cs;
out.conditionSets = sets;
try { out.activeConditionSet = __ldName(doc.conditionalTextPreferences.activeConditionSet); } catch (e1) {}
out.conditionIndicators = __enumName(doc.conditionalTextPreferences.showConditionIndicators);
out.hiddenText = hidden;`,
                cross_references: `var fmts = [];
for (var i = 0; i < doc.crossReferenceFormats.length; i++) {
  var fm = doc.crossReferenceFormats[i], blocks = [];
  for (var b = 0; b < fm.buildingBlocks.length; b++) blocks.push(__enumName(fm.buildingBlocks[b].blockType).replace("_BUILDING_BLOCK", "").toLowerCase() + (fm.buildingBlocks[b].customText ? " \\"" + fm.buildingBlocks[b].customText + "\\"" : ""));
  fmts.push({ name: fm.name, blocks: blocks });
}
out.crossReferenceFormats = fmts;
out.crossReferences = doc.crossReferenceSources.length;`,
                hyperlinks: `var links = [], anchors = [];
for (var i = 0; i < doc.hyperlinks.length && i < LIMIT; i++) {
  var l = doc.hyperlinks[i], info = { id: l.id, name: l.name, visible: l.visible };
  try { info.source = l.source.constructor.name; info.text = __ldSnippet(l.source.sourceText.contents); info.page = __ldPageName(l.source.sourceText); } catch (e1) {}
  try { info.destination = l.destination.constructor.name + " " + __ldName(l.destination); } catch (e2) {}
  try { if (l.source.constructor.name === "CrossReferenceSource") info.format = l.source.appliedFormat.name; } catch (e3) {}
  links.push(info);
}
for (var k = 0; k < doc.hyperlinkTextDestinations.length && k < LIMIT; k++) anchors.push(doc.hyperlinkTextDestinations[k].name);
out.hyperlinks = links;
out.textAnchors = anchors;`,
                bookmarks: `var count = 0;
var marks = function (coll) {
  var list = [];
  for (var i = 0; i < coll.length && count < LIMIT; i++, count++) {
    var b = coll[i], info = { name: b.name, indent: b.indent };
    try { info.destination = b.destination.constructor.name + " " + __ldName(b.destination); } catch (e) {}
    info.children = marks(b.bookmarks);
    list.push(info);
  }
  return list;
};
out.bookmarks = marks(doc.bookmarks);`,
                text_variables: `var vars = [];
for (var i = 0; i < doc.textVariables.length && i < LIMIT; i++) { var v = doc.textVariables[i]; vars.push({ name: v.name, type: __enumName(v.variableType), instances: v.associatedInstances.length }); }
out.textVariables = vars;`,
                chapter_numbering: `var cp = doc.chapterNumberPreferences;
out.chapterNumbering = { source: __enumName(cp.chapterNumberSource), chapterNumber: cp.chapterNumber, format: __ldName(cp.chapterNumberFormat) };`,
            };
            const body = sections.map((s) => `(function () {\n${parts[s].replace(/LIMIT/g, 'limit')}\n})();`).join('\n');
            return run('Get long document info', ld(`
var out = { document: doc.name }, limit = ${limit};
${body}
__result__ = out;`));
        },
    },
];
