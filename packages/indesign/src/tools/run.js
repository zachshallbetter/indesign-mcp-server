/**
 * Running a module tool's script and shaping its result.
 */
import { formatResponse, formatErrorResponse, json, num } from 'adobe-mcp-core';
import { ScriptExecutor } from '../core/scriptExecutor.js';

/**
 * Run a script built with script() and return a tool result; the script's
 * __result__ JSON is parsed into `result`.
 */
export async function run(operation, source) {
    const r = await ScriptExecutor.executeInDesignScriptStructured(source);
    if (!r.ok) return formatErrorResponse(r.error, operation);
    let value = r.result;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { /* a plain string result */ }
    }
    return formatResponse(value, operation);
}

/** Items chosen by id (PageItem.id), name, or the selection. */
export const TARGET_SCHEMA = {
    type: 'object',
    description: 'Which items to act on. Give ids (from list_page_items, or the id a create tool returns), names, or selection: true',
    properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Page item ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Item names (every item with each name)' },
        selection: { type: 'boolean', description: 'Use the current selection' },
    },
};

/** A target as a JSX literal for __targets(). */
export function targetSpec(target) {
    const t = target ?? {};
    const out = {};
    if (Array.isArray(t.ids) && t.ids.length) out.ids = t.ids.map((id) => Number(num(id, { min: 0, name: 'target.ids' })));
    if (Array.isArray(t.names) && t.names.length) out.names = t.names.map(String);
    if (t.selection) out.selection = true;
    if (!out.ids && !out.names && !out.selection) throw new Error('Choose the items: target.ids, target.names, or target.selection: true');
    return json(out);
}

export const COLOR_SCHEMA = { type: 'string', description: 'A swatch name in the document, or "#RRGGBB" (creates an RGB colour swatch)' };

/** A colour as a JSX literal for __swatch(). */
export function colorSpec(value, name = 'color') {
    const v = String(value ?? '').trim();
    if (!v) throw new Error(`'${name}' is empty`);
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return json({ kind: 'rgb', v: [(n >> 16) & 255, (n >> 8) & 255, n & 255] });
    }
    if (v.length > 200) throw new Error(`'${name}': swatch name too long`);
    return json({ kind: 'name', name: v });
}
