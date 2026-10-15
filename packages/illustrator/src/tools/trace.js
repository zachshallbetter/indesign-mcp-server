/**
 * Image Trace: trace placed and embedded images, change a tracing's options,
 * read its counts, and expand or release it.
 *
 * PlacedItem.trace() and RasterItem.trace() return a PluginItem whose tracing
 * (a TracingObject) holds the options and the result. Tracing finishes
 * asynchronously, so each script redraws after tracing or changing options and
 * before reading counts or expanding, the way published tracing scripts do.
 */
import { str, num, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

export const MODES = { color: 'TRACINGMODECOLOR', grayscale: 'TRACINGMODEGRAY', black_and_white: 'TRACINGMODEBLACKANDWHITE' };
export const PALETTES = { limited: 'TRACINGLIMITEDCOLOR', full_tone: 'TRACINGFULLCOLOR' };
export const METHODS = { abutting: 'TRACINGMETHODABUTTING', overlapping: 'TRACINGMETHODOVERLAPPING' };
export const VIEWS = {
    tracing_result: 'TRACINGVIEWVECTORTRACINGRESULT',
    outlines_with_tracing: 'TRACINGVIEWVECTOROUTLINESWITHTRACING',
    outlines: 'TRACINGVIEWVECTOROUTLINES',
    outlines_with_source_image: 'TRACINGVIEWVECTORWITHTRANSPARENTIMAGE',
    source_image: 'TRACINGVIEWIMAGE',
};

/** Numeric options: TracingOptions member and range. */
const NUMBERS = {
    colors: { member: 'tracingColors', min: 2, max: 256, integer: true },
    colorFidelity: { member: 'colorFidelity', min: 0, max: 100 },
    grays: { member: 'grayLevels', min: 0, max: 100 },
    threshold: { member: 'threshold', min: 0, max: 255, integer: true },
    paths: { member: 'pathFidelity', min: 0, max: 100 },
    corners: { member: 'cornerFidelity', min: 0, max: 100 },
    noise: { member: 'noiseFidelity', min: 1, max: 100, integer: true },
    maxStrokeWeight: { member: 'maxStrokeWeight', min: 0.01, max: 100 },
};
const BOOLEANS = { fills: 'fills', strokes: 'strokes', snapCurvesToLines: 'snapCurveToLines', ignoreWhite: 'ignoreWhite' };

const OPTION_SCHEMA = {
    preset: { type: 'string', description: 'Tracing preset to start from, as list_tracing_presets gives it (brackets, case and spacing are optional), e.g. "High Fidelity Photo", "6 Colors", "Black and White Logo". The options below override it' },
    mode: { type: 'string', enum: Object.keys(MODES), description: 'Mode' },
    palette: { type: 'string', enum: Object.keys(PALETTES), description: 'Palette: limited (up to colors) or full_tone (colorFidelity). Colour and grayscale modes' },
    library: { type: 'string', description: 'Palette from a swatch library: "Document Library" or the name of an open swatch library' },
    colorGroup: { type: 'string', description: 'Colour group in that library, or "All"' },
    colors: { type: 'integer', minimum: 2, maximum: 256, description: 'Colors: the most colours a limited palette uses' },
    colorFidelity: { type: 'number', minimum: 0, maximum: 100, description: 'Colors with a full-tone palette: colour fidelity, percent' },
    grays: { type: 'number', minimum: 0, maximum: 100, description: 'Grays: grey levels in grayscale mode, percent' },
    threshold: { type: 'integer', minimum: 0, maximum: 255, description: 'Threshold for black and white mode: brighter pixels become white' },
    paths: { type: 'number', minimum: 0, maximum: 100, description: 'Paths: how closely paths follow the pixels, percent' },
    corners: { type: 'number', minimum: 0, maximum: 100, description: 'Corners: how readily corners form, percent' },
    noise: { type: 'integer', minimum: 1, maximum: 100, description: 'Noise: smallest area traced, in pixels' },
    method: { type: 'string', enum: Object.keys(METHODS), description: 'Method: abutting (cut-out) or overlapping (stacked) paths' },
    fills: { type: 'boolean', description: 'Create: Fills' },
    strokes: { type: 'boolean', description: 'Create: Strokes (black and white mode)' },
    maxStrokeWeight: { type: 'number', minimum: 0.01, maximum: 100, description: 'Stroke: widest line traced as a stroke, pixels' },
    snapCurvesToLines: { type: 'boolean', description: 'Snap Curves To Lines' },
    ignoreWhite: { type: 'boolean', description: 'Ignore White (black and white mode, abutting method)' },
    view: { type: 'string', enum: Object.keys(VIEWS), description: 'View: what the tracing shows on the artboard' },
};

const OPTION_FEATURES = [
    'illustrator.image_trace.trace_option.mode',
    'illustrator.image_trace.trace_option.palette',
    'illustrator.image_trace.trace_option.palette_library',
    'illustrator.image_trace.trace_option.color_group',
    'illustrator.image_trace.trace_option.colors',
    'illustrator.image_trace.trace_option.colors_full_tone_fidelity',
    'illustrator.image_trace.trace_option.grays',
    'illustrator.image_trace.trace_option.threshold',
    'illustrator.image_trace.trace_option.paths',
    'illustrator.image_trace.trace_option.corners',
    'illustrator.image_trace.trace_option.noise',
    'illustrator.image_trace.trace_option.method',
    'illustrator.image_trace.trace_option.create_fills',
    'illustrator.image_trace.trace_option.create_strokes',
    'illustrator.image_trace.trace_option.stroke',
    'illustrator.image_trace.trace_option.snap_curves_to_lines',
    'illustrator.image_trace.trace_option.ignore_white',
    'illustrator.image_trace.trace_option.view',
    'illustrator.image_trace.trace_option.preset',
    'illustrator.image_trace.trace_load_preset',
];

/** Statements that load the preset and set each given option on `o` (a TracingOptions). */
export function optionStatements(a) {
    const lines = [];
    if (a.preset !== undefined) {
        if (typeof a.preset !== 'string' || !a.preset.trim()) throw new Error("'preset' must be a preset name from list_tracing_presets");
        lines.push(`if (!o.loadFromPreset(__tracePreset(${str(a.preset)}))) throw new Error("Illustrator could not load the tracing preset " + ${str(a.preset)});`);
    }
    if (a.mode !== undefined) lines.push(`o.tracingMode = TracingModeType.${MODES[enumOf(a.mode, Object.keys(MODES), { name: 'mode' })]};`);
    if (a.palette !== undefined) lines.push(`o.tracingColorTypeValue = TracingColorType.${PALETTES[enumOf(a.palette, Object.keys(PALETTES), { name: 'palette' })]};`);
    if (a.method !== undefined) lines.push(`o.tracingMethod = TracingMethodType.${METHODS[enumOf(a.method, Object.keys(METHODS), { name: 'method' })]};`);
    if (a.view !== undefined) lines.push(`o.viewMode = ViewType.${VIEWS[enumOf(a.view, Object.keys(VIEWS), { name: 'view' })]};`);
    if (a.library !== undefined) lines.push(`o.palette = ${str(a.library)};`);
    if (a.colorGroup !== undefined) lines.push(`o.colorGroup = ${str(a.colorGroup)};`);
    for (const [key, spec] of Object.entries(NUMBERS)) {
        if (a[key] === undefined) continue;
        const v = num(a[key], { min: spec.min, max: spec.max, name: key });
        if (spec.integer && !Number.isInteger(Number(v))) throw new Error(`'${key}' must be a whole number`);
        lines.push(`o.${spec.member} = ${v};`);
    }
    for (const [key, member] of Object.entries(BOOLEANS)) if (a[key] !== undefined) lines.push(`o.${member} = ${bool(a[key])};`);
    if (a.fills === false && a.strokes === false) throw new Error('Turn on fills, strokes or both');
    if (a.fills === false && a.strokes === undefined) lines.push('if (!o.strokes) throw new Error("Tracing needs fills, strokes or both: give strokes: true with fills: false");');
    if (a.strokes === false && a.fills === undefined) lines.push('if (!o.fills) throw new Error("Tracing needs fills, strokes or both: give fills: true with strokes: false");');
    return lines.join('\n');
}

/** ES3 helpers: a preset name as Illustrator lists it; the tracings among items; a tracing's options and counts. */
const TRACE = `
function __presetKey(s) { return String(s).replace(/[\\[\\]\\s_-]/g, "").toLowerCase(); }
function __tracePreset(name) {
  var list = app.tracingPresetsList, want = __presetKey(name);
  for (var i = 0; i < list.length; i++) if (list[i] === name) return list[i];
  for (var j = 0; j < list.length; j++) if (__presetKey(list[j]) === want) return list[j];
  throw new Error("Tracing preset " + name + " not found. Available: " + list.join(", "));
}
function __tracings(items) {
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    if (t.typename !== "PluginItem" || !t.isTracing) throw new Error("Item " + (t.name || i) + " is a " + t.typename + ", not an image tracing: trace it with trace_image");
  }
  return items;
}
function __enumName(v, names) {
  for (var k in names) if (names.hasOwnProperty(k) && v === names[k]) return k;
  return String(v);
}
function __traceInfo(doc, p) {
  var t = p.tracing, o = t.tracingOptions;
  var info = __itemInfo(doc, p);
  info.paths = t.pathCount; info.anchors = t.anchorCount; info.colors = t.usedColorCount;
  info.options = {
    preset: o.preset,
    mode: __enumName(o.tracingMode, { color: TracingModeType.TRACINGMODECOLOR, grayscale: TracingModeType.TRACINGMODEGRAY, black_and_white: TracingModeType.TRACINGMODEBLACKANDWHITE }),
    palette: __enumName(o.tracingColorTypeValue, { limited: TracingColorType.TRACINGLIMITEDCOLOR, full_tone: TracingColorType.TRACINGFULLCOLOR }),
    library: o.palette, colorGroup: o.colorGroup, colors: o.tracingColors, colorFidelity: o.colorFidelity, grays: o.grayLevels,
    threshold: o.threshold, paths: o.pathFidelity, corners: o.cornerFidelity, noise: o.noiseFidelity,
    method: __enumName(o.tracingMethod, { abutting: TracingMethodType.TRACINGMETHODABUTTING, overlapping: TracingMethodType.TRACINGMETHODOVERLAPPING }),
    fills: o.fills, strokes: o.strokes, maxStrokeWeight: o.maxStrokeWeight, snapCurvesToLines: o.snapCurveToLines, ignoreWhite: o.ignoreWhite,
    view: __enumName(o.viewMode, { tracing_result: ViewType.TRACINGVIEWVECTORTRACINGRESULT, outlines_with_tracing: ViewType.TRACINGVIEWVECTOROUTLINESWITHTRACING, outlines: ViewType.TRACINGVIEWVECTOROUTLINES, outlines_with_source_image: ViewType.TRACINGVIEWVECTORWITHTRANSPARENTIMAGE, source_image: ViewType.TRACINGVIEWIMAGE })
  };
  return info;
}`;

const TRACINGS_SCHEMA = { ...TARGET_SCHEMA, description: 'Image tracings (from trace_image, or list_items items of type PluginItem)' };

export const tools = [
    {
        name: 'list_tracing_presets',
        description: 'List the Image Trace presets Illustrator has: the built-in ones (in brackets) and any saved (Image Trace panel > Preset, Edit > Tracing Presets)',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.image_trace.trace_option.preset', 'illustrator.image_trace.trace_load_preset'],
        hints: { readOnly: true, idempotent: true },
        handler: () => run('List tracing presets', script(`
var list = app.tracingPresetsList, out = [];
for (var i = 0; i < list.length; i++) out.push(list[i]);
__result__ = { presets: out };`, { needsDocument: false })),
    },
    {
        name: 'trace_image',
        description: 'Trace placed or embedded images into vector artwork (Object > Image Trace > Make, or Make and Expand with expand: true), with a preset and any Image Trace panel option: mode, palette, colours, grays, threshold, paths, corners, noise, method, fills, strokes, stroke width, snap curves to lines, ignore white and view. Returns each tracing with its path, anchor and colour counts',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Placed or embedded images (place_image gives ids)' },
                ...OPTION_SCHEMA,
                expand: { type: 'boolean', description: 'Expand the result into ordinary paths straight away (Make and Expand). Default false', default: false },
            },
            required: ['target'],
        },
        features: [
            'illustrator.image_trace.tracing_object',
            'illustrator.image_trace.trace_make',
            'illustrator.image_trace.trace_make_expand',
            'illustrator.image_trace.trace_panel',
            'illustrator.image_trace.trace_text_poster',
            ...OPTION_FEATURES,
        ],
        handler: (a) => {
            const options = optionStatements(a);
            return run('Trace image', script(`${TRACE}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var t = items[i].typename;
  if (t !== "PlacedItem" && t !== "RasterItem") throw new Error("Image Trace works on placed or embedded images; item " + (items[i].name || i) + " is a " + t);
}
for (var j = 0; j < items.length; j++) {
  var p = items[j].trace(), o = p.tracing.tracingOptions;
${options}
  app.redraw();
  var info = __traceInfo(doc, p);
  ${a.expand ? `var g = p.tracing.expandTracing();
  info = { expanded: __itemInfo(doc, g), paths: info.paths, anchors: info.anchors, colors: info.colors, options: info.options };` : ''}
  out.push(info);
}
__result__ = { tracings: out, expanded: ${bool(a.expand)} };`));
        },
    },
    {
        name: 'set_trace_options',
        description: 'Change the options of existing image tracings, which re-traces them (Image Trace panel): load a preset and set any option, then optionally save the result as a preset (Image Trace panel > Save as New Preset). Returns the new counts',
        inputSchema: {
            type: 'object',
            properties: {
                target: TRACINGS_SCHEMA,
                ...OPTION_SCHEMA,
                savePreset: { type: 'string', description: 'Save the first tracing\'s options as a preset with this name. A saved preset of that name is overwritten; built-in presets cannot be' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.image_trace.edit_trace_results',
            'illustrator.image_trace.trace_optimize',
            'illustrator.image_trace.trace_panel',
            ...OPTION_FEATURES,
        ],
        hints: { idempotent: true },
        auditArgs: { preset: '6 Colors', mode: 'color', palette: 'limited', colors: 6, paths: 50, savePreset: 'Poster' },
        handler: (a) => {
            const options = optionStatements(a);
            if (a.savePreset !== undefined && (typeof a.savePreset !== 'string' || !a.savePreset.trim() || /^\[.*\]$/.test(a.savePreset.trim()))) {
                throw new Error("'savePreset' must be a name, without brackets (bracketed names are Illustrator's built-in presets)");
            }
            if (!options && a.savePreset === undefined) throw new Error('Give a preset, at least one option, or savePreset');
            return run('Set trace options', script(`${TRACE}
var items = __tracings(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var j = 0; j < items.length; j++) {
  var p = items[j], o = p.tracing.tracingOptions;
${options}
  app.redraw();
  out.push(__traceInfo(doc, p));
}
${a.savePreset !== undefined ? `if (!items[0].tracing.tracingOptions.storeToPreset(${str(a.savePreset)})) throw new Error("Could not save the preset " + ${str(a.savePreset)} + ": a locked preset has that name");` : ''}
__result__ = { tracings: out, savedPreset: ${a.savePreset !== undefined ? str(a.savePreset) : 'null'} };`));
        },
    },
    {
        name: 'get_trace_info',
        description: 'Report image tracings: their paths, anchors and colours (Image Trace panel info) and every option they use',
        inputSchema: { type: 'object', properties: { target: TRACINGS_SCHEMA }, required: ['target'] },
        features: ['illustrator.image_trace.trace_info', 'illustrator.image_trace.tracing_object'],
        hints: { readOnly: true, idempotent: true },
        handler: (a) => run('Trace info', script(`${TRACE}
var items = __tracings(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var i = 0; i < items.length; i++) {
  var src = null;
  try { src = __itemInfo(doc, items[i].tracing.sourceArt); } catch (e) { src = null; }
  var info = __traceInfo(doc, items[i]);
  info.source = src;
  out.push(info);
}
__result__ = { tracings: out };`)),
    },
    {
        name: 'expand_trace',
        description: 'Expand image tracings into ordinary paths that can be edited like any artwork (Object > Image Trace > Expand). The tracing and its source image are replaced',
        inputSchema: {
            type: 'object',
            properties: {
                target: TRACINGS_SCHEMA,
                asViewed: { type: 'boolean', description: 'Expand as shown by the tracing\'s view (outlines, source image) rather than the tracing result. Default false', default: false },
            },
            required: ['target'],
        },
        features: ['illustrator.image_trace.trace_expand', 'illustrator.image_trace.edit_trace_results'],
        hints: { destructive: true },
        handler: (a) => run('Expand trace', script(`${TRACE}
var items = __tracings(__targets(doc, ${targetSpec(a.target)})), out = [];
app.redraw();
for (var i = 0; i < items.length; i++) out.push(__itemInfo(doc, items[i].tracing.expandTracing(${bool(a.asViewed)})));
__result__ = { expanded: out };`)),
    },
    {
        name: 'release_trace',
        description: 'Release image tracings: discard the traced result and keep the original image (Object > Image Trace > Release)',
        inputSchema: { type: 'object', properties: { target: TRACINGS_SCHEMA }, required: ['target'] },
        features: ['illustrator.image_trace.trace_release'],
        hints: { destructive: true },
        handler: (a) => run('Release trace', script(`${TRACE}
var items = __tracings(__targets(doc, ${targetSpec(a.target)})), out = [];
for (var i = 0; i < items.length; i++) out.push(__itemInfo(doc, items[i].tracing.releaseTracing()));
__result__ = { released: out };`)),
    },
];
