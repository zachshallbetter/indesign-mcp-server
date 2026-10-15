import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolTable } from '../src/server.js';
import { EFFECTS, EFFECT_CATEGORIES, findEffect, nameKey } from '../src/tools/effect-controls.js';
import { scriptsFor, server } from './helpers.js';

const featureIds = new Set(JSON.parse(readFileSync(new URL('./fixtures/feature-ids.json', import.meta.url), 'utf8')).ids);
const tool = (name) => toolTable.find((t) => t.name === name);

test('the effect catalog: unique names, known categories, atlas ids', () => {
    assert.ok(EFFECTS.length >= 300);
    const keys = new Set();
    for (const e of EFFECTS) {
        assert.ok(!keys.has(nameKey(e.name)), `two effects are named ${e.name}`);
        keys.add(nameKey(e.name));
        assert.ok(EFFECT_CATEGORIES.includes(e.category));
        assert.ok(featureIds.has(e.id), e.id);
        for (const c of e.controls) assert.ok(featureIds.has(c.id), c.id);
    }
    assert.equal(findEffect('gaussian blur').matchName, 'ADBE Gaussian Blur 2');
    assert.equal(findEffect('ADBE Fractal Noise').name, 'Fractal Noise');
    assert.equal(findEffect('VR Blur').matchName, null);
    assert.equal(findEffect('No Such Effect'), null);
});

test('set_effect_controls claims every effect and every control a script can set', () => {
    const claimed = new Set(tool('set_effect_controls').features);
    for (const e of EFFECTS) {
        assert.ok(claimed.has(e.id), e.id);
        for (const c of e.controls) assert.equal(claimed.has(c.id), c.settable !== false, c.id);
    }
    assert.ok(!claimed.has('aftereffects.effects.curves_option.the'));
    assert.ok(tool('organize_effects').features.includes('aftereffects.effects.copy_effects_between_layers'));
});

test('set_effect_controls applies an effect by display name and sets controls of every kind', async () => {
    const [s] = await scriptsFor([['set_effect_controls', {
        layers: { indexes: [1, 2] },
        effect: 'Gaussian Blur',
        controls: { Blurriness: 20, 'Repeat Edge Pixels': true, Dimensions: 'Horizontal', Center: [960, 540], Color: '#FF0000', Glow: { Radius: 4 } },
        name: 'Soft',
    }]]);
    assert.match(s, /var spec = \{"text":"Gaussian Blur","name":"Gaussian Blur","matchName":"ADBE Gaussian Blur 2"\}, mn = __fxMatch\(spec\);/);
    assert.match(s, /if \(!parade\.canAddProperty\(mn\)\)/);
    assert.match(s, /fx = parade\.addProperty\(mn\);/);
    assert.match(s, /fx\.name = "Soft";/);
    assert.match(s, /\["Blurriness",\{"k":"num","v":20\}\]/);
    assert.match(s, /\["Repeat Edge Pixels",\{"k":"num","v":1\}\]/);
    assert.match(s, /\["Dimensions",\{"k":"str","v":"Horizontal","color":null\}\]/);
    assert.match(s, /\["Center",\{"k":"arr","v":\[960,540\]\}\]/);
    assert.match(s, /\["Color",\{"k":"str","v":"#FF0000","color":\[1,0,0\]\}\]/);
    assert.match(s, /\["Glow",\{"k":"group","v":\[\["Radius",\{"k":"num","v":4\}\]\]\}\]/);
    assert.match(s, /__fxSet\(fx, fx, 1, pairs, ls\[i\], c, null, set\);/);
    assert.match(s, /items = p\.propertyParameters/);
    assert.match(s, /app\.beginUndoGroup\("Apply effect"\)/);
});

test('set_effect_controls: unpublished match names, existing effects, keyframes and dropdown items', async () => {
    const [vr, existing, menu] = await scriptsFor([
        ['set_effect_controls', { layers: { selected: true }, effect: 'VR Blur' }],
        ['set_effect_controls', { layers: { names: ['Null 1'] }, existing: 2, controls: { Slider: 50 }, time: 1.5 }],
        ['set_effect_controls', { layers: { indexes: [1] }, effect: 'Dropdown Menu Control', controls: { Menu: ['Low', 'High'] } }],
    ]);
    assert.match(vr, /var spec = \{"text":"VR Blur","name":"VR Blur","matchName":null\}/);
    assert.match(existing, /var ref = 2;/);
    assert.match(existing, /fx = __fxPick\(parade, ref, ls\[i\]\);/);
    assert.match(existing, /__fxSet\(fx, fx, 1, pairs, ls\[i\], c, 1\.5, set\);/);
    assert.doesNotMatch(existing, /addProperty/);
    assert.match(menu, /"matchName":"ADBE Dropdown Control"/);
    assert.match(menu, /menu\.setPropertyParameters\(pairs\[d\]\[1\]\.v\);/);
    assert.match(menu, /\["Menu",\{"k":"items","v":\["Low","High"\]\}\]/);
});

test('set_effect_controls refuses bad arguments', async () => {
    const mcp = await server();
    const call = (args) => mcp.handleToolCall('set_effect_controls', { layers: { indexes: [1] }, ...args });
    await assert.rejects(call({}), /Give effect/);
    await assert.rejects(call({ effect: 'Glow', existing: 1 }), /not both/);
    await assert.rejects(call({ effect: ' ' }), /display name or match name/);
    await assert.rejects(call({ effect: 'Glow', controls: [1, 2] }), /object of control names/);
    await assert.rejects(call({ effect: 'Glow', controls: { Radius: [1, 'a'] } }), /an array is 1 to 4 numbers/);
    await assert.rejects(call({ effect: 'Glow', controls: { Radius: null } }), /must be a number/);
    await assert.rejects(call({ effect: 'Glow', controls: { Radius: Number.NaN } }), /Invalid number/);
    await assert.rejects(call({ effect: 'Glow', time: -1 }), /out of range/);
    await assert.rejects(call({ existing: 'x', layers: {} }), /Choose the layers/);
    await assert.rejects(call({ existing: true }), /applied effect's name/);
});

test('get_effect_controls reads one effect or all of them', async () => {
    const [one, all] = await scriptsFor([
        ['get_effect_controls', { layers: { indexes: [1] }, effect: 'Fractal Noise', time: 2 }],
        ['get_effect_controls', { layers: { indexes: [1] } }],
    ]);
    assert.match(one, /ref = "Fractal Noise"/);
    assert.match(one, /controls: __fxControls\(fx, 2, \[\], null\)/);
    assert.match(all, /ref = null/);
    assert.doesNotMatch(all, /UndoGroup/);
    assert.match(all, /info\.choices = __fxChoices\(p\)/);
});

test('find_effects filters the catalog and checks app.effects', async () => {
    const [s] = await scriptsFor([['find_effects', { category: 'Expression Controls', controls: true }]]);
    assert.match(s, /"name":"Slider Control","matchName":"ADBE Slider Control","category":"Expression Controls"/);
    assert.doesNotMatch(s, /"category":"Distort"/);
    assert.match(s, /app\.effects\[i\]\.matchName/);
    const [q] = await scriptsFor([['find_effects', { query: 'fractal noise' }]]);
    assert.match(q, /"name":"Fractal Noise"/);
    assert.match(q, /"name":"VR Fractal Noise"/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('find_effects', { category: 'Wobble' }), /Allowed/);
});

test('organize_effects duplicates, moves and copies effects', async () => {
    const [dup, move, copy] = await scriptsFor([
        ['organize_effects', { layers: { indexes: [1] }, action: 'duplicate', effects: ['Glow'] }],
        ['organize_effects', { layers: { indexes: [1] }, action: 'move', effects: [3], position: 1 }],
        ['organize_effects', { layers: { indexes: [1] }, action: 'copy_to_layers', to: { indexes: [2, 3] } }],
    ]);
    assert.match(dup, /var refs = \["Glow"\];/);
    assert.match(dup, /parade\.property\(idx\[k\]\)\.duplicate\(\);/);
    assert.match(move, /var to = 1;/);
    assert.match(move, /fx\.moveTo\(to\);/);
    assert.match(copy, /dest = __layers\(c, \{"indexes":\[2,3\]\}\)/);
    assert.match(copy, /c\.openInViewer\(\);/);
    assert.match(copy, /app\.executeCommand\(19\);[\s\S]*app\.executeCommand\(20\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('organize_effects', { layers: { indexes: [1] }, action: 'move', effects: [1, 2], position: 1 }), /one effect/);
    await assert.rejects(mcp.handleToolCall('organize_effects', { layers: { indexes: [1] }, action: 'copy_to_layers' }), /destination layers/);
    await assert.rejects(mcp.handleToolCall('organize_effects', { layers: { indexes: [1] }, action: 'explode' }), /Allowed/);
});

test('apply_effect and list_effects are unchanged', async () => {
    const [s] = await scriptsFor([['apply_effect', { layers: { indexes: [1] }, effect: 'ADBE Gaussian Blur 2', properties: { Blurriness: 5 } }]]);
    assert.match(s, /parade\.addProperty\("ADBE Gaussian Blur 2"\)/);
    assert.deepEqual(tool('apply_effect').features, ['aftereffects.effects.apply_effect']);
});
