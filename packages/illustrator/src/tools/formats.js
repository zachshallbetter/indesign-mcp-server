/**
 * Other file formats: Photoshop, TIFF, GIF and PNG-8, AutoCAD, the selection as
 * an Illustrator file, and placing text files.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script, WRITTEN_FN } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec, artboardRange } from '../args.js';
import { AUTOCAD_UNITS, extOf } from '../import-options.js';
import { paths } from './documents.js';
import { perArtboardExport, matteLines } from './output.js';

const RANGE_SCHEMA = { type: 'string', description: 'Artboards to export, 1-based like Illustrator: "1", "1-3,5". Default all' };
const COLOR_MODELS = { rgb: 'RGB', cmyk: 'CMYK', grayscale: 'GrayScale' };
const TIFF_ANTI_ALIAS = { art_optimized: 'ARTOPTIMIZED', type_optimized: 'TYPEOPTIMIZED', none: 'None' };
const BYTE_ORDERS = { ibm_pc: 'IBMPC', macintosh: 'MACINTOSH' };
const REDUCTIONS = { perceptual: 'PERCEPTUAL', selective: 'SELECTIVE', adaptive: 'ADAPTIVE', web: 'WEB' };
const DITHERS = { none: 'NOREDUCTION', diffusion: 'DIFFUSION', pattern: 'PATTERNDITHER', noise: 'NOISE' };
const CAD_VERSIONS = { r13: 'AutoCADRelease13', r14: 'AutoCADRelease14', r15: 'AutoCADRelease15', r18: 'AutoCADRelease18', r21: 'AutoCADRelease21', r24: 'AutoCADRelease24' };
const CAD_COLORS = { 8: 'Max8Colors', 16: 'Max16Colors', 256: 'Max256Colors', true_color: 'TrueColors' };
const TEXT_ENCODINGS = { utf8: 'UTF-8', utf16: 'UTF-16', latin1: 'ISO-8859-1' };
const MAX_TEXT_BYTES = 1024 * 1024;

const COLOR_MODEL_SCHEMA = { type: 'string', enum: Object.keys(COLOR_MODELS), description: 'rgb, cmyk or grayscale. Default the document\'s colour mode' };
const RESOLUTION_SCHEMA = { type: 'number', minimum: 72, maximum: 2400, description: 'Pixels per inch: 72 screen, 150 medium, 300 high. Default 150' };
const USE_ARTBOARDS_SCHEMA = { type: 'boolean', description: 'One file per artboard (Illustrator adds the artboard name). False exports all artwork as one image. Default true', default: true };

/** `o.imageColorSpace`, defaulting to the document's colour mode. */
function colorModelLine(value) {
    if (value === undefined) return 'o.imageColorSpace = doc.documentColorSpace === DocumentColorSpace.CMYK ? ImageColorSpace.CMYK : ImageColorSpace.RGB;';
    return `o.imageColorSpace = ImageColorSpace.${COLOR_MODELS[enumOf(value, Object.keys(COLOR_MODELS), { name: 'colorModel' })]};`;
}

/** Export As to one file (or one per artboard); optionLines set up `o`. */
function exportAs(a, { label, exts, type, optionLines }) {
    const out = paths.validate(a.outputFile);
    const ext = extOf(out);
    if (!exts.includes(ext)) throw new Error(`outputFile must end in ${exts.map((e) => `.${e}`).join(' or ')}`);
    const useArtboards = a.useArtboards ?? true;
    if (a.artboards !== undefined && !useArtboards) throw new Error("'artboards' applies with useArtboards: true");
    const range = artboardRange(a.artboards);
    return run(label, script(`${WRITTEN_FN}
var target = new File(${jsxPath(out)}), since = new Date().getTime();
${optionLines}
o.saveMultipleArtboards = ${bool(useArtboards)};
${range ? `o.artboardRange = ${str(range)};` : ''}
doc.exportFile(target, ExportType.${type}, o);
__result__ = { files: __written(target.parent, "*.${ext}", since), artboards: ${str(useArtboards ? (range || 'all') : 'none')} };`));
}

/** ExportOptionsGIF or ExportOptionsPNG8 as `o`. */
function indexedOptions(a, gif) {
    const lines = [
        `var o = new ExportOptions${gif ? 'GIF' : 'PNG8'}();`,
        `o.artBoardClipping = ${bool(a.clipToArtboard ?? true)};`,
        `o.colorCount = ${index(a.colors ?? 128, { name: 'colors', max: 256 })};`,
        `o.colorReduction = ColorReductionMethod.${REDUCTIONS[enumOf(a.reduction ?? 'selective', Object.keys(REDUCTIONS), { name: 'reduction' })]};`,
        `o.colorDither = ColorDitherMethod.${DITHERS[enumOf(a.dither ?? 'diffusion', Object.keys(DITHERS), { name: 'dither' })]};`,
        `o.transparency = ${bool(a.transparent ?? true)};`,
        `o.interlaced = ${bool(a.interlaced)};`,
        `o.webSnap = ${num(a.webSnap ?? 0, { min: 0, max: 100, name: 'webSnap' })};`,
        `o.antiAliasing = ${bool(a.antiAlias ?? true)};`,
        `o.horizontalScale = ${num(a.scale ?? 100, { min: 1, max: 7760, name: 'scale' })};`,
        `o.verticalScale = ${num(a.verticalScale ?? a.scale ?? 100, { min: 1, max: 7760, name: 'verticalScale' })};`,
        `o.saveAsHTML = ${bool(a.saveAsHtml)};`,
    ];
    if (Number(a.colors ?? 128) < 2) throw new Error("'colors' must be 2-256");
    if (a.ditherAmount !== undefined) {
        if ((a.dither ?? 'diffusion') !== 'diffusion') throw new Error("'ditherAmount' applies with dither: \"diffusion\"");
        lines.push(`o.ditherPercent = ${num(a.ditherAmount, { min: 0, max: 100, name: 'ditherAmount' })};`);
    }
    if (a.lossy !== undefined) {
        if (!gif) throw new Error("'lossy' applies to GIF only");
        lines.push(`o.infoLossPercent = ${num(a.lossy, { min: 0, max: 100, name: 'lossy' })};`);
    }
    if (a.matteColor !== undefined) lines.push(/^none$/i.test(String(a.matteColor).trim()) ? 'o.matte = false;' : matteLines(a.matteColor));
    return lines.join('\n');
}

export const tools = [
    {
        name: 'export_psd',
        description: 'Export as a Photoshop file (File > Export > Export As > Photoshop): colour model, resolution, layers, editable text, maximum editability, anti-aliasing, ICC profile, one file per artboard',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .psd path' },
                useArtboards: USE_ARTBOARDS_SCHEMA,
                artboards: RANGE_SCHEMA,
                colorModel: COLOR_MODEL_SCHEMA,
                resolution: RESOLUTION_SCHEMA,
                writeLayers: { type: 'boolean', description: 'Keep layers as Photoshop layers instead of flattening. Default true', default: true },
                editableText: { type: 'boolean', description: 'Keep text editable where possible. Default true', default: true },
                maximumEditability: { type: 'boolean', description: 'Write each top-level sublayer as a layer to keep as much editable as possible. Default true', default: true },
                antiAlias: { type: 'boolean', description: 'Anti-alias the artwork. Default true', default: true },
                embedIccProfile: { type: 'boolean', description: 'Embed the colour profile. Default false', default: false },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.export_psd',
            'illustrator.import_export.export_as',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.psd_option.color_model_psd',
            'illustrator.import_export.psd_option.resolution_psd',
            'illustrator.import_export.psd_option.write_layers',
            'illustrator.import_export.psd_option.preserve_text_editability',
            'illustrator.import_export.psd_option.maximum_editability',
            'illustrator.import_export.psd_option.anti_alias_psd',
            'illustrator.import_export.psd_option.embed_icc_profile_psd',
            'illustrator.import_export.psd_option.use_artboards_psd',
        ],
        hints: { idempotent: true },
        auditArgs: { outputFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.psd'), artboards: '1-2', colorModel: 'cmyk', resolution: 300 },
        handler: (a) => exportAs(a, {
            label: 'Export PSD',
            exts: ['psd'],
            type: 'PHOTOSHOP',
            optionLines: `var o = new ExportOptionsPhotoshop();
${colorModelLine(a.colorModel)}
o.resolution = ${num(a.resolution ?? 150, { min: 72, max: 2400, name: 'resolution' })};
o.writeLayers = ${bool(a.writeLayers ?? true)};
o.editableText = ${bool(a.editableText ?? true)};
o.maximumEditability = ${bool(a.maximumEditability ?? true)};
o.antiAliasing = ${bool(a.antiAlias ?? true)};
o.embedICCProfile = ${bool(a.embedIccProfile)};
o.warnings = false;`,
        }),
    },
    {
        name: 'export_tiff',
        description: 'Export as TIFF (File > Export > Export As > TIFF): colour model, resolution, anti-aliasing, LZW compression, byte order, ICC profile, one file per artboard',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .tif or .tiff path' },
                useArtboards: USE_ARTBOARDS_SCHEMA,
                artboards: RANGE_SCHEMA,
                colorModel: COLOR_MODEL_SCHEMA,
                resolution: RESOLUTION_SCHEMA,
                antiAlias: { type: 'string', enum: Object.keys(TIFF_ANTI_ALIAS), description: 'art_optimized (default), type_optimized or none' },
                lzw: { type: 'boolean', description: 'LZW compression. Default false', default: false },
                byteOrder: { type: 'string', enum: Object.keys(BYTE_ORDERS), description: 'ibm_pc (default) or macintosh' },
                embedIccProfile: { type: 'boolean', description: 'Embed the colour profile. Default false', default: false },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.export_tiff',
            'illustrator.import_export.export_as',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.tiff_option.color_model_tiff',
            'illustrator.import_export.tiff_option.resolution_tiff',
            'illustrator.import_export.tiff_option.anti_aliasing_tiff',
            'illustrator.import_export.tiff_option.lzw_compression',
            'illustrator.import_export.tiff_option.byte_order',
            'illustrator.import_export.tiff_option.embed_icc_profile_tiff',
            'illustrator.import_export.tiff_option.use_artboards_tiff',
        ],
        hints: { idempotent: true },
        auditArgs: { outputFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.tif'), artboards: '1', antiAlias: 'none', resolution: 300 },
        handler: (a) => exportAs(a, {
            label: 'Export TIFF',
            exts: ['tif', 'tiff'],
            type: 'TIFF',
            optionLines: `var o = new ExportOptionsTIFF();
${colorModelLine(a.colorModel)}
o.resolution = ${num(a.resolution ?? 150, { min: 72, max: 2400, name: 'resolution' })};
o.antiAliasing = AntiAliasingMethod.${TIFF_ANTI_ALIAS[enumOf(a.antiAlias ?? 'art_optimized', Object.keys(TIFF_ANTI_ALIAS), { name: 'antiAlias' })]};
o.lZWCompression = ${bool(a.lzw)};
o.byteOrder = TIFFByteOrder.${BYTE_ORDERS[enumOf(a.byteOrder ?? 'ibm_pc', Object.keys(BYTE_ORDERS), { name: 'byteOrder' })]};
o.embedICCProfile = ${bool(a.embedIccProfile)};`,
        }),
    },
    {
        name: 'export_web_image',
        description: 'Export artboards as GIF or PNG-8 with a reduced colour table, one per artboard (File > Export > Save for Web (Legacy)): colours, reduction, dither, transparency, matte, web snap, lossy GIF, interlacing, scale, HTML',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['gif', 'png8'], description: 'gif or png8' },
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                artboards: RANGE_SCHEMA,
                clipToArtboard: { type: 'boolean', description: 'Crop each image to its artboard. False writes one image of all the artwork. Default true', default: true },
                colors: { type: 'integer', minimum: 2, maximum: 256, description: 'Colours in the colour table. Default 128' },
                reduction: { type: 'string', enum: Object.keys(REDUCTIONS), description: 'Colour reduction: perceptual, selective (default), adaptive or web' },
                dither: { type: 'string', enum: Object.keys(DITHERS), description: 'none, diffusion (default), pattern or noise' },
                ditherAmount: { type: 'number', minimum: 0, maximum: 100, description: 'Percent, with diffusion dither' },
                lossy: { type: 'number', minimum: 0, maximum: 100, description: 'GIF only: lossy compression, 0-100. Default 0' },
                transparent: { type: 'boolean', description: 'Keep transparency. Default true', default: true },
                matteColor: { type: 'string', description: 'Blend edges (and, with transparent false, the background) against #RRGGBB, or "none". Default white' },
                webSnap: { type: 'number', minimum: 0, maximum: 100, description: 'Percent tolerance for shifting colours to the web palette. Default 0' },
                interlaced: { type: 'boolean', description: 'Interlaced image. Default false', default: false },
                antiAlias: { type: 'boolean', default: true },
                scale: { type: 'number', minimum: 1, maximum: 7760, description: 'Percent. Default 100' },
                verticalScale: { type: 'number', minimum: 1, maximum: 7760, description: 'Vertical percent when different from scale' },
                saveAsHtml: { type: 'boolean', description: 'Also write an HTML page showing each image. Default false', default: false },
                prefix: { type: 'string', description: 'File name prefix. Default the document name' },
            },
            required: ['format', 'outputFolder'],
        },
        features: [
            'illustrator.import_export.save_for_web',
            'illustrator.import_export.web_gif',
            'illustrator.import_export.web_png',
            'illustrator.artboards.artboard_export',
            ...['colors', 'color_reduction', 'dither', 'dither_amount', 'transparency', 'interlaced', 'web_snap', 'anti_aliasing', 'clip_to_artboard', 'matte', 'matte_color', 'horizontal_scale', 'vertical_scale', 'save_as_html']
                .flatMap((o) => [`illustrator.import_export.png8_option.${o}_png_8`, `illustrator.import_export.gif_option.${o}_gif`]),
            'illustrator.import_export.gif_option.lossy',
        ],
        hints: { idempotent: true },
        auditArgs: { format: 'gif', artboards: '1-2', matteColor: '#FFFFFF', dither: 'diffusion', reduction: 'web' },
        handler: (a) => {
            const format = enumOf(a.format, ['gif', 'png8'], { name: 'format' });
            const gif = format === 'gif';
            const ext = gif ? 'gif' : 'png';
            const optionLines = indexedOptions(a, gif);
            const type = gif ? 'GIF' : 'PNG8';
            if (a.clipToArtboard !== false) return run('Export web image', perArtboardExport(a, { ext, type, optionLines }));
            if (a.artboards !== undefined) throw new Error("'artboards' applies with clipToArtboard: true");
            const folder = paths.validate(a.outputFolder);
            return run('Export web image', script(`
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${optionLines}
var prefix = ${a.prefix ? str(a.prefix) : 'doc.name.replace(/\\.[^.]+$/, "")'};
var out = new File(folder.fsName + "/" + prefix + ".${ext}");
doc.exportFile(out, ExportType.${type}, o);
__result__ = { files: [out.fsName] };`));
        },
    },
    {
        name: 'export_autocad',
        description: 'Export as an AutoCAD drawing, DWG or DXF by the file extension (File > Export > Export As > AutoCAD): AutoCAD version, scale and units, line weights, colours, raster format, appearance or editability, selected art only, outlined text',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .dwg or .dxf path' },
                version: { type: 'string', enum: Object.keys(CAD_VERSIONS), description: 'AutoCAD release: r13, r14, r15 (2000), r18 (2004), r21 (2007), r24 (2010 and later)' },
                unit: { type: 'string', enum: Object.keys(AUTOCAD_UNITS), description: 'Unit that one drawing unit maps from' },
                unitRatio: { type: 'number', minimum: 0.001, maximum: 100000, description: 'Drawing units per unit, e.g. 1 for 1 millimeter = 1 unit' },
                scaleLineweights: { type: 'boolean', description: 'Scale line weights with the drawing' },
                colors: { type: 'string', enum: Object.keys(CAD_COLORS), description: 'Number of colours: 8, 16, 256 or true_color' },
                rasterFormat: { type: 'string', enum: ['png', 'jpeg'], description: 'Format for raster artwork' },
                preserve: { type: 'string', enum: ['appearance', 'editability'], description: 'Preserve appearance, or maximum editability' },
                selectedOnly: { type: 'boolean', description: 'Export only the selected artwork' },
                alterPaths: { type: 'boolean', description: 'Alter paths for appearance' },
                outlineText: { type: 'boolean', description: 'Convert text to outlines' },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.export_dwg',
            'illustrator.import_export.export_dxf',
            'illustrator.import_export.export_as',
            'illustrator.import_export.autocad_option.dwg_or_dxf',
            'illustrator.import_export.autocad_option.autocad_version',
            'illustrator.import_export.autocad_option.scale_units',
            'illustrator.import_export.autocad_option.scale_ratio',
            'illustrator.import_export.autocad_option.scale_lineweights',
            'illustrator.import_export.autocad_option.number_of_colors',
            'illustrator.import_export.autocad_option.raster_file_format',
            'illustrator.import_export.autocad_option.preserve_appearance_maximum_editability',
            'illustrator.import_export.autocad_option.export_selected_art_only',
            'illustrator.import_export.autocad_option.alter_paths_for_appearance',
            'illustrator.import_export.autocad_option.outline_text',
        ],
        hints: { idempotent: true },
        auditArgs: { outputFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.dwg'), colors: '256', version: 'r24', unit: 'millimeters' },
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const ext = extOf(out);
            if (ext !== 'dwg' && ext !== 'dxf') throw new Error('outputFile must end in .dwg or .dxf');
            const lines = [];
            const set = (prop, value) => lines.push(`o.${prop} = ${value};`);
            if (a.version !== undefined) set('version', `AutoCADCompatibility.${CAD_VERSIONS[enumOf(a.version, Object.keys(CAD_VERSIONS), { name: 'version' })]}`);
            if (a.unit !== undefined) set('unit', `AutoCADUnit.${AUTOCAD_UNITS[enumOf(a.unit, Object.keys(AUTOCAD_UNITS), { name: 'unit' })]}`);
            if (a.unitRatio !== undefined) set('unitScaleRatio', num(a.unitRatio, { min: 0.001, max: 100000, name: 'unitRatio' }));
            if (a.scaleLineweights !== undefined) set('scaleLineweights', bool(a.scaleLineweights));
            if (a.colors !== undefined) set('colors', `AutoCADColors.${CAD_COLORS[enumOf(String(a.colors), Object.keys(CAD_COLORS), { name: 'colors' })]}`);
            if (a.rasterFormat !== undefined) set('rasterFormat', `AutoCADRasterFormat.${enumOf(a.rasterFormat, ['png', 'jpeg'], { name: 'rasterFormat' }).toUpperCase()}`);
            if (a.preserve !== undefined) set('exportOption', `AutoCADExportOption.${enumOf(a.preserve, ['appearance', 'editability'], { name: 'preserve' }) === 'appearance' ? 'PreserveAppearance' : 'MaximumEditability'}`);
            if (a.selectedOnly !== undefined) set('exportSelectedArtOnly', bool(a.selectedOnly));
            if (a.alterPaths !== undefined) set('alterPathsForAppearance', bool(a.alterPaths));
            if (a.outlineText !== undefined) set('convertTextToOutlines', bool(a.outlineText));
            return run('Export AutoCAD', script(`
${a.selectedOnly ? 'if (!doc.selection || !doc.selection.length) throw new Error("selectedOnly needs a selection: select_items first");' : ''}
var target = new File(${jsxPath(out)});
var o = new ExportOptionsAutoCAD();
o.exportFileFormat = AutoCADExportFileFormat.${ext.toUpperCase()};
${lines.join('\n')}
doc.exportFile(target, ExportType.AUTOCAD, o);
__result__ = { exported: target.fsName, format: ${str(ext)} };`));
        },
    },
    {
        name: 'export_selection_as_ai',
        description: 'Write only the selected artwork (or the items given) to a new Illustrator file, leaving the document as it is (File > Export Selection as AI)',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .ai path' },
                target: TARGET_SCHEMA,
            },
            required: ['outputFile'],
        },
        features: ['illustrator.import_export.export_selection_ai'],
        hints: { idempotent: true },
        auditArgs: { outputFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.ai'), target: { selection: true } },
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (extOf(out) !== 'ai') throw new Error('outputFile must end in .ai');
            return run('Export selection as AI', script(`
${a.target ? `var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;` : ''}
if (!doc.selection || !doc.selection.length) throw new Error("Nothing is selected: pass target or select_items first");
var target = new File(${jsxPath(out)});
doc.exportSelectionAsAi(target);
__result__ = { exported: target.fsName, items: doc.selection.length };`));
        },
    },
    {
        name: 'place_text_file',
        description: 'Place the contents of a plain-text (.txt) file as type at x, y on an artboard (File > Place with a text file): point text, or area text when width and height are given',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .txt path' },
                encoding: { type: 'string', enum: Object.keys(TEXT_ENCODINGS), description: 'utf8 (default), utf16 or latin1' },
                artboardIndex: ARTBOARD_SCHEMA,
                x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 },
                width: { type: 'number', minimum: 1, description: 'Area text: box width in points' },
                height: { type: 'number', minimum: 1, description: 'Area text: box height in points' },
                layer: { type: 'string' },
                name: { type: 'string' },
            },
            required: ['filePath'],
        },
        features: ['illustrator.import_export.place_txt'],
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.txt'), width: 200, height: 100 },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (extOf(p) !== 'txt') throw new Error('filePath must end in .txt; place other files with place_image');
            const area = a.width !== undefined || a.height !== undefined;
            if (area && (a.width === undefined || a.height === undefined)) throw new Error('Area text needs both width and height');
            const encoding = TEXT_ENCODINGS[enumOf(a.encoding ?? 'utf8', Object.keys(TEXT_ENCODINGS), { name: 'encoding' })];
            return run('Place text file', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
if (f.length > ${MAX_TEXT_BYTES}) throw new Error("The text file is " + f.length + " bytes; place_text_file takes up to ${MAX_TEXT_BYTES}");
f.encoding = ${str(encoding)};
if (!f.open("r")) throw new Error("Cannot read " + f.fsName);
var contents = f.read();
f.close();
contents = contents.replace(/^\\uFEFF/, "").replace(/\\r\\n|\\n/g, "\\r");
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var p = __toDoc(doc, ab, ${num(a.x ?? 0, { name: 'x' })}, ${num(a.y ?? 0, { name: 'y' })}), t;
${area ? `var box = layer.pathItems.rectangle(p[1], p[0], __len(doc, ${num(a.width, { min: 1, name: 'width' })}), __len(doc, ${num(a.height, { min: 1, name: 'height' })}));
t = layer.textFrames.areaText(box);` : 't = layer.textFrames.pointText(p);'}
t.contents = contents;
${a.name ? `t.name = ${str(a.name)};` : ''}
var info = __itemInfo(doc, t);
info.kind = ${area ? '"area"' : '"point"'};
info.characters = contents.length;
__result__ = info;`));
        },
    },
];
