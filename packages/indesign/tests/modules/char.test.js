/**
 * Character formatting module (src/tools/character.js): the scripts carry the
 * expected object-model statements, and bad arguments are refused before
 * anything runs.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor } from './helpers.js';
import { TYPE_COMMANDS, SPECIAL_CHARACTERS, GLYPH_PANEL_COMMANDS, codePoint } from '../../src/tools/character.js';

const T = { ids: [7] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const refuses = (name, args, re) => assert.throws(() => tool(name).handler(args), re);

await test('text choice: frames, stories, selection, ranges', async () => {
    const s = await one('change_case', { text: { ids: [7], storyIds: [3], selection: true, wholeStory: true, start: 2, end: 9 }, mode: 'TITLECASE' });
    assert.match(s, /"ids":\[7\],"storyIds":\[3\],"selection":true,"wholeStory":true,"start":2,"end":9,"paragraphs":null/);
    assert.match(s, /__text\(targets\[i\]\)\.changecase\(ChangecaseMode\.TITLECASE\)/);
    const p = await one('change_case', { text: { storyIds: [3], paragraphs: [1, 4] }, mode: 'UPPERCASE' });
    assert.match(p, /"paragraphs":\[1,4\]/);
    refuses('change_case', { text: {}, mode: 'UPPERCASE' }, /Choose the text/);
    refuses('change_case', { text: { ids: [1], start: 5, end: 2 }, mode: 'UPPERCASE' }, /end comes before/);
    refuses('change_case', { text: { ids: [1], start: 0, paragraphs: [0, 1] }, mode: 'UPPERCASE' }, /not both/);
    refuses('change_case', { text: { ids: [1], paragraphs: [3, 1] }, mode: 'UPPERCASE' }, /last comes before first/);
    refuses('change_case', { text: { ids: ['1; app.quit()'] }, mode: 'UPPERCASE' }, /Invalid index/);
    refuses('change_case', { text: T, mode: 'SHOUTING' }, /Allowed: UPPERCASE/);
});

await test('set_character_attributes writes Character panel, OpenType, CJK and World-Ready properties', async () => {
    const s = await one('set_character_attributes', {
        text: T,
        character: { fontName: 'Minion Pro\\tBold', pointSize: 11, autoLeading: true, kerningMethod: 'optical', tracking: -10, capitalization: 'CAP_TO_SMALL_CAP', position: 'OT_SUPERSCRIPT', strikethrough: true, language: 'English: UK', fillColor: '#ff0000', strokeJoin: 'ROUND_END_JOIN', designAxes: [500, 90] },
        opentype: { fractions: true, stylisticSets: [1, 2, 20], figureStyle: 'TABULAR_OLDSTYLE', positionalForm: 'CALCULATE' },
        cjk: { ruby: true, rubyString: 'かな', kentenKind: 'KENTEN_SESAME_DOT', mojikumi: 'LINE_END_ALL_ONE_EM_ENUM', kinsokuSet: 'Strict', tateChuYoko: true, tsume: 50 },
        worldReady: { characterDirection: 'RIGHT_TO_LEFT_DIRECTION', digitsType: 'HINDI_DIGITS', kashidas: 'KASHIDAS_OFF' },
    });
    for (const re of [
        /__fontOf\("Minion Pro\\tBold"\)/, /t\.pointSize = 11;/, /t\.leading = Leading\.AUTO;/, /t\.kerningMethod = "\$ID\/Optical";/,
        /t\.tracking = -10;/, /t\.capitalization = Capitalization\.CAP_TO_SMALL_CAP;/, /t\.position = Position\.OT_SUPERSCRIPT;/,
        /t\.strikeThru = true;/, /app\.languagesWithVendors\.itemByName\("English: UK"\)/, /__swatch\(doc, \{"kind":"rgb","v":\[255,0,0\]\}\)/,
        /t\.endJoin = OutlineJoin\.ROUND_END_JOIN;/, /t\.designAxes = \[500, 90\];/, /t\.otfFraction = true;/,
        new RegExp(`t\\.otfStylisticSets = ${1 | 2 | (1 << 19)};`), /t\.otfFigureStyle = OTFFigureStyle\.TABULAR_OLDSTYLE;/,
        /t\.positionalForm = PositionalForms\.CALCULATE;/, /t\.rubyFlag = true;/, /t\.kentenKind = KentenCharacter\.KENTEN_SESAME_DOT;/,
        /MojikumiTableDefaults\["LINE_END_ALL_ONE_EM_ENUM"\]/, /doc\.kinsokuTables\.itemByName\("Strict"\)/, /t\.tatechuyoko = true;/,
        /t\.tsume = 50;/, /t\.characterDirection = CharacterDirectionOptions\.RIGHT_TO_LEFT_DIRECTION;/, /t\.digitsType = DigitsTypeOptions\.HINDI_DIGITS;/,
        /t\.kashidas = KashidasOptions\.KASHIDAS_OFF;/,
    ]) assert.match(s, re);
});

await test('set_character_attributes refuses bad attributes', () => {
    const set = (g) => ({ text: T, ...g });
    refuses('set_character_attributes', { text: T }, /at least one attribute/);
    refuses('set_character_attributes', set({ character: { boldness: 3 } }), /Unknown character attribute 'boldness'/);
    refuses('set_character_attributes', set({ character: { pointSize: 0 } }), /out of range/);
    refuses('set_character_attributes', set({ character: { pointSize: '12; app.quit()' } }), /Invalid number/);
    refuses('set_character_attributes', set({ character: { capitalization: 'TITLE' } }), /Allowed: NORMAL/);
    refuses('set_character_attributes', set({ character: { noBreak: 'yes' } }), /true or false/);
    refuses('set_character_attributes', set({ character: { autoLeading: false } }), /only takes true/);
    refuses('set_character_attributes', set({ opentype: { stylisticSets: [21] } }), /Invalid index/);
    refuses('set_character_attributes', set({ opentype: { stylisticSets: [0] } }), /numbered 1-20/);
    refuses('set_character_attributes', set({ cjk: { warichuLines: 1.5 } }), /whole number/);
    refuses('set_character_attributes', set({ character: { fillColor: '' } }), /is empty/);
    refuses('set_character_attributes', set({ worldReady: 'RTL' }), /must be an object/);
});

await test('apply_type_command: every command builds, steps take amounts, toggles read the first character', async () => {
    for (const command of Object.keys(TYPE_COMMANDS)) await one('apply_type_command', { text: T, command });
    const up = await one('apply_type_command', { text: T, command: 'increase_size', amount: 4 });
    assert.match(up, /amt = 4;/);
    assert.match(up, /__step\(e, "pointSize", amt, 0\.1, 1296\);/);
    assert.match(await one('apply_type_command', { text: T, command: 'decrease_kerning_tracking' }), /amt = 20;[\s\S]*"kerningValue", -amt[\s\S]*"tracking", -amt/);
    assert.match(await one('apply_type_command', { text: T, command: 'toggle_small_caps' }), /__first\(e\)\.capitalization == Capitalization\.SMALL_CAPS/);
    assert.match(await one('apply_type_command', { text: T, command: 'align_towards_spine' }), /justification = Justification\.TO_BINDING_SIDE;/);
    assert.match(await one('apply_type_command', { text: T, command: 'toggle_align_to_grid' }), /GridAlignment\.ALIGN_BASELINE/);
    assert.match(await one('apply_type_command', { text: T, command: 'world_ready_paragraph_composer' }), /composer = "\$ID\/HL Composer Optyca";/);
    assert.match(await one('apply_type_command', { text: T, command: 'set_up_right_to_left' }), /RIGHT_TO_LEFT_DIRECTION[\s\S]*HL Composer Optyca/);
    assert.match(await one('apply_type_command', { text: T, command: 'reset_indents' }), /leftIndent = 0; r\.firstLineIndent = 0; r\.rightIndent = 0;/);
    refuses('apply_type_command', { text: T, command: 'bold', amount: 2 }, /takes no amount/);
    refuses('apply_type_command', { text: T, command: 'increase_size', amount: 0 }, /out of range/);
    refuses('apply_type_command', { text: T, command: 'shout' }, /Allowed: increase_size/);
});

await test('insert_special_character inserts SpecialCharacters or a code point, before, after or replacing', async () => {
    for (const character of SPECIAL_CHARACTERS) await one('insert_special_character', { text: T, character });
    const s = await one('insert_special_character', { text: T, character: 'RIGHT_INDENT_TAB', at: 'replace', count: 3 });
    assert.match(s, /characters\.itemByRange\(e\.start, e\.end - 1\)\.remove\(\)/);
    assert.match(s, /for \(var k = 0; k < 3; k\+\+\) e\.story\.insertionPoints\[pos\]\.contents = SpecialCharacters\.RIGHT_INDENT_TAB;/);
    assert.match(s, /targets\.sort/);
    const g = await one('insert_special_character', { text: T, glyph: { unicode: 'U+1F600', fontName: 'Apple Color Emoji' }, at: 'start' });
    assert.match(g, /contents = "\\ud83d\\ude00";/);
    assert.match(g, /pos = e\.start/);
    assert.match(g, /appliedFont = font/);
    assert.equal(codePoint('2022'), 0x2022);
    assert.equal(codePoint(0x41), 0x41);
    refuses('insert_special_character', { text: T }, /either character or glyph/);
    refuses('insert_special_character', { text: T, character: 'EM_DASH', glyph: { unicode: '2014' } }, /either character or glyph/);
    refuses('insert_special_character', { text: T, glyph: { unicode: '"; app.quit(); "' } }, /hexadecimal code point/);
    refuses('insert_special_character', { text: T, glyph: { unicode: 'D800' } }, /not a valid Unicode/);
    refuses('insert_special_character', { text: T, glyph: { fontName: 'Arial' } }, /glyph needs unicode/);
    refuses('insert_special_character', { text: T, character: 'AUTO_PAGE_NUMBER' }, /Allowed: COLUMN_BREAK/);
    refuses('insert_special_character', { text: T, character: 'EM_DASH', count: 0 }, /at least 1/);
});

await test('run_glyphs_panel_command invokes listed menu actions only', async () => {
    for (const [command, [id]] of Object.entries(GLYPH_PANEL_COMMANDS)) {
        const s = await one('run_glyphs_panel_command', { command });
        assert.match(s, new RegExp(`app\\.menuActions\\.itemByID\\(${id}\\)`));
        assert.match(s, /if \(!ma\.enabled\) throw/);
    }
    refuses('run_glyphs_panel_command', { command: 'new_glyph_set' }, /Allowed: insert_recent_glyph_1/);
});

await test('set_story_options and set_type_preferences', async () => {
    const s = await one('set_story_options', { text: T, opticalMarginAlignment: true, opticalMarginSize: 14, storyDirection: 'RIGHT_TO_LEFT_DIRECTION' });
    assert.match(s, /sp\.opticalMarginAlignment = true;/);
    assert.match(s, /sp\.opticalMarginSize = 14;/);
    assert.match(s, /sp\.storyDirection = StoryDirectionOptions\.RIGHT_TO_LEFT_DIRECTION;/);
    refuses('set_story_options', { text: T }, /Give opticalMarginAlignment/);
    const p = await one('set_type_preferences', { showAlternates: false, fontChangeLocking: true, harfbuzzShaping: true, scope: 'document' });
    assert.match(p, /app\.typeContextualUiPrefs\.showAlternatesUi = false;/);
    assert.match(p, /app\.fontLockingPreferences\.fontChangeLocking = true;/);
    assert.match(p, /var tp = __doc\(\)\.textPreferences;/);
    assert.match(p, /tp\.shapeIndicAndLatinWithHarbuzz = true;/);
    refuses('set_type_preferences', { scope: 'book' }, /Allowed: application/);
});

await test('manage_fonts lists, replaces, rescans and recomposes', async () => {
    assert.match(await one('manage_fonts', { action: 'list', scope: 'application', missingOnly: true }), /app\.fonts\.everyItem\(\)\.getElements\(\)/);
    const r = await one('manage_fonts', { action: 'replace', from: 'Arial\tBold', to: 'Minion Pro\tSemibold' });
    assert.match(r, /app\.findTextPreferences\.appliedFont = "Arial";/);
    assert.match(r, /app\.findTextPreferences\.fontStyle = "Bold";/);
    assert.match(r, /app\.changeTextPreferences\.fontStyle = "Semibold";/);
    assert.match(r, /doc\.changeText\(\)/);
    assert.match(r, /app\.findTextPreferences = NothingEnum\.NOTHING;/);
    assert.match(await one('manage_fonts', { action: 'update_missing' }), /app\.updateFonts\(\);/);
    assert.match(await one('manage_fonts', { action: 'recompose' }), /doc\.recompose\(\);/);
    refuses('manage_fonts', { action: 'replace', from: 'Arial' }, /needs from and to/);
    refuses('manage_fonts', { action: 'delete' }, /Allowed: list/);
});

await test('manage_cjk_sets builds composite fonts, mojikumi and kinsoku sets', async () => {
    const c = await one('manage_cjk_sets', { kind: 'composite_font', action: 'create', name: 'Mix', entries: [{ name: 'Half-width Roman', fontName: 'Minion Pro\tRegular', relativeSize: 105 }] });
    assert.match(c, /doc\.compositeFonts\.add\(\{ name: "Mix" \}\)/);
    assert.match(c, /compositeFontEntries\.itemByName\("Half-width Roman"\)/);
    assert.match(c, /en\.relativeSize = 105;/);
    const m = await one('manage_cjk_sets', { kind: 'mojikumi', action: 'create', name: 'Tight', basedOn: 'LINE_END_ALL_ONE_HALF_EM_ENUM', akiOverrides: [{ targetClass: 1, sideClass: 3, sideIsAfterTarget: true, desired: 0.5 }] });
    assert.match(m, /doc\.mojikumiTables\.add\("Tight", \{ basedOnMojikumiSet: MojikumiTableDefaults\.LINE_END_ALL_ONE_HALF_EM_ENUM \}\)/);
    assert.match(m, /overrideMojikumiAkiList = \[\[1, 3, true, 0, 0\.5, 0, 0, false\]\]/);
    const k = await one('manage_cjk_sets', { kind: 'kinsoku', action: 'update', name: 'Strict', cantBeginLineChars: '、。' });
    assert.match(k, /it\.cantBeginLineChars = "、。";/);
    refuses('manage_cjk_sets', { kind: 'mojikumi', action: 'create' }, /Give the mojikumi name/);
    refuses('manage_cjk_sets', { kind: 'kinsoku', action: 'update', name: 'Strict' }, /Nothing to update/);
    refuses('manage_cjk_sets', { kind: 'composite_font', action: 'create', name: 'X', entries: [{ fontName: 'A' }] }, /needs a name/);
    refuses('manage_cjk_sets', { kind: 'mojikumi', action: 'create', name: 'X', basedOn: 'LOOSE' }, /Allowed: LINE_END_ALL_ONE_EM_ENUM/);
});

await test('set_tab_stops adds, replaces, deletes, clears and repeats stops', async () => {
    const s = await one('set_tab_stops', { text: T, action: 'replace', tabs: [{ position: 25, alignment: 'CHARACTER_ALIGN', leader: '. ', alignOn: ',' }] });
    assert.match(s, /p\.tabStops\[k\]\.remove\(\)/);
    assert.match(s, /p\.tabStops\.add\(\{ position: 25, alignment: TabStopAlignment\.CHARACTER_ALIGN, leader: "\. ", alignmentCharacter: "," \}\)/);
    assert.match(await one('set_tab_stops', { text: T, action: 'delete', positions: [25] }), /var gone = \[25\];/);
    const r = await one('set_tab_stops', { text: T, action: 'repeat' });
    assert.match(r, /__columnWidth\(p\) - p\.rightIndent/);
    assert.match(await one('set_tab_stops', { text: T, action: 'repeat', repeatIndex: 1, until: 120 }), /var limit = 120;/);
    refuses('set_tab_stops', { text: T, action: 'add' }, /Give 'tabs'/);
    refuses('set_tab_stops', { text: T, action: 'add', tabs: [{ position: 10, alignOn: '.,' }] }, /one character/);
    refuses('set_tab_stops', { text: T, action: 'add', tabs: [{ position: 10, leader: '123456789' }] }, /longer than 8/);
    refuses('set_tab_stops', { text: T, action: 'delete' }, /Give 'positions'/);
});

await test('set_grep_styles adds GREP styles to paragraphs and paragraph styles', async () => {
    const s = await one('set_grep_styles', { text: T, paragraphStyle: 'Body', action: 'replace', styles: [{ expression: '\\d+%', characterStyle: 'Figures' }] });
    assert.match(s, /__charStyle\(doc, "Figures"\)/);
    assert.match(s, /o\.nestedGrepStyles\.add\(\{ grepExpression: "\\\\d\+%", appliedCharacterStyle: __g0 \}\)/);
    assert.match(s, /all\[i\]\.name === "Body"/);
    assert.doesNotMatch(await one('set_grep_styles', { paragraphStyle: 'Body', action: 'list' }), /__texts\(/);
    refuses('set_grep_styles', { action: 'list' }, /Choose text, a paragraphStyle/);
    refuses('set_grep_styles', { text: T, action: 'add', styles: [{ characterStyle: 'X' }] }, /needs an expression/);
    refuses('set_grep_styles', { text: T, action: 'add', styles: [{ expression: 'x' }] }, /needs a characterStyle/);
});

await test('set_bullets_and_numbering sets lists and runs list commands', async () => {
    const s = await one('set_bullets_and_numbering', {
        text: T, listType: 'NUMBERED_LIST', list: 'Figures', level: 2, numberExpression: '^1.^#^t', numberFormat: 'UPPER_ROMAN', mode: 'start_at', startAt: 5,
        restartAfter: { policy: 'RANGE_OF_LEVELS', lowerLevel: 1, upperLevel: 1 }, bullet: { unicode: '2022', fontName: 'Wingdings' }, numberAlignment: 'RIGHT_ALIGN',
        leftIndent: 6, firstLineIndent: -6, tabPosition: 6, characterStyle: 'Num',
    });
    for (const re of [
        /p\.bulletsAndNumberingListType = ListType\.NUMBERED_LIST;/, /doc\.numberingLists\.itemByName\("Figures"\)/, /p\.numberingLevel = 2;/,
        /p\.numberingExpression = "\^1\.\^#\^t";/, /p\.numberingFormat = NumberingStyle\.UPPER_ROMAN;/, /p\.numberingContinue = false;/,
        /p\.numberingStartAt = 5;/, /numberingPolicy = RestartPolicy\.RANGE_OF_LEVELS;/, /BulletCharacterType\.UNICODE_WITH_FONT;/,
        /characterValue = 8226;/, /bulletsFont = "Wingdings";/, /p\.numberingAlignment = ListAlignment\.RIGHT_ALIGN;/, /p\.firstLineIndent = -6;/,
        /p\.tabStops\.add\(\{ position: 6, alignment: TabStopAlignment\.LEFT_ALIGN \}\)/, /p\.bulletsCharacterStyle = __cs;/,
    ]) assert.match(s, re);
    assert.match(await one('set_bullets_and_numbering', { text: T, action: 'restart', startAt: 3 }), /__paras\(targets\[i\]\)\[0\][\s\S]*p\.numberingStartAt = 3;/);
    assert.match(await one('set_bullets_and_numbering', { text: T, action: 'continue' }), /p\.numberingContinue = true;/);
    assert.match(await one('set_bullets_and_numbering', { text: T, action: 'convert_to_text' }), /p\.convertBulletsAndNumberingToText\(\);/);
    refuses('set_bullets_and_numbering', { text: T }, /at least one bullets/);
    refuses('set_bullets_and_numbering', { text: T, action: 'restart', listType: 'BULLET_LIST' }, /takes no formatting options/);
    refuses('set_bullets_and_numbering', { text: T, bullet: { glyphId: 5 } }, /needs bullet\.fontName/);
    refuses('set_bullets_and_numbering', { text: T, bullet: {} }, /needs unicode/);
    refuses('set_bullets_and_numbering', { text: T, level: 10 }, /out of range/);
});

await test('manage_numbering_lists defines lists', async () => {
    assert.match(await one('manage_numbering_lists', { action: 'create', name: 'Tables', continueAcrossStories: true }), /doc\.numberingLists\.add\("Tables", true, false, \{\}\)/);
    assert.match(await one('manage_numbering_lists', { action: 'update', name: 'Tables', continueAcrossDocuments: true }), /nl\.continueNumbersAcrossDocuments = true;/);
    assert.match(await one('manage_numbering_lists', { action: 'delete', name: 'Tables', replaceWith: 'Figures' }), /nl\.remove\(rw\);/);
    refuses('manage_numbering_lists', { action: 'delete', name: 'Tables' }, /needs 'replaceWith'/);
    refuses('manage_numbering_lists', { action: 'update', name: 'Tables' }, /Nothing to update/);
    refuses('manage_numbering_lists', { action: 'create' }, /Give the list name/);
});

done();
