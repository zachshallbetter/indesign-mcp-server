import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

test('get_color_management reads the colour settings and lists profiles', async () => {
    const [plain, listed] = await scriptsFor([
        ['get_color_management', {}],
        ['get_color_management', { listProfiles: true, query: 'Rec' }],
    ]);
    for (const m of ['bitsPerChannel', 'workingSpace', 'workingGamma', 'linearizeWorkingSpace', 'linearBlending', 'compensateForSceneReferredProfiles']) assert.match(plain, new RegExp(`proj\\.${m}`));
    assert.doesNotMatch(plain, /listColorProfiles/);
    assert.match(listed, /proj\.listColorProfiles\(\)/);
    assert.match(listed, /var q = "rec"/);
});

test('set_color_management sets project colour settings', async () => {
    const [s, none] = await scriptsFor([
        ['set_color_management', { bitsPerChannel: 32, workingSpace: 'HDTV (Rec. 709)', linearizeWorkingSpace: true, linearBlending: false, compensateForSceneReferredProfiles: true }],
        ['set_color_management', { workingSpace: '', workingGamma: 2.4 }],
    ]);
    assert.match(s, /proj\.bitsPerChannel = 32;/);
    assert.match(s, /var ws = "HDTV \(Rec\. 709\)"/);
    assert.match(s, /proj\.listColorProfiles\(\)/);
    assert.match(s, /proj\.workingSpace = ws;/);
    assert.match(s, /proj\.linearizeWorkingSpace = true;/);
    assert.match(s, /proj\.linearBlending = false;/);
    assert.match(s, /proj\.compensateForSceneReferredProfiles = true;/);
    assert.match(none, /var ws = ""/);
    assert.match(none, /proj\.workingGamma = 2\.4;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_color_management', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_color_management', { bitsPerChannel: 10 }), /Allowed: 8, 16, 32/);
    await assert.rejects(mcp.handleToolCall('set_color_management', { workingGamma: 1.8 }), /Allowed: 2\.2, 2\.4/);
});

test('set_display_color runs the View menu colour commands', async () => {
    const [toggle, sim, none, scopes] = await scriptsFor([
        ['set_display_color', { action: 'toggle_display_color_management', comp: { id: 4 } }],
        ['set_display_color', { action: 'simulate_output', output: 'kodak_5218_to_kodak_2383' }],
        ['set_display_color', { action: 'simulate_output', output: 'none' }],
        ['set_display_color', { action: 'lumetri_scopes' }],
    ]);
    assert.match(toggle, /c\.openInViewer\(\)/);
    assert.match(toggle, /var id = 3704;/);
    assert.match(sim, /var id = 3706;/);
    assert.doesNotMatch(sim, /openInViewer/);
    assert.match(none, /var id = 3705;/);
    assert.match(scopes, /app\.findMenuCommandId\("Lumetri Scopes"\) \|\| 10424/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_display_color', { action: 'simulate_output' }), /needs 'output'/);
    await assert.rejects(mcp.handleToolCall('set_display_color', { action: 'simulate_output', output: 'p3' }), /Allowed: none/);
    await assert.rejects(mcp.handleToolCall('set_display_color', { action: 'lumetri_scopes', output: 'srgb' }), /only to simulate_output/);
});

test('apply_color_effect applies colour effects to layers or a new adjustment layer', async () => {
    const [onLayers, adj, converter] = await scriptsFor([
        ['apply_color_effect', { effect: 'lumetri_color', layers: { indexes: [1] }, properties: { Exposure: 0.5 } }],
        ['apply_color_effect', { effect: 'broadcast_colors', adjustmentLayer: true, broadcastLocale: 'pal', broadcastMethod: 'reduce_saturation', maxSignalIre: 100 }],
        ['apply_color_effect', { effect: 'color_profile_converter', adjustmentLayer: true, layerName: 'Simulate Rec. 709' }],
    ]);
    assert.match(onLayers, /match = "ADBE Lumetri"/);
    assert.match(onLayers, /\["Exposure",0\.5\]/);
    assert.match(onLayers, /parade\.addProperty\(match\)/);
    assert.match(adj, /c\.layers\.addSolid\(/);
    assert.match(adj, /adj\.adjustmentLayer = true/);
    assert.match(adj, /\["Broadcast Locale",2\]/);
    assert.match(adj, /\["How To Make Color Safe",2\]/);
    assert.match(adj, /\["Maximum Signal Amplitude \(IRE\)",100\]/);
    assert.match(converter, /match = "ADBE ProfileToProfile"/);
    assert.match(converter, /"Simulate Rec\. 709"/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'curves' }), /Give layers, or adjustmentLayer/);
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'curves', layers: { indexes: [1] }, adjustmentLayer: true }), /not both/);
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'glow', adjustmentLayer: true }), /Allowed: lumetri_color/);
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'curves', adjustmentLayer: true, broadcastLocale: 'ntsc' }), /only to broadcast_colors/);
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'broadcast_colors', adjustmentLayer: true, maxSignalIre: 200 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_color_effect', { effect: 'tint', layers: { indexes: [1] }, layerName: 'x' }), /adjustmentLayer: true/);
});
