/**
 * Paragraph formatting tools (src/tools/paragraph.js): the scripts carry the
 * right object-model statements, and bad arguments are refused before
 * anything is sent to InDesign.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor } from './helpers.js';

const story = { storyIds: [7] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];

await test('text targets: stories, frames, selection, whole story and paragraph ranges', async () => {
    const s = await one('set_paragraph_formatting', { target: { frameIds: [3], selection: true, wholeStory: true, paragraphs: { start: 2, count: 3 } }, align: { alignment: 'CENTER_ALIGN' } });
    assert.match(s, /"storyIds":null,"frameIds":\[3\],"selection":true,"wholeStory":true,"start":2,"count":3/);
    assert.match(s, /ps\.itemByRange\(a, b\)/);
    assert.match(s, /doc\.stories\.itemByID/);
    assert.match(s, /item\.parentStory/);
});

await test('indents, spacing and alignment are sent with units and enums', async () => {
    const s = await one('set_paragraph_formatting', {
        target: story,
        indents: { left: 5, firstLine: -3, lastLineRight: 2, spaceBefore: 4, sameStyleSpacing: 'ignore', alignToGrid: 'baseline', firstLineOnlyToGrid: true },
        align: { alignment: 'AWAY_FROM_BINDING_SIDE', balanceRaggedLines: true, ignoreOpticalMargin: true, direction: 'right_to_left' },
    });
    for (const re of [
        /__set\(t, "leftIndent", "5mm"\)/, /__set\(t, "firstLineIndent", "-3mm"\)/, /__set\(t, "lastLineIndent", "2mm"\)/,
        /__set\(t, "spaceBefore", "4mm"\)/, /__set\(t, "sameParaStyleSpacing", Spacing\.SETIGNORE\)/,
        /__set\(t, "gridAlignment", GridAlignment\.ALIGN_BASELINE\)/, /__set\(t, "gridAlignFirstLineOnly", true\)/,
        /__set\(t, "justification", Justification\.AWAY_FROM_BINDING_SIDE\)/, /__set\(t, "balanceRaggedLines", true\)/,
        /__set\(t, "ignoreEdgeAlignment", true\)/, /ParagraphDirectionOptions\.RIGHT_TO_LEFT_DIRECTION/,
    ]) assert.match(s, re);
});

await test('justification, composer and hyphenation', async () => {
    const s = await one('set_paragraph_formatting', {
        target: story,
        justification: { wordSpacing: { minimum: 85, desired: 100, maximum: 120 }, autoLeading: 125, composer: 'world_ready_paragraph', singleWordJustification: 'full', kashidas: 'off' },
        hyphenation: { hyphenate: true, wordsLongerThan: 6, afterFirst: 3, beforeLast: 3, limit: 2, zone: 10, spacingVsHyphens: 7, capitalizedWords: false, lastWord: false, acrossColumns: false, style: 'aesthetic' },
    });
    assert.match(s, /__setRange\(t, \["minimumWordSpacing","desiredWordSpacing","maximumWordSpacing"\], \[85, 100, 120\]\)/);
    assert.match(s, /__set\(t, "composer", "\$ID\/HL Composer Optyca"\)/);
    assert.match(s, /SingleWordJustification\.FULLY_JUSTIFIED/);
    assert.match(s, /KashidasOptions\.KASHIDAS_OFF/);
    assert.match(s, /__set\(t, "hyphenationZone", "10mm"\)/);
    assert.match(s, /__set\(t, "hyphenWeight", 7\)/);
    assert.match(s, /__set\(t, "hyphenateLadderLimit", 2\)/);
    assert.match(s, /HyphenationStyleEnum\.HYPH_AESTHETIC/);
});

await test('keep options and span columns', async () => {
    const s = await one('set_paragraph_formatting', {
        target: story,
        keep: { withPrevious: true, withNextLines: 2, linesTogether: true, allLines: false, startLines: 2, endLines: 3, start: 'next_odd_page' },
        columns: { layout: 'split_column', count: 3, insideGutter: 4, outsideGutter: 1, spaceBefore: 2, spaceAfter: 2 },
    });
    for (const re of [
        /"keepWithPrevious", true/, /"keepWithNext", 2/, /"keepAllLinesTogether", false/, /"keepFirstLines", 2/, /"keepLastLines", 3/,
        /StartParagraph\.NEXT_ODD_PAGE/, /SpanColumnTypeOptions\.SPLIT_COLUMNS/, /"spanSplitColumnCount", 3/,
        /"splitColumnInsideGutter", "4mm"/, /"spanColumnMinSpaceBefore", "2mm"/,
    ]) assert.match(s, re);
    const all = await one('set_paragraph_formatting', { target: story, columns: { layout: 'span_columns', count: 'all' } });
    assert.match(all, /SpanColumnCountOptions\.ALL/);
});

await test('rules, borders and shading resolve swatches and stroke styles once', async () => {
    const s = await one('set_paragraph_formatting', {
        target: story,
        ruleAbove: { on: true, weight: 2, type: 'Thick - Thin', color: '#112233', gapColor: 'Paper', offset: 1.5, leftIndent: 2, keepInFrame: true, width: 'text' },
        ruleBelow: { on: false },
        border: { on: true, weights: { top: 1, bottom: 2 }, corners: { option: 'rounded', radius: 3, bottomRight: { option: 'fancy' } }, cap: 'round', join: 'bevel', topEdge: 'baseline', bottomEdge: 'descent', displayIfSplits: false, mergeConsecutive: true },
        shading: { on: true, color: 'Black', tint: 15, offsets: { left: 2, right: 2 }, clipToFrame: true, suppressPrinting: true, width: 'column' },
    });
    assert.match(s, /var __s\d+ = __stroke\(doc, "Thick - Thin"\);/);
    assert.match(s, /var __c\d+ = __swatch\(doc, \{"kind":"rgb","v":\[17,34,51\]\}\);/);
    for (const re of [
        /"ruleAboveLineWeight", "2pt"/, /"ruleAboveOffset", "1\.5mm"/, /"ruleAboveLeftIndent", "2mm"/, /"keepRuleAboveInFrame", true/,
        /RuleWidth\.TEXT_WIDTH/, /"ruleBelow", false/, /"paragraphBorderTopLineWeight", "1pt"/, /"paragraphBorderBottomLineWeight", "2pt"/,
        /"paragraphBorderBottomRightCornerOption", CornerOptions\.FANCY_CORNER/, /"paragraphBorderTopLeftCornerRadius", "3mm"/,
        /EndCap\.ROUND_END_CAP/, /EndJoin\.BEVEL_END_JOIN/, /ParagraphBorderTopOriginEnum\.BASELINE_TOP_ORIGIN/,
        /ParagraphBorderBottomOriginEnum\.DESCENT_BOTTOM_ORIGIN/, /"mergeConsecutiveParaBorders", true/,
        /"paragraphShadingTint", 15/, /"paragraphShadingLeftOffset", "2mm"/, /"paragraphShadingClipToFrame", true/,
        /"paragraphShadingSuppressPrinting", true/, /ParagraphShadingWidthEnum\.COLUMN_WIDTH/,
    ]) assert.match(s, re);
});

await test('drop caps and nested styles are set paragraph by paragraph', async () => {
    const s = await one('set_paragraph_formatting', {
        target: story,
        dropCap: { lines: 3, characters: 2, characterStyle: 'Cap', alignLeftEdge: true, scaleForDescenders: true },
        nestedStyles: [{ characterStyle: 'Bold', delimiter: 'sentence' }, { characterStyle: 'Italic', characters: '—', repetition: 2, inclusive: false }],
        nestedLineStyles: [{ characterStyle: 'Caps', lines: 1 }],
    });
    assert.match(s, /"dropCapLines", 3/);
    assert.match(s, /__cstyle\(doc, "Cap"\)/);
    assert.match(s, /__bit\(p, 1, true\);/);
    assert.match(s, /__bit\(p, 2, true\);/);
    assert.match(s, /p\.nestedStyles\[__n\]\.remove\(\)/);
    assert.match(s, /p\.nestedStyles\.add\(\{ appliedCharacterStyle: __k\d+, delimiter: NestedStyleDelimiters\.SENTENCE, repetition: 1, inclusive: true \}\)/);
    assert.match(s, /delimiter: "—", repetition: 2, inclusive: false/);
    assert.match(s, /p\.nestedLineStyles\.add\(\{ appliedCharacterStyle: __k\d+, lineCount: 1 \}\)/);
    const clear = await one('set_paragraph_formatting', { target: story, nestedStyles: [] });
    assert.match(clear, /p\.nestedStyles\[__n\]\.remove\(\)/);
    assert.doesNotMatch(clear, /nestedStyles\.add/);
});

await test('caller text is quoted, never spliced into the script', async () => {
    const s = await one('set_paragraph_formatting', { target: story, ruleAbove: { type: 'x"); app.quit(); ("' }, dropCap: { characterStyle: 'a\\"b' } });
    assert.ok(!s.includes('app.quit(); ("'), 'raw quote reached the script');
    assert.match(s, /__stroke\(doc, "x\\"\); app\.quit\(\); \(\\""\)/);
});

await test('set_paragraph_formatting refuses bad arguments', () => {
    const h = tool('set_paragraph_formatting').handler;
    assert.throws(() => h({ target: {}, align: { alignment: 'LEFT_ALIGN' } }), /Choose the text/);
    assert.throws(() => h({ target: story }), /Nothing to set/);
    assert.throws(() => h({ target: story, align: { alignment: 'middle' } }), /Allowed: LEFT_ALIGN, CENTER_ALIGN/);
    assert.throws(() => h({ target: story, indents: { margin: 3 } }), /Unknown option 'indents\.margin'/);
    assert.throws(() => h({ target: story, indents: { left: '5mm' } }), /must be a number/);
    assert.throws(() => h({ target: story, indents: { spaceBefore: -1 } }), /out of range/);
    assert.throws(() => h({ target: story, keep: { withNextLines: 9 } }), /out of range/);
    assert.throws(() => h({ target: story, keep: { linesTogether: 'yes' } }), /true or false/);
    assert.throws(() => h({ target: story, hyphenation: { afterFirst: 2.5 } }), /whole number/);
    assert.throws(() => h({ target: story, justification: { wordSpacing: { minimum: 120, desired: 100 } } }), /minimum must not exceed desired/);
    assert.throws(() => h({ target: story, justification: { composer: 'fancy' } }), /Allowed: paragraph/);
    assert.throws(() => h({ target: story, columns: { count: 'some' } }), /or "all"/);
    assert.throws(() => h({ target: story, border: { weights: { middle: 1 } } }), /Unknown option 'border\.weights\.middle'/);
    assert.throws(() => h({ target: story, border: { corners: { option: 'wavy' } } }), /Allowed: none, rounded/);
    assert.throws(() => h({ target: story, ruleAbove: { color: '' } }), /is empty/);
    assert.throws(() => h({ target: story, ruleBelow: { keepInFrame: true } }), /Unknown option 'ruleBelow\.keepInFrame'/);
    assert.throws(() => h({ target: story, nestedStyles: [{ characterStyle: 'A', delimiter: 'comma' }] }), /Allowed: any_character/);
    assert.throws(() => h({ target: story, nestedStyles: [{ characterStyle: 'A', delimiter: 'tabs', characters: ',' }] }), /not both/);
    assert.throws(() => h({ target: story, nestedStyles: [{ delimiter: 'tabs' }] }), /character style name/);
    assert.throws(() => h({ target: story, nestedLineStyles: { characterStyle: 'A' } }), /must be a list/);
    assert.throws(() => h({ target: story, tabs: [] }), /Unknown option 'tabs'/);
    assert.throws(() => h({ target: { storyIds: [1.5] }, align: { alignment: 'LEFT_ALIGN' } }), /integers/);
    assert.throws(() => h({ target: { storyIds: [1], paragraphs: { start: -1 } }, align: { alignment: 'LEFT_ALIGN' } }), /out of range/);
});

await test('get_paragraph_formatting reads the chosen groups in mm and points', async () => {
    const s = await one('get_paragraph_formatting', { target: story, groups: ['ruleAbove', 'nestedStyles', 'ruleAbove'], maxParagraphs: 5 });
    assert.match(s, /\[\["ruleAbove","weight"\],"ruleAboveLineWeight","v",null,"pt"\]/);
    assert.match(s, /\[\["ruleAbove","offset"\],"ruleAboveOffset","v",null,"mm"\]/);
    assert.match(s, /MeasurementUnits\.POINTS/);
    assert.match(s, /p\.nestedLineStyles\[__m\]/);
    assert.doesNotMatch(s, /"leftIndent","v"/);
    assert.doesNotMatch(s, /"hyphenation"/);
    assert.equal(s.match(/"ruleAboveLineWeight"/g).length, 1, 'groups are read once');
    const all = await one('get_paragraph_formatting', { target: story });
    for (const p of ['leftIndent', 'hyphenWeight', 'keepWithNext', 'paragraphBorderTopLeftCornerOption', 'paragraphShadingSuppressPrinting', 'spanSplitColumnCount', 'dropcapDetail', 'composer']) {
        assert.ok(all.includes(`"${p}"`), p);
    }
    const h = tool('get_paragraph_formatting').handler;
    assert.throws(() => h({ target: story, groups: ['tabs'] }), /Allowed: indents/);
    assert.throws(() => h({ target: story, groups: [] }), /non-empty/);
    assert.throws(() => h({ target: story, maxParagraphs: 0 }), /out of range/);
    assert.throws(() => h({ target: {} }), /Choose the text/);
});

await test('set_underline_and_strikethrough sets options on the text as given', async () => {
    const s = await one('set_underline_and_strikethrough', {
        target: { frameIds: [4] },
        underline: { on: true, weight: 1.5, offset: -2, type: 'Dotted', color: 'Black', tint: 80, overprint: true, gapColor: 'Paper', gapTint: 50, gapOverprint: false },
        strikethrough: { toggle: true, weight: 0.5, offset: 3, color: '#FF0000' },
    });
    assert.match(s, /__texts\(doc, \{[^}]*\}, false\)/);
    for (const re of [
        /"underline", true/, /"underlineWeight", "1\.5pt"/, /"underlineOffset", "-2pt"/, /"underlineType", __s\d+/,
        /"underlineColor", __c\d+/, /"underlineTint", 80/, /"underlineOverprint", true/, /"underlineGapColor", __c\d+/,
        /"underlineGapTint", 50/, /"underlineGapOverprint", false/,
        /__set\(t, "strikeThru", !__firstChar\(t\)\["strikeThru"\]\)/, /"strikeThroughWeight", "0\.5pt"/,
        /"strikeThroughOffset", "3pt"/, /"strikeThroughColor", __c\d+/,
    ]) assert.match(s, re);
    assert.match(s, /__now\.push\(__read\(__firstChar\(t\), __desc/);
});

await test('set_underline_and_strikethrough refuses bad arguments', () => {
    const h = tool('set_underline_and_strikethrough').handler;
    assert.throws(() => h({ target: { selection: true } }), /Nothing to set/);
    assert.throws(() => h({ target: { selection: true }, underline: { on: true, toggle: true } }), /on or toggle, not both/);
    assert.throws(() => h({ target: { selection: true }, underline: { weight: -1 } }), /out of range/);
    assert.throws(() => h({ target: { selection: true }, strikethrough: { style: 'Solid' } }), /Unknown option 'strikethrough\.style'/);
    assert.throws(() => h({ target: { selection: true }, strikethrough: { tint: 150 } }), /out of range/);
    assert.throws(() => h({ target: { selection: true }, underline: { type: '' } }), /must be a name/);
    assert.throws(() => h({ target: { selection: true }, overline: {} }), /Unknown option 'overline'/);
    assert.throws(() => h({ target: {}, underline: { on: true } }), /Choose the text/);
});

done();
