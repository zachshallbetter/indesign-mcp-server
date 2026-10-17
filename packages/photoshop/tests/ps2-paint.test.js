/**
 * Painting and retouching, round 2: options-bar settings in set_tool_options,
 * the Brush Settings panel, brush preset management, scripted pattern fills,
 * and the Clone Source panel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const tool = async (name) => (await import('../src/server.js')).toolTable.find((t) => t.name === name);
const definition = async (name) => (await import('../src/server.js')).toolDefinitions.find((t) => t.name === name);

test('set_tool_options writes options-bar settings into currentToolOptions on the tool class', async () => {
    const [bucket, brush, plain] = await scriptsFor([
        ['set_tool_options', { tool: 'paint_bucket', mode: 'multiply', tolerance: 40, contiguous: false }],
        ['set_tool_options', { tool: 'brush', smoothing: 50, pulledStringMode: true, strokeCatchUp: false, catchUpOnStrokeEnd: true, adjustForZoom: true, pressureControlsSize: true, pressureControlsOpacity: false }],
        ['set_tool_options', { tool: 'mixer_brush' }],
    ]);
    assert.match(bucket, /app\.currentTool = "bucketTool";/);
    assert.match(bucket, /\["opt",\[\],\["mode"\],"multiply","mode",false\]/);
    assert.match(bucket, /\["opt",\[\],\["tolerance","@BckT"\],40,"tolerance",false\]/);
    assert.match(bucket, /\["opt",\[\],\["contiguous"\],false,"contiguous",false\]/);
    assert.match(bucket, /r\.putClass\(__tid\(app\.currentTool\)\);/);
    assert.match(bucket, /d\.putObject\(__tid\("to"\), __tid\("null"\), cto\);/);
    assert.match(bucket, /out\.settings = __settings;/);
    assert.match(brush, /\["opt",\[\],\["smooth"\],50,"smoothing",false\],\["opt",\[\],\["smoothingValue"\],128,"smoothingValue",false\]/);
    for (const key of ['smoothingRadiusMode', 'smoothingCatchup', 'smoothingCatchupAtEnd', 'smoothingZoomCompensation', 'usePressureOverridesSize', 'usePressureOverridesOpacity']) {
        assert.match(brush, new RegExp(`\\["${key}"\\]`));
    }
    // Earlier calls are unchanged: no tool-options helpers, no settings readback.
    assert.match(plain, /app\.currentTool = "wetBrushTool";/);
    assert.doesNotMatch(plain, /__applyToolEdits|out\.settings/);

    const [mixer] = await scriptsFor([['set_tool_options', { wet: 30, mix: 70, sampleAllLayers: true }]]);
    assert.match(mixer, /\["wetness"\],30,"wet"/);
    assert.match(mixer, /\["mix"\],70,"mix"/);
    assert.match(mixer, /\["sampleAllLayers"\],true,"sampleAllLayers"/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_tool_options', {}), /Give tool, preset/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { mode: 'plaid' }), /Invalid value for 'mode'/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { smoothing: 120 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { contiguous: 'yes' }), /must be true or false/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { tolerance: 300 }), /out of range/);

    const t = await tool('set_tool_options');
    for (const id of ['photoshop.painting.mixer_brush_tool', 'photoshop.painting.brush_tool_option.pulled_string_mode', 'photoshop.painting.paint_bucket_tool_option.contiguous',
        'photoshop.painting.eraser_tool_option.opacity', 'photoshop.retouching.spot_healing_brush_tool', 'photoshop.retouching.red_eye_tool']) {
        assert.ok(t.features.includes(id), id);
    }
});

test('set_brush_settings edits the tip on the brush and the dynamics in currentToolOptions', async () => {
    const [s, cleared] = await scriptsFor([
        ['set_brush_settings', {
            tool: 'brush',
            tipShape: { size: 30, angle: 45, roundness: 60, spacing: 25, useSpacing: true, flipY: true },
            shapeDynamics: { enabled: true, sizeJitter: { jitter: 40, control: 'pen_pressure' }, minimumDiameter: 10, flipXJitter: true },
            scattering: { enabled: true, scatter: { jitter: 500 }, bothAxes: true, count: 3 },
            texture: { enabled: true, invert: true, depth: 50 },
            dualBrush: { enabled: true, size: 12, spacing: 30, scatter: { jitter: 20 } },
            colorDynamics: { hueJitter: 10, foregroundBackgroundJitter: { jitter: 50, control: 'fade', fadeSteps: 30 } },
            transfer: { enabled: true, flowJitter: { jitter: 20, minimum: 5 } },
            brushPose: { enabled: true, tiltX: -20, rotation: 90, overridePressure: true },
            buildUp: true, wetEdges: false,
        }],
        ['set_brush_settings', { clearControls: true }],
    ]);
    assert.match(s, /app\.currentTool = "paintbrushTool";/);
    assert.match(s, /\["size",\[\],\["diameter"\],30,"tipShape\.size",false\]/);
    assert.match(s, /\["tip",\[\],\["angle"\],45,"tipShape\.angle",false\]/);
    assert.match(s, /\["tip",\[\],\["interfaceIconFrameDimmed"\],true,"tipShape\.useSpacing",false\]/);
    assert.match(s, /\["opt",\[\],\["useTipDynamics"\],true,"shapeDynamics\.enabled",false\]/);
    assert.match(s, /\["opt",\["@szVr"\],\["jitter"\],40,"shapeDynamics\.sizeJitter\.jitter",true\]/);
    assert.match(s, /\["opt",\["@szVr"\],\["@bVTy"\],2,"shapeDynamics\.sizeJitter\.control",true\]/);
    assert.match(s, /\["opt",\[\],\["flipX"\],true,"shapeDynamics\.flipXJitter",false\]/);
    assert.match(s, /\["opt",\["scatterDynamics"\],\["jitter"\],500,"scattering\.scatter\.jitter",true\]/);
    assert.match(s, /\["opt",\["dualBrush","brush"\],\["diameter"\],12,"dualBrush\.size",false\]/);
    assert.match(s, /\["opt",\["dualBrush","scatterDynamics"\],\["jitter"\],20,"dualBrush\.scatter\.jitter",true\]/);
    assert.match(s, /\["opt",\["@clVr"\],\["@bVTy"\],1,"colorDynamics\.foregroundBackgroundJitter\.control",true\]/);
    assert.match(s, /\["opt",\["@clVr"\],\["@fStp"\],30,/);
    assert.match(s, /\["opt",\["@prVr"\],\["minimum"\],5,"transfer\.flowJitter\.minimum",true\]/);
    assert.match(s, /\["opt",\[\],\["brushPoseAngle"\],90,"brushPose\.rotation",false\]/);
    assert.match(s, /\["opt",\[\],\["repeat"\],true,"buildUp",false\]/);
    assert.match(s, /\["opt",\[\],\["wetEdges"\],false,"wetEdges",false\]/);
    assert.match(s, /b\.putUnitDouble\(__tid\("masterDiameter"\), __tid\("pixelsUnit"\), size\);/);
    assert.match(s, /r\.putEnumerated\(__tid\("brush"\), __tid\("ordinal"\), __tid\("targetEnum"\)\);/);
    assert.doesNotMatch(s, /clearBrushControls/);
    assert.match(cleared, /app\.executeAction\(app\.stringIDToTypeID\("clearBrushControls"\), new ActionDescriptor\(\), DialogModes\.NO\);/);
    assert.match(cleared, /var __settings = \{\};/);

    const mcp = await server();
    const bad = (args, re) => assert.rejects(mcp.handleToolCall('set_brush_settings', args), re);
    await bad({}, /Give clearControls or a setting/);
    await bad({ tipShape: 5 }, /'tipShape' must be an object/);
    await bad({ tipShape: { diameter: 5 } }, /Unknown setting tipShape\.diameter/);
    await bad({ shapeDynamics: { sizeJitter: { minimum: 5 } } }, /Unknown setting shapeDynamics\.sizeJitter\.minimum/);
    await bad({ shapeDynamics: { sizeJitter: {} } }, /needs at least one of/);
    await bad({ shapeDynamics: { angleJitter: { control: 'wobble' } } }, /Invalid value for 'shapeDynamics\.angleJitter\.control'/);
    await bad({ transfer: { opacityJitter: { control: 'fade', fadeSteps: 2.5 } } }, /must be a whole number/);
    await bad({ scattering: { scatter: { jitter: 1500 } } }, /out of range/);
    await bad({ scattering: { count: 20 } }, /out of range/);
    await bad({ noise: 'on' }, /must be true or false/);
    await bad({ tool: 'lasso', noise: true }, /Invalid value for 'tool'/);

    const t = await tool('set_brush_settings');
    for (const id of ['photoshop.painting.brush_settings_panel', 'photoshop.painting.brush_settings_dual_brush', 'photoshop.painting.brush_settings_option.pen_pressure_pen_tilt_stylus_wheel',
        'photoshop.painting.brush_tip_option.clear_brush_controls', 'photoshop.painting.brush_tip_option.tilt_x', 'photoshop.painting.brush_settings_airbrush_build_up']) {
        assert.ok(t.features.includes(id), id);
    }
});

test('manage_brushes creates, renames, deletes and resets brush presets', async () => {
    const [made, renamed, deleted, reset] = await scriptsFor([
        ['manage_brushes', { action: 'new_preset', name: 'Ink 2' }],
        ['manage_brushes', { action: 'rename', preset: 'Ink 2', name: 'Ink Final' }],
        ['manage_brushes', { action: 'delete', preset: 'Ink Final' }],
        ['manage_brushes', { action: 'reset', append: true }],
    ]);
    assert.match(made, /d\.putString\(sid\("name"\), "Ink 2"\);/);
    assert.match(made, /src\.putProperty\(sid\("property"\), sid\("currentToolOptions"\)\);/);
    assert.match(made, /app\.executeAction\(sid\("make"\), d, DialogModes\.NO\);/);
    assert.match(renamed, /ref\.putName\(sid\("brush"\), "Ink 2"\);/);
    assert.match(renamed, /to\.putString\(sid\("name"\), "Ink Final"\);\nd\.putObject\(sid\("to"\), sid\("brush"\), to\);\napp\.executeAction\(sid\("set"\), d, DialogModes\.NO\);/);
    assert.match(deleted, /ref\.putName\(sid\("brush"\), "Ink Final"\);/);
    assert.match(deleted, /app\.executeAction\(sid\("delete"\), d, DialogModes\.NO\);/);
    assert.match(reset, /ref\.putProperty\(sid\("property"\), sid\("brush"\)\);/);
    assert.match(reset, /d\.putBoolean\(sid\("append"\), true\);\napp\.executeAction\(sid\("reset"\), d, DialogModes\.NO\);/);

    const mcp = await server();
    const bad = (args, re) => assert.rejects(mcp.handleToolCall('manage_brushes', args), re);
    await bad({ action: 'rename', name: 'X' }, /rename needs preset/);
    await bad({ action: 'rename', preset: 'X' }, /rename needs name/);
    await bad({ action: 'delete' }, /delete needs preset/);
    await bad({ action: 'new_preset' }, /new_preset needs a name/);
    await bad({ action: 'define', name: 'X', preset: 'Y' }, /preset applies only to rename and delete/);
    await bad({ action: 'delete', preset: 'X', append: true }, /append applies only to reset/);
    await bad({ action: 'reset', name: 'X' }, /name applies only to define/);

    assert.equal((await definition('manage_brushes')).annotations.destructiveHint, true);
    const t = await tool('manage_brushes');
    for (const id of ['rename_brush', 'delete', 'reset_brushes', 'new_brush_preset']) assert.ok(t.features.includes(`photoshop.painting.brushes_panel_option.${id}`), id);
});

test('fill_contents runs a scripted pattern with its settings and no dialog', async () => {
    const [brick, along, plain] = await scriptsFor([
        ['fill_contents', { contents: 'pattern', pattern: 'Bubbles', script: 'brick_fill', scriptOptions: { offset: 25, rotateAngle: 10 } }],
        ['fill_contents', { contents: 'pattern', pattern: 'Leaf', script: 'place_along_path', scriptPath: 'Curve', scriptOptions: { alternate: false, spacing: 4 } }],
        ['fill_contents', { contents: 'pattern', pattern: 'Bubbles', script: 'symmetry_fill' }],
    ]);
    assert.match(brick, /new File\(app\.path\.fsName \+ "\/Presets\/Deco\/" \+ "Brick Fill\.jsx"\)/);
    assert.match(brick, /d\.putPath\(sid\("decoScriptFile"\), __deco\);/);
    assert.match(brick, /d\.putString\(sid\("decoScriptParameters"\), "\(\{\\"offset\\":25,\\"rotateAngle\\":10\}\)"\);/);
    assert.match(brick, /script: "brick_fill"/);
    assert.match(along, /var __decoPath = doc\.pathItems\.getByName\("Curve"\);\n__decoPath\.select\(\);/);
    assert.match(along, /app\.executeAction\(sid\("fill"\), d, DialogModes\.NO\);\n__decoPath\.deselect\(\);/);
    assert.match(along, /\\"alternate\\":false/);
    assert.match(plain, /"Symmetry Fill\.jsx"/);
    assert.match(plain, /sid\("decoScriptParameters"\), "\(\{\}\)"\);/);

    const mcp = await server();
    const bad = (args, re) => assert.rejects(mcp.handleToolCall('fill_contents', args), re);
    await bad({ contents: 'white', script: 'brick_fill' }, /script applies only to contents pattern/);
    await bad({ contents: 'pattern', pattern: 'P', scriptOptions: { offset: 1 } }, /apply only with script/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'tiles' }, /Invalid value for 'script'/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'cross_weave', scriptOptions: { offset: 1 } }, /Unknown scriptOptions\.offset/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'brick_fill', scriptOptions: { offset: 500 } }, /out of range/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'place_along_path' }, /needs scriptPath/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'brick_fill', scriptPath: 'Curve' }, /scriptPath does not apply/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'symmetry_fill', scriptOptions: { symmetryType: 2.5 } }, /whole number/);
    await bad({ contents: 'pattern', pattern: 'P', script: 'random_fill', scriptOptions: { applyRotation: 1 } }, /must be true or false/);

    const t = await tool('fill_contents');
    for (const f of ['brick_fill', 'cross_weave', 'place_along_path', 'random_fill', 'symmetry_fill']) assert.ok(t.features.includes(`photoshop.painting.fill_script_${f}`), f);
    assert.ok((await tool('stroke_path')).features.includes('photoshop.painting.pattern_stamp_painting'));
});

test('set_clone_source_options runs the Clone Source panel menu items', async () => {
    const [s] = await scriptsFor([['set_clone_source_options', { source: 3, resetTransform: true, toggle: ['show_overlay', 'clipped', 'auto_hide', 'invert'] }]]);
    assert.match(s, /app\.runMenuItem\(app\.stringIDToTypeID\("cloneSourceSource3"\)\);\napp\.runMenuItem\(app\.stringIDToTypeID\("cloneSourceResetTransform"\)\);/);
    for (const id of ['cloneSourceShowOverlay', 'cloneSourceClipOverlay', 'cloneSourceAutoHideOverlay', 'cloneSourceInvertOverlay']) assert.match(s, new RegExp(`"${id}"`));

    const mcp = await server();
    const bad = (args, re) => assert.rejects(mcp.handleToolCall('set_clone_source_options', args), re);
    await bad({}, /Give source, resetTransform or toggle/);
    await bad({ source: 6 }, /must be 1, 2, 3, 4 or 5/);
    await bad({ toggle: ['sparkle'] }, /Invalid value for 'toggle\[0\]'/);
    await bad({ toggle: [] }, /must be a list/);
    await bad({ resetTransform: 'yes' }, /must be true or false/);

    const t = await tool('set_clone_source_options');
    for (const id of ['clone_source_panel', 'clone_source_panel_option.multiple_sources', 'clone_source_panel_option.reset_transform', 'clone_source_panel_option.clipped']) {
        assert.ok(t.features.includes(`photoshop.retouching.${id}`), id);
    }
});
