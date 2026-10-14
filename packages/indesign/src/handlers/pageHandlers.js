/**
 * Page management handlers
 *
 * Every generated script ends with `out;` so the script's completion value
 * (and the structured executor's auto-capture) is the message in `out`.
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import {
    formatResponse, str, num, index, bool, enumOf, ALLOWED, measure, validateFilePath, jsxPath,
} from '../utils/stringUtils.js';

const MM_TO_PT = 72 / 25.4;

const LOCATIONS = ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'];
const BINDING_OPTIONS = ['DEFAULT_VALUE', 'LEFT_ALIGN', 'RIGHT_ALIGN'];
const LAYOUT_RULES = ['GUIDE_BASED', 'OBJECT_BASED', 'OFF', 'PRESERVE_EXISTING', 'RECENTER', 'SCALE', 'USE_MASTER'];
const SNAPSHOT_MODES = ['FULL_SNAPSHOT_BLENDING', 'IGNORE_LAYOUT_SNAPSHOTS', 'LIMITED_SNAPSHOT_BLENDING', 'USE_NEAREST_SNAPSHOT'];
const COORDINATE_SPACES = ['PAGE_COORDINATES', 'SPREAD_COORDINATES', 'PASTEBOARD_COORDINATES', 'INNER_COORDINATES', 'PARENT_COORDINATES'];
const RESIZE_METHODS = [
    'REPLACING_CURRENT_DIMENSIONS_WITH', 'MULTIPLYING_CURRENT_DIMENSIONS_BY', 'ADDING_CURRENT_DIMENSIONS_TO',
    'RESHAPING_AREA_TO_RATIO', 'RESHAPING_BORDER_TO_RATIO',
];
const ANCHOR_POINTS = [
    'TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR', 'LEFT_CENTER_ANCHOR', 'CENTER_ANCHOR',
    'RIGHT_CENTER_ANCHOR', 'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR',
];
const SELECTION_OPTIONS = ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM', 'SET_KEY'];
const LAYOUT_UNITS = ['mm', 'cm', 'in', 'pt', 'px'];

// ---------------------------------------------------------------------------
// JSX building blocks (shared with masterSpreadHandlers.js)
// ---------------------------------------------------------------------------

export function indent(lines, n) {
    const pad = ' '.repeat(n);
    return lines.map((l) => (l ? pad + l : l));
}

/**
 * JSX expression for a UI color (guides, page color): a UIColors name
 * ("BLUE", "light blue"), or "r,g,b" / [r, g, b] with 0-255 components.
 * With pageColorOptions, "NOTHING"/"NONE" and "USE_MASTER_COLOR" are accepted too.
 */
export function jsxUIColor(value, { name = 'color', pageColorOptions = false } = {}) {
    const rgbText = /^\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*$/;
    if (Array.isArray(value) || rgbText.test(String(value))) {
        const parts = Array.isArray(value) ? value : String(value).split(',');
        if (parts.length !== 3) throw new Error(`Invalid ${name}: expected three RGB values (0-255)`);
        return `[${parts.map((p) => num(p, { min: 0, max: 255, name })).join(', ')}]`;
    }
    const v = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (pageColorOptions && (v === 'NOTHING' || v === 'NONE')) return 'PageColorOptions.NOTHING';
    if (pageColorOptions && v === 'USE_MASTER_COLOR') return 'PageColorOptions.USE_MASTER_COLOR';
    return `UIColors.${enumOf(v, ALLOWED.uiColor, { name })}`;
}

/**
 * Lines that bind `varName` to a document swatch. `spec` is a swatch name
 * ("Black", "Paper", "None", a custom swatch) or "#RRGGBB" (an RGB process
 * color named "R=r G=g B=b" is reused or created). Throws inside the script
 * when a named swatch does not exist.
 */
export function jsxSwatch(varName, spec, { name = 'color' } = {}) {
    const s = String(spec).trim();
    const hex = /^#?([0-9a-f]{6})$/i.exec(s);
    if (hex && s.startsWith('#')) {
        const n = parseInt(hex[1], 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        const colorName = str(`R=${r} G=${g} B=${b}`);
        return [
            `var ${varName} = doc.colors.itemByName(${colorName});`,
            `if (!${varName}.isValid) {`,
            `  ${varName} = doc.colors.add({ name: ${colorName}, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [${r}, ${g}, ${b}] });`,
            '}',
        ];
    }
    if (!s) throw new Error(`Invalid ${name}: empty swatch name`);
    return [
        `var ${varName} = doc.swatches.itemByName(${str(s)});`,
        `if (!${varName}.isValid) { throw new Error(${str(`swatch not found: ${s}`)}); }`,
    ];
}

/**
 * Run `body` with the document's rulers in millimeters, restoring the
 * caller's units afterwards. Page bounds and geometric bounds read/written
 * inside are then in mm.
 */
export function jsxWithMillimeters(body) {
    return [
        'var vp = doc.viewPreferences;',
        'var oldUnitsH = vp.horizontalMeasurementUnits;',
        'var oldUnitsV = vp.verticalMeasurementUnits;',
        'vp.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;',
        'vp.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;',
        'try {',
        ...indent(body, 2),
        '} finally {',
        '  vp.horizontalMeasurementUnits = oldUnitsH;',
        '  vp.verticalMeasurementUnits = oldUnitsV;',
        '}',
    ];
}

/** Script guarded by "a document is open"; body sets `out` and may throw. */
export function docScript(failPrefix, body) {
    return [
        'var out;',
        'if (app.documents.length === 0) {',
        '  out = "No document open";',
        '} else {',
        '  var doc = app.activeDocument;',
        '  try {',
        ...indent(body, 4),
        '  } catch (e) {',
        `    out = ${str(`${failPrefix}: `)} + e.message;`,
        '  }',
        '}',
        'out;',
    ].join('\n');
}

/** Like docScript, with `page` bound to doc.pages[pageIdx] (range-checked). */
function pageScript(pageIdx, failPrefix, body) {
    return docScript(failPrefix, [
        `if (${pageIdx} >= doc.pages.length) {`,
        `  out = "Error: page index ${pageIdx} is out of range (document has " + doc.pages.length + " pages)";`,
        '} else {',
        `  var page = doc.pages[${pageIdx}];`,
        ...indent(body, 2),
        '}',
    ]);
}

/** Lines binding `layer` to a named layer (or the active layer). */
function layerLines(layerName) {
    if (!layerName) return ['var layer = doc.activeLayer;'];
    return [
        `var layer = doc.layers.itemByName(${str(layerName)});`,
        `if (!layer.isValid) { throw new Error(${str(`layer not found: ${layerName}`)}); }`,
    ];
}

async function run(script, operation) {
    const result = await ScriptExecutor.executeInDesignScript(script);
    return formatResponse(result, operation);
}

function requireRef(position, ref, name) {
    if (position !== 'BEFORE' && position !== 'AFTER') return null;
    if (ref === undefined || ref === null) {
        throw new Error(`Invalid arguments: '${name}' is required when position is ${position}.`);
    }
    return index(ref, { name });
}

/** Lines that bind `ref` to doc.pages[refIdx] or set an out-of-range error. */
function refPageGuard(refIdx, name, inner) {
    return [
        `if (${refIdx} >= doc.pages.length) {`,
        `  out = "Error: ${name} ${refIdx} is out of range (document has " + doc.pages.length + " pages)";`,
        '} else {',
        `  var ref = doc.pages[${refIdx}];`,
        ...indent(inner, 2),
        '}',
    ];
}

export class PageHandlers {
    /**
     * Add a new page to the document
     */
    static async addPage(args) {
        const position = enumOf(args.position ?? 'AT_END', LOCATIONS, { name: 'position' });
        const refIdx = requireRef(position, args.referencePage, 'referencePage');

        const done = 'out = "Page added: " + newPage.name + " (index " + newPage.documentOffset + "). Total pages: " + doc.pages.length;';
        let body;
        if (refIdx !== null) {
            body = refPageGuard(refIdx, 'referencePage', [
                `var newPage = doc.pages.add(LocationOptions.${position}, ref);`,
                done,
            ]);
        } else {
            body = [`var newPage = doc.pages.add(LocationOptions.${position});`, done];
        }
        return run(docScript('Error adding page', body), 'Add Page');
    }

    /**
     * Get detailed information about a specific page
     */
    static async getPageInfo(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'var info = "=== PAGE INFO ===\\n";',
            'info += "Index: " + page.documentOffset + "\\n";',
            'info += "Name: " + page.name + "\\n";',
            'info += "Label: " + page.label + "\\n";',
            'info += "Bounds: " + page.bounds + "\\n";',
            'info += "Side: " + page.side + "\\n";',
            'var am = page.appliedMaster;',
            'info += "Applied Master: " + ((am && am != NothingEnum.NOTHING && am.isValid) ? am.name : "None") + "\\n";',
            'info += "Section: " + page.appliedSection.name + "\\n";',
            'var mp = page.marginPreferences;',
            'info += "Margins (top, left/inside, bottom, right/outside): " + mp.top + ", " + mp.left + ", " + mp.bottom + ", " + mp.right + "\\n";',
            'info += "Columns: " + mp.columnCount + "\\n";',
            'info += "Page Color: " + page.pageColor + "\\n";',
            'info += "Optional Page: " + page.optionalPage + "\\n";',
            'info += "Layout Rule: " + page.layoutRule + "\\n";',
            'info += "Snapshot Blending Mode: " + page.snapshotBlendingMode + "\\n";',
            'out = info;',
        ];
        return run(pageScript(p, 'Error reading page info', body), 'Get Page Info');
    }

    /**
     * Navigate to a specific page (makes it the active page of the layout window)
     */
    static async navigateToPage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'if (doc.layoutWindows.length === 0) {',
            '  out = "Cannot navigate: the document has no open layout window";',
            '} else {',
            '  doc.layoutWindows[0].activePage = page;',
            `  out = "Navigated to page " + page.name + " (index ${p})";`,
            '}',
        ];
        return run(pageScript(p, 'Error navigating to page', body), 'Navigate to Page');
    }

    /**
     * Delete a specific page from the document
     */
    static async deletePage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'if (doc.pages.length === 1) {',
            '  out = "Cannot delete the only page in the document";',
            '} else {',
            '  var removedName = page.name;',
            '  page.remove();',
            '  out = "Page " + removedName + " deleted. Total pages: " + doc.pages.length;',
            '}',
        ];
        return run(pageScript(p, 'Error deleting page', body), 'Delete Page');
    }

    /**
     * Duplicate a specific page to a position in the document
     */
    static async duplicatePage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const position = enumOf(args.position ?? 'AT_END', LOCATIONS, { name: 'position' });
        const refIdx = requireRef(position, args.referencePageIndex, 'referencePageIndex');

        const done = 'out = "Page duplicated: new page " + dup.name + " at index " + dup.documentOffset + ". Total pages: " + doc.pages.length;';
        let body;
        if (position === 'AT_END') {
            body = ['var dup = page.duplicate(LocationOptions.AFTER, doc.pages.lastItem());', done];
        } else if (position === 'AT_BEGINNING') {
            body = ['var dup = page.duplicate(LocationOptions.BEFORE, doc.pages.firstItem());', done];
        } else {
            body = refPageGuard(refIdx, 'referencePageIndex', [
                `var dup = page.duplicate(LocationOptions.${position}, ref);`,
                done,
            ]);
        }
        return run(pageScript(p, 'Error duplicating page', body), 'Duplicate Page');
    }

    /**
     * Move a page to a different position
     */
    static async movePage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const position = enumOf(args.position ?? 'AT_END', LOCATIONS, { name: 'position' });
        const binding = enumOf(args.binding ?? 'DEFAULT_VALUE', BINDING_OPTIONS, { name: 'binding' });
        const refIdx = requireRef(position, args.referencePageIndex, 'referencePageIndex');
        if (refIdx !== null && refIdx === p) {
            throw new Error('Invalid arguments: referencePageIndex must differ from pageIndex.');
        }

        const done = 'out = "Page moved: " + moved.name + " is now at index " + moved.documentOffset;';
        let body;
        if (position === 'AT_END' || position === 'AT_BEGINNING') {
            const atEnd = position === 'AT_END';
            const edge = atEnd ? 'doc.pages.lastItem()' : 'doc.pages.firstItem()';
            body = [
                `var edgePage = ${edge};`,
                'if (edgePage.id === page.id) {',
                `  out = "Page " + page.name + " is already at the ${atEnd ? 'end' : 'beginning'}";`,
                '} else {',
                `  var moved = page.move(LocationOptions.${atEnd ? 'AFTER' : 'BEFORE'}, edgePage, BindingOptions.${binding});`,
                `  ${done}`,
                '}',
            ];
        } else {
            body = refPageGuard(refIdx, 'referencePageIndex', [
                `var moved = page.move(LocationOptions.${position}, ref, BindingOptions.${binding});`,
                done,
            ]);
        }
        return run(pageScript(p, 'Error moving page', body), 'Move Page');
    }

    /**
     * Get all pages in the document (not currently exposed as a tool)
     */
    static async getAllPages() {
        const body = [
            'var info = "=== ALL PAGES ===\\n";',
            'info += "Total pages: " + doc.pages.length + "\\n\\n";',
            'for (var i = 0; i < doc.pages.length; i++) {',
            '  var pg = doc.pages[i];',
            '  var am = pg.appliedMaster;',
            '  info += "Page " + i + ": " + pg.name + " | Label: " + pg.label + " | Master: " + ((am && am != NothingEnum.NOTHING && am.isValid) ? am.name : "None") + "\\n";',
            '}',
            'out = info;',
        ];
        return run(docScript('Error listing pages', body), 'Get All Pages');
    }

    // =================== ADVANCED PAGE PROPERTIES ===================

    /**
     * Set properties for a page
     */
    static async setPageProperties(args) {
        const { label, pageColor, optionalPage, layoutRule, snapshotBlendingMode, appliedTrapPreset } = args;
        const p = index(args.pageIndex, { name: 'pageIndex' });

        const body = [];
        const changed = [];
        if (label !== undefined) {
            body.push(`page.label = ${str(label)};`);
            changed.push('label');
        }
        if (pageColor !== undefined) {
            body.push(`page.pageColor = ${jsxUIColor(pageColor, { name: 'pageColor', pageColorOptions: true })};`);
            changed.push('pageColor');
        }
        if (optionalPage !== undefined) {
            body.push(`page.optionalPage = ${bool(optionalPage)};`);
            changed.push('optionalPage');
        }
        if (layoutRule !== undefined) {
            body.push(`page.layoutRule = LayoutRuleOptions.${enumOf(layoutRule, LAYOUT_RULES, { name: 'layoutRule' })};`);
            changed.push('layoutRule');
        }
        if (snapshotBlendingMode !== undefined) {
            body.push(`page.snapshotBlendingMode = SnapshotBlendingModes.${enumOf(snapshotBlendingMode, SNAPSHOT_MODES, { name: 'snapshotBlendingMode' })};`);
            changed.push('snapshotBlendingMode');
        }
        if (appliedTrapPreset !== undefined) {
            body.push(
                `var trap = doc.trapPresets.itemByName(${str(appliedTrapPreset)});`,
                `if (!trap.isValid) { throw new Error(${str(`trap preset not found: ${appliedTrapPreset}`)}); }`,
                'page.appliedTrapPreset = trap;'
            );
            changed.push('appliedTrapPreset');
        }
        if (!changed.length) {
            throw new Error('Invalid arguments: provide at least one property to set.');
        }
        body.push(`out = "Page " + page.name + " updated: ${changed.join(', ')}";`);
        return run(pageScript(p, 'Error updating page properties', body), 'Set Page Properties');
    }

    /**
     * Adjust page layout (size, margins; bleed is document-wide) using
     * Page.adjustLayout / Document.adjustLayout, which reflow content.
     */
    static async adjustPageLayout(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const unit = enumOf(args.units ?? 'mm', LAYOUT_UNITS, { name: 'units' });
        const toMeasure = (key, min) => measure(num(args[key], { name: key, min }), { unit, name: key });

        const pageKeys = ['width', 'height', 'leftMargin', 'topMargin', 'rightMargin', 'bottomMargin'];
        const bleedKeys = ['bleedInside', 'bleedTop', 'bleedOutside', 'bleedBottom'];
        const pageProps = pageKeys.filter((k) => args[k] !== undefined)
            .map((k) => `${k}: ${toMeasure(k, k === 'width' || k === 'height' ? 0.001 : 0)}`);
        const bleedProps = bleedKeys.filter((k) => args[k] !== undefined)
            .map((k) => `${k}: ${toMeasure(k, 0)}`);
        if (!pageProps.length && !bleedProps.length) {
            throw new Error('Invalid arguments: provide at least one of width, height, margins or bleeds.');
        }

        const body = [];
        if (pageProps.length) body.push(`page.adjustLayout({ ${pageProps.join(', ')} });`);
        // Bleed is a document setting; Page.adjustLayout ignores bleed values.
        if (bleedProps.length) body.push(`doc.adjustLayout({ ${bleedProps.join(', ')} });`);
        body.push('out = "Page layout adjusted for page " + page.name + ". Bounds: " + page.bounds;');
        return run(pageScript(p, 'Error adjusting page layout', body), 'Adjust Page Layout');
    }

    /**
     * Resize a page
     */
    static async resizePage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const method = enumOf(args.resizeMethod ?? 'REPLACING_CURRENT_DIMENSIONS_WITH', RESIZE_METHODS, { name: 'resizeMethod' });
        const anchor = enumOf(args.anchorPoint ?? 'CENTER_ANCHOR', ANCHOR_POINTS, { name: 'anchorPoint' });
        const space = enumOf(args.coordinateSpace ?? 'PAGE_COORDINATES', COORDINATE_SPACES, { name: 'coordinateSpace' });
        if (args.width === undefined || args.height === undefined) {
            throw new Error('Invalid arguments: width and height are required.');
        }
        // Lengths (replace/add) are given in mm and passed in points; factors/ratios are unitless.
        const isLength = method === 'REPLACING_CURRENT_DIMENSIONS_WITH' || method === 'ADDING_CURRENT_DIMENSIONS_TO';
        const min = method === 'ADDING_CURRENT_DIMENSIONS_TO' ? -1e5 : 0.0001;
        const w = Number(num(args.width, { name: 'width', min, max: 1e5 }));
        const h = Number(num(args.height, { name: 'height', min, max: 1e5 }));
        const values = isLength ? [w * MM_TO_PT, h * MM_TO_PT] : [w, h];

        const body = [
            `page.resize(CoordinateSpaces.${space}, AnchorPoint.${anchor}, ResizeMethods.${method}, [${values.map((v) => num(v)).join(', ')}]);`,
            'out = "Page " + page.name + " resized. Bounds: " + page.bounds;',
        ];
        return run(pageScript(p, 'Error resizing page', body), 'Resize Page');
    }

    /**
     * Place a file on a page (x/y in mm from the page's top-left corner)
     */
    static async placeFileOnPage(args) {
        const { filePath, x = 10, y = 10, layerName, showingOptions = false, autoflowing = false } = args;
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const fileLit = jsxPath(validateFilePath(filePath));
        const xN = num(x, { name: 'x' });
        const yN = num(y, { name: 'y' });

        const body = [
            `var file = File(${fileLit});`,
            'if (!file.exists) {',
            '  out = "Error: file not found: " + file.fsName;',
            '} else {',
            ...indent(layerLines(layerName), 2),
            ...indent(jsxWithMillimeters([
                'var b = page.bounds;',
                `var placed = page.place(file, [(b[1] + ${xN}) + "mm", (b[0] + ${yN}) + "mm"], layer, ${bool(showingOptions)}, ${bool(autoflowing)});`,
            ]), 2),
            '  out = "Placed " + placed.length + " item(s) from " + file.name + " on page " + page.name;',
            '}',
        ];
        return run(pageScript(p, 'Error placing file', body), 'Place File on Page');
    }

    /**
     * Place an XML element (found by tag name) on a page
     */
    static async placeXmlOnPage(args) {
        const { xmlElementName, x = 10, y = 10, autoflowing = false } = args;
        const p = index(args.pageIndex, { name: 'pageIndex' });
        if (!xmlElementName) throw new Error('Invalid arguments: xmlElementName is required.');
        const tagLit = str(xmlElementName);
        const xN = num(x, { name: 'x' });
        const yN = num(y, { name: 'y' });

        const body = [
            'var found = null;',
            'var stack = [];',
            'if (doc.xmlElements.length > 0) { stack.push(doc.xmlElements[0]); }',
            'while (stack.length > 0 && found === null) {',
            '  var el = stack.pop();',
            `  if (el.markupTag.name === ${tagLit}) { found = el; break; }`,
            '  for (var k = el.xmlElements.length - 1; k >= 0; k--) { stack.push(el.xmlElements[k]); }',
            '}',
            'if (found === null) {',
            `  out = ${str(`Error: XML element not found: ${xmlElementName}`)};`,
            '} else {',
            ...indent(jsxWithMillimeters([
                'var b = page.bounds;',
                `var placedItem = page.placeXML(found, [(b[1] + ${xN}) + "mm", (b[0] + ${yN}) + "mm"], ${bool(autoflowing)});`,
            ]), 2),
            `  out = "Placed XML element " + ${tagLit} + " on page " + page.name;`,
            '}',
        ];
        return run(pageScript(p, 'Error placing XML content', body), 'Place XML on Page');
    }

    /**
     * Create a snapshot of the current page layout
     */
    static async snapshotPageLayout(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'page.snapshotCurrentLayout();',
            'out = "Layout snapshot created for page " + page.name;',
        ];
        return run(pageScript(p, 'Error creating page layout snapshot', body), 'Snapshot Page Layout');
    }

    /**
     * Delete the layout snapshot for a page
     */
    static async deletePageLayoutSnapshot(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'page.deleteLayoutSnapshot();',
            'out = "Layout snapshot for the current page size deleted on page " + page.name;',
        ];
        return run(pageScript(p, 'Error deleting page layout snapshot', body), 'Delete Page Layout Snapshot');
    }

    /**
     * Delete all layout snapshots for a page
     */
    static async deleteAllPageLayoutSnapshots(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'page.deleteAllLayoutSnapshots();',
            'out = "All layout snapshots deleted on page " + page.name;',
        ];
        return run(pageScript(p, 'Error deleting all page layout snapshots', body), 'Delete All Page Layout Snapshots');
    }

    /**
     * Reframe a page: set its bounding box from two opposing corners (mm)
     */
    static async reframePage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const space = enumOf(args.coordinateSpace ?? 'PAGE_COORDINATES', COORDINATE_SPACES, { name: 'coordinateSpace' });
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(num(args[k], { name: k, min: -1e5, max: 1e5 })));
        const pt = (v) => num(v * MM_TO_PT);
        const body = (x2 <= x1 || y2 <= y1)
            ? ['out = "Invalid arguments: (x2, y2) must be below and to the right of (x1, y1)";']
            : [
                `page.reframe(CoordinateSpaces.${space}, [[${pt(x1)}, ${pt(y1)}], [${pt(x2)}, ${pt(y2)}]]);`,
                'out = "Page " + page.name + " reframed. Bounds: " + page.bounds;',
            ];
        return run(pageScript(p, 'Error reframing page', body), 'Reframe Page');
    }

    /**
     * Create row/column guides on a single page (gutters in mm)
     */
    static async createPageGuides(args) {
        const {
            numberOfRows = 0, numberOfColumns = 0, rowGutter = 5, columnGutter = 5, guideColor = 'BLUE',
            fitMargins = true, removeExisting = false, layerName,
        } = args;
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const rows = index(numberOfRows, { name: 'numberOfRows', max: 200 });
        const cols = index(numberOfColumns, { name: 'numberOfColumns', max: 200 });
        const rg = num(rowGutter, { name: 'rowGutter', min: 0, max: 10000 });
        const cg = num(columnGutter, { name: 'columnGutter', min: 0, max: 10000 });
        const color = jsxUIColor(guideColor, { name: 'guideColor' });

        const addGuide = (orientation, loc) =>
            `page.guides.add(layer, { orientation: HorizontalOrVertical.${orientation}, location: ${loc}, guideColor: ${color}, fitToPage: true }); created++;`;

        const body = [
            ...layerLines(layerName),
            ...(removeExisting
                ? ['for (var gi = page.guides.length - 1; gi >= 0; gi--) { page.guides[gi].remove(); }']
                : []),
            'var created = 0;',
            ...jsxWithMillimeters([
                'var b = page.bounds;',
                'var top = b[0], left = b[1], bottom = b[2], right = b[3];',
                ...(fitMargins ? [
                    'var mp = page.marginPreferences;',
                    // marginPreferences.left/right are inside/outside on facing pages.
                    'var ml = mp.left, mr = mp.right;',
                    'if (page.side == PageSideOptions.LEFT_HAND) { ml = mp.right; mr = mp.left; }',
                    'top += mp.top; bottom -= mp.bottom; left += ml; right -= mr;',
                ] : []),
                `if (${cols} > 1) {`,
                `  var cw = (right - left - (${cols} - 1) * ${cg}) / ${cols};`,
                '  if (cw <= 0) { throw new Error("column gutter is too large for the available width"); }',
                `  for (var c = 1; c < ${cols}; c++) {`,
                `    var xEnd = left + c * cw + (c - 1) * ${cg};`,
                `    ${addGuide('VERTICAL', 'xEnd')}`,
                `    if (${cg} > 0) { ${addGuide('VERTICAL', `xEnd + ${cg}`)} }`,
                '  }',
                '}',
                `if (${rows} > 1) {`,
                `  var rh = (bottom - top - (${rows} - 1) * ${rg}) / ${rows};`,
                '  if (rh <= 0) { throw new Error("row gutter is too large for the available height"); }',
                `  for (var r = 1; r < ${rows}; r++) {`,
                `    var yEnd = top + r * rh + (r - 1) * ${rg};`,
                `    ${addGuide('HORIZONTAL', 'yEnd')}`,
                `    if (${rg} > 0) { ${addGuide('HORIZONTAL', `yEnd + ${rg}`)} }`,
                '  }',
                '}',
            ]),
            'out = "Created " + created + " guide(s) on page " + page.name;',
        ];
        const script = (Number(rows) < 2 && Number(cols) < 2 && !removeExisting)
            ? docScript('Error creating page guides', ['out = "Invalid arguments: numberOfRows or numberOfColumns must be at least 2 to create guides";'])
            : pageScript(p, 'Error creating page guides', body);
        return run(script, 'Create Page Guides');
    }

    /**
     * Select a page
     */
    static async selectPage(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const mode = enumOf(args.selectionMode ?? 'REPLACE_WITH', SELECTION_OPTIONS, { name: 'selectionMode' });
        const body = [
            `page.select(SelectionOptions.${mode});`,
            'out = "Page " + page.name + " selected";',
        ];
        return run(pageScript(p, 'Error selecting page', body), 'Select Page');
    }

    /**
     * Get a summary of content on a page
     */
    static async getPageContentSummary(args) {
        const p = index(args.pageIndex, { name: 'pageIndex' });
        const body = [
            'var summary = "=== PAGE CONTENT SUMMARY ===\\n";',
            'summary += "Page: " + page.name + " (index " + page.documentOffset + ")\\n";',
            'summary += "Text Frames: " + page.textFrames.length + "\\n";',
            'summary += "Rectangles: " + page.rectangles.length + "\\n";',
            'summary += "Ovals: " + page.ovals.length + "\\n";',
            'summary += "Polygons: " + page.polygons.length + "\\n";',
            'summary += "Graphic Lines: " + page.graphicLines.length + "\\n";',
            'summary += "Groups: " + page.groups.length + "\\n";',
            'summary += "Placed Graphics: " + page.allGraphics.length + "\\n";',
            'summary += "Guides: " + page.guides.length + "\\n";',
            'summary += "Top-level Items: " + page.pageItems.length + "\\n";',
            'summary += "All Items (incl. nested): " + page.allPageItems.length + "\\n";',
            'summary += "Master Items Shown: " + page.masterPageItems.length + "\\n";',
            'out = summary;',
        ];
        return run(pageScript(p, 'Error summarizing page content', body), 'Get Page Content Summary');
    }

    /**
     * Set page background by creating a full-page rectangle filled with a swatch
     */
    static async setPageBackground(args) {
        const { backgroundColor = 'Paper', opacity = 100 } = args;
        const p = index(args.pageIndex ?? 0, { name: 'pageIndex' });
        const op = num(opacity, { name: 'opacity', min: 0, max: 100 });
        const swatchName = String(backgroundColor);
        const nameLit = str(swatchName);

        const body = [
            `var sw = doc.swatches.itemByName(${nameLit});`,
            // Documents have a "Paper" swatch, not "White".
            ...(swatchName.toLowerCase() === 'white'
                ? ['if (!sw.isValid) { sw = doc.swatches.itemByName("Paper"); }']
                : []),
            'if (!sw.isValid) {',
            `  out = ${str(`Error: swatch not found: ${swatchName}`)};`,
            '} else {',
            '  var backgroundRect = page.rectangles.add();',
            '  backgroundRect.geometricBounds = page.bounds;',
            '  backgroundRect.fillColor = sw;',
            '  backgroundRect.strokeColor = doc.swatches.itemByName("None");',
            '  backgroundRect.strokeWeight = 0;',
            '  backgroundRect.name = "Page Background";',
            `  backgroundRect.transparencySettings.blendingSettings.opacity = ${op};`,
            '  backgroundRect.sendToBack();',
            `  out = "Page background set on page " + page.name + " with swatch " + sw.name + " at ${op}% opacity";`,
            '}',
        ];
        return run(pageScript(p, 'Error setting page background', body), 'Set Page Background');
    }
}
