/**
 * Export: encode a sequence with an encoder preset (in Premiere Pro or queued
 * to Adobe Media Encoder), export a frame as an image, and export the
 * timeline as Final Cut Pro XML, OpenTimelineIO or AAF.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bool, str, enumOf, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, sequenceSpec, seconds } from '../args.js';
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
        description: 'Export a sequence with an encoder preset (.epr): encode it now in Premiere Pro (the call waits; raise PREMIERE_SCRIPT_TIMEOUT_MS for long exports), or queue it in Adobe Media Encoder or Premiere Pro\'s own queue. Whole sequence or in to out. Without an extension the preset\'s is added',
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
            },
            required: ['outputFile', 'preset'],
        },
        auditArgs: { outputFile: path.join(docs, 'audit.mp4'), preset: path.join(docs, 'H264.epr'), mode: 'queue_to_ame', startQueue: true, xmp: 'sidecar', overwrite: true },
        guarded: ['startBatchEncode', 'setEmbeddedXMPEnabled', 'setSidecarXMPEnabled'],
        features: ['premiere.export.export_media_file', 'premiere.export.export_mode', 'premiere.export.send_to_media_encoder', 'premiere.automation.ame_automation', 'premiere.export.xmp_on_export', 'premiere.export.export_general'],
        handler: (a) => {
            const file = checkedPath(a.outputFile, 'outputFile');
            const preset = checkedPath(a.preset, 'preset', ['.epr']);
            const mode = MODES[enumOf(a.mode ?? 'immediately', Object.keys(MODES), { name: 'mode' })];
            const range = enumOf(a.range ?? 'full', ['full', 'in_to_out'], { name: 'range' });
            const xmp = a.xmp === undefined ? null : enumOf(a.xmp, ['embedded', 'sidecar', 'both', 'none'], { name: 'xmp' });
            if (path.extname(file)) refuseOverwrite(file, a.overwrite);
            if (a.startQueue && mode !== 'QUEUE_TO_AME') throw new Error('startQueue goes with mode queue_to_ame');
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
await manager.startBatchEncode();` : ''}
return { sequence: seq.name, outputFile: file, mode: ${str(a.mode ?? 'immediately')}, range: ${str(range)}, queueStarted: ${bool(a.startQueue)} };`));
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
