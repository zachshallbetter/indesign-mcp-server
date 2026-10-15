/**
 * The Timeline: tracks and clips. List them, insert or overwrite project items
 * at a time, trim, move, remove, rename and enable clips, mute and rename
 * tracks, and place Motion Graphics templates.
 */
import { bool, json, str, index, num } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, CLIP_SCHEMA, CLIPS_SCHEMA, sequenceSpec, itemSpec, clipSpec, clipsSpec, seconds } from '../args.js';
import { checkedPath } from './project.js';

const TRACK_KINDS = ['video', 'audio', 'caption'];

/** Insert and overwrite differ only in the action and its last argument. */
function placeTool(mode) {
    const insert = mode === 'insert';
    return {
        name: `${mode}_clip`,
        description: insert
            ? 'Insert a project item (clip or sequence) into a sequence at a time: clips after that point on the targeted tracks move later. A track index past the last track adds a track'
            : 'Overwrite a sequence with a project item (clip or sequence) at a time: whatever is there on the targeted tracks is replaced. A track index past the last track adds a track',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                item: ITEM_SCHEMA,
                time: { type: 'number', minimum: 0, description: 'Sequence time in seconds' },
                videoTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Video track for the video, 0 = V1. Default 0', default: 0 },
                audioTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Audio track for the audio, 0 = A1. Default 0', default: 0 },
                ...(insert ? { limitShift: { type: 'boolean', description: 'Shift clips only on the targeted tracks, not on every track. Default false', default: false } } : {}),
            },
            required: ['item', 'time'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, time: 12.5, videoTrackIndex: 1, audioTrackIndex: 2 },
        features: [insert ? 'premiere.editing.insert' : 'premiere.editing.overwrite', 'premiere.editing.track_item'],
        handler: (a) => {
            const v = index(a.videoTrackIndex ?? 0, { name: 'videoTrackIndex', max: 99 });
            const au = index(a.audioTrackIndex ?? 0, { name: 'audioTrackIndex', max: 99 });
            const time = seconds(a.time, 'time');
            const action = insert
                ? `editor.createInsertProjectItemAction(entry.item, __t(${time}), ${v}, ${au}, ${bool(a.limitShift)})`
                : `editor.createOverwriteItemAction(entry.item, __t(${time}), ${v}, ${au})`;
            return run(insert ? 'Insert clip' : 'Overwrite clip', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const entry = await __item(project, ${itemSpec(a.item)});
__clipItem(entry);
const editor = ppro.SequenceEditor.getEditor(seq);
transact(project, ${str(insert ? 'Insert clip' : 'Overwrite clip')}, (add) => add(${action}));
const placed = [];
const count = await seq.getVideoTrackCount();
if (${v} < count) {
  const clips = await __trackClips(await seq.getVideoTrack(${v}));
  for (let i = 0; i < clips.length; i++) {
    if (Math.abs(__s(await clips[i].getStartTime()) - ${time}) < 0.001) placed.push({ track: "video", trackIndex: ${v}, clipIndex: i, ...(await __clipInfo(clips[i])) });
  }
}
return { sequence: seq.name, item: entry.path, time: ${time}, placed: placed };`));
        },
    };
}

export const tools = [
    {
        name: 'list_tracks',
        description: 'List a sequence\'s video, audio and caption tracks: index (0 = V1/A1/C1), name, id, mute state and how many clips each holds',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA } },
        hints: { readOnly: true },
        features: ['premiere.editing.track_object', 'premiere.audio.audio_track', 'premiere.graphics_captions.captions'],
        handler: (a) => run('List tracks', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const out = { sequence: seq.name, video: [], audio: [], caption: [] };
const counts = { video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount(), caption: await seq.getCaptionTrackCount() };
for (const kind of ["video", "audio", "caption"]) {
  for (let i = 0; i < counts[kind]; i++) {
    const track = await __track(seq, kind, i);
    const info = { index: i, name: track.name, id: track.id, muted: null, clips: null };
    try { info.muted = await track.isMuted(); } catch (e) {}
    try { info.clips = (await __trackClips(track)).length; } catch (e) {}
    out[kind].push(info);
  }
}
return out;`)),
    },
    {
        name: 'list_clips',
        description: 'List the clips on a sequence\'s tracks with the indexes other tools take (track, trackIndex, clipIndex), name, start and end in the sequence, source in and out points, duration, speed, enabled and selected state, and the project item each comes from',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                track: { type: 'string', enum: ['video', 'audio'], description: 'Only this kind of track' },
                trackIndex: { type: 'integer', minimum: 0, description: 'Only this track (with track)' },
                selected: { type: 'boolean', description: 'Only the clips selected in the Timeline', default: false },
            },
        },
        auditArgs: { track: 'video', trackIndex: 1, selected: false },
        hints: { readOnly: true },
        features: ['premiere.editing.track_item', 'premiere.audio.audio_clip', 'premiere.editing.timeline_selection'],
        handler: (a) => {
            if (a.trackIndex !== undefined && a.track === undefined) throw new Error('Give track with trackIndex');
            const kinds = a.track ? [a.track] : ['video', 'audio'];
            if (a.track && !['video', 'audio'].includes(a.track)) throw new Error("'track' must be video or audio");
            const only = a.trackIndex === undefined ? 'null' : index(a.trackIndex, { name: 'trackIndex', max: 999 });
            return run('List clips', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const out = [];
for (const kind of ${json(kinds)}) {
  const count = kind === "video" ? await seq.getVideoTrackCount() : await seq.getAudioTrackCount();
  for (let t = 0; t < count; t++) {
    if (${only} !== null && t !== ${only}) continue;
    const clips = await __trackClips(await __track(seq, kind, t));
    for (let i = 0; i < clips.length; i++) {
      const info = await __clipInfo(clips[i]);
      if (${bool(a.selected)} && !info.selected) continue;
      out.push({ track: kind, trackIndex: t, clipIndex: i, ...info });
    }
  }
}
return { sequence: seq.name, count: out.length, clips: out };`));
        },
    },
    placeTool('insert'),
    placeTool('overwrite'),
    {
        name: 'trim_clip',
        description: 'Trim a clip: set its source in and out points, or its start and end in the sequence (seconds). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: CLIP_SCHEMA,
                inPoint: { type: 'number', minimum: 0, description: 'Source in point, seconds into the media' },
                outPoint: { type: 'number', minimum: 0, description: 'Source out point, seconds into the media' },
                start: { type: 'number', minimum: 0, description: 'Start in the sequence, seconds' },
                end: { type: 'number', minimum: 0, description: 'End in the sequence, seconds' },
            },
            required: ['clip'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 2 }, inPoint: 1, outPoint: 4, start: 10, end: 13 },
        hints: { idempotent: true },
        features: ['premiere.editing.trim_clip'],
        handler: (a) => {
            const t = (k) => (a[k] === undefined ? null : seconds(a[k], k));
            const [inP, outP, start, end] = ['inPoint', 'outPoint', 'start', 'end'].map(t);
            if ([inP, outP, start, end].every((v) => v === null)) throw new Error('Nothing to trim: give inPoint, outPoint, start or end');
            if (inP !== null && outP !== null && Number(outP) <= Number(inP)) throw new Error('outPoint must be after inPoint');
            if (start !== null && end !== null && Number(end) <= Number(start)) throw new Error('end must be after start');
            return run('Trim clip', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const [clip] = await __clips(seq, ${clipSpec(a.clip)});
transact(project, "Trim clip", (add) => {
  ${[
        inP !== null ? `add(clip.createSetInPointAction(__t(${inP})));` : '',
        outP !== null ? `add(clip.createSetOutPointAction(__t(${outP})));` : '',
        start !== null ? `add(clip.createSetStartAction(__t(${start})));` : '',
        end !== null ? `add(clip.createSetEndAction(__t(${end})));` : '',
    ].filter(Boolean).join('\n  ')}
});
return await __clipInfo(clip);`));
        },
    },
    {
        name: 'move_clips',
        description: 'Move clips later or earlier in the sequence by a number of seconds (negative moves earlier), keeping their tracks. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                by: { type: 'number', description: 'Seconds to move by; negative moves earlier' },
            },
            required: ['clips', 'by'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 1 }], selected: true }, by: -2.5 },
        features: ['premiere.editing.move_clips', 'premiere.editing.nudge_clip'],
        handler: (a) => {
            const by = num(a.by, { min: -864000, max: 864000, name: 'by' });
            if (Number(by) === 0) throw new Error("'by' is 0: nothing to move");
            return run('Move clips', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
transact(project, "Move clips", (add) => { for (const c of clips) add(c.createMoveAction(__t(${by}))); });
const out = [];
for (const c of clips) out.push(await __clipInfo(c));
return { moved: out.length, by: ${by}, clips: out };`));
        },
    },
    {
        name: 'remove_clips',
        description: 'Remove clips from the sequence (Clear), or close the gap they leave with ripple: true (Ripple Delete). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                ripple: { type: 'boolean', description: 'Close the gap: later clips move earlier. Default false', default: false },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'audio', trackIndex: 1, clipIndex: 0 }] } },
        hints: { destructive: true },
        features: ['premiere.editing.clear', 'premiere.editing.ripple_delete'],
        handler: (a) => run('Remove clips', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const removed = [];
for (const c of clips) removed.push(await __clipInfo(c));
const selection = await __selectionOf(clips);
const editor = ppro.SequenceEditor.getEditor(seq);
transact(project, "Remove clips", (add) => add(editor.createRemoveItemsAction(selection, ${bool(a.ripple)}, __C.MediaType.ANY, false)));
return { removed: removed.length, ripple: ${bool(a.ripple)}, clips: removed };`)),
    },
    {
        name: 'set_clip_properties',
        description: 'Rename clips in the Timeline, or enable or disable them (Clip > Enable). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                name: { type: 'string', description: 'New clip name' },
                enabled: { type: 'boolean', description: 'false disables the clips (they stay in place but do not play)' },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }] }, name: 'Wide shot', enabled: false },
        hints: { idempotent: true },
        features: ['premiere.editing.enable_clip', 'premiere.editing.track_item'],
        handler: (a) => {
            if (a.name === undefined && a.enabled === undefined) throw new Error('Nothing to change: give name or enabled');
            return run('Set clip properties', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
transact(project, "Clip properties", (add) => {
  for (const c of clips) {
    ${a.name !== undefined ? `add(c.createSetNameAction(${str(a.name)}));` : ''}
    ${a.enabled !== undefined ? `add(c.createSetDisabledAction(${bool(!a.enabled)}));` : ''}
  }
});
const out = [];
for (const c of clips) out.push(await __clipInfo(c));
return { clips: out };`));
        },
    },
    {
        name: 'set_track_properties',
        description: 'Mute or unmute a track (Toggle Track Output for video), or rename it (Premiere Pro 26.3 or later). Muting is not an undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                track: { type: 'string', enum: TRACK_KINDS },
                trackIndex: { type: 'integer', minimum: 0, description: '0 = V1, A1 or C1' },
                muted: { type: 'boolean' },
                name: { type: 'string', description: 'New track name (26.3 or later)' },
            },
            required: ['track', 'trackIndex'],
        },
        auditArgs: { track: 'audio', trackIndex: 1, muted: true, name: 'Dialogue' },
        hints: { idempotent: true },
        guarded: ['createSetNameAction'],
        features: ['premiere.editing.track_mute_video', 'premiere.editing.rename_track', 'premiere.audio.audio_track', 'premiere.editing.track_object'],
        handler: (a) => {
            if (!TRACK_KINDS.includes(a.track)) throw new Error(`'track' must be ${TRACK_KINDS.join(', ')}`);
            if (a.muted === undefined && a.name === undefined) throw new Error('Nothing to change: give muted or name');
            const i = index(a.trackIndex, { name: 'trackIndex', max: 999 });
            return run('Set track properties', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const track = await __track(seq, ${json(a.track)}, ${i});
${a.name !== undefined ? `if (typeof track.createSetNameAction !== "function") throw new Error("Renaming a track needs Premiere Pro 26.3 or later");
transact(project, "Rename track", (add) => add(track.createSetNameAction(${str(a.name)})));` : ''}
${a.muted !== undefined ? `await track.setMute(${bool(a.muted)});` : ''}
return { track: ${json(a.track)}, index: ${i}, name: track.name, muted: await track.isMuted() };`));
        },
    },
    {
        name: 'insert_mogrt',
        description: 'Place a Motion Graphics template (.mogrt) in a sequence at a time on the given tracks. Its parameters can then be read and set as effect parameters (list_clip_effects, set_effect_param)',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                filePath: { type: 'string', description: 'Absolute path of the .mogrt' },
                time: { type: 'number', minimum: 0, description: 'Sequence time in seconds' },
                videoTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: '0 = V1. Default 1 (V2)', default: 1 },
                audioTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: '0 = A1. Default 0', default: 0 },
            },
            required: ['filePath', 'time'],
        },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/Lower third.mogrt`, time: 4 },
        features: ['premiere.graphics_captions.add_mogrt_to_sequence', 'premiere.graphics_captions.motion_graphics_template', 'premiere.graphics_captions.graphic_clip'],
        handler: (a) => {
            const file = checkedPath(a.filePath, 'filePath', ['.mogrt']);
            const time = seconds(a.time, 'time');
            const v = index(a.videoTrackIndex ?? 1, { name: 'videoTrackIndex', max: 99 });
            const au = index(a.audioTrackIndex ?? 0, { name: 'audioTrackIndex', max: 99 });
            return run('Insert Motion Graphics template', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const editor = ppro.SequenceEditor.getEditor(seq);
let placed;
project.lockedAccess(() => { placed = editor.insertMogrtFromPath(${str(file)}, __t(${time}), ${v}, ${au}); });
placed = await placed;
if (!placed || !placed.length) throw new Error("Premiere Pro did not place the template (check the file is a Motion Graphics template)");
const out = [];
for (const c of placed) out.push(await __clipInfo(c));
return { sequence: seq.name, placed: out };`));
        },
    },
];
