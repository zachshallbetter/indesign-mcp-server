/**
 * Status, running your own UXP code, and help.
 */
import { formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, PLUGIN_DIR } from '../executor.js';

export const tools = [
    {
        name: 'premiere_status',
        description: 'Check the connection to Premiere Pro: the port the server listens on, whether the plugin is connected, Premiere Pro\'s version, and (with probe) the active project and sequence. Use this first when a call fails to connect',
        inputSchema: {
            type: 'object',
            properties: { probe: { type: 'boolean', description: 'Also ask Premiere Pro for the active project and sequence. Default true', default: true } },
        },
        hints: { readOnly: true },
        features: ['premiere.automation.uxp_plugins', 'premiere.application.version_info'],
        handler: async (a) => {
            try {
                await executor.start();
            } catch (error) {
                return formatErrorResponse({ connected: false, pluginFolder: PLUGIN_DIR, error: error.message }, 'Status');
            }
            const status = { ...(await executor.status()), pluginFolder: PLUGIN_DIR };
            if (!status.connected) {
                return formatErrorResponse({ ...status, error: 'Premiere Pro is not connected: load the plugin folder with the UXP Developer Tool and open its MCP Bridge panel in Premiere Pro' }, 'Status');
            }
            if (a.probe === false) return formatResponse(status, 'Status', () => false);
            try {
                const r = await executor.runStructured(script(`
const project = await ppro.Project.getActiveProject();
if (!project) return { project: null };
const seq = await project.getActiveSequence();
return { project: { name: project.name, path: project.path }, activeSequence: seq ? { name: seq.name, guid: __id(seq.guid) } : null };`));
                if (!r.ok) return formatErrorResponse({ ...status, error: r.error }, 'Status');
                return formatResponse({ ...status, premiere: r.result }, 'Status', () => false);
            } catch (error) {
                return formatErrorResponse({ ...status, error: error.message }, 'Status');
            }
        },
    },
    {
        name: 'execute_premiere_code',
        description: 'Run your own UXP JavaScript in Premiere Pro, as the body of an async function with ppro (require("premierepro")) and transact(project, undoName, build) in scope; build(add) receives add(action) for each Action, created inside the project lock as Premiere Pro 26.3 requires. Return a JSON-friendly value. It runs unrestricted: it can change or delete anything. Prefer the specific tools',
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Async function body, e.g. const p = await ppro.Project.getActiveProject(); return p.name;' } }, required: ['code'] },
        hints: { destructive: true },
        features: ['premiere.automation.uxp_plugins'],
        handler: async (a) => {
            if (typeof a.code !== 'string' || !a.code.trim()) throw new Error("'code' is empty");
            const r = await executor.runStructured(a.code);
            return r.ok ? formatResponse(r.result, 'Run code', () => false) : formatErrorResponse(r.error, 'Run code');
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
                return formatResponse({
                    name: t.name, description: t.description, parameters: t.inputSchema.properties, required: t.inputSchema.required ?? [],
                    ...(t.since ? { needsPremierePro: t.since } : {}),
                }, 'Help', () => false);
            }
            const byArea = {};
            for (const t of allTools) (byArea[t.area] ??= []).push(t.name);
            return formatResponse(byArea, 'Help', () => false);
        },
    };
}
