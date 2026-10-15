import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scriptsFor, server, home } from './helpers.js';
import { toolDefinitions } from '../src/server.js';
import { STYLE_LIBRARIES } from '../src/tools/styles.js';

const sel = { selection: true };
const KNOWN_COMMANDS = new Set(JSON.parse(readFileSync(new URL('../src/data/menu-commands.json', import.meta.url), 'utf8')).commands.map((c) => c.id));

test('graphic styles are applied, merged, renamed, deleted and saved through ArtStyle', async () => {
    const [list, apply, merge, rename, del, save] = await scriptsFor([
        ['list_graphic_styles', {}],
        ['apply_graphic_style', { target: sel, style: 'Glow' }],
        ['apply_graphic_style', { target: { ids: ['1'] }, style: 'Glow', merge: true }],
        ['rename_graphic_style', { name: 'Glow', newName: 'Soft glow' }],
        ['delete_graphic_styles', { names: ['Glow', 'Old'] }],
        ['save_graphic_style_library', { filePath: `${home}/Documents/brand-styles.ai` }],
    ]);
    assert.match(list, /doc\.graphicStyles\[i\]\.name/);
    assert.match(apply, /st\.applyTo\(items\[i\]\);/);
    assert.match(merge, /st\.mergeTo\(items\[i\]\);/);
    assert.match(rename, /st\.name = "Soft glow";/);
    assert.match(del, /styles\[j\]\.remove\(\);/);
    assert.match(save, /doc\.writeAsLibrary\(f, LibraryType\.GRAPHICSTYLES\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_graphic_style', { target: sel }), /Give 'style'/);
    await assert.rejects(mcp.handleToolCall('rename_graphic_style', { name: 'Glow', newName: ' ' }), /newName/);
    await assert.rejects(mcp.handleToolCall('delete_graphic_styles', { names: [] }), /Give 'names'/);
    await assert.rejects(mcp.handleToolCall('save_graphic_style_library', { filePath: `${home}/Documents/styles.txt` }), /must end in \.ai/);
    await assert.rejects(mcp.handleToolCall('save_graphic_style_library', { filePath: '/etc/styles.ai' }));
});

test('graphic style libraries open by their Window menu commands', async () => {
    const calls = [['open_graphic_styles', {}], ...Object.keys(STYLE_LIBRARIES).map((library) => ['open_graphic_styles', { library }])];
    const sent = await scriptsFor(calls);
    assert.ok(sent[0].includes('app.executeMenuCommand("Adobe Style Palette");'));
    Object.values(STYLE_LIBRARIES).forEach((command, i) => {
        assert.ok(KNOWN_COMMANDS.has(command), command);
        assert.ok(sent[i + 1].includes(`app.executeMenuCommand("${command}");`), command);
    });
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_graphic_styles', { library: 'other_library' }), /Allowed: 3d_effects/);
});

test('fills and strokes are added one item at a time', async () => {
    const [fill, strokes] = await scriptsFor([
        ['add_appearance_attribute', { target: sel, attribute: 'fill' }],
        ['add_appearance_attribute', { target: { ids: ['1', '2'] }, attribute: 'stroke', count: 3 }],
    ]);
    assert.match(fill, /for \(var n = 0; n < 1; n\+\+\) app\.executeMenuCommand\("Adobe New Fill Shortcut"\);/);
    assert.match(strokes, /for \(var n = 0; n < 3; n\+\+\) app\.executeMenuCommand\("Adobe New Stroke Shortcut"\);/);
    assert.match(strokes, /doc\.selection = null;\n {2}items\[i\]\.selected = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_appearance_attribute', { target: sel, attribute: 'effect' }), /Allowed: fill, stroke/);
    await assert.rejects(mcp.handleToolCall('add_appearance_attribute', { target: sel, attribute: 'fill', count: 11 }), /count/);
});

test('knockout and isolate blending are set on items and layers', async () => {
    const [items, layers] = await scriptsFor([
        ['set_transparency_group', { target: sel, knockout: 'on', isolateBlending: true }],
        ['set_transparency_group', { layers: ['Art'], knockout: 'inherit' }],
    ]);
    assert.match(items, /o\.artworkKnockout = KnockoutState\.ENABLED;/);
    assert.match(items, /o\.isIsolated = true;/);
    assert.match(layers, /objs\.push\(__layer\(doc, layerNames\[l\]\)\)/);
    assert.match(layers, /KnockoutState\.INHERITED/);
    assert.doesNotMatch(layers, /isIsolated = /);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_transparency_group', { target: sel }), /Give knockout, isolateBlending or both/);
    await assert.rejects(mcp.handleToolCall('set_transparency_group', { knockout: 'on' }), /Choose what to change/);
    await assert.rejects(mcp.handleToolCall('set_transparency_group', { target: sel, knockout: 'yes' }), /Allowed: on, off, inherit/);
});

test('view toggles run their View menu commands', async () => {
    const [grid, gaps] = await scriptsFor([
        ['toggle_view_option', { option: 'transparency_grid' }],
        ['toggle_view_option', { option: 'live_paint_gaps' }],
    ]);
    assert.ok(grid.includes('app.executeMenuCommand("TransparencyGrid Menu Item");'));
    assert.ok(gaps.includes('app.executeMenuCommand("Show Gaps Planet X");'));
});

test('Live Paint groups are made, merged, released and expanded on exactly the targets', async () => {
    const [make, merge, release, expand] = await scriptsFor([
        ['make_live_paint', { target: sel }],
        ['make_live_paint', { target: { ids: ['p1'] }, into: { ids: ['lp'] } }],
        ['release_live_paint', { target: { ids: ['lp'] } }],
        ['expand_live_paint', { target: { ids: ['lp'] } }],
    ]);
    assert.ok(make.includes('app.executeMenuCommand("Make Planet X");'));
    assert.ok(merge.includes('app.executeMenuCommand("Marge Planet X");'));
    assert.match(merge, /'into' must be one Live Paint group/);
    assert.ok(release.includes('app.executeMenuCommand("Release Planet X");'));
    assert.ok(expand.includes('app.executeMenuCommand("Expand Planet X");'));
    assert.match(expand, /not a Live Paint group/);
    for (const s of [make, merge, release, expand]) assert.doesNotMatch(s, /Planet X Options/, 'Gap Options opens a dialog');
});

test('default fill and stroke are read and set on the document', async () => {
    const [get, reset, custom] = await scriptsFor([
        ['get_default_fill_stroke', {}],
        ['set_default_fill_stroke', { reset: true }],
        ['set_default_fill_stroke', { fill: 'none', stroke: '#FF0000', strokeWeight: 2, cap: 'round', dashes: [6, 3], strokeOverprint: true }],
    ]);
    assert.match(get, /d\.fillActive = app\.isFillActive\(\);/);
    assert.match(reset, /doc\.defaultFillColor = __white\(doc\);/);
    assert.match(reset, /doc\.defaultStrokeColor = __black\(doc\); doc\.defaultStrokeWidth = __len\(doc, 1\);/);
    assert.match(custom, /doc\.defaultFilled = false;/);
    assert.match(custom, /doc\.defaultStrokeCap = StrokeCap\.ROUNDENDCAP;/);
    assert.match(custom, /doc\.defaultStrokeDashes = \[6,3\];/);
    assert.match(custom, /doc\.defaultStrokeOverprint = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_default_fill_stroke', {}), /Give reset or at least one/);
    await assert.rejects(mcp.handleToolCall('set_default_fill_stroke', { join: 'square' }), /Allowed: miter, round, bevel/);
    await assert.rejects(mcp.handleToolCall('set_default_fill_stroke', { dashes: [1, 2, 3, 4, 5, 6, 7] }), /at most 6/);
});

test('swap and reset change each path\'s fill and stroke', async () => {
    const [swap, reset] = await scriptsFor([
        ['swap_fill_stroke', { target: sel }],
        ['reset_fill_stroke', { target: { ids: ['1'] } }],
    ]);
    assert.match(swap, /if \(s\) \{ p\.filled = true; p\.fillColor = s; \} else p\.filled = false;/);
    assert.match(swap, /if \(f\) \{ p\.stroked = true; p\.strokeColor = f; \} else p\.stroked = false;/);
    assert.match(reset, /p\.fillColor = w;/);
    assert.match(reset, /p\.strokeColor = k; p\.strokeWidth = __len\(doc, 1\); p\.strokeDashes = \[\];/);
});

test('style tools are annotated', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['list_graphic_styles', 'get_default_fill_stroke']) assert.equal(byName[n].readOnlyHint, true, n);
    for (const n of ['delete_graphic_styles', 'release_live_paint', 'expand_live_paint']) assert.equal(byName[n].destructiveHint, true, n);
});
