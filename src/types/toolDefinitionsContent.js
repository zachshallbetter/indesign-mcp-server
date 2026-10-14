/**
 * Content tool definitions for InDesign MCP Server
 * Text, graphics, styling, and content management functionality
 *
 * Geometry is in millimetres, measured from the top-left corner of the target
 * page. Tools that act on a page use `pageIndex` (0-based) when given and the
 * active page otherwise. Colors accept a swatch name or "#RRGGBB" (an RGB
 * swatch with that name is created on first use).
 */

const PAGE_INDEX = { type: 'integer', minimum: 0, description: 'Page index (0-based); defaults to the active page' };
const COLOR = (what) => ({ type: 'string', description: `${what}: swatch name (e.g. "Black", "Paper") or "#RRGGBB"` });

export const contentToolDefinitions = [
    // =================== TEXT MANAGEMENT ===================
    {
        name: 'create_text_frame',
        description: 'Create a text frame on the active page (or pageIndex). Styles are applied first; explicit formatting overrides them.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Text content for the frame' },
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm from the page left edge', default: 10 },
                y: { type: 'number', description: 'Y position in mm from the page top edge', default: 10 },
                width: { type: 'number', description: 'Width in mm', default: 100 },
                height: { type: 'number', description: 'Height in mm', default: 50 },
                fontSize: { type: 'number', description: 'Font size in points (default: style/document default)' },
                fontName: { type: 'string', description: 'Font as "Family\\tStyle" (e.g. "Arial\\tRegular") or a family name (default: style/document default)' },
                textColor: COLOR('Text color (default: style/document default)'),
                alignment: { type: 'string', enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'], description: 'JUSTIFY = justified, last line left' },
                paragraphStyle: { type: 'string', description: 'Paragraph style name to apply' },
                characterStyle: { type: 'string', description: 'Character style name to apply' },
            },
            required: ['content'],
        },
    },
    {
        name: 'edit_text_frame',
        description: 'Edit the content and/or formatting of an existing text frame',
        inputSchema: {
            type: 'object',
            properties: {
                frameIndex: { type: 'integer', minimum: 0, description: 'Index of the text frame on the page (page.textFrames order)' },
                pageIndex: PAGE_INDEX,
                content: { type: 'string', description: 'New text content (replaces existing text)' },
                fontSize: { type: 'number', description: 'Font size in points' },
                fontName: { type: 'string', description: 'Font as "Family\\tStyle" or a family name' },
                textColor: COLOR('Text color'),
                alignment: { type: 'string', enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'] },
            },
            required: ['frameIndex'],
        },
    },
    {
        name: 'find_replace_text',
        description: 'Find and replace literal text throughout the document (InDesign text search; metacharacters such as ^p and ^t are honored)',
        inputSchema: {
            type: 'object',
            properties: {
                findText: { type: 'string', description: 'Text to find' },
                replaceText: { type: 'string', description: 'Text to replace with' },
                caseSensitive: { type: 'boolean', description: 'Case sensitive search', default: false },
                wholeWord: { type: 'boolean', description: 'Whole word search', default: false },
            },
            required: ['findText', 'replaceText'],
        },
    },
    {
        name: 'create_table',
        description: 'Create a table in a new text frame on the active page (or pageIndex)',
        inputSchema: {
            type: 'object',
            properties: {
                rows: { type: 'integer', minimum: 1, description: 'Total number of rows, including header rows', default: 3 },
                columns: { type: 'integer', minimum: 1, description: 'Number of columns', default: 3 },
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm' },
                y: { type: 'number', description: 'Y position in mm' },
                width: { type: 'number', description: 'Frame and table width in mm' },
                height: { type: 'number', description: 'Text frame height in mm' },
                headerRows: { type: 'integer', minimum: 0, description: 'Number of header rows (must be less than rows; default 1 when rows > 1)' },
            },
            required: ['rows', 'columns'],
        },
    },
    {
        name: 'populate_table',
        description: 'Fill table cells from a 2-D array. Tables are numbered across the text frames of the page; cells outside the table are skipped and counted.',
        inputSchema: {
            type: 'object',
            properties: {
                tableIndex: { type: 'integer', minimum: 0, description: 'Table index on the page', default: 0 },
                pageIndex: PAGE_INDEX,
                data: {
                    type: 'array',
                    description: 'Rows of cell values; null becomes an empty cell',
                    items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
                },
                startRow: { type: 'integer', minimum: 0, description: 'Starting row index (header rows count)', default: 0 },
                startColumn: { type: 'integer', minimum: 0, description: 'Starting column index', default: 0 },
            },
            required: ['data'],
        },
    },

    // =================== GRAPHICS MANAGEMENT ===================
    {
        name: 'place_image',
        description: 'Place an image file in a new frame on the active page (or pageIndex). Omit width and height to size the frame to the image.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path to the image file' },
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm', default: 10 },
                y: { type: 'number', description: 'Y position in mm', default: 10 },
                width: { type: 'number', description: 'Frame width in mm' },
                height: { type: 'number', description: 'Frame height in mm' },
                linkImage: { type: 'boolean', description: 'Keep the image linked (false embeds it)', default: true },
                scale: { type: 'number', description: 'Image scale percentage (1-1000); used when fitMode is NONE or the frame is sized to the image', default: 100 },
                fitMode: {
                    type: 'string',
                    description: 'InDesign fit option applied to the frame (PROPORTIONALLY and FILL_PROPORTIONALLY also center the content); NONE keeps the placed size',
                    enum: ['PROPORTIONALLY', 'FILL_PROPORTIONALLY', 'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'CENTER_CONTENT', 'NONE'],
                    default: 'PROPORTIONALLY'
                },
                objectStyle: { type: 'string', description: 'Object style to apply to the frame' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'help',
        description: 'Get help information about available tools and their usage',
        inputSchema: {
            type: 'object',
            properties: {
                tool: {
                    type: 'string',
                    description: 'Specific tool name to get help for (optional)',
                    default: null
                },
                category: {
                    type: 'string',
                    description: 'Category of tools to list (optional)',
                    enum: ['document', 'page', 'text', 'graphics', 'styles', 'layout', 'export', 'all'],
                    default: 'all'
                },
                format: {
                    type: 'string',
                    description: 'Output format',
                    enum: ['summary', 'detailed', 'examples'],
                    default: 'summary'
                }
            },
            required: [],
        },
    },
    {
        name: 'create_rectangle',
        description: 'Create a rectangle on the active page (or pageIndex)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm from the page top-left; omitted values are placed on the page automatically' },
                y: { type: 'number', description: 'Y position in mm' },
                width: { type: 'number', description: 'Width in mm' },
                height: { type: 'number', description: 'Height in mm' },
                fillColor: COLOR('Fill color'),
                strokeColor: COLOR('Stroke color'),
                strokeWidth: { type: 'number', description: 'Stroke weight in points (default 1 when strokeColor is given)' },
                cornerRadius: { type: 'number', description: 'Rounded corner radius in mm (0 = square corners)', default: 0 },
            },
        },
    },
    {
        name: 'create_ellipse',
        description: 'Create an ellipse on the active page (or pageIndex)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm from the page top-left; omitted values are placed on the page automatically' },
                y: { type: 'number', description: 'Y position in mm' },
                width: { type: 'number', description: 'Width in mm' },
                height: { type: 'number', description: 'Height in mm' },
                fillColor: COLOR('Fill color'),
                strokeColor: COLOR('Stroke color'),
                strokeWidth: { type: 'number', description: 'Stroke weight in points (default 1 when strokeColor is given)' },
            },
        },
    },
    {
        name: 'create_polygon',
        description: 'Create a regular polygon on the active page (or pageIndex)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: PAGE_INDEX,
                x: { type: 'number', description: 'X position in mm from the page top-left; omitted values are placed on the page automatically' },
                y: { type: 'number', description: 'Y position in mm' },
                width: { type: 'number', description: 'Width in mm' },
                height: { type: 'number', description: 'Height in mm' },
                sides: { type: 'integer', minimum: 3, maximum: 100, description: 'Number of sides', default: 6 },
                fillColor: COLOR('Fill color'),
                strokeColor: COLOR('Stroke color'),
                strokeWidth: { type: 'number', description: 'Stroke weight in points (default 1 when strokeColor is given)' },
            },
        },
    },
    {
        name: 'create_object_style',
        description: 'Create an object style; only the attributes you pass are included in the style',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Object style name' },
                fillColor: COLOR('Fill color'),
                strokeColor: COLOR('Stroke color'),
                strokeWeight: { type: 'number', description: 'Stroke weight in points (default 1 when strokeColor is given)' },
                cornerRadius: { type: 'number', description: 'Rounded corner radius in mm (0 = not included)', default: 0 },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Opacity percentage (100 = fully opaque)' },
            },
            required: ['name'],
        },
    },
    {
        name: 'list_object_styles',
        description: 'List all object styles in the document',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'apply_object_style',
        description: 'Apply an object style to a page item',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: 'Object style name' },
                itemType: {
                    type: 'string',
                    enum: ['rectangle', 'ellipse', 'polygon', 'textFrame', 'pageItem'],
                    description: 'Collection itemIndex refers to; pageItem = index from list_page_items',
                    default: 'rectangle',
                },
                itemIndex: { type: 'integer', minimum: 0, description: 'Item index within itemType on the page', default: 0 },
                pageIndex: PAGE_INDEX,
                clearOverrides: { type: 'boolean', description: 'Clear local formatting overrides', default: false },
            },
            required: ['styleName'],
        },
    },
    {
        name: 'get_image_info',
        description: 'Get link, resolution, scale and position of a placed graphic on a page',
        inputSchema: {
            type: 'object',
            properties: {
                itemIndex: { type: 'integer', minimum: 0, description: 'Index among the placed graphics on the page', default: 0 },
                pageIndex: PAGE_INDEX,
            },
        },
    },

    // =================== STYLES MANAGEMENT ===================
    {
        name: 'create_paragraph_style',
        description: 'Create a paragraph style; only the attributes you pass are set',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Style name' },
                fontFamily: { type: 'string', description: 'Font as "Family\\tStyle" (e.g. "Arial\\tRegular") or a family name' },
                fontSize: { type: 'number', description: 'Font size in points' },
                textColor: COLOR('Text color'),
                alignment: {
                    type: 'string',
                    enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED'],
                },
                leading: { type: 'number', description: 'Leading in points' },
                spaceBefore: { type: 'number', description: 'Space before paragraph in points' },
                spaceAfter: { type: 'number', description: 'Space after paragraph in points' },
            },
            required: ['name'],
        },
    },
    {
        name: 'create_character_style',
        description: 'Create a character style; only the attributes you pass are set',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Style name' },
                fontFamily: { type: 'string', description: 'Font as "Family\\tStyle" or a family name' },
                fontSize: { type: 'number', description: 'Font size in points' },
                textColor: COLOR('Text color'),
                bold: { type: 'boolean', description: 'Set font style "Bold" ("Bold Italic" with italic)', default: false },
                italic: { type: 'boolean', description: 'Set font style "Italic"', default: false },
                underline: { type: 'boolean', description: 'Underline text', default: false },
            },
            required: ['name'],
        },
    },
    {
        name: 'apply_paragraph_style',
        description: 'Apply a paragraph style to all text in a text frame',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: 'Paragraph style name' },
                frameIndex: { type: 'integer', minimum: 0, description: 'Text frame index on the page' },
                pageIndex: PAGE_INDEX,
            },
            required: ['styleName', 'frameIndex'],
        },
    },
    {
        name: 'apply_character_style',
        description: 'Apply a character style to all text in a text frame, or to a character range',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: 'Character style name' },
                frameIndex: { type: 'integer', minimum: 0, description: 'Text frame index on the page', default: 0 },
                pageIndex: PAGE_INDEX,
                startIndex: { type: 'integer', minimum: 0, description: 'First character index (with endIndex)', default: 0 },
                endIndex: { type: 'integer', minimum: -1, description: 'Last character index (inclusive); -1 applies to the whole frame', default: -1 },
            },
            required: ['styleName'],
        },
    },
    {
        name: 'list_styles',
        description: 'List all paragraph and/or character styles (including styles in style groups)',
        inputSchema: {
            type: 'object',
            properties: {
                styleType: { type: 'string', enum: ['PARAGRAPH', 'CHARACTER', 'ALL'], default: 'ALL' },
            },
        },
    },

    // =================== COLORS MANAGEMENT ===================
    {
        name: 'create_color_swatch',
        description: 'Create a color swatch from RGB values, stored as RGB or converted to CMYK',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Swatch name' },
                colorType: { type: 'string', enum: ['PROCESS', 'SPOT'], default: 'PROCESS' },
                colorSpace: { type: 'string', enum: ['RGB', 'CMYK'], description: 'Color space of the swatch (CMYK uses a simple, non-color-managed conversion)', default: 'RGB' },
                red: { type: 'number', minimum: 0, maximum: 255, description: 'Red value (0-255)' },
                green: { type: 'number', minimum: 0, maximum: 255, description: 'Green value (0-255)' },
                blue: { type: 'number', minimum: 0, maximum: 255, description: 'Blue value (0-255)' },
            },
            required: ['name', 'red', 'green', 'blue'],
        },
    },
    {
        name: 'list_color_swatches',
        description: 'List all swatches with color model, space and values',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'apply_color',
        description: 'Apply a swatch as fill or stroke to a page item, or to the text of a text frame',
        inputSchema: {
            type: 'object',
            properties: {
                objectIndex: { type: 'integer', minimum: 0, description: 'Index within targetType on the page' },
                colorName: COLOR('Color'),
                colorType: { type: 'string', enum: ['FILL', 'STROKE'], default: 'FILL' },
                targetType: {
                    type: 'string',
                    enum: ['pageItem', 'text', 'textFrame', 'rectangle', 'ellipse', 'polygon'],
                    description: 'pageItem = index from list_page_items; text = the text inside page.textFrames[objectIndex]',
                    default: 'pageItem',
                },
                pageIndex: PAGE_INDEX,
            },
            required: ['objectIndex', 'colorName'],
        },
    },
];
