import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptsFor, server } from './helpers.js';

const L1 = { indexes: [1] };

test('text layers: point, paragraph and vertical text', async () => {
    const [point, box, vbox] = await scriptsFor([
        ['add_text_layer', { text: 'Hello\nworld' }],
        ['add_text_layer', { text: 'Box', kind: 'paragraph', boxSize: [400, 200], position: [10, 20], name: 'Title' }],
        ['add_text_layer', { text: 'Tate', kind: 'paragraph', orientation: 'vertical' }],
    ]);
    assert.match(point, /var l = c\.layers\.addText\("Hello\\rworld"\);/);
    assert.match(box, /c\.layers\.addBoxText\(\[400,200\], "Box"\)/);
    assert.match(box, /l\.name = "Title";/);
    assert.match(box, /\.property\("ADBE Position"\)\.setValue\(__fit\(.*\[10,20\]\)\);/);
    assert.match(vbox, /c\.layers\.addVerticalBoxText\(b\[0\], b\[1\]\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('add_text_layer', { text: 'x', boxSize: [10, 10] }), /paragraph text/);
    await assert.rejects(mcp.handleToolCall('add_text_layer', { text: 'x', kind: 'area' }), /Allowed: point, paragraph/);
});

test('set_text: character and paragraph options, ranges, steps and resets', async () => {
    const [whole, chars, paras, steps] = await scriptsFor([
        ['set_text', { layers: L1, autoKerning: 'optical', tsume: 20, applyFill: false, strokeOverFill: false, baselineOption: 'superscript', digits: 'hindi', baselineDirection: 'tate_chuu_yoko', composer: 'single_line', leadingType: 'top_to_top', direction: 'right_to_left', lineOrientation: 'vertical_right_to_left', universalTextEngine: true, resetCharacter: true }],
        ['set_text', { layers: L1, range: { by: 'characters', start: 2, end: 5 }, fillColor: '#FF0000', fontFamily: 'Minion Pro', fontStyle: 'Bold' }],
        ['set_text', { layers: L1, range: { by: 'paragraphs', start: 0, end: 1 }, startIndent: 10, spaceAfter: 6, hangingRoman: true, justification: 'center' }],
        ['set_text', { layers: L1, adjust: { fontSize: 2, leading: -2, tracking: 20 }, tracking: 0, horizontalScale: 100 }],
    ]);
    assert.match(whole, /var t = td;\n {2}t\.resetCharStyle\(\);\n {2}td\.composerEngine = ComposerEngine\.UNIVERSAL_TYPE_ENGINE;/);
    for (const re of [/t\.autoKernType = AutoKernType\.OPTICAL_KERN;/, /t\.tsume = 20;/, /t\.applyFill = false;/, /t\.strokeOverFill = false;/,
        /t\.fontBaselineOption = FontBaselineOption\.FONT_FAUXED_SUPERSCRIPT;/, /t\.digitSet = DigitSet\.HINDI_DIGITS;/,
        /t\.baselineDirection = BaselineDirection\.BASELINE_VERTICAL_CROSS_STREAM;/, /t\.everyLineComposer = false;/,
        /t\.leadingType = LeadingType\.JAPANESE_LEADING_TYPE;/, /t\.direction = ParagraphDirection\.DIRECTION_RIGHT_TO_LEFT;/,
        /td\.lineOrientation = LineOrientation\.VERTICAL_RIGHT_TO_LEFT;/]) assert.match(whole, re);
    assert.match(chars, /var t = td\.characterRange\(2, 5\);/);
    assert.match(chars, /app\.fonts\.getFontsByFamilyNameAndStyleName\("Minion Pro", "Bold"\).*t\.fontObject = fo\[0\];/);
    assert.match(paras, /var t = td\.paragraphRange\(0, 1\);/);
    assert.match(paras, /t\.startIndent = 10;[\s\S]*t\.spaceAfter = 6;/);
    assert.match(steps, /t\.fontSize = Math\.max\(0\.1, Math\.min\(1296, t\.fontSize \+ 2\)\);/);
    assert.match(steps, /t\.autoLeading = false; t\.leading = Math\.max\(0, t\.leading \+ -2\);/);
    assert.match(steps, /t\.tracking = 0;[\s\S]*t\.tracking = t\.tracking \+ 20;/);
    assert.match(steps, /t\.horizontalScale = 100 \/ 100;/);

    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, range: { by: 'characters', start: 4, end: 2 }, fontSize: 10 }), /after 'range\.start'/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, range: { by: 'words', start: 0, end: 2 }, fontSize: 10 }), /Allowed: characters, paragraphs/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, range: { by: 'characters', start: 0, end: 2 }, lineOrientation: 'horizontal' }), /whole layer/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, fontFamily: 'Arial' }), /together/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, universalTextEngine: false }), /cannot be switched back/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, adjust: { size: 2 } }), /unknown size/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1, tsume: 200 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_text', { layers: L1 }), /Give text or formatting/);
});

test('get_text and find_fonts read text documents, ranges and fonts', async () => {
    const [get, find, missing, opts] = await scriptsFor([
        ['get_text', { layers: L1 }],
        ['find_fonts', { query: 'Inter', variableOnly: true, limit: 5 }],
        ['find_fonts', { missing: true }],
        ['set_font_options', { favorites: ['Inter'], rescanFontFolders: true }],
    ]);
    assert.match(get, /td\.composedLineRange\(k, k \+ 1\)/);
    assert.match(get, /td\.paragraphRange\(k, k \+ 1\)/);
    assert.match(get, /fo\.designAxesData/);
    assert.match(find, /var q = "inter"/);
    assert.match(find, /if \(!f\.hasDesignAxes\) continue;/);
    assert.match(missing, /app\.fonts\.missingOrSubstitutedFonts/);
    assert.match(opts, /app\.fonts\.favoriteFontFamilyList = \["Inter"\];/);
    assert.match(opts, /app\.fonts\.pollForAndPushNonSystemFontFoldersChanges\(\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_font_options', {}), /favorites or rescanFontFolders/);
});

test('set_text_options: path options, more options and per-character 3D', async () => {
    const [s] = await scriptsFor([['set_text_options', {
        layers: L1, path: 1, reversePath: true, firstMargin: 20, anchorPointGrouping: 'word', groupingAlignment: [0, -50],
        fillAndStroke: 'all_strokes_over_all_fills', orientCharacters: true,
    }]]);
    assert.match(s, /l\.threeDPerChar = true;\n {2}l\.autoOrient = AutoOrientType\.CHARACTERS_TOWARD_CAMERA;/);
    assert.match(s, /__set\(c, l\.text\.pathOption\.path, 1\);/);
    assert.match(s, /property\("ADBE Text Reverse Path"\), 1\);/);
    assert.match(s, /__set\(c, l\.text\.moreOption\.anchorPointGrouping, 2\);/);
    assert.match(s, /__set\(c, l\.text\.moreOption\.fillANdStroke, 3\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_text_options', { layers: L1 }), /at least one option/);
    await assert.rejects(mcp.handleToolCall('set_text_options', { layers: L1, orientCharacters: true, perCharacter3D: false }), /needs per-character 3D/);
    await assert.rejects(mcp.handleToolCall('set_text_options', { layers: L1, anchorPointGrouping: 'paragraph' }), /Allowed: character, word, line, all/);
});

test('set_text_animator adds animators, properties, axes and range, wiggly and expression selectors', async () => {
    const [add, edit] = await scriptsFor([
        ['set_text_animator', { layers: L1, name: 'Fade', properties: { all_transform: true, opacity: 0, fill_color: '#00FF00', character_value: 65 }, fontAxes: [{ tag: 'wght', value: 800 }],
            selectors: [
                { type: 'range', units: 'index', start: 0, end: 3, basedOn: 'words', mode: 'subtract', amount: 50, shape: 'triangle', easeHigh: 25, randomizeOrder: true, randomSeed: 4 },
                { type: 'wiggly', maxAmount: 80, wigglesPerSecond: 3, lockDimensions: true, randomSeed: 9 },
                { type: 'expression', expression: 'selectorValue * textIndex/textTotal' },
            ] }],
        ['set_text_animator', { layers: L1, animator: 'Fade', selectors: [{ type: 'range', selector: 1, smoothness: 75 }] }],
    ]);
    assert.match(add, /var ai = __animators\(l\)\.addProperty\("ADBE Text Animator"\)\.propertyIndex/);
    assert.match(add, /__animators\(l\)\.property\(ai\)\.name = "Fade";/);
    for (const m of ['Anchor Point 3D', 'Position 3D', 'Scale 3D', 'Skew', 'Skew Axis', 'Rotation', 'Opacity', 'Fill Color', 'Character Replace']) assert.match(add, new RegExp(`addProperty\\("ADBE Text ${m}"\\)`));
    assert.match(add, /__set\(c, p, 0\);/);
    assert.match(add, /__set\(c, p, \[0,1,0\]\);/);
    assert.match(add, /addVariableFontAxis\("wght"\);\n {2}__set\(c, ax, 800\);/);
    assert.match(add, /names = \["ADBE Text Selector","Range Selector"\]/);
    assert.match(add, /names = \["ADBE Text Wiggly Selector","Wiggly Selector"\]/);
    assert.match(add, /names = \["ADBE Text Expressible Selector","Expression Selector"\]/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Range Units","Units"\]\), 2\);/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Range Type2","Based On"\]\), 3\);/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Selector Mode","Mode"\]\), 2\);/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Range Shape","Shape"\]\), 4\);/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Randomize Order","Randomize Order"\]\), 1\);/);
    assert.match(add, /__set\(c, sp\(\["ADBE Text Wiggly Random Seed","Random Seed"\]\), 9\);/);
    assert.match(add, /sp\(\["ADBE Text Expressible Amount","Amount"\]\)\.expression = "selectorValue \* textIndex\/textTotal";/);
    assert.match(add, /ADBE Text Index Start/);
    assert.doesNotMatch(add, /isNew && __animSels/, 'given selectors replace the default range selector');
    assert.match(edit, /var found = __animators\(l\)\.property\("Fade"\)/);
    assert.match(edit, /var s = __animSels\(l, ai\)\.property\(1\);/);
    assert.match(edit, /"ADBE Text Selector Smoothness","Smoothness"\]\), 75\);/);

    const mcp = await server();
    const call = (args) => mcp.handleToolCall('set_text_animator', { layers: L1, ...args });
    await assert.rejects(call({ properties: { wobble: 1 } }), /unknown wobble/);
    await assert.rejects(call({ properties: { opacity: 'half' } }), /must be a number or an array/);
    await assert.rejects(call({ properties: { fill_color: 'green' } }), /#RRGGBB/);
    await assert.rejects(call({ fontAxes: [{ tag: 'weight' }] }), /four-letter/);
    await assert.rejects(call({ selectors: [{ type: 'random' }] }), /Allowed: range, wiggly, expression/);
    await assert.rejects(call({ selectors: [{ type: 'wiggly', shape: 'round' }] }), /does not apply to a wiggly selector/);
    await assert.rejects(call({ selectors: [{ type: 'expression', start: 10 }] }), /Range selector settings/);
    await assert.rejects(call({ selectors: [{ type: 'range', mode: 'multiply' }] }), /Allowed: add, subtract/);
    await assert.rejects(call({ selectors: [{ type: 'range', amount: 150 }] }), /out of range/);
    await assert.rejects(call({ selectors: [{ type: 'range', bogus: 1 }] }), /unknown setting bogus/);
    await assert.rejects(call({ animator: 2 }), /Give properties/);
});

test('animators are listed and removed; text converts through Layer menu commands', async () => {
    const [list, some, all, shapes, masks, panel] = await scriptsFor([
        ['list_text_animators', { layers: L1 }],
        ['remove_text_animators', { layers: L1, animators: [2, 'Fade'] }],
        ['remove_text_animators', { layers: L1, all: true }],
        ['convert_text_layers', { layers: L1, action: 'shapes' }],
        ['convert_text_layers', { layers: L1, action: 'masks' }],
        ['show_text_panels', { panel: 'paragraph' }],
    ]);
    assert.match(list, /list\.push\(__animInfo\(l, k\)\)/);
    assert.match(some, /keys = \[2,"Fade"\]/);
    assert.match(some, /idx\.sort\(function \(x, y\) \{ return y - x; \}\);/);
    assert.match(all, /for \(k = 1; k <= __animators\(l\)\.numProperties; k\+\+\) idx\.push\(k\);/);
    assert.match(shapes, /ls\[k\]\.selected = true;\napp\.executeCommand\(3781\);/);
    assert.match(masks, /app\.executeCommand\(2933\);/);
    assert.match(panel, /app\.executeCommand\(3012\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('remove_text_animators', { layers: L1 }), /Give animators, or all/);
    await assert.rejects(mcp.handleToolCall('remove_text_animators', { layers: L1, all: true, animators: [1] }), /Give animators, or all/);
    await assert.rejects(mcp.handleToolCall('convert_text_layers', { layers: L1, action: 'outlines' }), /Allowed: shapes, masks, editable/);
    await assert.rejects(mcp.handleToolCall('show_text_panels', { panel: 'glyphs' }), /Allowed: character, paragraph, toggle/);
});
