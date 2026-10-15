/**
 * Layers: Layer Options (print, suppress text wrap when hidden, guides),
 * Layers panel menu commands, moving items to another layer, and the objects
 * listed under each layer in the Layers panel.
 *
 * Layers are chosen by name; items by PageItem.id; spreads by 0-based index.
 */
import { str, bool, enumOf, index, json } from 'adobe-mcp-core';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';
import { B, groupSchema, assign } from './formatOptions.js';
import { commandScript, has, nameArg } from './commands.js';

const LY = 'indesign.layers.';
const ids = (...names) => names.map((n) => LY + n);

const UI_COLORS = ['BLACK', 'BLUE', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CHARCOAL', 'CUTE_TEAL', 'CYAN', 'DARK_BLUE', 'DARK_GREEN', 'FIESTA', 'GOLD', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE', 'GRID_GREEN', 'GRID_ORANGE', 'LAVENDER', 'LIGHT_BLUE', 'LIGHT_GRAY', 'LIGHT_OLIVE', 'LIPSTICK', 'MAGENTA', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'PURPLE', 'RED', 'SULPHUR', 'TAN', 'TEAL', 'VIOLET', 'WHITE', 'YELLOW'];

/** Layer Options dialog (Layer). */
const LAYER_OPTIONS = {
    visible: B('Show Layer'),
    locked: B('Lock Layer'),
    printable: B('Print Layer: include the layer in print and PDF output'),
    ignoreWrap: B('Suppress Text Wrap When Layer Is Hidden'),
    showGuides: B('Show Guides that belong to the layer'),
    lockGuides: B('Lock Guides that belong to the layer'),
};

const COMMANDS = ['duplicate', 'show_all', 'hide_others', 'lock_others', 'unlock_all', 'select_items', 'small_panel_rows'];

/** The layer list as the Layers panel shows it. */
const LAYER_LIST = String.raw`
var __layers = function (doc) {
  var out = [];
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    out.push({ name: l.name, visible: l.visible, locked: l.locked, printable: l.printable, ignoreWrap: l.ignoreWrap, showGuides: l.showGuides, lockGuides: l.lockGuides });
  }
  return out;
};
var __onSpread = function (l, sp) {
  var out = [], items = l.pageItems.everyItem().getElements();
  for (var i = 0; i < items.length; i++) {
    var p = items[i].parent;
    if (p.constructor.name === sp.constructor.name && p.id === sp.id) out.push(items[i]);
  }
  return out;
};
`;

export const tools = [
    {
        name: 'set_layer_options',
        description: 'Set Layer Options (Layers panel > Layer Options): rename, colour, show, lock, Print Layer, Suppress Text Wrap When Layer Is Hidden, Show Guides and Lock Guides',
        inputSchema: {
            type: 'object',
            properties: {
                layer: { type: 'string', description: 'Layer name' },
                options: groupSchema(LAYER_OPTIONS, 'Layer options to set'),
                newName: { type: 'string', description: 'Rename the layer' },
                color: { type: 'string', description: `Layer colour: ${UI_COLORS.slice(0, 6).join(', ')} and the other UIColors names, or "#RRGGBB"` },
            },
            required: ['layer'],
        },
        features: ids('layer_print', 'layer_suppress_wrap', 'layer_guides'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { color: 'LIGHT_BLUE' },
        handler: (a) => {
            const layer = nameArg(a.layer, 'layer');
            const L = [assign('l', LAYER_OPTIONS, a.options, 'options')];
            if (has(a.newName)) L.push(`if (doc.layers.itemByName(${str(nameArg(a.newName, 'newName'))}).isValid && ${str(a.newName)} !== l.name) throw new Error("A layer named " + ${str(a.newName)} + " already exists");\nl.name = ${str(a.newName)};`);
            if (has(a.color)) {
                const m = /^#([0-9a-f]{6})$/i.exec(String(a.color));
                if (m) {
                    const n = parseInt(m[1], 16);
                    L.push(`l.layerColor = ${json([(n >> 16) & 255, (n >> 8) & 255, n & 255])};`);
                } else {
                    L.push(`l.layerColor = UIColors.${enumOf(String(a.color).toUpperCase(), UI_COLORS, { name: 'color' })};`);
                }
            }
            if (!L.filter(Boolean).length) throw new Error('Nothing to set: pass options, newName or color');
            return run('Set layer options', commandScript(`${LAYER_LIST}
var l = __layer(doc, ${str(layer)});
${L.filter(Boolean).join('\n')}
__result__ = { layer: l.name, layers: __layers(doc) };`));
        },
    },
    {
        name: 'run_layer_command',
        description: 'Layers panel menu commands: Duplicate Layer, Show All Layers, Hide Others, Lock Others, Unlock All Layers, Select Item(s) on Layer (on a spread), and Small Panel Rows',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: COMMANDS, description: 'The command' },
                layer: { type: 'string', description: 'The layer (for duplicate, hide_others, lock_others and select_items)' },
                newName: { type: 'string', description: 'For duplicate: name of the copy (default: InDesign\'s "<name> copy")' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'For select_items: the spread (default: the active spread)' },
                on: { type: 'boolean', description: 'For small_panel_rows: turn small rows on or off' },
            },
            required: ['command'],
        },
        features: ids('duplicate_layer', 'show_all_layers', 'hide_others', 'lock_others', 'unlock_all_layers', 'select_items_on_layer', 'small_panel_rows_layers'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { command: 'duplicate', spreadIndex: undefined },
        handler: (a) => {
            const command = enumOf(a.command, COMMANDS, { name: 'command' });
            const needsLayer = ['duplicate', 'hide_others', 'lock_others', 'select_items'].includes(command);
            const layer = needsLayer ? str(nameArg(a.layer, 'layer')) : null;
            let body;
            switch (command) {
                case 'duplicate':
                    body = `var l = __layer(doc, ${layer}), c = l.duplicate();
${has(a.newName) ? `if (doc.layers.itemByName(${str(nameArg(a.newName, 'newName'))}).isValid) { c.remove(); throw new Error("A layer named " + ${str(a.newName)} + " already exists"); }
c.name = ${str(a.newName)};` : ''}
__result__ = { copy: c.name, items: c.pageItems.length, layers: __layers(doc) };`;
                    break;
                case 'show_all':
                    body = 'for (var i = 0; i < doc.layers.length; i++) doc.layers[i].visible = true;\n__result__ = { layers: __layers(doc) };';
                    break;
                case 'unlock_all':
                    body = 'for (var i = 0; i < doc.layers.length; i++) doc.layers[i].locked = false;\n__result__ = { layers: __layers(doc) };';
                    break;
                case 'hide_others':
                case 'lock_others': {
                    const prop = command === 'hide_others' ? 'visible' : 'locked';
                    const others = command === 'hide_others' ? 'false' : 'true';
                    body = `var l = __layer(doc, ${layer});
l.${prop} = ${command === 'hide_others' ? 'true' : 'false'};
for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].id !== l.id) doc.layers[i].${prop} = ${others};
__result__ = { layer: l.name, layers: __layers(doc) };`;
                    break;
                }
                case 'select_items': {
                    const si = has(a.spreadIndex) ? index(a.spreadIndex, { name: 'spreadIndex' }) : null;
                    body = `var l = __layer(doc, ${layer});
var sp = ${si !== null ? `__spread(doc, ${si})` : '__window(doc).activeSpread'};
var items = __onSpread(l, sp);
if (items.length) doc.select(items); else doc.select(NothingEnum.NOTHING);
var out = [];
for (var i = 0; i < items.length; i++) out.push(__itemInfo(items[i]));
__result__ = { layer: l.name, spread: sp.index, selected: out };`;
                    break;
                }
                case 'small_panel_rows':
                    if (typeof a.on !== 'boolean') throw new Error("'on' (true or false) is required for small_panel_rows");
                    body = `var now = __menuOn(18442);
if (now === null || now !== ${bool(a.on)}) __invoke(18442, "Small Panel Rows");
__result__ = { smallPanelRows: ${bool(a.on)} };`;
                    break;
                default:
                    throw new Error(`Unknown command ${command}`);
            }
            return run('Layer command', commandScript(`${LAYER_LIST}
${body}`));
        },
    },
    {
        name: 'send_items_to_layer',
        description: 'Move items to another layer, as dragging the selection square in the Layers panel does; optionally create the layer first',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                layer: { type: 'string', description: 'Destination layer name' },
                create: { type: 'boolean', description: 'Create the layer if it does not exist', default: false },
            },
            required: ['target', 'layer'],
        },
        features: ids('move_to_layer'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const layer = str(nameArg(a.layer, 'layer'));
            return run('Move items to layer', commandScript(`
var l = doc.layers.itemByName(${layer}), created = false;
if (!l.isValid) {
  ${a.create ? `l = doc.layers.add({ name: ${layer} }); created = true;` : `throw new Error("No layer named " + ${layer} + "; pass create: true to make it");`}
}
if (l.locked) throw new Error("Layer " + l.name + " is locked");
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) { items[i].itemLayer = l; out.push(__itemInfo(items[i])); }
__result__ = { layer: l.name, created: created, items: out };`));
        },
    },
    {
        name: 'manage_layer_objects',
        description: 'List the objects under each layer for a spread, as the Layers panel shows them when a layer is expanded, or rename, show, hide, lock or unlock individual objects there',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'update'], description: 'List the objects, or change the given items', default: 'list' },
                layer: { type: 'string', description: 'For list: only this layer (default: every layer)' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'For list: the spread (default: the active spread)' },
                target: TARGET_SCHEMA,
                name: { type: 'string', description: 'For update: new name (one item only)' },
                visible: { type: 'boolean', description: 'For update: show or hide the items' },
                locked: { type: 'boolean', description: 'For update: lock or unlock the items' },
            },
        },
        features: ids('layer_objects_list'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'update', target: { ids: [1] }, name: 'Sample' },
        handler: (a) => {
            const action = enumOf(a.action ?? 'list', ['list', 'update'], { name: 'action' });
            if (action === 'list') {
                const si = has(a.spreadIndex) ? index(a.spreadIndex, { name: 'spreadIndex' }) : null;
                const only = has(a.layer) ? str(nameArg(a.layer, 'layer')) : null;
                return run('List layer objects', commandScript(`${LAYER_LIST}
var sp = ${si !== null ? `__spread(doc, ${si})` : '__window(doc).activeSpread'};
var layers = ${only ? `[__layer(doc, ${only})]` : 'doc.layers.everyItem().getElements()'}, out = [];
for (var i = 0; i < layers.length; i++) {
  var items = __onSpread(layers[i], sp), list = [];
  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    list.push({ id: it.id, type: it.constructor.name, name: it.name || null, visible: it.visible, locked: it.locked });
  }
  out.push({ layer: layers[i].name, visible: layers[i].visible, locked: layers[i].locked, objects: list });
}
__result__ = { spread: sp.index, layers: out };`));
            }
            const L = [];
            if (has(a.name)) L.push(`if (items.length !== 1) throw new Error("Rename one item at a time"); items[0].name = ${str(nameArg(a.name, 'name'))};`);
            if (has(a.visible)) L.push(`for (var v = 0; v < items.length; v++) items[v].visible = ${bool(a.visible)};`);
            if (has(a.locked)) L.push(`for (var k = 0; k < items.length; k++) items[k].locked = ${bool(a.locked)};`);
            if (!L.length) throw new Error('Nothing to change: pass name, visible or locked');
            return run('Update layer objects', commandScript(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
${L.join('\n')}
for (var i = 0; i < items.length; i++) out.push(__itemInfo(items[i]));
__result__ = { items: out };`));
        },
    },
];
