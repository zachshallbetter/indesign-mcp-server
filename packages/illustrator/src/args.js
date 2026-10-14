/**
 * Shared argument schemas and their conversion to safe script values.
 *
 * Colours are strings, the way designers write them:
 *   "#FF6600", "rgb(255,102,0)", "cmyk(0,60,100,0)", "gray(40)", "none",
 *   or the name of a swatch in the document.
 * Items are chosen by id (PageItem.uuid), by name, or as the current selection.
 */
import { json, num } from 'adobe-mcp-core';

export const COLOR_SCHEMA = {
    type: 'string',
    description: 'A swatch name, "#RRGGBB", "rgb(r,g,b)" (0-255), "cmyk(c,m,y,k)" (0-100), "gray(g)" (0-100, 100 = black) or "none"',
};

export const TARGET_SCHEMA = {
    type: 'object',
    description: 'Which items to act on. Give ids (from list_items or a create tool), names, or selection: true',
    properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Item ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Item names (every item with each name)' },
        selection: { type: 'boolean', description: 'Use the current selection' },
    },
};

export const ARTBOARD_SCHEMA = {
    type: 'integer',
    minimum: 0,
    description: 'Artboard index (0-based). Positions are measured from this artboard\'s top-left corner. Default 0',
};

/** A parsed colour as a JSX literal for __color(). Throws on anything unrecognised. */
export function colorSpec(value, name = 'color') {
    if (value === undefined || value === null || value === '') return null;
    const v = String(value).trim();
    if (/^none$/i.test(v)) return json({ kind: 'none' });
    let m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return json({ kind: 'rgb', v: [(n >> 16) & 255, (n >> 8) & 255, n & 255] });
    }
    m = v.match(/^(rgb|cmyk|gray)\(\s*([\d.\s,]+)\)$/i);
    if (m) {
        const kind = m[1].toLowerCase();
        const parts = m[2].split(',').map((s) => s.trim());
        const want = { rgb: 3, cmyk: 4, gray: 1 }[kind];
        if (parts.length !== want) throw new Error(`'${name}': ${kind}() takes ${want} value(s): ${v}`);
        const max = kind === 'rgb' ? 255 : 100;
        return json({ kind, v: parts.map((p) => Number(num(p, { min: 0, max, name }))) });
    }
    if (v.length > 200) throw new Error(`'${name}': swatch name too long`);
    return json({ kind: 'swatch', name: v });
}

/** A target spec as a JSX literal for __targets(). */
export function targetSpec(target) {
    const t = target ?? {};
    const out = {};
    if (Array.isArray(t.ids) && t.ids.length) out.ids = t.ids.map(String);
    if (Array.isArray(t.names) && t.names.length) out.names = t.names.map(String);
    if (t.selection) out.selection = true;
    if (!out.ids && !out.names && !out.selection) {
        throw new Error("Choose the items: target.ids, target.names, or target.selection: true");
    }
    return json(out);
}
