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
import { createArgNormalizer, withWarnings } from 'adobe-mcp-core';

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

/** Justification member for an alignment value (canonical or alias, any case). */
export function justificationOf(alignment) {
    const v = String(alignment).toUpperCase();
    return enumOf(ALIGNMENT_ALIASES[v] ?? v, ALLOWED.alignment, { name: 'alignment' });
}

/**
 * InDesign's value rewrites, run after old names are mapped:
 * fontFamily + fontStyle (create_master_text_frame before 2.2) become one
 * "Family\tStyle" fontName, and old alignment values become Justification names.
 */
function normalizeValues(tool, out, props, warnings) {
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
}

/** Shared by the server (src/core/InDesignMCPServer.js) and the tests. */
export const argNormalizer = createArgNormalizer({ tools: allToolDefinitions, aliases: PARAM_ALIASES, normalizeValues });

/** The aliases `tool` accepts: [{ old, canonical }]. */
export const aliasesFor = argNormalizer.aliasesFor;

/**
 * Map deprecated argument names and values onto the canonical ones for `tool`.
 * The canonical name wins when both are given. Returns a new object; pushes a
 * deprecation note onto `warnings` for each alias it maps.
 */
export const normalizeArgs = argNormalizer.normalizeArgs;

/** One warning per argument `tool` does not take (run after normalizeArgs). */
export const unknownArgWarnings = argNormalizer.unknownArgWarnings;

export { normalizeValues, withWarnings };
