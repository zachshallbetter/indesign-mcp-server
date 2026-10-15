/**
 * Option tables for the import and export tools (src/tools/formats.js).
 *
 * Each table maps an InDesign preference property (the object-model name, used
 * as the caller's option key) to how its value is checked and written into a
 * script. groupSchema() turns a table into a JSON schema for tools/list, and
 * assign() turns a caller's option object into ES3 assignments, refusing
 * unknown keys and bad values before anything runs.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';

/** A true/false option. */
export const B = (desc) => ({ kind: 'bool', desc });
/** A number in [min, max]. */
export const N = (desc, min, max) => ({ kind: 'num', desc, min, max });
/** Text, at most `max` characters. */
export const S = (desc, max = 2000) => ({ kind: 'str', desc, max });
/** A member of the InDesign enumeration `cls`. */
export const E = (cls, values, desc) => ({ kind: 'enum', cls, values, desc });
/** A list of style sheet or script references: http(s) URLs or files the path policy allows. */
export const L = (desc) => ({ kind: 'list', desc });
/** A file the path policy allows, written as a path string. */
export const F = (desc) => ({ kind: 'file', desc });
/** A transparency flattener preset, by name. */
export const FLATTENER = (desc) => ({ kind: 'flattener', desc });
/** A colour profile: one of PDFProfileSelector's members, or a profile name. */
export const PROFILE = (desc) => ({ kind: 'profile', desc });
/** An XMP property as [namespace prefix, property path]. */
export const XMP = (desc) => ({ kind: 'xmp', desc });
/**
 * A property added after InDesign 2023: written by name through __setNew(),
 * which reports the version needed instead of failing obscurely.
 */
export const since = (version, spec) => ({ ...spec, since: version });

const PROFILE_SELECTORS = ['USE_DOCUMENT', 'USE_MONITOR_PROFILE', 'USE_NO_PROFILE', 'WORKING'];

/** JSON schema for one option table. */
export function groupSchema(table, description) {
    const properties = {};
    for (const [key, s] of Object.entries(table)) {
        const d = s.since ? `${s.desc} (InDesign ${s.since} or later)` : s.desc;
        if (s.kind === 'bool') properties[key] = { type: 'boolean', description: d };
        else if (s.kind === 'num') properties[key] = { type: 'number', minimum: s.min, maximum: s.max, description: d };
        else if (s.kind === 'enum') properties[key] = { type: 'string', enum: s.values, description: d };
        else if (s.kind === 'list') properties[key] = { type: 'array', items: { type: 'string' }, description: d };
        else if (s.kind === 'xmp') properties[key] = { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2, description: d };
        else if (s.kind === 'profile') properties[key] = { type: 'string', description: `${d}. ${PROFILE_SELECTORS.join(', ')}, or a colour profile name` };
        else properties[key] = { type: 'string', description: d };
    }
    return { type: 'object', description, properties, additionalProperties: false };
}

/** A style sheet or script reference: an http(s) URL, or a file the path policy allows. */
function reference(v, name) {
    const s = String(v ?? '').trim();
    if (!s) throw new Error(`'${name}' has an empty entry`);
    if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
    return validateFilePath(s).replace(/\\/g, '/');
}

/** The JSX expression for one option value, after checking it. */
function valueOf(s, v, name) {
    switch (s.kind) {
        case 'bool':
            if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
            return bool(v);
        case 'num':
            return num(v, { min: s.min, max: s.max, name });
        case 'str': {
            if (typeof v !== 'string') throw new Error(`'${name}' must be text`);
            if (v.length > s.max) throw new Error(`'${name}' is longer than ${s.max} characters`);
            return str(v);
        }
        case 'enum': {
            const e = enumOf(v, s.values, { name });
            return s.since ? `__enumValue(${str(s.cls)}, ${str(e)})` : `${s.cls}.${e}`;
        }
        case 'list':
            if (!Array.isArray(v)) throw new Error(`'${name}' must be a list`);
            if (v.length > 50) throw new Error(`'${name}' has more than 50 entries`);
            return json(v.map((x) => reference(x, name)));
        case 'file':
            if (typeof v !== 'string' || !v.trim()) throw new Error(`'${name}' must be a file path`);
            return jsxPath(validateFilePath(v));
        case 'flattener':
            if (typeof v !== 'string' || !v.trim() || v.length > 200) throw new Error(`'${name}' must be a flattener preset name`);
            return `__flattener(${str(v)})`;
        case 'profile':
            if (typeof v !== 'string' || !v.trim() || v.length > 300) throw new Error(`'${name}' must be a profile selector or name`);
            return PROFILE_SELECTORS.includes(v) ? `PDFProfileSelector.${v}` : str(v);
        case 'xmp':
            if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'string' || !x || x.length > 300)) {
                throw new Error(`'${name}' must be [namespace prefix, property path]`);
            }
            return json(v);
        default:
            throw new Error(`Unknown option kind ${s.kind}`);
    }
}

/**
 * ES3 statements assigning a caller's options to the object `target` (a JSX
 * expression). Statements follow the table's order, so options that reset
 * others (a PDF/X standard, for one) can be listed first. Unknown keys and bad
 * values throw.
 * @param {string} target
 * @param {object} table
 * @param {object|undefined} values
 * @param {string} group the parameter name, for messages
 */
export function assign(target, table, values, group) {
    if (values === undefined || values === null) return '';
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error(`'${group}' must be an object of options`);
    const unknown = Object.keys(values).filter((k) => !(k in table));
    if (unknown.length) throw new Error(`Unknown option${unknown.length > 1 ? 's' : ''} in '${group}': ${unknown.join(', ')}. Allowed: ${Object.keys(table).join(', ')}`);
    const lines = [];
    for (const [key, s] of Object.entries(table)) {
        if (!(key in values) || values[key] === undefined) continue;
        const v = valueOf(s, values[key], `${group}.${key}`);
        lines.push(s.since
            ? `__setNew(${target}, ${str(key)}, ${v}, ${str(`InDesign ${s.since}`)});`
            : `${target}.${key} = ${v};`);
    }
    return lines.join('\n');
}

/** A table without the given keys. */
export function without(table, keys) {
    return Object.fromEntries(Object.entries(table).filter(([k]) => !keys.includes(k)));
}

/**
 * Script helpers for the format tools:
 *   __keepPrefs(o) snapshots a preferences object; __restorePrefs() puts every
 *   snapshot back (twice, since some properties reset others);
 *   __setNew(o, k, v, version) sets a property added after InDesign 2023;
 *   __enumValue(cls, name) reads such a version's enumeration by name;
 *   __flattener(name) finds a transparency flattener preset;
 *   __outFile(path) is a File whose folder exists.
 */
export const FORMAT_HELPERS = String.raw`
var __saved = [];
function __keepPrefs(o) { __saved.push([o, o.properties]); }
function __restorePrefs() {
  for (var pass = 0; pass < 2; pass++) {
    for (var i = __saved.length - 1; i >= 0; i--) {
      var o = __saved[i][0], p = __saved[i][1];
      for (var k in p) {
        if (k === "parent" || k === "isValid" || k === "properties" || k === "events" || k === "eventListeners") continue;
        try { o[k] = p[k]; } catch (e) {}
      }
    }
  }
}
function __setNew(o, k, v, version) {
  var cur;
  try { cur = o[k]; } catch (e) { cur = undefined; }
  if (cur === undefined) throw new Error(k + " needs " + version + " or later");
  o[k] = v;
}
function __enumValue(cls, name) {
  var e = $.global[cls];
  if (!e || e[name] === undefined) throw new Error(cls + "." + name + " is not available in this version of InDesign");
  return e[name];
}
function __flattener(name) {
  var f = app.flattenerPresets.itemByName(name);
  if (!f.isValid) throw new Error("No transparency flattener preset named " + name);
  return f;
}
function __outFile(path) {
  var f = File(path);
  if (!f.parent.exists && !f.parent.create()) throw new Error("Cannot create folder " + f.parent.fsName);
  return f;
}
`;

// ---------------------------------------------------------------------------
// Shared enumeration values (InDesign 2023 object model)

const MAGNIFICATION = ['DEFAULT_VALUE', 'ACTUAL_SIZE', 'FIT_PAGE', 'FIT_WIDTH', 'FIT_HEIGHT', 'FIT_VISIBLE', 'TWENTY_FIVE_PERCENT', 'FIFTY_PERCENT', 'SEVENTY_FIVE_PERCENT', 'ONE_HUNDRED_PERCENT'];
const PAGE_LAYOUT = ['DEFAULT_VALUE', 'SINGLE_PAGE', 'SINGLE_PAGE_CONTINUOUS', 'TWO_UP_FACING', 'TWO_UP_FACING_CONTINUOUS', 'TWO_UP_COVER_PAGE', 'TWO_UP_COVER_PAGE_CONTINUOUS'];
const DISPLAY_TITLE = ['DISPLAY_DOCUMENT_TITLE', 'DISPLAY_FILE_NAME'];
const SAMPLING = ['NONE', 'DOWNSAMPLE', 'SUBSAMPLE', 'BICUBIC_DOWNSAMPLE'];
const BITMAP_COMPRESSION = ['NONE', 'AUTO_COMPRESSION', 'JPEG', 'ZIP', 'JPEG_2000', 'AUTOMATIC_JPEG_2000'];
const COMPRESSION_QUALITY = ['MINIMUM', 'LOW', 'MEDIUM', 'HIGH', 'MAXIMUM', 'FOUR_BIT', 'EIGHT_BIT'];
const IMAGE_RESOLUTION = ['PPI_72', 'PPI_96', 'PPI_150', 'PPI_300'];
const IMAGE_CONVERSION = ['AUTOMATIC', 'JPEG', 'GIF', 'PNG'];
const JPEG_QUALITY = ['LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'];
const JPEG_FORMAT = ['BASELINE_ENCODING', 'PROGRESSIVE_ENCODING'];
const GIF_PALETTE = ['ADAPTIVE_PALETTE', 'WEB_PALETTE', 'MACINTOSH_PALETTE', 'WINDOWS_PALETTE'];
const IMAGE_ALIGNMENT = ['ALIGN_LEFT', 'ALIGN_CENTER', 'ALIGN_RIGHT'];
const PAGE_BREAK = ['PAGE_BREAK_BEFORE', 'PAGE_BREAK_AFTER', 'PAGE_BREAK_BEFORE_AND_AFTER'];
const EXPORT_ORDER = ['LAYOUT_ORDER', 'XML_STRUCTURE_ORDER', 'ARTICLE_PANEL_ORDER'];
const COVER = ['NONE', 'FIRST_PAGE', 'EXTERNAL_IMAGE'];
const SOURCE_TYPE = ['SOURCE_CUSTOM', 'SOURCE_XML_STRUCTURE', 'SOURCE_XMP_TITLE', 'SOURCE_XMP_DESCRIPTION', 'SOURCE_XMP_HEADLINE', 'SOURCE_XMP_ALT_TEXT', 'SOURCE_XMP_EXTENDED_DESCRIPTION', 'SOURCE_XMP_OTHER'];
const PLATFORM = ['MACINTOSH', 'PC'];

// ---------------------------------------------------------------------------
// Export Adobe PDF (File > Export > Adobe PDF (Print)): app.pdfExportPreferences

export const PDF_GENERAL = {
    standardsCompliance: E('PDFXStandards', ['NONE', 'PDFX1A2001_STANDARD', 'PDFX1A2003_STANDARD', 'PDFX32002_STANDARD', 'PDFX32003_STANDARD', 'PDFX42010_STANDARD'], 'Standard (PDF/X); set before the options it constrains'),
    acrobatCompatibility: E('AcrobatCompatibility', ['ACROBAT_4', 'ACROBAT_5', 'ACROBAT_6', 'ACROBAT_7', 'ACROBAT_8'], 'Compatibility (Acrobat 4 / PDF 1.3 up to Acrobat 8 / PDF 1.7)'),
    exportReaderSpreads: B('Export spreads instead of single pages (Pages / Spreads)'),
    exportAsSinglePages: B('Create Separate PDF Files, one per page or spread'),
    singlePagesPDFSuffix: S('File name suffix for separate PDF files', 200),
    pdfMagnification: E('PdfMagnificationOptions', MAGNIFICATION, 'View: the opening magnification'),
    pdfPageLayout: E('PageLayoutOptions', PAGE_LAYOUT, 'Layout: how Acrobat arranges pages'),
    openInFullScreen: B('Open in Full Screen Mode'),
    viewPDF: B('View PDF after Exporting'),
    generateThumbnails: B('Embed Page Thumbnails'),
    optimizePDF: B('Optimize for Fast Web View'),
    includeStructure: B('Create Tagged PDF'),
    exportLayers: B('Create Acrobat Layers'),
    exportWhichLayers: E('ExportLayerOptions', ['EXPORT_ALL_LAYERS', 'EXPORT_VISIBLE_LAYERS', 'EXPORT_VISIBLE_PRINTABLE_LAYERS'], 'Export Layers'),
    includeBookmarks: B('Include Bookmarks'),
    includeHyperlinks: B('Include Hyperlinks'),
    exportGuidesAndGrids: B('Include Visible Guides and Baseline Grids'),
    exportNonprintingObjects: B('Include Non-Printing Objects'),
    interactiveElementsOption: E('InteractiveElementsOptions', ['DO_NOT_INCLUDE', 'APPEARANCE_ONLY'], 'Interactive Elements'),
};

export const PDF_COMPRESSION = {
    colorBitmapSampling: E('Sampling', SAMPLING, 'Color Images: downsampling method'),
    colorBitmapSamplingDPI: N('Color Images: downsample to this resolution (ppi)', 1, 9600),
    thresholdToCompressColor: N('Color Images: for images above this resolution (ppi)', 1, 9600),
    colorBitmapCompression: E('BitmapCompression', BITMAP_COMPRESSION, 'Color Images: compression'),
    colorBitmapQuality: E('CompressionQuality', COMPRESSION_QUALITY, 'Color Images: image quality'),
    colorTileSize: N('Color Images: JPEG 2000 tile size (pixels)', 32, 4096),
    grayscaleBitmapSampling: E('Sampling', SAMPLING, 'Grayscale Images: downsampling method'),
    grayscaleBitmapSamplingDPI: N('Grayscale Images: downsample to this resolution (ppi)', 1, 9600),
    thresholdToCompressGray: N('Grayscale Images: for images above this resolution (ppi)', 1, 9600),
    grayscaleBitmapCompression: E('BitmapCompression', BITMAP_COMPRESSION, 'Grayscale Images: compression'),
    grayscaleBitmapQuality: E('CompressionQuality', COMPRESSION_QUALITY, 'Grayscale Images: image quality'),
    grayTileSize: N('Grayscale Images: JPEG 2000 tile size (pixels)', 32, 4096),
    monochromeBitmapSampling: E('Sampling', SAMPLING, 'Monochrome Images: downsampling method'),
    monochromeBitmapSamplingDPI: N('Monochrome Images: downsample to this resolution (ppi)', 1, 9600),
    thresholdToCompressMonochrome: N('Monochrome Images: for images above this resolution (ppi)', 1, 9600),
    monochromeBitmapCompression: E('MonoBitmapCompression', ['NONE', 'CCIT3', 'CCIT4', 'ZIP', 'RUN_LENGTH'], 'Monochrome Images: compression'),
    compressTextAndLineArt: B('Compress Text and Line Art'),
    cropImagesToFrames: B('Crop Image Data to Frames'),
    compressionType: E('PDFCompressionType', ['COMPRESS_NONE', 'COMPRESS_OBJECTS', 'COMPRESS_STRUCTURE'], 'Object Level Compression'),
};

export const PDF_MARKS = {
    cropMarks: B('Crop Marks'),
    bleedMarks: B('Bleed Marks'),
    registrationMarks: B('Registration Marks'),
    colorBars: B('Color Bars'),
    pageInformationMarks: B('Page Information'),
    pdfMarkType: E('MarkTypes', ['DEFAULT_VALUE', 'J_MARK_WITH_CIRCLE', 'J_MARK_WITHOUT_CIRCLE'], 'Type of printer\'s marks'),
    printerMarkWeight: E('PDFMarkWeight', ['P125PT', 'P25PT', 'P50PT'], 'Weight of printer\'s marks (0.125, 0.25 or 0.5 pt)'),
    pageMarksOffset: N('Offset of the marks from the page edge (mm)', 0, 25.4),
    useDocumentBleedWithPDF: B('Use Document Bleed Settings'),
    bleedTop: N('Bleed Top (mm)', 0, 152.4),
    bleedBottom: N('Bleed Bottom (mm)', 0, 152.4),
    bleedInside: N('Bleed Inside (mm)', 0, 152.4),
    bleedOutside: N('Bleed Outside (mm)', 0, 152.4),
    includeSlugWithPDF: B('Include Slug Area'),
};

export const PDF_OUTPUT = {
    pdfColorSpace: E('PDFColorSpace', ['UNCHANGED_COLOR_SPACE', 'CMYK', 'RGB', 'GRAY', 'REPURPOSE_CMYK', 'REPURPOSE_RGB'], 'Color Conversion (REPURPOSE_ values convert to the destination preserving numbers)'),
    pdfDestinationProfile: PROFILE('Destination profile'),
    includeICCProfiles: E('ICCProfiles', ['INCLUDE_NONE', 'INCLUDE_ALL', 'INCLUDE_TAGGED', 'INCLUDE_RGB_AND_TAGGED'], 'Profile Inclusion Policy'),
    simulateOverprint: B('Simulate Overprint'),
    pdfXProfile: PROFILE('PDF/X Output Intent Profile Name'),
    outputConditionName: S('PDF/X Output Condition Name', 500),
    outputCondition: S('PDF/X Output Condition Identifier', 500),
    ocRegistry: S('PDF/X Registry Name (a URL)', 500),
};

export const PDF_ADVANCED = {
    subsetFontsBelow: N('Subset fonts when percent of characters used is less than', 0, 100),
    omitEPS: B('OPI: omit EPS images'),
    omitPDF: B('OPI: omit PDF images'),
    omitBitmaps: B('OPI: omit bitmap images'),
    appliedFlattenerPreset: FLATTENER('Transparency Flattener preset name, e.g. "[Medium Resolution]"'),
    ignoreSpreadOverrides: B('Ignore Spread Overrides (of the flattener)'),
    pdfDisplayTitle: E('PdfDisplayTitleOptions', DISPLAY_TITLE, 'Display Title: document title or file name'),
    defaultDocumentLanguage: S('Language, as InDesign names it, e.g. "English: USA"', 100),
};

export const PDF_SECURITY = {
    useSecurity: B('Turn on PDF security (needed for the options below)'),
    openDocumentPassword: S('Require a Password to Open the Document: the document open password', 200),
    changeSecurityPassword: S('Use a Password to Restrict Printing, Editing and Other Tasks: the permissions password', 200),
    disallowPrinting: B('Printing Allowed: none (with disallowHiResPrinting false, low resolution printing is allowed)'),
    disallowHiResPrinting: B('Printing Allowed: low resolution only'),
    disallowChanging: B('Changes Allowed: none'),
    disallowDocumentAssembly: B('Changes Allowed: no inserting, deleting or rotating pages'),
    disallowNotes: B('Changes Allowed: no commenting'),
    disallowFormFillIn: B('Changes Allowed: no filling in form fields'),
    disallowCopying: B('Turn off Enable Copying of Text, Images and Other Content'),
    disallowExtractionForAccessibility: B('Turn off Enable Text Access of Screen Reader Devices'),
    disallowPlaintextMetadata: B('Turn off Enable Plaintext Metadata'),
};

/** Properties of the preferences that a PDF export preset does not hold. */
export const NOT_IN_PRESET = ['viewPDF', ...Object.keys(PDF_SECURITY)];

// ---------------------------------------------------------------------------
// Export to Interactive PDF: app.interactivePDFExportPreferences

export const INTERACTIVE_PDF = {
    exportReaderSpreads: B('Export spreads instead of pages (Pages / Spreads)'),
    exportAsSinglePages: B('Create Separate PDF Files'),
    singlePagesPDFSuffix: S('File name suffix for separate PDF files', 200),
    viewPDF: B('View After Exporting'),
    generateThumbnails: B('Embed Page Thumbnails'),
    exportLayers: B('Create Acrobat Layers'),
    includeStructure: B('Create Tagged PDF'),
    usePDFStructureForTabOrder: B('Use Structure for Tab Order'),
    pdfMagnification: E('PdfMagnificationOptions', MAGNIFICATION, 'View: the opening magnification'),
    pdfPageLayout: E('PageLayoutOptions', PAGE_LAYOUT, 'Layout'),
    openInFullScreen: B('Presentation: Open in Full Screen Mode'),
    flipPages: B('Presentation: Flip Pages Every few seconds'),
    flipPagesSpeed: N('Presentation: seconds between page flips', 1, 1000),
    pageTransitionOverride: E('PageTransitionOverrideOptions', ['FROM_DOCUMENT', 'NONE', 'BLINDS_TRANSITION', 'BOX_TRANSITION', 'COMB_TRANSITION', 'COVER_TRANSITION', 'DISSOLVE_TRANSITION', 'FADE_TRANSITION', 'PAGE_TURN_TRANSITION', 'PUSH_TRANSITION', 'SPLIT_TRANSITION', 'UNCOVER_TRANSITION', 'WIPE_TRANSITION', 'ZOOM_IN_TRANSITION', 'ZOOM_OUT_TRANSITION'], 'Page Transitions'),
    interactivePDFInteractiveElementsOption: E('InteractivePDFInteractiveElementsOptions', ['INCLUDE_ALL_MEDIA', 'APPEARANCE_ONLY'], 'Forms and Media: include all, or appearance only'),
    pdfRasterCompression: E('PDFRasterCompressionOptions', ['AUTOMATIC_COMPRESSION', 'JPEG_COMPRESSION', 'LOSSLESS_COMPRESSION'], 'Image Handling: Compression'),
    pdfJPEGQuality: E('PDFJPEGQualityOptions', ['MINIMUM', 'LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'], 'Image Handling: JPEG Quality'),
    rasterResolution: N('Image Handling: Resolution (ppi)', 36, 2400),
    pdfDisplayTitle: E('PdfDisplayTitleOptions', DISPLAY_TITLE, 'Display Title'),
    defaultDocumentLanguage: S('Language, as InDesign names it, e.g. "English: USA"', 100),
};

// ---------------------------------------------------------------------------
// EPUB export: document.epubExportPreferences (reflowable) and
// document.epubFixedLayoutExportPreferences (fixed layout)

export const EPUB_GENERAL = {
    version: E('EpubVersion', ['EPUB3', 'EPUB2'], 'Version'),
    epubCover: E('EpubCover', COVER, 'Cover: none, rasterize the first page, or an image file'),
    coverImageFile: F('Cover image file, with epubCover EXTERNAL_IMAGE'),
    tocStyleName: S('Navigation TOC: the table of contents style to build it from', 300),
    exportOrder: E('ExportOrder', EXPORT_ORDER, 'Content Order'),
    breakDocument: B('Split Document at a paragraph style'),
    paragraphStyleName: S('Paragraph style to split the document at', 300),
    footnotePlacement: E('EPubFootnotePlacement', ['FOOTNOTE_AFTER_PARAGRAPH', 'FOOTNOTE_AFTER_STORY', 'FOOTNOTE_INSIDE_POPUP'], 'Footnotes'),
    stripSoftReturn: B('Remove Forced Line Breaks'),
    bulletExportOption: E('BulletListExportOption', ['UNORDERED_LIST', 'AS_TEXT'], 'Bullets: map to unordered lists, or convert to text'),
    numberedListExportOption: E('NumberedListExportOption', ['ORDERED_LIST', 'AS_TEXT'], 'Numbers: map to ordered lists, or convert to text'),
    topMargin: N('Top margin, in the unit the EPUB dialog last used (em or pixels)', 0, 10000),
    bottomMargin: N('Bottom margin, in the unit the EPUB dialog last used (em or pixels)', 0, 10000),
    leftMargin: N('Left margin, in the unit the EPUB dialog last used (em or pixels)', 0, 10000),
    rightMargin: N('Right margin, in the unit the EPUB dialog last used (em or pixels)', 0, 10000),
};

export const EPUB_IMAGES = {
    preserveLayoutAppearence: B('Preserve Appearance from Layout'),
    imageExportResolution: E('ImageResolution', IMAGE_RESOLUTION, 'Resolution (ppi)'),
    customImageSizeOption: E('ImageSizeOption', ['SIZE_FIXED', 'SIZE_RELATIVE_TO_TEXT_FLOW'], 'Image Size'),
    imageAlignment: E('ImageAlignmentType', IMAGE_ALIGNMENT, 'Image Alignment'),
    imageSpaceBefore: N('Space before images (pixels)', 0, 10000),
    imageSpaceAfter: N('Space after images (pixels)', 0, 10000),
    useImagePageBreak: B('Insert Page Break around images'),
    imagePageBreak: E('ImagePageBreakType', PAGE_BREAK, 'Where to insert the page break'),
    ignoreObjectConversionSettings: B('Ignore Object Export Settings'),
    imageConversion: E('ImageConversion', IMAGE_CONVERSION, 'Format of converted images'),
    jpegOptionsQuality: E('JPEGOptionsQuality', JPEG_QUALITY, 'JPEG Options: quality'),
    jpegOptionsFormat: E('JPEGOptionsFormat', JPEG_FORMAT, 'JPEG Options: format method'),
    gifOptionsPalette: E('GIFOptionsPalette', GIF_PALETTE, 'GIF Options: palette'),
    gifOptionsInterlaced: B('GIF Options: interlace'),
    useExistingImageOnExport: B('Use Existing Image for Graphic Objects'),
    useSVGAs: E('UseSVGAsEnum', ['EMBED_CODE', 'OBJECT_TAGS'], 'SVG Export: embed the SVG code, or use object tags'),
};

export const EPUB_CSS = {
    generateCascadeStyleSheet: B('Generate CSS'),
    includeClassesInHTML: B('Include Style Classes in HTML'),
    preserveLocalOverride: B('Preserve Local Overrides'),
    embedFont: B('Include Embeddable Fonts'),
    externalStyleSheets: L('Additional CSS: style sheet URLs or files'),
    javascripts: L('Additional JavaScript: script URLs or files'),
};

export const EPUB_METADATA = {
    id: S('Identifier (e.g. an ISBN or urn:uuid)', 500),
    epubTitle: S('Title', 1000),
    epubCreator: S('Creator', 1000),
    epubDate: S('Date (e.g. 2026-10-15)', 100),
    epubDescription: S('Description', 5000),
    epubPublisher: S('Publisher', 1000),
    epubRights: S('Rights', 2000),
    epubSubject: S('Subject', 1000),
};

export const EPUB_ACCESSIBILITY = Object.fromEntries([
    ['epubAccessibilitySummary', 'Accessibility summary'],
    ['epubAccessibilityFeature', 'Accessibility features (schema.org values, comma separated)'],
    ['epubAccessibilityHazard', 'Accessibility hazards (schema.org values)'],
    ['epubAccessibilityMode', 'Access modes (schema.org values)'],
    ['epubAccessibilityModeSufficient', 'Sufficient access modes (schema.org values)'],
    ['epubAccessibilityConformsTo', 'Conformance (e.g. EPUB Accessibility 1.1 - WCAG 2.1 Level AA)'],
    ['epubAccessibilityCertifiedBy', 'Certified by'],
    ['epubAccessibilityCredentials', 'Certifier credentials'],
    ['epubAccessibilityReportLink', 'Link to an accessibility report'],
].map(([k, d]) => [k, since('2025', S(d, 5000))]));

export const EPUB_FIXED_LAYOUT = {
    epubPageRangeFormat: E('PageRangeFormat', ['EXPORT_ALL_PAGES', 'EXPORT_PAGE_RANGE'], 'Range: all pages or epubPageRange'),
    epubPageRange: S('Range: page names, e.g. "1-4,7"', 500),
    epubCover: E('EpubCover', COVER, 'Cover'),
    coverImageFile: F('Cover image file, with epubCover EXTERNAL_IMAGE'),
    tocStyleName: S('Navigation TOC: the table of contents style', 300),
    epubNavigationStyles: E('EpubNavigationStyle', ['NO_NAVIGATION', 'FILENAME_NAVIGATION', 'BOOKMARKS_NAVIGATION', 'TOC_STYLE_NAVIGATION'], 'Navigation TOC source'),
    epubSpreadControlOptions: E('EpubFixedLayoutSpreadControl', ['SPREADS_BASED_ON_DOC', 'SYNTHETIC_SPREADS', 'PHYSICAL_SPREADS', 'NO_SPREADS'], 'Spread Control'),
    imageConversion: E('ImageConversion', IMAGE_CONVERSION, 'Image Format'),
    imageExportResolution: E('ImageResolution', IMAGE_RESOLUTION, 'Image resolution (ppi)'),
    jpegOptionsQuality: E('JPEGOptionsQuality', JPEG_QUALITY, 'JPEG quality'),
    jpegOptionsFormat: E('JPEGOptionsFormat', JPEG_FORMAT, 'JPEG format method'),
    gifOptionsPalette: E('GIFOptionsPalette', GIF_PALETTE, 'GIF palette'),
    gifOptionsInterlaced: B('GIF interlace'),
    externalStyleSheets: L('Additional CSS: style sheet URLs or files'),
    javascripts: L('Additional JavaScript: script URLs or files'),
};

// ---------------------------------------------------------------------------
// HTML export: document.htmlExportPreferences; HTML5 fixed layout: document.htmlFXLExportPreferences

export const HTML_OPTIONS = {
    exportSelection: B('Export the selection only (otherwise the document)'),
    exportOrder: E('ExportOrder', EXPORT_ORDER, 'Content Order'),
    bulletExportOption: E('BulletListExportOption', ['UNORDERED_LIST', 'AS_TEXT'], 'Bullets'),
    numberedListExportOption: E('NumberedListExportOption', ['ORDERED_LIST', 'AS_TEXT'], 'Numbers'),
    viewDocumentAfterExport: B('View HTML Using the default browser after export'),
    imageExportOption: E('ImageExportOption', ['ORIGINAL_IMAGE', 'OPTIMIZED_IMAGE', 'LINK_TO_SERVER'], 'Copy Images: original, optimized, or link to a server path'),
    serverPath: S('Server path, with imageExportOption LINK_TO_SERVER', 1000),
    imageExtension: S('File extension of linked images, with LINK_TO_SERVER', 20),
    preserveLayoutAppearence: B('Preserve Appearance from Layout'),
    imageExportResolution: E('ImageResolution', IMAGE_RESOLUTION, 'Resolution (ppi)'),
    customImageSizeOption: E('ImageSizeOption', ['SIZE_FIXED', 'SIZE_RELATIVE_TO_TEXT_FLOW'], 'Image Size'),
    imageAlignment: E('ImageAlignmentType', IMAGE_ALIGNMENT, 'Image Alignment'),
    imageSpaceBefore: N('Space before images (pixels)', 0, 10000),
    imageSpaceAfter: N('Space after images (pixels)', 0, 10000),
    imageConversion: E('ImageConversion', IMAGE_CONVERSION, 'Image Format'),
    jpegOptionsQuality: E('JPEGOptionsQuality', JPEG_QUALITY, 'JPEG quality'),
    jpegOptionsFormat: E('JPEGOptionsFormat', JPEG_FORMAT, 'JPEG format method'),
    gifOptionsPalette: E('GIFOptionsPalette', GIF_PALETTE, 'GIF palette'),
    gifOptionsInterlaced: B('GIF interlace'),
    ignoreObjectConversionSettings: B('Ignore Object Export Settings'),
    generateCascadeStyleSheet: B('Generate CSS'),
    preserveLocalOverride: B('Preserve Local Overrides'),
    includeClassesInHTML: B('Include Style Classes in HTML'),
    externalStyleSheets: L('Additional CSS: style sheet URLs or files'),
    javascripts: L('Link to External JavaScript: script URLs or files'),
    useSVGAs: E('UseSVGAsEnum', ['EMBED_CODE', 'OBJECT_TAGS'], 'SVG: embed the code, or use object tags'),
};

export const HTML_FIXED_LAYOUT = {
    epubPageRangeFormat: E('PageRangeFormat', ['EXPORT_ALL_PAGES', 'EXPORT_PAGE_RANGE'], 'Range: all pages or epubPageRange'),
    epubPageRange: S('Range: page names, e.g. "1-4,7"', 500),
};

// ---------------------------------------------------------------------------
// Import options used when placing (File > Place with Show Import Options)

export const WORD_IMPORT = {
    importTOC: B('Include Table of Contents Text'),
    importIndex: B('Include Index Text'),
    importFootnotes: B('Include Footnotes'),
    importEndnotes: B('Include Endnotes'),
    importAsStaticEndnotes: B('Import Endnotes as Static Text'),
    useTypographersQuotes: B('Use Typographer\'s Quotes'),
    removeFormatting: B('true: Remove Styles and Formatting from Text and Tables; false: Preserve Styles and Formatting'),
    preserveLocalOverrides: B('Preserve Local Overrides (with removeFormatting)'),
    convertTablesTo: E('ConvertTablesOptions', ['UNFORMATTED_TABLE', 'UNFORMATTED_TABBED_TEXT'], 'Convert Tables To (with removeFormatting)'),
    convertPageBreaks: E('ConvertPageBreaks', ['NONE', 'PAGE_BREAK', 'COLUMN_BREAK'], 'Manual Page Breaks: preserve as page or column breaks, or none'),
    preserveGraphics: B('Import Inline Graphics'),
    importUnusedStyles: B('Import Unused Styles'),
    preserveTrackChanges: B('Track Changes'),
    convertBulletsAndNumbersToText: B('Convert Bullets & Numbers to Text'),
    resolveParagraphStyleClash: E('ResolveStyleClash', ['RESOLVE_CLASH_USE_EXISTING', 'RESOLVE_CLASH_USE_NEW', 'RESOLVE_CLASH_AUTO_RENAME'], 'Style Name Conflicts: paragraph styles'),
    resolveCharacterStyleClash: E('ResolveStyleClash', ['RESOLVE_CLASH_USE_EXISTING', 'RESOLVE_CLASH_USE_NEW', 'RESOLVE_CLASH_AUTO_RENAME'], 'Style Name Conflicts: character styles'),
};

export const EXCEL_IMPORT = {
    sheetName: S('Sheet, by name', 300),
    sheetIndex: N('Sheet, by 0-based index', 0, 10000),
    viewName: S('View', 300),
    rangeName: S('Cell Range, e.g. "A1:D20" or a named range', 300),
    showHiddenCells: B('Import Hidden Cells Not Saved in View'),
    tableFormatting: E('TableFormattingOptions', ['EXCEL_FORMATTED_TABLE', 'EXCEL_UNFORMATTED_TABLE', 'EXCEL_UNFORMATTED_TABBED_TEXT', 'EXCEL_FORMAT_ONLY_ONCE'], 'Table: formatted, unformatted, tabbed text, or formatted once'),
    alignmentStyle: E('AlignmentStyleOptions', ['SPREADSHEET', 'LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN'], 'Cell Alignment'),
    preserveGraphics: B('Include Inline Graphics'),
    decimalPlaces: N('Number of Decimal Places to Include', 0, 30),
    useTypographersQuotes: B('Use Typographer\'s Quotes'),
};

export const TEXT_IMPORT = {
    characterSet: E('TextImportCharacterSet', ['UTF8', 'UTF16', 'ANSI', 'MACINTOSH_ROMAN', 'WINDOWS_CE', 'WINDOWS_CYRILLIC', 'WINDOWS_GREEK', 'WINDOWS_TURKISH', 'WINDOWS_BALTIC', 'WINDOWS_ARABIC', 'WINDOWS_HEBREW', 'WINDOWS_EE', 'CENTRALEUROPEAN_ISO', 'CYRILLIC_ISO', 'GREEK_ISO', 'TURKISH_ISO', 'CYRILLIC_KOI8R', 'CYRILLIC_KOI8U', 'CYRILLIC_CP855', 'DOS_LATIN_2', 'ARABIC_ASMO', 'ARABIC_ASMO_TRANSPARENT', 'MACINTOSH_ARABIC', 'MACINTOSH_CE', 'MACINTOSH_CROATIAN', 'MACINTOSH_CYRILLIC', 'MACINTOSH_GREEK', 'MACINTOSH_GREEK_SHARED_CAPS', 'MACINTOSH_HEBREW', 'MACINTOSH_ICELANDIC', 'MACINTOSH_ROMANIAN', 'MACINTOSH_TURKISH', 'CHINESE_BIG_5', 'GB2312', 'GB18030', 'KSC5601', 'SHIFTJIS90MS', 'SHIFTJIS90PV', 'RECOMMENDSHIFTJIS83PV'], 'Character Set'),
    platform: E('ImportPlatform', PLATFORM, 'Platform'),
    dictionary: S('Set Dictionary to: a language name, e.g. "English: USA"', 100),
    stripReturnsBetweenLines: B('Extra Carriage Returns: Remove at End of Every Line'),
    stripReturnsBetweenParagraphs: B('Extra Carriage Returns: Remove Between Paragraphs'),
    convertSpacesIntoTabs: B('Replace Spaces with a Tab'),
    spacesIntoTabsCount: N('Number of spaces to replace with a tab', 1, 100),
    useTypographersQuotes: B('Use Typographer\'s Quotes'),
};

export const TAGGED_TEXT_IMPORT = {
    useTypographersQuotes: B('Use Typographer\'s Quotes'),
    removeTextFormatting: B('Remove Text Formatting'),
    styleConflict: E('StyleConflict', ['PUBLICATION_DEFINITION', 'TAG_FILE_DEFINITION'], 'Resolve Text Style Conflicts Using the publication or the tagged file definition'),
};

// ---------------------------------------------------------------------------
// Text export (File > Export as Text Only, Rich Text, InDesign Tagged Text)

export const TEXT_EXPORT = {
    platform: E('ImportPlatform', PLATFORM, 'Platform'),
    characterSet: E('TextExportCharacterSet', ['UTF8', 'UTF16', 'DEFAULT_PLATFORM'], 'Encoding'),
};

export const TAGGED_TEXT_EXPORT = {
    characterSet: E('TagTextExportCharacterSet', ['UNICODE', 'ASCII', 'ANSI', 'SHIFT_JIS', 'GB18030', 'CHINESE_BIG_5', 'KSC5601', 'CENTRALEUROPEAN_ISO', 'CYRILLIC_ISO', 'GREEK_ISO', 'WINDOWS_ARABIC', 'WINDOWS_HEBREW'], 'Encoding'),
    tagForm: E('TagTextForm', ['VERBOSE', 'ABBREVIATED'], 'Tags: verbose or abbreviated'),
};

// ---------------------------------------------------------------------------
// JPEG, PNG and EPS export

export const JPEG_EXPORT = {
    jpegQuality: E('JPEGOptionsQuality', JPEG_QUALITY, 'Quality'),
    jpegRenderingStyle: E('JPEGOptionsFormat', JPEG_FORMAT, 'Format Method: baseline or progressive'),
    exportResolution: N('Resolution (ppi)', 1, 2400),
    jpegColorSpace: E('JpegColorSpaceEnum', ['RGB', 'CMYK', 'GRAY'], 'Color Space'),
    embedColorProfile: B('Embed Color Profile'),
    antiAlias: B('Anti-alias'),
    useDocumentBleeds: B('Use Document Bleed Settings'),
    simulateOverprint: B('Simulate Overprint'),
};

export const PNG_EXPORT = {
    pngQuality: E('PNGQualityEnum', JPEG_QUALITY, 'Quality'),
    exportResolution: N('Resolution (ppi)', 1, 2400),
    pngColorSpace: E('PNGColorSpaceEnum', ['RGB', 'GRAY'], 'Color Space'),
    transparentBackground: B('Transparent Background'),
    antiAlias: B('Anti-alias'),
    useDocumentBleeds: B('Use Document Bleed Settings'),
    simulateOverprint: B('Simulate Overprint'),
};

export const EPS_EXPORT = {
    postscriptLevel: E('PostScriptLevels', ['LEVEL_2', 'LEVEL_3'], 'PostScript level'),
    epsColor: E('EPSColorSpace', ['UNCHANGED_COLOR_SPACE', 'CMYK', 'RGB', 'GRAY', 'POSTSCRIPT_COLOR_MANAGEMENT'], 'Color'),
    preview: E('PreviewTypes', ['NONE', 'TIFF_PREVIEW'], 'Preview'),
    fontEmbedding: E('FontEmbedding', ['NONE', 'COMPLETE', 'SUBSET'], 'Embed Fonts'),
    dataFormat: E('DataFormat', ['ASCII', 'BINARY'], 'Data Format'),
    imageData: E('EPSImageData', ['ALL_IMAGE_DATA', 'PROXY_IMAGE_DATA'], 'Images: all, or proxy'),
    opiImageReplacement: B('OPI Image Replacement'),
    omitEPS: B('OPI: omit EPS'),
    omitPDF: B('OPI: omit PDF'),
    omitBitmaps: B('OPI: omit bitmap images'),
    appliedFlattenerPreset: FLATTENER('Transparency Flattener preset name'),
    ignoreSpreadOverrides: B('Ignore Spread Overrides'),
    bleedTop: N('Bleed Top (mm)', 0, 152.4),
    bleedBottom: N('Bleed Bottom (mm)', 0, 152.4),
    bleedInside: N('Bleed Inside (mm)', 0, 152.4),
    bleedOutside: N('Bleed Outside (mm)', 0, 152.4),
};

// ---------------------------------------------------------------------------
// Object Export Options (Object > Object Export Options): pageItem.objectExportOptions

export const OEO_ALT_TEXT = {
    altTextSourceType: E('SourceType', SOURCE_TYPE, 'Alt Text Source'),
    customAltText: S('Custom alt text, with SOURCE_CUSTOM', 5000),
    altMetadataProperty: XMP('XMP property for SOURCE_XMP_OTHER, as [namespace prefix, property path]'),
};

export const OEO_PDF = {
    applyTagType: E('TagType', ['TAG_FROM_STRUCTURE', 'TAG_ARTIFACT', 'TAG_BASED_ON_OBJECT'], 'Apply Tag: from structure, artifact, or based on object'),
    actualTextSourceType: E('SourceType', SOURCE_TYPE, 'Actual Text Source'),
    customActualText: S('Custom actual text, with SOURCE_CUSTOM', 5000),
    actualMetadataProperty: XMP('XMP property for SOURCE_XMP_OTHER, as [namespace prefix, property path]'),
};

export const OEO_EPUB = {
    preserveAppearanceFromLayout: E('PreserveAppearanceFromLayoutEnum', ['PRESERVE_APPEARANCE_DEFAULT', 'PRESERVE_APPEARANCE_USE_EXISTING_IMAGE', 'PRESERVE_APPEARANCE_RASTERIZE_CONTAINER', 'PRESERVE_APPEARANCE_RASTERIZE_CONTENT'], 'Custom Rasterization: preserve appearance from layout'),
    sizeType: E('SizeTypeEnum', ['DEFAULT_SIZE', 'FIXED_SIZE', 'RELATIVE_TO_TEXT_FLOW', 'RELATIVE_TO_TEXT_SIZE', 'NONE_SIZE', 'USE_CUSTOM_WIDTH', 'USE_CUSTOM_HEIGHT'], 'Size'),
    customSize: S('Custom width or height, with USE_CUSTOM_WIDTH or USE_CUSTOM_HEIGHT (e.g. "50%" or "200px")', 50),
    imageExportResolution: E('ImageResolution', IMAGE_RESOLUTION, 'Resolution (ppi)'),
    imageConversionType: E('ImageFormat', ['JPEG', 'GIF', 'PNG'], 'Format'),
    jpegOptionsQuality: E('JPEGOptionsQuality', JPEG_QUALITY, 'JPEG quality'),
    jpegOptionsFormat: E('JPEGOptionsFormat', JPEG_FORMAT, 'JPEG method'),
    gifOptionsPalette: E('GIFOptionsPalette', GIF_PALETTE, 'GIF palette'),
    gifOptionsInterlaced: B('GIF interlace'),
    customLayout: B('Custom Layout'),
    customLayoutType: E('CustomLayoutTypeEnum', ['ALIGNMENT_AND_SPACING', 'FLOAT_LEFT', 'FLOAT_RIGHT'], 'Custom layout type'),
    imageAlignment: E('ImageAlignmentType', IMAGE_ALIGNMENT, 'Custom Image Alignment'),
    imageSpaceBefore: N('Space before (pixels)', 0, 10000),
    imageSpaceAfter: N('Space after (pixels)', 0, 10000),
    useImagePageBreak: B('Insert Page Break'),
    imagePageBreak: E('ImagePageBreakType', PAGE_BREAK, 'Where to insert the page break'),
    epubType: S('EPUB Type (epub:type), e.g. "chapter" or "footnote"', 200),
    epubAriaRole: since('2026', S('ARIA role, e.g. "doc-chapter"', 200)),
    epubAriaLabel: since('2026 (21.5)', S('ARIA label', 2000)),
    epubAriaLabelSourceType: since('2026 (21.5)', E('EpubAriaLabelSourceType', ['AUTOMATIC_ARIA_LABEL', 'CUSTOM_ARIA_LABEL', 'NONE_ARIA_LABEL'], 'ARIA label source')),
};

/**
 * Valid sample values for every option of a table: the script audit uses them
 * (as a tool's auditArgs) so each property assignment is checked by name.
 */
export function sampleOptions(table) {
    const home = process.env.HOME ?? '/tmp';
    const sample = {
        bool: () => true,
        num: (s) => s.min,
        str: () => 'Sample',
        enum: (s) => s.values[0],
        list: () => ['https://example.com/sample'],
        file: () => `${home}/Documents/sample.jpg`,
        flattener: () => '[Medium Resolution]',
        profile: () => 'USE_DOCUMENT',
        xmp: () => ['dc', 'title'],
    };
    return Object.fromEntries(Object.entries(table).map(([k, s]) => [k, sample[s.kind](s)]));
}
