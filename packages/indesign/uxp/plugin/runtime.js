/**
 * Runs MCP handler scripts inside the UXP plugin with ExtendScript semantics.
 *
 * The handlers generate ExtendScript: the result is the completion value of
 * the script's last statement, and the script uses ExtendScript globals (File,
 * Folder, $, enums such as MeasurementUnits). This module:
 *   - evaluates the script with direct eval, so the completion value comes back
 *     exactly as `do script` / DoScript returns it;
 *   - supplies the enums and classes the script names from require('indesign'),
 *     plus File/Folder/$ shims;
 *   - wraps `app` so that collection[i] falls back to collection.item(i) and
 *     constructor.name falls back to constructorName, the two DOM differences
 *     Adobe documents for UXP.
 * Code that is not a valid classic script (top-level return or await) runs the
 * way the plugin always ran it: as the body of an async function, returning
 * only what it returns. That code also sees `uxpRuntime`, whose probe()
 * reports how this InDesign's UXP DOM differs from ExtendScript.
 *
 * Plain CommonJS with no UXP imports, so tests can load it in a Node vm.
 */

const JS_GLOBALS = new Set([
    'undefined', 'NaN', 'Infinity', 'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
    'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError',
    'URIError', 'Math', 'JSON', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent',
    'decodeURIComponent', 'escape', 'unescape', 'eval', 'arguments', 'console',
    'app', 'require', 'File', 'Folder', '$', '__code',
]);

// InDesign enums and classes are capitalized (MeasurementUnits, TextFrame).
const DOM_NAME = /\b[A-Z][\w$]*/g;

function serializeResult(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(serializeResult);
    if (typeof value === 'object') {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return String(value);
        }
    }
    return String(value);
}

/** True when `code` parses as a classic script (no top-level return/await). Runs nothing. */
function parsesAsScript(code) {
    try {
        // eslint-disable-next-line no-eval
        eval('if (0) {\n' + code + '\n}');
        return true;
    } catch (e) {
        if (e instanceof SyntaxError) return false;
        throw e;
    }
}

/**
 * ExtendScript File/Folder subset used by the handlers: fsName, fullName,
 * name, path, exists, parent, create(), remove(), toString(). Paths are kept
 * as given (handlers pass absolute paths).
 * @param {object|null} fs UXP `require('fs')` (lstatSync, mkdirSync, unlinkSync, rmdirSync)
 */
function createFileShims(fs) {
    function needFs(what) {
        if (!fs) throw new Error(what + ' needs the UXP fs module, which this InDesign version does not provide');
        return fs;
    }
    // UXP fs takes plain absolute paths on recent versions and file: URLs on all.
    function candidates(p) {
        return /^[a-z][\w+.-]*:/i.test(p) && !/^[a-z]:[\\/]/i.test(p) ? [p] : [p, 'file:' + p];
    }
    function tryEach(p, fn) {
        let last;
        for (const c of candidates(p)) {
            try {
                return fn(c);
            } catch (e) {
                last = e;
            }
        }
        throw last;
    }
    function stat(p) {
        try {
            return tryEach(p, (c) => needFs('File.exists').lstatSync(c));
        } catch (e) {
            if (!fs) throw e;
            return null;
        }
    }
    function trimSlash(p) {
        return p.length > 1 ? p.replace(/[\\/]+$/, '') || p : p;
    }
    function parentPath(p) {
        const t = trimSlash(p);
        const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
        if (i < 0) return null;
        if (i === 0) return t.charAt(0);
        if (/^[a-z]:$/i.test(t.slice(0, i))) return t.slice(0, i + 1);
        return t.slice(0, i);
    }
    function baseName(p) {
        const t = trimSlash(p);
        return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1);
    }

    class FsEntry {
        constructor(p) {
            this._path = trimSlash(String(p == null ? '' : p));
        }
        get fsName() { return this._path; }
        get fullName() { return this._path; }
        get absoluteURI() { return this._path; }
        get name() { return baseName(this._path); }
        get path() { return parentPath(this._path) || ''; }
        get parent() {
            const pp = parentPath(this._path);
            return pp ? new FolderShim(pp) : null;
        }
        get exists() { return stat(this._path) !== null; }
        remove() {
            const s = stat(this._path);
            if (!s) return false;
            const isDir = typeof s.isDirectory === 'function' ? s.isDirectory() : false;
            tryEach(this._path, (c) => (isDir ? needFs('remove').rmdirSync(c) : needFs('remove').unlinkSync(c)));
            return true;
        }
        toString() { return this._path; }
        valueOf() { return this._path; }
    }
    class FileShim extends FsEntry {}
    class FolderShim extends FsEntry {
        create() {
            if (this.exists) return true;
            tryEach(this._path, (c) => needFs('Folder.create').mkdirSync(c, { recursive: true }));
            return true;
        }
    }

    // Callable with or without `new`, as in ExtendScript.
    function File(p) { return new FileShim(p); }
    File.prototype = FileShim.prototype;
    function Folder(p) { return new FolderShim(p); }
    Folder.prototype = FolderShim.prototype;
    return { File, Folder, FsEntry, FileShim };
}

/**
 * Proxy around DOM objects: obj[i] -> obj.item(i) when the collection has no
 * index property, constructor.name -> constructorName when the native name is
 * empty, fullName strings returned as File, and File/Folder shims and proxies
 * unwrapped to native values on the way in.
 */
function createDomCompat(FsEntry, FileShim) {
    const toProxy = new WeakMap();
    const toTarget = new WeakMap();

    function unwrap(v) {
        if (v === null || v === undefined) return v;
        if (v instanceof FsEntry) return v.fsName;
        if (typeof v === 'object' || typeof v === 'function') {
            if (toTarget.has(v)) return toTarget.get(v);
            if (Array.isArray(v)) return v.map(unwrap);
            if (Object.getPrototypeOf(v) === Object.prototype) {
                const out = {};
                for (const k of Object.keys(v)) out[k] = unwrap(v[k]);
                return out;
            }
        }
        return v;
    }

    function wrap(v) {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
        if (v instanceof FsEntry || toTarget.has(v)) return v;
        if (v instanceof Promise) return v;
        if (toProxy.has(v)) return toProxy.get(v);
        const p = new Proxy(v, handler);
        toProxy.set(v, p);
        toTarget.set(p, v);
        return p;
    }

    function fixedValue(target, prop) {
        const d = Object.getOwnPropertyDescriptor(target, prop);
        return d && !d.configurable && 'value' in d && !d.writable;
    }

    const handler = {
        get(target, prop) {
            if (typeof prop === 'string') {
                if (prop === 'constructor' && typeof target.constructorName === 'string' && target.constructorName) {
                    const native = target.constructor;
                    if (!native || !native.name) return { name: target.constructorName };
                }
                if (/^\d+$/.test(prop) && !(prop in target) && typeof target.item === 'function') {
                    return wrap(target.item(Number(prop)));
                }
            }
            const value = Reflect.get(target, prop, target);
            if (fixedValue(target, prop)) return value;
            // ExtendScript returns a File for fullName; UXP returns the path.
            if (prop === 'fullName' && typeof value === 'string') return new FileShim(value);
            if (typeof value === 'function') {
                if (typeof target !== 'function' && prop !== 'constructor') {
                    return function () {
                        const args = Array.prototype.map.call(arguments, unwrap);
                        const self = toTarget.has(this) ? toTarget.get(this) : target;
                        return wrap(value.apply(self, args));
                    };
                }
                return value;
            }
            return wrap(value);
        },
        set(target, prop, value) {
            return Reflect.set(target, prop, unwrap(value), target);
        },
        apply(target, thisArg, args) {
            return wrap(Reflect.apply(target, unwrap(thisArg), args.map(unwrap)));
        },
        construct(target, args) {
            return wrap(Reflect.construct(target, args.map(unwrap)));
        },
    };

    return { wrap, unwrap };
}

// Handler scripts that compare enum values with == / != (see uxp/README.md).
const ENUM_COMPARING_TOOLS = [
    'detach_master_items', 'get_page_info', 'get_master_spread_info',
    'list_master_spreads', 'list_object_styles', 'validate_document',
];

/** Run fn and return its value, or { error } if it throws. */
function attempt(fn) {
    try {
        return fn();
    } catch (e) {
        return { error: (e && e.message) || String(e) };
    }
}
function failed(v) {
    return v !== null && typeof v === 'object' && 'error' in v;
}
function isThenable(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

/**
 * @param {{ indesign: object, require?: Function, fs?: object|null, uxp?: object|null,
 *   pluginVersion?: string|null, log?: Function, timeoutMs?: number }} deps
 */
function createRuntime(deps) {
    const indesign = deps.indesign;
    const scopedRequire = deps.require || ((name) => {
        throw new Error(`require('${name}') is not available`);
    });
    const timeoutMs = deps.timeoutMs || 25000;
    const log = deps.log || ((...a) => console.log(...a));
    const { File, Folder, FsEntry, FileShim } = createFileShims(deps.fs || null);
    const { wrap, unwrap } = createDomCompat(FsEntry, FileShim);
    const $ = {
        writeln: (...a) => log(a.join('')),
        write: (...a) => log(a.join('')),
        global: {},
    };

    /** Names the script uses that come from the indesign module (enums, classes). */
    function domGlobals(code) {
        const names = [];
        const seen = new Set();
        for (const m of code.matchAll(DOM_NAME)) {
            const n = m[0];
            if (seen.has(n) || JS_GLOBALS.has(n)) continue;
            seen.add(n);
            let present = false;
            try {
                present = n in indesign;
            } catch (e) {
                present = false;
            }
            if (present) names.push(n);
        }
        return names;
    }

    async function runScript(code) {
        const names = domGlobals(code);
        const values = names.map((n) => indesign[n]);
        // Direct eval in a sloppy function: the script's vars stay local to this
        // call and eval returns the completion value, as ExtendScript does.
        const evaluate = new Function('app', 'require', 'File', 'Folder', '$', ...names, '__code', 'return eval(__code);');
        const app = wrap(indesign.app);
        return unwrap(await evaluate(app, scopedRequire, File, Folder, $, ...values, code));
    }

    async function runAsyncBody(code) {
        const fn = new Function('app', 'require', 'uxpRuntime', `return (async () => { ${code} })()`);
        return fn(indesign.app, scopedRequire, api);
    }

    /**
     * Read-only report of the DOM behaviors the handler scripts depend on.
     * Every check catches its own errors. The only change it makes is to
     * app.scriptPreferences.measurementUnit, which it restores.
     */
    async function probe() {
        const app = indesign.app;
        const report = { probeVersion: 1, pluginVersion: deps.pluginVersion || null };
        report.uxpVersion = attempt(() => (deps.uxp && deps.uxp.versions ? deps.uxp.versions.uxp : null));
        report.inDesignVersion = attempt(() => String(app.version));
        report.domVersion = attempt(() => String(app.scriptPreferences.version));

        // The completion value comes back (needs allowCodeGenerationFromStrings).
        try {
            const value = await runScript('var __probe = 40;\n__probe + 2;');
            report.scriptEval = { ok: value === 42, value: serializeResult(value) };
        } catch (e) {
            report.scriptEval = { ok: false, error: e.message };
        }

        // Enum values: type, and whether == works on them.
        report.enums = attempt(() => {
            const units = indesign.MeasurementUnits;
            const points = units.POINTS;
            const prefs = app.scriptPreferences;
            const out = {
                type: typeof points,
                value: String(points),
                hasEquals: Boolean(points) && typeof points.equals === 'function',
                twoReadsEqual: prefs.measurementUnit == prefs.measurementUnit,
            };
            const saved = prefs.measurementUnit;
            try {
                prefs.measurementUnit = points;
                const read = prefs.measurementUnit;
                out.equalsAfterSet = read == points;
                out.strictEqualsAfterSet = read === points;
                if (out.hasEquals) out.equalsMethodAfterSet = attempt(() => Boolean(read.equals(points)));
            } finally {
                prefs.measurementUnit = saved;
            }
            return out;
        });

        // Collections: native [i], item(i), and [i] through the compat proxy.
        report.collections = attempt(() => {
            const raw = app.swatches;
            return {
                length: raw.length,
                nativeIndex: attempt(() => raw[0] !== undefined),
                item: attempt(() => Boolean(raw.item(0)) && raw.item(0).isValid !== false),
                compatIndex: attempt(() => wrap(app).swatches[0] !== undefined),
            };
        });

        // Class names: constructor.name, constructorName, instanceof.
        report.classNames = attempt(() => {
            const sw = app.swatches.item(0);
            const ctor = attempt(() => (sw.constructor ? sw.constructor.name : ''));
            return {
                constructorDotName: ctor,
                constructorName: attempt(() => (sw.constructorName === undefined ? null : String(sw.constructorName))),
                compatConstructorName: attempt(() => wrap(sw).constructor.name),
                instanceofSwatch: attempt(() => typeof indesign.Swatch === 'function' && sw instanceof indesign.Swatch),
            };
        });

        // File-valued properties: ExtendScript returns File objects.
        report.fileProperties = attempt(() => {
            const fp = app.filePath;
            return { appFilePathType: fp === null ? 'null' : typeof fp, appFilePath: String(fp) };
        });

        // fs: which path forms lstat accepts.
        const fs = deps.fs || null;
        report.fs = { available: Boolean(fs) };
        if (fs) {
            let path = null;
            try {
                const lfs = deps.uxp && deps.uxp.storage && deps.uxp.storage.localFileSystem;
                if (lfs) path = (await lfs.getPluginFolder()).nativePath;
            } catch (e) {
                report.fs.pluginFolderError = e.message;
            }
            if (!path && report.fileProperties && report.fileProperties.appFilePathType === 'string') {
                path = report.fileProperties.appFilePath;
            }
            report.fs.testedPath = path;
            if (path) {
                const lstat = (p) => attempt(() => Boolean(fs.lstatSync(p)));
                report.fs.plainPath = lstat(path);
                report.fs.fileUrl = lstat('file:' + path);
            }
        }

        // Read-only methods: do they return values or Promises?
        report.asyncMethods = {};
        const calls = {
            'swatches.count()': () => app.swatches.count(),
            'swatches.item(0).toSpecifier()': () => app.swatches.item(0).toSpecifier(),
            'swatches.everyItem().getElements()': () => app.swatches.everyItem().getElements(),
        };
        for (const [name, call] of Object.entries(calls)) {
            const v = attempt(call);
            if (isThenable(v)) {
                v.then(null, () => {});
                report.asyncMethods[name] = 'promise';
            } else {
                report.asyncMethods[name] = failed(v) ? v : 'value';
            }
        }

        report.notChecked = [
            'Whether DOM methods accept a path string for a file argument (needs a side effect; try export_pdf)',
        ];
        Object.assign(report, assess(report));
        return report;
    }

    /** Turn the raw checks into problems (tools will misbehave) and handled differences. */
    function assess(r) {
        const problems = [];
        const handled = [];
        if (!r.scriptEval || !r.scriptEval.ok) {
            problems.push('Scripts cannot be evaluated, so every tool fails: ' + (r.scriptEval && (r.scriptEval.error || JSON.stringify(r.scriptEval.value))));
        }
        const e = r.enums;
        if (failed(e)) {
            problems.push('Enum check failed: ' + e.error);
        } else if (e.equalsAfterSet === false) {
            problems.push('Enum values do not compare with ==, so these tools can give wrong answers: ' + ENUM_COMPARING_TOOLS.join(', '));
        }
        const c = r.collections;
        if (failed(c) || failed(c.compatIndex) || c.compatIndex !== true) {
            problems.push('collection[i] does not work, even through the compat proxy: ' + JSON.stringify(c));
        } else if (c.nativeIndex !== true) {
            handled.push('Collections have no native [i]; the compat proxy maps it to item(i)');
        }
        const n = r.classNames;
        if (failed(n) || !n.compatConstructorName || failed(n.compatConstructorName)) {
            problems.push('constructor.name is empty, even through the compat proxy: ' + JSON.stringify(n));
        } else if (!n.constructorDotName || failed(n.constructorDotName)) {
            handled.push('constructor.name is empty natively; the compat proxy uses constructorName');
        }
        if (!r.fs.available) {
            problems.push('The fs module is unavailable, so File.exists and Folder.create throw; tools that check or create files fail');
        } else if (r.fs.testedPath) {
            const plain = r.fs.plainPath === true;
            const url = r.fs.fileUrl === true;
            if (!plain && !url) problems.push('fs.lstatSync accepted neither a plain path nor a file: URL for ' + r.fs.testedPath);
            else if (!plain) handled.push('fs needs file: URLs; the File shim retries with file:');
        }
        const promised = Object.keys(r.asyncMethods).filter((k) => r.asyncMethods[k] === 'promise');
        if (promised.length) {
            problems.push('DOM methods return Promises, which ExtendScript-style scripts do not await: ' + promised.join(', '));
        }
        if (r.fileProperties && r.fileProperties.appFilePathType === 'string') {
            handled.push('File-valued properties return path strings; fullName is turned into a File, other properties are not');
        }
        return { problems, handled };
    }

    const api = { probe };

    async function execute(code) {
        let timerId;
        const run = parsesAsScript(code) ? runScript(code) : runAsyncBody(code);
        try {
            return await Promise.race([
                run,
                new Promise((_, reject) => {
                    timerId = setTimeout(
                        () => reject(new Error(`Execution timed out in plugin (${Math.round(timeoutMs / 1000)}s)`)),
                        timeoutMs
                    );
                }),
            ]);
        } finally {
            clearTimeout(timerId);
        }
    }

    /** Bridge protocol: { type: 'ping' | 'execute', id, code } in, result/error/pong out. */
    async function handleMessage(msg, send) {
        if (msg.type === 'ping') {
            send(JSON.stringify({ type: 'pong', id: msg.id }));
            return;
        }
        if (msg.type !== 'execute') return;
        try {
            const result = await execute(msg.code);
            send(JSON.stringify({ type: 'result', id: msg.id, result: serializeResult(result) }));
        } catch (e) {
            send(JSON.stringify({ type: 'error', id: msg.id, error: (e && e.message) || String(e) }));
        }
    }

    return { execute, handleMessage, probe, File, Folder };
}

module.exports = { createRuntime, parsesAsScript, serializeResult };
