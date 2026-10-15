/**
 * Shared argument schemas and their conversion to safe script values.
 *
 * Sequences are chosen by name or guid, or default to the active sequence.
 * Project items by id (ProjectItem.getId), bin path ("Footage/Interviews/a.mov")
 * or name. Clips by track kind, track index and clip index, all from 0, as
 * list_clips reports them, or the clips selected in the Timeline. Times are
 * seconds. Every value reaches a script as a JSON literal.
 */
import { json, num, index } from 'adobe-mcp-core';

export const SEQUENCE_SCHEMA = {
    type: 'object',
    description: 'Which sequence. Give its name or guid (from list_sequences); omit for the active sequence',
    properties: {
        name: { type: 'string', description: 'Sequence name' },
        guid: { type: 'string', description: 'Sequence guid' },
    },
};

export const ITEM_SCHEMA = {
    type: 'object',
    description: 'A project item: its id (from list_project_items), its bin path such as "Footage/Interviews/a.mov", or its name when that is unique',
    properties: {
        id: { type: 'string', description: 'Project item id' },
        path: { type: 'string', description: 'Bin path, "/"-separated, from the project root' },
        name: { type: 'string', description: 'Item name, when only one item has it' },
    },
};

export const CLIP_SCHEMA = {
    type: 'object',
    description: 'A clip in the sequence, as list_clips reports it',
    properties: {
        track: { type: 'string', enum: ['video', 'audio'], description: 'Track kind' },
        trackIndex: { type: 'integer', minimum: 0, description: 'Track index, 0 = V1 or A1' },
        clipIndex: { type: 'integer', minimum: 0, description: 'Clip index on the track, 0 = first' },
    },
    required: ['track', 'trackIndex', 'clipIndex'],
};

export const CLIPS_SCHEMA = {
    type: 'object',
    description: 'Which clips: items (track, trackIndex, clipIndex from list_clips) and/or selected: true for the clips selected in the Timeline',
    properties: {
        items: { type: 'array', items: CLIP_SCHEMA, maxItems: 500 },
        selected: { type: 'boolean', description: 'Include the clips selected in the Timeline' },
    },
};

export const TIME_SCHEMA = { type: 'number', minimum: 0, description: 'Seconds' };

/** A literal sequence spec for __sequence(). */
export function sequenceSpec(sequence) {
    const s = sequence ?? {};
    if (s.guid !== undefined) return json({ guid: String(s.guid) });
    if (s.name !== undefined) return json({ name: String(s.name) });
    return json({});
}

/** A literal project item spec for __item(). */
export function itemSpec(item, name = 'item') {
    const i = item ?? {};
    if (i.id !== undefined) return json({ id: String(i.id) });
    if (i.path !== undefined) {
        const p = String(i.path).split('/').filter(Boolean).join('/');
        if (!p) throw new Error(`'${name}.path' is empty`);
        return json({ path: p });
    }
    if (i.name !== undefined) return json({ name: String(i.name) });
    throw new Error(`Choose the project item: '${name}' needs id, path or name`);
}

/** A literal list of item specs, each checked. */
export function itemSpecs(items, name = 'items') {
    if (items === undefined) return '[]';
    if (!Array.isArray(items)) throw new Error(`'${name}' must be a list`);
    return `[${items.map((i, n) => itemSpec(i, `${name}[${n}]`)).join(', ')}]`;
}

function clipRef(c, name) {
    if (!c || typeof c !== 'object') throw new Error(`'${name}' must be { track, trackIndex, clipIndex }`);
    if (c.track !== 'video' && c.track !== 'audio') throw new Error(`'${name}.track' must be "video" or "audio"`);
    return {
        track: c.track,
        trackIndex: Number(index(c.trackIndex, { name: `${name}.trackIndex`, max: 999 })),
        clipIndex: Number(index(c.clipIndex, { name: `${name}.clipIndex`, max: 100000 })),
    };
}

/** A literal clips spec for __clips(). */
export function clipsSpec(clips) {
    const c = clips ?? {};
    const items = Array.isArray(c.items) ? c.items.map((x, n) => clipRef(x, `clips.items[${n}]`)) : [];
    if (!items.length && !c.selected) throw new Error('Choose the clips: clips.items, or clips.selected: true');
    return json({ items, selected: Boolean(c.selected) });
}

/** A literal clips spec for one clip. */
export function clipSpec(clip, name = 'clip') {
    return json({ items: [clipRef(clip, name)], selected: false });
}

/** Seconds as a number literal. */
export function seconds(value, name, { min = 0, max = 864000 } = {}) {
    return num(value, { min, max, name });
}

/** A parameter value: number, text, true/false, { x, y } or { red, green, blue, alpha } (0 to 1). */
export function paramValue(value, name = 'value') {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`'${name}' must be a finite number`);
        return json(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return json(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('x' in value || 'y' in value) {
            return json({ x: Number(num(value.x, { name: `${name}.x` })), y: Number(num(value.y, { name: `${name}.y` })) });
        }
        if ('red' in value || 'green' in value || 'blue' in value) {
            const c = (k, d) => Number(num(value[k] ?? d, { min: 0, max: 1, name: `${name}.${k}` }));
            return json({ red: c('red'), green: c('green'), blue: c('blue'), alpha: c('alpha', 1) });
        }
    }
    throw new Error(`'${name}' must be a number, text, true/false, { x, y } or { red, green, blue, alpha } with channels from 0 to 1`);
}

export const PARAM_VALUE_SCHEMA = {
    description: 'A number, text, true/false, a point { x, y }, or a colour { red, green, blue, alpha } with channels from 0 to 1',
    oneOf: [
        { type: 'number' },
        { type: 'string' },
        { type: 'boolean' },
        { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        { type: 'object', properties: { red: { type: 'number' }, green: { type: 'number' }, blue: { type: 'number' }, alpha: { type: 'number' } }, required: ['red', 'green', 'blue'] },
    ],
};
