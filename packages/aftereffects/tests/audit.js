/**
 * Static script audit: every tool runs with sample arguments against a stubbed
 * executor (After Effects is never contacted); each script it generates must parse
 * as ES5 and use only names in After Effects' object model.
 *
 *   node tests/audit.js [toolNameRegex]
 *
 * Object-model names: types-for-adobe's After Effects 26.0 declarations.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { auditTools, loadTypings, sample } from 'adobe-mcp-core/testing';
import { createServer, toolTable } from '../src/server.js';
import { executor } from '../src/executor.js';

const require = createRequire(import.meta.url);
const types = path.dirname(require.resolve('types-for-adobe/package.json'));

// Fields of the spec objects the server passes into its scripts: __comp(spec) reads
// id and name; __layers(spec) reads indexes, names and selected; keyframe lists
// carry t, v, i and e.
const HELPER_FIELDS = ['id', 'name', 'indexes', 'names', 'selected', 't', 'v', 'i', 'e'];

const AE_TYPINGS = path.join(types, 'AfterEffects/26.0/index.d.ts');

// Some enums have mixed-case members (ToolType.Tool_CameraOrbit,
// PREFType.PREF_Type_MACHINE_SPECIFIC), which the shared loader, reading
// upper-case enum members only, does not pick up.
const MIXED_CASE_ENUMS = ['ToolType', 'PREFType'];
const ENUM_MEMBERS = MIXED_CASE_ENUMS.flatMap((e) => {
    const body = new RegExp(`declare enum ${e} \\{([^}]*)\\}`).exec(readFileSync(AE_TYPINGS, 'utf8'))[1];
    return [...body.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]);
});

export const typings = loadTypings({
    files: [AE_TYPINGS, ...['shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => path.join(types, f))],
    allowedNames: [...HELPER_FIELDS, ...ENUM_MEMBERS, 'hasOwnProperty'],
    allowedGlobals: [],
});

/** Tools answered without a script, and the one whose script is the caller's. */
export const NO_SCRIPT = ['help'];
export const USER_CODE = ['execute_aftereffects_code'];

const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');
const OVERRIDES = {
    manage_items: { rename: undefined },
    save_project: { filePath: path.join(docs, 'audit.aep') },
};

function sampleArgs(tool) {
    const args = Object.fromEntries(Object.entries(tool.inputSchema?.properties || {}).map(([k, v]) => [k, sample(k, v)]));
    const own = toolTable.find((t) => t.name === tool.name)?.auditArgs;
    // Layers are numbered from 1 in After Effects; the generic sample starts at 0.
    if (args.layers) args.layers = { indexes: [1, 2] };
    return { ...args, ...(OVERRIDES[tool.name] ?? own ?? {}) };
}

export async function audit(filter = null) {
    return auditTools({ mcp: createServer(), executor, typings, noScriptTools: NO_SCRIPT, userCodeTools: USER_CODE, filter, sampleArgs });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const report = await audit(process.argv[2] ? new RegExp(process.argv[2]) : null);
    for (const [tool, msg] of report.problems) console.log(`${tool}: ${msg}`);
    console.log(`\n${report.tools} tools, ${report.scripts} scripts checked, ${report.problems.length} findings`);
    if (report.problems.length) process.exitCode = 1;
}
