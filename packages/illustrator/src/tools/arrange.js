/**
 * Finding, selecting, transforming, arranging, grouping and combining items.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';

const ORIGINS = { center: 'CENTER', topLeft: 'TOPLEFT', top: 'TOP', topRight: 'TOPRIGHT', left: 'LEFT', right: 'RIGHT', bottomLeft: 'BOTTOMLEFT', bottom: 'BOTTOM', bottomRight: 'BOTTOMRIGHT' };
const ORIGIN_SCHEMA = { type: 'string', enum: Object.keys(ORIGINS), description: 'Point to transform around. Default center' };
const ORDER = { front: 'BRINGTOFRONT', forward: 'BRINGFORWARD', backward: 'SENDBACKWARD', back: 'SENDTOBACK' };
const TYPES = ['PathItem', 'CompoundPathItem', 'GroupItem', 'TextFrame', 'PlacedItem', 'RasterItem', 'SymbolItem', 'MeshItem', 'PluginItem', 'GraphItem'];

/** Selecting by script: deselect everything, then select the targets. */
const SELECT = `
function __select(doc, items) {
  doc.selection = null;
  for (var i = 0; i < items.length; i++) items[i].selected = true;
}`;

export const tools = [
    {
        name: 'list_items',
        description: 'List items with their id, name, type, layer and position. Filter by layer, artboard or type. Ids are what other tools take in target.ids',
        inputSchema: {
            type: 'object',
            properties: {
                layer: { type: 'string', description: 'Only items on this layer (and its sublayers)' },
                artboardIndex: { ...ARTBOARD_SCHEMA, description: 'Only items whose centre is on this artboard' },
                type: { type: 'string', enum: TYPES },
                topLevelOnly: { type: 'boolean', description: 'Skip items inside groups. Default true', default: true },
                limit: { type: 'integer', minimum: 1, maximum: 2000, default: 200 },
            },
        },
        features: ['illustrator.layers.layers_panel', 'illustrator.selection.selection_state'],
        handler: (a) => run('List items', script(`
var src = ${a.layer ? `__layer(doc, ${str(a.layer)}).pageItems` : 'doc.pageItems'};
var max = ${index(a.limit ?? 200, { name: 'limit', max: 2000 })}, out = [], total = 0;
for (var i = 0; i < src.length; i++) {
  var it = src[i];
  ${(a.topLevelOnly ?? true) ? 'if (it.parent.typename === "GroupItem" || it.parent.typename === "CompoundPathItem") continue;' : ''}
  ${a.type ? `if (it.typename !== ${str(enumOf(a.type, TYPES, { name: 'type' }))}) continue;` : ''}
  var info = __itemInfo(doc, it);
  ${a.artboardIndex !== undefined ? `if (info.artboardIndex !== ${index(a.artboardIndex, { name: 'artboardIndex' })}) continue;` : ''}
  total++;
  if (out.length < max) out.push(info);
}
__result__ = { total: total, items: out, truncated: total > out.length };`)),
    },
    {
        name: 'get_selection',
        description: 'Describe the current selection',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.selection.selection_tool'],
        handler: () => run('Get selection', script(`
var sel = doc.selection, out = [];
if (sel && sel.length) for (var i = 0; i < sel.length; i++) { try { out.push(__itemInfo(doc, sel[i])); } catch (e) { out.push({ type: sel[i].typename }); } }
__result__ = { count: out.length, items: out };`)),
    },
    {
        name: 'select_items',
        description: 'Select items (replacing the current selection). Menu commands act on the selection',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.selection.selection_tool'],
        handler: (a) => run('Select items', script(`${SELECT}
var items = __targets(doc, ${targetSpec(a.target)});
__select(doc, items);
__result__ = { selected: doc.selection.length };`)),
    },
    {
        name: 'deselect_all',
        description: 'Deselect everything in the active document',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.selection.deselect'],
        handler: () => run('Deselect', script(`
doc.selection = null;
__result__ = { selected: 0 };`)),
    },
    {
        name: 'delete_items',
        description: 'Delete items from the document (Illustrator\'s Edit > Undo can restore them)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.documents.clear'],
        handler: (a) => run('Delete items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), n = items.length;
for (var i = items.length - 1; i >= 0; i--) items[i].remove();
__result__ = { deleted: n };`)),
    },
    {
        name: 'duplicate_items',
        description: 'Duplicate items, offsetting each copy by dx, dy points. With count > 1, each copy is offset from the previous one (step and repeat)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                dx: { type: 'number', default: 0 }, dy: { type: 'number', default: 0 },
                count: { type: 'integer', minimum: 1, maximum: 500, default: 1 },
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.transform_again', 'illustrator.documents.duplicate_objects'],
        handler: (a) => run('Duplicate items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
var dx = __len(doc, ${num(a.dx ?? 0, { name: 'dx' })}), dy = __len(doc, ${num(a.dy ?? 0, { name: 'dy' })});
for (var i = 0; i < items.length; i++) {
  var prev = items[i];
  for (var k = 0; k < ${index(a.count ?? 1, { name: 'count', max: 500 })}; k++) {
    var copy = prev.duplicate();
    copy.translate(dx, -dy);
    out.push(copy.uuid);
    prev = copy;
  }
}
__result__ = { created: out.length, ids: out };`)),
    },
    {
        name: 'move_items',
        description: 'Move items by dx, dy points, or place their top-left corner at x, y on an artboard',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                dx: { type: 'number' }, dy: { type: 'number' },
                x: { type: 'number' }, y: { type: 'number' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.move'],
        handler: (a) => {
            const absolute = a.x !== undefined || a.y !== undefined;
            if (!absolute && a.dx === undefined && a.dy === undefined) throw new Error('Give dx/dy, or x/y');
            return run('Move items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${absolute ? `
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
for (var i = 0; i < items.length; i++) {
  var b = __bounds(doc, items[i], ab.index);
  var tx = ${a.x !== undefined ? num(a.x, { name: 'x' }) : 'b.x'}, ty = ${a.y !== undefined ? num(a.y, { name: 'y' }) : 'b.y'};
  items[i].translate(__len(doc, tx - b.x), -__len(doc, ty - b.y));
}` : `
for (var i = 0; i < items.length; i++) items[i].translate(__len(doc, ${num(a.dx ?? 0, { name: 'dx' })}), -__len(doc, ${num(a.dy ?? 0, { name: 'dy' })}));`}
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(doc, items[j]));
__result__ = out;`));
        },
    },
    {
        name: 'scale_items',
        description: 'Scale items by a percentage. Give scale for uniform scaling, or scaleX and scaleY',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scale: { type: 'number', minimum: 0.01, description: 'Percent, e.g. 150' },
                scaleX: { type: 'number', minimum: 0.01 }, scaleY: { type: 'number', minimum: 0.01 },
                origin: ORIGIN_SCHEMA,
                scaleStrokes: { type: 'boolean', description: 'Scale stroke weights too. Default true', default: true },
            },
            required: ['target'],
        },
        features: ['illustrator.transformations.scale'],
        handler: (a) => {
            const sx = a.scaleX ?? a.scale, sy = a.scaleY ?? a.scale;
            if (sx === undefined || sy === undefined) throw new Error('Give scale, or both scaleX and scaleY');
            return run('Scale items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) items[i].resize(${num(sx, { min: 0.01, max: 100000, name: 'scaleX' })}, ${num(sy, { min: 0.01, max: 100000, name: 'scaleY' })}, true, true, true, true, ${(a.scaleStrokes ?? true) ? num(Math.sqrt(sx * sy), { name: 'stroke scale' }) : '100'}, Transformation.${ORIGINS[enumOf(a.origin ?? 'center', Object.keys(ORIGINS), { name: 'origin' })]});
__result__ = { scaled: items.length };`));
        },
    },
    {
        name: 'rotate_items',
        description: 'Rotate items by an angle in degrees (counter-clockwise, as in Illustrator)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, angle: { type: 'number' }, origin: ORIGIN_SCHEMA }, required: ['target', 'angle'] },
        features: ['illustrator.transformations.rotate'],
        handler: (a) => run('Rotate items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) items[i].rotate(${num(a.angle, { min: -3600, max: 3600, name: 'angle' })}, true, true, true, true, Transformation.${ORIGINS[enumOf(a.origin ?? 'center', Object.keys(ORIGINS), { name: 'origin' })]});
__result__ = { rotated: items.length };`)),
    },
    {
        name: 'reflect_items',
        description: 'Flip items horizontally or vertically around their centre',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, axis: { type: 'string', enum: ['horizontal', 'vertical'], description: 'horizontal flips left-right' } }, required: ['target', 'axis'] },
        features: ['illustrator.transformations.reflect'],
        handler: (a) => {
            const [x, y] = enumOf(a.axis, ['horizontal', 'vertical'], { name: 'axis' }) === 'horizontal' ? [-100, 100] : [100, -100];
            return run('Reflect items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) items[i].resize(${x}, ${y}, true, true, true, true, 100, Transformation.CENTER);
__result__ = { reflected: items.length };`));
        },
    },
    {
        name: 'align_items',
        description: 'Align items to each other (their combined bounds) or to an artboard',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                edge: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] },
                to: { type: 'string', enum: ['selection', 'artboard'], description: 'Default selection', default: 'selection' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['target', 'edge'],
        },
        features: ['illustrator.transformations.align_panel'],
        handler: (a) => {
            const edge = enumOf(a.edge, ['left', 'center', 'right', 'top', 'middle', 'bottom'], { name: 'edge' });
            return run('Align items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
var L, T, R, B, g, i;
${a.to === 'artboard' ? `var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })}); L = ab.left; T = ab.top; R = ab.right; B = ab.bottom;` : `
L = Infinity; T = -Infinity; R = -Infinity; B = Infinity;
for (i = 0; i < items.length; i++) { g = items[i].visibleBounds; if (g[0] < L) L = g[0]; if (g[1] > T) T = g[1]; if (g[2] > R) R = g[2]; if (g[3] < B) B = g[3]; }`}
for (i = 0; i < items.length; i++) {
  g = items[i].visibleBounds;
  var dx = 0, dy = 0;
  ${{ left: 'dx = L - g[0];', right: 'dx = R - g[2];', center: 'dx = (L + R) / 2 - (g[0] + g[2]) / 2;', top: 'dy = T - g[1];', bottom: 'dy = B - g[3];', middle: 'dy = (T + B) / 2 - (g[1] + g[3]) / 2;' }[edge]}
  items[i].translate(dx, dy);
}
__result__ = { aligned: items.length, edge: ${str(edge)} };`));
        },
    },
    {
        name: 'arrange_items',
        description: 'Change stacking order: bring to front, bring forward, send backward, send to back',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, order: { type: 'string', enum: Object.keys(ORDER) } }, required: ['target', 'order'] },
        features: ['illustrator.layers.bring_to_front', 'illustrator.layers.send_to_back'],
        handler: (a) => run('Arrange items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) items[i].zOrder(ZOrderMethod.${ORDER[enumOf(a.order, Object.keys(ORDER), { name: 'order' })]});
__result__ = { arranged: items.length };`)),
    },
    {
        name: 'group_items',
        description: 'Group items. The group is created where the frontmost item is',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, name: { type: 'string' } }, required: ['target'] },
        features: ['illustrator.selection.group'],
        handler: (a) => run('Group items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
var g = items[0].parent.groupItems.add();
g.move(items[0], ElementPlacement.PLACEBEFORE);
for (var i = items.length - 1; i >= 0; i--) items[i].move(g, ElementPlacement.PLACEATBEGINNING);
${a.name ? `g.name = ${str(a.name)};` : ''}
__result__ = __itemInfo(doc, g);`)),
    },
    {
        name: 'ungroup_items',
        description: 'Ungroup groups, leaving their contents in place',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.selection.ungroup'],
        handler: (a) => run('Ungroup items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), freed = [];
for (var i = 0; i < items.length; i++) {
  var g = items[i];
  if (g.typename !== "GroupItem") continue;
  while (g.pageItems.length) { var it = g.pageItems[g.pageItems.length - 1]; it.move(g, ElementPlacement.PLACEAFTER); freed.push(it.uuid); }
  g.remove();
}
__result__ = { ungrouped: freed.length, ids: freed };`)),
    },
    {
        name: 'make_clipping_mask',
        description: 'Clip items with a path: the clipping path shows only the artwork inside it. clipPath must be a path id; it is moved above the other items',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, clipPathId: { type: 'string', description: 'Id of the path to clip with' } }, required: ['target', 'clipPathId'] },
        features: ['illustrator.clipping.make'],
        handler: (a) => run('Make clipping mask', script(`
var items = __targets(doc, ${targetSpec(a.target)}), clip = doc.getPageItemFromUuid(${str(a.clipPathId)});
if (!clip || (clip.typename !== "PathItem" && clip.typename !== "CompoundPathItem")) throw new Error("clipPathId must be a path or compound path");
var g = clip.parent.groupItems.add();
g.move(clip, ElementPlacement.PLACEBEFORE);
for (var i = items.length - 1; i >= 0; i--) if (items[i] !== clip) items[i].move(g, ElementPlacement.PLACEATBEGINNING);
clip.move(g, ElementPlacement.PLACEATBEGINNING);
g.clipped = true;
__result__ = __itemInfo(doc, g);`)),
    },
    {
        name: 'make_compound_path',
        description: 'Combine paths into one compound path (Object > Compound Path > Make): overlapping areas become holes',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.geometry.compound_make'],
        menuCommands: ['compoundPath'],
        handler: (a) => run('Make compound path', script(`${SELECT}
var items = __targets(doc, ${targetSpec(a.target)});
__select(doc, items);
app.executeMenuCommand("compoundPath");
var sel = doc.selection;
if (!sel || sel.length !== 1 || sel[0].typename !== "CompoundPathItem") throw new Error("Illustrator did not make a compound path from these items");
__result__ = __itemInfo(doc, sel[0]);`)),
    },

];
