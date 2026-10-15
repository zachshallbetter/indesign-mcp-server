/**
 * Static script audit: every tool runs with sample arguments against a stubbed
 * executor (Illustrator is never contacted); each script it generates must
 * parse as ES5 and use only names in Illustrator's object model.
 *
 *   node tests/audit.js [toolNameRegex]
 *
 * Object-model names: types-for-adobe's Illustrator 2022 declarations plus the
 * 2023-2025 object models (tests/fixtures/illustrator-object-model.json).
 * ElementPlacement is not in either, but is in Illustrator at runtime: published
 * scripts use PLACEATBEGINNING, PLACEATEND, PLACEBEFORE, PLACEAFTER and INSIDE
 * hundreds of times.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { auditTools, loadTypings, sample } from 'adobe-mcp-core/testing';
import { createServer } from '../src/server.js';
import { executor } from '../src/executor.js';

const require = createRequire(import.meta.url);
const types = path.dirname(require.resolve('types-for-adobe/package.json'));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/illustrator-object-model.json', import.meta.url), 'utf8'));

// Fields of the spec objects the server passes into its scripts: __targets(spec)
// reads spec.ids and spec.names, __color(spec) reads spec.v, and
// create_data_sets reads each value's fileError.
const HELPER_FIELDS = ['ids', 'names', 'v', 'fileError'];

export const typings = loadTypings({
    files: ['Illustrator/2022/index.d.ts', 'shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => path.join(types, f)),
    allowedNames: [...fixture.members, ...HELPER_FIELDS, 'PLACEATBEGINNING', 'PLACEATEND', 'PLACEBEFORE', 'PLACEAFTER', 'INSIDE', 'hasOwnProperty', 'create'],
    allowedGlobals: [...fixture.globals, 'ElementPlacement'],
});

/** Tools answered without a script, and the one whose script is the caller's. */
export const NO_SCRIPT = ['help', 'find_menu_commands'];
export const USER_CODE = ['execute_illustrator_code'];

/** Valid arguments for parameters with a format the generic samples cannot meet. */
const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');
const OVERRIDES = {
    create_path: { points: [[0, 0], [100, 0], { x: 100, y: 100, in: [90, 80], out: [110, 120] }], closed: true },
    export_png: { artboards: '1-2' },
    export_svg: { artboards: '1', outputFile: path.join(docs, 'audit.svg') },
    export_for_screens: { artboards: '1', scales: [1, 2], formats: ['png', 'svg', 'pdf'] },
    export_jpeg: { artboards: '1-2', matteColor: '#F0F0F0' },
    export_web_svg: { artboards: '1,3', outputFile: path.join(docs, 'audit.svg') },
    export_pdf: {
        artboards: '1', outputFile: path.join(docs, 'audit.pdf'), preset: '[PDF/X-4:2008]', compatibility: 'acrobat7', standard: 'x4',
        marks: ['all'], colorConversion: 'convert_to_destination',
    },
    execute_menu_command: { command: 'expandStyle' },
    select_tool: { tool: 'Pen Tool' },
    make_blend: { steps: 12, orientation: 'path' },
    set_blend_options: { steps: 8 },
    reverse_blend: { what: 'spine' },
    apply_effect: { effect: 'offset_path', options: { offset: -2, joins: 'round' }, expand: true },
    get_preferences: { names: ['usePreviewBounds', 'keyboardIncrement'] },
    open_document: { filePath: path.join(docs, 'audit.ai') },
    print_document: { outputFile: path.join(docs, 'audit.ps'), marks: { marks: ['all'], trimMarkWeight: 0.25, bleed: 9 }, general: { artboards: '1-2', copies: 2 } },
    edit_colors: { operation: 'convert_to_cmyk' },
    create_swatch: { color: 'lab(50,20,-30)', spot: true, group: 'Brand' },
    set_fill: { color: 'PANTONE 185 C', tint: 40 },
    set_stroke: { color: 'Brand Blue', tint: 60 },
    select_same: { attribute: 'fill_color' },
    create_variable: { name: 'headline', kind: 'text' },
    bind_variable: { name: 'headline' },
    create_data_sets: { records: [{ name: 'Row 1', values: { headline: 'Spring sale', photo: path.join(docs, 'a.jpg'), badge: true } }] },
    show_data_set: { name: 'Row 1', index: undefined },
    delete_data_sets: { all: undefined },
    import_variables: { filePath: path.join(docs, 'vars.xml') },
    export_variables: { filePath: path.join(docs, 'vars.xml') },
    export_data_sets: { format: 'jpeg', transparent: undefined, artboards: '1-2' },
    path_operation: { operation: 'outline_stroke' },
    average_points: { axis: 'both', join: true, selectedPointsOnly: true },
    split_into_grid: { rows: 3, columns: 4, gutter: 6, addGuides: true },
    split_path: { pointIndex: 2 },
    get_path_info: { includePoints: true },
    set_path_options: { evenOdd: true, guide: false, pixelAligned: true },
    save_document: {
        filePath: path.join(docs, 'audit.eps'), separateArtboards: true, artboards: '1-2',
        pdfCompatible: undefined, compressed: undefined, embedIccProfile: undefined, fontSubsetThreshold: undefined,
    },
    place_image: { filePath: path.join(docs, 'audit.png') },
};

function sampleArgs(tool) {
    const args = Object.fromEntries(Object.entries(tool.inputSchema?.properties || {}).map(([k, v]) => [k, sample(k, v)]));
    return { ...args, ...(OVERRIDES[tool.name] ?? {}) };
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
