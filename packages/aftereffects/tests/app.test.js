/**
 * Application, interface, audio, automation and collaboration tools: the
 * scripts they generate and the arguments they refuse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions } from '../src/server.js';
import { scriptsFor, server, home } from './helpers.js';

/** Call a tool and expect it to be refused with a message matching re. */
async function refused(mcp, name, args, re) {
    await assert.rejects(mcp.handleToolCall(name, args), re, `${name} ${JSON.stringify(args)}`);
}

test('purge uses Application.purge, and menu commands only where scripting has no target', async () => {
    const [s] = await scriptsFor([['purge_caches', { targets: ['all_memory_and_disk', 'all_memory', 'undo', 'image_cache_memory', 'snapshot', 'all_disk_cache', 'all_3d_cache', 'all_cache'] }]]);
    for (const t of ['ALL_CACHES', 'UNDO_CACHES', 'IMAGE_CACHES', 'SNAPSHOT_CACHES']) assert.match(s, new RegExp(`app\\.purge\\(PurgeTarget\\.${t}\\)`));
    assert.match(s, /if \(PurgeTarget\.ALL_MEMORY_CACHES !== undefined\) app\.purge\(PurgeTarget\.ALL_MEMORY_CACHES\); else app\.executeCommand\(2373\)/);
    for (const id of [10700, 10701, 10702]) assert.match(s, new RegExp(`app\\.executeCommand\\(${id}\\)`));
    assert.doesNotMatch(s, /UndoGroup/);
    await refused(await server(), 'purge_caches', { targets: ['everything'] }, /Allowed/);
});

test('edit commands run outside an undo group, and only undo and redo repeat', async () => {
    const [undo, copy] = await scriptsFor([
        ['run_edit_command', { command: 'undo', times: 3 }],
        ['run_edit_command', { command: 'copy', comp: { name: 'Main' } }],
    ]);
    assert.match(undo, /for \(var n = 0; n < 3; n\+\+\) app\.executeCommand\(16\)/);
    assert.doesNotMatch(undo, /UndoGroup/);
    assert.match(copy, /c\.openInViewer\(\); if \(vw\) vw\.setActive\(\);/);
    assert.match(copy, /app\.executeCommand\(19\)/);
    const mcp = await server();
    await refused(mcp, 'run_edit_command', { command: 'paste', times: 2 }, /only to undo and redo/);
    await refused(mcp, 'run_edit_command', { command: 'undo', times: 0 }, /at least 1/);
});

test('info reads preferences by type and file; settings write only documented keys', async () => {
    const [info, settings, saved] = await scriptsFor([
        ['get_aftereffects_info', { preferences: [{ section: 'Main Pref Section v2', key: 'Pref_JAVASCRIPT_DEBUGGER', type: 'bool', file: 'machine_independent' }, { section: 'S"x', key: 'k' }] }],
        ['set_application_settings', { imageCachePercent: 40, maximumMemoryPercent: 70, gpuAcceleration: 'software', javascriptDebugger: true }],
        ['manage_script_settings', { action: 'save', section: 'My Script', key: 'mode', value: 'fast' }],
    ]);
    assert.match(info, /app\.preferences\.getPrefAsBool\(s, k, f\)/);
    assert.match(info, /PREFType\.PREF_Type_MACHINE_INDEPENDENT/);
    assert.match(info, /"S\\"x"/, 'section names are quoted');
    assert.match(info, /system\.osName/);
    assert.match(settings, /app\.setMemoryUsageLimits\(40, 70\)/);
    assert.match(settings, /proj\.gpuAccelType = want/);
    assert.match(settings, /savePrefAsBool\("Main Pref Section v2", "Pref_JAVASCRIPT_DEBUGGER", true, PREFType\.PREF_Type_MACHINE_INDEPENDENT\)/);
    assert.match(settings, /app\.preferences\.saveToDisk\(\); app\.preferences\.reload\(\);/);
    assert.match(saved, /app\.settings\.saveSetting\(s, k, "fast", PREFType\.PREF_Type_MACHINE_SPECIFIC\)/);
    const mcp = await server();
    await refused(mcp, 'set_application_settings', { imageCachePercent: 40 }, /together/);
    await refused(mcp, 'set_application_settings', { gpuAcceleration: 'quantum' }, /Allowed/);
    await refused(mcp, 'set_application_settings', {}, /at least one setting/);
    await refused(mcp, 'manage_script_settings', { action: 'save', section: 's', key: 'k', value: 'x'.repeat(2000) }, /1999 bytes/);
    await refused(mcp, 'get_aftereffects_info', { preferences: [{ section: 's' }] }, /section and key/);
});

test('quit refuses unsaved changes by default and quits from a scheduled task', async () => {
    const [refuse, discard] = await scriptsFor([['quit_aftereffects', {}], ['quit_aftereffects', { unsavedChanges: 'discard' }]]);
    assert.match(refuse, /throw new Error\("The project has unsaved changes/);
    assert.doesNotMatch(discard, /unsaved changes: save it first/);
    assert.match(discard, /proj\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\);\napp\.scheduleTask\("app\.quit\(\);", 500, false\)/);
});

test('view options go to the chosen viewer and view', async () => {
    const [comp, layer, active] = await scriptsFor([
        ['set_view_options', { comp: { id: 3 }, view: 2, zoomPercent: 50, fastPreview: 'wireframe', resolution: 'half', guidesLocked: true }],
        ['set_view_options', { comp: { id: 3 }, layer: 2, channel: 'alpha_overlay', exposure: -2 }],
        ['set_view_options', { pauseViewerUpdates: true }],
    ]);
    assert.match(comp, /v = c\.openInViewer\(\)/);
    assert.match(comp, /v\.activeViewIndex = 1;/);
    assert.match(comp, /o\.zoom = 50 \/ 100;/);
    assert.match(comp, /o\.fastPreview = FastPreviewType\.FP_WIREFRAME;/);
    assert.match(comp, /rc\.resolutionFactor = \[2,2\]/);
    assert.match(comp, /o\.guidesLocked = true;/);
    assert.match(layer, /lyr\.openInViewer\(\)/);
    assert.match(layer, /VIEWER_LAYER/);
    assert.match(layer, /o\.channels = ChannelType\.CHANNEL_ALPHA_OVERLAY;/);
    assert.match(active, /app\.disableRendering = true;/);
    assert.doesNotMatch(active, /openInViewer/);
    const mcp = await server();
    await refused(mcp, 'set_view_options', {}, /at least one option/);
    await refused(mcp, 'set_view_options', { resolution: 'custom' }, /customResolution/);
    await refused(mcp, 'set_view_options', { customResolution: { horizontal: 2, vertical: 2 } }, /resolution: custom/);
    await refused(mcp, 'set_view_options', { zoomPercent: 5000 }, /out of range/);
    await refused(mcp, 'set_view_options', { channel: 'purple' }, /Allowed/);
});

test('view commands, guides, tools, time, panels and workspaces', async () => {
    const s = await scriptsFor([
        ['run_view_command', { command: 'show_grid' }],
        ['edit_comp_guides', { action: 'add', orientation: 'horizontal', position: 540 }],
        ['edit_comp_guides', { action: 'move', guide: 2, position: 100 }],
        ['edit_comp_guides', { action: 'clear' }],
        ['set_current_tool', { tool: 'hand' }],
        ['set_current_tool', { cycle: 'dolly' }],
        ['go_to_time', { frames: -10 }],
        ['go_to_time', { to: 'work_area_end' }],
        ['show_panel', { panel: 'info' }],
        ['switch_workspace', { workspace: 'Review' }],
    ]);
    assert.match(s[0], /v = app\.activeViewer[\s\S]*app\.executeCommand\(2277\)/);
    assert.match(s[1], /c\.addGuide\(0, 540\)/);
    assert.match(s[2], /c\.setGuide\(100, 1\)/);
    assert.match(s[3], /c\.removeGuide\(0\)/);
    assert.match(s[4], /var want = ToolType\.Tool_Hand;/);
    assert.match(s[5], /ToolType\.Tool_CameraDollyTowardsCursor, ToolType\.Tool_CameraDollyToCursor, ToolType\.Tool_CameraDollyCamera/);
    assert.match(s[6], /var t = c\.time \+ -10 \* c\.frameDuration;/);
    assert.match(s[7], /c\.workAreaStart \+ c\.workAreaDuration - c\.frameDuration/);
    assert.match(s[8], /app\.executeCommand\(2028\)/);
    assert.match(s[9], /app\.findMenuCommandId\("Review"\)/);
    const mcp = await server();
    await refused(mcp, 'edit_comp_guides', { action: 'add', position: 10 }, /orientation/);
    await refused(mcp, 'edit_comp_guides', { action: 'remove', guide: 0 }, /starts at 1/);
    await refused(mcp, 'set_current_tool', { tool: 'hand', cycle: 'pen' }, /Give tool or cycle/);
    await refused(mcp, 'go_to_time', { time: 1, frames: 2 }, /exactly one/);
    await refused(mcp, 'go_to_time', { to: 'layer_in' }, /needs layer/);
    await refused(mcp, 'go_to_time', { frames: 1.5 }, /whole number/);
    await refused(mcp, 'switch_workspace', { workspace: 'Quit After Effects' }, /Allowed/);
    await refused(mcp, 'switch_workspace', {}, /Give workspace/);
});

test('audio levels, speed and commands', async () => {
    const [levels, keys, speed, convert] = await scriptsFor([
        ['set_audio_levels', { layers: { indexes: [1] }, levels: -6 }],
        ['set_audio_levels', { layers: { names: ['VO'] }, keyframes: [{ time: 0, levels: [-96, -96] }, { time: 2, levels: 0 }] }],
        ['remap_layer_speed', { layers: { indexes: [2] }, speedPercent: 200 }],
        ['run_audio_command', { command: 'convert_to_keyframes', layers: { indexes: [1] } }],
    ]);
    assert.match(levels, /property\("ADBE Audio Group"\)\.property\("ADBE Audio Levels"\)/);
    assert.match(levels, /var v = \[-6,-6\]/);
    assert.match(keys, /\{"t":0,"v":\[-96,-96\]\},\{"t":2,"v":\[0,0\]\}/);
    assert.match(speed, /l\.timeRemapEnabled = true/);
    assert.match(speed, /var t1 = t0 \+ \(v1 - v0\) \* 100 \/ speed;/);
    assert.match(convert, /app\.findMenuCommandId\("Convert Audio to Keyframes"\) \|\| 4218/);
    const mcp = await server();
    await refused(mcp, 'set_audio_levels', { layers: { indexes: [1] } }, /levels or keyframes/);
    await refused(mcp, 'set_audio_levels', { layers: { indexes: [1] }, levels: [1, 2, 3] }, /\[left, right\]/);
    await refused(mcp, 'set_audio_levels', { layers: { indexes: [1] }, levels: 100 }, /out of range/);
    await refused(mcp, 'remap_layer_speed', { layers: { indexes: [1] }, speedPercent: 0 }, /out of range/);
});

test('script files run in one undo step, on a schedule, or from the Scripts menu', async () => {
    const file = `${home}/Documents/tool.jsx`;
    const [now, later, menu, cancel] = await scriptsFor([
        ['run_aftereffects_script_file', { file, undoName: 'Tool' }],
        ['run_aftereffects_script_file', { file, delaySeconds: 2, repeat: true }],
        ['run_aftereffects_script_file', { scriptsMenuItem: 'Demo Palette.jsx' }],
        ['run_aftereffects_script_file', { cancelTask: 7 }],
    ]);
    assert.match(now, /app\.beginUndoGroup\("Tool"\)/);
    assert.match(now, /\$\.evalFile\(f\)/);
    assert.match(later, /app\.scheduleTask\("\$\.evalFile\(new File\(\\".*tool\.jsx\\"\)\);", 2000, true\)/);
    assert.match(menu, /app\.findMenuCommandId\("Demo Palette\.jsx"\)/);
    assert.match(cancel, /app\.cancelTask\(7\)/);
    const mcp = await server();
    await refused(mcp, 'run_aftereffects_script_file', {}, /exactly one/);
    await refused(mcp, 'run_aftereffects_script_file', { file: `${home}/Documents/a.txt` }, /\.jsx/);
    await refused(mcp, 'run_aftereffects_script_file', { file: '/etc/evil.jsx' }, /allowed|outside|not permitted|Access/i);
    await refused(mcp, 'run_aftereffects_script_file', { scriptsMenuItem: 'Quit After Effects' }, /ending in \.jsx/);
    await refused(mcp, 'run_aftereffects_script_file', { cancelTask: 1, delaySeconds: 3 }, /only with file/);
});

test('motion graphics templates and team projects', async () => {
    const [add, exp, status, resolve] = await scriptsFor([
        ['manage_motion_graphics_template', { action: 'add_property', layers: { indexes: [1] }, property: 'position' }],
        ['manage_motion_graphics_template', { action: 'export', overwrite: true, folder: `${home}/Documents` }],
        ['manage_team_project', { action: 'status' }],
        ['manage_team_project', { action: 'resolve', resolution: 'accept_theirs_and_copy' }],
    ]);
    assert.match(add, /p\.canAddToMotionGraphicsTemplate\(c\)/);
    assert.match(add, /p\.addToMotionGraphicsTemplate\(c\)/);
    assert.match(exp, /c\.exportAsMotionGraphicsTemplate\(true, ".*Documents"\)/);
    assert.doesNotMatch(status, /isLoggedInToTeamProject\(\)\) throw/);
    assert.match(resolve, /proj\.resolveConflict\(ResolveType\.ACCEPT_THEIRS_AND_COPY\)/);
    const mcp = await server();
    await refused(mcp, 'manage_motion_graphics_template', { action: 'add_property' }, /needs property/);
    await refused(mcp, 'manage_motion_graphics_template', { action: 'set_name' }, /needs name/);
    await refused(mcp, 'manage_team_project', { action: 'open' }, /needs name/);
    await refused(mcp, 'manage_team_project', { action: 'resolve' }, /needs resolution/);
    await refused(mcp, 'manage_team_project', { action: 'convert', file: `${home}/Documents/x.aepx` }, /\.aep or \.aet/);
});

test('destructive tools in these areas are annotated', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['purge_caches', 'run_edit_command', 'quit_aftereffects', 'run_aftereffects_script_file', 'manage_team_project']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['get_aftereffects_info', 'get_viewer_state']) assert.equal(byName[n].readOnlyHint, true, n);
});
