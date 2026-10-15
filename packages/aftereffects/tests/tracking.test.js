import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const L1 = { indexes: [1] };

test('start_tracking selects the layer and runs the tracking command', async () => {
    const [motion, mask, prop, mocha, panel, workspace] = await scriptsFor([
        ['start_tracking', { action: 'track_motion', layers: L1, time: 2 }],
        ['start_tracking', { action: 'track_mask', layers: L1, masks: [1, 2] }],
        ['start_tracking', { action: 'track_property', layers: L1, property: 'position' }],
        ['start_tracking', { action: 'paste_mocha_mask', layers: L1 }],
        ['start_tracking', { action: 'tracker_panel' }],
        ['start_tracking', { action: 'workspace' }],
    ]);
    assert.match(motion, /c\.time = 2;/);
    assert.match(motion, /c\.openInViewer\(\)/);
    assert.match(motion, /l\.selected = true/);
    assert.match(motion, /var id = 2568;/);
    assert.match(motion, /app\.executeCommand\(id\)/);
    assert.match(mask, /"ADBE Mask Parade"/);
    assert.match(mask, /mg\.property\(want\[w\]\)\.selected = true/);
    assert.match(mask, /var id = 10311;/);
    assert.match(prop, /tp\.selected = true/);
    assert.match(prop, /"ADBE Position"/);
    assert.match(prop, /var id = 2643;/);
    assert.match(mocha, /__commandId\(\["Paste Mocha mask"/);
    assert.match(panel, /__commandId\(\["Tracker"\]\)/);
    assert.doesNotMatch(panel, /__oneLayer\(c, \{/);
    assert.match(workspace, /__commandId\(\["Motion Tracking"\]\)/);
});

test('start_tracking refuses arguments that do not fit the action', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'analyze', layers: L1 }), /Allowed: track_motion/);
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'track_property', layers: L1 }), /needs 'property'/);
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'track_motion', layers: L1, masks: [1] }), /only to action track_mask/);
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'track_mask', layers: L1, masks: [0] }), /1-based/);
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'tracker_panel', layers: L1 }), /does not apply/);
    await assert.rejects(mcp.handleToolCall('start_tracking', { action: 'track_motion' }), /Choose the layers/);
});

test('apply_warp_stabilizer adds or reuses the effect and sets its controls', async () => {
    const [s] = await scriptsFor([['apply_warp_stabilizer', {
        layers: L1, result: 'no_motion', method: 'perspective', framing: 'stabilize_synthesize_edges', smoothness: 30,
        preserveScale: true, maximumScale: 120, rollingShutterRipple: 'enhanced_reduction', synthesisEdgeCropping: { left: 2, bottom: 6 },
        objective: 'apply_motion_to_target', targetLayer: 2, hideWarningBanner: true,
    }]]);
    assert.match(s, /__effectOn\(ls\[i\], "ADBE SubspaceStabilizer", false\)/);
    assert.match(s, /\["Result",2\]/);
    assert.match(s, /\["Method",3\]/);
    assert.match(s, /\["Framing",4\]/);
    assert.match(s, /\["Rolling Shutter Ripple",2\]/);
    assert.match(s, /\["Objective",4\]/);
    assert.match(s, /\["Left",2\]/);
    assert.match(s, /\["Bottom",6\]/);
    assert.match(s, /\["Preserve Scale",true\]/);
    assert.match(s, /pairs\.push\(\["Target Layer", 2\]\)/);
    assert.match(s, /p\.setValue\(pairs\[k\]\[1\]\)/);
});

test('apply_warp_stabilizer refuses bad options', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_warp_stabilizer', { layers: L1, method: 'warp' }), /Allowed: position/);
    await assert.rejects(mcp.handleToolCall('apply_warp_stabilizer', { layers: L1, smoothness: -5 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_warp_stabilizer', { layers: L1, synthesisEdgeCropping: { middle: 3 } }), /unknown edge/);
    await assert.rejects(mcp.handleToolCall('apply_warp_stabilizer', { layers: L1, objective: 'stabilize', targetLayer: 2 }), /apply_motion_to_target/);
});

test('apply_camera_tracker adds the 3D Camera Tracker with its options', async () => {
    const [s] = await scriptsFor([['apply_camera_tracker', { layers: L1, solveMethod: 'tripod_pan', detailedAnalysis: true, autoDeletePoints: false, addNew: true }]]);
    assert.match(s, /__effectOn\(ls\[i\], "ADBE 3D Tracker", true\)/);
    assert.match(s, /\["Solve Method",4\]/);
    assert.match(s, /\["Detailed Analysis",true\]/);
    assert.match(s, /\["Auto-delete Points Across Time",false\]/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_camera_tracker', { layers: L1, solveMethod: 'flat' }), /Allowed: auto_detect/);
});

test('get_tracking_data reads track points and face measurements', async () => {
    const [trackers, face] = await scriptsFor([
        ['get_tracking_data', { layers: L1, time: 1.5, keyframes: true, limit: 50 }],
        ['get_tracking_data', { layers: L1, source: 'face' }],
    ]);
    assert.match(trackers, /"ADBE MTrackers"/);
    assert.match(trackers, /"ADBE MTracker Pt Feature Center"/);
    assert.match(trackers, /"ADBE MTracker Pt Confidence"/);
    assert.match(trackers, /p\.valueAtTime\(t, false\)/);
    assert.match(trackers, /t = 1\.5, max = 50/);
    assert.match(trackers, /p\.keyTime\(k\)/);
    assert.match(face, /fx\.name\.indexOf\("Face"\)/);
    assert.match(face, /t = c\.time/);
    assert.doesNotMatch(face, /keyTime/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('get_tracking_data', { layers: L1, source: 'mocha' }), /Allowed: trackers, face/);
});

test('set_track_point edits a track point and refuses bad values', async () => {
    const [s, k] = await scriptsFor([
        ['set_track_point', { layers: L1, tracker: 'Tracker 1', point: 2, featureCenter: [320, 180], searchSize: [80, 80] }],
        ['set_track_point', { layers: L1, time: 2, attachPoint: [10, 20] }],
    ]);
    assert.match(s, /mt\.property\("Tracker 1"\)/);
    assert.match(s, /tr\.property\(2\)/);
    assert.match(s, /"ADBE MTracker Pt Feature Center","Feature Center",\[320,180\]/);
    assert.match(s, /"ADBE MTracker Pt Search Size","Search Size",\[80,80\]/);
    assert.match(s, /else p\.setValue\(values\[i\]\[2\]\)/);
    assert.match(k, /p\.setValueAtTime\(2, values\[i\]\[2\]\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_track_point', { layers: L1 }), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_track_point', { layers: L1, featureCenter: [1, 2, 3] }), /\[x, y\]/);
    await assert.rejects(mcp.handleToolCall('set_track_point', { layers: L1, point: 0, featureSize: [10, 10] }), /1-based/);
    await assert.rejects(mcp.handleToolCall('set_track_point', { layers: L1, confidence: [1, 1] }), /at least one/);
});
