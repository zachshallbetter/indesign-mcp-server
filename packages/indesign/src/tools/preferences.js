/**
 * Preferences: the panes of Edit > Preferences (InDesign > Settings on macOS)
 * read and written through the application's preference objects.
 *
 * Each pane is a table of options. An option names the preference object it
 * lives on (`app.` for application-wide preferences, `R.` for ones the
 * application and each document both keep: R is the application or the
 * active document, as the caller's scope says), the DOM property, and how its
 * value is checked, written and read back.
 *
 * Settings other tools already cover are left to them: Notes, Track Changes,
 * Story Editor Display and the typing options of the Type pane
 * (set_editorial_preferences), type contextual controls and font locking
 * (set_type_preferences), transparency display quality
 * (set_transparency_preferences), the document grid and baseline grid
 * (set_document_grid_settings), margin and column guide colours
 * (set_document_preferences) and Smart Guides (set_document_layout_preferences).
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run } from './run.js';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';
import { UI_COLORS } from '../types/toolDefinitionsDocument.js';

const G = 'app.generalPreferences';
const UNITS = ['POINTS', 'PICAS', 'INCHES', 'INCHES_DECIMAL', 'MILLIMETERS', 'CENTIMETERS', 'CICEROS', 'AGATES', 'PIXELS', 'Q', 'HA', 'BAI', 'MILS', 'U', 'AMERICAN_POINTS', 'CUSTOM'];
const IMAGE_QUALITY = ['GRAY_OUT', 'PROXY', 'HIGH_RESOLUTION'];

// Option builders: obj is the preference object's JSX expression.
const B = (obj, prop, desc) => ({ kind: 'bool', obj, prop, desc });
const E = (obj, prop, enumName, values, desc) => ({ kind: 'enum', obj, prop, enumName, values, desc });
const I = (obj, prop, min, max, desc) => ({ kind: 'int', obj, prop, min, max, desc });
const N = (obj, prop, min, max, desc) => ({ kind: 'num', obj, prop, min, max, desc });
const PT = (obj, prop, min, max, desc) => ({ kind: 'pt', obj, prop, min, max, desc });
const C = (obj, prop, desc) => ({ kind: 'color', obj, prop, desc });
/** A choice whose JSX values differ from the caller's names: map = { name: JSX literal }. */
const M = (obj, prop, map, desc) => ({ kind: 'map', obj, prop, map, desc });
/** A property added after InDesign 2023, written and read by name. */
const since = (version, spec) => ({ ...spec, since: version });

const DISPLAY_LEVEL = (n, label) => ({
    kind: 'group',
    desc: `Adjust View Settings for ${label}`,
    props: {
        raster: E(`app.displaySettings.item(${n})`, 'raster', 'TagRaster', IMAGE_QUALITY, 'Raster Images: Gray Out, Proxy or High Resolution'),
        vector: E(`app.displaySettings.item(${n})`, 'vector', 'TagVector', IMAGE_QUALITY, 'Vector Graphics: Gray Out, Proxy or High Resolution'),
        antialiasing: B(`app.displaySettings.item(${n})`, 'antialiasing', 'Enable Anti-aliasing'),
        greekBelow: N(`app.displaySettings.item(${n})`, 'greekBelow', 0, 1296, 'Greek Type Below this size (points)'),
    },
});

const MOJIKUMI_SETS = [
    'lineEndAllOneEm', 'lineEndAllOneHalfEm', 'lineEndPeriodOneEm', 'lineEndUkeNoFloat',
    'oneEmIndentLineEndAllNoFloat', 'oneEmIndentLineEndAllOneEm', 'oneEmIndentLineEndAllOneHalfEm', 'oneEmIndentLineEndPeriodOneEm',
    'oneEmIndentLineEndUkeNoFloat', 'oneEmIndentLineEndUkeOneHalfEm', 'oneOrOneHalfEmIndentLineEndAllOneEm',
    'oneOrOneHalfEmIndentLineEndPeriodOneEm', 'oneOrOneHalfEmIndentLineEndUkeNoFloat', 'oneOrOneHalfEmIndentLineEndUkeOneHalfEm',
];

/** The Preferences panes: { pane: { title, props } }. */
export const PANES = {
    general: {
        title: 'General',
        props: {
            showHomeScreen: B(G, 'showStartWorkspace', 'Show Home Screen When No Documents Are Open'),
            legacyNewDocumentDialog: B(G, 'showLegacyNewDocumentDialog', 'Use Legacy "New Document" Dialog'),
            showWhatsNewOnStartup: B(G, 'showWhatsNewOnStartup', 'Show What\'s New on Startup'),
            pageNumbering: E(G, 'pageNumbering', 'PageNumberingOptions', ['SECTION', 'ABSOLUTE'], 'Page Numbering View: Section Numbering or Absolute Numbering'),
            fontDownloadGlyphLimit: I(G, 'completeFontDownloadGlyphLimit', 0, 65535, 'Font Downloading and Embedding: always subset fonts with glyph counts greater than this'),
            whenScaling: E('app.transformPreferences', 'whenScaling', 'WhenScalingOptions', ['APPLY_TO_CONTENT', 'ADJUST_SCALING_PERCENTAGE'], 'When Scaling: Apply to Content, or Adjust Scaling Percentage'),
            includeStrokeWeight: B('app.transformPreferences', 'adjustStrokeWeightWhenScaling', 'When scaling, include stroke weight'),
            includeEffects: B('app.transformPreferences', 'adjustEffectsWhenScaling', 'When scaling, include effects'),
            preventSelectingLockedObjects: B(G, 'preventSelectingLockedItems', 'Prevent Selection of Locked Objects'),
            contentAwareFit: B(G, 'enableContentAwareFit', 'Content-Aware Fit as the default frame fitting when placing'),
            temporaryFolder: { kind: 'folder', obj: G, prop: 'temporaryFolder', desc: 'Temporary Folder: an existing folder inside the allowed directories' },
        },
    },
    interface: {
        title: 'Interface',
        props: {
            colorTheme: M(G, 'uiBrightnessPreference', { dark: '0', medium_dark: '0.5', medium_light: '0.51', light: '1' }, 'Color Theme'),
            matchPasteboardToTheme: { kind: 'bool01', obj: G, prop: 'pasteboardColorPreference', desc: 'Match Pasteboard to Theme Color (false: white pasteboard)' },
            highlightObjectUnderSelection: B(G, 'highlightObjectUnderSelectionTool', 'Highlight Object Under Selection Tool'),
            toolTips: E(G, 'toolTips', 'ToolTipOptions', ['NORMAL', 'FAST', 'NONE'], 'Tool Tips'),
            showThumbnailsOnPlace: B(G, 'placeCursorUsesThumbnails', 'Show Thumbnails on Place'),
            showTransformationValues: B(G, 'showTransformationValues', 'Show Transformation Values'),
            multiTouchGestures: B(G, 'enableMultiTouchGestures', 'Enable Multi-Touch Gestures'),
            toolsPanel: E(G, 'toolsPanel', 'ToolsPanelOptions', ['SINGLE_COLUMN', 'DOUBLE_COLUMN', 'SINGLE_ROW'], 'Floating Tools Panel layout'),
            autoCollapseIconPanels: B(G, 'autoCollapseIconPanels', 'Auto-Collapse Icon Panels'),
            autoShowHiddenPanels: B(G, 'autoShowHiddenPanels', 'Auto-Show Hidden Panels'),
            openDocumentsAsTabs: B(G, 'openDocumentsAsTabs', 'Open Documents as Tabs'),
            floatingDocumentWindowDocking: B(G, 'enableFloatingWindowDocking', 'Enable Floating Document Window Docking'),
            largeTabs: B(G, 'panelTabHeightPreference', 'Large Tabs on panels'),
            handToolPanning: E('app.grabberPreferences', 'grabberPanning', 'PanningTypes', ['NO_GREEKING', 'GREEK_IMAGES', 'GREEK_IMAGES_AND_TEXT'], 'Hand Tool: display quality while scrolling (No Greeking = better quality, Greek Images and Text = faster)'),
            liveScreenDrawing: E('app', 'liveScreenDrawing', 'LiveDrawingOptions', ['IMMEDIATELY', 'DELAYED', 'NEVER'], 'Live Screen Drawing'),
            greekVectorGraphicsOnDrag: B(G, 'greekVectorGraphicsOnDrag', 'Greek Vector Graphics on Drag'),
        },
    },
    type: {
        title: 'Type',
        props: {
            typographersQuotes: B('R.textPreferences', 'typographersQuotes', 'Use Typographer\'s Quotes'),
            useOpticalSize: B('R.textPreferences', 'useOpticalSize', 'Automatically Use Correct Optical Size'),
            applyLeadingToParagraphs: B('R.textPreferences', 'useParagraphLeading', 'Apply Leading to Entire Paragraphs'),
            smartTextReflow: B('R.textPreferences', 'smartTextReflow', 'Smart Text Reflow'),
            addPagesTo: E('R.textPreferences', 'addPages', 'AddPageOptions', ['END_OF_STORY', 'END_OF_SECTION', 'END_OF_DOCUMENT'], 'Smart Text Reflow: add pages to'),
            limitToPrimaryTextFrames: B('R.textPreferences', 'limitToMasterTextFrames', 'Smart Text Reflow: Limit to Primary Text Frames'),
            preserveFacingPageSpreads: B('R.textPreferences', 'preserveFacingPageSpreads', 'Smart Text Reflow: Preserve Facing-Page Spreads'),
            deleteEmptyPages: B('R.textPreferences', 'deleteEmptyPages', 'Smart Text Reflow: Delete Empty Pages'),
        },
    },
    advancedType: {
        title: 'Advanced Type',
        props: {
            superscriptSize: N('R.textPreferences', 'superscriptSize', 1, 200, 'Superscript size (% of the font size)'),
            superscriptPosition: N('R.textPreferences', 'superscriptPosition', -500, 500, 'Superscript position (% of the leading)'),
            subscriptSize: N('R.textPreferences', 'subscriptSize', 1, 200, 'Subscript size (% of the font size)'),
            subscriptPosition: N('R.textPreferences', 'subscriptPosition', -500, 500, 'Subscript position (% of the leading)'),
            smallCapSize: N('R.textPreferences', 'smallCap', 1, 200, 'Small Caps size (% of the font size)'),
            inlineInput: B('app.imePreferences', 'inlineInput', 'Use Inline Input for Non-Latin Text'),
            nativeDigits: B('app.imePreferences', 'useNativeDigits', 'Use native digits when typing Arabic'),
        },
    },
    composition: {
        title: 'Composition',
        props: {
            highlightKeepsViolations: B('R.textPreferences', 'highlightKeeps', 'Highlight Keep Violations'),
            highlightHjViolations: B('R.textPreferences', 'highlightHjViolations', 'Highlight H&J Violations'),
            highlightCustomSpacing: B('R.textPreferences', 'highlightCustomSpacing', 'Highlight Custom Tracking/Kerning'),
            highlightSubstitutedFonts: B('R.textPreferences', 'highlightSubstitutedFonts', 'Highlight Substituted Fonts'),
            highlightSubstitutedGlyphs: B('R.textPreferences', 'highlightSubstitutedGlyphs', 'Highlight Substituted Glyphs'),
            justifyTextNextToObject: B('R.textPreferences', 'justifyTextWraps', 'Text Wrap: Justify Text Next to an Object'),
            skipByLeading: B('R.textPreferences', 'abutTextToTextWrap', 'Text Wrap: Skip by Leading'),
            wrapOnlyAffectsTextBeneath: B('R.textPreferences', 'zOrderTextWrap', 'Text Wrap Only Affects Text Beneath'),
            honorTextIndentsWithTextWrap: B('R.textPreferences', 'honourTextIndentsWithTextWrap', 'Honor Text Indents with Text Wrap'),
        },
    },
    units: {
        title: 'Units & Increments',
        props: {
            rulerOrigin: E('R.viewPreferences', 'rulerOrigin', 'RulerOrigin', ['SPREAD_ORIGIN', 'PAGE_ORIGIN', 'SPINE_ORIGIN'], 'Ruler Units: Origin'),
            horizontalUnits: E('R.viewPreferences', 'horizontalMeasurementUnits', 'MeasurementUnits', UNITS, 'Horizontal ruler units'),
            horizontalCustomPoints: N('R.viewPreferences', 'horizontalCustomPoints', 4, 256, 'Points between major ticks when horizontal units are CUSTOM'),
            verticalUnits: E('R.viewPreferences', 'verticalMeasurementUnits', 'MeasurementUnits', UNITS, 'Vertical ruler units'),
            verticalCustomPoints: N('R.viewPreferences', 'verticalCustomPoints', 4, 256, 'Points between major ticks when vertical units are CUSTOM'),
            typeUnits: E('R.viewPreferences', 'typographicMeasurementUnits', 'MeasurementUnits', UNITS, 'Other Units: Type'),
            textSizeUnits: E('R.viewPreferences', 'textSizeMeasurementUnits', 'MeasurementUnits', UNITS, 'Other Units: Text Size'),
            strokeUnits: E('R.viewPreferences', 'strokeMeasurementUnits', 'MeasurementUnits', UNITS, 'Other Units: Stroke'),
            pointsPerInch: N('R.viewPreferences', 'pointsPerInch', 60, 80, 'Point/Pica Size: points per inch (72 PostScript, 72.27 traditional)'),
            cursorKey: { kind: 'mm', obj: 'R.viewPreferences', prop: 'cursorKeyIncrement', min: 0, max: 35.278, desc: 'Keyboard Increments: Cursor Key, in millimetres' },
            sizeLeading: PT('R.textPreferences', 'leadingKeyIncrement', 0.001, 100, 'Keyboard Increments: Size/Leading, in points'),
            baselineShift: PT('R.textPreferences', 'baselineShiftKeyIncrement', 0.001, 100, 'Keyboard Increments: Baseline Shift, in points'),
            kerningTracking: I('R.textPreferences', 'kerningKeyIncrement', 1, 100, 'Keyboard Increments: Kerning/Tracking, in 1/1000 em'),
        },
    },
    displayPerformance: {
        title: 'Display Performance',
        props: {
            defaultView: E('app.displayPerformancePreferences', 'defaultDisplaySettings', 'ViewDisplaySettings', ['TYPICAL', 'OPTIMIZED', 'HIGH_QUALITY'], 'Default View (OPTIMIZED is Fast)'),
            preserveObjectLevelSettings: B('app.displayPerformancePreferences', 'persistLocalSettings', 'Preserve Object-Level Display Settings'),
            fast: DISPLAY_LEVEL(0, 'Fast'),
            typical: DISPLAY_LEVEL(1, 'Typical'),
            highQuality: DISPLAY_LEVEL(2, 'High Quality'),
        },
    },
    gpuPerformance: {
        title: 'GPU Performance',
        props: {
            gpuPerformance: B('app.gpuPerformancePreferences', 'enableGpuPerformance', 'GPU Performance'),
            animatedZoom: B('app.gpuPerformancePreferences', 'enableAnimatedZoom', 'Animated Zoom'),
        },
    },
    fileHandling: {
        title: 'File Handling',
        props: {
            savePreviewImages: B(G, 'includePreview', 'Always Save Preview Images with Documents'),
            previewPages: E(G, 'previewPages', 'PreviewPagesOptions', ['FIRST_PAGE', 'FIRST_2_PAGES', 'FIRST_5_PAGES', 'FIRST_10_PAGES', 'ALL_PAGES'], 'Preview pages'),
            previewSize: E(G, 'previewSize', 'PreviewSizeOptions', ['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE'], 'Preview size'),
            recentItems: I(G, 'openRecentLength', 0, 30, 'Number of Recent Items to Display'),
            checkLinksBeforeOpening: B('app.linkingPreferences', 'checkLinksAtOpen', 'Check Links Before Opening Document'),
            findMissingLinksBeforeOpening: B('app.linkingPreferences', 'findMissingLinksAtOpen', 'Find Missing Links Before Opening Document'),
            linkTextAndSpreadsheetFiles: B('R.textPreferences', 'linkTextFilesWhenImporting', 'Create Links When Placing Text and Spreadsheet Files'),
            preserveImageDimensionsWhenRelinking: B('app.imagePreferences', 'preserveBounds', 'Preserve Image Dimensions When Relinking'),
            createLinksWithContentPlacer: B(G, 'createLinksOnContentPlace', 'Create Links When Using Content Placer'),
            mapStylesWithContentPlacer: B(G, 'mapStylesOnContentPlace', 'Map Styles When Using Content Placer'),
            snippetImportPosition: M('R.documentPreferences', 'snippetImportUsesOriginalLocation', { original_location: 'true', cursor_location: 'false' }, 'Snippet Import: Position At'),
        },
    },
    clipboard: {
        title: 'Clipboard Handling',
        props: {
            preferPdfWhenPasting: B('app.clipboardPreferences', 'preferPDFWhenPasting', 'Prefer PDF When Pasting'),
            copyPdfToClipboard: B('app.clipboardPreferences', 'copyPDFToClipboard', 'Copy PDF to Clipboard'),
            preservePdfAtQuit: B('app.clipboardPreferences', 'preservePdfClipboardAtQuit', 'Preserve PDF Data at Quit'),
            pasteTextAndTables: M('app.clipboardPreferences', 'preferStyledTextWhenPasting', { all_information: 'true', text_only: 'false' }, 'When pasting text and tables from other applications: All Information or Text Only'),
        },
    },
    guidesPasteboard: {
        title: 'Guides & Pasteboard',
        props: {
            bleedGuideColor: C('R.pasteboardPreferences', 'bleedGuideColor', 'Bleed guide colour'),
            slugGuideColor: C('R.pasteboardPreferences', 'slugGuideColor', 'Slug guide colour'),
            previewBackgroundColor: C('R.pasteboardPreferences', 'previewBackgroundColor', 'Preview background colour'),
            matchPreviewBackgroundToTheme: B('R.pasteboardPreferences', 'matchPreviewBackgroundToThemeColor', 'Match Preview Background to Theme Color'),
            pasteboardMargins: { kind: 'pair', obj: 'R.pasteboardPreferences', prop: 'pasteboardMargins', desc: 'Pasteboard Options: horizontal and vertical margins' },
            snapToZone: I('R.viewPreferences', 'guideSnaptoZone', 1, 36, 'Snap to Zone, in pixels'),
        },
    },
    spelling: {
        title: 'Spelling',
        props: {
            misspelledWords: B('app.spellPreferences', 'checkMisspelledWords', 'Find Misspelled Words'),
            repeatedWords: B('app.spellPreferences', 'checkRepeatedWords', 'Find Repeated Words'),
            uncapitalizedWords: B('app.spellPreferences', 'checkCapitalizedWords', 'Find Uncapitalized Words'),
            uncapitalizedSentences: B('app.spellPreferences', 'checkCapitalizedSentences', 'Find Uncapitalized Sentences'),
            dynamicSpelling: B('app.spellPreferences', 'dynamicSpellCheck', 'Enable Dynamic Spelling'),
            misspelledWordColor: C('app.spellPreferences', 'misspelledWordColor', 'Underline colour for misspelled words'),
            repeatedWordColor: C('app.spellPreferences', 'repeatedWordColor', 'Underline colour for repeated words'),
            uncapitalizedWordColor: C('app.spellPreferences', 'uncapitalizedWordColor', 'Underline colour for uncapitalized words'),
            uncapitalizedSentenceColor: C('app.spellPreferences', 'uncapitalizedSentenceColor', 'Underline colour for uncapitalized sentences'),
        },
    },
    autocorrect: {
        title: 'Autocorrect',
        props: {
            enabled: B('app.autoCorrectPreferences', 'autoCorrect', 'Enable Autocorrect'),
            capitalizationErrors: B('app.autoCorrectPreferences', 'autoCorrectCapitalizationErrors', 'Autocorrect Capitalization Errors'),
        },
    },
    dictionary: {
        title: 'Dictionary',
        props: {
            composeUsing: E('R.dictionaryPreferences', 'composition', 'ComposeUsing', ['BOTH', 'USE_USER_DICTIONARY', 'USE_DOCUMENT'], 'Hyphenation Exceptions: Compose Using'),
            mergeUserDictionary: B('R.dictionaryPreferences', 'mergeUserDictionary', 'Merge User Dictionary into Document'),
            recomposeWhenChanged: B('R.dictionaryPreferences', 'recomposeWhenChanged', 'Recompose All Stories When Modified'),
        },
    },
    japaneseLayout: {
        title: 'Japanese layout: Grids (layout and frame grids) and Mojikumi Display',
        props: {
            showLayoutGrids: B('R.cjkGridPreferences', 'showAllLayoutGrids', 'Show layout grids'),
            snapToLayoutGrid: B('R.cjkGridPreferences', 'snapToLayoutGrid', 'Snap to layout grid'),
            showFrameGrids: B('R.cjkGridPreferences', 'showAllFrameGrids', 'Show frame grids'),
            showCharacterCount: B('R.cjkGridPreferences', 'showCharacterCount', 'Show the character count of frame grids'),
            circularCells: B('R.cjkGridPreferences', 'useCircularCells', 'Grid cell shape: circular (false: rectangular)'),
            icfMode: B('R.cjkGridPreferences', 'icfMode', 'Grid cells use the ICF box (false: the em box)'),
            colorEveryNthCell: I('R.cjkGridPreferences', 'colorEveryNthCell', 1, 100, 'Colour every nth grid cell'),
            singleLineColorMode: B('R.cjkGridPreferences', 'singleLineColorMode', 'Apply the grid colour from the edge of the line'),
            layoutGridColor: C('R.cjkGridPreferences', 'layoutGridColorIndex', 'Layout grid colour'),
            viewThreshold: N('R.cjkGridPreferences', 'minimumScale', 5, 4000, 'View threshold (%): grids are hidden below this zoom'),
            mojikumiSets: {
                kind: 'group',
                desc: 'Mojikumi Display: which predefined mojikumi sets the menus show',
                props: Object.fromEntries(MOJIKUMI_SETS.map((k) => [k, B('R.mojikumiUIPreferences', k, `Show the ${k} mojikumi set`)])),
            },
        },
    },
    generativeAi: {
        title: 'Generative AI',
        props: {
            autoGenerateAltText: since('2026 (21.5)', B(G, 'autoGenerateAltText', 'Generate alt text for images when placing them')),
            markAltTextAsGenerated: since('2026 (21.5)', B(G, 'addAITagToAltText', 'Tag generated alt text as AI-generated')),
        },
    },
};

const PANE_NAMES = Object.keys(PANES);

const colorSchema = (desc) => ({ type: 'string', description: `${desc}: a UI colour name such as "GRID_BLUE" or "light_blue", or "#RRGGBB"` });

/** JSON schema for one option. */
function optionSchema(s) {
    const d = s.since ? `${s.desc} (InDesign ${s.since} or later)` : s.desc;
    switch (s.kind) {
        case 'bool':
        case 'bool01':
            return { type: 'boolean', description: d };
        case 'enum':
            return { type: 'string', enum: s.values, description: d };
        case 'map':
            return { type: 'string', enum: Object.keys(s.map), description: d };
        case 'int':
            return { type: 'integer', minimum: s.min, maximum: s.max, description: d };
        case 'num':
        case 'pt':
        case 'mm':
            return { type: 'number', minimum: s.min, maximum: s.max, description: d };
        case 'color':
            return colorSchema(d);
        case 'folder':
            return { type: 'string', description: d };
        case 'pair':
            return {
                type: 'object',
                description: d,
                properties: {
                    horizontal: { type: 'number', minimum: -1, maximum: 5000, description: 'Horizontal margin in millimetres (-1: one page width)' },
                    vertical: { type: 'number', minimum: 0, maximum: 5000, description: 'Vertical margin in millimetres' },
                },
            };
        case 'group':
            return groupSchema(s.props, d);
        default:
            throw new Error(`unknown option kind ${s.kind}`);
    }
}

function groupSchema(table, description) {
    return { type: 'object', description, properties: Object.fromEntries(Object.entries(table).map(([k, s]) => [k, optionSchema(s)])) };
}

/** Refuse keys a table does not know. */
function checkKeys(value, table, where) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${where}' must be an object`);
    for (const k of Object.keys(value)) {
        if (!(k in table)) throw new Error(`Unknown option '${where}.${k}'. Allowed: ${Object.keys(table).join(', ')}`);
    }
}

/** A UI colour as a JSX literal: [r, g, b] or a UIColors member. */
function uiColor(value, name) {
    const v = String(value ?? '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return `[${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}]`;
    }
    return `UIColors.${enumOf(v.toUpperCase().replace(/[\s-]+/g, '_'), UI_COLORS, { name })}`;
}

/** The JSX expression of an option's property, by name for later versions. */
const target = (s) => (s.since ? `${s.obj}[${str(s.prop)}]` : `${s.obj}.${s.prop}`);

/** JSX statements that write one option's value. */
function writeLines(s, v, name) {
    if (v === undefined) return [];
    if (s.kind === 'group') {
        checkKeys(v, s.props, name);
        return Object.entries(s.props).flatMap(([k, sub]) => writeLines(sub, v[k], `${name}.${k}`));
    }
    let value;
    switch (s.kind) {
        case 'bool':
            if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
            value = bool(v);
            break;
        case 'bool01':
            if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
            value = v ? '1' : '0';
            break;
        case 'enum':
            value = `${s.enumName}.${enumOf(v, s.values, { name })}`;
            break;
        case 'map':
            value = s.map[enumOf(v, Object.keys(s.map), { name })];
            break;
        case 'int':
            if (!Number.isInteger(v)) throw new Error(`'${name}' must be a whole number`);
            value = num(v, { min: s.min, max: s.max, name });
            break;
        case 'num':
        case 'mm':
            value = num(v, { min: s.min, max: s.max, name });
            break;
        case 'pt':
            value = `"${num(v, { min: s.min, max: s.max, name })}pt"`;
            break;
        case 'color':
            value = uiColor(v, name);
            break;
        case 'folder':
            if (typeof v !== 'string' || !v.trim()) throw new Error(`'${name}' must be a folder path`);
            value = `__folder(${jsxPath(validateFilePath(v))})`;
            break;
        case 'pair': {
            checkKeys(v, { horizontal: 1, vertical: 1 }, name);
            if (v.horizontal === undefined && v.vertical === undefined) throw new Error(`'${name}' needs horizontal or vertical`);
            const h = v.horizontal === undefined ? '__pm[0]' : num(v.horizontal, { min: -1, max: 5000, name: `${name}.horizontal` });
            const w = v.vertical === undefined ? '__pm[1]' : num(v.vertical, { min: 0, max: 5000, name: `${name}.vertical` });
            return [`var __pm = ${s.obj}.${s.prop};`, `${s.obj}.${s.prop} = [${h}, ${w}];`];
        }
        default:
            throw new Error(`unknown option kind ${s.kind}`);
    }
    return [s.since ? `__setNew(${s.obj}, ${str(s.prop)}, ${value}, ${str(`InDesign ${s.since}`)});` : `${target(s)} = ${value};`];
}

/** A JSX expression reading one option back. */
function readExpr(s) {
    if (s.kind === 'group') return `{ ${Object.entries(s.props).map(([k, sub]) => `${k}: ${readExpr(sub)}`).join(', ')} }`;
    const f = `function () { return ${target(s)}; }`;
    switch (s.kind) {
        case 'enum': return `__rd(${f}, "enum")`;
        case 'color': return `__rd(${f}, "color")`;
        case 'pt': return `__rd(${f}, "pt")`;
        case 'folder': return `__rd(${f}, "path")`;
        case 'pair': return `__rd(${f}, "pair")`;
        case 'bool01': return `__rd(${f}, "bool01")`;
        case 'map': return `__unmap(__rd(${f}, "value"), ${json(Object.values(s.map))}, ${json(Object.keys(s.map))})`;
        default: return `__rd(${f}, "value")`;
    }
}

/** A pane's current values as a JSX object literal. */
const readPane = (pane) => `{ ${Object.entries(PANES[pane].props).map(([k, s]) => `${k}: ${readExpr(s)}`).join(', ')} }`;

/**
 * Helpers for the preference scripts:
 *   __rd(f, how) reads a value (null when this version lacks it), in points for "pt";
 *   __unmap(v, lits, names) names a value from a fixed choice;
 *   __setNew(o, k, v, version) writes a property added after InDesign 2023;
 *   __folder(path) is an existing Folder.
 */
const PREF_HELPERS = String.raw`
var __rd = function (f, how) {
  var v, u;
  try {
    if (how === "pt") {
      u = app.scriptPreferences.measurementUnit;
      app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
      try { v = f(); } finally { app.scriptPreferences.measurementUnit = u; }
    } else {
      v = f();
    }
  } catch (e) { return null; }
  if (v === undefined || v === null) return null;
  if (how === "enum") return __enumName(v);
  if (how === "color") return v instanceof Array ? v : __enumName(v);
  if (how === "path") return v.fsName;
  if (how === "pair") return { horizontal: v[0], vertical: v[1] };
  if (how === "bool01") return v === 1;
  return v;
};
var __unmap = function (v, lits, names) {
  if (v === null) return null;
  for (var i = 0; i < lits.length; i++) {
    if (String(v) === lits[i]) return names[i];
    if (typeof v === "number" && Math.abs(v - Number(lits[i])) < 0.005) return names[i];
  }
  return v;
};
var __setNew = function (o, k, v, version) {
  var cur;
  try { cur = o[k]; } catch (e) { cur = undefined; }
  if (cur === undefined) throw new Error(k + " needs " + version + " or later");
  o[k] = v;
};
var __folder = function (p) {
  var f = Folder(p);
  if (!f.exists) throw new Error("Folder not found: " + f.fsName);
  return f;
};
`;

const SCOPE_SCHEMA = {
    type: 'string', enum: ['application', 'document'], default: 'application',
    description: 'application: the defaults InDesign uses for new documents and for itself; document: the active document. Settings InDesign keeps only application-wide (most of General, Interface, Display Performance, GPU, File Handling, Clipboard, Spelling, Autocorrect and Generative AI) are always application-wide',
};

/** The script's root for scoped preferences. */
const root = (scope) => (scope === 'document' ? 'var R = __doc();' : 'var R = app;');

/** A sample value for every option, valid for the script audit. */
function sampleArgs(table) {
    return Object.fromEntries(Object.entries(table).map(([k, s]) => {
        switch (s.kind) {
            case 'group': return [k, sampleArgs(s.props)];
            case 'bool': case 'bool01': return [k, true];
            case 'enum': return [k, s.values[0]];
            case 'map': return [k, Object.keys(s.map)[0]];
            case 'int': case 'num': case 'pt': case 'mm': return [k, s.min];
            case 'color': return [k, '#FF8000'];
            case 'folder': return [k, `${process.env.HOME ?? '/tmp'}/Documents`];
            case 'pair': return [k, { horizontal: 50, vertical: 25 }];
            default: return [k, null];
        }
    }));
}

export const tools = [
    {
        name: 'get_indesign_preferences',
        description: 'Read the Preferences panes (Edit > Preferences, or InDesign > Settings on macOS): General, Interface, Type, Advanced Type, Composition, Units & Increments, Display Performance, GPU Performance, File Handling, Clipboard Handling, Guides & Pasteboard, Spelling, Autocorrect, Dictionary, Japanese layout grids and mojikumi, and Generative AI; for the application or the active document',
        inputSchema: {
            type: 'object',
            properties: {
                panes: { type: 'array', items: { type: 'string', enum: PANE_NAMES }, description: 'Which panes to read (default: all)' },
                scope: SCOPE_SCHEMA,
            },
        },
        features: ['indesign.ui.preferences'],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { panes: PANE_NAMES },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'application', ['application', 'document'], { name: 'scope' });
            if (a.panes !== undefined && (!Array.isArray(a.panes) || !a.panes.length)) throw new Error("'panes' must be a non-empty list of pane names");
            const panes = (a.panes ?? PANE_NAMES).map((p) => enumOf(p, PANE_NAMES, { name: 'panes' }));
            return run('Get preferences', script(`${PREF_HELPERS}
${root(scope)}
var out = { scope: ${str(scope)} };
${scope === 'document' ? 'out.document = R.name;' : ''}
${[...new Set(panes)].map((p) => `out.${p} = ${readPane(p)};`).join('\n')}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'set_indesign_preferences',
        description: 'Change Preferences (Edit > Preferences, or InDesign > Settings on macOS), pane by pane: General (page numbering, scaling, locked objects, temporary folder), Interface (theme, tool tips, panels, hand tool, live screen drawing), Type and smart text reflow, Advanced Type, Composition highlighting and text wrap, Units & Increments, Display Performance (default view and each view level), GPU Performance, File Handling (previews, recent items, links, content placer, snippets), Clipboard Handling, Guides & Pasteboard (bleed, slug and preview colours, pasteboard size, snap zone), Spelling, Autocorrect, Dictionary, Japanese layout grids and mojikumi sets, and Generative AI. Returns the panes it changed. Notes, Track Changes, Story Editor and typing options are in set_editorial_preferences; document and baseline grids in set_document_grid_settings',
        inputSchema: {
            type: 'object',
            properties: {
                scope: SCOPE_SCHEMA,
                ...Object.fromEntries(Object.entries(PANES).map(([p, { title, props }]) => [p, groupSchema(props, `${title} preferences`)])),
            },
        },
        features: [
            'indesign.ui.preferences',
            'indesign.ui.pref_pane_general', 'indesign.ui.pref_general_show_home_screen_when_no_documents_are_open',
            'indesign.ui.pref_general_use_legacy_new_document_dialog', 'indesign.ui.pref_general_show_what_s_new_on_startup',
            'indesign.ui.pref_general_page_numbering_view', 'indesign.ui.pref_general_font_downloading_and_embedding',
            'indesign.ui.pref_general_when_scaling_apply_to_content_adjust_scaling_percentage',
            'indesign.ui.pref_general_include_stroke_weight_include_effects_scaling',
            'indesign.ui.pref_general_prevent_selection_of_locked_objects_pref', 'indesign.ui.pref_general_content_aware_fit_by_default',
            'indesign.ui.pref_general_temporary_folder',
            'indesign.ui.pref_pane_interface', 'indesign.ui.pref_interface_color_theme', 'indesign.ui.pref_interface_match_pasteboard_to_theme_color',
            'indesign.ui.pref_interface_highlight_object_under_selection_tool', 'indesign.ui.pref_interface_tool_tips',
            'indesign.ui.pref_interface_show_thumbnails_on_place', 'indesign.ui.pref_interface_show_transformation_values',
            'indesign.ui.pref_interface_enable_multi_touch_gestures', 'indesign.ui.pref_interface_floating_tools_panel',
            'indesign.ui.pref_interface_auto_collapse_icon_panels', 'indesign.ui.pref_interface_auto_show_hidden_panels',
            'indesign.ui.pref_interface_open_documents_as_tabs', 'indesign.ui.pref_interface_enable_floating_document_window_docking',
            'indesign.ui.pref_interface_large_tabs', 'indesign.ui.pref_interface_hand_tool_panning', 'indesign.ui.pref_interface_live_screen_drawing',
            'indesign.ui.pref_interface_greek_vector_graphics_on_drag',
            'indesign.ui.pref_pane_type', 'indesign.ui.pref_type_link_text_files_when_importing',
            'indesign.ui.pref_pane_advanced_type', 'indesign.ui.pref_adv_type_use_inline_input_for_non_latin_text',
            'indesign.ui.pref_pane_composition', 'indesign.ui.pref_composition_honor_text_indents_with_text_wrap',
            'indesign.ui.pref_pane_units', 'indesign.ui.pref_units_origin_ruler', 'indesign.ui.pref_units_horizontal_units',
            'indesign.ui.pref_units_vertical_units', 'indesign.ui.pref_units_type_units', 'indesign.ui.pref_units_text_size_units',
            'indesign.ui.pref_units_stroke_units', 'indesign.ui.pref_units_points_inch', 'indesign.ui.pref_units_cursor_key',
            'indesign.ui.pref_units_size_leading_increment', 'indesign.ui.pref_units_baseline_shift_increment',
            'indesign.ui.pref_units_kerning_tracking_increment',
            'indesign.ui.pref_pane_display_performance', 'indesign.ui.pref_display_default_view',
            'indesign.ui.pref_display_preserve_object_level_display_settings', 'indesign.ui.pref_display_raster_images_quality',
            'indesign.ui.pref_display_vector_graphics_quality', 'indesign.ui.pref_display_enable_anti_aliasing',
            'indesign.ui.pref_display_greek_type_below', 'indesign.ui.pref_display_scrolling_hand_tool_quality',
            'indesign.ui.pref_pane_gpu', 'indesign.ui.pref_gpu_gpu_performance', 'indesign.ui.pref_gpu_animated_zoom_pref',
            'indesign.ui.pref_pane_file_handling', 'indesign.ui.pref_file_always_save_preview_images_with_documents',
            'indesign.ui.pref_file_number_of_recent_items_to_display', 'indesign.ui.pref_file_check_links_before_opening_document',
            'indesign.ui.pref_file_find_missing_links_before_opening_document',
            'indesign.ui.pref_file_create_links_when_placing_text_and_spreadsheet_files',
            'indesign.ui.pref_file_preserve_image_dimensions_when_relinking', 'indesign.ui.pref_file_create_links_when_using_content_placer',
            'indesign.ui.pref_file_map_styles_when_using_content_placer', 'indesign.ui.pref_file_snippet_import_position',
            'indesign.ui.pref_clipboard', 'indesign.ui.pref_guides_pasteboard',
            'indesign.ui.pref_spelling', 'indesign.ui.pref_pane_spelling_grammar', 'indesign.ui.pref_autocorrect', 'indesign.ui.pref_dictionary',
            'indesign.ui.pref_japanese_layout', 'indesign.ui.pref_pane_generative_ai',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            scope: 'document',
            ...Object.fromEntries(Object.entries(PANES).map(([p, { props }]) => [p, sampleArgs(props)])),
            units: { ...sampleArgs(PANES.units.props), horizontalUnits: 'CUSTOM', verticalUnits: 'CUSTOM' },
        },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'application', ['application', 'document'], { name: 'scope' });
            for (const k of Object.keys(a)) {
                if (k !== 'scope' && !(k in PANES)) throw new Error(`Unknown pane '${k}'. Allowed: scope, ${PANE_NAMES.join(', ')}`);
            }
            for (const side of ['horizontal', 'vertical']) {
                const u = a.units?.[`${side}Units`];
                if (a.units?.[`${side}CustomPoints`] !== undefined && u !== undefined && u !== 'CUSTOM') {
                    throw new Error(`'units.${side}CustomPoints' applies when units.${side}Units is CUSTOM`);
                }
            }
            const lines = [];
            const changed = [];
            for (const [p, { props }] of Object.entries(PANES)) {
                if (a[p] === undefined) continue;
                const set = writeLines({ kind: 'group', props }, a[p], p);
                if (!set.length) throw new Error(`'${p}' has no options to change`);
                lines.push(...set);
                changed.push(p);
            }
            if (!changed.length) throw new Error(`Nothing to change: pass one or more panes: ${PANE_NAMES.join(', ')}`);
            return run('Set preferences', script(`${PREF_HELPERS}
${root(scope)}
${lines.join('\n')}
var out = { scope: ${str(scope)}, changed: ${json(changed)} };
${scope === 'document' ? 'out.document = R.name;' : ''}
${changed.map((p) => `out.${p} = ${readPane(p)};`).join('\n')}
__result__ = out;`, { needsDocument: false }));
        },
    },
];
