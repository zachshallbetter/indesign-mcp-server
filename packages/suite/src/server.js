/**
 * The suite coordinates cross-application workflows through each app's MCP
 * server. Direct app tools remain available from their standalone servers.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer } from 'adobe-mcp-core';
import { loadApps, selectedApps } from './apps.js';
import { placeArtwork } from './cross/artwork.js';
import { copySwatches } from './cross/swatches.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const ENV_PREFIXES = {
    indesign: ['INDESIGN_', 'DESIGNCRAFT_'],
    illustrator: ['ILLUSTRATOR_', 'VECTORCRAFT_'],
    photoshop: ['PHOTOSHOP_', 'PHOTOCRAFT_'],
    aftereffects: ['AFTEREFFECTS_', 'EFFECTCRAFT_'],
    premiere: ['PREMIERE_', 'FILMCRAFT_'],
};
const ROUTING_ENV = [
    'ADOBE_TARGET', 'ADOBE_BACKEND', 'TARGET', 'BACKEND', 'ARTCRAFT_ENABLED',
    'ARTCRAFT_CONTROL_PORT', 'ARTCRAFT_CONTROL_TOKEN', 'ARTCRAFT_CONTROL_TOKEN_FILE',
];
const APP_ENV = {
    indesign: ['UXP_BRIDGE_URL', 'BRIDGE_TOKEN'],
    illustrator: [],
    photoshop: [],
    aftereffects: [],
    premiere: ['BRIDGE_TOKEN'],
};

export function appEnvironment(id, source = process.env) {
    const prefixes = ENV_PREFIXES[id];
    if (!prefixes) throw new Error(`Unknown Adobe app: ${id}`);
    return Object.fromEntries([
        ...Object.entries(getDefaultEnvironment()),
        ...Object.entries(source).filter(([name]) => ROUTING_ENV.includes(name)
            || APP_ENV[id].includes(name)
            || prefixes.some((prefix) => name.startsWith(prefix))),
    ]);
}

/** Workflows that require multiple connected app servers. */
export const CROSS_TOOLS = [placeArtwork, copySwatches];

function instructions(apps, cross) {
    const names = Object.values(apps).map((app) => app.label);
    return [
        `This coordinator connects to the standalone MCP servers for ${names.join(', ')}.`,
        `It exposes only cross-application workflows: ${cross.map((tool) => tool.name).join(', ') || 'none for the selected applications'}.`,
        'For direct control of an application, configure that application’s standalone MCP server in your client.',
    ].join('\n\n');
}

/** Register cross-app tools whose required app MCP servers are connected. */
export function combine(apps) {
    const tools = [];
    const handlers = {};
    const cross = CROSS_TOOLS.filter((tool) => tool.requires.every((id) => id in apps));
    for (const workflow of cross) {
        if (handlers[workflow.name]) throw new Error(`Duplicate coordinator tool: ${workflow.name}`);
        tools.push({
            name: workflow.name,
            title: workflow.name.split('_').map((word) => ({ indesign: 'InDesign' })[word] ?? word[0].toUpperCase() + word.slice(1)).join(' '),
            description: workflow.description,
            inputSchema: workflow.inputSchema,
            annotations: workflow.annotations,
        });
        handlers[workflow.name] = (args) => workflow.handler(apps, args);
    }
    return { tools, handlers, instructions: instructions(apps, cross) };
}

async function connectApp(app) {
    const client = new Client({ name: `${pkg.name}-${app.id}-client`, version: pkg.version });
    const packageName = `adobe-mcp-${app.id}`;
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const appPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const executable = appPackage.bin?.[packageName];
    if (typeof executable !== 'string') throw new Error(`${packageName} has no ${packageName} executable`);
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve(path.dirname(packageJsonPath), executable)],
        env: appEnvironment(app.id),
    });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        const executeTool = `execute_${app.id}_code`;
        if (!tools.some((tool) => tool.name === executeTool)) {
            throw new Error(`${app.label} MCP server does not expose ${executeTool}`);
        }
        return {
            id: app.id,
            label: app.label,
            validatePath: app.validatePath,
            executeTool,
            callTool: (name, args) => client.callTool({ name, arguments: args }),
            close: () => client.close(),
        };
    } catch (error) {
        await client.close();
        throw error;
    }
}

/** Start a coordinator connected to selected app servers (default: InDesign + Illustrator). */
export async function createSuiteServer({ apps: ids = selectedApps() } = {}) {
    const modules = await loadApps(ids);
    const apps = {};
    try {
        for (const [id, app] of Object.entries(modules)) apps[id] = await connectApp(app);
        const suite = combine(apps);
        const server = createMcpServer({
            info: { name: pkg.name, version: pkg.version },
            instructions: suite.instructions,
            tools: suite.tools,
            handlers: suite.handlers,
        });
        let closed = false;
        const closeSuite = async () => {
            if (closed) return;
            closed = true;
            process.stdin.off('end', onInputEnd);
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            await Promise.all(Object.values(apps).map((app) => app.close()));
            await server.server.close();
        };
        const closeFromProcessEvent = () => {
            void closeSuite().catch((error) => {
                console.error('Failed to close Adobe MCP Suite:', error.message);
                process.exitCode = 1;
            });
        };
        const onInputEnd = () => closeFromProcessEvent();
        const onSignal = () => closeFromProcessEvent();
        return {
            ...server,
            apps,
            close: closeSuite,
            async run() {
                process.stdin.once('end', onInputEnd);
                process.once('SIGINT', onSignal);
                process.once('SIGTERM', onSignal);
                try {
                    await server.run();
                } catch (error) {
                    await closeSuite();
                    throw error;
                }
            },
        };
    } catch (error) {
        await Promise.all(Object.values(apps).map((app) => app.close()));
        throw error;
    }
}
