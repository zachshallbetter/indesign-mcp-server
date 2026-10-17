/**
 * Action Manager descriptors built in Node and played in Photoshop.
 *
 * A descriptor is written here as data: a list of [key, value] entries, each
 * value a typed pair from `t` (['d', 1.5], ['e', [type, value]], ...). The
 * whole tree goes into the script as one JSON literal through json(), and the
 * ES3 helpers in AM_HELPERS turn it into ActionDescriptor, ActionList and
 * ActionReference objects. Caller values never reach the script any other way.
 *
 * Ids are stringIDs ("make", "adjustmentLayer"); an id that starts with "@"
 * is a four-character charID ("@Rd  "), used where the published recordings
 * only show the charID or where the stringID is ambiguous (charID 'Grn ' is
 * the stringID "grain").
 */
import { num, enumOf, json, str } from 'adobe-mcp-core';
import { colorSpec, COLOR_SCHEMA } from './args.js';

/** ES3 helpers: __amDo(event, entries) plays a descriptor with dialogs off. */
export const AM_HELPERS = String.raw`
var __id = function (s) { return s.charAt(0) === "@" ? app.charIDToTypeID(s.substring(1)) : app.stringIDToTypeID(s); };
var __amRef = function (parts) {
  var r = new ActionReference();
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p[0] === "class") r.putClass(__id(p[1]));
    else if (p[0] === "enum") r.putEnumerated(__id(p[1]), __id(p[2]), __id(p[3]));
    else if (p[0] === "prop") r.putProperty(__id(p[1]), __id(p[2]));
    else if (p[0] === "id") r.putIdentifier(__id(p[1]), p[2]);
    else throw new Error("Unknown reference form " + p[0]);
  }
  return r;
};
var __amPut = function (d, k, e) {
  var t = e[0], v = e[1], bare = k === null;
  if (t === "b") { if (bare) d.putBoolean(v); else d.putBoolean(k, v); }
  else if (t === "i") { if (bare) d.putInteger(v); else d.putInteger(k, v); }
  else if (t === "d") { if (bare) d.putDouble(v); else d.putDouble(k, v); }
  else if (t === "u") { if (bare) d.putUnitDouble(__id(e[2]), v); else d.putUnitDouble(k, __id(e[2]), v); }
  else if (t === "s") { if (bare) d.putString(v); else d.putString(k, v); }
  else if (t === "e") { if (bare) d.putEnumerated(__id(v[0]), __id(v[1])); else d.putEnumerated(k, __id(v[0]), __id(v[1])); }
  else if (t === "c") { if (bare) d.putClass(__id(v)); else d.putClass(k, __id(v)); }
  else if (t === "o") { if (bare) d.putObject(__id(v[0]), __amDesc(v[1])); else d.putObject(k, __id(v[0]), __amDesc(v[1])); }
  else if (t === "l") { if (bare) d.putList(__amList(v)); else d.putList(k, __amList(v)); }
  else if (t === "r") { if (bare) d.putReference(__amRef(v)); else d.putReference(k, __amRef(v)); }
  else throw new Error("Unknown descriptor value type " + t);
};
var __amDesc = function (entries) {
  var d = new ActionDescriptor();
  for (var i = 0; i < entries.length; i++) __amPut(d, __id(entries[i][0]), entries[i][1]);
  return d;
};
var __amList = function (items) {
  var l = new ActionList();
  for (var i = 0; i < items.length; i++) __amPut(l, null, items[i]);
  return l;
};
var __amDo = function (event, entries) { return app.executeAction(__id(event), __amDesc(entries), DialogModes.NO); };
`;

/** Typed descriptor values. Numbers must already be checked. */
export const t = {
    bool: (v) => ['b', !!v],
    int: (v) => ['i', Math.round(Number(v))],
    dbl: (v) => ['d', Number(v)],
    pct: (v) => ['u', Number(v), '@#Prc'],
    angle: (v) => ['u', Number(v), '@#Ang'],
    str: (v) => ['s', String(v)],
    enm: (type, value) => ['e', [type, value]],
    obj: (cls, entries) => ['o', [cls, entries]],
    list: (items) => ['l', items],
    cls: (c) => ['c', c],
    ref: (parts) => ['r', parts],
};

/** A reference to the targeted (active) object of a class, e.g. the active adjustment layer. */
export const targetRef = (cls) => t.ref([['enum', cls, 'ordinal', 'targetEnum']]);

/** Statement that plays `event` with `entries` (the script must include AM_HELPERS). */
export const amCall = (event, entries) => `__amDo(${str(event)}, ${json(entries)})`;

/** Drop entries whose value is undefined (options not given when editing). */
export const entries = (list) => list.filter((e) => e && e[1] !== undefined);

/** A colour string as an Action Manager colour object. */
export function amColor(value, name = 'color') {
    const spec = colorSpec(value, name);
    if (!spec) throw new Error(`'${name}' needs a colour`);
    const { kind, v } = JSON.parse(spec);
    if (kind === 'rgb') return t.obj('@RGBC', [['@Rd  ', t.dbl(v[0])], ['@Grn ', t.dbl(v[1])], ['@Bl  ', t.dbl(v[2])]]);
    if (kind === 'hsb') return t.obj('@HSBC', [['@H   ', t.angle(v[0])], ['@Strt', t.dbl(v[1])], ['@Brgh', t.dbl(v[2])]]);
    if (kind === 'cmyk') return t.obj('@CMYC', [['@Cyn ', t.dbl(v[0])], ['@Mgnt', t.dbl(v[1])], ['@Ylw ', t.dbl(v[2])], ['@Blck', t.dbl(v[3])]]);
    if (kind === 'lab') return t.obj('@LbCl', [['@Lmnc', t.dbl(v[0])], ['@A   ', t.dbl(v[1])], ['@B   ', t.dbl(v[2])]]);
    return t.obj('@Grsc', [['@Gry ', t.dbl(v[0])]]);
}

/*
 * Option converters. Each takes (value, name), returns the checked value, or
 * undefined when the value is undefined, and throws a clear error otherwise.
 */
export const conv = {
    num: (min, max) => (v, name) => (v === undefined ? undefined : Number(num(v, { min, max, name }))),
    bool: () => (v, name) => {
        if (v === undefined) return undefined;
        if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
        return v;
    },
    oneOf: (list) => (v, name) => (v === undefined ? undefined : enumOf(v, list, { name })),
    color: () => (v, name) => (v === undefined ? undefined : amColor(v, name)),
    nums: (count, min, max) => (v, name) => {
        if (v === undefined) return undefined;
        if (!Array.isArray(v) || v.length !== count) throw new Error(`'${name}' takes ${count} numbers`);
        return v.map((x, i) => Number(num(x, { min, max, name: `${name}[${i}]` })));
    },
    str: () => (v, name) => {
        if (v === undefined) return undefined;
        if (typeof v !== 'string' || !v.trim()) throw new Error(`'${name}' must be a non-empty string`);
        return v;
    },
};

/** Gradient interpolation methods (Gradient Editor, Method). */
export const INTERPOLATION = { perceptual: '@Perc', linear: '@Lnr ', classic: '@Gcls', smooth: '@Smoo', stripes: '@StrI' };
const COLOR_MODELS = { rgb: '@RGBC', hsb: '@HSBl', lab: '@LbCl' };

const STOP = { type: 'number', minimum: 0, maximum: 100 };

export const GRADIENT_SCHEMA = {
    type: 'object',
    description: 'A gradient as the Gradient Editor defines it. Solid (the default): colour stops, opacity stops and smoothness. Noise: roughness, colour model, restricted colours, transparency and a random seed. Omitted: black to white',
    properties: {
        type: { type: 'string', enum: ['solid', 'noise'], description: 'Gradient Type. Default solid' },
        name: { type: 'string', description: 'Gradient name. Default "Custom"' },
        colors: {
            type: 'array', minItems: 2, maxItems: 32,
            description: 'Solid: colour stops, e.g. [{ color: "#000000", location: 0 }, { color: "#FFFFFF", location: 100 }]',
            items: { type: 'object', properties: { color: COLOR_SCHEMA, location: { ...STOP, description: 'Percent along the gradient' }, midpoint: { type: 'number', minimum: 5, maximum: 95, description: 'Midpoint to the next stop, percent. Default 50' } }, required: ['color', 'location'] },
        },
        opacity: {
            type: 'array', minItems: 2, maxItems: 32,
            description: 'Solid: opacity stops. Default fully opaque at both ends',
            items: { type: 'object', properties: { opacity: { ...STOP, description: 'Percent' }, location: { ...STOP, description: 'Percent along the gradient' }, midpoint: { type: 'number', minimum: 5, maximum: 95 } }, required: ['opacity', 'location'] },
        },
        smoothness: { ...STOP, description: 'Solid: smoothness, percent. Default 100' },
        roughness: { ...STOP, description: 'Noise: roughness, percent. Default 50' },
        colorModel: { type: 'string', enum: Object.keys(COLOR_MODELS), description: 'Noise: colour model the ranges use. Default rgb' },
        minimum: { type: 'array', items: STOP, minItems: 4, maxItems: 4, description: 'Noise: low end of each colour-model channel (and a fourth value), percent. Default [0,0,0,0]' },
        maximum: { type: 'array', items: STOP, minItems: 4, maxItems: 4, description: 'Noise: high end of each channel, percent. Default [100,100,100,100]' },
        restrictColors: { type: 'boolean', description: 'Noise: Restrict Colors (prevent oversaturation)' },
        addTransparency: { type: 'boolean', description: 'Noise: Add Transparency' },
        seed: { type: 'integer', minimum: 0, maximum: 2147483647, description: 'Noise: random seed. Omit for a new random gradient (Randomize)' },
    },
};

const GRADIENT_KEYS = Object.keys(GRADIENT_SCHEMA.properties);
const loc = (pct) => t.int(Math.round(pct * 40.96));

/** A gradient definition object (class gradientClassEvent) from GRADIENT_SCHEMA input. */
export function gradientDescriptor(g, name = 'gradient') {
    const spec = g ?? {};
    if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error(`'${name}' must be an object`);
    const unknown = Object.keys(spec).filter((k) => !GRADIENT_KEYS.includes(k));
    if (unknown.length) throw new Error(`'${name}' has no ${unknown.join(', ')}. Keys: ${GRADIENT_KEYS.join(', ')}`);
    const type = enumOf(spec.type ?? 'solid', ['solid', 'noise'], { name: `${name}.type` });
    const title = t.str(spec.name ?? 'Custom');
    if (type === 'noise') {
        for (const k of ['colors', 'opacity', 'smoothness']) if (spec[k] !== undefined) throw new Error(`'${name}.${k}' is for solid gradients`);
        const range = (v, d, k) => (v === undefined ? d : conv.nums(4, 0, 100)(v, `${name}.${k}`)).map((x) => t.int(x));
        return t.obj('@Grdn', [
            ['@Nm  ', title],
            ['@GrdF', t.enm('@GrdF', '@ClNs')],
            ['@ShTr', t.bool(conv.bool()(spec.addTransparency, `${name}.addTransparency`) ?? false)],
            ['@VctC', t.bool(conv.bool()(spec.restrictColors, `${name}.restrictColors`) ?? false)],
            ['@ClrS', t.enm('@ClrS', COLOR_MODELS[enumOf(spec.colorModel ?? 'rgb', Object.keys(COLOR_MODELS), { name: `${name}.colorModel` })])],
            ['@RndS', t.int(spec.seed === undefined ? Math.floor(Math.random() * 2147483647) : Number(num(spec.seed, { min: 0, max: 2147483647, name: `${name}.seed` })))],
            ['@Smth', loc(Number(num(spec.roughness ?? 50, { min: 0, max: 100, name: `${name}.roughness` })))],
            ['@Mnm ', t.list(range(spec.minimum, [0, 0, 0, 0], 'minimum'))],
            ['@Mxm ', t.list(range(spec.maximum, [100, 100, 100, 100], 'maximum'))],
        ]);
    }
    for (const k of ['roughness', 'colorModel', 'minimum', 'maximum', 'restrictColors', 'addTransparency', 'seed']) {
        if (spec[k] !== undefined) throw new Error(`'${name}.${k}' is for noise gradients (type: "noise")`);
    }
    const stops = (list, k, fallback) => {
        const v = list ?? fallback;
        if (!Array.isArray(v) || v.length < 2 || v.length > 32) throw new Error(`'${name}.${k}' needs 2 to 32 stops`);
        return v;
    };
    const mid = (s, k, i) => t.int(num(s.midpoint ?? 50, { min: 5, max: 95, name: `${name}.${k}[${i}].midpoint` }));
    const colors = stops(spec.colors, 'colors', [{ color: '#000000', location: 0 }, { color: '#FFFFFF', location: 100 }]).map((s = {}, i) => t.obj('@Clrt', [
        ['@Clr ', amColor(s.color, `${name}.colors[${i}].color`)],
        ['@Type', t.enm('@Clry', '@UsrS')],
        ['@Lctn', loc(Number(num(s.location, { min: 0, max: 100, name: `${name}.colors[${i}].location` })))],
        ['@Mdpn', mid(s, 'colors', i)],
    ]));
    const opacity = stops(spec.opacity, 'opacity', [{ opacity: 100, location: 0 }, { opacity: 100, location: 100 }]).map((s = {}, i) => t.obj('@TrnS', [
        ['@Opct', t.pct(num(s.opacity, { min: 0, max: 100, name: `${name}.opacity[${i}].opacity` }))],
        ['@Lctn', loc(Number(num(s.location, { min: 0, max: 100, name: `${name}.opacity[${i}].location` })))],
        ['@Mdpn', mid(s, 'opacity', i)],
    ]));
    return t.obj('@Grdn', [
        ['@Nm  ', title],
        ['@GrdF', t.enm('@GrdF', '@CstS')],
        ['@Intr', t.dbl(Math.round(Number(num(spec.smoothness ?? 100, { min: 0, max: 100, name: `${name}.smoothness` })) * 40.96))],
        ['@Clrs', t.list(colors)],
        ['@Trns', t.list(opacity)],
    ]);
}
