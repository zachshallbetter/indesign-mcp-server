/**
 * Text frame handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, looksLikeFailure, str, num, index, bool } from '../utils/stringUtils.js';
import { sessionManager } from '../core/sessionManager.js';
import {
    jsxProgram, jsxPage, jsxItemAt, jsxSwatch, jsxFont, jsxBounds, resolveBox, JSX_HELPERS,
} from './pageItemHandlers.js';
import { justificationOf } from './aliases.js';

const has = (v) => v !== undefined && v !== null && v !== '';

/** Direct text formatting lines applied to `target` (a Text object). */
function formattingLines(target, { fontName, fontSize, textColor, alignment }) {
    const pre = [];
    const apply = [];
    if (has(fontName)) {
        pre.push(...jsxFont('__font1', fontName));
        apply.push(`${target}.appliedFont = __font1;`);
    }
    if (has(textColor)) {
        pre.push(...jsxSwatch('__textColor', textColor, 'text'));
        apply.push(`${target}.fillColor = __textColor;`);
    }
    if (has(fontSize)) {
        apply.push(`${target}.pointSize = ${num(fontSize, { name: 'fontSize', min: 0.1, max: 1296 })};`);
    }
    if (has(alignment)) {
        apply.push(`${target}.justification = Justification.${justificationOf(alignment)};`);
    }
    return { pre, apply };
}

export class TextHandlers {
    /**
     * Create a text frame on the active page (or pageIndex)
     */
    static async createTextFrame(args) {
        const {
            content,
            pageIndex,
            fontSize,
            fontName,
            textColor,
            alignment,
            paragraphStyle = null,
            characterStyle = null
        } = args;

        const box = resolveBox(args);
        const fmt = formattingLines('__text', { fontName, fontSize, textColor, alignment });
        const pre = [...fmt.pre];
        const apply = [];
        if (has(paragraphStyle)) {
            pre.push(
                `var __ps = __styleByName(doc.allParagraphStyles, ${str(paragraphStyle)});`,
                `if (!__ps) { return ${str(`Error: paragraph style '${paragraphStyle}' not found`)}; }`,
            );
            apply.push('__text.appliedParagraphStyle = __ps;');
        }
        if (has(characterStyle)) {
            pre.push(
                `var __cs = __styleByName(doc.allCharacterStyles, ${str(characterStyle)});`,
                `if (!__cs) { return ${str(`Error: character style '${characterStyle}' not found`)}; }`,
            );
            apply.push('__text.appliedCharacterStyle = __cs;');
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(args.pageIndex),
            ...pre,
            ...jsxBounds('__bounds', box),
            'var textFrame = page.textFrames.add();',
            'textFrame.geometricBounds = __bounds;',
            `textFrame.contents = ${str(content ?? '')};`,
            'var __text = textFrame.texts[0];',
            // styles first, explicit formatting overrides them
            ...apply,
            ...fmt.apply,
            'return "Text frame created on page " + page.name + " (ID " + textFrame.id + ", " + textFrame.parentStory.characters.length + " characters" + (textFrame.overflows ? ", text overflows" : "") + ")";',
        ], { errorPrefix: 'Error creating text frame' });

        const result = await ScriptExecutor.executeInDesignScript(script);

        if (!looksLikeFailure(result)) {
            sessionManager.setLastCreatedItem({
                type: 'textFrame',
                content,
                position: box,
                pageIndex,
                fontSize,
                fontName,
                paragraphStyle,
                characterStyle
            });
        }

        return formatResponse(result, "Create Text Frame");
    }

    /**
     * Edit an existing text frame
     */
    static async editTextFrame(args) {
        const { frameIndex, pageIndex, content, fontSize, fontName, textColor, alignment } = args;

        const fmt = formattingLines('__text', { fontName, fontSize, textColor, alignment });
        const changed = [];
        if (content !== undefined && content !== null) changed.push('content');
        if (has(fontName)) changed.push('font');
        if (has(fontSize)) changed.push('size');
        if (has(textColor)) changed.push('color');
        if (has(alignment)) changed.push('alignment');
        if (!changed.length) {
            return formatResponse('Invalid request: nothing to change', 'Edit Text Frame');
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...jsxItemAt('textFrame', 'page.textFrames', frameIndex, 'Text frame index'),
            ...fmt.pre,
            ...(content !== undefined && content !== null ? [`textFrame.contents = ${str(content)};`] : []),
            'var __text = textFrame.texts[0];',
            ...fmt.apply,
            `return ${str(`Text frame updated: ${changed.join(', ')}`)};`,
        ], { errorPrefix: 'Error updating text frame' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Edit Text Frame");
    }

    /**
     * Create a table on the active page (or pageIndex)
     */
    static async createTable(args) {
        const { rows = 3, columns = 3, headerRows, pageIndex } = args;

        const rowsN = Number(index(rows, { name: 'rows', max: 10000 }));
        const colsN = Number(index(columns, { name: 'columns', max: 200 }));
        if (rowsN < 1 || colsN < 1) {
            return formatResponse('Invalid table size: rows and columns must be at least 1', 'Create Table');
        }
        // Default: one header row when there is room for at least one body row.
        const headN = has(headerRows)
            ? Number(index(headerRows, { name: 'headerRows', max: 10000 }))
            : Math.min(1, rowsN - 1);
        if (headN >= rowsN) {
            return formatResponse('Invalid headerRows: must be less than rows (rows includes header rows)', 'Create Table');
        }
        const box = resolveBox(args);

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            ...jsxBounds('__bounds', box),
            'var textFrame = page.textFrames.add();',
            'textFrame.geometricBounds = __bounds;',
            'var table = textFrame.insertionPoints[0].tables.add();',
            `table.columnCount = ${colsN};`,
            `table.bodyRowCount = ${rowsN - headN};`,
            `table.headerRowCount = ${headN};`,
            'table.width = __bounds[3] - __bounds[1];',
            'return "Table created on page " + page.name + ": " + table.rows.length + " rows (" + table.headerRowCount + " header) x " + table.columns.length + " columns";',
        ], { errorPrefix: 'Error creating table' });

        const result = await ScriptExecutor.executeInDesignScript(script);

        if (!looksLikeFailure(result)) {
            sessionManager.setLastCreatedItem({
                type: 'table',
                rows: rowsN,
                columns: colsN,
                position: box,
                headerRows: headN
            });
        }

        return formatResponse(result, "Create Table");
    }

    /**
     * Populate a table with data
     */
    static async populateTable(args) {
        const { tableIndex = 0, data, startRow = 0, startColumn = 0, pageIndex } = args;

        if (!Array.isArray(data) || data.some((row) => !Array.isArray(row))) {
            return formatResponse('Invalid data: expected an array of rows, each an array of cell values', 'Populate Table');
        }
        const cellText = (cell) => {
            if (cell === null || cell === undefined) return '';
            if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
            throw new Error(`Invalid table cell value: ${JSON.stringify(cell)} (use strings or numbers)`);
        };
        const rowsLit = data.map((row) => `[${row.map((c) => str(cellText(c))).join(', ')}]`).join(',\n    ');

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            'var tables = [];',
            'for (var f = 0; f < page.textFrames.length; f++) {',
            '  var ft = page.textFrames[f].tables;',
            '  for (var t = 0; t < ft.length; t++) { tables.push(ft[t]); }',
            '}',
            ...jsxItemAt('table', 'tables', tableIndex, 'Table index'),
            `var data = [\n    ${rowsLit}\n  ];`,
            `var startRow = ${index(startRow, { name: 'startRow' })};`,
            `var startColumn = ${index(startColumn, { name: 'startColumn' })};`,
            'var written = 0;',
            'var skipped = 0;',
            'for (var r = 0; r < data.length; r++) {',
            '  for (var c = 0; c < data[r].length; c++) {',
            '    var rowIdx = startRow + r;',
            '    var colIdx = startColumn + c;',
            '    if (rowIdx < table.rows.length && colIdx < table.rows[rowIdx].cells.length) {',
            '      table.rows[rowIdx].cells[colIdx].contents = data[r][c];',
            '      written++;',
            '    } else {',
            '      skipped++;',
            '    }',
            '  }',
            '}',
            'return "Table populated: " + written + " cells written" + (skipped ? ", " + skipped + " cells outside the table were skipped (table is " + table.rows.length + "x" + table.columns.length + ")" : "");',
        ], { errorPrefix: 'Error populating table' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Populate Table");
    }

    /**
     * Find and replace text in the document (literal text search, not GREP)
     */
    static async findReplaceText(args) {
        const { findText, replaceText, caseSensitive = false, wholeWord = false } = args;

        if (typeof findText !== 'string' || findText === '') {
            return formatResponse('Invalid findText: must be a non-empty string', 'Find Replace Text');
        }
        if (typeof replaceText !== 'string') {
            return formatResponse('Invalid replaceText: must be a string', 'Find Replace Text');
        }

        const script = jsxProgram([
            'var opts = app.findChangeTextOptions;',
            'var prevCase = opts.caseSensitive;',
            'var prevWhole = opts.wholeWord;',
            'app.findTextPreferences = NothingEnum.NOTHING;',
            'app.changeTextPreferences = NothingEnum.NOTHING;',
            'var changed;',
            'try {',
            `  opts.caseSensitive = ${bool(caseSensitive)};`,
            `  opts.wholeWord = ${bool(wholeWord)};`,
            `  app.findTextPreferences.findWhat = ${str(findText)};`,
            `  app.changeTextPreferences.changeTo = ${str(replaceText)};`,
            '  changed = doc.changeText(false);',
            '} finally {',
            '  app.findTextPreferences = NothingEnum.NOTHING;',
            '  app.changeTextPreferences = NothingEnum.NOTHING;',
            '  opts.caseSensitive = prevCase;',
            '  opts.wholeWord = prevWhole;',
            '}',
            'return "Find and replace completed. Occurrences changed: " + changed.length;',
        ], { errorPrefix: 'Error during find and replace' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Find Replace Text");
    }
}
