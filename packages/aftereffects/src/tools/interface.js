/**
 * The interface: Composition, Layer and Footage viewers and their view options
 * (zoom, resolution, channels, exposure, Fast Previews, rulers and guides), View
 * menu commands, guides, the active tool, the current time, panels and
 * workspaces.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, compSpec } from '../args.js';

const CHANNELS = {
    rgb: 'CHANNEL_RGB',
    red: 'CHANNEL_RED',
    green: 'CHANNEL_GREEN',
    blue: 'CHANNEL_BLUE',
    alpha: 'CHANNEL_ALPHA',
    red_colorize: 'CHANNEL_RED_COLORIZE',
    green_colorize: 'CHANNEL_GREEN_COLORIZE',
    blue_colorize: 'CHANNEL_BLUE_COLORIZE',
    rgb_straight: 'CHANNEL_RGB_STRAIGHT',
    alpha_boundary: 'CHANNEL_ALPHA_BOUNDARY',
    alpha_overlay: 'CHANNEL_ALPHA_OVERLAY',
};
const LAYER_PANEL_CHANNELS = ['alpha_boundary', 'alpha_overlay'];

const FAST_PREVIEW = { off: 'FP_OFF', adaptive_resolution: 'FP_ADAPTIVE_RESOLUTION', draft: 'FP_DRAFT', fast_draft: 'FP_FAST_DRAFT', wireframe: 'FP_WIREFRAME' };

const RESOLUTION = { full: 1, half: 2, third: 3, quarter: 4 };

/** View menu and viewer commands that toggle or change the focused viewer, with their ids. */
const VIEW_COMMANDS = {
    zoom_in: 2092,
    zoom_out: 2093,
    show_grid: 2277,
    snap_to_grid: 2278,
    show_layer_controls: 2435,
    share_view_options: 2699,
    one_view: 2824,
    two_views: 2825,
    four_views: 2826,
    new_viewer: 3700,
    close_viewer: 4,
};

/** Tools in the Tools panel (Project.toolType). */
const TOOLS = {
    selection: 'Tool_Arrow',
    hand: 'Tool_Hand',
    zoom: 'Tool_Magnify',
    rotation: 'Tool_Rotate',
    unified_camera: 'Tool_CameraMaya',
    orbit_around_cursor: 'Tool_CameraOrbitCursor',
    orbit_around_scene: 'Tool_CameraOrbitScene',
    orbit_camera: 'Tool_CameraOrbitCamera',
    pan_under_cursor: 'Tool_CameraPanCursor',
    pan_camera: 'Tool_CameraPanCamera',
    dolly_towards_cursor: 'Tool_CameraDollyTowardsCursor',
    dolly_to_cursor: 'Tool_CameraDollyToCursor',
    dolly_camera: 'Tool_CameraDollyCamera',
    pan_behind: 'Tool_PanBehind',
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
    horizontal_type: 'Tool_TextH',
    vertical_type: 'Tool_TextV',
    brush: 'Tool_Paintbrush',
    clone_stamp: 'Tool_CloneStamp',
    eraser: 'Tool_Eraser',
    roto_brush: 'Tool_Quickselect',
    refine_edge: 'Tool_Hairbrush',
    puppet_position_pin: 'Tool_Pin',
    puppet_starch_pin: 'Tool_PinStarch',
    puppet_bend_pin: 'Tool_PinBend',
    puppet_advanced_pin: 'Tool_PinAdvanced',
    puppet_overlap_pin: 'Tool_PinDepth',
};

/** Tool groups that share one Tools panel button; cycling moves to the next in the group. */
const TOOL_GROUPS = {
    orbit: ['orbit_around_cursor', 'orbit_around_scene', 'orbit_camera'],
    pan: ['pan_under_cursor', 'pan_camera'],
    dolly: ['dolly_towards_cursor', 'dolly_to_cursor', 'dolly_camera'],
    shape: ['rectangle', 'rounded_rectangle', 'ellipse', 'polygon', 'star'],
    pen: ['pen', 'add_vertex', 'delete_vertex', 'convert_vertex', 'mask_feather'],
    type: ['horizontal_type', 'vertical_type'],
    paint: ['brush', 'clone_stamp', 'eraser'],
    roto: ['roto_brush', 'refine_edge'],
    puppet: ['puppet_position_pin', 'puppet_starch_pin', 'puppet_bend_pin', 'puppet_advanced_pin', 'puppet_overlap_pin'],
};

/** Window menu panels with fixed command ids. */
const PANELS = { tools: 2010, info: 2028, audio: 2029, preview: 2031 };

/**
 * Built-in workspaces, found by name because their command ids follow the
 * workspace list. Names that are also a panel or menu name are left out.
 */
const WORKSPACES = ['Standard', 'Small Screen', 'All Panels', 'Color', 'Default', 'Effects', 'Minimal', 'Motion Tracking', 'Review', 'Text', 'Undocked Panels'];

/** ES3: describe a viewer and the options of each of its views. */
const VIEWER_INFO = `
var __viewerInfo = function (v) {
  if (!v) return null;
  var info = { type: __enumName(v.type), active: v.active, maximized: v.maximized, activeView: v.activeViewIndex + 1, views: [] };
  for (var i = 0; i < v.views.length; i++) {
    var o = v.views[i].options;
    var vo = { view: i + 1, active: v.views[i].active, zoomPercent: o.zoom * 100, channel: __enumName(o.channels), exposure: o.exposure,
      transparencyGrid: o.checkerboards, rulers: o.rulers, guidesVisible: o.guidesVisibility, guidesSnap: o.guidesSnap, guidesLocked: o.guidesLocked };
    try { vo.fastPreview = __enumName(o.fastPreview); } catch (e) {}
    info.views.push(vo);
  }
  return info;
};`;

/** ES3 that sets `v` to the viewer chosen by comp/layer, or the active viewer, and `c` to its composition (or null). */
function viewerTarget(a) {
    if (a.layer !== undefined) {
        return `var c = __comp(${compSpec(a.comp)}), lyr = __layers(c, ${json({ indexes: [Number(index(a.layer, { name: 'layer', max: 10000 }))] })})[0];
if (!(lyr instanceof AVLayer)) throw new Error("Layer " + lyr.index + " has no Layer panel");
var v = lyr.openInViewer();`;
    }
    if (a.comp !== undefined) return `var c = __comp(${compSpec(a.comp)}), v = c.openInViewer();`;
    return 'var c = null, v = app.activeViewer;';
}

const TARGET_PROPS = {
    comp: { ...COMP_SCHEMA, description: 'Open this composition in the Composition panel and use that viewer (item id or name). Omit both comp and layer for the focused viewer' },
    layer: { type: 'integer', minimum: 1, description: 'Open this layer (1-based, in comp or the active composition) in the Layer panel and use that viewer' },
};

export const tools = [
    {
        name: 'get_viewer_state',
        description: 'Describe the focused viewer (Composition, Layer or Footage panel) and its views: zoom, channel, exposure, Fast Previews, transparency grid, rulers and guides; the active composition\'s resolution and current time; the active tool; and whether viewer updates are paused',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['aftereffects.ui.viewer_object', 'aftereffects.ui.view_object', 'aftereffects.ui.view_options_object'],
        handler: () => run('Viewer state', script(`${VIEWER_INFO}
var comp = null, ai = proj.activeItem;
if (ai instanceof CompItem) comp = { id: ai.id, name: ai.name, time: ai.time, resolution: ai.resolutionFactor, workAreaStart: ai.workAreaStart, workAreaDuration: ai.workAreaDuration };
__result__ = { viewer: __viewerInfo(app.activeViewer), comp: comp, tool: __enumName(proj.toolType), viewerUpdatesPaused: app.disableRendering };`)),
    },
    {
        name: 'set_view_options',
        description: 'Change a viewer\'s view options: magnification (zoom percent, 100 for actual size), the Show Channel menu (RGB, red, green, blue, alpha, colorized, straight RGB; alpha boundary and overlay in the Layer panel), exposure, the transparency grid, Fast Previews (Off, Adaptive Resolution, Draft, Fast Draft, Wireframe), rulers, guides (show, snap, lock), which view is active, and maximizing the panel. Also the composition\'s resolution (Full, Half, Third, Quarter, Custom) and pausing viewer updates (Caps Lock)',
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET_PROPS,
                view: { type: 'integer', minimum: 1, maximum: 4, description: 'Make this view (1-based, in a two- or four-view layout) active and change it. Default the active view' },
                zoomPercent: { type: 'number', minimum: 1, maximum: 1600, description: 'Magnification percent; 100 is actual pixels' },
                channel: { type: 'string', enum: Object.keys(CHANNELS), description: 'Show Channel. alpha_boundary and alpha_overlay are Layer panel only' },
                exposure: { type: 'number', minimum: -40, maximum: 40, description: 'Adjust Exposure, in stops; 0 resets' },
                transparencyGrid: { type: 'boolean', description: 'Show the transparency checkerboard' },
                fastPreview: { type: 'string', enum: Object.keys(FAST_PREVIEW), description: 'Fast Previews mode (Composition panel only)' },
                rulers: { type: 'boolean', description: 'View > Show Rulers' },
                guidesVisible: { type: 'boolean', description: 'View > Show Guides' },
                guidesSnap: { type: 'boolean', description: 'View > Snap to Guides' },
                guidesLocked: { type: 'boolean', description: 'View > Lock Guides' },
                maximized: { type: 'boolean', description: 'Maximize the viewer panel, or restore it' },
                resolution: { type: 'string', enum: [...Object.keys(RESOLUTION), 'custom'], description: 'Composition resolution (down-sample factor); custom takes customResolution' },
                customResolution: {
                    type: 'object',
                    description: 'Custom resolution: render every Nth pixel across and down',
                    properties: { horizontal: { type: 'integer', minimum: 1, maximum: 99, description: 'Every Nth pixel across' }, vertical: { type: 'integer', minimum: 1, maximum: 99, description: 'Every Nth pixel down' } },
                    required: ['horizontal', 'vertical'],
                },
                pauseViewerUpdates: { type: 'boolean', description: 'Stop viewers redrawing, as Caps Lock does' },
            },
        },
        auditArgs: {
            comp: { id: 1 }, layer: undefined, view: 1, zoomPercent: 100, channel: 'alpha', exposure: 0, transparencyGrid: true, fastPreview: 'draft',
            rulers: true, guidesVisible: true, guidesSnap: true, guidesLocked: false, maximized: false, resolution: 'custom', customResolution: { horizontal: 2, vertical: 3 }, pauseViewerUpdates: false,
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.ui.viewer_object',
            'aftereffects.ui.view_object',
            'aftereffects.ui.view_options_object',
            'aftereffects.ui.maximize_panel',
            'aftereffects.ui.composition_panel',
            'aftereffects.ui.magnification_menu',
            'aftereffects.ui.zoom_100',
            'aftereffects.ui.resolution_menu',
            'aftereffects.ui.resolution_full',
            'aftereffects.ui.resolution_half',
            'aftereffects.ui.resolution_third',
            'aftereffects.ui.resolution_quarter',
            'aftereffects.ui.resolution_custom',
            'aftereffects.ui.show_channel',
            'aftereffects.ui.channel_grayscale',
            'aftereffects.ui.channel_colorize',
            'aftereffects.ui.channel_rgb_straight',
            'aftereffects.ui.alpha_boundary',
            'aftereffects.ui.alpha_overlay',
            'aftereffects.ui.adjust_exposure',
            'aftereffects.ui.toggle_transparency_grid',
            'aftereffects.ui.show_rulers',
            'aftereffects.ui.show_guides',
            'aftereffects.ui.snap_to_guides',
            'aftereffects.ui.lock_guides',
            'aftereffects.ui.fast_previews_menu',
            'aftereffects.ui.fast_previews_off',
            'aftereffects.ui.fast_previews_adaptive',
            'aftereffects.ui.fast_previews_draft',
            'aftereffects.ui.fast_previews_fast_draft',
            'aftereffects.ui.fast_previews_wireframe',
            'aftereffects.ui.disable_viewer_rendering',
        ],
        handler: (a) => {
            const O = [];
            if (a.zoomPercent !== undefined) O.push(`o.zoom = ${num(a.zoomPercent, { min: 1, max: 1600, name: 'zoomPercent' })} / 100;`);
            if (a.channel !== undefined) {
                const ch = enumOf(a.channel, Object.keys(CHANNELS), { name: 'channel' });
                if (LAYER_PANEL_CHANNELS.includes(ch)) O.push(`if (v.type !== ViewerType.VIEWER_LAYER) throw new Error("${ch} is shown only in the Layer panel: pass layer");`);
                O.push(`o.channels = ChannelType.${CHANNELS[ch]};`);
            }
            if (a.exposure !== undefined) O.push(`o.exposure = ${num(a.exposure, { min: -40, max: 40, name: 'exposure' })};`);
            if (a.transparencyGrid !== undefined) O.push(`o.checkerboards = ${bool(a.transparencyGrid)};`);
            if (a.fastPreview !== undefined) {
                O.push('if (v.type !== ViewerType.VIEWER_COMPOSITION) throw new Error("Fast Previews applies only to the Composition panel");');
                O.push(`o.fastPreview = FastPreviewType.${FAST_PREVIEW[enumOf(a.fastPreview, Object.keys(FAST_PREVIEW), { name: 'fastPreview' })]};`);
            }
            if (a.rulers !== undefined) O.push(`o.rulers = ${bool(a.rulers)};`);
            if (a.guidesVisible !== undefined) O.push(`o.guidesVisibility = ${bool(a.guidesVisible)};`);
            if (a.guidesSnap !== undefined) O.push(`o.guidesSnap = ${bool(a.guidesSnap)};`);
            if (a.guidesLocked !== undefined) O.push(`o.guidesLocked = ${bool(a.guidesLocked)};`);
            const V = [];
            if (a.view !== undefined) {
                const n = Number(index(a.view, { name: 'view', max: 4 }));
                if (n < 1) throw new Error("'view' starts at 1");
                V.push(`if (${n} > v.views.length) throw new Error("The viewer has " + v.views.length + " view(s); choose a layout with run_view_command first"); v.activeViewIndex = ${n - 1};`);
            }
            if (a.maximized !== undefined) V.push(`v.maximized = ${bool(a.maximized)};`);
            const G = [];
            if (a.resolution !== undefined) {
                const r = enumOf(a.resolution, [...Object.keys(RESOLUTION), 'custom'], { name: 'resolution' });
                let factor;
                if (r === 'custom') {
                    const cr = a.customResolution;
                    if (!cr || typeof cr !== 'object') throw new Error("resolution custom needs customResolution: { horizontal, vertical }");
                    factor = [Number(num(cr.horizontal, { min: 1, max: 99, name: 'customResolution.horizontal' })), Number(num(cr.vertical, { min: 1, max: 99, name: 'customResolution.vertical' }))];
                    if (!factor.every(Number.isInteger)) throw new Error('customResolution values are whole numbers');
                } else {
                    if (a.customResolution !== undefined) throw new Error('customResolution applies only to resolution custom');
                    factor = [RESOLUTION[r], RESOLUTION[r]];
                }
                G.push(`var rc = c || __comp({}); rc.resolutionFactor = ${json(factor)}; res = rc.resolutionFactor;`);
            } else if (a.customResolution !== undefined) {
                throw new Error('customResolution needs resolution: custom');
            }
            if (a.pauseViewerUpdates !== undefined) G.push(`app.disableRendering = ${bool(a.pauseViewerUpdates)};`);
            if (!O.length && !V.length && !G.length) throw new Error('Give at least one option to change');
            const needViewer = O.length || V.length || a.comp !== undefined || a.layer !== undefined;
            return run('View options', script(`${VIEWER_INFO}
${viewerTarget(a)}
var res = null;
${needViewer ? `if (!v) throw new Error("No viewer is open: pass comp or layer to open one");
v.setActive();
${V.join('\n')}
var o = v.views[v.activeViewIndex].options;
${O.join('\n')}` : ''}
${G.join('\n')}
__result__ = { viewer: __viewerInfo(v), resolution: res, viewerUpdatesPaused: app.disableRendering };`, { undo: 'View options' }));
        },
    },
    {
        name: 'run_view_command',
        description: 'Run a View menu or viewer command on a viewer: Zoom In, Zoom Out, Show Grid, Snap to Grid, Show Layer Controls (these toggle), the view layout (1, 2 or 4 views), Share View Options, New Viewer, or close the viewer (File > Close). Give comp to use its Composition panel; otherwise the focused viewer',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(VIEW_COMMANDS), description: 'The command' },
                comp: TARGET_PROPS.comp,
            },
            required: ['command'],
        },
        auditArgs: { command: 'four_views', comp: { name: 'Main' } },
        features: [
            'aftereffects.ui.zoom_in',
            'aftereffects.ui.zoom_out',
            'aftereffects.ui.show_grid',
            'aftereffects.ui.snap_to_grid',
            'aftereffects.ui.show_layer_controls',
            'aftereffects.ui.share_view_options',
            'aftereffects.ui.view_layout',
            'aftereffects.ui.new_viewer',
            'aftereffects.ui.close_active_panel',
        ],
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(VIEW_COMMANDS), { name: 'command' });
            return run('View command', script(`${VIEWER_INFO}
${viewerTarget({ comp: a.comp })}
if (!v) throw new Error("No viewer is open: pass comp to open one");
v.setActive();
app.executeCommand(${VIEW_COMMANDS[command]});
__result__ = { command: ${str(command)}, viewer: __viewerInfo(app.activeViewer) };`));
        },
    },
    {
        name: 'edit_comp_guides',
        description: 'Add, move, remove or clear a composition\'s ruler guides (View > Add Guide, Edit Guide, Clear Guides). Positions are pixels from the left (vertical guides) or top (horizontal guides); guides are numbered from 1 in the order they were added',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                action: { type: 'string', enum: ['add', 'move', 'remove', 'clear'], description: 'add a guide, move or remove guide n, or clear all guides' },
                orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'add: the guide\'s direction' },
                position: { type: 'number', minimum: -100000, maximum: 100000, description: 'add, move: pixels' },
                guide: { type: 'integer', minimum: 1, description: 'move, remove: the guide number (1 = first added; add returns it)' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'add', orientation: 'vertical', position: 960, guide: undefined },
        features: ['aftereffects.ui.add_guide', 'aftereffects.ui.edit_guide', 'aftereffects.ui.clear_guides'],
        handler: (a) => {
            const action = enumOf(a.action, ['add', 'move', 'remove', 'clear'], { name: 'action' });
            const pos = () => num(a.position, { min: -100000, max: 100000, name: 'position' });
            const guide = () => {
                const g = Number(index(a.guide, { name: 'guide', max: 10000 }));
                if (g < 1) throw new Error("'guide' starts at 1");
                return g - 1;
            };
            let body;
            if (action === 'add') {
                const o = enumOf(a.orientation, ['horizontal', 'vertical'], { name: 'orientation' });
                body = `var g = c.addGuide(${o === 'vertical' ? 1 : 0}, ${pos()}); __result__ = { comp: c.name, added: g + 1 };`;
            } else if (action === 'move') {
                body = `c.setGuide(${pos()}, ${guide()}); __result__ = { comp: c.name, moved: ${guide() + 1} };`;
            } else if (action === 'remove') {
                body = `c.removeGuide(${guide()}); __result__ = { comp: c.name, removed: ${guide() + 1} };`;
            } else {
                // Guides cannot be counted from scripts: remove the first until none is left.
                body = 'var n = 0; for (; n < 1000; n++) { try { c.removeGuide(0); } catch (e) { break; } } __result__ = { comp: c.name, removed: n };';
            }
            return run('Guides', script(`
var c = __comp(${compSpec(a.comp)});
${body}`, { undo: 'Guides' }));
        },
    },
    {
        name: 'set_current_tool',
        description: 'Choose the active tool in the Tools panel (selection, hand, zoom, rotation, camera orbit, pan and dolly modes, shapes, pen, type, paint, Roto Brush, puppet pins), or cycle to the next tool in a group as clicking a tool button repeatedly does. Camera tools need a camera layer',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(TOOLS), description: 'The tool to choose' },
                cycle: { type: 'string', enum: Object.keys(TOOL_GROUPS), description: 'Instead of tool: move to the next tool in this group' },
            },
        },
        auditArgs: { tool: undefined, cycle: 'orbit' },
        hints: { idempotent: true },
        features: [
            'aftereffects.ui.tools_panel',
            'aftereffects.ui.cycle_tools',
            'aftereffects.ui.selection_tool',
            'aftereffects.ui.hand_tool',
            'aftereffects.ui.zoom_tool',
            'aftereffects.ui.orbit_modes',
            'aftereffects.ui.pan_modes',
            'aftereffects.ui.dolly_modes',
        ],
        handler: (a) => {
            if ((a.tool === undefined) === (a.cycle === undefined)) throw new Error('Give tool or cycle');
            const names = Object.entries(TOOLS).map(([k, v]) => `names[ToolType.${v}] = ${str(k)};`).join(' ');
            let body;
            if (a.tool !== undefined) {
                body = `var want = ToolType.${TOOLS[enumOf(a.tool, Object.keys(TOOLS), { name: 'tool' })]};`;
            } else {
                const group = TOOL_GROUPS[enumOf(a.cycle, Object.keys(TOOL_GROUPS), { name: 'cycle' })];
                body = `var group = [${group.map((t) => `ToolType.${TOOLS[t]}`).join(', ')}], at = -1;
for (var i = 0; i < group.length; i++) if (proj.toolType === group[i]) at = i;
var want = group[(at + 1) % group.length];`;
            }
            return run('Tool', script(`
var names = {}; ${names}
var before = proj.toolType;
${body}
proj.toolType = want;
if (proj.toolType !== want) throw new Error("After Effects did not switch tools; camera tools need a camera layer in the active composition");
__result__ = { before: names[before] || String(before), tool: names[proj.toolType] || String(proj.toolType) };`));
        },
    },
    {
        name: 'go_to_time',
        description: 'Move a composition\'s current-time indicator: to a time in seconds (View > Go to Time), forward or back a number of frames (Page Down/Page Up), to the start or end, to the start or end of the work area, or to a layer\'s In or Out point',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                time: { type: 'number', minimum: 0, description: 'Seconds' },
                frames: { type: 'integer', minimum: -100000, maximum: 100000, description: 'Step this many frames; negative steps back (1 or 10 match the shortcuts)' },
                to: { type: 'string', enum: ['start', 'end', 'work_area_start', 'work_area_end', 'layer_in', 'layer_out'], description: 'Jump to this point' },
                layer: { type: 'integer', minimum: 1, description: 'layer_in, layer_out: the layer (1-based)' },
            },
        },
        auditArgs: { time: undefined, frames: undefined, to: 'layer_out', layer: 1 },
        hints: { idempotent: true },
        features: [
            'aftereffects.ui.current_time_indicator',
            'aftereffects.ui.go_to_time',
            'aftereffects.ui.frame_step',
            'aftereffects.ui.frame_step_10',
            'aftereffects.ui.go_to_start_end',
            'aftereffects.ui.go_to_work_area_bounds',
            'aftereffects.ui.go_to_in_out_point',
        ],
        handler: (a) => {
            const given = ['time', 'frames', 'to'].filter((k) => a[k] !== undefined);
            if (given.length !== 1) throw new Error('Give exactly one of time, frames or to');
            let target;
            if (a.time !== undefined) target = num(a.time, { min: 0, name: 'time' });
            else if (a.frames !== undefined) {
                const f = Number(num(a.frames, { min: -100000, max: 100000, name: 'frames' }));
                if (!Number.isInteger(f)) throw new Error("'frames' must be a whole number");
                target = `c.time + ${f} * c.frameDuration`;
            } else {
                const to = enumOf(a.to, ['start', 'end', 'work_area_start', 'work_area_end', 'layer_in', 'layer_out'], { name: 'to' });
                if (to.startsWith('layer_') !== (a.layer !== undefined)) throw new Error(to.startsWith('layer_') ? `${to} needs layer` : "'layer' applies only to layer_in and layer_out");
                const layer = a.layer !== undefined ? `__layers(c, ${json({ indexes: [Number(index(a.layer, { name: 'layer', max: 10000 }))] })})[0]` : '';
                target = {
                    start: '0',
                    end: 'c.duration - c.frameDuration',
                    work_area_start: 'c.workAreaStart',
                    work_area_end: 'c.workAreaStart + c.workAreaDuration - c.frameDuration',
                    layer_in: `${layer}.inPoint`,
                    layer_out: `${layer}.outPoint - c.frameDuration`,
                }[to];
            }
            return run('Go to time', script(`
var c = __comp(${compSpec(a.comp)});
var t = ${target};
c.time = Math.max(0, Math.min(c.duration - c.frameDuration, t));
__result__ = { comp: c.name, time: c.time, frame: Math.round(c.time / c.frameDuration) };`));
        },
    },
    {
        name: 'show_panel',
        description: 'Open or close a panel from the Window menu: Tools, Info, Audio or Preview. Choosing an open panel\'s command closes it',
        inputSchema: { type: 'object', properties: { panel: { type: 'string', enum: Object.keys(PANELS), description: 'The panel' } }, required: ['panel'] },
        features: ['aftereffects.ui.tools_panel', 'aftereffects.ui.info_panel', 'aftereffects.ui.preview_panel', 'aftereffects.audio.audio_panel'],
        handler: (a) => {
            const panel = enumOf(a.panel, Object.keys(PANELS), { name: 'panel' });
            return run('Panel', script(`app.executeCommand(${PANELS[panel]}); __result__ = { panel: ${str(panel)} };`));
        },
    },
    {
        name: 'switch_workspace',
        description: 'Switch to a built-in workspace (Window > Workspace), or reset the current workspace to its saved layout. Custom workspaces can be chosen by name with run_menu_command',
        inputSchema: {
            type: 'object',
            properties: {
                workspace: { type: 'string', enum: WORKSPACES, description: 'The workspace to switch to' },
                reset: { type: 'boolean', description: 'Reset the current (or chosen) workspace to its saved layout' },
            },
        },
        auditArgs: { workspace: 'Standard', reset: true },
        hints: { idempotent: true },
        features: ['aftereffects.ui.workspace_standard', 'aftereffects.ui.workspace_review', 'aftereffects.ui.reset_workspace'],
        handler: (a) => {
            if (a.workspace === undefined && !a.reset) throw new Error('Give workspace, reset: true, or both');
            const L = [];
            if (a.workspace !== undefined) {
                const w = enumOf(a.workspace, WORKSPACES, { name: 'workspace' });
                L.push(`var id = app.findMenuCommandId(${str(w)}); if (!id) throw new Error("No workspace named ${w} in this version of After Effects"); app.executeCommand(id);`);
            }
            if (a.reset) L.push('app.executeCommand(3566);');
            return run('Workspace', script(`
${L.join('\n')}
__result__ = { workspace: ${a.workspace !== undefined ? str(a.workspace) : 'null'}, reset: ${bool(a.reset)} };`));
        },
    },
];
