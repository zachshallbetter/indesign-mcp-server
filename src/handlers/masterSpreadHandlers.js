/**
 * Master spread management handlers
 *
 * Master spreads are addressed by their full name, e.g. "A-Master"
 * (namePrefix + "-" + baseName). Scripts end with `out;`.
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, str, num, index, bool, enumOf, ALLOWED } from '../utils/stringUtils.js';
import { docScript, indent, jsxUIColor, jsxSwatch, jsxWithMillimeters } from './pageHandlers.js';

const LOCATIONS = ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'];

async function run(script, operation) {
    const result = await ScriptExecutor.executeInDesignScript(script);
    return formatResponse(result, operation);
}

function requireName(value, name) {
    if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`Invalid arguments: '${name}' is required.`);
    }
    return String(value);
}

/** docScript with `ms` bound to the named master spread. */
function masterScript(masterName, failPrefix, body) {
    return docScript(failPrefix, [
        `var ms = doc.masterSpreads.itemByName(${str(masterName)});`,
        'if (!ms.isValid) {',
        `  out = ${str(`Error: master spread not found: ${masterName}`)};`,
        '} else {',
        ...indent(body, 2),
        '}',
    ]);
}

/** docScript with `page` bound to doc.pages[pageIdx] (range-checked). */
function documentPageScript(pageIdx, failPrefix, body) {
    return docScript(failPrefix, [
        `if (${pageIdx} >= doc.pages.length) {`,
        `  out = "Error: page index ${pageIdx} is out of range (document has " + doc.pages.length + " pages)";`,
        '} else {',
        `  var page = doc.pages[${pageIdx}];`,
        ...indent(body, 2),
        '}',
    ]);
}

/** Lines binding `mpage` to ms.pages[i] (range-checked by throwing). */
function masterPageLines(masterPageIndex) {
    const i = index(masterPageIndex ?? 0, { name: 'masterPageIndex', max: 100 });
    return [
        `if (${i} >= ms.pages.length) { throw new Error("master page index ${i} is out of range (master has " + ms.pages.length + " pages)"); }`,
        `var mpage = ms.pages[${i}];`,
    ];
}

/**
 * Parse "all", "3", "1-5", "1,3,7-9" (1-based document page positions) into
 * 0-based [start, end] pairs. Returns null for "all".
 */
function parsePageRange(range) {
    const text = String(range ?? 'all').trim().toLowerCase();
    if (text === 'all' || text === '') return null;
    const pairs = [];
    for (const part of text.split(',')) {
        const t = part.trim();
        let m;
        if ((m = /^(\d+)$/.exec(t))) {
            pairs.push([Number(m[1]), Number(m[1])]);
        } else if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(t))) {
            pairs.push([Number(m[1]), Number(m[2])]);
        } else {
            throw new Error(`Invalid pageRange: ${JSON.stringify(range)}. Use "all", "3", "1-5" or "1,3,7-9".`);
        }
        const [a, b] = pairs[pairs.length - 1];
        if (a < 1 || b < a || b > 100000) {
            throw new Error(`Invalid pageRange segment: "${t}" (pages are 1-based and start <= end).`);
        }
    }
    return pairs.map(([a, b]) => [a - 1, b - 1]);
}

const isNoneMaster = (name) => /^\[?none\]?$/i.test(String(name).trim());

export class MasterSpreadHandlers {
    /**
     * Create a master spread
     */
    static async createMasterSpread(args) {
        const { name, namePrefix, baseName, pageColor, showMasterItems = true, pagesPerSpread } = args;
        const base = requireName(baseName ?? name, 'name');
        const lines = [];
        if (namePrefix !== undefined) {
            const fullName = `${namePrefix}-${base}`;
            lines.push(
                `if (doc.masterSpreads.itemByName(${str(fullName)}).isValid) { throw new Error(${str(`a master spread named ${fullName} already exists`)}); }`
            );
        }
        lines.push(
            // 0 or omitted: InDesign's default (the document's pages per spread).
            pagesPerSpread
                ? `var ms = doc.masterSpreads.add(${index(pagesPerSpread, { name: 'pagesPerSpread', max: 10 })});`
                : 'var ms = doc.masterSpreads.add();',
            'try {',
            ...(namePrefix !== undefined ? [`  ms.namePrefix = ${str(namePrefix)};`] : []),
            `  ms.baseName = ${str(base)};`,
            `  ms.showMasterItems = ${bool(showMasterItems)};`,
            ...(pageColor !== undefined
                ? [`  ms.pageColor = ${jsxUIColor(pageColor, { name: 'pageColor', pageColorOptions: true })};`]
                : []),
            '} catch (setErr) {',
            '  ms.remove();',
            '  throw setErr;',
            '}',
            'out = "Master spread created: " + ms.name + " (" + ms.pages.length + " page(s))";'
        );
        return run(docScript('Error creating master spread', lines), 'Create Master Spread');
    }

    /**
     * List all master spreads
     */
    static async listMasterSpreads() {
        const body = [
            'var masterSpreads = doc.masterSpreads;',
            'var info = "=== MASTER SPREADS (" + masterSpreads.length + ") ===\\n";',
            'for (var i = 0; i < masterSpreads.length; i++) {',
            '  var master = masterSpreads[i];',
            '  var parentMaster = master.appliedMaster;',
            '  info += "Index: " + i + "\\n";',
            '  info += "Name: " + master.name + "\\n";',
            '  info += "Name Prefix: " + master.namePrefix + "\\n";',
            '  info += "Base Name: " + master.baseName + "\\n";',
            '  info += "Based On: " + ((parentMaster && parentMaster != NothingEnum.NOTHING && parentMaster.isValid) ? parentMaster.name : "None") + "\\n";',
            '  info += "Show Master Items: " + master.showMasterItems + "\\n";',
            '  info += "Pages: " + master.pages.length + "\\n";',
            '  info += "---\\n";',
            '}',
            'out = info;',
        ];
        return run(docScript('Error listing master spreads', body), 'List Master Spreads');
    }

    /**
     * Delete a master spread (pages using it fall back to no master)
     */
    static async deleteMasterSpread(args) {
        const name = requireName(args.name, 'name');
        const body = [
            'var removedName = ms.name;',
            'ms.remove();',
            'out = "Master spread deleted: " + removedName;',
        ];
        return run(masterScript(name, 'Error deleting master spread', body), 'Delete Master Spread');
    }

    /**
     * Duplicate a master spread and give the copy a new base name
     */
    static async duplicateMasterSpread(args) {
        const name = requireName(args.name, 'name');
        const newName = requireName(args.newName, 'newName');
        const position = enumOf(args.position ?? 'AT_END', LOCATIONS, { name: 'position' });

        const body = [];
        if (position === 'BEFORE' || position === 'AFTER') {
            const refName = requireName(args.referenceMasterName, 'referenceMasterName');
            body.push(
                `var refMaster = doc.masterSpreads.itemByName(${str(refName)});`,
                `if (!refMaster.isValid) { throw new Error(${str(`reference master spread not found: ${refName}`)}); }`,
                `var dup = ms.duplicate(LocationOptions.${position}, refMaster);`
            );
        } else {
            body.push(`var dup = ms.duplicate(LocationOptions.${position}, doc);`);
        }
        body.push(
            `dup.baseName = ${str(newName)};`,
            'out = "Master spread duplicated: " + ms.name + " -> " + dup.name;'
        );
        return run(masterScript(name, 'Error duplicating master spread', body), 'Duplicate Master Spread');
    }

    /**
     * Apply a master spread (or "None") to a range of document pages
     */
    static async applyMasterSpread(args) {
        const masterName = requireName(args.masterName, 'masterName');
        const ranges = parsePageRange(args.pageRange);
        const none = isNoneMaster(masterName);

        const rangeLit = ranges ? `[${ranges.map(([a, b]) => `[${a}, ${b}]`).join(', ')}]` : null;
        const body = [
            ...(none
                ? ['var master = NothingEnum.NOTHING;', 'var masterLabel = "[None]";']
                : [
                    `var master = doc.masterSpreads.itemByName(${str(masterName)});`,
                    `if (!master.isValid) { throw new Error(${str(`master spread not found: ${masterName}`)}); }`,
                    'var masterLabel = master.name;',
                ]),
            ranges ? `var ranges = ${rangeLit};` : 'var ranges = [[0, doc.pages.length - 1]];',
            'var applied = 0;',
            'for (var r = 0; r < ranges.length; r++) {',
            '  var last = Math.min(ranges[r][1], doc.pages.length - 1);',
            '  for (var i = ranges[r][0]; i <= last; i++) {',
            '    doc.pages[i].appliedMaster = master;',
            '    applied++;',
            '  }',
            '}',
            'if (applied === 0) {',
            '  out = "Error: page range is out of range (document has " + doc.pages.length + " pages)";',
            '} else {',
            '  out = "Applied master " + masterLabel + " to " + applied + " page(s)";',
            '}',
        ];
        return run(docScript('Error applying master spread', body), 'Apply Master Spread');
    }

    /**
     * Create a text frame on a master spread page (position/size in mm from the page's top-left)
     */
    static async createMasterTextFrame(args) {
        const {
            content,
            x = 10,
            y = 10,
            width = 100,
            height = 50,
            fontSize = 12,
            fontFamily = 'Helvetica Neue',
            fontStyle,
            textColor = 'Black',
            isPrimaryTextFrame = false,
            masterPageIndex = 0,
        } = args;
        const masterName = requireName(args.masterName, 'masterName');
        const rawAlign = args.alignment ?? 'LEFT_ALIGN';
        const alignment = enumOf(rawAlign === 'JUSTIFY' ? 'LEFT_JUSTIFIED' : rawAlign, ALLOWED.alignment, { name: 'alignment' });
        const xN = num(x, { name: 'x' });
        const yN = num(y, { name: 'y' });
        const wN = num(width, { name: 'width', min: 0.001 });
        const hN = num(height, { name: 'height', min: 0.001 });

        const body = [
            ...masterPageLines(masterPageIndex),
            ...jsxSwatch('textSwatch', textColor, { name: 'textColor' }),
            'var tf = mpage.textFrames.add();',
            'try {',
            ...indent([
                ...jsxWithMillimeters([
                    'var b = mpage.bounds;',
                    `tf.geometricBounds = [b[0] + ${yN}, b[1] + ${xN}, b[0] + ${yN} + ${hN}, b[1] + ${xN} + ${wN}];`,
                ]),
                `tf.contents = ${str(content ?? '')};`,
                'var t = tf.texts[0];',
                `t.pointSize = ${num(fontSize, { name: 'fontSize', min: 0.1, max: 1296 })};`,
                `t.appliedFont = ${str(fontFamily)};`,
                ...(fontStyle ? [`t.fontStyle = ${str(fontStyle)};`] : []),
                't.fillColor = textSwatch;',
                `t.justification = Justification.${alignment};`,
                ...(isPrimaryTextFrame ? ['ms.primaryTextFrame = tf;'] : []),
            ], 2),
            '} catch (frameErr) {',
            '  tf.remove();',
            '  throw frameErr;',
            '}',
            `out = "Master text frame created on " + ms.name + " page " + mpage.name${isPrimaryTextFrame ? ' + " (primary text frame)"' : ''};`,
        ];
        return run(masterScript(masterName, 'Error creating master text frame', body), 'Create Master Text Frame');
    }

    /**
     * Create a rectangle on a master spread page (position/size in mm from the page's top-left)
     */
    static async createMasterRectangle(args) {
        const { x, y, width, height, fillColor, strokeColor, cornerRadius = 0, masterPageIndex = 0 } = args;
        const masterName = requireName(args.masterName, 'masterName');
        const strokeWidth = args.strokeWidth ?? args.strokeWeight ?? 1;
        const xN = num(x, { name: 'x' });
        const yN = num(y, { name: 'y' });
        const wN = num(width, { name: 'width', min: 0.001 });
        const hN = num(height, { name: 'height', min: 0.001 });
        const sw = num(strokeWidth, { name: 'strokeWidth', min: 0, max: 1000 });
        const radius = num(cornerRadius, { name: 'cornerRadius', min: 0, max: 10000 });

        const corners = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
        const body = [
            ...masterPageLines(masterPageIndex),
            ...(fillColor !== undefined ? jsxSwatch('fillSwatch', fillColor, { name: 'fillColor' }) : []),
            ...(strokeColor !== undefined ? jsxSwatch('strokeSwatch', strokeColor, { name: 'strokeColor' }) : []),
            'var rect = mpage.rectangles.add();',
            'try {',
            ...indent([
                ...jsxWithMillimeters([
                    'var b = mpage.bounds;',
                    `rect.geometricBounds = [b[0] + ${yN}, b[1] + ${xN}, b[0] + ${yN} + ${hN}, b[1] + ${xN} + ${wN}];`,
                ]),
                ...(fillColor !== undefined ? ['rect.fillColor = fillSwatch;'] : []),
                ...(strokeColor !== undefined ? ['rect.strokeColor = strokeSwatch;'] : []),
                `rect.strokeWeight = "${sw}pt";`,
                ...(Number(radius) > 0
                    ? corners.flatMap((c) => [
                        `rect.${c}CornerOption = CornerOptions.ROUNDED_CORNER;`,
                        `rect.${c}CornerRadius = "${radius}mm";`,
                    ])
                    : []),
            ], 2),
            '} catch (rectErr) {',
            '  rect.remove();',
            '  throw rectErr;',
            '}',
            'out = "Master rectangle created on " + ms.name + " page " + mpage.name;',
        ];
        return run(masterScript(masterName, 'Error creating master rectangle', body), 'Create Master Rectangle');
    }

    /**
     * Create row/column guides on every page of a master spread
     */
    static async createMasterGuides(args) {
        const {
            numberOfRows = 0,
            numberOfColumns = 0,
            rowGutter = 5,
            columnGutter = 5,
            guideColor = 'BLUE',
            fitMargins = true,
            removeExisting = false,
            layerName,
        } = args;
        const masterName = requireName(args.masterName, 'masterName');
        const rows = index(numberOfRows, { name: 'numberOfRows', max: 200 });
        const cols = index(numberOfColumns, { name: 'numberOfColumns', max: 200 });
        const rg = num(rowGutter, { name: 'rowGutter', min: 0, max: 10000 });
        const cg = num(columnGutter, { name: 'columnGutter', min: 0, max: 10000 });
        const color = jsxUIColor(guideColor, { name: 'guideColor' });

        const body = [
            ...(layerName
                ? [
                    `var layer = doc.layers.itemByName(${str(layerName)});`,
                    `if (!layer.isValid) { throw new Error(${str(`layer not found: ${layerName}`)}); }`,
                ]
                : []),
            `ms.createGuides(${rows}, ${cols}, "${rg}mm", "${cg}mm", ${color}, ${bool(fitMargins)}, ${bool(removeExisting)}${layerName ? ', layer' : ''});`,
            'out = "Guides created on master " + ms.name + " (" + ms.guides.length + " guide(s) on the spread)";',
        ];
        return run(masterScript(masterName, 'Error creating master guides', body), 'Create Master Guides');
    }

    /**
     * Get master spread information
     */
    static async getMasterSpreadInfo(args) {
        const name = requireName(args.name, 'name');
        const body = [
            'var info = "=== MASTER SPREAD INFO ===\\n";',
            'info += "Name: " + ms.name + "\\n";',
            'info += "Name Prefix: " + ms.namePrefix + "\\n";',
            'info += "Base Name: " + ms.baseName + "\\n";',
            'var parentMaster = ms.appliedMaster;',
            'info += "Based On: " + ((parentMaster && parentMaster != NothingEnum.NOTHING && parentMaster.isValid) ? parentMaster.name : "None") + "\\n";',
            'info += "Show Master Items: " + ms.showMasterItems + "\\n";',
            'info += "Page Color: " + ms.pageColor + "\\n";',
            'info += "Index: " + ms.index + "\\n";',
            'info += "ID: " + ms.id + "\\n";',
            'var ptf = ms.primaryTextFrame;',
            'info += "Primary Text Frame: " + ((ptf && ptf != NothingEnum.NOTHING && ptf.isValid) ? ("id " + ptf.id) : "None") + "\\n";',
            'var pageNames = [];',
            'for (var i = 0; i < ms.pages.length; i++) { pageNames.push(ms.pages[i].name); }',
            'info += "\\n=== CONTENT COUNTS ===\\n";',
            'info += "Pages: " + ms.pages.length + " (" + pageNames.join(", ") + ")\\n";',
            'info += "Text Frames: " + ms.textFrames.length + "\\n";',
            'info += "Rectangles: " + ms.rectangles.length + "\\n";',
            'info += "Ovals: " + ms.ovals.length + "\\n";',
            'info += "Polygons: " + ms.polygons.length + "\\n";',
            'info += "Graphic Lines: " + ms.graphicLines.length + "\\n";',
            'info += "Groups: " + ms.groups.length + "\\n";',
            'info += "Guides: " + ms.guides.length + "\\n";',
            'info += "All Page Items: " + ms.allPageItems.length + "\\n";',
            'out = info;',
        ];
        return run(masterScript(name, 'Error reading master spread info', body), 'Get Master Spread Info');
    }

    /**
     * Detach master page items onto a document page: each master item is
     * overridden onto the page (PageItem.override) and the copy is detached
     * from the master (PageItem.detach). Without itemIndex, every master item
     * shown on the page is detached, and items already overridden on the page
     * are detached too.
     */
    static async detachMasterItems(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const hasItem = args.itemIndex !== undefined && args.itemIndex !== null;
        const itemIdx = hasItem ? index(args.itemIndex, { name: 'itemIndex' }) : null;

        const body = [
            'var am = page.appliedMaster;',
            'if (!am || am == NothingEnum.NOTHING || !am.isValid) {',
            '  out = "Cannot detach master items: page " + page.name + " has no master applied";',
            '} else {',
            '  var items = page.masterPageItems;',
        ];
        if (hasItem) {
            body.push(
                `  if (${itemIdx} >= items.length) {`,
                `    out = "Error: master item index ${itemIdx} is out of range (page " + page.name + " shows " + items.length + " master items)";`,
                '  } else {',
                `    var copy = items[${itemIdx}].override(page);`,
                '    copy.detach();',
                `    out = "Detached master item ${itemIdx} onto page " + page.name;`,
                '  }',
                '}'
            );
        } else {
            body.push(
                '  var detached = 0, failed = 0, lastErr = "";',
                // Detach items already overridden on this page, remembering their master items.
                '  var overriddenIds = {};',
                '  for (var j = 0; j < page.pageItems.length; j++) {',
                '    var pi = page.pageItems[j];',
                '    if (pi.overridden) {',
                '      try { overriddenIds["id" + pi.overriddenMasterPageItem.id] = true; } catch (eId) {}',
                '      try { pi.detach(); detached++; } catch (e1) { failed++; lastErr = e1.message; }',
                '    }',
                '  }',
                '  for (var k = 0; k < items.length; k++) {',
                '    if (overriddenIds["id" + items[k].id]) { continue; }',
                '    try {',
                '      var ov = items[k].override(page);',
                '      ov.detach();',
                '      detached++;',
                '    } catch (e2) { failed++; lastErr = e2.message; }',
                '  }',
                '  if (detached === 0 && failed > 0) {',
                '    out = "Failed to detach master items on page " + page.name + ": " + lastErr;',
                '  } else {',
                '    out = "Detached " + detached + " master item(s) on page " + page.name + (failed > 0 ? "; " + failed + " item(s) skipped: " + lastErr : "");',
                '  }',
                '}'
            );
        }
        return run(documentPageScript(p, 'Error detaching master items', body), 'Detach Master Items');
    }

    /**
     * Remove local overrides from master items on a document page
     * (PageItem.removeOverride / Guide.removeOverride), restoring the master
     * version. itemIndex selects one overridden item (0-based, in the order:
     * top-level page items, then guides); without it, all overrides go.
     */
    static async removeMasterOverride(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const hasItem = args.itemIndex !== undefined && args.itemIndex !== null;
        const itemIdx = hasItem ? index(args.itemIndex, { name: 'itemIndex' }) : null;

        const body = [
            'var overridden = [];',
            'for (var j = 0; j < page.pageItems.length; j++) { if (page.pageItems[j].overridden) { overridden.push(page.pageItems[j]); } }',
            'for (var g = 0; g < page.guides.length; g++) { if (page.guides[g].overridden) { overridden.push(page.guides[g]); } }',
        ];
        if (hasItem) {
            body.push(
                `if (${itemIdx} >= overridden.length) {`,
                `  out = "Error: override index ${itemIdx} is out of range (page " + page.name + " has " + overridden.length + " overridden master items)";`,
                '} else {',
                `  overridden[${itemIdx}].removeOverride();`,
                `  out = "Removed override ${itemIdx} on page " + page.name;`,
                '}'
            );
        } else {
            body.push(
                'for (var k = 0; k < overridden.length; k++) { overridden[k].removeOverride(); }',
                'out = "Removed " + overridden.length + " master item override(s) on page " + page.name;'
            );
        }
        return run(documentPageScript(p, 'Error removing master override', body), 'Remove Master Override');
    }
}
