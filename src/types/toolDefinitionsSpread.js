/**
 * Spread tool definitions for InDesign MCP Server
 * Spread management and functionality
 */

export const spreadToolDefinitions = [
    // =================== SPREAD MANAGEMENT ===================
    {
        name: 'list_spreads',
        description: 'List all spreads in the active document with their pages, applied master, item count and label',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_spread_info',
        description: 'Get detailed information about a spread: pages, applied master, page shuffle, master item visibility, page transition, item and guide counts',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'duplicate_spread',
        description: 'Duplicate a spread (Spread.duplicate) and place the copy at the given location in the document',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index to duplicate (0-based)' },
                position: { type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END', description: 'Where to put the copy (LocationOptions)' },
                referenceSpreadIndex: { type: 'number', description: 'Reference spread index (0-based); required for BEFORE/AFTER' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'move_spread',
        description: 'Move a spread (Spread.move) to a different position in the document',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index to move (0-based)' },
                position: { type: 'string', enum: ['AT_END', 'AT_BEGINNING', 'BEFORE', 'AFTER'], default: 'AT_END', description: 'Destination (LocationOptions)' },
                referenceSpreadIndex: { type: 'number', description: 'Reference spread index (0-based); required for BEFORE/AFTER, must differ from spreadIndex' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'delete_spread',
        description: 'Delete a spread and all its pages. The last remaining spread cannot be deleted.',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index to delete (0-based)' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'set_spread_properties',
        description: 'Set writable properties of a spread. Only the properties you pass are changed; each is applied independently and any rejected value is reported.',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
                name: { type: 'string', description: "Spread name (InDesign treats this as an alias of the spread's label)" },
                label: { type: 'string', description: 'Script label (any string)' },
                allowPageShuffle: { type: 'boolean', description: 'If true, the spread holds at most two pages when pages are added; if false, pages can be added or moved into this existing spread' },
                showMasterItems: { type: 'boolean', description: 'Display master page items on the pages of this spread' },
                pageTransitionType: { type: 'string', enum: ['NONE', 'BLINDS_TRANSITION', 'BOX_TRANSITION', 'COMB_TRANSITION', 'COVER_TRANSITION', 'DISSOLVE_TRANSITION', 'FADE_TRANSITION', 'PUSH_TRANSITION', 'SPLIT_TRANSITION', 'UNCOVER_TRANSITION', 'WIPE_TRANSITION', 'ZOOM_IN_TRANSITION', 'ZOOM_OUT_TRANSITION'], description: 'Page transition type (PageTransitionTypeOptions), used in SWF/interactive PDF export' },
                pageTransitionDirection: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL', 'HORIZONTAL_IN', 'HORIZONTAL_OUT', 'VERTICAL_IN', 'VERTICAL_OUT', 'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'UP', 'DOWN', 'LEFT_UP', 'LEFT_DOWN', 'RIGHT_UP', 'RIGHT_DOWN', 'IN', 'OUT', 'NOT_APPLICABLE'], description: 'Page transition direction (PageTransitionDirectionOptions); must be one the chosen transition type supports' },
                pageTransitionDuration: { type: 'string', enum: ['FAST', 'MEDIUM', 'SLOW'], description: 'Page transition duration (PageTransitionDurationOptions)' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'create_spread_guides',
        description: 'Create row/column guides on every page of a spread (Spread.createGuides). Set numberOfRows and/or numberOfColumns above 0; with both 0 nothing is created (the result reports the guide count before and after).',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
                numberOfRows: { type: 'number', description: 'Number of rows to create on each page (0-100)', default: 0 },
                numberOfColumns: { type: 'number', description: 'Number of columns to create on each page (0-100)', default: 0 },
                rowGutter: { type: 'number', description: 'Row gutter in mm', default: 5 },
                columnGutter: { type: 'number', description: 'Column gutter in mm', default: 5 },
                guideColor: { type: 'string', description: 'Guide color: a UIColors name (e.g. BLUE, LIGHT_BLUE, GRID_GREEN) or "R,G,B" with each value 0-255', default: 'BLUE' },
                fitMargins: { type: 'boolean', description: 'If true, rows/columns divide the area inside the page margins; if false, the full page', default: true },
                removeExisting: { type: 'boolean', description: 'Remove existing guides when creating the new ones', default: false },
                layerName: { type: 'string', description: 'Name of an existing layer to create the guides on (default: active layer)' },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'place_file_on_spread',
        description: 'Place a file (image, PDF, text, InDesign snippet...) on a spread at a point (Spread.place)',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
                filePath: { type: 'string', description: 'Absolute path to the file to place (must be inside the allowed directories)' },
                x: { type: 'number', description: 'X of the place point in mm, measured from the ruler origin (spread origin by default)', default: 10 },
                y: { type: 'number', description: 'Y of the place point in mm, measured from the ruler origin', default: 10 },
                layerName: { type: 'string', description: 'Name of an existing layer to place on (default: active layer)' },
                showingOptions: { type: 'boolean', description: 'Show the import options dialog (modal: blocks until a user closes it in InDesign)', default: false },
                autoflowing: { type: 'boolean', description: 'Autoflow placed text', default: false },
            },
            required: ['spreadIndex', 'filePath'],
        },
    },
    {
        name: 'place_xml_on_spread',
        description: "Place an element of the document's XML structure on a spread (Spread.placeXML). The element is found by tag name, searching the structure depth-first from the root.",
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
                xmlElementName: { type: 'string', description: 'Tag name (markup tag) of the XML element to place' },
                matchIndex: { type: 'number', description: 'Which element to use when several have this tag (0-based, document order)', default: 0 },
                x: { type: 'number', description: 'X of the place point in mm, measured from the ruler origin', default: 10 },
                y: { type: 'number', description: 'Y of the place point in mm, measured from the ruler origin', default: 10 },
                autoflowing: { type: 'boolean', description: 'Autoflow placed text', default: false },
            },
            required: ['spreadIndex', 'xmlElementName'],
        },
    },
    {
        name: 'select_spread',
        description: 'Select a spread (Spread.select) and optionally make it the active spread in the layout window',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index to select (0-based)' },
                selectionMode: { type: 'string', enum: ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM', 'SET_KEY'], default: 'REPLACE_WITH', description: 'How the selection relates to the existing selection (SelectionOptions)' },
                makeActive: { type: 'boolean', description: "Also make it the layout window's active spread (scrolls it into view)", default: true },
            },
            required: ['spreadIndex'],
        },
    },
    {
        name: 'get_spread_content_summary',
        description: 'Summarize the content of a spread: item counts by type, overset text frames, placed graphics with link status, and items per layer',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'number', description: 'Spread index (0-based)' },
            },
            required: ['spreadIndex'],
        },
    },
]; 