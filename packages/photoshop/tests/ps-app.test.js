/**
 * Application, interface, Camera Raw and generative tools: generated scripts
 * and argument checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('preferences set object-model properties, the prelude\'s saved units and the theme', async () => {
    const [s] = await scriptsFor([['set_photoshop_preferences', {
        colorPicker: 'adobe', historyStates: 200, rulerUnits: 'inches', typeUnits: 'points', scriptDialogs: 'error',
        colorTheme: 'darkest', smartQuotes: false, guideStyle: 'dashed', gridSubdivisions: 4, maximizeCompatibility: 'always',
    }]]);
    assert.match(s, /p\.colorPicker = ColorPicker\.ADOBE;/);
    assert.match(s, /p\.numberOfHistoryStates = 200;/);
    assert.match(s, /__prevRuler = Units\.INCHES;/);
    assert.match(s, /__prevType = TypeUnits\.POINTS;/);
    assert.match(s, /__prevDialogs = DialogModes\.ERROR;/);
    assert.match(s, /kuiBrightnessLevel"\), app\.stringIDToTypeID\("uiBrightnessLevelEnumType"\), app\.stringIDToTypeID\("kPanelBrightnessDarkGray"\)/);
    assert.match(s, /p\.smartQuotes = false;/);
    assert.match(s, /p\.guideStyle = GuideLineStyle\.DASHED;/);
    assert.match(s, /p\.maximizeCompatibility = QueryStateType\.ALWAYS;/);
    // The settings are read back afterwards, units from the values the prelude restores.
    assert.match(s, /prefs\.rulerUnits = .*\[__enumName\(__prevRuler\)\]/);
    // The prelude's finally block comes after the body, so the new units stick.
    assert.ok(s.indexOf('__prevRuler = Units.INCHES') < s.indexOf('app.preferences.rulerUnits = __prevRuler'));

    const [folder] = await scriptsFor([['set_photoshop_preferences', { additionalPluginFolder: `${home}/Documents/Plugins` }]]);
    assert.match(folder, /p\.useAdditionalPluginFolder = true;\np\.additionalPluginFolder = __folder;/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', {}), /at least one preference/);
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', { cacheLevels: 9 }), /Invalid index|out of range/);
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', { historyStates: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', { colorPicker: 'mine' }), /Allowed: adobe/);
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', { beepWhenDone: 'yes' }), /true or false/);
    await assert.rejects(mcp.handleToolCall('set_photoshop_preferences', { additionalPluginFolder: '/etc' }), /outside|allowed|not permitted|within/i);
});

test('information, purge, commands, menu items, script options and quit', async () => {
    const [info, purge, beep, menu, chars, set, get, erase, quit] = await scriptsFor([
        ['get_photoshop_info', { systemInfo: true, features: ['photoshop/extended'] }],
        ['purge_photoshop_caches', { target: 'clipboard' }],
        ['run_photoshop_command', { command: 'beep' }],
        ['run_photoshop_menu_item', { stringID: 'toggleRulers' }],
        ['run_photoshop_menu_item', { charID: 'ZmIn' }],
        ['manage_script_options', { action: 'set', key: 'com.example', values: { mode: 'fast', count: 2, on: true }, persistent: false }],
        ['manage_script_options', { action: 'get', key: 'com.example' }],
        ['manage_script_options', { action: 'erase', key: 'com.example' }],
        ['quit_photoshop', {}],
    ]);
    assert.match(info, /info\.systemInfo = app\.systemInformation;/);
    assert.match(info, /app\.featureEnabled\(names\[k\]\)/);
    assert.match(purge, /app\.purge\(PurgeTarget\.CLIPBOARDCACHE\);/);
    assert.match(beep, /app\.beep\(\);/);
    assert.match(menu, /app\.runMenuItem\(app\.stringIDToTypeID\("toggleRulers"\)\);/);
    assert.match(chars, /app\.runMenuItem\(app\.charIDToTypeID\("ZmIn"\)\);/);
    assert.match(set, /d\.putString\(app\.stringIDToTypeID\("mode"\), "fast"\);/);
    assert.match(set, /d\.putDouble\(app\.stringIDToTypeID\("count"\), 2\);/);
    assert.match(set, /app\.putCustomOptions\("com\.example", d, false\);/);
    assert.match(get, /app\.getCustomOptions\("com\.example"\)/);
    assert.match(erase, /app\.eraseCustomOptions\("com\.example"\);/);
    assert.match(quit, /if \(unsaved\.length && !false\) throw/);
    assert.ok(quit.indexOf('app.executeAction(app.stringIDToTypeID("quit")') > quit.indexOf('} finally {'));

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_photoshop_menu_item', {}), /stringID or charID/);
    await assert.rejects(mcp.handleToolCall('run_photoshop_menu_item', { stringID: 'a"); app.quit("' }), /letters, digits/);
    await assert.rejects(mcp.handleToolCall('run_photoshop_menu_item', { charID: 'Zoom1' }), /four characters/);
    await assert.rejects(mcp.handleToolCall('manage_script_options', { action: 'set', key: 'k', values: { 'bad name': 1 } }), /letters, digits/);
    await assert.rejects(mcp.handleToolCall('manage_script_options', { action: 'set', key: 'k', values: { a: [1] } }), /string, number or boolean/);
    await assert.rejects(mcp.handleToolCall('manage_script_options', { action: 'get' }), /'key'/);
    await assert.rejects(mcp.handleToolCall('purge_photoshop_caches', { target: 'fonts' }), /Allowed: all/);
    if (process.platform !== 'darwin') await assert.rejects(mcp.handleToolCall('run_photoshop_command', { command: 'hide_others' }), /macOS/);
});

test('interface commands map to their menu items and events', async () => {
    const [arrange, view, extras, panels, tool] = await scriptsFor([
        ['arrange_photoshop_windows', { layout: 'two_up_vertical' }],
        ['set_zoom_and_screen_mode', { zoom: 'fit_on_screen', screenMode: 'full' }],
        ['toggle_view_extras', { items: ['rulers', 'snap_to_layers', 'pixel_grid'] }],
        ['show_photoshop_panels', { workspace: 'essentials', show: ['histogram'], hide: ['tools'], histogramView: 'expanded', refreshHistogram: true }],
        ['select_view_tool', { tool: 'rotate_view' }],
    ]);
    assert.match(arrange, /app\.runMenuItem\(app\.stringIDToTypeID\("2upVertical"\)\);/);
    assert.match(view, /app\.charIDToTypeID\("FtOn"\)/);
    assert.match(view, /app\.stringIDToTypeID\("screenModeFullScreen"\)/);
    assert.match(extras, /app\.charIDToTypeID\("TglR"\)[\s\S]*snapToLayerBounds[\s\S]*togglePixelGrid/);
    assert.match(panels, /defaultWorkspace[\s\S]*__panel\("show", "panelid\.static\.histogram"\);\n__panel\("hide", "panelid\.static\.toolbar"\);/);
    assert.match(panels, /histogramPaletteExpandedView[\s\S]*histogramPaletteUncachedRefresh/);
    assert.match(tool, /app\.currentTool = "rotateTool";/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_zoom_and_screen_mode', {}), /Give zoom/);
    await assert.rejects(mcp.handleToolCall('toggle_view_extras', { items: [] }), /at least one/);
    await assert.rejects(mcp.handleToolCall('toggle_view_extras', { items: ['grid', 'grid'] }), /twice/);
    await assert.rejects(mcp.handleToolCall('show_photoshop_panels', {}), /Nothing to do/);
    await assert.rejects(mcp.handleToolCall('show_photoshop_panels', { show: ['info'], hide: ['info'] }), /both shown and hidden/);
    await assert.rejects(mcp.handleToolCall('arrange_photoshop_windows', { layout: 'eight_up' }), /Allowed/);
});

test('guides: add, lay out, clear and make from a shape', async () => {
    const [add, layout, clear, canvas, shape] = await scriptsFor([
        ['edit_photoshop_guides', { action: 'add', direction: 'vertical', positions: [10, 20.5] }],
        ['edit_photoshop_guides', { action: 'layout', columns: 12, gutter: 20, margin: { left: 40, right: 40 }, clearExisting: false }],
        ['edit_photoshop_guides', { action: 'clear' }],
        ['edit_photoshop_guides', { action: 'clear_canvas' }],
        ['edit_photoshop_guides', { action: 'from_shape', target: { ids: [3] } }],
    ]);
    assert.match(add, /var at = \[10, 20\.5\];\nfor .*doc\.guides\.add\(Direction\.VERTICAL, new UnitValue\(at\[i\], "px"\)\);/);
    assert.match(layout, /var L = \{"columns":12,"rows":0,"gutter":20,"margin":\{"top":null,"left":40,"bottom":null,"right":40\}\}/);
    assert.doesNotMatch(layout, /removeAll/);
    assert.match(clear, /doc\.guides\.removeAll\(\);/);
    assert.match(canvas, /clearCanvasGuides/);
    assert.match(shape, /newGuidesFromTarget/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_photoshop_guides', { action: 'add', direction: 'vertical' }), /positions/);
    await assert.rejects(mcp.handleToolCall('edit_photoshop_guides', { action: 'add', direction: 'diagonal', positions: [1] }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('edit_photoshop_guides', { action: 'layout' }), /columns, rows or a margin/);
    await assert.rejects(mcp.handleToolCall('edit_photoshop_guides', { action: 'layout', columns: 2.5 }), /whole numbers/);
});

test('Camera Raw: raw open options, the filter descriptor, neural filters, sky and background', async () => {
    const raw = `${home}/Pictures/a.cr3`;
    const [open, defaults, acr, neural, sky, bg] = await scriptsFor([
        ['open_raw_file', { filePath: raw, whiteBalance: 'daylight', exposure: 1.5, calibration: { redHue: 10 }, colorSpace: 'prophoto_rgb', bitsPerChannel: 16, size: 'maximum' }],
        ['open_raw_file', { filePath: raw }],
        ['apply_camera_raw_settings', { settings: { exposure: 0.75, clarity: 15, temperature: -10 } }],
        ['apply_neural_filter', { filter: 'depth_blur', options: { aperture: 70 } }],
        ['replace_sky', { skyFile: `${home}/Pictures/sky.jpg`, fadeEdge: 40, lightingMode: 'multiply', output: 'duplicate_layer' }],
        ['remove_background', { target: { ids: [2, 5] } }],
    ]);
    assert.match(open, /o\.settings = CameraRAWSettingsType\.CUSTOM;/);
    assert.match(open, /o\.exposure = 1\.5;/);
    assert.match(open, /o\.redHue = 10;/);
    assert.match(open, /o\.whiteBalance = WhiteBalanceType\.DAYLIGHT;/);
    assert.match(open, /o\.colorSpace = ColorSpaceType\.PROPHOTORGB;/);
    assert.match(open, /o\.bitsPerChannel = BitsPerChannelType\.SIXTEEN;/);
    assert.match(open, /var d = app\.open\(f, o\);/);
    assert.match(defaults, /o\.settings = CameraRAWSettingsType\.CAMERA;/);
    assert.match(acr, /d\.putEnumerated\(app\.charIDToTypeID\("WBal"\), app\.charIDToTypeID\("WBal"\), app\.charIDToTypeID\("Cst "\)\);/);
    assert.match(acr, /d\.putDouble\(app\.charIDToTypeID\("Ex12"\), 0\.75\);/);
    assert.match(acr, /d\.putInteger\(app\.charIDToTypeID\("Cl12"\), 15\);/);
    assert.match(acr, /d\.putString\(app\.charIDToTypeID\("CrVe"\), "18\.2\.2"\);/);
    assert.match(acr, /app\.executeAction\(app\.stringIDToTypeID\("Adobe Camera Raw Filter"\), d, DialogModes\.NO\);/);
    assert.match(neural, /v\.putInteger\(__s\("spl::slideAperture"\), 70\);/);
    assert.match(neural, /f\.putString\(__s\("spl::id"\), "internal\.Hazy"\);/);
    assert.match(neural, /d\.putInteger\(__s\("NF_OUTPUT_TYPE"\), 2\);/);
    assert.match(sky, /d\.putInteger\(app\.stringIDToTypeID\("borderSmoothness"\), 40\);/);
    assert.match(sky, /app\.charIDToTypeID\("Mltp"\)/);
    assert.match(sky, /skyReplacementOutputToDuplicateSheet/);
    assert.match(sky, /d\.putString\(app\.charIDToTypeID\("Nm {2}"\), "sky\.jpg"\);/);
    assert.match(bg, /doc\.activeLayer = l;\n\s+app\.executeAction\(app\.stringIDToTypeID\("removeBackground"\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_raw_file', { filePath: raw, exposure: 9 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('open_raw_file', { filePath: raw, settings: 'camera', tint: 5 }), /settings: custom/);
    await assert.rejects(mcp.handleToolCall('open_raw_file', { filePath: raw, calibration: { purpleHue: 5 } }), /Allowed: redHue/);
    await assert.rejects(mcp.handleToolCall('apply_camera_raw_settings', { settings: {} }), /at least one/);
    await assert.rejects(mcp.handleToolCall('apply_camera_raw_settings', { settings: { saturation: 5 } }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('apply_neural_filter', { filter: 'depth_blur', options: { blur: 5 } }), /Allowed: aperture/);
    await assert.rejects(mcp.handleToolCall('apply_neural_filter', { filter: 'depth_blur', style: 'x' }), /style_transfer settings/);
    await assert.rejects(mcp.handleToolCall('replace_sky', { skyFile: `${home}/Pictures/sky.jpg`, fadeEdge: 120 }), /out of range/);
});

test('generative tools build the Firefly request and check prompts', async () => {
    const [fill, remove, image, harmonize] = await scriptsFor([
        ['generative_fill', { prompt: 'a red "kite"', contentType: 'photo', seed: 42 }],
        ['generative_fill', {}],
        ['generate_image', { prompt: 'a lighthouse at dusk' }],
        ['harmonize_layer', { target: { ids: [9] } }],
    ]);
    assert.match(fill, /__clio\("tinp", "a red \\"kite\\"", 42, "photo", ""\)/);
    assert.match(fill, /__request\(doc\.activeLayer\.id, "a red \\"kite\\"", "clio", services, "in_painting"\)/);
    assert.match(fill, /app\.executeAction\(__s\("syntheticFill"\), d, DialogModes\.NO\);/);
    assert.match(fill, /needs a selection/);
    assert.match(remove, /__clio\("tinp", "", -1, "none", ""\)/);
    assert.match(image, /doc\.selection\.selectAll\(\);/);
    assert.match(image, /__s\("syntheticTextToImage"\), __request\(0, "a lighthouse at dusk", "clio", services, "text_to_image"\)/);
    assert.match(harmonize, /__s\("syntheticGenHarmonize"\), __request\(l\.id, "", "gen_harmonize", services, "gen_harmonize"\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('generate_image', { prompt: '  ' }), /'prompt' is required/);
    await assert.rejects(mcp.handleToolCall('generate_image', {}), /'prompt' is text/);
    await assert.rejects(mcp.handleToolCall('generative_fill', { prompt: 'x'.repeat(1001) }), /1000 characters/);
    await assert.rejects(mcp.handleToolCall('generative_fill', { seed: -2 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('generative_fill', { contentType: 'vector' }), /Allowed: none/);
});

test('generative and cloud tools are marked open-world, and quit and purge destructive', async () => {
    const { toolDefinitions } = await import('../src/server.js');
    const by = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['generative_fill', 'generate_image', 'harmonize_layer', 'apply_neural_filter', 'remove_background', 'run_photoshop_command']) assert.equal(by[n].openWorldHint, true, n);
    for (const n of ['quit_photoshop', 'purge_photoshop_caches', 'run_photoshop_menu_item']) assert.equal(by[n].destructiveHint, true, n);
    for (const n of ['get_photoshop_info', 'get_photoshop_preferences']) assert.equal(by[n].readOnlyHint, true, n);
});
