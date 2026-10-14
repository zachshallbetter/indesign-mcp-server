/**
 * Book tool definitions for InDesign MCP Server
 * Book management and multi-document functionality
 */

export const bookToolDefinitions = [
    // =================== BOOK MANAGEMENT ===================
    {
        name: 'create_book',
        description: 'Create a new InDesign book file and leave it open (fails if a file already exists at the path)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path for the new book file (".indb" is appended if missing)' }
            },
            required: ['filePath']
        }
    },
    {
        name: 'open_book',
        description: 'Open an existing InDesign book (it stays open)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['filePath']
        }
    },
    {
        name: 'list_books',
        description: 'List all open books in InDesign',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'add_document_to_book',
        description: 'Add an InDesign document to the end of a book and save the book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                documentPath: { type: 'string', description: 'Path to the document to add' }
            },
            required: ['bookPath', 'documentPath']
        }
    },
    {
        name: 'synchronize_book',
        description: 'Synchronize styles, swatches and other enabled options from the book\'s style source document to all documents, then save the book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'repaginate_book',
        description: 'Repaginate all documents in a book and save it',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'update_all_cross_references',
        description: 'Update all cross references in a book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'update_all_numbers',
        description: 'Update all numbers (page numbers, chapter numbers, paragraph numbers) in a book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'update_chapter_and_paragraph_numbers',
        description: 'Update chapter and paragraph numbers in a book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'export_book',
        description: 'Export an entire book to a single file',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                format: {
                    type: 'string',
                    enum: ['PDF', 'INTERACTIVE_PDF', 'EPUB', 'FIXED_LAYOUT_EPUB', 'HTML'],
                    description: 'Export format',
                    default: 'PDF'
                },
                outputPath: { type: 'string', description: 'Path for the exported file' },
                pdfPreset: { type: 'string', description: 'PDF export preset name for format PDF (e.g. "[High Quality Print]"); default: current PDF export settings' }
            },
            required: ['bookPath', 'outputPath']
        }
    },
    {
        name: 'package_book',
        description: 'Package a book for print production into a folder (created if missing)',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                outputPath: { type: 'string', description: 'Path for the package folder' },
                copyingFonts: { type: 'boolean', description: 'Copy fonts to package', default: true },
                copyingLinkedGraphics: { type: 'boolean', description: 'Copy linked graphics', default: true },
                copyingProfiles: { type: 'boolean', description: 'Copy color profiles', default: true },
                updatingGraphics: { type: 'boolean', description: 'Update graphics links', default: true },
                includingHiddenLayers: { type: 'boolean', description: 'Include hidden layers', default: false },
                ignorePreflightErrors: { type: 'boolean', description: 'Ignore preflight errors', default: false },
                creatingReport: { type: 'boolean', description: 'Create package report', default: true },
                includeIdml: { type: 'boolean', description: 'Include IDML file', default: false },
                includePdf: { type: 'boolean', description: 'Include PDF file', default: false },
                pdfStyle: { type: 'string', description: 'PDF export preset used when includePdf is true', default: '[High Quality Print]' }
            },
            required: ['bookPath', 'outputPath']
        }
    },
    {
        name: 'preflight_book',
        description: 'Preflight a book and save the preflight report (PDF, or text if the path ends in .txt). The report path is returned.',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                outputPath: { type: 'string', description: 'Path for the preflight report (default: <book name>-preflight.pdf in the system temp folder)' },
                autoOpen: { type: 'boolean', description: 'Automatically open the report', default: false }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'print_book',
        description: 'Print a book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                printDialog: { type: 'boolean', description: 'Show print dialog', default: true },
                printerPreset: {
                    type: 'string',
                    description: 'Printer preset name (e.g. "[Default]" or a saved preset), or "DEFAULT_VALUE" for the default preset',
                    default: 'DEFAULT_VALUE'
                }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'get_book_info',
        description: 'Get detailed information about a book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' }
            },
            required: ['bookPath']
        }
    },
    {
        name: 'set_book_properties',
        description: 'Set book options (only the ones given) and save the book',
        inputSchema: {
            type: 'object',
            properties: {
                bookPath: { type: 'string', description: 'Path to the book file' },
                automaticPagination: { type: 'boolean', description: 'Enable automatic pagination' },
                automaticDocumentConversion: { type: 'boolean', description: 'Enable automatic document conversion' },
                insertBlankPage: { type: 'boolean', description: 'Insert blank pages as necessary' },
                mergeIdenticalLayers: { type: 'boolean', description: 'Merge identical layers when exporting to PDF' },
                synchronizeBulletNumberingList: { type: 'boolean', description: 'Synchronize bullets and numbering' },
                synchronizeCellStyle: { type: 'boolean', description: 'Synchronize cell styles' },
                synchronizeCharacterStyle: { type: 'boolean', description: 'Synchronize character styles' },
                synchronizeConditionalText: { type: 'boolean', description: 'Synchronize conditional text' },
                synchronizeCrossReferenceFormat: { type: 'boolean', description: 'Synchronize cross reference formats' },
                synchronizeMasterPage: { type: 'boolean', description: 'Synchronize master pages' },
                synchronizeObjectStyle: { type: 'boolean', description: 'Synchronize object styles' },
                synchronizeParagraphStyle: { type: 'boolean', description: 'Synchronize paragraph styles' },
                synchronizeSwatch: { type: 'boolean', description: 'Synchronize swatches' },
                synchronizeTableOfContentStyle: { type: 'boolean', description: 'Synchronize table of content styles' },
                synchronizeTableStyle: { type: 'boolean', description: 'Synchronize table styles' },
                synchronizeTextVariable: { type: 'boolean', description: 'Synchronize text variables' },
                synchronizeTrapStyle: { type: 'boolean', description: 'Synchronize trap styles' }
            },
            required: ['bookPath']
        }
    }
]; 