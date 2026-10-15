/**
 * Live Effects, Pathfinder, SVG filters, raster effect settings, preferences
 * and tools.
 *
 * These use routes the object model does not list but published scripts rely
 * on: LiveEffect definitions passed to PageItem.applyEffect, preference keys
 * read and written through app.preferences, and tool ids for app.selectTool.
 * See src/effects.js and the adobe-capability-atlas records they come from.
 * Document raster effect settings use the object model (RasterEffectOptions).
 */
import { readFileSync } from 'node:fs';
import { str, num, bool, enumOf, json, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import {
    EFFECTS, PATHFINDER_COMMANDS, PATHFINDER_EFFECT_ONLY, WARP_STYLES, FX_COLOR_FN, pathfinderEffect, effectOptionsHelp,
} from '../effects.js';

const TOOLS = JSON.parse(readFileSync(new URL('../data/tools.json', import.meta.url), 'utf8')).tools;

/**
 * Preferences a script can read and set by key, with the type Illustrator
 * stores them as. Only keys whose meaning and type the atlas establishes are
 * listed; keys stored as undocumented numbers (units, reference point, corner
 * scaling) are left out.
 */
export const PREFERENCES = {
    usePreviewBounds: { key: 'includeStrokeInBounds', type: 'Boolean', description: 'Measure objects including stroke width and effects (General > Use Preview Bounds)' },
    scaleStrokesAndEffects: { key: 'scaleLineWeight', type: 'Boolean', description: 'Scale stroke weights and effects when scaling objects' },
    transformPatterns: { key: 'transformPatterns', type: 'Boolean', description: 'Transform pattern tiles with objects' },
    keyboardIncrement: { key: 'cursorKeyLength', type: 'Real', description: 'Distance an arrow key moves a selection, in points' },
    cornerRadius: { key: 'ovalRadius', type: 'Real', description: 'Default corner radius for rounded rectangles, in points' },
    smartGuidesAlignment: { key: 'smartGuides/showAlignmentGuides', type: 'Boolean', description: 'Smart Guides: alignment guides' },
    smartGuidesConstruction: { key: 'smartGuides/showConstructionGuides', type: 'Boolean', description: 'Smart Guides: construction guides' },
    smartGuidesLabels: { key: 'smartGuides/showLabels', type: 'Boolean', description: 'Smart Guides: anchor and path labels' },
    smartGuidesHighlighting: { key: 'smartGuides/showObjectHighlighting', type: 'Boolean', description: 'Smart Guides: object highlighting' },
    smartGuidesMeasurements: { key: 'smartGuides/showReadouts', type: 'Boolean', description: 'Smart Guides: measurement labels' },
    smartGuidesTransformTools: { key: 'smartGuides/showToolGuides', type: 'Boolean', description: 'Smart Guides: transform tools' },
    snapToPoint: { key: 'snapToPoint', type: 'Boolean', description: 'Snap to point' },
    showPixelGrid: { key: 'Guide/ShowPixelGrid', type: 'Boolean', description: 'Show the pixel grid at high zoom' },
    penAutoAddDelete: { key: 'pen/disableAutoAddDelete', type: 'Boolean', description: 'Disable the Pen tool\'s automatic add/delete anchor (true disables it)' },
    showHandlesOnSelectedAnchors: { key: 'showDirectionHandles', type: 'Boolean', description: 'Show direction handles when several anchor points are selected (Selection & Anchor Display)' },
    highlightAnchorsOnHover: { key: 'highlightAnchorOnMouseOver', type: 'Boolean', description: 'Highlight anchors on mouse over' },
    preciseCursors: { key: 'usePreciseCursors', type: 'Boolean', description: 'Use precise cursors' },
    toolTips: { key: 'showToolTips', type: 'Boolean', description: 'Show tool tips' },
    japaneseCropMarks: { key: 'cropMarkStyle', type: 'Boolean', description: 'Use Japanese crop marks' },
    englishFontNames: { key: 'text/useEnglishFontNames', type: 'Boolean', description: 'Show font names in English' },
};

/** Toolbar names whose tool id differs: the name Illustrator shows -> the id (without "Adobe" and "Tool"). */
const TOOL_ALIASES = { mesh: 'mesh editing', 'print tiling': 'page', 'group selection': 'direct object select' };

const SHAPE_MODES = ['unite', 'intersect', 'exclude', 'minus_front'];

/** The SVG filters new documents carry (Effect > SVG Filters), each also a menu command of the same name. */
export const SVG_FILTER_PRESETS = [
    'AI_Alpha_1', 'AI_Alpha_4', 'AI_BevelShadow_1', 'AI_CoolBreeze', 'AI_Dilate_3', 'AI_Dilate_6', 'AI_Erode_3', 'AI_Erode_6',
    'AI_GaussianBlur_4', 'AI_GaussianBlur_7', 'AI_PixelPlay_1', 'AI_PixelPlay_2', 'AI_Shadow_1', 'AI_Shadow_2', 'AI_Static',
    'AI_Turbulence_3', 'AI_Turbulence_5', 'AI_Woodgrain',
];

/** Select the targets, run a menu command on them, optionally expand, and list the selection afterwards. */
const MENU_ON_TARGETS = (command, expand) => `
doc.selection = null;
for (var i = 0; i < items.length; i++) items[i].selected = true;
app.executeMenuCommand(${str(command)});
${expand ? 'app.executeMenuCommand("expandStyle");' : ''}
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));`;

/** Raster effect colour models and their RasterizationColorModel values. */
const RASTER_COLOR_MODELS = { document: 'DEFAULTCOLORMODEL', grayscale: 'GRAYSCALE', bitmap: 'BITMAP' };

/** Put the targets in a new group where the frontmost one was, keeping their order. */
const GROUP_TARGETS = `
var g = items[0].parent.groupItems.add();
g.move(items[0], ElementPlacement.PLACEBEFORE);
for (var i = items.length - 1; i >= 0; i--) items[i].move(g, ElementPlacement.PLACEATBEGINNING);`;

/** Expand the live result of a selected item and report the new selection. */
const EXPAND = `
doc.selection = null;
target.selected = true;
app.executeMenuCommand("expandStyle");
var sel = doc.selection, out = [];
if (!sel || !sel.length) throw new Error("Expanding produced no artwork");`;

export const tools = [
    {
        name: 'apply_effect',
        description: `Apply a Live Effect to items (Effect menu): Stylize, Distort & Transform, Warp, Path, Convert to Shape, Crop Marks, Rasterize, Gaussian Blur and NTSC Colors. It stays editable in the Appearance panel unless expand is true, which turns the result into plain artwork. Raster effects render at the document raster effects resolution (set_raster_effect_settings). Options per effect: ${effectOptionsHelp()}`,
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                effect: { type: 'string', enum: Object.keys(EFFECTS) },
                options: { type: 'object', description: 'The effect\'s options, as listed in the tool description' },
                expand: { type: 'boolean', description: 'Expand the result to plain artwork (Object > Expand Appearance). Default false', default: false },
            },
            required: ['target', 'effect'],
        },
        features: [
            'illustrator.effects.live_effect',
            'illustrator.effects.raster_vs_vector_effects',
            'illustrator.effects.offset_path',
            'illustrator.geometry.offset_path',
            'illustrator.geometry.offset_path_option.offset',
            'illustrator.geometry.offset_path_option.joins',
            'illustrator.geometry.offset_path_option.miter_limit',
            'illustrator.effects.round_corners',
            'illustrator.effects.roughen',
            'illustrator.effects.transform',
            'illustrator.effects.drop_shadow',
            'illustrator.effects.drop_shadow_option.mode_drop_shadow',
            'illustrator.effects.drop_shadow_option.opacity_drop_shadow',
            'illustrator.effects.drop_shadow_option.x_offset',
            'illustrator.effects.drop_shadow_option.y_offset',
            'illustrator.effects.drop_shadow_option.blur',
            'illustrator.effects.drop_shadow_option.color_drop_shadow',
            'illustrator.effects.drop_shadow_option.darkness',
            'illustrator.effects.inner_glow',
            'illustrator.effects.outer_glow',
            'illustrator.effects.glow_option.mode_glow',
            'illustrator.effects.glow_option.opacity_glow',
            'illustrator.effects.glow_option.blur_glow',
            'illustrator.effects.glow_option.center',
            'illustrator.effects.glow_option.edge',
            'illustrator.effects.feather',
            'illustrator.effects.scribble',
            'illustrator.effects.scribble_option.angle_scribble',
            'illustrator.effects.scribble_option.path_overlap',
            'illustrator.effects.scribble_option.variation',
            'illustrator.effects.scribble_option.stroke_width',
            'illustrator.effects.scribble_option.curviness',
            'illustrator.effects.scribble_option.spacing',
            'illustrator.effects.convert_rectangle',
            'illustrator.effects.convert_rounded_rectangle',
            'illustrator.effects.convert_ellipse',
            'illustrator.effects.free_distort',
            'illustrator.effects.pucker_bloat',
            'illustrator.effects.tweak',
            'illustrator.effects.twist',
            'illustrator.effects.zig_zag',
            ...Object.keys(WARP_STYLES).map((w) => `illustrator.effects.warp_${w}`),
            'illustrator.effects.warp_option.style_warp',
            'illustrator.effects.warp_option.horizontal_distortion',
            'illustrator.effects.outline_object',
            'illustrator.effects.outline_stroke',
            'illustrator.effects.crop_marks',
            'illustrator.effects.rasterize',
            'illustrator.effects.ps_gaussian_blur',
            'illustrator.effects.ps_gaussian_blur_legacy',
            'illustrator.effects.ps_ntsc_colors',
            'illustrator.appearance.expand_appearance',
            'illustrator.appearance.appearance_menu.add_new_effect',
        ],
        menuCommands: ['expandStyle', ...Object.values(EFFECTS).filter((e) => e.menu).map((e) => e.menu)],
        handler: (a) => {
            const effect = EFFECTS[enumOf(a.effect, Object.keys(EFFECTS), { name: 'effect' })];
            const options = a.options && typeof a.options === 'object' ? a.options : {};
            for (const k of effect.required ?? []) if (options[k] === undefined) throw new Error(`${a.effect} needs options.${k}`);
            const unknown = Object.keys(options).filter((k) => !(k in effect.params));
            if (unknown.length) throw new Error(`${a.effect} has no option ${unknown.join(', ')}. ${Object.keys(effect.params).length ? `Options: ${Object.keys(effect.params).join(', ')}` : 'It takes no options'}`);
            const result = `__result__ = { effect: ${str(a.effect)}, expanded: ${bool(a.expand)}, raster: ${bool(effect.raster)}, ${effect.raster ? 'rasterResolution: doc.rasterEffectSettings.resolution, ' : ''}items: out };`;
            if (effect.menu) {
                return run('Apply effect', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${MENU_ON_TARGETS(effect.menu, a.expand)}
${result}`));
            }
            return run('Apply effect', script(`${FX_COLOR_FN}
var items = __targets(doc, ${targetSpec(a.target)}), xml = ${effect.build(options)}, done = [];
for (var i = 0; i < items.length; i++) {
  var target = items[i];
  target.applyEffect(xml);
  ${a.expand ? `${EXPAND}
  for (var j = 0; j < sel.length; j++) done.push(__itemInfo(doc, sel[j]));` : 'done.push(__itemInfo(doc, target));'}
}
var out = done;
${result}`));
        },
    },
    {
        name: 'pathfinder',
        description: 'Combine shapes as the Pathfinder panel does: unite, minus front, intersect, exclude, divide, trim, merge, crop, outline, minus back, and the Effect > Pathfinder colour operations hard mix, soft mix and trap. The items are grouped and the Pathfinder effect applied; with expand (default) the result becomes plain paths, otherwise it stays a live effect on the group',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: [...Object.keys(PATHFINDER_COMMANDS), ...Object.keys(PATHFINDER_EFFECT_ONLY)] },
                expand: { type: 'boolean', description: 'Expand the result to plain paths. Default true', default: true },
                precision: { type: 'number', minimum: 0.001, maximum: 100, description: 'Pathfinder Options > Precision. Default 10' },
                removeRedundantPoints: { type: 'boolean', description: 'Pathfinder Options > Remove Redundant Points. Default false' },
                removeUnpainted: { type: 'boolean', description: 'Divide and Outline: remove unpainted artwork. Default false' },
                mixRate: { type: 'number', minimum: 0, maximum: 100, description: 'Soft mix: mixing rate in percent. Default 50' },
                trapThickness: { type: 'number', minimum: 0.01, maximum: 5000, description: 'Trap: thickness in points. Default 0.25' },
                trapHeightWidth: { type: 'number', minimum: 25, maximum: 400, description: 'Trap: height/width in percent. Default 100' },
                trapTintReduction: { type: 'number', minimum: 0, maximum: 100, description: 'Trap: tint reduction in percent. Default 40' },
                trapReverse: { type: 'boolean', description: 'Trap: reverse traps. Default false' },
                method: { type: 'string', enum: ['effect', 'menu'], description: 'effect (default) applies the Pathfinder effect; menu runs the Live Pathfinder menu command on the selection instead (not for soft mix or trap, whose commands open a dialog)', default: 'effect' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.geometry.pathfinder_panel',
            'illustrator.geometry.pf_unite',
            'illustrator.geometry.pf_minus_front',
            'illustrator.geometry.pf_intersect',
            'illustrator.geometry.pf_exclude',
            'illustrator.geometry.pf_divide',
            'illustrator.geometry.pf_trim',
            'illustrator.geometry.pf_merge',
            'illustrator.geometry.pf_crop',
            'illustrator.geometry.pf_outline',
            'illustrator.geometry.pf_minus_back',
            'illustrator.geometry.pathfinder_options',
            'illustrator.geometry.pathfinder_option.precision',
            'illustrator.geometry.pathfinder_option.remove_redundant_points',
            'illustrator.geometry.pathfinder_option.divide_and_outline_will_remove_unpainted_artwork',
            'illustrator.effects.pf_add',
            'illustrator.effects.pf_intersect',
            'illustrator.effects.pf_exclude',
            'illustrator.effects.pf_subtract',
            'illustrator.effects.pf_minus_back',
            'illustrator.effects.pf_divide',
            'illustrator.effects.pf_trim',
            'illustrator.effects.pf_merge',
            'illustrator.effects.pf_crop',
            'illustrator.effects.pf_outline',
            'illustrator.effects.pf_hard_mix',
            'illustrator.effects.pf_soft_mix',
            'illustrator.effects.pf_trap',
            'illustrator.appearance.expand_appearance',
        ],
        menuCommands: ['expandStyle', 'ungroup', 'Live Pathfinder Hard Mix', 'Live Pathfinder Add', 'Live Pathfinder Subtract', 'Live Pathfinder Intersect',
            'Live Pathfinder Exclude', 'Live Pathfinder Divide', 'Live Pathfinder Trim', 'Live Pathfinder Merge',
            'Live Pathfinder Crop', 'Live Pathfinder Outline', 'Live Pathfinder Minus Back'],
        handler: (a) => {
            const op = enumOf(a.operation, [...Object.keys(PATHFINDER_COMMANDS), ...Object.keys(PATHFINDER_EFFECT_ONLY)], { name: 'operation' });
            const expand = a.expand ?? true;
            const minItems = op === 'divide' || op === 'outline' ? 1 : 2;
            const menu = {
                unite: 'Live Pathfinder Add', minus_front: 'Live Pathfinder Subtract', intersect: 'Live Pathfinder Intersect',
                exclude: 'Live Pathfinder Exclude', divide: 'Live Pathfinder Divide', trim: 'Live Pathfinder Trim',
                merge: 'Live Pathfinder Merge', crop: 'Live Pathfinder Crop', outline: 'Live Pathfinder Outline', minus_back: 'Live Pathfinder Minus Back',
                hard_mix: 'Live Pathfinder Hard Mix',
            }[op];
            const viaMenu = enumOf(a.method ?? 'effect', ['effect', 'menu'], { name: 'method' }) === 'menu';
            if (viaMenu && !menu) throw new Error(`${op} opens a dialog from the menu; use method: "effect"`);
            return run('Pathfinder', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < ${minItems}) throw new Error("${op} needs at least ${minItems} item(s)");
${viaMenu ? `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand(${str(menu)});
var target = doc.selection[0];` : `${GROUP_TARGETS}
var target = g;
target.applyEffect(${pathfinderEffect(op, {
    precision: a.precision ?? 10, removeRedundantPoints: Boolean(a.removeRedundantPoints), removeUnpainted: Boolean(a.removeUnpainted),
    mixRate: a.mixRate ?? 50, trapThickness: a.trapThickness ?? 0.25, trapHeightWidth: a.trapHeightWidth ?? 100,
    trapTintReduction: a.trapTintReduction ?? 40, trapReverse: Boolean(a.trapReverse),
})});`}
${expand ? `${EXPAND}
var result = sel[0];
${SHAPE_MODES.includes(op) ? `if (sel.length === 1 && result.typename === "GroupItem" && result.pageItems.length === 1) { app.executeMenuCommand("ungroup"); sel = doc.selection; }` : ''}
for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { operation: ${str(op)}, method: ${str(viaMenu ? 'menu' : 'effect')}, expanded: true, result: out };` : `
__result__ = { operation: ${str(op)}, method: ${str(viaMenu ? 'menu' : 'effect')}, expanded: false, result: [__itemInfo(doc, target)] };`}`));
        },
    },
    {
        name: 'apply_svg_filter',
        description: `Apply an SVG filter to items as a Live Effect (Effect > SVG Filters): one of the filters new documents carry (${SVG_FILTER_PRESETS.join(', ')}) or the name of another SVG filter in the document. The filter must exist in the document. Use expand to turn the result into plain artwork`,
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                filter: { type: 'string', description: 'SVG filter name, e.g. AI_Shadow_1' },
                method: { type: 'string', enum: ['effect', 'menu'], default: 'effect', description: 'effect (default) applies the filter to each item; menu runs the preset\'s Effect > SVG Filters command on the selection (built-in filters only)' },
                expand: { type: 'boolean', default: false, description: 'Expand the result (Object > Expand Appearance). Default false' },
            },
            required: ['target', 'filter'],
        },
        features: ['illustrator.effects.svg_apply', ...SVG_FILTER_PRESETS.map((f) => `illustrator.effects.svg_${f.toLowerCase()}`)],
        menuCommands: ['expandStyle', ...SVG_FILTER_PRESETS],
        auditArgs: { filter: 'AI_Shadow_1', method: 'menu', expand: true },
        handler: (a) => {
            const filter = String(a.filter ?? '');
            if (!/^[A-Za-z_][\w.:-]{0,99}$/.test(filter)) throw new Error(`Invalid SVG filter name ${JSON.stringify(a.filter)}: give a name such as AI_Shadow_1 (letters, digits, _ . : -)`);
            const viaMenu = enumOf(a.method ?? 'effect', ['effect', 'menu'], { name: 'method' }) === 'menu';
            if (viaMenu && !SVG_FILTER_PRESETS.includes(filter)) throw new Error(`method "menu" works only for the built-in filters: ${SVG_FILTER_PRESETS.join(', ')}`);
            const result = `__result__ = { filter: ${str(filter)}, method: ${str(viaMenu ? 'menu' : 'effect')}, expanded: ${bool(a.expand)}, items: out };`;
            if (viaMenu) {
                return run('Apply SVG filter', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${MENU_ON_TARGETS(filter, a.expand)}
${result}`));
            }
            return run('Apply SVG filter', script(`
var items = __targets(doc, ${targetSpec(a.target)}), done = [];
var xml = '<LiveEffect name="Adobe SVG Filter Effect"><Dict data=""><Entry name="SVGFilterUIDName" value="' + ${str(filter)} + '" valueType="S"/><Entry name="DisplayString" value="' + ${str(filter)} + '" valueType="S"/></Dict></LiveEffect>';
for (var i = 0; i < items.length; i++) {
  var target = items[i];
  target.applyEffect(xml);
  ${a.expand ? `${EXPAND}
  for (var j = 0; j < sel.length; j++) done.push(__itemInfo(doc, sel[j]));` : 'done.push(__itemInfo(doc, target));'}
}
var out = done;
${result}`));
        },
    },
    {
        name: 'apply_last_effect',
        description: 'Apply the most recently used effect again, with the same settings, to items (Effect > Apply Last Effect). Nothing changes if no effect has been applied in this Illustrator session',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                expand: { type: 'boolean', default: false, description: 'Expand the result (Object > Expand Appearance). Default false' },
            },
            required: ['target'],
        },
        features: ['illustrator.effects.apply_last_effect'],
        menuCommands: ['Adobe Apply Last Effect', 'expandStyle'],
        handler: (a) => run('Apply last effect', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${MENU_ON_TARGETS('Adobe Apply Last Effect', a.expand)}
__result__ = { expanded: ${bool(a.expand)}, items: out };`)),
    },
    {
        name: 'set_raster_effect_settings',
        description: 'Set the document raster effects settings (Effect > Document Raster Effects Settings): the colour model, resolution, background, anti-aliasing, clipping mask, added space and spot colours that raster effects such as drop shadows, glows, blurs and Rasterize use. Give only what should change; called with nothing, it reports the current settings',
        inputSchema: {
            type: 'object',
            properties: {
                colorModel: { type: 'string', enum: Object.keys(RASTER_COLOR_MODELS), description: 'document (RGB or CMYK, as the document), grayscale or bitmap' },
                resolution: { type: 'number', minimum: 72, maximum: 2400, description: 'Pixels per inch (Screen 72, Medium 150, High 300)' },
                transparent: { type: 'boolean', description: 'Transparent background (false: white)' },
                antiAlias: { type: 'boolean', description: 'Anti-alias the rasterized edges' },
                clippingMask: { type: 'boolean', description: 'Create a clipping mask' },
                padding: { type: 'number', minimum: 0, maximum: 1000, description: 'Add Around Object, in points' },
                preserveSpotColors: { type: 'boolean', description: 'Keep spot colours (false converts them to process)' },
            },
        },
        hints: { idempotent: true },
        features: [
            'illustrator.effects.document_raster_effects_settings',
            'illustrator.effects.raster_effects_setting.color_model',
            'illustrator.effects.raster_effects_setting.resolution',
            'illustrator.effects.raster_effects_setting.background_transparent',
            'illustrator.effects.raster_effects_setting.anti_alias',
            'illustrator.effects.raster_effects_setting.create_clipping_mask',
            'illustrator.effects.raster_effects_setting.add_around_object',
            'illustrator.effects.raster_effects_setting.preserve_spot_colors',
            'illustrator.effects.raster_vs_vector_effects',
        ],
        auditArgs: { colorModel: 'grayscale', resolution: 300, transparent: true, antiAlias: true, clippingMask: false, padding: 9, preserveSpotColors: true },
        handler: (a) => {
            const lines = [];
            if (a.colorModel !== undefined) lines.push(`o.colorModel = RasterizationColorModel.${RASTER_COLOR_MODELS[enumOf(a.colorModel, Object.keys(RASTER_COLOR_MODELS), { name: 'colorModel' })]};`);
            if (a.resolution !== undefined) lines.push(`o.resolution = ${num(a.resolution, { min: 72, max: 2400, name: 'resolution' })};`);
            if (a.transparent !== undefined) lines.push(`o.transparency = ${bool(a.transparent)};`);
            if (a.antiAlias !== undefined) lines.push(`o.antiAliasing = ${bool(a.antiAlias)};`);
            if (a.clippingMask !== undefined) lines.push(`o.clippingMask = ${bool(a.clippingMask)};`);
            if (a.padding !== undefined) lines.push(`o.padding = __len(doc, ${num(a.padding, { min: 0, max: 1000, name: 'padding' })});`);
            if (a.preserveSpotColors !== undefined) lines.push(`o.convertSpotColors = ${bool(!a.preserveSpotColors)};`);
            return run('Raster effect settings', script(`
var o = doc.rasterEffectSettings;
${lines.join('\n')}
${lines.length ? 'doc.rasterEffectSettings = o;' : ''}
var r = doc.rasterEffectSettings, m = r.colorModel;
__result__ = {
  changed: ${lines.length > 0 ? 'true' : 'false'},
  colorModel: m === RasterizationColorModel.GRAYSCALE ? "grayscale" : m === RasterizationColorModel.BITMAP ? "bitmap" : "document",
  resolution: r.resolution, transparent: r.transparency, antiAlias: r.antiAliasing, clippingMask: r.clippingMask,
  padding: r.padding * __sf(doc), preserveSpotColors: !r.convertSpotColors
};`));
        },
    },
    {
        name: 'get_preferences',
        description: `Read Illustrator preferences: ${Object.keys(PREFERENCES).join(', ')}. Omit names to read them all`,
        inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', enum: Object.keys(PREFERENCES) } } } },
        features: [
            'illustrator.application.prefs_dialog',
            'illustrator.application.prefs_general',
            'illustrator.application.prefs_smart_guides',
            'illustrator.application.pref_preview_bounds',
            'illustrator.application.pref_scale_strokes_effects',
            'illustrator.application.pref_transform_pattern_tiles',
            'illustrator.application.pref_keyboard_increment',
            'illustrator.application.pref_corner_radius',
            'illustrator.application.pref_smart_guide_alignment',
            'illustrator.application.pref_smart_guide_construction',
            'illustrator.application.pref_smart_guide_anchor_labels',
            'illustrator.application.pref_smart_guide_highlight',
            'illustrator.application.pref_smart_guide_measurement',
            'illustrator.application.pref_smart_guide_transform',
            'illustrator.application.pref_snap_to_point',
            'illustrator.application.pref_pixel_grid',
            'illustrator.application.pref_disable_auto_add_delete',
            'illustrator.application.pref_highlight_anchors',
            'illustrator.geometry.direction_line_display',
            'illustrator.application.pref_precise_cursors',
            'illustrator.application.pref_show_tool_tips',
            'illustrator.application.pref_japanese_crop_marks',
            'illustrator.application.pref_font_names_english',
        ],
        handler: (a) => {
            const names = a.names?.length ? a.names.map((n) => enumOf(n, Object.keys(PREFERENCES), { name: 'names' })) : Object.keys(PREFERENCES);
            const list = names.map((n) => ({ name: n, key: PREFERENCES[n].key, type: PREFERENCES[n].type }));
            return run('Get preferences', script(`
var list = ${json(list)}, p = app.preferences, out = {};
for (var i = 0; i < list.length; i++) {
  var e = list[i];
  if (!p.preferenceExists(e.key)) { out[e.name] = null; continue; }
  out[e.name] = e.type === "Boolean" ? p.getBooleanPreference(e.key) : e.type === "Integer" ? p.getIntegerPreference(e.key) : p.getRealPreference(e.key);
}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'set_preferences',
        description: 'Change Illustrator preferences. They persist, as if set in the Preferences dialog. Pass an object of name: value',
        inputSchema: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(PREFERENCES).map(([n, p]) => [n, { type: p.type === 'Boolean' ? 'boolean' : 'number', description: p.description }])),
        },
        features: [
            'illustrator.application.prefs_dialog',
            'illustrator.application.prefs_general',
            'illustrator.application.prefs_smart_guides',
            'illustrator.application.pref_preview_bounds',
            'illustrator.application.pref_scale_strokes_effects',
            'illustrator.application.pref_transform_pattern_tiles',
            'illustrator.application.pref_keyboard_increment',
            'illustrator.application.pref_corner_radius',
            'illustrator.application.pref_smart_guide_alignment',
            'illustrator.application.pref_smart_guide_construction',
            'illustrator.application.pref_smart_guide_anchor_labels',
            'illustrator.application.pref_smart_guide_highlight',
            'illustrator.application.pref_smart_guide_measurement',
            'illustrator.application.pref_smart_guide_transform',
            'illustrator.application.pref_snap_to_point',
            'illustrator.application.pref_pixel_grid',
            'illustrator.application.pref_disable_auto_add_delete',
            'illustrator.application.pref_highlight_anchors',
            'illustrator.geometry.direction_line_display',
            'illustrator.application.pref_precise_cursors',
            'illustrator.application.pref_show_tool_tips',
            'illustrator.application.pref_japanese_crop_marks',
            'illustrator.application.pref_font_names_english',
        ],
        handler: (a) => {
            const entries = Object.entries(a).filter(([n]) => n in PREFERENCES);
            if (!entries.length) return Promise.resolve(formatErrorResponse(`Give at least one of: ${Object.keys(PREFERENCES).join(', ')}`, 'Set preferences'));
            const lines = entries.map(([n, v]) => {
                const p = PREFERENCES[n];
                const value = p.type === 'Boolean' ? bool(v) : num(v, { min: 0, max: 100000, name: n });
                return `p.set${p.type}Preference(${str(p.key)}, ${value});`;
            });
            return run('Set preferences', script(`
var p = app.preferences;
${lines.join('\n')}
__result__ = { updated: ${json(entries.map(([n]) => n))} };`, { needsDocument: false }));
        },
    },
    {
        name: 'select_tool',
        description: 'Switch Illustrator to a tool, ready for the user to draw with it. Name it as Illustrator does, e.g. "Pen Tool", "Shape Builder Tool", "Width Tool", "Column Graph Tool", "Mesh Tool", "Blend Tool"',
        inputSchema: { type: 'object', properties: { tool: { type: 'string', description: 'Tool name' } }, required: ['tool'] },
        features: [
            'illustrator.ui.toolbar',
            'illustrator.graphs.column_graph_tool',
            'illustrator.graphs.stacked_column_graph_tool',
            'illustrator.graphs.bar_graph_tool',
            'illustrator.graphs.stacked_bar_graph_tool',
            'illustrator.graphs.line_graph_tool',
            'illustrator.graphs.area_graph_tool',
            'illustrator.graphs.scatter_graph_tool',
            'illustrator.graphs.pie_graph_tool',
            'illustrator.graphs.radar_graph_tool',
            'illustrator.blends.blend_tool',
            'illustrator.meshes.mesh_tool',
            'illustrator.prepress.print_tiling_tool',
            'illustrator.brushes.paintbrush_tool',
            'illustrator.brushes.blob_brush_tool',
            'illustrator.perspective.grid_tool',
            'illustrator.perspective.selection_tool',
            'illustrator.asset_export.slice_tool',
            'illustrator.asset_export.slice_selection_tool',
            'illustrator.appearance.live_paint_bucket_tool',
            'illustrator.appearance.live_paint_selection_tool',
        ],
        handler: (a) => {
            const asked = String(a.tool ?? '').toLowerCase().replace(/^adobe\s+/, '').replace(/\s+tool$/, '').trim();
            const want = TOOL_ALIASES[asked] ?? asked;
            const match = TOOLS.find((t) => t.toLowerCase().replace(/^adobe\s+/, '').replace(/\s+tool$/, '') === want);
            if (!match) {
                const near = TOOLS.filter((t) => t.toLowerCase().includes(want)).slice(0, 8);
                return Promise.resolve(formatErrorResponse(`Unknown tool "${a.tool}".${near.length ? ` Close matches: ${near.join(', ')}` : ` Known tools: ${TOOLS.join(', ')}`}`, 'Select tool'));
            }
            return run('Select tool', script(`
app.selectTool(${str(match)});
__result__ = { tool: ${str(match)} };`, { needsDocument: false }));
        },
    },
];
