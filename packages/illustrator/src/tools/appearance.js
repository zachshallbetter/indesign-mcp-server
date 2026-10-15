/**
 * Fill, stroke, opacity, swatches and gradients.
 */
import { str, num, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const CAPS = { butt: 'BUTTENDCAP', round: 'ROUNDENDCAP', projecting: 'PROJECTINGENDCAP' };
const JOINS = { miter: 'MITERENDJOIN', round: 'ROUNDENDJOIN', bevel: 'BEVELENDJOIN' };
const BLEND = ['NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'SOFTLIGHT', 'HARDLIGHT', 'COLORDODGE', 'COLORBURN', 'DARKEN', 'LIGHTEN', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATIONBLEND', 'COLORBLEND', 'LUMINOSITY'];

/**
 * Apply `fn` (a JSX function source taking a PathItem) to every path inside
 * the targets: plain paths, the paths of compound paths, and paths nested in
 * groups. Text frames are reported separately.
 */
const EACH_PATH = `
function __eachPath(it, fn, counts) {
  if (it.typename === "PathItem") { fn(it); counts.paths++; return; }
  if (it.typename === "CompoundPathItem") { for (var i = 0; i < it.pathItems.length; i++) { fn(it.pathItems[i]); counts.paths++; } return; }
  if (it.typename === "GroupItem") { for (var j = 0; j < it.pageItems.length; j++) __eachPath(it.pageItems[j], fn, counts); return; }
  counts.skipped.push(it.typename);
}`;

export const tools = [
    {
        name: 'set_fill',
        description: 'Set the fill of paths, compound paths, groups (every path inside) and text frames. "none" removes the fill',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, color: COLOR_SCHEMA }, required: ['target', 'color'] },
        features: [
            'illustrator.appearance.fill',
            'illustrator.appearance.remove_fill_stroke',
            'illustrator.color.no_color',
            'illustrator.typography.character.character_fill_color',
        ],
        handler: (a) => {
            const spec = colorSpec(a.color, 'color');
            const none = JSON.parse(spec).kind === 'none';
            return run('Set fill', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, text: 0, skipped: [] }, c = __color(doc, ${spec});
for (var i = 0; i < items.length; i++) {
  if (items[i].typename === "TextFrame") { items[i].textRange.characterAttributes.fillColor = c; counts.text++; continue; }
  __eachPath(items[i], function (p) { ${none ? 'p.filled = false;' : 'p.filled = true; p.fillColor = c;'} }, counts);
}
__result__ = counts;`));
        },
    },
    {
        name: 'set_stroke',
        description: 'Set the stroke of paths, compound paths and groups: colour, weight, caps, joins and dashes',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                color: COLOR_SCHEMA,
                weight: { type: 'number', minimum: 0, description: 'Points' },
                cap: { type: 'string', enum: Object.keys(CAPS) },
                join: { type: 'string', enum: Object.keys(JOINS) },
                miterLimit: { type: 'number', minimum: 1, maximum: 500 },
                dashes: { type: 'array', items: { type: 'number', minimum: 0 }, maxItems: 6, description: 'Dash and gap lengths in points, e.g. [12, 6]. [] for a solid line' },
                dashOffset: { type: 'number' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_panel',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.stroke_option.cap',
            'illustrator.appearance.stroke_option.corner',
            'illustrator.appearance.stroke_option.limit',
            'illustrator.appearance.stroke_option.dashed_line',
            'illustrator.appearance.remove_fill_stroke',
            'illustrator.color.no_color',
        ],
        handler: (a) => {
            const lines = [];
            if (a.color !== undefined) {
                const spec = colorSpec(a.color, 'color');
                lines.push(JSON.parse(spec).kind === 'none' ? 'p.stroked = false;' : `p.stroked = true; p.strokeColor = __color(doc, ${spec});`);
            }
            if (a.weight !== undefined) lines.push(`p.strokeWidth = __len(doc, ${num(a.weight, { min: 0, max: 1000, name: 'weight' })});`);
            if (a.cap) lines.push(`p.strokeCap = StrokeCap.${CAPS[enumOf(a.cap, Object.keys(CAPS), { name: 'cap' })]};`);
            if (a.join) lines.push(`p.strokeJoin = StrokeJoin.${JOINS[enumOf(a.join, Object.keys(JOINS), { name: 'join' })]};`);
            if (a.miterLimit !== undefined) lines.push(`p.strokeMiterLimit = ${num(a.miterLimit, { min: 1, max: 500, name: 'miterLimit' })};`);
            if (a.dashes !== undefined) {
                if (!Array.isArray(a.dashes)) throw new Error("'dashes' must be a list of numbers");
                lines.push(`p.strokeDashes = ${json(a.dashes.map((d) => Number(num(d, { min: 0, max: 1000, name: 'dashes' }))))};`);
            }
            if (a.dashOffset !== undefined) lines.push(`p.strokeDashOffset = ${num(a.dashOffset, { name: 'dashOffset' })};`);
            if (!lines.length) throw new Error('Give at least one of color, weight, cap, join, miterLimit, dashes, dashOffset');
            return run('Set stroke', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] };
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  ${lines.join('\n  ')}
}, counts);
__result__ = counts;`));
        },
    },
    {
        name: 'set_opacity',
        description: 'Set the opacity and blending mode of items',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                opacity: { type: 'number', minimum: 0, maximum: 100 },
                blendMode: { type: 'string', enum: BLEND },
            },
            required: ['target'],
        },
        features: [
            'illustrator.appearance.transparency_panel',
            'illustrator.appearance.opacity',
            'illustrator.appearance.blending_mode',
            'illustrator.appearance.blend_mode.normal',
            'illustrator.appearance.blend_mode.darken',
            'illustrator.appearance.blend_mode.multiply',
            'illustrator.appearance.blend_mode.color_burn',
            'illustrator.appearance.blend_mode.lighten',
            'illustrator.appearance.blend_mode.screen',
            'illustrator.appearance.blend_mode.color_dodge',
            'illustrator.appearance.blend_mode.overlay',
            'illustrator.appearance.blend_mode.soft_light',
            'illustrator.appearance.blend_mode.hard_light',
            'illustrator.appearance.blend_mode.difference',
            'illustrator.appearance.blend_mode.exclusion',
            'illustrator.appearance.blend_mode.hue',
            'illustrator.appearance.blend_mode.saturation',
            'illustrator.appearance.blend_mode.color',
            'illustrator.appearance.blend_mode.luminosity',
        ],
        handler: (a) => run('Set opacity', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  ${a.opacity !== undefined ? `items[i].opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};` : ''}
  ${a.blendMode ? `items[i].blendingMode = BlendModes.${enumOf(a.blendMode, BLEND, { name: 'blendMode' })};` : ''}
}
__result__ = { updated: items.length };`)),
    },
    {
        name: 'get_appearance',
        description: 'Read the fill, stroke, opacity and blending mode of items',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: [
            'illustrator.appearance.appearance_panel',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.opacity',
            'illustrator.appearance.blending_mode',
        ],
        handler: (a) => run('Get appearance', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], info = __itemInfo(doc, it);
  info.opacity = it.opacity;
  info.blendMode = String(it.blendingMode).replace("BlendModes.", "");
  if (it.typename === "PathItem") {
    info.fill = it.filled ? __colorInfo(it.fillColor) : { kind: "none" };
    info.stroke = it.stroked ? __colorInfo(it.strokeColor) : { kind: "none" };
    info.strokeWeight = it.strokeWidth * __sf(doc);
    info.dashes = it.strokeDashes;
  } else if (it.typename === "TextFrame") {
    info.fill = __colorInfo(it.textRange.characterAttributes.fillColor);
  }
  out.push(info);
}
__result__ = out;`)),
    },

    // Swatches
    {
        name: 'list_swatches',
        description: 'List the document\'s swatches with their colour values',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.color.swatches_panel', 'illustrator.color.swatch_object'],
        handler: () => run('List swatches', script(`
var out = [];
for (var i = 0; i < doc.swatches.length; i++) {
  var s = doc.swatches[i];
  out.push({ name: s.name, color: __colorInfo(s.color) });
}
__result__ = { colorMode: String(doc.documentColorSpace).replace("DocumentColorSpace.", ""), swatches: out };`)),
    },
    {
        name: 'create_swatch',
        description: 'Add a process swatch, or a spot colour (for an ink such as a Pantone colour or a varnish plate). The colour must be rgb(), cmyk(), gray() or #RRGGBB',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                color: { ...COLOR_SCHEMA, description: '"cmyk(c,m,y,k)", "rgb(r,g,b)", "#RRGGBB" or "gray(g)"' },
                spot: { type: 'boolean', description: 'Create a spot colour. Default false', default: false },
            },
            required: ['name', 'color'],
        },
        features: [
            'illustrator.color.new_swatch',
            'illustrator.color.swatch_object',
            'illustrator.color.add_colors_to_swatches',
            'illustrator.color.process_swatches',
            'illustrator.color.spot_swatches',
            'illustrator.color.spot_color',
            'illustrator.color.rgb_color',
            'illustrator.color.cmyk_color',
            'illustrator.color.gray_color',
        ],
        handler: (a) => {
            const spec = colorSpec(a.color, 'color');
            if (['swatch', 'none'].includes(JSON.parse(spec).kind)) throw new Error("'color' must be a colour value, not a swatch name or none");
            return run('Create swatch', script(a.spot ? `
var existing = null;
try { existing = doc.spots.getByName(${str(a.name)}); } catch (e) { existing = null; }
if (existing) throw new Error("A spot colour named " + ${str(a.name)} + " already exists");
var sp = doc.spots.add();
sp.name = ${str(a.name)};
sp.color = __color(doc, ${spec});
sp.colorType = ColorModel.SPOT;
__result__ = { name: sp.name, spot: true, color: __colorInfo(sp.color) };` : `
var existing = null;
try { existing = doc.swatches.getByName(${str(a.name)}); } catch (e) { existing = null; }
if (existing) throw new Error("A swatch named " + ${str(a.name)} + " already exists");
var sw = doc.swatches.add();
sw.name = ${str(a.name)};
sw.color = __color(doc, ${spec});
__result__ = { name: sw.name, spot: false, color: __colorInfo(sw.color) };`));
        },
    },
    {
        name: 'create_gradient',
        description: 'Add a linear or radial gradient swatch from colour stops, and optionally apply it as the fill of items',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['linear', 'radial'], default: 'linear' },
                stops: {
                    type: 'array', minItems: 2,
                    items: {
                        type: 'object',
                        properties: {
                            color: { ...COLOR_SCHEMA, description: 'Colour value or swatch name' },
                            position: { type: 'number', minimum: 0, maximum: 100, description: 'Where the stop sits, 0-100' },
                            opacity: { type: 'number', minimum: 0, maximum: 100 },
                        },
                        required: ['color', 'position'],
                    },
                },
                applyTo: TARGET_SCHEMA,
                angle: { type: 'number', description: 'Angle in degrees for linear gradients applied to items' },
            },
            required: ['name', 'stops'],
        },
        features: [
            'illustrator.color.gradient_panel',
            'illustrator.color.gradient_swatches',
            'illustrator.color.gradient_object',
            'illustrator.color.gradient_stop',
            'illustrator.color.linear_gradient',
            'illustrator.color.radial_gradient',
            'illustrator.color.gradient_angle_origin',
        ],
        handler: (a) => {
            if (!Array.isArray(a.stops) || a.stops.length < 2) throw new Error("'stops' needs at least two stops");
            const stops = a.stops.map((s, i) => `{ c: ${colorSpec(s.color, `stops[${i}].color`)}, p: ${num(s.position, { min: 0, max: 100, name: `stops[${i}].position` })}, o: ${num(s.opacity ?? 100, { min: 0, max: 100, name: `stops[${i}].opacity` })} }`);
            return run('Create gradient', script(`
var g = doc.gradients.add();
g.name = ${str(a.name)};
g.type = GradientType.${a.type === 'radial' ? 'RADIAL' : 'LINEAR'};
var stops = [${stops.join(', ')}];
while (g.gradientStops.length < stops.length) g.gradientStops.add();
for (var i = 0; i < stops.length; i++) {
  var gs = g.gradientStops[i];
  gs.color = __color(doc, stops[i].c);
  gs.rampPoint = stops[i].p;
  gs.opacity = stops[i].o;
}
var applied = 0;
${a.applyTo ? `
var items = __targets(doc, ${targetSpec(a.applyTo)});
for (var k = 0; k < items.length; k++) {
  if (items[k].typename !== "PathItem") continue;
  var gc = new GradientColor();
  gc.gradient = g;
  items[k].filled = true;
  items[k].fillColor = gc;
  ${a.angle !== undefined ? `items[k].rotate(${num(a.angle, { min: -360, max: 360, name: 'angle' })}, false, false, true, false, Transformation.CENTER);` : ''}
  applied++;
}` : ''}
__result__ = { name: g.name, stops: g.gradientStops.length, applied: applied };`));
        },
    },
];
