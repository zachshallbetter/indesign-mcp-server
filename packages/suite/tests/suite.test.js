import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { wrapScriptForStructuredResult } from 'adobe-mcp-core';
import { checkScript, loadTypings } from 'adobe-mcp-core/testing';
import { selectedApps } from '../src/apps.js';
import { appEnvironment, createSuiteServer } from '../src/server.js';

const require = createRequire(import.meta.url);
const types = path.dirname(require.resolve('types-for-adobe/package.json'));
const shared = ['shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => path.join(types, f));
const illustratorFixture = JSON.parse(readFileSync(new URL('../../illustrator/tests/fixtures/illustrator-object-model.json', import.meta.url), 'utf8'));
const typings = {
    indesign: loadTypings({ files: [path.join(types, 'InDesign/2023/index.d.ts'), ...shared], allowedNames: ['hasOwnProperty'] }),
    illustrator: loadTypings({
        files: [path.join(types, 'Illustrator/2022/index.d.ts'), ...shared],
        allowedNames: [...illustratorFixture.members, 'hasOwnProperty', 'ids', 'names', 'v'],
        allowedGlobals: [...illustratorFixture.globals, 'ElementPlacement'],
    }),
};

test('MCP Registry metadata matches the package and stays within its description limit', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const serverJson = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    assert.equal(serverJson.version, packageJson.version);
    assert.equal(serverJson.packages[0].version, packageJson.version);
    assert.ok(serverJson.description.length <= 100, 'server description exceeds the MCP Registry limit');
    const appsVariable = serverJson.packages[0].environmentVariables.find(({ name }) => name === 'ADOBE_MCP_APPS');
    assert.match(appsVariable.description, /Defaults to InDesign and Illustrator/);
});

test('apps are chosen by --apps, then ADOBE_MCP_APPS, else cross-workflow defaults', () => {
    assert.deepEqual(selectedApps([], {}), ['indesign', 'illustrator']);
    assert.deepEqual(selectedApps([], { ADOBE_MCP_APPS: 'all' }), ['indesign', 'illustrator', 'photoshop', 'aftereffects', 'premiere']);
    assert.deepEqual(selectedApps(['--apps', 'illustrator'], { ADOBE_MCP_APPS: 'indesign' }), ['illustrator']);
    assert.deepEqual(selectedApps(['--apps=InDesign, illustrator'], {}), ['indesign', 'illustrator']);
    assert.deepEqual(selectedApps([], { ADOBE_MCP_APPS: 'indesign' }), ['indesign']);
    assert.throws(() => selectedApps(['--apps', 'lightroom'], {}), /Unknown app\(s\): lightroom/);
});

test('app child processes inherit only their documented config variables', () => {
    const env = appEnvironment('illustrator', {
        ILLUSTRATOR_ALLOWED_DIRS: '/safe',
        VECTORCRAFT_CONTROL_TOKEN: 'craft-token',
        ADOBE_TARGET: 'craft',
        ARTCRAFT_ENABLED: 'true',
        ARTCRAFT_CONTROL_TOKEN: 'shared-craft-token',
        UXP_BRIDGE_URL: 'http://127.0.0.1:4321',
        INDESIGN_ALLOWED_DIRS: '/other-app',
        BRIDGE_TOKEN: 'bridge-token',
        NPM_TOKEN: 'must-not-be-forwarded',
    });
    assert.equal(env.ILLUSTRATOR_ALLOWED_DIRS, '/safe');
    assert.equal(env.VECTORCRAFT_CONTROL_TOKEN, 'craft-token');
    assert.equal(env.ADOBE_TARGET, 'craft');
    assert.equal(env.ARTCRAFT_ENABLED, 'true');
    assert.equal(env.ARTCRAFT_CONTROL_TOKEN, 'shared-craft-token');
    assert.equal(env.UXP_BRIDGE_URL, undefined);
    assert.equal(env.INDESIGN_ALLOWED_DIRS, undefined);
    assert.equal(env.BRIDGE_TOKEN, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    const indesignEnv = appEnvironment('indesign', {
        INDESIGN_BACKEND: 'uxp',
        UXP_BRIDGE_URL: 'http://127.0.0.1:4321',
        BRIDGE_TOKEN: 'bridge-token',
        PREMIERE_WS_PORT: '3011',
    });
    assert.equal(indesignEnv.INDESIGN_BACKEND, 'uxp');
    assert.equal(indesignEnv.UXP_BRIDGE_URL, 'http://127.0.0.1:4321');
    assert.equal(indesignEnv.BRIDGE_TOKEN, 'bridge-token');
    assert.equal(indesignEnv.PREMIERE_WS_PORT, undefined);
    assert.throws(() => appEnvironment('unknown', {}), /Unknown Adobe app/);
});

test('the coordinator advertises only the workflows supported by its connected apps', async () => {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const names = suite.tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, 'duplicate names');
    assert.deepEqual(names, ['place_illustrator_artwork_in_indesign', 'copy_swatches_illustrator_to_indesign']);
    for (const t of suite.tools) {
        assert.ok(t.name.length <= 64, `${t.name} is longer than 64 characters`);
        assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} annotations`);
    }
    await suite.close();
});

test('apps without cross-app workflows add no app tools to the coordinator', async () => {
    const suite = await createSuiteServer({ apps: ['photoshop', 'illustrator'] });
    assert.deepEqual(suite.tools, []);
    await suite.close();
});

test('connecting Premiere Pro does not open its plugin port until a tool is called', async () => {
    const suite = await createSuiteServer({ apps: ['premiere', 'illustrator'] });
    const { executor } = await import('adobe-mcp-premiere');
    assert.equal((await executor.status()).mode, 'stopped', 'the plugin port opens on the first Premiere Pro call');
    await suite.close();
});

test('one app alone offers no cross-app tools', async () => {
    const suite = await createSuiteServer({ apps: ['illustrator'] });
    assert.deepEqual(suite.tools, []);
    await suite.close();
});

/** Run a cross-app tool with both apps stubbed; return the scripts each was sent. */
async function runCross(name, args, replies) {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const sent = { indesign: [], illustrator: [] };
    const calls = [];
    try {
        for (const id of ['indesign', 'illustrator']) {
            suite.apps[id].callTool = async (toolName, { code }) => {
                calls.push({ app: id, tool: toolName });
                sent[id].push(code);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, result: JSON.stringify(replies[id].shift()) }) }] };
            };
        }
        const result = await suite.handleToolCall(name, args);
        return { result, sent, calls };
    } finally {
        await suite.close();
    }
}

function assertValidScripts(sent) {
    for (const [id, scripts] of Object.entries(sent)) {
        for (const s of scripts) assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings[id]), [], `${id} script`);
    }
}

test('placing artwork: reads the .ai in Illustrator, places that artboard in InDesign', async () => {
    const ai = path.join(os.homedir(), 'Documents', 'logo.ai');
    const { result, sent, calls } = await runCross('place_illustrator_artwork_in_indesign', { artboardIndex: 1, pageIndex: 0, x: 20, y: 30, width: 60 }, {
        illustrator: [{ file: ai, artboard: 'Mark', artboards: 2 }],
        indesign: [{ page: '1', x: 20, y: 30, width: 60, height: 40, linked: ai }],
    });
    assert.equal(result.success, true);
    assert.equal(result.result.indesign.linked, ai);
    assert.equal(sent.illustrator.length, 1);
    assert.equal(sent.indesign.length, 1);
    assert.deepEqual(calls, [
        { app: 'illustrator', tool: 'execute_illustrator_code' },
        { app: 'indesign', tool: 'execute_indesign_code' },
    ]);
    assert.match(sent.indesign[0], /prefs\.pageNumber = 2;/, 'artboard 1 is PDF page 2');
    assert.match(sent.indesign[0], /prefs\.pdfCrop = PDFCrop\.CROP_ART;/);
    assert.match(sent.indesign[0], /\} finally \{\n {2}prefs\.pageNumber = oldPage;/, 'place preferences are restored');
    assertValidScripts(sent);
});

test('placing artwork refuses a file outside the allowed folders', async () => {
    await assert.rejects(runCross('place_illustrator_artwork_in_indesign', { pageIndex: 0 }, {
        illustrator: [{ file: '/etc/logo.ai', artboard: 'A', artboards: 1 }],
        indesign: [],
    }), /outside the allowed directories/);
});

test('copying swatches: exact values, spot inks, gradients reported', async () => {
    const { result, sent, calls } = await runCross('copy_swatches_illustrator_to_indesign', {}, {
        illustrator: [{
            colorMode: 'CMYK',
            swatches: [
                { name: 'Brand Orange', space: 'CMYK', value: [0, 60, 100, 0] },
                { name: 'PANTONE 185 C', spot: true, space: 'CMYK', value: [0, 91, 76, 0] },
            ],
            skipped: [{ name: 'Sunset', kind: 'GradientColor' }],
        }],
        indesign: [{ created: ['Brand Orange', 'PANTONE 185 C'], updated: [], kept: [] }],
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.result.created, ['Brand Orange', 'PANTONE 185 C']);
    assert.deepEqual(result.result.notCopied, [{ name: 'Sunset', kind: 'GradientColor' }]);
    assert.deepEqual(calls, [
        { app: 'illustrator', tool: 'execute_illustrator_code' },
        { app: 'indesign', tool: 'execute_indesign_code' },
    ]);
    assert.match(sent.indesign[0], /\[0,60,100,0\]/, 'CMYK values reach InDesign unconverted');
    assertValidScripts(sent);
});

test('copying named swatches that do not exist is an error', async () => {
    await assert.rejects(runCross('copy_swatches_illustrator_to_indesign', { names: ['Nope'] }, {
        illustrator: [{ colorMode: 'RGB', swatches: [], skipped: [] }],
        indesign: [],
    }), /no swatch named: Nope/);
});

test('standalone app MCPs retain their full tool inventories', async () => {
    for (const name of ['adobe-mcp-illustrator', 'adobe-mcp-indesign', 'adobe-mcp-photoshop', 'adobe-mcp-aftereffects', 'adobe-mcp-premiere']) {
        const { app } = await import(name);
        const packageJsonPath = require.resolve(`${name}/package.json`);
        const appPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const executable = appPackage.bin?.[name];
        assert.equal(typeof executable, 'string', `${name} executable`);
        const client = new Client({ name: 'test', version: '0' });
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [path.resolve(path.dirname(packageJsonPath), executable)],
        }));
        try {
            const { tools } = await client.listTools();
            assert.equal(tools.length, app.tools.length, name);
            const help = await client.callTool({ name: 'help', arguments: {} });
            assert.equal(help.isError, false, `${name} help handler`);
        } finally {
            await client.close();
        }
    }
});

test('cross-app workflow delegates through the connected MCP tool clients', async () => {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const calls = [];
    for (const app of Object.values(suite.apps)) {
        app.callTool = async (name, args) => {
            calls.push({ app: app.id, name, args });
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, result: JSON.stringify(app.id === 'illustrator' ? { file: path.join(os.homedir(), 'logo.ai'), artboard: 'A', artboards: 1 } : { page: '1', x: 10, y: 10, width: 20, height: 20, linked: path.join(os.homedir(), 'logo.ai') }) }) }] };
        };
    }
    const result = await suite.handleToolCall('place_illustrator_artwork_in_indesign', { pageIndex: 0 });
    assert.equal(result.success, true);
    assert.deepEqual(calls.map(({ app, name }) => [app, name]), [
        ['illustrator', 'execute_illustrator_code'],
        ['indesign', 'execute_indesign_code'],
    ]);
    await suite.close();
});

test('an MCP client sees only coordinator workflows over stdio', async () => {
    const client = new Client({ name: 'suite-list-test', version: '0' });
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [new URL('../src/index.js', import.meta.url).pathname, '--apps', 'indesign,illustrator'],
    }));
    try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name), [
            'place_illustrator_artwork_in_indesign',
            'copy_swatches_illustrator_to_indesign',
        ]);
        assert.match(client.getInstructions(), /direct control of an application/i);
    } finally {
        await client.close();
    }
});
