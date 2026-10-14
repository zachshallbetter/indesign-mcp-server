/**
 * UXP backend test without InDesign: starts the real bridge, connects a fake
 * plugin that runs uxp/plugin/runtime.js in a Node vm against a fake InDesign
 * DOM shaped like UXP's (collections without [i], empty constructor.name, no
 * File/Folder globals), and checks that every handler script returns through
 * ScriptExecutor exactly what the same script returns when evaluated
 * ExtendScript-style (completion value, globals in scope) against the same DOM.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { collectToolScripts } from '../audit/collectScripts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN = 'uxp-test-token';

let passed = 0;
const queue = [];
function test(name, fn) {
    queue.push({ name, fn });
}

// ---------------------------------------------------------------- fake DOM

const PLUGIN_FOLDER = '/plugins/indesign-bridge';
const fakeUxp = {
    versions: { uxp: 'uxp-8.0.0', plugin: '1.2.0' },
    storage: { localFileSystem: { getPluginFolder: async () => ({ nativePath: PLUGIN_FOLDER }) } },
};

/** Paths that exist, shared by the fake fs and the fake DOM's file writes. */
function makeFs(paths = []) {
    const existing = new Set(paths);
    const strip = (p) => String(p).replace(/^file:/, '');
    return {
        existing,
        lstatSync(p) {
            if (!existing.has(strip(p))) throw new Error(`ENOENT: ${p}`);
            return { isDirectory: () => false };
        },
        mkdirSync(p) {
            existing.add(strip(p));
        },
        unlinkSync(p) {
            existing.delete(strip(p));
        },
        rmdirSync(p) {
            existing.delete(strip(p));
        },
    };
}

/** File/Folder as ExtendScript has them, for the reference run. */
function extendScriptFiles(fs) {
    class Entry {
        constructor(p) { this.fsName = String(p); }
        get fullName() { return this.fsName; }
        get name() { return this.fsName.slice(this.fsName.lastIndexOf('/') + 1); }
        get exists() { return fs.existing.has(this.fsName); }
        get parent() { return new FolderES(this.fsName.slice(0, this.fsName.lastIndexOf('/')) || '/'); }
        toString() { return this.fsName; }
    }
    class FileES extends Entry {}
    class FolderES extends Entry {
        create() { fs.existing.add(this.fsName); return true; }
    }
    const File = (p) => new FileES(p);
    File.prototype = FileES.prototype;
    const Folder = (p) => new FolderES(p);
    Folder.prototype = FolderES.prototype;
    return { File, Folder, Entry };
}

/** Enum containers: MeasurementUnits.POINTS -> "MeasurementUnits.POINTS". */
function makeEnums() {
    const cache = new Map();
    return (name) => {
        if (!cache.has(name)) {
            const target = function () {};
            Object.defineProperty(target, 'name', { value: name });
            cache.set(name, new Proxy(target, {
                get(t, k) {
                    if (k === 'prototype' || typeof k === 'symbol') return t[k];
                    return `${name}.${k}`;
                },
            }));
        }
        return cache.get(name);
    };
}

/**
 * A small document. uxp=true gives it UXP's shape: collections answer only
 * item(i), constructor.name is '' and the class is in constructorName, file
 * arguments must be path strings. uxp=false is the ExtendScript shape.
 */
function makeApp({ uxp, fs, Entry, withDocument }) {
    const log = [];
    function obj(cls, props) {
        const ctor = function () {};
        Object.defineProperty(ctor, 'name', { value: uxp ? '' : cls });
        const o = Object.create(ctor.prototype);
        ctor.prototype.constructor = ctor;
        if (uxp) o.constructorName = cls;
        return Object.assign(o, { isValid: true }, props);
    }
    function collection(items, extra = {}) {
        const c = {
            get length() { return items.length; },
            item(i) {
                if (typeof i === 'number') return items[i];
                return items.find((x) => x.name === i);
            },
            itemByName(n) {
                return items.find((x) => x.name === n) || obj('Nothing', { isValid: false, name: n });
            },
            everyItem() { return { getElements: () => items.slice() }; },
            count() { return items.length; },
            ...extra,
        };
        if (!uxp) items.forEach((x, i) => { c[i] = x; });
        return c;
    }
    function filePath(f) {
        if (uxp) {
            assert.equal(typeof f, 'string', 'UXP DOM methods get file paths as strings');
            return f;
        }
        assert.ok(f instanceof Entry, 'ExtendScript DOM methods get File objects');
        return f.fsName;
    }

    const layer = obj('Layer', { name: 'Layer 1' });
    const items = [
        obj('TextFrame', { name: 'Headline', id: 101, geometricBounds: [36, 36, 108, 288], itemLayer: layer, visible: true, locked: false }),
        obj('Rectangle', { name: '', id: 102, geometricBounds: [144, 36, 288, 180], itemLayer: layer, visible: true, locked: true }),
    ];
    const page = obj('Page', { name: '1', bounds: [0, 0, 792, 612], allPageItems: items });
    const docs = [];
    if (withDocument) {
        docs.push(obj('Document', {
            name: 'Test.indd',
            pages: collection([page]),
            swatches: collection([]),
            colors: collection([]),
            exportFile(format, file, showDialog, preset) {
                const p = filePath(file);
                log.push(['exportFile', format, p, preset && preset.name]);
                fs.existing.add(p);
            },
        }));
    }
    const app = {
        name: 'Adobe InDesign',
        version: '18.5',
        documents: collection(docs),
        books: collection([]),
        fonts: collection([]),
        get activeDocument() {
            if (!docs.length) throw new Error('No documents are open.');
            return docs[0];
        },
        filePath: '/Applications/Adobe InDesign 2024',
        swatches: collection([obj('Swatch', { name: 'None' }), obj('Swatch', { name: 'Paper' })]),
        scriptPreferences: { measurementUnit: 'MeasurementUnits.MILLIMETERS', userInteractionLevel: 'UserInteractionLevels.INTERACT_WITH_ALL', version: '18.5' },
        pdfExportPreferences: { pageRange: 'PageRange.ALL_PAGES' },
        pdfExportPresets: collection([obj('PDFExportPreset', { name: 'Sample' })]),
    };
    return { app, log };
}

/** A world: the same DOM data in both shapes, with separate file systems. */
function makeWorld({ withDocument = false, files = [] } = {}) {
    const enumFor = makeEnums();
    const fsES = makeFs(files);
    const fsUXP = makeFs([...files, PLUGIN_FOLDER]);
    const es = extendScriptFiles(fsES);
    const esDom = makeApp({ uxp: false, fs: fsES, Entry: es.Entry, withDocument });
    const uxpDom = makeApp({ uxp: true, fs: fsUXP, Entry: es.Entry, withDocument });
    const indesign = new Proxy({ app: uxpDom.app }, {
        has: (t, k) => k in t || (typeof k === 'string' && /^[A-Z]/.test(k)),
        get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^[A-Z]/.test(k) ? enumFor(k) : undefined),
    });
    return { enumFor, es, esDom, uxpDom, fsUXP, indesign };
}

/** Evaluate a script the way ExtendScript's do script does: completion value, globals in scope. */
function runExtendScript(world, script) {
    const globals = { app: world.esDom.app, File: world.es.File, Folder: world.es.Folder };
    const ctx = vm.createContext(new Proxy(globals, {
        has: (t, k) => k in t || (typeof k === 'string' && /^[A-Z]/.test(k) && !(k in globalThis)),
        get: (t, k) => {
            if (k in t) return t[k];
            if (typeof k === 'string' && /^[A-Z]/.test(k) && !(k in globalThis)) return world.enumFor(k);
            return globalThis[k];
        },
    }));
    try {
        const value = vm.runInContext(script, ctx, { timeout: 5000 });
        return { value: value == null ? '' : String(value).trim() };
    } catch (e) {
        return { error: e.message };
    }
}

// ------------------------------------------------------------ fake plugin

function loadRuntime() {
    const src = readFileSync(path.join(root, 'uxp/plugin/runtime.js'), 'utf8');
    const ctx = vm.createContext({ console, setTimeout, clearTimeout });
    const factory = vm.runInContext(`(function (module, exports) {\n${src}\n})`, ctx, { filename: 'runtime.js' });
    const module = { exports: {} };
    factory(module, module.exports);
    return module.exports;
}
const { createRuntime } = loadRuntime();

/** Connects to the bridge like uxp/plugin/index.js does and serves executes from `world`. */
class FakePlugin {
    constructor(port) {
        this.port = port;
        this.world = makeWorld();
    }
    use(world) {
        this.world = world;
        this.runtime = createRuntime({
            indesign: world.indesign,
            fs: world.fsUXP,
            uxp: fakeUxp,
            pluginVersion: '1.2.0',
            require: (name) => {
                if (name === 'indesign') return world.indesign;
                throw new Error(`require('${name}') is not allowed inside execute calls`);
            },
            log: () => {},
            timeoutMs: 5000,
        });
    }
    connect() {
        this.use(this.world);
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
            this.ws = ws;
            ws.on('open', resolve);
            ws.on('error', reject);
            ws.on('message', (data) => {
                this.runtime.handleMessage(JSON.parse(String(data)), (out) => ws.send(out));
            });
        });
    }
    disconnect() {
        return new Promise((resolve) => {
            this.ws.once('close', resolve);
            this.ws.close();
        });
    }
}

// ------------------------------------------------------------------ bridge

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function startBridge() {
    const httpPort = await freePort();
    const wsPort = await freePort();
    const child = spawn(process.execPath, [path.join(root, 'uxp/bridge/server.js')], {
        env: { ...process.env, UXP_HTTP_PORT: String(httpPort), UXP_WS_PORT: String(wsPort), BRIDGE_TOKEN: TOKEN },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`bridge did not start: ${stdout}`)), 10000);
        child.stdout.on('data', (d) => {
            stdout += d;
            if (stdout.includes('Waiting for UXP plugin')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.on('exit', (code) => reject(new Error(`bridge exited (${code}): ${stdout}`)));
    });
    child.stdout.resume();
    child.stderr.resume();
    return { child, httpPort, wsPort, url: `http://127.0.0.1:${httpPort}`, stdout: () => stdout };
}

async function waitForConnected(url, want) {
    for (let i = 0; i < 100; i++) {
        const res = await fetch(`${url}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        if ((await res.json()).connected === want) return;
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`bridge never reported connected=${want}`);
}

/** Run a script over the UXP backend the way a tool call does. */
async function viaUXP(script) {
    try {
        return { value: await ScriptExecutor.executeInDesignScript(script) };
    } catch (e) {
        return { error: e.message };
    }
}

// ------------------------------------------------------------------- tests

const scripts = (await collectToolScripts())
    .filter(({ tool }) => tool.name !== 'execute_indesign_code')
    .flatMap(({ tool, scripts: list }) => list.map((script, i) => ({ name: list.length > 1 ? `${tool.name}#${i}` : tool.name, script })));

const bridge = await startBridge();
const plugin = new FakePlugin(bridge.wsPort);
const env = { ...process.env };
process.env.INDESIGN_BACKEND = 'uxp';
process.env.UXP_BRIDGE_URL = bridge.url;
process.env.BRIDGE_TOKEN = TOKEN;
ScriptExecutor.resetBackendCache();

test('bridge requires the token on /status and /execute', async () => {
    assert.equal((await fetch(`${bridge.url}/status`)).status, 401);
    assert.equal((await fetch(`${bridge.url}/status`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await fetch(`${bridge.url}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).connected, false);
    const exec = await fetch(`${bridge.url}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '1' }),
    });
    assert.equal(exec.status, 401);
});

test('bridge names a non-default plugin port', async () => {
    assert.ok(bridge.stdout().includes(`Set the port in the InDesign Bridge panel to ${bridge.wsPort}`));
});

test('uxp mode does not fall back when the plugin is not connected', async () => {
    let fellBack = false;
    const original = ScriptExecutor.executeViaExtendScript;
    ScriptExecutor.executeViaExtendScript = async () => {
        fellBack = true;
        return 'extendscript';
    };
    try {
        const r = await viaUXP('"x"');
        assert.match(r.error, /Plugin not connected/);
        assert.equal(fellBack, false);
    } finally {
        ScriptExecutor.executeViaExtendScript = original;
    }
});

test('fake plugin connects', async () => {
    await plugin.connect();
    await waitForConnected(bridge.url, true);
    assert.equal(await ScriptExecutor.isUXPAvailable(), true);
});

test(`every handler script returns its ExtendScript result over UXP (no document; ${scripts.length} scripts)`, async () => {
    const mismatches = [];
    let empty = 0;
    for (const { name, script } of scripts) {
        const world = makeWorld();
        plugin.use(world);
        const expected = runExtendScript(world, script);
        const actual = await viaUXP(script);
        if (expected.error !== undefined) {
            if (!actual.error || !actual.error.includes(expected.error)) mismatches.push([name, expected, actual]);
        } else if (actual.value !== expected.value) {
            mismatches.push([name, expected, actual]);
        }
        if (!actual.value && !actual.error) empty++;
    }
    assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} scripts differ`);
    assert.equal(empty, 0, `${empty} scripts returned an empty result`);
});

test('every handler script returns its ExtendScript result over UXP (document open)', async () => {
    const mismatches = [];
    for (const { name, script } of scripts) {
        const world = makeWorld({ withDocument: true });
        plugin.use(world);
        const expected = runExtendScript(world, script);
        const actual = await viaUXP(script);
        const same = expected.error !== undefined
            ? Boolean(actual.error && actual.error.includes(expected.error))
            : actual.value === expected.value;
        if (!same) mismatches.push([name, expected, actual]);
    }
    assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} scripts differ`);
});

test('list_page_items: item(i) and constructorName stand in for [i] and constructor.name', async () => {
    const { script } = scripts.find((s) => s.name === 'list_page_items');
    const world = makeWorld({ withDocument: true });
    plugin.use(world);
    const { value } = await viaUXP(script);
    assert.equal(value, runExtendScript(world, script).value);
    assert.match(value, /=== PAGE ITEMS \(page 1, 2 items\) ===/);
    assert.match(value, /Type: TextFrame\n {2}Name: Headline/);
    assert.match(value, /Type: Rectangle/);
    assert.match(value, /Size \(mm\): 50\.8 x 50\.8/);
    assert.equal(world.uxpDom.app.scriptPreferences.measurementUnit, 'MeasurementUnits.MILLIMETERS', 'units restored');
});

test('export_pdf: File shim passes a path to the DOM and File.exists reads the file system', async () => {
    const { script } = scripts.find((s) => s.name === 'export_pdf');
    const world = makeWorld({ withDocument: true });
    plugin.use(world);
    const { value } = await viaUXP(script);
    assert.equal(value, runExtendScript(world, script).value);
    assert.match(value, /^PDF exported \(1 pages, preset Sample\) to: \/.+audit\.indd$/);
    const [call] = world.uxpDom.log;
    assert.equal(call[0], 'exportFile');
    assert.equal(call[1], 'ExportFormat.PDF_TYPE');
    assert.equal(typeof call[2], 'string');
});

test('ExtendScript-style user code returns its completion value', async () => {
    plugin.use(makeWorld());
    assert.deepEqual(await viaUXP('var x = 40;\nx + 2;'), { value: '42' });
    assert.deepEqual(await viaUXP('app.documents.length + " docs"'), { value: '0 docs' });
    assert.deepEqual(await viaUXP('MeasurementUnits.POINTS'), { value: 'MeasurementUnits.POINTS' });
    assert.deepEqual(await viaUXP('File("/tmp/a b/c.txt").parent.fsName'), { value: '/tmp/a b' });
});

test('scripts do not leak variables into later calls', async () => {
    assert.deepEqual(await viaUXP('var leaked = 1; leaked'), { value: '1' });
    assert.deepEqual(await viaUXP('typeof leaked'), { value: 'undefined' });
});

test('UXP-style code with top-level return and await still works', async () => {
    assert.deepEqual(await viaUXP('const n = await Promise.resolve(21);\nreturn n * 2;'), { value: '42' });
    assert.deepEqual(
        await viaUXP('const { app } = require("indesign");\nreturn app.documents.length;'),
        { value: '0' }
    );
});

test('uncaught script errors come back as tool errors', async () => {
    const r = await viaUXP('throw new Error("boom")');
    assert.match(r.error, /^Error executing tool: boom$/);
});

test('auto mode re-checks the bridge and falls back only when the script cannot have run', async () => {
    process.env.INDESIGN_BACKEND = 'auto';
    const original = ScriptExecutor.executeViaExtendScript;
    const recheck = ScriptExecutor.autoRecheckMs;
    let extendScriptCalls = 0;
    ScriptExecutor.executeViaExtendScript = async () => {
        extendScriptCalls++;
        return 'via extendscript';
    };
    try {
        ScriptExecutor.resetBackendCache();
        assert.equal(await ScriptExecutor.resolveBackend(), 'uxp');
        assert.deepEqual(await viaUXP('"via uxp"'), { value: 'via uxp' });

        // Plugin goes away while the cached choice is still 'uxp': fall back.
        ScriptExecutor.autoRecheckMs = 60000;
        await plugin.disconnect();
        await waitForConnected(bridge.url, false);
        assert.deepEqual(await viaUXP('"x"'), { value: 'via extendscript' });
        assert.equal(extendScriptCalls, 1);

        // Plugin comes back: picked up on the next re-check, no restart needed.
        ScriptExecutor.autoRecheckMs = 0;
        await plugin.connect();
        await waitForConnected(bridge.url, true);
        assert.deepEqual(await viaUXP('"via uxp again"'), { value: 'via uxp again' });
        assert.equal(extendScriptCalls, 1);

        // A script error over UXP is not retried through ExtendScript.
        const r = await viaUXP('throw new Error("ran once")');
        assert.match(r.error, /ran once/);
        assert.equal(extendScriptCalls, 1);
    } finally {
        ScriptExecutor.executeViaExtendScript = original;
        ScriptExecutor.autoRecheckMs = recheck;
        process.env.INDESIGN_BACKEND = 'uxp';
        ScriptExecutor.resetBackendCache();
    }
});

test('capability probe over the bridge reports the UXP-shaped DOM and restores units', async () => {
    const world = makeWorld();
    plugin.use(world);
    const r = await ScriptExecutor.probeUXP();
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.pluginVersion, '1.2.0');
    assert.equal(r.uxpVersion, 'uxp-8.0.0');
    assert.equal(r.inDesignVersion, '18.5');
    assert.deepEqual(r.scriptEval, { ok: true, value: 42 });
    assert.equal(r.enums.equalsAfterSet, true);
    assert.equal(r.collections.nativeIndex, false);
    assert.equal(r.collections.compatIndex, true);
    assert.equal(r.classNames.constructorDotName, '');
    assert.equal(r.classNames.constructorName, 'Swatch');
    assert.equal(r.classNames.compatConstructorName, 'Swatch');
    assert.equal(r.fs.testedPath, PLUGIN_FOLDER);
    assert.equal(r.fs.plainPath, true);
    assert.equal(r.asyncMethods['swatches.count()'], 'value');
    assert.deepEqual(r.problems, []);
    assert.ok(r.handled.some((h) => /item\(i\)/.test(h)));
    assert.ok(r.handled.some((h) => /constructorName/.test(h)));
    assert.equal(world.uxpDom.app.scriptPreferences.measurementUnit, 'MeasurementUnits.MILLIMETERS');
});

test('capability probe names the problems on a hostile DOM', async () => {
    // Enum values are fresh objects on every read, a method returns a Promise, no fs.
    const enumValue = (name) => ({ name, equals(o) { return o && o.name === name; }, toString() { return name; } });
    let unit = 'MILLIMETERS';
    const sw = { name: 'None', constructorName: 'Swatch', isValid: true };
    Object.setPrototypeOf(sw, { constructor: Object.defineProperty(function () {}, 'name', { value: '' }) });
    const app = {
        version: '19.0',
        filePath: '/Applications/Adobe InDesign 2025',
        scriptPreferences: {
            version: '19.0',
            get measurementUnit() { return enumValue(unit); },
            set measurementUnit(v) { unit = v.name; },
        },
        swatches: {
            length: 1,
            item: () => sw,
            count: () => Promise.resolve(1),
            everyItem: () => ({ getElements: () => [sw] }),
        },
    };
    const indesign = { app, MeasurementUnits: { get POINTS() { return enumValue('POINTS'); } } };
    const runtime = createRuntime({ indesign, fs: null, log: () => {} });
    const r = await runtime.probe();
    assert.equal(r.enums.type, 'object');
    assert.equal(r.enums.equalsAfterSet, false);
    assert.equal(r.enums.equalsMethodAfterSet, true);
    assert.equal(r.asyncMethods['swatches.count()'], 'promise');
    assert.equal(r.fs.available, false);
    assert.equal(unit, 'MILLIMETERS', 'units restored');
    const text = r.problems.join('\n');
    assert.match(text, /Enum values do not compare with ==.*get_page_info/);
    assert.match(text, /Promises.*swatches\.count\(\)/);
    assert.match(text, /fs module is unavailable/);
    assert.ok(!/Scripts cannot be evaluated/.test(text), text);
});

test('capability probe explains a plugin that predates it', async () => {
    const original = ScriptExecutor.executeViaUXP;
    ScriptExecutor.executeViaUXP = async () => {
        throw new Error('uxpRuntime is not defined');
    };
    try {
        assert.match((await ScriptExecutor.probeUXP()).error, /predates the probe \(plugin 1\.2\.0\)/);
    } finally {
        ScriptExecutor.executeViaUXP = original;
    }
});

// ---------------------------------------------------------------- runtime

test('File/Folder shims: names, parents, exists via plain path or file: URL, create', async () => {
    const fs = makeFs(['/a/b/c.indd']);
    fs.lstatSync = ((orig) => (p) => {
        if (!String(p).startsWith('file:')) throw new Error('plain paths unsupported');
        return orig(p);
    })(fs.lstatSync);
    const { File, Folder } = createRuntime({ indesign: {}, fs, log: () => {} });
    const f = new File('/a/b/c.indd');
    assert.equal(f.name, 'c.indd');
    assert.equal(f.fsName, '/a/b/c.indd');
    assert.equal(f.parent.fsName, '/a/b');
    assert.equal(f.parent.parent.parent.fsName, '/');
    assert.equal(f.exists, true);
    assert.equal(File('/a/b/missing.indd').exists, false);
    assert.equal(String(File('/a/b/')), '/a/b');
    assert.ok(File('/x') instanceof File);
    const dir = Folder('/out/new');
    assert.equal(dir.exists, false);
    dir.create();
    assert.equal(dir.exists, true);
    assert.equal(File('C:\\Docs\\x.indd').parent.fsName, 'C:\\Docs');
});

test('File.exists without the fs module says why', async () => {
    const { File } = createRuntime({ indesign: {}, fs: null, log: () => {} });
    assert.throws(() => File('/a').exists, /needs the UXP fs module/);
});

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
    console.log(`\n${passed}/${queue.length} passed`);
} finally {
    if (plugin.ws) plugin.ws.terminate();
    bridge.child.kill();
    Object.assign(process.env, env);
}
