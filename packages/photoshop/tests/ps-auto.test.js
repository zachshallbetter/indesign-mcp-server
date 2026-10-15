/**
 * Automation, history and artboard tools: generated scripts and argument checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';

const docs = path.join(home, 'Documents');
const at = (f) => path.join(docs, f);

async function refused(name, args, pattern) {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall(name, args), pattern);
}

test('list_action_sets walks action sets, actions and steps through the Action Manager', async () => {
    const [plain, steps] = await scriptsFor([['list_action_sets', {}], ['list_action_sets', { steps: true }]]);
    assert.match(plain, /r\.putIndex\(__c\("ASet"\), i\);/);
    assert.match(plain, /ar\.putIndex\(__c\("Actn"\), j\);/);
    assert.match(plain, /__actionSets\(false\)/);
    assert.match(steps, /cr\.putIndex\(__c\("Cmnd"\), k\);/);
    assert.match(steps, /__actionSets\(true\)/);
});

test('edit_actions creates, deletes, clears, resets, loads and saves action sets', async () => {
    const [create, delSet, delAction, delStep, clear, reset, load, preset, save] = await scriptsFor([
        ['edit_actions', { operation: 'create_set', set: 'Web' }],
        ['edit_actions', { operation: 'delete', set: 'Web' }],
        ['edit_actions', { operation: 'delete', set: 'Web', action: 'Resize' }],
        ['edit_actions', { operation: 'delete', set: 'Web', action: 'Resize', step: 2 }],
        ['edit_actions', { operation: 'clear_all' }],
        ['edit_actions', { operation: 'reset' }],
        ['edit_actions', { operation: 'load', filePath: at('web.atn') }],
        ['edit_actions', { operation: 'load', preset: 'Frames' }],
        ['edit_actions', { operation: 'save', set: 'Web', filePath: at('web.atn') }],
    ]);
    assert.match(create, /d\.putClass\(__c\("Nw  "\), __c\("ASet"\)\);\nd\.putString\(__c\("Nm  "\), "Web"\);\napp\.executeAction\(__c\("Mk  "\), d, DialogModes\.NO\);/);
    assert.match(delSet, /__actionRef\("Web", null, null\)\);\napp\.executeAction\(__c\("Dlt "\), d, DialogModes\.NO\);/);
    assert.match(delAction, /__actionRef\("Web", "Resize", null\)/);
    assert.match(delStep, /__actionRef\("Web", "Resize", 2\)/);
    assert.match(delStep, /if \(step\) r\.putIndex\(__c\("Cmnd"\), step\);/);
    assert.match(clear, /for \(var i = all\.length - 1; i >= 0; i--\)/);
    assert.doesNotMatch(clear, /Default Actions/);
    assert.match(reset, /new File\(app\.path \+ "\/Presets\/Actions\/Default Actions\.atn"\);[\s\S]*app\.load\(def\);/);
    assert.match(load, /var f = new File\(".*web\.atn"\);[\s\S]*app\.load\(f\);/);
    assert.match(preset, /new File\(app\.path \+ "\/Presets\/Actions\/" \+ "Frames\.atn"\)/);
    assert.match(save, /d\.putPath\(__c\("T   "\), f\);\napp\.executeAction\(__c\("save"\), d, DialogModes\.NO\);/);
    await refused('edit_actions', { operation: 'create_set' }, /create_set needs 'set'/);
    await refused('edit_actions', { operation: 'delete', set: 'Web', step: 2 }, /'step' needs 'action'/);
    await refused('edit_actions', { operation: 'load' }, /load needs 'filePath' or 'preset'/);
    await refused('edit_actions', { operation: 'load', filePath: at('web.txt') }, /must be an \.atn file/);
    await refused('edit_actions', { operation: 'load', preset: '../../evil' }, /without a path/);
    await refused('edit_actions', { operation: 'save', set: 'Web', filePath: '/etc/web.atn' }, /Access denied/);
    await refused('edit_actions', { operation: 'clear_all', set: 'Web' }, /'set' does not apply to clear_all/);
});

test('set_action_options sets playback options and toggles the panel modes', async () => {
    const [pause, accel, toggles] = await scriptsFor([
        ['set_action_options', { playback: 'pause', pauseSeconds: 4 }],
        ['set_action_options', { playback: 'step_by_step' }],
        ['set_action_options', { toggleButtonMode: true, toggleToolRecording: true }],
    ]);
    assert.match(pause, /r\.putProperty\(__c\("Prpr"\), __c\("PbkO"\)\);/);
    assert.match(pause, /__s\("performance"\), __s\("performance"\), __s\("pause"\)\);\np\.putInteger\(__s\("pause"\), 4\);/);
    assert.match(pause, /app\.executeAction\(__c\("setd"\), d, DialogModes\.NO\);/);
    assert.match(accel, /__s\("stepByStep"\)/);
    assert.match(toggles, /app\.runMenuItem\(__s\("buttonMode"\)\);\napp\.runMenuItem\(__s\("allowToolRecording"\)\);/);
    await refused('set_action_options', {}, /Give playback/);
    await refused('set_action_options', { playback: 'accelerated', pauseSeconds: 2 }, /applies to playback pause/);
    await refused('set_action_options', { playback: 'pause', pauseSeconds: 99 }, /out of range/);
});

test('run_action_batch builds BatchOptions from a folder, files or open documents', async () => {
    const [folder, files, open] = await scriptsFor([
        ['run_action_batch', {
            action: 'Resize', set: 'Web', sourceFolder: docs, includeSubfolders: true, extensions: ['.JPG', 'png'],
            overrideOpen: true, destination: 'folder', destinationFolder: at('out'), overrideSaveAs: true,
            fileNaming: ['document_name_lower', 'serial_3', 'extension_lower'], startingSerial: 5,
            compatibility: { windows: true, macos: true, unix: true }, errorLog: at('errors.txt'),
        }],
        ['run_action_batch', { action: 'Resize', set: 'Web', files: [at('a.jpg'), at('b.jpg')], destination: 'save_and_close' }],
        ['run_action_batch', { action: 'Resize', set: 'Web', openDocuments: true }],
    ]);
    assert.match(folder, /var input = __collect\(src, true, \["jpg","png"\], \[\]\);/);
    assert.match(folder, /o\.overrideOpen = true;/);
    assert.match(folder, /o\.destination = BatchDestinationType\.FOLDER;/);
    assert.match(folder, /o\.fileNaming = \[FileNamingType\.DOCUMENTNAMELOWER, FileNamingType\.SERIALNUMBER3, FileNamingType\.EXTENSIONLOWER\];/);
    assert.match(folder, /o\.startingSerial = 5;/);
    assert.match(folder, /o\.overrideSave = true;/);
    assert.match(folder, /o\.windowsCompatible = true;\no\.macintoshCompatible = true;\no\.unixCompatible = true;/);
    assert.match(folder, /o\.errorFile = new File\(".*errors\.txt"\);/);
    assert.match(folder, /app\.batch\(input, "Resize", "Web", o\);/);
    assert.match(files, /var input = \[new File\(".*a\.jpg"\), new File\(".*b\.jpg"\)\];/);
    assert.match(files, /BatchDestinationType\.SAVEANDCLOSE/);
    assert.doesNotMatch(files, /o\.fileNaming/);
    assert.match(open, /input\.push\(of\);/);
    assert.match(open, /BatchDestinationType\.NODESTINATION/);
    await refused('run_action_batch', { action: 'A', set: 'S' }, /Give one source/);
    await refused('run_action_batch', { action: 'A', set: 'S', files: [at('a.jpg')], openDocuments: true }, /Give one source/);
    await refused('run_action_batch', { action: 'A', set: 'S', openDocuments: true, destination: 'folder' }, /needs 'destinationFolder'/);
    await refused('run_action_batch', { action: 'A', set: 'S', openDocuments: true, fileNaming: ['serial_1'] }, /applies to destination folder/);
    await refused('run_action_batch', { action: 'A', set: 'S', openDocuments: true, destination: 'folder', destinationFolder: docs, fileNaming: Array(7).fill('serial_1') }, /1 to 6 parts/);
    await refused('run_action_batch', { action: 'A', set: 'S', sourceFolder: '/etc' }, /Access denied/);
    await refused('run_action_batch', { action: 'A', set: 'S', files: [at('a.jpg')], includeSubfolders: true }, /apply to sourceFolder/);
    await refused('run_action_batch', { action: 'A', set: 'S', sourceFolder: docs, extensions: ['j/pg'] }, /not an extension/);
});

test('create_droplet passes the action and batch options to createDroplet', async () => {
    const [s] = await scriptsFor([['create_droplet', {
        filePath: at('Resize.app'), action: 'Resize', set: 'Web', destination: 'folder', destinationFolder: at('out'),
        fileNaming: ['document_name', 'mmddyy'], overrideSaveAs: true, errorLog: at('log.txt'),
    }]]);
    assert.match(s, /d\.putPath\(__c\("In  "\), new File\(".*Resize\.app"\)\);/);
    assert.match(s, /u\.putName\(__c\("Actn"\), "Resize"\);\nu\.putName\(__c\("ASet"\), "Web"\);\nd\.putReference\(__c\("Usng"\), u\);/);
    assert.match(s, /nc\.putEnumerated\(__s\("component"\), __s\("fileNamingComponent"\), __c\("Nm  "\)\);/);
    assert.match(s, /__s\("fileNamingComponent"\), __s\("mmddyy"\)\);/);
    assert.match(s, /d\.putObject\(__s\("fileNamingRules"\), __s\("fileNamingRules"\), rules\);/);
    assert.match(s, /d\.putBoolean\(__c\("Ovrd"\), true\);/);
    assert.match(s, /d\.putPath\(__c\("Log "\), log\.parent\);/);
    assert.match(s, /app\.executeAction\(__s\("createDroplet"\), d, DialogModes\.NO\);/);
    await refused('create_droplet', { filePath: '/Library/x.app', action: 'A', set: 'S' }, /Access denied/);
    await refused('create_droplet', { filePath: at('x.app'), set: 'S' }, /'action' is required/);
});

test('run_automate_command runs each File > Automate and Scripts command with its descriptor', async () => {
    const [crop, fit, mode, lens, empty, effects, masks] = await scriptsFor([
        ['run_automate_command', { command: 'crop_and_straighten' }],
        ['run_automate_command', { command: 'fit_image', width: 1200, height: 800, dontEnlarge: true }],
        ['run_automate_command', { command: 'conditional_mode_change', sourceModes: ['rgb', 'lab'], targetMode: 'cmyk', flatten: true }],
        ['run_automate_command', { command: 'lens_correction', chromaticAberration: true, edge: 'white' }],
        ['run_automate_command', { command: 'delete_empty_layers' }],
        ['run_automate_command', { command: 'flatten_layer_effects' }],
        ['run_automate_command', { command: 'flatten_masks' }],
    ]);
    assert.match(crop, /app\.executeAction\(__s\("CropPhotosAuto0001"\), new ActionDescriptor\(\), DialogModes\.NO\);/);
    assert.match(fit, /d\.putUnitDouble\(__s\("width"\), __c\("#Pxl"\), 1200\);/);
    assert.match(fit, /d\.putBoolean\(__s\("limit"\), true\);\napp\.executeAction\(__s\("3caa3434-cb67-11d1-bc43-0060b0a13dc4"\), d, DialogModes\.NO\);/);
    assert.match(mode, /l\.putEnumerated\(__c\("Cndn"\), __c\("URGB"\)\);\nl\.putEnumerated\(__c\("Cndn"\), __c\("ULab"\)\);/);
    assert.match(mode, /d\.putObject\(__c\("DstM"\), __c\("CMYM"\), new ActionDescriptor\(\)\);\nd\.putBoolean\(__c\("Mrge"\), true\);/);
    assert.match(mode, /__s\("8cba8cd6-cb66-11d1-bc43-0060b0a13dc4"\)/);
    assert.match(lens, /d\.putBoolean\(__c\("LnAg"\), true\);\nd\.putBoolean\(__c\("LnAc"\), true\);/);
    assert.match(lens, /d\.putInteger\(__c\("LnFt"\), 4\);\napp\.executeAction\(__c\("LnCr"\), d, DialogModes\.NO\);/);
    assert.match(empty, /__s\("a0754df2-9c60-4b64-a940-6a2bb1102652"\)/);
    assert.match(effects, /__s\("8a761c74-f362-4a1b-a3f7-e779ab319a08"\)/);
    assert.match(masks, /__s\("e805a6ee-6d75-4b62-b6fe-f5873b5fdf20"\)/);
    await refused('run_automate_command', { command: 'fit_image', width: 100 }, /needs width and height/);
    await refused('run_automate_command', { command: 'conditional_mode_change' }, /needs targetMode/);
    await refused('run_automate_command', { command: 'conditional_mode_change', targetMode: 'indexed' }, /Allowed: grayscale/);
    await refused('run_automate_command', { command: 'flatten_masks', width: 100 }, /'width' applies to fit_image/);
    await refused('run_automate_command', { command: 'image_processor' }, /Allowed: crop_and_straighten/);
});

test('combine_images loads Adobe\'s multi-file scripts with their script flag and calls them', async () => {
    const files = [at('a.jpg'), at('b.jpg')];
    const [stack, pano, hdr, stats] = await scriptsFor([
        ['combine_images', { method: 'stack', files, align: true, smartObject: true }],
        ['combine_images', { method: 'photomerge', files, layout: 'cylindrical', fillTransparent: true }],
        ['combine_images', { method: 'hdr', files }],
        ['combine_images', { method: 'statistics', files, statistic: 'median' }],
    ]);
    assert.match(stack, /"Load Files into Stack\.jsx"/);
    assert.match(stack, /\$\.global\["loadLayersFromScript"\] = true;[\s\S]*\$\.evalFile\(adobeScript\);/);
    assert.match(stack, /api\["createSmartObject"\] = true;\napi\["intoStack"\]\(files, true\);/);
    assert.match(stack, /delete \$\.global\["loadLayersFromScript"\];/);
    assert.match(pano, /api\["alignmentKey"\] = "cylindrical";/);
    assert.match(pano, /api\["autoFillTrans"\] = true;\napi\["createPanorama"\]\(files, false\);/);
    assert.match(hdr, /\$\.global\["runMergeToHDRFromScript"\] = true;/);
    assert.match(hdr, /api\["mergeFilesToHDR"\]\(files, true\);/);
    assert.match(stats, /api\["selectedOperation"\] = "medn";\napi\["selectedOperationStr"\] = "Median";\napi\["computeStatistics"\]\(files, false\);/);
    await refused('combine_images', { method: 'stack', files: [at('a.jpg')] }, /two or more/);
    await refused('combine_images', { method: 'stack', files, layout: 'auto' }, /'layout' applies to photomerge/);
    await refused('combine_images', { method: 'photomerge', files, align: true }, /always aligns/);
    await refused('combine_images', { method: 'hdr', files: ['/etc/a.jpg', '/etc/b.jpg'] }, /Access denied/);
});

test('manage_script_events adds, removes and switches notifiers', async () => {
    const [list, add, remove, all, off] = await scriptsFor([
        ['manage_script_events', { operation: 'list' }],
        ['manage_script_events', { operation: 'add', event: 'Opn ', scriptFile: at('on-open.jsx') }],
        ['manage_script_events', { operation: 'remove', index: 0 }],
        ['manage_script_events', { operation: 'remove_all' }],
        ['manage_script_events', { operation: 'disable' }],
    ]);
    assert.match(list, /out\.push\(\{ index: i, event: n\.event, eventClass: n\.eventClass, file: n\.eventFile\.fsName \}\);/);
    assert.match(add, /app\.notifiers\.add\("Opn ", f\);\napp\.notifiersEnabled = true;/);
    assert.match(remove, /app\.notifiers\[at\]\.remove\(\);/);
    assert.match(all, /app\.notifiers\[0\]\.removeAll\(\);/);
    assert.match(off, /app\.notifiersEnabled = false;/);
    await refused('manage_script_events', { operation: 'add', event: 'Opn ' }, /needs 'event' and 'scriptFile'/);
    await refused('manage_script_events', { operation: 'add', event: 'Opn "); evil("', scriptFile: at('x.jsx') }, /four-character code/);
    await refused('manage_script_events', { operation: 'add', event: 'Opn ', scriptFile: at('x.atn') }, /\.jsx or \.js/);
    await refused('manage_script_events', { operation: 'list', index: 2 }, /'index' applies to remove/);
});

test('manage_data_sets imports, applies and exports data sets', async () => {
    const [imp, apply, exp] = await scriptsFor([
        ['manage_data_sets', { operation: 'import', filePath: at('data.csv'), firstColumnNames: true }],
        ['manage_data_sets', { operation: 'apply', name: 'Card 1' }],
        ['manage_data_sets', { operation: 'export', names: ['Card 1', 'Card 2'], folder: at('cards') }],
    ]);
    assert.match(imp, /r\.putClass\(app\.stringIDToTypeID\("dataSetClass"\)\);/);
    assert.match(imp, /d\.putBoolean\(app\.stringIDToTypeID\("eraseAll"\), true\);\nd\.putBoolean\(app\.stringIDToTypeID\("useFirstColumn"\), true\);/);
    assert.match(imp, /app\.executeAction\(app\.stringIDToTypeID\("importDataSets"\), d, DialogModes\.NO\);/);
    assert.match(apply, /r\.putName\(app\.stringIDToTypeID\("dataSetClass"\), name\);/);
    assert.match(apply, /__apply\("Card 1"\);/);
    assert.match(exp, /\["Card 1", new File\(".*cards\/Card 1\.psd"\)\]/);
    assert.match(exp, /doc\.saveAs\(jobs\[i\]\[1\], o, true, Extension\.LOWERCASE\);/);
    await refused('manage_data_sets', { operation: 'export', names: ['../x'], folder: docs }, /cannot be a file name/);
    await refused('manage_data_sets', { operation: 'apply' }, /needs 'name'/);
    await refused('manage_data_sets', { operation: 'apply', name: 'A', folder: docs }, /'folder' applies to export/);
});

test('edit_history reverts, deletes, clears, copies states, sets the brush source and purges', async () => {
    const [revert, del, clear, copy, current, brush, tool, purge] = await scriptsFor([
        ['edit_history', { operation: 'revert' }],
        ['edit_history', { operation: 'delete_state', index: 3 }],
        ['edit_history', { operation: 'clear' }],
        ['edit_history', { operation: 'new_document', index: 2 }],
        ['edit_history', { operation: 'new_document' }],
        ['edit_history', { operation: 'set_brush_source', index: 1 }],
        ['edit_history', { operation: 'select_history_brush' }],
        ['edit_history', { operation: 'purge' }],
    ]);
    assert.match(revert, /app\.executeAction\(app\.stringIDToTypeID\("revert"\), new ActionDescriptor\(\), DialogModes\.NO\);/);
    assert.match(del, /doc\.activeHistoryState = state;[\s\S]*r\.putEnumerated\(app\.charIDToTypeID\("HstS"\), app\.charIDToTypeID\("Ordn"\), app\.charIDToTypeID\("Trgt"\)\);[\s\S]*app\.charIDToTypeID\("Dlt "\)/);
    assert.match(clear, /r\.putProperty\(app\.charIDToTypeID\("Prpr"\), app\.charIDToTypeID\("HsSt"\)\);[\s\S]*app\.charIDToTypeID\("Cler"\)/);
    assert.match(copy, /u\.putProperty\(app\.charIDToTypeID\("HstS"\), app\.charIDToTypeID\("CrnH"\)\);\nd\.putReference\(app\.charIDToTypeID\("Usng"\), u\);/);
    assert.match(copy, /src\.activeHistoryState = was;/);
    assert.doesNotMatch(current, /src\.activeHistoryState = was;/);
    assert.match(brush, /doc\.activeHistoryBrushSource = state;/);
    assert.match(tool, /app\.currentTool = "historyBrushTool";/);
    assert.match(purge, /app\.purge\(PurgeTarget\.HISTORYCACHES\);/);
    await refused('edit_history', { operation: 'delete_state' }, /needs 'index'/);
    await refused('edit_history', { operation: 'clear', index: 1 }, /does not apply to clear/);
    await refused('edit_history', { operation: 'redo' }, /Allowed: revert/);
});

test('set_history_options writes the history and history log preferences', async () => {
    const [set, read] = await scriptsFor([
        ['set_history_options', { autoFirstSnapshot: false, nonLinear: true, states: 100, log: true, logTo: 'file', logFile: at('history.txt'), logDetail: 'detailed' }],
        ['set_history_options', {}],
    ]);
    assert.match(set, /p\.createFirstSnapshot = false;\np\.nonLinearHistory = true;\np\.numberOfHistoryStates = 100;\np\.useHistoryLog = true;/);
    assert.match(set, /p\.saveLogItems = SaveLogItemsType\.LOGFILE;/);
    assert.match(set, /p\.saveLogItemsFile = new File\(".*history\.txt"\);/);
    assert.match(set, /p\.editLogItems = EditLogItemsType\.DETAILED;/);
    assert.doesNotMatch(read, /\bp\.\w+ = /);
    await refused('set_history_options', { logTo: 'both' }, /needs 'logFile'/);
    await refused('set_history_options', { logTo: 'metadata', logFile: at('x.txt') }, /does not apply to logTo metadata/);
    await refused('set_history_options', { states: 5000 }, /Invalid index/);
});

test('get_artboards and create_artboard use the artboard descriptor and artboardSection', async () => {
    const [list, made, fromLayers, fromGroup, docMade] = await scriptsFor([
        ['get_artboards', {}],
        ['create_artboard', { name: 'Phone', width: 375, height: 812, background: 'transparent' }],
        ['create_artboard', { from: 'layers', target: { ids: [4, 5] }, name: 'Hero' }],
        ['create_artboard', { from: 'group', target: { ids: [9] } }],
        ['create_artboard', { from: 'document', width: 1920, height: 1080, resolution: 144, name: 'Boards' }],
    ]);
    assert.match(list, /var d = __layerDesc\(l\.id\), k = __s\("artboardEnabled"\);/);
    assert.match(list, /getObjectValue\(__s\("artboard"\)\)\.getObjectValue\(__s\("artboardRect"\)\)/);
    assert.match(made, /r\.putClass\(__s\("artboardSection"\)\);/);
    assert.match(made, /__rectDesc\(\[left, 0, left \+ 375, 0 \+ 812\]\)/);
    assert.match(made, /ab\.name = "Phone";/);
    assert.match(made, /__editArtboard\(ab, null, \{ type: 3, color: null \}, null\);/);
    assert.match(made, /doc\.suspendHistory\("Create Artboard", "__step\(\)"\);/);
    assert.match(fromLayers, /f\.putEnumerated\(__c\("Lyr "\), __c\("Ordn"\), __c\("Trgt"\)\);\n\s*d\.putReference\(__c\("From"\), f\);/);
    assert.match(fromGroup, /__onTarget\("artboardFromLayerGroupEvent"\);/);
    assert.match(docMade, /n\.putBoolean\(__s\("artboard"\), true\);/);
    assert.match(docMade, /n\.putUnitDouble\(__s\("width"\), __s\("distanceUnit"\), 1920 \* 72 \/ 144\);/);
    assert.match(docMade, /d\.putObject\(__s\("new"\), __s\("document"\), n\);\napp\.executeAction\(__s\("make"\), d, DialogModes\.NO\);/);
    await refused('create_artboard', { width: 100 }, /needs width and height/);
    await refused('create_artboard', { from: 'layers', target: { ids: [1] }, width: 10, height: 10 }, /fits its layers/);
    await refused('create_artboard', { from: 'group' }, /needs 'target'/);
    await refused('create_artboard', { from: 'document', width: 10, height: 10, background: 'black' }, /white or transparent/);
    await refused('create_artboard', { width: 10, height: 10, background: 'mauve' }, /not a colour/);
});

test('edit_artboards edits, duplicates, ungroups and handles guides and tools', async () => {
    const [set, dup, ungroup, clear, guides, tool] = await scriptsFor([
        ['edit_artboards', { operation: 'set', target: { ids: [3] }, x: 0, width: 640, background: '#FF0000', autoNest: false }],
        ['edit_artboards', { operation: 'duplicate', target: { ids: [3] }, name: 'Copy', x: 2000 }],
        ['edit_artboards', { operation: 'ungroup', target: { ids: [3] } }],
        ['edit_artboards', { operation: 'clear_guides', target: { ids: [3] } }],
        ['edit_artboards', { operation: 'guides_from_shape', target: { ids: [8] } }],
        ['edit_artboards', { operation: 'select_tool', tool: 'frame' }],
    ]);
    assert.match(set, /var nx = 0, ny = null, nw = 640, nh = null;/);
    assert.match(set, /__editArtboard\(l, rect, \{ type: 4, color: \{"kind":"rgb","v":\[255,0,0\]\} \}, false\);/);
    assert.match(set, /d\.putBoolean\(__s\("autoNestEnabled"\), autoNest\);/);
    assert.match(set, /app\.executeAction\(__s\("editArtboardEvent"\), d, DialogModes\.NO\);/);
    assert.match(dup, /app\.executeAction\(__s\("duplicate"\), d, DialogModes\.NO\);/);
    assert.match(dup, /var nx = 2000, ny = null;/);
    assert.match(ungroup, /__onTarget\("ungroupLayersEvent"\);/);
    assert.match(clear, /__s\("clearSelectedArtboardGuides"\)/);
    assert.match(guides, /__s\("newArtboardGuidesFromTarget"\)/);
    assert.match(tool, /app\.currentTool = "framedGroupTool";/);
    await refused('edit_artboards', { operation: 'set', target: { ids: [3] } }, /Give name, x, y/);
    await refused('edit_artboards', { operation: 'ungroup' }, /needs 'target'/);
    await refused('edit_artboards', { operation: 'ungroup', target: { ids: [3] }, width: 4 }, /'width' does not apply to ungroup/);
    await refused('edit_artboards', { operation: 'select_tool', tool: 'pen' }, /Allowed: artboard, frame/);
});

test('create_frame frames layers or a group', async () => {
    const [layers, group] = await scriptsFor([
        ['create_frame', { target: { ids: [2, 3] } }],
        ['create_frame', { from: 'group', target: { ids: [6] } }],
    ]);
    assert.match(layers, /__onTarget\("framedGroupFromLayersEvent"\);/);
    assert.match(group, /__onTarget\("framedGroupFromLayerGroupEvent"\);/);
    await refused('create_frame', {}, /Choose the layers/);
});

test('export_artboards saves each artboard cropped, or one PDF presentation', async () => {
    const [png, pdf] = await scriptsFor([
        ['export_artboards', { folder: at('boards'), prefix: 'web_' }],
        ['export_artboards', { folder: at('boards'), format: 'pdf', singlePdf: true, pdfName: 'All' }],
    ]);
    assert.match(png, /var o = new PNGSaveOptions\(\);/);
    assert.match(png, /var copy = src\.duplicate\(ab\.name, false\);/);
    assert.match(png, /copy\.crop\(rect\);/);
    assert.match(png, /"web_" \+ ab\.name\.replace/);
    assert.match(png, /copy\.close\(SaveOptions\.DONOTSAVECHANGES\);/);
    assert.match(pdf, /var work = Folder\.temp/);
    assert.match(pdf, /var pdf = new File\(".*boards\/All\.pdf"\);/);
    assert.match(pdf, /app\.makePDFPresentation\(saved, pdf, po\);/);
    await refused('export_artboards', { folder: docs, singlePdf: true }, /applies to format pdf/);
    await refused('export_artboards', { folder: docs, prefix: '../' }, /path characters/);
    await refused('export_artboards', { folder: '/etc' }, /Access denied/);
});
