import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('brushes are listed, applied by name, imported from a library and saved as one', async () => {
    const [list, apply, expand, imp, all, save, open] = await scriptsFor([
        ['list_brushes', {}],
        ['apply_brush', { target: { ids: ['1'] }, brush: 'Charcoal - Feather' }],
        ['apply_brush', { target: { selection: true }, brush: 'Arrow 1', expand: true }],
        ['import_brushes', { filePath: `${home}/Brushes/Arrows.ai`, names: ['Arrow 1', 'Arrow 2'] }],
        ['import_brushes', { filePath: `${home}/Brushes/Arrows.ai` }],
        ['save_brush_library', { filePath: `${home}/Brushes/Mine.ai` }],
        ['open_brush_library', { library: 'Borders_Dashed' }],
    ]);
    assert.match(list, /doc\.brushes\[i\]\.name/);
    assert.match(apply, /var b = doc\.brushes\.getByName\("Charcoal - Feather"\);/);
    assert.match(apply, /__eachPath\(items\[i\], function \(p\) \{ b\.applyTo\(p\);/);
    assert.doesNotMatch(apply, /executeMenuCommand/);
    assert.match(expand, /app\.executeMenuCommand\("expandStyle"\);/);
    assert.match(imp, /var lib = app\.open\(f\);/);
    assert.match(imp, /var want = \["Arrow 1","Arrow 2"\]/);
    assert.match(imp, /lib\.brushes\.getByName\(want\[n\]\)\.applyTo\(carrier\);/);
    assert.match(imp, /carrier\.duplicate\(doc\.activeLayer, ElementPlacement\.PLACEATEND\)/);
    assert.match(imp, /if \(!wasOpen\) lib\.close\(SaveOptions\.DONOTSAVECHANGES\);/);
    assert.match(all, /var want = null/);
    assert.match(save, /doc\.writeAsLibrary\(f, LibraryType\.BRUSHES\);/);
    assert.match(open, /app\.executeMenuCommand\("_Brush Library Menu Item 12"\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_brush', { target: { selection: true } }), /Give brush/);
    await assert.rejects(mcp.handleToolCall('import_brushes', { filePath: `${home}/Brushes/Arrows.abr` }), /must end in \.ai/);
    await assert.rejects(mcp.handleToolCall('import_brushes', { filePath: `${home}/Brushes/Arrows.ai`, names: [] }), /list of brush names/);
    await assert.rejects(mcp.handleToolCall('save_brush_library', { filePath: '/etc/brushes.ai' }), /outside the allowed directories/);
    await assert.rejects(mcp.handleToolCall('open_brush_library', { library: 'Other Library' }), /Allowed: Arrows_Special/);
});

test('the perspective grid is set up through presets, planes and the View menu toggles', async () => {
    const [grid, hide, attach, place, release, imp, exp] = await scriptsFor([
        ['set_perspective_grid', { preset: 'two_point', visible: true, activePlane: 'right', toggle: ['snap', 'lock_grid'] }],
        ['set_perspective_grid', { visible: false, matchItem: { ids: ['4'] } }],
        ['attach_to_perspective', { target: { ids: ['1'] }, plane: 'floor' }],
        ['attach_to_perspective', { target: { ids: ['1'] }, plane: 'left', x: -100, y: 50 }],
        ['release_perspective', { target: { selection: true } }],
        ['import_perspective_presets', { filePath: `${home}/PGPresets`, preset: 'Street', select: true }],
        ['export_perspective_presets', { filePath: `${home}/PGPresetsExported` }],
    ]);
    assert.match(grid, /doc\.selectPerspectivePreset\("\[2P-Normal View\]"\)/);
    assert.match(grid, /doc\.showPerspectiveGrid\(\);/);
    assert.match(grid, /var toggles = \["Snap to Grid","Lock Perspective Grid"\];/);
    assert.match(grid, /doc\.setPerspectiveActivePlane\(PerspectiveGridPlaneType\.RIGHTPLANE\)/);
    assert.match(hide, /doc\.hidePerspectiveGrid\(\);/);
    assert.match(hide, /app\.executeMenuCommand\("Show Object Grid Plane"\);/);
    assert.doesNotMatch(hide, /selectPerspectivePreset/);
    assert.match(attach, /app\.executeMenuCommand\("Attach to Active Plane"\);/);
    assert.match(attach, /PerspectiveGridPlaneType\.FLOORPLANE/);
    assert.match(place, /items\[i\]\.bringInPerspective\(-100, 50, plane\);/);
    assert.doesNotMatch(place, /executeMenuCommand/);
    assert.match(release, /app\.executeMenuCommand\("Release with Perspective"\);/);
    assert.match(imp, /doc\.importPerspectiveGridPreset\(f, "Street"\);/);
    assert.match(imp, /doc\.selectPerspectivePreset\("Street"\)/);
    assert.match(exp, /doc\.exportPerspectiveGridPreset\(f\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_perspective_grid', {}), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_perspective_grid', { activePlane: 'top' }), /Allowed: left, right, floor/);
    await assert.rejects(mcp.handleToolCall('set_perspective_grid', { toggle: ['grid'] }), /Allowed: rulers/);
    await assert.rejects(mcp.handleToolCall('attach_to_perspective', { target: { selection: true }, x: 10 }), /x and y together/);
    await assert.rejects(mcp.handleToolCall('import_perspective_presets', { filePath: `${home}/PGPresets`, select: true }), /select needs preset/);
});

test('3D effects: the current effect keeps its defaults, the classic one takes rotation', async () => {
    const { classicMatrix } = await import('../src/tools/three_d.js');
    // Illustrator 28 writes this matrix for the classic default rotation (-18, -26, 8).
    const stored = [0.890047044, 0.125087955, 0.438371147, 0, 0.001784322, 0.960653863, -0.277742635, 0, -0.455865194, 0.247986206, 0.854803935, 0, 0, 0, 0, 1];
    classicMatrix(-18, -26, 8).forEach((v, i) => assert.ok(Math.abs(v - stored[i]) < 1e-6, `mat ${i}: ${v}`));

    const [extrude, revolve, inflate, text, classic] = await scriptsFor([
        ['apply_3d_effect', { target: { ids: ['1'] }, type: 'extrude', depth: 30, cap: false }],
        ['apply_3d_effect', { target: { ids: ['1'] }, type: 'revolve', revolveAngle: 180, wireframe: true }],
        ['apply_3d_effect', { target: { ids: ['1'] }, type: 'inflate', bothSides: true, expand: true }],
        ['apply_3d_effect', { target: { names: ['Title'] }, type: 'rotate' }],
        ['apply_3d_effect', { target: { ids: ['1'] }, type: 'revolve', classic: true, rotation: { x: 0, y: 0, z: 0 }, perspective: 40, surface: 'diffuse' }],
    ]);
    assert.match(extrude, /<LiveEffect name="Adobe Geometry3D">/);
    assert.match(extrude, /"I Geometry3DkOperationTypeKey " \+ "0"/);
    assert.match(extrude, /"R Geometry3DkExtrudeDepthKey " \+ \(30 \/ __sf\(doc\)\)/);
    assert.match(extrude, /"B Geometry3DkExtrudeCapKey " \+ "0"/);
    assert.match(extrude, /target\.applyEffect\(xml\);/);
    assert.match(revolve, /"I Geometry3DkOperationTypeKey " \+ "3"/);
    assert.match(revolve, /"R Geometry3DkRevolveAngleKey " \+ "180"/);
    assert.match(revolve, /"B Geometry3DkRenderAsWireframe " \+ "1"/);
    assert.doesNotMatch(revolve, /ExtrudeDepthKey/);
    assert.match(inflate, /"I Geometry3DkOperationTypeKey " \+ "2"/);
    assert.match(inflate, /"B Geometry3DkInflateBothSidesKey " \+ "1"/);
    assert.match(inflate, /app\.executeMenuCommand\("expandStyle"\);/);
    assert.match(text, /"I Geometry3DkOperationTypeKey " \+ "4"/);
    assert.match(classic, /<LiveEffect name="Adobe 3D Effect">/);
    assert.match(classic, /"I effectStyle " \+ "1"/);
    assert.match(classic, /"R mat_00 " \+ "1".*"R mat_11 " \+ "1"/);
    assert.match(classic, /"R cameraPerspective " \+ "40"/);
    assert.match(classic, /"I surfaceStyle " \+ "2"/);
    assert.match(classic, /<Entry name="light0" valueType="D">/);

    const mcp = await server();
    const t = { target: { selection: true } };
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'bevel' }), /Allowed: extrude, revolve, inflate, rotate/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'inflate', classic: true }), /no classic version/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'extrude', rotation: { x: 10 } }), /rotation needs classic: true/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'extrude', classic: true, wireframe: true }), /surface: "wireframe"/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'revolve', depth: 10 }), /depth applies to extrude and inflate/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'extrude', depth: 5000 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('apply_3d_effect', { ...t, type: 'rotate', classic: true, rotation: { x: 500 } }), /out of range/);
});

test('select_tool reaches the brush and perspective tools', async () => {
    const [persp, blob] = await scriptsFor([
        ['select_tool', { tool: 'Perspective Selection Tool' }],
        ['select_tool', { tool: 'blob brush' }],
    ]);
    assert.match(persp, /app\.selectTool\("Perspective Selection Tool"\);/);
    assert.match(blob, /app\.selectTool\("Adobe Blob Brush Tool"\);/);
});
