/**
 * Automation: the Actions panel (list, create sets, delete, load, save, reset,
 * playback options), File > Automate > Batch and Create Droplet, the
 * File > Automate and File > Scripts commands that run unattended (Crop and
 * Straighten Photos, Fit Image, Conditional Mode Change, Lens Correction,
 * Delete All Empty Layers, Flatten All Layer Effects, Flatten All Masks,
 * Load Files into Stack, Photomerge, Merge to HDR Pro, Statistics), the
 * Script Events Manager, and variable data sets.
 *
 * Actions and action sets have no DOM objects: they are read and changed with
 * the Action Manager (action set ASet, action Actn and command Cmnd
 * references, as in xtools' stdlib). Adobe's File > Automate commands are
 * scripts that register an event id and read their settings from
 * app.playbackParameters; the multi-file ones (Load Files into Stack,
 * Photomerge, Merge to HDR Pro, Statistics) are loaded from Photoshop's
 * Presets/Scripts folder with their "...FromScript" flag set and called through
 * the functions those scripts provide for other scripts.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './documents.js';

/** Action Manager helpers shared by the automation scripts. */
const AM = String.raw`
var __c = function (id) { return app.charIDToTypeID(id); };
var __s = function (id) { return app.stringIDToTypeID(id); };
var __actionSets = function (withSteps) {
  var sets = [], i = 1;
  while (true) {
    var r = new ActionReference();
    r.putIndex(__c("ASet"), i);
    var d;
    try { d = app.executeActionGet(r); } catch (e) { break; }
    var set = { index: i, name: d.getString(__c("Nm  ")), actions: [] };
    var n = d.hasKey(__c("NmbC")) ? d.getInteger(__c("NmbC")) : 0;
    for (var j = 1; j <= n; j++) {
      var ar = new ActionReference();
      ar.putIndex(__c("Actn"), j);
      ar.putIndex(__c("ASet"), i);
      var ad = app.executeActionGet(ar);
      var act = { index: j, name: ad.getString(__c("Nm  ")) };
      if (withSteps) {
        act.steps = [];
        var m = ad.hasKey(__c("NmbC")) ? ad.getInteger(__c("NmbC")) : 0;
        for (var k = 1; k <= m; k++) {
          var cr = new ActionReference();
          cr.putIndex(__c("Cmnd"), k);
          cr.putIndex(__c("Actn"), j);
          cr.putIndex(__c("ASet"), i);
          try { act.steps.push(app.executeActionGet(cr).getString(__c("Nm  "))); } catch (e) { act.steps.push(null); }
        }
      }
      set.actions.push(act);
    }
    sets.push(set);
    i++;
  }
  return sets;
};
var __actionRef = function (set, action, step) {
  var r = new ActionReference();
  if (step) r.putIndex(__c("Cmnd"), step);
  if (action !== null) r.putName(__c("Actn"), action);
  r.putName(__c("ASet"), set);
  return r;
};
`;

/** Batch and droplet file naming: BatchOptions.fileNaming members, and the Action Manager components (xtools Stdlib.batch). */
const FILE_NAMING = {
    document_name: ['DOCUMENTNAMEMIXED', null], document_name_lower: ['DOCUMENTNAMELOWER', 'lowerCase'], document_name_upper: ['DOCUMENTNAMEUPPER', 'upperCase'],
    serial_1: ['SERIALNUMBER1', 'oneDigit'], serial_2: ['SERIALNUMBER2', 'twoDigit'], serial_3: ['SERIALNUMBER3', 'threeDigit'], serial_4: ['SERIALNUMBER4', 'fourDigit'],
    serial_letter_lower: ['SERIALLETTERLOWER', 'lowerCaseSerial'], serial_letter_upper: ['SERIALLETTERUPPER', 'upperCaseSerial'],
    mmddyy: ['MMDDYY', 'mmddyy'], mmdd: ['MMDD', 'mmdd'], yyyymmdd: ['YYYYMMDD', 'yyyymmdd'], yymmdd: ['YYMMDD', 'yymmdd'], yyddmm: ['YYDDMM', 'yyddmm'],
    ddmmyy: ['DDMMYY', 'ddmmyy'], ddmm: ['DDMM', 'ddmm'], extension_lower: ['EXTENSIONLOWER', 'lowerCaseExtension'], extension_upper: ['EXTENSIONUPPER', 'upperCaseExtension'],
};
const DESTINATIONS = { none: 'NODESTINATION', save_and_close: 'SAVEANDCLOSE', folder: 'FOLDER' };

/** Batch and droplet options shared by both schemas. */
const BATCH_OPTIONS = {
    action: { type: 'string', description: 'Action name, as in the Actions panel (list_action_sets)' },
    set: { type: 'string', description: 'Action set name' },
    overrideOpen: { type: 'boolean', description: 'Override Action "Open" Commands: the action\'s own Open steps open each source file instead. Default false' },
    suppressOpenDialogs: { type: 'boolean', description: 'Suppress File Open Options Dialogs (camera raw and similar). Default true' },
    suppressProfileWarnings: { type: 'boolean', description: 'Suppress Color Profile Warnings. Default true' },
    destination: { type: 'string', enum: Object.keys(DESTINATIONS), description: 'none: leave files open, save_and_close: save over the source, folder: save into destinationFolder. Default none' },
    destinationFolder: { type: 'string', description: 'Absolute folder path, for destination folder' },
    overrideSaveAs: { type: 'boolean', description: 'Override Action "Save As" Commands: the action\'s Save As steps save into the destination instead of their recorded place. Default false' },
    fileNaming: { type: 'array', maxItems: 6, items: { type: 'string', enum: Object.keys(FILE_NAMING) }, description: 'File Naming for destination folder: up to 6 parts joined in order. Default ["document_name", "extension_lower"]' },
    startingSerial: { type: 'integer', minimum: 1, description: 'Starting serial number for serial parts. Default 1' },
    compatibility: {
        type: 'object',
        description: 'File name compatibility. Default: the current platform only',
        properties: { windows: { type: 'boolean' }, macos: { type: 'boolean' }, unix: { type: 'boolean' } },
    },
    errorLog: { type: 'string', description: 'Absolute path of a text file to log errors to (Log Errors To File). Omit to stop for errors' },
};

/** Checked batch options as plain values, shared by run_action_batch and create_droplet. */
function batchOptions(a) {
    if (typeof a.action !== 'string' || !a.action) throw new Error("'action' is required");
    if (typeof a.set !== 'string' || !a.set) throw new Error("'set' is required");
    const destination = enumOf(a.destination ?? 'none', Object.keys(DESTINATIONS), { name: 'destination' });
    if (destination === 'folder' && !a.destinationFolder) throw new Error("destination folder needs 'destinationFolder'");
    if (destination !== 'folder' && a.destinationFolder) throw new Error("'destinationFolder' applies to destination folder");
    if (destination === 'none' && a.overrideSaveAs) throw new Error("'overrideSaveAs' needs a destination");
    if (a.fileNaming !== undefined && destination !== 'folder') throw new Error("'fileNaming' applies to destination folder");
    const naming = a.fileNaming ?? ['document_name', 'extension_lower'];
    if (!Array.isArray(naming) || !naming.length || naming.length > 6) throw new Error("'fileNaming' takes 1 to 6 parts");
    naming.forEach((n) => enumOf(n, Object.keys(FILE_NAMING), { name: 'fileNaming' }));
    const c = a.compatibility ?? {};
    return {
        action: a.action, set: a.set, destination, naming,
        folder: destination === 'folder' ? paths.validate(a.destinationFolder) : null,
        errorLog: a.errorLog ? paths.validate(a.errorLog) : null,
        serial: index(a.startingSerial ?? 1, { name: 'startingSerial', max: 1e6 }),
        windows: c.windows ?? process.platform === 'win32', macos: c.macos ?? process.platform === 'darwin', unix: c.unix ?? false,
    };
}

/** Folder-source file collection for app.batch: optional subfolders and extensions. */
const COLLECT = String.raw`
var __collect = function (folder, deep, exts, out) {
  var items = folder.getFiles();
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it instanceof Folder) { if (deep) __collect(it, deep, exts, out); continue; }
    if (it.name.charAt(0) === ".") continue;
    if (exts.length) {
      var dot = it.name.lastIndexOf("."), ext = dot < 0 ? "" : it.name.substring(dot + 1).toLowerCase(), ok = false;
      for (var j = 0; j < exts.length; j++) if (exts[j] === ext) ok = true;
      if (!ok) continue;
    }
    out.push(it);
  }
  return out;
};`;

/** Automate and Scripts commands run on the active document. */
const COMMANDS = ['crop_and_straighten', 'fit_image', 'conditional_mode_change', 'lens_correction', 'delete_empty_layers', 'flatten_layer_effects', 'flatten_masks'];
const SOURCE_MODES = { bitmap: 'UBtm', grayscale: 'UGry', duotone: 'UDtn', indexed: 'UInd', rgb: 'URGB', cmyk: 'UCMY', lab: 'ULab', multichannel: 'UMlt' };
const TARGET_MODES = { grayscale: 'Grys', rgb: 'RGBM', cmyk: 'CMYM', lab: 'LbCM', multichannel: 'MltC' };
const LENS_EDGES = { extension: 1, transparency: 2, black: 3, white: 4 };
/** Event ids of Adobe's File > Scripts commands (declared in each script's header). */
const SCRIPT_EVENTS = {
    delete_empty_layers: 'a0754df2-9c60-4b64-a940-6a2bb1102652',
    flatten_layer_effects: '8a761c74-f362-4a1b-a3f7-e779ab319a08',
    flatten_masks: 'e805a6ee-6d75-4b62-b6fe-f5873b5fdf20',
};

/** Adobe's multi-file scripts: file, the flag that stops their dialog, the object they define. */
const COMBINE = {
    stack: { file: 'Load Files into Stack.jsx', flag: 'loadLayersFromScript', api: 'loadLayers' },
    photomerge: { file: 'Photomerge.jsx', flag: 'runphotomergeFromScript', api: 'photomerge' },
    hdr: { file: 'Merge To HDR.jsx', flag: 'runMergeToHDRFromScript', api: 'mergeToHDR' },
    statistics: { file: 'Statistics.jsx', flag: 'runStatisticsFromScript', api: 'imageStats' },
};
const LAYOUTS = { auto: 'Auto', perspective: 'Prsp', cylindrical: 'cylindrical', spherical: 'spherical', collage: 'sceneCollage', reposition: 'translation' };
const STATISTICS = {
    mean: ['avrg', 'Mean'], median: ['medn', 'Median'], minimum: ['minn', 'Minimum'], maximum: ['maxx', 'Maximum'], summation: ['summ', 'Summation'],
    variance: ['vari', 'Variance'], standard_deviation: ['stdv', 'Standard Deviation'], skewness: ['skew', 'Skewness'], kurtosis: ['kurt', 'Kurtosis'],
    range: ['rang', 'Range'], entropy: ['entr', 'Entropy'],
};

const PRESET_NAME = /^[\w .,()&'+-]+$/;

export const tools = [
    {
        name: 'list_action_sets',
        description: 'List the Actions panel\'s action sets and the actions in each, optionally with each action\'s recorded steps (Window > Actions)',
        inputSchema: { type: 'object', properties: { steps: { type: 'boolean', description: 'Include each action\'s step names. Default false' } } },
        hints: { readOnly: true },
        features: ['photoshop.automation.actions_panel'],
        handler: (a) => run('List action sets', script(`${AM}
__result__ = { sets: __actionSets(${bool(a.steps)}) };`, { needsDocument: false })),
    },
    {
        name: 'edit_actions',
        description: 'Change the Actions panel: create an empty set, delete a set, an action or one of its steps, clear every set, reset to Default Actions, load an .atn file or one of Photoshop\'s bundled sets, or save a set as an .atn file (Actions panel menu)',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['create_set', 'delete', 'clear_all', 'reset', 'load', 'save'], description: 'create_set (New Set), delete (Delete), clear_all (Clear All Actions), reset (Reset Actions: clear, then load Default Actions), load (Load Actions), save (Save Actions)' },
                set: { type: 'string', description: 'Set name: the new set for create_set, the set to delete, save, or that holds action' },
                action: { type: 'string', description: 'delete: the action to delete (or whose step to delete) inside set' },
                step: { type: 'integer', minimum: 1, description: 'delete: the step number (1 = first) inside action' },
                filePath: { type: 'string', description: 'load or save: absolute path of an .atn file' },
                preset: { type: 'string', description: 'load: a set bundled in Photoshop\'s Presets/Actions folder, e.g. "Frames", "Image Effects", "Production"' },
            },
            required: ['operation'],
        },
        hints: { destructive: true },
        auditArgs: { operation: 'create_set', set: 'My Set', action: undefined, step: undefined, filePath: undefined, preset: undefined },
        features: ['photoshop.automation.new_action_set', 'photoshop.automation.delete_action', 'photoshop.automation.clear_reset_actions', 'photoshop.automation.load_actions', 'photoshop.automation.action_set_file', 'photoshop.automation.default_action_sets'],
        handler: (a) => {
            const op = enumOf(a.operation, ['create_set', 'delete', 'clear_all', 'reset', 'load', 'save'], { name: 'operation' });
            const needSet = ['create_set', 'delete', 'save'].includes(op);
            if (needSet && !a.set) throw new Error(`${op} needs 'set'`);
            if (!needSet && a.set !== undefined) throw new Error(`'set' does not apply to ${op}`);
            if (op !== 'delete' && (a.action !== undefined || a.step !== undefined)) throw new Error("'action' and 'step' apply to delete");
            if (a.step !== undefined && a.action === undefined) throw new Error("'step' needs 'action'");
            if (!['load', 'save'].includes(op) && (a.filePath !== undefined || a.preset !== undefined)) throw new Error("'filePath' and 'preset' apply to load and save");
            let body;
            if (op === 'create_set') {
                body = `
var before = __actionSets(false).length;
var d = new ActionDescriptor();
d.putClass(__c("Nw  "), __c("ASet"));
d.putString(__c("Nm  "), ${str(a.set)});
app.executeAction(__c("Mk  "), d, DialogModes.NO);
var sets = __actionSets(false);
if (sets.length <= before) throw new Error("No action set was created");
var made = sets[sets.length - 1];
if (made.name !== ${str(a.set)}) {
  var rr = new ActionReference(), rd = new ActionDescriptor(), nd = new ActionDescriptor();
  rr.putIndex(__c("ASet"), made.index);
  rd.putReference(__c("null"), rr);
  nd.putString(__c("Nm  "), ${str(a.set)});
  rd.putObject(__c("T   "), __c("ASet"), nd);
  try { app.executeAction(__c("setd"), rd, DialogModes.NO); } catch (e) {}
  sets = __actionSets(false);
}
__result__ = { created: sets[sets.length - 1].name, sets: sets };`;
            } else if (op === 'delete') {
                const step = a.step !== undefined ? index(a.step, { name: 'step', max: 10000 }) : 'null';
                body = `
var d = new ActionDescriptor();
d.putReference(__c("null"), __actionRef(${str(a.set)}, ${a.action !== undefined ? str(a.action) : 'null'}, ${step}));
app.executeAction(__c("Dlt "), d, DialogModes.NO);
__result__ = { deleted: { set: ${str(a.set)}, action: ${a.action !== undefined ? str(a.action) : 'null'}, step: ${step} }, sets: __actionSets(false) };`;
            } else if (op === 'clear_all' || op === 'reset') {
                body = `
var all = __actionSets(false), failed = [];
for (var i = all.length - 1; i >= 0; i--) {
  var d = new ActionDescriptor();
  d.putReference(__c("null"), __actionRef(all[i].name, null, null));
  try { app.executeAction(__c("Dlt "), d, DialogModes.NO); } catch (e) { failed.push(all[i].name); }
}
${op === 'reset' ? `var def = new File(app.path + "/Presets/Actions/Default Actions.atn");
if (!def.exists) throw new Error("Default Actions.atn was not found in " + def.parent.fsName);
app.load(def);` : ''}
__result__ = { notDeleted: failed, sets: __actionSets(false) };`;
            } else if (op === 'load') {
                if ((a.filePath === undefined) === (a.preset === undefined)) throw new Error("load needs 'filePath' or 'preset'");
                let file;
                if (a.filePath !== undefined) {
                    const p = paths.validate(a.filePath);
                    if (path.extname(p).toLowerCase() !== '.atn') throw new Error("'filePath' must be an .atn file");
                    file = `new File(${jsxPath(p)})`;
                } else {
                    const name = String(a.preset).replace(/\.atn$/i, '');
                    if (!PRESET_NAME.test(name)) throw new Error("'preset' is a set name such as \"Frames\", without a path");
                    file = `new File(app.path + "/Presets/Actions/" + ${str(`${name}.atn`)})`;
                }
                body = `
var f = ${file};
if (!f.exists) throw new Error("Action file not found: " + f.fsName);
app.load(f);
__result__ = { loaded: f.fsName, sets: __actionSets(false) };`;
            } else {
                if (a.filePath === undefined || a.preset !== undefined) throw new Error("save needs 'filePath' (and no 'preset')");
                const p = paths.validate(a.filePath);
                if (path.extname(p).toLowerCase() !== '.atn') throw new Error("'filePath' must end in .atn");
                body = `
var f = new File(${jsxPath(p)});
var d = new ActionDescriptor();
d.putReference(__c("null"), __actionRef(${str(a.set)}, null, null));
d.putPath(__c("T   "), f);
app.executeAction(__c("save"), d, DialogModes.NO);
__result__ = { saved: ${str(a.set)}, file: f.fsName };`;
            }
            return run('Edit actions', script(`${AM}${body}`, { needsDocument: false }));
        },
    },
    {
        name: 'set_action_options',
        description: 'Set how actions play back (Actions panel menu > Playback Options: accelerated, step by step, or pause between steps), and toggle Button Mode or Allow Tool Recording',
        inputSchema: {
            type: 'object',
            properties: {
                playback: { type: 'string', enum: ['accelerated', 'step_by_step', 'pause'], description: 'Playback Options performance' },
                pauseSeconds: { type: 'integer', minimum: 1, maximum: 60, description: 'Seconds between steps, for playback pause. Default 1' },
                toggleButtonMode: { type: 'boolean', description: 'Switch Button Mode on or off (it toggles; the panel shows the current state)' },
                toggleToolRecording: { type: 'boolean', description: 'Switch Allow Tool Recording on or off (it toggles)' },
            },
        },
        auditArgs: { playback: 'pause', pauseSeconds: 3 },
        features: ['photoshop.automation.playback_options', 'photoshop.automation.button_mode', 'photoshop.automation.allow_tool_recording'],
        handler: (a) => {
            if (a.playback === undefined && !a.toggleButtonMode && !a.toggleToolRecording) throw new Error('Give playback, toggleButtonMode or toggleToolRecording');
            const playback = a.playback !== undefined ? enumOf(a.playback, ['accelerated', 'step_by_step', 'pause'], { name: 'playback' }) : null;
            if (a.pauseSeconds !== undefined && playback !== 'pause') throw new Error("'pauseSeconds' applies to playback pause");
            const lines = [];
            if (playback) {
                lines.push(`
var r = new ActionReference(), d = new ActionDescriptor(), p = new ActionDescriptor();
r.putProperty(__c("Prpr"), __c("PbkO"));
r.putEnumerated(__c("capp"), __c("Ordn"), __c("Trgt"));
d.putReference(__c("null"), r);
p.putEnumerated(__s("performance"), __s("performance"), __s(${str(playback === 'step_by_step' ? 'stepByStep' : playback)}));
${playback === 'pause' ? `p.putInteger(__s("pause"), ${num(a.pauseSeconds ?? 1, { min: 1, max: 60, name: 'pauseSeconds' })});` : ''}
d.putObject(__c("T   "), __c("PbkO"), p);
app.executeAction(__c("setd"), d, DialogModes.NO);`);
            }
            if (a.toggleButtonMode) lines.push('app.runMenuItem(__s("buttonMode"));');
            if (a.toggleToolRecording) lines.push('app.runMenuItem(__s("allowToolRecording"));');
            return run('Set action options', script(`${AM}${lines.join('\n')}
__result__ = { playback: ${playback ? str(playback) : 'null'}, buttonModeToggled: ${bool(a.toggleButtonMode)}, toolRecordingToggled: ${bool(a.toggleToolRecording)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_action_batch',
        description: 'Play an action on every file in a folder, a list of files, or the open documents, and leave, save over, or save them to a folder (File > Automate > Batch). Long batches can outlast the script timeout (PHOTOSHOP_SCRIPT_TIMEOUT_MS)',
        inputSchema: {
            type: 'object',
            properties: {
                ...BATCH_OPTIONS,
                sourceFolder: { type: 'string', description: 'Source: every file in this absolute folder path' },
                includeSubfolders: { type: 'boolean', description: 'Include All Subfolders of sourceFolder. Default false' },
                extensions: { type: 'array', items: { type: 'string' }, description: 'Only files with these extensions from sourceFolder, e.g. ["jpg", "png"]' },
                files: { type: 'array', items: { type: 'string' }, description: 'Source: these absolute file paths' },
                openDocuments: { type: 'boolean', description: 'Source: the open documents (Opened Files); each must have been saved' },
            },
            required: ['action', 'set'],
        },
        hints: { destructive: true },
        auditArgs: { files: undefined, openDocuments: undefined, errorLog: path.join(process.env.HOME ?? '/tmp', 'Documents', 'batch-errors.txt'), extensions: ['jpg', 'png'], destination: 'folder', fileNaming: ['document_name', 'serial_3', 'extension_lower'] },
        features: ['photoshop.automation.batch', 'photoshop.automation.batch_source', 'photoshop.automation.batch_override_open', 'photoshop.automation.batch_include_subfolders', 'photoshop.automation.batch_suppress_open_dialogs', 'photoshop.automation.batch_suppress_profile_warnings', 'photoshop.automation.batch_destination', 'photoshop.automation.batch_override_save_as', 'photoshop.automation.batch_file_naming', 'photoshop.automation.batch_compatibility', 'photoshop.automation.batch_errors'],
        handler: (a) => {
            const sources = [a.sourceFolder !== undefined, a.files !== undefined, Boolean(a.openDocuments)].filter(Boolean).length;
            if (sources !== 1) throw new Error('Give one source: sourceFolder, files or openDocuments: true');
            if (a.sourceFolder === undefined && (a.includeSubfolders || a.extensions !== undefined)) throw new Error("'includeSubfolders' and 'extensions' apply to sourceFolder");
            const opt = batchOptions(a);
            let source;
            if (a.sourceFolder !== undefined) {
                const exts = (a.extensions ?? []).map((e) => {
                    const x = String(e).replace(/^\./, '').toLowerCase();
                    if (!/^[a-z0-9]{1,8}$/.test(x)) throw new Error(`'extensions': not an extension: ${e}`);
                    return x;
                });
                source = `${COLLECT}
var src = new Folder(${jsxPath(paths.validate(a.sourceFolder))});
if (!src.exists) throw new Error("Folder not found: " + src.fsName);
var input = __collect(src, ${bool(a.includeSubfolders)}, ${json(exts)}, []);`;
            } else if (a.files !== undefined) {
                if (!Array.isArray(a.files) || !a.files.length) throw new Error("'files' needs at least one path");
                source = `
var input = [${a.files.map((f) => `new File(${jsxPath(paths.validate(f))})`).join(', ')}];
for (var i = 0; i < input.length; i++) if (!input[i].exists) throw new Error("File not found: " + input[i].fsName);`;
            } else {
                source = `
var input = [];
for (var i = 0; i < app.documents.length; i++) {
  var od = app.documents[i], of = null;
  try { of = od.fullName; } catch (e) {}
  if (!of) throw new Error(od.name + " has never been saved; Batch reopens files from disk");
  input.push(of);
}`;
            }
            return run('Batch', script(`${source}
if (!input.length) throw new Error("No source files to process");
var o = new BatchOptions();
o.overrideOpen = ${bool(a.overrideOpen)};
o.suppressOpen = ${bool(a.suppressOpenDialogs ?? true)};
o.suppressProfile = ${bool(a.suppressProfileWarnings ?? true)};
o.destination = BatchDestinationType.${DESTINATIONS[opt.destination]};
${opt.folder ? `o.destinationFolder = new Folder(${jsxPath(opt.folder)});
if (!o.destinationFolder.exists) o.destinationFolder.create();
o.fileNaming = [${opt.naming.map((n) => `FileNamingType.${FILE_NAMING[n][0]}`).join(', ')}];
o.startingSerial = ${opt.serial};` : ''}
${opt.destination !== 'none' ? `o.overrideSave = ${bool(a.overrideSaveAs)};` : ''}
o.windowsCompatible = ${bool(opt.windows)};
o.macintoshCompatible = ${bool(opt.macos)};
o.unixCompatible = ${bool(opt.unix)};
${opt.errorLog ? `o.errorFile = new File(${jsxPath(opt.errorLog)});` : ''}
var report = app.batch(input, ${str(opt.action)}, ${str(opt.set)}, o);
__result__ = { files: input.length, action: ${str(opt.action)}, set: ${str(opt.set)}, destination: ${str(opt.destination)}, report: report };`, { needsDocument: false }));
        },
    },
    {
        name: 'create_droplet',
        description: 'Save an action as a droplet: an application that plays the action on files dropped onto it, with Batch\'s open, save and naming options (File > Automate > Create Droplet)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the droplet to create (an .app on macOS, an .exe on Windows)' },
                ...BATCH_OPTIONS,
            },
            required: ['filePath', 'action', 'set'],
        },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'Droplet.app'), errorLog: path.join(process.env.HOME ?? '/tmp', 'Documents', 'droplet-errors.txt'), destination: 'folder', fileNaming: ['document_name', 'extension_lower'] },
        features: ['photoshop.automation.create_droplet'],
        handler: (a) => {
            const file = paths.validate(a.filePath);
            const opt = batchOptions(a);
            const naming = opt.naming.map((n) => `
nc = new ActionDescriptor();
nc.putEnumerated(__s("component"), __s("fileNamingComponent"), ${FILE_NAMING[n][1] ? `__s(${str(FILE_NAMING[n][1])})` : '__c("Nm  ")'});
nl.putObject(__s("fileNamingComponents"), nc);`).join('');
            return run('Create droplet', script(`${AM}
var d = new ActionDescriptor(), u = new ActionReference();
d.putPath(__c("In  "), new File(${jsxPath(file)}));
u.putName(__c("Actn"), ${str(opt.action)});
u.putName(__c("ASet"), ${str(opt.set)});
d.putReference(__c("Usng"), u);
${a.suppressProfileWarnings ?? true ? 'd.putBoolean(__s("suppressWarnings"), true);' : ''}
${a.suppressOpenDialogs ?? true ? 'd.putBoolean(__s("suppressOpenOptions"), true);' : ''}
${a.overrideOpen ? 'd.putBoolean(__c("OvrO"), true);' : ''}
${opt.folder ? `var dest = new Folder(${jsxPath(opt.folder)});
if (!dest.exists) dest.create();
d.putPath(__c("T   "), dest);
var rules = new ActionDescriptor(), nl = new ActionList(), nc;${naming}
rules.putList(__s("fileNamingComponents"), nl);
rules.putInteger(__c("Strt"), ${opt.serial});
rules.putBoolean(__c("Mcnt"), ${bool(opt.macos)});
rules.putBoolean(__c("Win "), ${bool(opt.windows)});
rules.putBoolean(__s("unix"), ${bool(opt.unix)});
d.putObject(__s("fileNamingRules"), __s("fileNamingRules"), rules);` : ''}
${opt.destination !== 'none' && a.overrideSaveAs ? 'd.putBoolean(__c("Ovrd"), true);' : ''}
${opt.destination === 'save_and_close' ? 'd.putBoolean(__c("SvAn"), true);' : ''}
${opt.errorLog ? `var log = new File(${jsxPath(opt.errorLog)});
d.putPath(__c("Log "), log.parent);
d.putString(__c("Nm  "), log.name);` : ''}
app.executeAction(__s("createDroplet"), d, DialogModes.NO);
__result__ = { droplet: ${str(file)}, action: ${str(opt.action)}, set: ${str(opt.set)} };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_automate_command',
        description: 'Run a File > Automate or File > Scripts command on the active document without its dialog: crop_and_straighten (Crop and Straighten Photos: each scanned photo into its own document), fit_image (Fit Image: resize to fit a box), conditional_mode_change (Conditional Mode Change), lens_correction (Automate > Lens Correction\'s automatic profile correction), delete_empty_layers (Delete All Empty Layers), flatten_layer_effects (Flatten All Layer Effects), flatten_masks (Flatten All Masks)',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: COMMANDS },
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'fit_image: box width in pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'fit_image: box height in pixels' },
                dontEnlarge: { type: 'boolean', description: 'fit_image: leave images already smaller than the box. Default false' },
                sourceModes: { type: 'array', items: { type: 'string', enum: Object.keys(SOURCE_MODES) }, description: 'conditional_mode_change: convert only from these modes. Default all' },
                targetMode: { type: 'string', enum: Object.keys(TARGET_MODES), description: 'conditional_mode_change: the mode to convert to' },
                flatten: { type: 'boolean', description: 'conditional_mode_change: flatten while converting. Default false' },
                distortion: { type: 'boolean', description: 'lens_correction: correct geometric distortion. Default true' },
                chromaticAberration: { type: 'boolean', description: 'lens_correction: correct chromatic aberration. Default false' },
                vignette: { type: 'boolean', description: 'lens_correction: remove vignetting. Default false' },
                autoScale: { type: 'boolean', description: 'lens_correction: scale to hide blank edges. Default true' },
                edge: { type: 'string', enum: Object.keys(LENS_EDGES), description: 'lens_correction: fill for edges left blank. Default transparency' },
            },
            required: ['command'],
        },
        auditArgs: { command: 'fit_image', width: 800, height: 600, sourceModes: undefined, targetMode: undefined, flatten: undefined, distortion: undefined, chromaticAberration: undefined, vignette: undefined, autoScale: undefined, edge: undefined },
        features: ['photoshop.automation.crop_and_straighten_photos', 'photoshop.automation.fit_image', 'photoshop.automation.conditional_mode_change', 'photoshop.automation.lens_correction_automate', 'photoshop.automation.delete_all_empty_layers', 'photoshop.automation.flatten_all_layer_effects', 'photoshop.automation.flatten_all_masks', 'photoshop.automation.scripting_playback_parameters'],
        handler: (a) => {
            const cmd = enumOf(a.command, COMMANDS, { name: 'command' });
            const own = {
                fit_image: ['width', 'height', 'dontEnlarge'],
                conditional_mode_change: ['sourceModes', 'targetMode', 'flatten'],
                lens_correction: ['distortion', 'chromaticAberration', 'vignette', 'autoScale', 'edge'],
            };
            for (const [c, keys] of Object.entries(own)) {
                if (c === cmd) continue;
                for (const k of keys) if (a[k] !== undefined) throw new Error(`'${k}' applies to ${c}`);
            }
            let body;
            if (cmd === 'crop_and_straighten') {
                body = `
var before = app.documents.length;
app.executeAction(__s("CropPhotosAuto0001"), new ActionDescriptor(), DialogModes.NO);
var made = [];
for (var i = before; i < app.documents.length; i++) made.push(__docInfo(app.documents[i]));
__result__ = { documents: made };`;
            } else if (cmd === 'fit_image') {
                if (a.width === undefined || a.height === undefined) throw new Error('fit_image needs width and height');
                body = `
var d = new ActionDescriptor();
d.putUnitDouble(__s("width"), __c("#Pxl"), ${num(a.width, { min: 1, max: 300000, name: 'width' })});
d.putUnitDouble(__s("height"), __c("#Pxl"), ${num(a.height, { min: 1, max: 300000, name: 'height' })});
d.putBoolean(__s("limit"), ${bool(a.dontEnlarge)});
app.executeAction(__s("3caa3434-cb67-11d1-bc43-0060b0a13dc4"), d, DialogModes.NO);
__result__ = __docInfo(app.activeDocument);`;
            } else if (cmd === 'conditional_mode_change') {
                if (a.targetMode === undefined) throw new Error('conditional_mode_change needs targetMode');
                const target = enumOf(a.targetMode, Object.keys(TARGET_MODES), { name: 'targetMode' });
                const from = a.sourceModes ?? Object.keys(SOURCE_MODES);
                if (!Array.isArray(from) || !from.length) throw new Error("'sourceModes' needs at least one mode");
                from.forEach((m) => enumOf(m, Object.keys(SOURCE_MODES), { name: 'sourceModes' }));
                body = `
var d = new ActionDescriptor(), l = new ActionList();
${from.map((m) => `l.putEnumerated(__c("Cndn"), __c(${str(SOURCE_MODES[m])}));`).join('\n')}
d.putList(__c("SrcM"), l);
d.putObject(__c("DstM"), __c(${str(TARGET_MODES[target])}), new ActionDescriptor());
d.putBoolean(__c("Mrge"), ${bool(a.flatten)});
app.executeAction(__s("8cba8cd6-cb66-11d1-bc43-0060b0a13dc4"), d, DialogModes.NO);
__result__ = __docInfo(app.activeDocument);`;
            } else if (cmd === 'lens_correction') {
                const edge = enumOf(a.edge ?? 'transparency', Object.keys(LENS_EDGES), { name: 'edge' });
                body = `
var d = new ActionDescriptor();
d.putString(__c("LnPp"), "");
d.putBoolean(__c("LnAg"), ${bool(a.distortion ?? true)});
d.putBoolean(__c("LnAc"), ${bool(a.chromaticAberration)});
d.putBoolean(__c("LnAv"), ${bool(a.vignette)});
d.putBoolean(__c("LnAs"), ${bool(a.autoScale ?? true)});
d.putInteger(__c("LnFt"), ${LENS_EDGES[edge]});
app.executeAction(__c("LnCr"), d, DialogModes.NO);
__result__ = __docInfo(app.activeDocument);`;
            } else {
                body = `
app.executeAction(__s(${str(SCRIPT_EVENTS[cmd])}), new ActionDescriptor(), DialogModes.NO);
__result__ = __docInfo(app.activeDocument);`;
            }
            return run('Automate', script(`${AM}${body}`));
        },
    },
    {
        name: 'combine_images',
        description: 'Combine image files into a new document with one of Photoshop\'s multi-file commands, without its dialog: stack (File > Scripts > Load Files into Stack), photomerge (File > Automate > Photomerge panorama), hdr (File > Automate > Merge to HDR Pro, with its last-used settings) or statistics (File > Scripts > Statistics stack mode). Large merges can outlast the script timeout',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: Object.keys(COMBINE) },
                files: { type: 'array', minItems: 2, items: { type: 'string' }, description: 'Absolute paths of two or more images' },
                align: { type: 'boolean', description: 'stack, hdr, statistics: auto-align the layers. Default false (hdr: true)' },
                smartObject: { type: 'boolean', description: 'stack: convert the stack into a smart object. Default false' },
                layout: { type: 'string', enum: Object.keys(LAYOUTS), description: 'photomerge: Auto (default), Perspective, Cylindrical, Spherical, Collage or Reposition' },
                blend: { type: 'boolean', description: 'photomerge: Blend Images Together. Default true' },
                vignetteRemoval: { type: 'boolean', description: 'photomerge: Vignette Removal. Default false' },
                distortionCorrection: { type: 'boolean', description: 'photomerge: Geometric Distortion Correction. Default false' },
                fillTransparent: { type: 'boolean', description: 'photomerge: Content Aware Fill Transparent Areas. Default false' },
                statistic: { type: 'string', enum: Object.keys(STATISTICS), description: 'statistics: the stack mode. Default median' },
            },
            required: ['method', 'files'],
        },
        auditArgs: { method: 'photomerge', align: undefined, smartObject: undefined, statistic: undefined, files: ['a.jpg', 'b.jpg'].map((f) => path.join(process.env.HOME ?? '/tmp', 'Documents', f)) },
        features: ['photoshop.automation.load_files_into_stack', 'photoshop.automation.photomerge', 'photoshop.automation.merge_to_hdr_pro', 'photoshop.automation.statistics'],
        handler: (a) => {
            const method = enumOf(a.method, Object.keys(COMBINE), { name: 'method' });
            if (!Array.isArray(a.files) || a.files.length < 2) throw new Error("'files' needs two or more paths");
            const only = { smartObject: 'stack', layout: 'photomerge', blend: 'photomerge', vignetteRemoval: 'photomerge', distortionCorrection: 'photomerge', fillTransparent: 'photomerge', statistic: 'statistics' };
            for (const [k, m] of Object.entries(only)) if (a[k] !== undefined && m !== method) throw new Error(`'${k}' applies to ${m}`);
            if (a.align !== undefined && method === 'photomerge') throw new Error("'align' does not apply to photomerge, which always aligns");
            const files = a.files.map((f) => `new File(${jsxPath(paths.validate(f))})`).join(', ');
            const { file, flag, api } = COMBINE[method];
            const align = bool(a.align ?? method === 'hdr');
            let call;
            if (method === 'stack') {
                call = `api["createSmartObject"] = ${bool(a.smartObject)};
api["intoStack"](files, ${align});`;
            } else if (method === 'photomerge') {
                call = `api["alignmentKey"] = ${str(LAYOUTS[enumOf(a.layout ?? 'auto', Object.keys(LAYOUTS), { name: 'layout' })])};
api["advancedBlending"] = ${bool(a.blend ?? true)};
api["removeVignette"] = ${bool(a.vignetteRemoval)};
api["lensCorrection"] = ${bool(a.distortionCorrection)};
api["autoFillTrans"] = ${bool(a.fillTransparent)};
api["createPanorama"](files, false);`;
            } else if (method === 'hdr') {
                call = `api["mergeFilesToHDR"](files, ${align});`;
            } else {
                const [code, label] = STATISTICS[enumOf(a.statistic ?? 'median', Object.keys(STATISTICS), { name: 'statistic' })];
                call = `api["selectedOperation"] = ${str(code)};
api["selectedOperationStr"] = ${str(label)};
api["computeStatistics"](files, ${align});`;
            }
            // Adobe's scripts define their own objects (loadLayers, photomerge, ...);
            // those are not part of the object model, so they are reached by key.
            return run('Combine images', script(`
var files = [${files}];
for (var i = 0; i < files.length; i++) if (!files[i].exists) throw new Error("File not found: " + files[i].fsName);
var adobeScript = new File(app.path + "/" + localize("$$$/ScriptingSupport/InstalledScripts=Presets/Scripts") + "/" + ${str(file)});
if (!adobeScript.exists) throw new Error("Photoshop's script was not found: " + adobeScript.fsName);
var before = app.documents.length;
$.global[${str(flag)}] = true;
try {
  $.evalFile(adobeScript);
  var api = $.global[${str(api)}];
  ${call}
} finally {
  delete $.global[${str(flag)}];
}
if (app.documents.length <= before) throw new Error("No document was made");
__result__ = __docInfo(app.activeDocument);`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_script_events',
        description: 'List, add or remove the scripts and actions Photoshop runs when an event happens, and turn them on or off (File > Scripts > Script Events Manager)',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['list', 'add', 'remove', 'remove_all', 'enable', 'disable'] },
                event: { type: 'string', description: 'add: the event, as a four-character code or event id, e.g. "Opn " (Open Document), "save", "Mk  " (New Document)' },
                eventClass: { type: 'string', description: 'add: the class the event applies to, e.g. "Dcmn" to fire Make only for documents' },
                scriptFile: { type: 'string', description: 'add: absolute path of the .jsx or .js script to run' },
                index: { type: 'integer', minimum: 0, description: 'remove: the notifier\'s index from list' },
            },
            required: ['operation'],
        },
        auditArgs: { operation: 'add', event: 'Opn ', eventClass: undefined, scriptFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'on-open.jsx'), index: undefined },
        features: ['photoshop.automation.script_events_manager'],
        handler: (a) => {
            const op = enumOf(a.operation, ['list', 'add', 'remove', 'remove_all', 'enable', 'disable'], { name: 'operation' });
            if (op !== 'add' && (a.event !== undefined || a.eventClass !== undefined || a.scriptFile !== undefined)) throw new Error("'event', 'eventClass' and 'scriptFile' apply to add");
            if (op !== 'remove' && a.index !== undefined) throw new Error("'index' applies to remove");
            let body = '';
            if (op === 'add') {
                if (!a.event || !a.scriptFile) throw new Error("add needs 'event' and 'scriptFile'");
                if (!/^[\w $#-]{1,64}$/.test(String(a.event))) throw new Error("'event' is a four-character code or event id");
                if (a.eventClass !== undefined && !/^[\w $#-]{1,64}$/.test(String(a.eventClass))) throw new Error("'eventClass' is a four-character code or class id");
                const p = paths.validate(a.scriptFile);
                if (!['.jsx', '.js'].includes(path.extname(p).toLowerCase())) throw new Error("'scriptFile' must be a .jsx or .js script");
                body = `
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("Script not found: " + f.fsName);
app.notifiers.add(${str(a.event)}, f${a.eventClass !== undefined ? `, ${str(a.eventClass)}` : ''});
app.notifiersEnabled = true;`;
            } else if (op === 'remove') {
                if (a.index === undefined) throw new Error("remove needs 'index'");
                body = `
var at = ${index(a.index, { name: 'index', max: 10000 })};
if (at >= app.notifiers.length) throw new Error("There are " + app.notifiers.length + " notifiers");
app.notifiers[at].remove();`;
            } else if (op === 'remove_all') {
                body = 'if (app.notifiers.length) app.notifiers[0].removeAll();';
            } else if (op !== 'list') {
                body = `app.notifiersEnabled = ${bool(op === 'enable')};`;
            }
            return run('Script events', script(`${body}
var out = [];
for (var i = 0; i < app.notifiers.length; i++) {
  var n = app.notifiers[i];
  out.push({ index: i, event: n.event, eventClass: n.eventClass, file: n.eventFile.fsName });
}
__result__ = { enabled: app.notifiersEnabled, notifiers: out };`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_data_sets',
        description: 'Work with variable data sets on the active document: import them from a text file (File > Import > Variable Data Sets), apply one (Image > Apply Data Set), or save a PSD per data set into a folder (File > Export > Data Sets as Files). Variables themselves are defined in Image > Variables > Define',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['import', 'apply', 'export'] },
                filePath: { type: 'string', description: 'import: absolute path of the comma- or tab-delimited text file' },
                replace: { type: 'boolean', description: 'import: replace the existing data sets. Default true' },
                firstColumnNames: { type: 'boolean', description: 'import: use the first column as the data set names. Default false' },
                name: { type: 'string', description: 'apply: the data set name' },
                names: { type: 'array', items: { type: 'string' }, description: 'export: the data sets to save, each as <name>.psd' },
                folder: { type: 'string', description: 'export: absolute folder path' },
            },
            required: ['operation'],
        },
        auditArgs: { operation: 'export', filePath: undefined, replace: undefined, firstColumnNames: undefined, name: undefined, names: ['Set 1', 'Set 2'] },
        features: ['photoshop.automation.import_data_sets', 'photoshop.automation.apply_data_set', 'photoshop.automation.export_data_sets_as_files'],
        handler: (a) => {
            const op = enumOf(a.operation, ['import', 'apply', 'export'], { name: 'operation' });
            const own = { import: ['filePath', 'replace', 'firstColumnNames'], apply: ['name'], export: ['names', 'folder'] };
            for (const [o, keys] of Object.entries(own)) if (o !== op) for (const k of keys) if (a[k] !== undefined) throw new Error(`'${k}' applies to ${o}`);
            const APPLY = String.raw`
var __apply = function (name) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putName(app.stringIDToTypeID("dataSetClass"), name);
  d.putReference(app.charIDToTypeID("null"), r);
  app.executeAction(app.charIDToTypeID("Aply"), d, DialogModes.NO);
};`;
            if (op === 'import') {
                if (!a.filePath) throw new Error("import needs 'filePath'");
                return run('Import data sets', script(`
var f = new File(${jsxPath(paths.validate(a.filePath))});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = new ActionDescriptor(), r = new ActionReference();
r.putClass(app.stringIDToTypeID("dataSetClass"));
d.putReference(app.charIDToTypeID("null"), r);
d.putPath(app.charIDToTypeID("Usng"), f);
d.putEnumerated(app.charIDToTypeID("Encd"), app.stringIDToTypeID("dataSetEncoding"), app.stringIDToTypeID("dataSetEncodingAuto"));
d.putBoolean(app.stringIDToTypeID("eraseAll"), ${bool(a.replace ?? true)});
d.putBoolean(app.stringIDToTypeID("useFirstColumn"), ${bool(a.firstColumnNames)});
app.executeAction(app.stringIDToTypeID("importDataSets"), d, DialogModes.NO);
__result__ = { imported: f.fsName, document: doc.name };`));
            }
            if (op === 'apply') {
                if (!a.name) throw new Error("apply needs 'name'");
                return run('Apply data set', script(`${APPLY}
__apply(${str(a.name)});
__result__ = { applied: ${str(a.name)}, document: doc.name };`));
            }
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("export needs 'names'");
            if (!a.folder) throw new Error("export needs 'folder'");
            const folder = paths.validate(a.folder);
            const out = a.names.map((n) => {
                const name = String(n);
                if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error(`'names': ${JSON.stringify(name)} cannot be a file name`);
                return { name, file: paths.validate(path.join(folder, `${name}.psd`)) };
            });
            return run('Export data sets', script(`${APPLY}
var dir = new Folder(${jsxPath(folder)});
if (!dir.exists) dir.create();
var o = new PhotoshopSaveOptions();
o.layers = true;
var jobs = [${out.map((o) => `[${str(o.name)}, new File(${jsxPath(o.file)})]`).join(', ')}], saved = [];
for (var i = 0; i < jobs.length; i++) {
  __apply(jobs[i][0]);
  doc.saveAs(jobs[i][1], o, true, Extension.LOWERCASE);
  saved.push(jobs[i][1].fsName);
}
__result__ = { saved: saved };`));
        },
    },
];
