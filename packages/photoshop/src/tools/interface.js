/**
 * The interface: document window arrangement, zoom and screen modes, the
 * View > Show extras, rulers and snapping, panels and the Essentials
 * workspace, the view tools, and guides.
 *
 * Most of these are menu commands, run with Application.runMenuItem and the
 * ids Photoshop records for them. Toggles flip the current state: Photoshop
 * does not report it to scripts, so the result names what was toggled.
 */
import { str, num, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

const U = 'photoshop.ui.';

/** A menu command: a four-character id (c) or a string id (s). */
const c = (id) => `app.runMenuItem(app.charIDToTypeID(${str(id)}));`;
const s = (id) => `app.runMenuItem(app.stringIDToTypeID(${str(id)}));`;

/** Window > Arrange. */
const LAYOUTS = {
    tile_vertically: [s('tileVertically'), 'arrange_tile_all_vertically'],
    tile_horizontally: [s('tileHorizontally'), 'arrange_tile_all_horizontally'],
    two_up_vertical: [s('2upVertical'), 'arrange_two_up_vertical'],
    two_up_horizontal: [s('2upHorizontal'), 'arrange_two_up_horizontal'],
    three_up_vertical: [s('3upVertical'), 'arrange_three_up_vertical'],
    three_up_horizontal: [s('3upHorizontal'), 'arrange_three_up_horizontal'],
    three_up_stacked: [s('3upStacked'), 'arrange_three_up_stacked'],
    four_up: [s('4upTile'), 'arrange_four_up'],
    six_up: [s('6upTile'), 'arrange_six_up'],
    consolidate_to_tabs: [s('consolidateAllTabs'), 'arrange_consolidate_all_to_tabs'],
    cascade: [c('Cscd'), 'arrange_cascade'],
    tile: [c('Tile'), 'arrange_tile'],
    float_in_window: [s('floatWindow'), 'arrange_float_in_window'],
    float_all_in_windows: [s('floatAllWindows'), 'arrange_float_all_in_windows'],
    new_window: [c('NwVw'), 'arrange_new_window'],
    match_zoom: [s('matchZoom'), 'arrange_match_zoom'],
    match_location: [s('matchLocation'), 'arrange_match_location'],
    match_rotation: [s('matchRotation'), 'arrange_match_rotation'],
    match_all: [s('matchZoomAndLocation'), 'arrange_match_all'],
};

/** View menu zoom commands. */
const ZOOMS = {
    zoom_in: [c('ZmIn'), 'zoom_in'],
    zoom_out: [c('ZmOt'), 'zoom_out'],
    fit_on_screen: [c('FtOn'), 'fit_on_screen'],
    percent_100: [c('ActP'), 'view_100_percent'],
    percent_200: [s('view200Percent'), 'view_200_percent'],
    print_size: [c('PrnS'), 'print_size'],
};

/** View > Screen Mode. */
const SCREEN_MODES = {
    standard: [s('screenModeStandard'), 'screen_mode_standard'],
    full_with_menu: [s('screenModeFullScreenWithMenubar'), 'screen_mode_full_with_menu'],
    full: [s('screenModeFullScreen'), 'screen_mode_full'],
};

/** View menu toggles (Extras, Show, Rulers, Snap To, locks) and the set commands beside them. */
const VIEW_ITEMS = {
    extras: [s('toggleShowExtras'), 'extras'],
    layer_edges: [s('toggleLayerEdges'), 'show_layer_edges'],
    selection_edges: [c('TglE'), 'show_selection_edges'],
    target_path: [c('TglP'), 'show_target_path'],
    grid: [c('TgGr'), 'show_grid'],
    guides: [c('Tgld'), 'show_guides'],
    count: [s('toggleCount'), 'show_count'],
    smart_guides: [s('toggleSmartGuides'), 'show_smart_guides'],
    slices: [s('toggleSlices'), 'show_slices'],
    notes: [c('TgAn'), 'show_notes'],
    pixel_grid: [s('togglePixelGrid'), 'show_pixel_grid'],
    brush_preview: [s('toggleBrushPreview'), 'show_brush_preview'],
    show_all: [s('showAll'), 'show_all'],
    show_none: [s('showNone'), 'show_none'],
    rulers: [c('TglR'), 'rulers'],
    lock_guides: [c('TglL'), 'lock_guides'],
    lock_slices: [s('toggleLockSlices'), 'lock_slices'],
    snap: [s('snap'), 'snap'],
    snap_to_guides: [s('snapToGuides'), 'snap_to_guides'],
    snap_to_grid: [s('snapToGrid'), 'snap_to_grid'],
    snap_to_layers: [s('snapToLayerBounds'), 'snap_to_layers'],
    snap_to_slices: [s('snapToSlices'), 'snap_to_slices'],
    snap_to_document_bounds: [s('snapToDocBounds'), 'snap_to_document_bounds'],
    snap_to_all: [s('snapAll'), 'snap_to_all'],
    snap_to_none: [s('snapNone'), 'snap_to_none'],
};

/** Panels by the classPanel names the show and hide events take, with the features they perform. */
const PANELS = {
    tools: ['panelid.static.toolbar', ['tools_panel']],
    options_bar: ['panelid.static.options', ['options_bar']],
    navigator: ['panelid.static.navigator', ['navigator_panel']],
    info: ['panelid.static.info', ['info_panel', 'info_panel_toggle']],
    properties: ['panelid.static.properties', ['properties_panel']],
    histogram: ['panelid.static.histogram', ['histogram_panel']],
    tool_presets: ['panelid.static.toolpresets', ['tool_presets_panel']],
    layers: ['panelid.static.layers', []],
    channels: ['panelid.static.channels', []],
    paths: ['panelid.static.paths', []],
    history: ['panelid.static.history', []],
    actions: ['panelid.static.actions', []],
    adjustments: ['panelid.static.create', []],
    color: ['panelid.static.picker', []],
    swatches: ['panelid.static.swatches', []],
    styles: ['panelid.static.styles', []],
    brushes: ['panelid.static.brushpresets', []],
    brush_settings: ['panelid.static.brushstyler', []],
    character: ['panelid.static.textcharacter', []],
    paragraph: ['panelid.static.textparagraph', []],
    character_styles: ['panelid.static.textcharstyle', []],
    paragraph_styles: ['panelid.static.textparastyle', []],
    layer_comps: ['panelid.static.comps', []],
    clone_source: ['panelid.static.clonesource', []],
    measurement_log: ['panelid.static.measurement', []],
    notes: ['panelid.static.annotation', []],
    timeline: ['panelid.static.animation', []],
};

/** Histogram panel menu: views (set) and options (toggles). */
const HISTOGRAM_VIEWS = {
    compact: [s('histogramPaletteCompactView'), 'histogram_compact_view'],
    expanded: [s('histogramPaletteExpandedView'), 'histogram_expanded_view'],
    all_channels: [s('histogramPaletteAllChannelsView'), 'histogram_all_channels_view'],
};
const HISTOGRAM_TOGGLES = {
    statistics: [s('histogramPaletteShowStatistics'), 'histogram_show_statistics'],
    channels_in_color: [s('histogramPaletteShowChannelsInColor'), 'histogram_show_channels_in_color'],
};

/** Tools that change the view, by the Application.currentTool names Photoshop uses. */
const VIEW_TOOLS = {
    hand: ['handTool', 'hand_tool'],
    zoom: ['zoomTool', 'zoom_tool'],
    rotate_view: ['rotateTool', 'rotate_view_tool'],
    slice: ['sliceTool', 'slice_tool'],
    slice_select: ['sliceSelectTool', 'slice_select_tool'],
};

const GUIDE_ACTIONS = ['add', 'layout', 'clear', 'clear_canvas', 'from_shape', 'clear_slices'];

const ui = (list) => list.map((f) => U + f);
const tableFeatures = (table) => ui(Object.values(table).map((v) => v[1]));

/** Check an array of enum values: unique, at least one. */
function choices(value, allowed, name) {
    if (!Array.isArray(value) || !value.length) throw new Error(`'${name}' lists at least one of ${allowed.join(', ')}`);
    const out = value.map((v) => enumOf(v, allowed, { name }));
    if (new Set(out).size !== out.length) throw new Error(`'${name}' lists an item twice`);
    return out;
}

const GUIDES_RESULT = `
var gs = [];
for (var gi = 0; gi < doc.guides.length; gi++) gs.push({ direction: __enumName(doc.guides[gi].direction), position: __px(doc.guides[gi].coordinate) });`;

export const tools = [
    {
        name: 'arrange_photoshop_windows',
        description: 'Arrange document windows (Window > Arrange): tile, 2-up to 6-up, consolidate to tabs, cascade, float, open a new window for the active document, or match zoom, location or rotation across windows',
        inputSchema: { type: 'object', properties: { layout: { type: 'string', enum: Object.keys(LAYOUTS), description: 'The Window > Arrange command' } }, required: ['layout'] },
        features: tableFeatures(LAYOUTS),
        handler: (a) => {
            const k = enumOf(a.layout, Object.keys(LAYOUTS), { name: 'layout' });
            return run('Arrange windows', script(`
${LAYOUTS[k][0]}
__result__ = { layout: ${str(k)}, documents: app.documents.length };`));
        },
    },
    {
        name: 'set_zoom_and_screen_mode',
        description: 'Zoom the active document (View > Zoom In, Zoom Out, Fit on Screen, 100%, 200%, Print Size) and choose the screen mode (View > Screen Mode: standard, full screen with menu bar, full screen)',
        inputSchema: {
            type: 'object',
            properties: {
                zoom: { type: 'string', enum: Object.keys(ZOOMS), description: 'The View menu zoom command' },
                screenMode: { type: 'string', enum: Object.keys(SCREEN_MODES), description: 'The screen mode' },
            },
        },
        features: [...tableFeatures(ZOOMS), ...tableFeatures(SCREEN_MODES)],
        handler: (a) => {
            if (a.zoom === undefined && a.screenMode === undefined) throw new Error('Give zoom, screenMode or both');
            const z = a.zoom !== undefined ? enumOf(a.zoom, Object.keys(ZOOMS), { name: 'zoom' }) : null;
            const m = a.screenMode !== undefined ? enumOf(a.screenMode, Object.keys(SCREEN_MODES), { name: 'screenMode' }) : null;
            return run('Set view', script(`
${z ? ZOOMS[z][0] : ''}
${m ? SCREEN_MODES[m][0] : ''}
__result__ = { zoom: ${str(z ?? '')}, screenMode: ${str(m ?? '')} };`, { needsDocument: z !== null }));
        },
    },
    {
        name: 'toggle_view_extras',
        description: 'Toggle View menu items for the active document: Extras, each View > Show item (layer and selection edges, target path, grid, guides, count, smart guides, slices, notes, pixel grid, brush preview), Rulers, Lock Guides, Lock Slices, Snap and each Snap To item. show_all, show_none, snap_to_all and snap_to_none set rather than toggle. Photoshop does not tell scripts whether an item is on',
        inputSchema: {
            type: 'object',
            properties: { items: { type: 'array', items: { type: 'string', enum: Object.keys(VIEW_ITEMS) }, minItems: 1, description: 'Items to toggle, in order' } },
            required: ['items'],
        },
        auditArgs: { items: ['grid', 'snap_to_guides', 'rulers'] },
        features: tableFeatures(VIEW_ITEMS),
        handler: (a) => {
            const items = choices(a.items, Object.keys(VIEW_ITEMS), 'items');
            return run('Toggle view items', script(`
${items.map((k) => VIEW_ITEMS[k][0]).join('\n')}
__result__ = { toggled: ${json(items)} };`));
        },
    },
    {
        name: 'show_photoshop_panels',
        description: 'Show or hide panels (Window menu), hide or show all panels at once (Tab), reset to the Essentials workspace, and use the Histogram panel menu (compact, expanded or all-channels view, statistics, channels in colour, uncached refresh) and the Info panel\'s Color Samplers item',
        inputSchema: {
            type: 'object',
            properties: {
                show: { type: 'array', items: { type: 'string', enum: Object.keys(PANELS) }, description: 'Panels to show' },
                hide: { type: 'array', items: { type: 'string', enum: Object.keys(PANELS) }, description: 'Panels to hide' },
                toggleAllPanels: { type: 'boolean', description: 'Hide all panels, or show them again (Application.togglePalettes)' },
                workspace: { type: 'string', enum: ['essentials'], description: 'Switch to Window > Workspace > Essentials (Default)' },
                histogramView: { type: 'string', enum: Object.keys(HISTOGRAM_VIEWS), description: 'Histogram panel view' },
                toggleHistogram: { type: 'array', items: { type: 'string', enum: Object.keys(HISTOGRAM_TOGGLES) }, description: 'Histogram panel options to toggle' },
                refreshHistogram: { type: 'boolean', description: 'Histogram panel Uncached Refresh' },
                toggleInfoColorSamplers: { type: 'boolean', description: 'Toggle the Info panel menu\'s Color Samplers item' },
            },
        },
        auditArgs: { hide: ['layers', 'channels'], show: ['tools', 'info'], toggleHistogram: ['statistics', 'channels_in_color'] },
        features: [...new Set([
            ...ui(['add_remove_panels', 'hide_show_panels', 'workspace_essentials', 'histogram_uncached_refresh', 'info_color_samplers']),
            ...ui(Object.values(PANELS).flatMap((p) => p[1])), ...tableFeatures(HISTOGRAM_VIEWS), ...tableFeatures(HISTOGRAM_TOGGLES),
        ])],
        handler: (a) => {
            const show = a.show ? choices(a.show, Object.keys(PANELS), 'show') : [];
            const hide = a.hide ? choices(a.hide, Object.keys(PANELS), 'hide') : [];
            if (show.some((p) => hide.includes(p))) throw new Error('A panel cannot be both shown and hidden');
            const toggles = a.toggleHistogram ? choices(a.toggleHistogram, Object.keys(HISTOGRAM_TOGGLES), 'toggleHistogram') : [];
            const lines = [];
            if (a.workspace !== undefined) {
                enumOf(a.workspace, ['essentials'], { name: 'workspace' });
                lines.push(s('defaultWorkspace'));
            }
            if (a.toggleAllPanels) lines.push('app.togglePalettes();');
            const panel = (event, k) => `__panel(${str(event)}, ${str(PANELS[k][0])});`;
            for (const k of show) lines.push(panel('show', k));
            for (const k of hide) lines.push(panel('hide', k));
            if (a.histogramView !== undefined) lines.push(HISTOGRAM_VIEWS[enumOf(a.histogramView, Object.keys(HISTOGRAM_VIEWS), { name: 'histogramView' })][0]);
            for (const k of toggles) lines.push(HISTOGRAM_TOGGLES[k][0]);
            if (a.refreshHistogram) lines.push(s('histogramPaletteUncachedRefresh'));
            if (a.toggleInfoColorSamplers) lines.push(c('InfT'));
            if (!lines.length) throw new Error('Nothing to do: give show, hide, toggleAllPanels, workspace or a Histogram or Info option');
            return run('Panels', script(`
var __panel = function (event, id) {
  var r = new ActionReference(), d = new ActionDescriptor();
  r.putName(app.stringIDToTypeID("classPanel"), id);
  d.putReference(app.stringIDToTypeID("null"), r);
  app.executeAction(app.stringIDToTypeID(event), d, DialogModes.NO);
};
${lines.join('\n')}
__result__ = { shown: ${json(show)}, hidden: ${json(hide)}, done: ${lines.length} };`, { needsDocument: false }));
        },
    },
    {
        name: 'select_view_tool',
        description: 'Make a view tool current in the Tools panel: Hand, Zoom, Rotate View (needs the graphics processor), Slice or Slice Select. Using the tool on the canvas stays with the user',
        inputSchema: { type: 'object', properties: { tool: { type: 'string', enum: Object.keys(VIEW_TOOLS), description: 'The tool' } }, required: ['tool'] },
        hints: { idempotent: true },
        features: tableFeatures(VIEW_TOOLS),
        handler: (a) => {
            const k = enumOf(a.tool, Object.keys(VIEW_TOOLS), { name: 'tool' });
            return run('Select tool', script(`
var before = app.currentTool;
app.currentTool = ${str(VIEW_TOOLS[k][0])};
__result__ = { previous: before, current: app.currentTool };`, { needsDocument: false }));
        },
    },
    {
        name: 'edit_photoshop_guides',
        description: 'Work with guides in the active document (View > Guides): add guides at pixel positions, lay out columns, rows and margins (New Guide Layout), make guides from the selected shape layer (New Guides From Shape), clear all guides or only canvas guides, or clear slices (View > Clear Slices). Returns the guides afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: GUIDE_ACTIONS, description: 'What to do' },
                direction: { type: 'string', enum: ['horizontal', 'vertical'], description: 'add: guide direction' },
                positions: { type: 'array', items: { type: 'number' }, minItems: 1, description: 'add: pixel positions from the top (horizontal) or left (vertical) edge' },
                columns: { type: 'integer', minimum: 0, maximum: 100, description: 'layout: number of columns' },
                rows: { type: 'integer', minimum: 0, maximum: 100, description: 'layout: number of rows' },
                gutter: { type: 'number', minimum: 0, description: 'layout: space between columns and between rows, in pixels. Default 0' },
                margin: {
                    type: 'object',
                    description: 'layout: margins in pixels; a guide is placed at each margin given',
                    properties: { top: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 }, bottom: { type: 'number', minimum: 0 }, right: { type: 'number', minimum: 0 } },
                },
                clearExisting: { type: 'boolean', description: 'layout: remove existing guides first. Default true', default: true },
                target: { ...TARGET_SCHEMA, description: 'from_shape: the shape layer. Default the active layer' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        auditArgs: { action: 'layout', columns: 3, rows: 2, gutter: 20, margin: { top: 10, left: 10, bottom: 10, right: 10 } },
        features: ui(['new_guide', 'new_guide_layout', 'new_guides_from_shape', 'clear_guides', 'clear_canvas_guides', 'clear_slices']),
        handler: (a) => {
            const action = enumOf(a.action, GUIDE_ACTIONS, { name: 'action' });
            let body;
            if (action === 'add') {
                const dir = { horizontal: 'HORIZONTAL', vertical: 'VERTICAL' }[enumOf(a.direction, ['horizontal', 'vertical'], { name: 'direction' })];
                if (!Array.isArray(a.positions) || !a.positions.length) throw new Error("add needs 'positions'");
                const at = a.positions.map((p, i) => num(p, { min: -300000, max: 300000, name: `positions[${i}]` }));
                body = `var at = [${at.join(', ')}];
for (var i = 0; i < at.length; i++) doc.guides.add(Direction.${dir}, new UnitValue(at[i], "px"));`;
            } else if (action === 'layout') {
                const cols = a.columns !== undefined ? Number(num(a.columns, { min: 0, max: 100, name: 'columns' })) : 0;
                const rows = a.rows !== undefined ? Number(num(a.rows, { min: 0, max: 100, name: 'rows' })) : 0;
                if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new Error("'columns' and 'rows' are whole numbers");
                const m = a.margin ?? {};
                if (typeof m !== 'object' || Array.isArray(m)) throw new Error("'margin' is { top, left, bottom, right }");
                const margin = Object.fromEntries(['top', 'left', 'bottom', 'right'].map((k) => [k, m[k] !== undefined ? Number(num(m[k], { min: 0, max: 300000, name: `margin.${k}` })) : null]));
                if (!cols && !rows && Object.values(margin).every((v) => v === null)) throw new Error('layout needs columns, rows or a margin');
                const spec = { columns: cols, rows, gutter: Number(num(a.gutter ?? 0, { min: 0, max: 300000, name: 'gutter' })), margin };
                body = `var L = ${json(spec)}, W = __px(doc.width), H = __px(doc.height);
${a.clearExisting === false ? '' : 'doc.guides.removeAll();'}
var __add = function (dir, extent, n, gutter, start, end) {
  var marks = [];
  if (start !== null) marks.push(start);
  if (end !== null) marks.push(extent - end);
  if (n > 0) {
    var s0 = start === null ? 0 : start, s1 = extent - (end === null ? 0 : end);
    var size = (s1 - s0 - gutter * (n - 1)) / n;
    if (size <= 0) throw new Error("The columns or rows do not fit: lower the gutter or margins");
    for (var k = 0; k < n; k++) { marks.push(s0 + k * (size + gutter)); marks.push(s0 + k * (size + gutter) + size); }
  }
  var seen = {};
  for (var j = 0; j < marks.length; j++) {
    var v = Math.round(marks[j] * 1000) / 1000;
    if (seen["p" + v]) continue;
    seen["p" + v] = true;
    doc.guides.add(dir, new UnitValue(v, "px"));
  }
};
__add(Direction.VERTICAL, W, L.columns, L.gutter, L.margin.left, L.margin.right);
__add(Direction.HORIZONTAL, H, L.rows, L.gutter, L.margin.top, L.margin.bottom);`;
            } else if (action === 'clear') {
                body = 'doc.guides.removeAll();';
            } else if (action === 'clear_canvas') {
                body = 'app.executeAction(app.stringIDToTypeID("clearCanvasGuides"), new ActionDescriptor(), DialogModes.NO);';
            } else if (action === 'from_shape') {
                body = `var shape = __targets(doc, ${targetSpec(a.target ?? { active: true })})[0];
doc.activeLayer = shape;
app.executeAction(app.stringIDToTypeID("newGuidesFromTarget"), new ActionDescriptor(), DialogModes.NO);`;
            } else {
                body = s('clearSlices');
            }
            return run('Guides', script(`
${body}
${GUIDES_RESULT}
__result__ = { action: ${str(action)}, guides: gs };`));
        },
    },
];

