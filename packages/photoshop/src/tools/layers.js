/**
 * Layers and groups: list, create, set properties, select, arrange, group,
 * duplicate, delete, merge, move, transform, rasterize and link.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

export const BLEND_MODES = {
    normal: 'NORMAL', dissolve: 'DISSOLVE', darken: 'DARKEN', multiply: 'MULTIPLY', color_burn: 'COLORBURN', linear_burn: 'LINEARBURN',
    darker_color: 'DARKERCOLOR', lighten: 'LIGHTEN', screen: 'SCREEN', color_dodge: 'COLORDODGE', linear_dodge: 'LINEARDODGE',
    lighter_color: 'LIGHTERCOLOR', overlay: 'OVERLAY', soft_light: 'SOFTLIGHT', hard_light: 'HARDLIGHT', vivid_light: 'VIVIDLIGHT',
    linear_light: 'LINEARLIGHT', pin_light: 'PINLIGHT', hard_mix: 'HARDMIX', difference: 'DIFFERENCE', exclusion: 'EXCLUSION',
    subtract: 'SUBTRACT', divide: 'DIVIDE', hue: 'HUE', saturation: 'SATURATION', color: 'COLORBLEND', luminosity: 'LUMINOSITY',
    pass_through: 'PASSTHROUGH',
};
const ANCHORS = {
    top_left: 'TOPLEFT', top: 'TOPCENTER', top_right: 'TOPRIGHT', left: 'MIDDLELEFT', center: 'MIDDLECENTER',
    right: 'MIDDLERIGHT', bottom_left: 'BOTTOMLEFT', bottom: 'BOTTOMCENTER', bottom_right: 'BOTTOMRIGHT',
};
const RASTERIZE = { entire_layer: 'ENTIRELAYER', fill: 'FILLCONTENT', vector_mask: 'LAYERCLIPPINGPATH', linked: 'LINKEDLAYERS', shape: 'SHAPE', type: 'TEXTCONTENTS' };

const LAYER_OPTIONS = {
    name: { type: 'string' },
    opacity: { type: 'number', minimum: 0, maximum: 100 },
    fillOpacity: { type: 'number', minimum: 0, maximum: 100, description: 'Fill opacity: affects pixels but not layer styles' },
    blendMode: { type: 'string', enum: Object.keys(BLEND_MODES) },
    visible: { type: 'boolean' },
};

/** Statements that apply LAYER_OPTIONS to variable `l`. */
function layerOptionLines(a) {
    const lines = [];
    if (a.name !== undefined) lines.push(`l.name = ${str(a.name)};`);
    if (a.opacity !== undefined) lines.push(`l.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
    if (a.fillOpacity !== undefined) lines.push(`if (l.typename === "ArtLayer") l.fillOpacity = ${num(a.fillOpacity, { min: 0, max: 100, name: 'fillOpacity' })};`);
    if (a.blendMode !== undefined) lines.push(`l.blendMode = BlendMode.${BLEND_MODES[enumOf(a.blendMode, Object.keys(BLEND_MODES), { name: 'blendMode' })]};`);
    if (a.visible !== undefined) lines.push(`l.visible = ${bool(a.visible)};`);
    return lines;
}

const RESULT = `
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`;

export const tools = [
    {
        name: 'list_layers',
        description: 'List the layers and groups, top to bottom, with id, name, kind (pixel, text, smart object, adjustment, shape...), visibility, opacity, blend mode, lock, bounds in pixels and parent group. Ids are what other tools take in target.ids',
        inputSchema: {
            type: 'object',
            properties: {
                group: { type: 'integer', description: 'Only inside this group (id)' },
                depth: { type: 'integer', minimum: 0, description: 'How many group levels to descend. Default all' },
            },
        },
        hints: { readOnly: true },
        features: ['photoshop.layers.layer_object', 'photoshop.layers.layer_group_object', 'photoshop.layers.background_layer'],
        handler: (a) => run('List layers', script(`
var root = ${a.group !== undefined ? `__layerById(doc, ${index(a.group, { name: 'group' })})` : 'doc'}, max = ${a.depth !== undefined ? index(a.depth, { name: 'depth' }) : 1000}, out = [];
__eachLayer(root, function (l, d) { if (d <= max) { var i = __layerInfo(l); i.depth = d; out.push(i); } });
var active = null;
try { active = doc.activeLayer.id; } catch (e) {}
__result__ = { active: active, count: out.length, layers: out };`)),
    },
    {
        name: 'create_layer',
        description: 'Add a new empty pixel layer or a group above the active layer, or inside a group',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['layer', 'group'], description: 'Default layer' },
                group: { type: 'integer', description: 'Create inside this group (id)' },
                ...LAYER_OPTIONS,
            },
        },
        features: ['photoshop.layers.new_layer', 'photoshop.layers.new_group', 'photoshop.layers.layer_opacity', 'photoshop.layers.fill_opacity', 'photoshop.layers.blend_mode', 'photoshop.layers.show_hide_layers'],
        handler: (a) => {
            const type = enumOf(a.type ?? 'layer', ['layer', 'group'], { name: 'type' });
            return run('Create layer', script(`
var parent = ${a.group !== undefined ? `__layerById(doc, ${index(a.group, { name: 'group' })})` : 'doc'};
if (parent.typename !== "Document" && parent.typename !== "LayerSet") throw new Error("group must be a group");
var l = ${type === 'group' ? 'parent.layerSets.add()' : 'parent.artLayers.add()'};
${layerOptionLines(a).join('\n')}
doc.activeLayer = l;
__result__ = __layerInfo(l);`));
        },
    },
    {
        name: 'set_layer_properties',
        description: 'Rename layers and set their opacity, fill opacity, blend mode, visibility and locks',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                ...LAYER_OPTIONS,
                locked: { type: 'boolean', description: 'Lock all' },
                lockPixels: { type: 'boolean', description: 'Lock image pixels (pixel layers)' },
                lockPosition: { type: 'boolean', description: 'Lock position (pixel layers)' },
                lockTransparency: { type: 'boolean', description: 'Lock transparent pixels (pixel layers)' },
            },
            required: ['target'],
        },
        hints: { idempotent: true },
        features: ['photoshop.layers.rename_layer', 'photoshop.layers.layer_opacity', 'photoshop.layers.fill_opacity', 'photoshop.layers.blend_mode', 'photoshop.layers.show_hide_layers', 'photoshop.layers.lock_all', 'photoshop.layers.lock_image_pixels', 'photoshop.layers.lock_position', 'photoshop.layers.lock_transparent_pixels'],
        handler: (a) => {
            const lines = layerOptionLines(a);
            if (a.locked !== undefined) lines.push(`l.allLocked = ${bool(a.locked)};`);
            if (a.lockPixels !== undefined) lines.push(`if (l.typename === "ArtLayer") l.pixelsLocked = ${bool(a.lockPixels)};`);
            if (a.lockPosition !== undefined) lines.push(`if (l.typename === "ArtLayer") l.positionLocked = ${bool(a.lockPosition)};`);
            if (a.lockTransparency !== undefined) lines.push(`if (l.typename === "ArtLayer") l.transparentPixelsLocked = ${bool(a.lockTransparency)};`);
            if (!lines.length) throw new Error('Give at least one property to set');
            if (a.name !== undefined && targetCount(a.target) > 1) throw new Error('Rename one layer at a time');
            return run('Set layer properties', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  ${lines.join('\n  ')}
}
${RESULT}`));
        },
    },
    {
        name: 'set_active_layer',
        description: 'Make a layer the active one; many commands work on the active layer',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        hints: { idempotent: true },
        features: ['photoshop.layers.select_layer'],
        handler: (a) => run('Set active layer', script(`
var items = __targets(doc, ${targetSpec(a.target)});
doc.activeLayer = items[0];
__result__ = __layerInfo(doc.activeLayer);`)),
    },
    {
        name: 'arrange_layers',
        description: 'Change the stacking order: bring to front, bring forward, send backward, send to back, or place above, below or inside another layer or group',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                order: { type: 'string', enum: ['front', 'forward', 'backward', 'back', 'above', 'below', 'inside'] },
                relativeTo: { type: 'integer', description: 'Layer or group id, for above, below and inside' },
            },
            required: ['target', 'order'],
        },
        features: ['photoshop.layers.bring_to_front', 'photoshop.layers.bring_forward', 'photoshop.layers.send_backward', 'photoshop.layers.send_to_back'],
        handler: (a) => {
            const order = enumOf(a.order, ['front', 'forward', 'backward', 'back', 'above', 'below', 'inside'], { name: 'order' });
            const relative = ['above', 'below', 'inside'].includes(order);
            if (relative && a.relativeTo === undefined) throw new Error(`'${order}' needs relativeTo`);
            const move = {
                front: 'l.move(l.parent.layers[0], ElementPlacement.PLACEBEFORE);',
                back: 'l.move(l.parent.layers[l.parent.layers.length - 1], ElementPlacement.PLACEAFTER);',
                forward: 'var at = __indexIn(l); if (at > 0) l.move(l.parent.layers[at - 1], ElementPlacement.PLACEBEFORE);',
                backward: 'var at2 = __indexIn(l); if (at2 < l.parent.layers.length - 1) l.move(l.parent.layers[at2 + 1], ElementPlacement.PLACEAFTER);',
                above: 'l.move(ref, ElementPlacement.PLACEBEFORE);',
                below: 'l.move(ref, ElementPlacement.PLACEAFTER);',
                inside: 'if (ref.typename !== "LayerSet") throw new Error("inside needs a group"); l.moveToEnd(ref);',
            }[order];
            return run('Arrange layers', script(`
function __indexIn(l) { var p = l.parent.layers; for (var i = 0; i < p.length; i++) if (p[i] === l) return i; return -1; }
var items = __targets(doc, ${targetSpec(a.target)});
${relative ? `var ref = __layerById(doc, ${index(a.relativeTo, { name: 'relativeTo' })});` : ''}
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename === "ArtLayer" && l.isBackgroundLayer) throw new Error("The background layer cannot move; convert it to a normal layer first");
  ${move}
}
${RESULT}`));
        },
    },
    {
        name: 'group_layers',
        description: 'Put layers into a new group (Layer > Group Layers), placed where the first of them was; they keep the order given',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, name: { type: 'string' } }, required: ['target'] },
        features: ['photoshop.layers.group_layers', 'photoshop.layers.group_from_layers'],
        handler: (a) => run('Group layers', script(`
var items = __targets(doc, ${targetSpec(a.target)});
var g = items[0].parent.layerSets.add();
g.move(items[0], ElementPlacement.PLACEBEFORE);
${a.name ? `g.name = ${str(a.name)};` : ''}
for (var i = 0; i < items.length; i++) {
  if (items[i].typename === "ArtLayer" && items[i].isBackgroundLayer) throw new Error("The background layer cannot be grouped");
  items[i].moveToEnd(g);
}
__result__ = __layerInfo(g);`)),
    },
    {
        name: 'ungroup_layers',
        description: 'Move a group\'s layers out to where the group was and remove the empty group (Layer > Ungroup Layers)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        hints: { destructive: true },
        features: ['photoshop.layers.ungroup_layers'],
        handler: (a) => run('Ungroup layers', script(`
var groups = __targets(doc, ${targetSpec(a.target)}), items = [];
for (var i = 0; i < groups.length; i++) {
  var g = groups[i];
  if (g.typename !== "LayerSet") throw new Error(g.name + " is not a group");
  while (g.layers.length) { var l = g.layers[0]; l.move(g, ElementPlacement.PLACEBEFORE); items.push(l); }
  g.remove();
}
${RESULT}`)),
    },
    {
        name: 'duplicate_layers',
        description: 'Duplicate layers or groups (Layer > Duplicate Layer), placed above each original, optionally renamed',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, name: { type: 'string', description: 'Name for the copy (one layer only)' } }, required: ['target'] },
        features: ['photoshop.layers.duplicate_layer'],
        handler: (a) => run('Duplicate layers', script(`
var src = __targets(doc, ${targetSpec(a.target)}), items = [];
${a.name ? 'if (src.length > 1) throw new Error("Name one copy at a time");' : ''}
for (var i = 0; i < src.length; i++) {
  var c = src[i].duplicate(src[i], ElementPlacement.PLACEBEFORE);
  ${a.name ? `c.name = ${str(a.name)};` : ''}
  items.push(c);
}
${RESULT}`)),
    },
    {
        name: 'delete_layers',
        description: 'Delete layers or groups (with everything inside them)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        hints: { destructive: true },
        features: ['photoshop.layers.delete_layer'],
        handler: (a) => run('Delete layers', script(`
var items = __targets(doc, ${targetSpec(a.target)}), names = [];
for (var i = items.length - 1; i >= 0; i--) { names.push(items[i].name); items[i].remove(); }
__result__ = { deleted: names };`)),
    },
    {
        name: 'merge_layers',
        description: 'Merge a layer into the one below (Merge Down), or merge a group into one layer (Merge Group)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        hints: { destructive: true },
        features: ['photoshop.layers.merge_down', 'photoshop.layers.merge_layers'],
        handler: (a) => run('Merge layers', script(`
var src = __targets(doc, ${targetSpec(a.target)}), items = [];
for (var i = 0; i < src.length; i++) items.push(src[i].merge());
${RESULT}`)),
    },
    {
        name: 'transform_layers',
        description: 'Move layers by dx, dy pixels, scale them by a percentage, rotate them by degrees, or flip them, around an anchor point; optionally transform a copy of each, keeping the original. Video layers transform the same way once they are Smart Objects',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                dx: { type: 'number' }, dy: { type: 'number' },
                scaleX: { type: 'number', minimum: -10000, maximum: 10000, description: 'Percent; negative flips' },
                scaleY: { type: 'number', minimum: -10000, maximum: 10000, description: 'Percent; negative flips' },
                angle: { type: 'number', minimum: -360, maximum: 360, description: 'Degrees, clockwise' },
                flip: { type: 'string', enum: ['horizontal', 'vertical'] },
                anchor: { type: 'string', enum: Object.keys(ANCHORS), description: 'Default center' },
                duplicate: { type: 'boolean', description: 'Transform a copy of each layer, placed above it. Default false', default: false },
            },
            required: ['target'],
        },
        features: ['photoshop.transformations.duplicate_while_transforming', 'photoshop.transformations.transform_video_layers', 'photoshop.transformations.free_transform', 'photoshop.transformations.transform_scale', 'photoshop.transformations.transform_rotate', 'photoshop.transformations.transform_rotate_180', 'photoshop.transformations.transform_rotate_90_cw', 'photoshop.transformations.transform_rotate_90_ccw', 'photoshop.transformations.transform_flip_horizontal', 'photoshop.transformations.transform_flip_vertical', 'photoshop.transformations.reference_point'],
        handler: (a) => {
            const anchor = `AnchorPosition.${ANCHORS[enumOf(a.anchor ?? 'center', Object.keys(ANCHORS), { name: 'anchor' })]}`;
            const lines = [];
            if (a.scaleX !== undefined || a.scaleY !== undefined) lines.push(`l.resize(${a.scaleX !== undefined ? num(a.scaleX, { min: -10000, max: 10000, name: 'scaleX' }) : 100}, ${a.scaleY !== undefined ? num(a.scaleY, { min: -10000, max: 10000, name: 'scaleY' }) : 100}, ${anchor});`);
            if (a.flip !== undefined) lines.push(enumOf(a.flip, ['horizontal', 'vertical'], { name: 'flip' }) === 'horizontal' ? `l.resize(-100, 100, ${anchor});` : `l.resize(100, -100, ${anchor});`);
            if (a.angle !== undefined) lines.push(`l.rotate(${num(a.angle, { min: -360, max: 360, name: 'angle' })}, ${anchor});`);
            if (a.dx !== undefined || a.dy !== undefined) lines.push(`l.translate(new UnitValue(${num(a.dx ?? 0, { name: 'dx' })}, "px"), new UnitValue(${num(a.dy ?? 0, { name: 'dy' })}, "px"));`);
            if (!lines.length) throw new Error('Give dx/dy, scaleX/scaleY, angle or flip');
            return run('Transform layers', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var l = ${a.duplicate ? 'items[i].duplicate(items[i], ElementPlacement.PLACEBEFORE)' : 'items[i]'};
  ${a.duplicate ? 'items[i] = l;' : ''}
  ${lines.join('\n  ')}
}
${RESULT}`));
        },
    },
    {
        name: 'rasterize_layers',
        description: 'Rasterize type, shape, smart object or fill layers into pixels (Layer > Rasterize), or only one part of them',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, what: { type: 'string', enum: Object.keys(RASTERIZE), description: 'Default entire_layer' } },
            required: ['target'],
        },
        hints: { destructive: true },
        features: ['photoshop.layers.rasterize_layer', 'photoshop.layers.rasterize_type', 'photoshop.layers.rasterize_shape', 'photoshop.layers.rasterize_fill_content', 'photoshop.masks.rasterize_vector_mask', 'photoshop.smart_objects.rasterize_smart_object'],
        handler: (a) => run('Rasterize layers', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  if (items[i].typename !== "ArtLayer") throw new Error(items[i].name + " is a group");
  items[i].rasterize(RasterizeType.${RASTERIZE[enumOf(a.what ?? 'entire_layer', Object.keys(RASTERIZE), { name: 'what' })]});
}
${RESULT}`)),
    },
    {
        name: 'link_layers',
        description: 'Link layers together so they move and transform as one, or unlink them',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, unlink: { type: 'boolean', default: false } }, required: ['target'] },
        hints: { idempotent: true },
        features: ['photoshop.layers.link_layers', 'photoshop.layers.unlink_layers'],
        handler: (a) => run('Link layers', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${a.unlink ? 'for (var i = 0; i < items.length; i++) items[i].unlink();' : 'if (items.length < 2) throw new Error("Linking needs at least two layers"); for (var i = 1; i < items.length; i++) items[0].link(items[i]);'}
${RESULT}`)),
    },
    {
        name: 'convert_background_layer',
        description: 'Turn the background layer into a normal layer that can move and hold transparency, or make a layer the background',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, toBackground: { type: 'boolean', description: 'Make the target the background layer. Default false: turn the background into a normal layer', default: false } } },
        features: ['photoshop.layers.layer_from_background', 'photoshop.layers.background_from_layer', 'photoshop.layers.background_layer'],
        handler: (a) => run('Convert background', script(a.toBackground ? `
var items = __targets(doc, ${targetSpec(a.target)});
items[0].isBackgroundLayer = true;
__result__ = __layerInfo(items[0]);` : `
var bg = null;
for (var i = 0; i < doc.artLayers.length; i++) if (doc.artLayers[i].isBackgroundLayer) bg = doc.artLayers[i];
if (!bg) throw new Error("The document has no background layer");
bg.isBackgroundLayer = false;
__result__ = __layerInfo(bg);`)),
    },
    {
        name: 'layer_comps',
        description: 'List, create, apply, update or delete layer comps (Layer Comps panel)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'apply', 'update', 'delete'] },
                name: { type: 'string' },
                comment: { type: 'string' },
                visibility: { type: 'boolean', default: true }, position: { type: 'boolean', default: true }, appearance: { type: 'boolean', default: true },
            },
            required: ['action'],
        },
        features: ['photoshop.layers.layer_comps_panel', 'photoshop.layers.layer_comp_object', 'photoshop.layers.new_layer_comp', 'photoshop.layers.apply_layer_comp', 'photoshop.layers.update_layer_comp', 'photoshop.layers.delete_layer_comp'],
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'create', 'apply', 'update', 'delete'], { name: 'action' });
            if (action !== 'list' && !a.name) throw new Error(`'${action}' needs name`);
            const find = `var c = null; try { c = doc.layerComps.getByName(${str(a.name ?? '')}); } catch (e) { c = null; } if (!c) throw new Error("No layer comp named " + ${str(a.name ?? '')});`;
            const body = {
                list: '',
                create: `doc.layerComps.add(${str(a.name ?? '')}, ${a.comment ? str(a.comment) : 'undefined'}, ${bool(a.appearance ?? true)}, ${bool(a.position ?? true)}, ${bool(a.visibility ?? true)});`,
                apply: `${find} c.apply();`,
                update: `${find} c.recapture();`,
                delete: `${find} c.remove();`,
            }[action];
            return run('Layer comps', script(`
${body}
var out = [];
for (var i = 0; i < doc.layerComps.length; i++) { var lc = doc.layerComps[i]; out.push({ name: lc.name, visibility: lc.visibility, position: lc.position, appearance: lc.appearance }); }
__result__ = { comps: out };`));
        },
    },
];

/** How many layers a target names (ids and names), for single-layer checks. */
function targetCount(target) {
    const t = target ?? {};
    return (t.ids?.length ?? 0) + (t.names?.length ?? 0) + (t.active ? 1 : 0);
}

