/**
 * Variables and data sets: data-driven graphics.
 *
 * A variable is bound to objects: a text variable to text frames, an image
 * variable to placed images, a graph variable to graphs, a visibility variable
 * to any object. A data set is a snapshot of every variable's value; adding one
 * captures the objects as they are, so create_data_sets sets each record's
 * values on the bound objects and then adds (or updates) the data set, the way
 * published variable scripts do. Displaying a data set puts its values back.
 */
import path from 'node:path';
import { str, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec, artboardRange } from '../args.js';
import { paths } from './documents.js';
import { RANGE_FN, pngOptions, jpegOptions } from './output.js';

export const KINDS = { text: 'TEXTUAL', image: 'IMAGE', graph: 'GRAPH', visibility: 'VISIBILITY' };

/** Illustrator stores variables in XML, so a name must be an XML name. */
function variableName(value, name = 'name') {
    const v = String(value ?? '');
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v) || v.length > 200) {
        throw new Error(`'${name}' must start with a letter or underscore and use only letters, digits, _ . and -: ${JSON.stringify(v)}`);
    }
    return v;
}

/** ES3 helpers: describe a variable; find one by name; bind it to an item by kind. */
const VARS = `
function __kindName(k) {
  if (k === VariableKind.TEXTUAL) return "text";
  if (k === VariableKind.IMAGE) return "image";
  if (k === VariableKind.GRAPH) return "graph";
  if (k === VariableKind.VISIBILITY) return "visibility";
  return "unknown";
}
function __variable(doc, name) {
  var v = null;
  try { v = doc.variables.getByName(name); } catch (e) { v = null; }
  if (!v) throw new Error("Variable " + name + " not found");
  return v;
}
function __bind(v, it) {
  var k = v.kind, t = it.typename;
  if (k === VariableKind.VISIBILITY) { it.visibilityVariable = v; return; }
  if (k === VariableKind.TEXTUAL && t === "TextFrame") { it.contentVariable = v; return; }
  if (k === VariableKind.IMAGE && (t === "PlacedItem" || t === "RasterItem")) { it.contentVariable = v; return; }
  if (k === VariableKind.GRAPH && t === "GraphItem") { it.contentVariable = v; return; }
  throw new Error("A " + __kindName(k) + " variable cannot be bound to a " + t);
}
function __unlocked(doc) {
  if (doc.variablesLocked) throw new Error("Variables are locked in this document: set_variables_locked { locked: false } first");
}`;

export const tools = [
    {
        name: 'list_variables',
        description: 'List the document\'s variables with their kind and the items bound to them, its data sets, the data set on display, and whether variables are locked',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.automation.variables_panel', 'illustrator.automation.variable_object', 'illustrator.automation.data_set_object'],
        handler: () => run('List variables', script(`${VARS}
var vars = [];
for (var i = 0; i < doc.variables.length; i++) {
  var v = doc.variables[i], bound = [];
  for (var j = 0; j < v.pageItems.length; j++) bound.push(__itemInfo(doc, v.pageItems[j]));
  vars.push({ name: v.name, kind: __kindName(v.kind), items: bound });
}
var sets = [];
for (var d = 0; d < doc.dataSets.length; d++) sets.push(doc.dataSets[d].name);
var active = null;
try { active = doc.activeDataSet ? doc.activeDataSet.name : null; } catch (e) { active = null; }
__result__ = { variables: vars, dataSets: sets, activeDataSet: active, locked: doc.variablesLocked };`)),
    },
    {
        name: 'create_variable',
        description: 'Create a variable (Variables panel > New Variable) and optionally bind it to items: text to text frames, image to placed images, graph to graphs, visibility to any object (Make Object Dynamic, Make Visibility Dynamic)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Letters, digits, _ . and -; starts with a letter or underscore' },
                kind: { type: 'string', enum: Object.keys(KINDS) },
                target: { ...TARGET_SCHEMA, description: 'Items to bind it to' },
            },
            required: ['name', 'kind'],
        },
        features: [
            'illustrator.automation.variable_object',
            'illustrator.automation.variables_control.new_variable',
            'illustrator.automation.variables_control.make_object_dynamic',
            'illustrator.automation.variables_control.make_visibility_dynamic',
        ],
        handler: (a) => {
            const name = variableName(a.name);
            const kind = KINDS[enumOf(a.kind, Object.keys(KINDS), { name: 'kind' })];
            return run('Create variable', script(`${VARS}
__unlocked(doc);
var existing = null;
try { existing = doc.variables.getByName(${str(name)}); } catch (e) { existing = null; }
if (existing) throw new Error("A variable named " + ${str(name)} + " already exists");
var items = ${a.target ? `__targets(doc, ${targetSpec(a.target)})` : '[]'};
var v = doc.variables.add();
v.kind = VariableKind.${kind};
v.name = ${str(name)};
try { for (var i = 0; i < items.length; i++) __bind(v, items[i]); } catch (e) { v.remove(); throw e; }
__result__ = { name: v.name, kind: __kindName(v.kind), bound: items.length };`));
        },
    },
    {
        name: 'bind_variable',
        description: 'Bind an existing variable to more items. Each item takes the variable\'s kind: a text frame for text, a placed image for image, a graph for graph, any object for visibility',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, target: TARGET_SCHEMA },
            required: ['name', 'target'],
        },
        features: ['illustrator.automation.variables_control.make_object_dynamic', 'illustrator.automation.variables_control.make_visibility_dynamic'],
        handler: (a) => run('Bind variable', script(`${VARS}
__unlocked(doc);
var v = __variable(doc, ${str(variableName(a.name))});
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) __bind(v, items[i]);
__result__ = { name: v.name, kind: __kindName(v.kind), bound: v.pageItems.length };`)),
    },
    {
        name: 'delete_variables',
        description: 'Delete variables by name. Their bound items stay in the document, no longer dynamic',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            required: ['names'],
        },
        features: ['illustrator.automation.variables_control.delete_variable'],
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("'names' must list at least one variable");
            return run('Delete variables', script(`${VARS}
__unlocked(doc);
var names = ${json(a.names.map(String))}, deleted = [], missing = [];
for (var i = 0; i < names.length; i++) {
  var v = null;
  try { v = doc.variables.getByName(names[i]); } catch (e) { v = null; }
  if (!v) { missing.push(names[i]); continue; }
  v.remove();
  deleted.push(names[i]);
}
__result__ = { deleted: deleted, notFound: missing };`));
        },
    },
    {
        name: 'create_data_sets',
        description: 'Create data sets from records: for each record, set the bound items to its values (text for text variables, an image file for image variables, true/false for visibility) and capture a data set with its name. A record that names an existing data set updates it. Variables a record leaves out keep their previous value',
        inputSchema: {
            type: 'object',
            properties: {
                records: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 1000,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Data set name' },
                            values: { type: 'object', description: 'Variable name to value: a string for text, an absolute file path for image, true (visible) or false for visibility' },
                        },
                        required: ['name', 'values'],
                    },
                },
                show: { type: 'string', description: 'Data set to display afterwards. Default the first record' },
            },
            required: ['records'],
        },
        features: [
            'illustrator.automation.data_set_object',
            'illustrator.automation.variables_control.previous_data_set_and_next_data_set',
        ],
        handler: (a) => {
            if (!Array.isArray(a.records) || !a.records.length) throw new Error("'records' must list at least one record");
            if (a.records.length > 1000) throw new Error("'records' holds at most 1000 records per call");
            const records = a.records.map((r, i) => {
                if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name) throw new Error(`records[${i}] needs a name`);
                if (!r.values || typeof r.values !== 'object' || Array.isArray(r.values)) throw new Error(`records[${i}].values must be an object of variable name to value`);
                const values = Object.entries(r.values).map(([k, v]) => {
                    variableName(k, `records[${i}].values key`);
                    if (typeof v === 'boolean') return { name: k, visible: v };
                    if (typeof v === 'string' && path.isAbsolute(v)) {
                        // Text can look like a path; the path rules apply only if an image variable uses it.
                        try { return { name: k, text: v, file: paths.validate(v) }; } catch (e) { return { name: k, text: v, fileError: e.message }; }
                    }
                    if (typeof v === 'string' || typeof v === 'number') return { name: k, text: String(v) };
                    throw new Error(`records[${i}].values.${k} must be text, a file path or true/false`);
                });
                return { name: r.name, values };
            });
            const show = a.show ?? records[0].name;
            return run('Create data sets', script(`${VARS}
__unlocked(doc);
var records = ${json(records)}, made = [], updated = [];
for (var r = 0; r < records.length; r++) {
  var rec = records[r], ds = null;
  try { ds = doc.dataSets.getByName(rec.name); } catch (e) { ds = null; }
  if (ds) ds.display();
  for (var k = 0; k < rec.values.length; k++) {
    var val = rec.values[k], v = __variable(doc, val.name), items = v.pageItems;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (v.kind === VariableKind.VISIBILITY) {
        if (val.visible === undefined) throw new Error(rec.name + ": " + val.name + " is a visibility variable: give true or false");
        it.hidden = !val.visible;
      } else if (v.kind === VariableKind.TEXTUAL) {
        if (val.visible !== undefined) throw new Error(rec.name + ": " + val.name + " is a text variable: give text");
        it.contents = val.text;
      } else if (v.kind === VariableKind.IMAGE) {
        if (val.fileError) throw new Error(rec.name + ": " + val.name + ": " + val.fileError);
        if (!val.file) throw new Error(rec.name + ": " + val.name + " is an image variable: give an absolute file path");
        if (it.typename !== "PlacedItem") throw new Error(rec.name + ": " + val.name + " is bound to an embedded image, which cannot be relinked");
        var f = new File(val.file);
        if (!f.exists) throw new Error(rec.name + ": file not found: " + f.fsName);
        it.file = f;
      } else {
        throw new Error(rec.name + ": " + val.name + " is a " + __kindName(v.kind) + " variable; its data comes from a variable library (import_variables)");
      }
    }
  }
  if (ds) { ds.update(); updated.push(rec.name); }
  else { ds = doc.dataSets.add(); ds.name = rec.name; made.push(rec.name); }
}
var shown = null;
try { shown = doc.dataSets.getByName(${str(show)}); } catch (e) { shown = null; }
if (!shown) throw new Error("Data set to show not found: " + ${str(show)});
shown.display();
__result__ = { created: made, updated: updated, showing: ${str(show)}, total: doc.dataSets.length };`));
        },
    },
    {
        name: 'show_data_set',
        description: 'Display a data set: its values replace the bound items\' current content (Variables panel > previous/next data set)',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Data set name' }, index: { type: 'integer', minimum: 0, description: 'Or its 0-based position' } },
        },
        features: ['illustrator.automation.variables_control.previous_data_set_and_next_data_set', 'illustrator.automation.data_set_object'],
        handler: (a) => {
            if ((a.name === undefined) === (a.index === undefined)) throw new Error('Give name or index');
            return run('Show data set', script(`
var ds = ${a.name !== undefined ? `null;
try { ds = doc.dataSets.getByName(${str(a.name)}); } catch (e) { ds = null; }
if (!ds) throw new Error("Data set " + ${str(a.name)} + " not found")` : `null;
var at = ${index(a.index, { name: 'index' })};
if (at >= doc.dataSets.length) throw new Error("Data set " + at + " does not exist; the document has " + doc.dataSets.length);
ds = doc.dataSets[at]`};
ds.display();
__result__ = { showing: ds.name };`));
        },
    },
    {
        name: 'delete_data_sets',
        description: 'Delete data sets by name, or all of them. Variables and the artwork stay as displayed',
        inputSchema: {
            type: 'object',
            properties: {
                names: { type: 'array', items: { type: 'string' } },
                all: { type: 'boolean', description: 'Delete every data set' },
            },
        },
        features: ['illustrator.automation.data_set_object'],
        handler: (a) => {
            if (!a.all && !(Array.isArray(a.names) && a.names.length)) throw new Error('Give names, or all: true');
            if (a.all && a.names) throw new Error('Give names or all, not both');
            return run('Delete data sets', script(a.all ? `
var n = doc.dataSets.length;
if (n) doc.dataSets.removeAll();
__result__ = { deleted: n };` : `
var names = ${json(a.names.map(String))}, deleted = [], missing = [];
for (var i = 0; i < names.length; i++) {
  var ds = null;
  try { ds = doc.dataSets.getByName(names[i]); } catch (e) { ds = null; }
  if (!ds) { missing.push(names[i]); continue; }
  ds.remove();
  deleted.push(names[i]);
}
__result__ = { deleted: deleted, notFound: missing };`));
        },
    },
    {
        name: 'import_variables',
        description: 'Load a variable library (Variables panel > Load Variable Library): an XML file of variables and data sets, e.g. one saved by export_variables or another Illustrator document. Variables bind to objects by name',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .xml path' } }, required: ['filePath'] },
        features: ['illustrator.automation.import_data', 'illustrator.graphs.labels_data_sets'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.xml') throw new Error('filePath must end in .xml');
            return run('Import variables', script(`${VARS}
__unlocked(doc);
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
doc.importVariables(f);
var sets = [];
for (var d = 0; d < doc.dataSets.length; d++) sets.push(doc.dataSets[d].name);
__result__ = { imported: f.fsName, variables: doc.variables.length, dataSets: sets };`));
        },
    },
    {
        name: 'export_variables',
        description: 'Save the document\'s variables and data sets as a variable library (Variables panel > Save Variable Library), an XML file',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .xml path' } }, required: ['filePath'] },
        features: ['illustrator.automation.export_data'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.xml') throw new Error('filePath must end in .xml');
            return run('Export variables', script(`
if (!doc.variables.length) throw new Error("The document has no variables");
var f = new File(${jsxPath(p)});
doc.exportVariables(f);
__result__ = { exported: f.fsName, variables: doc.variables.length, dataSets: doc.dataSets.length };`));
        },
    },
    {
        name: 'set_variables_locked',
        description: 'Lock or unlock the document\'s variables (Variables panel > Lock Variables). Locked variables cannot be created, bound or deleted',
        inputSchema: { type: 'object', properties: { locked: { type: 'boolean' } }, required: ['locked'] },
        features: ['illustrator.automation.variables_control.lock_variables'],
        handler: (a) => run('Lock variables', script(`
doc.variablesLocked = ${bool(a.locked)};
__result__ = { locked: doc.variablesLocked };`)),
    },
    {
        name: 'export_data_sets',
        description: 'Export every data set (or the ones named) as PNG or JPEG files: each data set is displayed in turn and its artboards exported as <data set>-<artboard>.<ext>. The data set on display before is shown again afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                dataSets: { type: 'array', items: { type: 'string' }, description: 'Data set names. Default all' },
                format: { type: 'string', enum: ['png', 'jpeg'], description: 'Default png' },
                artboards: { type: 'string', description: 'Artboards, 1-based: "1", "1-3,5". Default all' },
                scale: { type: 'number', minimum: 1, maximum: 7760, description: 'Percent. Default 100' },
                transparent: { type: 'boolean', description: 'PNG: transparent background. Default true' },
                quality: { type: 'integer', minimum: 0, maximum: 100, description: 'JPEG quality. Default 80' },
            },
            required: ['outputFolder'],
        },
        features: [
            'illustrator.automation.data_set_object',
            'illustrator.import_export.export_png',
            'illustrator.import_export.export_jpeg',
            'illustrator.artboards.artboard_export',
        ],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const format = enumOf(a.format ?? 'png', ['png', 'jpeg'], { name: 'format' });
            if (format === 'png' && a.quality !== undefined) throw new Error("'quality' applies to jpeg");
            if (format === 'jpeg' && a.transparent !== undefined) throw new Error("'transparent' applies to png");
            const options = format === 'png' ? pngOptions(a) : jpegOptions(a);
            const ext = format === 'png' ? 'png' : 'jpg';
            return run('Export data sets', script(`${RANGE_FN}
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${options}
var wanted = ${a.dataSets ? json(a.dataSets.map(String)) : 'null'}, sets = [];
if (wanted) {
  for (var w = 0; w < wanted.length; w++) {
    var ds = null;
    try { ds = doc.dataSets.getByName(wanted[w]); } catch (e) { ds = null; }
    if (!ds) throw new Error("Data set " + wanted[w] + " not found");
    sets.push(ds);
  }
} else {
  for (var d = 0; d < doc.dataSets.length; d++) sets.push(doc.dataSets[d]);
}
if (!sets.length) throw new Error("The document has no data sets");
var before = null;
try { before = doc.activeDataSet; } catch (e) { before = null; }
var boards = __range(${str(artboardRange(a.artboards))}, doc.artboards.length), files = [];
var was = doc.artboards.getActiveArtboardIndex();
function safe(s) { return String(s).replace(/[\\\\/:*?"<>|]/g, "_"); }
try {
  for (var s = 0; s < sets.length; s++) {
    sets[s].display();
    for (var k = 0; k < boards.length; k++) {
      doc.artboards.setActiveArtboardIndex(boards[k]);
      var out = new File(folder.fsName + "/" + safe(sets[s].name) + "-" + safe(doc.artboards[boards[k]].name) + ".${ext}");
      doc.exportFile(out, ExportType.${format === 'png' ? 'PNG24' : 'JPEG'}, o);
      files.push(out.fsName);
    }
  }
} finally {
  doc.artboards.setActiveArtboardIndex(was);
  if (before) try { before.display(); } catch (e) {}
}
__result__ = { files: files, dataSets: sets.length };`));
        },
    },
];
