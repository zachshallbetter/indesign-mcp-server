/**
 * Sequences: list, create (from a preset or from clips), open, read and change
 * settings, duplicate, delete, and set in/out, zero point, work area and
 * playhead.
 */
import { bool, json, str, enumOf, num, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, sequenceSpec, itemSpec, itemSpecs, seconds } from '../args.js';
import { checkedPath } from './project.js';

const FIELD_TYPES = ['PROGRESSIVE', 'UPPER_FIRST', 'LOWER_FIRST'];
const VIDEO_DISPLAY = ['FPS_23_976', 'FPS_25', 'FPS_29_97', 'FPS_29_97_NON_DROP', 'FRAMES'];
const AUDIO_DISPLAY = ['SAMPLE_RATE', 'MILLISECONDS'];

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
        features: ['premiere.sequences.new_sequence', 'premiere.sequences.new_sequence_from_clip'],
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
        features: ['premiere.sequences.open_sequence'],
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
        features: ['premiere.sequences.sequence_in_out', 'premiere.markers.mark_in', 'premiere.markers.mark_out', 'premiere.sequences.zero_point', 'premiere.sequences.work_area_bar', 'premiere.sequences.set_work_area_in', 'premiere.sequences.set_work_area_out', 'premiere.sequences.playhead'],
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
];
