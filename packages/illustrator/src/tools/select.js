/**
 * The rest of the Select menu, locking, hiding and isolation.
 *
 * Select > Object, Reselect, Inverse, Next Object Above and Below, Global Edit,
 * the Lock and Hide commands and isolation mode go through executeMenuCommand:
 * none of them opens a dialog. Locking or hiding the targets themselves, nested
 * selection and tolerance matching are done through the object model.
 * Save Selection and Edit Selection open dialogs and saved selections have no
 * object-model member, so they are not offered.
 */
import { num, str, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

/** Select > Object commands, by the kind of object each selects. */
export const OBJECT_KINDS = {
    all_text: 'Text Objects menu item',
    point_type: 'Point Text Objects menu item',
    area_type: 'Area Text Objects menu item',
    clipping_masks: 'Clipping Masks menu item',
    stray_points: 'Stray Points menu item',
    brush_strokes: 'Brush Strokes menu item',
    bristle_brush_strokes: 'Bristle Brush Strokes menu item',
    not_pixel_aligned: 'Selection Hat 12',
    flash_dynamic_text: 'Dynamic Text',
    flash_input_text: 'Input Text',
    same_layers: 'Selection Hat 3',
    direction_handles: 'Selection Hat 1',
};

/** Kinds that start from the current selection rather than the whole document. */
const FROM_SELECTION = ['same_layers', 'direction_handles'];

/** Select menu commands that change the current selection. */
export const SELECTION_CHANGES = {
    reselect: 'Find Reselect menu item',
    inverse: 'Inverse menu item',
    next_above: 'Selection Hat 8',
    next_below: 'Selection Hat 9',
};

/** Object > Lock and Object > Hide commands for artwork other than the targets. */
export const LOCK_COMMANDS = { above: 'Selection Hat 5', others: 'lock2' };
export const HIDE_COMMANDS = { above: 'Selection Hat 4', others: 'hide2' };
const SCOPES = ['selection', 'above', 'others'];

const HINTS = { readOnly: false, destructive: false, idempotent: false, openWorld: false };

/** ES3: select exactly these items. */
const SELECT = `
function __select(doc, items) {
  doc.selection = null;
  for (var i = 0; i < items.length; i++) items[i].selected = true;
}`;

/** ES3: the selection as item info. */
const SELECTION = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) { try { out.push(__itemInfo(doc, sel[j])); } catch (e) { out.push({ type: sel[j].typename }); } }`;

/**
 * ES3: record one state of every item and layer (locked or hidden), then report
 * which of them a command changed.
 */
const CHANGES = `
function __snapshot(doc, prop, layerProp) {
  var snap = { pageItems: [], layers: [] }, i;
  for (i = 0; i < doc.pageItems.length; i++) snap.pageItems.push([doc.pageItems[i], doc.pageItems[i][prop]]);
  var walk = function (ls) {
    for (var j = 0; j < ls.length; j++) { snap.layers.push([ls[j], ls[j][layerProp]]); walk(ls[j].layers); }
  };
  walk(doc.layers);
  return snap;
}
function __changes(doc, snap, prop, layerProp) {
  var out = { changed: 0, pageItems: [], layers: [] }, i;
  for (i = 0; i < snap.pageItems.length; i++) {
    var it = snap.pageItems[i][0];
    if (it[prop] === snap.pageItems[i][1]) continue;
    out.changed++;
    if (out.pageItems.length < 500) { try { out.pageItems.push(__itemInfo(doc, it)); } catch (e) { out.pageItems.push({ type: it.typename }); } }
  }
  for (i = 0; i < snap.layers.length; i++) if (snap.layers[i][0][layerProp] !== snap.layers[i][1]) out.layers.push(snap.layers[i][0].name);
  return out;
}`;

/** ES3: an item and every container above it are unlocked and visible. */
const EDITABLE = `
function __editable(it) {
  var p = it;
  while (p && p.typename !== "Document") {
    try {
      if (p.typename === "Layer") { if (p.locked || !p.visible) return false; }
      else if (p.locked || p.hidden) return false;
    } catch (e) {}
    p = p.parent;
  }
  return true;
}`;

/** Script for lock_items or hide_items. */
function lockOrHide(a, { prop, layerProp, commands, label }) {
    const scope = enumOf(a.scope ?? 'selection', SCOPES, { name: 'scope' });
    return run(label, script(`${SELECT}${CHANGES}
var items = __targets(doc, ${targetSpec(a.target)});
var snap = __snapshot(doc, ${str(prop)}, ${str(layerProp)});
${scope === 'selection' ? `doc.selection = null;
for (var i = 0; i < items.length; i++) items[i].${prop} = true;` : `__select(doc, items);
app.executeMenuCommand(${str(commands[scope])});`}
var done = __changes(doc, snap, ${str(prop)}, ${str(layerProp)});
__result__ = { scope: ${str(scope)}, changed: done.changed, items: done.pageItems, layers: done.layers };`));
}

export const tools = [
    {
        name: 'select_by_type',
        description: 'Select every object of one kind (Select > Object): all_text, point_type, area_type, clipping_masks, stray_points (lone anchor points), brush_strokes, bristle_brush_strokes, not_pixel_aligned, flash_dynamic_text, flash_input_text. Two kinds start from a selection, given as target: same_layers (everything on the targets\' layers) and direction_handles (the handles of the targets\' paths). The selection is replaced',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: Object.keys(OBJECT_KINDS) },
                target: { ...TARGET_SCHEMA, description: 'For same_layers and direction_handles only: the items to start from' },
            },
            required: ['kind'],
        },
        features: [
            'illustrator.selection.object_all_text',
            'illustrator.selection.object_point_type',
            'illustrator.selection.object_area_type',
            'illustrator.selection.object_clipping_masks',
            'illustrator.selection.object_stray_points',
            'illustrator.selection.object_brush_strokes',
            'illustrator.selection.object_bristle_strokes',
            'illustrator.selection.object_not_pixel_aligned',
            'illustrator.selection.object_flash_dynamic_text',
            'illustrator.selection.object_flash_input_text',
            'illustrator.selection.object_all_same_layers',
            'illustrator.selection.object_direction_handles',
        ],
        menuCommands: Object.values(OBJECT_KINDS),
        hints: HINTS,
        auditArgs: { kind: 'same_layers' },
        handler: (a) => {
            const kind = enumOf(a.kind, Object.keys(OBJECT_KINDS), { name: 'kind' });
            const fromSelection = FROM_SELECTION.includes(kind);
            if (fromSelection && !a.target) throw new Error(`${kind} starts from a selection: give target (ids, names, or selection: true)`);
            if (!fromSelection && a.target) throw new Error(`${kind} selects across the whole document: leave out target`);
            return run('Select by type', script(`${SELECT}
${fromSelection ? `__select(doc, __targets(doc, ${targetSpec(a.target)}));` : ''}
app.executeMenuCommand(${str(OBJECT_KINDS[kind])});
${SELECTION}
__result__ = { kind: ${str(kind)}, selected: sel ? sel.length : 0, items: out };`));
        },
    },
    {
        name: 'change_selection',
        description: 'Change the selection with a Select menu command: reselect (repeat the last Select > Same or Select > Object command), inverse (select everything not selected), next_above or next_below (the next object up or down the stacking order in the same layer; next_below reaches objects hidden behind others). Give target to select those items first; otherwise the current selection is used',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: Object.keys(SELECTION_CHANGES) },
                target: { ...TARGET_SCHEMA, description: 'Items to select before the command. Default the current selection' },
            },
            required: ['action'],
        },
        features: [
            'illustrator.selection.reselect',
            'illustrator.selection.inverse',
            'illustrator.selection.next_object_above',
            'illustrator.selection.next_object_below',
            'illustrator.selection.select_behind',
        ],
        menuCommands: Object.values(SELECTION_CHANGES),
        hints: HINTS,
        handler: (a) => {
            const action = enumOf(a.action, Object.keys(SELECTION_CHANGES), { name: 'action' });
            const needsSelection = action === 'next_above' || action === 'next_below';
            return run('Change selection', script(`${SELECT}
${a.target ? `__select(doc, __targets(doc, ${targetSpec(a.target)}));` : ''}
${needsSelection ? 'if (!doc.selection || !doc.selection.length) throw new Error("Nothing is selected: give target to start from");' : ''}
app.executeMenuCommand(${str(SELECTION_CHANGES[action])});
${SELECTION}
__result__ = { action: ${str(action)}, selected: sel ? sel.length : 0, items: out };`));
        },
    },
    {
        name: 'select_nested_items',
        description: 'Select inside groups, as the Direct Selection and Group Selection tools do: children (the items directly inside each target group), all (every object inside the target groups at any depth, not the groups themselves) or parent (the group that holds each target, one level up). The selection is replaced',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                level: { type: 'string', enum: ['children', 'all', 'parent'] },
            },
            required: ['target', 'level'],
        },
        features: ['illustrator.selection.nested_selection'],
        hints: { ...HINTS, idempotent: true },
        handler: (a) => {
            const level = enumOf(a.level, ['children', 'all', 'parent'], { name: 'level' });
            return run('Select nested items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), picked = [], skipped = [];
var leaves = function (g) {
  for (var k = 0; k < g.pageItems.length; k++) {
    if (g.pageItems[k].typename === "GroupItem") leaves(g.pageItems[k]);
    else picked.push(g.pageItems[k]);
  }
};
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${{
        children: 'if (it.typename !== "GroupItem") { skipped.push(it.typename); continue; }\n  for (var c = 0; c < it.pageItems.length; c++) picked.push(it.pageItems[c]);',
        all: 'if (it.typename !== "GroupItem") { skipped.push(it.typename); continue; }\n  leaves(it);',
        parent: 'if (it.parent.typename !== "GroupItem") { skipped.push(it.typename + " not in a group"); continue; }\n  picked.push(it.parent);',
    }[level]}
}
if (!picked.length) throw new Error(${str(level === 'parent' ? 'None of the targets is inside a group' : 'None of the targets is a group with contents')});
doc.selection = null;
for (var j = 0; j < picked.length; j++) picked[j].selected = true;
${SELECTION}
__result__ = { level: ${str(level)}, selected: sel ? sel.length : 0, items: out, skipped: skipped };`));
        },
    },
    {
        name: 'toggle_global_edit',
        description: 'Start or stop Global Edit (Select > Start/Stop Global Edit): with an object selected it starts, and edits to that object then apply to every similar object; run it again to stop. Illustrator does not report whether Global Edit is on; the result shows the selection afterwards. The matching options (appearance, size, artboards) are set in the Properties panel',
        inputSchema: {
            type: 'object',
            properties: { target: { ...TARGET_SCHEMA, description: 'The object to start from. Default the current selection' } },
        },
        features: ['illustrator.selection.global_edit'],
        menuCommands: ['SmartEdit Menu Item'],
        hints: HINTS,
        handler: (a) => run('Toggle Global Edit', script(`${SELECT}
${a.target ? `__select(doc, __targets(doc, ${targetSpec(a.target)}));` : ''}
app.executeMenuCommand("SmartEdit Menu Item");
${SELECTION}
__result__ = { selected: sel ? sel.length : 0, items: out };`)),
    },
    {
        name: 'lock_items',
        description: 'Lock artwork so it cannot be selected or edited (Object > Lock): scope selection locks the targets, above locks the artwork stacked above them, others locks everything except them. The result lists what was locked',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scope: { type: 'string', enum: SCOPES, description: 'Default selection' },
            },
            required: ['target'],
        },
        features: ['illustrator.selection.lock_selection', 'illustrator.selection.lock_above', 'illustrator.selection.lock_others'],
        menuCommands: Object.values(LOCK_COMMANDS),
        hints: { ...HINTS, idempotent: true },
        handler: (a) => lockOrHide(a, { prop: 'locked', layerProp: 'locked', commands: LOCK_COMMANDS, label: 'Lock items' }),
    },
    {
        name: 'hide_items',
        description: 'Hide artwork (Object > Hide): scope selection hides the targets, above hides the artwork stacked above them, others hides everything except them. show_all shows it again. The result lists what was hidden',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                scope: { type: 'string', enum: SCOPES, description: 'Default selection' },
            },
            required: ['target'],
        },
        features: ['illustrator.selection.hide_selection', 'illustrator.selection.hide_above', 'illustrator.selection.hide_others'],
        menuCommands: Object.values(HIDE_COMMANDS),
        hints: { ...HINTS, idempotent: true },
        handler: (a) => lockOrHide(a, { prop: 'hidden', layerProp: 'visible', commands: HIDE_COMMANDS, label: 'Hide items' }),
    },
    {
        name: 'unlock_all',
        description: 'Unlock every locked object in the document (Object > Unlock All). Illustrator selects the unlocked objects; the result lists them',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.selection.unlock_all'],
        menuCommands: ['unlockAll'],
        hints: { ...HINTS, idempotent: true },
        handler: () => run('Unlock all', script(`${CHANGES}
var snap = __snapshot(doc, "locked", "locked");
app.executeMenuCommand("unlockAll");
var done = __changes(doc, snap, "locked", "locked");
__result__ = { changed: done.changed, items: done.pageItems, layers: done.layers };`)),
    },
    {
        name: 'show_all',
        description: 'Show every hidden object in the document (Object > Show All). Illustrator selects the objects it shows; the result lists them',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.selection.show_all'],
        menuCommands: ['showAll'],
        hints: { ...HINTS, idempotent: true },
        handler: () => run('Show all', script(`${CHANGES}
var snap = __snapshot(doc, "hidden", "visible");
app.executeMenuCommand("showAll");
var done = __changes(doc, snap, "hidden", "visible");
__result__ = { changed: done.changed, items: done.pageItems, layers: done.layers };`)),
    },
    {
        name: 'set_isolation_mode',
        description: 'Enter or leave isolation mode: enter isolates one group or object (Isolate Selected Object) so the rest of the artwork is dimmed and cannot be edited; exit leaves it (Exit Isolation Mode)',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['enter', 'exit'] },
                target: { ...TARGET_SCHEMA, description: 'For enter: the one group or object to isolate' },
            },
            required: ['mode'],
        },
        features: ['illustrator.selection.isolate', 'illustrator.selection.exit_isolation'],
        menuCommands: ['enterFocus', 'exitFocus'],
        hints: { ...HINTS, idempotent: true },
        auditArgs: { mode: 'enter' },
        handler: (a) => {
            const mode = enumOf(a.mode, ['enter', 'exit'], { name: 'mode' });
            if (mode === 'enter' && !a.target) throw new Error('enter isolates one item: give target');
            if (mode === 'exit' && a.target) throw new Error('exit leaves isolation mode and takes no target');
            if (mode === 'exit') return run('Exit isolation mode', script(`
app.executeMenuCommand("exitFocus");
__result__ = { mode: "exit" };`));
            return run('Isolate item', script(`${SELECT}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1) throw new Error("Isolation mode isolates one group or object: give a single target");
__select(doc, items);
app.executeMenuCommand("enterFocus");
var isolated = null;
try { isolated = items[0].isIsolated; } catch (e) {}
__result__ = { mode: "enter", isolated: isolated, item: __itemInfo(doc, items[0]) };`));
        },
    },
    {
        name: 'select_similar_items',
        description: 'Select every path whose stroke weight or opacity is within a tolerance of one reference path, optionally with the same blending mode (the Magic Wand\'s Stroke Weight, Opacity and Blending Mode options). Every option given must match. Unlocked, visible paths and compound paths on every layer are compared; guides and clipping paths are skipped. Colour tolerance is not offered: select_same matches fill or stroke colour exactly',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The one reference path or compound path' },
                strokeWeightTolerance: { type: 'number', minimum: 0, maximum: 1000, description: 'Match stroked paths whose stroke weight is within this many points of the reference\'s' },
                opacityTolerance: { type: 'number', minimum: 0, maximum: 100, description: 'Match paths whose opacity is within this many percent of the reference\'s' },
                blendingMode: { type: 'boolean', description: 'Match only paths with the reference\'s blending mode' },
            },
            required: ['target'],
        },
        features: ['illustrator.selection.mw_stroke_weight', 'illustrator.selection.mw_opacity', 'illustrator.selection.mw_blending_mode'],
        hints: { ...HINTS, idempotent: true },
        handler: (a) => {
            const weight = a.strokeWeightTolerance, opacity = a.opacityTolerance;
            if (weight === undefined && opacity === undefined && !a.blendingMode) {
                throw new Error('Give strokeWeightTolerance, opacityTolerance or blendingMode: true');
            }
            return run('Select similar items', script(`${EDITABLE}
var refs = __targets(doc, ${targetSpec(a.target)});
if (refs.length !== 1) throw new Error("Give one reference path as target");
var ref = refs[0];
if (ref.typename !== "PathItem" && ref.typename !== "CompoundPathItem") throw new Error("The reference must be a path or compound path, not " + ref.typename);
var paint = function (it) { return it.typename === "CompoundPathItem" ? (it.pathItems.length ? it.pathItems[0] : null) : it; };
var useWeight = ${bool(weight !== undefined)}, useOpacity = ${bool(opacity !== undefined)}, useBlend = ${bool(a.blendingMode)};
var refPaint = paint(ref), tolW = __len(doc, ${num(weight ?? 0, { min: 0, max: 1000, name: 'strokeWeightTolerance' })}), tolO = ${num(opacity ?? 0, { min: 0, max: 100, name: 'opacityTolerance' })};
if (useWeight && (!refPaint || !refPaint.stroked)) throw new Error("The reference has no stroke: leave out strokeWeightTolerance");
var candidates = [], i;
for (i = 0; i < doc.pathItems.length; i++) if (doc.pathItems[i].parent.typename !== "CompoundPathItem") candidates.push(doc.pathItems[i]);
for (i = 0; i < doc.compoundPathItems.length; i++) candidates.push(doc.compoundPathItems[i]);
var matched = [];
for (i = 0; i < candidates.length; i++) {
  var c = candidates[i], p = paint(c);
  if (!p || p.guides || p.clipping || !__editable(c)) continue;
  if (useWeight && (!p.stroked || Math.abs(p.strokeWidth - refPaint.strokeWidth) > tolW + 1e-6)) continue;
  if (useOpacity && Math.abs(c.opacity - ref.opacity) > tolO + 1e-6) continue;
  if (useBlend && c.blendingMode !== ref.blendingMode) continue;
  matched.push(c);
}
doc.selection = null;
for (i = 0; i < matched.length; i++) matched[i].selected = true;
var out = [];
for (i = 0; i < matched.length && i < 500; i++) out.push(__itemInfo(doc, matched[i]));
__result__ = { selected: matched.length, items: out };`));
        },
    },
];
