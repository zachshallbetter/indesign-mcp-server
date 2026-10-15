/**
 * Shared argument schemas and their conversion to safe script values.
 *
 * Compositions are chosen by item id, name, or the active composition.
 * Layers are chosen by 1-based index (After Effects' own numbering), name, or
 * the selected layers. Properties are named by a path of match names or display
 * names, or a shortcut for the common transform properties. Colours are
 * "#RRGGBB" or "rgb(r,g,b)" (0-255); scripts receive [r, g, b] from 0 to 1.
 */
import { json, num } from 'adobe-mcp-core';

export const COMP_SCHEMA = {
    type: 'object',
    description: 'Which composition. Give its item id (from list_items) or name; omit for the active composition',
    properties: {
        id: { type: 'integer', description: 'Project item id' },
        name: { type: 'string', description: 'Composition name' },
    },
};

export const LAYERS_SCHEMA = {
    type: 'object',
    description: 'Which layers. Give indexes (1-based, from list_layers), names, or selected: true',
    properties: {
        indexes: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Layer indexes, 1 = top' },
        names: { type: 'array', items: { type: 'string' }, description: 'Layer names' },
        selected: { type: 'boolean', description: 'Use the selected layers' },
    },
};

export const COLOR_SCHEMA = { type: 'string', description: '"#RRGGBB" or "rgb(r,g,b)" (0-255)' };

/** Shortcuts for common properties, as match-name paths from the layer. */
export const PROPERTY_SHORTCUTS = {
    anchor_point: ['ADBE Transform Group', 'ADBE Anchor Point'],
    position: ['ADBE Transform Group', 'ADBE Position'],
    scale: ['ADBE Transform Group', 'ADBE Scale'],
    rotation: ['ADBE Transform Group', 'ADBE Rotate Z'],
    opacity: ['ADBE Transform Group', 'ADBE Opacity'],
    x_rotation: ['ADBE Transform Group', 'ADBE Rotate X'],
    y_rotation: ['ADBE Transform Group', 'ADBE Rotate Y'],
    orientation: ['ADBE Transform Group', 'ADBE Orientation'],
    source_text: ['ADBE Text Properties', 'ADBE Text Document'],
    time_remap: ['ADBE Time Remapping'],
    audio_levels: ['ADBE Audio Group', 'ADBE Audio Levels'],
};

export const PROPERTY_SCHEMA = {
    description: `A property: a shortcut (${Object.keys(PROPERTY_SHORTCUTS).join(', ')}) or a path of match names or display names from the layer, e.g. ["ADBE Effect Parade", "Gaussian Blur", "Blurriness"]`,
    oneOf: [
        { type: 'string', enum: Object.keys(PROPERTY_SHORTCUTS) },
        { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
    ],
};

/** A composition spec as a JSX literal for __comp(). */
export function compSpec(comp) {
    const c = comp ?? {};
    if (c.id !== undefined) return json({ id: Number(num(c.id, { min: 1, name: 'comp.id' })) });
    if (c.name !== undefined) return json({ name: String(c.name) });
    return json({});
}

/** A layer spec as a JSX literal for __layers(). */
export function layerSpec(layers) {
    const l = layers ?? {};
    const out = {};
    if (Array.isArray(l.indexes) && l.indexes.length) out.indexes = l.indexes.map((i) => Number(num(i, { min: 1, max: 10000, name: 'layers.indexes' })));
    if (Array.isArray(l.names) && l.names.length) out.names = l.names.map(String);
    if (l.selected) out.selected = true;
    if (!out.indexes && !out.names && !out.selected) throw new Error('Choose the layers: layers.indexes, layers.names, or layers.selected: true');
    return json(out);
}

/** A property path as a JSX literal array of names. */
export function propertyPath(value, name = 'property') {
    if (typeof value === 'string') {
        const path = PROPERTY_SHORTCUTS[value];
        if (!path) throw new Error(`'${name}': unknown shortcut ${value}. Shortcuts: ${Object.keys(PROPERTY_SHORTCUTS).join(', ')}`);
        return json(path);
    }
    if (!Array.isArray(value) || !value.length || value.length > 12) throw new Error(`'${name}' must be a shortcut or a path of 1 to 12 names`);
    return json(value.map((v) => String(v)));
}

/** A colour as a JSX [r, g, b] literal in 0..1. */
export function colorValue(value, name = 'color') {
    const v = String(value ?? '').trim();
    let rgb;
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
        const m = /^rgb\(\s*([\d.\s,]+)\)$/i.exec(v);
        if (!m) throw new Error(`'${name}': use "#RRGGBB" or "rgb(r,g,b)"`);
        rgb = m[1].split(',').map((p) => Number(num(p.trim(), { min: 0, max: 255, name })));
        if (rgb.length !== 3) throw new Error(`'${name}': rgb() takes 3 values`);
    }
    return json(rgb.map((c) => Math.round((c / 255) * 10000) / 10000));
}

/** A JSON value for a property (number, array of numbers, string, boolean), checked. */
export function propertyValue(value, name = 'value') {
    const ok = (v) => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean';
    if (Array.isArray(value)) {
        if (!value.length || value.length > 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error(`'${name}': an array value holds 1 to 4 numbers`);
        return json(value);
    }
    if (!ok(value)) throw new Error(`'${name}' must be a number, an array of numbers, text or true/false`);
    return json(value);
}
