/**
 * Text frames and stories (src/tools/text-frames.js): the scripts carry the
 * right object-model statements, every action's script uses only names the
 * InDesign object model has, and bad arguments are refused before anything runs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { test, done, tool, scriptsFor } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const refuses = async (name, args, re) => assert.rejects(async () => tool(name).handler(args), re);

// The names the script audit accepts (tests/audit/scripts.audit.js), so that
// every action is checked, not only the one the audit's sample arguments reach.
const require = createRequire(import.meta.url);
const typesRoot = path.dirname(require.resolve('types-for-adobe/package.json'));
const dts = ['InDesign/2023/index.d.ts', 'shared/JavaScript.d.ts', 'shared/global.d.ts'].map((f) => readFileSync(path.join(typesRoot, f), 'utf8')).join('\n');
const members = new Set([
    'length', 'push', 'join', 'toString', 'message', 'slice', 'split', 'indexOf', 'replace', 'toFixed',
    'charAt', 'charCodeAt', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'match', 'concat', 'sort',
    'pop', 'shift', 'unshift', 'splice', 'reverse', 'exists', 'fsName', 'fullName', 'lineNumber', 'number',
    'test', 'exec', 'apply', 'call', 'getTime', 'toUTCString', 'getFullYear', 'getMonth', 'getDate',
    'ids', 'names', 'kind', 'v',
]);
for (const m of dts.matchAll(/^\s*(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\??\s*[:(<]/gm)) members.add(m[1]);
for (const m of dts.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*\d+/gm)) members.add(m[1]);

/** Unknown member names in a script (object-literal keys it builds itself are allowed). */
function unknownNames(src) {
    const ast = acorn.parse(src, { ecmaVersion: 5, allowReturnOutsideFunction: true });
    const own = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'Property') own.add(n.key.name ?? n.key.value);
        if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed && ['o', 'out', 'r', 'rule', 'info'].includes(n.left.object.name)) own.add(n.left.property.name);
    });
    const bad = new Set();
    walk.full(ast, (n) => {
        if (n.type === 'MemberExpression' && !n.computed && !members.has(n.property.name) && !own.has(n.property.name)) bad.add(n.property.name);
    });
    return [...bad];
}

const CALLS = [
    ['set_text_frame_options', tool('set_text_frame_options').auditArgs],
    ['set_text_frame_options', { target: { selection: true }, columns: { mode: 'fixed_width' }, baseline: { customGrid: false }, autoSize: { minimumWidth: 0 } }],
    ['get_text_frame_options', { target: { ids: [5] } }],
    ['set_text_wrap', tool('set_text_wrap').auditArgs],
    ['get_text_wrap', { target: { names: ['Photo'] } }],
    ...['add', 'list', 'convert_text_to_note', 'convert_to_text', 'split', 'set_collapsed', 'remove', 'select', 'notes_mode'].map((action) => ['manage_notes', {
        action, story: { frameId: 3 }, text: 'Query', start: 0, length: 4, noteIds: action === 'list' || action === 'select' ? undefined : [12], splitAt: 2, collapsed: true, which: 'next', position: 4,
    }]),
    ['manage_notes', { action: 'remove', all: true }],
    ['manage_notes', { action: 'select', noteIds: [12] }],
    ...['enable', 'disable', 'list', 'accept', 'reject'].map((action) => ['manage_tracked_changes', { action }]),
    ['manage_tracked_changes', { action: 'accept', story: { storyId: 7 }, indexes: [0, 2] }],
    ['manage_tracked_changes', { action: 'reject', userName: 'Ann' }],
    ['manage_tracked_changes', { action: 'select', which: 'previous' }],
    ['manage_tracked_changes', { action: 'select', story: { frameId: 3 }, indexes: [1] }],
    ['get_editorial_preferences', {}],
    ['set_editorial_preferences', tool('set_editorial_preferences').auditArgs],
    ['show_text_extras', { notes: true, textThreads: true, changes: false, notesPanel: true, trackChangesPanel: true, textWrapPanel: true, textWrapOptions: true }],
    ...['thread', 'unthread', 'flow', 'list', 'select'].map((action) => ['thread_text_frames', { action, frameIds: [3, 4], which: 'last' }]),
    ['thread_text_frames', { action: 'unthread', frameIds: [3], side: 'before' }],
    ['get_story_statistics', { story: { selection: true } }],
    ...['open', 'close', 'toggle_footnotes'].map((action) => ['manage_story_editor', { action, story: { storyId: 2 } }]),
    ['manage_story_editor', { action: 'close' }],
    ['fill_with_placeholder_text', { target: { ids: [3] }, script: 'greek' }],
    ...['character', 'word', 'line', 'paragraph', 'story'].flatMap((unit) => ['move', 'extend'].map((operation) => ['select_text', { story: { frameId: 3 }, operation, unit, count: -2 }])),
    ['select_text', { story: { frameId: 3 }, operation: 'select_line' }],
    ['select_text', { story: { frameId: 3 }, operation: 'select_range', start: 4, length: 10 }],
    ['apply_type_on_path', tool('apply_type_on_path').auditArgs],
    ['remove_type_on_path', { target: { ids: [9] } }],
];

await test('every action generates ES5 that uses only object-model names', async () => {
    for (const [name, args] of CALLS) {
        const [src] = await scriptsFor([[name, args]]);
        assert.ok(src, `${name} sent no script`);
        assert.deepEqual(unknownNames(src), [], `${name} ${JSON.stringify(args)}`);
    }
});

await test('set_text_frame_options writes TextFramePreference and BaselineFrameGridOption', async () => {
    const s = await one('set_text_frame_options', tool('set_text_frame_options').auditArgs);
    for (const stmt of [
        'p.useFlexibleColumnWidth = true;', 'p.useFixedColumnWidth = false;', 'p.textColumnCount = 2;', 'p.textColumnGutter = 4;',
        'p.textColumnFixedWidth = 40;', 'p.textColumnMaxWidth = 60;', 'p.verticalBalanceColumns = true;', 'ins = [2, 2, 2, 2];', 'ins[0] = 3;',
        'p.verticalJustification = VerticalJustification.JUSTIFY_ALIGN;', 'p.verticalThreshold = 5;', 'p.ignoreWrap = false;',
        'p.firstBaselineOffset = FirstBaseline.CAP_HEIGHT;', 'p.minimumFirstBaselineOffset = 1;', 'g.useCustomBaselineFrameGrid = true;',
        'g.baselineFrameGridRelativeOption = BaselineFrameGridRelativeOption.TOP_OF_INSET;', 'g.baselineFrameGridIncrement = 4.2;', 'g.baselineFrameGridColor = UIColors.LIGHT_BLUE;',
        'p.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;', 'p.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_CENTER_POINT;',
        'p.useMinimumHeightForAutoSizing = true;', 'p.minimumHeightForAutoSizing = 20;', 'p.useMinimumWidthForAutoSizing = false;', 'p.useNoLineBreaksForAutoSizing = false;',
        'p.footnotesEnableOverrides = true;', 'p.footnotesSpanAcrossColumns = true;', 'p.footnotesSpaceBetween = 2;', 'p.footnotesMinimumSpacing = 4;',
        'p.columnRuleOverride = true;', 'p.columnRuleInsetChainOverride = true;', 'p.columnRuleTopInset = 1;', 'p.columnRuleOffset = 0;',
        'p.columnRuleStrokeWidth = 0.5;', 'p.columnRuleStrokeType = ruleType;', 'p.columnRuleStrokeColor = ruleColor;', 'p.columnRuleStrokeTint = 50;', 'p.columnRuleOverprintOverride = false;',
        'doc.strokeStyles.itemByName("Solid")', 'MeasurementUnits.POINTS',
    ]) assert.ok(s.includes(stmt), stmt);
    const off = await one('set_text_frame_options', { target: { ids: [1] }, columnRules: { enabled: false }, baseline: { gridColor: '#FF8000', customGrid: false } });
    assert.ok(off.includes('p.columnRuleOverride = false;'));
    assert.ok(off.includes('g.useCustomBaselineFrameGrid = false;'));
    assert.ok(off.includes('g.baselineFrameGridColor = [255, 128, 0];'));
});

await test('set_text_frame_options refuses bad options', async () => {
    await refuses('set_text_frame_options', { target: { ids: [1] } }, /Nothing to change/);
    await refuses('set_text_frame_options', { target: {}, ignoreWrap: true }, /Choose the items/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, columns: { count: 0 } }, /columns.count/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, columns: { mode: 'auto' } }, /Allowed: fixed_number/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, columns: { colour: 2 } }, /Unknown option 'columns.colour'/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, inset: { top: -1 } }, /inset.top/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, baseline: { gridColor: 'chartreuse' } }, /baseline.gridColor/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, columnRules: { strokeTint: 120 } }, /strokeTint/);
    await refuses('set_text_frame_options', { target: { ids: [1] }, columnRules: { strokeColor: '' } }, /is empty/);
});

await test('set_text_wrap sets the wrap mode, offsets and contour', async () => {
    const s = await one('set_text_wrap', tool('set_text_wrap').auditArgs);
    for (const stmt of ['w.textWrapMode = TextWrapModes.CONTOUR;', 'w.inverse = false;', 'w.textWrapSide = TextWrapSideOptions.LARGEST_AREA;', 'off[1] = 3;', 'else w.textWrapOffset = 2;',
        'w.contourOptions.contourType = ContourOptionsTypes.PHOTOSHOP_PATH;', 'w.contourOptions.contourPathName = "Path 1";', 'w.contourOptions.includeInsideEdges = true;', 'w.applyToMasterPageOnly = false;']) {
        assert.ok(s.includes(stmt), stmt);
    }
    for (const [mode, member] of [['none', 'NONE'], ['bounding_box', 'BOUNDING_BOX_TEXT_WRAP'], ['jump_object', 'JUMP_OBJECT_TEXT_WRAP'], ['next_column', 'NEXT_COLUMN_TEXT_WRAP']]) {
        assert.ok((await one('set_text_wrap', { target: { ids: [1] }, mode })).includes(`TextWrapModes.${member}`), mode);
    }
    await refuses('set_text_wrap', { target: { ids: [1] } }, /Nothing to change/);
    await refuses('set_text_wrap', { target: { ids: [1] }, mode: 'around' }, /Allowed: none/);
    await refuses('set_text_wrap', { target: { ids: [1] }, contour: { kind: 'x' } }, /Unknown option 'contour.kind'/);
});

await test('manage_notes uses Notes.add, convertToNote, convertToText and Note.remove', async () => {
    const add = await one('manage_notes', { action: 'add', story: { frameId: 3 }, position: 5, text: 'Check "this"' });
    assert.ok(add.includes('ip.notes.add()') && add.includes('"Check \\"this\\""') && add.includes('Math.min(5,'));
    assert.ok((await one('manage_notes', { action: 'convert_text_to_note', story: { storyId: 4 }, start: 2, length: 3 })).includes('.convertToNote()'));
    assert.ok((await one('manage_notes', { action: 'convert_to_text', noteIds: [8] })).includes('n.convertToText()'));
    assert.ok((await one('manage_notes', { action: 'remove', all: true })).includes('n.remove()'));
    assert.ok((await one('manage_notes', { action: 'set_collapsed', story: { selection: true }, collapsed: false })).includes('n.collapsed = false;'));
    assert.ok((await one('manage_notes', { action: 'notes_mode', story: { frameId: 3 } })).includes('__menu(47892, null)'));
    await refuses('manage_notes', { action: 'add', story: { frameId: 3 } }, /needs 'text'/);
    await refuses('manage_notes', { action: 'add', text: 'x' }, /Choose the story/);
    await refuses('manage_notes', { action: 'remove' }, /needs 'noteIds', 'story' or all: true/);
    await refuses('manage_notes', { action: 'split', noteIds: [1] }, /splitAt/);
    await refuses('manage_notes', { action: 'select' }, /'which'/);
    await refuses('manage_notes', { action: 'convert_to_text', noteIds: [-1] }, /Invalid id/);
    await refuses('manage_notes', { action: 'archive' }, /Allowed: add/);
});

await test('manage_tracked_changes turns tracking on and accepts or rejects changes', async () => {
    assert.ok((await one('manage_tracked_changes', { action: 'enable' })).includes('stories[i].trackChanges = true;'));
    assert.ok((await one('manage_tracked_changes', { action: 'disable', story: { frameId: 2 } })).includes('stories[i].trackChanges = false;'));
    const byUser = await one('manage_tracked_changes', { action: 'reject', userName: 'Ann' });
    assert.ok(byUser.includes('if (c.userName !== "Ann") continue;') && byUser.includes('c.reject();'));
    assert.ok((await one('manage_tracked_changes', { action: 'accept', story: { storyId: 7 }, indexes: [3, 1] })).includes('c.accept();'));
    await refuses('manage_tracked_changes', { action: 'accept', indexes: [1] }, /need a story/);
    await refuses('manage_tracked_changes', { action: 'select' }, /'which'/);
    await refuses('manage_tracked_changes', { action: 'list', limit: 0 }, /limit/);
    await refuses('manage_tracked_changes', { action: 'merge' }, /Allowed: enable/);
});

await test('editorial preferences map to the application preference objects', async () => {
    const s = await one('set_editorial_preferences', tool('set_editorial_preferences').auditArgs);
    for (const stmt of ['app.userName = "Editor";', 'np.noteColor = InCopyUIColors.GOLD;', 'np.showNoteTips = true;', 'tp.changeBarColor = [255, 0, 0];', 'tp.markingForAddedText = ChangeMarkings.UNDERLINE_SINGLE;',
        'gp.displayFont = "Courier";', 'gp.displayFontSize = "12pt";', 'gp.showInfoColumn = true;', 'gp.showDepthRuler = true;', 'gp.cursorType = CursorTypes.THICK_CURSOR;',
        'ep.singleClickConvertsFramesToTextFrames = true;', 'ep.tripleClickSelectsLine = true;', 'ep.smartCutAndPaste = true;']) {
        assert.ok(s.includes(stmt), stmt);
    }
    assert.ok(!s.includes('var doc = __doc();'), 'application preferences need no document');
    await refuses('set_editorial_preferences', {}, /Nothing to change/);
    await refuses('set_editorial_preferences', { notes: { color: 'plaid' } }, /notes.color/);
    await refuses('set_editorial_preferences', { storyEditor: { fontSize: 200 } }, /storyEditor.fontSize/);
    await refuses('set_editorial_preferences', { typing: { autocorrect: true } }, /Unknown option 'typing.autocorrect'/);
});

await test('show_text_extras toggles view options and panels through the object model and menu actions', async () => {
    const s = await one('show_text_extras', { notes: false, textThreads: true, changes: false, textWrapOptions: true });
    for (const stmt of ['doc.viewPreferences.showNotes = false;', '__menu(24332, true)', '__menu(42254, false)', '__menu(13570, true)']) assert.ok(s.includes(stmt), stmt);
    await refuses('show_text_extras', {}, /Nothing to change/);
});

await test('thread_text_frames threads, unthreads and flows text', async () => {
    const t = await one('thread_text_frames', { action: 'thread', frameIds: [3, 4, 5] });
    assert.ok(t.includes('fr[j].nextTextFrame = fr[j + 1];') && t.includes('[3,4,5]'));
    assert.ok((await one('thread_text_frames', { action: 'unthread', frameIds: [3] })).includes('tf.nextTextFrame = NothingEnum.NOTHING;'));
    assert.ok((await one('thread_text_frames', { action: 'unthread', frameIds: [3], side: 'before' })).includes('tf.previousTextFrame = NothingEnum.NOTHING;'));
    const flow = await one('thread_text_frames', { action: 'flow', frameIds: [3], addPages: true, maxFrames: 4 });
    assert.ok(flow.includes('made.length < 4') && flow.includes('doc.pages.add(LocationOptions.AT_END)') && flow.includes('last.nextTextFrame = nf;'));
    assert.ok((await one('thread_text_frames', { action: 'select', frameIds: [3], which: 'first' })).includes('tf.startTextFrame'));
    await refuses('thread_text_frames', { action: 'thread', frameIds: [3] }, /at least 2/);
    await refuses('thread_text_frames', { action: 'select', frameIds: [3], which: 'up' }, /Allowed: next/);
    await refuses('thread_text_frames', { action: 'flow', frameIds: [3], maxFrames: 1000 }, /maxFrames/);
});

await test('story tools: statistics, Story Editor, placeholder text and type on a path', async () => {
    const st = await one('get_story_statistics', { story: { storyId: 6 } });
    assert.ok(st.includes('__storyById(doc, 6)') && st.includes('t.words.length'));
    assert.ok((await one('manage_story_editor', { action: 'open', story: { frameId: 3 } })).includes('s.storyEdit()'));
    assert.ok((await one('manage_story_editor', { action: 'close' })).includes('w.close();'));
    assert.ok((await one('manage_story_editor', { action: 'toggle_footnotes' })).includes('__menu(137108, null)'));
    assert.ok((await one('fill_with_placeholder_text', { target: { ids: [3] }, script: 'cyrillic' })).includes('TextFrameContents.PLACEHOLDER_TEXT_CYRILLIC'));
    const tp = await one('apply_type_on_path', tool('apply_type_on_path').auditArgs);
    for (const stmt of ['it.textPaths.add()', 'tp.contents = "Along the curve";', 'tp.pathEffect = TextPathEffects.GRAVITY_PATH_EFFECT;', 'tp.textAlignment = TextTypeAlignments.CENTER_TEXT_ALIGNMENT;',
        'tp.pathAlignment = PathTypeAlignments.CENTER_PATH_ALIGNMENT;', 'tp.pathSpacing = 2;', 'tp.flipPathEffect = FlipValues.FLIPPED;']) assert.ok(tp.includes(stmt), stmt);
    assert.ok((await one('remove_type_on_path', { target: { ids: [3] } })).includes('it.textPaths[j].remove();'));
    await refuses('get_story_statistics', { story: {} }, /Choose the story/);
    await refuses('manage_story_editor', { action: 'open' }, /Choose the story/);
    await refuses('fill_with_placeholder_text', { target: { ids: [3] }, script: 'klingon' }, /Allowed: latin/);
    await refuses('apply_type_on_path', { target: { ids: [3] } }, /Nothing to do/);
    await refuses('apply_type_on_path', { target: { ids: [3] }, effect: 'wave' }, /Allowed: rainbow/);
});

await test('select_text moves and extends by units and selects lines and ranges', async () => {
    const w = await one('select_text', { story: { frameId: 3 }, operation: 'move', unit: 'word', count: 2 });
    assert.ok(w.includes('s.words.everyItem().index') && w.includes('__range(pos, pos)'));
    const e = await one('select_text', { story: { frameId: 3 }, operation: 'extend', unit: 'paragraph', count: -1 });
    assert.ok(e.includes('s.paragraphs.everyItem().index') && e.includes('var anchor'));
    assert.ok((await one('select_text', { story: { frameId: 3 }, operation: 'select_line' })).includes('.lines[0]'));
    await refuses('select_text', { story: { frameId: 3 }, operation: 'select_range', start: 1 }, /'start' and 'length'/);
    await refuses('select_text', { story: { frameId: 3 }, operation: 'move', count: 1.5 }, /whole number/);
    await refuses('select_text', { story: { frameId: 3 }, operation: 'move', unit: 'sentence' }, /Allowed: character/);
});

done();
