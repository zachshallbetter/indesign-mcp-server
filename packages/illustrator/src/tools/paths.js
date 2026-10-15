/**
 * Path operations: Object > Path, Compound Path and Make Pixel Perfect.
 *
 * Commands that run without a dialog go through executeMenuCommand on the
 * targets. Average, Clean Up and Split Into Grid open a dialog, so they are
 * done through the object model instead, the way the dialogs describe them.
 * Simplify, Smooth and Offset Path also open a dialog and are not offered;
 * apply_effect's offset_path with expand covers Offset Path.
 */
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';

/** Object > Path (and neighbours) commands that open no dialog. */
export const PATH_OPERATIONS = {
    outline_stroke: 'OffsetPath v22',
    join: 'join',
    add_anchor_points: 'Add Anchor Points2',
    reverse_direction: 'Reverse Path Direction',
    divide_objects_below: 'Knife Tool2',
    release_compound_path: 'noCompoundPath',
    make_pixel_perfect: 'Make Pixel Perfect',
    expand_appearance: 'expandStyle',
};

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the selection as item info. */
const SELECTION = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));`;

/** ES3: an item and every container above it are unlocked and visible. */
const EDITABLE = `
function __editable(it) {
  var p = it;
  while (p && p.typename !== "Document") {
    try {
      if (p.typename === "Layer") { if (p.locked || !p.visible) return false; }
      else if (p.locked || p.hidden) return false;
    } catch (e) {}
    p = p.parent;
  }
  return true;
}`;

/** ES3: copy a path point's anchor, handles and type; write a list back onto a path. */
const POINTS = `
function __readPoints(p) {
  var out = [];
  for (var i = 0; i < p.pathPoints.length; i++) {
    var q = p.pathPoints[i];
    out.push({ a: q.anchor, l: q.leftDirection, r: q.rightDirection, t: q.pointType });
  }
  return out;
}
function __writePoints(p, list) {
  var anchors = [];
  for (var i = 0; i < list.length; i++) anchors.push(list[i].a);
  p.closed = false;
  p.setEntirePath(anchors);
  for (var j = 0; j < list.length; j++) {
    var q = p.pathPoints[j];
    q.leftDirection = list[j].l; q.rightDirection = list[j].r; q.pointType = list[j].t;
  }
}`;

export const tools = [
    {
        name: 'path_operation',
        description: 'Run an Object > Path command on the targets: outline_stroke (stroke to filled shape), join (connect open paths\' end points), add_anchor_points (one between each pair), reverse_direction, divide_objects_below (cut everything beneath with the target\'s shape), release_compound_path, make_pixel_perfect, expand_appearance',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(PATH_OPERATIONS) },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.geometry.outline_stroke',
            'illustrator.geometry.join',
            'illustrator.geometry.join_tool',
            'illustrator.geometry.add_anchor_points',
            'illustrator.geometry.path_reverse_direction',
            'illustrator.geometry.divide_objects_below',
            'illustrator.geometry.cut_objects',
            'illustrator.geometry.compound_release',
            'illustrator.geometry.make_pixel_perfect',
            'illustrator.appearance.expand_appearance',
        ],
        menuCommands: Object.values(PATH_OPERATIONS),
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(PATH_OPERATIONS), { name: 'operation' });
            return run('Path operation', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${op === 'divide_objects_below' ? 'if (items.length !== 1) throw new Error("divide_objects_below cuts with one object: give a single target");' : ''}
${SELECT}
app.executeMenuCommand(${str(PATH_OPERATIONS[op])});
${SELECTION}
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
    {
        name: 'average_points',
        description: 'Average anchor points (Object > Path > Average): move them onto one horizontal line, one vertical line, or one point. Handles move with their anchors. With join, connect the averaged end points afterwards (Average & Join)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                axis: { type: 'string', enum: ['horizontal', 'vertical', 'both'], description: 'horizontal: same y (a horizontal line); vertical: same x; both: one point' },
                selectedPointsOnly: { type: 'boolean', description: 'Only anchor points selected with the Direct Selection tool. Default false: every anchor of the targets', default: false },
                join: { type: 'boolean', description: 'Join the end points afterwards. Default false', default: false },
            },
            required: ['target', 'axis'],
        },
        features: ['illustrator.geometry.average', 'illustrator.geometry.average_and_join', 'illustrator.geometry.corner_join'],
        handler: (a) => {
            const axis = enumOf(a.axis, ['horizontal', 'vertical', 'both'], { name: 'axis' });
            return run('Average points', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), pts = [], counts = { paths: 0, skipped: [] };
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  for (var k = 0; k < p.pathPoints.length; k++) {
    var q = p.pathPoints[k];
    if (${bool(a.selectedPointsOnly)} && q.selected !== PathPointSelection.ANCHORPOINT) continue;
    pts.push(q);
  }
}, counts);
if (pts.length < 2) throw new Error("Averaging needs at least two anchor points");
var sx = 0, sy = 0;
for (var m = 0; m < pts.length; m++) { sx += pts[m].anchor[0]; sy += pts[m].anchor[1]; }
var ax = sx / pts.length, ay = sy / pts.length;
for (var n = 0; n < pts.length; n++) {
  var q2 = pts[n], dx = ${axis === 'horizontal' ? '0' : 'ax - q2.anchor[0]'}, dy = ${axis === 'vertical' ? '0' : 'ay - q2.anchor[1]'};
  var l = q2.leftDirection, r = q2.rightDirection, an = q2.anchor;
  q2.anchor = [an[0] + dx, an[1] + dy];
  q2.leftDirection = [l[0] + dx, l[1] + dy];
  q2.rightDirection = [r[0] + dx, r[1] + dy];
}
${a.join ? `${SELECT}\napp.executeMenuCommand("join");` : ''}
__result__ = { averaged: pts.length, axis: ${str(axis)}, joined: ${bool(a.join)} };`));
        },
    },
    {
        name: 'clean_up',
        description: 'Remove stray points (single-anchor paths), unpainted paths (no fill, no stroke) and empty text from the document (Object > Path > Clean Up). Locked and hidden objects, clipping paths, guides and the paths inside compound paths are left alone',
        inputSchema: {
            type: 'object',
            properties: {
                strayPoints: { type: 'boolean', default: true },
                unpaintedObjects: { type: 'boolean', default: true },
                emptyText: { type: 'boolean', default: true },
            },
        },
        features: [
            'illustrator.geometry.clean_up',
            'illustrator.geometry.clean_up_option.stray_points',
            'illustrator.geometry.clean_up_option.unpainted_objects',
            'illustrator.geometry.clean_up_option.empty_text_paths',
        ],
        handler: (a) => {
            const stray = a.strayPoints ?? true, unpainted = a.unpaintedObjects ?? true, empty = a.emptyText ?? true;
            if (!stray && !unpainted && !empty) throw new Error('Choose at least one of strayPoints, unpaintedObjects, emptyText');
            return run('Clean up', script(`${EDITABLE}
var removed = { strayPoints: 0, unpaintedObjects: 0, emptyText: 0 };
for (var i = doc.pathItems.length - 1; i >= 0; i--) {
  var p = doc.pathItems[i];
  if (p.parent.typename === "CompoundPathItem" || p.clipping || p.guides || !__editable(p)) continue;
  if (${bool(stray)} && p.pathPoints.length === 1) { p.remove(); removed.strayPoints++; continue; }
  if (${bool(unpainted)} && !p.filled && !p.stroked) { p.remove(); removed.unpaintedObjects++; }
}
${empty ? `for (var t = doc.textFrames.length - 1; t >= 0; t--) {
  var tf = doc.textFrames[t];
  if (tf.contents === "" && __editable(tf)) { tf.remove(); removed.emptyText++; }
}` : ''}
__result__ = removed;`));
        },
    },
    {
        name: 'split_into_grid',
        description: 'Split each target into a grid of rectangles (Object > Path > Split Into Grid): rows and columns with gutters, taking the target\'s fill, stroke and opacity. The target is replaced. Optionally add guides along the grid',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                rows: { type: 'integer', minimum: 1, maximum: 500 },
                columns: { type: 'integer', minimum: 1, maximum: 500 },
                gutter: { type: 'number', minimum: 0, description: 'Points between cells, both ways. Default 0' },
                rowGutter: { type: 'number', minimum: 0, description: 'Points between rows; overrides gutter' },
                columnGutter: { type: 'number', minimum: 0, description: 'Points between columns; overrides gutter' },
                addGuides: { type: 'boolean', description: 'Add guides along the cell edges. Default false', default: false },
            },
            required: ['target', 'rows', 'columns'],
        },
        features: [
            'illustrator.geometry.split_into_grid',
            'illustrator.geometry.split_grid_option.rows_number',
            'illustrator.geometry.split_grid_option.columns_number',
            'illustrator.geometry.split_grid_option.gutter',
            'illustrator.geometry.split_grid_option.add_guides',
        ],
        handler: (a) => {
            const rows = index(a.rows, { name: 'rows', max: 500 }), cols = index(a.columns, { name: 'columns', max: 500 });
            if (Number(rows) < 1 || Number(cols) < 1) throw new Error('rows and columns must be at least 1');
            const g = a.gutter ?? 0;
            const rg = num(a.rowGutter ?? g, { min: 0, name: 'rowGutter' }), cg = num(a.columnGutter ?? g, { min: 0, name: 'columnGutter' });
            return run('Split into grid', script(`
var items = __targets(doc, ${targetSpec(a.target)}), rows = ${rows}, cols = ${cols}, rg = __len(doc, ${rg}), cg = __len(doc, ${cg}), made = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], b = it.geometricBounds, W = b[2] - b[0], H = b[1] - b[3];
  var cw = (W - (cols - 1) * cg) / cols, ch = (H - (rows - 1) * rg) / rows;
  if (cw <= 0 || ch <= 0) throw new Error("The gutters leave no room for " + rows + " rows and " + cols + " columns in " + (it.name || it.typename));
  var src = it.typename === "PathItem" ? it : null, cells = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var top = b[1] - r * (ch + rg), left = b[0] + c * (cw + cg);
    var cell = it.layer.pathItems.rectangle(top, left, cw, ch);
    cell.move(it, ElementPlacement.PLACEBEFORE);
    if (src) {
      cell.filled = src.filled; if (src.filled) cell.fillColor = src.fillColor;
      cell.stroked = src.stroked; if (src.stroked) { cell.strokeColor = src.strokeColor; cell.strokeWidth = src.strokeWidth; }
    }
    cell.opacity = it.opacity;
    cells.push(cell.uuid);
  }
  ${a.addGuides ? `
  var guide = function (x1, y1, x2, y2) { var gd = it.layer.pathItems.add(); gd.setEntirePath([[x1, y1], [x2, y2]]); gd.guides = true; };
  // A guide along every cell edge: each row's top and bottom, each column's left and right.
  var ys = {}, xs = {};
  for (var gr = 0; gr < rows; gr++) { var ty = b[1] - gr * (ch + rg); ys[ty] = true; ys[ty - ch] = true; }
  for (var gc = 0; gc < cols; gc++) { var lx = b[0] + gc * (cw + cg); xs[lx] = true; xs[lx + cw] = true; }
  for (var y in ys) if (ys.hasOwnProperty(y)) guide(b[0], Number(y), b[2], Number(y));
  for (var x in xs) if (xs.hasOwnProperty(x)) guide(Number(x), b[1], Number(x), b[3]);` : ''}
  it.remove();
  made.push({ cells: cells, cellWidth: cw * __sf(doc), cellHeight: ch * __sf(doc) });
}
__result__ = { grids: made };`));
        },
    },
    {
        name: 'split_path',
        description: 'Cut a path at one of its anchor points (like the Scissors tool). An open path becomes two paths; a closed path opens there. Point indexes come from get_path_info',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'One path' },
                pointIndex: { type: 'integer', minimum: 0, description: '0-based anchor point index' },
            },
            required: ['target', 'pointIndex'],
        },
        features: ['illustrator.geometry.split_path'],
        handler: (a) => run('Split path', script(`${POINTS}
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1 || items[0].typename !== "PathItem") throw new Error("split_path cuts one path: give a single path (not a group or compound path)");
var p = items[0], pts = __readPoints(p), n = pts.length, i = ${index(a.pointIndex, { name: 'pointIndex' })};
if (i >= n) throw new Error("The path has " + n + " anchor points; pointIndex must be below " + n);
var results = [];
if (p.closed) {
  __writePoints(p, pts.slice(i).concat(pts.slice(0, i + 1)));
  results.push(__itemInfo(doc, p));
} else {
  if (i === 0 || i === n - 1) throw new Error("Point " + i + " is an end point of an open path; cutting there changes nothing");
  var second = p.duplicate();
  __writePoints(p, pts.slice(0, i + 1));
  __writePoints(second, pts.slice(i));
  results.push(__itemInfo(doc, p), __itemInfo(doc, second));
}
__result__ = { paths: results };`)),
    },
    {
        name: 'set_path_options',
        description: 'Set path attributes on paths (inside groups and compound paths too): even-odd or non-zero fill rule, closed or open, make or release guides, and align to pixel grid (Transform panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                evenOdd: { type: 'boolean', description: 'true: even-odd fill rule; false: non-zero winding' },
                closed: { type: 'boolean' },
                guide: { type: 'boolean', description: 'true: make the paths guides (View > Guides > Make Guides); false: release them' },
                pixelAligned: { type: 'boolean', description: 'Align to Pixel Grid (applies to the targets themselves)' },
            },
            required: ['target'],
        },
        features: ['illustrator.geometry.path_fill_rule', 'illustrator.geometry.guides_from_paths', 'illustrator.geometry.pixel_align', 'illustrator.transformations.transform_panel_option.align_to_pixel_grid'],
        handler: (a) => {
            const lines = [];
            if (a.evenOdd !== undefined) lines.push(`p.evenodd = ${bool(a.evenOdd)};`);
            if (a.closed !== undefined) lines.push(`p.closed = ${bool(a.closed)};`);
            if (a.guide !== undefined) lines.push(`p.guides = ${bool(a.guide)};`);
            if (!lines.length && a.pixelAligned === undefined) throw new Error('Give at least one of evenOdd, closed, guide, pixelAligned');
            return run('Set path options', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] };
for (var i = 0; i < items.length; i++) {
  ${a.pixelAligned !== undefined ? `items[i].pixelAligned = ${bool(a.pixelAligned)};` : ''}
  ${lines.length ? `__eachPath(items[i], function (p) { ${lines.join(' ')} }, counts);` : ''}
}
__result__ = { items: items.length, paths: counts.paths, skipped: counts.skipped };`));
        },
    },
    {
        name: 'get_path_info',
        description: 'Describe paths (inside groups and compound paths too): closed, fill rule, guide, anchor count, area and length, and optionally every anchor point with its handles and type, in artboard coordinates',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                includePoints: { type: 'boolean', description: 'List anchor points. Default false', default: false },
            },
            required: ['target'],
        },
        features: ['illustrator.geometry.path_area_length'],
        handler: (a) => run('Get path info', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), f = __sf(doc), out = [], total = 0, counts = { paths: 0, skipped: [] };
function pt(ab, v) { return [(v[0] - ab.left) * f, (ab.top - v[1]) * f]; }
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  var info = __itemInfo(doc, p);
  info.closed = p.closed; info.evenOdd = p.evenodd; info.guide = p.guides; info.points = p.pathPoints.length;
  info.area = p.area * f * f; info.length = p.length * f;
  ${a.includePoints ? `
  var ab = __artboard(doc, info.artboardIndex >= 0 ? info.artboardIndex : 0), list = [];
  for (var k = 0; k < p.pathPoints.length && total < 5000; k++, total++) {
    var q = p.pathPoints[k];
    list.push({ index: k, anchor: pt(ab, q.anchor), left: pt(ab, q.leftDirection), right: pt(ab, q.rightDirection), type: q.pointType === PointType.SMOOTH ? "smooth" : "corner" });
  }
  info.anchors = list;` : ''}
  out.push(info);
}, counts);
__result__ = { paths: out, skipped: counts.skipped };`)),
    },
];
