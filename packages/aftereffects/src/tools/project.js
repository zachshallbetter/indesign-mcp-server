/**
 * Projects and the Project panel: describe, list, find, select and comment
 * items, import footage, make folders, save, save copies, open, close, revert,
 * project settings, missing dependencies, fonts, XMP metadata, and tidy up.
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
        description: 'Import files into the project (File > Import): footage, image sequences, layered Photoshop or Illustrator files as footage or compositions, another After Effects or Premiere Pro project, and data files (JSON, mgJSON, CSV, TSV), optionally into a folder',
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
            'aftereffects.audio.format_mp2',
            'aftereffects.audio.format_aac',
            'aftereffects.audio.format_aiff',
            'aftereffects.audio.format_mp3',
            'aftereffects.audio.format_wav',
            'aftereffects.audio.format_asnd',
            'aftereffects.footage.import_adobe_premiere_project',
            // Every other format After Effects imports through ImportOptions.
            'aftereffects.footage.format_pdf',
            'aftereffects.footage.format_bmp',
            'aftereffects.footage.format_camera_raw',
            'aftereffects.footage.format_cineon_dpx',
            'aftereffects.footage.format_gif',
            'aftereffects.footage.format_rla_rpf',
            'aftereffects.footage.format_electricimage',
            'aftereffects.footage.format_eps',
            'aftereffects.footage.format_iff',
            'aftereffects.footage.format_jpeg',
            'aftereffects.footage.format_heif',
            'aftereffects.footage.format_maya_ma',
            'aftereffects.footage.format_openexr',
            'aftereffects.footage.format_pcx',
            'aftereffects.footage.format_png',
            'aftereffects.footage.format_radiance',
            'aftereffects.footage.format_sgi',
            'aftereffects.footage.format_softimage_pic',
            'aftereffects.footage.format_targa',
            'aftereffects.footage.format_tiff',
            'aftereffects.footage.format_svg',
            'aftereffects.footage.format_vpe',
            'aftereffects.footage.format_panasonic_p2',
            'aftereffects.footage.format_red_r3d',
            'aftereffects.footage.format_sony_xocn',
            'aftereffects.footage.format_canon_cinema_raw_light',
            'aftereffects.footage.format_arriraw',
            'aftereffects.footage.format_hevc',
            'aftereffects.footage.format_3gpp',
            'aftereffects.footage.format_swf',
            'aftereffects.footage.format_flv_f4v',
            'aftereffects.footage.format_animated_gif',
            'aftereffects.footage.format_prores',
            'aftereffects.footage.format_avchd',
            'aftereffects.footage.format_dv',
            'aftereffects.footage.format_h264',
            'aftereffects.footage.format_mxf',
            'aftereffects.footage.format_mpeg1',
            'aftereffects.footage.format_mpeg2',
            'aftereffects.footage.format_mpeg4',
            'aftereffects.footage.format_omf',
            'aftereffects.footage.format_quicktime',
            'aftereffects.footage.format_avi',
            'aftereffects.footage.format_windows_media',
            'aftereffects.footage.format_xdcam',
            'aftereffects.footage.format_cinemadng',
            'aftereffects.footage.format_dnxhd_dnxhr',
            'aftereffects.footage.format_gopro_cineform',
            'aftereffects.footage.format_fla',
            'aftereffects.footage.format_aaf',
            'aftereffects.footage.format_prproj',
            'aftereffects.footage.format_json',
            'aftereffects.footage.format_mgjson',
            'aftereffects.footage.format_jsx',
            'aftereffects.footage.format_csv',
            'aftereffects.footage.format_tsv',
            'aftereffects.footage.format_bvh',
            'aftereffects.footage.format_c4d',
            'aftereffects.footage.format_xml',
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
        description: 'Open an .aep project, an .aet template (which opens as an untitled copy) or a .mogrt Motion Graphics template as a project, or start a new empty one. Unsaved changes in the current project are discarded, so save first',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .aep, .aepx, .aet or .mogrt path. Omit for a new project' } } },
        hints: { destructive: true },
        features: ['aftereffects.projects.open_project', 'aftereffects.projects.new_project', 'aftereffects.projects.aep_format', 'aftereffects.projects.project_templates', 'aftereffects.essential_graphics.open_mogrt_as_project'],
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
    {
        name: 'save_project_copy',
        description: 'Save a copy of the project while it keeps its own file (File > Save As > Save a Copy), or a copy in the text-based XML format (Save a Copy As XML, .aepx). The project must have been saved; saveFirst saves it in place first',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the copy: .aep, or .aepx for XML' },
                saveFirst: { type: 'boolean', description: 'Save unsaved changes in place first, so the copy includes them. Default false', default: false },
            },
            required: ['filePath'],
        },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit copy.aepx` },
        hints: { destructive: true, idempotent: true },
        features: ['aftereffects.projects.save_a_copy', 'aftereffects.projects.save_copy_as_xml', 'aftereffects.projects.aepx_format'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            const ext = path.extname(p).toLowerCase();
            if (ext !== '.aep' && ext !== '.aepx') throw new Error('filePath must end in .aep or .aepx');
            return run('Save a copy', script(`
if (!proj.file) throw new Error("The project has never been saved: save it with save_project first");
${a.saveFirst ? 'if (proj.dirty) proj.save();' : 'if (proj.dirty) throw new Error("The project has unsaved changes: save it first, or pass saveFirst: true");'}
var original = proj.file, target = new File(${jsxPath(p)});
if (target.fsName === original.fsName) throw new Error("The copy must be a different file from the project");
${ext === '.aep' ? 'if (!original.copy(target.fsName)) throw new Error("Could not write " + target.fsName);' : `proj.save(target);
proj.save(original);`}
__result__ = { copy: target.fsName, format: ${str(ext === '.aep' ? 'aep' : 'aepx')}, project: proj.file.fsName };`));
        },
    },
    {
        name: 'run_project_command',
        description: 'Project file commands: close the project (File > Close Project), revert to the last saved version (File > Revert), open the most recent project (File > Open Recent), or save a numbered copy and continue in it (File > Increment and Save). Close, revert and open_most_recent can lose unsaved work',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: ['close', 'revert', 'open_most_recent', 'increment_and_save'], description: 'The command' },
                unsaved: { type: 'string', enum: ['save', 'discard'], description: 'close, open_most_recent: what to do with unsaved changes. Required when there are any' },
            },
            required: ['command'],
        },
        auditArgs: { command: 'close', unsaved: 'discard' },
        hints: { destructive: true },
        features: [
            'aftereffects.projects.close_project',
            'aftereffects.projects.revert',
            'aftereffects.projects.open_most_recent_project',
            'aftereffects.projects.increment_and_save',
        ],
        handler: (a) => {
            const command = enumOf(a.command, ['close', 'revert', 'open_most_recent', 'increment_and_save'], { name: 'command' });
            const unsaved = a.unsaved !== undefined ? enumOf(a.unsaved, ['save', 'discard'], { name: 'unsaved' }) : null;
            if (unsaved && (command === 'revert' || command === 'increment_and_save')) throw new Error(`'unsaved' does not apply to ${command}`);
            const settle = `if (proj.dirty) {
  ${unsaved === null ? 'throw new Error("The project has unsaved changes: pass unsaved: save or discard");' : ''}
  ${unsaved === 'save' ? 'if (!proj.file) throw new Error("The project has never been saved: save it with save_project first");' : ''}
}`;
            const bodies = {
                close: `${settle}
var closed = proj.file ? proj.file.fsName : null;
proj.close(${unsaved === 'save' ? 'CloseOptions.SAVE_CHANGES' : 'CloseOptions.DO_NOT_SAVE_CHANGES'});
__result__ = { closed: closed };`,
                revert: `if (!proj.file) throw new Error("The project has never been saved, so there is nothing to revert to");
var f = proj.file;
proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);
var reopened = app.open(f);
__result__ = { reverted: f.fsName, items: reopened.numItems };`,
                open_most_recent: `${settle}
if (proj.dirty) ${unsaved === 'save' ? 'proj.save();' : 'proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);'}
app.executeCommand(2330);
__result__ = { file: app.project.file ? app.project.file.fsName : null, items: app.project.numItems };`,
                increment_and_save: `if (!proj.file) throw new Error("The project has never been saved: save it with save_project first");
var previous = proj.file.fsName;
app.executeCommand(3088);
__result__ = { previous: previous, saved: app.project.file ? app.project.file.fsName : null };`,
            };
            return run('Project command', script(bodies[command]));
        },
    },
    {
        name: 'set_project_settings',
        description: 'Read or change project settings (File > Project Settings): time display style (timecode or frames), footage start time, feet + frames and film type, frame count start, colour depth, expression engine, and the transparency grid in Project panel thumbnails. With no changes it returns the current settings',
        inputSchema: {
            type: 'object',
            properties: {
                timeDisplay: { type: 'string', enum: ['timecode', 'frames'], description: 'Time Display Style' },
                footageStart: { type: 'string', enum: ['source', 'zero'], description: 'Timecode: Footage Start Time from the source media or 00:00:00:00' },
                feetAndFrames: { type: 'boolean', description: 'Frames: Use Feet + Frames' },
                filmType: { type: 'string', enum: ['16mm', '35mm'], description: 'Feet + Frames film' },
                frameCount: { type: 'string', enum: ['timecode_conversion', 'start_at_0', 'start_at_1'], description: 'Frames: Frame Count' },
                bitsPerChannel: { type: 'integer', enum: [8, 16, 32], description: 'Colour depth in bits per channel' },
                expressionEngine: { type: 'string', enum: ['javascript', 'extendscript'], description: 'Expressions engine' },
                transparencyGridThumbnails: { type: 'boolean', description: 'Thumbnail Transparency Grid in the Project panel' },
            },
        },
        auditArgs: { timeDisplay: 'frames', frameCount: 'start_at_1', filmType: '35mm', expressionEngine: 'javascript' },
        hints: { idempotent: true },
        features: [
            'aftereffects.projects.project_settings_dialog',
            'aftereffects.projects.time_display_style',
            'aftereffects.projects.footage_start_time',
            'aftereffects.projects.feet_frames',
            'aftereffects.projects.frame_count',
            'aftereffects.projects.project_thumbnails',
        ],
        handler: (a) => {
            const set = [];
            if (a.timeDisplay !== undefined) set.push(`proj.timeDisplayType = TimeDisplayType.${enumOf(a.timeDisplay, ['timecode', 'frames'], { name: 'timeDisplay' }).toUpperCase()};`);
            if (a.footageStart !== undefined) set.push(`proj.footageTimecodeDisplayStartType = FootageTimecodeDisplayStartType.${{ source: 'FTCS_USE_SOURCE_MEDIA', zero: 'FTCS_START_0' }[enumOf(a.footageStart, ['source', 'zero'], { name: 'footageStart' })]};`);
            if (a.feetAndFrames !== undefined) set.push(`proj.framesUseFeetFrames = ${bool(a.feetAndFrames)};`);
            if (a.filmType !== undefined) set.push(`proj.feetFramesFilmType = FeetFramesFilmType.${{ '16mm': 'MM16', '35mm': 'MM35' }[enumOf(a.filmType, ['16mm', '35mm'], { name: 'filmType' })]};`);
            if (a.frameCount !== undefined) set.push(`proj.framesCountType = FramesCountType.${{ timecode_conversion: 'FC_TIMECODE_CONVERSION', start_at_0: 'FC_START_0', start_at_1: 'FC_START_1' }[enumOf(a.frameCount, ['timecode_conversion', 'start_at_0', 'start_at_1'], { name: 'frameCount' })]};`);
            if (a.bitsPerChannel !== undefined) set.push(`proj.bitsPerChannel = ${enumOf(a.bitsPerChannel, ['8', '16', '32'], { name: 'bitsPerChannel' })};`);
            if (a.expressionEngine !== undefined) set.push(`proj.expressionEngine = ${str({ javascript: 'javascript-1.0', extendscript: 'extendscript' }[enumOf(a.expressionEngine, ['javascript', 'extendscript'], { name: 'expressionEngine' })])};`);
            if (a.transparencyGridThumbnails !== undefined) set.push(`proj.transparencyGridThumbnails = ${bool(a.transparencyGridThumbnails)};`);
            return run('Project settings', script(`${set.join('\n')}
__result__ = { timeDisplay: __enumName(proj.timeDisplayType), footageStart: __enumName(proj.footageTimecodeDisplayStartType), feetAndFrames: proj.framesUseFeetFrames,
  filmType: __enumName(proj.feetFramesFilmType), frameCount: __enumName(proj.framesCountType), displayStartFrame: proj.displayStartFrame,
  bitsPerChannel: proj.bitsPerChannel, expressionEngine: proj.expressionEngine, transparencyGridThumbnails: proj.transparencyGridThumbnails };`, set.length ? { undo: 'Project settings' } : {}));
        },
    },
    {
        name: 'find_project_items',
        description: 'Search the project like the Project panel search field (File > Find): items whose name or comment contains text, and items that are missing, unused or used, optionally of one type',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to find in names and comments (case-insensitive)' },
                status: { type: 'string', enum: ['missing', 'unused', 'used'], description: 'missing: footage whose file cannot be found; unused or used in any composition' },
                type: { type: 'string', enum: ['composition', 'footage', 'folder'], description: 'Only this type' },
            },
        },
        hints: { readOnly: true },
        features: ['aftereffects.projects.find_in_project_panel'],
        handler: (a) => {
            const status = a.status !== undefined ? enumOf(a.status, ['missing', 'unused', 'used'], { name: 'status' }) : null;
            const type = a.type !== undefined ? enumOf(a.type, ['composition', 'footage', 'folder'], { name: 'type' }) : null;
            if (a.text === undefined && !status && !type) throw new Error('Pass text, status or type');
            return run('Find items', script(`
var text = ${a.text !== undefined ? str(String(a.text).toLowerCase()) : 'null'}, status = ${status ? str(status) : 'null'}, type = ${type ? str(type) : 'null'}, out = [];
for (var i = 1; i <= proj.numItems; i++) {
  var it = proj.item(i);
  if (type && __itemType(it) !== type) continue;
  if (text !== null && it.name.toLowerCase().indexOf(text) < 0 && it.comment.toLowerCase().indexOf(text) < 0) continue;
  if (status === "missing" && !(it instanceof FootageItem && it.footageMissing)) continue;
  if (status === "unused" && !(it instanceof AVItem && it.usedIn.length === 0)) continue;
  if (status === "used" && !(it instanceof AVItem && it.usedIn.length > 0)) continue;
  var info = __itemInfo(it);
  info.comment = it.comment;
  out.push(info);
}
__result__ = { count: out.length, items: out };`));
        },
    },
    {
        name: 'select_project_items',
        description: 'Select items in the Project panel: replace the selection, add to it (extend the selection), remove from it, or clear it; optionally show the Project panel. Menu commands act on this selection',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 1000, description: 'Item ids. Omit or leave empty with mode replace to clear the selection' },
                mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'Default replace', default: 'replace' },
                showPanel: { type: 'boolean', description: 'Show the Project panel. Default false', default: false },
            },
        },
        hints: { idempotent: true },
        features: ['aftereffects.projects.extend_project_selection', 'aftereffects.projects.project_panel'],
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'replace', ['replace', 'add', 'remove'], { name: 'mode' });
            const list = (a.items ?? []).map((i) => Number(index(i, { name: 'items' })));
            if (!list.length && mode !== 'replace') throw new Error(`mode ${mode} needs 'items'`);
            return run('Select items', script(`
var ids = ${json(list)};
${mode === 'replace' ? 'var sel = proj.selection; for (var s = 0; s < sel.length; s++) sel[s].selected = false;' : ''}
for (var i = 0; i < ids.length; i++) { var it = proj.itemByID(ids[i]); if (!it) throw new Error("No item " + ids[i]); it.selected = ${bool(mode !== 'remove')}; }
${a.showPanel ? 'proj.showWindow(true);' : ''}
var out = [], now = proj.selection;
for (var j = 0; j < now.length; j++) out.push({ id: now[j].id, name: now[j].name });
__result__ = { selected: out };`));
        },
    },
    {
        name: 'set_item_comment',
        description: 'Set the Comment column text of project items; an empty comment clears it',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 1000, description: 'Item ids' },
                comment: { type: 'string', description: 'Comment text' },
            },
            required: ['items', 'comment'],
        },
        hints: { idempotent: true },
        features: ['aftereffects.projects.comment_column'],
        handler: (a) => {
            if (!Array.isArray(a.items) || !a.items.length) throw new Error("'items' must list at least one id");
            if (typeof a.comment !== 'string') throw new Error("'comment' must be text");
            return run('Set comment', script(`
var ids = ${json(a.items.map((i) => Number(index(i, { name: 'items' }))))}, out = [];
for (var i = 0; i < ids.length; i++) { var it = proj.itemByID(ids[i]); if (!it) throw new Error("No item " + ids[i]); it.comment = ${str(a.comment)}; out.push({ id: it.id, name: it.name, comment: it.comment }); }
__result__ = { items: out };`, { undo: 'Set comment' }));
        },
    },
    {
        name: 'find_missing_dependencies',
        description: 'Find missing footage, effects or fonts (File > Dependencies > Find Missing Footage, Find Missing Effects, Find Missing Fonts). Footage and fonts are listed; reveal also runs the menu command, which shows them in the Project or Timeline panel. Missing effects can only be revealed',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['footage', 'effects', 'fonts'], description: 'What to look for' },
                reveal: { type: 'boolean', description: 'Run the Find Missing menu command too. Default false; always true for effects', default: false },
            },
            required: ['kind'],
        },
        hints: { idempotent: true },
        features: ['aftereffects.projects.missing_footage', 'aftereffects.projects.missing_effects'],
        handler: (a) => {
            const kind = enumOf(a.kind, ['footage', 'effects', 'fonts'], { name: 'kind' });
            const reveal = kind === 'effects' || a.reveal;
            const list = {
                footage: `var out = [];
for (var i = 1; i <= proj.numItems; i++) {
  var it = proj.item(i);
  if (it instanceof FootageItem && it.footageMissing) out.push({ id: it.id, name: it.name, missingPath: it.mainSource instanceof FileSource ? it.mainSource.missingFootagePath : null });
}
__result__ = { kind: "footage", count: out.length, items: out };`,
                fonts: `var used = proj.usedFonts, out = [];
for (var i = 0; i < used.length; i++) { var f = used[i].font; if (f.isSubstitute) out.push({ postScriptName: f.postScriptName, family: f.familyName, style: f.styleName, uses: used[i].usedAt.length }); }
__result__ = { kind: "fonts", count: out.length, fonts: out };`,
                effects: '__result__ = { kind: "effects", revealed: true };',
            }[kind];
            return run('Find missing', script(`${reveal ? `app.executeCommand(${{ footage: 4004, effects: 4002, fonts: 4003 }[kind]});` : ''}
${list}`));
        },
    },
    {
        name: 'resolve_project_fonts',
        description: 'List the fonts the project uses, marking ones that are missing and substituted (as in the Resolve Fonts dialog), or replace fonts across every text layer',
        inputSchema: {
            type: 'object',
            properties: {
                replace: {
                    type: 'array',
                    maxItems: 100,
                    description: 'Replacements to make, by PostScript name. Omit to list fonts',
                    items: {
                        type: 'object',
                        properties: { from: { type: 'string', description: 'PostScript name of the font to replace' }, to: { type: 'string', description: 'PostScript name of the font to use' } },
                        required: ['from', 'to'],
                    },
                },
            },
        },
        auditArgs: { replace: [{ from: 'Arial-BoldMT', to: 'Helvetica-Bold' }] },
        features: ['aftereffects.projects.resolve_fonts'],
        handler: (a) => {
            const pairs = (a.replace ?? []).map((r, i) => {
                if (!r || typeof r.from !== 'string' || !r.from || typeof r.to !== 'string' || !r.to) throw new Error(`replace[${i}] needs 'from' and 'to' PostScript names`);
                return { from: r.from, to: r.to };
            });
            return run('Resolve fonts', script(`
var pairs = ${json(pairs)}, replaced = [];
for (var p = 0; p < pairs.length; p++) replaced.push({ from: pairs[p].from, to: pairs[p].to, replaced: proj.replaceFont(pairs[p].from, pairs[p].to) });
var used = proj.usedFonts, fonts = [];
for (var i = 0; i < used.length; i++) { var f = used[i].font; fonts.push({ postScriptName: f.postScriptName, family: f.familyName, style: f.styleName, substitute: f.isSubstitute, uses: used[i].usedAt.length }); }
__result__ = { replaced: replaced, fonts: fonts };`, pairs.length ? { undo: 'Replace fonts' } : {}));
        },
    },
    {
        name: 'edit_project_metadata',
        description: 'Read or replace the project\'s XMP metadata (shown in the Metadata panel and in Adobe Bridge). showPanel toggles Window > Metadata',
        inputSchema: {
            type: 'object',
            properties: {
                xmp: { type: 'string', description: 'A complete XMP packet (x:xmpmeta) that replaces the project\'s. Omit to read it' },
                showPanel: { type: 'boolean', description: 'Toggle the Metadata panel. Default false', default: false },
            },
        },
        auditArgs: { xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', showPanel: true },
        hints: { destructive: true },
        features: ['aftereffects.footage.project_xmp_metadata', 'aftereffects.footage.metadata_panel'],
        handler: (a) => {
            if (a.xmp !== undefined && (typeof a.xmp !== 'string' || !/<x:xmpmeta[\s>]/.test(a.xmp))) throw new Error("'xmp' must be an XMP packet containing <x:xmpmeta>");
            return run('Project metadata', script(`
${a.xmp !== undefined ? `proj.xmpPacket = ${str(a.xmp)};` : ''}
${a.showPanel ? 'app.executeCommand(3788);' : ''}
__result__ = { xmp: proj.xmpPacket };`, a.xmp !== undefined ? { undo: 'Project metadata' } : {}));
        },
    },
];
