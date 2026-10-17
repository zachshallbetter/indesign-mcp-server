/**
 * The project and the Project panel: describe, create, open, save and close
 * projects; list, import, organise and inspect project items.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createPathPolicy, json, bool, index, str, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ITEM_SCHEMA, itemSpec, itemSpecs } from '../args.js';

export const paths = createPathPolicy({ envVar: 'PREMIERE_ALLOWED_DIRS' });

/** Resolve a path, check it against the allowed folders and, when given, its extension. */
export function checkedPath(value, name, extensions) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' must be an absolute path`);
    if (!path.isAbsolute(value)) throw new Error(`'${name}' must be an absolute path: ${value}`);
    const resolved = paths.validate(value);
    if (extensions) {
        const ext = path.extname(resolved).toLowerCase();
        if (!extensions.includes(ext)) throw new Error(`'${name}' must end in ${extensions.join(', ')}: ${value}`);
    }
    return resolved;
}

const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');

/**
 * What import_media performs: Project.importFiles takes any file Premiere Pro
 * can import, so each importable format and kind of file is one of these.
 * After Effects projects go through import_after_effects_comps instead.
 */
const IMPORT_FEATURES = [
    'import', 'import_from_media_browser', 'media_browser', 'import_still_images', 'import_image_sequence', 'import_layered_files',
    'import_premiere_elements', 'import_avid_project', 'import_digital_audio', 'blackmagic_raw', 'batch_list_import',
    ...[
        'quicktime', 'mp4_h264', 'hevc', 'prores', 'mxf', 'dnxhd_dnxhr', 'avchd', 'r3d', 'arriraw', 'sony_raw', 'canon_raw', 'cinemadng',
        'openexr', 'dpx', 'avi', 'wmv', 'mpeg', 'wav', 'aiff', 'mp3', 'aac', 'psd', 'ai_eps', 'jpeg', 'png', 'tiff', 'gif', 'heif', 'targa',
        'aaf', 'edl', 'fcp_xml', 'chproj',
    ].map((f) => `format_${f}`),
].map((f) => `premiere.media_import.${f}`);

export const tools = [
    {
        name: 'get_project_info',
        description: 'Describe the active project: name, file path, guid, the active sequence, how many sequences and top-level items it has, and the bin imports go to',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['premiere.projects.project_object', 'premiere.projects.insertion_bin'],
        handler: () => run('Project info', script(`
const project = await __project();
const root = await __root(project);
const active = await project.getActiveSequence();
const sequences = await project.getSequences();
let insertionBin = null;
try { const bin = await project.getInsertionBin(); insertionBin = bin ? bin.name : null; } catch (e) {}
return {
  name: project.name, path: project.path, guid: __id(project.guid),
  activeSequence: active ? { name: active.name, guid: __id(active.guid) } : null,
  sequences: sequences.length, rootItems: (root.children || []).length, insertionBin: insertionBin,
};`)),
    },
    {
        name: 'create_project',
        description: 'Create a new project file (.prproj) and make it the active project: empty, or a copy of a template project (its bins, sequences and settings; the template file is not changed). Other open projects stay open',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the new .prproj' },
                template: { type: 'string', description: 'Absolute path of a .prproj to start from (a project template). Default: an empty project' },
            },
            required: ['filePath'],
        },
        auditArgs: { filePath: path.join(docs, 'audit.prproj'), template: undefined },
        features: ['premiere.projects.new_project', 'premiere.projects.project_templates'],
        handler: (a) => {
            const file = checkedPath(a.filePath, 'filePath', ['.prproj']);
            if (existsSync(file)) throw new Error(`${file} already exists: open it with open_project, or choose another name`);
            if (a.template !== undefined) {
                const template = checkedPath(a.template, 'template', ['.prproj']);
                if (!existsSync(template)) throw new Error(`The template ${template} does not exist`);
                return run('Create project from template', script(`
const options = new ppro.OpenProjectOptions();
options.setShowConvertProjectDialog(false);
options.setShowLocateFileDialog(false);
options.setShowWarningDialog(false);
options.setAddToMRUList(false);
const project = await ppro.Project.open(${str(template)}, options);
if (!project) throw new Error("Premiere Pro did not open the template " + ${str(template)});
if (!(await project.saveAs(${str(file)}))) throw new Error("Premiere Pro opened the template but did not save it as " + ${str(file)});
return { name: project.name, path: project.path, guid: __id(project.guid), template: ${str(template)} };`));
            }
            return run('Create project', script(`
const project = await ppro.Project.createProject(${str(file)});
if (!project) throw new Error("Premiere Pro did not create the project");
return { name: project.name, path: project.path, guid: __id(project.guid) };`));
        },
    },
    {
        name: 'open_project',
        description: 'Open a project file (.prproj) and make it the active project, with Premiere Pro\'s convert, locate-file and warning dialogs turned off unless showDialogs is true. Projects already open stay open',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the .prproj' },
                showDialogs: { type: 'boolean', description: 'Let Premiere Pro show its convert, locate-file and warning dialogs (they wait for the user). Default false', default: false },
                addToRecent: { type: 'boolean', description: 'Add the project to File > Open Recent. Default true', default: true },
            },
            required: ['filePath'],
        },
        auditArgs: { filePath: path.join(docs, 'audit.prproj') },
        features: ['premiere.projects.open_project', 'premiere.projects.multiple_open_projects', 'premiere.projects.where_is_the_file'],
        handler: (a) => {
            const file = checkedPath(a.filePath, 'filePath', ['.prproj']);
            const dialogs = bool(a.showDialogs === true);
            return run('Open project', script(`
const options = new ppro.OpenProjectOptions();
options.setShowConvertProjectDialog(${dialogs});
options.setShowLocateFileDialog(${dialogs});
options.setShowWarningDialog(${dialogs});
options.setAddToMRUList(${bool(a.addToRecent !== false)});
const project = await ppro.Project.open(${str(file)}, options);
if (!project) throw new Error("Premiere Pro did not open " + ${str(file)});
return { name: project.name, path: project.path, guid: __id(project.guid) };`));
        },
    },
    {
        name: 'save_project',
        description: 'Save the active project, or save it as a new .prproj (File > Save As: the project then refers to the new file, not the original)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Save As to this absolute .prproj path. Omit to save in place' },
                overwrite: { type: 'boolean', description: 'Replace filePath if it exists. Default false', default: false },
            },
        },
        auditArgs: { filePath: path.join(docs, 'audit-copy.prproj'), overwrite: true },
        hints: { idempotent: true },
        features: ['premiere.projects.save', 'premiere.projects.save_as'],
        handler: (a) => {
            const file = a.filePath === undefined ? null : checkedPath(a.filePath, 'filePath', ['.prproj']);
            if (file && existsSync(file) && a.overwrite !== true) throw new Error(`${file} exists: pass overwrite: true to replace it`);
            return run('Save project', script(`
const project = await __project();
const ok = ${file ? `await project.saveAs(${str(file)})` : 'await project.save()'};
if (!ok) throw new Error("Premiere Pro did not save the project");
return { saved: true, name: project.name, path: project.path };`));
        },
    },
    {
        name: 'close_project',
        description: 'Close the active project, or every open project (File > Close All Projects), without prompting. Unsaved changes are lost unless save is true',
        inputSchema: {
            type: 'object',
            properties: {
                save: { type: 'boolean', description: 'Save before closing. Default false', default: false },
                all: { type: 'boolean', description: 'Close every open project, not only the active one. Default false', default: false },
            },
        },
        hints: { destructive: true },
        features: ['premiere.projects.close_project', 'premiere.projects.close_all_projects'],
        handler: (a) => (a.all === true ? run('Close all projects', script(`
const ids = (await ppro.ProjectUtils.getProjectViewIds()) || [];
const seen = new Set();
const projects = [];
for (const id of ids) {
  const p = await ppro.ProjectUtils.getProjectFromViewId(id);
  if (p && !seen.has(__id(p.guid))) { seen.add(__id(p.guid)); projects.push(p); }
}
if (!projects.length) projects.push(await __project());
const closed = [];
for (const project of projects) {
  const name = project.name, file = project.path;
  ${a.save ? 'if (!(await project.save())) throw new Error("Premiere Pro did not save " + name + ", so it and the projects after it were left open (closed so far: " + closed.length + ")");' : ''}
  const options = new ppro.CloseProjectOptions();
  options.setPromptIfDirty(false);
  options.setShowCancelButton(false);
  options.setIsAppBeingPreparedToQuit(false);
  options.setSaveWorkspace(true);
  if (!(await project.close(options))) throw new Error("Premiere Pro did not close " + name + " (closed so far: " + closed.length + ")");
  closed.push({ name: name, path: file });
}
return { closed: closed, saved: ${bool(a.save)} };`)) : run('Close project', script(`
const project = await __project();
const name = project.name, file = project.path;
${a.save ? 'if (!(await project.save())) throw new Error("Premiere Pro did not save the project, so it was left open");' : ''}
const options = new ppro.CloseProjectOptions();
options.setPromptIfDirty(false);
options.setShowCancelButton(false);
options.setIsAppBeingPreparedToQuit(false);
options.setSaveWorkspace(true);
const ok = await project.close(options);
if (!ok) throw new Error("Premiere Pro did not close the project");
return { closed: name, path: file, saved: ${bool(a.save)} };`))),
    },
    {
        name: 'revert_project',
        description: 'Discard the active project\'s unsaved changes by reopening its last saved version (File > Revert), with Premiere Pro\'s dialogs off',
        inputSchema: { type: 'object', properties: {} },
        hints: { destructive: true },
        features: ['premiere.projects.revert'],
        handler: () => run('Revert project', script(`
const project = await __project();
const name = project.name, file = project.path;
if (!file) throw new Error("The project has not been saved, so there is no saved version to revert to");
const close = new ppro.CloseProjectOptions();
close.setPromptIfDirty(false);
close.setShowCancelButton(false);
close.setIsAppBeingPreparedToQuit(false);
close.setSaveWorkspace(true);
if (!(await project.close(close))) throw new Error("Premiere Pro did not close " + name);
const options = new ppro.OpenProjectOptions();
options.setShowConvertProjectDialog(false);
options.setShowLocateFileDialog(false);
options.setShowWarningDialog(false);
options.setAddToMRUList(false);
const reopened = await ppro.Project.open(file, options);
if (!reopened) throw new Error("Premiere Pro closed " + name + " but did not reopen " + file + ": open it with open_project");
return { reverted: reopened.name, path: reopened.path, guid: __id(reopened.guid) };`)),
    },
    {
        name: 'list_project_items',
        description: 'List the items in the project or in one bin, with their id, kind (bin, clip, sequence), bin path and type. Ids and paths are what other tools take',
        inputSchema: {
            type: 'object',
            properties: {
                bin: { ...ITEM_SCHEMA, description: 'List inside this bin. Default: the project root' },
                depth: { type: 'integer', minimum: 1, maximum: 100, description: 'How many bin levels to descend. Default 10', default: 10 },
                kind: { type: 'string', enum: ['bin', 'clip', 'sequence'], description: 'Only items of this kind' },
                selected: { type: 'boolean', description: 'List the items selected in the Project panel instead', default: false },
                limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'At most this many items. Default 500', default: 500 },
            },
        },
        auditArgs: { bin: { path: 'Footage' }, kind: 'clip', selected: false },
        hints: { readOnly: true },
        features: ['premiere.projects.project_item', 'premiere.projects.bin', 'premiere.projects.project_selection', 'premiere.projects.project_panel'],
        handler: (a) => {
            const depth = index(a.depth ?? 10, { name: 'depth', max: 100 });
            const limit = index(a.limit ?? 500, { name: 'limit', max: 5000 });
            const kind = a.kind === undefined ? 'null' : json(String(a.kind));
            return run('List project items', script(`
const project = await __project();
let entries;
${a.selected ? `const selection = await ppro.ProjectUtils.getSelection(project);
entries = [];
for (const it of (selection ? await selection.getItems() : [])) entries.push(await __entry(it, it.name));`
        : `const start = ${a.bin ? `await __bin(project, ${itemSpec(a.bin, 'bin')})` : 'null'};
entries = await __walk(project, start, ${depth});`}
const kind = ${kind};
const matching = entries.filter((e) => kind === null || e.kind === kind);
return { count: matching.length, truncated: matching.length > ${limit}, items: matching.slice(0, ${limit}).map(__itemInfo) };`));
        },
    },
    {
        name: 'search_project_items',
        description: 'Find project items (Edit > Find) by part of their name, part of their media file path, kind, or whether their media is offline, in the whole project or one bin. Returns ids and bin paths as list_project_items does, with the media path and offline state when those were searched',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Text the item name contains (any case)' },
                mediaPath: { type: 'string', description: 'Text the media file path contains (any case); only clips match' },
                kind: { type: 'string', enum: ['bin', 'clip', 'sequence'], description: 'Only items of this kind' },
                offline: { type: 'boolean', description: 'true: only clips whose media is offline; false: only online clips' },
                bin: { ...ITEM_SCHEMA, description: 'Search inside this bin. Default: the whole project' },
                limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'At most this many items. Default 500', default: 500 },
            },
        },
        auditArgs: { name: 'interview', mediaPath: 'Card A', kind: 'clip', offline: true, bin: { path: 'Footage' } },
        hints: { readOnly: true },
        features: ['premiere.projects.find_dialog'],
        handler: (a) => {
            const text = (v, n) => {
                if (v === undefined) return 'null';
                if (typeof v !== 'string' || !v.trim()) throw new Error(`'${n}' is empty`);
                return json(v.toLowerCase());
            };
            const name = text(a.name, 'name');
            const media = text(a.mediaPath, 'mediaPath');
            const kind = a.kind === undefined ? 'null' : json(enumOf(a.kind, ['bin', 'clip', 'sequence'], { name: 'kind' }));
            const offline = a.offline === undefined ? 'null' : bool(a.offline);
            if ([name, media, kind, offline].every((v) => v === 'null')) throw new Error('Give name, mediaPath, kind or offline to search for (list_project_items lists everything)');
            const limit = index(a.limit ?? 500, { name: 'limit', max: 5000 });
            return run('Search project items', script(`
const project = await __project();
const start = ${a.bin ? `await __bin(project, ${itemSpec(a.bin, 'bin')})` : 'null'};
const entries = await __walk(project, start, 100);
const name = ${name}, media = ${media}, kind = ${kind}, offline = ${offline};
const hits = [];
for (const e of entries) {
  if (kind !== null && e.kind !== kind) continue;
  if (name !== null && !String(e.name).toLowerCase().includes(name)) continue;
  if (media === null && offline === null) { hits.push(__itemInfo(e)); continue; }
  if (!e.clip || e.kind !== "clip") continue;
  let file = null, off = null;
  try { file = await e.clip.getMediaFilePath(); } catch (x) {}
  try { off = await e.clip.isOffline(); } catch (x) {}
  if (media !== null && !(file && String(file).toLowerCase().includes(media))) continue;
  if (offline !== null && off !== offline) continue;
  hits.push({ ...__itemInfo(e), mediaPath: file, offline: off });
}
return { count: hits.length, truncated: hits.length > ${limit}, items: hits.slice(0, ${limit}) };`));
        },
    },
    {
        name: 'get_clip_info',
        description: 'Describe a clip or sequence project item: media file path, source in and out points, offline and proxy state, label colour, and footage interpretation (frame rate, pixel aspect ratio, field order, alpha)',
        inputSchema: { type: 'object', properties: { item: ITEM_SCHEMA }, required: ['item'] },
        auditArgs: { item: { path: 'Footage/a.mov' } },
        hints: { readOnly: true },
        features: ['premiere.projects.project_item', 'premiere.media_import.interpret_footage', 'premiere.media_import.offline_clip', 'premiere.media_import.attach_proxies'],
        handler: (a) => run('Clip info', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
const info = __itemInfo(entry);
const read = async (key, fn) => { try { info[key] = await fn(); } catch (e) { info[key] = null; } };
await read("mediaPath", () => clip.getMediaFilePath());
await read("inPoint", async () => __s(await clip.getInPoint(__C.MediaType.ANY)));
await read("outPoint", async () => __s(await clip.getOutPoint(__C.MediaType.ANY)));
await read("offline", () => clip.isOffline());
await read("multicam", () => clip.isMulticamClip());
await read("merged", () => clip.isMergedClip());
await read("hasProxy", () => clip.hasProxy());
await read("proxyPath", () => clip.getProxyPath());
await read("labelColor", () => clip.getColorLabelIndex());
await read("interpretation", async () => {
  const fi = await clip.getFootageInterpretation();
  if (!fi) return null;
  return {
    frameRate: fi.getFrameRate(), pixelAspectRatio: fi.getPixelAspectRatio(), fieldType: fi.getFieldType(),
    alphaUsage: fi.getAlphaUsage(), ignoreAlpha: fi.getIgnoreAlpha(), invertAlpha: fi.getInvertAlpha(), removePulldown: fi.getRemovePullDown(),
  };
});
return info;`)),
    },
    {
        name: 'import_media',
        description: 'Import files into the project (File > Import, or Import from Media Browser by path) without Premiere Pro\'s dialogs, into the root or a bin: video (QuickTime, MP4, HEVC, ProRes, MXF, DNxHD, AVCHD, camera raw such as R3D, ARRIRAW, BRAW), audio (WAV, AIFF, MP3, AAC), stills and layered files (PSD, AI, JPEG, PNG, TIFF, EXR, DPX ...), projects (Premiere Pro, Premiere Elements, Character Animator) and interchange files (AAF, EDL, FCP XML, batch lists). Image sequences import as one clip with numberedStills. Layered files import merged',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 500, description: 'Absolute paths' },
                bin: { ...ITEM_SCHEMA, description: 'Import into this bin. Default: the project root' },
                numberedStills: { type: 'boolean', description: 'Treat numbered still images as one image sequence. Default false', default: false },
            },
            required: ['files'],
        },
        auditArgs: { files: [path.join(docs, 'a.mov'), path.join(docs, 'b.wav')], bin: { path: 'Footage' } },
        features: ['premiere.projects.insertion_bin', ...IMPORT_FEATURES],
        handler: (a) => {
            if (!Array.isArray(a.files) || !a.files.length) throw new Error("'files' must list at least one path");
            const files = a.files.map((f, i) => checkedPath(f, `files[${i}]`));
            return run('Import media', script(`
const project = await __project();
const target = await __bin(project, ${a.bin ? itemSpec(a.bin, 'bin') : 'null'});
const before = new Set((target.children || []).map((c) => c.getId()));
const ok = await project.importFiles(${json(files)}, true, target.item, ${bool(a.numberedStills)});
if (!ok) throw new Error("Premiere Pro did not import the files (check that they exist and are a supported format)");
const after = await __entry(target.item, target.path);
const added = (after.children || []).filter((c) => !before.has(c.getId())).map((c) => ({ name: c.name, id: c.getId() }));
return { imported: added.length, bin: target.path || "(root)", items: added };`));
        },
    },
    {
        name: 'create_bin',
        description: 'Add a bin, or a search bin (File > New > Search Bin) that shows the items matching searchQuery, to the project root or inside another bin',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Bin name' },
                parent: { ...ITEM_SCHEMA, description: 'Create inside this bin. Default: the project root' },
                makeUnique: { type: 'boolean', description: 'If the name is taken, let Premiere Pro make it unique. Default true', default: true },
                searchQuery: { type: 'string', description: 'Make a search bin showing the items that match this text' },
            },
            required: ['name'],
        },
        auditArgs: { parent: { path: 'Footage' } },
        features: ['premiere.projects.new_bin', 'premiere.projects.bin', 'premiere.projects.search_bin'],
        handler: (a) => {
            if (typeof a.name !== 'string' || !a.name.trim()) throw new Error("'name' is empty");
            if (a.searchQuery !== undefined && (typeof a.searchQuery !== 'string' || !a.searchQuery.trim())) throw new Error("'searchQuery' is empty");
            const make = a.searchQuery !== undefined
                ? `transact(project, "Create search bin", (add) => add(parent.bin.createSmartBinAction(${str(a.name)}, ${str(a.searchQuery)})));`
                : `transact(project, "Create bin", (add) => add(parent.bin.createBinAction(${str(a.name)}, ${bool(a.makeUnique !== false)})));`;
            return run('Create bin', script(`
const project = await __project();
const parent = await __bin(project, ${a.parent ? itemSpec(a.parent, 'parent') : 'null'});
const before = new Set((parent.children || []).map((c) => c.getId()));
${make}
const after = await __entry(parent.item, parent.path);
const made = (after.children || []).filter((c) => !before.has(c.getId()));
return { created: made.map((c) => ({ name: c.name, id: c.getId() })), parent: parent.path || "(root)" };`));
        },
    },
    {
        name: 'manage_items',
        description: 'Rename, move to another bin, set the label colour of, or delete project items (bins, clips, sequences). Changes are one undo step',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: ITEM_SCHEMA, maxItems: 500, description: 'The items' },
                selected: { type: 'boolean', description: 'Also act on the items selected in the Project panel', default: false },
                rename: { type: 'string', description: 'New name (one item only)' },
                moveTo: { ...ITEM_SCHEMA, description: 'Move into this bin (moveToRoot for the project root)' },
                moveToRoot: { type: 'boolean', description: 'Move to the project root', default: false },
                label: { type: 'integer', minimum: 0, maximum: 15, description: 'Label colour by index, 0-15, as in Edit > Label' },
                delete: { type: 'boolean', description: 'Remove the items from the project. Default false', default: false },
            },
        },
        auditArgs: { items: [{ path: 'Footage/a.mov' }], rename: 'Interview', moveTo: { path: 'Selects' }, moveToRoot: false, label: 3, delete: false },
        hints: { destructive: true },
        features: ['premiere.projects.rename_item', 'premiere.projects.move_item_to_bin', 'premiere.projects.label_colors', 'premiere.projects.delete_bin', 'premiere.projects.delete_items'],
        handler: (a) => {
            const del = a.delete === true;
            const changes = a.rename !== undefined || a.moveTo !== undefined || a.moveToRoot === true || a.label !== undefined;
            if (del && changes) throw new Error('delete cannot be combined with other changes');
            if (!del && !changes) throw new Error('Nothing to do: give rename, moveTo, moveToRoot, label or delete');
            if (a.moveTo !== undefined && a.moveToRoot === true) throw new Error('Give moveTo or moveToRoot, not both');
            const count = (a.items?.length ?? 0) + (a.selected ? 1 : 0);
            if (a.rename !== undefined && (count !== 1 || a.selected)) throw new Error('Rename one item at a time, given in items');
            const label = a.label === undefined ? null : index(a.label, { name: 'label', max: 15 });
            return run('Manage items', script(`
const project = await __project();
const entries = await __items(project, ${itemSpecs(a.items)}, ${bool(a.selected)});
${a.moveTo !== undefined ? `const target = await __bin(project, ${itemSpec(a.moveTo, 'moveTo')});` : a.moveToRoot ? 'const target = await __root(project);' : ''}
const done = entries.map(__itemInfo);
transact(project, "Manage items", (add) => {
  for (const e of entries) {
    ${del ? 'add(e.item.getParentBin().createRemoveItemAction(e.item));' : ''}
    ${a.rename !== undefined ? `add(e.item.createSetNameAction(${str(a.rename)}));` : ''}
    ${label !== null ? `add(e.item.createSetColorLabelAction(${label}));` : ''}
    ${a.moveTo !== undefined || a.moveToRoot ? 'add(e.item.getParentBin().createMoveItemAction(e.item, target.bin));' : ''}
  }
});
return { ${del ? 'deleted' : 'changed'}: done };`));
        },
    },
];
