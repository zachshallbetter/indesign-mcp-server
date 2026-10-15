/**
 * Composition edits: compositions from footage, Composition menu and work-area
 * commands, and composition and layer markers.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec } from '../args.js';
import { SELECT_ONLY, AT_SCHEMA, atTime } from './layer-edits.js';

/** Composition commands: menu command id, or null where the object model does it. */
const COMP_COMMANDS = {
    trim_to_work_area: 2360,
    crop_to_region_of_interest: 2997,
    set_poster_time: 2012,
    lift_work_area: 2613,
    extract_work_area: 2614,
    show_flowchart: 2258,
    work_area_to_layers: null,
    reveal_in_project: null,
};
const MARKER_ACTIONS = ['list', 'add', 'update', 'remove', 'remove_all', 'go_to', 'update_from_source'];

const COMP_INFO = `
var info = __itemInfo(c);
info.workAreaStart = c.workAreaStart; info.workAreaDuration = c.workAreaDuration; info.time = c.time;
__result__ = info;`;

export const tools = [
    {
        name: 'create_comp_from_items',
        description: 'Make compositions from footage or compositions in the Project panel (File > New Comp from Selection): one per item, or one holding them all, sized and timed from an item, optionally with the layers in sequence and added to the Render Queue',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 200, description: 'Project item ids (from list_items)' },
                mode: { type: 'string', enum: ['each', 'single'], description: 'each: one composition per item (the default); single: one composition with every item as a layer, the first on top' },
                name: { type: 'string', description: 'single: the composition name; default the first item\'s name' },
                useDimensionsFrom: { type: 'integer', minimum: 1, description: 'single: the item id whose size and frame rate the composition takes; default the first item' },
                stillDuration: { type: 'number', minimum: 0.01, maximum: 10800, description: 'Seconds for still images. Default 5', default: 5 },
                sequenceLayers: { type: 'boolean', description: 'single: place the layers one after another in time' },
                overlap: { type: 'number', minimum: 0, maximum: 3600, description: 'sequenceLayers: seconds each layer overlaps the one before' },
                addToRenderQueue: { type: 'boolean', description: 'Add each new composition to the Render Queue' },
            },
            required: ['items'],
        },
        auditArgs: { mode: 'single', useDimensionsFrom: undefined, overlap: 0.5 },
        features: ['aftereffects.compositions.new_comp_from_selection'],
        handler: (a) => {
            if (!Array.isArray(a.items) || !a.items.length || a.items.length > 200) throw new Error("'items' lists 1 to 200 project item ids");
            const ids = a.items.map((v) => Number(index(v, { name: 'items' })));
            const mode = enumOf(a.mode ?? 'each', ['each', 'single'], { name: 'mode' });
            const still = num(a.stillDuration ?? 5, { min: 0.01, max: 10800, name: 'stillDuration' });
            const overlap = a.sequenceLayers ? num(a.overlap ?? 0, { min: 0, max: 3600, name: 'overlap' }) : '0';
            const dims = a.useDimensionsFrom !== undefined ? index(a.useDimensionsFrom, { name: 'useDimensionsFrom' }) : 'null';
            return run('New comp from selection', script(`
var ids = ${json(ids)}, items = [], made = [], still = ${still}, overlap = ${overlap}, i;
for (i = 0; i < ids.length; i++) {
  var it = proj.itemByID(ids[i]);
  if (!(it instanceof AVItem)) throw new Error("Item " + ids[i] + " is not footage or a composition");
  if (!it.hasVideo || !it.width) throw new Error(it.name + " has no picture to size a composition from");
  items.push(it);
}
var __len = function (it) { return it.duration > 0 ? it.duration : still; };
var __make = function (name, from, list, sequence) {
  var dur = 0, j;
  for (j = 0; j < list.length; j++) dur = sequence ? dur + __len(list[j]) - (j ? overlap : 0) : Math.max(dur, __len(list[j]));
  var fr = (from.frameRate > 0) ? from.frameRate : 30;
  var nc = proj.items.addComp(name, from.width, from.height, from.pixelAspect, Math.max(dur, 1 / fr), fr);
  for (j = list.length - 1; j >= 0; j--) { if (list[j].duration > 0) nc.layers.add(list[j]); else nc.layers.add(list[j], still); }
  if (sequence) { var t = 0; for (j = 1; j <= nc.numLayers; j++) { var l = nc.layer(j); l.startTime = t; t += (l.outPoint - l.inPoint) - overlap; } }
  ${a.addToRenderQueue ? 'proj.renderQueue.items.add(nc);' : ''}
  made.push(__itemInfo(nc));
};
${mode === 'single' ? `var from = items[0], dimsId = ${dims};
if (dimsId !== null) { from = null; for (i = 0; i < items.length; i++) if (items[i].id === dimsId) from = items[i]; if (!from) throw new Error("useDimensionsFrom must be one of the items"); }
__make(${a.name !== undefined ? str(a.name) : 'items[0].name'}, from, items, ${bool(a.sequenceLayers)});`
        : 'for (i = 0; i < items.length; i++) __make(items[i].name, items[i], [items[i]], false);'}
__result__ = { compositions: made };`, { undo: 'New comp from selection' }));
        },
    },
    {
        name: 'run_comp_command',
        description: 'Composition and work-area commands: Trim Comp to Work Area, Crop Comp to Region of Interest (needs a region drawn in the Composition panel), Set Poster Time, Lift Work Area and Extract Work Area (on the given layers, or all), set the work area to the layers\' span, Composition Flowchart, and Reveal Composition in Project. The menu commands make the composition active',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                action: { type: 'string', enum: Object.keys(COMP_COMMANDS), description: 'The command' },
                layers: { ...LAYERS_SCHEMA, description: 'lift_work_area, extract_work_area and work_area_to_layers: the layers (default all; for work_area_to_layers the selection, else the whole composition). ' + LAYERS_SCHEMA.description },
                time: { type: 'number', minimum: 0, description: 'set_poster_time: seconds; default the current time' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        auditArgs: { action: 'lift_work_area', time: undefined },
        features: [
            'aftereffects.compositions.trim_comp_to_work_area',
            'aftereffects.compositions.crop_comp_to_region_of_interest',
            'aftereffects.compositions.set_poster_time',
            'aftereffects.compositions.lift_work_area',
            'aftereffects.compositions.extract_work_area',
            'aftereffects.compositions.work_area_to_selected_layers',
            'aftereffects.compositions.composition_flowchart',
            'aftereffects.compositions.reveal_composition_in_project',
        ],
        handler: (a) => {
            const action = enumOf(a.action, Object.keys(COMP_COMMANDS), { name: 'action' });
            const given = a.layers ? `__layers(c, ${layerSpec(a.layers)})` : null;
            let body;
            if (action === 'work_area_to_layers') {
                body = `var ls = ${given ?? 'c.selectedLayers'}, s = 0, e = c.duration, i;
if (ls.length) { s = ls[0].inPoint; e = ls[0].outPoint; for (i = 1; i < ls.length; i++) { s = Math.min(s, ls[i].inPoint); e = Math.max(e, ls[i].outPoint); } }
s = Math.max(0, s); e = Math.min(c.duration, e);
if (e - s < c.frameDuration) throw new Error("The layers do not overlap the composition's duration");
c.workAreaDuration = c.frameDuration;
c.workAreaStart = s;
c.workAreaDuration = e - s;`;
            } else if (action === 'reveal_in_project') {
                body = 'for (var i = 1; i <= proj.numItems; i++) proj.item(i).selected = false;\nc.selected = true;';
            } else {
                const select = ['lift_work_area', 'extract_work_area'].includes(action) ? (given ?? '[]') : null;
                body = `${SELECT_ONLY}
${select ? `__selectOnly(c, ${select});` : 'c.openInViewer();\nif (!proj.activeItem || proj.activeItem.id !== c.id) throw new Error("Could not make " + c.name + " the active composition");'}
${action === 'set_poster_time' && a.time !== undefined ? `c.time = ${num(a.time, { min: 0, name: 'time' })};` : ''}
app.executeCommand(${COMP_COMMANDS[action]});`;
            }
            return run('Composition command', script(`
var c = __comp(${compSpec(a.comp)});
${body}
${COMP_INFO}`, { undo: 'Composition command' }));
        },
    },
    {
        name: 'edit_markers',
        description: 'Composition and layer markers (Layer > Add Marker, the Marker dialog): list, add (or set a numbered composition marker 0-9), edit comment, duration, chapter, web link, cue point, label and protected region, remove one or all, move the current time to a marker, or Update Markers From Source. Give layers for layer markers; omit them for composition markers',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'Layer markers on these layers; omit for composition markers. ' + LAYERS_SCHEMA.description },
                action: { type: 'string', enum: MARKER_ACTIONS, description: 'list, add, update, remove, remove_all, go_to, update_from_source (layers whose source has markers)' },
                at: { ...AT_SCHEMA, description: 'add: where to put the marker; update, remove, go_to: the marker at this time. ' + AT_SCHEMA.description },
                marker: { type: 'integer', minimum: 1, description: 'update, remove, go_to: the marker\'s number in time order (1 = first), instead of at' },
                number: { type: 'integer', minimum: 0, maximum: 9, description: 'Composition markers: the numbered marker 0-9 (add moves it if it exists; update, remove, go_to find it)' },
                comment: { type: 'string' },
                duration: { type: 'number', minimum: 0, description: 'Seconds' },
                chapter: { type: 'string' },
                url: { type: 'string', description: 'Web link' },
                frameTarget: { type: 'string', description: 'Web link frame target' },
                cuePointName: { type: 'string' },
                eventCuePoint: { type: 'boolean', description: 'Cue point type: true event, false navigation' },
                parameters: { type: 'object', additionalProperties: { type: 'string' }, description: 'Cue point parameters, name to value' },
                label: { type: 'integer', minimum: 0, maximum: 16, description: 'Label colour (0 none)' },
                protectedRegion: { type: 'boolean', description: 'Protected region (composition markers with a duration)' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        auditArgs: { action: 'add', layers: undefined, at: 2, marker: undefined, number: 3, parameters: { speed: 'fast' } },
        features: [
            'aftereffects.compositions.add_layer_marker',
            'aftereffects.compositions.marker_dialog',
            'aftereffects.compositions.numbered_comp_marker',
            'aftereffects.compositions.go_to_comp_marker',
            'aftereffects.compositions.remove_marker',
            'aftereffects.compositions.delete_all_markers',
            'aftereffects.compositions.marker_cue_point',
            'aftereffects.compositions.marker_label',
            'aftereffects.compositions.update_markers_from_source',
        ],
        handler: (a) => {
            const action = enumOf(a.action, MARKER_ACTIONS, { name: 'action' });
            const onLayers = a.layers !== undefined;
            if (a.number !== undefined && onLayers) throw new Error("'number' is for composition markers; omit layers");
            if (action === 'update_from_source' && !onLayers) throw new Error("update_from_source needs 'layers'");
            const nmb = a.number !== undefined ? index(a.number, { name: 'number', max: 9 }) : 'null';
            const mk = a.marker !== undefined ? index(a.marker, { name: 'marker', max: 100000 }) : 'null';
            const set = [];
            if (a.comment !== undefined) set.push(`mv.comment = ${str(a.comment)};`);
            else if (action === 'add' && a.number !== undefined) set.push(`mv.comment = "${nmb}";`);
            if (a.duration !== undefined) set.push(`mv.duration = ${num(a.duration, { min: 0, name: 'duration' })};`);
            for (const k of ['chapter', 'url', 'frameTarget', 'cuePointName']) if (a[k] !== undefined) set.push(`mv.${k} = ${str(a[k])};`);
            for (const k of ['eventCuePoint', 'protectedRegion']) if (a[k] !== undefined) set.push(`mv.${k} = ${bool(a[k])};`);
            if (a.label !== undefined) set.push(`mv.label = ${index(a.label, { name: 'label', max: 16 })};`);
            if (a.parameters !== undefined) {
                if (!a.parameters || typeof a.parameters !== 'object' || Array.isArray(a.parameters)) throw new Error("'parameters' is an object of names to values");
                set.push(`mv.setParameters(${json(Object.fromEntries(Object.entries(a.parameters).map(([k, v]) => [String(k), String(v)])))});`);
            }
            if (action === 'update' && !set.length) throw new Error('Give a marker field to change');
            const body = {
                list: 'for (k = 1; k <= p.numKeys; k++) found.push(__mInfo(p, k));',
                add: `if (wanted !== null) for (k = p.numKeys; k >= 1; k--) if (p.keyValue(k).comment === String(wanted)) p.removeKey(k);
var mv = new MarkerValue("");
${set.join('\n')}
p.setValueAtTime(t, mv);
found.push(__mInfo(p, p.nearestKeyIndex(t)));`,
                update: `k = __find(p);
var mv = p.keyValue(k);
${set.join('\n')}
p.setValueAtKey(k, mv);
found.push(__mInfo(p, k));`,
                remove: 'k = __find(p);\nfound.push(__mInfo(p, k));\np.removeKey(k);',
                remove_all: 'for (k = p.numKeys; k >= 1; k--) { found.push(__mInfo(p, k)); p.removeKey(k); }',
                go_to: 'k = __find(p);\nc.time = p.keyTime(k);\nfound.push(__mInfo(p, k));',
                update_from_source: 'for (k = 1; k <= p.numKeys; k++) found.push(__mInfo(p, k));',
            }[action];
            return run('Edit markers', script(`
var c = __comp(${compSpec(a.comp)}), t = ${atTime(a.at)}, wanted = ${nmb}, which = ${mk}, targets = [], out = [], k, j;
${onLayers ? `var ls = __layers(c, ${layerSpec(a.layers)});
for (j = 0; j < ls.length; j++) targets.push({ name: ls[j].name, index: ls[j].index, marker: ls[j].property("ADBE Marker") });` : 'targets.push({ name: c.name, index: 0, marker: c.markerProperty });'}
${action === 'update_from_source' ? `${SELECT_ONLY}
__selectOnly(c, ls);
app.executeCommand(2539);` : ''}
var __mInfo = function (p, k) {
  var m = p.keyValue(k);
  return { marker: k, time: p.keyTime(k), comment: m.comment, duration: m.duration, chapter: m.chapter, url: m.url, frameTarget: m.frameTarget,
    cuePointName: m.cuePointName, eventCuePoint: m.eventCuePoint, parameters: m.getParameters(), label: m.label, protectedRegion: m.protectedRegion };
};
var __find = function (p) {
  var n = p.numKeys, i;
  if (which !== null) { if (which > n) throw new Error("There are only " + n + " markers"); return which; }
  if (wanted !== null) { for (i = 1; i <= n; i++) if (p.keyValue(i).comment === String(wanted)) return i; throw new Error("No composition marker " + wanted); }
  if (n) { i = p.nearestKeyIndex(t); if (Math.abs(p.keyTime(i) - t) < c.frameDuration / 2) return i; }
  throw new Error("No marker at " + t + " seconds");
};
for (j = 0; j < targets.length; j++) {
  var p = targets[j].marker, found = [];
  ${body}
  out.push({ target: targets[j].name, layer: targets[j].index || null, markers: found, count: p.numKeys });
}
__result__ = { time: c.time, results: out };`, { undo: 'Edit markers' }));
        },
    },
];
