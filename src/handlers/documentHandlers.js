/**
 * Comprehensive Document management handlers
 * Merged from documentHandlers.js and documentAdvancedHandlers.js
 *
 * Every script is ES3 (ExtendScript): no let/const/arrows/template literals in
 * the generated JSX and no JSON object. All caller values are interpolated
 * through the jsxSafe helpers (str, num, index, bool, enumOf, jsxPath).
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import {
    formatResponse, formatErrorResponse, str, num, index, bool, enumOf, ALLOWED, numList, measure,
    validateFilePath, jsxPath,
} from '../utils/stringUtils.js';
import { sessionManager } from '../core/sessionManager.js';
import {
    DOCUMENT_PREFERENCE_SPECS, LAYOUT_PREFERENCE_SPECS, UI_COLORS, PAGE_NUMBER_STYLES,
} from '../types/toolDefinitionsDocument.js';

// ---------------------------------------------------------------------------
// Script-building helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a script body that needs the active document. The body assigns the
 * output string to `result`; `doc` is the active document. With `mm`, the
 * script's measurement unit is millimetres while the body runs (restored
 * afterwards), so every measurement read or written as a number is in mm.
 */
function docScript(body, { errorPrefix = 'Error', mm = false } = {}) {
    const lines = ['var result = "";', 'if (app.documents.length === 0) {', '  result = "No document open";', '} else {'];
    if (mm) {
        lines.push('  var oldUnits = app.scriptPreferences.measurementUnit;');
        lines.push('  app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;');
    }
    lines.push('  try {', '    var doc = app.activeDocument;');
    for (const l of body) lines.push('    ' + l);
    lines.push('  } catch (error) {', `    result = ${str(errorPrefix + ': ')} + error.message;`, '  }');
    if (mm) lines.push('  app.scriptPreferences.measurementUnit = oldUnits;');
    lines.push('}', 'result;');
    return lines.join('\n');
}

/** JSX helper: format a value read from the DOM (arrays joined, numbers rounded). */
const FMT_FN = [
    'var fmt = function (v) {',
    '  if (v instanceof Array) { var parts = []; for (var fi = 0; fi < v.length; fi++) { parts.push(fmt(v[fi])); } return "[" + parts.join(", ") + "]"; }',
    '  if (typeof v === "number") { return String(Math.round(v * 1000) / 1000); }',
    '  return String(v);',
    '};',
];

/** JSX helper: escape "^" so findWhat/changeTo are matched literally by Text find/change. */
const TEXT_FIND_RESET = 'app.findTextPreferences = NothingEnum.NOTHING; app.changeTextPreferences = NothingEnum.NOTHING;';
const GREP_FIND_RESET = 'app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;';

function escapeTextFind(s) {
    return String(s).replace(/\^/g, '^^');
}

function toBool(value, name) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`Invalid value for '${name}': expected true or false, got ${JSON.stringify(value)}`);
}

/** A measurement: a number of millimetres, or a string with explicit units. */
function measureLit(value, name) {
    if (typeof value === 'number' || (typeof value === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(value))) {
        num(value, { name });
        return measure(Number(value), { unit: 'mm', name });
    }
    if (typeof value === 'string') {
        const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(mm|cm|in|pt|px|p)\s*$/i.exec(value);
        if (m) return str(`${Number(m[1])}${m[2].toLowerCase()}`);
    }
    throw new Error(`Invalid measurement for '${name}': ${JSON.stringify(value)}. Use a number of millimetres or a string such as "12pt".`);
}

/** JSX literal for a preference value according to its spec kind. */
function prefLiteral(key, spec, value) {
    switch (spec.kind) {
        case 'bool':
            return bool(toBool(value, key));
        case 'int': {
            // Range limits are enforced by InDesign itself (reported per property).
            if (!Number.isInteger(Number(value))) throw new Error(`Invalid value for '${key}': expected an integer`);
            return num(value, { name: key });
        }
        case 'number':
            return num(value, { name: key });
        case 'measure':
            return measureLit(value, key);
        case 'uiColor':
            if (Array.isArray(value)) {
                if (value.length !== 3) throw new Error(`Invalid value for '${key}': RGB colour needs 3 numbers`);
                return `[${numList(value, { name: key, min: 0, max: 255 })}]`;
            }
            return `UIColors.${enumOf(String(value).toUpperCase(), UI_COLORS, { name: key })}`;
        case 'enum':
            return `${spec.enumName}.${enumOf(value, spec.values, { name: key })}`;
        default:
            throw new Error(`Unsupported preference kind for '${key}'`);
    }
}

/** JSX lines that collect every page's marginPreferences (document and master pages). */
const MARGIN_TARGETS = [
    'var marginTargets = [doc.marginPreferences];',
    'for (var mp = 0; mp < doc.pages.length; mp++) { marginTargets.push(doc.pages[mp].marginPreferences); }',
    'for (var ms = 0; ms < doc.masterSpreads.length; ms++) {',
    '  for (var mq = 0; mq < doc.masterSpreads[ms].pages.length; mq++) { marginTargets.push(doc.masterSpreads[ms].pages[mq].marginPreferences); }',
    '}',
];

/**
 * JSX lines that set the given values on a preference group. Each property is
 * set in its own try/catch; outcomes go to the `done` / `failed` arrays.
 */
function buildPrefSetLines(groupKey, group, values) {
    if (values === undefined || values === null) return [];
    if (typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(`Invalid value for '${groupKey}': expected an object of properties`);
    }
    const lines = [];
    for (const [key, value] of Object.entries(values)) {
        const spec = Object.prototype.hasOwnProperty.call(group.props, key) ? group.props[key] : null;
        if (!spec) {
            throw new Error(`Invalid property '${key}' for '${groupKey}'. Allowed: ${Object.keys(group.props).join(', ')}`);
        }
        if (value === undefined || value === null) continue;
        const lit = prefLiteral(key, spec, value);
        const label = str(`${groupKey}.${key}`);
        const assign = groupKey === 'margins'
            ? `for (var mi = 0; mi < marginTargets.length; mi++) { marginTargets[mi].${key} = ${lit}; }`
            : `${group.target}.${key} = ${lit};`;
        lines.push(`try { ${assign} done.push(${label}); } catch (e) { failed.push(${label} + ": " + e.message); }`);
    }
    return lines;
}

/** JSX lines that turn `done` / `failed` into the result string. */
function prefOutcomeLines(what) {
    return [
        'if (failed.length > 0) {',
        `  result = "Error: could not set " + failed.length + " ${what}(s): " + failed.join("; ") + (done.length > 0 ? ". Set successfully: " + done.join(", ") : "");`,
        '} else {',
        `  result = "Updated " + done.length + " ${what}(s): " + done.join(", ");`,
        '}',
    ];
}

/** JSX lines that append every property of a preference group to `result`. */
function buildPrefGetLines(groupKey, group) {
    const lines = [`result += ${str(`\n=== ${group.title} ===\n`)};`];
    for (const key of Object.keys(group.props)) {
        lines.push(
            `try { result += ${str(key + ': ')} + fmt(${group.target}.${key}) + "\\n"; } ` +
            `catch (e) { result += ${str(key + ': (unavailable: ')} + e.message + ")\\n"; }`
        );
    }
    return lines;
}

/**
 * JSX function declarations used by validate/cleanup: count text that uses a
 * paragraph/character style anywhere (masters, hidden/locked layers, footnotes).
 */
const STYLE_USAGE_FNS = [
    'var prepareFind = function () {',
    '  app.findTextPreferences = NothingEnum.NOTHING;',
    '  app.findChangeTextOptions.includeMasterPages = true;',
    '  app.findChangeTextOptions.includeHiddenLayers = true;',
    '  app.findChangeTextOptions.includeLockedLayersForFind = true;',
    '  app.findChangeTextOptions.includeLockedStoriesForFind = true;',
    '  app.findChangeTextOptions.includeFootnotes = true;',
    '};',
    'var paraStyleUsed = function (st) {',
    '  prepareFind(); app.findTextPreferences.appliedParagraphStyle = st;',
    '  var n = doc.findText().length; app.findTextPreferences = NothingEnum.NOTHING; return n > 0;',
    '};',
    'var charStyleUsed = function (st) {',
    '  prepareFind(); app.findTextPreferences.appliedCharacterStyle = st;',
    '  var n = doc.findText().length; app.findTextPreferences = NothingEnum.NOTHING; return n > 0;',
    '};',
    'var isBuiltIn = function (name) { return String(name).charAt(0) === "["; };',
];

async function run(script, operation) {
    const result = await ScriptExecutor.executeInDesignScript(script);
    return formatResponse(result, operation);
}

export class DocumentHandlers {
    /**
     * Helper function to ensure we have an active document
     */
    static async ensureActiveDocument() {
        const script = [
            'var result;',
            'if (app.documents.length === 0) {',
            '  result = "No document open";',
            '} else {',
            '  try {',
            '    result = "Document already active: " + app.activeDocument.name;',
            '  } catch (e) {',
            '    app.activeDocument = app.documents[0];',
            '    result = "Document activated: " + app.activeDocument.name;',
            '  }',
            '}',
            'result;',
        ].join('\n');
        return run(script, 'Ensure Active Document');
    }

    /**
     * Get information about the active document
     */
    static async getDocumentInfo() {
        const script = docScript([
            ...FMT_FN,
            'var dp = doc.documentPreferences;',
            'var info = "=== DOCUMENT INFO ===\\n";',
            'info += "Name: " + doc.name + "\\n";',
            'var docPath = "Unsaved";',
            'try { if (doc.saved) { docPath = doc.fullName.fsName; } } catch (e) {}',
            'info += "Path: " + docPath + "\\n";',
            'info += "Modified: " + doc.modified + "\\n";',
            'info += "Pages: " + doc.pages.length + "\\n";',
            'info += "Spreads: " + doc.spreads.length + "\\n";',
            'info += "Layers: " + doc.layers.length + "\\n";',
            'info += "Master Spreads: " + doc.masterSpreads.length + "\\n";',
            'info += "Units: mm\\n";',
            'info += "Document Width: " + fmt(dp.pageWidth) + "\\n";',
            'info += "Document Height: " + fmt(dp.pageHeight) + "\\n";',
            'info += "Facing Pages: " + dp.facingPages + "\\n";',
            'info += "Page Orientation: " + dp.pageOrientation + "\\n";',
            'info += "Bleed Top: " + fmt(dp.documentBleedTopOffset) + "\\n";',
            'info += "Bleed Bottom: " + fmt(dp.documentBleedBottomOffset) + "\\n";',
            'info += "Bleed Inside: " + fmt(dp.documentBleedInsideOrLeftOffset) + "\\n";',
            'info += "Bleed Outside: " + fmt(dp.documentBleedOutsideOrRightOffset) + "\\n";',
            'info += "Margin Top: " + fmt(doc.marginPreferences.top) + "\\n";',
            'info += "Margin Bottom: " + fmt(doc.marginPreferences.bottom) + "\\n";',
            'info += "Margin Left: " + fmt(doc.marginPreferences.left) + "\\n";',
            'info += "Margin Right: " + fmt(doc.marginPreferences.right) + "\\n";',
            'try { info += "Cloud Document: " + doc.isCloudDocument + "\\n"; } catch (e) {}',
            'result = info;',
        ], { errorPrefix: 'Error getting document info', mm: true });

        const result = await ScriptExecutor.executeInDesignScript(script);

        // Store document info in session manager
        if (typeof result === 'string' && result.includes('=== DOCUMENT INFO ===')) {
            const docInfo = {
                name: result.match(/Name: (.+)/)?.[1] || 'Unknown',
                path: result.match(/Path: (.+)/)?.[1] || 'Unsaved',
                pages: parseInt(result.match(/Pages: (\d+)/)?.[1] || '0'),
                width: parseFloat(result.match(/Document Width: ([\d.]+)/)?.[1] || '0'),
                height: parseFloat(result.match(/Document Height: ([\d.]+)/)?.[1] || '0'),
            };
            sessionManager.setActiveDocument(docInfo);
            sessionManager.setPageDimensions({ width: docInfo.width, height: docInfo.height });
        }

        return formatResponse(result, 'Get Document Info');
    }

    /**
     * Create a new document
     */
    static async createDocument(args = {}) {
        const {
            width = 210,
            height = 297,
            pages = 1,
            facingPages = false,
            pageOrientation = 'PORTRAIT',
            bleedTop = 3,
            bleedBottom = 3,
            bleedInside = 3,
            bleedOutside = 3,
            marginTop = 20,
            marginBottom = 20,
            marginLeft = 20,
            marginRight = 20,
        } = args;

        const orient = enumOf(pageOrientation, ALLOWED.pageOrientation, { name: 'pageOrientation' });
        let w = Number(num(width, { name: 'width', min: 1, max: 5486 }));
        let h = Number(num(height, { name: 'height', min: 1, max: 5486 }));
        // Make the dimensions agree with the requested orientation.
        if ((orient === 'LANDSCAPE' && w < h) || (orient === 'PORTRAIT' && w > h)) [w, h] = [h, w];
        const pageCount = Number(index(pages, { name: 'pages', max: 9999 }));
        if (pageCount < 1) throw new Error("Invalid value for 'pages': must be at least 1");
        const mm = (v, name) => measure(Number(num(v, { name, min: 0, max: 5486 })), { unit: 'mm', name });

        const script = [
            'var result;',
            'try {',
            '  var doc = app.documents.add();',
            '  var dp = doc.documentPreferences;',
            `  dp.facingPages = ${bool(facingPages)};`,
            `  dp.pagesPerDocument = ${pageCount};`,
            `  dp.pageWidth = ${mm(w, 'width')};`,
            `  dp.pageHeight = ${mm(h, 'height')};`,
            `  dp.pageOrientation = PageOrientation.${orient};`,
            '  dp.documentBleedUniformSize = false;',
            `  dp.documentBleedTopOffset = ${mm(bleedTop, 'bleedTop')};`,
            `  dp.documentBleedBottomOffset = ${mm(bleedBottom, 'bleedBottom')};`,
            `  dp.documentBleedInsideOrLeftOffset = ${mm(bleedInside, 'bleedInside')};`,
            `  dp.documentBleedOutsideOrRightOffset = ${mm(bleedOutside, 'bleedOutside')};`,
            // Document margin preferences only affect new pages, so apply to every page too.
            ...MARGIN_TARGETS.map((l) => '  ' + l),
            '  for (var mi = 0; mi < marginTargets.length; mi++) {',
            `    marginTargets[mi].top = ${mm(marginTop, 'marginTop')};`,
            `    marginTargets[mi].bottom = ${mm(marginBottom, 'marginBottom')};`,
            `    marginTargets[mi].left = ${mm(marginLeft, 'marginLeft')};`,
            `    marginTargets[mi].right = ${mm(marginRight, 'marginRight')};`,
            '  }',
            '  app.activeDocument = doc;',
            '  result = "Document created and activated successfully. Pages: " + doc.pages.length + ". Document name: " + doc.name;',
            '} catch (error) {',
            '  result = "Error creating document: " + error.message;',
            '}',
            'result;',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        const isSuccess = typeof result === 'string' && result.includes('Document created and activated successfully');

        if (isSuccess) {
            sessionManager.setActiveDocument({
                name: result.match(/Document name: (.+)/)?.[1] || 'New Document',
                path: 'Unsaved',
                pages: pageCount,
                width: w,
                height: h,
            });
            sessionManager.setPageDimensions({ width: w, height: h });
        }

        return isSuccess ? formatResponse(result, 'Create Document') : formatErrorResponse(result, 'Create Document');
    }

    /**
     * Open an existing document
     */
    static async openDocument(args = {}) {
        const resolved = validateFilePath(args.filePath);
        const jsx = jsxPath(resolved);

        const script = [
            'var result;',
            `var file = File(${jsx});`,
            'if (!file.exists) {',
            `  result = "Error: file not found: " + ${jsx};`,
            '} else {',
            // Missing fonts/links would otherwise raise modal alerts and block the call.
            '  var uil = app.scriptPreferences.userInteractionLevel;',
            '  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;',
            '  try {',
            '    app.open(file);',
            `    result = "Document opened: " + app.activeDocument.name + " (" + ${jsx} + ")";`,
            '  } catch (error) {',
            '    result = "Error opening document: " + error.message;',
            '  }',
            '  app.scriptPreferences.userInteractionLevel = uil;',
            '}',
            'result;',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        const ok = String(result).includes('Document opened:');
        return ok ? formatResponse(result, 'Open Document') : formatErrorResponse(result, 'Open Document');
    }

    /**
     * Save the active document (Save As when filePath is given, else in place)
     */
    static async saveDocument(args = {}) {
        const { filePath } = args;
        let body;
        if (filePath) {
            const jsx = jsxPath(validateFilePath(filePath));
            body = [
                `var file = File(${jsx});`,
                'if (!file.parent.exists) {',
                '  result = "Error: folder does not exist: " + file.parent.fsName;',
                '} else {',
                '  doc = doc.save(file);',
                '  result = "Document saved: " + file.fsName;',
                '}',
            ];
        } else {
            body = [
                'if (!doc.saved) {',
                '  result = "Error: the document has never been saved; provide filePath";',
                '} else {',
                '  doc.save();',
                '  result = "Document saved: " + doc.fullName.fsName;',
                '}',
            ];
        }
        const result = await ScriptExecutor.executeInDesignScript(docScript(body, { errorPrefix: 'Error saving document' }));
        const ok = String(result).includes('Document saved:');
        return ok ? formatResponse(result, 'Save Document') : formatErrorResponse(result, 'Save Document');
    }

    /**
     * Close the active document without saving
     */
    static async closeDocument() {
        const script = docScript([
            'var docName = doc.name;',
            'doc.close(SaveOptions.NO);',
            'result = "Document closed (changes not saved): " + docName;',
        ], { errorPrefix: 'Error closing document' });
        return run(script, 'Close Document');
    }

    // =================== DOCUMENT ADVANCED TOOLS ===================

    /**
     * Run preflight on the document
     */
    static async preflightDocument(args = {}) {
        const { profile = '[Basic]', reportPath, maxResults = 50, timeoutSeconds = 60 } = args;
        const max = index(maxResults, { name: 'maxResults', max: 100000 });
        const timeout = num(timeoutSeconds, { name: 'timeoutSeconds', min: 1, max: 3600 });
        const reportJsx = reportPath ? jsxPath(validateFilePath(reportPath)) : null;
        const name = String(profile);
        const bare = name.replace(/^\[(.*)\]$/, '$1');

        const script = docScript([
            'var prof = null;',
            `var candidates = [${str(name)}, ${str('[' + bare + ']')}, ${str(bare)}];`,
            'for (var ci = 0; ci < candidates.length && !prof; ci++) {',
            '  var p1 = doc.preflightProfiles.itemByName(candidates[ci]);',
            '  if (p1.isValid) { prof = p1; break; }',
            '  var p2 = app.preflightProfiles.itemByName(candidates[ci]);',
            '  if (p2.isValid) { prof = p2; break; }',
            '}',
            'if (!prof) {',
            '  var names = [];',
            '  for (var pi = 0; pi < app.preflightProfiles.length; pi++) { names.push(app.preflightProfiles[pi].name); }',
            `  result = "Error: preflight profile not found: " + ${str(name)} + ". Available: " + names.join(", ");`,
            '} else {',
            '  var proc = app.preflightProcesses.add(doc, prof);',
            `  var finished = proc.waitForProcess(${timeout});`,
            '  if (!finished) {',
            `    result = "Error: preflight did not finish within " + ${timeout} + " seconds";`,
            '  } else {',
            '    var agg = proc.aggregatedResults;',
            '    var problems = (agg && agg.length > 2 && agg[2]) ? agg[2] : [];',
            '    var out = "Preflight with profile " + prof.name + ": " + problems.length + " problem(s) found";',
            `    for (var i = 0; i < problems.length && i < ${max}; i++) {`,
            '      var pr = problems[i];',
            '      out += "\\n- " + pr[1];',
            '      if (pr[2]) { out += " (page " + pr[2] + ")"; }',
            '      if (pr[3]) { out += ": " + pr[3]; }',
            '    }',
            `    if (problems.length > ${max}) { out += "\\n... " + (problems.length - ${max}) + " more"; }`,
            ...(reportJsx ? [
                `    var reportFile = File(${reportJsx});`,
                '    proc.saveReport(reportFile);',
                '    out += "\\nReport saved: " + reportFile.fsName;',
            ] : []),
            '    result = out;',
            '  }',
            '  proc.remove();',
            '}',
        ], { errorPrefix: 'Error preflighting document' });
        return run(script, 'Preflight Document');
    }

    /**
     * Show a page in the layout window (fit page, or a given zoom percentage)
     */
    static async zoomToPage(args = {}) {
        const { pageIndex, zoomLevel } = args;
        const idx = index(pageIndex, { name: 'pageIndex' });
        const zoom = (zoomLevel === undefined || zoomLevel === null) ? null : num(zoomLevel, { name: 'zoomLevel', min: 5, max: 4000 });

        const script = docScript([
            `if (${idx} >= doc.pages.length) {`,
            `  result = "Error: page index ${idx} out of range (document has " + doc.pages.length + " pages)";`,
            '} else if (doc.layoutWindows.length === 0) {',
            '  result = "Cannot zoom: the document has no open layout window";',
            '} else {',
            '  var win = doc.layoutWindows[0];',
            `  var page = doc.pages[${idx}];`,
            '  win.activePage = page;',
            zoom === null ? '  win.zoom(ZoomOptions.FIT_PAGE);' : `  win.zoomPercentage = ${zoom};`,
            '  result = "Showing page " + page.name + " at " + Math.round(win.zoomPercentage) + "%";',
            '}',
        ], { errorPrefix: 'Error zooming to page' });
        return run(script, 'Zoom to Page');
    }

    /**
     * Data merge: select the data source and optionally merge records
     */
    static async dataMerge(args = {}) {
        const {
            dataSource, mergeRecords = true, recordSelection = 'ALL_RECORDS', recordNumber, recordRange,
            recordsPerPage = 'SINGLE_RECORD', createNewDocument = true, removeBlankLines = false,
        } = args;
        const jsx = jsxPath(validateFilePath(dataSource));
        const selection = enumOf(recordSelection, ['ALL_RECORDS', 'ONE_RECORD', 'RANGE'], { name: 'recordSelection' });
        const perPage = enumOf(recordsPerPage, ['SINGLE_RECORD', 'MULTIPLE_RECORD'], { name: 'recordsPerPage' });

        const mergeLines = [
            'var dmp = dm.dataMergePreferences;',
            `dmp.recordSelection = RecordSelection.${selection};`,
        ];
        if (selection === 'ONE_RECORD') {
            if (recordNumber === undefined) throw new Error("Invalid arguments: 'recordNumber' is required when recordSelection is ONE_RECORD");
            const n = Number(index(recordNumber, { name: 'recordNumber' }));
            if (n < 1) throw new Error("Invalid value for 'recordNumber': must be at least 1");
            mergeLines.push(`dmp.recordNumber = ${n};`);
        }
        if (selection === 'RANGE') {
            if (typeof recordRange !== 'string' || !/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(recordRange)) {
                throw new Error(`Invalid value for 'recordRange': ${JSON.stringify(recordRange)}. Use e.g. "1-5,8"`);
            }
            mergeLines.push(`dmp.recordRange = ${str(recordRange.replace(/\s+/g, ''))};`);
        }
        mergeLines.push(
            `dmp.recordsPerPage = RecordsPerPage.${perPage};`,
            `doc.dataMergeOptions.createNewDocument = ${bool(createNewDocument)};`,
            `doc.dataMergeOptions.removeBlankLines = ${bool(removeBlankLines)};`,
            'var docsBefore = app.documents.length;',
            'dm.mergeRecords();',
            'result = "Data merge completed using " + fields.length + " field(s): " + fields.join(", ");',
            'if (app.documents.length > docsBefore) { result += ". Merged document: " + app.activeDocument.name; }',
        );

        const script = docScript([
            `var dataFile = File(${jsx});`,
            'if (!dataFile.exists) {',
            `  result = "Error: data source file not found: " + ${jsx};`,
            '} else {',
            '  var dm = doc.dataMergeProperties;',
            '  dm.selectDataSource(dataFile);',
            '  var fields = [];',
            '  for (var i = 0; i < dm.dataMergeFields.length; i++) { fields.push(dm.dataMergeFields[i].fieldName); }',
            ...(toBool(mergeRecords, 'mergeRecords')
                ? mergeLines.map((l) => '  ' + l)
                : ['  result = "Data source selected. Fields (" + fields.length + "): " + fields.join(", ");']),
            '}',
        ], { errorPrefix: 'Error performing data merge' });
        return run(script, 'Data Merge');
    }

    // =================== DOCUMENT ELEMENTS & STYLES ===================

    /**
     * Count elements in the document
     */
    static async getDocumentElements(args = {}) {
        const type = enumOf(args.elementType ?? 'all', ['all', 'text', 'graphics', 'tables'], { name: 'elementType' });
        const want = (t) => type === 'all' || type === t;

        const body = [
            'var items = doc.allPageItems;',
            'var c = { tf: 0, rect: 0, oval: 0, poly: 0, line: 0, grp: 0 };',
            'for (var i = 0; i < items.length; i++) {',
            '  var it = items[i];',
            '  if (it instanceof TextFrame) { c.tf++; }',
            '  else if (it instanceof Rectangle) { c.rect++; }',
            '  else if (it instanceof Oval) { c.oval++; }',
            '  else if (it instanceof Polygon) { c.poly++; }',
            '  else if (it instanceof GraphicLine) { c.line++; }',
            '  else if (it instanceof Group) { c.grp++; }',
            '}',
            'var out = "Document Elements:\\n";',
        ];
        if (want('text')) {
            body.push('out += "Text Frames: " + c.tf + "\\n";', 'out += "Stories: " + doc.stories.length + "\\n";');
        }
        if (want('graphics')) {
            body.push(
                'out += "Rectangles: " + c.rect + "\\n";',
                'out += "Ovals: " + c.oval + "\\n";',
                'out += "Polygons: " + c.poly + "\\n";',
                'out += "Graphic Lines: " + c.line + "\\n";',
                'out += "Placed Graphics: " + doc.allGraphics.length + "\\n";',
            );
        }
        if (want('tables')) {
            body.push(
                'var tableCount = 0;',
                'for (var s = 0; s < doc.stories.length; s++) { tableCount += doc.stories[s].tables.length; }',
                'out += "Tables: " + tableCount + "\\n";',
            );
        }
        if (type === 'all') {
            body.push(
                'out += "Groups: " + c.grp + "\\n";',
                'out += "All Page Items: " + items.length + "\\n";',
                'out += "Layers: " + doc.layers.length + "\\n";',
            );
        }
        body.push('result = out;');
        return run(docScript(body, { errorPrefix: 'Error getting document elements' }), 'Get Document Elements');
    }

    /**
     * List styles of one type
     */
    static async getDocumentStyles(args = {}) {
        const type = enumOf(args.styleType ?? 'PARAGRAPH', ['PARAGRAPH', 'CHARACTER', 'OBJECT', 'TABLE', 'CELL'], { name: 'styleType' });
        const collection = {
            PARAGRAPH: 'doc.allParagraphStyles',
            CHARACTER: 'doc.allCharacterStyles',
            OBJECT: 'doc.allObjectStyles',
            TABLE: 'doc.allTableStyles',
            CELL: 'doc.allCellStyles',
        }[type];

        const script = docScript([
            `var styles = ${collection};`,
            `var out = ${str(`Document Styles (${type}):\n`)} + "Count: " + styles.length + "\\n";`,
            'for (var i = 0; i < styles.length; i++) { out += "- " + styles[i].name + "\\n"; }',
            'result = out;',
        ], { errorPrefix: 'Error getting document styles' });
        return run(script, 'Get Document Styles');
    }

    /**
     * List colors, swatches, gradients and tints
     */
    static async getDocumentColors(args = {}) {
        const { includeSwatches = true, includeGradients = true, includeTints = true } = args;
        const body = [
            'var out = "Document Colors:\\n";',
            'out += "Colors: " + doc.colors.length + "\\n";',
            'for (var i = 0; i < doc.colors.length; i++) {',
            '  var col = doc.colors[i];',
            '  out += "- " + col.name + " (" + col.model + ", " + col.space + ")\\n";',
            '}',
        ];
        if (toBool(includeSwatches, 'includeSwatches')) {
            body.push(
                'out += "\\nSwatches: " + doc.swatches.length + "\\n";',
                'for (var s = 0; s < doc.swatches.length; s++) { out += "- " + doc.swatches[s].name + "\\n"; }',
            );
        }
        if (toBool(includeGradients, 'includeGradients')) {
            body.push(
                'out += "\\nGradients: " + doc.gradients.length + "\\n";',
                'for (var g = 0; g < doc.gradients.length; g++) { out += "- " + doc.gradients[g].name + "\\n"; }',
            );
        }
        if (toBool(includeTints, 'includeTints')) {
            body.push(
                'out += "\\nTints: " + doc.tints.length + "\\n";',
                'for (var t = 0; t < doc.tints.length; t++) { out += "- " + doc.tints[t].name + "\\n"; }',
            );
        }
        body.push('result = out;');
        return run(docScript(body, { errorPrefix: 'Error getting document colors' }), 'Get Document Colors');
    }

    // =================== DOCUMENT PREFERENCES ===================

    /**
     * Read document preferences (measurements in mm)
     */
    static async getDocumentPreferences(args = {}) {
        const type = enumOf(args.preferenceType ?? 'GENERAL', ['GENERAL', 'MARGINS', 'GUIDES', 'TEXT', 'GRID', 'ALL'], { name: 'preferenceType' });
        const groups = type === 'ALL' ? Object.keys(DOCUMENT_PREFERENCE_SPECS) : [type.toLowerCase()];
        const body = [...FMT_FN, `result = ${str(`Document Preferences (${type}), measurements in mm:\n`)};`];
        for (const g of groups) body.push(...buildPrefGetLines(g, DOCUMENT_PREFERENCE_SPECS[g]));
        return run(docScript(body, { errorPrefix: 'Error getting document preferences', mm: true }), 'Get Document Preferences');
    }

    /**
     * Set document preferences, grouped by preference object
     */
    static async setDocumentPreferences(args = {}) {
        const known = Object.keys(DOCUMENT_PREFERENCE_SPECS);
        for (const k of Object.keys(args)) {
            if (!known.includes(k)) throw new Error(`Invalid argument '${k}'. Expected one or more of: ${known.join(', ')}`);
        }
        const setLines = [];
        for (const g of known) setLines.push(...buildPrefSetLines(g, DOCUMENT_PREFERENCE_SPECS[g], args[g]));
        if (setLines.length === 0) {
            throw new Error(`Invalid arguments: no preference values given. Pass one or more of: ${known.join(', ')}`);
        }
        const body = [
            'var done = []; var failed = [];',
            ...(args.margins ? MARGIN_TARGETS : []),
            ...setLines,
            ...prefOutcomeLines('document preference'),
        ];
        return run(docScript(body, { errorPrefix: 'Error updating document preferences', mm: true }), 'Set Document Preferences');
    }

    // =================== DOCUMENT STORIES & TEXT ===================

    /**
     * List stories with overset status
     */
    static async getDocumentStories(args = {}) {
        const oversetOnly = toBool(args.oversetOnly ?? false, 'oversetOnly');
        const max = index(args.maxStories ?? 100, { name: 'maxStories' });

        const script = docScript([
            'var out = "Document Stories:\\n";',
            'var listed = 0; var matched = 0; var oversetCount = 0;',
            'for (var i = 0; i < doc.stories.length; i++) {',
            '  var story = doc.stories[i];',
            '  var over = story.overflows;',
            '  if (over) { oversetCount++; }',
            `  if (${bool(oversetOnly)} && !over) { continue; }`,
            '  matched++;',
            `  if (listed >= ${max}) { continue; }`,
            '  listed++;',
            '  var text = String(story.contents);',
            '  var preview = text.substring(0, 60).replace(/[\\r\\n\\t]+/g, " ");',
            '  out += "Story id " + story.id + ": " + story.length + " chars, " + story.textContainers.length + " frame(s), overset: " + over + "\\n";',
            '  out += "  Preview: " + preview + (text.length > 60 ? "..." : "") + "\\n";',
            '}',
            `if (matched > listed) { out += "... " + (matched - listed) + " more not listed\\n"; }`,
            'out += "Total Stories: " + doc.stories.length + " (overset: " + oversetCount + ")";',
            'result = out;',
        ], { errorPrefix: 'Error getting document stories' });
        return run(script, 'Get Document Stories');
    }

    /**
     * Find (and optionally replace) text across the document
     */
    static async findTextInDocument(args = {}) {
        const { searchText, replaceText, caseSensitive = false, wholeWord = false, useRegex = false } = args;
        if (typeof searchText !== 'string' || searchText === '') throw new Error("Invalid arguments: 'searchText' must be a non-empty string");
        const replacing = replaceText !== undefined && replaceText !== null;
        const cs = toBool(caseSensitive, 'caseSensitive');
        const ww = toBool(wholeWord, 'wholeWord');
        const regex = toBool(useRegex, 'useRegex');

        let body;
        if (regex) {
            // GREP has no case/whole-word options: express them in the pattern.
            let pattern = searchText;
            if (ww) pattern = `\\b(?:${pattern})\\b`;
            if (!cs) pattern = `(?i)${pattern}`;
            body = [
                GREP_FIND_RESET,
                `app.findGrepPreferences.findWhat = ${str(pattern)};`,
                ...(replacing ? [
                    `app.changeGrepPreferences.changeTo = ${str(String(replaceText))};`,
                    'var found = doc.changeGrep();',
                ] : ['var found = doc.findGrep();']),
                GREP_FIND_RESET,
            ];
        } else {
            body = [
                TEXT_FIND_RESET,
                `app.findChangeTextOptions.caseSensitive = ${bool(cs)};`,
                `app.findChangeTextOptions.wholeWord = ${bool(ww)};`,
                `app.findTextPreferences.findWhat = ${str(escapeTextFind(searchText))};`,
                ...(replacing ? [
                    `app.changeTextPreferences.changeTo = ${str(escapeTextFind(String(replaceText)))};`,
                    'var found = doc.changeText();',
                ] : ['var found = doc.findText();']),
                TEXT_FIND_RESET,
            ];
        }
        body.push(
            `var out = ${str(replacing ? 'Replaced ' : 'Found ')} + found.length + ${str(` match(es) of "${searchText}"`)};`,
            'for (var i = 0; i < found.length && i < 20; i++) {',
            '  var where = "overset";',
            '  try { var frames = found[i].parentTextFrames; if (frames.length > 0 && frames[0].parentPage) { where = "page " + frames[0].parentPage.name; } } catch (e) {}',
            '  out += "\\n- " + String(found[i].contents).substring(0, 60) + " (" + where + ")";',
            '}',
            'if (found.length > 20) { out += "\\n... " + (found.length - 20) + " more"; }',
            'result = out;',
        );
        return run(docScript(body, { errorPrefix: 'Error during find/replace' }), 'Find Text in Document');
    }

    // =================== DOCUMENT LAYERS & ORGANIZATION ===================

    /**
     * List layers
     */
    static async getDocumentLayers(args = {}) {
        const includeHidden = toBool(args.includeHidden ?? true, 'includeHidden');
        const includeLocked = toBool(args.includeLocked ?? true, 'includeLocked');

        const script = docScript([
            'var out = "Document Layers (top to bottom):\\n";',
            'var listed = 0;',
            'for (var i = 0; i < doc.layers.length; i++) {',
            '  var layer = doc.layers[i];',
            `  if (!${bool(includeHidden)} && !layer.visible) { continue; }`,
            `  if (!${bool(includeLocked)} && layer.locked) { continue; }`,
            '  listed++;',
            '  out += "Layer " + (i + 1) + ": " + layer.name + "\\n";',
            '  out += "  Visible: " + layer.visible + ", Locked: " + layer.locked + ", Printable: " + layer.printable + "\\n";',
            '  out += "  Page Items: " + layer.allPageItems.length + "\\n";',
            '}',
            'out += "Listed " + listed + " of " + doc.layers.length + " layer(s)";',
            'result = out;',
        ], { errorPrefix: 'Error getting document layers' });
        return run(script, 'Get Document Layers');
    }

    /**
     * Merge duplicate-named layers, delete empty layers, sort layers
     */
    static async organizeDocumentLayers(args = {}) {
        const merge = toBool(args.mergeSimilarLayers ?? false, 'mergeSimilarLayers');
        const del = toBool(args.deleteEmptyLayers ?? false, 'deleteEmptyLayers');
        const sort = toBool(args.sortLayers ?? false, 'sortLayers');
        if (!merge && !del && !sort) {
            throw new Error('Invalid arguments: enable at least one of mergeSimilarLayers, deleteEmptyLayers, sortLayers');
        }

        const body = ['var actions = []; var problems = [];'];
        if (merge) {
            body.push(
                'var normName = function (n) { return String(n).toLowerCase().replace(/\\s+copy(\\s+\\d+)?\\s*$/, "").replace(/^\\s+|\\s+$/g, ""); };',
                'var groups = {}; var order = [];',
                'for (var i = 0; i < doc.layers.length; i++) {',
                '  var key = "k_" + normName(doc.layers[i].name);',
                '  if (!groups[key]) { groups[key] = []; order.push(key); }',
                '  groups[key].push(doc.layers[i]);',
                '}',
                'for (var g = 0; g < order.length; g++) {',
                '  var grp = groups[order[g]];',
                '  if (grp.length < 2) { continue; }',
                '  var names = []; for (var n = 1; n < grp.length; n++) { names.push(grp[n].name); }',
                '  try { grp[0].merge(grp.slice(1)); actions.push("Merged " + names.join(", ") + " into " + grp[0].name); }',
                '  catch (e) { problems.push("Could not merge into " + grp[0].name + ": " + e.message); }',
                '}',
            );
        }
        if (del) {
            body.push(
                'for (var d = doc.layers.length - 1; d >= 0; d--) {',
                '  var lay = doc.layers[d];',
                '  if (doc.layers.length <= 1) { break; }',
                '  if (lay.allPageItems.length === 0 && lay.guides.length === 0) {',
                '    var lname = lay.name;',
                '    try { lay.remove(); actions.push("Deleted empty layer " + lname); }',
                '    catch (e) { problems.push("Could not delete " + lname + ": " + e.message); }',
                '  }',
                '}',
            );
        }
        if (sort) {
            body.push(
                'var sorted = [];',
                'for (var si = 0; si < doc.layers.length; si++) { sorted.push(doc.layers[si].name); }',
                'sorted.sort(function (a, b) { var x = a.toLowerCase(); var y = b.toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); });',
                'try {',
                '  var first = doc.layers.itemByName(sorted[0]);',
                '  if (doc.layers[0].name !== sorted[0]) { first.move(LocationOptions.BEFORE, doc.layers[0]); }',
                '  for (var sj = 1; sj < sorted.length; sj++) {',
                '    doc.layers.itemByName(sorted[sj]).move(LocationOptions.AFTER, doc.layers.itemByName(sorted[sj - 1]));',
                '  }',
                '  actions.push("Sorted " + sorted.length + " layer(s) alphabetically");',
                '} catch (e) { problems.push("Could not sort layers: " + e.message); }',
            );
        }
        body.push(
            'if (problems.length > 0) {',
            '  result = "Error: some layer operations failed: " + problems.join("; ") + (actions.length > 0 ? ". Completed: " + actions.join("; ") : "");',
            '} else {',
            '  result = "Layer organization completed. " + (actions.length > 0 ? actions.join("; ") : "Nothing needed changing.");',
            '}',
        );
        return run(docScript(body, { errorPrefix: 'Error organizing layers' }), 'Organize Document Layers');
    }

    // =================== DOCUMENT HYPERLINKS & INTERACTIVITY ===================

    /**
     * List hyperlinks
     */
    static async getDocumentHyperlinks(args = {}) {
        const withDest = toBool(args.includeDestinations ?? true, 'includeDestinations');
        const withSrc = toBool(args.includeSources ?? true, 'includeSources');
        const body = [
            'var out = "Document Hyperlinks:\\n";',
            'for (var i = 0; i < doc.hyperlinks.length; i++) {',
            '  var link = doc.hyperlinks[i];',
            '  out += "Hyperlink " + (i + 1) + ": " + link.name + "\\n";',
        ];
        if (withSrc) {
            body.push(
                '  try {',
                '    var src = link.source;',
                '    if (src instanceof HyperlinkTextSource) { out += "  Source text: " + String(src.sourceText.contents).substring(0, 80) + "\\n"; }',
                '    else { out += "  Source: " + src.name + "\\n"; }',
                '  } catch (e) { out += "  Source: (unavailable)\\n"; }',
            );
        }
        if (withDest) {
            body.push(
                '  try {',
                '    var dest = link.destination;',
                '    if (!dest) { out += "  Destination: (none)\\n"; }',
                '    else if (dest instanceof HyperlinkURLDestination) { out += "  Destination URL: " + dest.destinationURL + "\\n"; }',
                '    else if (dest instanceof HyperlinkPageDestination) { out += "  Destination page: " + dest.destinationPage.name + "\\n"; }',
                '    else if (dest instanceof HyperlinkTextDestination) { out += "  Destination text anchor: " + dest.name + "\\n"; }',
                '    else { out += "  Destination: " + dest.name + "\\n"; }',
                '  } catch (e) { out += "  Destination: (unavailable)\\n"; }',
            );
        }
        body.push('}', 'out += "Total Hyperlinks: " + doc.hyperlinks.length;', 'result = out;');
        return run(docScript(body, { errorPrefix: 'Error getting hyperlinks' }), 'Get Document Hyperlinks');
    }

    /**
     * Create a hyperlink on existing text
     */
    static async createDocumentHyperlink(args = {}) {
        const { sourceText, destination, linkType = 'URL', pageIndex, name } = args;
        if (typeof sourceText !== 'string' || sourceText === '') throw new Error("Invalid arguments: 'sourceText' must be a non-empty string");
        const type = enumOf(linkType, ['URL', 'PAGE', 'TEXT'], { name: 'linkType' });

        const findFirst = (varName, text) => [
            TEXT_FIND_RESET,
            'app.findChangeTextOptions.caseSensitive = true;',
            'app.findChangeTextOptions.wholeWord = false;',
            `app.findTextPreferences.findWhat = ${str(escapeTextFind(text))};`,
            `var ${varName} = doc.findText();`,
            TEXT_FIND_RESET,
        ];

        const destLines = [];
        if (type === 'URL') {
            if (typeof destination !== 'string' || destination === '') throw new Error("Invalid arguments: 'destination' (the URL) is required for URL links");
            destLines.push(`var dest = doc.hyperlinkURLDestinations.add(${str(destination)});`, `var destLabel = ${str(destination)};`);
        } else if (type === 'PAGE') {
            if (pageIndex === undefined || pageIndex === null) throw new Error("Invalid arguments: 'pageIndex' is required for PAGE links");
            const idx = index(pageIndex, { name: 'pageIndex' });
            destLines.push(
                `if (${idx} >= doc.pages.length) { throw new Error("page index ${idx} out of range (document has " + doc.pages.length + " pages)"); }`,
                `var dest = doc.hyperlinkPageDestinations.add(doc.pages[${idx}]);`,
                `var destLabel = "page " + doc.pages[${idx}].name;`,
            );
        } else {
            if (typeof destination !== 'string' || destination === '') throw new Error("Invalid arguments: 'destination' (text to link to) is required for TEXT links");
            destLines.push(
                ...findFirst('destHits', destination),
                `if (destHits.length === 0) { throw new Error("destination text not found: " + ${str(destination)}); }`,
                'var dest = doc.hyperlinkTextDestinations.add(destHits[0]);',
                `var destLabel = "text " + ${str(JSON.stringify(destination))};`,
            );
        }

        const script = docScript([
            ...findFirst('hits', sourceText),
            'if (hits.length === 0) {',
            `  result = "Error: source text not found: " + ${str(sourceText)};`,
            '} else {',
            ...destLines.map((l) => '  ' + l),
            // A text range can only be the source of one hyperlink; drop the new destination if this fails.
            '  var src;',
            '  try { src = doc.hyperlinkTextSources.add(hits[0]); }',
            '  catch (srcError) { try { dest.remove(); } catch (e) {} throw srcError; }',
            '  var link = doc.hyperlinks.add(src, dest);',
            ...(name ? [`  link.name = ${str(name)};`] : []),
            '  result = "Hyperlink created: " + link.name + " -> " + destLabel;',
            '}',
        ], { errorPrefix: 'Error creating hyperlink' });
        return run(script, 'Create Document Hyperlink');
    }

    // =================== DOCUMENT SECTIONS & NUMBERING ===================

    /**
     * List sections
     */
    static async getDocumentSections() {
        const script = docScript([
            'var out = "Document Sections:\\n";',
            'for (var i = 0; i < doc.sections.length; i++) {',
            '  var section = doc.sections[i];',
            '  out += "Section " + (i + 1) + (section.name ? " (" + section.name + ")" : "") + "\\n";',
            '  out += "  Starts on page: " + section.pageStart.name + " (index " + section.pageStart.documentOffset + ")\\n";',
            '  out += "  Pages: " + section.length + "\\n";',
            '  out += "  Numbering: " + section.pageNumberStyle + (section.continueNumbering ? ", continued" : ", starts at " + section.pageNumberStart) + "\\n";',
            '  out += "  Prefix: " + section.sectionPrefix + " (included: " + section.includeSectionPrefix + ")\\n";',
            '  out += "  Marker: " + section.marker + "\\n";',
            '}',
            'out += "Total Sections: " + doc.sections.length;',
            'result = out;',
        ], { errorPrefix: 'Error getting sections' });
        return run(script, 'Get Document Sections');
    }

    /**
     * Start (or update) a section at a page
     */
    static async createDocumentSection(args = {}) {
        const { startPage, sectionPrefix, includeSectionPrefix, marker, startNumber, numberingStyle = 'ARABIC' } = args;
        const idx = index(startPage, { name: 'startPage' });
        // Accept the older alias names as well as the real PageNumberStyle members.
        const aliases = { ROMAN_UPPER: 'UPPER_ROMAN', ROMAN_LOWER: 'LOWER_ROMAN', LETTER_UPPER: 'UPPER_LETTERS', LETTER_LOWER: 'LOWER_LETTERS' };
        const style = enumOf(aliases[numberingStyle] || numberingStyle, PAGE_NUMBER_STYLES, { name: 'numberingStyle' });

        const setLines = [`section.pageNumberStyle = PageNumberStyle.${style};`];
        if (startNumber !== undefined && startNumber !== null) {
            const n = Number(index(startNumber, { name: 'startNumber', max: 999999 }));
            if (n < 1) throw new Error("Invalid value for 'startNumber': must be at least 1");
            setLines.push('section.continueNumbering = false;', `section.pageNumberStart = ${n};`);
        } else {
            setLines.push('section.continueNumbering = true;');
        }
        if (sectionPrefix !== undefined && sectionPrefix !== null) setLines.push(`section.sectionPrefix = ${str(sectionPrefix)};`);
        if (includeSectionPrefix !== undefined && includeSectionPrefix !== null) {
            setLines.push(`section.includeSectionPrefix = ${bool(toBool(includeSectionPrefix, 'includeSectionPrefix'))};`);
        }
        if (marker !== undefined && marker !== null) setLines.push(`section.marker = ${str(marker)};`);

        const script = docScript([
            `if (${idx} >= doc.pages.length) {`,
            `  result = "Error: page index ${idx} out of range (document has " + doc.pages.length + " pages)";`,
            '} else {',
            `  var page = doc.pages[${idx}];`,
            '  var section; var existed = false;',
            '  if (page.appliedSection.pageStart.id === page.id) { section = page.appliedSection; existed = true; }',
            '  else { section = doc.sections.add(page); }',
            ...setLines.map((l) => '  ' + l),
            '  result = (existed ? "Section updated" : "Section created") + " starting on page index " + page.documentOffset + "; page now numbered " + page.name;',
            '}',
        ], { errorPrefix: 'Error creating section' });
        return run(script, 'Create Document Section');
    }

    // =================== DOCUMENT XML & STRUCTURE ===================

    /**
     * Show XML tags and the element tree
     */
    static async getDocumentXmlStructure(args = {}) {
        const withTags = toBool(args.includeTags ?? true, 'includeTags');
        const withElements = toBool(args.includeElements ?? true, 'includeElements');
        const maxDepth = Number(index(args.maxDepth ?? 10, { name: 'maxDepth', max: 50 }));

        const body = ['var out = "Document XML Structure:\\n";'];
        if (withTags) {
            body.push(
                'out += "XML Tags: " + doc.xmlTags.length + "\\n";',
                'for (var i = 0; i < doc.xmlTags.length; i++) { out += "- " + doc.xmlTags[i].name + "\\n"; }',
                'out += "\\n";',
            );
        }
        if (withElements) {
            body.push(
                'var lines = 0; var LIMIT = 500;',
                'var walkXml = function (el, depth) {',
                '  if (lines >= LIMIT) { return; }',
                '  lines++;',
                '  var pad = ""; for (var p = 0; p < depth; p++) { pad += "  "; }',
                '  var tagName = el.markupTag.name;',
                '  var kids = el.xmlElements.length;',
                '  var line = pad + "<" + tagName + ">";',
                '  if (el.xmlAttributes.length > 0) { line += " attributes: " + el.xmlAttributes.length; }',
                '  if (kids > 0) { line += " children: " + kids; }',
                '  else { var txt = String(el.contents).replace(/[\\r\\n\\t]+/g, " "); if (txt.length > 0) { line += " \\"" + txt.substring(0, 40) + (txt.length > 40 ? "..." : "") + "\\""; } }',
                '  out += line + "\\n";',
                `  if (depth + 1 >= ${maxDepth}) { if (kids > 0) { out += pad + "  ...\\n"; } return; }`,
                '  for (var k = 0; k < kids; k++) { walkXml(el.xmlElements[k], depth + 1); }',
                '};',
                'out += "XML Element Tree:\\n";',
                'for (var r = 0; r < doc.xmlElements.length; r++) { walkXml(doc.xmlElements[r], 0); }',
                'if (lines >= LIMIT) { out += "... (truncated at " + LIMIT + " elements)\\n"; }',
            );
        }
        body.push('result = out;');
        return run(docScript(body, { errorPrefix: 'Error getting XML structure' }), 'Get Document XML Structure');
    }

    /**
     * Export the document's XML structure to a file
     */
    static async exportDocumentXml(args = {}) {
        const { filePath, includeImages = false } = args;
        const jsx = jsxPath(validateFilePath(filePath));
        const images = toBool(includeImages, 'includeImages');

        const script = docScript([
            `var xmlFile = File(${jsx});`,
            'if (!xmlFile.parent.exists) {',
            '  result = "Error: folder does not exist: " + xmlFile.parent.fsName;',
            '} else {',
            '  var xp = doc.xmlExportPreferences;',
            '  var oldCopy = xp.copyOriginalImages; var oldSel = xp.exportFromSelected;',
            `  xp.copyOriginalImages = ${bool(images)};`,
            '  xp.exportFromSelected = false;',
            '  try {',
            '    doc.exportFile(ExportFormat.XML, xmlFile, false);',
            '    result = "Document XML exported: " + xmlFile.fsName;',
            '  } finally {',
            '    xp.copyOriginalImages = oldCopy; xp.exportFromSelected = oldSel;',
            '  }',
            '}',
        ], { errorPrefix: 'Error exporting XML' });
        return run(script, 'Export Document XML');
    }

    // =================== DOCUMENT CLOUD & COLLABORATION ===================

    /**
     * Save the document to Adobe Creative Cloud
     */
    static async saveDocumentToCloud(args = {}) {
        const { cloudName, mode = 'SAVE_A_COPY' } = args;
        if (typeof cloudName !== 'string' || cloudName.trim() === '') throw new Error("Invalid arguments: 'cloudName' must be a non-empty string");
        const m = enumOf(mode, ['SAVE_A_COPY', 'SAVE_AS'], { name: 'mode' });

        const script = docScript(m === 'SAVE_AS' ? [
            `var cloudDoc = doc.saveAsCloud(${str(cloudName)});`,
            'var where = ""; try { where = " (" + cloudDoc.cloudPath + ")"; } catch (e) {}',
            `result = "Document saved to Creative Cloud as " + ${str(cloudName)} + where;`,
        ] : [
            `doc.saveACopyCloud(${str(cloudName)});`,
            `result = "Copy saved to Creative Cloud as " + ${str(cloudName)};`,
        ], { errorPrefix: 'Error saving to cloud' });
        return run(script, 'Save Document to Cloud');
    }

    /**
     * Open a Creative Cloud document by asset reference
     */
    static async openCloudDocument(args = {}) {
        const { cloudDocumentId } = args;
        if (typeof cloudDocumentId !== 'string' || cloudDocumentId.trim() === '') {
            throw new Error("Invalid arguments: 'cloudDocumentId' must be a non-empty string");
        }
        const script = [
            'var result;',
            'try {',
            `  var cdoc = app.openCloudDocument(${str(cloudDocumentId)}, true);`,
            '  result = "Cloud document opened: " + cdoc.name;',
            '} catch (error) {',
            '  result = "Error opening cloud document: " + error.message;',
            '}',
            'result;',
        ].join('\n');
        return run(script, 'Open Cloud Document');
    }

    // =================== DOCUMENT GRID & LAYOUT ===================

    /**
     * Get grid settings (measurements in mm)
     */
    static async getDocumentGridSettings() {
        const body = [...FMT_FN, 'result = "Document Grid Settings (measurements in mm):\\n";', ...buildPrefGetLines('grid', DOCUMENT_PREFERENCE_SPECS.grid)];
        return run(docScript(body, { errorPrefix: 'Error getting grid settings', mm: true }), 'Get Document Grid Settings');
    }

    /**
     * Set grid settings
     */
    static async setDocumentGridSettings(args = {}) {
        const setLines = buildPrefSetLines('grid', DOCUMENT_PREFERENCE_SPECS.grid, args);
        if (setLines.length === 0) {
            throw new Error(`Invalid arguments: no grid settings given. Allowed: ${Object.keys(DOCUMENT_PREFERENCE_SPECS.grid.props).join(', ')}`);
        }
        const body = ['var done = []; var failed = [];', ...setLines, ...prefOutcomeLines('grid setting')];
        return run(docScript(body, { errorPrefix: 'Error updating grid settings', mm: true }), 'Set Document Grid Settings');
    }

    /**
     * Get layout preferences
     */
    static async getDocumentLayoutPreferences() {
        const body = [...FMT_FN, 'result = "Layout Preferences (measurements in mm):\\n";'];
        for (const [g, spec] of Object.entries(LAYOUT_PREFERENCE_SPECS)) body.push(...buildPrefGetLines(g, spec));
        return run(docScript(body, { errorPrefix: 'Error getting layout preferences', mm: true }), 'Get Document Layout Preferences');
    }

    /**
     * Set layout preferences
     */
    static async setDocumentLayoutPreferences(args = {}) {
        const known = Object.keys(LAYOUT_PREFERENCE_SPECS);
        for (const k of Object.keys(args)) {
            if (!known.includes(k)) throw new Error(`Invalid argument '${k}'. Expected one or more of: ${known.join(', ')}`);
        }
        const setLines = [];
        for (const g of known) setLines.push(...buildPrefSetLines(g, LAYOUT_PREFERENCE_SPECS[g], args[g]));
        if (setLines.length === 0) {
            throw new Error(`Invalid arguments: no layout preference values given. Pass one or more of: ${known.join(', ')}`);
        }
        const body = ['var done = []; var failed = [];', ...setLines, ...prefOutcomeLines('layout preference')];
        return run(docScript(body, { errorPrefix: 'Error updating layout preferences', mm: true }), 'Set Document Layout Preferences');
    }

    // =================== DOCUMENT VALIDATION & CLEANUP ===================

    /**
     * Validate document structure and content
     */
    static async validateDocument(args = {}) {
        const checkLinks = toBool(args.checkLinks ?? true, 'checkLinks');
        const checkFonts = toBool(args.checkFonts ?? true, 'checkFonts');
        const checkImages = toBool(args.checkImages ?? true, 'checkImages');
        const checkOverset = toBool(args.checkOverset ?? true, 'checkOverset');
        const checkStyles = toBool(args.checkStyles ?? false, 'checkStyles');
        const minPpi = num(args.minImagePpi ?? 150, { name: 'minImagePpi', min: 1, max: 10000 });

        const body = ['var issues = []; var checks = [];'];
        if (checkLinks) {
            body.push(
                'checks.push("links");',
                'for (var i = 0; i < doc.links.length; i++) {',
                '  var lk = doc.links[i];',
                '  if (lk.status != LinkStatus.NORMAL && lk.status != LinkStatus.LINK_EMBEDDED) { issues.push("Link " + lk.status + ": " + lk.name); }',
                '}',
            );
        }
        if (checkFonts) {
            body.push(
                'checks.push("fonts");',
                'for (var f = 0; f < doc.fonts.length; f++) {',
                '  var fnt = doc.fonts[f];',
                '  if (fnt.status != FontStatus.INSTALLED) { issues.push("Font " + fnt.status + ": " + fnt.name); }',
                '}',
            );
        }
        if (checkImages) {
            body.push(
                'checks.push("images");',
                'for (var g = 0; g < doc.allGraphics.length; g++) {',
                '  var gr = doc.allGraphics[g];',
                '  var where = ""; try { if (gr.parentPage) { where = " on page " + gr.parentPage.name; } } catch (e) {}',
                '  var glink = gr.itemLink;',
                '  var gname = glink ? glink.name : "embedded graphic";',
                '  if (glink && glink.status != LinkStatus.NORMAL && glink.status != LinkStatus.LINK_EMBEDDED) { issues.push("Graphic link " + glink.status + ": " + gname + where); }',
                '  if (gr instanceof Image) {',
                '    try {',
                '      var ppi = gr.effectivePpi;',
                `      if (ppi && ppi.length > 1 && Math.min(ppi[0], ppi[1]) < ${minPpi}) { issues.push("Low resolution image (" + Math.round(ppi[0]) + "x" + Math.round(ppi[1]) + " ppi): " + gname + where); }`,
                '    } catch (e) {}',
                '  }',
                '}',
            );
        }
        if (checkOverset) {
            body.push(
                'checks.push("overset text");',
                'for (var s = 0; s < doc.stories.length; s++) {',
                '  var st = doc.stories[s];',
                '  if (st.overflows) { issues.push("Overset text in story id " + st.id + ": " + String(st.contents).substring(0, 40).replace(/[\\r\\n\\t]+/g, " ")); }',
                '}',
            );
        }
        if (checkStyles) {
            body.push(
                ...STYLE_USAGE_FNS,
                'checks.push("unused styles");',
                'var ps = doc.allParagraphStyles;',
                'for (var p = 0; p < ps.length; p++) { if (!isBuiltIn(ps[p].name) && !paraStyleUsed(ps[p])) { issues.push("Unused paragraph style: " + ps[p].name); } }',
                'var cs = doc.allCharacterStyles;',
                'for (var c = 0; c < cs.length; c++) { if (!isBuiltIn(cs[c].name) && !charStyleUsed(cs[c])) { issues.push("Unused character style: " + cs[c].name); } }',
            );
        }
        body.push(
            'var checked = checks.length > 0 ? checks.join(", ") : "nothing (all checks disabled)";',
            'if (issues.length === 0) {',
            '  result = "Validation passed: no issues found. Checked: " + checked;',
            '} else {',
            '  result = "Validation found " + issues.length + " issue(s). Checked: " + checked + "\\n- " + issues.join("\\n- ");',
            '}',
        );
        return run(docScript(body, { errorPrefix: 'Error validating document' }), 'Validate Document');
    }

    /**
     * Remove unused styles/swatches/layers and hidden items
     */
    static async cleanupDocument(args = {}) {
        const styles = toBool(args.removeUnusedStyles ?? false, 'removeUnusedStyles');
        const colors = toBool(args.removeUnusedColors ?? false, 'removeUnusedColors');
        const layers = toBool(args.removeUnusedLayers ?? false, 'removeUnusedLayers');
        const hidden = toBool(args.removeHiddenElements ?? false, 'removeHiddenElements');
        const dryRun = toBool(args.dryRun ?? false, 'dryRun');
        if (!styles && !colors && !layers && !hidden) {
            throw new Error('Invalid arguments: enable at least one of removeUnusedStyles, removeUnusedColors, removeUnusedLayers, removeHiddenElements');
        }

        const body = [
            'var removed = []; var problems = [];',
            `var dry = ${bool(dryRun)};`,
            'var zap = function (obj, label) {',
            '  if (dry) { removed.push(label); return; }',
            '  try { obj.remove(); removed.push(label); } catch (e) { problems.push(label + ": " + e.message); }',
            '};',
        ];
        if (hidden) {
            body.push(
                'var items = doc.allPageItems;',
                'for (var h = items.length - 1; h >= 0; h--) {',
                '  var it = items[h];',
                '  if (it.isValid && it.visible === false) { zap(it, "Hidden item id " + it.id); }',
                '}',
            );
        }
        if (styles) {
            body.push(
                ...STYLE_USAGE_FNS,
                'var ps = doc.allParagraphStyles;',
                'for (var p = ps.length - 1; p >= 0; p--) { if (!isBuiltIn(ps[p].name) && !paraStyleUsed(ps[p])) { zap(ps[p], "Paragraph style " + ps[p].name); } }',
                'var cs = doc.allCharacterStyles;',
                'for (var c = cs.length - 1; c >= 0; c--) { if (!isBuiltIn(cs[c].name) && !charStyleUsed(cs[c])) { zap(cs[c], "Character style " + cs[c].name); } }',
            );
        }
        if (colors) {
            body.push(
                'var unused = doc.unusedSwatches;',
                'for (var u = 0; u < unused.length; u++) {',
                '  var sw = unused[u];',
                '  if (sw.name === "" || String(sw.name).charAt(0) === "[") { continue; }',
                '  zap(sw, "Swatch " + sw.name);',
                '}',
            );
        }
        if (layers) {
            body.push(
                'var remaining = doc.layers.length;',
                'for (var l = doc.layers.length - 1; l >= 0; l--) {',
                '  var lay = doc.layers[l];',
                '  if (remaining <= 1) { break; }',
                '  if (lay.allPageItems.length === 0 && lay.guides.length === 0) { zap(lay, "Layer " + lay.name); remaining--; }',
                '}',
            );
        }
        body.push(
            'var verb = dry ? "Dry run: would remove " : "Removed ";',
            'var out = verb + removed.length + " item(s)" + (removed.length > 0 ? ":\\n- " + removed.join("\\n- ") : "");',
            'if (problems.length > 0) { result = "Error: could not remove " + problems.length + " item(s): " + problems.join("; ") + "\\n" + out; }',
            'else { result = "Cleanup complete. " + out; }',
        );
        return run(docScript(body, { errorPrefix: 'Error cleaning up document' }), 'Cleanup Document');
    }
}
