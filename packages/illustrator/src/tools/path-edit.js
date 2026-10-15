/**
 * Path editing: anchor points and handles, copying paths, Simplify, compound
 * shapes, Repeat Pathfinder and Intertwine.
 *
 * Anchor points are edited through the object model (PathPoint). Simplify and
 * the Pathfinder panel's compound shape commands have no object-model member
 * and no dialog-free menu command, so they are played as one-event Actions
 * (src/action.js) with the parameter codes that published scripts and recorded
 * action sets establish:
 *
 *   ai_plugin_simplify: 'rdge' curve precision (percent), 'amnt' angle
 *   threshold (degrees), 'smth' straight lines, 'smpl' show original.
 *   ten-A, Extend_Script_experimentals/simplify.jsx (MIT); bjango, Greyprint
 *   Actions.aia ("Simplify to Straight Lines" sets 'smth').
 *
 *   ai_compound_shape ('name' shape mode: 0 add, 1 intersect, 2 exclude,
 *   3 minus front; 'mode' 0), ai_expand_compound_shape ('xpnd' 0) and
 *   ai_release_compound_shape ('rlse' 0): swwwitch, illustrator-scripts,
 *   jsx/fx/AiSmartPathfinderPalette.jsx.
 *
 * Smooth has no such route: it opens a slider and no published script or
 * recording carries its value, so it is not offered.
 */
import { str, num, index, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, ARTBOARD_SCHEMA, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { playAction } from '../action.js';

const POINT_SCHEMA = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

/** [x, y] from a caller, validated. */
function xy(value, name) {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`'${name}' must be [x, y] in points from the artboard's top-left`);
    return value.map((v) => Number(num(v, { name })));
}

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the selection as item info, in `out`. */
const SELECTION = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));`;

/** ES3: give a point smooth handles, aligned on one line. */
const SMOOTH = `
function __dist(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
function __smooth(p, k) {
  var pts = p.pathPoints, n = pts.length, q = pts[k], a = q.anchor, l = q.leftDirection, r = q.rightDirection, e = 0.0001;
  var prev = k > 0 ? pts[k - 1].anchor : (p.closed ? pts[n - 1].anchor : a);
  var next = k < n - 1 ? pts[k + 1].anchor : (p.closed ? pts[0].anchor : a);
  var lenL = __dist(a, l), lenR = __dist(a, r), ux = 0, uy = 0;
  if (lenR > e) { ux += (r[0] - a[0]) / lenR; uy += (r[1] - a[1]) / lenR; }
  if (lenL > e) { ux += (a[0] - l[0]) / lenL; uy += (a[1] - l[1]) / lenL; }
  var d = Math.sqrt(ux * ux + uy * uy);
  if (d < e) { ux = next[0] - prev[0]; uy = next[1] - prev[1]; d = Math.sqrt(ux * ux + uy * uy); }
  if (d < e) return false;
  ux /= d; uy /= d;
  if (lenL <= e) lenL = __dist(a, prev) / 3;
  if (lenR <= e) lenR = __dist(a, next) / 3;
  q.leftDirection = [a[0] - ux * lenL, a[1] - uy * lenL];
  q.rightDirection = [a[0] + ux * lenR, a[1] + uy * lenR];
  q.pointType = PointType.SMOOTH;
  return true;
}`;

const ANCHOR_ACTIONS = ['remove', 'corner', 'smooth', 'set'];

const SIMPLIFY = { set: 'adobe-mcp-simplify', action: 'simplify', internalName: 'ai_plugin_simplify', localizedName: 'Simplify', hasDialog: true };

/** Shape modes as ai_compound_shape enumerates them. */
export const SHAPE_MODES = { unite: [0, 'Add'], intersect: [1, 'Intersect'], exclude: [2, 'Exclude'], minus_front: [3, 'Minus Front'] };

const COMPOUND_EVENTS = {
    release: { internalName: 'ai_release_compound_shape', localizedName: 'Release Compound Shape', key: 1919710053 },
    expand: { internalName: 'ai_expand_compound_shape', localizedName: 'Expand Compound Shape', key: 2020634212 },
};

export const INTERTWINE_COMMANDS = { make: 'Partial Rearrange Make', release: 'Partial Rearrange Release' };

export const tools = [
    {
        name: 'edit_anchor_points',
        description: 'Edit anchor points of paths: remove them without splitting the path (Object > Path > Remove Anchor Points), convert them to corner points (handles retracted) or smooth points (handles aligned; retracted handles are pulled out a third of the way to the neighbouring anchors), or set one point\'s anchor and handles. Choose points by index (from get_path_info) on one path, or the anchors selected with the Direct Selection tool',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Paths, compound paths or groups. With points, exactly one path' },
                action: { type: 'string', enum: ANCHOR_ACTIONS, description: 'remove, corner, smooth, or set (one point: anchor and handles)' },
                points: { type: 'array', items: { type: 'integer', minimum: 0 }, description: '0-based anchor indexes on the one target path' },
                selectedPoints: { type: 'boolean', description: 'Act on the anchors selected with the Direct Selection tool instead of indexes' },
                anchor: { ...POINT_SCHEMA, description: 'set: new anchor [x, y]. Its handles move with it unless given' },
                leftHandle: { ...POINT_SCHEMA, description: 'set: the handle towards the previous anchor, [x, y]' },
                rightHandle: { ...POINT_SCHEMA, description: 'set: the handle towards the next anchor, [x, y]' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['target', 'action'],
        },
        features: [
            'illustrator.geometry.remove_anchor_points',
            'illustrator.geometry.convert_anchor_points',
            'illustrator.geometry.refine_paths',
        ],
        hints: { destructive: true },
        auditArgs: { action: 'set', points: [1], selectedPoints: false },
        handler: (a) => {
            const action = enumOf(a.action, ANCHOR_ACTIONS, { name: 'action' });
            const hasPoints = Array.isArray(a.points) && a.points.length > 0;
            if (a.points !== undefined && !Array.isArray(a.points)) throw new Error("'points' must be a list of anchor indexes");
            if (hasPoints && a.selectedPoints) throw new Error('Give points or selectedPoints, not both');
            const points = hasPoints ? [...new Set(a.points.map((p) => Number(index(p, { name: 'points' }))))] : null;
            if ((action === 'remove' || action === 'set') && !points && !a.selectedPoints) {
                throw new Error(`${action} needs the points: give points (indexes from get_path_info) or selectedPoints: true`);
            }
            const geometry = action === 'set' ? {
                anchor: a.anchor === undefined ? null : xy(a.anchor, 'anchor'),
                left: a.leftHandle === undefined ? null : xy(a.leftHandle, 'leftHandle'),
                right: a.rightHandle === undefined ? null : xy(a.rightHandle, 'rightHandle'),
            } : null;
            if (action === 'set') {
                if (!points || points.length !== 1) throw new Error('set changes one point: give points with exactly one index');
                if (!geometry.anchor && !geometry.left && !geometry.right) throw new Error('set needs at least one of anchor, leftHandle, rightHandle');
            } else if (a.anchor || a.leftHandle || a.rightHandle) {
                throw new Error('anchor, leftHandle and rightHandle apply to action: "set"');
            }
            const ab = index(a.artboardIndex ?? 0, { name: 'artboardIndex' });
            const mode = points ? 'indexes' : a.selectedPoints ? 'selected' : 'all';
            const body = {
                remove: `
  list.sort(function (x, y) { return y - x; });
  if (p.pathPoints.length - list.length < 2) throw new Error("Removing " + list.length + " of " + p.pathPoints.length + " anchors would leave fewer than two; delete the path with delete_items instead");
  for (var r = 0; r < list.length; r++) { p.pathPoints[list[r]].remove(); done++; }`,
                corner: `
  for (var c = 0; c < list.length; c++) {
    var q = p.pathPoints[list[c]];
    q.leftDirection = q.anchor; q.rightDirection = q.anchor; q.pointType = PointType.CORNER; done++;
  }`,
                smooth: `
  for (var s = 0; s < list.length; s++) { if (__smooth(p, list[s])) done++; else unchanged.push(list[s]); }`,
                set: `
  var q = p.pathPoints[list[0]], ab = __artboard(doc, ${ab}), g = ${json(geometry)}, old = q.anchor;
  var an = g.anchor ? __toDoc(doc, ab, g.anchor[0], g.anchor[1]) : old, dx = an[0] - old[0], dy = an[1] - old[1];
  var lh = g.left ? __toDoc(doc, ab, g.left[0], g.left[1]) : [q.leftDirection[0] + dx, q.leftDirection[1] + dy];
  var rh = g.right ? __toDoc(doc, ab, g.right[0], g.right[1]) : [q.rightDirection[0] + dx, q.rightDirection[1] + dy];
  q.anchor = an; q.leftDirection = lh; q.rightDirection = rh; done++;
  var f = __sf(doc), pt = function (v) { return [(v[0] - ab.left) * f, (ab.top - v[1]) * f]; };
  point = { index: list[0], anchor: pt(q.anchor), left: pt(q.leftDirection), right: pt(q.rightDirection), type: q.pointType === PointType.SMOOTH ? "smooth" : "corner" };`,
            }[action];
            return run('Edit anchor points', script(`${EACH_PATH}${action === 'smooth' ? SMOOTH : ''}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] }, paths = [];
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) { paths.push(p); }, counts);
if (!paths.length) throw new Error("No paths among the targets");
var mode = ${str(mode)}, wanted = ${json(points)}, done = 0, edited = 0, unchanged = [], point = null;
if (mode === "indexes" && paths.length !== 1) throw new Error("Point indexes belong to one path: give a single path, not " + paths.length);
for (var n = 0; n < paths.length; n++) {
  var p = paths[n], list = [];
  if (mode === "indexes") {
    for (var w = 0; w < wanted.length; w++) {
      if (wanted[w] >= p.pathPoints.length) throw new Error("The path has " + p.pathPoints.length + " anchor points; point " + wanted[w] + " does not exist");
      list.push(wanted[w]);
    }
  } else {
    for (var k = 0; k < p.pathPoints.length; k++) if (mode === "all" || p.pathPoints[k].selected === PathPointSelection.ANCHORPOINT) list.push(k);
  }
  if (!list.length) continue;
  edited++;
${body}
}
if (mode === "selected" && !edited) throw new Error("No anchor points are selected on the targets: select them with the Direct Selection tool, or give points");
__result__ = { action: ${str(action)}, paths: edited, points: done, unchanged: unchanged, point: point, skipped: counts.skipped };`));
        },
    },
    {
        name: 'copy_items',
        description: 'Copy paths and other items into another open document (onto its active layer or a named layer, at the same document coordinates), or onto the clipboard for pasting into other applications (Edit > Copy)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                to: { type: 'string', enum: ['document', 'clipboard'] },
                document: { type: 'string', description: 'to: "document": the name of the open document to copy into (list_documents)' },
                layer: { type: 'string', description: 'to: "document": layer in that document. Default its active layer' },
            },
            required: ['target', 'to'],
        },
        features: ['illustrator.geometry.copy_paths'],
        auditArgs: { to: 'document', document: 'Other.ai', layer: 'Layer 1' },
        handler: (a) => {
            const to = enumOf(a.to, ['document', 'clipboard'], { name: 'to' });
            if (to === 'document' && !a.document) throw new Error('to: "document" needs document: the name of an open document (list_documents)');
            if (to === 'clipboard' && (a.document || a.layer)) throw new Error('document and layer apply to to: "document"');
            if (to === 'clipboard') {
                return run('Copy items', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.copy();
__result__ = { copied: items.length, to: "clipboard" };`));
            }
            return run('Copy items', script(`
var items = __targets(doc, ${targetSpec(a.target)}), name = ${str(a.document)}, dest = null, out = [];
if (doc.name === name) throw new Error(name + " is the active document: use duplicate_items to copy within it");
for (var d = 0; d < app.documents.length; d++) if (app.documents[d].name === name) dest = app.documents[d];
if (!dest) throw new Error("No open document named " + name);
var layer = __layer(dest, ${str(a.layer ?? '')});
for (var i = items.length - 1; i >= 0; i--) out.push(items[i].duplicate(layer, ElementPlacement.PLACEATBEGINNING).uuid);
__result__ = { copied: out.length, to: name, layer: layer.name, ids: out };`));
        },
    },
    {
        name: 'simplify_path',
        description: 'Reduce the anchor points of paths while keeping their shape (Object > Path > Simplify), with Simplify\'s curve precision, corner angle threshold and straight lines options. Runs Illustrator\'s own Simplify through a temporary Action, with its dialog closed',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                curvePrecision: { type: 'number', minimum: 0, maximum: 100, description: 'Percent: how closely the result follows the original; lower removes more anchors. Default 50' },
                angleThreshold: { type: 'number', minimum: 0, maximum: 180, description: 'Degrees: corners sharper than this stay corners. Default 0' },
                straightLines: { type: 'boolean', description: 'Replace curves with straight segments. Default false' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.geometry.simplify',
            'illustrator.geometry.simplify_option.simplify_curve',
            'illustrator.geometry.simplify_option.corner_point_angle_threshold',
            'illustrator.geometry.simplify_option.convert_to_straight_lines',
        ],
        hints: { destructive: true },
        handler: (a) => {
            const parameters = [
                { key: 1919182693, type: 'unit real', value: Number(num(a.curvePrecision ?? 50, { min: 0, max: 100, name: 'curvePrecision' })), unit: 592474723 },
                { key: 1634561652, type: 'unit real', value: Number(num(a.angleThreshold ?? 0, { min: 0, max: 180, name: 'angleThreshold' })), unit: 591490663 },
                { key: 1936553064, type: 'boolean', value: Boolean(a.straightLines) },
                { key: 1936552044, type: 'boolean', value: false },
            ];
            return run('Simplify path', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] }, before = 0, after = 0;
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) { before += p.pathPoints.length; }, counts);
if (!counts.paths) throw new Error("No paths among the targets to simplify");
${SELECT}
${playAction({ ...SIMPLIFY, parameters })}
var done = doc.selection, c2 = { paths: 0, skipped: [] };
for (var m = 0; done && m < done.length; m++) __eachPath(done[m], function (p) { after += p.pathPoints.length; }, c2);
${SELECTION}
__result__ = { paths: counts.paths, anchorsBefore: before, anchorsAfter: after, selected: out };`));
        },
    },
    {
        name: 'compound_shape',
        description: 'Pathfinder panel compound shapes: make one from the targets with a shape mode (unite, intersect, exclude, minus_front; the parts stay editable), release one back into its objects, or expand one into plain paths (the panel\'s Expand button). Runs the panel\'s commands through a temporary Action',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'make: two or more objects; release and expand: compound shapes' },
                operation: { type: 'string', enum: ['make', 'release', 'expand'] },
                mode: { type: 'string', enum: Object.keys(SHAPE_MODES), description: 'make: the shape mode. Default unite' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.geometry.pf_make_compound_shape',
            'illustrator.geometry.pf_release_compound_shape',
            'illustrator.geometry.pf_expand_compound_shape',
            'illustrator.geometry.pf_expand',
        ],
        hints: { destructive: true },
        auditArgs: { operation: 'make', mode: 'minus_front' },
        handler: (a) => {
            const op = enumOf(a.operation, ['make', 'release', 'expand'], { name: 'operation' });
            if (op !== 'make' && a.mode !== undefined) throw new Error('mode applies to operation: "make"');
            let spec, check;
            if (op === 'make') {
                const [value, name] = SHAPE_MODES[enumOf(a.mode ?? 'unite', Object.keys(SHAPE_MODES), { name: 'mode' })];
                spec = {
                    set: 'adobe-mcp-compound-shape', action: 'make', internalName: 'ai_compound_shape', localizedName: 'Compound Shape',
                    parameters: [{ key: 1851878757, type: 'enumerated', name, value }, { key: 1836016741, type: 'integer', value: 0 }],
                };
                check = 'if (items.length < 2) throw new Error("A compound shape needs at least two objects");';
            } else {
                const e = COMPOUND_EVENTS[op];
                spec = { set: 'adobe-mcp-compound-shape', action: op, internalName: e.internalName, localizedName: e.localizedName, parameters: [{ key: e.key, type: 'integer', value: 0 }] };
                check = `for (var t = 0; t < items.length; t++) if (items[t].typename !== "PluginItem") throw new Error((items[t].name || items[t].typename) + " is not a compound shape: ${op} works on compound shapes made with compound_shape make or the Pathfinder panel");`;
            }
            return run('Compound shape', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${check}
${SELECT}
${playAction(spec)}
${SELECTION}
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
    {
        name: 'repeat_pathfinder',
        description: 'Apply the last Pathfinder panel operation again to the targets (Repeat Pathfinder, Cmd/Ctrl+4). It repeats what was last done in the panel, not the pathfinder tool here; if nothing was, nothing happens',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.geometry.repeat_pathfinder'],
        menuCommands: ['repeatPathfinder'],
        hints: { destructive: true },
        handler: (a) => run('Repeat pathfinder', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand("repeatPathfinder");
${SELECTION}
__result__ = { selected: out };`)),
    },
    {
        name: 'intertwine',
        description: 'Object > Intertwine (Illustrator 2023 or later). make puts overlapping objects in an Intertwine group; choosing which overlaps swap front and back is done by the user afterwards, by clicking or drawing around each overlap. release returns the objects to their original stacking',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'make: two or more overlapping objects; release: an Intertwine object' },
                operation: { type: 'string', enum: Object.keys(INTERTWINE_COMMANDS) },
            },
            required: ['target', 'operation'],
        },
        features: ['illustrator.geometry.intertwine_make', 'illustrator.geometry.intertwine_release'],
        menuCommands: Object.values(INTERTWINE_COMMANDS),
        auditArgs: { operation: 'make' },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(INTERTWINE_COMMANDS), { name: 'operation' });
            return run('Intertwine', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${op === 'make' ? 'if (items.length < 2) throw new Error("Intertwine needs at least two overlapping objects");' : 'if (items.length !== 1) throw new Error("Release one Intertwine object at a time");'}
${SELECT}
app.executeMenuCommand(${str(INTERTWINE_COMMANDS[op])});
${SELECTION}
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
];
