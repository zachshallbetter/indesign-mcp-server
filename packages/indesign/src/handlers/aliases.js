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

/**
 * Old parameter names. Each applies to the tools that take its canonical name,
 * or only to `tools` when given.
 */
export const PARAM_ALIASES = [
    { old: 'strokeWidth', canonical: 'strokeWeight' },
    { old: 'fontFamily', canonical: 'fontName' },
    { old: 'objectIndex', canonical: 'itemIndex', tools: ['apply_color'] },
    { old: 'folderPath', canonical: 'outputPath', tools: ['export_images', 'package_document'] },
    { old: 'pageRange', canonical: 'pages', tools: ['export_images'] },
    { old: 'applyObjectStyle', canonical: 'objectStyle', tools: ['place_image'] },
    { old: 'transparency', canonical: 'opacity', tools: ['create_object_style'] },
];

/** Old alignment values (create_text_frame / edit_text_frame before 2.2) -> Justification names. */
export const ALIGNMENT_ALIASES = {
    LEFT: 'LEFT_ALIGN',
    CENTER: 'CENTER_ALIGN',
    RIGHT: 'RIGHT_ALIGN',
    JUSTIFY: 'LEFT_JUSTIFIED',
};

const has = (v) => v !== undefined && v !== null && v !== '';
const schemas = new Map(allToolDefinitions.map((t) => [t.name, t.inputSchema?.properties ?? {}]));

/** The aliases `tool` accepts: [{ old, canonical }]. */
export function aliasesFor(tool) {
    const props = schemas.get(tool) ?? {};
    return PARAM_ALIASES.filter((a) => a.canonical in props && !(a.old in props) && (!a.tools || a.tools.includes(tool)));
}

/** Justification member for an alignment value (canonical or alias, any case). */
export function justificationOf(alignment) {
    const v = String(alignment).toUpperCase();
    return enumOf(ALIGNMENT_ALIASES[v] ?? v, ALLOWED.alignment, { name: 'alignment' });
}

/**
 * Map deprecated argument names and values onto the canonical ones for `tool`.
 * The canonical name wins when both are given. Returns a new object; pushes a
 * deprecation note onto `warnings` for each alias it maps.
 */
export function normalizeArgs(tool, args, warnings = []) {
    const props = schemas.get(tool);
    if (!props || !args || typeof args !== 'object' || Array.isArray(args)) return args;
    const out = { ...args };

    for (const { old, canonical } of aliasesFor(tool)) {
        if (!(old in out)) continue;
        if (has(out[canonical])) {
            warnings.push(`'${old}' is deprecated and was ignored because '${canonical}' was also given`);
        } else {
            out[canonical] = out[old];
            warnings.push(`'${old}' is deprecated; use '${canonical}'`);
        }
        delete out[old];
    }

    // fontFamily + fontStyle (create_master_text_frame before 2.2) -> "Family\tStyle"
    if ('fontName' in props && !('fontStyle' in props) && 'fontStyle' in out) {
        const family = has(out.fontName) ? String(out.fontName) : props.fontName.default;
        if (has(out.fontStyle) && has(family) && !/\t|\\t/.test(family)) {
            out.fontName = `${family}\t${out.fontStyle}`;
            warnings.push(`'fontStyle' is deprecated; use fontName "${family.replace(/\t/g, '\\t')}\\t${out.fontStyle}"`);
        } else {
            warnings.push(`'fontStyle' is deprecated and was ignored because fontName already names a style`);
        }
        delete out.fontStyle;
    }

    if (props.alignment && typeof out.alignment === 'string') {
        const v = out.alignment.toUpperCase();
        if (ALIGNMENT_ALIASES[v]) warnings.push(`alignment "${out.alignment}" is deprecated; use "${ALIGNMENT_ALIASES[v]}"`);
        out.alignment = ALIGNMENT_ALIASES[v] ?? v;
    }
    return out;
}

/** Levenshtein distance, case-insensitive. */
function distance(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/** The advertised parameter `key` most likely meant, or null. */
function suggest(key, props) {
    const alias = PARAM_ALIASES.find((a) => a.old === key && a.canonical in props);
    if (alias) return alias.canonical;
    let best = null;
    let bestD = Infinity;
    for (const name of Object.keys(props)) {
        const d = distance(key, name);
        if (d < bestD) [best, bestD] = [name, d];
    }
    return best && bestD <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

/** One warning per argument `tool` does not take (run after normalizeArgs). */
export function unknownArgWarnings(tool, args) {
    const props = schemas.get(tool);
    if (!props || !args || typeof args !== 'object' || Array.isArray(args)) return [];
    return Object.keys(args)
        .filter((k) => !(k in props))
        .map((k) => {
            const s = suggest(k, props);
            return `Unknown parameter '${k}' was ignored${s ? `; did you mean '${s}'?` : ''}`;
        });
}

/** Add `warnings` to a tool result object when there are any. */
export function withWarnings(result, warnings) {
    if (!warnings.length || !result || typeof result !== 'object' || Array.isArray(result)) return result;
    return { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
}
