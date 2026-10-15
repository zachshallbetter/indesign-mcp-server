/**
 * Script audit: runs every tool handler with sample arguments derived from its
 * input schema (InDesign is not contacted; the executor is stubbed), captures
 * the ExtendScript each one generates, and checks that:
 *   1. every advertised tool dispatches to a handler method,
 *   2. every generated script parses as ES5 (ExtendScript has no let/const,
 *      arrows, template literals or JSON),
 *   3. every property/method name and global the script uses exists in the
 *      InDesign 2023 + ExtendScript type definitions (types-for-adobe).
 *
 * Usage: node tests/audit/scripts.audit.js [toolNameRegex] [--dump dir]
 * Exit code 1 on any finding. Names that are legitimately the script's own
 * object fields go in ALLOWED_NAMES below.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { collectToolScripts } from './collectScripts.js';

const require = createRequire(import.meta.url);
const typesRoot = path.dirname(require.resolve('types-for-adobe/package.json'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const dumpAt = args.indexOf('--dump');
const dumpDir = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const filter = args[0] ? new RegExp(args[0]) : null;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

// Fields of plain objects the scripts build themselves, or ExtendScript
// built-ins missing from the typings.
const ALLOWED_NAMES = new Set([
    'length', 'push', 'join', 'toString', 'message', 'slice', 'split', 'indexOf', 'replace', 'toFixed',
    'charAt', 'charCodeAt', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'match', 'concat', 'sort',
    'pop', 'shift', 'unshift', 'splice', 'reverse', 'exists', 'fsName', 'fullName', 'lineNumber', 'number',
    'test', 'exec', 'apply', 'call', 'getTime', 'toUTCString', 'getFullYear', 'getMonth', 'getDate',
    // Fields of the spec objects module tools pass into their helpers (src/tools/script.js):
    // __targets(spec) reads ids, names and selection; __swatch(spec) reads kind, name and v.
    'kind', 'v', 'ids', 'names',
    // The prelude is in every module script, also where no target literal declares those keys.
]);
const ALLOWED_GLOBALS = new Set([
    'undefined', 'NaN', 'Infinity', 'Math', 'String', 'Number', 'Array', 'Object', 'Date', 'RegExp', 'Error',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Boolean', 'Function', 'encodeURI', 'decodeURI',
    'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'app', '$', 'File', 'Folder',
    'arguments', 'eval', 'UnitValue',
]);

// Tools whose script body is supplied by the caller.
const USER_CODE_TOOLS = new Set(['execute_indesign_code']);
// Tools answered in Node without sending a script to InDesign.
const NO_SCRIPT_TOOLS = new Set(['help', 'indesign_status', 'get_session_info', 'clear_session']);

function loadTypings() {
    const files = ['InDesign/2023/index.d.ts', 'shared/JavaScript.d.ts', 'shared/global.d.ts', 'shared/ScriptUI.d.ts'];
    const dts = files.map((f) => readFileSync(path.join(typesRoot, f), 'utf8')).join('\n');
    const members = new Set(ALLOWED_NAMES);
    const globals = new Set(ALLOWED_GLOBALS);
    for (const m of dts.matchAll(/^\s*(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\??\s*[:(<]/gm)) members.add(m[1]);
    for (const m of dts.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*\d+/gm)) members.add(m[1]);
    for (const m of dts.matchAll(/declare\s+(?:class|enum|var|const|let|function|interface)\s+([A-Za-z_$][\w$]*)/g)) globals.add(m[1]);
    globals.delete('JSON'); // not available in InDesign's ExtendScript engine
    return { members, globals };
}

function checkScript(src, typings) {
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

// var x = {} / var x = [] / var x = new Object()
function isPlainObjectVar(ast, name) {
    let plain = false;
    walk.simple(ast, {
        VariableDeclarator(n) {
            if (n.id.name !== name || !n.init) return;
            if (n.init.type === 'ObjectExpression') plain = true;
            if (n.init.type === 'NewExpression' && n.init.callee.name === 'Object') plain = true;
        },
    });
    return plain;
}

const typings = loadTypings();
const { TOOL_HANDLERS } = await import('../../src/core/InDesignMCPServer.js');
const dispatched = new Set(Object.keys(TOOL_HANDLERS));

const problems = [];
let checkedScripts = 0;
let checkedTools = 0;

for (const { tool, args: toolArgs, scripts: captured, result, error } of await collectToolScripts({ filter })) {
    checkedTools++;
    if (!dispatched.has(tool.name)) {
        problems.push([tool.name, 'no handler in TOOL_HANDLERS (src/core/InDesignMCPServer.js)']);
        continue;
    }
    if (error) {
        problems.push([tool.name, `threw with sample args ${JSON.stringify(toolArgs)}: ${error.message}`]);
        continue;
    }
    if (/not found\. Use 'help'/.test(JSON.stringify(result))) {
        problems.push([tool.name, 'returns "not implemented"']);
        continue;
    }
    if (!captured.length && !NO_SCRIPT_TOOLS.has(tool.name)) {
        problems.push([tool.name, `generated no script with sample args ${JSON.stringify(toolArgs)}: ${JSON.stringify(result).slice(0, 200)}`]);
    }
    captured.forEach((script, i) => {
        checkedScripts++;
        if (USER_CODE_TOOLS.has(tool.name)) return; // the script is the caller's own code
        if (dumpDir) writeFileSync(path.join(dumpDir, `${tool.name}${i ? '.' + i : ''}.jsx`), script);
        for (const f of checkScript(script, typings)) problems.push([tool.name, f]);
    });
}

for (const [tool, msg] of problems) console.log(`${tool}: ${msg}`);
console.log(`\n${checkedTools} tools, ${checkedScripts} scripts checked, ${problems.length} findings`);
if (problems.length) process.exitCode = 1;
