/**
 * Canonical parameter names and the older names and values tools still accept.
 *
 * Every tool advertises one name per concept (strokeWeight, fontName, itemIndex)
 * and InDesign's Justification names for alignment. Callers written against
 * earlier versions keep working: normalizeArgs() maps the old names onto the
 * canonical ones before a handler runs, so an alias produces exactly the
 * script the canonical name does. Old names are not in the advertised schemas.
 */
import { allToolDefinitions } from '../types/index.js';
import { enumOf, ALLOWED } from '../utils/stringUtils.js';

/** Old parameter name -> canonical name. Applied only to tools that take the canonical name. */
export const PARAM_ALIASES = {
    strokeWidth: 'strokeWeight',
    fontFamily: 'fontName',
    objectIndex: 'itemIndex',
};

/** Old alignment values (create_text_frame / edit_text_frame before 2.2) -> Justification names. */
export const ALIGNMENT_ALIASES = {
    LEFT: 'LEFT_ALIGN',
    CENTER: 'CENTER_ALIGN',
    RIGHT: 'RIGHT_ALIGN',
    JUSTIFY: 'LEFT_JUSTIFIED',
};

const has = (v) => v !== undefined && v !== null && v !== '';
const schemas = new Map(allToolDefinitions.map((t) => [t.name, t.inputSchema?.properties ?? {}]));

/** Justification member for an alignment value (canonical or alias, any case). */
export function justificationOf(alignment) {
    const v = String(alignment).toUpperCase();
    return enumOf(ALIGNMENT_ALIASES[v] ?? v, ALLOWED.alignment, { name: 'alignment' });
}

/**
 * Map deprecated argument names and values onto the canonical ones for `tool`.
 * The canonical name wins when both are given. Returns a new object.
 */
export function normalizeArgs(tool, args) {
    const props = schemas.get(tool);
    if (!props || !args || typeof args !== 'object' || Array.isArray(args)) return args;
    const out = { ...args };

    for (const [old, canonical] of Object.entries(PARAM_ALIASES)) {
        if (!(old in out) || !(canonical in props) || old in props) continue;
        if (!has(out[canonical])) out[canonical] = out[old];
        delete out[old];
    }

    // fontFamily + fontStyle (create_master_text_frame before 2.2) -> "Family\tStyle"
    if ('fontName' in props && !('fontStyle' in props) && 'fontStyle' in out) {
        const family = has(out.fontName) ? String(out.fontName) : props.fontName.default;
        if (has(out.fontStyle) && has(family) && !/\t|\\t/.test(family)) out.fontName = `${family}\t${out.fontStyle}`;
        delete out.fontStyle;
    }

    if (props.alignment && typeof out.alignment === 'string') {
        const v = out.alignment.toUpperCase();
        out.alignment = ALIGNMENT_ALIASES[v] ?? v;
    }
    return out;
}
