/**
 * Layer styles: every effect of the Layer Style dialog with its options,
 * multiple instances, reading a style, copying and pasting styles or single
 * effects, clearing, rasterizing, scaling and hiding effects, the advanced
 * Blending Options (knockout, channels, group options, Blend If), and style
 * presets. Layer effects are not in the object model: scripts read the
 * layer's layerEffects descriptor and write it back with set.
 */
import { str, num, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM, AM_BLEND_MODES, GRADIENT_TYPES, gradientLines, patternLines, contourLines } from '../action-manager.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { BLEND_MODES } from './layers.js';
import { paths } from './documents.js';

const ACTIVE = { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. Default the active layer` };

let tmp = 0;
/** A fresh script variable name for a nested descriptor. */
const fresh = (p) => `${p}${++tmp}`;

/**
 * Option kinds. Each has a JSON schema and put(value, e, name), which returns
 * statements that write the checked value into effect descriptor `e`.
 */
const K = {
    bool: (key, description) => ({ schema: { type: 'boolean', description }, put: (v, e) => `${e}.putBoolean(__s(${str(key)}), ${bool(v)});` }),
    unit: (key, unit, min, max, description) => ({
        schema: { type: 'number', minimum: min, maximum: max, description },
        put: (v, e, n) => `${e}.putUnitDouble(__s(${str(key)}), __s(${str(unit)}), ${num(v, { min, max, name: n })});`,
    }),
    choice: (key, type, map, description) => ({
        schema: { type: 'string', enum: Object.keys(map), description },
        put: (v, e, n) => `${e}.putEnumerated(__s(${str(key)}), __s(${str(type)}), __s(${str(map[enumOf(v, Object.keys(map), { name: n })])}));`,
    }),
    mode: (key, description = 'Blend mode') => K.choice(key, 'blendMode', AM_BLEND_MODES, description),
    color: (key, description = 'Colour') => ({
        schema: { ...COLOR_SCHEMA, description: `${description}: ${COLOR_SCHEMA.description}` },
        put: (v, e, n) => `${e}.putObject(__s(${str(key)}), __s("RGBColor"), __rgbDesc(__color(${colorSpec(v, n)})));`,
    }),
    contour: (key, description = 'Contour curve as [input, output] points, 0-255. Default Linear') => ({
        schema: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description },
        put: (v, e) => { const c = fresh('ct'); return `${contourLines(c, v)}\n${e}.putObject(__s(${str(key)}), __s("shapeCurveType"), ${c});`; },
    }),
    gradient: () => ({
        schema: { type: 'array', items: COLOR_SCHEMA, minItems: 2, description: 'Gradient colour stops, evenly spaced. Default black to white' },
        put: (v, e, n) => {
            if (!Array.isArray(v) || v.length < 2) throw new Error(`'${n}' needs at least two colours`);
            const g = fresh('gr');
            return `${gradientLines(g, v.map((c, i) => colorSpec(c, `${n}[${i}]`)))}\n${e}.putObject(__s("gradient"), __c("Grdn"), ${g});`;
        },
    }),
    pattern: () => ({
        schema: { type: 'object', description: 'A loaded pattern preset: { name } as in the Patterns panel, or { id }', properties: { name: { type: 'string', description: 'Pattern name' }, id: { type: 'string', description: 'Pattern preset id' } } },
        put: (v, e) => { const p = fresh('pt'); return `${patternLines(p, v, str)}\n${e}.putObject(__s("pattern"), __s("pattern"), ${p});`; },
    }),
};

const pct = (key, d, min = 0, max = 100) => K.unit(key, 'percentUnit', min, max, d);
const px = (key, d, min = 0, max = 250) => K.unit(key, 'pixelsUnit', min, max, d);
const deg = (key, d, min = -180, max = 180) => K.unit(key, 'angleUnit', min, max, d);
const enabled = () => [K.bool('enabled', 'Show the effect (its eye icon). Default true'), true];
const SHADOW = (spread) => ({
    enabled: enabled(),
    blendMode: [K.mode('mode'), 'multiply'],
    color: [K.color('color'), '#000000'],
    opacity: [pct('opacity', 'Percent'), 75],
    angle: [deg('localLightingAngle', 'Light angle in degrees'), 90],
    useGlobalLight: [K.bool('useGlobalAngle', 'Use Global Light'), true],
    distance: [px('distance', 'Pixels', 0, 30000), 5],
    [spread]: [px('chokeMatte', `${spread === 'spread' ? 'Spread' : 'Choke'}, percent`, 0, 100), 0],
    size: [px('blur', 'Pixels'), 5],
    contour: [K.contour('transferSpec'), null],
    antiAlias: [K.bool('antiAlias', 'Anti-aliased'), false],
    noise: [pct('noise', 'Percent'), 0],
});
const GLOW = (spread) => ({
    enabled: enabled(),
    blendMode: [K.mode('mode'), 'screen'],
    color: [K.color('color'), '#FFFFBE'],
    opacity: [pct('opacity', 'Percent'), 75],
    noise: [pct('noise', 'Percent'), 0],
    technique: [K.choice('glowTechnique', 'matteTechnique', { softer: 'softMatte', precise: 'preciseMatte' }, 'Technique'), 'softer'],
    [spread]: [px('chokeMatte', `${spread === 'spread' ? 'Spread' : 'Choke'}, percent`, 0, 100), 0],
    size: [px('blur', 'Pixels'), 5],
    contour: [K.contour('transferSpec'), null],
    antiAlias: [K.bool('antiAlias', 'Anti-aliased'), false],
    range: [pct('inputRange', 'Range, percent', 1, 100), 50],
    jitter: [pct('shadingNoise', 'Jitter, percent'), 0],
});
const GRADIENT_STYLE = (key = 'type') => K.choice(key, 'gradientType', GRADIENT_TYPES, 'Gradient style');

/**
 * The effects of the Layer Style dialog: their layerEffects key (also the
 * descriptor class), whether they allow several instances, their options with
 * Photoshop's defaults, and sections (sub-pages switched on by a boolean key).
 */
export const EFFECTS = {
    dropShadow: { key: 'dropShadow', multi: true, options: { ...SHADOW('spread'), knocksOut: [K.bool('layerConceals', 'Layer Knocks Out Drop Shadow'), true] } },
    innerShadow: { key: 'innerShadow', multi: true, options: SHADOW('choke') },
    outerGlow: { key: 'outerGlow', options: GLOW('spread') },
    innerGlow: { key: 'innerGlow', options: { ...GLOW('choke'), source: [K.choice('innerGlowSource', 'innerGlowSourceType', { edge: 'edgeGlow', center: 'centerGlow' }, 'Source'), 'edge'] } },
    bevelEmboss: {
        key: 'bevelEmboss',
        options: {
            enabled: enabled(),
            style: [K.choice('bevelStyle', 'bevelEmbossStyle', { inner_bevel: 'innerBevel', outer_bevel: 'outerBevel', emboss: 'emboss', pillow_emboss: 'pillowEmboss', stroke_emboss: 'strokeEmboss' }, 'Style'), 'inner_bevel'],
            technique: [K.choice('bevelTechnique', 'bevelTechnique', { smooth: 'softMatte', chisel_hard: 'preciseMatte', chisel_soft: 'slopeLimitMatte' }, 'Technique'), 'smooth'],
            depth: [pct('strengthRatio', 'Depth, percent', 1, 1000), 100],
            direction: [K.choice('bevelDirection', 'bevelEmbossStampStyle', { up: 'stampIn', down: 'stampOut' }, 'Direction'), 'up'],
            size: [px('blur', 'Pixels'), 5],
            soften: [px('softness', 'Pixels', 0, 16), 0],
            angle: [deg('localLightingAngle', 'Light angle in degrees'), 90],
            altitude: [deg('localLightingAltitude', 'Light altitude in degrees', 0, 90), 30],
            useGlobalLight: [K.bool('useGlobalAngle', 'Use Global Light'), true],
            glossContour: [K.contour('transferSpec', 'Gloss contour as [input, output] points, 0-255. Default Linear'), null],
            glossAntiAlias: [K.bool('antialiasGloss', 'Anti-aliased gloss contour'), false],
            highlightMode: [K.mode('highlightMode', 'Highlight blend mode'), 'screen'],
            highlightColor: [K.color('highlightColor', 'Highlight colour'), '#FFFFFF'],
            highlightOpacity: [pct('highlightOpacity', 'Highlight opacity, percent'), 75],
            shadowMode: [K.mode('shadowMode', 'Shadow blend mode'), 'multiply'],
            shadowColor: [K.color('shadowColor', 'Shadow colour'), '#000000'],
            shadowOpacity: [pct('shadowOpacity', 'Shadow opacity, percent'), 75],
        },
        sections: {
            contour: {
                description: 'The Contour sub-page: { points, antiAlias, range }, or false to turn it off',
                key: 'useShape',
                options: { points: [K.contour('mappingShape'), null], antiAlias: [K.bool('antiAlias', 'Anti-aliased'), false], range: [pct('inputRange', 'Range, percent', 1, 100), 50] },
            },
            texture: {
                description: 'The Texture sub-page: { pattern, scale, depth, invert, linkWithLayer }, or false to turn it off',
                key: 'useTexture',
                options: {
                    pattern: [K.pattern(), undefined],
                    scale: [pct('scale', 'Percent', 1, 1000), 100],
                    depth: [pct('textureDepth', 'Percent', -1000, 1000), 100],
                    invert: [K.bool('invertTexture', 'Invert'), false],
                    linkWithLayer: [K.bool('align', 'Link with Layer'), true],
                },
            },
        },
    },
    satin: {
        key: 'chromeFX',
        options: {
            enabled: enabled(),
            blendMode: [K.mode('mode'), 'multiply'],
            color: [K.color('color'), '#000000'],
            opacity: [pct('opacity', 'Percent'), 50],
            angle: [deg('localLightingAngle', 'Degrees'), 19],
            distance: [px('distance', 'Pixels'), 11],
            size: [px('blur', 'Pixels'), 14],
            contour: [K.contour('mappingShape'), null],
            antiAlias: [K.bool('antiAlias', 'Anti-aliased'), true],
            invert: [K.bool('invert', 'Invert'), true],
        },
    },
    colorOverlay: { key: 'solidFill', multi: true, options: { enabled: enabled(), blendMode: [K.mode('mode'), 'normal'], color: [K.color('color'), '#FF0000'], opacity: [pct('opacity', 'Percent'), 100] } },
    gradientOverlay: {
        key: 'gradientFill',
        multi: true,
        options: {
            enabled: enabled(),
            blendMode: [K.mode('mode'), 'normal'],
            opacity: [pct('opacity', 'Percent'), 100],
            gradient: [K.gradient(), ['#000000', '#FFFFFF']],
            style: [GRADIENT_STYLE(), 'linear'],
            angle: [deg('angle', 'Degrees'), 90],
            reverse: [K.bool('reverse', 'Reverse'), false],
            dither: [K.bool('dither', 'Dither'), false],
            alignWithLayer: [K.bool('align', 'Align with Layer'), true],
            scale: [pct('scale', 'Percent', 10, 150), 100],
        },
    },
    patternOverlay: {
        key: 'patternFill',
        options: {
            enabled: enabled(),
            blendMode: [K.mode('mode'), 'normal'],
            opacity: [pct('opacity', 'Percent'), 100],
            pattern: [K.pattern(), undefined],
            scale: [pct('scale', 'Percent', 1, 1000), 100],
            linkWithLayer: [K.bool('align', 'Link with Layer'), true],
        },
    },
    stroke: {
        key: 'frameFX',
        multi: true,
        options: {
            enabled: enabled(),
            size: [px('size', 'Pixels', 1, 250), 3],
            position: [K.choice('style', 'frameStyle', { outside: 'outsetFrame', inside: 'insetFrame', center: 'centeredFrame' }, 'Position'), 'outside'],
            blendMode: [K.mode('mode'), 'normal'],
            opacity: [pct('opacity', 'Percent'), 100],
            overprint: [K.bool('overprint', 'Overprint'), false],
            fill: [K.choice('paintType', 'frameFill', { color: 'solidColor', gradient: 'gradientFill', pattern: 'pattern' }, 'Fill type'), 'color'],
            color: [K.color('color', 'fill color: the colour'), '#000000'],
            gradient: [K.gradient(), undefined],
            gradientStyle: [GRADIENT_STYLE(), undefined],
            angle: [deg('angle', 'fill gradient: degrees'), undefined],
            pattern: [K.pattern(), undefined],
            scale: [pct('scale', 'fill gradient or pattern: percent', 1, 1000), undefined],
        },
    },
};

/** The layerEffects keys, and the names this server gives them. */
const FX_NAMES = Object.fromEntries(Object.entries(EFFECTS).map(([name, e]) => [e.key, name]));

/** Helpers for reading and writing a layerEffects descriptor. */
const FX = String.raw`
var __FX_NAMES = ${JSON.stringify(FX_NAMES)};
var __FX_KEYS = [];
for (var __k in __FX_NAMES) if (__FX_NAMES.hasOwnProperty(__k)) __FX_KEYS.push(__k);
var __fxOf = function (id) {
  var ld = __layerDesc(id);
  return ld.hasKey(__s("layerEffects")) ? ld.getObjectValue(__s("layerEffects")) : null;
};
var __fxList = function (fx, key) {
  var out = [];
  if (fx.hasKey(__s(key + "Multi"))) { var l = fx.getList(__s(key + "Multi")); for (var i = 0; i < l.count; i++) out.push(l.getObjectValue(i)); }
  else if (fx.hasKey(__s(key))) out.push(fx.getObjectValue(__s(key)));
  return out;
};
var __fxRemove = function (fx, key) {
  if (fx.hasKey(__s(key))) fx.erase(__s(key));
  if (fx.hasKey(__s(key + "Multi"))) fx.erase(__s(key + "Multi"));
};
var __fxWrite = function (fx, key, list) {
  __fxRemove(fx, key);
  if (list.length === 1) { fx.putObject(__s(key), __s(key), list[0]); return; }
  var al = new ActionList();
  for (var i = 0; i < list.length; i++) al.putObject(__s(key), list[i]);
  if (list.length) fx.putList(__s(key + "Multi"), al);
};
var __fxCount = function (fx) {
  var n = 0;
  for (var i = 0; i < __FX_KEYS.length; i++) n += __fxList(fx, __FX_KEYS[i]).length;
  return n;
};
var __fxSet = function (id, fx) {
  if (!fx || !__fxCount(fx)) {
    if (__fxOf(id)) __play("disableLayerStyle", __onLayer(id));
    return;
  }
  if (!fx.hasKey(__s("scale"))) fx.putUnitDouble(__s("scale"), __s("percentUnit"), 100);
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putProperty(__s("property"), __s("layerEffects"));
  r.putIdentifier(__s("layer"), id);
  d.putReference(__s("null"), r);
  d.putObject(__s("to"), __s("layerEffects"), fx);
  __play("set", d);
};
var __fxSummary = function (l, detail) {
  var ld = __layerDesc(l.id), o = { id: l.id, name: l.name, visible: null, effects: [] };
  if (ld.hasKey(__s("layerFXVisible"))) o.visible = ld.getBoolean(__s("layerFXVisible"));
  if (!ld.hasKey(__s("layerEffects"))) return o;
  var fx = ld.getObjectValue(__s("layerEffects"));
  for (var i = 0; i < __FX_KEYS.length; i++) {
    var list = __fxList(fx, __FX_KEYS[i]);
    for (var j = 0; j < list.length; j++) {
      var e = list[j], item = { effect: __FX_NAMES[__FX_KEYS[i]], instance: j, enabled: e.hasKey(__s("enabled")) ? e.getBoolean(__s("enabled")) : true };
      if (detail) item.settings = __descJson(e, 3);
      o.effects.push(item);
    }
  }
  return o;
};
`;

/** Check an option object against an option table; returns given entries. */
function checkOptions(given, table, label) {
    if (given === true) return {};
    if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error(`'${label}' must be an options object, true or false`);
    const unknown = Object.keys(given).filter((k) => !(k in table));
    if (unknown.length) throw new Error(`'${label}' has no option ${unknown.join(', ')}. Options: ${Object.keys(table).join(', ')}`);
    return given;
}

/**
 * Statements that build one effect instance into variable `e`: fresh
 * instances start from Photoshop's defaults, existing ones keep the settings
 * not given. `existing` is an expression for the existing descriptor or null.
 */
function effectLines(name, spec, given, existing) {
    const opts = checkOptions(given, { ...spec.options, ...(spec.sections ?? {}), ...(spec.multi ? { instance: null } : {}) }, name);
    const lines = [`var e = ${existing}, isNew = !e;`, 'if (isNew) e = new ActionDescriptor();', 'if (isNew) {', 'e.putBoolean(__s("present"), true); e.putBoolean(__s("showInDialog"), true);'];
    for (const [k, [kind, def]] of Object.entries(spec.options)) {
        if (k in opts || def === undefined) continue;
        lines.push(kind.put(def, 'e', `${name}.${k}`));
    }
    if (name === 'patternOverlay' && !('pattern' in opts)) lines.push('throw new Error("A new patternOverlay needs pattern: { name }");');
    lines.push('}');
    for (const [k, [kind]] of Object.entries(spec.options)) if (k in opts) lines.push(kind.put(opts[k], 'e', `${name}.${k}`));
    for (const [k, section] of Object.entries(spec.sections ?? {})) {
        if (!(k in opts)) continue;
        if (opts[k] === false) { lines.push(`e.putBoolean(__s(${str(section.key)}), false);`); continue; }
        const sub = checkOptions(opts[k], section.options, `${name}.${k}`);
        lines.push(`e.putBoolean(__s(${str(section.key)}), true);`);
        for (const [sk, [kind, def]] of Object.entries(section.options)) {
            const v = sk in sub ? sub[sk] : def;
            if (v === undefined) { if (sk === 'pattern') throw new Error(`${name}.${k} needs pattern: { name }`); continue; }
            lines.push(kind.put(v, 'e', `${name}.${k}.${sk}`));
        }
    }
    if (name === 'stroke') {
        lines.push('if (e.hasKey(__s("paintType")) && app.typeIDToStringID(e.getEnumerationValue(__s("paintType"))) === "pattern" && !e.hasKey(__s("pattern"))) throw new Error("A pattern stroke needs pattern: { name }");');
        lines.push(`if (e.hasKey(__s("paintType")) && app.typeIDToStringID(e.getEnumerationValue(__s("paintType"))) === "gradientFill" && !e.hasKey(__s("gradient"))) { ${K.gradient().put(['#000000', '#FFFFFF'], 'e', 'stroke.gradient')} }`);
    }
    return lines.join('\n');
}

/** Statements that apply the `effects` argument to descriptor `fx`. */
function effectsBody(effects) {
    if (!effects || typeof effects !== 'object' || Array.isArray(effects)) throw new Error("'effects' must be an object such as { dropShadow: { distance: 8 } }");
    const names = Object.keys(effects);
    if (!names.length) throw new Error("'effects' names no effect");
    const out = [];
    for (const name of names) {
        const spec = EFFECTS[enumOf(name, Object.keys(EFFECTS), { name: 'effects' })];
        const value = effects[name];
        const key = str(spec.key);
        if (value === false) { out.push(`__fxRemove(fx, ${key});`); continue; }
        if (Array.isArray(value)) {
            if (!spec.multi) throw new Error(`${name} allows one instance; give an object`);
            if (!value.length) throw new Error(`'${name}' needs at least one instance, or false to remove it`);
            const parts = value.map((v) => `(function () {\n${effectLines(name, spec, v, 'null')}\nreturn e;\n})()`);
            out.push(`__fxWrite(fx, ${key}, [${parts.join(', ')}]);`);
            continue;
        }
        const instance = value && typeof value === 'object' && value.instance !== undefined ? Number(num(value.instance, { min: 0, max: 9, name: `${name}.instance` })) : 0;
        if (instance && !spec.multi) throw new Error(`${name} allows one instance`);
        const own = value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'instance')) : value;
        out.push(`(function () {
var list = __fxList(fx, ${key});
if (${instance} > list.length) throw new Error("${name} has " + list.length + " instance(s)");
${effectLines(name, spec, own, `${instance} < list.length ? list[${instance}] : null`)}
list[${instance}] = e;
__fxWrite(fx, ${key}, list);
})();`);
    }
    return out.join('\n');
}

/** Option help for the set_layer_effects description. */
const effectsHelp = Object.entries(EFFECTS).map(([n, e]) => `${n} (${[...Object.keys(e.options), ...Object.keys(e.sections ?? {})].join(', ')})`).join('; ');

const KNOCKOUT = ['none', 'shallow', 'deep'];
/** Channel names for Advanced Blending and Blend If, as charIDs. */
const CHANNELS = { gray: 'Gry ', red: 'Rd  ', green: 'Grn ', blue: 'Bl  ', cyan: 'Cyn ', magenta: 'Mgnt', yellow: 'Yllw', black: 'Blck', lightness: 'Lght', a: 'A   ', b: 'B   ' };
/** Advanced Blending checkboxes and their layer keys. */
const GROUP_OPTIONS = {
    blendInteriorEffects: 'blendInterior',
    blendClippedLayers: 'blendClipped',
    transparencyShapesLayer: 'transparencyShapesLayer',
    layerMaskHidesEffects: 'layerMaskAsGlobalMask',
    vectorMaskHidesEffects: 'vectorMaskAsGlobalMask',
};
const RANGE = { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 }, minItems: 4, maxItems: 4 };

/** A Blend If range: four ascending levels, 0-255. */
function range4(v, name) {
    if (!Array.isArray(v) || v.length !== 4) throw new Error(`'${name}' takes four levels: [black, black split, white split, white]`);
    const r = v.map((x, i) => Number(num(x, { min: 0, max: 255, name: `${name}[${i}]` })));
    if (!(r[0] <= r[1] && r[1] <= r[2] && r[2] <= r[3])) throw new Error(`'${name}' levels must rise from black to white`);
    return r;
}

export const tools = [
    {
        name: 'set_layer_effects',
        description: `Add, change, hide or remove layer style effects (Layer > Layer Style), as the Layer Style dialog does. effects maps each effect to an options object (omitted options keep the current settings, or Photoshop's defaults for a new effect), true (add or keep with defaults), false (delete the effect), or for dropShadow, innerShadow, colorOverlay, gradientOverlay and stroke a list (several instances, each from defaults). enabled: false hides one effect. Options by effect: ${effectsHelp}. Sizes are pixels, opacities percent, angles degrees`,
        inputSchema: {
            type: 'object',
            properties: {
                target: ACTIVE,
                effects: {
                    type: 'object',
                    description: 'For example { dropShadow: { distance: 8, size: 12 }, stroke: { size: 2, color: "#FFFFFF" }, outerGlow: false }',
                    properties: Object.fromEntries(Object.entries(EFFECTS).map(([n, e]) => [n, { description: `Options: ${[...Object.keys(e.options), ...Object.keys(e.sections ?? {}), ...(e.multi ? ['instance (0-based, which one to change)'] : [])].join(', ')}` }])),
                },
                replace: { type: 'boolean', default: false, description: 'Start from an empty style, dropping effects not given' },
            },
            required: ['effects'],
        },
        auditArgs: { effects: { dropShadow: { distance: 8 }, stroke: [{ size: 2 }, { size: 4, color: '#FFFFFF' }], bevelEmboss: { contour: { points: [[0, 0], [255, 255]] } }, outerGlow: false } },
        features: [
            'photoshop.layer_styles.layer_style_object', 'photoshop.layer_styles.layer_style_dialog', 'photoshop.layer_styles.drop_shadow', 'photoshop.layer_styles.inner_shadow',
            'photoshop.layer_styles.outer_glow', 'photoshop.layer_styles.inner_glow', 'photoshop.layer_styles.bevel_emboss', 'photoshop.layer_styles.satin',
            'photoshop.layer_styles.color_overlay', 'photoshop.layer_styles.gradient_overlay', 'photoshop.layer_styles.pattern_overlay', 'photoshop.layer_styles.stroke',
            'photoshop.layer_styles.bevel_contour', 'photoshop.layer_styles.bevel_texture', 'photoshop.layer_styles.multiple_effect_instances',
            'photoshop.layer_styles.delete_single_effect', 'photoshop.layer_styles.effect_visibility',
        ],
        handler: (a) => {
            const body = effectsBody(a.effects);
            return run('Layer effects', script(`${AM}
${FX}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename === "ArtLayer" && l.isBackgroundLayer) throw new Error("The background layer cannot have a layer style");
  var fx = ${a.replace ? 'null' : '__fxOf(l.id)'};
  if (!fx) fx = new ActionDescriptor();
  ${body}
  __fxSet(l.id, fx);
  out.push(__fxSummary(l, false));
}
__result__ = { layers: out };`));
        },
    },
    {
        name: 'get_layer_effects',
        description: 'Describe layers\' styles: whether effects are shown, and each effect and instance with whether it is on and, with detail, all its settings',
        inputSchema: { type: 'object', properties: { target: ACTIVE, detail: { type: 'boolean', default: false, description: 'Include every setting of each effect' } } },
        hints: { readOnly: true },
        features: ['photoshop.layer_styles.layer_style_object'],
        handler: (a) => run('Get layer effects', script(`${AM}
${FX}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) out.push(__fxSummary(items[i], ${bool(a.detail)}));
__result__ = { layers: out };`)),
    },
    {
        name: 'copy_layer_style',
        description: 'Copy one layer\'s style to other layers (Layer > Layer Style > Copy Layer Style, then Paste Layer Style, which replaces their styles), or copy only some effects, added to their own styles as Option/Alt-dragging an effect does',
        inputSchema: {
            type: 'object',
            properties: {
                source: { ...TARGET_SCHEMA, description: 'The one layer to copy from' },
                target: { ...TARGET_SCHEMA, description: 'The layers to paste onto' },
                effects: { type: 'array', items: { type: 'string', enum: Object.keys(EFFECTS) }, description: 'Copy only these effects (every instance), replacing the same effects on the targets. Default the whole style' },
            },
            required: ['source', 'target'],
        },
        auditArgs: { source: { ids: [3] }, target: { ids: [7] }, effects: undefined },
        features: ['photoshop.layer_styles.copy_layer_style', 'photoshop.layer_styles.paste_layer_style', 'photoshop.layer_styles.drag_copy_effect'],
        handler: (a) => {
            let body;
            if (a.effects !== undefined) {
                if (!Array.isArray(a.effects) || !a.effects.length) throw new Error("'effects' must list at least one effect");
                const keys = a.effects.map((n) => EFFECTS[enumOf(n, Object.keys(EFFECTS), { name: 'effects' })].key);
                body = `
var sfx = __fxOf(src.id), keys = ${JSON.stringify(keys)};
if (!sfx) throw new Error(src.name + " has no layer style");
for (var i = 0; i < items.length; i++) {
  var fx = __fxOf(items[i].id) || new ActionDescriptor();
  for (var k = 0; k < keys.length; k++) {
    var list = __fxList(sfx, keys[k]);
    if (!list.length) throw new Error(src.name + " has no " + __FX_NAMES[keys[k]]);
    __fxWrite(fx, keys[k], list);
  }
  __fxSet(items[i].id, fx);
}`;
            } else {
                body = `
doc.activeLayer = src;
__play("copyEffects", __onTarget());
__selectLayers(items, false);
var pd = __onTarget();
pd.putBoolean(__s("allowPasting"), true);
__play("pasteEffects", pd);`;
            }
            return run('Copy layer style', script(`${AM}
${FX}
var from = __targets(doc, ${targetSpec(a.source)});
if (from.length !== 1) throw new Error("Choose one source layer");
var src = from[0], items = __targets(doc, ${targetSpec(a.target)});
for (var t = 0; t < items.length; t++) if (items[t].id === src.id) throw new Error("The source is among the targets");
${body}
var out = [];
for (var j = 0; j < items.length; j++) out.push(__fxSummary(items[j], false));
__result__ = { layers: out };`));
        },
    },
    {
        name: 'manage_layer_style',
        description: 'Layer style commands (Layer > Layer Style): Clear Layer Style, Rasterize Layer Style (bake the effects into pixels), Scale Effects by a percentage, or hide or show all of a layer\'s effects',
        inputSchema: {
            type: 'object',
            properties: {
                target: ACTIVE,
                action: { type: 'string', enum: ['clear', 'rasterize', 'scale', 'hide_all', 'show_all'] },
                scale: { type: 'number', minimum: 1, maximum: 1000, description: 'scale: percent' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'scale', scale: 50 },
        hints: { destructive: true },
        features: ['photoshop.layer_styles.clear_layer_style', 'photoshop.layer_styles.rasterize_layer_style', 'photoshop.layer_styles.scale_effects', 'photoshop.layer_styles.effect_visibility'],
        handler: (a) => {
            const action = enumOf(a.action, ['clear', 'rasterize', 'scale', 'hide_all', 'show_all'], { name: 'action' });
            if (action === 'scale' && a.scale === undefined) throw new Error("'scale' needs scale (percent)");
            if (action !== 'scale' && a.scale !== undefined) throw new Error("'scale' is only for the scale action");
            const each = {
                clear: '__play("disableLayerStyle", __onTarget());',
                rasterize: 'var d = __onTarget(); d.putEnumerated(__s("what"), __s("rasterizeItem"), __s("layerStyle")); __play("rasterizeLayer", d);',
                scale: `var d = new ActionDescriptor(); d.putUnitDouble(__s("scale"), __s("percentUnit"), ${num(a.scale ?? 100, { min: 1, max: 1000, name: 'scale' })}); __play("scaleEffectsEvent", d);`,
                hide_all: 'var d = new ActionDescriptor(), al = new ActionList(), r = new ActionReference(); r.putClass(__s("layerEffects")); r.putIdentifier(__s("layer"), l.id); al.putReference(r); d.putList(__s("null"), al); __play("hide", d);',
                show_all: 'var d = new ActionDescriptor(), al = new ActionList(), r = new ActionReference(); r.putClass(__s("layerEffects")); r.putIdentifier(__s("layer"), l.id); al.putReference(r); d.putList(__s("null"), al); __play("show", d);',
            }[action];
            return run('Layer style', script(`${AM}
${FX}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (!__fxOf(l.id)) throw new Error(l.name + " has no layer style");
  doc.activeLayer = l;
  ${each}
  out.push(__fxSummary(l, false));
}
__result__ = { layers: out };`));
        },
    },
    {
        name: 'set_blending_options',
        description: 'Set a layer\'s Blending Options (Layer Style dialog): blend mode, opacity and fill opacity; Advanced Blending knockout, the channels it blends into and the group options (Blend Interior Effects as Group, Blend Clipped Layers as Group, Transparency Shapes Layer, Layer Mask Hides Effects, Vector Mask Hides Effects); and Blend If ranges for this layer and the underlying layer',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                blendMode: { type: 'string', enum: Object.keys(BLEND_MODES), description: 'Blend mode' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                fillOpacity: { type: 'number', minimum: 0, maximum: 100, description: 'Fill opacity, percent (pixel, type and shape layers)' },
                knockout: { type: 'string', enum: KNOCKOUT, description: 'Knockout' },
                channels: { type: 'array', items: { type: 'string', enum: Object.keys(CHANNELS) }, description: 'Channels the layer blends into, e.g. ["red", "blue"]; the document\'s own channel names' },
                ...Object.fromEntries(Object.keys(GROUP_OPTIONS).map((k) => [k, { type: 'boolean', description: k.replace(/([A-Z])/g, ' $1').toLowerCase() }])),
                blendIf: {
                    type: 'array',
                    description: 'Blend If, one entry per channel: { channel: "gray" or a colour channel, thisLayer: [black, black split, white split, white], underlyingLayer: [...] }, levels 0-255',
                    items: { type: 'object', properties: { channel: { type: 'string', enum: Object.keys(CHANNELS), description: 'Default gray' }, thisLayer: RANGE, underlyingLayer: RANGE } },
                },
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [7] }, channels: ['red', 'green'], blendIf: [{ channel: 'gray', thisLayer: [0, 20, 255, 255], underlyingLayer: [0, 0, 200, 255] }] },
        hints: { idempotent: true },
        features: ['photoshop.layer_styles.blending_options', 'photoshop.layer_styles.advanced_blending_group_options', 'photoshop.layer_styles.blend_if'],
        handler: (a) => {
            const dom = [];
            if (a.opacity !== undefined) dom.push(`l.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
            if (a.fillOpacity !== undefined) dom.push(`if (l.typename === "ArtLayer") l.fillOpacity = ${num(a.fillOpacity, { min: 0, max: 100, name: 'fillOpacity' })};`);
            if (a.blendMode !== undefined) dom.push(`l.blendMode = BlendMode.${BLEND_MODES[enumOf(a.blendMode, Object.keys(BLEND_MODES), { name: 'blendMode' })]};`);
            const am = [];
            if (a.knockout !== undefined) am.push(`to.putEnumerated(__s("knockout"), __s("knockout"), __s(${str(enumOf(a.knockout, KNOCKOUT, { name: 'knockout' }))}));`);
            if (a.channels !== undefined) {
                if (!Array.isArray(a.channels) || !a.channels.length) throw new Error("'channels' must list at least one channel");
                am.push('var cl = new ActionList();', ...a.channels.map((c) => `cl.putEnumerated(__s("channel"), __c(${str(CHANNELS[enumOf(c, Object.keys(CHANNELS), { name: 'channels' })])}));`), 'to.putList(__s("channelRestrictions"), cl);');
            }
            for (const [k, key] of Object.entries(GROUP_OPTIONS)) if (a[k] !== undefined) am.push(`to.putBoolean(__s(${str(key)}), ${bool(a[k])});`);
            if (a.blendIf !== undefined) {
                if (!Array.isArray(a.blendIf) || !a.blendIf.length) throw new Error("'blendIf' must list at least one channel's ranges");
                am.push('var bl = new ActionList(), br, bc;');
                a.blendIf.forEach((b, i) => {
                    if (!b || typeof b !== 'object') throw new Error(`blendIf[${i}] must be an object`);
                    const ch = CHANNELS[enumOf(b.channel ?? 'gray', Object.keys(CHANNELS), { name: `blendIf[${i}].channel` })];
                    const src = range4(b.thisLayer ?? [0, 0, 255, 255], `blendIf[${i}].thisLayer`);
                    const dst = range4(b.underlyingLayer ?? [0, 0, 255, 255], `blendIf[${i}].underlyingLayer`);
                    am.push(`br = new ActionDescriptor(); bc = new ActionReference(); bc.putEnumerated(__s("channel"), __s("channel"), __c(${str(ch)})); br.putReference(__s("channel"), bc);`);
                    ['srcBlackMin', 'srcBlackMax', 'srcWhiteMin', 'srcWhiteMax'].forEach((k, j) => am.push(`br.putInteger(__s("${k}"), ${src[j]});`));
                    ['destBlackMin', 'destBlackMax', 'destWhiteMin', 'destWhiteMax'].forEach((k, j) => am.push(`br.putInteger(__s("${k}"), ${dst[j]});`));
                    am.push('bl.putObject(__s("blendRange"), br);');
                });
                am.push('to.putList(__s("blendRange"), bl);');
            }
            if (!dom.length && !am.length) throw new Error('Give at least one blending option');
            return run('Blending options', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  ${dom.join('\n  ')}
  ${am.length ? `var to = new ActionDescriptor();\n  ${am.join('\n  ')}\n  __setLayer(l.id, to);` : ''}
}
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`));
        },
    },
    {
        name: 'manage_style_presets',
        description: 'Use the Styles panel: apply a loaded style preset to layers by name (replacing their styles), load a style library (.asl) into the panel, or save the panel\'s styles as a library (Styles panel menu: Load Styles, Save Styles)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['apply', 'load', 'save'] },
                target: { ...TARGET_SCHEMA, description: 'apply: the layers. Default the active layer' },
                style: { type: 'string', description: 'apply: the style\'s name in the Styles panel' },
                file: { type: 'string', description: 'load, save: absolute path of the .asl file' },
                append: { type: 'boolean', default: true, description: 'load: add to the current styles (false replaces them)' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'apply', style: 'Sample', file: undefined },
        features: ['photoshop.layer_styles.styles_panel', 'photoshop.layer_styles.save_load_styles'],
        handler: (a) => {
            const action = enumOf(a.action, ['apply', 'load', 'save'], { name: 'action' });
            if (action === 'apply') {
                if (!a.style) throw new Error("'apply' needs style");
                return run('Apply style', script(`
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
for (var i = 0; i < items.length; i++) {
  if (items[i].typename !== "ArtLayer" || items[i].isBackgroundLayer) throw new Error(items[i].name + ": styles apply to layers other than the background, not to groups");
  items[i].applyStyle(${str(a.style)});
}
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`));
            }
            if (!a.file) throw new Error(`'${action}' needs file`);
            const p = paths.validate(a.file);
            if (!/\.asl$/i.test(p)) throw new Error('Style libraries are .asl files');
            return run(action === 'load' ? 'Load styles' : 'Save styles', script(`${AM}
var f = new File(${jsxPath(p)});
${action === 'load' ? 'if (!f.exists) throw new Error("File not found: " + f.fsName);' : 'if (!f.parent.exists) throw new Error("Folder not found: " + f.parent.fsName);'}
var r = new ActionReference(), d = new ActionDescriptor();
r.putProperty(__s("property"), __s("styleClass"));
r.putEnumerated(__s("application"), __s("ordinal"), __s("targetEnum"));
${action === 'load' ? `d.putReference(__s("null"), r);
d.putPath(__s("to"), f);
d.putBoolean(__s("append"), ${bool(a.append ?? true)});` : `d.putPath(__s("null"), f);
d.putReference(__s("to"), r);`}
__play("set", d);
__result__ = { ${action === 'load' ? 'loaded' : 'saved'}: f.fsName };`, { needsDocument: false }));
        },
    },
];
