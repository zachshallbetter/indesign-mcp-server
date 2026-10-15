/**
 * Documents: list, describe, create, open, save, duplicate, switch and close.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, createPathPolicy, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';

export const paths = createPathPolicy({ envVar: 'PHOTOSHOP_ALLOWED_DIRS' });

const MODES = { rgb: 'RGB', cmyk: 'CMYK', grayscale: 'GRAYSCALE', lab: 'LAB', bitmap: 'BITMAP' };
const FILLS = { white: 'WHITE', transparent: 'TRANSPARENT', background: 'BACKGROUNDCOLOR' };
const DEPTHS = { 1: 'ONE', 8: 'EIGHT', 16: 'SIXTEEN', 32: 'THIRTYTWO' };
const TIFF_COMPRESSION = { none: 'NONE', lzw: 'TIFFLZW', zip: 'TIFFZIP', jpeg: 'JPEG' };
const JPEG_FORMATS = { baseline: 'STANDARDBASELINE', optimized: 'OPTIMIZEDBASELINE', progressive: 'PROGRESSIVE' };
const PDF_STANDARDS = { none: 'NONE', 'x1a-2001': 'PDFX1A2001', 'x1a-2003': 'PDFX1A2003', 'x3-2002': 'PDFX32002', 'x3-2003': 'PDFX32003', 'x4-2008': 'PDFX42008' };
export const SAVE_FORMATS = ['.psd', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.pdf'];

/** Save-option statements (`var o = ...`) for a file extension and its options. */
function saveOptionLines(ext, a) {
    const lines = [];
    const set = (prop, value) => lines.push(`o.${prop} = ${value};`);
    if (ext === '.psd') {
        lines.push('var o = new PhotoshopSaveOptions();');
        set('layers', bool(a.layers ?? true));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('alphaChannels', bool(a.alphaChannels ?? true));
        set('spotColors', bool(a.spotColors ?? true));
    } else if (ext === '.tif' || ext === '.tiff') {
        lines.push('var o = new TiffSaveOptions();');
        set('imageCompression', `TIFFEncoding.${TIFF_COMPRESSION[enumOf(a.compression ?? 'lzw', Object.keys(TIFF_COMPRESSION), { name: 'compression' })]}`);
        set('layers', bool(a.layers ?? true));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('alphaChannels', bool(a.alphaChannels ?? true));
        set('transparency', bool(a.transparency ?? true));
    } else if (ext === '.png') {
        lines.push('var o = new PNGSaveOptions();');
        set('compression', index(a.compression ?? 6, { name: 'compression', max: 9 }));
        set('interlaced', bool(a.interlaced));
    } else if (ext === '.jpg' || ext === '.jpeg') {
        lines.push('var o = new JPEGSaveOptions();');
        set('quality', index(a.quality ?? 10, { name: 'quality', max: 12 }));
        set('formatOptions', `FormatOptions.${JPEG_FORMATS[enumOf(a.format ?? 'optimized', Object.keys(JPEG_FORMATS), { name: 'format' })]}`);
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('matte', 'MatteType.NONE');
    } else if (ext === '.pdf') {
        lines.push('var o = new PDFSaveOptions();');
        if (a.preset) set('presetFile', str(a.preset));
        if (a.standard) set('PDFStandard', `PDFStandard.${PDF_STANDARDS[enumOf(a.standard, Object.keys(PDF_STANDARDS), { name: 'standard' })]}`);
        set('layers', bool(a.layers ?? false));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('preserveEditing', bool(a.preserveEditing ?? false));
        set('view', 'false');
    }
    return lines.join('\n');
}

export const tools = [
    {
        name: 'list_documents',
        description: 'List open documents with their size in pixels, resolution, colour mode, bit depth, file and whether they have unsaved changes',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.documents.documents_collection', 'photoshop.documents.document_object', 'photoshop.documents.document_id', 'photoshop.documents.document_saved_state', 'photoshop.documents.document_file_path'],
        handler: () => run('List documents', script(`
var out = [];
for (var i = 0; i < app.documents.length; i++) out.push(__docInfo(app.documents[i]));
__result__ = { active: app.documents.length ? app.activeDocument.name : null, documents: out };`, { needsDocument: false })),
    },
    {
        name: 'get_document_info',
        description: 'Describe the active document: size in pixels, resolution, mode, bit depth, colour profile, layer count, active layer, channels, guides, selection bounds and history',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.documents.document_object', 'photoshop.documents.document_id', 'photoshop.documents.document_saved_state', 'photoshop.documents.document_file_path', 'photoshop.color_management.color_profile_of_document', 'photoshop.channels.channel_object', 'photoshop.ui.guides', 'photoshop.selection.selection_object', 'photoshop.history.history_state'],
        handler: () => run('Document info', script(`
var info = __docInfo(doc), ch = [], g = [];
for (var i = 0; i < doc.channels.length; i++) ch.push({ name: doc.channels[i].name, kind: __enumName(doc.channels[i].kind) });
for (var j = 0; j < doc.guides.length; j++) g.push({ direction: __enumName(doc.guides[j].direction), position: __px(doc.guides[j].coordinate) });
info.channels = ch; info.guides = g;
try { var sb = doc.selection.bounds; info.selection = { x: __px(sb[0]), y: __px(sb[1]), width: __px(sb[2]) - __px(sb[0]), height: __px(sb[3]) - __px(sb[1]) }; } catch (e) { info.selection = null; }
info.history = doc.historyStates.length;
try { info.activeHistoryState = doc.activeHistoryState.name; } catch (e) {}
__result__ = info;`)),
    },
    {
        name: 'create_document',
        description: 'Create a document (File > New) with a size in pixels, resolution, colour mode, bit depth, background fill and optional colour profile',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'Pixels per inch. Default 72', default: 72 },
                name: { type: 'string' },
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Default rgb' },
                fill: { type: 'string', enum: Object.keys(FILLS), description: 'Background contents. Default white' },
                bitsPerChannel: { type: 'integer', enum: [1, 8, 16, 32], description: 'Default 8' },
                colorProfile: { type: 'string', description: 'Profile name, e.g. "sRGB IEC61966-2.1"' },
            },
            required: ['width', 'height'],
        },
        features: ['photoshop.documents.new_document', 'photoshop.documents.new_doc_width_height', 'photoshop.documents.new_doc_resolution', 'photoshop.documents.new_doc_color_mode', 'photoshop.documents.new_doc_background_contents', 'photoshop.documents.new_doc_color_profile'],
        handler: (a) => run('Create document', script(`
var d = app.documents.add(${num(a.width, { min: 1, max: 300000, name: 'width' })}, ${num(a.height, { min: 1, max: 300000, name: 'height' })}, ${num(a.resolution ?? 72, { min: 1, max: 10000, name: 'resolution' })},
  ${a.name ? str(a.name) : 'undefined'}, NewDocumentMode.${MODES[enumOf(a.mode ?? 'rgb', Object.keys(MODES), { name: 'mode' })]},
  DocumentFill.${FILLS[enumOf(a.fill ?? 'white', Object.keys(FILLS), { name: 'fill' })]}, 1,
  BitsPerChannelType.${DEPTHS[enumOf(String(a.bitsPerChannel ?? 8), Object.keys(DEPTHS), { name: 'bitsPerChannel' })]}${a.colorProfile ? `, ${str(a.colorProfile)}` : ''});
__result__ = __docInfo(d);`, { needsDocument: false })),
    },
    {
        name: 'open_document',
        description: 'Open an image or document (PSD, PSB, TIFF, JPEG, PNG, PDF, camera raw and other formats Photoshop opens), optionally as a smart object',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path' },
                asSmartObject: { type: 'boolean', description: 'Open as a smart object. Default false', default: false },
            },
            required: ['filePath'],
        },
        features: ['photoshop.documents.open', 'photoshop.import_export.open_as_smart_object'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            return run('Open document', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = app.open(f, undefined, ${bool(a.asSmartObject)});
__result__ = __docInfo(d);`, { needsDocument: false }));
        },
    },
    {
        name: 'save_document',
        description: 'Save the active document in place, or as PSD, TIFF, PNG, JPEG or PDF at filePath (chosen by its extension) with that format\'s options. With asCopy the document keeps referring to its own file',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path ending in .psd, .tif, .png, .jpg or .pdf. Omit to save in place' },
                asCopy: { type: 'boolean', description: 'Save a copy. Default false', default: false },
                layers: { type: 'boolean', description: 'PSD, TIFF, PDF: keep layers' },
                embedColorProfile: { type: 'boolean', description: 'Embed the colour profile. Default true' },
                alphaChannels: { type: 'boolean', description: 'PSD, TIFF: keep alpha channels' },
                spotColors: { type: 'boolean', description: 'PSD: keep spot channels' },
                transparency: { type: 'boolean', description: 'TIFF: keep transparency' },
                compression: { description: 'TIFF: none, lzw (default), zip or jpeg. PNG: 0-9 (default 6)' },
                interlaced: { type: 'boolean', description: 'PNG: interlaced' },
                quality: { type: 'integer', minimum: 0, maximum: 12, description: 'JPEG quality, 0-12. Default 10' },
                format: { type: 'string', enum: Object.keys(JPEG_FORMATS), description: 'JPEG: baseline, optimized (default) or progressive' },
                preset: { type: 'string', description: 'PDF: Adobe PDF preset name, e.g. "[High Quality Print]"' },
                standard: { type: 'string', enum: Object.keys(PDF_STANDARDS), description: 'PDF: PDF/X standard' },
                preserveEditing: { type: 'boolean', description: 'PDF: keep Photoshop editing capabilities' },
            },
        },
        hints: { destructive: true, idempotent: true },
        features: ['photoshop.documents.save', 'photoshop.documents.save_as', 'photoshop.documents.save_a_copy', 'photoshop.import_export.format_psd', 'photoshop.import_export.format_tiff', 'photoshop.import_export.format_png', 'photoshop.import_export.format_jpeg', 'photoshop.import_export.format_photoshop_pdf', 'photoshop.import_export.save_option_layers', 'photoshop.import_export.save_option_alpha', 'photoshop.import_export.save_option_spot', 'photoshop.import_export.save_option_color', 'photoshop.import_export.tiff_image_compression', 'photoshop.import_export.tiff_transparency', 'photoshop.import_export.png_compression', 'photoshop.import_export.png_interlace', 'photoshop.import_export.jpeg_quality', 'photoshop.import_export.jpeg_format_options', 'photoshop.import_export.pdf_preset', 'photoshop.import_export.pdf_standard', 'photoshop.import_export.pdf_preserve_editing'],
        handler: (a) => {
            if (!a.filePath) {
                return run('Save document', script(`
try { if (!doc.fullName) throw 0; } catch (e) { throw new Error("The document has never been saved: pass filePath"); }
doc.save();
__result__ = { saved: true, file: doc.fullName.fsName };`));
            }
            const p = paths.validate(a.filePath);
            const ext = path.extname(p).toLowerCase();
            if (!SAVE_FORMATS.includes(ext)) throw new Error(`filePath must end in ${SAVE_FORMATS.join(', ')}`);
            if (ext === '.png' && a.compression !== undefined && typeof a.compression !== 'number') throw new Error("PNG 'compression' is a number, 0-9");
            if ((ext === '.tif' || ext === '.tiff') && a.compression !== undefined && typeof a.compression !== 'string') throw new Error("TIFF 'compression' is none, lzw, zip or jpeg");
            return run('Save document', script(`
${saveOptionLines(ext, a)}
var target = new File(${jsxPath(p)});
doc.saveAs(target, o, ${bool(a.asCopy)}, Extension.LOWERCASE);
__result__ = { saved: true, file: target.fsName, asCopy: ${bool(a.asCopy)}, document: doc.name };`));
        },
    },
    {
        name: 'duplicate_document',
        description: 'Duplicate the active document (Image > Duplicate), optionally merged into one layer',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                mergeLayers: { type: 'boolean', description: 'Duplicate merged layers only. Default false', default: false },
            },
        },
        features: ['photoshop.image.duplicate', 'photoshop.image.duplicate_merged_layers_only'],
        handler: (a) => run('Duplicate document', script(`
var d = doc.duplicate(${a.name ? str(a.name) : 'undefined'}, ${bool(a.mergeLayers)});
__result__ = __docInfo(d);`)),
    },
    {
        name: 'set_active_document',
        description: 'Bring an open document to the front by name or index',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, index: { type: 'integer', minimum: 0 } },
        },
        hints: { idempotent: true },
        features: ['photoshop.documents.documents_collection', 'photoshop.ui.cycle_documents'],
        handler: (a) => {
            if ((a.name === undefined) === (a.index === undefined)) throw new Error('Give name or index');
            return run('Set active document', script(a.name !== undefined ? `
var d = null;
for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name === ${str(a.name)}) d = app.documents[i];
if (!d) throw new Error("No open document named " + ${str(a.name)});
app.activeDocument = d;
__result__ = __docInfo(d);` : `
var at = ${index(a.index, { name: 'index' })};
if (at >= app.documents.length) throw new Error("Only " + app.documents.length + " documents are open");
app.activeDocument = app.documents[at];
__result__ = __docInfo(app.activeDocument);`, { needsDocument: false }));
        },
    },
    {
        name: 'close_document',
        description: 'Close the active document. Unsaved changes are discarded unless save is true',
        inputSchema: { type: 'object', properties: { save: { type: 'boolean', description: 'Save before closing. Default false', default: false } } },
        hints: { destructive: true },
        features: ['photoshop.documents.close'],
        handler: (a) => run('Close document', script(`
var n = doc.name;
doc.close(SaveOptions.${a.save ? 'SAVECHANGES' : 'DONOTSAVECHANGES'});
__result__ = { closed: n };`)),
    },
    {
        name: 'set_colors',
        description: 'Set the foreground and background colours used by fills, strokes, brushes and new documents',
        inputSchema: { type: 'object', properties: { foreground: COLOR_SCHEMA, background: COLOR_SCHEMA } },
        hints: { idempotent: true },
        features: ['photoshop.color.foreground_color', 'photoshop.color.background_color'],
        handler: (a) => {
            if (a.foreground === undefined && a.background === undefined) throw new Error('Give foreground, background or both');
            return run('Set colours', script(`
${a.foreground !== undefined ? `app.foregroundColor = __color(${colorSpec(a.foreground, 'foreground')});` : ''}
${a.background !== undefined ? `app.backgroundColor = __color(${colorSpec(a.background, 'background')});` : ''}
__result__ = { foreground: __colorInfo(app.foregroundColor), background: __colorInfo(app.backgroundColor) };`, { needsDocument: false }));
        },
    },
];
