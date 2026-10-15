/**
 * Argument checks shared by the data merge, find/change, proofing, automation
 * and InCopy modules. Each returns a value that is safe to write into a script
 * (through adobe-mcp-core's str/num/json) or throws a plain error naming the
 * argument.
 */
import { enumOf, num, str } from 'adobe-mcp-core';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';

/** True when a value was given (null, undefined and "" count as not given). */
export const has = (v) => v !== undefined && v !== null && v !== '';

/** An option object, or null when not given. */
export function obj(value, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    return value;
}

/** Refuse keys an option object does not know. */
export function known(o, keys, name) {
    for (const k of Object.keys(o ?? {})) {
        if (!keys.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Known: ${keys.join(', ')}`);
    }
}

/** A whole number in [min, max], as script text. */
export function int(value, name, { min = 0, max = 2147483647 } = {}) {
    const n = Number(num(value, { min, max, name }));
    if (!Number.isInteger(n)) throw new Error(`'${name}' must be a whole number`);
    return String(n);
}

/** A list of page item or story ids, as script text for an array literal. */
export function idList(list, name, { min = 1, max = 5000 } = {}) {
    if (!Array.isArray(list) || list.length < min) throw new Error(`'${name}' needs at least ${min} id${min > 1 ? 's' : ''}`);
    if (list.length > max) throw new Error(`'${name}' has more than ${max} ids`);
    return `[${list.map((v) => int(v, name)).join(', ')}]`;
}

/** A boolean argument, refusing strings such as "yes". */
export function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return value ? 'true' : 'false';
}

/** A short, non-empty string as a script literal. */
export function text(value, name, max = 500) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required`);
    if (value.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return str(value);
}

/** A list of short strings as a script array literal. */
export function textList(list, name, { max = 5000, maxLength = 200 } = {}) {
    if (!Array.isArray(list) || !list.length) throw new Error(`'${name}' needs at least one entry`);
    if (list.length > max) throw new Error(`'${name}' has more than ${max} entries`);
    return `[${list.map((v, i) => text(v, `${name}[${i}]`, maxLength)).join(', ')}]`;
}

/** A snake_case choice mapped to an InDesign enum member (`Enum.MEMBER`). */
export function pick(value, map, name) {
    return map[enumOf(value, Object.keys(map), { name })];
}

/**
 * A file path the caller gives, checked against the server's path policy and
 * written as a script string. `ext` limits the extension (lower case, with dot).
 */
export function filePath(value, name, ext = null) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required: an absolute file path`);
    if (ext && !ext.some((e) => value.toLowerCase().endsWith(e))) throw new Error(`'${name}' must end in ${ext.join(' or ')}`);
    return jsxPath(validateFilePath(value));
}

/** The InDesign UI colours (UIColors) by lower-case name. */
export const UI_COLORS = ['BLACK', 'BLUE', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CHARCOAL', 'CUTE_TEAL', 'CYAN', 'DARK_BLUE', 'DARK_GREEN', 'FIESTA', 'GOLD', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE', 'GRID_GREEN', 'GRID_ORANGE', 'LAVENDER', 'LIGHT_BLUE', 'LIGHT_GRAY', 'LIGHT_OLIVE', 'LIPSTICK', 'MAGENTA', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'PURPLE', 'RED', 'SULPHUR', 'TAN', 'TEAL', 'VIOLET', 'WHITE', 'YELLOW'];

/** A UI colour: a UIColors name such as "light_blue", or "#RRGGBB" (an RGB triple). */
export function uiColor(value, name) {
    const v = String(value ?? '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return `[${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}]`;
    }
    return `UIColors.${enumOf(v.toUpperCase().replace(/[\s-]+/g, '_'), UI_COLORS, { name })}`;
}

export const uiColorSchema = (what) => ({ type: 'string', description: `${what}: a colour name such as "red" or "light_blue", or "#RRGGBB"` });

/** Script helper: a UI colour value as a name or #RRGGBB for results. */
export const UI_COLOR_JSX = String.raw`
var __uiColor = function (v) {
  if (v instanceof Array) {
    var h = "#";
    for (var i = 0; i < 3; i++) h += ("0" + Math.round(v[i]).toString(16)).slice(-2);
    return h;
  }
  return __enumName(v).toLowerCase();
};
`;
