import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, createAnnotations, createArgNormalizer, createExecutor, formatResponse } from '../src/index.js';
import { auditTools, loadTypings } from '../src/testing/audit.js';

const tools = [
    { name: 'set_stroke', description: 'Set stroke', inputSchema: { type: 'object', properties: { strokeWeight: { type: 'number' }, color: { type: 'string' } } } },
    { name: 'get_info', description: 'Info', inputSchema: { type: 'object', properties: {} } },
];

function fakeExecutor() {
    return { runScript: async () => 'live run', runStructured: async () => ({ ok: true }) };
}

function server(executor = fakeExecutor()) {
    return createMcpServer({
        info: { name: 'test-server', version: '0.0.0' },
        tools,
        aliases: [{ old: 'strokeWidth', canonical: 'strokeWeight' }],
        handlers: {
            set_stroke: async (a) => formatResponse(await executor.runScript(`app.activeDocument.selection[0].strokeWidth = ${a.strokeWeight};`), 'Set stroke'),
            get_info: async () => formatResponse('No document open', 'Info'),
        },
    });
}

test('aliases map to canonical names with a deprecation warning', async () => {
    const r = await server().handleToolCall('set_stroke', { strokeWidth: 2 });
    assert.equal(r.success, true);
    assert.deepEqual(r.warnings, ["'strokeWidth' is deprecated; use 'strokeWeight'"]);
});

test('the canonical name wins over an alias', () => {
    const n = createArgNormalizer({ tools, aliases: [{ old: 'strokeWidth', canonical: 'strokeWeight' }] });
    const w = [];
    assert.deepEqual(n.normalizeArgs('set_stroke', { strokeWidth: 1, strokeWeight: 3 }, w), { strokeWeight: 3 });
    assert.match(w[0], /ignored because 'strokeWeight' was also given/);
});

test('unknown arguments are reported with the closest valid name', async () => {
    const r = await server().handleToolCall('set_stroke', { strokeWeight: 1, colour: 'Black', zzz: 1 });
    assert.deepEqual(r.warnings, [
        "Unknown parameter 'colour' was ignored; did you mean 'color'?",
        "Unknown parameter 'zzz' was ignored",
    ]);
});

test('failure strings become success:false; unknown tools are refused', async () => {
    assert.equal((await server().handleToolCall('get_info', {})).success, false);
    assert.match((await server().handleToolCall('nope', {})).result, /Tool 'nope' not found/);
});

test('every advertised tool must have a handler', () => {
    assert.throws(() => createMcpServer({ info: { name: 'x', version: '0' }, tools, handlers: {} }), /No handler for advertised tool\(s\): set_stroke, get_info/);
});

test('annotations: lists decide the hints, titles are derived', () => {
    const a = createAnnotations({ readOnly: ['get_info'], destructive: ['delete_artboard'], idempotent: ['set_stroke'], words: { svg: 'SVG' } });
    assert.deepEqual(a.annotationsFor('get_info'), { title: 'Get Info', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(a.titleFor('export_svg'), 'Export SVG');
    assert.deepEqual(a.unknownAnnotationNames(['get_info', 'set_stroke']), ['delete_artboard']);
    assert.equal(a.annotate(tools)[0].annotations.idempotentHint, true);
});

test('the audit captures scripts with the executor stubbed', async () => {
    const executor = fakeExecutor();
    const mcp = server(executor);
    const typings = loadTypings({ files: [], allowedNames: ['activeDocument', 'selection', 'strokeWidth'] });
    const report = await auditTools({ mcp, executor, typings, noScriptTools: ['get_info'] });
    assert.equal(report.tools, 2);
    assert.equal(report.scripts, 1);
    assert.deepEqual(report.problems, []);
    assert.equal(await executor.runScript('x'), 'live run', 'the stub is removed afterwards');
});

test('executor: macOS AppleScript, timeout and temp-file cleanup', { skip: process.platform === 'win32' }, async () => {
    const calls = [];
    const executor = createExecutor({
        label: 'Illustrator', envPrefix: 'ADOBE_MCP_TEST', appNamePrefix: 'Adobe Illustrator', defaultAppName: 'Adobe Illustrator',
        macScript: ({ scriptPath }) => `do javascript (POSIX file "${scriptPath}")`,
        winInvoke: ({ scriptPath }) => `$app.DoJavaScriptFile('${scriptPath}')`,
        run: async (file, args, opts) => {
            calls.push({ file, args, opts });
            if (args[1].includes('System Events')) return '';
            return 'done';
        },
    });
    process.env.ADOBE_MCP_TEST_APP_NAME = 'Adobe Illustrator';
    process.env.ADOBE_MCP_TEST_SCRIPT_TIMEOUT_MS = '30000';
    try {
        assert.equal(await executor.runScript('app.name;'), 'done');
        const run = calls.at(-1);
        assert.equal(run.file, 'osascript');
        assert.match(run.args[1], /^with timeout of 30 seconds\n  tell application "Adobe Illustrator"\n    activate\n    do javascript \(POSIX file ".*adobe_mcp_test_mcp_.*\.jsx"\)/);
        assert.equal(run.opts.timeoutMs, 35000);
        const tmp = run.args[1].match(/POSIX file "([^"]+)"/)[1];
        const fs = await import('node:fs');
        assert.equal(fs.existsSync(tmp), false, 'temp script removed');
    } finally {
        delete process.env.ADOBE_MCP_TEST_APP_NAME;
        delete process.env.ADOBE_MCP_TEST_SCRIPT_TIMEOUT_MS;
    }
});

test('executor: a timeout names the likely cause', { skip: process.platform === 'win32' }, async () => {
    const executor = createExecutor({
        label: 'Illustrator', envPrefix: 'ADOBE_MCP_TEST', appNamePrefix: 'Adobe Illustrator', defaultAppName: 'Adobe Illustrator',
        macScript: () => 'do javascript "1"',
        run: async () => { throw Object.assign(new Error('killed'), { timedOut: true }); },
    });
    process.env.ADOBE_MCP_TEST_APP_NAME = 'Adobe Illustrator';
    try {
        await assert.rejects(executor.runScript('1'), /did not answer within 120s\. A dialog may be open in Illustrator/);
    } finally {
        delete process.env.ADOBE_MCP_TEST_APP_NAME;
    }
});

test('executor: auto backend falls back only when the backend could not run the script', async () => {
    let ext = 0;
    const backend = { name: 'uxp', isAvailable: async () => true, run: async () => { throw Object.assign(new Error('down'), { code: 'X' }); }, isUnavailableError: (e) => e.code === 'X' };
    const executor = createExecutor({
        label: 'InDesign', envPrefix: 'ADOBE_MCP_TEST', appNamePrefix: 'Adobe InDesign', defaultAppName: 'Adobe InDesign 2026',
        macScript: () => '', backends: [backend], run: async () => { ext++; return 'es'; },
    });
    process.env.ADOBE_MCP_TEST_BACKEND = 'auto';
    process.env.ADOBE_MCP_TEST_APP_NAME = 'Adobe InDesign 2026';
    try {
        assert.equal(await executor.runScript('1'), 'es');
        assert.ok(ext >= 1);
        process.env.ADOBE_MCP_TEST_BACKEND = 'uxp';
        executor.resetBackendCache();
        await assert.rejects(executor.runScript('1'), /down/);
    } finally {
        delete process.env.ADOBE_MCP_TEST_BACKEND;
        delete process.env.ADOBE_MCP_TEST_APP_NAME;
    }
});

test('executor: a bundle id addresses the app unless an app name is set', { skip: process.platform === 'win32' }, async () => {
    const sources = [];
    const executor = createExecutor({
        label: 'Illustrator', envPrefix: 'ADOBE_MCP_TEST', appNamePrefix: 'Adobe Illustrator', defaultAppName: 'Adobe Illustrator',
        macBundleId: 'com.adobe.illustrator',
        macScript: ({ scriptPath }) => `do javascript (read (POSIX file "${scriptPath}") as «class utf8»)`,
        run: async (file, args) => { sources.push(args[1]); return 'ok'; },
    });
    await executor.runScript('1');
    assert.match(sources[0], /tell application id "com\.adobe\.illustrator"/);
    process.env.ADOBE_MCP_TEST_APP_NAME = 'Adobe Illustrator 2025';
    try {
        await executor.runScript('1');
        assert.match(sources.at(-1), /tell application "Adobe Illustrator 2025"/);
    } finally {
        delete process.env.ADOBE_MCP_TEST_APP_NAME;
    }
});
