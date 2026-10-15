/**
 * Language and proofing: Autocorrect word pairs, user dictionaries and
 * document hyphenation exceptions (including word list files), languages
 * with their spelling, hyphenation and thesaurus vendors, quotes and Hunspell
 * dictionary paths, and applying a language (and a Duden hyphenation style)
 * to text, styles or the defaults. Spelling, Autocorrect and Dictionary
 * preferences are set_indesign_preferences.
 */
import { str } from 'adobe-mcp-core';
import { script } from './script.js';
import { run } from './run.js';
import { has, obj, known, idList, text, textList, pick, filePath } from './checks.js';

const HYPH_STYLES = {
    aesthetic: 'HyphenationStyleEnum.HYPH_AESTHETIC',
    preferred_aesthetic: 'HyphenationStyleEnum.HYPH_PREFERRED_AESTHETIC',
    all_but_unaesthetic: 'HyphenationStyleEnum.HYPH_ALL_BUT_UNAESTHETIC',
    all: 'HyphenationStyleEnum.HYPH_ALL',
};

/** Script helpers: a language-keyed collection item with a helpful error. */
const LANG_JSX = String.raw`
var __byLanguage = function (list, name, what) {
  var it = list.itemByName(name);
  if (it.isValid) return it;
  var names = [];
  for (var i = 0; i < list.length; i++) names.push(list[i].name);
  throw new Error("No " + what + " for " + name + ". Available: " + names.join(", "));
};
var __words = function (path) {
  var f = File(path);
  if (!f.exists) throw new Error("No file " + f.fsName);
  f.encoding = "UTF-8";
  if (!f.open("r")) throw new Error("Cannot read " + f.fsName);
  var all = f.read(); f.close();
  var parts = all.split(/\r\n|\r|\n/), out = [];
  for (var i = 0; i < parts.length; i++) { var w = parts[i].replace(/^\s+|\s+$/g, ""); if (w) out.push(w); }
  return out;
};
var __writeWords = function (path, words) {
  var f = File(path);
  f.encoding = "UTF-8";
  if (!f.open("w")) throw new Error("Cannot write " + f.fsName);
  f.write(words.join("\n")); f.close();
  return f.fsName;
};
`;

const LANGUAGE = { type: 'string', description: 'Language name as InDesign shows it, such as "English: USA" or "German: 2006 Reform"' };

export const tools = [
    {
        name: 'manage_autocorrect',
        description: 'List, add, replace or remove the Autocorrect misspelled-word / correction pairs for a language, and report whether Autocorrect is on (Preferences > Autocorrect > Misspelled Word / Correction; turn Autocorrect on with set_indesign_preferences)',
        inputSchema: {
            type: 'object',
            properties: {
                language: { ...LANGUAGE, description: 'The language whose word pairs to list or edit' },
                action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'For the word pairs of language: list them, add (or replace) pairs, or remove pairs by misspelled word', default: 'list' },
                pairs: {
                    type: 'array',
                    description: 'For add: [misspelled, correction] pairs; for remove: [misspelled] or [misspelled, correction]',
                    items: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
                },
            },
            required: ['language'],
        },
        features: ['indesign.language_proofing.autocorrect'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { language: 'English: USA', action: 'add', pairs: [['teh', 'the'], ['adn', 'and']] },
        handler: (a) => {
            const action = pick(a.action ?? 'list', { list: 'list', add: 'add', remove: 'remove' }, 'action');
            const lines = [
                'var ac = app.autoCorrectPreferences;',
                `var t = __byLanguage(app.autoCorrectTables, ${text(a.language, 'language', 200)}, "autocorrect list");`,
                'var list = t.autoCorrectWordPairList, i, j;',
            ];
            if (action !== 'list') {
                if (!Array.isArray(a.pairs) || !a.pairs.length) throw new Error(`'pairs' is required for ${action}`);
                if (a.pairs.length > 2000) throw new Error("'pairs' has more than 2000 entries");
                const pairs = a.pairs.map((p, i) => {
                    if (!Array.isArray(p) || p.length < 1 || p.length > 2) throw new Error(`'pairs[${i}]' must be [misspelled, correction]`);
                    if (action === 'add' && p.length !== 2) throw new Error(`'pairs[${i}]' needs a correction to add`);
                    return `[${p.map((w, k) => text(w, `pairs[${i}][${k}]`, 200)).join(', ')}]`;
                });
                lines.push(
                    `var given = [${pairs.join(', ')}];`,
                    'for (i = 0; i < given.length; i++) {',
                    '  for (j = list.length - 1; j >= 0; j--) if (list[j][0] === given[i][0]) list.splice(j, 1);',
                    action === 'add' ? '  list.push([given[i][0], given[i][1]]);' : '',
                    '}',
                    't.autoCorrectWordPairList = list;',
                );
            } else if (has(a.pairs)) {
                throw new Error("'pairs' is for add and remove");
            }
            lines.push('__result__ = { language: t.name, enabled: ac.autoCorrect, capitalizationErrors: ac.autoCorrectCapitalizationErrors, pairs: t.autoCorrectWordPairList };');
            return run('Autocorrect', script(LANG_JSX + lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'manage_user_dictionary',
        description: 'Edit a language\'s user dictionary or the document\'s hyphenation exceptions: list the added and removed words, add or remove words (with ~ marking hyphenation points, e.g. "data~base"), or import or export a word list as a text file with one word per line (Edit > Spelling > User Dictionary; Import and Export)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'remove', 'import', 'export'], description: 'What to do' },
                language: LANGUAGE,
                target: { type: 'string', enum: ['user_dictionary', 'document'], description: 'The user dictionary, or the hyphenation exception list stored in the active document', default: 'user_dictionary' },
                list: { type: 'string', enum: ['added', 'removed'], description: 'Added words, or removed words (words marked as not words, so they are flagged)', default: 'added' },
                words: { type: 'array', items: { type: 'string' }, description: 'For add and remove: the words' },
                path: { type: 'string', description: 'For import and export: a .txt word list, one word per line' },
            },
            required: ['action', 'language'],
        },
        features: [
            'indesign.language_proofing.user_dictionary',
            'indesign.language_proofing.hyphenation_exceptions',
            'indesign.language_proofing.import_export_word_lists',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'add', language: 'English: USA', words: ['InDesign', 'data~base'], path: null },
        handler: (a) => {
            const action = pick(a.action, { list: 'list', add: 'add', remove: 'remove', import: 'import', export: 'export' }, 'action');
            const target = pick(a.target ?? 'user_dictionary', { user_dictionary: 'user_dictionary', document: 'document' }, 'target');
            const removed = pick(a.list ?? 'added', { added: 'false', removed: 'true' }, 'list');
            const lang = text(a.language, 'language', 200);
            const user = target === 'user_dictionary';
            const owner = user ? `__byLanguage(app.userDictionaries, ${lang}, "user dictionary")` : `__byLanguage(app.activeDocument.hyphenationExceptions, ${lang}, "hyphenation exception list in the document")`;
            const [addFn, removeFn, addedProp, removedProp] = user
                ? ['addWord', 'removeWord', 'addedWords', 'removedWords']
                : ['addException', 'removeException', 'addedExceptions', 'removedExceptions'];
            const lines = [];
            if (!user) lines.push('if (!app.documents.length) throw new Error("No document open");');
            lines.push(`var d = ${owner};`);
            if (action === 'add' || action === 'remove') {
                if (has(a.path)) throw new Error(`'path' is for import and export; ${action} takes words`);
                lines.push(`d.${action === 'add' ? addFn : removeFn}(${textList(a.words, 'words', { maxLength: 100 })}, ${removed});`);
            }
            if (action === 'import') lines.push(`var w = __words(${filePath(a.path, 'path', ['.txt'])});`, 'if (w.length) d.' + addFn + `(w, ${removed});`, 'var imported = w.length;');
            if (action === 'export') lines.push(`var written = __writeWords(${filePath(a.path, 'path', ['.txt'])}, ${removed === 'true' ? `d.${removedProp}` : `d.${addedProp}`});`);
            if (action === 'list' && (has(a.words) || has(a.path))) throw new Error('list takes only language, target and list');
            lines.push(`__result__ = { language: d.name, target: "${target}", added: d.${addedProp}, removed: d.${removedProp}${action === 'import' ? ', imported: imported' : ''}${action === 'export' ? ', file: written' : ''} };`);
            return run('User dictionary', script(LANG_JSX + lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'manage_languages',
        description: 'List the languages InDesign knows with their spelling, hyphenation and thesaurus vendors (such as Hunspell, Proximity or Duden), quotation marks and dictionary paths, or set a language\'s vendors, double and single quotes, and add or remove Hunspell dictionary folders (Preferences > Dictionary)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'set'], description: 'list languages, or set one language\'s options', default: 'list' },
                nameContains: { type: 'string', description: 'For list: only languages whose name contains this text (case-insensitive)' },
                language: { ...LANGUAGE, description: 'For set: the language' },
                spellingVendor: { type: 'string', description: 'For set: spelling vendor, one of the language\'s spellingVendorList (e.g. "Hunspell")' },
                hyphenationVendor: { type: 'string', description: 'For set: hyphenation vendor, one of the language\'s hyphenationVendorList (e.g. "Duden")' },
                thesaurusVendor: { type: 'string', description: 'For set: thesaurus vendor' },
                doubleQuotes: { type: 'string', description: 'For set: opening and closing double quotes, two characters such as "“”"' },
                singleQuotes: { type: 'string', description: 'For set: opening and closing single quotes, two characters' },
                addDictionaryPath: { type: 'string', description: 'For set: a folder of Hunspell dictionary files to add for the language' },
                removeDictionaryPath: { type: 'string', description: 'For set: a dictionary folder to remove' },
            },
        },
        features: [
            'indesign.language_proofing.language_object',
            'indesign.language_proofing.hunspell',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'set', language: 'German: 2006 Reform', spellingVendor: 'Hunspell', hyphenationVendor: 'Duden', thesaurusVendor: null, doubleQuotes: '„“', singleQuotes: '‚‘', removeDictionaryPath: null, nameContains: null },
        handler: (a) => {
            const action = pick(a.action ?? 'list', { list: 'list', set: 'set' }, 'action');
            const info = 'var __lang = function (l) { return { name: l.name, untranslatedName: l.untranslatedName, locale: l.icuLocaleName, spellingVendor: l.spellingVendor, hyphenationVendor: l.hyphenationVendor, thesaurusVendor: l.thesaurusVendor, spellingVendors: l.spellingVendorList, hyphenationVendors: l.hyphenationVendorList, doubleQuotes: l.doubleQuotes, singleQuotes: l.singleQuotes, dictionaryPaths: l.dictionaryPaths }; };';
            if (action === 'list') {
                const filter = has(a.nameContains) ? text(a.nameContains, 'nameContains', 100) : '""';
                return run('List languages', script(`${info}
var all = app.languagesWithVendors, out = [], f = ${filter}.toLowerCase();
for (var i = 0; i < all.length; i++) if (!f || all[i].name.toLowerCase().indexOf(f) >= 0) out.push(__lang(all[i]));
var used = [];
if (app.documents.length) { var dl = app.activeDocument.languages; for (var j = 0; j < dl.length; j++) used.push(dl[j].name); }
__result__ = { languages: out, documentLanguages: used };`, { needsDocument: false }));
            }
            const lines = [`var l = __byLanguage(app.languagesWithVendors, ${text(a.language, 'language', 200)}, "language");`];
            for (const [k, listProp] of [['spellingVendor', 'spellingVendorList'], ['hyphenationVendor', 'hyphenationVendorList'], ['thesaurusVendor', null]]) {
                if (!has(a[k])) continue;
                const v = text(a[k], k, 100);
                if (listProp) lines.push(`if (("," + l.${listProp}.join(",") + ",").indexOf("," + ${v} + ",") < 0) throw new Error(${str(k)} + " for " + l.name + " must be one of: " + l.${listProp}.join(", "));`);
                lines.push(`l.${k} = ${v};`);
            }
            for (const k of ['doubleQuotes', 'singleQuotes']) {
                if (!has(a[k])) continue;
                if (typeof a[k] !== 'string' || [...a[k]].length !== 2) throw new Error(`'${k}' must be two characters: the opening and closing quote`);
                lines.push(`l.${k} = ${str(a[k])};`);
            }
            if (has(a.addDictionaryPath)) lines.push(`l.addDictionaryPath(Folder(${filePath(a.addDictionaryPath, 'addDictionaryPath')}).fsName);`);
            if (has(a.removeDictionaryPath)) lines.push(`l.removeDictionaryPath(Folder(${filePath(a.removeDictionaryPath, 'removeDictionaryPath')}).fsName);`);
            if (lines.length === 1) throw new Error('Give something to set: a vendor, quotes or a dictionary path');
            lines.push('__result__ = __lang(l);');
            return run('Set language options', script(LANG_JSX + info + '\n' + lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'apply_language',
        description: 'Assign a language to text, to paragraph or character styles, or to the document or application defaults (the application default applies to new documents: the default language dictionary), so the right spelling and hyphenation dictionaries and quotation marks are used; optionally set the Duden hyphenation style (Character panel > Language)',
        inputSchema: {
            type: 'object',
            properties: {
                language: LANGUAGE,
                target: {
                    type: 'object',
                    description: 'Where to apply it; give one or more',
                    properties: {
                        frameIds: { type: 'array', items: { type: 'integer' }, description: 'Text frames: their whole stories' },
                        storyIds: { type: 'array', items: { type: 'integer' }, description: 'Stories by id' },
                        selection: { type: 'boolean', description: 'The selected text' },
                        paragraphStyles: { type: 'array', items: { type: 'string' }, description: 'Paragraph style names' },
                        characterStyles: { type: 'array', items: { type: 'string' }, description: 'Character style names' },
                        defaults: { type: 'string', enum: ['document', 'application'], description: 'The active document\'s text defaults, or the application\'s (used with no document open and for new documents)' },
                    },
                },
                hyphenationStyle: { type: 'string', enum: Object.keys(HYPH_STYLES), description: 'Duden hyphenation style for the text, paragraph styles or defaults' },
            },
            required: ['language', 'target'],
        },
        features: [
            'indesign.language_proofing.assign_language',
            'indesign.language_proofing.default_language_dictionary',
            'indesign.language_proofing.duden',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { language: 'German: 2006 Reform', hyphenationStyle: 'aesthetic', target: { frameIds: [1, 2], storyIds: [3], selection: true, paragraphStyles: ['Body'], characterStyles: ['Quote'], defaults: 'document' } },
        handler: (a) => {
            const t = obj(a.target, 'target');
            if (!t) throw new Error("'target' is required");
            known(t, ['frameIds', 'storyIds', 'selection', 'paragraphStyles', 'characterStyles', 'defaults'], 'target');
            const lang = text(a.language, 'language', 200);
            const hy = has(a.hyphenationStyle) ? pick(a.hyphenationStyle, HYPH_STYLES, 'hyphenationStyle') : null;
            const defaults = has(t.defaults) ? pick(t.defaults, { document: 'document', application: 'application' }, 'target.defaults') : null;
            const needsDoc = has(t.frameIds) || has(t.storyIds) || t.selection === true || has(t.paragraphStyles) || has(t.characterStyles) || defaults === 'document';
            if (!needsDoc && !defaults) throw new Error('Choose a target: frameIds, storyIds, selection, paragraphStyles, characterStyles or defaults');
            const set = (x, hyph = true) => [`${x}.appliedLanguage = L;`, ...(hy && hyph ? [`${x}.providerHyphenationStyle = ${hy};`] : []), 'done++;'];
            const lines = [
                `var L = __byLanguage(app.languagesWithVendors, ${lang}, "language"), done = 0, i, x;`,
                ...(needsDoc ? ['var doc = __doc();'] : []),
            ];
            if (has(t.frameIds)) lines.push(`var fr = ${idList(t.frameIds, 'target.frameIds')};`, 'for (i = 0; i < fr.length; i++) {', '  x = __item(doc, fr[i]).parentStory;', ...set('  x'), '}');
            if (has(t.storyIds)) lines.push(`var st = ${idList(t.storyIds, 'target.storyIds')};`, 'for (i = 0; i < st.length; i++) {', '  x = doc.stories.itemByID(st[i]);', '  if (!x.isValid) throw new Error("No story with id " + st[i]);', ...set('  x'), '}');
            if (t.selection === true) lines.push('if (!app.selection.length) throw new Error("Nothing is selected");', 'x = app.selection[0];', 'if (x instanceof TextFrame) x = x.parentStory;', ...set('x'));
            for (const [k, coll] of [['paragraphStyles', 'allParagraphStyles'], ['characterStyles', 'allCharacterStyles']]) {
                if (!has(t[k])) continue;
                lines.push(
                    `var want = ${textList(t[k], `target.${k}`, { max: 500 })};`,
                    'for (i = 0; i < want.length; i++) {',
                    `  x = null; for (var j = 0; j < doc.${coll}.length; j++) if (doc.${coll}[j].name === want[i]) x = doc.${coll}[j];`,
                    `  if (!x) throw new Error("No ${k === 'paragraphStyles' ? 'paragraph' : 'character'} style named " + want[i]);`,
                    ...set('  x', k === 'paragraphStyles'),
                    '}',
                );
            }
            if (defaults) lines.push(`x = ${defaults === 'document' ? 'doc' : 'app'}.textDefaults;`, ...set('x'));
            lines.push('__result__ = { language: L.name, applied: done };');
            return run('Apply language', script(LANG_JSX + lines.join('\n'), { needsDocument: false }));
        },
    },
];
