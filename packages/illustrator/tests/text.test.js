import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';
import { toolTable } from '../src/server.js';

const sel = { selection: true };
const docs = path.join(home, 'Documents');

test('type on a path: created from a path, which is removed unless kept', async () => {
    const [onPath, inside, kept] = await scriptsFor([
        ['create_path_text', { target: sel, contents: 'Around', start: 0.25, end: 0.75, orientation: 'vertical', font: 'MyriadPro-Regular' }],
        ['create_path_text', { target: sel, contents: 'Inside', kind: 'area' }],
        ['create_path_text', { target: sel, contents: 'Kept', keepPath: true }],
    ]);
    assert.match(onPath, /src\.layer\.textFrames\.pathText\(src\);/);
    assert.match(onPath, /tf\.startTValue = segs \* 0\.25;/);
    assert.match(onPath, /tf\.endTValue = segs \* 0\.75;/);
    assert.match(onPath, /tf\.orientation = TextOrientation\.VERTICAL;/);
    assert.match(onPath, /src\.remove\(\);/);
    assert.match(inside, /textFrames\.areaText\(src\);/);
    assert.doesNotMatch(kept, /src\.remove\(\)/);
});

test('type on a path: effects, flip, spacing and legacy update', async () => {
    const [s] = await scriptsFor([['set_path_text', { target: sel, effect: 'ribbon_3d', flip: true, spacing: 3, start: 0, end: 0.5, updateLegacy: true }]]);
    assert.match(s, /items\[i\]\.kind !== TextType\.PATHTEXT/);
    assert.match(s, /app\.executeMenuCommand\("3D ribbon"\);/);
    assert.match(s, /app\.executeMenuCommand\("Reverse Path Direction"\);/);
    assert.match(s, /app\.executeMenuCommand\("updateLegacyTOP"\);/);
    assert.match(s, /tf\.spacing = 3;/);
    assert.match(s, /tf\.endTValue = segs \* 0\.5;/);
});

test('type on a path: bad arguments are refused', async () => {
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_path_text', { target: sel }), /at least one of effect/);
    await assert.rejects(mcp.handleToolCall('set_path_text', { target: sel, effect: 'wobble' }), /Allowed: rainbow/);
    await assert.rejects(mcp.handleToolCall('set_path_text', { target: sel, start: 0.6, end: 0.4 }), /start must be below end/);
    await assert.rejects(mcp.handleToolCall('create_path_text', { target: sel, contents: 'x', start: 2 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('create_path_text', { target: sel, contents: 'x', kind: 'area', start: 0.1 }), /path text only/);
});

test('change case uses the object model', async () => {
    const [s] = await scriptsFor([['change_case', { target: sel, case: 'title' }]]);
    assert.match(s, /textRange\.changeCaseTo\(CaseChangeType\.TITLECASE\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('change_case', { target: sel, case: 'shouting' }), /Allowed: upper/);
});

test('special characters are inserted at insertion points, written as ASCII escapes', async () => {
    const [dash, brk, spaces] = await scriptsFor([
        ['insert_special_character', { target: sel, character: 'em_dash', position: 'start' }],
        ['insert_special_character', { target: sel, character: 'forced_line_break', index: 4 }],
        ['insert_special_character', { target: sel, character: 'thin_space', count: 3 }],
    ]);
    assert.match(dash, /ch = "\\u2014"/);
    assert.match(dash, /at = 0;/);
    assert.match(dash, /tf\.insertionPoints\[at\]\.characters\.add\(ch\);/);
    assert.match(brk, /ch = "\\u0003"/);
    assert.match(brk, /at = 4;/);
    assert.match(spaces, /ch = "\\u2009\\u2009\\u2009"/);
    assert.match(spaces, /at = n;/);
    for (const s of [dash, brk, spaces]) assert.doesNotMatch(s, /[^\x00-\x7f]/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('insert_special_character', { target: sel, character: 'snowman' }), /Allowed: bullet/);
    await assert.rejects(mcp.handleToolCall('insert_special_character', { target: sel, character: 'bullet', count: 0 }), /at least 1/);
});

test('smart punctuation edits characters in place', async () => {
    const [all, some] = await scriptsFor([
        ['apply_smart_punctuation', { ligatures: true, fractions: true }],
        ['apply_smart_punctuation', { target: sel, quotes: false, spaces: false, ellipses: false }],
    ]);
    assert.match(all, /__stories\(doc, null\)/);
    assert.match(all, /characterAttributes\.ligature = true/);
    assert.match(all, /characterAttributes\.fractions = true/);
    assert.match(all, /edits\.push\(\[i, 3, "\\u2026"\]\)/);
    assert.match(all, /"\\u201c" : "\\u201d"/);
    assert.match(all, /__replaceAt\(story, edits\[e\]\[0\], edits\[e\]\[1\], edits\[e\]\[2\]\)/);
    assert.match(some, /"\\u2013"/);
    assert.doesNotMatch(some, /u2026|u201c|\.ligature = /);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('apply_smart_punctuation', { quotes: false, dashes: false, ellipses: false, spaces: false }), /at least one/);
});

test('placeholder text fills area text to its edge', async () => {
    const [s] = await scriptsFor([['fill_placeholder_text', { target: sel }]]);
    assert.match(s, /tf\.kind === TextType\.AREATEXT/);
    assert.match(s, /n \+= tf\.lines\[l\]\.characters\.length/);
    assert.match(s, /Lorem ipsum/);
});

test('type commands: bullets need targets, toggles need no document', async () => {
    const [bullets, hidden] = await scriptsFor([
        ['run_type_command', { command: 'convert_bullets_to_text', target: sel }],
        ['run_type_command', { command: 'show_hidden_characters' }],
    ]);
    assert.match(bullets, /app\.executeMenuCommand\("convert list style to text"\);/);
    assert.match(hidden, /app\.executeMenuCommand\("showHiddenChar"\);/);
    assert.doesNotMatch(hidden, /var doc = __doc\(\);/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('run_type_command', { command: 'convert_bullets_to_text' }), /give target/);
});

test('fonts: missing fonts are found and replaced run by run', async () => {
    const [list, replace] = await scriptsFor([
        ['list_document_fonts', {}],
        ['replace_font', { to: 'MyriadPro-Bold', from: ['Arial-BoldMT', 'x"}); app.quit(); ({"'], missing: true }],
    ]);
    assert.match(list, /app\.textFonts\.isFontAvailable\(name\)/);
    assert.match(list, /runs\[r\]\.characterAttributes\.textFont/);
    assert.match(replace, /want = \{"Arial-BoldMT":true,"x\\"\}\); app\.quit\(\); \(\{\\"":true\}/);
    assert.match(replace, /runs\[r\]\.characterAttributes\.textFont = to;/);
    assert.match(replace, /\(true && isMissing\(name\)\)/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('replace_font', { to: 'MyriadPro-Bold' }), /from .* or missing: true/);
});

test('find and replace: options, replacement and Find Next selection', async () => {
    const [replace, find] = await scriptsFor([
        ['find_replace_text', { find: 'colour', replace: 'color', matchCase: true, wholeWord: true }],
        ['find_replace_text', { find: 'Sale', target: sel, selectMatch: 2 }],
    ]);
    assert.match(replace, /__find\(t, find, true, true\)/);
    assert.match(replace, /__replaceAt\(story, hits\[r\], find\.length, "color"\);/);
    assert.match(find, /var at = hits\[2 - total\];/);
    assert.match(find, /story\.characters\[at \+ c\]\.select\(c > 0\);/);
    assert.doesNotMatch(find, /__replaceAt\(story, hits/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('find_replace_text', { find: '' }), /non-empty/);
    await assert.rejects(mcp.handleToolCall('find_replace_text', { find: 'a', replace: 'b', selectMatch: 0 }), /finding only/);
});

test('text wrap sets the page item properties', async () => {
    const [make, release] = await scriptsFor([
        ['set_text_wrap', { target: sel, offset: 12, invert: true }],
        ['set_text_wrap', { target: sel, wrap: false }],
    ]);
    assert.match(make, /it\.wrapped = true;/);
    assert.match(make, /it\.wrapOffset = __len\(doc, 12\);/);
    assert.match(make, /it\.wrapInside = true;/);
    assert.match(release, /it\.wrapped = false;/);
});

test('stories, legacy text and orientation', async () => {
    const [stories, all, picked, vertical] = await scriptsFor([
        ['list_stories', { includeText: true }],
        ['update_legacy_text', { all: true }],
        ['update_legacy_text', { target: sel }],
        ['set_text_orientation', { target: sel, orientation: 'vertical' }],
    ]);
    assert.match(stories, /doc\.stories\[s\]/);
    assert.match(stories, /legacyText: doc\.legacyTextItems\.length/);
    assert.match(all, /doc\.legacyTextItems\.convertToNative\(\);/);
    assert.match(picked, /items\[i\]\.convertToNative\(\);/);
    assert.match(vertical, /items\[i\]\.orientation = TextOrientation\.VERTICAL;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('update_legacy_text', {}), /all: true, or target/);
    await assert.rejects(mcp.handleToolCall('update_legacy_text', { all: true, target: sel }), /not both/);
});

test('text import and export go through the path policy', async () => {
    const txt = path.join(docs, 'copy.txt');
    const [into, area, out] = await scriptsFor([
        ['import_text', { filePath: txt, target: sel }],
        ['import_text', { filePath: txt, x: 10, y: 20, width: 200, height: 100 }],
        ['export_text', { filePath: txt }],
    ]);
    assert.match(into, /f\.encoding = "UTF-8";/);
    assert.match(into, /text\.replace\(\/\\r\\n\|\\n\/g, "\\r"\)/);
    assert.match(into, /tf = items\[0\];/);
    assert.match(area, /layer\.textFrames\.areaText\(box\);/);
    assert.match(out, /f\.open\("w"\)/);
    assert.match(out, /stories\[s\]\.textRange\.contents\.replace/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('import_text', { filePath: path.join(docs, 'copy.docx'), target: sel }), /\.txt/);
    await assert.rejects(mcp.handleToolCall('import_text', { filePath: txt }), /Give x and y/);
    await assert.rejects(mcp.handleToolCall('import_text', { filePath: txt, x: 0, y: 0, width: 100 }), /width and height/);
    await assert.rejects(mcp.handleToolCall('export_text', { filePath: '/etc/copy.txt' }));
});

test('Asian and right-to-left composition', async () => {
    const [asian, rtl] = await scriptsFor([
        ['set_asian_type', { target: sel, composer: 'every_line', kinsoku: 'Hard', kinsokuOrder: 'push_out_first', tsume: 50, tateChuYoko: true, wariChu: true, wariChuLines: 2 }],
        ['set_right_to_left_text', { target: sel, direction: 'right_to_left', composer: 'middle_eastern', digits: 'arabic', kashidas: 'on', characterDirection: 'default' }],
    ]);
    assert.match(asian, /pa\.composerEngine = ComposerEngineType\.latinCJKComposer;/);
    assert.match(asian, /pa\.everyLineComposer = true;/);
    assert.match(asian, /__inSet\("Hard", doc\.kinsokuSet, "kinsoku"\);/);
    assert.match(asian, /pa\.kinsokuOrder = KinsokuOrderEnum\.PUSHOUTFIRST;/);
    assert.match(asian, /ca\.Tsume = 50;/);
    assert.match(asian, /ca\.baselineDirection = BaselineDirectionType\.TateChuYoko;/);
    assert.match(asian, /ca\.wariChuLines = 2;/);
    assert.match(rtl, /pa\.paragraphDirection = ParagraphDirectionType\.RIGHT_TO_LEFT_DIRECTION;/);
    assert.match(rtl, /pa\.composerEngine = ComposerEngineType\.optycaComposer;/);
    assert.match(rtl, /ca\.digitSet = DigitSetType\.ARABIC_DIGITS;/);
    assert.match(rtl, /ca\.kashidas = KashidasType\.KASHIDAS_ON;/);
    assert.match(rtl, /ca\.dirOverride = DirOverrideType\.DEFAULT_DIRECTION;/);
    const mcp = await server();
    await assert.rejects(mcp.handleToolCall('set_asian_type', { target: sel }), /at least one/);
    await assert.rejects(mcp.handleToolCall('set_asian_type', { target: sel, tsume: 150 }), /out of range/);
    await assert.rejects(mcp.handleToolCall('set_right_to_left_text', { target: sel, digits: 'roman' }), /Allowed: default/);
});

test('text tools claim each feature once', () => {
    const claimed = toolTable.filter((t) => t.area === 'text').flatMap((t) => t.features);
    assert.equal(new Set(claimed).size, claimed.length);
    assert.ok(claimed.includes('illustrator.typography.insert_nonbreaking_space'));
});
