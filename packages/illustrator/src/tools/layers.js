/**
 * Layers panel menu commands and artboard commands beyond the basics in
 * documents.js.
 *
 * The Layers panel's Merge Selected, Flatten Artwork, Collect in New Layer,
 * Release to Layers and Reverse Order have no menu command a script can run,
 * so they are done through the object model the way the panel describes them.
 * The same goes for the Artboards panel's Duplicate, Delete Empty Artboards
 * and reordering. Paste in Front and Back, Convert to Artboards, Fit to
 * Artwork Bounds and the View menu toggles run their menu commands, none of
 * which opens a dialog.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec, colorSpec } from '../args.js';

/** ES3: a layer by name at any depth (top-level layers first), or the active layer. */
export const FIND_LAYER = `
function __findLayer(doc, name) {
  if (!name) return doc.activeLayer;
  var walk = function (ls) {
    for (var i = 0; i < ls.length; i++) if (ls[i].name === name) return ls[i];
    for (var j = 0; j < ls.length; j++) { var f = walk(ls[j].layers); if (f) return f; }
    return null;
  };
  var l = walk(doc.layers);
  if (!l) throw new Error("Layer " + name + " not found");
  return l;
}
function __topLayer(l) {
  while (l.parent.typename === "Layer") l = l.parent;
  return l;
}
function __layerIndex(l) {
  var ls = l.parent.layers;
  for (var i = 0; i < ls.length; i++) if (ls[i] === l) return i;
  return -1;
}
function __siblings(doc, names, what) {
  var out = [], i, j;
  for (i = 0; i < names.length; i++) {
    var l = __findLayer(doc, names[i]);
    for (j = 0; j < out.length; j++) if (out[j] === l) throw new Error("Layer " + names[i] + " is listed twice");
    if (out.length && l.parent !== out[0].parent) throw new Error(what + ": the layers must be at the same level of the Layers panel; " + names[i] + " is not beside " + out[0].name);
    out.push(l);
  }
  return out;
}
function __panelOrder(ls) {
  var out = ls.slice(0);
  out.sort(function (a, b) { return __layerIndex(a) - __layerIndex(b); });
  return out;
}`;

/** ES3: a layer's direct contents (items and sublayers), top of the stack first, and moving them. */
const CONTENTS = `
function __z(o) { try { return o.absoluteZOrderPosition; } catch (e) { return 0; } }
function __contents(l) {
  var out = [], i;
  for (i = 0; i < l.pageItems.length; i++) out.push(l.pageItems[i]);
  for (i = 0; i < l.layers.length; i++) out.push(l.layers[i]);
  out.sort(function (a, b) { return __z(b) - __z(a); });
  return out;
}
function __moveInto(c, dest, hide) {
  var lk = false;
  try { lk = c.locked; if (lk) c.locked = false; } catch (e) { lk = false; }
  c.move(dest, ElementPlacement.PLACEATEND);
  if (hide) { if (c.typename === "Layer") c.visible = false; else c.hidden = true; }
  if (lk) c.locked = true;
}
function __merge(doc, ls, target, discarded) {
  var keep = { visible: target.visible, locked: target.locked }, seq = [], i, j, moved = 0, removed = [];
  target.visible = true; target.locked = false;
  for (i = 0; i < ls.length; i++) {
    var hidden = !ls[i].visible;
    ls[i].visible = true; ls[i].locked = false;
    var c = __contents(ls[i]);
    for (j = 0; j < c.length; j++) seq.push({ o: c[j], hide: hidden && ls[i] !== target });
  }
  for (i = 0; i < seq.length; i++) { __moveInto(seq[i].o, target, seq[i].hide); moved++; }
  for (i = 0; i < ls.length; i++) {
    if (ls[i] === target) continue;
    removed.push(ls[i].name);
    ls[i].remove();
  }
  target.visible = keep.visible; target.locked = keep.locked;
  return { layer: target.name, moved: moved, removed: removed, discarded: discarded || [] };
}`;

/** ES3: top-level artwork whose bounds meet a rectangle, or whose centre lies in it. */
export const ART_ON = `
function __artOn(doc, r, centre) {
  var out = [];
  var walk = function (l) {
    var i, b;
    for (i = 0; i < l.pageItems.length; i++) {
      b = l.pageItems[i].visibleBounds;
      if (centre) {
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) out.push(l.pageItems[i]);
      } else if (b[0] <= r[2] && b[2] >= r[0] && b[1] >= r[3] && b[3] <= r[1]) out.push(l.pageItems[i]);
    }
    for (i = 0; i < l.layers.length; i++) walk(l.layers[i]);
  };
  for (var k = 0; k < doc.layers.length; k++) walk(doc.layers[k]);
  return out;
}
function __shift(it, dx, dy) {
  try {
    var lk = it.locked;
    if (lk) it.locked = false;
    it.translate(dx, dy);
    if (lk) it.locked = true;
    return true;
  } catch (e) { return false; }
}
function __scaleArt(art, from, to) {
  var sx = (to[2] - to[0]) / (from[2] - from[0]), sy = (to[1] - to[3]) / (from[1] - from[3]), skipped = 0;
  for (var i = 0; i < art.length; i++) {
    try {
      var it = art[i], lk = it.locked, g = it.geometricBounds;
      if (lk) it.locked = false;
      it.resize(sx * 100, sy * 100, true, true, true, true, Math.sqrt(sx * sy) * 100, Transformation.TOPLEFT);
      var n = it.geometricBounds;
      it.translate(to[0] + (g[0] - from[0]) * sx - n[0], to[1] - (from[1] - g[1]) * sy - n[1]);
      if (lk) it.locked = true;
    } catch (e) { skipped++; }
  }
  return skipped;
}`;

/** ES3: an artboard's display settings, to copy them onto another artboard. */
const AB_PROPS = `
function __abProps(ab) {
  return { name: ab.name, rect: ab.artboardRect, origin: ab.rulerOrigin, par: ab.rulerPAR, center: ab.showCenter, cross: ab.showCrossHairs, safe: ab.showSafeAreas };
}
function __setAbProps(ab, p) {
  ab.name = p.name; ab.rulerOrigin = p.origin; ab.rulerPAR = p.par;
  ab.showCenter = p.center; ab.showCrossHairs = p.cross; ab.showSafeAreas = p.safe;
}`;

/** ES3: the selection as item info. */
const SELECTION = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) { try { out.push(__itemInfo(doc, sel[j])); } catch (e) { out.push({ type: sel[j].typename }); } }`;

const LAYER_COMMANDS = ['merge', 'flatten', 'collect', 'release_sequence', 'release_build', 'reverse'];
const OTHER_LAYERS = { hide: ['visible', false], show: ['visible', true], lock: ['locked', true], unlock: ['locked', false], outline: ['preview', false], preview: ['preview', true] };
const ALIGN = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
const PASTE = { front: 'pasteFront', back: 'pasteBack' };

const LAYER_LIST = { type: 'array', items: { type: 'string' }, description: 'Layer names' };
const INDEX_LIST = { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Artboard indexes (0-based). Default all' };

/** Layer names from a caller list, as a JSX literal. */
function layerNames(value, { min = 1, name = 'layers' } = {}) {
    if (!Array.isArray(value) || value.length < min || value.some((v) => typeof v !== 'string' || !v)) {
        throw new Error(`'${name}': give ${min > 1 ? `at least ${min} layer names` : 'one or more layer names'}`);
    }
    return json(value);
}

/** Artboard indexes from a caller list, as a JSX literal (null = all). */
function boardList(value, { min = 1, name = 'artboards' } = {}) {
    if (value === undefined) return 'null';
    if (!Array.isArray(value) || value.length < min) throw new Error(`'${name}': give at least ${min} artboard index${min > 1 ? 'es' : ''}`);
    const out = value.map((v) => Number(index(v, { name, max: 999 })));
    if (new Set(out).size !== out.length) throw new Error(`'${name}': an artboard is listed twice`);
    return json(out);
}

/** The artboard border width: a whole number 1-4, as the published preference script sets it. */
function borderWidth(value) {
    if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error(`'borderWidth': give a whole number from 1 to 4: ${JSON.stringify(value)}`);
    return String(value);
}

/** ES3: resolve a board list (null = all) against the document. */
const BOARDS = `
function __boards(doc, list) {
  var out = [], i;
  if (list === null) { for (i = 0; i < doc.artboards.length; i++) out.push(i); return out; }
  for (i = 0; i < list.length; i++) { __artboard(doc, list[i]); out.push(list[i]); }
  return out;
}`;

export const tools = [
    {
        name: 'organize_layers',
        description: 'Run a Layers panel menu command: merge layers (Merge Selected), flatten every layer into one (Flatten Artwork), collect items or layers in a new layer (Collect in New Layer), give each object of a layer or group its own sublayer (Release to Layers (Sequence) or (Build)), or reverse the stacking order of layers (Reverse Order)',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string', enum: LAYER_COMMANDS,
                    description: 'merge: the layers into the last one listed. flatten: every top-level layer into layer (default the active layer\'s top-level layer). collect: target items, or layers, into a new layer. release_sequence: each object of layer (or of one group in target) onto its own new sublayer. release_build: the same, but each new sublayer also holds copies of every object below it, for animation frames. reverse: the order of the layers',
                },
                layers: { ...LAYER_LIST, description: 'merge, reverse, collect: layer names at the same level of the Layers panel' },
                layer: { type: 'string', description: 'flatten: the layer to flatten into. release_*: the layer whose objects are released' },
                target: { ...TARGET_SCHEMA, description: 'collect: the items to move into a new sublayer of the first item\'s layer. release_*: one group whose objects are released' },
                name: { type: 'string', description: 'collect: name of the new layer' },
                hiddenLayers: { type: 'string', enum: ['include', 'discard'], description: 'flatten: move the artwork of hidden layers in as hidden objects, or delete those layers. Default include' },
            },
            required: ['command'],
        },
        features: [
            'illustrator.layers.merge_selected',
            'illustrator.layers.flatten_artwork',
            'illustrator.layers.collect_in_new_layer',
            'illustrator.layers.release_to_layers_sequence',
            'illustrator.layers.release_to_layers_build',
            'illustrator.layers.reverse_order',
        ],
        hints: { destructive: true },
        auditArgs: { command: 'merge', layers: ['Layer 1', 'Layer 2'], layer: undefined, target: undefined, name: undefined, hiddenLayers: undefined },
        handler: (a) => {
            const cmd = enumOf(a.command, LAYER_COMMANDS, { name: 'command' });
            const allowed = {
                merge: ['layers'], reverse: ['layers'], flatten: ['layer', 'hiddenLayers'],
                collect: ['layers', 'target', 'name'], release_sequence: ['layer', 'target'], release_build: ['layer', 'target'],
            }[cmd];
            const extra = ['layers', 'layer', 'target', 'name', 'hiddenLayers'].filter((k) => a[k] !== undefined && !allowed.includes(k));
            if (extra.length) throw new Error(`${cmd} does not take ${extra.join(', ')}`);
            let body;
            if (cmd === 'merge' || cmd === 'reverse') {
                const ls = layerNames(a.layers, { min: 2 });
                body = cmd === 'merge' ? `
var ls = __siblings(doc, ${ls}, "Merge"), target = ls[ls.length - 1];
__result__ = __merge(doc, __panelOrder(ls), target);` : `
var ls = __panelOrder(__siblings(doc, ${ls}, "Reverse Order"));
for (var i = 1; i < ls.length; i++) ls[i].move(ls[i - 1], ElementPlacement.PLACEBEFORE);
var names = [];
for (var k = ls.length - 1; k >= 0; k--) names.push(ls[k].name);
__result__ = { order: names };`;
            } else if (cmd === 'flatten') {
                const discard = enumOf(a.hiddenLayers ?? 'include', ['include', 'discard'], { name: 'hiddenLayers' }) === 'discard';
                body = `
var target = __topLayer(__findLayer(doc, ${str(a.layer ?? '')}));
if (!target.visible) throw new Error("Layer " + target.name + " is hidden: flatten into a visible layer");
var ls = [], discarded = [], i;
for (i = 0; i < doc.layers.length; i++) ls.push(doc.layers[i]);
${discard ? `for (i = ls.length - 1; i >= 0; i--) if (!ls[i].visible) { discarded.push(ls[i].name); ls[i].locked = false; ls[i].remove(); ls.splice(i, 1); }` : ''}
__result__ = __merge(doc, ls, target, discarded);`;
            } else if (cmd === 'collect') {
                if ((a.target === undefined) === (a.layers === undefined)) throw new Error('collect: give target (items) or layers, not both');
                const named = a.name !== undefined ? `nl.name = ${str(a.name)};` : '';
                body = a.target !== undefined ? `
var items = __targets(doc, ${targetSpec(a.target)}), home = items[0].layer;
if (home.locked) throw new Error("Layer " + home.name + " is locked");
items.sort(function (p, q) { return __z(q) - __z(p); });
var nl = home.layers.add();
${named}
for (var i = 0; i < items.length; i++) __moveInto(items[i], nl, false);
__result__ = { layer: nl.name, parent: home.name, moved: items.length };` : `
var ls = __panelOrder(__siblings(doc, ${layerNames(a.layers)}, "Collect in New Layer"));
var nl = ls[0].parent.layers.add();
${named}
nl.move(ls[0], ElementPlacement.PLACEBEFORE);
for (var i = 0; i < ls.length; i++) ls[i].move(nl, ElementPlacement.PLACEATEND);
__result__ = { layer: nl.name, moved: ls.length };`;
            } else {
                if ((a.target === undefined) === (a.layer === undefined)) throw new Error(`${cmd}: give layer, or target with one group, not both`);
                const build = cmd === 'release_build';
                body = `
var src, home, i, j, made = [];
${a.layer !== undefined ? `src = __findLayer(doc, ${str(a.layer)}); home = src;` : `
var picked = __targets(doc, ${targetSpec(a.target)});
if (picked.length !== 1 || picked[0].typename !== "GroupItem") throw new Error("Release to Layers: target one group");
src = picked[0]; home = src.layer;`}
if (home.locked || !home.visible) throw new Error("Layer " + home.name + " is locked or hidden: unlock and show it first");
var objs = [];
for (i = src.pageItems.length - 1; i >= 0; i--) objs.push(src.pageItems[i]);
if (!objs.length) throw new Error("Nothing to release: " + src.name + " holds no objects");
for (i = 0; i < objs.length; i++) {
  var nl = home.layers.add();
  __moveInto(objs[i], nl, false);
  ${build ? 'for (j = i - 1; j >= 0; j--) objs[j].duplicate(nl, ElementPlacement.PLACEATEND);' : ''}
  made.push(nl.name);
}
if (src.typename === "GroupItem" && src.pageItems.length === 0) src.remove();
__result__ = { layer: home.name, created: made };`;
            }
            return run('Organize layers', script(`${FIND_LAYER}${CONTENTS}${body}`));
        },
    },
    {
        name: 'set_other_layers',
        description: 'Hide, lock or outline every top-level layer except the ones holding the chosen layers or items (Object > Hide > Other Layers, Object > Lock > Other Layers, Layers panel menu > Outline Others), or show, unlock or preview them again',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: Object.keys(OTHER_LAYERS) },
                layers: { ...LAYER_LIST, description: 'Layers to leave alone (a sublayer keeps its top-level layer)' },
                target: { ...TARGET_SCHEMA, description: 'Or: leave alone the layers holding these items' },
            },
            required: ['action'],
        },
        features: ['illustrator.layers.hide_other_layers', 'illustrator.layers.lock_other_layers', 'illustrator.layers.outline_others'],
        hints: { idempotent: true },
        auditArgs: { action: 'hide', layers: ['Layer 1'], target: undefined },
        handler: (a) => {
            const [prop, value] = OTHER_LAYERS[enumOf(a.action, Object.keys(OTHER_LAYERS), { name: 'action' })];
            if ((a.target === undefined) === (a.layers === undefined)) throw new Error('Give layers or target (items), not both');
            return run('Set other layers', script(`${FIND_LAYER}
var keep = [], i, j;
${a.layers !== undefined ? `
var names = ${layerNames(a.layers)};
for (i = 0; i < names.length; i++) keep.push(__topLayer(__findLayer(doc, names[i])));` : `
var items = __targets(doc, ${targetSpec(a.target)});
for (i = 0; i < items.length; i++) keep.push(__topLayer(items[i].layer));`}
var changed = [];
for (i = 0; i < doc.layers.length; i++) {
  var l = doc.layers[i], kept = false;
  for (j = 0; j < keep.length; j++) if (keep[j] === l) kept = true;
  if (kept || l.${prop} === ${bool(value)}) continue;
  l.${prop} = ${bool(value)};
  changed.push(l.name);
}
__result__ = { action: ${str(a.action)}, changed: changed };`));
        },
    },
    {
        name: 'select_layer_artwork',
        description: 'Select all the artwork on layers, as clicking a layer\'s selection column or target circle in the Layers panel does. Appearance tools then act on it. Artwork on hidden or locked layers cannot be selected',
        inputSchema: {
            type: 'object',
            properties: {
                layers: LAYER_LIST,
                add: { type: 'boolean', description: 'Add to the current selection instead of replacing it. Default false', default: false },
            },
            required: ['layers'],
        },
        features: ['illustrator.layers.targeting'],
        hints: { idempotent: true },
        handler: (a) => run('Select layer artwork', script(`${FIND_LAYER}
var names = ${layerNames(a.layers)}, skipped = [];
${a.add ? '' : 'doc.selection = null;'}
for (var i = 0; i < names.length; i++) {
  var l = __findLayer(doc, names[i]);
  if (!l.visible || l.locked) { skipped.push(l.name); continue; }
  l.hasSelectedArtwork = true;
}
${SELECTION}
__result__ = { selected: out.length, items: out, skipped: skipped };`)),
    },
    {
        name: 'paste_artwork',
        description: 'Paste the clipboard directly in front of or behind the selected objects, on their layer (Edit > Paste in Front, Paste in Back). With target, those items are copied first, so the pasted copies sit exactly over or under them',
        inputSchema: {
            type: 'object',
            properties: {
                placement: { type: 'string', enum: Object.keys(PASTE) },
                target: { ...TARGET_SCHEMA, description: 'Copy these items first. Default: paste what is on the clipboard' },
            },
            required: ['placement'],
        },
        features: ['illustrator.layers.paste_front', 'illustrator.layers.paste_back'],
        menuCommands: Object.values(PASTE),
        auditArgs: { placement: 'front', target: { selection: true } },
        handler: (a) => run('Paste artwork', script(`
${a.target !== undefined ? `
var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.copy();` : ''}
app.executeMenuCommand(${str(PASTE[enumOf(a.placement, Object.keys(PASTE), { name: 'placement' })])});
${SELECTION}
__result__ = { pasted: out.length, items: out };`)),
    },

    // Artboards
    {
        name: 'copy_artboard',
        description: 'Duplicate an artboard with the artwork on it (Artboards panel menu > Duplicate Artboards), copy it into another open document, or cut it (move it and its artwork, removing the original). Artwork belongs to an artboard when its centre lies on it',
        inputSchema: {
            type: 'object',
            properties: {
                artboardIndex: ARTBOARD_SCHEMA,
                withArtwork: { type: 'boolean', description: 'Copy the artwork on the artboard too. Default true', default: true },
                toDocument: { type: 'string', description: 'Name of another open document to copy into (list_documents). Default this document' },
                cut: { type: 'boolean', description: 'Remove the original artboard and its artwork afterwards. Default false', default: false },
                name: { type: 'string', description: 'Name of the copy. Default the original\'s name' },
                x: { type: 'number', description: 'Left of the copy, from the destination\'s artboard 0 top-left, in points. Default: right of its rightmost artboard, 20 pt apart' },
                y: { type: 'number', description: 'Top of the copy, measured the same way. Default level with the original (artboard 0 in another document)' },
            },
            required: ['artboardIndex'],
        },
        features: ['illustrator.artboards.duplicate_artboards', 'illustrator.artboards.artboard_cut_copy_paste'],
        hints: { destructive: true },
        auditArgs: { toDocument: undefined, x: undefined, y: undefined },
        handler: (a) => {
            if ((a.x === undefined) !== (a.y === undefined)) throw new Error('Give both x and y, or neither');
            const placed = a.x !== undefined;
            return run('Copy artboard', script(`${ART_ON}${AB_PROPS}
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })}, a = __artboard(doc, i), dest = doc;
${a.toDocument !== undefined ? `
try { dest = app.documents.getByName(${str(a.toDocument)}); } catch (e) { throw new Error("No open document named " + ${str(a.toDocument)}); }
if (__sf(dest) !== __sf(doc)) throw new Error("The documents use different scales (one is a large-canvas document); artwork cannot be copied between them");` : ''}
var same = dest === doc, src = __abProps(doc.artboards[i]), w = a.right - a.left, h = a.top - a.bottom, left, top;
${a.cut ? 'if (!same && doc.artboards.length === 1) throw new Error("Cannot cut the only artboard out of a document");' : ''}
${placed ? `
var p = __toDoc(dest, __artboard(dest, 0), ${num(a.x, { name: 'x' })}, ${num(a.y, { name: 'y' })});
left = p[0]; top = p[1];` : `
left = -Infinity;
for (var r = 0; r < dest.artboards.length; r++) left = Math.max(left, dest.artboards[r].artboardRect[2]);
left += __len(dest, 20);
top = same ? a.top : dest.artboards[0].artboardRect[1];`}
var nab = dest.artboards.add([left, top, left + w, top - h]);
src.name = ${a.name !== undefined ? str(a.name) : 'src.name'};
__setAbProps(nab, src);
var copied = 0, skipped = 0, art = ${bool(a.withArtwork ?? true)} ? __artOn(doc, [a.left, a.top, a.right, a.bottom], true) : [];
var dx = left - a.left, dy = top - a.top;
for (var k = 0; k < art.length; k++) {
  try {
    var c;
    if (same) c = art[k].duplicate(art[k], ElementPlacement.PLACEBEFORE);
    else {
      var into = dest.activeLayer, ln = art[k].layer;
      while (ln.parent.typename === "Layer") ln = ln.parent;
      try { into = dest.layers.getByName(ln.name); } catch (e) { into = dest.activeLayer; }
      c = art[k].duplicate(into, ElementPlacement.PLACEATEND);
    }
    if (__shift(c, dx, dy)) copied++; else skipped++;
  } catch (e) { skipped++; }
}
${a.cut ? `
for (var m = 0; m < art.length; m++) { try { art[m].locked = false; art[m].remove(); } catch (e) {} }
doc.artboards.remove(i);` : ''}
__result__ = { document: dest.name, index: dest.artboards.length - 1, name: nab.name, artworkCopied: copied, artworkSkipped: skipped, cut: ${bool(a.cut)} };`));
        },
    },
    {
        name: 'delete_empty_artboards',
        description: 'Delete every artboard that no artwork touches (Artboards panel menu > Delete Empty Artboards). Hidden and locked artwork and guides count as artwork. One artboard always remains',
        inputSchema: {
            type: 'object',
            properties: { dryRun: { type: 'boolean', description: 'Only report which artboards would be deleted. Default false', default: false } },
        },
        features: ['illustrator.artboards.delete_empty_artboards'],
        hints: { destructive: true, idempotent: true },
        handler: (a) => run('Delete empty artboards', script(`${ART_ON}
var empty = [], i;
for (i = doc.artboards.length - 1; i >= 0; i--) {
  if (!__artOn(doc, doc.artboards[i].artboardRect, false).length) empty.push({ index: i, name: doc.artboards[i].name });
}
if (empty.length === doc.artboards.length) empty.shift();
${a.dryRun ? '' : 'for (i = 0; i < empty.length; i++) doc.artboards.remove(empty[i].index);'}
__result__ = { ${a.dryRun ? 'wouldDelete' : 'deleted'}: empty.reverse(), remaining: doc.artboards.length };`)),
    },
    {
        name: 'align_artboards',
        description: 'Align artboards to one another, or space them evenly, moving the artwork on them along (Artboard tool: align and distribute artboards). Artwork belongs to an artboard when its centre lies on it',
        inputSchema: {
            type: 'object',
            properties: {
                artboards: { ...INDEX_LIST, minItems: 2 },
                align: { type: 'string', enum: ALIGN, description: 'Line up the artboards\' edges or centres with the outermost one' },
                distribute: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Space the artboards evenly in a row (left to right) or a column (top to bottom)' },
                spacing: { type: 'number', minimum: 0, description: 'With distribute: a fixed gap in points. Default: an even gap between the outermost artboards' },
                moveArtwork: { type: 'boolean', description: 'Move the artwork with its artboard. Default true', default: true },
            },
        },
        features: ['illustrator.artboards.artboard_align_distribute'],
        hints: { idempotent: true },
        auditArgs: { artboards: [0, 1], align: 'top', distribute: 'horizontal', spacing: 20 },
        handler: (a) => {
            if (a.align === undefined && a.distribute === undefined) throw new Error('Give align, distribute or both');
            if (a.spacing !== undefined && a.distribute === undefined) throw new Error("'spacing' applies with distribute");
            const align = a.align === undefined ? '' : enumOf(a.align, ALIGN, { name: 'align' });
            const dist = a.distribute === undefined ? '' : enumOf(a.distribute, ['horizontal', 'vertical'], { name: 'distribute' });
            return run('Align artboards', script(`${ART_ON}${BOARDS}
var ids = __boards(doc, ${boardList(a.artboards, { min: 2 })}), rs = [], art = [], i;
if (ids.length < 2) throw new Error("Align needs at least two artboards");
for (i = 0; i < ids.length; i++) {
  rs.push(doc.artboards[ids[i]].artboardRect);
  art.push(${bool(a.moveArtwork ?? true)} ? __artOn(doc, rs[i], true) : []);
}
var to = [];
for (i = 0; i < rs.length; i++) to.push([rs[i][0], rs[i][1], rs[i][2], rs[i][3]]);
var L = Infinity, T = -Infinity, R = -Infinity, B = Infinity;
for (i = 0; i < rs.length; i++) { L = Math.min(L, rs[i][0]); T = Math.max(T, rs[i][1]); R = Math.max(R, rs[i][2]); B = Math.min(B, rs[i][3]); }
var move = function (k, dx, dy) { to[k][0] += dx; to[k][2] += dx; to[k][1] += dy; to[k][3] += dy; };
${align ? `
for (i = 0; i < to.length; i++) {
  var r = to[i];
  ${{
      left: 'move(i, L - r[0], 0);',
      right: 'move(i, R - r[2], 0);',
      center: 'move(i, (L + R) / 2 - (r[0] + r[2]) / 2, 0);',
      top: 'move(i, 0, T - r[1]);',
      bottom: 'move(i, 0, B - r[3]);',
      middle: 'move(i, 0, (T + B) / 2 - (r[1] + r[3]) / 2);',
  }[align]}
}` : ''}
${dist ? `
var ord = [];
for (i = 0; i < to.length; i++) ord.push(i);
${dist === 'horizontal' ? `
ord.sort(function (p, q) { return to[p][0] - to[q][0]; });
var used = 0;
for (i = 0; i < ord.length; i++) used += to[ord[i]][2] - to[ord[i]][0];
var lo = Infinity, hi = -Infinity;
for (i = 0; i < to.length; i++) { lo = Math.min(lo, to[i][0]); hi = Math.max(hi, to[i][2]); }
var gap = ${a.spacing !== undefined ? `__len(doc, ${num(a.spacing, { min: 0, name: 'spacing' })})` : '(hi - lo - used) / (ord.length - 1)'};
for (i = 1; i < ord.length; i++) move(ord[i], to[ord[i - 1]][2] + gap - to[ord[i]][0], 0);` : `
ord.sort(function (p, q) { return to[q][1] - to[p][1]; });
var used = 0;
for (i = 0; i < ord.length; i++) used += to[ord[i]][1] - to[ord[i]][3];
var hi = -Infinity, lo = Infinity;
for (i = 0; i < to.length; i++) { hi = Math.max(hi, to[i][1]); lo = Math.min(lo, to[i][3]); }
var gap = ${a.spacing !== undefined ? `__len(doc, ${num(a.spacing, { min: 0, name: 'spacing' })})` : '(hi - lo - used) / (ord.length - 1)'};
for (i = 1; i < ord.length; i++) move(ord[i], 0, to[ord[i - 1]][3] - gap - to[ord[i]][1]);`}` : ''}
var skipped = 0, out = [];
for (i = 0; i < ids.length; i++) {
  var dx = to[i][0] - rs[i][0], dy = to[i][1] - rs[i][1];
  doc.artboards[ids[i]].artboardRect = to[i];
  for (var k = 0; k < art[i].length; k++) if (!__shift(art[i][k], dx, dy)) skipped++;
  var a0 = __artboard(doc, 0), f = __sf(doc);
  out.push({ index: ids[i], x: (to[i][0] - a0.left) * f, y: (a0.top - to[i][1]) * f });
}
__result__ = { artboards: out, artworkSkipped: skipped };`));
        },
    },
    {
        name: 'reorder_artboards',
        description: 'Change the artboards\' numbering order, which sets their page order when exporting (Artboards panel: move up, move down, or drag). Positions and artwork do not change',
        inputSchema: {
            type: 'object',
            properties: {
                order: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Every artboard index in its new order, e.g. [2, 0, 1]' },
                artboardIndex: { type: 'integer', minimum: 0, description: 'Or: the artboard to move' },
                toIndex: { type: 'integer', minimum: 0, description: 'with artboardIndex: its new index' },
            },
        },
        features: ['illustrator.artboards.artboard_reorder'],
        hints: { idempotent: true },
        auditArgs: { order: [1, 0], artboardIndex: undefined, toIndex: undefined },
        handler: (a) => {
            let order;
            if (a.order !== undefined) {
                if (a.artboardIndex !== undefined || a.toIndex !== undefined) throw new Error('Give order, or artboardIndex with toIndex, not both');
                order = boardList(a.order, { min: 2, name: 'order' });
            } else {
                if (a.artboardIndex === undefined || a.toIndex === undefined) throw new Error('Give order, or artboardIndex with toIndex');
                order = `__moveTo(doc.artboards.length, ${index(a.artboardIndex, { name: 'artboardIndex', max: 999 })}, ${index(a.toIndex, { name: 'toIndex', max: 999 })})`;
            }
            return run('Reorder artboards', script(`${AB_PROPS}
function __moveTo(n, from, to) {
  if (from >= n || to >= n) throw new Error("The document has " + n + " artboards (0-" + (n - 1) + ")");
  var o = [];
  for (var q = 0; q < n; q++) if (q !== from) o.push(q);
  o.splice(to, 0, from);
  return o;
}
var order = ${order}, n = doc.artboards.length, i;
if (order.length !== n) throw new Error("order must list all " + n + " artboards once");
for (i = 0; i < n; i++) if (order[i] >= n) throw new Error("Artboard " + order[i] + " not found; the document has " + n);
var active = doc.artboards.getActiveArtboardIndex(), cur = [];
for (i = 0; i < n; i++) cur.push(i);
for (var k = 0; k < n; k++) {
  var at = -1;
  for (i = 0; i < n; i++) if (cur[i] === order[k]) at = i;
  if (at === k) continue;
  var p = __abProps(doc.artboards[at]);
  doc.artboards.remove(at);
  doc.artboards.insert(p.rect, k);
  __setAbProps(doc.artboards[k], p);
  cur.splice(at, 1);
  cur.splice(k, 0, order[k]);
}
for (i = 0; i < n; i++) if (cur[i] === active) doc.artboards.setActiveArtboardIndex(i);
var names = [];
for (i = 0; i < n; i++) names.push(doc.artboards[i].name);
__result__ = { order: names };`));
        },
    },
    {
        name: 'convert_to_artboards',
        description: 'Turn the chosen objects (usually rectangles) into artboards of the same bounds (Object > Artboards > Convert to Artboards)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.artboards.convert_to_artboards'],
        menuCommands: ['setCropMarks'],
        hints: { destructive: true },
        handler: (a) => run('Convert to artboards', script(`
var items = __targets(doc, ${targetSpec(a.target)}), before = doc.artboards.length;
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand("setCropMarks");
var made = [], a0 = __artboard(doc, 0), f = __sf(doc);
for (var i = before; i < doc.artboards.length; i++) {
  var r = __artboard(doc, i);
  made.push({ index: i, name: r.name, x: (r.left - a0.left) * f, y: (a0.top - r.top) * f, width: (r.right - r.left) * f, height: (r.top - r.bottom) * f });
}
__result__ = { created: made, artboards: doc.artboards.length };`)),
    },
    {
        name: 'set_artboard_display',
        description: 'Artboard display options (Artboard Options: Show Center Mark, Show Cross Hairs, Show Video Safe Areas, Video Ruler Pixel Aspect Ratio, ruler origin), the artboard border and name display (application preferences, for every document), and the View menu\'s Show / Hide Artboards and Show / Hide Video Rulers. With no options, reports the current settings',
        inputSchema: {
            type: 'object',
            properties: {
                artboards: INDEX_LIST,
                showCenter: { type: 'boolean', description: 'Show a mark at the centre' },
                showCrossHairs: { type: 'boolean', description: 'Show lines through the centre of each edge' },
                showSafeAreas: { type: 'boolean', description: 'Show video title-safe and action-safe areas' },
                rulerPixelAspectRatio: { type: 'number', minimum: 0.1, maximum: 10, description: 'Pixel aspect ratio of the video rulers, e.g. 1 for square pixels' },
                rulerOrigin: {
                    type: 'object', description: 'Zero point of the artboard\'s rulers, in points from its top-left corner',
                    properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'],
                },
                borderColor: { type: 'string', description: 'Artboard border colour, "#RRGGBB" or "rgb(r,g,b)" (all documents)' },
                borderWidth: { type: 'integer', minimum: 1, maximum: 4, description: 'Artboard border width, 1-4 (all documents)' },
                showNames: { type: 'boolean', description: 'Show artboard names on the canvas (all documents)' },
                toggleArtboards: { type: 'boolean', description: 'Run View > Show / Hide Artboards, which switches artboard outlines on or off' },
                toggleVideoRulers: { type: 'boolean', description: 'Run View > Rulers > Show / Hide Video Rulers, which switches them on or off' },
            },
        },
        features: [
            'illustrator.artboards.artboard_show_center',
            'illustrator.artboards.artboard_show_crosshairs',
            'illustrator.artboards.artboard_show_safe_areas',
            'illustrator.artboards.artboard_par',
            'illustrator.artboards.artboard_video_display',
            'illustrator.artboards.artboard_display_settings',
            'illustrator.artboards.artboard_ruler_origin',
            'illustrator.artboards.show_hide_artboards',
        ],
        menuCommands: ['artboard', 'videoruler', 'zoomout', 'zoomin'],
        auditArgs: { artboards: [0], borderColor: '#FF0000', borderWidth: 2, rulerOrigin: { x: 0, y: 0 } },
        handler: (a) => {
            let rgb = null;
            if (a.borderColor !== undefined) {
                const spec = JSON.parse(colorSpec(a.borderColor, 'borderColor'));
                if (spec?.kind !== 'rgb') throw new Error("'borderColor': give \"#RRGGBB\" or \"rgb(r,g,b)\"");
                rgb = spec.v.map((v) => v / 255);
            }
            const prefs = rgb || a.borderWidth !== undefined || a.showNames !== undefined;
            const set = [
                a.showCenter !== undefined ? `ab.showCenter = ${bool(a.showCenter)};` : '',
                a.showCrossHairs !== undefined ? `ab.showCrossHairs = ${bool(a.showCrossHairs)};` : '',
                a.showSafeAreas !== undefined ? `ab.showSafeAreas = ${bool(a.showSafeAreas)};` : '',
                a.rulerPixelAspectRatio !== undefined ? `ab.rulerPAR = ${num(a.rulerPixelAspectRatio, { min: 0.1, max: 10, name: 'rulerPixelAspectRatio' })};` : '',
                a.rulerOrigin !== undefined ? `ab.rulerOrigin = [__len(doc, ${num(a.rulerOrigin?.x, { name: 'rulerOrigin.x' })}), __len(doc, ${num(a.rulerOrigin?.y, { name: 'rulerOrigin.y' })})];` : '',
            ].filter(Boolean).join('\n  ');
            return run('Set artboard display', script(`${BOARDS}
var ids = __boards(doc, ${boardList(a.artboards)}), out = [], f = __sf(doc), P = app.preferences;
for (var i = 0; i < ids.length; i++) {
  var ab = doc.artboards[ids[i]];
  ${set}
  var o = ab.rulerOrigin;
  out.push({ index: ids[i], name: ab.name, showCenter: ab.showCenter, showCrossHairs: ab.showCrossHairs, showSafeAreas: ab.showSafeAreas, rulerPixelAspectRatio: ab.rulerPAR, rulerOrigin: { x: o[0] * f, y: o[1] * f } });
}
${rgb ? `P.setRealPreference("ArtboardBBColorRed", ${num(rgb[0], { min: 0, max: 1 })}); P.setRealPreference("ArtboardBBColorGreen", ${num(rgb[1], { min: 0, max: 1 })}); P.setRealPreference("ArtboardBBColorBlue", ${num(rgb[2], { min: 0, max: 1 })});` : ''}
${a.borderWidth !== undefined ? `P.setRealPreference("ArtboardBBWidth", ${borderWidth(a.borderWidth)});` : ''}
${a.showNames !== undefined ? `P.setBooleanPreference("showArtboardLabelOnCanvas", ${bool(a.showNames)});` : ''}
${a.toggleArtboards ? 'app.executeMenuCommand("artboard");' : ''}
${a.toggleVideoRulers ? 'app.executeMenuCommand("videoruler");' : ''}
${prefs ? 'app.executeMenuCommand("zoomout"); app.executeMenuCommand("zoomin");' : ''}
var border = { red: null, green: null, blue: null, width: null, showNames: null };
try { border = { red: P.getRealPreference("ArtboardBBColorRed"), green: P.getRealPreference("ArtboardBBColorGreen"), blue: P.getRealPreference("ArtboardBBColorBlue"), width: P.getRealPreference("ArtboardBBWidth"), showNames: P.getBooleanPreference("showArtboardLabelOnCanvas") }; } catch (e) {}
__result__ = { artboards: out, border: border };`));
        },
    },
    {
        name: 'view_artboard',
        description: 'Show an artboard in the document window: make it active and fit it in the window, fit all artboards, or zoom on its centre (View > Fit Artboard in Window, Fit All in Window)',
        inputSchema: {
            type: 'object',
            properties: {
                artboardIndex: ARTBOARD_SCHEMA,
                fit: { type: 'string', enum: ['artboard', 'all'], description: 'Fit this artboard, or every artboard, in the window. Default artboard unless zoom is given' },
                zoom: { type: 'number', minimum: 0.03125, maximum: 640, description: 'Instead of fitting: zoom factor centred on the artboard (1 = 100%)' },
            },
            required: ['artboardIndex'],
        },
        features: ['illustrator.artboards.artboard_views'],
        menuCommands: ['fitin', 'fitall'],
        hints: { idempotent: true },
        auditArgs: { zoom: undefined },
        handler: (a) => {
            if (a.fit !== undefined && a.zoom !== undefined) throw new Error('Give fit or zoom, not both');
            const fit = a.zoom === undefined ? enumOf(a.fit ?? 'artboard', ['artboard', 'all'], { name: 'fit' }) : null;
            return run('View artboard', script(`
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })}, ab = __artboard(doc, i);
doc.artboards.setActiveArtboardIndex(i);
var v = doc.activeView;
${fit ? `app.executeMenuCommand(${str(fit === 'artboard' ? 'fitin' : 'fitall')});` : `
v.zoom = ${num(a.zoom, { min: 0.03125, max: 640, name: 'zoom' })};
v.centerPoint = [(ab.left + ab.right) / 2, (ab.top + ab.bottom) / 2];`}
__result__ = { active: i, name: ab.name, zoom: v.zoom };`));
        },
    },
];
