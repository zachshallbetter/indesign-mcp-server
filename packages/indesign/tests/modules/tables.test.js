/**
 * Tables (src/tools/tables.js): table and cell addressing, Table Options,
 * Cell Options, structure edits, conversion, copying, selecting, menu
 * commands and placing spreadsheets. Checks the object-model statements the
 * scripts carry and that bad arguments are refused before anything runs.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { storyId: 12, index: 1 };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const refuses = (name, args, re) => assert.throws(() => tool(name).handler(args), re);

await test('table addressing: story, frame, page, selection and nested paths', async () => {
    const s = await one('get_table_info', { table: { frameId: 7, index: 2, nested: [{ row: 1, column: 3 }] } });
    assert.match(s, /"frameId":7,"storyId":null,"pageIndex":null,"index":2,"selection":false,"nested":\[\[1,3,0\]\]/);
    assert.match(s, /list = f\.tables;/);
    assert.match(s, /t\.cells\.itemByName\(step\[1\] \+ ":" \+ step\[0\]\)/);
    const sel = await one('get_table_info', { table: { selection: true } });
    assert.match(sel, /"selection":true/);
    assert.match(sel, /__tableOf\(app\.selection\[0\]\)/);
    const all = await one('get_table_info', {});
    assert.match(all, /doc\.stories\[s\]/);
});

await test('table addressing refuses missing, mixed and malformed choices', () => {
    refuses('set_table_options', { setup: { spaceBefore: 1 } }, /Choose the table/);
    refuses('set_table_options', { table: {}, setup: { spaceBefore: 1 } }, /Choose the table/);
    refuses('set_table_options', { table: { storyId: 1, frameId: 2 }, setup: { spaceBefore: 1 } }, /only one of/);
    refuses('set_table_options', { table: { storyId: 1, selection: true }, setup: { spaceBefore: 1 } }, /not both/);
    refuses('set_table_options', { table: { storyId: -1 }, setup: { spaceBefore: 1 } }, /Invalid index/);
    refuses('set_table_options', { table: { storyId: 1, nested: [{ row: 1 }] }, setup: { spaceBefore: 1 } }, /needs row and column/);
    refuses('set_table_options', { table: { storyId: 1, colour: 1 }, setup: { spaceBefore: 1 } }, /Unknown option 'table\.colour'/);
});

await test('cell addressing: ranges, regions and the selection', async () => {
    const s = await one('set_cell_options', { table: T, cells: { rows: [1, 3], columns: [2] }, fill: { color: 'Paper' } });
    assert.match(s, /"rows":\[1,3\],"columns":\[2,2\],"region":"all","selection":false/);
    assert.match(s, /t\.cells\.itemByRange\(a, b\)/);
    const r = await one('set_cell_options', { table: T, cells: { region: 'header' }, fill: { tint: 20 } });
    assert.match(r, /"region":"header"/);
    const sel = await one('set_cell_options', { cells: { selection: true }, fill: { tint: 20 } });
    assert.match(sel, /"selection":true,"nested":\[\]\}/);
    assert.match(sel, /"region":"all","selection":true/);
    refuses('set_cell_options', { table: T, cells: { rows: [3, 1] }, fill: { tint: 1 } }, /before first/);
    refuses('set_cell_options', { table: T, cells: { rows: [1], region: 'body' }, fill: { tint: 1 } }, /not both/);
    refuses('set_cell_options', { table: T, cells: { region: 'middle' }, fill: { tint: 1 } }, /Allowed: all, header/);
    refuses('set_cell_options', { table: T, cells: { selection: true }, fill: { tint: 1 } }, /cells\.selection uses the selection's table/);
    refuses('set_cell_options', { cells: { selection: true, rows: [1] }, fill: { tint: 1 } }, /drop rows/);
});

await test('set_table_options writes Table Options properties', async () => {
    const s = await one('set_table_options', {
        table: T,
        setup: {
            headerRows: 1, footerRows: 2, bodyRows: 5, columns: 4, spaceBefore: 3, spaceAfter: 4,
            border: { weight: 2, type: 'Dashed', color: '#112233', tint: 50, gapColor: 'Paper', gapTint: 30, overprint: true, gapOverprint: false },
            strokeDrawingOrder: 'row_on_top', direction: 'right_to_left', alignment: 'CENTER_ALIGN',
        },
        rowStrokes: { first: { count: 2, weight: 1, color: 'Black' }, next: { count: 1, type: 'Dotted', gapColor: 'Paper', overprint: true }, skipFirst: 1, skipLast: 2 },
        columnStrokes: { first: { type: 'Solid' }, next: { type: 'Dashed', count: 3 }, skipFirst: 1 },
        fills: { pattern: 'rows', first: { count: 1, color: 'Black', tint: 10, overprint: true }, next: { count: 2, color: 'Paper' }, skipFirst: 1, skipLast: 1, columnFillsPriority: true },
        headersFooters: { repeatHeader: 'once_per_page', skipFirstHeader: true, repeatFooter: 'every_text_column', skipLastFooter: false },
    });
    for (const line of [
        't.headerRowCount = 1;', 't.footerRowCount = 2;', 't.bodyRowCount = 5;', 't.columnCount = 4;',
        't.topBorderStrokeWeight = "2pt";', 't.rightBorderStrokeType = __strokeStyle(doc, "Dashed");',
        't.leftBorderStrokeTint = 50;', 't.bottomBorderStrokeGapColor = __swatch(doc, {"kind":"name","name":"Paper"});',
        't.topBorderStrokeGapTint = 30;', 't.topBorderStrokeOverprint = true;', 't.topBorderStrokeGapOverprint = false;',
        't.spaceBefore = 3;', 't.spaceAfter = 4;', 't.strokeOrder = StrokeOrderTypes.ROW_ON_TOP;',
        't.tableDirection = TableDirectionOptions.RIGHT_TO_LEFT_DIRECTION;',
        't.storyOffset.paragraphs[0].justification = Justification.CENTER_ALIGN;',
        't.startRowStrokeCount = 2;', 't.startRowStrokeWeight = "1pt";', 't.endRowStrokeCount = 1;',
        't.endRowStrokeType = __strokeStyle(doc, "Dotted");', 't.endRowStrokeGapColor', 't.endRowStrokeOverprint = true;',
        't.skipFirstAlternatingStrokeRows = 1;', 't.skipLastAlternatingStrokeRows = 2;',
        't.startColumnStrokeType = __strokeStyle(doc, "Solid");', 't.endColumnLineStyle = __strokeStyle(doc, "Dashed");',
        't.endColumnStrokeCount = 3;', 't.skipFirstAlternatingStrokeColumns = 1;',
        't.alternatingFills = AlternatingFillsTypes.ALTERNATING_ROWS;', 't.startRowFillCount = 1;', 't.startRowFillTint = 10;',
        't.startRowFillOverprint = true;', 't.endRowFillCount = 2;', 't.endRowFillColor', 't.skipFirstAlternatingFillRows = 1;',
        't.skipLastAlternatingFillRows = 1;', 't.columnFillsPriority = true;',
        't.breakHeaders = HeaderFooterBreakTypes.ONCE_PER_PAGE;', 't.skipFirstHeader = true;',
        't.breakFooters = HeaderFooterBreakTypes.IN_ALL_TEXT_COLUMNS;', 't.skipLastFooter = false;',
    ]) assert.ok(s.includes(line), `missing ${line}`);
    const cols = await one('set_table_options', { table: T, fills: { pattern: 'columns', first: { color: 'Black' }, skipLast: 2 } });
    assert.ok(cols.includes('t.startColumnFillColor') && cols.includes('t.skipLastAlternatingFillColumns = 2;'));
});

await test('set_table_options refuses bad options', () => {
    refuses('set_table_options', { table: T }, /Nothing to change/);
    refuses('set_table_options', { table: T, setup: { borders: {} } }, /Unknown option 'setup\.borders'/);
    refuses('set_table_options', { table: T, setup: { columns: 0 } }, /at least 1/);
    refuses('set_table_options', { table: T, setup: { border: { weight: -1 } } }, /out of range/);
    refuses('set_table_options', { table: T, setup: { border: { overprint: 'yes' } } }, /true or false/);
    refuses('set_table_options', { table: T, setup: { border: { color: '' } } }, /is empty/);
    refuses('set_table_options', { table: T, setup: { strokeDrawingOrder: 'random' } }, /Allowed: best_joins/);
    refuses('set_table_options', { table: T, setup: { alignment: 'LEFT_JUSTIFIED' } }, /Allowed: LEFT_ALIGN/);
    refuses('set_table_options', { table: T, fills: { first: { color: 'Black' } } }, /fills\.pattern 'rows' or 'columns' is required/);
    refuses('set_table_options', { table: T, fills: { pattern: 'none', skipFirst: 1 } }, /is required/);
    refuses('set_table_options', { table: T, headersFooters: { repeatHeader: 'always' } }, /Allowed: every_text_column/);
    refuses('set_table_options', { table: T, rowStrokes: { first: { width: 1 } } }, /Unknown option 'rowStrokes\.first\.width'/);
});

await test('set_cell_options writes Cell Options properties', async () => {
    const s = await one('set_cell_options', {
        table: T,
        cells: { rows: [0, 1] },
        text: {
            insets: { top: 1, bottom: 2, left: 3, right: 4 }, verticalJustification: 'justify', paragraphSpacingLimit: 6,
            firstBaseline: 'x_height', firstBaselineMinimum: 2, clipContents: true, rotation: 270, writingDirection: 'vertical',
            paragraphStyle: 'Cell', characterStyle: 'Strong', pointSize: 8, alignment: 'RIGHT_ALIGN',
        },
        graphic: { insets: { top: 2, left: 1 }, clipContents: false },
        strokes: { edges: ['inner'], weight: 0.25, type: 'Solid', color: 'Black', tint: 40, gapColor: 'Paper', gapTint: 10, overprint: true, gapOverprint: true },
        fill: { color: '#00FF00', tint: 30, overprint: true },
        rows: { height: 9, mode: 'exactly', maximum: 40, startRow: 'next_odd_page', keepWithNext: true },
        columns: { width: 22 },
        diagonal: { lines: 'top_right', inFront: true, weight: 1, type: 'Dotted', color: 'Black', tint: 50, gapColor: 'Paper', gapTint: 20, overprint: true, gapOverprint: false },
    });
    for (const line of [
        'c.topInset = 1;', 'c.bottomInset = 2;', 'c.leftInset = 3;', 'c.rightInset = 4;',
        'c.verticalJustification = VerticalJustification.JUSTIFY_ALIGN;', 'c.paragraphSpacingLimit = 6;',
        'c.firstBaselineOffset = FirstBaseline.X_HEIGHT;', 'c.minimumFirstBaselineOffset = 2;', 'c.clipContentToTextCell = true;',
        'c.rotationAngle = 270;', 'c.writingDirection = HorizontalOrVertical.VERTICAL;',
        'tx.appliedParagraphStyle = __named(doc.allParagraphStyles, "Cell", "paragraph");',
        'tx.appliedCharacterStyle = __named(doc.allCharacterStyles, "Strong", "character");',
        'tx.pointSize = "8pt";', 'tx.justification = Justification.RIGHT_ALIGN;',
        'c.graphicTopInset = 2;', 'c.graphicLeftInset = 1;', 'c.clipContentToGraphicCell = false;',
        'c.innerRowStrokeWeight = "0.25pt";', 'c.innerColumnStrokeType = __strokeStyle(doc, "Solid");', 'c.innerRowStrokeTint = 40;',
        'c.innerColumnStrokeGapColor', 'c.innerRowStrokeGapTint = 10;', 'c.innerColumnStrokeOverprint = true;', 'c.innerRowStrokeGapOverprint = true;',
        'c.fillColor = __swatch(doc, {"kind":"rgb","v":[0,255,0]});', 'c.fillTint = 30;', 'c.overprintFill = true;',
        'row.maximumHeight = 40;', 'row.autoGrow = false;', 'row.height = 9;', 'row.startRow = StartParagraph.NEXT_ODD_PAGE;', 'row.keepWithNextRow = true;',
        't.columns[j].width = 22;',
        'c.topLeftDiagonalLine = false;', 'c.topRightDiagonalLine = true;', 'c.diagonalLineInFront = true;',
        'c.diagonalLineStrokeWeight = "1pt";', 'c.diagonalLineStrokeType = __strokeStyle(doc, "Dotted");', 'c.diagonalLineStrokeColor',
        'c.diagonalLineStrokeTint = 50;', 'c.diagonalLineStrokeGapColor', 'c.diagonalLineStrokeGapTint = 20;',
        'c.diagonalLineStrokeOverprint = true;', 'c.diagonalLineStrokeGapOverprint = false;',
    ]) assert.ok(s.includes(line), `missing ${line}`);
    assert.ok(!s.includes('c.topEdgeStroke'), 'inner edges only');
    const atLeast = await one('set_cell_options', { table: T, rows: { height: 5, mode: 'at_least' }, strokes: { weight: 1 } });
    assert.ok(atLeast.includes('row.autoGrow = true;') && atLeast.includes('row.minimumHeight = 5;'));
    for (const e of ['top', 'bottom', 'left', 'right', 'innerRow', 'innerColumn']) assert.ok(atLeast.includes(`c.${e === 'innerRow' || e === 'innerColumn' ? e : `${e}Edge`}StrokeWeight = "1pt";`), e);
});

await test('set_cell_options refuses bad options', () => {
    refuses('set_cell_options', { table: T }, /Nothing to change/);
    refuses('set_cell_options', { table: T, text: { rotation: 45 } }, /Allowed: 0, 90, 180, 270/);
    refuses('set_cell_options', { table: T, text: { insets: { middle: 1 } } }, /Unknown option 'text\.insets\.middle'/);
    refuses('set_cell_options', { table: T, text: { verticalJustification: 'middle' } }, /Allowed: top, center/);
    refuses('set_cell_options', { table: T, text: { pointSize: 0 } }, /out of range/);
    refuses('set_cell_options', { table: T, strokes: { edges: ['diagonal'], weight: 1 } }, /Allowed: top, bottom/);
    refuses('set_cell_options', { table: T, strokes: { edges: [] , weight: 1 } }, /non-empty/);
    refuses('set_cell_options', { table: T, strokes: { edges: ['top'] } }, /give weight/);
    refuses('set_cell_options', { table: T, rows: { mode: 'auto' } }, /Allowed: at_least, exactly/);
    refuses('set_cell_options', { table: T, rows: { height: 10, maximum: 5 } }, /maximum' is below/);
    refuses('set_cell_options', { table: T, rows: { startRow: 'next_spread' } }, /Allowed: anywhere/);
    refuses('set_cell_options', { table: T, columns: { width: 0 } }, /out of range/);
    refuses('set_cell_options', { table: T, diagonal: { lines: 'cross' } }, /Allowed: none, top_left/);
    refuses('set_cell_options', { table: T, text: { paragraphStyle: '' } }, /is empty/);
});

await test('insert_table inserts at a text location or nests in a cell', async () => {
    const s = await one('insert_table', { at: { storyId: 4, characterIndex: 10 }, bodyRows: 2, columns: 5, headerRows: 1, footerRows: 1, width: 80 });
    assert.match(s, /var ip = __textAt\(doc, \{"frameId":null,"storyId":4,"characterIndex":10,"selection":false\}\);/);
    for (const line of ['var nt = ip.tables.add();', 'nt.columnCount = 5;', 'nt.bodyRowCount = 2;', 'nt.headerRowCount = 1;', 'nt.footerRowCount = 1;', 'nt.width = 80;']) {
        assert.ok(s.includes(line), `missing ${line}`);
    }
    const n = await one('insert_table', { inCell: { table: T, row: 2, column: 1 } });
    assert.match(n, /host\.cells\.itemByName\(1 \+ ":" \+ 2\)/);
    assert.match(n, /var ip = hc\.insertionPoints\[-1\];/);
    refuses('insert_table', {}, /not both/);
    refuses('insert_table', { at: { storyId: 1 }, inCell: { table: T, row: 0, column: 0 } }, /not both/);
    refuses('insert_table', { at: { storyId: 1, frameId: 2 } }, /give one of frameId, storyId/);
    refuses('insert_table', { at: { selection: true, characterIndex: 3 } }, /takes no frameId/);
    refuses('insert_table', { inCell: { table: T, row: 0 } }, /needs row and column/);
    refuses('insert_table', { at: { storyId: 1 }, columns: 0 }, /at least 1/);
});

await test('insert_table_rows_columns adds rows or columns next to a reference', async () => {
    const s = await one('insert_table_rows_columns', { table: T, kind: 'rows', count: 3, reference: 2, position: 'before', size: 8 });
    assert.ok(s.includes('list = t.rows;') && s.includes('var refIndex = 2;'));
    assert.ok(s.includes('var added = list.add(LocationOptions.BEFORE, ref);') && s.includes('added.height = 8;') && s.includes('i < 3;'));
    const c = await one('insert_table_rows_columns', { table: T, kind: 'columns', size: 20 });
    assert.ok(c.includes('list = t.columns;') && c.includes('var refIndex = list.length - 1;') && c.includes('LocationOptions.AFTER') && c.includes('added.width = 20;'));
    refuses('insert_table_rows_columns', { table: T, kind: 'cells' }, /Allowed: rows, columns/);
    refuses('insert_table_rows_columns', { table: T, kind: 'rows', count: 0 }, /at least 1/);
    refuses('insert_table_rows_columns', { table: T, kind: 'rows', position: 'above' }, /Allowed: after, before/);
});

await test('delete_table_parts deletes rows, columns or the table', async () => {
    const r = await one('delete_table_parts', { table: T, part: 'rows', cells: { rows: [2, 4] } });
    assert.ok(r.includes('for (var i = cr.r2; i >= cr.r1; i--) t.rows[i].remove();'));
    const c = await one('delete_table_parts', { table: T, part: 'columns', cells: { columns: [1] } });
    assert.ok(c.includes('t.columns[i].remove();'));
    const t = await one('delete_table_parts', { table: T, part: 'table' });
    assert.ok(t.includes('t.remove();'));
    refuses('delete_table_parts', { table: T, part: 'rows' }, /Choose the rows to delete/);
    refuses('delete_table_parts', { table: T, part: 'table', cells: { rows: [1] } }, /takes no cells/);
    refuses('delete_table_parts', { table: T, part: 'cells' }, /Allowed: rows, columns, table/);
});

await test('edit_table_cells merges, splits and converts', async () => {
    const want = {
        merge: 'els[0].merge(els[els.length - 1])',
        unmerge: 'els[i].unmerge()',
        split_horizontally: 'els[i].split(HorizontalOrVertical.HORIZONTAL)',
        split_vertically: 'els[i].split(HorizontalOrVertical.VERTICAL)',
        to_graphic_cells: 'els[i].convertCellType(CellTypeEnum.GRAPHIC_TYPE_CELL, false)',
        to_text_cells: 'els[i].convertCellType(CellTypeEnum.TEXT_TYPE_CELL, false)',
        to_header_rows: 't.rows[i].rowType = RowTypes.HEADER_ROW',
        to_body_rows: 't.rows[i].rowType = RowTypes.BODY_ROW',
        to_footer_rows: 't.rows[i].rowType = RowTypes.FOOTER_ROW',
    };
    const ops = Object.keys(want);
    const scripts = await scriptsFor(ops.map((operation) => ['edit_table_cells', { table: T, cells: { rows: [0, 1] }, operation, keepContents: false }]));
    ops.forEach((op, i) => assert.ok(scripts[i].includes(want[op]), `${op}: missing ${want[op]}`));
    refuses('edit_table_cells', { table: T, operation: 'join' }, /Allowed: merge/);
    refuses('edit_table_cells', { table: T, operation: 'merge', keepContents: 'no' }, /true or false/);
});

await test('resize_table_rows_columns sizes, keeps width, scales and distributes', async () => {
    const s = await one('resize_table_rows_columns', { table: T, cells: { columns: [1, 2] }, rowHeight: 7, columnWidth: 25, keepTableWidth: true, distribute: 'rows' });
    assert.ok(s.includes('if (row.autoGrow) row.minimumHeight = 7; else row.height = 7;'));
    assert.ok(s.includes('var adj = cr.c2 + 1 < t.columns.length ? cr.c2 + 1 : cr.c1 - 1;') && s.includes('t.columns[adj].width = nw;'));
    assert.ok(s.includes('Choose at least two rows to distribute') && !s.includes('Choose at least two columns'));
    const p = await one('resize_table_rows_columns', { table: T, tableWidth: 120, tableHeight: 60, distribute: 'both' });
    assert.ok(p.includes('var fw = 120 / tw;') && p.includes('var fh = 60 / th;') && p.includes('Choose at least two columns'));
    refuses('resize_table_rows_columns', { table: T }, /Nothing to change/);
    refuses('resize_table_rows_columns', { table: T, columnWidth: 10, tableWidth: 100 }, /not both/);
    refuses('resize_table_rows_columns', { table: T, rowHeight: 10, tableHeight: 100 }, /not both/);
    refuses('resize_table_rows_columns', { table: T, keepTableWidth: true, rowHeight: 5 }, /goes with columnWidth/);
    refuses('resize_table_rows_columns', { table: T, distribute: 'cells' }, /Allowed: rows, columns, both/);
});

await test('convert_text_to_table and convert_table_to_text', async () => {
    const s = await one('convert_text_to_table', { source: { storyId: 3, start: 5, end: 50 }, columnSeparator: 'comma', headerRows: 1 });
    assert.ok(s.includes('st.characters.itemByRange(a0, a1 - 1).texts[0]') && s.includes('a0 = 5, a1 = 50'));
    assert.ok(s.includes('var nt = src.convertToTable(",", "\\r");') && s.includes('nt.headerRowCount = 1;'));
    const same = await one('convert_text_to_table', { source: { frameId: 8 }, columnSeparator: 'tab', rowSeparator: 'tab', columns: 4 });
    assert.ok(same.includes('src.convertToTable("\\t", "\\t", 4)') && same.includes('var st = f.parentStory;'));
    const sel = await one('convert_text_to_table', { source: { selection: true }, columnSeparator: '|' });
    assert.ok(sel.includes('src = s.texts[0]') && sel.includes('convertToTable("|", "\\r")'));
    refuses('convert_text_to_table', { source: { storyId: 1 }, columnSeparator: 'tab', rowSeparator: 'tab' }, /give columns/);
    refuses('convert_text_to_table', { source: { storyId: 1 }, columnSeparator: '||' }, /single character/);
    refuses('convert_text_to_table', { source: { storyId: 1, start: 9, end: 3 } }, /must be after/);
    refuses('convert_text_to_table', { source: { selection: true, start: 1 } }, /selection: true alone/);
    refuses('convert_text_to_table', { source: {} }, /give one of frameId or storyId/);
    const back = await one('convert_table_to_text', { table: T, columnSeparator: ';' });
    assert.ok(back.includes('t.convertToText(";", "\\r")'));
    refuses('convert_table_to_text', { table: T, rowSeparator: 'line' }, /single character/);
});

await test('copy_table_cells copies over cells, into new rows or columns, and combines tables', async () => {
    const s = await one('copy_table_cells', { source: { table: T, cells: { rows: [0, 1] } }, target: { row: 4, column: 0 }, cut: true });
    assert.ok(s.includes('var dt = st,') && s.includes('var dr = 4, dc = 0;'));
    assert.ok(s.includes('sc.texts[0].duplicate(LocationOptions.AT_END, tc)') && s.includes('if (true) {'));
    const c = await one('copy_table_cells', { source: { table: { storyId: 2, index: 1 } }, target: { table: { storyId: 2, index: 0 } }, placement: 'rows_after', removeSourceTable: true });
    assert.ok(c.includes('dt.rows.add(LocationOptions.AFTER, refRow)') && c.includes('var dr = dt.rows.length - 1') && c.includes('if (true) { st.remove();'));
    const b = await one('copy_table_cells', { source: { table: T, cells: { columns: [2] } }, placement: 'columns_before', target: { column: 0 } });
    assert.ok(b.includes('dt.columns.add(LocationOptions.BEFORE, refCol)') && b.includes('if (same && left <= cr.c1)'));
    refuses('copy_table_cells', {}, /Choose the source cells/);
    refuses('copy_table_cells', { source: { table: T }, placement: 'sideways' }, /Allowed: over/);
    refuses('copy_table_cells', { source: { table: T }, removeSourceTable: true }, /needs a different target\.table/);
    refuses('copy_table_cells', { source: { table: T }, cut: 'yes' }, /true or false/);
});

await test('select_table_part selects parts and reveals the page', async () => {
    const want = {
        table: 't.select();',
        cells: 'cr.range.select();',
        rows: 't.rows.itemByRange(cr.r1, cr.r2).select();',
        columns: 't.columns.itemByRange(cr.c1, cr.c2).select();',
    };
    for (const [part, line] of Object.entries(want)) assert.ok((await one('select_table_part', { table: T, part })).includes(line), part);
    const h = await one('select_table_part', { table: T, part: 'footer_rows', reveal: true });
    assert.ok(h.includes('"region":"footer"') && h.includes('app.activeWindow.activePage = pg;'));
    refuses('select_table_part', { table: T, part: 'body_rows', cells: { rows: [1] } }, /takes no cells/);
    refuses('select_table_part', { table: T, part: 'border' }, /Allowed: table, cells/);
});

await test('run_table_command invokes known, dialog-free menu actions only', async () => {
    const s = await one('run_table_command', { command: 'next_cell', times: 3 });
    assert.ok(s.includes('app.menuActions.itemByID(66856)') && s.includes('i < 3;') && s.includes('ma.invoke();') && s.includes('if (!ma.enabled)'));
    assert.ok((await one('run_table_command', { command: 'edit_footer' })).includes('itemByID(66854)'));
    assert.ok((await one('run_table_command', { command: 'proxy_select_inner' })).includes('itemByID(66910)'));
    refuses('run_table_command', { command: 'go_to_row' }, /Allowed: next_cell/);
    refuses('run_table_command', { command: 'next_cell', times: 0 }, /at least 1/);
    refuses('run_table_command', { command: 'next_cell', times: 101 }, /Invalid index/);
});

await test('place_spreadsheet_table sets Excel import options and restores them', async () => {
    const s = await one('place_spreadsheet_table', {
        filePath: `${home}/Documents/sales.xlsx`, sheet: 'Q3', range: 'A1:F20', formatting: 'unformatted_table',
        cellAlignment: 'center', decimalPlaces: 2, includeHiddenCells: true, link: true, frame: { pageIndex: 1, x: 10, y: 15, width: 120, height: 80 },
    });
    for (const line of [
        'xp.tableFormatting = TableFormattingOptions.EXCEL_UNFORMATTED_TABLE;', 'xp.sheetName = "Q3";', 'xp.rangeName = "A1:F20";',
        'xp.alignmentStyle = AlignmentStyleOptions.CENTER_ALIGN;', 'xp.decimalPlaces = 2;', 'xp.showHiddenCells = true;',
        'tp.linkTextFilesWhenImporting = true;', 'ip.place(file, false);', 'xp.sheetName = saved.sn;', 'tp.linkTextFilesWhenImporting = saved.ln;',
        'var pg = __page(doc, 1), o = __toPage(pg, 10, 15);', 'tf.geometricBounds = [o[1], o[0], o[1] + 80, o[0] + 120];',
    ]) assert.ok(s.includes(line), `missing ${line}`);
    const at = await one('place_spreadsheet_table', { filePath: `${home}/Documents/sales.xls`, at: { storyId: 3 } });
    assert.ok(at.includes('xp.sheetIndex = 0;') && at.includes('var ip = __textAt(doc,'));
    refuses('place_spreadsheet_table', { filePath: `${home}/Documents/sales.csv`, at: { storyId: 3 } }, /\.xlsx or \.xls/);
    refuses('place_spreadsheet_table', { filePath: '/etc/sales.xlsx', at: { storyId: 3 } }, /Access denied/);
    refuses('place_spreadsheet_table', { filePath: `${home}/a.xlsx` }, /not both/);
    refuses('place_spreadsheet_table', { filePath: `${home}/a.xlsx`, at: { storyId: 3 }, range: 'A1:B2"); x("' }, /cell range/);
    refuses('place_spreadsheet_table', { filePath: `${home}/a.xlsx`, frame: { x: 1 } }, /frame\.pageIndex/);
    refuses('place_spreadsheet_table', { filePath: `${home}/a.xlsx`, at: { storyId: 3 }, formatting: 'pretty' }, /Allowed: formatted_table/);
});

done();
