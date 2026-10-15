/**
 * Style tools (src/tools/styles.js): the scripts carry the right object-model
 * statements for every kind of style, parse as ES5, and bad arguments are
 * refused before anything runs.
 */
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const es5 = (src) => acorn.parse(src, { ecmaVersion: 5, allowReturnOutsideFunction: true });
const refuses = async (name, args, pattern) => {
    await assert.rejects(async () => tool(name).handler(args), pattern);
};

await test('set_paragraph_style creates in a group, sets Based On, Next Style and attributes', async () => {
    const s = await one('set_paragraph_style', {
        style: 'Headings/H2', create: true, basedOn: 'H1', nextStyle: 'Body', resetToBase: true,
        attributes: { pointSize: 14, leading: 'auto', justification: 'CENTER_ALIGN', spaceBefore: 3, fillColor: '#112233', dropCapStyle: 'Initial', spanSplitColumnCount: 'all' },
    });
    es5(s);
    assert.match(s, /__group\(doc, "paragraph", "Headings", true\)/);
    assert.match(s, /\.add\(\{ name: "H2" \}\)/);
    assert.match(s, /s\.basedOn = __style\(doc, "paragraph", "H1"\)/);
    assert.match(s, /s\.nextStyle = __style\(doc, "paragraph", "Body"\)/);
    assert.match(s, /__base\.properties/);
    assert.match(s, /s\.pointSize = "14pt";/);
    assert.match(s, /s\.leading = Leading\.AUTO;/);
    assert.match(s, /s\.justification = Justification\.CENTER_ALIGN;/);
    assert.match(s, /s\.spaceBefore = 3;/);
    assert.match(s, /s\.fillColor = __swatch\(doc, \{"kind":"rgb","v":\[17,34,51\]\}\)/);
    assert.match(s, /s\.dropCapStyle = __style\(doc, "character", "Initial"\)/);
    assert.match(s, /s\.spanSplitColumnCount = SpanColumnCountOptions\.ALL;/);
});

await test('set_paragraph_style refuses unknown attributes, bad enums and a missing style', async () => {
    await refuses('set_paragraph_style', { style: 'Body', attributes: { colour: 'Black' } }, /Unknown attributes attribute 'colour'/);
    await refuses('set_paragraph_style', { style: 'Body', attributes: { justification: 'MIDDLE' } }, /Allowed: LEFT_ALIGN/);
    await refuses('set_paragraph_style', { style: 'Body', attributes: { pointSize: 0 } }, /out of range/);
    await refuses('set_paragraph_style', { style: 'Body', attributes: { hyphenation: 'yes' } }, /true or false/);
    await refuses('set_paragraph_style', { style: '' }, /'style' is required/);
    const s = await one('set_paragraph_style', { style: 'Body', attributes: { pointSize: 9 } });
    assert.match(s, /pass create: true to make it/);
});

await test('set_paragraph_style and set_character_style apply to the selection on request', async () => {
    const p = await one('set_paragraph_style', { style: 'Body', applyToSelection: true });
    assert.match(p, /sel\.applyParagraphStyle\(s, false\)/);
    const c = await one('set_character_style', { style: 'Bold', create: true, basedOn: 'Base', attributes: { fontStyle: 'Bold', capitalization: 'ALL_CAPS' }, applyToSelection: true });
    es5(c);
    assert.match(c, /s\.basedOn = __style\(doc, "character", "Base"\)/);
    assert.match(c, /s\.fontStyle = "Bold";/);
    assert.match(c, /s\.capitalization = Capitalization\.ALL_CAPS;/);
    assert.match(c, /sel\.applyCharacterStyle\(s\)/);
    await refuses('set_character_style', { style: 'Bold', attributes: { justification: 'LEFT_ALIGN' } }, /Unknown attributes attribute 'justification'/);
});

await test('set_object_style sets each category and turns it on', async () => {
    const s = await one('set_object_style', {
        style: 'Sidebar', create: true, basedOn: '[Basic Text Frame]',
        paragraphStyle: { style: 'Body', applyNextStyle: true },
        textFrame: { textColumnCount: 2, insetSpacing: [1, 2, 3, 4], verticalJustification: 'CENTER_ALIGN' },
        baseline: { firstBaselineOffset: 'CAP_HEIGHT', useCustomBaselineFrameGrid: true, baselineFrameGridIncrement: 12 },
        autoSize: { autoSizingType: 'HEIGHT_ONLY' },
        columnRules: { columnRuleOverride: true, columnRuleStrokeWidth: 1 },
        story: { opticalMarginAlignment: true },
        textWrap: { textWrapMode: 'CONTOUR', nonprinting: true },
        anchored: { anchoredPosition: 'ANCHORED', anchorXoffset: 5 },
        frameFitting: { fittingOnEmptyFrame: 'PROPORTIONALLY', autoFit: true },
        export: { customAltText: 'Note', applyTagType: 'TAG_ARTIFACT', epubType: 'aside' },
        corners: { cornerOption: 'ROUNDED_CORNER', cornerRadius: 3 },
        categories: { stroke: false, storyOptions: false },
    });
    es5(s);
    for (const re of [
        /s\.appliedParagraphStyle = __style\(doc, "paragraph", "Body"\)/, /s\.applyNextParagraphStyle = true;/,
        /s\.textFramePreferences\.textColumnCount = 2;/, /s\.textFramePreferences\.insetSpacing = \[1, 2, 3, 4\];/,
        /s\.textFramePreferences\.verticalJustification = VerticalJustification\.CENTER_ALIGN;/,
        /s\.textFramePreferences\.firstBaselineOffset = FirstBaseline\.CAP_HEIGHT;/,
        /s\.baselineFrameGridOptions\.useCustomBaselineFrameGrid = true;/, /s\.baselineFrameGridOptions\.baselineFrameGridIncrement = "12pt";/,
        /s\.textFramePreferences\.autoSizingType = AutoSizingTypeEnum\.HEIGHT_ONLY;/,
        /s\.textFramePreferences\.columnRuleOverride = true;/, /s\.storyPreferences\.opticalMarginAlignment = true;/,
        /s\.textWrapPreferences\.textWrapMode = TextWrapModes\.CONTOUR;/, /s\.nonprinting = true;/,
        /s\.anchoredObjectSettings\.anchoredPosition = AnchorPosition\.ANCHORED;/, /s\.anchoredObjectSettings\.anchorXoffset = 5;/,
        /s\.frameFittingOptions\.fittingOnEmptyFrame = EmptyFrameFittingOptions\.PROPORTIONALLY;/,
        /s\.objectExportOptions\.customAltText = "Note";/, /s\.objectExportOptions\.applyTagType = TagType\.TAG_ARTIFACT;/,
        /s\.topLeftCornerOption = CornerOptions\.ROUNDED_CORNER;/, /s\.bottomRightCornerRadius = 3;/,
        /s\.enableParagraphStyle = true;/, /s\.enableTextFrameGeneralOptions = true;/, /s\.enableTextFrameBaselineOptions = true;/,
        /s\.enableTextFrameAutoSizingOptions = true;/, /s\.enableTextFrameColumnRuleOptions = true;/, /s\.enableTextWrapAndOthers = true;/,
        /s\.enableAnchoredObjectOptions = true;/, /s\.enableFrameFittingOptions = true;/, /s\.enableObjectExportAltTextOptions = true;/,
        /s\.enableObjectExportTaggedPdfOptions = true;/, /s\.enableObjectExportEpubOptions = true;/, /s\.enableStrokeAndCornerOptions = true;/,
        /s\.enableStroke = false;/, /s\.enableStoryOptions = false;/,
    ]) assert.match(s, re);
    assert.doesNotMatch(s, /s\.enableStoryOptions = true;/);
    await refuses('set_object_style', { style: 'X', categories: { glow: true } }, /Unknown category 'glow'/);
    await refuses('set_object_style', { style: 'X', textWrap: { textWrapMode: 'AROUND' } }, /Allowed: NONE/);
    await refuses('set_object_style', { style: 'X', textFrame: { insetSpacing: [1, 2] } }, /\[top, left, bottom, right\]/);
});

await test('set_table_style sets regions, setup, alternating strokes and fills', async () => {
    const s = await one('set_table_style', {
        style: 'Data', create: true, basedOn: '[Basic Table]', name: 'Data 2',
        cellStyles: { header: 'Head', body: 'Body cell', footer: 'same_as_body' },
        tableSetup: { border: { weight: 1, color: 'Black', type: 'Solid' }, spaceAfter: 2, strokeOrder: 'ROW_ON_TOP' },
        rowStrokes: { first: { count: 2, weight: 0.5 }, next: { count: 1, color: 'Black' }, skipFirst: 1 },
        columnStrokes: { next: { type: 'Dashed' } },
        fills: { direction: 'columns', first: { count: 1, color: 'Paper' }, next: { count: 1, tint: 20 }, skipLast: 1 },
    });
    es5(s);
    for (const re of [
        /s\.name = "Data 2";/, /s\.headerRegionSameAsBodyRegion = false;/, /s\.headerRegionCellStyle = __style\(doc, "cell", "Head"\)/,
        /s\.bodyRegionCellStyle = __style\(doc, "cell", "Body cell"\)/, /s\.footerRegionSameAsBodyRegion = true;/,
        /s\.topBorderStrokeWeight = "1pt";/, /s\.rightBorderStrokeType = __strokeStyle\(doc, "Solid"\)/, /s\.spaceAfter = 2;/,
        /s\.strokeOrder = StrokeOrderTypes\.ROW_ON_TOP;/, /s\.startRowStrokeCount = 2;/, /s\.endRowStrokeColor = __swatch/,
        /s\.skipFirstAlternatingStrokeRows = 1;/, /s\.endColumnLineStyle = __strokeStyle\(doc, "Dashed"\)/,
        /s\.columnFillsPriority = true;/, /s\.startColumnFillCount = 1;/, /s\.endColumnFillTint = 20;/, /s\.skipLastAlternatingFillColumns = 1;/,
    ]) assert.match(s, re);
    await refuses('set_table_style', { style: 'Data', cellStyles: { body: 'same_as_body' } }, /cannot be 'same_as_body'/);
    await refuses('set_table_style', { style: 'Data', cellStyles: { middle: 'X' } }, /Unknown cellStyles region/);
    await refuses('set_table_style', { style: 'Data', fills: { first: { weight: 1 } } }, /Unknown fills.first field 'weight'/);
});

await test('set_cell_style sets paragraph style, text, graphic, strokes, fill and diagonals', async () => {
    const s = await one('set_cell_style', {
        style: 'Head', create: true, basedOn: '[None]', paragraphStyle: 'Table head',
        text: { topInset: 1, verticalJustification: 'BOTTOM_ALIGN', clipContentToTextCell: true, rotation: 270 },
        graphic: { graphicLeftInset: 2 },
        strokes: { all: { weight: 0.5 }, top: { color: 'Black' } },
        fill: { color: 'Paper', tint: 40 },
        diagonal: { topLeft: true, weight: 0.25, type: 'Solid' },
    });
    es5(s);
    for (const re of [
        /s\.appliedParagraphStyle = __style\(doc, "paragraph", "Table head"\)/, /s\.topInset = 1;/,
        /s\.verticalJustification = VerticalJustification\.BOTTOM_ALIGN;/, /s\.clipContentToTextCell = true;/, /s\.rotationAngle = 270;/,
        /s\.graphicLeftInset = 2;/, /s\.leftEdgeStrokeWeight = "0\.5pt";/, /s\.topEdgeStrokeColor = __swatch/, /s\.fillTint = 40;/,
        /s\.topLeftDiagonalLine = true;/, /s\.diagonalLineStrokeWeight = "0\.25pt";/, /s\.diagonalLineStrokeType = __strokeStyle/,
    ]) assert.match(s, re);
    await refuses('set_cell_style', { style: 'Head', text: { rotation: 45 } }, /0, 90, 180 or 270/);
    await refuses('set_cell_style', { style: 'Head', strokes: { middle: {} } }, /Unknown strokes edge/);
});

await test('manage_styles duplicates, deletes with a replacement, moves and copies into groups', async () => {
    const [dup, del, mov, cop, conv] = await scriptsFor([
        ['manage_styles', { kind: 'character', action: 'duplicate', styles: ['Bold'], newName: 'Bold 2' }],
        ['manage_styles', { kind: 'object', action: 'delete', styles: ['Old', 'Older'], replaceWith: '[None]' }],
        ['manage_styles', { kind: 'table', action: 'move_to_group', styles: ['Data'], group: 'Tables/Data' }],
        ['manage_styles', { kind: 'cell', action: 'copy_to_group', styles: ['Head'], group: 'Archive' }],
        ['manage_styles', { kind: 'paragraph', action: 'convert_bullets_to_text', styles: ['List'] }],
    ]);
    [dup, del, mov, cop, conv].forEach(es5);
    assert.match(dup, /var d = s\.duplicate\(\);/);
    assert.match(dup, /d\.name = "Bold 2";/);
    assert.match(del, /var rep = __style\(doc, "object", "\[None\]"\)/);
    assert.match(del, /s\.remove\(rep\);/);
    assert.match(mov, /__group\(doc, "table", "Tables\/Data", true\)/);
    assert.match(mov, /s\.move\(LocationOptions\.AT_END, g\)/);
    assert.match(cop, /var c = s\.duplicate\(\)/);
    assert.match(cop, /c\.name = nm2;/);
    assert.match(conv, /s\.convertBulletsAndNumberingToText\(\);/);
    await refuses('manage_styles', { kind: 'object', action: 'convert_bullets_to_text', styles: ['X'] }, /for paragraph styles/);
    await refuses('manage_styles', { kind: 'object', action: 'duplicate', styles: ['A', 'B'], newName: 'C' }, /newName is for duplicating one style/);
    await refuses('manage_styles', { kind: 'object', action: 'rename', styles: ['A'] }, /Allowed: duplicate/);
    await refuses('manage_styles', { kind: 'swatch', action: 'delete', styles: ['A'] }, /Allowed: paragraph/);
    await refuses('manage_styles', { kind: 'object', action: 'delete', styles: [] }, /at least one style/);
});

await test('manage_style_groups creates, groups styles, renames, duplicates and deletes groups', async () => {
    const [cr, from, ren, dup, del] = await scriptsFor([
        ['manage_style_groups', { kind: 'paragraph', action: 'create', group: 'Body/Lists' }],
        ['manage_style_groups', { kind: 'character', action: 'create_from_styles', group: 'Inline', styles: ['Bold', 'Italic'] }],
        ['manage_style_groups', { kind: 'object', action: 'rename', group: 'Frames', name: 'Boxes' }],
        ['manage_style_groups', { kind: 'table', action: 'duplicate', group: 'Tables', name: 'Tables copy' }],
        ['manage_style_groups', { kind: 'cell', action: 'delete', group: 'Cells', replaceWith: '[None]' }],
    ]);
    [cr, from, ren, dup, del].forEach(es5);
    assert.match(cr, /__group\(doc, "paragraph", "Body\/Lists", true\)/);
    assert.match(from, /list\[j\]\.move\(LocationOptions\.AT_END, g\)/);
    assert.match(ren, /g\.name = "Boxes";/);
    assert.match(dup, /\.duplicate\(\);/);
    assert.match(del, /g\.remove\(__style\(doc, "cell", "\[None\]"\)\);/);
    await refuses('manage_style_groups', { kind: 'paragraph', action: 'create', group: '' }, /'group' is required/);
    await refuses('manage_style_groups', { kind: 'paragraph', action: 'create_from_styles', group: 'G' }, /needs 'styles'/);
    await refuses('manage_style_groups', { kind: 'paragraph', action: 'rename', group: 'G' }, /'name' is required/);
});

await test('apply_style applies each kind with its clearing variants', async () => {
    const [para, next, chr, objs, table, cells] = await scriptsFor([
        ['apply_style', { kind: 'paragraph', style: 'Body', text: { frameId: 7, paragraphs: [1, 2] }, clear: 'character_styles' }],
        ['apply_style', { kind: 'paragraph', style: 'H1', text: { selection: true }, clear: 'overrides', thenNextStyle: true }],
        ['apply_style', { kind: 'character', style: 'Bold', text: { frameId: 7, characters: [0, 4] } }],
        ['apply_style', { kind: 'object', style: 'Sidebar', target: { ids: [3, 4] }, clear: 'not_defined' }],
        ['apply_style', { kind: 'table', style: 'Data', table: { frameId: 7, index: 1 }, clear: 'all' }],
        ['apply_style', { kind: 'cell', style: 'Head', table: { storyId: 70 }, cells: { rows: [0, 0] }, clear: 'overrides' }],
    ]);
    [para, next, chr, objs, table, cells].forEach(es5);
    assert.match(para, /__applyPara\(doc, t, s, "character_styles"\)/);
    assert.match(para, /"paragraphs":\[1,2\]/);
    assert.match(next, /__applyParaNext\(doc, t, s, "overrides"\)/);
    assert.match(next, /cur\.nextStyle/);
    assert.match(chr, /t\.applyCharacterStyle\(s\);/);
    assert.match(objs, /items\[i\]\.applyObjectStyle\(s, false, true\)/);
    assert.match(table, /__table\(doc, \{"frameId":7,"storyId":null,"pageIndex":null,"index":1,"selection":false,"nested":\[\]\}\)/);
    assert.match(table, /tb\.appliedTableStyle = s;/);
    assert.match(table, /tb\.clearTableStyleOverrides\(\);/);
    assert.match(table, /tb\.cells\.everyItem\(\)\.appliedCellStyle = doc\.cellStyles\[0\];/);
    assert.match(cells, /cells = cr\.range\.getElements\(\)/);
    assert.match(cells, /cells\[i\]\.appliedCellStyle = s;/);
    assert.match(cells, /cells\[i\]\.clearCellStyleOverrides\(false\);/);
    await refuses('apply_style', { kind: 'character', style: 'Bold', text: { frameId: 1 }, clear: 'overrides' }, /Allowed: none/);
    await refuses('apply_style', { kind: 'object', style: 'X', target: { ids: [1] }, thenNextStyle: true }, /thenNextStyle is for paragraph styles/);
    await refuses('apply_style', { kind: 'paragraph', style: 'Body' }, /Choose the text/);
    await refuses('apply_style', { kind: 'paragraph', style: 'Body', text: { frameId: 1, paragraphs: [0, 1], characters: [0, 1] } }, /not both/);
    await refuses('apply_style', { kind: 'paragraph', style: 'Body', text: { frameId: 1, paragraphs: [3, 1] } }, /last must not be before first/);
    await refuses('apply_style', { kind: 'object', style: 'X', target: {} }, /Choose the items/);
    await refuses('apply_style', { kind: 'table', style: 'X', table: {} }, /Choose the table/);
    await refuses('apply_style', { kind: 'cell', style: 'X', table: { frameId: 1 }, cells: { selection: true } }, /uses the selection's table/);
});

await test('clear_style_overrides clears text, object, table and cell overrides', async () => {
    const [txt, obj, table, cell] = await scriptsFor([
        ['clear_style_overrides', { kind: 'text', text: { frameId: 2 }, what: 'paragraph' }],
        ['clear_style_overrides', { kind: 'object', target: { selection: true }, what: 'not_defined' }],
        ['clear_style_overrides', { kind: 'table', table: { selection: true } }],
        ['clear_style_overrides', { kind: 'cell', cells: { selection: true }, what: 'not_defined' }],
    ]);
    [txt, obj, table, cell].forEach(es5);
    assert.match(txt, /t\.clearOverrides\(OverrideType\.PARAGRAPH_ONLY\);/);
    assert.match(obj, /applyObjectStyle\(items\[i\]\.appliedObjectStyle, false, true\)/);
    assert.match(table, /tb\.clearTableStyleOverrides\(\);/);
    assert.match(cell, /clearCellStyleOverrides\(true\)/);
    const objOv = await one('clear_style_overrides', { kind: 'object', target: { ids: [1] } });
    assert.match(objOv, /clearObjectStyleOverrides\(\);/);
    await refuses('clear_style_overrides', { kind: 'table', table: { selection: true }, what: 'not_defined' }, /Allowed: overrides/);
});

await test('redefine_style and break_link_to_style select the target and run the panel command', async () => {
    const [redef, brk] = await scriptsFor([
        ['redefine_style', { kind: 'paragraph', text: { selection: true } }],
        ['break_link_to_style', { kind: 'object', target: { ids: [9] } }],
    ]);
    [redef, brk].forEach(es5);
    assert.match(redef, /t\.select\(\);/);
    assert.match(redef, /__invoke\(\[8486,8458\], "Redefine Style"\)/);
    assert.match(redef, /__showPanel\("Paragraph Styles"\)/);
    assert.match(brk, /app\.select\(items\);/);
    assert.match(brk, /__invoke\(\[113166\], "Break Link to Style"\)/);
    const cell = await one('redefine_style', { kind: 'cell', table: { frameId: 4 }, cells: { rows: [0, 1], columns: [0, 0] } });
    es5(cell);
    assert.match(cell, /cr = __cells\(tb, \{"rows":\[0,1\],"columns":\[0,0\],"region":"all","selection":false\}\)/);
    assert.match(cell, /cr\.range\.select\(\);/);
    await refuses('redefine_style', { kind: 'table' }, /Choose the table/);
});

await test('load_styles checks the path and loads each kind with the clash strategy', async () => {
    const s = await one('load_styles', { filePath: `${home}/Documents/master.indd`, types: ['text', 'table_and_cell', 'object'], conflicts: 'overwrite' });
    es5(s);
    assert.match(s, /doc\.importStyles\(ImportFormat\.TEXT_STYLES_FORMAT, f, GlobalClashResolutionStrategy\.LOAD_ALL_WITH_OVERWRITE\)/);
    assert.match(s, /ImportFormat\.TABLE_AND_CELL_STYLES_FORMAT/);
    assert.match(s, /ImportFormat\.OBJECT_STYLES_FORMAT/);
    await refuses('load_styles', { filePath: '/etc/passwd', types: ['text'] }, /Access denied|forbidden|not allowed/i);
    await refuses('load_styles', { filePath: `${home}/Documents/m.indd`, types: ['swatches'] }, /Allowed: paragraph/);
    await refuses('load_styles', { filePath: `${home}/Documents/m.indd`, types: [] }, /at least one kind/);
});

await test('set_nested_styles writes nested, line and GREP styles and the end marker', async () => {
    const [nested, line, grep, rem, end] = await scriptsFor([
        ['set_nested_styles', { style: 'Body', entries: [{ characterStyle: 'Bold', delimiter: 'SENTENCE', repetition: 1, inclusive: true }, { characterStyle: '[None]', delimiter: ':' }] }],
        ['set_nested_styles', { style: 'Body', type: 'line', action: 'add', entries: [{ characterStyle: 'Caps', lineCount: 2 }] }],
        ['set_nested_styles', { style: 'Body', type: 'grep', entries: [{ characterStyle: 'Nums', grepExpression: '\\d+' }] }],
        ['set_nested_styles', { style: 'Body', type: 'grep', action: 'remove', removeIndex: 0 }],
        ['set_nested_styles', { action: 'insert_end_marker', text: { frameId: 3, characters: [0, 5] } }],
    ]);
    [nested, line, grep, rem, end].forEach(es5);
    assert.match(nested, /c = s\.nestedStyles;/);
    assert.match(nested, /c\[i\]\.remove\(\);/);
    assert.match(nested, /delimiter: NestedStyleDelimiters\.SENTENCE, repetition: 1, inclusive: true/);
    assert.match(nested, /delimiter: ":"/);
    assert.match(line, /c = s\.nestedLineStyles;/);
    assert.match(line, /lineCount: 2/);
    assert.doesNotMatch(line, /c\[i\]\.remove\(\);/);
    assert.match(grep, /grepExpression: "\\\\d\+"/);
    assert.match(rem, /c\[0\]\.remove\(\);/);
    assert.match(end, /insertionPoints\[-1\]\.contents = SpecialCharacters\.END_NESTED_STYLE;/);
    await refuses('set_nested_styles', { style: 'Body', type: 'line', entries: [{ characterStyle: 'A', delimiter: 'TABS' }] }, /Unknown entries\[0\] field 'delimiter'/);
    await refuses('set_nested_styles', { style: 'Body', type: 'grep', entries: [{ characterStyle: 'A' }] }, /grepExpression' is required/);
    await refuses('set_nested_styles', { style: 'Body', entries: [] }, /needs 'entries'/);
    await refuses('set_nested_styles', { style: 'Body', entries: [{ characterStyle: 'A', delimiter: 'x'.repeat(30) }] }, /1 to 20 characters/);
});

await test('set_style_export_tags maps tags, classes and PDF tags', async () => {
    const s = await one('set_style_export_tags', { entries: [
        { kind: 'paragraph', style: 'H1', exportType: 'EPUB', tag: 'h1', className: 'title', splitDocument: true },
        { kind: 'character', style: 'Em', exportType: 'PDF', remove: true },
    ] });
    es5(s);
    assert.match(s, /maps = s\.styleExportTagMaps;/);
    assert.match(s, /maps\.add\("EPUB", "h1", "title", ""\)/);
    assert.match(s, /hit\.exportTag = "h1";/);
    assert.match(s, /s\.splitDocument = true;/);
    assert.match(s, /if \(hit\) hit\.remove\(\);/);
    await refuses('set_style_export_tags', { entries: [{ kind: 'character', style: 'Em', splitDocument: true }] }, /is for paragraph styles/);
    await refuses('set_style_export_tags', { entries: [{ kind: 'object', style: 'Em' }] }, /Allowed: paragraph, character/);
});

await test('find_change_style sets find and change formats and always resets them', async () => {
    const s = await one('find_change_style', { find: { paragraphStyle: 'Old', text: 'Note' }, change: { paragraphStyle: 'New', characterStyle: 'Bold' }, frameId: 5 });
    es5(s);
    assert.match(s, /app\.findTextPreferences\.appliedParagraphStyle = __style\(doc, "paragraph", "Old"\)/);
    assert.match(s, /app\.findTextPreferences\.findWhat = "Note";/);
    assert.match(s, /app\.changeTextPreferences\.appliedCharacterStyle = __style\(doc, "character", "Bold"\)/);
    assert.match(s, /where\.changeText\(\)/);
    assert.match(s, /finally \{\s*app\.findTextPreferences = NothingEnum\.NOTHING;/);
    const find = await one('find_change_style', { find: { characterStyle: 'Bold' } });
    assert.match(find, /var where = doc;/);
    assert.match(find, /where\.findText\(\)/);
    await refuses('find_change_style', { find: {} }, /needs a paragraphStyle/);
    await refuses('find_change_style', { find: { text: 'a' }, change: {} }, /'change' needs/);
});

await test('set_style_defaults sets default frame, text styles and the clear-overrides preference', async () => {
    const s = await one('set_style_defaults', { textFrameStyle: 'Body frame', graphicFrameStyle: 'Photo', paragraphStyle: 'Body', characterStyle: '[None]', clearOverridesWhenApplying: true });
    es5(s);
    assert.match(s, /d\.appliedTextObjectStyle = __style\(doc, "object", "Body frame"\)/);
    assert.match(s, /d\.appliedGraphicObjectStyle = __style\(doc, "object", "Photo"\)/);
    assert.match(s, /td\.appliedParagraphStyle = __style\(doc, "paragraph", "Body"\)/);
    assert.match(s, /app\.clearOverridesWhenApplyingStyle = true;/);
    await refuses('set_style_defaults', { clearOverridesWhenApplying: 'yes' }, /true or false/);
});

await test('quick_apply_style searches by prefix and applies the best match to the selection', async () => {
    const s = await one('quick_apply_style', { query: 'o: side bar', clearOverrides: true });
    es5(s);
    assert.match(s, /var kinds = \["object"\], words = \["side","bar"\]/);
    assert.match(s, /items\[i\]\.applyObjectStyle\(s, true, false\)/);
    const all = await one('quick_apply_style', { query: 'Body' });
    es5(all);
    for (const k of ['paragraph', 'character', 'object', 'table', 'cell']) assert.match(all, new RegExp(`best\\.kind === "${k}"`));
    const list = await one('quick_apply_style', { query: 'c:em', apply: false });
    assert.doesNotMatch(list, /applyCharacterStyle/);
    await refuses('quick_apply_style', { query: 'p:' }, /no words after its prefix/);
    await refuses('quick_apply_style', { query: '' }, /'query' is required/);
});

await test('set_quick_apply_filters toggles only the filters given', async () => {
    const s = await one('set_quick_apply_filters', { paragraphStyles: true, menuCommands: false });
    es5(s);
    assert.match(s, /__filter\("paragraphStyles", 127949, true\)/);
    assert.match(s, /__filter\("menuCommands", 127951, false\)/);
    assert.match(s, /__filter\("scripts", 127954, null\)/);
    await refuses('set_quick_apply_filters', { scripts: 1 }, /true or false/);
});

await test('style_panel_command runs the panel menu action for the kind', async () => {
    const s = await one('style_panel_command', { kind: 'cell', command: 'select_all_unused' });
    es5(s);
    assert.match(s, /__invoke\(\[132131\]/);
    assert.match(s, /__showPanel\("Cell Styles"\)/);
    await refuses('style_panel_command', { kind: 'table', command: 'select_all_unused' }, /has no select_all_unused command/);
    await refuses('style_panel_command', { kind: 'paragraph', command: 'expand' }, /Allowed: open_all_groups/);
});

done();
