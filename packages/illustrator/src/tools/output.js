/**
 * Placing files, and exporting artwork.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath, json } from 'adobe-mcp-core';
import { script, WRITTEN_FN } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, artboardRange } from '../args.js';
import { paths } from './documents.js';
import { SCREEN_ADVANCED_SCHEMA, screenAdvanced, screenScales, screenItem } from './assets.js';

const RANGE_SCHEMA = { type: 'string', description: 'Artboards to export, 1-based like Illustrator: "1", "1-3,5". Default all' };

const SCREEN_FORMATS = { png: 'SE_PNG24', png8: 'SE_PNG8', jpg: 'SE_JPEG80', jpg100: 'SE_JPEG100', jpg50: 'SE_JPEG50', jpg20: 'SE_JPEG20', svg: 'SE_SVG', pdf: 'SE_PDF' };

/** Export As > SVG choices, by the names the dialog uses. */
const SVG_STYLING = { internal_css: 'STYLEELEMENTS', inline_style: 'STYLEATTRIBUTES', presentation_attributes: 'PRESENTATIONATTRIBUTES', entities: 'ENTITIES' };
const WEB_SVG_STYLING = ['internal_css', 'inline_style', 'presentation_attributes'];
const SVG_IMAGES = { embed: 'EMBED', link: 'LINK', preserve: 'PRESERVE' };
const SVG_IDS = { layer_names: 'SVGIDREGULAR', minimal: 'SVGIDMINIMAL', unique: 'SVGIDUNIQUE' };

/** PDF settings Illustrator's object model names, keyed the way the Save Adobe PDF dialog shows them. */
const PDF_COMPATIBILITY = { 'acrobat4': 'ACROBAT4', 'acrobat5': 'ACROBAT5', 'acrobat6': 'ACROBAT6', 'acrobat7': 'ACROBAT7', 'acrobat8': 'ACROBAT8' };
const PDF_STANDARDS = { none: 'PDFXNONE', 'x1a-2001': 'PDFX1A2001', 'x1a-2003': 'PDFX1A2003', 'x3-2002': 'PDFX32002', 'x3-2003': 'PDFX32003', 'x4': 'PDFX42007' };
const PDF_MARKS = { trim: 'trimMarks', registration: 'registrationMarks', color_bars: 'colorBars', page_info: 'pageInformation' };
const PDF_MARK_WEIGHTS = { '0.125': 'TRIMMARKWEIGHT0125', '0.25': 'TRIMMARKWEIGHT025', '0.5': 'TRIMMARKWEIGHT05' };
const PDF_COLOR_CONVERSION = { none: 'None', convert_to_destination: 'COLORCONVERSIONTODEST', preserve_numbers: 'COLORCONVERSIONREPURPOSE' };
const PDF_DESTINATIONS = { document_cmyk: 'COLORDESTINATIONDOCCMYK', working_cmyk: 'COLORDESTINATIONWORKINGCMYK', document_rgb: 'COLORDESTINATIONDOCRGB', working_rgb: 'COLORDESTINATIONWORKINGRGB' };
const PDF_PROFILES = { none: 'None', all: 'INCLUDEALLPROFILE', destination: 'INCLUDEDESTPROFILE', rgb: 'INCLUDERGBPROFILE', unchanged: 'LEAVEPROFILEUNCHANGED' };

/** A colour as #RRGGBB, for RGB-only options such as the JPEG matte. */
function hexColor(value, name) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value ?? '').trim());
    if (!m) throw new Error(`'${name}' must be a hex colour like #FFFFFF`);
    return m.slice(1).map((h) => parseInt(h, 16));
}

/** ExportOptionsPNG24 as `o`, from export_png's arguments. */
export function pngOptions(a) {
    return `var o = new ExportOptionsPNG24();
o.artBoardClipping = true;
o.horizontalScale = ${num(a.scale ?? 100, { min: 1, max: 7760, name: 'scale' })};
o.verticalScale = o.horizontalScale;
o.transparency = ${bool(a.transparent ?? true)};
o.antiAliasing = ${bool(a.antiAlias ?? true)};`;
}

/** ExportOptionsJPEG as `o`, from export_jpeg's arguments. */
export function jpegOptions(a) {
    const [r, g, b] = hexColor(a.matteColor ?? '#FFFFFF', 'matteColor');
    return `var o = new ExportOptionsJPEG();
o.artBoardClipping = true;
o.qualitySetting = ${index(a.quality ?? 80, { name: 'quality', max: 100 })};
o.horizontalScale = ${num(a.scale ?? 100, { min: 1, max: 7760, name: 'scale' })};
o.verticalScale = o.horizontalScale;
o.antiAliasing = ${bool(a.antiAlias ?? true)};
o.blurAmount = ${num(a.blur ?? 0, { min: 0, max: 2, name: 'blur' })};
o.optimization = ${bool(a.optimized ?? true)};
o.matte = true;
var mc = new RGBColor(); mc.red = ${r}; mc.green = ${g}; mc.blue = ${b};
o.matteColor = mc;`;
}

/** Export each wanted artboard to its own file; optionLines set up `o`. */
function perArtboardExport(a, { ext, type, optionLines }) {
    const folder = paths.validate(a.outputFolder);
    return script(`${RANGE_FN}
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${optionLines}
var wanted = __range(${str(artboardRange(a.artboards))}, doc.artboards.length), files = [];
var prefix = ${a.prefix ? str(a.prefix) : 'doc.name.replace(/\\.[^.]+$/, "")'};
var was = doc.artboards.getActiveArtboardIndex();
for (var k = 0; k < wanted.length; k++) {
  var i = wanted[k];
  doc.artboards.setActiveArtboardIndex(i);
  var out = new File(folder.fsName + "/" + prefix + "-" + doc.artboards[i].name.replace(/[\\/:*?"<>|]/g, "_") + ".${ext}");
  doc.exportFile(out, ExportType.${type}, o);
  files.push(out.fsName);
}
doc.artboards.setActiveArtboardIndex(was);
__result__ = { files: files };`);
}

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
        handler: (a) => run('Export PNG', perArtboardExport(a, {
            ext: 'png',
            type: 'PNG24',
            optionLines: pngOptions(a),
        })),
    },
    {
        name: 'export_jpeg',
        description: 'Export artboards as JPEG files, one per artboard, at a quality and scale (100 = 72 ppi, 300 = 216 ppi). Transparent areas are filled with the matte colour',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                artboards: RANGE_SCHEMA,
                quality: { type: 'integer', minimum: 0, maximum: 100, description: 'JPEG quality, 0-100. Default 80', default: 80 },
                scale: { type: 'number', minimum: 1, maximum: 7760, description: 'Percent. Default 100', default: 100 },
                antiAlias: { type: 'boolean', default: true },
                matteColor: { type: 'string', description: 'Background for transparent areas, #RRGGBB. Default #FFFFFF' },
                blur: { type: 'number', minimum: 0, maximum: 2, description: 'Blur in pixels, 0-2, to reduce file size. Default 0', default: 0 },
                optimized: { type: 'boolean', description: 'Optimised (smaller) encoding. Default true', default: true },
                prefix: { type: 'string', description: 'File name prefix. Default the document name' },
            },
            required: ['outputFolder'],
        },
        features: [
            'illustrator.import_export.export_jpeg',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.jpeg_option.quality',
            'illustrator.import_export.jpeg_option.horizontal_scale_jpeg',
            'illustrator.import_export.jpeg_option.vertical_scale_jpeg',
            'illustrator.import_export.jpeg_option.anti_aliasing_jpeg',
            'illustrator.import_export.jpeg_option.clip_to_artboard_jpeg',
            'illustrator.import_export.jpeg_option.matte_jpeg',
            'illustrator.import_export.jpeg_option.matte_color_jpeg',
            'illustrator.import_export.jpeg_option.blur',
            'illustrator.import_export.jpeg_option.optimized',
        ],
        handler: (a) => run('Export JPEG', perArtboardExport(a, { ext: 'jpg', type: 'JPEG', optionLines: jpegOptions(a) })),
    },
    {
        name: 'export_svg',
        description: 'Save artboards as SVG files with the full SVG options (File > Save As > SVG): editing data, slices, SVGZ compression. For lean SVG for the web use export_web_svg',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .svg or .svgz path (.svgz is compressed). With several artboards Illustrator adds the artboard name to each file' },
                artboards: RANGE_SCHEMA,
                outlineText: { type: 'boolean', description: 'Convert text to outlines in the SVG. Default false', default: false },
                embedImages: { type: 'boolean', description: 'Embed raster images instead of linking. Default true', default: true },
                precision: { type: 'integer', minimum: 1, maximum: 7, default: 3, description: 'Decimal places' },
                styling: { type: 'string', enum: Object.keys(SVG_STYLING), description: 'Where CSS properties go: internal_css (style elements, default), inline_style, presentation_attributes, entities' },
                preserveEditability: { type: 'boolean', description: 'Keep Illustrator editing data so the SVG reopens fully editable. Default false', default: false },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.save_svg',
            'illustrator.import_export.save_svgz',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.svg_option.use_artboards_svg',
            'illustrator.import_export.svg_option.type_fonts',
            'illustrator.import_export.svg_option.image_location',
            'illustrator.import_export.svg_option.decimal_places',
            'illustrator.import_export.svg_option.css_properties',
            'illustrator.import_export.svg_option.compressed_svgz',
            'illustrator.import_export.svg_option.preserve_illustrator_editing_capabilities',
        ],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const ext = path.extname(out).toLowerCase();
            if (ext !== '.svg' && ext !== '.svgz') throw new Error('outputFile must end in .svg or .svgz');
            const range = artboardRange(a.artboards);
            return run('Export SVG', script(`${WRITTEN_FN}
var target = new File(${jsxPath(out)}), since = new Date().getTime();
var o = new ExportOptionsSVG();
o.saveMultipleArtboards = true;
${range ? `o.artboardRange = ${str(range)};` : ''}
o.fontType = SVGFontType.${a.outlineText ? 'OUTLINEFONT' : 'SVGFONT'};
o.embedRasterImages = ${bool(a.embedImages ?? true)};
o.coordinatePrecision = ${index(a.precision ?? 3, { name: 'precision', max: 7 })};
o.cssProperties = SVGCSSPropertyLocation.${SVG_STYLING[enumOf(a.styling ?? 'internal_css', Object.keys(SVG_STYLING), { name: 'styling' })]};
o.compressed = ${ext === '.svgz'};
o.preserveEditability = ${bool(a.preserveEditability)};
doc.exportFile(target, ExportType.SVG, o);
__result__ = { files: __written(target.parent, "*${ext}", since), artboards: ${str(range || 'all')} };`));
        },
    },
    {
        name: 'export_web_svg',
        description: 'Export artboards as lean SVG for the web (File > Export > Export As > SVG): styling, object IDs, decimals, minify, responsive',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .svg path. With several artboards Illustrator adds the artboard name to each file' },
                artboards: RANGE_SCHEMA,
                styling: { type: 'string', enum: WEB_SVG_STYLING, description: 'internal_css (a style element, default), inline_style, or presentation_attributes' },
                outlineText: { type: 'boolean', description: 'Convert text to outlines instead of SVG text. Default false', default: false },
                images: { type: 'string', enum: Object.keys(SVG_IMAGES), description: 'embed, link, or preserve (keep each image as it is placed). Default preserve' },
                objectIds: { type: 'string', enum: Object.keys(SVG_IDS), description: 'layer_names (default), minimal, or unique' },
                decimals: { type: 'integer', minimum: 1, maximum: 7, default: 2, description: 'Decimal places for coordinates' },
                minify: { type: 'boolean', description: 'Strip whitespace and shorten the markup. Default false', default: false },
                responsive: { type: 'boolean', description: 'Omit width and height so the SVG scales to its container. Default true', default: true },
            },
            required: ['outputFile'],
        },
        features: [
            'illustrator.import_export.export_svg',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.svg_export_option.use_artboards_svg_export',
            'illustrator.import_export.svg_export_option.styling',
            'illustrator.import_export.svg_export_option.font',
            'illustrator.import_export.svg_export_option.images',
            'illustrator.import_export.svg_export_option.object_ids',
            'illustrator.import_export.svg_export_option.decimal',
            'illustrator.import_export.svg_export_option.minify',
            'illustrator.import_export.svg_export_option.responsive',
        ],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.svg') throw new Error('outputFile must end in .svg');
            const range = artboardRange(a.artboards);
            return run('Export web SVG', script(`${WRITTEN_FN}
var target = new File(${jsxPath(out)}), since = new Date().getTime();
var o = new ExportOptionsWebOptimizedSVG();
o.saveMultipleArtboards = true;
${range ? `o.artboardRange = ${str(range)};` : ''}
o.cssProperties = SVGCSSPropertyLocation.${SVG_STYLING[enumOf(a.styling ?? 'internal_css', WEB_SVG_STYLING, { name: 'styling' })]};
o.fontType = SVGFontType.${a.outlineText ? 'OUTLINEFONT' : 'SVGFONT'};
o.rasterImageLocation = RasterImageLocation.${SVG_IMAGES[enumOf(a.images ?? 'preserve', Object.keys(SVG_IMAGES), { name: 'images' })]};
o.svgId = SVGIdType.${SVG_IDS[enumOf(a.objectIds ?? 'layer_names', Object.keys(SVG_IDS), { name: 'objectIds' })]};
o.coordinatePrecision = ${index(a.decimals ?? 2, { name: 'decimals', max: 7 })};
o.svgMinify = ${bool(a.minify)};
o.svgResponsive = ${bool(a.responsive ?? true)};
doc.exportFile(target, ExportType.WOSVG, o);
__result__ = { files: __written(target.parent, "*.svg", since), artboards: ${str(range || 'all')} };`));
        },
    },
    {
        name: 'export_for_screens',
        description: 'Export artboards, collected assets (list_assets) and the full document in several formats and scales in one pass (File > Export > Export for Screens, and the Asset Export panel). Scales apply to PNG and JPEG',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                formats: { type: 'array', items: { type: 'string', enum: Object.keys(SCREEN_FORMATS) }, default: ['png'] },
                scales: { type: 'array', items: { type: 'number', minimum: 0.1 }, description: 'One export per value (Add Scale), e.g. [1, 2, 3]. Default [1]' },
                scaleBy: { type: 'string', enum: ['factor', 'width', 'height', 'resolution'], description: 'What scales mean: factor (2 = 2x, default), width or height in pixels, or resolution in ppi' },
                artboards: { ...RANGE_SCHEMA, description: 'Artboards to export, 1-based: "1", "1-3,5". Default all, or none when assets or fullDocument are given' },
                assets: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Asset ids to export (list_assets, collect_assets)' },
                fullDocument: { type: 'boolean', description: 'Also export the whole document as one file. Default false' },
                prefix: { type: 'string', description: 'File name prefix' },
                advanced: SCREEN_ADVANCED_SCHEMA,
                openFolder: { type: 'boolean', description: 'Open the folder when the export finishes. Default false' },
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
            'illustrator.asset_export.efs_option.assets',
            'illustrator.asset_export.efs_option.full_document',
            'illustrator.asset_export.efs_option.add_scale',
            'illustrator.asset_export.efs_option.advanced_settings',
            'illustrator.asset_export.efs_option.open_location_after_export',
            'illustrator.asset_export.asset_panel_option.export_settings',
            'illustrator.import_export.screens_png',
            'illustrator.import_export.screens_jpg',
            'illustrator.import_export.screens_svg',
            'illustrator.import_export.screens_pdf',
        ],
        auditArgs: {
            artboards: '1', scales: [1, 2], formats: ['png', 'png8', 'jpg', 'svg', 'pdf'],
            advanced: {
                png: { antiAliasing: 'art', transparency: true }, png8: { colors: 64 }, jpeg: { compression: 'progressive', scans: 3, embedProfile: true },
                svg: { styling: 'inline_style', fonts: 'outlines', images: 'link', objectIds: 'minimal', decimals: 2, minify: true, responsive: true }, pdf: { preset: '[Smallest File Size]' },
            },
        },
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const formats = (a.formats ?? ['png']).map((f) => SCREEN_FORMATS[enumOf(f, Object.keys(SCREEN_FORMATS), { name: 'formats' })]);
            const scale = screenScales(a);
            const range = artboardRange(a.artboards);
            return run('Export for screens', script(`
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${screenItem(a, range)}
${screenAdvanced(a.advanced)}
var formats = ${json(formats)}, scales = ${json(scale.values)}, tags = ${json(scale.tags)}, runs = 0;
for (var f = 0; f < formats.length; f++) {
  var type = ExportForScreensType[formats[f]], opts = null;
  var scaled = formats[f] === "SE_PNG24" || formats[f] === "SE_PNG8" || formats[f].indexOf("SE_JPEG") === 0;
  var passes = scaled ? scales : [1];
  for (var s = 0; s < passes.length; s++) {
    if (formats[f] === "SE_PNG24") opts = new ExportForScreensOptionsPNG24();
    else if (formats[f] === "SE_PNG8") opts = new ExportForScreensOptionsPNG8();
    else if (formats[f].indexOf("SE_JPEG") === 0) opts = new ExportForScreensOptionsJPEG();
    else if (formats[f] === "SE_SVG") opts = new ExportForScreensOptionsWebOptimizedSVG();
    else opts = new ExportForScreensPDFOptions();
    if (scaled) { opts.scaleType = ExportForScreensScaleType.${scale.type}; opts.scaleTypeValue = passes[s]; }
    __advanced(formats[f], opts);
    var prefix = ${a.prefix ? str(a.prefix) : '""'} + (scaled && passes.length > 1 ? tags[s] : "");
    doc.exportForScreens(folder, type, opts, item, prefix);
    runs++;
  }
}
${a.openFolder ? 'folder.execute();' : ''}
__result__ = { folder: folder.fsName, exports: runs, formats: ${json(a.formats ?? ['png'])}, scales: scales, scaleBy: ${str(a.scaleBy ?? 'factor')}, artboards: item.artboards, assets: assetIds, fullDocument: item.document };`));
        },
    },
    {
        name: 'export_pdf',
        description: 'Save a PDF copy of the document with a PDF preset (e.g. "[High Quality Print]", "[PDF/X-4:2008]"), optionally overriding its compatibility, PDF/X standard, bleed, printer\'s marks, colour conversion, output intent and Acrobat layers. The document must be saved first; it is reopened afterwards so you keep working on the .ai file',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute .pdf path' },
                preset: { type: 'string', description: 'PDF preset name as Illustrator lists it. Default "[High Quality Print]". The options below override it' },
                artboards: RANGE_SCHEMA,
                preserveEditability: { type: 'boolean', description: 'Keep Illustrator editing data in the PDF. Default false', default: false },
                compatibility: { type: 'string', enum: Object.keys(PDF_COMPATIBILITY), description: 'Acrobat version: acrobat4 (PDF 1.3) to acrobat8 (PDF 1.7)' },
                standard: { type: 'string', enum: Object.keys(PDF_STANDARDS), description: 'PDF/X standard. A PDF/X preset sets this and the matching compatibility for you' },
                bleed: { type: 'number', minimum: 0, maximum: 72, description: 'Bleed on every side, in points' },
                marks: {
                    type: 'array',
                    items: { type: 'string', enum: [...Object.keys(PDF_MARKS), 'all'] },
                    description: 'Printer\'s marks to add: trim, registration, color_bars, page_info, or all. An empty list removes them',
                },
                markType: { type: 'string', enum: ['roman', 'japanese'], description: 'Printer\'s mark style. Default roman' },
                trimMarkWeight: { type: 'string', enum: Object.keys(PDF_MARK_WEIGHTS), description: 'Trim mark weight in points' },
                markOffset: { type: 'number', minimum: 0, maximum: 72, description: 'Distance between the artboard and the marks, in points' },
                colorConversion: { type: 'string', enum: Object.keys(PDF_COLOR_CONVERSION), description: 'none; convert_to_destination; or preserve_numbers (convert only colours with a different profile)' },
                destination: { type: 'string', enum: Object.keys(PDF_DESTINATIONS), description: 'Destination colour space for conversion' },
                profileInclusion: { type: 'string', enum: Object.keys(PDF_PROFILES), description: 'Which ICC profiles to embed' },
                outputIntent: { type: 'string', description: 'PDF/X output intent profile name, e.g. "Coated FOGRA39 (ISO 12647-2:2004)"' },
                outputCondition: { type: 'string', description: 'PDF/X output condition description' },
                outputConditionId: { type: 'string', description: 'PDF/X output condition identifier, e.g. "FOGRA39"' },
                registryName: { type: 'string', description: 'PDF/X registry, e.g. "http://www.color.org"' },
                acrobatLayers: { type: 'boolean', description: 'Make Acrobat layers from top-level layers (acrobat6 or later)' },
                fastWebView: { type: 'boolean', description: 'Optimise for fast web view' },
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
            'illustrator.import_export.pdf_option.compatibility',
            'illustrator.import_export.pdf_option.standard',
            'illustrator.import_export.pdf_x',
            'illustrator.import_export.pdf_option.bleeds',
            'illustrator.import_export.pdf_option.link_bleed_values',
            'illustrator.import_export.pdf_option.trim_marks',
            'illustrator.import_export.pdf_option.registration_marks',
            'illustrator.import_export.pdf_option.color_bars',
            'illustrator.import_export.pdf_option.page_information',
            'illustrator.import_export.pdf_option_ui.all_printer_s_marks',
            'illustrator.import_export.pdf_option.printer_mark_type',
            'illustrator.import_export.pdf_option.trim_mark_weight',
            'illustrator.import_export.pdf_option.offset_marks',
            'illustrator.import_export.pdf_option.color_conversion',
            'illustrator.import_export.pdf_option.destination',
            'illustrator.import_export.pdf_option.profile_inclusion_policy',
            'illustrator.import_export.pdf_option.output_intent_profile_name',
            'illustrator.import_export.pdf_option.output_condition',
            'illustrator.import_export.pdf_option.output_condition_identifier',
            'illustrator.import_export.pdf_option.registry_name',
            'illustrator.import_export.pdf_option.create_acrobat_layers_from_top_level_layers',
            'illustrator.import_export.layered_pdf',
            'illustrator.import_export.pdf_option.optimize_for_fast_web_view',
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
o.viewAfterSaving = false;
${range ? `o.artboardRange = ${str(range)};` : ''}
${pdfOptionLines(a)}
doc.saveAs(new File(${jsxPath(out)}), o);
doc.close(SaveOptions.DONOTSAVECHANGES);
app.open(src);
__result__ = { exported: ${str(out)}, preset: preset, reopened: src.fsName };`));
        },
    },
];

/** ES3: "1-3,5" (1-based) -> [0,1,2,4]; "" -> every artboard. */
export const RANGE_FN = `
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

/** PDFSaveOptions statements for the options given; the preset supplies the rest. */
function pdfOptionLines(a) {
    const lines = [];
    const set = (prop, value) => lines.push(`o.${prop} = ${value};`);
    const pick = (value, table, name) => table[enumOf(value, Object.keys(table), { name })];
    if (a.compatibility !== undefined) set('compatibility', `PDFCompatibility.${pick(a.compatibility, PDF_COMPATIBILITY, 'compatibility')}`);
    if (a.standard !== undefined) set('pDFXStandard', `PDFXStandard.${pick(a.standard, PDF_STANDARDS, 'standard')}`);
    if (a.bleed !== undefined) {
        const b = num(a.bleed, { min: 0, max: 72, name: 'bleed' });
        set('bleedLink', 'true');
        set('bleedOffsetRect', `[${b}, ${b}, ${b}, ${b}]`);
    }
    if (a.marks !== undefined) {
        if (!Array.isArray(a.marks)) throw new Error("'marks' must be a list, e.g. [\"trim\", \"registration\"]");
        const wanted = new Set(a.marks.map((m) => enumOf(m, [...Object.keys(PDF_MARKS), 'all'], { name: 'marks' })));
        for (const [mark, prop] of Object.entries(PDF_MARKS)) set(prop, String(wanted.has('all') || wanted.has(mark)));
    }
    if (a.markType !== undefined) set('pageMarksType', `PageMarksTypes.${enumOf(a.markType, ['roman', 'japanese'], { name: 'markType' }) === 'roman' ? 'Roman' : 'Japanese'}`);
    if (a.trimMarkWeight !== undefined) set('trimMarkWeight', `PDFTrimMarkWeight.${pick(String(a.trimMarkWeight), PDF_MARK_WEIGHTS, 'trimMarkWeight')}`);
    if (a.markOffset !== undefined) set('offset', num(a.markOffset, { min: 0, max: 72, name: 'markOffset' }));
    if (a.colorConversion !== undefined) set('colorConversionID', `ColorConversion.${pick(a.colorConversion, PDF_COLOR_CONVERSION, 'colorConversion')}`);
    if (a.destination !== undefined) {
        if (a.colorConversion === 'none') throw new Error("'destination' needs a colorConversion other than none");
        set('colorDestinationID', `ColorDestination.${pick(a.destination, PDF_DESTINATIONS, 'destination')}`);
    }
    if (a.profileInclusion !== undefined) set('colorProfileID', `ColorProfile.${pick(a.profileInclusion, PDF_PROFILES, 'profileInclusion')}`);
    if (a.outputIntent !== undefined) set('outputIntentProfile', str(a.outputIntent));
    if (a.outputCondition !== undefined) set('outputCondition', str(a.outputCondition));
    if (a.outputConditionId !== undefined) set('outputConditionID', str(a.outputConditionId));
    if (a.registryName !== undefined) set('registryName', str(a.registryName));
    if (a.acrobatLayers !== undefined) {
        if (a.acrobatLayers && ['acrobat4', 'acrobat5'].includes(a.compatibility)) throw new Error('acrobatLayers needs compatibility acrobat6 or later');
        set('acrobatLayers', bool(a.acrobatLayers));
    }
    if (a.fastWebView !== undefined) set('optimization', bool(a.fastWebView));
    return lines.join('\n');
}
