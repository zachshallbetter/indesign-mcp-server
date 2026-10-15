/**
 * Image commands, selection commands, channels and transformations: the
 * scripts carry the right object-model and Action Manager statements, and bad
 * arguments are refused before anything runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server, home } from './helpers.js';

test('image size: noise reduction, and Scale Styles through the Image Size command', async () => {
    const [noise, styles] = await scriptsFor([
        ['resize_image', { width: 800, resample: 'preserve_details', reduceNoise: 30 }],
        ['resize_image', { scale: 50, scaleStyles: true, resample: 'bicubic_sharper' }],
    ]);
    assert.match(noise, /ResampleMethod\.PRESERVEDETAILS, 30\);/);
    assert.match(styles, /d\.putBoolean\(__s\("scaleStyles"\), true\);/);
    assert.match(styles, /__s\("interpolationType"\), __s\("bicubicSharper"\)/);
    assert.match(styles, /__do\(__s\("imageSize"\), d\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('resize_image', { width: 100, reduceNoise: 10 }), /preserve_details/);
    await assert.rejects(mcp.handleToolCall('resize_image', { width: 100, height: 50, scaleStyles: true }), /aspect ratio is kept/);
});

test('canvas extension colour runs Canvas Size with the anchor as locations', async () => {
    const [s] = await scriptsFor([['resize_canvas', { width: 100, relative: true, anchor: 'bottom_left', extensionColor: 'black' }]]);
    assert.match(s, /w = w \+ 100;/);
    assert.match(s, /__s\("horizontalLocation"\), __s\("left"\)/);
    assert.match(s, /__s\("verticalLocation"\), __s\("bottom"\)/);
    assert.match(s, /__s\("canvasExtensionColorType"\), __s\("black"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('resize_canvas', { width: 10, extensionColor: 'pink' }), /Invalid value for 'extensionColor'/);
});

test('mode conversion takes Indexed Color and Bitmap options', async () => {
    const [indexed, bitmap] = await scriptsFor([
        ['change_mode', { mode: 'indexed', indexed: { palette: 'exact', forced: 'web', matte: 'white', dither: 'diffusion', ditherAmount: 75 } }],
        ['change_mode', { mode: 'bitmap', bitmap: { method: 'halftone_screen', frequency: 85, angle: 45, shape: 'round', resolution: 600 } }],
    ]);
    assert.match(indexed, /var o = new IndexedConversionOptions\(\);\no\.palette = PaletteType\.EXACT;\no\.forced = ForcedColors\.WEB;\no\.matte = MatteType\.WHITE;\no\.dither = Dither\.DIFFUSION;\no\.ditherAmount = 75;/);
    assert.match(indexed, /doc\.changeMode\(ChangeMode\.INDEXEDCOLOR, o\);/);
    assert.match(bitmap, /o\.method = BitmapConversionType\.HALFTONESCREEN;/);
    assert.match(bitmap, /o\.shape = BitmapHalfToneType\.ROUND;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('change_mode', { mode: 'rgb', indexed: {} }), /need mode "indexed"/);
    await assert.rejects(mcp.handleToolCall('change_mode', { mode: 'bitmap', bitmap: { method: 'custom_pattern' } }), /patternName/);
});

test('colour table, pixel aspect ratio and histogram', async () => {
    const [table, par, hist] = await scriptsFor([
        ['set_color_table', { colors: ['#000000', '#FFFFFF', 'rgb(255,0,0)'] }],
        ['set_pixel_aspect_ratio', { ratio: 0.91, toggleCorrection: true }],
        ['get_histogram', { channel: 'Red' }],
    ]);
    assert.match(table, /r\.putProperty\(__c\("Clr "\), __c\("ClrT"\)\);/);
    assert.match(table, /list\.putObject\(__c\("RGBC"\), e\);/);
    assert.match(par, /doc\.pixelAspectRatio = 0\.91;/);
    assert.match(par, /app\.runMenuItem\(app\.stringIDToTypeID\("toggleProofVideo"\)\);/);
    assert.match(hist, /src = doc\.channels\.getByName\("Red"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_color_table', { colors: [] }), /1 to 256/);
    await assert.rejects(mcp.handleToolCall('set_pixel_aspect_ratio', {}), /Give ratio/);
});

test('measurements, the Measurement Log and count items', async () => {
    const [scale, record, exported, menu, count] = await scriptsFor([
        ['set_measurement_scale', { pixelLength: 100, logicalLength: 2, logicalUnits: 'mm' }],
        ['record_measurements', { source: 'count', dataPoints: ['Count'] }],
        ['manage_measurement_log', { action: 'export', range: 'selected', filePath: `${home}/Documents/m.txt` }],
        ['manage_measurement_log', { action: 'select_all' }],
        ['manage_count_items', { action: 'add', points: [[10, 20], [30, 40]] }],
    ]);
    assert.match(scale, /ms\.pixelLength = 100;\nms\.logicalLength = 2;\nms\.logicalUnits = "mm";/);
    assert.match(record, /doc\.recordMeasurements\(MeasurementSource\.MEASURECOUNTTOOL, \["Count"\]\);/);
    assert.match(exported, /app\.measurementLog\.exportMeasurements\(new File\(".*m\.txt"\), MeasurementRange\.ACTIVEMEASUREMENTS, undefined\);/);
    assert.match(menu, /stringIDToTypeID\("measurementLogSelectAll"\)/);
    assert.match(count, /doc\.countItems\.add\(\[new UnitValue\(pts\[n\]\[0\], "px"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('manage_measurement_log', { action: 'export', filePath: `${home}/Documents/m.exe` }), /\.txt or \.csv/);
    await assert.rejects(mcp.handleToolCall('manage_measurement_log', { action: 'export', filePath: '/etc/m.txt' }), /./);
    await assert.rejects(mcp.handleToolCall('manage_count_items', { action: 'remove' }), /needs index/);
    await assert.rejects(mcp.handleToolCall('set_measurement_scale', { reset: true, pixelLength: 3 }), /reset or new values/);
});

test('selection: rows, columns, tools, Color Range, Subject and Sky, Select and Mask, layer transparency', async () => {
    const [row, tool, sampled, tonal, subject, refine, pixels] = await scriptsFor([
        ['select_area', { shape: 'row', y: 12 }],
        ['activate_tool', { tool: 'perspective_crop' }],
        ['select_color_range', { color: '#FF0000', fuzziness: 60, invert: true }],
        ['select_color_range', { preset: 'midtones', fuzziness: 40, range: [105, 150] }],
        ['select_content', { what: 'subject', sampleAllLayers: true }],
        ['refine_selection', { radius: 3, feather: 1.5, shiftEdge: -10, output: 'new_layer_with_mask', decontaminate: true }],
        ['select_layer_pixels', { target: { ids: [4] }, combine: 'intersect' }],
    ]);
    assert.match(row, /var pts = \[\[0, y0\], \[w, y0\], \[w, y0 \+ 1\], \[0, y0 \+ 1\]\];\ndoc\.selection\.select\(pts,/);
    assert.match(tool, /app\.currentTool = "perspectiveCropTool";/);
    assert.match(sampled, /d\.putInteger\(__c\("Fzns"\), 60\);/);
    assert.match(sampled, /d\.putObject\(__c\("Mnm "\), __c\("LbCl"\), c\);/);
    assert.match(sampled, /d\.putBoolean\(__c\("Invr"\), true\);/);
    assert.match(tonal, /__c\("Clrs"\), __c\("Clrs"\), __c\("Mdtn"\)/);
    assert.match(tonal, /d\.putInteger\(__s\("midtonesLowerLimit"\), 105\);/);
    assert.match(subject, /d\.putBoolean\(__s\("sampleAllLayers"\), true\);\n__do\(__s\("autoCutout"\), d\);/);
    assert.match(refine, /__s\("smartBrushShiftEdge"\), __s\("percentUnit"\), -10\)/);
    assert.match(refine, /__s\("selectionOutputToNewLayerWithUserMask"\)/);
    assert.match(pixels, /__s\("transparencyEnum"\)/);
    assert.match(pixels, /__do\(__s\("interfaceIconFrameDimmed"\), d\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('select_area', { shape: 'column' }), /needs x/);
    await assert.rejects(mcp.handleToolCall('select_color_range', { color: '#FF0000', preset: 'reds' }), /Give color or preset/);
    await assert.rejects(mcp.handleToolCall('select_color_range', { preset: 'reds', fuzziness: 10 }), /no fuzziness/);
    await assert.rejects(mcp.handleToolCall('refine_selection', { decontaminate: true }), /new layer or document/);
    await assert.rejects(mcp.handleToolCall('activate_tool', { tool: 'brush' }), /Invalid value for 'tool'/);
});

test('align, distribute, auto-align and auto-blend select the layers and run their events', async () => {
    const [align, dist, toSel, autoAlign, blend] = await scriptsFor([
        ['align_layers', { target: { ids: [2, 3] }, edge: 'left' }],
        ['align_layers', { target: { ids: [2, 3, 4] }, edge: 'vertical_center', distribute: true }],
        ['align_layers', { target: { ids: [2] }, edge: 'top', toSelection: true }],
        ['auto_align_layers', { target: { ids: [2, 3] }, projection: 'perspective', removeVignette: true }],
        ['auto_blend_layers', { target: { ids: [2, 3] }, method: 'stack' }],
    ]);
    assert.match(align, /__selectLayers\(items\);/);
    assert.match(align, /__s\("alignDistributeSelector"\), __s\("ADSLefts"\)\);\n__do\(__s\("align"\), d\);/);
    assert.match(align, /There is a selection/);
    assert.match(dist, /__s\("ADSCentersV"\)\);\n__do\(__c\("Dstr"\), d\);/);
    assert.match(toSel, /Nothing is selected to align to/);
    assert.match(autoAlign, /__s\("ADSContent"\)/);
    assert.match(autoAlign, /__s\("projection"\), __c\("Prsp"\)/);
    assert.match(blend, /__s\("autoBlendType"\), __s\("maxDOF"\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('align_layers', { target: { ids: [2, 3] }, edge: 'middle' }), /Invalid value for 'edge'/);
    await assert.rejects(mcp.handleToolCall('align_layers', { target: { ids: [2, 3] }, edge: 'top', distribute: true, toSelection: true }), /drop toSelection/);
});

test('numeric transforms: skew, Transform Again, paths, duplicates, warp, Perspective Warp and Content-Aware Scale', async () => {
    const [skew, again, pathT, dup, warp, pwarp, cas] = await scriptsFor([
        ['apply_transform', { target: { ids: [2] }, skewX: 15, anchor: 'bottom_left' }],
        ['apply_transform', { target: { active: true }, again: true, duplicate: true }],
        ['apply_transform', { path: 'Path 1', scaleX: 50, scaleY: 50, angle: 90 }],
        ['transform_layers', { target: { ids: [2] }, angle: 30, duplicate: true }],
        ['warp_layers', { target: { ids: [2] }, style: 'flag', bend: -20, orientation: 'vertical' }],
        ['warp_perspective', { target: { ids: [2] }, from: [[10, 12], [200, 20], [190, 150], [5, 140]], to: [[0, 0], [200, 0], [200, 150], [0, 150]] }],
        ['scale_content_aware', { target: { ids: [2] }, scaleX: 70, amount: 80, protectSkinTones: true, protectChannel: 'Alpha 1' }],
    ]);
    assert.match(skew, /sk\.putUnitDouble\(__s\("horizontal"\), __s\("angleUnit"\), 15\);/);
    assert.match(skew, /d\.putObject\(__s\("skew"\), __c\("Pnt "\), sk\);/);
    assert.match(skew, /__qcs\("bottom_left"\)/);
    assert.match(again, /d\.putBoolean\(__s\("lastTransform"\), true\);/);
    assert.match(again, /src\[i\]\.duplicate\(src\[i\], ElementPlacement\.PLACEBEFORE\)/);
    assert.match(pathT, /ref\.putName\(__s\("path"\), "Path 1"\);/);
    assert.match(pathT, /__s\("width"\), __s\("percentUnit"\), 50\)/);
    assert.match(dup, /var l = items\[i\]\.duplicate\(items\[i\], ElementPlacement\.PLACEBEFORE\);/);
    assert.match(warp, /__s\("warpStyle"\), __s\("warpStyle"\), __s\("warpFlag"\)\);/);
    assert.match(warp, /w\.putDouble\(__s\("warpValue"\), -20\);/);
    assert.match(warp, /__s\("orientation"\), __s\("vertical"\)/);
    assert.match(pwarp, /var from = \[\[10,12\],\[200,20\],\[190,150\],\[5,140\]\]/);
    assert.match(pwarp, /box = \{"top":12,"left":5,"bottom":150,"right":200\}/);
    assert.match(pwarp, /__do\(__s\("perspectiveWarpTransform"\), d\);/);
    assert.match(cas, /d\.putBoolean\(__s\("contentAware"\), true\);/);
    assert.match(cas, /d\.putString\(__s\("channelName"\), "Alpha 1"\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_transform', { target: { ids: [2] }, again: true, angle: 5 }), /no values/);
    await assert.rejects(mcp.handleToolCall('apply_transform', { target: { ids: [2] }, path: 'P', dx: 1 }), /target \(layers\) or path/);
    await assert.rejects(mcp.handleToolCall('apply_transform', { target: { ids: [2] }, skewX: 90 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('warp_perspective', { target: { ids: [2] }, from: [[0, 0]], to: [[0, 0]] }), /four/);
    await assert.rejects(mcp.handleToolCall('scale_content_aware', { target: { ids: [2] } }), /Give scaleX/);
});

test('channels: create, options, manage, split, merge, Apply Image and Calculations', async () => {
    const [list, spot, opts, sel, del, merge, apply, calc] = await scriptsFor([
        ['list_channels', {}],
        ['create_channel', { name: 'PANTONE 185 C', kind: 'spot', color: '#E4002B', opacity: 0 }],
        ['set_channel', { channel: 'Alpha 1', kind: 'spot', color: '#00FF00' }],
        ['manage_channels', { action: 'select', channels: ['Red', 'Green'] }],
        ['manage_channels', { action: 'delete', channels: ['Alpha 1'] }],
        ['merge_channels', { documents: ['C', 'M', 'Y', 'K'], mode: 'cmyk' }],
        ['apply_image', { source: { document: 'Other.psd', layer: 'merged', channel: 'red', invert: true }, blendMode: 'soft_light', opacity: 50 }],
        ['calculate_channels', { source1: { channel: 'red' }, source2: { channel: 'Alpha 1', layer: 'Layer 1', invert: true }, blendMode: 'difference', name: 'Mask' }],
    ]);
    assert.match(list, /doc\.channels\.length/);
    assert.match(spot, /ch\.kind = ChannelType\.SPOTCOLOR;\nch\.name = "PANTONE 185 C";/);
    assert.match(opts, /if \(ch\.kind === ChannelType\.COMPONENT\) throw/);
    assert.match(sel, /doc\.activeChannels = list;/);
    assert.match(del, /ch\.remove\(\);/);
    assert.match(merge, /__s\("colorSpace"\), __c\("ECMY"\)/);
    assert.match(merge, /__do\(__s\("mergeChannels"\), d\);/);
    assert.match(apply, /__chanRef\(\{"document":"Other\.psd","layer":"merged","channel":"red"\}\)/);
    assert.match(apply, /__c\("Clcn"\), __s\("softLight"\)/);
    assert.match(apply, /calc\.putBoolean\(__c\("Invr"\), true\);/);
    assert.match(calc, /calc\.putBoolean\(__s\("invertSource2"\), true\);/);
    assert.match(calc, /d\.putClass\(__s\("new"\), __s\("channel"\)\);/);
    assert.match(calc, /ch\.name = "Mask";/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('create_channel', { kind: 'spot' }), /ink color/);
    await assert.rejects(mcp.handleToolCall('set_channel', { channel: 'Red' }), /at least one/);
    await assert.rejects(mcp.handleToolCall('merge_channels', { documents: ['A', 'B'], mode: 'rgb' }), /needs 3 documents/);
    await assert.rejects(mcp.handleToolCall('apply_image', { offset: 10 }), /add and subtract/);
    await assert.rejects(mcp.handleToolCall('calculate_channels', { source1: {}, source2: { channel: 'red' } }), /source1\.channel/);
    await assert.rejects(mcp.handleToolCall('manage_channels', { action: 'select', channels: ['Red'], name: 'x' }), /for duplicate/);
});
