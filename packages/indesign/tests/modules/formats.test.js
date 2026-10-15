/**
 * Import and export format tools: the object-model statements their scripts
 * carry, and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const out = (name) => `${home}/Documents/${name}`;
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const call = (name, args) => tool(name).handler(args);

await test('export_pdf_with_options sets every panel, copies a preset, and restores the settings', async () => {
    const s = await one('export_pdf_with_options', {
        filePath: out('a.pdf'), preset: '[PDF/X-4:2008]', pages: '1-3,5',
        general: { acrobatCompatibility: 'ACROBAT_7', standardsCompliance: 'PDFX42010_STANDARD', includeStructure: true, exportWhichLayers: 'EXPORT_VISIBLE_LAYERS' },
        compression: { colorBitmapSampling: 'BICUBIC_DOWNSAMPLE', colorBitmapSamplingDPI: 300, colorTileSize: 256, monochromeBitmapCompression: 'CCIT4' },
        marksAndBleeds: { cropMarks: true, printerMarkWeight: 'P25PT', bleedTop: 3, pageMarksOffset: 2.1 },
        output: { pdfColorSpace: 'REPURPOSE_CMYK', pdfDestinationProfile: 'Coated FOGRA39 (ISO 12647-2:2004)', pdfXProfile: 'USE_DOCUMENT', ocRegistry: 'http://www.color.org' },
        advanced: { subsetFontsBelow: 100, appliedFlattenerPreset: '[High Resolution]', pdfDisplayTitle: 'DISPLAY_FILE_NAME', defaultDocumentLanguage: 'English: USA' },
        security: { useSecurity: true, openDocumentPassword: 'open', disallowPrinting: true },
        inkManager: { allToProcess: true, inks: [{ name: 'PANTONE 185 C', aliasInkName: 'Magenta' }] },
    });
    assert.match(s, /var prefs = app\.pdfExportPreferences;\n__keepPrefs\(prefs\);/);
    assert.match(s, /app\.pdfExportPresets\.itemByName\("\[PDF\/X-4:2008\]"\)/);
    assert.match(s, /prefs\[__k\] = __pp\[__k\];/);
    assert.match(s, /prefs\.pageRange = "1-3,5";/);
    assert.ok(s.indexOf('prefs.standardsCompliance = PDFXStandards.PDFX42010_STANDARD;') < s.indexOf('prefs.acrobatCompatibility = AcrobatCompatibility.ACROBAT_7;'), 'the standard is set before compatibility');
    assert.match(s, /prefs\.includeStructure = true;/);
    assert.match(s, /prefs\.exportWhichLayers = ExportLayerOptions\.EXPORT_VISIBLE_LAYERS;/);
    assert.match(s, /prefs\.colorBitmapSampling = Sampling\.BICUBIC_DOWNSAMPLE;/);
    assert.match(s, /prefs\.colorBitmapSamplingDPI = 300;/);
    assert.match(s, /prefs\.colorTileSize = 256;/);
    assert.match(s, /prefs\.monochromeBitmapCompression = MonoBitmapCompression\.CCIT4;/);
    assert.match(s, /prefs\.printerMarkWeight = PDFMarkWeight\.P25PT;/);
    assert.match(s, /prefs\.bleedTop = 3;/);
    assert.match(s, /prefs\.pdfColorSpace = PDFColorSpace\.REPURPOSE_CMYK;/);
    assert.match(s, /prefs\.pdfDestinationProfile = "Coated FOGRA39 \(ISO 12647-2:2004\)";/);
    assert.match(s, /prefs\.pdfXProfile = PDFProfileSelector\.USE_DOCUMENT;/);
    assert.match(s, /prefs\.appliedFlattenerPreset = __flattener\("\[High Resolution\]"\);/);
    assert.match(s, /prefs\.pdfDisplayTitle = PdfDisplayTitleOptions\.DISPLAY_FILE_NAME;/);
    assert.match(s, /prefs\.useSecurity = true;/);
    assert.match(s, /prefs\.openDocumentPassword = "open";/);
    assert.match(s, /prefs\.disallowPrinting = true;/);
    assert.match(s, /doc\.inks\[__n\]\.convertToProcess = true;/);
    assert.match(s, /__ink\.aliasInkName = "Magenta";/);
    assert.match(s, /doc\.exportFile\(ExportFormat\.PDF_TYPE, file, false\);/);
    assert.match(s, /__restorePrefs\(\);/);
    assert.doesNotMatch(s, /res\.password|openDocumentPassword:/, 'passwords are not returned');
});

await test('export_pdf_with_options exports in the background and can keep the settings', async () => {
    const s = await one('export_pdf_with_options', { filePath: out('b.pdf'), background: true, keepSettings: true });
    assert.match(s, /task = doc\.asynchronousExportFile\(ExportFormat\.PDF_TYPE, file, false\);/);
    assert.match(s, /prefs\.pageRange = PageRange\.ALL_PAGES;/);
    assert.doesNotMatch(s, /\n\s*__restorePrefs\(\);/);
    const b = await one('background_exports', { action: 'wait', taskId: 7 });
    assert.match(b, /app\.backgroundTasks\.everyItem\(\)\.getElements\(\)/);
    assert.match(b, /t\.waitForTask\(\);/);
    assert.match(b, /var only = 7/);
});

await test('export_pdf_with_options refuses bad arguments', () => {
    const f = out('c.pdf');
    assert.throws(() => call('export_pdf_with_options', {}), /'filePath' is required/);
    assert.throws(() => call('export_pdf_with_options', { filePath: '/etc/x.pdf' }), /Access denied/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, general: { colour: true } }), /Unknown option in 'general': colour/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, general: { acrobatCompatibility: 'ACROBAT_9' } }), /Allowed: ACROBAT_4/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, compression: { colorTileSize: 8 } }), /out of range/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, general: { viewPDF: 'yes' } }), /must be true or false/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, pages: '1;app.quit()' }), /Invalid 'pages'/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, inkManager: { inks: [{ name: 'X', angle: 3 }] } }), /Unknown ink option: angle/);
    assert.throws(() => call('export_pdf_with_options', { filePath: f, security: 'on' }), /'security' must be an object/);
});

await test('manage_pdf_export_presets saves presets without security, and lists, gets, imports and exports', async () => {
    const [save, get, imp, exp] = await scriptsFor([
        ['manage_pdf_export_presets', { action: 'save', name: 'Press', basedOn: '[Press Quality]', compression: { colorBitmapCompression: 'ZIP' } }],
        ['manage_pdf_export_presets', { action: 'get', name: 'Press' }],
        ['manage_pdf_export_presets', { action: 'import', filePath: out('p.joboptions') }],
        ['manage_pdf_export_presets', { action: 'export', filePath: out('q.joboptions') }],
    ]);
    assert.match(save, /prefs = app\.pdfExportPresets\.add\(\{ name: "Press" \}\);/);
    assert.match(save, /prefs\.colorBitmapCompression = BitmapCompression\.ZIP;/);
    assert.match(get, /__describeProps\(__preset, __skip\)/);
    assert.match(imp, /app\.importFile\(ExportPresetFormat\.PDF_EXPORT_PRESETS_FORMAT, f\);/);
    assert.match(exp, /app\.exportPresets\(ExportPresetFormat\.PDF_EXPORT_PRESETS_FORMAT, f, "", false\);/);
    const m = (args) => call('manage_pdf_export_presets', args);
    assert.throws(() => m({ action: 'save', name: '[High Quality Print]' }), /cannot be changed/);
    assert.throws(() => m({ action: 'delete', name: '[Press Quality]' }), /cannot be deleted/);
    assert.throws(() => m({ action: 'save', name: 'X', general: { viewPDF: true } }), /Unknown option in 'general': viewPDF/);
    assert.throws(() => m({ action: 'save', name: 'X', security: { useSecurity: true } }), /do not hold security settings/);
    assert.throws(() => m({ action: 'get' }), /'name' is required/);
    assert.throws(() => m({ action: 'list', general: {} }), /applies to save only/);
});

await test('export_interactive_pdf sets the interactive PDF preferences', async () => {
    const s = await one('export_interactive_pdf', {
        filePath: out('i.pdf'), pages: '2-4',
        options: { pageTransitionOverride: 'DISSOLVE_TRANSITION', flipPages: true, flipPagesSpeed: 5, rasterResolution: 144, interactivePDFInteractiveElementsOption: 'INCLUDE_ALL_MEDIA', usePDFStructureForTabOrder: true },
    });
    assert.match(s, /var prefs = app\.interactivePDFExportPreferences;/);
    assert.match(s, /prefs\.pageTransitionOverride = PageTransitionOverrideOptions\.DISSOLVE_TRANSITION;/);
    assert.match(s, /prefs\.flipPagesSpeed = 5;/);
    assert.match(s, /prefs\.rasterResolution = 144;/);
    assert.match(s, /prefs\.interactivePDFInteractiveElementsOption = InteractivePDFInteractiveElementsOptions\.INCLUDE_ALL_MEDIA;/);
    assert.match(s, /doc\.exportFile\(ExportFormat\.INTERACTIVE_PDF, file, false\);/);
    assert.throws(() => call('export_interactive_pdf', { filePath: out('i.pdf'), options: { pdfJPEGQuality: 'BEST' } }), /Allowed: MINIMUM/);
});

await test('export_epub_with_options writes reflowable and fixed-layout preferences', async () => {
    const [r, f] = await scriptsFor([
        ['export_epub_with_options', {
            filePath: out('r.epub'),
            general: { version: 'EPUB3', epubCover: 'EXTERNAL_IMAGE', coverImageFile: out('cover.jpg'), footnotePlacement: 'FOOTNOTE_INSIDE_POPUP', topMargin: 2 },
            images: { imageConversion: 'PNG', useSVGAs: 'OBJECT_TAGS' },
            css: { externalStyleSheets: ['https://example.com/book.css', out('extra.css')], embedFont: false },
            metadata: { id: 'urn:isbn:9780000000000', epubPublisher: 'House' },
            accessibility: { epubAccessibilitySummary: 'Fully described images' },
        }],
        ['export_epub_with_options', {
            filePath: out('f.epub'), layout: 'fixed_layout',
            fixedLayout: { epubPageRangeFormat: 'EXPORT_PAGE_RANGE', epubPageRange: '1-8', epubSpreadControlOptions: 'SYNTHETIC_SPREADS', epubNavigationStyles: 'BOOKMARKS_NAVIGATION' },
            metadata: { epubCreator: 'A. Writer' },
        }],
    ]);
    assert.match(r, /var prefs = doc\.epubExportPreferences;/);
    assert.match(r, /prefs\.version = EpubVersion\.EPUB3;/);
    assert.match(r, new RegExp(`prefs\\.coverImageFile = "${out('cover.jpg')}";`));
    assert.match(r, /prefs\.footnotePlacement = EPubFootnotePlacement\.FOOTNOTE_INSIDE_POPUP;/);
    assert.match(r, /prefs\.useSVGAs = UseSVGAsEnum\.OBJECT_TAGS;/);
    assert.match(r, /prefs\.externalStyleSheets = \["https:\/\/example\.com\/book\.css",/);
    assert.match(r, /prefs\.id = "urn:isbn:9780000000000";/);
    assert.match(r, /__setNew\(prefs, "epubAccessibilitySummary", "Fully described images", "InDesign 2025"\);/);
    assert.match(r, /doc\.exportFile\(ExportFormat\.EPUB, file, false\);/);
    assert.match(f, /var prefs = doc\.epubFixedLayoutExportPreferences;/);
    assert.match(f, /prefs\.epubSpreadControlOptions = EpubFixedLayoutSpreadControl\.SYNTHETIC_SPREADS;/);
    assert.match(f, /prefs\.epubNavigationStyles = EpubNavigationStyle\.BOOKMARKS_NAVIGATION;/);
    assert.match(f, /doc\.exportFile\(ExportFormat\.FIXED_LAYOUT_EPUB, file, false\);/);
    const e = (args) => call('export_epub_with_options', { filePath: out('x.epub'), ...args });
    assert.throws(() => e({ layout: 'fixed_layout', general: { version: 'EPUB3' } }), /'general' does not apply to a fixed-layout EPUB/);
    assert.throws(() => e({ fixedLayout: { epubPageRange: '1' } }), /'fixedLayout' does not apply to a reflowable EPUB/);
    assert.throws(() => e({ css: { javascripts: ['/etc/evil.js'] } }), /Access denied/);
    assert.throws(() => e({ general: { coverImageFile: '/System/cover.jpg' } }), /Access denied/);
});

await test('manage_epub_viewing_apps adds and removes viewing applications', async () => {
    const [add, rem] = await scriptsFor([
        ['manage_epub_viewing_apps', { action: 'add', appPath: `${home}/Applications/Reader.app`, fixedLayout: false }],
        ['manage_epub_viewing_apps', { action: 'remove', appIndex: 1 }],
    ]);
    assert.match(add, /prefs\.addApplication\(appFile\.fsName, true, false\);/);
    assert.match(rem, /prefs\.removeApplication\(at\);/);
    assert.throws(() => call('manage_epub_viewing_apps', { action: 'add', appPath: `${home}/script.sh` }), /must be an application/);
});

await test('export_html writes HTML and HTML5 fixed-layout preferences', async () => {
    const [h, fx] = await scriptsFor([
        ['export_html', { filePath: out('a.html'), options: { exportSelection: true, imageExportOption: 'LINK_TO_SERVER', serverPath: 'https://cdn.example.com/img', javascripts: ['https://example.com/a.js'] } }],
        ['export_html', { filePath: out('b.html'), format: 'html5_fixed_layout', fixedLayout: { epubPageRangeFormat: 'EXPORT_ALL_PAGES' } }],
    ]);
    assert.match(h, /var prefs = doc\.htmlExportPreferences;/);
    assert.match(h, /prefs\.exportSelection = true;/);
    assert.match(h, /prefs\.imageExportOption = ImageExportOption\.LINK_TO_SERVER;/);
    assert.match(h, /doc\.exportFile\(ExportFormat\.HTML, file, false\);/);
    assert.match(fx, /var prefs = doc\.htmlFXLExportPreferences;/);
    assert.match(fx, /doc\.exportFile\(ExportFormat\.HTMLFXL, file, false\);/);
    assert.throws(() => call('export_html', { filePath: out('c.html'), format: 'html5_fixed_layout', options: {} }), /'options' does not apply/);
    assert.throws(() => call('export_html', { filePath: out('c.html'), format: 'xhtml' }), /Allowed: html, html5_fixed_layout/);
});

await test('place_with_import_options sets import preferences and places on a page or into a frame', async () => {
    const [p, f] = await scriptsFor([
        ['place_with_import_options', {
            filePath: out('report.docx'), pageIndex: 1, x: 20, y: 30, autoflow: true,
            word: { removeFormatting: false, convertPageBreaks: 'PAGE_BREAK', resolveParagraphStyleClash: 'RESOLVE_CLASH_AUTO_RENAME', importEndnotes: true },
            text: { characterSet: 'UTF8', convertSpacesIntoTabs: true, spacesIntoTabsCount: 4 },
            generateAltText: true, markGeneratedAltText: false,
        }],
        ['place_with_import_options', {
            filePath: out('data.xlsx'), frameId: 12, tableStyle: 'Grid',
            excel: { sheetName: 'Q3', rangeName: 'A1:F20', tableFormatting: 'EXCEL_UNFORMATTED_TABLE', alignmentStyle: 'CENTER_ALIGN', decimalPlaces: 2 },
            taggedText: { styleConflict: 'TAG_FILE_DEFINITION' }, keepSettings: true,
        }],
    ]);
    assert.match(p, /__keepPrefs\(app\.wordRTFImportPreferences\);/);
    assert.match(p, /app\.wordRTFImportPreferences\.convertPageBreaks = ConvertPageBreaks\.PAGE_BREAK;/);
    assert.match(p, /app\.wordRTFImportPreferences\.resolveParagraphStyleClash = ResolveStyleClash\.RESOLVE_CLASH_AUTO_RENAME;/);
    assert.match(p, /app\.textImportPreferences\.characterSet = TextImportCharacterSet\.UTF8;/);
    assert.match(p, /app\.textImportPreferences\.spacesIntoTabsCount = 4;/);
    assert.match(p, /__setNew\(gp, "autoGenerateAltText", true, "InDesign 2026 \(21\.5\)"\);/);
    assert.match(p, /__setNew\(gp, "addAITagToAltText", false,/);
    assert.match(p, /placed = page\.place\(f, __toPage\(page, 20, 30\), doc\.activeLayer, false, true\);/);
    assert.match(p, /__restorePrefs\(\);/);
    assert.match(f, /app\.excelImportPreferences\.sheetName = "Q3";/);
    assert.match(f, /app\.excelImportPreferences\.tableFormatting = TableFormattingOptions\.EXCEL_UNFORMATTED_TABLE;/);
    assert.match(f, /app\.excelImportPreferences\.alignmentStyle = AlignmentStyleOptions\.CENTER_ALIGN;/);
    assert.match(f, /app\.taggedTextImportPreferences\.styleConflict = StyleConflict\.TAG_FILE_DEFINITION;/);
    assert.match(f, /placed = frame\.place\(f, false\);/);
    assert.match(f, /it\.tables\[j\]\.appliedTableStyle = ts;/);
    assert.doesNotMatch(f, /__restorePrefs\(\);/);
    const pl = (args) => call('place_with_import_options', { filePath: out('a.docx'), ...args });
    assert.throws(() => pl({ word: { importComments: true } }), /Unknown option in 'word': importComments/);
    assert.throws(() => pl({ excel: { decimalPlaces: 99 } }), /out of range/);
    assert.throws(() => pl({ markGeneratedAltText: true }), /goes with generateAltText/);
    assert.throws(() => pl({ pageIndex: -1 }), /Invalid index/);
    assert.throws(() => call('place_with_import_options', { filePath: '/private/etc/passwd' }), /Access denied/);
});

await test('export_story exports stories and selected text with encodings', async () => {
    const [t, tt, ic] = await scriptsFor([
        ['export_story', { filePath: out('s.txt'), format: 'text', frameId: 4, text: { characterSet: 'UTF16', platform: 'PC' } }],
        ['export_story', { filePath: out('s.txt'), format: 'tagged_text', selectedText: true, taggedText: { characterSet: 'UNICODE', tagForm: 'ABBREVIATED' } }],
        ['export_story', { filePath: out('s.icml'), format: 'incopy', frameId: 4 }],
    ]);
    assert.match(t, /var src = fr\.parentStory;/);
    assert.match(t, /app\.textExportPreferences\.characterSet = TextExportCharacterSet\.UTF16;/);
    assert.match(t, /app\.textExportPreferences\.platform = ImportPlatform\.PC;/);
    assert.match(t, /src\.exportFile\(ExportFormat\.TEXT_TYPE, file\);/);
    assert.match(tt, /var src = sel\[0\];/);
    assert.match(tt, /app\.taggedTextExportPreferences\.tagForm = TagTextForm\.ABBREVIATED;/);
    assert.match(tt, /src\.exportFile\(ExportFormat\.TAGGED_TEXT, file\);/);
    assert.match(ic, /src\.exportFile\(ExportFormat\.INCOPY_MARKUP, file\);/);
    const ex = (args) => call('export_story', { filePath: out('s.rtf'), ...args });
    assert.throws(() => ex({ format: 'rtf' }), /Give frameId or selectedText/);
    assert.throws(() => ex({ format: 'rtf', frameId: 1, selectedText: true }), /Give frameId or selectedText/);
    assert.throws(() => ex({ format: 'incopy', selectedText: true }), /whole story/);
    assert.throws(() => ex({ format: 'rtf', frameId: 1, text: { platform: 'PC' } }), /'text' does not apply to rtf/);
});

await test('set_object_export_options sets alt text, tagging and EPUB conversion per item', async () => {
    const s = await one('set_object_export_options', {
        target: { ids: [3, 4] },
        altText: { altTextSourceType: 'SOURCE_XMP_OTHER', altMetadataProperty: ['dc', 'description'] },
        pdf: { applyTagType: 'TAG_ARTIFACT', actualTextSourceType: 'SOURCE_CUSTOM', customActualText: 'Logo' },
        epub: { preserveAppearanceFromLayout: 'PRESERVE_APPEARANCE_RASTERIZE_CONTAINER', sizeType: 'USE_CUSTOM_WIDTH', customSize: '50%', imageConversionType: 'PNG', epubType: 'figure', epubAriaRole: 'img', epubAriaLabelSourceType: 'CUSTOM_ARIA_LABEL' },
    });
    assert.match(s, /var o = items\[i\]\.objectExportOptions;/);
    assert.match(s, /o\.altTextSourceType = SourceType\.SOURCE_XMP_OTHER;/);
    assert.match(s, /o\.altMetadataProperty = \["dc","description"\];/);
    assert.match(s, /o\.applyTagType = TagType\.TAG_ARTIFACT;/);
    assert.match(s, /o\.customActualText = "Logo";/);
    assert.match(s, /o\.preserveAppearanceFromLayout = PreserveAppearanceFromLayoutEnum\.PRESERVE_APPEARANCE_RASTERIZE_CONTAINER;/);
    assert.match(s, /o\.imageConversionType = ImageFormat\.PNG;/);
    assert.match(s, /o\.epubType = "figure";/);
    assert.match(s, /__setNew\(o, "epubAriaRole", "img", "InDesign 2026"\);/);
    assert.match(s, /__setNew\(o, "epubAriaLabelSourceType", __enumValue\("EpubAriaLabelSourceType", "CUSTOM_ARIA_LABEL"\)/);
    const read = await one('set_object_export_options', { target: { selection: true } });
    assert.match(read, /changed: false/);
    const so = (args) => call('set_object_export_options', { target: { ids: [1] }, ...args });
    assert.throws(() => so({ altText: { altMetadataProperty: ['dc'] } }), /\[namespace prefix, property path\]/);
    assert.throws(() => so({ epub: { epubAriaRole: 5 } }), /must be text/);
    assert.throws(() => so({ target: {} }), /Choose the items/);
});

await test('manage_articles creates articles, adds items, sets export status and reading order', async () => {
    const [c, add, st, mv, ro, rm] = await scriptsFor([
        ['manage_articles', { action: 'create', article: 'Main', items: { ids: [7, 8] }, includeWhenExporting: false }],
        ['manage_articles', { action: 'add_items', article: 'Main', items: { selection: true } }],
        ['manage_articles', { action: 'set_export_status', article: 'Main', includeWhenExporting: true }],
        ['manage_articles', { action: 'move', article: 'Main', position: 'after', reference: 'Intro' }],
        ['manage_articles', { action: 'set_reading_order', readingOrder: 'USE_ARTICLES' }],
        ['manage_articles', { action: 'remove_items', article: 'Main', items: { ids: [8] } }],
    ]);
    assert.match(c, /var art = doc\.articles\.add\("Main", false\);/);
    assert.match(c, /art\.articleMembers\.add\(its\[i\]\);/);
    assert.match(add, /"selection":true/);
    assert.match(st, /art\.articleExportStatus = true;/);
    assert.match(mv, /art\.move\(LocationOptions\.AFTER, ref\);/);
    assert.match(ro, /doc\.taggedPDFPreferences\.structureOrder = TaggedPDFStructureOrderOptions\.USE_ARTICLES;/);
    assert.match(rm, /ms\[m\]\.remove\(\);/);
    const ma = (args) => call('manage_articles', args);
    assert.throws(() => ma({ action: 'create' }), /'article' is required/);
    assert.throws(() => ma({ action: 'set_export_status', article: 'A' }), /'includeWhenExporting'/);
    assert.throws(() => ma({ action: 'move', article: 'A', position: 'before' }), /'reference' is required/);
    assert.throws(() => ma({ action: 'set_reading_order', readingOrder: 'LAYOUT' }), /Allowed: USE_ARTICLES/);
});

await test('export_image_file writes JPEG, PNG and EPS preferences', async () => {
    const [j, p, e] = await scriptsFor([
        ['export_image_file', { filePath: out('p.jpg'), format: 'jpeg', pages: '2', jpeg: { jpegRenderingStyle: 'PROGRESSIVE_ENCODING', jpegColorSpace: 'CMYK', embedColorProfile: true, exportResolution: 150 } }],
        ['export_image_file', { filePath: out('p.png'), format: 'png', spreads: true, png: { transparentBackground: true, pngColorSpace: 'GRAY' } }],
        ['export_image_file', { filePath: out('p.eps'), format: 'eps', eps: { postscriptLevel: 'LEVEL_3', fontEmbedding: 'SUBSET', preview: 'TIFF_PREVIEW', bleedOutside: 3 } }],
    ]);
    assert.match(j, /prefs\.jpegExportRange = ExportRangeOrAllPages\.EXPORT_RANGE; prefs\.pageString = "2";/);
    assert.match(j, /prefs\.jpegRenderingStyle = JPEGOptionsFormat\.PROGRESSIVE_ENCODING;/);
    assert.match(j, /prefs\.jpegColorSpace = JpegColorSpaceEnum\.CMYK;/);
    assert.match(j, /doc\.exportFile\(ExportFormat\.JPG, file, false\);/);
    assert.match(p, /prefs\.pngExportRange = PNGExportRangeEnum\.EXPORT_ALL;/);
    assert.match(p, /prefs\.exportingSpread = true;/);
    assert.match(p, /prefs\.transparentBackground = true;/);
    assert.match(p, /doc\.exportFile\(ExportFormat\.PNG_FORMAT, file, false\);/);
    assert.match(e, /var prefs = app\.epsExportPreferences;/);
    assert.match(e, /prefs\.pageRange = PageRange\.ALL_PAGES;/);
    assert.match(e, /prefs\.postscriptLevel = PostScriptLevels\.LEVEL_3;/);
    assert.match(e, /prefs\.fontEmbedding = FontEmbedding\.SUBSET;/);
    assert.match(e, /prefs\.bleedOutside = 3;/);
    assert.match(e, /doc\.exportFile\(ExportFormat\.EPS_TYPE, file, false\);/);
    const ex = (args) => call('export_image_file', { filePath: out('x.jpg'), ...args });
    assert.throws(() => ex({ format: 'gif' }), /Allowed: jpeg, png, eps/);
    assert.throws(() => ex({ format: 'jpeg', png: { transparentBackground: true } }), /'png' does not apply to jpeg/);
    assert.throws(() => ex({ format: 'jpeg', jpeg: { exportResolution: 5000 } }), /out of range/);
});

await test('transfer_resource_file reaches libraries, preflight profiles, swatches and snippets', async () => {
    const [lib, prof, sw, snip] = await scriptsFor([
        ['transfer_resource_file', { action: 'create_library', filePath: out('parts.indl') }],
        ['transfer_resource_file', { action: 'save_preflight_profile', filePath: out('print.idpp'), profileName: 'Print' }],
        ['transfer_resource_file', { action: 'save_swatches', filePath: out('brand.ase'), swatches: ['Brand Red'] }],
        ['transfer_resource_file', { action: 'export_snippet', filePath: out('logo.idms'), target: { ids: [9] } }],
    ]);
    assert.match(lib, /app\.libraries\.add\(f\);/);
    assert.match(prof, /prof\.save\(f\);/);
    assert.match(sw, /doc\.saveSwatches\(f, list, "", false\);/);
    assert.match(snip, /doc\.exportPageItemsSelectionToSnippet\(f\);/);
    const [open, load] = await scriptsFor([
        ['transfer_resource_file', { action: 'open_library', filePath: out('parts.indl') }],
        ['transfer_resource_file', { action: 'load_swatches', filePath: out('brand.ase') }],
    ]);
    assert.match(open, /var lib = app\.open\(f\);/);
    assert.match(load, /doc\.loadSwatches\(f\);/);
    const tr = (args) => call('transfer_resource_file', { filePath: out('x.idpp'), ...args });
    assert.throws(() => tr({ action: 'save_preflight_profile' }), /'profileName' is required/);
    assert.throws(() => tr({ action: 'save_swatches', swatches: [] }), /list of swatch names/);
    assert.throws(() => tr({ action: 'export_snippet', target: {} }), /Choose the items/);
    assert.throws(() => tr({ action: 'load_swatches', filePath: '/etc/x.ase' }), /Access denied/);
});

done();
