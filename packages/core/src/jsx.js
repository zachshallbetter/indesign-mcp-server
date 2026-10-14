/**
 * Escaping and validation helpers for values that end up in ExtendScript.
 *
 * ExtendScript is not sandboxed: it can read and write files and run system
 * commands. Values interpolated into script text must never be raw caller
 * input. Use str(), num(), index(), bool(), enumOf(), json() and numList() at
 * every call site that builds a script.
 */

/** Embed a string as a JS/JSX literal (handles backslashes, quotes, U+2028/9). */
export function str(value) {
    if (value === undefined || value === null) return '""';
    return JSON.stringify(String(value))
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** Require a finite number within [min, max]. Throws on anything else. */
export function num(value, { min = -1e9, max = 1e9, name = 'value' } = {}) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`Invalid number for '${name}': ${JSON.stringify(value)}`);
    }
    if (n < min || n > max) {
        throw new Error(`Value for '${name}' out of range [${min}, ${max}]: ${n}`);
    }
    return String(n);
}

/** Require a non-negative integer (a page, artboard or item index). */
export function index(value, { name = 'index', max = 100000 } = {}) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > max) {
        throw new Error(`Invalid index for '${name}': ${JSON.stringify(value)}`);
    }
    return String(n);
}

/** Boolean as a JSX literal. Never passes a caller-supplied string through. */
export function bool(value) {
    return value ? 'true' : 'false';
}

/**
 * Allow only values from a fixed list: for identifiers written into a script,
 * such as enum members.
 */
export function enumOf(value, allowed, { name = 'enum' } = {}) {
    const v = String(value);
    if (!allowed.includes(v)) {
        throw new Error(
            `Invalid value for '${name}': ${JSON.stringify(value)}. Allowed: ${allowed.join(', ')}`
        );
    }
    return v;
}

/** Embed a data structure as a JS literal. */
export function json(value) {
    return JSON.stringify(value === undefined ? null : value)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** List of numbers as JSX array contents (e.g. colour components). */
export function numList(values, { name = 'values', min, max } = {}) {
    if (!Array.isArray(values)) {
        throw new Error(`Expected a list for '${name}': ${JSON.stringify(values)}`);
    }
    const opts = { name };
    if (min !== undefined) opts.min = min;
    if (max !== undefined) opts.max = max;
    return values.map((v) => num(v, opts)).join(', ');
}

/**
 * Measurement with unit, e.g. "20mm". Returns a quoted JSX string literal.
 */
export function measure(value, { unit = 'mm', name = 'measure' } = {}) {
    const allowedUnits = ['mm', 'cm', 'in', 'pt', 'px', 'p'];
    if (!allowedUnits.includes(unit)) {
        throw new Error(`Invalid unit for '${name}': ${unit}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`Invalid measurement for '${name}': ${JSON.stringify(value)}`);
    }
    return `"${n}${unit}"`;
}
