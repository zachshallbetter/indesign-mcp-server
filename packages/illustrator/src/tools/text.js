/**
 * Type tools: type on a path, change case, special characters, Smart
 * Punctuation, placeholder text, fonts, find and replace, text wrap, stories,
 * legacy text, orientation, importing and exporting text, and Asian and
 * right-to-left composition.
 *
 * Find and Replace, Find/Replace Font and Smart Punctuation open dialogs, so
 * they are done through the object model the way the dialogs describe them,
 * editing text character by character so formatting is kept. Type on a path
 * effects run their Type > Type on a Path commands, which open no dialog.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

/** A string literal with every non-ASCII character escaped, so the script file stays ASCII. */
const lit = (s) => str(s).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Type > Type on a Path effects and their commands. */
export const PATH_EFFECTS = { rainbow: 'Rainbow', skew: 'Skew', ribbon_3d: '3D ribbon', stair_step: 'Stair Step', gravity: 'Gravity' };

/** Type > Insert Special Character, Insert White Space Character and Insert Break Character. */
export const SPECIAL_CHARACTERS = {
    bullet: ['\u2022', 'insert_bullet'],
    copyright: ['\u00a9', 'insert_copyright'],
    ellipsis: ['\u2026', 'insert_ellipsis'],
    paragraph_symbol: ['\u00b6', 'insert_paragraph_symbol'],
    registered: ['\u00ae', 'insert_registered'],
    section: ['\u00a7', 'insert_section'],
    trademark: ['\u2122', 'insert_trademark'],
    em_dash: ['\u2014', 'insert_em_dash'],
    en_dash: ['\u2013', 'insert_en_dash'],
    discretionary_hyphen: ['\u00ad', 'insert_discretionary_hyphen'],
    double_left_quote: ['\u201c', 'insert_double_left_quote'],
    double_right_quote: ['\u201d', 'insert_double_right_quote'],
    single_left_quote: ['\u2018', 'insert_single_left_quote'],
    single_right_quote: ['\u2019', 'insert_single_right_quote'],
    em_space: ['\u2003', 'insert_em_space'],
    en_space: ['\u2002', 'insert_en_space'],
    hair_space: ['\u200a', 'insert_hair_space'],
    thin_space: ['\u2009', 'insert_thin_space'],
    nonbreaking_space: ['\u00a0', 'insert_nonbreaking_space'],
    // Illustrator stores a forced line break (Shift+Return) as U+0003.
    forced_line_break: ['\u0003', 'insert_forced_line_break'],
};

/** Type menu commands that open no dialog. */
const TYPE_COMMANDS = {
    convert_bullets_to_text: { command: 'convert list style to text', target: true },
    show_hidden_characters: { command: 'showHiddenChar', target: false },
    auto_spell_check: { command: 'Auto Spell Check', target: false },
};

const CASES = { upper: 'UPPERCASE', lower: 'LOWERCASE', title: 'TITLECASE', sentence: 'SENTENCECASE' };
const KINSOKU_ORDER = { push_in: 'PUSHIN', push_out_first: 'PUSHOUTFIRST', push_out_only: 'PUSHOUTONLY' };
const DIGITS = { default: 'DEFAULT_DIGITS', arabic: 'ARABIC_DIGITS', hindi: 'HINDI_DIGITS', farsi: 'FARSI_DIGITS' };
const KASHIDAS = { default: 'DEFAULT_KASHIDAS', on: 'KASHIDAS_ON', off: 'KASHIDAS_OFF' };
const DIR_OVERRIDE = { default: 'DEFAULT_DIRECTION', left_to_right: 'LEFT_TO_RIGHT_DIRECTION', right_to_left: 'RIGHT_TO_LEFT_DIRECTION' };

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '
    + 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. '
    + 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. '
    + 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';

const FRAMES_SCHEMA = { ...TARGET_SCHEMA, description: 'Text frames (groups are searched for them). Give ids, names, or selection: true' };
const SCOPE_SCHEMA = { ...TARGET_SCHEMA, description: 'Text frames to work on (groups are searched for them). Default: every story in the document' };

/** ES3: the text frames among items, looking inside groups. */
const FRAMES = String.raw`
function __frames(items) {
  var out = [];
  var walk = function (it) {
    if (it.typename === "TextFrame") out.push(it);
    else if (it.typename === "GroupItem") for (var g = 0; g < it.pageItems.length; g++) walk(it.pageItems[g]);
  };
  for (var i = 0; i < items.length; i++) walk(items[i]);
  if (!out.length) throw new Error("None of the items is a text frame");
  return out;
}`;

/** ES3: the stories of the given frames (each threaded story once), or every story in the document. */
const STORIES = String.raw`${FRAMES}
function __stories(doc, spec) {
  var out = [], seen = {}, i;
  if (!spec) { for (i = 0; i < doc.stories.length; i++) out.push(doc.stories[i]); return out; }
  var frames = __frames(__targets(doc, spec));
  for (i = 0; i < frames.length; i++) {
    var s = frames[i].story, key = String(i);
    try { key = s.textFrames[0].uuid; } catch (e) {}
    if (!seen[key]) { seen[key] = true; out.push(s); }
  }
  return out;
}
function __storyInfo(s) {
  var ids = [];
  for (var f = 0; f < s.textFrames.length; f++) { try { ids.push(s.textFrames[f].uuid); } catch (e) {} }
  return ids;
}`;

/**
 * ES3: find a string in text, and replace a span of a story's characters in
 * place. Removing the extra characters and rewriting the first keeps that
 * character's formatting.
 */
const EDIT = String.raw`
function __isWordChar(c) {
  return c !== "" && /[0-9A-Za-z_\u00c0-\u024f\u0370-\u052f\u0590-\u06ff\u0900-\u0dff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(c);
}
function __find(text, find, matchCase, wholeWord) {
  var hay = matchCase ? text : text.toLowerCase(), needle = matchCase ? find : find.toLowerCase(), out = [], from = 0, i;
  while ((i = hay.indexOf(needle, from)) >= 0) {
    var ok = !wholeWord || (!__isWordChar(i > 0 ? text.charAt(i - 1) : "") && !__isWordChar(text.charAt(i + find.length)));
    if (ok) { out.push(i); from = i + find.length; } else from = i + 1;
  }
  return out;
}
function __replaceAt(story, i, len, rep) {
  for (var k = i + len - 1; k > i; k--) story.characters[k].remove();
  if (rep.length) story.characters[i].contents = rep;
  else story.characters[i].remove();
}`;

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the characters that fit in a frame (area text that overflows shows fewer). */
const VISIBLE = `
function __visible(tf) {
  var n = 0;
  for (var l = 0; l < tf.lines.length; l++) n += tf.lines[l].characters.length;
  return n;
}`;

/** ES3: look up a font by PostScript name, with a clear error. */
const FONT = `
function __font(name) {
  try { return app.textFonts.getByName(name); } catch (e) { throw new Error("Font not found: " + name + ". Use list_fonts for PostScript names"); }
}`;

/** Path text position: a fraction of the path, 0 = its start, 1 = its end. */
const fraction = (v, name) => num(v, { min: 0, max: 1, name });

/** Body prefix for a new frame: layer, artboard and point. */
function placement(a) {
    return `
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
if (layer.locked || !layer.visible) throw new Error("Layer " + layer.name + " is locked or hidden");
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var p = __toDoc(doc, ab, ${num(a.x, { name: 'x' })}, ${num(a.y, { name: 'y' })});`;
}

/** Validate an absolute .txt path. */
function textFile(filePath) {
    const p = paths.validate(filePath);
    if (path.extname(p).toLowerCase() !== '.txt') throw new Error('filePath must end in .txt');
    return p;
}

export const tools = [
    // Type on a path
    {
        name: 'create_path_text',
        description: 'Put text on or inside a path (Type on a Path tool, or the Area Type tool on a shape). kind path runs the text along the path; area flows it inside the shape. The path becomes the text\'s path, as with the tools; give keepPath to leave the original in place',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One path (not a group or compound path)' },
                contents: { type: 'string', description: 'The text. Use \\r for new paragraphs' },
                kind: { type: 'string', enum: ['path', 'area'], default: 'path', description: 'path: along the path; area: inside the shape' },
                orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Vertical Type on a Path / Vertical Area Type. Default horizontal' },
                font: { type: 'string', description: 'PostScript font name (list_fonts)' },
                size: { type: 'number', minimum: 0.1, maximum: 1296, description: 'Font size in points' },
                start: { type: 'number', minimum: 0, maximum: 1, description: 'Path text: where the text starts, 0 (path start) to 1 (path end), counted by segments' },
                end: { type: 'number', minimum: 0, maximum: 1, description: 'Path text: where the text ends, 0 to 1' },
                keepPath: { type: 'boolean', description: 'Keep the original path as well. Default false', default: false },
                name: { type: 'string', description: 'Name for the new text frame' },
            },
            required: ['target', 'contents'],
        },
        features: ['illustrator.typography.path_type', 'illustrator.typography.text_on_vector'],
        hints: { destructive: true },
        auditArgs: { start: 0.1, end: 0.9 },
        handler: (a) => {
            const kind = enumOf(a.kind ?? 'path', ['path', 'area'], { name: 'kind' });
            if (kind === 'area' && (a.start !== undefined || a.end !== undefined)) throw new Error('start and end apply to path text only (kind: "path")');
            const orientation = a.orientation ? enumOf(a.orientation, ['horizontal', 'vertical'], { name: 'orientation' }).toUpperCase() : null;
            return run('Create path text', script(`${FONT}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1 || items[0].typename !== "PathItem") throw new Error("Give one path (not a group or compound path) to put the text on");
var src = items[0];
if (src.pathPoints.length < 2) throw new Error("The path needs at least two anchor points");
var tf = src.layer.textFrames.${kind === 'area' ? 'areaText' : 'pathText'}(src);
tf.move(src, ElementPlacement.PLACEBEFORE);
tf.contents = ${lit(a.contents)};
${orientation ? `tf.orientation = TextOrientation.${orientation};` : ''}
${a.font ? `tf.textRange.characterAttributes.textFont = __font(${str(a.font)});` : ''}
${a.size !== undefined ? `tf.textRange.characterAttributes.size = ${num(a.size, { min: 0.1, max: 1296, name: 'size' })};` : ''}
var segs = tf.textPath.closed ? tf.textPath.pathPoints.length : tf.textPath.pathPoints.length - 1;
${a.start !== undefined ? `tf.startTValue = segs * ${fraction(a.start, 'start')};` : ''}
${a.end !== undefined ? `tf.endTValue = segs * ${fraction(a.end, 'end')};` : ''}
${a.name ? `tf.name = ${str(a.name)};` : ''}
${a.keepPath ? '' : 'try { if (src.typename === "PathItem") src.remove(); } catch (e) {}'}
var info = __itemInfo(doc, tf);
info.kind = ${str(kind)};
__result__ = info;`));
        },
    },
    {
        name: 'set_path_text',
        description: 'Change type on a path (Type > Type on a Path and Type on a Path Options): apply an effect (rainbow, skew, 3D ribbon, stair step, gravity), slide the text along the path with start and end, set spacing, flip the text to the other side of the path, or update legacy path type. Align to Path (baseline, ascender, descender, centre) is only in the dialog and is not offered',
        inputSchema: {
            type: 'object',
            properties: {
                target: FRAMES_SCHEMA,
                effect: { type: 'string', enum: Object.keys(PATH_EFFECTS), description: 'Type > Type on a Path effect' },
                start: { type: 'number', minimum: 0, maximum: 1, description: 'Where the text starts, 0 (path start) to 1 (path end), counted by segments' },
                end: { type: 'number', minimum: 0, maximum: 1, description: 'Where the text ends, 0 to 1' },
                spacing: { type: 'number', minimum: -1000, maximum: 1000, description: 'Spacing (Type on a Path Options): space added between characters on tight curves, in points' },
                flip: { type: 'boolean', description: 'true: flip the text to the other side of the path, by reversing the path\'s direction (Object > Path > Reverse Path Direction). Flipping again flips back' },
                updateLegacy: { type: 'boolean', description: 'true: Type > Type on a Path > Update Legacy Type on a Path, first' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.typography.path_rainbow',
            'illustrator.typography.path_skew',
            'illustrator.typography.path_3d_ribbon',
            'illustrator.typography.path_stair_step',
            'illustrator.typography.path_gravity',
            'illustrator.typography.type_on_path_options',
            'illustrator.typography.path_type_option.spacing',
            'illustrator.typography.move_flip_path_text',
            'illustrator.typography.update_legacy_type_on_path',
        ],
        menuCommands: [...Object.values(PATH_EFFECTS), 'Reverse Path Direction', 'updateLegacyTOP'],
        auditArgs: { effect: 'rainbow', start: 0.1, end: 0.9, spacing: 2, flip: true, updateLegacy: true },
        handler: (a) => {
            const effect = a.effect ? enumOf(a.effect, Object.keys(PATH_EFFECTS), { name: 'effect' }) : null;
            if (!effect && a.start === undefined && a.end === undefined && a.spacing === undefined && !a.flip && !a.updateLegacy) {
                throw new Error('Give at least one of effect, start, end, spacing, flip, updateLegacy');
            }
            if (a.start !== undefined && a.end !== undefined && Number(a.start) >= Number(a.end)) throw new Error('start must be below end');
            return run('Set path text', script(`${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)}));
for (var i = 0; i < items.length; i++) if (items[i].kind !== TextType.PATHTEXT) throw new Error((items[i].name || "A text frame") + " is not type on a path");
${a.updateLegacy ? `${SELECT}\napp.executeMenuCommand("updateLegacyTOP");` : ''}
${effect ? `${SELECT}\napp.executeMenuCommand(${str(PATH_EFFECTS[effect])});` : ''}
${a.flip ? `${SELECT}\napp.executeMenuCommand("Reverse Path Direction");` : ''}
var out = [];
for (var j = 0; j < items.length; j++) {
  var tf = items[j], segs = tf.textPath.closed ? tf.textPath.pathPoints.length : tf.textPath.pathPoints.length - 1;
  ${a.start !== undefined ? `tf.startTValue = segs * ${fraction(a.start, 'start')};` : ''}
  ${a.end !== undefined ? `tf.endTValue = segs * ${fraction(a.end, 'end')};` : ''}
  ${a.spacing !== undefined ? `tf.spacing = ${num(a.spacing, { min: -1000, max: 1000, name: 'spacing' })};` : ''}
  var info = __itemInfo(doc, tf);
  info.start = segs ? tf.startTValue / segs : 0; info.end = segs ? tf.endTValue / segs : 0; info.spacing = tf.spacing;
  out.push(info);
}
__result__ = { effect: ${effect ? str(effect) : 'null'}, flipped: ${bool(a.flip)}, frames: out };`));
        },
    },

    // Case, special characters, punctuation, placeholder text
    {
        name: 'change_case',
        description: 'Change the case of text frames\' text (Type > Change Case): UPPERCASE, lowercase, Title Case or Sentence case',
        inputSchema: {
            type: 'object',
            properties: { target: FRAMES_SCHEMA, case: { type: 'string', enum: Object.keys(CASES) } },
            required: ['target', 'case'],
        },
        features: ['illustrator.typography.case_upper', 'illustrator.typography.case_lower', 'illustrator.typography.case_title', 'illustrator.typography.case_sentence'],
        hints: { idempotent: true },
        handler: (a) => {
            const c = enumOf(a.case, Object.keys(CASES), { name: 'case' });
            return run('Change case', script(`${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var i = 0; i < items.length; i++) { items[i].textRange.changeCaseTo(CaseChangeType.${CASES[c]}); out.push(items[i].uuid); }
__result__ = { case: ${str(c)}, frames: out };`));
        },
    },
    {
        name: 'insert_special_character',
        description: 'Insert a special, white space or break character into text frames (Type > Insert Special Character, Insert White Space Character, Insert Break Character): symbols, dashes, quotation marks, spaces and forced line break. At the start, at the end, or at a character index',
        inputSchema: {
            type: 'object',
            properties: {
                target: FRAMES_SCHEMA,
                character: { type: 'string', enum: Object.keys(SPECIAL_CHARACTERS) },
                position: { type: 'string', enum: ['end', 'start'], default: 'end' },
                index: { type: 'integer', minimum: 0, description: 'Insert before this character (0-based); overrides position' },
                count: { type: 'integer', minimum: 1, maximum: 100, default: 1, description: 'How many to insert' },
            },
            required: ['target', 'character'],
        },
        features: Object.values(SPECIAL_CHARACTERS).map(([, id]) => `illustrator.typography.${id}`),
        handler: (a) => {
            const name = enumOf(a.character, Object.keys(SPECIAL_CHARACTERS), { name: 'character' });
            const position = enumOf(a.position ?? 'end', ['end', 'start'], { name: 'position' });
            const count = Number(index(a.count ?? 1, { name: 'count', max: 100 }));
            if (count < 1) throw new Error('count must be at least 1');
            const at = a.index === undefined ? null : index(a.index, { name: 'index' });
            return run('Insert special character', script(`${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)})), ch = ${lit(SPECIAL_CHARACTERS[name][0].repeat(count))}, out = [];
for (var i = 0; i < items.length; i++) {
  var tf = items[i], n = tf.characters.length, at = ${at ?? (position === 'end' ? 'n' : '0')};
  if (at > n) throw new Error((tf.name || "A text frame") + " has " + n + " characters; index must be at most " + n);
  if (n === 0) tf.contents = ch;
  else tf.insertionPoints[at].characters.add(ch);
  out.push({ id: tf.uuid, at: at });
}
__result__ = { character: ${str(name)}, inserted: out };`));
        },
    },
    {
        name: 'apply_smart_punctuation',
        description: 'Replace keyboard punctuation with typographer\'s punctuation, the way Type > Smart Punctuation does: straight quotes to curly quotes, -- to an en dash and --- to an em dash, ... to an ellipsis, multiple spaces after a period to one, and optionally ff/fi/fl/ffi/ffl ligatures and fractions such as 1/2. Formatting is kept',
        inputSchema: {
            type: 'object',
            properties: {
                target: SCOPE_SCHEMA,
                quotes: { type: 'boolean', default: true, description: 'Smart Quotes' },
                dashes: { type: 'boolean', default: true, description: 'En, Em Dashes (-- and ---)' },
                ellipses: { type: 'boolean', default: true, description: 'Ellipses (...)' },
                spaces: { type: 'boolean', default: true, description: 'Smart Spaces: one space after a period' },
                ligatures: { type: 'boolean', default: false, description: 'ff, fi, fl, ffi, ffl Ligatures (turns on the font\'s ligatures for those letters)' },
                fractions: { type: 'boolean', default: false, description: 'Expert Fractions (turns on the font\'s fractions for numbers like 1/2)' },
            },
        },
        features: ['illustrator.typography.smart_punctuation'],
        hints: { idempotent: true },
        handler: (a) => {
            const o = { quotes: a.quotes ?? true, dashes: a.dashes ?? true, ellipses: a.ellipses ?? true, spaces: a.spaces ?? true, ligatures: a.ligatures ?? false, fractions: a.fractions ?? false };
            if (!Object.values(o).some(Boolean)) throw new Error('Turn on at least one of quotes, dashes, ellipses, spaces, ligatures, fractions');
            return run('Smart punctuation', script(`${STORIES}${EDIT}
var stories = __stories(doc, ${a.target ? targetSpec(a.target) : 'null'}), counts = { quotes: 0, dashes: 0, ellipses: 0, spaces: 0, ligatures: 0, fractions: 0 };
for (var s = 0; s < stories.length; s++) {
  var story = stories[s], t = story.textRange.contents, edits = [], i = 0, k;
  ${o.ligatures ? String.raw`var lig = /ff[il]?|f[il]/g, m;
  while ((m = lig.exec(t))) { for (k = 0; k < m[0].length; k++) story.characters[m.index + k].characterAttributes.ligature = true; counts.ligatures++; }` : ''}
  ${o.fractions ? String.raw`var fr = /\d+\/\d+/g, f;
  while ((f = fr.exec(t))) { for (k = 0; k < f[0].length; k++) story.characters[f.index + k].characterAttributes.fractions = true; counts.fractions++; }` : ''}
  while (i < t.length) {
    var c = t.charAt(i);
    ${o.ellipses ? 'if (t.substr(i, 3) === "...") { edits.push([i, 3, "\\u2026"]); counts.ellipses++; i += 3; continue; }' : ''}
    ${o.dashes ? `if (t.substr(i, 3) === "---") { edits.push([i, 3, "\\u2014"]); counts.dashes++; i += 3; continue; }
    if (t.substr(i, 2) === "--") { edits.push([i, 2, "\\u2013"]); counts.dashes++; i += 2; continue; }` : ''}
    ${o.spaces ? `if (c === "." && t.substr(i + 1, 2) === "  ") { var j = i + 1; while (t.charAt(j) === " ") j++; edits.push([i + 1, j - i - 1, " "]); counts.spaces++; i = j; continue; }` : ''}
    ${o.quotes ? String.raw`if (c === "\"" || c === "'") {
      var open = i === 0 || /[\s(\[{\u201c\u2018\u2013\u2014]/.test(t.charAt(i - 1));
      edits.push([i, 1, c === "\"" ? (open ? "\u201c" : "\u201d") : (open ? "\u2018" : "\u2019")]); counts.quotes++;
    }` : ''}
    i++;
  }
  for (var e = edits.length - 1; e >= 0; e--) __replaceAt(story, edits[e][0], edits[e][1], edits[e][2]);
}
__result__ = { stories: stories.length, replaced: counts };`));
        },
    },
    {
        name: 'fill_placeholder_text',
        description: 'Fill text frames with placeholder text (Type > Fill With Placeholder Text). Area text is filled to the edge of its frame; point and path text get one sentence. Existing text is replaced',
        inputSchema: { type: 'object', properties: { target: FRAMES_SCHEMA }, required: ['target'] },
        features: ['illustrator.typography.placeholder_text'],
        hints: { destructive: true, idempotent: true },
        handler: (a) => run('Fill placeholder text', script(`${FRAMES}${VISIBLE}
var items = __frames(__targets(doc, ${targetSpec(a.target)})), L = ${lit(LOREM)}, out = [];
for (var i = 0; i < items.length; i++) {
  var tf = items[i];
  if (tf.kind === TextType.AREATEXT) {
    var s = L;
    tf.contents = s;
    while (__visible(tf) >= tf.characters.length && s.length < 30000) { s = s + " " + L; tf.contents = s; }
    var fit = __visible(tf);
    if (fit < tf.characters.length) {
      var cut = s.substr(0, fit), sp = cut.lastIndexOf(" ");
      tf.contents = sp > 0 ? cut.substr(0, sp) : cut;
    }
  } else {
    tf.contents = L.substr(0, L.indexOf(".") + 1);
  }
  out.push({ id: tf.uuid, characters: tf.characters.length });
}
__result__ = { frames: out };`)),
    },
    {
        name: 'run_type_command',
        description: 'Run a Type or Edit menu command that opens no dialog: convert_bullets_to_text (Type > Bullets and Numbering > Convert to text, on the targets), show_hidden_characters (Type > Show Hidden Characters) or auto_spell_check (Edit > Spelling > Auto Spell Check). The last two switch the setting on or off each time; Illustrator does not report which',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(TYPE_COMMANDS) },
                target: { ...FRAMES_SCHEMA, description: 'Text frames, for convert_bullets_to_text' },
            },
            required: ['command'],
        },
        features: ['illustrator.typography.bullets_to_text', 'illustrator.typography.show_hidden_chars', 'illustrator.typography.auto_spell_check'],
        menuCommands: Object.values(TYPE_COMMANDS).map((c) => c.command),
        auditArgs: { command: 'convert_bullets_to_text', target: { selection: true } },
        handler: (a) => {
            const name = enumOf(a.command, Object.keys(TYPE_COMMANDS), { name: 'command' });
            const c = TYPE_COMMANDS[name];
            if (c.target && !a.target) throw new Error(`${name} acts on text frames: give target`);
            return run('Type command', script(c.target ? `${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)}));
${SELECT}
app.executeMenuCommand(${str(c.command)});
__result__ = { command: ${str(name)}, frames: items.length };` : `
app.executeMenuCommand(${str(c.command)});
__result__ = { command: ${str(name)}, toggled: true };`, { needsDocument: c.target }));
        },
    },

    // Fonts
    {
        name: 'list_document_fonts',
        description: 'List the fonts used in the document\'s text, with how many characters use each and whether each is missing (not installed or activated)',
        inputSchema: { type: 'object', properties: { target: SCOPE_SCHEMA } },
        features: ['illustrator.typography.missing_fonts'],
        hints: { readOnly: true },
        handler: (a) => run('List document fonts', script(`${STORIES}
var stories = __stories(doc, ${a.target ? targetSpec(a.target) : 'null'}), fonts = {}, order = [];
for (var s = 0; s < stories.length; s++) {
  var runs = stories[s].textRanges;
  for (var r = 0; r < runs.length; r++) {
    var f = null, name = "(unknown)";
    try { f = runs[r].characterAttributes.textFont; name = f.name; } catch (e) {}
    if (!fonts[name]) {
      var avail = false;
      try { avail = app.textFonts.isFontAvailable(name); } catch (e2) { try { app.textFonts.getByName(name); avail = true; } catch (e3) {} }
      fonts[name] = { name: name, family: f ? f.family : null, style: f ? f.style : null, missing: !avail, characters: 0, stories: 0, _last: -1 };
      order.push(name);
    }
    fonts[name].characters += runs[r].characters.length;
    if (fonts[name]._last !== s) { fonts[name]._last = s; fonts[name].stories++; }
  }
}
var out = [], missing = 0;
for (var i = 0; i < order.length; i++) { var x = fonts[order[i]]; delete x._last; if (x.missing) missing++; out.push(x); }
__result__ = { fonts: out, missing: missing };`)),
    },
    {
        name: 'replace_font',
        description: 'Replace fonts in the document\'s text (Type > Find/Replace Font, and the replace step of Type > Resolve Missing Fonts): every run in the from fonts, or in every missing font, gets the to font. Other formatting is kept. Activating fonts from Adobe Fonts is not done',
        inputSchema: {
            type: 'object',
            properties: {
                to: { type: 'string', description: 'PostScript name of the replacement font (list_fonts)' },
                from: { type: 'array', items: { type: 'string' }, description: 'PostScript names to replace (list_document_fonts)' },
                missing: { type: 'boolean', description: 'Replace every missing font', default: false },
                target: SCOPE_SCHEMA,
            },
            required: ['to'],
        },
        features: ['illustrator.typography.find_replace_font', 'illustrator.typography.resolve_missing_fonts'],
        hints: { idempotent: true },
        auditArgs: { from: ['MyriadPro-Regular'], missing: true },
        handler: (a) => {
            const from = Array.isArray(a.from) ? a.from.map(String).filter(Boolean) : [];
            if (!from.length && !a.missing) throw new Error('Give from (font names to replace) or missing: true');
            const want = {};
            for (const f of from) want[f] = true;
            return run('Replace font', script(`${STORIES}${FONT}
var to = __font(${str(a.to)}), want = ${json(want)}, stories = __stories(doc, ${a.target ? targetSpec(a.target) : 'null'}), counts = {}, total = 0, avail = {};
var isMissing = function (name) {
  if (avail[name] === undefined) { try { avail[name] = app.textFonts.isFontAvailable(name); } catch (e) { try { app.textFonts.getByName(name); avail[name] = true; } catch (e2) { avail[name] = false; } } }
  return !avail[name];
};
for (var s = 0; s < stories.length; s++) {
  var runs = stories[s].textRanges;
  for (var r = runs.length - 1; r >= 0; r--) {
    var name = null;
    try { name = runs[r].characterAttributes.textFont.name; } catch (e) { continue; }
    if (name === to.name) continue;
    if (want.hasOwnProperty(name) || (${bool(a.missing)} && isMissing(name))) {
      var n = runs[r].characters.length;
      runs[r].characterAttributes.textFont = to;
      counts[name] = (counts[name] || 0) + n; total += n;
    }
  }
}
__result__ = { to: to.name, replaced: counts, characters: total };`));
        },
    },

    // Find and replace
    {
        name: 'find_replace_text',
        description: 'Find text across the document or in text frames, and optionally replace it (Edit > Find and Replace, Find Next), with Match Case and Whole Word. Without replace, matches are listed, and selectMatch selects one of them in the text, like Find Next. Formatting is kept; threaded frames are searched as one story',
        inputSchema: {
            type: 'object',
            properties: {
                find: { type: 'string', minLength: 1 },
                replace: { type: 'string', description: 'Replacement text. Omit to only find' },
                matchCase: { type: 'boolean', default: false },
                wholeWord: { type: 'boolean', default: false },
                target: SCOPE_SCHEMA,
                selectMatch: { type: 'integer', minimum: 0, description: 'Find only: select this match (0-based) in the text' },
            },
            required: ['find'],
        },
        features: ['illustrator.typography.find_replace', 'illustrator.typography.find_next'],
        hints: { destructive: true },
        auditArgs: { replace: undefined, selectMatch: 0 },
        handler: (a) => {
            if (typeof a.find !== 'string' || !a.find.length) throw new Error('find must be non-empty text');
            if (a.find.length > 1000) throw new Error('find is longer than 1000 characters');
            const replacing = a.replace !== undefined && a.replace !== null;
            if (replacing && a.selectMatch !== undefined) throw new Error('selectMatch is for finding only: leave out replace');
            const sel = a.selectMatch === undefined ? null : index(a.selectMatch, { name: 'selectMatch' });
            return run('Find and replace', script(`${STORIES}${EDIT}
var stories = __stories(doc, ${a.target ? targetSpec(a.target) : 'null'}), find = ${lit(a.find)}, out = [], total = 0, picked = null;
for (var s = 0; s < stories.length; s++) {
  var story = stories[s], t = story.textRange.contents, hits = __find(t, find, ${bool(a.matchCase)}, ${bool(a.wholeWord)});
  if (!hits.length) continue;
  for (var h = 0; h < hits.length && out.length < 500; h++) out.push({ story: s, frames: __storyInfo(story), offset: hits[h], context: t.substr(Math.max(0, hits[h] - 20), find.length + 40) });
  ${replacing ? `for (var r = hits.length - 1; r >= 0; r--) __replaceAt(story, hits[r], find.length, ${lit(a.replace)});` : ''}
  ${sel !== null ? `if (picked === null && total + hits.length > ${sel}) {
    var at = hits[${sel} - total];
    doc.selection = null;
    for (var c = 0; c < find.length; c++) story.characters[at + c].select(c > 0);
    picked = { story: s, offset: at };
  }` : ''}
  total += hits.length;
}
${sel !== null ? `if (picked === null) throw new Error("There are " + total + " matches; selectMatch must be below " + total);` : ''}
__result__ = { matches: total, ${replacing ? 'replaced: total, ' : ''}selected: picked, found: out };`));
        },
    },

    // Text wrap
    {
        name: 'set_text_wrap',
        description: 'Make or release text wrap on objects (Object > Text Wrap > Make, Release, Text Wrap Options): text in frames below the object flows around it, at an offset, or inside it with invert. The object must be above the text',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                wrap: { type: 'boolean', description: 'true: Make; false: Release. Default true', default: true },
                offset: { type: 'number', minimum: -1000, maximum: 1000, description: 'Offset in points between the object and the text' },
                invert: { type: 'boolean', description: 'Invert Wrap: flow the text inside the object' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.typography.text_wrap_make',
            'illustrator.typography.text_wrap_release',
            'illustrator.typography.text_wrap_options',
            'illustrator.typography.text_wrap_options_variant',
        ],
        hints: { idempotent: true },
        handler: (a) => run('Set text wrap', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  it.wrapped = ${bool(a.wrap ?? true)};
  ${a.offset !== undefined ? `it.wrapOffset = __len(doc, ${num(a.offset, { min: -1000, max: 1000, name: 'offset' })});` : ''}
  ${a.invert !== undefined ? `it.wrapInside = ${bool(a.invert)};` : ''}
  out.push({ id: it.uuid, wrapped: it.wrapped, offset: it.wrapOffset * __sf(doc), invert: it.wrapInside });
}
__result__ = { items: out };`)),
    },

    // Stories, legacy text, orientation, import and export
    {
        name: 'list_stories',
        description: 'List the document\'s stories (the text in one frame, or flowing through threaded frames), with their frames, length and the start of their text, plus how many legacy text objects need updating',
        inputSchema: {
            type: 'object',
            properties: {
                includeText: { type: 'boolean', default: false, description: 'Return each story\'s full text (up to 10000 characters) instead of the first 80' },
                limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
            },
        },
        features: ['illustrator.typography.story_object'],
        hints: { readOnly: true },
        handler: (a) => run('List stories', script(`${STORIES}
var max = ${index(a.limit ?? 200, { name: 'limit', max: 1000 })}, keep = ${a.includeText ? 10000 : 80}, out = [];
for (var s = 0; s < doc.stories.length && out.length < max; s++) {
  var st = doc.stories[s], t = st.textRange.contents;
  out.push({ index: s, frames: __storyInfo(st), threaded: st.textFrames.length > 1, characters: st.characters.length, paragraphs: st.paragraphs.length, text: t.substr(0, keep) });
}
__result__ = { total: doc.stories.length, stories: out, legacyText: doc.legacyTextItems.length };`)),
    },
    {
        name: 'update_legacy_text',
        description: 'Update legacy text (from Illustrator 10 or earlier) so it can be edited (Type > Legacy Text > Update All Legacy Text, or Update Selected Legacy Text for the targets). Line breaks and spacing can shift as the text is recomposed',
        inputSchema: {
            type: 'object',
            properties: {
                all: { type: 'boolean', description: 'Update every legacy text object in the document', default: false },
                target: { ...TARGET_SCHEMA, description: 'Legacy text objects to update (instead of all)' },
            },
        },
        features: ['illustrator.typography.legacy_text_object', 'illustrator.typography.legacy_update_all', 'illustrator.typography.legacy_update_selected'],
        hints: { destructive: true, idempotent: true },
        auditArgs: { all: false, target: { selection: true } },
        handler: (a) => {
            if (!a.all && !a.target) throw new Error('Give all: true, or target with the legacy text to update');
            if (a.all && a.target) throw new Error('Give all or target, not both');
            return run('Update legacy text', script(a.all ? `
var before = doc.legacyTextItems.length;
if (before) doc.legacyTextItems.convertToNative();
__result__ = { updated: before - doc.legacyTextItems.length, remaining: doc.legacyTextItems.length };` : `
var items = __targets(doc, ${targetSpec(a.target)}), n = 0;
for (var i = 0; i < items.length; i++) if (items[i].typename === "LegacyTextItem") { items[i].convertToNative(); n++; }
if (!n) throw new Error("None of the items is legacy text");
__result__ = { updated: n, remaining: doc.legacyTextItems.length };`));
        },
    },
    {
        name: 'set_text_orientation',
        description: 'Make text frames horizontal or vertical (Type > Type Orientation)',
        inputSchema: {
            type: 'object',
            properties: { target: FRAMES_SCHEMA, orientation: { type: 'string', enum: ['horizontal', 'vertical'] } },
            required: ['target', 'orientation'],
        },
        features: ['illustrator.typography.type_horizontal', 'illustrator.typography.type_vertical'],
        hints: { idempotent: true },
        handler: (a) => {
            const o = enumOf(a.orientation, ['horizontal', 'vertical'], { name: 'orientation' });
            return run('Set text orientation', script(`${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var i = 0; i < items.length; i++) { items[i].orientation = TextOrientation.${o.toUpperCase()}; out.push(__itemInfo(doc, items[i])); }
__result__ = { orientation: ${str(o)}, frames: out };`));
        },
    },
    {
        name: 'import_text',
        description: 'Bring a plain text file (.txt, UTF-8) into the document: into a new point or area text frame at x, y, or replacing the text of one frame (File > Place for text). Line breaks become paragraphs',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .txt path' },
                target: { ...FRAMES_SCHEMA, description: 'One text frame whose text is replaced. Omit to make a new frame at x, y' },
                artboardIndex: ARTBOARD_SCHEMA,
                x: { type: 'number', description: 'New frame: left, in points from the artboard' },
                y: { type: 'number', description: 'New frame: top (area text) or first baseline (point text)' },
                width: { type: 'number', minimum: 1, description: 'New area text frame width; omit for point text' },
                height: { type: 'number', minimum: 1, description: 'New area text frame height' },
                layer: { type: 'string', description: 'Layer for a new frame. Default: the active layer' },
            },
            required: ['filePath'],
        },
        features: ['illustrator.typography.import_text'],
        hints: { destructive: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.txt'), target: undefined, layer: undefined },
        handler: (a) => {
            const p = textFile(a.filePath);
            const area = a.width !== undefined || a.height !== undefined;
            if (!a.target) {
                if (a.x === undefined || a.y === undefined) throw new Error('Give x and y for a new frame, or target to replace a frame\'s text');
                if (area && (a.width === undefined || a.height === undefined)) throw new Error('Area text needs width and height');
            }
            return run('Import text', script(`${FRAMES}
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
if (f.length > 2000000) throw new Error("The file is larger than 2 MB");
f.encoding = "UTF-8";
if (!f.open("r")) throw new Error("Could not open " + f.fsName);
var text = f.read();
f.close();
text = text.replace(/\\r\\n|\\n/g, "\\r");
var tf;
${a.target ? `
var items = __frames(__targets(doc, ${targetSpec(a.target)}));
if (items.length !== 1) throw new Error("Give one text frame to import into");
tf = items[0];` : `${placement(a)}
${area ? `
var box = layer.pathItems.rectangle(p[1], p[0], __len(doc, ${num(a.width ?? 1, { min: 1, name: 'width' })}), __len(doc, ${num(a.height ?? 1, { min: 1, name: 'height' })}));
tf = layer.textFrames.areaText(box);` : 'tf = layer.textFrames.pointText(p);'}`}
tf.contents = text;
var info = __itemInfo(doc, tf);
info.file = f.fsName; info.characters = tf.characters.length;
__result__ = info;`));
        },
    },
    {
        name: 'export_text',
        description: 'Save text to a plain text file (.txt, UTF-8): the stories of the given frames, or every story in the document, separated by blank lines (File > Export > Text Format)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .txt path; an existing file is replaced' },
                target: SCOPE_SCHEMA,
            },
            required: ['filePath'],
        },
        features: ['illustrator.typography.export_text'],
        hints: { idempotent: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.txt') },
        handler: (a) => {
            const p = textFile(a.filePath);
            return run('Export text', script(`${STORIES}
var stories = __stories(doc, ${a.target ? targetSpec(a.target) : 'null'}), parts = [];
for (var s = 0; s < stories.length; s++) parts.push(stories[s].textRange.contents.replace(/[\\r\\u0003]/g, "\\n"));
var f = new File(${jsxPath(p)});
f.encoding = "UTF-8";
if (!f.open("w")) throw new Error("Could not write " + f.fsName);
f.write(parts.join("\\n\\n"));
f.close();
__result__ = { file: f.fsName, stories: parts.length };`));
        },
    },

    // Asian and right-to-left composition
    {
        name: 'set_asian_type',
        description: 'Set Japanese and other Asian composition on text frames: the Adobe Asian (Latin and CJK) composer, single-line or every-line; kinsoku shori and mojikumi sets (by the names the document defines) and the kinsoku order; and the character options tsume, aki, tate-chu-yoko and warichu',
        inputSchema: {
            type: 'object',
            properties: {
                target: FRAMES_SCHEMA,
                composer: { type: 'string', enum: ['single_line', 'every_line'], description: 'Use the Latin and CJK composer, single-line or every-line' },
                kinsoku: { type: 'string', description: 'Kinsoku shori set name, e.g. "Hard" or "Soft" (the document\'s sets are listed if the name is wrong)' },
                kinsokuOrder: { type: 'string', enum: Object.keys(KINSOKU_ORDER), description: 'Kinsoku type: push in first, push out first, or push out only' },
                mojikumi: { type: 'string', description: 'Mojikumi set name (the document\'s sets are listed if the name is wrong)' },
                tsume: { type: 'number', minimum: 0, maximum: 100, description: 'Tsume: % of space removed around each character' },
                akiLeft: { type: 'number', minimum: -10, maximum: 10, description: 'Aki before each character, in ems' },
                akiRight: { type: 'number', minimum: -10, maximum: 10, description: 'Aki after each character, in ems' },
                tateChuYoko: { type: 'boolean', description: 'Tate-chu-yoko: set the characters horizontally within vertical text' },
                wariChu: { type: 'boolean', description: 'Warichu: set the characters in smaller lines within one line' },
                wariChuLines: { type: 'integer', minimum: 1, maximum: 10 },
                wariChuScale: { type: 'number', minimum: 1, maximum: 100, description: 'Warichu size, %' },
            },
            required: ['target'],
        },
        features: ['illustrator.typography.asian_composers', 'illustrator.typography.japanese_formatting', 'illustrator.typography.asian_characters'],
        hints: { idempotent: true },
        auditArgs: { composer: 'every_line', kinsoku: 'Hard', mojikumi: 'Sample', kinsokuOrder: 'push_in' },
        handler: (a) => {
            const p = [], c = [], checks = [];
            if (a.composer !== undefined) {
                const comp = enumOf(a.composer, ['single_line', 'every_line'], { name: 'composer' });
                p.push('pa.composerEngine = ComposerEngineType.latinCJKComposer;', `pa.everyLineComposer = ${bool(comp === 'every_line')};`);
            }
            for (const [arg, list] of [['kinsoku', 'kinsokuSet'], ['mojikumi', 'mojikumiSet']]) {
                if (a[arg] === undefined) continue;
                checks.push(`__inSet(${str(a[arg])}, doc.${list}, ${str(arg)});`);
                p.push(`pa.${arg} = ${str(a[arg])};`);
            }
            if (a.kinsokuOrder !== undefined) p.push(`pa.kinsokuOrder = KinsokuOrderEnum.${KINSOKU_ORDER[enumOf(a.kinsokuOrder, Object.keys(KINSOKU_ORDER), { name: 'kinsokuOrder' })]};`);
            if (a.tsume !== undefined) c.push(`ca.Tsume = ${num(a.tsume, { min: 0, max: 100, name: 'tsume' })};`);
            if (a.akiLeft !== undefined) c.push(`ca.akiLeft = ${num(a.akiLeft, { min: -10, max: 10, name: 'akiLeft' })};`);
            if (a.akiRight !== undefined) c.push(`ca.akiRight = ${num(a.akiRight, { min: -10, max: 10, name: 'akiRight' })};`);
            if (a.tateChuYoko !== undefined) c.push(`ca.baselineDirection = BaselineDirectionType.${a.tateChuYoko ? 'TateChuYoko' : 'Standard'};`);
            if (a.wariChu !== undefined) c.push(`ca.wariChuEnabled = ${bool(a.wariChu)};`);
            if (a.wariChuLines !== undefined) c.push(`ca.wariChuLines = ${index(a.wariChuLines, { name: 'wariChuLines', max: 10 })};`);
            if (a.wariChuScale !== undefined) c.push(`ca.wariChuScale = ${num(a.wariChuScale, { min: 1, max: 100, name: 'wariChuScale' })};`);
            if (!p.length && !c.length) throw new Error('Give at least one of composer, kinsoku, kinsokuOrder, mojikumi, tsume, akiLeft, akiRight, tateChuYoko, wariChu, wariChuLines, wariChuScale');
            return run('Set Asian type', script(`${FRAMES}
function __inSet(name, list, what) {
  var names = [];
  for (var k = 0; k < list.length; k++) { if (list[k] === name) return; names.push(list[k]); }
  throw new Error("No " + what + " set named " + name + ". The document has: " + (names.length ? names.join(", ") : "none"));
}
${checks.join('\n')}
var items = __frames(__targets(doc, ${targetSpec(a.target)}));
for (var i = 0; i < items.length; i++) {
  var pa = items[i].textRange.paragraphAttributes, ca = items[i].textRange.characterAttributes;
  ${p.join('\n  ')}
  ${c.join('\n  ')}
}
__result__ = { frames: items.length };`));
        },
    },
    {
        name: 'set_right_to_left_text',
        description: 'Set up Arabic and Hebrew text on text frames: paragraph direction, the Middle Eastern composer, digit set, kashidas and character direction',
        inputSchema: {
            type: 'object',
            properties: {
                target: FRAMES_SCHEMA,
                direction: { type: 'string', enum: ['right_to_left', 'left_to_right'], description: 'Paragraph direction' },
                composer: { type: 'string', enum: ['middle_eastern', 'latin_cjk'], description: 'Composer engine: middle_eastern for Arabic and Hebrew, latin_cjk for the standard composer' },
                digits: { type: 'string', enum: Object.keys(DIGITS), description: 'Digit set' },
                kashidas: { type: 'string', enum: Object.keys(KASHIDAS), description: 'Insert kashidas to justify Arabic text' },
                characterDirection: { type: 'string', enum: Object.keys(DIR_OVERRIDE), description: 'Character direction override' },
            },
            required: ['target'],
        },
        features: ['illustrator.typography.arabic_hebrew'],
        hints: { idempotent: true },
        handler: (a) => {
            const p = [], c = [];
            if (a.direction !== undefined) p.push(`pa.paragraphDirection = ParagraphDirectionType.${enumOf(a.direction, ['right_to_left', 'left_to_right'], { name: 'direction' }).toUpperCase()}_DIRECTION;`);
            if (a.composer !== undefined) p.push(`pa.composerEngine = ComposerEngineType.${enumOf(a.composer, ['middle_eastern', 'latin_cjk'], { name: 'composer' }) === 'middle_eastern' ? 'optycaComposer' : 'latinCJKComposer'};`);
            if (a.digits !== undefined) c.push(`ca.digitSet = DigitSetType.${DIGITS[enumOf(a.digits, Object.keys(DIGITS), { name: 'digits' })]};`);
            if (a.kashidas !== undefined) c.push(`ca.kashidas = KashidasType.${KASHIDAS[enumOf(a.kashidas, Object.keys(KASHIDAS), { name: 'kashidas' })]};`);
            if (a.characterDirection !== undefined) c.push(`ca.dirOverride = DirOverrideType.${DIR_OVERRIDE[enumOf(a.characterDirection, Object.keys(DIR_OVERRIDE), { name: 'characterDirection' })]};`);
            if (!p.length && !c.length) throw new Error('Give at least one of direction, composer, digits, kashidas, characterDirection');
            return run('Set right-to-left text', script(`${FRAMES}
var items = __frames(__targets(doc, ${targetSpec(a.target)}));
for (var i = 0; i < items.length; i++) {
  var pa = items[i].textRange.paragraphAttributes, ca = items[i].textRange.characterAttributes;
  ${p.join('\n  ')}
  ${c.join('\n  ')}
}
__result__ = { frames: items.length };`));
        },
    },
];
