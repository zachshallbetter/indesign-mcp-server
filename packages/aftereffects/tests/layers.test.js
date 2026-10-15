/**
 * Layers, compositions and time: layer edits, composition commands, markers,
 * time remapping, stretching and frame blending.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const L = { indexes: [1, 2] };

test('layer switches: comment, sampling, auto-orient, effects, collapse, transparency and blending-mode cycling', async () => {
    const [s] = await scriptsFor([['set_layer_properties', {
        layers: L, comment: 'note', sampling: 'bicubic', autoOrient: 'along_path', effectsActive: false,
        collapseTransformation: true, preserveTransparency: true, cycleBlendingMode: 'previous',
    }]]);
    assert.match(s, /l\.comment = "note";/);
    assert.match(s, /l\.samplingQuality = LayerSamplingQuality\.BICUBIC;/);
    assert.match(s, /l\.autoOrient = AutoOrientType\.ALONG_PATH;/);
    assert.match(s, /l\.effectsActive = false;/);
    assert.match(s, /l\.canSetCollapseTransformation\) l\.collapseTransformation = true;/);
    assert.match(s, /l\.preserveTransparency = true;/);
    assert.match(s, /l\.blendingMode = bm\[\(bi \+ -1 \+ bm\.length\) % bm\.length\];/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_layer_properties', { layers: L, sampling: 'nearest' }), /sampling/);
    await assert.rejects(mcp.handleToolCall('set_layer_properties', { layers: L, autoOrient: 'sideways' }), /autoOrient/);
});

test('parenting with jump uses setParentWithJump', async () => {
    const [jump, unparent] = await scriptsFor([
        ['parent_layers', { layers: { indexes: [2] }, parent: 1, jump: true }],
        ['parent_layers', { layers: { indexes: [2] }, jump: true }],
    ]);
    assert.match(jump, /ls\[i\]\.setParentWithJump\(parent\)/);
    assert.match(unparent, /var parent = null;/);
});

test('switch_all_layers unlocks, shows or hides video across the composition', async () => {
    const [unlock, show, hide] = await scriptsFor([
        ['switch_all_layers', { action: 'unlock_all' }],
        ['switch_all_layers', { action: 'show_all_video' }],
        ['switch_all_layers', { action: 'hide_other_video', layers: { indexes: [3] } }],
    ]);
    assert.match(unlock, /l\.locked = false;/);
    assert.match(show, /l\.enabled = true;/);
    assert.match(hide, /!keep\[l\.index\]\) \{ .*l\.enabled = false;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('switch_all_layers', { action: 'hide_other_video' }), /layers/);
    await assert.rejects(mcp.handleToolCall('switch_all_layers', { action: 'lock_all' }), /action/);
});

test('open_layer opens the Layer panel, the source, or selects the source in the Project panel', async () => {
    const one = { indexes: [1] };
    const [layer, source, reveal] = await scriptsFor([
        ['open_layer', { layers: one }],
        ['open_layer', { layers: one, target: 'source' }],
        ['open_layer', { layers: one, target: 'reveal_source' }],
    ]);
    assert.match(layer, /l\.openInViewer\(\)/);
    assert.match(source, /l\.source\.openInViewer\(\)/);
    assert.match(reveal, /l\.source\.selected = true;/);
});

test('select_layers sets, inverts, follows children and steps through the stack', async () => {
    const [set, inv, kids, next, ext] = await scriptsFor([
        ['select_layers', { action: 'set', layers: { indexes: [4] } }],
        ['select_layers', { action: 'invert' }],
        ['select_layers', { action: 'children', layers: { indexes: [1] } }],
        ['select_layers', { action: 'next' }],
        ['select_layers', { action: 'extend_previous' }],
    ]);
    assert.match(set, /ls\[i\]\.selected = true;/);
    assert.match(inv, /c\.layer\(i\)\.selected = !c\.layer\(i\)\.selected;/);
    assert.match(kids, /for \(var up = c\.layer\(i\)\.parent; up; up = up\.parent\)/);
    assert.match(next, /Math\.min\(c\.numLayers, last \+ 1\)/);
    assert.match(ext, /c\.layer\(Math\.max\(1, first - 1\)\)\.selected = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_layers', { action: 'add' }), /layers/);
});

test('trim_layers and move_layers set In and Out points and start times', async () => {
    const [trim, trimSet, moveIn, moveSet, nudge, stagger, slip] = await scriptsFor([
        ['trim_layers', { layers: L, edge: 'in' }],
        ['trim_layers', { layers: L, edge: 'out', at: 'comp_end', asSet: true }],
        ['move_layers', { layers: L, mode: 'in_point_to', at: 'comp_start' }],
        ['move_layers', { layers: L, mode: 'out_point_to', asSet: true }],
        ['move_layers', { layers: L, mode: 'offset', frames: -10 }],
        ['move_layers', { layers: L, mode: 'stagger', seconds: 0.5 }],
        ['move_layers', { layers: L, mode: 'slip', frames: 3 }],
    ]);
    assert.match(trim, /t = c\.time/);
    assert.match(trim, /ls\[i\]\.inPoint = t;/);
    assert.match(trimSet, /t = c\.duration/);
    assert.match(trimSet, /ref = Math\.max\(ref, ls\[i\]\.outPoint\)/);
    assert.match(trimSet, /ls\[i\]\.outPoint = ls\[i\]\.outPoint \+ \(t - ref\);/);
    assert.match(moveIn, /var t = 0/);
    assert.match(moveIn, /ls\[i\]\.startTime \+= t - ls\[i\]\.inPoint;/);
    assert.match(moveSet, /ls\[i\]\.startTime \+= t - ref;/);
    assert.match(nudge, /ls\[i\]\.startTime \+= 10 \* -1 \* c\.frameDuration;/);
    assert.match(stagger, /ls\[i\]\.startTime \+= i \* \(0\.5\);/);
    assert.match(slip, /l\.inPoint = i0; l\.outPoint = o0;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('move_layers', { layers: L, mode: 'offset' }), /frames or seconds/);
    await assert.rejects(mcp.handleToolCall('move_layers', { layers: L, mode: 'offset', frames: 1, seconds: 1 }), /frames or seconds/);
    await assert.rejects(mcp.handleToolCall('trim_layers', { layers: L, edge: 'in', at: 'later' }), /current_time/);
    await assert.rejects(mcp.handleToolCall('trim_layers', { layers: L, edge: 'middle' }), /edge/);
});

test('split_layers duplicates and trims at the time', async () => {
    const [s] = await scriptsFor([['split_layers', { layers: L, at: 3 }]]);
    assert.match(s, /t = 3/);
    assert.match(s, /var d = l\.duplicate\(\);\n {2}l\.outPoint = t;\n {2}d\.inPoint = t;/);
});

test('reframe_layers flips through Scale and fits through Layer > Transform', async () => {
    const [flip, fit, anchor] = await scriptsFor([
        ['reframe_layers', { layers: L, action: 'flip_vertical' }],
        ['reframe_layers', { layers: L, action: 'fit_to_comp_width' }],
        ['reframe_layers', { layers: L, action: 'center_anchor_point' }],
    ]);
    assert.match(flip, /v\[1\] = -v\[1\]; p\.setValueAtKey\(k, v\);/);
    assert.doesNotMatch(flip, /executeCommand/);
    assert.match(fit, /__selectOnly\(c, ls\);\napp\.executeCommand\(2732\);/);
    assert.match(anchor, /app\.executeCommand\(10312\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('reframe_layers', { layers: L, action: 'rotate' }), /action/);
});

test('replace_layer_source and set_solid_settings', async () => {
    const [rep, shared, fresh] = await scriptsFor([
        ['replace_layer_source', { layers: L, item: 7, fixExpressions: false }],
        ['set_solid_settings', { layers: L, color: '#FF0000', width: 640 }],
        ['set_solid_settings', { layers: L, name: 'Red', affectAllLayers: false }],
    ]);
    assert.match(rep, /ls\[i\]\.replaceSource\(it, false\);/);
    assert.match(shared, /s\.mainSource\.color = \[1,0,0\];/);
    assert.match(shared, /s\.width = 640;/);
    assert.match(fresh, /c\.layers\.addSolid\(s\.mainSource\.color, "Red", s\.width, s\.height, s\.pixelAspect, 1\);/);
    assert.match(fresh, /l\.replaceSource\(ns, false\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_solid_settings', { layers: L }), /name, color/);
    await assert.rejects(mcp.handleToolCall('set_solid_settings', { layers: L, color: 'red' }), /#RRGGBB/);
    await assert.rejects(mcp.handleToolCall('replace_layer_source', { layers: L, item: -1 }), /item/);
});

test('set_layer_styles runs Layer Styles commands and sets Blending Options', async () => {
    const [s] = await scriptsFor([['set_layer_styles', {
        layers: L, removeAll: true, add: ['drop_shadow', 'color_overlay'], blending: { fillOpacity: 0, blue: false, blendInteriorStylesAsGroup: true },
    }]]);
    assert.match(s, /app\.executeCommand\(2072\);/);
    assert.match(s, /app\.executeCommand\(9000\);/);
    assert.match(s, /app\.findMenuCommandId\("Color Overlay"\); app\.executeCommand\(sid \? sid : 9006\);/);
    assert.match(s, /check !== 9005/);
    assert.match(s, /"path":\["ADBE Adv Blend Group","ADBE Layer Fill Opacity2"\],"value":0/);
    assert.match(s, /"path":\["ADBE Adv Blend Group","ADBE B Channel Blend"\],"value":0/);
    assert.match(s, /"path":\["ADBE Adv Blend Group","ADBE Blend Interior"\],"value":1/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_layer_styles', { layers: L }), /Give add/);
    await assert.rejects(mcp.handleToolCall('set_layer_styles', { layers: L, add: ['emboss'] }), /add\[0\]/);
    await assert.rejects(mcp.handleToolCall('set_layer_styles', { layers: L, blending: { fillOpacity: 150 } }), /fillOpacity/);
});

test('choose_layer_tool sets the Tools panel tool', async () => {
    const [s] = await scriptsFor([['choose_layer_tool', { tool: 'pan_behind' }]]);
    assert.match(s, /proj\.toolType = ToolType\["Tool_PanBehind"\];/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('choose_layer_tool', { tool: 'pen' }), /tool/);
});

test('composition settings: resolution, start timecode, nesting, motion blur samples and switches', async () => {
    const [s] = await scriptsFor([['set_comp_settings', {
        resolution: 'half', startTimecode: 3600, dropFrame: true, preserveNestedResolution: true, preserveNestedFrameRate: false,
        shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128, frameBlending: true, hideShyLayers: true,
    }]]);
    for (const re of [/c\.resolutionFactor = \[2, 2\];/, /c\.displayStartTime = 3600;/, /c\.dropFrame = true;/, /c\.preserveNestedResolution = true;/,
        /c\.preserveNestedFrameRate = false;/, /c\.shutterPhase = -90;/, /c\.motionBlurSamplesPerFrame = 16;/, /c\.motionBlurAdaptiveSampleLimit = 128;/,
        /c\.frameBlending = true;/, /c\.hideShyLayers = true;/]) assert.match(s, re);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_comp_settings', { adaptiveSampleLimit: 4 }), /adaptiveSampleLimit/);
    await assert.rejects(mcp.handleToolCall('set_comp_settings', { startFrame: 1.5 }), /startFrame/);
    await assert.rejects(mcp.handleToolCall('set_comp_settings', { resolution: 'eighth' }), /resolution/);
});

test('create_comp_from_items makes compositions sized from the items', async () => {
    const [each, single] = await scriptsFor([
        ['create_comp_from_items', { items: [3, 4] }],
        ['create_comp_from_items', { items: [3, 4], mode: 'single', sequenceLayers: true, overlap: 1, addToRenderQueue: true, name: 'Cut' }],
    ]);
    assert.match(each, /__make\(items\[i\]\.name, items\[i\], \[items\[i\]\], false\);/);
    assert.match(single, /__make\("Cut", from, items, true\);/);
    assert.match(single, /proj\.renderQueue\.items\.add\(nc\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_comp_from_items', { items: [] }), /items/);
});

test('run_comp_command runs work-area commands on the active composition', async () => {
    const [trim, lift, wa, poster, reveal] = await scriptsFor([
        ['run_comp_command', { action: 'trim_to_work_area' }],
        ['run_comp_command', { action: 'lift_work_area', layers: { indexes: [2] } }],
        ['run_comp_command', { action: 'work_area_to_layers', layers: L }],
        ['run_comp_command', { action: 'set_poster_time', time: 2 }],
        ['run_comp_command', { action: 'reveal_in_project' }],
    ]);
    assert.match(trim, /c\.openInViewer\(\);/);
    assert.match(trim, /app\.executeCommand\(2360\);/);
    assert.match(lift, /__selectOnly\(c, __layers\(c, \{"indexes":\[2\]\}\)\);\n\napp\.executeCommand\(2613\);/);
    assert.match(wa, /c\.workAreaStart = s;\nc\.workAreaDuration = e - s;/);
    assert.doesNotMatch(wa, /executeCommand/);
    assert.match(poster, /c\.time = 2;\napp\.executeCommand\(2012\);/);
    assert.match(reveal, /c\.selected = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_comp_command', { action: 'mini_flowchart' }), /action/);
});

test('edit_markers adds, edits and removes composition and layer markers', async () => {
    const [add, numbered, update, removeAll, goTo, fromSource] = await scriptsFor([
        ['edit_markers', { layers: L, action: 'add', comment: 'hit', label: 3, cuePointName: 'cue', eventCuePoint: true, parameters: { a: 1 } }],
        ['edit_markers', { action: 'add', number: 4, at: 5 }],
        ['edit_markers', { action: 'update', marker: 2, duration: 1.5, protectedRegion: true }],
        ['edit_markers', { action: 'remove_all' }],
        ['edit_markers', { action: 'go_to', number: 4 }],
        ['edit_markers', { action: 'update_from_source', layers: L }],
    ]);
    assert.match(add, /ls\[j\]\.property\("ADBE Marker"\)/);
    assert.match(add, /mv\.comment = "hit";/);
    assert.match(add, /mv\.label = 3;/);
    assert.match(add, /mv\.cuePointName = "cue";/);
    assert.match(add, /mv\.eventCuePoint = true;/);
    assert.match(add, /mv\.setParameters\(\{"a":"1"\}\);/);
    assert.match(numbered, /c\.markerProperty/);
    assert.match(numbered, /mv\.comment = "4";/);
    assert.match(numbered, /p\.setValueAtTime\(t, mv\);/);
    assert.match(update, /which = 2/);
    assert.match(update, /p\.setValueAtKey\(k, mv\);/);
    assert.match(removeAll, /p\.removeKey\(k\);/);
    assert.match(goTo, /c\.time = p\.keyTime\(k\);/);
    assert.match(fromSource, /app\.executeCommand\(2539\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_markers', { action: 'update', marker: 1 }), /field/);
    await assert.rejects(mcp.handleToolCall('edit_markers', { action: 'add', layers: L, number: 2 }), /composition markers/);
    await assert.rejects(mcp.handleToolCall('edit_markers', { action: 'add', number: 12 }), /number/);
    await assert.rejects(mcp.handleToolCall('edit_markers', { action: 'update_from_source' }), /layers/);
});

test('remap_layer_time enables remapping and freezes frames with hold keyframes', async () => {
    const [enable, freeze, last, hold, keys] = await scriptsFor([
        ['remap_layer_time', { layers: L, action: 'enable' }],
        ['remap_layer_time', { layers: L, action: 'freeze_frame', at: 2 }],
        ['remap_layer_time', { layers: L, action: 'freeze_on_last_frame' }],
        ['remap_layer_time', { layers: L, action: 'hold', from: 1, to: 3 }],
        ['remap_layer_time', { layers: L, action: 'set_keyframes', keyframes: [{ time: 0, sourceTime: 2 }, { time: 1, sourceTime: 0, hold: true }] }],
    ]);
    assert.match(enable, /l\.timeRemapEnabled = true;/);
    assert.match(freeze, /p\.removeKey\(k\);\n__hold\(p, t, v\);/);
    assert.match(freeze, /KeyframeInterpolationType\.HOLD/);
    assert.match(last, /l\.outPoint = Math\.max\(l\.outPoint, c\.duration\);/);
    assert.match(hold, /__hold\(p, 1, v\);\np\.setValueAtTime\(3, v\);/);
    assert.match(keys, /\{"t":1,"v":0,"i":true\}/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('remap_layer_time', { layers: L, action: 'hold', from: 3, to: 1 }), /later/);
    await assert.rejects(mcp.handleToolCall('remap_layer_time', { layers: L, action: 'set_keyframes' }), /keyframes/);
    await assert.rejects(mcp.handleToolCall('remap_layer_time', { layers: L, action: 'set_keyframes', keyframes: [{ time: 0, sourceTime: -1 }] }), /sourceTime/);
});

test('set_frame_blending sets layer modes and the composition switch', async () => {
    const [s, comp] = await scriptsFor([
        ['set_frame_blending', { layers: L, mode: 'pixel_motion', compSwitch: true }],
        ['set_frame_blending', { compSwitch: false }],
    ]);
    assert.match(s, /ls\[i\]\.frameBlendingType = FrameBlendingType\.PIXEL_MOTION;/);
    assert.match(s, /c\.frameBlending = true;/);
    assert.match(comp, /c\.frameBlending = false;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_frame_blending', { layers: L }), /together/);
    await assert.rejects(mcp.handleToolCall('set_frame_blending', {}), /compSwitch/);
});

test('stretch_layers stretches around a held point, to a time, keeping keyframes, or conforms the frame rate', async () => {
    const [pct, edge, conform] = await scriptsFor([
        ['stretch_layers', { layers: L, percent: 50, holdInPlace: 'current_time', keepKeyframeTimes: true }],
        ['stretch_layers', { layers: L, edge: 'out', at: 4 }],
        ['stretch_layers', { layers: L, conformFrameRate: 24 }],
    ]);
    assert.match(pct, /var s2 = 50, h = c\.time;/);
    assert.match(pct, /l\.stretch = s2;\n {2}l\.startTime = h - src \* s2;/);
    assert.match(pct, /var kept = __collectKeys\(l, \[\]\);/);
    assert.match(pct, /__restoreKeys\(kept\);/);
    assert.match(edge, /var t = 4;.*s2 = l\.stretch \* \(t - l\.inPoint\) \/ \(l\.outPoint - l\.inPoint\), h = l\.inPoint;/);
    assert.doesNotMatch(edge, /__collectKeys/);
    assert.match(conform, /s\.mainSource\.conformFrameRate = 24;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('stretch_layers', { layers: L }), /Give one of/);
    await assert.rejects(mcp.handleToolCall('stretch_layers', { layers: L, percent: 50, duration: 2 }), /Give one of/);
    await assert.rejects(mcp.handleToolCall('stretch_layers', { layers: L, percent: 0 }), /cannot be 0/);
});

test('align_video_to_data selects the data layer with the video layers', async () => {
    const [s] = await scriptsFor([['align_video_to_data', { dataLayer: 1, layers: { indexes: [2, 3] } }]]);
    assert.match(s, /var sel = \[c\.layer\(di\)\];/);
    assert.match(s, /__selectOnly\(c, sel\);\napp\.executeCommand\(4041\);/);
});
