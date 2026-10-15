/**
 * Status, playing actions, running ExtendScript, and help.
 */
import { str, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';

export const tools = [
    {
        name: 'photoshop_status',
        description: 'Check that Photoshop is reachable: platform, how the server addresses Photoshop, whether it is running, its version and open documents. Use this first when a call fails to connect',
        inputSchema: { type: 'object', properties: { probe: { type: 'boolean', description: 'Ask Photoshop for its version and documents (starts Photoshop if it is not running). Default true', default: true } } },
        hints: { readOnly: true },
        features: [],
        handler: async (a) => {
            const status = await executor.status();
            if (a.probe === false) return formatResponse(status, 'Status');
            try {
                const r = await executor.runStructured(script(`
__result__ = { version: app.version, build: app.build, scriptingVersion: app.scriptingVersion, documents: app.documents.length, active: app.documents.length ? app.activeDocument.name : null };`, { needsDocument: false }));
                if (!r.ok) return formatErrorResponse({ ...status, error: r.error }, 'Status');
                return formatResponse({ ...status, photoshop: JSON.parse(r.result) }, 'Status');
            } catch (error) {
                return formatErrorResponse({ ...status, error: error.message }, 'Status');
            }
        },
    },
    {
        name: 'play_action',
        description: 'Play an action from the Actions panel by its name and set. Dialogs in the action stay closed and use their recorded settings',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'Action name, e.g. "Vignette (selection)"' },
                set: { type: 'string', description: 'Action set name, e.g. "Default Actions"' },
            },
            required: ['action', 'set'],
        },
        features: [],
        handler: (a) => run('Play action', script(`
app.doAction(${str(a.action)}, ${str(a.set)});
__result__ = { played: ${str(a.action)}, set: ${str(a.set)}, document: app.documents.length ? __docInfo(app.activeDocument) : null };`, { needsDocument: false })),
    },
    {
        name: 'execute_photoshop_code',
        description: 'Run your own ExtendScript in Photoshop and return its last expression. It runs unrestricted: it can change or delete anything and read or write files. Prefer the specific tools',
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'ExtendScript (ES3) source' } }, required: ['code'] },
        hints: { destructive: true },
        features: [],
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
