/**
 * Tables: Table Options, Cell Options and table structure (insert, delete,
 * merge, split, resize, distribute, convert, copy, select), plus the Table
 * menu's keyboard commands and placing spreadsheets as tables.
 *
 * Addressing. A table is chosen with `table` (TABLE_SCHEMA):
 *   { frameId, index }    the index-th table in a text frame
 *   { storyId, index }    the index-th table in a story
 *   { pageIndex, index }  the index-th table among the page's text frames,
 *                         counted frame by frame (as populate_table does)
 *   { selection: true }   the table holding the selection (selected cells, a
 *                         text cursor in a cell, or a selected frame's first table)
 * plus `nested: [{ row, column, index }]` to step into tables inside cells.
 *
 * Cells are chosen with `cells` (CELLS_SCHEMA): rows and columns as
 * [first, last] (0-based and inclusive; header rows count), or a region
 * (header, body, footer rows), or the selected cells. Omitted means every cell.
 * A rectangle of cells is one Cell range (Cells.itemByRange), so a property set
 * on it lands on every cell, and edges follow the Cell Options proxy.
 *
 * Insets, sizes and spacing are millimetres; stroke weights and point sizes
 * are points.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { validateFilePath, ALLOWED } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, COLOR_SCHEMA, colorSpec } from './run.js';

const has = (v) => v !== undefined && v !== null;

/** An option group: an object whose keys are all in `allowed` (null when absent). */
function group(value, allowed, name) {
    if (!has(value)) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    for (const k of Object.keys(value)) {
        if (!allowed.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${allowed.join(', ')}`);
    }
    return value;
}

/** A boolean argument (a string such as "false" is refused rather than read as true). */
function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

/** A non-empty name (style, swatch, stroke style) as a JSX string literal. */
function text(value, name, max = 200) {
    const v = String(value ?? '');
    if (!v.trim()) throw new Error(`'${name}' is empty`);
    if (v.length > max) throw new Error(`'${name}' is too long`);
    return str(v);
}

/** Millimetres. */
const mm = (v, name, { min = 0, max = 5000 } = {}) => num(v, { min, max, name });

/** An id (PageItem.id, Story.id). */
const id = (v, name) => index(v, { name, max: 1e9 });

// ---------------------------------------------------------------- schemas

const ROW_COL_INDEX = { type: 'integer', minimum: 0 };

export const TABLE_SCHEMA = {
    type: 'object',
    description: 'Which table. Give frameId, storyId or pageIndex with index (which table, 0-based), or selection: true for the table holding the selection. Add nested to reach a table inside a cell. get_table_info lists every table with its storyId and index',
    properties: {
        frameId: { type: 'integer', minimum: 0, description: 'Id of a text frame; index counts the tables in that frame' },
        storyId: { type: 'integer', minimum: 0, description: 'Story id; index counts the tables in the story' },
        pageIndex: { type: 'integer', minimum: 0, description: '0-based page index; index counts the tables in the page\'s text frames, frame by frame' },
        index: { type: 'integer', minimum: 0, description: 'Which table (0-based)', default: 0 },
        selection: { type: 'boolean', description: 'Use the table holding the selection: selected cells, a text cursor in a cell, or a selected text frame\'s first table' },
        nested: {
            type: 'array',
            description: 'Path to a table nested in cells: each step goes into the cell at (row, column) of the current table and takes its index-th table',
            items: {
                type: 'object',
                properties: {
                    row: { ...ROW_COL_INDEX, description: 'Row of the cell holding the nested table' },
                    column: { ...ROW_COL_INDEX, description: 'Column of the cell holding the nested table' },
                    index: { type: 'integer', minimum: 0, description: 'Which table in that cell (0-based)', default: 0 },
                },
                required: ['row', 'column'],
            },
        },
    },
};

const RANGE = (what) => ({
    type: 'array',
    items: { type: 'integer', minimum: 0 },
    minItems: 1,
    maxItems: 2,
    description: `${what} as [first, last] (0-based, inclusive), or [one]`,
});

const REGIONS = ['all', 'header', 'body', 'footer'];

export const CELLS_SCHEMA = {
    type: 'object',
    description: 'Which cells of the table; omitted means every cell. Give rows and/or columns, or region, or selection: true for the selected cells',
    properties: {
        rows: RANGE('Rows (header rows count)'),
        columns: RANGE('Columns'),
        region: { type: 'string', enum: REGIONS, description: 'Every row of one region: header, body or footer rows', default: 'all' },
        selection: { type: 'boolean', description: 'Use the selected cells (or the cell holding the text cursor); the table is then the selection\'s' },
    },
};

const STROKE_PROPS = {
    weight: { type: 'number', minimum: 0, description: 'Stroke weight in points' },
    type: { type: 'string', description: 'Stroke style name as in the Stroke panel, e.g. Solid, Dashed, Dotted, Thick - Thin' },
    color: COLOR_SCHEMA,
    tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint in percent' },
    gapColor: { ...COLOR_SCHEMA, description: 'Colour of the gaps in a dashed, dotted or striped stroke: a swatch name, or "#RRGGBB"' },
    gapTint: { type: 'number', minimum: 0, maximum: 100, description: 'Gap tint in percent' },
    overprint: { type: 'boolean', description: 'Overprint the stroke' },
    gapOverprint: { type: 'boolean', description: 'Overprint the gaps' },
};
const STROKE_KEYS = Object.keys(STROKE_PROPS);

const stroke = (description, extra = {}) => ({ type: 'object', description, properties: { ...extra, ...STROKE_PROPS } });

const INSETS = (what) => ({
    type: 'object',
    description: `${what} in mm`,
    properties: {
        top: { type: 'number', minimum: 0, description: 'Top inset in mm' },
        bottom: { type: 'number', minimum: 0, description: 'Bottom inset in mm' },
        left: { type: 'number', minimum: 0, description: 'Left inset in mm' },
        right: { type: 'number', minimum: 0, description: 'Right inset in mm' },
    },
});

export const TEXT_LOCATION_SCHEMA = {
    type: 'object',
    description: 'Where in text: a text frame\'s story or a story, at characterIndex (default: the end), or selection: true for the text cursor or selected text frame',
    properties: {
        frameId: { type: 'integer', minimum: 0, description: 'Id of a text frame; its story is used' },
        storyId: { type: 'integer', minimum: 0, description: 'Story id' },
        characterIndex: { type: 'integer', minimum: 0, description: 'Insertion point in the story, counted in characters from the start (default: the end of the story)' },
        selection: { type: 'boolean', description: 'Use the text cursor, the end of the selected text, a selected cell, or the end of a selected text frame\'s story' },
    },
};

// ---------------------------------------------------------- argument specs

/** A table choice as a JSX literal for __table(): every key present, nulls for the unused ones. */
export function tableSpec(t, name = 'table') {
    const g = group(t, ['frameId', 'storyId', 'pageIndex', 'index', 'selection', 'nested'], name);
    const choose = `Choose the table: ${name}.frameId, ${name}.storyId or ${name}.pageIndex (with ${name}.index), or ${name}.selection: true`;
    if (!g) throw new Error(choose);
    const sources = ['frameId', 'storyId', 'pageIndex'].filter((k) => has(g[k]));
    if (has(g.selection) && typeof g.selection !== 'boolean') throw new Error(`'${name}.selection' must be true or false`);
    if (g.selection && sources.length) throw new Error(`${name}: give selection: true or one of frameId, storyId, pageIndex, not both`);
    if (!g.selection && sources.length !== 1) throw new Error(sources.length ? `${name}: give only one of frameId, storyId, pageIndex` : choose);
    if (has(g.nested) && !Array.isArray(g.nested)) throw new Error(`'${name}.nested' must be a list of { row, column, index }`);
    const nested = (g.nested ?? []).map((s, i) => {
        const n = `${name}.nested[${i}]`;
        group(s, ['row', 'column', 'index'], n);
        if (!s || !has(s.row) || !has(s.column)) throw new Error(`'${n}' needs row and column`);
        return [Number(index(s.row, { name: `${n}.row` })), Number(index(s.column, { name: `${n}.column` })), Number(index(s.index ?? 0, { name: `${n}.index` }))];
    });
    return json({
        frameId: has(g.frameId) ? Number(id(g.frameId, `${name}.frameId`)) : null,
        storyId: has(g.storyId) ? Number(id(g.storyId, `${name}.storyId`)) : null,
        pageIndex: has(g.pageIndex) ? Number(index(g.pageIndex, { name: `${name}.pageIndex` })) : null,
        index: Number(index(g.index ?? 0, { name: `${name}.index` })),
        selection: g.selection === true,
        nested,
    });
}

/** A [first, last] range, or null. */
function rangeOf(v, name) {
    if (!has(v)) return null;
    if (!Array.isArray(v) || v.length < 1 || v.length > 2) throw new Error(`'${name}' must be [first, last] or [index]`);
    const a = Number(index(v[0], { name }));
    const b = Number(index(v.length > 1 ? v[1] : v[0], { name }));
    if (b < a) throw new Error(`'${name}': last (${b}) is before first (${a})`);
    return [a, b];
}

/** A cell choice as a JSX literal for __cells(). */
export function cellsSpec(c, name = 'cells') {
    const g = group(c, ['rows', 'columns', 'region', 'selection'], name) ?? {};
    const rows = rangeOf(g.rows, `${name}.rows`);
    const columns = rangeOf(g.columns, `${name}.columns`);
    const region = enumOf(g.region ?? 'all', REGIONS, { name: `${name}.region` });
    if (has(g.selection) && typeof g.selection !== 'boolean') throw new Error(`'${name}.selection' must be true or false`);
    if (region !== 'all' && rows) throw new Error(`Give ${name}.rows or ${name}.region, not both`);
    if (g.selection && (rows || columns || region !== 'all')) throw new Error(`${name}.selection uses the selected cells; drop rows, columns and region`);
    return json({ rows, columns, region, selection: g.selection === true });
}

/** The table and cell literals; selected cells imply the selection's table. */
function tableAndCells(a) {
    const cellSel = a.cells?.selection === true;
    const table = has(a.table) ? a.table : (cellSel ? { selection: true } : a.table);
    if (cellSel && table?.selection !== true) throw new Error('cells.selection uses the selection\'s table: drop table or set table.selection: true');
    return [tableSpec(table), cellsSpec(a.cells)];
}

/** Assignments for a stroke group on `obj`, one set per property prefix. */
function strokeLines(obj, prefixes, s, name, typeNames = []) {
    group(s, STROKE_KEYS.concat(['count']), name);
    const lines = [];
    prefixes.forEach((p, i) => {
        if (has(s.weight)) lines.push(`${obj}.${p}Weight = "${num(s.weight, { min: 0, max: 1000, name: `${name}.weight` })}pt";`);
        if (has(s.type)) lines.push(`${obj}.${typeNames[i] ?? `${p}Type`} = __strokeStyle(doc, ${text(s.type, `${name}.type`)});`);
        if (has(s.color)) lines.push(`${obj}.${p}Color = __swatch(doc, ${colorSpec(s.color, `${name}.color`)});`);
        if (has(s.tint)) lines.push(`${obj}.${p}Tint = ${num(s.tint, { min: 0, max: 100, name: `${name}.tint` })};`);
        if (has(s.gapColor)) lines.push(`${obj}.${p}GapColor = __swatch(doc, ${colorSpec(s.gapColor, `${name}.gapColor`)});`);
        if (has(s.gapTint)) lines.push(`${obj}.${p}GapTint = ${num(s.gapTint, { min: 0, max: 100, name: `${name}.gapTint` })};`);
        if (has(s.overprint)) lines.push(`${obj}.${p}Overprint = ${flag(s.overprint, `${name}.overprint`)};`);
        if (has(s.gapOverprint)) lines.push(`${obj}.${p}GapOverprint = ${flag(s.gapOverprint, `${name}.gapOverprint`)};`);
    });
    return lines;
}

/** A text location as a JSX literal for __textAt(). */
export function textAtSpec(at, name = 'at') {
    const g = group(at, ['frameId', 'storyId', 'characterIndex', 'selection'], name);
    if (!g) throw new Error(`Choose where: ${name}.frameId, ${name}.storyId or ${name}.selection: true`);
    if (has(g.selection) && typeof g.selection !== 'boolean') throw new Error(`'${name}.selection' must be true or false`);
    const sources = ['frameId', 'storyId'].filter((k) => has(g[k]));
    if (g.selection && (sources.length || has(g.characterIndex))) throw new Error(`${name}: selection: true takes no frameId, storyId or characterIndex`);
    if (!g.selection && sources.length !== 1) throw new Error(`${name}: give one of frameId, storyId, or selection: true`);
    return json({
        frameId: has(g.frameId) ? Number(id(g.frameId, `${name}.frameId`)) : null,
        storyId: has(g.storyId) ? Number(id(g.storyId, `${name}.storyId`)) : null,
        characterIndex: has(g.characterIndex) ? Number(index(g.characterIndex, { name: `${name}.characterIndex`, max: 1e8 })) : null,
        selection: g.selection === true,
    });
}

// ------------------------------------------------------------ JSX helpers

/** __table(doc, spec), __tableOf(selected) and __tableInfo(table). */
export const TABLE_JSX = `
function __tableOf(s) {
  var n = s.constructor.name;
  if (n === "Table") return s;
  if (n === "Cell" || n === "Row" || n === "Column") return s.parent;
  if (n === "TextFrame") return s.tables.length ? s.tables[0] : null;
  try {
    var p = s.parent;
    if (p && p.constructor.name === "Cell") return p.parent;
  } catch (e) {}
  return null;
}

function __table(doc, spec) {
  var t = null, list, i;
  if (spec.selection) {
    if (!app.selection.length) throw new Error("Nothing is selected: select table cells, put the text cursor in a cell, or select a frame holding a table");
    t = __tableOf(app.selection[0]);
    if (!t) throw new Error("The selection is not in a table");
  } else {
    if (spec.frameId !== null) {
      var f = __item(doc, spec.frameId);
      if (f.constructor.name !== "TextFrame") throw new Error("Item " + spec.frameId + " is a " + f.constructor.name + ", not a text frame");
      list = f.tables;
    } else if (spec.storyId !== null) {
      var st = doc.stories.itemByID(spec.storyId);
      if (!st.isValid) throw new Error("Story " + spec.storyId + " not found");
      list = st.tables;
    } else {
      var pg = __page(doc, spec.pageIndex);
      list = [];
      for (i = 0; i < pg.textFrames.length; i++) {
        var ft = pg.textFrames[i].tables;
        for (var k = 0; k < ft.length; k++) list.push(ft[k]);
      }
    }
    if (spec.index >= list.length) throw new Error("Table index " + spec.index + " is out of range: " + list.length + " table(s) found");
    t = list[spec.index];
  }
  for (i = 0; i < spec.nested.length; i++) {
    var step = spec.nested[i];
    var cell = t.cells.itemByName(step[1] + ":" + step[0]);
    if (!cell.isValid) throw new Error("nested[" + i + "]: no cell at row " + step[0] + ", column " + step[1]);
    if (step[2] >= cell.tables.length) throw new Error("nested[" + i + "]: the cell at row " + step[0] + ", column " + step[1] + " holds " + cell.tables.length + " table(s)");
    t = cell.tables[step[2]];
  }
  return t;
}

function __tableInfo(t) {
  var o = { index: null, rows: t.rows.length, columns: t.columns.length, headerRows: t.headerRowCount, bodyRows: t.bodyRowCount,
    footerRows: t.footerRowCount, width: t.width, height: t.height, storyId: null, frameId: null, pageIndex: null, nested: false };
  try {
    var ip = t.storyOffset, holder = ip.parent, k;
    o.nested = holder.constructor.name === "Cell";
    o.storyId = ip.parentStory.id;
    var siblings = o.nested ? holder.tables : ip.parentStory.tables;
    for (k = 0; k < siblings.length; k++) if (siblings[k].id === t.id) { o.index = k; break; }
    var tf = ip.parentTextFrames;
    if (tf.length) {
      o.frameId = tf[0].id;
      var pg = __pageOf(tf[0]);
      o.pageIndex = pg ? pg.documentOffset : null;
    }
  } catch (e) {}
  return o;
}
`;

/** __cells(table, spec): { range, r1, r2, c1, c2 } for the chosen rectangle of cells. */
export const CELLS_JSX = `
function __cells(t, spec) {
  var nr = t.rows.length, nc = t.columns.length, r1 = 0, r2 = nr - 1, c1 = 0, c2 = nc - 1, i;
  if (spec.selection) {
    var s = app.selection.length ? app.selection[0] : null, sel = null;
    if (!s) throw new Error("Nothing is selected: select table cells or put the text cursor in a cell");
    var n = s.constructor.name;
    if (n === "Cell") sel = s;
    else if (n === "Row" || n === "Column") sel = s.cells.everyItem();
    else if (n === "Table") sel = s.cells.everyItem();
    else { try { if (s.parent.constructor.name === "Cell") sel = s.parent; } catch (e) {} }
    if (!sel) throw new Error("Select table cells, or put the text cursor in a cell");
    var els = sel.getElements();
    r1 = nr; r2 = -1; c1 = nc; c2 = -1;
    for (i = 0; i < els.length; i++) {
      var ri = els[i].parentRow.index, ci = els[i].parentColumn.index;
      if (ri < r1) r1 = ri;
      if (ci < c1) c1 = ci;
      if (ri + els[i].rowSpan - 1 > r2) r2 = ri + els[i].rowSpan - 1;
      if (ci + els[i].columnSpan - 1 > c2) c2 = ci + els[i].columnSpan - 1;
    }
    return { range: sel, r1: r1, r2: r2, c1: c1, c2: c2 };
  }
  if (spec.region === "header") {
    if (!t.headerRowCount) throw new Error("The table has no header rows");
    r2 = t.headerRowCount - 1;
  } else if (spec.region === "body") {
    r1 = t.headerRowCount; r2 = nr - t.footerRowCount - 1;
    if (r2 < r1) throw new Error("The table has no body rows");
  } else if (spec.region === "footer") {
    if (!t.footerRowCount) throw new Error("The table has no footer rows");
    r1 = nr - t.footerRowCount;
  }
  if (spec.rows) { r1 = spec.rows[0]; r2 = spec.rows[1]; }
  if (spec.columns) { c1 = spec.columns[0]; c2 = spec.columns[1]; }
  if (r2 >= nr) throw new Error("Row " + r2 + " is out of range: the table has " + nr + " rows");
  if (c2 >= nc) throw new Error("Column " + c2 + " is out of range: the table has " + nc + " columns");
  var a = t.cells.itemByName(c1 + ":" + r1), b = t.cells.itemByName(c2 + ":" + r2);
  if (!a.isValid) throw new Error("The cell at row " + r1 + ", column " + c1 + " is covered by a merged cell; start the range on the merged cell");
  if (!b.isValid) throw new Error("The cell at row " + r2 + ", column " + c2 + " is covered by a merged cell; end the range on the merged cell");
  return { range: t.cells.itemByRange(a, b), r1: r1, r2: r2, c1: c1, c2: c2 };
}
`;

/** __strokeStyle(doc, name) and __named(list, name, kind) for styles by name. */
const STYLE_JSX = `
function __strokeStyle(doc, name) {
  var s = doc.strokeStyles.itemByName(name);
  if (!s.isValid) throw new Error("No stroke style named " + name);
  return s;
}

function __named(list, name, kind) {
  for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
  throw new Error("No " + kind + " style named " + name);
}
`;

/** __textAt(doc, spec): the insertion point a text location names. */
export const TEXT_AT_JSX = `
function __textAt(doc, spec) {
  var story;
  if (spec.selection) {
    if (!app.selection.length) throw new Error("Nothing is selected: put the text cursor in text, or select a text frame or cell");
    var s = app.selection[0], n = s.constructor.name;
    if (n === "TextFrame") return s.parentStory.insertionPoints[-1];
    if (n === "Table" || n === "Row" || n === "Column") throw new Error("Select one cell, or put the text cursor where the table goes");
    try { return s.insertionPoints[-1]; } catch (e) { throw new Error("The selection is not text: put the text cursor in text, or select a text frame or cell"); }
  }
  if (spec.frameId !== null) {
    var f = __item(doc, spec.frameId);
    if (f.constructor.name !== "TextFrame") throw new Error("Item " + spec.frameId + " is a " + f.constructor.name + ", not a text frame");
    story = f.parentStory;
  } else {
    story = doc.stories.itemByID(spec.storyId);
    if (!story.isValid) throw new Error("Story " + spec.storyId + " not found");
  }
  if (spec.characterIndex === null) return story.insertionPoints[-1];
  if (spec.characterIndex >= story.insertionPoints.length) throw new Error("characterIndex " + spec.characterIndex + " is past the end of the story (" + story.characters.length + " characters)");
  return story.insertionPoints[spec.characterIndex];
}
`;

// ------------------------------------------------------------- Table Options

const BREAKS = { every_text_column: 'IN_ALL_TEXT_COLUMNS', once_per_frame: 'ONCE_PER_TEXT_FRAME', once_per_page: 'ONCE_PER_PAGE' };
const STROKE_ORDER = { best_joins: 'BEST_JOINS', row_on_top: 'ROW_ON_TOP', column_on_top: 'COLUMN_ON_TOP', indesign_2_compatibility: 'INDESIGN_2_COMPATIBILITY' };
const DIRECTIONS = { left_to_right: 'LEFT_TO_RIGHT_DIRECTION', right_to_left: 'RIGHT_TO_LEFT_DIRECTION' };
const FILL_PATTERNS = { none: 'NO_ALTERNATING_PATTERN', rows: 'ALTERNATING_ROWS', columns: 'ALTERNATING_COLUMNS' };
const TABLE_ALIGN = ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN'];

const COUNT = (d) => ({ type: 'integer', minimum: 0, description: d });
const patternStroke = (which, axis) => stroke(`The ${which} stroke of the ${axis} pattern`, {
    count: COUNT(`How many ${axis}s take the ${which} stroke before the pattern switches`),
});
const skip = (what, edge) => COUNT(`${edge === 'first' ? 'Skip First' : 'Skip Last'}: leave this many ${what} out of the pattern`);
const patternFill = (which, axis) => ({
    type: 'object',
    description: `The ${which} fill of the alternating pattern`,
    properties: {
        count: COUNT(`How many ${axis} take the ${which} fill before the pattern switches`),
        color: COLOR_SCHEMA,
        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint in percent' },
        overprint: { type: 'boolean', description: 'Overprint the fill' },
    },
});

/** Lines for one alternating stroke group (row or column strokes). */
function patternStrokeLines(g, name, axis) {
    const G = axis === 'row' ? 'Row' : 'Column';
    const lines = [];
    for (const [key, side] of [['first', 'start'], ['next', 'end']]) {
        const s = group(g[key], STROKE_KEYS.concat(['count']), `${name}.${key}`);
        if (!s) continue;
        if (has(s.count)) lines.push(`t.${side}${G}StrokeCount = ${index(s.count, { name: `${name}.${key}.count`, max: 1000 })};`);
        // The object model names the next column stroke's type endColumnLineStyle.
        const typeName = axis === 'column' && side === 'end' ? 'endColumnLineStyle' : `${side}${G}StrokeType`;
        lines.push(...strokeLines('t', [`${side}${G}Stroke`], s, `${name}.${key}`, [typeName]));
    }
    if (has(g.skipFirst)) lines.push(`t.skipFirstAlternatingStroke${G}s = ${index(g.skipFirst, { name: `${name}.skipFirst`, max: 1000 })};`);
    if (has(g.skipLast)) lines.push(`t.skipLastAlternatingStroke${G}s = ${index(g.skipLast, { name: `${name}.skipLast`, max: 1000 })};`);
    return lines;
}

function tableOptionLines(a) {
    const lines = [];
    const setup = group(a.setup, ['headerRows', 'bodyRows', 'footerRows', 'columns', 'border', 'spaceBefore', 'spaceAfter', 'strokeDrawingOrder', 'direction', 'alignment'], 'setup');
    if (setup) {
        if (has(setup.columns)) {
            if (Number(setup.columns) < 1) throw new Error("'setup.columns' must be at least 1");
            lines.push(`t.columnCount = ${index(setup.columns, { name: 'setup.columns', max: 200 })};`);
        }
        if (has(setup.bodyRows)) {
            if (Number(setup.bodyRows) < 1) throw new Error("'setup.bodyRows' must be at least 1");
            lines.push(`t.bodyRowCount = ${index(setup.bodyRows, { name: 'setup.bodyRows', max: 10000 })};`);
        }
        if (has(setup.headerRows)) lines.push(`t.headerRowCount = ${index(setup.headerRows, { name: 'setup.headerRows', max: 10000 })};`);
        if (has(setup.footerRows)) lines.push(`t.footerRowCount = ${index(setup.footerRows, { name: 'setup.footerRows', max: 10000 })};`);
        if (has(setup.border)) {
            lines.push(...strokeLines('t', ['topBorderStroke', 'bottomBorderStroke', 'leftBorderStroke', 'rightBorderStroke'], setup.border, 'setup.border'));
        }
        if (has(setup.spaceBefore)) lines.push(`t.spaceBefore = ${mm(setup.spaceBefore, 'setup.spaceBefore', { max: 1000 })};`);
        if (has(setup.spaceAfter)) lines.push(`t.spaceAfter = ${mm(setup.spaceAfter, 'setup.spaceAfter', { max: 1000 })};`);
        if (has(setup.strokeDrawingOrder)) {
            lines.push(`t.strokeOrder = StrokeOrderTypes.${STROKE_ORDER[enumOf(setup.strokeDrawingOrder, Object.keys(STROKE_ORDER), { name: 'setup.strokeDrawingOrder' })]};`);
        }
        if (has(setup.direction)) {
            lines.push(`t.tableDirection = TableDirectionOptions.${DIRECTIONS[enumOf(setup.direction, Object.keys(DIRECTIONS), { name: 'setup.direction' })]};`);
        }
        if (has(setup.alignment)) {
            lines.push(`t.storyOffset.paragraphs[0].justification = Justification.${enumOf(setup.alignment, TABLE_ALIGN, { name: 'setup.alignment' })};`);
        }
    }
    const rs = group(a.rowStrokes, ['first', 'next', 'skipFirst', 'skipLast'], 'rowStrokes');
    if (rs) lines.push(...patternStrokeLines(rs, 'rowStrokes', 'row'));
    const cs = group(a.columnStrokes, ['first', 'next', 'skipFirst', 'skipLast'], 'columnStrokes');
    if (cs) lines.push(...patternStrokeLines(cs, 'columnStrokes', 'column'));
    const fills = group(a.fills, ['pattern', 'first', 'next', 'skipFirst', 'skipLast', 'columnFillsPriority'], 'fills');
    if (fills) {
        const pattern = has(fills.pattern) ? enumOf(fills.pattern, Object.keys(FILL_PATTERNS), { name: 'fills.pattern' }) : null;
        const patterned = ['first', 'next', 'skipFirst', 'skipLast'].filter((k) => has(fills[k]));
        if (patterned.length && (pattern === null || pattern === 'none')) {
            throw new Error(`fills.pattern 'rows' or 'columns' is required with fills.${patterned.join(', fills.')}`);
        }
        if (pattern) lines.push(`t.alternatingFills = AlternatingFillsTypes.${FILL_PATTERNS[pattern]};`);
        const G = pattern === 'columns' ? 'Column' : 'Row';
        for (const [key, side] of [['first', 'start'], ['next', 'end']]) {
            const f = group(fills[key], ['count', 'color', 'tint', 'overprint'], `fills.${key}`);
            if (!f) continue;
            if (has(f.count)) lines.push(`t.${side}${G}FillCount = ${index(f.count, { name: `fills.${key}.count`, max: 1000 })};`);
            if (has(f.color)) lines.push(`t.${side}${G}FillColor = __swatch(doc, ${colorSpec(f.color, `fills.${key}.color`)});`);
            if (has(f.tint)) lines.push(`t.${side}${G}FillTint = ${num(f.tint, { min: 0, max: 100, name: `fills.${key}.tint` })};`);
            if (has(f.overprint)) lines.push(`t.${side}${G}FillOverprint = ${flag(f.overprint, `fills.${key}.overprint`)};`);
        }
        if (has(fills.skipFirst)) lines.push(`t.skipFirstAlternatingFill${G}s = ${index(fills.skipFirst, { name: 'fills.skipFirst', max: 1000 })};`);
        if (has(fills.skipLast)) lines.push(`t.skipLastAlternatingFill${G}s = ${index(fills.skipLast, { name: 'fills.skipLast', max: 1000 })};`);
        if (has(fills.columnFillsPriority)) lines.push(`t.columnFillsPriority = ${flag(fills.columnFillsPriority, 'fills.columnFillsPriority')};`);
    }
    const hf = group(a.headersFooters, ['repeatHeader', 'skipFirstHeader', 'repeatFooter', 'skipLastFooter'], 'headersFooters');
    if (hf) {
        if (has(hf.repeatHeader)) lines.push(`t.breakHeaders = HeaderFooterBreakTypes.${BREAKS[enumOf(hf.repeatHeader, Object.keys(BREAKS), { name: 'headersFooters.repeatHeader' })]};`);
        if (has(hf.skipFirstHeader)) lines.push(`t.skipFirstHeader = ${flag(hf.skipFirstHeader, 'headersFooters.skipFirstHeader')};`);
        if (has(hf.repeatFooter)) lines.push(`t.breakFooters = HeaderFooterBreakTypes.${BREAKS[enumOf(hf.repeatFooter, Object.keys(BREAKS), { name: 'headersFooters.repeatFooter' })]};`);
        if (has(hf.skipLastFooter)) lines.push(`t.skipLastFooter = ${flag(hf.skipLastFooter, 'headersFooters.skipLastFooter')};`);
    }
    if (!lines.length) throw new Error('Nothing to change: give setup, rowStrokes, columnStrokes, fills or headersFooters');
    return lines;
}

// -------------------------------------------------------------- Cell Options

const EDGES = {
    top: 'topEdgeStroke', bottom: 'bottomEdgeStroke', left: 'leftEdgeStroke', right: 'rightEdgeStroke',
    inner_rows: 'innerRowStroke', inner_columns: 'innerColumnStroke',
};
const EDGE_SETS = { all: Object.keys(EDGES), border: ['top', 'bottom', 'left', 'right'], inner: ['inner_rows', 'inner_columns'] };
const VJ = { top: 'TOP_ALIGN', center: 'CENTER_ALIGN', bottom: 'BOTTOM_ALIGN', justify: 'JUSTIFY_ALIGN' };
const FIRST_BASELINE = { ascent: 'ASCENT_OFFSET', cap_height: 'CAP_HEIGHT', leading: 'LEADING_OFFSET', x_height: 'X_HEIGHT', em_box: 'EMBOX_HEIGHT', fixed: 'FIXED_HEIGHT' };
const START_ROW = { anywhere: 'ANYWHERE', next_column: 'NEXT_COLUMN', next_frame: 'NEXT_FRAME', next_page: 'NEXT_PAGE', next_odd_page: 'NEXT_ODD_PAGE', next_even_page: 'NEXT_EVEN_PAGE' };
const DIAGONALS = { none: [false, false], top_left: [true, false], top_right: [false, true], both: [true, true] };

function insetLines(obj, v, name, prefix) {
    const g = group(v, ['top', 'bottom', 'left', 'right'], name);
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    return Object.keys(g).map((k) => `${obj}.${prefix ? `${prefix}${cap(k)}` : k}Inset = ${mm(g[k], `${name}.${k}`, { max: 1000 })};`);
}

/** Row height lines for the row `row` (inside the loop over the chosen rows). */
function rowLines(g, name) {
    const lines = [];
    const mode = has(g.mode) ? enumOf(g.mode, ['at_least', 'exactly'], { name: `${name}.mode` }) : null;
    if (has(g.height) && has(g.maximum) && Number(g.maximum) < Number(g.height)) throw new Error(`'${name}.maximum' is below '${name}.height'`);
    if (has(g.maximum)) lines.push(`row.maximumHeight = ${mm(g.maximum, `${name}.maximum`)};`);
    if (mode === 'at_least') lines.push('row.autoGrow = true;');
    if (mode === 'exactly') lines.push('row.autoGrow = false;');
    if (has(g.height)) {
        const h = mm(g.height, `${name}.height`);
        if (mode === 'at_least') lines.push(`row.minimumHeight = ${h};`);
        else if (mode === 'exactly') lines.push(`row.height = ${h};`);
        else lines.push(`if (row.autoGrow) row.minimumHeight = ${h}; else row.height = ${h};`);
    }
    if (has(g.startRow)) lines.push(`row.startRow = StartParagraph.${START_ROW[enumOf(g.startRow, Object.keys(START_ROW), { name: `${name}.startRow` })]};`);
    if (has(g.keepWithNext)) lines.push(`row.keepWithNextRow = ${flag(g.keepWithNext, `${name}.keepWithNext`)};`);
    return lines;
}

function cellOptionLines(a) {
    const cell = [];
    const perText = [];
    let rows = [];
    let cols = [];
    const tx = group(a.text, ['insets', 'verticalJustification', 'paragraphSpacingLimit', 'firstBaseline', 'firstBaselineMinimum', 'clipContents', 'rotation', 'writingDirection', 'paragraphStyle', 'characterStyle', 'pointSize', 'alignment'], 'text');
    if (tx) {
        if (has(tx.insets)) cell.push(...insetLines('c', tx.insets, 'text.insets'));
        if (has(tx.verticalJustification)) cell.push(`c.verticalJustification = VerticalJustification.${VJ[enumOf(tx.verticalJustification, Object.keys(VJ), { name: 'text.verticalJustification' })]};`);
        if (has(tx.paragraphSpacingLimit)) cell.push(`c.paragraphSpacingLimit = ${mm(tx.paragraphSpacingLimit, 'text.paragraphSpacingLimit', { max: 1000 })};`);
        if (has(tx.firstBaseline)) cell.push(`c.firstBaselineOffset = FirstBaseline.${FIRST_BASELINE[enumOf(tx.firstBaseline, Object.keys(FIRST_BASELINE), { name: 'text.firstBaseline' })]};`);
        if (has(tx.firstBaselineMinimum)) cell.push(`c.minimumFirstBaselineOffset = ${mm(tx.firstBaselineMinimum, 'text.firstBaselineMinimum', { max: 1000 })};`);
        if (has(tx.clipContents)) cell.push(`c.clipContentToTextCell = ${flag(tx.clipContents, 'text.clipContents')};`);
        if (has(tx.rotation)) cell.push(`c.rotationAngle = ${enumOf(tx.rotation, ['0', '90', '180', '270'], { name: 'text.rotation' })};`);
        if (has(tx.writingDirection)) cell.push(`c.writingDirection = HorizontalOrVertical.${enumOf(tx.writingDirection, ['horizontal', 'vertical'], { name: 'text.writingDirection' }).toUpperCase()};`);
        if (has(tx.paragraphStyle)) perText.push(`tx.appliedParagraphStyle = __named(doc.allParagraphStyles, ${text(tx.paragraphStyle, 'text.paragraphStyle')}, "paragraph");`);
        if (has(tx.characterStyle)) perText.push(`tx.appliedCharacterStyle = __named(doc.allCharacterStyles, ${text(tx.characterStyle, 'text.characterStyle')}, "character");`);
        if (has(tx.pointSize)) perText.push(`tx.pointSize = "${num(tx.pointSize, { min: 0.1, max: 1296, name: 'text.pointSize' })}pt";`);
        if (has(tx.alignment)) perText.push(`tx.justification = Justification.${enumOf(tx.alignment, ALLOWED.alignment, { name: 'text.alignment' })};`);
    }
    const gr = group(a.graphic, ['insets', 'clipContents'], 'graphic');
    if (gr) {
        if (has(gr.insets)) cell.push(...insetLines('c', gr.insets, 'graphic.insets', 'graphic'));
        if (has(gr.clipContents)) cell.push(`c.clipContentToGraphicCell = ${flag(gr.clipContents, 'graphic.clipContents')};`);
    }
    const st = group(a.strokes, ['edges', ...STROKE_KEYS], 'strokes');
    if (st) {
        const raw = st.edges ?? ['all'];
        if (!Array.isArray(raw) || !raw.length) throw new Error("'strokes.edges' must be a non-empty list");
        const edges = new Set();
        for (const e of raw) {
            const v = enumOf(e, [...Object.keys(EDGES), ...Object.keys(EDGE_SETS)], { name: 'strokes.edges' });
            for (const x of EDGE_SETS[v] ?? [v]) edges.add(x);
        }
        const s = { ...st };
        delete s.edges;
        const sl = strokeLines('c', [...edges].map((e) => EDGES[e]), s, 'strokes');
        if (!sl.length) throw new Error('strokes: give weight, type, color, tint, gapColor, gapTint, overprint or gapOverprint');
        cell.push(...sl);
    }
    const fill = group(a.fill, ['color', 'tint', 'overprint'], 'fill');
    if (fill) {
        if (has(fill.color)) cell.push(`c.fillColor = __swatch(doc, ${colorSpec(fill.color, 'fill.color')});`);
        if (has(fill.tint)) cell.push(`c.fillTint = ${num(fill.tint, { min: 0, max: 100, name: 'fill.tint' })};`);
        if (has(fill.overprint)) cell.push(`c.overprintFill = ${flag(fill.overprint, 'fill.overprint')};`);
    }
    const dg = group(a.diagonal, ['lines', 'inFront', ...STROKE_KEYS], 'diagonal');
    if (dg) {
        if (has(dg.lines)) {
            const [tl, tr] = DIAGONALS[enumOf(dg.lines, Object.keys(DIAGONALS), { name: 'diagonal.lines' })];
            cell.push(`c.topLeftDiagonalLine = ${bool(tl)};`, `c.topRightDiagonalLine = ${bool(tr)};`);
        }
        if (has(dg.inFront)) cell.push(`c.diagonalLineInFront = ${flag(dg.inFront, 'diagonal.inFront')};`);
        const s = { ...dg };
        delete s.lines;
        delete s.inFront;
        cell.push(...strokeLines('c', ['diagonalLineStroke'], s, 'diagonal'));
    }
    const rg = group(a.rows, ['height', 'mode', 'maximum', 'startRow', 'keepWithNext'], 'rows');
    if (rg) rows = rowLines(rg, 'rows');
    const cg = group(a.columns, ['width'], 'columns');
    if (cg && has(cg.width)) cols = [`t.columns[j].width = ${mm(cg.width, 'columns.width', { min: 0.5 })};`];
    if (!cell.length && !perText.length && !rows.length && !cols.length) {
        throw new Error('Nothing to change: give text, graphic, strokes, fill, diagonal, rows or columns');
    }
    return { cell, perText, rows, cols };
}

// --------------------------------------------------------- structure edits

const EDIT_OPS = ['merge', 'unmerge', 'split_horizontally', 'split_vertically', 'to_graphic_cells', 'to_text_cells', 'to_header_rows', 'to_body_rows', 'to_footer_rows'];

const EDIT_JSX = {
    merge: `
if (cr.r1 === cr.r2 && cr.c1 === cr.c2) throw new Error("Choose more than one cell to merge");
var els = cr.range.getElements();
var merged = els[0].merge(els[els.length - 1]);
out.changed = 1;
out.cell = merged.name;`,
    unmerge: `
var els = cr.range.getElements();
for (var i = els.length - 1; i >= 0; i--) {
  if (els[i].rowSpan > 1 || els[i].columnSpan > 1) { els[i].unmerge(); out.changed++; }
}`,
    split_horizontally: `
var els = cr.range.getElements();
for (var i = els.length - 1; i >= 0; i--) { els[i].split(HorizontalOrVertical.HORIZONTAL); out.changed++; }`,
    split_vertically: `
var els = cr.range.getElements();
for (var i = els.length - 1; i >= 0; i--) { els[i].split(HorizontalOrVertical.VERTICAL); out.changed++; }`,
    to_graphic_cells: `
var els = cr.range.getElements();
for (var i = 0; i < els.length; i++) {
  if (els[i].cellType !== CellTypeEnum.GRAPHIC_TYPE_CELL) { els[i].convertCellType(CellTypeEnum.GRAPHIC_TYPE_CELL, KEEP); out.changed++; }
}`,
    to_text_cells: `
var els = cr.range.getElements();
for (var i = 0; i < els.length; i++) {
  if (els[i].cellType !== CellTypeEnum.TEXT_TYPE_CELL) { els[i].convertCellType(CellTypeEnum.TEXT_TYPE_CELL, KEEP); out.changed++; }
}`,
    to_header_rows: `
for (var i = cr.r1; i <= cr.r2; i++) {
  if (t.rows[i].rowType !== RowTypes.HEADER_ROW) { t.rows[i].rowType = RowTypes.HEADER_ROW; out.changed++; }
}`,
    to_footer_rows: `
for (var i = cr.r2; i >= cr.r1; i--) {
  if (t.rows[i].rowType !== RowTypes.FOOTER_ROW) { t.rows[i].rowType = RowTypes.FOOTER_ROW; out.changed++; }
}`,
    to_body_rows: `
for (var i = cr.r2; i >= cr.r1; i--) {
  if (t.rows[i].rowType === RowTypes.HEADER_ROW) { t.rows[i].rowType = RowTypes.BODY_ROW; out.changed++; }
}
for (var j = cr.r1; j <= cr.r2; j++) {
  if (t.rows[j].rowType === RowTypes.FOOTER_ROW) { t.rows[j].rowType = RowTypes.BODY_ROW; out.changed++; }
}`,
};

const COMMANDS = {
    next_cell: 66856, previous_cell: 66857,
    first_cell_in_column: 66847, last_cell_in_column: 66848, first_cell_in_row: 66849, last_cell_in_row: 66850,
    first_row_in_frame: 66851, last_row_in_frame: 66852,
    move_up: 66859, move_down: 66858, move_left: 66860, move_right: 66861,
    extend_selection_up: 66863, extend_selection_down: 66862, extend_selection_left: 66864, extend_selection_right: 66865,
    toggle_cell_text_selection: 66855,
    edit_header: 66853, edit_footer: 66854,
    proxy_select_border: 66909, proxy_select_inner: 66910, proxy_select_all: 66911,
    proxy_clear_border: 66912, proxy_clear_inner: 66913, proxy_clear_all: 66914,
};

const SEPARATORS = { tab: '\t', comma: ',', paragraph: '\r', semicolon: ';', space: ' ' };

/** A separator name (tab, comma, paragraph, semicolon, space) or one other character. */
function separator(v, name, fallback) {
    const s = String(v ?? fallback);
    if (s in SEPARATORS) return SEPARATORS[s];
    if ([...s].length !== 1) throw new Error(`'${name}' must be tab, comma, paragraph, semicolon, space, or a single character`);
    return s;
}

const SEPARATOR_SCHEMA = (d, def) => ({ type: 'string', description: `${d}: tab, comma, paragraph, semicolon, space, or any single character`, default: def });

const FORMATTING = { formatted_table: 'EXCEL_FORMATTED_TABLE', unformatted_table: 'EXCEL_UNFORMATTED_TABLE', unformatted_tabbed_text: 'EXCEL_UNFORMATTED_TABBED_TEXT', format_only_once: 'EXCEL_FORMAT_ONLY_ONCE' };
const CELL_ALIGN = { spreadsheet: 'SPREADSHEET', left: 'LEFT_ALIGN', center: 'CENTER_ALIGN', right: 'RIGHT_ALIGN' };

// ------------------------------------------------------------------- tools

export const tools = [
    {
        name: 'get_table_info',
        description: 'List the tables in the document with their story id, index, frame and size, or describe one table: its rows (type, height, Exactly/At Least), column widths, merged cells, graphic cells, cells holding nested tables, and overset cells (Table panel; the red overset dot in a cell)',
        inputSchema: {
            type: 'object',
            properties: {
                table: { ...TABLE_SCHEMA, description: `Optional: the table to describe in detail; omit to list every table. ${TABLE_SCHEMA.description}` },
            },
        },
        features: ['indesign.tables.row', 'indesign.tables.column', 'indesign.tables.overset_cells'],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { table: { storyId: 1, index: 0, nested: [{ row: 1, column: 0, index: 0 }] } },
        handler: (a) => {
            if (!has(a.table)) {
                return run('Get table info', script(`${TABLE_JSX}
var out = [];
for (var s = 0; s < doc.stories.length; s++) {
  var st = doc.stories[s];
  for (var k = 0; k < st.tables.length; k++) out.push(__tableInfo(st.tables[k]));
}
__result__ = { count: out.length, tables: out };`));
            }
            return run('Get table info', script(`${TABLE_JSX}
var t = __table(doc, ${tableSpec(a.table)});
var info = { table: __tableInfo(t), rowList: [], columnList: [], merged: [], overset: [], graphicCells: [], nestedTables: [] }, i;
for (i = 0; i < t.rows.length; i++) {
  var r = t.rows[i];
  info.rowList.push({ index: i, type: __enumName(r.rowType), height: r.height, sizing: r.autoGrow ? "at_least" : "exactly",
    minimumHeight: r.minimumHeight, maximumHeight: r.maximumHeight, keepWithNext: r.keepWithNextRow, startRow: __enumName(r.startRow) });
}
for (i = 0; i < t.columns.length; i++) info.columnList.push({ index: i, width: t.columns[i].width });
for (i = 0; i < t.cells.length; i++) {
  var c = t.cells[i], at = c.name.split(":"), where = { row: Number(at[1]), column: Number(at[0]) };
  if (c.rowSpan > 1 || c.columnSpan > 1) info.merged.push({ row: where.row, column: where.column, rowSpan: c.rowSpan, columnSpan: c.columnSpan });
  if (c.overflows) info.overset.push(where);
  if (c.cellType === CellTypeEnum.GRAPHIC_TYPE_CELL) info.graphicCells.push(where);
  else if (c.tables.length) info.nestedTables.push({ row: where.row, column: where.column, count: c.tables.length });
}
__result__ = info;`));
        },
    },
    {
        name: 'set_table_options',
        description: 'Set Table Options (Table > Table Options): row, column, header and footer counts, the table border, space before and after, stroke drawing order, table direction and alignment in the frame; alternating row and column strokes; alternating fills; and repeating headers and footers, which control how a long table breaks across columns, frames and pages',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                setup: {
                    type: 'object',
                    description: 'Table Setup tab',
                    properties: {
                        headerRows: COUNT('Number of header rows'),
                        bodyRows: { type: 'integer', minimum: 1, description: 'Number of body rows' },
                        footerRows: COUNT('Number of footer rows'),
                        columns: { type: 'integer', minimum: 1, description: 'Number of columns' },
                        border: stroke('Table Border, applied to all four sides'),
                        spaceBefore: { type: 'number', minimum: 0, description: 'Table Spacing: space before the table in mm' },
                        spaceAfter: { type: 'number', minimum: 0, description: 'Table Spacing: space after the table in mm' },
                        strokeDrawingOrder: { type: 'string', enum: Object.keys(STROKE_ORDER), description: 'Stroke Drawing Order: which strokes are drawn on top where row and column strokes meet' },
                        direction: { type: 'string', enum: Object.keys(DIRECTIONS), description: 'Table Direction' },
                        alignment: { type: 'string', enum: TABLE_ALIGN, description: 'Table alignment in its frame (the justification of the paragraph holding the table)' },
                    },
                },
                rowStrokes: {
                    type: 'object',
                    description: 'Row Strokes tab: an alternating pattern of two strokes. first.count and next.count set the pattern (1 and 1 = every other row)',
                    properties: {
                        first: patternStroke('first', 'row'),
                        next: patternStroke('next', 'row'),
                        skipFirst: skip('rows at the start', 'first'),
                        skipLast: skip('rows at the end', 'last'),
                    },
                },
                columnStrokes: {
                    type: 'object',
                    description: 'Column Strokes tab: an alternating pattern of two strokes. first.count and next.count set the pattern',
                    properties: {
                        first: patternStroke('first', 'column'),
                        next: patternStroke('next', 'column'),
                        skipFirst: skip('columns at the start', 'first'),
                        skipLast: skip('columns at the end', 'last'),
                    },
                },
                fills: {
                    type: 'object',
                    description: 'Fills tab: alternating fills by row or by column',
                    properties: {
                        pattern: { type: 'string', enum: Object.keys(FILL_PATTERNS), description: 'Alternating Pattern: none, rows or columns (required with first, next, skipFirst or skipLast)' },
                        first: patternFill('first', 'rows or columns'),
                        next: patternFill('next', 'rows or columns'),
                        skipFirst: skip('rows or columns at the start', 'first'),
                        skipLast: skip('rows or columns at the end', 'last'),
                        columnFillsPriority: { type: 'boolean', description: 'Draw column fills on top of row fills' },
                    },
                },
                headersFooters: {
                    type: 'object',
                    description: 'Headers and Footers tab',
                    properties: {
                        repeatHeader: { type: 'string', enum: Object.keys(BREAKS), description: 'Repeat Header: every text column, once per frame, or once per page' },
                        skipFirstHeader: { type: 'boolean', description: 'Skip First: leave the header off the first part of the table' },
                        repeatFooter: { type: 'string', enum: Object.keys(BREAKS), description: 'Repeat Footer: every text column, once per frame, or once per page' },
                        skipLastFooter: { type: 'boolean', description: 'Skip Last: leave the footer off the last part of the table' },
                    },
                },
            },
            required: ['table'],
        },
        features: [
            'indesign.tables.table_options_dialog',
            'indesign.tables.to_setup_footer_rows',
            'indesign.tables.to_setup_table_border_weight',
            'indesign.tables.to_setup_table_border_type',
            'indesign.tables.to_setup_table_border_color',
            'indesign.tables.to_setup_table_border_gap_color',
            'indesign.tables.to_setup_table_border_overprint',
            'indesign.tables.to_setup_table_spacing_space_before',
            'indesign.tables.to_setup_table_spacing_space_after',
            'indesign.tables.to_setup_stroke_drawing_order',
            'indesign.tables.to_setup_table_direction',
            'indesign.tables.table_alignment',
            'indesign.tables.to_row_strokes_alternating_pattern_row_strokes',
            'indesign.tables.to_row_strokes_first_next_row_stroke_weight',
            'indesign.tables.to_row_strokes_first_next_row_stroke_type',
            'indesign.tables.to_row_strokes_first_next_row_stroke_color',
            'indesign.tables.to_row_strokes_row_stroke_gap_color',
            'indesign.tables.to_row_strokes_row_stroke_overprint',
            'indesign.tables.to_row_strokes_skip_first_skip_last_row_strokes',
            'indesign.tables.to_col_strokes_alternating_pattern_column_strokes',
            'indesign.tables.to_col_strokes_first_next_column_stroke_weight',
            'indesign.tables.to_col_strokes_first_next_column_stroke_type',
            'indesign.tables.to_col_strokes_first_next_column_stroke_color',
            'indesign.tables.to_col_strokes_skip_first_skip_last_column_strokes',
            'indesign.tables.to_fills_alternating_pattern_fills',
            'indesign.tables.to_fills_first_fill',
            'indesign.tables.to_fills_next_fill',
            'indesign.tables.to_fills_fill_overprint',
            'indesign.tables.to_fills_skip_first_skip_last_fills',
            'indesign.tables.to_fills_column_fill_priority',
            'indesign.tables.to_headers_repeat_header',
            'indesign.tables.to_headers_skip_first_header',
            'indesign.tables.to_headers_repeat_footer',
            'indesign.tables.to_headers_skip_last_footer',
            'indesign.tables.break_tables',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            table: { storyId: 1, index: 0 },
            setup: {
                headerRows: 1, bodyRows: 4, footerRows: 1, columns: 3, spaceBefore: 2, spaceAfter: 2,
                border: { weight: 1, type: 'Solid', color: 'Black', tint: 100, gapColor: 'Paper', gapTint: 100, overprint: false, gapOverprint: false },
                strokeDrawingOrder: 'best_joins', direction: 'left_to_right', alignment: 'CENTER_ALIGN',
            },
            rowStrokes: { first: { count: 1, weight: 1, type: 'Solid', color: 'Black', gapColor: 'Paper', overprint: false }, next: { count: 1, weight: 0.5, type: 'Dashed', color: '#808080', gapColor: 'Paper', overprint: false }, skipFirst: 1, skipLast: 0 },
            columnStrokes: { first: { count: 1, weight: 1, type: 'Solid', color: 'Black', gapColor: 'Paper' }, next: { count: 1, weight: 0.5, type: 'Dotted', color: 'Black', gapColor: 'Paper' }, skipFirst: 0, skipLast: 0 },
            fills: { pattern: 'rows', first: { count: 1, color: '#EEEEEE', tint: 100, overprint: false }, next: { count: 1, color: 'Paper', tint: 100, overprint: false }, skipFirst: 1, skipLast: 0, columnFillsPriority: false },
            headersFooters: { repeatHeader: 'every_text_column', skipFirstHeader: false, repeatFooter: 'once_per_page', skipLastFooter: true },
        },
        handler: (a) => {
            const lines = tableOptionLines(a);
            return run('Set table options', script(`${TABLE_JSX}${STYLE_JSX}
var t = __table(doc, ${tableSpec(a.table)});
${lines.join('\n')}
__result__ = { table: __tableInfo(t), changed: ${lines.length} };`));
        },
    },
    {
        name: 'set_cell_options',
        description: 'Set Cell Options (Table > Cell Options) on a block of cells: text insets, vertical justification, paragraph spacing limit, first baseline, clipping, text rotation and writing direction, plus paragraph and character styles, size and alignment of the cell text; graphic cell insets and clipping; strokes on chosen edges and the fill; row height (Exactly or At Least, with a maximum), start row and keep with next; column width; and diagonal lines. Also the sizing and alignment controls of the Table panel',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
                text: {
                    type: 'object',
                    description: 'Text tab, and formatting of the cell text',
                    properties: {
                        insets: INSETS('Cell Insets'),
                        verticalJustification: { type: 'string', enum: Object.keys(VJ), description: 'Vertical Justification' },
                        paragraphSpacingLimit: { type: 'number', minimum: 0, description: 'Paragraph Spacing Limit in mm (with justify)' },
                        firstBaseline: { type: 'string', enum: Object.keys(FIRST_BASELINE), description: 'First Baseline Offset' },
                        firstBaselineMinimum: { type: 'number', minimum: 0, description: 'First Baseline minimum in mm' },
                        clipContents: { type: 'boolean', description: 'Clip Contents to Cell' },
                        rotation: { type: 'string', enum: ['0', '90', '180', '270'], description: 'Text Rotation in degrees' },
                        writingDirection: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Writing direction of the cell text' },
                        paragraphStyle: { type: 'string', description: 'Paragraph style to apply to the cell text' },
                        characterStyle: { type: 'string', description: 'Character style to apply to the cell text' },
                        pointSize: { type: 'number', minimum: 0.1, description: 'Text size in points' },
                        alignment: { type: 'string', enum: ALLOWED.alignment, description: 'Paragraph alignment of the cell text' },
                    },
                },
                graphic: {
                    type: 'object',
                    description: 'Graphic tab (graphic cells)',
                    properties: {
                        insets: INSETS('Graphic Cell Insets'),
                        clipContents: { type: 'boolean', description: 'Clip Content to Graphic Cell' },
                    },
                },
                strokes: stroke('Strokes and Fills tab: the cell stroke on the chosen edges', {
                    edges: {
                        type: 'array',
                        items: { type: 'string', enum: [...Object.keys(EDGES), ...Object.keys(EDGE_SETS)] },
                        description: 'Edges of the chosen block of cells, as in the proxy: top, bottom, left, right, inner_rows, inner_columns, or border, inner, all (default all)',
                    },
                }),
                fill: {
                    type: 'object',
                    description: 'Cell Fill',
                    properties: {
                        color: COLOR_SCHEMA,
                        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Fill tint in percent' },
                        overprint: { type: 'boolean', description: 'Overprint the fill' },
                    },
                },
                rows: {
                    type: 'object',
                    description: 'Rows and Columns tab: applies to every row the cells span',
                    properties: {
                        height: { type: 'number', minimum: 0, description: 'Row Height in mm' },
                        mode: { type: 'string', enum: ['at_least', 'exactly'], description: 'At Least (the row grows with its content) or Exactly' },
                        maximum: { type: 'number', minimum: 0, description: 'Maximum height in mm for At Least rows' },
                        startRow: { type: 'string', enum: Object.keys(START_ROW), description: 'Start Row: where the row begins when the table breaks' },
                        keepWithNext: { type: 'boolean', description: 'Keep with Next Row' },
                    },
                },
                columns: {
                    type: 'object',
                    description: 'Rows and Columns tab: applies to every column the cells span',
                    properties: { width: { type: 'number', minimum: 0.5, description: 'Column Width in mm' } },
                },
                diagonal: stroke('Diagonal Lines tab', {
                    lines: { type: 'string', enum: Object.keys(DIAGONALS), description: 'Which diagonal lines to draw' },
                    inFront: { type: 'boolean', description: 'Draw the line in front of the cell content (false: behind it)' },
                }),
            },
        },
        features: [
            'indesign.tables.cell_options_dialog',
            'indesign.tables.table_panel',
            'indesign.tables.format_text_in_tables',
            'indesign.tables.cell_text_rotation',
            'indesign.tables.row_height_exactly_at_least',
            'indesign.tables.autogrow_toggle',
            'indesign.tables.keep_with_next_row',
            'indesign.tables.start_row',
            'indesign.tables.co_text_cell_insets',
            'indesign.tables.co_text_vertical_justification_cell',
            'indesign.tables.co_text_paragraph_spacing_limit_cell',
            'indesign.tables.co_text_first_baseline_offset_cell',
            'indesign.tables.co_text_clip_contents_to_cell',
            'indesign.tables.co_text_text_rotation_cell',
            'indesign.tables.co_text_writing_direction_cell',
            'indesign.tables.co_graphic_graphic_cell_insets',
            'indesign.tables.co_graphic_clip_content_to_graphic_cell',
            'indesign.tables.co_strokes_cell_stroke_weight',
            'indesign.tables.co_strokes_cell_stroke_type',
            'indesign.tables.co_strokes_cell_stroke_color',
            'indesign.tables.co_strokes_cell_stroke_gap',
            'indesign.tables.co_strokes_cell_stroke_overprint',
            'indesign.tables.co_strokes_cell_fill',
            'indesign.tables.co_rows_row_height_cell_options',
            'indesign.tables.co_rows_maximum_row_height',
            'indesign.tables.co_rows_column_width_cell_options',
            'indesign.tables.co_rows_start_row_cell_options',
            'indesign.tables.co_rows_keep_with_next_row_cell_options',
            'indesign.tables.co_diagonal_diagonal_line_direction',
            'indesign.tables.co_diagonal_diagonal_line_weight',
            'indesign.tables.co_diagonal_diagonal_line_type',
            'indesign.tables.co_diagonal_diagonal_line_color',
            'indesign.tables.co_diagonal_diagonal_gap',
            'indesign.tables.co_diagonal_diagonal_overprint',
            'indesign.tables.co_diagonal_draw_in_front_behind_content',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            table: { frameId: 10, index: 0 },
            cells: { rows: [0, 2], columns: [1, 2] },
            text: {
                insets: { top: 1, bottom: 1, left: 1.5, right: 1.5 }, verticalJustification: 'center', paragraphSpacingLimit: 5,
                firstBaseline: 'cap_height', firstBaselineMinimum: 0, clipContents: true, rotation: '90', writingDirection: 'horizontal',
                paragraphStyle: 'Table Body', characterStyle: 'Bold', pointSize: 9, alignment: 'CENTER_ALIGN',
            },
            graphic: { insets: { top: 1, bottom: 1, left: 1, right: 1 }, clipContents: true },
            strokes: { edges: ['border', 'inner_rows'], weight: 0.5, type: 'Solid', color: 'Black', tint: 100, gapColor: 'Paper', gapTint: 100, overprint: false, gapOverprint: false },
            fill: { color: '#F0F0F0', tint: 50, overprint: false },
            rows: { height: 8, mode: 'at_least', maximum: 50, startRow: 'next_frame', keepWithNext: true },
            columns: { width: 30 },
            diagonal: { lines: 'top_left', inFront: false, weight: 0.5, type: 'Solid', color: 'Black', tint: 100, gapColor: 'Paper', gapTint: 100, overprint: false, gapOverprint: false },
        },
        handler: (a) => {
            const [tLit, cLit] = tableAndCells(a);
            const { cell, perText, rows, cols } = cellOptionLines(a);
            const textLoop = perText.length ? `
var __cs = c.getElements();
for (var k = 0; k < __cs.length; k++) {
  if (__cs[k].cellType === CellTypeEnum.GRAPHIC_TYPE_CELL) continue;
  var tx = __cs[k].texts[0];
  ${perText.join('\n  ')}
}` : '';
            const rowLoop = rows.length ? `
for (var i = cr.r1; i <= cr.r2; i++) {
  var row = t.rows[i];
  ${rows.join('\n  ')}
}` : '';
            const colLoop = cols.length ? `
for (var j = cr.c1; j <= cr.c2; j++) { ${cols.join(' ')} }` : '';
            return run('Set cell options', script(`${TABLE_JSX}${CELLS_JSX}${STYLE_JSX}
var t = __table(doc, ${tLit}), cr = __cells(t, ${cLit}), c = cr.range;
${cell.join('\n')}${textLoop}${rowLoop}${colLoop}
__result__ = { table: __tableInfo(t), rows: [cr.r1, cr.r2], columns: [cr.c1, cr.c2] };`));
        },
    },
    {
        name: 'insert_table',
        description: 'Insert a new table at a point in existing text (Table > Insert Table), or inside a cell of another table to nest it. To make a table in a new frame, use create_table',
        inputSchema: {
            type: 'object',
            properties: {
                at: TEXT_LOCATION_SCHEMA,
                inCell: {
                    type: 'object',
                    description: 'Nest the new table in this cell, after the cell\'s text (instead of at)',
                    properties: {
                        table: TABLE_SCHEMA,
                        row: { ...ROW_COL_INDEX, description: 'Row of the cell' },
                        column: { ...ROW_COL_INDEX, description: 'Column of the cell' },
                    },
                },
                bodyRows: { type: 'integer', minimum: 1, description: 'Body rows', default: 3 },
                columns: { type: 'integer', minimum: 1, description: 'Columns', default: 3 },
                headerRows: { type: 'integer', minimum: 0, description: 'Header rows', default: 0 },
                footerRows: { type: 'integer', minimum: 0, description: 'Footer rows', default: 0 },
                width: { type: 'number', minimum: 1, description: 'Table width in mm (default: InDesign\'s, the width of the frame or cell)' },
            },
        },
        features: ['indesign.tables.insert_table', 'indesign.tables.nested_table'],
        hints: { readOnly: false },
        auditArgs: { at: { storyId: 5, characterIndex: 0 }, inCell: undefined, width: 120 },
        handler: (a) => {
            if (has(a.at) === has(a.inCell)) throw new Error('Give at (a place in text) or inCell (a cell to nest the table in), not both');
            const sizes = [
                `nt.columnCount = ${index(a.columns ?? 3, { name: 'columns', max: 200 })};`,
                `nt.bodyRowCount = ${index(a.bodyRows ?? 3, { name: 'bodyRows', max: 10000 })};`,
                `nt.headerRowCount = ${index(a.headerRows ?? 0, { name: 'headerRows', max: 10000 })};`,
                `nt.footerRowCount = ${index(a.footerRows ?? 0, { name: 'footerRows', max: 10000 })};`,
            ];
            if (Number(a.columns ?? 3) < 1 || Number(a.bodyRows ?? 3) < 1) throw new Error('columns and bodyRows must be at least 1');
            if (has(a.width)) sizes.push(`nt.width = ${mm(a.width, 'width', { min: 1 })};`);
            let where;
            let helpers;
            if (has(a.at)) {
                where = `var ip = __textAt(doc, ${textAtSpec(a.at)});`;
                helpers = TEXT_AT_JSX;
            } else {
                const g = group(a.inCell, ['table', 'row', 'column'], 'inCell');
                if (!has(g.row) || !has(g.column)) throw new Error('inCell needs row and column');
                where = `var host = __table(doc, ${tableSpec(g.table, 'inCell.table')});
var hc = host.cells.itemByName(${index(g.column, { name: 'inCell.column' })} + ":" + ${index(g.row, { name: 'inCell.row' })});
if (!hc.isValid) throw new Error("No cell at that row and column (it may be covered by a merged cell)");
if (hc.cellType === CellTypeEnum.GRAPHIC_TYPE_CELL) throw new Error("That cell is a graphic cell; convert it to a text cell first");
var ip = hc.insertionPoints[-1];`;
                helpers = '';
            }
            return run('Insert table', script(`${TABLE_JSX}${helpers}
${where}
var nt = ip.tables.add();
${sizes.join('\n')}
__result__ = { table: __tableInfo(nt) };`));
        },
    },
    {
        name: 'insert_table_rows_columns',
        description: 'Insert rows or columns before or after a row or column of a table (Table > Insert > Row / Column; also what dragging a table edge with the modifier key does)',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                kind: { type: 'string', enum: ['rows', 'columns'], description: 'Insert rows or columns' },
                count: { type: 'integer', minimum: 1, maximum: 1000, description: 'How many to insert', default: 1 },
                reference: { type: 'integer', minimum: 0, description: 'The row or column to insert next to (0-based; default: the last one)' },
                position: { type: 'string', enum: ['after', 'before'], description: 'Below/right of the reference (after) or above/left of it (before)', default: 'after' },
                size: { type: 'number', minimum: 0.5, description: 'Height of each new row or width of each new column in mm (default: like the reference)' },
            },
            required: ['table', 'kind'],
        },
        features: ['indesign.tables.insert_row', 'indesign.tables.insert_column', 'indesign.tables.insert_while_dragging'],
        hints: { readOnly: false },
        auditArgs: { table: { pageIndex: 0, index: 0 }, reference: 1, size: 10 },
        handler: (a) => {
            const kind = enumOf(a.kind, ['rows', 'columns'], { name: 'kind' });
            const position = enumOf(a.position ?? 'after', ['after', 'before'], { name: 'position' });
            const count = index(a.count ?? 1, { name: 'count', max: 1000 });
            if (Number(count) < 1) throw new Error("'count' must be at least 1");
            const ref = has(a.reference) ? index(a.reference, { name: 'reference' }) : null;
            const sizeProp = kind === 'rows' ? 'height' : 'width';
            const size = has(a.size) ? `added.${sizeProp} = ${mm(a.size, 'size', { min: 0.5 })};` : '';
            return run('Insert table rows or columns', script(`${TABLE_JSX}
var t = __table(doc, ${tableSpec(a.table)}), list = t.${kind};
var refIndex = ${ref ?? 'list.length - 1'};
if (refIndex >= list.length) throw new Error("reference " + refIndex + " is out of range: the table has " + list.length + " ${kind}");
var ref = list[refIndex];
for (var i = 0; i < ${count}; i++) {
  var added = list.add(LocationOptions.${position.toUpperCase()}, ref);
  ${size}
}
__result__ = { table: __tableInfo(t), inserted: ${count} };`));
        },
    },
    {
        name: 'delete_table_parts',
        description: 'Delete rows, columns or the whole table (Table > Delete > Row / Column / Table)',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                part: { type: 'string', enum: ['rows', 'columns', 'table'], description: 'What to delete: the rows or the columns the cells span, or the table' },
                cells: CELLS_SCHEMA,
            },
            required: ['part'],
        },
        features: ['indesign.tables.delete_row', 'indesign.tables.delete_column', 'indesign.tables.delete_table'],
        hints: { readOnly: false, destructive: true },
        auditArgs: { table: { storyId: 3, index: 1 }, cells: { rows: [1, 2] } },
        handler: (a) => {
            const part = enumOf(a.part, ['rows', 'columns', 'table'], { name: 'part' });
            if (part === 'table') {
                if (has(a.cells)) throw new Error("part 'table' takes no cells");
                return run('Delete table', script(`${TABLE_JSX}
var t = __table(doc, ${tableSpec(a.table)}), info = __tableInfo(t);
t.remove();
__result__ = { deleted: "table", table: info };`));
            }
            if (!has(a.cells)) throw new Error(`Choose the ${part} to delete with cells (rows, columns, region or selection)`);
            const [tLit, cLit] = tableAndCells(a);
            const [lo, hi, list] = part === 'rows' ? ['cr.r1', 'cr.r2', 't.rows'] : ['cr.c1', 'cr.c2', 't.columns'];
            return run('Delete table parts', script(`${TABLE_JSX}${CELLS_JSX}
var t = __table(doc, ${tLit}), cr = __cells(t, ${cLit});
if (${hi} - ${lo} + 1 >= ${list}.length) throw new Error("That would delete every one of the table's ${part}: use part: table");
for (var i = ${hi}; i >= ${lo}; i--) ${list}[i].remove();
__result__ = { deleted: "${part}", from: ${lo}, to: ${hi}, table: __tableInfo(t) };`));
        },
    },
    {
        name: 'edit_table_cells',
        description: 'Merge or unmerge cells, split cells horizontally or vertically, convert cells to graphic or text cells, or convert rows to header, body or footer rows (Table > Merge Cells, Unmerge Cells, Split Cell Horizontally / Vertically, Convert Cell to Graphic Cell / Text Cell, Convert Rows)',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
                operation: { type: 'string', enum: EDIT_OPS, description: 'What to do to the cells (row conversions act on every row the cells span)' },
                keepContents: { type: 'boolean', description: 'For to_graphic_cells and to_text_cells: keep the content where InDesign can', default: true },
            },
            required: ['operation'],
        },
        features: [
            'indesign.tables.merge_cells',
            'indesign.tables.unmerge_cells',
            'indesign.tables.split_cell_horizontally',
            'indesign.tables.split_cell_vertically',
            'indesign.tables.convert_cell_to_graphic',
            'indesign.tables.convert_cell_to_text',
            'indesign.tables.convert_rows',
        ],
        hints: { readOnly: false },
        auditArgs: { table: { storyId: 2, index: 0 }, cells: { rows: [0, 1], columns: [0, 1] } },
        handler: (a) => {
            const op = enumOf(a.operation, EDIT_OPS, { name: 'operation' });
            const keep = has(a.keepContents) ? flag(a.keepContents, 'keepContents') : 'true';
            const [tLit, cLit] = tableAndCells(a);
            return run('Edit table cells', script(`${TABLE_JSX}${CELLS_JSX}
var t = __table(doc, ${tLit}), cr = __cells(t, ${cLit}), out = { operation: "${op}", changed: 0 };
${EDIT_JSX[op].replace(/KEEP/g, keep)}
out.table = __tableInfo(t);
__result__ = out;`));
        },
    },
    {
        name: 'resize_table_rows_columns',
        description: 'Resize rows and columns: set row heights or column widths, keep the table width by taking the change from the neighbouring column (as Shift-dragging a column border does), scale the whole table width or height proportionally, or distribute rows or columns evenly (Table > Distribute Rows Evenly / Distribute Columns Evenly)',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                cells: CELLS_SCHEMA,
                rowHeight: { type: 'number', minimum: 0.5, description: 'New height in mm for every row the cells span (the minimum for At Least rows)' },
                columnWidth: { type: 'number', minimum: 0.5, description: 'New width in mm for every column the cells span' },
                keepTableWidth: { type: 'boolean', description: 'With columnWidth: take the change from the next column (or the previous one at the right edge) so the table keeps its width', default: false },
                tableWidth: { type: 'number', minimum: 1, description: 'Scale every column proportionally to this total width in mm' },
                tableHeight: { type: 'number', minimum: 1, description: 'Scale every row proportionally to this total height in mm' },
                distribute: { type: 'string', enum: ['rows', 'columns', 'both'], description: 'Make the rows and/or columns the cells span equal, keeping their total size' },
            },
        },
        features: ['indesign.tables.resize_rows_columns', 'indesign.tables.distribute_rows_evenly', 'indesign.tables.distribute_columns_evenly'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { table: { selection: true }, cells: { rows: [0, 3], columns: [0, 1] }, rowHeight: 6, columnWidth: 25, keepTableWidth: true, tableWidth: undefined, tableHeight: undefined },
        handler: (a) => {
            const lines = [];
            if (has(a.tableWidth) && has(a.columnWidth)) throw new Error('Give columnWidth or tableWidth, not both');
            if (has(a.tableHeight) && has(a.rowHeight)) throw new Error('Give rowHeight or tableHeight, not both');
            if (has(a.keepTableWidth) && a.keepTableWidth !== false && !has(a.columnWidth)) throw new Error('keepTableWidth goes with columnWidth');
            if (has(a.rowHeight)) {
                const h = mm(a.rowHeight, 'rowHeight', { min: 0.5 });
                lines.push(`for (var i = cr.r1; i <= cr.r2; i++) { var row = t.rows[i]; if (row.autoGrow) row.minimumHeight = ${h}; else row.height = ${h}; }`);
            }
            if (has(a.columnWidth)) {
                const w = mm(a.columnWidth, 'columnWidth', { min: 0.5 });
                if (has(a.keepTableWidth) && flag(a.keepTableWidth, 'keepTableWidth') === 'true') {
                    lines.push(`var before = 0, j;
for (j = cr.c1; j <= cr.c2; j++) before += t.columns[j].width;
var adj = cr.c2 + 1 < t.columns.length ? cr.c2 + 1 : cr.c1 - 1;
if (adj < 0) throw new Error("keepTableWidth needs another column to take up the change");
var nw = t.columns[adj].width - (${w} * (cr.c2 - cr.c1 + 1) - before);
if (nw < 0.5) throw new Error("The neighbouring column would be narrower than 0.5 mm");
for (j = cr.c1; j <= cr.c2; j++) t.columns[j].width = ${w};
t.columns[adj].width = nw;`);
                } else {
                    lines.push(`for (var j = cr.c1; j <= cr.c2; j++) t.columns[j].width = ${w};`);
                }
            }
            if (has(a.tableWidth)) {
                lines.push(`var tw = 0, q;
for (q = 0; q < t.columns.length; q++) tw += t.columns[q].width;
var fw = ${mm(a.tableWidth, 'tableWidth', { min: 1 })} / tw;
for (q = 0; q < t.columns.length; q++) t.columns[q].width = t.columns[q].width * fw;`);
            }
            if (has(a.tableHeight)) {
                lines.push(`var th = 0, p;
for (p = 0; p < t.rows.length; p++) th += t.rows[p].height;
var fh = ${mm(a.tableHeight, 'tableHeight', { min: 1 })} / th;
for (p = 0; p < t.rows.length; p++) { var rr = t.rows[p]; if (rr.autoGrow) rr.minimumHeight = rr.height * fh; else rr.height = rr.height * fh; }`);
            }
            if (has(a.distribute)) {
                const d = enumOf(a.distribute, ['rows', 'columns', 'both'], { name: 'distribute' });
                if (d !== 'columns') {
                    lines.push(`if (cr.r2 <= cr.r1) throw new Error("Choose at least two rows to distribute");
var sh = 0, m;
for (m = cr.r1; m <= cr.r2; m++) sh += t.rows[m].height;
for (m = cr.r1; m <= cr.r2; m++) { var dr = t.rows[m]; if (dr.autoGrow) dr.minimumHeight = sh / (cr.r2 - cr.r1 + 1); else dr.height = sh / (cr.r2 - cr.r1 + 1); }`);
                }
                if (d !== 'rows') {
                    lines.push(`if (cr.c2 <= cr.c1) throw new Error("Choose at least two columns to distribute");
var sw = 0, n;
for (n = cr.c1; n <= cr.c2; n++) sw += t.columns[n].width;
for (n = cr.c1; n <= cr.c2; n++) t.columns[n].width = sw / (cr.c2 - cr.c1 + 1);`);
                }
            }
            if (!lines.length) throw new Error('Nothing to change: give rowHeight, columnWidth, tableWidth, tableHeight or distribute');
            const [tLit, cLit] = tableAndCells(a);
            return run('Resize table rows and columns', script(`${TABLE_JSX}${CELLS_JSX}
var t = __table(doc, ${tLit}), cr = __cells(t, ${cLit});
${lines.join('\n')}
__result__ = { table: __tableInfo(t) };`));
        },
    },
    {
        name: 'convert_text_to_table',
        description: 'Convert delimited text to a table (Table > Convert Text to Table): a whole story, a character range of it, or the selected text',
        inputSchema: {
            type: 'object',
            properties: {
                source: {
                    type: 'object',
                    description: 'The text to convert: a story (by frameId or storyId), optionally a character range of it, or selection: true',
                    properties: {
                        frameId: { type: 'integer', minimum: 0, description: 'Id of a text frame; its story is used' },
                        storyId: { type: 'integer', minimum: 0, description: 'Story id' },
                        start: { type: 'integer', minimum: 0, description: 'First character to convert (default: the start of the story)' },
                        end: { type: 'integer', minimum: 1, description: 'Character index just after the last one to convert (default: the end of the story)' },
                        selection: { type: 'boolean', description: 'Convert the selected text' },
                    },
                },
                columnSeparator: SEPARATOR_SCHEMA('Column Separator', 'tab'),
                rowSeparator: SEPARATOR_SCHEMA('Row Separator', 'paragraph'),
                columns: { type: 'integer', minimum: 1, description: 'Number of columns; needed when the column and row separators are the same' },
                headerRows: { type: 'integer', minimum: 0, description: 'Make this many of the first rows header rows', default: 0 },
            },
            required: ['source'],
        },
        features: ['indesign.tables.convert_text_to_table'],
        hints: { readOnly: false },
        auditArgs: { source: { storyId: 4, start: 0, end: 40 }, columnSeparator: 'tab', rowSeparator: 'paragraph', columns: 3, headerRows: 1 },
        handler: (a) => {
            const g = group(a.source, ['frameId', 'storyId', 'start', 'end', 'selection'], 'source');
            if (!g) throw new Error('Choose the text: source.frameId, source.storyId or source.selection: true');
            const sources = ['frameId', 'storyId'].filter((k) => has(g[k]));
            if (g.selection === true ? (sources.length || has(g.start) || has(g.end)) : sources.length !== 1) {
                throw new Error('source: give one of frameId or storyId (with optional start and end), or selection: true alone');
            }
            const col = separator(a.columnSeparator, 'columnSeparator', 'tab');
            const row = separator(a.rowSeparator, 'rowSeparator', 'paragraph');
            if (col === row && !has(a.columns)) throw new Error('The column and row separators are the same: give columns');
            const colsArg = has(a.columns) ? `, ${index(a.columns, { name: 'columns', max: 200 })}` : '';
            const start = has(g.start) ? Number(index(g.start, { name: 'source.start', max: 1e8 })) : null;
            const end = has(g.end) ? Number(index(g.end, { name: 'source.end', max: 1e8 })) : null;
            if (start !== null && end !== null && end <= start) throw new Error("'source.end' must be after 'source.start'");
            let pick;
            if (g.selection === true) {
                pick = `if (!app.selection.length) throw new Error("Nothing is selected: select the text to convert");
var s = app.selection[0], sn = s.constructor.name, src;
if (sn === "TextFrame") src = s.parentStory.texts[0];
else if (sn === "InsertionPoint" || sn === "Table" || sn === "Cell" || sn === "Row" || sn === "Column") throw new Error("Select the text to convert");
else { try { src = s.texts[0]; } catch (e) { throw new Error("The selection is not text"); } }`;
            } else {
                const story = has(g.frameId)
                    ? `var f = __item(doc, ${id(g.frameId, 'source.frameId')});
if (f.constructor.name !== "TextFrame") throw new Error("Item is a " + f.constructor.name + ", not a text frame");
var st = f.parentStory;`
                    : `var st = doc.stories.itemByID(${id(g.storyId, 'source.storyId')});
if (!st.isValid) throw new Error("Story not found");`;
                pick = `${story}
var n = st.characters.length, a0 = ${start ?? 0}, a1 = ${end ?? 'n'};
if (!n) throw new Error("The story is empty");
if (a1 > n) throw new Error("The range ends past the end of the story (" + n + " characters)");
var src = (a0 === 0 && a1 === n) ? st.texts[0] : st.characters.itemByRange(a0, a1 - 1).texts[0];`;
            }
            const header = has(a.headerRows) && Number(a.headerRows) > 0
                ? `if (${index(a.headerRows, { name: 'headerRows', max: 10000 })} >= nt.rows.length) throw new Error("headerRows must leave at least one body row");
nt.headerRowCount = ${index(a.headerRows, { name: 'headerRows', max: 10000 })};` : '';
            return run('Convert text to table', script(`${TABLE_JSX}
${pick}
var nt = src.convertToTable(${str(col)}, ${str(row)}${colsArg});
${header}
__result__ = { table: __tableInfo(nt) };`));
        },
    },
    {
        name: 'convert_table_to_text',
        description: 'Convert a table back to delimited text (Table > Convert Table to Text); cell formatting other than text formatting is lost',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                columnSeparator: SEPARATOR_SCHEMA('Column Separator', 'tab'),
                rowSeparator: SEPARATOR_SCHEMA('Row Separator', 'paragraph'),
            },
            required: ['table'],
        },
        features: ['indesign.tables.convert_table_to_text'],
        hints: { readOnly: false, destructive: true },
        auditArgs: { table: { storyId: 7, index: 0 }, columnSeparator: 'tab', rowSeparator: 'paragraph' },
        handler: (a) => {
            const col = separator(a.columnSeparator, 'columnSeparator', 'tab');
            const row = separator(a.rowSeparator, 'rowSeparator', 'paragraph');
            return run('Convert table to text', script(`${TABLE_JSX}
var t = __table(doc, ${tableSpec(a.table)}), info = __tableInfo(t);
var tx = t.convertToText(${str(col)}, ${str(row)});
__result__ = { table: info, characters: tx.characters.length, storyId: tx.parentStory.id };`));
        },
    },
    {
        name: 'copy_table_cells',
        description: 'Copy or cut a block of cells with their text formatting into the same or another table: over existing cells, or into new rows or columns inserted before or after a row or column (Edit > Copy / Cut / Paste on table cells, and the Table panel\'s Paste Before / Paste After). Pasting a whole table after another table\'s last row and removing the source combines the two tables',
        inputSchema: {
            type: 'object',
            properties: {
                source: {
                    type: 'object',
                    description: 'The cells to copy',
                    properties: { table: TABLE_SCHEMA, cells: CELLS_SCHEMA },
                },
                target: {
                    type: 'object',
                    description: 'Where to paste',
                    properties: {
                        table: { ...TABLE_SCHEMA, description: `The table to paste into (default: the source table). ${TABLE_SCHEMA.description}` },
                        row: { ...ROW_COL_INDEX, description: 'Top row of the paste; for rows_before / rows_after, the reference row (default: the last row for rows_after, 0 otherwise)' },
                        column: { ...ROW_COL_INDEX, description: 'Left column of the paste; for columns_before / columns_after, the reference column (default: the last column for columns_after, 0 otherwise)' },
                    },
                },
                placement: { type: 'string', enum: ['over', 'rows_before', 'rows_after', 'columns_before', 'columns_after'], description: 'Paste over existing cells, or into new rows or columns before or after the reference row or column', default: 'over' },
                cut: { type: 'boolean', description: 'Clear the source cells after copying (Cut)', default: false },
                removeSourceTable: { type: 'boolean', description: 'Delete the source table afterwards (for combining two tables)', default: false },
            },
            required: ['source'],
        },
        features: ['indesign.tables.cut_copy_paste_table', 'indesign.tables.paste_before_after', 'indesign.tables.combine_tables'],
        hints: { readOnly: false, destructive: true },
        auditArgs: {
            source: { table: { storyId: 2, index: 1 }, cells: {} },
            target: { table: { storyId: 2, index: 0 } },
            placement: 'rows_after', cut: false, removeSourceTable: true,
        },
        handler: (a) => {
            const src = group(a.source, ['table', 'cells'], 'source');
            if (!src) throw new Error('Choose the source cells: source.table and source.cells');
            const placement = enumOf(a.placement ?? 'over', ['over', 'rows_before', 'rows_after', 'columns_before', 'columns_after'], { name: 'placement' });
            const [sLit, cLit] = tableAndCells(src);
            const tg = group(a.target, ['table', 'row', 'column'], 'target') ?? {};
            const tLit = has(tg.table) ? tableSpec(tg.table, 'target.table') : null;
            const row = has(tg.row) ? index(tg.row, { name: 'target.row' }) : null;
            const col = has(tg.column) ? index(tg.column, { name: 'target.column' }) : null;
            const cut = has(a.cut) ? flag(a.cut, 'cut') : 'false';
            const removeSource = has(a.removeSourceTable) ? flag(a.removeSourceTable, 'removeSourceTable') : 'false';
            if (removeSource === 'true' && !tLit) throw new Error('removeSourceTable needs a different target.table');
            const insertRows = placement.startsWith('rows_');
            const insertCols = placement.startsWith('columns_');
            const loc = placement.endsWith('_before') ? 'BEFORE' : 'AFTER';
            return run('Copy table cells', script(`${TABLE_JSX}${CELLS_JSX}
var st = __table(doc, ${sLit}), cr = __cells(st, ${cLit});
var dt = ${tLit ? `__table(doc, ${tLit})` : 'st'}, same = dt.toSpecifier() === st.toSpecifier() || (dt.id === st.id && dt.storyOffset.parentStory.id === st.storyOffset.parentStory.id);
var nr = cr.r2 - cr.r1 + 1, nc = cr.c2 - cr.c1 + 1, i, j;
var dr = ${row ?? (placement === 'rows_after' ? 'dt.rows.length - 1' : '0')}, dc = ${col ?? (placement === 'columns_after' ? 'dt.columns.length - 1' : '0')};
if (dr >= dt.rows.length) throw new Error("target.row " + dr + " is out of range: the target has " + dt.rows.length + " rows");
if (dc >= dt.columns.length) throw new Error("target.column " + dc + " is out of range: the target has " + dt.columns.length + " columns");
${removeSource === 'true' ? 'if (same) throw new Error("removeSourceTable needs a target table other than the source");' : ''}
${insertRows ? `var refRow = dt.rows[dr];
for (i = 0; i < nr; i++) dt.rows.add(LocationOptions.${loc}, refRow);
var top = ${loc === 'AFTER' ? 'dr + 1' : 'dr'};
if (same && top <= cr.r1) { cr.r1 += nr; cr.r2 += nr; }
dr = top; ${col === null ? 'dc = 0;' : ''}` : ''}
${insertCols ? `var refCol = dt.columns[dc];
for (i = 0; i < nc; i++) dt.columns.add(LocationOptions.${loc}, refCol);
var left = ${loc === 'AFTER' ? 'dc + 1' : 'dc'};
if (same && left <= cr.c1) { cr.c1 += nc; cr.c2 += nc; }
dc = left; ${row === null ? 'dr = 0;' : ''}` : ''}
if (dr + nr > dt.rows.length || dc + nc > dt.columns.length) throw new Error("The target has room for " + (dt.rows.length - dr) + " x " + (dt.columns.length - dc) + " cells from there; the source is " + nr + " x " + nc);
if (same && dr <= cr.r2 && cr.r1 <= dr + nr - 1 && dc <= cr.c2 && cr.c1 <= dc + nc - 1) throw new Error("The source and target cells overlap");
var copied = 0, skipped = 0;
for (i = 0; i < nr; i++) {
  for (j = 0; j < nc; j++) {
    var sc = st.cells.itemByName((cr.c1 + j) + ":" + (cr.r1 + i)), tc = dt.cells.itemByName((dc + j) + ":" + (dr + i));
    if (!sc.isValid || !tc.isValid || sc.cellType === CellTypeEnum.GRAPHIC_TYPE_CELL || tc.cellType === CellTypeEnum.GRAPHIC_TYPE_CELL) { skipped++; continue; }
    tc.contents = "";
    if (sc.texts[0].characters.length) sc.texts[0].duplicate(LocationOptions.AT_END, tc);
    copied++;
  }
}
if (${cut}) {
  for (i = 0; i < nr; i++) for (j = 0; j < nc; j++) {
    var cc = st.cells.itemByName((cr.c1 + j) + ":" + (cr.r1 + i));
    if (cc.isValid && cc.cellType !== CellTypeEnum.GRAPHIC_TYPE_CELL) cc.contents = "";
  }
}
var out = { copied: copied, skipped: skipped, at: { row: dr, column: dc } };
if (${removeSource}) { st.remove(); out.sourceRemoved = true; }
out.table = __tableInfo(dt);
__result__ = out;`));
        },
    },
    {
        name: 'select_table_part',
        description: 'Select a table, cells, rows, columns, or the header, body or footer rows (Table > Select > Cell / Row / Column / Table / Header Rows / Body Rows / Footer Rows), and bring the page into view, which with one row is Table > Go to Row',
        inputSchema: {
            type: 'object',
            properties: {
                table: TABLE_SCHEMA,
                part: { type: 'string', enum: ['table', 'cells', 'rows', 'columns', 'header_rows', 'body_rows', 'footer_rows'], description: 'What to select; cells, rows and columns use the cells argument', default: 'cells' },
                cells: CELLS_SCHEMA,
                reveal: { type: 'boolean', description: 'Turn the window to the page where the selection starts', default: true },
            },
            required: ['table'],
        },
        features: [
            'indesign.tables.select_cell',
            'indesign.tables.select_row',
            'indesign.tables.select_column',
            'indesign.tables.select_table',
            'indesign.tables.select_header_body_footer',
            'indesign.tables.go_to_row',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { table: { storyId: 2, index: 0 }, part: 'rows', cells: { rows: [4, 4] } },
        handler: (a) => {
            const part = enumOf(a.part ?? 'cells', ['table', 'cells', 'rows', 'columns', 'header_rows', 'body_rows', 'footer_rows'], { name: 'part' });
            const usesCells = ['cells', 'rows', 'columns'].includes(part);
            if (!usesCells && has(a.cells)) throw new Error(`part '${part}' takes no cells`);
            const region = { header_rows: 'header', body_rows: 'body', footer_rows: 'footer' }[part];
            const [tLit, cLit] = tableAndCells({ table: a.table, cells: region ? { region } : a.cells });
            const reveal = has(a.reveal) ? flag(a.reveal, 'reveal') : 'true';
            const select = {
                table: 't.select();',
                cells: 'cr.range.select();',
                rows: 't.rows.itemByRange(cr.r1, cr.r2).select();',
                columns: 't.columns.itemByRange(cr.c1, cr.c2).select();',
            }[part] ?? 't.rows.itemByRange(cr.r1, cr.r2).select();';
            return run('Select table part', script(`${TABLE_JSX}${CELLS_JSX}
var t = __table(doc, ${tLit}), cr = __cells(t, ${cLit});
${select}
var out = { part: "${part}", rows: [cr.r1, cr.r2], columns: [cr.c1, cr.c2], revealed: false };
if (${reveal}) {
  try {
    var tf = t.rows[cr.r1].cells[0].insertionPoints[0].parentTextFrames;
    if (tf.length) {
      var pg = __pageOf(tf[0]);
      if (pg) { app.activeWindow.activePage = pg; out.revealed = true; out.pageIndex = pg.documentOffset; }
    }
  } catch (e) { out.revealError = e.message; }
}
__result__ = out;`));
        },
    },
    {
        name: 'run_table_command',
        description: 'Run a Table keyboard or panel command on the current selection: move the text cursor between cells, extend a cell selection, toggle between selecting the cell and its text, jump to the original header or footer rows (Table > Edit Header / Edit Footer), or set which lines the stroke proxy selects (Table panel menu > Select / Clear Border, Inner, All). Put the text cursor in a cell first, for example with select_table_part',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(COMMANDS), description: 'The command to run' },
                times: { type: 'integer', minimum: 1, maximum: 100, description: 'How many times to run it (for moving and extending)', default: 1 },
            },
            required: ['command'],
        },
        features: [
            'indesign.tables.table_navigation',
            'indesign.tables.table_select_extend',
            'indesign.tables.toggle_cell_text_selection',
            'indesign.tables.edit_header_footer',
            'indesign.tables.table_menu_select_border',
            'indesign.tables.table_menu_select_inner',
            'indesign.tables.table_menu_select_all',
            'indesign.tables.table_menu_clear_border',
            'indesign.tables.table_menu_clear_inner',
            'indesign.tables.table_menu_clear_all',
        ],
        hints: { readOnly: false },
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(COMMANDS), { name: 'command' });
            const times = index(a.times ?? 1, { name: 'times', max: 100 });
            if (Number(times) < 1) throw new Error("'times' must be at least 1");
            return run('Run table command', script(`
var ma = app.menuActions.itemByID(${COMMANDS[command]});
if (!ma.isValid) throw new Error("This version of InDesign has no ${command} command");
for (var i = 0; i < ${times}; i++) {
  if (!ma.enabled) throw new Error("${command} is not available now: put the text cursor in a table cell or select cells first" + (i ? " (ran " + i + " times)" : ""));
  ma.invoke();
}
var out = { command: "${command}", ran: ${times}, selection: null };
if (app.selection.length) {
  var s = app.selection[0], n = s.constructor.name;
  out.selection = { type: n, row: null, column: null };
  try {
    var c = n === "Cell" ? s : (s.parent.constructor.name === "Cell" ? s.parent : null);
    if (c) { var at = c.name.split(":"); out.selection.row = Number(at[1]); out.selection.column = Number(at[0]); }
  } catch (e) {}
}
__result__ = out;`));
        },
    },
    {
        name: 'place_spreadsheet_table',
        description: 'Place an Excel workbook (.xlsx or .xls) as a table, with the Microsoft Excel Import Options set without the dialog: sheet, cell range, formatted or unformatted table or tabbed text, cell alignment, decimal places, hidden cells, and whether the placed file stays linked for updates. Places at a point in text, or in a new text frame on a page',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path to the .xlsx or .xls file' },
                sheet: { type: 'string', description: 'Sheet name (default: the sheet at sheetIndex)' },
                sheetIndex: { type: 'integer', minimum: 0, description: '0-based sheet index, used when sheet is not given', default: 0 },
                range: { type: 'string', description: 'Cell range such as A1:F20 (default: the used range of the sheet)' },
                formatting: { type: 'string', enum: Object.keys(FORMATTING), description: 'Table: formatted table, unformatted table, unformatted tabbed text, or format only once', default: 'formatted_table' },
                cellAlignment: { type: 'string', enum: Object.keys(CELL_ALIGN), description: 'Cell Alignment: as in the spreadsheet, or left, center, right' },
                decimalPlaces: { type: 'integer', minimum: 0, maximum: 20, description: 'Number of decimal places to keep' },
                includeHiddenCells: { type: 'boolean', description: 'Include hidden cells', default: false },
                link: { type: 'boolean', description: 'Keep the placed spreadsheet linked so the table can be updated from the file (Create Links When Placing Text and Spreadsheet Files)', default: false },
                at: { ...TEXT_LOCATION_SCHEMA, description: `Place at a point in text (instead of frame). ${TEXT_LOCATION_SCHEMA.description}` },
                frame: {
                    type: 'object',
                    description: 'Place in a new text frame (instead of at); x, y, width and height in mm from the page\'s top-left corner',
                    properties: {
                        pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                        x: { type: 'number', description: 'Left edge in mm', default: 20 },
                        y: { type: 'number', description: 'Top edge in mm', default: 20 },
                        width: { type: 'number', minimum: 1, description: 'Width in mm', default: 150 },
                        height: { type: 'number', minimum: 1, description: 'Height in mm', default: 100 },
                    },
                },
            },
            required: ['filePath'],
        },
        features: ['indesign.tables.table_from_excel'],
        hints: { readOnly: false },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/data.xlsx`, sheet: 'Sheet1', range: 'A1:D10', at: undefined, frame: { pageIndex: 0, x: 20, y: 20, width: 150, height: 100 } },
        handler: (a) => {
            if (!/\.xlsx?$/i.test(String(a.filePath ?? ''))) throw new Error("'filePath' must be an .xlsx or .xls file");
            const file = jsxPath(validateFilePath(a.filePath));
            if (has(a.at) === has(a.frame)) throw new Error('Give at (a point in text) or frame (a new text frame), not both');
            const prefs = [`xp.tableFormatting = TableFormattingOptions.${FORMATTING[enumOf(a.formatting ?? 'formatted_table', Object.keys(FORMATTING), { name: 'formatting' })]};`];
            if (has(a.sheet)) prefs.push(`xp.sheetName = ${text(a.sheet, 'sheet', 255)};`);
            else prefs.push(`xp.sheetIndex = ${index(a.sheetIndex ?? 0, { name: 'sheetIndex', max: 1000 })};`);
            if (has(a.range)) {
                const r = String(a.range);
                if (!/^[A-Za-z]{1,3}[0-9]{1,7}(:[A-Za-z]{1,3}[0-9]{1,7})?$/.test(r) && !/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/.test(r)) {
                    throw new Error("'range' must be a cell range such as A1:F20, or a named range");
                }
                prefs.push(`xp.rangeName = ${str(r)};`);
            }
            if (has(a.cellAlignment)) prefs.push(`xp.alignmentStyle = AlignmentStyleOptions.${CELL_ALIGN[enumOf(a.cellAlignment, Object.keys(CELL_ALIGN), { name: 'cellAlignment' })]};`);
            if (has(a.decimalPlaces)) prefs.push(`xp.decimalPlaces = ${index(a.decimalPlaces, { name: 'decimalPlaces', max: 20 })};`);
            if (has(a.includeHiddenCells)) prefs.push(`xp.showHiddenCells = ${flag(a.includeHiddenCells, 'includeHiddenCells')};`);
            if (has(a.link)) prefs.push(`tp.linkTextFilesWhenImporting = ${flag(a.link, 'link')};`);
            let where;
            if (has(a.at)) {
                where = `var ip = __textAt(doc, ${textAtSpec(a.at)}), frameId = null;`;
            } else {
                const f = group(a.frame, ['pageIndex', 'x', 'y', 'width', 'height'], 'frame');
                if (!has(f.pageIndex)) throw new Error("'frame.pageIndex' is required");
                const x = num(f.x ?? 20, { name: 'frame.x', min: -5000, max: 5000 });
                const y = num(f.y ?? 20, { name: 'frame.y', min: -5000, max: 5000 });
                const w = mm(f.width ?? 150, 'frame.width', { min: 1 });
                const h = mm(f.height ?? 100, 'frame.height', { min: 1 });
                where = `var pg = __page(doc, ${index(f.pageIndex, { name: 'frame.pageIndex' })}), o = __toPage(pg, ${x}, ${y});
var tf = pg.textFrames.add();
tf.geometricBounds = [o[1], o[0], o[1] + ${h}, o[0] + ${w}];
var ip = tf.insertionPoints[0], frameId = tf.id;`;
            }
            return run('Place spreadsheet table', script(`${TABLE_JSX}${has(a.at) ? TEXT_AT_JSX : ''}
var file = File(${file});
if (!file.exists) throw new Error("File not found: " + file.fsName);
${where}
var story = ip.parentStory, before = story.tables.length, at = ip.index;
var xp = app.excelImportPreferences, tp = app.textPreferences;
var saved = { f: xp.tableFormatting, sn: xp.sheetName, si: xp.sheetIndex, rn: xp.rangeName, al: xp.alignmentStyle, dp: xp.decimalPlaces, hc: xp.showHiddenCells, ln: tp.linkTextFilesWhenImporting };
try {
  ${prefs.join('\n  ')}
  ip.place(file, false);
} finally {
  xp.tableFormatting = saved.f; xp.sheetName = saved.sn; xp.sheetIndex = saved.si; xp.rangeName = saved.rn;
  xp.alignmentStyle = saved.al; xp.decimalPlaces = saved.dp; xp.showHiddenCells = saved.hc; tp.linkTextFilesWhenImporting = saved.ln;
}
var added = story.tables.length - before, out = { storyId: story.id, frameId: frameId, tablesAdded: added, tables: [] };
for (var i = 0; i < story.tables.length && out.tables.length < added; i++) {
  if (story.tables[i].storyOffset.index >= at) out.tables.push(__tableInfo(story.tables[i]));
}
__result__ = out;`));
        },
    },
];
