/**
 * Document tool definitions for InDesign MCP Server
 * Document management and advanced functionality
 *
 * Property names in the preference specs below are the real InDesign DOM
 * names (InDesign 2023 scripting DOM), so values read by the get_* tools can
 * be passed straight back to the matching set_* tools.
 */

/** UIColors enum members (InDesign DOM). */
export const UI_COLORS = [
    'BLACK', 'BLUE', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CHARCOAL', 'CUTE_TEAL', 'CYAN',
    'DARK_BLUE', 'DARK_GREEN', 'FIESTA', 'GOLD', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE',
    'GRID_GREEN', 'GRID_ORANGE', 'LAVENDER', 'LIGHT_BLUE', 'LIGHT_GRAY', 'LIGHT_OLIVE',
    'LIPSTICK', 'MAGENTA', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'PURPLE', 'RED',
    'SULPHUR', 'TAN', 'TEAL', 'VIOLET', 'WHITE', 'YELLOW',
];

/** PageNumberStyle enum members (InDesign DOM). */
export const PAGE_NUMBER_STYLES = [
    'ARABIC', 'UPPER_ROMAN', 'LOWER_ROMAN', 'UPPER_LETTERS', 'LOWER_LETTERS',
    'SINGLE_LEADING_ZEROS', 'DOUBLE_LEADING_ZEROS', 'TRIPLE_LEADING_ZEROS', 'KANJI',
    'ARABIC_ABJAD', 'ARABIC_ALIF_BA_TAH', 'HEBREW_BIBLICAL', 'HEBREW_NON_STANDARD',
];

// Preference property kinds. `measure` values are millimetres when given as
// numbers; strings with units ("12pt", "0.5in") are also accepted.
const B = () => ({ kind: 'bool' });
const M = () => ({ kind: 'measure' });
const I = (min, max) => ({ kind: 'int', min, max });
const N = (min, max) => ({ kind: 'number', min, max });
const C = () => ({ kind: 'uiColor' });
const E = (enumName, values) => ({ kind: 'enum', enumName, values });

/**
 * Document-level preference groups. `target` is the JSX expression of the
 * preference object (`doc` is the active document in the generated script).
 */
export const DOCUMENT_PREFERENCE_SPECS = {
    general: {
        target: 'doc.documentPreferences',
        title: 'Document setup (DocumentPreference)',
        props: {
            pageWidth: M(),
            pageHeight: M(),
            pageOrientation: E('PageOrientation', ['PORTRAIT', 'LANDSCAPE']),
            facingPages: B(),
            pagesPerDocument: I(1, 9999),
            startPageNumber: I(1, 999999),
            allowPageShuffle: B(),
            preserveLayoutWhenShuffling: B(),
            createPrimaryTextFrame: B(),
            intent: E('DocumentIntentOptions', ['PRINT_INTENT', 'WEB_INTENT', 'MOBILE_INTENT']),
            pageBinding: E('PageBindingOptions', ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'DEFAULT_VALUE']),
            documentBleedUniformSize: B(),
            documentBleedTopOffset: M(),
            documentBleedBottomOffset: M(),
            documentBleedInsideOrLeftOffset: M(),
            documentBleedOutsideOrRightOffset: M(),
            documentSlugUniformSize: B(),
            slugTopOffset: M(),
            slugBottomOffset: M(),
            slugInsideOrLeftOffset: M(),
            slugRightOrOutsideOffset: M(),
            columnGuideColor: C(),
            marginGuideColor: C(),
            columnGuideLocked: B(),
            overprintBlack: B(),
        },
    },
    margins: {
        target: 'doc.marginPreferences',
        title: 'Margins and columns (MarginPreference)',
        props: {
            top: M(),
            bottom: M(),
            left: M(),
            right: M(),
            columnCount: I(1, 216),
            columnGutter: M(),
            columnDirection: E('HorizontalOrVertical', ['HORIZONTAL', 'VERTICAL']),
        },
    },
    guides: {
        target: 'doc.guidePreferences',
        title: 'Ruler guides (GuidePreference)',
        props: {
            guidesShown: B(),
            guidesLocked: B(),
            guidesInBack: B(),
            guidesSnapto: B(),
            rulerGuidesColor: C(),
            rulerGuidesViewThreshold: N(5, 4000),
        },
    },
    text: {
        target: 'doc.textPreferences',
        title: 'Text (TextPreference)',
        props: {
            typographersQuotes: B(),
            showInvisibles: B(),
            highlightCustomSpacing: B(),
            highlightHjViolations: B(),
            highlightKeeps: B(),
            highlightSubstitutedFonts: B(),
            highlightSubstitutedGlyphs: B(),
            smartTextReflow: B(),
            addPages: E('AddPageOptions', ['END_OF_STORY', 'END_OF_SECTION', 'END_OF_DOCUMENT']),
            limitToMasterTextFrames: B(),
            preserveFacingPageSpreads: B(),
            deleteEmptyPages: B(),
            useOpticalSize: B(),
            useParagraphLeading: B(),
            justifyTextWraps: B(),
            abutTextToTextWrap: B(),
            zOrderTextWrap: B(),
            superscriptSize: N(1, 200),
            superscriptPosition: N(-500, 500),
            subscriptSize: N(1, 200),
            subscriptPosition: N(-500, 500),
            smallCap: N(1, 200),
        },
    },
    grid: {
        target: 'doc.gridPreferences',
        title: 'Grids (GridPreference)',
        props: {
            documentGridShown: B(),
            documentGridSnapto: B(),
            gridColor: C(),
            horizontalGridlineDivision: M(),
            horizontalGridSubdivision: I(1, 10000),
            verticalGridlineDivision: M(),
            verticalGridSubdivision: I(1, 10000),
            gridsInBack: B(),
            baselineGridShown: B(),
            baselineColor: C(),
            baselineStart: M(),
            baselineDivision: M(),
            baselineViewThreshold: N(5, 4000),
            baselineGridRelativeOption: E('BaselineGridRelativeOption', [
                'TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION',
                'TOP_OF_MARGIN_OF_BASELINE_GRID_RELATIVE_OPTION',
            ]),
        },
    },
};

/**
 * Layout preference groups. Adjust Layout is stored in the document; Align &
 * Distribute and Smart Guides are application-wide preferences in InDesign.
 */
export const LAYOUT_PREFERENCE_SPECS = {
    adjustLayout: {
        target: 'doc.adjustLayoutPreferences',
        title: 'Adjust Layout (document, AdjustLayoutPreference)',
        props: {
            enableAdjustLayout: B(),
            enableAutoAdjustMargins: B(),
            allowFontSizeAndLeadingAdjustment: B(),
            allowLockedObjectsToAdjust: B(),
            imposeFontSizeRestriction: B(),
            minimumFontSize: N(0.1, 1296),
            maximumFontSize: N(0.1, 1296),
        },
    },
    alignDistribute: {
        target: 'app.alignDistributePreferences',
        title: 'Align & Distribute (application-wide, AlignDistributePreference)',
        props: {
            alignDistributeBounds: E('AlignDistributeBounds', [
                'ITEM_BOUNDS', 'MARGIN_BOUNDS', 'PAGE_BOUNDS', 'SPREAD_BOUNDS', 'KEY_OBJECT',
            ]),
            distributeAbsolute: B(),
            distributeAbsoluteMeasurement: M(),
            distributeSpaceAbsolute: B(),
            distributeSpaceAbsoluteMeasurement: M(),
        },
    },
    smartGuides: {
        target: 'app.smartGuidePreferences',
        title: 'Smart Guides (application-wide, SmartGuidePreference)',
        props: {
            enabled: B(),
            alignToObjectCenter: B(),
            alignToObjectEdges: B(),
            smartDimensions: B(),
            smartSpacing: B(),
            guideColor: C(),
        },
    },
};

const MEASURE_HINT = 'Millimetres (a string with units such as "12pt" or "0.5in" is also accepted)';

function propSchema(name, spec) {
    switch (spec.kind) {
        case 'bool':
            return { type: 'boolean', description: name };
        case 'measure':
            return { type: 'number', description: `${name}. ${MEASURE_HINT}` };
        case 'int':
            return { type: 'integer', minimum: spec.min, maximum: spec.max, description: name };
        case 'number':
            return { type: 'number', minimum: spec.min, maximum: spec.max, description: name };
        case 'uiColor':
            return { type: 'string', enum: UI_COLORS, description: `${name} (UIColors)` };
        case 'enum':
            return { type: 'string', enum: spec.values, description: `${name} (${spec.enumName})` };
        default:
            throw new Error(`unknown preference kind ${spec.kind}`);
    }
}

function groupSchema(group) {
    const properties = {};
    for (const [name, spec] of Object.entries(group.props)) properties[name] = propSchema(name, spec);
    return { type: 'object', description: group.title, properties, additionalProperties: false };
}

export const documentToolDefinitions = [
    // =================== DOCUMENT MANAGEMENT ===================
    {
        name: 'get_document_info',
        description: 'Get information about the active document (name, path, page/spread/layer counts, page size, bleed and margins in millimetres)',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'create_document',
        description: 'Create a new document and make it active. All measurements are in millimetres. Margins are applied to every page of the new document.',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', description: 'Page width in mm', default: 210 },
                height: { type: 'number', description: 'Page height in mm', default: 297 },
                pages: { type: 'integer', minimum: 1, maximum: 9999, description: 'Number of pages', default: 1 },
                facingPages: { type: 'boolean', description: 'Enable facing pages', default: false },
                pageOrientation: { type: 'string', enum: ['PORTRAIT', 'LANDSCAPE'], description: 'Page orientation; width and height are swapped if needed to match', default: 'PORTRAIT' },
                bleedTop: { type: 'number', description: 'Top bleed in mm', default: 3 },
                bleedBottom: { type: 'number', description: 'Bottom bleed in mm', default: 3 },
                bleedInside: { type: 'number', description: 'Inside (left) bleed in mm', default: 3 },
                bleedOutside: { type: 'number', description: 'Outside (right) bleed in mm', default: 3 },
                marginTop: { type: 'number', description: 'Top margin in mm', default: 20 },
                marginBottom: { type: 'number', description: 'Bottom margin in mm', default: 20 },
                marginLeft: { type: 'number', description: 'Left (inside, for facing pages) margin in mm', default: 20 },
                marginRight: { type: 'number', description: 'Right (outside, for facing pages) margin in mm', default: 20 },
            },
        },
    },
    {
        name: 'open_document',
        description: 'Open an existing InDesign document (.indd, .indt, .idml) and make it active',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path to the document file' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'save_document',
        description: 'Save the active document. With filePath, saves to that location (Save As); without it, saves in place (the document must have been saved before).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path to save to (e.g. /Users/me/Documents/file.indd). Omit to save in place.' },
            },
        },
    },
    {
        name: 'close_document',
        description: 'Close the active document WITHOUT saving (unsaved changes are discarded)',
        inputSchema: { type: 'object', properties: {} },
    },

    // =================== DOCUMENT ADVANCED TOOLS ===================
    {
        name: 'preflight_document',
        description: 'Run a preflight check on the active document with a preflight profile and list the problems found (optionally saving a report)',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Preflight profile name, e.g. "[Basic]" (the built-in profile). Embedded document profiles are checked first, then application profiles.', default: '[Basic]' },
                reportPath: { type: 'string', description: 'Optional absolute path to save the preflight report (.pdf or .txt)' },
                maxResults: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of problems to list', default: 50 },
                timeoutSeconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'Maximum seconds to wait for preflight to finish', default: 60 },
            },
        },
    },
    {
        name: 'zoom_to_page',
        description: 'Show a page in the document window: fit the page in the window, or zoom to a given percentage',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: 'Zero-based page index to show' },
                zoomLevel: { type: 'number', minimum: 5, maximum: 4000, description: 'Zoom percentage (5-4000). Omit to fit the page in the window.' },
            },
            required: ['pageIndex'],
        },
    },
    {
        name: 'data_merge',
        description: 'Data merge: select a CSV or tab-delimited text data source for the active document and (optionally) merge records. The document must already contain data merge placeholders for merging to succeed.',
        inputSchema: {
            type: 'object',
            properties: {
                dataSource: { type: 'string', description: 'Absolute path to the data source file (.csv or tab-delimited .txt)' },
                mergeRecords: { type: 'boolean', description: 'Merge records after selecting the data source. If false, only selects the source and lists its fields.', default: true },
                recordSelection: { type: 'string', enum: ['ALL_RECORDS', 'ONE_RECORD', 'RANGE'], description: 'Which records to merge', default: 'ALL_RECORDS' },
                recordNumber: { type: 'integer', minimum: 1, description: 'Record to merge when recordSelection is ONE_RECORD' },
                recordRange: { type: 'string', description: 'Record range when recordSelection is RANGE, e.g. "1-5,8"' },
                recordsPerPage: { type: 'string', enum: ['SINGLE_RECORD', 'MULTIPLE_RECORD'], description: 'One record per page, or multiple records per page', default: 'SINGLE_RECORD' },
                createNewDocument: { type: 'boolean', description: 'Create a new document for the merged records', default: true },
                removeBlankLines: { type: 'boolean', description: 'Remove blank lines caused by empty fields', default: false },
            },
            required: ['dataSource'],
        },
    },

    // =================== DOCUMENT ELEMENTS & STYLES ===================
    {
        name: 'get_document_elements',
        description: 'Count the elements in the document (text frames, stories, shapes, graphics, tables, groups, layers), including items nested in groups',
        inputSchema: {
            type: 'object',
            properties: {
                elementType: { type: 'string', enum: ['all', 'text', 'graphics', 'tables'], description: 'Which kind of elements to count', default: 'all' },
            },
        },
    },
    {
        name: 'get_document_styles',
        description: 'List the styles of one type in the document (including styles inside style groups)',
        inputSchema: {
            type: 'object',
            properties: {
                styleType: { type: 'string', enum: ['PARAGRAPH', 'CHARACTER', 'OBJECT', 'TABLE', 'CELL'], description: 'Type of styles to list', default: 'PARAGRAPH' },
            },
        },
    },
    {
        name: 'get_document_colors',
        description: 'List the colors (with color model) and optionally the swatches, gradients and tints in the document',
        inputSchema: {
            type: 'object',
            properties: {
                includeSwatches: { type: 'boolean', description: 'Include swatches', default: true },
                includeGradients: { type: 'boolean', description: 'Include gradients', default: true },
                includeTints: { type: 'boolean', description: 'Include tints', default: true },
            },
        },
    },

    // =================== DOCUMENT PREFERENCES ===================
    {
        name: 'get_document_preferences',
        description: 'Read document preferences. Measurements are reported in millimetres. Property names match set_document_preferences.',
        inputSchema: {
            type: 'object',
            properties: {
                preferenceType: { type: 'string', enum: ['GENERAL', 'MARGINS', 'GUIDES', 'TEXT', 'GRID', 'ALL'], description: 'Which preference group to read', default: 'GENERAL' },
            },
        },
    },
    {
        name: 'set_document_preferences',
        description: 'Set document preferences. Pass one or more groups (general, margins, guides, text, grid) with the properties to change. Measurements are millimetres. Margin changes are applied to the document defaults and to every existing document and master page.',
        inputSchema: {
            type: 'object',
            properties: {
                general: groupSchema(DOCUMENT_PREFERENCE_SPECS.general),
                margins: groupSchema(DOCUMENT_PREFERENCE_SPECS.margins),
                guides: groupSchema(DOCUMENT_PREFERENCE_SPECS.guides),
                text: groupSchema(DOCUMENT_PREFERENCE_SPECS.text),
                grid: groupSchema(DOCUMENT_PREFERENCE_SPECS.grid),
            },
        },
    },

    // =================== DOCUMENT STORIES & TEXT ===================
    {
        name: 'get_document_stories',
        description: 'List the stories in the document with length, frame count, overset status and a short preview',
        inputSchema: {
            type: 'object',
            properties: {
                oversetOnly: { type: 'boolean', description: 'Only list stories whose text is overset (overflows its frames)', default: false },
                maxStories: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum number of stories to list', default: 100 },
            },
        },
    },
    {
        name: 'find_text_in_document',
        description: 'Find (and optionally replace) text across the entire document. Uses Text find/change, or GREP when useRegex is true.',
        inputSchema: {
            type: 'object',
            properties: {
                searchText: { type: 'string', description: 'Text to search for (a GREP pattern when useRegex is true)' },
                replaceText: { type: 'string', description: 'Replacement text. Omit to only find; pass "" to delete matches.' },
                caseSensitive: { type: 'boolean', description: 'Case sensitive search', default: false },
                wholeWord: { type: 'boolean', description: 'Match whole words only', default: false },
                useRegex: { type: 'boolean', description: 'Treat searchText as a GREP pattern (and replaceText may use $1 etc.)', default: false },
            },
            required: ['searchText'],
        },
    },

    // =================== DOCUMENT LAYERS & ORGANIZATION ===================
    {
        name: 'get_document_layers',
        description: 'List the layers in the document (top to bottom) with visibility, lock state, printability and item count',
        inputSchema: {
            type: 'object',
            properties: {
                includeHidden: { type: 'boolean', description: 'Include hidden layers', default: true },
                includeLocked: { type: 'boolean', description: 'Include locked layers', default: true },
            },
        },
    },
    {
        name: 'organize_document_layers',
        description: 'Organize document layers: merge layers with duplicate names, delete empty layers, and/or sort layers alphabetically (A at top). Operations run in that order. The last remaining layer is never deleted.',
        inputSchema: {
            type: 'object',
            properties: {
                mergeSimilarLayers: { type: 'boolean', description: 'Merge layers whose names are equal ignoring case, surrounding spaces and a trailing " copy" / " copy N" (default false)' },
                deleteEmptyLayers: { type: 'boolean', description: 'Delete layers that contain no page items and no guides (default false)' },
                sortLayers: { type: 'boolean', description: 'Sort layers alphabetically by name (default false)' },
            },
        },
    },

    // =================== DOCUMENT HYPERLINKS & INTERACTIVITY ===================
    {
        name: 'get_document_hyperlinks',
        description: 'List the hyperlinks in the document with their sources and destinations',
        inputSchema: {
            type: 'object',
            properties: {
                includeDestinations: { type: 'boolean', description: 'Include link destinations (URL, page or text anchor)', default: true },
                includeSources: { type: 'boolean', description: 'Include link sources (the linked text or object)', default: true },
            },
        },
    },
    {
        name: 'create_document_hyperlink',
        description: 'Create a hyperlink on the first occurrence of sourceText in the document. The destination is a URL, a page, or the first occurrence of some other text (a text anchor).',
        inputSchema: {
            type: 'object',
            properties: {
                sourceText: { type: 'string', description: 'Existing text in the document to turn into a link (first occurrence, case-sensitive)' },
                linkType: { type: 'string', enum: ['URL', 'PAGE', 'TEXT'], description: 'Type of destination', default: 'URL' },
                destination: { type: 'string', description: 'For URL: the URL. For TEXT: existing text in the document to link to. Not used for PAGE.' },
                pageIndex: { type: 'integer', minimum: 0, description: 'Zero-based destination page index (required for PAGE links)' },
                name: { type: 'string', description: 'Optional hyperlink name (must be unique in the document)' },
            },
            required: ['sourceText'],
        },
    },

    // =================== DOCUMENT SECTIONS & NUMBERING ===================
    {
        name: 'get_document_sections',
        description: 'List the sections in the document with start page, numbering style, start number, prefix and marker',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'create_document_section',
        description: 'Start a new section at a page (or update the section that already starts there) with its own page numbering',
        inputSchema: {
            type: 'object',
            properties: {
                startPage: { type: 'integer', minimum: 0, description: 'Zero-based index of the page that starts the section' },
                sectionPrefix: { type: 'string', description: 'Section prefix' },
                includeSectionPrefix: { type: 'boolean', description: 'Include the prefix when displaying page numbers' },
                marker: { type: 'string', description: 'Section marker text' },
                startNumber: { type: 'integer', minimum: 1, description: 'Starting page number. Omit to continue numbering from the previous section.' },
                numberingStyle: { type: 'string', enum: PAGE_NUMBER_STYLES, description: 'Page number style (PageNumberStyle)', default: 'ARABIC' },
            },
            required: ['startPage'],
        },
    },

    // =================== DOCUMENT XML & STRUCTURE ===================
    {
        name: 'get_document_xml_structure',
        description: 'Show the document XML structure: the tag list and/or the element tree (tag, attribute and child counts, text preview)',
        inputSchema: {
            type: 'object',
            properties: {
                includeTags: { type: 'boolean', description: 'Include the list of XML tags', default: true },
                includeElements: { type: 'boolean', description: 'Include the XML element tree', default: true },
                maxDepth: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum element tree depth to show', default: 10 },
            },
        },
    },
    {
        name: 'export_document_xml',
        description: 'Export the document XML structure (the Structure pane content) to an XML file',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the XML file to write' },
                includeImages: { type: 'boolean', description: 'Copy original images into an Images folder next to the XML file', default: false },
            },
            required: ['filePath'],
        },
    },

    // =================== DOCUMENT CLOUD & COLLABORATION ===================
    {
        name: 'save_document_to_cloud',
        description: 'Save the active document as an Adobe Creative Cloud document (Document.saveAsCloud / saveACopyCloud). Requires InDesign with cloud documents support and a signed-in Creative Cloud account.',
        inputSchema: {
            type: 'object',
            properties: {
                cloudName: { type: 'string', description: 'Name for the cloud document' },
                mode: { type: 'string', enum: ['SAVE_A_COPY', 'SAVE_AS'], description: 'SAVE_A_COPY keeps the open document as is; SAVE_AS makes the open document the cloud document', default: 'SAVE_A_COPY' },
            },
            required: ['cloudName'],
        },
    },
    {
        name: 'open_cloud_document',
        description: 'Open an Adobe Creative Cloud document by its asset reference (app.openCloudDocument). Requires InDesign with cloud documents support and a signed-in Creative Cloud account.',
        inputSchema: {
            type: 'object',
            properties: {
                cloudDocumentId: { type: 'string', description: 'Asset reference of the cloud document (as reported by InDesign, e.g. a urn:aaid:... identifier)' },
            },
            required: ['cloudDocumentId'],
        },
    },

    // =================== DOCUMENT GRID & LAYOUT ===================
    {
        name: 'get_document_grid_settings',
        description: 'Get the document grid and baseline grid settings (measurements in millimetres). Property names match set_document_grid_settings.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'set_document_grid_settings',
        description: 'Set document grid and baseline grid settings (GridPreference). Pass only the properties to change. Measurements are millimetres.',
        inputSchema: groupSchema(DOCUMENT_PREFERENCE_SPECS.grid),
    },
    {
        name: 'get_document_layout_preferences',
        description: 'Get Adjust Layout preferences (document) and Align & Distribute and Smart Guides preferences (application-wide). Property names match set_document_layout_preferences.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'set_document_layout_preferences',
        description: 'Set Adjust Layout preferences (stored in the document) and Align & Distribute / Smart Guides preferences (application-wide in InDesign). Pass one or more groups with the properties to change.',
        inputSchema: {
            type: 'object',
            properties: {
                adjustLayout: groupSchema(LAYOUT_PREFERENCE_SPECS.adjustLayout),
                alignDistribute: groupSchema(LAYOUT_PREFERENCE_SPECS.alignDistribute),
                smartGuides: groupSchema(LAYOUT_PREFERENCE_SPECS.smartGuides),
            },
        },
    },

    // =================== DOCUMENT VALIDATION & CLEANUP ===================
    {
        name: 'validate_document',
        description: 'Check the document for problems: missing/modified links, missing fonts, missing or low-resolution images, overset text and unused styles',
        inputSchema: {
            type: 'object',
            properties: {
                checkLinks: { type: 'boolean', description: 'Report links that are missing, out of date or inaccessible', default: true },
                checkFonts: { type: 'boolean', description: 'Report fonts that are not installed (missing, substituted, faux)', default: true },
                checkImages: { type: 'boolean', description: 'Report placed graphics with missing/modified links and images below minImagePpi', default: true },
                minImagePpi: { type: 'number', minimum: 1, maximum: 10000, description: 'Minimum effective resolution for images', default: 150 },
                checkOverset: { type: 'boolean', description: 'Report stories with overset text', default: true },
                checkStyles: { type: 'boolean', description: 'Report paragraph and character styles not applied to any text', default: false },
            },
        },
    },
    {
        name: 'cleanup_document',
        description: 'Clean up the document by removing unused paragraph/character styles, unused swatches, empty layers and/or hidden page items. Use dryRun to list what would be removed.',
        inputSchema: {
            type: 'object',
            properties: {
                removeUnusedStyles: { type: 'boolean', description: 'Remove paragraph and character styles not applied to any text (built-in [bracketed] styles are kept) (default false)' },
                removeUnusedColors: { type: 'boolean', description: 'Remove unused swatches (built-in [bracketed] swatches are kept) (default false)' },
                removeUnusedLayers: { type: 'boolean', description: 'Remove layers with no page items and no guides (the last layer is kept) (default false)' },
                removeHiddenElements: { type: 'boolean', description: 'Remove page items that are hidden (visible = false) (default false)' },
                dryRun: { type: 'boolean', description: 'Only report what would be removed', default: false },
            },
        },
    },
];
