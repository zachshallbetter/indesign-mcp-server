/**
 * Document, page, layer, selection and history tools: the object-model
 * statements their scripts carry, and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const T = { ids: [7] };

// Documents

await test('create_document_with_options builds the document from a preset with every option', async () => {
    const s = await one('create_document_with_options', {
        preset: 'Letter', units: 'POINTS', savePreset: 'Book',
        settings: { intent: 'WEB_INTENT', startPageNumber: 5, createPrimaryTextFrame: true, columnCount: 3, columnGutter: 4.5, pagesPerDocument: 8 },
        margin: 12,
    });
    assert.match(s, /app\.documentPresets\.itemByName\("Letter"\)/);
    assert.match(s, /p = base\.duplicate\(\); p\.name = pname;/);
    assert.match(s, /p\.intent = DocumentIntentOptions\.WEB_INTENT;/);
    assert.match(s, /p\.startPageNumber = 5;/);
    assert.match(s, /p\.createPrimaryTextFrame = true;/);
    assert.match(s, /p\.columnCount = 3;/);
    assert.match(s, /p\.columnGutter = 4\.5;/);
    assert.match(s, /p\.top = 12; p\.bottom = 12; p\.left = 12; p\.right = 12;/);
    assert.match(s, /d = app\.documents\.add\(true, p\);/);
    assert.match(s, /var keep = "Book";/);
    assert.match(s, /horizontalMeasurementUnits = MeasurementUnits\.POINTS;/);
});

await test('create_document_with_options with no options makes a default document', async () => {
    const s = await one('create_document_with_options', {});
    assert.match(s, /var d = app\.documents\.add\(true\);/);
    assert.doesNotMatch(s, /documentPresets/);
});

await test('create_document_with_options refuses bad settings', () => {
    const c = tool('create_document_with_options').handler;
    assert.throws(() => c({ settings: { columnCount: 2.5 } }), /whole number/);
    assert.throws(() => c({ settings: { top: 10 }, margin: 5 }), /not both/);
    assert.throws(() => c({ settings: { intent: 'TV' } }), /Allowed: PRINT_INTENT/);
    assert.throws(() => c({ settings: { pageColour: 1 } }), /Unknown option/);
    assert.throws(() => c({ units: 'FEET' }), /Allowed: MILLIMETERS/);
});

await test('manage_document_presets lists, saves, saves from a document and deletes', async () => {
    const [list, save, fromDoc, del] = await scriptsFor([
        ['manage_document_presets', { action: 'list' }],
        ['manage_document_presets', { action: 'save', name: 'Flyer', settings: { pageWidth: 100, facingPages: false } }],
        ['manage_document_presets', { action: 'save_from_document', name: 'From doc' }],
        ['manage_document_presets', { action: 'delete', name: 'Flyer' }],
    ]);
    assert.match(list, /app\.documentPresets\.length/);
    assert.match(save, /p = app\.documentPresets\.add\(\{ name: "Flyer" \}\)/);
    assert.match(save, /p\.pageWidth = 100;/);
    assert.match(fromDoc, /p\.pagesPerDocument = doc\.pages\.length;/);
    assert.match(del, /p\.remove\(\);/);
    const m = tool('manage_document_presets').handler;
    assert.throws(() => m({ action: 'save', name: 'X' }), /Nothing to save/);
    assert.throws(() => m({ action: 'delete', name: '[Default]' }), /built-in/);
    assert.throws(() => m({ action: 'get' }), /'name' is required/);
});

await test('run_file_command saves a copy, saves all, reverts, closes all and writes IDML', async () => {
    const [copy, all, rev, close, idml, recent] = await scriptsFor([
        ['run_file_command', { command: 'save_a_copy', filePath: `${home}/Documents/copy.indd` }],
        ['run_file_command', { command: 'save_all' }],
        ['run_file_command', { command: 'revert' }],
        ['run_file_command', { command: 'close_all', saving: 'save' }],
        ['run_file_command', { command: 'save_for_earlier_versions', filePath: `${home}/Documents/old.idml` }],
        ['run_file_command', { command: 'remove_from_recent', filePath: `${home}/Documents/old.indd` }],
    ]);
    assert.match(copy, /doc\.saveACopy\(File\(".*copy\.indd"\), false\);/);
    assert.match(all, /if \(d\.modified\) \{ d\.save\(\);/);
    assert.match(rev, /doc\.revert\(\);/);
    assert.match(close, /docs\[i\]\.close\(SaveOptions\.YES\);/);
    assert.match(idml, /doc\.exportFile\(ExportFormat\.INDESIGN_MARKUP, File\(".*old\.idml"\)\);/);
    assert.match(recent, /app\.removeFileFromRecentFiles\(File\(/);
    const f = tool('run_file_command').handler;
    assert.throws(() => f({ command: 'save_a_copy', filePath: `${home}/Documents/copy.pdf` }), /\.indd or \.indt/);
    assert.throws(() => f({ command: 'save_for_earlier_versions' }), /\.idml/);
    assert.throws(() => f({ command: 'close_all', saving: 'maybe' }), /Allowed: discard, save/);
    assert.throws(() => f({ command: 'print' }), /Allowed: save_a_copy/);
});

await test('manage_file_info sets metadata and reports recovery', async () => {
    const s = await one('manage_file_info', { action: 'set', metadata: { documentTitle: 'Annual report', copyrightStatus: 'YES' }, keywords: ['a', 'b'] });
    assert.match(s, /mp\.documentTitle = "Annual report";/);
    assert.match(s, /mp\.copyrightStatus = CopyrightStatus\.YES;/);
    assert.match(s, /mp\.keywords = \["a","b"\];/);
    assert.match(s, /recovered: doc\.recovered/);
    assert.throws(() => tool('manage_file_info').handler({ action: 'set' }), /Nothing to set/);
    assert.throws(() => tool('manage_file_info').handler({ action: 'set', metadata: { creator: 'x' } }), /Unknown option/);
});

await test('arrange_document_windows runs Window > Arrange commands', async () => {
    const [nw, tile, cons, next] = await scriptsFor([
        ['arrange_document_windows', { action: 'new_window' }],
        ['arrange_document_windows', { action: 'tile' }],
        ['arrange_document_windows', { action: 'consolidate_all' }],
        ['arrange_document_windows', { action: 'next_window' }],
    ]);
    assert.match(nw, /app\.activeDocument\.windows\.add\(\);/);
    assert.match(tile, /app\.tileWindows\(\);/);
    assert.match(cons, /__invoke\(91222, "Consolidate All Windows"\);/);
    assert.match(next, /app\.windows\[1\]\.bringToFront\(\);/);
    assert.throws(() => tool('arrange_document_windows').handler({ action: 'float' }), /Allowed: list/);
});

await test('set_margins_and_columns sets margins, all-sides margins and custom columns', async () => {
    const s = await one('set_margins_and_columns', { pages: [0, 2], parents: ['A-Parent'], margin: 10, margins: { columnCount: 2, columnGutter: 5 }, columnsPositions: [0, 80, 85, 170] });
    assert.match(s, /mp\.columnCount = 2;/);
    assert.match(s, /mp\.top = 10; mp\.bottom = 10; mp\.left = 10; mp\.right = 10;/);
    assert.match(s, /mp\.customColumns = true;/);
    assert.match(s, /mp\.columnsPositions = \[0,80,85,170\];/);
    assert.match(s, /doc\.masterSpreads\.itemByName\(parentList\[j\]\)/);
    const m = tool('set_margins_and_columns').handler;
    assert.throws(() => m({ margin: 5 }), /Choose where/);
    assert.throws(() => m({ pages: [0] }), /Nothing to set/);
    assert.throws(() => m({ pages: [0], margin: 5, margins: { left: 3 } }), /not both/);
    assert.throws(() => m({ pages: [0], columnsPositions: [50, 10] }), /increasing/);
});

// Pages and spreads

await test('arrange_spread_pages keeps spreads together, adds pages and splits pages out', async () => {
    const [keep, add, split] = await scriptsFor([
        ['arrange_spread_pages', { action: 'keep_together', spreadIndex: 1 }],
        ['arrange_spread_pages', { action: 'add_page_to_spread', spreadIndex: 1, pageIndex: 4, position: 'beginning' }],
        ['arrange_spread_pages', { action: 'split_page', pageIndex: 2 }],
    ]);
    assert.match(keep, /sp\.allowPageShuffle = false;/);
    assert.match(add, /pg\.move\(LocationOptions\.AT_BEGINNING, sp\);/);
    assert.match(add, /at most 10 pages/);
    assert.match(split, /doc\.spreads\.add\(LocationOptions\.AFTER, from\)/);
    assert.match(split, /pg\.move\(LocationOptions\.AT_END, sp\);/);
    const a = tool('arrange_spread_pages').handler;
    assert.throws(() => a({ action: 'keep_together' }), /'spreadIndex' is required/);
    assert.throws(() => a({ action: 'split_page' }), /'pageIndex' is required/);
});

await test('set_spread_visibility hides spreads and shows hidden spreads by name', async () => {
    const s = await one('set_spread_visibility', { spreads: [2], hidden: true, showHiddenSpreads: false });
    assert.match(s, /sp\["spreadHidden"\] = true;/);
    assert.match(s, /dp\["spreadHiddenVisibility"\] = false;/);
    const v = tool('set_spread_visibility').handler;
    assert.throws(() => v({ spreads: [1] }), /'hidden'/);
    assert.throws(() => v({}), /Nothing to do/);
});

await test('go_to_page moves through pages and spreads and uses Go Back / Go Forward', async () => {
    const [first, next, back] = await scriptsFor([
        ['go_to_page', { command: 'first_page' }],
        ['go_to_page', { command: 'next_spread' }],
        ['go_to_page', { command: 'go_back' }],
    ]);
    assert.match(first, /w\.activePage = doc\.pages\[0\];/);
    assert.match(next, /w\.activeSpread = doc\.spreads\[w\.activeSpread\.index \+ 1\];/);
    assert.match(back, /__invoke\(22786, "Go Back"\);/);
    assert.throws(() => tool('go_to_page').handler({ command: 'jump' }), /Allowed: first_page/);
});

await test('rotate_spread_view runs the Rotate Spread View command on the spread', async () => {
    const s = await one('rotate_spread_view', { rotation: 'ccw_90', spreadIndex: 3 });
    assert.match(s, /w\.activeSpread = __spread\(doc, 3\);/);
    assert.match(s, /__invoke\(6187, /);
    assert.throws(() => tool('rotate_spread_view').handler({ rotation: 'cw_45' }), /Allowed: cw_90/);
});

await test('insert_page_marker inserts markers and sets section marker text', async () => {
    const [cur, sec] = await scriptsFor([
        ['insert_page_marker', { marker: 'current_page_number', place: { frameId: 12 } }],
        ['insert_page_marker', { marker: 'section_marker', place: { selection: true, at: 'start' }, markerText: 'Chapter 1' }],
    ]);
    assert.match(cur, /ip\.contents = SpecialCharacters\.AUTO_PAGE_NUMBER;/);
    assert.match(cur, /__insertionPoint\(doc, \{"frameId":12,"at":"end","selection":false\}\)/);
    assert.match(sec, /pg\.appliedSection\.marker = "Chapter 1";/);
    assert.match(sec, /SpecialCharacters\.SECTION_MARKER/);
    const m = tool('insert_page_marker').handler;
    assert.throws(() => m({ marker: 'current_page_number', place: {} }), /Choose where to insert/);
    assert.throws(() => m({ marker: 'current_page_number', place: { frameId: 1, selection: true } }), /Choose where to insert/);
    assert.throws(() => m({ marker: 'next_page_number', place: { frameId: 1 }, markerText: 'x' }), /section_marker/);
});

await test('manage_parent_pages covers based on, save, load, unused, move, overrides and overlay', async () => {
    const [based, none, save, load, unused, move, allow, overlay] = await scriptsFor([
        ['manage_parent_pages', { action: 'based_on', parent: 'B-Parent', basedOn: 'A-Parent' }],
        ['manage_parent_pages', { action: 'based_on', parent: 'B-Parent', basedOn: 'None' }],
        ['manage_parent_pages', { action: 'save_as_parent', spreadIndex: 2 }],
        ['manage_parent_pages', { action: 'load', filePath: `${home}/Documents/parents.indd`, clash: 'overwrite' }],
        ['manage_parent_pages', { action: 'select_unused' }],
        ['manage_parent_pages', { action: 'move_to_document', parent: 'A-Parent', toDocument: 'Other.indd' }],
        ['manage_parent_pages', { action: 'allow_overrides', itemIds: [44], allow: false }],
        ['manage_parent_pages', { action: 'parent_overlay', pageIndex: 1, offsetX: 25.4, offsetY: 0 }],
    ]);
    assert.match(based, /ms\.appliedMaster = base;/);
    assert.match(none, /ms\.appliedMaster = NothingEnum\.NOTHING;/);
    assert.match(save, /__invoke\(6157, "Save as Parent"\);/);
    assert.match(load, /doc\.loadMasters\(f, GlobalClashResolutionStrategyForMasterPage\.LOAD_ALL_WITH_OVERWRITE\);/);
    assert.match(unused, /__invoke\(6151, "Select Unused Parents"\)/);
    assert.match(move, /ms\.duplicate\(LocationOptions\.AT_END, target\)/);
    assert.match(allow, /it\.allowOverrides = false;/);
    assert.match(overlay, /app\.transformationMatrices\.add\(1, 1, 0, 0, 72\.0000, 0\.0000\)/);
    const p = tool('manage_parent_pages').handler;
    assert.throws(() => p({ action: 'save_as_parent' }), /'spreadIndex' is required/);
    assert.throws(() => p({ action: 'load', filePath: `${home}/Documents/x.pdf` }), /\.indd or \.indt/);
    assert.throws(() => p({ action: 'allow_overrides', itemIds: [1] }), /'allow'/);
    assert.throws(() => p({ action: 'based_on', basedOn: 'A-Parent' }), /'parent' is required/);
});

await test('set_layout_view_options sets page numbering, content grabber, ruler origin and zero point', async () => {
    const s = await one('set_layout_view_options', { pageNumbering: 'absolute', showContentGrabber: false, rulerOrigin: 'spine', zeroPoint: [10, 5] });
    assert.match(s, /app\.generalPreferences\.pageNumbering = PageNumberingOptions\.ABSOLUTE;/);
    assert.match(s, /app\.generalPreferences\.showContentGrabber = false;/);
    assert.match(s, /doc\.viewPreferences\.rulerOrigin = RulerOrigin\.SPINE_ORIGIN;/);
    assert.match(s, /doc\.zeroPoint = \[10, 5\];/);
    assert.throws(() => tool('set_layout_view_options').handler({ zeroPoint: [1] }), /\[x, y\]/);
});

await test('show_document_panels shows the Pages and Layers panels', async () => {
    const s = await one('show_document_panels', { pages: true, layers: false });
    assert.match(s, /__panel\("Pages", 6145, true\)/);
    assert.match(s, /__panel\("Layers", 18433, false\)/);
    assert.throws(() => tool('show_document_panels').handler({}), /Nothing to do/);
});

// Layers

await test('set_layer_options sets print, wrap and guide options', async () => {
    const s = await one('set_layer_options', { layer: 'Art', options: { printable: false, ignoreWrap: true, showGuides: true, lockGuides: true }, color: '#ff8000' });
    assert.match(s, /l\.printable = false;/);
    assert.match(s, /l\.ignoreWrap = true;/);
    assert.match(s, /l\.showGuides = true;/);
    assert.match(s, /l\.lockGuides = true;/);
    assert.match(s, /l\.layerColor = \[255,128,0\];/);
    const l = tool('set_layer_options').handler;
    assert.throws(() => l({ layer: 'Art' }), /Nothing to set/);
    assert.throws(() => l({ layer: 'Art', color: 'MAUVE' }), /Allowed: BLACK/);
    assert.throws(() => l({ layer: 'Art', options: { hidden: true } }), /Unknown option/);
});

await test('run_layer_command runs Layers panel menu commands', async () => {
    const [dup, hide, lock, unlock, sel, rows] = await scriptsFor([
        ['run_layer_command', { command: 'duplicate', layer: 'Art', newName: 'Art 2' }],
        ['run_layer_command', { command: 'hide_others', layer: 'Art' }],
        ['run_layer_command', { command: 'lock_others', layer: 'Art' }],
        ['run_layer_command', { command: 'unlock_all' }],
        ['run_layer_command', { command: 'select_items', layer: 'Art', spreadIndex: 0 }],
        ['run_layer_command', { command: 'small_panel_rows', on: true }],
    ]);
    assert.match(dup, /c = l\.duplicate\(\);/);
    assert.match(dup, /c\.name = "Art 2";/);
    assert.match(hide, /doc\.layers\[i\]\.visible = false;/);
    assert.match(lock, /doc\.layers\[i\]\.locked = true;/);
    assert.match(unlock, /doc\.layers\[i\]\.locked = false;/);
    assert.match(sel, /doc\.select\(items\)/);
    assert.match(rows, /__invoke\(18442, "Small Panel Rows"\)/);
    const r = tool('run_layer_command').handler;
    assert.throws(() => r({ command: 'duplicate' }), /'layer' is required/);
    assert.throws(() => r({ command: 'small_panel_rows' }), /'on'/);
});

await test('send_items_to_layer and manage_layer_objects move, list and update items', async () => {
    const [move, list, upd] = await scriptsFor([
        ['send_items_to_layer', { target: T, layer: 'Text', create: true }],
        ['manage_layer_objects', { action: 'list', layer: 'Text' }],
        ['manage_layer_objects', { action: 'update', target: T, name: 'Logo', locked: true }],
    ]);
    assert.match(move, /items\[i\]\.itemLayer = l;/);
    assert.match(move, /doc\.layers\.add\(\{ name: "Text" \}\)/);
    assert.match(list, /__onSpread\(layers\[i\], sp\)/);
    assert.match(upd, /items\[0\]\.name = "Logo";/);
    assert.match(upd, /items\[k\]\.locked = true;/);
    assert.throws(() => tool('send_items_to_layer').handler({ target: {}, layer: 'Text' }), /Choose the items/);
    assert.throws(() => tool('manage_layer_objects').handler({ action: 'update', target: T }), /Nothing to change/);
});

// Selection and clipboard

await test('select_layout_objects runs the select commands', async () => {
    const [all, none, cont, content, group, next, above, parent, guides, items] = await scriptsFor([
        ['select_layout_objects', { action: 'all' }],
        ['select_layout_objects', { action: 'none' }],
        ['select_layout_objects', { action: 'container', target: T }],
        ['select_layout_objects', { action: 'content' }],
        ['select_layout_objects', { action: 'group', target: T }],
        ['select_layout_objects', { action: 'next_in_group' }],
        ['select_layout_objects', { action: 'first_object_above' }],
        ['select_layout_objects', { action: 'parent_item', pageIndex: 2, parentItemId: 99 }],
        ['select_layout_objects', { action: 'all_guides', spreadIndex: 1 }],
        ['select_layout_objects', { action: 'items', target: T, mode: 'add' }],
    ]);
    assert.match(all, /doc\.select\(SelectAll\.ALL\);/);
    assert.match(none, /doc\.select\(NothingEnum\.NOTHING\);/);
    assert.match(cont, /var p = s\.parent;/);
    assert.match(content, /next = s\.graphics\[0\]/);
    assert.match(group, /while \(g\.constructor\.name === "Group"\)/);
    assert.match(next, /__invoke\(11356, "Next Object in Group"\);/);
    assert.match(above, /__invoke\(11289, "First Object Above"\);/);
    assert.match(parent, /var o = mi\.override\(pg\);/);
    assert.match(guides, /doc\.select\(guides\);/);
    assert.match(items, /SelectionOptions\.ADD_TO/);
    const s = tool('select_layout_objects').handler;
    assert.throws(() => s({ action: 'items' }), /'target' is required/);
    assert.throws(() => s({ action: 'parent_item', pageIndex: 0 }), /parentItemId/);
    assert.throws(() => s({ action: 'lasso' }), /Allowed: items/);
});

await test('set_active_tool chooses or toggles the selection tools', async () => {
    const [direct, toggle] = await scriptsFor([
        ['set_active_tool', { tool: 'DIRECT_SELECTION_TOOL' }],
        ['set_active_tool', { tool: 'toggle_selection_tools' }],
    ]);
    assert.match(direct, /tb\.currentTool = UITools\.DIRECT_SELECTION_TOOL;/);
    assert.match(toggle, /UITools\.SELECTION_TOOL \? UITools\.DIRECT_SELECTION_TOOL : UITools\.SELECTION_TOOL/);
    assert.throws(() => tool('set_active_tool').handler({ tool: 'MAGIC_WAND' }), /Allowed: toggle_selection_tools/);
});

await test('run_clipboard_command cuts, copies and pastes', async () => {
    const [cut, pin, place, plain] = await scriptsFor([
        ['run_clipboard_command', { command: 'cut', target: T }],
        ['run_clipboard_command', { command: 'paste_into', target: T }],
        ['run_clipboard_command', { command: 'paste_in_place' }],
        ['run_clipboard_command', { command: 'paste_without_formatting' }],
    ]);
    assert.match(cut, /app\.cut\(\);/);
    assert.match(pin, /app\.pasteInto\(\);/);
    assert.match(place, /app\.pasteInPlace\(\);/);
    assert.match(plain, /app\.pasteWithoutFormatting\(\);/);
    assert.throws(() => tool('run_clipboard_command').handler({ command: 'paste_special' }), /Allowed: cut/);
});

await test('step_and_repeat_items duplicates with offsets, nudges and grids in one undo step', async () => {
    const [off, nudge, grid, count] = await scriptsFor([
        ['step_and_repeat_items', { target: T, dx: 5, dy: -2 }],
        ['step_and_repeat_items', { target: T, mode: 'nudge', direction: 'left', factor: 'times_10', undoMode: 'script_request' }],
        ['step_and_repeat_items', { target: T, mode: 'step_and_repeat', rows: 2, columns: 2, dx: 30, dy: 40 }],
        ['step_and_repeat_items', { target: T, mode: 'step_and_repeat', count: 3, dx: 10 }],
    ]);
    assert.match(off, /var offsets = \[\[5,-2\]\];/);
    assert.match(off, /items\[i\]\.duplicate\(undefined, offsets\[k\]\)/);
    assert.match(off, /UndoModes\.ENTIRE_SCRIPT, "Duplicate"/);
    assert.match(nudge, /doc\.viewPreferences\.cursorKeyIncrement \* 10/);
    assert.match(nudge, /\[\[-1 \* inc, 0 \* inc\]\]/);
    assert.match(nudge, /UndoModes\.SCRIPT_REQUEST/);
    assert.match(grid, /var offsets = \[\[30,0\],\[0,40\],\[30,40\]\];/);
    assert.match(count, /var offsets = \[\[10,0\],\[20,0\],\[30,0\]\];/);
    const d = tool('step_and_repeat_items').handler;
    assert.throws(() => d({ target: T }), /dx and\/or dy/);
    assert.throws(() => d({ target: T, mode: 'nudge' }), /Allowed: up/);
    assert.throws(() => d({ target: T, mode: 'step_and_repeat', rows: 1, columns: 1, dx: 1 }), /more than one cell/);
    assert.throws(() => d({ target: T, dx: 1, undoMode: 'never' }), /Allowed: entire_script/);
});

await test('set_clipboard_preferences sets clipboard and drag-and-drop preferences', async () => {
    const s = await one('set_clipboard_preferences', { clipboard: { preferPDFWhenPasting: true, preferStyledTextWhenPasting: false, pasteRemembersLayers: true }, dragAndDrop: { dragAndDropTextInLayout: true } });
    assert.match(s, /cp\.preferPDFWhenPasting = true;/);
    assert.match(s, /cp\.preferStyledTextWhenPasting = false;/);
    assert.match(s, /cp\.pasteRemembersLayers = true;/);
    assert.match(s, /tp\.dragAndDropTextInLayout = true;/);
    assert.throws(() => tool('set_clipboard_preferences').handler({ clipboard: { pasteAll: true } }), /Unknown option/);
});

// History

await test('manage_undo_history undoes, redoes and lists the history', async () => {
    const [undo, redo, list] = await scriptsFor([
        ['manage_undo_history', { action: 'undo', steps: 3 }],
        ['manage_undo_history', { action: 'redo' }],
        ['manage_undo_history', { action: 'list' }],
    ]);
    assert.match(undo, /for \(var i = 0; i < 3; i\+\+\) \{ if \(doc\.undoHistory\.length === 0\) break; undone\.push\(doc\.undoName\); doc\.undo\(\); \}/);
    assert.match(redo, /doc\.redo\(\);/);
    assert.match(list, /undoHistory: doc\.undoHistory, redoHistory: doc\.redoHistory/);
    assert.throws(() => tool('manage_undo_history').handler({ action: 'undo', steps: 0 }), /at least 1/);
    assert.throws(() => tool('manage_undo_history').handler({ action: 'clear' }), /Allowed: list/);
});

done();
