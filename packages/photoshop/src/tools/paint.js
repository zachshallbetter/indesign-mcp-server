/**
 * Painting and retouching: Edit > Fill contents (including Content-Aware),
 * classic gradients, painting and retouching tools applied along a path,
 * Fill Path, the Paint Bucket and Magic Eraser at a point, brush and tool
 * options, brush files, and the Patch and Content-Aware Move commands.
 *
 * Painting by hand on the canvas is interactive. These tools reach the same
 * results through the commands a script can play: the fill, gradient, stroke,
 * patch and move events of the Action Manager, and the object model where it
 * has the feature.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';
import { FILL_BLEND } from './selection.js';
import { paths } from './documents.js';

/** Fill blend modes as the Action Manager's blendMode enum values. */
const AM_BLEND = {
    normal: 'normal', dissolve: 'dissolve', behind: 'behind', clear: 'clearEnum', darken: 'darken', multiply: 'multiply', color_burn: 'colorBurn',
    linear_burn: 'linearBurn', lighten: 'lighten', screen: 'screen', color_dodge: 'colorDodge', linear_dodge: 'linearDodge', overlay: 'overlay',
    soft_light: 'softLight', hard_light: 'hardLight', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation',
    color: 'color', luminosity: 'luminosity',
};
const BLEND_SCHEMA = { type: 'string', enum: Object.keys(AM_BLEND), description: 'Blend mode. Default normal' };
const OPACITY_SCHEMA = { type: 'number', minimum: 1, maximum: 100, description: 'Percent. Default 100' };
const POINT_SCHEMA = { type: 'object', description: 'A point in pixels from the document\'s top-left corner', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };

/**
 * Painting and retouching tools that a script can apply along a path with the
 * stroke event, by their tool class ids (as app.currentTool names them).
 */
const STROKE_TOOLS = {
    brush: 'paintbrushTool', pencil: 'pencilTool', color_replacement: 'colorReplacementBrushTool', art_history_brush: 'artBrushTool',
    history_brush: 'historyBrushTool', eraser: 'eraserTool', background_eraser: 'backgroundEraserTool', healing_brush: 'magicStampTool',
    clone_stamp: 'cloneStampTool', pattern_stamp: 'patternStampTool', blur: 'blurTool', sharpen: 'sharpenTool', smudge: 'smudgeTool',
    dodge: 'dodgeTool', burn: 'burnInTool', sponge: 'saturationTool',
};

/** Every tool set_tool_options can make active: the stroke tools plus ones used only by hand or by other tools here. */
const ACTIVE_TOOLS = {
    ...STROKE_TOOLS, mixer_brush: 'wetBrushTool', spot_healing_brush: 'spotHealingBrushTool', red_eye: 'redEyeTool', gradient: 'gradientTool',
    paint_bucket: 'bucketTool', magic_eraser: 'magicEraserTool', patch: 'patchSelection', content_aware_move: 'recomposeSelection',
};

/**
 * Script helpers shared by these tools: sid/cid for type ids, __hasSelection()
 * (an Action Manager probe, since reading selection.bounds with nothing
 * selected throws) and __pt() for a point descriptor in pixels.
 */
const AM = `
var sid = function (s) { return app.stringIDToTypeID(s); };
var cid = function (c) { return app.charIDToTypeID(c); };
var __hasSelection = function () {
  var r = new ActionReference();
  r.putProperty(sid("property"), sid("selection"));
  r.putEnumerated(sid("document"), sid("ordinal"), sid("targetEnum"));
  return app.executeActionGet(r).hasKey(sid("selection"));
};
var __pt = function (x, y) {
  var p = new ActionDescriptor();
  p.putUnitDouble(sid("horizontal"), sid("pixelsUnit"), x);
  p.putUnitDouble(sid("vertical"), sid("pixelsUnit"), y);
  return p;
};`;

const blend = (v) => AM_BLEND[enumOf(v ?? 'normal', Object.keys(AM_BLEND), { name: 'blendMode' })];
const opacity = (v) => num(v ?? 100, { min: 1, max: 100, name: 'opacity' });

/** A colour argument, or the foreground/background colour, as a script expression for a SolidColor. */
function colorExpr(value, name) {
    if (value === undefined || value === null || value === 'foreground') return 'app.foregroundColor';
    if (value === 'background') return 'app.backgroundColor';
    return `__color(${colorSpec(value, name)})`;
}

/** A checked {x, y} point as [x, y]. */
function point(p, name) {
    if (!p || typeof p !== 'object') throw new Error(`'${name}' must be { x, y }`);
    return [Number(num(p.x, { name: `${name}.x` })), Number(num(p.y, { name: `${name}.y` }))];
}

const PATH_PROPS = {
    path: { type: 'string', description: 'Name of a path in the Paths panel' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 2, description: 'Instead of path: corners of a temporary path, [[x, y], ...] in pixels. It is removed afterwards' },
};

/**
 * Script that sets `__path` to the named path, or to a temporary path through
 * the given points. Path points are laid out at 72 ppi, so the document's
 * resolution is set to 72 (without resampling) while the path is made, then
 * restored. Pair with PATH_END.
 */
function pathStart(a, { closed }) {
    if (a.path !== undefined && a.points !== undefined) throw new Error('Give path or points, not both');
    if (a.path !== undefined) {
        if (typeof a.path !== 'string' || !a.path) throw new Error("'path' must be a path name");
        return `var __path = doc.pathItems.getByName(${str(a.path)}), __temp = false;`;
    }
    if (!Array.isArray(a.points) || a.points.length < (closed ? 3 : 2)) throw new Error(`Give path, or points with at least ${closed ? 3 : 2} [x, y] pairs`);
    const pts = a.points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
    return `
var __res = doc.resolution;
if (__res !== 72) doc.resizeImage(undefined, undefined, 72, ResampleMethod.NONE);
var __path = null, __temp = true;
try {
  var __pts = ${json(pts)}, __info = [];
  for (var i = 0; i < __pts.length; i++) {
    var pp = new PathPointInfo();
    pp.kind = PointKind.CORNERPOINT;
    pp.anchor = __pts[i];
    pp.leftDirection = __pts[i];
    pp.rightDirection = __pts[i];
    __info.push(pp);
  }
  var __sub = new SubPathInfo();
  __sub.closed = ${bool(closed)};
  __sub.operation = ShapeOperation.SHAPEXOR;
  __sub.entireSubPath = __info;
  __path = doc.pathItems.add("Temporary path " + new Date().getTime(), [__sub]);
} finally {
  if (__res !== 72) doc.resizeImage(undefined, undefined, __res, ResampleMethod.NONE);
}`;
}

const PATH_END = 'if (__temp) __path.remove(); else __path.deselect();';

const STRUCTURE_SCHEMA = { type: 'integer', minimum: 1, maximum: 7, description: 'How closely the result keeps existing image patterns, 1 (loose) to 7 (strict). Default 5 for patch, 4 for move' };
const COLOR_ADAPT_SCHEMA = { type: 'integer', minimum: 0, maximum: 10, description: 'How much colour blending, 0 to 10. Default 5' };

export const tools = [
    {
        name: 'fill_contents',
        description: 'Fill the selection (or the whole layer when nothing is selected) on the active layer with the foreground or background colour, black, 50% gray, white, a pattern, a History state, or Content-Aware fill (Edit > Fill). Content-Aware needs a selection and fills it directly, without the Content-Aware Fill workspace. For a specific colour use fill_selection',
        inputSchema: {
            type: 'object',
            properties: {
                contents: { type: 'string', enum: ['foreground', 'background', 'black', 'gray', 'white', 'pattern', 'history', 'content_aware'], description: 'What to fill with; gray is 50% gray' },
                pattern: { type: 'string', description: 'Pattern name (from the Patterns panel), for contents pattern' },
                historyIndex: { type: 'integer', minimum: 0, description: 'History state to fill from (list_history), for contents history. Default 0, the opening state' },
                colorAdaptation: { type: 'boolean', description: 'Content-Aware: blend the fill\'s colour with its surroundings. Default true' },
                rotationAdaptation: { type: 'boolean', description: 'Content-Aware: allow rotated samples. Default false' },
                scale: { type: 'boolean', description: 'Content-Aware: allow scaled samples. Default false' },
                mirror: { type: 'boolean', description: 'Content-Aware: allow mirrored samples. Default false' },
                blendMode: BLEND_SCHEMA,
                opacity: OPACITY_SCHEMA,
                preserveTransparency: { type: 'boolean', description: 'Leave transparent pixels transparent. Default false' },
            },
            required: ['contents'],
        },
        auditArgs: { contents: 'content_aware', pattern: undefined, historyIndex: undefined, preserveTransparency: undefined },
        features: [
            'photoshop.painting.fill_with_foreground_color', 'photoshop.painting.fill_with_background_color', 'photoshop.painting.fill_option.background_color',
            'photoshop.painting.fill_option.black', 'photoshop.painting.fill_option.50pct_gray', 'photoshop.painting.fill_option.white',
            'photoshop.painting.fill_option.pattern', 'photoshop.painting.fill_option.custom_pattern', 'photoshop.painting.fill_option.history',
            'photoshop.painting.fill_option.content_aware', 'photoshop.painting.fill_option.color_adaptation',
            'photoshop.retouching.content_aware_fill_command', 'photoshop.retouching.content_aware_fill_workspace',
            'photoshop.retouching.content_aware_fill_workspace_option.color_adaptation', 'photoshop.retouching.content_aware_fill_workspace_option.rotation_adaptation',
            'photoshop.retouching.content_aware_fill_workspace_option.scale', 'photoshop.retouching.content_aware_fill_workspace_option.mirror',
        ],
        handler: (a) => {
            const contents = enumOf(a.contents, ['foreground', 'background', 'black', 'gray', 'white', 'pattern', 'history', 'content_aware'], { name: 'contents' });
            const aware = contents === 'content_aware';
            if (contents === 'pattern' && (typeof a.pattern !== 'string' || !a.pattern)) throw new Error('contents pattern needs a pattern name');
            if (contents !== 'pattern' && a.pattern !== undefined) throw new Error('pattern applies only to contents pattern');
            if (contents !== 'history' && a.historyIndex !== undefined) throw new Error('historyIndex applies only to contents history');
            const caOptions = ['colorAdaptation', 'rotationAdaptation', 'scale', 'mirror'].filter((k) => a[k] !== undefined);
            if (!aware && caOptions.length) throw new Error(`${caOptions.join(', ')} apply only to contents content_aware`);
            if (aware && a.preserveTransparency !== undefined) throw new Error('preserveTransparency does not apply to Content-Aware fill');
            let body;
            if (contents === 'history') {
                body = `
var __i = ${index(a.historyIndex ?? 0, { name: 'historyIndex' })};
if (__i >= doc.historyStates.length) throw new Error("No history state " + __i + "; there are " + doc.historyStates.length);
doc.selection.fill(doc.historyStates[__i], ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${opacity(a.opacity)}, ${bool(a.preserveTransparency)});`;
            } else {
                const using = { foreground: 'foregroundColor', background: 'backgroundColor', black: 'black', gray: 'gray', white: 'white', pattern: 'pattern', content_aware: 'contentAware' }[contents];
                body = `${AM}
${aware ? 'if (!__hasSelection()) throw new Error("Content-Aware fill needs a selection: select the area to replace first");' : ''}
var d = new ActionDescriptor();
d.putEnumerated(sid("using"), sid("fillContents"), sid(${str(using)}));
${contents === 'pattern' ? `var p = new ActionDescriptor();
p.putString(sid("name"), ${str(a.pattern)});
d.putObject(sid("pattern"), sid("pattern"), p);` : ''}
${aware ? `d.putBoolean(sid("contentAwareColorAdaptationFill"), ${bool(a.colorAdaptation ?? true)});
d.putBoolean(sid("contentAwareRotateFill"), ${bool(a.rotationAdaptation)});
d.putBoolean(sid("contentAwareScaleFill"), ${bool(a.scale)});
d.putBoolean(sid("contentAwareMirrorFill"), ${bool(a.mirror)});` : ''}
d.putUnitDouble(sid("opacity"), sid("percentUnit"), ${opacity(a.opacity)});
d.putEnumerated(sid("mode"), sid("blendMode"), sid(${str(blend(a.blendMode))}));
${!aware && a.preserveTransparency ? 'd.putBoolean(sid("preserveTransparency"), true);' : ''}
app.executeAction(sid("fill"), d, DialogModes.NO);`;
            }
            return run('Fill', script(`${body}
__result__ = { contents: ${str(contents)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'draw_gradient',
        description: 'Draw a classic gradient on the active layer, inside the selection if there is one, from one point to another (Gradient tool in Classic gradient mode): linear, radial, angle, reflected or diamond, with colour and opacity stops, reverse, dither, transparency and interpolation. Without colours it runs from the foreground to the background colour',
        inputSchema: {
            type: 'object',
            properties: {
                from: { ...POINT_SCHEMA, description: 'Start point, pixels from the top-left' },
                to: { ...POINT_SCHEMA, description: 'End point, pixels from the top-left' },
                type: { type: 'string', enum: ['linear', 'radial', 'angle', 'reflected', 'diamond'], description: 'Default linear' },
                colors: {
                    type: 'array', minItems: 2,
                    description: 'Colour stops. Default foreground to background',
                    items: {
                        type: 'object',
                        properties: {
                            color: { type: 'string', description: COLOR_SCHEMA.description + ', or "foreground" or "background"' },
                            location: { type: 'number', minimum: 0, maximum: 100, description: 'Percent along the gradient' },
                            midpoint: { type: 'number', minimum: 5, maximum: 95, description: 'Percent between this stop and the next. Default 50' },
                        },
                        required: ['color', 'location'],
                    },
                },
                opacities: {
                    type: 'array', minItems: 2,
                    description: 'Opacity stops. Default fully opaque throughout',
                    items: {
                        type: 'object',
                        properties: {
                            opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                            location: { type: 'number', minimum: 0, maximum: 100, description: 'Percent along the gradient' },
                            midpoint: { type: 'number', minimum: 5, maximum: 95, description: 'Default 50' },
                        },
                        required: ['opacity', 'location'],
                    },
                },
                reverse: { type: 'boolean', description: 'Reverse the colour order. Default false' },
                dither: { type: 'boolean', description: 'Dither to reduce banding. Default true' },
                transparency: { type: 'boolean', description: 'Use the opacity stops (the Transparency option). Default true' },
                interpolation: { type: 'string', enum: ['perceptual', 'linear', 'classic', 'smooth', 'stripes'], description: 'How colours blend between stops. Default perceptual' },
                blendMode: BLEND_SCHEMA,
                opacity: OPACITY_SCHEMA,
            },
            required: ['from', 'to'],
        },
        auditArgs: { from: { x: 0, y: 0 }, to: { x: 300, y: 200 }, colors: [{ color: '#FF6600', location: 0 }, { color: 'background', location: 100, midpoint: 40 }], opacities: [{ opacity: 100, location: 0 }, { opacity: 0, location: 100 }] },
        features: [
            'photoshop.painting.gradient_tool', 'photoshop.painting.gradient_tool_option.classic_gradient',
            'photoshop.painting.gradient_tool_option.linear_gradient', 'photoshop.painting.gradient_tool_option.radial_gradient',
            'photoshop.painting.gradient_tool_option.angular_gradient', 'photoshop.painting.gradient_tool_option.reflected_gradient',
            'photoshop.painting.gradient_tool_option.diamond_gradient', 'photoshop.painting.gradient_tool_option.reverse',
            'photoshop.painting.gradient_tool_option.dither', 'photoshop.painting.gradient_tool_option.transparency',
            'photoshop.painting.gradient_tool_option.perceptual', 'photoshop.painting.gradient_tool_option.linear',
            'photoshop.painting.gradient_tool_option.classic',
        ],
        handler: (a) => {
            const [x1, y1] = point(a.from, 'from');
            const [x2, y2] = point(a.to, 'to');
            if (x1 === x2 && y1 === y2) throw new Error('from and to must be different points');
            const type = enumOf(a.type ?? 'linear', ['linear', 'radial', 'angle', 'reflected', 'diamond'], { name: 'type' });
            const method = enumOf(a.interpolation ?? 'perceptual', ['perceptual', 'linear', 'classic', 'smooth', 'stripes'], { name: 'interpolation' });
            // Stop locations run 0-4096 in the descriptor.
            const loc = (v, name) => Math.round(Number(num(v, { min: 0, max: 100, name })) * 40.96);
            const mid = (v, name) => Math.round(Number(num(v ?? 50, { min: 5, max: 95, name })));
            const colors = a.colors ?? [{ color: 'foreground', location: 0 }, { color: 'background', location: 100 }];
            if (!Array.isArray(colors) || colors.length < 2) throw new Error('colors needs at least two stops');
            const opacities = a.opacities ?? [{ opacity: 100, location: 0 }, { opacity: 100, location: 100 }];
            if (!Array.isArray(opacities) || opacities.length < 2) throw new Error('opacities needs at least two stops');
            const colorLines = colors.map((s, i) => {
                if (!s || typeof s !== 'object') throw new Error(`colors[${i}] must be { color, location }`);
                const kind = s.color === 'foreground' ? 'foregroundColor' : s.color === 'background' ? 'backgroundColor' : 'userStop';
                return `__colorStop(${str(kind)}, ${colorExpr(s.color, `colors[${i}].color`)}, ${loc(s.location, `colors[${i}].location`)}, ${mid(s.midpoint, `colors[${i}].midpoint`)});`;
            });
            const opacityLines = opacities.map((s, i) => {
                if (!s || typeof s !== 'object') throw new Error(`opacities[${i}] must be { opacity, location }`);
                return `__opacityStop(${num(s.opacity, { min: 0, max: 100, name: `opacities[${i}].opacity` })}, ${loc(s.location, `opacities[${i}].location`)}, ${mid(s.midpoint, `opacities[${i}].midpoint`)});`;
            });
            // charIDs where the stringID is ambiguous: "gradient" also names the
            // gradient event, and the point, stop and RGB classes read back as
            // other words.
            return run('Draw gradient', script(`${AM}
var __colors = new ActionList(), __stops = new ActionList();
var __colorStop = function (kind, c, location, midpoint) {
  var s = new ActionDescriptor(), rgb = new ActionDescriptor();
  rgb.putDouble(cid("Rd  "), c.rgb.red);
  rgb.putDouble(cid("Grn "), c.rgb.green);
  rgb.putDouble(cid("Bl  "), c.rgb.blue);
  s.putObject(sid("color"), cid("RGBC"), rgb);
  s.putEnumerated(sid("type"), sid("colorStopType"), sid(kind));
  s.putInteger(sid("location"), location);
  s.putInteger(sid("midpoint"), midpoint);
  __colors.putObject(cid("Clrt"), s);
};
var __opacityStop = function (value, location, midpoint) {
  var s = new ActionDescriptor();
  s.putUnitDouble(sid("opacity"), sid("percentUnit"), value);
  s.putInteger(sid("location"), location);
  s.putInteger(sid("midpoint"), midpoint);
  __stops.putObject(cid("TrnS"), s);
};
${colorLines.join('\n')}
${opacityLines.join('\n')}
var g = new ActionDescriptor();
g.putString(sid("name"), "Custom");
g.putEnumerated(sid("gradientForm"), sid("gradientForm"), sid("customStops"));
g.putDouble(sid("interfaceIconFrameDimmed"), 4096);
g.putList(sid("colors"), __colors);
g.putList(sid("transparency"), __stops);
var d = new ActionDescriptor();
d.putObject(sid("from"), cid("Pnt "), __pt(${x1}, ${y1}));
d.putObject(sid("to"), cid("Pnt "), __pt(${x2}, ${y2}));
d.putEnumerated(sid("type"), sid("gradientType"), sid(${str(type)}));
d.putBoolean(sid("dither"), ${bool(a.dither ?? true)});
d.putBoolean(sid("useMask"), ${bool(a.transparency ?? true)});
${a.reverse ? 'd.putBoolean(sid("reverse"), true);' : ''}
d.putEnumerated(sid("gradientsInterpolationMethod"), sid("gradientInterpolationMethodType"), sid(${str(method)}));
d.putEnumerated(sid("mode"), sid("blendMode"), sid(${str(blend(a.blendMode))}));
d.putUnitDouble(sid("opacity"), sid("percentUnit"), ${opacity(a.opacity)});
d.putObject(cid("Grad"), cid("Grdn"), g);
app.executeAction(sid("gradientClassEvent"), d, DialogModes.NO);
__result__ = { type: ${str(type)}, from: { x: ${x1}, y: ${y1} }, to: { x: ${x2}, y: ${y2} }, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'stroke_path',
        description: 'Paint along a path on the active layer with a painting or retouching tool, using that tool\'s current brush and options (Paths panel > Stroke Path). Give a path from the Paths panel or points for a temporary one. Set the brush first with set_tool_options. Clone Stamp and Healing Brush need cloneSource',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(STROKE_TOOLS), description: 'The tool to paint with' },
                ...PATH_PROPS,
                closed: { type: 'boolean', description: 'With points: close the temporary path. Default false' },
                simulatePressure: { type: 'boolean', description: 'Taper the stroke as if drawn with a pressure-sensitive pen. Default false' },
                cloneSource: {
                    type: 'object',
                    description: 'Clone Stamp and Healing Brush: where to sample from, as Alt-clicking does',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, layer: { type: 'string', description: 'Layer to sample. Default the active layer' } },
                    required: ['x', 'y'],
                },
            },
            required: ['tool'],
        },
        auditArgs: { path: undefined, tool: 'clone_stamp', points: [[10, 10], [200, 120], [60, 180]], cloneSource: { x: 40, y: 40 } },
        features: [
            'photoshop.painting.stroke_path', 'photoshop.painting.stroke_path_option.simulate_pressure',
            'photoshop.painting.brush_tool', 'photoshop.painting.pencil_tool', 'photoshop.painting.color_replacement_tool', 'photoshop.painting.art_history_brush_tool',
            'photoshop.painting.eraser_tool', 'photoshop.painting.background_eraser_tool',
            'photoshop.retouching.healing_brush_tool', 'photoshop.retouching.clone_stamp_tool', 'photoshop.retouching.pattern_stamp_tool',
            'photoshop.retouching.blur_tool', 'photoshop.retouching.sharpen_tool', 'photoshop.retouching.smudge_tool',
            'photoshop.retouching.dodge_tool', 'photoshop.retouching.burn_tool', 'photoshop.retouching.sponge_tool',
        ],
        handler: (a) => {
            const tool = enumOf(a.tool, Object.keys(STROKE_TOOLS), { name: 'tool' });
            const sampled = tool === 'clone_stamp' || tool === 'healing_brush';
            if (sampled && !a.cloneSource) throw new Error(`${tool} needs cloneSource: the point to sample from`);
            if (!sampled && a.cloneSource) throw new Error('cloneSource applies only to clone_stamp and healing_brush');
            if (a.closed !== undefined && a.points === undefined) throw new Error('closed applies only to points');
            let source = '';
            if (sampled) {
                const [sx, sy] = point(a.cloneSource, 'cloneSource');
                source = `
var cs = new ActionDescriptor(), csRef = new ActionReference(), csTo = new ActionDescriptor(), csLayer = new ActionReference();
csRef.putProperty(cid("Prpr"), cid("ClnS"));
csRef.putEnumerated(cid("capp"), cid("Ordn"), cid("Trgt"));
cs.putReference(cid("null"), csRef);
csLayer.putName(cid("Lyr "), ${a.cloneSource.layer !== undefined ? str(a.cloneSource.layer) : 'doc.activeLayer.name'});
csTo.putReference(cid("Srce"), csLayer);
csTo.putObject(cid("Pstn"), cid("Pnt "), __pt(${sx}, ${sy}));
cs.putObject(cid("T   "), cid("ImgP"), csTo);
app.executeAction(cid("setd"), cs, DialogModes.NO);`;
            }
            return run('Stroke path', script(`${AM}
${pathStart(a, { closed: !!a.closed })}
var __prevTool = app.currentTool;
try {
  __path.select();
  app.currentTool = ${str(STROKE_TOOLS[tool])};
  ${source}
  var ref = new ActionReference(), d = new ActionDescriptor();
  ref.putEnumerated(sid("path"), sid("ordinal"), sid("targetEnum"));
  d.putReference(sid("null"), ref);
  d.putClass(sid("using"), sid(${str(STROKE_TOOLS[tool])}));
  ${a.simulatePressure ? 'd.putBoolean(sid("pressure"), true);' : ''}
  app.executeAction(sid("stroke"), d, DialogModes.NO);
} finally {
  try { app.currentTool = __prevTool; } catch (e) {}
  ${PATH_END}
}
__result__ = { tool: ${str(tool)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'fill_path',
        description: 'Fill the area inside a path on the active layer with a colour (Paths panel > Fill Path), with blend mode, opacity, feather and anti-aliasing. Give a path from the Paths panel or points for a temporary one',
        inputSchema: {
            type: 'object',
            properties: {
                ...PATH_PROPS,
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Default the foreground colour' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Default normal' },
                opacity: OPACITY_SCHEMA,
                preserveTransparency: { type: 'boolean', description: 'Default false' },
                feather: { type: 'number', minimum: 0, maximum: 250, description: 'Pixels. Default 0' },
                antiAlias: { type: 'boolean', description: 'Default true' },
            },
        },
        auditArgs: { path: undefined, points: [[10, 10], [200, 10], [100, 150]], color: '#336699' },
        features: ['photoshop.painting.fill_path'],
        handler: (a) => run('Fill path', script(`
${pathStart(a, { closed: true })}
try {
  __path.fillPath(${colorExpr(a.color, 'color')}, ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${opacity(a.opacity)}, ${bool(a.preserveTransparency)}, ${num(a.feather ?? 0, { min: 0, max: 250, name: 'feather' })}, ${bool(a.antiAlias ?? true)}, true);
} finally {
  ${PATH_END}
}
__result__ = { layer: __layerInfo(doc.activeLayer) };`)),
    },
    {
        name: 'fill_at_point',
        description: 'Fill (Paint Bucket tool) or erase (Magic Eraser tool) the area of similar colour around a point on the active layer, within the selection if there is one. Erasing on the Background layer turns it into an ordinary layer, as the Magic Eraser does',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['fill', 'erase'] },
                x: { type: 'number', description: 'Pixels from the left' },
                y: { type: 'number', description: 'Pixels from the top' },
                tolerance: { type: 'integer', minimum: 0, maximum: 255, description: 'How different a colour may be and still be included. Default 32' },
                contiguous: { type: 'boolean', description: 'Only connected pixels. Default true' },
                antiAlias: { type: 'boolean', description: 'Smooth the edge. Default true' },
                sampleAllLayers: { type: 'boolean', description: 'Judge colours from all visible layers. Default false' },
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Fill only. Default the foreground colour' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Fill only. Default normal' },
                opacity: OPACITY_SCHEMA,
            },
            required: ['action', 'x', 'y'],
        },
        auditArgs: { color: '#FF6600' },
        features: ['photoshop.painting.paint_bucket_tool', 'photoshop.painting.magic_eraser_tool'],
        handler: (a) => {
            const action = enumOf(a.action, ['fill', 'erase'], { name: 'action' });
            if (action === 'erase' && (a.color !== undefined || a.blendMode !== undefined)) throw new Error('color and blendMode apply only to fill');
            const x = num(a.x, { name: 'x' }), y = num(a.y, { name: 'y' });
            const mode = action === 'erase' ? 'CLEAR' : FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })];
            return run(action === 'fill' ? 'Paint bucket' : 'Magic eraser', script(`${AM}
var l = doc.activeLayer;
${action === 'erase' ? 'if (l.typename === "ArtLayer" && l.isBackgroundLayer) l.isBackgroundLayer = false;' : ''}
var __prior = null, __chans = doc.activeChannels;
if (__hasSelection()) {
  __prior = doc.channels.add();
  __prior.name = "Temporary selection";
  doc.selection.store(__prior, SelectionType.REPLACE);
  doc.activeChannels = __chans;
}
try {
  var ref = new ActionReference(), d = new ActionDescriptor();
  ref.putProperty(sid("channel"), sid("selection"));
  d.putReference(sid("null"), ref);
  d.putObject(sid("to"), cid("Pnt "), __pt(${x}, ${y}));
  d.putInteger(sid("tolerance"), ${num(a.tolerance ?? 32, { min: 0, max: 255, name: 'tolerance' })});
  d.putBoolean(sid("antiAlias"), ${bool(a.antiAlias ?? true)});
  ${a.contiguous === false ? 'd.putBoolean(sid("contiguous"), false);' : ''}
  ${a.sampleAllLayers ? 'd.putBoolean(sid("merged"), true);' : ''}
  app.executeAction(sid("set"), d, DialogModes.NO);
  if (__prior) doc.selection.load(__prior, SelectionType.INTERSECT, false);
  doc.selection.fill(${action === 'fill' ? colorExpr(a.color, 'color') : 'app.foregroundColor'}, ColorBlendMode.${mode}, ${opacity(a.opacity)}, false);
} finally {
  if (__prior) {
    doc.selection.load(__prior, SelectionType.REPLACE, false);
    __prior.remove();
    doc.activeChannels = __chans;
  } else {
    doc.selection.deselect();
  }
}
__result__ = { action: ${str(action)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'set_tool_options',
        description: 'Choose the active tool and set its brush: a brush preset (Brushes panel), size, hardness, opacity and flow (options bar), and the painting cursor style (Preferences > Cursors). stroke_path paints with these settings. Returns the tool\'s options afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(ACTIVE_TOOLS), description: 'Tool to make active. Default the current tool' },
                preset: { type: 'string', description: 'Brush preset name, as the Brushes panel lists it' },
                size: { type: 'number', minimum: 1, maximum: 5000, description: 'Brush diameter in pixels' },
                hardness: { type: 'number', minimum: 0, maximum: 100, description: 'Brush hardness, percent' },
                opacity: { type: 'integer', minimum: 1, maximum: 100, description: 'Tool opacity, percent' },
                flow: { type: 'integer', minimum: 1, maximum: 100, description: 'Tool flow, percent' },
                paintingCursors: { type: 'string', enum: ['standard', 'precise', 'brush_size'], description: 'How painting cursors look' },
            },
        },
        features: [
            'photoshop.painting.brushes_panel', 'photoshop.painting.brush_tool_option.size', 'photoshop.painting.brush_tool_option.hardness',
            'photoshop.painting.brush_tool_option.opacity', 'photoshop.painting.brush_tool_option.flow', 'photoshop.painting.painting_cursors',
        ],
        handler: (a) => {
            const keys = ['tool', 'preset', 'size', 'hardness', 'opacity', 'flow', 'paintingCursors'].filter((k) => a[k] !== undefined);
            const lines = [];
            if (a.tool !== undefined) lines.push(`app.currentTool = ${str(ACTIVE_TOOLS[enumOf(a.tool, Object.keys(ACTIVE_TOOLS), { name: 'tool' })])};`);
            if (a.preset !== undefined) {
                if (typeof a.preset !== 'string' || !a.preset) throw new Error("'preset' must be a brush preset name");
                lines.push(`var pr = new ActionReference(), pd = new ActionDescriptor();
pr.putName(sid("brush"), ${str(a.preset)});
pd.putReference(sid("null"), pr);
app.executeAction(sid("select"), pd, DialogModes.NO);`);
            }
            if (a.size !== undefined || a.hardness !== undefined) {
                lines.push(`var br = new ActionReference(), bd = new ActionDescriptor(), tip = new ActionDescriptor();
br.putEnumerated(sid("brush"), sid("ordinal"), sid("targetEnum"));
bd.putReference(sid("null"), br);
${a.size !== undefined ? `tip.putUnitDouble(sid("masterDiameter"), sid("pixelsUnit"), ${num(a.size, { min: 1, max: 5000, name: 'size' })});` : ''}
${a.hardness !== undefined ? `tip.putUnitDouble(sid("hardness"), sid("percentUnit"), ${num(a.hardness, { min: 0, max: 100, name: 'hardness' })});` : ''}
bd.putObject(sid("to"), sid("brush"), tip);
app.executeAction(sid("set"), bd, DialogModes.NO);`);
            }
            if (a.opacity !== undefined || a.flow !== undefined) {
                const intIn = (v, name) => {
                    const s = num(v, { min: 1, max: 100, name });
                    if (!Number.isInteger(Number(s))) throw new Error(`'${name}' must be a whole percent`);
                    return s;
                };
                lines.push(`var o = __toolOptions();
${a.opacity !== undefined ? `o.putInteger(sid("opacity"), ${intIn(a.opacity, 'opacity')});` : ''}
${a.flow !== undefined ? `o.putInteger(sid("flow"), ${intIn(a.flow, 'flow')});` : ''}
var sr = new ActionReference(), sd = new ActionDescriptor();
sr.putProperty(sid("property"), sid("currentToolOptions"));
sr.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
sd.putReference(sid("null"), sr);
sd.putObject(sid("to"), sid("currentToolOptions"), o);
app.executeAction(sid("set"), sd, DialogModes.NO);`);
            }
            if (a.paintingCursors !== undefined) {
                lines.push(`app.preferences.paintingCursors = PaintingCursors.${{ standard: 'STANDARD', precise: 'PRECISE', brush_size: 'BRUSHSIZE' }[enumOf(a.paintingCursors, ['standard', 'precise', 'brush_size'], { name: 'paintingCursors' })]};`);
            }
            if (!keys.length) throw new Error('Give tool, preset, size, hardness, opacity, flow or paintingCursors');
            return run('Set tool options', script(`${AM}
var __toolOptions = function () {
  var r = new ActionReference();
  r.putProperty(sid("property"), sid("currentToolOptions"));
  r.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
  return app.executeActionGet(r).getObjectValue(sid("currentToolOptions"));
};
${lines.join('\n')}
var now = __toolOptions(), out = { tool: app.currentTool };
if (now.hasKey(sid("opacity"))) out.opacity = now.getInteger(sid("opacity"));
if (now.hasKey(sid("flow"))) out.flow = now.getInteger(sid("flow"));
if (now.hasKey(sid("brush"))) {
  var tipNow = now.getObjectValue(sid("brush"));
  if (tipNow.hasKey(sid("masterDiameter"))) out.size = tipNow.getUnitDoubleValue(sid("masterDiameter"));
  if (tipNow.hasKey(sid("hardness"))) out.hardness = tipNow.getUnitDoubleValue(sid("hardness"));
}
out.paintingCursors = __enumName(app.preferences.paintingCursors);
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_brushes',
        description: 'Load a brush file (.abr) as the current tool\'s brush (Brushes panel > Import Brushes), save the current tool\'s brush to a file (Export Selected Brushes), or define a brush preset from the selection, or the whole image when nothing is selected (Edit > Define Brush Preset)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['import', 'export', 'define'] },
                filePath: { type: 'string', description: 'Import or export: absolute path to a .abr file' },
                name: { type: 'string', description: 'Define: the new preset\'s name' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'export', filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit.abr`, name: undefined },
        features: ['photoshop.painting.brushes_panel_option.import_brushes', 'photoshop.painting.brushes_panel_option.export_selected_brushes', 'photoshop.painting.define_brush_preset'],
        handler: (a) => {
            const action = enumOf(a.action, ['import', 'export', 'define'], { name: 'action' });
            if (action === 'define') {
                if (a.filePath !== undefined) throw new Error('filePath applies only to import and export');
                if (typeof a.name !== 'string' || !a.name) throw new Error('define needs a name for the preset');
                return run('Define brush preset', script(`${AM}
var d = new ActionDescriptor(), ref = new ActionReference(), src = new ActionReference();
ref.putClass(sid("brush"));
d.putReference(sid("null"), ref);
d.putString(sid("name"), ${str(a.name)});
src.putProperty(sid("property"), sid("selection"));
src.putEnumerated(sid("document"), sid("ordinal"), sid("targetEnum"));
d.putReference(sid("using"), src);
app.executeAction(sid("make"), d, DialogModes.NO);
__result__ = { action: "define", name: ${str(a.name)} };`));
            }
            if (a.name !== undefined) throw new Error('name applies only to define');
            if (typeof a.filePath !== 'string' || !/\.abr$/i.test(a.filePath)) throw new Error('filePath must be an absolute path ending in .abr');
            const p = paths.validate(a.filePath);
            return run(action === 'import' ? 'Import brushes' : 'Export brushes', script(`
var f = new File(${jsxPath(p)});
${action === 'import' ? `if (!f.exists) throw new Error("File not found: " + f.fsName);
app.applyToolBrushFromFile(f);` : 'app.saveToolBrushToFile(f);'}
__result__ = { action: ${str(action)}, file: f.fsName, tool: app.currentTool };`, { needsDocument: false }));
        },
    },
    {
        name: 'retouch_selection',
        description: 'Repair or move the selected area on the active pixel layer by an offset: patch it from nearby pixels (Patch tool, Normal or Content-Aware), or move or extend it and fill the gap (Content-Aware Move tool). Needs a selection; dx and dy are the drag in pixels',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: ['patch', 'content_aware_move'] },
                dx: { type: 'number', description: 'Horizontal offset in pixels, positive to the right' },
                dy: { type: 'number', description: 'Vertical offset in pixels, positive downward' },
                patchMode: { type: 'string', enum: ['content_aware', 'normal'], description: 'Patch: how the patch blends. Default content_aware' },
                patchFrom: { type: 'string', enum: ['source', 'destination'], description: 'Patch: source repairs the selection with the pixels at the offset; destination copies the selection to the offset. Default source' },
                transparent: { type: 'boolean', description: 'Patch: blend the sampled texture transparently. Default false' },
                moveMode: { type: 'string', enum: ['move', 'extend'], description: 'Content-Aware Move: move the content, or extend (duplicate) it. Default move' },
                structure: STRUCTURE_SCHEMA,
                color: COLOR_ADAPT_SCHEMA,
                sampleAllLayers: { type: 'boolean', description: 'Sample all visible layers. Default false' },
            },
            required: ['method', 'dx', 'dy'],
        },
        auditArgs: { method: 'patch', moveMode: undefined, structure: 5, color: 5 },
        features: [
            'photoshop.retouching.patch_tool', 'photoshop.retouching.patch_tool_option.normal', 'photoshop.retouching.patch_tool_option.content_aware',
            'photoshop.retouching.patch_tool_option.transparent', 'photoshop.retouching.patch_tool_option.structure', 'photoshop.retouching.patch_tool_option.color',
            'photoshop.retouching.patch_tool_option.sample_all_layers',
            'photoshop.retouching.content_aware_move_tool', 'photoshop.retouching.content_aware_move_tool_option.move', 'photoshop.retouching.content_aware_move_tool_option.extend',
            'photoshop.retouching.content_aware_move_tool_option.structure', 'photoshop.retouching.content_aware_move_tool_option.color',
            'photoshop.retouching.content_aware_move_tool_option.sample_all_layers',
        ],
        handler: (a) => {
            const method = enumOf(a.method, ['patch', 'content_aware_move'], { name: 'method' });
            const patch = method === 'patch';
            const dx = num(a.dx, { min: -30000, max: 30000, name: 'dx' }), dy = num(a.dy, { min: -30000, max: 30000, name: 'dy' });
            if (Number(dx) === 0 && Number(dy) === 0) throw new Error('dx and dy cannot both be 0');
            const wrong = (patch ? ['moveMode'] : ['patchMode', 'patchFrom', 'transparent']).filter((k) => a[k] !== undefined);
            if (wrong.length) throw new Error(`${wrong.join(', ')} do not apply to ${method}`);
            const structure = num(a.structure ?? (patch ? 5 : 4), { min: 1, max: 7, name: 'structure' });
            const color = num(a.color ?? 5, { min: 0, max: 10, name: 'color' });
            if (!Number.isInteger(Number(structure)) || !Number.isInteger(Number(color))) throw new Error('structure and color are whole numbers');
            const lines = patch ? `
d.putObject(sid("from"), sid("offset"), off);
d.putBoolean(sid("transparency"), ${bool(a.transparent)});
d.putEnumerated(sid("patchMode"), sid("patchModeType"), sid(${str(enumOf(a.patchMode ?? 'content_aware', ['content_aware', 'normal'], { name: 'patchMode' }) === 'normal' ? 'patchNormal' : 'patchContentAware')}));
d.putBoolean(sid("reshuffle"), false);
d.putBoolean(sid("sampleAllLayers"), ${bool(a.sampleAllLayers)});
d.putInteger(sid("patchStructureAdapt"), ${structure});
d.putInteger(sid("patchColorAdaptation"), ${color});
d.putInteger(sid("healSmoothFactor"), 5);
d.putBoolean(sid("useSource"), ${bool(enumOf(a.patchFrom ?? 'source', ['source', 'destination'], { name: 'patchFrom' }) === 'source')});
app.executeAction(sid("patchSelection"), d, DialogModes.NO);` : `
d.putObject(sid("to"), sid("offset"), off);
d.putBoolean(sid("transparency"), false);
d.putEnumerated(sid("patchMode"), sid("patchModeType"), sid("patchContentAware"));
d.putEnumerated(sid("remixMode"), sid("remixModeType"), sid(${str(enumOf(a.moveMode ?? 'move', ['move', 'extend'], { name: 'moveMode' }) === 'extend' ? 'remixExtend' : 'remixMove')}));
d.putBoolean(sid("reshuffle"), true);
d.putBoolean(sid("clone"), false);
d.putBoolean(sid("sampleAllLayers"), ${bool(a.sampleAllLayers)});
d.putBoolean(sid("transformOnDrop"), false);
d.putInteger(sid("patchStructureAdapt"), ${structure});
d.putInteger(sid("patchColorAdaptation"), ${color});
d.putInteger(sid("healSmoothFactor"), 5);
d.putBoolean(sid("useSource"), false);
app.executeAction(sid("recomposeSelection"), d, DialogModes.NO);`;
            return run(patch ? 'Patch' : 'Content-Aware Move', script(`${AM}
if (!__hasSelection()) throw new Error("Select the area to ${patch ? 'patch' : 'move'} first");
var l = doc.activeLayer;
if (l.typename !== "ArtLayer" || l.kind !== LayerKind.NORMAL) throw new Error(l.name + " is not a pixel layer; rasterize it first");
var ref = new ActionReference(), d = new ActionDescriptor(), off = new ActionDescriptor();
ref.putProperty(sid("channel"), sid("selection"));
d.putReference(sid("null"), ref);
off.putUnitDouble(sid("horizontal"), sid("pixelsUnit"), ${dx});
off.putUnitDouble(sid("vertical"), sid("pixelsUnit"), ${dy});
${lines}
__result__ = { method: ${str(method)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
];
