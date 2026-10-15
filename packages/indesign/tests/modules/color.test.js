/**
 * Colour tools: the object-model statements their scripts carry, the
 * arguments they refuse, and an object-model check of every operation's
 * script (the script audit samples one call per tool).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];

/** Member names in the InDesign 2023 typings, as the script audit reads them. */
const members = (() => {
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve('types-for-adobe/package.json'));
    const dts = ['InDesign/2023/index.d.ts', 'shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
    const set = new Set(['length', 'push', 'join', 'slice', 'message', 'fsName', 'exists', 'kind', 'v', 'ids', 'names']);
    for (const m of dts.matchAll(/^\s*(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\??\s*[:(<]/gm)) set.add(m[1]);
    for (const m of dts.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*\d+/gm)) set.add(m[1]);
    return set;
})();

/** Parse a script as ES5 and return member names that are neither in the typings nor the script's own object keys. */
function unknownMembers(src) {
    const ast = acorn.parse(src, { ecmaVersion: 5, allowReturnOutsideFunction: true });
    const own = new Set();
    const plain = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'Property') own.add(n.key.name ?? n.key.value);
        if (n.type === 'VariableDeclarator' && n.init?.type === 'ObjectExpression') plain.add(n.id.name);
    });
    // Fields the script assigns on its own plain objects (var o = {}; o.x = ...).
    walk.full(ast, (n) => {
        if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed
            && n.left.object.type === 'Identifier' && plain.has(n.left.object.name)) own.add(n.left.property.name);
    });
    const out = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'MemberExpression' && !n.computed && !members.has(n.property.name) && !own.has(n.property.name)) out.add(n.property.name);
    });
    return [...out];
}

await test('every operation of every colour tool generates ES5 that uses known object-model names', async () => {
    const calls = [
        ['create_swatch', { kind: 'color', nameWithColorValue: true, space: 'lab', values: [50, -20, 30] }],
        ['create_swatch', { kind: 'tint', baseColor: 'Brand Red', tint: 40, group: 'Brand' }],
        ['create_swatch', { kind: 'mixed_ink', name: 'Mix 1', inks: [{ ink: 'Process Cyan', percent: 20 }, { ink: 'PANTONE 185 C', percent: 80 }] }],
        ['create_swatch', { kind: 'mixed_ink_group', name: 'Group 1', inks: [{ ink: 'Process Black', percent: 10, repeat: 3, increment: 20 }, { ink: 'PANTONE 185 C', percent: 100 }] }],
        ['edit_swatch', { swatch: 'Brand Red', name: 'Red', model: 'spot' }],
        ['edit_swatch', { swatch: 'Mix 1', inks: [{ ink: 'Process Cyan', percent: 40 }], model: 'process' }],
        ...['duplicate', 'delete', 'merge', 'list_unused', 'delete_unused', 'add_unnamed_colors', 'add_to_swatches', 'group', 'ungroup'].map((op) => ['manage_swatches', {
            operation: op,
            ...(['duplicate', 'delete', 'merge', 'group'].includes(op) ? { swatches: ['A', 'B'] } : {}),
            ...(op === 'delete' || op === 'delete_unused' ? { replaceWith: 'Black' } : {}),
            ...(op === 'group' || op === 'ungroup' ? { group: 'Brand' } : {}),
            ...(op === 'add_to_swatches' ? { target: T } : {}),
        }]),
        ['load_swatches', { file: path.join(home, 'Documents', 'x.indd') }],
        ['save_swatches', { file: path.join(home, 'Documents', 'x.ase') }],
        ['set_inks', {}],
        ['set_inks', { allSpotsToProcess: true, inks: [{ name: 'PANTONE 185 C', alias: '' }] }],
        ['set_gradient_swatch', { name: 'Sunset', newName: 'Dawn' }],
        ['set_fill_stroke', { target: T, applyTo: 'text', defaults: true }],
        ['set_fill_stroke', { target: T, applyTo: 'content', fill: { color: 'Brand Red', tint: 50 } }],
        ['copy_fill_stroke', { source: 3, target: T, applyTo: 'text', copy: 'stroke' }],
        ['set_color_panel_options', { active: 'fill', affects: 'container', swatchesView: 'large_swatch', colorPanelMode: 'lab' }],
        ['get_color_settings', {}],
        ['set_color_settings', { presetFile: path.join(home, 'Documents', 'x.csf'), richBlackOnExport: true }],
        ['assign_document_profiles', { cmykProfile: 'working', rgbProfile: 'sRGB IEC61966-2.1' }],
        ['set_proofing', { proofing: 'off' }],
        ['set_image_color_settings', { target: T, profile: 'USE_DOCUMENT' }],
    ];
    for (const call of calls) {
        const [s] = await scriptsFor([call]);
        assert.deepEqual(unknownMembers(s), [], `${call[0]} ${JSON.stringify(call[1])}`);
    }
});

await test('create_swatch writes colours, tints, mixed inks and groups', async () => {
    let s = await one('create_swatch', { kind: 'color', name: 'Brand Red', model: 'spot', space: 'cmyk', values: [0, 90, 85, 0], group: 'Brand' });
    assert.match(s, /doc\.colors\.add\(\{ name: nm, model: ColorModel\.SPOT, space: ColorSpace\.CMYK, colorValue: \[0, 90, 85, 0\] \}\)/);
    assert.match(s, /var g = doc\.colorGroups\.itemByName\("Brand"\);/);
    assert.match(s, /g\.colorGroupSwatches\.add\(s\); else doc\.colorGroups\.add\("Brand", \[s\]\);/);
    s = await one('create_swatch', { kind: 'color', nameWithColorValue: true, space: 'rgb', values: [255, 0, 0] });
    assert.match(s, /var nm = __valueName\(ColorSpace\.RGB, \[255, 0, 0\]\);/);
    assert.match(s, /model: ColorModel\.PROCESS/);
    s = await one('create_swatch', { kind: 'tint', baseColor: 'Brand Red', tint: 40 });
    assert.match(s, /var s = doc\.tints\.add\(base, \{ tintValue: 40 \}\);/);
    s = await one('create_swatch', { kind: 'mixed_ink', name: 'Mix', inks: [{ ink: 'Process Cyan', percent: 20 }, { ink: 'PANTONE 185 C', percent: 80 }] });
    assert.match(s, /doc\.mixedInks\.add\(inks, \[20,80\], \{ name: nm \}\)/);
    s = await one('create_swatch', { kind: 'mixed_ink_group', name: 'Grp', inks: [{ ink: 'Process Black', percent: 10, repeat: 3, increment: 20 }, { ink: 'PANTONE 185 C', percent: 100 }] });
    assert.match(s, /doc\.mixedInkGroups\.add\(inks, \[10,100\], \[3,0\], \[20,0\], \{ name: nm \}\)/);
});

await test('create_swatch refuses bad arguments', () => {
    const c = tool('create_swatch').handler;
    assert.throws(() => c({ kind: 'pattern' }), /Allowed: color, tint/);
    assert.throws(() => c({ kind: 'color', name: 'X', space: 'hsb', values: [1, 2, 3] }), /Allowed: rgb, cmyk, lab/);
    assert.throws(() => c({ kind: 'color', name: 'X', space: 'cmyk', values: [1, 2, 3] }), /needs 4 numbers/);
    assert.throws(() => c({ kind: 'color', name: 'X', space: 'rgb', values: [1, 2, 300] }), /out of range/);
    assert.throws(() => c({ kind: 'color', name: 'X', space: 'lab', values: [50, -200, 0] }), /out of range/);
    assert.throws(() => c({ kind: 'color', space: 'rgb', values: [1, 2, 3] }), /'name' must be a non-empty name/);
    assert.throws(() => c({ kind: 'color', name: 'X', nameWithColorValue: true, space: 'rgb', values: [1, 2, 3] }), /not both/);
    assert.throws(() => c({ kind: 'color', name: 'X', space: 'rgb', values: [1, 2, 3], tint: 5 }), /'tint' does not apply to kind: color/);
    assert.throws(() => c({ kind: 'tint', baseColor: 'X' }), /needs 'tint'/);
    assert.throws(() => c({ kind: 'tint', baseColor: 'X', tint: 50, name: 'Y' }), /'name' does not apply to kind: tint/);
    assert.throws(() => c({ kind: 'mixed_ink', name: 'M', inks: [{ ink: 'A', percent: 10 }] }), /2 to 50 inks/);
    assert.throws(() => c({ kind: 'mixed_ink', name: 'M', inks: [{ ink: 'A', percent: 10, repeat: 2 }, { ink: 'B', percent: 5 }] }), /Unknown option 'inks\[0\]\.repeat'/);
    assert.throws(() => c({ kind: 'mixed_ink_group', name: 'M', inks: [{ ink: 'A', percent: 50, repeat: 3, increment: 20 }, { ink: 'B', percent: 5 }] }), /exceeds 100/);
});

await test('edit_swatch converts, renames and edits tints and mixed inks', async () => {
    let s = await one('edit_swatch', { swatch: 'Brand Red', model: 'process', space: 'lab', values: [50, 60, 40], nameWithColorValue: true });
    assert.match(s, /s\.model = ColorModel\.PROCESS;/);
    assert.match(s, /s\.space = ColorSpace\.LAB;/);
    assert.match(s, /s\.colorValue = \[50, 60, 40\];/);
    assert.match(s, /var vn = __valueName\(s\.space, s\.colorValue\);/);
    assert.ok(s.indexOf('s.colorValue =') < s.indexOf('__valueName(s.space'), 'the name follows the final values');
    s = await one('edit_swatch', { swatch: 'Brand Red 50%', tint: 60, name: 'Light red' });
    assert.match(s, /if \(t !== "Tint"\) throw/);
    assert.match(s, /s\.tintValue = 60;/);
    assert.match(s, /s\.name = "Light red";/);
    s = await one('edit_swatch', { swatch: 'Mix', inks: [{ ink: 'Process Cyan', percent: 35 }] });
    assert.match(s, /s\.inkPercentages = p;/);
    const e = tool('edit_swatch').handler;
    assert.throws(() => e({ swatch: 'X' }), /Nothing to change/);
    assert.throws(() => e({ swatch: 'X', values: [1, 2, 3] }), /needs 'space'/);
    assert.throws(() => e({ swatch: 'X', model: 'registration' }), /Allowed: process, spot/);
    assert.throws(() => e({ swatch: 'X', inks: [] }), /non-empty list/);
    assert.throws(() => e({ swatch: 'X', inks: [{ ink: 'A' }] }), /percent' is required/);
    assert.throws(() => e({ swatch: '' , name: 'Y' }), /'swatch' must be a non-empty name/);
    assert.throws(() => e({ swatch: 'X', colour: 'red' }), /Unknown option 'colour'/);
});

await test('manage_swatches builds each Swatches panel command', async () => {
    let s = await one('manage_swatches', { operation: 'duplicate', swatches: ['Brand Red'], newName: 'Brand Red copy' });
    assert.match(s, /__findSwatch\(doc, list\[i\]\)\.duplicate\(\);/);
    assert.match(s, /d\.name = "Brand Red copy";/);
    s = await one('manage_swatches', { operation: 'delete', swatches: ['Old'], replaceWith: 'Black' });
    assert.match(s, /rep = __findSwatch\(doc, "Black"\)/);
    assert.match(s, /if \(rep\) s\.remove\(rep\); else s\.remove\(\);/);
    s = await one('manage_swatches', { operation: 'merge', swatches: ['Red', 'Red 2', 'Red 3'] });
    assert.match(s, /keep\.merge\(others\);/);
    s = await one('manage_swatches', { operation: 'delete_unused' });
    assert.match(s, /u = doc\.unusedSwatches/);
    s = await one('manage_swatches', { operation: 'add_unnamed_colors' });
    assert.match(s, /app\.menuActions\.itemByID\(16403\)/);
    assert.match(s, /c\.name = vn;/);
    s = await one('manage_swatches', { operation: 'add_to_swatches', target: T, on: 'stroke' });
    assert.match(s, /sw = toSwatch\(it\.strokeColor\); if \(sw\) \{ it\.strokeColor = sw;/);
    assert.doesNotMatch(s, /it\.fillColor/);
    s = await one('manage_swatches', { operation: 'group', group: 'Brand', swatches: ['Red'] });
    assert.match(s, /g = doc\.colorGroups\.add\(gn, sw\);/);
    s = await one('manage_swatches', { operation: 'ungroup', group: 'Brand' });
    assert.match(s, /g\.ungroup\(\);/);
    const m = tool('manage_swatches').handler;
    assert.throws(() => m({ operation: 'rename' }), /Allowed: duplicate/);
    assert.throws(() => m({ operation: 'merge', swatches: ['A'] }), /at least 2 names/);
    assert.throws(() => m({ operation: 'duplicate', swatches: ['A', 'B'], newName: 'C' }), /one swatch/);
    assert.throws(() => m({ operation: 'merge', swatches: ['A', 'B'], replaceWith: 'C' }), /'replaceWith' does not apply to merge/);
    assert.throws(() => m({ operation: 'group' }), /'group' must be a non-empty name/);
    assert.throws(() => m({ operation: 'add_to_swatches', target: {} }), /Choose the items/);
    assert.throws(() => m({ operation: 'add_to_swatches', target: T, on: 'text' }), /Allowed: fill, stroke, both/);
});

await test('load_swatches and save_swatches check paths and build the calls', async () => {
    let s = await one('load_swatches', { file: path.join(home, 'Documents', 'brand.ase'), spotColors: ['PANTONE 185 C'] });
    assert.match(s, /doc\.loadSwatches\(f\);/);
    assert.match(s, /doc\.importAdobeSwatchbookSpotColor\(spot\[s\]\)/);
    s = await one('save_swatches', { file: path.join(home, 'Documents', 'brand.ase'), swatches: ['Red'] });
    assert.match(s, /doc\.saveSwatches\(f, sw, ""\);/);
    assert.throws(() => tool('load_swatches').handler({}), /Give file, spotColors or processColors/);
    assert.throws(() => tool('load_swatches').handler({ file: path.join(home, 'Documents', 'x.txt') }), /must end in \.indd, \.indt, \.ase/);
    assert.throws(() => tool('save_swatches').handler({ file: path.join(home, 'Documents', 'x.indd') }), /must end in \.ase/);
    assert.throws(() => tool('save_swatches').handler({ file: '/etc/x.ase' }), /outside the allowed directories/);
});

await test('set_inks sets Ink Manager options', async () => {
    const s = await one('set_inks', { allSpotsToProcess: true, useStandardLabForSpots: false, inks: [{ name: 'PANTONE 185 C', type: 'OPAQUE', neutralDensity: 0.8, trapSequence: 5, alias: 'Process Magenta', convertToProcess: false }] });
    assert.match(s, /if \(!every\[i\]\.isProcessInk\) every\[i\]\.convertToProcess = true;/);
    assert.match(s, /doc\.accurateLABSpots = false;/);
    assert.match(s, /ink\.inkType = InkTypes\.OPAQUE;/);
    assert.match(s, /ink\.neutralDensity = 0\.8;/);
    assert.match(s, /ink\.trapOrder = 5;/);
    assert.match(s, /ink\.aliasInkName = __ink\(doc, "Process Magenta"\)\.name;/);
    assert.ok(s.indexOf('every[i].convertToProcess') < s.indexOf('ink.convertToProcess = false'), 'all spots first, then per ink');
    const i = tool('set_inks').handler;
    assert.throws(() => i({ inks: [{ name: 'A' }] }), /nothing to set/);
    assert.throws(() => i({ inks: [{ name: 'A', type: 'GLOSSY' }] }), /Allowed: NORMAL/);
    assert.throws(() => i({ inks: [{ name: 'A', neutralDensity: 20 }] }), /out of range/);
    assert.throws(() => i({ inks: [{ name: 'A', trapSequence: 1.5 }] }), /whole number/);
});

await test('set_gradient_swatch creates and edits gradients with stops', async () => {
    const s = await one('set_gradient_swatch', { name: 'Sunset', type: 'RADIAL', stops: [{ color: 'Brand Red', location: 0, midpoint: 40 }, { color: '#FFCC00', location: 60 }, { color: 'Paper', location: 100 }] });
    assert.match(s, /if \(created\) g = doc\.gradients\.add\(\{ name: nm, type: GradientType\.RADIAL \}\);/);
    assert.match(s, /while \(gs\.length < 3\) gs\.add\(\);/);
    assert.match(s, /gs\.item\(0\)\.midpoint = 40;/);
    assert.match(s, /gs\.item\(1\)\.location = 60;/);
    assert.match(s, /gs\.item\(2\)\.stopColor = cs\[2\];/);
    assert.match(s, /__swatch\(doc, \{"kind":"rgb","v":\[255,204,0\]\}\)/);
    const g = tool('set_gradient_swatch').handler;
    assert.throws(() => g({ name: 'G' }), /Nothing to set/);
    assert.throws(() => g({ name: 'G', stops: [{ color: 'A', location: 0 }] }), /2 to 50 stops/);
    assert.throws(() => g({ name: 'G', stops: [{ color: 'A', location: 50 }, { color: 'B', location: 10 }] }), /give stops in order/);
    assert.throws(() => g({ name: 'G', stops: [{ color: 'A', location: 0, midpoint: 5 }, { color: 'B', location: 100 }] }), /out of range/);
    assert.throws(() => g({ name: 'G', type: 'ANGLE' }), /Allowed: LINEAR, RADIAL/);
});

await test('set_fill_stroke applies colours, gradients, swap and defaults', async () => {
    let s = await one('set_fill_stroke', {
        target: T, swap: true,
        fill: { color: 'Sunset', tint: 80, gradientAngle: 45, gradientLength: 60, gradientStart: [10, 20], overprint: true },
        stroke: { color: 'None', reverseGradient: true },
    });
    assert.match(s, /o = __paintTarget\(it, "item"\)/);
    assert.match(s, /var fc = o\.fillColor, ft = o\.fillTint; o\.fillColor = o\.strokeColor; o\.strokeColor = fc;/);
    assert.match(s, /o\.fillColor = __c0;/);
    assert.match(s, /o\.fillTint = 80;/);
    assert.match(s, /o\.gradientFillAngle = 45;/);
    assert.match(s, /o\.gradientFillLength = 60;/);
    assert.match(s, /o\.gradientFillStart = pg \? __toPage\(pg, 10, 20\) : \[10, 20\];/);
    assert.match(s, /o\.overprintFill = true;/);
    assert.match(s, /o\.strokeColor = __c1;/);
    assert.match(s, /var __a = o\.gradientStrokeAngle \+ 180;/);
    assert.ok(s.indexOf('var fc = o.fillColor') < s.indexOf('o.fillColor = __c0'), 'swap runs before the fill options');
    s = await one('set_fill_stroke', { target: T, applyTo: 'content', fill: { color: 'Brand Red' } });
    assert.match(s, /__paintTarget\(it, "content"\)/);
    assert.match(s, /it\.allGraphics\[0\]/);
    s = await one('set_fill_stroke', { target: T, applyTo: 'text', defaults: true });
    assert.match(s, /o\.fillColor = __black; o\.strokeColor = __none;/);
    s = await one('set_fill_stroke', { target: T, defaults: true });
    assert.match(s, /o\.fillColor = __none; o\.strokeColor = __black;/);
    const f = tool('set_fill_stroke').handler;
    assert.throws(() => f({ target: T }), /Nothing to apply/);
    assert.throws(() => f({ target: {}, swap: true }), /Choose the items/);
    assert.throws(() => f({ target: T, swap: true, defaults: true }), /not both/);
    assert.throws(() => f({ target: T, applyTo: 'cell', swap: true }), /Allowed: item, text, content/);
    assert.throws(() => f({ target: T, fill: {} }), /'fill' is empty/);
    assert.throws(() => f({ target: T, fill: { colour: 'Red' } }), /Unknown option 'fill\.colour'/);
    assert.throws(() => f({ target: T, fill: { tint: 120 } }), /out of range/);
    assert.throws(() => f({ target: T, stroke: { gradientAngle: 200 } }), /out of range/);
    assert.throws(() => f({ target: T, stroke: { gradientAngle: 20, reverseGradient: true } }), /not both/);
    assert.throws(() => f({ target: T, fill: { gradientStart: [1] } }), /\[x, y\]/);
    assert.throws(() => f({ target: T, fill: { color: '' } }), /is empty/);
});

await test('copy_fill_stroke copies the eyedropper attributes', async () => {
    let s = await one('copy_fill_stroke', { source: 3, target: { ids: [5, 6] } });
    assert.match(s, /var src = __paintTarget\(__item\(doc, 3\), "item"\);/);
    assert.match(s, /o\.fillColor = src\.fillColor;/);
    assert.match(s, /o\.strokeWeight = src\.strokeWeight;/);
    assert.match(s, /o\.strokeType = src\.strokeType;/);
    s = await one('copy_fill_stroke', { source: 3, target: T, copy: 'fill', applyTo: 'text' });
    assert.doesNotMatch(s, /strokeColor = src/);
    assert.match(s, /__paintTarget\(it, "text"\)/);
    const c = tool('copy_fill_stroke').handler;
    assert.throws(() => c({ source: -1, target: T }), /out of range/);
    assert.throws(() => c({ source: 1.5, target: T }), /page item id/);
    assert.throws(() => c({ source: 1, target: T, copy: 'all' }), /Allowed: both, fill, stroke/);
});

await test('set_color_panel_options sets the proxy and invokes only dialog-free panel commands', async () => {
    const s = await one('set_color_panel_options', { active: 'stroke', affects: 'text', swatchesView: 'small_name', colorPanelMode: 'cmyk', toggleSwatchesOptions: true, toggleColorOptions: true });
    assert.match(s, /p\.active = StrokeFillProxyOptions\.STROKE;/);
    assert.match(s, /p\.target = StrokeFillTargetOptions\.FORMATTING_AFFECTS_TEXT;/);
    for (const id of [16402, 16406, 29189, 29185]) assert.match(s, new RegExp(`__menu\\(${id}, `));
    assert.doesNotMatch(s, /var doc = __doc\(\);/);
    const ids = [...s.matchAll(/__menu\((\d+),/g)].map((m) => m[1]);
    let commands = [];
    try {
        commands = JSON.parse(readFileSync(path.join(home, 'Projects/adobe-capability-atlas/corpus/indesign/commands/commands.json'), 'utf8'));
    } catch { /* the atlas is not present on every machine */ }
    for (const id of ids) {
        const c = commands.find((x) => x.id === id);
        if (c) assert.ok(!c.name.endsWith('...'), `menu action ${id} (${c.name}) opens a dialog`);
    }
    assert.throws(() => tool('set_color_panel_options').handler({}), /Nothing to set/);
    assert.throws(() => tool('set_color_panel_options').handler({ swatchesView: 'grid' }), /Allowed: name, small_name/);
});

await test('colour settings, document profiles, proofing and image colour settings', async () => {
    let s = await one('set_color_settings', { preset: 'North America General Purpose 2', rgbPolicy: 'CONVERT_TO_WORKING_SPACE', intent: 'PERCEPTUAL', blackPointCompensation: false, richBlackOnScreen: true, cmykWorkingSpace: 'Coated FOGRA39 (ISO 12647-2:2004)' });
    assert.match(s, /cs\.cmsSettings = __pick\(cs\.cmsSettingsList, "North America General Purpose 2"/);
    assert.match(s, /cs\.rgbPolicy = ColorSettingsPolicy\.CONVERT_TO_WORKING_SPACE;/);
    assert.match(s, /cs\.intent = DefaultRenderingIntent\.PERCEPTUAL;/);
    assert.match(s, /cs\.useBPC = false;/);
    assert.match(s, /cs\.idealizedBlackToScreen = true;/);
    assert.match(s, /cs\.workingSpaceCMYK = __pick\(cs\.workingSpaceCMYKList, /);
    assert.ok(s.indexOf('cs.cmsSettings =') < s.indexOf('cs.rgbPolicy ='), 'the preset is applied first');
    s = await one('get_color_settings', { includeLists: true });
    assert.match(s, /cs\.workingSpaceRGBList/);
    assert.match(s, /d\.rgbProfiles = doc\.rgbProfileList;/);
    s = await one('assign_document_profiles', { rgbProfile: 'working', cmykProfile: 'Coated FOGRA39 (ISO 12647-2:2004)', defaultImageIntent: 'PERCEPTUAL' });
    assert.match(s, /doc\.rgbProfile = app\.colorSettings\.workingSpaceRGB;/);
    assert.match(s, /doc\.cmykProfile = __pick\(doc\.cmykProfileList, /);
    assert.match(s, /doc\.defaultImageIntent = RenderingIntent\.PERCEPTUAL;/);
    s = await one('set_proofing', { profile: 'Coated FOGRA39 (ISO 12647-2:2004)', simulatePaperWhite: true, overprintPreview: true });
    assert.match(s, /w\.proofingType = ProofingType\.CUSTOM;/);
    assert.ok(s.indexOf('w.proofingType =') < s.indexOf('w.proofingProfile ='), 'custom before the profile');
    assert.match(s, /w\.overprintPreview = true;/);
    s = await one('set_image_color_settings', { target: T, profile: 'Adobe RGB (1998)', renderingIntent: 'SATURATION' });
    assert.match(s, /img\.profile = want;/);
    assert.match(s, /img\.imageRenderingIntent = RenderingIntent\.SATURATION;/);
    assert.throws(() => tool('set_color_settings').handler({}), /Nothing to set/);
    assert.throws(() => tool('set_color_settings').handler({ preset: 'A', presetFile: path.join(home, 'Documents', 'x.csf') }), /not both/);
    assert.throws(() => tool('set_color_settings').handler({ intent: 'USE_COLOR_SETTINGS' }), /Allowed: PERCEPTUAL/);
    assert.throws(() => tool('set_color_settings').handler({ useBPC: true }), /Unknown option 'useBPC'/);
    assert.throws(() => tool('set_color_settings').handler({ enableColorManagement: 'yes' }), /true or false/);
    assert.throws(() => tool('assign_document_profiles').handler({}), /Nothing to set/);
    assert.throws(() => tool('assign_document_profiles').handler({ rgbPolicy: 'KEEP' }), /Allowed: COLOR_POLICY_OFF/);
    assert.throws(() => tool('set_proofing').handler({ proofing: 'working_cmyk', simulateInkBlack: true }), /applies to proofing: custom/);
    assert.throws(() => tool('set_proofing').handler({}), /Nothing to set/);
    assert.throws(() => tool('set_image_color_settings').handler({ target: T }), /Nothing to set/);
});

done();
