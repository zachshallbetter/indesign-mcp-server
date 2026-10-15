/**
 * The prelude for tools written as modules (src/tools/<area>.js).
 *
 * Before the tool's body runs, the prelude:
 *   - stops InDesign from showing dialogs or alerts
 *     (scriptPreferences.userInteractionLevel = NEVER_INTERACT);
 *   - measures in millimetres for the run (scriptPreferences.measurementUnit),
 *     which does not touch the document's own ruler units.
 * Both are restored in a finally block whether the body succeeds or throws.
 *
 * The body assigns its result to __result__; __json() serialises it, because
 * InDesign's ExtendScript has no JSON object. Results come back as structured
 * JSON (ScriptExecutor.executeInDesignScriptStructured).
 *
 * Positions and sizes exposed to callers are millimetres from the top-left
 * corner of an item's page, with y increasing downward, as in the rest of the
 * server. Geometric bounds are [top, left, bottom, right].
 */

const HELPERS = String.raw`
function __json(v) {
  var t = typeof v;
  if (v === null || t === "undefined") return "null";
  if (t === "number") return isFinite(v) ? String(Math.round(v * 1000) / 1000) : "null";
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

function __doc() {
  if (app.documents.length === 0) throw new Error("No document open");
  return app.activeDocument;
}

function __enumName(v) {
  var s = String(v);
  return s.indexOf(".") >= 0 ? s.substring(s.lastIndexOf(".") + 1) : s;
}

function __page(doc, i) {
  if (i < 0 || i >= doc.pages.length) throw new Error("Page index " + i + " is out of range; the document has " + doc.pages.length + " pages");
  return doc.pages[i];
}

function __pageOf(item) {
  try { if (item.parentPage && item.parentPage.isValid) return item.parentPage; } catch (e) {}
  return null;
}

function __toPage(page, x, y) {
  var pb = page.bounds;
  return [pb[1] + x, pb[0] + y];
}

function __itemInfo(item) {
  var info = { id: item.id, type: item.constructor.name, name: item.name || null };
  try { info.label = item.label || null; } catch (e) {}
  var page = __pageOf(item);
  info.page = page ? page.name : null;
  info.pageIndex = page ? page.documentOffset : null;
  try {
    var g = item.geometricBounds, o = page ? page.bounds : [0, 0, 0, 0];
    info.x = g[1] - o[1]; info.y = g[0] - o[0]; info.width = g[3] - g[1]; info.height = g[2] - g[0];
  } catch (e) {}
  try { info.layer = item.itemLayer.name; } catch (e) {}
  try { info.locked = item.locked; info.visible = item.visible; } catch (e) {}
  return info;
}

function __item(doc, id) {
  var it = doc.pageItems.itemByID(id);
  if (!it.isValid) throw new Error("Item " + id + " not found");
  return it.getElements()[0];
}

function __targets(doc, spec) {
  var out = [], i;
  if (spec.selection) {
    var sel = app.selection;
    for (i = 0; i < sel.length; i++) out.push(sel[i]);
  }
  if (spec.ids) for (i = 0; i < spec.ids.length; i++) out.push(__item(doc, spec.ids[i]));
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var hit = doc.pageItems.itemByName(spec.names[i]);
    if (!hit.isValid) throw new Error("No item named " + spec.names[i]);
    var all = hit.getElements();
    for (var j = 0; j < all.length; j++) out.push(all[j]);
  }
  if (!out.length) throw new Error("No items to act on: pass ids, names, or selection: true with a selection");
  return out;
}

function __swatch(doc, spec) {
  if (spec.kind === "name") {
    var s = doc.swatches.itemByName(spec.name);
    if (!s.isValid) throw new Error("No swatch named " + spec.name);
    return s;
  }
  var name = "R=" + spec.v[0] + " G=" + spec.v[1] + " B=" + spec.v[2];
  var c = doc.colors.itemByName(name);
  if (c.isValid) return c;
  return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: spec.v });
}
`;

/**
 * Wrap a tool body. The body sees `doc` (the active document, unless
 * needsDocument is false) and must assign __result__.
 * @param {string} body ES3 statements
 * @param {{ needsDocument?: boolean }} [opts]
 */
export function script(body, { needsDocument = true } = {}) {
    return [
        'var __uil = app.scriptPreferences.userInteractionLevel;',
        'var __units = app.scriptPreferences.measurementUnit;',
        'app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;',
        'app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;',
        'try {',
        HELPERS,
        needsDocument ? 'var doc = __doc();' : '',
        body,
        '  __result__ = __json(__result__);',
        '} finally {',
        '  app.scriptPreferences.measurementUnit = __units;',
        '  app.scriptPreferences.userInteractionLevel = __uil;',
        '}',
    ].join('\n');
}
