/**
 * Helpers shared by the document, page, layer, selection and history tools:
 * running a menu command by id, and finding a layer, spread or layout window.
 */
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';
import { script } from './script.js';

/**
 * Script helpers:
 *   __invoke(id, label) runs a menu action (an id from the command list, never
 *   one that opens a dialog), failing clearly when it is missing or disabled;
 *   __menuOn(id) reads whether a toggle menu item is checked;
 *   __layer(doc, name) finds a layer by name;
 *   __spread(doc, i) checks a spread index;
 *   __window(doc) is the document's first layout window;
 *   __anyItem(doc, id) finds a top-level item on a document or parent spread;
 *   __hasProp(o, k) tells whether this InDesign has the property (newer ones);
 *   __spreadInfo(sp) describes a spread.
 */
export const COMMAND_HELPERS = String.raw`
var __invoke = function (id, label) {
  var m = app.menuActions.itemByID(id);
  if (!m.isValid) throw new Error(label + " is not available in this version of InDesign");
  if (!m.enabled) throw new Error(label + " is not available now (check the selection and the active window)");
  m.invoke();
  return label;
};
var __menuOn = function (id) {
  var m = app.menuActions.itemByID(id);
  if (!m.isValid) return null;
  try { return m.checked; } catch (e) { return null; }
};
var __layer = function (doc, name) {
  var l = doc.layers.itemByName(name);
  if (!l.isValid) throw new Error("No layer named " + name);
  return l;
};
var __spread = function (doc, i) {
  if (i < 0 || i >= doc.spreads.length) throw new Error("Spread index " + i + " is out of range; the document has " + doc.spreads.length + " spreads");
  return doc.spreads[i];
};
var __window = function (doc) {
  if (doc.layoutWindows.length === 0) throw new Error("The document has no layout window");
  return doc.layoutWindows[0];
};
var __anyItem = function (doc, id) {
  var it = doc.pageItems.itemByID(id);
  if (it.isValid) return it.getElements()[0];
  for (var i = 0; i < doc.masterSpreads.length; i++) {
    var m = doc.masterSpreads[i].pageItems.itemByID(id);
    if (m.isValid) return m.getElements()[0];
  }
  throw new Error("Item " + id + " not found on document or parent spreads");
};
var __hasProp = function (o, k) {
  try { return o[k] !== undefined; } catch (e) { return false; }
};
var __spreadInfo = function (sp) {
  var pages = [];
  for (var i = 0; i < sp.pages.length; i++) pages.push(sp.pages[i].name);
  var info = { index: sp.index, pages: pages, allowPageShuffle: sp.allowPageShuffle };
  if (__hasProp(sp, "spreadHidden")) info.hidden = sp["spreadHidden"];
  return info;
};
`;

/** script() with the command helpers ahead of the body. */
export const commandScript = (body, opts) => script(COMMAND_HELPERS + body, opts);

/** A caller's file path as a JSX string literal, through the server's path policy. */
export function pathLit(value, name = 'filePath') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required: a file path`);
    return jsxPath(validateFilePath(value));
}

/** Whether an argument was given. */
export const has = (v) => v !== undefined && v !== null;

/** A non-empty name of at most `max` characters. */
export function nameArg(value, name, max = 200) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required`);
    if (value.length > max) throw new Error(`'${name}' is longer than ${max} characters`);
    return value;
}
