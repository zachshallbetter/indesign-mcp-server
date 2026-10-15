/**
 * Colour: Edit > Edit Colors, swatch groups, deleting swatches, Add Used Colors.
 *
 * The Edit Colors commands run on the selection and have no object-model
 * equivalent; the ones listed here open no dialog. Swatch groups and swatch
 * management use the object model (SwatchGroups, Swatch.remove).
 */
import { str, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';

/** Edit > Edit Colors commands that run without a dialog. */
export const EDIT_COLORS = {
    convert_to_cmyk: 'Colors8',
    convert_to_rgb: 'Colors9',
    convert_to_grayscale: 'Colors7',
    invert: 'Colors6',
    blend_front_to_back: 'Colors3',
    blend_horizontally: 'Colors4',
    blend_vertically: 'Colors5',
};

/** ES3: the name Illustrator gives a process colour's swatch, or null for other colours. */
const COLOR_NAME = `
function __colorName(c) {
  var r = Math.round;
  switch (c.typename) {
    case "CMYKColor": return "C=" + r(c.cyan) + " M=" + r(c.magenta) + " Y=" + r(c.yellow) + " K=" + r(c.black);
    case "RGBColor": return "R=" + r(c.red) + " G=" + r(c.green) + " B=" + r(c.blue);
    case "GrayColor": return "K=" + r(c.gray);
  }
  return null;
}`;

/** ES3: the swatch group with a name, created when asked. */
const GROUP = `
function __swatchGroup(doc, name, create) {
  for (var g = 0; g < doc.swatchGroups.length; g++) if (doc.swatchGroups[g].name === name) return doc.swatchGroups[g];
  if (!create) throw new Error("Swatch group " + name + " not found");
  var grp = doc.swatchGroups.add();
  grp.name = name;
  return grp;
}
function __addToGroup(doc, grp, sw) {
  try { grp.addSwatch(sw); return; } catch (e) {}
  grp.addSpot(doc.spots.getByName(sw.name));
}`;

export const tools = [
    {
        name: 'edit_colors',
        description: 'Recolour the targets with an Edit > Edit Colors command: convert to CMYK, RGB or grayscale, invert, or blend the fills between the frontmost and backmost (or leftmost and rightmost, topmost and bottommost) objects',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(EDIT_COLORS) },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.color.convert_to_cmyk',
            'illustrator.color.convert_to_rgb',
            'illustrator.color.convert_to_grayscale',
            'illustrator.color.convert_color_modes',
            'illustrator.color.invert_colors',
            'illustrator.color.color_invert',
            'illustrator.color.blend_front_to_back',
            'illustrator.color.blend_horizontally',
            'illustrator.color.blend_vertically',
        ],
        menuCommands: Object.values(EDIT_COLORS),
        handler: (a) => {
            const command = EDIT_COLORS[enumOf(a.operation, Object.keys(EDIT_COLORS), { name: 'operation' })];
            return run('Edit colours', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (${a.operation.startsWith('blend_')} && items.length < 3) throw new Error("Blending colours needs at least three filled objects");
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand(${str(command)});
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(doc, items[j]));
__result__ = { operation: ${str(a.operation)}, items: out };`));
        },
    },
    {
        name: 'create_swatch_group',
        description: 'Create a swatch group (a colour group in the Swatches panel), optionally moving existing swatches into it',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Names of existing swatches to move into the group' },
            },
            required: ['name'],
        },
        features: [
            'illustrator.color.swatch_group',
            'illustrator.color.swatches_menu.new_swatch_group',
            'illustrator.color.group_swatches',
            'illustrator.color.move_colors_into_groups',
            'illustrator.color.color_groups',
        ],
        handler: (a) => run('Create swatch group', script(`${GROUP}
for (var g = 0; g < doc.swatchGroups.length; g++) if (doc.swatchGroups[g].name === ${str(a.name)}) throw new Error("A swatch group named " + ${str(a.name)} + " already exists");
var names = ${json((a.swatches ?? []).map(String))}, found = [];
for (var i = 0; i < names.length; i++) {
  var sw = null;
  try { sw = doc.swatches.getByName(names[i]); } catch (e) { sw = null; }
  if (!sw) throw new Error("Swatch " + names[i] + " not found");
  found.push(sw);
}
var grp = __swatchGroup(doc, ${str(a.name)}, true);
for (var j = 0; j < found.length; j++) __addToGroup(doc, grp, found[j]);
var all = grp.getAllSwatches(), members = [];
for (var m = 0; m < all.length; m++) members.push(all[m].name);
__result__ = { group: grp.name, swatches: members };`)),
    },
    {
        name: 'delete_swatches',
        description: 'Delete swatches by name',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            required: ['names'],
        },
        features: ['illustrator.color.swatches_menu.delete_swatch'],
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one swatch");
            return run('Delete swatches', script(`
var names = ${json(a.names.map(String))}, deleted = [], missing = [];
for (var i = 0; i < names.length; i++) {
  if (names[i] === "[None]" || names[i] === "[Registration]") throw new Error(names[i] + " cannot be deleted");
  var sw = null;
  try { sw = doc.swatches.getByName(names[i]); } catch (e) { sw = null; }
  if (!sw) { missing.push(names[i]); continue; }
  sw.remove();
  deleted.push(names[i]);
}
__result__ = { deleted: deleted, notFound: missing };`));
        },
    },
    {
        name: 'add_used_colors',
        description: 'Add a swatch for each process colour used in the fills and strokes of the artwork (Swatches panel > Add Used Colors), skipping colours that already have one. Swatches are named the way Illustrator names them, e.g. "C=0 M=60 Y=100 K=0"',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Only these items. Default the whole document' },
                group: { type: 'string', description: 'Put the new swatches in this swatch group, created if needed' },
            },
        },
        features: [
            'illustrator.color.swatches_menu.add_used_colors',
            'illustrator.color.add_colors_to_swatches',
            'illustrator.color.swatch_group',
            'illustrator.color.color_groups',
        ],
        handler: (a) => run('Add used colours', script(`${EACH_PATH}${COLOR_NAME}${GROUP}
var known = {}, colors = [], names = {}, counts = { paths: 0, skipped: [] };
for (var s = 0; s < doc.swatches.length; s++) { var kn = __colorName(doc.swatches[s].color); if (kn) known[kn] = true; }
function consider(c) { var n = __colorName(c); if (n && !known[n] && !names[n]) { names[n] = true; colors.push(c); } }
function paint(p) { if (p.filled) consider(p.fillColor); if (p.stroked) consider(p.strokeColor); }
var items = ${a.target ? `__targets(doc, ${targetSpec(a.target)})` : 'null'}, texts = [];
if (items) {
  for (var i = 0; i < items.length; i++) { if (items[i].typename === "TextFrame") texts.push(items[i]); else __eachPath(items[i], paint, counts); }
} else {
  for (var p = 0; p < doc.pathItems.length; p++) { paint(doc.pathItems[p]); counts.paths++; }
  for (var t = 0; t < doc.textFrames.length; t++) texts.push(doc.textFrames[t]);
}
for (var x = 0; x < texts.length; x++) {
  try { consider(texts[x].textRange.characterAttributes.fillColor); } catch (e) {}
  try { consider(texts[x].textRange.characterAttributes.strokeColor); } catch (e) {}
}
var grp = ${a.group ? `__swatchGroup(doc, ${str(a.group)}, true)` : 'null'}, added = [];
for (var c = 0; c < colors.length; c++) {
  var sw = doc.swatches.add();
  sw.name = __colorName(colors[c]);
  sw.color = colors[c];
  if (grp) __addToGroup(doc, grp, sw);
  added.push(sw.name);
}
__result__ = { added: added, group: grp ? grp.name : null, pathsScanned: counts.paths, textFrames: texts.length };`)),
    },
];
