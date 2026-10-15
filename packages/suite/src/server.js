/**
 * The suite: one MCP server with the tools of every chosen Adobe application,
 * plus tools that work across them.
 *
 * Each application's tools come from its own package, unchanged; the suite
 * prefixes their names with the application (see naming.js) and keeps each
 * one's argument aliases and value rewrites scoped to that application.
 */
import { readFileSync } from 'node:fs';
import { createMcpServer } from 'adobe-mcp-core';
import { loadApps, selectedApps } from './apps.js';
import { suiteToolName, suiteDescription } from './naming.js';
import { placeArtwork } from './cross/artwork.js';
import { copySwatches } from './cross/swatches.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Tools that span applications. Each is offered only when every app it needs is loaded. */
export const CROSS_TOOLS = [placeArtwork, copySwatches];

function instructions(apps, cross) {
    const list = Object.values(apps);
    const parts = [
        `This server drives Adobe applications on the user's machine: ${list.map((a) => a.label).join(', ')}.`,
        `Each application's tools are prefixed with its name (${list.map((a) => `${a.id}_…`).join(', ')}). Each application has its own units and conventions, described below; follow the section for the tool you call.`,
    ];
    if (cross.length) {
        parts.push(`Tools without a prefix work across applications: ${cross.map((t) => t.name).join(', ')}.`);
    }
    for (const a of list) {
        parts.push(`## ${a.label}\n\nIn this section tool names are written without the ${a.id}_ prefix.\n\n${a.instructions}`);
    }
    return parts.join('\n\n');
}

/**
 * Combine apps into one tool list.
 * @param {Record<string, object>} apps loaded app modules, by id
 */
export function combine(apps) {
    const tools = [];
    const handlers = {};
    const aliases = [];
    const origin = new Map();

    for (const app of Object.values(apps)) {
        const names = new Map(app.tools.map((t) => [t.name, suiteToolName(app.id, t.name)]));
        for (const t of app.tools) {
            const name = names.get(t.name);
            if (handlers[name]) throw new Error(`Two tools would be named ${name}`);
            tools.push({ ...t, name, description: suiteDescription(app.label, t.description) });
            origin.set(name, { app, original: t.name });
            handlers[name] = t.name === 'help' ? helpFor(app, names, app.handlers.help) : app.handlers[t.name];
        }
        for (const alias of app.aliases ?? []) {
            aliases.push({ ...alias, tools: (alias.tools ?? app.tools.map((t) => t.name)).map((n) => names.get(n)).filter(Boolean) });
        }
    }

    for (const cross of CROSS_TOOLS) {
        if (!cross.requires.every((id) => id in apps)) continue;
        if (handlers[cross.name]) throw new Error(`Two tools would be named ${cross.name}`);
        tools.push({
            name: cross.name,
            title: cross.name.split('_').map((w) => ({ indesign: 'InDesign' })[w] ?? w[0].toUpperCase() + w.slice(1)).join(' '),
            description: cross.description,
            inputSchema: cross.inputSchema,
            annotations: cross.annotations,
        });
        handlers[cross.name] = (args) => cross.handler(apps, args);
    }

    /** Each app's value rewrites, applied only to that app's tools, with its own tool names. */
    function normalizeValues(tool, out, props, warnings) {
        const o = origin.get(tool);
        o?.app.normalizeValues?.(o.original, out, props, warnings);
    }

    return { tools, handlers, aliases, normalizeValues, instructions: instructions(apps, CROSS_TOOLS.filter((c) => handlers[c.name])) };
}

/** An app's help, accepting the suite's prefixed names as well as its own. */
function helpFor(app, names, help) {
    const original = new Map([...names].map(([orig, suite]) => [suite, orig]));
    return (args = {}) => help({ ...args, ...(args.tool ? { tool: original.get(args.tool) ?? args.tool } : {}) });
}

/** The suite server for the chosen apps (default: from --apps / ADOBE_MCP_APPS, else all). */
export async function createSuiteServer({ apps: ids = selectedApps() } = {}) {
    const apps = await loadApps(ids);
    for (const app of Object.values(apps)) app.cleanup?.();
    const suite = combine(apps);
    return {
        apps,
        ...createMcpServer({
            info: { name: pkg.name, version: pkg.version },
            instructions: suite.instructions,
            tools: suite.tools,
            handlers: suite.handlers,
            aliases: suite.aliases,
            normalizeValues: suite.normalizeValues,
        }),
    };
}
