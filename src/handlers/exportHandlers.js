/**
 * Export handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, escapeJsxString } from '../utils/stringUtils.js';

export class ExportHandlers {
    /**
     * Export document to PDF
     */
    static async exportPDF(args) {
        const {
            filePath,
            preset = 'High Quality Print',
            includeBookmarks = true,
            includeHyperlinks = true,
            includeNonPrinting = false,
            cropMarks = false,
            bleedMarks = false,
            registrationMarks = false,
            colorBars = false,
            pageInformationMarks = false
        } = args;

        const escapedFilePath = escapeJsxString(filePath);
        const escapedPreset = escapeJsxString(preset);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var pdfFile = File("' + escapedFilePath + '");',
            '',
            '  try {',
            '    // Export to PDF with preset',
            '    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, "' + escapedPreset + '");',
            '',
            `    "PDF exported successfully to: ${escapedFilePath}";`,
            '  } catch (error) {',
            '    "Error exporting PDF: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Export PDF");
    }

    /**
     * Export pages as images
     */
    static async exportImages(args) {
        const {
            folderPath,
            format = 'JPEG',
            quality = 80,
            resolution = 300,
            pageRange = 'all'
        } = args;

        const escapedFolderPath = escapeJsxString(folderPath);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var folder = Folder("' + escapedFolderPath + '");',
            '',
            '  try {',
            '    if (!folder.exists) {',
            '      folder.create();',
            '    }',
            '',
            '    var exportFormat;',
            `    if ("${format}" === "JPEG") {`,
            '      exportFormat = ExportFormat.JPEG;',
            `    } else if ("${format}" === "PNG") {`,
            '      exportFormat = ExportFormat.PNG;',
            `    } else if ("${format}" === "TIFF") {`,
            '      exportFormat = ExportFormat.TIFF;',
            '    } else {',
            '      exportFormat = ExportFormat.JPEG;',
            '    }',
            '',
            '    var exportedCount = 0;',
            '    var startPage = 0;',
            '    var endPage = doc.pages.length - 1;',
            '',
            `    if ("${pageRange}" !== "all") {`,
            '      // Parse page range (e.g., "1-3" or "1,3,5")',
            '      var range = "' + pageRange + '".split(",");',
            '      for (var i = 0; i < range.length; i++) {',
            '        var pageNum = parseInt(range[i]) - 1;',
            '        if (pageNum >= 0 && pageNum < doc.pages.length) {',
            '          var fileName = folder.fsName + "/page_" + (pageNum + 1) + "." + "' + format.toLowerCase() + '";',
            '          var imageFile = File(fileName);',
            '          doc.pages[pageNum].exportFile(exportFormat, imageFile, false);',
            '          exportedCount++;',
            '        }',
            '      }',
            '    } else {',
            '      // Export all pages',
            '      for (var i = 0; i < doc.pages.length; i++) {',
            '        var fileName = folder.fsName + "/page_" + (i + 1) + "." + "' + format.toLowerCase() + '";',
            '        var imageFile = File(fileName);',
            '        doc.pages[i].exportFile(exportFormat, imageFile, false);',
            '        exportedCount++;',
            '      }',
            '    }',
            '',
            `    exportedCount + " pages exported as ${format} images to: ${escapedFolderPath}";`,
            '  } catch (error) {',
            '    "Error exporting images: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Export Images");
    }

    /**
     * Package document for printing
     */
    static async packageDocument(args) {
        const { folderPath, includeFonts = true, includeLinks = true, includeProfiles = true } = args;
        const escapedFolderPath = escapeJsxString(folderPath);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var folder = Folder("' + escapedFolderPath + '");',
            '',
            '  try {',
            '    if (!folder.exists) {',
            '      folder.create();',
            '    }',
            '',
            '    // Set package preferences',
            '    var packagePrefs = doc.packagePreferences;',
            `    packagePrefs.includeFonts = ${includeFonts};`,
            `    packagePrefs.includeLinks = ${includeLinks};`,
            `    packagePrefs.includeProfiles = ${includeProfiles};`,
            '    packagePrefs.includeNonPrinting = false;',
            '    packagePrefs.includeHiddenLayers = false;',
            '    packagePrefs.includeEmptyPages = true;',
            '',
            '    // Package the document',
            '    doc.packageForPrint(folder);',
            '',
            `    "Document packaged successfully to: ${escapedFolderPath}";`,
            '  } catch (error) {',
            '    "Error packaging document: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Package Document");
    }
} 