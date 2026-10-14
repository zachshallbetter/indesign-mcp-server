/**
 * Status, menu commands, running ExtendScript, and help.
 */
import { readFileSync } from 'node:fs';
import { str, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

const COMMANDS = JSON.parse(readFileSync(new URL('../data/menu-commands.json', import.meta.url), 'utf8')).commands;
const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export const tools = [
    {
        name: 'illustrator_status',
        description: 'Check that Illustrator is reachable: platform, how the server addresses Illustrator, whether it is running, its version and open documents. Use this first when a call fails to connect',
        inputSchema: { type: 'object', properties: { probe: { type: 'boolean', description: 'Ask Illustrator for its version and documents (starts Illustrator if it is not running). Default true', default: true } } },
        features: ['illustrator.automation.scripting_languages'],
        handler: async (a) => {
            const status = await executor.status();
            if (a.probe === false) return formatResponse(status, 'Status');
            try {
                const r = await executor.runStructured(script(`
__result__ = { version: app.version, documents: app.documents.length, active: app.documents.length ? app.activeDocument.name : null };`, { needsDocument: false }));
                if (!r.ok) return formatErrorResponse({ ...status, error: r.error }, 'Status');
                return formatResponse({ ...status, illustrator: JSON.parse(r.result) }, 'Status');
            } catch (error) {
                return formatErrorResponse({ ...status, error: error.message }, 'Status');
            }
        },
    },
    {
        name: 'execute_menu_command',
        description: 'Run an Illustrator menu command by its executeMenuCommand name (e.g. "outline" = Type > Create Outlines, "expandStyle" = Object > Expand Appearance). Illustrator reports nothing back and silently ignores names it does not know, so the result is the selection and document state afterwards. Commands that open a dialog wait for the user. Use find_menu_commands to look names up',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'executeMenuCommand name' },
                target: { ...TARGET_SCHEMA, description: 'Select these items first. Many commands act only on the selection' },
                allowUnknown: { type: 'boolean', description: 'Run a name that is not in the known command list. Default false', default: false },
            },
            required: ['command'],
        },
        features: ['illustrator.automation.execute_menu_command'],
        handler: (a) => {
            const cmd = String(a.command ?? '');
            if (!/^[\w .&/-]{1,80}$/.test(cmd)) throw new Error(`Invalid command name: ${JSON.stringify(cmd)}`);
            const known = BY_ID.get(cmd);
            if (!known && !a.allowUnknown) {
                const near = COMMANDS.filter((c) => c.id.toLowerCase().includes(cmd.toLowerCase()) || c.name.toLowerCase().includes(cmd.toLowerCase())).slice(0, 8).map((c) => c.id);
                return formatErrorResponse(`Unknown command "${cmd}". Illustrator would ignore it silently.${near.length ? ` Close matches: ${near.join(', ')}` : ''} Pass allowUnknown: true to run it anyway.`, 'Menu command');
            }
            return run('Menu command', script(`
${a.target ? `var items = __targets(doc, ${targetSpec(a.target)}); doc.selection = null; for (var i = 0; i < items.length; i++) items[i].selected = true;` : ''}
var before = { items: doc.pageItems.length, selection: doc.selection ? doc.selection.length : 0 };
app.executeMenuCommand(${str(cmd)});
var sel = doc.selection, after = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 50; j++) { try { after.push(__itemInfo(doc, sel[j])); } catch (e) { after.push({ type: sel[j].typename }); } }
__result__ = { command: ${str(cmd)}, name: ${str(known?.name ?? '')}, before: before, after: { items: doc.pageItems.length, selection: sel ? sel.length : 0 }, selection: after };`));
        },
    },
    {
        name: 'find_menu_commands',
        description: 'Search the known executeMenuCommand names by command name or menu path',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 } }, required: ['query'] },
        features: ['illustrator.automation.execute_menu_command'],
        handler: async (a) => {
            const q = String(a.query).toLowerCase();
            const hits = COMMANDS.filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.menu.join(' > ').toLowerCase().includes(q));
            return formatResponse({
                total: hits.length,
                commands: hits.slice(0, Math.min(200, a.limit ?? 30)).map((c) => ({ command: c.id, menu: [...c.menu, c.name].filter(Boolean).join(' > '), needsSelection: c.selection, documented: c.documented })),
            }, 'Find menu commands');
        },
    },
    {
        name: 'execute_illustrator_code',
        description: 'Run your own ExtendScript in Illustrator and return its last expression. It runs unrestricted: it can change or delete anything and read or write files. Prefer the specific tools',
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'ExtendScript (ES3) source' } }, required: ['code'] },
        features: ['illustrator.automation.scripting_languages'],
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
