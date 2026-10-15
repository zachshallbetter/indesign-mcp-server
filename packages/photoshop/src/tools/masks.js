/**
 * Masks: layer masks (add, apply, delete, enable, link, invert, target, load
 * as a selection, copy or move), vector masks, mask density and feather,
 * clipping masks, Quick Mask, and refining a mask with Select and Mask or
 * Color Range. Creating and editing masks is Action Manager; density, feather,
 * clipping and Quick Mask are object-model properties.
 */
import { num, bool, enumOf, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM } from '../action-manager.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const ACTIVE = { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. Default the active layer` };

/** Mask helpers: what masks a layer has, and the mask commands on the active layer. */
const MASK = String.raw`
var __maskState = function (l) {
  var d = __layerDesc(l.id), o = { id: l.id, name: l.name, layerMask: false, vectorMask: false, filterMask: false };
  if (d.hasKey(__s("hasUserMask"))) o.layerMask = d.getBoolean(__s("hasUserMask"));
  if (d.hasKey(__s("hasVectorMask"))) o.vectorMask = d.getBoolean(__s("hasVectorMask"));
  if (d.hasKey(__s("hasFilterMask"))) o.filterMask = d.getBoolean(__s("hasFilterMask"));
  if (o.layerMask && d.hasKey(__s("userMaskEnabled"))) o.layerMaskEnabled = d.getBoolean(__s("userMaskEnabled"));
  if (o.layerMask && d.hasKey(__s("userMaskLinked"))) o.layerMaskLinked = d.getBoolean(__s("userMaskLinked"));
  if (o.vectorMask && d.hasKey(__s("vectorMaskEnabled"))) o.vectorMaskEnabled = d.getBoolean(__s("vectorMaskEnabled"));
  if (l.typename === "ArtLayer") {
    o.clipped = l.grouped;
    if (o.layerMask) { try { o.layerMaskDensity = l.layerMaskDensity; o.layerMaskFeather = l.layerMaskFeather; } catch (e) {} }
    if (o.vectorMask) { try { o.vectorMaskDensity = l.vectorMaskDensity; o.vectorMaskFeather = l.vectorMaskFeather; } catch (e) {} }
    if (o.filterMask) { try { o.filterMaskDensity = l.filterMaskDensity; o.filterMaskFeather = l.filterMaskFeather; } catch (e) {} }
  }
  return o;
};
var __maskRef = function (id) {
  var r = new ActionReference();
  r.putEnumerated(__s("channel"), __s("channel"), __s("mask"));
  if (id !== undefined) r.putIdentifier(__s("layer"), id);
  return r;
};
var __needMask = function (l) { if (!__maskState(l).layerMask) throw new Error(l.name + " has no layer mask"); };
var __addMask = function (l, how) {
  if (__maskState(l).layerMask) throw new Error(l.name + " already has a layer mask");
  doc.activeLayer = l;
  var d = new ActionDescriptor(), r = new ActionReference();
  d.putClass(__s("new"), __s("channel"));
  r.putEnumerated(__s("channel"), __s("channel"), __s("mask"));
  d.putReference(__s("at"), r);
  d.putEnumerated(__s("using"), __s("userMaskEnabled"), __s(how));
  __play("make", d);
};
var __dropMask = function (l, apply) {
  doc.activeLayer = l;
  var d = new ActionDescriptor();
  d.putReference(__s("null"), __maskRef());
  d.putBoolean(__s("apply"), apply);
  __play("delete", d);
};
var __loadMask = function (l) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putProperty(__s("channel"), __s("selection"));
  d.putReference(__s("null"), r);
  d.putReference(__s("to"), __maskRef(l.id));
  __play("set", d);
};
var __composite = function () {
  var m = doc.mode;
  return m === DocumentMode.CMYK ? "CMYK" : m === DocumentMode.LAB ? "lab" : m === DocumentMode.GRAYSCALE ? "black" : "RGB";
};
var __targetChannel = function (mask, show) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(__s("channel"), __s("channel"), __s(mask ? "mask" : __composite()));
  d.putReference(__s("null"), r);
  d.putBoolean(__s("makeVisible"), show);
  __play("select", d);
};
`;

const MASK_ACTIONS = ['add', 'apply', 'delete', 'enable', 'disable', 'link', 'unlink', 'invert', 'target_mask', 'target_layer', 'load_selection', 'copy_to', 'move_to'];
const REVEAL = { reveal_all: 'revealAll', hide_all: 'hideAll', reveal_selection: 'revealSelection', hide_selection: 'hideSelection' };
const COLOR_SETS = {
    reds: ['c', 'Rds '], yellows: ['c', 'Ylws'], greens: ['c', 'Grns'], cyans: ['c', 'Cyns'], blues: ['c', 'Bls '], magentas: ['c', 'Mgnt'],
    highlights: ['c', 'Hghl'], midtones: ['c', 'Mdtn'], shadows: ['c', 'Shdw'], skin_tones: ['s', 'skinTone'],
};

const RESULT = `
var out = [];
for (var k = 0; k < items.length; k++) out.push(__maskState(items[k]));
__result__ = { layers: out };`;

/** Script header shared by the mask tools: helpers and the target layers. */
const head = (target) => `${AM}
${MASK}
var items = __targets(doc, ${targetSpec(target ?? { active: true })});`;

export const tools = [
    {
        name: 'edit_layer_mask',
        description: 'Work with layer masks (Layer > Layer Mask and the Layers panel): add a mask (Reveal All, Hide All, Reveal Selection or Hide Selection), apply it to the pixels, delete it, disable or enable it, link or unlink it from the layer, invert it, target the mask or the layer content for editing, load the mask as a selection, or copy or move it to another layer',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: MASK_ACTIONS },
                target: ACTIVE,
                reveal: { type: 'string', enum: Object.keys(REVEAL), description: 'add: what the new mask shows. Default reveal_selection when there is a selection, otherwise reveal_all' },
                showAlone: { type: 'boolean', default: false, description: 'target_mask: show the mask by itself in the document window' },
                invert: { type: 'boolean', default: false, description: 'load_selection: select the hidden area instead' },
                to: { type: 'integer', minimum: 1, description: 'copy_to, move_to: id of the layer that receives the mask; it must not have one' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'add', to: undefined },
        features: [
            'photoshop.masks.layer_mask', 'photoshop.masks.add_layer_mask', 'photoshop.masks.layer_mask_reveal_all', 'photoshop.masks.layer_mask_hide_all',
            'photoshop.masks.layer_mask_reveal_selection', 'photoshop.masks.layer_mask_hide_selection', 'photoshop.masks.apply_layer_mask',
            'photoshop.masks.delete_layer_mask', 'photoshop.masks.disable_layer_mask', 'photoshop.masks.link_layer_mask', 'photoshop.masks.target_mask_channel',
            'photoshop.masks.invert_mask', 'photoshop.masks.load_mask_as_selection', 'photoshop.masks.copy_mask_to_layer',
        ],
        handler: (a) => {
            const action = enumOf(a.action, MASK_ACTIONS, { name: 'action' });
            if (a.reveal !== undefined && action !== 'add') throw new Error("'reveal' is for add");
            const moving = action === 'copy_to' || action === 'move_to';
            if (moving && a.to === undefined) throw new Error(`'${action}' needs to (a layer id)`);
            if (!moving && a.to !== undefined) throw new Error("'to' is for copy_to and move_to");
            const reveal = a.reveal !== undefined ? str(REVEAL[enumOf(a.reveal, Object.keys(REVEAL), { name: 'reveal' })]) : '__hasSelection() ? "revealSelection" : "revealAll"';
            const flag = (key, value) => `__needMask(l); var to = new ActionDescriptor(); to.putBoolean(__s("${key}"), ${value}); __setLayer(l.id, to);`;
            const each = {
                add: `__addMask(l, ${reveal});`,
                apply: '__needMask(l); __dropMask(l, true);',
                delete: '__needMask(l); __dropMask(l, false);',
                enable: flag('userMaskEnabled', 'true'),
                disable: flag('userMaskEnabled', 'false'),
                link: flag('userMaskLinked', 'true'),
                unlink: flag('userMaskLinked', 'false'),
                invert: '__needMask(l); doc.activeLayer = l; __targetChannel(true, false); __play("invert"); __targetChannel(false, false);',
                target_mask: `__needMask(l); doc.activeLayer = l; __targetChannel(true, ${bool(a.showAlone)});`,
                target_layer: 'doc.activeLayer = l; __targetChannel(false, false);',
                load_selection: `__needMask(l); __loadMask(l);${a.invert ? ' doc.selection.invert();' : ''}`,
                copy_to: '__copyMask(l, false);',
                move_to: '__copyMask(l, true);',
            }[action];
            const copy = moving ? `
var dest = __layerById(doc, ${num(a.to, { min: 1, name: 'to' })});
var __copyMask = function (l, move) {
  __needMask(l);
  if (dest.id === l.id) throw new Error("to must be another layer");
  if (__maskState(dest).layerMask) throw new Error(dest.name + " already has a layer mask; delete it first");
  doc.activeLayer = dest;
  var d = new ActionDescriptor();
  d.putClass(__s("new"), __s("channel"));
  d.putReference(__s("at"), __maskRef(dest.id));
  d.putReference(__s("using"), __maskRef(l.id));
  __play("make", d);
  if (move) __dropMask(l, false);
};
if (items.length !== 1) throw new Error("Copy or move one layer's mask at a time");
items.push(dest);` : '';
            return run('Layer mask', script(`${head(a.target)}
${copy}
var count = ${moving ? '1' : 'items.length'};
for (var i = 0; i < count; i++) {
  var l = items[i];
  ${each}
}
${RESULT}`));
        },
    },
    {
        name: 'set_mask_properties',
        description: 'Set the Density (opacity) and Feather of a layer\'s layer mask, vector mask or smart-filter mask (Properties panel, masks)',
        inputSchema: {
            type: 'object',
            properties: {
                target: ACTIVE,
                mask: { type: 'string', enum: ['layer', 'vector', 'filter'], description: 'Which mask. Default layer' },
                density: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels' },
            },
        },
        hints: { idempotent: true },
        features: ['photoshop.masks.layer_mask', 'photoshop.masks.vector_mask', 'photoshop.masks.mask_density', 'photoshop.masks.mask_feather', 'photoshop.masks.properties_panel_masks', 'photoshop.smart_objects.filter_mask'],
        handler: (a) => {
            const mask = enumOf(a.mask ?? 'layer', ['layer', 'vector', 'filter'], { name: 'mask' });
            if (a.density === undefined && a.feather === undefined) throw new Error('Give density, feather or both');
            const lines = [];
            if (a.density !== undefined) lines.push(`l.${mask}MaskDensity = ${num(a.density, { min: 0, max: 100, name: 'density' })};`);
            if (a.feather !== undefined) lines.push(`l.${mask}MaskFeather = ${num(a.feather, { min: 0, max: 1000, name: 'feather' })};`);
            return run('Mask properties', script(`${head(a.target)}
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename !== "ArtLayer") throw new Error(l.name + " is a group; set a group's mask density and feather in the Properties panel");
  if (!__maskState(l).${mask}Mask) throw new Error(l.name + " has no ${mask} mask");
  ${lines.join('\n  ')}
}
${RESULT}`));
        },
    },
    {
        name: 'edit_vector_mask',
        description: 'Work with vector masks (Layer > Vector Mask): make one from a path (Current Path), disable or enable it, or delete it. Rasterize a vector mask with rasterize_layers',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create_from_path', 'enable', 'disable', 'delete'] },
                target: ACTIVE,
                path: { type: 'string', description: 'create_from_path: the path\'s name in the Paths panel. Default the selected path or work path' },
            },
            required: ['action'],
        },
        auditArgs: { path: 'Path 1' },
        features: ['photoshop.masks.vector_mask', 'photoshop.masks.vector_mask_current_path', 'photoshop.masks.vector_mask_disable'],
        handler: (a) => {
            const action = enumOf(a.action, ['create_from_path', 'enable', 'disable', 'delete'], { name: 'action' });
            if (a.path !== undefined && action !== 'create_from_path') throw new Error("'path' is for create_from_path");
            const vectorRef = 'var vr = new ActionReference(); vr.putEnumerated(__s("path"), __s("path"), __s("vectorMask")); vr.putEnumerated(__s("layer"), __s("ordinal"), __s("targetEnum"));';
            const need = 'if (!__maskState(l).vectorMask) throw new Error(l.name + " has no vector mask");';
            const each = {
                create_from_path: `
  if (__maskState(l).vectorMask) throw new Error(l.name + " already has a vector mask");
  doc.activeLayer = l;
  var d = new ActionDescriptor(), pr = new ActionReference(), src = new ActionReference();
  pr.putClass(__s("path"));
  d.putReference(__s("null"), pr);
  ${vectorRef}
  d.putReference(__s("at"), vr);
  ${a.path !== undefined ? `src.putName(__s("path"), ${str(a.path)});` : 'src.putEnumerated(__s("path"), __s("ordinal"), __s("targetEnum"));'}
  d.putReference(__s("using"), src);
  __play("make", d);`,
                enable: `${need} var to = new ActionDescriptor(); to.putBoolean(__s("vectorMaskEnabled"), true); __setLayer(l.id, to);`,
                disable: `${need} var to = new ActionDescriptor(); to.putBoolean(__s("vectorMaskEnabled"), false); __setLayer(l.id, to);`,
                delete: `${need} doc.activeLayer = l; ${vectorRef} var d = new ActionDescriptor(); d.putReference(__s("null"), vr); __play("delete", d);`,
            }[action];
            const check = action !== 'create_from_path' ? '' : a.path !== undefined
                ? `var found = false; for (var p = 0; p < doc.pathItems.length; p++) if (doc.pathItems[p].name === ${str(a.path)}) found = true;
if (!found) throw new Error("No path named " + ${str(a.path)});`
                : 'if (!doc.pathItems.length) throw new Error("The document has no paths; draw one or name one with path");';
            return run('Vector mask', script(`${head(a.target)}
${check}
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  ${each}
}
${RESULT}`));
        },
    },
    {
        name: 'set_clipping_mask',
        description: 'Clip layers to the layer below them (Layer > Create Clipping Mask), so they show only where it has pixels, or release them (Layer > Release Clipping Mask)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, action: { type: 'string', enum: ['create', 'release'] } }, required: ['target', 'action'] },
        hints: { idempotent: true },
        features: ['photoshop.masks.clipping_mask', 'photoshop.masks.create_clipping_mask', 'photoshop.masks.release_clipping_mask'],
        handler: (a) => {
            const clip = enumOf(a.action, ['create', 'release'], { name: 'action' }) === 'create';
            return run('Clipping mask', script(`${head(a.target)}
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename === "ArtLayer") {
    if (l.isBackgroundLayer) throw new Error("The background layer cannot be clipped");
    l.grouped = ${bool(clip)};
  } else {
    doc.activeLayer = l;
    __play(${clip ? '"groupEvent"' : '"ungroup"'}, __onTarget());
  }
}
${RESULT}`));
        },
    },
    {
        name: 'set_quick_mask',
        description: 'Turn Quick Mask Mode on (the selection becomes a red overlay that painting edits) or off (the overlay becomes the selection again)',
        inputSchema: { type: 'object', properties: { enabled: { type: 'boolean', description: 'true enters Quick Mask Mode, false leaves it' } }, required: ['enabled'] },
        hints: { idempotent: true },
        features: ['photoshop.masks.quick_mask_mode'],
        handler: (a) => {
            if (typeof a.enabled !== 'boolean') throw new Error("'enabled' must be true or false");
            return run('Quick mask', script(`
doc.quickMaskMode = ${bool(a.enabled)};
__result__ = { quickMask: doc.quickMaskMode };`));
        },
    },
    {
        name: 'refine_mask',
        description: 'Refine a layer mask\'s edges as Select and Mask does, writing the result back to the layer mask. Without a mask, the current selection is refined into a new mask',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One layer. Default the active layer' },
                radius: { type: 'number', minimum: 0, maximum: 250, description: 'Edge detection radius in pixels. Default 0' },
                smartRadius: { type: 'boolean', default: false, description: 'Smart Radius' },
                smooth: { type: 'integer', minimum: 0, maximum: 100, description: 'Default 0' },
                feather: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels. Default 0' },
                contrast: { type: 'number', minimum: 0, maximum: 100, description: 'Percent. Default 0' },
                shiftEdge: { type: 'number', minimum: -100, maximum: 100, description: 'Percent; negative moves the edge in. Default 0' },
            },
        },
        features: ['photoshop.masks.refine_mask'],
        handler: (a) => {
            const v = (k, min, max, d) => num(a[k] ?? d, { min, max, name: k });
            return run('Refine mask', script(`${head(a.target)}
if (items.length !== 1) throw new Error("Refine one layer's mask at a time");
var l = items[0];
doc.activeLayer = l;
if (__maskState(l).layerMask) { __loadMask(l); __dropMask(l, false); }
else if (!__hasSelection()) throw new Error(l.name + " has no layer mask and nothing is selected");
var d = new ActionDescriptor();
d.putEnumerated(__s("presetKind"), __s("presetKindType"), __s("presetKindCustom"));
d.putUnitDouble(__s("smartBrushRadius"), __s("pixelsUnit"), ${v('radius', 0, 250, 0)});
d.putInteger(__s("smartBrushSmooth"), ${v('smooth', 0, 100, 0)});
d.putUnitDouble(__s("smartBrushFeather"), __s("pixelsUnit"), ${v('feather', 0, 1000, 0)});
d.putUnitDouble(__s("smartBrushContrast"), __s("percentUnit"), ${v('contrast', 0, 100, 0)});
d.putUnitDouble(__s("smartBrushShiftEdge"), __s("percentUnit"), ${v('shiftEdge', -100, 100, 0)});
d.putBoolean(__s("sampleAllLayers"), false);
d.putBoolean(__s("smartBrushUseSmartRadius"), ${bool(a.smartRadius)});
d.putBoolean(__s("smartBrushDecontaminate"), false);
d.putEnumerated(__s("refineEdgeOutput"), __s("refineEdgeOutput"), __s("selectionOutputToUserMask"));
__play("smartBrushWorkspace", d);
${RESULT}`));
        },
    },
    {
        name: 'mask_by_color_range',
        description: 'Make a layer\'s mask from a colour range (Properties panel, masks: Color Range): a sampled colour with a fuzziness, or a preset range such as reds, highlights or skin tones. Replaces the layer\'s existing mask',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One layer. Default the active layer' },
                colors: { type: 'string', enum: ['sampled', ...Object.keys(COLOR_SETS)], description: 'Default sampled' },
                color: { ...COLOR_SCHEMA, description: `sampled: the colour to keep. ${COLOR_SCHEMA.description}` },
                fuzziness: { type: 'integer', minimum: 0, maximum: 200, description: 'sampled: how far from the colour still counts. Default 40' },
                invert: { type: 'boolean', default: false, description: 'Mask out the range instead of keeping it' },
            },
        },
        auditArgs: { colors: 'sampled', color: '#3366CC' },
        features: ['photoshop.masks.mask_color_range'],
        handler: (a) => {
            const colors = enumOf(a.colors ?? 'sampled', ['sampled', ...Object.keys(COLOR_SETS)], { name: 'colors' });
            let range;
            if (colors === 'sampled') {
                if (a.color === undefined) throw new Error("'sampled' needs color");
                range = `
var c = __color(${colorSpec(a.color)}), lab = new ActionDescriptor();
lab.putDouble(__c("Lmnc"), c.lab.L); lab.putDouble(__c("A   "), c.lab.A); lab.putDouble(__c("B   "), c.lab.B);
d.putInteger(__s("fuzziness"), ${num(a.fuzziness ?? 40, { min: 0, max: 200, name: 'fuzziness' })});
d.putObject(__s("minimum"), __s("labColor"), lab);
d.putObject(__s("maximum"), __s("labColor"), lab);`;
            } else {
                if (a.color !== undefined || a.fuzziness !== undefined) throw new Error("'color' and 'fuzziness' are for sampled");
                const [form, id] = COLOR_SETS[colors];
                range = `d.putEnumerated(__s("colors"), __s("colors"), ${form === 'c' ? `__c(${str(id)})` : `__s(${str(id)})`});`;
            }
            return run('Mask by colour range', script(`${head(a.target)}
if (items.length !== 1) throw new Error("Choose one layer");
var l = items[0];
doc.activeLayer = l;
doc.selection.deselect();
var d = new ActionDescriptor();
${range}
${a.invert ? 'd.putBoolean(__s("invert"), true);' : ''}
__play("colorRange", d);
if (!__hasSelection()) throw new Error("Color Range selected nothing");
if (__maskState(l).layerMask) __dropMask(l, false);
__addMask(l, "revealSelection");
doc.selection.deselect();
${RESULT}`));
        },
    },
];
