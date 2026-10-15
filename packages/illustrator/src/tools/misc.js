/**
 * Graphs, clipping masks and gradient meshes.
 *
 * Graphs: the object model has no constructor for a graph and no member for
 * its type, axes or design (those are the Graph Type, Column, Marker and Design
 * dialogs). What a script can do is find graphs and feed them data: a graph
 * bound to a graph variable redraws when a data set is displayed, and data sets
 * come from a variable library (see variables.js).
 *
 * Clipping masks are clip groups: a GroupItem with clipped set, whose clipping
 * path is its topmost item. Adding or removing artwork is moving it into or out
 * of the group, which is also what Draw Inside produces.
 *
 * Meshes: MeshItem exposes no mesh members, and creating a mesh goes through
 * the Create Gradient Mesh dialog, so meshes can only be listed.
 */
import path from 'node:path';
import { str, index, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

/** ES3: the clipping path of a clip group (a path or compound path marked as clipping), or null. */
const CLIP_FNS = `
function __isMask(it) {
  if (it.typename === "PathItem") return it.clipping;
  if (it.typename === "CompoundPathItem") return it.pathItems.length > 0 && it.pathItems[0].clipping;
  return false;
}
function __maskOf(g) {
  for (var m = 0; m < g.pageItems.length; m++) if (__isMask(g.pageItems[m])) return g.pageItems[m];
  return null;
}
function __clipGroup(it, label) {
  if (it.typename !== "GroupItem" || !it.clipped) throw new Error(label + ": " + (it.name || it.typename) + " is not a clip group");
  return it;
}`;

/** ES3: graphs as item info, each with the graph variable bound to it. */
const GRAPH_LIST = `
var graphs = [];
for (var i = 0; i < doc.graphItems.length; i++) {
  var gi = doc.graphItems[i], info = __itemInfo(doc, gi), v = null;
  try { v = gi.contentVariable; } catch (e) { v = null; }
  info.variable = v ? v.name : null;
  graphs.push(info);
}`;

export const tools = [
    {
        name: 'list_graphs',
        description: 'List the document\'s graphs (made with the graph tools) with their position and the graph variable each is bound to, plus the data sets that can redraw them',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.graphs.graph_object'],
        hints: { readOnly: true },
        handler: () => run('List graphs', script(`${GRAPH_LIST}
var sets = [];
for (var d = 0; d < doc.dataSets.length; d++) sets.push(doc.dataSets[d].name);
var active = null;
try { active = doc.activeDataSet ? doc.activeDataSet.name : null; } catch (e) { active = null; }
__result__ = { graphs: graphs, dataSets: sets, activeDataSet: active };`)),
    },
    {
        name: 'apply_graph_data',
        description: 'Redraw graphs with new data (the Graph Data window\'s Import Data and Apply): optionally load a variable library (.xml) holding graph data, then display one of its data sets. Graphs must be bound to graph variables (create_variable with kind graph); a library exported from Illustrator after entering data in the graph carries the format',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .xml path of a variable library to load first' },
                dataSet: { type: 'string', description: 'Data set to display. Default the first one' },
                index: { type: 'integer', minimum: 0, description: 'Or the data set\'s 0-based position' },
            },
        },
        features: [
            'illustrator.graphs.graph_data_control.import_data',
            'illustrator.graphs.graph_data_control.apply',
            'illustrator.graphs.data_options',
        ],
        hints: { destructive: false, idempotent: false },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'graph-data.xml'), dataSet: 'Q1', index: undefined },
        handler: (a) => {
            if (a.dataSet !== undefined && a.index !== undefined) throw new Error('Give dataSet or index, not both');
            let file = null;
            if (a.filePath !== undefined) {
                file = paths.validate(a.filePath);
                if (path.extname(file).toLowerCase() !== '.xml') throw new Error('filePath must end in .xml');
            }
            const pick = a.dataSet !== undefined
                ? `try { ds = doc.dataSets.getByName(${str(a.dataSet)}); } catch (e) { ds = null; }
if (!ds) throw new Error("Data set " + ${str(a.dataSet)} + " not found");`
                : `var at = ${index(a.index ?? 0, { name: 'index' })};
if (at >= doc.dataSets.length) throw new Error(doc.dataSets.length ? "Data set " + at + " does not exist; the document has " + doc.dataSets.length : "The document has no data sets: give filePath to load a variable library");
ds = doc.dataSets[at];`;
            return run('Apply graph data', script(`
${file ? `if (doc.variablesLocked) throw new Error("Variables are locked in this document: set_variables_locked { locked: false } first");
var f = new File(${jsxPath(file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
doc.importVariables(f);` : ''}
var ds = null;
${pick}
ds.display();
${GRAPH_LIST}
var bound = 0;
for (var b = 0; b < graphs.length; b++) if (graphs[b].variable) bound++;
__result__ = { showing: ds.name, graphs: graphs, note: bound ? null : "No graph is bound to a graph variable, so no graph was redrawn" };`));
        },
    },
    {
        name: 'release_clipping_mask',
        description: 'Release clip groups (Object > Clipping Mask > Release): the contents show in full again and the clipping path stays as a path with no fill or stroke',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Clip groups to release' } }, required: ['target'] },
        features: ['illustrator.clipping.release'],
        menuCommands: ['releaseMask'],
        hints: { destructive: true, idempotent: false },
        handler: (a) => run('Release clipping mask', script(`${CLIP_FNS}
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) __clipGroup(items[i], "Release");
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand("releaseMask");
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { released: items.length, selection: out };`)),
    },
    {
        name: 'edit_clipping_mask',
        description: 'Select the clipping path of clip groups (Object > Clipping Mask > Edit Mask) or their contents (Edit Contents), so other tools can change them; returns their ids',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Clip groups' },
                part: { type: 'string', enum: ['mask', 'contents'], description: 'mask: the clipping path; contents: everything it clips' },
            },
            required: ['target', 'part'],
        },
        features: ['illustrator.clipping.edit_mask'],
        hints: { destructive: false, idempotent: true },
        handler: (a) => {
            if (!['mask', 'contents'].includes(a.part)) throw new Error("'part' must be mask or contents");
            return run('Edit clipping mask', script(`${CLIP_FNS}
var groups = __targets(doc, ${targetSpec(a.target)}), picked = [];
for (var i = 0; i < groups.length; i++) {
  var g = __clipGroup(groups[i], "Edit mask"), mask = __maskOf(g);
  if (!mask) throw new Error("No clipping path found in " + (g.name || "the clip group"));
  ${a.part === 'mask' ? 'picked.push(mask);' : 'for (var c = 0; c < g.pageItems.length; c++) if (g.pageItems[c] !== mask) picked.push(g.pageItems[c]);'}
}
doc.selection = null;
for (var k = 0; k < picked.length; k++) picked[k].selected = true;
var out = [];
for (var j = 0; j < picked.length; j++) out.push(__itemInfo(doc, picked[j]));
__result__ = { part: ${str(a.part)}, items: out };`));
        },
    },
    {
        name: 'add_to_clipping_mask',
        description: 'Put items inside a clipping mask, keeping their position: into an existing clip group (given the group or its clipping path), or, given a plain path or compound path, make that path a clipping mask around them the way Draw Inside does. The items go in front of the group\'s other contents',
        inputSchema: {
            type: 'object',
            properties: {
                containerId: { type: 'string', description: 'Id of a clip group, its clipping path, or a path or compound path to draw inside' },
                target: { ...TARGET_SCHEMA, description: 'Items to put inside' },
            },
            required: ['containerId', 'target'],
        },
        features: ['illustrator.clipping.add_remove', 'illustrator.clipping.draw_inside'],
        hints: { destructive: false, idempotent: false },
        handler: (a) => {
            if (!a.containerId) throw new Error('Give containerId: a clip group, its clipping path, or a path');
            return run('Add to clipping mask', script(`${CLIP_FNS}
var c = null;
try { c = doc.getPageItemFromUuid(${str(a.containerId)}); } catch (e) { c = null; }
if (!c) throw new Error("Item " + ${str(a.containerId)} + " not found");
var items = __targets(doc, ${targetSpec(a.target)}), g = null, mask = null, created = false;
if (c.typename === "GroupItem" && c.clipped) { g = c; mask = __maskOf(g); }
else if (c.parent.typename === "GroupItem" && c.parent.clipped && __isMask(c)) { g = c.parent; mask = c; }
else if (c.typename === "PathItem" || c.typename === "CompoundPathItem") {
  g = c.parent.groupItems.add();
  g.move(c, ElementPlacement.PLACEBEFORE);
  c.move(g, ElementPlacement.PLACEATBEGINNING);
  g.clipped = true;
  mask = c;
  created = true;
} else throw new Error("containerId must be a clip group, its clipping path, or a path or compound path; it is a " + c.typename);
if (!mask) throw new Error("No clipping path found in the clip group");
for (var i = 0; i < items.length; i++) {
  if (items[i] === mask || items[i] === g) throw new Error("The container cannot be put inside itself");
  for (var up = g.parent; up && up.typename !== "Layer" && up.typename !== "Document"; up = up.parent) if (up === items[i]) throw new Error("An item that contains the clip group cannot be put inside it");
}
for (var j = items.length - 1; j >= 0; j--) items[j].move(mask, ElementPlacement.PLACEAFTER);
__result__ = { group: __itemInfo(doc, g), mask: __itemInfo(doc, mask), added: items.length, createdMask: created };`));
        },
    },
    {
        name: 'remove_from_clipping_mask',
        description: 'Take items out of their clip group, keeping their position: they are placed just in front of the group and are no longer clipped. The clipping path itself cannot be removed this way (use release_clipping_mask)',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'Items inside clip groups' } }, required: ['target'] },
        features: ['illustrator.clipping.add_remove'],
        hints: { destructive: false, idempotent: false },
        handler: (a) => run('Remove from clipping mask', script(`${CLIP_FNS}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var p = items[i].parent;
  if (p.typename !== "GroupItem" || !p.clipped) throw new Error((items[i].name || items[i].typename) + " is not inside a clip group");
  if (__isMask(items[i])) throw new Error("That is the clipping path: release the mask instead");
}
for (var k = 0; k < items.length; k++) { items[k].move(items[k].parent, ElementPlacement.PLACEBEFORE); out.push(__itemInfo(doc, items[k])); }
__result__ = { removed: out.length, items: out };`)),
    },
    {
        name: 'list_meshes',
        description: 'List the document\'s gradient mesh objects with their id, position and size. Mesh points and colours are not reachable by script',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.meshes.mesh_object'],
        hints: { readOnly: true },
        handler: () => run('List meshes', script(`
var out = [];
for (var i = 0; i < doc.meshItems.length; i++) out.push(__itemInfo(doc, doc.meshItems[i]));
__result__ = { meshes: out };`)),
    },
];
