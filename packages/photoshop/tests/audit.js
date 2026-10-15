/**
 * Static script audit: every tool runs with sample arguments against a stubbed
 * executor (Photoshop is never contacted); each script it generates must parse
 * as ES5 and use only names in Photoshop's object model.
 *
 *   node tests/audit.js [toolNameRegex]
 *
 * Object-model names: types-for-adobe's Photoshop 2015.5 declarations.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { auditTools, loadTypings, sample } from 'adobe-mcp-core/testing';
import { createServer, toolTable } from '../src/server.js';
import { executor } from '../src/executor.js';

const require = createRequire(import.meta.url);
const types = path.dirname(require.resolve('types-for-adobe/package.json'));

// Fields of the spec objects the server passes into its scripts: __targets(spec)
// reads spec.ids, spec.names and spec.active; __color(spec) reads spec.kind and spec.v.
const HELPER_FIELDS = ['ids', 'names', 'active', 'kind', 'v'];

export const typings = loadTypings({
    files: ['Photoshop/2015.5/index.d.ts', 'shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => path.join(types, f)),
    allowedNames: [...HELPER_FIELDS, 'hasOwnProperty'],
    allowedGlobals: [],
});

/** Tools answered without a script, and the one whose script is the caller's. */
export const NO_SCRIPT = ['help'];
export const USER_CODE = ['execute_photoshop_code'];

/** Valid arguments for parameters with a format the generic samples cannot meet. */
const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');
const OVERRIDES = {
    save_document: { filePath: path.join(docs, 'audit.tif'), compression: 'lzw', format: 'progressive' },
    set_active_document: { index: undefined },
    set_colors: { foreground: '#FF6600', background: 'cmyk(0,0,0,100)' },
    resize_image: { scale: undefined, reduceNoise: undefined, scaleStyles: undefined },
    rotate_canvas: { flip: undefined },
    set_layer_properties: { target: { ids: [7] } },
    fill_selection: { color: 'gray(40)' },
    stroke_selection: { color: 'hsb(200,50,50)' },
};

function sampleArgs(tool) {
    const args = Object.fromEntries(Object.entries(tool.inputSchema?.properties || {}).map(([k, v]) => [k, sample(k, v)]));
    const own = toolTable.find((t) => t.name === tool.name)?.auditArgs;
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
