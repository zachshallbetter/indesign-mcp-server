/**
 * Action Manager helpers for tool bodies that need Photoshop events with no
 * object-model method. Prepend AM_HELPERS to a body passed to script().
 *
 *   __s(id), __c(id)       stringIDToTypeID / charIDToTypeID
 *   __do(event, desc)      executeAction with dialogs off
 *   __selectLayers(items)  make these layers (from __targets) the selected ones
 *   __targetRef()          a reference to the selected layers
 *   __hasSelection(doc)    whether the document has an active selection
 *   __qcs(anchor)          a quadCenterState enum value for an anchor name
 */

export const AM_HELPERS = String.raw`
function __s(id) { return app.stringIDToTypeID(id); }
function __c(id) { return app.charIDToTypeID(id); }
function __do(event, d) { return app.executeAction(event, d, DialogModes.NO); }
function __selectLayers(items) {
  var r = new ActionReference();
  for (var i = 0; i < items.length; i++) r.putIdentifier(__s("layer"), items[i].id);
  var d = new ActionDescriptor();
  d.putReference(__s("null"), r);
  d.putBoolean(__s("makeVisible"), false);
  __do(__s("select"), d);
}
function __targetRef() {
  var r = new ActionReference();
  r.putEnumerated(__s("layer"), __s("ordinal"), __s("targetEnum"));
  return r;
}
function __hasSelection(doc) {
  try { var b = doc.selection.bounds; return b !== null; } catch (e) { return false; }
}
function __qcs(anchor) {
  var m = { top_left: "QCSCorner0", top: "QCSSide0", top_right: "QCSCorner1", right: "QCSSide1", bottom_right: "QCSCorner2",
    bottom: "QCSSide2", bottom_left: "QCSCorner3", left: "QCSSide3", center: "QCSAverage" };
  return __s(m[anchor]);
}
`;

/** Anchor names accepted by __qcs(), for schemas. */
export const QCS_ANCHORS = ['top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right'];
