/**
 * Data merge, find/change, proofing, automation and InCopy tools
 * (src/tools/data-merge.js, find-change.js, proofing.js, automation.js,
 * incopy.js): the scripts carry the right object-model statements, parse as
 * ES5, and bad arguments are refused before anything runs.
 */
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => {
    const s = (await scriptsFor([[name, args]]))[0];
    acorn.parse(s, { ecmaVersion: 5, allowReturnOutsideFunction: true });
    return s;
};
const refuses = async (name, args, pattern) => {
    await assert.rejects(async () => tool(name).handler(args), pattern);
};
const doc = (f) => `${home}/Documents/${f}`;

// ---------------------------------------------------------------- data merge

await test('add_data_merge_placeholder adds text, image and QR code placeholders', async () => {
    const t = await one('add_data_merge_placeholder', { kind: 'text', field: 'Name', frameId: 12, offset: 3 });
    assert.match(t, /var f = __field\(doc, "Name"\);/);
    assert.match(t, /var ips = it\.insertionPoints, at = 3;/);
    assert.match(t, /doc\.dataMergeTextPlaceholders\.add\(it\.parentStory, ip\.index, f\);/);
    const i = await one('add_data_merge_placeholder', { kind: 'image', field: '@Photo', frameId: 5 });
    assert.match(i, /doc\.dataMergeImagePlaceholders\.add\(it, f\);/);
    const q = await one('add_data_merge_placeholder', { kind: 'qr', field: '#Link', frameId: 5 });
    assert.match(q, /doc\.dataMergeQrcodePlaceholders\.add\(it, f\);/);
});

await test('add_data_merge_placeholder refuses a bad kind, a missing field and an offset on an image', async () => {
    await refuses('add_data_merge_placeholder', { kind: 'barcode', field: 'A', frameId: 1 }, /Allowed: text, image, qr/);
    await refuses('add_data_merge_placeholder', { kind: 'text', field: '', frameId: 1 }, /'field' is required/);
    await refuses('add_data_merge_placeholder', { kind: 'image', field: 'A', frameId: 1, offset: 2 }, /'offset' applies to text/);
    await refuses('add_data_merge_placeholder', { kind: 'text', field: 'A', frameId: -1 }, /out of range/);
});

await test('manage_data_merge updates, removes and previews the source, updates content and reports missing images', async () => {
    assert.match(await one('manage_data_merge', { action: 'update_source' }), /__dm\(doc\)\.updateDataSource\(\);/);
    assert.match(await one('manage_data_merge', { action: 'remove_source' }), /__dm\(doc\)\.removeDataSource\(\);/);
    const p = await one('manage_data_merge', { action: 'preview', recordNumber: 4, show: true });
    assert.match(p, /p\.recordNumber = 4;/);
    assert.match(p, /app\.menuActions\.itemByID\(108035\)/);
    assert.match(p, /ma\.checked !== true\) ma\.invoke\(\)/);
    assert.match(await one('manage_data_merge', { action: 'update_content' }), /itemByID\(108042\)/);
    const r = await one('manage_data_merge', { action: 'missing_images_report', reportPath: doc('missing.txt') });
    assert.match(r, /dataMergePreferences\.alertMissingImages\(f\);/);
    await refuses('manage_data_merge', { action: 'missing_images_report', reportPath: doc('missing.pdf') }, /must end in \.txt/);
    await refuses('manage_data_merge', { action: 'missing_images_report', reportPath: '/etc/x.txt' }, /outside the allowed/);
    await refuses('manage_data_merge', { action: 'preview', show: 'yes' }, /true or false/);
});

await test('set_data_merge_options sets layout and placement options', async () => {
    const s = await one('set_data_merge_options', {
        layout: { arrangeBy: 'columns_first', topMargin: 10, leftMargin: 12.5, columnSpacing: 4, rowSpacing: 6 },
        placement: { fitting: 'fill_proportional', centerImage: true, linkImages: false, recordLimit: 50, removeBlankLines: true },
    });
    assert.match(s, /p\.arrangeBy = ArrangeBy\.COLUMNS_FIRST;/);
    assert.match(s, /p\.topMargin = 10;/);
    assert.match(s, /p\.leftMargin = 12\.5;/);
    assert.match(s, /p\.columnSpacing = 4;/);
    assert.match(s, /p\.rowSpacing = 6;/);
    assert.match(s, /o\.fittingOption = Fitting\.FILL_PROPORTIONAL;/);
    assert.match(s, /o\.centerImage = true;/);
    assert.match(s, /o\.linkImages = false;/);
    assert.match(s, /o\.documentSize = 50;/);
    await refuses('set_data_merge_options', {}, /Give layout or placement/);
    await refuses('set_data_merge_options', { layout: { gutter: 3 } }, /Unknown option 'layout\.gutter'/);
    await refuses('set_data_merge_options', { placement: { fitting: 'stretch' } }, /Allowed: proportional/);
    await refuses('set_data_merge_options', { placement: { recordLimit: 0 } }, /out of range/);
});

await test('export_data_merge_pdf merges to PDF with a preset, records and an overset report', async () => {
    const s = await one('export_data_merge_pdf', { path: doc('out.pdf'), preset: '[Smallest File Size]', records: { selection: 'one', recordNumber: 3 }, recordsPerPage: 'multiple', oversetReportPath: doc('overset.txt') });
    assert.match(s, /app\.pdfExportPresets\.itemByName\("\[Smallest File Size\]"\)/);
    assert.match(s, /p\.recordSelection = RecordSelection\.ONE_RECORD;/);
    assert.match(s, /p\.recordNumber = 3;/);
    assert.match(s, /p\.recordsPerPage = RecordsPerPage\.MULTIPLE_RECORD;/);
    assert.match(s, /dm\.exportFile\(out, preset, File\(".*overset\.txt"\)\);/);
    await refuses('export_data_merge_pdf', { path: doc('out.indd') }, /must end in \.pdf/);
    await refuses('export_data_merge_pdf', { path: doc('out.pdf'), records: { selection: 'range', range: 'first five' } }, /must look like "1-5,8"/);
    await refuses('export_data_merge_pdf', { path: doc('out.pdf'), records: { selection: 'one' } }, /recordNumber' is required/);
});

// --------------------------------------------------------------- find/change

await test('run_find_change builds a GREP change with formats, options and a story scope', async () => {
    const s = await one('run_find_change', {
        mode: 'grep', action: 'change', scope: 'story', frameId: 7,
        find: { text: '\\d+', format: { paragraphStyle: 'Body/Lead', font: 'Minion Pro\\tRegular', pointSize: 10 } },
        change: { text: '[$0]', format: { characterStyle: 'Num', capitalization: 'small_caps' } },
        options: { includeHiddenLayers: true, includeLockedLayers: true, searchBackwards: true },
    });
    assert.match(s, /app\.findGrepPreferences = NothingEnum\.NOTHING;/);
    assert.match(s, /app\.findGrepPreferences\.findWhat = "\\\\d\+";/);
    assert.match(s, /appliedParagraphStyle = __styleBy\(doc, "paragraph", "Body\/Lead"\)/);
    assert.match(s, /appliedFont = "Minion Pro\\tRegular";/);
    assert.match(s, /app\.findGrepPreferences\.pointSize = 10;/);
    assert.match(s, /app\.changeGrepPreferences\.changeTo = "\[\$0\]";/);
    assert.match(s, /app\.changeGrepPreferences\.capitalization = Capitalization\.SMALL_CAPS;/);
    assert.match(s, /__opts\.includeHiddenLayers = true;/);
    assert.match(s, /__opts\.includeLockedLayersForFind = true;/);
    assert.match(s, /var where = __item\(doc, 7\)\.parentStory;/);
    assert.match(s, /where\.changeGrep\(true\)/);
    assert.match(s, /__opts\.properties = __saved/);
});

await test('run_find_change searches glyphs, objects, colours and transliterations', async () => {
    const g = await one('run_find_change', { mode: 'glyph', action: 'change', find: { font: 'Minion Pro', fontStyle: 'Regular', glyphId: 112 }, change: { font: 'Minion Pro', fontStyle: 'Regular', glyphId: 1404 } });
    assert.match(g, /app\.findGlyphPreferences\.glyphID = 112;/);
    assert.match(g, /app\.changeGlyphPreferences\.glyphID = 1404;/);
    assert.match(g, /where\.changeGlyph\(false\)/);
    const o = await one('run_find_change', { mode: 'object', find: { objectStyle: 'Sidebar', strokeWeight: 2 }, options: { objectType: 'text_frames' } });
    assert.match(o, /app\.findObjectPreferences\.appliedObjectStyles = __styleBy\(doc, "object", "Sidebar"\)/);
    assert.match(o, /__opts\.objectType = ObjectTypes\.TEXT_FRAMES_TYPE;/);
    assert.match(o, /where\.findObject\(false\)/);
    const c = await one('run_find_change', { mode: 'color', action: 'change', find: { swatch: 'PANTONE 185 C' }, change: { swatch: '#003366', tint: 80 }, scope: 'all_documents' });
    assert.match(c, /app\.findColorPreferences\.findWhat = __swatch\(doc, \{"kind":"name","name":"PANTONE 185 C"\}\)/);
    assert.match(c, /app\.changeColorPreferences\.tint = 80;/);
    assert.match(c, /var where = app;/);
    assert.match(c, /where\.changeColor\(\)/);
    const t = await one('run_find_change', { mode: 'transliterate', action: 'change', find: { characterType: 'full_width_hiragana' }, change: { characterType: 'full_width_katakana' }, options: { kanaSensitive: true }, scope: 'selection' });
    assert.match(t, /findCharacterType = FindChangeTransliterateCharacterTypes\.FULL_WIDTH_HIRAGANA;/);
    assert.match(t, /changeCharacterType = FindChangeTransliterateCharacterTypes\.FULL_WIDTH_KATAKANA;/);
    assert.match(t, /var where = __textScope\(app\.selection\[0\]\);/);
});

await test('run_find_change scopes to the end of the story, loads queries and can keep its criteria', async () => {
    const s = await one('run_find_change', { mode: 'text', find: { text: 'colour' }, options: { ignoreDiacritics: true, ignoreKashidas: true, caseSensitive: true, wholeWord: true, includeFootnotes: true, includeMasterPages: true, includeLockedStories: true, kanaSensitive: true, widthSensitive: true }, scope: 'story_to_end', keepCriteria: true });
    assert.match(s, /__st\.characters\.itemByRange\(__at, __st\.characters\.length - 1\)/);
    assert.match(s, /__opts\.ignoreDiacritics = true;/);
    assert.match(s, /__opts\.includeLockedStoriesForFind = true;/);
    assert.match(s, /__opts\.includeMasterPages = true;/);
    assert.doesNotMatch(s, /__opts\.properties = __saved/);
    const q = await one('run_find_change', { mode: 'grep', action: 'change', query: { name: 'Multiple Return to Single Return' } });
    assert.match(q, /app\.loadFindChangeQuery\("Multiple Return to Single Return", SearchModes\.GREP_SEARCH\);/);
});

await test('run_find_change refuses mismatched modes, scopes and options', async () => {
    await refuses('run_find_change', { mode: 'text' }, /Give 'find' criteria/);
    await refuses('run_find_change', { mode: 'text', action: 'change', find: { text: 'a' } }, /action change needs 'change'/);
    await refuses('run_find_change', { mode: 'text', find: { text: 'a' }, change: { text: 'b' } }, /pass action: "change"/);
    await refuses('run_find_change', { mode: 'grep', find: { text: 'a' }, options: { ignoreDiacritics: true } }, /does not apply to grep/);
    await refuses('run_find_change', { mode: 'object', find: { fillColor: 'Black' }, scope: 'story' }, /cover the document or all documents/);
    await refuses('run_find_change', { mode: 'glyph', find: { text: 'a' } }, /Unknown option 'find\.text'/);
    await refuses('run_find_change', { mode: 'text', find: { format: { colour: 'Red' } } }, /Unknown option 'find\.format\.colour'/);
    await refuses('run_find_change', { mode: 'transliterate', find: { characterType: 'emoji' } }, /Allowed: full_width_hiragana/);
    await refuses('run_find_change', { mode: 'transliterate', query: { name: 'x' } }, /no saved queries/);
    await refuses('run_find_change', { mode: 'regex', find: { text: 'a' } }, /Allowed: text, grep/);
});

await test('manage_find_change_queries saves, loads, deletes and lists queries', async () => {
    const s = await one('manage_find_change_queries', { action: 'save', name: 'Double spaces', mode: 'grep', find: { text: ' {2,}' }, change: { text: ' ' } });
    assert.match(s, /app\.saveFindChangeQuery\("Double spaces", SearchModes\.GREP_SEARCH\);/);
    assert.match(s, /app\.findGrepPreferences\.findWhat = " \{2,\}";/);
    assert.match(await one('manage_find_change_queries', { action: 'load', name: 'Double spaces', mode: 'grep' }), /app\.loadFindChangeQuery\("Double spaces", SearchModes\.GREP_SEARCH\);/);
    assert.match(await one('manage_find_change_queries', { action: 'delete', name: 'Old', mode: 'object' }), /app\.deleteFindChangeQuery\("Old", SearchModes\.OBJECT_SEARCH\);/);
    assert.match(await one('manage_find_change_queries', { action: 'list' }), /Find-Change Queries/);
    await refuses('manage_find_change_queries', { action: 'save', name: 'a/b', mode: 'text', find: { text: 'x' } }, /without \/ \\ or :/);
    await refuses('manage_find_change_queries', { action: 'load', name: 'A', mode: 'transliterate' }, /Allowed: text, grep, glyph, object, color/);
    await refuses('manage_find_change_queries', { action: 'delete', name: 'A', mode: 'text', find: { text: 'x' } }, /delete takes only name and mode/);
});

await test('run_find_change_command invokes the Edit menu commands by id', async () => {
    assert.match(await one('run_find_change_command', { command: 'find_next' }), /app\.menuActions\.itemByID\(18695\)/);
    assert.match(await one('run_find_change_command', { command: 'load_find_with_selection' }), /itemByID\(18689\)/);
    assert.match(await one('run_find_change_command', { command: 'load_find_and_find_next' }), /itemByID\(18690\)/);
    assert.match(await one('run_find_change_command', { command: 'load_change_with_selection' }), /itemByID\(18693\)/);
    assert.match(await one('run_find_change_command', { command: 'replace_with_change_to' }), /itemByID\(18692\)/);
    await refuses('run_find_change_command', { command: 'find_previous' }, /Allowed: find_next/);
});

// ------------------------------------------------------------------ proofing

await test('manage_autocorrect lists and edits the word pairs', async () => {
    const s = await one('manage_autocorrect', { language: 'English: USA', action: 'add', pairs: [['teh', 'the']] });
    assert.match(s, /__byLanguage\(app\.autoCorrectTables, "English: USA"/);
    assert.match(s, /var given = \[\["teh", "the"\]\];/);
    assert.match(s, /t\.autoCorrectWordPairList = list;/);
    assert.doesNotMatch(await one('manage_autocorrect', { language: 'English: USA' }), /autoCorrectWordPairList = list/);
    await refuses('manage_autocorrect', { action: 'add', pairs: [['a', 'b']] }, /'language' is required/);
    await refuses('manage_autocorrect', { language: 'English: USA', pairs: [['a', 'b']] }, /'pairs' is for add and remove/);
    await refuses('manage_autocorrect', { language: 'English: USA', action: 'add', pairs: [['teh']] }, /needs a correction/);
    await refuses('manage_autocorrect', { language: 'English: USA', action: 'remove' }, /'pairs' is required/);
});

await test('manage_user_dictionary adds words, edits hyphenation exceptions and moves word lists', async () => {
    const s = await one('manage_user_dictionary', { action: 'add', language: 'English: USA', words: ['InDesign', 'data~base'] });
    assert.match(s, /__byLanguage\(app\.userDictionaries, "English: USA"/);
    assert.match(s, /d\.addWord\(\["InDesign", "data~base"\], false\);/);
    const r = await one('manage_user_dictionary', { action: 'remove', language: 'English: USA', words: ['teh'], list: 'removed' });
    assert.match(r, /d\.removeWord\(\["teh"\], true\);/);
    const h = await one('manage_user_dictionary', { action: 'add', language: 'English: USA', target: 'document', words: ['pro~cess'] });
    assert.match(h, /app\.activeDocument\.hyphenationExceptions/);
    assert.match(h, /d\.addException\(\["pro~cess"\], false\);/);
    const i = await one('manage_user_dictionary', { action: 'import', language: 'English: USA', path: doc('words.txt') });
    assert.match(i, /var w = __words\(".*words\.txt"\);/);
    const e = await one('manage_user_dictionary', { action: 'export', language: 'English: USA', path: doc('words.txt') });
    assert.match(e, /__writeWords\(".*words\.txt", d\.addedWords\)/);
    await refuses('manage_user_dictionary', { action: 'add', language: 'English: USA', words: [] }, /at least one entry/);
    await refuses('manage_user_dictionary', { action: 'import', language: 'English: USA', path: doc('words.csv') }, /must end in \.txt/);
    await refuses('manage_user_dictionary', { action: 'add', language: '' , words: ['x'] }, /'language' is required/);
});

await test('manage_languages lists languages and sets vendors, quotes and Hunspell paths', async () => {
    assert.match(await one('manage_languages', { action: 'list', nameContains: 'german' }), /app\.languagesWithVendors/);
    const s = await one('manage_languages', { action: 'set', language: 'German: 2006 Reform', spellingVendor: 'Hunspell', hyphenationVendor: 'Duden', doubleQuotes: '„“', addDictionaryPath: doc('hunspell') });
    assert.match(s, /l\.spellingVendor = "Hunspell";/);
    assert.match(s, /l\.spellingVendorList\.join/);
    assert.match(s, /l\.hyphenationVendor = "Duden";/);
    assert.match(s, /l\.doubleQuotes = "„“";/);
    assert.match(s, /l\.addDictionaryPath\(Folder\(".*hunspell"\)\.fsName\);/);
    await refuses('manage_languages', { action: 'set', language: 'German: 2006 Reform' }, /Give something to set/);
    await refuses('manage_languages', { action: 'set', language: 'German: 2006 Reform', doubleQuotes: '"' }, /two characters/);
});

await test('apply_language applies a language to text, styles and defaults', async () => {
    const s = await one('apply_language', { language: 'German: 2006 Reform', hyphenationStyle: 'preferred_aesthetic', target: { frameIds: [4], paragraphStyles: ['Body'], characterStyles: ['Quote'], defaults: 'application' } });
    assert.match(s, /x = __item\(doc, fr\[i\]\)\.parentStory;/);
    assert.match(s, /x\.appliedLanguage = L;/);
    assert.match(s, /x\.providerHyphenationStyle = HyphenationStyleEnum\.HYPH_PREFERRED_AESTHETIC;/);
    assert.match(s, /doc\.allCharacterStyles/);
    assert.match(s, /x = app\.textDefaults;/);
    await refuses('apply_language', { language: 'German', target: {} }, /Choose a target/);
    await refuses('apply_language', { language: 'German', target: { frames: [1] } }, /Unknown option 'target\.frames'/);
    await refuses('apply_language', { language: 'German', target: { selection: true }, hyphenationStyle: 'best' }, /Allowed: aesthetic/);
});

// ---------------------------------------------------------------- automation

await test('manage_scripts_panel lists, runs, reveals and deletes scripts', async () => {
    const l = await one('manage_scripts_panel', { action: 'list', includeUnsupported: true });
    assert.match(l, /app\.scriptPreferences|sp\.scriptsList/);
    assert.match(l, /__scriptRoots\(\)/);
    const r = await one('manage_scripts_panel', { action: 'run', path: doc('tidy.idjs'), arguments: { mode: 'fast' }, undoMode: 'fast_entire_script', undoName: 'Tidy' });
    assert.match(r, /app\.scriptArgs\.setValue\("mode", "fast"\);/);
    assert.match(r, /app\.doScript\(f, ScriptLanguage\.UXPSCRIPT, \["fast"\], UndoModes\.FAST_ENTIRE_SCRIPT, "Tidy"\)/);
    assert.match(await one('manage_scripts_panel', { action: 'reveal', path: doc('tidy.jsx') }), /f\.parent\.execute\(\);/);
    const d = await one('manage_scripts_panel', { action: 'delete', path: doc('tidy.jsx') });
    assert.match(d, /Only scripts listed in the Scripts panel can be deleted/);
    assert.match(d, /f\.remove\(\)/);
    await refuses('manage_scripts_panel', { action: 'run', path: doc('tidy.scpt') }, /must end in \.jsx/);
    await refuses('manage_scripts_panel', { action: 'run', path: doc('a.jsx'), arguments: { 'bad name': 'x' } }, /letters, digits and underscores/);
    await refuses('manage_scripts_panel', { action: 'edit', path: doc('a.jsx') }, /Allowed: list, run, reveal, delete/);
});

await test('set_script_preferences keeps interaction level and units past the tool run', async () => {
    const s = await one('set_script_preferences', { enableRedraw: false, userInteractionLevel: 'interact_with_alerts', measurementUnit: 'points' });
    assert.match(s, /sp\.enableRedraw = false;/);
    assert.match(s, /__uil = UserInteractionLevels\.INTERACT_WITH_ALERTS;/);
    assert.match(s, /__units = MeasurementUnits\.POINTS;/);
    await refuses('set_script_preferences', { measurementUnit: 'furlongs' }, /Allowed: points/);
});

await test('manage_script_labels reads, writes and finds labels', async () => {
    assert.match(await one('manage_script_labels', { action: 'set', target: { ids: [3] }, label: 'price' }), /it\.label = "price";/);
    assert.match(await one('manage_script_labels', { action: 'set', target: { ids: [3] }, label: '9.99', key: 'price' }), /it\.insertLabel\("price", "9\.99"\);[\s\S]*it\.extractLabel\("price"\)/);
    assert.match(await one('manage_script_labels', { action: 'find', label: 'price' }), /doc\.allPageItems/);
    await refuses('manage_script_labels', { action: 'set', target: { ids: [3] } }, /'label' is required/);
    await refuses('manage_script_labels', { action: 'get', target: {} }, /Choose the items/);
});

await test('run_menu_action searches, invokes without dialogs and translates key strings', async () => {
    assert.match(await one('run_menu_action', { action: 'search', nameContains: 'Find' }), /app\.menuActions\.everyItem\(\)/);
    const i = await one('run_menu_action', { action: 'invoke', id: 18695 });
    assert.match(i, /app\.menuActions\.itemByID\(18695\)/);
    assert.match(i, /opens a dialog/);
    assert.match(i, /m\.invoke\(\);/);
    assert.match(await one('run_menu_action', { action: 'find_key_strings', text: 'Paste' }), /app\.findKeyStrings\("Paste"\)/);
    assert.match(await one('run_menu_action', { action: 'translate_key_string', text: '$ID/Paste' }), /app\.translateKeyString\("\$ID\/Paste"\)/);
    await refuses('run_menu_action', { action: 'search' }, /Give nameContains or areaContains/);
    await refuses('run_menu_action', { action: 'invoke' }, /Invalid number for 'id'/);
});

await test('manage_script_menus adds a script menu item and lists menus', async () => {
    const s = await one('manage_script_menus', { action: 'add', submenus: ['Scripts'], title: 'Tidy', scriptPath: doc('tidy.jsx') });
    assert.match(s, /app\.menus\.itemByName\("\$ID\/Main"\)/);
    assert.match(s, /s = at\.submenus\.add\(path\[i\]\);/);
    assert.match(s, /var sma = app\.scriptMenuActions\.add\("Tidy"\);/);
    assert.match(s, /sma\.addEventListener\(ScriptMenuAction\.ON_INVOKE, f\);/);
    assert.match(s, /at\.menuItems\.add\(sma\);/);
    assert.match(await one('manage_script_menus', { action: 'remove', title: 'Tidy' }), /all\[i\]\.remove\(\)/);
    assert.match(await one('manage_script_menus', { action: 'list_menu', submenus: ['Window'] }), /throw new Error\("No submenu "/);
    await refuses('manage_script_menus', { action: 'add', title: 'Tidy', scriptPath: doc('tidy.txt') }, /must end in \.jsx/);
});

await test('manage_event_listeners attaches print events to a document and removes listeners', async () => {
    const s = await one('manage_event_listeners', { action: 'add', target: 'document', eventType: 'afterPrint', handlerPath: doc('log.jsx') });
    assert.match(s, /var t = __doc\(\);/);
    assert.match(s, /t\.addEventListener\("afterPrint", f\);/);
    assert.match(await one('manage_event_listeners', { action: 'remove', id: 9 }), /t\.eventListeners\.itemByID\(9\)/);
    await refuses('manage_event_listeners', { action: 'add', target: 'document', eventType: 'afterOpen', handlerPath: doc('log.jsx') }, /Invalid value for 'eventType'/);
    await refuses('manage_event_listeners', { action: 'add', eventType: 'onClick', handlerPath: doc('log.jsx') }, /Invalid value for 'eventType'/);
});

await test('manage_idle_tasks adds, retimes and removes idle tasks', async () => {
    const s = await one('manage_idle_tasks', { action: 'add', name: 'Autosave', sleep: 60000, handlerPath: doc('save.jsx') });
    assert.match(s, /app\.idleTasks\.add\(\{ name: "Autosave", sleep: 60000 \}\)/);
    assert.match(s, /task\.addEventListener\(IdleTask\.ON_IDLE, f\);/);
    assert.match(await one('manage_idle_tasks', { action: 'set_sleep', name: 'Autosave', sleep: 0 }), /task\.sleep = 0;/);
    assert.match(await one('manage_idle_tasks', { action: 'remove', name: 'Autosave' }), /task\.remove\(\);/);
    await refuses('manage_idle_tasks', { action: 'set_sleep', name: 'A', sleep: -5 }, /out of range/);
});

await test('edit_preference_object reads and sets a preference object', async () => {
    const s = await one('edit_preference_object', { action: 'set', target: 'document', preference: 'gridPreferences', values: { baselineStart: 12, baselineGridShown: true, baselineColor: { enum: 'UIColors.LIGHT_BLUE' }, gridViewThreshold: 75 } });
    assert.match(s, /var owner = __doc\(\), name = "gridPreferences"/);
    assert.match(s, /p\["baselineStart"\] = 12;/);
    assert.match(s, /p\["baselineGridShown"\] = true;/);
    assert.match(s, /p\["baselineColor"\] = __enum\("UIColors", "LIGHT_BLUE"\);/);
    await refuses('edit_preference_object', { preference: 'app.quit()' }, /must be a property name/);
    await refuses('edit_preference_object', { preference: 'activeDocument' }, /must name a preference object/);
    await refuses('edit_preference_object', { action: 'set', preference: 'textPreferences', values: { smallCap: { enum: 'x' } } }, /look like "UIColors\.LIGHT_BLUE"/);
    await refuses('edit_preference_object', { action: 'set', preference: 'textPreferences', values: { 'a.b': 1 } }, /must be a property name/);
});

await test('get_performance_metrics, apply_ui_customization and generate_idml_schema', async () => {
    const m = await one('get_performance_metrics', { metrics: ['CPU_TIME', 'NUMBER_OF_THREADS'], includeMemoryStatistics: true });
    assert.match(m, /var names = \["CPU_TIME","NUMBER_OF_THREADS"\]/);
    assert.match(m, /app\.performanceMetric\(k\)/);
    assert.match(m, /app\.memoryStatistics\(\)/);
    await refuses('get_performance_metrics', { metrics: ['FPS'] }, /Invalid value for 'metrics\[0\]'/);
    const u = await one('apply_ui_customization', { menuSet: 'Typography', shortcutSet: 'Default', workspace: 'Essentials' });
    assert.match(u, /app\.applyMenuCustomization\("Typography"\);/);
    assert.match(u, /app\.applyShortcutSet\("Default"\);/);
    assert.match(u, /app\.applyWorkspace\("Essentials"\);/);
    await refuses('apply_ui_customization', {}, /Give menuSet/);
    assert.match(await one('generate_idml_schema', { folder: doc('idml'), packageFormat: true }), /app\.generateIDMLSchema\(f, true\);/);
    await refuses('generate_idml_schema', { folder: '/System/x' }, /outside the allowed|system directory/);
});

await test('find_xml_rule_matches runs an XML rule processor over the structure', async () => {
    const s = await one('find_xml_rule_matches', { xpaths: ['//Story/Head'], maxMatches: 10 });
    assert.match(s, /app\.xmlRuleProcessors\.add\(\["\/\/Story\/Head"\], \[\]\)/);
    assert.match(s, /proc\.startProcessingRuleSet\(doc\.xmlElements\[0\]\)/);
    assert.match(s, /proc\.findNextMatch\(\)/);
    assert.match(s, /proc\.remove\(\);/);
    await refuses('find_xml_rule_matches', { xpaths: [] }, /at least one entry/);
});

// -------------------------------------------------------------------- InCopy

await test('manage_assignments creates, edits, updates, packages and deletes assignments', async () => {
    const c = await one('manage_assignments', { action: 'create', name: 'Feature', path: doc('feature.icma'), userName: 'Sam', frameColor: 'gold', content: 'everything', frameIds: [4, 5] });
    assert.match(c, /doc\.assignments\.add\(File\(".*feature\.icma"\), "", false, \{ name: "Feature" \}\)/);
    assert.match(c, /as\.userName = "Sam";/);
    assert.match(c, /as\.frameColor = UIColors\.GOLD;/);
    assert.match(c, /as\.exportOptions = AssignmentExportOptions\.EVERYTHING;/);
    assert.match(c, /story\.exportFile\(ExportFormat\.INCOPY_MARKUP/);
    assert.match(c, /found\.move\(LocationOptions\.AT_END, as\)/);
    const e = await one('manage_assignments', { action: 'edit', name: 'Feature', newName: 'Lead', frameColor: '#336699' });
    assert.match(e, /as\.name = "Lead";/);
    assert.match(e, /as\.frameColor = \[51, 102, 153\];/);
    const u = await one('manage_assignments', { action: 'update', which: 'out_of_date', saveDocument: true });
    assert.match(u, /doc\.save\(\);/);
    assert.match(u, /AssignmentStatus\.ASSIGNMENT_OUT_OF_DATE/);
    assert.match(u, /list\[i\]\.update\(""\);/);
    assert.match(await one('manage_assignments', { action: 'update', which: 'named', names: ['Lead'] }), /__assignment\(doc, want\[w\]\)/);
    assert.match(await one('manage_assignments', { action: 'package', name: 'Lead', path: doc('lead.icap'), submit: false }), /as\.createPackage\(File\(".*lead\.icap"\), false\)/);
    assert.match(await one('manage_assignments', { action: 'cancel_package', name: 'Lead' }), /as\.cancelPackage\(\);/);
    assert.match(await one('manage_assignments', { action: 'delete', name: 'Lead' }), /as\.remove\(\);/);
    assert.match(await one('manage_assignments', { action: 'reveal', name: 'Lead' }), /f\.parent\.execute\(\);/);
    await refuses('manage_assignments', { action: 'create', name: 'A', path: doc('a.indd') }, /must end in \.icma/);
    await refuses('manage_assignments', { action: 'edit', name: 'A' }, /Give an option to change/);
    await refuses('manage_assignments', { action: 'update', which: 'named' }, /'names' needs at least one entry/);
    await refuses('manage_assignments', { action: 'create', name: 'A', path: doc('a.icma'), content: 'some' }, /Allowed: assigned_spreads/);
});

await test('manage_incopy_content exports for InCopy, checks in all, saves content and reports status', async () => {
    const x = await one('manage_incopy_content', { action: 'export', layer: 'Copy', folder: doc('incopy') });
    assert.match(x, /doc\.layers\.itemByName\("Copy"\)/);
    assert.match(x, /__exportStory\(stories\[i\], folder\)/);
    assert.match(x, /story\.exportFile\(ExportFormat\.INCOPY_MARKUP/);
    const all = await one('manage_incopy_content', { action: 'check_in_all', comment: 'Done' });
    assert.match(all, /LockStateValues\.CHECKED_OUT_STORY/);
    assert.match(all, /st\[i\]\.checkIn\("Done"\)/);
    assert.match(await one('manage_incopy_content', { action: 'save_content', frameIds: [3] }), /itemByID\(102154\)/);
    assert.match(await one('manage_incopy_content', { action: 'status' }), /LockStateValues\.UNMANAGED_STORY/);
    await refuses('manage_incopy_content', { action: 'save_content' }, /'frameIds' is required/);
    await refuses('manage_incopy_content', { action: 'export', frameIds: [1], layer: 'Copy', folder: doc('x') }, /not both/);
    await refuses('manage_incopy_content', { action: 'check_out', frameIds: [1] }, /Allowed: export, check_in_all/);
    await refuses('manage_incopy_content', { action: 'status', comment: 'x' }, /'comment' applies to check_in_all/);
});

await test('manage_cc_library_assets and manage_pdf_comments', async () => {
    const p = await one('manage_cc_library_assets', { action: 'auto_add', swatches: true, paragraphStyles: false });
    assert.match(p, /gp\.autoAddSwatchToCCLibraries = true;/);
    assert.match(p, /gp\.autoAddParaStyleToCCLibraries = false;/);
    await refuses('manage_cc_library_assets', { action: 'auto_add', swatches: 'on' }, /true or false/);
    const c = await one('manage_cc_library_assets', { action: 'place', assetData: '{"id":"abc","linked":true}' });
    assert.match(c, /doc\.placeCloudAsset\("\{\\"id\\":\\"abc\\",\\"linked\\":true\}"\);/);
    const e = await one('manage_cc_library_assets', { action: 'export_selection', path: doc('asset.idms'), thumbnailWidth: 300 });
    assert.match(e, /app\.setCloudLibraryOptions\(300, 512\);/);
    assert.match(e, /app\.exportSelectionForCloudLibrary\(f\)/);
    await refuses('manage_cc_library_assets', { action: 'place', assetData: 'not json' }, /must be a JSON object/);
    const i = await one('manage_pdf_comments', { action: 'import', path: doc('review.pdf') });
    assert.match(i, /doc\.importPdfComments\(f, \{\}\);/);
    assert.match(await one('manage_pdf_comments', { action: 'set_status', ids: [2], status: 'resolved' }), /c\.changeStatus\(CommentStatusEnum\.RESOLVED_STATUS, \{\}\);/);
    assert.match(await one('manage_pdf_comments', { action: 'delete', ids: [2] }), /c\.remove\(\);/);
    await refuses('manage_pdf_comments', { action: 'set_status', ids: [2], status: 'done' }, /Allowed: open, resolved/);
    await refuses('manage_pdf_comments', { action: 'import', path: doc('review.indd') }, /must end in \.pdf/);
});

done();
