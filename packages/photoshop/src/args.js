/**
 * Shared argument schemas and their conversion to safe script values.
 *
 * Colours are strings, the way designers write them:
 *   "#FF6600", "rgb(255,102,0)", "cmyk(0,60,100,0)", "gray(40)",
 *   "hsb(24,100,100)", "lab(60,50,70)".
 * Layers are chosen by id (Layer.id), by name, or as the active layer.
 * Positions and sizes are pixels from the document's top-left corner.
 */
import { json, num } from 'adobe-mcp-core';

export const COLOR_SCHEMA = {
    type: 'string',
    description: '"#RRGGBB", "rgb(r,g,b)" (0-255), "cmyk(c,m,y,k)" (0-100), "gray(g)" (0-100, 100 = black), "hsb(h,s,b)" (0-360, 0-100, 0-100) or "lab(L,a,b)"',
};

export const TARGET_SCHEMA = {
    type: 'object',
    description: 'Which layers to act on. Give ids (from list_layers or a create tool), names, or active: true',
    properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Layer ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Layer names (every layer with each name)' },
        active: { type: 'boolean', description: 'Use the active layer' },
    },
};

export const RECT_SCHEMA = {
    type: 'object',
    description: 'A rectangle in pixels from the document\'s top-left corner',
    properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 } },
    required: ['x', 'y', 'width', 'height'],
};

const RANGES = { rgb: [3, 255], cmyk: [4, 100], gray: [1, 100], hsb: [3, null], lab: [3, null] };

/** A parsed colour as a JSX literal for __color(). Throws on anything unrecognised. */
export function colorSpec(value, name = 'color') {
    if (value === undefined || value === null || value === '') return null;
    const v = String(value).trim();
    let m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return json({ kind: 'rgb', v: [(n >> 16) & 255, (n >> 8) & 255, n & 255] });
    }
    m = v.match(/^(rgb|cmyk|gray|hsb|lab)\(\s*(-?[\d.\s,-]+)\)$/i);
    if (!m) throw new Error(`'${name}': not a colour: ${v}. Use "#RRGGBB", rgb(), cmyk(), gray(), hsb() or lab()`);
    const kind = m[1].toLowerCase();
    const parts = m[2].split(',').map((s) => s.trim());
    const [count, max] = RANGES[kind];
    if (parts.length !== count) throw new Error(`'${name}': ${kind}() takes ${count} value(s): ${v}`);
    const limits = kind === 'hsb' ? [[0, 360], [0, 100], [0, 100]] : kind === 'lab' ? [[0, 100], [-128, 127], [-128, 127]] : parts.map(() => [0, max]);
    return json({ kind, v: parts.map((p, i) => Number(num(p, { min: limits[i][0], max: limits[i][1], name }))) });
}

/** A layer target as a JSX literal for __targets(). */
export function targetSpec(target) {
    const t = target ?? {};
    const out = {};
    if (Array.isArray(t.ids) && t.ids.length) out.ids = t.ids.map((id) => Number(num(id, { min: 1, name: 'target.ids' })));
    if (Array.isArray(t.names) && t.names.length) out.names = t.names.map(String);
    if (t.active) out.active = true;
    if (!out.ids && !out.names && !out.active) throw new Error('Choose the layers: target.ids, target.names, or target.active: true');
    return json(out);
}

/** A rectangle as [left, top, right, bottom] pixel numbers, checked. */
export function rect(r, name = 'rect') {
    if (!r || typeof r !== 'object') throw new Error(`'${name}' must be { x, y, width, height }`);
    const x = Number(num(r.x, { name: `${name}.x` })), y = Number(num(r.y, { name: `${name}.y` }));
    const w = Number(num(r.width, { min: 0, name: `${name}.width` })), h = Number(num(r.height, { min: 0, name: `${name}.height` }));
    if (!w || !h) throw new Error(`'${name}' needs a width and height above 0`);
    return [x, y, x + w, y + h];
}
