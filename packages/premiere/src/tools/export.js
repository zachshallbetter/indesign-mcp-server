/**
 * Export: encode a sequence with an encoder preset (in Premiere Pro or queued
 * to Adobe Media Encoder), queue a project item or media file in Media
 * Encoder, export a frame as an image, and export the timeline as Final Cut
 * Pro XML, OpenTimelineIO or AAF.
 *
 * The preset (.epr) carries the format and every Export setting (video,
 * encoding, audio, captions, effects, metadata, VR, still sequences): the UXP
 * API has no member for an individual setting.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bool, str, enumOf, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, sequenceSpec, itemSpec, seconds } from '../args.js';
import { checkedPath } from './project.js';

const MODES = { immediately: 'IMMEDIATELY', queue_to_ame: 'QUEUE_TO_AME', queue_to_app: 'QUEUE_TO_APP' };
const FRAME_FORMATS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.dpx', '.gif', '.exr', '.tga'];
const TIMELINE_FORMATS = {
    fcpxml: { ext: ['.xml'], call: 'ppro.ProjectConverter.exportAsFinalCutProXML(seq, file, true)', since: '26.2' },
    otio: { ext: ['.otio'], call: 'ppro.ProjectConverter.exportAsOpenTimelineIO(seq, file, true)', since: '26.2' },
    aaf: { ext: ['.aaf'], call: 'ppro.ProjectConverter.exportAAF(seq, file, new ppro.AAFExportOptions())', since: '26.3' },
};

const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');

function refuseOverwrite(file, overwrite) {
    if (existsSync(file) && overwrite !== true) throw new Error(`${file} exists: pass overwrite: true to replace it`);
}

export const tools = [
    {
        name: 'export_sequence',
        description: 'Export a sequence with an encoder preset (.epr) (File > Export > Media, or Quick Export): encode it now in Premiere Pro (the call waits; raise PREMIERE_SCRIPT_TIMEOUT_MS for long exports), or queue it in Adobe Media Encoder or Premiere Pro\'s own queue. The preset sets the format and every Export setting (video, encoding, keyframe distance, audio, captions, effects such as Image Overlay, metadata, VR, HDR, still image sequences); save one from the Export page or Media Encoder. Whole sequence or in to out (set them with set_sequence_times). Without an extension the preset\'s is added. importIntoProject imports the file afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                outputFile: { type: 'string', description: 'Absolute path of the file to write' },
                preset: { type: 'string', description: 'Absolute path of an encoder preset (.epr), e.g. one saved from the Export page or Media Encoder' },
                mode: { type: 'string', enum: Object.keys(MODES), description: 'Default immediately', default: 'immediately' },
                range: { type: 'string', enum: ['full', 'in_to_out'], description: 'Default full', default: 'full' },
                startQueue: { type: 'boolean', description: 'With queue_to_ame: start Media Encoder\'s queue (Premiere Pro 26.3 or later). Default false', default: false },
                xmp: { type: 'string', enum: ['embedded', 'sidecar', 'both', 'none'], description: 'Write XMP metadata into the file, beside it, both or neither (26.3 or later). Default: Premiere Pro\'s setting' },
                overwrite: { type: 'boolean', description: 'Replace outputFile if it exists. Default false', default: false },
                importIntoProject: { type: 'boolean', description: 'With mode immediately: import the exported file into the project (Import into Project). Default false', default: false },
                importBin: { ...ITEM_SCHEMA, description: 'With importIntoProject: the bin to import into. Default: the project root' },
            },
            required: ['outputFile', 'preset'],
        },
        auditArgs: { outputFile: path.join(docs, 'audit.mp4'), preset: path.join(docs, 'H264.epr'), mode: 'queue_to_ame', startQueue: true, xmp: 'sidecar', overwrite: true, importIntoProject: false, importBin: undefined },
        guarded: ['startBatchEncode', 'setEmbeddedXMPEnabled', 'setSidecarXMPEnabled'],
        features: [
            'premiere.export.export_media_file', 'premiere.export.export_mode', 'premiere.export.send_to_media_encoder', 'premiere.automation.ame_automation', 'premiere.export.xmp_on_export', 'premiere.export.export_general',
            'premiere.export.export_presets', 'premiere.export.export_format', 'premiere.export.export_range', 'premiere.export.basic_video_settings',
            'premiere.export.video_encoding_settings', 'premiere.export.key_frame_distance', 'premiere.export.vr_export', 'premiere.export.audio_export_settings',
            'premiere.export.export_captions', 'premiere.export.export_effects', 'premiere.export.export_metadata', 'premiere.export.import_into_project',
            'premiere.export.quick_export', 'premiere.export.visual_watermark', 'premiere.export.hdr_youtube', 'premiere.export.supported_export_formats',
            'premiere.export.export_still_sequence',
        ],
        handler: (a) => {
            const file = checkedPath(a.outputFile, 'outputFile');
            const preset = checkedPath(a.preset, 'preset', ['.epr']);
            const mode = MODES[enumOf(a.mode ?? 'immediately', Object.keys(MODES), { name: 'mode' })];
            const range = enumOf(a.range ?? 'full', ['full', 'in_to_out'], { name: 'range' });
            const xmp = a.xmp === undefined ? null : enumOf(a.xmp, ['embedded', 'sidecar', 'both', 'none'], { name: 'xmp' });
            if (path.extname(file)) refuseOverwrite(file, a.overwrite);
            if (a.startQueue && mode !== 'QUEUE_TO_AME') throw new Error('startQueue goes with mode queue_to_ame');
            const importInto = a.importIntoProject === true;
            if (importInto && mode !== 'IMMEDIATELY') throw new Error('importIntoProject goes with mode immediately: a queued export has not been written yet');
            if (a.importBin !== undefined && !importInto) throw new Error('importBin goes with importIntoProject: true');
            const importScript = importInto ? `
const target = await __bin(project, ${a.importBin ? itemSpec(a.importBin, 'importBin') : 'null'});
const before = new Set((target.children || []).map((c) => c.getId()));
if (!(await project.importFiles([file], true, target.item, false))) throw new Error("Exported " + file + ", but Premiere Pro did not import it");
const after = await __entry(target.item, target.path);
const imported = (after.children || []).filter((c) => !before.has(c.getId())).map((c) => ({ name: c.name, id: c.getId() }));` : '';
            return run('Export sequence', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const manager = ppro.EncoderManager.getManager();
let file = ${str(file)};
if (!/\\.[A-Za-z0-9]+$/.test(file.split(/[\\\\/]/).pop())) {
  const ext = await ppro.EncoderManager.getExportFileExtension(seq, ${str(preset)});
  if (ext) file += ext.charAt(0) === "." ? ext : "." + ext;
}
${xmp ? `if (typeof manager.setEmbeddedXMPEnabled !== "function") throw new Error("Choosing XMP output needs Premiere Pro 26.3 or later");
await manager.setEmbeddedXMPEnabled(${bool(xmp === 'embedded' || xmp === 'both')});
await manager.setSidecarXMPEnabled(${bool(xmp === 'sidecar' || xmp === 'both')});` : ''}
${mode === 'QUEUE_TO_AME' ? 'if (!manager.isAMEInstalled) throw new Error("Adobe Media Encoder is not installed");' : ''}
const ok = await manager.exportSequence(seq, __C.ExportType.${mode}, file, ${str(preset)}, ${bool(range === 'full')});
if (!ok) throw new Error("Premiere Pro did not export " + seq.name + " (check the preset and that the folder exists)");
${a.startQueue ? `if (typeof manager.startBatchEncode !== "function") throw new Error("Queued; starting Media Encoder's queue needs Premiere Pro 26.3 or later");
await manager.startBatchEncode();` : ''}${importScript}
return { sequence: seq.name, outputFile: file, mode: ${str(a.mode ?? 'immediately')}, range: ${str(range)}, queueStarted: ${bool(a.startQueue)}${importInto ? ', importedInto: target.path || "(root)", imported: imported' : ''} };`));
        },
    },
    {
        name: 'encode_media',
        description: 'Queue a clip or sequence from the project, or a media file on disk, in Adobe Media Encoder with an encoder preset (.epr) (Export > Send to Media Encoder, or Media Encoder\'s queue). Whole item, its in to out, or (sequences) the work area; a file can be trimmed with inPoint and outPoint. Optionally starts the queue. Returns once the job is queued; wait_for_event with render_complete waits for it to finish',
        inputSchema: {
            type: 'object',
            properties: {
                item: { ...ITEM_SCHEMA, description: 'The clip or sequence project item to encode. Give item or file' },
                file: { type: 'string', description: 'Absolute path of a media file to encode without importing it. Give item or file' },
                outputFile: { type: 'string', description: 'Absolute path of the file to write, with its extension' },
                preset: { type: 'string', description: 'Absolute path of an encoder preset (.epr)' },
                range: { type: 'string', enum: ['full', 'in_to_out', 'work_area'], description: 'With item: the whole item, its in to out, or the work area (sequences only). Default full', default: 'full' },
                inPoint: { type: 'number', minimum: 0, description: 'With file: start at this time, seconds. Default the start' },
                outPoint: { type: 'number', minimum: 0, description: 'With file: stop at this time, seconds. Default the end' },
                removeWhenDone: { type: 'boolean', description: 'Remove the job from Media Encoder\'s queue when it finishes. Default false', default: false },
                startQueue: { type: 'boolean', description: 'Start Media Encoder\'s queue straight away. Default false', default: false },
                overwrite: { type: 'boolean', description: 'Replace outputFile if it exists. Default false', default: false },
            },
            required: ['outputFile', 'preset'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, file: undefined, outputFile: path.join(docs, 'audit.mp4'), preset: path.join(docs, 'H264.epr'), range: 'in_to_out', inPoint: undefined, outPoint: undefined, overwrite: true },
        features: ['premiere.export.ame_queue', 'premiere.export.send_to_media_encoder'],
        handler: (a) => {
            if (a.item === undefined && a.file === undefined) throw new Error('Choose what to encode: item (a project item) or file (a media file on disk)');
            if (a.item !== undefined && a.file !== undefined) throw new Error('Give item or file, not both');
            const out = checkedPath(a.outputFile, 'outputFile');
            if (!path.extname(out)) throw new Error(`'outputFile' needs an extension, such as .mp4: ${a.outputFile}`);
            refuseOverwrite(out, a.overwrite);
            const preset = checkedPath(a.preset, 'preset', ['.epr']);
            const range = enumOf(a.range ?? 'full', ['full', 'in_to_out', 'work_area'], { name: 'range' });
            const remove = bool(a.removeWhenDone === true);
            const start = bool(a.startQueue === true);
            const head = `const manager = ppro.EncoderManager.getManager();
if (!manager.isAMEInstalled) throw new Error("Adobe Media Encoder is not installed");`;
            if (a.file !== undefined) {
                if (a.range !== undefined && range !== 'full') throw new Error('range goes with item; trim a file with inPoint and outPoint');
                const src = checkedPath(a.file, 'file');
                const inP = a.inPoint === undefined ? null : seconds(a.inPoint, 'inPoint');
                const outP = a.outPoint === undefined ? null : seconds(a.outPoint, 'outPoint');
                if (inP !== null && outP !== null && Number(outP) <= Number(inP)) throw new Error('outPoint must be after inPoint');
                const trimmed = inP !== null || outP !== null;
                // TickTime has no named invalid time in the reference; dividing by zero returns TIME_INVALID, which encodes to the end.
                return run('Encode media', script(`
${head}
const inPoint = __t(${inP ?? 0});
const outPoint = ${outP === null ? '__t(0).divide(0)' : `__t(${outP})`};
const ok = await manager.encodeFile(${str(src)}, ${str(out)}, ${str(preset)}, inPoint, outPoint, ${trimmed ? 1 : 0}, ${remove}, ${start});
if (!ok) throw new Error("Media Encoder did not queue " + ${str(src)} + " (check the file, the preset and that the folder exists)");
return { queued: ${str(src)}, outputFile: ${str(out)}, preset: ${str(preset)}, inPoint: ${inP ?? 0}, outPoint: ${outP ?? 'null'}, queueStarted: ${start} };`));
            }
            if (a.inPoint !== undefined || a.outPoint !== undefined) throw new Error('inPoint and outPoint go with file; for an item, set its in and out points and use range in_to_out');
            const workArea = { full: 0, in_to_out: 1, work_area: 2 }[range];
            return run('Encode media', script(`
${head}
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
${range === 'work_area' ? 'if (entry.kind !== "sequence") throw new Error("range work_area needs a sequence item; " + entry.path + " is a " + entry.kind);' : ''}
const ok = await manager.encodeProjectItem(clip, ${str(out)}, ${str(preset)}, ${workArea}, ${remove}, ${start});
if (!ok) throw new Error("Media Encoder did not queue " + entry.path + " (check the preset and that the folder exists)");
return { queued: __itemInfo(entry), outputFile: ${str(out)}, preset: ${str(preset)}, range: ${str(range)}, queueStarted: ${start} };`));
        },
    },
    {
        name: 'export_frame',
        description: 'Export one frame of a sequence as an image (Export Frame): PNG, JPEG, TIFF, BMP, DPX, GIF, EXR or TGA, chosen by the file extension. Size defaults to the sequence frame size',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                time: { type: 'number', minimum: 0, description: 'Sequence time in seconds. Default: the playhead' },
                outputFile: { type: 'string', description: 'Absolute path; the extension picks the format' },
                width: { type: 'integer', minimum: 1, maximum: 16384 },
                height: { type: 'integer', minimum: 1, maximum: 16384 },
                overwrite: { type: 'boolean', default: false },
            },
            required: ['outputFile'],
        },
        auditArgs: { outputFile: path.join(docs, 'frame.png'), time: 12, width: 1920, height: 1080, overwrite: true },
        features: ['premiere.export.export_frame'],
        handler: (a) => {
            const file = checkedPath(a.outputFile, 'outputFile', FRAME_FORMATS);
            refuseOverwrite(file, a.overwrite);
            if ((a.width === undefined) !== (a.height === undefined)) throw new Error('Give width and height together');
            const dir = path.dirname(file) + path.sep;
            return run('Export frame', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const time = ${a.time === undefined ? 'await seq.getPlayerPosition()' : `__t(${seconds(a.time, 'time')})`};
let width = ${a.width === undefined ? 'null' : index(a.width, { name: 'width', max: 16384 })}, height = ${a.height === undefined ? 'null' : index(a.height, { name: 'height', max: 16384 })};
if (width === null) { const size = await seq.getFrameSize(); width = size.width; height = size.height; }
const ok = await ppro.Exporter.exportSequenceFrame(seq, time, ${str(path.basename(file))}, ${str(dir)}, width, height);
if (!ok) throw new Error("Premiere Pro did not export the frame");
return { sequence: seq.name, time: __s(time), outputFile: ${str(file)}, width: width, height: height };`));
        },
    },
    {
        name: 'export_timeline',
        description: 'Export a sequence\'s edit for another application: Final Cut Pro XML (.xml) or OpenTimelineIO (.otio), Premiere Pro 26.2 or later, or AAF (.aaf) with default options, 26.3 or later',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                format: { type: 'string', enum: Object.keys(TIMELINE_FORMATS) },
                outputFile: { type: 'string', description: 'Absolute path with the format\'s extension' },
                overwrite: { type: 'boolean', default: false },
            },
            required: ['format', 'outputFile'],
        },
        auditArgs: { format: 'fcpxml', outputFile: path.join(docs, 'edit.xml'), overwrite: true },
        since: '26.2',
        guarded: ['exportAAF', 'AAFExportOptions'],
        features: ['premiere.export.export_fcp_xml', 'premiere.export.export_otio', 'premiere.export.export_aaf'],
        handler: (a) => {
            const format = enumOf(a.format, Object.keys(TIMELINE_FORMATS), { name: 'format' });
            const spec = TIMELINE_FORMATS[format];
            const file = checkedPath(a.outputFile, 'outputFile', spec.ext);
            refuseOverwrite(file, a.overwrite);
            return run('Export timeline', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
if (typeof ppro.ProjectConverter === "undefined"${format === 'aaf' ? ' || typeof ppro.ProjectConverter.exportAAF !== "function"' : ''}) throw new Error(${str(`Exporting ${format} needs Premiere Pro ${spec.since} or later`)});
const file = ${str(file)};
if (!(await ${spec.call})) throw new Error("Premiere Pro did not export " + seq.name);
return { sequence: seq.name, format: ${str(format)}, outputFile: file };`), { since: spec.since });
        },
    },
];
