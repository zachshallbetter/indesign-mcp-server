/**
 * Action Manager helpers for tool scripts, as ExtendScript source to put at
 * the top of a tool body. Layer masks, smart objects, layer styles and many
 * Layers-panel commands have no object-model members, so their scripts build
 * ActionDescriptors and play Photoshop's own events with DialogModes.NO.
 *
 * Every helper is a `var name = function` so it can sit inside the prelude's
 * try block. Layers are addressed by id (Layer.id is the Action Manager's
 * layerID), so most events do not depend on which layers are selected.
 */
import { json } from 'adobe-mcp-core';

export const AM = String.raw`
var __s = function (k) { return app.stringIDToTypeID(k); };
var __c = function (k) { return app.charIDToTypeID(k); };
var __play = function (event, d) { return app.executeAction(__s(event), d || new ActionDescriptor(), DialogModes.NO); };
var __layerRef = function (id) { var r = new ActionReference(); r.putIdentifier(__s("layer"), id); return r; };
var __targetRef = function () { var r = new ActionReference(); r.putEnumerated(__s("layer"), __s("ordinal"), __s("targetEnum")); return r; };
var __onLayer = function (id) { var d = new ActionDescriptor(); d.putReference(__s("null"), __layerRef(id)); return d; };
var __onTarget = function () { var d = new ActionDescriptor(); d.putReference(__s("null"), __targetRef()); return d; };
var __layerDesc = function (id) { return app.executeActionGet(__layerRef(id)); };
var __setLayer = function (id, to) { var d = __onLayer(id); d.putObject(__s("to"), __s("layer"), to); __play("set", d); };
var __selectLayers = function (items, add) {
  for (var i = 0; i < items.length; i++) {
    var d = new ActionDescriptor();
    d.putReference(__s("null"), __layerRef(items[i].id));
    if (i > 0 || add) d.putEnumerated(__s("selectionModifier"), __s("selectionModifierType"), __s("addToSelection"));
    d.putBoolean(__s("makeVisible"), false);
    __play("select", d);
  }
};
var __selectedIds = function () {
  var r = new ActionReference();
  r.putProperty(__s("property"), __s("targetLayersIDs"));
  r.putEnumerated(__s("document"), __s("ordinal"), __s("targetEnum"));
  var d = app.executeActionGet(r), out = [];
  if (!d.hasKey(__s("targetLayersIDs"))) return out;
  var l = d.getList(__s("targetLayersIDs"));
  for (var i = 0; i < l.count; i++) out.push(l.getReference(i).getIdentifier());
  return out;
};
var __selectedInfo = function () {
  var ids = __selectedIds(), out = [];
  for (var i = 0; i < ids.length; i++) { try { out.push(__layerInfo(__layerById(doc, ids[i]))); } catch (e) {} }
  return out;
};
var __rgbDesc = function (c) {
  var d = new ActionDescriptor();
  d.putDouble(__c("Rd  "), c.rgb.red);
  d.putDouble(__c("Grn "), c.rgb.green);
  d.putDouble(__c("Bl  "), c.rgb.blue);
  return d;
};
var __hasSelection = function () { try { var b = doc.selection.bounds; return !!b; } catch (e) { return false; } };
var __isSmartObject = function (l) { return l.typename === "ArtLayer" && l.kind === LayerKind.SMARTOBJECT; };
var __descVal = function (d, k, t, depth) {
  if (t === DescValueType.BOOLEANTYPE) return d.getBoolean(k);
  if (t === DescValueType.INTEGERTYPE) return d.getInteger(k);
  if (t === DescValueType.LARGEINTEGERTYPE) return d.getLargeInteger(k);
  if (t === DescValueType.DOUBLETYPE) return d.getDouble(k);
  if (t === DescValueType.UNITDOUBLE) return d.getUnitDoubleValue(k);
  if (t === DescValueType.STRINGTYPE) return d.getString(k);
  if (t === DescValueType.ENUMERATEDTYPE) return app.typeIDToStringID(d.getEnumerationValue(k));
  if (t === DescValueType.CLASSTYPE) return app.typeIDToStringID(d.getClass(k));
  if (t === DescValueType.OBJECTTYPE) return depth > 0 ? __descJson(d.getObjectValue(k), depth - 1) : null;
  if (t === DescValueType.LISTTYPE) {
    var l = d.getList(k), a = [];
    for (var j = 0; j < l.count; j++) a.push(__descVal(l, j, l.getType(j), depth));
    return a;
  }
  return null;
};
var __descJson = function (d, depth) {
  var o = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i), n = app.typeIDToStringID(k) || app.typeIDToCharID(k);
    try { o[n] = __descVal(d, k, d.getType(k), depth); } catch (e) { o[n] = null; }
  }
  return o;
};
`;

/**
 * Statements that set `variable` to a gradient descriptor (class
 * gradientClassEvent, charID Grdn) with evenly spaced colour stops and full
 * opacity. charIDs are used where the stringID differs from the term
 * (Grdn, Intr, Clrt, TrnS); they are the ones ScriptListener records.
 * @param {string} variable
 * @param {string[]} colorSpecs colour literals from colorSpec()
 */
export function gradientLines(variable, colorSpecs) {
    const n = colorSpecs.length;
    const lines = [
        `var ${variable} = new ActionDescriptor();`,
        `${variable}.putString(__s("name"), "Custom");`,
        `${variable}.putEnumerated(__c("GrdF"), __c("GrdF"), __c("CstS"));`,
        `${variable}.putDouble(__c("Intr"), 4096);`,
        `var ${variable}C = new ActionList(), ${variable}T = new ActionList(), ${variable}S;`,
    ];
    colorSpecs.forEach((spec, i) => {
        const loc = Math.round((4096 * i) / (n - 1));
        lines.push(
            `${variable}S = new ActionDescriptor(); ${variable}S.putObject(__c("Clr "), __c("RGBC"), __rgbDesc(__color(${spec}))); ${variable}S.putEnumerated(__c("Type"), __c("Clry"), __c("UsrS")); ${variable}S.putInteger(__c("Lctn"), ${loc}); ${variable}S.putInteger(__c("Mdpn"), 50); ${variable}C.putObject(__c("Clrt"), ${variable}S);`,
        );
    });
    for (const loc of [0, 4096]) {
        lines.push(`${variable}S = new ActionDescriptor(); ${variable}S.putUnitDouble(__c("Opct"), __c("#Prc"), 100); ${variable}S.putInteger(__c("Lctn"), ${loc}); ${variable}S.putInteger(__c("Mdpn"), 50); ${variable}T.putObject(__c("TrnS"), ${variable}S);`);
    }
    lines.push(`${variable}.putList(__c("Clrs"), ${variable}C);`, `${variable}.putList(__c("Trns"), ${variable}T);`);
    return lines.join('\n');
}

/**
 * Statements that set `variable` to a pattern descriptor naming a loaded
 * pattern preset, by name and, when given, by its preset id.
 * @param {string} variable
 * @param {{ name?: string, id?: string }} pattern
 * @param {(s: unknown) => string} str the core str() quoting helper
 */
export function patternLines(variable, pattern, str) {
    if (!pattern || typeof pattern !== 'object' || (!pattern.name && !pattern.id)) throw new Error('A pattern needs { name } (as in the Patterns panel) or { id }');
    return [
        `var ${variable} = new ActionDescriptor();`,
        pattern.name ? `${variable}.putString(__s("name"), ${str(pattern.name)});` : '',
        pattern.id ? `${variable}.putString(__s("ID"), ${str(pattern.id)});` : '',
    ].join('\n');
}

/**
 * Statements that set `variable` to a contour (shapeCurveType) descriptor:
 * Linear by default, or a curve through [input, output] points, 0-255.
 */
export function contourLines(variable, points) {
    if (points === undefined || points === null) return `var ${variable} = new ActionDescriptor(); ${variable}.putString(__s("name"), "Linear");`;
    if (!Array.isArray(points) || points.length < 2) throw new Error('A contour needs at least two [input, output] points, 0-255');
    const pts = points.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`contour point ${i} must be [input, output]`);
        return p.map((v, j) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`contour point ${i}[${j}] must be 0-255`);
            return n;
        });
    });
    return [
        `var ${variable} = new ActionDescriptor(), ${variable}L = new ActionList(), ${variable}P, ${variable}Pts = ${json(pts)};`,
        `${variable}.putString(__s("name"), "Custom");`,
        `for (var ${variable}I = 0; ${variable}I < ${variable}Pts.length; ${variable}I++) { ${variable}P = new ActionDescriptor(); ${variable}P.putDouble(__s("horizontal"), ${variable}Pts[${variable}I][0]); ${variable}P.putDouble(__s("vertical"), ${variable}Pts[${variable}I][1]); ${variable}L.putObject(__s("curvePoint"), ${variable}P); }`,
        `${variable}.putList(__s("curve"), ${variable}L);`,
    ].join('\n');
}

/** Blend modes as Action Manager blendMode enumeration values. */
export const AM_BLEND_MODES = {
    normal: 'normal', dissolve: 'dissolve', darken: 'darken', multiply: 'multiply', color_burn: 'colorBurn', linear_burn: 'linearBurn',
    darker_color: 'darkerColor', lighten: 'lighten', screen: 'screen', color_dodge: 'colorDodge', linear_dodge: 'linearDodge',
    lighter_color: 'lighterColor', overlay: 'overlay', soft_light: 'softLight', hard_light: 'hardLight', vivid_light: 'vividLight',
    linear_light: 'linearLight', pin_light: 'pinLight', hard_mix: 'hardMix', difference: 'difference', exclusion: 'exclusion',
    subtract: 'blendSubtraction', divide: 'blendDivide', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

export const GRADIENT_TYPES = { linear: 'linear', radial: 'radial', angle: 'angle', reflected: 'reflected', diamond: 'diamond' };
