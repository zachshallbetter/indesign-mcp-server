/**
 * Frames and objects: drawing frames, shapes and lines; the Stroke panel and
 * stroke styles; frame content type; stacking order;
 * unlocking and showing everything on a spread; polygon and locked-object
 * preferences; frame fitting options; anchored objects; object library items;
 * QR codes; and math expressions. Opening and creating libraries and exporting
 * snippets are transfer_resource_file's; placing snippets is place_file_on_page's.
 *
 * Positions and sizes are millimetres from the top-left of the page; stroke
 * weights, dash and gap lengths and font sizes are points.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { validateFilePath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';
import { TEXT_LOCATION_SCHEMA, textAtSpec, TEXT_AT_JSX } from './tables.js';

const has = (v) => v !== undefined && v !== null;

/** An option group: an object whose keys are all in `allowed` (null when absent). */
function group(value, allowed, name) {
    if (!has(value)) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object`);
    for (const k of Object.keys(value)) {
        if (!allowed.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${allowed.join(', ')}`);
    }
    return value;
}

/** A boolean argument (a string such as "false" is refused rather than read as true). */
function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

/** A non-empty string as a JSX string literal. */
function text(value, name, max = 200) {
    const v = String(value ?? '');
    if (!v.trim()) throw new Error(`'${name}' is empty`);
    if (v.length > max) throw new Error(`'${name}' is too long`);
    return str(v);
}

/** A friendly enum value mapped to its JSX expression. */
function pick(value, map, name) {
    return map[enumOf(value, Object.keys(map), { name })];
}

/** Points as a JSX string literal ("2pt"), independent of the script's measurement unit. */
const pt = (v, name, max = 1000) => str(`${num(v, { min: 0, max, name })}pt`);

/** A path the server's path policy allows, with one of the given extensions, as a JSX literal. */
function filePath(value, exts, name = 'path') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required`);
    if (!exts.some((e) => value.toLowerCase().endsWith(e))) throw new Error(`'${name}' must end in ${exts.join(' or ')}`);
    return jsxPath(validateFilePath(value));
}

/** Refuse arguments that do not belong to the chosen action. */
function onlyFor(a, action, allowed, all) {
    for (const k of all) {
        if (has(a[k]) && !allowed.includes(k)) throw new Error(`'${k}' does not apply to action '${action}'`);
    }
}

// ------------------------------------------------------------------ enums

const CONTENT = { graphic: 'ContentType.GRAPHIC_TYPE', text: 'ContentType.TEXT_TYPE', unassigned: 'ContentType.UNASSIGNED' };
const CAPS = { butt: 'EndCap.BUTT_END_CAP', round: 'EndCap.ROUND_END_CAP', projecting: 'EndCap.PROJECTING_END_CAP' };
const JOINS = { miter: 'EndJoin.MITER_END_JOIN', round: 'EndJoin.ROUND_END_JOIN', bevel: 'EndJoin.BEVEL_END_JOIN' };
const STROKE_ALIGN = { center: 'StrokeAlignment.CENTER_ALIGNMENT', inside: 'StrokeAlignment.INSIDE_ALIGNMENT', outside: 'StrokeAlignment.OUTSIDE_ALIGNMENT' };
const ARROWS = {
    none: 'ArrowHead.NONE', simple: 'ArrowHead.SIMPLE_ARROW_HEAD', simple_wide: 'ArrowHead.SIMPLE_WIDE_ARROW_HEAD',
    triangle: 'ArrowHead.TRIANGLE_ARROW_HEAD', triangle_wide: 'ArrowHead.TRIANGLE_WIDE_ARROW_HEAD',
    barbed: 'ArrowHead.BARBED_ARROW_HEAD', curved: 'ArrowHead.CURVED_ARROW_HEAD',
    circle: 'ArrowHead.CIRCLE_ARROW_HEAD', circle_solid: 'ArrowHead.CIRCLE_SOLID_ARROW_HEAD',
    square: 'ArrowHead.SQUARE_ARROW_HEAD', square_solid: 'ArrowHead.SQUARE_SOLID_ARROW_HEAD', bar: 'ArrowHead.BAR_ARROW_HEAD',
};
const ARROW_ALIGN = { inside: 'ArrowHeadAlignmentEnum.INSIDE_PATH', outside: 'ArrowHeadAlignmentEnum.OUTSIDE_PATH' };
const CORNERS = {
    none: 'StrokeCornerAdjustment.NONE', dashes: 'StrokeCornerAdjustment.DASHES',
    gaps: 'StrokeCornerAdjustment.GAPS', dashes_and_gaps: 'StrokeCornerAdjustment.DASHES_AND_GAPS',
};
const ANCHOR_POINTS = {
    top_left: 'AnchorPoint.TOP_LEFT_ANCHOR', top_center: 'AnchorPoint.TOP_CENTER_ANCHOR', top_right: 'AnchorPoint.TOP_RIGHT_ANCHOR',
    left_center: 'AnchorPoint.LEFT_CENTER_ANCHOR', center: 'AnchorPoint.CENTER_ANCHOR', right_center: 'AnchorPoint.RIGHT_CENTER_ANCHOR',
    bottom_left: 'AnchorPoint.BOTTOM_LEFT_ANCHOR', bottom_center: 'AnchorPoint.BOTTOM_CENTER_ANCHOR', bottom_right: 'AnchorPoint.BOTTOM_RIGHT_ANCHOR',
};
const EMPTY_FIT = {
    none: 'EmptyFrameFittingOptions.NONE', content_to_frame: 'EmptyFrameFittingOptions.CONTENT_TO_FRAME',
    proportionally: 'EmptyFrameFittingOptions.PROPORTIONALLY', fill_proportionally: 'EmptyFrameFittingOptions.FILL_PROPORTIONALLY',
};
const FIT_NOW = {
    content_aware: 'FitOptions.CONTENT_AWARE_FIT', proportionally: 'FitOptions.PROPORTIONALLY',
    fill_proportionally: 'FitOptions.FILL_PROPORTIONALLY', content_to_frame: 'FitOptions.CONTENT_TO_FRAME',
    frame_to_content: 'FitOptions.FRAME_TO_CONTENT', center_content: 'FitOptions.CENTER_CONTENT',
    apply_frame_fitting_options: 'FitOptions.APPLY_FRAME_FITTING_OPTIONS',
};
const ANCHORED_POSITION = { inline: 'AnchorPosition.INLINE_POSITION', above_line: 'AnchorPosition.ABOVE_LINE', custom: 'AnchorPosition.ANCHORED' };
const H_REF = {
    anchor_location: 'AnchoredRelativeTo.ANCHOR_LOCATION', column_edge: 'AnchoredRelativeTo.COLUMN_EDGE',
    text_frame: 'AnchoredRelativeTo.TEXT_FRAME', page_margins: 'AnchoredRelativeTo.PAGE_MARGINS', page_edge: 'AnchoredRelativeTo.PAGE_EDGE',
};
const V_REF = Object.fromEntries(['CAPHEIGHT', 'COLUMN_EDGE', 'EMBOX_BOTTOM', 'EMBOX_MIDDLE', 'EMBOX_TOP', 'LINE_ASCENT', 'LINE_BASELINE',
    'LINE_XHEIGHT', 'PAGE_EDGE', 'PAGE_MARGINS', 'TEXT_FRAME', 'TOP_OF_LEADING'].map((v) => [v.toLowerCase(), `VerticallyRelativeTo.${v}`]));
const H_ALIGN = { left: 'HorizontalAlignment.LEFT_ALIGN', center: 'HorizontalAlignment.CENTER_ALIGN', right: 'HorizontalAlignment.RIGHT_ALIGN', text: 'HorizontalAlignment.TEXT_ALIGN' };
const V_ALIGN = { top: 'VerticalAlignment.TOP_ALIGN', center: 'VerticalAlignment.CENTER_ALIGN', bottom: 'VerticalAlignment.BOTTOM_ALIGN' };
const ASSET_TYPES = Object.fromEntries(['EPS_TYPE', 'GEOMETRY_TYPE', 'IMAGE_TYPE', 'INDESIGN_FILE_TYPE', 'PAGE_TYPE', 'PDF_TYPE', 'STRUCTURE_TYPE', 'TEXT_TYPE']
    .map((v) => [v.replace(/_TYPE$/, '').toLowerCase(), `AssetType.${v}`]));

const enumSchema = (map, description) => ({ type: 'string', enum: Object.keys(map), description });
const PAGE_INDEX = { type: 'integer', minimum: 0, description: 'Page index (0-based)' };

// ------------------------------------------------------------- shared JSX

/** __reresolve(doc, id, fallback): an item again by id after a change that can replace the object. */
const RERESOLVE_JSX = `
function __reresolve(doc, oid, fallback) {
  var again = doc.pageItems.itemByID(oid);
  if (again.isValid) return again.getElements()[0];
  return fallback;
}
`;

/** __isAnchored(item): whether the item sits in text as an anchored object. */
const ANCHORED_JSX = `
function __isAnchored(it) {
  try { return it.parent.constructor.name === "Character"; } catch (e) { return false; }
}
function __anchoredInfo(it) {
  var s = it.anchoredObjectSettings, o = { id: it.id, type: it.constructor.name };
  o.position = __enumName(s.anchoredPosition);
  o.anchorPoint = __enumName(s.anchorPoint);
  o.horizontalReferencePoint = __enumName(s.horizontalReferencePoint);
  o.verticalReferencePoint = __enumName(s.verticalReferencePoint);
  o.horizontalAlignment = __enumName(s.horizontalAlignment);
  o.verticalAlignment = __enumName(s.verticalAlignment);
  o.xOffset = s.anchorXoffset; o.yOffset = s.anchorYoffset; o.spaceAbove = s.anchorSpaceAbove;
  o.lockPosition = s.lockPosition; o.pinPosition = s.pinPosition; o.spineRelative = s.spineRelative;
  o.rotationAngle = it.rotationAngle; o.horizontalScale = it.horizontalScale; o.verticalScale = it.verticalScale;
  return o;
}
`;

// ------------------------------------------------------------- draw_shape

const SHAPES = ['rectangle', 'ellipse', 'polygon', 'line'];

/** Statements that create the shape `it` on page `pg`. */
function drawStatements(a) {
    const shape = enumOf(a.shape, SHAPES, { name: 'shape' });
    if (shape === 'line') {
        for (const k of ['x', 'y', 'width', 'height', 'content', 'sides', 'starInset']) {
            if (has(a[k])) throw new Error(`'${k}' does not apply to a line; give from and to`);
        }
        const pt2 = (p, name) => {
            if (!Array.isArray(p) || p.length !== 2) throw new Error(`'${name}' must be [x, y] in mm`);
            return p.map((v, i) => num(v, { min: -10000, max: 10000, name: `${name}[${i}]` }));
        };
        const [x1, y1] = pt2(a.from, 'from');
        const [x2, y2] = pt2(a.to, 'to');
        return { shape, lines: [
            'var it = pg.graphicLines.add();',
            `it.paths[0].entirePath = [__toPage(pg, ${x1}, ${y1}), __toPage(pg, ${x2}, ${y2})];`,
        ] };
    }
    if (has(a.from) || has(a.to)) throw new Error("'from' and 'to' are for lines; give x, y, width and height");
    const x = num(a.x, { min: -10000, max: 10000, name: 'x' });
    const y = num(a.y, { min: -10000, max: 10000, name: 'y' });
    const w = num(a.width, { min: 0.01, max: 10000, name: 'width' });
    const h = num(a.height, { min: 0.01, max: 10000, name: 'height' });
    if (shape !== 'polygon' && (has(a.sides) || has(a.starInset))) throw new Error("'sides' and 'starInset' apply to polygons");
    const content = has(a.content) ? enumOf(a.content, Object.keys(CONTENT), { name: 'content' }) : 'graphic';
    const lines = [];
    if (shape === 'rectangle' && content === 'text') lines.push('var it = pg.textFrames.add();');
    else if (shape === 'rectangle') lines.push('var it = pg.rectangles.add();');
    else if (shape === 'ellipse') lines.push('var it = pg.ovals.add();');
    else {
        const sides = has(a.sides) ? index(a.sides, { name: 'sides', max: 100 }) : 'app.polygonPreferences.numberOfSides';
        if (has(a.sides) && Number(a.sides) < 3) throw new Error("'sides' must be 3 to 100");
        const inset = has(a.starInset) ? num(a.starInset, { min: 0, max: 100, name: 'starInset' }) : 'app.polygonPreferences.insetPercentage';
        lines.push(`var it = pg.polygons.add(doc.activeLayer, ${sides}, ${inset});`);
    }
    lines.push(`var o = __toPage(pg, ${x}, ${y});`, `it.geometricBounds = [o[1], o[0], o[1] + ${h}, o[0] + ${w}];`);
    if (!(shape === 'rectangle' && content === 'text')) {
        lines.push(`var oid = it.id;`, `it.contentType = ${CONTENT[content]};`, 'it = __reresolve(doc, oid, pg.pageItems[0]);');
    }
    return { shape, lines };
}

// --------------------------------------------------------- set_item_stroke

const STROKE_KEYS = ['weight', 'type', 'color', 'tint', 'cap', 'join', 'miterLimit', 'align', 'start', 'end', 'startScale', 'endScale',
    'arrowAlignment', 'gapColor', 'gapTint', 'cornerAdjustment', 'dashAndGap'];

/** Validate the Stroke panel options and return { colors, lines } applied to `it`. */
export function strokeStatements(a) {
    const colors = [];
    const lines = [];
    let count = 0;
    const color = (v, name) => {
        const n = `__c${count++}`;
        colors.push(`var ${n} = __swatch(doc, ${colorSpec(v, name)});`);
        return n;
    };
    if (has(a.weight)) lines.push(`it.strokeWeight = ${pt(a.weight, 'weight')};`);
    if (has(a.type)) {
        colors.push(`var __st = doc.strokeStyles.itemByName(${text(a.type, 'type')});`,
            `if (!__st.isValid) throw new Error("No stroke style named " + ${str(a.type)});`);
        lines.push('it.strokeType = __st;');
    }
    if (has(a.color)) lines.push(`it.strokeColor = ${color(a.color, 'color')};`);
    if (has(a.tint)) lines.push(`it.strokeTint = ${num(a.tint, { min: 0, max: 100, name: 'tint' })};`);
    if (has(a.cap)) lines.push(`it.endCap = ${pick(a.cap, CAPS, 'cap')};`);
    if (has(a.join)) lines.push(`it.endJoin = ${pick(a.join, JOINS, 'join')};`);
    if (has(a.miterLimit)) lines.push(`it.miterLimit = ${num(a.miterLimit, { min: 1, max: 500, name: 'miterLimit' })};`);
    if (has(a.align)) lines.push(`it.strokeAlignment = ${pick(a.align, STROKE_ALIGN, 'align')};`);
    if (has(a.start)) lines.push(`it.leftLineEnd = ${pick(a.start, ARROWS, 'start')};`);
    if (has(a.end)) lines.push(`it.rightLineEnd = ${pick(a.end, ARROWS, 'end')};`);
    if (has(a.startScale)) lines.push(`it.leftArrowHeadScale = ${num(a.startScale, { min: 1, max: 1000, name: 'startScale' })};`);
    if (has(a.endScale)) lines.push(`it.rightArrowHeadScale = ${num(a.endScale, { min: 1, max: 1000, name: 'endScale' })};`);
    if (has(a.arrowAlignment)) lines.push(`it.arrowHeadAlignment = ${pick(a.arrowAlignment, ARROW_ALIGN, 'arrowAlignment')};`);
    if (has(a.gapColor)) lines.push(`it.gapColor = ${color(a.gapColor, 'gapColor')};`);
    if (has(a.gapTint)) lines.push(`it.gapTint = ${num(a.gapTint, { min: 0, max: 100, name: 'gapTint' })};`);
    if (has(a.cornerAdjustment)) lines.push(`it.strokeCornerAdjustment = ${pick(a.cornerAdjustment, CORNERS, 'cornerAdjustment')};`);
    if (has(a.dashAndGap)) {
        const d = a.dashAndGap;
        if (!Array.isArray(d) || d.length < 2 || d.length > 6 || d.length % 2) throw new Error("'dashAndGap' must be 2, 4 or 6 lengths in points: dash, gap, dash, gap...");
        lines.push(`it.strokeDashAndGap = [${d.map((v, i) => pt(v, `dashAndGap[${i}]`)).join(', ')}];`);
    }
    if (!lines.length) throw new Error(`Nothing to set: give any of ${STROKE_KEYS.join(', ')}`);
    return { colors, lines };
}

// ---------------------------------------------------------- stroke styles

const STYLE_ACTIONS = ['list', 'create', 'delete', 'export', 'import'];
const STYLE_ARGS = ['name', 'kind', 'pattern', 'cornerAdjustment', 'cap', 'replaceWith', 'names', 'path'];

/** The add() call for a new stroke style. */
function strokeStyleCreate(a) {
    const kind = enumOf(a.kind, ['dashed', 'dotted', 'striped'], { name: 'kind' });
    const p = a.pattern;
    if (!Array.isArray(p) || p.length < 1 || p.length > 20) throw new Error("'pattern' must be a list of 1 to 20 numbers");
    const props = [`name: ${text(a.name, 'name')}`];
    if (kind === 'striped') {
        if (p.length % 2) throw new Error("'pattern' for a striped style is pairs of [top, bottom] stripe edges (% of the stroke weight)");
        props.push(`stripeArray: [${p.map((v, i) => num(v, { min: 0, max: 100, name: `pattern[${i}]` })).join(', ')}]`);
        if (has(a.cornerAdjustment) || has(a.cap)) throw new Error("'cornerAdjustment' and 'cap' apply to dashed and dotted styles");
    } else if (kind === 'dashed') {
        if (p.length % 2) throw new Error("'pattern' for a dashed style is dash and gap lengths in points, in pairs");
        props.push(`dashArray: [${p.map((v, i) => pt(v, `pattern[${i}]`)).join(', ')}]`);
        if (has(a.cap)) props.push(`endCap: ${pick(a.cap, CAPS, 'cap')}`);
    } else {
        props.push(`dotArray: [${p.map((v, i) => pt(v, `pattern[${i}]`)).join(', ')}]`);
        if (has(a.cap)) throw new Error("'cap' applies to dashed styles");
    }
    if (has(a.cornerAdjustment)) props.push(`strokeCornerAdjustment: ${pick(a.cornerAdjustment, CORNERS, 'cornerAdjustment')}`);
    return `var s = doc.${kind}StrokeStyles.add({ ${props.join(', ')} });\n__result__ = { created: s.name, kind: "${kind}" };`;
}

const STYLE_LIST_JSX = `
function __customStrokeStyles(doc) {
  var out = [], cs = [doc.dashedStrokeStyles, doc.dottedStrokeStyles, doc.stripedStrokeStyles];
  for (var i = 0; i < cs.length; i++) for (var j = 0; j < cs[i].length; j++) out.push(cs[i][j]);
  return out;
}
`;

// ----------------------------------------------------------- libraries

/** __lib(name) and __assets(lib, spec), __assetInfo(asset). */
const LIBRARY_JSX = `
function __lib(name) {
  if (name !== null) {
    var l = app.libraries.itemByName(name);
    if (!l.isValid) throw new Error("No open library named " + name);
    return l;
  }
  if (app.libraries.length === 0) throw new Error("No library is open: open or create one with transfer_resource_file");
  return app.libraries[0];
}
function __assetInfo(a) {
  var o = { id: a.id, index: a.index, name: a.name, description: a.description, type: __enumName(a.assetType) };
  try { o.date = String(a.date); } catch (e) {}
  return o;
}
function __assets(lib, spec) {
  var out = [], i, j;
  if (spec.ids) for (i = 0; i < spec.ids.length; i++) {
    var a = lib.assets.itemByID(spec.ids[i]);
    if (!a.isValid) throw new Error("No library item with id " + spec.ids[i]);
    out.push(a);
  }
  if (spec.names) for (i = 0; i < spec.names.length; i++) {
    var hit = false;
    for (j = 0; j < lib.assets.length; j++) if (lib.assets[j].name === spec.names[i]) { out.push(lib.assets[j]); hit = true; }
    if (!hit) throw new Error("No library item named " + spec.names[i]);
  }
  return out;
}
`;

const LIBRARY_SCHEMA = { type: 'string', description: 'Name of an open library, as the Library panel tab shows it (e.g. "Parts.indl"); default: the first open library' };
const ASSETS_SCHEMA = {
    type: 'object',
    description: 'Which library items: ids or names (manage_object_library with action "list" shows both)',
    properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Library item ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Library item names (every item with each name)' },
    },
};

/** Library items as a JSX literal for __assets(). */
function assetSpec(v, name = 'items') {
    const g = group(v, ['ids', 'names'], name);
    const out = {};
    if (g && Array.isArray(g.ids) && g.ids.length) out.ids = g.ids.map((x, i) => Number(index(x, { name: `${name}.ids[${i}]`, max: 1e9 })));
    if (g && Array.isArray(g.names) && g.names.length) out.names = g.names.map((x) => { if (!String(x).trim()) throw new Error(`'${name}.names' has an empty name`); return String(x); });
    if (!out.ids && !out.names) throw new Error(`Choose the library items: ${name}.ids or ${name}.names`);
    return json(out);
}

const libName = (v) => (has(v) ? text(v, 'library') : 'null');

/** Invoke a Library panel menu action on the library's panel. */
function panelMenu(idNum, label) {
    return `
__lib_.associatedPanel.visible = true;
var ma = app.menuActions.itemByID(${idNum});
if (!ma.isValid) throw new Error("The Library panel command ${label} is not available in this version");
if (!ma.enabled) throw new Error("The Library panel command ${label} is not available now: bring the library's panel to the front");
ma.invoke();`;
}

const VIEWS = { thumbnails: 34313, large_thumbnails: 34411, list: 34314 };
const SORTS = { name: 34315, newest: 34316, oldest: 34317, type: 34318 };

// ---------------------------------------------------------------- QR codes

const QR_FIELDS = {
    url: ['url'],
    text: ['text'],
    email: ['address', 'subject', 'body'],
    sms: ['number', 'message'],
    vcard: ['firstName', 'lastName', 'jobTitle', 'cellPhone', 'phone', 'email', 'organisation', 'streetAddress', 'city', 'state', 'country', 'postalCode', 'website'],
};

/** The QR-code call on frame `f` with swatch `sw`. */
function qrCall(a) {
    const type = enumOf(a.type, Object.keys(QR_FIELDS), { name: 'type' });
    const d = group(a.data, [...new Set(Object.values(QR_FIELDS).flat())], 'data') ?? {};
    for (const k of Object.keys(d)) if (!QR_FIELDS[type].includes(k)) throw new Error(`'data.${k}' does not apply to a ${type} QR code. Allowed: ${QR_FIELDS[type].join(', ')}`);
    const val = (k, required) => {
        if (!has(d[k]) || String(d[k]) === '') {
            if (required) throw new Error(`'data.${k}' is required for a ${type} QR code`);
            return '""';
        }
        if (String(d[k]).length > 2000) throw new Error(`'data.${k}' is too long`);
        return str(d[k]);
    };
    switch (type) {
        case 'url': return `f.createHyperlinkQRCode(${val('url', true)}, sw);`;
        case 'text': return `f.createPlainTextQRCode(${val('text', true)}, sw);`;
        case 'email': return `f.createEmailQRCode(${val('address', true)}, ${val('subject')}, ${val('body')}, sw);`;
        case 'sms': return `f.createTextMsgQRCode(${val('number', true)}, ${val('message')}, sw);`;
        default: {
            if (!QR_FIELDS.vcard.some((k) => has(d[k]) && String(d[k]) !== '')) throw new Error("Give at least one 'data' field for a vcard QR code");
            return `f.createVCardQRCode(${QR_FIELDS.vcard.map((k) => val(k)).join(', ')}, sw);`;
        }
    }
}

// ------------------------------------------------------------------- math

const MATH_JSX = `
function __maths(doc) {
  var m = null;
  try { m = doc.mathObjects; } catch (e) {}
  if (!m) throw new Error("Math expressions need InDesign 2025 (20.0) or later");
  return m;
}
function __mathInfo(m) {
  var o = { id: m.id, mathml: m.mathmlDescription, fontSize: m.appliedMathMLFontSize };
  try { o.color = m.appliedMathMLSwatch.name; } catch (e) { o.color = null; }
  try { o.frame = __itemInfo(m.parent); } catch (e) {}
  return o;
}
`;

/** A MathML string as a JSX literal. */
function mathml(v) {
    const s = String(v ?? '').trim();
    if (!/^<math[\s>]/i.test(s) && !/^<mml:math[\s>]/i.test(s)) throw new Error("'mathml' must be a MathML <math> element (LaTeX is not accepted by InDesign's scripting)");
    if (s.length > 100000) throw new Error("'mathml' is too long");
    return str(s);
}

// ----------------------------------------------------- get_object_options

/** [key, expression] pairs read from `it` for each section. */
const READS = {
    stroke: [
        ['weight', 'it.strokeWeight'], ['type', 'it.strokeType.name'], ['color', 'it.strokeColor.name'], ['tint', 'it.strokeTint'],
        ['cap', '__enumName(it.endCap)'], ['join', '__enumName(it.endJoin)'], ['miterLimit', 'it.miterLimit'],
        ['align', '__enumName(it.strokeAlignment)'], ['start', '__enumName(it.leftLineEnd)'], ['end', '__enumName(it.rightLineEnd)'],
        ['startScale', 'it.leftArrowHeadScale'], ['endScale', 'it.rightArrowHeadScale'], ['arrowAlignment', '__enumName(it.arrowHeadAlignment)'],
        ['gapColor', 'it.gapColor.name'], ['gapTint', 'it.gapTint'], ['cornerAdjustment', '__enumName(it.strokeCornerAdjustment)'],
        ['dashAndGap', 'it.strokeDashAndGap'],
    ],
    attributes: [
        ['contentType', '__enumName(it.contentType)'], ['nonprinting', 'it.nonprinting'],
        ['overprintFill', 'it.overprintFill'], ['overprintStroke', 'it.overprintStroke'], ['overprintGap', 'it.overprintGap'],
    ],
    fitting: [
        ['fitting', '__enumName(it.frameFittingOptions.fittingOnEmptyFrame)'], ['referencePoint', '__enumName(it.frameFittingOptions.fittingAlignment)'],
        ['autoFit', 'it.frameFittingOptions.autoFit'], ['topCrop', 'it.frameFittingOptions.topCrop'], ['leftCrop', 'it.frameFittingOptions.leftCrop'],
        ['bottomCrop', 'it.frameFittingOptions.bottomCrop'], ['rightCrop', 'it.frameFittingOptions.rightCrop'],
    ],
};
const SECTIONS = ['stroke', 'attributes', 'fitting', 'anchored'];

function readBlock(section) {
    const lines = READS[section].map(([k, e]) => `  try { s.${k} = ${e}; } catch (e) {}`);
    const units = section === 'stroke';
    return [
        `{ var s = {};`,
        units ? '  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;' : '',
        ...lines,
        units ? '  app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;' : '',
        `  r.${section} = s; }`,
    ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ tools

const TEXT_AT = { ...TEXT_LOCATION_SCHEMA, description: 'Where in text to anchor: a text frame\'s story or a story at characterIndex (default: the end), or selection: true for the text cursor' };

const ANCHOR_OPTIONS_SCHEMA = {
    type: 'object',
    description: 'Anchored Object Options (Object > Anchored Object > Options)',
    properties: {
        position: enumSchema(ANCHORED_POSITION, 'Inline, Above Line, or Custom'),
        anchorPoint: enumSchema(ANCHOR_POINTS, 'Anchored Object reference point on the object (custom)'),
        horizontalReferencePoint: enumSchema(H_REF, 'What the object is positioned against horizontally (custom)'),
        verticalReferencePoint: enumSchema(V_REF, 'What the object is positioned against vertically (custom)'),
        horizontalAlignment: enumSchema(H_ALIGN, 'Alignment of an above-line object'),
        verticalAlignment: enumSchema(V_ALIGN, 'Vertical alignment (custom)'),
        xOffset: { type: 'number', description: 'X offset (mm)' },
        yOffset: { type: 'number', description: 'Y offset (mm); for inline objects, the shift from the baseline' },
        spaceAbove: { type: 'number', description: 'Space Before of an above-line object (mm)' },
        lockPosition: { type: 'boolean', description: 'Prevent Manual Positioning' },
        pinPosition: { type: 'boolean', description: 'Keep Within Top/Bottom Column Boundaries' },
        spineRelative: { type: 'boolean', description: 'Relative to Spine' },
    },
};

/** Validate anchored options and return statements on `s` (the item's anchoredObjectSettings). */
function anchorStatements(o, name = 'options') {
    const g = group(o, Object.keys(ANCHOR_OPTIONS_SCHEMA.properties), name);
    if (!g) return [];
    const lines = [];
    const mmv = (v, k) => num(v, { min: -5000, max: 5000, name: `${name}.${k}` });
    if (has(g.position)) lines.push(`s.anchoredPosition = ${pick(g.position, ANCHORED_POSITION, `${name}.position`)};`);
    if (has(g.anchorPoint)) lines.push(`s.anchorPoint = ${pick(g.anchorPoint, ANCHOR_POINTS, `${name}.anchorPoint`)};`);
    if (has(g.horizontalReferencePoint)) lines.push(`s.horizontalReferencePoint = ${pick(g.horizontalReferencePoint, H_REF, `${name}.horizontalReferencePoint`)};`);
    if (has(g.verticalReferencePoint)) lines.push(`s.verticalReferencePoint = ${pick(g.verticalReferencePoint, V_REF, `${name}.verticalReferencePoint`)};`);
    if (has(g.horizontalAlignment)) lines.push(`s.horizontalAlignment = ${pick(g.horizontalAlignment, H_ALIGN, `${name}.horizontalAlignment`)};`);
    if (has(g.verticalAlignment)) lines.push(`s.verticalAlignment = ${pick(g.verticalAlignment, V_ALIGN, `${name}.verticalAlignment`)};`);
    if (has(g.xOffset)) lines.push(`s.anchorXoffset = ${mmv(g.xOffset, 'xOffset')};`);
    if (has(g.yOffset)) lines.push(`s.anchorYoffset = ${mmv(g.yOffset, 'yOffset')};`);
    if (has(g.spaceAbove)) lines.push(`s.anchorSpaceAbove = ${mmv(g.spaceAbove, 'spaceAbove')};`);
    if (has(g.lockPosition)) lines.push(`s.lockPosition = ${flag(g.lockPosition, `${name}.lockPosition`)};`);
    if (has(g.pinPosition)) lines.push(`s.pinPosition = ${flag(g.pinPosition, `${name}.pinPosition`)};`);
    if (has(g.spineRelative)) lines.push(`s.spineRelative = ${flag(g.spineRelative, `${name}.spineRelative`)};`);
    return lines;
}

const ANCHOR_CREATE = { rectangle: 'rectangles', ellipse: 'ovals', polygon: 'polygons', text_frame: 'textFrames', line: 'graphicLines' };

export const tools = [
    {
        name: 'draw_shape',
        description: 'Draw a rectangle, ellipse or polygon frame, or a straight line, on a page (Rectangle Frame, Ellipse Frame, Polygon Frame and Line tools). Frames are graphic placeholders by default; content "unassigned" draws a plain shape and "text" a text frame. Returns the new item\'s id',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: PAGE_INDEX,
                shape: { type: 'string', enum: SHAPES, description: 'What to draw' },
                x: { type: 'number', description: 'Left edge in mm from the page\'s left (not for lines)' },
                y: { type: 'number', description: 'Top edge in mm from the page\'s top (not for lines)' },
                width: { type: 'number', minimum: 0.01, description: 'Width in mm (not for lines)' },
                height: { type: 'number', minimum: 0.01, description: 'Height in mm (not for lines)' },
                content: enumSchema(CONTENT, 'Frame content: graphic placeholder (default), text frame, or unassigned (a plain shape)'),
                sides: { type: 'integer', minimum: 3, maximum: 100, description: 'Polygon: number of sides (default: the Polygon Settings value)' },
                starInset: { type: 'number', minimum: 0, maximum: 100, description: 'Polygon: star inset (%); 0 draws a regular polygon (default: the Polygon Settings value)' },
                from: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Line: start point [x, y] in mm from the page\'s top-left' },
                to: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Line: end point [x, y] in mm from the page\'s top-left' },
                name: { type: 'string', description: 'Name for the new item (Layers panel)' },
            },
            required: ['pageIndex', 'shape'],
        },
        features: [
            'indesign.frames_objects.rectangle_frame_tool',
            'indesign.frames_objects.ellipse_frame_tool',
            'indesign.frames_objects.polygon_frame_tool',
            'indesign.frames_objects.polygon_star_inset',
            'indesign.frames_objects.line_tool',
            'indesign.frames_objects.graphic_line',
            'indesign.frames_objects.frame_content_type',
        ],
        hints: { readOnly: false },
        auditArgs: { shape: 'polygon', x: 10, y: 10, width: 40, height: 40, sides: 5, starInset: 30, from: undefined, to: undefined },
        handler: (a) => {
            const pg = index(a.pageIndex, { name: 'pageIndex' });
            const { shape, lines } = drawStatements(a);
            const nm = has(a.name) ? `it.name = ${text(a.name, 'name')};` : '';
            return run('Draw shape', script(`${RERESOLVE_JSX}
var pg = __page(doc, ${pg});
${lines.join('\n')}
${nm}
__result__ = { shape: "${shape}", item: __itemInfo(it) };`));
        },
    },
    {
        name: 'set_frame_content_type',
        description: 'Change frames\' content type to graphic, text or unassigned (Object > Content). For the Attributes panel (Nonprinting, overprint) use set_print_attributes',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                contentType: enumSchema(CONTENT, 'The new content type'),
            },
            required: ['target', 'contentType'],
        },
        features: ['indesign.frames_objects.frame_content_type'],
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const ct = pick(a.contentType, CONTENT, 'contentType');
            return run('Set frame content type', script(`${RERESOLVE_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], oid = it.id;
  it.contentType = ${ct};
  it = __reresolve(doc, oid, it);
  out.push({ item: __itemInfo(it), contentType: __enumName(it.contentType) });
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'arrange_objects',
        description: 'Change stacking order within each item\'s layer: Bring to Front, Bring Forward, Send Backward or Send to Back (Object > Arrange)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                order: { type: 'string', enum: ['bring_to_front', 'bring_forward', 'send_backward', 'send_to_back'], description: 'Where to move the items' },
            },
            required: ['target', 'order'],
        },
        features: [
            'indesign.frames_objects.bring_to_front',
            'indesign.frames_objects.bring_forward',
            'indesign.frames_objects.send_backward',
            'indesign.frames_objects.send_to_back',
        ],
        hints: { readOnly: false },
        handler: (a) => {
            const calls = { bring_to_front: 'bringToFront()', bring_forward: 'bringForward()', send_backward: 'sendBackward()', send_to_back: 'sendToBack()' };
            const order = enumOf(a.order, Object.keys(calls), { name: 'order' });
            return run('Arrange objects', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  items[i].${calls[order]};
  out.push(__itemInfo(items[i]));
}
__result__ = { order: "${order}", items: out };`));
        },
    },
    {
        name: 'reveal_spread_items',
        description: 'Unlock every locked object and/or show every hidden object on a spread (Object > Unlock All on Spread, Show All on Spread)',
        inputSchema: {
            type: 'object',
            properties: {
                spreadIndex: { type: 'integer', minimum: 0, description: 'Spread index (0-based); default: the spread in the active window' },
                unlock: { type: 'boolean', description: 'Unlock All on Spread', default: true },
                show: { type: 'boolean', description: 'Show All on Spread', default: true },
            },
        },
        features: ['indesign.frames_objects.unlock_all_on_spread', 'indesign.frames_objects.show_all_on_spread'],
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const unlock = has(a.unlock) ? a.unlock : true;
            const show = has(a.show) ? a.show : true;
            flag(unlock, 'unlock');
            flag(show, 'show');
            if (!unlock && !show) throw new Error('Nothing to do: unlock and show are both false');
            const sp = has(a.spreadIndex)
                ? `var si = ${index(a.spreadIndex, { name: 'spreadIndex' })};
if (si >= doc.spreads.length) throw new Error("Spread index " + si + " is out of range; the document has " + doc.spreads.length + " spreads");
var sp = doc.spreads[si];`
                : 'var sp = app.activeWindow.activeSpread;';
            return run('Reveal spread items', script(`
${sp}
var all = sp.allPageItems, unlocked = 0, shown = 0;
for (var i = 0; i < all.length; i++) {
  var it = all[i];
  ${unlock ? 'if (it.locked) { it.locked = false; unlocked++; }' : ''}
  ${show ? 'if (!it.visible) { it.visible = true; shown++; }' : ''}
}
__result__ = { unlocked: unlocked, shown: shown, items: all.length };`));
        },
    },
    {
        name: 'set_object_preferences',
        description: 'Set the Polygon Settings used by the polygon tools (number of sides, star inset; double-click the Polygon tool) and Prevent Selection of Locked Objects (Preferences > General). Returns the current values; give nothing to read them',
        inputSchema: {
            type: 'object',
            properties: {
                polygonSides: { type: 'integer', minimum: 3, maximum: 100, description: 'Polygon Settings: Number of Sides' },
                starInset: { type: 'number', minimum: 0, maximum: 100, description: 'Polygon Settings: Star Inset (%)' },
                preventSelectingLocked: { type: 'boolean', description: 'Prevent Selection of Locked Objects' },
            },
        },
        features: [
            'indesign.frames_objects.polygon_settings',
            'indesign.frames_objects.polygon_star_inset',
            'indesign.frames_objects.prevent_selection_locked',
        ],
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const lines = [];
            if (has(a.polygonSides)) {
                if (Number(a.polygonSides) < 3) throw new Error("'polygonSides' must be 3 to 100");
                lines.push(`app.polygonPreferences.numberOfSides = ${index(a.polygonSides, { name: 'polygonSides', max: 100 })};`);
            }
            if (has(a.starInset)) lines.push(`app.polygonPreferences.insetPercentage = ${num(a.starInset, { min: 0, max: 100, name: 'starInset' })};`);
            if (has(a.preventSelectingLocked)) lines.push(`app.generalPreferences.preventSelectingLockedItems = ${flag(a.preventSelectingLocked, 'preventSelectingLocked')};`);
            return run('Set object preferences', script(`
${lines.join('\n')}
__result__ = { polygonSides: app.polygonPreferences.numberOfSides, starInset: app.polygonPreferences.insetPercentage,
  preventSelectingLocked: app.generalPreferences.preventSelectingLockedItems };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_item_stroke',
        description: 'Set Stroke panel options on items: weight, type (stroke style), colour and tint, cap, join and miter limit, stroke alignment, start and end arrowheads with their scale and alignment, gap colour and tint, dash corner adjustment and custom dash/gap lengths (Window > Stroke). Weights and lengths are points',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                weight: { type: 'number', minimum: 0, maximum: 1000, description: 'Stroke weight (points); 0 removes the stroke' },
                type: { type: 'string', description: 'Stroke type: a stroke style name such as "Solid", "Dashed", "Dotted", "Thick - Thin" or a custom style' },
                color: { ...COLOR_SCHEMA, description: `Stroke colour: ${COLOR_SCHEMA.description}` },
                tint: { type: 'number', minimum: 0, maximum: 100, description: 'Stroke tint (%)' },
                cap: enumSchema(CAPS, 'Cap: the shape of open path ends'),
                join: enumSchema(JOINS, 'Join: the shape of corners'),
                miterLimit: { type: 'number', minimum: 1, maximum: 500, description: 'Miter limit (times the stroke weight)' },
                align: enumSchema(STROKE_ALIGN, 'Align Stroke: centred on, inside or outside the path'),
                start: enumSchema(ARROWS, 'Start: arrowhead at the start of an open path'),
                end: enumSchema(ARROWS, 'End: arrowhead at the end of an open path'),
                startScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Scale of the start arrowhead (%)' },
                endScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Scale of the end arrowhead (%)' },
                arrowAlignment: enumSchema(ARROW_ALIGN, 'Align arrowheads inside or outside the path end'),
                gapColor: { ...COLOR_SCHEMA, description: `Gap Color of dashed, dotted and striped strokes: ${COLOR_SCHEMA.description}` },
                gapTint: { type: 'number', minimum: 0, maximum: 100, description: 'Gap Tint (%)' },
                cornerAdjustment: enumSchema(CORNERS, 'Corners: how dashes and gaps adjust to meet at corners'),
                dashAndGap: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 6, description: 'Dashed stroke: dash, gap, dash, gap... lengths in points (2, 4 or 6 values)' },
            },
            required: ['target'],
        },
        features: [
            'indesign.frames_objects.stroke_panel',
            'indesign.frames_objects.stroke_weight',
            'indesign.frames_objects.stroke_weight_presets',
            'indesign.frames_objects.stroke_type',
            'indesign.frames_objects.stroke_cap',
            'indesign.frames_objects.stroke_join',
            'indesign.frames_objects.stroke_align',
            'indesign.frames_objects.stroke_start_end',
            'indesign.frames_objects.stroke_gap_color',
            'indesign.frames_objects.stroke_corners_dashes',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { type: 'Dashed', color: '#336699', gapColor: 'Paper', dashAndGap: [4, 2] },
        handler: (a) => {
            const spec = targetSpec(a.target);
            const { colors, lines } = strokeStatements(a);
            return run('Set item stroke', script(`
${colors.join('\n')}
var items = __targets(doc, ${spec}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${lines.join('\n  ')}
  out.push(__itemInfo(it));
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'manage_stroke_styles',
        description: 'List, create, delete, save (export) and load (import) custom stroke styles: dashed, dotted and striped patterns (Stroke panel menu > Stroke Styles)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: STYLE_ACTIONS, description: 'list every stroke style; create, delete, export (Save) or import (Load) custom styles' },
                name: { type: 'string', description: 'create, delete: the style name' },
                kind: { type: 'string', enum: ['dashed', 'dotted', 'striped'], description: 'create: the kind of style' },
                pattern: {
                    type: 'array', items: { type: 'number', minimum: 0 }, minItems: 1, maxItems: 20,
                    description: 'create: dashed, dash and gap lengths in points, in pairs; dotted, dot centre distances in points; striped, pairs of [top, bottom] stripe edges as % of the stroke weight',
                },
                cornerAdjustment: enumSchema(CORNERS, 'create: Corners for a dashed or dotted style'),
                cap: enumSchema(CAPS, 'create: Cap of a dashed style\'s dashes'),
                replaceWith: { type: 'string', description: 'delete: the stroke style applied where the deleted one was used (default "Solid")' },
                names: { type: 'array', items: { type: 'string' }, description: 'export: the styles to save (default: every custom style)' },
                path: { type: 'string', description: 'export, import: a stroke styles file (.inst)' },
            },
            required: ['action'],
        },
        features: ['indesign.frames_objects.stroke_styles'],
        hints: { readOnly: false },
        auditArgs: { action: 'create', kind: 'dashed', name: 'Long dash', pattern: [6, 2], cap: 'round', names: undefined, path: undefined, replaceWith: undefined },
        handler: (a) => {
            const action = enumOf(a.action, STYLE_ACTIONS, { name: 'action' });
            const allowed = {
                list: [], create: ['name', 'kind', 'pattern', 'cornerAdjustment', 'cap'],
                delete: ['name', 'replaceWith'], export: ['names', 'path'], import: ['path'],
            }[action];
            onlyFor(a, action, allowed, STYLE_ARGS);
            let body;
            if (action === 'list') {
                body = `var out = [];
for (var i = 0; i < doc.strokeStyles.length; i++) out.push({ name: doc.strokeStyles[i].name, type: doc.strokeStyles[i].strokeStyleType });
__result__ = { strokeStyles: out };`;
            } else if (action === 'create') {
                body = strokeStyleCreate(a);
            } else if (action === 'delete') {
                const rep = has(a.replaceWith) ? text(a.replaceWith, 'replaceWith') : '"Solid"';
                body = `var s = doc.strokeStyles.itemByName(${text(a.name, 'name')});
if (!s.isValid) throw new Error("No stroke style named " + ${str(a.name)});
var r = doc.strokeStyles.itemByName(${rep});
if (!r.isValid) throw new Error("No stroke style named " + ${rep});
s.remove(r);
__result__ = { deleted: ${str(a.name)} };`;
            } else if (action === 'export') {
                const p = filePath(a.path, ['.inst']);
                const pickNames = Array.isArray(a.names) && a.names.length
                    ? `var list = [], want = ${json(a.names.map((n) => String(n)))};
for (var i = 0; i < want.length; i++) {
  var s = doc.strokeStyles.itemByName(want[i]);
  if (!s.isValid) throw new Error("No stroke style named " + want[i]);
  list.push(s);
}`
                    : 'var list = __customStrokeStyles(doc);';
                body = `${STYLE_LIST_JSX}
${pickNames}
if (!list.length) throw new Error("The document has no custom stroke styles to save");
doc.exportStrokeStyles(new File(${p}), list, "");
__result__ = { saved: list.length, path: ${p} };`;
            } else {
                const p = filePath(a.path, ['.inst', '.indd']);
                body = `var f = new File(${p});
if (!f.exists) throw new Error("File not found: " + ${p});
doc.importStyles(ImportFormat.STROKE_STYLES_FORMAT, f);
__result__ = { loaded: ${p}, strokeStyles: doc.strokeStyles.length };`;
            }
            return run('Manage stroke styles', script(body));
        },
    },
    {
        name: 'get_object_options',
        description: 'Read items\' Stroke panel options, Attributes panel options (nonprinting, overprint) and content type, Frame Fitting Options, and Anchored Object Options. Stroke weights and dash lengths are points; crops and offsets mm',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                include: { type: 'array', items: { type: 'string', enum: SECTIONS }, description: `What to read (default: all of ${SECTIONS.join(', ')})` },
            },
            required: ['target'],
        },
        features: [
            'indesign.frames_objects.stroke_panel',
            'indesign.frames_objects.frame_fitting_options',
            'indesign.frames_objects.anchored_object_options',
        ],
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            let inc = SECTIONS;
            if (has(a.include)) {
                if (!Array.isArray(a.include) || !a.include.length) throw new Error("'include' must be a non-empty list");
                inc = [...new Set(a.include.map((s) => enumOf(s, SECTIONS, { name: 'include' })))];
            }
            const blocks = inc.filter((s) => s !== 'anchored').map(readBlock);
            if (inc.includes('anchored')) blocks.push('r.anchored = __isAnchored(it) ? __anchoredInfo(it) : null;');
            return run('Get object options', script(`${ANCHORED_JSX}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], r = { item: __itemInfo(it) };
  ${blocks.join('\n  ')}
  out.push(r);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'set_frame_fitting',
        description: 'Set Frame Fitting Options (Object > Fitting > Frame Fitting Options: fitting on empty frame, reference point, Auto-Fit and crop amounts), clear them (Clear Frame Fitting Options), and fit the content now, including Content-Aware Fit',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                fitting: enumSchema(EMPTY_FIT, 'Fitting on Empty Frame: how content placed later is fitted'),
                referencePoint: enumSchema(ANCHOR_POINTS, 'Align From: the reference point for fitting and cropping'),
                autoFit: { type: 'boolean', description: 'Auto-Fit: refit the content whenever the frame is resized' },
                crop: {
                    type: 'object',
                    description: 'Crop Amount (mm; negative adds space around the content)',
                    properties: {
                        top: { type: 'number', description: 'Top crop (mm)' },
                        left: { type: 'number', description: 'Left crop (mm)' },
                        bottom: { type: 'number', description: 'Bottom crop (mm)' },
                        right: { type: 'number', description: 'Right crop (mm)' },
                    },
                },
                clear: { type: 'boolean', description: 'Clear Frame Fitting Options first' },
                fitNow: enumSchema(FIT_NOW, 'Fit the content now (Object > Fitting): content_aware is Content-Aware Fit'),
            },
            required: ['target'],
        },
        features: [
            'indesign.frames_objects.frame_fitting_options',
            'indesign.frames_objects.auto_fit',
            'indesign.frames_objects.clear_frame_fitting_options',
            'indesign.frames_objects.content_aware_fit',
            'indesign.frames_objects.fit_content_proportionally',
            'indesign.frames_objects.fit_fill_frame_proportionally',
            'indesign.frames_objects.fit_content_to_frame',
            'indesign.frames_objects.fit_frame_to_content',
            'indesign.frames_objects.center_content',
        ],
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const lines = [];
            if (has(a.clear)) { if (flag(a.clear, 'clear') === 'true') lines.push('it.clearFrameFittingOptions();'); }
            if (has(a.fitting)) lines.push(`ff.fittingOnEmptyFrame = ${pick(a.fitting, EMPTY_FIT, 'fitting')};`);
            if (has(a.referencePoint)) lines.push(`ff.fittingAlignment = ${pick(a.referencePoint, ANCHOR_POINTS, 'referencePoint')};`);
            if (has(a.autoFit)) lines.push(`ff.autoFit = ${flag(a.autoFit, 'autoFit')};`);
            const c = group(a.crop, ['top', 'left', 'bottom', 'right'], 'crop');
            if (c) for (const side of ['top', 'left', 'bottom', 'right']) {
                if (has(c[side])) lines.push(`ff.${side}Crop = ${num(c[side], { min: -5000, max: 5000, name: `crop.${side}` })};`);
            }
            if (has(a.fitNow)) lines.push(`it.fit(${pick(a.fitNow, FIT_NOW, 'fitNow')});`);
            if (!lines.length) throw new Error('Nothing to do: give fitting, referencePoint, autoFit, crop, clear or fitNow');
            return run('Set frame fitting', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], ff = it.frameFittingOptions;
  ${lines.join('\n  ')}
  out.push({ item: __itemInfo(it), fitting: __enumName(ff.fittingOnEmptyFrame), referencePoint: __enumName(ff.fittingAlignment), autoFit: ff.autoFit });
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'insert_anchored_object',
        description: 'Anchor an object in text (Object > Anchored Object > Insert): either a new rectangle, ellipse, polygon, text frame or line created at a text position, or an existing item moved into the text. Set its Anchored Object Options in the same call',
        inputSchema: {
            type: 'object',
            properties: {
                at: TEXT_AT,
                itemId: { type: 'integer', minimum: 0, description: 'Anchor this existing item (instead of creating one)' },
                create: {
                    type: 'object',
                    description: 'Create a new anchored object (instead of itemId); shape is required',
                    properties: {
                        shape: { type: 'string', enum: Object.keys(ANCHOR_CREATE), description: 'The kind of object' },
                        width: { type: 'number', minimum: 0.01, description: 'Width in mm (default: the anchored object defaults)' },
                        height: { type: 'number', minimum: 0.01, description: 'Height in mm (default: the anchored object defaults)' },
                        objectStyle: { type: 'string', description: 'Object style to apply' },
                    },
                },
                options: ANCHOR_OPTIONS_SCHEMA,
            },
            required: ['at'],
        },
        features: ['indesign.frames_objects.anchored_object_insert', 'indesign.frames_objects.anchored_object_options'],
        hints: { readOnly: false },
        auditArgs: { at: { frameId: 7, characterIndex: 3 }, itemId: undefined, create: { shape: 'rectangle', width: 20, height: 15, objectStyle: 'Sidebar' }, options: { position: 'custom', anchorPoint: 'top_left', horizontalReferencePoint: 'text_frame', verticalReferencePoint: 'line_baseline', xOffset: 2, lockPosition: true } },
        handler: (a) => {
            if (has(a.itemId) === has(a.create)) throw new Error('Give itemId (an existing item) or create (a new object), not both');
            const at = textAtSpec(a.at);
            const opts = anchorStatements(a.options);
            const pos = a.options?.position ? pick(a.options.position, ANCHORED_POSITION, 'options.position') : 'AnchorPosition.INLINE_POSITION';
            let make;
            if (has(a.itemId)) {
                make = `var it = __item(doc, ${index(a.itemId, { name: 'itemId', max: 1e9 })}), oid = it.id;
it.anchoredObjectSettings.insertAnchoredObject(ip, ${pos});
it = __reresolve(doc, oid, it);`;
            } else {
                const c = group(a.create, ['shape', 'width', 'height', 'objectStyle'], 'create');
                const coll = ANCHOR_CREATE[enumOf(c.shape, Object.keys(ANCHOR_CREATE), { name: 'create.shape' })];
                const w = has(c.width) ? num(c.width, { min: 0.01, max: 5000, name: 'create.width' }) : 'doc.anchoredObjectDefaults.initialAnchorWidth';
                const h = has(c.height) ? num(c.height, { min: 0.01, max: 5000, name: 'create.height' }) : 'doc.anchoredObjectDefaults.initialAnchorHeight';
                const style = has(c.objectStyle) ? `
var os = doc.objectStyles.itemByName(${text(c.objectStyle, 'create.objectStyle')});
if (!os.isValid) throw new Error("No object style named " + ${str(c.objectStyle)});
it.appliedObjectStyle = os;` : '';
                make = `var it = ip.${coll}.add();
var g = it.geometricBounds;
it.geometricBounds = [g[0], g[1], g[0] + (${h}), g[1] + (${w})];${style}`;
            }
            return run('Insert anchored object', script(`${TEXT_AT_JSX}${ANCHORED_JSX}${RERESOLVE_JSX}
var ip = __textAt(doc, ${at});
${make}
var s = it.anchoredObjectSettings;
${opts.join('\n')}
__result__ = { anchored: __anchoredInfo(it), item: __itemInfo(it) };`));
        },
    },
    {
        name: 'set_anchored_object_options',
        description: 'Set Anchored Object Options on anchored items (Object > Anchored Object > Options), rotate and scale them within their anchor settings, or release them so they no longer move with the text (Object > Anchored Object > Release)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                options: ANCHOR_OPTIONS_SCHEMA,
                transform: {
                    type: 'object',
                    description: 'Transform the anchored objects',
                    properties: {
                        rotationAngle: { type: 'number', minimum: -360, maximum: 360, description: 'Rotation angle (degrees)' },
                        horizontalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Horizontal scale (%)' },
                        verticalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Vertical scale (%)' },
                    },
                },
                release: { type: 'boolean', description: 'Release the anchored objects (after any options and transform)' },
            },
            required: ['target'],
        },
        features: [
            'indesign.frames_objects.anchored_object_options',
            'indesign.frames_objects.anchored_object_transform',
            'indesign.frames_objects.anchored_object_release',
        ],
        hints: { readOnly: false },
        auditArgs: { options: { position: 'above_line', horizontalAlignment: 'center', spaceAbove: 2 }, transform: { rotationAngle: 15, horizontalScale: 90, verticalScale: 90 }, release: false },
        handler: (a) => {
            const spec = targetSpec(a.target);
            const opts = anchorStatements(a.options);
            const t = group(a.transform, ['rotationAngle', 'horizontalScale', 'verticalScale'], 'transform');
            const tr = [];
            if (t && has(t.rotationAngle)) tr.push(`it.rotationAngle = ${num(t.rotationAngle, { min: -360, max: 360, name: 'transform.rotationAngle' })};`);
            if (t && has(t.horizontalScale)) tr.push(`it.horizontalScale = ${num(t.horizontalScale, { min: 1, max: 1000, name: 'transform.horizontalScale' })};`);
            if (t && has(t.verticalScale)) tr.push(`it.verticalScale = ${num(t.verticalScale, { min: 1, max: 1000, name: 'transform.verticalScale' })};`);
            const release = has(a.release) && flag(a.release, 'release') === 'true';
            if (!opts.length && !tr.length && !release) throw new Error('Nothing to do: give options, transform or release: true');
            return run('Set anchored object options', script(`${ANCHORED_JSX}
var items = __targets(doc, ${spec}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (!__isAnchored(it)) throw new Error("Item " + it.id + " is not an anchored object");
  var s = it.anchoredObjectSettings;
  ${opts.join('\n  ')}
  ${tr.join('\n  ')}
  ${release ? 's.releaseAnchoredObject();\n  out.push({ released: true, item: __itemInfo(it) });' : 'out.push(__anchoredInfo(it));'}
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'set_anchored_object_defaults',
        description: 'Set the defaults for new anchored objects in the document: content type, object style, paragraph style and initial size (the Insert Anchored Object defaults). Returns the current values; give nothing to read them',
        inputSchema: {
            type: 'object',
            properties: {
                content: enumSchema(CONTENT, 'Content of new anchored objects'),
                objectStyle: { type: 'string', description: 'Object style for new anchored objects' },
                paragraphStyle: { type: 'string', description: 'Paragraph style for new anchored text frames' },
                width: { type: 'number', minimum: 0.01, description: 'Initial width (mm)' },
                height: { type: 'number', minimum: 0.01, description: 'Initial height (mm)' },
            },
        },
        features: ['indesign.frames_objects.anchored_object_defaults'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { objectStyle: '[None]', paragraphStyle: '[Basic Paragraph]' },
        handler: (a) => {
            const lines = [];
            if (has(a.content)) lines.push(`d.anchorContent = ${pick(a.content, CONTENT, 'content')};`);
            if (has(a.objectStyle)) {
                lines.push(`var os = doc.objectStyles.itemByName(${text(a.objectStyle, 'objectStyle')});`,
                    `if (!os.isValid) throw new Error("No object style named " + ${str(a.objectStyle)});`, 'd.anchoredObjectStyle = os;');
            }
            if (has(a.paragraphStyle)) {
                lines.push(`var ps = doc.paragraphStyles.itemByName(${text(a.paragraphStyle, 'paragraphStyle')});`,
                    `if (!ps.isValid) throw new Error("No paragraph style named " + ${str(a.paragraphStyle)});`, 'd.anchoredParagraphStyle = ps;');
            }
            if (has(a.width)) lines.push(`d.initialAnchorWidth = ${num(a.width, { min: 0.01, max: 5000, name: 'width' })};`);
            if (has(a.height)) lines.push(`d.initialAnchorHeight = ${num(a.height, { min: 0.01, max: 5000, name: 'height' })};`);
            return run('Set anchored object defaults', script(`
var d = doc.anchoredObjectDefaults;
${lines.join('\n')}
var r = { content: __enumName(d.anchorContent), width: d.initialAnchorWidth, height: d.initialAnchorHeight };
try { r.objectStyle = d.anchoredObjectStyle.name; } catch (e) { r.objectStyle = null; }
try { r.paragraphStyle = d.anchoredParagraphStyle.name; } catch (e) { r.paragraphStyle = null; }
__result__ = r;`));
        },
    },
    {
        name: 'manage_object_library',
        description: 'List the items of an open object library (id, name, type, description; optionally filtered), close a library (Library panel menu > Close Library), and set the Library panel\'s view (thumbnails, large thumbnails, list) and sort order (Sort Items). To open or create a library use transfer_resource_file',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'close', 'view', 'sort'], description: 'What to do' },
                library: LIBRARY_SCHEMA,
                filter: {
                    type: 'object',
                    description: 'list: only items matching all given criteria (case-insensitive)',
                    properties: {
                        name: { type: 'string', description: 'Text the item name contains' },
                        description: { type: 'string', description: 'Text the description contains' },
                        type: enumSchema(ASSET_TYPES, 'Item type'),
                    },
                },
                view: enumSchema(VIEWS, 'view: Thumbnail View, Large Thumbnail View or List View'),
                sort: enumSchema(SORTS, 'sort: Sort Items by name, newest, oldest or type'),
            },
            required: ['action'],
        },
        features: [
            'indesign.frames_objects.object_library',
            'indesign.frames_objects.library_close',
            'indesign.frames_objects.library_views',
            'indesign.frames_objects.library_sort',
        ],
        hints: { readOnly: false },
        auditArgs: { action: 'list', view: undefined, sort: undefined, filter: { name: 'logo', type: 'geometry' } },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'close', 'view', 'sort'], { name: 'action' });
            const allowed = { list: ['library', 'filter'], close: ['library'], view: ['library', 'view'], sort: ['library', 'sort'] }[action];
            onlyFor(a, action, allowed, ['library', 'filter', 'view', 'sort']);
            let body = `var __lib_ = __lib(${libName(a.library)});\n`;
            if (action === 'list') {
                const f = group(a.filter, ['name', 'description', 'type'], 'filter') ?? {};
                const conds = [];
                if (has(f.name)) conds.push(`String(x.name).toLowerCase().indexOf(${str(String(f.name).toLowerCase())}) < 0`);
                if (has(f.description)) conds.push(`String(x.description).toLowerCase().indexOf(${str(String(f.description).toLowerCase())}) < 0`);
                if (has(f.type)) conds.push(`x.assetType != ${pick(f.type, ASSET_TYPES, 'filter.type')}`);
                body += `var out = [];
for (var i = 0; i < __lib_.assets.length; i++) {
  var x = __lib_.assets[i];
  ${conds.length ? `if (${conds.join(' || ')}) continue;` : ''}
  out.push(__assetInfo(x));
}
__result__ = { library: __lib_.name, total: __lib_.assets.length, items: out };`;
            } else if (action === 'close') {
                body += 'var nm = __lib_.name;\n__lib_.close();\n__result__ = { closed: nm };';
            } else if (action === 'view') {
                const v = enumOf(a.view, Object.keys(VIEWS), { name: 'view' });
                body += `${panelMenu(VIEWS[v], v)}\n__result__ = { library: __lib_.name, view: "${v}" };`;
            } else {
                const s = enumOf(a.sort, Object.keys(SORTS), { name: 'sort' });
                body += `${panelMenu(SORTS[s], `by ${s}`)}\n__result__ = { library: __lib_.name, sort: "${s}" };`;
            }
            return run('Manage object library', script(`${LIBRARY_JSX}${body}`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_library_items',
        description: 'Work with items in an object library: Add Item (store page items as one item), Add Items on Page (as one item or each separately), Place Item(s) into the document, Update Library Item with page items, Item Information (name, type, description), and Delete Item(s) (Library panel menu)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'add_page', 'place', 'update', 'info', 'delete'], description: 'What to do' },
                library: LIBRARY_SCHEMA,
                target: { ...TARGET_SCHEMA, description: `add, update: the page items to store. ${TARGET_SCHEMA.description}` },
                items: { ...ASSETS_SCHEMA, description: `place, update, info, delete: ${ASSETS_SCHEMA.description}` },
                pageIndex: { ...PAGE_INDEX, description: 'add_page: the page whose items are stored (0-based)' },
                separately: { type: 'boolean', description: 'add_page: store each item on the page as its own library item' },
                name: { type: 'string', description: 'add, add_page, info: Item Name' },
                description: { type: 'string', description: 'add, add_page, info: Description' },
                type: enumSchema(ASSET_TYPES, 'add, info: Object Type'),
            },
            required: ['action'],
        },
        features: [
            'indesign.frames_objects.library_add_item',
            'indesign.frames_objects.library_add_items_on_page',
            'indesign.frames_objects.library_place_items',
            'indesign.frames_objects.library_update_item',
            'indesign.frames_objects.library_item_information',
            'indesign.frames_objects.library_delete_items',
            'indesign.frames_objects.context_delete_library_item',
        ],
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'add', target: { ids: [12, 13] }, items: undefined, pageIndex: undefined, separately: undefined, name: 'Logo lockup', description: 'Logo with tagline', type: 'geometry' },
        handler: (a) => {
            const actions = ['add', 'add_page', 'place', 'update', 'info', 'delete'];
            const action = enumOf(a.action, actions, { name: 'action' });
            const allowed = {
                add: ['library', 'target', 'name', 'description', 'type'],
                add_page: ['library', 'pageIndex', 'separately', 'name', 'description'],
                place: ['library', 'items'], update: ['library', 'target', 'items'],
                info: ['library', 'items', 'name', 'description', 'type'], delete: ['library', 'items'],
            }[action];
            onlyFor(a, action, allowed, ['library', 'target', 'items', 'pageIndex', 'separately', 'name', 'description', 'type']);
            const props = [];
            if (has(a.name)) props.push(`name: ${text(a.name, 'name')}`);
            if (has(a.description)) props.push(`description: ${str(String(a.description).slice(0, 5000))}`);
            if (has(a.type)) props.push(`assetType: ${pick(a.type, ASSET_TYPES, 'type')}`);
            let body = `var __lib_ = __lib(${libName(a.library)});\n`;
            let needsDocument = true;
            if (action === 'add') {
                body += `var items = __targets(doc, ${targetSpec(a.target)});
var x = __lib_.store(items, { ${props.join(', ')} });
__result__ = { library: __lib_.name, added: __assetInfo(x) };`;
            } else if (action === 'add_page') {
                if (!has(a.pageIndex)) throw new Error("'pageIndex' is required for add_page");
                const sep = has(a.separately) && flag(a.separately, 'separately') === 'true';
                if (sep && props.length) throw new Error("'name' and 'description' apply when the page is stored as one item");
                body += `var pg = __page(doc, ${index(a.pageIndex, { name: 'pageIndex' })});
var all = pg.pageItems.everyItem().getElements(), added = [];
if (!all.length) throw new Error("Page " + pg.name + " has no items");
${sep
        ? 'for (var i = 0; i < all.length; i++) added.push(__assetInfo(__lib_.store([all[i]], {})));'
        : `added.push(__assetInfo(__lib_.store(all, { ${[...props, 'assetType: AssetType.PAGE_TYPE'].join(', ')} })));`}
__result__ = { library: __lib_.name, added: added };`;
            } else if (action === 'place') {
                body += `var list = __assets(__lib_, ${assetSpec(a.items)}), out = [];
for (var i = 0; i < list.length; i++) {
  var placed = list[i].placeAsset(doc);
  for (var j = 0; j < placed.length; j++) { try { out.push(__itemInfo(placed[j])); } catch (e) {} }
}
__result__ = { library: __lib_.name, placed: out };`;
            } else if (action === 'update') {
                body += `var list = __assets(__lib_, ${assetSpec(a.items)});
if (list.length !== 1) throw new Error("Choose exactly one library item to update");
var items = __targets(doc, ${targetSpec(a.target)});
app.select(items, SelectionOptions.REPLACE_WITH);
__lib_.associatedPanel.visible = true;
list[0].select(SelectionOptions.REPLACE_WITH);
var ma = app.menuActions.itemByID(34410);
if (!ma.isValid || !ma.enabled) throw new Error("Update Library Item is not available now: bring the library's panel to the front");
ma.invoke();
__result__ = { library: __lib_.name, updated: __assetInfo(list[0]) };`;
            } else if (action === 'info') {
                if (!props.length) throw new Error('Nothing to set: give name, description or type');
                body += `var list = __assets(__lib_, ${assetSpec(a.items)}), out = [];
for (var i = 0; i < list.length; i++) {
  ${props.map((p) => `list[i].${p.replace(': ', ' = ')};`).join('\n  ')}
  out.push(__assetInfo(list[i]));
}
__result__ = { library: __lib_.name, items: out };`;
                needsDocument = false;
            } else {
                body += `var list = __assets(__lib_, ${assetSpec(a.items)}), out = [];
for (var i = 0; i < list.length; i++) { out.push(list[i].name); list[i].remove(); }
__result__ = { library: __lib_.name, deleted: out };`;
                needsDocument = false;
            }
            return run('Manage library items', script(`${LIBRARY_JSX}${body}`, { needsDocument }));
        },
    },
    {
        name: 'create_qr_code',
        description: 'Generate a QR code for a URL, plain text, email, text message or business card (vCard), in a new frame or in an existing frame; giving the frame of an existing QR code edits it (Object > Generate QR Code, Edit QR Code)',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: Object.keys(QR_FIELDS), description: 'What the code encodes' },
                data: {
                    type: 'object',
                    description: 'The content. url: url. text: text. email: address, subject, body. sms: number, message. vcard: firstName, lastName, jobTitle, cellPhone, phone, email, organisation, streetAddress, city, state, country, postalCode, website',
                    properties: Object.fromEntries([...new Set(Object.values(QR_FIELDS).flat())].map((k) => [k, { type: 'string', description: `The ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}` }])),
                },
                color: { ...COLOR_SCHEMA, description: `Colour of the code (default Black): ${COLOR_SCHEMA.description}` },
                frameId: { type: 'integer', minimum: 0, description: 'Put the code in this frame, replacing an existing code (Edit QR Code)' },
                pageIndex: { ...PAGE_INDEX, description: 'New frame: page index (0-based)' },
                x: { type: 'number', description: 'New frame: left edge in mm from the page\'s left' },
                y: { type: 'number', description: 'New frame: top edge in mm from the page\'s top' },
                size: { type: 'number', minimum: 5, maximum: 1000, description: 'New frame: width and height in mm (default 30)' },
            },
            required: ['type', 'data'],
        },
        features: ['indesign.frames_objects.qr_code_generate', 'indesign.frames_objects.qr_code_edit'],
        hints: { readOnly: false },
        auditArgs: { type: 'url', data: { url: 'https://example.com' }, frameId: undefined },
        handler: (a) => {
            const call = qrCall(a);
            const sw = `var sw = __swatch(doc, ${colorSpec(a.color ?? 'Black', 'color')});`;
            let frame;
            if (has(a.frameId)) {
                for (const k of ['pageIndex', 'x', 'y', 'size']) if (has(a[k])) throw new Error(`'${k}' is for a new frame; not with frameId`);
                frame = `var f = __item(doc, ${index(a.frameId, { name: 'frameId', max: 1e9 })});`;
            } else {
                if (!has(a.pageIndex) || !has(a.x) || !has(a.y)) throw new Error('Give frameId, or pageIndex, x and y for a new frame');
                const s = num(a.size ?? 30, { min: 5, max: 1000, name: 'size' });
                frame = `var pg = __page(doc, ${index(a.pageIndex, { name: 'pageIndex' })});
var f = pg.rectangles.add(), o = __toPage(pg, ${num(a.x, { min: -10000, max: 10000, name: 'x' })}, ${num(a.y, { min: -10000, max: 10000, name: 'y' })});
f.geometricBounds = [o[1], o[0], o[1] + ${s}, o[0] + ${s}];`;
            }
            return run('Create QR code', script(`
${sw}
${frame}
${call}
__result__ = { type: "${a.type}", frame: __itemInfo(f) };`));
        },
    },
    {
        name: 'manage_math_objects',
        description: 'Math expressions (InDesign 2025 and later): add a MathML expression to a page, list the document\'s expressions, edit an expression\'s MathML, size or colour (Edit MathML), and set the document defaults for size, colour and whether EPUB export writes MathML or SVG (Export Math Objects, 2026). Takes MathML, not LaTeX',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'list', 'edit', 'settings'], description: 'What to do' },
                mathml: { type: 'string', description: 'add, edit: the expression as a MathML <math> element' },
                id: { type: 'integer', minimum: 0, description: 'edit: the math object id (from list)' },
                pageIndex: { ...PAGE_INDEX, description: 'add: page index (0-based)' },
                x: { type: 'number', description: 'add: left edge in mm from the page\'s left (default 0)' },
                y: { type: 'number', description: 'add: top edge in mm from the page\'s top (default 0)' },
                fontSize: { type: 'number', minimum: 1, maximum: 1296, description: 'add, edit, settings: font size (points)' },
                color: { ...COLOR_SCHEMA, description: `add, edit, settings: colour of the expression: ${COLOR_SCHEMA.description}` },
                exportAsMathML: { type: 'boolean', description: 'settings: EPUB export writes math objects as MathML (true) or SVG (false); InDesign 2026' },
            },
            required: ['action'],
        },
        features: [
            'indesign.frames_objects.math_expressions',
            'indesign.frames_objects.math_expressions_panel',
            'indesign.frames_objects.context_edit_mathml',
            'indesign.frames_objects.export_math_objects',
        ],
        hints: { readOnly: false },
        auditArgs: { action: 'add', mathml: '<math><mi>x</mi><mo>=</mo><mn>2</mn></math>', id: undefined, exportAsMathML: undefined, color: '#202020' },
        handler: (a) => {
            const action = enumOf(a.action, ['add', 'list', 'edit', 'settings'], { name: 'action' });
            const allowed = {
                add: ['mathml', 'pageIndex', 'x', 'y', 'fontSize', 'color'], list: [],
                edit: ['mathml', 'id', 'fontSize', 'color'], settings: ['fontSize', 'color', 'exportAsMathML'],
            }[action];
            onlyFor(a, action, allowed, ['mathml', 'id', 'pageIndex', 'x', 'y', 'fontSize', 'color', 'exportAsMathML']);
            const pre = [];
            const set = (obj) => {
                const l = [];
                if (has(a.fontSize)) l.push(`${obj}.appliedMathMLFontSize = ${num(a.fontSize, { min: 1, max: 1296, name: 'fontSize' })};`);
                if (has(a.color)) {
                    pre.push(`var __mc = __swatch(doc, ${colorSpec(a.color, 'color')});`);
                    l.push(`${obj}.appliedMathMLSwatch = __mc;`);
                }
                return l;
            };
            let body;
            if (action === 'add') {
                const ml = mathml(a.mathml);
                const sets = set('m');
                body = `var pg = __page(doc, ${index(a.pageIndex ?? 0, { name: 'pageIndex' })});
var m = __maths(doc).add(${ml}, pg, doc.activeLayer, __toPage(pg, ${num(a.x ?? 0, { min: -10000, max: 10000, name: 'x' })}, ${num(a.y ?? 0, { min: -10000, max: 10000, name: 'y' })}));
${sets.join('\n')}
__result__ = { added: __mathInfo(m) };`;
            } else if (action === 'list') {
                body = `var ms = __maths(doc), out = [];
for (var i = 0; i < ms.length; i++) out.push(__mathInfo(ms[i]));
__result__ = { mathObjects: out };`;
            } else if (action === 'edit') {
                if (!has(a.id)) throw new Error("'id' is required for edit");
                const sets = [...(has(a.mathml) ? [`m.mathmlDescription = ${mathml(a.mathml)};`] : []), ...set('m')];
                if (!sets.length) throw new Error('Nothing to change: give mathml, fontSize or color');
                body = `var m = __maths(doc).itemByID(${index(a.id, { name: 'id', max: 1e9 })});
if (!m.isValid) throw new Error("No math object with id " + ${index(a.id, { name: 'id', max: 1e9 })});
${sets.join('\n')}
__result__ = { edited: __mathInfo(m) };`;
            } else {
                const sets = set('doc');
                if (has(a.exportAsMathML)) {
                    sets.push(`try { doc.preferMathMLInEpubExport = ${flag(a.exportAsMathML, 'exportAsMathML')}; } catch (e) { throw new Error("Choosing MathML or SVG for EPUB export needs InDesign 2026 (21.0) or later"); }`);
                }
                body = `__maths(doc);
${sets.join('\n')}
var r = { fontSize: doc.appliedMathMLFontSize };
try { r.color = doc.appliedMathMLSwatch.name; } catch (e) { r.color = null; }
try { r.exportAsMathML = doc.preferMathMLInEpubExport; } catch (e) { r.exportAsMathML = null; }
__result__ = r;`;
            }
            return run('Manage math objects', script(`${MATH_JSX}${pre.join('\n')}\n${body}`));
        },
    },
];
