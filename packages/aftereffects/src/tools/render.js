/**
 * Rendering: queue compositions with render settings and output module
 * templates, change render settings and output modules, render the queue, send
 * it to Adobe Media Encoder, control a render in progress, and set up
 * Multi-Frame Rendering and Watch Folder mode.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, compSpec } from '../args.js';
import { paths } from './project.js';

/** ES3: describe the render queue. */
const QUEUE = `
function __queue() {
  var rq = app.project.renderQueue, out = [];
  for (var i = 1; i <= rq.numItems; i++) {
    var it = rq.item(i), oms = [];
    for (var o = 1; o <= it.numOutputModules; o++) { var om = it.outputModule(o); oms.push({ name: om.name, file: om.file ? om.file.fsName : null }); }
    out.push({ index: i, comp: it.comp.name, status: __enumName(it.status), render: it.render, outputModules: oms });
  }
  return { rendering: rq.rendering, items: out };
}`;

/** ES3: a render item by 1-based index, setSettings with the settable keys in the error, and read-outs. */
const ITEM = `
function __rqItem(i) {
  var rq = app.project.renderQueue;
  if (i < 1 || i > rq.numItems) throw new Error("Render item " + i + " does not exist; the Render Queue has " + rq.numItems);
  return rq.item(i);
}
function __setAll(target, wanted, what) {
  try { target.setSettings(wanted); }
  catch (e) {
    var keys = [];
    try { var have = target.getSettings(GetSettingsFormat.STRING_SETTABLE); for (var k in have) if (have.hasOwnProperty(k)) keys.push(k); } catch (e2) {}
    throw new Error(what + ": " + e.toString() + (keys.length ? ". Settable now: " + keys.join(", ") : ""));
  }
}
function __inList(list, v) { for (var i = 0; i < list.length; i++) if (list[i] === v) return true; return false; }
function __omInfo(it, o) {
  var om = it.outputModule(o), s = om.getSettings(GetSettingsFormat.STRING);
  var info = { index: o, name: om.name, file: om.file ? om.file.fsName : null, format: s["Format"], postRenderAction: __enumName(om.postRenderAction), includeSourceXMP: om.includeSourceXMP };
  try { info.fileTemplate = s["Output File Info"]["File Template"]; } catch (e) {}
  info.settings = om.getSettings(GetSettingsFormat.STRING_SETTABLE);
  return info;
}
function __itemSettings(it, i) {
  return { index: i, comp: it.comp.name, status: __enumName(it.status), render: it.render, logType: __enumName(it.logType), notify: it.queueItemNotify,
    skipFrames: it.skipFrames, timeSpanStart: it.timeSpanStart, timeSpanDuration: it.timeSpanDuration,
    startTime: it.startTime ? String(it.startTime) : null, elapsedSeconds: it.elapsedSeconds, settings: it.getSettings(GetSettingsFormat.STRING_SETTABLE) };
}`;

/** ES3: find the output module template that writes a format by applying each to a scratch render item. */
const FORMAT_TEMPLATE = `
function __templateFor(re, label) {
  var c = app.project.items.addComp("__formats", 64, 64, 1, 1, 30), it = app.project.renderQueue.items.add(c), hit = null, seen = [];
  try {
    var names = it.outputModule(1).templates;
    for (var t = 0; t < names.length && !hit; t++) {
      if (names[t].indexOf("_HIDDEN") === 0) continue;
      it.outputModule(1).applyTemplate(names[t]);
      var f = String(it.outputModule(1).getSettings(GetSettingsFormat.STRING)["Format"]);
      if (!__inList(seen, f)) seen.push(f);
      if (re.test(f)) hit = names[t];
    }
  } finally { it.remove(); c.remove(); }
  if (!hit) throw new Error("No output module template writes " + label + " (template formats: " + seen.join(", ") + "). Make one in Edit > Templates > Output Module and pass its name as template");
  return hit;
}`;

/**
 * Render Settings dialog options: parameter -> [setting key, the dialog's choices].
 * Keys and values are the English names After Effects uses in the dialog.
 */
const RENDER_OPTIONS = {
    quality: ['Quality', 'Current Settings, Best, Draft or Wireframe'],
    resolution: ['Resolution', 'Current Settings, Full, Half, Third, Quarter or Custom'],
    diskCache: ['Disk Cache', 'Read Only or Current Settings'],
    proxyUse: ['Proxy Use', 'Current Settings, Use All Proxies, Use Comp Proxies Only or Use No Proxies'],
    effects: ['Effects', 'Current Settings, All On or All Off'],
    soloSwitches: ['Solo Switches', 'Current Settings or All Off'],
    guideLayers: ['Guide Layers', 'Current Settings (render guide layers in the top composition) or All Off'],
    colorDepth: ['Color Depth', 'Current Settings, 8 bits per channel, 16 bits per channel or 32 bits per channel'],
    frameBlending: ['Frame Blending', 'Current Settings, On for Checked Layers or Off for All Layers'],
    fieldRender: ['Field Render', 'Off, Upper Field First or Lower Field First'],
    pulldown: ['3:2 Pulldown', 'Off or a phase such as WSSWW'],
    motionBlur: ['Motion Blur', 'Current Settings, On for Checked Layers or Off for All Layers'],
    timeSpan: ['Time Span', 'Length of Comp, Work Area Only or Custom'],
};

const LOG_TYPES = { errors_only: 'ERRORS_ONLY', errors_and_settings: 'ERRORS_AND_SETTINGS', errors_and_per_frame_info: 'ERRORS_AND_PER_FRAME_INFO' };
const POST_RENDER = { none: 'NONE', import: 'IMPORT', import_and_replace_usage: 'IMPORT_AND_REPLACE_USAGE', set_proxy: 'SET_PROXY' };

/** Output formats: parameter value -> [name in errors, pattern matching the Format setting]. */
const FORMATS = {
    quicktime: ['QuickTime', '^QuickTime'],
    avi: ['AVI', '^AVI|Video for Windows'],
    h264: ['H.264', 'H\\.?264'],
    photoshop_sequence: ['Photoshop sequence', 'Photoshop'],
    cineon_dpx: ['Cineon / DPX', 'DPX|Cineon'],
    maya_iff: ['Maya IFF', '^IFF|Maya'],
    jpeg: ['JPEG', 'JPEG'],
    openexr: ['OpenEXR', 'EXR'],
    png: ['PNG', 'PNG'],
    radiance: ['Radiance', 'Radiance'],
    sgi: ['SGI', '^SGI'],
    targa: ['Targa', 'Targa'],
    tiff: ['TIFF', 'TIFF'],
    aiff: ['AIFF', '^AIFF'],
    mp3: ['MP3', 'MP3'],
    wav: ['WAV', '^WAV'],
};

const SETTINGS_SCHEMA = { type: 'object', description: 'Any other settings by the English name After Effects gives them (get_render_item shows the settable names and current values), e.g. { "Quality": "Best" }' };

/** A settings object for setSettings: names to text, numbers, true/false or (one level) nested settings. */
function settingsObject(value, name, depth = 0) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object of setting names to values`);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) out[k] = settingsObject(v, `${name}.${k}`, depth + 1);
        else if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
        else throw new Error(`'${name}.${k}' must be text, a number or true/false`);
    }
    return out;
}

/** 1-based render item indexes from a caller list, checked. */
function itemIndexes(items, name = 'items') {
    if (!Array.isArray(items) || !items.length) throw new Error(`'${name}' must list at least one render item (1-based, from manage_render_queue)`);
    return items.map((i) => {
        const n = Number(index(i, { name, max: 10000 }));
        if (n < 1) throw new Error(`'${name}': render items are numbered from 1`);
        return n;
    });
}

export const tools = [
    {
        name: 'list_render_templates',
        description: 'List the render settings and output module templates (Edit > Templates) available for queueing',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['aftereffects.render_export.render_settings_templates', 'aftereffects.render_export.output_module_templates'],
        handler: () => run('List render templates', script(`
var c = proj.items.addComp("__templates", 4, 4, 1, 1, 1), rq = proj.renderQueue.items.add(c);
try { __result__ = { renderSettings: rq.templates, outputModules: rq.outputModule(1).templates }; }
finally { rq.remove(); c.remove(); }`, { undo: 'List render templates' })),
    },
    {
        name: 'queue_render',
        description: 'Add a composition to the Render Queue (Composition > Add to Render Queue) with a render settings template, an output module template and an output file, optionally a time span, a single frame (Composition > Save Frame As > File) or as a pre-render that imports the result and replaces the composition\'s uses (Composition > Pre-render)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                outputFile: { type: 'string', description: 'Absolute output path; the extension should match the output module' },
                renderSettings: { type: 'string', description: 'Render settings template, e.g. "Best Settings"' },
                outputModule: { type: 'string', description: 'Output module template, e.g. "High Quality", "H.264 - Match Render Settings - 15 Mbps"' },
                start: { type: 'number', minimum: 0, description: 'Seconds' },
                duration: { type: 'number', minimum: 0.01, description: 'Seconds' },
                frame: { type: 'number', minimum: 0, description: 'Render only the frame at this time (seconds), as Save Frame As > File does; not with start or duration' },
                preRender: { type: 'boolean', description: 'Pre-render: after rendering, import the file and replace the composition\'s uses with it. Default false', default: false },
            },
            required: ['outputFile'],
        },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/render.mov`, renderSettings: 'Best Settings', outputModule: 'High Quality', frame: undefined },
        features: [
            'aftereffects.render_export.add_to_render_queue',
            'aftereffects.render_export.render_item',
            'aftereffects.render_export.render_settings_templates',
            'aftereffects.render_export.output_module_templates',
            'aftereffects.render_export.output_to',
            'aftereffects.render_export.render_settings',
            'aftereffects.render_export.save_frame_as_file',
            'aftereffects.render_export.pre_render',
        ],
        handler: (a) => {
            if (a.frame !== undefined && (a.start !== undefined || a.duration !== undefined)) throw new Error("'frame' cannot be combined with start or duration");
            const out = paths.validate(a.outputFile);
            return run('Queue render', script(`${QUEUE}
var c = __comp(${compSpec(a.comp)}), it = proj.renderQueue.items.add(c);
${a.renderSettings ? `it.applyTemplate(${str(a.renderSettings)});` : ''}
var om = it.outputModule(1);
${a.outputModule ? `om.applyTemplate(${str(a.outputModule)});` : ''}
om.file = new File(${jsxPath(out)});
${a.start !== undefined ? `it.timeSpanStart = ${num(a.start, { min: 0, name: 'start' })};` : ''}
${a.duration !== undefined ? `it.timeSpanDuration = ${num(a.duration, { min: 0.01, name: 'duration' })};` : ''}
${a.frame !== undefined ? `it.timeSpanStart = ${num(a.frame, { min: 0, name: 'frame' })}; it.timeSpanDuration = c.frameDuration;` : ''}
${a.preRender ? 'it.outputModule(1).postRenderAction = PostRenderAction.IMPORT_AND_REPLACE_USAGE;' : ''}
__result__ = __queue();`, { undo: 'Queue render' }));
        },
    },
    {
        name: 'render_queue',
        description: 'Render every queued item in After Effects (blocks until done; raise AFTEREFFECTS_SCRIPT_TIMEOUT_MS for long renders), or send the queue to Adobe Media Encoder',
        inputSchema: {
            type: 'object',
            properties: { mediaEncoder: { type: 'boolean', description: 'Queue in Adobe Media Encoder instead. Default false', default: false }, startEncoding: { type: 'boolean', description: 'Media Encoder: start encoding at once. Default true', default: true } },
        },
        hints: { openWorld: false },
        features: ['aftereffects.render_export.render', 'aftereffects.render_export.queue_in_ame', 'aftereffects.render_export.add_to_adobe_media_encoder_queue'],
        handler: (a) => run('Render', script(`${QUEUE}
var rq = proj.renderQueue;
if (rq.numItems === 0) throw new Error("The Render Queue is empty: queue_render first");
${a.mediaEncoder ? `if (!rq.canQueueInAME) throw new Error("Adobe Media Encoder is not available"); rq.queueInAME(${bool(a.startEncoding ?? true)});` : 'rq.render();'}
__result__ = __queue();`)),
    },
    {
        name: 'manage_render_queue',
        description: 'Read the Render Queue, or remove, duplicate (Edit > Duplicate in the Render Queue panel), or turn items on and off for rendering',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'remove', 'duplicate', 'enable', 'disable', 'clear'], description: 'list, remove, duplicate (copies go to the end of the queue), enable, disable, or clear the whole queue' },
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, description: '1-based queue indexes' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        features: ['aftereffects.render_export.render_item', 'aftereffects.render_export.render_item_status', 'aftereffects.render_export.remove_render_item', 'aftereffects.render_export.duplicate_render_item'],
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'remove', 'duplicate', 'enable', 'disable', 'clear'], { name: 'action' });
            if (['remove', 'duplicate', 'enable', 'disable'].includes(action) && !(Array.isArray(a.items) && a.items.length)) throw new Error(`'${action}' needs items`);
            const ids = json((a.items ?? []).map((i) => Number(index(i, { name: 'items' }))).sort((x, y) => y - x));
            return run('Render queue', script(`${QUEUE}
var rq = proj.renderQueue, ids = ${ids};
${action === 'clear' ? 'for (var c = rq.numItems; c >= 1; c--) rq.item(c).remove();' : ''}
for (var x = 0; x < ids.length; x++) if (ids[x] > rq.numItems) throw new Error("Render item " + ids[x] + " does not exist; the Render Queue has " + rq.numItems);
${action === 'remove' ? 'for (var r = 0; r < ids.length; r++) rq.item(ids[r]).remove();' : ''}
${action === 'duplicate' ? 'for (var d = ids.length - 1; d >= 0; d--) rq.item(ids[d]).duplicate();' : ''}
${action === 'enable' || action === 'disable' ? `for (var e = 0; e < ids.length; e++) rq.item(ids[e]).render = ${action === 'enable'};` : ''}
__result__ = __queue();`, action === 'list' ? {} : { undo: 'Render queue' }));
        },
    },
    {
        name: 'get_render_item',
        description: 'Read Render Queue items in full (Render Queue panel): status, start and elapsed render time, log level, notification, time span, every render setting and every output module\'s format, file, file name template, post-render action and settings, by the names set_render_settings and set_output_module accept',
        inputSchema: {
            type: 'object',
            properties: { items: { type: 'array', items: { type: 'integer', minimum: 1 }, description: '1-based queue indexes; omit for every item' } },
        },
        hints: { readOnly: true },
        features: [
            'aftereffects.render_export.render_progress_info',
            'aftereffects.render_export.output_module_settings',
            'aftereffects.render_export.file_naming_templates',
        ],
        handler: (a) => {
            const ids = a.items === undefined ? null : itemIndexes(a.items);
            return run('Read render items', script(`${ITEM}
var rq = proj.renderQueue, ids = ${json(ids)}, out = [];
if (ids === null) { ids = []; for (var n = 1; n <= rq.numItems; n++) ids.push(n); }
for (var i = 0; i < ids.length; i++) {
  var it = __rqItem(ids[i]), info = __itemSettings(it, ids[i]), oms = [];
  for (var o = 1; o <= it.numOutputModules; o++) oms.push(__omInfo(it, o));
  info.outputModules = oms;
  out.push(info);
}
__result__ = { rendering: rq.rendering, queueNotify: rq.queueNotify, items: out };`));
        },
    },
    {
        name: 'set_render_settings',
        description: 'Change Render Queue items\' render settings (Render Settings dialog): apply a template (Best Settings, Draft Settings, DV Settings, Multi-Machine Settings or your own), set quality, resolution, disk cache, proxies, effects, solo switches, guide layers, colour depth, frame blending, field rendering, 3:2 pulldown, motion blur, time span, frame rate and Skip Existing Files, the log level and the completion notification, and optionally save the result as a template',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, description: '1-based queue indexes' },
                template: { type: 'string', description: 'Render settings template applied first, e.g. "Best Settings", "Draft Settings", "DV Settings", "Multi-Machine Settings" (list_render_templates lists them)' },
                ...Object.fromEntries(Object.entries(RENDER_OPTIONS).map(([k, [key, values]]) => [k, { type: 'string', description: `"${key}": ${values}` }])),
                frameRate: { description: 'Frame rate: a number of frames per second, or "comp" for the composition\'s rate', oneOf: [{ type: 'number', minimum: 0.01, maximum: 999 }, { type: 'string', enum: ['comp'] }] },
                skipExistingFiles: { type: 'boolean', description: 'Skip frames already in the output folder, so several computers can render one image sequence' },
                start: { type: 'number', minimum: 0, description: 'Custom time span start, seconds' },
                duration: { type: 'number', minimum: 0.01, description: 'Custom time span duration, seconds' },
                skipFrames: { type: 'integer', minimum: 0, maximum: 99, description: 'Frames to skip between rendered frames for quick tests; 1 renders on twos' },
                logType: { type: 'string', enum: Object.keys(LOG_TYPES), description: 'Log: errors only, plus settings, or plus per-frame information' },
                notify: { type: 'boolean', description: 'Send a Creative Cloud notification when this item finishes (the Notify checkbox)' },
                settings: SETTINGS_SCHEMA,
                saveAsTemplate: { type: 'string', description: 'Save the first item\'s resulting render settings as a template with this name' },
            },
            required: ['items'],
        },
        hints: { idempotent: true },
        auditArgs: { items: [1], template: 'Best Settings', quality: 'Best', frameRate: 25, settings: { 'Color Depth': '16 bits per channel' }, saveAsTemplate: undefined },
        features: [
            'aftereffects.render_export.render_settings',
            'aftereffects.render_export.render_settings_templates',
            'aftereffects.render_export.render_settings_option.quality',
            'aftereffects.render_export.render_settings_option.resolution',
            'aftereffects.render_export.render_settings_option.disk_cache',
            'aftereffects.render_export.render_settings_option.proxy_use',
            'aftereffects.render_export.render_settings_option.effects',
            'aftereffects.render_export.render_settings_option.solo_switches',
            'aftereffects.render_export.render_settings_option.guide_layers',
            'aftereffects.render_export.render_settings_option.color_depth',
            'aftereffects.render_export.render_settings_option.frame_blending',
            'aftereffects.render_export.render_settings_option.field_render',
            'aftereffects.render_export.render_settings_option.n3_2_pulldown',
            'aftereffects.render_export.render_settings_option.motion_blur',
            'aftereffects.render_export.render_settings_option.time_span',
            'aftereffects.render_export.render_settings_option.frame_rate',
            'aftereffects.render_export.render_settings_option.skip_existing_files',
            'aftereffects.render_export.render_settings_template.best_settings',
            'aftereffects.render_export.render_settings_template.draft_settings',
            'aftereffects.render_export.render_settings_template.dv_settings',
            'aftereffects.render_export.render_settings_template.multi_machine_settings',
            'aftereffects.render_export.render_log',
            'aftereffects.render_export.render_notifications',
            'aftereffects.render_export.render_farm_sequences',
            'aftereffects.render_export.convert_movies',
        ],
        handler: (a) => {
            const ids = itemIndexes(a.items);
            const wanted = settingsObject(a.settings, 'settings');
            for (const [k, [key]] of Object.entries(RENDER_OPTIONS)) {
                if (a[k] === undefined) continue;
                if (typeof a[k] !== 'string' || !a[k].trim()) throw new Error(`'${k}' must be one of the dialog's choices: ${RENDER_OPTIONS[k][1]}`);
                wanted[key] = a[k];
            }
            if (a.frameRate !== undefined) {
                if (a.frameRate === 'comp') wanted['Frame Rate'] = "Use comp's frame rate";
                else {
                    wanted['Frame Rate'] = 'Use this frame rate';
                    wanted['Use this frame rate'] = Number(num(a.frameRate, { min: 0.01, max: 999, name: 'frameRate' }));
                }
            }
            if (a.skipExistingFiles !== undefined) wanted['Skip Existing Files'] = Boolean(a.skipExistingFiles);
            const log = a.logType === undefined ? null : LOG_TYPES[enumOf(a.logType, Object.keys(LOG_TYPES), { name: 'logType' })];
            const lines = [];
            if (a.template !== undefined) lines.push(`if (!__inList(it.templates, ${str(a.template)})) throw new Error("No render settings template " + ${str(a.template)} + "; templates: " + it.templates.join(", "));`, `it.applyTemplate(${str(a.template)});`);
            if (Object.keys(wanted).length) lines.push('__setAll(it, wanted, "Render item " + ids[i]);');
            if (a.start !== undefined) lines.push(`it.timeSpanStart = ${num(a.start, { min: 0, name: 'start' })};`);
            if (a.duration !== undefined) lines.push(`it.timeSpanDuration = ${num(a.duration, { min: 0.01, name: 'duration' })};`);
            if (a.skipFrames !== undefined) lines.push(`it.skipFrames = ${index(a.skipFrames, { name: 'skipFrames', max: 99 })};`);
            if (log) lines.push(`it.logType = LogType.${log};`);
            if (a.notify !== undefined) lines.push(`it.queueItemNotify = ${bool(a.notify)};`);
            if (a.saveAsTemplate !== undefined) {
                if (!String(a.saveAsTemplate).trim()) throw new Error("'saveAsTemplate' needs a name");
                lines.push(`if (i === 0) it.saveAsTemplate(${str(a.saveAsTemplate)});`);
            }
            if (!lines.length) throw new Error('Give a template or at least one setting');
            return run('Render settings', script(`${ITEM}
var ids = ${json(ids)}, wanted = ${json(wanted)}, out = [];
for (var i = 0; i < ids.length; i++) {
  var it = __rqItem(ids[i]);
  if (it.status === RQItemStatus.RENDERING) throw new Error("Render item " + ids[i] + " is rendering");
  ${lines.join('\n  ')}
  out.push(__itemSettings(it, ids[i]));
}
__result__ = { items: out };`, { undo: 'Render settings' }));
        },
    },
    {
        name: 'set_output_module',
        description: 'Change, add or remove a Render Queue item\'s output module (Output Module Settings dialog, Composition > Add Output Module): template or output format (QuickTime, AVI, H.264, image sequences such as PNG, TIFF, JPEG, OpenEXR, DPX, Targa, Photoshop, SGI, IFF, Radiance, or audio as AIFF, MP3, WAV), output file and file name template, channels, depth, colour, starting frame number, resize, crop, audio output, project link, source XMP metadata and post-render action, and optionally save it as a template. Codecs such as GoPro CineForm are chosen through a template made in Edit > Templates > Output Module',
        inputSchema: {
            type: 'object',
            properties: {
                item: { type: 'integer', minimum: 1, description: '1-based Render Queue index' },
                outputModule: { type: 'integer', minimum: 1, description: '1-based output module of the item. Default 1' },
                add: { type: 'boolean', description: 'Add a new output module to the item and change that one (Composition > Add Output Module). Default false', default: false },
                remove: { type: 'boolean', description: 'Remove the output module (the item keeps at least one). Default false', default: false },
                template: { type: 'string', description: 'Output module template, e.g. "High Quality", "Lossless", "H.264 - Match Render Settings - 15 Mbps" (list_render_templates lists them)' },
                format: { type: 'string', enum: Object.keys(FORMATS), description: 'Output format: applies the first output module template that writes it' },
                outputFile: { type: 'string', description: 'Absolute output path. For image sequences include frame-number signs, e.g. frame_[#####].png' },
                fileTemplate: { type: 'string', description: 'File name template from the Output To menu, e.g. "[compName]_[#####].[fileExtension]"' },
                channels: { type: 'string', description: '"Channels": RGB, Alpha or RGB + Alpha' },
                depth: { type: 'string', description: '"Depth", e.g. Millions of Colors, Millions of Colors+, Trillions of Colors, Floating Point' },
                color: { type: 'string', description: '"Color": Premultiplied (Matted) or Straight (Unmatted)' },
                startingNumber: { type: 'integer', minimum: 0, description: 'First frame number of an image sequence ("Starting #"); turns off Use Comp Frame Number' },
                useCompFrameNumber: { type: 'boolean', description: 'Number sequence frames from the composition\'s frame numbers' },
                resize: {
                    type: 'object',
                    description: 'Resize the output',
                    properties: {
                        width: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels' },
                        height: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels' },
                        lockAspectRatio: { type: 'boolean', description: 'Lock the aspect ratio' },
                        quality: { type: 'string', description: '"Resize Quality": Low or High' },
                        enabled: { type: 'boolean', description: 'false turns resizing off. Default true' },
                    },
                },
                crop: {
                    type: 'object',
                    description: 'Crop pixels from the edges (negative values add pixels)',
                    properties: {
                        top: { type: 'integer', minimum: -30000, maximum: 30000 },
                        left: { type: 'integer', minimum: -30000, maximum: 30000 },
                        bottom: { type: 'integer', minimum: -30000, maximum: 30000 },
                        right: { type: 'integer', minimum: -30000, maximum: 30000 },
                        enabled: { type: 'boolean', description: 'false turns cropping off. Default true' },
                    },
                },
                audio: {
                    type: 'object',
                    description: 'Audio output',
                    properties: {
                        output: { type: 'string', description: '"Output Audio": On, Off or Auto' },
                        sampleRate: { type: ['number', 'string'], description: '"Audio Sample Rate", e.g. 48000' },
                        sampleDepth: { type: 'string', description: '"Audio Bit Depth", e.g. 16 Bit' },
                        channels: { type: 'string', description: '"Audio Channels": Mono or Stereo' },
                    },
                },
                includeProjectLink: { type: 'boolean', description: 'Embed a link back to the After Effects project' },
                includeSourceXmp: { type: 'boolean', description: 'Copy XMP metadata from the source footage into the output' },
                postRenderAction: { type: 'string', enum: Object.keys(POST_RENDER), description: 'After rendering: nothing, import the file, import it and replace the composition\'s uses, or set it as the composition\'s proxy' },
                settings: SETTINGS_SCHEMA,
                saveAsTemplate: { type: 'string', description: 'Save the resulting output module as a template with this name' },
            },
            required: ['item'],
        },
        hints: { destructive: true },
        auditArgs: {
            item: 1, outputModule: 1, add: false, remove: false, template: undefined, format: 'png', outputFile: `${process.env.HOME ?? '/tmp'}/Documents/frames/frame_[#####].png`,
            fileTemplate: '[compName]_[#####].[fileExtension]', startingNumber: 1, resize: { width: 960, height: 540, lockAspectRatio: true }, crop: { top: 10 },
            audio: { output: 'Off' }, postRenderAction: 'import', settings: { Channels: 'RGB + Alpha' }, saveAsTemplate: undefined,
        },
        features: [
            'aftereffects.render_export.output_module_settings',
            'aftereffects.render_export.output_module_templates',
            'aftereffects.render_export.output_to',
            'aftereffects.render_export.add_output_module',
            'aftereffects.render_export.file_naming_templates',
            'aftereffects.render_export.post_render_actions',
            'aftereffects.render_export.render_image_sequence',
            'aftereffects.render_export.h264_export',
            'aftereffects.render_export.gopro_cineform',
            'aftereffects.render_export.output_module_option.format',
            'aftereffects.render_export.output_module_option.include_project_link',
            'aftereffects.render_export.output_module_option.include_source_xmp_metadata',
            'aftereffects.render_export.output_module_option.post_render_action',
            'aftereffects.render_export.output_module_option.channels',
            'aftereffects.render_export.output_module_option.depth',
            'aftereffects.render_export.output_module_option.color',
            'aftereffects.render_export.output_module_option.starting',
            'aftereffects.render_export.output_module_option.resize',
            'aftereffects.render_export.output_module_option.crop',
            'aftereffects.render_export.output_module_option.audio_output',
            'aftereffects.render_export.output_format.quicktime_mov',
            'aftereffects.render_export.output_format.video_for_windows_avi',
            'aftereffects.render_export.output_format.h_264',
            'aftereffects.render_export.output_format.adobe_photoshop_psd_sequence',
            'aftereffects.render_export.output_format.cineon_dpx',
            'aftereffects.render_export.output_format.maya_iff',
            'aftereffects.render_export.output_format.jpeg',
            'aftereffects.render_export.output_format.openexr',
            'aftereffects.render_export.output_format.png',
            'aftereffects.render_export.output_format.radiance',
            'aftereffects.render_export.output_format.sgi',
            'aftereffects.render_export.output_format.targa',
            'aftereffects.render_export.output_format.tiff',
            'aftereffects.render_export.output_format.aiff',
            'aftereffects.render_export.output_format.mp3',
            'aftereffects.render_export.output_format.wav',
        ],
        handler: (a) => {
            const item = Number(index(a.item, { name: 'item', max: 10000 }));
            if (item < 1) throw new Error("'item' is 1-based");
            const o = a.outputModule === undefined ? 1 : Number(index(a.outputModule, { name: 'outputModule', max: 100 }));
            if (o < 1) throw new Error("'outputModule' is 1-based");
            if (a.add && a.outputModule !== undefined) throw new Error("'add' makes a new output module: leave out outputModule");
            if (a.template !== undefined && a.format !== undefined) throw new Error('Give template or format, not both');
            const changes = ['template', 'format', 'outputFile', 'fileTemplate', 'channels', 'depth', 'color', 'startingNumber', 'useCompFrameNumber', 'resize', 'crop', 'audio', 'includeProjectLink', 'includeSourceXmp', 'postRenderAction', 'settings', 'saveAsTemplate'].filter((k) => a[k] !== undefined);
            if (a.remove) {
                if (a.add || changes.length) throw new Error("'remove' cannot be combined with other changes");
                return run('Remove output module', script(`${ITEM}
var it = __rqItem(${item}), o = ${o};
if (o > it.numOutputModules) throw new Error("Render item ${item} has " + it.numOutputModules + " output module(s)");
if (it.numOutputModules < 2) throw new Error("A render item keeps at least one output module");
it.outputModule(o).remove();
var oms = [];
for (var m = 1; m <= it.numOutputModules; m++) oms.push(__omInfo(it, m));
__result__ = { item: ${item}, outputModules: oms };`, { undo: 'Remove output module' }));
            }
            if (!a.add && !changes.length) throw new Error('Give at least one change, add: true or remove: true');
            const wanted = settingsObject(a.settings, 'settings');
            const text = (k, key) => {
                if (a[k] === undefined) return;
                if (typeof a[k] !== 'string' || !a[k].trim()) throw new Error(`'${k}' must be text`);
                wanted[key] = a[k];
            };
            text('channels', 'Channels');
            text('depth', 'Depth');
            text('color', 'Color');
            if (a.fileTemplate !== undefined) {
                if (typeof a.fileTemplate !== 'string' || !a.fileTemplate.trim()) throw new Error("'fileTemplate' must be text");
                wanted['Output File Info'] = { ...(wanted['Output File Info'] ?? {}), 'File Template': a.fileTemplate };
            }
            if (a.startingNumber !== undefined) {
                wanted['Starting #'] = Number(index(a.startingNumber, { name: 'startingNumber', max: 1e9 }));
                if (a.useCompFrameNumber === undefined) wanted['Use Comp Frame Number'] = false;
            }
            if (a.useCompFrameNumber !== undefined) wanted['Use Comp Frame Number'] = Boolean(a.useCompFrameNumber);
            if (a.includeProjectLink !== undefined) wanted['Include Project Link'] = Boolean(a.includeProjectLink);
            let resize = null;
            if (a.resize !== undefined) {
                const r = a.resize ?? {};
                if (r.enabled === false) wanted.Resize = false;
                else {
                    if (r.width === undefined || r.height === undefined) throw new Error("'resize' needs width and height");
                    wanted.Resize = true;
                    resize = { width: Number(num(r.width, { min: 1, max: 30000, name: 'resize.width' })), height: Number(num(r.height, { min: 1, max: 30000, name: 'resize.height' })) };
                    if (r.lockAspectRatio !== undefined) wanted['Lock Aspect Ratio'] = Boolean(r.lockAspectRatio);
                    if (r.quality !== undefined) wanted['Resize Quality'] = String(r.quality);
                }
            }
            if (a.crop !== undefined) {
                const c = a.crop ?? {};
                wanted.Crop = c.enabled !== false;
                for (const [k, key] of [['top', 'Crop Top'], ['left', 'Crop Left'], ['bottom', 'Crop Bottom'], ['right', 'Crop Right']]) {
                    if (c[k] !== undefined) wanted[key] = Number(num(c[k], { min: -30000, max: 30000, name: `crop.${k}` }));
                }
            }
            if (a.audio !== undefined) {
                const au = a.audio ?? {};
                for (const [k, key] of [['output', 'Output Audio'], ['sampleRate', 'Audio Sample Rate'], ['sampleDepth', 'Audio Bit Depth'], ['channels', 'Audio Channels']]) {
                    if (au[k] === undefined) continue;
                    if (typeof au[k] === 'number') wanted[key] = Number(num(au[k], { min: 1, max: 1e6, name: `audio.${k}` }));
                    else wanted[key] = String(au[k]);
                }
            }
            const format = a.format === undefined ? null : FORMATS[enumOf(a.format, Object.keys(FORMATS), { name: 'format' })];
            const post = a.postRenderAction === undefined ? null : POST_RENDER[enumOf(a.postRenderAction, Object.keys(POST_RENDER), { name: 'postRenderAction' })];
            const out = a.outputFile === undefined ? null : paths.validate(a.outputFile);
            if (a.saveAsTemplate !== undefined && !String(a.saveAsTemplate).trim()) throw new Error("'saveAsTemplate' needs a name");
            // After setSettings an OutputModule reference can go stale, so each step fetches it again.
            return run('Output module', script(`${ITEM}${format ? FORMAT_TEMPLATE : ''}
var it = __rqItem(${item}), o = ${o}, wanted = ${json(wanted)};
${a.add ? 'it.outputModules.add(); o = it.numOutputModules;' : `if (o > it.numOutputModules) throw new Error("Render item ${item} has " + it.numOutputModules + " output module(s)");`}
${a.template !== undefined ? `if (!__inList(it.outputModule(o).templates, ${str(a.template)})) throw new Error("No output module template " + ${str(a.template)} + "; templates: " + it.outputModule(o).templates.join(", "));
it.outputModule(o).applyTemplate(${str(a.template)});` : ''}
${format ? `it.outputModule(o).applyTemplate(__templateFor(new RegExp(${str(format[1])}, "i"), ${str(format[0])}));` : ''}
${resize ? `var rt = it.outputModule(o).getSettings(GetSettingsFormat.STRING_SETTABLE)["Resize to"], to = {}, wk = "x", hk = "y";
if (rt && typeof rt === "object") for (var k in rt) if (rt.hasOwnProperty(k)) { if (/^(x|w)/i.test(k)) wk = k; else if (/^(y|h)/i.test(k)) hk = k; }
to[wk] = ${resize.width}; to[hk] = ${resize.height}; wanted["Resize to"] = to;` : ''}
var any = false; for (var w in wanted) if (wanted.hasOwnProperty(w)) any = true;
if (any) __setAll(it.outputModule(o), wanted, "Output module " + o);
${post ? `it.outputModule(o).postRenderAction = PostRenderAction.${post};` : ''}
${a.includeSourceXmp !== undefined ? `it.outputModule(o).includeSourceXMP = ${bool(a.includeSourceXmp)};` : ''}
${out ? `it.outputModule(o).file = new File(${jsxPath(out)});` : ''}
${a.saveAsTemplate !== undefined ? `it.outputModule(o).saveAsTemplate(${str(a.saveAsTemplate)});` : ''}
var info = __omInfo(it, o); info.item = ${item};
__result__ = info;`, { undo: 'Output module' }));
        },
    },
    {
        name: 'control_render_queue',
        description: 'Show or hide the Render Queue panel (Window > Render Queue), pause, continue or stop a render in progress, turn the whole-queue completion notification on or off, and read progress: each item\'s status, start time and elapsed time',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['status', 'pause', 'continue', 'stop', 'show_panel', 'hide_panel'], description: 'Default status. pause, continue and stop act on the render in progress', default: 'status' },
                notify: { type: 'boolean', description: 'Send a Creative Cloud notification when the whole queue finishes' },
            },
        },
        features: [
            'aftereffects.render_export.render_queue_panel',
            'aftereffects.render_export.render_progress_info',
            'aftereffects.render_export.render_notifications',
            'aftereffects.render_export.pause_rendering',
            'aftereffects.render_export.stop_rendering',
        ],
        handler: (a) => {
            const action = enumOf(a.action ?? 'status', ['status', 'pause', 'continue', 'stop', 'show_panel', 'hide_panel'], { name: 'action' });
            const step = {
                status: '',
                pause: 'if (!rq.rendering) throw new Error("Nothing is rendering"); rq.pauseRendering(true);',
                continue: 'if (!rq.rendering) throw new Error("Nothing is rendering"); rq.pauseRendering(false);',
                stop: 'if (!rq.rendering) throw new Error("Nothing is rendering"); rq.stopRendering();',
                show_panel: 'rq.showWindow(true);',
                hide_panel: 'rq.showWindow(false);',
            }[action];
            return run('Render queue control', script(`
var rq = proj.renderQueue, out = [];
${step}
${a.notify !== undefined ? `rq.queueNotify = ${bool(a.notify)};` : ''}
for (var i = 1; i <= rq.numItems; i++) {
  var it = rq.item(i);
  out.push({ index: i, comp: it.comp.name, status: __enumName(it.status), render: it.render, notify: it.queueItemNotify, startTime: it.startTime ? String(it.startTime) : null, elapsedSeconds: it.elapsedSeconds });
}
__result__ = { action: ${str(action)}, rendering: rq.rendering, queueNotify: rq.queueNotify, items: out };`));
        },
    },
    {
        name: 'configure_render_engine',
        description: 'Turn Multi-Frame Rendering on or off with a CPU limit for the next render, start, pause, continue or end Watch Folder mode (File > Watch Folder: After Effects then renders projects saved into the folder and stops taking other work), and report whether this After Effects is a render-only engine',
        inputSchema: {
            type: 'object',
            properties: {
                multiFrameRendering: { type: 'boolean', description: 'Use Multi-Frame Rendering' },
                maxCpuPercent: { type: 'integer', minimum: 1, maximum: 100, description: 'Most CPU Multi-Frame Rendering may use, 1-100. Default 100' },
                watchFolder: { type: 'string', enum: ['start', 'pause', 'continue', 'end'], description: 'Watch Folder mode' },
                folder: { type: 'string', description: 'start: absolute path of the folder to watch' },
            },
        },
        auditArgs: { multiFrameRendering: true, maxCpuPercent: 80, watchFolder: 'start', folder: `${process.env.HOME ?? '/tmp'}/Documents/watch` },
        features: [
            'aftereffects.render_export.multi_frame_rendering',
            'aftereffects.render_export.watch_folder',
            'aftereffects.render_export.render_only_engine',
        ],
        handler: (a) => {
            if (a.maxCpuPercent !== undefined && a.multiFrameRendering === undefined) throw new Error("'maxCpuPercent' goes with multiFrameRendering");
            const wf = a.watchFolder === undefined ? null : enumOf(a.watchFolder, ['start', 'pause', 'continue', 'end'], { name: 'watchFolder' });
            if (wf === 'start' && !a.folder) throw new Error("Watch Folder 'start' needs folder");
            if (a.folder !== undefined && wf !== 'start') throw new Error("'folder' goes with watchFolder: 'start'");
            const dir = wf === 'start' ? paths.validate(a.folder) : null;
            const pct = a.multiFrameRendering ? num(a.maxCpuPercent ?? 100, { min: 1, max: 100, name: 'maxCpuPercent' }) : '100';
            // app.watchFolder() does not return until Watch Folder mode ends, so it is scheduled to start after this call returns.
            return run('Render engine', script(`
${a.multiFrameRendering !== undefined ? `app.setMultiFrameRenderingConfig(${bool(a.multiFrameRendering)}, ${pct});` : ''}
${dir ? `var wf = new Folder(${jsxPath(dir)});
if (!wf.exists) throw new Error("Folder not found: " + wf.fsName);
app.scheduleTask("app.watchFolder(new Folder(" + __json(wf.fsName) + "))", 500, false);` : ''}
${wf === 'pause' ? 'app.pauseWatchFolder(true);' : ''}
${wf === 'continue' ? 'app.pauseWatchFolder(false);' : ''}
${wf === 'end' ? 'app.endWatchFolder();' : ''}
__result__ = { isRenderEngine: app.isRenderEngine, isWatchFolder: app.isWatchFolder, watchFolderStarting: ${bool(Boolean(dir))}${a.multiFrameRendering !== undefined ? `, multiFrameRendering: ${bool(a.multiFrameRendering)}, maxCpuPercent: ${pct}` : ''} };`));
        },
    },
];
