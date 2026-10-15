import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scriptsFor, server, home } from './helpers.js';

const frame = { ids: ['frame-1'] };

/** Call a tool that should be refused before any script runs. */
async function refused(name, args, pattern) {
    const { executor } = await import('../src/executor.js');
    const mcp = await server();
    const original = executor.runScript;
    let ran = false;
    executor.runScript = async () => { ran = true; return '{"ok":true,"result":"{}"}'; };
    try {
        let message;
        try {
            const r = await mcp.handleToolCall(name, args);
            assert.equal(r.success, false, `${name} should refuse ${JSON.stringify(args)}`);
            message = JSON.stringify(r);
        } catch (e) {
            message = e.message;
        }
        assert.match(message, pattern);
        assert.equal(ran, false, `${name} ran a script`);
    } finally {
        executor.runScript = original;
    }
}

test('character attributes map to CharacterAttributes members on ranges', async () => {
    const [s] = await scriptsFor([['set_character_attributes', {
        target: frame, range: { start: 2, length: 3 },
        font: 'MyriadPro-Regular', fontStyle: 'Bold', size: 14, leading: 18, kerningMethod: 'optical', kerning: -20,
        horizontalScale: 90, baselineShift: 2, rotation: 15, language: 'UKENGLISH', capitalization: 'small_caps', position: 'superscript',
        underline: true, strikethrough: false, strokeColor: '#FF0000', strokeWeight: 0.5, noBreak: true, overprintFill: true,
        syntheticItalics: true, tsume: 50, insertSpaceLeft: 0.25, tateChuYokoVertical: 1, warichu: true, warichuLines: 2,
        warichuJustification: 'full_justify_last_center', baselineDirection: 'tate_chu_yoko', characterAlignment: 'icf_top',
    }]]);
    assert.match(s, /__charRanges\(doc, \{"ids":\["frame-1"\]\}, \{"start":2,"length":3\}\)/);
    for (const re of [
        /ca\.textFont = __font\("MyriadPro-Regular"\);/, /ca\.textFont = __face\(tr, "Bold"\);/, /ca\.autoLeading = false;\s+ca\.size = 14;\s+ca\.leading = 18;/,
        /ca\.kerningMethod = AutoKernType\.OPTICAL;/, /tr\.kerning = -20;/, /ca\.horizontalScale = 90;/, /ca\.baselineShift = 2;/, /ca\.rotation = 15;/,
        /ca\.language = LanguageType\.UKENGLISH;/, /ca\.capitalization = FontCapsOption\.SMALLCAPS;/, /ca\.baselinePosition = FontBaselineOption\.SUPERSCRIPT;/,
        /ca\.underline = true;/, /ca\.strikeThrough = false;/, /ca\.strokeColor = __color\(doc, \{"kind":"rgb","v":\[255,0,0\]\}\);/, /ca\.strokeWeight = 0\.5;/,
        /ca\.noBreak = true;/, /ca\.overprintFill = true;/, /ca\.italics = true;/, /ca\.Tsume = 50;/, /ca\.akiLeft = 0\.25;/, /ca\.tateChuYokoVertical = 1;/,
        /ca\.wariChuEnabled = true;/, /ca\.wariChuLines = 2;/, /ca\.wariChuJustification = WariChuJustificationType\.WARICHUFULLJUSTIFYLASTLINECENTER;/,
        /ca\.baselineDirection = BaselineDirectionType\.TateChuYoko;/, /ca\.alignment = StyleRunAlignmentType\.icfTop;/,
    ]) assert.match(s, re);
});

test('OpenType features map to their members', async () => {
    const [s] = await scriptsFor([['set_character_attributes', {
        target: { selection: true }, ligatures: false, contextualAlternates: true, discretionaryLigatures: true, swash: true, stylisticAlternates: true,
        titlingAlternates: true, ordinals: true, fractions: true, ornaments: false, proportionalMetrics: true, connectionForms: true,
        figureStyle: 'tabular_oldstyle', openTypePosition: 'numerator', alternateGlyphs: 'jis04', kashidas: 'on',
    }]]);
    for (const re of [
        /ca\.ligature = false;/, /ca\.contextualLigature = true;/, /ca\.discretionaryLigature = true;/, /ca\.swash = true;/, /ca\.stylisticAlternates = true;/,
        /ca\.titling = true;/, /ca\.ordinals = true;/, /ca\.fractions = true;/, /ca\.ornaments = false;/, /ca\.proportionalMetrics = true;/, /ca\.connectionForms = true;/,
        /ca\.figureStyle = FigureStyleType\.TABULAROLDSTYLE;/, /ca\.openTypePosition = FontOpenTypePositionOption\.NUMERATOR;/,
        /ca\.alternateGlyphs = AlternateGlyphsForm\.JIS04FORM;/, /ca\.kashidas = KashidasType\.KASHIDAS_ON;/,
    ]) assert.match(s, re);
    // The selected text is used when text is selected with the Type tool.
    assert.match(s, /sel\.typename === "TextRange"/);
});

test('character attributes are checked before a script runs', async () => {
    await refused('set_character_attributes', { target: frame }, /at least one character attribute/);
    await refused('set_character_attributes', { target: frame, size: 0 }, /'size' out of range/);
    await refused('set_character_attributes', { target: frame, capitalization: 'shouty' }, /Allowed: normal, all_caps/);
    await refused('set_character_attributes', { target: frame, warichuLines: 1.5 }, /whole number/);
    await refused('set_character_attributes', { target: frame, color: 'cmyk(0,0,0)' }, /takes 4 value/);
    await refused('set_character_attributes', { size: 12 }, /Choose the items/);
    await refused('set_character_attributes', { target: frame, size: 12, range: { start: -1 } }, /range\.start/);
});

test('adjust_text steps size, kerning and tracking, and runs only dialog-free commands', async () => {
    const [up, step, kern, clear, uniform, fit] = await scriptsFor([
        ['adjust_text', { target: frame, operation: 'size_up', amount: 3 }],
        ['adjust_text', { target: frame, operation: 'size_step_down' }],
        ['adjust_text', { target: frame, operation: 'kern_tighter' }],
        ['adjust_text', { target: frame, operation: 'clear_tracking' }],
        ['adjust_text', { target: frame, operation: 'uniform_type' }],
        ['adjust_text', { target: frame, operation: 'fit_headline', range: { start: 0, length: 1 } }],
    ]);
    assert.match(up, /c\.characterAttributes\.size = Math\.min\(1296, c\.characterAttributes\.size \+ 3\);/);
    assert.match(step, /app\.executeMenuCommand\("sizeStepDown"\);/);
    assert.match(kern, /c\.kerning = c\.kerning - 20;/);
    assert.match(clear, /tr\.characterAttributes\.tracking = 0;/);
    assert.match(uniform, /horizontalScale = 100; tr\.characterAttributes\.verticalScale = 100;/);
    assert.match(fit, /ranges\[i\]\.select\(\);\s+app\.executeMenuCommand\("fitHeadline"\);/);
    await refused('adjust_text', { target: frame, operation: 'size_step_up', range: { start: 0 } }, /whole text frames/);
    await refused('adjust_text', { target: frame, operation: 'embiggen' }, /Allowed: size_up/);
    await refused('adjust_text', { target: frame, operation: 'size_up', amount: -1 }, /'amount' out of range/);
});

test('paragraph attributes cover indents, hyphenation, justification and composers', async () => {
    const [s, single] = await scriptsFor([
        ['set_paragraph_attributes', {
            target: frame, paragraphs: { start: 1 }, justification: 'FULLJUSTIFYLASTLINELEFT', leftIndent: 12, firstLineIndent: -6, spaceAfter: 4,
            hyphenate: true, wordsLongerThan: 6, afterFirst: 2, beforeLast: 3, hyphenLimit: 2, hyphenationZone: 36, hyphenateCapitalizedWords: false,
            hyphenationPreference: 0.25, wordSpacing: { minimum: 80, desired: 100, maximum: 133 }, letterSpacing: { desired: 0 },
            glyphScaling: { minimum: 98, maximum: 102 }, autoLeadingAmount: 120, singleWordJustification: 'CENTER', romanHangingPunctuation: true,
            leadingType: 'top_to_top', kinsoku: 'Hard', kinsokuType: 'push_out_only', mojikumi: 'None', burasagari: 'forced', bunriKinshi: true,
            kurikaeshiMojiShori: false, kashidaWidth: 'medium', composer: 'middle_eastern_single_line',
        }],
        ['set_paragraph_attributes', { target: frame, composer: 'every_line' }],
    ]);
    assert.match(s, /__paraRanges\(doc, \{"ids":\["frame-1"\]\}, \{"start":1,"length":null\}\)/);
    for (const re of [
        /pa\.justification = Justification\.FULLJUSTIFYLASTLINELEFT;/, /pa\.leftIndent = 12;/, /pa\.firstLineIndent = -6;/, /pa\.spaceAfter = 4;/,
        /pa\.hyphenation = true;/, /pa\.minimumHyphenatedWordSize = 6;/, /pa\.minimumBeforeHyphen = 2;/, /pa\.minimumAfterHyphen = 3;/,
        /pa\.maximumConsecutiveHyphens = 2;/, /pa\.hyphenationZone = 36;/, /pa\.hyphenateCapitalizedWords = false;/, /pa\.hyphenationPreference = 0\.25;/,
        /pa\.minimumWordSpacing = 80;\s+pa\.desiredWordSpacing = 100;\s+pa\.maximumWordSpacing = 133;/, /pa\.desiredLetterSpacing = 0;/,
        /pa\.minimumGlyphScaling = 98;\s+pa\.maximumGlyphScaling = 102;/, /pa\.autoLeadingAmount = 120;/, /pa\.singleWordJustification = Justification\.CENTER;/,
        /pa\.romanHanging = true;/, /pa\.leadingType = AutoLeadingType\.TOPTOTOP;/, /pa\.kinsoku = "Hard";/, /pa\.kinsokuOrder = KinsokuOrderEnum\.PUSHOUTONLY;/,
        /pa\.mojikumi = "None";/, /pa\.burasagariType = BurasagariTypeEnum\.Forced;/, /pa\.bunriKinshi = true;/, /pa\.kurikaeshiMojiShori = false;/,
        /pa\.kashidaWidth = KashidaWidthType\.kashidaMedium;/, /pa\.everyLineComposer = false;\s+pa\.composerEngine = ComposerEngineType\.optycaComposer;/,
    ]) assert.match(s, re);
    assert.match(single, /pa\.everyLineComposer = true;\s+if \(pa\.composerEngine == ComposerEngineType\.optycaComposer\) pa\.composerEngine = ComposerEngineType\.latinCJKComposer;/);
    await refused('set_paragraph_attributes', { target: frame }, /at least one paragraph attribute/);
    await refused('set_paragraph_attributes', { target: frame, hyphenationPreference: 2 }, /'hyphenationPreference' out of range/);
    await refused('set_paragraph_attributes', { target: frame, glyphScaling: { desired: 300 } }, /'glyphScaling\.desired' out of range/);
    await refused('set_paragraph_attributes', { target: frame, composer: 'world_ready' }, /Allowed: single_line/);
});

test('tab stops are built as TabStopInfo objects, sorted, with Repeat Tab', async () => {
    const [s, clear] = await scriptsFor([
        ['set_tab_stops', { target: frame, stops: [{ position: 144, alignment: 'decimal', decimalCharacter: ',' }, { position: 72, alignment: 'center', leader: '. ' }], repeat: 2 }],
        ['set_tab_stops', { target: frame, stops: [] }],
    ]);
    const stops = [...s.matchAll(/t\.position = (\d+); t\.alignment = TabStopAlignment\.(\w+); t\.leader = ("[^"]*"); t\.decimalCharacter = ("[^"]*")/g)]
        .map((m) => [Number(m[1]), m[2], JSON.parse(m[3]), JSON.parse(m[4])]);
    assert.deepEqual(stops, [[72, 'Center', '. ', '.'], [144, 'Decimal', '', ','], [216, 'Decimal', '', ','], [288, 'Decimal', '', ',']]);
    assert.match(s, /ranges\[i\]\.paragraphAttributes\.tabStops = __makeTabs\(\);/);
    assert.match(clear, /var out = \[\], t;\s+return out;/);
    await refused('set_tab_stops', { target: frame }, /'stops' must be a list/);
    await refused('set_tab_stops', { target: frame, stops: [{ position: 10, alignment: 'justify' }] }, /Allowed: left, center, right, decimal/);
    await refused('set_tab_stops', { target: frame, stops: [{ position: 10, leader: '123456789' }] }, /at most 8 characters/);
    await refused('set_tab_stops', { target: frame, stops: [{ position: 10, decimalCharacter: '..' }] }, /one character/);
    await refused('set_tab_stops', { target: frame, stops: [], repeat: 3 }, /at least one stop/);
});

test('styles: create, edit, delete, apply, clear overrides and load', async () => {
    const file = path.join(home, 'Documents', 'brand.ai');
    const [create, edit, del, apply, clearChars, clearParas, load] = await scriptsFor([
        ['create_text_style', { kind: 'paragraph', name: 'Body', from: frame, apply: true, character: { size: 10 }, paragraph: { spaceAfter: 6 } }],
        ['edit_text_style', { kind: 'character', name: 'Emphasis', newName: 'Strong', reset: true, character: { underline: true } }],
        ['delete_text_styles', { kind: 'character', names: ['Strong', 'Old'] }],
        ['apply_text_style', { kind: 'character', name: 'Strong', target: frame, range: { start: 0, length: 4 }, clearOverrides: true }],
        ['apply_text_style', { kind: 'character', target: frame }],
        ['apply_text_style', { kind: 'paragraph', target: frame, paragraphs: { start: 0, length: 2 } }],
        ['load_text_styles', { filePath: file, kind: 'paragraph' }],
    ]);
    assert.match(create, /var st = __styles\(doc, "paragraph"\)\.add\("Body"\);/);
    assert.match(create, /st\.characterAttributes\.size = 10;\s+st\.paragraphAttributes\.spaceAfter = 6;/);
    assert.match(create, /st\.applyTo\(src\[i\], false\);/);
    assert.match(create, /st\.paragraphAttributes\[pm\[p\]\] = pv;/);
    assert.match(edit, /var st = __style\(doc, "character", "Emphasis"\);\s+st\.clear\(\);\s+st\.characterAttributes\.underline = true;\s+st\.name = "Strong";/);
    assert.match(del, /s\.remove\(\);/);
    assert.match(apply, /st\.applyTo\(ranges\[i\], true\);/);
    assert.match(clearChars, /runs\[j\]\.characterStyles\[0\]\.applyTo\(runs\[j\], true\);/);
    assert.match(clearParas, /ps\[j\]\.paragraphStyles\[0\]\.applyTo\(ps\[j\], true\);/);
    assert.match(load, /doc\.importParagraphStyles\(f\);/);
    assert.doesNotMatch(load, /importCharacterStyles/);

    await refused('create_text_style', { kind: 'character', name: 'X', paragraph: { leftIndent: 4 } }, /character attributes only/);
    await refused('create_text_style', { kind: 'paragraph', name: '' }, /style name/);
    await refused('create_text_style', { kind: 'paragraph', name: 'X', apply: true }, /apply needs from/);
    await refused('edit_text_style', { kind: 'paragraph', name: 'Body' }, /Give newName, reset/);
    await refused('edit_text_style', { kind: 'character', name: 'Strong', character: { fontStyle: 'Bold' } }, /cannot hold character\.fontStyle/);
    await refused('delete_text_styles', { kind: 'character', names: [] }, /at least one style/);
    await refused('apply_text_style', { kind: 'paragraph', name: 'Body', target: frame, range: { start: 0 } }, /take paragraphs, not range/);
    await refused('apply_text_style', { kind: 'glyph', name: 'Body', target: frame }, /Allowed: character, paragraph/);
    await refused('load_text_styles', { filePath: path.join(home, 'Documents', 'styles.txt') }, /Illustrator file/);
    await refused('load_text_styles', { filePath: '/etc/brand.ai' }, /outside|allowed|not allowed/i);
});

test('text frame options set Area Type Options, conversion, resizing and anti-aliasing', async () => {
    const [s, point] = await scriptsFor([
        ['set_text_frame_options', {
            target: frame, convertTo: 'area', width: 200, height: 100, rows: 2, rowGutter: 6, columns: 3, columnGutter: 12, inset: 4,
            firstBaseline: 'cap_height', firstBaselineMin: 2, textFlow: 'by_columns', opticalMarginAlignment: true, antiAliasing: 'crisp',
        }],
        ['set_text_frame_options', { target: frame, convertTo: 'point' }],
    ]);
    for (const re of [
        /f = f\.convertPointObjectToAreaObject\(\);/, /f\.textPath\.width = __len\(doc, 200\);/, /f\.textPath\.height = __len\(doc, 100\);/,
        /f\.rowCount = 2;/, /f\.rowGutter = __len\(doc, 6\);/, /f\.columnCount = 3;/, /f\.columnGutter = __len\(doc, 12\);/, /f\.spacing = __len\(doc, 4\);/,
        /f\.firstBaseline = FirstBaselineType\.BASELINECAPHEIGHT;/, /f\.firstBaselineMin = __len\(doc, 2\);/, /f\.flowLinksHorizontally = false;/,
        /f\.opticalAlignment = true;/, /f\.antialias = TextAntialias\.CRISP;/,
    ]) assert.match(s, re);
    assert.match(point, /f = f\.convertAreaObjectToPointObject\(\);/);
    await refused('set_text_frame_options', { target: frame }, /convertTo or at least one option/);
    await refused('set_text_frame_options', { target: frame, rows: 0 }, /'rows' out of range/);
    await refused('set_text_frame_options', { target: frame, firstBaseline: 'baseline' }, /Allowed: ascent/);
});

test('threading links in the order given and releases through dialog-free commands', async () => {
    const [link, release, remove] = await scriptsFor([
        ['thread_text_frames', { target: { ids: ['a', 'b', 'c'] }, operation: 'link' }],
        ['thread_text_frames', { target: { ids: ['b'] }, operation: 'release' }],
        ['thread_text_frames', { target: { ids: ['a'] }, operation: 'remove' }],
    ]);
    assert.match(link, /cur\.nextFrame = nx;/);
    assert.match(link, /characters\.add\("\\r"\)/);
    assert.match(release, /app\.executeMenuCommand\("releaseThreadedTextSelection"\);/);
    assert.match(remove, /app\.executeMenuCommand\("removeThreading"\);/);
    const [plain] = await scriptsFor([['thread_text_frames', { target: { ids: ['a', 'b'] }, operation: 'link', separateParagraphs: false }]]);
    assert.doesNotMatch(plain, /characters\.add/);
    await refused('thread_text_frames', { target: frame, operation: 'unlink' }, /Allowed: link, release, remove/);
});

test('reading tools are read-only and destructive ones are marked', async () => {
    const { toolDefinitions } = await import('../src/server.js');
    const byName = Object.fromEntries(toolDefinitions.map((t) => [t.name, t.annotations]));
    for (const n of ['get_text_attributes', 'list_text_styles']) assert.equal(byName[n].readOnlyHint, true, n);
    for (const n of ['delete_text_styles', 'load_text_styles', 'apply_text_style']) assert.equal(byName[n].destructiveHint, true, n);
    for (const n of ['set_character_attributes', 'set_paragraph_attributes', 'set_tab_stops']) assert.equal(byName[n].idempotentHint, true, n);
    const [read] = await scriptsFor([['get_text_attributes', { target: frame, range: { start: 0, length: 1 }, limit: 5 }]]);
    assert.match(read, /r\.tabStops = __tabs\(para\.paragraphAttributes\);/);
});
