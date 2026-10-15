/**
 * Automation: the Scripts panel (list, run with arguments, reveal, delete),
 * script preferences, script labels, menu actions and localised key strings,
 * script menu actions and menus, event listeners (including print events),
 * idle tasks, any preference object, performance metrics, menu, shortcut and
 * workspace sets, the IDML schema and XML rules.
 *
 * Handlers that scripts attach (event listeners, idle tasks, script menu
 * actions) are script files, so they keep working after the tool returns.
 */
import { str, num, enumOf, json } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';
import { has, obj, int, flag, text, textList, pick, filePath } from './checks.js';

const SCRIPT_EXT = ['.jsx', '.js', '.jsxbin', '.idjs'];

/** Script helpers: the Scripts panel folders and a plain value for results. */
const AUTO_JSX = String.raw`
var __scriptRoots = function () {
  var roots = [], ver = "Version " + parseInt(app.version, 10) + ".0";
  var appPanel = Folder(app.scriptPreferences.scriptsFolder.fullName + "/Scripts Panel");
  if (appPanel.exists) roots.push(appPanel);
  var bases = [Folder(Folder.userData + "/Adobe/InDesign/" + ver), Folder("~/Library/Preferences/Adobe InDesign/" + ver)];
  for (var b = 0; b < bases.length; b++) {
    if (!bases[b].exists) continue;
    var locales = bases[b].getFiles();
    for (var i = 0; i < locales.length; i++) {
      var p = Folder(locales[i].fullName + "/Scripts/Scripts Panel");
      if (p.exists) roots.push(p);
    }
  }
  return roots;
};
var __plain = function (v) {
  var t = typeof v;
  if (v === null || t === "undefined" || t === "number" || t === "boolean" || t === "string") return v;
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length && i < 100; i++) a.push(__plain(v[i])); return a; }
  if (v instanceof File || v instanceof Folder) return v.fsName;
  try { if (v.hasOwnProperty("name") && typeof v.name === "string") return v.name; } catch (e) {}
  var s = String(v), n = __enumName(s);
  return /^[A-Z][A-Z0-9_]*$/.test(n) ? n : s;
};
`;

const autoScript = (body, opts) => script(AUTO_JSX + body, opts);

/** Events a listener can be attached to, by target. */
const APP_EVENTS = ['beforeOpen', 'afterOpen', 'beforeNew', 'afterNew', 'beforeSave', 'afterSave', 'beforeSaveAs', 'afterSaveAs', 'beforeSaveACopy', 'afterSaveACopy', 'beforeClose', 'afterClose', 'beforeRevert', 'afterRevert', 'beforePrint', 'afterPrint', 'beforeExport', 'afterExport', 'beforeImport', 'afterImport', 'beforePlace', 'afterPlace', 'beforeQuit', 'afterQuit', 'afterActivate', 'beforeDeactivate', 'afterSelectionChanged', 'afterSelectionAttributeChanged', 'afterContextChanged', 'afterLinksChanged', 'afterAttributeChanged', 'beforeUpdate', 'afterUpdate'];
const DOC_EVENTS = APP_EVENTS.filter((e) => !['beforeOpen', 'afterOpen', 'beforeNew', 'afterNew', 'beforeQuit', 'afterQuit'].includes(e));

const UNDO = { entire_script: 'UndoModes.ENTIRE_SCRIPT', fast_entire_script: 'UndoModes.FAST_ENTIRE_SCRIPT', script_request: 'UndoModes.SCRIPT_REQUEST', auto_undo: 'UndoModes.AUTO_UNDO' };
const INTERACTION = { interact_with_all: 'UserInteractionLevels.INTERACT_WITH_ALL', interact_with_alerts: 'UserInteractionLevels.INTERACT_WITH_ALERTS', never_interact: 'UserInteractionLevels.NEVER_INTERACT' };
const UNITS = ['points', 'picas', 'inches', 'inches_decimal', 'millimeters', 'centimeters', 'ciceros', 'agates', 'pixels', 'q', 'ha', 'american_points', 'bai', 'mils', 'u'];

const PERFORMANCE = ['AGMXSHOWTIME', 'ATTACHABLE_EVENT_COUNT', 'ATTACHED_SCRIPTS_COUNT', 'BIB_ALLOCATIONS', 'BIB_ALLOCATIONS_PEAK', 'BIB_CACHE', 'BIB_CACHE_PEAK', 'CHANGE_MANAGER_UPDATE_CALL_COUNT', 'CHANGE_MANAGER_UPDATE_CALL_TIME', 'CORE_ALLOCATION_COUNT', 'CORE_MEMORY_SIZE', 'CPU_TIME', 'CURRENT_MEMORY_MARK', 'DATABASE_FILE_BYTES_READ', 'DATABASE_FILE_BYTES_WRITTEN', 'DATABASE_FILE_PAGE_READS', 'DATABASE_FILE_READ_TIME', 'DATABASE_FILE_WRITE_TIME', 'DATABASE_INSTANTIATE_COUNT', 'DATABASE_NEW_UID_COUNT', 'DISPATCH_EVENT_TIME', 'DRAW_MANAGER_DRAW_TIME', 'DRAW_MANAGER_NUMBER_OF_INTERRUPTS', 'DROP_SHADOW_FILE_READ_BYTES', 'DROP_SHADOW_FILE_READ_TIME', 'DROP_SHADOW_FILE_WRITE_BYTES', 'DROP_SHADOW_FILE_WRITE_TIME', 'DROP_SHADOW_MEMORY_READ_BYTES', 'DROP_SHADOW_MEMORY_READ_TIME', 'DROP_SHADOW_MEMORY_WRITE_BYTES', 'DROP_SHADOW_MEMORY_WRITE_TIME', 'GALLEY_COMPOSITION_COUNT', 'GALLEY_COMPOSITION_TIME', 'GDI_OBJECT_COUNT', 'HANDLE_COUNT', 'HEAP_ALLOCATIONS', 'HEAP_ALLOCATIONS_PEAK', 'IMAGE_CACHE_ALLOCATIONS', 'IMAGE_CACHE_ALLOCATIONS_PEAK', 'IMAGE_CACHE_FILE_BYTES_READ', 'IMAGE_CACHE_FILE_BYTES_WRITTEN', 'IMAGE_CACHE_FILE_READ_TIME', 'IMAGE_CACHE_FILE_WRITE_TIME', 'INSTANCE_CACHE_PURGE_COUNT', 'LAYOUT_COMPOSITION_COUNT', 'LAYOUT_COMPOSITION_TIME', 'MEMORY_PURGE_COUNT', 'MEMORY_PURGE_TIME', 'MINISAVE_COUNT', 'NEW_SNAPSHOT_TIME', 'NUMBER_OF_THREADS', 'OVERALL_SYSTEM_CPU', 'OVERALL_USER_CPU', 'PDF_ALLOCACTIONS', 'PDF_ALLOCACTIONS_PEAK', 'PROCESS_IO_BYTES_READ', 'PROCESS_IO_BYTES_WRITTEN', 'RESIDENT_MEMORY_SIZE', 'SNAPSHOT_COUNT', 'SNAPSHOT_READ_WRITE_BYTE_COUNT', 'SNAPSHOT_READ_WRITE_TIME', 'VIRTUAL_MEMORY_SIZE', 'VXFERALLOC', 'VXFERALLOCPEAK', 'VXFERBYTESREAD', 'VXFERBYTESWRITTEN', 'VXFERFILEBYTESREAD', 'VXFERFILEBYTESWRITTEN', 'VXFERREADTIME', 'VXFERWRITETIME', 'XMP_FILTER_TIME'];
const DEFAULT_METRICS = ['CPU_TIME', 'RESIDENT_MEMORY_SIZE', 'VIRTUAL_MEMORY_SIZE', 'NUMBER_OF_THREADS', 'HANDLE_COUNT', 'LAYOUT_COMPOSITION_COUNT', 'LAYOUT_COMPOSITION_TIME', 'ATTACHED_SCRIPTS_COUNT'];

/** A script handler file: a .jsx, .js or .jsxbin the server's path policy allows. */
const handlerFile = (v, name) => filePath(v, name, ['.jsx', '.js', '.jsxbin']);

/** A preference or property name: letters and digits only. */
function ident(v, name) {
    const s = String(v ?? '');
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,80}$/.test(s)) throw new Error(`'${name}' must be a property name such as spellPreferences`);
    return s;
}

/** A preference value as script text: boolean, number, string, list, or { enum: "Enum.MEMBER" }. */
function prefValue(v, name) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return num(v, { name });
    if (typeof v === 'string') {
        if (v.length > 2000) throw new Error(`'${name}' is too long`);
        return str(v);
    }
    if (Array.isArray(v)) {
        if (v.length > 100) throw new Error(`'${name}' has too many entries`);
        return `[${v.map((x, i) => prefValue(x, `${name}[${i}]`)).join(', ')}]`;
    }
    if (v && typeof v === 'object' && Object.keys(v).length === 1 && typeof v.enum === 'string') {
        const m = /^([A-Z][A-Za-z0-9]{1,60})\.([A-Z][A-Z0-9_]{0,60})$/.exec(v.enum);
        if (!m) throw new Error(`'${name}.enum' must look like "UIColors.LIGHT_BLUE"`);
        return `__enum(${str(m[1])}, ${str(m[2])})`;
    }
    throw new Error(`'${name}' must be a boolean, number, string, list, or { enum: "Enum.MEMBER" }`);
}

export const tools = [
    {
        name: 'manage_scripts_panel',
        description: 'Work with the Scripts panel: list the application and user scripts (optionally with files the panel cannot run, Display Unsupported Files), run a script file (ExtendScript .jsx/.js/.jsxbin or UXP .idjs) with name/value script arguments and an undo mode, reveal a script in Finder or Explorer, or delete a script file listed in the panel (Window > Utilities > Scripts; panel menu Run Script, Reveal in Finder, Delete Script File)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'run', 'reveal', 'delete'], description: 'What to do' },
                includeUnsupported: { type: 'boolean', description: 'For list: also list files in the Scripts Panel folders that are not scripts', default: false },
                path: { type: 'string', description: 'For run, reveal and delete: the script file' },
                arguments: { type: 'object', description: 'For run: name/value pairs set in app.scriptArgs before the script runs; the values are also passed as the script\'s arguments, in order', additionalProperties: { type: 'string' } },
                undoMode: { type: 'string', enum: Object.keys(UNDO), description: 'For run: how the script\'s changes are undone (entire_script is a single undo step)', default: 'entire_script' },
                undoName: { type: 'string', description: 'For run: the name of the undo step' },
            },
            required: ['action'],
        },
        features: [
            'indesign.automation.scripts_panel',
            'indesign.automation.scripts_menu_run_script',
            'indesign.automation.scripts_menu_reveal_in_finder',
            'indesign.automation.scripts_menu_delete_script_file',
            'indesign.automation.scripts_menu_display_unsupported_files',
            'indesign.automation.context_reveal_script',
            'indesign.automation.uxp_scripts',
            'indesign.automation.script_args',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false, openWorld: true },
        auditArgs: { action: 'run', path: `${process.env.HOME ?? '/tmp'}/Documents/hello.jsx`, arguments: { name: 'value', size: '12' }, undoName: 'Hello' },
        handler: (a) => {
            const action = pick(a.action, { list: 'list', run: 'run', reveal: 'reveal', delete: 'delete' }, 'action');
            if (action === 'list') {
                const all = has(a.includeUnsupported) ? flag(a.includeUnsupported, 'includeUnsupported') : 'false';
                return run('List scripts', autoScript(String.raw`
var sp = app.scriptPreferences, list = sp.scriptsList, scripts = [], other = [];
for (var i = 0; i < list.length; i++) scripts.push({ name: list[i][0], path: list[i][1] });
if (${all}) {
  var known = /\.(jsx|js|jsxbin|idjs|scpt|applescript|vbs)$/i, roots = __scriptRoots();
  var walk = function (f, depth) {
    var items = f.getFiles();
    for (var k = 0; k < items.length && other.length < 2000; k++) {
      if (items[k] instanceof Folder) { if (depth < 6) walk(items[k], depth + 1); }
      else if (!known.test(items[k].name)) other.push(items[k].fsName);
    }
  };
  for (var r = 0; r < roots.length; r++) walk(roots[r], 0);
}
__result__ = { scriptsFolder: sp.scriptsFolder.fsName, scripts: scripts, unsupported: ${all} ? other : null };`, { needsDocument: false }));
            }
            const ext = action === 'run' ? SCRIPT_EXT : null;
            const path = filePath(a.path, 'path', ext);
            if (action === 'reveal') {
                return run('Reveal script', autoScript(`var f = File(${path});\nif (!f.exists) throw new Error("No file " + f.fsName);\nf.parent.execute();\n__result__ = { revealed: f.fsName, folder: f.parent.fsName };`, { needsDocument: false }));
            }
            if (action === 'delete') {
                return run('Delete script', autoScript(`var f = File(${path}), list = app.scriptPreferences.scriptsList, listed = false;
for (var i = 0; i < list.length; i++) if (File(list[i][1]).fsName === f.fsName) listed = true;
if (!listed) throw new Error("Only scripts listed in the Scripts panel can be deleted; " + f.fsName + " is not one");
if (!f.remove()) throw new Error("Could not delete " + f.fsName);
__result__ = { deleted: f.fsName };`, { needsDocument: false }));
            }
            // run
            const args = obj(a.arguments, 'arguments') ?? {};
            const names = Object.keys(args);
            if (names.length > 50) throw new Error("'arguments' has more than 50 entries");
            const sets = names.map((k) => {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(k)) throw new Error(`Argument name '${k}' must be letters, digits and underscores`);
                if (String(args[k] ?? '').length > 10000) throw new Error(`'arguments.${k}' is longer than 10000 characters`);
                return `app.scriptArgs.setValue(${str(k)}, ${str(String(args[k] ?? ''))});`;
            });
            const values = `[${names.map((k) => str(String(args[k] ?? ''))).join(', ')}]`;
            const lang = /\.idjs$/i.test(a.path) ? 'ScriptLanguage.UXPSCRIPT' : 'ScriptLanguage.JAVASCRIPT';
            const undo = pick(a.undoMode ?? 'entire_script', UNDO, 'undoMode');
            const undoName = has(a.undoName) ? text(a.undoName, 'undoName', 100) : str('Script');
            return run('Run script', autoScript(`var f = File(${path});
if (!f.exists) throw new Error("No script " + f.fsName);
${sets.join('\n')}
var r;
app.scriptPreferences.measurementUnit = __units;
try { r = app.doScript(f, ${lang}, ${values}, ${undo}, ${undoName}); }
finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }
__result__ = { ran: f.fsName, result: r === undefined ? null : String(r) };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_script_preferences',
        description: 'Set script preferences and return them: Enable Redraw while scripts run, whether scripts may show dialogs and alerts (user interaction level) and the measurement unit scripts use; also reports the object-model version scripts target and the Scripts folder (Scripts panel menu > Enable Redraw; Application.scriptPreferences)',
        inputSchema: {
            type: 'object',
            properties: {
                enableRedraw: { type: 'boolean', description: 'Enable Redraw: redraw the screen while scripts run' },
                userInteractionLevel: { type: 'string', enum: Object.keys(INTERACTION), description: 'Whether scripts run later may show dialogs and alerts. This server\'s own tools always run with never_interact' },
                measurementUnit: { type: 'string', enum: UNITS, description: 'The measurement unit scripts use (this server\'s own tools always use millimetres)' },
            },
        },
        features: [
            'indesign.automation.script_preferences',
            'indesign.automation.scripts_menu_enable_redraw',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const lines = ['var sp = app.scriptPreferences;'];
            if (has(a.enableRedraw)) lines.push(`sp.enableRedraw = ${flag(a.enableRedraw, 'enableRedraw')};`);
            // The prelude restores these two from __uil and __units when the tool ends: set those to keep the change.
            if (has(a.userInteractionLevel)) lines.push(`__uil = ${pick(a.userInteractionLevel, INTERACTION, 'userInteractionLevel')};`);
            if (has(a.measurementUnit)) lines.push(`__units = MeasurementUnits.${enumOf(a.measurementUnit, UNITS, { name: 'measurementUnit' }).toUpperCase()};`);
            lines.push('__result__ = { enableRedraw: sp.enableRedraw, userInteractionLevel: __enumName(__uil).toLowerCase(), measurementUnit: __enumName(__units).toLowerCase(), version: String(sp.version), scriptsFolder: sp.scriptsFolder.fsName };');
            return run('Set script preferences', script(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'manage_script_labels',
        description: 'Read or write the script labels scripts use to find objects: get, set or clear an item\'s label, read or write a keyed label (insertLabel / extractLabel), or find the items whose label contains some text (Window > Utilities > Script Label)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set', 'clear', 'find'], description: 'What to do' },
                target: TARGET_SCHEMA,
                label: { type: 'string', description: 'For set: the label text; for find: text the label contains' },
                key: { type: 'string', description: 'For get and set: read or write the keyed label with this key instead of the Script Label text' },
            },
            required: ['action'],
        },
        features: ['indesign.automation.script_label_panel'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'set', target: { ids: [1] }, label: 'price', key: 'role' },
        handler: (a) => {
            const action = pick(a.action, { get: 'get', set: 'set', clear: 'clear', find: 'find' }, 'action');
            if (action === 'find') {
                const label = has(a.label) ? text(a.label, 'label', 1000) : '""';
                return run('Find labelled items', script(`var all = doc.allPageItems, out = [], want = ${label};
for (var i = 0; i < all.length && out.length < 500; i++) {
  var l = all[i].label;
  if (l && (!want || l.indexOf(want) >= 0)) { var info = __itemInfo(all[i]); info.label = l; out.push(info); }
}
__result__ = { items: out };`));
            }
            const key = has(a.key) ? text(a.key, 'key', 200) : null;
            let op;
            if (action === 'set') {
                if (typeof a.label !== 'string' || a.label.length > 100000) throw new Error("'label' is required for set: a string");
                op = key ? `it.insertLabel(${key}, ${str(a.label)});` : `it.label = ${str(a.label)};`;
            }
            if (action === 'clear') op = key ? `it.insertLabel(${key}, "");` : 'it.label = "";';
            if (action === 'get') op = '';
            const read = key ? `it.extractLabel(${key})` : 'it.label';
            return run('Script label', script(`var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${op}
  out.push({ id: it.id, name: it.name || null, label: ${read} });
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'run_menu_action',
        description: 'Look up and invoke InDesign menu actions: search the menu actions by name or area (id, title, area, enabled, checked), read one by id, invoke one by id when it is enabled and opens no dialog, or convert between localised UI strings and language-independent $ID/ key strings (Application.menuActions, findKeyStrings, translateKeyString)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['search', 'get', 'invoke', 'find_key_strings', 'translate_key_string'], description: 'What to do' },
                nameContains: { type: 'string', description: 'For search: text in the action name (case-insensitive)' },
                areaContains: { type: 'string', description: 'For search: text in the area, such as "Panel Menus:Layers" (case-insensitive)' },
                id: { type: 'integer', minimum: 0, description: 'For get and invoke: the menu action id' },
                text: { type: 'string', description: 'For find_key_strings: a localised string; for translate_key_string: a $ID/ key string' },
                maxResults: { type: 'integer', minimum: 1, maximum: 500, description: 'For search: the most actions to return', default: 50 },
            },
            required: ['action'],
        },
        features: [
            'indesign.automation.menu_actions',
            'indesign.automation.find_key_strings',
        ],
        hints: { destructive: true },
        auditArgs: { action: 'invoke', id: 18695 },
        handler: (a) => {
            const action = pick(a.action, { search: 'search', get: 'get', invoke: 'invoke', find_key_strings: 'find_key_strings', translate_key_string: 'translate_key_string' }, 'action');
            const info = 'var __ma = function (m) { return { id: m.id, name: m.name, title: m.title, area: m.area, enabled: m.enabled, checked: m.checked }; };';
            if (action === 'search') {
                const n = has(a.nameContains) ? text(a.nameContains, 'nameContains', 200) : '""';
                const ar = has(a.areaContains) ? text(a.areaContains, 'areaContains', 200) : '""';
                if (n === '""' && ar === '""') throw new Error('Give nameContains or areaContains');
                const max = int(a.maxResults ?? 50, 'maxResults', { min: 1, max: 500 });
                return run('Search menu actions', script(`${info}
var all = app.menuActions.everyItem(), names = all.name, areas = all.area, ids = all.id, out = [], n = ${n}.toLowerCase(), ar = ${ar}.toLowerCase(), total = 0;
for (var i = 0; i < names.length; i++) {
  if (n && String(names[i]).toLowerCase().indexOf(n) < 0) continue;
  if (ar && String(areas[i]).toLowerCase().indexOf(ar) < 0) continue;
  total++;
  if (out.length < ${max}) out.push(__ma(app.menuActions.itemByID(ids[i])));
}
__result__ = { total: total, actions: out };`, { needsDocument: false }));
            }
            if (action === 'get' || action === 'invoke') {
                const id = int(a.id, 'id');
                const body = [
                    info,
                    `var m = app.menuActions.itemByID(${id});`,
                    `if (!m.isValid) throw new Error("No menu action with id ${id}");`,
                ];
                if (action === 'invoke') {
                    body.push(
                        'if (/(\\.\\.\\.|\\u2026)\\s*$/.test(m.name) || /(\\.\\.\\.|\\u2026)\\s*$/.test(m.title)) throw new Error(m.name + " opens a dialog, which cannot be answered here; use the tool for that feature instead");',
                        'if (!m.enabled) throw new Error(m.name + " is not available in the current state or selection");',
                        'm.invoke();',
                    );
                }
                body.push(`__result__ = __ma(m);`);
                return run('Menu action', script(body.join('\n'), { needsDocument: false }));
            }
            const t = text(a.text, 'text', 500);
            if (action === 'find_key_strings') return run('Find key strings', script(`__result__ = { text: ${t}, keys: app.findKeyStrings(${t}) };`, { needsDocument: false }));
            return run('Translate key string', script(`__result__ = { key: ${t}, text: app.translateKeyString(${t}) };`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_script_menus',
        description: 'Extend InDesign\'s menus with scripts: list a menu\'s submenus and items, add a menu item that runs a script file (a script menu action placed in a menu or a new submenu), list the script menu actions, or remove one by title (Application.menus, scriptMenuActions)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list_menu', 'list_actions', 'add', 'remove'], description: 'What to do' },
                menu: { type: 'string', description: 'The top-level menu by name, such as "$ID/Main" (the menu bar) or "$ID/RtMouseText" (a context menu)', default: '$ID/Main' },
                submenus: { type: 'array', items: { type: 'string' }, description: 'Path of submenu titles under the menu, such as ["Window", "Utilities"] or ["$ID/&Window"]; add creates missing submenus' },
                title: { type: 'string', description: 'For add and remove: the menu item title' },
                scriptPath: { type: 'string', description: 'For add: the script file to run when the item is chosen (.jsx, .js or .jsxbin)' },
            },
            required: ['action'],
        },
        features: [
            'indesign.automation.script_menu_actions',
            'indesign.automation.menus_object_model',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'add', submenus: ['Scripts'], title: 'Tidy up', scriptPath: `${process.env.HOME ?? '/tmp'}/Documents/tidy.jsx` },
        handler: (a) => {
            const action = pick(a.action, { list_menu: 'list_menu', list_actions: 'list_actions', add: 'add', remove: 'remove' }, 'action');
            if (action === 'list_actions') {
                return run('List script menu actions', script(`var all = app.scriptMenuActions, out = [];
for (var i = 0; i < all.length; i++) {
  var m = all[i], h = [];
  for (var j = 0; j < m.eventListeners.length; j++) { try { h.push(m.eventListeners[j].eventType + ": " + (m.eventListeners[j].handler instanceof File ? m.eventListeners[j].handler.fsName : "function")); } catch (e) {} }
  out.push({ id: m.id, title: m.title, handlers: h });
}
__result__ = { scriptMenuActions: out };`, { needsDocument: false }));
            }
            const menu = text(a.menu ?? '$ID/Main', 'menu', 200);
            const path = has(a.submenus) ? textList(a.submenus, 'submenus', { max: 10, maxLength: 200 }) : '[]';
            const walk = (create) => `var m = app.menus.itemByName(${menu});
if (!m.isValid) throw new Error("No menu named " + ${menu});
var path = ${path}, at = m;
for (var i = 0; i < path.length; i++) {
  var s = at.submenus.itemByName(path[i]);
  if (!s.isValid) {
    ${create ? 's = at.submenus.add(path[i]);' : 'throw new Error("No submenu " + path[i] + " in " + at.title);'}
  }
  at = s;
}`;
            if (action === 'list_menu') {
                return run('List menu', script(`${walk(false)}
var out = { title: at.title, submenus: [], items: [] };
for (var j = 0; j < at.submenus.length; j++) out.submenus.push(at.submenus[j].title);
for (var k = 0; k < at.menuItems.length; k++) { var it = at.menuItems[k]; var e = { title: it.title, name: it.name }; try { e.actionId = it.associatedMenuAction.id; } catch (x) {} out.items.push(e); }
__result__ = out;`, { needsDocument: false }));
            }
            const title = text(a.title, 'title', 200);
            if (action === 'remove') {
                return run('Remove script menu action', script(`var all = app.scriptMenuActions, n = 0;
for (var i = all.length - 1; i >= 0; i--) if (all[i].title === ${title}) { all[i].remove(); n++; }
if (!n) throw new Error("No script menu action titled " + ${title});
__result__ = { removed: n };`, { needsDocument: false }));
            }
            const handler = handlerFile(a.scriptPath, 'scriptPath');
            return run('Add script menu item', script(`var f = File(${handler});
if (!f.exists) throw new Error("No script " + f.fsName);
${walk(true)}
var sma = app.scriptMenuActions.add(${title});
sma.addEventListener(ScriptMenuAction.ON_INVOKE, f);
at.menuItems.add(sma);
__result__ = { id: sma.id, title: sma.title, menu: at.title };`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_event_listeners',
        description: 'Attach script files to application or document events, such as open, save, export, place, selection changes and before or after printing (print events); list the attached listeners or remove one by id (Application/Document addEventListener)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'What to do' },
                target: { type: 'string', enum: ['application', 'document'], description: 'Listen on the application (every document) or the active document', default: 'application' },
                eventType: { type: 'string', enum: APP_EVENTS, description: 'For add: the event, such as beforePrint, afterPrint, afterOpen, beforeSave or afterSelectionChanged' },
                handlerPath: { type: 'string', description: 'For add: the script file run when the event happens (.jsx, .js or .jsxbin)' },
                id: { type: 'integer', minimum: 0, description: 'For remove: the listener id (from list)' },
            },
            required: ['action'],
        },
        features: [
            'indesign.automation.event_listeners',
            'indesign.automation.print_events',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'add', target: 'document', eventType: 'beforePrint', handlerPath: `${process.env.HOME ?? '/tmp'}/Documents/stamp.jsx` },
        handler: (a) => {
            const action = pick(a.action, { list: 'list', add: 'add', remove: 'remove' }, 'action');
            const target = pick(a.target ?? 'application', { application: 'app', document: '__doc()' }, 'target');
            const lines = [`var t = ${target};`];
            if (action === 'add') {
                const ev = enumOf(a.eventType, target === 'app' ? APP_EVENTS : DOC_EVENTS, { name: 'eventType' });
                lines.push(`var f = File(${handlerFile(a.handlerPath, 'handlerPath')});`, 'if (!f.exists) throw new Error("No script " + f.fsName);', `var added = t.addEventListener(${str(ev)}, f);`);
            }
            if (action === 'remove') lines.push(`var l = t.eventListeners.itemByID(${int(a.id, 'id')});`, `if (!l.isValid) throw new Error("No event listener with id " + ${int(a.id, 'id')});`, 'l.remove();');
            lines.push(
                'var out = [];',
                'for (var i = 0; i < t.eventListeners.length; i++) { var e = t.eventListeners[i]; var h = null; try { h = e.handler instanceof File ? e.handler.fsName : "function"; } catch (x) {} out.push({ id: e.id, eventType: e.eventType, handler: h }); }',
                `__result__ = { target: "${a.target ?? 'application'}", listeners: out${action === 'add' ? ', added: added.id' : ''} };`,
            );
            return run('Event listeners', script(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'manage_idle_tasks',
        description: 'Idle tasks: script files InDesign runs when it is idle, after a delay in milliseconds. List them, add one, change a task\'s delay (0 stops it, -1 runs it once) or remove it (Application.idleTasks)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'set_sleep', 'remove'], description: 'What to do' },
                name: { type: 'string', description: 'For add, set_sleep and remove: the task name' },
                sleep: { type: 'integer', minimum: -1, description: 'For add and set_sleep: milliseconds to wait before the task runs when idle (0 stops it)' },
                handlerPath: { type: 'string', description: 'For add: the script file to run (.jsx, .js or .jsxbin)' },
            },
            required: ['action'],
        },
        features: ['indesign.automation.idle_tasks'],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'add', name: 'Autosave', sleep: 60000, handlerPath: `${process.env.HOME ?? '/tmp'}/Documents/autosave.jsx` },
        handler: (a) => {
            const action = pick(a.action, { list: 'list', add: 'add', set_sleep: 'set_sleep', remove: 'remove' }, 'action');
            const lines = [];
            if (action !== 'list') {
                const name = text(a.name, 'name', 200);
                if (action === 'add') {
                    const sleep = int(a.sleep ?? 1000, 'sleep', { min: -1, max: 86400000 });
                    lines.push(
                        `var f = File(${handlerFile(a.handlerPath, 'handlerPath')});`,
                        'if (!f.exists) throw new Error("No script " + f.fsName);',
                        `if (app.idleTasks.itemByName(${name}).isValid) throw new Error("An idle task named " + ${name} + " exists; use set_sleep or remove");`,
                        `var task = app.idleTasks.add({ name: ${name}, sleep: ${sleep} });`,
                        'task.addEventListener(IdleTask.ON_IDLE, f);',
                    );
                } else {
                    lines.push(`var task = app.idleTasks.itemByName(${name});`, `if (!task.isValid) throw new Error("No idle task named " + ${name});`);
                    if (action === 'set_sleep') lines.push(`task.sleep = ${int(a.sleep, 'sleep', { min: -1, max: 86400000 })};`);
                    if (action === 'remove') lines.push('task.remove();');
                }
            }
            lines.push(
                'var out = [];',
                'for (var i = 0; i < app.idleTasks.length; i++) { var t = app.idleTasks[i]; out.push({ id: t.id, name: t.name, sleep: t.sleep, listeners: t.eventListeners.length }); }',
                '__result__ = { idleTasks: out };',
            );
            return run('Idle tasks', script(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'edit_preference_object',
        description: 'Read or change any preference object of the application or the active document by name, such as textPreferences, guidePreferences or pasteboardPreferences: every preferences pane and default setting is one. get lists its properties; set changes properties given as booleans, numbers, strings, lists or { enum: "Enum.MEMBER" }. Lengths are millimetres (Application/Document preference objects)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set'], description: 'Read the properties, or set some', default: 'get' },
                target: { type: 'string', enum: ['application', 'document'], description: 'The application\'s preferences (defaults for new documents) or the active document\'s', default: 'application' },
                preference: { type: 'string', description: 'The preference object\'s property name, such as "textPreferences", "viewPreferences" or "storyPreferences"' },
                values: { type: 'object', description: 'For set: property name to value, e.g. { "typographersQuotes": true, "smallCap": 70, "baselineGridColor": { "enum": "UIColors.LIGHT_BLUE" } }' },
            },
            required: ['preference'],
        },
        features: ['indesign.automation.preferences_objects'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'set', target: 'application', preference: 'textPreferences', values: { typographersQuotes: true, smallCap: 70, highlightKeeps: false } },
        handler: (a) => {
            const action = pick(a.action ?? 'get', { get: 'get', set: 'set' }, 'action');
            const owner = pick(a.target ?? 'application', { application: 'app', document: '__doc()' }, 'target');
            const pref = ident(a.preference, 'preference');
            if (!/(Preferences|Options|Defaults)$/.test(pref)) throw new Error(`'preference' must name a preference object, ending in Preferences, Options or Defaults (got ${pref})`);
            const lines = [
                'var __enum = function (t, m) { var e = $.global[t]; if (!e || e[m] === undefined) throw new Error("Unknown enumeration value " + t + "." + m); return e[m]; };',
                `var owner = ${owner}, name = ${str(pref)}, p = owner[name];`,
                'if (!p || p.properties === undefined) throw new Error("No preference object " + name);',
                'var failed = {};',
            ];
            if (action === 'set') {
                const v = obj(a.values, 'values');
                if (!v || !Object.keys(v).length) throw new Error("'values' is required for set");
                if (Object.keys(v).length > 100) throw new Error("'values' has more than 100 properties");
                for (const [k, val] of Object.entries(v)) {
                    const key = ident(k, `values.${k}`);
                    lines.push(`try { p[${str(key)}] = ${prefValue(val, `values.${key}`)}; } catch (e) { failed[${str(key)}] = e.message; }`);
                }
            }
            lines.push(
                'var props = p.properties, out = {};',
                'for (var k in props) { if (k === "parent" || k === "preferences" || k === "eventListeners" || k === "events" || k === "properties") continue; try { out[k] = __plain(props[k]); } catch (e) {} }',
                '__result__ = { preference: name, properties: out, failed: failed };',
            );
            return run('Preference object', autoScript(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'get_performance_metrics',
        description: 'Read InDesign diagnostics: performance metrics such as CPU time, memory size, thread and handle counts and composition counts, with their long names, and the memory statistics where available (Application.performanceMetric)',
        inputSchema: {
            type: 'object',
            properties: {
                metrics: { type: 'array', items: { type: 'string', enum: PERFORMANCE }, description: 'Which metrics (PerformanceMetricOptions names); default a common set' },
                includeMemoryStatistics: { type: 'boolean', description: 'Also return memoryStatistics()', default: false },
            },
        },
        features: ['indesign.automation.performance_metrics'],
        hints: { readOnly: true, destructive: false, idempotent: true },
        handler: (a) => {
            const list = has(a.metrics) ? a.metrics : DEFAULT_METRICS;
            if (!Array.isArray(list) || !list.length || list.length > PERFORMANCE.length) throw new Error("'metrics' must be a list of metric names");
            const names = list.map((m, i) => enumOf(m, PERFORMANCE, { name: `metrics[${i}]` }));
            const mem = has(a.includeMemoryStatistics) ? flag(a.includeMemoryStatistics, 'includeMemoryStatistics') : 'false';
            return run('Performance metrics', script(`var names = ${json(names)}, out = {};
for (var i = 0; i < names.length; i++) {
  var k = PerformanceMetricOptions[names[i]];
  try { out[names[i]] = { value: app.performanceMetric(k), name: app.performanceMetricLongName(k) }; } catch (e) { out[names[i]] = { error: e.message }; }
}
var stats = null;
if (${mem}) { try { stats = app.memoryStatistics(); } catch (e) { stats = { error: e.message }; } }
__result__ = { metrics: out, memoryStatistics: stats };`, { needsDocument: false }));
        },
    },
    {
        name: 'apply_ui_customization',
        description: 'Switch the active menu set, keyboard shortcut set or workspace by name (Edit > Menus, Edit > Keyboard Shortcuts, Window > Workspace)',
        inputSchema: {
            type: 'object',
            properties: {
                menuSet: { type: 'string', description: 'Menu customization set name' },
                shortcutSet: { type: 'string', description: 'Keyboard shortcut set name, such as "Default"' },
                workspace: { type: 'string', description: 'Workspace name, such as "Essentials"' },
            },
        },
        features: ['indesign.automation.apply_menu_customization'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const lines = [];
            if (has(a.menuSet)) lines.push(`app.applyMenuCustomization(${text(a.menuSet, 'menuSet', 200)});`);
            if (has(a.shortcutSet)) lines.push(`app.applyShortcutSet(${text(a.shortcutSet, 'shortcutSet', 200)});`);
            if (has(a.workspace)) lines.push(`app.applyWorkspace(${text(a.workspace, 'workspace', 200)});`);
            if (!lines.length) throw new Error('Give menuSet, shortcutSet or workspace');
            lines.push(`__result__ = { applied: ${json({ menuSet: a.menuSet ?? null, shortcutSet: a.shortcutSet ?? null, workspace: a.workspace ?? null })} };`);
            return run('Apply UI customization', script(lines.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'generate_idml_schema',
        description: 'Write the RELAX NG schema that describes IDML into a folder, for a single-file IDML or the package (multi-file) format (Application.generateIDMLSchema)',
        inputSchema: {
            type: 'object',
            properties: {
                folder: { type: 'string', description: 'The folder to write the schema files into' },
                packageFormat: { type: 'boolean', description: 'Schema for the IDML package format (several files) instead of a single file', default: false },
            },
            required: ['folder'],
        },
        features: ['indesign.automation.generate_idml_schema'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const folder = filePath(a.folder, 'folder');
            const pkg = has(a.packageFormat) ? flag(a.packageFormat, 'packageFormat') : 'false';
            return run('Generate IDML schema', script(`var f = Folder(${folder});
if (!f.exists && !f.create()) throw new Error("Cannot create " + f.fsName);
app.generateIDMLSchema(f, ${pkg});
var files = f.getFiles(), names = [];
for (var i = 0; i < files.length; i++) names.push(decodeURI(files[i].name));
__result__ = { folder: f.fsName, files: names };`, { needsDocument: false }));
        },
    },
    {
        name: 'find_xml_rule_matches',
        description: 'Run XML rules over the document\'s structure: match XPath expressions (such as "//Story/Head" or "//*[@type=\'note\']") with an XML rule processor and return each match with the rules it matched, its tag and text (XML rules, XMLRuleProcessor)',
        inputSchema: {
            type: 'object',
            properties: {
                xpaths: { type: 'array', items: { type: 'string' }, description: 'XPath expressions (the subset XML rules support), one per rule' },
                maxMatches: { type: 'integer', minimum: 1, maximum: 2000, description: 'The most matches to return', default: 200 },
            },
            required: ['xpaths'],
        },
        features: ['indesign.automation.xml_rules'],
        hints: { readOnly: true, destructive: false, idempotent: true },
        auditArgs: { xpaths: ['//Story/Head', '//para'] },
        handler: (a) => {
            const xpaths = textList(a.xpaths, 'xpaths', { max: 50, maxLength: 500 });
            const max = int(a.maxMatches ?? 200, 'maxMatches', { min: 1, max: 2000 });
            return run('XML rules', script(`if (!doc.xmlElements.length) throw new Error("The document has no XML structure");
var proc = app.xmlRuleProcessors.add(${xpaths}, []), out = [], total = 0;
try {
  var m = proc.startProcessingRuleSet(doc.xmlElements[0]);
  while (m !== undefined && m !== null) {
    total++;
    if (out.length < ${max}) {
      var e = m.element, info = { rules: m.matchRules, type: e.constructor.name };
      try { info.tag = e.markupTag.name; } catch (x) {}
      try { info.text = String(e.contents).substring(0, 120); } catch (x) {}
      out.push(info);
    }
    m = proc.findNextMatch();
  }
  proc.endProcessingRuleSet();
} finally {
  proc.remove();
}
__result__ = { total: total, matches: out };`));
        },
    },
];
