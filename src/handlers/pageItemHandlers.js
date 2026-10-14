/**
 * PageItem management handlers
 *
 * Also exports the small ExtendScript scaffolding shared by the text, graphics,
 * style and group handlers (jsxProgram, jsxPage, jsxSwatch, ...). All geometry
 * is exchanged with callers in millimetres relative to the target page's
 * top-left corner; scripts run with app.scriptPreferences.measurementUnit set
 * to POINTS (restored afterwards) so results don't depend on document rulers.
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { sessionManager } from '../core/sessionManager.js';
import { formatResponse, str, num, index, bool, enumOf } from '../utils/stringUtils.js';

/** Points per millimetre. */
export const PT_PER_MM = 72 / 25.4;

/** Convert a validated millimetre value to a points literal for JSX. */
export function mmToPt(value, opts = {}) {
    const n = Number(num(value, { min: -100000, max: 100000, ...opts }));
    return String(Math.round(n * PT_PER_MM * 10000) / 10000);
}

const has = (v) => v !== undefined && v !== null && v !== '';

/**
 * Build a complete ExtendScript program. `bodyLines` run inside a function
 * where `doc` is the active document and must `return` a result string.
 * Uncaught exceptions become "<errorPrefix>: <message>".
 */
export function jsxProgram(bodyLines, { errorPrefix = 'Error' } = {}) {
    return [
        'function __run() {',
        '  if (app.documents.length === 0) { return "No document open"; }',
        '  var doc = app.activeDocument;',
        ...bodyLines.map((l) => '  ' + l),
        '}',
        'var __out;',
        'var __units = app.scriptPreferences.measurementUnit;',
        'app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;',
        'try {',
        '  __out = __run();',
        '} catch (__err) {',
        `  __out = ${str(errorPrefix + ': ')} + __err.message;`,
        '}',
        'app.scriptPreferences.measurementUnit = __units;',
        '__out;',
    ].join('\n');
}

/**
 * Resolve `page`: doc.pages[pageIndex] when given, else the active layout
 * window's page (falling back to the first page).
 */
export function jsxPage(pageIndex) {
    if (!has(pageIndex)) {
        return [
            'var page = null;',
            'try { page = app.activeWindow.activePage; } catch (__pe) { page = null; }',
            'if (!page || !page.isValid) { page = doc.pages[0]; }',
        ];
    }
    const p = index(pageIndex, { name: 'pageIndex' });
    return [
        `if (${p} >= doc.pages.length) { return "Page index ${p} out of range (document has " + doc.pages.length + " pages)"; }`,
        `var page = doc.pages[${p}];`,
    ];
}

/** `var <name> = <collection>[i]` with an out-of-range check. */
export function jsxItemAt(name, collection, idx, label) {
    const i = index(idx, { name: label });
    return [
        `if (${i} >= ${collection}.length) { return ${str(`${label} ${i} out of range (`)} + ${collection}.length + " available)"; }`,
        `var ${name} = ${collection}[${i}];`,
    ];
}

/** JSX helpers: swatch lookup (creates "#RRGGBB" RGB swatches on demand) and mm/pt conversion. */
export const JSX_HELPERS = [
    'function __swatch(name, rgb) {',
    '  var sw = doc.swatches.itemByName(name);',
    '  if (sw.isValid) { return sw; }',
    '  if (rgb) { return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: rgb }); }',
    '  return null;',
    '}',
    'function __mm(v) { return Math.round(v / 2.834645669 * 100) / 100; }',
    'function __name(o) { try { return (o && o.name !== undefined) ? o.name : String(o); } catch (__ne) { return "n/a"; } }',
    'function __font(name) {',
    '  var f = app.fonts.itemByName(name);',
    '  if (f.isValid) { return f; }',
    '  if (name.indexOf("\\t") < 0) { return name; }',
    '  return null;',
    '}',
    'function __styleByName(list, name) {',
    '  for (var i = 0; i < list.length; i++) { if (list[i].name === name) { return list[i]; } }',
    '  return null;',
    '}',
];

/**
 * `var <name> = swatch` for a swatch name or "#RRGGBB" (an RGB swatch of that
 * name is created if missing). Returns an error string from the script when
 * the swatch does not exist.
 */
export function jsxSwatch(name, value, label = 'color') {
    const s = String(value).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(s);
    const swatchName = hex ? '#' + hex[1].toUpperCase() : s;
    const rgb = hex
        ? `[${parseInt(hex[1].slice(0, 2), 16)}, ${parseInt(hex[1].slice(2, 4), 16)}, ${parseInt(hex[1].slice(4, 6), 16)}]`
        : 'null';
    return [
        `var ${name} = __swatch(${str(swatchName)}, ${rgb});`,
        `if (!${name}) { return ${str(`Error: ${label} swatch '${swatchName}' not found in document`)}; }`,
    ];
}

/** Font name with a literal "\t" sequence turned into a real tab ("Arial\\tRegular" -> "Arial<TAB>Regular"). */
export function normalizeFontName(value) {
    return String(value).replace(/\\t/g, '\t');
}

/** `var <name> = font` (Font object or family-name string); error when not installed. */
export function jsxFont(name, value) {
    const f = normalizeFontName(value);
    return [
        `var ${name} = __font(${str(f)});`,
        `if (${name} === null) { return ${str(`Error: font '${f.replace(/\t/g, '\\t')}' is not installed (use "Family\\tStyle", e.g. "Arial\\tRegular", or a family name)`)}; }`,
    ];
}

/**
 * Resolve a box in mm. Explicit values are used as given; missing ones come
 * from the session's page-aware defaults.
 */
export function resolveBox({ x, y, width, height }) {
    const given = {};
    if (has(x)) given.x = Number(x);
    if (has(y)) given.y = Number(y);
    if (has(width)) given.width = Number(width);
    if (has(height)) given.height = Number(height);
    const calc = sessionManager.getCalculatedPositioning(given);
    const pick = (k) => (has(given[k]) ? given[k] : calc[k]);
    return {
        x: Number(num(pick('x'), { name: 'x', min: -100000, max: 100000 })),
        y: Number(num(pick('y'), { name: 'y', min: -100000, max: 100000 })),
        width: Number(num(pick('width'), { name: 'width', min: 0.01, max: 100000 })),
        height: Number(num(pick('height'), { name: 'height', min: 0.01, max: 100000 })),
    };
}

/** `var <name> = [top, left, bottom, right]` in points, offset by `page.bounds`. */
export function jsxBounds(name, box) {
    const t = mmToPt(box.y), l = mmToPt(box.x);
    const b = mmToPt(box.y + box.height), r = mmToPt(box.x + box.width);
    return [
        'var __pb = page.bounds;',
        `var ${name} = [__pb[0] + ${t}, __pb[1] + ${l}, __pb[0] + ${b}, __pb[1] + ${r}];`,
    ];
}

const ANCHORS = [
    'CENTER_ANCHOR', 'TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR', 'LEFT_CENTER_ANCHOR',
    'RIGHT_CENTER_ANCHOR', 'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR',
];

/** Lines describing `item` (bounds in mm relative to `page`). */
const DESCRIBE_ITEM = [
    'function __describe(item, prefix) {',
    '  var s = "";',
    '  var gb = item.geometricBounds;',
    '  var pb = page.bounds;',
    '  s += prefix + "Type: " + item.constructor.name + "\\n";',
    '  s += prefix + "Name: " + (item.name || "Unnamed") + "\\n";',
    '  s += prefix + "ID: " + item.id + "\\n";',
    '  try { s += prefix + "Layer: " + item.itemLayer.name + "\\n"; } catch (__le) {}',
    '  s += prefix + "Visible: " + item.visible + "\\n";',
    '  s += prefix + "Locked: " + item.locked + "\\n";',
    '  s += prefix + "Position (mm from page top-left): x=" + __mm(gb[1] - pb[1]) + ", y=" + __mm(gb[0] - pb[0]) + "\\n";',
    '  s += prefix + "Size (mm): " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + "\\n";',
    '  return s;',
    '}',
];

export class PageItemHandlers {
    /**
     * Get information about a page item
     */
    static async getPageItemInfo(args) {
        const { pageIndex, itemIndex } = args;

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...DESCRIBE_ITEM,
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            'var info = "=== PAGE ITEM INFO ===\\n";',
            'info += __describe(item, "");',
            'try { info += "Rotation: " + item.rotationAngle + "\\n"; } catch (__re) {}',
            'try { info += "Fill Color: " + __name(item.fillColor) + "\\n"; } catch (__fe) {}',
            'try { info += "Stroke Color: " + __name(item.strokeColor) + "\\n"; } catch (__se) {}',
            'try { info += "Stroke Weight (pt): " + item.strokeWeight + "\\n"; } catch (__we) {}',
            'try { info += "Object Style: " + __name(item.appliedObjectStyle) + "\\n"; } catch (__oe) {}',
            'return info;',
        ], { errorPrefix: 'Error getting page item info' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Get Page Item Info");
    }

    /**
     * Select a page item
     */
    static async selectPageItem(args) {
        const { pageIndex, itemIndex, existingSelection = 'REPLACE_WITH' } = args;
        const mode = enumOf(existingSelection, ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM'], { name: 'existingSelection' });

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            `item.select(SelectionOptions.${mode});`,
            'return "Page item selected (" + item.constructor.name + ", ID " + item.id + "); " + app.selection.length + " item(s) now selected";',
        ], { errorPrefix: 'Error selecting page item' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Select Page Item");
    }

    /**
     * Move a page item so its top-left corner is at (x, y) mm from the page's top-left.
     */
    static async movePageItem(args) {
        const { pageIndex, itemIndex, x, y } = args;
        const xPt = mmToPt(x, { name: 'x' });
        const yPt = mmToPt(y, { name: 'y' });

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            'if (item.locked) { return "Cannot move: page item is locked"; }',
            'var pb = page.bounds;',
            'var gb = item.geometricBounds;',
            `item.move(undefined, [pb[1] + ${xPt} - gb[1], pb[0] + ${yPt} - gb[0]]);`,
            'gb = item.geometricBounds;',
            'return "Page item moved to x=" + __mm(gb[1] - pb[1]) + "mm, y=" + __mm(gb[0] - pb[0]) + "mm";',
        ], { errorPrefix: 'Error moving page item' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Move Page Item");
    }

    /**
     * Resize a page item to width x height mm around an anchor point.
     */
    static async resizePageItem(args) {
        const { pageIndex, itemIndex, width, height, anchorPoint = 'CENTER_ANCHOR' } = args;
        const wPt = mmToPt(width, { name: 'width', min: 0.01 });
        const hPt = mmToPt(height, { name: 'height', min: 0.01 });
        const anchor = enumOf(anchorPoint, ANCHORS, { name: 'anchorPoint' });

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            'if (item.locked) { return "Cannot resize: page item is locked"; }',
            // values are in points because consideringRulerUnits is false
            `item.resize([CoordinateSpaces.INNER_COORDINATES, BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS], AnchorPoint.${anchor}, ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH, [${wPt}, ${hPt}], false, false);`,
            'var gb = item.geometricBounds;',
            'return "Page item resized to " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + " mm";',
        ], { errorPrefix: 'Error resizing page item' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Resize Page Item");
    }

    /**
     * Set page item properties
     */
    static async setPageItemProperties(args) {
        const { pageIndex, itemIndex, fillColor, strokeColor, strokeWeight, visible, locked } = args;

        const lines = [];
        const changed = [];
        if (locked === false) {
            lines.push('item.locked = false;');
            changed.push('locked=false');
        }
        if (has(fillColor)) {
            lines.push(...jsxSwatch('__fill', fillColor, 'fill'), 'item.fillColor = __fill;');
            changed.push('fill');
        }
        if (has(strokeColor)) {
            lines.push(...jsxSwatch('__stroke', strokeColor, 'stroke'), 'item.strokeColor = __stroke;');
            changed.push('stroke color');
        }
        if (has(strokeWeight)) {
            lines.push(`item.strokeWeight = ${num(strokeWeight, { name: 'strokeWeight', min: 0, max: 1000 })};`);
            changed.push('stroke weight');
        }
        if (typeof visible === 'boolean') {
            lines.push(`item.visible = ${bool(visible)};`);
            changed.push(`visible=${visible}`);
        }
        if (locked === true) {
            lines.push('item.locked = true;');
            changed.push('locked=true');
        }
        if (!changed.length) {
            return formatResponse('Invalid request: no properties to set', 'Set Page Item Properties');
        }

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            ...(locked === false ? [] : ['if (item.locked) { return "Cannot modify: page item is locked (pass locked=false to unlock)"; }']),
            ...lines,
            `return ${str(`Page item properties updated: ${changed.join(', ')}`)};`,
        ], { errorPrefix: 'Error setting page item properties' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Set Page Item Properties");
    }

    /**
     * Duplicate a page item and place the copy's top-left at (x, y) mm.
     */
    static async duplicatePageItem(args) {
        const { pageIndex, itemIndex, x, y } = args;
        const xPt = mmToPt(x, { name: 'x' });
        const yPt = mmToPt(y, { name: 'y' });

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            'var pb = page.bounds;',
            'var newItem = item.duplicate();',
            'var gb = newItem.geometricBounds;',
            `newItem.move(undefined, [pb[1] + ${xPt} - gb[1], pb[0] + ${yPt} - gb[0]]);`,
            'gb = newItem.geometricBounds;',
            'return "Page item duplicated (new ID " + newItem.id + ") at x=" + __mm(gb[1] - pb[1]) + "mm, y=" + __mm(gb[0] - pb[0]) + "mm";',
        ], { errorPrefix: 'Error duplicating page item' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Duplicate Page Item");
    }

    /**
     * Delete a page item
     */
    static async deletePageItem(args) {
        const { pageIndex, itemIndex } = args;

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            'var __items = page.allPageItems;',
            ...jsxItemAt('item', '__items', itemIndex, 'Page item index'),
            'if (item.locked) { return "Cannot delete: page item is locked"; }',
            'var desc = item.constructor.name + " (ID " + item.id + ")";',
            'item.remove();',
            'return "Page item deleted: " + desc;',
        ], { errorPrefix: 'Error deleting page item' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Delete Page Item");
    }

    /**
     * List all page items on a page
     */
    static async listPageItems(args) {
        const { pageIndex } = args;

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...DESCRIBE_ITEM,
            'var items = page.allPageItems;',
            'var out = "=== PAGE ITEMS (page " + page.name + ", " + items.length + " items) ===\\n";',
            'for (var i = 0; i < items.length; i++) {',
            '  out += "Index: " + i + "\\n";',
            '  out += __describe(items[i], "  ");',
            '  out += "---\\n";',
            '}',
            'return out;',
        ], { errorPrefix: 'Error listing page items' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Page Items");
    }
}
