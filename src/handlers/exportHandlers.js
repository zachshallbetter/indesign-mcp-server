/**
 * Export handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import {
    formatResponse,
    str,
    num,
    bool,
    enumOf,
    validateFilePath,
    jsxPath,
} from '../utils/stringUtils.js';
import { jsxProgram } from './pageItemHandlers.js';

/** Built-in PDF export presets for the `quality` shortcut. */
const PDF_QUALITY_PRESETS = {
    PRESS: '[Press Quality]',
    PRINT: '[High Quality Print]',
    SCREEN: '[Smallest File Size]',
};

/**
 * Parse "all" or a list of absolute 1-based page numbers/ranges ("1-3,5").
 * Returns null for all pages, else an array of [from, to] pairs.
 */
function parsePages(spec) {
    if (spec === undefined || spec === null || /^\s*all\s*$/i.test(String(spec))) return null;
    const ranges = [];
    for (const part of String(spec).split(',')) {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
        if (!m) throw new Error(`Invalid page range '${spec}': use "all" or page numbers like "1-3,5"`);
        const from = Number(m[1]);
        const to = m[2] ? Number(m[2]) : from;
        if (from < 1 || to < from || to > 100000) throw new Error(`Invalid page range '${part.trim()}'`);
        ranges.push([from, to]);
    }
    return ranges;
}

/** JSX lines building `__pageIdx` (0-based indices) from parsed ranges, with range checks. */
function jsxPageIndices(ranges) {
    if (!ranges) {
        return ['var __pageIdx = [];', 'for (var __i = 0; __i < doc.pages.length; __i++) { __pageIdx.push(__i); }'];
    }
    return [
        `var __ranges = [${ranges.map(([a, b]) => `[${a}, ${b}]`).join(', ')}];`,
        'var __pageIdx = [];',
        'for (var __r = 0; __r < __ranges.length; __r++) {',
        '  if (__ranges[__r][1] > doc.pages.length) { return "Page " + __ranges[__r][1] + " out of range (document has " + doc.pages.length + " pages)"; }',
        '  for (var __p = __ranges[__r][0]; __p <= __ranges[__r][1]; __p++) { __pageIdx.push(__p - 1); }',
        '}',
    ];
}

/** Run `lines` with user interaction disabled (no modal dialogs), restoring the level afterwards. */
function withoutDialogs(lines) {
    return [
        'var __uil = app.scriptPreferences.userInteractionLevel;',
        'app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;',
        'try {',
        ...lines.map((l) => '  ' + l),
        '} finally {',
        '  app.scriptPreferences.userInteractionLevel = __uil;',
        '}',
    ];
}

export class ExportHandlers {
    /**
     * Export document to PDF
     */
    static async exportPDF(args) {
        const { filePath, quality = 'PRINT', preset, includeMarks = false, includeBleed = false, pages = 'all' } = args;

        const resolved = validateFilePath(filePath);
        const jsx = jsxPath(resolved);
        const presetName = preset
            ? String(preset)
            : PDF_QUALITY_PRESETS[enumOf(String(quality).toUpperCase(), Object.keys(PDF_QUALITY_PRESETS), { name: 'quality' })];
        const ranges = parsePages(pages);
        const override = Boolean(includeMarks || includeBleed);

        const exportLines = override
            ? [
                // Preset settings win over app.pdfExportPreferences, so copy the preset
                // into the preferences, apply the overrides and export without a preset.
                '__saved = prefs.properties;',
                'var __pp = preset.properties;',
                'for (var __k in __pp) {',
                '  if (__k === "name" || __k === "parent" || __k === "index" || __k === "id" || __k === "isValid" || __k === "properties") { continue; }',
                '  try { prefs[__k] = __pp[__k]; } catch (__ce) {}',
                '}',
                'prefs.pageRange = __range;',
                ...(includeMarks
                    ? ['prefs.cropMarks = true;', 'prefs.bleedMarks = true;', 'prefs.registrationMarks = true;', 'prefs.colorBars = true;', 'prefs.pageInformationMarks = true;']
                    : []),
                ...(includeBleed ? ['prefs.useDocumentBleedWithPDF = true;'] : []),
                'doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);',
            ]
            : [
                'prefs.pageRange = __range;',
                'doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, preset);',
            ];

        const script = jsxProgram([
            `var preset = app.pdfExportPresets.itemByName(${str(presetName)});`,
            `if (!preset.isValid) { return ${str(`Error: PDF export preset '${presetName}' not found`)}; }`,
            ...jsxPageIndices(ranges),
            'var __names = [];',
            'for (var __n = 0; __n < __pageIdx.length; __n++) { __names.push(doc.pages[__pageIdx[__n]].name); }',
            `var __range = ${ranges ? '__names.join(",")' : 'PageRange.ALL_PAGES'};`,
            `var pdfFile = File(${jsx});`,
            'var prefs = app.pdfExportPreferences;',
            'var __prevRange = prefs.pageRange;',
            'var __saved = null;',
            ...withoutDialogs([
                'try {',
                ...exportLines.map((l) => '  ' + l),
                '} finally {',
                '  if (__saved) { for (var __s in __saved) { try { prefs[__s] = __saved[__s]; } catch (__re) {} } }',
                '  prefs.pageRange = __prevRange;',
                '}',
            ]),
            'if (!pdfFile.exists) { return "Failed to export PDF: no file was written"; }',
            `return "PDF exported (" + __pageIdx.length + " pages, preset " + preset.name + ") to: " + pdfFile.fsName;`,
        ], { errorPrefix: 'Error exporting PDF' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Export PDF');
    }

    /**
     * Export pages as JPEG or PNG images (one file per page) into a folder
     */
    static async exportImages(args) {
        const {
            outputPath,
            format = 'JPEG',
            resolution = 300,
            quality = 80,
        } = args;
        const pages = args.pages ?? 'all';

        const resolved = validateFilePath(outputPath);
        const folderJsx = jsxPath(resolved);
        const fmtRaw = String(format).toUpperCase() === 'JPG' ? 'JPEG' : String(format).toUpperCase();
        const fmt = enumOf(fmtRaw, ['JPEG', 'PNG'], { name: 'format' });
        const res = num(resolution, { name: 'resolution', min: 1, max: 2400 });
        const q = Number(num(quality, { name: 'quality', min: 1, max: 100 }));
        const qEnum = q <= 25 ? 'LOW' : q <= 50 ? 'MEDIUM' : q <= 80 ? 'HIGH' : 'MAXIMUM';
        const ranges = parsePages(pages);

        const isJpeg = fmt === 'JPEG';
        const ext = isJpeg ? 'jpg' : 'png';
        const prefsSetup = isJpeg
            ? [
                'var prefs = app.jpegExportPreferences;',
                'var __prev = [prefs.jpegExportRange, prefs.pageString, prefs.exportResolution, prefs.jpegQuality, prefs.exportingSpread];',
                'prefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;',
                `prefs.jpegQuality = JPEGOptionsQuality.${qEnum};`,
            ]
            : [
                'var prefs = app.pngExportPreferences;',
                'var __prev = [prefs.pngExportRange, prefs.pageString, prefs.exportResolution, prefs.pngQuality, prefs.exportingSpread];',
                'prefs.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;',
                `prefs.pngQuality = PNGQualityEnum.${qEnum};`,
            ];
        const prefsRestore = isJpeg
            ? ['prefs.jpegExportRange = __prev[0];', 'prefs.pageString = __prev[1];', 'prefs.exportResolution = __prev[2];', 'prefs.jpegQuality = __prev[3];', 'prefs.exportingSpread = __prev[4];']
            : ['prefs.pngExportRange = __prev[0];', 'prefs.pageString = __prev[1];', 'prefs.exportResolution = __prev[2];', 'prefs.pngQuality = __prev[3];', 'prefs.exportingSpread = __prev[4];'];

        const script = jsxProgram([
            ...jsxPageIndices(ranges),
            `var folder = Folder(${folderJsx});`,
            'if (!folder.exists && !folder.create()) { return "Cannot create output folder: " + folder.fsName; }',
            ...prefsSetup,
            'var exported = 0;',
            ...withoutDialogs([
                'try {',
                `  prefs.exportResolution = ${res};`,
                '  prefs.exportingSpread = false;',
                '  for (var i = 0; i < __pageIdx.length; i++) {',
                '    var pg = doc.pages[__pageIdx[i]];',
                '    prefs.pageString = pg.name;',
                `    var imageFile = File(folder.fsName + "/page_" + (__pageIdx[i] + 1) + ".${ext}");`,
                `    doc.exportFile(ExportFormat.${isJpeg ? 'JPG' : 'PNG_FORMAT'}, imageFile, false);`,
                '    if (imageFile.exists) { exported++; }',
                '  }',
                '} finally {',
                ...prefsRestore.map((l) => '  ' + l),
                '}',
            ]),
            'if (exported !== __pageIdx.length) { return "Failed to export " + (__pageIdx.length - exported) + " of " + __pageIdx.length + " pages to " + folder.fsName; }',
            `return exported + " pages exported as ${fmt} (${res} ppi) to: " + folder.fsName;`,
        ], { errorPrefix: 'Error exporting images' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Export Images');
    }

    /**
     * Export document to EPUB (reflowable or fixed layout)
     */
    static async exportEPUB(args) {
        const { filePath, layout = 'REFLOWABLE', includeStyles = true, embedFonts = true, title } = args;

        const resolved = validateFilePath(filePath);
        const jsx = jsxPath(resolved);
        const kind = enumOf(String(layout).toUpperCase(), ['REFLOWABLE', 'FIXED_LAYOUT'], { name: 'layout' });
        const hasTitle = title !== undefined && title !== null && title !== '';

        const exportLines = kind === 'REFLOWABLE'
            ? [
                'var ep = doc.epubExportPreferences;',
                'var __prev = [ep.generateCascadeStyleSheet, ep.includeClassesInHTML, ep.embedFont, ep.epubTitle];',
                'try {',
                `  ep.generateCascadeStyleSheet = ${bool(includeStyles)};`,
                `  ep.includeClassesInHTML = ${bool(includeStyles)};`,
                `  ep.embedFont = ${bool(embedFonts)};`,
                ...(hasTitle ? [`  ep.epubTitle = ${str(title)};`] : []),
                '  doc.exportFile(ExportFormat.EPUB, epubFile, false);',
                '} finally {',
                '  ep.generateCascadeStyleSheet = __prev[0];',
                '  ep.includeClassesInHTML = __prev[1];',
                '  ep.embedFont = __prev[2];',
                '  ep.epubTitle = __prev[3];',
                '}',
            ]
            : [
                'var fx = doc.epubFixedLayoutExportPreferences;',
                'var __prevTitle = fx.epubTitle;',
                'try {',
                ...(hasTitle ? [`  fx.epubTitle = ${str(title)};`] : []),
                '  doc.exportFile(ExportFormat.FIXED_LAYOUT_EPUB, epubFile, false);',
                '} finally {',
                '  fx.epubTitle = __prevTitle;',
                '}',
            ];

        const script = jsxProgram([
            `var epubFile = File(${jsx});`,
            ...withoutDialogs(exportLines),
            'if (!epubFile.exists) { return "Failed to export EPUB: no file was written"; }',
            `return ${str(`EPUB (${kind === 'REFLOWABLE' ? 'reflowable' : 'fixed layout'}) exported to: `)} + epubFile.fsName;`,
        ], { errorPrefix: 'Error exporting EPUB' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Export EPUB');
    }

    /**
     * Package document for printing into a folder
     */
    static async packageDocument(args) {
        const {
            outputPath,
            includeFonts = true,
            includeLinks = true,
            includeProfiles = true,
            includeHiddenLayers = false,
            createReport = true,
            forceSave = false,
        } = args;
        const resolved = validateFilePath(outputPath);
        const folderJsx = jsxPath(resolved);

        const script = jsxProgram([
            'if (!doc.saved) { return "Cannot package: the document has never been saved"; }',
            ...(forceSave ? [] : ['if (doc.modified) { return "Cannot package: the document has unsaved changes (save it or pass forceSave=true)"; }']),
            `var folder = Folder(${folderJsx});`,
            'if (!folder.exists && !folder.create()) { return "Cannot create output folder: " + folder.fsName; }',
            'var ok = false;',
            ...withoutDialogs([
                // to, fonts, links, profiles, updateGraphics, hiddenLayers, ignorePreflightErrors,
                // report, IDML, PDF, pdfStyle, hyphenationExceptionsOnly, versionComments, forceSave
                `ok = doc.packageForPrint(folder, ${bool(includeFonts)}, ${bool(includeLinks)}, ${bool(includeProfiles)}, true, ${bool(includeHiddenLayers)}, true, ${bool(createReport)}, false, false, "[High Quality Print]", false, "", ${bool(forceSave)});`,
            ]),
            'if (!ok) { return "Failed to package document (InDesign reported failure)"; }',
            'return "Document packaged to: " + folder.fsName;',
        ], { errorPrefix: 'Error packaging document' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, 'Package Document');
    }
}
