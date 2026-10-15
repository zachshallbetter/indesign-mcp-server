import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';
import { toolDefinitions } from '../src/server.js';

const call = async (name, args) => (await server()).handleToolCall(name, args);

test('trace_image traces each image, sets the options, redraws, then expands when asked', async () => {
    const [plain, full] = await scriptsFor([
        ['trace_image', { target: { selection: true } }],
        ['trace_image', {
            target: { ids: ['1'] }, preset: 'High Fidelity Photo', mode: 'color', palette: 'full_tone', colorFidelity: 80,
            library: 'Document Library', colorGroup: 'All', colors: 12, grays: 40, threshold: 128, paths: 60, corners: 30, noise: 8,
            method: 'overlapping', fills: true, strokes: true, maxStrokeWeight: 2.5, snapCurvesToLines: true, ignoreWhite: true,
            view: 'outlines', expand: true,
        }],
    ]);
    assert.match(plain, /var p = items\[j\]\.trace\(\), o = p\.tracing\.tracingOptions;/);
    assert.match(plain, /app\.redraw\(\);\n {2}var info = __traceInfo/);
    assert.doesNotMatch(plain, /expandTracing\(/);
    assert.match(plain, /t !== "PlacedItem" && t !== "RasterItem"/);
    for (const line of [
        'o.loadFromPreset(__tracePreset("High Fidelity Photo"))',
        'o.tracingMode = TracingModeType.TRACINGMODECOLOR;',
        'o.tracingColorTypeValue = TracingColorType.TRACINGFULLCOLOR;',
        'o.tracingMethod = TracingMethodType.TRACINGMETHODOVERLAPPING;',
        'o.viewMode = ViewType.TRACINGVIEWVECTOROUTLINES;',
        'o.palette = "Document Library";',
        'o.colorGroup = "All";',
        'o.tracingColors = 12;',
        'o.colorFidelity = 80;',
        'o.grayLevels = 40;',
        'o.threshold = 128;',
        'o.pathFidelity = 60;',
        'o.cornerFidelity = 30;',
        'o.noiseFidelity = 8;',
        'o.maxStrokeWeight = 2.5;',
        'o.fills = true;',
        'o.strokes = true;',
        'o.snapCurveToLines = true;',
        'o.ignoreWhite = true;',
    ]) assert.ok(full.includes(line), line);
    // The preset loads first so the options override it; expanding comes after the redraw.
    assert.ok(full.indexOf('loadFromPreset') < full.indexOf('o.tracingMode = '));
    assert.ok(full.indexOf('app.redraw();\n  var info') < full.indexOf('p.tracing.expandTracing()'));
});

test('trace options are checked before anything runs', async () => {
    await assert.rejects(call('trace_image', { target: { selection: true }, mode: 'sepia' }), /Allowed: color, grayscale, black_and_white/);
    await assert.rejects(call('trace_image', { target: { selection: true }, threshold: 300 }), /out of range/);
    await assert.rejects(call('trace_image', { target: { selection: true }, colors: 2.5 }), /whole number/);
    await assert.rejects(call('trace_image', { target: { selection: true }, fills: false, strokes: false }), /fills, strokes or both/);
    await assert.rejects(call('trace_image', { target: {} }), /Choose the items/);
    await assert.rejects(call('set_trace_options', { target: { selection: true } }), /Give a preset, at least one option, or savePreset/);
    await assert.rejects(call('set_trace_options', { target: { selection: true }, savePreset: '[Default]' }), /without brackets/);
});

test('trace presets are matched against Illustrator\'s list and can be saved', async () => {
    const [list, set] = await scriptsFor([
        ['list_tracing_presets', {}],
        ['set_trace_options', { target: { selection: true }, preset: '6 colors', savePreset: 'Poster' }],
    ]);
    assert.match(list, /app\.tracingPresetsList/);
    assert.doesNotMatch(list, /var doc = __doc\(\);/, 'listing presets needs no document');
    assert.match(set, /__tracings\(__targets/);
    assert.match(set, /storeToPreset\("Poster"\)/);
    assert.match(set, /function __tracePreset\(name\)/);
});

test('trace info, expand and release act on tracings only', async () => {
    const [info, expand, release] = await scriptsFor([
        ['get_trace_info', { target: { ids: ['5'] } }],
        ['expand_trace', { target: { ids: ['5'] }, asViewed: true }],
        ['release_trace', { target: { ids: ['5'] } }],
    ]);
    assert.match(info, /info\.paths = t\.pathCount; info\.anchors = t\.anchorCount; info\.colors = t\.usedColorCount;/);
    assert.match(info, /tracing\.sourceArt/);
    assert.match(expand, /tracing\.expandTracing\(true\)/);
    assert.match(release, /tracing\.releaseTracing\(\)/);
    for (const s of [info, expand, release]) assert.match(s, /t\.typename !== "PluginItem" \|\| !t\.isTracing/);
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['expand_trace', 'release_trace', 'delete_symbols', 'break_symbol_link']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['get_trace_info', 'list_tracing_presets', 'list_symbols']) assert.equal(byName[n].readOnlyHint, true, n);
});

test('symbols are made from a copy of the art and replace it with an instance', async () => {
    const [one, each] = await scriptsFor([
        ['create_symbol', { target: { selection: true }, name: 'Leaf', registration: 'bottomLeft' }],
        ['create_symbol', { target: { ids: ['1', '2'] }, name: 'Leaf', each: true, replace: false }],
    ]);
    assert.match(one, /doc\.symbols\.add\(src, SymbolRegistrationPoint\.SYMBOLBOTTOMLEFTPOINT\)/);
    assert.match(one, /src = set\[0\]\.duplicate\(\)/);
    assert.match(one, /var inst = doc\.symbolItems\.add\(sym\);\n {4}inst\.move\(set\[0\], ElementPlacement\.PLACEBEFORE\);/);
    assert.match(one, /each = false, replace = true/);
    assert.match(each, /each = true, replace = false/);
    assert.match(each, /SymbolRegistrationPoint\.SYMBOLCENTERPOINT/);
    await assert.rejects(call('create_symbol', { target: { selection: true }, registration: 'middle' }), /Allowed: center/);
    await assert.rejects(call('create_symbol', { target: { selection: true }, name: '' }), /symbol name/);
});

test('instances: place, replace, select, break link', async () => {
    const [place, centre, replace, select, broken] = await scriptsFor([
        ['place_symbol', { symbol: 'Leaf', x: 10, y: 20, artboardIndex: 1, layer: 'Art', count: 3 }],
        ['place_symbol', { symbol: 'Leaf' }],
        ['replace_symbol', { target: { selection: true }, symbol: 'Star' }],
        ['select_symbol_instances', { symbols: ['Leaf', 'Star'], add: true }],
        ['break_symbol_link', { target: { selection: true } }],
    ]);
    assert.match(place, /lay\.symbolItems\.add\(sym\)/);
    assert.match(place, /p = __toDoc\(doc, ab, 10, 20\);/);
    assert.match(place, /i < 3;/);
    assert.match(centre, /\(ab\.left \+ ab\.right\) \/ 2/);
    assert.match(replace, /items\[i\]\.symbol = sym;/);
    assert.match(select, /list\[k\]\.selected = true/);
    assert.doesNotMatch(select, /doc\.selection = null/);
    assert.match(broken, /items\[j\]\.breakLink\(\)/);
    await assert.rejects(call('place_symbol', { symbol: 'Leaf', x: 10 }), /both x and y/);
    await assert.rejects(call('select_symbol_instances', { symbols: [] }), /at least one symbol/);
});

test('rename, duplicate and delete symbols', async () => {
    const [rename, dup, del, unused] = await scriptsFor([
        ['rename_symbol', { symbol: 'Leaf', newName: 'Maple' }],
        ['duplicate_symbol', { symbol: 'Leaf', newName: 'Leaf copy' }],
        ['delete_symbols', { symbols: ['Leaf'], instances: 'delete' }],
        ['delete_symbols', { unused: true }],
    ]);
    assert.match(rename, /sym\.name = "Maple";/);
    assert.match(dup, /inst\.breakLink\(\);/);
    assert.match(dup, /copy = doc\.symbols\.add\(art, SymbolRegistrationPoint\.SYMBOLCENTERPOINT\);/);
    assert.match(dup, /work\.remove\(\);/);
    assert.match(del, /mode = "delete"/);
    assert.match(del, /targets\[m\]\.remove\(\);/);
    assert.match(unused, /mode = "refuse"/);
    assert.match(unused, /var names = null/);
    await assert.rejects(call('delete_symbols', {}), /Give symbols/);
    await assert.rejects(call('delete_symbols', { symbols: ['A'], unused: true }), /Give symbols/);
    await assert.rejects(call('delete_symbols', { symbols: ['A'], instances: 'keep' }), /Allowed: refuse, delete, expand/);
});

test('symbol libraries: built-in ones by their menu command, files as symbol libraries', async () => {
    const { LIBRARIES } = await import('../src/tools/symbols.js');
    assert.equal(Object.keys(LIBRARIES).length, 28);
    assert.equal(LIBRARIES['3d_symbols'].command, '_Base Library Menu Item 0');
    assert.equal(LIBRARIES.web_icons.command, '_Base Library Menu Item 27');
    const file = path.join(home, 'Documents', 'Leaves.ai');
    const [builtIn, other, save] = await scriptsFor([
        ['open_symbol_library', { library: 'hair_and_fur' }],
        ['open_symbol_library', { filePath: file }],
        ['save_symbol_library', { filePath: file, symbols: ['Leaf'] }],
    ]);
    assert.match(builtIn, /app\.executeMenuCommand\("_Base Library Menu Item 11"\);/);
    assert.match(other, /o\.openAs = LibraryType\.SYMBOLS;\napp\.open\(f, null, o\);/);
    assert.match(save, /temp\[i\]\.duplicate\(lib, ElementPlacement\.PLACEATEND\)/);
    assert.match(save, /lib\.saveAs\(new File\(/);
    assert.match(save, /lib\.close\(SaveOptions\.DONOTSAVECHANGES\);\n {2}doc\.activate\(\);/);
    await assert.rejects(call('open_symbol_library', {}), /Give library/);
    await assert.rejects(call('open_symbol_library', { library: 'arrows', filePath: file }), /Give library/);
    await assert.rejects(call('open_symbol_library', { library: 'cats' }), /Allowed: 3d_symbols/);
    await assert.rejects(call('open_symbol_library', { filePath: path.join(home, 'Documents', 'x.txt') }), /\.ai/);
    await assert.rejects(call('save_symbol_library', { filePath: '/etc/leaves.ai' }), /allowed|outside|home/i);
});
