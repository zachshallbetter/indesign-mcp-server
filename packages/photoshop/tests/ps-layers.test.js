/**
 * Layer commands, masks, smart objects and layer styles: generated scripts
 * carry the right object-model and Action Manager statements, and bad
 * arguments are refused before anything reaches Photoshop.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';
import { EFFECTS } from '../src/tools/layer-styles.js';

const docs = `${home}/Documents`;

test('layer commands play the Layers-panel events', async () => {
    const [via, cut, stamp, sel, add, all, none, linked, similar, find, hidden, raster, lock, unlock, link, isolate, end, collapse, reverse, defringe, matte, decon, css, svg] = await scriptsFor([
        ['new_layer_via', { method: 'copy', name: 'Copy' }],
        ['new_layer_via', { method: 'cut', target: { ids: [3] } }],
        ['new_layer_via', { method: 'stamp_visible' }],
        ['set_layer_selection', { action: 'set', target: { ids: [3, 4] } }],
        ['set_layer_selection', { action: 'add', target: { names: ['Logo'] } }],
        ['set_layer_selection', { action: 'all' }],
        ['set_layer_selection', { action: 'none' }],
        ['set_layer_selection', { action: 'linked', target: { ids: [3] } }],
        ['set_layer_selection', { action: 'similar' }],
        ['set_layer_selection', { action: 'find', query: 'Title' }],
        ['process_all_layers', { action: 'delete_hidden' }],
        ['process_all_layers', { action: 'rasterize_all' }],
        ['lock_layers', { target: { ids: [5] }, locks: ['position', 'transparency'], includeGroupContents: true }],
        ['lock_layers', { target: { ids: [5] }, locks: [] }],
        ['set_layer_link_enabled', { target: { ids: [5] }, enabled: false }],
        ['set_layers_panel_view', { action: 'isolate', target: { ids: [5, 6] } }],
        ['set_layers_panel_view', { action: 'end_isolation' }],
        ['set_layers_panel_view', { action: 'collapse_groups' }],
        ['reverse_layer_order', { target: { ids: [5, 6, 7] } }],
        ['apply_matting', { method: 'defringe', width: 3 }],
        ['apply_matting', { method: 'remove_white_matte' }],
        ['apply_matting', { method: 'color_decontaminate' }],
        ['copy_layer_code', { format: 'css' }],
        ['copy_layer_code', { format: 'svg', target: { ids: [9] } }],
    ]);
    assert.match(via, /__play\("copyToLayer"\);[\s\S]*l\.name = "Copy";/);
    assert.match(cut, /Layer via Cut needs a selection[\s\S]*__play\("cutToLayer"\);/);
    assert.match(stamp, /d\.putBoolean\(__s\("duplicate"\), true\); __play\("mergeVisible", d\);/);
    assert.match(sel, /__selectLayers\(items, false\);/);
    assert.match(add, /__selectLayers\(items, true\);/);
    assert.match(all, /__play\("selectAllLayers", __onTarget\(\)\);/);
    assert.match(none, /__play\("selectNoLayers", __onTarget\(\)\);/);
    assert.match(linked, /__play\("selectLinkedLayers", __onTarget\(\)\);/);
    assert.match(similar, /__play\("selectSimilarLayers", __onTarget\(\)\);/);
    assert.match(find, /var q = "title"[\s\S]*indexOf\(q\)/);
    assert.match(hidden, /r\.putEnumerated\(__s\("layer"\), __s\("ordinal"\), __s\("hidden"\)\);[\s\S]*__play\("delete", d\);/);
    assert.match(raster, /doc\.rasterizeAllLayers\(\);/);
    assert.match(lock, /lk\.putBoolean\(__s\("protectPosition"\), true\);\n {2}lk\.putBoolean\(__s\("protectTransparency"\), true\);[\s\S]*__play\("applyLocking", d\);/);
    assert.match(lock, /__eachLayer\(items\[i\]/);
    assert.match(unlock, /protectNone/);
    assert.match(link, /__play\("disableLayerLink", __onTarget\(\)\);/);
    assert.match(isolate, /__play\("isolateLayers"\);/);
    assert.match(end, /__play\("deIsolateLayers"\);/);
    assert.match(collapse, /__play\("collapseAllGroupsEvent"\);/);
    assert.match(reverse, /__play\("reverse", __onTarget\(\)\);/);
    assert.match(defringe, /putUnitDouble\(__s\("width"\), __s\("pixelsUnit"\), 3\); __play\("defringe", d\);/);
    assert.match(matte, /__play\("removeWhiteMatte"\);/);
    assert.match(decon, /__play\("decontaminate"\);/);
    assert.match(css, /__play\("copyLayerCSS", __onTarget\(\)\);/);
    assert.match(svg, /__play\("copyLayerSVG", __onTarget\(\)\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('new_layer_via', { method: 'paste' }), /Invalid value for 'method'/);
    await assert.rejects(mcp.handleToolCall('set_layer_selection', { action: 'find' }), /needs query/);
    await assert.rejects(mcp.handleToolCall('set_layer_selection', { action: 'set' }), /needs target/);
    await assert.rejects(mcp.handleToolCall('lock_layers', { target: { ids: [1] }, locks: 'all' }), /must be a list/);
    await assert.rejects(mcp.handleToolCall('lock_layers', { target: { ids: [1] }, locks: ['everything'] }), /Invalid value for 'locks'/);
    await assert.rejects(mcp.handleToolCall('apply_matting', { method: 'remove_black_matte', width: 2 }), /'width' is for defringe/);
    await assert.rejects(mcp.handleToolCall('apply_matting', { method: 'defringe', width: 500 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_layer_link_enabled', { target: { ids: [1] } }), /true or false/);
});

test('layer comps step, duplicate, edit options and clear warnings', async () => {
    const [next, prev, opts, dup, restore, clear, clearAll] = await scriptsFor([
        ['layer_comps', { action: 'next' }],
        ['layer_comps', { action: 'previous' }],
        ['layer_comps', { action: 'options', name: 'A', newName: 'B', visibility: false }],
        ['layer_comps', { action: 'duplicate', name: 'A', newName: 'A2' }],
        ['layer_comps', { action: 'restore_last_state' }],
        ['layer_comps', { action: 'clear_warning', name: 'A' }],
        ['layer_comps', { action: 'clear_warning' }],
    ]);
    assert.match(next, /\(cur \+ 1 \+ n\) % n;\ndoc\.layerComps\[at\]\.apply\(\);/);
    assert.match(prev, /cur < 0 \? n - 1/);
    assert.match(opts, /c\.name = "B";\nc\.visibility = false;/);
    assert.match(dup, /cr\.putName\(__s\("compsClass"\), "A"\);[\s\S]*__play\("duplicate", cd\);[\s\S]*copy\.name = "A2";/);
    assert.match(restore, /__play\("resetFromComp"\);/);
    assert.match(clear, /__play\("clearWarning", cd\);/);
    assert.match(clearAll, /cr\.putName\(__s\("compsClass"\), doc\.layerComps\[i\]\.name\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('layer_comps', { action: 'options', name: 'A' }), /'options' needs/);
    await assert.rejects(mcp.handleToolCall('layer_comps', { action: 'duplicate' }), /needs name/);
});

test('masks: layer, vector, clipping, quick mask and refinement', async () => {
    const s = await scriptsFor([
        ['edit_layer_mask', { action: 'add', reveal: 'hide_all' }],
        ['edit_layer_mask', { action: 'add' }],
        ['edit_layer_mask', { action: 'apply', target: { ids: [4] } }],
        ['edit_layer_mask', { action: 'delete' }],
        ['edit_layer_mask', { action: 'disable' }],
        ['edit_layer_mask', { action: 'unlink' }],
        ['edit_layer_mask', { action: 'invert' }],
        ['edit_layer_mask', { action: 'target_mask', showAlone: true }],
        ['edit_layer_mask', { action: 'target_layer' }],
        ['edit_layer_mask', { action: 'load_selection', invert: true }],
        ['edit_layer_mask', { action: 'move_to', target: { ids: [4] }, to: 9 }],
        ['set_mask_properties', { mask: 'vector', density: 80, feather: 2.5 }],
        ['set_mask_properties', { mask: 'filter', feather: 10 }],
        ['edit_vector_mask', { action: 'create_from_path' }],
        ['edit_vector_mask', { action: 'disable' }],
        ['edit_vector_mask', { action: 'delete' }],
        ['set_clipping_mask', { target: { ids: [5] }, action: 'create' }],
        ['set_clipping_mask', { target: { ids: [5] }, action: 'release' }],
        ['set_quick_mask', { enabled: true }],
        ['refine_mask', { radius: 4, smartRadius: true, shiftEdge: -20 }],
        ['mask_by_color_range', { colors: 'skin_tones', invert: true }],
        ['mask_by_color_range', { color: 'rgb(200,40,40)', fuzziness: 80 }],
    ]);
    const [hideAll, addDefault, apply, del, disable, unlink, invert, targetMask, targetLayer, load, move, vprops, fprops, vcreate, vdisable, vdelete, clip, release, quick, refine, skin, sampled] = s;
    assert.match(hideAll, /__addMask\(l, "hideAll"\);/);
    assert.match(addDefault, /__addMask\(l, __hasSelection\(\) \? "revealSelection" : "revealAll"\);/);
    assert.match(apply, /__dropMask\(l, true\);/);
    assert.match(del, /__dropMask\(l, false\);/);
    assert.match(disable, /to\.putBoolean\(__s\("userMaskEnabled"\), false\); __setLayer\(l\.id, to\);/);
    assert.match(unlink, /userMaskLinked"\), false/);
    assert.match(invert, /__targetChannel\(true, false\); __play\("invert"\); __targetChannel\(false, false\);/);
    assert.match(targetMask, /__targetChannel\(true, true\);/);
    assert.match(targetLayer, /__targetChannel\(false, false\);/);
    assert.match(load, /__loadMask\(l\); doc\.selection\.invert\(\);/);
    assert.match(move, /var dest = __layerById\(doc, 9\);[\s\S]*__copyMask\(l, true\);/);
    assert.match(vprops, /l\.vectorMaskDensity = 80;\n {2}l\.vectorMaskFeather = 2\.5;/);
    assert.match(fprops, /l\.filterMaskFeather = 10;/);
    assert.match(vcreate, /src\.putEnumerated\(__s\("path"\), __s\("ordinal"\), __s\("targetEnum"\)\);[\s\S]*__play\("make", d\);/);
    assert.match(vdisable, /vectorMaskEnabled"\), false/);
    assert.match(vdelete, /vr\.putEnumerated\(__s\("path"\), __s\("path"\), __s\("vectorMask"\)\);[\s\S]*__play\("delete", d\);/);
    assert.match(clip, /l\.grouped = true;[\s\S]*__play\("groupEvent", __onTarget\(\)\);/);
    assert.match(release, /l\.grouped = false;[\s\S]*__play\("ungroup", __onTarget\(\)\);/);
    assert.match(quick, /doc\.quickMaskMode = true;/);
    assert.match(refine, /smartBrushRadius"\), __s\("pixelsUnit"\), 4\);[\s\S]*smartBrushShiftEdge"\), __s\("percentUnit"\), -20\);[\s\S]*selectionOutputToUserMask/);
    assert.match(skin, /__s\("colors"\), __s\("colors"\), __s\("skinTone"\)\);\nd\.putBoolean\(__s\("invert"\), true\);/);
    assert.match(sampled, /d\.putInteger\(__s\("fuzziness"\), 80\);[\s\S]*__play\("colorRange", d\);[\s\S]*__addMask\(l, "revealSelection"\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_layer_mask', { action: 'copy_to' }), /needs to/);
    await assert.rejects(mcp.handleToolCall('edit_layer_mask', { action: 'apply', reveal: 'hide_all' }), /'reveal' is for add/);
    await assert.rejects(mcp.handleToolCall('edit_layer_mask', { action: 'apply', to: 3 }), /'to' is for/);
    await assert.rejects(mcp.handleToolCall('set_mask_properties', { mask: 'layer' }), /Give density/);
    await assert.rejects(mcp.handleToolCall('set_mask_properties', { density: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('edit_vector_mask', { action: 'delete', path: 'Path 1' }), /'path' is for/);
    await assert.rejects(mcp.handleToolCall('set_clipping_mask', { target: { ids: [1] }, action: 'toggle' }), /Invalid value/);
    await assert.rejects(mcp.handleToolCall('set_quick_mask', {}), /true or false/);
    await assert.rejects(mcp.handleToolCall('mask_by_color_range', {}), /needs color/);
    await assert.rejects(mcp.handleToolCall('mask_by_color_range', { colors: 'reds', fuzziness: 20 }), /for sampled/);
});

test('smart objects: convert, edit, files, comps, stacks and smart filters', async () => {
    const s = await scriptsFor([
        ['convert_to_smart_object', { target: { ids: [2, 3] }, name: 'Bundle' }],
        ['get_smart_object_info', {}],
        ['edit_smart_object', { action: 'new_copy' }],
        ['edit_smart_object', { action: 'edit_contents' }],
        ['edit_smart_object', { action: 'replace_contents', file: `${docs}/logo.pdf`, page: 2 }],
        ['edit_smart_object', { action: 'export_contents', file: `${docs}/out.psb` }],
        ['edit_smart_object', { action: 'relink', file: `${docs}/logo.ai` }],
        ['edit_smart_object', { action: 'convert_to_linked', file: `${docs}/linked.psb` }],
        ['edit_smart_object', { action: 'update_all' }],
        ['edit_smart_object', { action: 'embed_all' }],
        ['edit_smart_object', { action: 'reset_transform' }],
        ['edit_smart_object', { action: 'convert_to_layers' }],
        ['edit_smart_object', { action: 'set_layer_comp', comp: 'Dark' }],
        ['set_stack_mode', { target: { ids: [2, 3, 4] }, mode: 'median' }],
        ['set_smart_filter_visibility', { visible: false }],
        ['set_smart_filter_visibility', { visible: true, index: 2 }],
    ]);
    const [conv, info, copy, edit, replace, exp, relink, linked, updAll, embAll, reset, unpack, comp, stack, hideAll, showOne] = s;
    assert.match(conv, /__selectLayers\(items, false\);\n__play\("newPlacedLayer"\);\nvar l = doc\.activeLayer;\nl\.name = "Bundle";/);
    assert.match(info, /__soInfo\(items\[i\]\)/);
    assert.match(copy, /__play\("placedLayerMakeCopy"\);/);
    assert.match(edit, /__play\("placedLayerEditContents"\);[\s\S]*opened:/);
    assert.match(replace, /d\.putPath\(__s\("null"\), f\); d\.putInteger\(__s\("pageNumber"\), 2\); __play\("placedLayerReplaceContents", d\);/);
    assert.match(replace, /File not found/);
    assert.match(exp, /__play\("placedLayerExportContents", d\);/);
    assert.match(relink, /__play\("placedLayerRelinkToFile", d\);/);
    assert.match(linked, /d\.putPath\(__s\("using"\), f\); __play\("placedLayerConvertToLinked", d\);/);
    assert.match(updAll, /__play\("placedLayerUpdateAllModified"\);/);
    assert.doesNotMatch(updAll, /is not a smart object"\);\ndoc\.activeLayer/);
    assert.match(embAll, /__play\("placedLayerEmbedAll"\);/);
    assert.match(reset, /__play\("placedLayerResetTransforms"\);/);
    assert.match(unpack, /__play\("placedLayerConvertToLayers"\);/);
    assert.match(comp, /comps\[i\]\.name === "Dark"[\s\S]*d\.putInteger\(__s\("compID"\), id\); __play\("setPlacedLayerComp", d\);/);
    assert.match(stack, /__play\("newPlacedLayer"\);[\s\S]*d\.putClass\(__s\("imageStackPlugin"\), __c\("medn"\)\);[\s\S]*__play\("applyImageStackPluginRenderer", d\);/);
    assert.match(hideAll, /which = null;[\s\S]*r\.putIndex\(__s\("filterFX"\), which\[k\]\);[\s\S]*__play\("hide", d\);/);
    assert.match(showOne, /which = \[2\];[\s\S]*__play\("show", d\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_smart_object', { action: 'replace_contents' }), /needs file/);
    await assert.rejects(mcp.handleToolCall('edit_smart_object', { action: 'embed', file: `${docs}/a.psd` }), /takes no file/);
    await assert.rejects(mcp.handleToolCall('edit_smart_object', { action: 'relink', file: '/etc/hosts' }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('edit_smart_object', { action: 'set_layer_comp' }), /needs comp/);
    await assert.rejects(mcp.handleToolCall('edit_smart_object', { action: 'relink', file: `${docs}/a.psd`, page: 1 }), /'page' is for/);
    await assert.rejects(mcp.handleToolCall('set_stack_mode', { mode: 'average' }), /Invalid value for 'mode'/);
    await assert.rejects(mcp.handleToolCall('set_smart_filter_visibility', { visible: true, index: 0 }), /out of range/);
});

test('layer effects build layerEffects descriptors, merging into the existing style', async () => {
    const [merge, replace, multi, remove, edit] = await scriptsFor([
        ['set_layer_effects', { effects: { dropShadow: { distance: 8, color: '#112233', knocksOut: false } } }],
        ['set_layer_effects', { target: { ids: [3] }, replace: true, effects: { bevelEmboss: { style: 'pillow_emboss', direction: 'down', contour: { points: [[0, 0], [128, 200], [255, 255]], range: 60 }, texture: { pattern: { name: 'Clouds' }, depth: -50 } }, satin: true } }],
        ['set_layer_effects', { effects: { stroke: [{ size: 2, position: 'inside' }, { size: 6, fill: 'gradient', gradient: ['#FF0000', '#0000FF'] }], colorOverlay: [{ color: '#00FF00' }, { color: '#0000FF', blendMode: 'multiply' }] } }],
        ['set_layer_effects', { effects: { outerGlow: false, innerShadow: { enabled: false } } }],
        ['set_layer_effects', { effects: { dropShadow: { instance: 1, opacity: 40 }, patternOverlay: { pattern: { name: 'Gravel' }, scale: 200 }, gradientOverlay: { style: 'angle', gradient: ['#000000', '#FFFFFF', '#000000'] }, innerGlow: { source: 'center', technique: 'precise' } } }],
    ]);
    assert.match(merge, /var fx = __fxOf\(l\.id\);/);
    assert.match(merge, /e\.putUnitDouble\(__s\("distance"\), __s\("pixelsUnit"\), 8\);/);
    assert.match(merge, /e\.putBoolean\(__s\("layerConceals"\), false\);/);
    assert.match(merge, /if \(isNew\) \{[\s\S]*e\.putEnumerated\(__s\("mode"\), __s\("blendMode"\), __s\("multiply"\)\);[\s\S]*\}/);
    assert.doesNotMatch(merge, /putUnitDouble\(__s\("distance"\), __s\("pixelsUnit"\), 5\)/);
    assert.match(merge, /__fxWrite\(fx, "dropShadow", list\);/);
    assert.match(replace, /var fx = null;/);
    assert.match(replace, /__s\("bevelStyle"\), __s\("bevelEmbossStyle"\), __s\("pillowEmboss"\)/);
    assert.match(replace, /__s\("bevelDirection"\), __s\("bevelEmbossStampStyle"\), __s\("stampOut"\)/);
    assert.match(replace, /e\.putBoolean\(__s\("useShape"\), true\);[\s\S]*e\.putObject\(__s\("mappingShape"\), __s\("shapeCurveType"\), ct\d+\);[\s\S]*inputRange"\), __s\("percentUnit"\), 60\)/);
    assert.match(replace, /e\.putBoolean\(__s\("useTexture"\), true\);[\s\S]*putString\(__s\("name"\), "Clouds"\);[\s\S]*textureDepth"\), __s\("percentUnit"\), -50\)/);
    assert.match(replace, /__fxWrite\(fx, "chromeFX", list\);/);
    assert.match(multi, /__fxWrite\(fx, "frameFX", \[\(function \(\) \{/);
    assert.match(multi, /__s\("style"\), __s\("frameStyle"\), __s\("insetFrame"\)/);
    assert.match(multi, /__s\("paintType"\), __s\("frameFill"\), __s\("gradientFill"\)/);
    assert.match(multi, /__fxWrite\(fx, "solidFill", \[/);
    assert.match(remove, /__fxRemove\(fx, "outerGlow"\);/);
    assert.match(remove, /e\.putBoolean\(__s\("enabled"\), false\);/);
    assert.match(edit, /if \(1 > list\.length\) throw new Error\("dropShadow has "/);
    assert.match(edit, /list\[1\] = e;/);
    assert.match(edit, /putString\(__s\("name"\), "Gravel"\)/);
    assert.match(edit, /__s\("innerGlowSource"\), __s\("innerGlowSourceType"\), __s\("centerGlow"\)/);
    assert.match(edit, /__s\("type"\), __s\("gradientType"\), __s\("angle"\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { glow: {} } }), /Invalid value for 'effects'/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { dropShadow: { blur: 3 } } }), /has no option blur/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { satin: [{}] } }), /allows one instance/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { dropShadow: { opacity: 120 } } }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { bevelEmboss: { texture: { scale: 50 } } } }), /needs pattern/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { bevelEmboss: { contour: { points: [[0, 0]] } } } }), /at least two/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: {} }), /names no effect/);
    await assert.rejects(mcp.handleToolCall('set_layer_effects', { effects: { stroke: { color: 'red' } } }), /not a colour/);
});

test('every effect can be added with its defaults', async () => {
    const effects = Object.fromEntries(Object.keys(EFFECTS).map((n) => [n, n === 'patternOverlay' ? { pattern: { name: 'Gravel' } } : true]));
    const [s] = await scriptsFor([['set_layer_effects', { effects }]]);
    for (const e of Object.values(EFFECTS)) assert.match(s, new RegExp(`__fxWrite\\(fx, "${e.key}", list\\);`));
});

test('layer style commands, blending options and presets', async () => {
    const [copyAll, copySome, clear, rasterize, scale, hide, show, read, blend, apply, load, save] = await scriptsFor([
        ['copy_layer_style', { source: { ids: [2] }, target: { ids: [3, 4] } }],
        ['copy_layer_style', { source: { ids: [2] }, target: { ids: [3] }, effects: ['dropShadow', 'stroke'] }],
        ['manage_layer_style', { action: 'clear' }],
        ['manage_layer_style', { action: 'rasterize' }],
        ['manage_layer_style', { action: 'scale', scale: 50 }],
        ['manage_layer_style', { action: 'hide_all' }],
        ['manage_layer_style', { action: 'show_all' }],
        ['get_layer_effects', { detail: true }],
        ['set_blending_options', { target: { ids: [3] }, opacity: 80, blendMode: 'screen', knockout: 'deep', channels: ['red', 'blue'], layerMaskHidesEffects: true, blendIf: [{ thisLayer: [0, 30, 220, 255] }, { channel: 'red', underlyingLayer: [10, 10, 255, 255] }] }],
        ['manage_style_presets', { action: 'apply', style: 'Chiseled Sky' }],
        ['manage_style_presets', { action: 'load', file: `${docs}/mine.asl`, append: false }],
        ['manage_style_presets', { action: 'save', file: `${docs}/mine.asl` }],
    ]);
    assert.match(copyAll, /__play\("copyEffects", __onTarget\(\)\);[\s\S]*pd\.putBoolean\(__s\("allowPasting"\), true\);\n__play\("pasteEffects", pd\);/);
    assert.match(copySome, /keys = \["dropShadow","frameFX"\]/);
    assert.match(copySome, /__fxWrite\(fx, keys\[k\], list\);/);
    assert.match(clear, /__play\("disableLayerStyle", __onTarget\(\)\);/);
    assert.match(rasterize, /__s\("what"\), __s\("rasterizeItem"\), __s\("layerStyle"\)\); __play\("rasterizeLayer", d\);/);
    assert.match(scale, /__s\("scale"\), __s\("percentUnit"\), 50\); __play\("scaleEffectsEvent", d\);/);
    assert.match(hide, /r\.putClass\(__s\("layerEffects"\)\);[\s\S]*__play\("hide", d\);/);
    assert.match(show, /__play\("show", d\);/);
    assert.match(read, /__fxSummary\(items\[i\], true\)/);
    assert.match(blend, /l\.opacity = 80;\n {2}l\.blendMode = BlendMode\.SCREEN;/);
    assert.match(blend, /to\.putEnumerated\(__s\("knockout"\), __s\("knockout"\), __s\("deep"\)\);/);
    assert.match(blend, /cl\.putEnumerated\(__s\("channel"\), __c\("Rd {2}"\)\);\n {2}cl\.putEnumerated\(__s\("channel"\), __c\("Bl {2}"\)\);/);
    assert.match(blend, /to\.putBoolean\(__s\("layerMaskAsGlobalMask"\), true\);/);
    assert.match(blend, /br\.putInteger\(__s\("srcBlackMax"\), 30\);[\s\S]*br\.putInteger\(__s\("destBlackMin"\), 10\);/);
    assert.match(blend, /to\.putList\(__s\("blendRange"\), bl\);\n {2}__setLayer\(l\.id, to\);/);
    assert.match(apply, /items\[i\]\.applyStyle\("Chiseled Sky"\);/);
    assert.match(load, /r\.putProperty\(__s\("property"\), __s\("styleClass"\)\);[\s\S]*d\.putPath\(__s\("to"\), f\);\nd\.putBoolean\(__s\("append"\), false\);/);
    assert.match(save, /d\.putPath\(__s\("null"\), f\);\nd\.putReference\(__s\("to"\), r\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('copy_layer_style', { source: { ids: [2] }, target: { ids: [3] }, effects: [] }), /at least one effect/);
    await assert.rejects(mcp.handleToolCall('manage_layer_style', { action: 'scale' }), /needs scale/);
    await assert.rejects(mcp.handleToolCall('manage_layer_style', { action: 'clear', scale: 20 }), /only for the scale/);
    await assert.rejects(mcp.handleToolCall('set_blending_options', { target: { ids: [3] } }), /at least one blending option/);
    await assert.rejects(mcp.handleToolCall('set_blending_options', { target: { ids: [3] }, blendIf: [{ thisLayer: [200, 100, 50, 0] }] }), /must rise/);
    await assert.rejects(mcp.handleToolCall('set_blending_options', { target: { ids: [3] }, channels: [] }), /at least one channel/);
    await assert.rejects(mcp.handleToolCall('manage_style_presets', { action: 'load', file: `${docs}/mine.txt` }), /\.asl/);
    await assert.rejects(mcp.handleToolCall('manage_style_presets', { action: 'apply' }), /needs style/);
});
