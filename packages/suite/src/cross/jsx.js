/**
 * Shared ExtendScript fragments for cross-application tools.
 */

/** ES3 JSON serialiser: neither InDesign's nor Illustrator's ExtendScript has JSON. */
export const JSON_FN = String.raw`
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
}`;

/**
 * Run a script through an app's structured runner and return its value,
 * parsed from JSON when it is JSON. Throws with the app's error message.
 */
export async function runIn(app, source) {
    const r = await app.runStructured(source);
    if (!r.ok) throw new Error(`${app.label}: ${r.error}`);
    if (typeof r.result !== 'string') return r.result;
    try {
        return JSON.parse(r.result);
    } catch {
        return r.result;
    }
}
