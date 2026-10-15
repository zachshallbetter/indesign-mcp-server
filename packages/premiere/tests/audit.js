/**
 * Static script audit: every tool runs with sample arguments against a stubbed
 * executor (Premiere Pro is never contacted); each script it generates must
 * parse as modern JavaScript and use only names in Premiere Pro's UXP DOM.
 *
 *   node tests/audit.js [toolNameRegex]
 *
 * The DOM's names come from tests/fixtures/premiere-uxp-api.json (see
 * scripts/generate-fixtures.js). Checks:
 *   - ppro.<Class> names a class (or Constants), ppro.<Class>.<member> a static
 *     member of that class, new ppro.<Class>() a class with a constructor,
 *     ppro.Constants.<Enum>.<VALUE> an enum and one of its values. Aliases such
 *     as `const __C = ppro.Constants` are followed.
 *   - Any other .member is an instance method or property of some class, a
 *     plain JavaScript member (length, map, ...), or a key the script's own
 *     object literals create.
 *   - Every free identifier is declared in the script, is ppro or transact, or
 *     is a JavaScript global.
 *   - The newest Premiere Pro version among the members a script uses is at
 *     most the tool's `since` (default 25.6), apart from members the tool
 *     lists in `guarded` (used only after checking they exist).
 */
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { sample } from 'adobe-mcp-core/testing';
import { createServer, toolTable } from '../src/server.js';
import { executor } from '../src/executor.js';

export const api = JSON.parse(readFileSync(new URL('./fixtures/premiere-uxp-api.json', import.meta.url), 'utf8'));
export const BASE_VERSION = '25.6';

/** Plain JavaScript members the scripts use on arrays, strings, promises, Math, Object, JSON, Set. */
export const JS_MEMBERS = new Set([
    'length', 'push', 'pop', 'shift', 'map', 'filter', 'find', 'findIndex', 'some', 'every', 'includes', 'indexOf',
    'join', 'slice', 'split', 'concat', 'sort', 'forEach', 'reduce', 'keys', 'values', 'entries', 'fromEntries',
    'assign', 'isArray', 'stringify', 'parse', 'round', 'abs', 'max', 'min', 'floor', 'ceil', 'toLowerCase',
    'toUpperCase', 'trim', 'startsWith', 'endsWith', 'replace', 'test', 'charAt', 'message', 'then', 'catch',
    'resolve', 'reject', 'all', 'has', 'add', 'get', 'set', 'delete', 'size', 'toString', 'getPrototypeOf',
]);

export const JS_GLOBALS = new Set([
    'undefined', 'NaN', 'Infinity', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'Math',
    'JSON', 'Promise', 'Set', 'Map', 'Date', 'RegExp', 'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'setTimeout',
    'clearTimeout', 'console',
]);

/**
 * Fields of the spec objects the server writes into scripts as JSON literals:
 * __clips(seq, spec) reads items, selected, track, trackIndex, clipIndex;
 * __param(component, spec) reads param and paramIndex; a marker spec has
 * index; add_keyframes' keys have t, v and mode.
 */
export const SPEC_FIELDS = new Set(['items', 'selected', 'track', 'trackIndex', 'clipIndex', 'param', 'paramIndex', 'index', 't', 'v', 'mode']);

/** Names the plugin puts in every script's scope. */
export const SCRIPT_GLOBALS = new Set(['ppro', 'transact']);

const cmp = (a, b) => {
    const [x, y] = [a, b].map((v) => v.split('.').map(Number));
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
};
export const newest = (versions) => versions.reduce((m, v) => (cmp(v, m) > 0 ? v : m), BASE_VERSION);

/** Instance methods and properties of every class: name -> earliest version any class has it. */
const INSTANCE = new Map();
for (const c of Object.values(api.classes)) {
    for (const [m, since] of [...Object.entries(c.instance), ...Object.entries(c.properties)]) {
        if (!INSTANCE.has(m) || cmp(since, INSTANCE.get(m)) < 0) INSTANCE.set(m, since);
    }
}

function declaredNames(pattern, out) {
    if (!pattern) return;
    switch (pattern.type) {
        case 'Identifier': out.add(pattern.name); break;
        case 'ObjectPattern': for (const p of pattern.properties) declaredNames(p.type === 'RestElement' ? p.argument : p.value, out); break;
        case 'ArrayPattern': for (const e of pattern.elements) declaredNames(e, out); break;
        case 'AssignmentPattern': declaredNames(pattern.left, out); break;
        case 'RestElement': declaredNames(pattern.argument, out); break;
        default: break;
    }
}

/**
 * Check one script.
 * @returns {{ problems: string[], uses: Map<string, string> }} uses: API member -> the version it needs
 */
export function checkScript(src) {
    const problems = [];
    const uses = new Map();
    let ast;
    try {
        ast = acorn.parse(`(async function (ppro, transact) {\n${src}\n})`, { ecmaVersion: 2022, locations: true });
    } catch (e) {
        const line = src.split('\n')[(e.loc?.line ?? 2) - 2] ?? '';
        return { problems: [`parse error: ${e.message} :: ${line.trim().slice(0, 120)}`], uses };
    }
    const lineOf = (n) => n.loc.start.line - 1;

    const declared = new Set();
    const ownKeys = new Set();
    const aliases = new Map(); // name -> ppro chain
    walk.full(ast, (n) => {
        if (n.type === 'VariableDeclarator') declaredNames(n.id, declared);
        if (n.type === 'FunctionDeclaration' && n.id) declared.add(n.id.name);
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)) n.params.forEach((p) => declaredNames(p, declared));
        if (n.type === 'CatchClause' && n.param) declaredNames(n.param, declared);
        if (n.type === 'Property' && !n.computed) ownKeys.add(n.key.name ?? String(n.key.value));
    });
    // obj.key = ... where obj was declared as an object literal: the script's own key.
    const plainObjects = new Set();
    walk.simple(ast, {
        VariableDeclarator(n) { if (n.id.type === 'Identifier' && n.init?.type === 'ObjectExpression') plainObjects.add(n.id.name); },
    });
    walk.simple(ast, {
        AssignmentExpression(n) {
            const l = n.left;
            if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'Identifier' && plainObjects.has(l.object.name)) ownKeys.add(l.property.name);
        },
    });

    /** The ppro chain a node stands for: [] for ppro itself, ['Constants', 'MarkerColor'], ... or null. */
    function chainOf(n) {
        if (n.type === 'Identifier') return n.name === 'ppro' ? [] : (aliases.get(n.name) ?? null);
        if (n.type === 'MemberExpression' && !n.computed) {
            const base = chainOf(n.object);
            return base ? [...base, n.property.name] : null;
        }
        return null;
    }
    // An alias is a name declared once, as a ppro chain. A name declared more
    // than once (in different scopes) is not followed.
    const declarations = new Map();
    walk.full(ast, (n) => {
        const names = new Set();
        if (n.type === 'VariableDeclarator') declaredNames(n.id, names);
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)) n.params.forEach((p) => declaredNames(p, names));
        if (n.type === 'CatchClause' && n.param) declaredNames(n.param, names);
        for (const name of names) declarations.set(name, (declarations.get(name) ?? 0) + 1);
    });
    walk.simple(ast, {
        VariableDeclarator(n) {
            if (n.id.type === 'Identifier' && n.init && declarations.get(n.id.name) === 1) {
                const c = chainOf(n.init);
                if (c) aliases.set(n.id.name, c);
            }
        },
    });

    const seen = new Set();
    const report = (key, msg) => { if (!seen.has(key)) { seen.add(key); problems.push(msg); } };

    /** Check a full ppro chain; record the member's version. */
    function checkChain(chain, node) {
        const [head, second, third] = chain;
        const where = `(line ${lineOf(node)})`;
        const text = `ppro.${chain.join('.')}`;
        if (head === 'Constants') {
            if (chain.length === 1) return;
            if (!(second in api.constants)) return report(text, `unknown enum: ${text} ${where}`);
            if (chain.length === 2) return;
            if (chain.length > 3 || !api.constants[second].includes(third)) report(text, `unknown constant: ${text} ${where}`);
            return;
        }
        const cls = api.classes[head];
        if (!cls) return report(text, `unknown class: ppro.${head} ${where}`);
        if (chain.length === 1) { uses.set(head, cls.since); return; }
        if (chain.length > 2) return report(text, `unexpected chain: ${text} ${where}`);
        if (!(second in cls.static)) return report(text, `${head} has no static member ${second} ${where}`);
        uses.set(`${head}.${second}`, cls.static[second]);
    }

    walk.fullAncestor(ast, (n, _state, ancestors) => {
        const parent = ancestors[ancestors.length - 2];
        if (n.type === 'MemberExpression' && !n.computed) {
            const name = n.property.name;
            const chain = chainOf(n);
            if (chain) {
                // Check only the outermost member of a chain: ppro.Constants.X.Y once, not at each step.
                if (!(parent?.type === 'MemberExpression' && parent.object === n && !parent.computed)) checkChain(chain, n);
                return;
            }
            if (JS_MEMBERS.has(name) || ownKeys.has(name) || SPEC_FIELDS.has(name)) return;
            if (INSTANCE.has(name)) { uses.set(`.${name}`, INSTANCE.get(name)); return; }
            report(`m:${name}`, `unknown member: .${name} (line ${lineOf(n)})`);
        }
        if (n.type === 'NewExpression') {
            const chain = chainOf(n.callee);
            if (chain && chain.length === 1 && api.classes[chain[0]] && !api.classes[chain[0]].constructorSince) {
                report(`new:${chain[0]}`, `ppro.${chain[0]} has no constructor (line ${lineOf(n)})`);
            }
        }
        if (n.type === 'Identifier') {
            if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
            if (parent?.type === 'Property' && parent.key === n && !parent.computed) return;
            if (declared.has(n.name) || SCRIPT_GLOBALS.has(n.name) || JS_GLOBALS.has(n.name)) return;
            report(`g:${n.name}`, `unknown global: ${n.name} (line ${lineOf(n)})`);
        }
    });
    return { problems, uses };
}

/** Tools answered without a script, and the one whose script is the caller's. */
export const NO_SCRIPT = ['help'];
export const USER_CODE = ['execute_premiere_code'];

export function sampleArgs(tool) {
    const args = Object.fromEntries(Object.entries(tool.inputSchema?.properties || {}).map(([k, v]) => [k, sample(k, v)]));
    const own = toolTable.find((t) => t.name === tool.name)?.auditArgs ?? {};
    return { ...args, ...own };
}

/**
 * Run every tool with sample arguments against a stubbed executor and check
 * each script it sends.
 */
export async function audit(filter = null) {
    const mcp = createServer();
    const saved = { runScript: executor.runScript, start: executor.start, status: executor.status };
    let captured = [];
    executor.runScript = async (s) => { captured.push(s); return { ok: true, result: {} }; };
    executor.start = async () => 'host';
    executor.status = async () => ({ mode: 'host', connected: true, plugin: { hostVersion: '26.5.0' } });
    const problems = [];
    let scripts = 0;
    const versions = {};
    try {
        for (const tool of toolTable) {
            if (filter && !filter.test(tool.name)) continue;
            captured = [];
            const args = sampleArgs(tool);
            let result;
            try {
                result = await mcp.handleToolCall(tool.name, args);
            } catch (e) {
                problems.push([tool.name, `threw with sample args ${JSON.stringify(args)}: ${e.message}`]);
                continue;
            }
            if (!captured.length && !NO_SCRIPT.includes(tool.name)) {
                problems.push([tool.name, `generated no script: ${JSON.stringify(result).slice(0, 200)}`]);
            }
            const used = new Map();
            for (const s of captured) {
                scripts++;
                if (USER_CODE.includes(tool.name)) continue;
                const r = checkScript(s);
                for (const p of r.problems) problems.push([tool.name, p]);
                for (const [k, v] of r.uses) used.set(k, v);
            }
            const guarded = new Set(tool.guarded ?? []);
            const counted = [...used].filter(([k]) => !guarded.has(k.replace(/^.*\./, '')) && !guarded.has(k));
            const needs = newest(counted.map(([, v]) => v));
            versions[tool.name] = needs;
            const declares = tool.since ?? BASE_VERSION;
            if (cmp(needs, declares) > 0) {
                const newer = counted.filter(([, v]) => cmp(v, declares) > 0).map(([k, v]) => `${k} (${v})`);
                problems.push([tool.name, `uses ${newer.join(', ')} but declares Premiere Pro ${declares}: set since, or guard the call and list it in guarded`]);
            }
        }
    } finally {
        Object.assign(executor, saved);
    }
    return { tools: toolTable.length, scripts, problems, versions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const report = await audit(process.argv[2] ? new RegExp(process.argv[2]) : null);
    for (const [tool, msg] of report.problems) console.log(`${tool}: ${msg}`);
    console.log(`\n${report.tools} tools, ${report.scripts} scripts checked, ${report.problems.length} findings`);
    if (report.problems.length) process.exitCode = 1;
}
