/**
 * Export handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import {
    formatResponse,
    formatErrorResponse,
    str,
    bool,
    enumOf,
    ALLOWED,
    validateFilePath,
    jsxPath,
} from '../utils/stringUtils.js';

export class ExportHandlers {
    /**
     * Export document to PDF
     */
    static async exportPDF(args) {
        const {
            filePath,
            preset = 'High Quality Print',
        } = args;

        const resolved = validateFilePath(filePath);
        const jsx = jsxPath(resolved);
        const presetLit = str(preset);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  var pdfFile = File(${jsx});`,
            '  try {',
            `    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, ${presetLit});`,
            `    "PDF exported successfully to: " + ${jsx};`,
            '  } catch (error) {',
            '    "Error exporting PDF: " + error.message;',
            '  }',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        const ok = String(result).includes('PDF exported successfully');
        return ok
            ? formatResponse(result, 'Export PDF')
            : formatErrorResponse(result, 'Export PDF');
    }

    /**
     * Export pages as images
     */
    static async exportImages(args) {
        const {
            folderPath,
            format = 'JPEG',
            pageRange = 'all',
        } = args;

        const resolved = validateFilePath(folderPath);
        const folderJsx = jsxPath(resolved);
        const fmtRaw = String(format).toUpperCase() === 'JPG' ? 'JPEG' : String(format).toUpperCase();
        const fmt = enumOf(fmtRaw, ALLOWED.imageFormat, { name: 'format' });
        const ext = str(fmt.toLowerCase() === 'jpeg' ? 'jpg' : fmt.toLowerCase());
        const rangeLit = str(pageRange);
        const fmtLit = str(fmt);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  var folder = Folder(${folderJsx});`,
            '  try {',
            '    if (!folder.exists) { folder.create(); }',
            '    var exportFormat;',
            `    if (${fmtLit} === "JPEG") { exportFormat = ExportFormat.JPEG; }`,
            `    else if (${fmtLit} === "PNG") { exportFormat = ExportFormat.PNG; }`,
            `    else if (${fmtLit} === "TIFF") { exportFormat = ExportFormat.TIFF; }`,
            `    else if (${fmtLit} === "GIF") { exportFormat = ExportFormat.GIF; }`,
            '    else { exportFormat = ExportFormat.JPEG; }',
            '    var exportedCount = 0;',
            `    if (${rangeLit} !== "all") {`,
            `      var range = String(${rangeLit}).split(",");`,
            '      for (var i = 0; i < range.length; i++) {',
            '        var pageNum = parseInt(range[i], 10) - 1;',
            '        if (pageNum >= 0 && pageNum < doc.pages.length) {',
            `          var fileName = folder.fsName + "/page_" + (pageNum + 1) + "." + ${ext};`,
            '          var imageFile = File(fileName);',
            '          doc.pages[pageNum].exportFile(exportFormat, imageFile, false);',
            '          exportedCount++;',
            '        }',
            '      }',
            '    } else {',
            '      for (var i = 0; i < doc.pages.length; i++) {',
            `        var fileName = folder.fsName + "/page_" + (i + 1) + "." + ${ext};`,
            '        var imageFile = File(fileName);',
            '        doc.pages[i].exportFile(exportFormat, imageFile, false);',
            '        exportedCount++;',
            '      }',
            '    }',
            `    exportedCount + " pages exported as " + ${fmtLit} + " images to: " + ${folderJsx};`,
            '  } catch (error) {',
            '    "Error exporting images: " + error.message;',
            '  }',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        const ok = String(result).includes('pages exported');
        return ok
            ? formatResponse(result, 'Export Images')
            : formatErrorResponse(result, 'Export Images');
    }

    /**
     * Package document for printing
     */
    static async packageDocument(args) {
        const { folderPath, includeFonts = true, includeLinks = true, includeProfiles = true } = args;
        const resolved = validateFilePath(folderPath);
        const folderJsx = jsxPath(resolved);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  var folder = Folder(${folderJsx});`,
            '  try {',
            '    if (!folder.exists) { folder.create(); }',
            '    var packagePrefs = doc.packagePreferences;',
            `    packagePrefs.includeFonts = ${bool(includeFonts)};`,
            `    packagePrefs.includeLinks = ${bool(includeLinks)};`,
            `    packagePrefs.includeProfiles = ${bool(includeProfiles)};`,
            '    packagePrefs.includeNonPrinting = false;',
            '    packagePrefs.includeHiddenLayers = false;',
            '    packagePrefs.includeEmptyPages = true;',
            '    doc.packageForPrint(folder);',
            `    "Document packaged successfully to: " + ${folderJsx};`,
            '  } catch (error) {',
            '    "Error packaging document: " + error.message;',
            '  }',
            '}',
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        const ok = String(result).includes('Document packaged successfully');
        return ok
            ? formatResponse(result, 'Package Document')
            : formatErrorResponse(result, 'Package Document');
    }
}
