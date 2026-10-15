/**
 * Colour: swatches (process, spot, Lab, RGB and CMYK colours, tints, mixed
 * inks and mixed ink groups; duplicate, delete, merge, unused swatches,
 * unnamed colours, colour groups, loading and saving swatches), the Ink
 * Manager, gradient swatches, applying fills and strokes (colours, gradients
 * and None, swap, defaults, gradient angle and length, colourising grayscale
 * images), copying fill and stroke with the eyedropper, the fill/stroke proxy
 * and the Swatches and Color panel display, colour settings, document
 * profiles, proofing and image colour settings.
 *
 * Swatches are chosen by name. Gradient lengths and start points are
 * millimetres (start points from the top-left of the item's page); angles are
 * degrees; tints and ink percentages are percentages.
 */
import { str, num, bool, json, enumOf } from 'adobe-mcp-core';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';

/** Script helpers shared by the colour tools. */
const HELPERS = String.raw`
var __findSwatch = function (doc, name) {
  var cols = [doc.tints, doc.mixedInks, doc.mixedInkGroups, doc.gradients, doc.colors];
  for (var i = 0; i < cols.length; i++) {
    var s = cols[i].itemByName(name);
    if (s.isValid) return s.getElements()[0];
  }
  var any = doc.swatches.itemByName(name);
  if (any.isValid) return any.getElements()[0];
  throw new Error("No swatch named " + name);
};

var __valueName = function (space, v) {
  var r = [];
  for (var i = 0; i < v.length; i++) r.push(Math.round(v[i]));
  if (space == ColorSpace.CMYK) return "C=" + r[0] + " M=" + r[1] + " Y=" + r[2] + " K=" + r[3];
  if (space == ColorSpace.RGB) return "R=" + r[0] + " G=" + r[1] + " B=" + r[2];
  if (space == ColorSpace.LAB) return "L=" + r[0] + " a=" + r[1] + " b=" + r[2];
  throw new Error("Only RGB, CMYK and Lab colours can be named with their values");
};

var __inkNames = function (list) {
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].name);
  return out;
};

var __ink = function (doc, name) {
  var ink = doc.inks.itemByName(name);
  if (!ink.isValid) throw new Error("No ink named " + name + " (inks are listed by set_inks)");
  return ink.getElements()[0];
};

var __swatchInfo = function (s) {
  var t = s.constructor.name, o = { name: s.name, type: t };
  try { o.group = s.parentColorGroup.isValid ? s.parentColorGroup.name : null; } catch (e) {}
  if (t === "Color" || t === "Tint") {
    try { o.model = __enumName(s.model); o.space = __enumName(s.space); o.values = s.colorValue; } catch (e) {}
  }
  if (t === "Tint") {
    try { o.baseColor = s.baseColor.name; o.tint = s.tintValue; } catch (e) {}
  }
  if (t === "MixedInk") {
    try { o.model = __enumName(s.model); o.inks = __inkNames(s.inkList); o.percentages = s.inkPercentages; } catch (e) {}
    try { o.mixedInkGroup = s.baseColor.isValid ? s.baseColor.name : null; } catch (e) {}
  }
  if (t === "MixedInkGroup") {
    try { o.model = __enumName(s.model); o.inks = __inkNames(s.inkList); } catch (e) {}
  }
  if (t === "Gradient") {
    o.gradientType = __enumName(s.type);
    o.stops = [];
    var gs = s.gradientStops;
    for (var i = 0; i < gs.length; i++) {
      var st = gs.item(i), c = null;
      try { c = st.stopColor.name; } catch (e) {}
      o.stops.push({ color: c, location: st.location, midpoint: st.midpoint });
    }
  }
  return o;
};
`;

/** Wrap a body that uses the colour helpers. */
const colorScript = (body, opts) => script(HELPERS + body, opts);

/** Value ranges of each colour space. */
const SPACES = {
    rgb: { enum: 'RGB', ranges: [[0, 255], [0, 255], [0, 255]], label: 'R, G, B (0-255)' },
    cmyk: { enum: 'CMYK', ranges: [[0, 100], [0, 100], [0, 100], [0, 100]], label: 'C, M, Y, K (0-100)' },
    lab: { enum: 'LAB', ranges: [[0, 100], [-128, 127], [-128, 127]], label: 'L (0-100), a and b (-128 to 127)' },
};

const POLICIES = ['COLOR_POLICY_OFF', 'PRESERVE_EMBEDDED_PROFILES', 'CONVERT_TO_WORKING_SPACE', 'COMBINATION_OF_PRESERVE_AND_SAFE_CMYK'];
const DEFAULT_INTENTS = ['PERCEPTUAL', 'SATURATION', 'RELATIVE_COLORIMETRIC', 'ABSOLUTE_COLORIMETRIC'];
const INTENTS = ['USE_COLOR_SETTINGS', ...DEFAULT_INTENTS];
const RESERVED = ['None', 'Paper', 'Black', 'Registration'];

/** Refuse keys that are not options of `where`. */
function known(o, allowed, where) {
    for (const k of Object.keys(o)) {
        if (o[k] !== undefined && !allowed.includes(k)) throw new Error(`Unknown option '${where ? `${where}.` : ''}${k}'. Allowed: ${allowed.join(', ')}`);
    }
}

/** Require a plain object. */
function object(v, name) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`'${name}' must be an object`);
    return v;
}

/** A required non-empty name of at most 200 characters. */
function name(v, what) {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`'${what}' must be a non-empty name`);
    if (v.length > 200) throw new Error(`'${what}' is too long`);
    return v;
}

/** A non-empty list of names. */
function names(v, what, { min = 1, max = 500 } = {}) {
    if (!Array.isArray(v) || v.length < min) throw new Error(`'${what}' must be a list of at least ${min} name${min > 1 ? 's' : ''}`);
    if (v.length > max) throw new Error(`'${what}' has more than ${max} names`);
    return v.map((x, i) => name(x, `${what}[${i}]`));
}

function flag(v, what) {
    if (typeof v !== 'boolean') throw new Error(`'${what}' must be true or false`);
    return bool(v);
}

/** Colour values checked against the space's ranges, as a JSX array. */
function colorValues(space, values, what = 'values') {
    const s = SPACES[space];
    if (!Array.isArray(values) || values.length !== s.ranges.length) throw new Error(`'${what}' for ${space} needs ${s.ranges.length} numbers: ${s.label}`);
    return `[${values.map((v, i) => num(v, { min: s.ranges[i][0], max: s.ranges[i][1], name: `${what}[${i}]` })).join(', ')}]`;
}

/** A page-relative [x, y] point in millimetres. */
function point(v, what) {
    if (!Array.isArray(v) || v.length !== 2) throw new Error(`'${what}' must be [x, y]`);
    return v.map((n, i) => num(n, { min: -10000, max: 10000, name: `${what}[${i}]` }));
}

/** A validated file path for the script, with an allowed extension. */
function filePath(v, what, exts) {
    if (typeof v !== 'string' || !v) throw new Error(`'${what}' must be a file path`);
    const ext = v.toLowerCase().slice(v.lastIndexOf('.'));
    if (!exts.includes(ext)) throw new Error(`'${what}' must end in ${exts.join(', ')}`);
    return jsxPath(validateFilePath(v));
}

const VALUES_SCHEMA = { type: 'array', items: { type: 'number' }, description: 'Colour values in the chosen space: RGB 0-255 each; CMYK 0-100 each; Lab L 0-100, a and b -128 to 127' };

const CREATE_KINDS = ['color', 'tint', 'mixed_ink', 'mixed_ink_group'];

/** Fill and stroke options of set_fill_stroke. */
const PAINT_KEYS = ['color', 'tint', 'gradientAngle', 'gradientLength', 'gradientStart', 'reverseGradient', 'overprint'];
const paintSchema = (what) => ({
    type: 'object',
    description: `${what} options`,
    properties: {
        color: { type: 'string', description: `${COLOR_SCHEMA.description}; a gradient swatch name applies the gradient; "None" removes the ${what.toLowerCase()} (Apply Color, Apply Gradient, Apply None)` },
        tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint (%)' },
        gradientAngle: { type: 'number', minimum: -180, maximum: 180, description: 'Angle of the applied gradient (degrees, Gradient panel > Angle)' },
        gradientLength: { type: 'number', minimum: 0, maximum: 10000, description: 'Length of a linear gradient, or radius of a radial one (mm), as dragged with the Gradient Swatch tool' },
        gradientStart: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Start point (linear) or centre (radial) of the gradient as [x, y] in mm from the top-left of the item\'s page, as dragged with the Gradient Swatch tool' },
        reverseGradient: { type: 'boolean', description: 'Reverse the applied gradient (Gradient panel > Reverse), by turning its angle 180°' },
        overprint: { type: 'boolean', description: `Overprint the ${what.toLowerCase()} (Attributes panel)` },
    },
});

/** Statements that apply one fill or stroke option object to `o` (the item, its text or its graphic). */
function paintStatements(side, opts, colors) {
    const P = side === 'fill'
        ? { color: 'fillColor', tint: 'fillTint', angle: 'gradientFillAngle', length: 'gradientFillLength', start: 'gradientFillStart', overprint: 'overprintFill' }
        : { color: 'strokeColor', tint: 'strokeTint', angle: 'gradientStrokeAngle', length: 'gradientStrokeLength', start: 'gradientStrokeStart', overprint: 'overprintStroke' };
    object(opts, side);
    known(opts, PAINT_KEYS, side);
    if (!Object.keys(opts).length) throw new Error(`'${side}' is empty: give at least one of ${PAINT_KEYS.join(', ')}`);
    if (opts.reverseGradient !== undefined && opts.gradientAngle !== undefined) throw new Error(`'${side}': give gradientAngle or reverseGradient, not both`);
    const out = [];
    if (opts.color !== undefined) {
        const v = `__c${colors.length}`;
        colors.push(`var ${v} = __swatch(doc, ${colorSpec(opts.color, `${side}.color`)});`);
        out.push(`o.${P.color} = ${v};`);
    }
    if (opts.tint !== undefined) out.push(`o.${P.tint} = ${num(opts.tint, { min: 0, max: 100, name: `${side}.tint` })};`);
    if (opts.gradientAngle !== undefined) out.push(`o.${P.angle} = ${num(opts.gradientAngle, { min: -180, max: 180, name: `${side}.gradientAngle` })};`);
    if (opts.gradientLength !== undefined) out.push(`o.${P.length} = ${num(opts.gradientLength, { min: 0, max: 10000, name: `${side}.gradientLength` })};`);
    if (opts.gradientStart !== undefined) {
        const [x, y] = point(opts.gradientStart, `${side}.gradientStart`);
        out.push(`o.${P.start} = pg ? __toPage(pg, ${x}, ${y}) : [${x}, ${y}];`);
    }
    if (opts.reverseGradient !== undefined && flag(opts.reverseGradient, `${side}.reverseGradient`) === 'true') {
        out.push(`var __a = o.${P.angle} + 180; if (__a > 180) __a -= 360; o.${P.angle} = __a;`);
    }
    if (opts.overprint !== undefined) out.push(`o.${P.overprint} = ${flag(opts.overprint, `${side}.overprint`)};`);
    return out;
}

/** Script: resolve what a fill/stroke change acts on: the item, its text, or its placed graphic. */
const PAINT_TARGET = String.raw`
var __TEXT_TYPES = { Text: 1, Character: 1, Word: 1, Line: 1, Paragraph: 1, TextColumn: 1, TextStyleRange: 1, InsertionPoint: 1, Story: 1 };
var __paintTarget = function (it, mode) {
  var t = it.constructor.name;
  if (mode === "text") {
    if (__TEXT_TYPES[t]) return it;
    if (t === "TextFrame") return it.texts[0];
    throw new Error("Item " + it.id + " (" + t + ") is not a text frame or text");
  }
  if (mode === "content") {
    if (t === "Image" || t === "PDF" || t === "EPS" || t === "WMF" || t === "PICT" || t === "ImportedPage") return it;
    if (it.allGraphics.length) return it.allGraphics[0];
    throw new Error("Item " + it.id + " (" + t + ") has no placed graphic");
  }
  return it;
};
var __paintInfo = function (o) {
  var r = {};
  try { r.fill = o.fillColor.name; r.fillTint = o.fillTint; } catch (e) {}
  try { r.stroke = o.strokeColor.name; r.strokeTint = o.strokeTint; } catch (e) {}
  return r;
};
`;

/** Swatches panel and Color panel menu commands (no dialogs). */
const SWATCH_VIEWS = { name: [16396, 'Swatches panel > Name'], small_name: [16402, 'Swatches panel > Small Name'], small_swatch: [16399, 'Swatches panel > Small Swatch'], large_swatch: [16397, 'Swatches panel > Large Swatch'] };
const COLOR_MODES = { lab: [29188, 'Color panel > Lab'], cmyk: [29189, 'Color panel > CMYK'], rgb: [29190, 'Color panel > RGB'] };

/** Application colour settings: option -> [ColorSetting property, kind, extra]. */
const APP_SETTINGS = {
    enableColorManagement: ['enableColorManagement', 'bool', 'Enable Color Management'],
    rgbWorkingSpace: ['workingSpaceRGB', 'list', 'Working Spaces > RGB: a profile name from get_color_settings (lists.rgbWorkingSpaces)', 'workingSpaceRGBList'],
    cmykWorkingSpace: ['workingSpaceCMYK', 'list', 'Working Spaces > CMYK: a profile name from get_color_settings (lists.cmykWorkingSpaces)', 'workingSpaceCMYKList'],
    rgbPolicy: ['rgbPolicy', 'policy', 'Color Management Policies > RGB'],
    cmykPolicy: ['cmykPolicy', 'policy', 'Color Management Policies > CMYK'],
    profileMismatchAskWhenOpening: ['mismatchAskWhenOpening', 'bool', 'Profile Mismatches: Ask When Opening'],
    profileMismatchAskWhenPasting: ['mismatchAskWhenPasting', 'bool', 'Profile Mismatches: Ask When Pasting'],
    missingProfileAskWhenOpening: ['missingAskWhenOpening', 'bool', 'Missing Profiles: Ask When Opening'],
    engine: ['engine', 'list', 'Conversion Options > Engine: a name from get_color_settings (lists.engines)', 'engineList'],
    intent: ['intent', 'intent', 'Conversion Options > Intent'],
    blackPointCompensation: ['useBPC', 'bool', 'Use Black Point Compensation'],
    accurateLabSpots: ['accurateLABSpots', 'bool', 'Use Lab values to display and convert spot colours (Accurate LAB Spots)'],
    richBlackOnScreen: ['idealizedBlackToScreen', 'bool', 'Appearance of Black > On Screen: true = Display All Blacks as Rich Black, false = Display All Blacks Accurately'],
    richBlackOnExport: ['idealizedBlackToExport', 'bool', 'Appearance of Black > Printing/Exporting: true = Output All Blacks as Rich Black, false = Output All Blacks Accurately'],
};

/** Proofing types of View > Proof Setup. */
const PROOFING = { off: 'PROOF_OFF', document_cmyk: 'DOCUMENT_CMYK', working_cmyk: 'WORKING_CMYK', custom: 'CUSTOM' };

/** Script: the layout window proofing applies to. */
const LAYOUT_WINDOW = String.raw`
var w = null;
try { if (app.activeWindow.constructor.name === "LayoutWindow") w = app.activeWindow; } catch (e) {}
if (!w) {
  if (!doc.layoutWindows.length) throw new Error("The document has no layout window open");
  w = doc.layoutWindows[0];
}
`;

export const tools = [
    {
        name: 'create_swatch',
        description: 'Create a swatch (Swatches panel menu > New Color Swatch, New Tint Swatch, New Mixed Ink Swatch, New Mixed Ink Group): a process or spot colour from RGB, CMYK or Lab values, a tint of a colour, a mixed ink from ink percentages, or a mixed ink group stepping ink percentages; optionally named with its colour values and placed in a colour group',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: CREATE_KINDS, description: 'What to create: a colour, a tint, a mixed ink or a mixed ink group' },
                name: { type: 'string', description: 'Swatch name (colours, unless nameWithColorValue; required for mixed inks and groups; tints are named after their base colour)' },
                nameWithColorValue: { type: 'boolean', description: 'Name the colour from its values, e.g. "C=0 M=100 Y=0 K=0" (Swatch Options > Name with Color Value)' },
                model: { type: 'string', enum: ['process', 'spot'], description: 'Color Type of a colour: process (printed from CMYK) or spot (its own ink plate). Default process' },
                space: { type: 'string', enum: Object.keys(SPACES), description: 'Color Mode of a colour: rgb, cmyk or lab' },
                values: VALUES_SCHEMA,
                baseColor: { type: 'string', description: 'Tint: the colour swatch the tint is made from' },
                tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint: percentage of the base colour' },
                inks: {
                    type: 'array',
                    description: 'Mixed ink or mixed ink group: the inks (at least one spot ink); names as set_inks lists them, e.g. "Process Cyan" or a spot colour name',
                    items: {
                        type: 'object',
                        properties: {
                            ink: { type: 'string', description: 'Ink name' },
                            percent: { type: 'number', minimum: 0, maximum: 100, description: 'Percentage of the ink (mixed ink), or its initial percentage (mixed ink group)' },
                            repeat: { type: 'integer', minimum: 0, maximum: 100, description: 'Mixed ink group: how many more steps to generate for this ink' },
                            increment: { type: 'number', minimum: 0, maximum: 100, description: 'Mixed ink group: percentage added at each step' },
                        },
                        required: ['ink', 'percent'],
                    },
                },
                group: { type: 'string', description: 'Put the new swatch in this colour group (created if it does not exist)' },
            },
            required: ['kind'],
        },
        features: [
            'indesign.color.new_tint_swatch',
            'indesign.color.new_mixed_ink_swatch',
            'indesign.color.new_mixed_ink_group',
            'indesign.color.mixed_ink',
            'indesign.color.swatch_name_with_color_value',
            'indesign.color.process_vs_spot',
            'indesign.color.color_picker',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { kind: 'color', name: 'Brand Red', nameWithColorValue: undefined, model: 'spot', space: 'cmyk', values: [0, 90, 85, 0], group: 'Brand', baseColor: undefined, tint: undefined, inks: undefined },
        handler: (a) => {
            const kind = enumOf(a.kind, CREATE_KINDS, { name: 'kind' });
            const allowed = {
                color: ['kind', 'name', 'nameWithColorValue', 'model', 'space', 'values', 'group'],
                tint: ['kind', 'baseColor', 'tint', 'group'],
                mixed_ink: ['kind', 'name', 'inks', 'group'],
                mixed_ink_group: ['kind', 'name', 'inks', 'group'],
            }[kind];
            for (const k of Object.keys(a)) if (a[k] !== undefined && !allowed.includes(k)) throw new Error(`'${k}' does not apply to kind: ${kind}. Options: ${allowed.join(', ')}`);
            const lines = [];
            if (kind === 'color') {
                const space = enumOf(a.space, Object.keys(SPACES), { name: 'space' });
                const values = colorValues(space, a.values);
                const model = a.model === undefined ? 'process' : enumOf(a.model, ['process', 'spot'], { name: 'model' });
                const byValue = a.nameWithColorValue !== undefined && flag(a.nameWithColorValue, 'nameWithColorValue') === 'true';
                if (byValue && a.name !== undefined) throw new Error("Give 'name' or nameWithColorValue: true, not both");
                if (!byValue) name(a.name, 'name');
                lines.push(
                    `var nm = ${byValue ? `__valueName(ColorSpace.${SPACES[space].enum}, ${values})` : str(a.name)};`,
                    'if (doc.swatches.itemByName(nm).isValid) throw new Error("A swatch named " + nm + " already exists");',
                    `var s = doc.colors.add({ name: nm, model: ColorModel.${model.toUpperCase()}, space: ColorSpace.${SPACES[space].enum}, colorValue: ${values} });`,
                );
            } else if (kind === 'tint') {
                const base = name(a.baseColor, 'baseColor');
                if (a.tint === undefined) throw new Error("A tint needs 'tint' (percentage of the base colour)");
                const t = num(a.tint, { min: 0, max: 100, name: 'tint' });
                lines.push(
                    `var base = __findSwatch(doc, ${str(base)});`,
                    'if (base.constructor.name === "Tint") base = base.baseColor;',
                    'if (base.constructor.name !== "Color") throw new Error("A tint is made from a colour swatch; " + base.name + " is a " + base.constructor.name);',
                    `var s = doc.tints.add(base, { tintValue: ${t} });`,
                );
            } else {
                const nm = name(a.name, 'name');
                const group = kind === 'mixed_ink_group';
                if (!Array.isArray(a.inks) || a.inks.length < 2 || a.inks.length > 50) throw new Error("'inks' needs 2 to 50 inks");
                const specs = a.inks.map((ink, i) => {
                    const w = `inks[${i}]`;
                    object(ink, w);
                    known(ink, group ? ['ink', 'percent', 'repeat', 'increment'] : ['ink', 'percent'], w);
                    const n = name(ink.ink, `${w}.ink`);
                    if (ink.percent === undefined) throw new Error(`'${w}.percent' is required`);
                    const p = Number(num(ink.percent, { min: 0, max: 100, name: `${w}.percent` }));
                    const r = group ? Number(num(ink.repeat ?? 0, { min: 0, max: 100, name: `${w}.repeat` })) : 0;
                    if (!Number.isInteger(r)) throw new Error(`'${w}.repeat' must be a whole number`);
                    const inc = group ? Number(num(ink.increment ?? 0, { min: 0, max: 100, name: `${w}.increment` })) : 0;
                    if (group && p + r * inc > 100) throw new Error(`'${w}': percent + repeat × increment exceeds 100`);
                    return { n, p, r, inc };
                });
                lines.push(
                    `var nm = ${str(nm)};`,
                    'if (doc.swatches.itemByName(nm).isValid) throw new Error("A swatch named " + nm + " already exists");',
                    `var names = ${json(specs.map((s) => s.n))}, inks = [];`,
                    'for (var i = 0; i < names.length; i++) inks.push(__ink(doc, names[i]));',
                    group
                        ? `var s = doc.mixedInkGroups.add(inks, ${json(specs.map((s) => s.p))}, ${json(specs.map((s) => s.r))}, ${json(specs.map((s) => s.inc))}, { name: nm });`
                        : `var s = doc.mixedInks.add(inks, ${json(specs.map((s) => s.p))}, { name: nm });`,
                );
            }
            if (a.group !== undefined) {
                const g = name(a.group, 'group');
                lines.push(
                    `var g = doc.colorGroups.itemByName(${str(g)});`,
                    `if (g.isValid) g.colorGroupSwatches.add(s); else doc.colorGroups.add(${str(g)}, [s]);`,
                );
            }
            lines.push('__result__ = __swatchInfo(s);');
            return run('Create swatch', colorScript(lines.join('\n')));
        },
    },
    {
        name: 'edit_swatch',
        description: 'Change a swatch\'s options (Swatch Options, from the Swatches panel menu or a swatch\'s context menu): rename it or name it with its colour values, switch a colour between process and spot, convert it to RGB, CMYK or Lab (Color panel menu), set its values, change a tint\'s percentage, change a mixed ink\'s ink percentages, or convert a mixed ink or mixed ink group to process',
        inputSchema: {
            type: 'object',
            properties: {
                swatch: { type: 'string', description: 'The swatch to change, by name' },
                name: { type: 'string', description: 'New name' },
                nameWithColorValue: { type: 'boolean', description: 'Rename the colour from its (final) values, e.g. "R=255 G=0 B=0" (Name with Color Value)' },
                model: { type: 'string', enum: ['process', 'spot'], description: 'Color Type: process or spot (colours); process converts a mixed ink or mixed ink group to process colours' },
                space: { type: 'string', enum: Object.keys(SPACES), description: 'Color Mode: convert the colour to rgb, cmyk or lab; with values, the space the values are in' },
                values: { ...VALUES_SCHEMA, description: `${VALUES_SCHEMA.description}. Needs space` },
                tint: { type: 'number', minimum: 0, maximum: 100, description: 'Tint swatches: percentage of the base colour' },
                inks: {
                    type: 'array',
                    description: 'Mixed ink swatches: new percentages for some of its inks',
                    items: {
                        type: 'object',
                        properties: {
                            ink: { type: 'string', description: 'Ink name, one of the mixed ink\'s inks' },
                            percent: { type: 'number', minimum: 0, maximum: 100, description: 'Percentage of the ink' },
                        },
                        required: ['ink', 'percent'],
                    },
                },
            },
            required: ['swatch'],
        },
        features: [
            'indesign.color.swatches_menu_swatch_options',
            'indesign.color.context_swatch_options_context',
            'indesign.color.swatch_name_with_color_value',
            'indesign.color.process_vs_spot',
            'indesign.color.color_panel',
            'indesign.color.color_menu_lab',
            'indesign.color.color_menu_cmyk',
            'indesign.color.color_menu_rgb',
            'indesign.color.edit_convert_mixed_ink',
            'indesign.color.mixed_ink',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { swatch: 'Brand Red', name: undefined, model: 'process', space: 'lab', values: [50, 60, 40], nameWithColorValue: true, tint: 40, inks: [{ ink: 'Process Cyan', percent: 30 }] },
        handler: (a) => {
            known(a, ['swatch', 'name', 'nameWithColorValue', 'model', 'space', 'values', 'tint', 'inks'], '');
            const sw = name(a.swatch, 'swatch');
            const lines = [`var s = __findSwatch(doc, ${str(sw)}), t = s.constructor.name;`];
            const need = (types, what) => lines.push(`if (${types.map((x) => `t !== "${x}"`).join(' && ')}) throw new Error(${str(`${what} applies to `)} + ${str(types.join(' or '))} + " swatches; " + s.name + " is a " + t);`);
            if (a.model !== undefined) {
                const m = enumOf(a.model, ['process', 'spot'], { name: 'model' });
                if (m === 'spot') need(['Color'], 'model: spot');
                else need(['Color', 'MixedInk', 'MixedInkGroup'], 'model');
                lines.push(`s.model = ColorModel.${m.toUpperCase()};`);
            }
            if (a.values !== undefined && a.space === undefined) throw new Error("'values' needs 'space' (the space the values are in)");
            if (a.space !== undefined) {
                const space = enumOf(a.space, Object.keys(SPACES), { name: 'space' });
                need(['Color'], 'space');
                lines.push(`s.space = ColorSpace.${SPACES[space].enum};`);
                if (a.values !== undefined) lines.push(`s.colorValue = ${colorValues(space, a.values)};`);
            }
            if (a.tint !== undefined) {
                need(['Tint'], 'tint');
                lines.push(`s.tintValue = ${num(a.tint, { min: 0, max: 100, name: 'tint' })};`);
            }
            if (a.inks !== undefined) {
                if (!Array.isArray(a.inks) || !a.inks.length) throw new Error("'inks' must be a non-empty list");
                const specs = a.inks.map((ink, i) => {
                    object(ink, `inks[${i}]`);
                    known(ink, ['ink', 'percent'], `inks[${i}]`);
                    if (ink.percent === undefined) throw new Error(`'inks[${i}].percent' is required`);
                    return { ink: name(ink.ink, `inks[${i}].ink`), percent: Number(num(ink.percent, { min: 0, max: 100, name: `inks[${i}].percent` })) };
                });
                need(['MixedInk'], 'inks');
                lines.push(
                    `var want = ${json(specs)}, list = s.inkList, p = s.inkPercentages;`,
                    'for (var i = 0; i < want.length; i++) {',
                    '  var at = -1;',
                    '  for (var j = 0; j < list.length; j++) if (list[j].name === want[i].ink) at = j;',
                    '  if (at < 0) throw new Error(s.name + " has no ink " + want[i].ink + "; its inks are " + __inkNames(list).join(", "));',
                    '  p[at] = want[i].percent;',
                    '}',
                    's.inkPercentages = p;',
                );
            }
            const byValue = a.nameWithColorValue !== undefined && flag(a.nameWithColorValue, 'nameWithColorValue') === 'true';
            if (byValue && a.name !== undefined) throw new Error("Give 'name' or nameWithColorValue: true, not both");
            if (a.name !== undefined) lines.push(`s.name = ${str(name(a.name, 'name'))};`);
            if (byValue) {
                need(['Color'], 'nameWithColorValue');
                lines.push('var vn = __valueName(s.space, s.colorValue);', 'if (vn !== s.name) s.name = vn;');
            }
            if (lines.length === 1) throw new Error('Nothing to change: give name, nameWithColorValue, model, space, values, tint or inks');
            lines.push('__result__ = __swatchInfo(s);');
            return run('Edit swatch', colorScript(lines.join('\n')));
        },
    },
    {
        name: 'manage_swatches',
        description: 'Swatches panel menu commands: duplicate, delete (replacing with another swatch), merge swatches into the first, list or delete unused swatches (Select All Unused), add unnamed colours to the swatches, add the colours of items to the swatches (Color panel > Add to Swatches), make or add to a colour group (New Color Group), or ungroup a colour group',
        inputSchema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['duplicate', 'delete', 'merge', 'list_unused', 'delete_unused', 'add_unnamed_colors', 'add_to_swatches', 'group', 'ungroup'],
                    description: 'What to do',
                },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Swatch names: duplicate, delete, group, or merge (the first keeps its name and the others merge into it)' },
                newName: { type: 'string', description: 'duplicate: name for the copy (one swatch only)' },
                replaceWith: { type: 'string', description: 'delete, delete_unused: swatch that replaces the deleted ones where used (default: InDesign leaves the colour applied unnamed)' },
                group: { type: 'string', description: 'group, ungroup: the colour group name' },
                target: { ...TARGET_SCHEMA, description: `add_to_swatches: ${TARGET_SCHEMA.description}` },
                on: { type: 'string', enum: ['fill', 'stroke', 'both'], description: 'add_to_swatches: which colour of each item (default both)' },
            },
            required: ['operation'],
        },
        features: [
            'indesign.color.swatches_menu_duplicate_swatch',
            'indesign.color.swatches_menu_merge_swatches',
            'indesign.color.swatches_menu_add_unnamed_colors',
            'indesign.color.color_menu_add_to_swatches',
            'indesign.color.swatches_menu_new_color_group',
            'indesign.color.swatches_menu_ungroup_color_group',
            'indesign.color.color_group',
        ],
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { operation: 'merge', swatches: ['Brand Red', 'Red 2'], newName: undefined, replaceWith: undefined, group: undefined, target: undefined, on: undefined },
        handler: (a) => {
            const ops = ['duplicate', 'delete', 'merge', 'list_unused', 'delete_unused', 'add_unnamed_colors', 'add_to_swatches', 'group', 'ungroup'];
            const op = enumOf(a.operation, ops, { name: 'operation' });
            const allowed = {
                duplicate: ['swatches', 'newName'], delete: ['swatches', 'replaceWith'], merge: ['swatches'],
                list_unused: [], delete_unused: ['replaceWith'], add_unnamed_colors: [], add_to_swatches: ['target', 'on'],
                group: ['group', 'swatches'], ungroup: ['group'],
            }[op];
            for (const k of Object.keys(a)) if (a[k] !== undefined && k !== 'operation' && !allowed.includes(k)) throw new Error(`'${k}' does not apply to ${op}${allowed.length ? `. Options: ${allowed.join(', ')}` : ''}`);
            const rep = a.replaceWith === undefined ? 'null' : `__findSwatch(doc, ${str(name(a.replaceWith, 'replaceWith'))})`;
            let body;
            if (op === 'duplicate') {
                const list = names(a.swatches, 'swatches');
                if (a.newName !== undefined && list.length > 1) throw new Error("'newName' applies when duplicating one swatch");
                body = [
                    `var list = ${json(list)}, out = [];`,
                    'for (var i = 0; i < list.length; i++) {',
                    '  var d = __findSwatch(doc, list[i]).duplicate();',
                    a.newName !== undefined ? `  d.name = ${str(name(a.newName, 'newName'))};` : '',
                    '  out.push(__swatchInfo(d));',
                    '}',
                    '__result__ = { duplicated: out };',
                ];
            } else if (op === 'delete') {
                const list = names(a.swatches, 'swatches');
                body = [
                    `var list = ${json(list)}, rep = ${rep};`,
                    'for (var i = 0; i < list.length; i++) {',
                    '  var s = __findSwatch(doc, list[i]);',
                    '  if (rep) s.remove(rep); else s.remove();',
                    '}',
                    '__result__ = { deleted: list, replacedWith: rep ? rep.name : null };',
                ];
            } else if (op === 'merge') {
                const list = names(a.swatches, 'swatches', { min: 2 });
                body = [
                    `var list = ${json(list)}, keep = __findSwatch(doc, list[0]), others = [];`,
                    'for (var i = 1; i < list.length; i++) others.push(__findSwatch(doc, list[i]));',
                    'keep.merge(others);',
                    '__result__ = { merged: list.slice(1), into: __swatchInfo(keep) };',
                ];
            } else if (op === 'list_unused' || op === 'delete_unused') {
                body = [
                    `var reserved = ${json(RESERVED)}, u = doc.unusedSwatches, out = [], failed = [], rep = ${rep};`,
                    'for (var i = 0; i < u.length; i++) {',
                    '  var n = u[i].name, skip = n === "";',
                    '  for (var j = 0; j < reserved.length; j++) if (n === reserved[j]) skip = true;',
                    '  if (skip) continue;',
                    op === 'delete_unused'
                        ? '  try { if (rep) u[i].remove(rep); else u[i].remove(); out.push(n); } catch (e) { failed.push({ name: n, error: e.message }); }'
                        : '  out.push(__swatchInfo(u[i]));',
                    '}',
                    op === 'delete_unused' ? '__result__ = { deleted: out, failed: failed };' : '__result__ = { unused: out };',
                ];
            } else if (op === 'add_unnamed_colors') {
                body = [
                    'var countUnnamed = function () { var c = doc.colors.everyItem().getElements(), n = 0; for (var i = 0; i < c.length; i++) if (c[i].name === "") n++; return n; };',
                    'var before = countUnnamed(), viaMenu = false;',
                    'var ma = app.menuActions.itemByID(16403);',
                    'if (before && ma.isValid && ma.enabled) { ma.invoke(); viaMenu = true; }',
                    'var cols = doc.colors.everyItem().getElements(), named = [], kept = 0;',
                    'for (var i = 0; i < cols.length; i++) {',
                    '  var c = cols[i];',
                    '  if (c.name !== "") continue;',
                    '  try {',
                    '    var vn = __valueName(c.space, c.colorValue);',
                    '    if (doc.swatches.itemByName(vn).isValid) { kept++; continue; }',
                    '    c.name = vn; named.push(vn);',
                    '  } catch (e) { kept++; }',
                    '}',
                    '__result__ = { unnamedBefore: before, addedByMenuCommand: viaMenu, named: named, stillUnnamed: countUnnamed() };',
                ];
            } else if (op === 'add_to_swatches') {
                const on = a.on === undefined ? 'both' : enumOf(a.on, ['fill', 'stroke', 'both'], { name: 'on' });
                const sides = on === 'both' ? ['fill', 'stroke'] : [on];
                body = [
                    `var items = __targets(doc, ${targetSpec(a.target)}), out = [];`,
                    'var toSwatch = function (c) {',
                    '  if (!c || c.constructor.name !== "Color" || c.name !== "") return null;',
                    '  var vn = __valueName(c.space, c.colorValue), sw = doc.colors.itemByName(vn);',
                    '  if (!sw.isValid) sw = doc.colors.add({ name: vn, model: c.model, space: c.space, colorValue: c.colorValue });',
                    '  return sw;',
                    '};',
                    'for (var i = 0; i < items.length; i++) {',
                    '  var it = items[i], r = { id: it.id }, sw;',
                    ...sides.map((s) => `  sw = toSwatch(it.${s}Color); if (sw) { it.${s}Color = sw; r.${s} = sw.name; } else { try { r.${s} = it.${s}Color.name; } catch (e) {} }`),
                    '  out.push(r);',
                    '}',
                    '__result__ = { items: out };',
                ];
            } else if (op === 'group') {
                const g = name(a.group, 'group');
                const list = a.swatches === undefined ? [] : names(a.swatches, 'swatches');
                body = [
                    `var gn = ${str(g)}, list = ${json(list)}, sw = [];`,
                    'for (var i = 0; i < list.length; i++) sw.push(__findSwatch(doc, list[i]));',
                    'var g = doc.colorGroups.itemByName(gn), created = !g.isValid;',
                    'if (created) g = doc.colorGroups.add(gn, sw);',
                    'else for (var j = 0; j < sw.length; j++) g.colorGroupSwatches.add(sw[j]);',
                    'var members = [], cg = g.colorGroupSwatches.everyItem().getElements();',
                    'for (var k = 0; k < cg.length; k++) members.push(cg[k].swatchItemRef.name);',
                    '__result__ = { group: g.name, created: created, swatches: members };',
                ];
            } else {
                const g = name(a.group, 'group');
                body = [
                    `var g = doc.colorGroups.itemByName(${str(g)});`,
                    `if (!g.isValid) throw new Error(${str(`No colour group named ${g}`)});`,
                    'var members = [], cg = g.colorGroupSwatches.everyItem().getElements();',
                    'for (var k = 0; k < cg.length; k++) members.push(cg[k].swatchItemRef.name);',
                    'g.ungroup();',
                    `__result__ = { ungrouped: ${str(g)}, swatches: members };`,
                ];
            }
            return run('Manage swatches', colorScript(body.filter(Boolean).join('\n')));
        },
    },
    {
        name: 'load_swatches',
        description: 'Load swatches into the active document (Swatches panel menu > Load Swatches) from an InDesign document or template or an Adobe Swatch Exchange (.ase) file, and/or import named colours from Adobe colour books such as PANTONE as spot or process colours',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Path of an .indd, .indt or .ase file to load swatches from' },
                spotColors: { type: 'array', items: { type: 'string' }, description: 'Colour-book colour names to import as spot colours, e.g. "PANTONE 185 C"' },
                processColors: { type: 'array', items: { type: 'string' }, description: 'Colour-book colour names to import as process colours' },
            },
        },
        features: [
            'indesign.color.swatches_menu_load_swatches',
            'indesign.color.import_share_swatches',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { file: `${process.env.HOME ?? '/tmp'}/Documents/brand.ase`, spotColors: ['PANTONE 185 C'], processColors: ['PANTONE 300 C'] },
        handler: (a) => {
            known(a, ['file', 'spotColors', 'processColors'], '');
            const file = a.file === undefined ? null : filePath(a.file, 'file', ['.indd', '.indt', '.ase']);
            const spot = a.spotColors === undefined ? [] : names(a.spotColors, 'spotColors');
            const proc = a.processColors === undefined ? [] : names(a.processColors, 'processColors');
            if (!file && !spot.length && !proc.length) throw new Error('Give file, spotColors or processColors');
            const body = [
                'var had = {}, all = doc.swatches.everyItem().getElements();',
                'for (var i = 0; i < all.length; i++) had[all[i].name] = true;',
            ];
            if (file) body.push(`var f = File(${file});`, 'if (!f.exists) throw new Error("File not found: " + f.fsName);', 'doc.loadSwatches(f);');
            body.push(
                `var spot = ${json(spot)}, proc = ${json(proc)}, failed = [];`,
                'for (var s = 0; s < spot.length; s++) { try { doc.importAdobeSwatchbookSpotColor(spot[s]); } catch (e) { failed.push({ name: spot[s], error: e.message }); } }',
                'for (var p = 0; p < proc.length; p++) { try { doc.importAdobeSwatchbookProcessColor(proc[p]); } catch (e) { failed.push({ name: proc[p], error: e.message }); } }',
                'var added = [], now = doc.swatches.everyItem().getElements();',
                'for (var j = 0; j < now.length; j++) if (!had[now[j].name]) added.push(now[j].name);',
                '__result__ = { added: added, failed: failed };',
            );
            return run('Load swatches', colorScript(body.join('\n')));
        },
    },
    {
        name: 'save_swatches',
        description: 'Save swatches to an Adobe Swatch Exchange (.ase) file for other documents and applications (Swatches panel menu > Save Swatches); by default every named colour and tint',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Path of the .ase file to write (replaced if it exists)' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'Swatch names to save (default: every named colour and tint except [None], [Paper] and [Registration])' },
            },
            required: ['file'],
        },
        features: [
            'indesign.color.swatches_menu_save_swatches',
            'indesign.color.import_share_swatches',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { file: `${process.env.HOME ?? '/tmp'}/Documents/brand.ase`, swatches: ['Brand Red', 'Brand Blue'] },
        handler: (a) => {
            known(a, ['file', 'swatches'], '');
            const file = filePath(a.file, 'file', ['.ase']);
            const list = a.swatches === undefined ? null : names(a.swatches, 'swatches');
            const body = [`var f = File(${file});`, 'if (!f.parent.exists) throw new Error("Folder not found: " + f.parent.fsName);', 'var sw = [];'];
            if (list) {
                body.push(`var list = ${json(list)};`, 'for (var i = 0; i < list.length; i++) sw.push(__findSwatch(doc, list[i]));');
            } else {
                body.push(
                    `var skip = { "None": 1, "Paper": 1, "Registration": 1, "": 1 };`,
                    'var pools = [doc.colors.everyItem().getElements(), doc.tints.everyItem().getElements()];',
                    'for (var p = 0; p < pools.length; p++) for (var k = 0; k < pools[p].length; k++) if (!skip[pools[p][k].name]) sw.push(pools[p][k]);',
                );
            }
            body.push(
                'if (!sw.length) throw new Error("No swatches to save");',
                'doc.saveSwatches(f, sw, "");',
                'var saved = [];',
                'for (var j = 0; j < sw.length; j++) saved.push(sw[j].name);',
                '__result__ = { file: f.fsName, saved: saved };',
            );
            return run('Save swatches', colorScript(body.join('\n')));
        },
    },
    {
        name: 'set_inks',
        description: 'Ink Manager (Swatches panel menu > Ink Manager): set each ink\'s type, neutral density, trapping sequence, alias and conversion to process, convert all spot inks to process, and use standard Lab values for spots; returns every ink with its settings and solidity. With no options, lists the inks',
        inputSchema: {
            type: 'object',
            properties: {
                inks: {
                    type: 'array',
                    description: 'Settings per ink',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Ink name, e.g. "Process Cyan" or a spot colour name' },
                            type: { type: 'string', enum: ['NORMAL', 'TRANSPARENT', 'OPAQUE', 'OPAQUE_IGNORE'], description: 'Ink type for trapping' },
                            neutralDensity: { type: 'number', minimum: 0.001, maximum: 10, description: 'Neutral density (0.001 to 10)' },
                            trapSequence: { type: 'integer', minimum: 1, maximum: 100, description: 'Place in the trapping sequence' },
                            alias: { type: 'string', description: 'Ink to print this ink as (Ink Alias); an empty string clears the alias' },
                            convertToProcess: { type: 'boolean', description: 'Print this spot ink as process colours' },
                        },
                        required: ['name'],
                    },
                },
                allSpotsToProcess: { type: 'boolean', description: 'All Spots to Process: true converts every spot ink to process, false keeps every spot ink as a spot (applied before per-ink settings)' },
                useStandardLabForSpots: { type: 'boolean', description: 'Use Standard Lab Values for Spots, for more accurate display and output of spot colours' },
            },
        },
        features: [
            'indesign.color.swatches_menu_ink_manager',
            'indesign.color.spot_color_appearance',
            'indesign.color.process_vs_spot',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { allSpotsToProcess: false, useStandardLabForSpots: true, inks: [{ name: 'PANTONE 185 C', type: 'OPAQUE', neutralDensity: 0.5, trapSequence: 5, alias: 'Process Magenta', convertToProcess: false }] },
        handler: (a) => {
            known(a, ['inks', 'allSpotsToProcess', 'useStandardLabForSpots'], '');
            const body = [];
            if (a.allSpotsToProcess !== undefined) {
                body.push(
                    'var every = doc.inks.everyItem().getElements();',
                    `for (var i = 0; i < every.length; i++) if (!every[i].isProcessInk) every[i].convertToProcess = ${flag(a.allSpotsToProcess, 'allSpotsToProcess')};`,
                );
            }
            if (a.useStandardLabForSpots !== undefined) body.push(`doc.accurateLABSpots = ${flag(a.useStandardLabForSpots, 'useStandardLabForSpots')};`);
            if (a.inks !== undefined) {
                if (!Array.isArray(a.inks) || !a.inks.length) throw new Error("'inks' must be a non-empty list");
                a.inks.forEach((ink, i) => {
                    const w = `inks[${i}]`;
                    object(ink, w);
                    known(ink, ['name', 'type', 'neutralDensity', 'trapSequence', 'alias', 'convertToProcess'], w);
                    const set = [];
                    if (ink.type !== undefined) set.push(`ink.inkType = InkTypes.${enumOf(ink.type, ['NORMAL', 'TRANSPARENT', 'OPAQUE', 'OPAQUE_IGNORE'], { name: `${w}.type` })};`);
                    if (ink.neutralDensity !== undefined) set.push(`ink.neutralDensity = ${num(ink.neutralDensity, { min: 0.001, max: 10, name: `${w}.neutralDensity` })};`);
                    if (ink.trapSequence !== undefined) {
                        const n = num(ink.trapSequence, { min: 1, max: 100, name: `${w}.trapSequence` });
                        if (!Number.isInteger(Number(n))) throw new Error(`'${w}.trapSequence' must be a whole number`);
                        set.push(`ink.trapOrder = ${n};`);
                    }
                    if (ink.alias !== undefined) {
                        if (typeof ink.alias !== 'string' || ink.alias.length > 200) throw new Error(`'${w}.alias' must be an ink name or ""`);
                        set.push(ink.alias ? `ink.aliasInkName = __ink(doc, ${str(ink.alias)}).name;` : 'ink.aliasInkName = "";');
                    }
                    if (ink.convertToProcess !== undefined) set.push(`ink.convertToProcess = ${flag(ink.convertToProcess, `${w}.convertToProcess`)};`);
                    if (!set.length) throw new Error(`'${w}': nothing to set for ${ink.name}`);
                    body.push(`var ink = __ink(doc, ${str(name(ink.name, `${w}.name`))});`, ...set);
                });
            }
            body.push(
                'var out = [], all = doc.inks.everyItem().getElements();',
                'for (var k = 0; k < all.length; k++) {',
                '  var n = all[k], r = { name: n.name, process: n.isProcessInk };',
                '  try { r.type = __enumName(n.inkType); r.neutralDensity = n.neutralDensity; r.trapSequence = n.trapOrder; } catch (e) {}',
                '  try { r.alias = n.aliasInkName || null; r.convertToProcess = n.convertToProcess; r.print = n.printInk; r.solidity = n.solidity; } catch (e) {}',
                '  out.push(r);',
                '}',
                '__result__ = { useStandardLabForSpots: doc.accurateLABSpots, inks: out };',
            );
            return run('Set inks', colorScript(body.join('\n')));
        },
    },
    {
        name: 'set_gradient_swatch',
        description: 'Create or edit a gradient swatch (Swatches panel menu > New Gradient Swatch, Gradient panel): its type (linear or radial) and its colour stops with their locations and midpoints. Creates the gradient when no swatch has the name',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Gradient swatch name' },
                newName: { type: 'string', description: 'Rename the gradient' },
                type: { type: 'string', enum: ['LINEAR', 'RADIAL'], description: 'Gradient type' },
                stops: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 50,
                    description: 'Colour stops in order, replacing the existing ones (needed when creating)',
                    items: {
                        type: 'object',
                        properties: {
                            color: { ...COLOR_SCHEMA, description: `Stop colour: ${COLOR_SCHEMA.description}; a colour, tint or mixed ink, not a gradient` },
                            location: { type: 'number', minimum: 0, maximum: 100, description: 'Location of the stop along the gradient (%)' },
                            midpoint: { type: 'number', minimum: 13, maximum: 87, description: 'Midpoint between this stop and the next (%)' },
                        },
                        required: ['color', 'location'],
                    },
                },
            },
            required: ['name'],
        },
        features: [
            'indesign.color.new_gradient_swatch',
            'indesign.color.gradient_panel',
            'indesign.color.gradient_type_gradient',
            'indesign.color.gradient_location_gradient_stop',
            'indesign.color.gradient_midpoint',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { name: 'Sunset', type: 'RADIAL', stops: [{ color: 'Brand Red', location: 0, midpoint: 40 }, { color: '#FFCC00', location: 100 }] },
        handler: (a) => {
            known(a, ['name', 'newName', 'type', 'stops'], '');
            const nm = name(a.name, 'name');
            const colors = [];
            const body = [
                `var nm = ${str(nm)}, g = doc.gradients.itemByName(nm), created = !g.isValid;`,
                'if (created && doc.swatches.itemByName(nm).isValid) throw new Error(nm + " is a swatch but not a gradient");',
            ];
            let stops = null;
            if (a.stops !== undefined) {
                if (!Array.isArray(a.stops) || a.stops.length < 2 || a.stops.length > 50) throw new Error("'stops' needs 2 to 50 stops");
                let last = -1;
                stops = a.stops.map((st, i) => {
                    const w = `stops[${i}]`;
                    object(st, w);
                    known(st, ['color', 'location', 'midpoint'], w);
                    if (st.location === undefined) throw new Error(`'${w}.location' is required`);
                    const loc = Number(num(st.location, { min: 0, max: 100, name: `${w}.location` }));
                    if (loc < last) throw new Error(`'${w}.location' is before the previous stop; give stops in order`);
                    last = loc;
                    const v = `__c${colors.length}`;
                    colors.push(`var ${v} = __swatch(doc, ${colorSpec(st.color, `${w}.color`)});`);
                    return { v, loc, mid: st.midpoint === undefined ? null : num(st.midpoint, { min: 13, max: 87, name: `${w}.midpoint` }) };
                });
            }
            if (a.newName !== undefined) name(a.newName, 'newName');
            if (a.type === undefined && !stops && a.newName === undefined) throw new Error('Nothing to set: give type, stops or newName');
            const type = a.type === undefined ? null : enumOf(a.type, ['LINEAR', 'RADIAL'], { name: 'type' });
            body.push(
                ...(stops ? [] : ['if (created) throw new Error("No gradient named " + nm + "; give stops to create it");']),
                ...colors,
            );
            if (stops) {
                body.push(
                    `var cs = [${stops.map((s) => s.v).join(', ')}];`,
                    'for (var c = 0; c < cs.length; c++) { var ct = cs[c].constructor.name; if (ct !== "Color" && ct !== "Tint" && ct !== "MixedInk") throw new Error("Stop " + c + ": " + cs[c].name + " is a " + ct + "; stops take colours, tints or mixed inks"); }',
                );
            }
            body.push(`if (created) g = doc.gradients.add({ name: nm, type: GradientType.${type ?? 'LINEAR'} });`);
            if (type) body.push(`g.type = GradientType.${type};`);
            if (stops) {
                body.push(
                    'var gs = g.gradientStops;',
                    `while (gs.length < ${stops.length}) gs.add();`,
                    `while (gs.length > ${stops.length}) gs.item(gs.length - 1).remove();`,
                    ...stops.flatMap((s, i) => [
                        `gs.item(${i}).stopColor = cs[${i}];`,
                        `gs.item(${i}).location = ${s.loc};`,
                        ...(s.mid === null ? [] : [`gs.item(${i}).midpoint = ${s.mid};`]),
                    ]),
                );
            }
            if (a.newName !== undefined) body.push(`g.name = ${str(a.newName)};`);
            body.push('var info = __swatchInfo(g); info.created = created;', '__result__ = info;');
            return run('Set gradient swatch', colorScript(body.join('\n')));
        },
    },
    {
        name: 'set_fill_stroke',
        description: 'Apply fills and strokes to items, to the text in text frames, or to placed grayscale and bitmap images (colourise): a colour, a gradient or None (Apply Color, Apply Gradient, Apply None), tint, overprint, and the gradient\'s angle, length and start as set with the Gradient panel or Gradient Swatch tool, or reverse it; or swap fill and stroke, or reset them to the defaults (Tools panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                applyTo: { type: 'string', enum: ['item', 'text', 'content'], description: 'item: the frame or shape (Formatting affects container); text: the text of text frames, or selected text (Formatting affects text); content: the placed graphic inside the frame, colourising a grayscale or bitmap image. Default item' },
                swap: { type: 'boolean', description: 'Swap Fill and Stroke: exchange the fill and stroke colours and tints (before fill and stroke options)' },
                defaults: { type: 'boolean', description: 'Default Fill and Stroke: fill None and stroke Black (text: fill Black and stroke None), before fill and stroke options' },
                fill: paintSchema('Fill'),
                stroke: paintSchema('Stroke'),
            },
            required: ['target'],
        },
        features: [
            'indesign.color.apply_color_shortcut',
            'indesign.color.apply_gradient_shortcut',
            'indesign.color.apply_none_shortcut',
            'indesign.color.swap_fill_stroke',
            'indesign.color.default_fill_stroke',
            'indesign.color.colorize_grayscale',
            'indesign.color.gradient_panel',
            'indesign.color.gradient_swatch_tool',
            'indesign.color.gradient_angle_gradient',
            'indesign.color.gradient_reverse_gradient',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: {
            target: { ids: [5] }, applyTo: 'item', swap: true, defaults: false,
            fill: { color: 'Sunset', tint: 80, gradientAngle: 45, gradientLength: 60, gradientStart: [10, 20], overprint: false },
            stroke: { color: 'None', reverseGradient: true, gradientStart: [0, 0], gradientLength: 20 },
        },
        handler: (a) => {
            known(a, ['target', 'applyTo', 'swap', 'defaults', 'fill', 'stroke'], '');
            const mode = a.applyTo === undefined ? 'item' : enumOf(a.applyTo, ['item', 'text', 'content'], { name: 'applyTo' });
            const spec = targetSpec(a.target);
            const swap = a.swap !== undefined && flag(a.swap, 'swap') === 'true';
            const defaults = a.defaults !== undefined && flag(a.defaults, 'defaults') === 'true';
            if (swap && defaults) throw new Error('Give swap or defaults, not both');
            const colors = [];
            const fill = a.fill === undefined ? [] : paintStatements('fill', a.fill, colors);
            const stroke = a.stroke === undefined ? [] : paintStatements('stroke', a.stroke, colors);
            if (!swap && !defaults && !fill.length && !stroke.length) throw new Error('Nothing to apply: give fill, stroke, swap or defaults');
            const body = [
                PAINT_TARGET,
                `var items = __targets(doc, ${spec}), out = [];`,
                ...colors,
                defaults ? 'var __none = doc.swatches.itemByName("None"), __black = doc.swatches.itemByName("Black");' : '',
                'for (var i = 0; i < items.length; i++) {',
                '  var it = items[i], pg = __pageOf(it), o = __paintTarget(it, ' + str(mode) + ');',
                swap ? '  var fc = o.fillColor, ft = o.fillTint; o.fillColor = o.strokeColor; o.strokeColor = fc; try { o.fillTint = o.strokeTint; o.strokeTint = ft; } catch (e) {}' : '',
                defaults ? (mode === 'text' ? '  o.fillColor = __black; o.strokeColor = __none;' : '  o.fillColor = __none; o.strokeColor = __black;') : '',
                ...fill.map((s) => `  ${s}`),
                ...stroke.map((s) => `  ${s}`),
                '  var r = __paintInfo(o); r.id = it.id; out.push(r);',
                '}',
                `__result__ = { applyTo: ${str(mode)}, items: out };`,
            ];
            return run('Set fill and stroke', script(body.filter(Boolean).join('\n')));
        },
    },
    {
        name: 'copy_fill_stroke',
        description: 'Copy fill and stroke attributes from one item to others, as the Eyedropper tool does: colour, tint, overprint and gradient angle and length of the fill, and colour, tint, weight, type, alignment, overprint and gradient of the stroke; between items or between the texts of text frames',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'integer', description: 'Page item id to copy from' },
                target: TARGET_SCHEMA,
                copy: { type: 'string', enum: ['both', 'fill', 'stroke'], description: 'Which attributes to copy (default both)' },
                applyTo: { type: 'string', enum: ['item', 'text'], description: 'item: the frames themselves; text: from the source frame\'s text to the target frames\' text. Default item' },
            },
            required: ['source', 'target'],
        },
        features: ['indesign.color.eyedropper_tool'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { source: 3, target: { ids: [5, 6] }, copy: 'both', applyTo: 'item' },
        handler: (a) => {
            known(a, ['source', 'target', 'copy', 'applyTo'], '');
            const src = num(a.source, { min: 0, max: 1e9, name: 'source' });
            if (!Number.isInteger(Number(src))) throw new Error("'source' must be a page item id");
            const copy = a.copy === undefined ? 'both' : enumOf(a.copy, ['both', 'fill', 'stroke'], { name: 'copy' });
            const mode = a.applyTo === undefined ? 'item' : enumOf(a.applyTo, ['item', 'text'], { name: 'applyTo' });
            const fill = ['fillColor', 'fillTint', 'overprintFill', 'gradientFillAngle', 'gradientFillLength'];
            const stroke = ['strokeColor', 'strokeTint', 'strokeWeight', 'overprintStroke', 'gradientStrokeAngle', 'gradientStrokeLength',
                'strokeAlignment', ...(mode === 'item' ? ['strokeType'] : [])];
            const props = [...(copy !== 'stroke' ? fill : []), ...(copy !== 'fill' ? stroke : [])];
            const body = [
                PAINT_TARGET,
                `var src = __paintTarget(__item(doc, ${src}), ${str(mode)});`,
                `var items = __targets(doc, ${targetSpec(a.target)}), out = [];`,
                'for (var i = 0; i < items.length; i++) {',
                `  var it = items[i], o = __paintTarget(it, ${str(mode)}), copied = [];`,
                ...props.map((p) => `  try { o.${p} = src.${p}; copied.push("${p}"); } catch (e) {}`),
                '  out.push({ id: it.id, copied: copied });',
                '}',
                '__result__ = { source: ' + src + ', items: out };',
            ];
            return run('Copy fill and stroke', script(body.join('\n')));
        },
    },
    {
        name: 'set_color_panel_options',
        description: 'Set the colour controls of the interface: which of fill or stroke is active and whether formatting affects the container or the text (Tools panel fill/stroke proxy), the Swatches panel view (Name, Small Name, Small Swatch, Large Swatch) and Show/Hide Options, and the Color panel\'s Lab, CMYK or RGB sliders and Show/Hide Options',
        inputSchema: {
            type: 'object',
            properties: {
                active: { type: 'string', enum: ['fill', 'stroke'], description: 'Which of fill or stroke colour changes apply to (Toggle Fill and Stroke)' },
                affects: { type: 'string', enum: ['container', 'text'], description: 'Formatting Affects Container or Formatting Affects Text' },
                swatchesView: { type: 'string', enum: Object.keys(SWATCH_VIEWS), description: 'Swatches panel menu view' },
                colorPanelMode: { type: 'string', enum: Object.keys(COLOR_MODES), description: 'Color panel menu: show Lab, CMYK or RGB sliders' },
                toggleSwatchesOptions: { type: 'boolean', description: 'Swatches panel menu > Show/Hide Options (toggles; the result gives the command\'s new title)' },
                toggleColorOptions: { type: 'boolean', description: 'Color panel menu > Show/Hide Options (toggles; the result gives the command\'s new title)' },
            },
        },
        features: [
            'indesign.color.toggle_fill_stroke',
            'indesign.color.formatting_affects_container_text',
            'indesign.color.swatches_menu_name',
            'indesign.color.swatches_menu_small_name',
            'indesign.color.swatches_menu_small_swatch',
            'indesign.color.swatches_menu_large_swatch',
            'indesign.color.swatches_menu_hide_options',
            'indesign.color.color_menu_show_options',
            'indesign.color.color_menu_lab',
            'indesign.color.color_menu_cmyk',
            'indesign.color.color_menu_rgb',
            'indesign.color.color_panel',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { active: 'stroke', affects: 'text', swatchesView: 'small_name', colorPanelMode: 'cmyk', toggleSwatchesOptions: true, toggleColorOptions: true },
        handler: (a) => {
            known(a, ['active', 'affects', 'swatchesView', 'colorPanelMode', 'toggleSwatchesOptions', 'toggleColorOptions'], '');
            const body = [
                'var __menu = function (id, what) {',
                '  var m = app.menuActions.itemByID(id);',
                '  if (!m.isValid) throw new Error(what + " (menu action " + id + ") is not available in this version of InDesign");',
                '  if (!m.enabled) throw new Error(what + " is not available now; open the panel (Window > Color) and try again");',
                '  m.invoke();',
                '  return { command: what, title: m.title, checked: m.checked };',
                '};',
                'var p = app.strokeFillProxySettings, menus = [];',
            ];
            const start = body.length;
            if (a.active !== undefined) body.push(`p.active = StrokeFillProxyOptions.${enumOf(a.active, ['fill', 'stroke'], { name: 'active' }).toUpperCase()};`);
            if (a.affects !== undefined) body.push(`p.target = StrokeFillTargetOptions.FORMATTING_AFFECTS_${enumOf(a.affects, ['container', 'text'], { name: 'affects' }).toUpperCase()};`);
            const menu = ([id, what]) => body.push(`menus.push(__menu(${id}, ${str(what)}));`);
            if (a.swatchesView !== undefined) menu(SWATCH_VIEWS[enumOf(a.swatchesView, Object.keys(SWATCH_VIEWS), { name: 'swatchesView' })]);
            if (a.toggleSwatchesOptions !== undefined && flag(a.toggleSwatchesOptions, 'toggleSwatchesOptions') === 'true') menu([16406, 'Swatches panel > Show/Hide Options']);
            if (a.colorPanelMode !== undefined) menu(COLOR_MODES[enumOf(a.colorPanelMode, Object.keys(COLOR_MODES), { name: 'colorPanelMode' })]);
            if (a.toggleColorOptions !== undefined && flag(a.toggleColorOptions, 'toggleColorOptions') === 'true') menu([29185, 'Color panel > Show/Hide Options']);
            if (body.length === start) throw new Error('Nothing to set: give active, affects, swatchesView, colorPanelMode, toggleSwatchesOptions or toggleColorOptions');
            body.push('__result__ = { active: __enumName(p.active), affects: __enumName(p.target), menus: menus };');
            return run('Set colour panel options', script(body.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'get_color_settings',
        description: 'Read colour management (Edit > Color Settings, Appearance of Black): the application\'s settings, working spaces, policies and conversion options; with a document open, its assigned profiles, policies and rendering intents (Edit > Assign Profiles) and the proofing of its window (View > Proof Setup, Proof Colors, Overprint Preview); optionally the presets, profiles and engines to choose from',
        inputSchema: {
            type: 'object',
            properties: {
                includeLists: { type: 'boolean', description: 'Also list the colour settings presets, working-space and document profiles, and engines that can be chosen' },
            },
        },
        features: ['indesign.color.color_settings'],
        hints: { readOnly: true, idempotent: true },
        auditArgs: { includeLists: true },
        handler: (a) => {
            known(a, ['includeLists'], '');
            const lists = a.includeLists !== undefined && flag(a.includeLists, 'includeLists') === 'true';
            const body = [
                'var cs = app.colorSettings, r = {};',
                'r.application = { preset: cs.cmsSettings, enableColorManagement: cs.enableColorManagement,',
                '  rgbWorkingSpace: cs.workingSpaceRGB, cmykWorkingSpace: cs.workingSpaceCMYK,',
                '  rgbPolicy: __enumName(cs.rgbPolicy), cmykPolicy: __enumName(cs.cmykPolicy),',
                '  profileMismatchAskWhenOpening: cs.mismatchAskWhenOpening, profileMismatchAskWhenPasting: cs.mismatchAskWhenPasting,',
                '  missingProfileAskWhenOpening: cs.missingAskWhenOpening, engine: cs.engine, intent: __enumName(cs.intent),',
                '  blackPointCompensation: cs.useBPC, accurateLabSpots: cs.accurateLABSpots,',
                '  richBlackOnScreen: cs.idealizedBlackToScreen, richBlackOnExport: cs.idealizedBlackToExport };',
                lists ? 'r.lists = { presets: cs.cmsSettingsList, rgbWorkingSpaces: cs.workingSpaceRGBList, cmykWorkingSpaces: cs.workingSpaceCMYKList, engines: cs.engineList };' : '',
                'if (app.documents.length) {',
                '  var doc = app.activeDocument;',
                '  var d = { name: doc.name, rgbProfile: doc.rgbProfile, cmykProfile: doc.cmykProfile,',
                '    rgbPolicy: __enumName(doc.rgbPolicy), cmykPolicy: __enumName(doc.cmykPolicy),',
                '    solidColorIntent: __enumName(doc.solidColorIntent), defaultImageIntent: __enumName(doc.defaultImageIntent),',
                '    afterBlendingIntent: __enumName(doc.afterBlendingIntent), useStandardLabForSpots: doc.accurateLABSpots };',
                lists ? '  d.rgbProfiles = doc.rgbProfileList; d.cmykProfiles = doc.cmykProfileList;' : '',
                '  r.document = d;',
                '  try {',
                '    var w = app.activeWindow;',
                '    if (w.constructor.name === "LayoutWindow") r.proofing = { proofing: __enumName(w.proofingType), profile: w.proofingProfile,',
                '      simulatePaperWhite: w.simulatePaperWhite, simulateInkBlack: w.simulateInkBlack, preserveColorNumbers: w.preserveColorNumbers, overprintPreview: w.overprintPreview };',
                '  } catch (e) {}',
                '}',
                '__result__ = r;',
            ];
            return run('Get colour settings', script(body.filter(Boolean).join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'set_color_settings',
        description: 'Change the application\'s colour management (Edit > Color Settings): load a preset or a .csf settings file, turn colour management on or off, set the RGB and CMYK working spaces and policies, the profile mismatch and missing profile prompts, the engine, intent and black point compensation, accurate Lab spots, and the Appearance of Black preferences',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', description: 'Settings: a colour settings preset name from get_color_settings (lists.presets), applied before the other options' },
                presetFile: { type: 'string', description: 'Load: path of a colour settings (.csf) file, applied before the other options' },
                ...Object.fromEntries(Object.entries(APP_SETTINGS).map(([k, [, kind, description]]) => [k,
                    kind === 'bool' ? { type: 'boolean', description }
                        : kind === 'policy' ? { type: 'string', enum: POLICIES, description: `${description}: off, preserve embedded profiles, convert to working space, or (CMYK) preserve numbers` }
                            : kind === 'intent' ? { type: 'string', enum: DEFAULT_INTENTS, description }
                                : { type: 'string', description }])),
            },
        },
        features: [
            'indesign.color.color_settings',
            'indesign.color.colorsettings_settings_colour_preset',
            'indesign.color.colorsettings_working_spaces_rgb',
            'indesign.color.colorsettings_working_spaces_cmyk',
            'indesign.color.colorsettings_color_management_policies_rgb',
            'indesign.color.colorsettings_color_management_policies_cmyk',
            'indesign.color.colorsettings_profile_mismatches_ask_when_opening',
            'indesign.color.colorsettings_profile_mismatches_ask_when_pasting',
            'indesign.color.colorsettings_missing_profiles_ask_when_opening',
            'indesign.color.colorsettings_engine',
            'indesign.color.colorsettings_intent',
            'indesign.color.colorsettings_use_black_point_compensation',
            'indesign.color.colorsettings_enable_color_management',
            'indesign.color.colorsettings_accurate_lab_spots',
            'indesign.color.appearance_of_black',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: {
            preset: 'North America General Purpose 2', presetFile: undefined, enableColorManagement: true, rgbWorkingSpace: 'sRGB IEC61966-2.1',
            cmykWorkingSpace: 'U.S. Web Coated (SWOP) v2', rgbPolicy: 'PRESERVE_EMBEDDED_PROFILES', cmykPolicy: 'COMBINATION_OF_PRESERVE_AND_SAFE_CMYK',
            profileMismatchAskWhenOpening: true, profileMismatchAskWhenPasting: true, missingProfileAskWhenOpening: false,
            engine: 'Adobe (ACE)', intent: 'RELATIVE_COLORIMETRIC', blackPointCompensation: true, accurateLabSpots: true,
            richBlackOnScreen: true, richBlackOnExport: false,
        },
        handler: (a) => {
            known(a, ['preset', 'presetFile', ...Object.keys(APP_SETTINGS)], '');
            if (a.preset !== undefined && a.presetFile !== undefined) throw new Error("Give preset or presetFile, not both");
            const body = [
                'var cs = app.colorSettings;',
                'var __pick = function (list, v, what) { for (var i = 0; i < list.length; i++) if (list[i] === v) return v; throw new Error(what + " " + v + " is not available; get_color_settings with includeLists gives the choices"); };',
            ];
            if (a.preset !== undefined) body.push(`cs.cmsSettings = __pick(cs.cmsSettingsList, ${str(name(a.preset, 'preset'))}, "Colour settings preset");`);
            if (a.presetFile !== undefined) {
                body.push(`var f = File(${filePath(a.presetFile, 'presetFile', ['.csf'])});`, 'if (!f.exists) throw new Error("File not found: " + f.fsName);', 'cs.cmsSettingsPath = f;');
            }
            for (const [k, [prop, kind, , listProp]] of Object.entries(APP_SETTINGS)) {
                const v = a[k];
                if (v === undefined) continue;
                if (kind === 'bool') body.push(`cs.${prop} = ${flag(v, k)};`);
                else if (kind === 'policy') body.push(`cs.${prop} = ColorSettingsPolicy.${enumOf(v, POLICIES, { name: k })};`);
                else if (kind === 'intent') body.push(`cs.${prop} = DefaultRenderingIntent.${enumOf(v, DEFAULT_INTENTS, { name: k })};`);
                else body.push(`cs.${prop} = __pick(cs.${listProp}, ${str(name(v, k))}, ${str(k)});`);
            }
            if (body.length === 2) throw new Error(`Nothing to set: give preset, presetFile or one of ${Object.keys(APP_SETTINGS).join(', ')}`);
            body.push(
                '__result__ = { preset: cs.cmsSettings, enableColorManagement: cs.enableColorManagement, rgbWorkingSpace: cs.workingSpaceRGB, cmykWorkingSpace: cs.workingSpaceCMYK,',
                '  rgbPolicy: __enumName(cs.rgbPolicy), cmykPolicy: __enumName(cs.cmykPolicy), profileMismatchAskWhenOpening: cs.mismatchAskWhenOpening,',
                '  profileMismatchAskWhenPasting: cs.mismatchAskWhenPasting, missingProfileAskWhenOpening: cs.missingAskWhenOpening, engine: cs.engine,',
                '  intent: __enumName(cs.intent), blackPointCompensation: cs.useBPC, accurateLabSpots: cs.accurateLABSpots,',
                '  richBlackOnScreen: cs.idealizedBlackToScreen, richBlackOnExport: cs.idealizedBlackToExport };',
            );
            return run('Set colour settings', script(body.join('\n'), { needsDocument: false }));
        },
    },
    {
        name: 'assign_document_profiles',
        description: 'Assign the active document\'s RGB and CMYK profiles without converting colour values, set its colour policies, and set its rendering intents for solid colours, images and after blending (Edit > Assign Profiles)',
        inputSchema: {
            type: 'object',
            properties: {
                rgbProfile: { type: 'string', description: 'RGB profile name from get_color_settings (document.rgbProfiles, with includeLists), or "working" for the current RGB working space' },
                cmykProfile: { type: 'string', description: 'CMYK profile name from get_color_settings (document.cmykProfiles, with includeLists), or "working" for the current CMYK working space' },
                rgbPolicy: { type: 'string', enum: POLICIES, description: 'The document\'s RGB colour policy' },
                cmykPolicy: { type: 'string', enum: POLICIES, description: 'The document\'s CMYK colour policy' },
                solidColorIntent: { type: 'string', enum: INTENTS, description: 'Solid Color Intent (vector art and native objects)' },
                defaultImageIntent: { type: 'string', enum: INTENTS, description: 'Default Image Intent (bitmap images)' },
                afterBlendingIntent: { type: 'string', enum: INTENTS, description: 'After-Blending Intent (colours from transparency)' },
            },
        },
        features: ['indesign.color.assign_profiles'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { rgbProfile: 'working', cmykProfile: 'Coated FOGRA39 (ISO 12647-2:2004)', rgbPolicy: 'PRESERVE_EMBEDDED_PROFILES', cmykPolicy: 'COMBINATION_OF_PRESERVE_AND_SAFE_CMYK', solidColorIntent: 'USE_COLOR_SETTINGS', defaultImageIntent: 'PERCEPTUAL', afterBlendingIntent: 'RELATIVE_COLORIMETRIC' },
        handler: (a) => {
            const keys = ['rgbProfile', 'cmykProfile', 'rgbPolicy', 'cmykPolicy', 'solidColorIntent', 'defaultImageIntent', 'afterBlendingIntent'];
            known(a, keys, '');
            if (!keys.some((k) => a[k] !== undefined)) throw new Error(`Nothing to set: give one of ${keys.join(', ')}`);
            const body = ['var __pick = function (list, v, what) { for (var i = 0; i < list.length; i++) if (list[i] === v) return v; throw new Error(what + " " + v + " is not installed; get_color_settings with includeLists gives the choices"); };'];
            for (const [k, space] of [['rgbProfile', 'RGB'], ['cmykProfile', 'CMYK']]) {
                if (a[k] === undefined) continue;
                const v = name(a[k], k);
                body.push(v === 'working'
                    ? `doc.${k} = app.colorSettings.workingSpace${space};`
                    : `doc.${k} = __pick(doc.${k}List, ${str(v)}, "${space} profile");`);
            }
            for (const k of ['rgbPolicy', 'cmykPolicy']) if (a[k] !== undefined) body.push(`doc.${k} = ColorSettingsPolicy.${enumOf(a[k], POLICIES, { name: k })};`);
            for (const k of ['solidColorIntent', 'defaultImageIntent', 'afterBlendingIntent']) if (a[k] !== undefined) body.push(`doc.${k} = RenderingIntent.${enumOf(a[k], INTENTS, { name: k })};`);
            body.push(
                '__result__ = { rgbProfile: doc.rgbProfile, cmykProfile: doc.cmykProfile, rgbPolicy: __enumName(doc.rgbPolicy), cmykPolicy: __enumName(doc.cmykPolicy),',
                '  solidColorIntent: __enumName(doc.solidColorIntent), defaultImageIntent: __enumName(doc.defaultImageIntent), afterBlendingIntent: __enumName(doc.afterBlendingIntent) };',
            );
            return run('Assign document profiles', script(body.join('\n')));
        },
    },
    {
        name: 'set_proofing',
        description: 'Soft-proof the active document\'s window: choose the output condition to simulate and turn Proof Colors on or off (View > Proof Setup, View > Proof Colors), with paper white, ink black and preserve numbers for a custom profile, and turn Overprint Preview on or off',
        inputSchema: {
            type: 'object',
            properties: {
                proofing: { type: 'string', enum: Object.keys(PROOFING), description: 'off turns Proof Colors off; document_cmyk, working_cmyk or custom proof against that profile' },
                profile: { type: 'string', description: 'Custom proof: the device profile to simulate (sets proofing to custom)' },
                simulatePaperWhite: { type: 'boolean', description: 'Custom proof: Simulate Paper Color' },
                simulateInkBlack: { type: 'boolean', description: 'Custom proof: Simulate Black Ink' },
                preserveColorNumbers: { type: 'boolean', description: 'Custom proof: Preserve CMYK Numbers' },
                overprintPreview: { type: 'boolean', description: 'View > Overprint Preview' },
            },
        },
        features: ['indesign.color.proof_setup', 'indesign.color.proof_colors'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { proofing: 'custom', profile: 'Coated FOGRA39 (ISO 12647-2:2004)', simulatePaperWhite: true, simulateInkBlack: true, preserveColorNumbers: false, overprintPreview: true },
        handler: (a) => {
            const keys = ['proofing', 'profile', 'simulatePaperWhite', 'simulateInkBlack', 'preserveColorNumbers', 'overprintPreview'];
            known(a, keys, '');
            if (!keys.some((k) => a[k] !== undefined)) throw new Error(`Nothing to set: give one of ${keys.join(', ')}`);
            let type = a.proofing === undefined ? null : enumOf(a.proofing, Object.keys(PROOFING), { name: 'proofing' });
            const custom = ['profile', 'simulatePaperWhite', 'simulateInkBlack', 'preserveColorNumbers'].filter((k) => a[k] !== undefined);
            if (type && type !== 'custom' && custom.length) throw new Error(`'${custom[0]}' applies to proofing: custom`);
            if (a.profile !== undefined) type = 'custom';
            const body = [LAYOUT_WINDOW];
            if (type) body.push(`w.proofingType = ProofingType.${PROOFING[type]};`);
            if (a.profile !== undefined) body.push(`w.proofingProfile = ${str(name(a.profile, 'profile'))};`);
            for (const k of ['simulatePaperWhite', 'simulateInkBlack', 'preserveColorNumbers', 'overprintPreview']) if (a[k] !== undefined) body.push(`w.${k} = ${flag(a[k], k)};`);
            body.push('__result__ = { proofing: __enumName(w.proofingType), profile: w.proofingProfile, simulatePaperWhite: w.simulatePaperWhite, simulateInkBlack: w.simulateInkBlack, preserveColorNumbers: w.preserveColorNumbers, overprintPreview: w.overprintPreview };');
            return run('Set proofing', script(body.join('\n')));
        },
    },
    {
        name: 'set_image_color_settings',
        description: 'Override the colour profile and rendering intent of placed images (Object > Image Color Settings)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `Frames holding images, or the images themselves. ${TARGET_SCHEMA.description}` },
                profile: { type: 'string', description: 'A profile name from the image\'s profile list (an unknown name is refused with the list), or "USE_DOCUMENT" for Use Document Default' },
                renderingIntent: { type: 'string', enum: INTENTS, description: 'Rendering intent; USE_COLOR_SETTINGS is Use Document Image Intent' },
            },
            required: ['target'],
        },
        features: ['indesign.color.image_color_settings'],
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { target: { ids: [7] }, profile: 'Adobe RGB (1998)', renderingIntent: 'PERCEPTUAL' },
        handler: (a) => {
            known(a, ['target', 'profile', 'renderingIntent'], '');
            const spec = targetSpec(a.target);
            if (a.profile === undefined && a.renderingIntent === undefined) throw new Error('Nothing to set: give profile or renderingIntent');
            const body = [
                `var items = __targets(doc, ${spec}), out = [];`,
                'for (var i = 0; i < items.length; i++) {',
                '  var it = items[i], img = it.constructor.name === "Image" ? it : (it.images.length ? it.images[0] : null);',
                '  if (!img) throw new Error("Item " + it.id + " holds no placed image");',
            ];
            if (a.profile !== undefined) {
                const p = name(a.profile, 'profile');
                if (p === 'USE_DOCUMENT') body.push('  img.profile = Profile.USE_DOCUMENT;');
                else {
                    body.push(
                        `  var want = ${str(p)}, list = img.profileList, ok = false;`,
                        '  for (var j = 0; j < list.length; j++) if (list[j] === want) ok = true;',
                        '  if (!ok) throw new Error("Image " + img.id + " has no profile " + want + "; choose one of: " + list.join(", "));',
                        '  img.profile = want;',
                    );
                }
            }
            if (a.renderingIntent !== undefined) body.push(`  img.imageRenderingIntent = RenderingIntent.${enumOf(a.renderingIntent, INTENTS, { name: 'renderingIntent' })};`);
            body.push(
                '  out.push({ id: it.id, imageId: img.id, profile: String(img.profile), renderingIntent: __enumName(img.imageRenderingIntent) });',
                '}',
                '__result__ = { items: out };',
            );
            return run('Set image colour settings', script(body.join('\n')));
        },
    },
];
