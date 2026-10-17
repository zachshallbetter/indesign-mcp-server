/**
 * The current tool's settings as Photoshop keeps them: the application's
 * currentToolOptions descriptor (the options bar and the Brush Settings
 * panel) and the brush tip inside it.
 *
 * Edits are data built in Node and embedded with json(). Each is an array
 * [where, path, keys, value, label, vary]:
 *   where  "opt" for a tool option, "tip" for a key of the brush tip, "size"
 *          for the tip diameter
 *   path   keys of the objects to walk into, e.g. ["@szVr"] or ["dualBrush", "brush"]
 *   keys   candidate keys for the value, the first the descriptor has is used
 *   value  a boolean, a number, or an enumeration value's stringID
 *   label  the caller's name for the setting, used in errors and the result
 *   vary   create the last object in path as a brush variation ($brVr) when
 *          the tool has none yet
 * Ids are stringIDs; one starting with "@" is a charID ("@szVr").
 *
 * The ES3 helpers read the descriptor, change only the named keys, keeping
 * the value type and unit Photoshop already uses for each, and write it back:
 * tool options with the set event on the tool's class, the tip with the set
 * event on the current brush, and the diameter as masterDiameter on the brush.
 * A setting the current tool does not have is an error naming it.
 */
import { json } from 'adobe-mcp-core';

export const TOOL_OPTIONS_HELPERS = String.raw`
var __tid = function (s) { return s.charAt(0) === "@" ? app.charIDToTypeID(s.substring(1)) : app.stringIDToTypeID(s); };
var __ctoGet = function () {
  var r = new ActionReference();
  r.putProperty(__tid("property"), __tid("currentToolOptions"));
  r.putEnumerated(__tid("application"), __tid("ordinal"), __tid("targetEnum"));
  return app.executeActionGet(r).getObjectValue(__tid("currentToolOptions"));
};
var __setBrush = function (b) {
  var r = new ActionReference(), d = new ActionDescriptor();
  r.putEnumerated(__tid("brush"), __tid("ordinal"), __tid("targetEnum"));
  d.putReference(__tid("null"), r);
  d.putObject(__tid("to"), __tid("brush"), b);
  app.executeAction(__tid("set"), d, DialogModes.NO);
};
var __variation = function () {
  var v = new ActionDescriptor();
  v.putInteger(__tid("@bVTy"), 0);
  v.putInteger(__tid("@fStp"), 25);
  v.putUnitDouble(__tid("jitter"), __tid("percentUnit"), 0);
  v.putUnitDouble(__tid("minimum"), __tid("percentUnit"), 0);
  return v;
};
var __missing = function (e) { return new Error(app.currentTool + " has no " + e[4] + " setting"); };
var __leafKey = function (d, e) {
  for (var j = 0; j < e[2].length; j++) if (d.hasKey(__tid(e[2][j]))) return __tid(e[2][j]);
  return null;
};
var __optEdit = function (d, e, i) {
  if (i < e[1].length) {
    var k = __tid(e[1][i]), cls, o;
    if (d.hasKey(k)) {
      if (d.getType(k) !== DescValueType.OBJECTTYPE) throw new Error(e[4] + ": " + app.currentTool + " keeps this setting in another form");
      cls = d.getObjectType(k);
      o = d.getObjectValue(k);
    } else if (e[5] && i === e[1].length - 1) {
      cls = __tid("@brVr");
      o = __variation();
    } else {
      throw __missing(e);
    }
    __optEdit(o, e, i + 1);
    d.putObject(k, cls, o);
    return;
  }
  var key = __leafKey(d, e), v = e[3];
  if (key === null) throw __missing(e);
  var t = d.getType(key);
  if (t === DescValueType.BOOLEANTYPE && typeof v === "boolean") d.putBoolean(key, v);
  else if (t === DescValueType.INTEGERTYPE && typeof v === "number") d.putInteger(key, Math.round(v));
  else if (t === DescValueType.DOUBLETYPE && typeof v === "number") d.putDouble(key, v);
  else if (t === DescValueType.UNITDOUBLE && typeof v === "number") d.putUnitDouble(key, d.getUnitDoubleType(key), v);
  else if (t === DescValueType.ENUMERATEDTYPE && typeof v === "string") d.putEnumerated(key, d.getEnumerationType(key), __tid(v));
  else throw new Error(e[4] + ": " + app.currentTool + " keeps this setting as another kind of value");
};
var __optRead = function (d, e) {
  for (var i = 0; i < e[1].length; i++) {
    var k = __tid(e[1][i]);
    if (!d.hasKey(k) || d.getType(k) !== DescValueType.OBJECTTYPE) return null;
    d = d.getObjectValue(k);
  }
  var key = __leafKey(d, e);
  if (key === null) return null;
  var t = d.getType(key);
  if (t === DescValueType.BOOLEANTYPE) return d.getBoolean(key);
  if (t === DescValueType.INTEGERTYPE) return d.getInteger(key);
  if (t === DescValueType.DOUBLETYPE) return d.getDouble(key);
  if (t === DescValueType.UNITDOUBLE) return d.getUnitDoubleValue(key);
  if (t === DescValueType.ENUMERATEDTYPE) return app.typeIDToStringID(d.getEnumerationValue(key));
  return null;
};
var __applyToolEdits = function (edits) {
  var tip = [], opts = [], size = null, cto, i;
  for (i = 0; i < edits.length; i++) {
    if (edits[i][0] === "size") size = edits[i][3];
    else if (edits[i][0] === "tip") tip.push(edits[i]);
    else opts.push(edits[i]);
  }
  if (tip.length || size !== null) {
    if (!__ctoGet().hasKey(__tid("brush"))) throw new Error(app.currentTool + " has no brush tip");
  }
  if (tip.length) {
    var brush = __ctoGet().getObjectValue(__tid("brush"));
    for (i = 0; i < tip.length; i++) __optEdit(brush, tip[i], 0);
    __setBrush(brush);
  }
  if (size !== null) {
    var b = new ActionDescriptor();
    b.putUnitDouble(__tid("masterDiameter"), __tid("pixelsUnit"), size);
    __setBrush(b);
  }
  if (opts.length) {
    cto = __ctoGet();
    for (i = 0; i < opts.length; i++) __optEdit(cto, opts[i], 0);
    var r = new ActionReference(), d = new ActionDescriptor();
    r.putClass(__tid(app.currentTool));
    d.putReference(__tid("null"), r);
    d.putObject(__tid("to"), __tid("null"), cto);
    app.executeAction(__tid("set"), d, DialogModes.NO);
  }
  var now = __ctoGet(), out = {};
  for (i = 0; i < edits.length; i++) {
    var e = edits[i];
    if (e[0] === "opt") out[e[4]] = __optRead(now, e);
    else out[e[4]] = now.hasKey(__tid("brush")) ? __optRead(now.getObjectValue(__tid("brush")), e) : null;
  }
  return out;
};
`;

/** A script expression applying the edits and returning { label: value now }. */
export function applyEdits(edits) {
    return `__applyToolEdits(${json(edits)})`;
}

/** Edit constructors. */
export const opt = (path, keys, value, label, vary = false) => ['opt', path, keys, value, label, vary];
export const tip = (keys, value, label) => ['tip', [], keys, value, label, false];
export const size = (value, label) => ['size', [], ['diameter'], value, label, false];

/** Brush variation controls ($bVTy), in the order the Brush Settings panel numbers them. */
export const CONTROLS = ['off', 'fade', 'pen_pressure', 'pen_tilt', 'stylus_wheel', 'initial_direction', 'direction', 'initial_rotation', 'rotation'];
