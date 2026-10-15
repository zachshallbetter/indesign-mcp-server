/**
 * Compositions: create, change settings, duplicate, pre-compose, open, add
 * markers, and save a frame as PNG.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';
import { paths } from './project.js';

const RESOLUTIONS = { full: 1, half: 2, third: 3, quarter: 4 };

const SETTINGS = {
    name: { type: 'string' },
    width: { type: 'integer', minimum: 4, maximum: 30000, description: 'Pixels' },
    height: { type: 'integer', minimum: 4, maximum: 30000, description: 'Pixels' },
    pixelAspect: { type: 'number', minimum: 0.01, maximum: 100, description: 'Default 1' },
    duration: { type: 'number', minimum: 0.01, maximum: 10800, description: 'Seconds' },
    frameRate: { type: 'number', minimum: 1, maximum: 999, description: 'Frames per second' },
    backgroundColor: COLOR_SCHEMA,
    motionBlur: { type: 'boolean', description: 'Enable motion blur for the composition' },
    shutterAngle: { type: 'number', minimum: 0, maximum: 720 },
    workAreaStart: { type: 'number', minimum: 0, description: 'Seconds' },
    workAreaDuration: { type: 'number', minimum: 0.01, description: 'Seconds' },
    resolution: { type: 'string', enum: Object.keys(RESOLUTIONS), description: 'Resolution: full, half, third or quarter' },
    resolutionFactor: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 99 }, minItems: 2, maxItems: 2, description: 'Custom resolution: render every [x, y]th pixel' },
    startTimecode: { type: 'number', minimum: -86400, maximum: 86400, description: 'Start Timecode: the time shown for the first frame, in seconds' },
    startFrame: { type: 'integer', minimum: -1000000, maximum: 1000000, description: 'Start Frame: the number shown for the first frame, when the project counts frames' },
    dropFrame: { type: 'boolean', description: 'Drop Frame timecode (29.97 and 59.94 fps); false is Non-Drop Frame' },
    preserveNestedResolution: { type: 'boolean', description: 'Preserve resolution when nested' },
    preserveNestedFrameRate: { type: 'boolean', description: 'Preserve frame rate when nested or in render queue' },
    shutterPhase: { type: 'number', minimum: -360, maximum: 360, description: 'Motion blur Shutter Phase, degrees' },
    samplesPerFrame: { type: 'integer', minimum: 2, maximum: 64, description: 'Motion blur Samples Per Frame' },
    adaptiveSampleLimit: { type: 'integer', minimum: 16, maximum: 256, description: 'Motion blur Adaptive Sample Limit' },
    frameBlending: { type: 'boolean', description: 'Timeline switch: Enable Frame Blending for the composition' },
    hideShyLayers: { type: 'boolean', description: 'Timeline switch: Hide Shy Layers' },
};

/** Statements that apply SETTINGS to composition `c` (name and size included). */
function settingLines(a) {
    const lines = [];
    if (a.name !== undefined) lines.push(`c.name = ${str(a.name)};`);
    if (a.width !== undefined) lines.push(`c.width = ${index(a.width, { name: 'width', max: 30000 })};`);
    if (a.height !== undefined) lines.push(`c.height = ${index(a.height, { name: 'height', max: 30000 })};`);
    if (a.pixelAspect !== undefined) lines.push(`c.pixelAspect = ${num(a.pixelAspect, { min: 0.01, max: 100, name: 'pixelAspect' })};`);
    if (a.duration !== undefined) lines.push(`c.duration = ${num(a.duration, { min: 0.01, max: 10800, name: 'duration' })};`);
    if (a.frameRate !== undefined) lines.push(`c.frameRate = ${num(a.frameRate, { min: 1, max: 999, name: 'frameRate' })};`);
    if (a.backgroundColor !== undefined) lines.push(`c.bgColor = ${colorValue(a.backgroundColor, 'backgroundColor')};`);
    if (a.motionBlur !== undefined) lines.push(`c.motionBlur = ${bool(a.motionBlur)};`);
    if (a.shutterAngle !== undefined) lines.push(`c.shutterAngle = ${num(a.shutterAngle, { min: 0, max: 720, name: 'shutterAngle' })};`);
    if (a.workAreaStart !== undefined) lines.push(`c.workAreaStart = ${num(a.workAreaStart, { min: 0, name: 'workAreaStart' })};`);
    if (a.workAreaDuration !== undefined) lines.push(`c.workAreaDuration = ${num(a.workAreaDuration, { min: 0.01, name: 'workAreaDuration' })};`);
    if (a.resolution !== undefined) {
        const f = RESOLUTIONS[enumOf(a.resolution, Object.keys(RESOLUTIONS), { name: 'resolution' })];
        lines.push(`c.resolutionFactor = [${f}, ${f}];`);
    }
    if (a.resolutionFactor !== undefined) {
        if (!Array.isArray(a.resolutionFactor) || a.resolutionFactor.length !== 2) throw new Error("'resolutionFactor' is [x, y]");
        lines.push(`c.resolutionFactor = [${a.resolutionFactor.map((v) => num(v, { min: 1, max: 99, name: 'resolutionFactor' })).join(', ')}];`);
    }
    if (a.startTimecode !== undefined) lines.push(`c.displayStartTime = ${num(a.startTimecode, { min: -86400, max: 86400, name: 'startTimecode' })};`);
    if (a.startFrame !== undefined) {
        if (!Number.isInteger(a.startFrame)) throw new Error("'startFrame' must be a whole frame number");
        lines.push(`c.displayStartFrame = ${num(a.startFrame, { min: -1000000, max: 1000000, name: 'startFrame' })};`);
    }
    if (a.shutterPhase !== undefined) lines.push(`c.shutterPhase = ${num(a.shutterPhase, { min: -360, max: 360, name: 'shutterPhase' })};`);
    if (a.samplesPerFrame !== undefined) lines.push(`c.motionBlurSamplesPerFrame = ${num(a.samplesPerFrame, { min: 2, max: 64, name: 'samplesPerFrame' })};`);
    if (a.adaptiveSampleLimit !== undefined) lines.push(`c.motionBlurAdaptiveSampleLimit = ${num(a.adaptiveSampleLimit, { min: 16, max: 256, name: 'adaptiveSampleLimit' })};`);
    for (const k of ['dropFrame', 'frameBlending', 'hideShyLayers']) if (a[k] !== undefined) lines.push(`c.${k} = ${bool(a[k])};`);
    if (a.preserveNestedResolution !== undefined) lines.push(`c.preserveNestedResolution = ${bool(a.preserveNestedResolution)};`);
    if (a.preserveNestedFrameRate !== undefined) lines.push(`c.preserveNestedFrameRate = ${bool(a.preserveNestedFrameRate)};`);
    return lines;
}

export const tools = [
    {
        name: 'create_comp',
        description: 'Create a composition (Composition > New Composition) with a size, pixel aspect, duration, frame rate and background colour, optionally in a folder, and open it',
        inputSchema: {
            type: 'object',
            properties: { ...SETTINGS, folder: { type: 'integer', description: 'Folder id' } },
            required: ['name', 'width', 'height', 'duration', 'frameRate'],
        },
        auditArgs: { backgroundColor: '#101820', adaptiveSampleLimit: 64 },
        features: [
            'aftereffects.compositions.new_composition',
            'aftereffects.compositions.comp_frame_size',
            'aftereffects.compositions.comp_pixel_aspect_ratio',
            'aftereffects.compositions.comp_duration',
            'aftereffects.compositions.comp_frame_rate',
            'aftereffects.compositions.comp_background_color',
            'aftereffects.compositions.enable_motion_blur',
            'aftereffects.compositions.shutter_angle',
            'aftereffects.compositions.work_area',
        ],
        handler: (a) => run('Create composition', script(`
var c = proj.items.addComp(${str(a.name)}, ${index(a.width, { name: 'width', max: 30000 })}, ${index(a.height, { name: 'height', max: 30000 })}, ${num(a.pixelAspect ?? 1, { min: 0.01, max: 100, name: 'pixelAspect' })}, ${num(a.duration, { min: 0.01, max: 10800, name: 'duration' })}, ${num(a.frameRate, { min: 1, max: 999, name: 'frameRate' })});
${settingLines({ ...a, name: undefined, width: undefined, height: undefined, pixelAspect: undefined, duration: undefined, frameRate: undefined }).join('\n')}
${a.folder !== undefined ? `var fo = proj.itemByID(${index(a.folder, { name: 'folder' })}); if (!(fo instanceof FolderItem)) throw new Error("folder must be a folder"); c.parentFolder = fo;` : ''}
c.openInViewer();
__result__ = __itemInfo(c);`, { undo: 'Create composition' })),
    },
    {
        name: 'set_comp_settings',
        description: 'Change a composition\'s settings (Composition > Composition Settings): name, size, pixel aspect, duration, frame rate, resolution, start timecode or frame, drop-frame timecode, background, motion blur (shutter angle and phase, samples), nesting options and work area; and its Timeline switches Enable Frame Blending and Hide Shy Layers',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, ...SETTINGS }, required: [] },
        hints: { idempotent: true },
        auditArgs: { backgroundColor: 'rgb(0,0,0)', workAreaStart: 0, adaptiveSampleLimit: 64 },
        features: [
            'aftereffects.compositions.comp_item_object',
            'aftereffects.compositions.comp_resolution',
            'aftereffects.compositions.comp_start_timecode',
            'aftereffects.compositions.preserve_resolution_when_nested',
            'aftereffects.compositions.shutter_phase',
            'aftereffects.compositions.samples_per_frame',
            'aftereffects.compositions.adaptive_sample_limit',
            'aftereffects.time.drop_frame_timecode',
            'aftereffects.time.preserve_frame_rate_when_nested',
            'aftereffects.time.enable_frame_blending_comp',
            'aftereffects.layers.hide_shy_layers',
            'aftereffects.compositions.composition_settings',
            'aftereffects.compositions.comp_frame_size',
            'aftereffects.compositions.comp_pixel_aspect_ratio',
            'aftereffects.compositions.comp_duration',
            'aftereffects.compositions.comp_frame_rate',
            'aftereffects.compositions.comp_background_color',
            'aftereffects.compositions.enable_motion_blur',
            'aftereffects.compositions.shutter_angle',
            'aftereffects.compositions.work_area',
        ],
        handler: (a) => {
            const lines = settingLines(a);
            if (!lines.length) throw new Error('Give at least one setting');
            return run('Composition settings', script(`
var c = __comp(${compSpec(a.comp)});
${lines.join('\n')}
var info = __itemInfo(c); info.workAreaStart = c.workAreaStart; info.workAreaDuration = c.workAreaDuration; info.motionBlur = c.motionBlur;
info.resolutionFactor = c.resolutionFactor; info.displayStartTime = c.displayStartTime; info.dropFrame = c.dropFrame; info.frameBlending = c.frameBlending; info.hideShyLayers = c.hideShyLayers;
__result__ = info;`, { undo: 'Composition settings' }));
        },
    },
    {
        name: 'duplicate_comp',
        description: 'Duplicate a composition (Edit > Duplicate), optionally renaming the copy',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, name: { type: 'string' } } },
        features: ['aftereffects.compositions.duplicate_composition'],
        handler: (a) => run('Duplicate composition', script(`
var c = __comp(${compSpec(a.comp)}).duplicate();
${a.name ? `c.name = ${str(a.name)};` : ''}
__result__ = __itemInfo(c);`, { undo: 'Duplicate composition' })),
    },
    {
        name: 'precompose',
        description: 'Pre-compose layers into a new composition (Layer > Pre-compose), moving all attributes or leaving them in the original',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                name: { type: 'string' },
                moveAllAttributes: { type: 'boolean', description: 'Move all attributes into the new composition. Default true', default: true },
            },
            required: ['layers', 'name'],
        },
        features: [
            'aftereffects.compositions.precompose',
            'aftereffects.compositions.precompose_move_attributes',
            'aftereffects.compositions.precompose_leave_attributes',
        ],
        handler: (a) => run('Pre-compose', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), idx = [];
for (var i = 0; i < ls.length; i++) idx.push(ls[i].index);
var nc = c.layers.precompose(idx, ${str(a.name)}, ${bool(a.moveAllAttributes ?? true)});
__result__ = __itemInfo(nc);`, { undo: 'Pre-compose' })),
    },
    {
        name: 'open_comp',
        description: 'Open a composition in the Composition panel and make it the active one',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA } },
        hints: { idempotent: true },
        features: ['aftereffects.projects.open_project_item'],
        handler: (a) => run('Open composition', script(`
var c = __comp(${compSpec(a.comp)});
c.openInViewer();
__result__ = __itemInfo(c);`)),
    },
    {
        name: 'add_comp_marker',
        description: 'Add a composition marker at a time, with a comment, duration, chapter and web link',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                time: { type: 'number', minimum: 0, description: 'Seconds' },
                comment: { type: 'string' },
                duration: { type: 'number', minimum: 0, description: 'Seconds' },
                chapter: { type: 'string' },
                url: { type: 'string' },
            },
            required: ['time'],
        },
        features: [
            'aftereffects.compositions.add_composition_marker',
            'aftereffects.compositions.marker_value_object',
            'aftereffects.compositions.marker_comment',
            'aftereffects.compositions.marker_duration',
            'aftereffects.compositions.marker_chapter',
            'aftereffects.compositions.marker_web_link',
        ],
        handler: (a) => run('Add marker', script(`
var c = __comp(${compSpec(a.comp)});
var m = new MarkerValue(${str(a.comment ?? '')});
${a.duration !== undefined ? `m.duration = ${num(a.duration, { min: 0, name: 'duration' })};` : ''}
${a.chapter !== undefined ? `m.chapter = ${str(a.chapter)};` : ''}
${a.url !== undefined ? `m.url = ${str(a.url)};` : ''}
c.markerProperty.setValueAtTime(${num(a.time, { min: 0, name: 'time' })}, m);
__result__ = { comp: c.name, markers: c.markerProperty.numKeys };`, { undo: 'Add marker' })),
    },
    {
        name: 'save_frame',
        description: 'Save one frame of a composition as a PNG file (Composition > Save Frame As)',
        inputSchema: {
            type: 'object',
            properties: { comp: COMP_SCHEMA, time: { type: 'number', minimum: 0, description: 'Seconds' }, outputFile: { type: 'string', description: 'Absolute .png path' } },
            required: ['time', 'outputFile'],
        },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/frame.png` },
        hints: { idempotent: true },
        features: ['aftereffects.render_export.save_frame_to_png'],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.png') throw new Error('outputFile must end in .png');
            return run('Save frame', script(`
var c = __comp(${compSpec(a.comp)}), f = new File(${jsxPath(out)});
c.saveFrameToPng(${num(a.time, { min: 0, name: 'time' })}, f);
__result__ = { saved: f.fsName, comp: c.name };`));
        },
    },
];

