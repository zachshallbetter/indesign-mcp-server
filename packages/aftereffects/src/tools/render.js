/**
 * Rendering: queue compositions with render settings and output module
 * templates, render the queue, send it to Adobe Media Encoder, and read status.
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

export const tools = [
    {
        name: 'list_render_templates',
        description: 'List the render settings and output module templates (Edit > Templates) available for queueing',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: [],
        handler: () => run('List render templates', script(`
var c = proj.items.addComp("__templates", 4, 4, 1, 1, 1), rq = proj.renderQueue.items.add(c);
try { __result__ = { renderSettings: rq.templates, outputModules: rq.outputModule(1).templates }; }
finally { rq.remove(); c.remove(); }`, { undo: 'List render templates' })),
    },
    {
        name: 'queue_render',
        description: 'Add a composition to the Render Queue with a render settings template, an output module template and an output file, optionally only the work area or a time span',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                outputFile: { type: 'string', description: 'Absolute output path; the extension should match the output module' },
                renderSettings: { type: 'string', description: 'Render settings template, e.g. "Best Settings"' },
                outputModule: { type: 'string', description: 'Output module template, e.g. "High Quality", "H.264 - Match Render Settings - 15 Mbps"' },
                start: { type: 'number', minimum: 0, description: 'Seconds' },
                duration: { type: 'number', minimum: 0.01, description: 'Seconds' },
            },
            required: ['outputFile'],
        },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/render.mov`, renderSettings: 'Best Settings', outputModule: 'High Quality' },
        features: [],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            return run('Queue render', script(`${QUEUE}
var c = __comp(${compSpec(a.comp)}), it = proj.renderQueue.items.add(c);
${a.renderSettings ? `it.applyTemplate(${str(a.renderSettings)});` : ''}
var om = it.outputModule(1);
${a.outputModule ? `om.applyTemplate(${str(a.outputModule)});` : ''}
om.file = new File(${jsxPath(out)});
${a.start !== undefined ? `it.timeSpanStart = ${num(a.start, { min: 0, name: 'start' })};` : ''}
${a.duration !== undefined ? `it.timeSpanDuration = ${num(a.duration, { min: 0.01, name: 'duration' })};` : ''}
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
        features: [],
        handler: (a) => run('Render', script(`${QUEUE}
var rq = proj.renderQueue;
if (rq.numItems === 0) throw new Error("The Render Queue is empty: queue_render first");
${a.mediaEncoder ? `if (!rq.canQueueInAME) throw new Error("Adobe Media Encoder is not available"); rq.queueInAME(${bool(a.startEncoding ?? true)});` : 'rq.render();'}
__result__ = __queue();`)),
    },
    {
        name: 'manage_render_queue',
        description: 'Read the Render Queue, or remove items, or turn items on and off for rendering',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'remove', 'enable', 'disable', 'clear'] },
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, description: '1-based queue indexes' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        features: [],
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'remove', 'enable', 'disable', 'clear'], { name: 'action' });
            if (['remove', 'enable', 'disable'].includes(action) && !(Array.isArray(a.items) && a.items.length)) throw new Error(`'${action}' needs items`);
            const ids = json((a.items ?? []).map((i) => Number(index(i, { name: 'items' }))).sort((x, y) => y - x));
            return run('Render queue', script(`${QUEUE}
var rq = proj.renderQueue, ids = ${ids};
${action === 'clear' ? 'for (var c = rq.numItems; c >= 1; c--) rq.item(c).remove();' : ''}
${action === 'remove' ? 'for (var r = 0; r < ids.length; r++) rq.item(ids[r]).remove();' : ''}
${action === 'enable' || action === 'disable' ? `for (var e = 0; e < ids.length; e++) rq.item(ids[e]).render = ${action === 'enable'};` : ''}
__result__ = __queue();`, action === 'list' ? {} : { undo: 'Render queue' }));
        },
    },
];

