/**
 * Documents: list, describe, create, open (with format options), save (in
 * every format the object model writes, with its options), duplicate, switch
 * and close.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, createPathPolicy, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';
import { optionLines, describeOptions } from '../options.js';

export const paths = createPathPolicy({ envVar: 'PHOTOSHOP_ALLOWED_DIRS' });

const MODES = { rgb: 'RGB', cmyk: 'CMYK', grayscale: 'GRAYSCALE', lab: 'LAB', bitmap: 'BITMAP' };
const FILLS = { white: 'WHITE', transparent: 'TRANSPARENT', background: 'BACKGROUNDCOLOR' };
const DEPTHS = { 1: 'ONE', 8: 'EIGHT', 16: 'SIXTEEN', 32: 'THIRTYTWO' };
const TIFF_COMPRESSION = { none: 'NONE', lzw: 'TIFFLZW', zip: 'TIFFZIP', jpeg: 'JPEG' };
const JPEG_FORMATS = { baseline: 'STANDARDBASELINE', optimized: 'OPTIMIZEDBASELINE', progressive: 'PROGRESSIVE' };
const PDF_STANDARDS = { none: 'NONE', 'x1a-2001': 'PDFX1A2001', 'x1a-2003': 'PDFX1A2003', 'x3-2002': 'PDFX32002', 'x3-2003': 'PDFX32003', 'x4-2008': 'PDFX42008' };
export const SAVE_FORMATS = ['.psd', '.psb', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.pdf', '.gif', '.eps', '.bmp', '.tga', '.pxr', '.raw'];

const OPEN_MODE = { type: 'OpenDocumentMode', values: { rgb: 'RGB', cmyk: 'CMYK', grayscale: 'GRAYSCALE', lab: 'LAB' } };
const MATTE = { type: 'MatteType', values: { none: 'NONE', white: 'WHITE', black: 'BLACK', semigray: 'SEMIGRAY', background: 'BACKGROUND', foreground: 'FOREGROUND', netscape: 'NETSCAPE' } };
const EPS_PREVIEW = { type: 'Preview', values: { none: 'NONE', tiff_1bit: 'MONOCHROMETIFF', tiff_8bit: 'EIGHTBITTIFF', mac_1bit: 'MACOSMONOCHROME', mac_8bit: 'MACOSEIGHTBIT', mac_jpeg: 'MACOSJPEG' } };
const EPS_ENCODING = { type: 'SaveEncoding', values: { ascii: 'ASCII', binary: 'BINARY', jpeg_low: 'JPEGLOW', jpeg_medium: 'JPEGMEDIUM', jpeg_high: 'JPEGHIGH', jpeg_maximum: 'JPEGMAXIMUM' } };

/** Open options per format (File > Open, Open As): the dialog each format shows, as options. */
export const OPEN_OPTIONS = {
    pdf: {
        cls: 'GenericPDFOpenOptions',
        table: {
            select: { kind: 'literal', prop: 'usePageNumber', values: { page: 'true', image: 'false' }, description: 'open a page or an embedded image. Default page' },
            page: { kind: 'int', min: 1, max: 100000, description: 'page (or image) number, from 1' },
            name: { kind: 'str', description: 'name of the new document' },
            cropTo: { kind: 'enum', prop: 'cropPage', type: 'CropToType', values: { bounding_box: 'BOUNDINGBOX', media_box: 'MEDIABOX', crop_box: 'CROPBOX', bleed_box: 'BLEEDBOX', trim_box: 'TRIMBOX', art_box: 'ARTBOX' } },
            width: { kind: 'px', min: 1 },
            height: { kind: 'px', min: 1 },
            constrainProportions: { kind: 'bool' },
            resolution: { kind: 'num', min: 1, max: 10000, description: 'pixels per inch' },
            mode: { kind: 'enum', ...OPEN_MODE },
            bitsPerChannel: { kind: 'enum', type: 'BitsPerChannelType', values: { 8: 'EIGHT', 16: 'SIXTEEN' } },
            antiAlias: { kind: 'bool' },
            suppressWarnings: { kind: 'bool' },
        },
    },
    eps: {
        cls: 'GenericEPSOpenOptions',
        table: {
            width: { kind: 'px', min: 1 },
            height: { kind: 'px', min: 1 },
            constrainProportions: { kind: 'bool' },
            resolution: { kind: 'num', min: 1, max: 10000 },
            mode: { kind: 'enum', ...OPEN_MODE },
            antiAlias: { kind: 'bool' },
        },
    },
    raw: {
        cls: 'RawFormatOpenOptions',
        table: {
            width: { kind: 'int', min: 1, max: 300000 },
            height: { kind: 'int', min: 1, max: 300000 },
            channels: { kind: 'int', prop: 'channelNumber', min: 1, max: 56 },
            bitsPerChannel: { kind: 'literal', values: { 8: '8', 16: '16' } },
            byteOrder: { kind: 'enum', type: 'ByteOrder', values: { ibm: 'IBM', mac: 'MACOS' } },
            headerSize: { kind: 'int', min: 0, max: 1e9, description: 'bytes to skip' },
            interleaved: { kind: 'bool', prop: 'interleaveChannels' },
            retainHeader: { kind: 'bool' },
        },
    },
    dicom: {
        cls: 'DICOMOpenOptions',
        table: {
            anonymize: { kind: 'bool', description: 'remove patient data' },
            showOverlays: { kind: 'bool' },
            windowLevel: { kind: 'num', min: -100000, max: 100000 },
            windowWidth: { kind: 'num', min: 0, max: 100000 },
            rows: { kind: 'int', min: 1, max: 100, description: 'frames per column when opening frames as a grid' },
            columns: { kind: 'int', min: 1, max: 100 },
            reverse: { kind: 'bool', description: 'reverse frame order' },
        },
    },
};

/** Advanced save options per format, set from save_document's `options`. */
const SAVE_OPTIONS = {
    tiff: {
        pixelOrder: { kind: 'literal', prop: 'interleaveChannels', values: { interleaved: 'true', per_channel: 'false' } },
        byteOrder: { kind: 'enum', type: 'ByteOrder', values: { ibm: 'IBM', mac: 'MACOS' } },
        imagePyramid: { kind: 'bool', prop: 'saveImagePyramid' },
        layerCompression: { kind: 'enum', type: 'LayerCompression', values: { rle: 'RLE', zip: 'ZIP' } },
        jpegQuality: { kind: 'int', min: 0, max: 12, description: 'with compression jpeg' },
        spotColors: { kind: 'bool' },
    },
    jpeg: {
        matte: { kind: 'enum', ...MATTE, description: 'fill for transparent areas. Default none' },
        scans: { kind: 'int', min: 3, max: 5, description: 'progressive scans' },
    },
    pdf: {
        viewAfterSaving: { kind: 'bool', description: 'open the PDF afterwards. Default false' },
        compatibility: { kind: 'enum', prop: 'PDFCompatibility', type: 'PDFCompatibility', values: { '1.3': 'PDF13', '1.4': 'PDF14', '1.5': 'PDF15', '1.6': 'PDF16', '1.7': 'PDF17' } },
        description: { kind: 'str' },
        embedThumbnail: { kind: 'bool' },
        optimizeForWeb: { kind: 'bool' },
        downsample: { kind: 'enum', prop: 'downSample', type: 'PDFResample', values: { none: 'NONE', average: 'PDFAVERAGE', bicubic: 'PDFBICUBIC', subsample: 'PDFSUBSAMPLE' } },
        downsampleTo: { kind: 'num', prop: 'downSampleSize', min: 1, max: 10000, description: 'ppi' },
        downsampleAbove: { kind: 'num', prop: 'downSampleSizeLimit', min: 1, max: 10000, description: 'ppi' },
        compression: { kind: 'enum', prop: 'encoding', type: 'PDFEncoding', values: { none: 'NONE', zip: 'PDFZIP', zip_4bit: 'PDFZIP4BIT', jpeg: 'JPEG', jpeg_low: 'JPEGLOW', jpeg_medium_low: 'JPEGMEDLOW', jpeg_medium: 'JPEGMED', jpeg_medium_high: 'JPEGMEDHIGH', jpeg_high: 'JPEGHIGH', jpeg2000_low: 'JPEG2000LOW', jpeg2000_medium_low: 'JPEG2000MEDLOW', jpeg2000_medium: 'JPEG2000MED', jpeg2000_medium_high: 'JPEG2000MEDHIGH', jpeg2000_high: 'JPEG2000HIGH', jpeg2000_lossless: 'JPEG2000LOSSLESS' } },
        jpegQuality: { kind: 'int', min: 0, max: 12 },
        tileSize: { kind: 'int', min: 32, max: 1024, description: 'JPEG 2000 tile size' },
        convertToEightBit: { kind: 'bool' },
        colorConversion: { kind: 'bool' },
        destinationProfile: { kind: 'str' },
        includeProfile: { kind: 'bool', prop: 'profileInclusionPolicy' },
        downgradeColorProfile: { kind: 'bool' },
        outputCondition: { kind: 'str' },
        outputConditionId: { kind: 'str', prop: 'outputConditionID' },
        registryName: { kind: 'str' },
        vectorData: { kind: 'bool' },
        embedFonts: { kind: 'bool' },
        useOutlines: { kind: 'bool', description: 'text as outlines' },
        interpolation: { kind: 'bool' },
        transparency: { kind: 'bool' },
        alphaChannels: { kind: 'bool' },
        spotColors: { kind: 'bool' },
    },
    gif: {
        palette: { kind: 'enum', type: 'PaletteType', values: { exact: 'EXACT', local_adaptive: 'LOCALADAPTIVE', local_perceptual: 'LOCALPERCEPTUAL', local_selective: 'LOCALSELECTIVE', master_adaptive: 'MASTERADAPTIVE', master_perceptual: 'MASTERPERCEPTUAL', master_selective: 'MASTERSELECTIVE', uniform: 'UNIFORM', web: 'WEBPALETTE', mac: 'MACOSPALETTE', windows: 'WINDOWSPALETTE', previous: 'PREVIOUSPALETTE' } },
        colors: { kind: 'int', min: 2, max: 256 },
        forced: { kind: 'enum', type: 'ForcedColors', values: { none: 'NONE', black_white: 'BLACKWHITE', primaries: 'PRIMARIES', web: 'WEB' } },
        dither: { kind: 'enum', type: 'Dither', values: { none: 'NONE', diffusion: 'DIFFUSION', pattern: 'PATTERN', noise: 'NOISE' } },
        ditherAmount: { kind: 'int', min: 1, max: 100 },
        transparency: { kind: 'bool' },
        matte: { kind: 'enum', ...MATTE },
        interlaced: { kind: 'bool' },
        preserveExactColors: { kind: 'bool' },
    },
    eps: {
        preview: { kind: 'enum', ...EPS_PREVIEW },
        encoding: { kind: 'enum', ...EPS_ENCODING },
        halftoneScreen: { kind: 'bool' },
        transferFunction: { kind: 'bool' },
        transparentWhites: { kind: 'bool', description: 'Bitmap mode only' },
        psColorManagement: { kind: 'bool' },
        vectorData: { kind: 'bool' },
        interpolation: { kind: 'bool' },
    },
    dcs1: {
        composite: { kind: 'enum', prop: 'DCS', type: 'DCSType', values: { none: 'NOCOMPOSITE', grayscale: 'GRAYSCALECOMPOSITE', color: 'COLORCOMPOSITE' } },
        preview: { kind: 'enum', ...EPS_PREVIEW },
        encoding: { kind: 'enum', ...EPS_ENCODING },
        halftoneScreen: { kind: 'bool' },
        transferFunction: { kind: 'bool' },
        vectorData: { kind: 'bool' },
        interpolation: { kind: 'bool' },
    },
    bmp: {
        osType: { kind: 'enum', type: 'OperatingSystem', values: { windows: 'WINDOWS', os2: 'OS2' } },
        depth: { kind: 'enum', type: 'BMPDepthType', values: { 1: 'ONE', 4: 'FOUR', 8: 'EIGHT', 16: 'SIXTEEN', 24: 'TWENTYFOUR', 32: 'THIRTYTWO', a1r5g5b5: 'BMP_A1R5G5B5', a4r4g4b4: 'BMP_A4R4G4B4', a8r8g8b8: 'BMP_A8R8G8B8', r5g6b5: 'BMP_R5G6B5', r8g8b8: 'BMP_R8G8B8', x1r5g5b5: 'BMP_X1R5G5B5', x4r4g4b4: 'BMP_X4R4G4B4', x8r8g8b8: 'BMP_X8R8G8B8' } },
        rleCompression: { kind: 'bool' },
        flipRowOrder: { kind: 'bool' },
        alphaChannels: { kind: 'bool' },
    },
    targa: {
        bitsPerPixel: { kind: 'enum', prop: 'resolution', type: 'TargaBitsPerPixels', values: { 16: 'SIXTEEN', 24: 'TWENTYFOUR', 32: 'THIRTYTWO' } },
        rleCompression: { kind: 'bool' },
        alphaChannels: { kind: 'bool' },
    },
    pixar: { alphaChannels: { kind: 'bool' } },
    raw: { alphaChannels: { kind: 'bool' }, spotColors: { kind: 'bool' } },
    psb: { maximizeCompatibility: { kind: 'bool', description: 'default true' } },
    psd: {},
    png: {},
};
SAVE_OPTIONS.dcs2 = { ...SAVE_OPTIONS.dcs1, multiFile: { kind: 'bool', prop: 'multiFileDCS', description: 'one file per channel' }, spotColors: { kind: 'bool' } };

/** The SAVE_OPTIONS key for a file extension (and EPS type). */
function saveKind(ext, epsType) {
    if (ext === '.eps') return epsType === 'dcs1' || epsType === 'dcs2' ? epsType : 'eps';
    return { '.psd': 'psd', '.psb': 'psb', '.tif': 'tiff', '.tiff': 'tiff', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.pdf': 'pdf', '.gif': 'gif', '.bmp': 'bmp', '.tga': 'targa', '.pxr': 'pixar', '.raw': 'raw' }[ext];
}

/**
 * Save-option statements (`var o = ...`) for a file extension and its options.
 * Not used for PSB, which is saved through the Action Manager.
 */
export function saveOptionLines(ext, a) {
    const lines = [];
    const set = (prop, value) => lines.push(`o.${prop} = ${value};`);
    const kind = saveKind(ext, a.epsType);
    // matte and viewAfterSaving always have a statement of their own below.
    const opt = { ...(a.options ?? {}) };
    const own = { matte: opt.matte, viewAfterSaving: opt.viewAfterSaving };
    if (kind === 'jpeg') delete opt.matte;
    if (kind === 'pdf') delete opt.viewAfterSaving;
    const notes = () => { if (a.notes !== undefined) set('annotations', bool(a.notes)); };
    if (ext === '.psd') {
        lines.push('var o = new PhotoshopSaveOptions();');
        set('layers', bool(a.layers ?? true));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('alphaChannels', bool(a.alphaChannels ?? true));
        set('spotColors', bool(a.spotColors ?? true));
        notes();
    } else if (ext === '.tif' || ext === '.tiff') {
        lines.push('var o = new TiffSaveOptions();');
        set('imageCompression', `TIFFEncoding.${TIFF_COMPRESSION[enumOf(a.compression ?? 'lzw', Object.keys(TIFF_COMPRESSION), { name: 'compression' })]}`);
        set('layers', bool(a.layers ?? true));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('alphaChannels', bool(a.alphaChannels ?? true));
        set('transparency', bool(a.transparency ?? true));
        notes();
    } else if (ext === '.png') {
        lines.push('var o = new PNGSaveOptions();');
        set('compression', index(a.compression ?? 6, { name: 'compression', max: 9 }));
        set('interlaced', bool(a.interlaced));
    } else if (ext === '.jpg' || ext === '.jpeg') {
        lines.push('var o = new JPEGSaveOptions();');
        set('quality', index(a.quality ?? 10, { name: 'quality', max: 12 }));
        set('formatOptions', `FormatOptions.${JPEG_FORMATS[enumOf(a.format ?? 'optimized', Object.keys(JPEG_FORMATS), { name: 'format' })]}`);
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('matte', `MatteType.${MATTE.values[enumOf(own.matte ?? 'none', Object.keys(MATTE.values), { name: 'options.matte' })]}`);
    } else if (ext === '.pdf') {
        lines.push('var o = new PDFSaveOptions();');
        if (a.preset) set('presetFile', str(a.preset));
        if (a.standard) set('PDFStandard', `PDFStandard.${PDF_STANDARDS[enumOf(a.standard, Object.keys(PDF_STANDARDS), { name: 'standard' })]}`);
        set('layers', bool(a.layers ?? false));
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
        set('preserveEditing', bool(a.preserveEditing ?? false));
        if (own.viewAfterSaving !== undefined && typeof own.viewAfterSaving !== 'boolean') throw new Error("'options.viewAfterSaving' must be true or false");
        set('view', bool(own.viewAfterSaving));
        notes();
    } else if (ext === '.gif') {
        lines.push('var o = new GIFSaveOptions();');
    } else if (ext === '.eps') {
        lines.push(`var o = new ${{ eps: 'EPSSaveOptions', dcs1: 'DCS1_SaveOptions', dcs2: 'DCS2_SaveOptions' }[kind]}();`);
        set('embedColorProfile', bool(a.embedColorProfile ?? true));
    } else if (ext === '.bmp') {
        lines.push('var o = new BMPSaveOptions();');
    } else if (ext === '.tga') {
        lines.push('var o = new TargaSaveOptions();');
    } else if (ext === '.pxr') {
        lines.push('var o = new PixarSaveOptions();');
    } else if (ext === '.raw') {
        lines.push('var o = new RawSaveOptions();');
    }
    const more = optionLines(SAVE_OPTIONS[kind], opt, { what: `Saving as ${kind.toUpperCase()}` });
    if (more) lines.push(more);
    return lines.join('\n');
}

/** Action Manager statements saving the document as PSB to `target`. */
function psbSaveLines(a) {
    const opts = a.options ?? {};
    for (const k of Object.keys(opts)) if (!(k in SAVE_OPTIONS.psb)) throw new Error(`Saving as PSB has no option ${k}. Options: maximizeCompatibility`);
    return `var f = new ActionDescriptor(), d = new ActionDescriptor();
f.putBoolean(app.stringIDToTypeID("maximizeCompatibility"), ${bool(opts.maximizeCompatibility ?? true)});
d.putObject(app.stringIDToTypeID("as"), app.stringIDToTypeID("largeDocumentFormat"), f);
d.putPath(app.stringIDToTypeID("in"), target);
d.putBoolean(app.stringIDToTypeID("copy"), ${bool(a.asCopy)});
d.putBoolean(app.stringIDToTypeID("lowerCase"), true);
app.executeAction(app.stringIDToTypeID("save"), d, DialogModes.NO);`;
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
        description: 'Create a document (File > New, Preset Details) with a size in pixels, resolution, colour mode, bit depth, background fill, pixel aspect ratio and optional colour profile, optionally as an artboard document',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'Pixels per inch. Default 72', default: 72 },
                name: { type: 'string', description: 'Document name' },
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Default rgb' },
                fill: { type: 'string', enum: Object.keys(FILLS), description: 'Background contents. Default white' },
                bitsPerChannel: { type: 'integer', enum: [1, 8, 16, 32], description: 'Default 8' },
                colorProfile: { type: 'string', description: 'Profile name, e.g. "sRGB IEC61966-2.1"' },
                pixelAspectRatio: { type: 'number', minimum: 0.1, maximum: 10, description: 'Pixel width over height for video work, e.g. 0.9 for D1/DV NTSC. Default 1 (square)' },
                artboard: { type: 'boolean', description: 'Create the document with an artboard (the New Document Artboards option). Default false' },
            },
            required: ['width', 'height'],
        },
        auditArgs: { artboard: false },
        features: ['photoshop.documents.new_document', 'photoshop.documents.new_doc_width_height', 'photoshop.documents.new_doc_resolution', 'photoshop.documents.new_doc_color_mode', 'photoshop.documents.new_doc_background_contents', 'photoshop.documents.new_doc_color_profile', 'photoshop.documents.preset_details', 'photoshop.documents.new_doc_pixel_aspect_ratio', 'photoshop.documents.new_doc_artboards'],
        handler: (a) => {
            const w = num(a.width, { min: 1, max: 300000, name: 'width' });
            const h = num(a.height, { min: 1, max: 300000, name: 'height' });
            const res = num(a.resolution ?? 72, { min: 1, max: 10000, name: 'resolution' });
            const mode = enumOf(a.mode ?? 'rgb', Object.keys(MODES), { name: 'mode' });
            const fill = enumOf(a.fill ?? 'white', Object.keys(FILLS), { name: 'fill' });
            const depth = enumOf(String(a.bitsPerChannel ?? 8), Object.keys(DEPTHS), { name: 'bitsPerChannel' });
            const par = a.pixelAspectRatio !== undefined ? num(a.pixelAspectRatio, { min: 0.1, max: 10, name: 'pixelAspectRatio' }) : '1';
            if (a.artboard) {
                // The make-document descriptor measures width and height in points (1/72 inch).
                const AM_MODES = { rgb: 'RGBColorMode', cmyk: 'CMYKColorMode', grayscale: 'grayscaleMode', lab: 'labColorMode', bitmap: 'bitmapMode' };
                const AM_FILLS = { white: 'white', transparent: 'transparent', background: 'backgroundColor' };
                return run('Create document', script(`
var n = new ActionDescriptor(), d = new ActionDescriptor();
n.putBoolean(app.stringIDToTypeID("artboard"), true);
n.putClass(app.stringIDToTypeID("mode"), app.stringIDToTypeID(${str(AM_MODES[mode])}));
n.putUnitDouble(app.stringIDToTypeID("width"), app.stringIDToTypeID("distanceUnit"), ${w} * 72 / ${res});
n.putUnitDouble(app.stringIDToTypeID("height"), app.stringIDToTypeID("distanceUnit"), ${h} * 72 / ${res});
n.putUnitDouble(app.stringIDToTypeID("resolution"), app.stringIDToTypeID("densityUnit"), ${res});
n.putDouble(app.stringIDToTypeID("pixelScaleFactor"), ${par});
n.putEnumerated(app.stringIDToTypeID("fill"), app.stringIDToTypeID("fill"), app.stringIDToTypeID(${str(AM_FILLS[fill])}));
n.putInteger(app.stringIDToTypeID("depth"), ${depth});
${a.name ? `n.putString(app.stringIDToTypeID("name"), ${str(a.name)});` : ''}
${a.colorProfile ? `n.putString(app.stringIDToTypeID("profile"), ${str(a.colorProfile)});` : ''}
d.putObject(app.stringIDToTypeID("new"), app.stringIDToTypeID("document"), n);
app.executeAction(app.stringIDToTypeID("make"), d, DialogModes.NO);
__result__ = __docInfo(app.activeDocument);`, { needsDocument: false }));
            }
            return run('Create document', script(`
var d = app.documents.add(${w}, ${h}, ${res},
  ${a.name ? str(a.name) : 'undefined'}, NewDocumentMode.${MODES[mode]},
  DocumentFill.${FILLS[fill]}, ${par},
  BitsPerChannelType.${DEPTHS[depth]}${a.colorProfile ? `, ${str(a.colorProfile)}` : ''});
__result__ = __docInfo(d);`, { needsDocument: false }));
        },
    },
    {
        name: 'open_document',
        description: 'Open a file (File > Open, Open As): PSD, PSB, TIFF, JPEG, PNG, GIF, BMP, PDF, EPS, DCS, camera raw and DNG, HEIF, WebP, AVIF, JPEG XL, JPEG 2000, OpenEXR, Radiance, Cineon, DICOM, IFF, PCX, PICT, Pixar, PBM, Scitex CT, Targa, WBMP, Photoshop 2.0, Photoshop Raw, video and audio (as video layers), or a .psdt template (which opens as a new untitled document). openAs reads the file as PDF, EPS, Photoshop Raw or DICOM with that format\'s options, also when the extension does not match the contents',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path' },
                asSmartObject: { type: 'boolean', description: 'Open as a smart object. Default false', default: false },
                openAs: { type: 'string', enum: Object.keys(OPEN_OPTIONS), description: 'Read the file as this format, with options. pdf: a generic (not Photoshop) PDF page or image, rasterized (Import PDF). eps: rasterize generic EPS. raw: headerless Photoshop Raw data. dicom: medical images' },
                options: {
                    type: 'object',
                    description: Object.entries(OPEN_OPTIONS).map(([k, v]) => `${k}: ${describeOptions(v.table)}`).join('. '),
                },
            },
            required: ['filePath'],
        },
        auditArgs: { openAs: 'pdf', options: { page: 2, cropTo: 'trim_box', width: 1200, resolution: 300, mode: 'cmyk', bitsPerChannel: '16', antiAlias: true, suppressWarnings: true } },
        features: ['photoshop.documents.open', 'photoshop.import_export.open_as_smart_object', 'photoshop.documents.template_files', 'photoshop.documents.open_as', 'photoshop.documents.format_mismatch_open',
            'photoshop.import_export.open_pdf', 'photoshop.import_export.pdf_open_select', 'photoshop.import_export.pdf_open_name', 'photoshop.import_export.pdf_open_crop_to', 'photoshop.import_export.pdf_open_image_size', 'photoshop.import_export.pdf_open_resolution_mode', 'photoshop.import_export.pdf_open_anti_alias', 'photoshop.import_export.pdf_open_suppress_warnings',
            'photoshop.import_export.open_eps', 'photoshop.import_export.open_raw_format', 'photoshop.import_export.open_dicom',
            'photoshop.import_export.format_portable_bitmap', 'photoshop.import_export.format_scitex_ct', 'photoshop.import_export.format_wbmp', 'photoshop.import_export.format_pcx', 'photoshop.import_export.format_pict', 'photoshop.import_export.format_cineon', 'photoshop.import_export.format_dicom', 'photoshop.import_export.format_iff', 'photoshop.import_export.format_jpeg2000', 'photoshop.import_export.format_openexr', 'photoshop.import_export.format_radiance', 'photoshop.import_export.format_heif', 'photoshop.import_export.format_webp', 'photoshop.import_export.format_avif', 'photoshop.import_export.format_jpeg_xl', 'photoshop.import_export.format_photoshop_2', 'photoshop.import_export.format_dng', 'photoshop.import_export.video_import_formats'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            let opts = 'undefined', lines = '';
            if (a.openAs !== undefined) {
                const fmt = OPEN_OPTIONS[enumOf(a.openAs, Object.keys(OPEN_OPTIONS), { name: 'openAs' })];
                lines = `var oo = new ${fmt.cls}();\n${optionLines(fmt.table, a.options, { name: 'options', target: 'oo', what: `Opening as ${a.openAs}` })}`;
                opts = 'oo';
            } else if (a.options !== undefined) {
                throw new Error('options need openAs: pdf, eps, raw or dicom');
            }
            return run('Open document', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
${lines}
var d = app.open(f, ${opts}, ${bool(a.asSmartObject)});
__result__ = __docInfo(d);`, { needsDocument: false }));
        },
    },
    {
        name: 'save_document',
        description: 'Save the active document in place, or at filePath in the format its extension names, with that format\'s options (File > Save As): PSD, PSB (Large Document Format), TIFF, PNG, JPEG, Photoshop PDF, GIF, Photoshop EPS, DCS 1.0 and 2.0 (.eps with epsType), BMP, Targa (.tga), Pixar (.pxr) or Photoshop Raw (.raw). With asCopy the document keeps referring to its own file',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: `Absolute path ending in ${SAVE_FORMATS.join(', ')}. Omit to save in place` },
                asCopy: { type: 'boolean', description: 'Save a copy. Default false', default: false },
                layers: { type: 'boolean', description: 'PSD, TIFF, PDF: keep layers' },
                embedColorProfile: { type: 'boolean', description: 'Embed the colour profile (PSD, TIFF, JPEG, PDF, EPS, DCS). Default true' },
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
                notes: { type: 'boolean', description: 'PSD, TIFF, PDF: save the document\'s notes with it (the Notes save option)' },
                epsType: { type: 'string', enum: ['eps', 'dcs1', 'dcs2'], description: '.eps files: Photoshop EPS (default), Photoshop DCS 1.0 or DCS 2.0 (CMYK documents; DCS 2.0 keeps spot channels)' },
                options: {
                    type: 'object',
                    description: `More options for the format. ${Object.entries(SAVE_OPTIONS).filter(([, t]) => Object.keys(t).length).map(([k, t]) => `${k.toUpperCase()}: ${describeOptions(t)}`).join('. ')}`,
                },
            },
        },
        hints: { destructive: true, idempotent: true },
        features: ['photoshop.documents.save', 'photoshop.documents.save_as', 'photoshop.documents.save_a_copy', 'photoshop.import_export.format_psd', 'photoshop.import_export.format_tiff', 'photoshop.import_export.format_png', 'photoshop.import_export.format_jpeg', 'photoshop.import_export.format_photoshop_pdf', 'photoshop.import_export.save_option_layers', 'photoshop.import_export.save_option_alpha', 'photoshop.import_export.save_option_spot', 'photoshop.import_export.save_option_color', 'photoshop.import_export.tiff_image_compression', 'photoshop.import_export.tiff_transparency', 'photoshop.import_export.png_compression', 'photoshop.import_export.png_interlace', 'photoshop.import_export.jpeg_quality', 'photoshop.import_export.jpeg_format_options', 'photoshop.import_export.pdf_preset', 'photoshop.import_export.pdf_standard', 'photoshop.import_export.pdf_preserve_editing',
            'photoshop.import_export.save_option_notes', 'photoshop.import_export.format_psb', 'photoshop.import_export.format_gif', 'photoshop.import_export.format_eps', 'photoshop.import_export.format_dcs1', 'photoshop.import_export.format_dcs2', 'photoshop.import_export.format_photoshop_raw', 'photoshop.import_export.format_bmp', 'photoshop.import_export.format_targa', 'photoshop.import_export.format_pixar',
            'photoshop.import_export.jpeg_matte', 'photoshop.import_export.gif_options', 'photoshop.import_export.tiff_pixel_order', 'photoshop.import_export.tiff_byte_order', 'photoshop.import_export.tiff_image_pyramid', 'photoshop.import_export.tiff_layer_compression',
            'photoshop.import_export.eps_preview', 'photoshop.import_export.eps_encoding', 'photoshop.import_export.eps_halftone_transfer', 'photoshop.import_export.eps_transparent_whites', 'photoshop.import_export.eps_ps_color_management', 'photoshop.import_export.eps_vector_data', 'photoshop.import_export.eps_interpolation', 'photoshop.import_export.dcs_composite', 'photoshop.import_export.dcs_multi_file',
            'photoshop.import_export.bmp_depth', 'photoshop.import_export.bmp_rle_flip', 'photoshop.import_export.targa_resolution', 'photoshop.import_export.targa_rle',
            'photoshop.import_export.pdf_compatibility', 'photoshop.import_export.pdf_description', 'photoshop.import_export.pdf_embed_thumbnail', 'photoshop.import_export.pdf_optimize_web', 'photoshop.import_export.pdf_view_after_saving', 'photoshop.import_export.pdf_downsample', 'photoshop.import_export.pdf_compression', 'photoshop.import_export.pdf_tile_size', 'photoshop.import_export.pdf_convert_8bit', 'photoshop.import_export.pdf_color_conversion', 'photoshop.import_export.pdf_profile_inclusion', 'photoshop.import_export.pdf_output_intent', 'photoshop.import_export.pdf_vector_fonts'],
        handler: (a) => {
            if (!a.filePath) {
                if (a.options !== undefined || a.epsType !== undefined || a.notes !== undefined) throw new Error('Format options need filePath');
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
            if (a.epsType !== undefined && ext !== '.eps') throw new Error('epsType is for .eps files');
            if (a.epsType !== undefined) enumOf(a.epsType, ['eps', 'dcs1', 'dcs2'], { name: 'epsType' });
            if (a.notes !== undefined && !['.psd', '.tif', '.tiff', '.pdf'].includes(ext)) throw new Error('notes can be saved in PSD, TIFF and PDF files');
            if (a.options !== undefined && (typeof a.options !== 'object' || Array.isArray(a.options))) throw new Error("'options' must be an object");
            const body = ext === '.psb' ? psbSaveLines(a) : `${saveOptionLines(ext, a)}
doc.saveAs(target, o, ${bool(a.asCopy)}, Extension.LOWERCASE);`;
            return run('Save document', script(`
var target = new File(${jsxPath(p)});
${body}
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
        features: ['photoshop.documents.documents_collection', 'photoshop.ui.cycle_documents', 'photoshop.ui.document_window'],
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
