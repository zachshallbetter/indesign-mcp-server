/**
 * Layers panel commands, Layer Options and artboard commands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions } from '../src/server.js';
import { scriptsFor, server } from './helpers.js';

const annotations = (name) => toolDefinitions.find((t) => t.name === name).annotations;

test('Layers panel commands are done through the object model', async () => {
    const [merge, flatten, discard, collectItems, collectLayers, seq, build, group, reverse] = await scriptsFor([
        ['organize_layers', { command: 'merge', layers: ['A', 'B', 'C'] }],
        ['organize_layers', { command: 'flatten', layer: 'A' }],
        ['organize_layers', { command: 'flatten', hiddenLayers: 'discard' }],
        ['organize_layers', { command: 'collect', target: { selection: true }, name: 'Badges' }],
        ['organize_layers', { command: 'collect', layers: ['A', 'B'] }],
        ['organize_layers', { command: 'release_sequence', layer: 'Frames' }],
        ['organize_layers', { command: 'release_build', layer: 'Frames' }],
        ['organize_layers', { command: 'release_sequence', target: { ids: ['g1'] } }],
        ['organize_layers', { command: 'reverse', layers: ['A', 'B', 'C'] }],
    ]);
    assert.match(merge, /__siblings\(doc, \["A","B","C"\], "Merge"\), target = ls\[ls\.length - 1\]/, 'merges into the last layer listed');
    assert.match(merge, /c\.move\(dest, ElementPlacement\.PLACEATEND\)/);
    assert.match(merge, /ls\[i\]\.remove\(\)/);
    assert.match(flatten, /__topLayer\(__findLayer\(doc, "A"\)\)/);
    assert.match(flatten, /is hidden: flatten into a visible layer/);
    assert.doesNotMatch(flatten, /discarded\.push/);
    assert.match(discard, /if \(!ls\[i\]\.visible\) \{ discarded\.push/);
    assert.match(collectItems, /var nl = home\.layers\.add\(\);\nnl\.name = "Badges";/);
    assert.match(collectLayers, /nl\.move\(ls\[0\], ElementPlacement\.PLACEBEFORE\)/);
    assert.match(seq, /__moveInto\(objs\[i\], nl, false\)/);
    assert.doesNotMatch(seq, /duplicate/);
    assert.match(build, /for \(j = i - 1; j >= 0; j--\) objs\[j\]\.duplicate\(nl, ElementPlacement\.PLACEATEND\)/, 'each frame holds every object below');
    assert.match(group, /picked\[0\]\.typename !== "GroupItem"/);
    assert.match(group, /src\.remove\(\)/);
    assert.match(reverse, /ls\[i\]\.move\(ls\[i - 1\], ElementPlacement\.PLACEBEFORE\)/);
    assert.equal(annotations('organize_layers').destructiveHint, true);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'merge', layers: ['A'] }), /at least 2 layer names/);
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'merge', layers: ['A', 'B'], name: 'x' }), /merge does not take name/);
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'collect' }), /target \(items\) or layers/);
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'release_build', layer: 'A', target: { selection: true } }), /not both/);
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'flatten', hiddenLayers: 'keep' }), /Allowed: include, discard/);
    await assert.rejects(mcp.handleToolCall('organize_layers', { command: 'split' }), /Allowed: merge/);
});

test('other layers, layer artwork selection and paste in front or back', async () => {
    const [hide, outline, select, front, back] = await scriptsFor([
        ['set_other_layers', { action: 'hide', target: { selection: true } }],
        ['set_other_layers', { action: 'outline', layers: ['Art'] }],
        ['select_layer_artwork', { layers: ['Art', 'Type'] }],
        ['paste_artwork', { placement: 'front', target: { ids: ['1'] } }],
        ['paste_artwork', { placement: 'back' }],
    ]);
    assert.match(hide, /keep\.push\(__topLayer\(items\[i\]\.layer\)\)/);
    assert.match(hide, /l\.visible = false;/);
    assert.match(outline, /l\.preview = false;/);
    assert.match(select, /l\.hasSelectedArtwork = true;/);
    assert.match(select, /doc\.selection = null;/);
    assert.match(front, /app\.copy\(\);\s+app\.executeMenuCommand\("pasteFront"\);/);
    assert.match(back, /app\.executeMenuCommand\("pasteBack"\);/);
    assert.doesNotMatch(back, /app\.copy/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_other_layers', { action: 'hide' }), /layers or target/);
    await assert.rejects(mcp.handleToolCall('set_other_layers', { action: 'delete', layers: ['A'] }), /Allowed: hide/);
    await assert.rejects(mcp.handleToolCall('select_layer_artwork', { layers: [] }), /one or more layer names/);
    await assert.rejects(mcp.handleToolCall('paste_artwork', { placement: 'in_place' }), /Allowed: front, back/);
});

test('Layer Options, knockout and Send to Current Layer extend the layer tools', async () => {
    const [create, props, send] = await scriptsFor([
        ['create_layer', { name: 'Trace', color: '#00A651', preview: false, dimPlacedImages: true }],
        ['set_layer_properties', { layer: 'Trace', color: 'rgb(255,0,255)', knockout: 'enabled' }],
        ['move_items_to_layer', { target: { selection: true } }],
    ]);
    assert.match(create, /lc\.red = 0; lc\.green = 166; lc\.blue = 81; l\.color = lc;/);
    assert.match(create, /l\.preview = false;/);
    assert.match(create, /l\.dimPlacedImages = true;/);
    assert.match(props, /l\.artworkKnockout = KnockoutState\.ENABLED;/);
    assert.match(send, /__layer\(doc, ""\)/, 'no layer: the active layer');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_layer_properties', { layer: 'A', color: 'cmyk(0,0,0,100)' }), /#RRGGBB/);
    await assert.rejects(mcp.handleToolCall('set_layer_properties', { layer: 'A', knockout: 'on' }), /Allowed: enabled/);
});

test('artboards: copy, delete empty, align, reorder, convert', async () => {
    const [dup, cut, other, empty, dry, align, dist, order, move, convert] = await scriptsFor([
        ['copy_artboard', { artboardIndex: 1 }],
        ['copy_artboard', { artboardIndex: 0, cut: true, x: 0, y: 900 }],
        ['copy_artboard', { artboardIndex: 0, toDocument: 'Other.ai', withArtwork: false }],
        ['delete_empty_artboards', {}],
        ['delete_empty_artboards', { dryRun: true }],
        ['align_artboards', { align: 'top' }],
        ['align_artboards', { artboards: [0, 2, 3], distribute: 'vertical', spacing: 36, moveArtwork: false }],
        ['reorder_artboards', { order: [2, 0, 1] }],
        ['reorder_artboards', { artboardIndex: 3, toIndex: 0 }],
        ['convert_to_artboards', { target: { selection: true } }],
    ]);
    assert.match(dup, /dest\.artboards\.add\(\[left, top, left \+ w, top - h\]\)/);
    assert.match(dup, /art\[k\]\.duplicate\(art\[k\], ElementPlacement\.PLACEBEFORE\)/);
    assert.doesNotMatch(dup, /doc\.artboards\.remove/);
    assert.match(cut, /art\[m\]\.remove\(\);/);
    assert.match(cut, /doc\.artboards\.remove\(i\);/);
    assert.match(other, /app\.documents\.getByName\("Other\.ai"\)/);
    assert.match(other, /false \? __artOn/);
    assert.match(empty, /doc\.artboards\.remove\(empty\[i\]\.index\)/);
    assert.match(empty, /if \(empty\.length === doc\.artboards\.length\) empty\.shift\(\);/, 'one artboard always remains');
    assert.doesNotMatch(dry, /artboards\.remove/);
    assert.match(align, /move\(i, 0, T - r\[1\]\)/);
    assert.match(dist, /__boards\(doc, \[0,2,3\]\)/);
    assert.match(dist, /var gap = __len\(doc, 36\)/);
    assert.match(order, /var order = \[2,0,1\]/);
    assert.match(order, /doc\.artboards\.insert\(p\.rect, k\);/);
    assert.match(move, /__moveTo\(doc\.artboards\.length, 3, 0\)/);
    assert.match(convert, /app\.executeMenuCommand\("setCropMarks"\);/);
    for (const n of ['copy_artboard', 'delete_empty_artboards', 'convert_to_artboards']) assert.equal(annotations(n).destructiveHint, true, n);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('copy_artboard', { artboardIndex: 0, x: 10 }), /both x and y/);
    await assert.rejects(mcp.handleToolCall('align_artboards', {}), /align, distribute or both/);
    await assert.rejects(mcp.handleToolCall('align_artboards', { align: 'top', spacing: 10 }), /applies with distribute/);
    await assert.rejects(mcp.handleToolCall('align_artboards', { align: 'top', artboards: [1] }), /at least 2 artboard/);
    await assert.rejects(mcp.handleToolCall('reorder_artboards', { order: [0, 0] }), /listed twice/);
    await assert.rejects(mcp.handleToolCall('reorder_artboards', { artboardIndex: 1 }), /artboardIndex with toIndex/);
});

test('artboard size, orientation, fit and scaling extend the artboard tools', async () => {
    const [turn, scaled, bounds, selected] = await scriptsFor([
        ['set_artboard', { artboardIndex: 0, orientation: 'landscape' }],
        ['set_artboard', { artboardIndex: 0, width: 400, scaleArtwork: true }],
        ['fit_artboard_to_artwork', { artboardIndex: 2 }],
        ['fit_artboard_to_artwork', { artboardIndex: 0, target: { selection: true } }],
    ]);
    assert.match(turn, /if \(h > w\) \{ var t = w; w = h; h = t; \}/);
    assert.doesNotMatch(turn, /__scaleArt/);
    assert.match(scaled, /var art = __artOn\(doc, old, true\);/);
    assert.match(scaled, /skipped = __scaleArt\(art, old, nr\);/);
    assert.match(scaled, /Transformation\.TOPLEFT/);
    assert.match(bounds, /app\.executeMenuCommand\("Fit Artboard to artwork bounds"\);/);
    assert.match(selected, /doc\.fitArtboardToSelectedArt\(i\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_artboard', { artboardIndex: 0, scaleArtwork: true }), /scaleArtwork' applies/);
    await assert.rejects(mcp.handleToolCall('set_artboard', { artboardIndex: 0, orientation: 'upright' }), /Allowed: portrait/);
});

test('artboard display options and views', async () => {
    const [display, read, fit, zoom] = await scriptsFor([
        ['set_artboard_display', { artboards: [0, 1], showCenter: true, showCrossHairs: false, showSafeAreas: true, rulerPixelAspectRatio: 0.9, rulerOrigin: { x: 0, y: 72 }, borderColor: '#FF0000', borderWidth: 3, showNames: false, toggleArtboards: true, toggleVideoRulers: true }],
        ['set_artboard_display', {}],
        ['view_artboard', { artboardIndex: 1, fit: 'all' }],
        ['view_artboard', { artboardIndex: 0, zoom: 2 }],
    ]);
    for (const s of ['ab.showCenter = true;', 'ab.showCrossHairs = false;', 'ab.showSafeAreas = true;', 'ab.rulerPAR = 0.9;', 'ab.rulerOrigin = [__len(doc, 0), __len(doc, 72)];']) assert.ok(display.includes(s), s);
    assert.match(display, /setRealPreference\("ArtboardBBColorRed", 1\)/);
    assert.match(display, /setRealPreference\("ArtboardBBWidth", 3\)/);
    assert.match(display, /setBooleanPreference\("showArtboardLabelOnCanvas", false\)/);
    assert.match(display, /executeMenuCommand\("artboard"\);/);
    assert.match(display, /executeMenuCommand\("videoruler"\);/);
    assert.doesNotMatch(read, /ab\.show\w+ =|setRealPreference|executeMenuCommand/, 'no options: a report');
    assert.match(fit, /executeMenuCommand\("fitall"\)/);
    assert.match(zoom, /v\.zoom = 2;/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_artboard_display', { borderWidth: 6 }), /1 to 4/);
    await assert.rejects(mcp.handleToolCall('set_artboard_display', { borderColor: 'Black' }), /#RRGGBB/);
    await assert.rejects(mcp.handleToolCall('set_artboard_display', { rulerPixelAspectRatio: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('view_artboard', { artboardIndex: 0, fit: 'all', zoom: 1 }), /fit or zoom/);
});
