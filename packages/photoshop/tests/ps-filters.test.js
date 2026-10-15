/**
 * Filters: apply_filter's object-model and Action Manager entries, Last Filter
 * and Fade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

const apply = (filter, options) => ['apply_filter', { filter, target: { ids: [4] }, ...(options ? { options } : {}) }];
const sid = (id) => `app.stringIDToTypeID("${id}")`;
const cid = (id) => `app.charIDToTypeID("${id}")`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (script, text) => assert.ok(script.includes(text), `missing: ${text}`);

test('object-model filters pass their options to ArtLayer methods', async () => {
    const [lens, radial, radialCentred, displace, polar, ripple, shear, spherize, wave, zigzag, glass, flare, flareAt, deint, custom, smart] = await scriptsFor([
        apply('lens_blur', { source: 'layer_mask', shape: 'octagon', radius: 40, noiseDistribution: 'gaussian', monochromatic: true }),
        apply('radial_blur', { amount: 30, method: 'zoom', quality: 'best' }),
        apply('radial_blur', { center: { x: 120, y: 80 } }),
        apply('displace', { mapFile: `${home}/Documents/map.psd`, horizontalScale: -20, map: 'tile', undefinedAreas: 'wrap_around' }),
        apply('polar_coordinates', { conversion: 'polar_to_rectangular' }),
        apply('ripple', { amount: -300, size: 'large' }),
        apply('shear', { curve: [[0, 0], [20, 128], [0, 255]], undefinedAreas: 'repeat_edge' }),
        apply('spherize', { amount: -50, mode: 'vertical' }),
        apply('wave', { generators: 3, type: 'square', randomSeed: 42 }),
        apply('zigzag', { amount: 40, ridges: 8, style: 'around_center' }),
        apply('glass', { texture: 'tiny_lens', invert: true }),
        apply('lens_flare'),
        apply('lens_flare', { brightness: 150, center: { x: 10, y: 20 }, lensType: 'movie_prime' }),
        apply('de_interlace', { eliminate: 'even', create: 'duplication' }),
        apply('custom', { matrix: [...Array(12).fill(0), 5, ...Array(12).fill(-1)], scale: 2, offset: 10 }),
        apply('smart_blur', { quality: 'high', mode: 'edge_only' }),
    ]);
    has(lens, 'l.applyLensBlur(DepthMapSource.LAYERMASK, 0, false, Geometry.OCTAGON, 40, 0, 0, 0, 255, 0, NoiseDistribution.GAUSSIAN, true);');
    has(radial, 'l.applyRadialBlur(30, RadialBlurMethod.ZOOM, RadialBlurQuality.BEST);');
    has(radialCentred, 'l.applyRadialBlur(10, RadialBlurMethod.SPIN, RadialBlurQuality.GOOD, [new UnitValue(120, "px"), new UnitValue(80, "px")]);');
    assert.match(displace, /var mapFile = new File\(".*\/Documents\/map\.psd"\);\n {2}if \(!mapFile\.exists\) throw/);
    has(displace, 'l.applyDisplace(-20, 10, DisplacementMapType.TILE, UndefinedAreas.WRAPAROUND, mapFile);');
    has(polar, 'l.applyPolarCoordinates(PolarConversionType.POLARTORECTANGULAR);');
    has(ripple, 'l.applyRipple(-300, RippleSize.LARGE);');
    has(shear, 'l.applyShear([[0, 0], [20, 128], [0, 255]], UndefinedAreas.REPEATEDGEPIXELS);');
    has(spherize, 'l.applySpherize(-50, SpherizeMode.VERTICAL);');
    has(wave, 'l.applyWave(3, 10, 120, 5, 35, 100, 100, WaveType.SQUARE, UndefinedAreas.REPEATEDGEPIXELS, 42);');
    has(zigzag, 'l.applyZigZag(40, 8, ZigZagType.AROUNDCENTER);');
    has(glass, 'l.applyGlassEffect(5, 3, 100, true, TextureType.TINYLENS);');
    has(flare, 'l.applyLensFlare(100, [new UnitValue(__px(doc.width) / 2, "px"), new UnitValue(__px(doc.height) / 2, "px")], LensType.ZOOMLENS);');
    has(flareAt, 'l.applyLensFlare(150, [new UnitValue(10, "px"), new UnitValue(20, "px")], LensType.MOVIEPRIME);');
    has(deint, 'l.applyDeInterlace(EliminateFields.EVENFIELDS, CreateFields.DUPLICATION);');
    has(custom, `l.applyCustomFilter([${[...Array(12).fill(0), 5, ...Array(12).fill(-1)].join(', ')}], 2, 10);`);
    has(smart, 'l.applySmartBlur(3, 25, SmartBlurQuality.HIGH, SmartBlurMode.EDGEONLY);');
});

test('Action Manager filters make the layer active and run their event without dialogs', async () => {
    const scripts = await scriptsFor([
        apply('box_blur', { radius: 7 }),
        apply('surface_blur', { radius: 9, threshold: 30 }),
        apply('reduce_noise', { strength: 8, removeJpegArtifacts: true }),
        apply('smart_sharpen', { remove: 'motion_blur', angle: 45, shadowFade: 20 }),
        apply('color_halftone', { maxRadius: 12, screenAngles: [1, 2, 3, 4] }),
        apply('crystallize', { cellSize: 20 }),
        apply('mosaic', { cellSize: 16 }),
        apply('pointillize'),
        apply('fibers', { variance: 20, strength: 8, randomSeed: 7 }),
        apply('emboss', { angle: -45, height: 5, amount: 250 }),
        apply('oil_paint', { stylization: 4, lighting: false }),
        apply('tiles', { number: 12, fill: 'inverse' }),
        apply('trace_contour', { level: 100, edge: 'upper' }),
        apply('wind', { method: 'stagger', direction: 'left' }),
        apply('hsb_hsl', { input: 'hsl', output: 'rgb' }),
        apply('camera_raw', { exposure: 0.5, clarity: -12 }),
        apply('maximum', { radius: 4, preserve: 'roundness' }),
        apply('minimum', { preserve: 'squareness' }),
        apply('watercolor'),
        apply('sponge'),
        apply('find_edges'),
    ]);
    for (const s of scripts) assert.match(s, /doc\.activeLayer = l;\n {2}app\.executeAction\(.*, d, DialogModes\.NO\);/);
    const [box, surface, noise, sharpen, halftone, crystal, mosaic, point, fibers, emboss, oil, tiles, trace, wind, hsb, raw, max, min, water, sponge, edges] = scripts;
    has(box, `d.putUnitDouble(${cid('Rds ')}, ${cid('#Pxl')}, 7);`);
    has(box, `app.executeAction(${sid('boxblur')}, d, DialogModes.NO)`);
    has(surface, `d.putInteger(${cid('Thsh')}, 30);`);
    has(noise, `cd.putInteger(${sid('amount')}, 8);`);
    has(noise, `d.putBoolean(${sid('removeJPEGArtifact')}, true);`);
    has(noise, `app.executeAction(${sid('denoise')}`);
    has(sharpen, `d.putEnumerated(${cid('blur')}, ${sid('blurType')}, ${cid('MtnB')});`);
    has(sharpen, `d.putInteger(${cid('mtnA')}, 45);`);
    has(sharpen, `sh.putUnitDouble(${cid('Amnt')}, ${cid('#Prc')}, 20);`);
    has(sharpen, `d.putObject(${cid('hglM')}, ${sid('adaptCorrectTones')}, hl);`);
    has(halftone, 'var angles = [1, 2, 3, 4];');
    has(halftone, `d.putInteger(${cid('Ang4')}, angles[3]);`);
    has(crystal, `d.putInteger(${cid('ClSz')}, 20);`);
    has(mosaic, `d.putUnitDouble(${cid('ClSz')}, ${cid('#Pxl')}, 16);`);
    has(point, `d.putInteger(${cid('ClSz')}, 5);`);
    has(fibers, `d.putInteger(${cid('RndS')}, 7);`);
    has(fibers, `app.executeAction(${cid('Fbrs')}`);
    has(emboss, `d.putInteger(${cid('Angl')}, -45);`);
    has(oil, `d.putBoolean(${sid('lightingOn')}, false);`);
    has(oil, `d.putDouble(${sid('stylization')}, 4);`);
    has(tiles, `d.putEnumerated(${cid('FlCl')}, ${cid('FlCl')}, ${cid('FlIn')});`);
    has(trace, `d.putEnumerated(${cid('Edg ')}, ${cid('CntE')}, ${cid('Upr ')});`);
    has(wind, `d.putEnumerated(${cid('WndM')}, ${cid('WndM')}, ${cid('Stgr')});`);
    has(wind, `d.putEnumerated(${cid('Drct')}, ${cid('Drct')}, ${cid('Left')});`);
    has(hsb, `d.putEnumerated(${cid('Inpt')}, ${cid('ClrS')}, ${cid('HSLC')});`);
    has(raw, `d.putDouble(${cid('Ex12')}, 0.5);`);
    has(raw, `d.putInteger(${cid('Cl12')}, -12);`);
    has(raw, `app.executeAction(${sid('Adobe Camera Raw Filter')}`);
    has(max, `d.putEnumerated(${sid('preserveShape')}, ${sid('preserveShape')}, ${cid('Rndn')});`);
    has(max, `app.executeAction(${sid('maximum')}`);
    has(min, `${sid('squareness')});`);
    assert.match(water, new RegExp(`var d = new ActionDescriptor\\(\\);\\n {2}doc\\.activeLayer = l;\\n {2}app\\.executeAction\\(${esc(sid('watercolor'))}, d, DialogModes\\.NO\\)`));
    has(sponge, `app.executeAction(${sid('sponge')}`);
    has(edges, `app.executeAction(${sid('findEdges')}`);
});

test('without Preserve, Maximum and Minimum keep using the object model', async () => {
    const [max] = await scriptsFor([apply('maximum', { radius: 3 })]);
    has(max, 'l.applyMaximum(3);');
    assert.doesNotMatch(max, /executeAction/);
});

test('Field Blur builds one blurbTransform widget per pin', async () => {
    const [centred, pinned] = await scriptsFor([
        apply('field_blur'),
        apply('field_blur', { pins: [{ x: 10, y: 20, blur: 40 }, { x: 300, y: 200, blur: 0 }], noiseAmount: 12, randomSeed: 99 }),
    ]);
    has(centred, `wd.putDouble(${sid('blurbWidgetLocationX')}, w / 2);`);
    has(centred, `wd.putDouble(${sid('blurbGeneralBlurAmount')}, 15);`);
    assert.equal(pinned.match(/wl\.putObject/g).length, 2);
    has(pinned, `wd.putDouble(${sid('blurbWidgetLocationY')}, 200);`);
    has(pinned, `wd.putDouble(${sid('blurbGeneralBlurAmount')}, 40);`);
    has(pinned, `nz.putUnitDouble(${cid('Amnt')}, ${cid('#Prc')}, 12);`);
    has(pinned, `nz.putInteger(${cid('RndS')}, 99);`);
    has(pinned, `d.putDouble(${cid('PuY2')}, h);`);
    has(pinned, `app.executeAction(${sid('blurbTransform')}, d, DialogModes.NO)`);
});

test('Last Filter and Fade run their events', async () => {
    const [last, fade] = await scriptsFor([
        ['repeat_last_filter', { target: { ids: [3, 4] } }],
        ['fade_filter', { opacity: 40, mode: 'subtract' }],
    ]);
    has(last, `r.putEnumerated(${sid('menuItemClass')}, ${sid('menuItemType')}, ${sid('lastFilter')});`);
    has(last, `app.executeAction(${sid('select')}, d, DialogModes.NO);`);
    has(fade, `d.putUnitDouble(${sid('opacity')}, ${cid('#Prc')}, 40);`);
    has(fade, `d.putEnumerated(${sid('mode')}, ${sid('blendMode')}, app.stringIDToTypeID("blendSubtraction"));`);
});

test('bad filter options are refused', async () => {
    const mcp = await server();
    const refuse = (args, re) => assert.rejects(mcp.handleToolCall('apply_filter', { target: { active: true }, ...args }), re);
    await refuse({ filter: 'lens_blur', options: { shape: 'circle' } }, /options\.shape.*Allowed: triangle/);
    await refuse({ filter: 'radial_blur', options: { amount: 0 } }, /out of range/);
    await refuse({ filter: 'radial_blur', options: { center: 5 } }, /\{ x, y \}/);
    await refuse({ filter: 'emboss', options: { height: 2.5 } }, /whole number/);
    await refuse({ filter: 'wave', options: { wavelengthMin: 200, wavelengthMax: 100 } }, /wavelengthMin must be below/);
    await refuse({ filter: 'displace' }, /options\.mapFile is required/);
    await refuse({ filter: 'displace', options: { mapFile: '/etc/map.psd' } }, /outside|allowed|not permitted/i);
    await refuse({ filter: 'shear', options: { curve: [[0, 0]] } }, /at least two/);
    await refuse({ filter: 'custom', options: { matrix: [1, 2, 3] } }, /25 whole numbers/);
    await refuse({ filter: 'color_halftone', options: { screenAngles: [1, 2, 3] } }, /4 whole numbers/);
    await refuse({ filter: 'field_blur', options: { pins: [] } }, /1 to 20 pins/);
    await refuse({ filter: 'field_blur', options: { pins: [{ x: 1, y: 2, blur: 900 }] } }, /out of range/);
    await refuse({ filter: 'watercolor', options: { brushDetail: 3 } }, /has no option brushDetail/);
    await refuse({ filter: 'maximum', options: { preserve: 'circle' } }, /Allowed: squareness, roundness/);
    await refuse({ filter: 'smart_sharpen', options: { remove: 'shake' } }, /Allowed: gaussian_blur, lens_blur, motion_blur/);
    await assert.rejects(mcp.handleToolCall('fade_filter', { opacity: 50, mode: 'pass_through' }), /Allowed: normal/);
    await assert.rejects(mcp.handleToolCall('fade_filter', { opacity: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('fade_filter', {}), /opacity/);
});
