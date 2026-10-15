/**
 * Effect controls: apply any effect on the Effect menu and set its controls by
 * name in one call, read an applied effect's controls with their types and
 * values, browse the effect catalog by category, and duplicate, reorder or copy
 * applied effects.
 *
 * The catalog (src/data/effects.json, from the capability atlas) gives each
 * effect's display name, category, match name where the scripting guide
 * publishes one, and the controls the help pages list. Effects without a
 * published match name are found by display name in app.effects at run time.
 * Control names are matched against the applied effect's own properties at run
 * time, ignoring case, spaces and punctuation, so a control is named as it
 * appears in the Effect Controls panel or by its match name.
 */
import { readFileSync } from 'node:fs';
import { str, num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

/** The effect catalog: { id, name, matchName, category, controls: [{ id, name, settable?, reason? }] }. */
export const EFFECTS = JSON.parse(readFileSync(new URL('../data/effects.json', import.meta.url), 'utf8')).effects;
export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))].sort();

/** Names compared without case, spaces or punctuation, as the scripts compare them. */
export const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const BY_KEY = new Map();
for (const e of EFFECTS) {
    BY_KEY.set(nameKey(e.name), e);
    if (e.matchName) BY_KEY.set(nameKey(e.matchName), e);
}

/** The catalog entry for a display name or match name, or null for an effect the catalog does not list. */
export function findEffect(name) {
    return BY_KEY.get(nameKey(name)) ?? null;
}

/** Feature ids the catalog covers: each effect, and each control a script can set. */
const CATALOG_FEATURES = EFFECTS.flatMap((e) => [e.id, ...e.controls.filter((c) => c.settable !== false).map((c) => c.id)]);

/** An effect to apply as a JSX literal: the catalog's names when it lists the effect, else the caller's text. */
function effectSpec(effect) {
    const text = String(effect ?? '').trim();
    if (!text) throw new Error("'effect': give an effect's display name or match name (find_effects lists them)");
    if (text.length > 200) throw new Error("'effect' is too long");
    const e = findEffect(text);
    return json({ text, name: e ? e.name : text, matchName: e ? e.matchName : null });
}

/** An applied effect: its name in the Effect Controls panel, its match name, or its 1-based position. */
const EFFECT_REF_SCHEMA = {
    description: 'An effect already on the layer: its name in the Effect Controls panel (e.g. "Gaussian Blur 2"), its match name, or its position (1 = top)',
    oneOf: [{ type: 'string', minLength: 1 }, { type: 'integer', minimum: 1 }],
};

function effectRef(ref, name) {
    if (typeof ref === 'number') return index(ref, { name, max: 1000 });
    if (typeof ref === 'string' && ref.trim()) return str(ref);
    throw new Error(`'${name}': give an applied effect's name, match name or position (1 = top)`);
}

/**
 * One control value, tagged for the script: k is num, arr, str (with color when it
 * reads as a colour), items (a Dropdown Menu Control's menu) or group (an object
 * of the controls inside a group).
 */
function encodeValue(value, name, depth = 0) {
    if (typeof value === 'number') return { k: 'num', v: Number(num(value, { name })) };
    if (typeof value === 'boolean') return { k: 'num', v: value ? 1 : 0 };
    if (typeof value === 'string') {
        if (value.length > 500) throw new Error(`'${name}' is too long`);
        let color = null;
        try { color = JSON.parse(colorValue(value, name)); } catch { /* not a colour: a menu choice, layer or mask name */ }
        return { k: 'str', v: value, color };
    }
    if (Array.isArray(value)) {
        if (value.length && value.length <= 4 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) return { k: 'arr', v: value };
        if (value.length && value.length <= 100 && value.every((v) => typeof v === 'string' && v.length <= 200)) return { k: 'items', v: value };
        throw new Error(`'${name}': an array is 1 to 4 numbers (a point or colour) or a list of menu items for a Dropdown Menu Control`);
    }
    if (value && typeof value === 'object') {
        if (depth >= 4) throw new Error(`'${name}': groups nest at most 4 deep`);
        return { k: 'group', v: encodeControls(value, name, depth + 1) };
    }
    throw new Error(`'${name}' must be a number, true/false, text, an array or an object of the controls in a group`);
}

function encodeControls(controls, name = 'controls', depth = 0) {
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) throw new Error(`'${name}' must be an object of control names to values`);
    const pairs = Object.entries(controls);
    if (pairs.length > 300) throw new Error(`'${name}': at most 300 controls per call`);
    return pairs.map(([k, v]) => {
        if (!k.trim()) throw new Error(`'${name}': a control name is empty`);
        return [k, encodeValue(v, `${name}.${k}`, depth)];
    });
}

/** ES3 helpers: find an installed effect, an applied effect, a control; convert and set values. */
const FX = String.raw`
function __fxKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function __fxMatch(spec) {
  var i, e, k = __fxKey(spec.text), n = __fxKey(spec.name);
  if (spec.matchName) for (i = 0; i < app.effects.length; i++) if (app.effects[i].matchName === spec.matchName) return spec.matchName;
  for (i = 0; i < app.effects.length; i++) {
    e = app.effects[i];
    if (__fxKey(e.matchName) === k || __fxKey(e.displayName) === k || __fxKey(e.displayName) === n) return e.matchName;
  }
  return spec.matchName || spec.text;
}

function __fxPick(parade, ref, layer) {
  var f, fx;
  if (typeof ref === "number") {
    if (ref < 1 || ref > parade.numProperties) throw new Error("Layer " + layer.name + " has no effect " + ref + "; it has " + parade.numProperties);
    return parade.property(ref);
  }
  for (f = 1; f <= parade.numProperties; f++) if (parade.property(f).name === ref) return parade.property(f);
  for (f = 1; f <= parade.numProperties; f++) {
    fx = parade.property(f);
    if (fx.matchName === ref || __fxKey(fx.name) === __fxKey(ref)) return fx;
  }
  throw new Error("Layer " + layer.name + " has no effect " + ref + " (list_layer_effects lists them)");
}

function __fxFind(group, key, from) {
  var k = __fxKey(key), i, p;
  for (i = from; i <= group.numProperties; i++) {
    p = group.property(i);
    if (p.matchName === key || __fxKey(p.name) === k) return p;
  }
  for (i = 1; i <= group.numProperties; i++) {
    p = group.property(i);
    if (p.propertyType !== PropertyType.PROPERTY) { p = __fxFind(p, key, 1); if (p) return p; }
  }
  return null;
}

function __fxNames(group) {
  var out = [], i, p;
  for (i = 1; i <= group.numProperties; i++) {
    p = group.property(i);
    if (p.propertyType !== PropertyType.PROPERTY) out = out.concat(__fxNames(p));
    else if (p.name) out.push(p.name);
  }
  return out;
}

function __fxType(p) {
  if (p.propertyType !== PropertyType.PROPERTY) return "group";
  var t = p.propertyValueType;
  if (t === PropertyValueType.NO_VALUE) return "topic";
  if (t === PropertyValueType.COLOR) return "color";
  if (t === PropertyValueType.LAYER_INDEX) return "layer";
  if (t === PropertyValueType.MASK_INDEX) return "mask";
  if (t === PropertyValueType.CUSTOM_VALUE) return "custom";
  if (t === PropertyValueType.SHAPE || t === PropertyValueType.TEXT_DOCUMENT || t === PropertyValueType.MARKER) return "other";
  var v = null;
  try { v = p.value; } catch (e) { return "custom"; }
  if (typeof v === "number") return __fxChoices(p).length ? "menu" : "number";
  if (v instanceof Array) return v.length === 3 ? "point3d" : "point";
  return "other";
}

function __fxChoices(p) {
  var items = [];
  try { items = p.propertyParameters || []; } catch (e) {}
  return items;
}

function __fxValue(p, enc, layer, comp) {
  var type = __fxType(p), i, c;
  if (type === "color") {
    c = enc.k === "str" ? enc.color : (enc.k === "arr" ? enc.v : null);
    if (!c || c.length < 3) throw new Error(p.name + " is a colour: give \"#RRGGBB\", \"rgb(r,g,b)\" or [r, g, b] from 0 to 1");
    return c.length === 3 ? [c[0], c[1], c[2], 1] : c;
  }
  if (type === "layer") {
    if (enc.k === "num") return enc.v;
    if (enc.k === "str") {
      var l = comp.layers.byName(enc.v);
      if (!l) throw new Error("No layer named " + enc.v + " for " + p.name);
      return l.index;
    }
    throw new Error(p.name + " takes a layer: its index (0 = none) or name");
  }
  if (type === "mask") {
    if (enc.k === "num") return enc.v;
    if (enc.k === "str") {
      var m = layer.property("ADBE Mask Parade").property(enc.v);
      if (!m) throw new Error("Layer " + layer.name + " has no mask named " + enc.v + " for " + p.name);
      return m.propertyIndex;
    }
    throw new Error(p.name + " takes a mask: its index (0 = none) or name");
  }
  if (type === "number" || type === "menu") {
    if (enc.k === "num") return enc.v;
    if (enc.k === "str") {
      var items = __fxChoices(p);
      for (i = 0; i < items.length; i++) if (items[i] === enc.v) return i + 1;
      for (i = 0; i < items.length; i++) if (__fxKey(items[i]) === __fxKey(enc.v)) return i + 1;
      throw new Error(p.name + " has no choice " + enc.v + (items.length ? ". Choices: " + items.join(", ") : "; give the choice's number (1 = first)"));
    }
    throw new Error(p.name + " takes a number" + (type === "menu" ? " or one of its choices: " + __fxChoices(p).join(", ") : ""));
  }
  if (type === "point" || type === "point3d") {
    if (enc.k === "arr") return enc.v;
    throw new Error(p.name + " takes a point: [x, y]" + (type === "point3d" ? " or [x, y, z]" : "") + " in pixels");
  }
  throw new Error(p.name + " holds data that scripts cannot set");
}

function __fxSet(fx, group, from, pairs, layer, comp, time, out) {
  for (var i = 0; i < pairs.length; i++) {
    var key = pairs[i][0], enc = pairs[i][1], p = __fxFind(group, key, from);
    if (!p) throw new Error(fx.name + " has no control " + key + ". Its controls: " + __fxNames(fx).join(", "));
    if (enc.k === "items") continue;
    var type = __fxType(p);
    if (type === "group" || type === "topic") {
      if (enc.k !== "group") throw new Error(p.name + " is a group of controls: give an object of the controls inside it");
      if (type === "group") __fxSet(fx, p, 1, enc.v, layer, comp, time, out);
      else __fxSet(fx, p.parentProperty, p.propertyIndex + 1, enc.v, layer, comp, time, out);
      continue;
    }
    if (enc.k === "group") throw new Error(p.name + " is a single control, not a group");
    var v = __fxValue(p, enc, layer, comp);
    if (time !== null) p.setValueAtTime(time, v);
    else if (p.numKeys > 0) p.setValueAtTime(comp.time, v);
    else p.setValue(v);
    var now = null;
    try { now = p.value; } catch (e) {}
    out.push({ name: p.name, value: now });
  }
}

function __fxInfo(p, at, topic) {
  var info = { index: p.propertyIndex, name: p.name, matchName: p.matchName, type: __fxType(p) };
  if (topic) info.topic = topic;
  if (info.type === "group" || info.type === "topic") return info;
  try { info.value = at === null ? p.value : p.valueAtTime(at, false); } catch (e) { info.value = null; }
  if (info.type === "menu") { info.choices = __fxChoices(p); try { info.valueText = p.valueText; } catch (e) {} }
  if (p.hasMin) info.min = p.minValue;
  if (p.hasMax) info.max = p.maxValue;
  try { if (p.unitsText) info.units = p.unitsText; } catch (e) {}
  info.keyframes = p.numKeys;
  info.canKeyframe = p.canVaryOverTime;
  if (p.canSetExpression && p.expression) info.expression = p.expression;
  return info;
}

function __fxControls(group, at, out, topic) {
  for (var i = 1; i <= group.numProperties; i++) {
    var p = group.property(i), type = __fxType(p);
    if (type === "topic") {
      topic = p.name || null;
      if (p.name) out.push(__fxInfo(p, at, null));
      continue;
    }
    if (type === "group") out.push({ index: p.propertyIndex, name: p.name, matchName: p.matchName, type: type, controls: __fxControls(p, at, [], null) });
    else out.push(__fxInfo(p, at, topic));
  }
  return out;
}
`;

export const tools = [
    {
        name: 'find_effects',
        description: 'Browse the effects on the Effect menu by category (Blur & Sharpen, Distort, Generate, Expression Controls, ...) or by name, from the built-in effect catalog: display name, match name, category, the controls After Effects documents for each, and whether this After Effects has it installed (Effect menu; Effects & Presets panel)',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: EFFECT_CATEGORIES, description: 'Only effects in this Effect menu category' },
                query: { type: 'string', description: 'Only effects whose display name or match name contains this text' },
                controls: { type: 'boolean', default: false, description: 'Include each effect\'s documented controls' },
                limit: { type: 'integer', minimum: 1, maximum: 400, default: 400, description: 'Most effects to return' },
            },
        },
        hints: { readOnly: true, idempotent: true },
        auditArgs: { category: 'Blur & Sharpen', query: undefined, controls: true },
        features: ['aftereffects.effects.installed_effects_list'],
        handler: (a) => {
            const category = a.category !== undefined ? enumOf(a.category, EFFECT_CATEGORIES, { name: 'category' }) : null;
            const q = nameKey(a.query ?? '');
            const max = Number(index(a.limit ?? 400, { name: 'limit', max: 400 }));
            const hits = EFFECTS.filter((e) => (!category || e.category === category) && (!q || nameKey(e.name).includes(q) || (e.matchName && nameKey(e.matchName).includes(q))));
            const list = hits.slice(0, max).map((e) => ({
                name: e.name,
                matchName: e.matchName,
                category: e.category,
                controls: a.controls ? e.controls.filter((c) => c.settable !== false).map((c) => c.name) : null,
            }));
            return run('Find effects', script(`${FX}
var list = ${json(list)}, byMatch = {}, byName = {}, out = [], i;
for (i = 0; i < app.effects.length; i++) {
  byMatch["m" + app.effects[i].matchName] = app.effects[i];
  byName["d" + __fxKey(app.effects[i].displayName)] = app.effects[i];
}
for (i = 0; i < list.length; i++) {
  var w = list[i], e = (w.matchName && byMatch["m" + w.matchName]) || byName["d" + __fxKey(w.name)];
  var o = { name: w.name, matchName: w.matchName || (e ? e.matchName : null), category: w.category, installed: !!e };
  if (w.controls) o.controls = w.controls;
  out.push(o);
}
__result__ = { total: ${hits.length}, effects: out };`));
        },
    },
    {
        name: 'set_effect_controls',
        description: 'Apply an effect from the Effect menu to layers by display name or match name and set any of its controls by name in the same call, or set the controls of an effect already on the layers (Effect Controls panel). Values: numbers, true/false for checkboxes, [x, y] pixels for points, "#RRGGBB" for colours, a menu choice\'s text or number, a layer\'s name or index for layer controls, a mask\'s name for mask controls, an object for the controls inside a group, and a list of strings to replace a Dropdown Menu Control\'s items. With time, each value is a keyframe',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                effect: { type: 'string', description: 'The effect to apply: its display name (e.g. "Fractal Noise") or match name (e.g. "ADBE Fractal Noise"); find_effects lists them' },
                existing: EFFECT_REF_SCHEMA,
                controls: { type: 'object', description: 'Control names (as in the Effect Controls panel, or match names) to values, e.g. { "Blurriness": 20, "Repeat Edge Pixels": true }' },
                time: { type: 'number', minimum: 0, description: 'Seconds: set each control as a keyframe at this time' },
                name: { type: 'string', description: 'Rename the effect' },
            },
            required: ['layers'],
        },
        auditArgs: { effect: 'Gaussian Blur', existing: undefined, controls: { Blurriness: 12, 'Repeat Edge Pixels': true, Dimensions: 'Horizontal' }, time: undefined },
        features: [...CATALOG_FEATURES, 'aftereffects.effects.category_expression_controls', 'aftereffects.effects.effect_control_points', 'aftereffects.effects.compound_effects_and_control_layers'],
        handler: (a) => {
            if ((a.effect === undefined) === (a.existing === undefined)) throw new Error("Give effect (to apply a new one) or existing (to edit one already on the layers), not both");
            const pairs = encodeControls(a.controls ?? {});
            const items = pairs.filter(([, v]) => v.k === 'items');
            const time = a.time !== undefined ? num(a.time, { min: 0, name: 'time' }) : 'null';
            return run('Set effect controls', script(`${FX}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), pairs = ${json(pairs)}, out = [];
${a.effect !== undefined ? `var spec = ${effectSpec(a.effect)}, mn = __fxMatch(spec);` : `var ref = ${effectRef(a.existing, 'existing')};`}
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), fx;
  ${a.effect !== undefined
        ? 'if (!parade.canAddProperty(mn)) throw new Error(spec.text + " is not an effect After Effects can add to " + ls[i].name + " (find_effects, list_effects)");\n  fx = parade.addProperty(mn);'
        : 'fx = __fxPick(parade, ref, ls[i]);'}
  var at = fx.propertyIndex, set = [];
  ${a.name !== undefined ? `fx.name = ${str(a.name)};` : ''}
  ${items.length ? `for (var d = 0; d < pairs.length; d++) {
    if (pairs[d][1].k !== "items") continue;
    var menu = __fxFind(fx, pairs[d][0], 1);
    if (!menu || !menu.isDropdownEffect) throw new Error("Only a Dropdown Menu Control's Menu takes a list of items; " + fx.name + " > " + pairs[d][0] + " does not");
    menu.setPropertyParameters(pairs[d][1].v);
    fx = parade.property(at);
    set.push({ name: pairs[d][0], items: pairs[d][1].v });
  }` : ''}
  __fxSet(fx, fx, 1, pairs, ls[i], c, ${time}, set);
  out.push({ layer: ls[i].index, effect: fx.name, matchName: fx.matchName, index: at, controls: set });
}
__result__ = { effects: out };`, { undo: a.effect !== undefined ? 'Apply effect' : 'Set effect controls' }));
        },
    },
    {
        name: 'get_effect_controls',
        description: 'Read the controls of effects on layers (Effect Controls panel): each control\'s name, match name, type (number, menu, point, point3d, color, layer, mask, topic, group or custom; checkboxes are numbers 0 or 1), current value, menu choices, range, units, keyframe count and expression',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                effect: { ...EFFECT_REF_SCHEMA, description: `${EFFECT_REF_SCHEMA.description}. Omit for every effect on the layers` },
                time: { type: 'number', minimum: 0, description: 'Read values at this time (seconds) instead of the current time' },
            },
            required: ['layers'],
        },
        hints: { readOnly: true, idempotent: true },
        auditArgs: { effect: 'Gaussian Blur', time: 1 },
        features: ['aftereffects.effects.effect_controls_panel'],
        handler: (a) => {
            const ref = a.effect !== undefined ? effectRef(a.effect, 'effect') : 'null';
            const at = a.time !== undefined ? num(a.time, { min: 0, name: 'time' }) : 'null';
            return run('Get effect controls', script(`${FX}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), ref = ${ref}, out = [];
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), fxs = [], list = [];
  if (ref !== null) list.push(__fxPick(parade, ref, ls[i]));
  else for (var f = 1; f <= parade.numProperties; f++) list.push(parade.property(f));
  for (var j = 0; j < list.length; j++) {
    var fx = list[j];
    fxs.push({ index: fx.propertyIndex, name: fx.name, matchName: fx.matchName, enabled: fx.enabled, controls: __fxControls(fx, ${at}, [], null) });
  }
  out.push({ layer: ls[i].index, effects: fxs });
}
__result__ = { layers: out };`));
        },
    },
    {
        name: 'organize_effects',
        description: 'Duplicate effects on their layers (Edit > Duplicate), move an effect up or down the layer\'s effect stack (drag in the Effect Controls panel), or copy effects with their keyframes and expressions to other layers in the composition (Edit > Copy, Edit > Paste; uses the clipboard and opens the composition in the Composition panel)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: `${LAYERS_SCHEMA.description}. For copy_to_layers, one source layer` },
                action: { type: 'string', enum: ['duplicate', 'move', 'copy_to_layers'], description: 'What to do' },
                effects: { type: 'array', items: EFFECT_REF_SCHEMA, maxItems: 100, description: 'Applied effects by name, match name or position (1 = top); omit for all (one effect for move)' },
                position: { type: 'integer', minimum: 1, description: 'move: the new position in the stack, 1 = top' },
                to: { ...LAYERS_SCHEMA, description: 'copy_to_layers: the layers to paste the effects onto' },
            },
            required: ['layers', 'action'],
        },
        auditArgs: { action: 'copy_to_layers', layers: { indexes: [1] }, effects: ['Gaussian Blur', 2], position: undefined, to: { indexes: [2, 3] } },
        features: ['aftereffects.effects.duplicate_effect', 'aftereffects.effects.reorder_effect', 'aftereffects.effects.copy_effects_between_layers'],
        handler: (a) => {
            const action = enumOf(a.action, ['duplicate', 'move', 'copy_to_layers'], { name: 'action' });
            const refs = (a.effects ?? []).map((r) => effectRef(r, 'effects'));
            if (action === 'move' && (refs.length !== 1 || a.position === undefined)) throw new Error('move takes one effect in effects and a position');
            if (action === 'copy_to_layers' && !a.to) throw new Error('copy_to_layers needs the destination layers in to');
            const pick = `var refs = [${refs.join(', ')}];
var __fxIndexes = function (layer) {
  var parade = layer.property("ADBE Effect Parade"), idx = [], f;
  if (!refs.length) for (f = 1; f <= parade.numProperties; f++) idx.push(f);
  for (f = 0; f < refs.length; f++) idx.push(__fxPick(parade, refs[f], layer).propertyIndex);
  idx.sort(function (x, y) { return y - x; });
  return idx;
};`;
            const body = {
                duplicate: `for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), idx = __fxIndexes(ls[i]);
  for (var k = 0; k < idx.length; k++) parade.property(idx[k]).duplicate();
  out.push({ layer: ls[i].index, duplicated: idx.length, effects: parade.numProperties });
}`,
                move: `var to = ${index(a.position ?? 1, { name: 'position', max: 1000 })};
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), fx = __fxPick(parade, refs[0], ls[i]);
  if (to > parade.numProperties) throw new Error("Layer " + ls[i].name + " has " + parade.numProperties + " effects; position " + to + " is past the end");
  var name = fx.name;
  fx.moveTo(to);
  out.push({ layer: ls[i].index, effect: name, position: to });
}`,
                copy_to_layers: `if (ls.length !== 1) throw new Error("Copy from one source layer at a time");
var src = ls[0], parade = src.property("ADBE Effect Parade"), idx = __fxIndexes(src), dest = __layers(c, ${a.to ? layerSpec(a.to) : '{}'}), k;
if (!idx.length) throw new Error("Layer " + src.name + " has no effects to copy");
for (k = 0; k < dest.length; k++) if (dest[k].index === src.index) throw new Error("The destination layers include the source layer " + src.name);
c.openInViewer();
var sp = c.selectedProperties;
for (k = sp.length - 1; k >= 0; k--) sp[k].selected = false;
var sl = c.selectedLayers;
for (k = sl.length - 1; k >= 0; k--) sl[k].selected = false;
for (k = 0; k < idx.length; k++) parade.property(idx[k]).selected = true;
app.executeCommand(19);
for (k = 0; k < idx.length; k++) parade.property(idx[k]).selected = false;
src.selected = false;
for (k = 0; k < dest.length; k++) dest[k].selected = true;
app.executeCommand(20);
for (k = 0; k < dest.length; k++) out.push({ layer: dest[k].index, effects: dest[k].property("ADBE Effect Parade").numProperties });
out = { copied: idx.length, from: src.index, to: out };`,
            }[action];
            return run('Organize effects', script(`${FX}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
${pick}
${body}
__result__ = { ${action}: out };`, { undo: { duplicate: 'Duplicate effects', move: 'Move effect', copy_to_layers: 'Copy effects' }[action] }));
        },
    },
];
