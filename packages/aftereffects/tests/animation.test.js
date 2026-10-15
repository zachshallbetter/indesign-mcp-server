/**
 * Keyframe editing, selection and navigation, copying animation, Sequence
 * Layers, Puppet, Animation menu commands and expression tools.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolTable } from '../src/server.js';
import { scriptsFor, server } from './helpers.js';

const L1 = { indexes: [1] };

test('edit_keyframes writes interpolation, ease, labels, values and reversal', async () => {
    const [ease, rev, spatial, toggle] = await scriptsFor([
        ['edit_keyframes', { layers: L1, property: 'opacity', preset: 'easy_ease_in', label: 2 }],
        ['edit_keyframes', { layers: L1, property: 'scale', keys: { from: 1, to: 3 }, timeReverse: true, value: [50, 50] }],
        ['edit_keyframes', { layers: L1, property: 'position', keys: { times: [0.5] }, spatialTangents: { in: [-10, 0], out: [10, 0] }, roving: true, spatialAutoBezier: false }],
        ['edit_keyframes', { layers: L1, property: 'rotation', keys: { selected: true }, preset: 'toggle_hold', easeOut: { speed: 5, influence: 60 }, inInterpolation: 'linear' }],
    ]);
    assert.match(ease, /p\.setInterpolationTypeAtKey\(k, KeyframeInterpolationType\.BEZIER, p\.keyOutInterpolationType\(k\)\);/);
    assert.match(ease, /ei\.push\(new KeyframeEase\(0, 33\.33\)\)/);
    assert.match(ease, /p\.setLabelAtKey\(k, 2\);/);
    assert.match(rev, /ks = \{"idx":null,"from":1,"to":3,"times":null,"sel":false\}/);
    assert.match(rev, /p\.removeKey\(picked\[j\]\);/);
    assert.match(rev, /__putKey\(p, t0 \+ t1 - recs\[j\]\.t, recs\[j\], true\);/);
    assert.match(rev, /p\.setValueAtKey\(k, v\);/);
    assert.match(spatial, /if \(!p\.isSpatial\) throw/);
    assert.match(spatial, /p\.setSpatialTangentsAtKey\(k, \[-10,0\], \[10,0\]\);/);
    assert.match(spatial, /p\.setRovingAtKey\(k, true\);/);
    assert.match(spatial, /p\.addKey\(ks\.times\[j\]\);/);
    assert.match(toggle, /if \(p\.keyOutInterpolationType\(k\) === KeyframeInterpolationType\.HOLD\)/);
    assert.match(toggle, /eo\.push\(new KeyframeEase\(5, 60\)\)/);
    assert.match(toggle, /p\.setInterpolationTypeAtKey\(k, KeyframeInterpolationType\.LINEAR, p\.keyOutInterpolationType\(k\)\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'opacity' }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'opacity', preset: 'springy' }), /Allowed: linear/);
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'opacity', label: 17 }), /label/);
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'opacity', easeIn: { influence: 0 } }), /easeIn\.influence/);
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'position', spatialTangents: { in: [1], out: [1, 2] } }), /spatialTangents\.in/);
    await assert.rejects(mcp.handleToolCall('edit_keyframes', { layers: L1, property: 'opacity', keys: { indexes: [] }, label: 1 }), /keys\.indexes/);
});

test('select_keyframes selects, adds, removes and deselects everything', async () => {
    const [only, clear] = await scriptsFor([
        ['select_keyframes', { layers: L1, property: 'position', keys: { indexes: [2, 3] } }],
        ['select_keyframes', { deselectAll: true }],
    ]);
    assert.match(only, /for \(j = 1; j <= p\.numKeys; j\+\+\) p\.setSelectedAtKey\(j, false\);/);
    assert.match(only, /p\.setSelectedAtKey\(picked\[j\], true\);/);
    assert.match(clear, /q\.setSelectedAtKey\(sk\[m\], false\);/);
    assert.match(clear, /sp\[j\]\.selected = false;/);
    assert.doesNotMatch(clear, /__pickKeys/);
    const [removed] = await scriptsFor([['select_keyframes', { layers: L1, property: 'opacity', mode: 'remove' }]]);
    assert.match(removed, /p\.setSelectedAtKey\(picked\[j\], false\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_keyframes', {}), /deselectAll/);
    await assert.rejects(mcp.handleToolCall('select_keyframes', { property: 'opacity' }), /Choose the layers/);
    await assert.rejects(mcp.handleToolCall('select_keyframes', { layers: L1, property: 'opacity', mode: 'toggle' }), /Allowed: replace/);
});

test('go_to_keyframe moves the current time', async () => {
    const [next, last] = await scriptsFor([
        ['go_to_keyframe', { direction: 'next' }],
        ['go_to_keyframe', { layers: L1, property: 'scale', direction: 'last' }],
    ]);
    assert.match(next, /\{"selected":true\}/);
    assert.match(next, /__collect\(ls\[i\]\);/);
    assert.match(next, /if \(t > now \+ eps/);
    assert.match(last, /if \(best === null \|\| t > best\) best = t;/);
    assert.match(last, /c\.time = best;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('go_to_keyframe', { direction: 'up' }), /Allowed: previous/);
});

test('copy_animation copies keyframes, expressions and property links', async () => {
    const [keys, expr, link] = await scriptsFor([
        ['copy_animation', { from: { layer: 1, property: 'position' }, to: { layers: { indexes: [2, 3] } }, what: 'keyframes', time: 2, reverse: true }],
        ['copy_animation', { from: { layer: 'Title', property: 'opacity' }, to: { layers: { names: ['Sub'] }, property: 'rotation' }, what: 'expression' }],
        ['copy_animation', { from: { comp: { name: 'Main' }, layer: 'Ctrl "A"', property: ['ADBE Effect Parade', 'Slider Control', 'ADBE Slider Control-0001'] }, to: { layers: L1, property: 'rotation' }, what: 'link' }],
    ]);
    assert.match(keys, /__putKey\(d, at \+ \(true \? \(t1 - recs\[k\]\.t\) : \(recs\[k\]\.t - t0\)\), recs\[k\], true\);/);
    assert.match(keys, /at = 2;/);
    assert.match(expr, /d\.expression = s\.expression;/);
    assert.match(expr, /\{"names":\["Title"\]\}/);
    assert.match(expr, /dpath = \["ADBE Transform Group","ADBE Rotate Z"\]/);
    assert.match(link, /link = "comp\(" \+ q\(sc\.name\) \+ "\)\.layer\(" \+ q\(sl\.name\) \+ "\)";/);
    assert.match(link, /\{"names":\["Ctrl \\"A\\""\]\}/);
    assert.doesNotMatch(link, /__pickKeys/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('copy_animation', { from: { layer: 1, property: 'position' }, to: { layers: L1 }, what: 'clone' }), /Allowed: keyframes/);
    await assert.rejects(mcp.handleToolCall('copy_animation', { from: { layer: true, property: 'position' }, to: { layers: L1 }, what: 'link' }), /from\.layer/);
    await assert.rejects(mcp.handleToolCall('copy_animation', { from: { layer: 1, property: 'wobble' }, to: { layers: L1 }, what: 'link' }), /unknown shortcut/);
    await assert.rejects(mcp.handleToolCall('copy_animation', { from: { layer: 1, property: 'position' }, to: { layers: L1 }, what: 'keyframes', time: 'soon' }), /time/);
});

test('separate_dimensions and sequence_layers', async () => {
    const [sep, seq] = await scriptsFor([
        ['separate_dimensions', { layers: L1, separate: false }],
        ['sequence_layers', { layers: { indexes: [3, 2, 1] }, overlap: 1, transition: 'dissolve_front' }],
    ]);
    assert.match(sep, /p\.dimensionsSeparated = false;/);
    assert.match(sep, /\["ADBE Transform Group","ADBE Position"\]/);
    assert.match(seq, /ls\[i\]\.startTime \+= t - ls\[i\]\.inPoint;/);
    assert.match(seq, /if \(prev\.index < next\.index\) __fade\(prev, s, e, 100, 0\); else __fade\(next, s, e, 0, 100\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('sequence_layers', { layers: L1, transition: 'cross_dissolve' }), /needs an overlap/);
    await assert.rejects(mcp.handleToolCall('sequence_layers', { layers: L1, overlap: -1 }), /overlap/);
});

test('run_animation_command selects first and runs only known commands', async () => {
    const [reveal, scale, label] = await scriptsFor([
        ['run_animation_command', { command: 'reveal_expression_errors', comp: { id: 4 }, layers: { indexes: [1, 2] } }],
        ['run_animation_command', { command: 'exponential_scale' }],
        ['run_animation_command', { command: 'reveal_in_timeline', layers: L1, property: 'scale' }],
    ]);
    assert.match(reveal, /c\.openInViewer\(\);/);
    assert.match(reveal, /c\.layer\(i\)\.selected = false;/);
    assert.match(reveal, /var id = 2731;/);
    assert.match(reveal, /app\.executeCommand\(id\);/);
    assert.match(scale, /app\.findMenuCommandId\("Exponential Scale"\)/);
    assert.doesNotMatch(scale, /var c = __comp\(/);
    assert.match(label, /\.selected = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_animation_command', { command: 'sequence_layers_dialog' }), /Allowed: toggle_auto_keyframe/);
    await assert.rejects(mcp.handleToolCall('run_animation_command', { command: 'reveal_in_timeline', property: 'scale' }), /needs 'layers'/);
});

test('manage_puppet chooses pin tools, adds the effect and duplicates meshes', async () => {
    const [tool, add, dup, list] = await scriptsFor([
        ['manage_puppet', { action: 'choose_tool', tool: 'bend' }],
        ['manage_puppet', { action: 'add_effect', layers: L1 }],
        ['manage_puppet', { action: 'duplicate_mesh', layers: L1, mesh: 2 }],
        ['manage_puppet', { action: 'list', layers: L1 }],
    ]);
    assert.match(tool, /proj\.toolType = ToolType\.Tool_PinBend;/);
    assert.match(add, /parade\.addProperty\("ADBE FreePin3"\)/);
    assert.match(dup, /meshes\.property\(2\)\.duplicate\(\)/);
    assert.doesNotMatch(list, /beginUndoGroup/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_puppet', { action: 'choose_tool', tool: 'pen' }), /Allowed: position/);
    await assert.rejects(mcp.handleToolCall('manage_puppet', { action: 'add_effect' }), /needs 'layers'/);
    await assert.rejects(mcp.handleToolCall('manage_puppet', { action: 'duplicate_mesh', layers: L1, mesh: -1 }), /mesh/);
});

test('expressions: convert to keyframes, engine, and the language features set_expression writes', async () => {
    const [bake, engine] = await scriptsFor([
        ['convert_expression_to_keyframes', { layers: L1, property: 'rotation' }],
        ['set_expression_engine', { engine: 'javascript' }],
    ]);
    assert.match(bake, /vals\.push\(p\.valueAtTime\(t0 \+ f \* fd, false\)\);/);
    assert.match(bake, /p\.expressionEnabled = false;\n {2}p\.setValuesAtTimes\(times, vals\);/);
    assert.match(engine, /proj\.expressionEngine = "javascript-1\.0";/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_expression_engine', { engine: 'python' }), /Allowed: javascript, extendscript/);
    await assert.rejects(mcp.handleToolCall('convert_expression_to_keyframes', { layers: L1, property: 'rotation', from: 'start' }), /from/);
    const setExpression = toolTable.find((t) => t.name === 'set_expression');
    for (const f of ['lang_vector_math', 'lang_text_style', 'expression_selector_attributes', 'expression_editor']) {
        assert.ok(setExpression.features.includes(`aftereffects.expressions.${f}`), f);
    }
});
