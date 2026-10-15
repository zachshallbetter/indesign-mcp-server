/**
 * Layout tools: the object-model statements their scripts carry, and the
 * arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const call = (name) => tool(name).handler;

await test('set_liquid_layout writes the object-based constraints and Auto-Fit', async () => {
    const s = await one('set_liquid_layout', { target: T, pinLeft: true, resizeWidth: false, pinBottom: false, resizeHeight: true, autoFit: true });
    assert.match(s, /var c = it\.horizontalLayoutConstraints, H = \[c\[0\], c\[1\], c\[2\]\];/);
    assert.match(s, /H\[0\] = DimensionsConstraints\.FIXED_DIMENSION;\nH\[1\] = DimensionsConstraints\.FIXED_DIMENSION;\nit\.horizontalLayoutConstraints = H;/);
    assert.match(s, /H\[1\] = DimensionsConstraints\.FLEXIBLE_DIMENSION;\nH\[2\] = DimensionsConstraints\.FLEXIBLE_DIMENSION;\nit\.verticalLayoutConstraints = H;/);
    assert.match(s, /it\.frameFittingOptions\.autoFit = true;/);
    assert.throws(() => call('set_liquid_layout')({ target: T }), /Nothing to set/);
    assert.throws(() => call('set_liquid_layout')({ target: T, pinTop: 'yes' }), /true or false/);
    assert.throws(() => call('set_liquid_layout')({ target: {}, pinTop: true }), /Choose the items/);
});

await test('create_alternate_layout passes every dialog option to createAlternateLayout', async () => {
    const s = await one('create_alternate_layout', {
        name: 'Tablet H', from: 'Letter V', width: 200, height: 260, orientation: 'landscape',
        liquidPageRule: 'GUIDE_BASED', linkStories: false, copyTextStyles: true, smartTextReflow: true,
    });
    assert.match(s, /var name = "Tablet H", from = "Letter V"/);
    assert.match(s, /doc\.textPreferences\.smartTextReflow = true;/);
    assert.match(s, /doc\.createAlternateLayout\(spreads, name, 260, 200, true, false, LayoutRuleOptions\.GUIDE_BASED\);/);
    const d = await one('create_alternate_layout', { name: 'Phone', width: 100, height: 180 });
    assert.match(d, /from = null/);
    assert.match(d, /LayoutRuleOptions\.PRESERVE_EXISTING\);/);
    assert.doesNotMatch(d, /smartTextReflow = /);
    const c = call('create_alternate_layout');
    assert.throws(() => c({ width: 100, height: 100 }), /'name' is required/);
    assert.throws(() => c({ name: 'A', width: 0, height: 100 }), /out of range/);
    assert.throws(() => c({ name: 'A', width: 100, height: 100, liquidPageRule: 'USE_MASTER' }), /Allowed: OFF/);
    assert.throws(() => c({ name: 'A', width: 100, height: 100, orientation: 'square' }), /Allowed: portrait, landscape/);
});

await test('manage_alternate_layouts lists and deletes layouts', async () => {
    const [list, del] = await scriptsFor([['manage_alternate_layouts', { action: 'list' }], ['manage_alternate_layouts', { action: 'delete', name: 'Phone' }]]);
    assert.match(list, /__result__ = \{ layouts: __layouts\(doc\) \};/);
    assert.match(list, /p\.appliedAlternateLayout/);
    assert.match(del, /doc\.deleteAlternateLayout\(name\);/);
    assert.match(del, /only one layout/);
    assert.throws(() => call('manage_alternate_layouts')({ action: 'delete' }), /'name' is required/);
    assert.throws(() => call('manage_alternate_layouts')({ action: 'list', name: 'x' }), /applies to delete/);
});

await test('create_flex_layout makes a container, adds the items and sizes them', async () => {
    const s = await one('create_flex_layout', {
        target: { ids: [5, 6, 7] }, layout: { direction: 'row', wrap: 'wrap', justifyContent: 'space_between', rowGap: 4, columnGap: 5, paddingTop: 2, width: 'fixed', height: 'auto' },
        itemSizing: { width: 'fill' },
    });
    assert.match(s, /__needFlex\(\);/);
    assert.match(s, /parseFloat\(app\.version\) < 21/);
    assert.match(s, /fx = pg\.flexObjects\.add\(\);/);
    assert.match(s, /it\.ungroup\(\);/);
    assert.match(s, /fx\.flexDirection = FlexDirection\.FLEX_ROW;/);
    assert.match(s, /fx\.flexWrap = FlexWrap\.WRAP;/);
    assert.match(s, /fx\.justifyContent = FlexSpacing\.FLEX_SPACE_BETWEEN;/);
    assert.match(s, /fx\.flexGapRow = 4;/);
    assert.match(s, /fx\.flexPaddingTop = 2;/);
    assert.match(s, /fx\.flexHeightMode = FlexEnum\.FLEX_AUTO;/);
    assert.match(s, /fx\.addFlexObject\(add\[i\]\);\n {2}add\[i\]\.flexItemWidthMode = FlexWidthHeightMode\.FLEX_FILL;/);
    assert.match(s, /if \(created\) fx\.move\(\[left, top\]\);/);
    const into = await one('create_flex_layout', { target: T, container: 40, ungroup: false });
    assert.match(into, /fx = __flexBox\(__item\(doc, 40\)\);/);
    assert.match(into, /if \(false && it\.constructor\.name === "Group"\)/);
    const c = call('create_flex_layout');
    assert.throws(() => c({ target: T, layout: { direction: 'diagonal' } }), /Allowed: row, row_reverse/);
    assert.throws(() => c({ target: T, layout: { gap: 3 } }), /Unknown option 'layout\.gap'/);
    assert.throws(() => c({ target: T, layout: { rowGap: -1 } }), /out of range/);
    assert.throws(() => c({ target: T, itemSizing: { width: 'grow' } }), /Allowed: fixed, fill, auto/);
});

await test('set_flex_layout and get_flex_layout', async () => {
    const s = await one('set_flex_layout', { target: { ids: [40] }, layout: { alignItems: 'center', alignContent: 'auto' }, items: [{ id: 41, height: 'fixed' }] });
    assert.match(s, /var fx = __flexBox\(boxes\[i\]\);/);
    assert.match(s, /fx\.alignItems = FlexPosition\.FLEX_CENTER;/);
    assert.match(s, /fx\.alignContent = FlexEnum\.FLEX_AUTO;/);
    assert.match(s, /x = __item\(doc, 41\);\nx\.flexItemHeightMode = FlexWidthHeightMode\.FLEX_FIXED;/);
    assert.throws(() => call('set_flex_layout')({ target: T }), /Nothing to set/);
    assert.throws(() => call('set_flex_layout')({ target: T, items: [{ id: 41 }] }), /sets nothing/);
    const [all, page] = await scriptsFor([['get_flex_layout', {}], ['get_flex_layout', { pageIndex: 2 }]]);
    assert.match(all, /var boxes = doc\.flexObjects\.everyItem\(\)\.getElements\(\);/);
    assert.match(all, /pg\.layoutRule != LayoutRuleOptions\.OFF/);
    assert.match(all, /o\.conflicts\.push/);
    assert.match(page, /__page\(doc, 2\)\.flexObjects/);
    assert.throws(() => call('get_flex_layout')({ target: T, pageIndex: 0 }), /not both/);
});

await test('manage_named_grids creates, edits, deletes, lists and loads grids', async () => {
    const [create, update, del, list] = await scriptsFor([
        ['manage_named_grids', { action: 'create', name: 'Body', grid: { appliedFont: 'Kozuka Mincho Pr6N', pointSize: 12, lineAki: 4, gridView: 'ZN_VIEW_ENUM', characterCountLocation: 'BOTTOM_ALIGN' } }],
        ['manage_named_grids', { action: 'update', name: 'Body', newName: 'Body 2' }],
        ['manage_named_grids', { action: 'delete', name: 'Body' }],
        ['manage_named_grids', { action: 'list' }],
    ]);
    assert.match(create, /var g = doc\.namedGrids\.add\(\{ name: "Body" \}\);/);
    assert.match(create, /g\.gridData\.appliedFont = "Kozuka Mincho Pr6N";/);
    assert.match(create, /g\.gridData\.lineAki = 4;/);
    assert.match(create, /g\.gridData\.gridView = GridViewSettings\.ZN_VIEW_ENUM;/);
    assert.match(create, /MeasurementUnits\.POINTS;\ntry \{\ng\.gridData\.pointSize = 12;/);
    assert.match(update, /g\.name = "Body 2";/);
    assert.match(del, /g\.remove\(\);/);
    assert.match(list, /doc\.namedGrids\.everyItem\(\)\.getElements\(\)/);
    const load = await one('manage_named_grids', { action: 'load', filePath: `${home}/Documents/grids.indd`, replace: true });
    assert.match(load, /src = app\.open\(f, false\);/);
    assert.match(load, /t\.gridData\.characterCountSize = d\.characterCountSize;/);
    assert.match(load, /if \(opened\) src\.close\(SaveOptions\.NO\);/);
    const m = call('manage_named_grids');
    assert.throws(() => m({ action: 'update', name: 'Body' }), /needs grid options or newName/);
    assert.throws(() => m({ action: 'delete', name: 'Body', grid: { pointSize: 10 } }), /'grid' does not apply to delete/);
    assert.throws(() => m({ action: 'create', name: 'Body', grid: { pointSize: 0 } }), /out of range/);
    assert.throws(() => m({ action: 'create', name: 'Body', grid: { size: 10 } }), /Unknown option 'grid\.size'/);
    assert.throws(() => m({ action: 'load', filePath: '/etc/grids.indd' }), /outside the allowed directories/);
    assert.throws(() => m({ action: 'share' }), /Allowed: list, create/);
});

await test('set_frame_grid sets grid options, applies a named grid and the grid format', async () => {
    const s = await one('set_frame_grid', { target: T, namedGrid: 'Body', grid: { characterCountLocation: 'TOP_ALIGN', characterCountSize: 7 }, applyGridFormat: true });
    assert.match(s, /it\.parentStory\.appliedNamedGrid = ng;/);
    assert.match(s, /it\.gridData\.characterCountLocation = CharacterCountLocation\.TOP_ALIGN;/);
    assert.match(s, /it\.gridData\.characterCountSize = 7;/);
    assert.match(s, /tx\.pointSize = d\.pointSize;/);
    assert.throws(() => call('set_frame_grid')({ target: T }), /Nothing to set/);
    assert.throws(() => call('set_frame_grid')({ target: T, grid: { gridView: 'GRID' } }), /Allowed: GRID_VIEW_ENUM/);
});

await test('set_layout_grid sets the layout grid and grid display', async () => {
    const s = await one('set_layout_grid', { grid: { pointSize: 9, characterAki: 0.5 }, view: { showLayoutGrids: true, showCharacterCount: false } });
    assert.match(s, /doc\.layoutGridData\.characterAki = 0\.5;/);
    assert.match(s, /doc\.layoutGridData\.pointSize = 9;/);
    assert.match(s, /doc\.cjkGridPreferences\.showAllLayoutGrids = true;/);
    assert.match(s, /doc\.cjkGridPreferences\.showCharacterCount = false;/);
    assert.throws(() => call('set_layout_grid')({ grid: { gridView: 'GRID_VIEW_ENUM' } }), /Unknown option 'grid\.gridView'/);
});

await test('place_linked_copies places linked copies with contentPlace', async () => {
    const s = await one('place_linked_copies', { target: T, pageIndex: 3, x: 10, y: 20, mapStyles: true, toDocument: 'Other.indd', layer: 'Text' });
    assert.match(s, /dest = app\.documents\.itemByName\("Other\.indd"\);/);
    assert.match(s, /var pt = __toPage\(pg, 10, 20\);/);
    assert.match(s, /pg\.contentPlace\(items, true, true, true, pt, ly, false\)/);
    const d = await one('place_linked_copies', { target: T, pageIndex: 0, linkItems: false });
    assert.match(d, /__toPage\(pg, first\.x \|\| 0, first\.y \|\| 0\)/);
    assert.match(d, /contentPlace\(items, false, true, false, pt, ly, false\)/);
    assert.throws(() => call('place_linked_copies')({ target: T, pageIndex: 0, x: 4 }), /both x and y/);
    assert.throws(() => call('place_linked_copies')({ target: T, pageIndex: -1 }), /Invalid index/);
});

await test('set_link_options writes page item and story link options', async () => {
    const s = await one('set_link_options', { target: T, updateWhileSaving: true, preserveFrameContent: false, removeForcedLineBreaks: true, mapStyles: true });
    assert.match(s, /po\.updateLinkWhileSaving = true;/);
    assert.match(s, /po\.preserveFrameContent = false;/);
    assert.match(s, /so\.updateWhileSaving = true;/);
    assert.match(s, /so\.removeForcedLineBreaks = true;/);
    assert.match(s, /so\.applyStyleMappings = true;/);
    assert.doesNotMatch(s, /doc\.linkedPageItemOptions/);
    const d = await one('set_link_options', { documentDefaults: true, warnOnUpdate: false });
    assert.match(d, /po = doc\.linkedPageItemOptions; so = doc\.linkedStoryOptions;/);
    assert.match(d, /po\.warnOnUpdateOfEditedPageItem = false;\nso\.warnOnUpdateOfEditedStory = false;/);
    assert.throws(() => call('set_link_options')({ preserveOthers: true }), /Choose target items, or documentDefaults/);
    assert.throws(() => call('set_link_options')({ target: T, preserveOthers: 1 }), /true or false/);
});

await test('manage_style_mappings adds, removes and lists mappings', async () => {
    const [add, rm, list] = await scriptsFor([
        ['manage_style_mappings', { action: 'add', kind: 'character', source: 'Emphasis', destination: 'Strong', rule: 'group_to_style' }],
        ['manage_style_mappings', { action: 'remove', kind: 'paragraph', source: 'Head' }],
        ['manage_style_mappings', { action: 'list' }],
    ]);
    assert.match(add, /var c = doc\.charStyleMappings, hit = null;/);
    assert.match(add, /c\.add\("Emphasis", "Strong", MapType\.GROUP_TO_STYLE_MAPPING_RULE\);/);
    assert.match(add, /hit\.destinationStyleName = "Strong";/);
    assert.match(rm, /doc\.paraStyleMappings/);
    assert.match(rm, /hit\.remove\(\);/);
    assert.match(list, /m\.sourceStyleName/);
    const m = call('manage_style_mappings');
    assert.throws(() => m({ action: 'add', kind: 'object', source: 'a', destination: 'b' }), /Allowed: paragraph, character, table, cell/);
    assert.throws(() => m({ action: 'add', kind: 'paragraph', source: 'a' }), /'destination' is required/);
    assert.throws(() => m({ action: 'remove', kind: 'paragraph', source: 'a', destination: 'b' }), /apply to add/);
    assert.throws(() => m({ action: 'list', kind: 'cell' }), /does not apply to list/);
});

await test('load_content_conveyor and set_content_placer_options', async () => {
    const s = await one('load_content_conveyor', { target: { selection: true }, linkItems: true, mapStyles: true });
    assert.match(s, /app\.contentPlacer\.load\(items, true, false, true, false\);/);
    const p = await one('set_content_placer_options', { showConveyor: true, createLinks: false, mapStyles: true });
    assert.match(p, /gp\.showConveyor = true;/);
    assert.match(p, /gp\.createLinksOnContentPlace = false;/);
    assert.match(p, /gp\.mapStylesOnContentPlace = true;/);
    assert.doesNotMatch(p, /__doc\(\);/);
    assert.throws(() => call('set_content_placer_options')({ showConveyor: 'on' }), /true or false/);
    assert.throws(() => call('load_content_conveyor')({ target: {} }), /Choose the items/);
});

await test('set_rulers shows rulers, sets and cycles units', async () => {
    const [both, each, cycle] = await scriptsFor([
        ['set_rulers', { show: false, units: 'PICAS' }],
        ['set_rulers', { horizontalUnits: 'MILLIMETERS', verticalUnits: 'POINTS' }],
        ['set_rulers', { cycle: true }],
    ]);
    assert.match(both, /vp\.showRulers = false;/);
    assert.match(both, /vp\.horizontalMeasurementUnits = MeasurementUnits\.PICAS;\nvp\.verticalMeasurementUnits = MeasurementUnits\.PICAS;/);
    assert.match(each, /vp\.verticalMeasurementUnits = MeasurementUnits\.POINTS;/);
    assert.match(cycle, /var next = MeasurementUnits\[order\[\(k \+ 1\) % order\.length\]\];/);
    const r = call('set_rulers');
    assert.throws(() => r({ units: 'FEET' }), /Allowed: POINTS/);
    assert.throws(() => r({ units: 'PICAS', verticalUnits: 'POINTS' }), /not both/);
    assert.throws(() => r({ cycle: true, units: 'PICAS' }), /do not give units/);
});

await test('manage_guides lists, moves, sets and deletes guides', async () => {
    const [list, to, by, set, del] = await scriptsFor([
        ['manage_guides', { action: 'list', pageIndex: 1 }],
        ['manage_guides', { action: 'move', guideIds: [7], to: 30 }],
        ['manage_guides', { action: 'move', spreadIndex: 0, by: -5 }],
        ['manage_guides', { action: 'set', guideIds: [7, 8], locked: true, type: 'liquid' }],
        ['manage_guides', { action: 'delete', spreadIndex: 2 }],
    ]);
    assert.match(list, /__guides\(doc, \{"guideIds":null,"page":1,"spread":null\}\)/);
    assert.match(to, /g\.location = \(g\.orientation == HorizontalOrVertical\.HORIZONTAL \? pg\.bounds\[0\] : pg\.bounds\[1\]\) \+ 30;/);
    assert.match(by, /g\.location = g\.location \+ -5;/);
    assert.match(set, /gs\[i\]\.guideType = GuideTypeOptions\.LIQUID;/);
    assert.match(set, /gs\[i\]\.locked = true;/);
    assert.match(del, /"spread":2/);
    assert.match(del, /gs\[i\]\.remove\(\);/);
    const g = call('manage_guides');
    assert.throws(() => g({ action: 'delete' }), /needs guideIds, pageIndex or spreadIndex/);
    assert.throws(() => g({ action: 'move', guideIds: [1] }), /needs to or by/);
    assert.throws(() => g({ action: 'move', guideIds: [1], to: 1, by: 2 }), /needs to or by/);
    assert.throws(() => g({ action: 'set', guideIds: [1] }), /needs locked or type/);
    assert.throws(() => g({ action: 'set', guideIds: [1], to: 3 }), /'to' does not apply to set/);
    assert.throws(() => g({ action: 'list', pageIndex: 0, spreadIndex: 0 }), /one of/);
    assert.throws(() => g({ action: 'set', guideIds: [1], type: 'margin' }), /Allowed: liquid, ruler/);
});

await test('measure_between measures between items and points', async () => {
    const s = await one('measure_between', { from: { id: 5, point: 'top_left' }, to: { pageIndex: 0, x: 10, y: 20 } });
    assert.match(s, /__pt\(\{"id":5,"fx":0,"fy":0,"page":null,"x":0,"y":0\}\)/);
    assert.match(s, /__pt\(\{"id":null,"fx":0,"fy":0,"page":0,"x":10,"y":20\}\)/);
    assert.match(s, /Math\.atan2\(-dy, dx\)/);
    const m = call('measure_between');
    assert.throws(() => m({ from: { id: 5 } }), /'to' is required/);
    assert.throws(() => m({ from: { id: 5, x: 1 }, to: { id: 6 } }), /not both/);
    assert.throws(() => m({ from: { pageIndex: 0, x: 1 }, to: { id: 6 } }), /needs an item id, or pageIndex, x and y/);
    assert.throws(() => m({ from: { id: 5, point: 'middle' }, to: { id: 6 } }), /Allowed: top_left/);
});

await test('adjust_gap resizes or moves the gap, or moves items', async () => {
    const [resize, move, push] = await scriptsFor([
        ['adjust_gap', { before: { ids: [1] }, after: { ids: [2] }, arrangement: 'side_by_side', mode: 'resize_gap', size: 6 }],
        ['adjust_gap', { before: { ids: [1] }, after: { ids: [2] }, arrangement: 'stacked', mode: 'move_gap', by: 3 }],
        ['adjust_gap', { before: { ids: [1] }, after: { ids: [2, 3] }, arrangement: 'side_by_side', mode: 'move_items', size: 0 }],
    ]);
    assert.match(resize, /if \(g\[3\] > edgeB\) edgeB = g\[3\];/);
    assert.match(resize, /var d = \(6 - gap\) \/ 2, dB = -d, dA = d, mA = 0;/);
    assert.match(resize, /bs\[i\]\.geometricBounds = nb\[i\];/);
    assert.match(move, /if \(g\[0\] < edgeA\) edgeA = g\[0\];/);
    assert.match(move, /var dB = 3, dA = dB, mA = 0;/);
    assert.match(push, /var dB = 0, dA = 0, mA = 0 - gap;/);
    const g = call('adjust_gap');
    const base = { before: { ids: [1] }, after: { ids: [2] }, arrangement: 'stacked' };
    assert.throws(() => g({ ...base, mode: 'resize_gap' }), /needs 'size'/);
    assert.throws(() => g({ ...base, mode: 'move_gap', size: 2 }), /'size' applies/);
    assert.throws(() => g({ ...base, mode: 'move_items', size: 2, by: 1 }), /'by' applies to move_gap/);
    assert.throws(() => g({ ...base, mode: 'resize_gap', size: -1 }), /out of range/);
    assert.throws(() => g({ ...base, arrangement: 'diagonal', mode: 'move_gap', by: 1 }), /Allowed: side_by_side, stacked/);
});

await test('set_context_break_styles maps styles to hr for EPUB', async () => {
    const [add, rm] = await scriptsFor([
        ['set_context_break_styles', { styles: ['Separator'], exportClass: 'scene-break' }],
        ['set_context_break_styles', { styles: ['Separator'], remove: true }],
    ]);
    assert.match(add, /var wanted = \["Separator"\], all = doc\.allParagraphStyles/);
    assert.match(add, /maps\.item\(j\)\.exportType == "EPUB"/);
    assert.match(add, /hit\.exportTag = "hr"; hit\.exportClass = "scene-break";/);
    assert.match(add, /hit = maps\.add\("EPUB", "hr", "scene-break", ""\);/);
    assert.match(rm, /if \(hit && hit\.exportTag == "hr"\) \{ hit\.remove\(\); hit = null; \}/);
    const c = call('set_context_break_styles');
    assert.throws(() => c({ styles: [] }), /non-empty list/);
    assert.throws(() => c({ styles: ['A'], exportClass: 'two words' }), /CSS class name/);
    assert.throws(() => c({ styles: ['A'], remove: true, exportClass: 'x' }), /does not apply when removing/);
});

done();
