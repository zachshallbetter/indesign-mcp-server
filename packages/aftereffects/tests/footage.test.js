/**
 * Footage and project command tools: generated scripts and argument checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

const docs = `${home}/Documents`;

test('get_footage_info reads every source kind and the missing state', async () => {
    const [all, some] = await scriptsFor([
        ['get_footage_info', {}],
        ['get_footage_info', { items: [3, 4], missingOnly: true }],
    ]);
    assert.match(all, /var want = null/);
    assert.match(all, /s instanceof FileSource \? "file" : \(s instanceof SolidSource \? "solid" : \(s instanceof PlaceholderSource/);
    assert.match(all, /info\.proxy = it\.proxySource \? __sourceInfo\(it\.proxySource\) : null;/);
    assert.match(some, /var want = \[3,4\]/);
    assert.match(some, /if \(true && !list\[k\]\.footageMissing\) continue;/);
});

test('interpret_footage sets each Interpret Footage option on the chosen source', async () => {
    const [main, proxy, copy] = await scriptsFor([
        ['interpret_footage', { items: [5], alpha: 'premultiplied', matteColor: '#FF0000', invertAlpha: true, frameRate: 23.976, fields: 'upper_first', preserveEdges: true, pulldown: 'WSSWW', pixelAspect: 0.9091, loop: 3 }],
        ['interpret_footage', { items: [5], source: 'proxy', alpha: 'guess', pulldown: 'guess_24pa' }],
        ['interpret_footage', { items: [6, 7], copyFrom: 5 }],
    ]);
    assert.match(main, /s\.alphaMode = AlphaMode\.PREMULTIPLIED;/);
    assert.match(main, /s\.premulColor = \[1,0,0\];/);
    assert.match(main, /s\.invertAlpha = true;/);
    assert.match(main, /s\.conformFrameRate = 23\.976;/);
    assert.match(main, /s\.fieldSeparationType = FieldSeparationType\.UPPER_FIELD_FIRST;\n {2}s\.highQualityFieldSeparation = true;\n {2}s\.removePulldown = PulldownPhase\.WSSWW;/, 'fields are set before pulldown');
    assert.match(main, /s\.loop = 3;/);
    assert.match(main, /it\.pixelAspect = 0\.9091;/);
    assert.match(main, /var s = it\.mainSource;/);
    assert.match(proxy, /var it = __avItem\(ids\[i\]\);\n {2}var s = it\.proxySource;/);
    assert.match(proxy, /s\.guessAlphaMode\(\);/);
    assert.match(proxy, /s\.guessPulldown\(PulldownMethod\.ADVANCE_24P\);/);
    assert.match(copy, /var from = __footage\(5\), fs = from\.mainSource;/);
    assert.match(copy, /s\.alphaMode = fs\.alphaMode;/);
    assert.match(copy, /it\.pixelAspect = from\.pixelAspect;/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5] }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [] , loop: 2 }), /at least one item/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5], source: 'proxy', pixelAspect: 1 }), /not its proxy/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5], alpha: 'opaque' }), /Allowed: ignore, straight, premultiplied, guess/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5], pulldown: 'WWWWW' }), /Invalid value for 'pulldown'/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5], frameRate: -1 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('interpret_footage', { items: [5], matteColor: 'red' }), /#RRGGBB/);
});

test('replace_footage uses the FootageItem replace methods and With Layered Comp', async () => {
    const [file, seq, ph, solid, layered] = await scriptsFor([
        ['replace_footage', { item: 2, with: 'file', file: `${docs}/new.mov` }],
        ['replace_footage', { item: 2, with: 'sequence', file: `${docs}/seq/frame_0001.png`, forceAlphabetical: true }],
        ['replace_footage', { item: 2, with: 'placeholder', name: 'Shot 12', width: 1920, height: 1080, frameRate: 24, duration: 5 }],
        ['replace_footage', { item: 2, with: 'solid', color: 'rgb(0,0,255)' }],
        ['replace_footage', { item: 2, with: 'layered_comp' }],
    ]);
    assert.match(file, /it\.replace\(f\);/);
    assert.match(seq, /it\.replaceWithSequence\(f, true\);/);
    assert.match(ph, /it\.replaceWithPlaceholder\("Shot 12", 1920, 1080, 24, 5\);/);
    assert.match(solid, /it\.replaceWithSolid\(\[0,0,1\], it\.name, it\.width, it\.height, it\.pixelAspect\);/);
    assert.match(layered, /__selectOnly\(it\);\napp\.executeCommand\(3070\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('replace_footage', { item: 2, with: 'file' }), /'file' is required/);
    await assert.rejects(mcp.handleToolCall('replace_footage', { item: 2, with: 'file', file: '/etc/passwd' }), /outside|allowed|not permitted/i);
    await assert.rejects(mcp.handleToolCall('replace_footage', { item: 2, with: 'solid' }), /needs 'color'/);
    await assert.rejects(mcp.handleToolCall('replace_footage', { item: 2, with: 'nothing' }), /Allowed: file, sequence/);
});

test('set_proxy sets, removes and switches proxies', async () => {
    const [file, none, solid, ph, toggle] = await scriptsFor([
        ['set_proxy', { items: [8], proxy: 'file', file: `${docs}/proxy.mov`, useProxy: true }],
        ['set_proxy', { items: [8, 9], proxy: 'none' }],
        ['set_proxy', { items: [8], proxy: 'solid', color: '#000000', width: 960, height: 540 }],
        ['set_proxy', { items: [8], proxy: 'placeholder' }],
        ['set_proxy', { items: [8, 9], useProxy: false }],
    ]);
    assert.match(file, /it\.setProxy\(f\);/);
    assert.match(file, /it\.useProxy = true;/);
    assert.match(none, /it\.setProxyToNone\(\);/);
    assert.match(solid, /it\.setProxyWithSolid\(\[0,0,0\], it\.name, 960, 540, it\.pixelAspect\);/);
    assert.match(ph, /it\.setProxyWithPlaceholder\(it\.name, it\.width, it\.height, \(it\.frameRate > 0 \? it\.frameRate : 30\), \(it\.duration > 0 \? it\.duration : 10\)\);/);
    assert.match(toggle, /it\.useProxy = false;/);
    assert.doesNotMatch(toggle, /setProxy/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_proxy', { items: [8] }), /Pass proxy, useProxy/);
    await assert.rejects(mcp.handleToolCall('set_proxy', { items: [8, 9], proxy: 'file', file: `${docs}/p.mov` }), /one item at a time/);
});

test('create_proxy queues the composition with Set Proxy as the post-render action', async () => {
    const [still, movie] = await scriptsFor([
        ['create_proxy', { comp: { id: 4 }, kind: 'still', outputFile: `${docs}/still.psd`, time: 2 }],
        ['create_proxy', { kind: 'movie', outputFile: `${docs}/proxy.mov`, outputModule: 'Lossless' }],
    ]);
    assert.match(still, /om\.postRenderAction = PostRenderAction\.SET_PROXY;/);
    assert.match(still, /rq\.timeSpanStart = 2;\nrq\.timeSpanDuration = c\.frameDuration;/);
    assert.match(still, /om\.applyTemplate\("Photoshop"\)/);
    assert.match(movie, /om\.applyTemplate\("Lossless"\);/);
    assert.doesNotMatch(movie, /timeSpan/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_proxy', { kind: 'movie', outputFile: `${docs}/p.mov`, time: 1 }), /'time' is for a still/);
    await assert.rejects(mcp.handleToolCall('create_proxy', { kind: 'still', outputFile: '/etc/p.psd' }), /outside|allowed|not permitted/i);
});

test('create_footage_item makes placeholders and bare solids', async () => {
    const [ph, solid] = await scriptsFor([
        ['create_footage_item', { kind: 'placeholder', name: 'Missing shot', width: 3840, height: 2160, frameRate: 25, duration: 8, folder: 3 }],
        ['create_footage_item', { kind: 'solid', name: 'Grey', color: '#808080' }],
    ]);
    assert.match(ph, /var it = proj\.importPlaceholder\("Missing shot", 3840, 2160, 25, 8\);/);
    assert.match(ph, /it\.parentFolder = folder;/);
    assert.doesNotMatch(ph, /replaceWithSolid/);
    assert.match(solid, /it\.replaceWithSolid\(\[0\.502,0\.502,0\.502\], "Grey", 1920, 1080, 1\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_footage_item', { kind: 'solid', name: 'Grey' }), /needs 'color'/);
    await assert.rejects(mcp.handleToolCall('create_footage_item', { kind: 'placeholder', name: ' ' }), /'name' is required/);
    await assert.rejects(mcp.handleToolCall('create_footage_item', { kind: 'placeholder', name: 'A', width: 0 }), /out of range/);
});

test('reload_footage, open_footage, scene edits and SVG paste', async () => {
    const [reload, viewer, finder, bridge, browse, original, sed, split, paste] = await scriptsFor([
        ['reload_footage', { items: [2] }],
        ['open_footage', { item: 2, target: 'footage_panel' }],
        ['open_footage', { item: 2, target: 'finder' }],
        ['open_footage', { item: 2, target: 'bridge' }],
        ['open_footage', { target: 'bridge' }],
        ['open_footage', { item: 2, target: 'original_application' }],
        ['detect_scene_edits', { layers: { indexes: [1] } }],
        ['detect_scene_edits', { layers: { indexes: [1, 2] }, mode: 'split_precomp' }],
        ['paste_svg_as_shapes', { comp: { name: 'Logo' } }],
    ]);
    assert.match(reload, /it\.mainSource\.reload\(\);/);
    assert.match(viewer, /it\.openInViewer\(\);/);
    assert.match(finder, /app\.executeCommand\(2562\);/);
    assert.match(bridge, /app\.executeCommand\(3690\);/);
    assert.match(browse, /app\.executeCommand\(3689\);/);
    assert.match(original, /app\.executeCommand\(2142\);/);
    assert.match(sed, /doSceneEditDetection\(SceneEditDetectionMode\.MARKERS\)/);
    assert.match(split, /doSceneEditDetection\(SceneEditDetectionMode\.SPLIT_PRECOMP\)/);
    assert.match(paste, /c\.openInViewer\(\);\napp\.executeCommand\(20\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_footage', { target: 'finder' }), /needs 'item'/);
    await assert.rejects(mcp.handleToolCall('detect_scene_edits', { layers: { indexes: [1] }, mode: 'cut' }), /Allowed: markers, split, split_precomp, none/);
    await assert.rejects(mcp.handleToolCall('reload_footage', { items: [] }), /at least one item/);
});

test('save_project_copy copies .aep files and saves .aepx copies as XML', async () => {
    const [aep, xml] = await scriptsFor([
        ['save_project_copy', { filePath: `${docs}/copy.aep` }],
        ['save_project_copy', { filePath: `${docs}/copy.aepx`, saveFirst: true }],
    ]);
    assert.match(aep, /if \(proj\.dirty\) throw new Error\("The project has unsaved changes/);
    assert.match(aep, /original\.copy\(target\.fsName\)/);
    assert.match(xml, /if \(proj\.dirty\) proj\.save\(\);/);
    assert.match(xml, /proj\.save\(target\);\nproj\.save\(original\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('save_project_copy', { filePath: `${docs}/copy.txt` }), /\.aep or \.aepx/);
});

test('run_project_command closes, reverts, opens the most recent project and increments', async () => {
    const [close, discard, revert, recent, increment] = await scriptsFor([
        ['run_project_command', { command: 'close', unsaved: 'save' }],
        ['run_project_command', { command: 'close', unsaved: 'discard' }],
        ['run_project_command', { command: 'revert' }],
        ['run_project_command', { command: 'open_most_recent' }],
        ['run_project_command', { command: 'increment_and_save' }],
    ]);
    assert.match(close, /proj\.close\(CloseOptions\.SAVE_CHANGES\);/);
    assert.match(discard, /proj\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\);/);
    assert.match(revert, /proj\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\);\nvar reopened = app\.open\(f\);/);
    assert.match(recent, /throw new Error\("The project has unsaved changes: pass unsaved/);
    assert.match(recent, /app\.executeCommand\(2330\);/);
    assert.match(increment, /app\.executeCommand\(3088\);/);
    for (const s of [close, revert, recent, increment]) assert.doesNotMatch(s, /UndoGroup/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_project_command', { command: 'revert', unsaved: 'save' }), /does not apply/);
    await assert.rejects(mcp.handleToolCall('run_project_command', { command: 'quit' }), /Allowed: close, revert/);
});

test('set_project_settings sets time display and thumbnail options, or only reads', async () => {
    const [set, read] = await scriptsFor([
        ['set_project_settings', { timeDisplay: 'frames', footageStart: 'zero', feetAndFrames: true, filmType: '16mm', frameCount: 'start_at_1', bitsPerChannel: 16, expressionEngine: 'javascript', transparencyGridThumbnails: true }],
        ['set_project_settings', {}],
    ]);
    assert.match(set, /proj\.timeDisplayType = TimeDisplayType\.FRAMES;/);
    assert.match(set, /proj\.footageTimecodeDisplayStartType = FootageTimecodeDisplayStartType\.FTCS_START_0;/);
    assert.match(set, /proj\.framesUseFeetFrames = true;/);
    assert.match(set, /proj\.feetFramesFilmType = FeetFramesFilmType\.MM16;/);
    assert.match(set, /proj\.framesCountType = FramesCountType\.FC_START_1;/);
    assert.match(set, /proj\.bitsPerChannel = 16;/);
    assert.match(set, /proj\.expressionEngine = "javascript-1\.0";/);
    assert.match(set, /proj\.transparencyGridThumbnails = true;/);
    assert.doesNotMatch(read, /UndoGroup|proj\.\w+ = /);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_project_settings', { bitsPerChannel: 12 }), /Allowed: 8, 16, 32/);
    await assert.rejects(mcp.handleToolCall('set_project_settings', { frameCount: 'start_at_2' }), /Allowed: timecode_conversion/);
});

test('project panel: find, select, comment', async () => {
    const [find, select, add, comment] = await scriptsFor([
        ['find_project_items', { text: 'Shot', status: 'unused', type: 'footage' }],
        ['select_project_items', { items: [1, 2], showPanel: true }],
        ['select_project_items', { items: [3], mode: 'add' }],
        ['set_item_comment', { items: [1], comment: 'Camera A' }],
    ]);
    assert.match(find, /var text = "shot", status = "unused", type = "footage"/);
    assert.match(find, /it\.usedIn\.length === 0/);
    assert.match(select, /sel\[s\]\.selected = false;/);
    assert.match(select, /proj\.showWindow\(true\);/);
    assert.doesNotMatch(add, /sel\[s\]\.selected = false;/);
    assert.match(add, /it\.selected = true;/);
    assert.match(comment, /it\.comment = "Camera A";/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('find_project_items', {}), /Pass text, status or type/);
    await assert.rejects(mcp.handleToolCall('select_project_items', { mode: 'add' }), /needs 'items'/);
    await assert.rejects(mcp.handleToolCall('set_item_comment', { items: [1] }), /must be text/);
});

test('missing dependencies, fonts and XMP metadata', async () => {
    const [footage, effects, fonts, list, replace, read, write] = await scriptsFor([
        ['find_missing_dependencies', { kind: 'footage', reveal: true }],
        ['find_missing_dependencies', { kind: 'effects' }],
        ['find_missing_dependencies', { kind: 'fonts' }],
        ['resolve_project_fonts', {}],
        ['resolve_project_fonts', { replace: [{ from: 'Arial-BoldMT', to: 'Helvetica-Bold' }] }],
        ['edit_project_metadata', {}],
        ['edit_project_metadata', { xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', showPanel: true }],
    ]);
    assert.match(footage, /app\.executeCommand\(4004\);/);
    assert.match(footage, /it\.mainSource\.missingFootagePath/);
    assert.match(effects, /app\.executeCommand\(4002\);/);
    assert.match(fonts, /if \(f\.isSubstitute\)/);
    assert.doesNotMatch(fonts, /executeCommand/);
    assert.doesNotMatch(list, /replaceFont\("/);
    assert.match(replace, /var pairs = \[\{"from":"Arial-BoldMT","to":"Helvetica-Bold"\}\]/);
    assert.match(replace, /proj\.replaceFont\(pairs\[p\]\.from, pairs\[p\]\.to\)/);
    assert.doesNotMatch(read, /proj\.xmpPacket = /);
    assert.match(write, /proj\.xmpPacket = "<x:xmpmeta xmlns:x=\\"adobe:ns:meta\/\\"><\/x:xmpmeta>";/);
    assert.match(write, /app\.executeCommand\(3788\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('resolve_project_fonts', { replace: [{ from: 'Arial' }] }), /needs 'from' and 'to'/);
    await assert.rejects(mcp.handleToolCall('edit_project_metadata', { xmp: 'title=Hello' }), /XMP packet/);
});

test('import formats, templates and the footage commands are claimed', async () => {
    const { toolTable } = await import('../src/server.js');
    const claims = (name) => toolTable.find((t) => t.name === name).features;
    for (const f of ['format_png', 'format_quicktime', 'format_json', 'format_prproj', 'import_adobe_premiere_project']) assert.ok(claims('import_files').includes(`aftereffects.footage.${f}`), f);
    assert.ok(claims('open_project').includes('aftereffects.projects.project_templates'));
});
