/**
 * Protocol smoke test: starts the server over stdio with the MCP SDK client
 * and checks the handshake and tool list. Does not need InDesign running.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { allToolDefinitions } from '../../src/types/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

let passed = 0;
const queue = [];
function test(name, fn) {
    queue.push({ name, fn });
}

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, pkg.bin['indesign-mcp-server'])],
    stderr: 'pipe',
});
const client = new Client({ name: 'protocol-test', version: '0.0.0' });

test('handshake reports the package name and version', async () => {
    const info = client.getServerVersion();
    assert.equal(info.name, 'indesign-mcp-server');
    assert.equal(info.version, pkg.version);
});

test('server sends usage instructions at initialize', async () => {
    const instructions = client.getInstructions();
    assert.ok(instructions && instructions.includes('millimeters'), 'instructions missing');
});

test('tools/list carries titles and annotations', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
        assert.ok(tool.title, `${tool.name} has no title`);
        assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} annotations`);
    }
    assert.equal(tools.find((t) => t.name === 'delete_page').annotations.destructiveHint, true);
    assert.equal(tools.find((t) => t.name === 'list_layers').annotations.readOnlyHint, true);
});

test('tools/list returns every tool definition', async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, allToolDefinitions.length);
    assert.ok(tools.length >= 130, `expected 130+ tools, got ${tools.length}`);
});

test('tool names are unique and every schema is an object schema', async () => {
    const { tools } = await client.listTools();
    const names = new Set();
    for (const tool of tools) {
        assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
        names.add(tool.name);
        assert.equal(tool.inputSchema?.type, 'object', `${tool.name} inputSchema.type`);
    }
});

test('unknown tool returns an error result instead of crashing', async () => {
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });
    const text = result.content.map((c) => c.text).join('');
    assert.match(text, /not found/i);
    assert.equal(result.isError, true);
});

test('help lists every advertised tool and documents each one', async () => {
    const { tools } = await client.listTools();
    const overview = await client.callTool({ name: 'help', arguments: { format: 'detailed' } });
    const text = overview.content.map((c) => c.text).join('');
    for (const tool of tools) {
        assert.ok(text.includes(tool.name), `help overview is missing ${tool.name}`);
        const one = await client.callTool({ name: 'help', arguments: { tool: tool.name } });
        assert.notEqual(one.isError, true, `help({ tool: "${tool.name}" }) failed`);
    }
});

async function run() {
    await client.connect(transport);
    try {
        for (const { name, fn } of queue) {
            try {
                await fn();
                passed++;
                console.log(`ok - ${name}`);
            } catch (e) {
                console.error(`not ok - ${name}`);
                console.error('  ', e.message);
                process.exitCode = 1;
            }
        }
    } finally {
        await client.close();
    }
    console.log(`\n${passed} protocol tests passed`);
}

run();
