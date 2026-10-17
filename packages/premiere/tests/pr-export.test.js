/**
 * Export settings and Media Encoder, events, the media cache, crash recovery,
 * and the features existing tools now claim.
 * Premiere Pro is never contacted: scriptsFor() stubs the executor and
 * audits each script.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import { toolTable } from '../src/server.js';
import { scriptsFor, server, body, docs } from './helpers.js';

const tool = (name) => toolTable.find((t) => t.name === name);
const claims = (name, ...ids) => { for (const id of ids) assert.ok(tool(name).features.includes(id), `${name} should claim ${id}`); };

test('export_sequence carries every preset-driven Export setting and can import its output', async () => {
    claims('export_sequence', 'premiere.export.export_presets', 'premiere.export.export_format', 'premiere.export.export_range',
        'premiere.export.basic_video_settings', 'premiere.export.video_encoding_settings', 'premiere.export.key_frame_distance',
        'premiere.export.vr_export', 'premiere.export.audio_export_settings', 'premiere.export.export_captions', 'premiere.export.export_effects',
        'premiere.export.export_metadata', 'premiere.export.import_into_project', 'premiere.export.quick_export', 'premiere.export.visual_watermark',
        'premiere.export.hdr_youtube', 'premiere.export.supported_export_formats', 'premiere.export.export_still_sequence');
    claims('import_media', 'premiere.export.avid_to_premiere');

    const mcp = await server();
    const base = { outputFile: path.join(docs, 'pr-export-a.mp4'), preset: path.join(docs, 'H264.epr') };
    await assert.rejects(mcp.handleToolCall('export_sequence', { ...base, mode: 'queue_to_ame', importIntoProject: true }), /importIntoProject goes with mode immediately/);
    await assert.rejects(mcp.handleToolCall('export_sequence', { ...base, importBin: { path: 'Exports' } }), /importBin goes with importIntoProject/);
    await assert.rejects(mcp.handleToolCall('export_sequence', { ...base, importIntoProject: true, importBin: {} }), /needs id, path or name/);
    await assert.rejects(mcp.handleToolCall('export_sequence', { ...base, preset: '/etc/a.epr' }), /outside the allowed directories|system directory/);

    const [plain, imported] = await scriptsFor([
        ['export_sequence', base],
        ['export_sequence', { ...base, importIntoProject: true, importBin: { path: 'Exports' } }],
    ]);
    assert.doesNotMatch(body(plain), /importFiles/);
    assert.match(body(plain), /queueStarted: false \};/);
    assert.match(body(imported), /const target = await __bin\(project, \{"path":"Exports"\}\);/);
    assert.match(body(imported), /project\.importFiles\(\[file\], true, target\.item, false\)/);
    assert.ok(body(imported).indexOf('manager.exportSequence(') < body(imported).indexOf('project.importFiles('), 'imports after exporting');
    assert.match(body(imported), /importedInto: target\.path \|\| "\(root\)", imported: imported \};/);
});

test('encode_media queues a project item or a file in Media Encoder', async () => {
    claims('encode_media', 'premiere.export.ame_queue');
    const mcp = await server();
    const out = { outputFile: path.join(docs, 'pr-export-q.mp4'), preset: path.join(docs, 'H264.epr') };
    await assert.rejects(mcp.handleToolCall('encode_media', out), /Choose what to encode/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, item: { id: '1' }, file: path.join(docs, 'a.mov') }), /not both/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, item: { id: '1' }, outputFile: path.join(docs, 'noext') }), /needs an extension/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, item: { id: '1' }, inPoint: 2 }), /inPoint and outPoint go with file/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, file: path.join(docs, 'a.mov'), range: 'work_area' }), /range goes with item/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, file: path.join(docs, 'a.mov'), inPoint: 5, outPoint: 2 }), /outPoint must be after inPoint/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, file: '/etc/hosts' }), /outside the allowed directories|system directory/);
    await assert.rejects(mcp.handleToolCall('encode_media', { ...out, item: { id: '1' }, range: 'half' }), /Allowed: full, in_to_out, work_area/);

    const [item, area, whole, trimmed] = await scriptsFor([
        ['encode_media', { ...out, item: { path: 'Footage/a.mov' }, range: 'in_to_out', removeWhenDone: true }],
        ['encode_media', { ...out, item: { name: 'Main edit' }, range: 'work_area', startQueue: true }],
        ['encode_media', { ...out, file: path.join(docs, 'a.mov') }],
        ['encode_media', { ...out, file: path.join(docs, 'a.mov'), inPoint: 2, outPoint: 7.5 }],
    ]);
    assert.match(body(item), /if \(!manager\.isAMEInstalled\) throw/);
    assert.match(body(item), /manager\.encodeProjectItem\(clip, ".*pr-export-q\.mp4", ".*H264\.epr", 1, true, false\)/);
    assert.match(body(area), /entry\.kind !== "sequence"/);
    assert.match(body(area), /encodeProjectItem\(clip, .*, 2, false, true\)/);
    assert.match(body(whole), /const outPoint = __t\(0\)\.divide\(0\);/);
    assert.match(body(whole), /manager\.encodeFile\(".*a\.mov", ".*pr-export-q\.mp4", ".*H264\.epr", inPoint, outPoint, 0, false, false\)/);
    assert.match(body(trimmed), /const inPoint = __t\(2\);\nconst outPoint = __t\(7\.5\);/);
    assert.match(body(trimmed), /inPoint, outPoint, 1, false, false\)/);
});

test('existing tools claim the Program Monitor, Timeline panel and Morph Cut', () => {
    claims('set_sequence_times', 'premiere.ui.program_monitor');
    claims('open_sequence', 'premiere.ui.timeline_panel');
    claims('add_transition', 'premiere.ai_features.morph_cut_ai');
});

test('Source Monitor, scene edit detection and cross-project tools claim the interface, AI and collaboration features', () => {
    claims('control_source_monitor', 'premiere.ui.source_monitor', 'premiere.ui.open_clip_source_monitor', 'premiere.ui.source_menu');
    claims('set_source_in_out', 'premiere.ui.source_monitor_in_out');
    claims('run_scene_edit_detection', 'premiere.ai_features.scene_edit_detection_ai');
    claims('import_project_sequences', 'premiere.collaboration.move_between_projects');
    claims('import_after_effects_comps', 'premiere.collaboration.dynamic_link');
    claims('relink_media', 'premiere.collaboration.team_project_media');
    claims('manage_media', 'premiere.collaboration.team_project_media');
});

test('wait_for_event listens on the right target and always removes its listener', async () => {
    claims('wait_for_event', 'premiere.automation.events');
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('wait_for_event', { event: 'render_done' }), /Allowed: project_opened/);
    await assert.rejects(mcp.handleToolCall('wait_for_event', { event: 'render_complete', sequence: { name: 'A' } }), /sequence goes with the sequence_ events/);
    await assert.rejects(mcp.handleToolCall('wait_for_event', { event: 'project_opened', timeout: 0 }), /'timeout' out of range \[1, 3600\]/);
    await assert.rejects(mcp.handleToolCall('wait_for_event', { event: 'project_opened', timeout: 5000 }), /'timeout' out of range/);

    const { executor } = await import('../src/executor.js');
    const original = executor.runScript;
    const options = [];
    executor.runScript = async (s, o) => { options.push(o); return { ok: true, result: {} }; };
    try {
        await mcp.handleToolCall('wait_for_event', { event: 'render_complete', timeout: 90 });
    } finally {
        executor.runScript = original;
    }
    assert.deepEqual(options, [{ timeoutMs: 120000 }]);

    const [render, seq, anySeq, exported] = await scriptsFor([
        ['wait_for_event', { event: 'render_complete', timeout: 90 }],
        ['wait_for_event', { event: 'sequence_selection_changed', sequence: { name: 'Main edit' } }],
        ['wait_for_event', { event: 'sequence_activated' }],
        ['wait_for_event', { event: 'export_complete' }],
    ]);
    assert.match(body(render), /const target = ppro\.EncoderManager\.getManager\(\);/);
    assert.match(body(render), /const name = __C\.EncoderEvent\.RENDER_COMPLETE;/);
    assert.match(body(render), /ppro\.EventManager\.addEventListener\(target, name, handler, false\);/);
    assert.match(body(render), /ppro\.EventManager\.removeEventListener\(target, name, handler\);/);
    assert.match(body(render), /setTimeout\(\(\) => resolve\(\{ fired: false, detail: null \}\), 90000\)/);
    assert.match(body(seq), /const target = await __sequence\(project, \{"name":"Main edit"\}\);/);
    assert.match(body(seq), /__C\.SequenceEvent\.SELECTION_CHANGED/);
    assert.match(body(anySeq), /ppro\.EventManager\.addGlobalEventListener\(name, handler, false\);/);
    assert.match(body(anySeq), /ppro\.EventManager\.removeGlobalEventListener\(name, handler\);/);
    assert.match(body(exported), /__C\.OperationCompleteEvent\.EXPORT_MEDIA_COMPLETE/);
    assert.equal(tool('wait_for_event').hints.readOnly, true);
});

test('clear_media_cache needs Premiere Pro 26.5 and checks for MediaManager', async () => {
    claims('clear_media_cache', 'premiere.application.media_cache');
    assert.equal(tool('clear_media_cache').since, '26.5');
    const [s] = await scriptsFor([['clear_media_cache', {}]]);
    assert.match(body(s), /typeof ppro\.MediaManager === "undefined"/);
    assert.match(body(s), /await ppro\.MediaManager\.purgeMediaCache\(\)/);
});

test('recover_project lists Auto-Save copies newest first and opens one without dialogs', async () => {
    claims('recover_project', 'premiere.application.recover_after_crash');
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'premiere-recover-')));
    const previous = process.env.PREMIERE_ALLOWED_DIRS;
    process.env.PREMIERE_ALLOWED_DIRS = dir;
    const { executor } = await import('../src/executor.js');
    const original = executor.runScript;
    try {
        const projectFile = path.join(dir, 'Edit.prproj');
        writeFileSync(projectFile, 'x');
        const auto = path.join(dir, 'Adobe Premiere Pro Auto-Save');
        mkdirSync(auto);
        const older = path.join(auto, 'Edit--a1-2026-10-01_10-00-00.prproj');
        const newer = path.join(auto, 'Edit--a1-2026-10-02_10-00-00.prproj');
        writeFileSync(older, 'x');
        writeFileSync(newer, 'xy');
        writeFileSync(path.join(auto, 'Other--b2-2026-10-03_10-00-00.prproj'), 'x');
        writeFileSync(path.join(auto, 'Edit notes.txt'), 'x');
        utimesSync(older, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
        utimesSync(newer, new Date('2026-10-02T10:00:00Z'), new Date('2026-10-02T10:00:00Z'));

        const mcp = await server();
        await assert.rejects(mcp.handleToolCall('recover_project', { project: path.join(dir, 'Edit.txt') }), /must end in \.prproj/);
        await assert.rejects(mcp.handleToolCall('recover_project', { project: projectFile, openFile: newer }), /openFile goes with open: true/);
        await assert.rejects(mcp.handleToolCall('recover_project', { folder: '/etc' }), /outside the allowed directories|system directory/);

        const sent = [];
        // Premiere Pro has another project active, so the folder beside Edit.prproj is used.
        executor.runScript = async (s) => { sent.push(s); return { ok: true, result: sent.length === 1 ? { path: path.join(dir, 'Other.prproj'), autoSave: 'SameAsProject' } : { name: 'Edit', path: newer } }; };
        const listed = await mcp.handleToolCall('recover_project', { project: projectFile });
        assert.equal(listed.success, true, JSON.stringify(listed));
        assert.equal(listed.result.folder, auto);
        assert.equal(listed.result.folderFrom, 'beside the project');
        assert.deepEqual(listed.result.copies.map((c) => c.file), [newer, older]);
        assert.match(body(sent[0]), /ppro\.ProjectSettings\.getScratchDiskSettings\(project\)/);
        assert.match(body(sent[0]), /getScratchDiskPath\(__C\.ScratchDiskFolderType\.AUTO_SAVE\)/);

        sent.length = 0;
        const opened = await mcp.handleToolCall('recover_project', { project: projectFile, open: true });
        assert.equal(opened.success, true, JSON.stringify(opened));
        assert.equal(opened.result.openedFile, newer);
        assert.equal(sent.length, 2);
        assert.match(body(sent[1]), /options\.setShowWarningDialog\(false\);/);
        assert.match(body(sent[1]), /options\.setAddToMRUList\(false\);/);
        assert.ok(body(sent[1]).includes(`ppro.Project.open(${JSON.stringify(newer)}, options)`));

        // The active project's own Auto Save scratch disk wins when it is a real folder.
        const elsewhere = path.join(dir, 'autosaves');
        mkdirSync(elsewhere);
        executor.runScript = async () => ({ ok: true, result: { path: projectFile, autoSave: elsewhere } });
        const active = await mcp.handleToolCall('recover_project', {});
        assert.equal(active.result.folder, elsewhere);
        assert.equal(active.result.folderFrom, 'scratch disk');
        assert.equal(active.result.count, 0);

        executor.runScript = async () => ({ ok: true, result: { path: null, autoSave: null } });
        await assert.rejects(mcp.handleToolCall('recover_project', {}), /No project is open/);
        await assert.rejects(mcp.handleToolCall('recover_project', { folder: elsewhere, open: true }), /No Auto-Save copies/);
    } finally {
        executor.runScript = original;
        if (previous === undefined) delete process.env.PREMIERE_ALLOWED_DIRS; else process.env.PREMIERE_ALLOWED_DIRS = previous;
        rmSync(dir, { recursive: true, force: true });
    }
});
