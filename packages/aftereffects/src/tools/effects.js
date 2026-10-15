/**
 * Effects: list what is installed, apply effects to layers with property
 * values, read and remove them, and apply animation presets.
 */
import { str, index, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec, propertyValue } from '../args.js';
import { paths } from './project.js';

export const tools = [
    {
        name: 'list_effects',
        description: 'List the effects installed in After Effects with their display name, match name and category, filtered by a search string. Match names are what apply_effect takes most reliably',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 2000, default: 100 } } },
        hints: { readOnly: true },
        features: [],
        handler: (a) => run('List effects', script(`
var q = ${str(String(a.query ?? '').toLowerCase())}, max = ${index(a.limit ?? 100, { name: 'limit', max: 2000 })}, out = [], total = 0;
for (var i = 0; i < app.effects.length; i++) {
  var e = app.effects[i];
  if (q && (e.displayName + " " + e.matchName + " " + e.category).toLowerCase().indexOf(q) < 0) continue;
  total++;
  if (out.length < max) out.push({ displayName: e.displayName, matchName: e.matchName, category: e.category });
}
__result__ = { total: total, effects: out };`)),
    },
    {
        name: 'apply_effect',
        description: 'Apply an effect to layers (Effect menu) by match name (e.g. "ADBE Gaussian Blur 2") or display name, optionally setting its properties by name, e.g. { "Blurriness": 20 }',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                effect: { type: 'string', description: 'Match name or display name' },
                name: { type: 'string', description: 'Rename the applied effect' },
                properties: { type: 'object', description: 'Property display names to values (numbers, arrays, booleans)' },
            },
            required: ['layers', 'effect'],
        },
        auditArgs: { effect: 'ADBE Gaussian Blur 2', properties: { Blurriness: 12 } },
        features: [],
        handler: (a) => {
            const props = Object.entries(a.properties ?? {}).map(([k, v]) => [String(k), JSON.parse(propertyValue(v, `properties.${k}`))]);
            return run('Apply effect', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), props = ${json(props)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade");
  if (!parade.canAddProperty(${str(a.effect)})) throw new Error(${str(a.effect)} + " is not an effect After Effects can add (list_effects)");
  var fx = parade.addProperty(${str(a.effect)});
  ${a.name ? `fx.name = ${str(a.name)};` : ''}
  for (var k = 0; k < props.length; k++) {
    var p = fx.property(props[k][0]);
    if (!p) throw new Error(fx.name + " has no property " + props[k][0]);
    p.setValue(props[k][1]);
  }
  out.push({ layer: ls[i].index, effect: fx.name, matchName: fx.matchName, index: fx.propertyIndex });
}
__result__ = { applied: out };`, { undo: 'Apply effect' }));
        },
    },
    {
        name: 'list_layer_effects',
        description: 'List the effects on layers, in order, with each effect\'s properties and values',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA }, required: ['layers'] },
        hints: { readOnly: true },
        features: [],
        handler: (a) => run('List layer effects', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade"), fxs = [];
  for (var f = 1; f <= parade.numProperties; f++) {
    var fx = parade.property(f), props = [];
    for (var p = 1; p <= fx.numProperties; p++) {
      var pr = fx.property(p);
      if (pr.propertyType !== PropertyType.PROPERTY) continue;
      var v = null;
      try { v = pr.value; } catch (e) {}
      props.push({ name: pr.name, value: v, keys: pr.numKeys });
    }
    fxs.push({ index: f, name: fx.name, matchName: fx.matchName, enabled: fx.enabled, properties: props });
  }
  out.push({ layer: ls[i].index, effects: fxs });
}
__result__ = { layers: out };`)),
    },
    {
        name: 'remove_effects',
        description: 'Remove effects from layers by name or index, or all of them, or turn them off and on',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                effects: { type: 'array', items: { type: 'string' }, description: 'Effect names; omit for all' },
                enabled: { type: 'boolean', description: 'Turn the effects on or off instead of removing them' },
            },
            required: ['layers'],
        },
        hints: { destructive: true },
        features: [],
        handler: (a) => run('Remove effects', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), names = ${json((a.effects ?? []).map(String))}, done = 0;
for (var i = 0; i < ls.length; i++) {
  var parade = ls[i].property("ADBE Effect Parade");
  for (var f = parade.numProperties; f >= 1; f--) {
    var fx = parade.property(f), hit = !names.length;
    for (var n = 0; n < names.length; n++) if (fx.name === names[n]) hit = true;
    if (!hit) continue;
    ${a.enabled !== undefined ? `fx.enabled = ${a.enabled ? 'true' : 'false'};` : 'fx.remove();'}
    done++;
  }
}
__result__ = { ${a.enabled !== undefined ? 'changed' : 'removed'}: done };`, { undo: 'Remove effects' })),
    },
    {
        name: 'apply_preset',
        description: 'Apply an animation preset (.ffx) to layers (Animation > Apply Animation Preset)',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA, presetFile: { type: 'string', description: 'Absolute .ffx path' } }, required: ['layers', 'presetFile'] },
        auditArgs: { presetFile: `${process.env.HOME ?? '/tmp'}/Documents/preset.ffx` },
        features: [],
        handler: (a) => {
            const p = paths.validate(a.presetFile);
            return run('Apply preset', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
for (var i = 0; i < ls.length; i++) ls[i].applyPreset(f);
__result__ = { applied: f.fsName, layers: ls.length };`, { undo: 'Apply preset' }));
        },
    },
];
