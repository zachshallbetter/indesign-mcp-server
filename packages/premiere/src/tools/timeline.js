/**
 * The Timeline: tracks and clips. List and find them, insert or overwrite
 * project items at a time, trim, slip, roll, slide, move, remove, rename and
 * enable clips, change the selection, fit clips to the frame, mute and rename
 * tracks, and place Motion Graphics templates.
 */
import { bool, json, str, index, num, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, CLIP_SCHEMA, CLIPS_SCHEMA, sequenceSpec, itemSpec, clipSpec, clipsSpec, seconds } from '../args.js';
import { checkedPath } from './project.js';

const TRACK_KINDS = ['video', 'audio', 'caption'];

/**
 * Script helpers for tools that work across a sequence's clips:
 * __walkClips lists clips with their indexes and times (optionally one
 * track), __where gives a clip's track, index and neighbours, and
 * __selectedRefs reads the Timeline selection back as list_clips indexes.
 */
export const WALK_HELPERS = String.raw`
async function __walkClips(seq, kinds, only) {
  const out = [];
  for (const kind of kinds) {
    const count = kind === "video" ? await seq.getVideoTrackCount() : await seq.getAudioTrackCount();
    for (let t = 0; t < count; t++) {
      if (only && (only.track !== kind || only.trackIndex !== t)) continue;
      const list = await __trackClips(await __track(seq, kind, t));
      for (let i = 0; i < list.length; i++) {
        out.push({ track: kind, trackIndex: t, clipIndex: i, clip: list[i], start: __s(await list[i].getStartTime()), end: __s(await list[i].getEndTime()) });
      }
    }
  }
  return out;
}

async function __where(seq, clip) {
  const kind = __isVideo(clip) ? "video" : "audio";
  const trackIndex = await clip.getTrackIndex();
  const list = await __trackClips(await __track(seq, kind, trackIndex));
  const start = __s(await clip.getStartTime());
  let at = -1;
  for (let i = 0; i < list.length && at < 0; i++) if (__s(await list[i].getStartTime()) === start) at = i;
  if (at < 0) throw new Error("Could not find " + (await clip.getName()) + " on its track");
  return { track: kind, trackIndex: trackIndex, clipIndex: at, prev: at > 0 ? list[at - 1] : null, next: at + 1 < list.length ? list[at + 1] : null };
}

async function __selectedRefs(seq) {
  const out = [];
  for (const c of await __walkClips(seq, ["video", "audio"], null)) {
    if (await c.clip.getIsSelected()) out.push({ track: c.track, trackIndex: c.trackIndex, clipIndex: c.clipIndex, name: await c.clip.getName(), start: c.start, end: c.end });
  }
  return out;
}
`;

/** A track filter literal for __walkClips: null, or { track, trackIndex }. */
export function trackFilter(a) {
    if (a.trackIndex !== undefined && a.track === undefined) throw new Error('Give track with trackIndex');
    if (a.track === undefined) return 'null';
    if (a.track !== 'video' && a.track !== 'audio') throw new Error("'track' must be video or audio");
    if (a.trackIndex === undefined) throw new Error('Give trackIndex with track');
    return json({ track: a.track, trackIndex: Number(index(a.trackIndex, { name: 'trackIndex', max: 999 })) });
}

export const TRACK_FILTER_PROPS = {
    track: { type: 'string', enum: ['video', 'audio'], description: 'Only clips on this kind of track (give with trackIndex); default every video and audio track' },
    trackIndex: { type: 'integer', minimum: 0, description: 'Only this track, 0 = V1 or A1 (with track)' },
};

/** A signed amount of time: seconds (by) or frames of the sequence, as a script expression for a TickTime. */
function deltaExpr(a, { required = true } = {}) {
    if (a.by !== undefined && a.frames !== undefined) throw new Error('Give by (seconds) or frames, not both');
    if (a.frames !== undefined) {
        const f = Number(num(a.frames, { min: -100000, max: 100000, name: 'frames' }));
        if (!Number.isInteger(f) || f === 0) throw new Error("'frames' must be a whole number other than 0");
        return `ppro.TickTime.createWithTicks(String(Number(await seq.getTimebase()) * ${f}))`;
    }
    if (a.by !== undefined) {
        const by = num(a.by, { min: -864000, max: 864000, name: 'by' });
        if (Number(by) === 0) throw new Error("'by' is 0: nothing to change");
        return `__t(${by})`;
    }
    if (required) throw new Error('Give by (seconds) or frames');
    return null;
}

const SELECT_MODES = ['clips', 'all', 'none', 'at_playhead', 'forward', 'backward', 'next', 'previous'];
const EDIT_OPERATIONS = ['slip', 'roll', 'slide', 'trim_start_to_playhead', 'trim_end_to_playhead'];

/** sourceIn and sourceOut, checked, as [in, out] number literals, or null. */
function sourceRange(a) {
    if (a.sourceIn === undefined && a.sourceOut === undefined) return null;
    if (a.sourceIn === undefined || a.sourceOut === undefined) throw new Error('Give sourceIn and sourceOut together');
    const range = [seconds(a.sourceIn, 'sourceIn'), seconds(a.sourceOut, 'sourceOut')];
    if (Number(range[1]) <= Number(range[0])) throw new Error('sourceOut must be after sourceIn');
    return range;
}

/** Insert and overwrite differ only in the action and its last argument. */
function placeTool(mode) {
    const insert = mode === 'insert';
    return {
        name: `${mode}_clip`,
        description: insert
            ? 'Insert a project item (clip or sequence) into a sequence at a time: clips after that point on the targeted tracks move later. A track index past the last track adds a track. sourceIn and sourceOut place only that range (for example words found in export_transcript, as Text-Based Editing does)'
            : 'Overwrite a sequence with a project item (clip or sequence) at a time: whatever is there on the targeted tracks is replaced. A track index past the last track adds a track. sourceIn and sourceOut place only that range (for example words found in export_transcript, as Text-Based Editing does)',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                item: ITEM_SCHEMA,
                time: { type: 'number', minimum: 0, description: 'Sequence time in seconds' },
                videoTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Video track for the video, 0 = V1. Default 0', default: 0 },
                audioTrackIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Audio track for the audio, 0 = A1. Default 0', default: 0 },
                ...(insert ? { limitShift: { type: 'boolean', description: 'Shift clips only on the targeted tracks, not on every track. Default false', default: false } } : {}),
                sourceIn: { type: 'number', minimum: 0, description: 'Place only part of the clip: set its source in point first, seconds into the media (give with sourceOut). The item keeps these in and out points, as when they are marked in the Source Monitor' },
                sourceOut: { type: 'number', minimum: 0, description: 'Source out point, seconds into the media (give with sourceIn)' },
            },
            required: ['item', 'time'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, time: 12.5, videoTrackIndex: 1, audioTrackIndex: 2, sourceIn: 3.2, sourceOut: 7.9 },
        features: [
            insert ? 'premiere.editing.insert' : 'premiere.editing.overwrite', 'premiere.editing.track_item',
            'premiere.editing.add_clips_from_transcript', 'premiere.multicam.multicam_alternate',
        ],
        handler: (a) => {
            const v = index(a.videoTrackIndex ?? 0, { name: 'videoTrackIndex', max: 99 });
            const au = index(a.audioTrackIndex ?? 0, { name: 'audioTrackIndex', max: 99 });
            const time = seconds(a.time, 'time');
            const range = sourceRange(a);
            const action = insert
                ? `editor.createInsertProjectItemAction(entry.item, __t(${time}), ${v}, ${au}, ${bool(a.limitShift)})`
                : `editor.createOverwriteItemAction(entry.item, __t(${time}), ${v}, ${au})`;
            return run(insert ? 'Insert clip' : 'Overwrite clip', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const entry = await __item(project, ${itemSpec(a.item)});
__clipItem(entry);${range ? `
transact(project, "Source in and out", (add) => add(entry.clip.createSetInOutPointsAction(__t(${range[0]}), __t(${range[1]}))));` : ''}
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
        description: 'List the clips on a sequence\'s tracks with the indexes other tools take (track, trackIndex, clipIndex), name, start and end in the sequence, source in and out points, duration, speed, enabled and selected state, and the project item each comes from. name finds clips by name',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                track: { type: 'string', enum: ['video', 'audio'], description: 'Only this kind of track' },
                trackIndex: { type: 'integer', minimum: 0, description: 'Only this track (with track)' },
                selected: { type: 'boolean', description: 'Only the clips selected in the Timeline', default: false },
                name: { type: 'string', description: 'Only clips whose name contains this text (any case), to find clips in the sequence' },
            },
        },
        auditArgs: { track: 'video', trackIndex: 1, selected: false, name: 'Interview' },
        hints: { readOnly: true },
        features: ['premiere.editing.track_item', 'premiere.audio.audio_clip', 'premiere.editing.timeline_selection', 'premiere.sequences.find_in_sequence'],
        handler: (a) => {
            if (a.trackIndex !== undefined && a.track === undefined) throw new Error('Give track with trackIndex');
            const kinds = a.track ? [a.track] : ['video', 'audio'];
            if (a.track && !['video', 'audio'].includes(a.track)) throw new Error("'track' must be video or audio");
            const only = a.trackIndex === undefined ? 'null' : index(a.trackIndex, { name: 'trackIndex', max: 999 });
            if (a.name !== undefined && (typeof a.name !== 'string' || !a.name.length)) throw new Error("'name' must be some text");
            const byName = a.name === undefined ? '' : `
      if (!String(info.name).toLowerCase().includes(${str(a.name.toLowerCase())})) continue;`;
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
      if (${bool(a.selected)} && !info.selected) continue;${byName}
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
    {
        name: 'select_clips',
        description: 'Change the Timeline selection: select given clips (Selection tool), every clip (Edit > Select All), none (Edit > Deselect All), the clips under the playhead (Select Clip at Playhead), every clip from a time on or before it (Track Select Forward and Backward tools), or the clip after or before each selected one on its track (Next and Previous in Sequence). Returns the selected clips. Not an undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                mode: { type: 'string', enum: SELECT_MODES, description: 'clips: the given clips; all; none; at_playhead; forward: clips ending after time; backward: clips starting before time; next and previous: the neighbour of each selected clip on its track' },
                clips: { ...CLIPS_SCHEMA, description: 'With mode clips: the clips to select (items from list_clips)' },
                time: { type: 'number', minimum: 0, description: 'With forward and backward: seconds. Default the playhead' },
                ...TRACK_FILTER_PROPS,
            },
            required: ['mode'],
        },
        auditArgs: { mode: 'forward', clips: undefined, time: 12, track: 'video', trackIndex: 0 },
        features: [
            'premiere.editing.selection_tool', 'premiere.editing.select_all', 'premiere.editing.deselect_all', 'premiere.editing.select_clip_at_playhead',
            'premiere.editing.track_select_forward', 'premiere.editing.track_select_backward', 'premiere.sequences.next_in_sequence',
            'premiere.sequences.previous_in_sequence', 'premiere.editing.timeline_selection',
        ],
        handler: (a) => {
            const mode = enumOf(a.mode, SELECT_MODES, { name: 'mode' });
            if (mode === 'clips' && !a.clips) throw new Error('mode clips needs clips.items');
            if (mode !== 'clips' && a.clips !== undefined) throw new Error('clips is only for mode clips');
            if (a.time !== undefined && mode !== 'forward' && mode !== 'backward') throw new Error('time is only for modes forward and backward');
            const only = trackFilter(a);
            if (only !== 'null' && ['clips', 'none', 'next', 'previous'].includes(mode)) throw new Error(`track and trackIndex do not apply to mode ${mode}`);
            const time = a.time === undefined ? '__s(await seq.getPlayerPosition())' : seconds(a.time, 'time');
            const pick = {
                clips: `const chosen = await __clips(seq, ${mode === 'clips' ? clipsSpec(a.clips) : '{}'});`,
                all: `const chosen = (await __walkClips(seq, ["video", "audio"], ${only})).map((c) => c.clip);`,
                none: 'const chosen = [];',
                at_playhead: `const at = __s(await seq.getPlayerPosition());
const chosen = (await __walkClips(seq, ["video", "audio"], ${only})).filter((c) => c.start <= at && at < c.end).map((c) => c.clip);`,
                forward: `const at = ${time};
const chosen = (await __walkClips(seq, ["video", "audio"], ${only})).filter((c) => c.end > at).map((c) => c.clip);`,
                backward: `const at = ${time};
const chosen = (await __walkClips(seq, ["video", "audio"], ${only})).filter((c) => c.start < at).map((c) => c.clip);`,
                next: 'const chosen = await neighbours(1);',
                previous: 'const chosen = await neighbours(-1);',
            }[mode];
            return run('Select clips', script(`${WALK_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
async function neighbours(step) {
  const all = await __walkClips(seq, ["video", "audio"], null);
  const picked = [];
  const tracks = new Map();
  for (const c of all) {
    if (!(await c.clip.getIsSelected())) continue;
    const key = c.track + c.trackIndex;
    const was = tracks.get(key);
    if (was === undefined || (step > 0 ? c.clipIndex > was.clipIndex : c.clipIndex < was.clipIndex)) tracks.set(key, c);
  }
  if (!tracks.size) throw new Error("Nothing is selected in the Timeline: select a clip first");
  for (const c of tracks.values()) {
    const hit = all.find((o) => o.track === c.track && o.trackIndex === c.trackIndex && o.clipIndex === c.clipIndex + step);
    if (hit) picked.push(hit.clip);
  }
  if (!picked.length) throw new Error("No clip " + (step > 0 ? "after" : "before") + " the selection on its track");
  return picked;
}
${pick}
if (!chosen.length) {
  await seq.clearSelection();
} else {
  const selection = await __selectionOf(chosen);
  if ((await seq.setSelection(selection)) === false) throw new Error("Premiere Pro did not change the selection");
}
const selected = await __selectedRefs(seq);
return { sequence: seq.name, mode: ${str(mode)}, selected: selected.length, clips: selected };`));
        },
    },
    {
        name: 'edit_clips',
        description: 'Trim edits in the Timeline, each one undo step. slip: move the source in and out points of clips by the same amount, so they show other frames in the same place (Slip tool, Slip Clip Selection). roll: move the edit point between a clip and the next clip on its track (Rolling Edit tool; on an audio clip alone this makes a J or L cut). slide: move a clip between its neighbours, which are trimmed to keep the gap closed (Slide tool). trim_start_to_playhead and trim_end_to_playhead: trim clips under the playhead to it without rippling (Trim Previous and Trim Next Edit to Playhead)',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                operation: { type: 'string', enum: EDIT_OPERATIONS },
                clips: { ...CLIPS_SCHEMA, description: 'Clips (items from list_clips, or selected: true). roll and slide take one clip. The trims default to every clip under the playhead' },
                by: { type: 'number', description: 'slip, roll and slide: seconds; negative is earlier (slip: shows earlier frames)' },
                frames: { type: 'integer', description: 'Instead of by: frames of the sequence (Slip Clip Selection uses 1 or 5)' },
            },
            required: ['operation'],
        },
        auditArgs: { operation: 'roll', clips: { items: [{ track: 'audio', trackIndex: 0, clipIndex: 1 }] }, by: -0.5, frames: undefined },
        features: [
            'premiere.editing.slip_edit', 'premiere.editing.slip_clip_selection', 'premiere.editing.rolling_edit', 'premiere.editing.slide_edit',
            'premiere.editing.j_l_cuts', 'premiere.editing.trim_previous', 'premiere.editing.trim_next',
        ],
        handler: (a) => {
            const op = enumOf(a.operation, EDIT_OPERATIONS, { name: 'operation' });
            const trim = op.startsWith('trim_');
            if (trim && (a.by !== undefined || a.frames !== undefined)) throw new Error(`${op} trims to the playhead: by and frames do not apply`);
            if (!trim && !a.clips) throw new Error(`${op} needs clips`);
            const delta = trim ? null : deltaExpr(a);
            const choose = a.clips
                ? `const clips = await __clips(seq, ${clipsSpec(a.clips)});`
                : `const clips = (await __walkClips(seq, ["video", "audio"], null)).filter((c) => c.start < ph && ph < c.end).map((c) => c.clip);
if (!clips.length) throw new Error("No clip is under the playhead");`;
            const body = {
                slip: `const plan = [];
for (const clip of clips) {
  const inP = (await clip.getInPoint()).add(d), outP = (await clip.getOutPoint()).add(d);
  if (inP.seconds < 0) throw new Error((await clip.getName()) + " has no media that early: slip it by less");
  plan.push({ clip: clip, inP: inP, outP: outP });
}
transact(project, "Slip", (add) => {
  for (const p of plan) { add(p.clip.createSetInPointAction(p.inP)); add(p.clip.createSetOutPointAction(p.outP)); }
});
const changed = plan.map((p) => p.clip);`,
                roll: `if (clips.length !== 1) throw new Error("roll takes one clip: the clip before the edit point");
const out = clips[0];
const where = await __where(seq, out);
const inc = where.next;
if (!inc || Math.abs(__s(await inc.getStartTime()) - __s(await out.getEndTime())) > 0.0005) throw new Error("No clip starts where " + (await out.getName()) + " ends: a roll needs two adjacent clips");
const outEnd = (await out.getEndTime()).add(d), outOut = (await out.getOutPoint()).add(d);
const incStart = (await inc.getStartTime()).add(d), incIn = (await inc.getInPoint()).add(d);
if (outEnd.seconds <= __s(await out.getStartTime())) throw new Error("That would leave nothing of " + (await out.getName()));
if (incStart.seconds >= __s(await inc.getEndTime())) throw new Error("That would leave nothing of " + (await inc.getName()));
if (incIn.seconds < 0) throw new Error((await inc.getName()) + " has no media that early");
const later = d.seconds > 0;
transact(project, "Rolling edit", (add) => {
  const first = () => { add(out.createSetEndAction(outEnd)); add(out.createSetOutPointAction(outOut)); };
  const second = () => { add(inc.createSetStartAction(incStart)); add(inc.createSetInPointAction(incIn)); };
  if (later) { second(); first(); } else { first(); second(); }
});
const changed = [out, inc];`,
                slide: `if (clips.length !== 1) throw new Error("slide takes one clip");
const mid = clips[0];
const where = await __where(seq, mid);
const prev = where.prev, next = where.next;
const midStart = __s(await mid.getStartTime()), midEnd = __s(await mid.getEndTime());
if (!prev || Math.abs(__s(await prev.getEndTime()) - midStart) > 0.0005) throw new Error("No clip ends where " + (await mid.getName()) + " starts: a slide needs neighbours on both sides");
if (!next || Math.abs(__s(await next.getStartTime()) - midEnd) > 0.0005) throw new Error("No clip starts where " + (await mid.getName()) + " ends: a slide needs neighbours on both sides");
const prevEnd = (await prev.getEndTime()).add(d), prevOut = (await prev.getOutPoint()).add(d);
const nextStart = (await next.getStartTime()).add(d), nextIn = (await next.getInPoint()).add(d);
if (prevEnd.seconds <= __s(await prev.getStartTime())) throw new Error("That would leave nothing of " + (await prev.getName()));
if (nextStart.seconds >= __s(await next.getEndTime())) throw new Error("That would leave nothing of " + (await next.getName()));
if (nextIn.seconds < 0) throw new Error((await next.getName()) + " has no media that early");
const later = d.seconds > 0;
transact(project, "Slide", (add) => {
  const shrink = later
    ? () => { add(next.createSetStartAction(nextStart)); add(next.createSetInPointAction(nextIn)); }
    : () => { add(prev.createSetEndAction(prevEnd)); add(prev.createSetOutPointAction(prevOut)); };
  const grow = later
    ? () => { add(prev.createSetEndAction(prevEnd)); add(prev.createSetOutPointAction(prevOut)); }
    : () => { add(next.createSetStartAction(nextStart)); add(next.createSetInPointAction(nextIn)); };
  shrink();
  add(mid.createMoveAction(d));
  grow();
});
const changed = [prev, mid, next];`,
                trim_start_to_playhead: `const plan = [];
for (const clip of clips) {
  const start = await clip.getStartTime();
  if (!(start.seconds < ph && ph < __s(await clip.getEndTime()))) throw new Error((await clip.getName()) + " is not under the playhead");
  plan.push({ clip: clip, inP: (await clip.getInPoint()).add(head.subtract(start)) });
}
transact(project, "Trim Previous Edit to Playhead", (add) => {
  for (const p of plan) { add(p.clip.createSetStartAction(head)); add(p.clip.createSetInPointAction(p.inP)); }
});
const changed = plan.map((p) => p.clip);`,
                trim_end_to_playhead: `const plan = [];
for (const clip of clips) {
  const end = await clip.getEndTime();
  if (!(__s(await clip.getStartTime()) < ph && ph < end.seconds)) throw new Error((await clip.getName()) + " is not under the playhead");
  plan.push({ clip: clip, outP: (await clip.getOutPoint()).subtract(end.subtract(head)) });
}
transact(project, "Trim Next Edit to Playhead", (add) => {
  for (const p of plan) { add(p.clip.createSetEndAction(head)); add(p.clip.createSetOutPointAction(p.outP)); }
});
const changed = plan.map((p) => p.clip);`,
            }[op];
            return run('Edit clips', script(`${WALK_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
${trim ? 'const head = await seq.getPlayerPosition();\nconst ph = __s(head);' : `const d = ${delta};`}
${choose}
${body}
const result = [];
for (const c of changed) {
  const where = await __where(seq, c);
  result.push({ track: where.track, trackIndex: where.trackIndex, clipIndex: where.clipIndex, ...(await __clipInfo(c)) });
}
return { operation: ${str(op)}, clips: result };`));
        },
    },
    {
        name: 'fit_clips_to_frame',
        description: 'Scale video clips so their frame fits the sequence frame (Clip > Video Options > Set to Frame Size), or fills it, by setting Motion > Scale without resampling. The source frame size comes from the project item\'s Video Info, or from sourceWidth and sourceHeight. Square pixels are assumed. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                mode: { type: 'string', enum: ['fit', 'fill'], description: 'fit: the whole frame shows (Set to Frame Size); fill: the sequence frame is covered, cropping the rest. Default fit', default: 'fit' },
                sourceWidth: { type: 'integer', minimum: 1, maximum: 65536, description: 'Source frame width in pixels, when the Video Info is missing (give with sourceHeight)' },
                sourceHeight: { type: 'integer', minimum: 1, maximum: 65536, description: 'Source frame height in pixels (give with sourceWidth)' },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 1, clipIndex: 0 }] }, mode: 'fill' },
        hints: { idempotent: true },
        features: ['premiere.editing.set_to_frame_size'],
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'fit', ['fit', 'fill'], { name: 'mode' });
            if ((a.sourceWidth === undefined) !== (a.sourceHeight === undefined)) throw new Error('Give sourceWidth and sourceHeight together');
            const given = a.sourceWidth === undefined ? 'null'
                : json({ width: Number(index(a.sourceWidth, { name: 'sourceWidth', max: 65536 })), height: Number(index(a.sourceHeight, { name: 'sourceHeight', max: 65536 })) });
            if (given !== 'null' && (JSON.parse(given).width < 1 || JSON.parse(given).height < 1)) throw new Error('sourceWidth and sourceHeight must be at least 1');
            return run('Fit clips to frame', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const frame = await seq.getFrameSize();
const given = ${given};
const plan = [];
for (const clip of clips) {
  const name = await clip.getName();
  if (!__isVideo(clip)) throw new Error(name + " is an audio clip");
  let size = given;
  if (!size) {
    const item = await clip.getProjectItem();
    const xml = item ? String(await ppro.Metadata.getProjectMetadata(item)) : "";
    const info = xml.split("VideoInfo>")[1];
    const dims = info ? info.split("<")[0].split("x").map((v) => parseInt(v, 10)) : [];
    if (dims.length < 2 || !(dims[0] > 0) || !(dims[1] > 0)) throw new Error("The frame size of " + name + " is not in its project metadata: pass sourceWidth and sourceHeight");
    size = { width: dims[0], height: dims[1] };
  }
  const chain = await __chain(clip);
  let motion = null;
  for (let i = 0; i < chain.getComponentCount() && !motion; i++) {
    const c = chain.getComponentAtIndex(i);
    if (String(await c.getMatchName()).includes("Motion")) motion = c;
  }
  if (!motion) throw new Error(name + " has no Motion effect");
  const param = __param(motion, { param: "Scale" });
  if (param.isTimeVarying()) throw new Error("Scale is animated on " + name + ": remove its keyframes first (remove_keyframes)");
  const ratios = [frame.width / size.width, frame.height / size.height];
  const scale = Math.round(100 * (${mode === 'fit' ? 'Math.min' : 'Math.max'})(ratios[0], ratios[1]) * 1000) / 1000;
  plan.push({ clip: clip, name: name, param: param, scale: scale, source: size });
}
transact(project, "Set to Frame Size", (add) => {
  for (const p of plan) add(p.param.createSetValueAction(p.param.createKeyframe(p.scale), true));
});
return { mode: ${str(mode)}, frame: { width: frame.width, height: frame.height }, clips: plan.map((p) => ({ clip: p.name, source: p.source, scale: p.scale })) };`));
        },
    },
];
