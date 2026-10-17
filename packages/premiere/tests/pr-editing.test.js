/**
 * Editing, sequences and markers: selection, slip, roll, slide and trims to
 * the playhead, playhead moves, marking clips, subclips and source in/out,
 * the Source Monitor, subsequences, scene edit detection, custom sequence
 * properties and preview folders. Scripts are checked by the audit; the
 * timeline edits also run against a small fake timeline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolTable } from '../src/server.js';
import { scriptsFor, server, body, loadRuntime } from './helpers.js';

const clip = (track, trackIndex, clipIndex) => ({ track, trackIndex, clipIndex });
const tool = (name) => toolTable.find((t) => t.name === name);
const { createRuntime } = loadRuntime();

/** A timeline of clips given as [start, end, in] seconds per track, with the members the scripts use. */
function fakeTimeline({ video = [], audio = [], playhead = 0, markers = [] } = {}) {
    let locked = false;
    const undo = [];
    const TPS = 254016000000;
    const tick = (seconds) => ({
        seconds, ticksNumber: Math.round(seconds * TPS), ticks: String(Math.round(seconds * TPS)),
        add: (t) => tick(Math.round((seconds + t.seconds) * 1e6) / 1e6),
        subtract: (t) => tick(Math.round((seconds - t.seconds) * 1e6) / 1e6),
    });
    const action = (apply) => { if (!locked) throw new Error('Actions must be created inside project.lockedAccess'); return { apply }; };
    const makeClip = (kind, trackIndex, [start, end, inPoint = 0], n) => {
        const c = {
            name: `${kind[0].toUpperCase()}${trackIndex + 1} clip ${n}`, start: tick(start), end: tick(end), inPoint: tick(inPoint), outPoint: tick(inPoint + end - start), selected: false,
            getName: async () => c.name, getTrackIndex: async () => trackIndex,
            getStartTime: async () => c.start, getEndTime: async () => c.end, getDuration: async () => tick(c.end.seconds - c.start.seconds),
            getInPoint: async () => c.inPoint, getOutPoint: async () => c.outPoint, isDisabled: async () => false,
            getIsSelected: async () => c.selected, getSpeed: async () => 1, getProjectItem: async () => null,
            createSetStartAction: (t) => action(() => { c.start = t; }),
            createSetEndAction: (t) => action(() => { c.end = t; }),
            createSetInPointAction: (t) => action(() => { c.inPoint = t; }),
            createSetOutPointAction: (t) => action(() => { c.outPoint = t; }),
            createMoveAction: (d) => action(() => { c.start = c.start.add(d); c.end = c.end.add(d); }),
        };
        if (kind === 'video') c.createAddVideoTransitionAction = () => null;
        return c;
    };
    const tracks = {
        video: video.map((list, t) => list.map((spec, i) => makeClip('video', t, spec, i))),
        audio: audio.map((list, t) => list.map((spec, i) => makeClip('audio', t, spec, i))),
    };
    const track = (kind, t) => ({ name: `${kind} ${t}`, getTrackItems: () => tracks[kind][t].slice().sort((x, y) => x.start.seconds - y.start.seconds) });
    const all = () => [...tracks.video.flat(), ...tracks.audio.flat()];
    const markerList = markers.map((s, i) => ({ getStart: () => tick(s), getName: () => `M${i}`, getType: () => 'Comment', getComments: () => '' }));
    const sequence = {
        name: 'Main edit', guid: { toString: () => 'seq-1' },
        inPoint: tick(0), outPoint: tick(60), playhead: tick(playhead),
        getTimebase: async () => '10584000000',
        getPlayerPosition: async () => sequence.playhead,
        setPlayerPosition: async (t) => { sequence.playhead = t; return true; },
        getInPoint: async () => sequence.inPoint,
        getOutPoint: async () => sequence.outPoint,
        getVideoTrackCount: async () => tracks.video.length,
        getAudioTrackCount: async () => tracks.audio.length,
        getVideoTrack: async (t) => track('video', t),
        getAudioTrack: async (t) => track('audio', t),
        getSelection: async () => ({ getTrackItems: async () => all().filter((c) => c.selected) }),
        setSelection: (sel) => { for (const c of all()) c.selected = sel.items.includes(c); return true; },
        clearSelection: async () => { for (const c of all()) c.selected = false; return true; },
        createSetInPointAction: (t) => action(() => { sequence.inPoint = t; }),
        createSetOutPointAction: (t) => action(() => { sequence.outPoint = t; }),
    };
    const project = {
        getActiveSequence: async () => sequence,
        lockedAccess(cb) { locked = true; try { cb(); } finally { locked = false; } },
        executeTransaction(cb, name) {
            const compound = { actions: [], addAction(a) { this.actions.push(a); return true; } };
            cb(compound);
            for (const a of compound.actions) a.apply();
            undo.push(name);
            return true;
        },
    };
    const ppro = {
        Project: { getActiveProject: async () => project },
        Markers: { getMarkers: async () => ({ getMarkers: () => markerList }) },
        TickTime: { createWithSeconds: tick, createWithTicks: (s) => tick(Number(s) / TPS) },
        TrackItemSelection: {
            createEmptySelection: (cb) => { const sel = { items: [], addItem(c) { sel.items.push(c); return true; } }; cb(sel); return true; },
        },
        Constants: { TrackItemType: { CLIP: 1 }, MediaType: { ANY: 0 } },
    };
    return { ppro, sequence, tracks, undo };
}

/** Run a generated script against a fake; resolves to its result or rejects with its error. */
async function runOn(fake, code) {
    const rt = createRuntime({ ppro: fake.ppro });
    const out = [];
    await rt.handleMessage({ type: 'execute', id: '1', code }, (s) => out.push(JSON.parse(s)));
    const msg = out.find((m) => m.id === '1');
    if (msg.type === 'error') throw new Error(msg.error);
    return msg.result;
}

const secs = (c) => [c.start.seconds, c.end.seconds, c.inPoint.seconds, c.outPoint.seconds];

test('every ticket feature is claimed by a tool', () => {
    const claimed = new Set(toolTable.flatMap((t) => t.features ?? []));
    const ids = [
        'editing.selection_tool', 'editing.track_select_forward', 'editing.track_select_backward', 'editing.pen_tool_timeline', 'editing.remove_attributes',
        'editing.select_all', 'editing.deselect_all', 'editing.trim_previous', 'editing.trim_next', 'editing.rolling_edit', 'editing.slip_edit',
        'editing.slide_edit', 'editing.slip_clip_selection', 'editing.j_l_cuts', 'editing.make_subclip', 'editing.scale_to_frame_size',
        'editing.set_to_frame_size', 'editing.select_clip_at_playhead', 'editing.properties_panel_editing', 'editing.add_clips_from_transcript',
        'editing.play_stop', 'editing.shuttle', 'editing.step_frame', 'editing.go_to_edit_point',
        'sequences.sequence_presets', 'sequences.close_sequence', 'sequences.make_subsequence', 'sequences.preview_files', 'sequences.match_frame',
        'sequences.scene_edit_detection', 'sequences.find_in_sequence', 'sequences.go_to_gap', 'sequences.next_in_sequence',
        'sequences.previous_in_sequence', 'sequences.custom_property', 'sequences.aspect_ratio_sequence',
        'markers.go_to_next_marker', 'markers.go_to_previous_marker', 'markers.clear_all_markers', 'markers.marker_comments', 'markers.mark_clip',
        'markers.mark_selection', 'markers.go_to_in', 'markers.go_to_out', 'markers.clear_in_and_out', 'markers.chapter_markers_export',
        'multicam.multicam_source_sequence', 'multicam.mark_for_sync', 'multicam.multicam_alternate',
    ].map((id) => `premiere.${id}`);
    assert.deepEqual(ids.filter((id) => !claimed.has(id)), []);
    assert.ok(tool('edit_clips').features.includes('premiere.editing.j_l_cuts'));
    assert.ok(tool('insert_clip').features.includes('premiere.editing.add_clips_from_transcript'));
    assert.ok(tool('remove_markers').features.includes('premiere.markers.clear_all_markers'));
    assert.equal(tool('create_subclip').since, '26.3');
    assert.equal(tool('close_sequence').since, '26.2');
});

test('select_clips: modes, and arguments that do not fit them', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'some' }), /Allowed: clips, all, none/);
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'clips' }), /needs clips\.items/);
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'all', clips: { selected: true } }), /only for mode clips/);
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'all', time: 3 }), /only for modes forward and backward/);
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'next', track: 'video', trackIndex: 0 }), /do not apply to mode next/);
    await assert.rejects(mcp.handleToolCall('select_clips', { mode: 'all', trackIndex: 0 }), /Give track with trackIndex/);

    const [chosen, none, forward] = await scriptsFor([
        ['select_clips', { mode: 'clips', clips: { items: [clip('video', 0, 1)] } }],
        ['select_clips', { mode: 'none' }],
        ['select_clips', { mode: 'forward', time: 4, track: 'audio', trackIndex: 1 }],
    ]);
    assert.match(body(chosen), /const chosen = await __clips\(seq, \{"items":\[\{"track":"video","trackIndex":0,"clipIndex":1\}\],"selected":false\}\);/);
    assert.match(body(chosen), /await seq\.setSelection\(selection\)/);
    assert.match(body(none), /const chosen = \[\];/);
    assert.match(body(none), /await seq\.clearSelection\(\);/);
    assert.match(body(forward), /const at = 4;\nconst chosen = \(await __walkClips\(seq, \["video", "audio"\], \{"track":"audio","trackIndex":1\}\)\)\.filter\(\(c\) => c\.end > at\)/);

    const fake = fakeTimeline({ video: [[[0, 5], [5, 10], [12, 20]]], audio: [[[0, 10]]], playhead: 6 });
    const [atHead, all, next, back] = await scriptsFor([
        ['select_clips', { mode: 'at_playhead' }],
        ['select_clips', { mode: 'all', track: 'video', trackIndex: 0 }],
        ['select_clips', { mode: 'next' }],
        ['select_clips', { mode: 'backward', time: 5 }],
    ]);
    let r = await runOn(fake, atHead);
    assert.deepEqual(r.clips.map((c) => [c.track, c.clipIndex]), [['video', 1], ['audio', 0]]);
    r = await runOn(fake, next);
    assert.deepEqual(r.clips.map((c) => [c.track, c.clipIndex]), [['video', 2]], 'the audio track has no next clip');
    r = await runOn(fake, all);
    assert.equal(r.selected, 3);
    r = await runOn(fake, back);
    assert.deepEqual(r.clips.map((c) => [c.track, c.clipIndex]), [['video', 0], ['audio', 0]]);
});

test('edit_clips: slip, roll, slide and trims, checked and run on a timeline', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'slip' }), /slip needs clips/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'slip', clips: { selected: true } }), /Give by \(seconds\) or frames/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'slip', clips: { selected: true }, by: 1, frames: 2 }), /not both/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'roll', clips: { selected: true }, by: 0 }), /nothing to change/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'slide', clips: { selected: true }, frames: 1.5 }), /whole number/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'trim_end_to_playhead', by: 1 }), /by and frames do not apply/);
    await assert.rejects(mcp.handleToolCall('edit_clips', { operation: 'ripple', clips: { selected: true }, by: 1 }), /Allowed: slip, roll/);

    const [slip, roll, slide, trimStart, trimEnd, slipFrames] = await scriptsFor([
        ['edit_clips', { operation: 'slip', clips: { items: [clip('video', 0, 1)] }, by: 1 }],
        ['edit_clips', { operation: 'roll', clips: { items: [clip('video', 0, 0)] }, by: 1 }],
        ['edit_clips', { operation: 'slide', clips: { items: [clip('video', 0, 1)] }, by: -1 }],
        ['edit_clips', { operation: 'trim_start_to_playhead' }],
        ['edit_clips', { operation: 'trim_end_to_playhead', clips: { items: [clip('audio', 0, 0)] } }],
        ['edit_clips', { operation: 'slip', clips: { selected: true }, frames: -5 }],
    ]);
    assert.match(body(slipFrames), /ppro\.TickTime\.createWithTicks\(String\(Number\(await seq\.getTimebase\(\)\) \* -5\)\)/);
    assert.match(body(roll), /transact\(project, "Rolling edit"/);

    const v = () => fakeTimeline({ video: [[[0, 5, 10], [5, 10, 20], [10, 15, 30]]], audio: [[[0, 10, 10]]], playhead: 7 });
    let fake = v();
    await runOn(fake, slip);
    assert.deepEqual(secs(fake.tracks.video[0][1]), [5, 10, 21, 26]);

    fake = v();
    await runOn(fake, roll);
    assert.deepEqual(secs(fake.tracks.video[0][0]), [0, 6, 10, 16], 'the outgoing clip ends later');
    assert.deepEqual(secs(fake.tracks.video[0][1]), [6, 10, 21, 25], 'the incoming clip starts later');

    fake = v();
    await runOn(fake, slide);
    assert.deepEqual(secs(fake.tracks.video[0][0]), [0, 4, 10, 14]);
    assert.deepEqual(secs(fake.tracks.video[0][1]), [4, 9, 20, 25], 'the clip moves, keeping its frames');
    assert.deepEqual(secs(fake.tracks.video[0][2]), [9, 15, 29, 35]);
    assert.deepEqual(fake.undo, ['Slide']);

    fake = v();
    const trimmed = await runOn(fake, trimStart);
    assert.equal(trimmed.clips.length, 2, 'every clip under the playhead');
    assert.deepEqual(secs(fake.tracks.video[0][1]), [7, 10, 22, 25]);
    assert.deepEqual(secs(fake.tracks.audio[0][0]), [7, 10, 17, 20]);

    fake = v();
    await runOn(fake, trimEnd);
    assert.deepEqual(secs(fake.tracks.audio[0][0]), [0, 7, 10, 17]);

    fake = fakeTimeline({ video: [[[0, 5], [6, 10]]] });
    await assert.rejects(runOn(fake, roll), /a roll needs two adjacent clips/);
    fake = fakeTimeline({ video: [[[0, 0.5], [0.5, 5, 10], [5, 10, 20]]] });
    await assert.rejects(runOn(fake, slide), /would leave nothing/);
    fake = fakeTimeline({ video: [[[0, 5], [5, 10], [10, 11]]] });
    await assert.rejects(runOn(fake, slide), /has no media that early/);
});

test('move_playhead: frames, edits, gaps, markers, in and out', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('move_playhead', { to: 'next_clip' }), /Allowed: next_frame/);
    await assert.rejects(mcp.handleToolCall('move_playhead', { to: 'next_edit', frames: 2 }), /only for next_frame/);
    await assert.rejects(mcp.handleToolCall('move_playhead', { to: 'in', track: 'video', trackIndex: 0 }), /only for edits and gaps/);

    const scripts = await scriptsFor([
        ['move_playhead', { to: 'next_frame', frames: 5 }],
        ['move_playhead', { to: 'previous_edit' }],
        ['move_playhead', { to: 'next_gap' }],
        ['move_playhead', { to: 'next_gap', track: 'video', trackIndex: 0 }],
        ['move_playhead', { to: 'previous_marker' }],
        ['move_playhead', { to: 'out' }],
        ['move_playhead', { to: 'next_edit' }],
    ]);
    const [frames, prevEdit, gap, trackGap, marker, out, nextEdit] = scripts;
    const timeline = () => fakeTimeline({ video: [[[0, 5], [8, 12]]], audio: [[[0, 7]]], playhead: 4, markers: [1, 3.5, 9] });
    assert.equal((await runOn(timeline(), frames)).playhead, 4.208333, '5 frames at 24 fps');
    assert.equal((await runOn(timeline(), prevEdit)).playhead, 0);
    assert.equal((await runOn(timeline(), nextEdit)).playhead, 5);
    assert.equal((await runOn(timeline(), gap)).playhead, 7, 'A1 covers 5 to 7, so the sequence gap starts at 7');
    assert.equal((await runOn(timeline(), trackGap)).playhead, 5, 'V1 alone has a gap at 5');
    const m = await runOn(timeline(), marker);
    assert.equal(m.playhead, 3.5);
    assert.equal(m.marker.name, 'M1');
    assert.equal((await runOn(timeline(), out)).playhead, 60);
    await assert.rejects(runOn(fakeTimeline({ video: [[[0, 5]]], playhead: 5 }), nextEdit), /No edit point after the playhead/);
});

test('mark_clips sets in and out around clips', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('mark_clips', { clips: { selected: true }, track: 'video', trackIndex: 0 }), /not both/);
    const [atHead, selection] = await scriptsFor([
        ['mark_clips', {}],
        ['mark_clips', { clips: { selected: true } }],
    ]);
    let fake = fakeTimeline({ video: [[[0, 5], [5, 9]]], audio: [[[4, 12]]], playhead: 6 });
    let r = await runOn(fake, atHead);
    assert.deepEqual([r.inPoint, r.outPoint], [4, 12]);
    fake = fakeTimeline({ video: [[[0, 5], [5, 9]]] });
    fake.tracks.video[0][0].selected = true;
    fake.tracks.video[0][1].selected = true;
    r = await runOn(fake, selection);
    assert.deepEqual([r.inPoint, r.outPoint], [0, 9]);
    assert.deepEqual(fake.undo, ['Mark clips']);
});

test('fit_clips_to_frame and list_clips by name', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('fit_clips_to_frame', { clips: { selected: true }, sourceWidth: 1920 }), /together/);
    await assert.rejects(mcp.handleToolCall('fit_clips_to_frame', { clips: { selected: true }, mode: 'stretch' }), /Allowed: fit, fill/);
    await assert.rejects(mcp.handleToolCall('list_clips', { name: '' }), /must be some text/);
    const [fit, given, named, plain] = await scriptsFor([
        ['fit_clips_to_frame', { clips: { selected: true } }],
        ['fit_clips_to_frame', { clips: { selected: true }, mode: 'fill', sourceWidth: 3840, sourceHeight: 2160 }],
        ['list_clips', { name: 'Interview' }],
        ['list_clips', {}],
    ]);
    assert.match(body(fit), /Math\.min\)\(ratios\[0\], ratios\[1\]\)/);
    assert.match(body(fit), /ppro\.Metadata\.getProjectMetadata\(item\)/);
    assert.match(body(given), /const given = \{"width":3840,"height":2160\};/);
    assert.match(body(given), /Math\.max\)/);
    assert.match(body(named), /String\(info\.name\)\.toLowerCase\(\)\.includes\("interview"\)/);
    assert.doesNotMatch(body(plain), /toLowerCase/);
});

test('insert and overwrite a source range', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('insert_clip', { item: { id: '1' }, time: 0, sourceIn: 2 }), /sourceIn and sourceOut together/);
    await assert.rejects(mcp.handleToolCall('overwrite_clip', { item: { id: '1' }, time: 0, sourceIn: 5, sourceOut: 2 }), /sourceOut must be after sourceIn/);
    const [ranged, whole] = await scriptsFor([
        ['insert_clip', { item: { path: 'Footage/Interview.mov' }, time: 10, sourceIn: 3.25, sourceOut: 8 }],
        ['overwrite_clip', { item: { id: 'abc' }, time: 0 }],
    ]);
    assert.match(body(ranged), /add\(entry\.clip\.createSetInOutPointsAction\(__t\(3\.25\), __t\(8\)\)\)/);
    assert.ok(body(ranged).indexOf('createSetInOutPointsAction') < body(ranged).indexOf('createInsertProjectItemAction'));
    assert.doesNotMatch(body(whole), /createSetInOutPointsAction/);
});

test('source clips and the Source Monitor', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_subclip', { item: { id: '1' }, name: 'A', start: 5, end: 2 }), /end must be after start/);
    await assert.rejects(mcp.handleToolCall('create_subclip', { item: { id: '1' }, name: ' ', start: 0, end: 2 }), /'name' is empty/);
    await assert.rejects(mcp.handleToolCall('create_subclip', { item: { id: '1' }, name: 'A', start: 0, end: 2, video: false, audio: false }), /needs video or audio/);
    await assert.rejects(mcp.handleToolCall('set_source_in_out', { item: { id: '1' } }), /Nothing to set/);
    await assert.rejects(mcp.handleToolCall('set_source_in_out', { item: { id: '1' }, clear: true, inPoint: 1 }), /clear cannot be combined/);
    await assert.rejects(mcp.handleToolCall('set_source_in_out', { item: { id: '1' }, items: [{ id: '2' }], clear: true }), /item or items, not both/);
    await assert.rejects(mcp.handleToolCall('set_source_in_out', { clear: true }), /Choose the clip project items/);
    await assert.rejects(mcp.handleToolCall('scale_to_frame_size', { items: [] }), /Choose the clip project items/);
    await assert.rejects(mcp.handleToolCall('control_source_monitor', { action: 'open' }), /open needs item/);
    await assert.rejects(mcp.handleToolCall('control_source_monitor', { action: 'play', speed: 9 }), /speed/);
    await assert.rejects(mcp.handleToolCall('control_source_monitor', { action: 'status', item: { id: '1' } }), /'item' does not apply to action status/);
    await assert.rejects(mcp.handleToolCall('control_source_monitor', { action: 'rewind' }), /Allowed: open, play/);

    const [sub, inOut, clear, scale, open, play, stop, match, matchClip] = await scriptsFor([
        ['create_subclip', { item: { path: 'Footage/a.mov' }, name: 'Take "2"', start: 1, end: 4, restrictTrims: true, audio: false }],
        ['set_source_in_out', { items: [{ path: 'Cam A.mov' }, { path: 'Cam B.mov' }], inPoint: 12 }],
        ['set_source_in_out', { item: { id: 'x' }, clear: true }],
        ['scale_to_frame_size', { items: [{ id: 'a' }, { id: 'b' }] }],
        ['control_source_monitor', { action: 'open', item: { id: 'a' }, position: 3 }],
        ['control_source_monitor', { action: 'play', speed: -2 }],
        ['control_source_monitor', { action: 'play', speed: 0 }],
        ['control_source_monitor', { action: 'match_frame' }],
        ['control_source_monitor', { action: 'match_frame', clip: clip('video', 1, 0) }],
    ]);
    assert.match(body(sub), /clip\.createSubClipAction\("Take \\"2\\"", __t\(1\), __t\(4\), true, \{ takeVideo: true, takeAudio: false \}\)/);
    assert.match(body(inOut), /const inP = 12, outP = now\.outPoint;/);
    assert.match(body(inOut), /p\.clip\.createSetInOutPointsAction\(__t\(p\.inP\), __t\(p\.outP\)\)/);
    assert.match(body(clear), /p\.clip\.createClearInOutPointsAction\(\)/);
    assert.match(body(scale), /e\.clip\.createSetScaleToFrameSizeAction\(\)/);
    assert.match(body(open), /ppro\.SourceMonitor\.openProjectItem\(entry\.item\)/);
    assert.match(body(open), /await setPosition\(__t\(3\)\)/);
    assert.match(body(open), /typeof ppro\.SourceMonitor\.setPosition !== "function"/);
    assert.match(body(play), /ppro\.SourceMonitor\.play\(-2\)/);
    assert.match(body(stop), /ppro\.SourceMonitor\.play\(0\)/);
    assert.match(body(match), /\(await clip\.getInPoint\(\)\)\.add\(head\.subtract\(await clip\.getStartTime\(\)\)\)/);
    assert.match(body(matchClip), /\[clip\] = await __clips\(seq, \{"items":\[\{"track":"video","trackIndex":1,"clipIndex":0\}\],"selected":false\}\);/);
});

test('sequence commands: close, subsequence, scene edits, properties and preview folders', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_scene_edit_detection', { clips: { selected: true }, operation: 'split' }), /Allowed: cut, marker, subclip/);
    await assert.rejects(mcp.handleToolCall('run_scene_edit_detection', { clips: {} }), /Choose the clips/);
    await assert.rejects(mcp.handleToolCall('get_sequence_properties', { names: [] }), /at least one property name/);
    await assert.rejects(mcp.handleToolCall('get_sequence_properties', { names: ['a"b'] }), /names\[0\] must be/);
    await assert.rejects(mcp.handleToolCall('set_sequence_properties', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_sequence_properties', { values: { a: [1] } }), /text, a number or true\/false/);
    await assert.rejects(mcp.handleToolCall('set_sequence_properties', { values: { a: 1 }, clear: ['a'] }), /cannot be set and cleared/);
    await assert.rejects(mcp.handleToolCall('set_preview_folders', {}), /Nothing to change/);
    await assert.rejects(mcp.handleToolCall('set_preview_folders', { video: '/Volumes/Fast' }), /Allowed: same_as_project, my_documents/);

    const [close, sub, scenes, get, set, previews] = await scriptsFor([
        ['close_sequence', { sequence: { name: 'Rough cut' } }],
        ['create_subsequence', { allTracks: true }],
        ['run_scene_edit_detection', { clips: { selected: true }, operation: 'subclip', waitSeconds: 10 }],
        ['get_sequence_properties', { names: ['review.status'] }],
        ['set_sequence_properties', { values: { 'review.status': 'approved', takes: 3, final: false }, clear: ['old'], persistent: false }],
        ['set_preview_folders', { video: 'same_as_project' }],
    ]);
    assert.match(body(close), /await project\.closeSequence\(seq\)/);
    assert.match(body(sub), /await seq\.createSubsequence\(true\)/);
    assert.doesNotMatch(body(sub), /openSequence/);
    assert.match(body(scenes), /ppro\.SequenceUtils\.performSceneEditDetectionOnSelection\(__C\.SequenceOperation\.CREATESUBCLIP, selection\)/);
    assert.match(body(scenes), /waited < 10 \* 1000/);
    assert.match(body(get), /props\.hasValue\(name\) \? props\.getValue\(name\) : null/);
    assert.match(body(set), /const sets = \[\["review\.status","approved"\],\["takes",3\],\["final",false\]\], clear = \["old"\];/);
    assert.match(body(set), /__C\.PropertyType\.NON_PERSISTENT/);
    assert.match(body(previews), /setScratchDiskPath\(__C\.ScratchDiskFolderType\.VIDEO_PREVIEW, __C\.ScratchDiskFolder\.SAME_AS_PROJECT\)/);
    assert.doesNotMatch(body(previews), /AUDIO_PREVIEW, __C/);
    assert.match(body(previews), /ppro\.ProjectSettings\.createSetScratchDiskSettingsAction\(project, settings\)/);
});
