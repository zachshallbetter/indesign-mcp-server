/**
 * Colour: the foreground and background colours, colour values in every model
 * (the Color Picker and Color panel), sampling pixels (Eyedropper and Color
 * Sampler tools), patterns, profiles, colour settings and proofing.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, RECT_SCHEMA, colorSpec, rect } from '../args.js';
import { AM_HELPERS, amCall, t } from '../am.js';

/** ES3: every model's values for SolidColor `c`, plus its nearest web-safe colour. */
const DESCRIBE = String.raw`
var __describe = function (c) {
  var web = c.nearestWebColor;
  var out = { hex: "#" + c.rgb.hexValue, rgb: [c.rgb.red, c.rgb.green, c.rgb.blue],
    hsb: [c.hsb.hue, c.hsb.saturation, c.hsb.brightness], lab: [c.lab.L, c.lab.A, c.lab.B],
    cmyk: [c.cmyk.cyan, c.cmyk.magenta, c.cmyk.yellow, c.cmyk.black], gray: c.gray.gray,
    nearestWebColor: "#" + web.hexValue };
  out.webSafe = web.hexValue === c.rgb.hexValue;
  return out;
};`;

const SET_AS = ['foreground', 'background'];

/** Proof Setup presets and their builtinProof values. */
const PROOFS = {
    working_cmyk: 'proofCMYK', working_cyan_plate: 'proofCyan', working_magenta_plate: 'proofMagenta', working_yellow_plate: 'proofYellow',
    working_black_plate: 'proofBlack', working_cmy_plates: 'proofCMY', legacy_macintosh_rgb: 'proofMacintosh', internet_standard_rgb: 'proofWindows',
    monitor_rgb: 'proofMonitor', protanopia: 'proofProtanopia', deuteranopia: 'proofDeuteranopia',
};

export const tools = [
    {
        name: 'swap_colors',
        description: 'Switch the foreground and background colours (Switch Foreground and Background Colors, X), or with reset: true return them to black and white (Default Foreground and Background Colors, D)',
        inputSchema: { type: 'object', properties: { reset: { type: 'boolean', description: 'Reset to black foreground and white background instead of switching. Default false' } } },
        features: ['photoshop.color.switch_colors', 'photoshop.color.default_colors'],
        handler: (a) => run('Swap colours', script(`${a.reset ? `
var k = new SolidColor(); k.rgb.hexValue = "000000";
var w = new SolidColor(); w.rgb.hexValue = "FFFFFF";
app.foregroundColor = k;
app.backgroundColor = w;` : `
var f = app.foregroundColor, b = app.backgroundColor;
app.foregroundColor = b;
app.backgroundColor = f;`}
__result__ = { foreground: __colorInfo(app.foregroundColor), background: __colorInfo(app.backgroundColor) };`, { needsDocument: false })),
    },
    {
        name: 'pick_color',
        description: 'Work with a colour the way the Color Picker and Color panel do: give a colour in any model (or read the current foreground or background colour) and get its HSB, RGB, Lab, CMYK, grayscale and hex values, whether it is web-safe and the nearest web-safe colour (Only Web Colors); optionally snap it to web-safe and make it the foreground or background colour',
        inputSchema: {
            type: 'object',
            properties: {
                color: { ...COLOR_SCHEMA, description: `The colour. ${COLOR_SCHEMA.description}` },
                from: { type: 'string', enum: SET_AS, description: 'Use the current foreground or background colour instead of color' },
                webSafe: { type: 'boolean', description: 'Snap to the nearest web-safe colour (Only Web Colors)' },
                setAs: { type: 'string', enum: SET_AS, description: 'Make the result the foreground or background colour' },
            },
        },
        auditArgs: { color: 'hsb(200,60,80)', from: undefined },
        hints: { idempotent: true },
        features: [
            'photoshop.color.solid_color', 'photoshop.color.adobe_color_picker', 'photoshop.color.adobe_color_picker_option.hsb', 'photoshop.color.adobe_color_picker_option.rgb',
            'photoshop.color.adobe_color_picker_option.lab', 'photoshop.color.adobe_color_picker_option.cmyk', 'photoshop.color.adobe_color_picker_option.hex',
            'photoshop.color.adobe_color_picker_option.only_web_colors', 'photoshop.color.adobe_color_picker_option.warning_not_a_web_safe_color', 'photoshop.color.color_panel',
        ],
        handler: (a) => {
            if ((a.color === undefined) === (a.from === undefined)) throw new Error('Give color or from');
            const source = a.color !== undefined ? `__color(${colorSpec(a.color, 'color')})` : `app.${enumOf(a.from, SET_AS, { name: 'from' })}Color`;
            const setAs = a.setAs !== undefined ? enumOf(a.setAs, SET_AS, { name: 'setAs' }) : null;
            return run('Pick colour', script(`${DESCRIBE}
var c = ${source};
var original = __describe(c);
${a.webSafe ? 'var snapped = new SolidColor(); snapped.rgb.hexValue = c.nearestWebColor.hexValue; c = snapped;' : ''}
${setAs ? `app.${setAs}Color = c;` : ''}
__result__ = { color: __describe(c), original: original, setAs: ${json(setAs)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'sample_color',
        description: 'Read pixel colours of the composite image at points (Color Sampler tool and Info panel), optionally making the first the foreground or background colour (Eyedropper tool) and keeping the samplers in the document',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }, description: 'Pixel positions from the document\'s top-left' },
                setAs: { type: 'string', enum: SET_AS, description: 'Make the first sampled colour the foreground or background colour (Eyedropper)' },
                keep: { type: 'boolean', description: 'Leave colour samplers at the points. Default false' },
                clear: { type: 'boolean', description: 'Remove the document\'s existing colour samplers first. Default false' },
            },
            required: ['points'],
        },
        auditArgs: { points: [{ x: 10, y: 20 }] },
        features: ['photoshop.color.eyedropper_tool', 'photoshop.color.color_sampler_tool'],
        handler: (a) => {
            if (!Array.isArray(a.points) || !a.points.length || a.points.length > 10) throw new Error("'points' takes 1 to 10 { x, y } positions");
            const pts = a.points.map((p, i) => [Number(num(p?.x, { min: 0, max: 300000, name: `points[${i}].x` })), Number(num(p?.y, { min: 0, max: 300000, name: `points[${i}].y` }))]);
            const setAs = a.setAs !== undefined ? enumOf(a.setAs, SET_AS, { name: 'setAs' }) : null;
            return run('Sample colour', script(`${DESCRIBE}
${a.clear ? 'while (doc.colorSamplers.length) doc.colorSamplers[0].remove();' : ''}
var pts = ${json(pts)}, out = [];
for (var i = 0; i < pts.length; i++) {
  var s = doc.colorSamplers.add([new UnitValue(pts[i][0], "px"), new UnitValue(pts[i][1], "px")]);
  var c = s.color, info = __describe(c);
  info.x = pts[i][0]; info.y = pts[i][1];
  out.push(info);
  if (i === 0 && ${bool(setAs)}) app.${setAs ?? 'foreground'}Color = c;
  if (!${bool(a.keep)}) s.remove();
}
__result__ = { samples: out, setAs: ${json(setAs)}, samplers: doc.colorSamplers.length };`));
        },
    },
    {
        name: 'define_pattern',
        description: 'Save the selection, an area or the whole image as a pattern (Edit > Define Pattern), for pattern fill layers and fills. The area must be a plain rectangle; without one, the selection is used, or the whole image when nothing is selected',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Pattern name' },
                bounds: { ...RECT_SCHEMA, description: 'Rectangle to use, in pixels; selected first and deselected afterwards' },
            },
            required: ['name'],
        },
        features: ['photoshop.color.define_pattern'],
        handler: (a) => {
            if (typeof a.name !== 'string' || !a.name.trim()) throw new Error("'name' must be a non-empty string");
            const b = a.bounds !== undefined ? rect(a.bounds, 'bounds') : null;
            const make = amCall('make', [
                ['null', t.ref([['class', 'pattern']])],
                ['using', t.ref([['prop', 'property', 'selection'], ['enum', 'document', 'ordinal', 'targetEnum']])],
                ['name', t.str(a.name)],
            ]);
            return run('Define pattern', script(`${AM_HELPERS}
${b ? `doc.selection.select(${json([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]])});` : ''}
${make};
${b ? 'doc.selection.deselect();' : ''}
__result__ = { pattern: ${str(a.name)} };`));
        },
    },
    {
        name: 'assign_profile',
        description: 'Assign a colour profile to the active document without converting its colour values (Edit > Assign Profile): a profile name, the working space, or none (Don\'t Color Manage). Use convert_profile to keep the appearance instead',
        inputSchema: {
            type: 'object',
            properties: { profile: { type: 'string', description: 'Profile name, e.g. "Adobe RGB (1998)", or "working" for the working space, or "none"' } },
            required: ['profile'],
        },
        hints: { idempotent: true },
        features: ['photoshop.color_management.assign_profile'],
        handler: (a) => {
            if (typeof a.profile !== 'string' || !a.profile.trim()) throw new Error("'profile' must be a profile name, \"working\" or \"none\"");
            const p = a.profile.trim();
            const line = p === 'working' ? 'doc.colorProfileType = ColorProfileType.WORKING;'
                : p === 'none' ? 'doc.colorProfileType = ColorProfileType.NONE;'
                    : `doc.colorProfileName = ${str(p)};`;
            return run('Assign profile', script(`${line}
__result__ = __docInfo(doc);`));
        },
    },
    {
        name: 'set_color_preferences',
        description: 'Choose the colour settings file (Edit > Color Settings, e.g. "North America General Purpose 2"), Dynamic Color Sliders (Color panel) and the Gamut Warning opacity (Preferences > Transparency & Gamut); returns the current values. With no arguments it only reads them',
        inputSchema: {
            type: 'object',
            properties: {
                settings: { type: 'string', description: 'Name of a colour settings file (as in the Color Settings Settings menu)' },
                dynamicColorSliders: { type: 'boolean', description: 'Dynamic Color Sliders' },
                gamutWarningOpacity: { type: 'number', minimum: 0, maximum: 100, description: 'Gamut Warning opacity, percent' },
            },
        },
        hints: { idempotent: true },
        features: ['photoshop.color_management.color_settings', 'photoshop.color_management.color_settings_presets', 'photoshop.color.color_panel_option.dynamic_color_sliders', 'photoshop.color_management.gamut_warning_color'],
        handler: (a) => {
            const lines = [];
            if (a.settings !== undefined) {
                if (typeof a.settings !== 'string' || !a.settings.trim()) throw new Error("'settings' must be a colour settings name");
                lines.push(`app.colorSettings = ${str(a.settings)};`);
            }
            if (a.dynamicColorSliders !== undefined) lines.push(`app.preferences.dynamicColorSliders = ${bool(a.dynamicColorSliders)};`);
            if (a.gamutWarningOpacity !== undefined) lines.push(`app.preferences.gamutWarningOpacity = ${num(a.gamutWarningOpacity, { min: 0, max: 100, name: 'gamutWarningOpacity' })};`);
            return run('Colour preferences', script(`${lines.join('\n')}
var cs = null;
try { cs = String(app.colorSettings); } catch (e) {}
__result__ = { settings: cs, dynamicColorSliders: app.preferences.dynamicColorSliders, gamutWarningOpacity: app.preferences.gamutWarningOpacity };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_proof_view',
        description: 'Soft-proof the active document: choose a Proof Setup preset (View > Proof Setup: working CMYK or one plate, legacy Mac RGB, sRGB, monitor RGB, colour-blindness types), and toggle View > Proof Colors and View > Gamut Warning. The toggles switch the current state, which scripts cannot read',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', enum: Object.keys(PROOFS), description: 'Proof Setup preset' },
                toggleProofColors: { type: 'boolean', description: 'Toggle Proof Colors' },
                toggleGamutWarning: { type: 'boolean', description: 'Toggle Gamut Warning' },
            },
        },
        features: [
            'photoshop.color_management.proof_setup', 'photoshop.color_management.proof_working_cmyk', 'photoshop.color_management.proof_cyan_plate', 'photoshop.color_management.proof_magenta_plate',
            'photoshop.color_management.proof_yellow_plate', 'photoshop.color_management.proof_black_plate', 'photoshop.color_management.proof_cmy_plates', 'photoshop.color_management.proof_legacy_mac_rgb',
            'photoshop.color_management.proof_srgb', 'photoshop.color_management.proof_monitor_rgb', 'photoshop.color_management.proof_protanopia', 'photoshop.color_management.proof_deuteranopia',
            'photoshop.color_management.proof_colors', 'photoshop.color_management.gamut_warning',
        ],
        handler: (a) => {
            const lines = [];
            if (a.preset !== undefined) lines.push(`${amCall('proofSetup', [['@Bltn', t.enm('builtinProof', PROOFS[enumOf(a.preset, Object.keys(PROOFS), { name: 'preset' })])]])};`);
            if (a.toggleProofColors) lines.push('app.runMenuItem(app.stringIDToTypeID("toggleProofColors"));');
            if (a.toggleGamutWarning) lines.push('app.runMenuItem(app.charIDToTypeID("TglG"));');
            if (!lines.length) throw new Error('Give preset, toggleProofColors or toggleGamutWarning');
            return run('Proof view', script(`${AM_HELPERS}
${lines.join('\n')}
__result__ = { preset: ${json(a.preset ?? null)}, toggledProofColors: ${bool(a.toggleProofColors)}, toggledGamutWarning: ${bool(a.toggleGamutWarning)} };`));
        },
    },
];
