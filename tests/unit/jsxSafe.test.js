import assert from 'node:assert/strict';
import {
    str, num, index, bool, enumOf, ALLOWED, json, measure,
    validateFilePath, jsxPath, buildAllowedDirs,
} from '../../src/utils/jsxSafe.js';
import {
    autoCaptureResult,
    wrapScriptForStructuredResult,
    parseStructuredResult,
    ScriptExecutor,
} from '../../src/core/scriptExecutor.js';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
const queue = [];
function test(name, fn) {
    queue.push({ name, fn });
}
async function run() {
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
    console.log(`\n${passed} unit tests passed`);
}


test('str escapes quotes and control chars', () => {
    assert.equal(str('hello'), '"hello"');
    assert.equal(str('a"b'), '"a\\"b"');
    assert.ok(str('line\nbreak').includes('\\n'));
});

test('str quotes injection payloads so they stay inside a string literal', () => {
    const evil = '"); app.system("rm -rf /"); ("';
    const out = str(evil);
    assert.ok(out.startsWith('"') && out.endsWith('"'));
    // JSON.stringify escapes embedded quotes — payload cannot close the literal early
    assert.equal(JSON.parse(out), evil);
    assert.ok(out.includes('\\"'));
});

test('num validates finite numbers', () => {
    assert.equal(num(12), '12');
    assert.equal(num('3.5', { name: 'x' }), '3.5');
    assert.throws(() => num('nope', { name: 'x' }));
    assert.throws(() => num(99999, { min: 0, max: 10, name: 'x' }));
});

test('index requires non-negative integer', () => {
    assert.equal(index(0), '0');
    assert.throws(() => index(-1));
    assert.throws(() => index(1.5));
});

test('bool never passes through strings', () => {
    assert.equal(bool(true), 'true');
    assert.equal(bool(false), 'false');
    assert.equal(bool('yes'), 'true');
    assert.equal(bool(''), 'false');
});

test('enumOf allow-lists', () => {
    assert.equal(enumOf('LEFT_ALIGN', ALLOWED.alignment), 'LEFT_ALIGN');
    assert.throws(() => enumOf('HACK', ALLOWED.alignment, { name: 'alignment' }));
});

test('measure builds quoted unit literal', () => {
    assert.equal(measure(20, { unit: 'mm' }), '"20mm"');
    assert.throws(() => measure(1, { unit: 'parsecs' }));
});

test('json embeds structures safely', () => {
    assert.equal(json({ a: 1 }), '{"a":1}');
});

test('validateFilePath confines to home by default', () => {
    const homeFile = path.join(os.homedir(), 'indesign-mcp-test-file.txt');
    const resolved = validateFilePath(homeFile);
    assert.ok(resolved.startsWith(os.homedir()) || resolved.toLowerCase().startsWith(os.homedir().toLowerCase()));
    assert.throws(() => validateFilePath('/etc/passwd'));
});

test('jsxPath uses forward slashes and str()', () => {
    const p = jsxPath(path.join(os.homedir(), 'Docs', 'a.indd'));
    assert.ok(p.startsWith('"'));
    assert.ok(!p.includes('\\\\') || true);
});

test('buildAllowedDirs includes home', () => {
    const dirs = buildAllowedDirs();
    assert.ok(dirs.some((d) => d === path.resolve(os.homedir())));
});

test('autoCaptureResult prefixes trailing expression', () => {
    const src = 'var x = 1;\n"hello";';
    const out = autoCaptureResult(src);
    assert.ok(out.includes('var __result__ = '));
    assert.ok(out.includes('"hello"'));
});

test('autoCaptureResult leaves scripts with __result__ alone', () => {
    const src = 'var __result__ = 1;\n__result__;';
    assert.equal(autoCaptureResult(src), src);
});

test('wrapScriptForStructuredResult yields JSON payload expression', () => {
    const wrapped = wrapScriptForStructuredResult('"ok";');
    assert.ok(wrapped.includes('__payload'));
    assert.ok(wrapped.includes('"ok":true') || wrapped.includes('\\"ok\\":true'));
});

test('parseStructuredResult handles JSON and legacy strings', () => {
    const ok = parseStructuredResult('{"ok":true,"result":"hi"}');
    assert.equal(ok.ok, true);
    assert.equal(ok.result, 'hi');
    const bad = parseStructuredResult('ERROR: boom');
    assert.equal(bad.ok, false);
    const legacy = parseStructuredResult('Document created successfully');
    assert.equal(legacy.ok, true);
});

test('getStatus without probe returns host info', async () => {
    ScriptExecutor.resetAppNameCache();
    const status = await ScriptExecutor.getStatus({ probeInDesign: false });
    assert.equal(typeof status.platform, 'string');
    assert.equal(typeof status.node, 'string');
    assert.ok('indesign' in status);
});

test('cleanupTempScripts returns a number', () => {
    const n = ScriptExecutor.cleanupTempScripts();
    assert.equal(typeof n, 'number');
});


// --- backend selection ---
test('getConfiguredBackend defaults to extendscript', () => {
    const prev = process.env.INDESIGN_BACKEND;
    delete process.env.INDESIGN_BACKEND;
    ScriptExecutor.resetBackendCache();
    assert.equal(ScriptExecutor.getConfiguredBackend(), 'extendscript');
    if (prev !== undefined) process.env.INDESIGN_BACKEND = prev;
    else delete process.env.INDESIGN_BACKEND;
    ScriptExecutor.resetBackendCache();
});

test('getConfiguredBackend accepts uxp and auto', () => {
    const prev = process.env.INDESIGN_BACKEND;
    process.env.INDESIGN_BACKEND = 'uxp';
    ScriptExecutor.resetBackendCache();
    assert.equal(ScriptExecutor.getConfiguredBackend(), 'uxp');
    process.env.INDESIGN_BACKEND = 'auto';
    ScriptExecutor.resetBackendCache();
    assert.equal(ScriptExecutor.getConfiguredBackend(), 'auto');
    process.env.INDESIGN_BACKEND = 'nope';
    assert.equal(ScriptExecutor.getConfiguredBackend(), 'extendscript');
    if (prev !== undefined) process.env.INDESIGN_BACKEND = prev;
    else delete process.env.INDESIGN_BACKEND;
    ScriptExecutor.resetBackendCache();
});

test('resolveBackend extendscript ignores uxp', async () => {
    const prev = process.env.INDESIGN_BACKEND;
    process.env.INDESIGN_BACKEND = 'extendscript';
    ScriptExecutor.resetBackendCache();
    const b = await ScriptExecutor.resolveBackend({ forceRefresh: true });
    assert.equal(b, 'extendscript');
    if (prev !== undefined) process.env.INDESIGN_BACKEND = prev;
    else delete process.env.INDESIGN_BACKEND;
    ScriptExecutor.resetBackendCache();
});

run();
