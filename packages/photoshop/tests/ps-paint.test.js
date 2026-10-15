/**
 * Painting and retouching tools: fills, gradients, stroking and filling
 * paths, the Paint Bucket and Magic Eraser, tool options, brush files, and
 * Patch and Content-Aware Move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('fill_contents maps each kind of contents to the fill event or the History fill', async () => {
    const [bg, gray, pattern, aware, history] = await scriptsFor([
        ['fill_contents', { contents: 'background', blendMode: 'multiply', opacity: 50, preserveTransparency: true }],
        ['fill_contents', { contents: 'gray' }],
        ['fill_contents', { contents: 'pattern', pattern: 'Bubbles' }],
        ['fill_contents', { contents: 'content_aware', rotationAdaptation: true, mirror: true }],
        ['fill_contents', { contents: 'history', historyIndex: 2, blendMode: 'screen' }],
    ]);
    assert.match(bg, /d\.putEnumerated\(sid\("using"\), sid\("fillContents"\), sid\("backgroundColor"\)\);/);
    assert.match(bg, /sid\("blendMode"\), sid\("multiply"\)\);/);
    assert.match(bg, /sid\("percentUnit"\), 50\);/);
    assert.match(bg, /d\.putBoolean\(sid\("preserveTransparency"\), true\);/);
    assert.match(bg, /app\.executeAction\(sid\("fill"\), d, DialogModes\.NO\);/);
    assert.match(gray, /sid\("fillContents"\), sid\("gray"\)\);/);
    assert.doesNotMatch(gray, /preserveTransparency"\)/);
    assert.match(pattern, /p\.putString\(sid\("name"\), "Bubbles"\);\nd\.putObject\(sid\("pattern"\), sid\("pattern"\), p\);/);
    assert.match(aware, /if \(!__hasSelection\(\)\) throw/);
    assert.match(aware, /contentAwareColorAdaptationFill"\), true\);/);
    assert.match(aware, /contentAwareRotateFill"\), true\);/);
    assert.match(aware, /contentAwareScaleFill"\), false\);/);
    assert.match(aware, /contentAwareMirrorFill"\), true\);/);
    assert.match(history, /doc\.selection\.fill\(doc\.historyStates\[__i\], ColorBlendMode\.SCREEN, 100, false\);/);
    assert.match(history, /var __i = 2;/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'pattern' }), /needs a pattern name/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'black', mirror: true }), /apply only to contents content_aware/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'content_aware', preserveTransparency: true }), /does not apply/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'white', historyIndex: 1 }), /only to contents history/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'white', opacity: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'white', blendMode: 'plaid' }), /Invalid value for 'blendMode'/);
    await assert.rejects(mcp.handleToolCall('fill_contents', { contents: 'history', historyIndex: -1 }), /Invalid index/);
});

test('draw_gradient builds a gradientClassEvent with stops, type and options', async () => {
    const [plain, custom] = await scriptsFor([
        ['draw_gradient', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }],
        ['draw_gradient', {
            from: { x: 50, y: 50 }, to: { x: 150, y: 200 }, type: 'diamond', reverse: true, dither: false, transparency: false,
            interpolation: 'classic', blendMode: 'overlay', opacity: 80,
            colors: [{ color: '#FF0000', location: 0 }, { color: 'foreground', location: 50, midpoint: 30 }, { color: 'cmyk(0,0,0,100)', location: 100 }],
            opacities: [{ opacity: 100, location: 0 }, { opacity: 0, location: 100 }],
        }],
    ]);
    assert.match(plain, /__colorStop\("foregroundColor", app\.foregroundColor, 0, 50\);\n__colorStop\("backgroundColor", app\.backgroundColor, 4096, 50\);/);
    assert.match(plain, /__opacityStop\(100, 0, 50\);\n__opacityStop\(100, 4096, 50\);/);
    assert.match(plain, /sid\("gradientType"\), sid\("linear"\)\);/);
    assert.match(plain, /d\.putBoolean\(sid\("dither"\), true\);\nd\.putBoolean\(sid\("useMask"\), true\);/);
    assert.doesNotMatch(plain, /sid\("reverse"\)/);
    assert.match(plain, /sid\("gradientInterpolationMethodType"\), sid\("perceptual"\)\);/);
    assert.match(plain, /d\.putObject\(cid\("Grad"\), cid\("Grdn"\), g\);\napp\.executeAction\(sid\("gradientClassEvent"\), d, DialogModes\.NO\);/);
    assert.match(custom, /__colorStop\("userStop", __color\(\{"kind":"rgb","v":\[255,0,0\]\}\), 0, 50\);/);
    assert.match(custom, /__colorStop\("foregroundColor", app\.foregroundColor, 2048, 30\);/);
    assert.match(custom, /__opacityStop\(0, 4096, 50\);/);
    assert.match(custom, /sid\("diamond"\)/);
    assert.match(custom, /d\.putBoolean\(sid\("reverse"\), true\);/);
    assert.match(custom, /d\.putBoolean\(sid\("useMask"\), false\);/);
    assert.match(custom, /sid\("classic"\)\);/);
    assert.match(custom, /__pt\(50, 50\)\);\nd\.putObject\(sid\("to"\), cid\("Pnt "\), __pt\(150, 200\)\);/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }), /different points/);
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 0, y: 0 } }), /'to' must be/);
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, type: 'conical' }), /Invalid value for 'type'/);
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, colors: [{ color: 'red', location: 0 }, { color: '#000000', location: 100 }] }), /not a colour/);
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, colors: [{ color: '#000000', location: 0 }] }), /at least two stops/);
    await assert.rejects(mcp.handleToolCall('draw_gradient', { from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, opacities: [{ opacity: 50, location: 0 }, { opacity: 50, location: 120 }] }), /out of range/);
});

test('stroke_path strokes a named or temporary path with the chosen tool and restores the tool', async () => {
    const [named, temp, clone] = await scriptsFor([
        ['stroke_path', { tool: 'dodge', path: 'Edge "A"', simulatePressure: true }],
        ['stroke_path', { tool: 'brush', points: [[0, 0], [100, 50]] }],
        ['stroke_path', { tool: 'healing_brush', points: [[0, 0], [100, 50], [20, 90]], closed: true, cloneSource: { x: 12, y: 34, layer: 'Photo' } }],
    ]);
    assert.match(named, /var __path = doc\.pathItems\.getByName\("Edge \\"A\\""\), __temp = false;/);
    assert.match(named, /app\.currentTool = "dodgeTool";/);
    assert.match(named, /d\.putClass\(sid\("using"\), sid\("dodgeTool"\)\);/);
    assert.match(named, /d\.putBoolean\(sid\("pressure"\), true\);\n {2}app\.executeAction\(sid\("stroke"\), d, DialogModes\.NO\);/);
    assert.match(named, /app\.currentTool = __prevTool;/);
    assert.match(named, /if \(__temp\) __path\.remove\(\); else __path\.deselect\(\);/);
    assert.match(temp, /var __pts = \[\[0,0\],\[100,50\]\]/);
    assert.match(temp, /__sub\.closed = false;/);
    assert.match(temp, /doc\.resizeImage\(undefined, undefined, 72, ResampleMethod\.NONE\);/);
    assert.match(temp, /doc\.resizeImage\(undefined, undefined, __res, ResampleMethod\.NONE\);/);
    assert.match(temp, /sid\("paintbrushTool"\)/);
    assert.doesNotMatch(temp, /ClnS/);
    assert.match(clone, /__sub\.closed = true;/);
    assert.match(clone, /csLayer\.putName\(cid\("Lyr "\), "Photo"\);/);
    assert.match(clone, /cid\("Pstn"\), cid\("Pnt "\), __pt\(12, 34\)\);/);
    assert.match(clone, /sid\("magicStampTool"\)/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'mixer_brush', path: 'P' }), /Invalid value for 'tool'/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'clone_stamp', path: 'P' }), /needs cloneSource/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'brush', path: 'P', cloneSource: { x: 1, y: 1 } }), /only to clone_stamp/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'brush', path: 'P', points: [[0, 0], [1, 1]] }), /not both/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'brush', points: [[0, 0]] }), /at least 2/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'brush', points: [[0, 0], [1, 'x']] }), /Invalid number/);
    await assert.rejects(mcp.handleToolCall('stroke_path', { tool: 'brush', path: 'P', closed: true }), /only to points/);
});

test('fill_path fills through PathItem.fillPath', async () => {
    const [named, temp] = await scriptsFor([
        ['fill_path', { path: 'Shape', color: 'gray(20)', blendMode: 'darken', opacity: 60, feather: 3, antiAlias: false }],
        ['fill_path', { points: [[0, 0], [10, 0], [5, 9]] }],
    ]);
    assert.match(named, /__path\.fillPath\(__color\(\{"kind":"gray","v":\[20\]\}\), ColorBlendMode\.DARKEN, 60, false, 3, false, true\);/);
    assert.match(temp, /__sub\.closed = true;/);
    assert.match(temp, /__path\.fillPath\(app\.foregroundColor, ColorBlendMode\.NORMAL, 100, false, 0, true, true\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('fill_path', { points: [[0, 0], [10, 0]] }), /at least 3/);
    await assert.rejects(mcp.handleToolCall('fill_path', {}), /Give path, or points/);
    await assert.rejects(mcp.handleToolCall('fill_path', { path: 'Shape', feather: 300 }), /out of range/);
});

test('fill_at_point selects similar colour at the point, then fills or clears, keeping any selection', async () => {
    const [bucket, eraser] = await scriptsFor([
        ['fill_at_point', { action: 'fill', x: 40, y: 60, tolerance: 10, contiguous: false, sampleAllLayers: true, color: '#00FF00', blendMode: 'multiply' }],
        ['fill_at_point', { action: 'erase', x: 1, y: 2, opacity: 50 }],
    ]);
    assert.match(bucket, /d\.putObject\(sid\("to"\), cid\("Pnt "\), __pt\(40, 60\)\);/);
    assert.match(bucket, /d\.putInteger\(sid\("tolerance"\), 10\);/);
    assert.match(bucket, /d\.putBoolean\(sid\("contiguous"\), false\);/);
    assert.match(bucket, /d\.putBoolean\(sid\("merged"\), true\);/);
    assert.match(bucket, /doc\.selection\.load\(__prior, SelectionType\.INTERSECT, false\);/);
    assert.match(bucket, /doc\.selection\.fill\(__color\(\{"kind":"rgb","v":\[0,255,0\]\}\), ColorBlendMode\.MULTIPLY, 100, false\);/);
    assert.match(eraser, /l\.isBackgroundLayer = false;/);
    assert.match(eraser, /ColorBlendMode\.CLEAR, 50, false\);/);
    assert.match(eraser, /d\.putInteger\(sid\("tolerance"\), 32\);/);
    assert.doesNotMatch(eraser, /contiguous|merged/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('fill_at_point', { action: 'erase', x: 0, y: 0, color: '#000000' }), /only to fill/);
    await assert.rejects(mcp.handleToolCall('fill_at_point', { action: 'fill', x: 0, y: 0, tolerance: 300 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('fill_at_point', { action: 'paint', x: 0, y: 0 }), /Invalid value for 'action'/);
});

test('set_tool_options selects the tool, preset, brush tip and tool options', async () => {
    const [all, cursors] = await scriptsFor([
        ['set_tool_options', { tool: 'eraser', preset: 'Soft Round', size: 45, hardness: 80, opacity: 70, flow: 30 }],
        ['set_tool_options', { paintingCursors: 'brush_size' }],
    ]);
    assert.match(all, /app\.currentTool = "eraserTool";/);
    assert.match(all, /pr\.putName\(sid\("brush"\), "Soft Round"\);/);
    assert.match(all, /app\.executeAction\(sid\("select"\), pd, DialogModes\.NO\);/);
    assert.match(all, /tip\.putUnitDouble\(sid\("masterDiameter"\), sid\("pixelsUnit"\), 45\);/);
    assert.match(all, /tip\.putUnitDouble\(sid\("hardness"\), sid\("percentUnit"\), 80\);/);
    assert.match(all, /o\.putInteger\(sid\("opacity"\), 70\);\no\.putInteger\(sid\("flow"\), 30\);/);
    assert.match(all, /sd\.putObject\(sid\("to"\), sid\("currentToolOptions"\), o\);/);
    assert.ok(all.indexOf('currentTool = "eraserTool"') < all.indexOf('masterDiameter'), 'the tool is chosen before its brush is set');
    assert.match(cursors, /app\.preferences\.paintingCursors = PaintingCursors\.BRUSHSIZE;/);
    assert.doesNotMatch(cursors, /masterDiameter"\), sid/);
    assert.doesNotMatch(cursors, /var doc = __doc\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_tool_options', {}), /Give tool, preset/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { opacity: 50.5 }), /whole percent/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { size: 0 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_tool_options', { tool: 'lasso' }), /Invalid value for 'tool'/);
});

test('manage_brushes imports and exports .abr files inside the allowed folders and defines presets', async () => {
    const [imp, exp, def] = await scriptsFor([
        ['manage_brushes', { action: 'import', filePath: `${home}/Documents/inks.abr` }],
        ['manage_brushes', { action: 'export', filePath: `${home}/Documents/out.ABR` }],
        ['manage_brushes', { action: 'define', name: 'Leaf' }],
    ]);
    assert.match(imp, /app\.applyToolBrushFromFile\(f\);/);
    assert.match(imp, /if \(!f\.exists\) throw/);
    assert.match(exp, /app\.saveToolBrushToFile\(f\);/);
    assert.match(def, /ref\.putClass\(sid\("brush"\)\);/);
    assert.match(def, /d\.putString\(sid\("name"\), "Leaf"\);/);
    assert.match(def, /app\.executeAction\(sid\("make"\), d, DialogModes\.NO\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_brushes', { action: 'import', filePath: `${home}/Documents/inks.tpl` }), /ending in \.abr/);
    await assert.rejects(mcp.handleToolCall('manage_brushes', { action: 'import', filePath: '/etc/inks.abr' }), /outside the allowed directories/);
    await assert.rejects(mcp.handleToolCall('manage_brushes', { action: 'define' }), /needs a name/);
    await assert.rejects(mcp.handleToolCall('manage_brushes', { action: 'export', filePath: `${home}/Documents/a.abr`, name: 'x' }), /only to define/);
});

test('retouch_selection plays patchSelection and recomposeSelection with their options', async () => {
    const [patch, normal, move] = await scriptsFor([
        ['retouch_selection', { method: 'patch', dx: 90, dy: -6, structure: 7, color: 2, sampleAllLayers: true, transparent: true }],
        ['retouch_selection', { method: 'patch', dx: 10, dy: 0, patchMode: 'normal', patchFrom: 'destination' }],
        ['retouch_selection', { method: 'content_aware_move', dx: -20, dy: 40, moveMode: 'extend' }],
    ]);
    assert.match(patch, /if \(!__hasSelection\(\)\) throw/);
    assert.match(patch, /off\.putUnitDouble\(sid\("horizontal"\), sid\("pixelsUnit"\), 90\);\noff\.putUnitDouble\(sid\("vertical"\), sid\("pixelsUnit"\), -6\);/);
    assert.match(patch, /d\.putObject\(sid\("from"\), sid\("offset"\), off\);/);
    assert.match(patch, /d\.putBoolean\(sid\("transparency"\), true\);/);
    assert.match(patch, /sid\("patchContentAware"\)/);
    assert.match(patch, /d\.putBoolean\(sid\("sampleAllLayers"\), true\);/);
    assert.match(patch, /d\.putInteger\(sid\("patchStructureAdapt"\), 7\);\nd\.putInteger\(sid\("patchColorAdaptation"\), 2\);/);
    assert.match(patch, /d\.putBoolean\(sid\("useSource"\), true\);\napp\.executeAction\(sid\("patchSelection"\), d, DialogModes\.NO\);/);
    assert.match(normal, /sid\("patchNormal"\)/);
    assert.match(normal, /d\.putBoolean\(sid\("useSource"\), false\);/);
    assert.match(move, /d\.putObject\(sid\("to"\), sid\("offset"\), off\);/);
    assert.match(move, /sid\("remixModeType"\), sid\("remixExtend"\)\);/);
    assert.match(move, /d\.putBoolean\(sid\("transformOnDrop"\), false\);/);
    assert.match(move, /d\.putInteger\(sid\("patchStructureAdapt"\), 4\);/);
    assert.match(move, /app\.executeAction\(sid\("recomposeSelection"\), d, DialogModes\.NO\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('retouch_selection', { method: 'patch', dx: 0, dy: 0 }), /cannot both be 0/);
    await assert.rejects(mcp.handleToolCall('retouch_selection', { method: 'patch', dx: 5, dy: 0, moveMode: 'extend' }), /do not apply to patch/);
    await assert.rejects(mcp.handleToolCall('retouch_selection', { method: 'content_aware_move', dx: 5, dy: 0, transparent: true }), /do not apply to content_aware_move/);
    await assert.rejects(mcp.handleToolCall('retouch_selection', { method: 'patch', dx: 5, dy: 0, structure: 8 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('retouch_selection', { method: 'patch', dx: 5, dy: 0, color: 2.5 }), /whole numbers/);
});
