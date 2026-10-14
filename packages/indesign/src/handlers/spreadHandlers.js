/**
 * Spread management handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import {
    formatResponse,
    str,
    index,
    bool,
    enumOf,
    measure,
    validateFilePath,
    jsxPath,
} from '../utils/stringUtils.js';
import { uiColorExpr } from './layerHandlers.js';

const LOCATIONS = ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'];
const SELECTION_OPTIONS = ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM', 'SET_KEY'];
const TRANSITION_TYPES = [
    'NONE', 'BLINDS_TRANSITION', 'BOX_TRANSITION', 'COMB_TRANSITION', 'COVER_TRANSITION',
    'DISSOLVE_TRANSITION', 'FADE_TRANSITION', 'PUSH_TRANSITION', 'SPLIT_TRANSITION',
    'UNCOVER_TRANSITION', 'WIPE_TRANSITION', 'ZOOM_IN_TRANSITION', 'ZOOM_OUT_TRANSITION',
];
const TRANSITION_DIRECTIONS = [
    'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_IN', 'HORIZONTAL_OUT', 'VERTICAL_IN', 'VERTICAL_OUT',
    'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'UP', 'DOWN', 'LEFT_UP', 'LEFT_DOWN', 'RIGHT_UP',
    'RIGHT_DOWN', 'IN', 'OUT', 'NOT_APPLICABLE',
];
const TRANSITION_DURATIONS = ['FAST', 'MEDIUM', 'SLOW'];

/**
 * Wrap a body that operates on `doc` and `spread` (= doc.spreads[spreadIndex])
 * with the no-document and index checks. `prelude` lines go at top level
 * (function declarations).
 */
function withSpread(spreadIndex, body, prelude = []) {
    const idx = index(spreadIndex, { name: 'spreadIndex' });
    return [
        ...prelude,
        'if (app.documents.length === 0) {',
        '  "No document open";',
        '} else {',
        '  var doc = app.activeDocument;',
        `  var spreadIndex = ${idx};`,
        '  if (spreadIndex >= doc.spreads.length) {',
        '    "Invalid spreadIndex " + spreadIndex + ": out of range (document has " + doc.spreads.length + " spreads)";',
        '  } else {',
        '    var spread = doc.spreads[spreadIndex];',
        ...body.map((l) => '    ' + l),
        '  }',
        '}',
    ].join('\n');
}

/** Top-level helper: comma-separated page names of a spread. */
const PAGE_NAMES_FN = [
    'function pageNames(s) {',
    '  var names = [];',
    '  for (var p = 0; p < s.pages.length; p++) names.push(s.pages[p].name);',
    '  return names.join(", ");',
    '}',
];

/**
 * Top-level helper: number of guides on the spread's pages. createGuides puts
 * its guides on the pages; Spread.guides holds guides owned by the spread itself.
 */
const PAGE_GUIDES_FN = [
    'function pageGuideCount(s) {',
    '  var n = 0;',
    '  for (var p = 0; p < s.pages.length; p++) n += s.pages[p].guides.length;',
    '  return n;',
    '}',
];

/** Top-level helper: resolve an optional layer name to a Layer (or null when absent). */
const FIND_LAYER_FN = [
    'function findLayer(d, name) {',
    '  var l = d.layers.itemByName(name);',
    '  return l.isValid ? l : null;',
    '}',
];

/**
 * Build the LocationOptions/reference part shared by duplicate and move.
 * Returns JSX lines that set `loc` and `ref` or produce an error string in `locError`.
 */
function locationLines(position, referenceSpreadIndex, refKind) {
    const pos = enumOf(position, LOCATIONS, { name: 'position' });
    const needsRef = pos === 'BEFORE' || pos === 'AFTER';
    if (needsRef && (referenceSpreadIndex === undefined || referenceSpreadIndex === null)) {
        throw new Error(`Invalid arguments: referenceSpreadIndex is required when position is ${pos}`);
    }
    const lines = ['var locError = "";', `var loc = LocationOptions.${pos};`];
    if (needsRef) {
        const ref = index(referenceSpreadIndex, { name: 'referenceSpreadIndex' });
        lines.push(
            `var refIndex = ${ref};`,
            'var ref = null;',
            'if (refIndex >= doc.spreads.length) {',
            '  locError = "Invalid referenceSpreadIndex " + refIndex + ": out of range (document has " + doc.spreads.length + " spreads)";',
            ...(refKind === 'move'
                ? ['} else if (refIndex === spreadIndex) {', '  locError = "Cannot move a spread relative to itself";']
                : []),
            '} else {',
            '  ref = doc.spreads[refIndex];',
            '}'
        );
    } else {
        lines.push('var ref = doc;');
    }
    return lines;
}

export class SpreadHandlers {
    /**
     * List all spreads in the active document.
     */
    static async listSpreads() {
        const script = [
            ...PAGE_NAMES_FN,
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var out = "=== SPREADS ===\\n";',
            '  out += "Total spreads: " + doc.spreads.length + "\\n";',
            '  out += "Total pages: " + doc.pages.length + "\\n\\n";',
            '  for (var i = 0; i < doc.spreads.length; i++) {',
            '    var s = doc.spreads[i];',
            '    out += "Spread " + i + ": pages [" + pageNames(s) + "]";',
            '    out += ", master: " + (s.appliedMaster && s.appliedMaster.isValid ? s.appliedMaster.name : "None");',
            '    out += ", items: " + s.pageItems.length;',
            '    if (s.label) out += ", label: " + s.label;',
            '    out += "\\n";',
            '  }',
            '  out;',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'List Spreads');
    }

    /**
     * Detailed information about one spread.
     */
    static async getSpreadInfo(args = {}) {
        const script = withSpread(args.spreadIndex, [
            'var out = "=== SPREAD INFO ===\\n";',
            'out += "Index: " + spread.index + "\\n";',
            'out += "ID: " + spread.id + "\\n";',
            'out += "Name/Label: " + spread.label + "\\n";',
            'out += "Applied Master: " + (spread.appliedMaster && spread.appliedMaster.isValid ? spread.appliedMaster.name : "None") + "\\n";',
            'out += "Allow Page Shuffle: " + spread.allowPageShuffle + "\\n";',
            'out += "Show Master Items: " + spread.showMasterItems + "\\n";',
            'out += "Page Transition: " + spread.pageTransitionType + " / " + spread.pageTransitionDirection + " / " + spread.pageTransitionDuration + "\\n";',
            'out += "Flattener Override: " + spread.flattenerOverride + "\\n";',
            'out += "Pages: " + spread.pages.length + "\\n";',
            'for (var p = 0; p < spread.pages.length; p++) {',
            '  var pg = spread.pages[p];',
            '  out += "  Page " + pg.name + " (document offset " + pg.documentOffset + ", side " + pg.side + ", bounds " + pg.bounds + ")\\n";',
            '}',
            'out += "Page items: " + spread.pageItems.length + "\\n";',
            'out += "Guides: " + pageGuideCount(spread) + " on pages, " + spread.guides.length + " spread-level\\n";',
            'out;',
        ], PAGE_GUIDES_FN);

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Get Spread Info');
    }

    /**
     * Duplicate a spread to a location in the document.
     */
    static async duplicateSpread(args = {}) {
        const { spreadIndex, position = 'AT_END', referenceSpreadIndex } = args;
        const script = withSpread(spreadIndex, [
            ...locationLines(position, referenceSpreadIndex, 'duplicate'),
            'if (locError) {',
            '  locError;',
            '} else {',
            '  try {',
            '    var dup = spread.duplicate(loc, ref);',
            '    "Spread " + spreadIndex + " duplicated; new spread is at index " + dup.index + ". Total spreads: " + doc.spreads.length;',
            '  } catch (error) {',
            '    "Error duplicating spread: " + error.message;',
            '  }',
            '}',
        ]);

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Duplicate Spread');
    }

    /**
     * Move a spread to a different position.
     */
    static async moveSpread(args = {}) {
        const { spreadIndex, position = 'AT_END', referenceSpreadIndex } = args;
        const script = withSpread(spreadIndex, [
            ...locationLines(position, referenceSpreadIndex, 'move'),
            'if (locError) {',
            '  locError;',
            '} else {',
            '  try {',
            '    var moved = spread.move(loc, ref);',
            '    "Spread moved from index " + spreadIndex + " to index " + moved.index;',
            '  } catch (error) {',
            '    "Error moving spread: " + error.message;',
            '  }',
            '}',
        ]);

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Move Spread');
    }

    /**
     * Delete a spread (and its pages).
     */
    static async deleteSpread(args = {}) {
        const script = withSpread(args.spreadIndex, [
            'if (doc.spreads.length <= 1) {',
            '  "Cannot delete the only spread in the document";',
            '} else {',
            '  try {',
            '    var removedPages = spread.pages.length;',
            '    spread.remove();',
            '    "Spread " + spreadIndex + " deleted (" + removedPages + " page(s)). Total spreads: " + doc.spreads.length;',
            '  } catch (error) {',
            '    "Error deleting spread: " + error.message;',
            '  }',
            '}',
        ]);

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Delete Spread');
    }

    /**
     * Set writable Spread properties.
     */
    static async setSpreadProperties(args = {}) {
        const {
            spreadIndex, name, label, allowPageShuffle, showMasterItems,
            pageTransitionType, pageTransitionDirection, pageTransitionDuration,
        } = args;

        const sets = [];
        if (name !== undefined) sets.push(['name', `spread.name = ${str(name)};`]);
        if (label !== undefined) sets.push(['label', `spread.label = ${str(label)};`]);
        if (allowPageShuffle !== undefined) sets.push(['allowPageShuffle', `spread.allowPageShuffle = ${bool(allowPageShuffle)};`]);
        if (showMasterItems !== undefined) sets.push(['showMasterItems', `spread.showMasterItems = ${bool(showMasterItems)};`]);
        if (pageTransitionType !== undefined) {
            const v = enumOf(pageTransitionType, TRANSITION_TYPES, { name: 'pageTransitionType' });
            sets.push(['pageTransitionType', `spread.pageTransitionType = PageTransitionTypeOptions.${v};`]);
        }
        if (pageTransitionDirection !== undefined) {
            const v = enumOf(pageTransitionDirection, TRANSITION_DIRECTIONS, { name: 'pageTransitionDirection' });
            sets.push(['pageTransitionDirection', `spread.pageTransitionDirection = PageTransitionDirectionOptions.${v};`]);
        }
        if (pageTransitionDuration !== undefined) {
            const v = enumOf(pageTransitionDuration, TRANSITION_DURATIONS, { name: 'pageTransitionDuration' });
            sets.push(['pageTransitionDuration', `spread.pageTransitionDuration = PageTransitionDurationOptions.${v};`]);
        }
        if (!sets.length) {
            throw new Error('Invalid arguments: no spread properties given to set');
        }

        // Each property is applied independently so one rejected value
        // (e.g. a direction the transition type does not support) is reported
        // without hiding the others.
        const body = ['var done = [];', 'var failed = [];'];
        for (const [prop, line] of sets) {
            body.push(
                `try { ${line} done.push(${str(prop)}); } catch (e) { failed.push(${str(prop)} + " (" + e.message + ")"); }`
            );
        }
        body.push(
            'if (failed.length) {',
            '  "Error setting spread properties: " + failed.join("; ") + (done.length ? ". Applied: " + done.join(", ") : "");',
            '} else {',
            '  "Spread " + spreadIndex + " updated: " + done.join(", ");',
            '}'
        );

        const script = withSpread(spreadIndex, body);
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Set Spread Properties');
    }

    /**
     * Spread.createGuides: row/column guides on every page of the spread.
     */
    static async createSpreadGuides(args = {}) {
        const {
            spreadIndex, numberOfRows = 0, numberOfColumns = 0, rowGutter = 5, columnGutter = 5,
            guideColor = 'BLUE', fitMargins = true, removeExisting = false, layerName,
        } = args;

        const rows = index(numberOfRows, { name: 'numberOfRows', max: 100 });
        const cols = index(numberOfColumns, { name: 'numberOfColumns', max: 100 });
        const rg = measure(rowGutter, { name: 'rowGutter' });
        const cg = measure(columnGutter, { name: 'columnGutter' });
        const color = uiColorExpr(guideColor, { name: 'guideColor' });
        const hasLayer = layerName !== undefined && layerName !== null && layerName !== '';

        const call = `spread.createGuides(${rows}, ${cols}, ${rg}, ${cg}, ${color}, ${bool(fitMargins)}, ${bool(removeExisting)}${hasLayer ? ', layer' : ''});`;
        const body = [];
        if (hasLayer) {
            body.push(
                `var layer = findLayer(doc, ${str(layerName)});`,
                'if (!layer) {',
                `  "Error: layer \\"" + ${str(layerName)} + "\\" not found";`,
                '} else {'
            );
        } else {
            body.push('{');
        }
        body.push(
            '  try {',
            '    var before = pageGuideCount(spread);',
            `    ${call}`,
            '    "Guides created on spread " + spreadIndex + ": " + pageGuideCount(spread) + " guide(s) on its pages now (was " + before + ")";',
            '  } catch (error) {',
            '    "Error creating guides: " + error.message;',
            '  }',
            '}'
        );

        const script = withSpread(spreadIndex, body, hasLayer ? FIND_LAYER_FN.concat(PAGE_GUIDES_FN) : PAGE_GUIDES_FN);
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Create Spread Guides');
    }

    /**
     * Spread.place: place a file at a point on the spread.
     */
    static async placeFileOnSpread(args = {}) {
        const {
            spreadIndex, filePath, x = 10, y = 10, layerName,
            showingOptions = false, autoflowing = false,
        } = args;

        const resolved = validateFilePath(filePath);
        const px = measure(x, { name: 'x' });
        const py = measure(y, { name: 'y' });
        const hasLayer = layerName !== undefined && layerName !== null && layerName !== '';

        const body = [
            `var f = new File(${jsxPath(resolved)});`,
            `var layer = ${hasLayer ? `findLayer(doc, ${str(layerName)})` : 'doc.activeLayer'};`,
            'if (!f.exists) {',
            '  "Error: file not found: " + f.fsName;',
            '} else if (!layer) {',
            `  "Error: layer \\"" + ${str(layerName ?? '')} + "\\" not found";`,
            '} else {',
            '  try {',
            `    var placed = spread.place(f, [${px}, ${py}], layer, ${bool(showingOptions)}, ${bool(autoflowing)});`,
            '    "Placed " + f.name + " on spread " + spreadIndex + " (layer " + layer.name + "): " + placed.length + " item(s)";',
            '  } catch (error) {',
            '    "Error placing file: " + error.message;',
            '  }',
            '}',
        ];

        const script = withSpread(spreadIndex, body, FIND_LAYER_FN);
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Place File on Spread');
    }

    /**
     * Spread.placeXML: place an element of the document's XML structure on the spread.
     */
    static async placeXmlOnSpread(args = {}) {
        const { spreadIndex, xmlElementName, matchIndex = 0, x = 10, y = 10, autoflowing = false } = args;
        if (typeof xmlElementName !== 'string' || !xmlElementName.trim()) {
            throw new Error("Invalid value for 'xmlElementName': must be a non-empty tag name");
        }
        const nth = index(matchIndex, { name: 'matchIndex' });
        const px = measure(x, { name: 'x' });
        const py = measure(y, { name: 'y' });

        // Depth-first, document order, root included.
        const prelude = [
            'function findXml(el, tag, want, state) {',
            '  if (el.markupTag.name === tag) {',
            '    if (state.count === want) return el;',
            '    state.count++;',
            '  }',
            '  for (var c = 0; c < el.xmlElements.length; c++) {',
            '    var hit = findXml(el.xmlElements[c], tag, want, state);',
            '    if (hit) return hit;',
            '  }',
            '  return null;',
            '}',
        ];
        const body = [
            `var tag = ${str(xmlElementName)};`,
            `var want = ${nth};`,
            'var state = { count: 0 };',
            'var el = doc.xmlElements.length > 0 ? findXml(doc.xmlElements[0], tag, want, state) : null;',
            'if (!el) {',
            '  "Error: XML element <" + tag + "> #" + want + " not found (" + state.count + " match(es) in the document structure)";',
            '} else {',
            '  try {',
            `    var item = spread.placeXML(el, [${px}, ${py}], ${bool(autoflowing)});`,
            '    "Placed XML element <" + tag + "> on spread " + spreadIndex + (item && item.isValid ? " (page item id " + item.id + ")" : "");',
            '  } catch (error) {',
            '    "Error placing XML: " + error.message;',
            '  }',
            '}',
        ];

        const script = withSpread(spreadIndex, body, prelude);
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Place XML on Spread');
    }

    /**
     * Spread.select, optionally bringing the spread into view in the layout window.
     */
    static async selectSpread(args = {}) {
        const { spreadIndex, selectionMode = 'REPLACE_WITH', makeActive = true } = args;
        const mode = enumOf(selectionMode, SELECTION_OPTIONS, { name: 'selectionMode' });

        const body = [
            'try {',
            `  spread.select(SelectionOptions.${mode});`,
            '  var shown = "";',
            ...(makeActive
                ? [
                    '  if (doc.layoutWindows.length > 0) {',
                    '    doc.layoutWindows[0].activeSpread = spread;',
                    '    shown = " and made active in the layout window";',
                    '  }',
                ]
                : []),
            `  "Spread " + spreadIndex + " selected (${mode})" + shown;`,
            '} catch (error) {',
            '  "Error selecting spread: " + error.message;',
            '}',
        ];

        const script = withSpread(spreadIndex, body);
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Select Spread');
    }

    /**
     * Counts of the content on a spread, by type and by layer.
     */
    static async getSpreadContentSummary(args = {}) {
        const body = [
            'var out = "=== SPREAD CONTENT SUMMARY ===\\n";',
            'out += "Spread " + spreadIndex + ": pages [" + pageNames(spread) + "]\\n\\n";',
            'out += "Page items (top level): " + spread.pageItems.length + "\\n";',
            'out += "All page items (incl. nested): " + spread.allPageItems.length + "\\n";',
            'out += "Text frames: " + spread.textFrames.length + "\\n";',
            'out += "Rectangles: " + spread.rectangles.length + "\\n";',
            'out += "Ovals: " + spread.ovals.length + "\\n";',
            'out += "Polygons: " + spread.polygons.length + "\\n";',
            'out += "Graphic lines: " + spread.graphicLines.length + "\\n";',
            'out += "Groups: " + spread.groups.length + "\\n";',
            'out += "Buttons: " + spread.buttons.length + "\\n";',
            'out += "Guides: " + pageGuideCount(spread) + " on pages, " + spread.guides.length + " spread-level\\n";',
            '',
            'var overset = 0;',
            'for (var t = 0; t < spread.textFrames.length; t++) {',
            '  if (spread.textFrames[t].overflows) overset++;',
            '}',
            'out += "Overset text frames: " + overset + "\\n";',
            '',
            'var graphics = spread.allGraphics;',
            'out += "Placed graphics: " + graphics.length + "\\n";',
            'for (var g = 0; g < graphics.length && g < 50; g++) {',
            '  var link = graphics[g].itemLink;',
            '  out += "  - " + (link && link.isValid ? link.name + " (" + link.status + ")" : "embedded/unlinked") + "\\n";',
            '}',
            '',
            'var layerCounts = {};',
            'var layerOrder = [];',
            'var items = spread.pageItems;',
            'for (var i = 0; i < items.length; i++) {',
            '  var ln = items[i].itemLayer.name;',
            '  if (!layerCounts.hasOwnProperty(ln)) { layerCounts[ln] = 0; layerOrder.push(ln); }',
            '  layerCounts[ln]++;',
            '}',
            'out += "\\nItems by layer:\\n";',
            'if (layerOrder.length === 0) out += "  (none)\\n";',
            'for (var k = 0; k < layerOrder.length; k++) {',
            '  out += "  " + layerOrder[k] + ": " + layerCounts[layerOrder[k]] + "\\n";',
            '}',
            'out;',
        ];

        const script = withSpread(args.spreadIndex, body, PAGE_NAMES_FN.concat(PAGE_GUIDES_FN));
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Get Spread Content Summary');
    }
}
