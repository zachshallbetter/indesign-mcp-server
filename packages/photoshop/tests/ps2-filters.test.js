/**
 * Filters, Camera Raw and adjustments, round 2: Diffuse and Extrude options,
 * Lens Correction, Adaptive Wide Angle and the Filter Gallery in apply_filter;
 * Auto Color Correction Options, Match Color and Replace Color in
 * adjust_layers; Color and Vibrance, Clarity and Dehaze and Grain settings on
 * adjustment layers; the Camera Raw Filter panels; Photo Restoration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

const apply = (filter, options) => ['apply_filter', { filter, target: { ids: [4] }, ...(options ? { options } : {}) }];
const adjust = (adjustment, options) => ['adjust_layers', { adjustment, target: { ids: [4] }, ...(options ? { options } : {}) }];
const cid = (id) => `app.charIDToTypeID("${id}")`;
const has = (script, text) => assert.ok(script.includes(text), `missing: ${text}`);
const lacks = (script, text) => assert.ok(!script.includes(text), `unexpected: ${text}`);

async function features(name) {
    const { toolTable } = await import('../src/server.js');
    return toolTable.find((t) => t.name === name).features;
}

test('Diffuse and Extrude write only the settings given', async () => {
    const [diffuse, diffuseMode, extrude, extrudeAll] = await scriptsFor([
        apply('diffuse'),
        apply('diffuse', { mode: 'darken_only' }),
        apply('extrude'),
        apply('extrude', { type: 'pyramids', size: 20, depth: 40, depthMode: 'level_based', solidFrontFaces: false, maskIncompleteBlocks: true }),
    ]);
    lacks(diffuse, cid('Md  '));
    has(diffuse, 'app.executeAction(app.stringIDToTypeID("diffuse"), d, DialogModes.NO)');
    has(diffuseMode, `d.putEnumerated(${cid('Md  ')}, ${cid('DfsM')}, ${cid('DrkO')});`);
    lacks(extrude, cid('ExtT'));
    has(extrude, 'app.executeAction(app.stringIDToTypeID("extrude"), d, DialogModes.NO)');
    has(extrudeAll, `d.putEnumerated(${cid('ExtT')}, ${cid('ExtT')}, ${cid('Pyrm')});`);
    has(extrudeAll, `d.putInteger(${cid('ExtS')}, 20);`);
    has(extrudeAll, `d.putInteger(${cid('ExtD')}, 40);`);
    has(extrudeAll, `d.putEnumerated(${cid('ExtR')}, ${cid('ExtR')}, ${cid('LvlB')});`);
    has(extrudeAll, `d.putBoolean(${cid('ExtF')}, false);`);
    has(extrudeAll, `d.putBoolean(${cid('ExtM')}, true);`);
});

test('Lens Correction plays LnCr with the Auto Correction and Custom keys', async () => {
    const [auto, custom, plain] = await scriptsFor([
        apply('lens_correction', { geometricDistortion: true, chromaticAberration: true, vignette: false, autoScale: true, edge: 'transparency', profile: 'Canon EF 24-70mm f/2.8L USM' }),
        apply('lens_correction', { removeDistortion: -12.5, fringeRedCyan: 10, fringeGreenMagenta: -5, fringeBlueYellow: 3, vignetteAmount: -40, vignetteMidpoint: 30, verticalPerspective: -20, horizontalPerspective: 15, angle: 2.5, scale: 110 }),
        apply('lens_correction', { profileFile: `${home}/Documents/lens.lcp` }),
    ]);
    has(auto, `app.executeAction(${cid('LnCr')}, d, DialogModes.NO)`);
    for (const [k, v] of [['LnAg', true], ['LnAc', true], ['LnAv', false], ['LnAs', true]]) has(auto, `d.putBoolean(${cid(k)}, ${v});`);
    has(auto, `d.putInteger(${cid('LnFt')}, 2);`);
    has(auto, `d.putString(${cid('LnPr')}, "Canon EF 24-70mm f/2.8L USM");`);
    for (const [k, v] of [['LnIa', -12.5], ['LnRc', 10], ['LnGm', -5], ['LnBy', 3], ['LnSb', -40], ['LnVp', -20], ['LnHp', 15], ['LnRa', 2.5], ['LnSi', 110]]) has(custom, `d.putDouble(${cid(k)}, ${v});`);
    has(custom, `d.putInteger(${cid('LnSt')}, 30);`);
    lacks(custom, cid('LnAg'));
    assert.match(plain, /d\.putString\(app\.charIDToTypeID\("LnPp"\), new File\(".*\/Documents\/lens\.lcp"\)\.fsName\);/);
});

test('Adaptive Wide Angle and the Filter Gallery run with their last-used settings', async () => {
    const [wide, gallery] = await scriptsFor([apply('adaptive_wide_angle'), apply('filter_gallery')]);
    has(wide, 'app.executeAction(app.stringIDToTypeID("22C3EEBF-A978-4ca9-91DF-E4F0CCEE5ACE"), d, DialogModes.NO)');
    has(gallery, `app.executeAction(${cid('GEfc')}, d, DialogModes.NO)`);
});

test('apply_filter refuses bad Diffuse, Extrude and Lens Correction settings', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'diffuse', options: { mode: 'anisotropic' } }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'extrude', options: { size: 1 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'extrude', options: { depth: 2.5 } }), /whole number/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'extrude', options: { solidFrontFaces: 'yes' } }), /true or false/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'lens_correction', options: { scale: 200 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'lens_correction', options: { edge: 'gray' } }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'lens_correction', options: { profile: 'A', profileFile: `${home}/Documents/a.lcp` } }), /not both/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'lens_correction', options: { profileFile: '/etc/passwd' } }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('apply_filter', { filter: 'lens_correction', options: { showGrid: true } }), /has no option showGrid/);
});

test('apply_filter claims the new filter features', async () => {
    const list = await features('apply_filter');
    for (const id of ['filters.filter_gallery', 'filters.diffuse_option.lighten_only', 'filters.extrude_option.mask_incomplete_blocks', 'filters.lens_correction', 'filters.lens_correction_option.lens_profiles', 'filters.lens_correction_option.scale', 'filters.adaptive_wide_angle']) {
        assert.ok(list.includes(`photoshop.${id}`), id);
    }
});

test('Auto Color Correction Options, Match Color and Replace Color', async () => {
    const [tone, mono, colour, match, replace] = await scriptsFor([
        adjust('auto_color_correction'),
        adjust('auto_color_correction', { algorithm: 'monochromatic_contrast' }),
        adjust('auto_color_correction', { algorithm: 'dark_and_light_colors', snapNeutralMidtones: true }),
        adjust('match_color', { luminance: 120, colorIntensity: 80, fade: 25, neutralize: true }),
        adjust('replace_color', { color: '#3366CC', fuzziness: 60, hue: 30, saturation: -20, lightness: 10 }),
    ]);
    has(tone, '__amDo("levels", [["@Auto",["b",true]]]);');
    has(mono, '__amDo("levels", [["@AuCo",["b",true]]]);');
    has(colour, '__amDo("levels", [["autoBlackWhite",["b",true]],["autoNeutrals",["b",true]]]);');
    has(match, 'if (doc.mode !== DocumentMode.RGB) throw');
    has(match, '__amDo("matchColor", [["@Lght",["i",120]],["@ClrR",["i",80]],["@Fade",["i",25]],["neutralizeColor",["b",true]],["noReference",["b",true]]]);');
    has(replace, 'var rc = __color({"kind":"rgb","v":[51,102,204]}).lab, lab = new ActionDescriptor();');
    has(replace, `lab.putDouble(${cid('Lmnc')}, rc.L);`);
    has(replace, `d.putInteger(${cid('Fzns')}, 60);`);
    has(replace, `d.putObject(${cid('Mnm ')}, ${cid('LbCl')}, lab);`);
    has(replace, `d.putObject(${cid('Mxm ')}, ${cid('LbCl')}, lab);`);
    has(replace, `d.putInteger(${cid('H   ')}, 30);`);
    has(replace, `d.putInteger(${cid('Strt')}, -20);`);
    has(replace, `d.putInteger(${cid('Lght')}, 10);`);
    has(replace, 'app.executeAction(app.stringIDToTypeID("replaceColor"), d, DialogModes.NO)');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'replace_color' }), /needs options\.color/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'replace_color', options: { color: '#FF0000', fuzziness: 300 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'match_color', options: { luminance: 0 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'match_color', options: { neutralize: 'yes' } }), /true or false/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'auto_color_correction', options: { algorithm: 'brightness' } }), /Allowed/);

    const list = await features('adjust_layers');
    for (const id of ['auto_color_correction_options', 'auto_color_correction_options_option.snap_neutral_midtones', 'match_color_option.neutralize', 'replace_color_option.fuzziness']) {
        assert.ok(list.includes(`photoshop.adjustments.${id}`), id);
    }
});

test('Color and Vibrance, Clarity and Dehaze and Grain layers take their settings', async () => {
    const [vibrance, clarityDefault, clarity, grain, editGrain, editVibrance] = await scriptsFor([
        ['create_adjustment_layer', { type: 'color_and_vibrance', options: { temperature: -15, tint: 5, vibrance: 30, saturation: -10 } }],
        ['create_adjustment_layer', { type: 'clarity_and_dehaze' }],
        ['create_adjustment_layer', { type: 'clarity_and_dehaze', options: { clarity: 25, dehaze: 10 } }],
        ['create_adjustment_layer', { type: 'grain', options: { amount: 40, size: 30, roughness: 60 } }],
        ['edit_adjustment_layer', { target: { ids: [9] }, type: 'grain', options: { roughness: 70 } }],
        ['edit_adjustment_layer', { target: { ids: [9] }, type: 'color_and_vibrance', options: { tint: -8 } }],
    ]);
    has(vibrance, '["to",["o",["vibrance",[["temperature",["i",-15]],["tint",["i",5]],["vibrance",["i",30]],["@Strt",["i",-10]]]]]]');
    has(clarityDefault, '["type",["c","clarity"]]');
    lacks(clarityDefault, '__amDo("set"');
    has(clarity, '["type",["c","clarity"]]');
    has(clarity, '__amDo("set", [["null",["r",[["enum","adjustmentLayer","ordinal","targetEnum"]]]],["to",["o",["clarity",[["clarity",["i",25]],["dehaze",["i",10]]]]]]]);');
    has(grain, '["to",["o",["grainAdjustment",[["grainAmount",["i",40]],["grainSize",["i",30]],["grainRoughness",["i",60]]]]]]');
    has(editGrain, 'if (!__isAdjustment(l, "grainAdjustment")) throw');
    has(editGrain, 'list.getObjectType(0) === app.stringIDToTypeID(cls)');
    has(editGrain, '["to",["o",["grainAdjustment",[["grainRoughness",["i",70]]]]]]');
    has(editVibrance, 'l.kind !== LayerKind.VIBRANCE');
    has(editVibrance, '["to",["o",["vibrance",[["tint",["i",-8]]]]]]');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'grain', options: { amount: 150 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'clarity_and_dehaze', options: { texture: 5 } }), /has no option texture/);
    await assert.rejects(mcp.handleToolCall('edit_adjustment_layer', { target: { ids: [9] }, type: 'color_lookup', options: {} }), /Allowed/);

    for (const tool of ['create_adjustment_layer', 'edit_adjustment_layer']) {
        const list = await features(tool);
        for (const id of ['color_and_vibrance_layer', 'color_and_vibrance_layer_option.temperature', 'clarity_and_dehaze_layer_option.dehaze', 'grain_layer_option.roughness']) {
            assert.ok(list.includes(`photoshop.adjustments.${id}`), `${tool}: ${id}`);
        }
    }
});

test('Camera Raw Filter: Basic, Curve, Detail, Color Mixer, Color Grading, Optics and Effects', async () => {
    const [basic, asShot, curves, mixer, grading, optics] = await scriptsFor([
        ['apply_camera_raw_settings', { settings: { temperature: 10, saturation: -20, highlights: -30 } }],
        ['apply_camera_raw_settings', { whiteBalance: 'as_shot', settings: { contrast: 10 } }],
        ['apply_camera_raw_settings', { settings: { curveDarks: 15, curveMidtoneSplit: 40, refineSaturation: 80 }, pointCurve: { rgb: [[0, 0], [128, 150], [255, 255]], blue: [[0, 10], [255, 245]] } }],
        ['apply_camera_raw_settings', { hsl: { blue: { saturation: -30, luminance: 10 }, orange: { hue: 5 } } }],
        ['apply_camera_raw_settings', { colorGrading: { shadows: { hue: 200, saturation: 20, luminance: -5 }, highlights: { hue: 40 }, global: { saturation: 10 }, blending: 60, balance: -15 } }],
        ['apply_camera_raw_settings', { settings: { lensVignetteAmount: 20, defringePurpleAmount: 5, defringePurpleHueLow: 30, defringePurpleHueHigh: 70, luminanceDetail: 60, colorNoiseSmoothness: 40, vignetteRoundness: -20 } }],
    ]);
    has(basic, `d.putEnumerated(${cid('WBal')}, ${cid('WBal')}, ${cid('Cst ')});`);
    has(basic, `d.putInteger(${cid('Strt')}, -20);`);
    has(basic, 'app.executeAction(app.stringIDToTypeID("Adobe Camera Raw Filter"), d, DialogModes.NO)');
    has(asShot, `d.putEnumerated(${cid('WBal')}, ${cid('WBal')}, ${cid('AsSh')});`);
    lacks(asShot, cid('Cst '));
    has(curves, `d.putInteger(${cid('PC_D')}, 15);`);
    has(curves, `d.putInteger(${cid('PC_2')}, 40);`);
    has(curves, `d.putInteger(${cid('PC_1')}, 25);`);
    has(curves, `d.putInteger(${cid('PC_3')}, 75);`);
    has(curves, `d.putInteger(${cid('crfs')}, 80);`);
    has(curves, 'cl.putInteger(0); cl.putInteger(0); cl.putInteger(128); cl.putInteger(150); cl.putInteger(255); cl.putInteger(255);');
    has(curves, `d.putList(${cid('Crv ')}, cl);`);
    has(curves, `d.putList(${cid('CrvB')}, cl);`);
    has(mixer, `d.putInteger(${cid('SA_B')}, -30);`);
    has(mixer, `d.putInteger(${cid('LA_B')}, 10);`);
    has(mixer, `d.putInteger(${cid('HA_O')}, 5);`);
    for (const [k, v] of [['STSH', 200], ['STSS', 20], ['CgSL', -5], ['STHH', 40], ['CgGS', 10], ['CgBl', 60], ['STB ', -15]]) has(grading, `d.putInteger(${cid(k)}, ${v});`);
    for (const [k, v] of [['VigA', 20], ['DfPA', 5], ['DPHL', 30], ['DPHH', 70], ['LNRD', 60], ['CNRS', 40], ['PCVR', -20]]) has(optics, `d.putInteger(${cid(k)}, ${v});`);
});

test('Camera Raw Filter: Masking builds local corrections from document pixels', async () => {
    const [masked] = await scriptsFor([
        ['apply_camera_raw_settings', {
            localCorrections: [
                { mask: { type: 'linear', from: { x: 0, y: 0 }, to: { x: 0, y: 400 } }, exposure: 1, name: 'Sky & sea' },
                { mask: { type: 'radial', bounds: { x: 100, y: 50, width: 300, height: 200 }, feather: 80, inverted: true }, clarity: 20, amount: 50 },
                { mask: { type: 'luminance_range', min: 20, max: 80, softness: 10 }, shadows: 30 },
            ],
        }],
    ]);
    has(masked, 'var __xn = function (v)');
    has(masked, 'var w = __px(doc.width), h = __px(doc.height);');
    has(masked, `d.putString(${cid('LCs ')}, "<x:xmpmeta`);
    has(masked, 'crs:What=\\"Mask/Gradient\\"');
    has(masked, 'crs:FullY=\\"" + __xn(400 / h) + "\\"');
    has(masked, 'crs:LocalExposure2012=\\"0.25\\"');
    has(masked, 'crs:CorrectionName=\\"Sky &amp; sea\\"');
    has(masked, 'crs:What=\\"Mask/CircularGradient\\"');
    has(masked, 'crs:MaskInverted=\\"true\\"');
    has(masked, 'crs:Bottom=\\"" + __xn(250 / h) + "\\"');
    has(masked, 'crs:Right=\\"" + __xn(400 / w) + "\\"');
    has(masked, 'crs:Feather=\\"80\\"');
    has(masked, 'crs:CorrectionAmount=\\"0.5\\"');
    has(masked, 'crs:LocalClarity2012=\\"0.2\\"');
    has(masked, 'crs:LumRange=\\"0.100000 0.200000 0.800000 0.900000\\"');
    has(masked, 'crs:SampleType=\\"2\\"');
});

test('apply_camera_raw_settings refuses bad panel settings and claims the panels', async () => {
    const mcp = await server();
    const call = (args) => mcp.handleToolCall('apply_camera_raw_settings', args);
    await assert.rejects(call({}), /at least one/);
    await assert.rejects(call({ whiteBalance: 'as_shot', settings: { temperature: 5 } }), /as_shot takes no temperature/);
    await assert.rejects(call({ whiteBalance: 'daylight' }), /Allowed/);
    await assert.rejects(call({ settings: { curveShadowSplit: 60, curveMidtoneSplit: 50 } }), /splits must increase/);
    await assert.rejects(call({ settings: { defringeGreenHueLow: 60, defringeGreenHueHigh: 40 } }), /must be below/);
    await assert.rejects(call({ hsl: { teal: { hue: 5 } } }), /Allowed/);
    await assert.rejects(call({ hsl: { red: { hue: 150 } } }), /out of range/);
    await assert.rejects(call({ colorGrading: { shadows: { hue: 400 } } }), /out of range/);
    await assert.rejects(call({ pointCurve: { rgb: [[0, 0]] } }), /2 to 16/);
    await assert.rejects(call({ pointCurve: { rgb: [[128, 0], [64, 255]] } }), /inputs must increase/);
    await assert.rejects(call({ localCorrections: [] }), /1 to 20/);
    await assert.rejects(call({ localCorrections: [{ mask: { type: 'subject' } }] }), /Allowed/);
    await assert.rejects(call({ localCorrections: [{ mask: { type: 'linear', from: { x: 0, y: 0 } } }] }), /must be an object/);
    await assert.rejects(call({ localCorrections: [{ mask: { type: 'luminance_range', min: 80, max: 20 } }] }), /must not be above/);
    await assert.rejects(call({ localCorrections: [{ mask: { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, exposure: 9 }] }), /out of range/);
    await assert.rejects(call({ localCorrections: [{ mask: { type: 'radial', bounds: { x: 0, y: 0, width: 10, height: 10 }, softness: 5 } }] }), /has no softness/);

    const list = await features('apply_camera_raw_settings');
    for (const id of ['panel_basic', 'panel_curve', 'panel_detail', 'panel_color_mixer', 'panel_color_grading', 'panel_optics', 'panel_effects', 'panel_masking', 'panel_basic_option.as_shot', 'panel_basic_option.saturation', 'panel_curve_option.point_curve', 'panel_color_mixer_option.hsl', 'panel_color_grading_option.balance']) {
        assert.ok(list.includes(`photoshop.camera_raw.${id}`), id);
    }
});

test('Photo Restoration runs through the Neural Filters stack', async () => {
    const [restore] = await scriptsFor([['apply_neural_filter', { filter: 'photo_restoration', options: { scratches: 50, faceEnhance: 0 } }]]);
    has(restore, 'f.putString(__s("spl::id"), "internal.PhotoRestoration");');
    has(restore, 'v.putInteger(__s("spl::scratches"), 50);');
    has(restore, 'v.putInteger(__s("spl::faceEnhance"), 0);');
    has(restore, 'v.putInteger(__s("spl::enhance"), 100);');
    has(restore, 'app.executeAction(__s("neuralGalleryFilters"), d, DialogModes.NO);');
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_neural_filter', { filter: 'photo_restoration', options: { aperture: 5 } }), /Allowed: enhance/);
    await assert.rejects(mcp.handleToolCall('apply_neural_filter', { filter: 'photo_restoration', options: { scratches: 101 } }), /out of range/);
    assert.ok((await features('apply_neural_filter')).includes('photoshop.camera_raw.nf_photo_restoration'));
});
