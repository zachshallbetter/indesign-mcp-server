import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolTable, toolDefinitions, annotations, SERVER_INSTRUCTIONS } from '../src/server.js';
import { colorSpec, targetSpec } from '../src/args.js';
import { script } from '../src/script.js';
import { checkScript } from 'adobe-mcp-core/testing';
import { wrapScriptForStructuredResult } from 'adobe-mcp-core';
import { audit, typings } from './audit.js';
import { scriptsFor, home } from './helpers.js';

const featureIds = new Set(JSON.parse(readFileSync(new URL('./fixtures/feature-ids.json', import.meta.url), 'utf8')).ids);

test('every tool is well-formed', () => {
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
});

test('every tool claims atlas features that exist', () => {
    for (const t of toolTable) {
        if (t.name === 'help') continue;
        assert.ok(t.features?.length, `${t.name} claims no feature`);
        for (const f of t.features) assert.ok(featureIds.has(f), `${t.name}: unknown feature ${f}`);
    }
});

test('destructive tools are annotated as such', () => {
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['close_document', 'delete_items', 'delete_layer', 'delete_artboard', 'execute_illustrator_code', 'convert_text_to_outlines']) {
        assert.equal(byName[n].destructiveHint, true, n);
        assert.equal(byName[n].readOnlyHint, false, n);
    }
    for (const n of ['list_items', 'get_document_info', 'list_fonts']) assert.equal(byName[n].readOnlyHint, true, n);
});

test('colours parse the way designers write them', () => {
    assert.deepEqual(JSON.parse(colorSpec('#FF6600')), { kind: 'rgb', v: [255, 102, 0] });
    assert.deepEqual(JSON.parse(colorSpec('cmyk(0, 60, 100, 0)')), { kind: 'cmyk', v: [0, 60, 100, 0] });
    assert.deepEqual(JSON.parse(colorSpec('rgb(1,2,3)')), { kind: 'rgb', v: [1, 2, 3] });
    assert.deepEqual(JSON.parse(colorSpec('gray(40)')), { kind: 'gray', v: [40] });
    assert.deepEqual(JSON.parse(colorSpec('none')), { kind: 'none' });
    assert.deepEqual(JSON.parse(colorSpec('PANTONE 185 C')), { kind: 'swatch', name: 'PANTONE 185 C' });
    assert.throws(() => colorSpec('cmyk(0,60,100)'), /takes 4 value/);
    assert.throws(() => colorSpec('rgb(300,0,0)'), /out of range/);
    assert.equal(colorSpec(undefined), null);
});

test('a swatch name cannot break out of its string', () => {
    const spec = colorSpec('x"}); app.quit(); ({"');
    assert.equal(JSON.parse(spec).name, 'x"}); app.quit(); ({"');
});

test('targets must name something', () => {
    assert.deepEqual(JSON.parse(targetSpec({ ids: ['a'], selection: true })), { ids: ['a'], selection: true });
    assert.throws(() => targetSpec({}), /Choose the items/);
    assert.throws(() => targetSpec(undefined), /Choose the items/);
});

test('the prelude restores the user\'s settings and parses as ES5', () => {
    const s = script('__result__ = 1;');
    assert.match(s, /app\.userInteractionLevel = UserInteractionLevel\.DONTDISPLAYALERTS/);
    assert.match(s, /\} finally \{\n {2}app\.coordinateSystem = __prevCS;\n {2}app\.userInteractionLevel = __prevUI;/);
    assert.deepEqual(checkScript(wrapScriptForStructuredResult(s), typings), []);
});

test('the static script audit finds nothing', async () => {
    const report = await audit();
    assert.deepEqual(report.problems, []);
    assert.equal(report.tools, toolDefinitions.length);
});

test('an MCP client can list tools and call the ones that need no Illustrator', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.js', import.meta.url).pathname] }));
    try {
        assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
        const { tools } = await client.listTools();
        assert.equal(tools.length, toolDefinitions.length);

        const help = await client.callTool({ name: 'help', arguments: { tool: 'create_rectangle' } });
        assert.equal(help.isError, false);
        assert.ok(JSON.parse(help.content[0].text).result.parameters.cornerRadius);

        const found = await client.callTool({ name: 'find_menu_commands', arguments: { query: 'outlines' } });
        assert.ok(JSON.parse(found.content[0].text).result.commands.some((c) => c.command === 'outline'));

        const unknown = await client.callTool({ name: 'execute_menu_command', arguments: { command: 'notACommand' } });
        assert.equal(unknown.isError, true);
        assert.match(unknown.content[0].text, /would ignore it silently/);

        const bad = await client.callTool({ name: 'create_rectangle', arguments: { x: 'ten', y: 0, width: 10, height: 10 } });
        assert.equal(bad.isError, true);
        assert.match(bad.content[0].text, /Invalid number for 'x'/);

        const warned = await client.callTool({ name: 'help', arguments: { tol: 'x' } });
        assert.match(warned.content[0].text, /did you mean 'tool'/);
    } finally {
        await client.close();
    }
});

test('server.json meets the MCP Registry limits and matches package.json', () => {
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(server.description.length <= 100, `description is ${server.description.length} characters; the registry allows 100`);
    assert.equal(server.name, pkg.mcpName);
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0].identifier, pkg.name);
    assert.equal(server.packages[0].version, pkg.version);
});

test('every Live Effect and both Pathfinder methods generate valid scripts', async () => {
    const { EFFECTS, PATHFINDER_COMMANDS } = await import('../src/effects.js');
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        const required = {
            offset_path: { offset: 3 }, round_corners: { radius: 4 }, gaussian_blur: { radius: 2 }, feather: { radius: 6 },
            convert_to_shape: { shape: 'ellipse' }, free_distort: { corners: { topRight: [1.2, -0.1] } }, pucker_bloat: { amount: -30 },
            twist: { angle: 45 }, warp: { style: 'flag' },
        };
        for (const effect of Object.keys(EFFECTS)) {
            for (const expand of [false, true]) {
                const r = await mcp.handleToolCall('apply_effect', { target: { selection: true }, effect, options: required[effect] ?? {}, expand });
                assert.equal(r.success, true, `${effect}: ${JSON.stringify(r)}`);
            }
        }
        for (const operation of Object.keys(PATHFINDER_COMMANDS)) {
            for (const method of ['effect', 'menu']) {
                const r = await mcp.handleToolCall('pathfinder', { target: { selection: true }, operation, method, removeUnpainted: true });
                assert.equal(r.success, true, `${operation} ${method}`);
            }
        }
    } finally {
        executor.runScript = original;
    }
    assert.equal(sent.length, Object.keys(EFFECTS).length * 2 + Object.keys(PATHFINDER_COMMANDS).length * 2);
    for (const s of sent) assert.deepEqual(checkScript(s, typings), []);
});

test('effect options are checked before anything runs', async () => {
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'offset_path', options: {} }), /needs options\.offset/);
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'round_corners', options: { radius: 2, size: 3 } }), /has no option size/);
    await assert.rejects(mcp.handleToolCall('apply_effect', { target: { selection: true }, effect: 'offset_path', options: { offset: 2, joins: 'square' } }), /Allowed: round, bevel, miter/);
});

test('the Live Effect XML carries the published parameters', async () => {
    const { EFFECTS, pathfinderEffect } = await import('../src/effects.js');
    // Evaluate the generated expression with a stand-in document (scale factor 1, CMYK).
    const evalXml = (expr) => Function('doc', 'DocumentColorSpace', '__sf', `return ${expr};`)({ documentColorSpace: 'CMYK' }, { CMYK: 'CMYK' }, () => 1);
    assert.equal(evalXml(EFFECTS.offset_path.build({ offset: -2.5, joins: 'round', miterLimit: 4 })),
        '<LiveEffect name="Adobe Offset Path"><Dict data="R ofst -2.5 I jntp 0 R mlim 4 "/></LiveEffect>');
    assert.match(evalXml(EFFECTS.drop_shadow.build({ opacity: 50 })), /R opac 0\.5 .*<Fill color="0 0 0 1"\/>/);
    assert.match(evalXml(pathfinderEffect('divide', { removeUnpainted: true })), /I Command 5 B ConvertCustom 1 B ExtractUnpainted 1 .*value="Divide"/);
    assert.match(evalXml(EFFECTS.transform.build({ moveY: 10 })), /R moveV_Pts -10 /, 'down is positive for callers, up for the effect');
});

test('preferences: only known keys, with their stored types', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        await mcp.handleToolCall('set_preferences', { usePreviewBounds: true, keyboardIncrement: 0.5 });
        assert.match(sent[0], /p\.setBooleanPreference\("includeStrokeInBounds", true\);/);
        assert.match(sent[0], /p\.setRealPreference\("cursorKeyLength", 0\.5\);/);
        const none = await mcp.handleToolCall('set_preferences', { madeUpKey: 1 });
        assert.equal(none.success, false);
        assert.match(none.warnings.join(), /Unknown parameter 'madeUpKey'/);
    } finally {
        executor.runScript = original;
    }
});

test('select_tool matches Illustrator tool names loosely and refuses unknown ones', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const original = executor.runScript;
    let sent = '';
    executor.runScript = async (s) => { sent = s; return '{"ok":true,"result":"{}"}'; };
    try {
        await mcp.handleToolCall('select_tool', { tool: 'pen' });
        assert.match(sent, /app\.selectTool\("Adobe Pen Tool"\);/);
        const r = await mcp.handleToolCall('select_tool', { tool: 'Lasso of Truth' });
        assert.equal(r.success, false);
    } finally {
        executor.runScript = original;
    }
});

test('blend options: the generated Action carries spacing, steps and orientation', async () => {
    const { blendOptionsAction, ACTION_SET, ACTION_NAME } = await import('../src/blend.js');
    const aia = blendOptionsAction({ steps: 12, orientation: 'path' });
    const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
    assert.match(aia, /^\/version 3\n/);
    assert.ok(aia.includes(`/name [ ${ACTION_SET.length}\n\t${hex(ACTION_SET)}\n]`), 'set name, hex-encoded with its byte count');
    assert.ok(aia.includes(`\t/name [ ${ACTION_NAME.length}\n\t\t${hex(ACTION_NAME)}\n\t]`), 'action name');
    assert.match(aia, /\/internalName \(ai_plugin_liveblend\)/);
    assert.match(aia, /\/key 1835363957\n\t\t\t\/showInPalette 4294967295\n\t\t\t\/type \(enumerated\)\n[\s\S]*?\/value 5\n/, "'menu' = 5, specified steps");
    assert.match(aia, /\/key 1937007984\n\t\t\t\/showInPalette 4294967295\n\t\t\t\/type \(integer\)\n\t\t\t\/value 12\n/, "'step' = 12");
    assert.match(aia, /\/key 1919906913[\s\S]*?\/value 1\n/, "'rota' = 1, align to path");
    assert.match(blendOptionsAction({ steps: 3 }), /\/key 1919906913[\s\S]*?\/value 0\n/, 'orientation defaults to page');
    assert.equal((aia.match(/\{/g) || []).length, (aia.match(/\}/g) || []).length, 'balanced braces');
    assert.throws(() => blendOptionsAction({ steps: 0 }), /at least 1/);
    assert.throws(() => blendOptionsAction({ steps: 1001 }), /Invalid index/);
    assert.throws(() => blendOptionsAction({ steps: 4, orientation: 'sideways' }), /Allowed: page, path/);
});

test('blend tools load, play and always unload the Action', async () => {
    const { executor } = await import('../src/executor.js');
    const mcp = (await import('../src/server.js')).createServer();
    const sent = [];
    const original = executor.runScript;
    executor.runScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        await mcp.handleToolCall('make_blend', { target: { selection: true }, steps: 6 });
        await mcp.handleToolCall('make_blend', { target: { selection: true } });
        await mcp.handleToolCall('set_blend_options', { target: { selection: true }, steps: 6, orientation: 'path' });
    } finally {
        executor.runScript = original;
    }
    assert.match(sent[0], /app\.executeMenuCommand\("Path Blend Make"\);[\s\S]*app\.loadAction\(__aia\);\n {2}app\.doScript\("setBlendOptions", "adobe-mcp-blend"\);\n\} finally \{\n {2}try \{ app\.unloadAction\("adobe-mcp-blend", ""\); \} catch \(e\) \{\}\n {2}try \{ __aia\.remove\(\); \} catch \(e\) \{\}/);
    assert.doesNotMatch(sent[1], /loadAction/, 'no Action without steps');
    assert.match(sent[2], /\/value 6\\n/, 'step count reaches the Action text');
    for (const s of sent) assert.deepEqual(checkScript(s, typings), []);
});


test('PDF options override the preset with the object model\'s settings', async () => {
    const [s] = await scriptsFor([['export_pdf', {
        outputFile: `${home}/Documents/out.pdf`, preset: '[PDF/X-4:2008]', compatibility: 'acrobat7', standard: 'x4', bleed: 9,
        marks: ['trim', 'registration'], markType: 'roman', trimMarkWeight: '0.25', markOffset: 6,
        colorConversion: 'convert_to_destination', destination: 'document_cmyk', profileInclusion: 'destination',
        outputIntent: 'Coated FOGRA39 (ISO 12647-2:2004)', outputConditionId: 'FOGRA39', registryName: 'http://www.color.org', acrobatLayers: true,
    }]]);
    const lines = [
        'o.compatibility = PDFCompatibility.ACROBAT7;', 'o.pDFXStandard = PDFXStandard.PDFX42007;',
        'o.bleedLink = true;', 'o.bleedOffsetRect = [9, 9, 9, 9];',
        'o.trimMarks = true;', 'o.registrationMarks = true;', 'o.colorBars = false;', 'o.pageInformation = false;',
        'o.pageMarksType = PageMarksTypes.Roman;', 'o.trimMarkWeight = PDFTrimMarkWeight.TRIMMARKWEIGHT025;', 'o.offset = 6;',
        'o.colorConversionID = ColorConversion.COLORCONVERSIONTODEST;', 'o.colorDestinationID = ColorDestination.COLORDESTINATIONDOCCMYK;',
        'o.colorProfileID = ColorProfile.INCLUDEDESTPROFILE;', 'o.outputIntentProfile = "Coated FOGRA39 (ISO 12647-2:2004)";',
        'o.outputConditionID = "FOGRA39";', 'o.registryName = "http://www.color.org";', 'o.acrobatLayers = true;', 'o.viewAfterSaving = false;',
    ];
    for (const line of lines) assert.ok(s.includes(line), line);
    assert.ok(s.indexOf('o.pDFPreset = preset;') < s.indexOf('o.compatibility ='), 'the preset is applied before the overrides');
    const [plain] = await scriptsFor([['export_pdf', { outputFile: `${home}/Documents/out.pdf` }]]);
    assert.doesNotMatch(plain, /bleedOffsetRect|trimMarks|pDFXStandard/, 'without options the preset decides');
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('export_pdf', { outputFile: `${home}/a.pdf`, compatibility: 'acrobat5', acrobatLayers: true }), /acrobat6 or later/);
    await assert.rejects(mcp.handleToolCall('export_pdf', { outputFile: `${home}/a.pdf`, colorConversion: 'none', destination: 'working_cmyk' }), /colorConversion other than none/);
    await assert.rejects(mcp.handleToolCall('export_pdf', { outputFile: `${home}/a.pdf`, standard: 'x5' }), /Allowed: none, x1a-2001/);
});

test('JPEG and SVG exports set the dialog\'s options', async () => {
    const [jpeg, svgz, web] = await scriptsFor([
        ['export_jpeg', { outputFolder: `${home}/Documents`, quality: 60, scale: 200, matteColor: '#ff8000', blur: 0.5 }],
        ['export_svg', { outputFile: `${home}/Documents/a.svgz`, styling: 'presentation_attributes' }],
        ['export_web_svg', { outputFile: `${home}/Documents/a.svg`, styling: 'inline_style', images: 'link', objectIds: 'unique', decimals: 1, minify: true }],
    ]);
    for (const line of ['new ExportOptionsJPEG()', 'o.qualitySetting = 60;', 'o.horizontalScale = 200;', 'mc.red = 255; mc.green = 128; mc.blue = 0;', 'o.blurAmount = 0.5;', 'ExportType.JPEG', '".jpg"']) assert.ok(jpeg.includes(line), line);
    for (const line of ['o.compressed = true;', 'o.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;', 'ExportType.SVG', '"*.svgz"']) assert.ok(svgz.includes(line), line);
    for (const line of ['new ExportOptionsWebOptimizedSVG()', 'o.cssProperties = SVGCSSPropertyLocation.STYLEATTRIBUTES;', 'o.rasterImageLocation = RasterImageLocation.LINK;', 'o.svgId = SVGIdType.SVGIDUNIQUE;', 'o.coordinatePrecision = 1;', 'o.svgMinify = true;', 'o.svgResponsive = true;', 'ExportType.WOSVG']) assert.ok(web.includes(line), line);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('export_jpeg', { outputFolder: `${home}/Documents`, matteColor: 'white' }), /hex colour/);
    await assert.rejects(mcp.handleToolCall('export_web_svg', { outputFile: `${home}/Documents/a.svg`, styling: 'entities' }), /Allowed: internal_css, inline_style, presentation_attributes/);
});

test('save_document: AI and EPS options, each artboard to its own file', async () => {
    const [ai, eps] = await scriptsFor([
        ['save_document', { filePath: `${home}/Documents/a.ai`, compatibility: '17', separateArtboards: true, artboards: '2-3', compressed: false, fontSubsetThreshold: 50 }],
        ['save_document', { filePath: `${home}/Documents/a.eps`, preview: 'tiff_transparent', postScript: 2, overprint: 'discard' }],
    ]);
    for (const line of ['new IllustratorSaveOptions()', 'o.compatibility = Compatibility.ILLUSTRATOR17;', 'o.compressed = false;', 'o.fontSubsetThreshold = 50;', 'o.saveMultipleArtboards = true;', 'o.artboardRange = "2-3";', '__written(target.parent, "*.ai", since)']) assert.ok(ai.includes(line), line);
    for (const line of ['new EPSSaveOptions()', 'o.preview = EPSPreview.TRANSPARENTCOLORTIFF;', 'o.postScript = EPSPostScriptLevelEnum.LEVEL2;', 'o.overprint = PDFOverprint.DISCARDPDFOVERPRINT;', 'o.saveMultipleArtboards = false;']) assert.ok(eps.includes(line), line);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.ai`, preview: 'none' }), /preview applies only to \.eps files/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.eps`, compressed: false }), /compressed applies only to \.ai files/);
    await assert.rejects(mcp.handleToolCall('save_document', { compatibility: '17' }), /pass filePath to use compatibility/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.ai`, artboards: '1' }), /separateArtboards: true/);
    await assert.rejects(mcp.handleToolCall('save_document', { filePath: `${home}/Documents/a.pdf` }), /\.ai or \.eps/);
});

test('swatches: global, spot from Lab values, groups, and tints', async () => {
    const [global, lab, fill, group, used] = await scriptsFor([
        ['create_swatch', { name: 'Brand Blue', color: 'cmyk(100,60,0,0)', global: true, group: 'Brand' }],
        ['create_swatch', { name: 'Varnish', color: 'lab(50,20,-30)', spot: true }],
        ['set_fill', { target: { selection: true }, color: 'Brand Blue', tint: 40 }],
        ['create_swatch_group', { name: 'Brand', swatches: ['Brand Blue', 'Varnish'] }],
        ['add_used_colors', { group: 'Used' }],
    ]);
    for (const line of ['sp.colorType = ColorModel.PROCESS;', 'grp.addSpot(sp);', 'grp.name = "Brand";']) assert.ok(global.includes(line), line);
    for (const line of ['sp.spotKind = SpotColorKind.SPOTLAB;', 'l.l = 50; l.a = 20; l.b = -30;', 'sp.colorType = ColorModel.SPOT;']) assert.ok(lab.includes(line), line);
    assert.match(fill, /if \(c\.typename !== "SpotColor"\) throw new Error\("tint needs a spot or global swatch as the colour"\); c\.tint = 40;/);
    assert.match(group, /grp\.addSwatch\(sw\); return; \} catch \(e\) \{\}\n {2}grp\.addSpot/);
    assert.match(used, /"C=" \+ r\(c\.cyan\)/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('create_swatch', { name: 'x', color: 'lab(50,0,0)' }), /only define a spot colour/);
    await assert.rejects(mcp.handleToolCall('create_swatch', { name: 'x', color: '#000000', spot: true, global: true }), /spot or global, not both/);
    await assert.rejects(mcp.handleToolCall('create_swatch', { name: 'x', color: 'lab(120,0,0)', spot: true }), /color L/);
    await assert.rejects(mcp.handleToolCall('set_stroke', { target: { selection: true }, tint: 50 }), /'tint' needs a color/);
});

test('edit_colors, select_same and trim marks run their menu commands on the targets', async () => {
    const { EDIT_COLORS } = await import('../src/tools/color.js');
    const calls = Object.keys(EDIT_COLORS).map((operation) => ['edit_colors', { target: { selection: true }, operation }]);
    const sent = await scriptsFor([...calls, ['select_same', { target: { ids: ['42'] }, attribute: 'stroke_weight' }], ['create_trim_marks', { target: { selection: true } }], ['select_all', { artboardIndex: 1 }]]);
    Object.values(EDIT_COLORS).forEach((command, i) => assert.ok(sent[i].includes(`app.executeMenuCommand("${command}");`), command));
    assert.match(sent[calls.length], /app\.executeMenuCommand\("Find Stroke Weight menu item"\);/);
    assert.match(sent[calls.length + 1], /app\.executeMenuCommand\("TrimMark v25"\);/);
    assert.match(sent[calls.length + 2], /setActiveArtboardIndex\(ab\);\napp\.executeMenuCommand\("selectallinartboard"\);/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('edit_colors', { target: { selection: true }, operation: 'saturate' }), /Allowed: convert_to_cmyk/);
});

test('overprint covers paths and text', async () => {
    const [s] = await scriptsFor([['set_overprint', { target: { selection: true }, fill: true, stroke: false }]]);
    assert.match(s, /p\.fillOverprint = true; p\.strokeOverprint = false;/);
    assert.match(s, /ca\.overprintFill = true; ca\.overprintStroke = false;/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('set_overprint', { target: { selection: true } }), /Give fill, stroke or both/);
});

test('print_document fills only the Print dialog pages it is given', async () => {
    const [full, bare] = await scriptsFor([
        ['print_document', {
            outputFile: `${home}/Documents/proof.ps`, preset: 'Proof',
            general: { copies: 2, artboards: '2-3', layers: 'visible', bounds: 'artwork' },
            placement: { orientation: 'landscape', fitToPage: true },
            marks: { marks: ['all'], trimMarkWeight: 0.25, bleed: 9 },
            output: { mode: 'separations', convertSpotColors: true },
            fonts: { substitution: 'tint' },
            colorManagement: { profile: 'custom', profileName: 'Coated FOGRA39 (ISO 12647-2:2004)', intent: 'relative_colorimetric' },
            flattener: { preset: '[High Resolution]' },
        }],
        ['print_document', {}],
    ]);
    const lines = [
        'o.jobOptions = new PrintJobOptions();', 'o.jobOptions.copies = 2;', 'o.jobOptions.printAllArtboards = false;', 'o.jobOptions.artboardRange = "2-3";',
        'o.jobOptions.designation = PrintArtworkDesignation.VISIBLELAYERS;', 'o.jobOptions.printArea = PrintingBounds.ARTWORKBOUNDS;',
        'o.coordinateOptions.orientation = PrintOrientation.LANDSCAPE;', 'o.pageMarksOptions.trimMarks = true;', 'o.pageMarksOptions.pageInfoMarks = true;',
        'o.pageMarksOptions.trimMarksWeight = 0.25;', 'o.pageMarksOptions.bleedOffsetRect = [9, 9, 9, 9];',
        'o.colorSeparationOptions.colorSeparationMode = PrintColorSeparationMode.HOSTBASEDSEPARATION;',
        'o.fontOptions.fontSubstitution = FontSubstitutionPolicy.SUBSTITUTETINT;', 'o.colorManagementOptions.colorProfileMode = PrintColorProfile.CUSTOMPROFILE;',
        'o.colorManagementOptions.intent = PrintColorIntent.RELATIVECOLORIMETRIC;', 'o.flattenerPreset = "[High Resolution]";', 'o.printPreset = "Proof";',
        'o.jobOptions.file = new File(', 'doc.print(o);',
    ];
    for (const line of lines) assert.ok(full.includes(line), line);
    assert.doesNotMatch(full, /new PrintPaperOptions|new PrintPostScriptOptions|new PrintFlattenerOptions/, 'pages not given keep the preset');
    assert.doesNotMatch(bare, /new Print\w+Options\(\)/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('print_document', { marks: { crops: true } }), /'marks' has no option crops/);
    await assert.rejects(mcp.handleToolCall('print_document', { colorManagement: { profile: 'custom' } }), /needs profileName/);
    await assert.rejects(mcp.handleToolCall('print_document', { outputFile: `${home}/Documents/proof.pdf` }), /\.ps/);
    const def = (await import('../src/server.js')).toolDefinitions.find((t) => t.name === 'print_document');
    assert.equal(def.annotations.openWorldHint, true, 'printing reaches a device');
});

test('variables: names Illustrator can store, bound by kind', async () => {
    const [create, bind] = await scriptsFor([
        ['create_variable', { name: 'headline', kind: 'text', target: { selection: true } }],
        ['bind_variable', { name: 'badge', target: { ids: ['7'] } }],
    ]);
    assert.match(create, /v\.kind = VariableKind\.TEXTUAL;\nv\.name = "headline";/);
    assert.match(create, /catch \(e\) \{ v\.remove\(\); throw e; \}/, 'a failed binding removes the new variable');
    assert.match(bind, /if \(k === VariableKind\.VISIBILITY\) \{ it\.visibilityVariable = v; return; \}/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('create_variable', { name: 'two words', kind: 'text' }), /must start with a letter/);
    await assert.rejects(mcp.handleToolCall('create_variable', { name: 'x', kind: 'colour' }), /Allowed: text, image, graph, visibility/);
});

test('data sets: each record sets the bound items, then is captured or updated', async () => {
    const photo = `${home}/Documents/a.jpg`;
    const [s] = await scriptsFor([['create_data_sets', {
        records: [
            { name: 'Spring', values: { headline: 'Spring sale', price: 19, photo, badge: true } },
            { name: 'Summer', values: { headline: '/r/summer', badge: false } },
        ],
    }]]);
    const records = JSON.parse(/var records = (\[.*?\]), made/.exec(s)[1]);
    assert.deepEqual(records[0].values, [
        { name: 'headline', text: 'Spring sale' }, { name: 'price', text: '19' }, { name: 'photo', text: photo, file: photo }, { name: 'badge', visible: true },
    ]);
    assert.equal(records[1].values[0].text, '/r/summer');
    assert.ok(records[1].values[0].fileError, 'text that looks like a path outside the allowed folders is still text');
    assert.match(s, /if \(ds\) ds\.display\(\);/, 'an existing data set is displayed, edited and updated');
    assert.match(s, /if \(ds\) \{ ds\.update\(\); updated\.push\(rec\.name\); \}\n {2}else \{ ds = doc\.dataSets\.add\(\); ds\.name = rec\.name; made\.push\(rec\.name\); \}/);
    assert.match(s, /getByName\("Spring"\)/, 'shows the first record afterwards');
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('create_data_sets', { records: [{ name: 'x', values: { headline: ['a'] } }] }), /must be text, a file path or true\/false/);
    await assert.rejects(mcp.handleToolCall('create_data_sets', { records: [{ values: {} }] }), /records\[0\] needs a name/);
});

test('export_data_sets displays each data set, exports its artboards and restores the one shown', async () => {
    const [png, jpeg] = await scriptsFor([
        ['export_data_sets', { outputFolder: `${home}/Documents/out`, dataSets: ['Spring'] }],
        ['export_data_sets', { outputFolder: `${home}/Documents/out`, format: 'jpeg', quality: 90, artboards: '1' }],
    ]);
    assert.match(png, /sets\[s\]\.display\(\);[\s\S]*ExportType\.PNG24[\s\S]*\} finally \{[\s\S]*before\.display\(\)/);
    assert.match(jpeg, /o\.qualitySetting = 90;[\s\S]*ExportType\.JPEG/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('export_data_sets', { outputFolder: `${home}/Documents/out`, quality: 50 }), /applies to jpeg/);
});

test('path operations run Object > Path commands on exactly the targets', async () => {
    const { PATH_OPERATIONS } = await import('../src/tools/paths.js');
    const calls = Object.keys(PATH_OPERATIONS).map((operation) => ['path_operation', { target: { ids: ['1'] }, operation }]);
    const sent = await scriptsFor(calls);
    Object.values(PATH_OPERATIONS).forEach((command, i) => assert.ok(sent[i].includes(`app.executeMenuCommand("${command}");`), command));
    assert.match(sent[Object.keys(PATH_OPERATIONS).indexOf('divide_objects_below')], /give a single target/);
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('path_operation', { target: { selection: true }, operation: 'simplify' }), /Allowed: outline_stroke/);
});

test('average, clean up, grid and split are done through the object model', async () => {
    const [h, both, clean, grid, split] = await scriptsFor([
        ['average_points', { target: { selection: true }, axis: 'horizontal' }],
        ['average_points', { target: { selection: true }, axis: 'both', join: true }],
        ['clean_up', { emptyText: false }],
        ['split_into_grid', { target: { selection: true }, rows: 2, columns: 3, gutter: 10, rowGutter: 4, addGuides: true }],
        ['split_path', { target: { ids: ['9'] }, pointIndex: 1 }],
    ]);
    assert.match(h, /dx = 0, dy = ay - q2\.anchor\[1\]/, 'horizontal: same y');
    assert.match(both, /dx = ax - q2\.anchor\[0\], dy = ay - q2\.anchor\[1\]/);
    assert.match(both, /app\.executeMenuCommand\("join"\);/);
    assert.doesNotMatch(h, /executeMenuCommand/);
    assert.match(clean, /p\.clipping \|\| p\.guides \|\| !__editable\(p\)/, 'clipping paths and guides are unpainted on purpose');
    assert.doesNotMatch(clean, /textFrames/);
    assert.match(grid, /rows = 2, cols = 3, rg = __len\(doc, 4\), cg = __len\(doc, 10\)/);
    assert.match(grid, /gd\.guides = true/);
    assert.match(split, /pts\.slice\(i\)\.concat\(pts\.slice\(0, i \+ 1\)\)/, 'a closed path opens at the point');
    const mcp = (await import('../src/server.js')).createServer();
    await assert.rejects(mcp.handleToolCall('clean_up', { strayPoints: false, unpaintedObjects: false, emptyText: false }), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_path_options', { target: { selection: true } }), /at least one/);
});
