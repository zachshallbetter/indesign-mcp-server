/**
 * Page tool definitions for InDesign MCP Server
 * Page management and advanced page properties
 */

export const pageToolDefinitions = [
    // =================== BASIC PAGE MANAGEMENT ===================
    {
        name: 'add_page',
        description: 'Add a page to the active document at the end, the beginning, or before/after a given page; returns the new page count',
        inputSchema: {
            type: 'object',
            properties: {
                position: { description: 'Where to add the page: AT_END, AT_BEGINNING, or BEFORE/AFTER referencePage', type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END' },
                referencePage: { type: 'integer', minimum: 0, description: '0-based reference page index (required for BEFORE/AFTER)' },
            },
        },
    },
    {
        name: 'delete_page',
        description: 'Delete a page from the document (the only page cannot be deleted)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based index of the page to delete' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'duplicate_page',
        description: 'Duplicate a page and put the copy at the given position in the document',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based index of the page to duplicate' },
                position: { type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END', description: 'Where to put the copy' },
                referencePageIndex: { type: 'integer', minimum: 0, description: '0-based reference page index (required for BEFORE/AFTER)' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'navigate_to_page',
        description: 'Navigate to a page: make it the active page of the document\'s layout window',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based index of the page to navigate to' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'get_page_info',
        description: 'Get detailed information about a specific page',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'move_page',
        description: 'Move a page to a different position in the document',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based index of the page to move' },
                position: { description: 'Where to move the page: AT_END, AT_BEGINNING, or BEFORE/AFTER referencePage', type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END' },
                referencePageIndex: { type: 'integer', minimum: 0, description: '0-based reference page index (required for BEFORE/AFTER; must differ from pageIndex)' },
                binding: { type: 'string', enum: ['DEFAULT_VALUE', 'LEFT_ALIGN', 'RIGHT_ALIGN'], default: 'DEFAULT_VALUE', description: 'Location of the binding spine in the spread (BindingOptions)' },
            },
            required: ['pageIndex'],
        },
    },

    // =================== ADVANCED PAGE PROPERTIES ===================
    {
        name: 'set_page_properties',
        description: 'Set properties for a page (only the properties given are changed)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                label: { type: 'string', description: 'Page label' },
                pageColor: { type: 'string', description: 'Page color shown in the Pages panel: UI color name (e.g. "BLUE", "LIGHT_BLUE"), "r,g,b" (0-255), "USE_MASTER_COLOR" or "NOTHING"' },
                optionalPage: { type: 'boolean', description: 'Optional page for HTML5 pagination' },
                layoutRule: { type: 'string', enum: ['GUIDE_BASED', 'OBJECT_BASED', 'OFF', 'PRESERVE_EXISTING', 'RECENTER', 'SCALE', 'USE_MASTER'], description: 'Liquid layout rule (LayoutRuleOptions)' },
                snapshotBlendingMode: { type: 'string', enum: ['FULL_SNAPSHOT_BLENDING', 'IGNORE_LAYOUT_SNAPSHOTS', 'LIMITED_SNAPSHOT_BLENDING', 'USE_NEAREST_SNAPSHOT'], description: 'Snapshot blending mode (SnapshotBlendingModes)' },
                appliedTrapPreset: { type: 'string', description: 'Name of an existing trap preset to apply' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'adjust_page_layout',
        description: 'Adjust a page\'s size and margins with InDesign\'s Adjust Layout (content is repositioned/scaled to follow). Bleed values are a document setting and are applied to the whole document. All values use the given units.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                units: { type: 'string', enum: ['mm', 'cm', 'in', 'pt', 'px'], default: 'mm', description: 'Units for all values below' },
                width: { type: 'number', description: 'New page width' },
                height: { type: 'number', description: 'New page height' },
                bleedInside: { type: 'number', description: 'Inside (left) bleed, document-wide' },
                bleedTop: { type: 'number', description: 'Top bleed, document-wide' },
                bleedOutside: { type: 'number', description: 'Outside (right) bleed, document-wide' },
                bleedBottom: { type: 'number', description: 'Bottom bleed, document-wide' },
                leftMargin: { type: 'number', description: 'Left margin' },
                topMargin: { type: 'number', description: 'Top margin' },
                rightMargin: { type: 'number', description: 'Right margin' },
                bottomMargin: { type: 'number', description: 'Bottom margin' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'resize_page',
        description: 'Resize a page (Page.resize). With REPLACING/ADDING, width and height are lengths in mm; with MULTIPLYING they are scale factors; with RESHAPING_* they are a width:height ratio.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                width: { type: 'number', description: 'Width value (mm, factor or ratio part depending on resizeMethod)' },
                height: { type: 'number', description: 'Height value (mm, factor or ratio part depending on resizeMethod)' },
                resizeMethod: { description: 'How width and height are applied: replace the size (default), multiply it, add to it, or reshape to a ratio', type: 'string', enum: ['REPLACING_CURRENT_DIMENSIONS_WITH', 'MULTIPLYING_CURRENT_DIMENSIONS_BY', 'ADDING_CURRENT_DIMENSIONS_TO', 'RESHAPING_AREA_TO_RATIO', 'RESHAPING_BORDER_TO_RATIO'], default: 'REPLACING_CURRENT_DIMENSIONS_WITH' },
                anchorPoint: { description: 'Point of the page that stays fixed while it resizes', type: 'string', enum: ['TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR', 'LEFT_CENTER_ANCHOR', 'CENTER_ANCHOR', 'RIGHT_CENTER_ANCHOR', 'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR'], default: 'CENTER_ANCHOR' },
                coordinateSpace: { description: 'Coordinate space the size is measured in; PAGE_COORDINATES unless you need another', type: 'string', enum: ['PAGE_COORDINATES', 'SPREAD_COORDINATES', 'PASTEBOARD_COORDINATES', 'INNER_COORDINATES', 'PARENT_COORDINATES'], default: 'PAGE_COORDINATES' },
            },
            required: ['pageIndex', 'width', 'height'],
        },
    },
    {
        name: 'place_file_on_page',
        description: 'Place a file (image, PDF, text, InDesign snippet, ...) on a page. x/y are measured in mm from the page\'s top-left corner.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                filePath: { type: 'string', description: 'Path to file to place' },
                x: { type: 'number', description: 'X position in mm', default: 10 },
                y: { type: 'number', description: 'Y position in mm', default: 10 },
                layerName: { type: 'string', description: 'Layer to place on (default: active layer)' },
                showingOptions: { type: 'boolean', description: 'Show import options dialog', default: false },
                autoflowing: { type: 'boolean', description: 'Autoflow placed text', default: false },
            },
            required: ['pageIndex', 'filePath'],
        },
    },
    {
        name: 'place_xml_on_page',
        description: 'Place an XML element (the first element whose tag matches xmlElementName) on a page. x/y are measured in mm from the page\'s top-left corner.',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                xmlElementName: { type: 'string', description: 'Tag name of the XML element to place' },
                x: { type: 'number', description: 'X position in mm', default: 10 },
                y: { type: 'number', description: 'Y position in mm', default: 10 },
                autoflowing: { type: 'boolean', description: 'Autoflow placed text', default: false },
            },
            required: ['pageIndex', 'xmlElementName'],
        },
    },
    {
        name: 'snapshot_page_layout',
        description: 'Create a liquid-layout snapshot of the page layout for its current size and shape',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'delete_page_layout_snapshot',
        description: 'Delete the page\'s layout snapshot for its current size and shape',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'delete_all_page_layout_snapshots',
        description: 'Delete all layout snapshots for a page',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'reframe_page',
        description: 'Reframe a page: set its bounding box from two opposing corners, in mm in the given coordinate space',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                x1: { type: 'number', description: 'Top-left X coordinate in mm' },
                y1: { type: 'number', description: 'Top-left Y coordinate in mm' },
                x2: { type: 'number', description: 'Bottom-right X coordinate in mm' },
                y2: { type: 'number', description: 'Bottom-right Y coordinate in mm' },
                coordinateSpace: { description: 'Coordinate space of the corner coordinates; PAGE_COORDINATES unless you need another', type: 'string', enum: ['PAGE_COORDINATES', 'SPREAD_COORDINATES', 'PASTEBOARD_COORDINATES', 'INNER_COORDINATES', 'PARENT_COORDINATES'], default: 'PAGE_COORDINATES' },
            },
            required: ['pageIndex', 'x1', 'y1', 'x2', 'y2'],
        },
    },
    {
        name: 'create_page_guides',
        description: 'Create row/column guides on one page (like Layout > Create Guides, limited to this page)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                numberOfRows: { type: 'integer', minimum: 0, description: 'Number of rows (2+ creates horizontal guides)', default: 0 },
                numberOfColumns: { type: 'integer', minimum: 0, description: 'Number of columns (2+ creates vertical guides)', default: 0 },
                rowGutter: { type: 'number', minimum: 0, description: 'Row gutter in mm', default: 5 },
                columnGutter: { type: 'number', minimum: 0, description: 'Column gutter in mm', default: 5 },
                guideColor: { type: 'string', description: 'Guide color: UI color name (e.g. "BLUE", "GRID_GREEN") or "r,g,b" (0-255)', default: 'BLUE' },
                fitMargins: { type: 'boolean', description: 'Divide the area inside the margins (true) or the whole page (false)', default: true },
                removeExisting: { type: 'boolean', description: 'Remove the page\'s existing guides first', default: false },
                layerName: { type: 'string', description: 'Layer to create the guides on (default: active layer)' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'select_page',
        description: 'Select a page in the active document (for example before running a command that acts on the selection)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
                selectionMode: { description: 'REPLACE_WITH replaces the selection; ADD_TO / REMOVE_FROM change it; SET_KEY makes the page the key object', type: 'string', enum: ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM', 'SET_KEY'], default: 'REPLACE_WITH' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'get_page_content_summary',
        description: 'Summarize what is on a page: counts of text frames, rectangles, ovals, polygons, lines, groups, placed graphics, guides and master items',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'set_page_background',
        description: 'Set a page background: adds a full-page rectangle filled with a swatch, sent to the back of its layer',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: '0-based page index (default 0, the first page)', default: 0 },
                backgroundColor: { type: 'string', description: 'Swatch name in the document (e.g. "Paper", "Black", a custom swatch); "White" falls back to "Paper"', default: 'Paper' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Background opacity percentage (0-100)', default: 100 },
            },
            required: [],
        },
    },
]; 