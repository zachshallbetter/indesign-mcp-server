/**
 * History: list states, step back or forward, and make snapshots.
 */
import { str, num, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';

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
        features: [],
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
        features: [],
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
        features: [],
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
];

