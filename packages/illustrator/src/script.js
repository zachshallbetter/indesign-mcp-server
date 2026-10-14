/**
 * Every tool's ExtendScript runs inside one prelude.
 *
 * Before the tool's body runs, the prelude:
 *   - suppresses alerts (app.userInteractionLevel = DONTDISPLAYALERTS), so a
 *     warning dialog cannot stop the script and leave the server waiting;
 *   - switches to document coordinates (app.coordinateSystem), so positions do
 *     not depend on which artboard happens to be active.
 * Both are global, persistent application settings, so the prelude restores
 * the user's values in a finally block whether the body succeeds or throws.
 *
 * The body assigns its result to __result__; __json() serialises it, because
 * Illustrator's ExtendScript has no JSON object.
 *
 * Coordinates exposed to callers are points, measured from the top-left corner
 * of an artboard with y increasing downward. Illustrator's document coordinates
 * run y-up, and large-canvas documents scale every value by scaleFactor; the
 * helpers below convert both ways.
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

function __sf(doc) {
  var f = 1;
  try { f = doc.scaleFactor || 1; } catch (e) { f = 1; }
  return f;
}

function __artboard(doc, i) {
  if (i < 0 || i >= doc.artboards.length) throw new Error("Artboard " + i + " not found; the document has " + doc.artboards.length);
  var r = doc.artboards[i].artboardRect;
  return { index: i, name: doc.artboards[i].name, left: r[0], top: r[1], right: r[2], bottom: r[3] };
}

function __toDoc(doc, ab, x, y) {
  var f = __sf(doc);
  return [ab.left + x / f, ab.top - y / f];
}

function __len(doc, v) {
  return v / __sf(doc);
}

function __artboardOf(doc, b) {
  var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  for (var i = 0; i < doc.artboards.length; i++) {
    var r = doc.artboards[i].artboardRect;
    if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) return i;
  }
  return -1;
}

function __bounds(doc, it, abIndex) {
  var g = it.geometricBounds, f = __sf(doc);
  var i = abIndex === undefined ? __artboardOf(doc, g) : abIndex;
  var ab = i >= 0 ? __artboard(doc, i) : { left: 0, top: 0 };
  return { artboardIndex: i, x: (g[0] - ab.left) * f, y: (ab.top - g[1]) * f, width: (g[2] - g[0]) * f, height: (g[1] - g[3]) * f };
}

function __itemInfo(doc, it) {
  var info = { id: null, name: it.name, type: it.typename, layer: null, locked: it.locked, hidden: it.hidden };
  try { info.id = it.uuid; } catch (e) {}
  try { info.layer = it.layer.name; } catch (e) {}
  var b = __bounds(doc, it);
  info.artboardIndex = b.artboardIndex; info.x = b.x; info.y = b.y; info.width = b.width; info.height = b.height;
  return info;
}

function __targets(doc, spec) {
  var out = [], i;
  if (spec.selection) {
    var sel = doc.selection;
    if (sel && sel.length) for (i = 0; i < sel.length; i++) out.push(sel[i]);
  }
  if (spec.ids) for (i = 0; i < spec.ids.length; i++) {
    var byId = null;
    try { byId = doc.getPageItemFromUuid(spec.ids[i]); } catch (e) { byId = null; }
    if (!byId) throw new Error("Item " + spec.ids[i] + " not found");
    out.push(byId);
  }
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var found = false;
    for (var j = 0; j < doc.pageItems.length; j++) {
      if (doc.pageItems[j].name === spec.names[i]) { out.push(doc.pageItems[j]); found = true; }
    }
    if (!found) throw new Error("No item named " + spec.names[i] + " found");
  }
  if (!out.length) throw new Error("No items to act on: pass ids, names, or selection: true with a selection");
  return out;
}

function __layer(doc, name) {
  if (!name) return doc.activeLayer;
  for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].name === name) return doc.layers[i];
  throw new Error("Layer " + name + " not found");
}

function __color(doc, spec) {
  var c;
  if (!spec || spec.kind === "none") return new NoColor();
  if (spec.kind === "rgb") { c = new RGBColor(); c.red = spec.v[0]; c.green = spec.v[1]; c.blue = spec.v[2]; return c; }
  if (spec.kind === "cmyk") { c = new CMYKColor(); c.cyan = spec.v[0]; c.magenta = spec.v[1]; c.yellow = spec.v[2]; c.black = spec.v[3]; return c; }
  if (spec.kind === "gray") { c = new GrayColor(); c.gray = spec.v[0]; return c; }
  if (spec.kind === "swatch") {
    var sw = null;
    try { sw = doc.swatches.getByName(spec.name); } catch (e) { sw = null; }
    if (!sw) throw new Error("Swatch " + spec.name + " not found");
    return sw.color;
  }
  throw new Error("Unknown colour " + spec.kind);
}

function __colorInfo(c) {
  if (!c) return null;
  switch (c.typename) {
    case "RGBColor": return { kind: "rgb", value: [c.red, c.green, c.blue] };
    case "CMYKColor": return { kind: "cmyk", value: [c.cyan, c.magenta, c.yellow, c.black] };
    case "GrayColor": return { kind: "gray", value: [c.gray] };
    case "SpotColor": return { kind: "spot", name: c.spot.name, tint: c.tint };
    case "GradientColor": return { kind: "gradient", name: c.gradient.name };
    case "PatternColor": return { kind: "pattern", name: c.pattern.name };
    case "NoColor": return { kind: "none" };
  }
  return { kind: c.typename };
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
        'var __prevUI = app.userInteractionLevel;',
        'var __prevCS = app.coordinateSystem;',
        'app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;',
        'app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;',
        'try {',
        HELPERS,
        needsDocument ? 'var doc = __doc();' : '',
        body,
        '  __result__ = __json(__result__);',
        '} finally {',
        '  app.coordinateSystem = __prevCS;',
        '  app.userInteractionLevel = __prevUI;',
        '}',
    ].join('\n');
}
