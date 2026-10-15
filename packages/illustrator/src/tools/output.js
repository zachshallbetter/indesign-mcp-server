/**
 * Placing files, and exporting artwork.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA } from '../args.js';
import { paths } from './documents.js';

const RANGE_SCHEMA = { type: 'string', description: 'Artboards to export, 1-based like Illustrator: "1", "1-3,5". Default all' };

/** Validate an Illustrator artboard range string ("1-3,5"). */
function artboardRange(value) {
    if (value === undefined || value === null || value === '') return '';
    const v = String(value).replace(/\s+/g, '');
    if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(v)) throw new Error(`Invalid artboard range: ${value}. Use "1", "1-3" or "1,3,5"`);
    return v;
}

const SCREEN_FORMATS = { png: 'SE_PNG24', png8: 'SE_PNG8', jpg: 'SE_JPEG80', jpg100: 'SE_JPEG100', jpg50: 'SE_JPEG50', svg: 'SE_SVG', pdf: 'SE_PDF' };

export const tools = [
    {
        name: 'place_image',
        description: 'Place an image or other file (PNG, JPEG, TIFF, PSD, PDF, SVG, AI) at x, y on an artboard, linked or embedded. Give width to scale it proportionally',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path' },
                artboardIndex: ARTBOARD_SCHEMA,
                x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 },
                width: { type: 'number', minimum: 1, description: 'Scale proportionally to this width in points' },
                embed: { type: 'boolean', description: 'Embed instead of linking. Default false', default: false },
                layer: { type: 'string' },
                name: { type: 'string' },
            },
            required: ['filePath'],
        },
        features: [
            'illustrator.images.place',
            'illustrator.images.placed_item',
            'illustrator.images.place_option.link',
            'illustrator.images.embed',
            'illustrator.images.links_menu.embed_image',
            'illustrator.images.bitmap_import',
            'illustrator.import_export.place_png',
            'illustrator.import_export.place_jpeg',
            'illustrator.import_export.place_tiff',
            'illustrator.import_export.place_psd',
            'illustrator.import_export.place_pdf',
            'illustrator.import_export.place_svg',
            'illustrator.import_export.place_ai',
        ],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            return run('Place image', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var it = layer.placedItems.add();
it.file = f;
${a.width !== undefined ? `var s = __len(doc, ${num(a.width, { min: 1, name: 'width' })}) / it.width * 100; it.resize(s, s);` : ''}
var pos = __toDoc(doc, ab, ${num(a.x ?? 0, { name: 'x' })}, ${num(a.y ?? 0, { name: 'y' })});
it.position = pos;
${a.name ? `it.name = ${str(a.name)};` : ''}
${a.embed ? 'var info = __itemInfo(doc, it); it.embed(); info.embedded = true; __result__ = info;' : '__result__ = __itemInfo(doc, it);'}`));
        },
    },
    {
        name: 'export_png',
        description: 'Export artboards as PNG files, one per artboard, at a scale (100 = 72 ppi, 300 = 216 ppi)',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                artboards: RANGE_SCHEMA,
                scale: { type: 'number', minimum: 1, maximum: 7760, description: 'Percent. Default 100', default: 100 },
                transparent: { type: 'boolean', default: true },
                antiAlias: { type: 'boolean', default: true },
                prefix: { type: 'string', description: 'File name prefix. Default the document name' },
            },
            required: ['outputFolder'],
        },
        features: [
            'illustrator.import_export.export_png',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.png24_option.horizontal_scale_png_24',
            'illustrator.import_export.png24_option.vertical_scale_png_24',
            'illustrator.import_export.png24_option.transparency_png_24',
            'illustrator.import_export.png24_option.anti_aliasing_png_24',
            'illustrator.import_export.png24_option.clip_to_artboard_png_24',
        ],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            return run('Export PNG', script(`${RANGE_FN}
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
var o = new ExportOptionsPNG24();
o.artBoardClipping = true;
o.horizontalScale = ${num(a.scale ?? 100, { min: 1, max: 7760, name: 'scale' })};
o.verticalScale = o.horizontalScale;
o.transparency = ${bool(a.transparent ?? true)};
o.antiAliasing = ${bool(a.antiAlias ?? true)};
var wanted = __range(${str(artboardRange(a.artboards))}, doc.artboards.length), files = [];
var prefix = ${a.prefix ? str(a.prefix) : 'doc.name.replace(/\\.[^.]+$/, "")'};
var was = doc.artboards.getActiveArtboardIndex();
for (var k = 0; k < wanted.length; k++) {
  var i = wanted[k];
  doc.artboards.setActiveArtboardIndex(i);
  var out = new File(folder.fsName + "/" + prefix + "-" + doc.artboards[i].name.replace(/[\\/:*?"<>|]/g, "_") + ".png");
  doc.exportFile(out, ExportType.PNG24, o);
  files.push(out.fsName);
}
doc.artboards.setActiveArtboardIndex(was);
__result__ = { files: files };`));
        },
    },
    {
        name: 'export_svg',
        description: 'Export artboards as SVG files, one per artboard',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .svg path. With several artboards Illustrator adds the artboard name to each file' },
                artboards: RANGE_SCHEMA,
                outlineText: { type: 'boolean', description: 'Convert text to outlines in the SVG. Default false', default: false },
                embedImages: { type: 'boolean', description: 'Embed raster images instead of linking. Default true', default: true },
                precision: { type: 'integer', minimum: 1, maximum: 7, default: 3, description: 'Decimal places' },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.save_svg',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.svg_option.use_artboards_svg',
            'illustrator.import_export.svg_option.type_fonts',
            'illustrator.import_export.svg_option.image_location',
            'illustrator.import_export.svg_option.decimal_places',
        ],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const range = artboardRange(a.artboards);
            return run('Export SVG', script(`
var o = new ExportOptionsSVG();
o.saveMultipleArtboards = true;
${range ? `o.artboardRange = ${str(range)};` : ''}
o.fontType = SVGFontType.${a.outlineText ? 'OUTLINEFONT' : 'SVGFONT'};
o.embedRasterImages = ${bool(a.embedImages ?? true)};
o.coordinatePrecision = ${index(a.precision ?? 3, { name: 'precision', max: 7 })};
doc.exportFile(new File(${jsxPath(out)}), ExportType.SVG, o);
__result__ = { exported: ${str(out)}, artboards: ${str(range || 'all')} };`));
        },
    },
    {
        name: 'export_for_screens',
        description: 'Export artboards in several formats and scales in one pass (File > Export > Export for Screens). Scales apply to PNG and JPEG',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                formats: { type: 'array', items: { type: 'string', enum: Object.keys(SCREEN_FORMATS) }, default: ['png'] },
                scales: { type: 'array', items: { type: 'number', minimum: 0.1, maximum: 10 }, description: 'Scale factors, e.g. [1, 2, 3]. Default [1]' },
                artboards: RANGE_SCHEMA,
                prefix: { type: 'string', description: 'File name prefix' },
            },
            required: ['outputFolder'],
        },
        features: [
            'illustrator.asset_export.export_for_screens',
            'illustrator.artboards.artboard_export',
            'illustrator.asset_export.efs_option.artboards',
            'illustrator.asset_export.efs_option.format',
            'illustrator.asset_export.efs_option.scale',
            'illustrator.asset_export.efs_option.prefix',
            'illustrator.asset_export.efs_option.export_to',
            'illustrator.import_export.screens_png',
            'illustrator.import_export.screens_jpg',
            'illustrator.import_export.screens_svg',
            'illustrator.import_export.screens_pdf',
        ],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const formats = (a.formats ?? ['png']).map((f) => SCREEN_FORMATS[enumOf(f, Object.keys(SCREEN_FORMATS), { name: 'formats' })]);
            const scales = (a.scales ?? [1]).map((s) => Number(num(s, { min: 0.1, max: 10, name: 'scales' })));
            const range = artboardRange(a.artboards);
            return run('Export for screens', script(`
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
var item = new ExportForScreensItemToExport();
item.artboards = ${str(range || 'all')};
item.document = false;
var formats = ${json(formats)}, scales = ${json(scales)}, runs = 0;
for (var f = 0; f < formats.length; f++) {
  var type = ExportForScreensType[formats[f]], opts = null;
  var scaled = formats[f] === "SE_PNG24" || formats[f] === "SE_PNG8" || formats[f].indexOf("SE_JPEG") === 0;
  var passes = scaled ? scales : [1];
  for (var s = 0; s < passes.length; s++) {
    if (formats[f] === "SE_PNG24") { opts = new ExportForScreensOptionsPNG24(); opts.scaleType = ExportForScreensScaleType.SCALEBYFACTOR; opts.scaleTypeValue = passes[s]; }
    else if (formats[f] === "SE_PNG8") { opts = new ExportForScreensOptionsPNG8(); opts.scaleType = ExportForScreensScaleType.SCALEBYFACTOR; opts.scaleTypeValue = passes[s]; }
    else if (formats[f].indexOf("SE_JPEG") === 0) { opts = new ExportForScreensOptionsJPEG(); opts.scaleType = ExportForScreensScaleType.SCALEBYFACTOR; opts.scaleTypeValue = passes[s]; }
    else if (formats[f] === "SE_SVG") { opts = new ExportForScreensOptionsWebOptimizedSVG(); }
    else { opts = new ExportForScreensPDFOptions(); }
    var prefix = ${a.prefix ? str(a.prefix) : '""'} + (passes.length > 1 ? "@" + passes[s] + "x-" : "");
    doc.exportForScreens(folder, type, opts, item, prefix);
    runs++;
  }
}
__result__ = { folder: folder.fsName, exports: runs, formats: ${json(a.formats ?? ['png'])}, scales: scales };`));
        },
    },
    {
        name: 'export_pdf',
        description: 'Save a PDF copy of the document with a PDF preset (e.g. "[High Quality Print]", "[PDF/X-4:2008]"). The document must be saved first; it is reopened afterwards so you keep working on the .ai file',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .pdf path' },
                preset: { type: 'string', description: 'PDF preset name as Illustrator lists it. Default "[High Quality Print]"' },
                artboards: RANGE_SCHEMA,
                preserveEditability: { type: 'boolean', description: 'Keep Illustrator editing data in the PDF. Default false', default: false },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.save_pdf',
            'illustrator.import_export.export_pdf',
            'illustrator.import_export.pdf_presets',
            'illustrator.import_export.pdf_option.adobe_pdf_preset',
            'illustrator.import_export.pdf_option.preserve_illustrator_editing_capabilities',
            'illustrator.import_export.pdf_option.range_pdf',
            'illustrator.import_export.multipage_pdf',
        ],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.pdf') throw new Error('outputFile must end in .pdf');
            const range = artboardRange(a.artboards);
            return run('Export PDF', script(`
var src = null;
try { src = doc.fullName; } catch (e) { src = null; }
if (!src || !src.exists || !doc.saved) throw new Error("Save the document first (save_document): exporting a PDF copy reopens the saved .ai file afterwards");
var preset = ${str(a.preset ?? '[High Quality Print]')}, known = app.PDFPresetsList, found = false;
for (var i = 0; i < known.length; i++) if (known[i] === preset) found = true;
if (!found) throw new Error("PDF preset not found: " + preset + ". Available: " + known.join(", "));
var o = new PDFSaveOptions();
o.pDFPreset = preset;
o.preserveEditability = ${bool(a.preserveEditability)};
${range ? `o.artboardRange = ${str(range)};` : ''}
doc.saveAs(new File(${jsxPath(out)}), o);
doc.close(SaveOptions.DONOTSAVECHANGES);
app.open(src);
__result__ = { exported: ${str(out)}, preset: preset, reopened: src.fsName };`));
        },
    },
];

/** ES3: "1-3,5" (1-based) -> [0,1,2,4]; "" -> every artboard. */
const RANGE_FN = `
function __range(spec, count) {
  var out = [], i;
  if (!spec) { for (i = 0; i < count; i++) out.push(i); return out; }
  var parts = spec.split(",");
  for (var p = 0; p < parts.length; p++) {
    var ends = parts[p].split("-"), a = parseInt(ends[0], 10), b = ends.length > 1 ? parseInt(ends[1], 10) : a;
    for (i = a; i <= b; i++) {
      if (i < 1 || i > count) throw new Error("Artboard " + i + " is out of range 1-" + count);
      out.push(i - 1);
    }
  }
  return out;
}`;
