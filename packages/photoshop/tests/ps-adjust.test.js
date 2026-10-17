import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { TYPES, FILL_TYPES } from '../src/adjustment-types.js';

test('Action Manager adjustments run on each pixel layer with their own events', async () => {
    const [exposure, hue, levels, legacy, curves, auto, mixer, mono, selective, map, filter, sh] = await scriptsFor([
        ['adjust_layers', { adjustment: 'exposure', options: { exposure: 1.5, gamma: 0.8 } }],
        ['adjust_layers', { adjustment: 'hue_saturation', options: { hue: 20, ranges: { reds: { saturation: -30 } } } }],
        ['adjust_layers', { adjustment: 'levels', options: { channel: 'red', gamma: 1.2 } }],
        ['adjust_layers', { adjustment: 'brightness_contrast', options: { brightness: 20, useLegacy: true } }],
        ['adjust_layers', { adjustment: 'curves', options: { channel: 'blue', points: [[0, 0], [128, 100], [255, 255]] } }],
        ['adjust_layers', { adjustment: 'auto_color' }],
        ['adjust_layers', { adjustment: 'channel_mixer', options: { red: [80, 20, 0, 0] } }],
        ['adjust_layers', { adjustment: 'channel_mixer', options: { monochrome: true } }],
        ['adjust_layers', { adjustment: 'selective_color', options: { method: 'absolute', reds: [10, 0, -5, 0] } }],
        ['adjust_layers', { adjustment: 'gradient_map', options: { reverse: true, method: 'linear', gradient: { colors: [{ color: '#112233', location: 0 }, { color: 'lab(90,0,0)', location: 100, midpoint: 40 }] } } }],
        ['adjust_layers', { adjustment: 'photo_filter', options: { filter: 'cooling_80', density: 40 } }],
        ['adjust_layers', { adjustment: 'shadows_highlights', options: { blackClip: 0.5 } }],
    ]);
    assert.match(exposure, /var __amDo = function/);
    assert.match(exposure, /doc\.activeLayer = l; __amDo\("exposure", \[\["presetKind",\["e",\["presetKindType","presetKindCustom"\]\]\],\["@Exps",\["d",1\.5\]\],\["@Ofst",\["d",0\]\],\["gammaCorrection",\["d",0\.8\]\]\]\)/);
    assert.match(hue, /\["@LclR",\["i",1\]\],\["@BgnR",\["i",315\]\]/);
    assert.match(levels, /__amDo\("levels", .*\["@Chnl",\["r",\[\["enum","@Chnl","@Chnl","@Rd  "\]\]\]\],\["@Inpt"/);
    assert.match(legacy, /__amDo\("brightnessEvent", \[\["@Brgh",\["i",20\]\],\["@Cntr",\["i",0\]\],\["useLegacy",\["b",true\]\]\]\)/);
    assert.match(curves, /\["@Crv ",\["l",\[\["o",\["@CrPt",\[\["@Hrzn",\["d",0\]\],\["@Vrtc",\["d",0\]\]\]\]\]/);
    assert.match(auto, /__amDo\("levels", \[\["autoBlackWhite",\["b",true\]\],\["autoNeutrals",\["b",true\]\]\]\)/);
    assert.match(mixer, /l\.mixChannels\(\[\[80,20,0,0\],\[0,100,0,0\],\[0,0,100,0\]\], false\)/);
    assert.match(mono, /l\.mixChannels\(\[\[40,40,20,0\]\], true\)/);
    assert.match(selective, /l\.selectiveColor\(AdjustmentReference\.ABSOLUTE, \[10,0,-5,0\], \[0,0,0,0\]/);
    assert.match(map, /__amDo\("gradientMapEvent", .*\["@Lctn",\["i",4096\]\],\["@Mdpn",\["i",40\]\].*\["@Rvrs",\["b",true\]\].*\["gradientsInterpolationMethod",\["e",\["gradientInterpolationMethodType","@Lnr "\]\]\]/);
    assert.match(map, /\["@LbCl",\[\["@Lmnc",\["d",90\]\]/);
    assert.match(filter, /l\.photoFilter\(__color\(\{"kind":"rgb","v":\[0,109,255\]\}\), 40, true\)/);
    assert.match(sh, /l\.shadowHighlight\(35, 50, 30, 0, 50, 30, 20, 0, 0\.5, 0\.01\)/);
});

test('existing adjustments keep their object-model calls', async () => {
    const [levels, curves, bc, pf] = await scriptsFor([
        ['adjust_layers', { adjustment: 'levels', options: { gamma: 1.2 } }],
        ['adjust_layers', { adjustment: 'curves', options: { points: [[0, 0], [255, 255]] } }],
        ['adjust_layers', { adjustment: 'brightness_contrast', options: { brightness: 10 } }],
        ['adjust_layers', { adjustment: 'photo_filter' }],
    ]);
    assert.match(levels, /l\.adjustLevels\(0, 255, 1\.2, 0, 255\);/);
    assert.doesNotMatch(levels, /__amDo/);
    assert.match(curves, /l\.adjustCurves\(\[\[0,0\],\[255,255\]\]\);/);
    assert.match(bc, /l\.adjustBrightnessContrast\(10, 0\);/);
    assert.match(pf, /l\.photoFilter\(__color\(\{"kind":"rgb","v":\[236,138,0\]\}\), 25, true\);/);
});

test('every adjustment layer and fill layer type can be created with its defaults', async () => {
    const calls = [
        ...Object.keys(TYPES).map((type) => ['create_adjustment_layer', { type }]),
        ...Object.keys(FILL_TYPES).map((type) => ['create_fill_layer', { type, options: type === 'solid_color' ? { color: '#FF0000' } : type === 'pattern' ? { pattern: 'Bubbles' } : {} }]),
    ];
    const sent = await scriptsFor(calls);
    assert.equal(sent.length, calls.length);
    for (const s of sent) assert.match(s, /__amDo\("make", \[\["null",\["r",\[\["class","(adjustmentLayer|contentLayer)"\]\]\]\],\["using"/);
    const byType = Object.fromEntries(calls.map(([, a], i) => [a.type, sent[i]]));
    assert.match(byType.invert, /\["type",\["c","@Invr"\]\]/);
    assert.doesNotMatch(byType.invert, /__amDo\("set"/);
    assert.match(byType.grain, /\["type",\["c","grainAdjustment"\]\]/);
    assert.match(byType.levels, /__amDo\("set", \[\["null",\["r",\[\["enum","adjustmentLayer","ordinal","targetEnum"\]\]\]\],\["to",\["o",\["@Lvls"/);
    assert.match(byType.solid_color, /\["solidColorLayer",\[\["@Clr ",\["o",\["@RGBC",\[\["@Rd  ",\["d",255\]\]/);
    assert.match(byType.pattern, /\["@Ptrn",\["o",\["@Ptrn",\[\["@Nm  ",\["s","Bubbles"\]\]\]\]\]\]/);
    assert.match(byType.gradient, /\["@GrdF",\["e",\["@GrdF","@CstS"\]\]\]/);
});

test('adjustment layers take placement, clipping and layer options', async () => {
    const [made, edited, fill] = await scriptsFor([
        ['create_adjustment_layer', { type: 'vibrance', options: { vibrance: 30 }, above: { ids: [5] }, clip: true, name: 'Pop', opacity: 50, blendMode: 'luminosity' }],
        ['edit_adjustment_layer', { target: { ids: [9] }, type: 'hue_saturation', options: { colorize: true } }],
        ['edit_fill_layer', { target: { names: ['Sky'] }, type: 'gradient', options: { gradient: { type: 'noise', roughness: 80, colorModel: 'lab', restrictColors: true, seed: 42 } } }],
    ]);
    assert.match(made, /doc\.activeLayer = __targets\(doc, \{"ids":\[5\]\}\)\[0\];/);
    assert.match(made, /if \(l\.grouped !== true\) l\.grouped = true;/);
    assert.match(made, /l\.name = "Pop";\nl\.opacity = 50;\nl\.blendMode = BlendMode\.LUMINOSITY;/);
    assert.match(edited, /l\.kind !== LayerKind\.HUESATURATION/);
    assert.match(edited, /\["to",\["o",\["@HStr",\[\["presetKind",\["e",\["presetKindType","presetKindCustom"\]\]\],\["@Clrz",\["b",true\]\]\]\]\]\]/);
    assert.doesNotMatch(edited, /@Adjs/);
    assert.match(fill, /l\.kind !== LayerKind\.GRADIENTFILL/);
    assert.match(fill, /\["@ClrS",\["e",\["@ClrS","@LbCl"\]\]\],\["@RndS",\["i",42\]\],\["@Smth",\["i",3277\]\]/);
    assert.match(fill, /\["@VctC",\["b",true\]\]/);
    assert.doesNotMatch(fill, /@Angl/);
});

test('adjustment and fill layer arguments are checked', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'sepia' }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'exposure', options: { exposure: 30 } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'levels', options: { brightness: 3 } }), /has no option brightness/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'levels', options: { inputBlack: 200, inputWhite: 100 } }), /below inputWhite/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'hue_saturation', options: { colorize: true, hue: -20 } }), /With colorize/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'hue_saturation', options: { ranges: { purples: {} } } }), /no range purples/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'channel_mixer', options: { red: [1, 2, 3] } }), /takes 4 numbers/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'gradient_map', options: { gradient: { colors: [{ color: '#000000', location: 0 }] } } }), /2 to 32 stops/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'gradient_map', options: { gradient: { roughness: 20 } } }), /for noise gradients/);
    await assert.rejects(mcp.handleToolCall('create_adjustment_layer', { type: 'black_and_white', options: { tint: 'yes' } }), /true or false/);
    await assert.rejects(mcp.handleToolCall('create_fill_layer', { type: 'solid_color' }), /needs options\.color/);
    await assert.rejects(mcp.handleToolCall('create_fill_layer', { type: 'pattern' }), /needs options\.pattern/);
    await assert.rejects(mcp.handleToolCall('create_fill_layer', { type: 'solid_color', options: { color: 'red' } }), /not a colour/);
    await assert.rejects(mcp.handleToolCall('edit_adjustment_layer', { target: { ids: [3] }, type: 'invert' }), /Allowed/);
    await assert.rejects(mcp.handleToolCall('edit_adjustment_layer', { target: { ids: [3] }, type: 'levels' }), /Give options/);
    await assert.rejects(mcp.handleToolCall('edit_fill_layer', { target: { ids: [3] }, type: 'pattern', options: { patternId: 'abc' } }), /Give options\.pattern/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'selective_color', options: { reds: [200, 0, 0, 0] } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('adjust_layers', { adjustment: 'photo_filter', options: { filter: 'pink' } }), /Allowed/);
});

test('colour tools: swap, pick, sample, pattern, profile, settings and proofing', async () => {
    const [swap, reset, pick, from, sample, pattern, profile, working, prefs, proof] = await scriptsFor([
        ['swap_colors', {}],
        ['swap_colors', { reset: true }],
        ['pick_color', { color: 'cmyk(0,50,100,0)', webSafe: true, setAs: 'foreground' }],
        ['pick_color', { from: 'background' }],
        ['sample_color', { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], setAs: 'background', keep: true, clear: true }],
        ['define_pattern', { name: 'Dots', bounds: { x: 0, y: 0, width: 16, height: 16 } }],
        ['assign_profile', { profile: 'Adobe RGB (1998)' }],
        ['assign_profile', { profile: 'working' }],
        ['set_color_preferences', { settings: 'Europe General Purpose 3', dynamicColorSliders: false, gamutWarningOpacity: 60 }],
        ['set_proof_view', { preset: 'deuteranopia', toggleProofColors: true, toggleGamutWarning: true }],
    ]);
    assert.match(swap, /app\.foregroundColor = b;\napp\.backgroundColor = f;/);
    assert.match(reset, /k\.rgb\.hexValue = "000000";/);
    assert.match(pick, /var c = __color\(\{"kind":"cmyk","v":\[0,50,100,0\]\}\);/);
    assert.match(pick, /snapped\.rgb\.hexValue = c\.nearestWebColor\.hexValue;/);
    assert.match(pick, /app\.foregroundColor = c;/);
    assert.match(from, /var c = app\.backgroundColor;/);
    assert.match(sample, /while \(doc\.colorSamplers\.length\) doc\.colorSamplers\[0\]\.remove\(\);/);
    assert.match(sample, /var pts = \[\[10,20\],\[30,40\]\]/);
    assert.match(sample, /app\.backgroundColor = c;/);
    assert.match(sample, /if \(!true\) s\.remove\(\);/);
    assert.match(pattern, /doc\.selection\.select\(\[\[0,0\],\[16,0\],\[16,16\],\[0,16\]\]\);/);
    assert.match(pattern, /__amDo\("make", \[\["null",\["r",\[\["class","pattern"\]\]\]\],\["using",\["r",\[\["prop","property","selection"\],\["enum","document","ordinal","targetEnum"\]\]\]\],\["name",\["s","Dots"\]\]\]\)/);
    assert.match(profile, /doc\.colorProfileName = "Adobe RGB \(1998\)";/);
    assert.match(working, /doc\.colorProfileType = ColorProfileType\.WORKING;/);
    assert.match(prefs, /app\.colorSettings = "Europe General Purpose 3";\napp\.preferences\.dynamicColorSliders = false;\napp\.preferences\.gamutWarningOpacity = 60;/);
    assert.match(proof, /__amDo\("proofSetup", \[\["@Bltn",\["e",\["builtinProof","proofDeuteranopia"\]\]\]\]\)/);
    assert.match(proof, /app\.runMenuItem\(app\.stringIDToTypeID\("toggleProofColors"\)\);\napp\.runMenuItem\(app\.charIDToTypeID\("TglG"\)\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('pick_color', {}), /Give color or from/);
    await assert.rejects(mcp.handleToolCall('pick_color', { color: '#FFFFFF', from: 'foreground' }), /Give color or from/);
    await assert.rejects(mcp.handleToolCall('sample_color', { points: [] }), /1 to 10/);
    await assert.rejects(mcp.handleToolCall('sample_color', { points: [{ x: -1, y: 0 }] }), /out of range/);
    await assert.rejects(mcp.handleToolCall('define_pattern', { name: ' ' }), /non-empty/);
    await assert.rejects(mcp.handleToolCall('assign_profile', { profile: '' }), /profile name/);
    await assert.rejects(mcp.handleToolCall('set_color_preferences', { gamutWarningOpacity: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_proof_view', {}), /Give preset/);
    await assert.rejects(mcp.handleToolCall('set_proof_view', { preset: 'cmyk' }), /Allowed/);
});
