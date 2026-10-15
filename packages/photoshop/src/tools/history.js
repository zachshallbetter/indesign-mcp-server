/**
 * History: list states, step back or forward, make snapshots, revert, delete
 * and clear states, new documents from a state, the history brush, purging,
 * and the History Options and History Log preferences.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './documents.js';

const STATES = `
var states = [], active = -1;
for (var i = 0; i < doc.historyStates.length; i++) {
  var h = doc.historyStates[i];
  states.push({ index: i, name: h.name, snapshot: h.snapshot });
  if (h === doc.activeHistoryState) active = i;
}`;

export const tools = [
    {
        name: 'list_history',
        description: 'List the History panel\'s states and snapshots, and which one is current',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.history.history_panel', 'photoshop.history.history_state', 'photoshop.history.snapshot_object'],
        handler: () => run('List history', script(`${STATES}
__result__ = { active: active, states: states };`)),
    },
    {
        name: 'undo',
        description: 'Step back (undo) or forward (redo) through the history, or go to a state by index. Undone steps stay available until something new is done',
        inputSchema: {
            type: 'object',
            properties: {
                steps: { type: 'integer', minimum: -100, maximum: 100, description: 'Positive to undo, negative to redo. Default 1' },
                toIndex: { type: 'integer', minimum: 0, description: 'Go to this history state instead' },
            },
        },
        auditArgs: { toIndex: undefined },
        features: ['photoshop.history.undo', 'photoshop.history.redo', 'photoshop.history.step_backward', 'photoshop.history.step_forward', 'photoshop.history.select_history_state'],
        handler: (a) => {
            if (a.steps !== undefined && a.toIndex !== undefined) throw new Error('Give steps or toIndex');
            return run('Undo', script(`${STATES}
var target = ${a.toIndex !== undefined ? index(a.toIndex, { name: 'toIndex' }) : `active - ${num(a.steps ?? 1, { min: -100, max: 100, name: 'steps' })}`};
if (target < 0) target = 0;
if (target >= states.length) target = states.length - 1;
doc.activeHistoryState = doc.historyStates[target];
__result__ = { active: target, state: states[target].name };`));
        },
    },
    {
        name: 'make_snapshot',
        description: 'Save the current state as a History snapshot, so it can be returned to later',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        features: ['photoshop.history.snapshot'],
        handler: (a) => run('Make snapshot', script(`
var d = new ActionDescriptor(), r = new ActionReference(), from = new ActionReference();
r.putClass(app.charIDToTypeID("SnpS"));
d.putReference(app.charIDToTypeID("null"), r);
from.putProperty(app.charIDToTypeID("HstS"), app.charIDToTypeID("CrnH"));
d.putReference(app.charIDToTypeID("From"), from);
${a.name ? `d.putString(app.charIDToTypeID("Nm  "), ${str(a.name)});` : ''}
app.executeAction(app.charIDToTypeID("Mk  "), d, DialogModes.NO);
${STATES}
__result__ = { active: active, states: states };`)),
    },
    {
        name: 'edit_history',
        description: 'Change the history: revert to the last save (File > Revert), delete a state or snapshot, clear the history, make a new document from a state, set the history brush source or pick the History Brush tool (History panel), or purge every document\'s history (Edit > Purge > Histories). Clearing and purging cannot be undone',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['revert', 'delete_state', 'clear', 'new_document', 'set_brush_source', 'select_history_brush', 'purge'] },
                index: { type: 'integer', minimum: 0, description: 'delete_state, set_brush_source: the state or snapshot (index from list_history). new_document: the state to copy. Default the current state' },
            },
            required: ['operation'],
        },
        hints: { destructive: true },
        auditArgs: { operation: 'new_document', index: 2 },
        features: ['photoshop.history.revert', 'photoshop.history.delete_history_state', 'photoshop.history.clear_history', 'photoshop.history.new_document_from_state', 'photoshop.history.history_brush_source', 'photoshop.history.history_brush_tool', 'photoshop.history.purge_histories'],
        handler: (a) => {
            const op = enumOf(a.operation, ['revert', 'delete_state', 'clear', 'new_document', 'set_brush_source', 'select_history_brush', 'purge'], { name: 'operation' });
            const takesIndex = ['delete_state', 'new_document', 'set_brush_source'];
            if (a.index !== undefined && !takesIndex.includes(op)) throw new Error(`'index' does not apply to ${op}`);
            if (a.index === undefined && op !== 'new_document' && takesIndex.includes(op)) throw new Error(`${op} needs 'index'`);
            const at = a.index !== undefined ? index(a.index, { name: 'index', max: 10000 }) : null;
            const pick = at === null ? '' : `
if (${at} >= doc.historyStates.length) throw new Error("There are " + doc.historyStates.length + " history states");
var state = doc.historyStates[${at}];`;
            if (op === 'purge') {
                return run('Purge histories', script(`
app.purge(PurgeTarget.HISTORYCACHES);
__result__ = { purged: "histories", documents: app.documents.length };`, { needsDocument: false }));
            }
            if (op === 'select_history_brush') {
                return run('History brush', script(`
app.currentTool = "historyBrushTool";
__result__ = { tool: app.currentTool };`, { needsDocument: false }));
            }
            const bodies = {
                revert: `
try { if (!doc.fullName) throw 0; } catch (e) { throw new Error("The document has never been saved, so there is nothing to revert to"); }
app.executeAction(app.stringIDToTypeID("revert"), new ActionDescriptor(), DialogModes.NO);`,
                delete_state: `${pick}
doc.activeHistoryState = state;
var d = new ActionDescriptor(), r = new ActionReference();
r.putEnumerated(app.charIDToTypeID("HstS"), app.charIDToTypeID("Ordn"), app.charIDToTypeID("Trgt"));
d.putReference(app.charIDToTypeID("null"), r);
app.executeAction(app.charIDToTypeID("Dlt "), d, DialogModes.NO);`,
                clear: `
var d = new ActionDescriptor(), r = new ActionReference();
r.putProperty(app.charIDToTypeID("Prpr"), app.charIDToTypeID("HsSt"));
r.putEnumerated(app.charIDToTypeID("Dcmn"), app.charIDToTypeID("Ordn"), app.charIDToTypeID("Trgt"));
d.putReference(app.charIDToTypeID("null"), r);
app.executeAction(app.charIDToTypeID("Cler"), d, DialogModes.NO);`,
                new_document: `${pick}
var src = doc, was = doc.activeHistoryState;
${at !== null ? 'doc.activeHistoryState = state;' : ''}
var d = new ActionDescriptor(), r = new ActionReference(), u = new ActionReference();
r.putClass(app.charIDToTypeID("Dcmn"));
d.putReference(app.charIDToTypeID("null"), r);
u.putProperty(app.charIDToTypeID("HstS"), app.charIDToTypeID("CrnH"));
d.putReference(app.charIDToTypeID("Usng"), u);
app.executeAction(app.charIDToTypeID("Mk  "), d, DialogModes.NO);
var made = app.activeDocument;
${at !== null ? 'app.activeDocument = src;\nsrc.activeHistoryState = was;\napp.activeDocument = made;' : ''}
__result__ = { document: __docInfo(made) };`,
                set_brush_source: `${pick}
doc.activeHistoryBrushSource = state;`,
            };
            return run('Edit history', script(`${bodies[op]}
if (!__result__) {
  var d0 = app.activeDocument;
  ${STATES.replace(/\bdoc\b/g, 'd0')}
  var brush = null;
  try { brush = d0.activeHistoryBrushSource.name; } catch (e) {}
  __result__ = { active: active, states: states, brushSource: brush };
}`));
        },
    },
    {
        name: 'set_history_options',
        description: 'Read or set the history preferences: History Options (Automatically Create First Snapshot, Allow Non-Linear History, number of history states) and the History Log (Preferences > History & Content Credentials: on or off, saved to metadata, a text file or both, and how much it records)',
        inputSchema: {
            type: 'object',
            properties: {
                autoFirstSnapshot: { type: 'boolean', description: 'Automatically Create First Snapshot' },
                nonLinear: { type: 'boolean', description: 'Allow Non-Linear History' },
                states: { type: 'integer', minimum: 1, maximum: 1000, description: 'History states kept per document' },
                log: { type: 'boolean', description: 'Turn the History Log on or off' },
                logTo: { type: 'string', enum: ['metadata', 'file', 'both'], description: 'Where the log is saved' },
                logFile: { type: 'string', description: 'Absolute path of the log text file, for logTo file or both' },
                logDetail: { type: 'string', enum: ['sessions', 'concise', 'detailed'], description: 'Edit Log Items: sessions only, concise or detailed' },
            },
        },
        hints: { idempotent: true },
        auditArgs: { logTo: 'both', logFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'history-log.txt') },
        features: ['photoshop.history.history_options', 'photoshop.history.auto_first_snapshot', 'photoshop.history.non_linear_history', 'photoshop.history.history_log'],
        handler: (a) => {
            const lines = [];
            if (a.autoFirstSnapshot !== undefined) lines.push(`p.createFirstSnapshot = ${bool(a.autoFirstSnapshot)};`);
            if (a.nonLinear !== undefined) lines.push(`p.nonLinearHistory = ${bool(a.nonLinear)};`);
            if (a.states !== undefined) lines.push(`p.numberOfHistoryStates = ${index(a.states, { name: 'states', max: 1000 })};`);
            if (a.log !== undefined) lines.push(`p.useHistoryLog = ${bool(a.log)};`);
            if (a.logTo !== undefined) {
                const to = enumOf(a.logTo, ['metadata', 'file', 'both'], { name: 'logTo' });
                lines.push(`p.saveLogItems = SaveLogItemsType.${{ metadata: 'METADATA', file: 'LOGFILE', both: 'LOGFILEANDMETADATA' }[to]};`);
                if (to !== 'metadata' && !a.logFile) throw new Error(`logTo ${to} needs 'logFile'`);
            }
            if (a.logFile !== undefined) {
                if (a.logTo === 'metadata') throw new Error("'logFile' does not apply to logTo metadata");
                lines.push(`p.saveLogItemsFile = new File(${jsxPath(paths.validate(a.logFile))});`);
            }
            if (a.logDetail !== undefined) {
                const detail = enumOf(a.logDetail, ['sessions', 'concise', 'detailed'], { name: 'logDetail' });
                lines.push(`p.editLogItems = EditLogItemsType.${{ sessions: 'SESSIONONLY', concise: 'CONCISE', detailed: 'DETAILED' }[detail]};`);
            }
            return run('History options', script(`
var p = app.preferences;
${lines.join('\n')}
var out = { autoFirstSnapshot: p.createFirstSnapshot, nonLinear: p.nonLinearHistory, states: p.numberOfHistoryStates, log: p.useHistoryLog };
try { out.logTo = __enumName(p.saveLogItems); } catch (e) {}
try { out.logDetail = __enumName(p.editLogItems); } catch (e) {}
try { out.logFile = p.saveLogItemsFile.fsName; } catch (e) {}
__result__ = out;`, { needsDocument: false }));
        },
    },
];
