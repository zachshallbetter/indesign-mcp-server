import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { actionText } from '../src/action.js';

test('anchor points are removed, converted and set through PathPoint', async () => {
    const [remove, corner, smooth, set, selected] = await scriptsFor([
        ['edit_anchor_points', { target: { ids: ['p'] }, action: 'remove', points: [3, 1, 3] }],
        ['edit_anchor_points', { target: { selection: true }, action: 'corner' }],
        ['edit_anchor_points', { target: { ids: ['p'] }, action: 'smooth', points: [0] }],
        ['edit_anchor_points', { target: { ids: ['p'] }, action: 'set', points: [2], anchor: [10, 20], rightHandle: [30, 20], artboardIndex: 1 }],
        ['edit_anchor_points', { target: { selection: true }, action: 'remove', selectedPoints: true }],
    ]);
    assert.match(remove, /wanted = \[3,1\]/, 'indexes are de-duplicated');
    assert.match(remove, /list\.sort\(function \(x, y\) \{ return y - x; \}\);/, 'removed from the end so indexes stay valid');
    assert.match(remove, /p\.pathPoints\[list\[r\]\]\.remove\(\);/);
    assert.match(corner, /mode = "all"/);
    assert.match(corner, /q\.leftDirection = q\.anchor; q\.rightDirection = q\.anchor; q\.pointType = PointType\.CORNER;/);
    assert.match(smooth, /q\.pointType = PointType\.SMOOTH;/);
    assert.match(smooth, /lenL = __dist\(a, prev\) \/ 3;/);
    assert.match(set, /ab = __artboard\(doc, 1\), g = \{"anchor":\[10,20\],"left":null,"right":\[30,20\]\}/);
    assert.match(set, /q\.anchor = an; q\.leftDirection = lh; q\.rightDirection = rh;/);
    assert.match(selected, /mode = "selected"/);
    assert.match(selected, /p\.pathPoints\[k\]\.selected === PathPointSelection\.ANCHORPOINT/);
});

test('anchor point edits refuse missing or conflicting points', async () => {
    const mcp = await server();
    const t = { ids: ['p'] };
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'remove' }), /remove needs the points/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'set', points: [1, 2], anchor: [0, 0] }), /exactly one index/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'set', points: [1] }), /at least one of anchor/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'set', points: [1], anchor: [0] }), /must be \[x, y\]/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'corner', anchor: [0, 0] }), /apply to action: "set"/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'smooth', points: [1], selectedPoints: true }), /not both/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'corner', points: [-1] }), /Invalid index/);
    await assert.rejects(mcp.handleToolCall('edit_anchor_points', { target: t, action: 'join' }), /Allowed: remove/);
});

test('copy_items duplicates into another document or copies to the clipboard', async () => {
    const [doc, clip] = await scriptsFor([
        ['copy_items', { target: { ids: ['a'] }, to: 'document', document: 'Other "B".ai', layer: 'Art' }],
        ['copy_items', { target: { selection: true }, to: 'clipboard' }],
    ]);
    assert.match(doc, /name = "Other \\"B\\"\.ai"/);
    assert.match(doc, /var layer = __layer\(dest, "Art"\);/);
    assert.match(doc, /items\[i\]\.duplicate\(layer, ElementPlacement\.PLACEATBEGINNING\)/);
    assert.match(clip, /app\.copy\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('copy_items', { target: { selection: true }, to: 'document' }), /needs document/);
    await assert.rejects(mcp.handleToolCall('copy_items', { target: { selection: true }, to: 'clipboard', layer: 'x' }), /apply to to: "document"/);
});

test('simplify_path plays ai_plugin_simplify with its dialog closed', async () => {
    const [s] = await scriptsFor([['simplify_path', { target: { selection: true }, curvePrecision: 80, angleThreshold: 45.5, straightLines: true }]]);
    assert.match(s, /\/internalName \(ai_plugin_simplify\)/);
    assert.match(s, /\/hasDialog 1\\n\\t\\t\/showDialog 0/);
    assert.match(s, /\/key 1919182693\\n[^"]*?\/value 80\.0\\n\\t\\t\\t\/unit 592474723/);
    assert.match(s, /\/key 1634561652\\n[^"]*?\/value 45\.5\\n\\t\\t\\t\/unit 591490663/);
    assert.match(s, /\/key 1936553064\\n[^"]*?\/type \(boolean\)\\n\\t\\t\\t\/value 1/);
    assert.match(s, /\/key 1936552044\\n[^"]*?\/type \(boolean\)\\n\\t\\t\\t\/value 0/, 'Show Original stays off');
    assert.match(s, /app\.doScript\("simplify", "adobe-mcp-simplify"\);\n\} finally \{\n {2}try \{ app\.unloadAction\("adobe-mcp-simplify", ""\); \} catch \(e\) \{\}/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('simplify_path', { target: { selection: true }, curvePrecision: 120 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('simplify_path', { target: { selection: true }, angleThreshold: -1 }), /out of range/);
});

test('compound shapes are made, released and expanded with the recorded events', async () => {
    const [make, release, expand] = await scriptsFor([
        ['compound_shape', { target: { selection: true }, operation: 'make', mode: 'exclude' }],
        ['compound_shape', { target: { ids: ['c'] }, operation: 'release' }],
        ['compound_shape', { target: { ids: ['c'] }, operation: 'expand' }],
    ]);
    assert.match(make, /\/internalName \(ai_compound_shape\)/);
    assert.match(make, /\/key 1851878757\\n[^"]*?\/type \(enumerated\)[^"]*?\/value 2\\n/);
    assert.match(make, /\/key 1836016741\\n[^"]*?\/value 0\\n/);
    assert.match(make, /\/hasDialog 0\\n\\t\\t\/parameterCount 2/);
    assert.match(make, /at least two objects/);
    assert.match(release, /\/internalName \(ai_release_compound_shape\)[^"]*\/key 1919710053/);
    assert.match(expand, /\/internalName \(ai_expand_compound_shape\)[^"]*\/key 2020634212/);
    assert.match(expand, /typename !== "PluginItem"/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('compound_shape', { target: { selection: true }, operation: 'release', mode: 'unite' }), /mode applies/);
    await assert.rejects(mcp.handleToolCall('compound_shape', { target: { selection: true }, operation: 'make', mode: 'divide' }), /Allowed: unite/);
});

test('repeat pathfinder and intertwine run their menu commands on the targets', async () => {
    const [repeat, make, release] = await scriptsFor([
        ['repeat_pathfinder', { target: { selection: true } }],
        ['intertwine', { target: { ids: ['a', 'b'] }, operation: 'make' }],
        ['intertwine', { target: { ids: ['i'] }, operation: 'release' }],
    ]);
    assert.match(repeat, /app\.executeMenuCommand\("repeatPathfinder"\);/);
    assert.match(make, /app\.executeMenuCommand\("Partial Rearrange Make"\);/);
    assert.match(release, /app\.executeMenuCommand\("Partial Rearrange Release"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('intertwine', { target: { selection: true }, operation: 'edit' }), /Allowed: make, release/);
});

test('generated Actions keep names as hex and refuse odd event names', () => {
    const text = actionText({ set: 'é', action: 'a', internalName: 'ai_x', localizedName: 'X', parameters: [] });
    assert.match(text, /^\/version 3\n\/name \[ 2\n\tc3a9\n\]/);
    assert.match(text, /\/hasDialog 0\n\t\t\/parameterCount 0/);
    assert.throws(() => actionText({ set: 's', action: 'a', internalName: 'ai) x', localizedName: 'X' }), /Bad action event name/);
});

test('direction handle display is a preference', async () => {
    const [s] = await scriptsFor([['set_preferences', { showHandlesOnSelectedAnchors: true }]]);
    assert.match(s, /p\.setBooleanPreference\("showDirectionHandles", true\);/);
});
