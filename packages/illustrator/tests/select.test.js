import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolTable, toolDefinitions } from '../src/server.js';
import { OBJECT_KINDS, SELECTION_CHANGES, LOCK_COMMANDS, HIDE_COMMANDS } from '../src/tools/select.js';
import { scriptsFor, server } from './helpers.js';

const commands = new Set(JSON.parse(readFileSync(new URL('../src/data/menu-commands.json', import.meta.url), 'utf8')).commands.map((c) => c.id));
const sel = { selection: true };

test('selection tools use only known menu commands, none of them a dialog', () => {
    const byId = Object.fromEntries(JSON.parse(readFileSync(new URL('../src/data/menu-commands.json', import.meta.url), 'utf8')).commands.map((c) => [c.id, c]));
    for (const t of toolTable.filter((x) => x.area === 'select' || x.name === 'ungroup_items')) {
        for (const id of t.menuCommands ?? []) {
            assert.ok(commands.has(id), `${t.name}: unknown command ${id}`);
            assert.doesNotMatch(byId[id].menu.at(-1) ?? byId[id].name, /\.\.\.$|…$/, `${t.name}: ${id} opens a dialog`);
        }
    }
});

test('select_by_type runs each Select > Object command', async () => {
    const kinds = Object.keys(OBJECT_KINDS);
    const sent = await scriptsFor(kinds.map((kind) => ['select_by_type', ['same_layers', 'direction_handles'].includes(kind) ? { kind, target: sel } : { kind }]));
    kinds.forEach((kind, i) => {
        assert.ok(sent[i].includes(`app.executeMenuCommand("${OBJECT_KINDS[kind]}");`), kind);
        assert.equal(sent[i].includes('__select(doc, __targets('), ['same_layers', 'direction_handles'].includes(kind), kind);
    });
});

test('select_by_type asks for a target only where the command needs one', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_by_type', { kind: 'same_layers' }), /starts from a selection: give target/);
    await assert.rejects(mcp.handleToolCall('select_by_type', { kind: 'all_text', target: sel }), /leave out target/);
    await assert.rejects(mcp.handleToolCall('select_by_type', { kind: 'groups' }), /Allowed: all_text/);
});

test('change_selection runs the Select menu commands', async () => {
    const actions = Object.keys(SELECTION_CHANGES);
    const sent = await scriptsFor(actions.map((action) => ['change_selection', { action }]));
    actions.forEach((action, i) => assert.ok(sent[i].includes(`app.executeMenuCommand("${SELECTION_CHANGES[action]}");`), action));
    assert.match(sent[actions.indexOf('next_below')], /throw new Error\("Nothing is selected: give target to start from"\);\napp\.executeMenuCommand\("Selection Hat 9"\)/);
    assert.doesNotMatch(sent[actions.indexOf('inverse')], /Nothing is selected/);
    const [withTarget] = await scriptsFor([['change_selection', { action: 'inverse', target: { ids: ['42'] } }]]);
    assert.match(withTarget, /__select\(doc, __targets\(doc, \{"ids":\["42"\]\}\)\);\n\napp\.executeMenuCommand\("Inverse menu item"\)/);
    await assert.rejects((await server()).handleToolCall('change_selection', { action: 'all' }), /Allowed: reselect/);
});

test('select_nested_items walks groups through the object model', async () => {
    const sent = await scriptsFor(['children', 'all', 'parent'].map((level) => ['select_nested_items', { target: sel, level }]));
    assert.match(sent[0], /for \(var c = 0; c < it\.pageItems\.length; c\+\+\) picked\.push\(it\.pageItems\[c\]\);/);
    assert.match(sent[1], /leaves\(it\);/);
    assert.match(sent[2], /picked\.push\(it\.parent\);/);
    for (const s of sent) {
        assert.match(s, /picked\[j\]\.selected = true;/);
        assert.doesNotMatch(s, /executeMenuCommand/);
    }
    await assert.rejects((await server()).handleToolCall('select_nested_items', { target: sel, level: 'up' }), /Allowed: children, all, parent/);
    await assert.rejects((await server()).handleToolCall('select_nested_items', { level: 'all' }), /Choose the items/);
});

test('toggle_global_edit runs Start/Stop Global Edit', async () => {
    const [s] = await scriptsFor([['toggle_global_edit', {}]]);
    assert.match(s, /app\.executeMenuCommand\("SmartEdit Menu Item"\);/);
});

test('lock_items and hide_items set the property on the targets, or run the command for other artwork', async () => {
    const sent = await scriptsFor([
        ['lock_items', { target: sel }],
        ['lock_items', { target: sel, scope: 'above' }],
        ['lock_items', { target: sel, scope: 'others' }],
        ['hide_items', { target: sel, scope: 'selection' }],
        ['hide_items', { target: sel, scope: 'above' }],
        ['hide_items', { target: sel, scope: 'others' }],
    ]);
    assert.match(sent[0], /items\[i\]\.locked = true;/);
    assert.doesNotMatch(sent[0], /executeMenuCommand/);
    assert.match(sent[1], new RegExp(`app\\.executeMenuCommand\\("${LOCK_COMMANDS.above}"\\);`));
    assert.match(sent[2], /app\.executeMenuCommand\("lock2"\);/);
    assert.match(sent[3], /items\[i\]\.hidden = true;/);
    assert.match(sent[4], new RegExp(`app\\.executeMenuCommand\\("${HIDE_COMMANDS.above}"\\);`));
    assert.match(sent[5], /app\.executeMenuCommand\("hide2"\);/);
    for (const s of sent.slice(0, 3)) assert.match(s, /__snapshot\(doc, "locked", "locked"\)/);
    for (const s of sent.slice(3)) assert.match(s, /__snapshot\(doc, "hidden", "visible"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('lock_items', { target: sel, scope: 'below' }), /Allowed: selection, above, others/);
    await assert.rejects(mcp.handleToolCall('hide_items', {}), /Choose the items/);
});

test('unlock_all and show_all run the Object menu commands and report what changed', async () => {
    const [unlock, show] = await scriptsFor([['unlock_all', {}], ['show_all', {}]]);
    assert.match(unlock, /__snapshot\(doc, "locked", "locked"\);\napp\.executeMenuCommand\("unlockAll"\);\nvar done = __changes/);
    assert.match(show, /__snapshot\(doc, "hidden", "visible"\);\napp\.executeMenuCommand\("showAll"\);\nvar done = __changes/);
});

test('set_isolation_mode enters with one target and exits without one', async () => {
    const [enter, exit] = await scriptsFor([['set_isolation_mode', { mode: 'enter', target: { ids: ['7'] } }], ['set_isolation_mode', { mode: 'exit' }]]);
    assert.match(enter, /__select\(doc, items\);\napp\.executeMenuCommand\("enterFocus"\);/);
    assert.match(enter, /items\[0\]\.isIsolated/);
    assert.match(exit, /app\.executeMenuCommand\("exitFocus"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_isolation_mode', { mode: 'enter' }), /give target/);
    await assert.rejects(mcp.handleToolCall('set_isolation_mode', { mode: 'exit', target: sel }), /takes no target/);
});

test('select_similar_items compares stroke weight, opacity and blending mode', async () => {
    const [s, blendOnly] = await scriptsFor([
        ['select_similar_items', { target: sel, strokeWeightTolerance: 0.5, opacityTolerance: 10, blendingMode: true }],
        ['select_similar_items', { target: sel, blendingMode: true }],
    ]);
    assert.match(s, /var useWeight = true, useOpacity = true, useBlend = true;/);
    assert.match(s, /tolW = __len\(doc, 0\.5\), tolO = 10;/);
    assert.match(s, /Math\.abs\(p\.strokeWidth - refPaint\.strokeWidth\) > tolW/);
    assert.match(s, /Math\.abs\(c\.opacity - ref\.opacity\) > tolO/);
    assert.match(s, /c\.blendingMode !== ref\.blendingMode/);
    assert.match(blendOnly, /var useWeight = false, useOpacity = false, useBlend = true;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_similar_items', { target: sel }), /Give strokeWeightTolerance, opacityTolerance or blendingMode/);
    await assert.rejects(mcp.handleToolCall('select_similar_items', { target: sel, opacityTolerance: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('select_similar_items', { target: sel, strokeWeightTolerance: 'wide' }), /Invalid number/);
});

test('ungroup_items with allLevels runs Ungroup All after a version check', async () => {
    const [one, all] = await scriptsFor([['ungroup_items', { target: sel }], ['ungroup_items', { target: sel, allLevels: true }]]);
    assert.doesNotMatch(one, /executeMenuCommand/);
    assert.match(all, /Number\(v\[0\]\) === 29 && Number\(v\[1\]\) < 3/);
    assert.match(all, /app\.executeMenuCommand\("ungroup all"\);/);
});

test('selection tools carry their annotations', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['select_by_type', 'change_selection', 'lock_items', 'hide_items', 'unlock_all', 'show_all', 'set_isolation_mode', 'select_similar_items']) {
        assert.equal(byName[n].readOnlyHint, false, n);
        assert.equal(byName[n].destructiveHint, false, n);
    }
    assert.equal(byName.unlock_all.idempotentHint, true);
    assert.equal(byName.change_selection.idempotentHint, false);
});
