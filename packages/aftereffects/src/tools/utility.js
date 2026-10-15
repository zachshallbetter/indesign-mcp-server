/**
 * Status, menu commands, running ExtendScript, and help.
 */
import { str, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';

export const tools = [
    {
        name: 'aftereffects_status',
        description: 'Check that After Effects is reachable: platform, how the server addresses After Effects, whether it is running, its version and project. Use this first when a call fails to connect',
        inputSchema: { type: 'object', properties: { probe: { type: 'boolean', description: 'Ask After Effects for its version and project (starts it if it is not running). Default true', default: true } } },
        hints: { readOnly: true },
        features: ['aftereffects.application.application_object'],
        handler: async (a) => {
            const status = await executor.status();
            if (a.probe === false) return formatResponse(status, 'Status');
            try {
                const r = await executor.runStructured(script('__result__ = { version: app.version, build: app.buildName, project: app.project.file ? app.project.file.fsName : null, items: app.project.numItems };'));
                if (!r.ok) return formatErrorResponse({ ...status, error: r.error }, 'Status');
                return formatResponse({ ...status, aftereffects: JSON.parse(r.result) }, 'Status');
            } catch (error) {
                return formatErrorResponse({ ...status, error: error.message }, 'Status');
            }
        },
    },
    {
        name: 'run_menu_command',
        description: 'Run an After Effects menu command by its English menu name (found with app.findMenuCommandId) or its numeric id. Commands act on the current selection; one that opens a dialog waits for the user, so prefer the specific tools',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Menu item name, e.g. "Sequence Layers..." or "Center Anchor Point in Layer Content"' },
                id: { type: 'integer', minimum: 1, description: 'Command id instead of a name' },
            },
        },
        auditArgs: { name: 'Select All', id: undefined },
        hints: { destructive: true },
        features: ['aftereffects.automation.execute_menu_command'],
        handler: (a) => {
            if ((a.name === undefined) === (a.id === undefined)) throw new Error('Give name or id');
            return run('Menu command', script(`
var id = ${a.id !== undefined ? Number(a.id) : `app.findMenuCommandId(${str(a.name)})`};
if (!id) throw new Error("No menu command named " + ${str(a.name ?? '')});
app.executeCommand(id);
__result__ = { command: id };`, { undo: 'Menu command' }));
        },
    },
    {
        name: 'execute_aftereffects_code',
        description: 'Run your own ExtendScript in After Effects and return its last expression. It runs unrestricted: it can change or delete anything and read or write files. Prefer the specific tools',
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'ExtendScript (ES3) source' } }, required: ['code'] },
        hints: { destructive: true },
        features: ['aftereffects.automation.run_script_file', 'aftereffects.automation.command_line_scripts'],
        handler: async (a) => {
            if (typeof a.code !== 'string' || !a.code.trim()) throw new Error("'code' is empty");
            const r = await executor.runStructured(a.code);
            return r.ok ? formatResponse(r.result, 'Run code') : formatErrorResponse(r.error, 'Run code');
        },
    },
];

/** help needs the whole tool list, so the server adds it (see server.js). */
export function helpTool(allTools) {
    return {
        name: 'help',
        description: 'List the tools by area, or describe one tool\'s parameters',
        inputSchema: { type: 'object', properties: { tool: { type: 'string', description: 'A tool name' } } },
        hints: { readOnly: true },
        features: [],
        handler: async (a) => {
            if (a.tool) {
                const t = allTools.find((x) => x.name === a.tool);
                if (!t) return formatErrorResponse(`No tool named "${a.tool}"`, 'Help');
                return formatResponse({ name: t.name, description: t.description, parameters: t.inputSchema.properties, required: t.inputSchema.required ?? [] }, 'Help');
            }
            const byArea = {};
            for (const t of allTools) (byArea[t.area] ??= []).push(t.name);
            return formatResponse(byArea, 'Help');
        },
    };
}
