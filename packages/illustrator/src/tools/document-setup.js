/**
 * Document commands beyond create, open, save and close: templates, Save a
 * Copy, revert, close all, new-document presets, Document Setup, open options,
 * file info (XMP), the clipboard, and switching between open documents.
 *
 * Document Setup itself is a modal dialog. set_document_setup sets what the
 * object model reaches (artboard ruler origin, large canvas) and the colour
 * mode, whose File > Document Color Mode commands run without a dialog.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

const COLOR_MODES = { CMYK: 'doc-color-cmyk', RGB: 'doc-color-rgb' };
const UNITS = { points: 'Points', picas: 'Picas', inches: 'Inches', millimeters: 'Millimeters', centimeters: 'Centimeters', pixels: 'Pixels', qs: 'Qs' };
const RASTER = { screen: 'ScreenResolution', medium: 'MediumResolution', high: 'HighResolution' };
const PREVIEW = { default: 'DefaultPreview', pixel: 'PixelPreview', overprint: 'OverprintPreview' };
const GRIDS = {
    none: 'TransparencyGridNone', light: 'TransparencyGridLight', medium: 'TransparencyGridMedium', dark: 'TransparencyGridDark',
    red: 'TransparencyGridRed', orange: 'TransparencyGridOrange', green: 'TransparencyGridGreen', blue: 'TransparencyGridBlue', purple: 'TransparencyGridPurple',
};
const LIBRARIES = { document: 'ILLUSTRATORARTWORK', swatches: 'SWATCHES', brushes: 'BRUSHES', symbols: 'SYMBOLS', graphic_styles: 'GRAPHICSTYLES' };
const OPEN_OPTIONS = {
    updateLegacyText: 'updateLegacyText',
    updateLegacyGradientMesh: 'updateLegacyGradientMesh',
    preserveLegacyArtboard: 'preserveLegacyArtboard',
    convertCropAreaToArtboard: 'convertCropAreaToArtboard',
    convertTilesToArtboards: 'convertTilesToArtboard',
    createArtboardFromArtworkBounds: 'createArtboardWithArtworkBoundingBox',
    addToRecentFiles: 'addToRecentFiles',
};
const PASTES = {
    paste: null,
    paste_in_place: 'pasteInPlace',
    paste_on_all_artboards: 'pasteInAllArtboard',
    paste_without_formatting: 'pasteWithoutFormatting',
};
const CLIPBOARD = ['cut', 'copy', ...Object.keys(PASTES)];
const DIRECTIONS = {
    next: 'navigateToNextDocument',
    previous: 'navigateToPreviousDocument',
    next_group: 'navigateToNextDocumentGroup',
    previous_group: 'navigateToPreviousDocumentGroup',
};

/** ES3: the document's file, or null when it has never been saved. */
const FILE_FN = `
function __file(d) {
  try { return d.fullName && d.fullName.exists ? d.fullName : null; } catch (e) { return null; }
}
function __enumName(v) { return String(v).replace(/^.*\\./, ""); }`;

// File info: Dublin Core fields as XMP stores them (XMP Specification Part 1, 8.4).
const DC = 'http://purl.org/dc/elements/1.1/';
const FIELDS = {
    title: { element: 'dc:title', kind: 'alt' },
    authors: { element: 'dc:creator', kind: 'seq' },
    description: { element: 'dc:description', kind: 'alt' },
    keywords: { element: 'dc:subject', kind: 'bag' },
    copyright: { element: 'dc:rights', kind: 'alt' },
};

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** The rdf:li values inside one XMP property element, or null when it is absent. */
function listValues(xmp, element) {
    const m = xmp.match(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`));
    if (!m) return null;
    return [...m[1].matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((x) => xmlUnescape(x[1]));
}

/** A simple XMP property, written either as an attribute or as an element. */
function simpleValue(xmp, name) {
    const attr = xmp.match(new RegExp(`\\s${name}="([^"]*)"`));
    if (attr) return xmlUnescape(attr[1]);
    const el = xmp.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    return el ? xmlUnescape(el[1]) : null;
}

/** Read the File Info fields from an XMP packet. */
export function readFileInfo(xmp) {
    const one = (el) => listValues(xmp, el)?.[0] ?? null;
    return {
        title: one('dc:title'),
        authors: listValues(xmp, 'dc:creator') ?? [],
        description: one('dc:description'),
        keywords: listValues(xmp, 'dc:subject') ?? [],
        copyright: one('dc:rights'),
        copyrighted: simpleValue(xmp, 'xmpRights:Marked'),
        format: simpleValue(xmp, 'dc:format'),
        creatorTool: simpleValue(xmp, 'xmp:CreatorTool'),
        created: simpleValue(xmp, 'xmp:CreateDate'),
        modified: simpleValue(xmp, 'xmp:ModifyDate'),
    };
}

/** An rdf:Description holding the given Dublin Core fields, as XMP text. */
export function fileInfoBlock(fields) {
    const parts = [];
    for (const [key, { element, kind }] of Object.entries(FIELDS)) {
        const v = fields[key];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
        const values = (Array.isArray(v) ? v : [v]).map(String);
        const items = kind === 'alt'
            ? `<rdf:li xml:lang="x-default">${xmlEscape(values[0])}</rdf:li>`
            : values.map((s) => `<rdf:li>${xmlEscape(s)}</rdf:li>`).join('');
        const container = { alt: 'rdf:Alt', seq: 'rdf:Seq', bag: 'rdf:Bag' }[kind];
        parts.push(`<${element}><${container}>${items}</${container}></${element}>`);
    }
    return parts.length ? `<rdf:Description rdf:about="" xmlns:dc="${DC}">${parts.join('')}</rdf:Description>` : '';
}

/** Reject an array field that is not a list of strings. */
function stringList(value, name) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`'${name}' must be a list of strings`);
    return value;
}

export const tools = [
    {
        name: 'new_from_template',
        description: 'Start an untitled document from an Illustrator template (.ait) file (File > New from Template). The template itself is not changed',
        inputSchema: {
            type: 'object',
            properties: { filePath: { type: 'string', description: 'Absolute path to an .ait file' } },
            required: ['filePath'],
        },
        features: ['illustrator.documents.new_from_template', 'illustrator.documents.templates'],
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.ait') },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.ait') throw new Error('filePath must be an Illustrator template (.ait) file');
            return run('New from template', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = app.open(f);
__result__ = { name: d.name, template: f.fsName, artboards: d.artboards.length };`, { needsDocument: false }));
        },
    },
    {
        name: 'save_document_copy',
        description: 'Write a copy of the active document\'s saved file to another path; the document stays open and keeps referring to its own file (File > Save a Copy). The document must be saved with no unsaved changes, and the copy keeps its format',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path for the copy, with the same extension as the document\'s file' },
                overwrite: { type: 'boolean', description: 'Replace an existing file at filePath. Default false', default: false },
            },
            required: ['filePath'],
        },
        features: ['illustrator.documents.save_copy'],
        hints: { destructive: true, idempotent: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit copy.ai') },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            const ext = path.extname(p).toLowerCase();
            if (!ext) throw new Error('filePath needs an extension matching the document\'s file, e.g. .ai');
            return run('Save a copy', script(`${FILE_FN}
var src = __file(doc);
if (!src) throw new Error("The document has never been saved: save it with save_document first");
if (!doc.saved) throw new Error("The document has unsaved changes: save it first, then copy");
var have = src.name.lastIndexOf(".") >= 0 ? src.name.substring(src.name.lastIndexOf(".")).toLowerCase() : "";
if (have !== ${str(ext)}) throw new Error("The copy must keep the document's format: use a " + have + " path");
var target = new File(${jsxPath(p)});
if (target.fsName === src.fsName) throw new Error("filePath is the document's own file");
if (target.exists && !${bool(a.overwrite)}) throw new Error("File exists: " + target.fsName + ". Pass overwrite: true to replace it");
if (!src.copy(target.fsName)) throw new Error("Could not write " + target.fsName);
__result__ = { copy: target.fsName, original: src.fsName };`));
        },
    },
    {
        name: 'revert_document',
        description: 'Discard the active document\'s unsaved changes by reloading its saved file (File > Revert). Undo history is lost',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.documents.revert'],
        hints: { destructive: true, idempotent: true },
        handler: () => run('Revert document', script(`${FILE_FN}
var f = __file(doc);
if (!f) throw new Error("The document has never been saved, so there is no file to revert to");
if (doc.saved) {
  __result__ = { reverted: false, reason: "No unsaved changes", file: f.fsName };
} else {
  doc.close(SaveOptions.DONOTSAVECHANGES);
  var d = app.open(f);
  __result__ = { reverted: true, name: d.name, file: f.fsName };
}`)),
    },
    {
        name: 'close_all_documents',
        description: 'Close every open document (File > Close All). Unsaved changes are discarded unless save is true; with save, every document with changes must already have a file',
        inputSchema: {
            type: 'object',
            properties: { save: { type: 'boolean', description: 'Save changes before closing. Default false', default: false } },
        },
        features: ['illustrator.documents.close_all'],
        hints: { destructive: true, idempotent: true },
        handler: (a) => run('Close all documents', script(`${FILE_FN}
var docs = [], names = [], unsaved = [];
for (var i = 0; i < app.documents.length; i++) docs.push(app.documents[i]);
${a.save ? `for (var j = 0; j < docs.length; j++) if (!docs[j].saved && !__file(docs[j])) unsaved.push(docs[j].name);
if (unsaved.length) throw new Error("Never saved, so they cannot be saved on close: " + unsaved.join(", ") + ". Save them with save_document (filePath) first");` : ''}
for (var k = 0; k < docs.length; k++) {
  names.push(docs[k].name);
  docs[k].close(SaveOptions.${a.save ? 'SAVECHANGES' : 'DONOTSAVECHANGES'});
}
__result__ = { closed: names, saved: ${bool(a.save)} };`, { needsDocument: false })),
    },
    {
        name: 'list_document_presets',
        description: 'List the new-document presets (Print, Web, Mobile, Film & Video, Art & Illustration and saved custom presets) with their size, units and colour mode, for create_document_from_preset',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.documents.document_presets'],
        hints: { readOnly: true },
        handler: () => run('List document presets', script(`${FILE_FN}
var names = app.startupPresetsList, out = [];
for (var i = 0; i < names.length; i++) {
  var e = { name: names[i] };
  try {
    var p = app.getPresetSettings(names[i]);
    e.width = p.width; e.height = p.height; e.artboards = p.numArtboards;
    e.colorMode = __enumName(p.colorMode); e.units = __enumName(p.units);
    e.rasterEffects = __enumName(p.rasterResolution); e.previewMode = __enumName(p.previewMode);
  } catch (err) {}
  out.push(e);
}
__result__ = { presets: out };`, { needsDocument: false })),
    },
    {
        name: 'create_document_from_preset',
        description: 'Create a document from a new-document preset (File > New), overriding its name, size, orientation, units, colour mode, raster effects resolution, preview mode, transparency grid and bleed. list_document_presets names the presets',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', description: 'Preset name, e.g. "Print", "Web", "Mobile"' },
                title: { type: 'string', description: 'Name of the new document' },
                width: { type: 'number', minimum: 1, maximum: 16383, description: 'Artboard width in points' },
                height: { type: 'number', minimum: 1, maximum: 16383, description: 'Artboard height in points' },
                orientation: { type: 'string', enum: ['portrait', 'landscape'], description: 'Swap width and height to match' },
                units: { type: 'string', enum: Object.keys(UNITS), description: 'Ruler and field units of the document' },
                colorMode: { type: 'string', enum: Object.keys(COLOR_MODES) },
                rasterEffects: { type: 'string', enum: Object.keys(RASTER), description: 'Raster effects resolution: screen 72, medium 150, high 300 ppi' },
                previewMode: { type: 'string', enum: Object.keys(PREVIEW) },
                transparencyGrid: { type: 'string', enum: Object.keys(GRIDS), description: 'Transparency grid colours' },
                bleed: { type: 'number', minimum: 0, maximum: 72, description: 'Bleed on every side, in points' },
            },
            required: ['preset'],
        },
        features: [
            'illustrator.documents.document_presets',
            'illustrator.documents.newdoc.name',
            'illustrator.documents.newdoc.units',
            'illustrator.documents.newdoc.raster_effects',
            'illustrator.documents.newdoc.preview_mode',
            'illustrator.documents.newdoc.transparency_grid_new_document',
            'illustrator.documents.newdoc_orientation',
            'illustrator.documents.newdoc_bleed',
        ],
        handler: (a) => {
            const pick = (key, table) => (a[key] === undefined ? null : table[enumOf(a[key], Object.keys(table), { name: key })]);
            const lines = [
                a.title !== undefined ? `p.title = ${str(a.title)};` : '',
                a.width !== undefined ? `p.width = ${num(a.width, { min: 1, max: 16383, name: 'width' })};` : '',
                a.height !== undefined ? `p.height = ${num(a.height, { min: 1, max: 16383, name: 'height' })};` : '',
                a.units !== undefined ? `p.units = RulerUnits.${pick('units', UNITS)};` : '',
                a.colorMode !== undefined ? `p.colorMode = DocumentColorSpace.${enumOf(a.colorMode, Object.keys(COLOR_MODES), { name: 'colorMode' })};` : '',
                a.rasterEffects !== undefined ? `p.rasterResolution = DocumentRasterResolution.${pick('rasterEffects', RASTER)};` : '',
                a.previewMode !== undefined ? `p.previewMode = DocumentPreviewMode.${pick('previewMode', PREVIEW)};` : '',
                a.transparencyGrid !== undefined ? `p.transparencyGrid = DocumentTransparencyGrid.${pick('transparencyGrid', GRIDS)};` : '',
            ];
            if (a.orientation !== undefined) {
                const landscape = enumOf(a.orientation, ['portrait', 'landscape'], { name: 'orientation' }) === 'landscape';
                lines.push(`if (!p.width || !p.height) throw new Error("The preset's size could not be read: give width and height");
if (${landscape ? 'p.width < p.height' : 'p.width > p.height'}) { var w = p.width; p.width = p.height; p.height = w; }`);
            }
            if (a.bleed !== undefined) {
                const b = num(a.bleed, { min: 0, max: 72, name: 'bleed' });
                lines.push(`p.documentBleedLink = true;\np.documentBleedOffset = [${b}, ${b}, ${b}, ${b}];`);
            }
            return run('Create document from preset', script(`${FILE_FN}
var name = ${str(a.preset)}, list = app.startupPresetsList, found = false;
for (var i = 0; i < list.length; i++) if (list[i] === name) found = true;
if (!found) throw new Error("No document preset named " + name + ". Presets: " + list.join(", "));
var p = null;
try { p = app.getPresetSettings(name); } catch (e) { p = null; }
if (!p) p = new DocumentPreset();
${lines.filter(Boolean).join('\n')}
var d = app.documents.addDocument(name, p, false);
var r = d.artboards[0].artboardRect;
__result__ = { name: d.name, preset: name, colorMode: __enumName(d.documentColorSpace), units: __enumName(d.rulerUnits), width: r[2] - r[0], height: r[1] - r[3] };`, { needsDocument: false }));
        },
    },
    {
        name: 'get_document_setup',
        description: 'Report the active document\'s Document Setup values the object model exposes: units, colour mode, large canvas, Show Images in Outline Mode, and each artboard\'s ruler origin',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.documents.setup_ruler_origin'],
        hints: { readOnly: true },
        handler: () => run('Document setup', script(`${FILE_FN}
var abs = [], f = __sf(doc);
for (var i = 0; i < doc.artboards.length; i++) {
  var o = doc.artboards[i].rulerOrigin;
  abs.push({ index: i, name: doc.artboards[i].name, rulerOrigin: { x: o[0] * f, y: o[1] * f } });
}
__result__ = {
  units: __enumName(doc.rulerUnits), colorMode: __enumName(doc.documentColorSpace),
  largeCanvas: f > 1, scaleFactor: f, showImagesInOutline: doc.showPlacedImages,
  activeArtboard: doc.artboards.getActiveArtboardIndex(), artboards: abs
};`)),
    },
    {
        name: 'set_document_setup',
        description: 'Change document settings: colour mode (File > Document Color Mode, converting every colour), an artboard\'s ruler origin, conversion to a large canvas, or switch to the Artboard tool (Document Setup > Edit Artboards). Units, bleed and the other Document Setup options can only be set in the dialog; create_document_from_preset sets units and bleed for a new document',
        inputSchema: {
            type: 'object',
            properties: {
                colorMode: { type: 'string', enum: Object.keys(COLOR_MODES), description: 'Convert the document to CMYK or RGB' },
                rulerOrigin: {
                    type: 'object',
                    description: 'Ruler zero point of an artboard, in points from its top-left corner. { x: 0, y: 0 } restores the default',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                },
                artboardIndex: { ...ARTBOARD_SCHEMA, description: 'Artboard whose ruler origin is set (0-based). Default the active artboard' },
                largeCanvas: { type: 'boolean', description: 'true converts the document to a large canvas (10 times the standard maximum size). It cannot be converted back' },
                editArtboards: { type: 'boolean', description: 'true switches to the Artboard tool so the user can edit artboards' },
            },
        },
        features: [
            'illustrator.documents.color_mode_cmyk',
            'illustrator.documents.color_mode_rgb',
            'illustrator.documents.setup_ruler_origin',
            'illustrator.documents.large_canvas',
            'illustrator.documents.setup_edit_artboards',
        ],
        hints: { destructive: true, idempotent: true },
        auditArgs: { largeCanvas: true },
        handler: (a) => {
            if (a.largeCanvas === false) throw new Error('A large canvas cannot be converted back to a standard canvas; omit largeCanvas');
            if (a.editArtboards === false) throw new Error('editArtboards only switches to the Artboard tool: pass true or omit it');
            if (a.artboardIndex !== undefined && !a.rulerOrigin) throw new Error("'artboardIndex' applies with rulerOrigin");
            if (a.colorMode === undefined && !a.rulerOrigin && !a.largeCanvas && !a.editArtboards) {
                throw new Error('Give at least one of colorMode, rulerOrigin, largeCanvas or editArtboards');
            }
            const lines = [];
            if (a.colorMode !== undefined) {
                const mode = enumOf(a.colorMode, Object.keys(COLOR_MODES), { name: 'colorMode' });
                lines.push(`if (doc.documentColorSpace != DocumentColorSpace.${mode}) {
  app.executeMenuCommand(${str(COLOR_MODES[mode])});
  if (doc.documentColorSpace != DocumentColorSpace.${mode}) throw new Error("Illustrator did not convert the document to ${mode}");
}`);
            }
            if (a.rulerOrigin) {
                const o = a.rulerOrigin;
                if (typeof o !== 'object' || Array.isArray(o)) throw new Error("'rulerOrigin' must be { x, y } in points");
                lines.push(`var ai = ${a.artboardIndex !== undefined ? index(a.artboardIndex, { name: 'artboardIndex' }) : 'doc.artboards.getActiveArtboardIndex()'};
__artboard(doc, ai);
doc.artboards[ai].rulerOrigin = [__len(doc, ${num(o.x, { name: 'rulerOrigin.x' })}), __len(doc, ${num(o.y, { name: 'rulerOrigin.y' })})];`);
            }
            if (a.largeCanvas) lines.push('if (__sf(doc) === 1) doc.convertToLargeCanvas();');
            if (a.editArtboards) lines.push('app.selectTool("Adobe Crop Tool");');
            return run('Set document setup', script(`${FILE_FN}
${lines.join('\n')}
var out = { colorMode: __enumName(doc.documentColorSpace), largeCanvas: __sf(doc) > 1 };
${a.rulerOrigin ? 'var ro = doc.artboards[ai].rulerOrigin;\nout.artboardIndex = ai; out.rulerOrigin = { x: ro[0] * __sf(doc), y: ro[1] * __sf(doc) };' : ''}
${a.editArtboards ? 'out.tool = "Artboard";' : ''}
__result__ = out;`));
        },
    },
    {
        name: 'open_document_with_options',
        description: 'Open a file with Illustrator\'s open options: update legacy text and gradient meshes, convert a pre-CS4 document\'s crop area, print tiles or artwork bounds to artboards, keep it off the recent files list, or open it as a swatch, brush, symbol or graphic style library. Use open_document for a plain open',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path' },
                updateLegacyText: { type: 'boolean', description: 'Update type from documents saved before Illustrator CS' },
                updateLegacyGradientMesh: { type: 'boolean', description: 'Keep spot colours in gradient meshes from documents saved before CS3' },
                preserveLegacyArtboard: { type: 'boolean', description: 'Pre-CS4 documents: keep the legacy artboard' },
                convertCropAreaToArtboard: { type: 'boolean', description: 'Pre-CS4 documents: turn the crop area into an artboard (otherwise it is discarded)' },
                convertTilesToArtboards: { type: 'boolean', description: 'Pre-CS4 documents: turn print tiles into artboards' },
                createArtboardFromArtworkBounds: { type: 'boolean', description: 'Pre-CS4 documents: make an artboard the size of the artwork' },
                addToRecentFiles: { type: 'boolean', description: 'List the file under File > Open Recent Files' },
                openAs: { type: 'string', enum: Object.keys(LIBRARIES), description: 'Open as a document (default) or as a library panel' },
            },
            required: ['filePath'],
        },
        features: [
            'illustrator.documents.open_options.update_legacy_text',
            'illustrator.documents.open_options.update_legacy_gradient_mesh',
            'illustrator.documents.open_options.preserve_legacy_artboard',
            'illustrator.documents.open_options.convert_crop_area_to_artboard',
            'illustrator.documents.open_options.convert_print_tiles_to_artboards',
            'illustrator.documents.open_options.create_artboard_from_artwork_bounds',
            'illustrator.documents.open_options.add_to_recent_files',
            'illustrator.documents.open_options.open_as_library',
        ],
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.ai') },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            const given = Object.keys(OPEN_OPTIONS).filter((k) => a[k] !== undefined);
            if (!given.length && a.openAs === undefined) throw new Error('Give at least one open option; use open_document for a plain open');
            const lines = given.map((k) => `o.${OPEN_OPTIONS[k]} = ${bool(a[k])};`);
            const as = a.openAs === undefined ? 'document' : enumOf(a.openAs, Object.keys(LIBRARIES), { name: 'openAs' });
            if (a.openAs !== undefined) lines.push(`o.openAs = LibraryType.${LIBRARIES[as]};`);
            return run('Open document with options', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var o = new OpenOptions();
${lines.join('\n')}
var d = app.open(f, null, o);
var out = { file: f.fsName, openedAs: ${str(as)} };
try { out.name = d.name; out.artboards = d.artboards.length; } catch (e) {}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'get_file_info',
        description: 'Read the active document\'s metadata (File > File Info): title, authors, description, keywords, copyright, and the dates and creator tool, from its XMP packet',
        inputSchema: {
            type: 'object',
            properties: { includeXmp: { type: 'boolean', description: 'Also return the whole XMP packet. Default false', default: false } },
        },
        features: ['illustrator.documents.file_info', 'illustrator.documents.xmp_metadata'],
        hints: { readOnly: true },
        handler: async (a) => {
            const r = await run('File info', script('__result__ = { xmp: doc.XMPString };'));
            if (r.success && r.result && typeof r.result.xmp === 'string') {
                const xmp = r.result.xmp;
                r.result = { ...readFileInfo(xmp), ...(a.includeXmp ? { xmp } : {}) };
            }
            return r;
        },
    },
    {
        name: 'set_file_info',
        description: 'Set the active document\'s metadata (File > File Info). Each field given replaces the stored value; an empty value removes it. Or pass xmp to replace the whole XMP packet. Saved with the document',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                authors: { type: 'array', items: { type: 'string' } },
                description: { type: 'string' },
                keywords: { type: 'array', items: { type: 'string' } },
                copyright: { type: 'string', description: 'Copyright notice' },
                xmp: { type: 'string', description: 'A complete XMP packet (from get_file_info includeXmp). Not combined with the fields' },
            },
        },
        features: ['illustrator.documents.file_info', 'illustrator.documents.xmp_metadata'],
        hints: { destructive: true, idempotent: true },
        auditArgs: { xmp: undefined },
        handler: (a) => {
            const keys = Object.keys(FIELDS).filter((k) => a[k] !== undefined);
            if (a.xmp !== undefined) {
                if (keys.length) throw new Error(`Pass either xmp or fields (${keys.join(', ')}), not both`);
                const x = String(a.xmp);
                if (x.length > 1_000_000) throw new Error("'xmp' is larger than 1 MB");
                if (!/<rdf:RDF\b/.test(x)) throw new Error("'xmp' must be an XMP packet containing <rdf:RDF>");
                return run('Set file info', script(`doc.XMPString = ${str(x)};\n__result__ = { replaced: true };`));
            }
            if (!keys.length) throw new Error(`Give at least one of ${Object.keys(FIELDS).join(', ')}, or xmp`);
            const fields = {
                title: a.title, description: a.description, copyright: a.copyright,
                authors: stringList(a.authors, 'authors'), keywords: stringList(a.keywords, 'keywords'),
            };
            for (const k of ['title', 'description', 'copyright']) if (fields[k] !== undefined && typeof fields[k] !== 'string') throw new Error(`'${k}' must be a string`);
            return run('Set file info', script(`
var x = doc.XMPString;
if (!/<rdf:RDF\\b/.test(x)) throw new Error("The document's XMP packet has no rdf:RDF element");
var drop = ${json(keys.map((k) => FIELDS[k].element))};
for (var i = 0; i < drop.length; i++) x = x.replace(new RegExp("<" + drop[i] + "\\\\b[\\\\s\\\\S]*?</" + drop[i] + ">|<" + drop[i] + "\\\\s*/>", "g"), "");
var add = ${str(fileInfoBlock(fields))};
if (add) x = x.replace(/<rdf:RDF\\b[^>]*>/, function (m) { return m + add; });
doc.XMPString = x;
__result__ = { updated: ${json(keys)} };`));
        },
    },
    {
        name: 'use_clipboard',
        description: 'Cut or copy items, or paste the clipboard (Edit > Cut, Copy, Paste, Paste in Place, Paste on All Artboards, Paste without Formatting). Pasted items are selected and returned',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: CLIPBOARD },
                target: { ...TARGET_SCHEMA, description: 'cut and copy: the items. Default the current selection' },
                artboardIndex: { ...ARTBOARD_SCHEMA, description: 'paste_in_place: the artboard to paste onto (0-based). Default the active artboard' },
            },
            required: ['action'],
        },
        features: [
            'illustrator.documents.cut',
            'illustrator.documents.copy',
            'illustrator.documents.paste',
            'illustrator.documents.paste_in_place',
            'illustrator.documents.paste_all_artboards',
            'illustrator.documents.paste_without_formatting',
            'illustrator.documents.cut2',
            'illustrator.documents.copy2',
            'illustrator.documents.paste2',
        ],
        hints: { destructive: true },
        auditArgs: { action: 'paste_in_place', target: undefined, artboardIndex: 1 },
        handler: (a) => {
            const action = enumOf(a.action, CLIPBOARD, { name: 'action' });
            if (action === 'cut' || action === 'copy') {
                if (a.artboardIndex !== undefined) throw new Error("'artboardIndex' applies to paste_in_place");
                const pick = a.target ? `var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var i = 0; i < items.length; i++) items[i].selected = true;` : '';
                return run(action === 'cut' ? 'Cut' : 'Copy', script(`${pick}
var n = doc.selection ? doc.selection.length : 0;
if (!n) throw new Error("Nothing selected to ${action}: pass target");
app.${action}();
__result__ = { ${action === 'cut' ? 'cut' : 'copied'}: n };`));
            }
            if (a.target !== undefined) throw new Error(`'target' applies to cut and copy; ${action} pastes the clipboard`);
            if (a.artboardIndex !== undefined && action !== 'paste_in_place') throw new Error("'artboardIndex' applies to paste_in_place");
            const command = PASTES[action];
            return run('Paste', script(`
${a.artboardIndex !== undefined ? `var ai = ${index(a.artboardIndex, { name: 'artboardIndex' })};\n__artboard(doc, ai);\ndoc.artboards.setActiveArtboardIndex(ai);` : ''}
var before = doc.pageItems.length;
${action === 'paste_without_formatting' ? '' : 'doc.selection = null;'}
${command ? `app.executeMenuCommand(${str(command)});` : 'app.paste();'}
var sel = doc.selection, items = [];
if (sel && sel.length) for (var i = 0; i < sel.length && i < 100; i++) { try { items.push(__itemInfo(doc, sel[i])); } catch (e) {} }
__result__ = { pasted: sel && sel.length ? sel.length : 0, added: doc.pageItems.length - before, items: items };`));
        },
    },
    {
        name: 'switch_document',
        description: 'Bring an open document to the front by name or by its list_documents index, or move to the next or previous document or document group (Window menu document navigation)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Document name, as list_documents gives it' },
                index: { type: 'integer', minimum: 0, description: 'Position in list_documents, which changes as documents are activated' },
                direction: { type: 'string', enum: Object.keys(DIRECTIONS) },
            },
        },
        features: [
            'illustrator.documents.activate_document',
            'illustrator.documents.next_document',
            'illustrator.documents.previous_document',
            'illustrator.documents.next_document_group',
            'illustrator.documents.previous_document_group',
        ],
        auditArgs: { index: undefined, direction: undefined },
        handler: (a) => {
            const given = ['name', 'index', 'direction'].filter((k) => a[k] !== undefined);
            if (given.length !== 1) throw new Error('Give exactly one of name, index or direction');
            let body;
            if (a.direction !== undefined) {
                const cmd = DIRECTIONS[enumOf(a.direction, Object.keys(DIRECTIONS), { name: 'direction' })];
                body = `app.executeMenuCommand(${str(cmd)});`;
            } else if (a.index !== undefined) {
                body = `var i = ${index(a.index, { name: 'index' })};
if (i >= app.documents.length) throw new Error("Document " + i + " not found; " + app.documents.length + " are open");
app.documents[i].activate();`;
            } else {
                body = `var want = ${str(a.name)}, d = null, names = [];
for (var i = 0; i < app.documents.length; i++) { names.push(app.documents[i].name); if (app.documents[i].name === want) d = app.documents[i]; }
if (!d) throw new Error("No open document named " + want + ". Open: " + names.join(", "));
d.activate();`;
            }
            return run('Switch document', script(`
if (app.documents.length === 0) throw new Error("No document open");
${body}
app.redraw();
__result__ = { active: app.activeDocument.name, open: app.documents.length };`, { needsDocument: false }));
        },
    },
];
