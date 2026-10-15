import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolTable, toolDefinitions, annotations, SERVER_INSTRUCTIONS } from '../src/server.js';
import { app } from '../src/module.js';
import { audit, checkScript, api, BASE_VERSION } from './audit.js';

const featureIds = new Set(JSON.parse(readFileSync(new URL('./fixtures/feature-ids.json', import.meta.url), 'utf8')).ids);
const HINTS = new Set(['readOnly', 'destructive', 'idempotent', 'openWorld']);

test('every tool is well-formed and names are unique', () => {
    const names = new Set();
    for (const t of toolDefinitions) {
        assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
        assert.ok(!names.has(t.name), `duplicate ${t.name}`);
        names.add(t.name);
        assert.ok(t.description.length > 20, `${t.name} needs a description`);
        assert.equal(t.inputSchema.type, 'object', t.name);
        for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name}: required ${r} is not a property`);
        assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
        assert.ok(t.title);
    }
    assert.deepEqual(annotations.unknownAnnotationNames([...names]), []);
    assert.ok(toolTable.length >= 30, `${toolTable.length} tools`);
});

test('hints are valid and consistent', () => {
    for (const t of toolTable) {
        for (const k of Object.keys(t.hints ?? {})) assert.ok(HINTS.has(k), `${t.name}: unknown hint ${k}`);
        assert.ok(!(t.hints?.readOnly && t.hints?.destructive), `${t.name} cannot be read-only and destructive`);
        if (t.auditArgs) assert.equal(typeof t.auditArgs, 'object', t.name);
        if (t.since) assert.match(t.since, /^\d+\.\d+$/, `${t.name}: since`);
        for (const g of t.guarded ?? []) assert.equal(typeof g, 'string', `${t.name}: guarded`);
    }
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['remove_clips', 'delete_sequence', 'manage_items', 'close_project', 'execute_premiere_code', 'remove_effect', 'remove_markers', 'remove_keyframes', 'remove_transition']) {
        assert.equal(byName[n].destructiveHint, true, n);
    }
    for (const n of ['list_project_items', 'list_sequences', 'list_clips', 'list_tracks', 'list_markers', 'list_clip_effects', 'get_project_info', 'get_metadata', 'premiere_status', 'help']) {
        assert.equal(byName[n].readOnlyHint, true, n);
    }
});

test('every tool claims atlas features that exist', () => {
    let claimed = 0;
    for (const t of toolTable) {
        if (t.name === 'help') continue;
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        assert.equal(new Set(t.features).size, t.features.length, `${t.name} claims a feature twice`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
        claimed += t.features.length;
    }
    assert.ok(claimed > 100);
});

test('the static script audit finds nothing, and tools needing a newer Premiere Pro say so', async () => {
    const report = await audit();
    assert.deepEqual(report.problems, []);
    assert.ok(report.scripts >= toolTable.length - 2);
    for (const t of toolTable.filter((x) => x.since)) assert.match(t.description, new RegExp(t.since.replace('.', '\\.')), `${t.name} should name Premiere Pro ${t.since} in its description`);
});

test('the audit catches a misspelt member, a wrong class, enum or static, and a stray global', () => {
    const problems = (src) => checkScript(src).problems.join('\n');
    assert.match(problems('const p = await ppro.Project.getActiveProject(); return p.getActiveSequnce();'), /unknown member: \.getActiveSequnce/);
    assert.match(problems('return ppro.Projekt;'), /unknown class: ppro\.Projekt/);
    assert.match(problems('return ppro.Project.getRootItem();'), /Project has no static member getRootItem/);
    assert.match(problems('return ppro.Constants.MarkerColor.PINK;'), /unknown constant: ppro\.Constants\.MarkerColor\.PINK/);
    assert.match(problems('const C = ppro.Constants; return C.TrackItemTypes;'), /unknown enum: ppro\.Constants\.TrackItemTypes/);
    assert.match(problems('return new ppro.Sequence();'), /ppro\.Sequence has no constructor/);
    assert.match(problems('return app.project;'), /unknown global: app/);
    assert.match(problems('return (;'), /parse error/);
    assert.equal(problems('const p = await ppro.Project.getActiveProject(); const s = await p.getActiveSequence(); return { n: s.name, t: ppro.TickTime.createWithSeconds(1).seconds, c: ppro.Constants.TrackItemType.CLIP };'), '');
    const { uses } = checkScript('const s = null; ppro.WorkAreaUtils.setWorkAreaInOutPoints(s, null, null); return ppro.ProjectConverter;');
    assert.equal(uses.get('WorkAreaUtils.setWorkAreaInOutPoints'), '26.5');
    assert.equal(uses.get('ProjectConverter'), '26.2');
});

test('the UXP fixture holds the classes, members and constants the tools rely on', () => {
    assert.equal(Object.keys(api.classes).length, 67);
    assert.equal(api.classes.Project.static.getActiveProject, BASE_VERSION);
    assert.ok('lockedAccess' in api.classes.Project.instance && 'executeTransaction' in api.classes.Project.instance);
    assert.ok(api.classes.SequenceEditor.instance.createInsertProjectItemAction);
    assert.equal(api.classes.ProjectConverter.static.exportAAF, '26.3');
    assert.ok(api.constants.TrackItemType.includes('CLIP'));
    for (const [name, c] of Object.entries(api.classes)) for (const m of c.atlasMembers) assert.ok(m in c.static || m in c.instance, `${name}.${m}`);
});

test('the module exposes the app for the suite', () => {
    assert.equal(app.id, 'premiere');
    assert.equal(app.label, 'Premiere Pro');
    assert.equal(app.tools.length, toolTable.length);
    for (const t of app.tools) assert.equal(typeof app.handlers[t.name], 'function', t.name);
    assert.match(SERVER_INSTRUCTIONS, /premiere_status/);
    assert.throws(() => app.validatePath('/etc/passwd'), /outside the allowed directories|system directory/);
});

test('an MCP client can list tools and call help', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [new URL('../src/index.js', import.meta.url).pathname],
        env: { ...process.env, PREMIERE_WS_PORT: '0' },
        stderr: 'ignore',
    }));
    try {
        const { tools } = await client.listTools();
        assert.equal(tools.length, toolTable.length);
        assert.ok(tools.some((t) => t.name === 'insert_clip'));
        const r = await client.callTool({ name: 'help', arguments: { tool: 'export_timeline' } });
        assert.match(r.content[0].text, /fcpxml/);
        assert.match(r.content[0].text, /26\.2/);
    } finally {
        await client.close();
    }
});

test('server.json meets the MCP Registry limits and matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const sj = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    assert.ok(sj.description.length <= 100, `${sj.description.length} characters`);
    assert.equal(sj.name, pkg.mcpName);
    assert.equal(sj.version, pkg.version);
    assert.equal(sj.packages[0].version, pkg.version);
    assert.equal(sj.packages[0].identifier, pkg.name);
});

test('the plugin manifest targets Premiere Pro 25.6 and can run the scripts it receives', () => {
    const manifest = JSON.parse(readFileSync(new URL('../uxp/plugin/manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.manifestVersion, 5);
    assert.equal(manifest.host.app, 'premierepro');
    assert.equal(manifest.host.minVersion, '25.6');
    assert.equal(manifest.requiredPermissions.allowCodeGenerationFromStrings, true);
    assert.ok(manifest.requiredPermissions.network);
    const panel = readFileSync(new URL('../uxp/plugin/index.js', import.meta.url), 'utf8');
    assert.match(panel, /bridgePanel/);
    assert.ok(manifest.entrypoints.some((e) => e.id === 'bridgePanel' && e.type === 'panel'));
    for (const code of ['4001', '4002', '4009']) assert.match(readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8'), new RegExp(code));
});
