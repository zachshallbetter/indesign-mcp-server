/**
 * Colour management: the project's colour settings (bit depth, working space,
 * gamma, linearisation, blending), display colour management and output
 * simulation in the Composition panel, the Lumetri Scopes panel, and colour
 * effects for grading, broadcast-safe output and simulated output in renders.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec, propertyValue } from '../args.js';

/** View > Simulate Output items and their command ids. */
const SIMULATE_OUTPUT = {
    none: 3705,
    hdtv_rec_709: 3754,
    sdtv_ntsc: 3755,
    sdtv_pal: 3756,
    legacy_macintosh_rgb: 3757,
    srgb: 3758,
    kodak_5218_to_kodak_2383: 3706,
    universal_camera_film_to_kodak_2383: 3814,
    my_custom_rgb: 3759,
};

const DISPLAY_ACTIONS = ['toggle_display_color_management', 'simulate_output', 'lumetri_scopes'];

/** Colour effects by friendly name, with their match names. */
const COLOR_EFFECTS = {
    lumetri_color: 'ADBE Lumetri',
    curves: 'ADBE CurvesCustom',
    levels: 'ADBE Easy Levels2',
    levels_individual: 'ADBE Pro Levels2',
    hue_saturation: 'ADBE HUE SATURATION',
    exposure: 'ADBE Exposure2',
    brightness_contrast: 'ADBE Brightness & Contrast 2',
    color_balance: 'ADBE Color Balance 2',
    color_balance_hls: 'ADBE Color Balance (HLS)',
    vibrance: 'ADBE Vibrance',
    selective_color: 'ADBE SelectiveColor',
    shadow_highlight: 'ADBE ShadowHighlight',
    photo_filter: 'ADBE PhotoFilterPS',
    channel_mixer: 'ADBE CHANNEL MIXER',
    gamma_pedestal_gain: 'ADBE Gamma/Pedestal/Gain2',
    tint: 'ADBE Tint',
    tritone: 'ADBE Tritone',
    black_white: 'ADBE Black&White',
    auto_color: 'ADBE AutoColor',
    auto_contrast: 'ADBE AutoContrast',
    auto_levels: 'ADBE AutoLevels',
    color_stabilizer: 'ADBE Deflicker',
    broadcast_colors: 'ADBE Broadcast Colors',
    color_profile_converter: 'ADBE ProfileToProfile',
    apply_color_lut: 'ADBE Apply Color LUT2',
    cineon_converter: 'ADBE Cineon Converter2',
};

/** Broadcast Colors popups, in menu order. */
const BROADCAST_LOCALE = ['ntsc', 'pal'];
const BROADCAST_METHOD = ['reduce_luminance', 'reduce_saturation', 'key_out_unsafe', 'key_out_safe'];

export const tools = [
    {
        name: 'get_color_management',
        description: 'Read the project\'s colour settings (File > Project Settings > Color): bit depth, working colour space, working gamma, Linearize Working Color Space, Blend Colors Using 1.0 Gamma and Compensate for Scene-referred Profiles, and optionally the ICC colour profiles that can be the working space',
        inputSchema: {
            type: 'object',
            properties: {
                listProfiles: { type: 'boolean', description: 'Also list the colour profiles available as working spaces' },
                query: { type: 'string', description: 'Only profiles whose description contains this text (case-insensitive)' },
            },
        },
        hints: { readOnly: true },
        auditArgs: { listProfiles: true, query: 'rec' },
        features: ['aftereffects.color.color_profile_files'],
        handler: (a) => run('Get colour management', script(`
var s = { bitsPerChannel: proj.bitsPerChannel, workingSpace: proj.workingSpace, workingGamma: proj.workingGamma, linearizeWorkingSpace: proj.linearizeWorkingSpace,
  linearBlending: proj.linearBlending, compensateForSceneReferredProfiles: proj.compensateForSceneReferredProfiles };
${a.listProfiles || a.query ? `var q = ${str(String(a.query ?? '').toLowerCase())}, all = proj.listColorProfiles(), profiles = [];
for (var i = 0; i < all.length; i++) if (!q || all[i].toLowerCase().indexOf(q) >= 0) profiles.push(all[i]);
s.profiles = profiles;` : ''}
__result__ = s;`)),
    },
    {
        name: 'set_color_management',
        description: 'Change the project\'s colour settings (File > Project Settings > Color): bit depth (8, 16 or 32 bpc, where 32 is high dynamic range float), working colour space (a profile from get_color_management, or "" for None), working gamma, Linearize Working Color Space, Blend Colors Using 1.0 Gamma and Compensate for Scene-referred Profiles',
        inputSchema: {
            type: 'object',
            properties: {
                bitsPerChannel: { type: 'integer', enum: [8, 16, 32], description: 'Bit depth: 8, 16 or 32 (floating point, high dynamic range)' },
                workingSpace: { type: 'string', description: 'Working colour space: a profile description from get_color_management listProfiles, or "" for None' },
                workingGamma: { type: 'number', enum: [2.2, 2.4], description: 'Working gamma when the working space is None' },
                linearizeWorkingSpace: { type: 'boolean', description: 'Linearize Working Color Space' },
                linearBlending: { type: 'boolean', description: 'Blend Colors Using 1.0 Gamma' },
                compensateForSceneReferredProfiles: { type: 'boolean', description: 'Compensate for Scene-referred Profiles' },
            },
        },
        hints: { idempotent: true },
        auditArgs: { workingSpace: 'HDTV (Rec. 709)', workingGamma: 2.4 },
        features: [
            'aftereffects.color.project_settings_color',
            'aftereffects.color.bit_depth',
            'aftereffects.color.color_depth_hdr',
            'aftereffects.color.working_color_space',
            'aftereffects.color.working_gamma',
            'aftereffects.color.linearize_working_space',
            'aftereffects.color.blend_colors_using_1_gamma',
            'aftereffects.color.compensate_for_scene_referred_profiles',
        ],
        handler: (a) => {
            const L = [];
            if (a.bitsPerChannel !== undefined) L.push(`proj.bitsPerChannel = ${enumOf(a.bitsPerChannel, ['8', '16', '32'], { name: 'bitsPerChannel' })};`);
            if (a.workingSpace !== undefined) {
                L.push(`var ws = ${str(a.workingSpace)};
if (ws) { var all = proj.listColorProfiles(), ok = false;
  for (var i = 0; i < all.length; i++) if (all[i] === ws) ok = true;
  if (!ok) throw new Error("No colour profile named " + ws + ": list them with get_color_management listProfiles"); }
proj.workingSpace = ws;`);
            }
            if (a.workingGamma !== undefined) L.push(`proj.workingGamma = ${enumOf(a.workingGamma, ['2.2', '2.4'], { name: 'workingGamma' })};`);
            for (const k of ['linearizeWorkingSpace', 'linearBlending', 'compensateForSceneReferredProfiles']) if (a[k] !== undefined) L.push(`proj.${k} = ${bool(a[k])};`);
            if (!L.length) throw new Error('Nothing to change: give bitsPerChannel, workingSpace, workingGamma, linearizeWorkingSpace, linearBlending or compensateForSceneReferredProfiles');
            return run('Set colour management', script(`${L.join('\n')}
__result__ = { bitsPerChannel: proj.bitsPerChannel, workingSpace: proj.workingSpace, workingGamma: proj.workingGamma, linearizeWorkingSpace: proj.linearizeWorkingSpace,
  linearBlending: proj.linearBlending, compensateForSceneReferredProfiles: proj.compensateForSceneReferredProfiles };`, { undo: 'Colour settings' }));
        },
    },
    {
        name: 'set_display_color',
        description: 'Display colour in the Composition panel (View menu): turn Use Display Color Management on or off (the command toggles it; scripts cannot read its state), choose a Simulate Output preset (display colour management must be on), or open the Lumetri Scopes panel. Applies to the composition opened in the viewer',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: DISPLAY_ACTIONS, description: 'toggle_display_color_management, simulate_output or lumetri_scopes' },
                output: { type: 'string', enum: Object.keys(SIMULATE_OUTPUT), description: 'simulate_output: the output to simulate (none turns simulation off)' },
                comp: { ...COMP_SCHEMA, description: 'Open this composition in the viewer first. Omit to use the active viewer' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'simulate_output', output: 'hdtv_rec_709', comp: { id: 3 } },
        features: [
            'aftereffects.color.use_display_color_management',
            'aftereffects.color.simulate_output',
            'aftereffects.color.simulate_output.no_output_simulation',
            'aftereffects.color.simulate_output.hdtv_rec_709',
            'aftereffects.color.simulate_output.sdtv_ntsc',
            'aftereffects.color.simulate_output.sdtv_pal',
            'aftereffects.color.simulate_output.legacy_macintosh_rgb_gamma_1_8',
            'aftereffects.color.simulate_output.internet_standard_rgb_srgb',
            'aftereffects.color.simulate_output.kodak_5218_to_kodak_2383',
            'aftereffects.color.simulate_output.universal_camera_film_to_kodak_2383',
            'aftereffects.color.simulate_output.my_custom_rgb',
            'aftereffects.color.lumetri_scopes_panel',
        ],
        handler: (a) => {
            const action = enumOf(a.action, DISPLAY_ACTIONS, { name: 'action' });
            if (action === 'simulate_output' && a.output === undefined) throw new Error("simulate_output needs 'output'");
            if (action !== 'simulate_output' && a.output !== undefined) throw new Error("'output' applies only to simulate_output");
            let id;
            if (action === 'toggle_display_color_management') id = '3704';
            else if (action === 'simulate_output') id = String(SIMULATE_OUTPUT[enumOf(a.output, Object.keys(SIMULATE_OUTPUT), { name: 'output' })]);
            else id = '(app.findMenuCommandId("Lumetri Scopes") || 10424)';
            return run('Display colour', script(`
${a.comp !== undefined ? `var c = __comp(${compSpec(a.comp)}); c.openInViewer();` : ''}
var id = ${id};
app.executeCommand(id);
__result__ = { action: ${str(action)}, command: id${a.output !== undefined ? `, output: ${str(a.output)}` : ''} };`));
        },
    },
    {
        name: 'apply_color_effect',
        description: 'Apply a colour effect (Effect > Color Correction or Utility) to layers, or to a new adjustment layer at the top of the composition so it affects everything below and final renders: Lumetri Color, Curves, Levels, Hue/Saturation, Exposure and other grading effects; Broadcast Colors to keep output broadcast-safe; Color Profile Converter to simulate an output type in renders. Set controls by display name with properties',
        inputSchema: {
            type: 'object',
            properties: {
                effect: { type: 'string', enum: Object.keys(COLOR_EFFECTS), description: 'The colour effect' },
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `Apply to these layers. ${LAYERS_SCHEMA.description}. Omit with adjustmentLayer: true` },
                adjustmentLayer: { type: 'boolean', description: 'Apply to a new adjustment layer spanning the composition, at the top' },
                layerName: { type: 'string', description: 'Name of the new adjustment layer. Default: the effect name' },
                broadcastLocale: { type: 'string', enum: BROADCAST_LOCALE, description: 'broadcast_colors: Broadcast Locale' },
                broadcastMethod: { type: 'string', enum: BROADCAST_METHOD, description: 'broadcast_colors: How To Make Color Safe' },
                maxSignalIre: { type: 'number', minimum: 90, maximum: 120, description: 'broadcast_colors: Maximum Signal Amplitude (IRE)' },
                properties: { type: 'object', description: 'Control display names to values (numbers, arrays, booleans; menus take their 1-based item number), e.g. { "Exposure": 0.5 }' },
            },
            required: ['effect'],
        },
        auditArgs: { effect: 'broadcast_colors', layers: undefined, adjustmentLayer: true, broadcastLocale: 'pal', broadcastMethod: 'reduce_saturation', maxSignalIre: 100, properties: { Luminance: 1 } },
        features: [
            'aftereffects.color.color_correction_workflow',
            'aftereffects.color.broadcast_safe_colors',
            'aftereffects.color.simulate_output_in_render',
        ],
        handler: (a) => {
            const key = enumOf(a.effect, Object.keys(COLOR_EFFECTS), { name: 'effect' });
            if (!!a.adjustmentLayer === (a.layers !== undefined)) throw new Error('Give layers, or adjustmentLayer: true (not both)');
            if (a.layerName !== undefined && !a.adjustmentLayer) throw new Error("'layerName' names the new adjustment layer; use it with adjustmentLayer: true");
            const broadcast = [
                ['Broadcast Locale', a.broadcastLocale === undefined ? undefined : BROADCAST_LOCALE.indexOf(enumOf(a.broadcastLocale, BROADCAST_LOCALE, { name: 'broadcastLocale' })) + 1],
                ['How To Make Color Safe', a.broadcastMethod === undefined ? undefined : BROADCAST_METHOD.indexOf(enumOf(a.broadcastMethod, BROADCAST_METHOD, { name: 'broadcastMethod' })) + 1],
                ['Maximum Signal Amplitude (IRE)', a.maxSignalIre === undefined ? undefined : Number(num(a.maxSignalIre, { name: 'maxSignalIre', min: 90, max: 120 }))],
            ].filter(([, v]) => v !== undefined);
            if (broadcast.length && key !== 'broadcast_colors') throw new Error('broadcastLocale, broadcastMethod and maxSignalIre apply only to broadcast_colors');
            if (a.properties !== undefined && (typeof a.properties !== 'object' || Array.isArray(a.properties))) throw new Error("'properties' maps control names to values");
            const props = [...broadcast, ...Object.entries(a.properties ?? {}).map(([k, v]) => [String(k), JSON.parse(propertyValue(v, `properties.${k}`))])];
            const target = a.adjustmentLayer
                ? `var adj = c.layers.addSolid([1, 1, 1], ${a.layerName !== undefined ? str(a.layerName) : 'fxName'}, c.width, c.height, c.pixelAspect, c.duration);
adj.adjustmentLayer = true;
var ls = [adj];`
                : `var ls = __layers(c, ${layerSpec(a.layers)});`;
            return run('Apply colour effect', script(`
var c = __comp(${compSpec(a.comp)}), match = ${str(COLOR_EFFECTS[key])}, props = ${json(props)}, out = [], fxName = match;
for (var e = 0; e < app.effects.length; e++) if (app.effects[e].matchName === match) fxName = app.effects[e].displayName;
${target}
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade");
  if (!parade.canAddProperty(match)) throw new Error("Cannot add " + fxName + " to layer " + ls[i].name);
  var fx = parade.addProperty(match);
  for (var k = 0; k < props.length; k++) {
    var p = fx.property(props[k][0]);
    if (!p) throw new Error(fx.name + " has no control " + props[k][0]);
    p.setValue(props[k][1]);
  }
  out.push({ layer: ls[i].index, layerName: ls[i].name, effect: fx.name, matchName: fx.matchName, index: fx.propertyIndex });
}
__result__ = { applied: out, adjustmentLayer: ${bool(a.adjustmentLayer)} };`, { undo: 'Apply colour effect' }));
        },
    },
];
