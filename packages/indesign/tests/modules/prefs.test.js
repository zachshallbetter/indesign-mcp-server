/**
 * Preferences tools: the object-model statements their scripts carry, and the
 * arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const set = (args) => tool('set_indesign_preferences').handler(args);

await test('set_indesign_preferences writes General and Interface options to the application', async () => {
    const s = await one('set_indesign_preferences', {
        general: {
            showHomeScreen: false, pageNumbering: 'ABSOLUTE', fontDownloadGlyphLimit: 2000, whenScaling: 'ADJUST_SCALING_PERCENTAGE',
            includeStrokeWeight: true, includeEffects: false, preventSelectingLockedObjects: true, contentAwareFit: false,
            temporaryFolder: `${home}/Documents`,
        },
        interface: { colorTheme: 'medium_light', matchPasteboardToTheme: false, toolTips: 'FAST', toolsPanel: 'SINGLE_ROW', handToolPanning: 'GREEK_IMAGES', liveScreenDrawing: 'NEVER', largeTabs: true },
    });
    assert.match(s, /var R = app;/);
    assert.match(s, /app\.generalPreferences\.showStartWorkspace = false;/);
    assert.match(s, /app\.generalPreferences\.pageNumbering = PageNumberingOptions\.ABSOLUTE;/);
    assert.match(s, /app\.generalPreferences\.completeFontDownloadGlyphLimit = 2000;/);
    assert.match(s, /app\.transformPreferences\.whenScaling = WhenScalingOptions\.ADJUST_SCALING_PERCENTAGE;/);
    assert.match(s, /app\.transformPreferences\.adjustStrokeWeightWhenScaling = true;/);
    assert.match(s, /app\.transformPreferences\.adjustEffectsWhenScaling = false;/);
    assert.match(s, /app\.generalPreferences\.preventSelectingLockedItems = true;/);
    assert.match(s, /app\.generalPreferences\.temporaryFolder = __folder\(".*\/Documents"\);/);
    assert.match(s, /app\.generalPreferences\.uiBrightnessPreference = 0\.51;/);
    assert.match(s, /app\.generalPreferences\.pasteboardColorPreference = 0;/);
    assert.match(s, /app\.generalPreferences\.toolTips = ToolTipOptions\.FAST;/);
    assert.match(s, /app\.grabberPreferences\.grabberPanning = PanningTypes\.GREEK_IMAGES;/);
    assert.match(s, /app\.liveScreenDrawing = LiveDrawingOptions\.NEVER;/);
    assert.match(s, /app\.generalPreferences\.panelTabHeightPreference = true;/);
    assert.match(s, /out\.general = \{ showHomeScreen: __rd\(function \(\) \{ return app\.generalPreferences\.showStartWorkspace; \}, "value"\)/);
    assert.match(s, /colorTheme: __unmap\(__rd\(function \(\) \{ return app\.generalPreferences\.uiBrightnessPreference; \}, "value"\), \["0","0\.5","0\.51","1"\]/);
    assert.match(s, /changed: \["general","interface"\]/);
});

await test('set_indesign_preferences writes document-scoped panes to the active document', async () => {
    const s = await one('set_indesign_preferences', {
        scope: 'document',
        type: { typographersQuotes: true, smartTextReflow: true, addPagesTo: 'END_OF_SECTION' },
        composition: { highlightKeepsViolations: true, honorTextIndentsWithTextWrap: true, wrapOnlyAffectsTextBeneath: false },
        units: { rulerOrigin: 'PAGE_ORIGIN', horizontalUnits: 'CUSTOM', horizontalCustomPoints: 12, typeUnits: 'POINTS', pointsPerInch: 72.27, cursorKey: 0.5, sizeLeading: 2, baselineShift: 1.5, kerningTracking: 10 },
        fileHandling: { linkTextAndSpreadsheetFiles: true, snippetImportPosition: 'cursor_location', recentItems: 12, previewPages: 'FIRST_5_PAGES' },
        guidesPasteboard: { bleedGuideColor: 'grid orange', previewBackgroundColor: '#336699', pasteboardMargins: { vertical: 30 }, snapToZone: 6 },
        dictionary: { composeUsing: 'USE_DOCUMENT', recomposeWhenChanged: false },
        japaneseLayout: { showLayoutGrids: true, layoutGridColor: 'LIGHT_BLUE', viewThreshold: 75, mojikumiSets: { lineEndAllOneEm: false } },
    });
    assert.match(s, /var R = __doc\(\);/);
    assert.match(s, /out\.document = R\.name;/);
    assert.match(s, /R\.textPreferences\.typographersQuotes = true;/);
    assert.match(s, /R\.textPreferences\.addPages = AddPageOptions\.END_OF_SECTION;/);
    assert.match(s, /R\.textPreferences\.highlightKeeps = true;/);
    assert.match(s, /R\.textPreferences\.honourTextIndentsWithTextWrap = true;/);
    assert.match(s, /R\.textPreferences\.zOrderTextWrap = false;/);
    assert.match(s, /R\.viewPreferences\.rulerOrigin = RulerOrigin\.PAGE_ORIGIN;/);
    assert.match(s, /R\.viewPreferences\.horizontalMeasurementUnits = MeasurementUnits\.CUSTOM;/);
    assert.ok(s.indexOf('horizontalMeasurementUnits =') < s.indexOf('horizontalCustomPoints ='), 'units are set before custom points');
    assert.match(s, /R\.viewPreferences\.pointsPerInch = 72\.27;/);
    assert.match(s, /R\.viewPreferences\.cursorKeyIncrement = 0\.5;/);
    assert.match(s, /R\.textPreferences\.leadingKeyIncrement = "2pt";/);
    assert.match(s, /R\.textPreferences\.baselineShiftKeyIncrement = "1\.5pt";/);
    assert.match(s, /R\.textPreferences\.kerningKeyIncrement = 10;/);
    assert.match(s, /sizeLeading: __rd\(function \(\) \{ return R\.textPreferences\.leadingKeyIncrement; \}, "pt"\)/);
    assert.match(s, /R\.textPreferences\.linkTextFilesWhenImporting = true;/);
    assert.match(s, /R\.documentPreferences\.snippetImportUsesOriginalLocation = false;/);
    assert.match(s, /app\.generalPreferences\.openRecentLength = 12;/);
    assert.match(s, /R\.pasteboardPreferences\.bleedGuideColor = UIColors\.GRID_ORANGE;/);
    assert.match(s, /R\.pasteboardPreferences\.previewBackgroundColor = \[51, 102, 153\];/);
    assert.match(s, /var __pm = R\.pasteboardPreferences\.pasteboardMargins;\nR\.pasteboardPreferences\.pasteboardMargins = \[__pm\[0\], 30\];/);
    assert.match(s, /R\.viewPreferences\.guideSnaptoZone = 6;/);
    assert.match(s, /R\.dictionaryPreferences\.composition = ComposeUsing\.USE_DOCUMENT;/);
    assert.match(s, /R\.cjkGridPreferences\.layoutGridColorIndex = UIColors\.LIGHT_BLUE;/);
    assert.match(s, /R\.cjkGridPreferences\.minimumScale = 75;/);
    assert.match(s, /R\.mojikumiUIPreferences\.lineEndAllOneEm = false;/);
});

await test('set_indesign_preferences covers display, GPU, clipboard, spelling, autocorrect and generative AI', async () => {
    const s = await one('set_indesign_preferences', {
        displayPerformance: { defaultView: 'HIGH_QUALITY', preserveObjectLevelSettings: false, fast: { raster: 'GRAY_OUT', antialiasing: false }, highQuality: { vector: 'HIGH_RESOLUTION', greekBelow: 4 } },
        gpuPerformance: { gpuPerformance: true, animatedZoom: false },
        clipboard: { preferPdfWhenPasting: false, pasteTextAndTables: 'text_only' },
        spelling: { repeatedWords: false, dynamicSpelling: true, misspelledWordColor: 'red' },
        autocorrect: { enabled: true, capitalizationErrors: false },
        advancedType: { superscriptSize: 58.3, inlineInput: true },
        generativeAi: { autoGenerateAltText: true, markAltTextAsGenerated: false },
    });
    assert.match(s, /app\.displayPerformancePreferences\.defaultDisplaySettings = ViewDisplaySettings\.HIGH_QUALITY;/);
    assert.match(s, /app\.displayPerformancePreferences\.persistLocalSettings = false;/);
    assert.match(s, /app\.displaySettings\.item\(0\)\.raster = TagRaster\.GRAY_OUT;/);
    assert.match(s, /app\.displaySettings\.item\(0\)\.antialiasing = false;/);
    assert.match(s, /app\.displaySettings\.item\(2\)\.vector = TagVector\.HIGH_RESOLUTION;/);
    assert.match(s, /app\.displaySettings\.item\(2\)\.greekBelow = 4;/);
    assert.match(s, /app\.gpuPerformancePreferences\.enableAnimatedZoom = false;/);
    assert.match(s, /app\.clipboardPreferences\.preferPDFWhenPasting = false;/);
    assert.match(s, /app\.clipboardPreferences\.preferStyledTextWhenPasting = false;/);
    assert.match(s, /app\.spellPreferences\.checkRepeatedWords = false;/);
    assert.match(s, /app\.spellPreferences\.misspelledWordColor = UIColors\.RED;/);
    assert.match(s, /app\.autoCorrectPreferences\.autoCorrectCapitalizationErrors = false;/);
    assert.match(s, /var R = app;\n[\s\S]*R\.textPreferences\.superscriptSize = 58\.3;/);
    assert.match(s, /app\.imePreferences\.inlineInput = true;/);
    assert.match(s, /__setNew\(app\.generalPreferences, "autoGenerateAltText", true, "InDesign 2026 \(21\.5\)"\);/);
    assert.match(s, /__setNew\(app\.generalPreferences, "addAITagToAltText", false, "InDesign 2026 \(21\.5\)"\);/);
    assert.match(s, /fast: \{ raster: __rd\(function \(\) \{ return app\.displaySettings\.item\(0\)\.raster; \}, "enum"\)/);
});

await test('get_indesign_preferences reads the chosen panes', async () => {
    const s = await one('get_indesign_preferences', { panes: ['units', 'guidesPasteboard', 'units'] });
    assert.match(s, /var R = app;/);
    assert.match(s, /out\.units = \{ rulerOrigin: __rd\(function \(\) \{ return R\.viewPreferences\.rulerOrigin; \}, "enum"\)/);
    assert.match(s, /pasteboardMargins: __rd\(function \(\) \{ return R\.pasteboardPreferences\.pasteboardMargins; \}, "pair"\)/);
    assert.equal(s.match(/out\.units = /g).length, 1, 'a pane is read once');
    assert.doesNotMatch(s, /out\.general = /);
    const all = await one('get_indesign_preferences', { scope: 'document' });
    assert.match(all, /var R = __doc\(\);/);
    for (const p of ['general', 'interface', 'type', 'advancedType', 'composition', 'units', 'displayPerformance', 'gpuPerformance', 'fileHandling', 'clipboard', 'guidesPasteboard', 'spelling', 'autocorrect', 'dictionary', 'japaneseLayout', 'generativeAi']) {
        assert.match(all, new RegExp(`out\\.${p} = \\{`), p);
    }
    assert.match(all, /temporaryFolder: __rd\(function \(\) \{ return app\.generalPreferences\.temporaryFolder; \}, "path"\)/);
    assert.match(all, /autoGenerateAltText: __rd\(function \(\) \{ return app\.generalPreferences\["autoGenerateAltText"\]; \}, "value"\)/);
});

await test('set_indesign_preferences refuses bad arguments', () => {
    assert.throws(() => set({}), /Nothing to change/);
    assert.throws(() => set({ scope: 'book', general: { showHomeScreen: true } }), /Allowed: application, document/);
    assert.throws(() => set({ layout: {} }), /Unknown pane 'layout'/);
    assert.throws(() => set({ general: {} }), /'general' has no options to change/);
    assert.throws(() => set({ general: 'yes' }), /'general' must be an object/);
    assert.throws(() => set({ general: { showHome: true } }), /Unknown option 'general\.showHome'/);
    assert.throws(() => set({ general: { showHomeScreen: 'yes' } }), /must be true or false/);
    assert.throws(() => set({ general: { pageNumbering: 'ROMAN' } }), /Allowed: SECTION, ABSOLUTE/);
    assert.throws(() => set({ general: { fontDownloadGlyphLimit: 1.5 } }), /whole number/);
    assert.throws(() => set({ fileHandling: { recentItems: 31 } }), /out of range/);
    assert.throws(() => set({ general: { temporaryFolder: '' } }), /folder path/);
    assert.throws(() => set({ general: { temporaryFolder: '/etc' } }), /allowed|outside|not permitted/i);
    assert.throws(() => set({ interface: { colorTheme: 'blue' } }), /Allowed: dark, medium_dark, medium_light, light/);
    assert.throws(() => set({ units: { pointsPerInch: 90 } }), /out of range/);
    assert.throws(() => set({ units: { horizontalUnits: 'POINTS', horizontalCustomPoints: 12 } }), /applies when units\.horizontalUnits is CUSTOM/);
    assert.throws(() => set({ units: { sizeLeading: 0 } }), /out of range/);
    assert.throws(() => set({ guidesPasteboard: { bleedGuideColor: 'chartreuse' } }), /Allowed: BLACK/);
    assert.throws(() => set({ guidesPasteboard: { pasteboardMargins: {} } }), /needs horizontal or vertical/);
    assert.throws(() => set({ guidesPasteboard: { pasteboardMargins: { top: 3 } } }), /Unknown option 'guidesPasteboard\.pasteboardMargins\.top'/);
    assert.throws(() => set({ displayPerformance: { fast: { raster: 'HIGH' } } }), /Allowed: GRAY_OUT, PROXY, HIGH_RESOLUTION/);
    assert.throws(() => set({ japaneseLayout: { mojikumiSets: { lineEndAll: true } } }), /Unknown option 'japaneseLayout\.mojikumiSets\.lineEndAll'/);
});

await test('get_indesign_preferences refuses bad arguments', () => {
    const get = tool('get_indesign_preferences').handler;
    assert.throws(() => get({ panes: [] }), /non-empty list/);
    assert.throws(() => get({ panes: ['fonts'] }), /Allowed: general/);
    assert.throws(() => get({ scope: 'all' }), /Allowed: application, document/);
});

done();
