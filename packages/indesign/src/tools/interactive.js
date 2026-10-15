/**
 * Interactive documents: buttons and their actions, form fields, multi-state
 * objects, animation and timing, video and sound, page transitions, the
 * Sample Buttons and Forms library and the EPUB Interactivity Preview panel
 * (Window > Interactive).
 *
 * These settings take effect in exported interactive PDF and EPUB files.
 * Positions are millimetres from the top-left of a page; animation and media
 * times are seconds.
 */
import { enumOf, num, index, bool, json, str, jsxPath } from 'adobe-mcp-core';
import { validateFilePath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

/** Atlas feature ids in the interactive domain. */
const I = (ids) => ids.map((id) => `indesign.interactive.${id}`);

/** Refuse option keys the schema does not define. */
function checkKeys(given, allowed, where) {
    for (const k of Object.keys(given)) {
        if (!allowed.includes(k)) throw new Error(`Unknown option '${where}.${k}'. Allowed: ${allowed.join(', ')}`);
    }
}

/** Require an object of options. */
function objectArg(v, name) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`'${name}' must be an object`);
    return v;
}

/** Require true or false. */
function boolArg(v, name) {
    if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(v);
}

/** A list of page item ids as a JSX array literal. */
function idList(v, name, { min = 1, max = 500 } = {}) {
    if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`'${name}' must be a list of ${min} to ${max} item ids`);
    return json(v.map((id, i) => Number(index(id, { name: `${name}[${i}]`, max: 1e9 }))));
}

/** A single page item id. */
const itemId = (v, name) => index(v, { name, max: 1e9 });

/** A caller-given file path, checked against the server's path policy, as a JSX literal. */
const filePath = (v, name) => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`'${name}' must be a file path`);
    return jsxPath(validateFilePath(v));
};

/** A short caller string (names, descriptions) as a JSX literal. */
function text(v, name, max = 1000) {
    if (typeof v !== 'string') throw new Error(`'${name}' must be a string`);
    if (v.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return str(v);
}

/** A non-empty name. */
function nameArg(v, name) {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`'${name}' must be a non-empty name`);
    return text(v, name, 200);
}

/** A http(s), mailto or file URL. */
function urlArg(v, name) {
    if (typeof v !== 'string' || !/^(https?:\/\/|mailto:|ftp:\/\/|file:\/\/)\S+$/i.test(v.trim())) {
        throw new Error(`'${name}' must be a URL starting with http://, https://, mailto:, ftp:// or file://`);
    }
    return text(v.trim(), name, 2000);
}

const BOUNDS_SCHEMA = {
    type: 'object',
    description: 'Where to make it: a rectangle on a page, in mm from the page\'s top-left corner (all five values)',
    properties: {
        pageIndex: { type: 'integer', minimum: 0, description: 'Page index (0-based)' },
        x: { type: 'number', description: 'Left edge (mm)' },
        y: { type: 'number', description: 'Top edge (mm)' },
        width: { type: 'number', minimum: 0.1, description: 'Width (mm)' },
        height: { type: 'number', minimum: 0.1, description: 'Height (mm)' },
    },
};

/** JSX setting `pg` and `gb` (geometric bounds) from a bounds argument. */
function boundsJsx(b, name = 'bounds') {
    objectArg(b, name);
    checkKeys(b, Object.keys(BOUNDS_SCHEMA.properties), name);
    const p = index(b.pageIndex, { name: `${name}.pageIndex` });
    const x = num(b.x, { name: `${name}.x`, min: -10000, max: 10000 });
    const y = num(b.y, { name: `${name}.y`, min: -10000, max: 10000 });
    const w = num(b.width, { name: `${name}.width`, min: 0.1, max: 10000 });
    const h = num(b.height, { name: `${name}.height`, min: 0.1, max: 10000 });
    return `var pg = __page(doc, ${p});
var tl = __toPage(pg, ${x}, ${y});
var gb = [tl[1], tl[0], tl[1] + ${h}, tl[0] + ${w}];
var lay = doc.activeLayer;`;
}

/**
 * Shared JSX helpers: any page item by id (including items nested in frames,
 * groups and states), the union of item bounds, a kind check, and summaries of
 * behaviors and states.
 */
const HELPERS = String.raw`
var __byId = function (doc, id) {
  var it = doc.pageItems.itemByID(id);
  if (it.isValid) return it.getElements()[0];
  var all = doc.allPageItems;
  for (var i = 0; i < all.length; i++) if (all[i].id == id) return all[i];
  throw new Error("Item " + id + " not found");
};
var __kind = function (it) { return it.constructor.name; };
var __need = function (it, kinds, what) {
  var k = __kind(it);
  for (var i = 0; i < kinds.length; i++) if (kinds[i] === k) return;
  throw new Error(what + " applies to " + kinds.join(", ") + "; item " + it.id + " is a " + k);
};
var __union = function (items) {
  var u = null;
  for (var i = 0; i < items.length; i++) {
    var b = items[i].visibleBounds;
    if (!u) { u = [b[0], b[1], b[2], b[3]]; continue; }
    u[0] = Math.min(u[0], b[0]); u[1] = Math.min(u[1], b[1]); u[2] = Math.max(u[2], b[2]); u[3] = Math.max(u[3], b[3]);
  }
  return u;
};
var __pageFor = function (items) {
  var pg = __pageOf(items[0]);
  if (!pg) throw new Error("Item " + items[0].id + " is not on a page");
  return pg;
};
var __behaviors = function (it) {
  var out = [], bs;
  try { bs = it.behaviors; } catch (e) { return out; }
  var keys = ["url", "pageNumber", "stateName", "anchorName", "goBackOnRollOff", "loopsToNextOrPrevious", "autoReverseOnRollOff", "navigationPointID"];
  var enums = ["zoomSetting", "operation", "viewZoomStyle"];
  for (var i = 0; i < bs.length; i++) {
    var b = bs.item(i).getElements()[0], o = { index: i, type: __kind(b), event: __enumName(b.behaviorEvent), enabled: b.enableBehavior };
    for (var k = 0; k < keys.length; k++) { try { var v = b[keys[k]]; if (v !== undefined && v !== null) o[keys[k]] = v; } catch (e) {} }
    for (var n = 0; n < enums.length; n++) { try { o[enums[n]] = __enumName(b[enums[n]]); } catch (e) {} }
    try { o.filePath = b.filePath ? String(b.filePath) : null; } catch (e) {}
    out.push(o);
  }
  return out;
};
var __states = function (it) {
  var out = [];
  for (var i = 0; i < it.states.length; i++) {
    var s = it.states.item(i), o = { index: i, name: s.name, active: s.active, items: s.pageItems.length };
    try { o.type = __enumName(s.statetype); } catch (e) {}
    try { o.enabled = s.enabled; } catch (e) {}
    out.push(o);
  }
  return out;
};
`;

// ---------------------------------------------------------------------------
// Buttons and form fields

const BUTTON_STATES = { normal: 'UP', rollover: 'ROLLOVER', click: 'DOWN' };

/** JSX for the button appearance helpers: find a state by type, add one. */
const APPEARANCE_JSX = String.raw`
var __stateOf = function (b, type) {
  for (var i = 0; i < b.states.length; i++) if (b.states.item(i).statetype == type) return b.states.item(i);
  return null;
};
var __addState = function (b, type) {
  var st = __stateOf(b, type);
  if (st) { st.enabled = true; return st; }
  st = b.states.add({ statetype: type });
  var src = b.states.item(0).pageItems, dups = [];
  for (var i = 0; i < src.length; i++) dups.push(src.item(i).duplicate());
  if (dups.length) st.addItemsToState(dups);
  st.enabled = true;
  return st;
};
`;

/**
 * Form field and button options: the JSX property, which kinds take it, and
 * how its value is checked.
 */
const FIELD_KINDS = ['TextBox', 'CheckBox', 'RadioButton', 'ComboBox', 'ListBox', 'SignatureField'];
const TEXT_KINDS = ['TextBox', 'ComboBox', 'ListBox'];
const FIELD_OPTIONS = {
    description: { prop: 'description', kinds: ['Button', ...FIELD_KINDS], type: 'string', description: 'Description: the tooltip and alternative text in the PDF (PDF Options)' },
    printableInPdf: { prop: 'printableInPdf', kinds: ['Button', ...FIELD_KINDS], type: 'boolean', description: 'Printable: print the field with the PDF' },
    hiddenUntilTriggered: { prop: 'hiddenUntilTriggered', kinds: ['Button', ...FIELD_KINDS], type: 'boolean', description: 'Hidden Until Triggered: hidden in the PDF until a Show/Hide action shows it' },
    required: { prop: 'required', kinds: FIELD_KINDS, type: 'boolean', description: 'Required: the field must be filled in' },
    readOnly: { prop: 'readOnly', kinds: FIELD_KINDS, type: 'boolean', description: 'Read Only' },
    password: { prop: 'password', kinds: ['TextBox'], type: 'boolean', description: 'Password: hide typed characters (text fields)' },
    multiline: { prop: 'multiline', kinds: ['TextBox'], type: 'boolean', description: 'Multiline (text fields)' },
    scrollable: { prop: 'scrollable', kinds: ['TextBox'], type: 'boolean', description: 'Scrollable (text fields)' },
    fontSize: { prop: 'fontSize', kinds: TEXT_KINDS, type: 'number', min: 0, max: 1296, description: 'Font Size in points for text fields, combo boxes and list boxes; 0 is Auto' },
    rightToLeft: { prop: 'rightToLeftField', kinds: TEXT_KINDS, type: 'boolean', description: 'Right-to-left text in the field' },
    checkedByDefault: { prop: 'checkedByDefault', kinds: ['CheckBox', 'RadioButton'], type: 'boolean', description: 'Selected by Default (check boxes and radio buttons)' },
    exportValue: { prop: 'exportValue', kinds: ['CheckBox', 'RadioButton'], type: 'string', description: 'Export Value submitted when selected (check boxes and radio buttons)' },
    choices: { prop: 'choiceList', kinds: ['ComboBox', 'ListBox'], type: 'list', description: 'List Items: the choices of a combo box or list box, replacing the existing ones' },
    sortChoices: { prop: 'sortChoices', kinds: ['ComboBox', 'ListBox'], type: 'boolean', description: 'Sort Items alphabetically (combo boxes and list boxes)' },
    multipleSelection: { prop: 'multipleSelection', kinds: ['ListBox'], type: 'boolean', description: 'Multiple Selection (list boxes)' },
    font: { kinds: TEXT_KINDS, type: 'font', description: 'Font of the field text in the PDF (text fields, combo boxes and list boxes)' },
};

function fieldOptionSchema(keys) {
    const out = {};
    for (const k of keys) {
        const o = FIELD_OPTIONS[k];
        if (o.type === 'list') out[k] = { type: 'array', items: { type: 'string' }, description: o.description };
        else if (o.type === 'font') {
            out[k] = {
                type: 'object', description: o.description,
                properties: { family: { type: 'string', description: 'Font family, e.g. "Myriad Pro"' }, style: { type: 'string', description: 'Font style, e.g. "Bold"' } },
            };
        } else out[k] = { type: o.type, description: o.description, ...(o.type === 'number' ? { minimum: o.min, maximum: o.max } : {}) };
    }
    return out;
}

/** Validate field options and return JSX statements applied to `it`. */
function fieldStatements(a, keys) {
    const lines = [];
    for (const k of keys) {
        const v = a[k];
        if (v === undefined) continue;
        const o = FIELD_OPTIONS[k];
        const need = `__need(it, ${json(o.kinds)}, ${str(k)});`;
        if (o.type === 'boolean') lines.push(`${need} it.${o.prop} = ${boolArg(v, k)};`);
        else if (o.type === 'number') lines.push(`${need} it.${o.prop} = ${num(v, { name: k, min: o.min, max: o.max })};`);
        else if (o.type === 'string') lines.push(`${need} it.${o.prop} = ${text(v, k)};`);
        else if (o.type === 'list') {
            if (!Array.isArray(v) || v.length > 500 || v.some((c) => typeof c !== 'string' || c.length > 500)) throw new Error(`'${k}' must be a list of up to 500 strings`);
            lines.push(`${need} it.${o.prop} = ${json(v)};`);
        } else {
            objectArg(v, k);
            checkKeys(v, ['family', 'style'], k);
            if (v.family === undefined && v.style === undefined) throw new Error(`'${k}' needs family or style`);
            if (v.family !== undefined) lines.push(`${need} it.appliedFont = ${nameArg(v.family, 'font.family')};`);
            if (v.style !== undefined) lines.push(`${need} it.fontStyle = ${nameArg(v.style, 'font.style')};`);
        }
    }
    return lines;
}

const FIELD_OPTION_KEYS = Object.keys(FIELD_OPTIONS);
const BUTTON_OPTION_KEYS = ['description', 'printableInPdf', 'hiddenUntilTriggered'];

/** Form field kinds: their collection on a page. */
const FORM_KINDS = {
    text_field: 'textBoxes',
    check_box: 'checkBoxes',
    radio_button: 'radioButtons',
    combo_box: 'comboBoxes',
    list_box: 'listBoxes',
    signature_field: 'signatureFields',
};

/** Where a new button or field goes: from items (their bounds) or a rectangle. */
function placementJsx(a) {
    if (a.target !== undefined && a.bounds !== undefined) throw new Error('Give target (items to convert) or bounds, not both');
    if (a.target !== undefined) {
        return `var src = __targets(doc, ${targetSpec(a.target)});
var pg = __pageFor(src);
var gb = __union(src);
var lay = src[0].itemLayer;`;
    }
    if (a.bounds === undefined) throw new Error('Give target (items to convert) or bounds (a rectangle on a page)');
    return `var src = [];\n${boundsJsx(a.bounds)}`;
}

/** Button actions: the Behavior collection, the object-model class, and the options each takes. */
const ACTIONS = {
    go_to_destination: { coll: 'gotoAnchorBehaviors', zoom: true, feature: 'button_action_menu_go_to_destination' },
    go_to_first_page: { coll: 'gotoFirstPageBehaviors', zoom: true, feature: 'button_action_menu_go_to_first_page' },
    go_to_last_page: { coll: 'gotoLastPageBehaviors', zoom: true, feature: 'button_action_menu_go_to_last_page' },
    go_to_next_page: { coll: 'gotoNextPageBehaviors', zoom: true, feature: 'button_action_menu_go_to_next_page' },
    go_to_previous_page: { coll: 'gotoPreviousPageBehaviors', zoom: true, feature: 'button_action_menu_go_to_previous_page' },
    go_to_next_view: { coll: 'gotoNextViewBehaviors', zoom: true, feature: 'button_action_menu_go_to_next_view' },
    go_to_previous_view: { coll: 'gotoPreviousViewBehaviors', zoom: true, feature: 'button_action_menu_go_to_previous_view' },
    go_to_page: { coll: 'gotoPageBehaviors', zoom: true, feature: 'button_action_menu_go_to_page' },
    go_to_url: { coll: 'gotoURLBehaviors', feature: 'button_action_menu_go_to_url' },
    go_to_state: { coll: 'gotoStateBehaviors', feature: 'button_action_menu_go_to_state' },
    go_to_next_state: { coll: 'gotoNextStateBehaviors', feature: 'button_action_menu_go_to_next_state' },
    go_to_previous_state: { coll: 'gotoPreviousStateBehaviors', feature: 'button_action_menu_go_to_previous_state' },
    show_hide_fields: { coll: 'showHideFieldsBehaviors', feature: 'button_action_menu_show_hide_buttons_and_forms' },
    video: { coll: 'movieBehaviors', feature: 'button_action_menu_video' },
    sound: { coll: 'soundBehaviors', feature: 'button_action_menu_sound' },
    animation: { coll: 'animationBehaviors', feature: 'button_action_menu_animation' },
    open_file: { coll: 'openFileBehaviors', feature: 'button_action_menu_open_file' },
    view_zoom: { coll: 'viewZoomBehaviors', feature: 'button_action_menu_view_zoom' },
    clear_form: { coll: 'clearFormBehaviors', feature: 'button_action_menu_clear_form' },
    print_form: { coll: 'printFormBehaviors', feature: 'button_action_menu_print_form' },
    submit_form: { coll: 'submitFormBehaviors', feature: 'button_action_menu_submit_form' },
};
const BEHAVIOR_EVENTS = ['MOUSE_UP', 'MOUSE_DOWN', 'MOUSE_ENTER', 'MOUSE_EXIT', 'ON_FOCUS', 'ON_BLUR'];
const ZOOMS = ['INHERIT_ZOOM', 'ACTUAL_SIZE', 'FIT_WINDOW', 'FIT_WIDTH', 'FIT_VISIBLE'];
const VIEW_ZOOMS = ['FULL_SCREEN', 'ZOOM_IN', 'ZOOM_OUT', 'FIT_PAGE', 'ACTUAL_SIZE', 'FIT_WIDTH', 'FIT_VISIBLE', 'SINGLE_PAGE', 'ONE_COLUMN', 'TWO_COLUMN'];
const MEDIA_OPS = {
    video: { type: 'MoviePlayOperations', values: ['PLAY', 'PAUSE', 'RESUME', 'STOP', 'STOP_ALL', 'PLAY_FROM_NAVIGATION_POINT'] },
    sound: { type: 'PlayOperations', values: ['PLAY', 'PAUSE', 'RESUME', 'STOP', 'STOP_ALL'] },
    animation: { type: 'AnimationPlayOperations', values: ['PLAY', 'PAUSE', 'RESUME', 'REVERSE_PLAYBACK', 'STOP', 'STOP_ALL'] },
};

/** JSX resolving a hyperlink destination (`dest`) in document `dd`. */
const DESTINATION_JSX = String.raw`
var __destByName = function (dd, n) {
  var c = [dd.hyperlinkTextDestinations, dd.hyperlinkPageDestinations, dd.bookmarks];
  for (var i = 0; i < c.length; i++) { var x = c[i].itemByName(n); if (x.isValid) return x.getElements()[0]; }
  throw new Error("No text destination, page destination or bookmark named " + n);
};
var __pageDest = function (dd, p, n) {
  var pd = dd.hyperlinkPageDestinations;
  for (var i = 0; i < pd.length; i++) {
    var x = pd.item(i);
    if (x.destinationPage == p && (!n || x.name === n)) return x;
  }
  var made = pd.add(p);
  if (n) made.name = n;
  return made;
};
var __openDoc = function (f) {
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents.item(i);
    try { if (d.fullName.fsName === f.fsName) return d; } catch (e) {}
  }
  throw new Error("Open " + f.fsName + " in InDesign first: a cross-document jump needs its destinations");
};
`;

/** Validate add_button_action arguments; JSX statements configuring behavior `bh`. */
function actionStatements(a) {
    const act = enumOf(a.action, Object.keys(ACTIONS), { name: 'action' });
    const lines = [];
    const need = (k) => { if (a[k] === undefined) throw new Error(`'${k}' is required for action ${act}`); };
    const refuse = (keys) => {
        for (const k of keys) if (a[k] !== undefined) throw new Error(`'${k}' does not apply to action ${act}`);
    };
    const used = new Set(['target', 'action', 'event']);
    if (a.zoom !== undefined) {
        if (!ACTIONS[act].zoom) throw new Error(`'zoom' does not apply to action ${act}`);
        lines.push(`bh.zoomSetting = GoToZoomOptions.${enumOf(a.zoom, ZOOMS, { name: 'zoom' })};`);
        used.add('zoom');
    }
    switch (act) {
    case 'go_to_destination': {
        need('destination');
        const d = objectArg(a.destination, 'destination');
        checkKeys(d, ['name', 'pageIndex', 'document'], 'destination');
        if (d.name === undefined && d.pageIndex === undefined) throw new Error("'destination' needs name (an existing destination or bookmark) or pageIndex");
        if (d.document !== undefined) {
            lines.push(`var df = File(${filePath(d.document, 'destination.document')});`, 'var dd = __openDoc(df);');
        } else lines.push('var dd = doc;');
        if (d.pageIndex !== undefined) {
            const n = d.name !== undefined ? nameArg(d.name, 'destination.name') : '""';
            lines.push(`var dest = __pageDest(dd, __page(dd, ${index(d.pageIndex, { name: 'destination.pageIndex' })}), ${n});`);
        } else lines.push(`var dest = __destByName(dd, ${nameArg(d.name, 'destination.name')});`);
        if (d.document !== undefined) lines.push('bh.filePath = df;');
        lines.push('bh.anchorItem = dest;');
        used.add('destination');
        break;
    }
    case 'go_to_page':
        need('pageIndex');
        lines.push(`__page(doc, ${index(a.pageIndex, { name: 'pageIndex' })});`, `bh.pageNumber = ${Number(a.pageIndex) + 1};`);
        used.add('pageIndex');
        break;
    case 'go_to_url':
    case 'submit_form':
        need('url');
        lines.push(`bh.url = ${urlArg(a.url, 'url')};`);
        used.add('url');
        break;
    case 'go_to_state':
    case 'go_to_next_state':
    case 'go_to_previous_state':
        need('multiStateObject');
        lines.push(`var mso = __byId(doc, ${itemId(a.multiStateObject, 'multiStateObject')});`, '__need(mso, ["MultiStateObject"], "multiStateObject");',
            'bh.associatedMultiStateObject = mso;');
        used.add('multiStateObject');
        if (act === 'go_to_state') {
            need('stateName');
            const sn = nameArg(a.stateName, 'stateName');
            lines.push(`if (!mso.states.itemByName(${sn}).isValid) throw new Error("The multi-state object has no state named " + ${sn});`, `bh.stateName = ${sn};`);
            if (a.goBackOnRollOff !== undefined) lines.push(`bh.goBackOnRollOff = ${boolArg(a.goBackOnRollOff, 'goBackOnRollOff')};`);
            used.add('stateName').add('goBackOnRollOff');
        } else {
            if (a.loop !== undefined) lines.push(`bh.loopsToNextOrPrevious = ${boolArg(a.loop, 'loop')};`);
            used.add('loop');
        }
        break;
    case 'show_hide_fields':
        if (a.show === undefined && a.hide === undefined) throw new Error("'show' or 'hide' is required for action show_hide_fields");
        for (const k of ['show', 'hide']) {
            if (a[k] === undefined) continue;
            lines.push(`var ${k} = [], ${k}Ids = ${idList(a[k], k)};`,
                `for (var s = 0; s < ${k}Ids.length; s++) { var f = __byId(doc, ${k}Ids[s]); __need(f, ${json(['Button', ...FIELD_KINDS])}, ${str(k)}); ${k}.push(f); }`,
                `bh.${k === 'show' ? 'fieldsToShow' : 'fieldsToHide'} = ${k};`);
            used.add(k);
        }
        break;
    case 'video':
    case 'sound':
    case 'animation': {
        const ops = MEDIA_OPS[act];
        const op = a.mediaOperation === undefined ? 'PLAY' : enumOf(a.mediaOperation, ops.values, { name: 'mediaOperation' });
        need('mediaItem');
        const id = itemId(a.mediaItem, 'mediaItem');
        if (act === 'animation') {
            lines.push(`bh.animatedPageItem = __byId(doc, ${id});`);
            if (a.autoReverseOnRollOff !== undefined) lines.push(`bh.autoReverseOnRollOff = ${boolArg(a.autoReverseOnRollOff, 'autoReverseOnRollOff')};`);
            used.add('autoReverseOnRollOff');
        } else {
            const kind = act === 'video' ? 'Movie' : 'Sound';
            lines.push(`var mi = __mediaOf(__byId(doc, ${id}), ${str(kind)});`, `bh.${act === 'video' ? 'movieItem' : 'soundItem'} = mi;`);
        }
        lines.push(`bh.operation = ${ops.type}.${op};`);
        if (op === 'PLAY_FROM_NAVIGATION_POINT') {
            need('navigationPoint');
            const np = nameArg(a.navigationPoint, 'navigationPoint');
            lines.push(`var np = mi.navigationPoints.itemByName(${np});`, `if (!np.isValid) throw new Error("The video has no navigation point named " + ${np});`,
                'bh.navigationPointID = np.id;');
        }
        used.add('mediaItem').add('mediaOperation').add('navigationPoint');
        break;
    }
    case 'open_file':
        need('filePath');
        lines.push(`bh.filePath = File(${filePath(a.filePath, 'filePath')});`);
        used.add('filePath');
        break;
    case 'view_zoom':
        need('viewZoom');
        lines.push(`bh.viewZoomStyle = ViewZoomStyle.${enumOf(a.viewZoom, VIEW_ZOOMS, { name: 'viewZoom' })};`);
        used.add('viewZoom');
        break;
    default:
        break;
    }
    refuse(Object.keys(a).filter((k) => !used.has(k) && a[k] !== undefined));
    return { act, lines };
}

/** JSX: the movie or sound of an item or of the frame holding it. */
const MEDIA_JSX = String.raw`
var __mediaOf = function (it, kind) {
  var k = __kind(it);
  if (k === "Movie" || k === "Sound") {
    if (kind && k !== kind) throw new Error("Item " + it.id + " is a " + k + ", not a " + kind);
    return it;
  }
  try {
    if ((!kind || kind === "Movie") && it.movies.length) return it.movies.item(0).getElements()[0];
    if ((!kind || kind === "Sound") && it.sounds.length) return it.sounds.item(0).getElements()[0];
  } catch (e) {}
  throw new Error("Item " + it.id + " holds no " + (kind ? kind.toLowerCase() : "movie or sound"));
};
`;

// ---------------------------------------------------------------------------
// Animation and timing

const PAGE_EVENTS = ['ON_PAGE_LOAD', 'ON_PAGE_CLICK'];
const SELF_EVENTS = ['ON_SELF_CLICK', 'ON_SELF_ROLLOVER'];
const ORIGINS = {
    top_left: [0, 0], top_center: [0.5, 0], top_right: [1, 0],
    center_left: [0, 0.5], center: [0.5, 0.5], center_right: [1, 0.5],
    bottom_left: [0, 1], bottom_center: [0.5, 1], bottom_right: [1, 1],
};
const EASES = { none: 'NO_EASE', ease_in: 'EASE_IN', ease_out: 'EASE_OUT', ease_in_out: 'EASE_IN_OUT' };
const DESIGN = { from_current_appearance: 'FROM_CURRENT_APPEARANCE', to_current_appearance: 'TO_CURRENT_APPEARANCE', to_current_location: 'TO_CURRENT_LOCATION' };
const MM_TO_PT = 72 / 25.4;

/** JSX timing helpers: find a spread or item timing list, find and drop an item's targets. */
const TIMING_JSX = String.raw`
var __list = function (ts, ev) {
  for (var i = 0; i < ts.timingLists.length; i++) { var l = ts.timingLists.item(i); if (l.triggerEvent == ev) return l; }
  return null;
};
var __ensureList = function (ts, ev) { return __list(ts, ev) || ts.timingLists.add(ev); };
var __isItem = function (t, it) { try { return t.dynamicTarget.id == it.id; } catch (e) { return false; } };
var __findIn = function (l, it) {
  for (var g = 0; g < l.timingGroups.length; g++) {
    var grp = l.timingGroups.item(g);
    for (var t = 0; t < grp.timingTargets.length; t++) if (__isItem(grp.timingTargets.item(t), it)) return { group: grp, target: grp.timingTargets.item(t) };
  }
  return null;
};
var __drop = function (l, it) {
  var n = 0;
  for (var g = l.timingGroups.length - 1; g >= 0; g--) {
    var grp = l.timingGroups.item(g);
    for (var t = grp.timingTargets.length - 1; t >= 0; t--) {
      if (!__isItem(grp.timingTargets.item(t), it)) continue;
      if (grp.timingTargets.length === 1) grp.remove(); else grp.timingTargets.item(t).remove();
      n++;
      break;
    }
  }
  return n;
};
var __spreadOf = function (it) {
  var pg = __pageOf(it);
  if (!pg) throw new Error("Item " + it.id + " is not on a page");
  return pg.parent;
};
var __timing = function (ts) {
  var out = [];
  for (var i = 0; i < ts.timingLists.length; i++) {
    var l = ts.timingLists.item(i), groups = [];
    for (var g = 0; g < l.timingGroups.length; g++) {
      var grp = l.timingGroups.item(g), targets = [];
      for (var t = 0; t < grp.timingTargets.length; t++) {
        var tt = grp.timingTargets.item(t), id = null;
        try { id = tt.dynamicTarget.id; } catch (e) {}
        targets.push({ id: id, delaySeconds: tt.delaySeconds });
      }
      groups.push({ plays: grp.plays, loop: grp.playsLoop, targets: targets });
    }
    out.push({ event: __enumName(l.triggerEvent), groups: groups });
  }
  return out;
};
`;

/** JSX: a motion preset by name in the application or document. */
const PRESET_JSX = String.raw`
var __preset = function (n, dd) {
  var p = app.motionPresets.itemByName(n);
  if (p.isValid) return p.getElements()[0];
  if (dd) { p = dd.motionPresets.itemByName(n); if (p.isValid) return p.getElements()[0]; }
  throw new Error("No motion preset named " + n);
};
`;

/** Validate set_animation arguments; JSX statements applied to item `it` with settings `s`. */
function animationStatements(a) {
    const lines = [];
    const after = [];
    let changed = 0;
    if (a.remove !== undefined) {
        if (a.remove !== true) throw new Error("'remove' must be true when given");
        const others = Object.keys(a).filter((k) => !['target', 'remove'].includes(k) && a[k] !== undefined);
        if (others.length) throw new Error(`'remove' cannot be combined with ${others.join(', ')}`);
        return {
            lines: [
                's.preset = NothingEnum.NOTHING;',
                'var rts = __spreadOf(it).timingSettings, revs = [DynamicTriggerEvents.ON_PAGE_LOAD, DynamicTriggerEvents.ON_PAGE_CLICK];',
                'for (var r = 0; r < revs.length; r++) { var rl = __list(rts, revs[r]); if (rl) __drop(rl, it); }',
                'for (var r2 = it.timingSettings.timingLists.length - 1; r2 >= 0; r2--) it.timingSettings.timingLists.item(r2).remove();',
            ],
            after: [],
        };
    }
    if (a.preset !== undefined) { lines.push(`s.preset = __preset(${nameArg(a.preset, 'preset')}, doc);`); changed++; }
    if (a.duration !== undefined) { lines.push(`s.duration = ${num(a.duration, { name: 'duration', min: 0.125, max: 60 })};`); changed++; }
    if (a.plays !== undefined) {
        if (!Number.isInteger(a.plays) || a.plays < 1 || a.plays > 1000) throw new Error("'plays' must be a whole number from 1 to 1000");
        lines.push(`s.plays = ${a.plays};`);
        changed++;
    }
    if (a.loop !== undefined) { lines.push(`s.playsLoop = ${boolArg(a.loop, 'loop')};`); changed++; }
    if (a.speed !== undefined) { lines.push(`s.easeType = AnimationEaseOptions.${EASES[enumOf(a.speed, Object.keys(EASES), { name: 'speed' })]};`); changed++; }
    if (a.animate !== undefined) { lines.push(`s.designOption = DesignOptions.${DESIGN[enumOf(a.animate, Object.keys(DESIGN), { name: 'animate' })]};`); changed++; }
    // Key frames run at 24 frames per second: the last frame of an animation is duration * 24 - 1.
    const keyed = a.rotate !== undefined || a.scale !== undefined || a.opacity !== undefined;
    if (keyed) lines.push('var lf = Math.max(1, Math.round(s.duration * 24) - 1);');
    if (a.rotate !== undefined) { lines.push(`s.rotationArray = [[0, 0], [lf, ${num(a.rotate, { name: 'rotate', min: -3600, max: 3600 })}]];`); changed++; }
    if (a.scale !== undefined) {
        objectArg(a.scale, 'scale');
        checkKeys(a.scale, ['x', 'y'], 'scale');
        if (a.scale.x === undefined && a.scale.y === undefined) throw new Error("'scale' needs x or y");
        const sx = num(a.scale.x ?? 100, { name: 'scale.x', min: 0, max: 10000 });
        const sy = num(a.scale.y ?? 100, { name: 'scale.y', min: 0, max: 10000 });
        lines.push(`s.scaleXArray = [[0, 100], [lf, ${sx}]];`, `s.scaleYArray = [[0, 100], [lf, ${sy}]];`);
        changed++;
    }
    if (a.opacity !== undefined) {
        const o = enumOf(a.opacity, ['none', 'fade_in', 'fade_out'], { name: 'opacity' });
        const frames = { none: '[[0, 100], [lf, 100]]', fade_in: '[[0, 0], [lf, 100]]', fade_out: '[[0, 100], [lf, 0]]' }[o];
        lines.push(`s.opacityArray = ${frames};`);
        changed++;
    }
    if (a.origin !== undefined) { lines.push(`s.transformOffsets = ${json(ORIGINS[enumOf(a.origin, Object.keys(ORIGINS), { name: 'origin' })])};`); changed++; }
    if (a.hideUntilAnimated !== undefined) { lines.push(`s.initiallyHidden = ${boolArg(a.hideUntilAnimated, 'hideUntilAnimated')};`); changed++; }
    if (a.hideAfterAnimating !== undefined) { lines.push(`s.hiddenAfter = ${boolArg(a.hideAfterAnimating, 'hideAfterAnimating')};`); changed++; }
    if (a.motionPath !== undefined && a.motionPathFrom !== undefined) throw new Error('Give motionPath or motionPathFrom, not both');
    if (a.motionPath !== undefined) {
        const pts = a.motionPath;
        if (!Array.isArray(pts) || pts.length < 2 || pts.length > 200) throw new Error("'motionPath' must be a list of 2 to 200 [x, y] points");
        const mm = pts.map((p, i) => {
            if (!Array.isArray(p) || p.length !== 2) throw new Error(`'motionPath[${i}]' must be [x, y]`);
            return [Number(num(p[0], { name: `motionPath[${i}][0]`, min: -10000, max: 10000 })), Number(num(p[1], { name: `motionPath[${i}][1]`, min: -10000, max: 10000 }))];
        });
        // Motion path points are written in points (the measurement unit is switched for the assignment).
        lines.push(`var mpg = __pageOf(it); if (!mpg) throw new Error("Item " + it.id + " is not on a page");`,
            `var mp = ${json(mm)}, pp = [];`,
            `for (var m = 0; m < mp.length; m++) { var q = __toPage(mpg, mp[m][0], mp[m][1]); q = [q[0] * ${MM_TO_PT}, q[1] * ${MM_TO_PT}]; pp.push([q, q, q]); }`,
            'app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;',
            'try { s.motionPathPoints = [pp, true]; } finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }');
        changed++;
    }
    if (a.motionPathFrom !== undefined) {
        // Convert to Motion Path: the path's anchor and direction points become the motion path.
        lines.push(`var pathItem = __byId(doc, ${itemId(a.motionPathFrom, 'motionPathFrom')});`,
            'if (pathItem.id == it.id) throw new Error("motionPathFrom must be another item than the animated one");',
            'app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;',
            'try {',
            '  var ep = pathItem.paths.item(0).entirePath, pp = [];',
            '  for (var m = 0; m < ep.length; m++) { var e = ep[m]; pp.push(e.length === 3 && e[0] instanceof Array ? [e[1], e[0], e[2]] : [e, e, e]); }',
            '  s.motionPathPoints = [pp, pathItem.paths.item(0).pathType == PathType.OPEN_PATH];',
            '} finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }');
        if (a.keepPath !== undefined) boolArg(a.keepPath, 'keepPath');
        if (a.keepPath !== true) after.push('if (pathItem.isValid) pathItem.remove();');
        changed++;
    } else if (a.keepPath !== undefined) throw new Error("'keepPath' applies with motionPathFrom");
    if (a.events !== undefined) {
        if (!Array.isArray(a.events) || !a.events.length) throw new Error("'events' must be a non-empty list");
        const evs = [...new Set(a.events.map((e, i) => enumOf(e, [...PAGE_EVENTS, ...SELF_EVENTS], { name: `events[${i}]` })))];
        lines.push(`var evs = ${json(evs)}, sts = __spreadOf(it).timingSettings, its = it.timingSettings;`,
            'var pageEvs = ' + json(PAGE_EVENTS) + ', selfEvs = ' + json(SELF_EVENTS) + ';',
            'var __in = function (v) { for (var q = 0; q < evs.length; q++) if (evs[q] === v) return true; return false; };',
            'for (var e1 = 0; e1 < pageEvs.length; e1++) {',
            '  var pl = __list(sts, DynamicTriggerEvents[pageEvs[e1]]);',
            '  if (!__in(pageEvs[e1])) { if (pl) __drop(pl, it); continue; }',
            '  pl = __ensureList(sts, DynamicTriggerEvents[pageEvs[e1]]);',
            '  if (!__findIn(pl, it)) pl.timingGroups.add(it, 0);',
            '}',
            'for (var e2 = 0; e2 < selfEvs.length; e2++) {',
            '  var sl = __list(its, DynamicTriggerEvents[selfEvs[e2]]);',
            '  if (!__in(selfEvs[e2])) { if (sl) sl.remove(); continue; }',
            '  sl = __ensureList(its, DynamicTriggerEvents[selfEvs[e2]]);',
            '  if (!__findIn(sl, it)) sl.timingGroups.add(it, 0);',
            '}');
        if (a.reverseOnRollOff !== undefined) {
            if (!evs.includes('ON_SELF_ROLLOVER')) throw new Error("'reverseOnRollOff' applies with the ON_SELF_ROLLOVER event");
            lines.push(`var ro = __findIn(__list(its, DynamicTriggerEvents.ON_SELF_ROLLOVER), it); if (ro) ro.target.reverseAnimation = ${boolArg(a.reverseOnRollOff, 'reverseOnRollOff')};`);
        }
        changed++;
    } else if (a.reverseOnRollOff !== undefined) throw new Error("'reverseOnRollOff' applies with events: [\"ON_SELF_ROLLOVER\"]");
    if (!changed) throw new Error('Nothing to set: give preset, duration, plays, loop, speed, animate, rotate, scale, opacity, origin, visibility, a motion path or events');
    return { lines, after };
}

// ---------------------------------------------------------------------------
// Media

const MOVIE_POSTERS = { none: 'NONE', standard: 'STANDARD', from_video: 'FROM_MOVIE', image: 'PROXY_IMAGE' };
const SOUND_POSTERS = { none: 'NONE', standard: 'STANDARD', image: 'PROXY_IMAGE' };
const WINDOW_SIZES = ['ONE_FIFTH', 'ONE_FOURTH', 'ONE_HALF', 'FULL', 'TWICE', 'TRIPLE', 'QUADRUPLE', 'MAX'];
const WINDOW_POSITIONS = ['UPPER_LEFT', 'UPPER_MIDDLE', 'UPPER_RIGHT', 'CENTER_LEFT', 'CENTER', 'CENTER_RIGHT', 'LOWER_LEFT', 'LOWER_MIDDLE', 'LOWER_RIGHT'];

const MEDIA_OPTION_SCHEMA = {
    playOnPageLoad: { type: 'boolean', description: 'Play on Page Load' },
    loop: { type: 'boolean', description: 'Loop (video: loops except in PDF; sound: loops forever)' },
    stopOnPageTurn: { type: 'boolean', description: 'Stop on Page Turn (sound)' },
    poster: { type: 'string', enum: Object.keys(MOVIE_POSTERS), description: 'Poster: none, standard, from_video (a frame of the video, video only) or image (posterFile)' },
    posterFile: { type: 'string', description: 'Image file to use as the poster (sets poster to image)' },
    doNotPrintPoster: { type: 'boolean', description: 'Do not print the sound poster (sound)' },
    controller: { type: 'string', description: 'Controller skin name for video, e.g. "SkinOverAllNoFullNoCaption"; "None" for no controller' },
    showControllerOnRollover: { type: 'boolean', description: 'Show the controller on mouse over (video)' },
    showControls: { type: 'boolean', description: 'Show playback controls in the PDF (legacy video option)' },
    floatingWindow: { type: 'boolean', description: 'Play in a floating window in the PDF (video, PDF Options)' },
    floatingWindowSize: { type: 'string', enum: WINDOW_SIZES, description: 'Size of the floating window relative to the video' },
    floatingWindowPosition: { type: 'string', enum: WINDOW_POSITIONS, description: 'Position of the floating window on the screen' },
    embedInPDF: { type: 'boolean', description: 'Embed the media in the PDF rather than link to it' },
    description: { type: 'string', description: 'Description: the PDF alternative text (PDF Options)' },
    url: { type: 'string', description: 'Play the video from this URL (Video from URL; video only)' },
};

/** Validate media options; JSX statements applied to media item `m`. */
function mediaStatements(o, where = '') {
    const lines = [];
    const k = (n) => `${where}${n}`;
    const movie = (what) => `__need(m, ["Movie"], ${str(what)});`;
    const sound = (what) => `__need(m, ["Sound"], ${str(what)});`;
    if (o.playOnPageLoad !== undefined) lines.push(`m.playOnPageTurn = ${boolArg(o.playOnPageLoad, k('playOnPageLoad'))};`);
    if (o.loop !== undefined) lines.push(`if (__kind(m) === "Movie") m.movieLoop = ${boolArg(o.loop, k('loop'))}; else m.soundLoop = ${bool(o.loop)};`);
    if (o.stopOnPageTurn !== undefined) lines.push(`${sound('stopOnPageTurn')} m.stopOnPageTurn = ${boolArg(o.stopOnPageTurn, k('stopOnPageTurn'))};`);
    if (o.doNotPrintPoster !== undefined) lines.push(`${sound('doNotPrintPoster')} m.doNotPrintPoster = ${boolArg(o.doNotPrintPoster, k('doNotPrintPoster'))};`);
    if (o.posterFile !== undefined) {
        lines.push(`var pf = File(${filePath(o.posterFile, k('posterFile'))}); if (!pf.exists) throw new Error("Poster file not found: " + pf.fsName);`, 'm.posterFile = pf;');
        if (o.poster !== undefined && o.poster !== 'image') throw new Error(`'${k('posterFile')}' needs poster: image`);
    }
    if (o.poster !== undefined) {
        const p = enumOf(o.poster, Object.keys(MOVIE_POSTERS), { name: k('poster') });
        if (p === 'image' && o.posterFile === undefined) throw new Error(`poster: image needs '${k('posterFile')}'`);
        if (p === 'from_video') lines.push(`${movie('poster from_video')} m.moviePosterType = MoviePosterTypes.FROM_MOVIE;`);
        else lines.push(`if (__kind(m) === "Movie") m.moviePosterType = MoviePosterTypes.${MOVIE_POSTERS[p]}; else m.soundPosterType = SoundPosterTypes.${SOUND_POSTERS[p]};`);
    }
    if (o.controller !== undefined) lines.push(`${movie('controller')} m.controllerSkin = ${nameArg(o.controller, k('controller'))};`);
    if (o.showControllerOnRollover !== undefined) lines.push(`${movie('showControllerOnRollover')} m.showController = ${boolArg(o.showControllerOnRollover, k('showControllerOnRollover'))};`);
    if (o.showControls !== undefined) lines.push(`${movie('showControls')} m.showControls = ${boolArg(o.showControls, k('showControls'))};`);
    if (o.floatingWindow !== undefined) lines.push(`${movie('floatingWindow')} m.floatingWindow = ${boolArg(o.floatingWindow, k('floatingWindow'))};`);
    if (o.floatingWindowSize !== undefined) lines.push(`${movie('floatingWindowSize')} m.floatingWindowSize = FloatingWindowSize.${enumOf(o.floatingWindowSize, WINDOW_SIZES, { name: k('floatingWindowSize') })};`);
    if (o.floatingWindowPosition !== undefined) lines.push(`${movie('floatingWindowPosition')} m.floatingWindowPosition = FloatingWindowPosition.${enumOf(o.floatingWindowPosition, WINDOW_POSITIONS, { name: k('floatingWindowPosition') })};`);
    if (o.embedInPDF !== undefined) lines.push(`m.embedInPDF = ${boolArg(o.embedInPDF, k('embedInPDF'))};`);
    if (o.description !== undefined) lines.push(`m.description = ${text(o.description, k('description'))};`);
    if (o.url !== undefined) lines.push(`${movie('url')} m.url = ${urlArg(o.url, k('url'))};`);
    return lines;
}

const MEDIA_INFO_JSX = String.raw`
var __mediaInfo = function (m) {
  var o = __itemInfo(m);
  try { o.file = m.filePath ? String(m.filePath) : null; } catch (e) {}
  try { o.playOnPageLoad = m.playOnPageTurn; o.embedInPDF = m.embedInPDF; o.description = m.description; } catch (e) {}
  if (__kind(m) === "Movie") {
    o.loop = m.movieLoop; o.poster = __enumName(m.moviePosterType); o.url = m.url || null;
    o.controller = m.controllerSkin; o.showControllerOnRollover = m.showController;
    o.floatingWindow = m.floatingWindow; o.floatingWindowSize = __enumName(m.floatingWindowSize); o.floatingWindowPosition = __enumName(m.floatingWindowPosition);
    o.navigationPoints = [];
    for (var n = 0; n < m.navigationPoints.length; n++) { var np = m.navigationPoints.item(n); o.navigationPoints.push({ name: np.name, time: np.time, id: np.id }); }
  } else {
    o.loop = m.soundLoop; o.poster = __enumName(m.soundPosterType); o.stopOnPageTurn = m.stopOnPageTurn; o.doNotPrintPoster = m.doNotPrintPoster;
  }
  return o;
};
`;

// ---------------------------------------------------------------------------
// Page transitions and preview

const TRANSITIONS = ['NONE', 'BLINDS_TRANSITION', 'BOX_TRANSITION', 'COMB_TRANSITION', 'COVER_TRANSITION', 'DISSOLVE_TRANSITION',
    'FADE_TRANSITION', 'PUSH_TRANSITION', 'SPLIT_TRANSITION', 'UNCOVER_TRANSITION', 'WIPE_TRANSITION', 'ZOOM_IN_TRANSITION', 'ZOOM_OUT_TRANSITION'];
const TRANSITION_DIRECTIONS = ['HORIZONTAL', 'VERTICAL', 'HORIZONTAL_IN', 'HORIZONTAL_OUT', 'VERTICAL_IN', 'VERTICAL_OUT', 'LEFT_TO_RIGHT',
    'RIGHT_TO_LEFT', 'UP', 'DOWN', 'LEFT_UP', 'LEFT_DOWN', 'RIGHT_UP', 'RIGHT_DOWN', 'IN', 'OUT', 'NOT_APPLICABLE'];
const TRANSITION_OVERRIDES = ['FROM_DOCUMENT', 'NONE', 'BLINDS_TRANSITION', 'BOX_TRANSITION', 'COMB_TRANSITION', 'COVER_TRANSITION',
    'DISSOLVE_TRANSITION', 'FADE_TRANSITION', 'PAGE_TURN_TRANSITION', 'PUSH_TRANSITION', 'SPLIT_TRANSITION', 'UNCOVER_TRANSITION',
    'WIPE_TRANSITION', 'ZOOM_IN_TRANSITION', 'ZOOM_OUT_TRANSITION'];

/** EPUB Interactivity Preview panel commands (menu action ids; none opens a dialog). */
const PREVIEW_ACTIONS = { panel: 134149, selection: 134152, spread: 134153, document: 134154 };

const INCLUDE = ['buttons', 'form_fields', 'multi_state_objects', 'media', 'animations', 'timing', 'page_transitions', 'tab_order'];

export const tools = [
    {
        name: 'create_button',
        description: 'Make a button from items (Object > Interactive > Convert to Button) or an empty button at a rectangle, with a name, PDF description and Rollover/Click appearances (Buttons and Forms panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Items to convert: they become the Normal appearance (give this or bounds)' },
                bounds: BOUNDS_SCHEMA,
                name: { type: 'string', description: 'Button name' },
                description: FIELD_OPTIONS.description,
                appearances: {
                    type: 'array', items: { type: 'string', enum: ['rollover', 'click'] },
                    description: 'Appearances to add besides Normal; each starts as a copy of the Normal appearance',
                },
            },
        },
        features: I(['button', 'convert_to_button', 'buttons_forms_panel']),
        hints: { readOnly: false },
        auditArgs: { target: { ids: [5] }, bounds: undefined },
        handler: (a) => {
            const place = placementJsx(a);
            const lines = [];
            if (a.name !== undefined) lines.push(`b.name = ${nameArg(a.name, 'name')};`);
            if (a.description !== undefined) lines.push(`b.description = ${text(a.description, 'description')};`);
            if (a.appearances !== undefined) {
                if (!Array.isArray(a.appearances)) throw new Error("'appearances' must be a list");
                for (const s of new Set(a.appearances)) lines.push(`__addState(b, StateTypes.${BUTTON_STATES[enumOf(s, ['rollover', 'click'], { name: 'appearances' })]});`);
            }
            return run('Create button', script(`${HELPERS}${APPEARANCE_JSX}
${place}
var b = pg.buttons.add({ geometricBounds: gb, itemLayer: lay });
if (src.length) b.states.item(0).addItemsToState(src);
${lines.join('\n')}
var info = __itemInfo(b);
info.states = __states(b);
__result__ = info;`));
        },
    },
    {
        name: 'set_button_options',
        description: 'Set button appearances (Normal, Rollover, Click: turn on or off, add items, show one), the PDF description, printing and Hidden Until Triggered (Buttons and Forms panel, PDF Options)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The buttons' },
                ...fieldOptionSchema(BUTTON_OPTION_KEYS),
                appearances: {
                    type: 'object',
                    description: 'Appearance changes by state',
                    properties: Object.fromEntries(Object.keys(BUTTON_STATES).map((s) => [s, {
                        type: 'object', description: `${s[0].toUpperCase()}${s.slice(1)} appearance`,
                        properties: {
                            ...(s === 'normal' ? {} : { enabled: { type: 'boolean', description: 'Turn the appearance on (adding it as a copy of Normal if missing) or off' } }),
                            addItems: { type: 'array', items: { type: 'integer' }, description: 'Ids of items to move into this appearance' },
                        },
                    }])),
                },
                show: { type: 'string', enum: Object.keys(BUTTON_STATES), description: 'Appearance to show in the layout (the active state)' },
            },
            required: ['target'],
        },
        features: I(['button_appearances', 'buttons_pdf_options', 'hidden_until_triggered']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { appearances: { rollover: { enabled: true, addItems: [7] }, click: { enabled: false } } },
        handler: (a) => {
            const lines = fieldStatements(a, BUTTON_OPTION_KEYS);
            if (a.appearances !== undefined) {
                objectArg(a.appearances, 'appearances');
                checkKeys(a.appearances, Object.keys(BUTTON_STATES), 'appearances');
                for (const [s, o] of Object.entries(a.appearances)) {
                    if (o === undefined) continue;
                    objectArg(o, `appearances.${s}`);
                    checkKeys(o, s === 'normal' ? ['addItems'] : ['enabled', 'addItems'], `appearances.${s}`);
                    const type = `StateTypes.${BUTTON_STATES[s]}`;
                    if (o.enabled === false && o.addItems !== undefined) throw new Error(`'appearances.${s}': addItems given with enabled: false`);
                    if (o.enabled === false) lines.push(`var off = __stateOf(it, ${type}); if (off) off.enabled = false;`);
                    else if (o.enabled === true || o.addItems !== undefined) {
                        lines.push(s === 'normal' ? `var st = __stateOf(it, ${type}) || it.states.item(0);` : `var st = __addState(it, ${type});`);
                        if (o.addItems !== undefined) {
                            lines.push(`var ai = ${idList(o.addItems, `appearances.${s}.addItems`)}, add = [];`,
                                'for (var k = 0; k < ai.length; k++) add.push(__byId(doc, ai[k]));', 'st.addItemsToState(add);');
                        }
                    } else throw new Error(`'appearances.${s}': give enabled or addItems`);
                }
            }
            if (a.show !== undefined) {
                const type = `StateTypes.${BUTTON_STATES[enumOf(a.show, Object.keys(BUTTON_STATES), { name: 'show' })]}`;
                lines.push(`var sh = __stateOf(it, ${type}); if (!sh) throw new Error("Button " + it.id + " has no ${a.show} appearance"); it.activeStateIndex = sh.index;`);
            }
            if (!lines.length) throw new Error('Nothing to set: give description, printableInPdf, hiddenUntilTriggered, appearances or show');
            return run('Set button options', script(`${HELPERS}${APPEARANCE_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  __need(it, ["Button"], "set_button_options");
  ${lines.join('\n  ')}
  var info = __itemInfo(it);
  info.description = it.description; info.printableInPdf = it.printableInPdf; info.hiddenUntilTriggered = it.hiddenUntilTriggered;
  info.states = __states(it);
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'create_form_field',
        description: 'Make a PDF form field: text field, check box, radio button, combo box, list box or signature field, at a rectangle or over items, with its options (Buttons and Forms panel > Type)',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: Object.keys(FORM_KINDS), description: 'Field type' },
                target: { ...TARGET_SCHEMA, description: 'Items whose bounds the field takes; for check boxes and radio buttons they become the appearance (give this or bounds)' },
                bounds: BOUNDS_SCHEMA,
                name: { type: 'string', description: 'Field name in the PDF' },
                ...fieldOptionSchema(FIELD_OPTION_KEYS),
            },
            required: ['kind'],
        },
        features: I(['form_fields', 'form_text_field', 'form_check_box', 'form_radio_button', 'form_combo_box', 'form_list_box', 'form_signature_field']),
        hints: { readOnly: false },
        auditArgs: { kind: 'check_box', target: undefined, bounds: { pageIndex: 0, x: 10, y: 10, width: 6, height: 6 }, fontSize: 10 },
        handler: (a) => {
            const kind = enumOf(a.kind, Object.keys(FORM_KINDS), { name: 'kind' });
            const place = placementJsx(a);
            const lines = fieldStatements(a, FIELD_OPTION_KEYS);
            const hasStates = kind === 'check_box' || kind === 'radio_button';
            return run('Create form field', script(`${HELPERS}
${place}
var it = pg.${FORM_KINDS[kind]}.add({ geometricBounds: gb, itemLayer: lay });
${hasStates ? 'if (src.length) it.states.item(0).addItemsToState(src);' : ''}
${a.name !== undefined ? `it.name = ${nameArg(a.name, 'name')};` : ''}
${lines.join('\n')}
var info = __itemInfo(it);
info.kind = ${str(kind)};
__result__ = info;`));
        },
    },
    {
        name: 'set_form_field_options',
        description: 'Set form field options: description, printable, required, read only, hidden until triggered, password, multiline, scrollable, font and size, selected by default, export value, list items, sort and multiple selection (Buttons and Forms panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The form fields' },
                ...fieldOptionSchema(FIELD_OPTION_KEYS),
            },
            required: ['target'],
        },
        features: I(['form_description_form_field', 'form_printable', 'form_required', 'form_read_only', 'form_password', 'form_multiline',
            'form_scrollable', 'form_font_size_form_field', 'form_selected_by_default', 'form_export_value', 'form_list_items',
            'form_sort_items', 'form_multiple_selection']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { font: { family: 'Arial', style: 'Bold' }, fontSize: 12 },
        handler: (a) => {
            const lines = fieldStatements(a, FIELD_OPTION_KEYS);
            if (!lines.length) throw new Error(`Nothing to set: give any of ${FIELD_OPTION_KEYS.join(', ')}`);
            return run('Set form field options', script(`${HELPERS}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  __need(it, ${json(FIELD_KINDS)}, "set_form_field_options");
  ${lines.join('\n  ')}
  out.push(__itemInfo(it));
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'add_button_action',
        description: 'Add an action to buttons or form fields for an event: go to a destination, page, view, URL or state, show/hide fields, play video, sound or animation, open a file, zoom, clear, print or submit the form (Buttons and Forms panel > Actions)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The buttons or form fields' },
                action: { type: 'string', enum: Object.keys(ACTIONS), description: 'The action' },
                event: { type: 'string', enum: BEHAVIOR_EVENTS, default: 'MOUSE_UP', description: 'Event: On Release or Tap (MOUSE_UP), On Click (MOUSE_DOWN), On Roll Over (MOUSE_ENTER), On Roll Off (MOUSE_EXIT), On Focus, On Blur' },
                zoom: { type: 'string', enum: ZOOMS, description: 'Zoom for go_to_* page, view and destination actions' },
                pageIndex: { type: 'integer', minimum: 0, description: 'go_to_page: the page index (0-based)' },
                destination: {
                    type: 'object',
                    description: 'go_to_destination: a text anchor, page destination or bookmark by name, or a page (a page destination is made if none exists); with document, in another open InDesign document (a cross-document jump)',
                    properties: {
                        name: { type: 'string', description: 'Destination or bookmark name (with pageIndex: the name of the page destination)' },
                        pageIndex: { type: 'integer', minimum: 0, description: 'Page index (0-based) to jump to' },
                        document: { type: 'string', description: 'Path of another InDesign document, open in InDesign, holding the destination' },
                    },
                },
                url: { type: 'string', description: 'go_to_url: the URL; submit_form: where to submit (a URL or mailto:)' },
                multiStateObject: { type: 'integer', description: 'go_to_state, go_to_next_state, go_to_previous_state: the multi-state object id' },
                stateName: { type: 'string', description: 'go_to_state: the state to show' },
                goBackOnRollOff: { type: 'boolean', description: 'go_to_state: go back to the previous state on roll off' },
                loop: { type: 'boolean', description: 'go_to_next_state, go_to_previous_state: stop on last/first state when false' },
                show: { type: 'array', items: { type: 'integer' }, description: 'show_hide_fields: ids of buttons and fields to show' },
                hide: { type: 'array', items: { type: 'integer' }, description: 'show_hide_fields: ids of buttons and fields to hide' },
                mediaItem: { type: 'integer', description: 'video, sound: the movie or sound (or its frame) id; animation: the animated item id' },
                mediaOperation: { type: 'string', enum: ['PLAY', 'PAUSE', 'RESUME', 'STOP', 'STOP_ALL', 'PLAY_FROM_NAVIGATION_POINT', 'REVERSE_PLAYBACK'], description: 'video, sound, animation: what to do (default PLAY); PLAY_FROM_NAVIGATION_POINT is video only, REVERSE_PLAYBACK animation only' },
                navigationPoint: { type: 'string', description: 'video with PLAY_FROM_NAVIGATION_POINT: the navigation point name' },
                autoReverseOnRollOff: { type: 'boolean', description: 'animation: reverse the animation on roll off' },
                filePath: { type: 'string', description: 'open_file: the file to open' },
                viewZoom: { type: 'string', enum: VIEW_ZOOMS, description: 'view_zoom: the view' },
            },
            required: ['target', 'action'],
        },
        features: I(['button_event', ...Object.values(ACTIONS).map((x) => x.feature), 'cross_document_jumps']),
        hints: { readOnly: false },
        auditArgs: {
            action: 'go_to_destination', event: 'MOUSE_UP', zoom: 'FIT_WINDOW', destination: { pageIndex: 0, name: 'Start' }, pageIndex: undefined,
            url: undefined, multiStateObject: undefined, stateName: undefined, goBackOnRollOff: undefined, loop: undefined, show: undefined,
            hide: undefined, mediaItem: undefined, mediaOperation: undefined, navigationPoint: undefined, autoReverseOnRollOff: undefined,
            filePath: undefined, viewZoom: undefined,
        },
        handler: (a) => {
            const event = a.event === undefined ? 'MOUSE_UP' : enumOf(a.event, BEHAVIOR_EVENTS, { name: 'event' });
            const { act, lines } = actionStatements(a);
            return run('Add button action', script(`${HELPERS}${DESTINATION_JSX}${MEDIA_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  __need(it, ${json(['Button', ...FIELD_KINDS])}, "add_button_action");
  var bh = it.${ACTIONS[act].coll}.add({ behaviorEvent: BehaviorEvents.${event} });
  ${lines.join('\n  ')}
  out.push({ id: it.id, name: it.name, actions: __behaviors(it) });
}
__result__ = { action: ${str(act)}, items: out };`));
        },
    },
    {
        name: 'edit_button_actions',
        description: 'Remove, turn on or off, or change the event of the actions on buttons or form fields (Buttons and Forms panel > Actions); list them with get_interactive_elements',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The buttons or form fields' },
                operation: { type: 'string', enum: ['remove', 'enable', 'disable', 'set_event'], description: 'What to do to the actions' },
                actionIndex: { type: 'integer', minimum: 0, description: 'The action index (as listed by get_interactive_elements); omit for every action' },
                event: { type: 'string', enum: BEHAVIOR_EVENTS, description: 'set_event: the new event' },
            },
            required: ['target', 'operation'],
        },
        features: I(['button_event']),
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { operation: 'set_event', actionIndex: 0, event: 'MOUSE_DOWN' },
        handler: (a) => {
            const op = enumOf(a.operation, ['remove', 'enable', 'disable', 'set_event'], { name: 'operation' });
            if ((op === 'set_event') !== (a.event !== undefined)) throw new Error("'event' is required for, and only for, operation set_event");
            const apply = {
                remove: 'x.remove();',
                enable: 'x.enableBehavior = true;',
                disable: 'x.enableBehavior = false;',
                set_event: `x.behaviorEvent = BehaviorEvents.${a.event === undefined ? '' : enumOf(a.event, BEHAVIOR_EVENTS, { name: 'event' })};`,
            }[op];
            const pick = a.actionIndex === undefined
                ? `for (var k = it.behaviors.length - 1; k >= 0; k--) { var x = it.behaviors.item(k); ${apply} }`
                : `var ai = ${index(a.actionIndex, { name: 'actionIndex', max: 1000 })}; if (ai >= it.behaviors.length) throw new Error("Item " + it.id + " has " + it.behaviors.length + " actions"); var x = it.behaviors.item(ai); ${apply}`;
            return run('Edit button actions', script(`${HELPERS}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  __need(it, ${json(['Button', ...FIELD_KINDS])}, "edit_button_actions");
  ${pick}
  out.push({ id: it.id, name: it.name, actions: __behaviors(it) });
}
__result__ = { operation: ${str(op)}, items: out };`));
        },
    },
    {
        name: 'set_tab_order',
        description: 'Set the order in which Tab moves between the buttons and form fields of a page in the PDF (Object > Interactive > Set Tab Order)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: 'Page index (0-based)' },
                order: { type: 'array', items: { type: 'integer' }, description: 'Ids of the page\'s buttons and form fields, in tab order' },
            },
            required: ['pageIndex', 'order'],
        },
        features: I(['button_tab_order']),
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const p = index(a.pageIndex, { name: 'pageIndex' });
            return run('Set tab order', script(`${HELPERS}
var pg = __page(doc, ${p}), ids = ${idList(a.order, 'order')}, list = [];
for (var i = 0; i < ids.length; i++) {
  var it = __byId(doc, ids[i]);
  __need(it, ${json(['Button', ...FIELD_KINDS])}, "order");
  var ip = __pageOf(it);
  if (!ip || ip.id != pg.id) throw new Error("Item " + it.id + " is not on page " + pg.name);
  list.push(it);
}
pg.tabOrder = list;
var now = pg.tabOrder, order = [];
for (var j = 0; j < now.length; j++) order.push({ id: now[j].id, name: now[j].name });
__result__ = { page: pg.name, tabOrder: order };`));
        },
    },
    {
        name: 'convert_interactive_to_object',
        description: 'Turn buttons or form fields back into ordinary page items, keeping the active appearance (Object > Interactive > Convert to Object)',
        inputSchema: {
            type: 'object',
            properties: { target: { ...TARGET_SCHEMA, description: 'The buttons or form fields' } },
            required: ['target'],
        },
        features: I(['convert_to_object']),
        hints: { readOnly: false, destructive: true },
        handler: (a) => run('Convert to object', script(`${HELPERS}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  __need(it, ${json(['Button', ...FIELD_KINDS])}, "convert_interactive_to_object");
  out.push({ id: it.id, kind: __kind(it) });
  it.convertToObject();
}
__result__ = { converted: out };`)),
    },
    {
        name: 'reset_interactive_states',
        description: 'Show the Normal appearance of every button and the first state of every multi-state object (Buttons and Forms panel > Reset All Buttons to Normal State; Object States panel > Reset All Multi-state Objects to First State)',
        inputSchema: {
            type: 'object',
            properties: {
                reset: { type: 'string', enum: ['all', 'buttons', 'multi_state_objects'], default: 'all', description: 'What to reset' },
            },
        },
        features: I(['reset_buttons', 'object_states_menu_reset_all_multi_state_objects_to_first_state']),
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const r = a.reset === undefined ? 'all' : enumOf(a.reset, ['all', 'buttons', 'multi_state_objects'], { name: 'reset' });
            return run('Reset interactive states', script(`
${r !== 'multi_state_objects' ? 'doc.resetAllButtons();' : ''}
${r !== 'buttons' ? 'doc.resetAllMultiStateObjects();' : ''}
__result__ = { reset: ${str(r)}, buttons: doc.buttons.length, multiStateObjects: doc.multiStateObjects.length };`));
        },
    },
    {
        name: 'create_multi_state_object',
        description: 'Make a multi-state object from items, each item (or list of items) becoming one state (Object States panel > New State); returns its id and states',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Items that each become one state (give this or states)' },
                states: {
                    type: 'array', minItems: 2,
                    description: 'The states in order, each from one or more items (give this or target)',
                    items: {
                        type: 'object',
                        properties: {
                            ids: { type: 'array', items: { type: 'integer' }, description: 'Ids of the items in this state' },
                            name: { type: 'string', description: 'State name' },
                        },
                        required: ['ids'],
                    },
                },
                name: { type: 'string', description: 'Name of the multi-state object' },
                hiddenUntilTriggered: { type: 'boolean', description: 'Hidden Until Triggered: hidden in the exported file until an action shows it' },
            },
        },
        features: I(['multi_state_object', 'object_states_menu_new_state', 'object_states_panel']),
        hints: { readOnly: false },
        auditArgs: { target: undefined, states: [{ ids: [5], name: 'Up' }, { ids: [6, 7], name: 'Down' }] },
        handler: (a) => {
            if ((a.target === undefined) === (a.states === undefined)) throw new Error('Give target (one item per state) or states, not both');
            let groups;
            if (a.states !== undefined) {
                if (!Array.isArray(a.states) || a.states.length < 2 || a.states.length > 100) throw new Error("'states' must list 2 to 100 states");
                groups = a.states.map((s, i) => {
                    objectArg(s, `states[${i}]`);
                    checkKeys(s, ['ids', 'name'], `states[${i}]`);
                    return `{ ids: ${idList(s.ids, `states[${i}].ids`)}, name: ${s.name === undefined ? 'null' : nameArg(s.name, `states[${i}].name`)} }`;
                });
            }
            const groupsJsx = groups
                ? `var groups = [${groups.join(', ')}];
for (var g = 0; g < groups.length; g++) { var its = []; for (var k = 0; k < groups[g].ids.length; k++) its.push(__byId(doc, groups[g].ids[k])); groups[g].items = its; }`
                : `var tg = __targets(doc, ${targetSpec(a.target)}), groups = [];
if (tg.length < 2) throw new Error("A multi-state object needs at least two items, one per state");
for (var g = 0; g < tg.length; g++) groups.push({ items: [tg[g]], name: null });`;
            const extra = [];
            if (a.name !== undefined) extra.push(`mso.name = ${nameArg(a.name, 'name')};`);
            if (a.hiddenUntilTriggered !== undefined) extra.push(`mso.initiallyHidden = ${boolArg(a.hiddenUntilTriggered, 'hiddenUntilTriggered')};`);
            return run('Create multi-state object', script(`${HELPERS}
${groupsJsx}
var all = [];
for (var g2 = 0; g2 < groups.length; g2++) for (var k2 = 0; k2 < groups[g2].items.length; k2++) all.push(groups[g2].items[k2]);
var pg = __pageFor(all);
var mso = pg.multiStateObjects.add({ geometricBounds: __union(all), itemLayer: all[0].itemLayer });
var initial = mso.states.length;
for (var s = 0; s < groups.length; s++) {
  if (s < initial) mso.states.item(s).addItemsToState(groups[s].items); else mso.addItemsAsState(groups[s].items);
  if (groups[s].name) mso.states.item(s).name = groups[s].name;
}
for (var r = mso.states.length - 1; r >= groups.length; r--) mso.states.item(r).remove();
${extra.join('\n')}
var info = __itemInfo(mso);
info.states = __states(mso);
__result__ = info;`));
        },
    },
    {
        name: 'edit_object_states',
        description: 'Change a multi-state object: new state, delete, rename, reorder or show a state, add or paste items into a state, release one or all states to objects, Hidden Until Triggered (Object States panel)',
        inputSchema: {
            type: 'object',
            properties: {
                multiStateObject: { type: 'integer', description: 'The multi-state object id' },
                operation: {
                    type: 'string',
                    enum: ['new_state', 'delete_state', 'rename_state', 'move_state', 'show_state', 'add_to_state', 'paste_into_state', 'release_state', 'release_all', 'set_hidden'],
                    description: 'new_state (from ids, or empty), delete_state, rename_state, move_state, show_state (make it the visible state), add_to_state (move items in: Add Objects to Visible State), paste_into_state (copies of items), release_state (Release State to Objects), release_all (Release All States to Objects), set_hidden (Hidden Until Triggered)',
                },
                state: { type: 'string', description: 'The state, by name; for add_to_state and paste_into_state the visible state if omitted' },
                ids: { type: 'array', items: { type: 'integer' }, description: 'new_state, add_to_state, paste_into_state: item ids' },
                name: { type: 'string', description: 'new_state, rename_state: the state name' },
                position: { type: 'integer', minimum: 0, description: 'move_state: the new position (0-based)' },
                hidden: { type: 'boolean', description: 'set_hidden: hide until triggered' },
            },
            required: ['multiStateObject', 'operation'],
        },
        features: I(['object_states_panel', 'object_states_menu_new_state', 'object_states_menu_delete_state', 'object_states_menu_add_objects_to_visible_state',
            'object_states_menu_paste_into_state', 'object_states_menu_release_state_to_objects', 'object_states_menu_release_all_states_to_objects',
            'object_states_menu_hidden_until_triggered', 'hidden_until_triggered']),
        hints: { readOnly: false, destructive: true },
        auditArgs: { operation: 'paste_into_state', state: 'Up', ids: [5, 6], name: undefined, position: undefined, hidden: undefined },
        handler: (a) => {
            const OPS = ['new_state', 'delete_state', 'rename_state', 'move_state', 'show_state', 'add_to_state', 'paste_into_state', 'release_state', 'release_all', 'set_hidden'];
            const op = enumOf(a.operation, OPS, { name: 'operation' });
            const NEEDS = {
                new_state: [], delete_state: ['state'], rename_state: ['state', 'name'], move_state: ['state', 'position'], show_state: ['state'],
                add_to_state: ['ids'], paste_into_state: ['ids'], release_state: ['state'], release_all: [], set_hidden: ['hidden'],
            };
            const ALLOWED_ARGS = { new_state: ['ids', 'name'], add_to_state: ['ids', 'state'], paste_into_state: ['ids', 'state'] };
            for (const k of NEEDS[op]) if (a[k] === undefined) throw new Error(`'${k}' is required for operation ${op}`);
            const allowed = new Set(['multiStateObject', 'operation', ...NEEDS[op], ...(ALLOWED_ARGS[op] ?? [])]);
            for (const k of Object.keys(a)) if (a[k] !== undefined && !allowed.has(k)) throw new Error(`'${k}' does not apply to operation ${op}`);
            const lines = [];
            const stateJsx = (fallbackActive) => (a.state !== undefined
                ? `var st = mso.states.itemByName(${nameArg(a.state, 'state')}); if (!st.isValid) throw new Error("No state named " + ${str(a.state)}); st = st.getElements()[0];`
                : (fallbackActive ? 'var st = mso.states.item(mso.activeStateIndex);' : ''));
            const itemsJsx = () => `var ids = ${idList(a.ids, 'ids')}, its = []; for (var k = 0; k < ids.length; k++) its.push(__byId(doc, ids[k]));`;
            switch (op) {
            case 'new_state':
                if (a.ids !== undefined) lines.push(itemsJsx(), 'mso.addItemsAsState(its);', 'var st = mso.states.lastItem();');
                else lines.push('var st = mso.states.add({});');
                if (a.name !== undefined) lines.push(`st.name = ${nameArg(a.name, 'name')};`);
                break;
            case 'delete_state':
                lines.push(stateJsx(), 'if (mso.states.length < 2) throw new Error("A multi-state object keeps at least one state");', 'st.remove();');
                break;
            case 'rename_state':
                lines.push(stateJsx(), `st.name = ${nameArg(a.name, 'name')};`);
                break;
            case 'move_state':
                lines.push(stateJsx(), `var to = ${index(a.position, { name: 'position', max: 1000 })}; if (to >= mso.states.length) throw new Error("position is past the last state");`, 'st.move(to);');
                break;
            case 'show_state':
                lines.push(stateJsx(), 'mso.activeStateIndex = st.index;');
                break;
            case 'add_to_state':
                lines.push(stateJsx(true), itemsJsx(), 'st.addItemsToState(its);');
                break;
            case 'paste_into_state':
                lines.push(stateJsx(true), itemsJsx(), 'var dups = []; for (var d = 0; d < its.length; d++) dups.push(its[d].duplicate());', 'st.addItemsToState(dups);');
                break;
            case 'release_state':
                lines.push(stateJsx(), 'st.releaseAsObject();');
                break;
            case 'release_all':
                lines.push('var gone = mso.id; mso.releaseAsObjects();', '__result__ = { operation: "release_all", released: gone };');
                break;
            default:
                lines.push(`mso.initiallyHidden = ${boolArg(a.hidden, 'hidden')};`);
            }
            const tail = op === 'release_all' ? '' : `if (mso.isValid) { var info = __itemInfo(mso); info.hiddenUntilTriggered = mso.initiallyHidden; info.activeStateIndex = mso.activeStateIndex; info.states = __states(mso); __result__ = { operation: ${str(op)}, multiStateObject: info }; } else __result__ = { operation: ${str(op)}, multiStateObject: null };`;
            return run('Edit object states', script(`${HELPERS}
var mso = __byId(doc, ${itemId(a.multiStateObject, 'multiStateObject')});
__need(mso, ["MultiStateObject"], "multiStateObject");
${lines.join('\n')}
${tail}`));
        },
    },
    {
        name: 'set_animation',
        description: 'Animate items: motion preset, events (page load, page click, self click, self roll over), duration, plays and loop, speed, animate from/to current appearance, rotate, origin, scale, opacity, visibility, and a motion path drawn as points or converted from a path (Animation panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The items to animate' },
                preset: { type: 'string', description: 'Motion preset name, e.g. "fly-in-left" (see manage_motion_presets list)' },
                events: {
                    type: 'array', items: { type: 'string', enum: [...PAGE_EVENTS, ...SELF_EVENTS] },
                    description: 'Event(s) that play the animation: On Page Load, On Page Click, On Click (Self), On Roll Over (Self); replaces the current ones (On Button Event: use add_button_action with action animation)',
                },
                reverseOnRollOff: { type: 'boolean', description: 'With ON_SELF_ROLLOVER: reverse on roll off' },
                duration: { type: 'number', minimum: 0.125, maximum: 60, description: 'Duration in seconds' },
                plays: { type: 'integer', minimum: 1, description: 'Play this many times' },
                loop: { type: 'boolean', description: 'Loop' },
                speed: { type: 'string', enum: Object.keys(EASES), description: 'Speed: none (constant), ease in, ease out, ease in and out' },
                animate: { type: 'string', enum: Object.keys(DESIGN), description: 'Animate: from current appearance, to current appearance, or to current location' },
                rotate: { type: 'number', description: 'Rotate by this many degrees over the animation' },
                origin: { type: 'string', enum: Object.keys(ORIGINS), description: 'Origin (the reference point) of rotation and scaling' },
                scale: { type: 'object', description: 'Scale to these percentages over the animation (one left out stays 100)', properties: { x: { type: 'number', minimum: 0, description: 'Horizontal %' }, y: { type: 'number', minimum: 0, description: 'Vertical %' } } },
                opacity: { type: 'string', enum: ['none', 'fade_in', 'fade_out'], description: 'Opacity: none, fade in or fade out' },
                hideUntilAnimated: { type: 'boolean', description: 'Visibility: Hide Until Animated' },
                hideAfterAnimating: { type: 'boolean', description: 'Visibility: Hide After Animating' },
                motionPath: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Motion path through these [x, y] points (mm from the top-left of the item\'s page)' },
                motionPathFrom: { type: 'integer', description: 'Convert to Motion Path: the id of a path (line, polygon...) whose shape becomes the motion path' },
                keepPath: { type: 'boolean', description: 'With motionPathFrom: keep the path item (it is deleted by default, as the panel command does)' },
                remove: { type: 'boolean', description: 'Remove the animation (Animation panel > Remove); combine with nothing else' },
            },
            required: ['target'],
        },
        features: I(['animation_panel', 'anim_preset', 'anim_event_s', 'anim_duration', 'anim_play_times_loop', 'anim_speed',
            'anim_animate_from_to_current_appearance', 'anim_rotate', 'anim_origin', 'anim_scale', 'anim_opacity_animation',
            'anim_visibility_hide_until_animated_hide_after_animating', 'motion_path', 'convert_to_motion_path']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            preset: 'fly-in-left', events: ['ON_PAGE_CLICK', 'ON_SELF_ROLLOVER'], reverseOnRollOff: true, plays: 2, scale: { x: 150, y: 120 },
            motionPath: undefined, motionPathFrom: 9, keepPath: false, remove: undefined,
        },
        handler: (a) => {
            const { lines, after } = animationStatements(a);
            return run('Set animation', script(`${HELPERS}${TIMING_JSX}${PRESET_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], s = it.animationSettings;
  ${lines.join('\n  ')}
  var info = __itemInfo(it);
  try { info.preset = s.preset && s.preset.name ? s.preset.name : null; } catch (e) { info.preset = null; }
  info.duration = s.duration; info.plays = s.plays; info.loop = s.playsLoop;
  out.push(info);
}
${after.join('\n')}
__result__ = { items: out };`));
        },
    },
    {
        name: 'manage_motion_presets',
        description: 'List, import, export, duplicate, rename and delete motion presets, or save an item\'s animation as a preset (Animation panel > Save; Manage Presets)',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['list', 'save_from_item', 'import', 'export', 'duplicate', 'rename', 'delete'], description: 'What to do' },
                name: { type: 'string', description: 'The preset name (save_from_item: the new preset\'s name)' },
                newName: { type: 'string', description: 'duplicate, rename: the new name' },
                itemId: { type: 'integer', description: 'save_from_item: the animated item' },
                filePath: { type: 'string', description: 'import: a motion preset file (.xml); export: where to save it' },
                scope: { type: 'string', enum: ['application', 'document'], default: 'application', description: 'Where the preset lives: InDesign\'s presets or the active document\'s' },
            },
            required: ['operation'],
        },
        features: I(['motion_presets', 'save_motion_preset']),
        hints: { readOnly: false, destructive: true },
        auditArgs: { operation: 'export', name: 'fly-in-left', newName: undefined, itemId: undefined },
        handler: (a) => {
            const op = enumOf(a.operation, ['list', 'save_from_item', 'import', 'export', 'duplicate', 'rename', 'delete'], { name: 'operation' });
            const scope = a.scope === undefined ? 'application' : enumOf(a.scope, ['application', 'document'], { name: 'scope' });
            const NEEDS = { list: [], save_from_item: ['name', 'itemId'], import: ['filePath'], export: ['name', 'filePath'], duplicate: ['name', 'newName'], rename: ['name', 'newName'], delete: ['name'] };
            for (const k of NEEDS[op]) if (a[k] === undefined) throw new Error(`'${k}' is required for operation ${op}`);
            const allowed = new Set(['operation', 'scope', ...NEEDS[op]]);
            for (const k of Object.keys(a)) if (a[k] !== undefined && !allowed.has(k)) throw new Error(`'${k}' does not apply to operation ${op}`);
            const coll = scope === 'document' ? '__doc().motionPresets' : 'app.motionPresets';
            const preset = () => `var mp = ${coll}.itemByName(${nameArg(a.name, 'name')}); if (!mp.isValid) throw new Error("No ${scope} motion preset named " + ${str(a.name)}); mp = mp.getElements()[0];`;
            let body;
            switch (op) {
            case 'list': body = ''; break;
            case 'save_from_item':
                body = `var doc = __doc(); var mp = __byId(doc, ${itemId(a.itemId, 'itemId')}).animationSettings.save(${nameArg(a.name, 'name')});`;
                break;
            case 'import':
                body = `var f = File(${filePath(a.filePath, 'filePath')}); if (!f.exists) throw new Error("File not found: " + f.fsName); var mp = app.loadMotionPreset(f);`;
                break;
            case 'export':
                body = `${preset()} mp.saveACopy(File(${filePath(a.filePath, 'filePath')}));`;
                break;
            case 'duplicate':
                body = `${preset()} mp = mp.duplicate(${nameArg(a.newName, 'newName')});`;
                break;
            case 'rename':
                body = `${preset()} mp.name = ${nameArg(a.newName, 'newName')};`;
                break;
            default:
                body = `${preset()} mp.remove();`;
            }
            return run('Manage motion presets', script(`${HELPERS}
${body}
var lists = { application: app.motionPresets }, out = {};
if (app.documents.length) lists.document = app.activeDocument.motionPresets;
for (var k in lists) { if (!lists.hasOwnProperty(k)) continue; var names = []; for (var i = 0; i < lists[k].length; i++) names.push(lists[k].item(i).name); out[k] = names; }
__result__ = { operation: ${str(op)}, presets: out };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_timing',
        description: 'Arrange when animations play: reassign items to On Page Load or On Page Click, remove them, play them together or separately, and set delay, plays and loop (Timing panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Animated items (or media and multi-state objects) on one spread' },
                operation: { type: 'string', enum: ['assign', 'remove', 'play_together', 'play_separately', 'set'], description: 'assign (Reassign to On Page Load / On Page Click), remove (Remove Item), play_together, play_separately, set (delay, plays, loop)' },
                event: { type: 'string', enum: PAGE_EVENTS, description: 'assign: the event; other operations: only this event\'s list (default: the list holding each item, else On Page Load)' },
                delay: { type: 'number', minimum: 0, maximum: 3600, description: 'Delay in seconds after the previous item (assign, play_together, set)' },
                plays: { type: 'integer', minimum: 1, description: 'set: play the item\'s group this many times' },
                loop: { type: 'boolean', description: 'set: loop the item\'s group' },
            },
            required: ['target', 'operation'],
        },
        features: I(['timing_panel', 'timing_menu_reassign_to_on_page_load', 'timing_menu_reassign_to_on_page_click', 'timing_menu_remove_item',
            'timing_menu_play_together', 'timing_menu_play_separately']),
        hints: { readOnly: false },
        auditArgs: { operation: 'set', event: 'ON_PAGE_CLICK', delay: 1, plays: 2, loop: true },
        handler: (a) => {
            const op = enumOf(a.operation, ['assign', 'remove', 'play_together', 'play_separately', 'set'], { name: 'operation' });
            if (op === 'assign' && a.event === undefined) throw new Error("'event' is required for operation assign");
            const ev = a.event === undefined ? null : enumOf(a.event, PAGE_EVENTS, { name: 'event' });
            const delay = a.delay === undefined ? null : num(a.delay, { name: 'delay', min: 0, max: 3600 });
            if (delay !== null && !['assign', 'play_together', 'set'].includes(op)) throw new Error(`'delay' does not apply to operation ${op}`);
            if ((a.plays !== undefined || a.loop !== undefined) && op !== 'set') throw new Error(`'plays' and 'loop' apply to operation set`);
            if (op === 'set' && delay === null && a.plays === undefined && a.loop === undefined) throw new Error('Nothing to set: give delay, plays or loop');
            const evLit = ev ? `DynamicTriggerEvents.${ev}` : 'null';
            let body;
            switch (op) {
            case 'assign':
                body = `for (var i = 0; i < items.length; i++) {
  var it = items[i];
  for (var e = 0; e < pageEvs.length; e++) { var l = __list(ts, DynamicTriggerEvents[pageEvs[e]]); if (l) __drop(l, it); }
  __ensureList(ts, ${evLit}).timingGroups.add(it, ${delay ?? 0});
}`;
                break;
            case 'remove':
                body = `for (var i = 0; i < items.length; i++) for (var e = 0; e < lists.length; e++) __drop(lists[e], items[i]);`;
                break;
            case 'play_together':
                body = `if (items.length < 2) throw new Error("play_together needs at least two items");
var home = null;
for (var e = 0; e < lists.length && !home; e++) { var f0 = __findIn(lists[e], items[0]); if (f0) home = { list: lists[e], group: f0.group }; }
if (!home) { var hl = __ensureList(ts, ${ev ? evLit : 'DynamicTriggerEvents.ON_PAGE_LOAD'}); home = { list: hl, group: hl.timingGroups.add(items[0], 0) }; }
for (var i = 1; i < items.length; i++) {
  var already = __findIn(home.list, items[i]);
  if (already && already.group.index == home.group.index) continue;
  __drop(home.list, items[i]);
  home.group.timingTargets.add(items[i], ${delay ?? 0});
}`;
                break;
            case 'play_separately':
                body = `for (var i = 0; i < items.length; i++) for (var e = 0; e < lists.length; e++) {
  var f = __findIn(lists[e], items[i]);
  if (f && f.group.timingTargets.length > 1) f.target.unlink();
}`;
                break;
            default:
                body = `var hits = 0;
for (var i = 0; i < items.length; i++) for (var e = 0; e < lists.length; e++) {
  var f = __findIn(lists[e], items[i]);
  if (!f) continue;
  hits++;
  ${delay !== null ? `f.target.delaySeconds = ${delay};` : ''}
  ${a.plays !== undefined ? `f.group.plays = ${index(a.plays, { name: 'plays', max: 1000 })};` : ''}
  ${a.loop !== undefined ? `f.group.playsLoop = ${boolArg(a.loop, 'loop')};` : ''}
}
if (!hits) throw new Error("None of the items is in the Timing panel");`;
            }
            return run('Set timing', script(`${HELPERS}${TIMING_JSX}
var items = __targets(doc, ${targetSpec(a.target)});
var sp = __spreadOf(items[0]), ts = sp.timingSettings, pageEvs = ${json(PAGE_EVENTS)};
for (var c = 1; c < items.length; c++) if (__spreadOf(items[c]).id != sp.id) throw new Error("The items must be on one spread");
var lists = [];
for (var li = 0; li < ts.timingLists.length; li++) { var tl0 = ts.timingLists.item(li); if (${ev ? `tl0.triggerEvent == ${evLit}` : 'true'}) lists.push(tl0); }
${body}
__result__ = { operation: ${str(op)}, timing: __timing(ts) };`));
        },
    },
    {
        name: 'place_media',
        description: 'Place a video or sound file, or a video from a URL, into a new frame or an existing frame, with its media options (File > Place; Media panel > Video from URL)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Video (MP4, F4V, FLV...) or sound (MP3...) file to place (give this or url)' },
                url: { type: 'string', description: 'URL of a video to play from the web (give this or filePath)' },
                frame: { type: 'integer', description: 'Id of an existing frame to place into (give this or bounds)' },
                bounds: BOUNDS_SCHEMA,
                options: { type: 'object', description: 'Media options, as set_media_options takes', properties: MEDIA_OPTION_SCHEMA },
            },
        },
        features: I(['movie', 'sound', 'video_from_url']),
        hints: { readOnly: false },
        auditArgs: { url: undefined, frame: undefined, bounds: { pageIndex: 0, x: 10, y: 10, width: 120, height: 68 }, options: { playOnPageLoad: true, embedInPDF: true } },
        handler: (a) => {
            if ((a.filePath === undefined) === (a.url === undefined)) throw new Error('Give filePath or url, not both');
            if ((a.frame === undefined) === (a.bounds === undefined)) throw new Error('Give frame (an existing frame id) or bounds, not both');
            const where = a.frame !== undefined
                ? `var frame = __byId(doc, ${itemId(a.frame, 'frame')});`
                : `${boundsJsx(a.bounds)}\nvar frame = pg.rectangles.add({ geometricBounds: gb, itemLayer: lay });`;
            const what = a.filePath !== undefined
                ? `var f = File(${filePath(a.filePath, 'filePath')}); if (!f.exists) throw new Error("File not found: " + f.fsName);
var placed = frame.place(f), m = null;
for (var p = 0; p < placed.length; p++) { var k = __kind(placed[p]); if (k === "Movie" || k === "Sound") m = placed[p]; }
if (!m) m = __mediaOf(frame);`
                : `var m = frame.movies.add();\nm.url = ${urlArg(a.url, 'url')};`;
            let opts = [];
            if (a.options !== undefined) {
                objectArg(a.options, 'options');
                checkKeys(a.options, Object.keys(MEDIA_OPTION_SCHEMA), 'options');
                opts = mediaStatements(a.options, 'options.');
            }
            return run('Place media', script(`${HELPERS}${MEDIA_JSX}${MEDIA_INFO_JSX}
${where}
${what}
${opts.join('\n')}
var info = __mediaInfo(m);
info.frame = frame.id;
__result__ = info;`));
        },
    },
    {
        name: 'set_media_options',
        description: 'Set video and sound options: play on page load, loop, poster, controller, navigation points, floating window and PDF description, embedding, and relink legacy media to a new file (Media panel, PDF Options)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Movies or sounds, or the frames holding them' },
                ...MEDIA_OPTION_SCHEMA,
                navigationPoints: {
                    type: 'object', description: 'Navigation points of a video (named times to play from)',
                    properties: {
                        add: { type: 'array', description: 'Points to add', items: { type: 'object', properties: { name: { type: 'string', description: 'Point name' }, time: { type: 'number', description: 'Time in seconds' } }, required: ['name', 'time'] } },
                        remove: { type: 'array', items: { type: 'string' }, description: 'Names of points to remove' },
                        clear: { type: 'boolean', description: 'Remove every point first' },
                    },
                },
                relinkTo: { type: 'string', description: 'Relink the media to this file, e.g. a legacy FLV or SWF to an MP4 (Links panel > Relink)' },
            },
            required: ['target'],
        },
        features: I(['media_panel', 'media_play_on_page_load', 'media_loop', 'media_poster', 'media_controller', 'media_navigation_points',
            'media_play_in_floating_window_pdf', 'media_embed_in_pdf', 'media_pdf_options', 'video_from_url', 'relink_legacy_media']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            stopOnPageTurn: undefined, doNotPrintPoster: undefined, poster: 'image', url: 'https://example.com/v.mp4',
            navigationPoints: { clear: true, add: [{ name: 'Intro', time: 1.5 }], remove: ['Old'] },
        },
        handler: (a) => {
            const lines = [];
            if (a.relinkTo !== undefined) {
                lines.push(`var rf = File(${filePath(a.relinkTo, 'relinkTo')}); if (!rf.exists) throw new Error("File not found: " + rf.fsName);`,
                    'm.itemLink.relink(rf); m = __mediaOf(it);');
            }
            const opts = {};
            for (const k of Object.keys(MEDIA_OPTION_SCHEMA)) if (a[k] !== undefined) opts[k] = a[k];
            lines.push(...mediaStatements(opts));
            if (a.navigationPoints !== undefined) {
                const n = objectArg(a.navigationPoints, 'navigationPoints');
                checkKeys(n, ['add', 'remove', 'clear'], 'navigationPoints');
                lines.push('__need(m, ["Movie"], "navigationPoints");', 'var nps = m.navigationPoints;');
                if (n.clear !== undefined && boolArg(n.clear, 'navigationPoints.clear') === 'true') lines.push('for (var c = nps.length - 1; c >= 0; c--) nps.item(c).remove();');
                if (n.remove !== undefined) {
                    if (!Array.isArray(n.remove)) throw new Error("'navigationPoints.remove' must be a list of names");
                    n.remove.forEach((r, i) => lines.push(`var rp = nps.itemByName(${nameArg(r, `navigationPoints.remove[${i}]`)}); if (rp.isValid) rp.remove();`));
                }
                if (n.add !== undefined) {
                    if (!Array.isArray(n.add) || n.add.length > 100) throw new Error("'navigationPoints.add' must be a list of up to 100 points");
                    n.add.forEach((p, i) => {
                        objectArg(p, `navigationPoints.add[${i}]`);
                        checkKeys(p, ['name', 'time'], `navigationPoints.add[${i}]`);
                        lines.push(`nps.add({ name: ${nameArg(p.name, `navigationPoints.add[${i}].name`)}, time: ${num(p.time, { name: `navigationPoints.add[${i}].time`, min: 0, max: 86400 })} });`);
                    });
                }
            }
            if (!lines.length) throw new Error('Nothing to set: give a media option, navigationPoints or relinkTo');
            return run('Set media options', script(`${HELPERS}${MEDIA_JSX}${MEDIA_INFO_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], m = __mediaOf(it);
  ${lines.join('\n  ')}
  out.push(__mediaInfo(m));
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'set_page_transitions',
        description: 'Apply a page transition to chosen or all spreads, clear all transitions, and set how an interactive PDF shows them (Page Transitions panel: Apply to All Spreads, Clear All; Export to Interactive PDF: Open in Full Screen Mode, Page Transitions)',
        inputSchema: {
            type: 'object',
            properties: {
                spreads: { type: 'array', items: { type: 'integer' }, description: 'Spread indexes (0-based); omit for all spreads' },
                transition: { type: 'string', enum: TRANSITIONS, description: 'Transition type; NONE removes it' },
                direction: { type: 'string', enum: TRANSITION_DIRECTIONS, description: 'Direction, one the transition supports' },
                speed: { type: 'string', enum: ['FAST', 'MEDIUM', 'SLOW'], description: 'Speed' },
                clearAll: { type: 'boolean', description: 'Clear All: remove the transitions of every spread' },
                pdf: {
                    type: 'object', description: 'Interactive PDF export settings that show transitions',
                    properties: {
                        openInFullScreen: { type: 'boolean', description: 'Open in Full Screen Mode (transitions play in full screen)' },
                        transitionOverride: { type: 'string', enum: TRANSITION_OVERRIDES, description: 'Page Transitions: FROM_DOCUMENT keeps each spread\'s, or one for every page' },
                    },
                },
            },
        },
        features: I(['page_transitions_panel', 'page_transitions_menu_choose', 'page_transitions_menu_apply_to_all_spreads', 'page_transitions_menu_clear_all', 'view_page_transitions_pdf']),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { clearAll: undefined, spreads: undefined, transition: 'WIPE_TRANSITION', direction: 'LEFT_TO_RIGHT', pdf: { openInFullScreen: true, transitionOverride: 'FROM_DOCUMENT' } },
        handler: (a) => {
            const lines = [];
            if (a.clearAll !== undefined) {
                if (boolArg(a.clearAll, 'clearAll') === 'true') {
                    if (a.transition !== undefined || a.spreads !== undefined || a.direction !== undefined || a.speed !== undefined) throw new Error("'clearAll' cannot be combined with spreads or transition options");
                    lines.push('for (var c = 0; c < doc.spreads.length; c++) doc.spreads.item(c).pageTransitionType = PageTransitionTypeOptions.NONE;');
                }
            }
            if (a.transition !== undefined || a.direction !== undefined || a.speed !== undefined) {
                const sel = a.spreads === undefined ? 'doc.spreads.everyItem().getElements()' : `__spreads(${idList(a.spreads, 'spreads', { max: 10000 })})`;
                lines.push(`var sps = ${sel};`, 'for (var i = 0; i < sps.length; i++) {', '  var sp = sps[i];');
                if (a.transition !== undefined) lines.push(`  sp.pageTransitionType = PageTransitionTypeOptions.${enumOf(a.transition, TRANSITIONS, { name: 'transition' })};`);
                if (a.direction !== undefined) lines.push(`  sp.pageTransitionDirection = PageTransitionDirectionOptions.${enumOf(a.direction, TRANSITION_DIRECTIONS, { name: 'direction' })};`);
                if (a.speed !== undefined) lines.push(`  sp.pageTransitionDuration = PageTransitionDurationOptions.${enumOf(a.speed, ['FAST', 'MEDIUM', 'SLOW'], { name: 'speed' })};`);
                lines.push('}');
            } else if (a.spreads !== undefined) throw new Error("'spreads' needs transition, direction or speed");
            if (a.pdf !== undefined) {
                objectArg(a.pdf, 'pdf');
                checkKeys(a.pdf, ['openInFullScreen', 'transitionOverride'], 'pdf');
                if (a.pdf.openInFullScreen !== undefined) lines.push(`app.interactivePDFExportPreferences.openInFullScreen = ${boolArg(a.pdf.openInFullScreen, 'pdf.openInFullScreen')};`);
                if (a.pdf.transitionOverride !== undefined) lines.push(`app.interactivePDFExportPreferences.pageTransitionOverride = PageTransitionOverrideOptions.${enumOf(a.pdf.transitionOverride, TRANSITION_OVERRIDES, { name: 'pdf.transitionOverride' })};`);
            }
            if (!lines.length) throw new Error('Nothing to set: give transition, direction, speed, clearAll or pdf');
            return run('Set page transitions', script(`
var __spreads = function (ids) {
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] >= doc.spreads.length) throw new Error("Spread index " + ids[i] + " is out of range; the document has " + doc.spreads.length + " spreads");
    out.push(doc.spreads.item(ids[i]));
  }
  return out;
};
${lines.join('\n')}
var list = [];
for (var s = 0; s < doc.spreads.length; s++) {
  var x = doc.spreads.item(s);
  list.push({ index: s, transition: __enumName(x.pageTransitionType), direction: __enumName(x.pageTransitionDirection), speed: __enumName(x.pageTransitionDuration) });
}
var ip = app.interactivePDFExportPreferences;
__result__ = { spreads: list, pdf: { openInFullScreen: ip.openInFullScreen, transitionOverride: __enumName(ip.pageTransitionOverride) } };`));
        },
    },
    {
        name: 'get_interactive_elements',
        description: 'List the interactive elements of the document or a page: buttons with appearances and actions, form fields, multi-state objects and states, video and sound, animations, timing, page transitions and tab order (Buttons and Forms, Object States, Media, Animation and Timing panels)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: { type: 'integer', minimum: 0, description: 'Only this page (0-based); omit for the whole document' },
                include: { type: 'array', items: { type: 'string', enum: INCLUDE }, description: `What to list (default: all of ${INCLUDE.join(', ')})` },
            },
        },
        features: I(['buttons_forms_panel', 'object_states_panel', 'media_panel', 'animation_panel', 'timing_panel']),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const inc = a.include === undefined ? INCLUDE : a.include;
            if (!Array.isArray(inc) || !inc.length) throw new Error(`'include' must be a non-empty list of: ${INCLUDE.join(', ')}`);
            const want = new Set(inc.map((x, i) => enumOf(x, INCLUDE, { name: `include[${i}]` })));
            const scope = a.pageIndex === undefined ? 'var src = doc, pages = doc.pages.everyItem().getElements(), spreads = doc.spreads.everyItem().getElements();'
                : `var pg = __page(doc, ${index(a.pageIndex, { name: 'pageIndex' })}), src = pg, pages = [pg], spreads = [pg.parent];`;
            const parts = [];
            if (want.has('buttons')) {
                parts.push(`out.buttons = [];
for (var i = 0; i < src.buttons.length; i++) { var b = src.buttons.item(i), o = __itemInfo(b); o.description = b.description; o.hiddenUntilTriggered = b.hiddenUntilTriggered; o.printableInPdf = b.printableInPdf; o.states = __states(b); o.actions = __behaviors(b); out.buttons.push(o); }`);
            }
            if (want.has('form_fields')) {
                parts.push(`out.formFields = [];
var kinds = ["textBoxes", "checkBoxes", "radioButtons", "comboBoxes", "listBoxes", "signatureFields"];
var props = ["description", "printableInPdf", "required", "readOnly", "hiddenUntilTriggered", "password", "multiline", "scrollable", "fontSize", "appliedFont", "checkedByDefault", "exportValue", "choiceList", "sortChoices", "multipleSelection"];
for (var k = 0; k < kinds.length; k++) {
  var coll = src[kinds[k]];
  for (var j = 0; j < coll.length; j++) {
    var f = coll.item(j).getElements()[0], fo = __itemInfo(f);
    for (var p = 0; p < props.length; p++) { try { var v = f[props[p]]; if (v !== undefined && v !== null) fo[props[p]] = v; } catch (e) {} }
    fo.actions = __behaviors(f);
    out.formFields.push(fo);
  }
}`);
            }
            if (want.has('multi_state_objects')) {
                parts.push(`out.multiStateObjects = [];
for (var m = 0; m < src.multiStateObjects.length; m++) { var ms = src.multiStateObjects.item(m), mo = __itemInfo(ms); mo.hiddenUntilTriggered = ms.initiallyHidden; mo.activeStateIndex = ms.activeStateIndex; mo.states = __states(ms); out.multiStateObjects.push(mo); }`);
            }
            if (want.has('media') || want.has('animations')) {
                parts.push(`var all = src.allPageItems;
${want.has('media') ? 'out.media = [];' : ''}
${want.has('animations') ? 'out.animations = [];' : ''}
for (var q = 0; q < all.length; q++) {
  var x = all[q], kx = __kind(x);
  ${want.has('media') ? 'if (kx === "Movie" || kx === "Sound") out.media.push(__mediaInfo(x));' : ''}
  ${want.has('animations') ? `try {
    var s = x.animationSettings, named = false;
    try { named = s.preset && s.preset.name ? true : false; } catch (e0) {}
    if (named || s.hasCustomSettings) {
      out.animations.push({
        item: __itemInfo(x), preset: named ? s.preset.name : null, duration: s.duration, plays: s.plays, loop: s.playsLoop,
        speed: __enumName(s.easeType), animate: __enumName(s.designOption),
        hideUntilAnimated: s.initiallyHidden, hideAfterAnimating: s.hiddenAfter, origin: s.transformOffsets
      });
    }
  } catch (e1) {}` : ''}
}`);
            }
            if (want.has('timing')) {
                parts.push('out.timing = [];\nfor (var t = 0; t < spreads.length; t++) out.timing.push({ spread: spreads[t].index, lists: __timing(spreads[t].timingSettings) });');
            }
            if (want.has('page_transitions')) {
                parts.push(`out.pageTransitions = [];
for (var u = 0; u < spreads.length; u++) { var sp = spreads[u]; out.pageTransitions.push({ spread: sp.index, transition: __enumName(sp.pageTransitionType), direction: __enumName(sp.pageTransitionDirection), speed: __enumName(sp.pageTransitionDuration) }); }`);
            }
            if (want.has('tab_order')) {
                parts.push(`out.tabOrder = [];
for (var w = 0; w < pages.length; w++) { var to = pages[w].tabOrder, ids = []; for (var z = 0; z < to.length; z++) ids.push(to[z].id); if (ids.length) out.tabOrder.push({ page: pages[w].name, ids: ids }); }`);
            }
            return run('Get interactive elements', script(`${HELPERS}${MEDIA_INFO_JSX}${TIMING_JSX}
${scope}
var out = {};
${parts.join('\n')}
__result__ = out;`));
        },
    },
    {
        name: 'preview_interactivity',
        description: 'Play the selection, spread or document in the EPUB Interactivity Preview panel, or open the panel (Window > Interactive > EPUB Interactivity Preview); the preview shows in InDesign only',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: Object.keys(PREVIEW_ACTIONS), description: 'panel (open it), selection, spread or document' },
                target: { ...TARGET_SCHEMA, description: 'selection: items to select and preview (default: the current selection)' },
            },
            required: ['mode'],
        },
        features: I(['epub_interactivity_preview', 'preview_menu_preview_selection', 'preview_menu_preview_spread', 'preview_menu_preview_document']),
        hints: { readOnly: true },
        auditArgs: { mode: 'selection', target: { ids: [5, 6] } },
        handler: (a) => {
            const mode = enumOf(a.mode, Object.keys(PREVIEW_ACTIONS), { name: 'mode' });
            if (a.target !== undefined && mode !== 'selection') throw new Error("'target' applies to mode selection");
            const select = a.target !== undefined
                ? `var sel = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < sel.length; i++) sel[i].select(i ? SelectionOptions.ADD_TO : SelectionOptions.REPLACE_WITH);`
                : (mode === 'selection' ? 'if (!app.selection.length) throw new Error("Nothing is selected: pass target or select items first");' : '');
            return run('Preview interactivity', script(`
${select}
var ma = app.menuActions.itemByID(${PREVIEW_ACTIONS[mode]});
if (!ma.isValid) throw new Error("This InDesign version has no ${mode} preview command");
if (!ma.enabled) throw new Error("The ${mode} preview command is not available now (" + ma.name + ")");
ma.invoke();
__result__ = { mode: ${str(mode)}, command: ma.name };`));
        },
    },
    {
        name: 'place_sample_button',
        description: 'List or place the ready-made buttons and form fields of InDesign\'s Sample Buttons and Forms library (Buttons and Forms panel > Sample Buttons and Forms)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The sample to place, by name; omit to list the samples' },
                pageIndex: { type: 'integer', minimum: 0, description: 'Page to place it on (0-based)' },
                x: { type: 'number', description: 'Left edge (mm from the page\'s left)' },
                y: { type: 'number', description: 'Top edge (mm from the page\'s top)' },
            },
        },
        features: I(['sample_buttons']),
        hints: { readOnly: false },
        auditArgs: { name: '001', pageIndex: 0, x: 20, y: 30 },
        handler: (a) => {
            const placing = a.name !== undefined;
            if (!placing && (a.pageIndex !== undefined || a.x !== undefined || a.y !== undefined)) throw new Error("'pageIndex', 'x' and 'y' apply when placing a sample (name)");
            let body = 'var names = []; for (var n = 0; n < lib.assets.length; n++) names.push(lib.assets.item(n).name); out.samples = names;';
            if (placing) {
                const p = index(a.pageIndex ?? 0, { name: 'pageIndex' });
                const x = num(a.x ?? 0, { name: 'x', min: -10000, max: 10000 });
                const y = num(a.y ?? 0, { name: 'y', min: -10000, max: 10000 });
                body = `var asset = lib.assets.itemByName(${nameArg(a.name, 'name')});
if (!asset.isValid) throw new Error("No sample named " + ${str(a.name)} + " in " + lib.name);
var pg = __page(doc, ${p});
var placed = asset.placeAsset(doc), items = [];
for (var i = 0; i < placed.length; i++) { try { placed[i].move(pg); items.push(placed[i]); } catch (e) {} }
if (items.length) {
  var u = __union(items), to = __toPage(pg, ${x}, ${y});
  for (var j = 0; j < items.length; j++) items[j].move(undefined, [to[0] - u[1], to[1] - u[0]]);
}
out.placed = [];
for (var k = 0; k < items.length; k++) out.placed.push(__itemInfo(items[k]));`;
            }
            return run('Place sample button', script(`${HELPERS}
var __findLib = function (f, depth) {
  var list = f.getFiles();
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x instanceof Folder) { if (depth < 2) { var r = __findLib(x, depth + 1); if (r) return r; } }
    else if (/\\.indl$/i.test(x.name) && /button/i.test(decodeURI(x.name))) return x;
  }
  return null;
};
var root = Folder(app.filePath.fsName + "/Presets");
var lf = root.exists ? __findLib(root, 0) : null;
if (!lf) throw new Error("The Sample Buttons and Forms library was not found under " + root.fsName);
var wasOpen = false;
for (var o = 0; o < app.libraries.length; o++) { try { if (app.libraries.item(o).fullName.fsName === lf.fsName) wasOpen = true; } catch (e) {} }
var lib = app.open(lf), out = { library: lf.fsName };
try {
  ${body}
} finally {
  if (!wasOpen) { try { lib.close(); } catch (e) {} }
}
__result__ = out;`));
        },
    },
];
