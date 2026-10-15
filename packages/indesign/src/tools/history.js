/**
 * Undo, redo and the document's history: Edit > Undo / Redo, History panel
 * Step Backward / Step Forward, and the list of states the History panel
 * shows.
 */
import { str, enumOf, index } from 'adobe-mcp-core';
import { run } from './run.js';
import { commandScript } from './commands.js';

const H = 'indesign.history.';
const ids = (...names) => names.map((n) => H + n);

export const tools = [
    {
        name: 'manage_undo_history',
        description: 'Undo or redo changes to the active document, one or more steps (Edit > Undo / Redo; History panel > Step Backward / Step Forward), or list the states the History panel shows: what can be undone and redone, most recent first',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'undo', 'redo'], description: 'List the history, undo or redo' },
                steps: { type: 'integer', minimum: 1, maximum: 100, description: 'How many steps to undo or redo', default: 1 },
            },
            required: ['action'],
        },
        features: ids('undo', 'redo', 'history_panel', 'history_step_forward', 'history_step_backward'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'undo', 'redo'], { name: 'action' });
            const steps = Number(index(a.steps ?? 1, { name: 'steps', max: 100 }));
            if (steps < 1) throw new Error("'steps' must be at least 1");
            const step = {
                list: '',
                undo: `for (var i = 0; i < ${steps}; i++) { if (doc.undoHistory.length === 0) break; undone.push(doc.undoName); doc.undo(); }
if (!undone.length) throw new Error("Nothing to undo");`,
                redo: `for (var i = 0; i < ${steps}; i++) { if (doc.redoHistory.length === 0) break; undone.push(doc.redoName); doc.redo(); }
if (!undone.length) throw new Error("Nothing to redo");`,
            }[action];
            return run('Undo history', commandScript(`
var undone = [];
${step}
__result__ = { action: ${str(action)}, steps: ${action === 'list' ? 'null' : 'undone'}, undoName: doc.undoName, redoName: doc.redoName, undoHistory: doc.undoHistory, redoHistory: doc.redoHistory };`));
        },
    },
];
