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
import { suiteToolName } from '../src/naming.js';
import { selectedApps } from '../src/apps.js';
import { createSuiteServer } from '../src/server.js';

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

test('suite tool names carry the app once', () => {
    assert.equal(suiteToolName('indesign', 'create_document'), 'indesign_create_document');
    assert.equal(suiteToolName('indesign', 'indesign_status'), 'indesign_status');
    assert.equal(suiteToolName('indesign', 'execute_indesign_code'), 'indesign_execute_code');
    assert.equal(suiteToolName('illustrator', 'execute_illustrator_code'), 'illustrator_execute_code');
    assert.equal(suiteToolName('illustrator', 'help'), 'illustrator_help');
    assert.equal(suiteToolName('aftereffects', 'execute_aftereffects_code'), 'aftereffects_execute_code');
});

test('apps are chosen by --apps, then ADOBE_MCP_APPS, else all', () => {
    assert.deepEqual(selectedApps([], {}), ['indesign', 'illustrator', 'aftereffects']);
    assert.deepEqual(selectedApps(['--apps', 'illustrator'], { ADOBE_MCP_APPS: 'indesign' }), ['illustrator']);
    assert.deepEqual(selectedApps(['--apps=InDesign, illustrator'], {}), ['indesign', 'illustrator']);
    assert.deepEqual(selectedApps([], { ADOBE_MCP_APPS: 'indesign' }), ['indesign']);
    assert.throws(() => selectedApps(['--apps', 'photoshop'], {}), /Unknown app\(s\): photoshop/);
});

test('the combined server has every app tool once, plus the cross-app tools', async () => {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const names = suite.tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, 'duplicate names');
    assert.equal(names.filter((n) => n.startsWith('indesign_')).length, suite.apps.indesign.tools.length);
    assert.equal(names.filter((n) => n.startsWith('illustrator_')).length, suite.apps.illustrator.tools.length);
    assert.ok(names.includes('place_illustrator_artwork_in_indesign'));
    assert.ok(names.includes('copy_swatches_illustrator_to_indesign'));
    for (const t of suite.tools) {
        assert.ok(t.name.length <= 64, `${t.name} is longer than 64 characters`);
        assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} annotations`);
        if (t.name.startsWith('indesign_')) assert.match(t.description, /^InDesign: /);
        if (t.name.startsWith('illustrator_')) assert.match(t.description, /^Illustrator: /);
    }
});

test('one app alone offers no cross-app tools', async () => {
    const suite = await createSuiteServer({ apps: ['illustrator'] });
    assert.ok(suite.tools.every((t) => t.name.startsWith('illustrator_')));
});

test('argument aliases stay with their own app', async () => {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const { ScriptExecutor } = await import('adobe-mcp-indesign');
    const original = ScriptExecutor.executeInDesignScript;
    ScriptExecutor.executeInDesignScript = async () => 'OK';
    try {
        const r = await suite.handleToolCall('indesign_create_rectangle', { x: 10, y: 10, width: 20, height: 20, strokeWidth: 2 });
        assert.deepEqual(r.warnings, ["'strokeWidth' is deprecated; use 'strokeWeight'"]);
    } finally {
        ScriptExecutor.executeInDesignScript = original;
    }
    const ai = await suite.handleToolCall('illustrator_help', { tool: 'illustrator_create_rectangle', strokeWidth: 2 });
    assert.deepEqual(ai.warnings, ["Unknown parameter 'strokeWidth' was ignored"]);
});

test('each app\'s help accepts the suite\'s tool names', async () => {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const ai = await suite.handleToolCall('illustrator_help', { tool: 'illustrator_create_rectangle' });
    assert.equal(ai.success, true);
    assert.equal(ai.result.name, 'create_rectangle');
    const id = await suite.handleToolCall('indesign_help', { tool: 'indesign_create_text_frame' });
    assert.notEqual(id.success, false);
    assert.match(JSON.stringify(id.result), /create_text_frame/);
});

/** Run a cross-app tool with both apps stubbed; return the scripts each was sent. */
async function runCross(name, args, replies) {
    const suite = await createSuiteServer({ apps: ['indesign', 'illustrator'] });
    const sent = { indesign: [], illustrator: [] };
    for (const id of ['indesign', 'illustrator']) {
        suite.apps[id].runStructured = async (source) => {
            sent[id].push(source);
            return { ok: true, result: JSON.stringify(replies[id].shift()) };
        };
    }
    const result = await suite.handleToolCall(name, args);
    return { result, sent };
}

function assertValidScripts(sent) {
    for (const [id, scripts] of Object.entries(sent)) {
        for (const s of scripts) assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings[id]), [], `${id} script`);
    }
}

test('placing artwork: reads the .ai in Illustrator, places that artboard in InDesign', async () => {
    const ai = path.join(os.homedir(), 'Documents', 'logo.ai');
    const { result, sent } = await runCross('place_illustrator_artwork_in_indesign', { artboardIndex: 1, pageIndex: 0, x: 20, y: 30, width: 60 }, {
        illustrator: [{ file: ai, artboard: 'Mark', artboards: 2 }],
        indesign: [{ page: '1', x: 20, y: 30, width: 60, height: 40, linked: ai }],
    });
    assert.equal(result.success, true);
    assert.equal(result.result.indesign.linked, ai);
    assert.equal(sent.illustrator.length, 1);
    assert.equal(sent.indesign.length, 1);
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
    const { result, sent } = await runCross('copy_swatches_illustrator_to_indesign', {}, {
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
    assert.match(sent.indesign[0], /\[0,60,100,0\]/, 'CMYK values reach InDesign unconverted');
    assertValidScripts(sent);
});

test('copying named swatches that do not exist is an error', async () => {
    await assert.rejects(runCross('copy_swatches_illustrator_to_indesign', { names: ['Nope'] }, {
        illustrator: [{ colorMode: 'RGB', swatches: [], skipped: [] }],
        indesign: [],
    }), /no swatch named: Nope/);
});

test('an MCP client sees the chosen apps', async () => {
    const { app: ai } = await import('adobe-mcp-illustrator');
    const { app: id } = await import('adobe-mcp-indesign');
    for (const [apps, expect] of [['illustrator', ai.tools.length], ['indesign,illustrator', ai.tools.length + id.tools.length + 2]]) {
        const client = new Client({ name: 'test', version: '0' });
        await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.js', import.meta.url).pathname, '--apps', apps] }));
        try {
            const { tools } = await client.listTools();
            assert.equal(tools.length, expect, apps);
            const instructions = client.getInstructions();
            assert.match(instructions, /## Illustrator/);
            if (apps.includes('indesign')) assert.match(instructions, /## InDesign/);
        } finally {
            await client.close();
        }
    }
});
