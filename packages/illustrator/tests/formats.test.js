import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';

const at = (name) => path.join(home, 'Documents', name);
const folder = path.join(home, 'Documents', 'out');

/** The tool call is refused before anything runs, with a message matching re. */
async function refused(name, args, re) {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall(name, args), re);
}

test('open_document takes more formats and sets PDF options for the call only', async () => {
    const [pdf, dwg, docx] = await scriptsFor([
        ['open_document', { filePath: at('a.pdf'), pdf: { page: 3, cropTo: 'trim' } }],
        ['open_document', { filePath: at('a.dwg'), autocad: { layout: 'Plan', scale: 'by_value', scalePercent: 50, unit: 'inches', unitRatio: 2, scaleLineweights: true, center: false, mergeLayers: true } }],
        ['open_document', { filePath: at('a.docx') }],
    ]);
    assert.match(pdf, /__was\[0\] = app\.preferences\.PDFFileOptions\.pageToOpen;/);
    assert.match(pdf, /app\.preferences\.PDFFileOptions\.pageToOpen = 3;/);
    assert.match(pdf, /app\.preferences\.PDFFileOptions\.pDFCropToBox = PDFBoxType\.PDFTRIMBOX;/);
    assert.match(pdf, /\} finally \{\n {2}try \{ app\.preferences\.PDFFileOptions\.pageToOpen = __was\[0\];/);
    assert.match(dwg, /AutoCADFileOptions\.selectedLayoutName = "Plan";/);
    assert.match(dwg, /AutoCADFileOptions\.globalScaleOption = AutoCADGlobalScaleOption\.ScaleByValue;/);
    assert.match(dwg, /AutoCADFileOptions\.globalScalePercent = 50;/);
    assert.match(dwg, /AutoCADFileOptions\.unit = AutoCADUnit\.Inches;/);
    assert.match(dwg, /AutoCADFileOptions\.unitScaleRatio = 2;/);
    assert.match(dwg, /AutoCADFileOptions\.centerArtwork = false;/);
    assert.match(dwg, /AutoCADFileOptions\.mergeLayers = true;/);
    assert.doesNotMatch(docx, /__was/, 'no preferences touched without options');
    assert.match(docx, /var d = app\.open\(f\);/);
});

test('open_document refuses formats and options that do not apply', async () => {
    await refused('open_document', { filePath: at('a.xyz') }, /cannot open \.xyz files/);
    await refused('open_document', { filePath: at('a.ai'), pdf: { page: 2 } }, /apply only to \.pdf/);
    await refused('open_document', { filePath: at('a.pdf'), autocad: { center: true } }, /apply only to \.dwg and \.dxf/);
    await refused('open_document', { filePath: at('a.pdf'), pdf: { page: 0 } }, /1-based/);
    await refused('open_document', { filePath: at('a.pdf'), pdf: { page: 1, pages: '1-2' } }, /not both/);
    await refused('open_document', { filePath: at('a.pdf'), pdf: { cropTo: 'paper' } }, /Allowed: bounding/);
    await refused('open_document', { filePath: at('a.dxf'), autocad: { scalePercent: 50 } }, /by_value/);
});

test('place_image places more formats with PDF and AutoCAD options, and refuses text files', async () => {
    const [pdf, svgz] = await scriptsFor([
        ['place_image', { filePath: at('a.pdf'), pdf: { page: 2, cropTo: 'bleed' } }],
        ['place_image', { filePath: at('a.svgz') }],
    ]);
    assert.match(pdf, /PDFFileOptions\.pageToOpen = 2;\napp\.preferences\.PDFFileOptions\.pDFCropToBox = PDFBoxType\.PDFBLEEDBOX;\nit\.file = f;/);
    assert.match(svgz, /it\.file = f;/);
    await refused('place_image', { filePath: at('a.txt') }, /place_text_file/);
    await refused('place_image', { filePath: at('a.docx') }, /only through the Place dialog/);
    await refused('place_image', { filePath: at('a.pdf'), pdf: { pages: 'all' } }, /applies when opening/);
});

test('export_pdf: compression, downsampling, flattening and security', async () => {
    const [modern, legacy] = await scriptsFor([
        ['export_pdf', {
            outputFile: at('a.pdf'), thumbnails: true, openAfterSaving: true, compressArt: true, trapped: true, fontSubsetThreshold: 50,
            images: {
                color: { downsample: 'bicubic', resolution: 300, above: 450, compression: 'jpeg2000_lossless', tileSize: 256 },
                grayscale: { downsample: 'none', compression: 'automatic_jpeg_high' },
                monochrome: { downsample: 'average', resolution: 1200, above: 1800, compression: 'ccitt_group4' },
            },
            security: { openPassword: 'o"pen', permissionsPassword: 'perm', printing: 'low_resolution', changes: 'fill_forms', allowCopy: false, allowScreenReaders: true, plaintextMetadata: true },
        }],
        ['export_pdf', {
            outputFile: at('b.pdf'), compatibility: 'acrobat4',
            flattener: { preset: '[High Resolution]', resolution: 2400 },
            security: { permissionsPassword: 'perm', printing: 'none', changes: 'page_layout', allowCopy: true },
        }],
    ]);
    for (const line of [
        'o.viewAfterSaving = true;', 'o.generateThumbnails = true;', 'o.compressArt = true;', 'o.trapped = true;', 'o.fontSubsetThreshold = 50;',
        'o.colorDownsamplingMethod = DownsampleMethod.BICUBICDOWNSAMPLE;', 'o.colorDownsampling = 300;', 'o.colorDownsamplingImageThreshold = 450;',
        'o.colorCompression = CompressionQuality.JPEG2000LOSSLESS;', 'o.colorTileSize = 256;',
        'o.grayscaleDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;', 'o.grayscaleDownsampling = 0;', 'o.grayscaleCompression = CompressionQuality.AUTOMATICJPEGHIGH;',
        'o.monochromeDownsamplingMethod = DownsampleMethod.AVERAGEDOWNSAMPLE;', 'o.monochromeCompression = MonochromeCompression.CCIT4;',
        'o.requireDocumentPassword = true;', 'o.documentPassword = "o\\"pen";', 'o.requirePermissionPassword = true;', 'o.permissionPassword = "perm";',
        'o.pDFAllowPrinting = PDFPrintAllowedEnum.PRINT128LOWRESOLUTION;', 'o.pDFChangesAllowed = PDFChangesAllowedEnum.CHANGE128FILLFORM;',
        'o.enableCopy = false;', 'o.enableAccess = true;', 'o.enablePlainText = true;',
    ]) assert.ok(modern.includes(line), line);
    for (const line of [
        'o.flattenerPreset = "[High Resolution]";', 'o.printerResolution = 2400;',
        'o.pDFAllowPrinting = PDFPrintAllowedEnum.PRINT40NONE;', 'o.pDFChangesAllowed = PDFChangesAllowedEnum.CHANGE40PAGELAYOUT;', 'o.enableCopyAccess = true;',
    ]) assert.ok(legacy.includes(line), line);
    const [custom] = await scriptsFor([['export_pdf', { outputFile: at('c.pdf'), flattener: { balance: 40, lineArtResolution: 1200, gradientResolution: 300, strokesToOutlines: true, clipComplexRegions: true } }]]);
    assert.match(custom, /var fo = new PrintFlattenerOptions\(\);\nfo\.flatteningBalance = 40;\nfo\.rasterizationResolution = 1200;\nfo\.gradientResolution = 300;\nfo\.convertStrokesToOutlines = true;\nfo\.clipComplexRegions = true;\no\.flattenerOptions = fo;/);
});

test('export_pdf refuses PDF options that do not fit together', async () => {
    const pdf = (more) => ({ outputFile: at('a.pdf'), ...more });
    await refused('export_pdf', pdf({ images: { color: { downsample: 'none', resolution: 150 } } }), /apply when downsampling/);
    await refused('export_pdf', pdf({ images: { color: { resolution: 300, above: 200 } } }), /above must be at least resolution/);
    await refused('export_pdf', pdf({ images: { color: { compression: 'zip_8bit', tileSize: 256 } } }), /jpeg2000 compression/);
    await refused('export_pdf', pdf({ images: { monochrome: { compression: 'jpeg_high' } } }), /Allowed: none, ccitt_group3/);
    await refused('export_pdf', pdf({ flattener: { preset: '[Medium Resolution]', balance: 50 } }), /not both/);
    await refused('export_pdf', pdf({ compatibility: 'acrobat7', flattener: { preset: '[Medium Resolution]' } }), /compatibility acrobat4/);
    await refused('export_pdf', pdf({ security: { printing: 'none' } }), /needs security\.permissionsPassword/);
    await refused('export_pdf', pdf({ security: { openPassword: '' } }), /1-32 characters/);
    await refused('export_pdf', pdf({ compatibility: 'acrobat4', security: { permissionsPassword: 'p', printing: 'low_resolution' } }), /40-bit/);
    await refused('export_pdf', pdf({ compatibility: 'acrobat4', security: { permissionsPassword: 'p', allowScreenReaders: true } }), /allowCopy covers/);
    await refused('export_pdf', pdf({ standard: 'x4', security: { openPassword: 'p' } }), /PDF\/X does not allow security/);
});

test('export_psd and export_tiff write the Export As options', async () => {
    const [psd, tiff] = await scriptsFor([
        ['export_psd', { outputFile: at('a.psd'), artboards: '2', colorModel: 'grayscale', resolution: 300, writeLayers: false, editableText: false, maximumEditability: false, antiAlias: false, embedIccProfile: true }],
        ['export_tiff', { outputFile: at('a.tiff'), useArtboards: false, resolution: 72, antiAlias: 'type_optimized', lzw: true, byteOrder: 'macintosh', embedIccProfile: true }],
    ]);
    for (const line of [
        'var o = new ExportOptionsPhotoshop();', 'o.imageColorSpace = ImageColorSpace.GrayScale;', 'o.resolution = 300;', 'o.writeLayers = false;',
        'o.editableText = false;', 'o.maximumEditability = false;', 'o.antiAliasing = false;', 'o.embedICCProfile = true;', 'o.warnings = false;',
        'o.saveMultipleArtboards = true;', 'o.artboardRange = "2";', 'doc.exportFile(target, ExportType.PHOTOSHOP, o);',
    ]) assert.ok(psd.includes(line), line);
    for (const line of [
        'var o = new ExportOptionsTIFF();', 'o.imageColorSpace = doc.documentColorSpace === DocumentColorSpace.CMYK ? ImageColorSpace.CMYK : ImageColorSpace.RGB;',
        'o.antiAliasing = AntiAliasingMethod.TYPEOPTIMIZED;', 'o.lZWCompression = true;', 'o.byteOrder = TIFFByteOrder.MACINTOSH;',
        'o.saveMultipleArtboards = false;', 'doc.exportFile(target, ExportType.TIFF, o);',
    ]) assert.ok(tiff.includes(line), line);
    await refused('export_psd', { outputFile: at('a.tif') }, /must end in \.psd/);
    await refused('export_tiff', { outputFile: at('a.tif'), useArtboards: false, artboards: '1' }, /applies with useArtboards: true/);
    await refused('export_psd', { outputFile: at('a.psd'), resolution: 10 }, /out of range \[72, 2400\]/);
    await refused('export_psd', { outputFile: at('a.psd'), colorModel: 'lab' }, /Allowed: rgb, cmyk, grayscale/);
});

test('export_web_image writes GIF and PNG-8 colour-table options', async () => {
    const [gif, png8] = await scriptsFor([
        ['export_web_image', { format: 'gif', outputFolder: folder, colors: 32, reduction: 'perceptual', dither: 'diffusion', ditherAmount: 60, lossy: 20, transparent: false, matteColor: '#102030', webSnap: 10, interlaced: true, antiAlias: false, scale: 200, verticalScale: 150, saveAsHtml: true }],
        ['export_web_image', { format: 'png8', outputFolder: folder, clipToArtboard: false, dither: 'noise', matteColor: 'none' }],
    ]);
    for (const line of [
        'var o = new ExportOptionsGIF();', 'o.colorCount = 32;', 'o.colorReduction = ColorReductionMethod.PERCEPTUAL;', 'o.colorDither = ColorDitherMethod.DIFFUSION;',
        'o.ditherPercent = 60;', 'o.infoLossPercent = 20;', 'o.transparency = false;', 'o.matte = true;', 'mc.red = 16; mc.green = 32; mc.blue = 48;',
        'o.webSnap = 10;', 'o.interlaced = true;', 'o.antiAliasing = false;', 'o.horizontalScale = 200;', 'o.verticalScale = 150;', 'o.saveAsHTML = true;',
        'o.artBoardClipping = true;', 'doc.exportFile(out, ExportType.GIF, o);',
    ]) assert.ok(gif.includes(line), line);
    assert.match(png8, /var o = new ExportOptionsPNG8\(\);\no\.artBoardClipping = false;/);
    assert.match(png8, /o\.colorDither = ColorDitherMethod\.NOISE;/);
    assert.match(png8, /o\.matte = false;/);
    assert.match(png8, /doc\.exportFile\(out, ExportType\.PNG8, o\);\n__result__ = \{ files: \[out\.fsName\] \};/);
    await refused('export_web_image', { format: 'png8', outputFolder: folder, lossy: 10 }, /GIF only/);
    await refused('export_web_image', { format: 'gif', outputFolder: folder, dither: 'none', ditherAmount: 50 }, /with dither: "diffusion"/);
    await refused('export_web_image', { format: 'gif', outputFolder: folder, colors: 1 }, /2-256/);
    await refused('export_web_image', { format: 'gif', outputFolder: folder, clipToArtboard: false, artboards: '1' }, /clipToArtboard: true/);
    await refused('export_web_image', { format: 'bmp', outputFolder: folder }, /Allowed: gif, png8/);
});

test('export_png, export_jpeg and export_for_screens take the remaining PNG and JPEG options', async () => {
    const [png, jpeg, screens] = await scriptsFor([
        ['export_png', { outputFolder: folder, maxWidth: 800, maxHeight: 600, matteColor: '#000000', saveAsHtml: true }],
        ['export_jpeg', { outputFolder: folder, saveAsHtml: true }],
        ['export_for_screens', { outputFolder: folder, formats: ['png', 'jpg'], scaleBy: 'resolution', scales: [72, 300], advanced: { png: { transparency: false, backgroundBlack: true, interlaced: true }, jpeg: { embedProfile: true } } }],
    ]);
    assert.match(png, /o\.horizontalScale = Math\.min\(Math\.min\(800 \/ w, 600 \/ h\) \* 100, 7760\);/);
    assert.match(png, /o\.matte = true;\nvar mc = new RGBColor\(\); mc\.red = 0;/);
    assert.match(png, /o\.saveAsHTML = true;/);
    assert.match(jpeg, /o\.saveAsHTML = true;/);
    assert.match(screens, /o\.transparency = false; o\.interlaced = true; o\.backgroundBlack = true;/);
    assert.match(screens, /o\.embedICCProfile = true;/);
    assert.match(screens, /ExportForScreensScaleType\.SCALEBYRESOLUTION/);
    await refused('export_png', { outputFolder: folder, scale: 200, maxWidth: 100 }, /not both/);
    await refused('export_png', { outputFolder: folder, matteColor: 'red' }, /hex colour/);
    await refused('export_for_screens', { outputFolder: folder, scaleBy: 'dpi' }, /Allowed: factor, width, height, resolution/);
});

test('export_svg writes the remaining SVG options', async () => {
    const [svg] = await scriptsFor([['export_svg', {
        outputFile: at('a.svg'), profile: 'tiny_1.2', fontSubsetting: 'common_roman', encoding: 'utf16', optimizeForSvgViewer: true, slices: true,
        includeXmp: true, includeUnusedStyles: false, includeVariables: true, fewerTspans: true, textOnPath: true,
    }]]);
    for (const line of [
        'o.DTD = SVGDTDVersion.SVGTINY1_2;', 'o.fontSubsetting = SVGFontSubsetting.COMMONROMAN;', 'o.documentEncoding = SVGDocumentEncoding.UTF16;',
        'o.optimizeForSVGViewer = true;', 'o.slices = true;', 'o.includeFileInfo = true;', 'o.includeUnusedStyles = false;',
        'o.includeVariablesAndDatasets = true;', 'o.sVGAutoKerning = true;', 'o.sVGTextOnPath = true;',
    ]) assert.ok(svg.includes(line), line);
    await refused('export_svg', { outputFile: at('a.svg'), outlineText: true, fontSubsetting: 'all_glyphs' }, /SVG fonts/);
    await refused('export_svg', { outputFile: at('a.svg'), profile: 'svg_2' }, /Allowed: svg_1\.0/);
});

test('save_document flattens transparency only for Illustrator 8 and 3', async () => {
    const [ai, eps] = await scriptsFor([
        ['save_document', { filePath: at('a.ai'), compatibility: '8', transparency: 'preserve_paths' }],
        ['save_document', { filePath: at('a.eps'), compatibility: '3', transparency: 'preserve_appearance' }],
    ]);
    assert.match(ai, /o\.flattenOutput = OutputFlattening\.PRESERVEPATHS;/);
    assert.match(eps, /o\.flattenOutput = OutputFlattening\.PRESERVEAPPEARANCE;/);
    await refused('save_document', { filePath: at('a.ai'), transparency: 'preserve_paths' }, /Illustrator 8 or 3/);
    await refused('save_document', { transparency: 'preserve_paths' }, /pass filePath/);
});

test('export_autocad writes DWG or DXF by extension with its options', async () => {
    const [dwg, dxf] = await scriptsFor([
        ['export_autocad', { outputFile: at('a.dwg'), version: 'r18', unit: 'millimeters', unitRatio: 1, scaleLineweights: true, colors: 'true_color', rasterFormat: 'jpeg', preserve: 'editability', alterPaths: true, outlineText: true }],
        ['export_autocad', { outputFile: at('a.dxf'), selectedOnly: true, colors: 256 }],
    ]);
    for (const line of [
        'o.exportFileFormat = AutoCADExportFileFormat.DWG;', 'o.version = AutoCADCompatibility.AutoCADRelease18;', 'o.unit = AutoCADUnit.Millimeters;',
        'o.unitScaleRatio = 1;', 'o.scaleLineweights = true;', 'o.colors = AutoCADColors.TrueColors;', 'o.rasterFormat = AutoCADRasterFormat.JPEG;',
        'o.exportOption = AutoCADExportOption.MaximumEditability;', 'o.alterPathsForAppearance = true;', 'o.convertTextToOutlines = true;',
        'doc.exportFile(target, ExportType.AUTOCAD, o);',
    ]) assert.ok(dwg.includes(line), line);
    assert.match(dxf, /AutoCADExportFileFormat\.DXF;/);
    assert.match(dxf, /o\.colors = AutoCADColors\.Max256Colors;/);
    assert.match(dxf, /o\.exportSelectedArtOnly = true;/);
    assert.match(dxf, /selectedOnly needs a selection/);
    await refused('export_autocad', { outputFile: at('a.dwf') }, /\.dwg or \.dxf/);
    await refused('export_autocad', { outputFile: at('a.dwg'), version: '2018' }, /Allowed: r13/);
    await refused('export_autocad', { outputFile: at('a.dwg'), colors: '32' }, /Allowed: 8, 16, 256, true_color/);
});

test('export_selection_as_ai and place_text_file', async () => {
    const [sel, area] = await scriptsFor([
        ['export_selection_as_ai', { outputFile: at('part.ai'), target: { names: ['Logo'] } }],
        ['place_text_file', { filePath: at('copy.txt'), encoding: 'latin1', x: 10, y: 20, width: 200, height: 100, name: 'Copy' }],
    ]);
    assert.match(sel, /items\[k\]\.selected = true;/);
    assert.match(sel, /doc\.exportSelectionAsAi\(target\);/);
    assert.match(area, /f\.encoding = "ISO-8859-1";/);
    assert.match(area, /contents\.replace\(\/\^\\uFEFF\/, ""\)\.replace\(\/\\r\\n\|\\n\/g, "\\r"\);/);
    assert.match(area, /t = layer\.textFrames\.areaText\(box\);\nt\.contents = contents;/);
    await refused('export_selection_as_ai', { outputFile: at('part.svg') }, /must end in \.ai/);
    await refused('place_text_file', { filePath: at('copy.rtf') }, /must end in \.txt/);
    await refused('place_text_file', { filePath: at('copy.txt'), width: 100 }, /both width and height/);
    await refused('place_text_file', { filePath: at('copy.txt'), encoding: 'ebcdic' }, /Allowed: utf8/);
});
