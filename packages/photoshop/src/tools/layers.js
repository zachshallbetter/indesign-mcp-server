/**
 * Layers and groups: list, create, set properties, select, arrange, group,
 * duplicate, delete, merge, move, transform, rasterize, link and lock; layer
 * comps; fill layers; matting; and the Layers-panel commands that only the
 * Action Manager reaches (Layer via Copy, Select Linked Layers, Isolate
 * Layers, Copy CSS and the like).
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM, GRADIENT_TYPES, gradientLines, patternLines } from '../action-manager.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

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
const COMP_ACTIONS = ['list', 'create', 'apply', 'update', 'delete', 'previous', 'next', 'options', 'duplicate', 'restore_last_state', 'clear_warning'];
const SELECT_ACTIONS = ['set', 'add', 'all', 'none', 'linked', 'similar', 'find'];
/** Lock names and their layerLocking keys (applyLocking). */
const LOCKS = { all: 'protectAll', pixels: 'protectComposite', position: 'protectPosition', transparency: 'protectTransparency', artboard: 'protectArtboardAutonest' };
/** Layer > Matting commands and their events. */
const MATTING = { defringe: 'defringe', remove_black_matte: 'removeBlackMatte', remove_white_matte: 'removeWhiteMatte', color_decontaminate: 'decontaminate' };
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
        features: ['photoshop.layers.new_layer', 'photoshop.layers.new_layer_button', 'photoshop.layers.new_group', 'photoshop.layers.layer_opacity', 'photoshop.layers.fill_opacity', 'photoshop.layers.blend_mode', 'photoshop.layers.show_hide_layers'],
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
        description: 'Move layers by dx, dy pixels, scale them by a percentage, rotate them by degrees, or flip them, around an anchor point',
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
            },
            required: ['target'],
        },
        features: ['photoshop.transformations.free_transform', 'photoshop.transformations.transform_scale', 'photoshop.transformations.transform_rotate', 'photoshop.transformations.transform_rotate_180', 'photoshop.transformations.transform_rotate_90_cw', 'photoshop.transformations.transform_rotate_90_ccw', 'photoshop.transformations.transform_flip_horizontal', 'photoshop.transformations.transform_flip_vertical', 'photoshop.transformations.reference_point'],
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
  var l = items[i];
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
        description: 'Work with layer comps (Layer Comps panel): list, create, apply, update (recapture) or delete one; apply the previous or next comp; change a comp\'s options (Layer Comp Options); duplicate a comp; go back to the Last Document State; or clear a comp\'s warning (Clear Layer Comp Warning; every comp when no name is given)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: COMP_ACTIONS },
                name: { type: 'string', description: 'The comp to act on (create: the new comp\'s name)' },
                newName: { type: 'string', description: 'options: rename the comp to this; duplicate: name for the copy' },
                comment: { type: 'string', description: 'create, options: the comp\'s comment' },
                visibility: { type: 'boolean', default: true, description: 'create, options: record layer visibility' },
                position: { type: 'boolean', default: true, description: 'create, options: record layer position' },
                appearance: { type: 'boolean', default: true, description: 'create, options: record layer appearance (layer styles)' },
            },
            required: ['action'],
        },
        features: ['photoshop.layers.layer_comps_panel', 'photoshop.layers.layer_comp_object', 'photoshop.layers.new_layer_comp', 'photoshop.layers.apply_layer_comp', 'photoshop.layers.update_layer_comp', 'photoshop.layers.delete_layer_comp', 'photoshop.layers.previous_next_layer_comp', 'photoshop.layers.layer_comp_options', 'photoshop.layers.duplicate_layer_comp', 'photoshop.layers.last_document_state', 'photoshop.layers.clear_layer_comp_warning'],
        handler: (a) => {
            const action = enumOf(a.action, COMP_ACTIONS, { name: 'action' });
            if (['create', 'apply', 'update', 'delete', 'options', 'duplicate'].includes(action) && !a.name) throw new Error(`'${action}' needs name`);
            const find = `var c = null; try { c = doc.layerComps.getByName(${str(a.name ?? '')}); } catch (e) { c = null; } if (!c) throw new Error("No layer comp named " + ${str(a.name ?? '')});`;
            const compRef = (name) => `var cd = new ActionDescriptor(), cr = new ActionReference(); cr.putName(__s("compsClass"), ${name}); cd.putReference(__s("null"), cr);`;
            const step = (dir) => `
var n = doc.layerComps.length, cur = -1;
if (!n) throw new Error("The document has no layer comps");
for (var i = 0; i < n; i++) if (doc.layerComps[i].selected) { cur = i; break; }
var at = cur < 0 ? ${dir > 0 ? '0' : 'n - 1'} : (cur + ${dir} + n) % n;
doc.layerComps[at].apply();`;
            let body;
            if (action === 'options') {
                const lines = [];
                if (a.newName !== undefined) lines.push(`c.name = ${str(a.newName)};`);
                if (a.comment !== undefined) lines.push(`c.comment = ${str(a.comment)};`);
                for (const k of ['visibility', 'position', 'appearance']) if (a[k] !== undefined) lines.push(`c.${k} = ${bool(a[k])};`);
                if (!lines.length) throw new Error("'options' needs newName, comment, visibility, position or appearance");
                body = `${find}\n${lines.join('\n')}`;
            } else {
                body = {
                    list: '',
                    create: `doc.layerComps.add(${str(a.name ?? '')}, ${a.comment ? str(a.comment) : 'undefined'}, ${bool(a.appearance ?? true)}, ${bool(a.position ?? true)}, ${bool(a.visibility ?? true)});`,
                    apply: `${find} c.apply();`,
                    update: `${find} c.recapture();`,
                    delete: `${find} c.remove();`,
                    previous: step(-1),
                    next: step(1),
                    duplicate: `${find}
var before = {};
for (var i = 0; i < doc.layerComps.length; i++) before[doc.layerComps[i].name] = true;
${compRef(str(a.name ?? ''))}
__play("duplicate", cd);
var copy = null;
for (var j = 0; j < doc.layerComps.length; j++) if (!before[doc.layerComps[j].name]) copy = doc.layerComps[j];
${a.newName ? `if (copy) copy.name = ${str(a.newName)};` : ''}`,
                    restore_last_state: '__play("resetFromComp");',
                    clear_warning: a.name ? `${find}\n${compRef(str(a.name))}\n__play("clearWarning", cd);` : `
for (var i = 0; i < doc.layerComps.length; i++) {
  ${compRef('doc.layerComps[i].name')}
  try { __play("clearWarning", cd); } catch (e) {}
}`,
                }[action];
            }
            return run('Layer comps', script(`${AM}
${body}
var out = [];
for (var k = 0; k < doc.layerComps.length; k++) { var lc = doc.layerComps[k]; out.push({ name: lc.name, selected: lc.selected, visibility: lc.visibility, position: lc.position, appearance: lc.appearance }); }
__result__ = { comps: out };`));
        },
    },
    {
        name: 'new_layer_via',
        description: 'Make a new layer from existing pixels (Layer > New): Layer via Copy copies the selected pixels (or the whole layer when nothing is selected) to a new layer; Layer via Cut moves the selected pixels to a new layer; Stamp Visible merges a copy of every visible layer into a new layer above the target and keeps the originals',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: ['copy', 'cut', 'stamp_visible'] },
                target: { ...TARGET_SCHEMA, description: 'The one layer to copy or cut from, or to stamp above. Default the active layer' },
                name: { type: 'string', description: 'Name for the new layer' },
            },
            required: ['method'],
        },
        features: ['photoshop.layers.layer_via_copy', 'photoshop.layers.layer_via_cut', 'photoshop.layers.stamp_visible'],
        handler: (a) => {
            const method = enumOf(a.method, ['copy', 'cut', 'stamp_visible'], { name: 'method' });
            return run('New layer via', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
if (items.length !== 1) throw new Error("Choose one layer");
doc.activeLayer = items[0];
${{
        copy: '__play("copyToLayer");',
        cut: 'if (!__hasSelection()) throw new Error("Layer via Cut needs a selection"); __play("cutToLayer");',
        stamp_visible: 'var d = new ActionDescriptor(); d.putBoolean(__s("duplicate"), true); __play("mergeVisible", d);',
    }[method]}
var l = doc.activeLayer;
${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(l);`));
        },
    },
    {
        name: 'set_layer_selection',
        description: 'Select several layers at once in the Layers panel, for commands that act on the selected layers: set or add to the selection, select All Layers, Deselect Layers, Select Linked Layers, Similar Layers (same kind as the target), or find layers whose names contain some text (Select menu). Returns the selected layers',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: SELECT_ACTIONS, description: 'set: select exactly the target layers; add: add them; all, none; linked and similar: start from the target layer; find: select layers whose name contains query' },
                target: { ...TARGET_SCHEMA, description: 'set and add: the layers; linked and similar: the layer to start from (default the active layer)' },
                query: { type: 'string', description: 'find: text the layer name contains, ignoring case' },
            },
            required: ['action'],
        },
        auditArgs: { target: { ids: [7] }, query: undefined },
        features: ['photoshop.layers.select_all_layers', 'photoshop.layers.deselect_layers', 'photoshop.layers.select_linked_layers', 'photoshop.layers.select_similar_layers', 'photoshop.layers.find_layers'],
        handler: (a) => {
            const action = enumOf(a.action, SELECT_ACTIONS, { name: 'action' });
            if ((action === 'set' || action === 'add') && !a.target) throw new Error(`'${action}' needs target`);
            if (action === 'find' && (typeof a.query !== 'string' || !a.query.length)) throw new Error("'find' needs query");
            const from = `var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});`;
            const body = {
                set: `${from}\n__selectLayers(items, false);`,
                add: `${from}\n__selectLayers(items, true);`,
                all: '__play("selectAllLayers", __onTarget());',
                none: '__play("selectNoLayers", __onTarget());',
                linked: `${from}\ndoc.activeLayer = items[0];\n__play("selectLinkedLayers", __onTarget());`,
                similar: `${from}\ndoc.activeLayer = items[0];\n__play("selectSimilarLayers", __onTarget());`,
                find: `
var q = ${str(String(a.query ?? '').toLowerCase())}, hits = [];
__eachLayer(doc, function (l) { if (l.name.toLowerCase().indexOf(q) >= 0) hits.push(l); });
if (!hits.length) throw new Error("No layer name contains " + q);
__selectLayers(hits, false);`,
            }[action];
            return run('Select layers', script(`${AM}
${body}
__result__ = { selected: __selectedInfo() };`));
        },
    },
    {
        name: 'process_all_layers',
        description: 'Run a command on every layer of the document: Delete Hidden Layers (Layers panel menu) or Rasterize All Layers (Layer > Rasterize > All Layers)',
        inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['delete_hidden', 'rasterize_all'] } }, required: ['action'] },
        hints: { destructive: true },
        features: ['photoshop.layers.delete_hidden_layers', 'photoshop.layers.rasterize_all_layers'],
        handler: (a) => {
            const action = enumOf(a.action, ['delete_hidden', 'rasterize_all'], { name: 'action' });
            return run('All layers', script(`${AM}
var hidden = [];
__eachLayer(doc, function (l) { if (!l.visible) hidden.push(l.name); });
${action === 'delete_hidden' ? `
if (hidden.length) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(__s("layer"), __s("ordinal"), __s("hidden"));
  d.putReference(__s("null"), r);
  __play("delete", d);
}
__result__ = { deleted: hidden, layers: __docInfo(doc).layers };` : `
doc.rasterizeAllLayers();
__result__ = { rasterized: true, layers: __docInfo(doc).layers };`}`));
        },
    },
    {
        name: 'lock_layers',
        description: 'Apply locks to layers, optionally to every layer inside the target groups (Layer > Lock Layers, Lock All Layers in Group). Locks not listed are turned off; an empty list unlocks',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                locks: { type: 'array', items: { type: 'string', enum: Object.keys(LOCKS) }, description: 'all, pixels (image pixels), position, transparency (transparent pixels), artboard (prevent auto-nesting). [] unlocks' },
                includeGroupContents: { type: 'boolean', default: false, description: 'Also lock every layer inside target groups' },
            },
            required: ['target', 'locks'],
        },
        hints: { idempotent: true },
        features: ['photoshop.layers.lock_layers_dialog'],
        handler: (a) => {
            if (!Array.isArray(a.locks)) throw new Error("'locks' must be a list, e.g. [\"position\"], or [] to unlock");
            const keys = [...new Set(a.locks.map((k) => LOCKS[enumOf(k, Object.keys(LOCKS), { name: 'locks' })]))];
            const lines = keys.length ? keys.map((k) => `lk.putBoolean(__s(${str(k)}), true);`) : ['lk.putBoolean(__s("protectNone"), true);'];
            return run('Lock layers', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target)}), all = [];
for (var i = 0; i < items.length; i++) {
  all.push(items[i]);
  ${a.includeGroupContents ? 'if (items[i].typename === "LayerSet") __eachLayer(items[i], function (l) { all.push(l); });' : ''}
}
for (var j = 0; j < all.length; j++) {
  var d = __onLayer(all[j].id), lk = new ActionDescriptor();
  ${lines.join('\n  ')}
  d.putObject(__s("layerLocking"), __s("layerLocking"), lk);
  __play("applyLocking", d);
}
var out = [];
for (var k = 0; k < all.length; k++) out.push(__layerInfo(all[k]));
__result__ = { layers: out };`));
        },
    },
    {
        name: 'set_layer_link_enabled',
        description: 'Suspend a linked layer\'s link (the red X Shift-clicking the link icon shows) or restore it, without unlinking',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, enabled: { type: 'boolean', description: 'false suspends the link, true restores it' } }, required: ['target', 'enabled'] },
        hints: { idempotent: true },
        features: ['photoshop.layers.disable_layer_link'],
        handler: (a) => {
            if (typeof a.enabled !== 'boolean') throw new Error("'enabled' must be true or false");
            return run('Layer link', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  if (!items[i].linkedLayers.length) throw new Error(items[i].name + " is not linked to another layer");
  doc.activeLayer = items[i];
  __play(${a.enabled ? '"enableLayerLink"' : '"disableLayerLink"'}, __onTarget());
}
var out = [];
for (var k = 0; k < items.length; k++) out.push(__layerInfo(items[k]));
__result__ = { layers: out };`));
        },
    },
    {
        name: 'set_layers_panel_view',
        description: 'Change what the Layers panel shows, without changing the document: Isolate Layers (show only the target layers), Remove from Isolation, or Collapse All Groups',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['isolate', 'end_isolation', 'collapse_groups'] },
                target: { ...TARGET_SCHEMA, description: 'isolate: the layers to show. Default the active layer' },
            },
            required: ['action'],
        },
        hints: { idempotent: true },
        features: ['photoshop.layers.isolate_layers', 'photoshop.layers.collapse_all_groups'],
        handler: (a) => {
            const action = enumOf(a.action, ['isolate', 'end_isolation', 'collapse_groups'], { name: 'action' });
            return run('Layers panel view', script(`${AM}
${{
        isolate: `__selectLayers(__targets(doc, ${targetSpec(a.target ?? { active: true })}), false);\n__play("isolateLayers");`,
        end_isolation: '__play("deIsolateLayers");',
        collapse_groups: '__play("collapseAllGroupsEvent");',
    }[action]}
__result__ = { action: ${str(action)}, selected: __selectedInfo() };`));
        },
    },
    {
        name: 'reverse_layer_order',
        description: 'Reverse the stacking order of two or more layers (Layer > Arrange > Reverse)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['photoshop.layers.reverse_layers'],
        handler: (a) => run('Reverse layers', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < 2) throw new Error("Reverse needs at least two layers");
__selectLayers(items, false);
__play("reverse", __onTarget());
var out = [];
__eachLayer(doc, function (l) { for (var i = 0; i < items.length; i++) if (items[i].id === l.id) out.push(__layerInfo(l)); });
__result__ = { layers: out };`)),
    },
    {
        name: 'apply_matting',
        description: 'Clean the edge pixels of a pixel layer (Layer > Matting): Defringe (replace fringe colours over a width in pixels), Remove Black Matte, Remove White Matte, or Color Decontaminate',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: Object.keys(MATTING) },
                target: { ...TARGET_SCHEMA, description: 'Pixel layers. Default the active layer' },
                width: { type: 'number', minimum: 1, maximum: 200, description: 'defringe: width in pixels. Default 1' },
            },
            required: ['method'],
        },
        features: ['photoshop.layers.defringe', 'photoshop.layers.remove_black_matte', 'photoshop.layers.remove_white_matte', 'photoshop.layers.color_decontaminate'],
        handler: (a) => {
            const method = enumOf(a.method, Object.keys(MATTING), { name: 'method' });
            if (a.width !== undefined && method !== 'defringe') throw new Error("'width' is for defringe");
            const call = method === 'defringe'
                ? `var d = new ActionDescriptor(); d.putUnitDouble(__s("width"), __s("pixelsUnit"), ${num(a.width ?? 1, { min: 1, max: 200, name: 'width' })}); __play("defringe", d);`
                : `__play(${str(MATTING[method])});`;
            return run('Matting', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
for (var i = 0; i < items.length; i++) {
  var l = items[i];
  if (l.typename !== "ArtLayer" || l.kind !== LayerKind.NORMAL) throw new Error(l.name + " is not a pixel layer");
  doc.activeLayer = l;
  ${call}
}
${RESULT}`));
        },
    },
    {
        name: 'copy_layer_code',
        description: 'Copy CSS for shape and type layers (size, position, colours, gradients, shadows, type settings), or SVG markup for a shape layer, to the clipboard (Layers panel context menu: Copy CSS, Copy SVG)',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Default the active layer' }, format: { type: 'string', enum: ['css', 'svg'] } }, required: ['format'] },
        hints: { idempotent: true },
        features: ['photoshop.layers.copy_css', 'photoshop.layers.copy_svg'],
        handler: (a) => {
            const format = enumOf(a.format, ['css', 'svg'], { name: 'format' });
            return run('Copy layer code', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
__selectLayers(items, false);
__play(${format === 'css' ? '"copyLayerCSS"' : '"copyLayerSVG"'}, __onTarget());
__result__ = { copied: ${str(format)}, selected: __selectedInfo() };`));
        },
    },
];

/** How many layers a target names (ids and names), for single-layer checks. */
function targetCount(target) {
    const t = target ?? {};
    return (t.ids?.length ?? 0) + (t.names?.length ?? 0) + (t.active ? 1 : 0);
}

