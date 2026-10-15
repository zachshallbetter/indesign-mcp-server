/**
 * The perspective grid: presets, visibility, the active plane, and putting
 * objects on and off the grid.
 *
 * The object model selects, imports and exports presets, shows and hides the
 * grid, sets the active plane and brings objects into perspective
 * (Document.selectPerspectivePreset, PageItem.bringInPerspective and their
 * neighbours). The grid's own settings (viewing angle, horizon, gridlines)
 * live in the Define Grid dialog and reach a script only through a preset.
 * View > Perspective Grid toggles and Object > Perspective commands that open
 * no dialog run as menu commands.
 */
import { str, num, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

/** The built-in presets, as View > Perspective Grid lists them. */
export const BUILT_IN_PRESETS = { one_point: '[1P-Normal View]', two_point: '[2P-Normal View]', three_point: '[3P-Normal View]' };
const PLANES = { left: 'LEFTPLANE', right: 'RIGHTPLANE', floor: 'FLOORPLANE' };
/** View > Perspective Grid toggles (no dialog); each flips the current state. */
const TOGGLES = { rulers: 'Show Ruler', snap: 'Snap to Grid', lock_grid: 'Lock Perspective Grid', lock_station_point: 'Lock Station Point' };

/** ES3: the active plane's name. */
const PLANE_NAME = `
function __planeName(p) {
  if (p == PerspectiveGridPlaneType.LEFTPLANE) return "left";
  if (p == PerspectiveGridPlaneType.RIGHTPLANE) return "right";
  if (p == PerspectiveGridPlaneType.FLOORPLANE) return "floor";
  return "none";
}`;

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** A preset name: a built-in shortcut or a saved preset's name. */
function presetName(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('preset must be one_point, two_point, three_point or a saved preset\'s name');
    if (value in BUILT_IN_PRESETS) return BUILT_IN_PRESETS[value];
    if (value.length > 200) throw new Error('preset name too long');
    return value;
}

export const tools = [
    {
        name: 'set_perspective_grid',
        description: 'Set up the perspective grid (View > Perspective Grid): choose a preset (one_point, two_point, three_point or a saved preset\'s name), show or hide the grid, set the active plane, move the plane to match an object, and flip the grid\'s toggles (Show Rulers, Snap to Grid, Lock Grid, Lock Station Point). While the grid is shown with an active plane, create_* tools draw in perspective on that plane. Viewing angle, horizon and gridline settings come only from a preset: use import_perspective_presets for presets saved in Illustrator',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', description: 'one_point, two_point, three_point ([1P/2P/3P-Normal View]) or the name of a saved preset' },
                visible: { type: 'boolean', description: 'Show (true) or hide (false) the grid' },
                activePlane: { type: 'string', enum: Object.keys(PLANES), description: 'Plane to draw on. A one-point grid has only left and floor' },
                matchItem: { ...TARGET_SCHEMA, description: 'An object in perspective: move the grid plane to match it (Object > Perspective > Move Plane to Match Object)' },
                toggle: { type: 'array', items: { type: 'string', enum: Object.keys(TOGGLES) }, description: 'Settings to flip. Illustrator does not report their state, so each one is turned on if off and off if on' },
            },
        },
        features: [
            'illustrator.perspective.grid',
            'illustrator.perspective.show_hide_grid',
            'illustrator.perspective.define_grid_option.preset_grid',
            'illustrator.perspective.define_grid_option.type_grid',
            'illustrator.perspective.one_point_normal',
            'illustrator.perspective.two_point_normal',
            'illustrator.perspective.three_point_normal',
            'illustrator.perspective.active_plane',
            'illustrator.perspective.show_rulers',
            'illustrator.perspective.snap_to_grid',
            'illustrator.perspective.lock_grid',
            'illustrator.perspective.lock_station_point',
            'illustrator.perspective.move_plane_to_object',
        ],
        menuCommands: [...Object.values(TOGGLES), 'Show Object Grid Plane'],
        auditArgs: { preset: 'two_point', visible: true, activePlane: 'left', matchItem: { selection: true }, toggle: ['snap', 'rulers'] },
        handler: (a) => {
            const preset = a.preset === undefined ? null : presetName(a.preset);
            const plane = a.activePlane === undefined ? null : PLANES[enumOf(a.activePlane, Object.keys(PLANES), { name: 'activePlane' })];
            const toggles = (a.toggle ?? []).map((t) => TOGGLES[enumOf(t, Object.keys(TOGGLES), { name: 'toggle' })]);
            if (preset === null && a.visible === undefined && plane === null && !a.matchItem && !toggles.length) {
                throw new Error('Give at least one of preset, visible, activePlane, matchItem, toggle');
            }
            return run('Set perspective grid', script(`${PLANE_NAME}
${preset === null ? '' : `if (!doc.selectPerspectivePreset(${str(preset)})) throw new Error("No perspective grid preset named " + ${str(preset)});`}
${a.visible === undefined ? '' : a.visible ? 'doc.showPerspectiveGrid();' : 'doc.hidePerspectiveGrid();'}
var toggles = ${json(toggles)};
for (var t = 0; t < toggles.length; t++) app.executeMenuCommand(toggles[t]);
${a.matchItem ? `var items = __targets(doc, ${targetSpec(a.matchItem)});
if (items.length !== 1) throw new Error("matchItem must be one object");
${SELECT}
app.executeMenuCommand("Show Object Grid Plane");` : ''}
${plane === null ? '' : `if (!doc.setPerspectiveActivePlane(PerspectiveGridPlaneType.${plane})) throw new Error("The grid has no " + ${str(a.activePlane)} + " plane");`}
__result__ = { preset: ${json(preset)}, activePlane: __planeName(doc.getPerspectiveActivePlane()), toggled: toggles.length };`));
        },
    },
    {
        name: 'attach_to_perspective',
        description: 'Put objects into perspective on a grid plane. Without a position, they are attached where they are (Object > Perspective > Attach to Active Plane); with x and y they are placed at that point on the plane (PageItem.bringInPerspective, in the grid\'s own coordinates as Adobe\'s scripting guide uses them). The grid is shown first',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                plane: { type: 'string', enum: Object.keys(PLANES), description: 'Plane to attach to. Default: the active plane' },
                x: { type: 'number', description: 'Position on the plane, horizontal. Give x and y together' },
                y: { type: 'number', description: 'Position on the plane, vertical' },
            },
            required: ['target'],
        },
        features: ['illustrator.perspective.attach_active_plane', 'illustrator.perspective.draw_in_perspective'],
        menuCommands: ['Attach to Active Plane'],
        auditArgs: { plane: 'floor', x: 100, y: -100 },
        handler: (a) => {
            if ((a.x === undefined) !== (a.y === undefined)) throw new Error('Give x and y together, or neither to attach objects where they are');
            const plane = a.plane === undefined ? null : PLANES[enumOf(a.plane, Object.keys(PLANES), { name: 'plane' })];
            const placed = a.x !== undefined;
            return run('Attach to perspective', script(`${PLANE_NAME}
var items = __targets(doc, ${targetSpec(a.target)});
doc.showPerspectiveGrid();
${plane === null ? '' : `if (!doc.setPerspectiveActivePlane(PerspectiveGridPlaneType.${plane})) throw new Error("The grid has no " + ${str(a.plane)} + " plane");`}
var plane = doc.getPerspectiveActivePlane();
if (plane == PerspectiveGridPlaneType.NOPLANE) throw new Error("No active plane: give plane");
${placed ? `for (var i = 0; i < items.length; i++) items[i].bringInPerspective(${num(a.x, { min: -100000, max: 100000, name: 'x' })}, ${num(a.y, { min: -100000, max: 100000, name: 'y' })}, plane);` : `${SELECT}
app.executeMenuCommand("Attach to Active Plane");`}
var out = [], sel = ${placed ? 'items' : 'doc.selection'};
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { plane: __planeName(plane), items: out };`));
        },
    },
    {
        name: 'release_perspective',
        description: 'Take objects out of perspective, keeping how they look (Object > Perspective > Release with Perspective)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.perspective.release_perspective'],
        menuCommands: ['Release with Perspective'],
        hints: { idempotent: true },
        handler: (a) => run('Release perspective', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${SELECT}
app.executeMenuCommand("Release with Perspective");
var out = [], sel = doc.selection;
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { released: out };`)),
    },
    {
        name: 'import_perspective_presets',
        description: 'Load perspective grid presets from a file exported by export_perspective_presets or Edit > Perspective Grid Presets > Export. Give preset to load only that one, and select to make it the document\'s grid',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the presets file' },
                preset: { type: 'string', description: 'Load only this preset. Default: all of them' },
                select: { type: 'boolean', description: 'Select the loaded preset for the document (needs preset). Default false', default: false },
            },
            required: ['filePath'],
        },
        features: ['illustrator.perspective.grid_presets', 'illustrator.perspective.define_grid_option.preset_grid'],
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit-perspective-presets`, preset: 'Street', select: true },
        handler: (a) => {
            if (typeof a.filePath !== 'string' || !a.filePath) throw new Error('Give filePath: the absolute path of a presets file');
            const p = paths.validate(a.filePath);
            if (a.select && !a.preset) throw new Error('select needs preset: the name to select after loading');
            const preset = a.preset === undefined ? null : presetName(a.preset);
            return run('Import perspective presets', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
${preset === null ? 'doc.importPerspectiveGridPreset(f);' : `doc.importPerspectiveGridPreset(f, ${str(preset)});`}
${a.select ? `if (!doc.selectPerspectivePreset(${str(preset)})) throw new Error("No preset named " + ${str(preset)} + " was loaded");` : ''}
__result__ = { imported: f.fsName, preset: ${json(preset)}, selected: ${a.select ? 'true' : 'false'} };`));
        },
    },
    {
        name: 'export_perspective_presets',
        description: 'Save every perspective grid preset to a file (Edit > Perspective Grid Presets > Export), to load with import_perspective_presets',
        inputSchema: {
            type: 'object',
            properties: { filePath: { type: 'string', description: 'Absolute path to write' } },
            required: ['filePath'],
        },
        features: ['illustrator.perspective.grid_presets'],
        hints: { idempotent: true },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit-perspective-presets` },
        handler: (a) => {
            if (typeof a.filePath !== 'string' || !a.filePath) throw new Error('Give filePath: the absolute path to write');
            const p = paths.validate(a.filePath);
            return run('Export perspective presets', script(`
var f = new File(${jsxPath(p)});
doc.exportPerspectiveGridPreset(f);
__result__ = { exported: f.fsName, written: f.exists };`));
        },
    },
];
