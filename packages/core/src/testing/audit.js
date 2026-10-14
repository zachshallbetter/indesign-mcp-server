/**
 * Static script audit, shared by every server.
 *
 * Runs each tool handler with sample arguments derived from its input schema,
 * with the executor stubbed so the application is never contacted, captures
 * the ExtendScript each one generates, and checks that:
 *   1. every advertised tool has a handler and generates a script,
 *   2. every script parses as ES5 (ExtendScript has no let/const, arrows,
 *      template literals or JSON),
 *   3. every member and global the script uses exists in the application's
 *      type definitions plus the ExtendScript core typings.
 *
 * Import from 'adobe-mcp-core/testing'. Needs acorn and acorn-walk.
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

/** Built-ins of plain JS values the scripts use that the Adobe typings omit. */
export const DEFAULT_ALLOWED_NAMES = [
    'length', 'push', 'join', 'toString', 'message', 'slice', 'split', 'indexOf', 'replace', 'toFixed',
    'charAt', 'charCodeAt', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'match', 'concat', 'sort',
    'pop', 'shift', 'unshift', 'splice', 'reverse', 'exists', 'fsName', 'fullName', 'lineNumber', 'number',
    'test', 'exec', 'apply', 'call', 'getTime', 'toUTCString', 'getFullYear', 'getMonth', 'getDate',
];
export const DEFAULT_ALLOWED_GLOBALS = [
    'undefined', 'NaN', 'Infinity', 'Math', 'String', 'Number', 'Array', 'Object', 'Date', 'RegExp', 'Error',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Boolean', 'Function', 'encodeURI', 'decodeURI',
    'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'app', '$', 'File', 'Folder',
    'arguments', 'eval', 'UnitValue',
];

/** A plausible argument for a schema property, chosen from its name and type. */
export function sample(name, schema) {
    if (!schema) return 'Sample';
    if (schema.enum) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    const n = name.toLowerCase();
    switch (schema.type) {
        case 'number':
        case 'integer':
            return /index|page|spread|artboard|position|row|column/.test(n) ? 0 : 10;
        case 'boolean':
            return true;
        case 'array': {
            const one = (i) => {
                const v = sample(name, schema.items ?? { type: 'string' });
                return typeof v === 'number' ? v + i : v;
            };
            return Array.from({ length: Math.max(2, schema.minItems ?? 0) }, (_, i) => one(i));
        }
        case 'object': {
            const o = {};
            for (const [k, v] of Object.entries(schema.properties || {})) o[k] = sample(k, v);
            return o;
        }
        default:
            if (/folder|directory|outputdir/.test(n)) return path.join(os.homedir(), 'Documents');
            if (/path|file/.test(n)) return path.join(os.homedir(), 'Documents', 'audit.file');
            if (/colou?r|swatch/.test(n)) return 'Black';
            return 'Sample';
    }
}

/**
 * Run every tool with sample arguments and capture the scripts it would send.
 * @param {{ handleToolCall: Function, tools: object[] }} mcp  from createMcpServer
 * @param {object} executor  from createExecutor; runScript is stubbed during the call
 * @param {{ filter?: RegExp|null, sampleArgs?: (tool: object) => object }} [opts]
 * @returns {Promise<Array<{ tool: object, args: object, scripts: string[], result?: any, error?: Error }>>}
 */
export async function collectToolScripts(mcp, executor, { filter = null, sampleArgs } = {}) {
    const original = executor.runScript;
    let captured = [];
    executor.runScript = async (script) => {
        captured.push(script);
        return 'OK';
    };
    const out = [];
    try {
        for (const tool of mcp.tools) {
            if (filter && !filter.test(tool.name)) continue;
            const args = sampleArgs?.(tool) ?? Object.fromEntries(
                Object.entries(tool.inputSchema?.properties || {}).map(([k, v]) => [k, sample(k, v)])
            );
            captured = [];
            const entry = { tool, args, scripts: captured };
            try {
                entry.result = await mcp.handleToolCall(tool.name, args);
            } catch (e) {
                entry.error = e;
            }
            out.push(entry);
        }
    } finally {
        executor.runScript = original;
    }
    return out;
}

/**
 * Member and global names from .d.ts files.
 * @param {{ files: string[], allowedNames?: string[], allowedGlobals?: string[], excludeGlobals?: string[] }} opts
 */
export function loadTypings({ files, allowedNames = [], allowedGlobals = [], excludeGlobals = ['JSON'] }) {
    const dts = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const members = new Set([...DEFAULT_ALLOWED_NAMES, ...allowedNames]);
    const globals = new Set([...DEFAULT_ALLOWED_GLOBALS, ...allowedGlobals]);
    for (const m of dts.matchAll(/^\s*(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\??\s*[:(<]/gm)) members.add(m[1]);
    for (const m of dts.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*\d+/gm)) members.add(m[1]);
    for (const m of dts.matchAll(/declare\s+(?:class|enum|var|const|let|function|interface)\s+([A-Za-z_$][\w$]*)/g)) globals.add(m[1]);
    for (const g of excludeGlobals) globals.delete(g);
    return { members, globals };
}

// var x = {} / var x = [] / var x = new Object()
function isPlainObjectVar(ast, name) {
    let plain = false;
    walk.simple(ast, {
        VariableDeclarator(n) {
            if (n.id.name !== name || !n.init) return;
            if (n.init.type === 'ObjectExpression' || n.init.type === 'ArrayExpression') plain = true;
            if (n.init.type === 'NewExpression' && n.init.callee.name === 'Object') plain = true;
        },
    });
    return plain;
}

/** Findings for one script: parse errors, unknown members, unknown globals. */
export function checkScript(src, typings) {
    const findings = [];
    let ast;
    try {
        ast = acorn.parse(src, { ecmaVersion: 5, allowReturnOutsideFunction: true, locations: true });
    } catch (e) {
        const line = src.split('\n')[(e.loc?.line ?? 1) - 1] ?? '';
        return [`parse error: ${e.message} :: ${line.trim().slice(0, 120)}`];
    }
    const declared = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'VariableDeclarator') declared.add(n.id.name);
        if (n.type === 'FunctionDeclaration' && n.id) declared.add(n.id.name);
        if (n.type === 'CatchClause' && n.param) declared.add(n.param.name);
        if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') n.params.forEach((p) => declared.add(p.name));
    });
    // Object literal keys the script itself creates are legitimate member names.
    const ownKeys = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'Property') ownKeys.add(n.key.name ?? n.key.value);
        if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed
            && n.left.object.type === 'Identifier' && declared.has(n.left.object.name)
            && /^[a-z]/.test(n.left.property.name) && isPlainObjectVar(ast, n.left.object.name)) {
            ownKeys.add(n.left.property.name);
        }
    });
    const seen = new Set();
    walk.fullAncestor(ast, (n, _s, anc) => {
        if (n.type === 'MemberExpression' && !n.computed) {
            const name = n.property.name;
            if (!typings.members.has(name) && !ownKeys.has(name) && !seen.has('m:' + name)) {
                seen.add('m:' + name);
                findings.push(`unknown member: .${name} (line ${n.loc.start.line})`);
            }
        }
        if (n.type === 'Identifier') {
            const parent = anc[anc.length - 2];
            if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
            if (parent?.type === 'Property' && parent.key === n) return;
            if (parent?.type === 'VariableDeclarator' && parent.id === n) return;
            if (!declared.has(n.name) && !typings.globals.has(n.name) && !seen.has('g:' + n.name)) {
                seen.add('g:' + n.name);
                findings.push(`unknown global: ${n.name} (line ${n.loc.start.line})`);
            }
        }
    });
    return findings;
}

/**
 * Audit every tool of a server.
 * @param {object} opts
 * @param {{ handleToolCall: Function, tools: object[] }} opts.mcp
 * @param {object} opts.executor
 * @param {{ members: Set<string>, globals: Set<string> }} opts.typings
 * @param {Iterable<string>} [opts.noScriptTools] tools answered without a script
 * @param {Iterable<string>} [opts.userCodeTools] tools whose script is the caller's own code
 * @param {RegExp|null} [opts.filter]
 * @param {(tool: object) => object} [opts.sampleArgs] arguments for a tool, when the generated samples would be refused
 * @returns {Promise<{ tools: number, scripts: number, problems: Array<[string, string]>, captured: Array }>}
 */
export async function auditTools({ mcp, executor, typings, noScriptTools = [], userCodeTools = [], filter = null, sampleArgs }) {
    const noScript = new Set(noScriptTools);
    const userCode = new Set(userCodeTools);
    const problems = [];
    let scripts = 0;
    const captured = await collectToolScripts(mcp, executor, { filter, sampleArgs });
    for (const { tool, args, scripts: list, result, error } of captured) {
        if (error) {
            problems.push([tool.name, `threw with sample args ${JSON.stringify(args)}: ${error.message}`]);
            continue;
        }
        if (/not found\. Use 'help'/.test(JSON.stringify(result))) {
            problems.push([tool.name, 'has no handler']);
            continue;
        }
        if (!list.length && !noScript.has(tool.name)) {
            problems.push([tool.name, `generated no script with sample args ${JSON.stringify(args)}: ${JSON.stringify(result).slice(0, 200)}`]);
        }
        for (const script of list) {
            scripts++;
            if (userCode.has(tool.name)) continue;
            for (const f of checkScript(script, typings)) problems.push([tool.name, f]);
        }
    }
    return { tools: captured.length, scripts, problems, captured };
}
