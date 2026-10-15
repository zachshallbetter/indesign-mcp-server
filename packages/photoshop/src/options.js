/**
 * Option tables: a caller's option object turned into property assignments on
 * an ExtendScript options object (`o.prop = value;`), each value checked and
 * converted by its kind. Keys a table does not list are refused.
 *
 * Table entry: { kind, prop?, values?, type?, min?, max?, description? }
 *   bool          true or false
 *   num, int      a number within [min, max]
 *   px            a number of pixels, written as UnitValue(n, "px")
 *   str           a string
 *   strings       a list of strings
 *   enum          a key of `values`, written as `${type}.${values[key]}`
 *   literal       a key of `values`, written as the value itself (e.g. "true")
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';

/** The JSX literal for one option value. */
export function optionValue(spec, value, name) {
    switch (spec.kind) {
        case 'bool':
            if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
            return bool(value);
        case 'int':
            if (!Number.isInteger(Number(value))) throw new Error(`'${name}' must be a whole number`);
            return num(value, { min: spec.min, max: spec.max, name });
        case 'num':
            return num(value, { min: spec.min, max: spec.max, name });
        case 'px':
            return `new UnitValue(${num(value, { min: spec.min ?? 0, max: spec.max ?? 300000, name })}, "px")`;
        case 'str':
            if (typeof value !== 'string') throw new Error(`'${name}' must be a string`);
            return str(value);
        case 'strings':
            if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`'${name}' must be a list of strings`);
            return json(value);
        case 'enum':
            return `${spec.type}.${spec.values[enumOf(value, Object.keys(spec.values), { name })]}`;
        case 'literal':
            return spec.values[enumOf(value, Object.keys(spec.values), { name })];
        default:
            throw new Error(`Unknown option kind ${spec.kind}`);
    }
}

/**
 * `${target}.${prop} = value;` for each option given (and each table default).
 * @param {object} table option name -> spec
 * @param {object} given the caller's options
 * @param {{ name?: string, target?: string, what?: string }} [opts]
 */
export function optionLines(table, given, { name = 'options', target = 'o', what = '' } = {}) {
    const opts = given ?? {};
    if (typeof opts !== 'object' || Array.isArray(opts)) throw new Error(`'${name}' must be an object`);
    for (const k of Object.keys(opts)) {
        if (!(k in table)) {
            const known = Object.keys(table);
            throw new Error(`${what || `'${name}'`} has no option ${k}${known.length ? `. Options: ${known.join(', ')}` : ''}`);
        }
    }
    const lines = [];
    for (const [k, spec] of Object.entries(table)) {
        const v = opts[k] !== undefined ? opts[k] : spec.default;
        if (v === undefined) continue;
        lines.push(`${target}.${spec.prop ?? k} = ${optionValue(spec, v, `${name}.${k}`)};`);
    }
    return lines.join('\n');
}

/** A JSON-schema description of a table, for a tool's inputSchema. */
export function describeOptions(table) {
    return Object.entries(table).map(([k, s]) => {
        const kinds = { bool: 'true/false', int: 'integer', num: 'number', px: 'pixels', str: 'text', strings: 'list of text' };
        const range = s.min !== undefined || s.max !== undefined ? ` ${s.min ?? ''}-${s.max ?? ''}` : '';
        const type = s.values ? Object.keys(s.values).join('|') : `${kinds[s.kind]}${range}`;
        return `${k} (${type})${s.description ? `: ${s.description}` : ''}`;
    }).join('; ');
}
