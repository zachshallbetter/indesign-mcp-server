/**
 * Pages, spreads and parent pages: multi-page spreads and splitting pages out
 * of spreads, hiding spreads, Layout menu navigation, Rotate Spread View,
 * page number and section markers, parent page commands,
 * page numbering and ruler views, and the Pages and Layers panels.
 *
 * Pages and spreads are 0-based indexes; parent spreads are chosen by their
 * full name (e.g. "A-Parent"). Measurements are millimetres.
 */
import { str, num, bool, enumOf, index, json } from 'adobe-mcp-core';
import { run } from './run.js';
import { commandScript, pathLit, has, nameArg } from './commands.js';

const P = 'indesign.pages_spreads.';
const ids = (...names) => names.map((n) => P + n);

/** Where text is inserted: a frame's start or end, or the text selection. */
export const PLACE_SCHEMA = {
    type: 'object',
    description: 'Where to insert: a text frame by id (on a document or parent page) at the start or end of its text, or the text selection / insertion point',
    properties: {
        frameId: { type: 'integer', description: 'Text frame id (PageItem.id)' },
        at: { type: 'string', enum: ['end', 'start'], description: 'Start or end of the frame\'s text, or of the selected text', default: 'end' },
        selection: { type: 'boolean', description: 'Use the text selection or insertion point' },
    },
};

/** A placement as a JSX literal for __insertionPoint(); every key is present. */
export function placeSpec(place) {
    const p = place ?? {};
    const frameId = has(p.frameId) ? Number(index(p.frameId, { name: 'place.frameId', max: 1e9 })) : null;
    if ((frameId === null) === !p.selection) throw new Error('Choose where to insert: place.frameId or place.selection: true');
    return json({ frameId, at: enumOf(p.at ?? 'end', ['end', 'start'], { name: 'place.at' }), selection: Boolean(p.selection) });
}

/** __insertionPoint(doc, spec): the insertion point a placement names. */
const PLACE_HELPER = String.raw`
var __insertionPoint = function (doc, spec) {
  var t;
  if (spec.selection) {
    if (app.selection.length === 0) throw new Error("Nothing is selected: select text or place the insertion point");
    t = app.selection[0];
    if (!t.hasOwnProperty("insertionPoints")) throw new Error("The selection is a " + t.constructor.name + ", not text");
  } else {
    t = __anyItem(doc, spec.frameId);
    if (t.constructor.name !== "TextFrame") throw new Error("Item " + spec.frameId + " is a " + t.constructor.name + ", not a text frame");
  }
  return spec.at === "start" ? t.insertionPoints[0] : t.insertionPoints.lastItem();
};
`;

const ARRANGE = ['keep_together', 'allow_shuffle', 'add_page_to_spread', 'split_page'];
const GO = {
    first_page: 'w.activePage = doc.pages[0];',
    last_page: 'w.activePage = doc.pages[doc.pages.length - 1];',
    next_page: '__docPage(w); if (w.activePage.documentOffset + 1 >= doc.pages.length) throw new Error("Already on the last page"); w.activePage = doc.pages[w.activePage.documentOffset + 1];',
    previous_page: '__docPage(w); if (w.activePage.documentOffset === 0) throw new Error("Already on the first page"); w.activePage = doc.pages[w.activePage.documentOffset - 1];',
    first_spread: 'w.activeSpread = doc.spreads[0];',
    last_spread: 'w.activeSpread = doc.spreads[doc.spreads.length - 1];',
    next_spread: '__docPage(w); if (w.activeSpread.index + 1 >= doc.spreads.length) throw new Error("Already on the last spread"); w.activeSpread = doc.spreads[w.activeSpread.index + 1];',
    previous_spread: '__docPage(w); if (w.activeSpread.index === 0) throw new Error("Already on the first spread"); w.activeSpread = doc.spreads[w.activeSpread.index - 1];',
    go_back: '__invoke(22786, "Go Back");',
    go_forward: '__invoke(22787, "Go Forward");',
};
const ROTATIONS = { cw_90: [6186, '90° CW'], ccw_90: [6187, '90° CCW'], rotate_180: [6188, '180°'], clear: [6183, 'Clear Rotation'] };
const MARKERS = { current_page_number: 'AUTO_PAGE_NUMBER', next_page_number: 'NEXT_PAGE_NUMBER', previous_page_number: 'PREVIOUS_PAGE_NUMBER', section_marker: 'SECTION_MARKER' };
const PARENT_ACTIONS = ['based_on', 'save_as_parent', 'load', 'select_unused', 'move_to_document', 'allow_overrides', 'parent_overlay'];
const MM_TO_PT = 72 / 25.4;

/** A value an action needs. */
function req(v, name, action) {
    if (!has(v)) throw new Error(`'${name}' is required for ${action}`);
    return v;
}

export const tools = [
    {
        name: 'arrange_spread_pages',
        description: 'Build multi-page spreads (gatefolds and fold-outs, up to 10 pages) and split pages out of spreads, as dragging pages in the Pages panel does: keep a spread together (Allow Selected Spread to Shuffle off) or let it shuffle again, move a page into a spread, or split a page into a spread of its own',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ARRANGE, description: 'keep_together / allow_shuffle change a spread; add_page_to_spread moves pageIndex into spreadIndex; split_page moves pageIndex to a new spread of its own after its spread' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'The spread (for keep_together, allow_shuffle and add_page_to_spread)' },
                pageIndex: { type: 'integer', minimum: 0, description: 'The page to move (for add_page_to_spread and split_page)' },
                position: { type: 'string', enum: ['end', 'beginning'], description: 'Where the page goes in the spread', default: 'end' },
            },
            required: ['action'],
        },
        features: ids('multi_page_spread', 'split_page_from_spread').concat('indesign.documents.pages_per_spread'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const action = enumOf(a.action, ARRANGE, { name: 'action' });
            const needSpread = action !== 'split_page';
            const needPage = action === 'add_page_to_spread' || action === 'split_page';
            if (needSpread && !has(a.spreadIndex)) throw new Error(`'spreadIndex' is required for ${action}`);
            if (needPage && !has(a.pageIndex)) throw new Error(`'pageIndex' is required for ${action}`);
            const si = needSpread ? index(a.spreadIndex, { name: 'spreadIndex' }) : '0';
            const pi = needPage ? index(a.pageIndex, { name: 'pageIndex' }) : '0';
            const at = enumOf(a.position ?? 'end', ['end', 'beginning'], { name: 'position' }) === 'end' ? 'AT_END' : 'AT_BEGINNING';
            const steps = {
                keep_together: `var sp = __spread(doc, ${si}); sp.allowPageShuffle = false;`,
                allow_shuffle: `var sp = __spread(doc, ${si}); sp.allowPageShuffle = true;`,
                add_page_to_spread: `
var sp = __spread(doc, ${si}), pg = __page(doc, ${pi});
if (pg.parent.index === sp.index && sp.pages.length > 1) throw new Error("Page " + pg.name + " is already in that spread");
if (sp.pages.length >= 10) throw new Error("A spread holds at most 10 pages");
sp.allowPageShuffle = false;
pg.parent.allowPageShuffle = false;
pg.move(LocationOptions.${at}, sp);`,
                split_page: `
var pg = __page(doc, ${pi}), from = pg.parent;
if (from.pages.length < 2) throw new Error("Page " + pg.name + " is already alone in its spread");
from.allowPageShuffle = false;
var sp = doc.spreads.add(LocationOptions.AFTER, from);
sp.allowPageShuffle = false;
var extra = sp.pages.everyItem().getElements();
pg.move(LocationOptions.AT_END, sp);
for (var x = 0; x < extra.length; x++) { if (extra[x].isValid && sp.pages.length > 1) extra[x].remove(); }`,
            };
            return run('Arrange spread pages', commandScript(`
${steps[action]}
var out = [];
for (var i = 0; i < doc.spreads.length && i < 200; i++) out.push(__spreadInfo(doc.spreads[i]));
__result__ = { action: ${str(action)}, spread: sp.index, spreads: out };`));
        },
    },
    {
        name: 'set_spread_visibility',
        description: 'Hide spreads from output and export or unhide them (Pages panel menu > Hide Spread / Unhide Spread, InDesign 2024 or later), and show or hide hidden spreads in the layout (View > Show Hidden Spreads, InDesign 2025 or later)',
        inputSchema: {
            type: 'object',
            properties: {
                spreads: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Spread indexes to hide or unhide' },
                hidden: { type: 'boolean', description: 'true hides the spreads, false unhides them' },
                showHiddenSpreads: { type: 'boolean', description: 'Show hidden spreads in the layout view' },
            },
        },
        features: ids('hide_spread', 'unhide_spread', 'show_hidden_spreads'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const list = Array.isArray(a.spreads) ? a.spreads.map((s) => Number(index(s, { name: 'spreads' }))) : [];
            if (list.length && typeof a.hidden !== 'boolean') throw new Error("'hidden' (true or false) is required with spreads");
            if (!list.length && !has(a.showHiddenSpreads)) throw new Error('Nothing to do: pass spreads with hidden, or showHiddenSpreads');
            return run('Set spread visibility', commandScript(`
var list = ${json(list)}, out = [];
for (var i = 0; i < list.length; i++) {
  var sp = __spread(doc, list[i]);
  if (!__hasProp(sp, "spreadHidden")) throw new Error("Hiding spreads needs InDesign 2024 (19.0) or later");
  sp["spreadHidden"] = ${bool(a.hidden)};
  out.push(__spreadInfo(sp));
}
var dp = doc.documentPreferences, shown = null;
${has(a.showHiddenSpreads) ? `if (!__hasProp(dp, "spreadHiddenVisibility")) throw new Error("Show Hidden Spreads needs InDesign 2025 (20.0) or later");
dp["spreadHiddenVisibility"] = ${bool(a.showHiddenSpreads)};` : ''}
if (__hasProp(dp, "spreadHiddenVisibility")) shown = dp["spreadHiddenVisibility"];
__result__ = { spreads: out, showHiddenSpreads: shown };`));
        },
    },
    {
        name: 'go_to_page',
        description: 'Move the document window through the layout as the Layout menu does: First / Last / Next / Previous Page, First / Last / Next / Previous Spread, and Go Back / Go Forward through the pages viewed',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(GO), description: 'Where to go' },
            },
            required: ['command'],
        },
        features: ids('first_page', 'last_page', 'next_page', 'previous_page', 'next_spread', 'previous_spread', 'go_back', 'go_forward'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(GO), { name: 'command' });
            return run('Go to page', commandScript(`
var __docPage = function (w) {
  if (w.activeSpread.constructor.name !== "Spread") throw new Error("The window shows a parent spread; go to a document page first");
};
var w = __window(doc);
${GO[command]}
var pg = w.activePage;
__result__ = { command: ${str(command)}, page: pg.name, pageIndex: pg.parent.constructor.name === "Spread" ? pg.documentOffset : null, spread: w.activeSpread.index, parentSpread: pg.parent.constructor.name === "MasterSpread" };`));
        },
    },
    {
        name: 'rotate_spread_view',
        description: 'Rotate how a spread is shown, to edit rotated content without changing output: 90° clockwise, 90° counter-clockwise, 180°, or clear the rotation (View > Rotate Spread; Pages panel menu > Rotate Spread View)',
        inputSchema: {
            type: 'object',
            properties: {
                rotation: { type: 'string', enum: Object.keys(ROTATIONS), description: 'The view rotation' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'The spread (default: the active spread)' },
            },
            required: ['rotation'],
        },
        features: ids('rotate_spread_view', 'rotate_spread_cw', 'rotate_spread_ccw', 'rotate_spread_180', 'rotate_spread_clear'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const rotation = enumOf(a.rotation, Object.keys(ROTATIONS), { name: 'rotation' });
            const [id, label] = ROTATIONS[rotation];
            const si = has(a.spreadIndex) ? index(a.spreadIndex, { name: 'spreadIndex' }) : null;
            return run('Rotate spread view', commandScript(`
var w = __window(doc);
${si !== null ? `w.activeSpread = __spread(doc, ${si});` : ''}
__invoke(${id}, ${str(`Rotate Spread View ${label}`)});
__result__ = { rotation: ${str(rotation)}, spread: w.activeSpread.index };`));
        },
    },
    {
        name: 'insert_page_marker',
        description: 'Insert a page number or section marker (Type > Insert Special Character > Markers): Current Page Number (usually on a parent page), Next or Previous Page Number for jump lines, or Section Marker; optionally set the section marker text of the page\'s section',
        inputSchema: {
            type: 'object',
            properties: {
                marker: { type: 'string', enum: Object.keys(MARKERS), description: 'The marker to insert' },
                place: PLACE_SCHEMA,
                markerText: { type: 'string', description: 'For section_marker: set the marker text of the section the frame\'s page belongs to (Numbering & Section Options > Section Marker)' },
            },
            required: ['marker', 'place'],
        },
        features: ids('current_page_number', 'next_page_number', 'previous_page_number', 'section_marker'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { place: { frameId: 1 }, markerText: undefined },
        handler: (a) => {
            const marker = enumOf(a.marker, Object.keys(MARKERS), { name: 'marker' });
            const spec = placeSpec(a.place);
            if (has(a.markerText) && marker !== 'section_marker') throw new Error("'markerText' goes with marker: section_marker");
            const text = has(a.markerText) ? str(nameArg(a.markerText, 'markerText', 1000)) : null;
            return run('Insert page marker', commandScript(`${PLACE_HELPER}
var ip = __insertionPoint(doc, ${spec});
var section = null;
${text ? `var tf = ip.parentTextFrames.length ? ip.parentTextFrames[0] : null;
var pg = tf ? __pageOf(tf) : null;
if (!pg || pg.parent.constructor.name !== "Spread") throw new Error("Set markerText from a frame on a document page; on a parent page the marker shows each section's own text");
pg.appliedSection.marker = ${text};
section = pg.appliedSection.name;` : ''}
ip.contents = SpecialCharacters.${MARKERS[marker]};
__result__ = { marker: ${str(marker)}, storyId: ip.parentStory.id, at: ip.index, section: section };`));
        },
    },
    {
        name: 'manage_parent_pages',
        description: 'Parent page commands (Pages panel menu > Parent Pages): base a parent on another parent, save a document spread as a parent, load parent pages from another document, select unused parents (and list them), copy a parent to another open document (Move Parent), allow or prevent overrides of parent items, or offset the parent page overlay on a resized page',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: PARENT_ACTIONS, description: 'The command' },
                parent: { type: 'string', description: 'Parent spread full name, e.g. "A-Parent" (for based_on and move_to_document)' },
                basedOn: { type: 'string', description: 'For based_on: the parent to base it on, or "None"' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'For save_as_parent: the document spread' },
                filePath: { type: 'string', description: 'For load: the InDesign document (.indd or .indt) to load parents from' },
                clash: { type: 'string', enum: ['rename', 'overwrite'], description: 'For load: when a parent of the same name exists, rename the loaded one or replace the existing one', default: 'rename' },
                toDocument: { type: 'string', description: 'For move_to_document: name of the open document to copy the parent into' },
                itemIds: { type: 'array', items: { type: 'integer' }, description: 'For allow_overrides: ids of items on parent spreads' },
                allow: { type: 'boolean', description: 'For allow_overrides: allow (true) or prevent (false) overriding the items on document pages' },
                pageIndex: { type: 'integer', minimum: 0, description: 'For parent_overlay: the document page' },
                offsetX: { type: 'number', description: 'For parent_overlay: horizontal offset of the parent page, mm (0 with offsetY 0 clears it)' },
                offsetY: { type: 'number', description: 'For parent_overlay: vertical offset of the parent page, mm' },
            },
            required: ['action'],
        },
        features: ids('parent_based_on', 'save_as_parent', 'load_parent_pages', 'select_unused_parents', 'move_parent', 'allow_parent_item_overrides', 'parent_overlay'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'based_on', parent: 'A-Parent', basedOn: 'B-Parent' },
        handler: (a) => {
            const action = enumOf(a.action, PARENT_ACTIONS, { name: 'action' });
            const parentLookup = (v, name) => `var ms = doc.masterSpreads.itemByName(${str(nameArg(v, name))});
if (!ms.isValid) throw new Error(${str(`No parent spread named ${v}`)});`;
            let body;
            switch (action) {
                case 'based_on': {
                    const none = /^none$/i.test(String(a.basedOn ?? ''));
                    body = `${parentLookup(a.parent, 'parent')}
${none ? 'ms.appliedMaster = NothingEnum.NOTHING;' : `var base = doc.masterSpreads.itemByName(${str(nameArg(a.basedOn, 'basedOn'))});
if (!base.isValid) throw new Error(${str(`No parent spread named ${a.basedOn}`)});
if (base.id === ms.id) throw new Error("A parent cannot be based on itself");
ms.appliedMaster = base;`}
__result__ = { parent: ms.name, basedOn: ms.appliedMaster === NothingEnum.NOTHING || !ms.appliedMaster ? null : ms.appliedMaster.name };`;
                    break;
                }
                case 'save_as_parent':
                    body = `var sp = __spread(doc, ${index(req(a.spreadIndex, 'spreadIndex', action), { name: 'spreadIndex' })});
var before = doc.masterSpreads.length;
__window(doc).activeSpread = sp;
sp.select();
__invoke(6157, "Save as Parent");
if (doc.masterSpreads.length === before) throw new Error("No parent was created");
__result__ = { spread: sp.index, parent: doc.masterSpreads[doc.masterSpreads.length - 1].name };`;
                    break;
                case 'load': {
                    if (typeof a.filePath !== 'string' || !/\.(indd|indt)$/i.test(a.filePath)) throw new Error("'filePath' must be an .indd or .indt file");
                    const p = pathLit(a.filePath);
                    const clash = enumOf(a.clash ?? 'rename', ['rename', 'overwrite'], { name: 'clash' });
                    body = `var f = File(${p});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var before = doc.masterSpreads.length;
doc.loadMasters(f, GlobalClashResolutionStrategyForMasterPage.${clash === 'rename' ? 'LOAD_ALL_WITH_RENAME' : 'LOAD_ALL_WITH_OVERWRITE'});
var names = [];
for (var i = 0; i < doc.masterSpreads.length; i++) names.push(doc.masterSpreads[i].name);
__result__ = { from: f.fsName, added: doc.masterSpreads.length - before, parents: names };`;
                    break;
                }
                case 'select_unused':
                    body = `var used = {};
for (var i = 0; i < doc.pages.length; i++) { var m = doc.pages[i].appliedMaster; if (m && m.isValid) used[m.name] = true; }
for (var j = 0; j < doc.masterSpreads.length; j++) { var b = doc.masterSpreads[j].appliedMaster; if (b && b.isValid) used[b.name] = true; }
var unused = [];
for (var k = 0; k < doc.masterSpreads.length; k++) if (!used[doc.masterSpreads[k].name]) unused.push(doc.masterSpreads[k].name);
if (unused.length) __invoke(6151, "Select Unused Parents");
__result__ = { unused: unused, selected: unused.length > 0 };`;
                    break;
                case 'move_to_document':
                    body = `${parentLookup(a.parent, 'parent')}
var target = app.documents.itemByName(${str(nameArg(a.toDocument, 'toDocument'))});
if (!target.isValid) throw new Error(${str(`No open document named ${a.toDocument}`)});
if (target.id === doc.id) throw new Error("Choose another open document");
var copy = ms.duplicate(LocationOptions.AT_END, target);
__result__ = { parent: ms.name, document: target.name, copy: copy.name };`;
                    break;
                case 'allow_overrides': {
                    if (!Array.isArray(a.itemIds) || !a.itemIds.length) throw new Error("'itemIds' is required: ids of items on parent spreads");
                    if (typeof a.allow !== 'boolean') throw new Error("'allow' (true or false) is required");
                    const list = a.itemIds.map((i) => Number(index(i, { name: 'itemIds', max: 1e9 })));
                    body = `var list = ${json(list)}, out = [];
for (var i = 0; i < list.length; i++) {
  var it = __anyItem(doc, list[i]);
  if (it.parent.constructor.name !== "MasterSpread") throw new Error("Item " + list[i] + " is not on a parent spread");
  it.allowOverrides = ${bool(a.allow)};
  out.push({ id: it.id, type: it.constructor.name, allowOverrides: it.allowOverrides });
}
__result__ = { items: out };`;
                    break;
                }
                case 'parent_overlay': {
                    const pi = index(req(a.pageIndex, 'pageIndex', action), { name: 'pageIndex' });
                    const x = Number(num(a.offsetX ?? 0, { min: -5486.4, max: 5486.4, name: 'offsetX' }));
                    const y = Number(num(a.offsetY ?? 0, { min: -5486.4, max: 5486.4, name: 'offsetY' }));
                    body = `var pg = __page(doc, ${pi});
if (!pg.appliedMaster || !pg.appliedMaster.isValid) throw new Error("Page " + pg.name + " has no parent applied");
pg.masterPageTransform = app.transformationMatrices.add(1, 1, 0, 0, ${(x * MM_TO_PT).toFixed(4)}, ${(y * MM_TO_PT).toFixed(4)});
__result__ = { page: pg.name, parent: pg.appliedMaster.name, offsetX: ${x}, offsetY: ${y} };`;
                    break;
                }
                default:
                    throw new Error(`Unknown action ${action}`);
            }
            return run('Parent pages', commandScript(body));
        },
    },
    {
        name: 'set_layout_view_options',
        description: 'Set how the layout is numbered and measured: page numbering view by section or absolute (Preferences > General > Page Numbering View), the content grabber on graphic frames (View > Extras > Show/Hide Content Grabber), the ruler origin per page, spread or on the spine, and the zero point (Preferences > Units & Increments; the ruler zero point). With no options it reads them',
        inputSchema: {
            type: 'object',
            properties: {
                pageNumbering: { type: 'string', enum: ['section', 'absolute'], description: 'Show section numbering or absolute page positions in the interface' },
                showContentGrabber: { type: 'boolean', description: 'Show the content grabber in graphic frames' },
                rulerOrigin: { type: 'string', enum: ['page', 'spread', 'spine'], description: 'Where the horizontal ruler starts' },
                zeroPoint: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Ruler zero point [x, y] in mm, relative to the current origin ([0, 0] resets it)' },
            },
        },
        features: ids('page_numbering_display').concat('indesign.selection.content_grabber', 'indesign.documents.zero_point'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const L = [];
            if (has(a.pageNumbering)) L.push(`app.generalPreferences.pageNumbering = PageNumberingOptions.${enumOf(a.pageNumbering, ['section', 'absolute'], { name: 'pageNumbering' }).toUpperCase()};`);
            if (has(a.showContentGrabber)) L.push(`app.generalPreferences.showContentGrabber = ${bool(a.showContentGrabber)};`);
            if (has(a.rulerOrigin)) L.push(`doc.viewPreferences.rulerOrigin = RulerOrigin.${enumOf(a.rulerOrigin, ['page', 'spread', 'spine'], { name: 'rulerOrigin' }).toUpperCase()}_ORIGIN;`);
            if (has(a.zeroPoint)) {
                if (!Array.isArray(a.zeroPoint) || a.zeroPoint.length !== 2) throw new Error("'zeroPoint' must be [x, y]");
                L.push(`doc.zeroPoint = [${a.zeroPoint.map((v) => num(v, { min: -5486.4, max: 5486.4, name: 'zeroPoint' })).join(', ')}];`);
            }
            return run('Layout view options', commandScript(`
${L.join('\n')}
var gp = app.generalPreferences;
__result__ = { pageNumbering: __enumName(gp.pageNumbering), showContentGrabber: gp.showContentGrabber, rulerOrigin: __enumName(doc.viewPreferences.rulerOrigin), zeroPoint: doc.zeroPoint };`));
        },
    },
    {
        name: 'show_document_panels',
        description: 'Show or hide the Pages panel (Window > Pages) and the Layers panel (Window > Layers)',
        inputSchema: {
            type: 'object',
            properties: {
                pages: { type: 'boolean', description: 'Show (true) or hide (false) the Pages panel' },
                layers: { type: 'boolean', description: 'Show (true) or hide (false) the Layers panel' },
            },
        },
        features: ids('pages_panel').concat('indesign.layers.layers_panel'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            if (!has(a.pages) && !has(a.layers)) throw new Error('Nothing to do: pass pages and/or layers');
            const L = [];
            if (has(a.pages)) L.push(`out.pages = __panel("Pages", 6145, ${bool(a.pages)});`);
            if (has(a.layers)) L.push(`out.layers = __panel("Layers", 18433, ${bool(a.layers)});`);
            return run('Show panels', commandScript(`
var __panel = function (name, menuId, want) {
  var p = app.panels.itemByName(name);
  if (p.isValid) { p.visible = want; return p.visible; }
  var on = __menuOn(menuId);
  if (on === null) throw new Error("Cannot find the " + name + " panel");
  if (on !== want) __invoke(menuId, "Window > " + name);
  return want;
};
var out = {};
${L.join('\n')}
__result__ = out;`, { needsDocument: false }));
        },
    },
];
