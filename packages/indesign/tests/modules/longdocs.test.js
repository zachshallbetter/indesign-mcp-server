/**
 * Long-document tools (src/tools/long-documents.js): the scripts carry the
 * right object-model statements, and bad arguments are refused before
 * anything is sent to InDesign.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const refuses = (name, args, re) => assert.throws(() => tool(name).handler(args), re);
const doc = path.join(home, 'Documents', 'chapter.indd');
const book = path.join(home, 'Documents', 'manual.indb');

await test('text locations: find, story range, frame, selection; only the helpers a script uses', async () => {
    const s = await one('insert_note', { kind: 'footnote', at: { find: 'a^b', occurrence: 2 }, text: 'See below.' });
    assert.match(s, /"find":"a\^\^b","occurrence":2,"storyId":null,"frameId":null,"selection":false,"start":null,"length":0,"before":false/);
    assert.match(s, /app\.findTextPreferences\.findWhat = what;/);
    assert.match(s, /var note = ip\.footnotes\.add\(\);/);
    assert.match(s, /note\.insertionPoints\.lastItem\(\)\.contents = "See below\.";/);
    assert.doesNotMatch(s, /__ldBook|__ldTopic/);
    const r = await one('insert_note', { kind: 'endnote', at: { storyId: 12, start: 4, length: 3, before: true } });
    assert.match(r, /"storyId":12,"frameId":null,"selection":false,"start":4,"length":3,"before":true/);
    assert.match(r, /var note = ip\.createEndnote\(\);/);
    const f = await one('insert_text_variable', { name: 'Running Header', at: { frameId: 5 } });
    assert.match(f, /"frameId":5/);
    assert.match(f, /ip\.textVariableInstances\.add\(\{ associatedTextVariable: v \}\)/);
});

await test('text locations are checked', () => {
    refuses('insert_note', { kind: 'footnote', at: {} }, /exactly one of find, storyId, frameId or selection/);
    refuses('insert_note', { kind: 'footnote', at: { find: 'x', storyId: 3 } }, /exactly one/);
    refuses('insert_note', { kind: 'footnote', at: { find: 'x', start: 2 } }, /start' goes with storyId or frameId/);
    refuses('insert_note', { kind: 'footnote', at: { storyId: 3, length: 2 } }, /needs start/);
    refuses('insert_note', { kind: 'footnote', at: { find: '' } }, /is empty/);
    refuses('insert_note', { kind: 'sidenote', at: { find: 'x' } }, /Allowed: footnote, endnote/);
    refuses('insert_note', { kind: 'footnote', at: { storyId: -1 } }, /whole number/);
});

await test('define_toc_style: style options, entries and EPUB navigation', async () => {
    const s = await one('define_toc_style', {
        name: 'Contents',
        options: { title: 'Contents', titleStyle: 'TOC Title', createBookmarks: true, runIn: false, includeHiddenLayers: false, includeBookDocuments: true, makeAnchor: true, removeForcedLineBreak: true, numberedParagraphs: 'INCLUDE_NUMBERS_ONLY', frameDirection: 'VERTICAL' },
        entries: [{ paragraphStyle: 'Heading 1', entryStyle: 'TOC 1', level: 1, pageNumber: 'AFTER_ENTRY', pageNumberStyle: 'Page', separator: '^y', separatorStyle: 'Leader', sortAlphabetically: false }],
        replaceEntries: true,
        epubNavigation: true,
    });
    for (const re of [
        /doc\.tocStyles\.add\(\{ name: "Contents" \}\)/, /st\.title = "Contents";/, /st\.titleStyle = __ldStyle\(doc, "p", "TOC Title"\);/,
        /st\.createBookmarks = true;/, /st\.includeBookDocuments = true;/, /st\.includeHidden = false;/, /st\.makeAnchor = true;/,
        /st\.removeForcedLineBreak = true;/, /st\.numberedParagraphs = NumberedParagraphsOptions\.INCLUDE_NUMBERS_ONLY;/,
        /st\.setStoryDirection = HorizontalOrVertical\.VERTICAL;/, /st\.tocStyleEntries\[r\]\.remove\(\)/,
        /st\.tocStyleEntries\.add\(ps\.name\)/, /en\.formatStyle = __ldStyle\(doc, "p", "TOC 1"\);/, /en\.level = 1;/,
        /en\.pageNumberPosition = PageNumberPosition\.AFTER_ENTRY;/, /en\.pageNumberStyle = __ldStyle\(doc, "c", "Page"\);/,
        /en\.separator = "\^y";/, /en\.separatorStyle = __ldStyle\(doc, "c", "Leader"\);/, /en\.sortAlphabet = false;/,
        /doc\.epubExportPreferences\.tocStyleName = st\.name;/,
    ]) assert.match(s, re);
});

await test('define_toc_style refuses unknown options and entries without a style', () => {
    refuses('define_toc_style', { name: 'Contents', options: { colour: 'red' } }, /Unknown option 'options\.colour'/);
    refuses('define_toc_style', { name: 'Contents', entries: [{ level: 1 }] }, /entries\[0\]\.paragraphStyle/);
    refuses('define_toc_style', { name: 'Contents', entries: [{ paragraphStyle: 'H1', level: 0 }] }, /entries\[0\]\.level/);
    refuses('define_toc_style', { name: '' }, /'name' is empty/);
});

await test('create_toc: placement, update, book and interactive', async () => {
    const s = await one('create_toc', { style: 'Contents', pageIndex: 1, x: 20, y: 30, replaceExisting: true, bookPath: book, includeOverset: true, interactive: true });
    assert.match(s, /var page = __page\(doc, 1\);/);
    assert.match(s, /__toPage\(page, 20, 30\)/);
    assert.match(s, /doc\.createTOC\(st, true, __ldBook\(".*manual\.indb"\), pt, true, layer\)/);
    assert.match(s, /app\.pdfExportPreferences\.includeBookmarks = true;/);
    assert.match(s, /app\.pdfExportPreferences\.includeHyperlinks = true;/);
    const d = await one('create_toc', {});
    assert.match(d, /"\[Default\]"/);
    assert.match(d, /doc\.createTOC\(st, false, undefined, pt, false, layer\)/);
    assert.match(d, /page\.marginPreferences\.left/);
    refuses('create_toc', { bookPath: '/etc/books/x.indb' }, /Access denied|outside the allowed/);
});

await test('set_note_options: footnote numbering, layout and rules; endnotes; Word import', async () => {
    const s = await one('set_note_options', {
        footnotes: {
            numberingStyle: 'LOWER_ROMAN', startAt: 1, restartNumbering: 'PAGE_RESTART', showPrefixSuffix: 'PREFIX_SUFFIX_BOTH', prefix: '[', suffix: ']',
            markerPosition: 'SUPERSCRIPT_MARKER', markerCharacterStyle: 'Note ref', paragraphStyle: 'Footnote', separator: '^t',
            spaceBefore: 4, spaceBetween: 1, firstBaselineOffset: 'LEADING_OFFSET', firstBaselineMinimum: 2, placeAtBottomOfText: true,
            allowSplit: false, spanColumns: true,
            ruleAbove: { on: true, weight: 0.5, type: 'Solid', color: 'Black', tint: 50, width: 40, offset: 1, leftIndent: 0, overprint: false, gapColor: '#FF0000', gapTint: 20, gapOverprint: false },
            continuedRuleAbove: { on: true, width: 100 },
        },
        endnotes: { numberingStyle: 'ARABIC', startAt: 1, restartNumbering: 'STORY_RESTART', showPrefixSuffix: 'NO_PREFIX_SUFFIX', prefix: '', suffix: '.', markerPosition: 'SUPERSCRIPT_MARKER', markerCharacterStyle: 'Note ref', paragraphStyle: 'Endnote', separator: '^t', title: 'Notes', titleStyle: 'Heading 2', scope: 'STORY_SCOPE', frame: 'NEW_PAGE' },
        wordImport: { importFootnotes: true, importEndnotes: true, importAsStaticEndnotes: false },
    });
    for (const re of [
        /fo\.footnoteNumberingStyle = FootnoteNumberingStyle\.LOWER_ROMAN;/, /fo\.startAt = 1;/, /fo\.restartNumbering = FootnoteRestarting\.PAGE_RESTART;/,
        /fo\.showPrefixSuffix = FootnotePrefixSuffix\.PREFIX_SUFFIX_BOTH;/, /fo\.prefix = "\[";/, /fo\.suffix = "\]";/,
        /fo\.markerPositioning = FootnoteMarkerPositioning\.SUPERSCRIPT_MARKER;/, /fo\.footnoteMarkerStyle = __ldStyle\(doc, "c", "Note ref"\);/,
        /fo\.footnoteTextStyle = __ldStyle\(doc, "p", "Footnote"\);/, /fo\.separatorText = "\^t";/, /fo\.spacer = 4;/, /fo\.spaceBetween = 1;/,
        /fo\.footnoteFirstBaselineOffset = FootnoteFirstBaseline\.LEADING_OFFSET;/, /fo\.footnoteMinimumFirstBaselineOffset = 2;/,
        /fo\.eosPlacement = true;/, /fo\.noSplitting = true;/, /fo\.enableStraddling = true;/,
        /fo\.ruleOn = true;/, /fo\.ruleLineWeight = "0\.5pt";/, /fo\.ruleType = __ldNamed\(doc\.strokeStyles, "Solid", "stroke style"\);/,
        /fo\.ruleColor = __swatch\(doc, \{"kind":"name","name":"Black"\}\);/, /fo\.ruleTint = 50;/, /fo\.ruleWidth = 40;/, /fo\.ruleOffset = 1;/,
        /fo\.ruleLeftIndent = 0;/, /fo\.ruleOverprint = false;/, /fo\.ruleGapColor = __swatch\(doc, \{"kind":"rgb","v":\[255,0,0\]\}\);/,
        /fo\.ruleGapTint = 20;/, /fo\.ruleGapOverprint = false;/, /fo\.continuingRuleOn = true;/, /fo\.continuingRuleWidth = 100;/,
        /eo\.endnoteNumberingStyle = FootnoteNumberingStyle\.ARABIC;/, /eo\.startEndnoteNumberAt = 1;/, /eo\.restartEndnoteNumbering = EndnoteRestarting\.STORY_RESTART;/,
        /eo\.showEndnotePrefixSuffix = FootnotePrefixSuffix\.NO_PREFIX_SUFFIX;/, /eo\.endnoteSuffix = "\.";/, /eo\.endnoteMarkerPositioning = FootnoteMarkerPositioning\.SUPERSCRIPT_MARKER;/,
        /eo\.endnoteMarkerStyle = __ldStyle/, /eo\.endnoteTextStyle = __ldStyle\(doc, "p", "Endnote"\);/, /eo\.endnoteSeparatorText = "\^t";/,
        /eo\.endnoteTitle = "Notes";/, /eo\.endnoteTitleStyle = __ldStyle\(doc, "p", "Heading 2"\);/, /eo\.scopeValue = EndnoteScope\.STORY_SCOPE;/,
        /eo\.frameCreateOption = EndnoteFrameCreate\.NEW_PAGE;/,
        /wp\.importFootnotes = true;/, /wp\.importEndnotes = true;/, /wp\.importAsStaticEndnotes = false;/,
    ]) assert.match(s, re);
});

await test('set_note_options refuses empty calls and bad values', () => {
    refuses('set_note_options', {}, /Nothing to set/);
    refuses('set_note_options', { footnotes: { numberingStyle: 'ROMAN' } }, /Allowed: ARABIC/);
    refuses('set_note_options', { footnotes: { startAt: 0 } }, /footnotes\.startAt/);
    refuses('set_note_options', { footnotes: { ruleAbove: { tint: 120 } } }, /out of range/);
    refuses('set_note_options', { footnotes: { ruleAbove: { thickness: 1 } } }, /Unknown option 'footnotes\.ruleAbove\.thickness'/);
    refuses('set_note_options', { endnotes: { prefix: 3 } }, /must be a string/);
});

await test('manage_footnotes: conversions, delete, go to reference and text', async () => {
    const [toEnd, toFoot, toText, del, ref, txt] = await scriptsFor([
        ['manage_footnotes', { action: 'convert_to_endnotes' }],
        ['manage_footnotes', { action: 'convert_to_footnotes', ids: [4, 5], storyId: 9 }],
        ['manage_footnotes', { action: 'convert_to_text', ids: [4] }],
        ['manage_footnotes', { action: 'delete', kind: 'endnote', ids: [8] }],
        ['manage_footnotes', { action: 'show_reference', kind: 'endnote', ids: [8] }],
        ['manage_footnotes', { action: 'show_text', kind: 'footnote', ids: [4] }],
    ]);
    assert.match(toEnd, /var notes = stories\[s\]\.footnotes;/);
    assert.match(toEnd, /var made = ip\.createEndnote\(\);/);
    assert.match(toEnd, /made\.insertTextInEndnote\(made\.insertionPoints\.lastItem\(\), body\);/);
    assert.match(toEnd, /n\.remove\(\);/);
    assert.match(toFoot, /var notes = stories\[s\]\.endnotes;/);
    assert.match(toFoot, /var made = ip\.footnotes\.add\(\);/);
    assert.match(toFoot, /n\.deleteEndnote\(\);/);
    assert.match(toFoot, /doc\.stories\.itemByID\(9\)/);
    assert.match(toFoot, /var ids = \[4, 5\]/);
    assert.match(toText, /n\.convertToText\(\);/);
    assert.match(del, /n\.deleteEndnote\(\);/);
    assert.match(ref, /n\.storyOffset\.showText\(\);/);
    assert.match(txt, /n\.texts\[0\]\.showText\(\);/);
    refuses('manage_footnotes', { action: 'show_text', kind: 'footnote' }, /exactly one note id/);
    refuses('manage_footnotes', { action: 'delete', kind: 'footnote' }, /needs 'ids' or 'storyId'/);
    refuses('manage_footnotes', { action: 'delete', ids: [1] }, /'kind'/);
    refuses('manage_footnotes', { action: 'convert_to_text', ids: [] }, /must list note ids/);
});

await test('manage_index: topics, page references, quick and proper-name entries, cross-references', async () => {
    const [topic, ref, quick, proper, xref] = await scriptsFor([
        ['manage_index', { action: 'add_topic', topic: ['Fruit', 'Apples'], sortOrder: 'apple' }],
        ['manage_index', { action: 'add_page_reference', topic: ['Fruit'], text: { find: 'apples' }, referenceType: 'FOR_NEXT_N_PARAGRAPHS', referenceCount: 3, pageNumberStyle: 'Bold' }],
        ['manage_index', { action: 'index_text', text: { selection: true } }],
        ['manage_index', { action: 'index_text', text: { find: 'Ada Lovelace' }, properName: true, referenceType: 'TO_NEXT_USE_OF_STYLE', referenceStyle: 'Heading 1' }],
        ['manage_index', { action: 'add_cross_reference', topic: ['Pomes'], referencedTopic: ['Fruit', 'Apples'], crossReferenceType: 'SEE_ALSO' }],
    ]);
    assert.match(topic, /__ldTopic\(ix, \["Fruit", "Apples"\], true, "apple"\)/);
    assert.match(topic, /parent\.topics\.add\(path\[i\], sortOrder\)/);
    assert.match(topic, /doc\.indexes\.add\(\)/);
    assert.match(ref, /t\.pageReferences\.add\(src, PageReferenceType\.FOR_NEXT_N_PARAGRAPHS\);/);
    assert.match(ref, /pr\.pageReferenceLimit = 3;/);
    assert.match(ref, /pr\.pageNumberStyleOverride = __ldStyle\(doc, "c", "Bold"\);/);
    assert.match(quick, /"selection":true/);
    assert.match(quick, /PageReferenceType\.CURRENT_PAGE/);
    assert.doesNotMatch(quick, /parts\.pop\(\)/);
    assert.match(proper, /name = parts\.pop\(\) \+ ", " \+ parts\.join\(" "\);/);
    assert.match(proper, /pr\.pageReferenceLimit = __ldStyle\(doc, "p", "Heading 1"\);/);
    assert.match(xref, /t\.crossReferences\.add\(target, CrossReferenceType\.SEE_ALSO, ""\);/);
});

await test('manage_index: duplicate, delete, capitalize, unused, import, preview, marker and sort options', async () => {
    const [dup, del, capTopic, capAll, unused, imp, prev, show, sort] = await scriptsFor([
        ['manage_index', { action: 'duplicate_topic', topic: ['Fruit'], newName: 'Fruits' }],
        ['manage_index', { action: 'delete_topic', topic: ['Fruit'] }],
        ['manage_index', { action: 'capitalize', topic: ['fruit'], capitalization: 'INCLUDE_SUBENTRIES' }],
        ['manage_index', { action: 'capitalize' }],
        ['manage_index', { action: 'remove_unused_topics' }],
        ['manage_index', { action: 'import_topics', filePath: doc }],
        ['manage_index', { action: 'update_preview' }],
        ['manage_index', { action: 'show_page_reference', topic: ['Fruit'], referenceIndex: 1 }],
        ['manage_index', { action: 'set_sort_options', sortOptions: [{ name: 'Symbol', include: true, priority: 3, headerType: 'BASIC_LATIN' }] }],
    ]);
    assert.match(dup, /c\.pageReferences\.add\(p\.sourceText, p\.pageReferenceType\)/);
    assert.match(dup, /c\.crossReferences\.add\(cr\.referencedTopic, cr\.crossReferenceType, cr\.customTypeString\)/);
    assert.match(dup, /var copyName = "Fruits";/);
    assert.match(del, /t\.remove\(\);/);
    assert.match(capTopic, /t\.capitalize\(IndexCapitalizationOptions\.INCLUDE_SUBENTRIES\);/);
    assert.match(capAll, /ix\.capitalize\(IndexCapitalizationOptions\.ALL_ENTRIES\);/);
    assert.match(unused, /ix\.removeUnusedTopics\(\);/);
    assert.match(imp, /ix\.importTopics\(f\);/);
    assert.match(prev, /ix\.update\(\);/);
    assert.match(show, /var k = 1;/);
    assert.match(show, /src\.showText\(\);/);
    assert.match(sort, /__ldNamed\(doc\.indexingSortOptions, "Symbol", "index sort group"\)/);
    assert.match(sort, /so\.include = true;/);
    assert.match(sort, /so\.priority = 3;/);
    assert.match(sort, /so\.headerType = HeaderTypes\.BASIC_LATIN;/);
    refuses('manage_index', { action: 'add_topic', topic: ['a', 'b', 'c', 'd', 'e'] }, /1 to 4 names/);
    refuses('manage_index', { action: 'add_topic' }, /'topic' must list/);
    refuses('manage_index', { action: 'add_page_reference', topic: ['A'], text: { find: 'x' }, referenceType: 'NEXT_PAGE' }, /Allowed: CURRENT_PAGE/);
    refuses('manage_index', { action: 'add_page_reference', topic: ['A'], text: { find: 'x' }, referenceType: 'TO_NEXT_USE_OF_STYLE' }, /referenceStyle/);
    refuses('manage_index', { action: 'set_sort_options', sortOptions: [] }, /must list sort groups/);
    refuses('manage_index', { action: 'import_topics', filePath: '/etc/passwd' }, /Access denied|outside the allowed/);
    refuses('manage_index', { action: 'reindex' }, /Allowed: add_topic/);
});

await test('generate_index: every option, placement and generate()', async () => {
    const s = await one('generate_index', {
        options: {
            title: 'Index', titleStyle: 'Index Title', replaceExisting: true, includeBookDocuments: true, includeHiddenEntries: false, format: 'RUNIN_FORMAT',
            includeSectionHeadings: true, includeEmptySections: false, level1Style: 'Index 1', level2Style: 'Index 2', level3Style: 'Index 3', level4Style: 'Index 4',
            sectionHeadingStyle: 'Index Head', pageNumberStyle: 'Page', crossReferenceStyle: 'Italic', crossReferenceTopicStyle: 'Topic',
            followingTopicSeparator: '  ', betweenPageNumbersSeparator: ', ', betweenEntriesSeparator: '; ', beforeCrossReferenceSeparator: '. ', pageRangeSeparator: '^=', entryEndSeparator: '',
        },
        pageIndex: 3, autoflow: true, layer: 'Text',
    });
    for (const re of [
        /io\.title = "Index";/, /io\.titleStyle = __ldStyle\(doc, "p", "Index Title"\);/, /io\.replaceExistingIndex = true;/, /io\.includeBookDocuments = true;/,
        /io\.includeHiddenEntries = false;/, /io\.indexFormat = IndexFormat\.RUNIN_FORMAT;/, /io\.includeSectionHeadings = true;/, /io\.includeEmptyIndexSections = false;/,
        /io\.level1Style = __ldStyle/, /io\.level4Style = __ldStyle\(doc, "p", "Index 4"\);/, /io\.sectionHeadingStyle = /, /io\.pageNumberStyle = __ldStyle\(doc, "c", "Page"\);/,
        /io\.crossReferenceStyle = /, /io\.crossReferenceTopicStyle = /, /io\.followingTopicSeparator = "  ";/, /io\.betweenPageNumbersSeparator = ", ";/,
        /io\.betweenEntriesSeparator = "; ";/, /io\.beforeCrossReferenceSeparator = "\. ";/, /io\.pageRangeSeparator = "\^=";/, /io\.entryEndSeparator = "";/,
        /__ldNamed\(doc\.layers, "Text", "layer"\)/, /ix\.generate\(page, pt, layer, true, false\)/, /var page = __page\(doc, 3\);/,
    ]) assert.match(s, re);
    refuses('generate_index', { options: { format: 'TABLE' } }, /Allowed: NESTED_FORMAT/);
    refuses('generate_index', { pageIndex: -2 }, /pageIndex/);
});

await test('manage_conditions: conditions, indicators, loading and condition sets', async () => {
    const [create, edit, del, show, hide, ind, load, mkSet, redefine, activate, delSet] = await scriptsFor([
        ['manage_conditions', { action: 'create', name: 'Print', options: { visible: true, indicatorMethod: 'USE_UNDERLINE', indicatorColor: 'grid green', underlineAppearance: 'WAVY' } }],
        ['manage_conditions', { action: 'edit', name: 'Print', newName: 'Print only', options: { indicatorColor: '#00FF00' } }],
        ['manage_conditions', { action: 'delete', name: 'Web', replaceWith: 'Print' }],
        ['manage_conditions', { action: 'show_all' }],
        ['manage_conditions', { action: 'hide_all' }],
        ['manage_conditions', { action: 'set_indicators', indicators: 'SHOW_AND_PRINT_INDICATORS' }],
        ['manage_conditions', { action: 'load', filePath: doc, includeSets: true }],
        ['manage_conditions', { action: 'create_set', name: 'Print edition', visibility: [{ condition: 'Web', visible: false }] }],
        ['manage_conditions', { action: 'redefine_set', name: 'Print edition' }],
        ['manage_conditions', { action: 'activate_set', name: 'Print edition' }],
        ['manage_conditions', { action: 'delete_set', name: 'Print edition' }],
    ]);
    assert.match(create, /doc\.conditions\.add\(\{ name: "Print" \}\)/);
    assert.match(create, /c\.indicatorMethod = ConditionIndicatorMethod\.USE_UNDERLINE;/);
    assert.match(create, /c\.indicatorColor = UIColors\.GRID_GREEN;/);
    assert.match(create, /c\.underlineIndicatorAppearance = ConditionUnderlineIndicatorAppearance\.WAVY;/);
    assert.match(edit, /c\.indicatorColor = \[0, 255, 0\];/);
    assert.match(edit, /c\.name = "Print only";/);
    assert.match(del, /c\.remove\(__ldNamed\(doc\.conditions, "Print", "condition"\)\);/);
    assert.match(show, /doc\.conditions\[i\]\.visible = true;/);
    assert.match(hide, /doc\.conditions\[i\]\.visible = false;/);
    assert.match(ind, /showConditionIndicators = ConditionIndicatorMode\.SHOW_AND_PRINT_INDICATORS;/);
    assert.match(load, /doc\.loadConditions\(f, true\);/);
    assert.match(mkSet, /__ldNamed\(doc\.conditions, "Web", "condition"\)\.visible = false;/);
    assert.match(mkSet, /doc\.conditionSets\.add\(\{ name: "Print edition" \}\)/);
    assert.match(redefine, /cs\.redefine\(\);/);
    assert.match(activate, /doc\.conditionalTextPreferences\.activeConditionSet = cs;/);
    assert.match(delSet, /cs\.remove\(\);/);
    refuses('manage_conditions', { action: 'create', name: 'X', options: { indicatorColor: 'mauve' } }, /Allowed: LIGHT_BLUE/);
    refuses('manage_conditions', { action: 'edit', name: 'X' }, /needs options or newName/);
    refuses('manage_conditions', { action: 'set_indicators', indicators: 'BLINK' }, /Allowed: SHOW_INDICATORS/);
});

await test('apply_conditions: apply, add, remove and clear', async () => {
    const [apply, add, remove, clear] = await scriptsFor([
        ['apply_conditions', { text: { find: 'Online only' }, conditions: ['Web'] }],
        ['apply_conditions', { text: { storyId: 3 }, conditions: ['Web', 'Print'], mode: 'add' }],
        ['apply_conditions', { text: { selection: true }, conditions: ['Web'], mode: 'remove' }],
        ['apply_conditions', { text: { frameId: 4 }, mode: 'clear' }],
    ]);
    assert.match(apply, /t\.applyConditions\(conds, true\);/);
    assert.match(add, /var names = \["Web", "Print"\]/);
    assert.match(add, /t\.applyConditions\(conds, false\);/);
    assert.match(remove, /t\.appliedConditions/);
    assert.match(remove, /t\.applyConditions\(keep, true\);/);
    assert.match(clear, /t\.applyConditions\(\[\], true\);/);
    refuses('apply_conditions', { text: { find: 'x' }, conditions: [] }, /must list 1 to 200 names/);
    refuses('apply_conditions', { text: { find: 'x' }, conditions: ['A'], mode: 'toggle' }, /Allowed: apply/);
});

await test('cross-reference formats: building blocks, delete and load', async () => {
    const [create, del, load] = await scriptsFor([
        ['manage_cross_reference_formats', { action: 'create', name: 'See page', characterStyle: 'Xref', blocks: [{ type: 'custom_text', text: 'see page ' }, { type: 'page_number', characterStyle: 'Bold' }, { type: 'paragraph_text', delimiter: ':', includeDelimiter: false }] }],
        ['manage_cross_reference_formats', { action: 'delete', name: 'See page' }],
        ['manage_cross_reference_formats', { action: 'load', filePath: doc }],
    ]);
    assert.match(create, /doc\.crossReferenceFormats\.add\("See page"\)/);
    assert.match(create, /fm\.appliedCharacterStyle = __ldStyle\(doc, "c", "Xref"\);/);
    assert.match(create, /fm\.buildingBlocks\.add\(BuildingBlockTypes\.CUSTOM_STRING_BUILDING_BLOCK\);/);
    assert.match(create, /b\.customText = "see page ";/);
    assert.match(create, /BuildingBlockTypes\.PAGE_NUMBER_BUILDING_BLOCK/);
    assert.match(create, /b\.appliedDelimiter = ":";/);
    assert.match(create, /b\.includeDelimiter = false;/);
    assert.match(del, /fm\.remove\(\);/);
    assert.match(load, /doc\.importFormats\(f\);/);
    refuses('manage_cross_reference_formats', { action: 'create', name: 'X', blocks: [{ type: 'page' }] }, /Allowed: paragraph_text/);
    refuses('manage_cross_reference_formats', { action: 'edit', name: 'X' }, /needs characterStyle, blocks or newName/);
});

await test('insert_cross_reference: to a paragraph or a text anchor', async () => {
    const [para, anchor] = await scriptsFor([
        ['insert_cross_reference', { at: { find: 'see ' }, destination: { paragraph: { find: 'Installing' } }, format: 'Page Number', name: 'install-ref' }],
        ['insert_cross_reference', { at: { selection: true }, destination: { anchor: 'Appendix' }, format: 'Full Paragraph' }],
    ]);
    assert.match(para, /doc\.paragraphDestinations\.add\(__ldText\(doc, \{"find":"Installing"/);
    assert.match(para, /\.paragraphs\[0\]\)/);
    assert.match(para, /doc\.crossReferenceSources\.add\(ip, fm\)/);
    assert.match(para, /doc\.hyperlinks\.add\(src, dest\)/);
    assert.match(para, /link\.name = "install-ref";/);
    assert.match(anchor, /__ldNamed\(doc\.hyperlinkTextDestinations, "Appendix", "text anchor"\)/);
    refuses('insert_cross_reference', { at: { find: 'x' }, destination: { url: 'https://x.org' }, format: 'Page' }, /url' is not allowed/);
    refuses('insert_cross_reference', { at: { find: 'x' }, destination: { anchor: 'A', paragraph: { find: 'y' } }, format: 'Page' }, /exactly one destination/);
});

await test('manage_hyperlinks: options, relink, format, reset, delete, navigation and updates', async () => {
    const calls = [
        ['manage_hyperlinks', { action: 'rename', name: 'Link 1', newName: 'Home' }],
        ['manage_hyperlinks', { action: 'set_appearance', id: 44, appearance: { visible: true, highlight: 'OUTLINE', color: 'red', width: 'THICK', style: 'DASHED' } }],
        ['manage_hyperlinks', { action: 'set_destination', name: 'Link 1', destination: { url: 'https://example.com' } }],
        ['manage_hyperlinks', { action: 'set_destination', name: 'Xref 2', destination: { paragraph: { storyId: 3, start: 120 } } }],
        ['manage_hyperlinks', { action: 'set_destination', name: 'Link 1', destination: { pageIndex: 4 } }],
        ['manage_hyperlinks', { action: 'set_format', name: 'Xref 2', format: 'Page Number' }],
        ['manage_hyperlinks', { action: 'reset_source', name: 'Link 1', source: { find: 'our site' } }],
        ['manage_hyperlinks', { action: 'delete', name: 'Link 1' }],
        ['manage_hyperlinks', { action: 'show_source', name: 'Link 1' }],
        ['manage_hyperlinks', { action: 'show_destination', name: 'Link 1' }],
        ['manage_hyperlinks', { action: 'update_cross_references' }],
        ['manage_hyperlinks', { action: 'update_cross_references', name: 'Xref 2' }],
        ['manage_hyperlinks', { action: 'rename_destination', name: 'Anchor 1', newName: 'Appendix' }],
    ];
    const [rename, look, url, relink, page, format, reset, del, src, dst, updAll, updOne, renDest] = await scriptsFor(calls);
    assert.match(rename, /link\.name = "Home";/);
    assert.match(look, /doc\.hyperlinks\.itemByID\(id\)/);
    assert.match(look, /__ldLink\(doc, null, 44\)/);
    for (const re of [/link\.visible = true;/, /link\.highlight = HyperlinkAppearanceHighlight\.OUTLINE;/, /link\.borderColor = UIColors\.RED;/, /link\.width = HyperlinkAppearanceWidth\.THICK;/, /link\.borderStyle = HyperlinkAppearanceStyle\.DASHED;/]) assert.match(look, re);
    assert.match(url, /doc\.hyperlinkURLDestinations\.add\("https:\/\/example\.com"\)/);
    assert.match(url, /link\.destination = dest;/);
    assert.match(relink, /doc\.paragraphDestinations\.add\(/);
    assert.match(page, /doc\.hyperlinkPageDestinations\.add\(__page\(doc, 4\)\)/);
    assert.match(format, /link\.source\.appliedFormat = __ldNamed\(doc\.crossReferenceFormats, "Page Number"/);
    assert.match(reset, /link\.source = doc\.hyperlinkTextSources\.add\(__ldText/);
    assert.match(del, /link\.remove\(\);/);
    assert.match(src, /link\.showSource\(\);/);
    assert.match(dst, /link\.showDestination\(\);/);
    assert.match(updAll, /doc\.updateCrossReferences\(\);/);
    assert.match(updOne, /link\.source\.update\(\);/);
    assert.match(renDest, /__ldNamed\(doc\.hyperlinkTextDestinations, "Anchor 1", "text anchor"\)/);
    assert.match(renDest, /d\.name = "Appendix";/);
    refuses('manage_hyperlinks', { action: 'rename', newName: 'X' }, /'name' or 'id'/);
    refuses('manage_hyperlinks', { action: 'set_destination', name: 'L', destination: { url: 'javascript:alert(1)' } }, /must start with http/);
    refuses('manage_hyperlinks', { action: 'set_appearance', name: 'L', appearance: {} }, /needs appearance options/);
});

await test('manage_bookmarks: add, nest, delete, rename, go to, move and sort', async () => {
    const [addPage, addText, del, ren, show, move, sortPage, sortName] = await scriptsFor([
        ['manage_bookmarks', { action: 'add', name: 'Chapter 1', destination: { pageIndex: 2 } }],
        ['manage_bookmarks', { action: 'add', name: 'Section 1.1', destination: { text: { find: 'Section 1.1' } }, parent: 'Chapter 1' }],
        ['manage_bookmarks', { action: 'delete', name: 'Old' }],
        ['manage_bookmarks', { action: 'rename', name: 'Chapter 1', newName: 'Introduction' }],
        ['manage_bookmarks', { action: 'show', name: 'Introduction' }],
        ['manage_bookmarks', { action: 'move', name: 'Section 1.1', position: 'after', reference: 'Introduction' }],
        ['manage_bookmarks', { action: 'sort' }],
        ['manage_bookmarks', { action: 'sort', parent: 'Introduction', sortBy: 'name' }],
    ]);
    assert.match(addPage, /var dest = __page\(doc, 2\);/);
    assert.match(addPage, /var bm = coll\.add\(dest\);/);
    assert.match(addPage, /bm\.name = "Chapter 1";/);
    assert.match(addText, /doc\.hyperlinkTextDestinations\.add\(__ldText/);
    assert.match(addText, /coll = __bm\.bookmarks/);
    assert.match(del, /__bm\.remove\(\);/);
    assert.match(ren, /__bm\.name = "Introduction";/);
    assert.match(show, /__bm\.showBookmark\(\);/);
    assert.match(move, /__bm\.move\(LocationOptions\.AFTER, ref\);/);
    assert.match(sortPage, /d\.destinationPage\.documentOffset/);
    assert.match(sortPage, /keyed\[j\]\.bm\.move\(LocationOptions\.AT_END, parentRef\);/);
    assert.match(sortName, /String\(items\[i\]\.name\)\.toLowerCase\(\)/);
    refuses('manage_bookmarks', { action: 'move', name: 'A', position: 'before' }, /needs reference/);
    refuses('manage_bookmarks', { action: 'add', name: 'A', destination: { url: 'https://x' } }, /url' is not allowed/);
    refuses('manage_bookmarks', { action: 'sort', sortBy: 'date' }, /Allowed: page, name/);
});

await test('define_text_variable: every type and its options', async () => {
    const [run, chap, last, date, file, custom, para, char, cap, edit] = await scriptsFor([
        ['define_text_variable', { name: 'Running Head', type: 'running_header_paragraph', options: { paragraphStyle: 'Heading 1', use: 'LAST_ON_PAGE', changeCase: 'UPPERCASE', deleteEndPunctuation: true, textBefore: '— ', textAfter: ' —' } }],
        ['define_text_variable', { name: 'Chapter', type: 'chapter_number', options: { numberFormat: 'UPPER_ROMAN', textBefore: 'Chapter ' } }],
        ['define_text_variable', { name: 'Pages', type: 'last_page_number', options: { scope: 'SECTION_SCOPE', numberFormat: 'CURRENT' } }],
        ['define_text_variable', { name: 'Printed', type: 'output_date', options: { dateFormat: 'MMMM d, yyyy' } }],
        ['define_text_variable', { name: 'File', type: 'file_name', options: { includePath: true, includeExtension: false } }],
        ['define_text_variable', { name: 'Edition', type: 'custom_text', options: { text: 'Second edition' } }],
        ['define_text_variable', { name: 'Para head', type: 'running_header_paragraph', options: { paragraphStyle: 'H2' } }],
        ['define_text_variable', { name: 'Term', type: 'running_header_character', options: { characterStyle: 'Term', use: 'FIRST_ON_PAGE' } }],
        ['define_text_variable', { name: 'Credit', type: 'metadata_caption', options: { metadataField: 'Credit', textBefore: 'Photo: ' } }],
        ['define_text_variable', { name: 'Edition', newName: 'Edition name', options: { text: 'Third' } }],
    ]);
    assert.match(run, /doc\.textVariables\.add\(\{ name: "Running Head", variableType: VariableTypes\.MATCH_PARAGRAPH_STYLE_TYPE \}\)/);
    for (const re of [/vo\.appliedParagraphStyle = __ldStyle\(doc, "p", "Heading 1"\);/, /vo\.searchStrategy = SearchStrategies\.LAST_ON_PAGE;/, /vo\.changeCase = ChangeCaseOptions\.UPPERCASE;/, /vo\.deleteEndPunctuation = true;/, /vo\.textBefore = "— ";/, /vo\.textAfter = " —";/]) assert.match(run, re);
    assert.match(chap, /VariableTypes\.CHAPTER_NUMBER_TYPE/);
    assert.match(chap, /vo\.format = VariableNumberingStyles\.UPPER_ROMAN;/);
    assert.match(last, /vo\.scope = VariableScopes\.SECTION_SCOPE;/);
    assert.match(date, /VariableTypes\.OUTPUT_DATE_TYPE/);
    assert.match(date, /vo\.format = "MMMM d, yyyy";/);
    assert.match(file, /vo\.includePath = true;/);
    assert.match(file, /vo\.includeExtension = false;/);
    assert.match(custom, /vo\.contents = "Second edition";/);
    assert.match(para, /VariableTypes\.MATCH_PARAGRAPH_STYLE_TYPE/);
    assert.match(char, /vo\.appliedCharacterStyle = __ldStyle\(doc, "c", "Term"\);/);
    assert.match(cap, /VariableTypes\.LIVE_CAPTION_TYPE/);
    assert.match(cap, /vo\.metadataProviderName = "Credit";/);
    assert.match(edit, /give a type to create it/);
    assert.match(edit, /v\.name = "Edition name";/);
    refuses('define_text_variable', { name: 'X', type: 'custom_text', options: { includePath: true } }, /Unknown option 'options\.includePath'\. Allowed: text/);
    refuses('define_text_variable', { name: 'X', type: 'page_count' }, /Allowed: custom_text/);
    refuses('define_text_variable', { name: 'X', type: 'chapter_number', options: { numberFormat: 'KATAKANA' } }, /Allowed: ARABIC/);
});

await test('convert_text_variables: a variable, or the instances in some text', async () => {
    const [all, inText] = await scriptsFor([
        ['convert_text_variables', { name: 'Edition', deleteVariable: true }],
        ['convert_text_variables', { text: { storyId: 3 } }],
    ]);
    assert.match(all, /v\.convertToText\(\);/);
    assert.match(all, /v\.remove\(\);/);
    assert.match(inText, /t\.textVariableInstances\.everyItem\(\)\.getElements\(\)/);
    assert.match(inText, /insts\[i\]\.convertToText\(\);/);
    refuses('convert_text_variables', {}, /Give 'name', 'text', or both/);
    refuses('convert_text_variables', { name: 'A', text: { storyId: 1 }, deleteVariable: true }, /leave out 'text'/);
});

await test('generate_captions: live, static, numbered, and convert to static', async () => {
    const [live, stat, conv] = await scriptsFor([
        ['generate_captions', { target: { ids: [10, 11] }, metadataField: 'Description', textBefore: 'Fig: ', position: 'right', offset: 3, size: 40, paragraphStyle: 'Caption', group: true, numbering: { list: 'Figures', expression: 'Figure ^#. ', acrossDocuments: true } }],
        ['generate_captions', { target: { selection: true }, mode: 'static' }],
        ['generate_captions', { target: { ids: [20] }, mode: 'convert_to_static' }],
    ]);
    assert.match(live, /variableType: VariableTypes\.LIVE_CAPTION_TYPE/);
    assert.match(live, /vo\.metadataProviderName = "Description";/);
    assert.match(live, /vo\.textBefore = "Fig: ";/);
    assert.match(live, /geometricBounds: \[g\[0\], g\[3\] \+ 3, g\[2\], g\[3\] \+ 3 \+ 40\]/);
    assert.match(live, /textVariableInstances\.add\(\{ associatedTextVariable: v \}\)/);
    assert.match(live, /page\.groups\.add\(\[it, tf\]\)/);
    assert.match(live, /nl\.continueNumbersAcrossStories = true;/);
    assert.match(live, /nl\.continueNumbersAcrossDocuments = true;/);
    assert.match(live, /ps\.appliedNumberingList = nl;/);
    assert.match(live, /ps\.numberingExpression = "Figure \^#\. ";/);
    assert.doesNotMatch(live, /inst\.convertToText\(\)/);
    assert.match(stat, /inst\.convertToText\(\);/);
    assert.match(stat, /"Caption: Name"/);
    assert.match(conv, /VariableTypes\.LIVE_CAPTION_TYPE\) continue;/);
    assert.match(conv, /insts\[k\]\.convertToText\(\);/);
    refuses('generate_captions', { target: { ids: [1] }, numbering: { list: 'Figures' } }, /needs paragraphStyle/);
    refuses('generate_captions', { target: {} }, /Choose the items/);
    refuses('generate_captions', { target: { ids: [1] }, position: 'inside' }, /Allowed: below/);
});

await test('manage_book_contents: information, remove, replace, save as and close', async () => {
    const [info, remove, replace, saveAs, close] = await scriptsFor([
        ['manage_book_contents', { bookPath: book, action: 'document_info' }],
        ['manage_book_contents', { bookPath: book, action: 'remove_document', documentIndex: 2 }],
        ['manage_book_contents', { bookPath: book, action: 'replace_document', documentIndex: 0, replacementPath: doc }],
        ['manage_book_contents', { bookPath: book, action: 'save_as', outputPath: path.join(home, 'Documents', 'manual-2.indb') }],
        ['manage_book_contents', { bookPath: book, action: 'close', save: false }],
    ]);
    assert.match(info, /info\.size = c\.size;/);
    assert.match(info, /info\.date = String\(c\.date\);/);
    assert.match(info, /c\.filePath\.fsName/);
    assert.doesNotMatch(info, /var doc = __doc\(\);/);
    assert.match(remove, /var c = book\.bookContents\[2\];/);
    assert.match(remove, /c\.remove\(\);/);
    assert.match(replace, /c\.replace\(f\);/);
    assert.match(saveAs, /book\.save\(f\);/);
    assert.match(close, /book\.close\(SaveOptions\.NO\);/);
    refuses('manage_book_contents', { bookPath: book, action: 'remove_document' }, /documentIndex/);
    refuses('manage_book_contents', { bookPath: '/System/x.indb', action: 'close' }, /Access denied|outside the allowed/);
    refuses('manage_book_contents', { bookPath: book, action: 'replace_document', documentIndex: 0 }, /replacementPath' is required/);
});

await test('set_chapter_numbering: active document or a document file', async () => {
    const [active, file] = await scriptsFor([
        ['set_chapter_numbering', { source: 'start_at', chapterNumber: 4, format: 'UPPER_ROMAN' }],
        ['set_chapter_numbering', { documentPath: doc, source: 'continue' }],
    ]);
    assert.match(active, /cp\.chapterNumberSource = ChapterNumberSources\.USER_DEFINED;/);
    assert.match(active, /cp\.chapterNumber = 4;/);
    assert.match(active, /cp\.chapterNumberFormat = NumberingStyle\.UPPER_ROMAN;/);
    assert.match(active, /var d = __doc\(\)/);
    assert.match(file, /ChapterNumberSources\.CONTINUE_FROM_PREVIOUS_DOCUMENT/);
    assert.match(file, /d = app\.open\(f, false\);/);
    assert.match(file, /d\.save\(\);/);
    refuses('set_chapter_numbering', {}, /Nothing to set/);
    refuses('set_chapter_numbering', { chapterNumber: 0 }, /chapterNumber/);
    refuses('set_chapter_numbering', { source: 'automatic' }, /Allowed: start_at/);
});

await test('invoke_long_document_command: menu actions that are checked before running', async () => {
    const s = await one('invoke_long_document_command', { command: 'hyperlinks_sort_by_name' });
    assert.match(s, /app\.menuActions\.itemByID\(79375\)/);
    assert.match(s, /if \(!ma\.enabled\)/);
    assert.match(s, /ma\.invoke\(\);/);
    refuses('invoke_long_document_command', { command: 'relink_cross_reference' }, /Allowed: index_show_find_field/);
});

await test('get_long_document_info: only the sections asked for', async () => {
    const all = await one('get_long_document_info', {});
    for (const re of [/doc\.tocStyles/, /stories\[s\]\.footnotes/, /doc\.indexingSortOptions/, /stories\[s\]\.hiddenTexts/, /doc\.crossReferenceFormats/, /doc\.hyperlinkTextDestinations/, /doc\.bookmarks/, /doc\.textVariables/, /doc\.chapterNumberPreferences/]) assert.match(all, re);
    const some = await one('get_long_document_info', { sections: ['bookmarks'], limit: 5 });
    assert.match(some, /limit = 5;/);
    assert.doesNotMatch(some, /doc\.tocStyles/);
    refuses('get_long_document_info', { sections: ['styles'] }, /Allowed: toc_styles/);
});

done();
