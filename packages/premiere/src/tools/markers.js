/**
 * Markers on a sequence or on a clip project item: list, add, edit (name,
 * comments, type, duration, colour, position) and remove.
 */
import { json, str, enumOf, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, sequenceSpec, itemSpec, seconds } from '../args.js';

export const MARKER_TYPES = ['Comment', 'Chapter', 'WebLink', 'FLVCuePoint'];
export const MARKER_COLORS = ['green', 'red', 'magenta', 'orange', 'yellow', 'blue', 'cyan'];

const OWNER_PROPS = {
    sequence: { ...SEQUENCE_SCHEMA, description: 'Markers of this sequence (default: the active sequence)' },
    item: { ...ITEM_SCHEMA, description: 'Markers of this clip project item instead of a sequence' },
};

/** Script lines that set `markers` (a Markers object) and `owner` (its name). */
function ownerLines(a) {
    if (a.item !== undefined && a.sequence !== undefined) throw new Error('Give sequence or item, not both');
    if (a.item !== undefined) {
        return `const ownerEntry = await __item(project, ${itemSpec(a.item)});
const owner = __clipItem(ownerEntry);
const ownerName = ownerEntry.path;`;
    }
    return `const owner = await __sequence(project, ${sequenceSpec(a.sequence)});
const ownerName = owner.name;`;
}

const MARKER_HELPERS = `
const markers = await ppro.Markers.getMarkers(owner);
if (!markers) throw new Error("Premiere Pro returned no markers for " + ownerName);
const all = () => markers.getMarkers() || [];
const info = (m, i) => ({
  index: i, name: m.getName(), type: m.getType(), start: __s(m.getStart()), duration: __s(m.getDuration()),
  comments: m.getComments(), colorIndex: m.getColorIndex(), guid: m.guid ? __id(m.guid) : null, url: m.getUrl(), target: m.getTarget(),
});
const colorIndex = (name) => {
  const colors = __C.MarkerColor;
  // MAGENTA from 26.5; earlier versions spell it MAGNETA.
  const value = name === "MAGENTA" ? (colors.MAGENTA !== undefined ? colors.MAGENTA : colors.MAGNETA) : colors[name];
  if (value === undefined) throw new Error("Premiere Pro has no marker colour " + name);
  return value;
};
const pick = (spec) => {
  const list = all();
  if (spec.guid !== undefined) {
    const hit = list.find((m) => m.guid && __id(m.guid) === spec.guid);
    if (!hit) throw new Error("No marker with guid " + spec.guid);
    return hit;
  }
  if (spec.index >= list.length) throw new Error(ownerName + " has " + list.length + " marker" + (list.length === 1 ? "" : "s") + "; index " + spec.index + " does not exist (list_markers shows them)");
  return list[spec.index];
};`;

function markerSpec(a) {
    if (a.guid !== undefined) return json({ guid: String(a.guid) });
    if (a.index !== undefined) return json({ index: Number(index(a.index, { name: 'index' })) });
    throw new Error('Choose the marker: index (from list_markers) or guid');
}

const colorName = (c) => enumOf(String(c).toLowerCase(), MARKER_COLORS, { name: 'color' }).toUpperCase();

export const tools = [
    {
        name: 'list_markers',
        description: 'List the markers of a sequence or of a clip project item: index, name, type, start, duration, comments, colour index, guid (Premiere Pro 26.3 or later) and web link',
        inputSchema: {
            type: 'object',
            properties: { ...OWNER_PROPS, type: { type: 'string', enum: MARKER_TYPES, description: 'Only markers of this type' } },
        },
        auditArgs: { sequence: { name: 'Main edit' }, item: undefined },
        hints: { readOnly: true },
        features: ['premiere.markers.marker_object', 'premiere.markers.sequence_markers', 'premiere.markers.clip_markers', 'premiere.markers.marker_types', 'premiere.markers.markers_panel'],
        handler: (a) => run('List markers', script(`
const project = await __project();
${ownerLines(a)}
${MARKER_HELPERS}
const type = ${a.type === undefined ? 'null' : str(enumOf(a.type, MARKER_TYPES, { name: 'type' }))};
const out = all().map(info).filter((m) => type === null || m.type === type);
return { owner: ownerName, count: out.length, markers: out };`)),
    },
    {
        name: 'add_marker',
        description: 'Add a marker to a sequence or a clip project item at a time, with a name, type, duration, comments and colour. The colour is a second undo step',
        inputSchema: {
            type: 'object',
            properties: {
                ...OWNER_PROPS,
                start: { type: 'number', minimum: 0, description: 'Seconds' },
                name: { type: 'string', default: '' },
                type: { type: 'string', enum: MARKER_TYPES, description: 'Default Comment', default: 'Comment' },
                duration: { type: 'number', minimum: 0, description: 'Seconds; 0 for a point marker. Default 0', default: 0 },
                comments: { type: 'string', default: '' },
                color: { type: 'string', enum: MARKER_COLORS },
            },
            required: ['start'],
        },
        auditArgs: { item: undefined, start: 3.5, name: 'Applause', duration: 2, comments: 'Cut here', color: 'magenta' },
        features: ['premiere.markers.add_marker', 'premiere.markers.sequence_markers', 'premiere.markers.clip_markers', 'premiere.markers.marker_types', 'premiere.markers.marker_colors', 'premiere.markers.marker_dialog'],
        handler: (a) => {
            const start = seconds(a.start, 'start');
            const duration = seconds(a.duration ?? 0, 'duration');
            const type = enumOf(a.type ?? 'Comment', MARKER_TYPES, { name: 'type' });
            const color = a.color === undefined ? null : colorName(a.color);
            return run('Add marker', script(`
const project = await __project();
${ownerLines(a)}
${MARKER_HELPERS}
const before = new Set(all().map((m) => m.getName() + "@" + __s(m.getStart())));
transact(project, "Add marker", (add) => add(markers.createAddMarkerAction(${str(a.name ?? '')}, ${str(type)}, __t(${start}), __t(${duration}), ${str(a.comments ?? '')})));
const list = all();
let i = list.findIndex((m) => !before.has(m.getName() + "@" + __s(m.getStart())));
if (i < 0) i = list.findIndex((m) => m.getName() === ${str(a.name ?? '')} && Math.abs(__s(m.getStart()) - ${start}) < 0.001);
if (i < 0) throw new Error("The marker was added but could not be found again");
${color ? `transact(project, "Marker colour", (add) => add(list[i].createSetColorByIndexAction(colorIndex(${str(color)}))));` : ''}
return { owner: ownerName, marker: info(all()[i], i) };`));
        },
    },
    {
        name: 'edit_marker',
        description: 'Change a marker chosen by index (from list_markers) or guid: name, comments, type, duration, colour, or move it to a new start. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                ...OWNER_PROPS,
                index: { type: 'integer', minimum: 0, description: 'Marker index from list_markers' },
                guid: { type: 'string', description: 'Marker guid (26.3 or later)' },
                name: { type: 'string' },
                comments: { type: 'string' },
                type: { type: 'string', enum: MARKER_TYPES },
                duration: { type: 'number', minimum: 0, description: 'Seconds' },
                color: { type: 'string', enum: MARKER_COLORS },
                start: { type: 'number', minimum: 0, description: 'Move the marker here, seconds' },
            },
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, sequence: undefined, guid: undefined, index: 1, name: 'Chorus', start: 8 },
        hints: { idempotent: true },
        features: ['premiere.markers.marker_dialog', 'premiere.markers.move_markers', 'premiere.markers.marker_colors', 'premiere.markers.marker_types'],
        handler: (a) => {
            const spec = markerSpec(a);
            const lines = [];
            if (a.name !== undefined) lines.push(`add(m.createSetNameAction(${str(a.name)}));`);
            if (a.comments !== undefined) lines.push(`add(m.createSetCommentsAction(${str(a.comments)}));`);
            if (a.type !== undefined) lines.push(`add(m.createSetTypeAction(${str(enumOf(a.type, MARKER_TYPES, { name: 'type' }))}));`);
            if (a.duration !== undefined) lines.push(`add(m.createSetDurationAction(__t(${seconds(a.duration, 'duration')})));`);
            if (a.color !== undefined) lines.push(`add(m.createSetColorByIndexAction(colorIndex(${str(colorName(a.color))})));`);
            if (a.start !== undefined) lines.push(`add(markers.createMoveMarkerAction(m, __t(${seconds(a.start, 'start')})));`);
            if (!lines.length) throw new Error('Nothing to change: give name, comments, type, duration, color or start');
            return run('Edit marker', script(`
const project = await __project();
${ownerLines(a)}
${MARKER_HELPERS}
const m = pick(${spec});
transact(project, "Edit marker", (add) => {
  ${lines.join('\n  ')}
});
const list = all();
const i = list.indexOf(m);
return { owner: ownerName, marker: info(i >= 0 ? list[i] : m, i) };`));
        },
    },
    {
        name: 'remove_markers',
        description: 'Remove markers from a sequence or clip project item, chosen by index or guid, or all of them (optionally of one type). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                ...OWNER_PROPS,
                indexes: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Marker indexes from list_markers' },
                guids: { type: 'array', items: { type: 'string' }, description: 'Marker guids' },
                all: { type: 'boolean', description: 'Remove every marker (of type, if given)', default: false },
                type: { type: 'string', enum: MARKER_TYPES, description: 'With all: only this type' },
            },
        },
        auditArgs: { item: undefined, indexes: [0, 2], guids: undefined, all: false, type: undefined },
        hints: { destructive: true },
        features: ['premiere.markers.clear_selected_marker', 'premiere.markers.sequence_markers', 'premiere.markers.clip_markers'],
        handler: (a) => {
            const indexes = (a.indexes ?? []).map((i) => Number(index(i, { name: 'indexes' })));
            const guids = (a.guids ?? []).map(String);
            if (!a.all && !indexes.length && !guids.length) throw new Error('Choose the markers: indexes, guids, or all: true');
            if (a.all && (indexes.length || guids.length)) throw new Error('all cannot be combined with indexes or guids');
            const type = a.type === undefined ? null : enumOf(a.type, MARKER_TYPES, { name: 'type' });
            return run('Remove markers', script(`
const project = await __project();
${ownerLines(a)}
${MARKER_HELPERS}
const list = all();
const indexes = ${json(indexes)}, guids = ${json(guids)}, type = ${type === null ? 'null' : str(type)};
for (const i of indexes) if (i >= list.length) throw new Error(ownerName + " has " + list.length + " markers; index " + i + " does not exist");
const doomed = list.filter((m, i) => ${a.all ? '(type === null || m.getType() === type)' : 'indexes.includes(i) || (m.guid && guids.includes(__id(m.guid)))'});
if (guids.length && doomed.filter((m) => m.guid && guids.includes(__id(m.guid))).length < guids.length) throw new Error("Some guids match no marker");
const removed = doomed.map((m) => info(m, list.indexOf(m)));
if (doomed.length) transact(project, "Remove markers", (add) => { for (const m of doomed) add(markers.createRemoveMarkerAction(m)); });
return { owner: ownerName, removed: removed.length, markers: removed };`));
        },
    },
];
