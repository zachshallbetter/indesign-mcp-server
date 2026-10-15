import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { EFFECTS, WARP_STYLES, FX_COLOR_FN, BLEND_MODES, pathfinderEffect } from '../src/effects.js';

const sel = { selection: true };

/** Evaluate a generated XML expression with a stand-in document (scale factor 1, CMYK). */
const evalXml = (expr) => Function('doc', 'DocumentColorSpace', '__sf', '__fxColor', `return ${expr};`)(
    { documentColorSpace: 'CMYK', rasterEffectSettings: { resolution: 150 } }, { CMYK: 'CMYK' }, () => 1, () => 'COLOR');

test('stylize effects carry the published glow, feather and scribble parameters', () => {
    assert.equal(evalXml(EFFECTS.inner_glow.build({ source: 'center', opacity: 50, mode: 'overlay' })),
        '<LiveEffect name="Adobe Inner Glow"><Dict data="I blnd 3 I gtyp 0 R opac 0.5 R blur 5 "><Entry name="gclr" valueType="F"><Fill color="COLOR"/></Entry></Dict></LiveEffect>');
    assert.match(evalXml(EFFECTS.inner_glow.build({})), /I blnd 2 I gtyp 1 /, 'screen and edge by default');
    assert.match(evalXml(EFFECTS.outer_glow.build({ blur: 9 })), /^<LiveEffect name="Adobe Outer Glow"><Dict data="I blnd 2 R opac 0\.75 R blur 9 B usePSLBlur 1 "><Entry name="sclr"/);
    assert.match(evalXml(EFFECTS.drop_shadow.build({ color: '#336699', mode: 'normal' })), /I blnd 0 .*I csrc 0 .*<Fill color="COLOR"\/>/);
    assert.match(evalXml(EFFECTS.drop_shadow.build({})), /I blnd 1 .*I csrc 1 /, 'darkness, not colour, by default');
    assert.equal(evalXml(EFFECTS.feather.build({ radius: 6 })), '<LiveEffect name="Adobe Fuzzy Mask"><Dict data="R Radius 6 "/></LiveEffect>');
    assert.match(evalXml(EFFECTS.scribble.build({ curviness: 20, spacing: 4 })), /R Spacing 4 R Angle 30 R Scribbliness 0\.2 R StrokeWidth 3 R EdgeOverlap 0 /);
    assert.equal(BLEND_MODES.multiply, 1);
    assert.equal(BLEND_MODES.screen, 2);
});

test('convert to shape: relative adds space, absolute sets the size', () => {
    assert.match(evalXml(EFFECTS.convert_to_shape.build({ shape: 'ellipse', width: 10 })),
        /isPre="1"><Dict data="U DisplayString Ellipse I Shape 2 R RelWidth 10 R RelHeight 0 R AbsWidth 0 R AbsHeight 0 R Absolute 0 /);
    assert.match(evalXml(EFFECTS.convert_to_shape.build({ shape: 'rounded_rectangle', size: 'absolute', width: 100, height: 40, cornerRadius: 4 })),
        /DisplayString RoundedRectangle I Shape 1 R RelWidth 0 R RelHeight 0 R AbsWidth 100 R AbsHeight 40 R Absolute 1 R CornerRadius 4 /);
});

test('distort effects: free distort corners flip y; pucker, tweak, twist and zig zag', () => {
    const fd = evalXml(EFFECTS.free_distort.build({ corners: { bottomLeft: [0.25, 0.75] } }));
    assert.match(fd, /R src2h 0 R src2v -1 .*R dst2h 0\.25 R dst2v -0\.75 R dst3h 1 R dst3v -1 /);
    assert.match(evalXml(EFFECTS.pucker_bloat.build({ amount: -40 })), /"Adobe Punk and Bloat"><Dict data="R d_factor -40 "/);
    assert.match(evalXml(EFFECTS.twist.build({ angle: 90 })), /"Adobe Twirl" isPre="1"><Dict data="R angle 90 "/);
    assert.match(evalXml(EFFECTS.tweak.build({ horizontal: 3 })), /R horz 3 R vert 10 R ahor 3 R aver 10 R absoluteness 0 B in 1 B out 1 B anch 1 /);
    assert.match(evalXml(EFFECTS.zig_zag.build({ size: 6, ridges: 8, smooth: true })), /R amount 6 R relAmount 0 R absoluteness 1 R ridges 8 R roundness 1 /);
    assert.match(evalXml(EFFECTS.zig_zag.build({ size: 20, relative: true })), /R amount 20 R relAmount 20 R absoluteness 0 /);
});

test('warp: every style in menu order, with bend and distortion as fractions', () => {
    Object.keys(WARP_STYLES).forEach((style, i) => {
        assert.match(evalXml(EFFECTS.warp.build({ style })), new RegExp(`Warp:${WARP_STYLES[style]} I DeformStyle ${i + 1} `));
    });
    assert.equal(evalXml(EFFECTS.warp.build({ style: 'twist', bend: -20, vertical: true, horizontalDistortion: 10 })),
        '<LiveEffect name="Adobe Deform"><Dict data="S DisplayString Warp:Twist I DeformStyle 15 B Rotate 1 R DeformValue -0.2 R DeformHoriz 0.1 R DeformVert 0 "/></LiveEffect>');
});

test('path, crop marks and rasterize effects', () => {
    assert.equal(evalXml(EFFECTS.outline_object.build({})), '<LiveEffect name="Adobe Outline Type"><Dict data=" "/></LiveEffect>');
    assert.equal(evalXml(EFFECTS.outline_stroke.build({})), '<LiveEffect name="Adobe Outline Stroke"><Dict data=" "/></LiveEffect>');
    assert.equal(evalXml(EFFECTS.crop_marks.build({})), '<LiveEffect name="Adobe Trim Marks"><Dict data="I styl 0 "/></LiveEffect>');
    assert.match(evalXml(EFFECTS.rasterize.build({})), /I colr 1 B alis 1 I dpi\. 150 B mask 0 R padd 0 I optn 0 /, 'CMYK document, its raster resolution');
    assert.match(evalXml(EFFECTS.rasterize.build({ colorModel: 'grayscale', transparent: true, antiAlias: 'type', resolution: 300 })), /I colr 6 B alis 1 I dpi\. 300 .*I optn 16 /);
});

test('effect colours become a colour type and 0-1 components', () => {
    const run = (c) => Function('__color', `${FX_COLOR_FN}; return __fxColor(null, null);`)(() => c);
    assert.equal(run({ typename: 'RGBColor', red: 255, green: 0, blue: 51 }), '5 1 0 0.2');
    assert.equal(run({ typename: 'CMYKColor', cyan: 0, magenta: 50, yellow: 100, black: 10 }), '1 0 0.5 1 0.1');
    assert.equal(run({ typename: 'GrayColor', gray: 40 }), '0 0.4');
    assert.equal(run({ typename: 'SpotColor', spot: { color: { typename: 'GrayColor', gray: 100 } } }), '0 1');
    assert.throws(() => run({ typename: 'PatternColor' }), /must be RGB, CMYK, gray/);
});

test('pathfinder colour operations: hard mix, soft mix and trap', async () => {
    assert.match(evalXml(pathfinderEffect('soft_mix', { mixRate: 30 })), /I Command 11 .*R Mix 0\.3 .*value="Soft Mix"/);
    assert.match(evalXml(pathfinderEffect('trap', { trapThickness: 0.5, trapHeightWidth: 150, trapTintReduction: 20, trapReverse: true })),
        /I Command 12 .*R TrapAspect 1\.5 B TrapConvertCustom 1 R TrapMaxTint 1 B TrapReverse 1 R TrapThickness 0\.5 R TrapTint 0\.2 /);
    const [effect, menu] = await scriptsFor([
        ['pathfinder', { target: sel, operation: 'trap', expand: false }],
        ['pathfinder', { target: sel, operation: 'hard_mix', method: 'menu' }],
    ]);
    assert.match(effect, /target\.applyEffect\('<LiveEffect name="Adobe Pathfinder"/);
    assert.match(menu, /app\.executeMenuCommand\("Live Pathfinder Hard Mix"\)/);
});

test('apply_effect: new effects run applyEffect, NTSC Colors runs its menu command', async () => {
    const [glow, warp, ntsc] = await scriptsFor([
        ['apply_effect', { target: sel, effect: 'outer_glow', options: { color: 'cmyk(0,60,100,0)', mode: 'multiply' } }],
        ['apply_effect', { target: { ids: ['a'] }, effect: 'warp', options: { style: 'flag', bend: 30 }, expand: true }],
        ['apply_effect', { target: sel, effect: 'ntsc_colors' }],
    ]);
    assert.match(glow, /function __fxColor\(doc, spec\)/);
    assert.match(glow, /__fxColor\(doc, \{"kind":"cmyk","v":\[0,60,100,0\]\}\)/);
    assert.match(glow, /target\.applyEffect\(xml\)/);
    assert.match(glow, /raster: true, rasterResolution: doc\.rasterEffectSettings\.resolution/);
    assert.match(warp, /Adobe Deform/);
    assert.match(warp, /app\.executeMenuCommand\("expandStyle"\)/);
    assert.match(ntsc, /app\.executeMenuCommand\("Live PSAdapter_plugin_NTSC"\)/);
    assert.doesNotMatch(ntsc, /applyEffect/);
});

test('apply_svg_filter: by effect or by the preset menu command', async () => {
    const [effect, menu] = await scriptsFor([
        ['apply_svg_filter', { target: sel, filter: 'AI_Shadow_1' }],
        ['apply_svg_filter', { target: sel, filter: 'AI_Woodgrain', method: 'menu', expand: true }],
        ['apply_svg_filter', { target: sel, filter: 'My-Filter.2' }],
    ]);
    assert.match(effect, /<LiveEffect name="Adobe SVG Filter Effect"><Dict data=""><Entry name="SVGFilterUIDName" value="' \+ "AI_Shadow_1" \+ '" valueType="S"\/>/);
    assert.match(menu, /app\.executeMenuCommand\("AI_Woodgrain"\);\napp\.executeMenuCommand\("expandStyle"\)/);
});

test('apply_last_effect runs Apply Last Effect, not the Last Effect dialog', async () => {
    const [s] = await scriptsFor([['apply_last_effect', { target: sel }]]);
    assert.match(s, /app\.executeMenuCommand\("Adobe Apply Last Effect"\)/);
    assert.doesNotMatch(s, /"Adobe Last Effect"/);
});

test('set_raster_effect_settings writes RasterEffectOptions and assigns them back', async () => {
    const [set, read] = await scriptsFor([
        ['set_raster_effect_settings', { colorModel: 'bitmap', resolution: 300, transparent: true, antiAlias: false, clippingMask: true, padding: 12, preserveSpotColors: true }],
        ['set_raster_effect_settings', {}],
    ]);
    for (const line of ['o.colorModel = RasterizationColorModel.BITMAP;', 'o.resolution = 300;', 'o.transparency = true;', 'o.antiAliasing = false;',
        'o.clippingMask = true;', 'o.padding = __len(doc, 12);', 'o.convertSpotColors = false;', 'doc.rasterEffectSettings = o;']) {
        assert.ok(set.includes(line), line);
    }
    assert.doesNotMatch(read, /doc\.rasterEffectSettings = o/);
    assert.match(read, /changed: false/);
});

test('bad effect arguments are refused', async () => {
    const mcp = await server();
    const call = (name, args) => mcp.handleToolCall(name, args);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'feather', options: {} }), /needs options\.radius/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'warp', options: { style: 'spiral' } }), /Allowed: arc, arc_lower/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'inner_glow', options: { mode: 'glow' } }), /Invalid value for 'mode'/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'inner_glow', options: { color: 'none' } }), /needs a colour, not none/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'outer_glow', options: { color: 'rgb(1,2)' } }), /takes 3 value/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'convert_to_shape', options: { shape: 'ellipse', size: 'absolute', width: 10 } }), /needs options\.width and options\.height/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'free_distort', options: { corners: { middle: [0, 0] } } }), /not middle/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'free_distort', options: { corners: { topLeft: [0] } } }), /must be \[x, y\]/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'pucker_bloat', options: { amount: 500 } }), /out of range/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'zig_zag', options: { smooth: 'yes' } }), /must be true or false/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'rasterize', options: { resolution: 50 } }), /resolution/);
    await assert.rejects(call('apply_effect', { target: sel, effect: 'ntsc_colors', options: { amount: 1 } }), /takes no options/);
    await assert.rejects(call('apply_svg_filter', { target: sel, filter: 'x" onload="y' }), /Invalid SVG filter name/);
    await assert.rejects(call('apply_svg_filter', { target: sel, filter: 'My_Filter', method: 'menu' }), /only for the built-in filters/);
    await assert.rejects(call('pathfinder', { target: sel, operation: 'soft_mix', method: 'menu' }), /opens a dialog/);
    await assert.rejects(call('pathfinder', { target: sel, operation: 'trap', trapHeightWidth: 10 }), /out of range/);
    await assert.rejects(call('set_raster_effect_settings', { resolution: 10 }), /out of range/);
    await assert.rejects(call('set_raster_effect_settings', { colorModel: 'cmyk' }), /Allowed: document, grayscale, bitmap/);
    await assert.rejects(call('apply_last_effect', {}), /Choose the items/);
});
