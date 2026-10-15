/**
 * Selection and clipboard: Edit and Object > Select commands, the selection
 * tools, Cut / Copy / Paste variants, duplicating with an offset and Step and
 * Repeat, and Clipboard Handling and drag-and-drop text preferences.
 *
 * Items are chosen by PageItem.id, name or the current selection; offsets are
 * millimetres.
 */
import { str, num, bool, enumOf, index, json } from 'adobe-mcp-core';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';
import { B, groupSchema, assign } from './formatOptions.js';
import { commandScript, has } from './commands.js';

const SL = 'indesign.selection.';
const ids = (...names) => names.map((n) => SL + n);

/** Object > Select commands reached by menu action (ids from the command list; none opens a dialog). */
const SELECT_MENU = {
    previous_in_group: [11355, 'Previous Object in Group'],
    next_in_group: [11356, 'Next Object in Group'],
    next_object_above: [11287, 'Next Object Above'],
    next_object_below: [11288, 'Next Object Below'],
    first_object_above: [11289, 'First Object Above'],
    last_object_below: [11290, 'Last Object Below'],
};
const SELECT_ACTIONS = ['items', 'all', 'none', 'container', 'content', 'group', ...Object.keys(SELECT_MENU), 'parent_item', 'all_guides'];

const TOOLS = ['SELECTION_TOOL', 'DIRECT_SELECTION_TOOL', 'PAGE_TOOL', 'GAP_TOOL', 'TYPE_TOOL', 'TYPE_ON_PATH_TOOL', 'LINE_TOOL', 'PEN_TOOL', 'ADD_ANCHOR_POINT',
    'DELETE_ANCHOR_POINT', 'CONVERT_DIRECTION_POINT', 'PENCIL_TOOL', 'SMOOTH_TOOL', 'ERASE_TOOL', 'RECTANGLE_FRAME_TOOL', 'ELLIPSE_FRAME_TOOL', 'POLYGON_FRAME_TOOL',
    'RECTANGLE_TOOL', 'ELLIPSE_TOOL', 'POLYGON_TOOL', 'SCISSORS_TOOL', 'FREE_TRANSFORM_TOOL', 'ROTATE_TOOL', 'SCALE_TOOL', 'SHEAR_TOOL', 'GRADIENT_SWATCH_TOOL',
    'GRADIENT_FEATHER_TOOL', 'NOTE_TOOL', 'EYE_DROPPER_TOOL', 'MEASURE_TOOL', 'HAND_TOOL', 'ZOOM_TOOL', 'TABLE_TOOL'];

const CLIPBOARD = {
    cut: 'app.cut();',
    copy: 'app.copy();',
    paste: 'app.paste();',
    paste_without_formatting: 'app.pasteWithoutFormatting();',
    paste_into: 'app.pasteInto();',
    paste_in_place: 'app.pasteInPlace();',
};

const UNDO_MODES = { entire_script: 'ENTIRE_SCRIPT', fast_entire_script: 'FAST_ENTIRE_SCRIPT', auto_undo: 'AUTO_UNDO', script_request: 'SCRIPT_REQUEST' };
const NUDGE = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Clipboard Handling preferences (ClipboardPreference). */
const CLIPBOARD_PREFS = {
    preferPDFWhenPasting: B('Prefer PDF When Pasting'),
    copyPDFToClipboard: B('Copy PDF to Clipboard'),
    preservePdfClipboardAtQuit: B('Preserve PDF Data at Quit'),
    preferStyledTextWhenPasting: B('When pasting text from other applications: All Information (true) or Text Only (false)'),
    pasteRemembersLayers: B('Paste Remembers Layers (Layers panel menu)'),
    showPasteOptions: B('Show paste options'),
};
/** Drag-and-drop text (TextEditingPreference). */
const DRAG_PREFS = {
    dragAndDropTextInLayout: B('Enable in Layout View (Preferences > Type > Drag and Drop Text Editing)'),
    allowDragAndDropTextInStory: B('Enable in Story Editor'),
};

/** __selection(): the current selection, described. */
const SELECTION_INFO = String.raw`
var __selection = function () {
  var out = [], sel = app.selection;
  for (var i = 0; i < sel.length; i++) {
    var s = sel[i], o = { type: s.constructor.name };
    try { o.id = s.id; } catch (e) {}
    try { if (s.hasOwnProperty("geometricBounds")) { var info = __itemInfo(s); o.name = info.name; o.page = info.page; o.layer = info.layer; } } catch (e) {}
    out.push(o);
  }
  return out;
};
`;

export const tools = [
    {
        name: 'select_layout_objects',
        description: 'Change the selection: select items, Select All, Deselect All (Edit menu); Container, Content, Previous / Next Object in Group, First Object Above, Next Object Above, Next Object Below, Last Object Below (Object > Select and the object context menu); the whole group an item is in (Group Selection); a parent item on a document page, overriding it so it can be edited; or every ruler guide on a spread',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: SELECT_ACTIONS, description: 'What to select. container, content, group and the Object > Select commands start from target if given, else from the current selection' },
                target: TARGET_SCHEMA,
                mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'For items: replace the selection, add to it, or remove from it', default: 'replace' },
                pageIndex: { type: 'integer', minimum: 0, description: 'For parent_item: the document page' },
                parentItemId: { type: 'integer', minimum: 0, description: 'For parent_item: id of the item on the parent spread' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'For all_guides: the spread (default: the active spread)' },
            },
            required: ['action'],
        },
        features: ids('select_all', 'deselect_all', 'select_container', 'select_content', 'group_selection', 'select_next_previous_in_group',
            'select_stacked_objects', 'context_select_nested', 'select_parent_item', 'select_all_guides'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const action = enumOf(a.action, SELECT_ACTIONS, { name: 'action' });
            const start = has(a.target) ? `doc.select(__targets(doc, ${targetSpec(a.target)}));` : '';
            const needSel = 'if (app.selection.length === 0) throw new Error("Nothing is selected: pass target or select items first");';
            let body;
            if (action === 'items') {
                if (!has(a.target)) throw new Error("'target' is required for items");
                const mode = { replace: 'REPLACE_WITH', add: 'ADD_TO', remove: 'REMOVE_FROM' }[enumOf(a.mode ?? 'replace', ['replace', 'add', 'remove'], { name: 'mode' })];
                body = `doc.select(__targets(doc, ${targetSpec(a.target)}), SelectionOptions.${mode});`;
            } else if (action === 'all') {
                body = 'doc.select(SelectAll.ALL);';
            } else if (action === 'none') {
                body = 'doc.select(NothingEnum.NOTHING);';
            } else if (action === 'container' || action === 'content' || action === 'group') {
                const step = {
                    container: 'var p = s.parent; if (p.hasOwnProperty("geometricBounds")) next = p;',
                    content: 'if (s.constructor.name === "Group") next = s.pageItems[0]; else if (s.hasOwnProperty("graphics") && s.graphics.length) next = s.graphics[0]; else if (s.hasOwnProperty("pageItems") && s.pageItems.length) next = s.pageItems[0];',
                    group: 'var g = s.parent, top = null; while (g.constructor.name === "Group") { top = g; g = g.parent; } if (top !== null) next = top;',
                }[action];
                body = `${start}
${needSel}
var sel = app.selection, picked = [];
for (var i = 0; i < sel.length; i++) {
  var s = sel[i], next = null;
  ${step}
  if (next === null) throw new Error("The selected " + s.constructor.name + " has no ${action === 'content' ? 'content' : action === 'group' ? 'group around it' : 'container'} to select");
  picked.push(next);
}
doc.select(picked);`;
            } else if (SELECT_MENU[action]) {
                const [id, label] = SELECT_MENU[action];
                body = `${start}
${needSel}
__invoke(${id}, ${str(label)});`;
            } else if (action === 'parent_item') {
                if (!has(a.pageIndex) || !has(a.parentItemId)) throw new Error("'pageIndex' and 'parentItemId' are required for parent_item");
                body = `var pg = __page(doc, ${index(a.pageIndex, { name: 'pageIndex' })});
var mi = __anyItem(doc, ${index(a.parentItemId, { name: 'parentItemId', max: 1e9 })});
if (mi.parent.constructor.name !== "MasterSpread") throw new Error("Item " + mi.id + " is not on a parent spread");
if (!mi.allowOverrides) throw new Error("Overrides are not allowed for item " + mi.id + " (Allow Parent Item Overrides is off)");
var o = mi.override(pg);
o.select();`;
            } else {
                const si = has(a.spreadIndex) ? index(a.spreadIndex, { name: 'spreadIndex' }) : null;
                body = `var sp = ${si !== null ? `__spread(doc, ${si})` : '__window(doc).activeSpread'};
var guides = sp.guides.everyItem().getElements();
if (!guides.length) throw new Error("The spread has no ruler guides");
doc.select(guides);`;
            }
            return run('Change selection', commandScript(`${SELECTION_INFO}
${body}
__result__ = { action: ${str(action)}, selection: __selection() };`));
        },
    },
    {
        name: 'set_active_tool',
        description: 'Choose the active tool in the Tools panel, such as the Selection or Direct Selection tool (which selects frame contents, path points and items inside groups), or toggle between the Selection and Direct Selection tools as the keyboard shortcut does',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: ['toggle_selection_tools', ...TOOLS], description: 'The tool (UITools name), or toggle_selection_tools' },
            },
            required: ['tool'],
        },
        features: ids('direct_selection_tool', 'toggle_selection_tools'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const tool = enumOf(a.tool, ['toggle_selection_tools', ...TOOLS], { name: 'tool' });
            const set = tool === 'toggle_selection_tools'
                ? 'tb.currentTool = tb.currentTool === UITools.SELECTION_TOOL ? UITools.DIRECT_SELECTION_TOOL : UITools.SELECTION_TOOL;'
                : `tb.currentTool = UITools.${tool};`;
            return run('Set active tool', commandScript(`
var tb = app.toolBoxTools, before = __enumName(tb.currentTool);
${set}
__result__ = { before: before, tool: __enumName(tb.currentTool) };`, { needsDocument: false }));
        },
    },
    {
        name: 'run_clipboard_command',
        description: 'Cut, Copy, Paste, Paste without Formatting, Paste Into (into the selected frame, as a mask) or Paste in Place (Edit menu). Acts on the current selection, or selects target first; paste text at an insertion point chosen with select_text',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(CLIPBOARD), description: 'The Edit menu command' },
                target: TARGET_SCHEMA,
            },
            required: ['command'],
        },
        features: ids('cut', 'copy', 'paste', 'paste_without_formatting', 'paste_into', 'paste_in_place'),
        hints: { readOnly: false, destructive: true, idempotent: false },
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(CLIPBOARD), { name: 'command' });
            const needs = ['cut', 'copy', 'paste_into'].includes(command);
            return run('Clipboard', commandScript(`${SELECTION_INFO}
${has(a.target) ? `doc.select(__targets(doc, ${targetSpec(a.target)}));` : ''}
${needs ? 'if (app.selection.length === 0) throw new Error("Nothing is selected: pass target or select first");' : ''}
${CLIPBOARD[command]}
__result__ = { command: ${str(command)}, selection: __selection() };`));
        },
    },
    {
        name: 'step_and_repeat_items',
        description: 'Duplicate items with an offset, as Alt/Option-dragging or nudging with the duplicate modifier does, or make several copies at a fixed offset, optionally as a grid (Edit > Step and Repeat). The copies are made as one undoable step by default (script undo mode)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                mode: { type: 'string', enum: ['offset', 'nudge', 'step_and_repeat'], description: 'offset: one copy moved by dx/dy; nudge: one copy moved by the keyboard increment; step_and_repeat: count copies, or a rows x columns grid', default: 'offset' },
                dx: { type: 'number', description: 'Horizontal offset, mm (offset and step_and_repeat)' },
                dy: { type: 'number', description: 'Vertical offset, mm (offset and step_and_repeat)' },
                direction: { type: 'string', enum: Object.keys(NUDGE), description: 'For nudge: the arrow key direction' },
                factor: { type: 'string', enum: ['normal', 'times_10', 'tenth'], description: 'For nudge: the keyboard increment, ten times it (Shift) or a tenth of it', default: 'normal' },
                count: { type: 'integer', minimum: 1, maximum: 500, description: 'For step_and_repeat: number of copies (ignored when rows or columns is given)' },
                rows: { type: 'integer', minimum: 1, maximum: 100, description: 'For step_and_repeat as a grid: rows (dy is the vertical step)' },
                columns: { type: 'integer', minimum: 1, maximum: 100, description: 'For step_and_repeat as a grid: columns (dx is the horizontal step)' },
                undoMode: { type: 'string', enum: Object.keys(UNDO_MODES), description: 'How the copies are recorded for Undo: entire_script (one step), fast_entire_script (one step, faster, no partial undo), auto_undo (merged into the previous step), script_request (each copy is its own step)', default: 'entire_script' },
            },
            required: ['target'],
        },
        features: ids('duplicate_drag', 'duplicate_nudge', 'step_and_repeat').concat('indesign.history.script_undo_modes'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { mode: 'step_and_repeat', rows: 2, columns: 3, dx: 20, dy: 15 },
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'offset', ['offset', 'nudge', 'step_and_repeat'], { name: 'mode' });
            const undo = UNDO_MODES[enumOf(a.undoMode ?? 'entire_script', Object.keys(UNDO_MODES), { name: 'undoMode' })];
            const spec = targetSpec(a.target);
            let steps;
            let label;
            if (mode === 'nudge') {
                const dir = NUDGE[enumOf(a.direction, Object.keys(NUDGE), { name: 'direction' })];
                const f = { normal: '1', times_10: '10', tenth: '0.1' }[enumOf(a.factor ?? 'normal', ['normal', 'times_10', 'tenth'], { name: 'factor' })];
                steps = `var inc = doc.viewPreferences.cursorKeyIncrement * ${f};\nvar offsets = [[${dir[0]} * inc, ${dir[1]} * inc]];`;
                label = 'Duplicate';
            } else {
                if (!has(a.dx) && !has(a.dy)) throw new Error('Give dx and/or dy');
                const dx = Number(num(a.dx ?? 0, { min: -5486.4, max: 5486.4, name: 'dx' }));
                const dy = Number(num(a.dy ?? 0, { min: -5486.4, max: 5486.4, name: 'dy' }));
                const offsets = [];
                if (mode === 'offset') {
                    offsets.push([dx, dy]);
                    label = 'Duplicate';
                } else if (has(a.rows) || has(a.columns)) {
                    const rows = Number(index(a.rows ?? 1, { name: 'rows', max: 100 }));
                    const cols = Number(index(a.columns ?? 1, { name: 'columns', max: 100 }));
                    if (rows < 1 || cols < 1) throw new Error("'rows' and 'columns' must be at least 1");
                    if (rows * cols < 2) throw new Error('A grid needs more than one cell');
                    if (rows * cols > 501) throw new Error('A grid makes at most 500 copies');
                    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r || c) offsets.push([c * dx, r * dy]);
                    label = 'Step and Repeat';
                } else {
                    const count = Number(index(a.count ?? 1, { name: 'count', max: 500 }));
                    if (count < 1) throw new Error("'count' must be at least 1");
                    for (let k = 1; k <= count; k++) offsets.push([k * dx, k * dy]);
                    label = 'Step and Repeat';
                }
                steps = `var offsets = ${json(offsets.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]))};`;
            }
            return run('Duplicate items', commandScript(`
var items = __targets(doc, ${spec}), copies = [];
${steps}
var __work = function () {
  for (var i = 0; i < items.length; i++) {
    for (var k = 0; k < offsets.length; k++) copies.push(items[i].duplicate(undefined, offsets[k]));
  }
};
app.doScript(__work, ScriptLanguage.JAVASCRIPT, [], UndoModes.${undo}, ${str(label)});
var out = [];
for (var c = 0; c < copies.length && c < 200; c++) out.push(__itemInfo(copies[c]));
__result__ = { copies: copies.length, items: out, undoMode: ${str(undo)} };`));
        },
    },
    {
        name: 'set_clipboard_preferences',
        description: 'Set Clipboard Handling preferences (Preferences > Clipboard Handling: prefer PDF when pasting, copy PDF to clipboard, preserve PDF data at quit, paste text as all information or text only), Paste Remembers Layers (Layers panel menu), and drag-and-drop text editing in layout view and Story Editor (Preferences > Type). With no options it reads them',
        inputSchema: {
            type: 'object',
            properties: {
                clipboard: groupSchema(CLIPBOARD_PREFS, 'Clipboard preferences (ClipboardPreference)'),
                dragAndDrop: groupSchema(DRAG_PREFS, 'Drag and Drop Text Editing (TextEditingPreference)'),
            },
        },
        features: ids('clipboard_preferences', 'drag_drop_text').concat('indesign.layers.paste_remembers_layers'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => run('Clipboard preferences', commandScript(`
var cp = app.clipboardPreferences, tp = app.textEditingPreferences;
${assign('cp', CLIPBOARD_PREFS, a.clipboard, 'clipboard')}
${assign('tp', DRAG_PREFS, a.dragAndDrop, 'dragAndDrop')}
var out = { clipboard: {}, dragAndDrop: {} };
var c = ${json(Object.keys(CLIPBOARD_PREFS))}, d = ${json(Object.keys(DRAG_PREFS))};
for (var i = 0; i < c.length; i++) { try { out.clipboard[c[i]] = cp[c[i]]; } catch (e) {} }
for (var j = 0; j < d.length; j++) out.dragAndDrop[d[j]] = tp[d[j]];
__result__ = out;`, { needsDocument: false })),
    },
];
