/**
 * Actions, batch processing, script files, tags and object notes.
 *
 * Illustrator's object model plays an action by name (Application.doScript),
 * loads a set from an .aia file (loadAction) and unloads a set or one action
 * (unloadAction). It has no member that lists the loaded sets or edits one, so:
 *   - list_actions reads the sets Illustrator keeps in its preferences under
 *     plugin/Action/SavedSets, the way AiCommandPalette does (see NOTICE);
 *   - building and editing happen on .aia files before they are loaded
 *     (src/aia.js): renaming, switching steps or their dialogs on and off,
 *     removing actions or steps, and composing new actions from saved steps.
 * Batch opens a dialog, so run_batch does what it describes by script: open each
 * file (or display each data set), play the action, and save to a destination.
 */
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { str, enumOf, json, jsxPath, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';
import { tools as variableTools } from './variables.js';
import { readActions, describeActions, editActions, composeActions } from '../aia.js';

const MAX_AIA_BYTES = 4 * 1024 * 1024;
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const REPLACE = ['same_name', 'all', 'none'];
const BATCH_TYPES = ['ai', 'pdf', 'eps', 'svg'];
const DESTINATIONS = ['none', 'save_and_close', 'folder'];
const NAMING = ['file_number', 'file_data_set', 'data_set'];
const SCRIPT_TYPES = ['.jsx', '.js', '.jsxbin'];
const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/actions/', import.meta.url));

/** An action or set name as Illustrator matches it: exact, case included. */
function actionName(value, label) {
    const v = typeof value === 'string' ? value : '';
    if (!v.trim()) throw new Error(`'${label}' is required: the name as it appears in the Actions panel (case matters)`);
    if (v.length > 255 || /[\u0000-\u001f]/.test(v)) throw new Error(`'${label}' must be at most 255 characters with no control characters`);
    return v;
}

/** A validated path with one of the given extensions. */
function filePath(value, label, exts) {
    if (typeof value !== 'string' || !value) throw new Error(`'${label}' is required: an absolute ${exts.join(' or ')} path`);
    const p = paths.validate(value);
    if (!exts.includes(path.extname(p).toLowerCase())) throw new Error(`'${label}' must end in ${exts.join(' or ')}: ${value}`);
    return p;
}

/** Read and parse an .aia file the caller named. */
function readAiaFile(value, label = 'filePath') {
    const p = filePath(value, label, ['.aia']);
    let size;
    try { size = statSync(p).size; } catch { throw new Error(`File not found: ${p}`); }
    if (size > MAX_AIA_BYTES) throw new Error(`${p} is larger than ${MAX_AIA_BYTES / 1024 / 1024} MB`);
    try {
        return { path: p, file: readActions(readFileSync(p, 'utf8')) };
    } catch (e) {
        throw new Error(`${p}: ${e.message}`);
    }
}

/** Write .aia text to a validated path (Save Actions keeps the same format). */
function saveAia(value, text) {
    const p = filePath(value, 'saveAs', ['.aia']);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
    return p;
}

/** ES3: the loaded action sets, as Illustrator stores them in its preferences. */
const SETS_FN = `
function __actionSets() {
  var out = [], p = app.preferences;
  for (var i = 1; i <= 1000; i++) {
    var base = "plugin/Action/SavedSets/set-" + i + "/", name = p.getStringPreference(base + "name");
    if (!name) break;
    var n = p.getIntegerPreference(base + "actionCount"), list = [];
    for (var j = 1; j <= n; j++) list.push(p.getStringPreference(base + "action-" + j + "/name"));
    out.push({ name: name, actions: list });
  }
  return out;
}`;

/**
 * ES3: write .aia text to a temporary file, unload sets it replaces, load it,
 * and remove the file. `replace` is one of REPLACE.
 */
function loadStatements(text, setName, replace) {
    return `${SETS_FN}
var __aia = new File(Folder.temp + "/adobe-mcp-actions-" + new Date().getTime() + ".aia");
__aia.encoding = "UTF-8";
if (!__aia.open("w")) throw new Error("Cannot write a temporary action file in " + Folder.temp.fsName);
__aia.write(${str(text)});
__aia.close();
var replaced = [], drop = [];
${replace === 'all' ? 'var sets = __actionSets(); for (var s = 0; s < sets.length; s++) drop.push(sets[s].name);' : ''}
${replace !== 'none' ? `drop.push(${str(setName)});` : ''}
try {
  for (var d = 0; d < drop.length; d++) {
    try { app.unloadAction(drop[d], ""); replaced.push(drop[d]); } catch (e) {}
  }
  app.loadAction(__aia);
} finally {
  try { __aia.remove(); } catch (e) {}
}`;
}

/** Load or save composed .aia text; returns the tool result. */
async function loadOrSave(operation, text, a) {
    const file = readActions(text);
    const replace = enumOf(a.replace ?? 'same_name', REPLACE, { name: 'replace' });
    const load = a.load ?? true;
    if (!load && !a.saveAs) throw new Error("Nothing to do: give saveAs, or leave load on");
    const saved = a.saveAs ? saveAia(a.saveAs, text) : null;
    const summary = { ...describeActions(file), ...(saved ? { savedAs: saved } : {}) };
    if (!load) return formatResponse({ ...summary, loaded: false }, operation);
    const r = await executor.runStructured(script(`${loadStatements(text, file.name, replace)}
__result__ = { unloadedFirst: replaced };`, { needsDocument: false }));
    if (!r.ok) return formatErrorResponse(r.error, operation);
    let extra = {};
    try { extra = JSON.parse(r.result); } catch { extra = {}; }
    return formatResponse({ ...summary, loaded: true, ...extra }, operation);
}

const REPLACE_SCHEMA = {
    type: 'string',
    enum: REPLACE,
    description: 'same_name (default): unload a loaded set with the same name first, so the panel does not get a second copy; all: unload every set first (Replace Actions); none: add alongside',
};

const STEP_FLAGS = {
    enabled: { type: 'boolean', description: 'Include the step in playback (Toggle Item On/Off)' },
    showDialog: { type: 'boolean', description: 'Stop at the step\'s dialog during playback (Toggle Dialog On/Off). Only for steps that have a dialog' },
};

/** Split CSV or tab-separated text into rows of fields. */
function parseDelimited(text) {
    const src = text.replace(/^﻿/, '');
    const head = src.split(/\r\n|\r|\n/, 1)[0];
    const sep = head.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quoted) {
            if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"' && field === '') quoted = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
    }
    if (quoted) throw new Error('A quoted field is not closed');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Data-set records from a CSV data source, the way Adobe describes the file. */
function csvRecords(text, nameColumn) {
    const rows = parseDelimited(text);
    if (rows.length < 2) throw new Error('The file needs a row of field names and at least one row of data');
    if (rows.length - 1 > 1000) throw new Error('At most 1000 data rows per call');
    const header = rows[0].map((h) => h.trim());
    const columns = header.map((raw, i) => {
        const kind = { '@': 'image', '#': 'visibility', '%': 'graph' }[raw[0]] ?? 'text';
        const name = kind === 'text' ? raw : raw.slice(1);
        if (kind === 'graph') throw new Error(`Column ${raw}: graph data is not supported; remove the % columns`);
        if (raw === nameColumn || name === nameColumn) return { i, name, kind: 'name' };
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new Error(`Column ${JSON.stringify(raw)}: field names must start with a letter or underscore and use only letters, digits, _ . and - (no spaces)`);
        return { i, name, kind };
    });
    if (nameColumn !== undefined && !columns.some((c) => c.kind === 'name')) throw new Error(`No column named ${JSON.stringify(nameColumn)}. Columns: ${header.join(', ')}`);
    const names = new Set();
    return rows.slice(1).map((r, n) => {
        const values = {};
        let name = `Row ${n + 1}`;
        for (const c of columns) {
            const cell = (r[c.i] ?? '').trim();
            if (c.kind === 'name') { if (cell) name = cell; continue; }
            if (c.kind === 'visibility') {
                if (!/^(true|false)$/i.test(cell)) throw new Error(`Row ${n + 1}, column #${c.name}: give true or false, not ${JSON.stringify(cell)}`);
                values[c.name] = /^true$/i.test(cell);
            } else if (c.kind === 'image') {
                if (cell) values[c.name] = cell;
            } else values[c.name] = r[c.i] ?? '';
        }
        if (names.has(name)) throw new Error(`Two rows are named ${JSON.stringify(name)}; data set names must differ`);
        names.add(name);
        return { name, values };
    });
}

/** Files in a folder (and its subfolders) with the given extensions, sorted. */
function listFiles(folder, exts, recurse) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { throw new Error(`Folder not found: ${dir}`); }
        for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
            if (e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (recurse) walk(p); } else if (e.isFile() && exts.includes(path.extname(e.name).slice(1).toLowerCase())) out.push(p);
        }
    };
    walk(folder);
    return out;
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_');

/** Run one script of a batch; returns { ok, value | error }. */
async function batchStep(source) {
    const r = await executor.runStructured(source);
    if (!r.ok) return { ok: false, error: r.error };
    try { return { ok: true, value: JSON.parse(r.result) }; } catch { return { ok: true, value: r.result }; }
}

export const tools = [
    {
        name: 'list_actions',
        description: 'List the action sets and their actions in the Actions panel (Window > Actions), as Illustrator stores them in its preferences. A set loaded or changed since Illustrator last stored its preferences may not show yet. With filePath, describe an .aia file instead: its set, actions and numbered steps (with each step\'s on/off and dialog settings), without loading it',
        inputSchema: {
            type: 'object',
            properties: { filePath: { type: 'string', description: 'Absolute .aia path to describe instead of the panel' } },
        },
        hints: { readOnly: true },
        auditArgs: { filePath: undefined },
        features: ['illustrator.automation.actions_panel', 'illustrator.automation.action_object'],
        handler: async (a) => {
            if (a.filePath !== undefined) return formatResponse(describeActions(readAiaFile(a.filePath).file), 'List actions');
            return run('List actions', script(`${SETS_FN}
__result__ = { sets: __actionSets() };`, { needsDocument: false }));
        },
    },
    {
        name: 'play_action',
        description: 'Play an action from a loaded set (Actions panel > Play Current Selection). The action acts on the active document and its selection; give target to select items first. Steps run without their dialogs; recorded values are used. The result is the document and selection afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'Action name, exactly as in the Actions panel' },
                set: { type: 'string', description: 'Name of the set that holds it' },
                target: { ...TARGET_SCHEMA, description: 'Select these items first' },
            },
            required: ['action', 'set'],
        },
        hints: { destructive: true },
        features: ['illustrator.automation.play_action', 'illustrator.automation.action_object', 'illustrator.automation.actions_control.play_current_selection'],
        handler: (a) => {
            const action = actionName(a.action, 'action');
            const set = actionName(a.set, 'set');
            return run('Play action', script(`
${a.target ? `var doc = __doc(), items = __targets(doc, ${targetSpec(a.target)}); doc.selection = null; for (var i = 0; i < items.length; i++) items[i].selected = true;` : ''}
app.doScript(${str(action)}, ${str(set)}, false);
var out = { action: ${str(action)}, set: ${str(set)}, document: null };
if (app.documents.length) {
  var d = app.activeDocument, sel = d.selection, info = [];
  if (sel && sel.length) for (var j = 0; j < sel.length && j < 50; j++) { try { info.push(__itemInfo(d, sel[j])); } catch (e) { info.push({ type: sel[j].typename }); } }
  out.document = d.name; out.items = d.pageItems.length; out.selection = info;
}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'load_actions',
        description: 'Load an action set from an .aia file (Actions panel > Load Actions, or Replace Actions with replace: "all"). Before loading, the file can be edited: load the set under a new name, rename actions (Action Options), remove actions or steps, switch steps on or off (Toggle Item On/Off) and their dialogs (Toggle Dialog On/Off). Step numbers come from list_actions with filePath. The file on disk is not changed; saveAs writes the edited set to a new .aia file. Function keys and colours are not changed',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .aia path' },
                setName: { type: 'string', description: 'Load the set under this name instead of the one in the file' },
                actions: {
                    type: 'array',
                    description: 'Edits to actions in the file, by name',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Action name in the file' },
                            rename: { type: 'string', description: 'New name' },
                            remove: { type: 'boolean', description: 'Leave this action out' },
                            steps: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        step: { type: 'integer', minimum: 1, description: 'Step number, 1 = first' },
                                        ...STEP_FLAGS,
                                        remove: { type: 'boolean', description: 'Leave this step out' },
                                    },
                                    required: ['step'],
                                },
                            },
                        },
                        required: ['name'],
                    },
                },
                replace: REPLACE_SCHEMA,
                saveAs: { type: 'string', description: 'Also write the edited set to this .aia path' },
                load: { type: 'boolean', description: 'Load it into Illustrator. Default true; false with saveAs only writes the file', default: true },
            },
            required: ['filePath'],
        },
        hints: { destructive: true },
        auditArgs: { filePath: path.join(FIXTURES, 'sample.aia'), setName: 'Audit', actions: [{ name: 'Outline', steps: [{ step: 1, enabled: false }] }], saveAs: undefined },
        features: [
            'illustrator.automation.load_action',
            'illustrator.automation.actions_menu.replace_actions',
            'illustrator.automation.actions_menu.action_options',
            'illustrator.automation.actions_control.create_new_set',
            'illustrator.automation.actions_control.toggle_item_on_off',
            'illustrator.automation.actions_control.toggle_dialog_on_off',
            'illustrator.automation.actions_control.delete_selection',
            'illustrator.automation.action_exclude_commands',
            'illustrator.automation.action_manage_sets',
        ],
        handler: async (a) => {
            const { file } = readAiaFile(a.filePath);
            if (a.actions !== undefined && !Array.isArray(a.actions)) throw new Error("'actions' must be a list of { name, rename, remove, steps }");
            const text = editActions(file, { setName: a.setName, actions: a.actions ?? [] });
            return loadOrSave('Load actions', text, a);
        },
    },
    {
        name: 'create_action_set',
        description: 'Create an action set with new actions (Actions panel > Create New Set, Create New Action) from steps recorded in saved .aia files: each new action lists the steps it copies, as a whole saved action or one numbered step of it, and can switch each step or its dialog on or off. Then load the set, save it as an .aia file, or both. Steps cannot be recorded here; record them in Illustrator and save the set first',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Set name' },
                actions: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Action name' },
                            steps: {
                                type: 'array',
                                minItems: 1,
                                description: 'Steps in playback order',
                                items: {
                                    type: 'object',
                                    properties: {
                                        filePath: { type: 'string', description: 'Absolute .aia path holding the recorded action' },
                                        action: { type: 'string', description: 'Action name in that file' },
                                        step: { type: 'integer', minimum: 1, description: 'One step of it, 1 = first. Default every step' },
                                        ...STEP_FLAGS,
                                    },
                                    required: ['filePath', 'action'],
                                },
                            },
                        },
                        required: ['name', 'steps'],
                    },
                },
                replace: REPLACE_SCHEMA,
                saveAs: { type: 'string', description: 'Write the set to this .aia path' },
                load: { type: 'boolean', description: 'Load it into Illustrator. Default true', default: true },
            },
            required: ['name', 'actions'],
        },
        hints: { destructive: true },
        auditArgs: {
            name: 'Audit set',
            actions: [{ name: 'Outline twice', steps: [{ filePath: path.join(FIXTURES, 'sample.aia'), action: 'Outline' }, { filePath: path.join(FIXTURES, 'sample.aia'), action: 'Rotate', step: 1, showDialog: false }] }],
            saveAs: undefined,
        },
        features: [
            'illustrator.automation.actions_control.create_new_action',
            'illustrator.automation.actions_control.create_new_set',
            'illustrator.automation.actions_control.toggle_item_on_off',
            'illustrator.automation.actions_control.toggle_dialog_on_off',
            'illustrator.automation.action_manage_sets',
        ],
        handler: async (a) => {
            if (!Array.isArray(a.actions) || !a.actions.length) throw new Error("'actions' must list at least one action: { name, steps: [{ filePath, action, step }] }");
            const files = new Map();
            const specs = a.actions.map((act, i) => {
                if (!act || typeof act.name !== 'string') throw new Error(`actions[${i}] needs a name`);
                if (!Array.isArray(act.steps) || !act.steps.length) throw new Error(`actions[${i}].steps must list at least one step: { filePath, action, step }`);
                return {
                    name: act.name,
                    steps: act.steps.map((s, j) => {
                        const label = `actions[${i}].steps[${j}]`;
                        if (!s || typeof s !== 'object') throw new Error(`${label} must be { filePath, action, step }`);
                        if (!files.has(s.filePath)) files.set(s.filePath, readAiaFile(s.filePath, `${label}.filePath`));
                        if (s.step !== undefined && !(Number.isInteger(s.step) && s.step >= 1)) throw new Error(`${label}.step must be a whole number from 1`);
                        const { file, path: p } = files.get(s.filePath);
                        return { file, filePath: p, action: actionName(s.action, `${label}.action`), step: s.step, enabled: s.enabled, showDialog: s.showDialog };
                    }),
                };
            });
            const names = new Set();
            for (const s of specs) {
                if (names.has(s.name)) throw new Error(`Two actions are named ${JSON.stringify(s.name)}`);
                names.add(s.name);
            }
            const built = composeActions(a.name, specs);
            const parsed = readActions(built.text);
            const flagEdits = parsed.actions.map((act, i) => ({
                name: act.name,
                steps: built.sources[i]
                    .map((spec, k) => ({ step: k + 1, enabled: spec.enabled, showDialog: spec.showDialog }))
                    .filter((s) => s.enabled !== undefined || s.showDialog !== undefined),
            })).filter((e) => e.steps.length);
            const text = flagEdits.length ? editActions(parsed, { actions: flagEdits }) : built.text;
            return loadOrSave('Create action set', text, a);
        },
    },
    {
        name: 'unload_actions',
        description: 'Remove action sets or actions from the Actions panel (Delete Selection), or every set (Clear Actions). Removed sets are gone from the panel; save them first if they are not in a file. all: true removes the sets list_actions reports',
        inputSchema: {
            type: 'object',
            properties: {
                set: { type: 'string', description: 'Set name' },
                actions: { type: 'array', items: { type: 'string' }, description: 'Actions in that set to remove. Default the whole set' },
                all: { type: 'boolean', description: 'Remove every set (Clear Actions)' },
            },
        },
        hints: { destructive: true },
        auditArgs: { all: undefined },
        features: [
            'illustrator.automation.unload_action',
            'illustrator.automation.actions_control.delete_selection',
            'illustrator.automation.actions_menu.clear_actions',
            'illustrator.automation.action_manage_sets',
        ],
        handler: (a) => {
            if (a.all) {
                if (a.set !== undefined || a.actions !== undefined) throw new Error('Give set (and actions), or all: true, not both');
                return run('Unload actions', script(`${SETS_FN}
var sets = __actionSets(), done = [], failed = [];
for (var i = 0; i < sets.length; i++) {
  try { app.unloadAction(sets[i].name, ""); done.push(sets[i].name); } catch (e) { failed.push({ set: sets[i].name, error: e.message }); }
}
__result__ = { unloadedSets: done, failed: failed };`, { needsDocument: false }));
            }
            const set = actionName(a.set, 'set');
            if (a.actions !== undefined && (!Array.isArray(a.actions) || !a.actions.length)) throw new Error("'actions' must list at least one action name, or be left out to remove the whole set");
            const names = (a.actions ?? []).map((n, i) => actionName(n, `actions[${i}]`));
            return run('Unload actions', script(names.length ? `
var names = ${json(names)}, done = [], failed = [];
for (var i = 0; i < names.length; i++) {
  try { app.unloadAction(${str(set)}, names[i]); done.push(names[i]); } catch (e) { failed.push({ action: names[i], error: e.message }); }
}
__result__ = { set: ${str(set)}, unloadedActions: done, failed: failed };` : `
app.unloadAction(${str(set)}, "");
__result__ = { unloadedSets: [${str(set)}] };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_batch',
        description: 'Play an action on every file in a folder, or on every data set of the active document, and save the results (does what Actions panel > Batch does, by script). Folder: each .ai, .pdf, .eps or .svg file is opened, the action played, and the file left open (destination none), saved in place and closed (save_and_close), or saved as an .ai copy in destinationFolder and closed (folder; subfolders are recreated). Files already open are skipped with an error. Data sets: each data set is displayed, the action played, and with destination folder the document saved as an .ai file named by fileNaming; the document then refers to the last file saved. Save and Export steps inside the action still run as recorded. Each file runs as its own call, so a long batch does not time out',
        inputSchema: {
            type: 'object',
            properties: {
                set: { type: 'string', description: 'Action set name (Batch > Set)' },
                action: { type: 'string', description: 'Action name (Batch > Action)' },
                source: { type: 'string', enum: ['folder', 'data_sets'], description: 'Batch > Source. Default folder' },
                sourceFolder: { type: 'string', description: 'Absolute folder path, for source folder' },
                includeSubfolders: { type: 'boolean', description: 'Include All Subdirectories. Default false', default: false },
                fileTypes: { type: 'array', items: { type: 'string', enum: BATCH_TYPES }, description: 'File extensions to open. Default ai, pdf, eps and svg' },
                destination: { type: 'string', enum: DESTINATIONS, description: 'Batch > Destination: none (leave open), save_and_close, folder. Default none' },
                destinationFolder: { type: 'string', description: 'Absolute folder path, for destination folder' },
                fileNaming: { type: 'string', enum: NAMING, description: 'Data sets to a folder: file_number (document name + 001), file_data_set (document name_data set name, default), data_set (data set name)' },
                onError: { type: 'string', enum: ['stop', 'continue'], description: 'stop at the first error (default) or carry on and list the errors' },
                maxFiles: { type: 'integer', minimum: 1, maximum: 1000, description: 'Refuse a folder with more matching files than this. Default 200' },
            },
            required: ['set', 'action'],
        },
        hints: { destructive: true },
        auditArgs: { sourceFolder: path.join(FIXTURES, 'batch'), fileTypes: BATCH_TYPES, destination: 'save_and_close', destinationFolder: undefined, fileNaming: undefined },
        features: [
            'illustrator.automation.batch',
            'illustrator.automation.batch_option.set_batch',
            'illustrator.automation.batch_option.action_batch',
            'illustrator.automation.batch_option.source',
            'illustrator.automation.batch_option.destination',
            'illustrator.automation.batch_option.include_all_subdirectories',
            'illustrator.automation.merge_data',
        ],
        handler: async (a) => {
            const action = actionName(a.action, 'action');
            const set = actionName(a.set, 'set');
            const source = enumOf(a.source ?? 'folder', ['folder', 'data_sets'], { name: 'source' });
            const destination = enumOf(a.destination ?? 'none', DESTINATIONS, { name: 'destination' });
            const onError = enumOf(a.onError ?? 'stop', ['stop', 'continue'], { name: 'onError' });
            if (destination === 'folder' && !a.destinationFolder) throw new Error("destination folder needs destinationFolder");
            if (destination !== 'folder' && a.destinationFolder !== undefined) throw new Error("destinationFolder applies to destination: \"folder\"");
            const outDir = destination === 'folder' ? paths.validate(a.destinationFolder) : null;
            const play = `app.doScript(${str(action)}, ${str(set)}, false);`;
            const processed = [];
            const errors = [];
            const report = (extra) => ({ action, set, source, destination, processed, errors, ...extra });
            const stopped = (what, error) => {
                errors.push({ [source === 'folder' ? 'file' : 'dataSet']: what, error });
                return onError === 'stop';
            };

            if (source === 'data_sets') {
                if (a.sourceFolder !== undefined || a.includeSubfolders || a.fileTypes !== undefined) throw new Error('sourceFolder, includeSubfolders and fileTypes apply to source: "folder"');
                if (destination === 'save_and_close') throw new Error('Data sets go to destination none or folder');
                const naming = enumOf(a.fileNaming ?? 'file_data_set', NAMING, { name: 'fileNaming' });
                const info = await batchStep(script(`
var names = [];
for (var i = 0; i < doc.dataSets.length; i++) names.push(doc.dataSets[i].name);
__result__ = { names: names, base: doc.name.replace(/\\.[^.]*$/, "") };`));
                if (!info.ok) return formatErrorResponse(info.error, 'Batch');
                const names = info.value?.names ?? [];
                if (!names.length) return formatErrorResponse('The active document has no data sets', 'Batch');
                for (const [i, name] of names.entries()) {
                    let out = null;
                    if (outDir) {
                        const base = safeName(info.value.base);
                        const stem = { file_number: `${base}${String(i + 1).padStart(3, '0')}`, file_data_set: `${base}_${safeName(name)}`, data_set: safeName(name) }[naming];
                        out = paths.validate(path.join(outDir, `${stem}.ai`));
                        mkdirSync(outDir, { recursive: true });
                    }
                    const r = await batchStep(script(`
if (doc.dataSets.length <= ${i} || doc.dataSets[${i}].name !== ${str(name)}) throw new Error("The document's data sets changed during the batch");
doc.dataSets[${i}].display();
${play}
${out ? `var out = new File(${jsxPath(out)}); doc.saveAs(out, new IllustratorSaveOptions());` : ''}
__result__ = { dataSet: ${str(name)}, saved: ${out ? 'out.fsName' : 'null'} };`));
                    if (r.ok) processed.push(r.value);
                    else if (stopped(name, r.error)) return formatErrorResponse(report({ stoppedAt: name }), 'Batch');
                }
                return formatResponse(report(), 'Batch');
            }

            if (a.fileNaming !== undefined) throw new Error('fileNaming applies to source: "data_sets"');
            const folder = paths.validate(a.sourceFolder);
            const types = (a.fileTypes ?? BATCH_TYPES).map((t) => enumOf(t, BATCH_TYPES, { name: 'fileTypes' }));
            const max = a.maxFiles ?? 200;
            if (!Number.isInteger(max) || max < 1 || max > 1000) throw new Error("'maxFiles' must be 1 to 1000");
            const files = listFiles(folder, types, Boolean(a.includeSubfolders));
            if (!files.length) return formatErrorResponse(`No ${types.join(', ')} files in ${folder}${a.includeSubfolders ? ' or its subfolders' : ''}`, 'Batch');
            if (files.length > max) throw new Error(`${files.length} files match; raise maxFiles (up to 1000) or narrow the folder`);
            for (const file of files) {
                const src = paths.validate(file);
                let out = null;
                if (outDir) {
                    const rel = path.relative(folder, path.dirname(src));
                    out = paths.validate(path.join(outDir, rel, `${path.basename(src, path.extname(src))}.ai`));
                    if (out === src) {
                        if (stopped(src, 'The destination would overwrite the source file; use save_and_close or another folder')) return formatErrorResponse(report({ stoppedAt: src }), 'Batch');
                        continue;
                    }
                    mkdirSync(path.dirname(out), { recursive: true });
                }
                const r = await batchStep(script(`
var f = new File(${jsxPath(src)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
for (var i = 0; i < app.documents.length; i++) {
  var open = null;
  try { open = app.documents[i].fullName.fsName; } catch (e) { open = null; }
  if (open === f.fsName) throw new Error("Already open in Illustrator; save and close it first");
}
var d = app.open(f), saved = null;
try {
  ${play}
${destination === 'save_and_close' ? '  d.save(); saved = f.fsName;' : ''}
${out ? `  var out = new File(${jsxPath(out)}); d.saveAs(out, new IllustratorSaveOptions()); saved = out.fsName;` : ''}
} finally {
  ${destination === 'none' ? '' : 'd.close(SaveOptions.DONOTSAVECHANGES);'}
}
__result__ = { file: ${str(src)}, saved: saved };`, { needsDocument: false }));
                if (r.ok) processed.push(r.value);
                else if (stopped(src, r.error)) return formatErrorResponse(report({ stoppedAt: src }), 'Batch');
            }
            return formatResponse(report({ files: files.length }), 'Batch');
        },
    },
    {
        name: 'run_script_file',
        description: 'Run a script file (File > Scripts > Other Script, or a script installed in File > Scripts given by its path): .jsx, .js or .jsxbin. Like execute_illustrator_code it runs unrestricted: it can change or delete anything and read or write files. The coordinate system is left as the script expects; Illustrator\'s own alerts are suppressed while it runs. A script that opens its own dialog waits for the user. Returns the script\'s last value as text. The file must be inside the allowed folders (add Illustrator\'s Scripts folder to ILLUSTRATOR_ALLOWED_DIRS to run installed scripts)',
        inputSchema: {
            type: 'object',
            properties: { filePath: { type: 'string', description: 'Absolute .jsx, .js or .jsxbin path' } },
            required: ['filePath'],
        },
        hints: { destructive: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.jsx') },
        features: ['illustrator.automation.other_script', 'illustrator.automation.scripts_menu'],
        handler: async (a) => {
            const p = filePath(a.filePath, 'filePath', SCRIPT_TYPES);
            const r = await executor.runStructured(`
var __mcpUI = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  var __mcpFile = new File(${jsxPath(p)});
  if (!__mcpFile.exists) throw new Error("File not found: " + __mcpFile.fsName);
  var __mcpValue = $.evalFile(__mcpFile);
  __result__ = __mcpValue === undefined || __mcpValue === null ? "" : String(__mcpValue);
} finally {
  app.userInteractionLevel = __mcpUI;
}`);
            return r.ok ? formatResponse({ file: p, result: r.result }, 'Run script file') : formatErrorResponse(r.error, 'Run script file');
        },
    },
    {
        name: 'import_csv_data',
        description: 'Import a CSV data source into data sets (Variables panel > Import, data merge): the first row names the fields, prefixed @ for an image variable (absolute file paths) and # for a visibility variable (true or false); other fields are text. Fields are separated by commas or tabs. Each row becomes a data set; a row that names an existing data set updates it. Each field must match a variable already bound to artwork (create_variable); graph (%) fields are not supported. Use show_data_set to preview and run_batch or export_data_sets for the output',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .csv or .txt path, UTF-8' },
                nameColumn: { type: 'string', description: 'A column whose values name the data sets (not a variable). Default Row 1, Row 2, ...' },
                show: { type: 'string', description: 'Data set to display afterwards. Default the first row' },
            },
            required: ['filePath'],
        },
        auditArgs: { filePath: path.join(FIXTURES, 'data.csv'), nameColumn: 'name', show: undefined },
        features: ['illustrator.automation.data_source_files', 'illustrator.automation.merge_data'],
        handler: async (a) => {
            const p = filePath(a.filePath, 'filePath', ['.csv', '.txt']);
            let size;
            try { size = statSync(p).size; } catch { throw new Error(`File not found: ${p}`); }
            if (size > MAX_CSV_BYTES) throw new Error(`${p} is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB`);
            if (a.nameColumn !== undefined && (typeof a.nameColumn !== 'string' || !a.nameColumn)) throw new Error("'nameColumn' must be a column name");
            const records = csvRecords(readFileSync(p, 'utf8'), a.nameColumn);
            return variableTools.find((t) => t.name === 'create_data_sets').handler({ records, show: a.show });
        },
    },
    {
        name: 'get_item_data',
        description: 'Read items\' tags (name-value labels scripts attach to artwork) and notes (Attributes panel > Note). Without target, lists every item in the document that has a tag or a note',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'Most items to return. Default 1000' },
            },
        },
        hints: { readOnly: true },
        features: ['illustrator.automation.tags', 'illustrator.automation.object_note'],
        handler: (a) => {
            const limit = a.limit ?? 1000;
            if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("'limit' must be 1 to 5000");
            return run('Get item data', script(`
var all = ${a.target ? `__targets(doc, ${targetSpec(a.target)})` : 'doc.pageItems'}, out = [], more = false;
for (var i = 0; i < all.length; i++) {
  var it = all[i], tags = {}, n = 0, note = "";
  try { note = it.note; } catch (e) { note = ""; }
  for (var t = 0; t < it.tags.length; t++) { tags[it.tags[t].name] = it.tags[t].value; n++; }
  if (${a.target ? 'false' : 'true'} && !n && !note) continue;
  if (out.length >= ${limit}) { more = true; break; }
  var info = __itemInfo(doc, it);
  info.note = note; info.tags = tags;
  out.push(info);
}
__result__ = { items: out, truncated: more };`));
        },
    },
    {
        name: 'set_item_data',
        description: 'Set items\' tags (name-value labels scripts attach to artwork; not shown in Illustrator\'s panels) and note (Attributes panel > Note). tags maps names to text values; null removes a tag. Tag names use letters, digits and underscores',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                tags: { type: 'object', description: 'Tag name to value (text), or null to remove that tag', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
                clearTags: { type: 'boolean', description: 'Remove every existing tag first. Default false', default: false },
                note: { type: 'string', description: 'The note; "" clears it' },
            },
            required: ['target'],
        },
        hints: { idempotent: true },
        auditArgs: { tags: { sku: 'A-100', draft: null } },
        features: ['illustrator.automation.tags', 'illustrator.automation.object_note'],
        handler: (a) => {
            const tags = a.tags ?? {};
            if (typeof tags !== 'object' || Array.isArray(tags)) throw new Error("'tags' must be an object of tag name to value");
            const entries = Object.entries(tags).map(([k, v]) => {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(k)) throw new Error(`Tag name ${JSON.stringify(k)}: use letters, digits and underscores, starting with a letter or underscore`);
                if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new Error(`Tag ${k}: give text, or null to remove it`);
                return { name: k, value: v === null ? null : String(v) };
            });
            if (a.note !== undefined && typeof a.note !== 'string') throw new Error("'note' must be text");
            if (!entries.length && !a.clearTags && a.note === undefined) throw new Error('Nothing to set: give tags, clearTags or note');
            return run('Set item data', script(`
var items = __targets(doc, ${targetSpec(a.target)}), tags = ${json(entries)}, out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${a.clearTags ? 'if (it.tags.length) it.tags.removeAll();' : ''}
  for (var k = 0; k < tags.length; k++) {
    var tag = null;
    try { tag = it.tags.getByName(tags[k].name); } catch (e) { tag = null; }
    if (tags[k].value === null) { if (tag) tag.remove(); continue; }
    if (!tag) { tag = it.tags.add(); tag.name = tags[k].name; }
    tag.value = tags[k].value;
  }
  ${a.note !== undefined ? `it.note = ${str(a.note)};` : ''}
  var now = {};
  for (var t = 0; t < it.tags.length; t++) now[it.tags[t].name] = it.tags[t].value;
  var info = __itemInfo(doc, it);
  info.note = it.note; info.tags = now;
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
];
