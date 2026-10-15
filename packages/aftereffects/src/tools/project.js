/**
 * Projects and the Project panel: describe, list items, import footage, make
 * folders, save, open, start new, and tidy up.
 */
import path from 'node:path';
import { str, index, bool, enumOf, json, createPathPolicy, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';

export const paths = createPathPolicy({ envVar: 'AFTEREFFECTS_ALLOWED_DIRS' });

const IMPORT_AS = { footage: 'FOOTAGE', composition: 'COMP', composition_cropped_layers: 'COMP_CROPPED_LAYERS', project: 'PROJECT' };

export const tools = [
    {
        name: 'get_project_info',
        description: 'Describe the open project: file, unsaved changes, bit depth, working colour space, expression engine, item counts by type, the active item and the render queue',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['aftereffects.projects.project_object'],
        handler: () => run('Project info', script(`
var counts = { composition: 0, footage: 0, folder: 0 };
for (var i = 1; i <= proj.numItems; i++) { var t = __itemType(proj.item(i)); counts[t] = (counts[t] || 0) + 1; }
var active = null;
try { active = proj.activeItem ? __itemInfo(proj.activeItem) : null; } catch (e) {}
__result__ = { file: proj.file ? proj.file.fsName : null, dirty: proj.dirty, bitsPerChannel: proj.bitsPerChannel, workingSpace: proj.workingSpace,
  expressionEngine: proj.expressionEngine, items: proj.numItems, counts: counts, active: active, renderQueueItems: proj.renderQueue.numItems, version: app.version };`)),
    },
    {
        name: 'list_items',
        description: 'List project items (compositions, footage, folders) with their id, type, folder and size. Ids are what other tools take',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['composition', 'footage', 'folder'], description: 'Only this type' },
                folder: { type: 'integer', description: 'Only items inside this folder (id)' },
            },
        },
        hints: { readOnly: true },
        features: ['aftereffects.projects.item_collection_object', 'aftereffects.projects.item_object'],
        handler: (a) => run('List items', script(`
var want = ${a.type ? str(a.type) : 'null'}, folder = ${a.folder !== undefined ? index(a.folder, { name: 'folder' }) : 'null'}, out = [];
for (var i = 1; i <= proj.numItems; i++) {
  var it = proj.item(i);
  if (want && __itemType(it) !== want) continue;
  if (folder !== null && it.parentFolder.id !== folder) continue;
  out.push(__itemInfo(it));
}
__result__ = { count: out.length, items: out };`)),
    },
    {
        name: 'import_files',
        description: 'Import files into the project (File > Import): footage, image sequences, layered Photoshop or Illustrator files as footage or compositions, or another project, optionally into a folder',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200, description: 'Absolute paths' },
                importAs: { type: 'string', enum: Object.keys(IMPORT_AS), description: 'Default footage' },
                sequence: { type: 'boolean', description: 'Import the numbered files after each as an image sequence. Default false', default: false },
                folder: { type: 'integer', description: 'Put the items in this folder (id)' },
            },
            required: ['files'],
        },
        features: [
            'aftereffects.footage.import_file',
            'aftereffects.footage.import_multiple_files',
            'aftereffects.footage.import_options_object',
            'aftereffects.footage.import_as',
            'aftereffects.footage.import_still_sequence',
            'aftereffects.footage.import_into_folder',
            'aftereffects.footage.import_after_effects_project',
            'aftereffects.footage.format_psd',
            'aftereffects.footage.format_ai',
            'aftereffects.footage.format_aep',
            'aftereffects.three_d.three_d_model_import',
            'aftereffects.three_d.three_d_model_formats',
        ],
        handler: (a) => {
            if (!Array.isArray(a.files) || !a.files.length) throw new Error("'files' must list at least one path");
            const files = a.files.map((f) => paths.validate(f));
            const as = IMPORT_AS[enumOf(a.importAs ?? 'footage', Object.keys(IMPORT_AS), { name: 'importAs' })];
            return run('Import files', script(`
var files = ${json(files)}, out = [];
var folder = ${a.folder !== undefined ? `proj.itemByID(${index(a.folder, { name: 'folder' })})` : 'null'};
if (folder !== null && !(folder instanceof FolderItem)) throw new Error("folder must be a folder item");
for (var i = 0; i < files.length; i++) {
  var f = new File(files[i]);
  if (!f.exists) throw new Error("File not found: " + f.fsName);
  var o = new ImportOptions(f);
  if (!o.canImportAs(ImportAsType.${as})) throw new Error(f.name + " cannot be imported as ${as.toLowerCase()}");
  o.importAs = ImportAsType.${as};
  o.sequence = ${bool(a.sequence)};
  var it = proj.importFile(o);
  if (folder) it.parentFolder = folder;
  out.push(__itemInfo(it));
}
__result__ = { imported: out };`, { undo: 'Import files' }));
        },
    },
    {
        name: 'create_folder',
        description: 'Add a folder to the Project panel, optionally inside another folder, and move items into it',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parent: { type: 'integer', description: 'Parent folder id' },
                items: { type: 'array', items: { type: 'integer' }, description: 'Item ids to move into the new folder' },
            },
            required: ['name'],
        },
        features: ['aftereffects.projects.new_folder', 'aftereffects.projects.folder_item_object', 'aftereffects.projects.move_items_to_folder'],
        handler: (a) => run('Create folder', script(`
var f = proj.items.addFolder(${str(a.name)});
${a.parent !== undefined ? `var p = proj.itemByID(${index(a.parent, { name: 'parent' })}); if (!(p instanceof FolderItem)) throw new Error("parent must be a folder"); f.parentFolder = p;` : ''}
var ids = ${json((a.items ?? []).map((i) => Number(index(i, { name: 'items' }))))};
for (var i = 0; i < ids.length; i++) { var it = proj.itemByID(ids[i]); if (!it) throw new Error("No item " + ids[i]); it.parentFolder = f; }
__result__ = __itemInfo(f);`, { undo: 'Create folder' })),
    },
    {
        name: 'manage_items',
        description: 'Rename, move to a folder, set the label colour of, or delete project items',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'Item ids' },
                rename: { type: 'string', description: 'New name (one item only)' },
                folder: { type: 'integer', description: 'Move into this folder (id); 0 for the root' },
                label: { type: 'integer', minimum: 0, maximum: 16, description: 'Label colour number, 0 = none' },
                delete: { type: 'boolean', description: 'Delete the items. Default false', default: false },
            },
            required: ['items'],
        },
        hints: { destructive: true },
        features: [
            'aftereffects.projects.rename_project_item',
            'aftereffects.projects.move_items_to_folder',
            'aftereffects.projects.project_item_label',
            'aftereffects.projects.delete_project_item',
        ],
        handler: (a) => {
            if (!Array.isArray(a.items) || !a.items.length) throw new Error("'items' must list at least one id");
            if (a.rename !== undefined && a.items.length > 1) throw new Error('Rename one item at a time');
            if (a.delete && (a.rename !== undefined || a.folder !== undefined || a.label !== undefined)) throw new Error('delete cannot be combined with other changes');
            return run('Manage items', script(`
var ids = ${json(a.items.map((i) => Number(index(i, { name: 'items' }))))}, out = [];
for (var i = 0; i < ids.length; i++) {
  var it = proj.itemByID(ids[i]);
  if (!it) throw new Error("No item " + ids[i]);
  ${a.delete ? 'out.push({ id: it.id, name: it.name, deleted: true }); it.remove(); continue;' : ''}
  ${a.rename !== undefined ? `it.name = ${str(a.rename)};` : ''}
  ${a.folder !== undefined ? `it.parentFolder = ${Number(a.folder) === 0 ? 'proj.rootFolder' : `proj.itemByID(${index(a.folder, { name: 'folder' })})`};` : ''}
  ${a.label !== undefined ? `it.label = ${index(a.label, { name: 'label', max: 16 })};` : ''}
  out.push(__itemInfo(it));
}
__result__ = { items: out };`, { undo: 'Manage items' }));
        },
    },
    {
        name: 'save_project',
        description: 'Save the project in place, or as a new .aep file (the project then refers to it)',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .aep path. Omit to save in place' } } },
        hints: { destructive: true, idempotent: true },
        features: ['aftereffects.projects.save', 'aftereffects.projects.save_as', 'aftereffects.projects.aep_format'],
        handler: (a) => {
            if (!a.filePath) {
                return run('Save project', script(`
if (!proj.file) throw new Error("The project has never been saved: pass filePath");
proj.save();
__result__ = { saved: proj.file.fsName };`));
            }
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.aep') throw new Error('filePath must end in .aep');
            return run('Save project', script(`
proj.save(new File(${jsxPath(p)}));
__result__ = { saved: proj.file.fsName };`));
        },
    },
    {
        name: 'open_project',
        description: 'Open an .aep project (or a .mogrt Motion Graphics template as a project), or start a new empty one. Unsaved changes in the current project are discarded, so save first',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .aep (or .mogrt) path. Omit for a new project' } } },
        hints: { destructive: true },
        features: ['aftereffects.projects.open_project', 'aftereffects.projects.new_project', 'aftereffects.projects.aep_format', 'aftereffects.essential_graphics.open_mogrt_as_project'],
        handler: (a) => {
            if (!a.filePath) return run('New project', script('var p = app.newProject();\n__result__ = { file: null, items: app.project.numItems };'));
            const p = paths.validate(a.filePath);
            return run('Open project', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var opened = app.open(f);
__result__ = { file: opened.file ? opened.file.fsName : null, items: opened.numItems };`));
        },
    },
    {
        name: 'tidy_project',
        description: 'Remove unused footage, consolidate duplicate footage, or reduce the project to the chosen compositions and what they use (File > Dependencies)',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['remove_unused_footage', 'consolidate_footage', 'reduce_project'] },
                keep: { type: 'array', items: { type: 'integer' }, description: 'reduce_project: composition ids to keep' },
            },
            required: ['operation'],
        },
        hints: { destructive: true },
        features: ['aftereffects.projects.remove_unused_footage', 'aftereffects.projects.consolidate_all_footage', 'aftereffects.projects.reduce_project'],
        handler: (a) => {
            const op = enumOf(a.operation, ['remove_unused_footage', 'consolidate_footage', 'reduce_project'], { name: 'operation' });
            if (op === 'reduce_project' && !(Array.isArray(a.keep) && a.keep.length)) throw new Error("reduce_project needs 'keep'");
            return run('Tidy project', script(`
var before = proj.numItems, n = 0;
${op === 'remove_unused_footage' ? 'n = proj.removeUnusedFootage();' : ''}
${op === 'consolidate_footage' ? 'n = proj.consolidateFootage();' : ''}
${op === 'reduce_project' ? `var keep = [], ids = ${json((a.keep ?? []).map((i) => Number(index(i, { name: 'keep' }))))};
for (var i = 0; i < ids.length; i++) { var it = proj.itemByID(ids[i]); if (!it) throw new Error("No item " + ids[i]); keep.push(it); }
n = proj.reduceProject(keep);` : ''}
__result__ = { operation: ${str(op)}, itemsBefore: before, itemsAfter: proj.numItems, affected: n };`, { undo: 'Tidy project' }));
        },
    },
];
