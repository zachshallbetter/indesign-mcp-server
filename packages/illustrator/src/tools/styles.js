/**
 * Graphic styles, extra fills and strokes, transparency groups, Live Paint,
 * and the fill and stroke controls.
 *
 * Graphic styles are ArtStyle objects in Document.graphicStyles: they can be
 * applied, merged, renamed, removed and written out as a library, but the
 * object model cannot create one. Adding a fill or stroke in the Appearance
 * panel and the Live Paint commands are menu commands on the selection; the
 * object model sees a Live Paint group only as a PluginItem. Expand, Gap
 * Options and New Graphic Style open dialogs and are not offered.
 */
import path from 'node:path';
import { str, num, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { paths } from './documents.js';

/** Window > Graphic Style Libraries: the built-in libraries and their commands. */
export const STYLE_LIBRARIES = {
    '3d_effects': '_Art Style Library Menu Item 0',
    additive_for_blob_brush: '_Art Style Library Menu Item 1',
    additive: '_Art Style Library Menu Item 2',
    artistic_effects: '_Art Style Library Menu Item 3',
    buttons_and_rollovers: '_Art Style Library Menu Item 4',
    illuminate_styles: '_Art Style Library Menu Item 5',
    image_effects: '_Art Style Library Menu Item 6',
    neon_effects: '_Art Style Library Menu Item 7',
    scribble_effects: '_Art Style Library Menu Item 8',
    textures: '_Art Style Library Menu Item 9',
    type_effects: '_Art Style Library Menu Item 10',
    vonster_pattern_styles: '_Art Style Library Menu Item 11',
};

/** Appearance panel menu commands that add an attribute. */
const ADD_ATTRIBUTE = { fill: 'Adobe New Fill Shortcut', stroke: 'Adobe New Stroke Shortcut' };

/** View menu toggles. */
const VIEW_TOGGLES = { transparency_grid: 'TransparencyGrid Menu Item', live_paint_gaps: 'Show Gaps Planet X' };

const KNOCKOUT = { on: 'ENABLED', off: 'DISABLED', inherit: 'INHERITED' };
const CAPS = { butt: 'BUTTENDCAP', round: 'ROUNDENDCAP', projecting: 'PROJECTINGENDCAP' };
const JOINS = { miter: 'MITERENDJOIN', round: 'ROUNDENDJOIN', bevel: 'BEVELENDJOIN' };

/** ES3: the graphic style called `name`, or an error naming the styles there are. */
const STYLE_FN = `
function __style(doc, name) {
  for (var s = 0; s < doc.graphicStyles.length; s++) if (doc.graphicStyles[s].name === name) return doc.graphicStyles[s];
  var names = [];
  for (var t = 0; t < doc.graphicStyles.length && t < 50; t++) names.push(doc.graphicStyles[t].name);
  throw new Error("Graphic style " + name + " not found. The document has: " + names.join(", "));
}`;

/** ES3: select exactly these items. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the selection afterwards, as item info. */
const RESULT = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));`;

/** ES3: white and black in the document's colour model. */
const WHITE_BLACK = `
function __white(doc) {
  var c;
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) { c = new CMYKColor(); c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 0; return c; }
  c = new RGBColor(); c.red = 255; c.green = 255; c.blue = 255; return c;
}
function __black(doc) {
  var c;
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) { c = new CMYKColor(); c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100; return c; }
  c = new RGBColor(); c.red = 0; c.green = 0; c.blue = 0; return c;
}`;

function isLivePaintCheck(label) {
    return `
for (var b = 0; b < items.length; b++) if (items[b].typename !== "PluginItem") throw new Error("${label}: item " + (items[b].name || b) + " is a " + items[b].typename + ", not a Live Paint group");`;
}

/** Statements that set Document defaults from the arguments given. */
function defaultLines(a) {
    const lines = [];
    if (a.reset) {
        lines.push('doc.defaultFilled = true; doc.defaultFillColor = __white(doc);');
        lines.push('doc.defaultStroked = true; doc.defaultStrokeColor = __black(doc); doc.defaultStrokeWidth = __len(doc, 1); doc.defaultStrokeDashes = [];');
    }
    if (a.fill !== undefined) {
        const spec = colorSpec(a.fill, 'fill');
        lines.push(JSON.parse(spec).kind === 'none' ? 'doc.defaultFilled = false;' : `doc.defaultFilled = true; doc.defaultFillColor = __color(doc, ${spec});`);
    }
    if (a.stroke !== undefined) {
        const spec = colorSpec(a.stroke, 'stroke');
        lines.push(JSON.parse(spec).kind === 'none' ? 'doc.defaultStroked = false;' : `doc.defaultStroked = true; doc.defaultStrokeColor = __color(doc, ${spec});`);
    }
    if (a.strokeWeight !== undefined) lines.push(`doc.defaultStrokeWidth = __len(doc, ${num(a.strokeWeight, { min: 0, max: 1000, name: 'strokeWeight' })});`);
    if (a.cap) lines.push(`doc.defaultStrokeCap = StrokeCap.${CAPS[enumOf(a.cap, Object.keys(CAPS), { name: 'cap' })]};`);
    if (a.join) lines.push(`doc.defaultStrokeJoin = StrokeJoin.${JOINS[enumOf(a.join, Object.keys(JOINS), { name: 'join' })]};`);
    if (a.miterLimit !== undefined) lines.push(`doc.defaultStrokeMiterLimit = ${num(a.miterLimit, { min: 1, max: 500, name: 'miterLimit' })};`);
    if (a.dashes !== undefined) {
        if (!Array.isArray(a.dashes)) throw new Error("'dashes' must be a list of numbers");
        if (a.dashes.length > 6) throw new Error("'dashes' takes at most 6 values");
        lines.push(`doc.defaultStrokeDashes = ${json(a.dashes.map((d) => Number(num(d, { min: 0, max: 1000, name: 'dashes' }))))};`);
    }
    if (a.dashOffset !== undefined) lines.push(`doc.defaultStrokeDashOffset = ${num(a.dashOffset, { name: 'dashOffset' })};`);
    if (a.fillOverprint !== undefined) lines.push(`doc.defaultFillOverprint = ${bool(a.fillOverprint)};`);
    if (a.strokeOverprint !== undefined) lines.push(`doc.defaultStrokeOverprint = ${bool(a.strokeOverprint)};`);
    return lines;
}

/** ES3: the document's default fill and stroke. */
const READ_DEFAULTS = `
var d = {
  fill: doc.defaultFilled ? __colorInfo(doc.defaultFillColor) : { kind: "none" },
  stroke: doc.defaultStroked ? __colorInfo(doc.defaultStrokeColor) : { kind: "none" },
  strokeWeight: doc.defaultStrokeWidth * __sf(doc),
  cap: String(doc.defaultStrokeCap).replace("StrokeCap.", ""),
  join: String(doc.defaultStrokeJoin).replace("StrokeJoin.", ""),
  miterLimit: doc.defaultStrokeMiterLimit,
  dashes: doc.defaultStrokeDashes,
  dashOffset: doc.defaultStrokeDashOffset,
  fillOverprint: doc.defaultFillOverprint,
  strokeOverprint: doc.defaultStrokeOverprint
};`;

export const tools = [
    // Graphic styles
    {
        name: 'list_graphic_styles',
        description: 'List the graphic styles in the document (Graphic Styles panel), in panel order',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.appearance.graphic_style_object'],
        hints: { readOnly: true },
        handler: () => run('List graphic styles', script(`
var out = [];
for (var i = 0; i < doc.graphicStyles.length; i++) out.push({ index: i, name: doc.graphicStyles[i].name });
__result__ = { styles: out };`)),
    },
    {
        name: 'apply_graphic_style',
        description: 'Apply a graphic style from the document\'s Graphic Styles panel to items. By default the style replaces their appearance; with merge it is added to it (Alt/Option-click in the panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                style: { type: 'string', description: 'Graphic style name (list_graphic_styles)' },
                merge: { type: 'boolean', description: 'Add the style to the items\' current appearance instead of replacing it. Default false', default: false },
            },
            required: ['target', 'style'],
        },
        features: ['illustrator.appearance.apply_graphic_style', 'illustrator.appearance.graphic_style_object'],
        hints: { idempotent: true },
        handler: (a) => {
            if (typeof a.style !== 'string' || !a.style) throw new Error("Give 'style', the name of a graphic style (list_graphic_styles)");
            return run('Apply graphic style', script(`${STYLE_FN}
var items = __targets(doc, ${targetSpec(a.target)}), st = __style(doc, ${str(a.style)}), out = [];
for (var i = 0; i < items.length; i++) {
  st.${a.merge ? 'mergeTo' : 'applyTo'}(items[i]);
  out.push(__itemInfo(doc, items[i]));
}
__result__ = { style: st.name, merged: ${bool(a.merge)}, items: out };`));
        },
    },
    {
        name: 'rename_graphic_style',
        description: 'Rename a graphic style (Graphic Styles panel menu > Graphic Style Options)',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Current name' }, newName: { type: 'string' } },
            required: ['name', 'newName'],
        },
        features: ['illustrator.appearance.graphic_styles_menu.graphic_style_options'],
        hints: { idempotent: true },
        handler: (a) => {
            if (typeof a.name !== 'string' || !a.name) throw new Error("Give 'name', the graphic style to rename");
            if (typeof a.newName !== 'string' || !a.newName.trim()) throw new Error("Give 'newName', the style's new name");
            return run('Rename graphic style', script(`${STYLE_FN}
var st = __style(doc, ${str(a.name)});
for (var i = 0; i < doc.graphicStyles.length; i++) if (doc.graphicStyles[i].name === ${str(a.newName)} && doc.graphicStyles[i] !== st) throw new Error("A graphic style named " + ${str(a.newName)} + " already exists");
st.name = ${str(a.newName)};
__result__ = { name: st.name };`));
        },
    },
    {
        name: 'delete_graphic_styles',
        description: 'Delete graphic styles from the document (Graphic Styles panel menu > Delete Graphic Style). Items keep their appearance; only the saved style goes',
        inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Graphic style names' } },
            required: ['names'],
        },
        features: ['illustrator.appearance.graphic_styles_menu.delete_graphic_style'],
        hints: { destructive: true },
        handler: (a) => {
            if (!Array.isArray(a.names) || !a.names.length) throw new Error("Give 'names', a list of graphic style names");
            return run('Delete graphic styles', script(`${STYLE_FN}
var names = ${json(a.names.map(String))}, styles = [], deleted = [];
for (var i = 0; i < names.length; i++) styles.push(__style(doc, names[i]));
for (var j = 0; j < styles.length; j++) { var n = styles[j].name; styles[j].remove(); deleted.push(n); }
__result__ = { deleted: deleted, remaining: doc.graphicStyles.length };`));
        },
    },
    {
        name: 'save_graphic_style_library',
        description: 'Save the document\'s graphic styles as a graphic style library file (Graphic Styles panel menu > Save Graphic Style Library), an .ai file other documents can open as a library',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute .ai path' } }, required: ['filePath'] },
        features: ['illustrator.appearance.graphic_styles_menu.save_graphic_style_library'],
        hints: { idempotent: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'styles.ai') },
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (path.extname(p).toLowerCase() !== '.ai') throw new Error('filePath must end in .ai');
            return run('Save graphic style library', script(`
var f = new File(${jsxPath(p)});
doc.writeAsLibrary(f, LibraryType.GRAPHICSTYLES);
__result__ = { saved: f.fsName, styles: doc.graphicStyles.length };`));
        },
    },
    {
        name: 'open_graphic_styles',
        description: 'Show the Graphic Styles panel (Window > Graphic Styles), or open one of Illustrator\'s built-in graphic style libraries as a panel (Window > Graphic Style Libraries). A style used from a library is added to the document. Like every Window menu command, this hides a panel that is already showing at the front',
        inputSchema: {
            type: 'object',
            properties: { library: { type: 'string', enum: Object.keys(STYLE_LIBRARIES), description: 'Built-in library to open. Omit for the Graphic Styles panel' } },
        },
        features: [
            'illustrator.appearance.graphic_styles_panel',
            'illustrator.appearance.graphic_style_libraries',
            'illustrator.appearance.graphic_styles_menu.open_graphic_style_library',
            'illustrator.appearance.gs_library.3d_effects',
            'illustrator.appearance.gs_library.additive_for_blob_brush',
            'illustrator.appearance.gs_library.additive',
            'illustrator.appearance.gs_library.artistic_effects',
            'illustrator.appearance.gs_library.buttons_and_rollovers',
            'illustrator.appearance.gs_library.illuminate_styles',
            'illustrator.appearance.gs_library.image_effects',
            'illustrator.appearance.gs_library.neon_effects',
            'illustrator.appearance.gs_library.scribble_effects',
            'illustrator.appearance.gs_library.textures',
            'illustrator.appearance.gs_library.type_effects',
            'illustrator.appearance.gs_library.vonster_pattern_styles',
        ],
        menuCommands: ['Adobe Style Palette', ...Object.values(STYLE_LIBRARIES)],
        auditArgs: { library: 'neon_effects' },
        handler: (a) => {
            const cmd = a.library === undefined ? 'Adobe Style Palette' : STYLE_LIBRARIES[enumOf(a.library, Object.keys(STYLE_LIBRARIES), { name: 'library' })];
            return run('Open graphic styles', script(`
app.executeMenuCommand(${str(cmd)});
__result__ = { opened: ${str(a.library ?? 'graphic_styles_panel')} };`, { needsDocument: false }));
        },
    },

    // Appearance panel: more fills and strokes
    {
        name: 'add_appearance_attribute',
        description: 'Add another fill or stroke to each item\'s appearance (Appearance panel menu > Add New Fill / Add New Stroke), so one object can carry several fills or strokes. The new attribute goes above the current ones; apply_effect, apply_graphic_style or the Appearance panel then style it',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                attribute: { type: 'string', enum: Object.keys(ADD_ATTRIBUTE) },
                count: { type: 'integer', minimum: 1, maximum: 10, description: 'How many to add to each item. Default 1', default: 1 },
            },
            required: ['target', 'attribute'],
        },
        features: [
            'illustrator.appearance.multiple_fills_strokes',
            'illustrator.appearance.add_new_fill',
            'illustrator.appearance.add_new_stroke',
        ],
        menuCommands: Object.values(ADD_ATTRIBUTE),
        auditArgs: { attribute: 'stroke', count: 2 },
        handler: (a) => {
            const cmd = ADD_ATTRIBUTE[enumOf(a.attribute, Object.keys(ADD_ATTRIBUTE), { name: 'attribute' })];
            const count = a.count === undefined ? 1 : Number(num(a.count, { min: 1, max: 10, name: 'count' }));
            if (!Number.isInteger(count)) throw new Error("'count' must be a whole number from 1 to 10");
            // The commands act on the selection; published scripts run them one item at a time.
            return run('Add appearance attribute', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  doc.selection = null;
  items[i].selected = true;
  for (var n = 0; n < ${count}; n++) app.executeMenuCommand(${str(cmd)});
  out.push(__itemInfo(doc, items[i]));
}
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
__result__ = { added: ${str(a.attribute)}, each: ${count}, items: out };`));
        },
    },

    // Transparency groups and view toggles
    {
        name: 'set_transparency_group',
        description: 'Set Knockout Group and Isolate Blending (Transparency panel) on groups, other items or layers. Knockout stops the objects inside from showing through each other; Isolate Blending keeps blending modes inside the group or layer',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                layers: { type: 'array', items: { type: 'string' }, description: 'Layer names, instead of or as well as target' },
                knockout: { type: 'string', enum: Object.keys(KNOCKOUT), description: 'on, off, or inherit (the neutral state of the checkbox)' },
                isolateBlending: { type: 'boolean' },
            },
        },
        features: ['illustrator.appearance.knockout_group', 'illustrator.appearance.isolate_blending'],
        hints: { idempotent: true },
        auditArgs: { layers: ['Layer 1'], knockout: 'on', isolateBlending: true },
        handler: (a) => {
            if (a.knockout === undefined && a.isolateBlending === undefined) throw new Error('Give knockout, isolateBlending or both');
            const hasLayers = Array.isArray(a.layers) && a.layers.length;
            if (!a.target && !hasLayers) throw new Error('Choose what to change: target (items) or layers (layer names)');
            const lines = [];
            if (a.knockout !== undefined) lines.push(`o.artworkKnockout = KnockoutState.${KNOCKOUT[enumOf(a.knockout, Object.keys(KNOCKOUT), { name: 'knockout' })]};`);
            if (a.isolateBlending !== undefined) lines.push(`o.isIsolated = ${bool(a.isolateBlending)};`);
            return run('Set transparency group', script(`
var objs = [], out = [];
${a.target ? `var items = __targets(doc, ${targetSpec(a.target)}); for (var i = 0; i < items.length; i++) objs.push(items[i]);` : ''}
${hasLayers ? `var layerNames = ${json(a.layers.map(String))}; for (var l = 0; l < layerNames.length; l++) objs.push(__layer(doc, layerNames[l]));` : ''}
for (var j = 0; j < objs.length; j++) {
  var o = objs[j];
  ${lines.join('\n  ')}
  out.push({ name: o.name, type: o.typename, knockout: String(o.artworkKnockout).replace("KnockoutState.", ""), isolateBlending: o.isIsolated });
}
__result__ = { updated: out };`));
        },
    },
    {
        name: 'toggle_view_option',
        description: 'Show or hide the transparency grid (View > Show / Hide Transparency Grid) or Live Paint gap highlighting (View > Show / Hide Live Paint Gaps). Each call switches the option; Illustrator does not report which state it is in',
        inputSchema: {
            type: 'object',
            properties: { option: { type: 'string', enum: Object.keys(VIEW_TOGGLES) } },
            required: ['option'],
        },
        features: ['illustrator.appearance.view_transparency', 'illustrator.appearance.show_live_paint_gaps'],
        menuCommands: Object.values(VIEW_TOGGLES),
        auditArgs: { option: 'transparency_grid' },
        handler: (a) => run('Toggle view option', script(`
app.executeMenuCommand(${str(VIEW_TOGGLES[enumOf(a.option, Object.keys(VIEW_TOGGLES), { name: 'option' })])});
__result__ = { toggled: ${str(a.option)} };`)),
    },

    // Live Paint
    {
        name: 'make_live_paint',
        description: 'Make a Live Paint group from paths (Object > Live Paint > Make), or add paths to an existing Live Paint group (Object > Live Paint > Merge) when into is given. Painting its faces and edges stays interactive (select_tool "Planar Paintbucket Tool")',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                into: { ...TARGET_SCHEMA, description: 'An existing Live Paint group to merge the target paths into' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.appearance.live_paint_group',
            'illustrator.appearance.live_paint_make',
            'illustrator.appearance.live_paint_merge',
        ],
        menuCommands: ['Make Planet X', 'Marge Planet X'],
        handler: (a) => {
            const merge = a.into !== undefined;
            return run('Make Live Paint', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${merge ? `var into = __targets(doc, ${targetSpec(a.into)});
if (into.length !== 1 || into[0].typename !== "PluginItem") throw new Error("'into' must be one Live Paint group");
items.push(into[0]);` : ''}
${SELECT}
app.executeMenuCommand(${str(merge ? 'Marge Planet X' : 'Make Planet X')});
if (!doc.selection || doc.selection.length !== 1 || doc.selection[0].typename !== "PluginItem") throw new Error("Illustrator did not ${merge ? 'merge these paths into the Live Paint group' : 'make a Live Paint group from these items'}");
${RESULT}
__result__ = { livePaint: out[0], merged: ${bool(merge)} };`));
        },
    },
    {
        name: 'release_live_paint',
        description: 'Release Live Paint groups back into plain paths with a thin black stroke and no fill (Object > Live Paint > Release)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.appearance.live_paint_release', 'illustrator.appearance.live_paint_group'],
        menuCommands: ['Release Planet X'],
        hints: { destructive: true },
        handler: (a) => run('Release Live Paint', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isLivePaintCheck('Release')}
${SELECT}
app.executeMenuCommand("Release Planet X");
${RESULT}
__result__ = { released: items.length, items: out };`)),
    },
    {
        name: 'expand_live_paint',
        description: 'Expand Live Paint groups into ordinary filled and stroked paths that keep their painted look (Object > Live Paint > Expand)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.appearance.live_paint_expand', 'illustrator.appearance.live_paint_group'],
        menuCommands: ['Expand Planet X'],
        hints: { destructive: true },
        handler: (a) => run('Expand Live Paint', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isLivePaintCheck('Expand')}
${SELECT}
app.executeMenuCommand("Expand Planet X");
${RESULT}
__result__ = { expanded: items.length, items: out };`)),
    },

    // Fill and stroke controls
    {
        name: 'get_default_fill_stroke',
        description: 'Read the document\'s default fill and stroke, the attributes new objects get, and whether the Fill or the Stroke box is in front in the toolbar\'s Fill and Stroke controls',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.appearance.default_attributes', 'illustrator.appearance.fill_stroke_controls'],
        hints: { readOnly: true },
        handler: () => run('Get default fill and stroke', script(`${READ_DEFAULTS}
d.fillActive = app.isFillActive();
d.strokeActive = app.isStrokeActive();
__result__ = d;`)),
    },
    {
        name: 'set_default_fill_stroke',
        description: 'Set the document\'s default fill and stroke, the attributes new objects get. reset gives a white fill and a black 1 pt solid stroke, as the toolbar\'s Default Fill and Stroke button does; other options apply after it',
        inputSchema: {
            type: 'object',
            properties: {
                reset: { type: 'boolean', description: 'White fill, black 1 pt solid stroke' },
                fill: COLOR_SCHEMA,
                stroke: COLOR_SCHEMA,
                strokeWeight: { type: 'number', minimum: 0, description: 'Points' },
                cap: { type: 'string', enum: Object.keys(CAPS) },
                join: { type: 'string', enum: Object.keys(JOINS) },
                miterLimit: { type: 'number', minimum: 1, maximum: 500 },
                dashes: { type: 'array', items: { type: 'number', minimum: 0 }, maxItems: 6, description: 'Dash and gap lengths in points. [] for a solid line' },
                dashOffset: { type: 'number' },
                fillOverprint: { type: 'boolean' },
                strokeOverprint: { type: 'boolean' },
            },
        },
        features: ['illustrator.appearance.default_attributes', 'illustrator.appearance.default_fill_stroke'],
        hints: { idempotent: true },
        auditArgs: { reset: true, fill: '#FFCC00', stroke: 'none', dashes: [4, 2] },
        handler: (a) => {
            const lines = defaultLines(a);
            if (!lines.length) throw new Error('Give reset or at least one of fill, stroke, strokeWeight, cap, join, miterLimit, dashes, dashOffset, fillOverprint, strokeOverprint');
            return run('Set default fill and stroke', script(`${WHITE_BLACK}
${lines.join('\n')}
${READ_DEFAULTS}
__result__ = d;`));
        },
    },
    {
        name: 'swap_fill_stroke',
        description: 'Swap the fill and stroke colours of paths, compound paths and groups (every path inside), as the toolbar\'s Swap Fill and Stroke button does. A missing fill becomes a missing stroke and the other way round',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.appearance.swap_fill_stroke', 'illustrator.appearance.fill_stroke_controls'],
        handler: (a) => run('Swap fill and stroke', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] };
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  var f = p.filled ? p.fillColor : null, s = p.stroked ? p.strokeColor : null;
  if (s) { p.filled = true; p.fillColor = s; } else p.filled = false;
  if (f) { p.stroked = true; p.strokeColor = f; } else p.stroked = false;
}, counts);
__result__ = counts;`)),
    },
    {
        name: 'reset_fill_stroke',
        description: 'Give paths, compound paths and groups (every path inside) a white fill and a black 1 pt solid stroke, as the toolbar\'s Default Fill and Stroke button does for selected objects',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.appearance.default_fill_stroke', 'illustrator.appearance.fill_stroke_controls'],
        hints: { idempotent: true },
        handler: (a) => run('Reset fill and stroke', script(`${EACH_PATH}${WHITE_BLACK}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] }, w = __white(doc), k = __black(doc);
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  p.filled = true; p.fillColor = w;
  p.stroked = true; p.strokeColor = k; p.strokeWidth = __len(doc, 1); p.strokeDashes = [];
}, counts);
__result__ = counts;`)),
    },
];
