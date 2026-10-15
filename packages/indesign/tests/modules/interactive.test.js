/**
 * Interactive document tools: the object-model statements their scripts carry,
 * and the arguments they refuse.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test, done, tool, scriptsFor, home } from './helpers.js';

const T = { ids: [5] };
const one = async (name, args) => (await scriptsFor([[name, args]]))[0];
const inHome = (f) => path.join(home, 'Documents', f);
const B = { pageIndex: 0, x: 10, y: 20, width: 30, height: 15 };

await test('create_button converts items or makes an empty button, with appearances', async () => {
    const [fromItems, empty] = await scriptsFor([
        ['create_button', { target: T, name: 'Next', description: 'Next page', appearances: ['rollover', 'click'] }],
        ['create_button', { bounds: B }],
    ]);
    assert.match(fromItems, /var gb = __union\(src\);/);
    assert.match(fromItems, /var b = pg\.buttons\.add\(\{ geometricBounds: gb, itemLayer: lay \}\);/);
    assert.match(fromItems, /b\.states\.item\(0\)\.addItemsToState\(src\);/);
    assert.match(fromItems, /b\.name = "Next";/);
    assert.match(fromItems, /b\.description = "Next page";/);
    assert.match(fromItems, /__addState\(b, StateTypes\.ROLLOVER\);/);
    assert.match(fromItems, /__addState\(b, StateTypes\.DOWN\);/);
    assert.match(empty, /var tl = __toPage\(pg, 10, 20\);/);
    assert.match(empty, /var gb = \[tl\[1\], tl\[0\], tl\[1\] \+ 15, tl\[0\] \+ 30\];/);
    const make = tool('create_button').handler;
    assert.throws(() => make({}), /Give target \(items to convert\) or bounds/);
    assert.throws(() => make({ target: T, bounds: B }), /not both/);
    assert.throws(() => make({ bounds: { ...B, width: 0 } }), /out of range/);
    assert.throws(() => make({ bounds: { ...B, z: 1 } }), /Unknown option 'bounds\.z'/);
    assert.throws(() => make({ target: T, appearances: ['hover'] }), /Allowed: rollover, click/);
});

await test('set_button_options sets PDF options and appearances', async () => {
    const s = await one('set_button_options', {
        target: T, description: 'Play', printableInPdf: true, hiddenUntilTriggered: true,
        appearances: { normal: { addItems: [7] }, rollover: { enabled: true }, click: { enabled: false } }, show: 'rollover',
    });
    assert.match(s, /__need\(it, \["Button"\], "set_button_options"\);/);
    assert.match(s, /it\.description = "Play";/);
    assert.match(s, /it\.printableInPdf = true;/);
    assert.match(s, /it\.hiddenUntilTriggered = true;/);
    assert.match(s, /var st = __stateOf\(it, StateTypes\.UP\) \|\| it\.states\.item\(0\);/);
    assert.match(s, /st\.addItemsToState\(add\);/);
    assert.match(s, /var st = __addState\(it, StateTypes\.ROLLOVER\);/);
    assert.match(s, /var off = __stateOf\(it, StateTypes\.DOWN\); if \(off\) off\.enabled = false;/);
    assert.match(s, /it\.activeStateIndex = sh\.index;/);
    const set = tool('set_button_options').handler;
    assert.throws(() => set({ target: T }), /Nothing to set/);
    assert.throws(() => set({ target: T, appearances: { normal: { enabled: false } } }), /Unknown option 'appearances\.normal\.enabled'/);
    assert.throws(() => set({ target: T, appearances: { click: { enabled: false, addItems: [1] } } }), /enabled: false/);
    assert.throws(() => set({ target: T, appearances: { rollover: {} } }), /give enabled or addItems/);
    assert.throws(() => set({ target: T, show: 'hover' }), /Allowed: normal, rollover, click/);
    assert.throws(() => set({ target: T, printableInPdf: 'yes' }), /true or false/);
});

await test('create_form_field makes each field type with its options', async () => {
    const [text, list, check] = await scriptsFor([
        ['create_form_field', { kind: 'text_field', bounds: B, name: 'Email', password: true, multiline: true, scrollable: false, fontSize: 0, font: { family: 'Arial', style: 'Bold' }, required: true }],
        ['create_form_field', { kind: 'list_box', bounds: B, choices: ['Red', 'Green'], sortChoices: true, multipleSelection: true }],
        ['create_form_field', { kind: 'check_box', target: T, checkedByDefault: true, exportValue: 'Yes' }],
    ]);
    assert.match(text, /var it = pg\.textBoxes\.add\(\{ geometricBounds: gb, itemLayer: lay \}\);/);
    assert.match(text, /it\.name = "Email";/);
    assert.match(text, /__need\(it, \["TextBox"\], "password"\); it\.password = true;/);
    assert.match(text, /it\.multiline = true;/);
    assert.match(text, /it\.scrollable = false;/);
    assert.match(text, /it\.fontSize = 0;/);
    assert.match(text, /it\.appliedFont = "Arial";/);
    assert.match(text, /it\.fontStyle = "Bold";/);
    assert.match(text, /it\.required = true;/);
    assert.match(list, /pg\.listBoxes\.add/);
    assert.match(list, /it\.choiceList = \["Red","Green"\];/);
    assert.match(list, /it\.sortChoices = true;/);
    assert.match(list, /__need\(it, \["ListBox"\], "multipleSelection"\); it\.multipleSelection = true;/);
    assert.match(check, /pg\.checkBoxes\.add/);
    assert.match(check, /it\.states\.item\(0\)\.addItemsToState\(src\);/);
    assert.match(check, /it\.checkedByDefault = true;/);
    assert.match(check, /it\.exportValue = "Yes";/);
    const [radio, combo, sig] = await scriptsFor([
        ['create_form_field', { kind: 'radio_button', bounds: B }],
        ['create_form_field', { kind: 'combo_box', bounds: B }],
        ['create_form_field', { kind: 'signature_field', bounds: B }],
    ]);
    assert.match(radio, /pg\.radioButtons\.add/);
    assert.match(combo, /pg\.comboBoxes\.add/);
    assert.match(sig, /pg\.signatureFields\.add/);
    const make = tool('create_form_field').handler;
    assert.throws(() => make({ kind: 'slider', bounds: B }), /Allowed: text_field/);
    assert.throws(() => make({ kind: 'text_field' }), /Give target/);
    assert.throws(() => make({ kind: 'text_field', bounds: B, fontSize: 2000 }), /out of range/);
    assert.throws(() => make({ kind: 'list_box', bounds: B, choices: 'a,b' }), /list of up to 500 strings/);
    assert.throws(() => make({ kind: 'text_field', bounds: B, font: {} }), /needs family or style/);
    assert.throws(() => make({ kind: 'text_field', bounds: B, font: { size: 3 } }), /Unknown option 'font\.size'/);
});

await test('set_form_field_options writes every option, checked per field type', async () => {
    const s = await one('set_form_field_options', {
        target: T, description: 'Your name', printableInPdf: false, readOnly: true, hiddenUntilTriggered: false, rightToLeft: false,
    });
    assert.match(s, /__need\(it, \["TextBox","CheckBox","RadioButton","ComboBox","ListBox","SignatureField"\], "set_form_field_options"\);/);
    assert.match(s, /it\.description = "Your name";/);
    assert.match(s, /it\.printableInPdf = false;/);
    assert.match(s, /it\.readOnly = true;/);
    assert.match(s, /__need\(it, \["TextBox","ComboBox","ListBox"\], "rightToLeft"\); it\.rightToLeftField = false;/);
    assert.throws(() => tool('set_form_field_options').handler({ target: T }), /Nothing to set/);
    assert.throws(() => tool('set_form_field_options').handler({ target: {}, required: true }), /Choose the items/);
});

await test('add_button_action adds each behavior with its options', async () => {
    const scripts = await scriptsFor([
        ['add_button_action', { target: T, action: 'go_to_destination', destination: { name: 'Intro' }, zoom: 'FIT_WINDOW' }],
        ['add_button_action', { target: T, action: 'go_to_destination', destination: { pageIndex: 2, name: 'Chapter 2' } }],
        ['add_button_action', { target: T, action: 'go_to_destination', destination: { name: 'Index', document: inHome('other.indd') } }],
        ['add_button_action', { target: T, action: 'go_to_page', pageIndex: 3, event: 'MOUSE_ENTER' }],
        ['add_button_action', { target: T, action: 'go_to_url', url: 'https://example.com' }],
        ['add_button_action', { target: T, action: 'go_to_state', multiStateObject: 9, stateName: 'Open', goBackOnRollOff: true }],
        ['add_button_action', { target: T, action: 'go_to_next_state', multiStateObject: 9, loop: false }],
        ['add_button_action', { target: T, action: 'show_hide_fields', show: [11], hide: [12, 13] }],
        ['add_button_action', { target: T, action: 'video', mediaItem: 8, mediaOperation: 'PLAY_FROM_NAVIGATION_POINT', navigationPoint: 'Chorus' }],
        ['add_button_action', { target: T, action: 'sound', mediaItem: 8, mediaOperation: 'STOP' }],
        ['add_button_action', { target: T, action: 'animation', mediaItem: 8, mediaOperation: 'REVERSE_PLAYBACK', autoReverseOnRollOff: true }],
        ['add_button_action', { target: T, action: 'open_file', filePath: inHome('brochure.pdf') }],
        ['add_button_action', { target: T, action: 'view_zoom', viewZoom: 'FULL_SCREEN' }],
        ['add_button_action', { target: T, action: 'submit_form', url: 'mailto:forms@example.com' }],
        ['add_button_action', { target: T, action: 'print_form', event: 'ON_BLUR' }],
    ]);
    const [anchor, pageDest, crossDoc, page, url, state, next, showHide, video, sound, anim, open, zoom, submit, print] = scripts;
    assert.match(anchor, /var bh = it\.gotoAnchorBehaviors\.add\(\{ behaviorEvent: BehaviorEvents\.MOUSE_UP \}\);/);
    assert.match(anchor, /bh\.zoomSetting = GoToZoomOptions\.FIT_WINDOW;/);
    assert.match(anchor, /var dest = __destByName\(dd, "Intro"\);/);
    assert.match(anchor, /bh\.anchorItem = dest;/);
    assert.match(pageDest, /var dest = __pageDest\(dd, __page\(dd, 2\), "Chapter 2"\);/);
    assert.match(pageDest, /var made = pd\.add\(p\);/);
    assert.match(crossDoc, /var dd = __openDoc\(df\);/);
    assert.match(crossDoc, /bh\.filePath = df;/);
    assert.match(page, /it\.gotoPageBehaviors\.add\(\{ behaviorEvent: BehaviorEvents\.MOUSE_ENTER \}\);/);
    assert.match(page, /bh\.pageNumber = 4;/);
    assert.match(url, /bh\.url = "https:\/\/example\.com";/);
    assert.match(state, /bh\.associatedMultiStateObject = mso;/);
    assert.match(state, /bh\.stateName = "Open";/);
    assert.match(state, /bh\.goBackOnRollOff = true;/);
    assert.match(next, /it\.gotoNextStateBehaviors\.add/);
    assert.match(next, /bh\.loopsToNextOrPrevious = false;/);
    assert.match(showHide, /bh\.fieldsToShow = show;/);
    assert.match(showHide, /bh\.fieldsToHide = hide;/);
    assert.match(video, /bh\.movieItem = mi;/);
    assert.match(video, /bh\.operation = MoviePlayOperations\.PLAY_FROM_NAVIGATION_POINT;/);
    assert.match(video, /bh\.navigationPointID = np\.id;/);
    assert.match(sound, /bh\.soundItem = mi;/);
    assert.match(sound, /bh\.operation = PlayOperations\.STOP;/);
    assert.match(anim, /bh\.animatedPageItem = __byId\(doc, 8\);/);
    assert.match(anim, /bh\.operation = AnimationPlayOperations\.REVERSE_PLAYBACK;/);
    assert.match(anim, /bh\.autoReverseOnRollOff = true;/);
    assert.match(open, /bh\.filePath = File\(".*brochure\.pdf"\);/);
    assert.match(zoom, /bh\.viewZoomStyle = ViewZoomStyle\.FULL_SCREEN;/);
    assert.match(submit, /it\.submitFormBehaviors\.add/);
    assert.match(submit, /bh\.url = "mailto:forms@example\.com";/);
    assert.match(print, /it\.printFormBehaviors\.add\(\{ behaviorEvent: BehaviorEvents\.ON_BLUR \}\);/);
    const simple = await scriptsFor(['go_to_first_page', 'go_to_last_page', 'go_to_next_page', 'go_to_previous_page', 'go_to_next_view',
        'go_to_previous_view', 'go_to_previous_state', 'clear_form'].map((action) => ['add_button_action', { target: T, action, ...(action === 'go_to_previous_state' ? { multiStateObject: 9 } : {}) }]));
    for (const [i, coll] of ['gotoFirstPageBehaviors', 'gotoLastPageBehaviors', 'gotoNextPageBehaviors', 'gotoPreviousPageBehaviors', 'gotoNextViewBehaviors',
        'gotoPreviousViewBehaviors', 'gotoPreviousStateBehaviors', 'clearFormBehaviors'].entries()) {
        assert.match(simple[i], new RegExp(`it\\.${coll}\\.add`));
    }
});

await test('add_button_action refuses missing and misplaced options', () => {
    const add = tool('add_button_action').handler;
    assert.throws(() => add({ target: T, action: 'teleport' }), /Allowed: go_to_destination/);
    assert.throws(() => add({ target: T, action: 'go_to_url' }), /'url' is required/);
    assert.throws(() => add({ target: T, action: 'go_to_url', url: 'javascript:alert(1)' }), /must be a URL/);
    assert.throws(() => add({ target: T, action: 'go_to_page' }), /'pageIndex' is required/);
    assert.throws(() => add({ target: T, action: 'go_to_url', url: 'https://a.b', zoom: 'FIT_WINDOW' }), /'zoom' does not apply/);
    assert.throws(() => add({ target: T, action: 'clear_form', url: 'https://a.b' }), /'url' does not apply to action clear_form/);
    assert.throws(() => add({ target: T, action: 'go_to_state', multiStateObject: 9 }), /'stateName' is required/);
    assert.throws(() => add({ target: T, action: 'go_to_destination', destination: {} }), /needs name/);
    assert.throws(() => add({ target: T, action: 'go_to_destination', destination: { name: 'a', document: '/etc/passwd' } }), /Access denied/);
    assert.throws(() => add({ target: T, action: 'show_hide_fields' }), /'show' or 'hide' is required/);
    assert.throws(() => add({ target: T, action: 'sound', mediaItem: 3, mediaOperation: 'REVERSE_PLAYBACK' }), /Allowed: PLAY/);
    assert.throws(() => add({ target: T, action: 'video', mediaItem: 3, mediaOperation: 'PLAY_FROM_NAVIGATION_POINT' }), /'navigationPoint' is required/);
    assert.throws(() => add({ target: T, action: 'video' }), /'mediaItem' is required/);
    assert.throws(() => add({ target: T, action: 'view_zoom', viewZoom: 'HUGE' }), /Allowed: FULL_SCREEN/);
    assert.throws(() => add({ target: T, action: 'print_form', event: 'DOUBLE_CLICK' }), /Allowed: MOUSE_UP/);
});

await test('edit_button_actions removes, toggles and re-times actions', async () => {
    const [all, oneAction] = await scriptsFor([
        ['edit_button_actions', { target: T, operation: 'remove' }],
        ['edit_button_actions', { target: T, operation: 'set_event', actionIndex: 1, event: 'MOUSE_DOWN' }],
    ]);
    assert.match(all, /for \(var k = it\.behaviors\.length - 1; k >= 0; k--\) \{ var x = it\.behaviors\.item\(k\); x\.remove\(\); \}/);
    assert.match(oneAction, /var x = it\.behaviors\.item\(ai\); x\.behaviorEvent = BehaviorEvents\.MOUSE_DOWN;/);
    const edit = tool('edit_button_actions').handler;
    assert.throws(() => edit({ target: T, operation: 'set_event' }), /'event' is required/);
    assert.throws(() => edit({ target: T, operation: 'remove', event: 'MOUSE_UP' }), /'event' is required for, and only for/);
    assert.throws(() => edit({ target: T, operation: 'disable', actionIndex: -1 }), /Invalid index/);
});

await test('set_tab_order, convert and reset', async () => {
    const [tab, convert, reset, resetMso] = await scriptsFor([
        ['set_tab_order', { pageIndex: 1, order: [4, 3, 5] }],
        ['convert_interactive_to_object', { target: T }],
        ['reset_interactive_states', {}],
        ['reset_interactive_states', { reset: 'multi_state_objects' }],
    ]);
    assert.match(tab, /ids = \[4,3,5\]/);
    assert.match(tab, /pg\.tabOrder = list;/);
    assert.match(convert, /it\.convertToObject\(\);/);
    assert.match(reset, /doc\.resetAllButtons\(\);/);
    assert.match(reset, /doc\.resetAllMultiStateObjects\(\);/);
    assert.doesNotMatch(resetMso, /resetAllButtons\(\)/);
    assert.throws(() => tool('set_tab_order').handler({ pageIndex: 0, order: [] }), /list of 1 to 500 item ids/);
    assert.throws(() => tool('reset_interactive_states').handler({ reset: 'forms' }), /Allowed: all/);
});

await test('create_multi_state_object makes one state per item or per group', async () => {
    const [perItem, groups] = await scriptsFor([
        ['create_multi_state_object', { target: { ids: [5, 6, 7] }, name: 'Gallery', hiddenUntilTriggered: true }],
        ['create_multi_state_object', { states: [{ ids: [5], name: 'Closed' }, { ids: [6, 7], name: 'Open' }] }],
    ]);
    assert.match(perItem, /var mso = pg\.multiStateObjects\.add\(\{ geometricBounds: __union\(all\), itemLayer: all\[0\]\.itemLayer \}\);/);
    assert.match(perItem, /if \(s < initial\) mso\.states\.item\(s\)\.addItemsToState\(groups\[s\]\.items\); else mso\.addItemsAsState\(groups\[s\]\.items\);/);
    assert.match(perItem, /mso\.states\.item\(r\)\.remove\(\);/);
    assert.match(perItem, /mso\.name = "Gallery";/);
    assert.match(perItem, /mso\.initiallyHidden = true;/);
    assert.match(groups, /var groups = \[\{ ids: \[5\], name: "Closed" \}, \{ ids: \[6,7\], name: "Open" \}\];/);
    const make = tool('create_multi_state_object').handler;
    assert.throws(() => make({}), /Give target/);
    assert.throws(() => make({ target: T, states: [] }), /not both/);
    assert.throws(() => make({ states: [{ ids: [1] }] }), /2 to 100 states/);
    assert.throws(() => make({ states: [{ ids: [1] }, { ids: [] }] }), /states\[1\]\.ids/);
});

await test('edit_object_states performs each Object States panel command', async () => {
    const scripts = await scriptsFor([
        ['edit_object_states', { multiStateObject: 9, operation: 'new_state', ids: [3], name: 'Extra' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'delete_state', state: 'Extra' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'rename_state', state: 'A', name: 'B' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'move_state', state: 'A', position: 0 }],
        ['edit_object_states', { multiStateObject: 9, operation: 'show_state', state: 'A' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'add_to_state', ids: [3, 4] }],
        ['edit_object_states', { multiStateObject: 9, operation: 'paste_into_state', ids: [3], state: 'A' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'release_state', state: 'A' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'release_all' }],
        ['edit_object_states', { multiStateObject: 9, operation: 'set_hidden', hidden: true }],
    ]);
    const [add, del, rename, move, show, addTo, paste, release, releaseAll, hidden] = scripts;
    assert.match(add, /mso\.addItemsAsState\(its\);/);
    assert.match(add, /st\.name = "Extra";/);
    assert.match(del, /st\.remove\(\);/);
    assert.match(rename, /st\.name = "B";/);
    assert.match(move, /st\.move\(to\);/);
    assert.match(show, /mso\.activeStateIndex = st\.index;/);
    assert.match(addTo, /var st = mso\.states\.item\(mso\.activeStateIndex\);/);
    assert.match(addTo, /st\.addItemsToState\(its\);/);
    assert.match(paste, /dups\.push\(its\[d\]\.duplicate\(\)\);/);
    assert.match(paste, /st\.addItemsToState\(dups\);/);
    assert.match(release, /st\.releaseAsObject\(\);/);
    assert.match(releaseAll, /mso\.releaseAsObjects\(\);/);
    assert.match(hidden, /mso\.initiallyHidden = true;/);
    const edit = tool('edit_object_states').handler;
    assert.throws(() => edit({ multiStateObject: 9, operation: 'explode' }), /Allowed: new_state/);
    assert.throws(() => edit({ multiStateObject: 9, operation: 'delete_state' }), /'state' is required/);
    assert.throws(() => edit({ multiStateObject: 9, operation: 'release_all', state: 'A' }), /'state' does not apply/);
    assert.throws(() => edit({ multiStateObject: 9, operation: 'set_hidden', hidden: 'no' }), /true or false/);
});

await test('set_animation writes preset, timing, transforms, visibility, motion path and events', async () => {
    const [full, convert, remove] = await scriptsFor([
        ['set_animation', {
            target: T, preset: 'fly-in-left', duration: 2, plays: 3, loop: false, speed: 'ease_in_out', animate: 'to_current_appearance',
            rotate: 180, scale: { x: 150 }, opacity: 'fade_out', origin: 'bottom_right', hideUntilAnimated: true, hideAfterAnimating: true,
            motionPath: [[0, 0], [50, 10]], events: ['ON_PAGE_CLICK', 'ON_SELF_ROLLOVER'], reverseOnRollOff: true,
        }],
        ['set_animation', { target: T, motionPathFrom: 12, keepPath: true }],
        ['set_animation', { target: T, remove: true }],
    ]);
    assert.match(full, /s\.preset = __preset\("fly-in-left", doc\);/);
    assert.match(full, /s\.duration = 2;/);
    assert.match(full, /s\.plays = 3;/);
    assert.match(full, /s\.playsLoop = false;/);
    assert.match(full, /s\.easeType = AnimationEaseOptions\.EASE_IN_OUT;/);
    assert.match(full, /s\.designOption = DesignOptions\.TO_CURRENT_APPEARANCE;/);
    assert.match(full, /var lf = Math\.max\(1, Math\.round\(s\.duration \* 24\) - 1\);/);
    assert.match(full, /s\.rotationArray = \[\[0, 0\], \[lf, 180\]\];/);
    assert.match(full, /s\.scaleXArray = \[\[0, 100\], \[lf, 150\]\];/);
    assert.match(full, /s\.scaleYArray = \[\[0, 100\], \[lf, 100\]\];/);
    assert.match(full, /s\.opacityArray = \[\[0, 100\], \[lf, 0\]\];/);
    assert.match(full, /s\.transformOffsets = \[1,1\];/);
    assert.match(full, /s\.initiallyHidden = true;/);
    assert.match(full, /s\.hiddenAfter = true;/);
    assert.match(full, /app\.scriptPreferences\.measurementUnit = MeasurementUnits\.POINTS;/);
    assert.match(full, /s\.motionPathPoints = \[pp, true\];/);
    assert.match(full, /var evs = \["ON_PAGE_CLICK","ON_SELF_ROLLOVER"\]/);
    assert.match(full, /pl\.timingGroups\.add\(it, 0\);/);
    assert.match(full, /ro\.target\.reverseAnimation = true;/);
    assert.ok(full.indexOf('s.preset =') < full.indexOf('s.duration ='), 'the preset is applied before the other settings');
    assert.match(convert, /var ep = pathItem\.paths\.item\(0\)\.entirePath/);
    assert.match(convert, /s\.motionPathPoints = \[pp, pathItem\.paths\.item\(0\)\.pathType == PathType\.OPEN_PATH\];/);
    assert.doesNotMatch(convert, /pathItem\.remove\(\)/);
    assert.match(remove, /s\.preset = NothingEnum\.NOTHING;/);
    const [deletesPath] = await scriptsFor([['set_animation', { target: T, motionPathFrom: 12 }]]);
    assert.match(deletesPath, /if \(pathItem\.isValid\) pathItem\.remove\(\);/);
    const set = tool('set_animation').handler;
    assert.throws(() => set({ target: T }), /Nothing to set/);
    assert.throws(() => set({ target: T, duration: 0.1 }), /out of range/);
    assert.throws(() => set({ target: T, plays: 0 }), /whole number from 1/);
    assert.throws(() => set({ target: T, speed: 'fast' }), /Allowed: none, ease_in/);
    assert.throws(() => set({ target: T, remove: true, duration: 2 }), /cannot be combined/);
    assert.throws(() => set({ target: T, motionPath: [[0, 0]] }), /2 to 200/);
    assert.throws(() => set({ target: T, motionPath: [[0, 0], [1]] }), /motionPath\[1\]' must be \[x, y\]/);
    assert.throws(() => set({ target: T, motionPath: [[0, 0], [1, 1]], motionPathFrom: 3 }), /not both/);
    assert.throws(() => set({ target: T, keepPath: true }), /applies with motionPathFrom/);
    assert.throws(() => set({ target: T, events: ['ON_BUTTON_EVENT'] }), /Allowed: ON_PAGE_LOAD/);
    assert.throws(() => set({ target: T, events: ['ON_PAGE_LOAD'], reverseOnRollOff: true }), /ON_SELF_ROLLOVER/);
    assert.throws(() => set({ target: T, scale: 120 }), /'scale' must be an object/);
    assert.throws(() => set({ target: T, origin: 'middle' }), /Allowed: top_left/);
});

await test('manage_motion_presets saves, imports, exports, duplicates and deletes', async () => {
    const [save, imp, exp, dup, del] = await scriptsFor([
        ['manage_motion_presets', { operation: 'save_from_item', name: 'Bounce', itemId: 5 }],
        ['manage_motion_presets', { operation: 'import', filePath: inHome('bounce.xml') }],
        ['manage_motion_presets', { operation: 'export', name: 'Bounce', filePath: inHome('bounce.xml') }],
        ['manage_motion_presets', { operation: 'duplicate', name: 'Bounce', newName: 'Bounce 2', scope: 'document' }],
        ['manage_motion_presets', { operation: 'delete', name: 'Bounce' }],
    ]);
    assert.match(save, /\.animationSettings\.save\("Bounce"\);/);
    assert.match(imp, /var mp = app\.loadMotionPreset\(f\);/);
    assert.match(exp, /mp\.saveACopy\(File\(".*bounce\.xml"\)\);/);
    assert.match(dup, /var mp = __doc\(\)\.motionPresets\.itemByName\("Bounce"\);/);
    assert.match(dup, /mp = mp\.duplicate\("Bounce 2"\);/);
    assert.match(del, /mp\.remove\(\);/);
    const mm = tool('manage_motion_presets').handler;
    assert.throws(() => mm({ operation: 'export', name: 'x' }), /'filePath' is required/);
    assert.throws(() => mm({ operation: 'list', name: 'x' }), /'name' does not apply/);
    assert.throws(() => mm({ operation: 'import', filePath: '/etc/x.xml' }), /Access denied/);
    assert.throws(() => mm({ operation: 'delete', name: 'x', scope: 'library' }), /Allowed: application, document/);
});

await test('set_timing reassigns, removes, links and unlinks timing groups', async () => {
    const [assign, remove, together, apart, set] = await scriptsFor([
        ['set_timing', { target: T, operation: 'assign', event: 'ON_PAGE_CLICK', delay: 1 }],
        ['set_timing', { target: T, operation: 'remove', event: 'ON_PAGE_LOAD' }],
        ['set_timing', { target: { ids: [5, 6] }, operation: 'play_together', delay: 0.5 }],
        ['set_timing', { target: { ids: [5, 6] }, operation: 'play_separately' }],
        ['set_timing', { target: T, operation: 'set', delay: 2, plays: 3, loop: true }],
    ]);
    assert.match(assign, /__ensureList\(ts, DynamicTriggerEvents\.ON_PAGE_CLICK\)\.timingGroups\.add\(it, 1\);/);
    assert.match(remove, /tl0\.triggerEvent == DynamicTriggerEvents\.ON_PAGE_LOAD/);
    assert.match(remove, /__drop\(lists\[e\], items\[i\]\);/);
    assert.match(together, /home\.group\.timingTargets\.add\(items\[i\], 0\.5\);/);
    assert.match(apart, /f\.target\.unlink\(\);/);
    assert.match(set, /f\.target\.delaySeconds = 2;/);
    assert.match(set, /f\.group\.plays = 3;/);
    assert.match(set, /f\.group\.playsLoop = true;/);
    const timing = tool('set_timing').handler;
    assert.throws(() => timing({ target: T, operation: 'assign' }), /'event' is required/);
    assert.throws(() => timing({ target: T, operation: 'assign', event: 'ON_SELF_CLICK' }), /Allowed: ON_PAGE_LOAD, ON_PAGE_CLICK/);
    assert.throws(() => timing({ target: T, operation: 'remove', delay: 1 }), /'delay' does not apply/);
    assert.throws(() => timing({ target: T, operation: 'assign', event: 'ON_PAGE_LOAD', plays: 2 }), /apply to operation set/);
    assert.throws(() => timing({ target: T, operation: 'set' }), /Nothing to set/);
});

await test('place_media places a file or URL video and applies options', async () => {
    const [file, url] = await scriptsFor([
        ['place_media', { filePath: inHome('clip.mp4'), bounds: B, options: { playOnPageLoad: true, loop: true, controller: 'SkinOverAll' } }],
        ['place_media', { url: 'https://example.com/clip.mp4', frame: 4 }],
    ]);
    assert.match(file, /var frame = pg\.rectangles\.add\(\{ geometricBounds: gb, itemLayer: lay \}\);/);
    assert.match(file, /var placed = frame\.place\(f\), m = null;/);
    assert.match(file, /m\.playOnPageTurn = true;/);
    assert.match(file, /m\.movieLoop = true; else m\.soundLoop = true;/);
    assert.match(file, /__need\(m, \["Movie"\], "controller"\); m\.controllerSkin = "SkinOverAll";/);
    assert.match(url, /var frame = __byId\(doc, 4\);/);
    assert.match(url, /var m = frame\.movies\.add\(\);\nm\.url = "https:\/\/example\.com\/clip\.mp4";/);
    const place = tool('place_media').handler;
    assert.throws(() => place({ bounds: B }), /Give filePath or url/);
    assert.throws(() => place({ filePath: inHome('a.mp4') }), /Give frame/);
    assert.throws(() => place({ filePath: '/etc/a.mp4', frame: 3 }), /Access denied/);
    assert.throws(() => place({ url: 'ftp:x', frame: 3 }), /must be a URL/);
    assert.throws(() => place({ url: 'https://a.b/c.mp4', frame: 3, options: { autoplay: true } }), /Unknown option 'options\.autoplay'/);
});

await test('set_media_options sets poster, controller, floating window, navigation points and relinks', async () => {
    const [video, sound] = await scriptsFor([
        ['set_media_options', {
            target: T, poster: 'image', posterFile: inHome('poster.jpg'), showControllerOnRollover: true, floatingWindow: true,
            floatingWindowSize: 'ONE_HALF', floatingWindowPosition: 'UPPER_RIGHT', embedInPDF: true, description: 'Intro video',
            navigationPoints: { clear: true, add: [{ name: 'Start', time: 0 }, { name: 'Chorus', time: 42.5 }], remove: ['Old'] },
            relinkTo: inHome('clip.mp4'),
        }],
        ['set_media_options', { target: T, poster: 'standard', stopOnPageTurn: true, doNotPrintPoster: true }],
    ]);
    assert.match(video, /m\.posterFile = pf;/);
    assert.match(video, /m\.moviePosterType = MoviePosterTypes\.PROXY_IMAGE; else m\.soundPosterType = SoundPosterTypes\.PROXY_IMAGE;/);
    assert.match(video, /m\.showController = true;/);
    assert.match(video, /m\.floatingWindow = true;/);
    assert.match(video, /m\.floatingWindowSize = FloatingWindowSize\.ONE_HALF;/);
    assert.match(video, /m\.floatingWindowPosition = FloatingWindowPosition\.UPPER_RIGHT;/);
    assert.match(video, /m\.embedInPDF = true;/);
    assert.match(video, /m\.description = "Intro video";/);
    assert.match(video, /nps\.item\(c\)\.remove\(\);/);
    assert.match(video, /nps\.add\(\{ name: "Chorus", time: 42\.5 \}\);/);
    assert.match(video, /var rp = nps\.itemByName\("Old"\); if \(rp\.isValid\) rp\.remove\(\);/);
    assert.match(video, /m\.itemLink\.relink\(rf\);/);
    assert.match(sound, /__need\(m, \["Sound"\], "stopOnPageTurn"\); m\.stopOnPageTurn = true;/);
    assert.match(sound, /m\.doNotPrintPoster = true;/);
    const set = tool('set_media_options').handler;
    assert.throws(() => set({ target: T }), /Nothing to set/);
    assert.throws(() => set({ target: T, poster: 'image' }), /needs 'posterFile'/);
    assert.throws(() => set({ target: T, poster: 'none', posterFile: inHome('p.jpg') }), /needs poster: image/);
    assert.throws(() => set({ target: T, floatingWindowSize: 'HUGE' }), /Allowed: ONE_FIFTH/);
    assert.throws(() => set({ target: T, navigationPoints: { add: [{ name: 'A', time: -1 }] } }), /out of range/);
    assert.throws(() => set({ target: T, relinkTo: '/System/x.mp4' }), /Access denied/);
});

await test('set_page_transitions applies to all or chosen spreads, clears all and sets PDF display', async () => {
    const [all, chosen, clear] = await scriptsFor([
        ['set_page_transitions', { transition: 'WIPE_TRANSITION', direction: 'LEFT_TO_RIGHT', speed: 'SLOW' }],
        ['set_page_transitions', { spreads: [0, 2], transition: 'DISSOLVE_TRANSITION' }],
        ['set_page_transitions', { clearAll: true, pdf: { openInFullScreen: true, transitionOverride: 'FROM_DOCUMENT' } }],
    ]);
    assert.match(all, /var sps = doc\.spreads\.everyItem\(\)\.getElements\(\);/);
    assert.match(all, /sp\.pageTransitionType = PageTransitionTypeOptions\.WIPE_TRANSITION;/);
    assert.match(all, /sp\.pageTransitionDirection = PageTransitionDirectionOptions\.LEFT_TO_RIGHT;/);
    assert.match(all, /sp\.pageTransitionDuration = PageTransitionDurationOptions\.SLOW;/);
    assert.match(chosen, /var sps = __spreads\(\[0,2\]\);/);
    assert.match(clear, /doc\.spreads\.item\(c\)\.pageTransitionType = PageTransitionTypeOptions\.NONE;/);
    assert.match(clear, /app\.interactivePDFExportPreferences\.openInFullScreen = true;/);
    assert.match(clear, /app\.interactivePDFExportPreferences\.pageTransitionOverride = PageTransitionOverrideOptions\.FROM_DOCUMENT;/);
    const set = tool('set_page_transitions').handler;
    assert.throws(() => set({}), /Nothing to set/);
    assert.throws(() => set({ clearAll: true, transition: 'NONE' }), /cannot be combined/);
    assert.throws(() => set({ spreads: [1] }), /needs transition/);
    assert.throws(() => set({ transition: 'SPIN' }), /Allowed: NONE/);
    assert.throws(() => set({ pdf: { fullScreen: true } }), /Unknown option 'pdf\.fullScreen'/);
});

await test('get_interactive_elements reads the chosen kinds', async () => {
    const [everything, mediaOnly] = await scriptsFor([
        ['get_interactive_elements', {}],
        ['get_interactive_elements', { pageIndex: 2, include: ['media', 'tab_order'] }],
    ]);
    for (const re of [/out\.buttons = \[\];/, /out\.formFields = \[\];/, /out\.multiStateObjects = \[\];/, /out\.media = \[\];/, /out\.animations = \[\];/,
        /out\.timing = \[\];/, /out\.pageTransitions = \[\];/, /out\.tabOrder = \[\];/, /__behaviors\(b\)/, /__timing\(spreads\[t\]\.timingSettings\)/]) {
        assert.match(everything, re);
    }
    assert.match(mediaOnly, /var pg = __page\(doc, 2\), src = pg, pages = \[pg\], spreads = \[pg\.parent\];/);
    assert.match(mediaOnly, /out\.media\.push\(__mediaInfo\(x\)\)/);
    assert.doesNotMatch(mediaOnly, /out\.buttons/);
    assert.throws(() => tool('get_interactive_elements').handler({ include: ['links'] }), /Allowed: buttons/);
    assert.throws(() => tool('get_interactive_elements').handler({ include: [] }), /non-empty list/);
});

await test('preview_interactivity and place_sample_button', async () => {
    const [spread, selection, list, place] = await scriptsFor([
        ['preview_interactivity', { mode: 'spread' }],
        ['preview_interactivity', { mode: 'selection', target: { ids: [5, 6] } }],
        ['place_sample_button', {}],
        ['place_sample_button', { name: '012', pageIndex: 1, x: 20, y: 30 }],
    ]);
    assert.match(spread, /var ma = app\.menuActions\.itemByID\(134153\);/);
    assert.match(spread, /if \(!ma\.enabled\) throw/);
    assert.match(spread, /ma\.invoke\(\);/);
    assert.match(selection, /sel\[i\]\.select\(i \? SelectionOptions\.ADD_TO : SelectionOptions\.REPLACE_WITH\);/);
    assert.match(selection, /itemByID\(134152\)/);
    assert.match(list, /var lib = app\.open\(lf\)/);
    assert.match(list, /out\.samples = names;/);
    assert.match(place, /var placed = asset\.placeAsset\(doc\)/);
    assert.match(place, /var u = __union\(items\), to = __toPage\(pg, 20, 30\);/);
    assert.match(place, /lib\.close\(\);/);
    assert.throws(() => tool('preview_interactivity').handler({ mode: 'browser' }), /Allowed: panel/);
    assert.throws(() => tool('preview_interactivity').handler({ mode: 'spread', target: T }), /applies to mode selection/);
    assert.throws(() => tool('place_sample_button').handler({ x: 3 }), /apply when placing/);
});

done();
