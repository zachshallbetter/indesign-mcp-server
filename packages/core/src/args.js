/**
 * Canonical argument names, deprecated aliases and unknown-argument warnings.
 *
 * Every tool advertises one name per concept. Callers written against earlier
 * versions keep working: normalizeArgs() maps old names onto the canonical ones
 * before a handler runs, so an alias produces exactly the script the canonical
 * name does. Old names are not in the advertised schemas.
 */

const has = (v) => v !== undefined && v !== null && v !== '';

/** Levenshtein distance, case-insensitive. */
export function distance(a, b) {
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

/**
 * @param {object} opts
 * @param {Array<{ name: string, inputSchema?: object }>} opts.tools tool definitions
 * @param {Array<{ old: string, canonical: string, tools?: string[] }>} [opts.aliases]
 *   old parameter names; each applies to the tools that take its canonical
 *   name, or only to `tools` when given
 * @param {(tool: string, args: object, props: object, warnings: string[]) => void} [opts.normalizeValues]
 *   server-specific value rewrites, run after the name mapping
 */
export function createArgNormalizer({ tools, aliases = [], normalizeValues } = {}) {
    const schemas = new Map(tools.map((t) => [t.name, t.inputSchema?.properties ?? {}]));

    /** The aliases `tool` accepts: [{ old, canonical }]. */
    function aliasesFor(tool) {
        const props = schemas.get(tool) ?? {};
        return aliases.filter((a) => a.canonical in props && !(a.old in props) && (!a.tools || a.tools.includes(tool)));
    }

    /**
     * Map deprecated argument names onto the canonical ones for `tool`. The
     * canonical name wins when both are given. Returns a new object; pushes a
     * deprecation note onto `warnings` for each alias it maps.
     */
    function normalizeArgs(tool, args, warnings = []) {
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
        normalizeValues?.(tool, out, props, warnings);
        return out;
    }

    /** The advertised parameter `key` most likely meant, or null. */
    function suggest(key, props) {
        const alias = aliases.find((a) => a.old === key && a.canonical in props);
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
    function unknownArgWarnings(tool, args) {
        const props = schemas.get(tool);
        if (!props || !args || typeof args !== 'object' || Array.isArray(args)) return [];
        return Object.keys(args)
            .filter((k) => !(k in props))
            .map((k) => {
                const s = suggest(k, props);
                return `Unknown parameter '${k}' was ignored${s ? `; did you mean '${s}'?` : ''}`;
            });
    }

    return { aliasesFor, normalizeArgs, unknownArgWarnings };
}
