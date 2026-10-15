/**
 * Every tool's ExtendScript runs inside one prelude.
 *
 * Before the tool's body runs, the prelude:
 *   - turns dialogs off (app.displayDialogs = DialogModes.NO), so a command
 *     that would ask for input uses its settings instead of waiting for a click;
 *   - measures in pixels (preferences.rulerUnits and typeUnits), so sizes and
 *     positions do not depend on the user's unit settings.
 * All three are global, persistent application settings, so the prelude
 * restores the user's values in a finally block whether the body succeeds or
 * throws.
 *
 * The body assigns its result to __result__; __json() serialises it, because
 * Photoshop's ExtendScript has no JSON object.
 *
 * Positions and sizes exposed to callers are pixels, measured from the
 * document's top-left corner with y increasing downward, which is Photoshop's
 * own convention.
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
  if (v instanceof UnitValue) return String(Math.round(v.as("px") * 1000) / 1000);
  var keys = [];
  for (var k in v) if (v.hasOwnProperty(k)) keys.push(__json(String(k)) + ":" + __json(v[k]));
  return "{" + keys.join(",") + "}";
}

function __doc() {
  if (app.documents.length === 0) throw new Error("No document open");
  return app.activeDocument;
}

function __px(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof UnitValue) return v.as("px");
  return Number(v);
}

function __enumName(v) {
  var s = String(v);
  return s.indexOf(".") >= 0 ? s.substring(s.lastIndexOf(".") + 1) : s;
}

function __bounds(layer) {
  var b = layer.bounds;
  var l = __px(b[0]), t = __px(b[1]), r = __px(b[2]), btm = __px(b[3]);
  return { x: l, y: t, width: r - l, height: btm - t };
}

function __layerInfo(layer) {
  var info = { id: layer.id, name: layer.name, type: layer.typename === "LayerSet" ? "group" : "layer", visible: layer.visible, opacity: layer.opacity };
  try { info.blendMode = __enumName(layer.blendMode); } catch (e) {}
  try { info.locked = layer.allLocked; } catch (e) {}
  if (layer.typename === "ArtLayer") {
    info.kind = __enumName(layer.kind);
    info.background = layer.isBackgroundLayer;
    try { info.fillOpacity = layer.fillOpacity; } catch (e) {}
  } else {
    info.layers = layer.layers.length;
  }
  try { info.bounds = __bounds(layer); } catch (e) { info.bounds = null; }
  try { info.parent = layer.parent.typename === "Document" ? null : layer.parent.name; } catch (e) {}
  return info;
}

function __eachLayer(container, fn, depth) {
  var d = depth || 0;
  for (var i = 0; i < container.layers.length; i++) {
    var l = container.layers[i];
    fn(l, d);
    if (l.typename === "LayerSet") __eachLayer(l, fn, d + 1);
  }
}

function __layerById(doc, id) {
  var hit = null;
  __eachLayer(doc, function (l) { if (!hit && l.id === id) hit = l; });
  if (!hit) throw new Error("Layer " + id + " not found");
  return hit;
}

function __targets(doc, spec) {
  var out = [], i;
  if (spec.active) out.push(doc.activeLayer);
  if (spec.ids) for (i = 0; i < spec.ids.length; i++) out.push(__layerById(doc, spec.ids[i]));
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var found = false, name = spec.names[i];
    __eachLayer(doc, function (l) { if (l.name === name) { out.push(l); found = true; } });
    if (!found) throw new Error("No layer named " + name);
  }
  if (!out.length) throw new Error("No layers to act on: pass ids, names, or active: true");
  return out;
}

function __color(spec) {
  var c = new SolidColor();
  if (spec.kind === "rgb") { c.rgb.red = spec.v[0]; c.rgb.green = spec.v[1]; c.rgb.blue = spec.v[2]; return c; }
  if (spec.kind === "cmyk") { c.cmyk.cyan = spec.v[0]; c.cmyk.magenta = spec.v[1]; c.cmyk.yellow = spec.v[2]; c.cmyk.black = spec.v[3]; return c; }
  if (spec.kind === "gray") { c.gray.gray = spec.v[0]; return c; }
  if (spec.kind === "hsb") { c.hsb.hue = spec.v[0]; c.hsb.saturation = spec.v[1]; c.hsb.brightness = spec.v[2]; return c; }
  if (spec.kind === "lab") { c.lab.L = spec.v[0]; c.lab.A = spec.v[1]; c.lab.B = spec.v[2]; return c; }
  throw new Error("Unknown colour " + spec.kind);
}

function __colorInfo(c) {
  try { return { hex: "#" + c.rgb.hexValue, rgb: [c.rgb.red, c.rgb.green, c.rgb.blue] }; } catch (e) { return null; }
}

function __docInfo(doc) {
  var info = { id: doc.id, name: doc.name, width: __px(doc.width), height: __px(doc.height), resolution: doc.resolution,
    mode: __enumName(doc.mode), bitsPerChannel: __enumName(doc.bitsPerChannel), layers: 0, saved: doc.saved };
  __eachLayer(doc, function () { info.layers++; });
  try { info.file = doc.fullName.fsName; } catch (e) { info.file = null; }
  try { info.colorProfile = doc.colorProfileName; } catch (e) { info.colorProfile = null; }
  try { info.activeLayer = doc.activeLayer.name; } catch (e) {}
  return info;
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
        'var __prevDialogs = app.displayDialogs;',
        'var __prevRuler = app.preferences.rulerUnits;',
        'var __prevType = app.preferences.typeUnits;',
        'app.displayDialogs = DialogModes.NO;',
        'app.preferences.rulerUnits = Units.PIXELS;',
        'app.preferences.typeUnits = TypeUnits.PIXELS;',
        'try {',
        HELPERS,
        needsDocument ? 'var doc = __doc();' : '',
        body,
        '  __result__ = __json(__result__);',
        '} finally {',
        '  app.preferences.typeUnits = __prevType;',
        '  app.preferences.rulerUnits = __prevRuler;',
        '  app.displayDialogs = __prevDialogs;',
        '}',
    ].join('\n');
}
