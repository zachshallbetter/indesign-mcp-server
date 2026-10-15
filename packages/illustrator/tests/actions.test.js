/**
 * Actions, batch, script files, CSV data sources, tags and notes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScript } from 'adobe-mcp-core/testing';
import { readActions, describeActions, editActions, composeActions } from '../src/aia.js';
import { scriptsFor, server, home } from './helpers.js';
import { typings } from './audit.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/actions/', import.meta.url));
const SAMPLE = path.join(FIXTURES, 'sample.aia');
const sampleText = readFileSync(SAMPLE, 'utf8');

// A scratch folder the path policy allows, for files the tools write.
const scratch = mkdtempSync(path.join(os.tmpdir(), 'ai-actions-'));
process.env.ILLUSTRATOR_ALLOWED_DIRS = scratch;

/** The .aia text a load script writes, decoded from its string literal. */
const loadedText = (s) => JSON.parse(/__aia\.write\(("(?:[^"\\]|\\.)*")\);/.exec(s)[1]);

/** Run calls with a stub that answers each script with reply(script); returns { results, scripts }. */
async function withReplies(calls, reply) {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const scripts = [];
    const original = executor.runScript;
    executor.runScript = async (s) => {
        scripts.push(s);
        const r = reply(s);
        return JSON.stringify(r.error ? { ok: false, error: r.error } : { ok: true, result: JSON.stringify(r.value ?? {}) });
    };
    try {
        const results = [];
        for (const [name, args] of calls) results.push(await mcp.handleToolCall(name, args));
        for (const s of scripts) assert.deepEqual(checkScript(s, typings), []);
        return { results, scripts };
    } finally {
        executor.runScript = original;
    }
}

test('aia: reads sets, actions and steps with their flags', () => {
    const d = describeActions(readActions(sampleText));
    assert.equal(d.set, 'Fixture Set');
    assert.deepEqual(d.actions.map((a) => a.name), ['Outline', 'Rotate']);
    assert.deepEqual(d.actions[1].steps[0], { step: 1, name: 'Rotate', command: 'adobe_rotate', enabled: true, showDialog: false });
    assert.equal('showDialog' in d.actions[1].steps[1], false, 'a step without a dialog has no dialog setting');
    assert.throws(() => readActions('var x = 1;'), /Not an Action file/);
    assert.throws(() => readActions(sampleText.replace('/actionCount 2', '/actionCount 3')), /actionCount is 3 but there are 2/);
});

test('aia: edits rename, toggle, remove and renumber, keeping the rest', () => {
    const file = readActions(sampleText);
    const text = editActions(file, {
        setName: 'Renamed ✓',
        actions: [
            { name: 'Outline', remove: true },
            { name: 'Rotate', rename: 'Turn', steps: [{ step: 1, enabled: false, showDialog: true }, { step: 2, remove: true }] },
        ],
    });
    const d = describeActions(readActions(text));
    assert.equal(d.set, 'Renamed ✓');
    assert.deepEqual(d.actions, [{ name: 'Turn', steps: [{ step: 1, name: 'Rotate', command: 'adobe_rotate', enabled: false, showDialog: true }] }]);
    assert.match(text, /\/actionCount 1\n\/action-1 \{/);
    assert.match(text, /\/eventCount 1/);
    assert.throws(() => editActions(file, { actions: [{ name: 'Outline', steps: [{ step: 1, showDialog: true }] }] }), /has no dialog to show or skip/);
    assert.throws(() => editActions(file, { actions: [{ name: 'Outline', steps: [{ step: 1, remove: true }] }] }), /remove the action instead/);
    assert.throws(() => editActions(file, { actions: [{ name: 'Outline', remove: true }, { name: 'Rotate', remove: true }] }), /leave the set empty/);
    assert.throws(() => editActions(file, { actions: [{ name: 'Nope' }] }), /No action named "Nope".*Outline, Rotate/);
    assert.throws(() => editActions(file, { actions: [{ name: 'Rotate', steps: [{ step: 3, enabled: true }] }] }), /must be 1 to 2/);
});

test('aia: composes a new set from saved steps', () => {
    const file = readActions(sampleText);
    const { text, sources } = composeActions('Mine', [{ name: 'Both', steps: [{ file, filePath: SAMPLE, action: 'Outline' }, { file, filePath: SAMPLE, action: 'Rotate', step: 1 }] }]);
    const d = describeActions(readActions(text));
    assert.deepEqual(d, { set: 'Mine', actions: [{ name: 'Both', steps: [
        { step: 1, name: 'Outline Stroke', command: 'ai_plugin_outline', enabled: true },
        { step: 2, name: 'Rotate', command: 'adobe_rotate', enabled: true, showDialog: false },
    ] }] });
    assert.equal(sources[0].length, 2);
    assert.throws(() => composeActions('Mine', [{ name: 'X', steps: [{ file, filePath: SAMPLE, action: 'Rotate', step: 5 }] }]), /step 5 does not exist/);
});

test('list_actions reads the sets from preferences, or describes a file without a script', async () => {
    const [s] = await scriptsFor([['list_actions', {}]]);
    assert.match(s, /"plugin\/Action\/SavedSets\/set-" \+ i \+ "\/"/);
    assert.match(s, /getIntegerPreference\(base \+ "actionCount"\)/);
    const { results, scripts } = await withReplies([['list_actions', { filePath: SAMPLE }]], () => ({}));
    assert.equal(scripts.length, 0);
    assert.equal(results[0].result.set, 'Fixture Set');
});

test('play_action plays by name without dialogs, after selecting the targets', async () => {
    const [s] = await scriptsFor([['play_action', { action: 'Outline', set: 'Fixture Set', target: { ids: ['5'] } }]]);
    assert.match(s, /__targets\(doc, \{"ids":\["5"\]\}\)/);
    assert.match(s, /app\.doScript\("Outline", "Fixture Set", false\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('play_action', { action: '', set: 'x' }), /'action' is required/);
});

test('load_actions loads the edited file, replacing a set of the same name', async () => {
    const [same, all, none] = await scriptsFor([
        ['load_actions', { filePath: SAMPLE, setName: 'Mine', actions: [{ name: 'Rotate', steps: [{ step: 1, showDialog: true }] }] }],
        ['load_actions', { filePath: SAMPLE, replace: 'all' }],
        ['load_actions', { filePath: SAMPLE, replace: 'none' }],
    ]);
    const d = describeActions(readActions(loadedText(same)));
    assert.equal(d.set, 'Mine');
    assert.equal(d.actions[1].steps[0].showDialog, true);
    assert.match(same, /drop\.push\("Mine"\);[\s\S]*app\.unloadAction\(drop\[d\], ""\)[\s\S]*app\.loadAction\(__aia\);[\s\S]*__aia\.remove\(\)/);
    assert.match(all, /var sets = __actionSets\(\); for \(var s = 0; s < sets\.length; s\+\+\) drop\.push\(sets\[s\]\.name\);/);
    assert.doesNotMatch(none, /drop\.push/);
    assert.equal(loadedText(none), sampleText, 'an unedited file is loaded as it is');

    const saveAs = path.join(scratch, 'out', 'edited.aia');
    const { scripts, results } = await withReplies([['load_actions', { filePath: SAMPLE, actions: [{ name: 'Outline', rename: 'Outline all' }], saveAs, load: false }]], () => ({}));
    assert.equal(scripts.length, 0);
    assert.equal(results[0].result.savedAs, saveAs);
    assert.equal(describeActions(readActions(readFileSync(saveAs, 'utf8'))).actions[0].name, 'Outline all');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('load_actions', { filePath: `${home}/Documents/x.atn` }), /must end in \.aia/);
    await assert.rejects(mcp.handleToolCall('load_actions', { filePath: '/etc/x.aia' }), /Access denied/);
    await assert.rejects(mcp.handleToolCall('load_actions', { filePath: SAMPLE, load: false }), /Nothing to do/);
    await assert.rejects(mcp.handleToolCall('load_actions', { filePath: SAMPLE, replace: 'every' }), /Allowed: same_name, all, none/);
    await assert.rejects(mcp.handleToolCall('load_actions', { filePath: path.join(FIXTURES, 'data.csv') }), /must end in \.aia/);
});

test('create_action_set builds actions from saved steps and sets their flags', async () => {
    const [s] = await scriptsFor([['create_action_set', {
        name: 'Built',
        actions: [
            { name: 'Outline then turn', steps: [{ filePath: SAMPLE, action: 'Outline', enabled: false }, { filePath: SAMPLE, action: 'Rotate', step: 1, showDialog: true }] },
            { name: 'Turn', steps: [{ filePath: SAMPLE, action: 'Rotate' }] },
        ],
    }]]);
    const d = describeActions(readActions(loadedText(s)));
    assert.equal(d.set, 'Built');
    assert.deepEqual(d.actions[0].steps.map((x) => [x.command, x.enabled, x.showDialog]), [['ai_plugin_outline', false, undefined], ['adobe_rotate', true, true]]);
    assert.deepEqual(d.actions[1].steps.map((x) => x.command), ['adobe_rotate', 'ai_plugin_outline']);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_action_set', { name: 'X', actions: [] }), /at least one action/);
    await assert.rejects(mcp.handleToolCall('create_action_set', { name: 'X', actions: [{ name: 'A', steps: [{ filePath: SAMPLE, action: 'Missing' }] }] }), /No action named "Missing"/);
    await assert.rejects(mcp.handleToolCall('create_action_set', { name: 'X', actions: [{ name: 'A', steps: [{ filePath: SAMPLE, action: 'Outline', showDialog: true }] }] }), /no dialog to show or skip/);
    await assert.rejects(mcp.handleToolCall('create_action_set', { name: '', actions: [{ name: 'A', steps: [{ filePath: SAMPLE, action: 'Outline' }] }] }), /'name' is empty/);
});

test('unload_actions removes a set, named actions, or every listed set', async () => {
    const [set, actions, all] = await scriptsFor([
        ['unload_actions', { set: 'Fixture Set' }],
        ['unload_actions', { set: 'Fixture Set', actions: ['Outline'] }],
        ['unload_actions', { all: true }],
    ]);
    assert.match(set, /app\.unloadAction\("Fixture Set", ""\);/);
    assert.match(actions, /app\.unloadAction\("Fixture Set", names\[i\]\)/);
    assert.match(all, /app\.unloadAction\(sets\[i\]\.name, ""\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('unload_actions', { all: true, set: 'x' }), /not both/);
    await assert.rejects(mcp.handleToolCall('unload_actions', {}), /'set' is required/);
    await assert.rejects(mcp.handleToolCall('unload_actions', { set: 'x', actions: [] }), /at least one action name/);
});

test('run_batch opens each file, plays the action and saves to the destination', async () => {
    const batch = path.join(FIXTURES, 'batch');
    const [first, second, third] = await scriptsFor([['run_batch', { set: 'S', action: 'A', sourceFolder: batch, includeSubfolders: true, destination: 'save_and_close' }]]);
    assert.equal(third.includes('c.svg'), true, 'subfolders are included');
    assert.equal([first, second, third].some((s) => s.includes('notes.txt')), false);
    assert.match(first, /var d = app\.open\(f\), saved = null;\ntry \{\n {2}app\.doScript\("A", "S", false\);\n {2}d\.save\(\);/);
    assert.match(first, /d\.close\(SaveOptions\.DONOTSAVECHANGES\);/);
    assert.match(first, /Already open in Illustrator/);

    const out = path.join(scratch, 'batch-out');
    const [a, , c] = await scriptsFor([['run_batch', { set: 'S', action: 'A', sourceFolder: batch, includeSubfolders: true, destination: 'folder', destinationFolder: out }]]);
    assert.ok(a.includes(JSON.stringify(path.join(out, 'a.ai'))));
    assert.ok(c.includes(JSON.stringify(path.join(out, 'sub', 'c.ai'))), 'the folder structure is kept');
    assert.match(a, /d\.saveAs\(out, new IllustratorSaveOptions\(\)\)/);
    assert.ok(existsSync(path.join(out, 'sub')));

    const [open] = await scriptsFor([['run_batch', { set: 'S', action: 'A', sourceFolder: batch, fileTypes: ['ai'] }]]);
    assert.doesNotMatch(open, /d\.close/, 'destination none leaves the file open');

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_batch', { set: 'S', action: 'A', sourceFolder: batch, destination: 'folder' }), /needs destinationFolder/);
    await assert.rejects(mcp.handleToolCall('run_batch', { set: 'S', action: 'A', sourceFolder: batch, fileNaming: 'data_set' }), /applies to source: "data_sets"/);
    await assert.rejects(mcp.handleToolCall('run_batch', { set: 'S', action: 'A', sourceFolder: batch, includeSubfolders: true, maxFiles: 2 }), /3 files match/);
    await assert.rejects(mcp.handleToolCall('run_batch', { set: 'S', action: 'A', source: 'data_sets', destination: 'save_and_close' }), /none or folder/);
});

test('run_batch stops or carries on at errors, and names data set files the way Batch does', async () => {
    const batch = path.join(FIXTURES, 'batch');
    const failA = (s) => (s.includes('a.ai') ? { error: 'boom' } : { value: { file: 'x' } });
    const stop = await withReplies([['run_batch', { set: 'S', action: 'A', sourceFolder: batch }]], failA);
    assert.equal(stop.scripts.length, 1);
    assert.equal(stop.results[0].success, false);
    const go = await withReplies([['run_batch', { set: 'S', action: 'A', sourceFolder: batch, onError: 'continue' }]], failA);
    assert.equal(go.scripts.length, 2);
    assert.deepEqual(go.results[0].result.errors, [{ file: path.join(batch, 'a.ai'), error: 'boom' }]);

    const out = path.join(scratch, 'sets');
    const names = (s) => (s.includes('names.push') ? { value: { names: ['Spring', 'Sum/mer'], base: 'Poster' } } : { value: {} });
    for (const [naming, expect] of [['file_number', 'Poster002.ai'], ['file_data_set', 'Poster_Sum_mer.ai'], ['data_set', 'Sum_mer.ai']]) {
        const { scripts } = await withReplies([['run_batch', { set: 'S', action: 'A', source: 'data_sets', destination: 'folder', destinationFolder: out, fileNaming: naming }]], names);
        assert.equal(scripts.length, 3);
        assert.match(scripts[2], /doc\.dataSets\[1\]\.display\(\);\napp\.doScript\("A", "S", false\);/);
        assert.ok(scripts[2].includes(JSON.stringify(path.join(out, expect))), `${naming}: ${expect}`);
    }
});

test('run_script_file runs a script file from an allowed folder', async () => {
    const file = `${home}/Documents/Scripts/tidy.jsx`;
    const { scripts } = await withReplies([['run_script_file', { filePath: file }]], () => ({ value: 'done' }));
    assert.match(scripts[0], /var __mcpValue = \$\.evalFile\(__mcpFile\);/);
    assert.ok(scripts[0].includes(JSON.stringify(file)));
    assert.match(scripts[0], /\} finally \{\n {2}app\.userInteractionLevel = __mcpUI;/);
    assert.doesNotMatch(scripts[0], /coordinateSystem/, 'the script keeps the coordinate system it expects');
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_script_file', { filePath: `${home}/Documents/a.sh` }), /must end in \.jsx or \.js or \.jsxbin/);
    await assert.rejects(mcp.handleToolCall('run_script_file', { filePath: '/usr/local/a.jsx' }), /Access denied/);
});

test('import_csv_data turns each row into a data set record', async () => {
    const [s] = await scriptsFor([['import_csv_data', { filePath: path.join(FIXTURES, 'data.csv'), nameColumn: 'name' }]]);
    const records = JSON.parse(/var records = (\[.*?\]), made/.exec(s)[1]);
    assert.deepEqual(records.map((r) => r.name), ['Spring', 'Summer']);
    assert.deepEqual(records[0].values.map((v) => v.name), ['headline', 'photo', 'badge']);
    assert.equal(records[0].values[0].text, 'Spring sale, 20% off');
    assert.deepEqual(records[0].values[2], { name: 'badge', visible: true });
    assert.deepEqual(records[1].values.map((v) => v.name), ['headline', 'badge'], 'an empty image cell keeps the previous image');
    assert.deepEqual(records[1].values[1], { name: 'badge', visible: false });

    const { writeFileSync } = await import('node:fs');
    const bad = (name, text) => { const p = path.join(scratch, name); writeFileSync(p, text); return p; };
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('import_csv_data', { filePath: bad('g.csv', 'a,%chart\nx,y\n') }), /graph data is not supported/);
    await assert.rejects(mcp.handleToolCall('import_csv_data', { filePath: bad('v.csv', '#shown\nmaybe\n') }), /give true or false/);
    await assert.rejects(mcp.handleToolCall('import_csv_data', { filePath: bad('s.csv', 'two words\nx\n') }), /no spaces/);
    await assert.rejects(mcp.handleToolCall('import_csv_data', { filePath: bad('h.csv', 'only\n') }), /at least one row of data/);
    await assert.rejects(mcp.handleToolCall('import_csv_data', { filePath: path.join(FIXTURES, 'data.csv'), nameColumn: 'title' }), /No column named "title"/);
    const tabs = await scriptsFor([['import_csv_data', { filePath: bad('t.txt', 'headline\t#badge\r\n"Say ""hi"""\tTRUE\r\n') }]]);
    const tabRecords = JSON.parse(/var records = (\[.*?\]), made/.exec(tabs[0])[1]);
    assert.deepEqual(tabRecords[0], { name: 'Row 1', values: [{ name: 'headline', text: 'Say "hi"' }, { name: 'badge', visible: true }] });
});

test('item data: tags and notes are read and written through the object model', async () => {
    const [get, list, set] = await scriptsFor([
        ['get_item_data', { target: { selection: true } }],
        ['get_item_data', {}],
        ['set_item_data', { target: { ids: ['9'] }, tags: { sku: 'A-1', qty: 3, draft: null }, clearTags: true, note: 'Check bleed' }],
    ]);
    assert.match(get, /tags\[it\.tags\[t\]\.name\] = it\.tags\[t\]\.value;/);
    assert.match(list, /var all = doc\.pageItems/);
    assert.match(list, /if \(true && !n && !note\) continue;/, 'without a target only tagged or noted items are listed');
    assert.match(set, /if \(it\.tags\.length\) it\.tags\.removeAll\(\);/);
    assert.match(set, /tags = \[\{"name":"sku","value":"A-1"\},\{"name":"qty","value":"3"\},\{"name":"draft","value":null\}\]/);
    assert.match(set, /if \(!tag\) \{ tag = it\.tags\.add\(\); tag\.name = tags\[k\]\.name; \}\n {4}tag\.value = tags\[k\]\.value;/);
    assert.match(set, /it\.note = "Check bleed";/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_item_data', { target: { selection: true }, tags: { 'two words': 'x' } }), /use letters, digits and underscores/);
    await assert.rejects(mcp.handleToolCall('set_item_data', { target: { selection: true } }), /Nothing to set/);
    await assert.rejects(mcp.handleToolCall('set_item_data', { target: { selection: true }, tags: { a: { b: 1 } } }), /give text, or null/);
    await assert.rejects(mcp.handleToolCall('set_item_data', { tags: { a: 'b' } }), /Choose the items/);
});
