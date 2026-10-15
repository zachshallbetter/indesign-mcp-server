/**
 * Printing and prepress tools: the object-model statements their scripts
 * carry, and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const ps = `${home}/Documents/out.ps`;

await test('print_document applies a preset, then settings in dialog order, then prints', async () => {
    const s = await one('print_document', {
        preset: 'Proof',
        settings: {
            ppd: 'DEVICE_INDEPENDENT', printer: 'Office Laser', copies: 2, collating: true, pageRange: '1-4, 7', sequence: 'ODD',
            printLayers: 'VISIBLE_PRINTABLE_LAYERS', paperSize: 'A4', paperWidth: 'AUTO', scaleMode: 'SCALE_WIDTH_HEIGHT', scaleWidth: 90,
            cropMarks: true, markLineWeight: 'P25PT', markOffset: 3, useDocumentBleedToPrint: false, bleedTop: 3,
            colorOutput: 'SEPARATIONS', trapping: 'APPLICATION_BUILTIN', cyanAngle: 15, printBlack: false, screening: '150 lpi / 2400 dpi',
            fontDownloading: 'SUBSET', profile: 'Coated FOGRA39 (ISO 12647-2:2004)', crd: 'WORKING', flattenerPresetName: '[High Resolution]',
        },
    });
    assert.match(s, /pp\.activePrinterPreset = __preset\("Proof"\);/);
    assert.ok(s.indexOf('pp.printer = "Office Laser"') < s.indexOf('pp.ppd = PPDValues.DEVICE_INDEPENDENT'), 'printer before PPD');
    assert.ok(s.indexOf('activePrinterPreset') < s.indexOf('pp.printer ='), 'preset before settings');
    assert.match(s, /pp\.copies = 2;/);
    assert.match(s, /pp\.pageRange = "1-4, 7";/);
    assert.match(s, /pp\.sequence = Sequences\.ODD;/);
    assert.match(s, /pp\.printLayers = PrintLayerOptions\.VISIBLE_PRINTABLE_LAYERS;/);
    assert.match(s, /pp\.paperSize = "A4";/);
    assert.match(s, /pp\.paperWidth = PaperSize\.AUTO;/);
    assert.match(s, /pp\.markLineWeight = MarkLineWeight\.P25PT;/);
    assert.ok(s.indexOf('useDocumentBleedToPrint = false') < s.indexOf('bleedTop = 3'), 'bleed mode before bleed values');
    assert.match(s, /pp\.colorOutput = ColorOutputModes\.SEPARATIONS;/);
    assert.match(s, /pp\.trapping = Trapping\.APPLICATION_BUILTIN;/);
    assert.match(s, /pp\.screening = "150 lpi \/ 2400 dpi";/);
    assert.match(s, /pp\.crd = ColorRenderingDictionary\.WORKING;/);
    assert.match(s, /pp\.profile = "Coated FOGRA39/);
    assert.match(s, /catch \(e\) \{ throw new Error\("settings\.copies: " \+ e\.message\); \}/);
    assert.match(s, /doc\.print\(false\);/);
});

await test('print_document writes PostScript files and can save settings without printing', async () => {
    const s = await one('print_document', { output: 'postscript_file', postscriptFile: ps, settings: { colorOutput: 'COMPOSITE_CMYK' } });
    assert.match(s, /pp\.printer = Printer\.POSTSCRIPT_FILE;/);
    assert.match(s, /pp\.printFile = new File\(".*out\.ps"\);/);
    assert.ok(s.indexOf('Printer.POSTSCRIPT_FILE') < s.indexOf('colorOutput'), 'PostScript printer chosen first');
    const only = await one('print_document', { output: 'settings_only', settings: { textAsBlack: true } });
    assert.match(only, /pp\.textAsBlack = true;/);
    assert.doesNotMatch(only, /doc\.print\(/);
});

await test('print_document refuses bad arguments', () => {
    const p = tool('print_document').handler;
    assert.throws(() => p({ settings: { copies: 0 } }), /out of range/);
    assert.throws(() => p({ settings: { copies: 1.5 } }), /whole number/);
    assert.throws(() => p({ settings: { colour: 'x' } }), /Unknown option 'settings\.colour'/);
    assert.throws(() => p({ settings: { colorOutput: 'CMYK' } }), /Allowed: COMPOSITE_LEAVE_UNCHANGED/);
    assert.throws(() => p({ settings: { cropMarks: 'yes' } }), /true or false/);
    assert.throws(() => p({ output: 'postscript_file' }), /needs postscriptFile/);
    assert.throws(() => p({ postscriptFile: ps }), /only used with output: postscript_file/);
    assert.throws(() => p({ output: 'postscript_file', postscriptFile: `${home}/Documents/out.pdf` }), /must end in \.ps/);
    assert.throws(() => p({ settings: { printer: 'POSTSCRIPT_FILE' } }), /output: postscript_file/);
    assert.throws(() => p({ output: 'postscript_file', postscriptFile: '/etc/out.ps' }), /Access denied|outside/);
    assert.throws(() => p({ output: 'settings_only' }), /Nothing to set/);
});

await test('get_print_settings reads the Print or Print Booklet settings and the device lists', async () => {
    const s = await one('get_print_settings', {});
    assert.match(s, /var pp = doc\.printPreferences;/);
    assert.match(s, /pp\.printerList/);
    assert.match(s, /pp\.pdfPassthrough/);
    assert.match(s, /\["preserveColorNumbers","bool"\]/);
    const b = await one('get_print_settings', { booklet: true });
    assert.match(b, /var pp = doc\.printBookletPrintPreferences;/);
    assert.match(b, /__read\(doc\.printBookletOptions/);
    assert.doesNotMatch(b, /"printSpreads"/);
});

await test('manage_print_preset creates from the document, edits, duplicates and deletes', async () => {
    const [c, u, d, x] = await scriptsFor([
        ['manage_print_preset', { action: 'create', name: 'Proof', fromDocument: true, settings: { cropMarks: true } }],
        ['manage_print_preset', { action: 'update', name: 'Proof', newName: 'Proof 2', settings: { copies: 3 } }],
        ['manage_print_preset', { action: 'duplicate', name: 'Proof' }],
        ['manage_print_preset', { action: 'delete', name: 'Proof' }],
    ]);
    assert.match(c, /var p = app\.printerPresets\.add\(\{ name: "Proof" \}\);/);
    assert.match(c, /__copy\(__doc\(\)\.printPreferences, p, /);
    assert.ok(c.indexOf('__copy(') < c.indexOf('p.cropMarks = true'), 'document settings copied before overrides');
    assert.match(u, /p\.copies = 3;/);
    assert.match(u, /p\.name = "Proof 2";/);
    assert.match(d, /p = p\.duplicate\(\);\np\.name = "Proof copy";/);
    assert.match(x, /p\.remove\(\);/);
    assert.doesNotMatch(c, /var doc = __doc\(\);/);
});

await test('manage_print_preset refuses bad arguments', () => {
    const m = tool('manage_print_preset').handler;
    assert.throws(() => m({ action: 'rename', name: 'P' }), /Allowed: create/);
    assert.throws(() => m({ action: 'create', name: '' }), /non-empty name/);
    assert.throws(() => m({ action: 'create', name: 'P', settings: { pageRange: '1-2' } }), /does not apply to print presets/);
    assert.throws(() => m({ action: 'delete', name: 'P', settings: { copies: 1 } }), /settings apply to create and update/);
    assert.throws(() => m({ action: 'delete', name: 'P', fromDocument: true }), /fromDocument applies/);
    assert.throws(() => m({ action: 'update', name: 'P' }), /Nothing to change/);
});

await test('print_booklet sets booklet setup and print settings, then prints the booklet', async () => {
    const s = await one('print_booklet', {
        booklet: { bookletType: 'TWO_UP_PERFECT_BOUND', signatureSize: 'SIGNATURE_SIZE_16', spaceBetweenPages: 6, bleedBetweenPages: 3, creep: 0.4, autoAdjustMargins: false, topMargin: 10, marginsUniformSize: true, printBlankPrinterSpreads: false, pageRange: '1-16' },
        preset: '[Default]', settings: { cropMarks: true, colorOutput: 'COMPOSITE_CMYK' },
    });
    assert.match(s, /bo\.bookletType = BookletTypeOptions\.TWO_UP_PERFECT_BOUND;/);
    assert.match(s, /bo\.signatureSize = SignatureSizeOptions\.SIGNATURE_SIZE_16;/);
    assert.match(s, /bo\.creep = 0\.4;/);
    assert.match(s, /bo\.pageRange = "1-16";/);
    assert.match(s, /bo\.printBlankPrinterSpreads = false;/);
    assert.match(s, /bp\.activePrinterPreset = __preset\("\[Default\]"\);/);
    assert.match(s, /bp\.cropMarks = true;/);
    assert.match(s, /doc\.printBooklet\(false\);/);
    const f = await one('print_booklet', { output: 'postscript_file', postscriptFile: ps });
    assert.match(f, /bp\.printer = Printer\.POSTSCRIPT_FILE;/);
    assert.match(f, /bp\.printFile = new File\(/);
});

await test('print_booklet refuses bad arguments', () => {
    const b = tool('print_booklet').handler;
    assert.throws(() => b({ settings: { printSpreads: true } }), /does not apply to booklet printing/);
    assert.throws(() => b({ booklet: { bookletType: 'SADDLE' } }), /Allowed: TWO_UP_SADDLE_STITCH/);
    assert.throws(() => b({ booklet: { creep: -1 } }), /out of range/);
    assert.throws(() => b({ booklet: { gutter: 2 } }), /Unknown option 'booklet\.gutter'/);
    assert.throws(() => b({ output: 'settings_only' }), /Nothing to set/);
});

await test('trap presets: options in points, create, load, delete with a replacement, delete unused', async () => {
    const [c, l, d, u, g, app] = await scriptsFor([
        ['manage_trap_preset', { action: 'create', name: 'Press', settings: { defaultTrapWidth: 0.25, blackWidth: 0.5, trapJoin: 'ROUND_END_JOIN', trapEnd: 'OVERLAP_TRAP_ENDS', imagePlacement: 'CHOKE', objectsToImages: true, imagesToImages: true, internalImages: false, oneBitImages: true, stepThreshold: 10, blackColorThreshold: 100, blackDensity: 1.6, slidingTrapThreshold: 70, colorReduction: 100 } }],
        ['manage_trap_preset', { action: 'load', fromFile: `${home}/Documents/presets.indd` }],
        ['manage_trap_preset', { action: 'delete', name: 'Press', replaceWith: '[No Trap Preset]' }],
        ['manage_trap_preset', { action: 'delete_unused' }],
        ['get_trap_presets', {}],
        ['manage_trap_preset', { action: 'update', name: 'Press', scope: 'application', newName: 'Press B' }],
    ]);
    assert.match(c, /var p = doc\.trapPresets\.add\(\{ name: "Press" \}\);/);
    assert.match(c, /p\.defaultTrapWidth = "0\.25pt";/);
    assert.match(c, /p\.blackWidth = "0\.5pt";/);
    assert.match(c, /p\.trapJoin = EndJoin\.ROUND_END_JOIN;/);
    assert.match(c, /p\.trapEnd = TrapEndTypes\.OVERLAP_TRAP_ENDS;/);
    assert.match(c, /p\.imagePlacement = TrapImagePlacementTypes\.CHOKE;/);
    assert.match(c, /p\.oneBitImages = true;/);
    assert.match(c, /p\.stepThreshold = 10;/);
    assert.match(c, /p\.blackDensity = 1\.6;/);
    assert.match(c, /p\.slidingTrapThreshold = 70;/);
    assert.match(c, /p\.colorReduction = 100;/);
    assert.match(l, /__src = app\.open\(__f, false\); __opened = true;/);
    assert.match(l, /if \(__opened\) __src\.close\(SaveOptions\.NO\);/);
    assert.match(l, /doc\.trapPresets\.add\(\{ name: s\.name \}\);/);
    assert.match(d, /var __rep = doc\.trapPresets\.itemByName\("\[No Trap Preset\]"\);/);
    assert.match(d, /p\.remove\(__rep\);/);
    assert.match(u, /pg\.appliedTrapPreset/);
    assert.match(u, /if \(p\.name\.charAt\(0\) === "\[" \|\| use\[p\.name\]\) continue;/);
    assert.match(g, /o\.unused = /);
    assert.match(app, /var p = app\.trapPresets\.itemByName\("Press"\);/);
    assert.match(app, /p\.name = "Press B";/);
});

await test('manage_trap_preset refuses bad arguments', () => {
    const m = tool('manage_trap_preset').handler;
    assert.throws(() => m({ action: 'create', name: 'P', settings: { defaultTrapWidth: 9 } }), /out of range/);
    assert.throws(() => m({ action: 'create', name: 'P', settings: { trapJoin: 'ROUND' } }), /Allowed: MITER_END_JOIN/);
    assert.throws(() => m({ action: 'load' }), /file path/);
    assert.throws(() => m({ action: 'load', fromFile: `${home}/Documents/presets.txt` }), /must end in \.indd/);
    assert.throws(() => m({ action: 'load', scope: 'application', fromFile: `${home}/Documents/a.indd` }), /scope: document/);
    assert.throws(() => m({ action: 'create', name: 'P', replaceWith: 'X' }), /replaceWith applies/);
    assert.throws(() => m({ action: 'update', name: 'P' }), /Nothing to change/);
});

await test('get_preflight_info reads profiles, rules, options and the live status', async () => {
    const s = await one('get_preflight_info', { profile: 'Press', ruleCatalog: true, maxResults: 20 });
    assert.match(s, /__rules\(__profile\(null, "Press", false\)\)/);
    assert.match(s, /app\.allPreflightRuleIDs/);
    assert.match(s, /var pr = doc\.activeProcess;/);
    assert.match(s, /pr\.aggregatedResults/);
    assert.match(s, /i < 20/);
    const e = await one('get_preflight_info', { profile: 'Press', embedded: true, status: false });
    assert.match(e, /__profile\(doc, "Press", true\)/);
    assert.doesNotMatch(e, /activeProcess/);
    assert.throws(() => tool('get_preflight_info').handler({ maxResults: 0 }), /out of range/);
});

await test('manage_preflight_profile edits rules and data, loads, exports, embeds and unembeds', async () => {
    const [c, l, x, em, un] = await scriptsFor([
        ['manage_preflight_profile', { action: 'create', name: 'Press', description: 'For press', copyFrom: '[Basic]', rules: [{ id: 'ADBE_ImageResolution', flag: 'error', data: { ADBE_minres_cgray: 250, ADBE_minres_cgray_on: true, ADBE_ratio: 1.5, ADBE_name: 'x', ADBE_list: ['a', 'b'] } }, { id: 'ADBE_BlankPages', flag: 'disabled' }] }],
        ['manage_preflight_profile', { action: 'load', filePath: `${home}/Documents/press.idpp` }],
        ['manage_preflight_profile', { action: 'export', name: 'Press', filePath: `${home}/Documents/press.idpp` }],
        ['manage_preflight_profile', { action: 'embed', name: 'Press' }],
        ['manage_preflight_profile', { action: 'unembed', name: 'Press' }],
    ]);
    assert.match(c, /var p = app\.preflightProfiles\.add\(\{ name: "Press" \}\);/);
    assert.match(c, /p\.update\(__profile\(null, "\[Basic\]", false\)\);/);
    assert.match(c, /p\.description = "For press";/);
    assert.match(c, /var r = __rule\(p, "ADBE_ImageResolution"\);/);
    assert.match(c, /r\.flag = PreflightRuleFlag\.RETURN_AS_ERROR;/);
    assert.match(c, /__data\(r, "ADBE_minres_cgray", RuleDataType\.INTEGER_DATA_TYPE, 250\);/);
    assert.match(c, /RuleDataType\.BOOLEAN_DATA_TYPE, true/);
    assert.match(c, /RuleDataType\.REAL_DATA_TYPE, 1\.5/);
    assert.match(c, /RuleDataType\.STRING_DATA_TYPE, "x"/);
    assert.match(c, /RuleDataType\.LIST_DATA_TYPE, \["a","b"\]/);
    assert.match(c, /r\.flag = PreflightRuleFlag\.RULE_IS_DISABLED;/);
    assert.match(l, /app\.loadPreflightProfile\(__f\)/);
    assert.match(x, /p\.save\(new File\(".*press\.idpp"\)\);/);
    assert.match(em, /doc\.embed\(p\)/);
    assert.match(un, /__profile\(doc, "Press", true\)/);
    assert.match(un, /p\.unembed\(\);/);
    const r = await one('manage_preflight_profile', { action: 'update', name: 'Press', removeRules: ['ADBE_BlankPages'], newName: 'Press 2' });
    assert.match(r, /rs\.item\(i\)\.id === "ADBE_BlankPages"\) rs\.item\(i\)\.remove\(\);/);
    assert.match(r, /p\.name = "Press 2";/);
});

await test('manage_preflight_profile refuses bad arguments', () => {
    const m = tool('manage_preflight_profile').handler;
    assert.throws(() => m({ action: 'create', name: 'P', rules: [{ id: 'bad id' }] }), /rule id/);
    assert.throws(() => m({ action: 'create', name: 'P', rules: [{ id: 'ADBE_X', flag: 'fatal' }] }), /Allowed: error/);
    assert.throws(() => m({ action: 'create', name: 'P', rules: [{ id: 'ADBE_X', data: { a: { b: 1 } } }] }), /boolean, number, string/);
    assert.throws(() => m({ action: 'create', name: 'P', rules: [{ id: 'ADBE_X', level: 1 }] }), /Unknown option 'rules\[0\]\.level'/);
    assert.throws(() => m({ action: 'load', filePath: `${home}/Documents/p.txt` }), /must end in \.idpp/);
    assert.throws(() => m({ action: 'delete', name: 'P', rules: [] }), /rules applies to create and update/);
    assert.throws(() => m({ action: 'embed', name: 'P', embedded: true }), /embedded applies/);
    assert.throws(() => m({ action: 'update', name: 'P' }), /Nothing to change/);
});

await test('set_preflight_options sets document or application options and the panel row limit', async () => {
    const [d, a] = await scriptsFor([
        ['set_preflight_options', { enabled: true, workingProfile: 'Press', pages: '1-4', layers: 'PREFLIGHT_VISIBLE_PRINTABLE_LAYERS', includeObjectsOnPasteboard: false, includeNonprintingObjects: true, profilePolicy: 'USE_WORKING_PROFILE' }],
        ['set_preflight_options', { scope: 'application', enabled: false, embedWorkingProfile: true, pages: 'all', panelRowsPerError: '50' }],
    ]);
    assert.match(d, /var po = doc\.preflightOptions;/);
    assert.match(d, /po\.preflightOff = false;/);
    assert.match(d, /var __w = doc\.preflightProfiles\.itemByName\("Press"\); if \(!__w\.isValid\) __w = app\.preflightProfiles/);
    assert.match(d, /po\.preflightWorkingProfile = __w;/);
    assert.match(d, /po\.preflightScope = "1-4";/);
    assert.match(d, /po\.preflightWhichLayers = PreflightLayerOptions\.PREFLIGHT_VISIBLE_PRINTABLE_LAYERS;/);
    assert.match(d, /po\.preflightIncludeNonprintingObjects = true;/);
    assert.match(d, /po\.preflightProfilePolicy = PreflightProfileOptions\.USE_WORKING_PROFILE;/);
    assert.match(a, /var po = app\.preflightOptions;/);
    assert.match(a, /po\.preflightOff = true;/);
    assert.match(a, /po\.preflightEmbedWorkingProfile = true;/);
    assert.match(a, /po\.preflightScope = PreflightScopeOptions\.PREFLIGHT_ALL_PAGES;/);
    assert.match(a, /__menu\(133909, /);
    assert.doesNotMatch(a, /var doc = __doc\(\);/);
    const s = tool('set_preflight_options').handler;
    assert.throws(() => s({}), /Nothing to set/);
    assert.throws(() => s({ layers: 'ALL' }), /Allowed: PREFLIGHT_ALL_LAYERS/);
    assert.throws(() => s({ panelRowsPerError: '10' }), /Allowed: 25/);
    assert.throws(() => s({ enabled: 'on' }), /true or false/);
});

await test('set_separation_inks sets Ink Manager options per ink and for all spots', async () => {
    const s = await one('set_separation_inks', {
        inks: [{ name: 'PANTONE 185 C', alias: 'Process Magenta', type: 'OPAQUE', neutralDensity: 0.8, trapOrder: 5, convertToProcess: false, print: true, frequency: 150, angle: 45 }],
        allSpotsToProcess: true, useStandardLabValuesForSpots: false,
    });
    assert.match(s, /doc\.accurateLABSpots = false;/);
    assert.match(s, /if \(!__k\.isProcessInk\) __k\.convertToProcess = true;/);
    assert.match(s, /var k = doc\.inks\.itemByName\("PANTONE 185 C"\);/);
    assert.match(s, /k\.aliasInkName = "Process Magenta";/);
    assert.match(s, /k\.inkType = InkTypes\.OPAQUE;/);
    assert.match(s, /k\.neutralDensity = 0\.8;/);
    assert.match(s, /k\.trapOrder = 5;/);
    assert.match(s, /k\.printInk = true;/);
    assert.match(s, /k\.frequency = 150;/);
    assert.match(s, /k\.angle = 45;/);
    const set = tool('set_separation_inks').handler;
    assert.throws(() => set({}), /Nothing to set/);
    assert.throws(() => set({ inks: [{ name: 'X' }] }), /nothing to set/);
    assert.throws(() => set({ inks: [{ name: 'X', neutralDensity: 0 }] }), /out of range/);
    assert.throws(() => set({ inks: [{ name: 'X', type: 'GLOSSY' }] }), /Allowed: NORMAL/);
    assert.throws(() => set({ inks: [{ name: 'X', density: 1 }] }), /Unknown option 'inks\[0\]\.density'/);
    assert.match(await one('get_inks', {}), /doc\.accurateLABSpots/);
});

await test('set_output_preview sets overprint preview and separations preview through menu actions', async () => {
    const s = await one('set_output_preview', { overprintPreview: true, separationsPanel: true, flattenerPanel: false, plate: 'cyan', singlePlatesInBlack: true, desaturateBlack: false });
    assert.match(s, /doc\.layoutWindows\.item\(0\)\.overprintPreview = true;/);
    assert.match(s, /__toggle\(71937, /);
    assert.match(s, /__toggle\(71946, "Window > Output > Flattener Preview", false\)/);
    assert.match(s, /__toggle\(71942, "Separations Preview > Show Single Plates in Black", true\)/);
    assert.match(s, /__toggle\(71940, "Separations Preview > Desaturate Black", false\)/);
    assert.match(s, /__menu\(71957, /);
    assert.match(await one('set_output_preview', { plate: 'all' }), /__menu\(71956, /);
    assert.match(await one('set_output_preview', { plate: 'spot_2' }), /__menu\(71962, /);
    const p = tool('set_output_preview').handler;
    assert.throws(() => p({}), /Nothing to set/);
    assert.throws(() => p({ plate: 'spot_6' }), /Allowed: all/);
    assert.throws(() => p({ overprintPreview: 1 }), /true or false/);
});

await test('set_print_attributes sets overprint, nonprinting, text and rule overprint, footnote rules, black and layers', async () => {
    const s = await one('set_print_attributes', {
        target: { ids: [5] }, items: { overprintFill: true, overprintStroke: false, overprintGap: true, nonprinting: true },
        text: { frameIds: [6] }, textOverprint: { fill: true, ruleAbove: true, ruleBelowGap: false },
        footnoteRules: { rule: true, continuingRule: false }, overprintBlack: true, layers: [{ name: 'Notes', printable: false }],
    });
    assert.match(s, /it\.overprintFill = true;/);
    assert.match(s, /it\.overprintGap = true;/);
    assert.match(s, /it\.nonprinting = true;/);
    assert.match(s, /__texts\(doc, \{"storyIds":null,"frameIds":\[6\]/);
    assert.match(s, /t\.overprintFill = true;/);
    assert.match(s, /t\.ruleAboveOverprint = true;/);
    assert.match(s, /t\.ruleBelowGapOverprint = false;/);
    assert.match(s, /fo\.ruleOverprint = true;/);
    assert.match(s, /fo\.continuingRuleOverprint = false;/);
    assert.match(s, /doc\.documentPreferences\.overprintBlack = true;/);
    assert.match(s, /__l\.printable = false;/);
    const p = tool('set_print_attributes').handler;
    assert.throws(() => p({}), /Nothing to set/);
    assert.throws(() => p({ items: { overprintFill: true } }), /Choose the items/);
    assert.throws(() => p({ target: { ids: [1] } }), /target needs items/);
    assert.throws(() => p({ textOverprint: { fill: true } }), /Choose the text/);
    assert.throws(() => p({ target: { ids: [1] }, items: { knockout: true } }), /Unknown option 'items\.knockout'/);
    assert.throws(() => p({ layers: [{ name: 'A' }] }), /printable' must be true or false/);
});

await test('get_package_report and package_document_for_print', async () => {
    const r = await one('get_package_report', { maxItems: 10 });
    assert.match(r, /doc\.fonts\.item\(i\)/);
    assert.match(r, /f\.status/);
    assert.match(r, /l\.status/);
    assert.match(r, /g\.effectivePpi/);
    assert.match(r, /__inks\(doc\)/);
    assert.match(r, /__read\(pp, /);
    assert.match(r, /fonts\.length < 10/);
    const p = await one('package_document_for_print', { outputPath: `${home}/Documents/pkg`, useDocumentHyphenationExceptionsOnly: true, includeIdml: true, pdfPreset: '[Press Quality]', versionComments: 'v2' });
    assert.match(p, /doc\.packageForPrint\(__f, true, true, true, true, false, false, true, true, false, "\[Press Quality\]", true, "v2", false\);/);
    const pk = tool('package_document_for_print').handler;
    assert.throws(() => pk({}), /file path/);
    assert.throws(() => pk({ outputPath: '/etc/pkg' }), /Access denied|outside/);
    assert.throws(() => pk({ outputPath: `${home}/Documents/pkg`, includePdf: 'yes' }), /true or false/);
});

done();
