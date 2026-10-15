/**
 * Effects and transparency tools: the object-model statements their scripts
 * carry, and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];

await test('set_item_effects writes blending and effects to the chosen target', async () => {
    const s = await one('set_item_effects', {
        target: T, on: 'stroke',
        transparency: { opacity: 60, blendMode: 'MULTIPLY' },
        dropShadow: { effectColor: '#ff0000', distance: 2, angle: 135, useGlobalLight: false },
        basicFeather: { width: 3, cornerType: 'ROUNDED' },
        innerGlow: { enabled: false },
    });
    assert.match(s, /var s = it\.strokeTransparencySettings;/);
    assert.match(s, /s\.blendingSettings\.opacity = 60;/);
    assert.match(s, /s\.blendingSettings\.blendMode = BlendMode\.MULTIPLY;/);
    assert.match(s, /s\.dropShadowSettings\.mode = ShadowMode\.DROP;/);
    assert.match(s, /__swatch\(doc, \{"kind":"rgb","v":\[255,0,0\]\}\)/);
    assert.match(s, /s\.dropShadowSettings\.effectColor = __c0;/);
    assert.ok(s.indexOf('useGlobalLight = false') < s.indexOf('dropShadowSettings.angle = 135'), 'global light is set before the angle');
    assert.match(s, /s\.featherSettings\.mode = FeatherMode\.STANDARD;/);
    assert.match(s, /s\.featherSettings\.cornerType = FeatherCornerType\.ROUNDED;/);
    assert.match(s, /s\.innerGlowSettings\.applied = false;/);
});

await test('set_item_effects covers every effect and the content target', async () => {
    const s = await one('set_item_effects', {
        target: T, on: 'content',
        innerShadow: { chokeAmount: 20 }, outerGlow: { technique: 'PRECISE' },
        bevelAndEmboss: { style: 'PILLOW_EMBOSS', highlightColor: 'Paper', shadowOpacity: 40, altitude: 30 },
        satin: { invertEffect: true }, directionalFeather: { topWidth: 4, followShapeMode: 'ALL_EDGES' },
        gradientFeather: { type: 'RADIAL', gradientStart: [10, 20], stops: [{ location: 0, opacity: 100 }, { location: 50, opacity: 40, midpoint: 30 }, { location: 100, opacity: 0 }] },
    });
    assert.match(s, /var s = it\.contentTransparencySettings;/);
    assert.match(s, /s\.innerShadowSettings\.chokeAmount = 20;/);
    assert.match(s, /s\.outerGlowSettings\.technique = GlowTechnique\.PRECISE;/);
    assert.match(s, /s\.bevelAndEmbossSettings\.style = BevelAndEmbossStyle\.PILLOW_EMBOSS;/);
    assert.match(s, /s\.bevelAndEmbossSettings\.altitude = 30;/);
    assert.match(s, /s\.satinSettings\.invertEffect = true;/);
    assert.match(s, /s\.directionalFeatherSettings\.followShapeMode = FollowShapeModeOptions\.ALL_EDGES;/);
    assert.match(s, /s\.gradientFeatherSettings\.type = GradientType\.RADIAL;/);
    assert.match(s, /gradientStart = pg \? __toPage\(pg, 10, 20\) : \[10, 20\];/);
    assert.match(s, /while \(gs\.length < 3\) gs\.add\(\);/);
    assert.match(s, /gs\.item\(1\)\.midpoint = 30;/);
});

await test('set_item_effects refuses bad arguments', () => {
    const set = tool('set_item_effects').handler;
    assert.throws(() => set({ target: T }), /Nothing to set/);
    assert.throws(() => set({ target: {}, dropShadow: { enabled: true } }), /Choose the items/);
    assert.throws(() => set({ target: T, on: 'text', dropShadow: { enabled: true } }), /Allowed: object, stroke, fill, content/);
    assert.throws(() => set({ target: T, on: 'fill', transparency: { knockoutGroup: true } }), /applies only to the object/);
    assert.throws(() => set({ target: T, dropShadow: { blur: 3 } }), /Unknown option 'dropShadow\.blur'/);
    assert.throws(() => set({ target: T, dropShadow: { opacity: 120 } }), /out of range/);
    assert.throws(() => set({ target: T, dropShadow: { distance: 2, xOffset: 1 } }), /not both/);
    assert.throws(() => set({ target: T, satin: { enabled: false, angle: 10 } }), /enabled: false/);
    assert.throws(() => set({ target: T, satin: {} }), /give enabled or at least one option/);
    assert.throws(() => set({ target: T, outerGlow: { blendMode: 'ADD' } }), /Allowed: NORMAL/);
    assert.throws(() => set({ target: T, innerShadow: { useGlobalLight: 'yes' } }), /true or false/);
    assert.throws(() => set({ target: T, bevelAndEmboss: { altitude: 95 } }), /out of range/);
    assert.throws(() => set({ target: T, gradientFeather: { stops: [{ location: 0, opacity: 100 }] } }), /2 to 20 stops/);
    assert.throws(() => set({ target: T, gradientFeather: { stops: [{ location: 0, opacity: 100 }, { location: 100, opacity: 0, midpoint: 5 }] } }), /out of range/);
    assert.throws(() => set({ target: T, gradientFeather: { gradientStart: [1] } }), /\[x, y\]/);
    assert.throws(() => set({ target: T, dropShadow: { effectColor: '' } }), /is empty/);
});

await test('get_item_effects reads each requested target', async () => {
    const s = await one('get_item_effects', { target: T, on: ['object', 'content'], includeDisabled: true });
    assert.match(s, /r\.object = __fx\(it\.transparencySettings, true, __pageOf\(it\)\)/);
    assert.match(s, /r\.content = __fx\(it\.contentTransparencySettings, true, __pageOf\(it\)\)/);
    assert.doesNotMatch(s, /strokeTransparencySettings/);
    assert.match(s, /on = s\.dropShadowSettings\.mode == ShadowMode\.DROP;/);
    assert.match(s, /stops: __stops\(x\.opacityGradientStops\)/);
    assert.throws(() => tool('get_item_effects').handler({ target: T, on: ['glow'] }), /Allowed: object/);
    assert.throws(() => tool('get_item_effects').handler({ target: T, on: [] }), /non-empty list/);
});

await test('clear_item_effects turns effects off, or clears all transparency', async () => {
    const [fxOnly, all] = await scriptsFor([
        ['clear_item_effects', { target: T, on: ['fill'] }],
        ['clear_item_effects', { target: T, scope: 'all_transparency' }],
    ]);
    assert.match(fxOnly, /var targets = \{"fill":"fillTransparencySettings"\};/);
    assert.match(fxOnly, /s\.dropShadowSettings\.mode = ShadowMode\.NONE;/);
    assert.match(fxOnly, /s\.featherSettings\.mode = FeatherMode\.NONE;/);
    assert.match(fxOnly, /s\.gradientFeatherSettings\.applied = false;/);
    assert.doesNotMatch(fxOnly, /opacity = 100/);
    assert.match(all, /"content":"contentTransparencySettings"/);
    assert.match(all, /s\.blendingSettings\.opacity = 100;/);
    assert.match(all, /s\.blendingSettings\.blendMode = BlendMode\.NORMAL;/);
    assert.match(all, /s\.blendingSettings\.knockoutGroup = false;/);
    const clear = tool('clear_item_effects').handler;
    assert.throws(() => clear({ target: T, scope: 'everything' }), /Allowed: effects, all_transparency/);
    assert.throws(() => clear({ target: T, scope: 'all_transparency', on: ['fill'] }), /'on' applies to scope: effects/);
});

await test('set_transparency_preferences sets global light, blend space and display', async () => {
    const [docScope, appScope] = await scriptsFor([
        ['set_transparency_preferences', { globalLight: { angle: 120, altitude: 30 }, blendSpace: 'CMYK' }],
        ['set_transparency_preferences', { scope: 'application', globalLight: { angle: -30 }, transparencyDisplay: { typical: 'HIGH_QUALITY' } }],
    ]);
    assert.match(docScope, /var tp = __doc\(\)\.transparencyPreferences;/);
    assert.match(docScope, /tp\.globalLightAngle = 120;/);
    assert.match(docScope, /tp\.globalLightAltitude = 30;/);
    assert.match(docScope, /tp\.blendingSpace = BlendingSpace\.CMYK;/);
    assert.match(appScope, /var tp = app\.transparencyPreferences;/);
    assert.match(appScope, /app\.displaySettings\.item\(1\)\.transparency = TagTransparency\.HIGH_QUALITY;/);
    const set = tool('set_transparency_preferences').handler;
    assert.throws(() => set({}), /Nothing to set/);
    assert.throws(() => set({ globalLight: { altitude: 120 } }), /out of range/);
    assert.throws(() => set({ globalLight: {} }), /needs angle or altitude/);
    assert.throws(() => set({ blendSpace: 'LAB' }), /Allowed: RGB, CMYK/);
    assert.throws(() => set({ transparencyDisplay: { fast: 'BEST' } }), /Allowed: OFF/);
    assert.throws(() => set({ transparencyDisplay: { slow: 'OFF' } }), /Unknown option/);
});

await test('get_transparency_settings reads presets, display and spreads', async () => {
    const s = await one('get_transparency_settings', {});
    assert.match(s, /app\.flattenerPresets\.item\(j\)/);
    assert.match(s, /app\.displaySettings\.item\(i\)/);
    assert.match(s, /sp\.flattenerOverride == SpreadFlattenerLevel\.CUSTOM/);
    assert.match(s, /doc\.transparencyPreferences/);
});

await test('manage_flattener_preset creates, duplicates, updates and deletes', async () => {
    const [create, dup, upd, del] = await scriptsFor([
        ['manage_flattener_preset', { action: 'create', name: 'Proof', settings: { rasterVectorBalance: 80, clipComplexRegions: true } }],
        ['manage_flattener_preset', { action: 'duplicate', name: '[High Resolution]', newName: 'Press' }],
        ['manage_flattener_preset', { action: 'update', name: 'Press', newName: 'Press 2', settings: { lineArtAndTextResolution: 2400 } }],
        ['manage_flattener_preset', { action: 'delete', name: 'Press 2' }],
    ]);
    assert.match(create, /app\.flattenerPresets\.add\(\{ name: "Proof" \}\)/);
    assert.match(create, /p\.rasterVectorBalance = 80;/);
    assert.match(create, /p\.clipComplexRegions = true;/);
    assert.match(dup, /p = p\.duplicate\(\);\np\.name = "Press";/);
    assert.match(upd, /p\.name = "Press 2";/);
    assert.match(upd, /p\.lineArtAndTextResolution = 2400;/);
    assert.match(del, /p\.remove\(\);/);
    const m = tool('manage_flattener_preset').handler;
    assert.throws(() => m({ action: 'rename', name: 'A' }), /Allowed: create/);
    assert.throws(() => m({ action: 'create', name: ' ' }), /'name' is required/);
    assert.throws(() => m({ action: 'delete', name: '[Low Resolution]' }), /built-in preset/);
    assert.throws(() => m({ action: 'create', name: '[Mine]' }), /reserved/);
    assert.throws(() => m({ action: 'duplicate', name: 'A' }), /needs 'newName'/);
    assert.throws(() => m({ action: 'create', name: 'A', newName: 'B' }), /'newName' applies/);
    assert.throws(() => m({ action: 'update', name: 'A' }), /needs settings or newName/);
    assert.throws(() => m({ action: 'create', name: 'A', settings: { gradientAndMeshResolution: 5000 } }), /out of range/);
    assert.throws(() => m({ action: 'create', name: 'A', settings: { dpi: 300 } }), /Unknown option 'settings\.dpi'/);
});

await test('set_spread_flattening sets the override and custom settings', async () => {
    const [custom, none] = await scriptsFor([
        ['set_spread_flattening', { spreadIndex: 2, mode: 'custom', settings: { convertAllTextToOutlines: true } }],
        ['set_spread_flattening', { spreadIndex: 0, mode: 'none' }],
    ]);
    assert.match(custom, /var sp = doc\.spreads\[2\];/);
    assert.match(custom, /sp\.flattenerOverride = SpreadFlattenerLevel\.CUSTOM;/);
    assert.match(custom, /sp\.flattenerPreferences\.convertAllTextToOutlines = true;/);
    assert.match(none, /sp\.flattenerOverride = SpreadFlattenerLevel\.NONE;/);
    const f = tool('set_spread_flattening').handler;
    assert.throws(() => f({ spreadIndex: -1, mode: 'none' }), /Invalid index/);
    assert.throws(() => f({ spreadIndex: 0, mode: 'flat' }), /Allowed: default, none, custom/);
    assert.throws(() => f({ spreadIndex: 0, mode: 'default', settings: { clipComplexRegions: true } }), /only to mode: custom/);
});

done();
