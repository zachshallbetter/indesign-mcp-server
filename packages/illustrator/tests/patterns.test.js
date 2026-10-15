import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';
import { toolDefinitions } from '../src/server.js';

const sel = { selection: true };

test('create_pattern runs Make, leaves pattern editing mode and names the new pattern', async () => {
    const [named, editing] = await scriptsFor([
        ['create_pattern', { target: sel, name: 'Dots "big"' }],
        ['create_pattern', { target: sel, keepEditing: true }],
    ]);
    assert.match(named, /app\.executeMenuCommand\("Adobe Make Pattern"\);[\s\S]*app\.executeMenuCommand\("exitFocus"\);[\s\S]*pat\.name = "Dots \\"big\\"";/);
    assert.match(named, /already exists/);
    assert.doesNotMatch(editing, /exitFocus/, 'keepEditing stays in pattern editing mode');
    assert.doesNotMatch(editing, /pat\.name =/);
});

test('apply_pattern finds the pattern swatch and paints fill, stroke or both', async () => {
    const [fill, stroke, both] = await scriptsFor([
        ['apply_pattern', { target: sel, pattern: 'Dots' }],
        ['apply_pattern', { target: sel, pattern: 'Dots', paint: 'stroke' }],
        ['apply_pattern', { target: sel, pattern: 'Dots', paint: 'both' }],
    ]);
    assert.match(fill, /pc = new PatternColor\(\); pc\.pattern = found\.pattern;/);
    assert.match(fill, /p\.fillColor = pc;/);
    assert.doesNotMatch(fill, /p\.strokeColor = pc/);
    assert.match(stroke, /p\.strokeColor = pc;/);
    assert.doesNotMatch(stroke, /p\.fillColor = pc/);
    assert.match(both, /p\.fillColor = pc;.*p\.strokeColor = pc;/);
});

test('rename_pattern and edit_pattern', async () => {
    const [rename, enter, exit] = await scriptsFor([
        ['rename_pattern', { pattern: 'New Pattern', newName: 'Waves' }],
        ['edit_pattern', { mode: 'enter', target: { ids: ['a'] } }],
        ['edit_pattern', { mode: 'exit' }],
    ]);
    assert.match(rename, /found\.pattern\.name = "Waves";/);
    assert.match(enter, /p\.fillColor\.typename === "PatternColor"[\s\S]*app\.executeMenuCommand\("Adobe Edit Pattern"\);/);
    assert.match(exit, /app\.executeMenuCommand\("exitFocus"\);/);
    assert.doesNotMatch(exit, /__targets\(doc, \{/);
});

test('transform_pattern moves only the pattern, in order', async () => {
    const [s, strokeOnly] = await scriptsFor([
        ['transform_pattern', { target: sel, reflect: 'vertical', scale: 50, angle: 30, shear: 10, dx: 5, dy: 8, origin: 'topLeft' }],
        ['transform_pattern', { target: sel, paint: 'stroke', scaleX: 200 }],
    ]);
    const reflect = s.indexOf('it.resize(100, -100, false, true, false, false, 100, Transformation.TOPLEFT);');
    const scale = s.indexOf('it.resize(50, 50, false, true, false, false, 100, Transformation.TOPLEFT);');
    const rotate = s.indexOf('it.rotate(30, false, true, false, false, Transformation.TOPLEFT);');
    const shear = s.indexOf('m.mValueC = Math.tan(10 * Math.PI / 180); it.transform(m, false, true, false, false, 100, Transformation.TOPLEFT);');
    const move = s.indexOf('it.translate(__len(doc, 5), -__len(doc, 8), false, true, false, false);');
    for (const i of [reflect, scale, rotate, shear, move]) assert.ok(i > 0);
    assert.ok(reflect < scale && scale < rotate && rotate < shear && shear < move, 'reflect, scale, rotate, shear, move');
    assert.match(strokeOnly, /it\.resize\(200, 100, false, false, false, true, 100, Transformation\.CENTER\);/);
});

test('make_repeat runs the Repeat command and sets options through the configuration', async () => {
    const [radial, grid, mirror, plain] = await scriptsFor([
        ['make_repeat', { target: sel, kind: 'radial', instances: 12, radius: 80, reverseOverlap: true }],
        ['make_repeat', { target: sel, kind: 'grid', horizontalSpacing: 10, verticalSpacing: -5, gridType: 'brick_by_column', flipRows: 'vertical', flipColumns: 'both' }],
        ['make_repeat', { target: sel, kind: 'mirror', axisAngle: 90 }],
        ['make_repeat', { target: sel, kind: 'grid' }],
    ]);
    assert.match(radial, /app\.executeMenuCommand\("Make Radial Repeat"\);/);
    assert.match(radial, /c\.numberOfInstances = 12; it\.setRadialConfiguration\(c, RadialRepeatUpdate\.NUMBEROFINSTANCES\);/);
    assert.match(radial, /c\.radius = __len\(doc, 80\); it\.setRadialConfiguration\(c, RadialRepeatUpdate\.RADIUSOFART\);/);
    assert.match(radial, /c\.reverseOverlap = true; it\.setRadialConfiguration\(c, RadialRepeatUpdate\.REVERSEOVERLAP\);/);
    assert.match(grid, /app\.executeMenuCommand\("Make Grid Repeat"\);/);
    assert.match(grid, /c\.horizontalSpacing = __len\(doc, 10\); it\.setGridConfiguration\(c, GridRepeatUpdate\.HORIZONTALSPACING\);/);
    assert.match(grid, /c\.verticalSpacing = __len\(doc, -5\); it\.setGridConfiguration\(c, GridRepeatUpdate\.VERTICALSPACING\);/);
    assert.match(grid, /c\.patternType = RepeatGridShiftFlipType\.VERTICALSF; c\.rowFlipType = RepeatGridShiftFlipType\.VERTICALSF; c\.columnFlipType = RepeatGridShiftFlipType\.HORIZONTALANDVERTICALSF; it\.setGridConfiguration\(c, GridRepeatUpdate\.GRIDALL\);/);
    assert.match(mirror, /app\.executeMenuCommand\("Make Symmetry Repeat"\);[\s\S]*doc\.symmetryRepeatItems\[0\]/);
    assert.match(mirror, /c\.axisRotationAngleInRadians = 90 \* Math\.PI \/ 180; it\.setSymmetryConfiguration\(c, SymmetryRepeatUpdate\.AXISROTATION\);/);
    assert.doesNotMatch(plain, /setGridConfiguration\(/);
    for (const s of [radial, grid, mirror, plain]) assert.doesNotMatch(s, /Repeat Art Options/, 'the Options dialog is never opened');
});

test('set_repeat_options checks the repeat kind; release_repeat runs Release', async () => {
    const [set, read, release] = await scriptsFor([
        ['set_repeat_options', { target: sel, instances: 6 }],
        ['set_repeat_options', { target: sel }],
        ['release_repeat', { target: sel }],
    ]);
    assert.match(set, /if \(items\[i\]\.typename !== "RadialRepeatItem"\) throw/);
    assert.match(set, /RadialRepeatUpdate\.NUMBEROFINSTANCES/);
    assert.doesNotMatch(read, /set(Radial|Grid|Symmetry)Configuration\(/);
    assert.match(release, /app\.executeMenuCommand\("Release Repeat Art"\);/);
});

test('pattern and repeat arguments are refused before anything runs', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_pattern', { target: {} }), /Choose the items/);
    await assert.rejects(mcp.handleToolCall('create_pattern', { target: sel, name: '  ' }), /cannot be empty/);
    await assert.rejects(mcp.handleToolCall('apply_pattern', { target: sel, pattern: '' }), /Give 'pattern'/);
    await assert.rejects(mcp.handleToolCall('apply_pattern', { target: sel, pattern: 'Dots', paint: 'outline' }), /Allowed: fill, stroke, both/);
    await assert.rejects(mcp.handleToolCall('rename_pattern', { pattern: 'Dots', newName: '' }), /non-empty 'newName'/);
    await assert.rejects(mcp.handleToolCall('edit_pattern', { mode: 'enter' }), /needs 'target'/);
    await assert.rejects(mcp.handleToolCall('edit_pattern', { mode: 'open' }), /Allowed: enter, exit/);
    await assert.rejects(mcp.handleToolCall('transform_pattern', { target: sel }), /at least one of/);
    await assert.rejects(mcp.handleToolCall('transform_pattern', { target: sel, scale: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('transform_pattern', { target: sel, shear: 90 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('transform_pattern', { target: sel, reflect: 'diagonal' }), /Allowed: horizontal, vertical/);
    await assert.rejects(mcp.handleToolCall('make_repeat', { target: sel, kind: 'spiral' }), /Allowed: radial, grid, mirror/);
    await assert.rejects(mcp.handleToolCall('make_repeat', { target: sel, kind: 'grid', instances: 6 }), /radial repeat options; a grid repeat takes/);
    await assert.rejects(mcp.handleToolCall('make_repeat', { target: sel, kind: 'radial', instances: 0 }), /at least 1/);
    await assert.rejects(mcp.handleToolCall('make_repeat', { target: sel, kind: 'grid', gridType: 'hex' }), /Allowed: grid, brick_by_row, brick_by_column/);
    await assert.rejects(mcp.handleToolCall('set_repeat_options', { target: sel, instances: 6, axisAngle: 45 }), /cannot be mixed/);
    await assert.rejects(mcp.handleToolCall('set_repeat_options', { target: sel, axisAngle: 400 }), /out of range/);
});

test('pattern and repeat tools carry their annotations', () => {
    const by = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    assert.equal(by.release_repeat.destructiveHint, true);
    assert.equal(by.apply_pattern.idempotentHint, true);
    for (const n of ['create_pattern', 'make_repeat', 'transform_pattern']) assert.equal(by[n].readOnlyHint, false, n);
});
