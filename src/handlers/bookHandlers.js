/**
 * Book management handlers
 *
 * Tools that take a bookPath reuse the book if it is already open in
 * InDesign (and leave it open); otherwise they open it, do the work and
 * close it again. Scripts end with `out;`.
 */
import path from 'path';
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, str, bool, enumOf, validateFilePath, jsxPath } from '../utils/stringUtils.js';

const EXPORT_FORMATS = {
    PDF: 'PDF_TYPE',
    INTERACTIVE_PDF: 'INTERACTIVE_PDF',
    EPUB: 'EPUB',
    FIXED_LAYOUT_EPUB: 'FIXED_LAYOUT_EPUB',
    HTML: 'HTML',
};

const SYNC_FLAGS = [
    'automaticPagination', 'automaticDocumentConversion', 'insertBlankPage', 'mergeIdenticalLayers',
    'synchronizeBulletNumberingList', 'synchronizeCellStyle', 'synchronizeCharacterStyle',
    'synchronizeConditionalText', 'synchronizeCrossReferenceFormat', 'synchronizeMasterPage',
    'synchronizeObjectStyle', 'synchronizeParagraphStyle', 'synchronizeSwatch',
    'synchronizeTableOfContentStyle', 'synchronizeTableStyle', 'synchronizeTextVariable',
    'synchronizeTrapStyle',
];

function indent(lines, n) {
    const pad = ' '.repeat(n);
    return lines.map((l) => (l ? pad + l : l));
}

async function run(script, operation) {
    const result = await ScriptExecutor.executeInDesignScript(script);
    return formatResponse(result, operation);
}

function bookPathLit(bookPath) {
    return jsxPath(validateFilePath(bookPath));
}

/**
 * Script with `book` bound to the book at `pathLit`. `body` sets `out` and
 * may throw. With save, the book is saved after the body. A book this
 * script opened is closed afterwards (without further saving).
 */
function bookScript(pathLit, failPrefix, body, { save = false } = {}) {
    return [
        'var out;',
        `var bookFile = File(${pathLit});`,
        'if (!bookFile.exists) {',
        '  out = "Error: book file not found: " + bookFile.fsName;',
        '} else {',
        '  var book = null;',
        '  var wasOpen = false;',
        '  for (var bi = 0; bi < app.books.length; bi++) {',
        '    try {',
        '      if (app.books[bi].fullName.fsName === bookFile.fsName) { book = app.books[bi]; wasOpen = true; break; }',
        '    } catch (eName) {}',
        '  }',
        '  try {',
        '    if (book === null) { book = app.open(bookFile); }',
        ...indent(body, 4),
        ...(save ? ['    book.save();'] : []),
        '  } catch (e) {',
        `    out = ${str(`${failPrefix}: `)} + e.message;`,
        '  }',
        '  if (!wasOpen && book !== null) {',
        '    try { book.close(SaveOptions.NO); } catch (eClose) {}',
        '  }',
        '}',
        'out;',
    ].join('\n');
}

/** Simple "open book, call one method, save" tools. */
async function bookMethod(args, method, failPrefix, successMessage, operation) {
    const body = [`book.${method}();`, `out = ${str(successMessage)} + ": " + book.name;`];
    return run(bookScript(bookPathLit(args.bookPath), failPrefix, body, { save: true }), operation);
}

export class BookHandlers {
    /**
     * Create a book (saved at filePath and left open)
     */
    static async createBook(args) {
        let resolved = validateFilePath(args.filePath);
        if (path.extname(resolved).toLowerCase() !== '.indb') resolved += '.indb';
        const fileLit = jsxPath(resolved);

        const script = [
            'var out;',
            `var bookFile = File(${fileLit});`,
            'if (bookFile.exists) {',
            '  out = "Error: a file already exists at " + bookFile.fsName + " (use open_book to open an existing book)";',
            '} else {',
            '  try {',
            '    var bookFolder = bookFile.parent;',
            '    if (!bookFolder.exists) { bookFolder.create(); }',
            '    var book = app.books.add(bookFile);',
            '    book.save();',
            '    out = "Book created and opened: " + book.fullName.fsName;',
            '  } catch (e) {',
            '    out = "Error creating book: " + e.message;',
            '  }',
            '}',
            'out;',
        ].join('\n');
        return run(script, 'Create Book');
    }

    /**
     * Open a book (left open in InDesign)
     */
    static async openBook(args) {
        const fileLit = bookPathLit(args.filePath);
        const script = [
            'var out;',
            `var bookFile = File(${fileLit});`,
            'if (!bookFile.exists) {',
            '  out = "Error: book file not found: " + bookFile.fsName;',
            '} else {',
            '  try {',
            '    var book = app.open(bookFile);',
            '    out = "Book opened: " + book.name + " (" + book.bookContents.length + " document(s))";',
            '  } catch (e) {',
            '    out = "Error opening book: " + e.message;',
            '  }',
            '}',
            'out;',
        ].join('\n');
        return run(script, 'Open Book');
    }

    /**
     * Add a document to a book
     */
    static async addDocumentToBook(args) {
        const docLit = jsxPath(validateFilePath(args.documentPath));
        const body = [
            `var docFile = File(${docLit});`,
            'if (!docFile.exists) { throw new Error("document file not found: " + docFile.fsName); }',
            'var bookContent = book.bookContents.add(docFile);',
            'out = "Document " + bookContent.name + " added to book " + book.name + " (" + book.bookContents.length + " document(s))";',
        ];
        return run(bookScript(bookPathLit(args.bookPath), 'Error adding document to book', body, { save: true }), 'Add Document to Book');
    }

    /**
     * Synchronize a book (styles/swatches/etc. from the style source document)
     */
    static async synchronizeBook(args) {
        return bookMethod(args, 'synchronize', 'Error synchronizing book', 'Book synchronized', 'Synchronize Book');
    }

    /**
     * Export a book
     */
    static async exportBook(args) {
        const { format = 'PDF', pdfPreset } = args;
        const fmt = enumOf(format, Object.keys(EXPORT_FORMATS), { name: 'format' });
        const outLit = jsxPath(validateFilePath(args.outputPath));
        const isPdf = fmt === 'PDF';

        const body = [
            `var outputFile = File(${outLit});`,
            'if (!outputFile.parent.exists) { outputFile.parent.create(); }',
        ];
        if (isPdf && pdfPreset) {
            body.push(
                `var preset = app.pdfExportPresets.itemByName(${str(pdfPreset)});`,
                `if (!preset.isValid) { throw new Error(${str(`PDF export preset not found: ${pdfPreset}`)}); }`,
                'book.exportFile(ExportFormat.PDF_TYPE, outputFile, false, preset);'
            );
        } else {
            body.push(`book.exportFile(ExportFormat.${EXPORT_FORMATS[fmt]}, outputFile, false);`);
        }
        body.push(
            'if (outputFile.exists) {',
            `  out = "Book exported (${fmt}) to " + outputFile.fsName;`,
            '} else {',
            '  out = "Error: export finished but no file was written at " + outputFile.fsName;',
            '}'
        );
        return run(bookScript(bookPathLit(args.bookPath), 'Error exporting book', body), 'Export Book');
    }

    /**
     * Package a book for print
     */
    static async packageBook(args) {
        const {
            copyingFonts = true,
            copyingLinkedGraphics = true,
            copyingProfiles = true,
            updatingGraphics = true,
            includingHiddenLayers = false,
            ignorePreflightErrors = false,
            creatingReport = true,
            includeIdml = false,
            includePdf = false,
            pdfStyle = '[High Quality Print]',
        } = args;
        const outLit = jsxPath(validateFilePath(args.outputPath));

        const flags = [
            copyingFonts, copyingLinkedGraphics, copyingProfiles, updatingGraphics,
            includingHiddenLayers, ignorePreflightErrors, creatingReport, includeIdml, includePdf,
        ].map(bool).join(', ');
        const body = [
            `var outputFolder = Folder(${outLit});`,
            'if (!outputFolder.exists) { outputFolder.create(); }',
            `var packaged = book.packageForPrint(outputFolder, ${flags}, ${str(pdfStyle)}, false, "");`,
            'if (packaged === false) {',
            '  out = "Failed to package book " + book.name + " (InDesign reported failure; check preflight errors or set ignorePreflightErrors)";',
            '} else {',
            '  out = "Book " + book.name + " packaged to " + outputFolder.fsName;',
            '}',
        ];
        return run(bookScript(bookPathLit(args.bookPath), 'Error packaging book', body), 'Package Book');
    }

    /**
     * Get book information
     */
    static async getBookInfo(args) {
        const body = [
            'var info = "=== BOOK INFORMATION ===\\n";',
            'info += "Name: " + book.name + "\\n";',
            'info += "File: " + book.fullName.fsName + "\\n";',
            'info += "Modified: " + book.modified + "\\n";',
            'info += "Saved: " + book.saved + "\\n";',
            'info += "Automatic Pagination: " + book.automaticPagination + "\\n";',
            'info += "Repagination Option: " + book.repaginationOption + "\\n";',
            'info += "Automatic Document Conversion: " + book.automaticDocumentConversion + "\\n";',
            'info += "Insert Blank Page: " + book.insertBlankPage + "\\n";',
            'info += "Merge Identical Layers: " + book.mergeIdenticalLayers + "\\n";',
            'var src = "None";',
            'try { if (book.styleSourceDocument && book.styleSourceDocument.isValid) { src = book.styleSourceDocument.name; } } catch (eSrc) {}',
            'info += "Style Source: " + src + "\\n";',
            'info += "\\n=== BOOK CONTENTS (" + book.bookContents.length + ") ===\\n";',
            'for (var i = 0; i < book.bookContents.length; i++) {',
            '  var content = book.bookContents[i];',
            '  info += "Document " + (i + 1) + ": " + content.name + "\\n";',
            '  info += "  Status: " + content.status + "\\n";',
            '  info += "  Pages: " + content.documentPageRange + "\\n";',
            '  var cpath = "(unknown)";',
            '  try { cpath = content.fullName.fsName; } catch (eP) {}',
            '  info += "  Path: " + cpath + "\\n";',
            '}',
            'out = info;',
        ];
        return run(bookScript(bookPathLit(args.bookPath), 'Error reading book info', body), 'Get Book Info');
    }

    /**
     * List all open books
     */
    static async listBooks() {
        const script = [
            'var out;',
            'var books = app.books;',
            'var info = "=== OPEN BOOKS ===\\n";',
            'info += "Total books: " + books.length + "\\n\\n";',
            'for (var i = 0; i < books.length; i++) {',
            '  var book = books[i];',
            '  var where = "(unsaved)";',
            '  try { where = book.fullName.fsName; } catch (eName) {}',
            '  info += "Book " + i + ": " + book.name + "\\n";',
            '  info += "  File: " + where + "\\n";',
            '  info += "  Modified: " + book.modified + "\\n";',
            '  info += "  Documents: " + book.bookContents.length + "\\n\\n";',
            '}',
            'out = info;',
            'out;',
        ].join('\n');
        return run(script, 'List Books');
    }

    /**
     * Repaginate a book
     */
    static async repaginateBook(args) {
        return bookMethod(args, 'repaginate', 'Error repaginating book', 'Book repaginated', 'Repaginate Book');
    }

    /**
     * Update all cross references in a book
     */
    static async updateAllCrossReferences(args) {
        return bookMethod(args, 'updateAllCrossReferences', 'Error updating cross references', 'All cross references updated in book', 'Update All Cross References');
    }

    /**
     * Update all numbers in a book
     */
    static async updateAllNumbers(args) {
        return bookMethod(args, 'updateAllNumbers', 'Error updating numbers', 'All numbers updated in book', 'Update All Numbers');
    }

    /**
     * Update chapter and paragraph numbers in a book
     */
    static async updateChapterAndParagraphNumbers(args) {
        return bookMethod(args, 'updateChapterAndParagraphNumbers', 'Error updating chapter and paragraph numbers', 'Chapter and paragraph numbers updated in book', 'Update Chapter and Paragraph Numbers');
    }

    /**
     * Preflight a book and save the report (default: system temp folder)
     */
    static async preflightBook(args) {
        const { outputPath, autoOpen = false } = args;
        const bookLit = bookPathLit(args.bookPath);
        const reportLine = outputPath
            ? `var reportFile = File(${jsxPath(validateFilePath(outputPath))});`
            : `var reportFile = File(Folder.temp.fsName + "/" + ${str(`${path.basename(String(args.bookPath), path.extname(String(args.bookPath)))}-preflight.pdf`)});`;
        const body = [
            reportLine,
            'if (!reportFile.parent.exists) { reportFile.parent.create(); }',
            `book.preflight(reportFile, ${bool(autoOpen)});`,
            'out = "Book " + book.name + " preflighted. Report: " + reportFile.fsName;',
        ];
        return run(bookScript(bookLit, 'Error preflighting book', body), 'Preflight Book');
    }

    /**
     * Print a book
     */
    static async printBook(args) {
        const { printDialog = true, printerPreset = 'DEFAULT_VALUE' } = args;
        const body = printerPreset === 'DEFAULT_VALUE'
            ? [`book.print(${bool(printDialog)}, PrinterPresetTypes.DEFAULT_VALUE);`]
            : [
                `var preset = app.printerPresets.itemByName(${str(printerPreset)});`,
                `if (!preset.isValid) { throw new Error(${str(`printer preset not found: ${printerPreset}`)}); }`,
                `book.print(${bool(printDialog)}, preset);`,
            ];
        body.push('out = "Book " + book.name + " sent to print";');
        return run(bookScript(bookPathLit(args.bookPath), 'Error printing book', body), 'Print Book');
    }

    /**
     * Set book properties (only those given)
     */
    static async setBookProperties(args) {
        const given = SYNC_FLAGS.filter((k) => args[k] !== undefined);
        if (!given.length) {
            throw new Error(`Invalid arguments: provide at least one of ${SYNC_FLAGS.join(', ')}.`);
        }
        const body = [
            ...given.map((k) => `book.${k} = ${bool(args[k])};`),
            `out = "Book " + book.name + " updated: ${given.join(', ')}";`,
        ];
        return run(bookScript(bookPathLit(args.bookPath), 'Error updating book properties', body, { save: true }), 'Set Book Properties');
    }
}
