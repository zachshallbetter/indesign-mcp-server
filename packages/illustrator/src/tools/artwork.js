/**
 * Shapes, paths and text.
 */
import { str, num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const JUSTIFICATION = ['LEFT', 'CENTER', 'RIGHT', 'FULLJUSTIFY', 'FULLJUSTIFYLASTLINELEFT', 'FULLJUSTIFYLASTLINECENTER', 'FULLJUSTIFYLASTLINERIGHT'];

/** Style properties every drawing tool accepts. */
export const STYLE_PROPS = {
    fill: { ...COLOR_SCHEMA, description: `Fill. ${COLOR_SCHEMA.description}` },
    stroke: { ...COLOR_SCHEMA, description: `Stroke colour. ${COLOR_SCHEMA.description}` },
    strokeWeight: { type: 'number', minimum: 0, description: 'Stroke weight in points' },
    opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Opacity, 0-100' },
    layer: { type: 'string', description: 'Layer to draw on. Default: the active layer' },
    name: { type: 'string', description: 'Name for the new item (shown in the Layers panel)' },
};

export const PLACEMENT_PROPS = { artboardIndex: ARTBOARD_SCHEMA };

/** JSX statements applying the common style arguments to `it`. */
export function styleStatements(a) {
    const lines = [];
    if (a.fill !== undefined) {
        const spec = colorSpec(a.fill, 'fill');
        lines.push(JSON.parse(spec).kind === 'none' ? 'it.filled = false;' : `it.filled = true; it.fillColor = __color(doc, ${spec});`);
    }
    if (a.stroke !== undefined) {
        const spec = colorSpec(a.stroke, 'stroke');
        lines.push(JSON.parse(spec).kind === 'none' ? 'it.stroked = false;' : `it.stroked = true; it.strokeColor = __color(doc, ${spec});`);
    }
    if (a.strokeWeight !== undefined) lines.push(`it.strokeWidth = __len(doc, ${num(a.strokeWeight, { min: 0, max: 1000, name: 'strokeWeight' })});`);
    if (a.opacity !== undefined) lines.push(`it.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
    if (a.name) lines.push(`it.name = ${str(a.name)};`);
    return lines.join('\n');
}

/** Body prefix: the target layer and artboard. */
export function placement(a) {
    return `
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
if (layer.locked || !layer.visible) throw new Error("Layer " + layer.name + " is locked or hidden");
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});`;
}

const xy = (a, x = 'x', y = 'y') => `__toDoc(doc, ab, ${num(a[x], { name: x })}, ${num(a[y], { name: y })})`;

export const tools = [
    {
        name: 'create_rectangle',
        description: 'Draw a rectangle, optionally with rounded corners. x and y are the top-left corner in points from the artboard\'s top-left',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                x: { type: 'number' }, y: { type: 'number' },
                width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 },
                cornerRadius: { type: 'number', minimum: 0, description: 'Corner radius in points. Default 0' },
                ...STYLE_PROPS,
            },
            required: ['x', 'y', 'width', 'height'],
        },
        features: [
            'illustrator.shapes.rectangle_tool',
            'illustrator.shapes.rounded_rectangle_tool',
            'illustrator.shapes.rectangle_option.width_rectangle',
            'illustrator.shapes.rectangle_option.height_rectangle',
            'illustrator.shapes.rounded_rect_option.corner_radius_rounded_rectangle',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        handler: (a) => run('Create rectangle', script(`${placement(a)}
var p = ${xy(a)};
var w = __len(doc, ${num(a.width, { min: 0, name: 'width' })}), h = __len(doc, ${num(a.height, { min: 0, name: 'height' })});
var r = __len(doc, ${num(a.cornerRadius ?? 0, { min: 0, name: 'cornerRadius' })});
var it = r > 0 ? layer.pathItems.roundedRectangle(p[1], p[0], w, h, r, r) : layer.pathItems.rectangle(p[1], p[0], w, h);
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`)),
    },
    {
        name: 'create_ellipse',
        description: 'Draw an ellipse inside the box whose top-left corner is x, y',
        inputSchema: {
            type: 'object',
            properties: { ...PLACEMENT_PROPS, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 }, ...STYLE_PROPS },
            required: ['x', 'y', 'width', 'height'],
        },
        features: [
            'illustrator.shapes.ellipse_tool',
            'illustrator.shapes.ellipse_option.width_ellipse',
            'illustrator.shapes.ellipse_option.height_ellipse',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        handler: (a) => run('Create ellipse', script(`${placement(a)}
var p = ${xy(a)};
var it = layer.pathItems.ellipse(p[1], p[0], __len(doc, ${num(a.width, { min: 0, name: 'width' })}), __len(doc, ${num(a.height, { min: 0, name: 'height' })}));
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`)),
    },
    {
        name: 'create_polygon',
        description: 'Draw a regular polygon centred on centerX, centerY',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                centerX: { type: 'number' }, centerY: { type: 'number' },
                radius: { type: 'number', minimum: 0 },
                sides: { type: 'integer', minimum: 3, maximum: 1000, default: 6 },
                ...STYLE_PROPS,
            },
            required: ['centerX', 'centerY', 'radius'],
        },
        features: [
            'illustrator.shapes.polygon_tool',
            'illustrator.shapes.polygon_option.sides',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        handler: (a) => run('Create polygon', script(`${placement(a)}
var c = ${xy(a, 'centerX', 'centerY')};
var it = layer.pathItems.polygon(c[0], c[1], __len(doc, ${num(a.radius, { min: 0, name: 'radius' })}), ${index(a.sides ?? 6, { name: 'sides', max: 1000 })});
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`)),
    },
    {
        name: 'create_star',
        description: 'Draw a star centred on centerX, centerY',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                centerX: { type: 'number' }, centerY: { type: 'number' },
                radius: { type: 'number', minimum: 0, description: 'Outer radius' },
                innerRadius: { type: 'number', minimum: 0, description: 'Default half the outer radius' },
                points: { type: 'integer', minimum: 3, maximum: 1000, default: 5 },
                ...STYLE_PROPS,
            },
            required: ['centerX', 'centerY', 'radius'],
        },
        features: [
            'illustrator.shapes.star_tool',
            'illustrator.shapes.star_option.radius_1',
            'illustrator.shapes.star_option.radius_2',
            'illustrator.shapes.star_option.points',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        handler: (a) => run('Create star', script(`${placement(a)}
var c = ${xy(a, 'centerX', 'centerY')};
var it = layer.pathItems.star(c[0], c[1], __len(doc, ${num(a.radius, { min: 0, name: 'radius' })}), __len(doc, ${num(a.innerRadius ?? a.radius / 2, { min: 0, name: 'innerRadius' })}), ${index(a.points ?? 5, { name: 'points', max: 1000 })});
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`)),
    },
    {
        name: 'create_line',
        description: 'Draw a straight line (Line Segment tool) from x1, y1 to x2, y2, or from x1, y1 with a length and angle as in the tool\'s options dialog. With fill, the line is filled (Fill Line)',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
                length: { type: 'number', minimum: 0, description: 'Length in points, instead of x2, y2' },
                angle: { type: 'number', description: 'With length: degrees counterclockwise from the 3 o\'clock direction. Default 0' },
                ...STYLE_PROPS,
            },
            required: ['x1', 'y1'],
        },
        features: [
            'illustrator.shapes.line_segment_tool',
            'illustrator.shapes.line_option.length_line_segment',
            'illustrator.shapes.line_option.angle_line_segment',
            'illustrator.shapes.line_option.fill_line',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        auditArgs: { x2: undefined, y2: undefined, length: 120, angle: 30 },
        handler: (a) => {
            const polar = a.length !== undefined;
            if (polar && (a.x2 !== undefined || a.y2 !== undefined)) throw new Error('Give either x2, y2 or length (with angle), not both');
            if (!polar && (a.x2 === undefined || a.y2 === undefined)) throw new Error('Give the end point x2, y2, or a length (and angle)');
            const end = polar
                ? `[${num(a.x1, { name: 'x1' })} + len * Math.cos(rad), ${num(a.y1, { name: 'y1' })} - len * Math.sin(rad)]`
                : `[${num(a.x2, { name: 'x2' })}, ${num(a.y2, { name: 'y2' })}]`;
            return run('Create line', script(`${placement(a)}
${polar ? `var len = ${num(a.length, { min: 0, name: 'length' })}, rad = ${num(a.angle ?? 0, { min: -36000, max: 36000, name: 'angle' })} * Math.PI / 180;` : ''}
var e = ${end};
var it = layer.pathItems.add();
it.setEntirePath([${xy(a, 'x1', 'y1')}, __toDoc(doc, ab, e[0], e[1])]);
it.filled = false; it.stroked = true;
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`));
        },
    },
    {
        name: 'create_path',
        description: 'Draw a path through points. Each point is [x, y], or an object with x, y and optional curve handles in and out ([x, y] in the same coordinates)',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                points: {
                    type: 'array', minItems: 2,
                    items: {
                        anyOf: [
                            { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                            { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, in: { type: 'array', items: { type: 'number' } }, out: { type: 'array', items: { type: 'number' } } }, required: ['x', 'y'] },
                        ],
                    },
                },
                closed: { type: 'boolean', default: false },
                ...STYLE_PROPS,
            },
            required: ['points'],
        },
        features: [
            'illustrator.geometry.pen_tool',
            'illustrator.geometry.path_object',
            'illustrator.geometry.anchor_point_object',
            'illustrator.geometry.path_closed',
            'illustrator.geometry.point_type',
            'illustrator.appearance.fill',
            'illustrator.appearance.stroke',
            'illustrator.appearance.stroke_option.weight',
            'illustrator.appearance.opacity',
        ],
        handler: (a) => {
            if (!Array.isArray(a.points) || a.points.length < 2) throw new Error("'points' needs at least two points");
            const pts = a.points.map((p, i) => {
                const o = Array.isArray(p) ? { x: p[0], y: p[1] } : p;
                const pair = (v, label) => (v ? [Number(num(v[0], { name: label })), Number(num(v[1], { name: label }))] : null);
                return { x: Number(num(o.x, { name: `points[${i}].x` })), y: Number(num(o.y, { name: `points[${i}].y` })), in: pair(o.in, `points[${i}].in`), out: pair(o.out, `points[${i}].out`) };
            });
            return run('Create path', script(`${placement(a)}
var pts = ${json(pts)};
var it = layer.pathItems.add();
for (var i = 0; i < pts.length; i++) {
  var pp = it.pathPoints.add(), q = pts[i];
  pp.anchor = __toDoc(doc, ab, q.x, q.y);
  pp.leftDirection = q["in"] ? __toDoc(doc, ab, q["in"][0], q["in"][1]) : pp.anchor;
  pp.rightDirection = q.out ? __toDoc(doc, ab, q.out[0], q.out[1]) : pp.anchor;
  pp.pointType = (q["in"] || q.out) ? PointType.SMOOTH : PointType.CORNER;
}
it.closed = ${a.closed ? 'true' : 'false'};
${a.fill === undefined && !a.closed ? 'it.filled = false;' : ''}
${styleStatements(a)}
__result__ = __itemInfo(doc, it);`));
        },
    },

    // Text
    {
        name: 'create_text',
        description: 'Add text. Point text grows with its content from x, y (the left end of the first baseline); area text flows inside a box of width and height whose top-left is x, y',
        inputSchema: {
            type: 'object',
            properties: {
                ...PLACEMENT_PROPS,
                contents: { type: 'string', description: 'The text. Use \\r for new paragraphs' },
                kind: { type: 'string', enum: ['point', 'area'], default: 'point' },
                x: { type: 'number' }, y: { type: 'number' },
                width: { type: 'number', minimum: 1, description: 'Area text only' },
                height: { type: 'number', minimum: 1, description: 'Area text only' },
                font: { type: 'string', description: 'PostScript font name, e.g. "MyriadPro-Regular" (see list_fonts)' },
                size: { type: 'number', minimum: 0.1, maximum: 1296, description: 'Font size in points' },
                color: COLOR_SCHEMA,
                justification: { type: 'string', enum: JUSTIFICATION },
                leading: { type: 'number', minimum: 0, description: 'Leading in points (turns off auto leading)' },
                tracking: { type: 'number', description: 'Tracking in thousandths of an em' },
                layer: STYLE_PROPS.layer,
                name: STYLE_PROPS.name,
            },
            required: ['contents', 'x', 'y'],
        },
        features: [
            'illustrator.typography.type_tool',
            'illustrator.typography.area_type_tool',
            'illustrator.typography.text_frame_object',
            'illustrator.typography.point_type',
            'illustrator.typography.area_type',
            'illustrator.typography.character.font_family_and_style',
            'illustrator.typography.character.font_size',
            'illustrator.typography.character.leading',
            'illustrator.typography.character.auto_leading',
            'illustrator.typography.character.tracking',
            'illustrator.typography.character.character_fill_color',
            'illustrator.typography.paragraph.alignment_and_justification',
        ],
        handler: (a) => {
            const area = (a.kind ?? 'point') === 'area';
            if (area && (a.width === undefined || a.height === undefined)) throw new Error('Area text needs width and height');
            return run('Create text', script(`${placement(a)}
var p = ${xy(a)}, t;
${area ? `
var box = layer.pathItems.rectangle(p[1], p[0], __len(doc, ${num(a.width, { min: 1, name: 'width' })}), __len(doc, ${num(a.height, { min: 1, name: 'height' })}));
t = layer.textFrames.areaText(box);` : `
t = layer.textFrames.pointText(p);`}
t.contents = ${str(a.contents)};
${textStyleStatements(a, 't.textRange')}
${a.name ? `t.name = ${str(a.name)};` : ''}
var info = __itemInfo(doc, t);
info.kind = ${area ? '"area"' : '"point"'};
__result__ = info;`));
        },
    },
    {
        name: 'set_text_style',
        description: 'Set font, size, colour, justification, leading or tracking on whole text frames',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                font: { type: 'string', description: 'PostScript font name' },
                size: { type: 'number', minimum: 0.1, maximum: 1296 },
                color: COLOR_SCHEMA,
                justification: { type: 'string', enum: JUSTIFICATION },
                leading: { type: 'number', minimum: 0 },
                tracking: { type: 'number' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.typography.character_panel',
            'illustrator.typography.paragraph_panel',
            'illustrator.typography.text_range_object',
            'illustrator.typography.character.font_family_and_style',
            'illustrator.typography.character.font_size',
            'illustrator.typography.character.leading',
            'illustrator.typography.character.auto_leading',
            'illustrator.typography.character.tracking',
            'illustrator.typography.character.character_fill_color',
            'illustrator.typography.paragraph.alignment_and_justification',
            'illustrator.typography.align_text_workflow',
            'illustrator.typography.align_text_left',
            'illustrator.typography.align_text_center',
            'illustrator.typography.align_text_right',
            'illustrator.typography.justify_left',
            'illustrator.typography.justify_center',
            'illustrator.typography.justify_right',
            'illustrator.typography.justify_all',
        ],
        handler: (a) => run('Set text style', script(`
var items = __targets(doc, ${targetSpec(a.target)}), n = 0;
for (var i = 0; i < items.length; i++) {
  if (items[i].typename !== "TextFrame") continue;
  var tr = items[i].textRange;
  ${textStyleStatements(a, 'tr')}
  n++;
}
if (!n) throw new Error("None of the items is a text frame");
__result__ = { styled: n };`)),
    },
    {
        name: 'set_text_contents',
        description: 'Replace the text of text frames. Character formatting of the first character is kept',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, contents: { type: 'string' } }, required: ['target', 'contents'] },
        features: ['illustrator.typography.type_tool'],
        handler: (a) => run('Set text contents', script(`
var items = __targets(doc, ${targetSpec(a.target)}), n = 0;
for (var i = 0; i < items.length; i++) if (items[i].typename === "TextFrame") { items[i].contents = ${str(a.contents)}; n++; }
if (!n) throw new Error("None of the items is a text frame");
__result__ = { updated: n };`)),
    },
    {
        name: 'convert_text_to_outlines',
        description: 'Convert text frames to outlined artwork (Type > Create Outlines). The text is no longer editable',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.typography.create_outlines'],
        handler: (a) => run('Create outlines', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) if (items[i].typename === "TextFrame") out.push(__itemInfo(doc, items[i].createOutline()));
if (!out.length) throw new Error("None of the items is a text frame");
__result__ = { outlined: out };`)),
    },
    {
        name: 'list_fonts',
        description: 'List installed fonts whose name, family or style contains the query',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Case-insensitive text to match' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 } },
        },
        features: ['illustrator.typography.fonts_object'],
        handler: (a) => run('List fonts', script(`
var q = ${str(String(a.query ?? '').toLowerCase())}, max = ${index(a.limit ?? 50, { name: 'limit', max: 1000 })}, out = [];
for (var i = 0; i < app.textFonts.length && out.length < max; i++) {
  var f = app.textFonts[i];
  if (!q || (f.name + " " + f.family + " " + f.style).toLowerCase().indexOf(q) >= 0) out.push({ name: f.name, family: f.family, style: f.style });
}
__result__ = { total: app.textFonts.length, fonts: out };`, { needsDocument: false })),
    },
];

/** JSX statements styling a TextRange expression. */
function textStyleStatements(a, range) {
    const lines = [];
    if (a.font) lines.push(`try { ${range}.characterAttributes.textFont = app.textFonts.getByName(${str(a.font)}); } catch (e) { throw new Error("Font not found: " + ${str(a.font)} + ". Use list_fonts for PostScript names"); }`);
    if (a.size !== undefined) lines.push(`${range}.characterAttributes.size = ${num(a.size, { min: 0.1, max: 1296, name: 'size' })};`);
    if (a.color !== undefined) lines.push(`${range}.characterAttributes.fillColor = __color(doc, ${colorSpec(a.color, 'color')});`);
    if (a.leading !== undefined) lines.push(`${range}.characterAttributes.autoLeading = false; ${range}.characterAttributes.leading = ${num(a.leading, { min: 0, max: 5000, name: 'leading' })};`);
    if (a.tracking !== undefined) lines.push(`${range}.characterAttributes.tracking = ${num(a.tracking, { min: -1000, max: 10000, name: 'tracking' })};`);
    if (a.justification) lines.push(`${range}.paragraphAttributes.justification = Justification.${enumOf(a.justification, JUSTIFICATION, { name: 'justification' })};`);
    return lines.join('\n');
}
