/**
 * 3D tools: camera, light, material and geometry options, renderers, 3D views,
 * camera commands and camera tools.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const L1 = { indexes: [1] };

test('camera options set the Camera Options group, F-Stop through Aperture, and check the layer', async () => {
    const [s, keyed] = await scriptsFor([
        ['set_camera_options', { layers: L1, zoom: 1200, depthOfField: true, focusDistance: 800, fStop: 2.8, blurLevel: 150, irisShape: 'hexagon', irisRoundness: 20, highlightGain: 10 }],
        ['set_camera_options', { layers: L1, aperture: 25, pointOfInterest: [960, 540, 0], time: 2 }],
    ]);
    assert.match(s, /if \(!\(l instanceof CameraLayer\)\) throw new Error\(l\.name \+ " is not a camera layer"\);\n {2}var g = l\.cameraOption;/);
    assert.match(s, /__set\(g\.depthOfField, 1, t\);/);
    assert.match(s, /__set\(g\.zoom, 1200, t\);/);
    assert.match(s, /__set\(g\.focusDistance, 800, t\);/);
    assert.match(s, /__set\(g\.aperture, g\.zoom\.valueAtTime\(t === null \? c\.time : t, false\) \/ 2\.8, t\);/);
    assert.match(s, /__set\(g\.irisShape, 5, t\);/);
    assert.match(s, /t = null/);
    assert.match(keyed, /t = 2/);
    assert.match(keyed, /var wasLocked[^\n]*\n {2}if \(l\.autoOrient !== AutoOrientType\.CAMERA_OR_POINT_OF_INTEREST\) throw[^\n]*\n {2}__set\(g\.aperture, 25, t\);/, 'the Point of Interest check runs before anything changes');
    assert.match(keyed, /__set\(l\.property\("ADBE Transform Group"\)\.property\("ADBE Point of Interest"\), \[960,540,0\], t\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_camera_options', { layers: L1 }), /at least one camera option/);
    await assert.rejects(mcp.handleToolCall('set_camera_options', { layers: L1, fStop: 2, aperture: 10 }), /fStop or aperture/);
    await assert.rejects(mcp.handleToolCall('set_camera_options', { layers: L1, irisShape: 'circle' }), /Allowed: fast_rectangle/);
    await assert.rejects(mcp.handleToolCall('set_camera_options', { layers: L1, irisRoundness: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_camera_options', { layers: L1, pointOfInterest: [1, 2] }), /\[x, y, z\]/);
    await assert.rejects(mcp.handleToolCall('set_camera_options', { zoom: 100 }), /Choose the layers/);
});

test('light options set type first, colour, falloff, shadows and an environment source', async () => {
    const [s] = await scriptsFor([
        ['set_light_options', { layers: L1, lightType: 'spot', color: '#FF8000', intensity: 120, coneAngle: 60, coneFeather: 40, falloff: 'inverse_square_clamped', radius: 300, falloffDistance: 600, castsShadows: true, shadowDarkness: 80, shadowDiffusion: 12, pointOfInterest: [0, 0, 0], lightSource: 4 }],
    ]);
    assert.match(s, /var g = l\.lightOption;\n {2}var wasLocked = l\.locked; l\.locked = false;\n {2}l\.lightType = LightType\.SPOT;\n {2}if \(l\.autoOrient/);
    assert.match(s, /__set\(g\.color, \[1,0\.502,0\], t\);/);
    assert.match(s, /__set\(g\.falloff, 3, t\);/);
    assert.match(s, /__set\(g\.castsShadows, 1, t\);/);
    assert.match(s, /__set\(g\.shadowDarkness, 80, t\);/);
    assert.match(s, /var src = c\.layer\(4\);[^\n]*l\.lightSource = src;/);
    assert.match(s, /if \(!\(l instanceof LightLayer\)\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_light_options', { layers: L1, lightType: 'environment' }), /Allowed: parallel, spot, point, ambient/);
    await assert.rejects(mcp.handleToolCall('set_light_options', { layers: L1, color: 'orange' }), /#RRGGBB/);
    await assert.rejects(mcp.handleToolCall('set_light_options', { layers: L1, falloff: 'linear' }), /Allowed: none, smooth/);
    await assert.rejects(mcp.handleToolCall('set_light_options', { layers: L1, coneAngle: 270 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_light_options', { layers: L1 }), /at least one light option/);
});

test('material options need a 3D layer; the environment layer switch alone does not', async () => {
    const [s, env] = await scriptsFor([
        ['set_material_options', { layers: L1, castsShadows: 'only', acceptsShadows: 'only', appearsInReflections: 'off', acceptsLights: false, specularIntensity: 70, metal: 100, transparency: 50, indexOfRefraction: 1.33 }],
        ['set_material_options', { layers: L1, environmentLayer: true }],
    ]);
    assert.match(s, /if \(!l\.threeDLayer\) throw new Error\(l\.name \+ " is not a 3D layer/);
    assert.match(s, /var g = l\.materialOption;/);
    assert.match(s, /__set\(g\.castsShadows, 2, t\);/);
    assert.match(s, /__set\(g\.acceptsShadows, 2, t\);/);
    assert.match(s, /__set\(g\.appearsInReflections, 0, t\);/);
    assert.match(s, /__set\(g\.acceptsLights, 0, t\);/);
    assert.match(s, /__set\(g\.indexOfRefraction, 1\.33, t\);/);
    assert.match(env, /l\.environmentLayer = true;/);
    assert.doesNotMatch(env, /if \(!l\.threeDLayer\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_material_options', { layers: L1, castsShadows: 'yes' }), /Allowed: off, on, only/);
    await assert.rejects(mcp.handleToolCall('set_material_options', { layers: L1, indexOfRefraction: 0.5 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_material_options', { layers: L1, diffuse: 101 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_material_options', { layers: L1 }), /at least one material option/);
});

test('geometry options extrude, bevel and bend 3D layers', async () => {
    const [s] = await scriptsFor([
        ['set_geometry_options', { layers: L1, bevelStyle: 'convex', bevelDepth: 4, holeBevelDepth: 50, extrusionDepth: 40, curvature: -25, segments: 12 }],
    ]);
    assert.match(s, /var g = l\.geometryOption;/);
    assert.match(s, /__set\(g\.bevelStyle, 4, t\);/);
    assert.match(s, /__set\(g\.extrusionDepth, 40, t\);/);
    assert.match(s, /__set\(g\.curvature, -25, t\);/);
    assert.match(s, /__set\(g\.segments, 12, t\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_geometry_options', { layers: L1, bevelStyle: 'round' }), /Allowed: none, angular, concave, convex/);
    await assert.rejects(mcp.handleToolCall('set_geometry_options', { layers: L1, segments: 2.5 }), /whole number/);
    await assert.rejects(mcp.handleToolCall('set_geometry_options', { layers: L1, curvature: 200 }), /out of range/);
});

test('the 3D renderer is checked against the installed renderers; Draft 3D is a switch', async () => {
    const [adv, raw, draft, read] = await scriptsFor([
        ['set_comp_3d_settings', { renderer: 'advanced_3d' }],
        ['set_comp_3d_settings', { comp: { id: 3 }, renderer: 'ADBE Ernst' }],
        ['set_comp_3d_settings', { draft3d: true }],
        ['set_comp_3d_settings', {}],
    ]);
    assert.match(adv, /var want = "ADBE Calder", ok = false;/);
    assert.match(adv, /for \(var r = 0; r < c\.renderers\.length; r\+\+\)/);
    assert.match(adv, /c\.renderer = want;/);
    assert.match(raw, /var want = "ADBE Ernst"/);
    assert.match(draft, /c\.draft3d = true;/);
    assert.doesNotMatch(read, /UndoGroup|c\.renderer = /);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_comp_3d_settings', { renderer: 'x"); app.quit(); ("' }), /renderer/);
});

test('3D views run the View menu commands in the composition\'s viewer', async () => {
    const [front, last, look, cam] = await scriptsFor([
        ['set_3d_view', { view: 'front' }],
        ['set_3d_view', { view: 'last' }],
        ['set_3d_view', { action: 'look_at_all_layers' }],
        ['set_3d_view', { action: 'create_camera' }],
    ]);
    assert.match(front, /c\.openInViewer\(\);\nvar before = __ids\(c\);\napp\.executeCommand\(2711\);/);
    assert.match(last, /app\.executeCommand\(2703\);/);
    assert.match(look, /app\.executeCommand\(2835\);/);
    assert.match(cam, /app\.executeCommand\(2645\);/);
    assert.match(cam, /added: __added\(c, before\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_3d_view', {}), /view or action/);
    await assert.rejects(mcp.handleToolCall('set_3d_view', { view: 'front', action: 'reset' }), /view or action/);
    await assert.rejects(mcp.handleToolCall('set_3d_view', { view: 'isometric' }), /Allowed: active_camera/);
});

test('camera commands select the camera (and target) and run the Layer menu command', async () => {
    const [focus, rig, model] = await scriptsFor([
        ['run_camera_command', { command: 'link_focus_to_layer', layer: 1, target: 3 }],
        ['run_camera_command', { command: 'create_stereo_3d_rig', layer: 2 }],
        ['run_camera_command', { command: 'create_lights_from_3d_model', layer: 4 }],
    ]);
    assert.match(focus, /if \(!\(l instanceof CameraLayer\)\)/);
    assert.match(focus, /for \(var i = 1; i <= c\.numLayers; i\+\+\) c\.layer\(i\)\.selected = false;\nl\.selected = true;\nif \(target\) target\.selected = true;/);
    assert.match(focus, /var tn = 3;/);
    assert.match(focus, /app\.executeCommand\(3847\);/);
    assert.match(rig, /app\.executeCommand\(3843\);/);
    assert.match(rig, /var target = null;/);
    assert.match(model, /if \(!\(l instanceof ThreeDModelLayer\)\)/);
    assert.match(model, /app\.executeCommand\(10721\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_camera_command', { command: 'set_focus_to_layer', layer: 1 }), /needs 'target'/);
    await assert.rejects(mcp.handleToolCall('run_camera_command', { command: 'create_orbit_null', layer: 1, target: 2 }), /takes no 'target'/);
    await assert.rejects(mcp.handleToolCall('run_camera_command', { command: 'link_focus_to_layer', layer: 2, target: 2 }), /different layer/);
    await assert.rejects(mcp.handleToolCall('run_camera_command', { command: 'zoom_in', layer: 1 }), /Allowed: link_focus_to_point_of_interest/);
});

test('camera tools set the project tool type', async () => {
    const [u, d] = await scriptsFor([
        ['set_camera_tool', { tool: 'unified' }],
        ['set_camera_tool', { tool: 'dolly_to_cursor' }],
    ]);
    assert.match(u, /proj\.toolType = ToolType\.Tool_CameraMaya;/);
    assert.match(d, /proj\.toolType = ToolType\.Tool_CameraDollyToCursor;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_camera_tool', { tool: 'zoom' }), /Allowed: unified/);
});
