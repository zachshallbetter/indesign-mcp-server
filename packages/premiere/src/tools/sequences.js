/**
 * Sequences: list, create (from a preset or from clips), open, close, read and
 * change settings, duplicate, make subsequences, delete, set in/out, zero
 * point, work area and playhead, move the playhead to frames, edits, gaps,
 * markers and in/out, scene edit detection, custom properties, and where
 * preview files go.
 */
import { bool, json, str, enumOf, num, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, CLIPS_SCHEMA, sequenceSpec, itemSpec, itemSpecs, clipsSpec, seconds } from '../args.js';
import { checkedPath } from './project.js';
import { WALK_HELPERS, TRACK_FILTER_PROPS, trackFilter } from './timeline.js';

const FIELD_TYPES = ['PROGRESSIVE', 'UPPER_FIRST', 'LOWER_FIRST'];
const VIDEO_DISPLAY = ['FPS_23_976', 'FPS_25', 'FPS_29_97', 'FPS_29_97_NON_DROP', 'FRAMES'];
const AUDIO_DISPLAY = ['SAMPLE_RATE', 'MILLISECONDS'];
const PLAYHEAD_TARGETS = ['next_frame', 'previous_frame', 'next_edit', 'previous_edit', 'next_gap', 'previous_gap', 'next_marker', 'previous_marker', 'in', 'out'];
const SCENE_OPERATIONS = { cut: 'APPLYCUT', marker: 'CREATEMARKER', subclip: 'CREATESUBCLIP' };
const PROPERTY_NAME = /^[\w .:/-]{1,200}$/;

export const tools = [
    {
        name: 'list_sequences',
        description: 'List the project\'s sequences: name, guid, whether active, frame size, timebase, end time, in/out and zero points, playhead and track counts',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['premiere.sequences.sequence_object'],
        handler: () => run('List sequences', script(`
const project = await __project();
const out = [];
for (const seq of await project.getSequences()) out.push(await __sequenceInfo(project, seq));
return { count: out.length, sequences: out };`)),
    },
    {
        name: 'create_sequence',
        description: 'Create a sequence: empty with the default settings, from a sequence preset (.sqpreset), or from clips (New Sequence From Clip: settings match the first clip and the clips are placed in order). Opens it in the Timeline unless open is false',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Sequence name' },
                preset: { type: 'string', description: 'Absolute path of a .sqpreset file' },
                items: { type: 'array', items: ITEM_SCHEMA, minItems: 1, maxItems: 500, description: 'Clips to build the sequence from, in order' },
                bin: { ...ITEM_SCHEMA, description: 'With items: put the new sequence in this bin' },
                open: { type: 'boolean', description: 'Open it in the Timeline and make it active. Default true', default: true },
            },
            required: ['name'],
        },
        auditArgs: { preset: undefined, items: [{ path: 'Footage/a.mov' }, { id: '000f4241' }], bin: { path: 'Sequences' } },
        guarded: ['createSequenceWithPresetPath'],
        features: ['premiere.sequences.new_sequence', 'premiere.sequences.new_sequence_from_clip', 'premiere.sequences.sequence_presets'],
        handler: (a) => {
            if (typeof a.name !== 'string' || !a.name.trim()) throw new Error("'name' is empty");
            if (a.preset !== undefined && a.items !== undefined) throw new Error('Give preset or items, not both: a sequence from clips takes its settings from the first clip');
            const preset = a.preset === undefined ? null : checkedPath(a.preset, 'preset', ['.sqpreset']);
            let make;
            if (a.items !== undefined) {
                if (!Array.isArray(a.items) || !a.items.length) throw new Error("'items' must list at least one clip");
                make = `const clips = [];
for (const spec of ${itemSpecs(a.items)}) clips.push(__clipItem(await __item(project, spec)));
const bin = ${a.bin ? `(await __bin(project, ${itemSpec(a.bin, 'bin')})).item` : 'undefined'};
const seq = await project.createSequenceFromMedia(name, clips, bin);`;
            } else if (preset) {
                make = `const seq = typeof project.createSequenceWithPresetPath === "function"
  ? await project.createSequenceWithPresetPath(name, ${str(preset)})
  : await project.createSequence(name, ${str(preset)});`;
            } else {
                make = 'const seq = await project.createSequence(name);';
            }
            return run('Create sequence', script(`
const project = await __project();
const name = ${str(a.name)};
${make}
if (!seq) throw new Error("Premiere Pro did not create the sequence");
${a.open === false ? '' : 'await project.openSequence(seq);\nawait project.setActiveSequence(seq);'}
return await __sequenceInfo(project, seq);`));
        },
    },
    {
        name: 'open_sequence',
        description: 'Open a sequence in the Timeline and make it the active sequence',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA }, required: ['sequence'] },
        auditArgs: { sequence: { name: 'Main edit' } },
        hints: { idempotent: true },
        features: ['premiere.sequences.open_sequence', 'premiere.ui.timeline_panel'],
        handler: (a) => run('Open sequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
await project.openSequence(seq);
if (!(await project.setActiveSequence(seq))) throw new Error("Premiere Pro did not activate " + seq.name);
return await __sequenceInfo(project, seq);`)),
    },
    {
        name: 'get_sequence_settings',
        description: 'Read a sequence\'s settings (Sequence > Sequence Settings): editing mode, timebase and frame rate, frame size, pixel aspect ratio, fields, display formats, audio sample rate and channels, preview file format, codec and size, maximum bit depth and render quality, and linear-colour compositing',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA } },
        hints: { readOnly: true },
        guarded: ['getVideoFrameRate'],
        features: [
            'premiere.sequences.sequence_settings', 'premiere.sequences.editing_mode', 'premiere.sequences.timebase', 'premiere.sequences.frame_size',
            'premiere.sequences.sequence_pixel_aspect', 'premiere.sequences.fields', 'premiere.sequences.video_display_format',
            'premiere.sequences.audio_sample_rate', 'premiere.sequences.audio_channel_format', 'premiere.sequences.audio_display_format',
            'premiere.sequences.preview_file_format', 'premiere.sequences.preview_size', 'premiere.sequences.maximum_bit_depth',
            'premiere.sequences.maximum_render_quality', 'premiere.sequences.composite_linear_color',
            'premiere.media_import.audio_sample_rates', 'premiere.projects.timecode_display',
        ],
        handler: (a) => run('Sequence settings', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const st = await seq.getSettings();
const out = { sequence: seq.name, timebase: await seq.getTimebase() };
const read = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = null; } };
const name = (group, value) => { for (const k of Object.keys(group)) if (group[k] === value) return k; return value; };
const rect = (r) => (r ? { width: r.width, height: r.height } : null);
await read("editingMode", () => st.getEditingMode());
await read("frameRate", () => (typeof st.getVideoFrameRate === "function" ? st.getVideoFrameRate().value : null));
await read("frameSize", async () => rect(await st.getVideoFrameRect()));
await read("pixelAspectRatio", () => st.getVideoPixelAspectRatio());
await read("fieldType", async () => name(__C.VideoFieldType, await st.getVideoFieldType()));
await read("videoDisplayFormat", async () => name(__C.VideoDisplayFormatType, (await st.getVideoDisplayFormat()).type));
await read("audioSampleRate", async () => (await st.getAudioSampleRate()).value);
await read("audioChannelType", async () => name(__C.AudioChannelType, await st.getAudioChannelType()));
await read("audioChannelCount", () => st.getAudioChannelCount());
await read("audioDisplayFormat", async () => name(__C.AudioDisplayFormatType, (await st.getAudioDisplayFormat()).type));
await read("previewFileFormat", () => st.getPreviewFileFormat());
await read("previewCodec", () => st.getPreviewCodec());
await read("previewFrameSize", async () => rect(await st.getPreviewFrameRect()));
await read("maximumBitDepth", () => st.getMaximumBitDepth());
await read("maximumRenderQuality", () => st.getMaxRenderQuality());
await read("compositeInLinearColor", () => st.getCompositeInLinearColor());
return out;`)),
    },
    {
        name: 'set_sequence_settings',
        description: 'Change a sequence\'s settings: frame size, frame rate (Premiere Pro 26.2 or later), pixel aspect ratio, fields, editing mode, display formats, audio sample rate, preview file format, codec and size, maximum bit depth and render quality, linear-colour compositing. Values as get_sequence_settings reports them. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                width: { type: 'integer', minimum: 16, maximum: 16384, description: 'Frame width in pixels (give with height)' },
                height: { type: 'integer', minimum: 16, maximum: 16384, description: 'Frame height in pixels (give with width)' },
                frameRate: { type: 'number', minimum: 1, maximum: 1000, description: 'Frames per second, e.g. 23.976, 25, 29.97 (26.2 or later)' },
                pixelAspectRatio: { type: 'string', description: 'As get_sequence_settings reports it' },
                fieldType: { type: 'string', enum: FIELD_TYPES },
                editingMode: { type: 'string', description: 'As get_sequence_settings reports it' },
                videoDisplayFormat: { type: 'string', enum: VIDEO_DISPLAY },
                audioDisplayFormat: { type: 'string', enum: AUDIO_DISPLAY },
                audioSampleRate: { type: 'integer', minimum: 8000, maximum: 192000, description: 'Samples per second, e.g. 48000' },
                previewFileFormat: { type: 'string', description: 'As get_sequence_settings reports it' },
                previewCodec: { type: 'string', description: 'As get_sequence_settings reports it' },
                previewWidth: { type: 'integer', minimum: 16, maximum: 16384 },
                previewHeight: { type: 'integer', minimum: 16, maximum: 16384 },
                maximumBitDepth: { type: 'boolean' },
                maximumRenderQuality: { type: 'boolean' },
                compositeInLinearColor: { type: 'boolean' },
            },
        },
        auditArgs: { width: 1920, height: 1080, previewWidth: 960, previewHeight: 540, frameRate: 25, pixelAspectRatio: '1.0', editingMode: 'Custom', previewFileFormat: 'I-Frame Only MPEG', previewCodec: 'MPEG I-Frame', audioSampleRate: 48000 },
        hints: { idempotent: true },
        guarded: ['setVideoFrameRate'],
        features: [
            'premiere.sequences.sequence_settings', 'premiere.sequences.frame_size', 'premiere.sequences.timebase', 'premiere.sequences.sequence_pixel_aspect',
            'premiere.sequences.fields', 'premiere.sequences.editing_mode', 'premiere.sequences.video_display_format', 'premiere.sequences.audio_display_format',
            'premiere.sequences.audio_sample_rate', 'premiere.sequences.preview_file_format', 'premiere.sequences.preview_size',
            'premiere.sequences.maximum_bit_depth', 'premiere.sequences.maximum_render_quality', 'premiere.sequences.composite_linear_color',
            'premiere.sequences.aspect_ratio_sequence',
            'premiere.media_import.audio_sample_rates', 'premiere.projects.timecode_display',
        ],
        handler: (a) => {
            if ((a.width === undefined) !== (a.height === undefined)) throw new Error('Give width and height together');
            if ((a.previewWidth === undefined) !== (a.previewHeight === undefined)) throw new Error('Give previewWidth and previewHeight together');
            const lines = [];
            const size = (v, n) => index(v, { name: n, max: 16384 });
            if (a.width !== undefined) lines.push(`{ const r = await st.getVideoFrameRect(); r.width = ${size(a.width, 'width')}; r.height = ${size(a.height, 'height')}; await st.setVideoFrameRect(r); changed.push("frameSize"); }`);
            if (a.previewWidth !== undefined) lines.push(`{ const r = await st.getPreviewFrameRect(); r.width = ${size(a.previewWidth, 'previewWidth')}; r.height = ${size(a.previewHeight, 'previewHeight')}; await st.setPreviewFrameRect(r); changed.push("previewFrameSize"); }`);
            if (a.frameRate !== undefined) lines.push(`if (typeof st.setVideoFrameRate !== "function") throw new Error("Changing the frame rate needs Premiere Pro 26.2 or later");
st.setVideoFrameRate(ppro.FrameRate.createWithValue(${num(a.frameRate, { min: 1, max: 1000, name: 'frameRate' })})); changed.push("frameRate");`);
            if (a.pixelAspectRatio !== undefined) lines.push(`await st.setVideoPixelAspectRatio(${str(a.pixelAspectRatio)}); changed.push("pixelAspectRatio");`);
            if (a.fieldType !== undefined) lines.push(`await st.setVideoFieldType(__C.VideoFieldType.${enumOf(a.fieldType, FIELD_TYPES, { name: 'fieldType' })}); changed.push("fieldType");`);
            if (a.editingMode !== undefined) lines.push(`await st.setEditingMode(${str(a.editingMode)}); changed.push("editingMode");`);
            if (a.videoDisplayFormat !== undefined) lines.push(`{ const d = await st.getVideoDisplayFormat(); d.type = __C.VideoDisplayFormatType.${enumOf(a.videoDisplayFormat, VIDEO_DISPLAY, { name: 'videoDisplayFormat' })}; await st.setVideoDisplayFormat(d); changed.push("videoDisplayFormat"); }`);
            if (a.audioDisplayFormat !== undefined) lines.push(`{ const d = await st.getAudioDisplayFormat(); d.type = __C.AudioDisplayFormatType.${enumOf(a.audioDisplayFormat, AUDIO_DISPLAY, { name: 'audioDisplayFormat' })}; await st.setAudioDisplayFormat(d); changed.push("audioDisplayFormat"); }`);
            if (a.audioSampleRate !== undefined) lines.push(`await st.setAudioSampleRate(ppro.FrameRate.createWithValue(${index(a.audioSampleRate, { name: 'audioSampleRate', max: 192000 })})); changed.push("audioSampleRate");`);
            if (a.previewFileFormat !== undefined) lines.push(`await st.setPreviewFileFormat(${str(a.previewFileFormat)}); changed.push("previewFileFormat");`);
            if (a.previewCodec !== undefined) lines.push(`await st.setPreviewCodec(${str(a.previewCodec)}); changed.push("previewCodec");`);
            if (a.maximumBitDepth !== undefined) lines.push(`await st.setMaximumBitDepth(${bool(a.maximumBitDepth)}); changed.push("maximumBitDepth");`);
            if (a.maximumRenderQuality !== undefined) lines.push(`await st.setMaxRenderQuality(${bool(a.maximumRenderQuality)}); changed.push("maximumRenderQuality");`);
            if (a.compositeInLinearColor !== undefined) lines.push(`await st.setCompositeInLinearColor(${bool(a.compositeInLinearColor)}); changed.push("compositeInLinearColor");`);
            if (!lines.length) throw new Error('Nothing to change: give at least one setting');
            return run('Set sequence settings', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const st = await seq.getSettings();
const changed = [];
${lines.join('\n')}
transact(project, "Sequence settings", (add) => add(seq.createSetSettingsAction(st)));
return { sequence: seq.name, changed: changed };`));
        },
    },
    {
        name: 'duplicate_sequence',
        description: 'Duplicate a sequence (Sequence > Duplicate). The copy appears next to the original',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA } },
        features: ['premiere.sequences.duplicate_sequence'],
        handler: (a) => run('Duplicate sequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const before = new Set((await project.getSequences()).map((s) => __id(s.guid)));
transact(project, "Duplicate sequence", (add) => add(seq.createCloneAction()));
const made = (await project.getSequences()).filter((s) => !before.has(__id(s.guid)));
return { original: seq.name, copies: made.map((s) => ({ name: s.name, guid: __id(s.guid) })) };`)),
    },
    {
        name: 'delete_sequence',
        description: 'Delete a sequence from the project',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA }, required: ['sequence'] },
        auditArgs: { sequence: { guid: 'b6b3d1a2-0000-4000-8000-000000000000' } },
        hints: { destructive: true },
        features: ['premiere.sequences.delete_sequence'],
        handler: (a) => {
            if (!a.sequence || (a.sequence.name === undefined && a.sequence.guid === undefined)) throw new Error('Name the sequence to delete: sequence.name or sequence.guid');
            return run('Delete sequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const name = seq.name, guid = __id(seq.guid);
if (!(await project.deleteSequence(seq))) throw new Error("Premiere Pro did not delete " + name);
return { deleted: name, guid: guid };`));
        },
    },
    {
        name: 'set_sequence_times',
        description: 'Set a sequence\'s in and out points, zero point (start time), work area (Premiere Pro 26.5 or later) and playhead position. Times are seconds. In, out and zero point are one undo step; the playhead and work area are not undoable',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                inPoint: { type: 'number', minimum: 0, description: 'Sequence in point, seconds' },
                outPoint: { type: 'number', minimum: 0, description: 'Sequence out point, seconds' },
                zeroPoint: { type: 'number', minimum: 0, description: 'Start time of the timecode, seconds' },
                workAreaIn: { type: 'number', minimum: 0, description: 'Work area in, seconds (26.5 or later)' },
                workAreaOut: { type: 'number', minimum: 0, description: 'Work area out, seconds (26.5 or later)' },
                playhead: { type: 'number', minimum: 0, description: 'Move the playhead here, seconds' },
            },
        },
        auditArgs: { inPoint: 1, outPoint: 9, zeroPoint: 3600, workAreaIn: 0, workAreaOut: 30, playhead: 5 },
        hints: { idempotent: true },
        guarded: ['WorkAreaUtils', 'setWorkAreaInOutPoints'],
        features: ['premiere.sequences.sequence_in_out', 'premiere.markers.mark_in', 'premiere.markers.mark_out', 'premiere.sequences.zero_point', 'premiere.sequences.work_area_bar', 'premiere.sequences.set_work_area_in', 'premiere.sequences.set_work_area_out', 'premiere.sequences.playhead', 'premiere.ui.program_monitor'],
        handler: (a) => {
            const t = (k) => (a[k] === undefined ? null : seconds(a[k], k));
            const [inP, outP, zero, wIn, wOut, head] = ['inPoint', 'outPoint', 'zeroPoint', 'workAreaIn', 'workAreaOut', 'playhead'].map(t);
            if (inP !== null && outP !== null && Number(outP) <= Number(inP)) throw new Error('outPoint must be after inPoint');
            if ((wIn === null) !== (wOut === null)) throw new Error('Give workAreaIn and workAreaOut together');
            if (wIn !== null && Number(wOut) <= Number(wIn)) throw new Error('workAreaOut must be after workAreaIn');
            if ([inP, outP, zero, wIn, head].every((v) => v === null)) throw new Error('Nothing to set: give inPoint, outPoint, zeroPoint, workAreaIn/Out or playhead');
            const actions = [
                inP !== null ? `add(seq.createSetInPointAction(__t(${inP})));` : '',
                outP !== null ? `add(seq.createSetOutPointAction(__t(${outP})));` : '',
                zero !== null ? `add(seq.createSetZeroPointAction(__t(${zero})));` : '',
            ].filter(Boolean);
            return run('Set sequence times', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
${actions.length ? `transact(project, "Sequence times", (add) => {\n  ${actions.join('\n  ')}\n});` : ''}
${wIn !== null ? `if (typeof ppro.WorkAreaUtils === "undefined") throw new Error("Setting the work area needs Premiere Pro 26.5 or later");
if (!ppro.WorkAreaUtils.setWorkAreaInOutPoints(seq, __t(${wIn}), __t(${wOut}))) throw new Error("Premiere Pro did not set the work area");` : ''}
${head !== null ? `if (!(await seq.setPlayerPosition(__t(${head})))) throw new Error("Premiere Pro did not move the playhead");` : ''}
return await __sequenceInfo(project, seq);`));
        },
    },
    {
        name: 'close_sequence',
        description: 'Close a sequence\'s Timeline panel (Premiere Pro 26.2 or later). The sequence stays in the project',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA } },
        auditArgs: { sequence: { name: 'Main edit' } },
        hints: { idempotent: true },
        since: '26.2',
        features: ['premiere.sequences.close_sequence'],
        handler: (a) => run('Close sequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
if (!(await project.closeSequence(seq))) throw new Error("Premiere Pro did not close " + seq.name);
return { closed: seq.name, guid: __id(seq.guid) };`), { since: '26.2' }),
    },
    {
        name: 'create_subsequence',
        description: 'Make a new sequence from the part of a sequence between its in and out points (Sequence > Make Subsequence), on the targeted tracks or on every track. Set the in and out points first (set_sequence_times or mark_clips)',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                allTracks: { type: 'boolean', description: 'Take every track, ignoring track targeting. Default false', default: false },
                open: { type: 'boolean', description: 'Open the new sequence in the Timeline. Default false', default: false },
            },
        },
        auditArgs: { allTracks: true, open: true },
        features: ['premiere.sequences.make_subsequence'],
        handler: (a) => run('Make subsequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const sub = await seq.createSubsequence(${bool(a.allTracks)});
if (!sub) throw new Error("Premiere Pro did not make a subsequence (check the in and out points of " + seq.name + ")");
${a.open ? 'await project.openSequence(sub);\nawait project.setActiveSequence(sub);' : ''}
return { from: seq.name, inPoint: __s(await seq.getInPoint()), outPoint: __s(await seq.getOutPoint()), sequence: await __sequenceInfo(project, sub) };`)),
    },
    {
        name: 'move_playhead',
        description: 'Move a sequence\'s playhead: by frames (Step Forward, Step Back), to the next or previous edit point (Go to Next/Previous Edit Point), gap (Sequence > Go To Gap) or marker (Markers > Go to Next/Previous Marker), or to the in or out point (Markers > Go to In, Go to Out). Edits and gaps are on every video and audio track unless track is given. Not an undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                to: { type: 'string', enum: PLAYHEAD_TARGETS },
                frames: { type: 'integer', minimum: 1, maximum: 100000, description: 'With next_frame and previous_frame: how many frames. Default 1 (Shift steps 5)', default: 1 },
                ...TRACK_FILTER_PROPS,
            },
            required: ['to'],
        },
        auditArgs: { to: 'next_gap', frames: undefined, track: 'video', trackIndex: 0 },
        features: [
            'premiere.editing.step_frame', 'premiere.editing.go_to_edit_point', 'premiere.sequences.go_to_gap', 'premiere.markers.go_to_next_marker',
            'premiere.markers.go_to_previous_marker', 'premiere.markers.go_to_in', 'premiere.markers.go_to_out', 'premiere.sequences.playhead',
        ],
        handler: (a) => {
            const to = enumOf(a.to, PLAYHEAD_TARGETS, { name: 'to' });
            const framed = to.endsWith('_frame');
            if (a.frames !== undefined && !framed) throw new Error('frames is only for next_frame and previous_frame');
            const only = trackFilter(a);
            if (only !== 'null' && !/_(edit|gap)$/.test(to)) throw new Error('track and trackIndex are only for edits and gaps');
            const frames = framed ? Number(num(a.frames ?? 1, { min: 1, max: 100000, name: 'frames' })) : 0;
            if (framed && !Number.isInteger(frames)) throw new Error("'frames' must be a whole number");
            const next = to.startsWith('next');
            const find = {
                frame: `const tb = Number(await seq.getTimebase());
const target = ppro.TickTime.createWithTicks(String(Math.max(0, head.ticksNumber ${next ? '+' : '-'} ${frames} * tb)));`,
                edit: `const times = [];
for (const c of await __walkClips(seq, ["video", "audio"], ${only})) times.push(await c.clip.getStartTime(), await c.clip.getEndTime());
const target = pickTime(times, "edit point");`,
                gap: `const spans = (await __walkClips(seq, ["video", "audio"], ${only})).map((c) => [c.start, c.end, c.clip]).sort((x, y) => x[0] - y[0]);
const gaps = [];
let reach = 0, last = null;
for (const [start, end, clip] of spans) {
  if (start > reach + 0.0005) gaps.push(last ? await last.getEndTime() : __t(0));
  if (end > reach) { reach = end; last = clip; }
}
const target = pickTime(gaps, "gap");`,
                marker: `const markers = await ppro.Markers.getMarkers(seq);
const list = markers ? markers.getMarkers() || [] : [];
const target = pickTime(list.map((m) => m.getStart()), "marker");
const hit = list.find((m) => __s(m.getStart()) === __s(target));
extra.marker = hit ? { name: hit.getName(), type: hit.getType(), comments: hit.getComments() } : null;`,
                in: 'const target = await seq.getInPoint();',
                out: 'const target = await seq.getOutPoint();',
            }[to.replace(/^(next|previous)_/, '')];
            return run('Move playhead', script(`${WALK_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const head = await seq.getPlayerPosition();
const from = __s(head);
const extra = {};
const pickTime = (times, what) => {
  const hits = times.filter((t) => (${next ? '__s(t) > from + 0.000001' : '__s(t) < from - 0.000001'}));
  if (!hits.length) throw new Error("No " + what + " ${next ? 'after' : 'before'} the playhead (" + from + " s)");
  return hits.reduce((best, t) => (${next ? '__s(t) < __s(best)' : '__s(t) > __s(best)'} ? t : best));
};
${find}
if (!(await seq.setPlayerPosition(target))) throw new Error("Premiere Pro did not move the playhead");
return { sequence: seq.name, to: ${str(to)}, from: from, playhead: __s(await seq.getPlayerPosition()), ...extra };`));
        },
    },
    {
        name: 'run_scene_edit_detection',
        description: 'Analyse clips for cuts in their footage (Clip > Scene Edit Detection, without the dialog) and add an edit, a clip marker or a subclip at each cut. Runs on the given clips or the Timeline selection; the selection is replaced by those clips. Analysis can continue after the call returns: waitSeconds waits for it',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: { ...CLIPS_SCHEMA, description: 'The clips to analyse (items from list_clips, or selected: true)' },
                operation: { type: 'string', enum: Object.keys(SCENE_OPERATIONS), description: 'cut: Apply a cut at each scene edit; marker: Generate clip markers; subclip: Create subclips in the project. Default cut', default: 'cut' },
                waitSeconds: { type: 'number', minimum: 0, maximum: 3600, description: 'Wait up to this long for the analysis to finish. Default 0. Raise PREMIERE_SCRIPT_TIMEOUT_MS for long waits', default: 0 },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { selected: true }, operation: 'marker', waitSeconds: 30 },
        features: ['premiere.sequences.scene_edit_detection', 'premiere.ai_features.scene_edit_detection_ai'],
        handler: (a) => {
            const operation = SCENE_OPERATIONS[enumOf(a.operation ?? 'cut', Object.keys(SCENE_OPERATIONS), { name: 'operation' })];
            const wait = num(a.waitSeconds ?? 0, { min: 0, max: 3600, name: 'waitSeconds' });
            return run('Scene edit detection', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const selection = await __selectionOf(clips);
if (!(await ppro.SequenceUtils.performSceneEditDetectionOnSelection(__C.SequenceOperation.${operation}, selection))) throw new Error("Premiere Pro did not start scene edit detection");
let done = await seq.isDoneAnalyzingForVideoEffects();
for (let waited = 0; !done && waited < ${wait} * 1000; waited += 500) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  done = await seq.isDoneAnalyzingForVideoEffects();
}
return { sequence: seq.name, operation: ${str(a.operation ?? 'cut')}, clips: clips.length, done: Boolean(done) };`));
        },
    },
    {
        name: 'get_sequence_properties',
        description: 'Read a sequence\'s custom properties: named values a script stored on it, carried into FCP XML exports. Give the names to read',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                names: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200, description: 'Property names' },
            },
            required: ['names'],
        },
        auditArgs: { names: ['review.status', 'client'] },
        hints: { readOnly: true },
        features: ['premiere.sequences.custom_property'],
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one property name");
            const names = a.names.map((n, i) => {
                if (typeof n !== 'string' || !PROPERTY_NAME.test(n)) throw new Error(`names[${i}] must be 1 to 200 letters, digits, spaces or . : / - _`);
                return n;
            });
            return run('Get sequence properties', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const props = await ppro.Properties.getProperties(seq);
if (!props) throw new Error("Premiere Pro returned no properties for " + seq.name);
const values = {};
for (const name of ${json(names)}) values[name] = props.hasValue(name) ? props.getValue(name) : null;
return { sequence: seq.name, values: values };`));
        },
    },
    {
        name: 'set_sequence_properties',
        description: 'Store or clear custom properties on a sequence: named text, number or true/false values a script keeps with it, carried into FCP XML exports. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                values: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Names and the values to store, e.g. { "review.status": "approved" }' },
                clear: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Names of properties to remove' },
                persistent: { type: 'boolean', description: 'Save the values with the project (false keeps them for this session only). Default true', default: true },
            },
        },
        auditArgs: { values: { 'review.status': 'approved', takes: 3 }, clear: ['old.flag'], persistent: true },
        hints: { idempotent: true },
        features: ['premiere.sequences.custom_property'],
        handler: (a) => {
            const values = a.values ?? {};
            if (typeof values !== 'object' || Array.isArray(values)) throw new Error("'values' must be an object of names and values");
            const clear = a.clear ?? [];
            if (!Array.isArray(clear)) throw new Error("'clear' must be a list of names");
            const check = (n, what) => { if (typeof n !== 'string' || !PROPERTY_NAME.test(n)) throw new Error(`${what} must be 1 to 200 letters, digits, spaces or . : / - _`); };
            const sets = Object.entries(values).map(([k, v]) => {
                check(k, `Property name "${k}"`);
                if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`values.${k} must be a finite number`);
                if (!['string', 'number', 'boolean'].includes(typeof v)) throw new Error(`values.${k} must be text, a number or true/false`);
                return [k, v];
            });
            clear.forEach((n, i) => check(n, `clear[${i}]`));
            if (!sets.length && !clear.length) throw new Error('Nothing to change: give values or clear');
            const both = sets.filter(([k]) => clear.includes(k)).map(([k]) => k);
            if (both.length) throw new Error(`${both.join(', ')} cannot be set and cleared at once`);
            const flag = a.persistent === false ? 'NON_PERSISTENT' : 'PERSISTENT';
            return run('Set sequence properties', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const props = await ppro.Properties.getProperties(seq);
if (!props) throw new Error("Premiere Pro returned no properties for " + seq.name);
const sets = ${json(sets)}, clear = ${json(clear)};
transact(project, "Sequence properties", (add) => {
  for (const [name, value] of sets) add(props.createSetValueAction(name, value, __C.PropertyType.${flag}));
  for (const name of clear) if (props.hasValue(name)) add(props.createClearValueAction(name));
});
const after = await ppro.Properties.getProperties(seq);
const values = {};
for (const [name] of sets) values[name] = after.hasValue(name) ? after.getValue(name) : null;
return { sequence: seq.name, values: values, cleared: clear };`));
        },
    },
];
