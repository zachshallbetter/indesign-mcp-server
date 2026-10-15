/**
 * The application: purge caches, Edit menu commands (undo, redo, clipboard,
 * selection), application and system information, memory and GPU settings,
 * documented preferences, saved script settings, and quitting.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, compSpec } from '../args.js';

/** Edit > Purge targets: an Application.purge target, or a menu command id where scripting has none. */
const PURGE = {
    all_memory_and_disk: { target: 'ALL_CACHES' },
    all_memory: { target: 'ALL_MEMORY_CACHES', fallback: 2373 },
    undo: { target: 'UNDO_CACHES' },
    image_cache_memory: { target: 'IMAGE_CACHES' },
    snapshot: { target: 'SNAPSHOT_CACHES' },
    all_disk_cache: { command: 10700 },
    all_3d_cache: { command: 10701 },
    all_cache: { command: 10702 },
};

/** Edit menu commands and their ids. */
const EDIT = { undo: 16, redo: 2035, cut: 18, copy: 19, paste: 20, select_all: 23, deselect_all: 2004, select_label_group: 2436 };

/** Preference files (PREFType); the default is the machine-specific file. */
const PREF_FILES = {
    machine_specific: 'PREF_Type_MACHINE_SPECIFIC',
    machine_independent: 'PREF_Type_MACHINE_INDEPENDENT',
    composition: 'PREF_Type_MACHINE_INDEPENDENT_COMPOSITION',
    output: 'PREF_Type_MACHINE_INDEPENDENT_OUTPUT',
    render: 'PREF_Type_MACHINE_INDEPENDENT_RENDER',
    paint: 'PREF_Type_MACHINE_SPECIFIC_PAINT',
    text: 'PREF_Type_MACHINE_SPECIFIC_TEXT',
};
const PREF_TYPES = { bool: 'Bool', long: 'Long', float: 'Float', string: 'String' };

/** The preference keys the scripting guide documents, which set_application_settings may write. */
const DOCUMENTED_PREFS = {
    expandFlowchartComps: { section: 'Flowchart Settings', key: 'Expand Flowchart Comps by Default', file: 'PREF_Type_MACHINE_SPECIFIC' },
    javascriptDebugger: { section: 'Main Pref Section v2', key: 'Pref_JAVASCRIPT_DEBUGGER', file: 'PREF_Type_MACHINE_INDEPENDENT' },
};

const GPU = { metal: 'METAL', cuda: 'CUDA', opencl: 'OPENCL', vulkan: 'VULKAN', software: 'SOFTWARE' };

const PREF_FILE_SCHEMA = { type: 'string', enum: Object.keys(PREF_FILES), description: 'Preference file (PREFType). Default machine_specific, the "Prefs.txt" file' };

/** ES3 statements that make composition `c`'s viewer the focused panel. */
const FOCUS_COMP = 'var vw = c.openInViewer(); if (vw) vw.setActive();';

export const tools = [
    {
        name: 'purge_caches',
        description: 'Free memory or disk cache (Edit > Purge): all memory and disk cache, all memory, undo history, image cache memory, snapshots, all disk cache, all 3D cache, or all cache. Purging undo means earlier steps can no longer be undone',
        inputSchema: {
            type: 'object',
            properties: {
                targets: { type: 'array', items: { type: 'string', enum: Object.keys(PURGE) }, minItems: 1, maxItems: 8, description: 'What to purge, in order' },
            },
            required: ['targets'],
        },
        auditArgs: { targets: ['all_memory', 'undo', 'all_disk_cache'] },
        hints: { destructive: true, idempotent: true },
        features: [
            'aftereffects.application.purge_menu',
            'aftereffects.application.purge_all_memory_disk_cache',
            'aftereffects.application.purge_all_memory',
            'aftereffects.application.purge_all_cache',
            'aftereffects.application.purge_all_disk_cache',
            'aftereffects.application.purge_all_3d_cache',
            'aftereffects.application.purge_undo',
            'aftereffects.application.purge_image_cache_memory',
            'aftereffects.application.purge_snapshot',
            'aftereffects.application.empty_disk_cache',
        ],
        handler: (a) => {
            if (!Array.isArray(a.targets) || !a.targets.length) throw new Error("'targets' must list at least one cache");
            const lines = a.targets.map((t, i) => {
                const p = PURGE[enumOf(t, Object.keys(PURGE), { name: `targets[${i}]` })];
                if (p.command) return `app.executeCommand(${p.command}); done.push(${str(t)});`;
                if (p.fallback) return `if (PurgeTarget.${p.target} !== undefined) app.purge(PurgeTarget.${p.target}); else app.executeCommand(${p.fallback}); done.push(${str(t)});`;
                return `app.purge(PurgeTarget.${p.target}); done.push(${str(t)});`;
            });
            return run('Purge', script(`
var before = app.memoryInUse, done = [];
${lines.join('\n')}
__result__ = { purged: done, memoryInUseBefore: before, memoryInUseAfter: app.memoryInUse };`));
        },
    },
    {
        name: 'run_edit_command',
        description: 'Run an Edit menu command: Undo or Redo (several steps back or forward through Edit > History), Cut, Copy, Paste, Select All, Deselect All, or Select Label Group. They act on the focused panel and its selection; give comp to focus that composition first. Copied layers can be pasted into Premiere Pro',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(EDIT), description: 'The Edit menu command' },
                times: { type: 'integer', minimum: 1, maximum: 100, description: 'Undo or Redo: how many steps. Default 1', default: 1 },
                comp: { ...COMP_SCHEMA, description: 'Focus this composition\'s viewer first (item id or name). Omit to act on whatever panel has focus' },
            },
            required: ['command'],
        },
        auditArgs: { command: 'undo', times: 2, comp: { id: 1 } },
        hints: { destructive: true },
        features: [
            'aftereffects.application.undo',
            'aftereffects.application.redo',
            'aftereffects.application.history',
            'aftereffects.application.cut',
            'aftereffects.application.copy',
            'aftereffects.application.paste',
            'aftereffects.application.select_all',
            'aftereffects.application.deselect_all',
            'aftereffects.application.select_label_group',
            'aftereffects.collaboration.copy_paste_with_premiere',
        ],
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(EDIT), { name: 'command' });
            const times = a.times === undefined ? 1 : Number(index(a.times, { name: 'times', max: 100 }));
            if (times < 1) throw new Error("'times' must be at least 1");
            if (times > 1 && command !== 'undo' && command !== 'redo') throw new Error("'times' applies only to undo and redo");
            // No undo group here: Undo and Redo must not be wrapped in one.
            return run('Edit command', script(`
${a.comp !== undefined ? `var c = __comp(${compSpec(a.comp)}); ${FOCUS_COMP}` : ''}
for (var n = 0; n < ${times}; n++) app.executeCommand(${EDIT[command]});
__result__ = { command: ${str(command)}, times: ${times}, dirty: proj.dirty };`));
        },
    },
    {
        name: 'get_aftereffects_info',
        description: 'Describe the running After Effects and the computer: version, build, language, memory in use, render-engine and watch-folder modes, operating system, the project\'s GPU acceleration (File > Project Settings) and the types available, whether viewer updates are paused, and the values of preference keys you name',
        inputSchema: {
            type: 'object',
            properties: {
                preferences: {
                    type: 'array',
                    maxItems: 50,
                    description: 'Preference keys to read from the preferences files',
                    items: {
                        type: 'object',
                        properties: {
                            section: { type: 'string', description: 'Section name, e.g. "Main Pref Section v2"' },
                            key: { type: 'string', description: 'Key name, e.g. "Pref_JAVASCRIPT_DEBUGGER"' },
                            type: { type: 'string', enum: Object.keys(PREF_TYPES), description: 'How to read the value. Default string' },
                            file: PREF_FILE_SCHEMA,
                        },
                        required: ['section', 'key'],
                    },
                },
            },
        },
        auditArgs: { preferences: [{ section: 'Main Pref Section v2', key: 'Pref_JAVASCRIPT_DEBUGGER', type: 'bool', file: 'machine_independent' }] },
        hints: { readOnly: true },
        features: ['aftereffects.application.system_object', 'aftereffects.application.preferences_object'],
        handler: (a) => {
            const prefs = (a.preferences ?? []).map((p, i) => {
                if (!p || typeof p !== 'object' || !p.section || !p.key) throw new Error(`preferences[${i}] needs section and key`);
                const type = PREF_TYPES[enumOf(p.type ?? 'string', Object.keys(PREF_TYPES), { name: `preferences[${i}].type` })];
                const file = PREF_FILES[enumOf(p.file ?? 'machine_specific', Object.keys(PREF_FILES), { name: `preferences[${i}].file` })];
                return `prefs.push(__readPref(${str(p.section)}, ${str(p.key)}, PREFType.${file}, function (s, k, f) { return app.preferences.getPrefAs${type}(s, k, f); }));`;
            });
            return run('After Effects info', script(`
var prefs = [];
var __readPref = function (s, k, f, read) {
  var r = { section: s, key: k, exists: app.preferences.havePref(s, k, f), value: null };
  if (r.exists) r.value = read(s, k, f);
  return r;
};
${prefs.join('\n')}
var gpu = [], av = app.availableGPUAccelTypes;
try { for (var i = 0; i < av.length; i++) gpu.push(__enumName(av[i])); } catch (e) {}
__result__ = { version: app.version, buildName: app.buildName, buildNumber: app.buildNumber, isoLanguage: app.isoLanguage,
  memoryInUse: app.memoryInUse, isRenderEngine: app.isRenderEngine, isWatchFolder: app.isWatchFolder, disableRendering: app.disableRendering,
  system: { osName: system.osName, osVersion: system.osVersion, machineName: system.machineName, userName: system.userName },
  gpuAcceleration: { project: __enumName(proj.gpuAccelType), available: gpu }, preferences: prefs };`));
        },
    },
    {
        name: 'set_application_settings',
        description: 'Change application and project performance settings: memory limits (Preferences > Memory & Performance), the project\'s Mercury GPU acceleration (File > Project Settings), whether preferences are saved on quit, and the preferences the scripting guide documents (expand flowchart compositions, JavaScript debugger)',
        inputSchema: {
            type: 'object',
            properties: {
                imageCachePercent: { type: 'number', minimum: 1, maximum: 100, description: 'Image cache size as a percent of memory; give with maximumMemoryPercent' },
                maximumMemoryPercent: { type: 'number', minimum: 1, maximum: 100, description: 'Maximum memory After Effects may use, as a percent of installed RAM; the rest stays reserved for other applications' },
                gpuAcceleration: { type: 'string', enum: Object.keys(GPU), description: 'Project GPU acceleration; must be one the computer offers (see get_aftereffects_info)' },
                savePreferencesOnQuit: { type: 'boolean', description: 'Save preferences when After Effects quits' },
                expandFlowchartComps: { type: 'boolean', description: 'Flowchart: expand compositions by default' },
                javascriptDebugger: { type: 'boolean', description: 'Scripting & Expressions: enable the JavaScript debugger' },
            },
        },
        auditArgs: { imageCachePercent: 50, maximumMemoryPercent: 80, gpuAcceleration: 'metal', savePreferencesOnQuit: true, expandFlowchartComps: true, javascriptDebugger: false },
        hints: { idempotent: true },
        features: [
            'aftereffects.application.memory_cpu_preferences',
            'aftereffects.application.ram_reserved_other_apps',
            'aftereffects.application.mercury_gpu_acceleration',
            'aftereffects.application.preferences_object',
        ],
        handler: (a) => {
            const L = [];
            if ((a.imageCachePercent === undefined) !== (a.maximumMemoryPercent === undefined)) throw new Error('Give imageCachePercent and maximumMemoryPercent together');
            if (a.imageCachePercent !== undefined) {
                L.push(`app.setMemoryUsageLimits(${num(a.imageCachePercent, { min: 1, max: 100, name: 'imageCachePercent' })}, ${num(a.maximumMemoryPercent, { min: 1, max: 100, name: 'maximumMemoryPercent' })}); done.memory = true;`);
            }
            if (a.gpuAcceleration !== undefined) {
                const g = GPU[enumOf(a.gpuAcceleration, Object.keys(GPU), { name: 'gpuAcceleration' })];
                L.push(`var want = GpuAccelType.${g}, av = app.availableGPUAccelTypes, ok = false, names = [];
for (var i = 0; i < av.length; i++) { names.push(__enumName(av[i])); if (av[i] === want) ok = true; }
if (!ok) throw new Error("GPU acceleration ${g} is not available here; available: " + names.join(", "));
proj.gpuAccelType = want; done.gpuAcceleration = __enumName(proj.gpuAccelType);`);
            }
            if (a.savePreferencesOnQuit !== undefined) L.push(`app.setSavePreferencesOnQuit(${bool(a.savePreferencesOnQuit)}); done.savePreferencesOnQuit = ${bool(a.savePreferencesOnQuit)};`);
            let prefs = false;
            for (const [k, p] of Object.entries(DOCUMENTED_PREFS)) {
                if (a[k] === undefined) continue;
                prefs = true;
                L.push(`app.preferences.savePrefAsBool(${str(p.section)}, ${str(p.key)}, ${bool(a[k])}, PREFType.${p.file}); done.${k} = ${bool(a[k])};`);
            }
            if (prefs) L.push('app.preferences.saveToDisk(); app.preferences.reload();');
            if (!L.length) throw new Error('Give at least one setting');
            return run('Application settings', script(`
var done = {};
${L.join('\n')}
__result__ = { set: done };`, { undo: 'Application settings' }));
        },
    },
    {
        name: 'manage_script_settings',
        description: 'Read, save or check a saved script setting (app.settings): text values kept in the After Effects preferences between sessions, under a section and key of your choosing. Values are stored as text, at most 1999 bytes',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'save', 'has'], description: 'get reads the value, save stores it, has checks it exists' },
                section: { type: 'string', description: 'Section name, e.g. your script\'s name' },
                key: { type: 'string', description: 'Key name' },
                value: { type: 'string', description: 'save: the text to store' },
                file: PREF_FILE_SCHEMA,
            },
            required: ['action', 'section', 'key'],
        },
        auditArgs: { action: 'save', value: 'on', file: 'machine_specific' },
        hints: { idempotent: true },
        features: ['aftereffects.application.settings_object', 'aftereffects.automation.script_settings'],
        handler: (a) => {
            const action = enumOf(a.action, ['get', 'save', 'has'], { name: 'action' });
            if (!a.section || !a.key) throw new Error('Give section and key');
            const file = `PREFType.${PREF_FILES[enumOf(a.file ?? 'machine_specific', Object.keys(PREF_FILES), { name: 'file' })]}`;
            let body;
            if (action === 'save') {
                if (typeof a.value !== 'string') throw new Error("save needs 'value' as text");
                if (Buffer.byteLength(a.value, 'utf8') > 1999) throw new Error("'value' is longer than 1999 bytes");
                body = `app.settings.saveSetting(s, k, ${str(a.value)}, ${file});`;
            } else {
                body = '';
            }
            return run('Script settings', script(`
var s = ${str(a.section)}, k = ${str(a.key)};
${body}
var has = app.settings.haveSetting(s, k, ${file});
__result__ = { section: s, key: k, exists: has${action === 'has' ? '' : `, value: has ? app.settings.getSetting(s, k, ${file}) : null`} };`));
        },
    },
    {
        name: 'quit_aftereffects',
        description: 'Quit After Effects (After Effects > Quit, or File > Exit on Windows). Unsaved changes are refused unless you choose to save or discard them. After Effects quits a moment after the call returns',
        inputSchema: {
            type: 'object',
            properties: {
                unsavedChanges: { type: 'string', enum: ['refuse', 'save', 'discard'], description: 'What to do if the project has unsaved changes: refuse (default, the call fails), save to its file, or discard', default: 'refuse' },
            },
        },
        auditArgs: { unsavedChanges: 'save' },
        hints: { destructive: true },
        features: ['aftereffects.application.quit'],
        handler: (a) => {
            const mode = enumOf(a.unsavedChanges ?? 'refuse', ['refuse', 'save', 'discard'], { name: 'unsavedChanges' });
            // Quit from a scheduled task so this script can return its result first.
            return run('Quit', script(`
var dirty = proj.dirty;
if (dirty) {
  ${mode === 'refuse' ? 'throw new Error("The project has unsaved changes: save it first, or pass unsavedChanges: save or discard");' : ''}
  ${mode === 'save' ? 'if (!proj.file) throw new Error("The project has never been saved: save it to a file first"); proj.save();' : ''}
}
proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);
app.scheduleTask("app.quit();", 500, false);
__result__ = { quitting: true, unsavedChanges: dirty ? ${str(mode)} : "none" };`));
        },
    },
];
