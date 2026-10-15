/**
 * Placing files, and exporting artwork.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath, json } from 'adobe-mcp-core';
import { script, WRITTEN_FN } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, artboardRange } from '../args.js';
import { paths } from './documents.js';
import { PLACE_EXTENSIONS, PDF_IMPORT_SCHEMA, AUTOCAD_IMPORT_SCHEMA, extOf, withImportOptions } from '../import-options.js';

const RANGE_SCHEMA = { type: 'string', description: 'Artboards to export, 1-based like Illustrator: "1", "1-3,5". Default all' };

const SCREEN_FORMATS = { png: 'SE_PNG24', png8: 'SE_PNG8', jpg: 'SE_JPEG80', jpg100: 'SE_JPEG100', jpg50: 'SE_JPEG50', svg: 'SE_SVG', pdf: 'SE_PDF' };

/** Export As > SVG choices, by the names the dialog uses. */
const SVG_STYLING = { internal_css: 'STYLEELEMENTS', inline_style: 'STYLEATTRIBUTES', presentation_attributes: 'PRESENTATIONATTRIBUTES', entities: 'ENTITIES' };
const WEB_SVG_STYLING = ['internal_css', 'inline_style', 'presentation_attributes'];
const SVG_IMAGES = { embed: 'EMBED', link: 'LINK', preserve: 'PRESERVE' };
const SVG_PROFILES = { 'svg_1.0': 'SVG1_0', 'svg_1.1': 'SVG1_1', 'basic_1.1': 'SVGBASIC1_1', 'tiny_1.1': 'SVGTINY1_1', 'tiny_1.1_plus': 'SVGTINY1_1PLUS', 'tiny_1.2': 'SVGTINY1_2' };
const SVG_SUBSETS = { none: 'None', glyphs_used: 'GLYPHSUSED', common_english: 'COMMONENGLISH', glyphs_used_plus_english: 'GLYPHSUSEDPLUSENGLISH', common_roman: 'COMMONROMAN', glyphs_used_plus_roman: 'GLYPHSUSEDPLUSROMAN', all_glyphs: 'ALLGLYPHS' };
const SVG_ENCODINGS = { ascii: 'ASCII', utf8: 'UTF8', utf16: 'UTF16' };
/** Save As SVG checkboxes: argument -> ExportOptionsSVG property. */
const SVG_FLAGS = {
    optimizeForSvgViewer: 'optimizeForSVGViewer', slices: 'slices', includeXmp: 'includeFileInfo', includeUnusedStyles: 'includeUnusedStyles',
    includeVariables: 'includeVariablesAndDatasets', fewerTspans: 'sVGAutoKerning', textOnPath: 'sVGTextOnPath',
};
const SVG_IDS = { layer_names: 'SVGIDREGULAR', minimal: 'SVGIDMINIMAL', unique: 'SVGIDUNIQUE' };

/** PDF settings Illustrator's object model names, keyed the way the Save Adobe PDF dialog shows them. */
const PDF_COMPATIBILITY = { 'acrobat4': 'ACROBAT4', 'acrobat5': 'ACROBAT5', 'acrobat6': 'ACROBAT6', 'acrobat7': 'ACROBAT7', 'acrobat8': 'ACROBAT8' };
const PDF_STANDARDS = { none: 'PDFXNONE', 'x1a-2001': 'PDFX1A2001', 'x1a-2003': 'PDFX1A2003', 'x3-2002': 'PDFX32002', 'x3-2003': 'PDFX32003', 'x4': 'PDFX42007' };
const PDF_MARKS = { trim: 'trimMarks', registration: 'registrationMarks', color_bars: 'colorBars', page_info: 'pageInformation' };
const PDF_MARK_WEIGHTS = { '0.125': 'TRIMMARKWEIGHT0125', '0.25': 'TRIMMARKWEIGHT025', '0.5': 'TRIMMARKWEIGHT05' };
const PDF_COLOR_CONVERSION = { none: 'None', convert_to_destination: 'COLORCONVERSIONTODEST', preserve_numbers: 'COLORCONVERSIONREPURPOSE' };
const PDF_DESTINATIONS = { document_cmyk: 'COLORDESTINATIONDOCCMYK', working_cmyk: 'COLORDESTINATIONWORKINGCMYK', document_rgb: 'COLORDESTINATIONDOCRGB', working_rgb: 'COLORDESTINATIONWORKINGRGB' };
const QUALITIES = ['minimum', 'low', 'medium', 'high', 'maximum'];
const PDF_COMPRESSION = {
    none: 'None', zip_8bit: 'ZIP8BIT', zip_4bit: 'ZIP4BIT',
    ...Object.fromEntries(QUALITIES.flatMap((q) => [
        [`jpeg_${q}`, `JPEG${q.toUpperCase()}`], [`jpeg2000_${q}`, `JPEG2000${q.toUpperCase()}`],
        [`automatic_jpeg_${q}`, `AUTOMATICJPEG${q.toUpperCase()}`], [`automatic_jpeg2000_${q}`, `AUTOMATICJPEG2000${q.toUpperCase()}`],
    ])),
    jpeg2000_lossless: 'JPEG2000LOSSLESS', automatic_jpeg2000_lossless: 'AUTOMATICJPEG2000LOSSLESS',
};
const PDF_MONO_COMPRESSION = { none: 'None', ccitt_group3: 'CCIT3', ccitt_group4: 'CCIT4', zip: 'MONOZIP', run_length: 'RUNLENGTH' };
const PDF_DOWNSAMPLE = { none: 'NODOWNSAMPLE', average: 'AVERAGEDOWNSAMPLE', bicubic: 'BICUBICDOWNSAMPLE', subsample: 'SUBSAMPLE' };
const PDF_PRINTING = { 40: { none: 'PRINT40NONE', high_resolution: 'PRINT40HIGHRESOLUTION' }, 128: { none: 'PRINT128NONE', low_resolution: 'PRINT128LOWRESOLUTION', high_resolution: 'PRINT128HIGHRESOLUTION' } };
const PDF_CHANGES = {
    40: { none: 'CHANGE40NONE', page_layout: 'CHANGE40PAGELAYOUT', commenting: 'CHANGE40COMMENTING', any: 'CHANGE40ANYCHANGES' },
    128: { none: 'CHANGE128NONE', edit_pages: 'CHANGE128EDITPAGE', fill_forms: 'CHANGE128FILLFORM', commenting: 'CHANGE128COMMENTING', any: 'CHANGE128ANYCHANGES' },
};

/** Compression panel settings for one kind of image (colour, grayscale or monochrome). */
const pdfImageSchema = (mono) => ({
    type: 'object',
    properties: {
        downsample: { type: 'string', enum: Object.keys(PDF_DOWNSAMPLE), description: 'none, average, bicubic or subsample' },
        resolution: { type: 'number', minimum: 9, maximum: 2400, description: 'Downsample to this ppi' },
        above: { type: 'number', minimum: 9, maximum: 9600, description: 'Only images above this ppi' },
        compression: { type: 'string', enum: Object.keys(mono ? PDF_MONO_COMPRESSION : PDF_COMPRESSION), description: mono ? 'none, ccitt_group3, ccitt_group4, zip or run_length' : 'none, zip_8bit, zip_4bit, jpeg_<quality>, jpeg2000_<quality>, automatic_jpeg_<quality> or automatic_jpeg2000_<quality>; quality is minimum, low, medium, high or maximum (JPEG 2000 also lossless)' },
        ...(mono ? {} : { tileSize: { type: 'integer', minimum: 1, maximum: 4096, description: 'Tile size for JPEG 2000 compression' } }),
    },
});

const PDF_PROFILES = { none: 'None', all: 'INCLUDEALLPROFILE', destination: 'INCLUDEDESTPROFILE', rgb: 'INCLUDERGBPROFILE', unchanged: 'LEAVEPROFILEUNCHANGED' };

/** A colour as #RRGGBB, for RGB-only options such as the JPEG matte. */
export function hexColor(value, name) {
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

/** `o.matteColor` as an RGBColor from a #RRGGBB value. */
export function matteLines(value, name = 'matteColor') {
    const [r, g, b] = hexColor(value, name);
    return `o.matte = true;
var mc = new RGBColor(); mc.red = ${r}; mc.green = ${g}; mc.blue = ${b};
o.matteColor = mc;`;
}

/**
 * Export each wanted artboard to its own file; optionLines set up `o`, and
 * perArtboard (optional) runs for artboard `i` just before it is exported.
 */
export function perArtboardExport(a, { ext, type, optionLines, perArtboard = '' }) {
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
  var out = new File(folder.fsName + "/" + prefix + "-" + doc.artboards[i].name.replace(/[\\/:*?"<>|]/g, "_") + ".${ext}");${perArtboard ? `
  ${perArtboard}` : ''}
  doc.exportFile(out, ExportType.${type}, o);
  files.push(out.fsName);
}
doc.artboards.setActiveArtboardIndex(was);
__result__ = { files: files };`);
}

export const tools = [
    {
        name: 'place_image',
        description: 'Place an image or other file at x, y on an artboard, linked or embedded (File > Place): PNG, JPEG, JPEG 2000, TIFF, PSD, GIF, BMP, WebP, AVIF, HEIC, TGA, PCX, PXR, PDF (a chosen page), EPS and DCS, SVG/SVGZ, AI, AutoCAD DWG/DXF, CGM, CorelDRAW, EMF/WMF. Give width to scale it proportionally. Text files go through place_text_file',
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
                pdf: PDF_IMPORT_SCHEMA,
                autocad: AUTOCAD_IMPORT_SCHEMA,
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
            'illustrator.import_export.place_eps',
            'illustrator.import_export.place_svgz',
            'illustrator.import_export.place_dwg',
            'illustrator.import_export.place_dxf',
            'illustrator.import_export.place_avif',
            'illustrator.import_export.place_bmp',
            'illustrator.import_export.place_cgm',
            'illustrator.import_export.place_cdr',
            'illustrator.import_export.place_emf',
            'illustrator.import_export.place_wmf',
            'illustrator.import_export.place_gif',
            'illustrator.import_export.place_heic',
            'illustrator.import_export.place_jpeg2000',
            'illustrator.import_export.place_pcx',
            'illustrator.import_export.place_pxr',
            'illustrator.import_export.place_tga',
            'illustrator.import_export.place_webp',
            'illustrator.import_export.import_pdf',
            'illustrator.import_export.import_dcs',
            'illustrator.import_export.import_duotone',
            'illustrator.import_export.import_eps_dcs_autocad',
            'illustrator.import_export.pdf_import_option.page_to_open',
            'illustrator.import_export.pdf_import_option.crop_to',
            'illustrator.import_export.autocad_import_option.layout',
            'illustrator.import_export.autocad_import_option.scale_import',
            'illustrator.import_export.autocad_import_option.scale_percent_import',
            'illustrator.import_export.autocad_import_option.units_import',
            'illustrator.import_export.autocad_import_option.unit_ratio_import',
            'illustrator.import_export.autocad_import_option.scale_lineweights_import',
            'illustrator.import_export.autocad_import_option.center_artwork',
            'illustrator.import_export.autocad_import_option.merge_layers',
        ],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            const ext = extOf(p);
            if (ext === 'txt') throw new Error('Place text files with place_text_file');
            if (['doc', 'docx', 'rtf'].includes(ext)) throw new Error('Word and RTF files can be placed only through the Place dialog; open them with open_document, or save them as .txt and use place_text_file');
            if (!PLACE_EXTENSIONS.includes(ext)) throw new Error(`Illustrator cannot place .${ext || '(no extension)'} files. It places: ${PLACE_EXTENSIONS.map((e) => `.${e}`).join(', ')}`);
            return run('Place image', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var it = layer.placedItems.add();
${withImportOptions(a, ext, 'it.file = f;')}
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
                maxWidth: { type: 'number', minimum: 1, maximum: 100000, description: 'Fit each image within this width in pixels, instead of scale' },
                maxHeight: { type: 'number', minimum: 1, maximum: 100000, description: 'Fit each image within this height in pixels, instead of scale' },
                matteColor: { type: 'string', description: 'Blend edges (and, with transparent false, the background) against this colour, #RRGGBB' },
                saveAsHtml: { type: 'boolean', description: 'Also write an HTML page showing each image. Default false', default: false },
                prefix: { type: 'string', description: 'File name prefix. Default the document name' },
            },
            required: ['outputFolder'],
        },
        features: [
            'illustrator.import_export.export_png',
            'illustrator.import_export.web_png',
            'illustrator.import_export.png24_option.dimensions_png_24',
            'illustrator.import_export.png24_option.matte_png_24',
            'illustrator.import_export.png24_option.matte_color_png_24',
            'illustrator.import_export.png24_option.save_as_html_png_24',
            'illustrator.artboards.artboard_export',
            'illustrator.import_export.png24_option.horizontal_scale_png_24',
            'illustrator.import_export.png24_option.vertical_scale_png_24',
            'illustrator.import_export.png24_option.transparency_png_24',
            'illustrator.import_export.png24_option.anti_aliasing_png_24',
            'illustrator.import_export.png24_option.clip_to_artboard_png_24',
        ],
        handler: (a) => {
            const fit = a.maxWidth !== undefined || a.maxHeight !== undefined;
            if (fit && a.scale !== undefined) throw new Error('Give scale, or maxWidth/maxHeight, not both');
            const fits = [
                a.maxWidth !== undefined && `${num(a.maxWidth, { min: 1, max: 100000, name: 'maxWidth' })} / w`,
                a.maxHeight !== undefined && `${num(a.maxHeight, { min: 1, max: 100000, name: 'maxHeight' })} / h`,
            ].filter(Boolean);
            return run('Export PNG', perArtboardExport(a, {
                ext: 'png',
                type: 'PNG24',
                optionLines: [
                    pngOptions(a),
                    a.matteColor !== undefined ? matteLines(a.matteColor) : '',
                    `o.saveAsHTML = ${bool(a.saveAsHtml)};`,
                ].filter(Boolean).join('\n'),
                perArtboard: fit ? `var r = doc.artboards[i].artboardRect, w = (r[2] - r[0]) * __sf(doc), h = (r[1] - r[3]) * __sf(doc);
  o.horizontalScale = Math.min(Math.min(${fits.join(', ')}) * 100, 7760); o.verticalScale = o.horizontalScale;` : '',
            }));
        },
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
                saveAsHtml: { type: 'boolean', description: 'Also write an HTML page showing each image. Default false', default: false },
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
            'illustrator.import_export.jpeg_option.save_as_html_jpeg',
            'illustrator.import_export.web_jpeg',
        ],
        handler: (a) => run('Export JPEG', perArtboardExport(a, { ext: 'jpg', type: 'JPEG', optionLines: `${jpegOptions(a)}\no.saveAsHTML = ${bool(a.saveAsHtml)};` })),
    },
    {
        name: 'export_svg',
        description: 'Save artboards as SVG files with the full SVG Options (File > Save As > SVG): profile, font subsetting, encoding, editing data, slices, XMP, variables, text options, SVGZ compression. For lean SVG for the web use export_web_svg',
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
                profile: { type: 'string', enum: Object.keys(SVG_PROFILES), description: 'SVG profile. Default svg_1.1' },
                fontSubsetting: { type: 'string', enum: Object.keys(SVG_SUBSETS), description: 'Which glyphs of SVG fonts to embed (text not outlined). Default glyphs_used' },
                encoding: { type: 'string', enum: Object.keys(SVG_ENCODINGS), description: 'Character encoding. Default utf8' },
                optimizeForSvgViewer: { type: 'boolean', description: 'Optimise for the Adobe SVG Viewer' },
                slices: { type: 'boolean', description: 'Include slicing data' },
                includeXmp: { type: 'boolean', description: 'Include the document metadata (XMP)' },
                includeUnusedStyles: { type: 'boolean', description: 'Include unused graphic styles' },
                includeVariables: { type: 'boolean', description: 'Include Adobe Graphics Server data (variables and data sets)' },
                fewerTspans: { type: 'boolean', description: 'Output fewer <tspan> elements (lets the viewer kern text)' },
                textOnPath: { type: 'boolean', description: 'Use <textPath> for text on a path' },
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
            'illustrator.import_export.svg_option.svg_profiles',
            'illustrator.import_export.svg_option.subsetting',
            'illustrator.import_export.svg_option.encoding',
            'illustrator.import_export.svg_option.optimize_for_adobe_svg_viewer',
            'illustrator.import_export.svg_option.include_slicing_data',
            'illustrator.import_export.svg_option.include_xmp',
            'illustrator.import_export.svg_option.include_unused_graphic_styles',
            'illustrator.import_export.svg_option.include_adobe_graphics_server_data',
            'illustrator.import_export.svg_option.output_fewer_tspan_elements',
            'illustrator.import_export.svg_option.use_textpath_element_for_text_on_path',
        ],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const ext = path.extname(out).toLowerCase();
            if (ext !== '.svg' && ext !== '.svgz') throw new Error('outputFile must end in .svg or .svgz');
            const range = artboardRange(a.artboards);
            if (a.fontSubsetting !== undefined && a.outlineText) throw new Error("'fontSubsetting' applies to SVG fonts; it has no effect with outlineText: true");
            const extra = [];
            if (a.profile !== undefined) extra.push(`o.DTD = SVGDTDVersion.${SVG_PROFILES[enumOf(a.profile, Object.keys(SVG_PROFILES), { name: 'profile' })]};`);
            if (a.fontSubsetting !== undefined) extra.push(`o.fontSubsetting = SVGFontSubsetting.${SVG_SUBSETS[enumOf(a.fontSubsetting, Object.keys(SVG_SUBSETS), { name: 'fontSubsetting' })]};`);
            if (a.encoding !== undefined) extra.push(`o.documentEncoding = SVGDocumentEncoding.${SVG_ENCODINGS[enumOf(a.encoding, Object.keys(SVG_ENCODINGS), { name: 'encoding' })]};`);
            for (const [arg, prop] of Object.entries(SVG_FLAGS)) if (a[arg] !== undefined) extra.push(`o.${prop} = ${bool(a[arg])};`);
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
${extra.join('\n')}
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
        description: 'Export artboards in several formats and scales or resolutions in one pass (File > Export > Export for Screens). Scales and resolutions apply to PNG and JPEG; PNG can have a white or black background and be interlaced, and JPEG can embed the colour profile',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                formats: { type: 'array', items: { type: 'string', enum: Object.keys(SCREEN_FORMATS) }, default: ['png'] },
                scales: { type: 'array', items: { type: 'number', minimum: 0.1, maximum: 10 }, description: 'Scale factors, e.g. [1, 2, 3]. Default [1]' },
                resolutions: { type: 'array', items: { type: 'number', minimum: 1, maximum: 2400 }, description: 'Resolutions in ppi, e.g. [72, 300], instead of scales' },
                artboards: RANGE_SCHEMA,
                prefix: { type: 'string', description: 'File name prefix' },
                pngBackground: { type: 'string', enum: ['transparent', 'white', 'black'], description: 'PNG background. Default transparent' },
                interlaced: { type: 'boolean', description: 'Interlaced PNG files. Default false' },
                embedIccProfile: { type: 'boolean', description: 'Embed the colour profile in JPEG files. Default false' },
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
            'illustrator.import_export.jpeg_option_ui.resolution',
            'illustrator.import_export.jpeg_option_ui.embed_icc_profile',
            'illustrator.import_export.png_option_ui.background_color',
            'illustrator.import_export.png_option_ui.interlaced',
        ],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const formats = (a.formats ?? ['png']).map((f) => SCREEN_FORMATS[enumOf(f, Object.keys(SCREEN_FORMATS), { name: 'formats' })]);
            if (a.scales !== undefined && a.resolutions !== undefined) throw new Error('Give scales or resolutions, not both');
            const byPpi = a.resolutions !== undefined;
            const scales = byPpi
                ? a.resolutions.map((r) => Number(num(r, { min: 1, max: 2400, name: 'resolutions' })))
                : (a.scales ?? [1]).map((s) => Number(num(s, { min: 0.1, max: 10, name: 'scales' })));
            const range = artboardRange(a.artboards);
            const bg = enumOf(a.pngBackground ?? 'transparent', ['transparent', 'white', 'black'], { name: 'pngBackground' });
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
    if (formats[f] === "SE_PNG24") {
      opts = new ExportForScreensOptionsPNG24();
      ${a.pngBackground !== undefined ? `opts.transparency = ${bg === 'transparent'}; opts.backgroundBlack = ${bg === 'black'};` : ''}
      ${a.interlaced !== undefined ? `opts.interlaced = ${bool(a.interlaced)};` : ''}
    }
    else if (formats[f] === "SE_PNG8") {
      opts = new ExportForScreensOptionsPNG8();
      ${a.pngBackground !== undefined ? `opts.transparency = ${bg === 'transparent'};` : ''}
      ${a.interlaced !== undefined ? `opts.interlaced = ${bool(a.interlaced)};` : ''}
    }
    else if (formats[f].indexOf("SE_JPEG") === 0) {
      opts = new ExportForScreensOptionsJPEG();
      ${a.embedIccProfile !== undefined ? `opts.embedICCProfile = ${bool(a.embedIccProfile)};` : ''}
    }
    else if (formats[f] === "SE_SVG") { opts = new ExportForScreensOptionsWebOptimizedSVG(); }
    else { opts = new ExportForScreensPDFOptions(); }
    if (scaled) { opts.scaleType = ExportForScreensScaleType.${byPpi ? 'SCALEBYRESOLUTION' : 'SCALEBYFACTOR'}; opts.scaleTypeValue = passes[s]; }
    var prefix = ${a.prefix ? str(a.prefix) : '""'} + (passes.length > 1 ? "@" + passes[s] + "${byPpi ? 'ppi' : 'x'}-" : "");
    doc.exportForScreens(folder, type, opts, item, prefix);
    runs++;
  }
}
__result__ = { folder: folder.fsName, exports: runs, formats: ${json(a.formats ?? ['png'])}, ${byPpi ? 'resolutions' : 'scales'}: scales };`));
        },
    },
    {
        name: 'export_pdf',
        description: 'Save a PDF copy of the document with a PDF preset (e.g. "[High Quality Print]", "[PDF/X-4:2008]"), optionally overriding its compatibility, PDF/X standard, image compression and downsampling, font subsetting, bleed, printer\'s marks, colour conversion, output intent, transparency flattening, passwords and permissions, thumbnails and Acrobat layers (Save Adobe PDF dialog). The document must be saved first; it is reopened afterwards so you keep working on the .ai file',
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
                thumbnails: { type: 'boolean', description: 'Embed page thumbnails' },
                openAfterSaving: { type: 'boolean', description: 'Open the PDF in the default PDF viewer afterwards. Default false', default: false },
                images: {
                    type: 'object',
                    description: 'Compression panel: downsampling and compression per kind of image',
                    properties: { color: pdfImageSchema(false), grayscale: pdfImageSchema(false), monochrome: pdfImageSchema(true) },
                },
                compressArt: { type: 'boolean', description: 'Compress text and line art' },
                trapped: { type: 'boolean', description: 'Mark the PDF as trapped' },
                fontSubsetThreshold: { type: 'number', minimum: 0, maximum: 100, description: 'Subset fonts when less than this percent of their characters is used' },
                flattener: {
                    type: 'object',
                    description: 'Transparency flattening, used with compatibility acrobat4 (PDF 1.3). Give a preset or custom settings',
                    properties: {
                        preset: { type: 'string', description: 'Flattener preset name, e.g. "[High Resolution]"' },
                        balance: { type: 'number', minimum: 0, maximum: 100, description: 'Custom: rasters (0) to vectors (100)' },
                        lineArtResolution: { type: 'number', minimum: 72, maximum: 9600, description: 'Custom: line art and text resolution, ppi' },
                        gradientResolution: { type: 'number', minimum: 72, maximum: 2400, description: 'Custom: gradient and mesh resolution, ppi' },
                        textToOutlines: { type: 'boolean', description: 'Custom: convert all text to outlines' },
                        strokesToOutlines: { type: 'boolean', description: 'Custom: convert all strokes to outlines' },
                        clipComplexRegions: { type: 'boolean', description: 'Custom: clip complex regions' },
                        resolution: { type: 'number', minimum: 72, maximum: 9600, description: 'Flattening resolution, ppi' },
                    },
                },
                security: {
                    type: 'object',
                    description: 'Passwords and permissions. 40-bit with compatibility acrobat4, otherwise 128-bit. Not allowed with a PDF/X standard',
                    properties: {
                        openPassword: { type: 'string', description: 'Require this password to open the document' },
                        permissionsPassword: { type: 'string', description: 'Require this password to change the permissions below' },
                        printing: { type: 'string', enum: ['none', 'low_resolution', 'high_resolution'], description: 'Printing allowed (low_resolution needs 128-bit)' },
                        changes: { type: 'string', enum: ['none', 'edit_pages', 'fill_forms', 'commenting', 'page_layout', 'any'], description: 'Changes allowed: 128-bit takes none, edit_pages, fill_forms, commenting, any; 40-bit takes none, page_layout, commenting, any' },
                        allowCopy: { type: 'boolean', description: 'Allow copying text, images and other content (40-bit: copying and screen-reader access)' },
                        allowScreenReaders: { type: 'boolean', description: 'Allow text access for screen readers (128-bit)' },
                        plaintextMetadata: { type: 'boolean', description: 'Leave metadata unencrypted (acrobat6 or later)' },
                    },
                },
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
            'illustrator.import_export.pdf_option.embed_page_thumbnails',
            'illustrator.import_export.pdf_option.view_pdf_after_saving',
            ...['color', 'grayscale', 'monochrome'].flatMap((k) => ['downsampling', 'resolution', 'for_images_above', 'compression', ...(k === 'monochrome' ? [] : ['tile_size'])]
                .map((o) => `illustrator.import_export.pdf_option.${k}_bitmap_images_${o}`)),
            'illustrator.import_export.pdf_option.compress_text_and_line_art',
            'illustrator.import_export.pdf_option.mark_as_trapped',
            'illustrator.import_export.pdf_option.subset_fonts_when_percent_of_characters_used_is_less_than',
            'illustrator.import_export.pdf_option.transparency_flattener_preset_pdf',
            'illustrator.import_export.pdf_option.custom_flattener_options_pdf',
            'illustrator.import_export.pdf_option.flattening_resolution_pdf',
            'illustrator.import_export.pdf_option.require_a_password_to_open_the_document',
            'illustrator.import_export.pdf_option.document_open_password',
            'illustrator.import_export.pdf_option.use_a_password_to_restrict_printing_editing_and_other_tasks',
            'illustrator.import_export.pdf_option.permissions_password',
            'illustrator.import_export.pdf_option.printing_allowed',
            'illustrator.import_export.pdf_option.changes_allowed',
            'illustrator.import_export.pdf_option.enable_copying_of_text_images_and_other_content',
            'illustrator.import_export.pdf_option.enable_text_access_for_screen_reader_devices_for_the_visually_impaired',
            'illustrator.import_export.pdf_option.enable_copying_and_access_40_bit',
            'illustrator.import_export.pdf_option.enable_plaintext_metadata',
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
o.viewAfterSaving = ${bool(a.openAfterSaving)};
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
    if (a.thumbnails !== undefined) set('generateThumbnails', bool(a.thumbnails));
    if (a.compressArt !== undefined) set('compressArt', bool(a.compressArt));
    if (a.trapped !== undefined) set('trapped', bool(a.trapped));
    if (a.fontSubsetThreshold !== undefined) set('fontSubsetThreshold', num(a.fontSubsetThreshold, { min: 0, max: 100, name: 'fontSubsetThreshold' }));
    for (const kind of ['color', 'grayscale', 'monochrome']) if (a.images?.[kind]) pdfImageLines(kind, a.images[kind], set);
    if (a.flattener) pdfFlattenerLines(a, set, lines);
    if (a.security) pdfSecurityLines(a, set);
    return lines.join('\n');
}

/** Downsampling and compression for colour, grayscale or monochrome images. */
function pdfImageLines(kind, spec, set) {
    const name = `images.${kind}`;
    const mono = kind === 'monochrome';
    const method = spec.downsample === undefined ? undefined : enumOf(spec.downsample, Object.keys(PDF_DOWNSAMPLE), { name: `${name}.downsample` });
    if (method !== undefined) set(`${kind}DownsamplingMethod`, `DownsampleMethod.${PDF_DOWNSAMPLE[method]}`);
    if (method === 'none') {
        if (spec.resolution !== undefined || spec.above !== undefined) throw new Error(`${name}: resolution and above apply when downsampling`);
        set(`${kind}Downsampling`, '0');
    }
    const res = spec.resolution === undefined ? undefined : Number(num(spec.resolution, { min: 9, max: 2400, name: `${name}.resolution` }));
    const above = spec.above === undefined ? undefined : Number(num(spec.above, { min: 9, max: 9600, name: `${name}.above` }));
    if (res !== undefined && above !== undefined && above < res) throw new Error(`${name}: above must be at least resolution`);
    if (res !== undefined) set(`${kind}Downsampling`, String(res));
    if (above !== undefined) set(`${kind}DownsamplingImageThreshold`, String(above));
    const table = mono ? PDF_MONO_COMPRESSION : PDF_COMPRESSION;
    const compression = spec.compression === undefined ? undefined : enumOf(spec.compression, Object.keys(table), { name: `${name}.compression` });
    if (compression !== undefined) set(`${kind}Compression`, `${mono ? 'MonochromeCompression' : 'CompressionQuality'}.${table[compression]}`);
    if (spec.tileSize !== undefined) {
        if (mono) throw new Error(`${name} has no tileSize`);
        if (!compression?.includes('jpeg2000')) throw new Error(`${name}.tileSize applies with a jpeg2000 compression`);
        set(`${kind}TileSize`, index(spec.tileSize, { name: `${name}.tileSize`, max: 4096 }));
    }
}

/** Flattener preset or custom PrintFlattenerOptions, and the flattening resolution. */
function pdfFlattenerLines(a, set, lines) {
    const f = a.flattener;
    if (a.compatibility !== undefined && a.compatibility !== 'acrobat4') throw new Error("'flattener' applies with compatibility acrobat4: later versions keep transparency");
    const custom = ['balance', 'lineArtResolution', 'gradientResolution', 'textToOutlines', 'strokesToOutlines', 'clipComplexRegions'].filter((k) => f[k] !== undefined);
    if (f.preset !== undefined && custom.length) throw new Error(`Give flattener.preset or custom settings (${custom.join(', ')}), not both`);
    if (f.preset !== undefined) set('flattenerPreset', str(f.preset));
    if (custom.length) {
        lines.push('var fo = new PrintFlattenerOptions();');
        if (f.balance !== undefined) lines.push(`fo.flatteningBalance = ${num(f.balance, { min: 0, max: 100, name: 'flattener.balance' })};`);
        if (f.lineArtResolution !== undefined) lines.push(`fo.rasterizationResolution = ${num(f.lineArtResolution, { min: 72, max: 9600, name: 'flattener.lineArtResolution' })};`);
        if (f.gradientResolution !== undefined) lines.push(`fo.gradientResolution = ${num(f.gradientResolution, { min: 72, max: 2400, name: 'flattener.gradientResolution' })};`);
        if (f.textToOutlines !== undefined) lines.push(`fo.convertTextToOutlines = ${bool(f.textToOutlines)};`);
        if (f.strokesToOutlines !== undefined) lines.push(`fo.convertStrokesToOutlines = ${bool(f.strokesToOutlines)};`);
        if (f.clipComplexRegions !== undefined) lines.push(`fo.clipComplexRegions = ${bool(f.clipComplexRegions)};`);
        set('flattenerOptions', 'fo');
    }
    if (f.resolution !== undefined) set('printerResolution', num(f.resolution, { min: 72, max: 9600, name: 'flattener.resolution' }));
}

/** Passwords and permissions; 40-bit with Acrobat 4 compatibility, otherwise 128-bit. */
function pdfSecurityLines(a, set) {
    const sec = a.security;
    if (a.standard !== undefined && a.standard !== 'none') throw new Error('PDF/X does not allow security: remove security or set standard to none');
    const bits = a.compatibility === 'acrobat4' ? 40 : 128;
    const password = (v, name) => {
        if (typeof v !== 'string' || !v.length || v.length > 32) throw new Error(`'security.${name}' must be 1-32 characters`);
        return str(v);
    };
    if (sec.openPassword !== undefined) {
        set('requireDocumentPassword', 'true');
        set('documentPassword', password(sec.openPassword, 'openPassword'));
    }
    const perms = ['printing', 'changes', 'allowCopy', 'allowScreenReaders', 'plaintextMetadata'].filter((k) => sec[k] !== undefined);
    if (perms.length && sec.permissionsPassword === undefined) throw new Error(`security.${perms[0]} needs security.permissionsPassword`);
    if (sec.permissionsPassword !== undefined) {
        set('requirePermissionPassword', 'true');
        set('permissionPassword', password(sec.permissionsPassword, 'permissionsPassword'));
    }
    if (sec.printing !== undefined) set('pDFAllowPrinting', `PDFPrintAllowedEnum.${PDF_PRINTING[bits][enumOf(sec.printing, Object.keys(PDF_PRINTING[bits]), { name: `security.printing (${bits}-bit)` })]}`);
    if (sec.changes !== undefined) set('pDFChangesAllowed', `PDFChangesAllowedEnum.${PDF_CHANGES[bits][enumOf(sec.changes, Object.keys(PDF_CHANGES[bits]), { name: `security.changes (${bits}-bit)` })]}`);
    if (sec.allowCopy !== undefined) set(bits === 40 ? 'enableCopyAccess' : 'enableCopy', bool(sec.allowCopy));
    if (sec.allowScreenReaders !== undefined) {
        if (bits === 40) throw new Error('With 40-bit security (acrobat4), allowCopy covers screen-reader access');
        set('enableAccess', bool(sec.allowScreenReaders));
    }
    if (sec.plaintextMetadata !== undefined) {
        if (['acrobat4', 'acrobat5'].includes(a.compatibility)) throw new Error('plaintextMetadata needs compatibility acrobat6 or later');
        set('enablePlainText', bool(sec.plaintextMetadata));
    }
}
