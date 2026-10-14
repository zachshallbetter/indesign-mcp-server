/**
 * Export tool definitions for InDesign MCP Server
 * Export, packaging, and production functionality
 */

const PAGES = {
    type: 'string',
    description: 'Pages to export: "all", or absolute 1-based page numbers/ranges such as "1-3,5"',
    default: 'all',
};

export const exportToolDefinitions = [
    // =================== EXPORT MANAGEMENT ===================
    {
        name: 'export_pdf',
        description: 'Export the active document to PDF using a built-in or named PDF export preset',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Output PDF file path' },
                quality: {
                    type: 'string',
                    enum: ['PRESS', 'PRINT', 'SCREEN'],
                    description: 'Preset shortcut: PRESS = [Press Quality], PRINT = [High Quality Print], SCREEN = [Smallest File Size]',
                    default: 'PRINT',
                },
                preset: { type: 'string', description: 'Exact PDF export preset name (e.g. "[PDF/X-4:2008]"); overrides quality' },
                includeMarks: { type: 'boolean', description: 'Force crop, bleed and registration marks, color bars and page info on (otherwise the preset decides)', default: false },
                includeBleed: { type: 'boolean', description: 'Force the document bleed settings on (otherwise the preset decides)', default: false },
                pages: PAGES,
            },
            required: ['filePath'],
        },
    },
    {
        name: 'export_images',
        description: 'Export pages as JPEG or PNG images, one file per page (page_<n>.jpg/png) in an output folder',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: 'Output folder path (created if missing)' },
                format: { type: 'string', enum: ['JPEG', 'PNG'], default: 'JPEG' },
                resolution: { type: 'number', description: 'Resolution in PPI (1-2400)', default: 300 },
                pages: PAGES,
                quality: { type: 'number', description: 'Quality 1-100, mapped to LOW (<=25), MEDIUM (<=50), HIGH (<=80) or MAXIMUM', default: 80 },
            },
            required: ['outputPath'],
        },
    },
    {
        name: 'export_epub',
        description: 'Export the active document to EPUB (reflowable or fixed layout)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Output EPUB file path' },
                layout: { type: 'string', enum: ['REFLOWABLE', 'FIXED_LAYOUT'], default: 'REFLOWABLE' },
                includeStyles: { type: 'boolean', description: 'Reflowable only: generate CSS and include style class names in the HTML', default: true },
                embedFonts: { type: 'boolean', description: 'Reflowable only: embed fonts', default: true },
                title: { type: 'string', description: 'EPUB title metadata (defaults to the document setting)' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'package_document',
        description: 'Package the active (saved) document for printing into an output folder',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: 'Output folder path (created if missing)' },
                includeFonts: { type: 'boolean', description: 'Copy fonts', default: true },
                includeLinks: { type: 'boolean', description: 'Copy linked graphics', default: true },
                includeProfiles: { type: 'boolean', description: 'Copy color profiles', default: true },
                includeHiddenLayers: { type: 'boolean', description: 'Include fonts and links from hidden layers', default: false },
                createReport: { type: 'boolean', description: 'Write the instructions/report file', default: true },
                forceSave: { type: 'boolean', description: 'Save the document before packaging if it has unsaved changes', default: false },
            },
            required: ['outputPath'],
        },
    },
];
