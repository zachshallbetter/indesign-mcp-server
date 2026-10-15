/**
 * Drawing tools, paint and Roto Brush: choose the active tool in the Tools
 * panel and open the Paint, Brushes and Content-Aware Fill panels; list paint
 * strokes and Roto Brush effects; change and keyframe existing paint strokes;
 * and set the Roto Brush & Refine Edge effect's matte settings.
 *
 * Drawing strokes, Roto Brush segmentation and its propagation happen in the
 * Layer panel by hand; scripts reach the strokes and settings they produce.
 */
import { str, num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue, propertyValue } from '../args.js';
import { PROPERTY_TREE } from './shapes.js';

/** Tools panel tools, as ToolType members. */
const TOOLS = {
    selection: 'Tool_Arrow',
    rectangle: 'Tool_Rect',
    rounded_rectangle: 'Tool_RoundedRect',
    ellipse: 'Tool_Oval',
    polygon: 'Tool_Polygon',
    star: 'Tool_Star',
    pen: 'Tool_Pen',
    add_vertex: 'Tool_PenPlus',
    delete_vertex: 'Tool_PenMinus',
    convert_vertex: 'Tool_PenConvert',
    mask_feather: 'Tool_Feather',
    brush: 'Tool_Paintbrush',
    clone_stamp: 'Tool_CloneStamp',
    eraser: 'Tool_Eraser',
    roto_brush: 'Tool_Quickselect',
    refine_edge: 'Tool_Hairbrush',
};

/** Window menu commands for the panels. Content-Aware Fill's id varies, so it is looked up by name. */
const PANELS = {
    paint: '3045',
    brushes: '3014',
    content_aware_fill: 'app.findMenuCommandId("Content-Aware Fill")',
};

/** Paint stroke settings: match names and English names to look for in a stroke. */
const STROKE = {
    start: [['ADBE Paint Begin', 'Start'], 'number', 0, 100],
    end: [['ADBE Paint End', 'End'], 'number', 0, 100],
    color: [['ADBE Paint Color', 'Color'], 'color'],
    diameter: [['ADBE Paint Diameter', 'Diameter'], 'number', 0, 10000],
    angle: [['ADBE Paint Angle', 'Angle'], 'number', -36000, 36000],
    hardness: [['ADBE Paint Hardness', 'Hardness'], 'number', 0, 100],
    roundness: [['ADBE Paint Roundness', 'Roundness'], 'number', 0, 100],
    spacing: [['ADBE Paint Spacing', 'Spacing'], 'number', 0, 1000],
    opacity: [['ADBE Paint Opacity', 'Opacity'], 'number', 0, 100],
    flow: [['ADBE Paint Flow', 'Flow'], 'number', 0, 100],
    clonePosition: [['ADBE Paint Clone Position', 'Clone Position'], 'xy'],
    cloneTime: [['ADBE Paint Clone Time', 'Clone Time'], 'number', -1e6, 1e6],
    cloneTimeShift: [['ADBE Paint Clone Time Shift', 'Clone Time Shift'], 'number', -1e6, 1e6],
    anchorPoint: [['ADBE Paint Anchor Point', 'Anchor Point'], 'xy'],
    position: [['ADBE Paint Position', 'Position'], 'xy'],
    scale: [['ADBE Paint Scale', 'Scale'], 'xy'],
    rotation: [['ADBE Paint Rotation', 'Rotation'], 'number', -1e6, 1e6],
};
const STROKE_DESCRIPTIONS = {
    start: 'Start, percent of the stroke drawn from', end: 'End, percent (animate it to write the stroke on)', color: 'Brush colour, "#RRGGBB" or "rgb(r,g,b)"',
    diameter: 'Diameter, pixels', angle: 'Brush angle, degrees', hardness: 'Hardness, percent', roundness: 'Roundness, percent', spacing: 'Spacing, percent',
    opacity: 'Opacity, percent', flow: 'Flow, percent', clonePosition: 'Clone strokes: Clone Position [x, y], where the stroke samples from',
    cloneTime: 'Clone strokes: Clone Time, seconds', cloneTimeShift: 'Clone strokes: Clone Time Shift, seconds', anchorPoint: 'Stroke Transform: Anchor Point [x, y]',
    position: 'Stroke Transform: Position [x, y]', scale: 'Stroke Transform: Scale [x, y] percent', rotation: 'Stroke Transform: Rotation, degrees',
};

/**
 * Roto Brush & Refine Edge settings: English names to look for (the effect's
 * match names are not documented), the kind of value, and whether the setting
 * exists in both the Roto Brush Matte and Refine Edge Matte groups.
 */
const ROTO = {
    searchRadius: [['Search Radius'], 'number'],
    viewSearchRadius: [['View Search Radius'], 'boolean'],
    enableClassicControls: [['Enable Classic Controls'], 'boolean'],
    motionThreshold: [['Motion Threshold'], 'number'],
    motionDamping: [['Motion Damping'], 'number'],
    edgeDetection: [['Edge Detection'], 'menu'],
    useAlternateColorEstimation: [['Use Alternate Color Estimation'], 'boolean'],
    feather: [['Feather'], 'number', true],
    contrast: [['Contrast'], 'number', true],
    shiftEdges: [['Shift Edge', 'Shift Edges'], 'number', true],
    reduceChatter: [['Reduce Chatter', 'Chatter Reduction'], 'number', true],
    smooth: [['Smooth'], 'number', true],
    fineTuneRefineEdgeMatte: [['Fine-tune Refine Edge Matte'], 'boolean'],
    extendWhereSmoothed: [['Extend Where Smoothed'], 'boolean'],
    increaseRadius: [['Increase Decontamination Radius', 'Increase Radius'], 'number'],
    viewMap: [['View Decontamination Map', 'View Map'], 'boolean'],
};
const MATTES = { roto: ['Roto Brush Matte'], refine: ['Refine Edge Matte'] };

const EFFECT_SCHEMA = { type: ['string', 'integer'], description: 'Which effect, by name or 1-based index in the Effect Controls panel; omit for every one of its kind on the layer' };

/** ES3: find a property by match name or name, breadth first; and list a layer's effects of one kind. */
const FIND = `
var __find = function (g, names) {
  var i, k;
  for (i = 1; i <= g.numProperties; i++) {
    var p = g.property(i);
    for (k = 0; k < names.length; k++) if (p.matchName === names[k] || p.name === names[k]) return p;
  }
  for (i = 1; i <= g.numProperties; i++) {
    var q = g.property(i);
    if (q.propertyType !== PropertyType.PROPERTY) { var hit = __find(q, names); if (hit) return hit; }
  }
  return null;
};
var __effects = function (layer, matchName, which) {
  var parade = layer.property("ADBE Effect Parade"), out = [];
  if (which !== null) {
    var fx = parade.property(which);
    if (!fx || fx.matchName !== matchName) throw new Error(layer.name + " has no " + matchName + " effect " + which);
    return [fx];
  }
  for (var i = 1; i <= parade.numProperties; i++) if (parade.property(i).matchName === matchName) out.push(parade.property(i));
  return out;
};
var __strokes = function (fx) {
  var g = fx.property("ADBE Paint Group"), out = [], i;
  if (!g) for (i = 1; i <= fx.numProperties; i++) if (fx.property(i).propertyType === PropertyType.INDEXED_GROUP) { g = fx.property(i); break; }
  if (g) for (i = 1; i <= g.numProperties; i++) out.push(g.property(i));
  return out;
};`;

/** An effect choice as a JSX literal, or null for every one. */
function effectRef(effect) {
    if (effect === undefined) return 'null';
    return typeof effect === 'number' ? index(effect, { name: 'effect', max: 1000 }) : str(effect);
}

/** A checked value for a paint or Roto Brush setting. */
function settingValue(kind, v, name, min = -1e6, max = 1e6) {
    if (kind === 'color') return [...JSON.parse(colorValue(v, name)), 1];
    if (kind === 'xy') {
        if (!Array.isArray(v) || v.length !== 2) throw new Error(`'${name}' must be [x, y]`);
        return v.map((x, i) => Number(num(x, { name: `${name}[${i}]` })));
    }
    if (kind === 'boolean') {
        if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
        return v ? 1 : 0;
    }
    if (kind === 'menu') return Number(index(v, { name, max: 100 }));
    return Number(num(v, { min, max, name }));
}

export const tools = [
    {
        name: 'select_drawing_tool',
        description: 'Choose the active tool in the Tools panel (shape and mask tools: Rectangle, Rounded Rectangle, Ellipse, Polygon, Star; Pen, Add Vertex, Delete Vertex, Convert Vertex, Mask Feather; Brush, Clone Stamp, Eraser; Roto Brush, Refine Edge; or Selection), and/or open the Paint, Brushes or Content-Aware Fill panel (Window menu, which toggles a panel that is already open). Drawing with the tool is then done by hand in the Composition or Layer panel',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(TOOLS), description: 'Tool to make active' },
                panel: { type: 'string', enum: Object.keys(PANELS), description: 'Panel to open from the Window menu' },
            },
        },
        auditArgs: { tool: 'roto_brush', panel: 'content_aware_fill' },
        features: [
            'aftereffects.masks_shapes.rectangle_tool',
            'aftereffects.masks_shapes.rounded_rectangle_tool',
            'aftereffects.masks_shapes.ellipse_tool',
            'aftereffects.masks_shapes.polygon_tool',
            'aftereffects.masks_shapes.star_tool',
            'aftereffects.masks_shapes.pen_tool',
            'aftereffects.masks_shapes.add_vertex_tool',
            'aftereffects.masks_shapes.delete_vertex_tool',
            'aftereffects.masks_shapes.convert_vertex_tool',
            'aftereffects.masks_shapes.mask_feather_tool',
            'aftereffects.paint_roto.brush_tool',
            'aftereffects.paint_roto.clone_stamp_tool',
            'aftereffects.paint_roto.eraser_tool',
            'aftereffects.paint_roto.roto_brush_tool',
            'aftereffects.paint_roto.refine_edge_tool',
            'aftereffects.paint_roto.paint_panel',
            'aftereffects.paint_roto.brushes_panel',
            'aftereffects.paint_roto.content_aware_fill_panel',
        ],
        handler: (a) => {
            if (a.tool === undefined && a.panel === undefined) throw new Error('Give tool, panel or both');
            const tool = a.tool === undefined ? null : TOOLS[enumOf(a.tool, Object.keys(TOOLS), { name: 'tool' })];
            const panel = a.panel === undefined ? null : PANELS[enumOf(a.panel, Object.keys(PANELS), { name: 'panel' })];
            return run('Select tool', script(`
var out = {};
${panel ? `var id = ${panel};
if (!id) throw new Error("This After Effects has no ${a.panel} panel command");
app.executeCommand(id);
out.panel = ${str(a.panel)};` : ''}
${tool ? `app.project.toolType = ToolType.${tool};
out.tool = ${str(a.tool)}; out.toolType = app.project.toolType;` : ''}
__result__ = out;`));
        },
    },
    {
        name: 'list_paint_strokes',
        description: 'List the paint strokes on layers (Paint effects made with the Brush, Clone Stamp and Eraser tools) and the Roto Brush & Refine Edge effects, with every setting\'s name and value, so set_paint_strokes and set_roto_brush can address them',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA }, required: ['layers'] },
        hints: { readOnly: true },
        features: ['aftereffects.paint_roto.paint_effect', 'aftereffects.paint_roto.roto_brush_effect'],
        handler: (a) => run('List paint strokes', script(`${FIND}${PROPERTY_TREE}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var paints = __effects(ls[i], "ADBE Paint", null), rotos = __effects(ls[i], "ADBE Samurai", null), pl = [], rl = [];
  for (var f = 0; f < paints.length; f++) {
    var st = __strokes(paints[f]), sl = [];
    for (var s = 0; s < st.length; s++) sl.push({ index: s + 1, name: st[s].name, matchName: st[s].matchName, settings: __tree(st[s], 0) });
    var pot = __find(paints[f], ["ADBE Paint On Transparent", "Paint on Transparent"]);
    pl.push({ effect: paints[f].name, index: paints[f].propertyIndex, paintOnTransparent: pot ? pot.value : null, strokes: sl });
  }
  for (f = 0; f < rotos.length; f++) rl.push({ effect: rotos[f].name, index: rotos[f].propertyIndex, settings: __tree(rotos[f], 0) });
  out.push({ layer: ls[i].index, name: ls[i].name, paint: pl, rotoBrush: rl });
}
__result__ = { layers: out };`)),
    },
    {
        name: 'set_paint_strokes',
        description: 'Change or keyframe existing paint strokes (Paint effect, Timeline panel): Start and End (write-on), colour, diameter, hardness, opacity, flow and the other brush settings, a clone stroke\'s Clone Position, Clone Time and Clone Time Shift, the stroke\'s Transform, and the effect\'s Paint on Transparent. Strokes themselves are drawn by hand with the Brush, Clone Stamp or Eraser tool',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                effect: EFFECT_SCHEMA,
                strokes: { type: 'array', items: { type: ['string', 'integer'] }, description: 'Strokes by name (e.g. "Brush 1", "Clone 2") or 1-based index; omit for every stroke' },
                ...Object.fromEntries(Object.entries(STROKE).map(([k, [, kind, min, max]]) => [k, kind === 'xy'
                    ? { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: STROKE_DESCRIPTIONS[k] }
                    : kind === 'color' ? { ...COLOR_SCHEMA, description: STROKE_DESCRIPTIONS[k] } : { type: 'number', minimum: min, maximum: max, description: STROKE_DESCRIPTIONS[k] }])),
                paintOnTransparent: { type: 'boolean', description: 'The Paint effect\'s Paint on Transparent switch' },
                time: { type: 'number', description: 'Seconds: set keyframes at this time (animates the strokes). Default: static values, or keyframes at the current time on animated properties' },
            },
            required: ['layers'],
        },
        auditArgs: { effect: undefined, strokes: ['Clone 1'], end: 100, color: '#FF0000', clonePosition: [100, 200], cloneTime: 1.5, cloneTimeShift: -0.5, paintOnTransparent: true, time: 2 },
        features: [
            'aftereffects.paint_roto.paint_effect',
            'aftereffects.paint_roto.clone_stroke_property.clone_position',
            'aftereffects.paint_roto.clone_stroke_property.clone_time',
            'aftereffects.paint_roto.clone_stroke_property.clone_time_shift',
            'aftereffects.paint_roto.animate_paint_stroke',
        ],
        handler: (a) => {
            const settings = Object.entries(STROKE).filter(([k]) => a[k] !== undefined)
                .map(([k, [names, kind, min, max]]) => ({ name: k, names, value: settingValue(kind, a[k], k, min, max) }));
            if (!settings.length && a.paintOnTransparent === undefined) throw new Error(`Nothing to change: give ${Object.keys(STROKE).join(', ')} or paintOnTransparent`);
            const strokes = a.strokes === undefined ? 'null' : json(a.strokes.map((s, i) => (typeof s === 'number' ? Number(index(s, { name: `strokes[${i}]`, max: 10000 })) : String(s))));
            return run('Set paint strokes', script(`${FIND}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), settings = ${json(settings)}, want = ${strokes}, t = ${a.time !== undefined ? num(a.time, { name: 'time' }) : 'null'}, out = [];
for (var i = 0; i < ls.length; i++) {
  var fxs = __effects(ls[i], "ADBE Paint", ${effectRef(a.effect)});
  if (!fxs.length) throw new Error(ls[i].name + " has no paint strokes (Paint effect)");
  for (var f = 0; f < fxs.length; f++) {
    ${a.paintOnTransparent !== undefined ? `var pot = __find(fxs[f], ["ADBE Paint On Transparent", "Paint on Transparent"]);
    if (!pot) throw new Error(fxs[f].name + " has no Paint on Transparent");
    pot.setValue(${a.paintOnTransparent ? 1 : 0});` : ''}
    var all = __strokes(fxs[f]), st = [], s, k;
    if (want === null) st = all;
    else for (s = 0; s < want.length; s++) {
      var hit = null;
      for (k = 0; k < all.length; k++) if (all[k].name === want[s] || k + 1 === want[s]) hit = all[k];
      if (!hit) throw new Error(fxs[f].name + " has no stroke " + want[s]);
      st.push(hit);
    }
    for (s = 0; s < st.length; s++) {
      var set = [], skipped = [];
      for (k = 0; k < settings.length; k++) {
        var p = __find(st[s], settings[k].names);
        if (!p) { skipped.push(settings[k].name); continue; }
        if (t !== null) p.setValueAtTime(t, settings[k].value);
        else if (p.numKeys > 0) p.setValueAtTime(c.time, settings[k].value);
        else p.setValue(settings[k].value);
        set.push(settings[k].name);
      }
      out.push({ layer: ls[i].index, effect: fxs[f].name, stroke: st[s].name, set: set, skipped: skipped });
    }
  }
}
__result__ = { strokes: out };`, { undo: 'Set paint strokes' }));
        },
    },
    {
        name: 'set_roto_brush',
        description: 'Set the Roto Brush & Refine Edge effect\'s settings on layers (Effect Controls panel): propagation (Search Radius, View Search Radius, Motion Threshold, Motion Damping, Edge Detection, Enable Classic Controls, Use Alternate Color Estimation), matte (Feather, Contrast, Shift Edge, Reduce Chatter, Smooth) for the Roto Brush or Refine Edge matte, and refinement (Fine-tune Refine Edge Matte, Extend Where Smoothed, Increase Radius, View Map). Settings are found by their English names. Segmentation strokes and propagation are done by hand with the Roto Brush and Refine Edge tools',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                effect: EFFECT_SCHEMA,
                matte: { type: 'string', enum: Object.keys(MATTES), description: 'Which matte group feather, contrast, shiftEdges, reduceChatter and smooth apply to. Default roto' },
                settings: {
                    type: 'object',
                    description: 'Settings to change',
                    properties: Object.fromEntries(Object.entries(ROTO).map(([k, [names, kind]]) => [k, kind === 'boolean'
                        ? { type: 'boolean', description: names[0] }
                        : { type: kind === 'menu' ? 'integer' : 'number', description: kind === 'menu' ? `${names[0]}: position in its menu, from 1` : names[0] }])),
                },
                properties: { type: 'object', description: 'Any other setting of the effect by name or match name, to a number or true/false' },
                time: { type: 'number', description: 'Seconds: set keyframes at this time' },
            },
            required: ['layers'],
        },
        auditArgs: { effect: undefined, matte: 'refine', settings: { searchRadius: 20, viewSearchRadius: true, edgeDetection: 2, feather: 10, shiftEdges: -5 }, properties: { Decontaminate: true }, time: undefined },
        features: [
            'aftereffects.paint_roto.roto_brush_effect',
            'aftereffects.paint_roto.roto_brush_option.search_radius',
            'aftereffects.paint_roto.roto_brush_option.view_search_radius',
            'aftereffects.paint_roto.roto_brush_option.enable_classic_controls',
            'aftereffects.paint_roto.roto_brush_option.motion_threshold',
            'aftereffects.paint_roto.roto_brush_option.motion_damping',
            'aftereffects.paint_roto.roto_brush_option.edge_detection',
            'aftereffects.paint_roto.roto_brush_option.use_alternate_color_estimation',
            'aftereffects.paint_roto.roto_brush_option.feather',
            'aftereffects.paint_roto.roto_brush_option.contrast',
            'aftereffects.paint_roto.roto_brush_option.shift_edges',
            'aftereffects.paint_roto.roto_brush_option.reduce_chatter',
            'aftereffects.paint_roto.roto_brush_option.smooth',
            'aftereffects.paint_roto.roto_brush_option.fine_tune_refine_edge_matte',
            'aftereffects.paint_roto.roto_brush_option.extend_where_smoothed',
            'aftereffects.paint_roto.roto_brush_option.increase_radius',
            'aftereffects.paint_roto.roto_brush_option.view_map',
        ],
        handler: (a) => {
            const scope = MATTES[enumOf(a.matte ?? 'roto', Object.keys(MATTES), { name: 'matte' })];
            const given = a.settings ?? {};
            if (typeof given !== 'object' || Array.isArray(given)) throw new Error("'settings' must be an object");
            const list = Object.entries(given).map(([k, v]) => {
                if (!ROTO[k]) throw new Error(`'settings.${k}' is not a Roto Brush setting. Use ${Object.keys(ROTO).join(', ')}, or properties for others`);
                const [names, kind, scoped] = ROTO[k];
                return { name: k, names, scope: scoped ? scope : [], value: settingValue(kind, v, `settings.${k}`) };
            });
            if (a.properties !== undefined && (!a.properties || typeof a.properties !== 'object' || Array.isArray(a.properties))) throw new Error("'properties' must be an object");
            for (const [k, v] of Object.entries(a.properties ?? {})) {
                const value = JSON.parse(propertyValue(v, `properties.${k}`));
                list.push({ name: k, names: [String(k)], scope: [], value: typeof value === 'boolean' ? (value ? 1 : 0) : value });
            }
            if (!list.length) throw new Error('Nothing to change: give settings or properties');
            return run('Set Roto Brush', script(`${FIND}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), list = ${json(list)}, t = ${a.time !== undefined ? num(a.time, { name: 'time' }) : 'null'}, out = [];
for (var i = 0; i < ls.length; i++) {
  var fxs = __effects(ls[i], "ADBE Samurai", ${effectRef(a.effect)});
  if (!fxs.length) throw new Error(ls[i].name + " has no Roto Brush & Refine Edge effect: draw a Roto Brush stroke on it first");
  for (var f = 0; f < fxs.length; f++) {
    var set = [];
    for (var k = 0; k < list.length; k++) {
      var where = list[k].scope.length ? (__find(fxs[f], list[k].scope) || fxs[f]) : fxs[f];
      var p = __find(where, list[k].names);
      if (!p || p.propertyType !== PropertyType.PROPERTY) throw new Error(fxs[f].name + " has no setting " + list[k].names.join(" or "));
      if (t !== null) p.setValueAtTime(t, list[k].value);
      else if (p.numKeys > 0) p.setValueAtTime(c.time, list[k].value);
      else p.setValue(list[k].value);
      set.push({ setting: list[k].name, property: p.name, value: p.value });
    }
    out.push({ layer: ls[i].index, effect: fxs[f].name, set: set });
  }
}
__result__ = { effects: out };`, { undo: 'Set Roto Brush' }));
        },
    },
];
