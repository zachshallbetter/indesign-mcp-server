/**
 * Media and projects: import formats and options, relinking, proxies,
 * footage interpretation, project media settings, project templates, closing
 * and reverting, search bins, finding items and the Metadata Display.
 * Premiere Pro is never contacted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { toolTable } from '../src/server.js';
import { executor } from '../src/executor.js';
import { revealer, findFiles } from '../src/tools/media.js';
import { checkScript } from './audit.js';
import { scriptsFor, server, body, docs, home } from './helpers.js';

const tool = (name) => toolTable.find((t) => t.name === name);

/** A temporary folder the path policy allows, removed afterwards. */
function withAllowedDir(fn) {
    return async () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'premiere-media-'));
        const previous = process.env.PREMIERE_ALLOWED_DIRS;
        process.env.PREMIERE_ALLOWED_DIRS = dir;
        try {
            await fn(dir);
        } finally {
            if (previous === undefined) delete process.env.PREMIERE_ALLOWED_DIRS; else process.env.PREMIERE_ALLOWED_DIRS = previous;
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

/** Run one call with a stub that answers each script in turn; returns the scripts and the tool result. */
async function callWith(name, args, answers) {
    const mcp = await server();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return { ok: true, result: answers[sent.length - 1] ?? {} }; };
    try {
        const r = await mcp.handleToolCall(name, args);
        for (const s of sent) assert.deepEqual(checkScript(s).problems, []);
        return { sent, r };
    } finally {
        executor.runScript = original;
    }
}

test('import_media claims every format and kind of file Project.importFiles imports, and its script is unchanged', async () => {
    const f = tool('import_media').features;
    for (const id of ['import', 'format_quicktime', 'format_r3d', 'format_wav', 'format_psd', 'format_aaf', 'format_edl', 'format_fcp_xml', 'format_chproj',
        'import_still_images', 'import_image_sequence', 'import_layered_files', 'import_premiere_elements', 'import_avid_project', 'batch_list_import', 'media_browser']) {
        assert.ok(f.includes(`premiere.media_import.${id}`), id);
    }
    assert.ok(f.includes('premiere.media_import.blackmagic_raw'));
    assert.ok(!f.includes('premiere.media_import.format_aep'), 'After Effects projects go through import_after_effects_comps');
    const [s] = await scriptsFor([['import_media', { files: [path.join(docs, 'a.braw'), path.join(docs, 'cut.edl')], bin: { path: 'Footage' } }]]);
    assert.match(body(s), /await project\.importFiles\(\[".*a\.braw",".*cut\.edl"\], true, target\.item, false\)/);
});

test('import_project_sequences: guids become Guid objects for importSequences; bad guids and paths are refused', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('import_project_sequences', { projectPath: path.join(docs, 'a.prproj'), sequences: ['Main edit'] }), /not a sequence guid/);
    await assert.rejects(mcp.handleToolCall('import_project_sequences', { projectPath: path.join(docs, 'a.aep'), sequences: ['b6b3d1a2-0000-4000-8000-000000000000'] }), /must end in \.prproj/);
    await assert.rejects(mcp.handleToolCall('import_project_sequences', { projectPath: path.join(docs, 'a.prproj'), sequences: [] }), /at least one sequence/);
    const [s] = await scriptsFor([['import_project_sequences', { projectPath: path.join(docs, 'Other.prproj'), sequences: ['b6b3d1a2-0000-4000-8000-000000000000'] }]]);
    assert.match(body(s), /\["b6b3d1a2-0000-4000-8000-000000000000"\]\.map\(\(g\) => ppro\.Guid\.fromString\(g\)\)/);
    assert.match(body(s), /await project\.importSequences\(".*Other\.prproj", ids\)/);
    assert.ok(tool('import_project_sequences').features.includes('premiere.media_import.import_sequences_from_project'));
});

test('import_after_effects_comps: named compositions or all of them, into a bin', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('import_after_effects_comps', { aepPath: path.join(docs, 'a.mov') }), /must end in \.aep, \.aepx/);
    await assert.rejects(mcp.handleToolCall('import_after_effects_comps', { aepPath: path.join(docs, 'a.aep'), comps: [] }), /at least one composition/);
    const [some, all] = await scriptsFor([
        ['import_after_effects_comps', { aepPath: path.join(docs, 'Motion.aep'), comps: ['Title "A"'], bin: { path: 'Graphics' } }],
        ['import_after_effects_comps', { aepPath: path.join(docs, 'Motion.aepx') }],
    ]);
    assert.match(body(some), /await project\.importAEComps\(".*Motion\.aep", \["Title \\"A\\""\], target\.item\)/);
    assert.match(body(all), /await project\.importAllAEComps\(".*Motion\.aepx", target\.item\)/);
    assert.ok(tool('import_after_effects_comps').features.includes('premiere.media_import.format_aep'));
});

test('relink_media: one clip to a new file, with its arguments checked', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('relink_media', { item: { id: '1' } }), /Give newPath/);
    await assert.rejects(mcp.handleToolCall('relink_media', { newPath: path.join(docs, 'a.mov') }), /needs 'item'/);
    await assert.rejects(mcp.handleToolCall('relink_media', { item: { id: '1' }, newPath: '/etc/a.mov' }), /outside the allowed directories|system directory/);
    await assert.rejects(mcp.handleToolCall('relink_media', { item: { id: '1' }, newPath: path.join(docs, 'a.mov'), searchFolders: [docs] }), /Give newPath/);
    const [s] = await scriptsFor([['relink_media', { item: { path: 'Footage/a.mov' }, newPath: path.join(docs, 'b.mov'), overrideChecks: true }]]);
    assert.match(body(s), /await clip\.canChangeMediaPath\(\)/);
    assert.match(body(s), /await clip\.changeMediaFilePath\(".*b\.mov", true\)/);
    for (const id of ['link_media', 'replace_footage', 'relink_automatically']) assert.ok(tool('relink_media').features.includes(`premiere.media_import.${id}`));
    assert.ok(tool('relink_media').features.includes('premiere.projects.where_is_the_file'));
});

test('relink_media: offline clips are matched by file name in the search folders', withAllowedDir(async (dir) => {
    mkdirSync(path.join(dir, 'Card A', 'Clip'), { recursive: true });
    mkdirSync(path.join(dir, 'Card B'), { recursive: true });
    writeFileSync(path.join(dir, 'Card A', 'Clip', 'A001.MOV'), '');
    writeFileSync(path.join(dir, 'Card A', 'dup.wav'), '');
    writeFileSync(path.join(dir, 'Card B', 'dup.wav'), '');
    const offline = [
        { id: '11', name: 'A001.MOV', path: 'Footage/A001.MOV', mediaPath: '/Volumes/Gone/A001.mov' },
        { id: '12', name: 'dup.wav', path: 'Audio/dup.wav', mediaPath: 'D:\\Audio\\dup.wav' },
        { id: '13', name: 'missing.mov', path: 'Footage/missing.mov', mediaPath: '/Volumes/Gone/missing.mov' },
    ];
    const { sent, r } = await callWith('relink_media', { searchFolders: [dir] }, [{ offline }, { relinked: [{ id: '11' }], failed: [] }]);
    assert.equal(sent.length, 2);
    assert.match(body(sent[0]), /await __walk\(project, null, 100\)/);
    assert.match(body(sent[0]), /await e\.clip\.isOffline\(\)/);
    assert.ok(body(sent[1]).includes(`const plan = ${JSON.stringify([{ id: '11', path: path.join(dir, 'Card A', 'Clip', 'A001.MOV') }])};`));
    assert.match(body(sent[1]), /await clip\.changeMediaFilePath\(p\.path, false\)/);
    assert.equal(r.success, true);
    assert.deepEqual(r.result.relinked, [{ id: '11' }]);
    assert.deepEqual(r.result.unresolved.map((u) => u.id), ['12', '13']);
    assert.match(r.result.unresolved[0].reason, /2 files are named dup\.wav/);
    assert.match(r.result.unresolved[1].reason, /No file named missing\.mov/);

    const none = await callWith('relink_media', { searchFolders: [dir], items: [{ path: 'Footage/A001.MOV' }] }, [{ offline: [] }]);
    assert.equal(none.sent.length, 1);
    assert.match(body(none.sent[0]), /await __items\(project, \[\{"path":"Footage\/A001\.MOV"\}\], false\)/);
    assert.match(none.r.result.message, /No offline clips/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('relink_media', { searchFolders: [path.join(dir, 'nope')] }), /must be an existing folder/);
    assert.deepEqual([...findFiles([dir], new Set(['a001.mov']), 1).keys()], [], 'depth 1 stays in the folder itself');
    assert.equal(findFiles([dir], new Set(['a001.mov']), 3).get('a001.mov').length, 1);
}));

test('manage_media: refresh, make offline (one undo step), attach a proxy or the full-resolution file', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_media', { action: 'attach_proxy', items: [{ id: '1' }] }), /needs 'mediaPath'/);
    await assert.rejects(mcp.handleToolCall('manage_media', { action: 'refresh', items: [{ id: '1' }], mediaPath: path.join(docs, 'p.mov') }), /goes only with attach/);
    await assert.rejects(mcp.handleToolCall('manage_media', { action: 'attach_proxy', items: [{ id: '1' }, { id: '2' }], mediaPath: path.join(docs, 'p.mov') }), /takes one clip/);
    await assert.rejects(mcp.handleToolCall('manage_media', { action: 'delete', items: [{ id: '1' }] }), /action/);
    const [refresh, offline, proxy, full] = await scriptsFor([
        ['manage_media', { action: 'refresh', items: [{ id: '1' }, { id: '2' }] }],
        ['manage_media', { action: 'make_offline', selected: true }],
        ['manage_media', { action: 'attach_proxy', items: [{ path: 'Footage/a.mov' }], mediaPath: path.join(docs, 'Proxies', 'a.mov') }],
        ['manage_media', { action: 'attach_full_resolution', items: [{ path: 'Footage/a.mov' }], mediaPath: path.join(docs, 'Full', 'a.mov') }],
    ]);
    assert.match(body(refresh), /await __clipItem\(e\)\.refreshMedia\(\)/);
    assert.match(body(offline), /transact\(project, "Make offline", \(add\) => \{ for \(const c of clips\) add\(c\.createSetOfflineAction\(\)\); \}\);/);
    assert.match(body(offline), /__items\(project, \[\], true\)/);
    assert.match(body(proxy), /await clip\.canProxy\(\)/);
    assert.match(body(proxy), /await clip\.attachProxy\(".*Proxies\/a\.mov", false, false\)/);
    assert.doesNotMatch(body(full), /canProxy/);
    assert.match(body(full), /await clip\.attachProxy\(".*Full\/a\.mov", true, false\)/);
    for (const id of ['refresh_media', 'make_offline', 'reconnect_full_resolution', 'ingest_proxy_workflow']) assert.ok(tool('manage_media').features.includes(`premiere.media_import.${id}`));
});

test('modify_footage: interpretation, timecode and scale to frame size in one transaction', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('modify_footage', { items: [{ id: '1' }] }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('modify_footage', { items: [{ id: '1' }], scaleToFrameSize: false }), /can only be true/);
    await assert.rejects(mcp.handleToolCall('modify_footage', { items: [{ id: '1' }], frameRate: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('modify_footage', { items: [{ id: '1' }], fieldOrder: 'odd' }), /fieldOrder/);
    await assert.rejects(mcp.handleToolCall('modify_footage', { items: [{ id: '1' }], alphaUsage: 'multiply' }), /alphaUsage/);
    const [all, timecode] = await scriptsFor([
        ['modify_footage', { items: [{ path: 'Footage/a.mov' }], frameRate: 23.976, pixelAspectRatio: 2, fieldOrder: 'lower_first', alphaUsage: 'straight', ignoreAlpha: false, invertAlpha: true, removePulldown: true, scaleToFrameSize: true }],
        ['modify_footage', { selected: true, startTime: 3600 }],
    ]);
    assert.match(body(all), /fi = await clip\.getFootageInterpretation\(\);/);
    assert.match(body(all), /if \(!fi\.setFrameRate\(23\.976\)\) throw/);
    assert.match(body(all), /if \(!fi\.setPixelAspectRatio\(2\)\) throw/);
    assert.match(body(all), /if \(!fi\.setFieldType\(fi\.FIELD_TYPE_LOWERFIRST\)\) throw/);
    assert.match(body(all), /if \(!fi\.setAlphaUsage\(fi\.ALPHACHANNEL_STRAIGHT\)\) throw/);
    assert.match(body(all), /fi\.setIgnoreAlpha\(false\)/);
    assert.match(body(all), /fi\.setInvertAlpha\(true\)/);
    assert.match(body(all), /fi\.setRemovePullDown\(true\)/);
    assert.match(body(all), /add\(c\.clip\.createSetFootageInterpretationAction\(c\.fi\)\);\n {4}add\(c\.clip\.createSetScaleToFrameSizeAction\(\)\);/);
    assert.doesNotMatch(body(all), /getMedia\(\)|createSetStartAction/);
    assert.doesNotMatch(body(timecode), /^  fi = await clip\.getFootageInterpretation/m);
    assert.match(body(timecode), /media = await clip\.getMedia\(\);/);
    assert.match(body(timecode), /add\(c\.media\.createSetStartAction\(__t\(3600\)\)\);/);
    assert.match(body(timecode), /typeof c\.media\.getStart === "function"/);
    const f = tool('modify_footage').features;
    for (const id of ['change_frame_rate', 'pixel_aspect_ratio', 'field_order', 'alpha_channel', 'resize_imported_images']) assert.ok(f.includes(`premiere.media_import.${id}`), id);
    assert.ok(f.includes('premiere.projects.set_clip_timecode'));
});

test('reveal_media_file: reads the media path, then shows an existing file in the file browser', withAllowedDir(async (dir) => {
    const file = path.join(dir, 'a.mov');
    writeFileSync(file, '');
    const shown = [];
    const original = revealer.reveal;
    revealer.reveal = async (f) => { shown.push(f); };
    try {
        const ok = await callWith('reveal_media_file', { item: { path: 'Footage/a.mov' } }, [{ item: 'Footage/a.mov', mediaPath: file, offline: false }]);
        assert.match(body(ok.sent[0]), /mediaPath: await clip\.getMediaFilePath\(\)/);
        assert.equal(ok.r.success, true);
        assert.equal(ok.r.result.revealed, true);
        assert.deepEqual(shown, [file]);
        const missing = await callWith('reveal_media_file', { item: { id: '1' } }, [{ item: 'x', mediaPath: path.join(dir, 'gone.mov'), offline: true }]);
        assert.equal(missing.r.success, false);
        assert.match(missing.r.result.error, /relink_media/);
        const none = await callWith('reveal_media_file', { item: { id: '1' } }, [{ item: 'x', mediaPath: '' }]);
        assert.equal(none.r.success, false);
        assert.deepEqual(shown, [file]);
    } finally {
        revealer.reveal = original;
    }
    assert.equal(tool('reveal_media_file').hints.readOnly, true);
}));

test('project media settings: ingest, scratch disks and growing files', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_project_media_settings', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_project_media_settings', { scratchDisks: { previews: 'same_as_project' } }), /Unknown scratch disk 'previews'/);
    await assert.rejects(mcp.handleToolCall('set_project_media_settings', { scratchDisks: { videoPreview: 'next to the project' } }), /same_as_project/);
    await assert.rejects(mcp.handleToolCall('set_project_media_settings', { scratchDisks: { videoPreview: path.join(home, 'no-such-folder-xyz') } }), /existing folder/);
    await assert.rejects(mcp.handleToolCall('set_project_media_settings', { scratchDisks: 'same_as_project' }), /must be an object/);
    const [get, set, pause] = await scriptsFor([
        ['get_project_media_settings', {}],
        ['set_project_media_settings', { ingestEnabled: true, scratchDisks: { capture: 'same_as_project', autoSave: home, cclLibraries: 'my_documents' } }],
        ['set_project_media_settings', { pauseGrowing: false }],
    ]);
    assert.match(body(get), /await ppro\.ProjectSettings\.getIngestSettings\(project\)\)\.getIsIngestEnabled\(\)/);
    assert.match(body(get), /\["capsuleMedia", __C\.ScratchDiskFolderType\.CAPSULE_MEDIA\]/);
    assert.match(body(get), /disks\.getScratchDiskPath\(type\)/);
    assert.match(body(set), /await ingest\.setIngestEnabled\(true\)/);
    assert.match(body(set), /disks\.setScratchDiskPath\(__C\.ScratchDiskFolderType\.CAPTURE, __C\.ScratchDiskFolder\.SAME_AS_PROJECT\)/);
    assert.match(body(set), new RegExp(`disks\\.setScratchDiskPath\\(__C\\.ScratchDiskFolderType\\.AUTO_SAVE, ${JSON.stringify(home).replace(/[\\/.]/g, (c) => `\\${c}`)}\\)`));
    assert.match(body(set), /__C\.ScratchDiskFolder\.MY_DOCUMENTS/);
    assert.match(body(set), /add\(ppro\.ProjectSettings\.createSetIngestSettingsAction\(project, ingest\)\);\n {2}add\(ppro\.ProjectSettings\.createSetScratchDiskSettingsAction\(project, disks\)\);/);
    assert.doesNotMatch(body(set), /pauseGrowing/);
    assert.match(body(pause), /await project\.pauseGrowing\(false\)/);
    assert.doesNotMatch(body(pause), /transact\(/);
    assert.ok(tool('set_project_media_settings').features.includes('premiere.media_import.growing_files'));
    assert.ok(tool('set_project_media_settings').features.includes('premiere.projects.scratch_disks'));
});

test('projects: templates, close all, revert, search bins, and existing calls generate the same scripts', withAllowedDir(async (dir) => {
    const template = path.join(dir, 'Template.prproj');
    writeFileSync(template, '');
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_project', { filePath: path.join(dir, 'New.prproj'), template: path.join(dir, 'Missing.prproj') }), /does not exist/);
    await assert.rejects(mcp.handleToolCall('create_project', { filePath: path.join(dir, 'New.prproj'), template: path.join(dir, 'a.aep') }), /must end in \.prproj/);
    await assert.rejects(mcp.handleToolCall('create_project', { filePath: template, template }), /already exists/);
    await assert.rejects(mcp.handleToolCall('create_bin', { name: 'Selects', searchQuery: ' ' }), /searchQuery' is empty/);
    const [fromTemplate, empty, closeAll, closeOne, revert, searchBin, bin] = await scriptsFor([
        ['create_project', { filePath: path.join(dir, 'New.prproj'), template }],
        ['create_project', { filePath: path.join(dir, 'Empty.prproj') }],
        ['close_project', { all: true }],
        ['close_project', { save: true }],
        ['revert_project', {}],
        ['create_bin', { name: 'Interviews', searchQuery: 'interview' }],
        ['create_bin', { name: 'Selects' }],
    ]);
    assert.match(body(fromTemplate), /options\.setAddToMRUList\(false\);\nconst project = await ppro\.Project\.open\(".*Template\.prproj", options\);/);
    assert.match(body(fromTemplate), /await project\.saveAs\(".*New\.prproj"\)/);
    assert.match(body(empty), /await ppro\.Project\.createProject\(".*Empty\.prproj"\)/);
    assert.match(body(closeAll), /await ppro\.ProjectUtils\.getProjectViewIds\(\)/);
    assert.match(body(closeAll), /await ppro\.ProjectUtils\.getProjectFromViewId\(id\)/);
    assert.match(body(closeAll), /for \(const project of projects\)/);
    assert.doesNotMatch(body(closeAll), /project\.save\(\)/);
    assert.doesNotMatch(body(closeOne), /getProjectViewIds/);
    assert.match(body(closeOne), /await project\.save\(\)/);
    assert.match(body(revert), /close\.setPromptIfDirty\(false\);/);
    assert.match(body(revert), /await ppro\.Project\.open\(file, options\)/);
    assert.match(body(searchBin), /transact\(project, "Create search bin", \(add\) => add\(parent\.bin\.createSmartBinAction\("Interviews", "interview"\)\)\);/);
    assert.match(body(bin), /transact\(project, "Create bin", \(add\) => add\(parent\.bin\.createBinAction\("Selects", true\)\)\);/);
    assert.equal(tool('revert_project').hints.destructive, true);
    assert.ok(tool('create_project').features.includes('premiere.projects.project_templates'));
    assert.ok(tool('close_project').features.includes('premiere.projects.close_all_projects'));
    assert.ok(tool('create_bin').features.includes('premiere.projects.search_bin'));
    assert.ok(tool('manage_items').features.includes('premiere.projects.delete_items'));
    assert.ok(tool('open_project').features.includes('premiere.projects.where_is_the_file'));
    assert.ok(tool('list_project_items').features.includes('premiere.projects.project_panel'));
    assert.ok(tool('set_sequence_settings').features.includes('premiere.projects.timecode_display'));
    assert.ok(tool('get_sequence_settings').features.includes('premiere.media_import.audio_sample_rates'));
}));

test('search_project_items: name, media path, kind and offline filters', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('search_project_items', {}), /Give name, mediaPath, kind or offline/);
    await assert.rejects(mcp.handleToolCall('search_project_items', { name: '' }), /'name' is empty/);
    await assert.rejects(mcp.handleToolCall('search_project_items', { kind: 'folder' }), /kind/);
    const [byName, byMedia] = await scriptsFor([
        ['search_project_items', { name: 'Interview' }],
        ['search_project_items', { mediaPath: 'Card A', offline: true, bin: { path: 'Footage' }, limit: 20 }],
    ]);
    assert.match(body(byName), /const name = "interview", media = null, kind = null, offline = null;/);
    assert.match(body(byName), /await __walk\(project, start, 100\)/);
    assert.match(body(byMedia), /const name = null, media = "card a", kind = null, offline = true;/);
    assert.match(body(byMedia), /await __bin\(project, \{"path":"Footage"\}\)/);
    assert.match(body(byMedia), /await e\.clip\.getMediaFilePath\(\)/);
    assert.match(body(byMedia), /items: hits\.slice\(0, 20\)/);
    assert.ok(tool('search_project_items').features.includes('premiere.projects.find_dialog'));
});

test('Metadata Display: read and set the column layout, add schema fields', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_metadata_display', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_metadata_display', { addFields: [{ name: 'shot number', label: 'Shot' }] }), /letters, digits and underscores/);
    await assert.rejects(mcp.handleToolCall('set_metadata_display', { addFields: [{ name: 'Shot', label: 'Shot', type: 'date' }] }), /type/);
    await assert.rejects(mcp.handleToolCall('set_metadata_display', { addFields: [{ name: 'Shot', label: '' }] }), /label' is empty/);
    const [get, set] = await scriptsFor([
        ['get_metadata_display', {}],
        ['set_metadata_display', { addFields: [{ name: 'Shot', label: 'Shot "No."', type: 'integer' }, { name: 'Notes', label: 'Notes' }], panelMetadata: '<x/>' }],
    ]);
    assert.match(body(get), /await ppro\.Metadata\.getProjectPanelMetadata\(\)/);
    assert.match(body(set), /addPropertyToProjectMetadataSchema\("Shot", "Shot \\"No\.\\"", __C\.MetadataType\.INTEGER\)/);
    assert.match(body(set), /addPropertyToProjectMetadataSchema\("Notes", "Notes", __C\.MetadataType\.TEXT\)/);
    assert.match(body(set), /await ppro\.Metadata\.setProjectPanelMetadata\("<x\/>"\)/);
    assert.ok(tool('set_metadata_display').features.includes('premiere.projects.metadata_schema'));
    assert.ok(tool('get_metadata_display').features.includes('premiere.projects.list_view_columns'));
});
