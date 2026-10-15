/**
 * File commands, formats and their options, and printing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';
import { executor } from '../src/executor.js';

const docs = `${home}/Documents`;

test('opening reads PDF, EPS, Raw and DICOM with their open options', async () => {
    const [pdf, raw, dicom, plain] = await scriptsFor([
        ['open_document', { filePath: `${docs}/a.pdf`, openAs: 'pdf', options: { select: 'image', page: 3, cropTo: 'bleed_box', width: 800, resolution: 300, mode: 'cmyk', bitsPerChannel: 16, name: 'Page', suppressWarnings: true } }],
        ['open_document', { filePath: `${docs}/a.raw`, openAs: 'raw', options: { width: 640, height: 480, channels: 3, byteOrder: 'mac', headerSize: 0, interleaved: true } }],
        ['open_document', { filePath: `${docs}/a.dcm`, openAs: 'dicom', options: { anonymize: true, windowLevel: 40, windowWidth: 400 } }],
        ['open_document', { filePath: `${docs}/template.psdt` }],
    ]);
    assert.match(pdf, /var oo = new GenericPDFOpenOptions\(\);\noo\.usePageNumber = false;\noo\.page = 3;\noo\.name = "Page";\noo\.cropPage = CropToType\.BLEEDBOX;\noo\.width = new UnitValue\(800, "px"\);/);
    assert.match(pdf, /oo\.mode = OpenDocumentMode\.CMYK;\noo\.bitsPerChannel = BitsPerChannelType\.SIXTEEN;/);
    assert.match(pdf, /app\.open\(f, oo, false\);/);
    assert.match(raw, /new RawFormatOpenOptions\(\);[\s\S]*oo\.channelNumber = 3;[\s\S]*oo\.byteOrder = ByteOrder\.MACOS;[\s\S]*oo\.interleaveChannels = true;/);
    assert.match(dicom, /new DICOMOpenOptions\(\);\noo\.anonymize = true;\noo\.windowLevel = 40;\noo\.windowWidth = 400;/);
    assert.match(plain, /app\.open\(f, undefined, false\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_document', { filePath: `${docs}/a.pdf`, options: { page: 1 } }), /need openAs/);
    await assert.rejects(mcp.handleToolCall('open_document', { filePath: `${docs}/a.eps`, openAs: 'eps', options: { page: 1 } }), /Opening as eps has no option page/);
    await assert.rejects(mcp.handleToolCall('open_document', { filePath: `${docs}/a.raw`, openAs: 'raw', options: { width: 1.5 } }), /whole number/);
    await assert.rejects(mcp.handleToolCall('open_document', { filePath: '/etc/a.pdf', openAs: 'pdf' }), /Access denied/);
});

test('new documents take a pixel aspect ratio, or are made with an artboard', async () => {
    const [par, board] = await scriptsFor([
        ['create_document', { width: 720, height: 480, pixelAspectRatio: 0.9 }],
        ['create_document', { width: 1080, height: 1920, resolution: 144, artboard: true, mode: 'cmyk', fill: 'transparent', name: 'Story' }],
    ]);
    assert.match(par, /DocumentFill\.WHITE, 0\.9,/);
    assert.match(board, /n\.putBoolean\(app\.stringIDToTypeID\("artboard"\), true\);/);
    assert.match(board, /app\.stringIDToTypeID\("CMYKColorMode"\)/);
    assert.match(board, /"distanceUnit"\), 1080 \* 72 \/ 144\);/);
    assert.match(board, /app\.executeAction\(app\.stringIDToTypeID\("make"\), d, DialogModes\.NO\);/);
});

test('saving writes each further format with its options', async () => {
    const [psb, eps, dcs, bmp, tga, gif, tif, pdf, jpg, raw] = await scriptsFor([
        ['save_document', { filePath: `${docs}/a.psb`, asCopy: true, options: { maximizeCompatibility: false } }],
        ['save_document', { filePath: `${docs}/a.eps`, options: { preview: 'tiff_8bit', encoding: 'jpeg_high', vectorData: true, psColorManagement: false } }],
        ['save_document', { filePath: `${docs}/a.eps`, epsType: 'dcs2', options: { composite: 'color', multiFile: true } }],
        ['save_document', { filePath: `${docs}/a.bmp`, options: { osType: 'os2', depth: 24, rleCompression: false, flipRowOrder: true } }],
        ['save_document', { filePath: `${docs}/a.tga`, options: { bitsPerPixel: 32, rleCompression: true } }],
        ['save_document', { filePath: `${docs}/a.gif`, options: { palette: 'local_selective', colors: 64, forced: 'web', dither: 'diffusion', ditherAmount: 75, matte: 'white', transparency: true } }],
        ['save_document', { filePath: `${docs}/a.tif`, notes: true, options: { pixelOrder: 'per_channel', byteOrder: 'ibm', imagePyramid: true, layerCompression: 'zip' } }],
        ['save_document', { filePath: `${docs}/a.pdf`, notes: false, options: { compatibility: '1.6', compression: 'jpeg2000_high', tileSize: 256, downsample: 'bicubic', downsampleTo: 150, downsampleAbove: 225, viewAfterSaving: true, outputConditionId: 'FOGRA39', embedFonts: true } }],
        ['save_document', { filePath: `${docs}/a.jpg`, options: { matte: 'black' } }],
        ['save_document', { filePath: `${docs}/a.raw`, options: { alphaChannels: false } }],
    ]);
    assert.match(psb, /f\.putBoolean\(app\.stringIDToTypeID\("maximizeCompatibility"\), false\);\nd\.putObject\(app\.stringIDToTypeID\("as"\), app\.stringIDToTypeID\("largeDocumentFormat"\), f\);/);
    assert.match(psb, /d\.putBoolean\(app\.stringIDToTypeID\("copy"\), true\);/);
    assert.doesNotMatch(psb, /saveAs/);
    assert.match(eps, /new EPSSaveOptions\(\);[\s\S]*o\.preview = Preview\.EIGHTBITTIFF;\no\.encoding = SaveEncoding\.JPEGHIGH;[\s\S]*o\.psColorManagement = false;\no\.vectorData = true;/);
    assert.match(dcs, /new DCS2_SaveOptions\(\);[\s\S]*o\.DCS = DCSType\.COLORCOMPOSITE;[\s\S]*o\.multiFileDCS = true;/);
    assert.match(bmp, /new BMPSaveOptions\(\);\no\.osType = OperatingSystem\.OS2;\no\.depth = BMPDepthType\.TWENTYFOUR;\no\.rleCompression = false;\no\.flipRowOrder = true;/);
    assert.match(tga, /o\.resolution = TargaBitsPerPixels\.THIRTYTWO;\no\.rleCompression = true;/);
    assert.match(gif, /new GIFSaveOptions\(\);\no\.palette = PaletteType\.LOCALSELECTIVE;\no\.colors = 64;\no\.forced = ForcedColors\.WEB;/);
    assert.match(gif, /o\.matte = MatteType\.WHITE;/);
    assert.match(tif, /o\.annotations = true;\no\.interleaveChannels = false;\no\.byteOrder = ByteOrder\.IBM;\no\.saveImagePyramid = true;\no\.layerCompression = LayerCompression\.ZIP;/);
    assert.match(pdf, /o\.view = true;\no\.annotations = false;\no\.PDFCompatibility = PDFCompatibility\.PDF16;/);
    assert.match(pdf, /o\.downSample = PDFResample\.PDFBICUBIC;\no\.downSampleSize = 150;\no\.downSampleSizeLimit = 225;\no\.encoding = PDFEncoding\.JPEG2000HIGH;\no\.tileSize = 256;/);
    assert.match(pdf, /o\.outputConditionID = "FOGRA39";/);
    assert.equal((pdf.match(/o\.view =/g) ?? []).length, 1);
    assert.match(jpg, /o\.matte = MatteType\.BLACK;/);
    assert.match(raw, /new RawSaveOptions\(\);\no\.alphaChannels = false;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.png`, notes: true }), /PSD, TIFF and PDF/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.tif`, epsType: 'dcs1' }), /epsType is for \.eps/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.bmp`, options: { quality: 3 } }), /Saving as BMP has no option quality/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.eps`, epsType: 'eps', options: { multiFile: true } }), /Saving as EPS has no option multiFile/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.psb`, options: { layers: true } }), /PSB has no option layers/);
    await assert.rejects(mcp.handleToolCall('save_document', { options: { colors: 3 } }), /need filePath/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${docs}/a.gif`, options: { colors: 1 } }), /out of range/);
});

test('Paste in Place and Paste Outside go through the Action Manager', async () => {
    const [inPlace, outside] = await scriptsFor([['clipboard', { action: 'paste_in_place' }], ['clipboard', { action: 'paste_outside' }]]);
    assert.match(inPlace, /pd\.putBoolean\(app\.stringIDToTypeID\("inPlace"\), true\);\napp\.executeAction\(app\.stringIDToTypeID\("paste"\), pd, DialogModes\.NO\);/);
    assert.match(outside, /needs a selection[\s\S]*app\.executeAction\(app\.stringIDToTypeID\("pasteOutside"\)/);
});

test('recent files: list and clear, and opening one goes through the path policy', async () => {
    const [list, clear] = await scriptsFor([['manage_recent_files', {}], ['manage_recent_files', { action: 'clear' }]]);
    assert.match(list, /app\.recentFiles\[i\]\.fsName/);
    assert.match(clear, /app\.runMenuItem\(app\.stringIDToTypeID\("clearRecentFiles"\)\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_recent_files', { action: 'open' }), /needs index/);
    const original = executor.runScript;
    const sent = [];
    executor.runScript = async (s) => {
        sent.push(s);
        const files = [{ index: 0, path: '/etc/hosts' }, { index: 1, path: `${docs}/b.psd` }];
        return JSON.stringify({ ok: true, result: JSON.stringify({ files }) });
    };
    try {
        await assert.rejects(mcp.handleToolCall('manage_recent_files', { action: 'open', index: 0 }), /Access denied/);
        await assert.rejects(mcp.handleToolCall('manage_recent_files', { action: 'open', index: 5 }), /has 2 file/);
        const r = await mcp.handleToolCall('manage_recent_files', { action: 'open', index: 1 });
        assert.equal(r.success, true);
        assert.match(sent.at(-1), /new File\(".*\/Documents\/b\.psd"\)/);
    } finally {
        executor.runScript = original;
    }
});

test('Close All, Bridge, File Info, notes and file-handling preferences', async () => {
    const [closeAll, bridge, meta, read, notes, clearNotes, prefs] = await scriptsFor([
        ['close_documents', { save: true }],
        ['go_to_bridge', { closeDocument: true }],
        ['set_document_metadata', { title: 'Cover', author: 'Ana', keywords: ['a', 'b'], copyrighted: 'copyrighted', urgency: '1', creationDate: '20260115' }],
        ['get_document_metadata', { includeXmp: true }],
        ['manage_document_notes', { action: 'import', file: `${docs}/proof.pdf` }],
        ['manage_document_notes', { action: 'clear_all' }],
        ['set_file_handling_preferences', { imagePreviews: 'always', macThumbnail: true, recentFileListLength: 30, historyLog: true, historyLogSaveTo: 'metadata', historyLogDetail: 'detailed' }],
    ]);
    assert.match(closeAll, /Never saved[\s\S]*d\.close\(SaveOptions\.SAVECHANGES\);/);
    assert.match(bridge, /unsaved changes[\s\S]*app\.runMenuItem\(app\.stringIDToTypeID\("browseAndClose"\)\);/);
    assert.match(meta, /doc\.info\.title = "Cover";\ndoc\.info\.author = "Ana";[\s\S]*doc\.info\.keywords = \["a","b"\];\ndoc\.info\.copyrighted = CopyrightedType\.COPYRIGHTEDWORK;[\s\S]*doc\.info\.urgency = Urgency\.HIGH;/);
    assert.match(read, /info\.xmp = doc\.xmpMetadata\.rawData;/);
    assert.match(read, /inf\.exif\[k\]/);
    assert.match(notes, /doc\.importAnnotations\(f\);/);
    assert.match(clearNotes, /app\.executeAction\(app\.stringIDToTypeID\("deleteAllAnnot"\)/);
    assert.match(prefs, /app\.preferences\.imagePreviews = SaveBehavior\.ALWAYSSAVE;\napp\.preferences\.macOSThumbnail = true;\napp\.preferences\.recentFileListLength = 30;\napp\.preferences\.useHistoryLog = true;\napp\.preferences\.saveLogItems = SaveLogItemsType\.METADATA;\napp\.preferences\.editLogItems = EditLogItemsType\.DETAILED;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_document_metadata', {}), /at least one field/);
    await assert.rejects(mcp.handleToolCall('set_document_metadata', { creationDate: '2026-01-15' }), /YYYYMMDD/);
    await assert.rejects(mcp.handleToolCall('set_document_metadata', { xmp: '<rdf:RDF/>' }), /<x:xmpmeta>/);
    await assert.rejects(mcp.handleToolCall('set_document_metadata', { urgency: '9' }), /Invalid value/);
    await assert.rejects(mcp.handleToolCall('manage_document_notes', { action: 'import', file: `${docs}/notes.txt` }), /\.pdf or \.fdf/);
    await assert.rejects(mcp.handleToolCall('manage_document_notes', { action: 'import', file: '/etc/notes.pdf' }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('set_file_handling_preferences', { historyLogFile: '/etc/log.txt' }), /Access denied/);
});

test('placing embeds or links a file at a position, scale and angle', async () => {
    const [linked, embedded] = await scriptsFor([
        ['place_file', { filePath: `${docs}/logo.ai`, linked: true, center: { x: 300, y: 200 }, scale: 50, angle: -10 }],
        ['place_file', { filePath: `${docs}/photo.jpg` }],
    ]);
    assert.match(linked, /d\.putBoolean\(app\.stringIDToTypeID\("linked"\), true\);/);
    assert.match(linked, /off\.putUnitDouble\(app\.stringIDToTypeID\("horizontal"\), app\.stringIDToTypeID\("pixelsUnit"\), 300 - __px\(doc\.width\) \/ 2\);/);
    assert.match(linked, /"width"\), app\.stringIDToTypeID\("percentUnit"\), 50\);[\s\S]*"height"\), app\.stringIDToTypeID\("percentUnit"\), 50\);[\s\S]*"angleUnit"\), -10\);/);
    assert.match(linked, /app\.executeAction\(app\.stringIDToTypeID\("placeEvent"\), d, DialogModes\.NO\);/);
    assert.doesNotMatch(embedded, /"linked"|"offset"/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('place_file', { filePath: `${docs}/a.png`, scale: 50, scaleX: 20 }), /Give scale, or scaleX/);
    await assert.rejects(mcp.handleToolCall('place_file', { filePath: '/usr/share/a.png' }), /Access denied/);
});

test('printing: settings, printing without the dialog, and trap', async () => {
    const [set, print, one, trap] = await scriptsFor([
        ['set_print_options', { printer: 'Studio', copies: 2, colorHandling: 'separations', renderingIntent: 'perceptual', cornerCropMarks: true, description: true, bleed: 9, background: '#000000', position: { style: 'fit' } }],
        ['print_image', { source: 'proof', printSpace: 'Coated FOGRA39', renderingIntent: 'absolute_colorimetric', blackPointCompensation: false }],
        ['print_image', { oneCopy: true }],
        ['apply_trap', { width: 2 }],
    ]);
    assert.match(set, /ps\.activePrinter = "Studio";\nps\.copies = 2;\nps\.colorHandling = PrintColorHandling\.SEPARATIONS;\nps\.renderIntent = Intent\.PERCEPTUAL;\nps\.cornerCropMarks = true;\nps\.caption = true;\nps\.bleedWidth = new UnitValue\(9, "px"\);/);
    assert.match(set, /ps\.backgroundColor = __color\(/);
    assert.match(set, /ps\.setPagePosition\(DocPositionStyle\.SIZETOFIT\);/);
    assert.match(print, /doc\.print\(SourceSpaceType\.PROOF, space, Intent\.ABSOLUTECOLORIMETRIC, false\);/);
    assert.match(one, /doc\.printOneCopy\(\);/);
    assert.match(trap, /DocumentMode\.CMYK[\s\S]*doc\.trap\(2\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_print_options', {}), /at least one setting/);
    await assert.rejects(mcp.handleToolCall('set_print_options', { position: { style: 'custom', x: 10 } }), /needs x and y/);
    await assert.rejects(mcp.handleToolCall('set_print_options', { position: { style: 'centered', scale: 50 } }), /custom position/);
    await assert.rejects(mcp.handleToolCall('print_image', { oneCopy: true, source: 'proof' }), /current settings/);
    await assert.rejects(mcp.handleToolCall('apply_trap', { width: 0 }), /out of range/);
});

test('exports: Save for Web extras, Quick Export, layer comps, paths, PDF Presentation and Generator', async () => {
    const [web, quick, quickLayers, comps, compsPdf, ai, show, assets] = await scriptsFor([
        ['export_image', { outputFile: `${docs}/a.gif`, format: 'gif', lossy: 20, webSnap: 5 }],
        ['quick_export', { outputFolder: `${docs}/out`, fileType: 'jpg', quality: 70 }],
        ['quick_export', { outputFolder: `${docs}/out`, layers: { ids: [3, 4] } }],
        ['export_layer_comps', { outputFolder: `${docs}/comps`, fileType: 'png', prefix: 'v1-' }],
        ['export_layer_comps', { to: 'pdf', outputFile: `${docs}/comps.pdf`, comps: ['Home'], slideshow: true, advanceSeconds: 4, transition: 'wipe_left' }],
        ['export_paths_to_illustrator', { outputFile: `${docs}/paths.ai`, paths: 'named', pathName: 'Outline' }],
        ['make_pdf_presentation', { files: [`${docs}/a.jpg`, `${docs}/b.jpg`, `${docs}/a.jpg`], includeOpenFiles: true, outputFile: `${docs}/show.pdf`, includeFilename: true, pdfPreset: '[Smallest File Size]', pdfOptions: { compatibility: '1.4' } }],
        ['generate_image_assets', { assets: [{ id: 4, name: 'icon.png, 200% icon@2x.png24' }], defaults: 'default 50% small/', toggle: true }],
    ]);
    assert.match(web, /o\.lossy = 20;\no\.webSnap = 5;/);
    assert.match(quick, /d\.putString\(app\.stringIDToTypeID\("fileType"\), "jpg"\);\nd\.putInteger\(app\.stringIDToTypeID\("quality"\), 70\);/);
    assert.match(quick, /exportDocumentAsFileTypePressed/);
    assert.match(quickLayers, /sr\.putIdentifier\(app\.stringIDToTypeID\("layer"\), sel\[si\]\.id\);[\s\S]*exportSelectionAsFileTypePressed/);
    assert.match(comps, /comps\[k\]\.apply\(\);[\s\S]*new PNGSaveOptions\(\);[\s\S]*doc\.saveAs\(f, o, true, Extension\.LOWERCASE\);[\s\S]*doc\.activeHistoryState = start;/);
    assert.match(compsPdf, /po\.presentation = true;\npo\.interval = 4;\npo\.transition = TransitionType\.WIPELEFT;\npo\.autoAdvance = true;/);
    assert.match(compsPdf, /doc\.saveAs\(f, so, true[\s\S]*app\.makePDFPresentation\(files, target, po\);/);
    assert.match(ai, /o\.path = IllustratorPathType\.NAMEDPATH;[\s\S]*o\.pathName = "Outline";[\s\S]*ExportType\.ILLUSTRATORPATHS/);
    assert.match(show, /po\.presentation = false;\npo\.includeFilename = true;/);
    assert.match(show, /o\.presetFile = "\[Smallest File Size\]";[\s\S]*o\.PDFCompatibility = PDFCompatibility\.PDF14;\npo\.PDFFileOptions = o;/);
    assert.match(show, /files\.push\(app\.documents\[j\]\.fullName\)/);
    assert.match(assets, /dl\.name = "default " \+ "50% small\/";/);
    assert.match(assets, /g\.putString\(app\.stringIDToTypeID\("name"\), "assets"\);\napp\.executeAction\(app\.stringIDToTypeID\("generateAssets"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('export_image', { outputFile: `${docs}/a.png`, blur: 1 }), /blur is for JPEG/);
    await assert.rejects(mcp.handleToolCall('quick_export', { outputFolder: `${docs}/out`, quality: 50 }), /quality is for jpg/);
    await assert.rejects(mcp.handleToolCall('export_layer_comps', { to: 'pdf', outputFile: `${docs}/c.pdf`, prefix: 'x' }), /are for to: files/);
    await assert.rejects(mcp.handleToolCall('export_layer_comps', { outputFolder: `${docs}/c`, slideshow: true }), /are for to: pdf/);
    await assert.rejects(mcp.handleToolCall('export_paths_to_illustrator', { outputFile: `${docs}/p.ai`, paths: 'named' }), /needs pathName/);
    await assert.rejects(mcp.handleToolCall('export_paths_to_illustrator', { outputFile: `${docs}/p.svg` }), /\.ai/);
    await assert.rejects(mcp.handleToolCall('make_pdf_presentation', { outputFile: `${docs}/s.pdf` }), /Give files/);
    await assert.rejects(mcp.handleToolCall('make_pdf_presentation', { files: ['/etc/hosts'], outputFile: `${docs}/s.pdf` }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('make_pdf_presentation', { files: [`${docs}/a.jpg`], outputFile: `${docs}/s.pdf`, loop: true }), /slideshow: true/);
    await assert.rejects(mcp.handleToolCall('generate_image_assets', { assets: [{ id: 4, name: 'icon' }] }), /image extension/);
    await assert.rejects(mcp.handleToolCall('generate_image_assets', {}), /Give assets/);
});
