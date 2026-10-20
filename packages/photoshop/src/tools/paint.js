/**
 * Painting and retouching: Edit > Fill contents (including Content-Aware and
 * the scripted patterns), classic gradients, painting and retouching tools
 * applied along a path, Fill Path, the Paint Bucket and Magic Eraser at a
 * point, options-bar tool options, the Brush Settings panel, brush presets and
 * files, the Clone Source panel, and the Patch and Content-Aware Move commands.
 *
 * Painting by hand on the canvas is interactive. These tools reach the same
 * results through the commands a script can play: the fill, gradient, stroke,
 * patch and move events of the Action Manager, and the object model where it
 * has the feature.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';
import { FILL_BLEND } from './selection.js';
import { paths } from './documents.js';
import { TOOL_OPTIONS_HELPERS, applyEdits, opt, tip, size, CONTROLS } from '../tool-options.js';

/** Fill blend modes as the Action Manager's blendMode enum values. */
const AM_BLEND = {
    normal: 'normal', dissolve: 'dissolve', behind: 'behind', clear: 'clearEnum', darken: 'darken', multiply: 'multiply', color_burn: 'colorBurn',
    linear_burn: 'linearBurn', lighten: 'lighten', screen: 'screen', color_dodge: 'colorDodge', linear_dodge: 'linearDodge', overlay: 'overlay',
    soft_light: 'softLight', hard_light: 'hardLight', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation',
    color: 'color', luminosity: 'luminosity',
};
const BLEND_SCHEMA = { type: 'string', enum: Object.keys(AM_BLEND), description: 'Blend mode. Default normal' };
const OPACITY_SCHEMA = { type: 'number', minimum: 1, maximum: 100, description: 'Percent. Default 100' };
const POINT_SCHEMA = { type: 'object', description: 'A point in pixels from the document\'s top-left corner', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };

/**
 * Painting and retouching tools that a script can apply along a path with the
 * stroke event, by their tool class ids (as app.currentTool names them).
 */
const STROKE_TOOLS = {
    brush: 'paintbrushTool', pencil: 'pencilTool', color_replacement: 'colorReplacementBrushTool', art_history_brush: 'artBrushTool',
    history_brush: 'historyBrushTool', eraser: 'eraserTool', background_eraser: 'backgroundEraserTool', healing_brush: 'magicStampTool',
    clone_stamp: 'cloneStampTool', pattern_stamp: 'patternStampTool', blur: 'blurTool', sharpen: 'sharpenTool', smudge: 'smudgeTool',
    dodge: 'dodgeTool', burn: 'burnInTool', sponge: 'saturationTool',
};

/** Every tool set_tool_options can make active: the stroke tools plus ones used only by hand or by other tools here. */
const ACTIVE_TOOLS = {
    ...STROKE_TOOLS, mixer_brush: 'wetBrushTool', spot_healing_brush: 'spotHealingBrushTool', red_eye: 'redEyeTool', gradient: 'gradientTool',
    paint_bucket: 'bucketTool', magic_eraser: 'magicEraserTool', patch: 'patchSelection', content_aware_move: 'recomposeSelection',
};

/**
 * Script helpers shared by these tools: sid/cid for type ids, __hasSelection()
 * (an Action Manager probe, since reading selection.bounds with nothing
 * selected throws) and __pt() for a point descriptor in pixels.
 */
const AM = `
var sid = function (s) { return app.stringIDToTypeID(s); };
var cid = function (c) { return app.charIDToTypeID(c); };
var __hasSelection = function () {
  var r = new ActionReference();
  r.putProperty(sid("property"), sid("selection"));
  r.putEnumerated(sid("document"), sid("ordinal"), sid("targetEnum"));
  return app.executeActionGet(r).hasKey(sid("selection"));
};
var __pt = function (x, y) {
  var p = new ActionDescriptor();
  p.putUnitDouble(sid("horizontal"), sid("pixelsUnit"), x);
  p.putUnitDouble(sid("vertical"), sid("pixelsUnit"), y);
  return p;
};`;

const blend = (v) => AM_BLEND[enumOf(v ?? 'normal', Object.keys(AM_BLEND), { name: 'blendMode' })];
const opacity = (v) => num(v ?? 100, { min: 1, max: 100, name: 'opacity' });

/** A colour argument, or the foreground/background colour, as a script expression for a SolidColor. */
function colorExpr(value, name) {
    if (value === undefined || value === null || value === 'foreground') return 'app.foregroundColor';
    if (value === 'background') return 'app.backgroundColor';
    return `__color(${colorSpec(value, name)})`;
}

/** A checked {x, y} point as [x, y]. */
function point(p, name) {
    if (!p || typeof p !== 'object') throw new Error(`'${name}' must be { x, y }`);
    return [Number(num(p.x, { name: `${name}.x` })), Number(num(p.y, { name: `${name}.y` }))];
}

const PATH_PROPS = {
    path: { type: 'string', description: 'Name of a path in the Paths panel' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 2, description: 'Instead of path: corners of a temporary path, [[x, y], ...] in pixels. It is removed afterwards' },
};

/**
 * Script that sets `__path` to the named path, or to a temporary path through
 * the given points. Path points are laid out at 72 ppi, so the document's
 * resolution is set to 72 (without resampling) while the path is made, then
 * restored. Pair with PATH_END.
 */
function pathStart(a, { closed }) {
    if (a.path !== undefined && a.points !== undefined) throw new Error('Give path or points, not both');
    if (a.path !== undefined) {
        if (typeof a.path !== 'string' || !a.path) throw new Error("'path' must be a path name");
        return `var __path = doc.pathItems.getByName(${str(a.path)}), __temp = false;`;
    }
    if (!Array.isArray(a.points) || a.points.length < (closed ? 3 : 2)) throw new Error(`Give path, or points with at least ${closed ? 3 : 2} [x, y] pairs`);
    const pts = a.points.map((p, i) => [Number(num(p?.[0], { name: `points[${i}][0]` })), Number(num(p?.[1], { name: `points[${i}][1]` }))]);
    return `
var __res = doc.resolution;
if (__res !== 72) doc.resizeImage(undefined, undefined, 72, ResampleMethod.NONE);
var __path = null, __temp = true;
try {
  var __pts = ${json(pts)}, __info = [];
  for (var i = 0; i < __pts.length; i++) {
    var pp = new PathPointInfo();
    pp.kind = PointKind.CORNERPOINT;
    pp.anchor = __pts[i];
    pp.leftDirection = __pts[i];
    pp.rightDirection = __pts[i];
    __info.push(pp);
  }
  var __sub = new SubPathInfo();
  __sub.closed = ${bool(closed)};
  __sub.operation = ShapeOperation.SHAPEXOR;
  __sub.entireSubPath = __info;
  __path = doc.pathItems.add("Temporary path " + new Date().getTime(), [__sub]);
} finally {
  if (__res !== 72) doc.resizeImage(undefined, undefined, __res, ResampleMethod.NONE);
}`;
}

const PATH_END = 'if (__temp) __path.remove(); else __path.deselect();';

/** A boolean argument, or an error naming it. */
function flag(v, name) {
    if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return v;
}

/** A number argument within [min, max], as a number. */
const amount = (v, min, max, name) => Number(num(v, { min, max, name }));

/**
 * Options-bar settings set_tool_options writes into currentToolOptions:
 * [kind, keys, min, max, schema]. Kinds: b boolean, n number, e blend mode. Keys from the
 * currentToolOptions typings (photoshop-types) and the intechstudio and
 * Aya-Image-Edit plugins the atlas cites; tolerance is $BckT on the Paint
 * Bucket and Magic Eraser.
 */
const OPTION_BAR = {
    mode: ['e', ['mode'], 0, 0, { type: 'string', enum: Object.keys(AM_BLEND), description: 'Blend mode (options bar Mode) of a painting tool, the Paint Bucket or the Magic Eraser' }],
    pressureControlsSize: ['b', ['usePressureOverridesSize'], 0, 0, { type: 'boolean', description: 'Options bar button: pen pressure controls size, overriding the Brush Settings panel' }],
    pressureControlsOpacity: ['b', ['usePressureOverridesOpacity'], 0, 0, { type: 'boolean', description: 'Options bar button: pen pressure controls opacity' }],
    smoothing: ['n', ['smooth'], 0, 100, { type: 'number', minimum: 0, maximum: 100, description: 'Stroke Smoothing, percent (options bar)' }],
    pulledStringMode: ['b', ['smoothingRadiusMode'], 0, 0, { type: 'boolean', description: 'Smoothing options: Pulled String Mode' }],
    strokeCatchUp: ['b', ['smoothingCatchup'], 0, 0, { type: 'boolean', description: 'Smoothing options: Stroke Catch-up' }],
    catchUpOnStrokeEnd: ['b', ['smoothingCatchupAtEnd'], 0, 0, { type: 'boolean', description: 'Smoothing options: Catch-up on Stroke End' }],
    adjustForZoom: ['b', ['smoothingZoomCompensation'], 0, 0, { type: 'boolean', description: 'Smoothing options: Adjust for Zoom' }],
    wet: ['n', ['wetness'], 0, 100, { type: 'number', minimum: 0, maximum: 100, description: 'Mixer Brush: Wet, percent' }],
    mix: ['n', ['mix'], 0, 100, { type: 'number', minimum: 0, maximum: 100, description: 'Mixer Brush: Mix, percent' }],
    sampleAllLayers: ['b', ['sampleAllLayers'], 0, 0, { type: 'boolean', description: 'Sample All Layers (Mixer Brush and other tools that have it)' }],
    tolerance: ['n', ['tolerance', '@BckT'], 0, 255, { type: 'number', minimum: 0, maximum: 255, description: 'Tolerance: percent (1-100) for the Color Replacement tool, 0-255 for the Paint Bucket and Magic Eraser' }],
    contiguous: ['b', ['contiguous'], 0, 0, { type: 'boolean', description: 'Contiguous (Paint Bucket, Magic Eraser)' }],
};
const OPTION_BAR_PROPS = Object.fromEntries(Object.entries(OPTION_BAR).map(([k, v]) => [k, v[4]]));

/** set_tool_options arguments that go into currentToolOptions, as edits. */
function optionBarEdits(a) {
    const edits = [];
    for (const [name, [kind, keys, min, max]] of Object.entries(OPTION_BAR)) {
        if (a[name] === undefined) continue;
        if (kind === 'b') edits.push(opt([], keys, flag(a[name], name), name));
        else if (kind === 'e') edits.push(opt([], keys, AM_BLEND[enumOf(a[name], Object.keys(AM_BLEND), { name })], name));
        else edits.push(opt([], keys, amount(a[name], min, max, name), name));
        // Smoothing is kept twice: smooth (percent) and smoothingValue (0-255).
        if (name === 'smoothing') edits.push(opt([], ['smoothingValue'], Math.round((Number(a.smoothing) / 100) * 255), 'smoothingValue'));
    }
    return edits;
}

/**
 * The Brush Settings panel (Window > Brush Settings), section by section:
 * { argument: [kind, path, keys, min, max, description] }. Kinds: b boolean,
 * n number, v a brush variation (jitter and control; transfer ones also a
 * minimum). Paths walk into currentToolOptions; tipShape keys sit in the
 * brush tip. Keys from the currentToolOptions typings (photoshop-types) and
 * the intechstudio plugin the atlas cites; $-prefixed ones are charIDs.
 */
const BRUSH_SECTIONS = {
    tipShape: ['Brush Tip Shape', {
        size: ['size', [], ['diameter'], 1, 5000, 'Diameter in pixels'],
        hardness: ['tip', [], ['hardness'], 0, 100, 'Hardness, percent (round tips only)'],
        angle: ['tip', [], ['angle'], -180, 180, 'Angle in degrees'],
        roundness: ['tip', [], ['roundness'], 0, 100, 'Roundness, percent'],
        spacing: ['tip', [], ['spacing'], 1, 1000, 'Spacing, percent of the diameter'],
        useSpacing: ['tipb', [], ['interfaceIconFrameDimmed'], 0, 0, 'The Spacing checkbox: false paints at the speed of the stroke instead'],
        flipX: ['tipb', [], ['flipX'], 0, 0, 'Flip the tip horizontally'],
        flipY: ['tipb', [], ['flipY'], 0, 0, 'Flip the tip vertically'],
    }],
    shapeDynamics: ['Shape Dynamics', {
        enabled: ['b', [], ['useTipDynamics'], 0, 0, 'Turn the section on or off'],
        sizeJitter: ['v', ['@szVr'], [], 0, 100, 'Size Jitter and its Control'],
        minimumDiameter: ['n', [], ['minimumDiameter'], 0, 100, 'Minimum Diameter, percent'],
        tiltScale: ['n', [], ['tiltScale'], 0, 200, 'Tilt Scale, percent'],
        angleJitter: ['v', ['angleDynamics'], [], 0, 100, 'Angle Jitter and its Control'],
        roundnessJitter: ['v', ['roundnessDynamics'], [], 0, 100, 'Roundness Jitter and its Control'],
        minimumRoundness: ['n', [], ['minimumRoundness'], 1, 100, 'Minimum Roundness, percent'],
        flipXJitter: ['b', [], ['flipX'], 0, 0, 'Flip X Jitter'],
        flipYJitter: ['b', [], ['flipY'], 0, 0, 'Flip Y Jitter'],
        brushProjection: ['b', [], ['brushProjection'], 0, 0, 'Brush Projection'],
    }],
    scattering: ['Scattering', {
        enabled: ['b', [], ['useScatter'], 0, 0, 'Turn the section on or off'],
        scatter: ['v', ['scatterDynamics'], [], 0, 1000, 'Scatter (jitter, percent up to 1000) and its Control'],
        bothAxes: ['b', [], ['bothAxes'], 0, 0, 'Both Axes'],
        count: ['n', [], ['count'], 1, 16, 'Count'],
        countJitter: ['v', ['countDynamics'], [], 0, 100, 'Count Jitter and its Control'],
    }],
    texture: ['Texture', {
        enabled: ['b', [], ['useTexture'], 0, 0, 'Turn the section on or off'],
        invert: ['b', [], ['invertTexture'], 0, 0, 'Invert'],
        scale: ['n', [], ['textureScale'], 1, 1000, 'Scale, percent'],
        brightness: ['n', [], ['textureBrightness'], -150, 150, 'Brightness'],
        contrast: ['n', [], ['textureContrast'], -50, 100, 'Contrast'],
        depth: ['n', [], ['textureDepth'], 0, 100, 'Depth, percent'],
        minimumDepth: ['n', [], ['minimumDepth'], 0, 100, 'Minimum Depth, percent'],
        depthJitter: ['v', ['textureDepthDynamics'], [], 0, 100, 'Depth Jitter and its Control'],
    }],
    dualBrush: ['Dual Brush', {
        enabled: ['b', ['dualBrush'], ['useDualBrush'], 0, 0, 'Turn the section on or off'],
        size: ['n', ['dualBrush', 'brush'], ['diameter'], 1, 5000, 'The second tip\'s diameter in pixels'],
        spacing: ['n', ['dualBrush', 'brush'], ['spacing'], 1, 1000, 'The second tip\'s spacing, percent'],
        scatter: ['v', ['dualBrush', 'scatterDynamics'], [], 0, 1000, 'Scatter (jitter, percent up to 1000) and its Control'],
        bothAxes: ['b', ['dualBrush'], ['bothAxes'], 0, 0, 'Both Axes'],
        count: ['n', ['dualBrush'], ['count'], 1, 16, 'Count'],
    }],
    colorDynamics: ['Color Dynamics', {
        enabled: ['b', [], ['useColorDynamics'], 0, 0, 'Turn the section on or off'],
        applyPerTip: ['b', [], ['colorDynamicsPerTip'], 0, 0, 'Apply Per Tip'],
        foregroundBackgroundJitter: ['v', ['@clVr'], [], 0, 100, 'Foreground/Background Jitter and its Control'],
        hueJitter: ['n', [], ['hue'], 0, 100, 'Hue Jitter, percent'],
        saturationJitter: ['n', [], ['saturation'], 0, 100, 'Saturation Jitter, percent'],
        brightnessJitter: ['n', [], ['brightness'], 0, 100, 'Brightness Jitter, percent'],
        purity: ['n', [], ['purity'], -100, 100, 'Purity, percent'],
    }],
    transfer: ['Transfer', {
        enabled: ['b', [], ['usePaintDynamics'], 0, 0, 'Turn the section on or off'],
        opacityJitter: ['vm', ['@opVr'], [], 0, 100, 'Opacity Jitter, its Control and Minimum'],
        flowJitter: ['vm', ['@prVr'], [], 0, 100, 'Flow Jitter, its Control and Minimum'],
        wetnessJitter: ['vm', ['@wtVr'], [], 0, 100, 'Mixer Brush: Wetness Jitter, its Control and Minimum'],
        mixJitter: ['vm', ['@mxVr'], [], 0, 100, 'Mixer Brush: Mix Jitter, its Control and Minimum'],
    }],
    brushPose: ['Brush Pose', {
        enabled: ['b', [], ['useBrushPose'], 0, 0, 'Turn the section on or off'],
        tiltX: ['n', [], ['brushPoseTiltX'], -100, 100, 'Tilt X, percent'],
        tiltY: ['n', [], ['brushPoseTiltY'], -100, 100, 'Tilt Y, percent'],
        rotation: ['n', [], ['brushPoseAngle'], -180, 180, 'Rotation in degrees'],
        pressure: ['n', [], ['brushPosePressure'], 1, 100, 'Pressure, percent'],
        overrideTiltX: ['b', [], ['overridePoseTiltX'], 0, 0, 'Override the stylus tilt X'],
        overrideTiltY: ['b', [], ['overridePoseTiltY'], 0, 0, 'Override the stylus tilt Y'],
        overrideRotation: ['b', [], ['overridePoseAngle'], 0, 0, 'Override the stylus rotation'],
        overridePressure: ['b', [], ['overridePosePressure'], 0, 0, 'Override the stylus pressure'],
    }],
};

/** Brush Settings panel checkboxes with no options of their own. */
const BRUSH_TOGGLES = {
    noise: [['noise'], 'Noise'],
    wetEdges: [['wetEdges'], 'Wet Edges'],
    buildUp: [['repeat'], 'Build-up (the Airbrush)'],
    smoothing: [['smoothing'], 'Smoothing (of curves in strokes)'],
    protectTexture: [['protectTexture'], 'Protect Texture'],
};

/** Schema for a brush variation: jitter, control and fade steps; transfer ones add a minimum. */
function variationSchema(max, withMinimum, description) {
    return {
        type: 'object', description,
        properties: {
            jitter: { type: 'number', minimum: 0, maximum: max, description: 'Jitter, percent' },
            control: { type: 'string', enum: CONTROLS, description: 'What controls it: off, fade (over fadeSteps), pen_pressure, pen_tilt, stylus_wheel, initial_direction, direction, initial_rotation or rotation' },
            fadeSteps: { type: 'integer', minimum: 1, maximum: 9999, description: 'Steps for control fade' },
            ...(withMinimum ? { minimum: { type: 'number', minimum: 0, maximum: 100, description: 'Minimum, percent' } } : {}),
        },
    };
}

const BRUSH_SETTINGS_PROPS = Object.fromEntries([
    ...Object.entries(BRUSH_SECTIONS).map(([section, [title, fields]]) => [section, {
        type: 'object',
        description: `${title} section`,
        properties: Object.fromEntries(Object.entries(fields).map(([k, [kind, , , min, max, d]]) => [k,
            kind === 'v' || kind === 'vm' ? variationSchema(max, kind === 'vm', d)
                : kind === 'b' || kind === 'tipb' ? { type: 'boolean', description: d }
                    : { type: 'number', minimum: min, maximum: max, description: d }])),
    }]),
    ...Object.entries(BRUSH_TOGGLES).map(([k, [, title]]) => [k, { type: 'boolean', description: `${title} checkbox` }]),
]);

/** set_brush_settings arguments as edits. */
function brushEdits(a) {
    const edits = [];
    for (const [section, [, fields]] of Object.entries(BRUSH_SECTIONS)) {
        const given = a[section];
        if (given === undefined) continue;
        if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error(`'${section}' must be an object`);
        for (const [k, v] of Object.entries(given)) {
            if (v === undefined) continue;
            const field = fields[k];
            const label = `${section}.${k}`;
            if (!field) throw new Error(`Unknown setting ${label}. ${section} takes ${Object.keys(fields).join(', ')}`);
            const [kind, path, keys, min, max] = field;
            if (kind === 'size') edits.push(size(amount(v, min, max, label), label));
            else if (kind === 'tip') edits.push(tip(keys, amount(v, min, max, label), label));
            else if (kind === 'tipb') edits.push(tip(keys, flag(v, label), label));
            else if (kind === 'b') edits.push(opt(path, keys, flag(v, label), label));
            else if (kind === 'n') edits.push(opt(path, keys, amount(v, min, max, label), label));
            else {
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`'${label}' must be { jitter, control, fadeSteps${kind === 'vm' ? ', minimum' : ''} }`);
                const allowed = ['jitter', 'control', 'fadeSteps', ...(kind === 'vm' ? ['minimum'] : [])];
                const extra = Object.keys(v).filter((x) => !allowed.includes(x) && v[x] !== undefined);
                if (extra.length) throw new Error(`Unknown setting ${label}.${extra[0]}. It takes ${allowed.join(', ')}`);
                const before = edits.length;
                if (v.jitter !== undefined) edits.push(opt(path, ['jitter'], amount(v.jitter, 0, max, `${label}.jitter`), `${label}.jitter`, true));
                if (v.minimum !== undefined) edits.push(opt(path, ['minimum'], amount(v.minimum, 0, 100, `${label}.minimum`), `${label}.minimum`, true));
                if (v.control !== undefined) edits.push(opt(path, ['@bVTy'], CONTROLS.indexOf(enumOf(v.control, CONTROLS, { name: `${label}.control` })), `${label}.control`, true));
                if (v.fadeSteps !== undefined) {
                    const steps = amount(v.fadeSteps, 1, 9999, `${label}.fadeSteps`);
                    if (!Number.isInteger(steps)) throw new Error(`'${label}.fadeSteps' must be a whole number`);
                    edits.push(opt(path, ['@fStp'], steps, `${label}.fadeSteps`, true));
                }
                if (edits.length === before) throw new Error(`'${label}' needs at least one of ${allowed.join(', ')}`);
            }
        }
    }
    for (const [k, [keys]] of Object.entries(BRUSH_TOGGLES)) {
        if (a[k] !== undefined) edits.push(opt([], keys, flag(a[k], k), k));
    }
    return edits;
}

/**
 * Scripted patterns for Edit > Fill > Pattern > Script: the files Photoshop
 * ships in Presets/Deco, and the settings each one's menu takes (the
 * modelParameters at the top of the file): [min, max], 'n' for any number
 * (the script clamps it to the pattern's size) or 'b' for a checkbox.
 */
const DECO = {
    brick_fill: {
        file: 'Brick Fill.jsx', feature: 'photoshop.painting.fill_script_brick_fill',
        params: { patternScale: [0.1, 1.25], spacing: 'n', offset: [-100, 100], colorRandomness: [0, 1], brightnessRandomness: [0, 1], rotateAngle: [-180, 180] },
    },
    cross_weave: {
        file: 'Cross Weave.jsx', feature: 'photoshop.painting.fill_script_cross_weave',
        params: { patternScale: [0.1, 1.25], spacing: 'n', colorRandomness: [0, 1], brightnessRandomness: [0, 1] },
    },
    place_along_path: {
        file: 'Place Along Path.jsx', feature: 'photoshop.painting.fill_script_place_along_path', path: 'required',
        params: {
            patternScale: [0.1, 1.25], spacing: 'n', addSpaceToFit: 'b', angleFromPath: [-90, 90], distanceFromPath: 'n', alternate: 'b',
            scaleAlong: [90, 110], skipRotation: 'b', colorRandomness: [0, 1], brightnessRandomness: [0, 1],
        },
    },
    random_fill: {
        file: 'Random Fill.jsx', feature: 'photoshop.painting.fill_script_random_fill', path: 'optional',
        params: { density: [0.1, 10], patternScaleFrom: [0.1, 3], patternScaleTo: [0.1, 3], maxDistanceFromPath: [0, 250], applyRotation: 'b', colorRandomness: [0, 1], brightnessRandomness: [0, 1] },
    },
    symmetry_fill: {
        file: 'Symmetry Fill.jsx', feature: 'photoshop.painting.fill_script_symmetry_fill',
        params: { symmetryType: [0, 32], patternScale: [0.25, 1.25], patternTranslationX: [-100, 100], patternTranslationY: [-100, 100], colorRandomness: [0, 1], brightnessRandomness: [0, 1] },
    },
};

/**
 * The Deco parameter string for a scripted fill: the settings as an object
 * literal of checked numbers and booleans, which the script's menu reads in
 * place of showing its dialog, as when an action plays it.
 */
function decoParameters(kind, given) {
    const { params } = DECO[kind];
    if (given === undefined) return '({})';
    if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error("'scriptOptions' must be an object");
    const out = {};
    for (const [k, v] of Object.entries(given)) {
        if (v === undefined) continue;
        const spec = params[k];
        if (!spec) throw new Error(`Unknown scriptOptions.${k} for ${kind}. It takes ${Object.keys(params).join(', ')}`);
        if (spec === 'b') out[k] = flag(v, `scriptOptions.${k}`);
        else if (spec === 'n') out[k] = amount(v, -100000, 100000, `scriptOptions.${k}`);
        else out[k] = amount(v, spec[0], spec[1], `scriptOptions.${k}`);
    }
    if (kind === 'symmetry_fill' && out.symmetryType !== undefined && !Number.isInteger(out.symmetryType)) throw new Error("'scriptOptions.symmetryType' must be a whole number, 0-32");
    return `(${JSON.stringify(out)})`;
}

/** Clone Source panel menu toggles for the overlay, by their menu string ids. */
const CLONE_OVERLAY = {
    show_overlay: 'cloneSourceShowOverlay', auto_hide: 'cloneSourceAutoHideOverlay', clipped: 'cloneSourceClipOverlay', invert: 'cloneSourceInvertOverlay',
};

const STRUCTURE_SCHEMA = { type: 'integer', minimum: 1, maximum: 7, description: 'How closely the result keeps existing image patterns, 1 (loose) to 7 (strict). Default 5 for patch, 4 for move' };
const COLOR_ADAPT_SCHEMA = { type: 'integer', minimum: 0, maximum: 10, description: 'How much colour blending, 0 to 10. Default 5' };

export const tools = [
    {
        name: 'fill_contents',
        description: 'Fill the selection (or the whole layer when nothing is selected) on the active layer with the foreground or background colour, black, 50% gray, white, a pattern, a History state, or Content-Aware fill (Edit > Fill). A pattern fill can run one of the scripted patterns Photoshop ships (Edit > Fill > Pattern > Script: Brick Fill, Cross Weave, Place Along Path, Random Fill, Symmetry Fill) with its settings given here instead of in its dialog. Content-Aware needs a selection and fills it directly, without the Content-Aware Fill workspace. For a specific colour use fill_selection',
        inputSchema: {
            type: 'object',
            properties: {
                contents: { type: 'string', enum: ['foreground', 'background', 'black', 'gray', 'white', 'pattern', 'history', 'content_aware'], description: 'What to fill with; gray is 50% gray' },
                pattern: { type: 'string', description: 'Pattern name (from the Patterns panel), for contents pattern' },
                script: { type: 'string', enum: Object.keys(DECO), description: 'Contents pattern: lay the pattern out with this scripted pattern (the Script option)' },
                scriptOptions: {
                    type: 'object',
                    description: `With script: the script's settings; any left out keep the script's defaults, and values beyond what the script allows are clamped. ${Object.entries(DECO).map(([k, v]) => `${k}: ${Object.keys(v.params).join(', ')}`).join('; ')}. Scales and randomness are fractions (1 = 100%), spacing and distances pixels, angles degrees, symmetryType 0-32 as listed in the Symmetry Fill dialog`,
                },
                scriptPath: { type: 'string', description: 'With script place_along_path (required) or random_fill: the path in the Paths panel to place the pattern along' },
                historyIndex: { type: 'integer', minimum: 0, description: 'History state to fill from (list_history), for contents history. Default 0, the opening state' },
                colorAdaptation: { type: 'boolean', description: 'Content-Aware: blend the fill\'s colour with its surroundings. Default true' },
                rotationAdaptation: { type: 'boolean', description: 'Content-Aware: allow rotated samples. Default false' },
                scale: { type: 'boolean', description: 'Content-Aware: allow scaled samples. Default false' },
                mirror: { type: 'boolean', description: 'Content-Aware: allow mirrored samples. Default false' },
                blendMode: BLEND_SCHEMA,
                opacity: OPACITY_SCHEMA,
                preserveTransparency: { type: 'boolean', description: 'Leave transparent pixels transparent. Default false' },
            },
            required: ['contents'],
        },
        auditArgs: {
            contents: 'pattern', pattern: 'Bubbles', historyIndex: undefined, preserveTransparency: undefined, colorAdaptation: undefined, rotationAdaptation: undefined,
            scale: undefined, mirror: undefined, script: 'place_along_path', scriptOptions: { spacing: 4, alternate: false }, scriptPath: 'Path 1',
        },
        features: [
            'photoshop.painting.fill_with_foreground_color', 'photoshop.painting.fill_with_background_color', 'photoshop.painting.fill_option.background_color',
            'photoshop.painting.fill_option.black', 'photoshop.painting.fill_option.50pct_gray', 'photoshop.painting.fill_option.white',
            'photoshop.painting.fill_option.pattern', 'photoshop.painting.fill_option.custom_pattern', 'photoshop.painting.fill_option.history',
            'photoshop.painting.fill_option.content_aware', 'photoshop.painting.fill_option.color_adaptation',
            'photoshop.retouching.content_aware_fill_command', 'photoshop.retouching.content_aware_fill_workspace',
            'photoshop.retouching.content_aware_fill_workspace_option.color_adaptation', 'photoshop.retouching.content_aware_fill_workspace_option.rotation_adaptation',
            'photoshop.retouching.content_aware_fill_workspace_option.scale', 'photoshop.retouching.content_aware_fill_workspace_option.mirror',
            ...Object.values(DECO).map((d) => d.feature),
        ],
        handler: (a) => {
            const contents = enumOf(a.contents, ['foreground', 'background', 'black', 'gray', 'white', 'pattern', 'history', 'content_aware'], { name: 'contents' });
            const aware = contents === 'content_aware';
            if (contents === 'pattern' && (typeof a.pattern !== 'string' || !a.pattern)) throw new Error('contents pattern needs a pattern name');
            if (contents !== 'pattern' && a.pattern !== undefined) throw new Error('pattern applies only to contents pattern');
            if (a.script !== undefined && contents !== 'pattern') throw new Error('script applies only to contents pattern');
            if (a.script === undefined && (a.scriptOptions !== undefined || a.scriptPath !== undefined)) throw new Error('scriptOptions and scriptPath apply only with script');
            let deco = '', decoAfter = '';
            if (a.script !== undefined) {
                const kind = enumOf(a.script, Object.keys(DECO), { name: 'script' });
                const { file, path } = DECO[kind];
                if (path === 'required' && a.scriptPath === undefined) throw new Error(`${kind} needs scriptPath: the path to place the pattern along`);
                if (!path && a.scriptPath !== undefined) throw new Error(`scriptPath does not apply to ${kind}`);
                if (a.scriptPath !== undefined && (typeof a.scriptPath !== 'string' || !a.scriptPath)) throw new Error("'scriptPath' must be a path name");
                deco = `
var __deco = new File(app.path.fsName + "/Presets/Deco/" + ${str(file)});
if (!__deco.exists) throw new Error("Scripted pattern not found: " + __deco.fsName);
d.putPath(sid("decoScriptFile"), __deco);
d.putString(sid("decoScriptParameters"), ${str(decoParameters(kind, a.scriptOptions))});${a.scriptPath !== undefined ? `
var __decoPath = doc.pathItems.getByName(${str(a.scriptPath)});
__decoPath.select();` : ''}`;
                if (a.scriptPath !== undefined) decoAfter = '\n__decoPath.deselect();';
            }
            if (contents !== 'history' && a.historyIndex !== undefined) throw new Error('historyIndex applies only to contents history');
            const caOptions = ['colorAdaptation', 'rotationAdaptation', 'scale', 'mirror'].filter((k) => a[k] !== undefined);
            if (!aware && caOptions.length) throw new Error(`${caOptions.join(', ')} apply only to contents content_aware`);
            if (aware && a.preserveTransparency !== undefined) throw new Error('preserveTransparency does not apply to Content-Aware fill');
            let body;
            if (contents === 'history') {
                body = `
var __i = ${index(a.historyIndex ?? 0, { name: 'historyIndex' })};
if (__i >= doc.historyStates.length) throw new Error("No history state " + __i + "; there are " + doc.historyStates.length);
doc.selection.fill(doc.historyStates[__i], ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${opacity(a.opacity)}, ${bool(a.preserveTransparency)});`;
            } else {
                const using = { foreground: 'foregroundColor', background: 'backgroundColor', black: 'black', gray: 'gray', white: 'white', pattern: 'pattern', content_aware: 'contentAware' }[contents];
                body = `${AM}
${aware ? 'if (!__hasSelection()) throw new Error("Content-Aware fill needs a selection: select the area to replace first");' : ''}
var d = new ActionDescriptor();
d.putEnumerated(sid("using"), sid("fillContents"), sid(${str(using)}));
${contents === 'pattern' ? `var p = new ActionDescriptor();
p.putString(sid("name"), ${str(a.pattern)});
d.putObject(sid("pattern"), sid("pattern"), p);${deco}` : ''}
${aware ? `d.putBoolean(sid("contentAwareColorAdaptationFill"), ${bool(a.colorAdaptation ?? true)});
d.putBoolean(sid("contentAwareRotateFill"), ${bool(a.rotationAdaptation)});
d.putBoolean(sid("contentAwareScaleFill"), ${bool(a.scale)});
d.putBoolean(sid("contentAwareMirrorFill"), ${bool(a.mirror)});` : ''}
d.putUnitDouble(sid("opacity"), sid("percentUnit"), ${opacity(a.opacity)});
d.putEnumerated(sid("mode"), sid("blendMode"), sid(${str(blend(a.blendMode))}));
${!aware && a.preserveTransparency ? 'd.putBoolean(sid("preserveTransparency"), true);' : ''}
app.executeAction(sid("fill"), d, DialogModes.NO);${decoAfter}`;
            }
            return run('Fill', script(`${body}
__result__ = { contents: ${str(contents)}${a.script !== undefined ? `, script: ${str(a.script)}` : ''}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'draw_gradient',
        description: 'Draw a classic gradient on the active layer, inside the selection if there is one, from one point to another (Gradient tool in Classic gradient mode): linear, radial, angle, reflected or diamond, with colour and opacity stops, reverse, dither, transparency and interpolation. Without colours it runs from the foreground to the background colour',
        inputSchema: {
            type: 'object',
            properties: {
                from: { ...POINT_SCHEMA, description: 'Start point, pixels from the top-left' },
                to: { ...POINT_SCHEMA, description: 'End point, pixels from the top-left' },
                type: { type: 'string', enum: ['linear', 'radial', 'angle', 'reflected', 'diamond'], description: 'Default linear' },
                colors: {
                    type: 'array', minItems: 2,
                    description: 'Colour stops. Default foreground to background',
                    items: {
                        type: 'object',
                        properties: {
                            color: { type: 'string', description: COLOR_SCHEMA.description + ', or "foreground" or "background"' },
                            location: { type: 'number', minimum: 0, maximum: 100, description: 'Percent along the gradient' },
                            midpoint: { type: 'number', minimum: 5, maximum: 95, description: 'Percent between this stop and the next. Default 50' },
                        },
                        required: ['color', 'location'],
                    },
                },
                opacities: {
                    type: 'array', minItems: 2,
                    description: 'Opacity stops. Default fully opaque throughout',
                    items: {
                        type: 'object',
                        properties: {
                            opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                            location: { type: 'number', minimum: 0, maximum: 100, description: 'Percent along the gradient' },
                            midpoint: { type: 'number', minimum: 5, maximum: 95, description: 'Default 50' },
                        },
                        required: ['opacity', 'location'],
                    },
                },
                reverse: { type: 'boolean', description: 'Reverse the colour order. Default false' },
                dither: { type: 'boolean', description: 'Dither to reduce banding. Default true' },
                transparency: { type: 'boolean', description: 'Use the opacity stops (the Transparency option). Default true' },
                interpolation: { type: 'string', enum: ['perceptual', 'linear', 'classic', 'smooth', 'stripes'], description: 'How colours blend between stops. Default perceptual' },
                blendMode: BLEND_SCHEMA,
                opacity: OPACITY_SCHEMA,
            },
            required: ['from', 'to'],
        },
        auditArgs: { from: { x: 0, y: 0 }, to: { x: 300, y: 200 }, colors: [{ color: '#FF6600', location: 0 }, { color: 'background', location: 100, midpoint: 40 }], opacities: [{ opacity: 100, location: 0 }, { opacity: 0, location: 100 }] },
        features: [
            'photoshop.painting.gradient_tool', 'photoshop.painting.gradient_tool_option.classic_gradient',
            'photoshop.painting.gradient_tool_option.linear_gradient', 'photoshop.painting.gradient_tool_option.radial_gradient',
            'photoshop.painting.gradient_tool_option.angular_gradient', 'photoshop.painting.gradient_tool_option.reflected_gradient',
            'photoshop.painting.gradient_tool_option.diamond_gradient', 'photoshop.painting.gradient_tool_option.reverse',
            'photoshop.painting.gradient_tool_option.dither', 'photoshop.painting.gradient_tool_option.transparency',
            'photoshop.painting.gradient_tool_option.perceptual', 'photoshop.painting.gradient_tool_option.linear',
            'photoshop.painting.gradient_tool_option.classic',
        ],
        handler: (a) => {
            const [x1, y1] = point(a.from, 'from');
            const [x2, y2] = point(a.to, 'to');
            if (x1 === x2 && y1 === y2) throw new Error('from and to must be different points');
            const type = enumOf(a.type ?? 'linear', ['linear', 'radial', 'angle', 'reflected', 'diamond'], { name: 'type' });
            const method = enumOf(a.interpolation ?? 'perceptual', ['perceptual', 'linear', 'classic', 'smooth', 'stripes'], { name: 'interpolation' });
            // Stop locations run 0-4096 in the descriptor.
            const loc = (v, name) => Math.round(Number(num(v, { min: 0, max: 100, name })) * 40.96);
            const mid = (v, name) => Math.round(Number(num(v ?? 50, { min: 5, max: 95, name })));
            const colors = a.colors ?? [{ color: 'foreground', location: 0 }, { color: 'background', location: 100 }];
            if (!Array.isArray(colors) || colors.length < 2) throw new Error('colors needs at least two stops');
            const opacities = a.opacities ?? [{ opacity: 100, location: 0 }, { opacity: 100, location: 100 }];
            if (!Array.isArray(opacities) || opacities.length < 2) throw new Error('opacities needs at least two stops');
            const colorLines = colors.map((s, i) => {
                if (!s || typeof s !== 'object') throw new Error(`colors[${i}] must be { color, location }`);
                const kind = s.color === 'foreground' ? 'foregroundColor' : s.color === 'background' ? 'backgroundColor' : 'userStop';
                return `__colorStop(${str(kind)}, ${colorExpr(s.color, `colors[${i}].color`)}, ${loc(s.location, `colors[${i}].location`)}, ${mid(s.midpoint, `colors[${i}].midpoint`)});`;
            });
            const opacityLines = opacities.map((s, i) => {
                if (!s || typeof s !== 'object') throw new Error(`opacities[${i}] must be { opacity, location }`);
                return `__opacityStop(${num(s.opacity, { min: 0, max: 100, name: `opacities[${i}].opacity` })}, ${loc(s.location, `opacities[${i}].location`)}, ${mid(s.midpoint, `opacities[${i}].midpoint`)});`;
            });
            // charIDs where the stringID is ambiguous: "gradient" also names the
            // gradient event, and the point, stop and RGB classes read back as
            // other words.
            return run('Draw gradient', script(`${AM}
var __colors = new ActionList(), __stops = new ActionList();
var __colorStop = function (kind, c, location, midpoint) {
  var s = new ActionDescriptor(), rgb = new ActionDescriptor();
  rgb.putDouble(cid("Rd  "), c.rgb.red);
  rgb.putDouble(cid("Grn "), c.rgb.green);
  rgb.putDouble(cid("Bl  "), c.rgb.blue);
  s.putObject(sid("color"), cid("RGBC"), rgb);
  s.putEnumerated(sid("type"), sid("colorStopType"), sid(kind));
  s.putInteger(sid("location"), location);
  s.putInteger(sid("midpoint"), midpoint);
  __colors.putObject(cid("Clrt"), s);
};
var __opacityStop = function (value, location, midpoint) {
  var s = new ActionDescriptor();
  s.putUnitDouble(sid("opacity"), sid("percentUnit"), value);
  s.putInteger(sid("location"), location);
  s.putInteger(sid("midpoint"), midpoint);
  __stops.putObject(cid("TrnS"), s);
};
${colorLines.join('\n')}
${opacityLines.join('\n')}
var g = new ActionDescriptor();
g.putString(sid("name"), "Custom");
g.putEnumerated(sid("gradientForm"), sid("gradientForm"), sid("customStops"));
g.putDouble(sid("interfaceIconFrameDimmed"), 4096);
g.putList(sid("colors"), __colors);
g.putList(sid("transparency"), __stops);
var d = new ActionDescriptor();
d.putObject(sid("from"), cid("Pnt "), __pt(${x1}, ${y1}));
d.putObject(sid("to"), cid("Pnt "), __pt(${x2}, ${y2}));
d.putEnumerated(sid("type"), sid("gradientType"), sid(${str(type)}));
d.putBoolean(sid("dither"), ${bool(a.dither ?? true)});
d.putBoolean(sid("useMask"), ${bool(a.transparency ?? true)});
${a.reverse ? 'd.putBoolean(sid("reverse"), true);' : ''}
d.putEnumerated(sid("gradientsInterpolationMethod"), sid("gradientInterpolationMethodType"), sid(${str(method)}));
d.putEnumerated(sid("mode"), sid("blendMode"), sid(${str(blend(a.blendMode))}));
d.putUnitDouble(sid("opacity"), sid("percentUnit"), ${opacity(a.opacity)});
d.putObject(cid("Grad"), cid("Grdn"), g);
app.executeAction(sid("gradientClassEvent"), d, DialogModes.NO);
__result__ = { type: ${str(type)}, from: { x: ${x1}, y: ${y1} }, to: { x: ${x2}, y: ${y2} }, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'stroke_path',
        description: 'Paint along a path on the active layer with a painting or retouching tool, using that tool\'s current brush and options (Paths panel > Stroke Path). Give a path from the Paths panel or points for a temporary one. Set the brush first with set_tool_options. Clone Stamp and Healing Brush need cloneSource',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(STROKE_TOOLS), description: 'The tool to paint with' },
                ...PATH_PROPS,
                closed: { type: 'boolean', description: 'With points: close the temporary path. Default false' },
                simulatePressure: { type: 'boolean', description: 'Taper the stroke as if drawn with a pressure-sensitive pen. Default false' },
                cloneSource: {
                    type: 'object',
                    description: 'Clone Stamp and Healing Brush: where to sample from, as Alt-clicking does',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, layer: { type: 'string', description: 'Layer to sample. Default the active layer' } },
                    required: ['x', 'y'],
                },
            },
            required: ['tool'],
        },
        auditArgs: { path: undefined, tool: 'clone_stamp', points: [[10, 10], [200, 120], [60, 180]], cloneSource: { x: 40, y: 40 } },
        features: [
            'photoshop.painting.stroke_path', 'photoshop.painting.stroke_path_option.simulate_pressure',
            'photoshop.painting.brush_tool', 'photoshop.painting.pencil_tool', 'photoshop.painting.color_replacement_tool', 'photoshop.painting.art_history_brush_tool',
            'photoshop.painting.eraser_tool', 'photoshop.painting.background_eraser_tool',
            'photoshop.retouching.healing_brush_tool', 'photoshop.retouching.clone_stamp_tool', 'photoshop.retouching.pattern_stamp_tool',
            'photoshop.retouching.blur_tool', 'photoshop.retouching.sharpen_tool', 'photoshop.retouching.smudge_tool',
            'photoshop.retouching.dodge_tool', 'photoshop.retouching.burn_tool', 'photoshop.retouching.sponge_tool',
            'photoshop.painting.pattern_stamp_painting',
        ],
        handler: (a) => {
            const tool = enumOf(a.tool, Object.keys(STROKE_TOOLS), { name: 'tool' });
            const sampled = tool === 'clone_stamp' || tool === 'healing_brush';
            if (sampled && !a.cloneSource) throw new Error(`${tool} needs cloneSource: the point to sample from`);
            if (!sampled && a.cloneSource) throw new Error('cloneSource applies only to clone_stamp and healing_brush');
            if (a.closed !== undefined && a.points === undefined) throw new Error('closed applies only to points');
            let source = '';
            if (sampled) {
                const [sx, sy] = point(a.cloneSource, 'cloneSource');
                source = `
var cs = new ActionDescriptor(), csRef = new ActionReference(), csTo = new ActionDescriptor(), csLayer = new ActionReference();
csRef.putProperty(cid("Prpr"), cid("ClnS"));
csRef.putEnumerated(cid("capp"), cid("Ordn"), cid("Trgt"));
cs.putReference(cid("null"), csRef);
csLayer.putName(cid("Lyr "), ${a.cloneSource.layer !== undefined ? str(a.cloneSource.layer) : 'doc.activeLayer.name'});
csTo.putReference(cid("Srce"), csLayer);
csTo.putObject(cid("Pstn"), cid("Pnt "), __pt(${sx}, ${sy}));
cs.putObject(cid("T   "), cid("ImgP"), csTo);
app.executeAction(cid("setd"), cs, DialogModes.NO);`;
            }
            return run('Stroke path', script(`${AM}
${pathStart(a, { closed: !!a.closed })}
var __prevTool = app.currentTool;
try {
  __path.select();
  app.currentTool = ${str(STROKE_TOOLS[tool])};
  ${source}
  var ref = new ActionReference(), d = new ActionDescriptor();
  ref.putEnumerated(sid("path"), sid("ordinal"), sid("targetEnum"));
  d.putReference(sid("null"), ref);
  d.putClass(sid("using"), sid(${str(STROKE_TOOLS[tool])}));
  ${a.simulatePressure ? 'd.putBoolean(sid("pressure"), true);' : ''}
  app.executeAction(sid("stroke"), d, DialogModes.NO);
} finally {
  try { app.currentTool = __prevTool; } catch (e) {}
  ${PATH_END}
}
__result__ = { tool: ${str(tool)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'fill_path',
        description: 'Fill the area inside a path on the active layer with a colour (Paths panel > Fill Path), with blend mode, opacity, feather and anti-aliasing. Give a path from the Paths panel or points for a temporary one',
        inputSchema: {
            type: 'object',
            properties: {
                ...PATH_PROPS,
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Default the foreground colour' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Default normal' },
                opacity: OPACITY_SCHEMA,
                preserveTransparency: { type: 'boolean', description: 'Default false' },
                feather: { type: 'number', minimum: 0, maximum: 250, description: 'Pixels. Default 0' },
                antiAlias: { type: 'boolean', description: 'Default true' },
            },
        },
        auditArgs: { path: undefined, points: [[10, 10], [200, 10], [100, 150]], color: '#336699' },
        features: ['photoshop.painting.fill_path'],
        handler: (a) => run('Fill path', script(`
${pathStart(a, { closed: true })}
try {
  __path.fillPath(${colorExpr(a.color, 'color')}, ColorBlendMode.${FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })]}, ${opacity(a.opacity)}, ${bool(a.preserveTransparency)}, ${num(a.feather ?? 0, { min: 0, max: 250, name: 'feather' })}, ${bool(a.antiAlias ?? true)}, true);
} finally {
  ${PATH_END}
}
__result__ = { layer: __layerInfo(doc.activeLayer) };`)),
    },
    {
        name: 'fill_at_point',
        description: 'Fill (Paint Bucket tool) or erase (Magic Eraser tool) the area of similar colour around a point on the active layer, within the selection if there is one. Erasing on the Background layer turns it into an ordinary layer, as the Magic Eraser does',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['fill', 'erase'] },
                x: { type: 'number', description: 'Pixels from the left' },
                y: { type: 'number', description: 'Pixels from the top' },
                tolerance: { type: 'integer', minimum: 0, maximum: 255, description: 'How different a colour may be and still be included. Default 32' },
                contiguous: { type: 'boolean', description: 'Only connected pixels. Default true' },
                antiAlias: { type: 'boolean', description: 'Smooth the edge. Default true' },
                sampleAllLayers: { type: 'boolean', description: 'Judge colours from all visible layers. Default false' },
                color: { ...COLOR_SCHEMA, description: COLOR_SCHEMA.description + '. Fill only. Default the foreground colour' },
                blendMode: { type: 'string', enum: Object.keys(FILL_BLEND), description: 'Fill only. Default normal' },
                opacity: OPACITY_SCHEMA,
            },
            required: ['action', 'x', 'y'],
        },
        auditArgs: { color: '#FF6600' },
        features: ['photoshop.painting.paint_bucket_tool', 'photoshop.painting.magic_eraser_tool'],
        handler: (a) => {
            const action = enumOf(a.action, ['fill', 'erase'], { name: 'action' });
            if (action === 'erase' && (a.color !== undefined || a.blendMode !== undefined)) throw new Error('color and blendMode apply only to fill');
            const x = num(a.x, { name: 'x' }), y = num(a.y, { name: 'y' });
            const mode = action === 'erase' ? 'CLEAR' : FILL_BLEND[enumOf(a.blendMode ?? 'normal', Object.keys(FILL_BLEND), { name: 'blendMode' })];
            return run(action === 'fill' ? 'Paint bucket' : 'Magic eraser', script(`${AM}
var l = doc.activeLayer;
${action === 'erase' ? 'if (l.typename === "ArtLayer" && l.isBackgroundLayer) l.isBackgroundLayer = false;' : ''}
var __prior = null, __chans = doc.activeChannels;
if (__hasSelection()) {
  __prior = doc.channels.add();
  __prior.name = "Temporary selection";
  doc.selection.store(__prior, SelectionType.REPLACE);
  doc.activeChannels = __chans;
}
try {
  var ref = new ActionReference(), d = new ActionDescriptor();
  ref.putProperty(sid("channel"), sid("selection"));
  d.putReference(sid("null"), ref);
  d.putObject(sid("to"), cid("Pnt "), __pt(${x}, ${y}));
  d.putInteger(sid("tolerance"), ${num(a.tolerance ?? 32, { min: 0, max: 255, name: 'tolerance' })});
  d.putBoolean(sid("antiAlias"), ${bool(a.antiAlias ?? true)});
  ${a.contiguous === false ? 'd.putBoolean(sid("contiguous"), false);' : ''}
  ${a.sampleAllLayers ? 'd.putBoolean(sid("merged"), true);' : ''}
  app.executeAction(sid("set"), d, DialogModes.NO);
  if (__prior) doc.selection.load(__prior, SelectionType.INTERSECT, false);
  doc.selection.fill(${action === 'fill' ? colorExpr(a.color, 'color') : 'app.foregroundColor'}, ColorBlendMode.${mode}, ${opacity(a.opacity)}, false);
} finally {
  if (__prior) {
    doc.selection.load(__prior, SelectionType.REPLACE, false);
    __prior.remove();
    doc.activeChannels = __chans;
  } else {
    doc.selection.deselect();
  }
}
__result__ = { action: ${str(action)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'set_tool_options',
        description: 'Choose the active tool and set its options bar: a brush preset (Brushes panel or the Brush Preset picker), size, hardness, opacity, flow, blend mode, the tablet pressure buttons for size and opacity, Smoothing and its options (Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End, Adjust for Zoom), the Mixer Brush\'s Wet, Mix and Sample All Layers, Tolerance and Contiguous (Color Replacement, Paint Bucket, Magic Eraser), and the painting cursor style (Preferences > Cursors). The Mixer Brush, Spot Healing Brush and Red Eye tools can be made active here; painting with them stays on the canvas. stroke_path paints with these settings; set_brush_settings covers the Brush Settings panel. Returns the tool\'s options afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(ACTIVE_TOOLS), description: 'Tool to make active. Default the current tool' },
                preset: { type: 'string', description: 'Brush preset name, as the Brushes panel lists it' },
                size: { type: 'number', minimum: 1, maximum: 5000, description: 'Brush diameter in pixels' },
                hardness: { type: 'number', minimum: 0, maximum: 100, description: 'Brush hardness, percent' },
                opacity: { type: 'integer', minimum: 1, maximum: 100, description: 'Tool opacity, percent' },
                flow: { type: 'integer', minimum: 1, maximum: 100, description: 'Tool flow, percent' },
                paintingCursors: { type: 'string', enum: ['standard', 'precise', 'brush_size'], description: 'How painting cursors look' },
                ...OPTION_BAR_PROPS,
            },
        },
        features: [
            'photoshop.painting.brushes_panel', 'photoshop.painting.brush_tool_option.size', 'photoshop.painting.brush_tool_option.hardness',
            'photoshop.painting.brush_tool_option.opacity', 'photoshop.painting.brush_tool_option.flow', 'photoshop.painting.painting_cursors',
            'photoshop.painting.brush_tool_option.brush_preset_picker', 'photoshop.painting.brush_tool_option.mode',
            'photoshop.painting.brush_tool_option.tablet_pressure_buttons', 'photoshop.painting.brush_tool_option.smoothing',
            'photoshop.painting.brush_tool_option.pulled_string_mode', 'photoshop.painting.brush_tool_option.stroke_catch_up',
            'photoshop.painting.brush_tool_option.catch_up_on_stroke_end', 'photoshop.painting.brush_tool_option.adjust_for_zoom',
            'photoshop.painting.mixer_brush_tool', 'photoshop.painting.mixer_brush_tool_option.wet', 'photoshop.painting.mixer_brush_tool_option.mix',
            'photoshop.painting.mixer_brush_tool_option.sample_all_layers', 'photoshop.painting.color_replacement_tool_option.tolerance',
            'photoshop.painting.eraser_tool_option.opacity', 'photoshop.painting.magic_eraser_tool_option.contiguous',
            'photoshop.painting.magic_eraser_tool_option.opacity', 'photoshop.painting.paint_bucket_tool_option.mode',
            'photoshop.painting.paint_bucket_tool_option.opacity', 'photoshop.painting.paint_bucket_tool_option.contiguous',
            'photoshop.retouching.spot_healing_brush_tool', 'photoshop.retouching.red_eye_tool',
        ],
        handler: (a) => {
            const edits = optionBarEdits(a);
            const keys = ['tool', 'preset', 'size', 'hardness', 'opacity', 'flow', 'paintingCursors'].filter((k) => a[k] !== undefined);
            if (edits.length) keys.push('options');
            const lines = [];
            if (a.tool !== undefined) lines.push(`app.currentTool = ${str(ACTIVE_TOOLS[enumOf(a.tool, Object.keys(ACTIVE_TOOLS), { name: 'tool' })])};`);
            if (a.preset !== undefined) {
                if (typeof a.preset !== 'string' || !a.preset) throw new Error("'preset' must be a brush preset name");
                lines.push(`var pr = new ActionReference(), pd = new ActionDescriptor();
pr.putName(sid("brush"), ${str(a.preset)});
pd.putReference(sid("null"), pr);
app.executeAction(sid("select"), pd, DialogModes.NO);`);
            }
            if (a.size !== undefined || a.hardness !== undefined) {
                lines.push(`var br = new ActionReference(), bd = new ActionDescriptor(), tip = new ActionDescriptor();
br.putEnumerated(sid("brush"), sid("ordinal"), sid("targetEnum"));
bd.putReference(sid("null"), br);
${a.size !== undefined ? `tip.putUnitDouble(sid("masterDiameter"), sid("pixelsUnit"), ${num(a.size, { min: 1, max: 5000, name: 'size' })});` : ''}
${a.hardness !== undefined ? `tip.putUnitDouble(sid("hardness"), sid("percentUnit"), ${num(a.hardness, { min: 0, max: 100, name: 'hardness' })});` : ''}
bd.putObject(sid("to"), sid("brush"), tip);
app.executeAction(sid("set"), bd, DialogModes.NO);`);
            }
            if (a.opacity !== undefined || a.flow !== undefined) {
                const intIn = (v, name) => {
                    const s = num(v, { min: 1, max: 100, name });
                    if (!Number.isInteger(Number(s))) throw new Error(`'${name}' must be a whole percent`);
                    return s;
                };
                lines.push(`var o = __toolOptions();
${a.opacity !== undefined ? `o.putInteger(sid("opacity"), ${intIn(a.opacity, 'opacity')});` : ''}
${a.flow !== undefined ? `o.putInteger(sid("flow"), ${intIn(a.flow, 'flow')});` : ''}
var sr = new ActionReference(), sd = new ActionDescriptor();
sr.putProperty(sid("property"), sid("currentToolOptions"));
sr.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
sd.putReference(sid("null"), sr);
sd.putObject(sid("to"), sid("currentToolOptions"), o);
app.executeAction(sid("set"), sd, DialogModes.NO);`);
            }
            if (a.paintingCursors !== undefined) {
                lines.push(`app.preferences.paintingCursors = PaintingCursors.${{ standard: 'STANDARD', precise: 'PRECISE', brush_size: 'BRUSHSIZE' }[enumOf(a.paintingCursors, ['standard', 'precise', 'brush_size'], { name: 'paintingCursors' })]};`);
            }
            if (!keys.length) throw new Error(`Give tool, preset, size, hardness, opacity, flow, paintingCursors or ${Object.keys(OPTION_BAR_PROPS).join(', ')}`);
            if (edits.length) lines.push(`var __settings = ${applyEdits(edits)};`);
            return run('Set tool options', script(`${AM}${edits.length ? TOOL_OPTIONS_HELPERS : ''}
var __toolOptions = function () {
  var r = new ActionReference();
  r.putProperty(sid("property"), sid("currentToolOptions"));
  r.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
  return app.executeActionGet(r).getObjectValue(sid("currentToolOptions"));
};
${lines.join('\n')}
var now = __toolOptions(), out = { tool: app.currentTool };
if (now.hasKey(sid("opacity"))) out.opacity = now.getInteger(sid("opacity"));
if (now.hasKey(sid("flow"))) out.flow = now.getInteger(sid("flow"));
if (now.hasKey(sid("brush"))) {
  var tipNow = now.getObjectValue(sid("brush"));
  if (tipNow.hasKey(sid("masterDiameter"))) out.size = tipNow.getUnitDoubleValue(sid("masterDiameter"));
  if (tipNow.hasKey(sid("hardness"))) out.hardness = tipNow.getUnitDoubleValue(sid("hardness"));
}
out.paintingCursors = __enumName(app.preferences.paintingCursors);${edits.length ? '\nout.settings = __settings;' : ''}
__result__ = out;`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_brushes',
        description: 'Brush presets and files (Brushes panel and its menu): load a brush file (.abr) as the current tool\'s brush (Import Brushes), save the current tool\'s brush to a file (Export Selected Brushes), define a preset from the selection, or the whole image when nothing is selected (Edit > Define Brush Preset), save the current brush and its settings as a new preset (New Brush Preset), rename or delete a preset, or restore the default brushes (Reset Brushes), replacing the current set or appending to it',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['import', 'export', 'define', 'new_preset', 'rename', 'delete', 'reset'] },
                filePath: { type: 'string', description: 'Import or export: absolute path to a .abr file' },
                name: { type: 'string', description: 'Define and new_preset: the new preset\'s name. Rename: the new name' },
                preset: { type: 'string', description: 'Rename and delete: the preset\'s name, as the Brushes panel lists it' },
                append: { type: 'boolean', description: 'Reset: add the default brushes to the current ones instead of replacing them. Default false' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'export', filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit.abr`, name: undefined, preset: undefined, append: undefined },
        hints: { destructive: true },
        features: [
            'photoshop.painting.brushes_panel_option.import_brushes', 'photoshop.painting.brushes_panel_option.export_selected_brushes', 'photoshop.painting.define_brush_preset',
            'photoshop.painting.brushes_panel_option.new_brush_preset', 'photoshop.painting.brushes_panel_option.rename_brush',
            'photoshop.painting.brushes_panel_option.delete', 'photoshop.painting.brushes_panel_option.reset_brushes',
        ],
        handler: (a) => {
            const action = enumOf(a.action, ['import', 'export', 'define', 'new_preset', 'rename', 'delete', 'reset'], { name: 'action' });
            const named = (v, what) => { if (typeof v !== 'string' || !v) throw new Error(`${action} needs ${what}`); return v; };
            const onlyFor = (key, actions) => { if (a[key] !== undefined && !actions.includes(action)) throw new Error(`${key} applies only to ${actions.join(' and ')}`); };
            onlyFor('filePath', ['import', 'export']);
            onlyFor('name', ['define', 'new_preset', 'rename']);
            onlyFor('preset', ['rename', 'delete']);
            onlyFor('append', ['reset']);
            if (action === 'define') {
                named(a.name, 'a name for the preset');
                return run('Define brush preset', script(`${AM}
var d = new ActionDescriptor(), ref = new ActionReference(), src = new ActionReference();
ref.putClass(sid("brush"));
d.putReference(sid("null"), ref);
d.putString(sid("name"), ${str(a.name)});
src.putProperty(sid("property"), sid("selection"));
src.putEnumerated(sid("document"), sid("ordinal"), sid("targetEnum"));
d.putReference(sid("using"), src);
app.executeAction(sid("make"), d, DialogModes.NO);
__result__ = { action: "define", name: ${str(a.name)} };`));
            }
            if (action === 'new_preset') {
                named(a.name, 'a name for the preset');
                return run('New brush preset', script(`${AM}
var d = new ActionDescriptor(), ref = new ActionReference(), src = new ActionReference();
ref.putClass(sid("brush"));
d.putReference(sid("null"), ref);
d.putString(sid("name"), ${str(a.name)});
src.putProperty(sid("property"), sid("currentToolOptions"));
src.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
d.putReference(sid("using"), src);
app.executeAction(sid("make"), d, DialogModes.NO);
__result__ = { action: "new_preset", name: ${str(a.name)}, tool: app.currentTool };`, { needsDocument: false }));
            }
            if (action === 'rename' || action === 'delete') {
                named(a.preset, 'preset: the name of the brush preset');
                if (action === 'rename') named(a.name, 'name: the new name');
                return run(action === 'rename' ? 'Rename brush preset' : 'Delete brush preset', script(`${AM}
var d = new ActionDescriptor(), ref = new ActionReference();
ref.putName(sid("brush"), ${str(a.preset)});
d.putReference(sid("null"), ref);
${action === 'rename' ? `var to = new ActionDescriptor();
to.putString(sid("name"), ${str(a.name)});
d.putObject(sid("to"), sid("brush"), to);
app.executeAction(sid("set"), d, DialogModes.NO);
__result__ = { action: "rename", preset: ${str(a.preset)}, name: ${str(a.name)} };` : `app.executeAction(sid("delete"), d, DialogModes.NO);
__result__ = { action: "delete", preset: ${str(a.preset)} };`}`, { needsDocument: false }));
            }
            if (action === 'reset') {
                return run('Reset brushes', script(`${AM}
var d = new ActionDescriptor(), ref = new ActionReference();
ref.putProperty(sid("property"), sid("brush"));
ref.putEnumerated(sid("application"), sid("ordinal"), sid("targetEnum"));
d.putReference(sid("null"), ref);
d.putBoolean(sid("append"), ${bool(a.append)});
app.executeAction(sid("reset"), d, DialogModes.NO);
__result__ = { action: "reset", append: ${bool(a.append)} };`, { needsDocument: false }));
            }
            if (typeof a.filePath !== 'string' || !/\.abr$/i.test(a.filePath)) throw new Error('filePath must be an absolute path ending in .abr');
            const p = paths.validate(a.filePath);
            return run(action === 'import' ? 'Import brushes' : 'Export brushes', script(`
var f = new File(${jsxPath(p)});
${action === 'import' ? `if (!f.exists) throw new Error("File not found: " + f.fsName);
app.applyToolBrushFromFile(f);` : 'app.saveToolBrushToFile(f);'}
__result__ = { action: ${str(action)}, file: f.fsName, tool: app.currentTool };`, { needsDocument: false }));
        },
    },
    {
        name: 'retouch_selection',
        description: 'Repair or move the selected area on the active pixel layer by an offset: patch it from nearby pixels (Patch tool, Normal or Content-Aware), or move or extend it and fill the gap (Content-Aware Move tool). Needs a selection; dx and dy are the drag in pixels',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', enum: ['patch', 'content_aware_move'] },
                dx: { type: 'number', description: 'Horizontal offset in pixels, positive to the right' },
                dy: { type: 'number', description: 'Vertical offset in pixels, positive downward' },
                patchMode: { type: 'string', enum: ['content_aware', 'normal'], description: 'Patch: how the patch blends. Default content_aware' },
                patchFrom: { type: 'string', enum: ['source', 'destination'], description: 'Patch: source repairs the selection with the pixels at the offset; destination copies the selection to the offset. Default source' },
                transparent: { type: 'boolean', description: 'Patch: blend the sampled texture transparently. Default false' },
                moveMode: { type: 'string', enum: ['move', 'extend'], description: 'Content-Aware Move: move the content, or extend (duplicate) it. Default move' },
                structure: STRUCTURE_SCHEMA,
                color: COLOR_ADAPT_SCHEMA,
                sampleAllLayers: { type: 'boolean', description: 'Sample all visible layers. Default false' },
            },
            required: ['method', 'dx', 'dy'],
        },
        auditArgs: { method: 'patch', moveMode: undefined, structure: 5, color: 5 },
        features: [
            'photoshop.retouching.patch_tool', 'photoshop.retouching.patch_tool_option.normal', 'photoshop.retouching.patch_tool_option.content_aware',
            'photoshop.retouching.patch_tool_option.transparent', 'photoshop.retouching.patch_tool_option.structure', 'photoshop.retouching.patch_tool_option.color',
            'photoshop.retouching.patch_tool_option.sample_all_layers',
            'photoshop.retouching.content_aware_move_tool', 'photoshop.retouching.content_aware_move_tool_option.move', 'photoshop.retouching.content_aware_move_tool_option.extend',
            'photoshop.retouching.content_aware_move_tool_option.structure', 'photoshop.retouching.content_aware_move_tool_option.color',
            'photoshop.retouching.content_aware_move_tool_option.sample_all_layers',
        ],
        handler: (a) => {
            const method = enumOf(a.method, ['patch', 'content_aware_move'], { name: 'method' });
            const patch = method === 'patch';
            const dx = num(a.dx, { min: -30000, max: 30000, name: 'dx' }), dy = num(a.dy, { min: -30000, max: 30000, name: 'dy' });
            if (Number(dx) === 0 && Number(dy) === 0) throw new Error('dx and dy cannot both be 0');
            const wrong = (patch ? ['moveMode'] : ['patchMode', 'patchFrom', 'transparent']).filter((k) => a[k] !== undefined);
            if (wrong.length) throw new Error(`${wrong.join(', ')} do not apply to ${method}`);
            const structure = num(a.structure ?? (patch ? 5 : 4), { min: 1, max: 7, name: 'structure' });
            const color = num(a.color ?? 5, { min: 0, max: 10, name: 'color' });
            if (!Number.isInteger(Number(structure)) || !Number.isInteger(Number(color))) throw new Error('structure and color are whole numbers');
            const lines = patch ? `
d.putObject(sid("from"), sid("offset"), off);
d.putBoolean(sid("transparency"), ${bool(a.transparent)});
d.putEnumerated(sid("patchMode"), sid("patchModeType"), sid(${str(enumOf(a.patchMode ?? 'content_aware', ['content_aware', 'normal'], { name: 'patchMode' }) === 'normal' ? 'patchNormal' : 'patchContentAware')}));
d.putBoolean(sid("reshuffle"), false);
d.putBoolean(sid("sampleAllLayers"), ${bool(a.sampleAllLayers)});
d.putInteger(sid("patchStructureAdapt"), ${structure});
d.putInteger(sid("patchColorAdaptation"), ${color});
d.putInteger(sid("healSmoothFactor"), 5);
d.putBoolean(sid("useSource"), ${bool(enumOf(a.patchFrom ?? 'source', ['source', 'destination'], { name: 'patchFrom' }) === 'source')});
app.executeAction(sid("patchSelection"), d, DialogModes.NO);` : `
d.putObject(sid("to"), sid("offset"), off);
d.putBoolean(sid("transparency"), false);
d.putEnumerated(sid("patchMode"), sid("patchModeType"), sid("patchContentAware"));
d.putEnumerated(sid("remixMode"), sid("remixModeType"), sid(${str(enumOf(a.moveMode ?? 'move', ['move', 'extend'], { name: 'moveMode' }) === 'extend' ? 'remixExtend' : 'remixMove')}));
d.putBoolean(sid("reshuffle"), true);
d.putBoolean(sid("clone"), false);
d.putBoolean(sid("sampleAllLayers"), ${bool(a.sampleAllLayers)});
d.putBoolean(sid("transformOnDrop"), false);
d.putInteger(sid("patchStructureAdapt"), ${structure});
d.putInteger(sid("patchColorAdaptation"), ${color});
d.putInteger(sid("healSmoothFactor"), 5);
d.putBoolean(sid("useSource"), false);
app.executeAction(sid("recomposeSelection"), d, DialogModes.NO);`;
            return run(patch ? 'Patch' : 'Content-Aware Move', script(`${AM}
if (!__hasSelection()) throw new Error("Select the area to ${patch ? 'patch' : 'move'} first");
var l = doc.activeLayer;
if (l.typename !== "ArtLayer" || l.kind !== LayerKind.NORMAL) throw new Error(l.name + " is not a pixel layer; rasterize it first");
var ref = new ActionReference(), d = new ActionDescriptor(), off = new ActionDescriptor();
ref.putProperty(sid("channel"), sid("selection"));
d.putReference(sid("null"), ref);
off.putUnitDouble(sid("horizontal"), sid("pixelsUnit"), ${dx});
off.putUnitDouble(sid("vertical"), sid("pixelsUnit"), ${dy});
${lines}
__result__ = { method: ${str(method)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'set_brush_settings',
        description: 'Set the current tool\'s brush in the Brush Settings panel (Window > Brush Settings): Brush Tip Shape (size, hardness, angle, roundness, spacing, flip), Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer and Brush Pose, each section\'s on/off switch, the jitters and their Control (fade, pen pressure, tilt, stylus wheel, direction, rotation), and the Noise, Wet Edges, Build-up, Smoothing and Protect Texture checkboxes; clearControls first turns every dynamics option off (Clear Brush Controls). Only the settings given change; one the tool lacks is an error. stroke_path paints with these settings. Returns each setting as Photoshop holds it afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', enum: Object.keys(ACTIVE_TOOLS), description: 'Tool to make active first. Default the current tool' },
                clearControls: { type: 'boolean', description: 'Clear Brush Controls (Brush Settings panel menu) before applying the rest' },
                ...BRUSH_SETTINGS_PROPS,
            },
        },
        auditArgs: {
            tool: 'brush', clearControls: true,
            tipShape: { size: 30, angle: 45, roundness: 60, spacing: 25, flipX: true },
            shapeDynamics: { enabled: true, sizeJitter: { jitter: 40, control: 'pen_pressure' }, minimumDiameter: 10 },
            transfer: { enabled: true, opacityJitter: { jitter: 20, minimum: 5, control: 'fade', fadeSteps: 30 } },
            dualBrush: { enabled: true, size: 12 }, wetEdges: true,
        },
        hints: { idempotent: true },
        features: [
            'photoshop.painting.brush_settings_panel', 'photoshop.painting.brush_settings_brush_tip_shape', 'photoshop.painting.brush_settings_shape_dynamics',
            'photoshop.painting.brush_settings_scattering', 'photoshop.painting.brush_settings_texture', 'photoshop.painting.brush_settings_dual_brush',
            'photoshop.painting.brush_settings_color_dynamics', 'photoshop.painting.brush_settings_transfer', 'photoshop.painting.brush_settings_brush_pose',
            'photoshop.painting.brush_settings_noise', 'photoshop.painting.brush_settings_wet_edges', 'photoshop.painting.brush_settings_airbrush_build_up',
            'photoshop.painting.brush_settings_smoothing', 'photoshop.painting.brush_settings_protect_texture',
            ...['size_jitter_and_control', 'minimum_diameter', 'tilt_scale', 'angle_jitter_and_control', 'roundness_jitter_and_control', 'minimum_roundness',
                'brush_projection', 'apply_per_tip', 'foreground_background_jitter_and_control', 'hue_jitter', 'saturation_jitter', 'brightness_jitter',
                'purity', 'opacity_jitter_and_control', 'flow_jitter_and_control', 'invert', 'scale', 'depth', 'minimum_depth', 'depth_jitter_and_control',
                'scatter', 'count', 'spacing', 'pen_pressure_pen_tilt_stylus_wheel'].map((f) => `photoshop.painting.brush_settings_option.${f}`),
            ...['size', 'flip_x', 'flip_y', 'angle', 'roundness', 'hardness', 'spacing', 'tilt_x', 'tilt_y', 'rotation', 'pressure', 'both_axes',
                'count_jitter', 'clear_brush_controls'].map((f) => `photoshop.painting.brush_tip_option.${f}`),
        ],
        handler: (a) => {
            const tool = a.tool !== undefined ? ACTIVE_TOOLS[enumOf(a.tool, Object.keys(ACTIVE_TOOLS), { name: 'tool' })] : null;
            const clear = a.clearControls !== undefined && flag(a.clearControls, 'clearControls');
            const edits = brushEdits(a);
            if (!clear && !edits.length) throw new Error(`Give clearControls or a setting: ${Object.keys(BRUSH_SETTINGS_PROPS).join(', ')}`);
            return run('Brush settings', script(`${TOOL_OPTIONS_HELPERS}
${tool ? `app.currentTool = ${str(tool)};` : ''}
${clear ? 'app.executeAction(app.stringIDToTypeID("clearBrushControls"), new ActionDescriptor(), DialogModes.NO);' : ''}
var __settings = ${edits.length ? applyEdits(edits) : '{}'};
__result__ = { tool: app.currentTool, cleared: ${bool(clear)}, settings: __settings };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_clone_source_options',
        description: 'Use the Clone Source panel (Window > Clone Source) and its menu: choose which of the five clone sources the Clone Stamp and Healing Brush use, reset the active source\'s scale and rotation (Reset Transform), and toggle the overlay options Show Overlay, Auto Hide, Clip to Brush Tip and Invert. The overlay toggles flip the current state, which Photoshop does not report to scripts. Set a source\'s sample point with stroke_path cloneSource; show the panel with show_photoshop_panels',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'integer', minimum: 1, maximum: 5, description: 'Clone source to make active, 1-5' },
                resetTransform: { type: 'boolean', description: 'Reset the active source\'s offset scale and rotation (Reset Transform)' },
                toggle: { type: 'array', items: { type: 'string', enum: Object.keys(CLONE_OVERLAY) }, minItems: 1, description: 'Overlay options to toggle, in order' },
            },
        },
        auditArgs: { source: 2, toggle: ['show_overlay', 'invert'] },
        features: [
            'photoshop.retouching.clone_source_panel', 'photoshop.retouching.clone_source_panel_option.multiple_sources',
            'photoshop.retouching.clone_source_panel_option.reset_transform', 'photoshop.retouching.clone_source_panel_option.show_overlay',
            'photoshop.retouching.clone_source_panel_option.auto_hide', 'photoshop.retouching.clone_source_panel_option.clipped',
            'photoshop.retouching.clone_source_panel_option.invert',
        ],
        handler: (a) => {
            const lines = [];
            const menu = (id) => `app.runMenuItem(app.stringIDToTypeID(${str(id)}));`;
            let source = null;
            if (a.source !== undefined) {
                source = Number(a.source);
                if (!Number.isInteger(source) || source < 1 || source > 5) throw new Error("'source' must be 1, 2, 3, 4 or 5");
                lines.push(menu(`cloneSourceSource${source}`));
            }
            if (a.resetTransform !== undefined && flag(a.resetTransform, 'resetTransform')) lines.push(menu('cloneSourceResetTransform'));
            let toggled = [];
            if (a.toggle !== undefined) {
                if (!Array.isArray(a.toggle) || !a.toggle.length) throw new Error("'toggle' must be a list of overlay options");
                toggled = a.toggle.map((t, i) => enumOf(t, Object.keys(CLONE_OVERLAY), { name: `toggle[${i}]` }));
                for (const t of toggled) lines.push(menu(CLONE_OVERLAY[t]));
            }
            if (!lines.length) throw new Error('Give source, resetTransform or toggle');
            return run('Clone source', script(`${lines.join('\n')}
__result__ = { source: ${source ?? 'null'}, resetTransform: ${bool(a.resetTransform)}, toggled: ${json(toggled)} };`, { needsDocument: false }));
        },
    },
];
