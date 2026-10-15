import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('render settings: template, dialog options, frame rate, log, notification', async () => {
    const [s] = await scriptsFor([['set_render_settings', {
        items: [2, 1], template: 'Multi-Machine Settings', quality: 'Best', fieldRender: 'Upper Field First', pulldown: 'WSSWW', frameRate: 23.976,
        skipExistingFiles: true, logType: 'errors_and_settings', notify: true, start: 1, duration: 2, skipFrames: 1, settings: { 'Proxy Use': 'Use No Proxies' },
    }]]);
    const wanted = JSON.parse(/wanted = (\{.*?\}), out = \[\]/.exec(s)[1]);
    assert.deepEqual(wanted, {
        'Proxy Use': 'Use No Proxies', Quality: 'Best', 'Field Render': 'Upper Field First', '3:2 Pulldown': 'WSSWW',
        'Frame Rate': 'Use this frame rate', 'Use this frame rate': 23.976, 'Skip Existing Files': true,
    });
    assert.match(s, /var ids = \[2,1\]/);
    assert.match(s, /it\.applyTemplate\("Multi-Machine Settings"\);/);
    assert.match(s, /__setAll\(it, wanted, "Render item " \+ ids\[i\]\);/);
    assert.match(s, /it\.timeSpanStart = 1;\n {2}it\.timeSpanDuration = 2;/);
    assert.match(s, /it\.logType = LogType\.ERRORS_AND_SETTINGS;/);
    assert.match(s, /it\.queueItemNotify = true;/);
    assert.match(s, /target\.setSettings\(wanted\)/);
    const [comp] = await scriptsFor([['set_render_settings', { items: [1], frameRate: 'comp' }]]);
    assert.match(comp, /"Frame Rate":"Use comp's frame rate"/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [1] }), /template or at least one setting/);
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [] , quality: 'Best' }), /at least one render item/);
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [0], quality: 'Best' }), /numbered from 1/);
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [1], logType: 'everything' }), /Allowed: errors_only/);
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [1], settings: { Quality: [1, 2] } }), /text, a number or true\/false/);
    await assert.rejects(mcp.handleToolCall('set_render_settings', { items: [1], quality: '' }), /dialog's choices/);
});

test('output modules: format by template, settings, file, post-render action, add and remove', async () => {
    const [s, added, removed] = await scriptsFor([
        ['set_output_module', {
            item: 1, format: 'png', outputFile: `${home}/Documents/seq/frame_[#####].png`, channels: 'RGB + Alpha', startingNumber: 1001,
            crop: { top: 4, right: 8 }, resize: { width: 960, height: 540, lockAspectRatio: true }, audio: { output: 'Off', sampleRate: 48000 },
            includeProjectLink: false, includeSourceXmp: true, postRenderAction: 'import_and_replace_usage', fileTemplate: '[compName]_[#####].[fileExtension]',
        }],
        ['set_output_module', { item: 2, add: true, template: 'Lossless' }],
        ['set_output_module', { item: 2, outputModule: 2, remove: true }],
    ]);
    assert.match(s, /function __templateFor\(re, label\)/);
    assert.match(s, /it\.outputModule\(o\)\.applyTemplate\(__templateFor\(new RegExp\("PNG", "i"\), "PNG"\)\);/);
    const wanted = JSON.parse(/wanted = (\{.*?\});\n/.exec(s)[1]);
    assert.deepEqual(wanted, {
        Channels: 'RGB + Alpha', 'Output File Info': { 'File Template': '[compName]_[#####].[fileExtension]' }, 'Starting #': 1001, 'Use Comp Frame Number': false,
        'Include Project Link': false, Resize: true, 'Lock Aspect Ratio': true, Crop: true, 'Crop Top': 4, 'Crop Right': 8, 'Output Audio': 'Off', 'Audio Sample Rate': 48000,
    });
    assert.match(s, /to\[wk\] = 960; to\[hk\] = 540; wanted\["Resize to"\] = to;/);
    assert.match(s, /it\.outputModule\(o\)\.postRenderAction = PostRenderAction\.IMPORT_AND_REPLACE_USAGE;/);
    assert.match(s, /it\.outputModule\(o\)\.includeSourceXMP = true;/);
    assert.match(s, /it\.outputModule\(o\)\.file = new File\(".*\/Documents\/seq\/frame_\[#####\]\.png"\);/);
    assert.match(added, /it\.outputModules\.add\(\); o = it\.numOutputModules;/);
    assert.match(added, /it\.outputModule\(o\)\.applyTemplate\("Lossless"\);/);
    assert.doesNotMatch(added, /__templateFor/);
    assert.match(removed, /if \(it\.numOutputModules < 2\) throw/);
    assert.match(removed, /it\.outputModule\(o\)\.remove\(\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1 }), /at least one change/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, format: 'gif' }), /Allowed: quicktime/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, format: 'png', template: 'Lossless' }), /template or format, not both/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, remove: true, channels: 'RGB' }), /cannot be combined/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, add: true, outputModule: 2 }), /leave out outputModule/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, resize: { width: 100 } }), /width and height/);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 1, outputFile: '/etc/out.png' }), /outside|allowed|not permitted/i);
    await assert.rejects(mcp.handleToolCall('set_output_module', { item: 0, channels: 'RGB' }), /1-based/);
});

test('queue control, frame and pre-render queueing, duplicates, read-outs, render engine', async () => {
    const [frame, pre, dup, pause, read, engine, mfrOff] = await scriptsFor([
        ['queue_render', { outputFile: `${home}/Documents/frame.psd`, frame: 2.5 }],
        ['queue_render', { outputFile: `${home}/Documents/pre.mov`, preRender: true, outputModule: 'Lossless' }],
        ['manage_render_queue', { action: 'duplicate', items: [1, 3] }],
        ['control_render_queue', { action: 'pause', notify: true }],
        ['get_render_item', { items: [1] }],
        ['configure_render_engine', { multiFrameRendering: true, maxCpuPercent: 75, watchFolder: 'start', folder: `${home}/Documents/watch` }],
        ['configure_render_engine', { multiFrameRendering: false }],
    ]);
    assert.match(frame, /it\.timeSpanStart = 2\.5; it\.timeSpanDuration = c\.frameDuration;/);
    assert.match(pre, /it\.outputModule\(1\)\.postRenderAction = PostRenderAction\.IMPORT_AND_REPLACE_USAGE;/);
    assert.match(dup, /for \(var d = ids\.length - 1; d >= 0; d--\) rq\.item\(ids\[d\]\)\.duplicate\(\);/);
    assert.match(pause, /rq\.pauseRendering\(true\);/);
    assert.match(pause, /rq\.queueNotify = true;/);
    assert.match(read, /getSettings\(GetSettingsFormat\.STRING_SETTABLE\)/);
    assert.match(read, /\["Output File Info"\]\["File Template"\]/);
    assert.match(engine, /app\.setMultiFrameRenderingConfig\(true, 75\);/);
    assert.match(engine, /app\.scheduleTask\("app\.watchFolder\(new Folder\(" \+ __json\(wf\.fsName\) \+ "\)\)", 500, false\);/);
    assert.match(mfrOff, /app\.setMultiFrameRenderingConfig\(false, 100\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('queue_render', { outputFile: `${home}/Documents/a.mov`, frame: 1, start: 0 }), /cannot be combined/);
    await assert.rejects(mcp.handleToolCall('manage_render_queue', { action: 'duplicate' }), /needs items/);
    await assert.rejects(mcp.handleToolCall('control_render_queue', { action: 'restart' }), /Allowed: status/);
    await assert.rejects(mcp.handleToolCall('configure_render_engine', { watchFolder: 'start' }), /needs folder/);
    await assert.rejects(mcp.handleToolCall('configure_render_engine', { maxCpuPercent: 50 }), /goes with multiFrameRendering/);
    await assert.rejects(mcp.handleToolCall('configure_render_engine', { watchFolder: 'start', folder: '/etc' }), /outside|allowed|not permitted/i);
});

test('Essential Graphics: primary composition, names, controls, dropdowns, media replacement', async () => {
    const [set, controls] = await scriptsFor([
        ['set_essential_graphics', { comp: { name: 'Lower Third' }, templateName: 'Lower Third', renameControls: [{ index: 2, name: 'Title' }] }],
        ['add_essential_graphics_controls', { controls: [
            { layer: 1, property: 'source_text', name: 'Headline' },
            { layer: 'Controls', property: ['ADBE Effect Parade', 'Dropdown Menu Control', 'Menu'], menuItems: ['Left', 'Center', 'Right'] },
            { layer: 3 },
        ] }],
    ]);
    assert.match(set, /c\.openInEssentialGraphics\(\);/);
    assert.match(set, /c\.motionGraphicsTemplateName = "Lower Third";/);
    assert.match(set, /c\.setMotionGraphicsControllerName\(renames\[i\]\[0\], renames\[i\]\[1\]\);/);
    const specs = JSON.parse(/specs = (\[.*?\]), added = \[\]/.exec(controls)[1]);
    assert.deepEqual(specs, [
        { layer: { indexes: [1] }, path: ['ADBE Text Properties', 'ADBE Text Document'], label: 'Headline' },
        { layer: { names: ['Controls'] }, path: ['ADBE Effect Parade', 'Dropdown Menu Control', 'Menu'], items: ['Left', 'Center', 'Right'] },
        { layer: { indexes: [3] } },
    ]);
    assert.match(controls, /p = p\.setPropertyParameters\(s\.items\);/);
    assert.match(controls, /p\.addToMotionGraphicsTemplateAs\(c, s\.label\) : p\.addToMotionGraphicsTemplate\(c\)/);
    assert.match(controls, /l\.addToMotionGraphicsTemplateAs\(c, s\.label\) : l\.addToMotionGraphicsTemplate\(c\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [] }), /at least one control/);
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [{ layer: 1, property: 'wobble' }] }), /unknown shortcut/);
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [{ layer: 1, menuItems: ['A'] }] }), /needs the Dropdown Menu Control/);
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [{ layer: 1, property: ['Menu'], menuItems: ['A', 'A'] }] }), /unique/);
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [{ layer: 1, property: ['Menu'], menuItems: ['A|B'] }] }), /"\|"/);
    await assert.rejects(mcp.handleToolCall('add_essential_graphics_controls', { controls: [{ layer: true }] }), /layer index/);
    await assert.rejects(mcp.handleToolCall('set_essential_graphics', { renameControls: [{ index: 0, name: 'A' }] }), /1-based/);
});

test('Essential Graphics: protected regions and template export', async () => {
    const [intro, outro, work, local, drive] = await scriptsFor([
        ['add_protected_region', { region: 'intro' }],
        ['add_protected_region', { region: 'outro', comment: 'End card' }],
        ['add_protected_region', { region: 'work_area' }],
        ['export_motion_graphics_template', {}],
        ['export_motion_graphics_template', { folder: `${home}/Documents/templates`, templateName: 'Title', overwrite: true }],
    ]);
    assert.match(intro, /var t = 0, d = c\.duration \* 0\.15;/);
    assert.match(intro, /m\.protectedRegion = true;\nc\.markerProperty\.setValueAtTime\(t, m\);/);
    assert.match(outro, /var d = c\.duration \* 0\.15, t = c\.duration - d;/);
    assert.match(work, /var t = c\.workAreaStart, d = c\.workAreaDuration;/);
    assert.match(local, /if \(!c\.motionGraphicsTemplateName\) c\.motionGraphicsTemplateName = c\.name;/);
    assert.match(local, /var ok = c\.exportAsMotionGraphicsTemplate\(false\);/);
    assert.match(drive, /c\.motionGraphicsTemplateName = "Title";/);
    assert.match(drive, /var ok = c\.exportAsMotionGraphicsTemplate\(true, f\.fsName\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_protected_region', { region: 'custom', start: 1 }), /needs start and duration/);
    await assert.rejects(mcp.handleToolCall('add_protected_region', { region: 'intro', start: 1 }), /go with region/);
    await assert.rejects(mcp.handleToolCall('add_protected_region', { region: 'middle' }), /Allowed: intro/);
    await assert.rejects(mcp.handleToolCall('export_motion_graphics_template', { folder: '/etc' }), /outside|allowed|not permitted/i);
    await assert.rejects(mcp.handleToolCall('export_motion_graphics_template', { templateName: ' ' }), /must be text/);
});
