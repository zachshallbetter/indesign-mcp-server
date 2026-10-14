/**
 * Master Spread tool definitions for InDesign MCP Server
 * Master spread template management and functionality.
 * Master spreads are addressed by full name, e.g. "A-Master" (prefix-baseName).
 */

const UI_COLOR_HELP = 'UI color name (e.g. "BLUE", "LIGHT_BLUE", "GRID_GREEN") or "r,g,b" (0-255)';
const SWATCH_HELP = 'swatch name in the document (e.g. "Black", "Paper", "None") or "#RRGGBB"';

export const masterSpreadToolDefinitions = [
    // =================== MASTER SPREAD MANAGEMENT ===================
    {
        name: 'create_master_spread',
        description: 'Create a new master spread. Its full name is namePrefix + "-" + baseName (e.g. "B-Chapter").',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Master name; used as the base name unless baseName is given' },
                baseName: { type: 'string', description: 'Base name (overrides name)' },
                namePrefix: { type: 'string', description: 'Prefix shown on pages using this master (e.g. "B"); InDesign assigns one if omitted' },
                pagesPerSpread: { type: 'integer', minimum: 1, maximum: 10, description: 'Pages in the master spread (default: document setting)' },
                pageColor: { type: 'string', description: `Pages-panel color: ${UI_COLOR_HELP}, "USE_MASTER_COLOR" or "NOTHING"` },
                showMasterItems: { type: 'boolean', description: 'Show master items on document pages', default: true },
            },
            required: ['name'],
        },
    },
    {
        name: 'list_master_spreads',
        description: 'List all master spreads in the document',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'delete_master_spread',
        description: 'Delete a master spread (pages that used it are left with no master)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Full master spread name to delete (e.g. "B-Master")' },
            },
            required: ['name'],
        },
    },
    {
        name: 'duplicate_master_spread',
        description: 'Duplicate a master spread; the copy gets newName as its base name (InDesign assigns a new prefix)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Full name of the master spread to duplicate (e.g. "A-Master")' },
                newName: { type: 'string', description: 'Base name for the duplicated master spread' },
                position: { description: 'Where to put the copy among the masters: AT_END, AT_BEGINNING, or BEFORE/AFTER the reference master', type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END' },
                referenceMasterName: { type: 'string', description: 'Full name of the reference master spread (required for BEFORE/AFTER)' },
            },
            required: ['name', 'newName'],
        },
    },
    {
        name: 'apply_master_spread',
        description: 'Apply a master spread to document pages. Use masterName "None" to remove the master.',
        inputSchema: {
            type: 'object',
            properties: {
                masterName: { type: 'string', description: 'Full master spread name (e.g. "A-Master"), or "None"' },
                pageRange: { type: 'string', description: '1-based page positions in document order: "all", "3", "1-5" or "1,3,7-9"', default: 'all' },
            },
            required: ['masterName'],
        },
    },
    {
        name: 'create_master_text_frame',
        description: 'Create a text frame on a page of a master spread. Position and size are in mm from that master page\'s top-left corner.',
        inputSchema: {
            type: 'object',
            properties: {
                masterName: { type: 'string', description: 'Full master spread name (e.g. "A-Master")' },
                masterPageIndex: { type: 'integer', minimum: 0, description: '0-based page within the master spread (0 = left/first page)', default: 0 },
                content: { type: 'string', description: 'Text content for the frame' },
                x: { type: 'number', description: 'X position in mm', default: 10 },
                y: { type: 'number', description: 'Y position in mm', default: 10 },
                width: { type: 'number', description: 'Width in mm', default: 100 },
                height: { type: 'number', description: 'Height in mm', default: 50 },
                fontSize: { type: 'number', description: 'Font size in points', default: 12 },
                fontName: { type: 'string', description: 'Font as "Family\\tStyle" (e.g. "Arial\\tBold", InDesign\'s Font.name) or a family name', default: 'Helvetica Neue' },
                textColor: { type: 'string', description: `Text color: ${SWATCH_HELP}`, default: 'Black' },
                alignment: { description: 'Paragraph alignment for the frame text (InDesign Justification; LEFT_JUSTIFIED = justified, last line left)', type: 'string', enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED'], default: 'LEFT_ALIGN' },
                isPrimaryTextFrame: { type: 'boolean', description: 'Make this the master spread\'s primary text frame', default: false },
            },
            required: ['masterName', 'content'],
        },
    },
    {
        name: 'create_master_rectangle',
        description: 'Create a rectangle on a page of a master spread. Position and size are in mm from that master page\'s top-left corner.',
        inputSchema: {
            type: 'object',
            properties: {
                masterName: { type: 'string', description: 'Full master spread name (e.g. "A-Master")' },
                masterPageIndex: { type: 'integer', minimum: 0, description: '0-based page within the master spread', default: 0 },
                x: { type: 'number', description: 'X position in mm' },
                y: { type: 'number', description: 'Y position in mm' },
                width: { type: 'number', description: 'Width in mm' },
                height: { type: 'number', description: 'Height in mm' },
                fillColor: { type: 'string', description: `Fill: ${SWATCH_HELP} (default: document default)` },
                strokeColor: { type: 'string', description: `Stroke: ${SWATCH_HELP} (default: document default)` },
                strokeWeight: { type: 'number', minimum: 0, description: 'Stroke weight in points', default: 1 },
                cornerRadius: { type: 'number', minimum: 0, description: 'Rounded-corner radius in mm (0 = square corners)', default: 0 },
            },
            required: ['masterName', 'x', 'y', 'width', 'height'],
        },
    },
    {
        name: 'create_master_guides',
        description: 'Create row/column guides on every page of a master spread (MasterSpread.createGuides)',
        inputSchema: {
            type: 'object',
            properties: {
                masterName: { type: 'string', description: 'Full master spread name (e.g. "A-Master")' },
                numberOfRows: { type: 'integer', minimum: 0, description: 'Number of rows per page', default: 0 },
                numberOfColumns: { type: 'integer', minimum: 0, description: 'Number of columns per page', default: 0 },
                rowGutter: { type: 'number', minimum: 0, description: 'Row gutter in mm', default: 5 },
                columnGutter: { type: 'number', minimum: 0, description: 'Column gutter in mm', default: 5 },
                guideColor: { type: 'string', description: `Guide color: ${UI_COLOR_HELP}`, default: 'BLUE' },
                fitMargins: { type: 'boolean', description: 'Divide the area inside the margins (true) or the whole page (false)', default: true },
                removeExisting: { type: 'boolean', description: 'Remove existing guides first', default: false },
                layerName: { type: 'string', description: 'Layer to create guides on (default: active layer)' },
            },
            required: ['masterName'],
        },
    },
    {
        name: 'get_master_spread_info',
        description: 'Get detailed information about a master spread',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Full master spread name (e.g. "A-Master")' },
            },
            required: ['name'],
        },
    },
    {
        name: 'detach_master_items',
        description: 'Detach master page items onto a document page: each master item is overridden onto the page and the copy is detached so it no longer follows the master. Without itemIndex, all master items shown on the page (and items already overridden there) are detached.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based document page index' },
                itemIndex: { type: 'integer', minimum: 0, description: '0-based index into the page\'s master items (Page.masterPageItems); omit to detach all' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'remove_master_override',
        description: 'Remove local overrides from master items on a document page, restoring the master version. Without itemIndex, all overrides on the page are removed.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based document page index' },
                itemIndex: { type: 'integer', minimum: 0, description: '0-based index among the page\'s overridden master items (top-level page items first, then guides); omit to remove all' },
            },
            required: ['pageIndex'],
        },
    },
];
