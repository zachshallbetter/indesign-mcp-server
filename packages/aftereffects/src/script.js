/**
 * Every tool's ExtendScript runs inside one prelude.
 *
 * Before the tool's body runs, the prelude suppresses After Effects' dialogs
 * (app.beginSuppressDialogs) so a warning cannot leave a call waiting, and opens
 * an undo group so each call is one step in Edit > Undo. Both are closed in a
 * finally block whether the body succeeds or throws.
 *
 * The body assigns its result to __result__; __json() serialises it, because
 * After Effects' ExtendScript may not have a JSON object.
 *
 * Positions and sizes are pixels from the composition's top-left corner, times
 * are seconds, colours are [r, g, b] from 0 to 1 inside scripts.
 */

const HELPERS = String.raw`
function __json(v) {
  var t = typeof v;
  if (v === null || t === "undefined") return "null";
  if (t === "number") return isFinite(v) ? String(Math.round(v * 10000) / 10000) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    var out = "\"";
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i), code = v.charCodeAt(i);
      if (c === "\\") out += "\\\\";
      else if (c === "\"") out += "\\\"";
      else if (code < 32) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
      else out += c;
    }
    return out + "\"";
  }
  if (v instanceof Array) {
    var parts = [];
    for (var j = 0; j < v.length; j++) parts.push(__json(v[j]));
    return "[" + parts.join(",") + "]";
  }
  var keys = [];
  for (var k in v) if (v.hasOwnProperty(k)) keys.push(__json(String(k)) + ":" + __json(v[k]));
  return "{" + keys.join(",") + "}";
}

function __enumName(v) {
  var s = String(v);
  return s.indexOf(".") >= 0 ? s.substring(s.lastIndexOf(".") + 1) : s;
}

function __itemType(it) {
  if (it instanceof CompItem) return "composition";
  if (it instanceof FolderItem) return "folder";
  if (it instanceof FootageItem) return "footage";
  return it.typeName || "item";
}

function __itemInfo(it) {
  var info = { id: it.id, name: it.name, type: __itemType(it) };
  try { info.parentFolder = it.parentFolder === app.project.rootFolder ? null : it.parentFolder.name; } catch (e) {}
  if (it instanceof CompItem) {
    info.width = it.width; info.height = it.height; info.frameRate = it.frameRate; info.duration = it.duration;
    info.pixelAspect = it.pixelAspect; info.layers = it.numLayers;
  } else if (it instanceof FootageItem) {
    info.width = it.width; info.height = it.height; info.duration = it.duration;
    try { info.file = it.file ? it.file.fsName : null; } catch (e) {}
  } else if (it instanceof FolderItem) {
    info.items = it.numItems;
  }
  return info;
}

function __comp(spec) {
  var c = null;
  if (spec.id !== undefined) {
    c = app.project.itemByID(spec.id);
    if (!c) throw new Error("No item with id " + spec.id);
  } else if (spec.name !== undefined) {
    for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === spec.name && app.project.item(i) instanceof CompItem) { c = app.project.item(i); break; }
    if (!c) throw new Error("No composition named " + spec.name);
  } else {
    c = app.project.activeItem;
    if (!c) throw new Error("No active composition: open one in the Composition panel, or pass comp.id or comp.name");
  }
  if (!(c instanceof CompItem)) throw new Error(c.name + " is not a composition");
  return c;
}

function __layerInfo(l) {
  var info = { index: l.index, id: l.id, name: l.name, enabled: l.enabled, solo: l.solo, shy: l.shy, locked: l.locked,
    inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime, label: l.label };
  info.parent = l.parent ? l.parent.index : null;
  if (l instanceof TextLayer) info.type = "text";
  else if (l instanceof ShapeLayer) info.type = "shape";
  else if (l instanceof CameraLayer) info.type = "camera";
  else if (l instanceof LightLayer) info.type = "light";
  else if (l.nullLayer) info.type = "null";
  else if (l instanceof AVLayer) info.type = l.adjustmentLayer ? "adjustment" : (l.source instanceof CompItem ? "precomp" : (l.source && l.source.mainSource instanceof SolidSource ? "solid" : "footage"));
  if (l instanceof AVLayer) {
    info.threeD = l.threeDLayer; info.blendingMode = __enumName(l.blendingMode);
    try { info.source = l.source ? l.source.id : null; } catch (e) {}
    try { info.trackMatte = l.hasTrackMatte ? __enumName(l.trackMatteType) : null; } catch (e) {}
  }
  return info;
}

function __layers(comp, spec) {
  var out = [], i;
  if (spec.selected) for (i = 0; i < comp.selectedLayers.length; i++) out.push(comp.selectedLayers[i]);
  if (spec.indexes) for (i = 0; i < spec.indexes.length; i++) {
    if (spec.indexes[i] < 1 || spec.indexes[i] > comp.numLayers) throw new Error("Layer " + spec.indexes[i] + " does not exist; the composition has " + comp.numLayers);
    out.push(comp.layer(spec.indexes[i]));
  }
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var hit = comp.layers.byName(spec.names[i]);
    if (!hit) throw new Error("No layer named " + spec.names[i]);
    out.push(hit);
  }
  if (!out.length) throw new Error("No layers to act on: pass indexes, names, or selected: true");
  return out;
}

function __prop(layer, path) {
  var p = layer;
  for (var i = 0; i < path.length; i++) {
    var next = p.property(path[i]);
    if (!next) throw new Error("No property " + path.slice(0, i + 1).join(" > ") + " on layer " + layer.name);
    p = next;
  }
  return p;
}
`;

/**
 * Wrap a tool body. The body sees `proj` (the open project) and must assign
 * __result__.
 * @param {string} body ES3 statements
 * @param {{ undo?: string }} [opts] undo group name; omit for read-only tools
 */
export function script(body, { undo } = {}) {
    return [
        'app.beginSuppressDialogs();',
        undo ? `app.beginUndoGroup(${JSON.stringify(undo)});` : '',
        'try {',
        HELPERS,
        'var proj = app.project;',
        body,
        '  __result__ = __json(__result__);',
        '} finally {',
        undo ? '  app.endUndoGroup();' : '',
        '  app.endSuppressDialogs(false);',
        '}',
    ].join('\n');
}
