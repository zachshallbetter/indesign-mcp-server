/**
 * Tool arguments and the scripts they become. Premiere Pro is never contacted:
 * scriptsFor() stubs the executor and checks each script with the audit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { sequenceSpec, itemSpec, clipsSpec, clipSpec, paramValue } from '../src/args.js';
import { script } from '../src/script.js';
import { checkScript } from './audit.js';
import { scriptsFor, server, body, docs } from './helpers.js';

const clip = (track, trackIndex, clipIndex) => ({ track, trackIndex, clipIndex });

test('arguments become safe script literals', () => {
    assert.deepEqual(JSON.parse(sequenceSpec(undefined)), {});
    assert.deepEqual(JSON.parse(sequenceSpec({ name: 'Main "edit"' })), { name: 'Main "edit"' });
    assert.deepEqual(JSON.parse(sequenceSpec({ name: 'x', guid: 'g' })), { guid: 'g' });
    assert.deepEqual(JSON.parse(itemSpec({ path: '/Footage//Interviews/' })), { path: 'Footage/Interviews' });
    assert.throws(() => itemSpec({}), /needs id, path or name/);
    assert.throws(() => itemSpec({ path: '//' }), /path' is empty/);
    assert.deepEqual(JSON.parse(clipsSpec({ items: [clip('video', 1, 2)] })), { items: [{ track: 'video', trackIndex: 1, clipIndex: 2 }], selected: false });
    assert.deepEqual(JSON.parse(clipsSpec({ selected: true })), { items: [], selected: true });
    assert.throws(() => clipsSpec({}), /Choose the clips/);
    assert.throws(() => clipSpec(clip('caption', 0, 0)), /must be "video" or "audio"/);
    assert.throws(() => clipSpec(clip('video', -1, 0)), /Invalid index for 'clip.trackIndex'/);
    assert.equal(paramValue(12.5), '12.5');
    assert.equal(paramValue('a"b'), '"a\\"b"');
    assert.deepEqual(JSON.parse(paramValue({ x: 1, y: 2 })), { x: 1, y: 2 });
    assert.deepEqual(JSON.parse(paramValue({ red: 1, green: 0.5, blue: 0 })), { red: 1, green: 0.5, blue: 0, alpha: 1 });
    assert.throws(() => paramValue({ red: 2, green: 0, blue: 0 }), /out of range/);
    assert.throws(() => paramValue([1, 2]), /must be a number, text/);
    assert.throws(() => paramValue(Infinity), /finite/);
});

test('a name cannot break out of its string', async () => {
    const [s] = await scriptsFor([['create_bin', { name: '"); ppro.Project.open("/x' }]]);
    assert.match(s, /createBinAction\("\\"\); ppro\.Project\.open\(\\"\/x", true\)/);
    assert.deepEqual(checkScript(s).problems, []);
});

test('every script starts with the shared helpers and edits go through transact', async () => {
    const s = script('return 1;');
    assert.match(s, /^\nconst __C = ppro\.Constants;/);
    assert.match(s, /async function __project\(\)/);
    assert.match(s, /\/\/ ---- tool\nreturn 1;\n$/);
    const [trim] = await scriptsFor([['trim_clip', { clip: clip('video', 0, 3), start: 10, end: 14 }]]);
    assert.match(body(trim), /transact\(project, "Trim clip", \(add\) => \{\n {2}add\(clip\.createSetStartAction\(__t\(10\)\)\);\n {2}add\(clip\.createSetEndAction\(__t\(14\)\)\);\n\}\);/);
    assert.doesNotMatch(body(trim), /createSetInPointAction/);
});

test('project: paths are checked, extensions enforced, and existing files kept', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('open_project', { filePath: '/etc/a.prproj' }), /outside the allowed directories|system directory/);
    await assert.rejects(mcp.handleToolCall('open_project', { filePath: path.join(docs, 'a.txt') }), /must end in \.prproj/);
    await assert.rejects(mcp.handleToolCall('open_project', { filePath: 'relative.prproj' }), /absolute path/);
    await assert.rejects(mcp.handleToolCall('import_media', { files: [] }), /at least one path/);
    await assert.rejects(mcp.handleToolCall('manage_items', { items: [{ id: '1' }], delete: true, label: 2 }), /delete cannot be combined/);
    await assert.rejects(mcp.handleToolCall('manage_items', { items: [{ id: '1' }, { id: '2' }], rename: 'x' }), /Rename one item/);
    await assert.rejects(mcp.handleToolCall('manage_items', { items: [{ id: '1' }] }), /Nothing to do/);
    await assert.rejects(mcp.handleToolCall('manage_items', { items: [{ id: '1' }], label: 16 }), /Invalid index for 'label'/);

    const [open, save, imp, manage] = await scriptsFor([
        ['open_project', { filePath: path.join(docs, 'Doc.prproj') }],
        ['save_project', {}],
        ['import_media', { files: [path.join(docs, 'a.mov')], numberedStills: true }],
        ['manage_items', { items: [{ path: 'Footage/a.mov' }], moveTo: { path: 'Selects' }, label: 4 }],
    ]);
    assert.match(body(open), /options\.setShowConvertProjectDialog\(false\);/);
    assert.match(body(open), /await ppro\.Project\.open\(".*Doc\.prproj", options\)/);
    assert.match(body(save), /await project\.save\(\)/);
    assert.match(body(imp), /await project\.importFiles\(\[".*a\.mov"\], true, target\.item, true\)/);
    assert.match(body(manage), /add\(e\.item\.createSetColorLabelAction\(4\)\);/);
    assert.match(body(manage), /add\(e\.item\.getParentBin\(\)\.createMoveItemAction\(e\.item, target\.bin\)\);/);
});

test('sequences: presets, clips, settings and times', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_sequence', { name: 'A', preset: path.join(docs, 'p.sqpreset'), items: [{ id: '1' }] }), /preset or items, not both/);
    await assert.rejects(mcp.handleToolCall('set_sequence_settings', { width: 1920 }), /width and height together/);
    await assert.rejects(mcp.handleToolCall('set_sequence_settings', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_sequence_settings', { fieldType: 'INTERLACED' }), /Allowed: PROGRESSIVE/);
    await assert.rejects(mcp.handleToolCall('set_sequence_times', { inPoint: 5, outPoint: 2 }), /outPoint must be after inPoint/);
    await assert.rejects(mcp.handleToolCall('delete_sequence', { sequence: {} }), /Name the sequence/);

    const [preset, fromClips, settings, times] = await scriptsFor([
        ['create_sequence', { name: 'Edit', preset: path.join(docs, 'HD.sqpreset') }],
        ['create_sequence', { name: 'Edit', items: [{ path: 'a.mov' }], open: false }],
        ['set_sequence_settings', { width: 3840, height: 2160, frameRate: 25, fieldType: 'PROGRESSIVE' }],
        ['set_sequence_times', { zeroPoint: 3600, workAreaIn: 1, workAreaOut: 5 }],
    ]);
    assert.match(body(preset), /typeof project\.createSequenceWithPresetPath === "function"/);
    assert.match(body(fromClips), /project\.createSequenceFromMedia\(name, clips, bin\)/);
    assert.doesNotMatch(body(fromClips), /openSequence/);
    assert.match(body(settings), /r\.width = 3840; r\.height = 2160;/);
    assert.match(body(settings), /st\.setVideoFrameRate\(ppro\.FrameRate\.createWithValue\(25\)\)/);
    assert.match(body(settings), /__C\.VideoFieldType\.PROGRESSIVE/);
    assert.match(body(settings), /add\(seq\.createSetSettingsAction\(st\)\)/);
    assert.match(body(times), /add\(seq\.createSetZeroPointAction\(__t\(3600\)\)\);/);
    assert.match(body(times), /ppro\.WorkAreaUtils\.setWorkAreaInOutPoints\(seq, __t\(1\), __t\(5\)\)/);
});

test('timeline: insert, overwrite, move, remove and tracks', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('move_clips', { clips: { selected: true }, by: 0 }), /nothing to move/);
    await assert.rejects(mcp.handleToolCall('trim_clip', { clip: clip('video', 0, 0) }), /Nothing to trim/);
    await assert.rejects(mcp.handleToolCall('set_track_properties', { track: 'subtitle', trackIndex: 0, muted: true }), /'track' must be/);
    await assert.rejects(mcp.handleToolCall('insert_mogrt', { filePath: path.join(docs, 'a.aep'), time: 0 }), /\.mogrt/);

    const [ins, over, move, remove, track] = await scriptsFor([
        ['insert_clip', { item: { id: 'abc' }, time: 5, videoTrackIndex: 1, audioTrackIndex: 1, limitShift: true }],
        ['overwrite_clip', { item: { name: 'b.mov' }, time: 0 }],
        ['move_clips', { clips: { items: [clip('video', 0, 1)], selected: true }, by: -1.5 }],
        ['remove_clips', { clips: { items: [clip('audio', 2, 0)] }, ripple: true }],
        ['set_track_properties', { track: 'video', trackIndex: 2, muted: true, name: 'Titles' }],
    ]);
    assert.match(body(ins), /editor\.createInsertProjectItemAction\(entry\.item, __t\(5\), 1, 1, true\)/);
    assert.match(body(over), /editor\.createOverwriteItemAction\(entry\.item, __t\(0\), 0, 0\)/);
    assert.match(body(move), /c\.createMoveAction\(__t\(-1\.5\)\)/);
    assert.match(body(remove), /editor\.createRemoveItemsAction\(selection, true, __C\.MediaType\.ANY, false\)/);
    assert.match(body(track), /track\.createSetNameAction\("Titles"\)/);
    assert.match(body(track), /await track\.setMute\(true\);/);
});

test('markers: types, colours and choosing markers', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_marker', { start: 1, color: 'pink' }), /Allowed: green, red/);
    await assert.rejects(mcp.handleToolCall('add_marker', { start: 1, type: 'Segment' }), /Allowed: Comment, Chapter, WebLink, FLVCuePoint/);
    await assert.rejects(mcp.handleToolCall('edit_marker', { name: 'x' }), /Choose the marker/);
    await assert.rejects(mcp.handleToolCall('edit_marker', { index: 0 }), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('remove_markers', {}), /Choose the markers/);
    await assert.rejects(mcp.handleToolCall('list_markers', { sequence: { name: 'a' }, item: { id: 'b' } }), /sequence or item, not both/);

    const [add, edit, clipMarkers] = await scriptsFor([
        ['add_marker', { start: 2, name: 'Intro', type: 'Chapter', color: 'Blue' }],
        ['edit_marker', { guid: 'm-1', start: 9, comments: 'Moved' }],
        ['list_markers', { item: { path: 'Footage/a.mov' } }],
    ]);
    assert.match(body(add), /markers\.createAddMarkerAction\("Intro", "Chapter", __t\(2\), __t\(0\), ""\)/);
    assert.match(body(add), /createSetColorByIndexAction\(colorIndex\("BLUE"\)\)/);
    assert.match(body(edit), /const m = pick\(\{"guid":"m-1"\}\);/);
    assert.match(body(edit), /add\(markers\.createMoveMarkerAction\(m, __t\(9\)\)\);/);
    assert.match(body(clipMarkers), /const owner = __clipItem\(ownerEntry\);/);
});

test('effects: names, parameters, keyframes and transitions', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_effect_param', { clips: { selected: true }, component: 1, value: 1 }), /param \(name\) or paramIndex/);
    await assert.rejects(mcp.handleToolCall('add_keyframes', { clip: clip('video', 0, 0), component: 1, param: 'Scale', keyframes: [] }), /at least one keyframe/);
    await assert.rejects(mcp.handleToolCall('add_keyframes', { clip: clip('video', 0, 0), component: 1, param: 'Scale', keyframes: [{ time: 0, value: 1, interpolation: 'smooth' }] }), /Allowed: LINEAR, BEZIER, HOLD, TIME/);
    await assert.rejects(mcp.handleToolCall('remove_keyframes', { clip: clip('video', 0, 0), component: 1, param: 'Scale', from: 1 }), /from and to together/);
    await assert.rejects(mcp.handleToolCall('add_transition', { clips: { selected: true }, transition: 'x', at: 'middle' }), /Allowed: start, end, both/);
    await assert.rejects(mcp.handleToolCall('list_available_effects', { kind: 'filters' }), /Allowed: video_effects/);

    const [apply, param, keys, transition, volume] = await scriptsFor([
        ['apply_effect', { clips: { items: [clip('video', 0, 0)] }, effect: 'AE.ADBE Gaussian Blur 2' }],
        ['set_effect_param', { clips: { items: [clip('video', 0, 0)] }, component: 1, param: 'Position', value: { x: 100, y: 50 } }],
        ['add_keyframes', { clip: clip('video', 0, 0), component: 1, paramIndex: 1, keyframes: [{ time: 0, value: 100 }, { time: 1, value: 150, interpolation: 'hold' }] }],
        ['add_transition', { clips: { items: [clip('video', 0, 2)] }, transition: 'AE.ADBE Cross Dissolve New', at: 'start', duration: 0.5, singleSided: true }],
        ['set_clip_volume', { clips: { items: [clip('audio', 0, 0)] }, level: 0.25 }],
    ]);
    assert.match(body(apply), /p\.chain\.createAppendComponentAction\(p\.component\)/);
    assert.match(body(apply), /ppro\.AudioFilterFactory\.createComponentByDisplayName\(effect, clip\)/);
    assert.match(body(param), /t\.param\.createSetValueAction\(t\.param\.createKeyframe\(__paramValue\(\{"x":100,"y":50\}\)\), true\)/);
    assert.match(body(keys), /const keys = \[\{ t: 0, v: 100 \}, \{ t: 1, v: 150, mode: __C\.InterpolationMode\.HOLD \}\];/);
    assert.match(body(keys), /kf\.position = __t\(k\.t\);/);
    assert.match(body(transition), /options\.setApplyToStart\(atStart\);/);
    assert.match(body(transition), /for \(const atStart of \[true\]\)/);
    assert.match(body(transition), /options\.setForceSingleSided\(true\);/);
    assert.match(body(volume), /__param\(volume, \{ param: "Level" \}\)/);
    assert.match(body(volume), /createKeyframe\(0\.25\)/);
});

test('export: presets, overwrite protection and timeline formats', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('export_sequence', { outputFile: path.join(docs, 'a.mp4'), preset: path.join(docs, 'a.sqpreset') }), /\.epr/);
    await assert.rejects(mcp.handleToolCall('export_sequence', { outputFile: path.join(docs, 'a.mp4'), preset: path.join(docs, 'a.epr'), startQueue: true }), /startQueue goes with mode queue_to_ame/);
    await assert.rejects(mcp.handleToolCall('export_frame', { outputFile: path.join(docs, 'a.psd') }), /must end in \.png/);
    await assert.rejects(mcp.handleToolCall('export_timeline', { format: 'edl', outputFile: path.join(docs, 'a.edl') }), /Allowed: fcpxml, otio, aaf/);
    await assert.rejects(mcp.handleToolCall('export_timeline', { format: 'otio', outputFile: path.join(docs, 'a.xml') }), /must end in \.otio/);

    const [encode, frame, aaf] = await scriptsFor([
        ['export_sequence', { outputFile: path.join(docs, 'out'), preset: path.join(docs, 'H264.epr'), range: 'in_to_out' }],
        ['export_frame', { outputFile: path.join(docs, 'still.png') }],
        ['export_timeline', { format: 'aaf', outputFile: path.join(docs, 'edit.aaf') }],
    ]);
    assert.match(body(encode), /ppro\.EncoderManager\.getExportFileExtension\(seq, ".*H264\.epr"\)/);
    assert.match(body(encode), /manager\.exportSequence\(seq, __C\.ExportType\.IMMEDIATELY, file, ".*H264\.epr", false\)/);
    assert.match(body(frame), /const time = await seq\.getPlayerPosition\(\);/);
    assert.match(body(frame), /ppro\.Exporter\.exportSequenceFrame\(seq, time, "still\.png", ".*Documents\/", width, height\)/);
    assert.match(body(aaf), /ppro\.ProjectConverter\.exportAAF\(seq, file, new ppro\.AAFExportOptions\(\)\)/);
});

test('metadata and transcripts', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_metadata', { item: { id: '1' } }), /Nothing to write/);
    await assert.rejects(mcp.handleToolCall('set_metadata', { item: { id: '1' }, projectMetadata: '<x/>' }), /needs 'fields'/);
    await assert.rejects(mcp.handleToolCall('export_transcript', { item: { id: '1' }, outputFile: path.join(docs, 't.txt') }), /\.json/);

    const [xmp, get] = await scriptsFor([
        ['set_metadata', { item: { id: '1' }, xmp: '<x:xmpmeta/>' }],
        ['get_metadata', { item: { id: '1' }, kind: 'xmp' }],
    ]);
    assert.match(body(xmp), /ppro\.Metadata\.createSetXMPMetadataAction\(entry\.item, "<x:xmpmeta\/>"\)/);
    assert.doesNotMatch(body(get), /getProjectMetadata/);

    const sent = await scriptsFor([['export_transcript', { item: { id: '1' } }]], { item: 'Interview.mov', json: '{"segments":[]}' });
    assert.match(body(sent[0]), /ppro\.Transcript\.exportToJSON\(clip\)/);
});

test('existing files are not replaced without overwrite, and transcripts are written by the server', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'premiere-test-'));
    const previous = process.env.PREMIERE_ALLOWED_DIRS;
    process.env.PREMIERE_ALLOWED_DIRS = dir;
    try {
        const taken = path.join(dir, 'taken.prproj');
        writeFileSync(taken, 'x');
        const mcp = await server();
        await assert.rejects(mcp.handleToolCall('save_project', { filePath: taken }), /exists: pass overwrite: true/);
        await assert.rejects(mcp.handleToolCall('create_project', { filePath: taken }), /already exists/);
        writeFileSync(path.join(dir, 'f.png'), 'x');
        await assert.rejects(mcp.handleToolCall('export_frame', { outputFile: path.join(dir, 'f.png') }), /exists/);
        await scriptsFor([['save_project', { filePath: taken, overwrite: true }]]);

        const out = path.join(dir, 'transcript.json');
        const { executor } = await import('../src/executor.js');
        const original = executor.runScript;
        executor.runScript = async () => ({ ok: true, result: { item: 'Interview.mov', json: '{"segments":[{"text":"Hello"}]}' } });
        try {
            const r = await mcp.handleToolCall('export_transcript', { item: { path: 'Interview.mov' }, outputFile: out });
            assert.equal(r.success, true, JSON.stringify(r));
            assert.equal(r.result.written, out);
            assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { segments: [{ text: 'Hello' }] });
        } finally {
            executor.runScript = original;
        }
    } finally {
        if (previous === undefined) delete process.env.PREMIERE_ALLOWED_DIRS; else process.env.PREMIERE_ALLOWED_DIRS = previous;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a script error comes back as a tool error, with the version a tool needs', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const original = executor.runScript;
    executor.runScript = async () => ({ ok: false, error: 'ppro.ProjectConverter.exportAsOpenTimelineIO is not a function' });
    try {
        const r = await mcp.handleToolCall('export_timeline', { format: 'otio', outputFile: path.join(docs, 'x.otio') });
        assert.equal(r.success, false);
        assert.match(r.result, /needs Premiere Pro 26\.2 or later/);
    } finally {
        executor.runScript = original;
    }
});
