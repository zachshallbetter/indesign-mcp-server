/**
 * Prepress: printing with every Print dialog option (to a printer or a
 * PostScript file), print presets, Print Booklet, trap presets, preflight
 * profiles, rules, options and live status, the Ink Manager, separations,
 * overprint and flattener preview, print attributes (overprint, nonprinting
 * objects, printable layers), and the Package report and options.
 *
 * Distances (offsets, gaps, bleeds, margins, creep) are millimetres; trap
 * widths are points; screen frequencies are lines per inch and angles are
 * degrees. Option names are InDesign's own property names, so a value read
 * back with a get_ tool can be passed straight to a set or print tool.
 */
import { str, num, bool, json, enumOf, measure, jsxPath } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';
import { TEXT_TARGET_SCHEMA, textSpec, TEXT_HELPERS } from './paragraph.js';
import { validateFilePath } from '../utils/jsxSafe.js';

const PP = 'indesign.preflight_prepress.';
const fx = (ids) => ids.map((id) => PP + id);

// Field builders: each field becomes a schema property and one checked assignment.
const flag = (prop, description) => ({ prop, kind: 'bool', description });
const int = (prop, min, max, description) => ({ prop, kind: 'int', min, max, description: `${description} (${min} to ${max})` });
const real = (prop, min, max, description) => ({ prop, kind: 'num', min, max, description: `${description} (${min} to ${max})` });
const mm = (prop, description, min = 0, max = 1000) => ({ prop, kind: 'num', min, max, description: `${description} (mm)` });
const pt = (prop, description, min, max) => ({ prop, kind: 'pt', min, max, description: `${description} (points, ${min} to ${max})` });
const pick = (prop, type, values, description) => ({ prop, kind: 'enum', type, values, description });
const named = (prop, type, values, description) => ({ prop, kind: 'named', type, values, description: `${description}; or ${values.join(' / ')}` });
const text = (prop, description) => ({ prop, kind: 'string', description });

/**
 * Every option of the Print dialog, as PrintPreference properties, in the
 * order they are written: the printer and PPD before paper sizes, modes
 * before the values they enable.
 */
export const PRINT_FIELDS = {
    // General
    printer: named('printer', 'Printer', ['POSTSCRIPT_FILE'], 'Printer name, as listed by get_print_settings (General > Printer)'),
    ppd: named('ppd', 'PPDValues', ['DEVICE_INDEPENDENT'], 'PPD name, as listed by get_print_settings (General > PPD)'),
    copies: int('copies', 1, 9999, 'Number of copies (General > Copies)'),
    collating: flag('collating', 'Collate copies (General > Collate)'),
    reverseOrder: flag('reverseOrder', 'Print pages in reverse order (General > Reverse Order)'),
    pageRange: named('pageRange', 'PageRange', ['ALL_PAGES'], 'Pages to print as a range such as "1-4, 7" or "+1-+3" for absolute page numbers (General > Pages: Range)'),
    sequence: pick('sequence', 'Sequences', ['ALL', 'EVEN', 'ODD'], 'All pages, even pages or odd pages (General > Sequence)'),
    printSpreads: flag('printSpreads', 'Print each spread on one sheet (General > Spreads)'),
    printMasterPages: flag('printMasterPages', 'Print parent pages instead of document pages (General > Print Parent Pages)'),
    printLayers: pick('printLayers', 'PrintLayerOptions', ['ALL_LAYERS', 'VISIBLE_LAYERS', 'VISIBLE_PRINTABLE_LAYERS'], 'Which layers print (General > Print Layers)'),
    printNonprinting: flag('printNonprinting', 'Print objects marked nonprinting (General > Print Non-printing Objects)'),
    printBlankPages: flag('printBlankPages', 'Print blank pages (General > Print Blank Pages)'),
    printGuidesGrids: flag('printGuidesGrids', 'Print visible guides and baseline grids (General > Print Visible Guides and Baseline Grids)'),
    // Setup
    paperSize: named('paperSize', 'PaperSizes', ['DEFINED_BY_DRIVER', 'CUSTOM'], 'Paper size name, as listed by get_print_settings (Setup > Paper Size)'),
    paperWidth: { prop: 'paperWidth', kind: 'auto', min: 1, max: 10000, description: 'Custom paper width in mm, or "AUTO" (Setup > Width)' },
    paperHeight: { prop: 'paperHeight', kind: 'auto', min: 1, max: 10000, description: 'Custom paper height in mm, or "AUTO" (Setup > Height)' },
    printPageOrientation: pick('printPageOrientation', 'PrintPageOrientation', ['PORTRAIT', 'LANDSCAPE', 'REVERSE_PORTRAIT', 'REVERSE_LANDSCAPE'], 'Orientation on the paper (Setup > Orientation)'),
    paperOffset: mm('paperOffset', 'Offset from the left edge of the imageable area (Setup > Offset)'),
    paperGap: mm('paperGap', 'Space between pages on roll-fed media (Setup > Gap)'),
    paperTransverse: flag('paperTransverse', 'Rotate the page 90° on the media (Setup > Transverse)'),
    scaleMode: pick('scaleMode', 'ScaleModes', ['SCALE_WIDTH_HEIGHT', 'SCALE_TO_FIT'], 'Scale by width and height, or scale to fit (Setup > Scale)'),
    scaleWidth: real('scaleWidth', 1, 1000, 'Width scale (%) (Setup > Scale > Width)'),
    scaleHeight: real('scaleHeight', 1, 1000, 'Height scale (%) (Setup > Scale > Height)'),
    scaleProportional: flag('scaleProportional', 'Constrain proportions (Setup > Scale > Constrain Proportions)'),
    pagePosition: pick('pagePosition', 'PagePositions', ['UPPER_LEFT', 'CENTER_HORIZONTALLY', 'CENTER_VERTICALLY', 'CENTERED'], 'Page position on the paper (Setup > Page Position)'),
    thumbnails: flag('thumbnails', 'Print thumbnails (Setup > Thumbnails)'),
    thumbnailsPerPage: pick('thumbnailsPerPage', 'ThumbsPerPage', ['K1X2', 'K2X2', 'K3X3', 'K4X4', 'K5X5', 'K6X6', 'K7X7'], 'Thumbnails per sheet (Setup > Thumbnails)'),
    tile: flag('tile', 'Tile oversized pages (Setup > Tile)'),
    tilingType: pick('tilingType', 'TilingTypes', ['AUTO', 'AUTO_JUSTIFIED', 'MANUAL'], 'Tiling: Auto, Auto Justified or Manual (Setup > Tile)'),
    tilingOverlap: mm('tilingOverlap', 'Tile overlap (Setup > Tile > Overlap)'),
    // Marks and Bleed
    allPrinterMarks: flag('allPrinterMarks', 'All printer\'s marks (Marks and Bleed > All Printer\'s Marks)'),
    cropMarks: flag('cropMarks', 'Crop marks (Marks and Bleed > Crop Marks)'),
    bleedMarks: flag('bleedMarks', 'Bleed marks (Marks and Bleed > Bleed Marks)'),
    registrationMarks: flag('registrationMarks', 'Registration marks (Marks and Bleed > Registration Marks)'),
    colorBars: flag('colorBars', 'Colour bars (Marks and Bleed > Color Bars)'),
    pageInformationMarks: flag('pageInformationMarks', 'Page information (Marks and Bleed > Page Information)'),
    markType: named('markType', 'MarkTypes', ['DEFAULT_VALUE', 'J_MARK_WITH_CIRCLE', 'J_MARK_WITHOUT_CIRCLE'], 'Printer marks type, or the name of a custom marks file (Marks and Bleed > Type)'),
    markLineWeight: pick('markLineWeight', 'MarkLineWeight', ['P125PT', 'P25PT', 'P50PT', 'P05MM', 'P07MM', 'P10MM', 'P15MM', 'P20MM', 'P30MM'], 'Mark weight: P125PT = 0.125 pt, P05MM = 0.05 mm (Marks and Bleed > Weight)'),
    markOffset: mm('markOffset', 'Distance of marks from the trim (Marks and Bleed > Offset)', 0, 25.4),
    useDocumentBleedToPrint: flag('useDocumentBleedToPrint', 'Use the document\'s bleed settings (Marks and Bleed > Use Document Bleed Settings)'),
    bleedChain: flag('bleedChain', 'Make all four bleed values the same (Marks and Bleed > chain icon)'),
    bleedTop: mm('bleedTop', 'Top bleed (Marks and Bleed > Bleed)', 0, 152.4),
    bleedBottom: mm('bleedBottom', 'Bottom bleed (Marks and Bleed > Bleed)', 0, 152.4),
    bleedInside: mm('bleedInside', 'Inside (or left) bleed (Marks and Bleed > Bleed)', 0, 152.4),
    bleedOutside: mm('bleedOutside', 'Outside (or right) bleed (Marks and Bleed > Bleed)', 0, 152.4),
    includeSlugToPrint: flag('includeSlugToPrint', 'Include the slug area (Marks and Bleed > Include Slug Area)'),
    // Output
    colorOutput: pick('colorOutput', 'ColorOutputModes', ['COMPOSITE_LEAVE_UNCHANGED', 'COMPOSITE_GRAY', 'COMPOSITE_RGB', 'COMPOSITE_CMYK', 'SEPARATIONS', 'INRIP_SEPARATIONS'], 'Composite output (proofs) or separations (Output > Color)'),
    textAsBlack: flag('textAsBlack', 'Print all text as black (Output > Text as Black)'),
    trapping: pick('trapping', 'Trapping', ['OFF', 'APPLICATION_BUILTIN', 'ADOBE_INRIP'], 'Trapping for separations: off, application built-in or Adobe In-RIP (Output > Trapping)'),
    flip: pick('flip', 'Flip', ['NONE', 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_AND_VERTICAL'], 'Flip the printed image (Output > Flip)'),
    negative: flag('negative', 'Print as a negative (Output > Negative)'),
    screening: named('screening', 'Screeening', ['DEFAULT_VALUE', 'CUSTOM'], 'Screening name from the PPD, as listed by get_print_settings (Output > Screening)'),
    printCyan: flag('printCyan', 'Print the cyan plate (Output > Inks)'),
    printMagenta: flag('printMagenta', 'Print the magenta plate (Output > Inks)'),
    printYellow: flag('printYellow', 'Print the yellow plate (Output > Inks)'),
    printBlack: flag('printBlack', 'Print the black plate (Output > Inks)'),
    cyanFrequency: real('cyanFrequency', 1, 500, 'Cyan screen frequency, lpi (Output > Inks > Frequency)'),
    cyanAngle: real('cyanAngle', 0, 360, 'Cyan screen angle, degrees (Output > Inks > Angle)'),
    magentaFrequency: real('magentaFrequency', 1, 500, 'Magenta screen frequency, lpi (Output > Inks > Frequency)'),
    magentaAngle: real('magentaAngle', 0, 360, 'Magenta screen angle, degrees (Output > Inks > Angle)'),
    yellowFrequency: real('yellowFrequency', 1, 500, 'Yellow screen frequency, lpi (Output > Inks > Frequency)'),
    yellowAngle: real('yellowAngle', 0, 360, 'Yellow screen angle, degrees (Output > Inks > Angle)'),
    blackFrequency: real('blackFrequency', 1, 500, 'Black screen frequency, lpi (Output > Inks > Frequency)'),
    blackAngle: real('blackAngle', 0, 360, 'Black screen angle, degrees (Output > Inks > Angle)'),
    compositeFrequency: real('compositeFrequency', 1, 500, 'Composite screen frequency, lpi, with custom screening (Output > Frequency)'),
    compositeAngle: real('compositeAngle', 0, 360, 'Composite screen angle, degrees, with custom screening (Output > Angle)'),
    simulateOverprint: flag('simulateOverprint', 'Simulate overprint in composite output (Output > Simulate Overprint)'),
    // Graphics
    sendImageData: pick('sendImageData', 'ImageDataTypes', ['ALL_IMAGE_DATA', 'OPTIMIZED_SUBSAMPLING', 'PROXY_IMAGE_DATA', 'NONE'], 'Image data sent (Graphics > Images: Send Data)'),
    fontDownloading: pick('fontDownloading', 'FontDownloading', ['NONE', 'COMPLETE', 'SUBSET', 'SUBSET_LARGE'], 'Font download (Graphics > Fonts: Download)'),
    downloadPPDFonts: flag('downloadPPDFonts', 'Download PPD fonts (Graphics > Download PPD Fonts)'),
    postscriptLevel: pick('postscriptLevel', 'PostScriptLevels', ['LEVEL_2', 'LEVEL_3'], 'PostScript level (Graphics > PostScript)'),
    dataFormat: pick('dataFormat', 'DataFormat', ['BINARY', 'ASCII'], 'Data format (Graphics > Data Format)'),
    // Color Management
    sourceSpace: pick('sourceSpace', 'SourceSpaces', ['USE_DOCUMENT', 'PROOF_SPACE'], 'Print the document or a proof (Color Management > Print: Document / Proof)'),
    profile: named('profile', 'Profile', ['USE_DOCUMENT', 'WORKING', 'POSTSCRIPT_CMS', 'NO_CMS'], 'Printer profile name (Color Management > Printer Profile); POSTSCRIPT_CMS lets the PostScript printer manage colours, NO_CMS lets the printer'),
    crd: named('crd', 'ColorRenderingDictionary', ['DEFAULT_VALUE', 'USE_DOCUMENT', 'WORKING'], 'Colour rendering dictionary name, for PostScript colour handling (Color Management > Color Handling)'),
    intent: pick('intent', 'RenderingIntent', ['USE_COLOR_SETTINGS', 'PERCEPTUAL', 'SATURATION', 'RELATIVE_COLORIMETRIC', 'ABSOLUTE_COLORIMETRIC'], 'Rendering intent of the output colour (Color Management)'),
    preserveColorNumbers: flag('preserveColorNumbers', 'Preserve CMYK numbers (Color Management > Preserve CMYK Numbers)'),
    // Advanced
    bitmapPrinting: flag('bitmapPrinting', 'Print as bitmap (Advanced > Print as Bitmap)'),
    bitmapResolution: int('bitmapResolution', 72, 1200, 'Bitmap printing resolution, dpi (Advanced > Print as Bitmap)'),
    opiImageReplacement: flag('opiImageReplacement', 'Let InDesign replace OPI proxies with high-resolution images (Advanced > OPI Image Replacement)'),
    omitEPS: flag('omitEPS', 'Omit EPS images for OPI (Advanced > Omit for OPI: EPS)'),
    omitPDF: flag('omitPDF', 'Omit PDF images for OPI (Advanced > Omit for OPI: PDF)'),
    omitBitmaps: flag('omitBitmaps', 'Omit bitmap images for OPI (Advanced > Omit for OPI: Bitmap Images)'),
    flattenerPresetName: text('flattenerPresetName', 'Transparency flattener preset name, e.g. "[High Resolution]" (Advanced > Transparency Flattener Preset)'),
    ignoreSpreadOverrides: flag('ignoreSpreadOverrides', 'Ignore spread flattener overrides (Advanced > Ignore Spread Overrides)'),
};

/** Print options that a printer preset or the booklet print settings do not have. */
const NOT_IN_PRESET = ['pageRange', 'preserveColorNumbers'];
const NOT_IN_BOOKLET = ['includeSlugToPrint', 'pageRange', 'printMasterPages', 'printSpreads', 'sequence', 'thumbnails',
    'thumbnailsPerPage', 'tile', 'tilingOverlap', 'tilingType'];

/** Print Booklet dialog > Setup, as PrintBookletOption properties. */
export const BOOKLET_FIELDS = {
    bookletType: pick('bookletType', 'BookletTypeOptions', ['TWO_UP_SADDLE_STITCH', 'TWO_UP_PERFECT_BOUND', 'TWO_UP_CONSECUTIVE', 'THREE_UP_CONSECUTIVE', 'FOUR_UP_CONSECUTIVE'], 'Booklet type (Setup > Booklet Type)'),
    pageRange: named('pageRange', 'PageRange', ['ALL_PAGES'], 'Pages to impose, as a range such as "1-16" (Pages: Range)'),
    spaceBetweenPages: mm('spaceBetweenPages', 'Space between pages, for perfect bound and consecutive booklets (Setup > Space Between Pages)'),
    bleedBetweenPages: mm('bleedBetweenPages', 'Bleed between pages, up to half the space between them (Setup > Bleed Between Pages)'),
    creep: mm('creep', 'Creep: how far pages move outward to allow for paper thickness (Setup > Creep)'),
    signatureSize: pick('signatureSize', 'SignatureSizeOptions', ['SIGNATURE_SIZE_4', 'SIGNATURE_SIZE_8', 'SIGNATURE_SIZE_12', 'SIGNATURE_SIZE_16', 'SIGNATURE_SIZE_32'], 'Pages per signature, for perfect bound booklets (Setup > Signature Size)'),
    autoAdjustMargins: flag('autoAdjustMargins', 'Adjust margins to fit printer\'s marks and bleeds (Setup > Automatically Adjust to Fit Marks and Bleeds)'),
    marginsUniformSize: flag('marginsUniformSize', 'Make all margins equal to the top margin (Setup > Margins)'),
    topMargin: mm('topMargin', 'Top margin (Setup > Margins)'),
    bottomMargin: mm('bottomMargin', 'Bottom margin (Setup > Margins)'),
    leftMargin: mm('leftMargin', 'Left margin (Setup > Margins)'),
    rightMargin: mm('rightMargin', 'Right margin (Setup > Margins)'),
    printBlankPrinterSpreads: flag('printBlankPrinterSpreads', 'Print blank printer spreads (Setup > Print Blank Printer Spreads)'),
};

/** Trap Presets panel > Preset Options, as TrapPreset properties. */
export const TRAP_FIELDS = {
    defaultTrapWidth: pt('defaultTrapWidth', 'Default trap width (Trap Width > Default)', 0, 8),
    blackWidth: pt('blackWidth', 'Trap width where black is involved (Trap Width > Black)', 0, 8),
    trapJoin: pick('trapJoin', 'EndJoin', ['MITER_END_JOIN', 'ROUND_END_JOIN', 'BEVEL_END_JOIN'], 'Join style (Trap Appearance > Join Style)'),
    trapEnd: pick('trapEnd', 'TrapEndTypes', ['MITER_TRAP_ENDS', 'OVERLAP_TRAP_ENDS'], 'End style (Trap Appearance > End Style)'),
    imagePlacement: pick('imagePlacement', 'TrapImagePlacementTypes', ['CENTER_EDGES', 'CHOKE', 'IMAGE_NEUTRAL_DENSITY', 'IMAGES_OVER_SPREAD'], 'Trap placement between images and objects: Center, Choke, Neutral Density or Spread (Images > Trap Placement)'),
    objectsToImages: flag('objectsToImages', 'Trap objects to images (Images > Trap Objects to Images)'),
    imagesToImages: flag('imagesToImages', 'Trap images to images (Images > Trap Images to Images)'),
    internalImages: flag('internalImages', 'Trap within images (Images > Trap Images Internally)'),
    oneBitImages: flag('oneBitImages', 'Trap 1-bit images (Images > Trap 1-bit Images)'),
    stepThreshold: real('stepThreshold', 1, 100, 'Colour change (%) needed before a trap is made (Trap Thresholds > Step)'),
    blackColorThreshold: real('blackColorThreshold', 0, 100, 'Black ink (%) at which the black trap width applies (Trap Thresholds > Black Color)'),
    blackDensity: real('blackDensity', 0.001, 10, 'Neutral density at or above which an ink counts as black (Trap Thresholds > Black Density)'),
    slidingTrapThreshold: real('slidingTrapThreshold', 0, 100, 'Density difference (%) at which a trap slides toward the centreline (Trap Thresholds > Sliding Trap)'),
    colorReduction: real('colorReduction', 0, 100, 'How much abutting colours reduce the trap colour, % (Trap Thresholds > Trap Color Reduction)'),
};

/** Ink Manager settings for one ink, as Ink properties. */
export const INK_FIELDS = {
    alias: { prop: 'aliasInkName', kind: 'string', description: 'Print this ink on another ink\'s plate: that ink\'s name (Ink Alias)' },
    type: pick('inkType', 'InkTypes', ['NORMAL', 'TRANSPARENT', 'OPAQUE', 'OPAQUE_IGNORE'], 'Ink type for trapping (Type)'),
    neutralDensity: real('neutralDensity', 0.001, 10, 'Neutral density (Neutral Density)'),
    trapOrder: int('trapOrder', 1, 100, 'Position in the trapping sequence (Trapping Sequence)'),
    convertToProcess: flag('convertToProcess', 'Print a spot ink as process (the ink\'s process icon)'),
    print: flag('printInk', 'Print this ink\'s plate when printing separations (Output > Inks, print icon)'),
    frequency: real('frequency', 1, 500, 'Screen frequency of the ink, lpi (Output > Inks > Frequency)'),
    angle: real('angle', 0, 360, 'Screen angle of the ink, degrees (Output > Inks > Angle)'),
};

/** Preflight Options dialog, as PreflightOption properties (the profile and page range are handled apart). */
const PREFLIGHT_FIELDS = {
    profilePolicy: pick('preflightProfilePolicy', 'PreflightProfileOptions', ['USE_EMBEDDED_PROFILE', 'USE_WORKING_PROFILE'], 'When opening documents: use the embedded profile or the working profile (Use Embedded Profile / Use Working Profile)'),
    embedWorkingProfile: flag('preflightEmbedWorkingProfile', 'Embed the working profile into new documents (Embed Working Profile into New Documents)'),
    layers: pick('preflightWhichLayers', 'PreflightLayerOptions', ['PREFLIGHT_ALL_LAYERS', 'PREFLIGHT_VISIBLE_LAYERS', 'PREFLIGHT_VISIBLE_PRINTABLE_LAYERS'], 'Layers to preflight (Include: Layers)'),
    includeObjectsOnPasteboard: flag('preflightIncludeObjectsOnPasteboard', 'Include objects on the pasteboard (Include: Objects on Pasteboard)'),
    includeNonprintingObjects: flag('preflightIncludeNonprintingObjects', 'Include nonprinting objects (Include: Non-printing Objects)'),
};

/** A JSON schema property for a field. */
function fieldSchema(f) {
    if (f.kind === 'bool') return { type: 'boolean', description: f.description };
    if (f.kind === 'int') return { type: 'integer', minimum: f.min, maximum: f.max, description: f.description };
    if (f.kind === 'num' || f.kind === 'pt') return { type: 'number', minimum: f.min, maximum: f.max, description: f.description };
    if (f.kind === 'enum') return { type: 'string', enum: f.values, description: f.description };
    if (f.kind === 'auto') return { anyOf: [{ type: 'number', minimum: f.min, maximum: f.max }, { type: 'string', enum: ['AUTO'] }], description: f.description };
    return { type: 'string', description: f.description };
}

/** The schema of an option object built from fields, leaving out `exclude`. */
function optionsSchema(fields, description, exclude = []) {
    const properties = {};
    for (const [k, f] of Object.entries(fields)) if (!exclude.includes(k)) properties[k] = fieldSchema(f);
    return { type: 'object', description, properties };
}

/** Validate one value and return its JSX literal. */
function fieldValue(f, value, name) {
    if (f.kind === 'bool') {
        if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
        return bool(value);
    }
    if (f.kind === 'int') {
        if (!Number.isInteger(Number(value))) throw new Error(`'${name}' must be a whole number`);
        return num(value, { min: f.min, max: f.max, name });
    }
    if (f.kind === 'num') return num(value, { min: f.min, max: f.max, name });
    if (f.kind === 'pt') return measure(num(value, { min: f.min, max: f.max, name }), { unit: 'pt', name });
    if (f.kind === 'enum') return `${f.type}.${enumOf(value, f.values, { name })}`;
    if (f.kind === 'auto') return value === 'AUTO' ? 'PaperSize.AUTO' : num(value, { min: f.min, max: f.max, name });
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be a non-empty string`);
    if (value.length > 500) throw new Error(`'${name}' is too long`);
    if (f.kind === 'named' && f.values.includes(value)) return `${f.type}.${value}`;
    return str(value);
}

/**
 * Statements writing an option object to `obj`, in field order. Unknown
 * options and options in `exclude` are refused; each assignment names the
 * option if InDesign refuses the value.
 */
function optionStatements(obj, fields, input, prefix, { exclude = [], what = '' } = {}) {
    if (input === undefined || input === null) return [];
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error(`'${prefix || 'options'}' must be an object`);
    const label = (k) => (prefix ? `${prefix}.${k}` : k);
    for (const k of Object.keys(input)) {
        if (!(k in fields)) throw new Error(`Unknown option '${label(k)}'`);
        if (exclude.includes(k)) throw new Error(`'${label(k)}' does not apply to ${what}`);
    }
    return Object.keys(fields).filter((k) => input[k] !== undefined).map((k) => {
        const f = fields[k];
        return `try { ${obj}.${f.prop} = ${fieldValue(f, input[k], label(k))}; } catch (e) { throw new Error(${str(`${label(k)}: `)} + e.message); }`;
    });
}

/** [property, kind] pairs for __read(), leaving out `exclude`. */
function readSpec(fields, exclude = []) {
    return json(Object.entries(fields).filter(([k]) => !exclude.includes(k)).map(([, f]) => [f.prop, f.kind]));
}

/**
 * Script helpers: __read(obj, spec) reads properties back as plain values
 * (enumerations by name, trap widths in points); __copy(from, to, spec) copies
 * them, returning the ones InDesign refused; __preset(name) finds a printer
 * preset; __menu / __toggle invoke a menu action or set a checked one.
 */
const HELPERS = String.raw`
var __read = function (o, spec) {
  var out = {};
  for (var i = 0; i < spec.length; i++) {
    var k = spec[i][0], kind = spec[i][1], v;
    try { v = o[k]; } catch (e) { continue; }
    if (kind === "enum") v = __enumName(v);
    else if (kind === "named") v = typeof v === "string" ? v : __enumName(v);
    else if (kind === "auto") v = typeof v === "number" ? v : __enumName(v);
    else if (kind === "pt") v = v * 72 / 25.4;
    out[k] = v;
  }
  return out;
};
var __copy = function (from, to, spec) {
  var refused = [];
  for (var i = 0; i < spec.length; i++) {
    var k = spec[i][0];
    try { to[k] = from[k]; } catch (e) { refused.push(k); }
  }
  return refused;
};
var __preset = function (name) {
  var p = app.printerPresets.itemByName(name);
  if (!p.isValid) throw new Error("No print preset named " + name);
  return p;
};
var __action = function (id, label) {
  var m = app.menuActions.itemByID(id);
  if (!m.isValid) throw new Error(label + " is not available in this version of InDesign");
  return m;
};
var __menu = function (id, label) {
  var m = __action(id, label);
  if (!m.enabled) throw new Error(label + " is not available now (open a document window, and the panel it belongs to)");
  m.invoke();
};
var __toggle = function (id, label, on) {
  var m = __action(id, label);
  if (m.checked !== on) __menu(id, label);
  return m.checked;
};
`;

/** A caller's file path, checked against the server's path policy, as a JSX literal. */
function filePath(value, name, extensions) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be a file path`);
    if (extensions && !extensions.some((x) => value.toLowerCase().endsWith(x))) {
        throw new Error(`'${name}' must end in ${extensions.join(' or ')}`);
    }
    return jsxPath(validateFilePath(value));
}

/** A preset or profile name. */
function nameOf(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be a non-empty name`);
    if (value.length > 200) throw new Error(`'${name}' is too long`);
    return value;
}

/** Shared parts of the print tools' schemas. */
const OUTPUT_SCHEMA = {
    type: 'string',
    enum: ['printer', 'postscript_file', 'settings_only'],
    description: 'printer: print now to the chosen printer; postscript_file: write a PostScript file to postscriptFile (File > Print > Printer: PostScript File); settings_only: save the settings in the document without printing',
    default: 'printer',
};
const POSTSCRIPT_SCHEMA = { type: 'string', description: 'Absolute path of the PostScript file to write (.ps), for output: postscript_file' };
const PRESET_SCHEMA = { type: 'string', description: 'Print preset to start from, e.g. "[Default]" or a saved preset (File > Print > Print Preset); settings given here then override it' };

/**
 * Statements that choose a preset, the output and the settings on `obj`
 * (doc.printPreferences or doc.printBookletPrintPreferences), and the output
 * mode chosen.
 */
function printSetup(a, obj, exclude, what) {
    const output = enumOf(a.output ?? 'printer', OUTPUT_SCHEMA.enum, { name: 'output' });
    const lines = [];
    if (a.preset !== undefined) lines.push(`${obj}.activePrinterPreset = __preset(${str(nameOf(a.preset, 'preset'))});`);
    let file = null;
    if (output === 'postscript_file') {
        if (a.postscriptFile === undefined) throw new Error("output: postscript_file needs postscriptFile");
        file = filePath(a.postscriptFile, 'postscriptFile', ['.ps', '.prn', '.eps']);
        if (a.settings?.printer !== undefined && a.settings.printer !== 'POSTSCRIPT_FILE') throw new Error("settings.printer conflicts with output: postscript_file");
        lines.push(`${obj}.printer = Printer.POSTSCRIPT_FILE;`);
    } else if (a.postscriptFile !== undefined) {
        throw new Error("postscriptFile is only used with output: postscript_file");
    }
    if (output === 'printer' && a.settings?.printer === 'POSTSCRIPT_FILE') throw new Error("To write a PostScript file use output: postscript_file with postscriptFile");
    const settings = { ...(a.settings ?? {}) };
    if (output === 'postscript_file') delete settings.printer;
    lines.push(...optionStatements(obj, PRINT_FIELDS, a.settings === undefined ? undefined : settings, 'settings', { exclude, what }));
    if (file) lines.push(`${obj}.printFile = new File(${file});`);
    return { output, lines };
}

/** The Ink Manager list of a document as plain values. */
const INK_LIST = `
var __inks = function (doc) {
  var out = [];
  for (var i = 0; i < doc.inks.length; i++) {
    var k = doc.inks.item(i), o = { name: k.name, process: k.isProcessInk };
    try { o.alias = k.aliasInkName || null; } catch (e1) {}
    try { o.type = __enumName(k.inkType); } catch (e2) {}
    try { o.neutralDensity = k.neutralDensity; o.trapOrder = k.trapOrder; o.solidity = k.solidity; } catch (e3) {}
    try { o.print = k.printInk; o.convertToProcess = k.convertToProcess; } catch (e4) {}
    try { o.frequency = k.frequency; o.angle = k.angle; } catch (e5) {}
    out.push(o);
  }
  return out;
};`;

/** Trap preset list with the pages each preset is applied to. */
const TRAP_LIST = `
var __trapUse = function (doc) {
  var use = {};
  for (var i = 0; i < doc.pages.length; i++) {
    var pg = doc.pages[i], ap = pg.appliedTrapPreset, n = (typeof ap === "string") ? ap : ap.name;
    if (!use[n]) use[n] = [];
    use[n].push(pg.name);
  }
  return use;
};`;

/** Menu action ids (commands.json) for the Separations Preview plates. */
const PLATES = {
    all: 71956, cyan: 71957, magenta: 71958, yellow: 71959, black: 71960,
    spot_1: 71961, spot_2: 71962, spot_3: 71963, spot_4: 71964, spot_5: 71965,
};
/** Preflight panel menu > Limit Rows per Error. */
const ROWS_PER_ERROR = { 25: 133908, 50: 133909, 100: 133910, no_limit: 133911 };
const PREFLIGHT_PANEL = 133889;

const RULE_FLAGS = { error: 'RETURN_AS_ERROR', warning: 'RETURN_AS_WARNING', information: 'RETURN_AS_INFORMATIONAL', disabled: 'RULE_IS_DISABLED' };

/** Statements adding or changing preflight rules on profile `p`. */
function ruleStatements(rules) {
    if (rules === undefined) return [];
    if (!Array.isArray(rules)) throw new Error("'rules' must be a list");
    return rules.map((r, i) => {
        const n = `rules[${i}]`;
        if (!r || typeof r !== 'object') throw new Error(`'${n}' must be an object`);
        for (const k of Object.keys(r)) if (!['id', 'flag', 'data'].includes(k)) throw new Error(`Unknown option '${n}.${k}'`);
        if (typeof r.id !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(r.id)) throw new Error(`'${n}.id' must be a rule id such as ADBE_MissingFonts`);
        const out = [`var r = __rule(p, ${str(r.id)});`];
        if (r.flag !== undefined) out.push(`r.flag = PreflightRuleFlag.${RULE_FLAGS[enumOf(r.flag, Object.keys(RULE_FLAGS), { name: `${n}.flag` })]};`);
        if (r.data !== undefined) {
            if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) throw new Error(`'${n}.data' must be an object of data names and values`);
            for (const [k, v] of Object.entries(r.data)) {
                if (!/^[A-Za-z0-9_]{1,100}$/.test(k)) throw new Error(`'${n}.data': bad data name ${JSON.stringify(k)}`);
                const ok = (x) => typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x));
                if (!(ok(v) || (Array.isArray(v) && v.every(ok)))) throw new Error(`'${n}.data.${k}' must be a boolean, number, string or a list of them`);
                const type = Array.isArray(v) ? 'LIST_DATA_TYPE' : typeof v === 'boolean' ? 'BOOLEAN_DATA_TYPE'
                    : typeof v === 'string' ? 'STRING_DATA_TYPE' : Number.isInteger(v) ? 'INTEGER_DATA_TYPE' : 'REAL_DATA_TYPE';
                out.push(`__data(r, ${str(k)}, RuleDataType.${type}, ${json(v)});`);
            }
        }
        return out.join('\n');
    });
}

const RULE_HELPERS = `
var __rule = function (p, id) {
  var rs = p.preflightProfileRules;
  for (var i = 0; i < rs.length; i++) if (rs.item(i).id === id) return rs.item(i);
  var known = app.allPreflightRuleIDs, found = false;
  for (var j = 0; j < known.length; j++) if (known[j] === id) found = true;
  if (!found) throw new Error("Unknown preflight rule " + id + "; get_preflight_info with ruleCatalog: true lists them");
  return rs.add(id);
};
var __data = function (r, name, type, value) {
  var d = r.ruleDataObjects.itemByName(name);
  if (d.isValid) d.dataValue = value;
  else r.ruleDataObjects.add(name, type, value);
};
var __rules = function (p) {
  var out = [], rs = p.preflightProfileRules;
  for (var i = 0; i < rs.length; i++) {
    var r = rs.item(i), o = { id: r.id, name: r.name, flag: __enumName(r.flag), data: {} };
    for (var j = 0; j < r.ruleDataObjects.length; j++) {
      var d = r.ruleDataObjects.item(j);
      try { o.data[d.name] = d.dataValue; } catch (e) {}
    }
    out.push(o);
  }
  return out;
};
var __profile = function (doc, name, embedded) {
  var p = embedded ? doc.preflightProfiles.itemByName(name) : app.preflightProfiles.itemByName(name);
  if (!p.isValid) throw new Error("No " + (embedded ? "embedded " : "") + "preflight profile named " + name);
  return p;
};`;

const PRINT_EXCLUDE_TEXT = (list) => `Not for this tool: ${list.join(', ')}`;

export const tools = [
    {
        name: 'print_document',
        description: 'Print the active document, or write it to a PostScript file, with any Print dialog option: printer, PPD, copies, pages, paper and scaling, marks and bleed, composite or separations output, trapping, screening, graphics, colour management and advanced options; or only save those settings in the document (File > Print)',
        inputSchema: {
            type: 'object',
            properties: {
                preset: PRESET_SCHEMA,
                settings: optionsSchema(PRINT_FIELDS, 'Print dialog options; only the ones you pass change. Separations need colorOutput: SEPARATIONS; set ink plates and screens with set_separation_inks'),
                output: OUTPUT_SCHEMA,
                postscriptFile: POSTSCRIPT_SCHEMA,
            },
        },
        features: fx([
            'print', 'print_general_print_preset', 'print_general_printer', 'print_general_ppd', 'print_general_copies',
            'print_general_collate', 'print_general_reverse_order', 'print_general_pages_all_range', 'print_general_sequence',
            'print_general_spreads_print', 'print_general_print_parent_pages', 'print_general_print_layers',
            'print_general_print_non_printing_objects', 'print_general_print_blank_pages',
            'print_general_print_visible_guides_and_baseline_grids',
            'print_setup_paper_size', 'print_setup_orientation_print', 'print_setup_offset_gap_paper', 'print_setup_transverse',
            'print_setup_scale_width_height', 'print_setup_page_position', 'print_setup_thumbnails', 'print_setup_tile',
            'print_marks_all_printer_s_marks_print', 'print_marks_crop_marks_print', 'print_marks_bleed_marks_print',
            'print_marks_registration_marks_print', 'print_marks_color_bars_print', 'print_marks_page_information_print',
            'print_marks_type_print_marks', 'print_marks_weight_print_marks', 'print_marks_offset_print_marks',
            'print_marks_use_document_bleed_settings_print', 'print_marks_bleed_print', 'print_marks_include_slug_area_print',
            'print_output_color_output', 'print_output_text_as_black', 'print_output_trapping_print', 'print_output_flip',
            'print_output_negative', 'print_output_screening', 'print_output_inks_frequency_and_angle', 'print_output_print_plates',
            'print_output_simulate_overprint_print', 'print_output_composite_angle_and_frequency',
            'print_graphics_send_data_images', 'print_graphics_fonts_download', 'print_graphics_download_ppd_fonts',
            'print_graphics_postscript_level', 'print_graphics_data_format',
            'print_cm_print_document_proof', 'print_cm_color_handling', 'print_cm_printer_profile', 'print_cm_output_color_print',
            'print_cm_preserve_cmyk_numbers',
            'print_advanced_print_as_bitmap', 'print_advanced_opi_image_replacement', 'print_advanced_omit_for_opi',
            'print_advanced_transparency_flattener_preset_print', 'print_advanced_ignore_spread_overrides_print',
            'postscript_file', 'color_separations', 'composite_output', 'gradients_as_separations', 'ink_trapping',
            'mixed_page_size_printing', 'layers_to_print',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
        auditArgs: { preset: '[Default]', settings: { copies: 2, pageRange: '1-2', colorOutput: 'SEPARATIONS', paperWidth: 'AUTO', markLineWeight: 'P25PT' }, output: 'postscript_file', postscriptFile: `${process.env.HOME ?? '/tmp'}/Documents/audit.ps` },
        handler: (a) => {
            const { output, lines } = printSetup(a, 'pp', [], 'printing');
            if (output === 'settings_only' && !lines.length) throw new Error('Nothing to set: pass preset or settings');
            return run('Print document', script(`${HELPERS}
var pp = doc.printPreferences;
${lines.join('\n')}
${output === 'settings_only' ? '' : 'doc.print(false);'}
var __out = { output: "${output}", printer: null, pageRange: null };
try { __out.printer = typeof pp.printer === "string" ? pp.printer : __enumName(pp.printer); } catch (e1) {}
try { __out.pageRange = typeof pp.pageRange === "string" ? pp.pageRange : __enumName(pp.pageRange); } catch (e2) {}
try { __out.colorOutput = __enumName(pp.colorOutput); } catch (e3) {}
${output === 'postscript_file' ? 'try { __out.file = pp.printFile.fsName; } catch (e4) {}' : ''}
__result__ = __out;`));
        },
    },
    {
        name: 'get_print_settings',
        description: 'Read the active document\'s print settings (every Print dialog option), the printers, PPDs, paper sizes and screenings available, whether PDF pass-through is in use, and the saved print presets (File > Print; File > Print Presets)',
        inputSchema: {
            type: 'object',
            properties: {
                booklet: { type: 'boolean', description: 'Read the Print Booklet settings (booklet setup and its print settings) instead of the Print dialog\'s', default: false },
            },
        },
        features: fx(['print_advanced_pdf_pass_through', 'print_general_printer', 'print_general_ppd', 'print_setup_paper_size', 'print_output_screening', 'print_presets', 'print_booklet_print_settings']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const booklet = a.booklet === true;
            const spec = readSpec(PRINT_FIELDS, booklet ? NOT_IN_BOOKLET : []);
            return run('Get print settings', script(`${HELPERS}
var pp = ${booklet ? 'doc.printBookletPrintPreferences' : 'doc.printPreferences'};
var __out = { settings: __read(pp, ${spec}), presets: [] };
${booklet ? `__out.booklet = __read(doc.printBookletOptions, ${readSpec(BOOKLET_FIELDS)});` : ''}
try { var ap = pp.activePrinterPreset; __out.preset = (ap && ap.name) ? ap.name : __enumName(ap); } catch (e0) {}
try { __out.printers = pp.printerList; } catch (e1) {}
try { __out.ppds = pp.ppdList; } catch (e2) {}
try { __out.paperSizes = pp.paperSizeList; } catch (e3) {}
try { __out.screenings = pp.screeningList; } catch (e4) {}
try { __out.pdfPassthrough = pp.pdfPassthrough; } catch (e5) {}
try { __out.postscriptFile = pp.printFile ? pp.printFile.fsName : null; } catch (e6) {}
for (var i = 0; i < app.printerPresets.length; i++) __out.presets.push(app.printerPresets.item(i).name);
__result__ = __out;`));
        },
    },
    {
        name: 'manage_print_preset',
        description: 'Create, edit, rename, duplicate, delete or read print presets, optionally capturing the active document\'s current print settings (File > Print Presets > Define; File > Print > Save Preset)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'update', 'duplicate', 'delete', 'get'], description: 'What to do with the preset' },
                name: { type: 'string', description: 'The preset name (the new name for create; the existing preset otherwise)' },
                newName: { type: 'string', description: 'New name (update renames; duplicate names the copy, default "<name> copy")' },
                fromDocument: { type: 'boolean', description: 'Start from the active document\'s print settings (create and update), like Save Preset in the Print dialog', default: false },
                settings: optionsSchema(PRINT_FIELDS, `Print options to store in the preset; only the ones you pass change. ${PRINT_EXCLUDE_TEXT(NOT_IN_PRESET)}`, NOT_IN_PRESET),
            },
            required: ['action', 'name'],
        },
        features: fx(['print_presets', 'print_general_print_preset']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'create', name: 'Proof', newName: undefined, fromDocument: true, settings: { colorOutput: 'COMPOSITE_CMYK', cropMarks: true, printer: 'POSTSCRIPT_FILE' } },
        handler: (a) => {
            const action = enumOf(a.action, ['create', 'update', 'duplicate', 'delete', 'get'], { name: 'action' });
            const name = nameOf(a.name, 'name');
            const fromDocument = a.fromDocument === true;
            if (fromDocument && !['create', 'update'].includes(action)) throw new Error('fromDocument applies to create and update');
            const set = optionStatements('p', PRINT_FIELDS, a.settings, 'settings', { exclude: NOT_IN_PRESET, what: 'print presets' });
            if (set.length && !['create', 'update'].includes(action)) throw new Error('settings apply to create and update');
            if (a.newName !== undefined && !['update', 'duplicate'].includes(action)) throw new Error('newName applies to update and duplicate');
            if (action === 'update' && !set.length && !fromDocument && a.newName === undefined) throw new Error('Nothing to change: pass settings, fromDocument or newName');
            const spec = readSpec(PRINT_FIELDS, NOT_IN_PRESET);
            const clash = (n) => `if (app.printerPresets.itemByName(${str(n)}).isValid) throw new Error("A print preset named " + ${str(n)} + " already exists");`;
            const lines = [];
            if (action === 'create') lines.push(clash(name), `var p = app.printerPresets.add({ name: ${str(name)} });`);
            else lines.push(`var p = __preset(${str(name)});`);
            if (action === 'delete') lines.push('p.remove();', `__result__ = { action: "delete", name: ${str(name)} };`);
            else {
                if (action === 'duplicate') {
                    const copy = a.newName === undefined ? `${name} copy` : nameOf(a.newName, 'newName');
                    lines.push(clash(copy), 'p = p.duplicate();', `p.name = ${str(copy)};`);
                }
                if (fromDocument) lines.push(`var __refused = __copy(__doc().printPreferences, p, ${spec});`);
                lines.push(...set);
                if (action === 'update' && a.newName !== undefined) {
                    const nn = nameOf(a.newName, 'newName');
                    lines.push(clash(nn), `p.name = ${str(nn)};`);
                }
                lines.push(`__result__ = { action: "${action}", name: p.name, settings: __read(p, ${spec})${fromDocument ? ', notCopied: __refused' : ''} };`);
            }
            return run('Manage print preset', script(`${HELPERS}\n${lines.join('\n')}`, { needsDocument: false }));
        },
    },
    {
        name: 'print_booklet',
        description: 'Print the active document as a booklet (saddle stitch, perfect bound or consecutive printer spreads) with its booklet setup and print settings, to a printer or a PostScript file, or only save those settings (File > Print Booklet)',
        inputSchema: {
            type: 'object',
            properties: {
                booklet: optionsSchema(BOOKLET_FIELDS, 'Booklet setup; only the options you pass change'),
                preset: PRESET_SCHEMA,
                settings: optionsSchema(PRINT_FIELDS, `Print Settings of the booklet (Print Booklet > Print Settings); only the ones you pass change. ${PRINT_EXCLUDE_TEXT(NOT_IN_BOOKLET)}`, NOT_IN_BOOKLET),
                output: OUTPUT_SCHEMA,
                postscriptFile: POSTSCRIPT_SCHEMA,
            },
        },
        features: fx([
            'print_booklet', 'print_booklet_print_settings', 'booklet_booklet_type', 'booklet_space_between_pages',
            'booklet_bleed_between_pages', 'booklet_creep', 'booklet_signature_size',
            'booklet_automatically_adjust_to_fit_marks_and_bleeds', 'booklet_margins_booklet',
            'booklet_print_blank_printer_spreads', 'booklet_pages_booklet',
        ]),
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
        auditArgs: { booklet: { bookletType: 'TWO_UP_PERFECT_BOUND', signatureSize: 'SIGNATURE_SIZE_16', creep: 0.5, pageRange: 'ALL_PAGES', autoAdjustMargins: false, topMargin: 5 }, preset: '[Default]', settings: { cropMarks: true }, output: 'settings_only', postscriptFile: undefined },
        handler: (a) => {
            const book = optionStatements('bo', BOOKLET_FIELDS, a.booklet, 'booklet');
            const { output, lines } = printSetup(a, 'bp', NOT_IN_BOOKLET, 'booklet printing');
            if (output === 'settings_only' && !lines.length && !book.length) throw new Error('Nothing to set: pass booklet, preset or settings');
            return run('Print booklet', script(`${HELPERS}
var bo = doc.printBookletOptions, bp = doc.printBookletPrintPreferences;
${book.join('\n')}
${lines.join('\n')}
${output === 'settings_only' ? '' : 'doc.printBooklet(false);'}
__result__ = { output: "${output}", booklet: __read(bo, ${readSpec(BOOKLET_FIELDS)}) };`));
        },
    },
    {
        name: 'get_trap_presets',
        description: 'List trap presets with all their options, the pages each is assigned to, and which are unused (Window > Output > Trap Presets; panel menu > Select All Unused)',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', enum: ['document', 'application'], description: 'The active document\'s presets, or the application defaults used by new documents', default: 'document' },
            },
        },
        features: fx(['trap_presets_panel', 'trap_presets_menu_select_all_unused']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'document', ['document', 'application'], { name: 'scope' });
            const doc = scope === 'document';
            return run('Get trap presets', script(`${HELPERS}${TRAP_LIST}
var tps = ${doc ? 'doc' : 'app'}.trapPresets, use = ${doc ? '__trapUse(doc)' : '{}'}, out = [];
for (var i = 0; i < tps.length; i++) {
  var p = tps.item(i), o = { name: p.name, settings: __read(p, ${readSpec(TRAP_FIELDS)}) };
  ${doc ? 'o.pages = use[p.name] || []; o.unused = !o.pages.length && p.name.charAt(0) !== "[";' : ''}
  out.push(o);
}
__result__ = { scope: "${scope}", presets: out };`, { needsDocument: doc }));
        },
    },
    {
        name: 'manage_trap_preset',
        description: 'Create, edit, rename, duplicate or delete trap presets, load them from another InDesign document, or delete every unused one (Trap Presets panel menu: New Preset, Duplicate Preset, Delete Presets, Preset Options, Load Trap Presets, Select All Unused); assign presets to pages with set_page_properties',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'update', 'duplicate', 'delete', 'load', 'delete_unused'], description: 'What to do: load copies presets from fromFile; delete_unused deletes presets no page uses' },
                name: { type: 'string', description: 'The preset name (the new name for create; the existing preset for update, duplicate and delete)' },
                newName: { type: 'string', description: 'New name (update renames; duplicate names the copy, default "<name> copy")' },
                settings: optionsSchema(TRAP_FIELDS, 'Trap preset options (Preset Options dialog); only the ones you pass change'),
                replaceWith: { type: 'string', description: 'For delete and delete_unused: the preset pages using a deleted preset get instead', default: '[Default]' },
                fromFile: { type: 'string', description: 'For load: absolute path of an InDesign document or template (.indd, .indt) to load the trap presets of' },
                scope: { type: 'string', enum: ['document', 'application'], description: 'The active document\'s presets, or the application defaults used by new documents', default: 'document' },
            },
            required: ['action'],
        },
        features: fx([
            'trap_presets_panel', 'trap_presets_menu_new_preset', 'trap_presets_menu_duplicate_preset', 'trap_presets_menu_delete_presets',
            'trap_presets_menu_preset_options', 'trap_presets_menu_load_trap_presets', 'trap_presets_menu_select_all_unused',
            'trap_trap_width_default', 'trap_trap_width_black', 'trap_join_style_trap', 'trap_end_style_trap',
            'trap_images_trap_placement', 'trap_trap_objects_to_images', 'trap_trap_images_to_images', 'trap_trap_images_internally',
            'trap_trap_1_bit_images', 'trap_trap_thresholds_step', 'trap_black_color', 'trap_black_density', 'trap_sliding_trap',
            'trap_trap_color_reduction',
        ]),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'create', name: 'Press', newName: undefined, replaceWith: undefined, fromFile: undefined, settings: { defaultTrapWidth: 0.25, blackWidth: 0.5, trapJoin: 'ROUND_END_JOIN', imagePlacement: 'CHOKE', stepThreshold: 10, blackDensity: 1.6 } },
        handler: (a) => {
            const action = enumOf(a.action, ['create', 'update', 'duplicate', 'delete', 'load', 'delete_unused'], { name: 'action' });
            const scope = enumOf(a.scope ?? 'document', ['document', 'application'], { name: 'scope' });
            const coll = scope === 'document' ? 'doc.trapPresets' : 'app.trapPresets';
            const set = optionStatements('p', TRAP_FIELDS, a.settings, 'settings');
            if (set.length && !['create', 'update'].includes(action)) throw new Error('settings apply to create and update');
            if (a.newName !== undefined && !['update', 'duplicate'].includes(action)) throw new Error('newName applies to update and duplicate');
            if (a.fromFile !== undefined && action !== 'load') throw new Error('fromFile applies to load');
            if (a.replaceWith !== undefined && !['delete', 'delete_unused'].includes(action)) throw new Error('replaceWith applies to delete and delete_unused');
            const spec = readSpec(TRAP_FIELDS);
            const clash = (n) => `if (${coll}.itemByName(${str(n)}).isValid) throw new Error("A trap preset named " + ${str(n)} + " already exists");`;
            const find = (n) => `var p = ${coll}.itemByName(${str(n)});\nif (!p.isValid) throw new Error("No trap preset named " + ${str(n)});`;
            const replacement = `var __rep = ${coll}.itemByName(${str(nameOf(a.replaceWith ?? '[Default]', 'replaceWith'))});\nif (!__rep.isValid) throw new Error("No trap preset named " + ${str(a.replaceWith ?? '[Default]')} + " to replace with");`;
            let body;
            let needsDocument = scope === 'document';
            if (action === 'load') {
                if (scope !== 'document') throw new Error('load copies presets into the active document (scope: document)');
                const from = filePath(a.fromFile, 'fromFile', ['.indd', '.indt']);
                body = `var __f = new File(${from});
if (!__f.exists) throw new Error("File not found: " + __f.fsName);
var __src = null, __opened = false, loaded = [], skipped = [];
for (var d = 0; d < app.documents.length; d++) {
  try { if (app.documents[d].fullName.fsName === __f.fsName) __src = app.documents[d]; } catch (e0) {}
}
var __same = false;
try { __same = doc.fullName.fsName === __f.fsName; } catch (e1) {}
if (__same) throw new Error("That file is the active document");
if (!__src) { __src = app.open(__f, false); __opened = true; }
try {
  for (var i = 0; i < __src.trapPresets.length; i++) {
    var s = __src.trapPresets.item(i);
    if (s.name.charAt(0) === "[" || doc.trapPresets.itemByName(s.name).isValid) { skipped.push(s.name); continue; }
    var p = doc.trapPresets.add({ name: s.name });
    __copy(s, p, ${spec});
    loaded.push(s.name);
  }
} finally {
  if (__opened) __src.close(SaveOptions.NO);
}
__result__ = { action: "load", loaded: loaded, skipped: skipped };`;
            } else if (action === 'delete_unused') {
                if (scope !== 'document') throw new Error('delete_unused works on the active document (scope: document)');
                body = `${TRAP_LIST}
${replacement}
var use = __trapUse(doc), gone = [];
for (var i = doc.trapPresets.length - 1; i >= 0; i--) {
  var p = doc.trapPresets.item(i);
  if (p.name.charAt(0) === "[" || use[p.name]) continue;
  gone.push(p.name);
  p.remove(__rep);
}
__result__ = { action: "delete_unused", deleted: gone };`;
            } else {
                const name = nameOf(a.name, 'name');
                if (action === 'update' && !set.length && a.newName === undefined) throw new Error('Nothing to change: pass settings or newName');
                const lines = [];
                if (action === 'create') lines.push(clash(name), `var p = ${coll}.add({ name: ${str(name)} });`);
                else lines.push(find(name));
                if (action === 'delete') lines.push(replacement, 'p.remove(__rep);', `__result__ = { action: "delete", name: ${str(name)} };`);
                else {
                    if (action === 'duplicate') {
                        const copy = a.newName === undefined ? `${name} copy` : nameOf(a.newName, 'newName');
                        lines.push(clash(copy), 'p = p.duplicate();', `p.name = ${str(copy)};`);
                    }
                    lines.push(...set);
                    if (action === 'update' && a.newName !== undefined) {
                        const nn = nameOf(a.newName, 'newName');
                        lines.push(clash(nn), `p.name = ${str(nn)};`);
                    }
                    lines.push(`__result__ = { action: "${action}", name: p.name, settings: __read(p, ${spec}) };`);
                }
                body = lines.join('\n');
            }
            return run('Manage trap preset', script(`${HELPERS}\n${body}`, { needsDocument }));
        },
    },
    {
        name: 'get_preflight_info',
        description: 'Read preflight profiles (application and embedded in the document), one profile\'s rules with their settings, the preflight options, the catalog of rule ids, and the live preflight status of the document (Preflight panel; Define Profiles; Preflight Options; preflight status in the document window)',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'A profile to list the rules of, with each rule\'s flag and data values' },
                embedded: { type: 'boolean', description: 'The profile is the one embedded in the document rather than an application profile', default: false },
                ruleCatalog: { type: 'boolean', description: 'Also list every rule id and category preflight knows', default: false },
                status: { type: 'boolean', description: 'Also report the document\'s live preflight result: the profile in use and the problems found', default: true },
                maxResults: { type: 'integer', minimum: 1, maximum: 1000, description: 'Most problems to list in the status', default: 50 },
            },
        },
        features: fx(['preflight_profile', 'preflight_rules', 'preflight_menu_define_profiles', 'live_preflight', 'preflight_status']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const profile = a.profile === undefined ? null : nameOf(a.profile, 'profile');
            const max = Number(num(a.maxResults ?? 50, { min: 1, max: 1000, name: 'maxResults' }));
            const status = a.status !== false;
            return run('Get preflight info', script(`${RULE_HELPERS}
var __opts = function (po) {
  var o = { enabled: !po.preflightOff };
  try { var w = po.preflightWorkingProfile; o.workingProfile = typeof w === "string" ? w : w.name; } catch (e1) {}
  try { o.profilePolicy = __enumName(po.preflightProfilePolicy); } catch (e2) {}
  try { o.embedWorkingProfile = po.preflightEmbedWorkingProfile; } catch (e3) {}
  try { o.layers = __enumName(po.preflightWhichLayers); } catch (e4) {}
  try { o.includeObjectsOnPasteboard = po.preflightIncludeObjectsOnPasteboard; o.includeNonprintingObjects = po.preflightIncludeNonprintingObjects; } catch (e5) {}
  try { var sc = po.preflightScope; o.pages = typeof sc === "string" ? sc : __enumName(sc); } catch (e6) {}
  return o;
};
var __list = function (ps) { var out = []; for (var i = 0; i < ps.length; i++) out.push({ name: ps.item(i).name, description: ps.item(i).description }); return out; };
var doc = app.documents.length ? app.activeDocument : null;
var __opt = { application: __opts(app.preflightOptions) };
var __out = { profiles: __list(app.preflightProfiles), options: __opt };
if (doc) { __out.embeddedProfiles = __list(doc.preflightProfiles); __opt.document = __opts(doc.preflightOptions); }
${profile ? `__out.rules = __rules(${a.embedded === true ? `(function () { if (!doc) throw new Error("No document open"); return __profile(doc, ${str(profile)}, true); })()` : `__profile(null, ${str(profile)}, false)`});` : ''}
${a.ruleCatalog === true ? '__out.ruleIds = app.allPreflightRuleIDs; __out.ruleCategories = app.allPreflightRuleCategories;' : ''}
${status ? `if (doc) {
  var st = { enabled: !doc.preflightOptions.preflightOff, profile: null, problems: null, results: [] };
  try {
    var pr = doc.activeProcess;
    if (pr && pr.isValid) {
      pr.waitForProcess(10);
      var ag = pr.aggregatedResults;
      st.profile = ag[1];
      var res = ag[2] || [];
      st.problems = res.length;
      for (var i = 0; i < res.length && i < ${max}; i++) {
        var row = [];
        for (var j = 0; j < res[i].length; j++) row.push(String(res[i][j]));
        st.results.push(row);
      }
    }
  } catch (e7) { st.error = e7.message; }
  __out.status = st;
}` : ''}
__result__ = __out;`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_preflight_profile',
        description: 'Create, edit, duplicate or delete preflight profiles and their rules (flag each rule as error, warning or information, or disable it, and set its data values); load a profile from an .idpp file, export one, or embed or unembed it in the active document (Preflight panel menu > Define Profiles, Load Profile, Export Profile, Embed/Unembed Profile)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'update', 'duplicate', 'delete', 'load', 'export', 'embed', 'unembed'], description: 'What to do with the profile' },
                name: { type: 'string', description: 'The profile name (the new name for create; not needed for load)' },
                embedded: { type: 'boolean', description: 'Act on the profile embedded in the active document rather than the application profile (update, delete, export, unembed)', default: false },
                newName: { type: 'string', description: 'New name (update renames; duplicate names the copy, default "<name> copy")' },
                description: { type: 'string', description: 'Profile description (create, update)' },
                copyFrom: { type: 'string', description: 'Replace the profile\'s rules with those of this profile (create, update), e.g. "[Basic]"' },
                rules: {
                    type: 'array',
                    description: 'Rules to add or change (create, update); a rule not yet in the profile is added',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Rule id, e.g. ADBE_MissingFonts, ADBE_ImageResolution (get_preflight_info lists them)' },
                            flag: { type: 'string', enum: Object.keys(RULE_FLAGS), description: 'Report as error, warning or information, or disable the rule' },
                            data: { type: 'object', description: 'Rule data values by name, e.g. { "ADBE_minres_cgray": 250 } (the names a profile\'s rules list)' },
                        },
                        required: ['id'],
                    },
                },
                removeRules: { type: 'array', items: { type: 'string' }, description: 'Rule ids to remove from the profile (update)' },
                filePath: { type: 'string', description: 'Absolute .idpp path: the file to load (load) or write (export)' },
            },
            required: ['action'],
        },
        features: fx(['preflight_profile', 'preflight_rules', 'preflight_menu_define_profiles', 'preflight_menu_load_profile',
            'preflight_menu_embed_unembed_profile', 'preflight_menu_export_profile']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'update', name: 'Press', newName: 'Press 2', description: 'For press', copyFrom: '[Basic]', rules: [{ id: 'ADBE_ImageResolution', flag: 'error', data: { ADBE_minres_cgray: 250, ADBE_minres_cgray_on: true } }], removeRules: ['ADBE_BlankPages'], filePath: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['create', 'update', 'duplicate', 'delete', 'load', 'export', 'embed', 'unembed'], { name: 'action' });
            const editing = ['create', 'update'].includes(action);
            for (const k of ['description', 'copyFrom', 'rules']) if (a[k] !== undefined && !editing) throw new Error(`${k} applies to create and update`);
            if (a.removeRules !== undefined && action !== 'update') throw new Error('removeRules applies to update');
            if (a.newName !== undefined && !['update', 'duplicate'].includes(action)) throw new Error('newName applies to update and duplicate');
            if (a.filePath !== undefined && !['load', 'export'].includes(action)) throw new Error('filePath applies to load and export');
            const embedded = a.embedded === true;
            if (embedded && !['update', 'delete', 'export', 'unembed'].includes(action)) throw new Error('embedded applies to update, delete, export and unembed');
            const inDoc = embedded || action === 'unembed';
            const clash = (n) => `if (app.preflightProfiles.itemByName(${str(n)}).isValid) throw new Error("A preflight profile named " + ${str(n)} + " already exists");`;
            const lines = [];
            let needsDocument = inDoc || action === 'embed';
            if (action === 'load') {
                const file = filePath(a.filePath, 'filePath', ['.idpp']);
                lines.push(`var __f = new File(${file});`, 'if (!__f.exists) throw new Error("File not found: " + __f.fsName);',
                    'var p = app.loadPreflightProfile(__f);', '__result__ = { action: "load", name: p.name };');
            } else {
                const name = nameOf(a.name, 'name');
                const doc = needsDocument ? 'doc' : 'null';
                if (action === 'create') lines.push(clash(name), `var p = app.preflightProfiles.add({ name: ${str(name)} });`);
                else lines.push(`var p = __profile(${doc}, ${str(name)}, ${bool(inDoc)});`);
                if (action === 'delete') lines.push('p.remove();', `__result__ = { action: "delete", name: ${str(name)} };`);
                else if (action === 'export') lines.push(`p.save(new File(${filePath(a.filePath, 'filePath', ['.idpp'])}));`, `__result__ = { action: "export", name: p.name, file: ${filePath(a.filePath, 'filePath', ['.idpp'])} };`);
                else if (action === 'embed') lines.push('var e = doc.embed(p);', '__result__ = { action: "embed", name: e.name };');
                else if (action === 'unembed') lines.push('p.unembed();', `__result__ = { action: "unembed", name: ${str(name)} };`);
                else {
                    if (action === 'duplicate') {
                        const copy = a.newName === undefined ? `${name} copy` : nameOf(a.newName, 'newName');
                        lines.push(clash(copy), 'p = p.duplicate();', `p.name = ${str(copy)};`);
                    }
                    if (a.copyFrom !== undefined) lines.push(`p.update(__profile(null, ${str(nameOf(a.copyFrom, 'copyFrom'))}, false));`);
                    if (a.description !== undefined) {
                        if (typeof a.description !== 'string' || a.description.length > 2000) throw new Error("'description' must be a string up to 2000 characters");
                        lines.push(`p.description = ${str(a.description)};`);
                    }
                    lines.push(...ruleStatements(a.rules));
                    if (a.removeRules !== undefined) {
                        if (!Array.isArray(a.removeRules)) throw new Error("'removeRules' must be a list of rule ids");
                        for (const id of a.removeRules) {
                            if (typeof id !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(id)) throw new Error(`'removeRules': bad rule id ${JSON.stringify(id)}`);
                            lines.push(`(function () { var rs = p.preflightProfileRules; for (var i = rs.length - 1; i >= 0; i--) if (rs.item(i).id === ${str(id)}) rs.item(i).remove(); })();`);
                        }
                    }
                    if (action === 'update' && a.newName !== undefined) {
                        const nn = nameOf(a.newName, 'newName');
                        if (!inDoc) lines.push(clash(nn));
                        lines.push(`p.name = ${str(nn)};`);
                    }
                    if (action === 'update' && lines.length === 1) throw new Error('Nothing to change: pass newName, description, copyFrom, rules or removeRules');
                    lines.push(`__result__ = { action: "${action}", name: p.name, description: p.description, rules: __rules(p) };`);
                }
            }
            return run('Manage preflight profile', script(`${RULE_HELPERS}\n${lines.join('\n')}`, { needsDocument }));
        },
    },
    {
        name: 'set_preflight_options',
        description: 'Turn live preflight on or off for the active document or for all documents, choose the working profile and how embedded profiles are used, which layers, pasteboard objects, nonprinting objects and pages are checked, and how many rows per error the Preflight panel lists (Preflight panel menu > Preflight Options, Enable Preflight for All Documents, Limit Rows per Error; preflight status menu)',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', enum: ['document', 'application'], description: 'The active document\'s options, or the application\'s (defaults for all documents; enabled here is Enable Preflight for All Documents)', default: 'document' },
                enabled: { type: 'boolean', description: 'Turn live preflight on (true) or off (false) (Preflight panel: On)' },
                workingProfile: { type: 'string', description: 'The profile to preflight with (Working Profile); for a document, its embedded profile is found first' },
                pages: { type: 'string', description: 'Pages to preflight: "all", or a range such as "1-4, 7" (Preflight panel: Pages)' },
                ...optionsSchema(PREFLIGHT_FIELDS, '').properties,
                panelRowsPerError: { type: 'string', enum: Object.keys(ROWS_PER_ERROR), description: 'How many rows the Preflight panel lists per error (Limit Rows per Error); opens the Preflight panel' },
            },
        },
        features: fx(['preflight_menu_preflight_options', 'preflight_menu_enable_preflight_for_all_documents', 'preflight_menu_limit_rows_per_error',
            'preflight_opt_working_profile', 'preflight_opt_use_embedded_profile_use_working_profile', 'preflight_opt_embed_working_profile_into_new_documents',
            'preflight_opt_layers_preflight', 'preflight_opt_objects_on_pasteboard', 'preflight_opt_non_printing_objects_preflight',
            'preflight_opt_scope_preflight', 'live_preflight', 'preflight_status']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const scope = enumOf(a.scope ?? 'document', ['document', 'application'], { name: 'scope' });
            const po = scope === 'document' ? 'doc.preflightOptions' : 'app.preflightOptions';
            const own = {};
            for (const k of Object.keys(PREFLIGHT_FIELDS)) if (a[k] !== undefined) own[k] = a[k];
            const lines = optionStatements('po', PREFLIGHT_FIELDS, own, '');
            if (a.enabled !== undefined) {
                if (typeof a.enabled !== 'boolean') throw new Error("'enabled' must be true or false");
                lines.push(`po.preflightOff = ${bool(!a.enabled)};`);
            }
            if (a.workingProfile !== undefined) {
                const n = str(nameOf(a.workingProfile, 'workingProfile'));
                lines.push(scope === 'document'
                    ? `var __w = doc.preflightProfiles.itemByName(${n}); if (!__w.isValid) __w = app.preflightProfiles.itemByName(${n});`
                    : `var __w = app.preflightProfiles.itemByName(${n});`,
                `if (!__w.isValid) throw new Error("No preflight profile named " + ${n});`, 'po.preflightWorkingProfile = __w;');
            }
            if (a.pages !== undefined) {
                if (typeof a.pages !== 'string' || !a.pages.trim() || a.pages.length > 200) throw new Error("'pages' must be \"all\" or a page range");
                lines.push(`po.preflightScope = ${a.pages === 'all' ? 'PreflightScopeOptions.PREFLIGHT_ALL_PAGES' : str(a.pages)};`);
            }
            if (a.panelRowsPerError !== undefined) {
                const id = ROWS_PER_ERROR[enumOf(a.panelRowsPerError, Object.keys(ROWS_PER_ERROR), { name: 'panelRowsPerError' })];
                lines.push(`if (!__action(${PREFLIGHT_PANEL}, "Window > Output > Preflight").checked) __menu(${PREFLIGHT_PANEL}, "Window > Output > Preflight");`,
                    `__menu(${id}, "Preflight panel menu > Limit Rows per Error");`);
            }
            if (!lines.length) throw new Error('Nothing to set');
            return run('Set preflight options', script(`${HELPERS}
var po = ${po};
${lines.join('\n')}
var __w2 = null;
try { var w = po.preflightWorkingProfile; __w2 = typeof w === "string" ? w : w.name; } catch (e) {}
__result__ = { scope: "${scope}", enabled: !po.preflightOff, workingProfile: __w2, profilePolicy: __enumName(po.preflightProfilePolicy), layers: __enumName(po.preflightWhichLayers) };`,
            { needsDocument: scope === 'document' }));
        },
    },
    {
        name: 'get_inks',
        description: 'List the active document\'s inks as the Ink Manager shows them: process or spot, alias, ink type, neutral density, trapping sequence, whether each prints and converts to process, screen frequency and angle, and whether standard Lab values are used for spots (Swatches panel menu > Ink Manager)',
        inputSchema: { type: 'object', properties: {} },
        features: fx(['ink_manager', 'separations_preview_menu_ink_manager']),
        hints: { readOnly: true, idempotent: true },
        handler: () => run('Get inks', script(`${INK_LIST}
__result__ = { inks: __inks(doc), useStandardLabValuesForSpots: doc.accurateLABSpots };`)),
    },
    {
        name: 'set_separation_inks',
        description: 'Set inks for separations as the Ink Manager does: alias a spot ink to another ink, set ink type, neutral density and trapping sequence, convert spot inks (or all of them) to process, use standard Lab values for spots, and choose which ink plates print with their screen frequency and angle (Ink Manager; Print > Output > Inks)',
        inputSchema: {
            type: 'object',
            properties: {
                inks: {
                    type: 'array',
                    description: 'Settings per ink; only the options you pass change',
                    items: { ...optionsSchema(INK_FIELDS, 'One ink'), properties: { name: { type: 'string', description: 'Ink name, e.g. "Process Cyan" or a spot colour (get_inks lists them)' }, ...optionsSchema(INK_FIELDS, '').properties }, required: ['name'] },
                },
                allSpotsToProcess: { type: 'boolean', description: 'Convert every spot ink to process (true) or back to spot (false) (All Spots to Process)' },
                useStandardLabValuesForSpots: { type: 'boolean', description: 'Use Lab values for spot colours (Use Standard Lab Values for Spots)' },
            },
        },
        features: fx(['ink_manager', 'separations_preview_menu_ink_manager', 'ink_all_spots_to_process', 'ink_ink_alias', 'ink_ink_type',
            'ink_neutral_density', 'ink_trapping_sequence', 'ink_use_standard_lab_values_for_spots', 'ink_print_ink']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { inks: [{ name: 'PANTONE 185 C', alias: 'Process Magenta', type: 'OPAQUE', neutralDensity: 0.8, trapOrder: 5, print: true, frequency: 150, angle: 45 }], allSpotsToProcess: false, useStandardLabValuesForSpots: true },
        handler: (a) => {
            const lines = [];
            if (a.useStandardLabValuesForSpots !== undefined) {
                if (typeof a.useStandardLabValuesForSpots !== 'boolean') throw new Error("'useStandardLabValuesForSpots' must be true or false");
                lines.push(`doc.accurateLABSpots = ${bool(a.useStandardLabValuesForSpots)};`);
            }
            if (a.allSpotsToProcess !== undefined) {
                if (typeof a.allSpotsToProcess !== 'boolean') throw new Error("'allSpotsToProcess' must be true or false");
                lines.push(`for (var __i = 0; __i < doc.inks.length; __i++) { var __k = doc.inks.item(__i); if (!__k.isProcessInk) __k.convertToProcess = ${bool(a.allSpotsToProcess)}; }`);
            }
            if (a.inks !== undefined) {
                if (!Array.isArray(a.inks) || !a.inks.length) throw new Error("'inks' must be a non-empty list");
                a.inks.forEach((ink, i) => {
                    if (!ink || typeof ink !== 'object') throw new Error(`'inks[${i}]' must be an object`);
                    const { name, ...rest } = ink;
                    const n = str(nameOf(name, `inks[${i}].name`));
                    const set = optionStatements('k', INK_FIELDS, rest, `inks[${i}]`);
                    if (!set.length) throw new Error(`'inks[${i}]': nothing to set`);
                    if (rest.alias !== undefined) set.unshift(`if (!doc.inks.itemByName(${str(rest.alias)}).isValid) throw new Error("No ink named " + ${str(rest.alias)} + " to alias to");`);
                    lines.push(`var k = doc.inks.itemByName(${n});\nif (!k.isValid) throw new Error("No ink named " + ${n});\n${set.join('\n')}`);
                });
            }
            if (!lines.length) throw new Error('Nothing to set: pass inks, allSpotsToProcess or useStandardLabValuesForSpots');
            return run('Set inks', script(`${INK_LIST}
${lines.join('\n')}
__result__ = { inks: __inks(doc), useStandardLabValuesForSpots: doc.accurateLABSpots };`));
        },
    },
    {
        name: 'set_output_preview',
        description: 'Preview output on screen: turn Overprint Preview on or off, open the Separations Preview or Flattener Preview panel, show all plates or a single cyan, magenta, yellow, black or spot plate, and show single plates in black or desaturate black (View > Overprint Preview; Window > Output > Separations Preview and its panel menu; Window > Output > Flattener Preview)',
        inputSchema: {
            type: 'object',
            properties: {
                overprintPreview: { type: 'boolean', description: 'Simulate overprinting in the document window (View > Overprint Preview)' },
                separationsPanel: { type: 'boolean', description: 'Open (true) or close (false) the Separations Preview panel' },
                flattenerPanel: { type: 'boolean', description: 'Open (true) or close (false) the Flattener Preview panel, which highlights areas transparency flattening affects' },
                plate: { type: 'string', enum: Object.keys(PLATES), description: 'Show every plate, or one plate alone (spot_1 is the first spot ink)' },
                singlePlatesInBlack: { type: 'boolean', description: 'Show single plates in black rather than their ink colour (Show Single Plates in Black)' },
                desaturateBlack: { type: 'boolean', description: 'Show black as dark grey to tell rich black from plain black (Desaturate Black)' },
            },
        },
        features: fx(['overprint_preview', 'separations_preview', 'show_all_plates', 'separations_plates_shortcuts',
            'separations_preview_menu_show_single_plates_in_black', 'separations_preview_menu_desaturate_black', 'flattener_preview']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const lines = [];
            const on = (k) => {
                if (a[k] === undefined) return null;
                if (typeof a[k] !== 'boolean') throw new Error(`'${k}' must be true or false`);
                return bool(a[k]);
            };
            if (on('overprintPreview')) lines.push(`if (!doc.layoutWindows.length) throw new Error("The document has no layout window");\ndoc.layoutWindows.item(0).overprintPreview = ${on('overprintPreview')};\n__out.overprintPreview = doc.layoutWindows.item(0).overprintPreview;`);
            if (on('separationsPanel')) lines.push(`__out.separationsPanel = __toggle(71937, "Window > Output > Separations Preview", ${on('separationsPanel')});`);
            if (on('flattenerPanel')) lines.push(`__out.flattenerPanel = __toggle(71946, "Window > Output > Flattener Preview", ${on('flattenerPanel')});`);
            if (on('singlePlatesInBlack')) lines.push(`__out.singlePlatesInBlack = __toggle(71942, "Separations Preview > Show Single Plates in Black", ${on('singlePlatesInBlack')});`);
            if (on('desaturateBlack')) lines.push(`__out.desaturateBlack = __toggle(71940, "Separations Preview > Desaturate Black", ${on('desaturateBlack')});`);
            if (a.plate !== undefined) {
                const p = enumOf(a.plate, Object.keys(PLATES), { name: 'plate' });
                lines.push(`__menu(${PLATES[p]}, "Show ${p.replace('_', ' ')} plate");`, `__out.plate = "${p}";`);
            }
            if (!lines.length) throw new Error('Nothing to set');
            return run('Set output preview', script(`${HELPERS}
var __out = {};
${lines.join('\n')}
__result__ = __out;`));
        },
    },
    {
        name: 'set_print_attributes',
        description: 'Set how objects and text print: overprint fill, stroke and gap and Nonprinting on items (Window > Output > Attributes), overprint on text fill and stroke and on paragraph rules, overprint of footnote rules, the [Black] overprint preference, and which layers print (Layer Options > Print Layer)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `Items to set item attributes on. ${TARGET_SCHEMA.description}` },
                items: {
                    type: 'object',
                    description: 'Attributes panel settings for the target items',
                    properties: {
                        overprintFill: { type: 'boolean', description: 'Overprint Fill' },
                        overprintStroke: { type: 'boolean', description: 'Overprint Stroke' },
                        overprintGap: { type: 'boolean', description: 'Overprint Gap (of dashed, dotted or striped strokes)' },
                        nonprinting: { type: 'boolean', description: 'Nonprinting: the item shows on screen but does not print or export' },
                    },
                },
                text: { ...TEXT_TARGET_SCHEMA, description: `Text to set text overprint on. ${TEXT_TARGET_SCHEMA.description}` },
                textOverprint: {
                    type: 'object',
                    description: 'Overprint settings for the chosen text',
                    properties: {
                        fill: { type: 'boolean', description: 'Overprint the characters\' fill (Attributes > Overprint Fill)' },
                        stroke: { type: 'boolean', description: 'Overprint the characters\' stroke (Attributes > Overprint Stroke)' },
                        ruleAbove: { type: 'boolean', description: 'Overprint the paragraph rule above (Paragraph Rules > Overprint Stroke)' },
                        ruleAboveGap: { type: 'boolean', description: 'Overprint the gap of the rule above (Paragraph Rules > Overprint Gap)' },
                        ruleBelow: { type: 'boolean', description: 'Overprint the paragraph rule below' },
                        ruleBelowGap: { type: 'boolean', description: 'Overprint the gap of the rule below' },
                    },
                },
                footnoteRules: {
                    type: 'object',
                    description: 'Overprint of the footnote separator rules (Type > Document Footnote Options > Layout)',
                    properties: {
                        rule: { type: 'boolean', description: 'Overprint the rule above the first footnote in a column' },
                        ruleGap: { type: 'boolean', description: 'Overprint the gap of that rule' },
                        continuingRule: { type: 'boolean', description: 'Overprint the rule above continued footnotes' },
                        continuingRuleGap: { type: 'boolean', description: 'Overprint the gap of the continued footnotes rule' },
                    },
                },
                overprintBlack: { type: 'boolean', description: 'Overprint the [Black] swatch at 100% (Preferences > Appearance of Black > Overprint [Black] Swatch at 100%)' },
                layers: {
                    type: 'array',
                    description: 'Layers to make printable or not (Layer Options > Print Layer)',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Layer name' },
                            printable: { type: 'boolean', description: 'Whether the layer prints' },
                        },
                        required: ['name', 'printable'],
                    },
                },
            },
        },
        features: fx(['overprint_fill_stroke', 'overprint_rules', 'about_overprinting', 'overprint_black', 'object_printing_options', 'layers_to_print']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            target: { ids: [5] }, items: { overprintFill: true, overprintStroke: false, overprintGap: false, nonprinting: false },
            text: { frameIds: [6] }, textOverprint: { fill: true, stroke: false, ruleAbove: true, ruleAboveGap: false, ruleBelow: true, ruleBelowGap: false },
            footnoteRules: { rule: true, ruleGap: false, continuingRule: true, continuingRuleGap: false },
            overprintBlack: true, layers: [{ name: 'Notes', printable: false }],
        },
        handler: (a) => {
            const lines = [];
            const flags = (obj, input, map, prefix) => {
                if (input === undefined) return [];
                if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`'${prefix}' must be an object`);
                return Object.entries(input).map(([k, v]) => {
                    if (!(k in map)) throw new Error(`Unknown option '${prefix}.${k}'`);
                    if (typeof v !== 'boolean') throw new Error(`'${prefix}.${k}' must be true or false`);
                    return `try { ${obj}.${map[k]} = ${bool(v)}; } catch (e) { throw new Error(${str(`${prefix}.${k}: `)} + e.message); }`;
                });
            };
            const itemSet = flags('it', a.items, { overprintFill: 'overprintFill', overprintStroke: 'overprintStroke', overprintGap: 'overprintGap', nonprinting: 'nonprinting' }, 'items');
            if (itemSet.length) {
                lines.push(`var __its = __targets(doc, ${targetSpec(a.target)});`,
                    `for (var __i = 0; __i < __its.length; __i++) { var it = __its[__i];\n${itemSet.join('\n')}\n}`, '__out.items = __its.length;');
            } else if (a.target !== undefined) throw new Error("target needs items: the attributes to set");
            const textSet = flags('t', a.textOverprint, { fill: 'overprintFill', stroke: 'overprintStroke', ruleAbove: 'ruleAboveOverprint', ruleAboveGap: 'ruleAboveGapOverprint', ruleBelow: 'ruleBelowOverprint', ruleBelowGap: 'ruleBelowGapOverprint' }, 'textOverprint');
            if (textSet.length) {
                lines.push(TEXT_HELPERS, `var __tx = __texts(doc, ${textSpec(a.text)}, false);`,
                    `for (var __j = 0; __j < __tx.length; __j++) { var t = __tx[__j].unit;\n${textSet.join('\n')}\n}`, '__out.texts = __tx.length;');
            } else if (a.text !== undefined) throw new Error("text needs textOverprint: the overprint settings to set");
            const fn = flags('fo', a.footnoteRules, { rule: 'ruleOverprint', ruleGap: 'ruleGapOverprint', continuingRule: 'continuingRuleOverprint', continuingRuleGap: 'continuingRuleGapOverprint' }, 'footnoteRules');
            if (fn.length) lines.push('var fo = doc.footnoteOptions;', ...fn, '__out.footnoteRules = true;');
            if (a.overprintBlack !== undefined) {
                if (typeof a.overprintBlack !== 'boolean') throw new Error("'overprintBlack' must be true or false");
                lines.push(`doc.documentPreferences.overprintBlack = ${bool(a.overprintBlack)};`, '__out.overprintBlack = doc.documentPreferences.overprintBlack;');
            }
            if (a.layers !== undefined) {
                if (!Array.isArray(a.layers) || !a.layers.length) throw new Error("'layers' must be a non-empty list");
                a.layers.forEach((l, i) => {
                    if (!l || typeof l !== 'object') throw new Error(`'layers[${i}]' must be an object`);
                    const n = str(nameOf(l.name, `layers[${i}].name`));
                    if (typeof l.printable !== 'boolean') throw new Error(`'layers[${i}].printable' must be true or false`);
                    lines.push(`var __l = doc.layers.itemByName(${n});\nif (!__l.isValid) throw new Error("No layer named " + ${n});\n__l.printable = ${bool(l.printable)};\n__out.layers.push({ name: __l.name, printable: __l.printable });`);
                });
            }
            if (!lines.length) throw new Error('Nothing to set');
            return run('Set print attributes', script(`var __out = { layers: [] };\n${lines.join('\n')}\n__result__ = __out;`));
        },
    },
    {
        name: 'get_package_report',
        description: 'Report what packaging the active document involves, as the Package dialog does: a summary with problems flagged, fonts and their status, links and images with status, colour space and resolution, colours and inks, and the print settings (File > Package: Summary, Fonts, Links and Images, Colors and Inks, Print Settings, Report)',
        inputSchema: {
            type: 'object',
            properties: {
                maxItems: { type: 'integer', minimum: 1, maximum: 5000, description: 'Most fonts and links to list', default: 500 },
            },
        },
        features: fx(['package_summary_package', 'package_fonts_package', 'package_links_and_images_package', 'package_colors_and_inks_package',
            'package_print_settings_package', 'package_view_report']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const max = Number(num(a.maxItems ?? 500, { min: 1, max: 5000, name: 'maxItems' }));
            return run('Get package report', script(`${HELPERS}${INK_LIST}
var fonts = [], links = [], s = { fonts: doc.fonts.length, missingFonts: 0, substitutedFonts: 0, fauxedFonts: 0, restrictedFonts: 0,
  links: doc.links.length, missingLinks: 0, modifiedLinks: 0, inaccessibleLinks: 0, embeddedLinks: 0, rgbImages: 0, inks: doc.inks.length, spotInks: 0 };
for (var i = 0; i < doc.fonts.length; i++) {
  var f = doc.fonts.item(i), fs = __enumName(f.status), fo = { name: f.name, status: fs };
  try { fo.type = __enumName(f.fontType); } catch (e1) {}
  try { fo.allowPrinting = f.allowPrinting; fo.allowOutlines = f.allowOutlines; } catch (e2) {}
  try { fo.location = f.location; } catch (e3) {}
  if (fs === "NOT_AVAILABLE") s.missingFonts++;
  if (fs === "SUBSTITUTED") s.substitutedFonts++;
  if (fs === "FAUXED") s.fauxedFonts++;
  try { if (!f.allowPrinting || f.restrictedPrinting) s.restrictedFonts++; } catch (e4) {}
  if (fonts.length < ${max}) fonts.push(fo);
}
for (var j = 0; j < doc.links.length; j++) {
  var l = doc.links.item(j), ls = __enumName(l.status), lo = { name: l.name, status: ls, type: l.linkType, path: l.filePath };
  if (ls === "LINK_MISSING") s.missingLinks++;
  if (ls === "LINK_OUT_OF_DATE") s.modifiedLinks++;
  if (ls === "LINK_INACCESSIBLE") s.inaccessibleLinks++;
  if (ls === "LINK_EMBEDDED") s.embeddedLinks++;
  try { var g = l.parent; lo.colorSpace = g.space; lo.actualPpi = g.actualPpi; lo.effectivePpi = g.effectivePpi; if (g.space === "RGB") s.rgbImages++; } catch (e5) {}
  try { var pg = l.parent.parent.parentPage; lo.page = pg ? pg.name : null; } catch (e6) {}
  if (links.length < ${max}) links.push(lo);
}
var inks = __inks(doc);
for (var k = 0; k < inks.length; k++) if (!inks[k].process) s.spotInks++;
var pp = doc.printPreferences, ps = __read(pp, ${readSpec(PRINT_FIELDS)});
try { ps.pdfPassthrough = pp.pdfPassthrough; } catch (e7) {}
s.problems = s.missingFonts + s.substitutedFonts + s.missingLinks + s.modifiedLinks + s.inaccessibleLinks;
__result__ = { document: doc.name, saved: doc.saved, modified: doc.modified, summary: s, fonts: fonts, links: links, inks: inks, printSettings: ps };`));
        },
    },
    {
        name: 'package_document_for_print',
        description: 'Package the active document with every Package option: copy fonts, linked graphics and colour profiles, update links, use document hyphenation exceptions only, include hidden-layer content, IDML and PDF (with a PDF preset), write the report, and continue despite preflight errors (File > Package > Package)',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: 'Absolute path of the package folder (created if missing)' },
                copyFonts: { type: 'boolean', description: 'Copy Fonts', default: true },
                copyLinkedGraphics: { type: 'boolean', description: 'Copy Linked Graphics', default: true },
                copyProfiles: { type: 'boolean', description: 'Copy colour profiles', default: true },
                updateGraphicLinks: { type: 'boolean', description: 'Update Graphic Links In Package', default: true },
                useDocumentHyphenationExceptionsOnly: { type: 'boolean', description: 'Use Document Hyphenation Exceptions Only: the packaged document does not compose with the user dictionary', default: false },
                includeHiddenLayers: { type: 'boolean', description: 'Include Fonts and Links From Hidden and Non-Printing Content', default: false },
                includeIdml: { type: 'boolean', description: 'Include IDML', default: false },
                includePdf: { type: 'boolean', description: 'Include PDF (Print)', default: false },
                pdfPreset: { type: 'string', description: 'PDF preset for the included PDF (Select PDF Preset)', default: '[High Quality Print]' },
                createReport: { type: 'boolean', description: 'Write the package report (the Instructions text file)', default: true },
                ignorePreflightErrors: { type: 'boolean', description: 'Package even when preflight reports errors', default: false },
                versionComments: { type: 'string', description: 'Comments saved with the document if packaging saves it', default: '' },
                forceSave: { type: 'boolean', description: 'Save the document first if it has unsaved changes', default: false },
            },
            required: ['outputPath'],
        },
        features: fx(['package_use_document_hyphenation_exceptions_only', 'package', 'package_copy_fonts', 'package_copy_linked_graphics',
            'package_update_graphic_links_in_package', 'package_include_fonts_and_links_from_hidden_and_non_printing_content',
            'package_include_idml', 'package_include_pdf_print', 'package_select_pdf_preset_package']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { outputPath: `${process.env.HOME ?? '/tmp'}/Documents/package`, useDocumentHyphenationExceptionsOnly: true, includePdf: true },
        handler: (a) => {
            const folder = filePath(a.outputPath, 'outputPath');
            const b = (k, d) => {
                const v = a[k] ?? d;
                if (typeof v !== 'boolean') throw new Error(`'${k}' must be true or false`);
                return bool(v);
            };
            const preset = nameOf(a.pdfPreset ?? '[High Quality Print]', 'pdfPreset');
            const comments = a.versionComments ?? '';
            if (typeof comments !== 'string' || comments.length > 2000) throw new Error("'versionComments' must be a string up to 2000 characters");
            const args = [b('copyFonts', true), b('copyLinkedGraphics', true), b('copyProfiles', true), b('updateGraphicLinks', true),
                b('includeHiddenLayers', false), b('ignorePreflightErrors', false), b('createReport', true), b('includeIdml', false),
                b('includePdf', false), str(preset), b('useDocumentHyphenationExceptionsOnly', false), str(comments), b('forceSave', false)];
            return run('Package document', script(`var __f = Folder(${folder});
if (!__f.exists && !__f.create()) throw new Error("Could not create " + __f.fsName);
if (!doc.saved && !${args[12]}) throw new Error("Save the document first, or pass forceSave: true");
var ok = doc.packageForPrint(__f, ${args.join(', ')});
if (!ok) throw new Error("InDesign did not package the document (check preflight errors, or pass ignorePreflightErrors: true)");
__result__ = { packaged: true, folder: __f.fsName };`));
        },
    },
];
