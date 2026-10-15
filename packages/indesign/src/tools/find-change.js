/**
 * Find/Change: text, GREP, glyph, object, colour and transliterate searches
 * with Find Format / Change Format criteria, every search option and search
 * scope; saved queries; and the Edit menu's Find Next and load-selection
 * commands. Literal find/replace, plain GREP and style-only searches are the
 * existing find_replace_text, find_text_in_document and find_change_style
 * tools; Find Font is manage_fonts.
 */
import { str, num, enumOf } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, colorSpec } from './run.js';
import { has, obj, known, int, flag, text, pick } from './checks.js';
import { fontName } from './character.js';

/** Each search mode's preference objects, options object, methods and saved-query mode. */
const MODES = {
    text: { find: 'findTextPreferences', change: 'changeTextPreferences', options: 'findChangeTextOptions', findFn: 'findText', changeFn: 'changeText', query: 'TEXT_SEARCH' },
    grep: { find: 'findGrepPreferences', change: 'changeGrepPreferences', options: 'findChangeGrepOptions', findFn: 'findGrep', changeFn: 'changeGrep', query: 'GREP_SEARCH' },
    glyph: { find: 'findGlyphPreferences', change: 'changeGlyphPreferences', options: 'findChangeGlyphOptions', findFn: 'findGlyph', changeFn: 'changeGlyph', query: 'GLYPH_SEARCH' },
    object: { find: 'findObjectPreferences', change: 'changeObjectPreferences', options: 'findChangeObjectOptions', findFn: 'findObject', changeFn: 'changeObject', query: 'OBJECT_SEARCH' },
    color: { find: 'findColorPreferences', change: 'changeColorPreferences', options: 'findChangeColorOptions', findFn: 'findColor', changeFn: 'changeColor', query: 'COLOR_SEARCH', noReverse: true },
    transliterate: { find: 'findTransliteratePreferences', change: 'changeTransliteratePreferences', options: 'findChangeTransliterateOptions', findFn: 'findTransliterate', changeFn: 'changeTransliterate', query: null },
};
const MODE_NAMES = Object.keys(MODES);

/** Search options (the Find/Change dialog's option buttons) and their object-model names. */
const OPTION_PROPS = {
    caseSensitive: 'caseSensitive',
    wholeWord: 'wholeWord',
    includeLockedLayers: 'includeLockedLayersForFind',
    includeLockedStories: 'includeLockedStoriesForFind',
    includeHiddenLayers: 'includeHiddenLayers',
    includeMasterPages: 'includeMasterPages',
    includeFootnotes: 'includeFootnotes',
    kanaSensitive: 'kanaSensitive',
    widthSensitive: 'widthSensitive',
    ignoreDiacritics: 'ignoreDiacritics',
    ignoreKashidas: 'ignoreKashidas',
    searchBackwards: 'searchBackwards',
};
const INCLUDES = ['includeLockedLayers', 'includeLockedStories', 'includeHiddenLayers', 'includeMasterPages', 'includeFootnotes'];
/** Which options each mode's options object has. */
const MODE_OPTIONS = {
    text: Object.keys(OPTION_PROPS),
    grep: [...INCLUDES, 'kanaSensitive', 'widthSensitive', 'searchBackwards'],
    glyph: [...INCLUDES, 'searchBackwards'],
    object: [...INCLUDES, 'objectType'],
    color: [...INCLUDES, 'objectType'],
    transliterate: [...INCLUDES, 'caseSensitive', 'wholeWord', 'kanaSensitive', 'widthSensitive', 'searchBackwards'],
};
const OBJECT_TYPES = {
    all_frames: 'ObjectTypes.ALL_FRAMES_TYPE',
    text_frames: 'ObjectTypes.TEXT_FRAMES_TYPE',
    graphic_frames: 'ObjectTypes.GRAPHIC_FRAMES_TYPE',
    unassigned_frames: 'ObjectTypes.UNASSIGNED_FRAMES_TYPE',
};

const CAPITALIZATION = { normal: 'Capitalization.NORMAL', all_caps: 'Capitalization.ALL_CAPS', small_caps: 'Capitalization.SMALL_CAPS', cap_to_small_cap: 'Capitalization.CAP_TO_SMALL_CAP' };
const POSITION = {
    normal: 'Position.NORMAL', superscript: 'Position.SUPERSCRIPT', subscript: 'Position.SUBSCRIPT',
    ot_superscript: 'Position.OT_SUPERSCRIPT', ot_subscript: 'Position.OT_SUBSCRIPT', ot_numerator: 'Position.OT_NUMERATOR', ot_denominator: 'Position.OT_DENOMINATOR',
};
const CHARACTER_TYPES = {
    full_width_hiragana: 'FULL_WIDTH_HIRAGANA', full_width_katakana: 'FULL_WIDTH_KATAKANA', half_width_katakana: 'HALF_WIDTH_KATAKANA',
    full_width_roman_symbols: 'FULL_WIDTH_ROMAN_SYMBOLS', half_width_roman_symbols: 'HALF_WIDTH_ROMAN_SYMBOLS',
    western_arabic_digits: 'WESTERN_ARABIC_DIGITS', arabic_indic_digits: 'ARABIC_INDIC_DIGITS', farsi_digits: 'FARSI_DIGITS',
};

/**
 * Find Format / Change Format attributes for text, GREP and transliterate
 * searches: [object-model property, kind, description].
 */
const FORMAT = {
    paragraphStyle: ['appliedParagraphStyle', 'pstyle', 'Paragraph style (name, or "Group/Style")'],
    characterStyle: ['appliedCharacterStyle', 'cstyle', 'Character style (name, or "Group/Style")'],
    font: ['appliedFont', 'font', 'Font, as "Family\\tStyle" or a family name'],
    fontStyle: ['fontStyle', 'string', 'Font style, such as "Bold"'],
    pointSize: ['pointSize', 'pt', 'Size in points'],
    leading: ['leading', 'pt', 'Leading in points'],
    tracking: ['tracking', 'int', 'Tracking in thousandths of an em'],
    fillColor: ['fillColor', 'color', 'Text colour: a swatch name or "#RRGGBB"'],
    strokeColor: ['strokeColor', 'color', 'Text stroke colour: a swatch name or "#RRGGBB"'],
    underline: ['underline', 'bool', 'Underline'],
    strikeThru: ['strikeThru', 'bool', 'Strikethrough'],
    noBreak: ['noBreak', 'bool', 'No Break'],
    capitalization: ['capitalization', CAPITALIZATION, 'Case: normal, all_caps, small_caps or cap_to_small_cap'],
    position: ['position', POSITION, 'Position: normal, superscript, subscript or an OpenType position'],
    language: ['appliedLanguage', 'string', 'Language name, such as "English: USA"'],
};

/** Object search attributes: [property, kind, description]. */
const OBJECT_FORMAT = {
    objectStyle: ['appliedObjectStyles', 'ostyle', 'Object style (name, or "Group/Style")'],
    fillColor: ['fillColor', 'color', 'Fill: a swatch name or "#RRGGBB"'],
    strokeColor: ['strokeColor', 'color', 'Stroke: a swatch name or "#RRGGBB"'],
    fillTint: ['fillTint', 'percent', 'Fill tint, percent'],
    strokeTint: ['strokeTint', 'percent', 'Stroke tint, percent'],
    strokeWeight: ['strokeWeight', 'pt', 'Stroke weight in points'],
};

/** One attribute value as script text. */
function value(kind, v, name) {
    if (kind === 'pstyle') return `__styleBy(doc, "paragraph", ${text(v, name)})`;
    if (kind === 'cstyle') return `__styleBy(doc, "character", ${text(v, name)})`;
    if (kind === 'ostyle') return `__styleBy(doc, "object", ${text(v, name)})`;
    if (kind === 'font') return str(fontName(v, name));
    if (kind === 'string') return text(v, name, 200);
    if (kind === 'pt') return num(v, { min: 0, max: 1296, name });
    if (kind === 'percent') return num(v, { min: 0, max: 100, name });
    if (kind === 'int') return int(v, name, { min: -1000, max: 10000 });
    if (kind === 'bool') return flag(v, name);
    if (kind === 'color') return `__swatch(doc, ${colorSpec(v, name)})`;
    return pick(v, kind, name);
}

/** Assignments of a Find Format / Change Format object onto a preference object. */
function formatLines(pref, format, table, name) {
    const f = obj(format, name);
    if (!f) return [];
    known(f, Object.keys(table), name);
    return Object.keys(f).filter((k) => has(f[k])).map((k) => `${pref}.${table[k][0]} = ${value(table[k][1], f[k], `${name}.${k}`)};`);
}

const FIND_KEYS = {
    text: ['text', 'format'],
    grep: ['text', 'format'],
    transliterate: ['characterType', 'format'],
    glyph: ['font', 'fontStyle', 'glyphId'],
    object: Object.keys(OBJECT_FORMAT),
    color: ['swatch', 'tint'],
};

/** Statements that set what to find (`side` find) or what to change to (`side` change). */
function sideLines(mode, side, spec) {
    const m = MODES[mode];
    const pref = `app.${side === 'find' ? m.find : m.change}`;
    const s = obj(spec, side);
    if (!s) return [];
    known(s, FIND_KEYS[mode], side);
    const lines = [];
    if (mode === 'text' || mode === 'grep') {
        if (has(s.text) || s.text === '') {
            if (typeof s.text !== 'string' || s.text.length > 2000) throw new Error(`'${side}.text' must be a string of at most 2000 characters`);
            lines.push(`${pref}.${side === 'find' ? 'findWhat' : 'changeTo'} = ${str(s.text)};`);
        }
        lines.push(...formatLines(pref, s.format, FORMAT, `${side}.format`));
    }
    if (mode === 'transliterate') {
        if (has(s.characterType)) {
            const t = pick(s.characterType, CHARACTER_TYPES, `${side}.characterType`);
            lines.push(`${pref}.${side === 'find' ? 'findCharacterType' : 'changeCharacterType'} = FindChangeTransliterateCharacterTypes.${t};`);
        }
        lines.push(...formatLines(pref, s.format, FORMAT, `${side}.format`));
    }
    if (mode === 'glyph') {
        if (has(s.font)) lines.push(`${pref}.appliedFont = ${str(fontName(s.font, `${side}.font`))};`);
        if (has(s.fontStyle)) lines.push(`${pref}.fontStyle = ${text(s.fontStyle, `${side}.fontStyle`, 200)};`);
        if (has(s.glyphId)) lines.push(`${pref}.glyphID = ${int(s.glyphId, `${side}.glyphId`, { max: 65535 })};`);
    }
    if (mode === 'object') lines.push(...formatLines(pref, s, OBJECT_FORMAT, side));
    if (mode === 'color') {
        if (has(s.swatch)) lines.push(`${pref}.${side === 'find' ? 'findWhat' : 'changeTo'} = __swatch(doc, ${colorSpec(s.swatch, `${side}.swatch`)});`);
        if (has(s.tint)) lines.push(`${pref}.tint = ${num(s.tint, { min: 0, max: 100, name: `${side}.tint` })};`);
    }
    return lines;
}

/** Statements that set the search options on the mode's options object `__opts`. */
function optionLines(mode, options) {
    const o = obj(options, 'options');
    if (!o) return [];
    known(o, [...Object.keys(OPTION_PROPS), 'objectType'], 'options');
    const lines = [];
    for (const k of Object.keys(o)) {
        if (!has(o[k])) continue;
        if (!MODE_OPTIONS[mode].includes(k)) throw new Error(`Option '${k}' does not apply to ${mode} searches. ${mode} options: ${MODE_OPTIONS[mode].join(', ')}`);
        if (k === 'objectType') lines.push(`__opts.objectType = ${pick(o[k], OBJECT_TYPES, 'options.objectType')};`);
        else lines.push(`__opts.${OPTION_PROPS[k]} = ${flag(o[k], `options.${k}`)};`);
    }
    return lines;
}

/** Statements that reset the mode's find and change preferences. */
const resetLines = (mode) => [`app.${MODES[mode].find} = NothingEnum.NOTHING;`, `app.${MODES[mode].change} = NothingEnum.NOTHING;`];

/** A saved query name. */
function queryName(v, name = 'name') {
    const s = String(v ?? '').trim();
    if (!s) throw new Error(`'${name}' is required: the saved query's name`);
    if (s.length > 100 || /[/\\:]/.test(s)) throw new Error(`'${name}' must be at most 100 characters, without / \\ or :`);
    return str(s);
}

/** Script helpers: style lookup by name or group path, and a description of one hit. */
const FIND_JSX = String.raw`
var __styleBy = function (doc, kind, ref) {
  var all = kind === "paragraph" ? doc.allParagraphStyles : kind === "character" ? doc.allCharacterStyles : doc.allObjectStyles;
  for (var i = 0; i < all.length; i++) {
    var s = all[i], p = s.name, o = s.parent;
    if (p === ref) return s;
    while (o && o.constructor.name.indexOf("Group") > 0) { p = o.name + "/" + p; o = o.parent; }
    if (p === ref) return s;
  }
  throw new Error("No " + kind + " style named " + ref);
};
var __TEXTY = ",Text,Character,Word,Line,Paragraph,TextColumn,TextStyleRange,InsertionPoint,Story,";
var __hit = function (h) {
  var kind = h.constructor.name;
  if (__TEXTY.indexOf("," + kind + ",") >= 0) {
    var info = { kind: "text", text: String(h.contents).substring(0, 80) };
    try { info.storyId = h.parentStory.id; info.index = h.index; } catch (e) {}
    try { var fr = h.parentTextFrames; info.page = fr.length && fr[0].parentPage ? fr[0].parentPage.name : "overset"; } catch (e) {}
    return info;
  }
  try { return __itemInfo(h); } catch (e) { return { kind: kind }; }
};
var __textScope = function (t) {
  if (!t) throw new Error("Nothing is selected");
  if (t instanceof TextFrame) return t.texts[0];
  if (__TEXTY.indexOf("," + t.constructor.name + ",") < 0 || t.constructor.name === "InsertionPoint") throw new Error("Select some text to search the selection");
  return t;
};
`;

const SCOPES = ['document', 'all_documents', 'story', 'story_to_end', 'selection'];

/** The statement that picks the object to search (`where`). */
function scopeLine(mode, a) {
    const scope = enumOf(a.scope ?? 'document', SCOPES, { name: 'scope' });
    if ((mode === 'object' || mode === 'color') && !['document', 'all_documents'].includes(scope)) {
        throw new Error(`${mode} searches cover the document or all documents; scope '${scope}' is for text`);
    }
    if (scope === 'document') return 'var where = doc;';
    if (scope === 'all_documents') return 'var where = app;';
    if (scope === 'selection') return 'var where = __textScope(app.selection[0]);';
    if (scope === 'story') {
        if (has(a.storyId)) return `var where = doc.stories.itemByID(${int(a.storyId, 'storyId')});\nif (!where.isValid) throw new Error("No story with id " + ${int(a.storyId, 'storyId')});`;
        if (has(a.frameId)) return `var where = __item(doc, ${int(a.frameId, 'frameId')}).parentStory;`;
        return [
            'var where = null;',
            'try { where = app.selection[0].parentStory; } catch (e) {}',
            'if (!where) throw new Error("Select text or a text frame, or give storyId or frameId, to search a story");',
        ].join('\n');
    }
    // story_to_end: from the start of a frame's text, or from the selection, to the end of the story
    const from = has(a.frameId) ? `__item(doc, ${int(a.frameId, 'frameId')}).insertionPoints[0]` : 'app.selection[0]';
    return [
        `var __from = ${from};`,
        'var __st = null;',
        'try { __st = __from.parentStory; } catch (e) {}',
        'if (!__st) throw new Error("Put the text cursor in a story, or give frameId, to search to the end of the story");',
        'var __at = __from.insertionPoints[0].index;',
        'if (__at >= __st.characters.length) throw new Error("There is no text after the cursor");',
        'var where = __st.characters.itemByRange(__at, __st.characters.length - 1);',
    ].join('\n');
}

const SIDE_SCHEMA = (side) => ({
    type: 'object',
    description: `What to ${side === 'find' ? 'find' : 'change matches to'}. Fields by mode: text and grep take text and format; transliterate takes characterType and format; glyph takes font, fontStyle and glyphId; object takes objectStyle, fillColor, strokeColor, fillTint, strokeTint and strokeWeight; color takes swatch and tint`,
    properties: {
        text: { type: 'string', description: side === 'find' ? 'Text or GREP expression to find (metacharacters such as ^p, ^t, \\d and (?i) work as in the Find/Change dialog)' : 'Replacement text; GREP replacements may use $0-$9 and found-text metacharacters' },
        format: {
            type: 'object',
            description: side === 'find' ? 'Find Format: only match text with these attributes' : 'Change Format: apply these attributes to the matches',
            properties: Object.fromEntries(Object.entries(FORMAT).map(([k, [, kind, d]]) => [k, {
                type: kind === 'bool' ? 'boolean' : ['pt', 'int'].includes(kind) ? 'number' : 'string',
                ...(typeof kind === 'object' ? { enum: Object.keys(kind) } : {}),
                description: d,
            }])),
        },
        characterType: { type: 'string', enum: Object.keys(CHARACTER_TYPES), description: 'Transliterate: the character type to find or change to' },
        font: { type: 'string', description: 'Glyph: font, as "Family\\tStyle" or a family name' },
        fontStyle: { type: 'string', description: 'Glyph: font style' },
        glyphId: { type: 'integer', minimum: 0, description: 'Glyph: glyph ID (GID) in the font' },
        objectStyle: { type: 'string', description: 'Object: object style' },
        fillColor: { type: 'string', description: 'Object: fill swatch name or "#RRGGBB"' },
        strokeColor: { type: 'string', description: 'Object: stroke swatch name or "#RRGGBB"' },
        fillTint: { type: 'number', description: 'Object: fill tint, percent' },
        strokeTint: { type: 'number', description: 'Object: stroke tint, percent' },
        strokeWeight: { type: 'number', description: 'Object: stroke weight in points' },
        swatch: { type: 'string', description: 'Color: swatch name (or "#RRGGBB")' },
        tint: { type: 'number', description: 'Color: tint, percent' },
    },
});

const OPTIONS_SCHEMA = {
    type: 'object',
    description: 'Search options (the Find/Change dialog buttons); each applies only to the modes that have it',
    properties: {
        caseSensitive: { type: 'boolean', description: 'Case Sensitive (text, transliterate)' },
        wholeWord: { type: 'boolean', description: 'Whole Word (text, transliterate)' },
        includeLockedLayers: { type: 'boolean', description: 'Include Locked Layers and Locked Objects (finding only)' },
        includeLockedStories: { type: 'boolean', description: 'Include Locked Stories, such as checked-in InCopy stories (finding only)' },
        includeHiddenLayers: { type: 'boolean', description: 'Include Hidden Layers and Hidden Objects' },
        includeMasterPages: { type: 'boolean', description: 'Include Parent Pages' },
        includeFootnotes: { type: 'boolean', description: 'Include Footnotes' },
        kanaSensitive: { type: 'boolean', description: 'Kana Sensitive (text, grep, transliterate)' },
        widthSensitive: { type: 'boolean', description: 'Width Sensitive (text, grep, transliterate)' },
        ignoreDiacritics: { type: 'boolean', description: 'Ignore Diacritics (text)' },
        ignoreKashidas: { type: 'boolean', description: 'Ignore Kashidas (text)' },
        searchBackwards: { type: 'boolean', description: 'Search Backwards (text, grep, glyph, transliterate)' },
        objectType: { type: 'string', enum: Object.keys(OBJECT_TYPES), description: 'Type of frames to search (object, color)' },
    },
};

/** Statements that build the whole search: reset, optional saved query, criteria and options. */
function criteria(mode, a, { needFind = true } = {}) {
    const lines = [...resetLines(mode)];
    if (has(a.query)) {
        const q = obj(a.query, 'query');
        known(q, ['name'], 'query');
        if (!MODES[mode].query) throw new Error('Transliterate searches have no saved queries');
        lines.push(`app.loadFindChangeQuery(${queryName(q.name, 'query.name')}, SearchModes.${MODES[mode].query});`);
    }
    const find = sideLines(mode, 'find', a.find);
    if (needFind && !find.length && !has(a.query)) throw new Error("Give 'find' criteria (or a saved 'query')");
    lines.push(...find, ...sideLines(mode, 'change', a.change), ...optionLines(mode, a.options));
    return lines;
}

export const tools = [
    {
        name: 'run_find_change',
        description: 'Find, or find and change, with the Find/Change dialog\'s full criteria: text, GREP, glyph, object, colour or transliterate searches; Find Format and Change Format attributes; search scope (document, all documents, story, to end of story, selection); and the search options (locked, hidden and parent-page items, footnotes, case, whole word, kana, width, diacritics, kashidas, backwards). A saved query can supply the criteria. Returns the count and the first matches',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: MODE_NAMES, description: 'The search: text, grep, glyph, object (frames by attributes), color (a swatch on text and objects, Edit > Find/Change for colour) or transliterate (Japanese character types and digits)' },
                action: { type: 'string', enum: ['find', 'change'], description: 'find only counts and lists matches; change replaces them (Change All)', default: 'find' },
                find: SIDE_SCHEMA('find'),
                change: SIDE_SCHEMA('change'),
                options: OPTIONS_SCHEMA,
                scope: { type: 'string', enum: SCOPES, description: 'Search: document, all_documents, story (storyId, frameId, or the selection\'s story), story_to_end (from frameId\'s text or the cursor), or selection (the selected text). Object and color searches take document or all_documents', default: 'document' },
                storyId: { type: 'integer', minimum: 0, description: 'For scope story: the story id' },
                frameId: { type: 'integer', minimum: 0, description: 'For scope story or story_to_end: a text frame of the story' },
                query: { type: 'object', description: 'Load a saved query (user or Adobe-supplied) of this mode as the criteria; find, change and options given here are added on top', properties: { name: { type: 'string', description: 'Query name, as in the Find/Change dialog Query menu' } } },
                keepCriteria: { type: 'boolean', description: 'Leave the criteria and options in Find/Change afterwards (for Find Next and the other run_find_change_command commands); default resets them', default: false },
                maxResults: { type: 'integer', minimum: 0, maximum: 500, description: 'How many matches to describe', default: 20 },
            },
            required: ['mode'],
        },
        features: [
            'indesign.find_change.find_replace_colors',
            'indesign.find_change.find_glyph',
            'indesign.find_change.find_object',
            'indesign.find_change.find_transliterate',
            'indesign.find_change.fc_option_search_scope',
            'indesign.find_change.fc_option_include_locked_layers_and_locked_objects',
            'indesign.find_change.fc_option_include_locked_stories',
            'indesign.find_change.fc_option_include_hidden_layers_and_hidden_objects',
            'indesign.find_change.fc_option_include_parent_pages',
            'indesign.find_change.fc_option_include_footnotes',
            'indesign.find_change.fc_option_kana_sensitive',
            'indesign.find_change.fc_option_width_sensitive',
            'indesign.find_change.fc_option_ignore_diacritics',
            'indesign.find_change.fc_option_ignore_kashidas',
            'indesign.find_change.fc_option_search_backwards',
            'indesign.find_change.find_format',
            'indesign.find_change.grep_metacharacters',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: {
            mode: 'grep', action: 'change', scope: 'document', storyId: null, frameId: null, query: null,
            find: { text: '(\\d+)\\s*mm', format: { paragraphStyle: 'Body', fillColor: '#ff0000', position: 'normal' } },
            change: { text: '$1 mm', format: { characterStyle: 'Units', underline: true } },
            options: { includeMasterPages: true, includeFootnotes: true, kanaSensitive: false, widthSensitive: false, searchBackwards: false },
        },
        handler: (a) => {
            const mode = enumOf(a.mode, MODE_NAMES, { name: 'mode' });
            const m = MODES[mode];
            const action = enumOf(a.action ?? 'find', ['find', 'change'], { name: 'action' });
            if (action === 'change' && !has(a.change) && !has(a.query)) throw new Error("action change needs 'change' (or a saved 'query' with Change To criteria)");
            if (action === 'find' && has(a.change)) throw new Error("'change' was given with action find: pass action: \"change\" to replace");
            const keep = has(a.keepCriteria) ? a.keepCriteria === true : false;
            const max = int(a.maxResults ?? 20, 'maxResults', { max: 500 });
            const rev = m.noReverse ? '' : (a.options?.searchBackwards === true ? 'true' : 'false');
            const call = action === 'change' ? m.changeFn : m.findFn;
            const lines = [
                `var __opts = app.${m.options}, __saved = __opts.properties;`,
                'try {',
                ...criteria(mode, a),
                scopeLine(mode, a),
                `  var hits = where.${call}(${rev});`,
                '  if (!hits) hits = [];',
                '  var out = [];',
                `  for (var i = 0; i < hits.length && i < ${max}; i++) out.push(__hit(hits[i]));`,
                `  __result__ = { mode: "${mode}", action: "${action}", count: hits.length, matches: out, criteriaKept: ${keep} };`,
                '} finally {',
                ...(keep ? [] : [...resetLines(mode), '  try { __opts.properties = __saved; } catch (e) {}']),
                '}',
            ];
            return run('Find/Change', script(FIND_JSX + lines.join('\n'), { needsDocument: true }));
        },
    },
    {
        name: 'manage_find_change_queries',
        description: 'Saved Find/Change queries: list the user and Adobe-supplied queries by mode, save criteria as a named query, load a query into Find/Change (ready for Find Next), or delete a saved query (Find/Change dialog > Query menu, Save Query, Delete Query)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'save', 'load', 'delete'], description: 'What to do' },
                name: { type: 'string', description: 'For save, load and delete: the query name' },
                mode: { type: 'string', enum: ['text', 'grep', 'glyph', 'object', 'color'], description: 'For save, load and delete: which kind of query' },
                find: SIDE_SCHEMA('find'),
                change: SIDE_SCHEMA('change'),
                options: OPTIONS_SCHEMA,
            },
            required: ['action'],
        },
        features: ['indesign.find_change.saved_queries'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'save', name: 'Units', mode: 'text', find: { text: 'mm', format: { fontStyle: 'Bold' } }, change: { text: ' mm' }, options: { wholeWord: true } },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'save', 'load', 'delete'], { name: 'action' });
            if (action === 'list') {
                return run('List Find/Change queries', script(String.raw`
var out = { user: {}, builtIn: {} }, ver = "Version " + parseInt(app.version, 10) + ".0";
var __collect = function (root, into) {
  if (!root.exists) return;
  var modes = root.getFiles();
  for (var i = 0; i < modes.length; i++) {
    if (!(modes[i] instanceof Folder)) continue;
    var files = modes[i].getFiles("*.xml"), names = [];
    for (var j = 0; j < files.length; j++) names.push(decodeURI(files[j].name).replace(/\.xml$/i, ""));
    into[decodeURI(modes[i].name)] = names;
  }
};
var bases = [Folder(Folder.userData + "/Adobe/InDesign/" + ver), Folder("~/Library/Preferences/Adobe InDesign/" + ver)];
for (var b = 0; b < bases.length; b++) {
  if (!bases[b].exists) continue;
  var locales = bases[b].getFiles();
  for (var k = 0; k < locales.length; k++) if (locales[k] instanceof Folder) __collect(Folder(locales[k].fullName + "/Find-Change Queries"), out.user);
}
__collect(Folder(app.filePath.fullName + "/Presets/Find-Change Queries"), out.builtIn);
__result__ = out;`, { needsDocument: false }));
            }
            const mode = enumOf(a.mode, ['text', 'grep', 'glyph', 'object', 'color'], { name: 'mode' });
            const name = queryName(a.name);
            const sm = `SearchModes.${MODES[mode].query}`;
            if (action === 'delete') {
                if (has(a.find) || has(a.change) || has(a.options)) throw new Error('delete takes only name and mode');
                return run('Delete Find/Change query', script(`app.deleteFindChangeQuery(${name}, ${sm});\n__result__ = { deleted: ${name}, mode: "${mode}" };`, { needsDocument: false }));
            }
            if (action === 'load') {
                if (has(a.find) || has(a.change) || has(a.options)) throw new Error('load takes only name and mode; run_find_change adds criteria on top of a query');
                const read = mode === 'text' || mode === 'grep'
                    ? `{ findWhat: app.${MODES[mode].find}.findWhat, changeTo: app.${MODES[mode].change}.changeTo }`
                    : '{}';
                return run('Load Find/Change query', script(`${resetLines(mode).join('\n')}\napp.loadFindChangeQuery(${name}, ${sm});\n__result__ = { loaded: ${name}, mode: "${mode}", criteria: ${read} };`, { needsDocument: false }));
            }
            // save: set the criteria, save them under the name, then clear them again
            const lines = [
                `var __opts = app.${MODES[mode].options}, __saved = __opts.properties;`,
                'try {',
                ...criteria(mode, { find: a.find, change: a.change, options: a.options }),
                `  app.saveFindChangeQuery(${name}, ${sm});`,
                `  __result__ = { saved: ${name}, mode: "${mode}" };`,
                '} finally {',
                ...resetLines(mode),
                '  try { __opts.properties = __saved; } catch (e) {}',
                '}',
            ];
            return run('Save Find/Change query', script(FIND_JSX + lines.join('\n')));
        },
    },
    {
        name: 'run_find_change_command',
        description: 'Run an Edit menu Find/Change command on the current selection and the criteria in Find/Change (set them with run_find_change keepCriteria: true or a loaded query): Find Next, load the selected text into Find What or Change To, load it and find the next match, or replace the selection with the Change To text (and find the next). Returns the new selection',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    enum: ['find_next', 'load_find_with_selection', 'load_find_and_find_next', 'load_change_with_selection', 'replace_with_change_to', 'replace_and_find_next'],
                    description: 'find_next (Edit > Find Next); load_find_with_selection (selected text into Find What); load_find_and_find_next; load_change_with_selection (selected text into Change To); replace_with_change_to (replace the selection); replace_and_find_next',
                },
            },
            required: ['command'],
        },
        features: [
            'indesign.find_change.find_next',
            'indesign.find_change.load_find_with_selection',
            'indesign.find_change.load_find_and_find_next',
            'indesign.find_change.load_change_with_selection',
            'indesign.find_change.replace_with_change_to',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const id = pick(a.command, {
                find_next: 18695, load_find_with_selection: 18689, load_find_and_find_next: 18690,
                load_change_with_selection: 18693, replace_with_change_to: 18692, replace_and_find_next: 18691,
            }, 'command');
            return run('Find/Change command', script(FIND_JSX + [
                `var ma = app.menuActions.itemByID(${id});`,
                `if (!ma.isValid) throw new Error("This InDesign version has no menu action ${id}");`,
                'if (!ma.enabled) throw new Error(ma.title + " is not available now: it needs selected text, and Find Next needs criteria in Find/Change");',
                'ma.invoke();',
                'var sel = app.selection.length ? __hit(app.selection[0]) : null;',
                `__result__ = { command: ma.title, selection: sel, findWhat: app.findTextPreferences.findWhat, changeTo: app.changeTextPreferences.changeTo };`,
            ].join('\n')));
        },
    },
];
