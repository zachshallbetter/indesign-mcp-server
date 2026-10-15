/**
 * Text layers: create point and paragraph text, set the text and its character
 * and paragraph formatting (whole layer or a range), read it back, find fonts,
 * set More Options and Path Options, add and remove text animators and their
 * range, wiggly and expression selectors, and convert text to shapes or masks.
 *
 * Character indexes are 0-based and ranges end before `end`, as in After
 * Effects' TextDocument; layers stay 1-based.
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

const JUSTIFY = { left: 'LEFT_JUSTIFY', center: 'CENTER_JUSTIFY', right: 'RIGHT_JUSTIFY', justify_last_left: 'FULL_JUSTIFY_LASTLINE_LEFT', justify_last_center: 'FULL_JUSTIFY_LASTLINE_CENTER', justify_last_right: 'FULL_JUSTIFY_LASTLINE_RIGHT', justify_all: 'FULL_JUSTIFY_LASTLINE_FULL' };
const AUTO_KERN = { metrics: 'METRIC_KERN', optical: 'OPTICAL_KERN', none: 'NO_AUTO_KERN' };
const BASELINE_OPTION = { normal: 'FONT_NORMAL_BASELINE', superscript: 'FONT_FAUXED_SUPERSCRIPT', subscript: 'FONT_FAUXED_SUBSCRIPT' };
const DIGITS = { default: 'DEFAULT_DIGITS', arabic: 'ARABIC_DIGITS', hindi: 'HINDI_DIGITS', farsi: 'FARSI_DIGITS', arabic_rtl: 'ARABIC_DIGITS_RTL' };
const LINE_JOIN = { miter: 'LINE_JOIN_MITER', round: 'LINE_JOIN_ROUND', bevel: 'LINE_JOIN_BEVEL' };
const BASELINE_DIRECTION = { standard: 'BASELINE_WITH_STREAM', rotated: 'BASELINE_VERTICAL_ROTATED', tate_chuu_yoko: 'BASELINE_VERTICAL_CROSS_STREAM' };
const LEADING_TYPE = { top_to_top: 'JAPANESE_LEADING_TYPE', bottom_to_bottom: 'ROMAN_LEADING_TYPE' };
const DIRECTION = { left_to_right: 'DIRECTION_LEFT_TO_RIGHT', right_to_left: 'DIRECTION_RIGHT_TO_LEFT' };
const LINE_ORIENTATION = { horizontal: 'HORIZONTAL', vertical_right_to_left: 'VERTICAL_RIGHT_TO_LEFT', vertical_left_to_right: 'VERTICAL_LEFT_TO_RIGHT' };
const COMPOSER = ['every_line', 'single_line'];

/** ES3 helpers shared by the text tools. */
const TEXT_HELPERS = `
function __textLayer(l) {
  if (!(l instanceof TextLayer)) throw new Error(l.name + " is not a text layer");
  return l;
}
function __sourceText(l) { return l.property("ADBE Text Properties").property("ADBE Text Document"); }
function __animators(l) { return l.property("ADBE Text Properties").property("ADBE Text Animators"); }
function __animProps(l, ai) { return __animators(l).property(ai).property("ADBE Text Animator Properties"); }
function __animSels(l, ai) { return __animators(l).property(ai).property("ADBE Text Selectors"); }
function __first(g, names) {
  for (var i = 0; i < names.length; i++) {
    var p = null;
    try { p = g.property(names[i]); } catch (e) {}
    if (p) return p;
  }
  return null;
}
function __fit(p, v) {
  var cur = p.value;
  if (!(cur instanceof Array)) return (v instanceof Array) ? v[0] : v;
  if (!(v instanceof Array)) v = [v];
  var out = [];
  for (var i = 0; i < cur.length; i++) out.push(i < v.length ? v[i] : (v.length === 1 ? v[0] : cur[i]));
  return out;
}
function __set(c, p, v) {
  v = __fit(p, v);
  if (p.numKeys > 0) p.setValueAtTime(c.time, v); else p.setValue(v);
}
function __animInfo(l, ai) {
  var a = __animators(l).property(ai), g = a.property("ADBE Text Animator Properties"), s = a.property("ADBE Text Selectors"), props = [], sels = [], k;
  for (k = 1; k <= g.numProperties; k++) {
    var p = g.property(k), v = null;
    try { v = p.value; } catch (e) {}
    props.push({ name: p.name, matchName: p.matchName, value: v });
  }
  for (k = 1; k <= s.numProperties; k++) sels.push({ index: k, name: s.property(k).name, matchName: s.property(k).matchName });
  return { index: ai, name: a.name, enabled: a.enabled, properties: props, selectors: sels };
}
`;

const n = (v, name, min = -1e6, max = 1e6) => num(v, { min, max, name });
const vec = (v, name, min = -1e6, max = 1e6) => {
    if (typeof v === 'number') return n(v, name, min, max);
    if (!Array.isArray(v) || !v.length || v.length > 3) throw new Error(`'${name}' must be a number or an array of 1 to 3 numbers`);
    return json(v.map((x) => Number(n(x, name, min, max))));
};
const pair = (v, name, min = -1e6, max = 1e6) => {
    if (!Array.isArray(v) || v.length !== 2) throw new Error(`'${name}' must be [x, y]`);
    return json(v.map((x) => Number(n(x, name, min, max))));
};
const pick = (map, v, name) => map[enumOf(v, Object.keys(map), { name })];

/** Animator properties (Animation > Animate Text), by match name. */
const ANIM_PROPS = {
    anchor_point: { m: 'ADBE Text Anchor Point 3D' },
    position: { m: 'ADBE Text Position 3D' },
    scale: { m: 'ADBE Text Scale 3D' },
    skew: { m: 'ADBE Text Skew' },
    skew_axis: { m: 'ADBE Text Skew Axis' },
    rotation: { m: 'ADBE Text Rotation' },
    x_rotation: { m: 'ADBE Text Rotation X' },
    y_rotation: { m: 'ADBE Text Rotation Y' },
    opacity: { m: 'ADBE Text Opacity' },
    fill_color: { m: 'ADBE Text Fill Color', color: true },
    fill_hue: { m: 'ADBE Text Fill Hue' },
    fill_saturation: { m: 'ADBE Text Fill Saturation' },
    fill_brightness: { m: 'ADBE Text Fill Brightness' },
    fill_opacity: { m: 'ADBE Text Fill Opacity' },
    stroke_color: { m: 'ADBE Text Stroke Color', color: true },
    stroke_hue: { m: 'ADBE Text Stroke Hue' },
    stroke_saturation: { m: 'ADBE Text Stroke Saturation' },
    stroke_brightness: { m: 'ADBE Text Stroke Brightness' },
    stroke_opacity: { m: 'ADBE Text Stroke Opacity' },
    stroke_width: { m: 'ADBE Text Stroke Width' },
    line_anchor: { m: 'ADBE Text Line Anchor' },
    line_spacing: { m: 'ADBE Text Line Spacing' },
    tracking: { m: 'ADBE Text Tracking Amount' },
    character_offset: { m: 'ADBE Text Character Offset' },
    character_value: { m: 'ADBE Text Character Replace' },
    blur: { m: 'ADBE Text Blur' },
};
/** What Animate Text > All Transform Properties adds. */
const ALL_TRANSFORM = ['anchor_point', 'position', 'scale', 'skew', 'skew_axis', 'rotation', 'opacity'];

const MODES = ['add', 'subtract', 'intersect', 'min', 'max', 'difference'];
const BASED_ON = ['characters', 'characters_excluding_spaces', 'words', 'lines'];
const SHAPES = ['square', 'ramp_up', 'ramp_down', 'triangle', 'round', 'smooth'];
const UNITS = ['percentage', 'index'];
const SELECTOR_TYPES = {
    range: ['ADBE Text Selector', 'Range Selector'],
    wiggly: ['ADBE Text Wiggly Selector', 'Wiggly Selector'],
    expression: ['ADBE Text Expressible Selector', 'Expression Selector'],
};

/**
 * Selector settings: the property's match name and English name (found in the
 * selector or its Advanced group), the selector types that have it, and the value.
 */
const SELECTOR_KEYS = {
    units: { names: ['ADBE Text Range Units', 'Units'], types: ['range'], menu: UNITS, description: 'Start, End and Offset in percentage or index (Advanced > Units)' },
    basedOn: { names: ['ADBE Text Range Type2', 'Based On'], types: ['range', 'wiggly', 'expression'], menu: BASED_ON, description: 'What the selection counts (Advanced > Based On)' },
    mode: { names: ['ADBE Text Selector Mode', 'Mode'], types: ['range', 'wiggly'], menu: MODES, description: 'How the selector combines with those above it' },
    amount: { names: ['ADBE Text Selector Max Amount', 'Amount'], types: ['range'], min: -100, max: 100, description: 'Range: percent, -100 to 100' },
    shape: { names: ['ADBE Text Range Shape', 'Shape'], types: ['range'], menu: SHAPES, description: 'Range: how characters between Start and End are selected' },
    smoothness: { names: ['ADBE Text Selector Smoothness', 'Smoothness'], types: ['range'], min: 0, max: 100, description: 'Range, Square shape: percent' },
    easeHigh: { names: ['ADBE Text Levels Max Ease', 'Ease High'], types: ['range'], min: -100, max: 100, description: 'Range: percent' },
    easeLow: { names: ['ADBE Text Levels Min Ease', 'Ease Low'], types: ['range'], min: -100, max: 100, description: 'Range: percent' },
    randomizeOrder: { names: ['ADBE Text Randomize Order', 'Randomize Order'], types: ['range'], bool: true, description: 'Range: select characters in random order' },
    randomSeed: { names: ['ADBE Text Random Seed', 'Random Seed'], wigglyNames: ['ADBE Text Wiggly Random Seed', 'Random Seed'], types: ['range', 'wiggly'], min: 0, max: 1e6, description: 'Range (with Randomize Order) and Wiggly' },
    maxAmount: { names: ['ADBE Text Wiggly Max Amount', 'Max Amount'], types: ['wiggly'], min: -100, max: 100, description: 'Wiggly: percent' },
    minAmount: { names: ['ADBE Text Wiggly Min Amount', 'Min Amount'], types: ['wiggly'], min: -100, max: 100, description: 'Wiggly: percent' },
    wigglesPerSecond: { names: ['ADBE Text Temporal Freq', 'Wiggles/Second'], types: ['wiggly'], min: 0, max: 1000, description: 'Wiggly' },
    correlation: { names: ['ADBE Text Character Correlation', 'Correlation'], types: ['wiggly'], min: 0, max: 100, description: 'Wiggly: percent' },
    temporalPhase: { names: ['ADBE Text Temporal Phase', 'Temporal Phase'], types: ['wiggly'], description: 'Wiggly: degrees' },
    spatialPhase: { names: ['ADBE Text Spatial Phase', 'Spatial Phase'], types: ['wiggly'], description: 'Wiggly: degrees' },
    lockDimensions: { names: ['ADBE Text Wiggly Lock Dim', 'Lock Dimensions'], types: ['wiggly'], bool: true, description: 'Wiggly' },
    expression: { names: ['ADBE Text Expressible Amount', 'Amount'], types: ['expression'], text: true, description: 'Expression: the Amount expression, e.g. "selectorValue * textIndex/textTotal"' },
};

/** ES3 statements that apply one selector spec inside the animator `ai` of layer `l`. */
function selectorBlock(spec, k) {
    const where = `selectors[${k}]`;
    if (!spec || typeof spec !== 'object') throw new Error(`'${where}' must be an object`);
    const type = enumOf(spec.type, Object.keys(SELECTOR_TYPES), { name: `${where}.type` });
    const L = [];
    if (spec.selector !== undefined) {
        const si = index(spec.selector, { name: `${where}.selector`, max: 1000 });
        if (Number(si) < 1) throw new Error(`'${where}.selector' is 1-based`);
        L.push(`var s = __animSels(l, ai).property(${si}); if (!s) throw new Error("The animator has no selector ${si}");`);
    } else {
        L.push(`var g = __animSels(l, ai), s = null, names = ${json(SELECTOR_TYPES[type])};`);
        L.push('for (var q = 0; q < names.length && !s; q++) if (g.canAddProperty(names[q])) s = __animSels(l, ai).property(g.addProperty(names[q]).propertyIndex);');
        L.push(`if (!s) throw new Error("Cannot add a ${type} selector");`);
    }
    L.push('var sp = function (names) { var p = __first(s, names); if (!p) { var adv = __first(s, ["ADBE Text Range Advanced", "Advanced"]); if (adv) p = __first(adv, names); } if (!p) throw new Error("No " + names[names.length - 1] + " on " + s.name); return p; };');
    for (const key of Object.keys(spec)) {
        if (['type', 'selector', 'start', 'end', 'offset'].includes(key)) continue;
        const def = SELECTOR_KEYS[key];
        if (!def) throw new Error(`'${where}': unknown setting ${key}. Settings: start, end, offset, ${Object.keys(SELECTOR_KEYS).join(', ')}`);
        if (!def.types.includes(type)) throw new Error(`'${where}.${key}' does not apply to a ${type} selector`);
        const names = json(type === 'wiggly' && def.wigglyNames ? def.wigglyNames : def.names);
        const v = spec[key];
        if (def.text) {
            if (typeof v !== 'string' || !v.trim()) throw new Error(`'${where}.${key}' must be expression text`);
            L.push(`sp(${names}).expression = ${str(v)};`);
        } else {
            let val;
            if (def.menu) val = String(def.menu.indexOf(enumOf(v, def.menu, { name: `${where}.${key}` })) + 1);
            else if (def.bool) val = v ? '1' : '0';
            else val = n(v, `${where}.${key}`, def.min, def.max);
            L.push(`__set(c, sp(${names}), ${val});`);
        }
    }
    const ends = ['start', 'end', 'offset'].filter((e) => spec[e] !== undefined);
    if (ends.length) {
        if (type !== 'range') throw new Error(`'${where}': start, end and offset are Range selector settings`);
        L.push('var byIndex = sp(["ADBE Text Range Units", "Units"]).value === 2;');
        for (const e of ends) {
            const cap = e[0].toUpperCase() + e.slice(1);
            L.push(`__set(c, sp(byIndex ? ["ADBE Text Index ${cap}", "${cap}"] : ["ADBE Text Percent ${cap}", "${cap}"]), ${n(spec[e], `${where}.${e}`, -100000, 100000)});`);
        }
    }
    return L;
}

export const tools = [
    {
        name: 'add_text_layer',
        description: 'Add a text layer (Layer > New > Text, or the Horizontal and Vertical Type tools): point text, or paragraph text in a box, horizontal or vertical, optionally named and placed',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                text: { type: 'string', description: 'The text; line breaks start new lines' },
                kind: { type: 'string', enum: ['point', 'paragraph'], description: 'point text (default) or paragraph text in a box' },
                orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Horizontal Type tool (default) or Vertical Type tool' },
                boxSize: { type: 'array', items: { type: 'number' }, description: 'Paragraph text: [width, height] of the box in pixels. Default half the composition size' },
                position: { type: 'array', items: { type: 'number' }, description: '[x, y] in pixels from the composition\'s top-left' },
                name: { type: 'string', description: 'Layer name' },
            },
            required: ['text'],
        },
        auditArgs: { kind: 'paragraph', orientation: 'vertical', boxSize: [400, 200], position: [100, 100] },
        features: [
            'aftereffects.text.text_layer',
            'aftereffects.text.point_text',
            'aftereffects.text.paragraph_text',
            'aftereffects.text.horizontal_type_tool',
            'aftereffects.text.vertical_type_tool',
        ],
        handler: (a) => {
            if (typeof a.text !== 'string') throw new Error("'text' is required");
            const text = str(a.text.replace(/\r\n|\n/g, '\r'));
            const kind = enumOf(a.kind ?? 'point', ['point', 'paragraph'], { name: 'kind' });
            const orient = enumOf(a.orientation ?? 'horizontal', ['horizontal', 'vertical'], { name: 'orientation' });
            if (a.boxSize !== undefined && kind !== 'paragraph') throw new Error("'boxSize' is for paragraph text");
            const box = a.boxSize !== undefined ? pair(a.boxSize, 'boxSize', 1, 30000) : '[Math.round(c.width / 2), Math.round(c.height / 2)]';
            const make = {
                'point horizontal': `c.layers.addText(${text})`,
                'point vertical': `c.layers.addVerticalText(${text})`,
                'paragraph horizontal': `c.layers.addBoxText(${box}, ${text})`,
                'paragraph vertical': `(function () { var b = ${box}, x = c.layers.addVerticalBoxText(b[0], b[1]), p = __sourceText(x), td = p.value; td.text = ${text}; p.setValue(td); return x; })()`,
            }[`${kind} ${orient}`];
            return run('Add text layer', script(`${TEXT_HELPERS}
var c = __comp(${compSpec(a.comp)});
var l = ${make};
${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
${a.position !== undefined ? `l.property("ADBE Transform Group").property("ADBE Position").setValue(__fit(l.property("ADBE Transform Group").property("ADBE Position"), ${pair(a.position, 'position')}));` : ''}
var info = __layerInfo(l), v = __sourceText(l).value;
info.text = v.text; info.pointText = v.pointText; info.boxText = v.boxText;
__result__ = info;`, { undo: 'Add text layer' }));
        },
    },
    {
        name: 'set_text',
        description: 'Set a text layer\'s Source Text and formatting (Character and Paragraph panels) for the whole layer or a range of characters or paragraphs: font (by PostScript name, or family and style), size, fill and stroke, tracking, kerning, leading, scale, baseline shift and super/subscript, caps, ligatures, tsume, digits, indents, spacing, justification, composer, direction and orientation, step changes, and Reset Character/Paragraph. Applies at the current time if Source Text is animated',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                range: {
                    type: 'object',
                    description: 'Format only part of the text. Character options on a paragraph range apply to its characters; paragraph options apply to whole paragraphs. Omit for the whole layer',
                    properties: {
                        by: { type: 'string', enum: ['characters', 'paragraphs'], description: 'What start and end count' },
                        start: { type: 'integer', minimum: 0, description: '0-based first character or paragraph' },
                        end: { type: 'integer', minimum: 0, description: '0-based index just after the last one' },
                    },
                    required: ['by', 'start', 'end'],
                },
                text: { type: 'string', description: 'New text (with range: replaces the range); line breaks start new lines' },
                font: { type: 'string', description: 'PostScript font name (find_fonts lists them)' },
                fontFamily: { type: 'string', description: 'Font family, with fontStyle, chosen through the font list (app.fonts)' },
                fontStyle: { type: 'string', description: 'Font style with fontFamily, e.g. "Bold"' },
                fontSize: { type: 'number', minimum: 0.1, maximum: 1296, description: 'Pixels' },
                fillColor: { ...COLOR_SCHEMA, description: 'Fill colour; turns fill on' },
                strokeColor: { ...COLOR_SCHEMA, description: 'Stroke colour; turns stroke on' },
                applyFill: { type: 'boolean', description: 'false: No Fill Color' },
                applyStroke: { type: 'boolean', description: 'false: No Stroke Color' },
                strokeWidth: { type: 'number', minimum: 0, maximum: 1000, description: 'Pixels' },
                strokeOverFill: { type: 'boolean', description: 'true: Stroke Over Fill; false: Fill Over Stroke' },
                lineJoin: { type: 'string', enum: Object.keys(LINE_JOIN), description: 'Stroke line join' },
                tracking: { type: 'number', minimum: -1000, maximum: 10000, description: 'Thousandths of an em; 0 resets tracking' },
                kerning: { type: 'number', minimum: -1000, maximum: 10000, description: 'Manual kerning, thousandths of an em' },
                autoKerning: { type: 'string', enum: Object.keys(AUTO_KERN), description: 'Metrics or Optical kerning, or none' },
                leading: { type: 'number', minimum: 0, maximum: 5000, description: 'Pixels; turns auto leading off' },
                justification: { type: 'string', enum: Object.keys(JUSTIFY), description: 'Paragraph alignment' },
                fauxBold: { type: 'boolean', description: 'Faux Bold' }, fauxItalic: { type: 'boolean', description: 'Faux Italic' },
                allCaps: { type: 'boolean', description: 'All Caps' }, smallCaps: { type: 'boolean', description: 'Small Caps' },
                baselineShift: { type: 'number', minimum: -1000, maximum: 1000, description: 'Pixels' },
                baselineOption: { type: 'string', enum: Object.keys(BASELINE_OPTION), description: 'Superscript, Subscript or normal' },
                horizontalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent; 100 resets' },
                verticalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent; 100 resets' },
                tsume: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                ligatures: { type: 'boolean', description: 'Ligatures' },
                noBreak: { type: 'boolean', description: 'No Break' },
                digits: { type: 'string', enum: Object.keys(DIGITS), description: 'Digit set, e.g. hindi for Hindi Digits' },
                baselineDirection: { type: 'string', enum: Object.keys(BASELINE_DIRECTION), description: 'Vertical text: standard, rotated, or tate_chuu_yoko (Tate-Chuu-Yoko)' },
                startIndent: { type: 'number', minimum: -10000, maximum: 10000, description: 'Indent Left Margin, pixels' },
                endIndent: { type: 'number', minimum: -10000, maximum: 10000, description: 'Indent Right Margin, pixels' },
                firstLineIndent: { type: 'number', minimum: -10000, maximum: 10000, description: 'Indent First Line, pixels' },
                spaceBefore: { type: 'number', minimum: -10000, maximum: 10000, description: 'Space Before Paragraph, pixels' },
                spaceAfter: { type: 'number', minimum: -10000, maximum: 10000, description: 'Space After Paragraph, pixels' },
                hangingRoman: { type: 'boolean', description: 'Roman Hanging Punctuation' },
                composer: { type: 'string', enum: COMPOSER, description: 'Adobe Every-line or Single-line Composer' },
                leadingType: { type: 'string', enum: Object.keys(LEADING_TYPE), description: 'Top-To-Top or Bottom-To-Bottom Leading' },
                direction: { type: 'string', enum: Object.keys(DIRECTION), description: 'Paragraph text direction' },
                lineOrientation: { type: 'string', enum: Object.keys(LINE_ORIENTATION), description: 'Horizontal or vertical text' },
                universalTextEngine: { type: 'boolean', description: 'true: switch the layer to the Universal Text Engine (cannot be switched back by script)' },
                boxSize: { type: 'array', items: { type: 'number' }, description: 'Paragraph text: [width, height] of the box in pixels' },
                adjust: {
                    type: 'object',
                    description: 'Step changes added to the current values, as the Character panel shortcuts do (negative to decrease)',
                    properties: {
                        fontSize: { type: 'number', description: 'Pixels to add to the size' },
                        leading: { type: 'number', description: 'Pixels to add to the leading' },
                        baselineShift: { type: 'number', description: 'Pixels to add to the baseline shift' },
                        tracking: { type: 'number', description: 'Amount to add to tracking' },
                        kerning: { type: 'number', description: 'Amount to add to kerning' },
                    },
                },
                resetCharacter: { type: 'boolean', description: 'Reset Character first (Character panel menu)' },
                resetParagraph: { type: 'boolean', description: 'Reset Paragraph first (Paragraph panel menu)' },
            },
            required: ['layers'],
        },
        auditArgs: {
            fillColor: '#FFFFFF', strokeColor: 'rgb(0,0,0)', font: undefined, range: undefined,
            boxSize: [400, 200], universalTextEngine: true, adjust: { fontSize: 2, leading: -2, baselineShift: 1, tracking: 10, kerning: -5 },
        },
        hints: { idempotent: true },
        features: [
            'aftereffects.text.source_text',
            'aftereffects.text.font_family',
            'aftereffects.text.font_style',
            'aftereffects.text.font_size',
            'aftereffects.text.fill_color',
            'aftereffects.text.stroke_color',
            'aftereffects.text.stroke_width',
            'aftereffects.text.tracking',
            'aftereffects.text.leading',
            'aftereffects.text.auto_leading',
            'aftereffects.text.align_left',
            'aftereffects.text.align_center',
            'aftereffects.text.align_right',
            'aftereffects.text.justify_last_left',
            'aftereffects.text.justify_last_center',
            'aftereffects.text.justify_last_right',
            'aftereffects.text.justify_all',
            'aftereffects.text.faux_bold',
            'aftereffects.text.faux_italic',
            'aftereffects.text.all_caps',
            'aftereffects.text.small_caps',
            'aftereffects.text.baseline_shift',
            'aftereffects.text.horizontal_scale',
            'aftereffects.text.vertical_scale',
            'aftereffects.text.text_document',
            'aftereffects.text.character_range',
            'aftereffects.text.paragraph_range',
            'aftereffects.text.font_object',
            'aftereffects.text.paragraph_text',
            'aftereffects.text.text_orientation',
            'aftereffects.text.universal_text_engine',
            'aftereffects.text.reset_character',
            'aftereffects.text.reset_paragraph',
            'aftereffects.text.kerning',
            'aftereffects.text.auto_kerning',
            'aftereffects.text.tsume',
            'aftereffects.text.no_fill_no_stroke',
            'aftereffects.text.stroke_over_fill',
            'aftereffects.text.superscript',
            'aftereffects.text.subscript',
            'aftereffects.text.ligatures',
            'aftereffects.text.hindi_digits',
            'aftereffects.text.no_break',
            'aftereffects.text.line_join',
            'aftereffects.text.tate_chuu_yoko',
            'aftereffects.text.font_size_step',
            'aftereffects.text.leading_step',
            'aftereffects.text.baseline_shift_step',
            'aftereffects.text.kerning_tracking_step',
            'aftereffects.text.reset_tracking',
            'aftereffects.text.horizontal_scale_100',
            'aftereffects.text.vertical_scale_100',
            'aftereffects.text.indent_left_margin',
            'aftereffects.text.indent_right_margin',
            'aftereffects.text.indent_first_line',
            'aftereffects.text.space_before',
            'aftereffects.text.space_after',
            'aftereffects.text.roman_hanging_punctuation',
            'aftereffects.text.every_line_composer',
            'aftereffects.text.single_line_composer',
            'aftereffects.text.leading_measurement',
            'aftereffects.text.text_direction',
        ],
        handler: (a) => {
            const L = [];
            if (a.resetCharacter) L.push('t.resetCharStyle();');
            if (a.resetParagraph) L.push('t.resetParagraphStyle();');
            if (a.universalTextEngine !== undefined) {
                if (a.universalTextEngine !== true) throw new Error("'universalTextEngine' can only be true: a layer cannot be switched back to the Latin/CJK engine");
                L.push('td.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE;');
            }
            if (a.text !== undefined) L.push(`t.text = ${str(String(a.text).replace(/\r\n|\n/g, '\r'))};`);
            if (a.font !== undefined) L.push(`t.font = ${str(a.font)};`);
            if ((a.fontFamily === undefined) !== (a.fontStyle === undefined)) throw new Error('Give fontFamily and fontStyle together');
            if (a.fontFamily !== undefined) {
                if (a.font !== undefined) throw new Error('Give font or fontFamily and fontStyle, not both');
                L.push(`var fo = app.fonts.getFontsByFamilyNameAndStyleName(${str(a.fontFamily)}, ${str(a.fontStyle)}); if (!fo || !fo.length) throw new Error(${str(`No font ${a.fontFamily} ${a.fontStyle}`)}); t.fontObject = fo[0];`);
            }
            if (a.fontSize !== undefined) L.push(`t.fontSize = ${num(a.fontSize, { min: 0.1, max: 1296, name: 'fontSize' })};`);
            if (a.fillColor !== undefined) L.push(`t.applyFill = true; t.fillColor = ${colorValue(a.fillColor, 'fillColor')};`);
            if (a.strokeColor !== undefined) L.push(`t.applyStroke = true; t.strokeColor = ${colorValue(a.strokeColor, 'strokeColor')};`);
            for (const k of ['applyFill', 'applyStroke']) if (a[k] !== undefined) L.push(`t.${k} = ${bool(a[k])};`);
            if (a.strokeWidth !== undefined) L.push(`t.strokeWidth = ${num(a.strokeWidth, { min: 0, max: 1000, name: 'strokeWidth' })};`);
            if (a.lineJoin !== undefined) L.push(`t.lineJoinType = LineJoinType.${pick(LINE_JOIN, a.lineJoin, 'lineJoin')};`);
            if (a.tracking !== undefined) L.push(`t.tracking = ${num(a.tracking, { min: -1000, max: 10000, name: 'tracking' })};`);
            if (a.autoKerning !== undefined) L.push(`t.autoKernType = AutoKernType.${pick(AUTO_KERN, a.autoKerning, 'autoKerning')};`);
            if (a.kerning !== undefined) L.push(`t.kerning = ${num(a.kerning, { min: -1000, max: 10000, name: 'kerning' })};`);
            if (a.leading !== undefined) L.push(`t.autoLeading = false; t.leading = ${num(a.leading, { min: 0, max: 5000, name: 'leading' })};`);
            if (a.justification !== undefined) L.push(`t.justification = ParagraphJustification.${pick(JUSTIFY, a.justification, 'justification')};`);
            for (const k of ['fauxBold', 'fauxItalic', 'allCaps', 'smallCaps', 'strokeOverFill', 'ligatures', 'noBreak', 'hangingRoman']) if (a[k] !== undefined) L.push(`t.${k} = ${bool(a[k])};`);
            if (a.baselineShift !== undefined) L.push(`t.baselineShift = ${num(a.baselineShift, { min: -1000, max: 1000, name: 'baselineShift' })};`);
            if (a.baselineOption !== undefined) L.push(`t.fontBaselineOption = FontBaselineOption.${pick(BASELINE_OPTION, a.baselineOption, 'baselineOption')};`);
            if (a.horizontalScale !== undefined) L.push(`t.horizontalScale = ${num(a.horizontalScale, { min: 1, max: 1000, name: 'horizontalScale' })} / 100;`);
            if (a.verticalScale !== undefined) L.push(`t.verticalScale = ${num(a.verticalScale, { min: 1, max: 1000, name: 'verticalScale' })} / 100;`);
            if (a.tsume !== undefined) L.push(`t.tsume = ${num(a.tsume, { min: 0, max: 100, name: 'tsume' })};`);
            if (a.digits !== undefined) L.push(`t.digitSet = DigitSet.${pick(DIGITS, a.digits, 'digits')};`);
            if (a.baselineDirection !== undefined) L.push(`t.baselineDirection = BaselineDirection.${pick(BASELINE_DIRECTION, a.baselineDirection, 'baselineDirection')};`);
            for (const k of ['startIndent', 'endIndent', 'firstLineIndent', 'spaceBefore', 'spaceAfter']) if (a[k] !== undefined) L.push(`t.${k} = ${num(a[k], { min: -10000, max: 10000, name: k })};`);
            if (a.composer !== undefined) L.push(`t.everyLineComposer = ${bool(enumOf(a.composer, COMPOSER, { name: 'composer' }) === 'every_line')};`);
            if (a.leadingType !== undefined) L.push(`t.leadingType = LeadingType.${pick(LEADING_TYPE, a.leadingType, 'leadingType')};`);
            if (a.direction !== undefined) L.push(`t.direction = ParagraphDirection.${pick(DIRECTION, a.direction, 'direction')};`);
            if (a.lineOrientation !== undefined) L.push(`td.lineOrientation = LineOrientation.${pick(LINE_ORIENTATION, a.lineOrientation, 'lineOrientation')};`);
            if (a.boxSize !== undefined) L.push(`if (!td.boxText) throw new Error(ls[i].name + " is point text: boxSize needs paragraph text"); td.boxTextSize = ${pair(a.boxSize, 'boxSize', 1, 30000)};`);
            if (a.adjust !== undefined) {
                const d = a.adjust;
                if (!d || typeof d !== 'object') throw new Error("'adjust' must be an object");
                const steps = {
                    fontSize: (v) => `t.fontSize = Math.max(0.1, Math.min(1296, t.fontSize + ${v}));`,
                    leading: (v) => `t.autoLeading = false; t.leading = Math.max(0, t.leading + ${v});`,
                    baselineShift: (v) => `t.baselineShift = t.baselineShift + ${v};`,
                    tracking: (v) => `t.tracking = t.tracking + ${v};`,
                    kerning: (v) => `t.kerning = t.kerning + ${v};`,
                };
                for (const [k, v] of Object.entries(d)) {
                    if (!steps[k]) throw new Error(`'adjust': unknown ${k}. Use ${Object.keys(steps).join(', ')}`);
                    if (v !== undefined) L.push(steps[k](n(v, `adjust.${k}`, -10000, 10000)));
                }
            }
            if (!L.length) throw new Error('Give text or formatting');
            let target = 'var t = td;';
            if (a.range !== undefined) {
                const r = a.range ?? {};
                const by = enumOf(r.by, ['characters', 'paragraphs'], { name: 'range.by' });
                const s = index(r.start, { name: 'range.start', max: 1e7 });
                const e = index(r.end, { name: 'range.end', max: 1e7 });
                if (Number(e) < Number(s) || (Number(e) === Number(s) && (by === 'paragraphs' || a.text === undefined))) throw new Error("'range.end' must be after 'range.start'");
                if (a.universalTextEngine || a.lineOrientation !== undefined || a.boxSize !== undefined) throw new Error('universalTextEngine, lineOrientation and boxSize apply to the whole layer: omit range');
                target = by === 'characters'
                    ? `if (${e} > td.text.length) throw new Error(ls[i].name + " has " + td.text.length + " characters"); var t = td.characterRange(${s}, ${e});`
                    : `if (${e} > td.paragraphCount) throw new Error(ls[i].name + " has " + td.paragraphCount + " paragraphs"); var t = td.paragraphRange(${s}, ${e});`;
            }
            return run('Set text', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof TextLayer)) throw new Error(ls[i].name + " is not a text layer");
  var p = ls[i].property("ADBE Text Properties").property("ADBE Text Document"), td = p.value;
  ${target}
  ${L.join('\n  ')}
  if (p.numKeys > 0) p.setValueAtTime(c.time, td); else p.setValue(td);
  var v = p.value;
  out.push({ layer: ls[i].index, text: v.text, font: v.font, fontSize: v.fontSize });
}
__result__ = { layers: out };`, { undo: 'Set text' }));
        },
    },
    {
        name: 'get_text',
        description: 'Read text layers\' Source Text: text, font (with its PostScript name, family, style and variable axes), character and paragraph formatting, point or paragraph text and box size, and where each paragraph and composed line starts and ends',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA }, required: ['layers'] },
        hints: { readOnly: true },
        features: [
            'aftereffects.text.text_document',
            'aftereffects.text.paragraph_range',
            'aftereffects.text.composed_line_range',
            'aftereffects.text.font_object',
        ],
        handler: (a) => run('Get text', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof TextLayer)) throw new Error(ls[i].name + " is not a text layer");
  var td = ls[i].property("ADBE Text Properties").property("ADBE Text Document").value, k;
  var info = { layer: ls[i].index, text: td.text, font: td.font, fontFamily: td.fontFamily, fontStyle: td.fontStyle, fontSize: td.fontSize,
    applyFill: td.applyFill, fillColor: td.applyFill ? td.fillColor : null, applyStroke: td.applyStroke, strokeColor: td.applyStroke ? td.strokeColor : null,
    strokeWidth: td.strokeWidth, strokeOverFill: td.strokeOverFill, tracking: td.tracking, autoLeading: td.autoLeading, leading: td.leading,
    justification: __enumName(td.justification), fauxBold: td.fauxBold, fauxItalic: td.fauxItalic, allCaps: td.allCaps, smallCaps: td.smallCaps,
    baselineShift: td.baselineShift, horizontalScale: td.horizontalScale * 100, verticalScale: td.verticalScale * 100,
    pointText: td.pointText, boxText: td.boxText, boxSize: td.boxText ? td.boxTextSize : null };
  try {
    info.kerning = td.kerning; info.autoKerning = __enumName(td.autoKernType); info.tsume = td.tsume; info.ligatures = td.ligatures; info.noBreak = td.noBreak;
    info.superscript = td.superscript; info.subscript = td.subscript; info.digits = __enumName(td.digitSet); info.lineJoin = __enumName(td.lineJoinType);
    info.baselineDirection = __enumName(td.baselineDirection); info.startIndent = td.startIndent; info.endIndent = td.endIndent; info.firstLineIndent = td.firstLineIndent;
    info.spaceBefore = td.spaceBefore; info.spaceAfter = td.spaceAfter; info.hangingRoman = td.hangingRoman; info.everyLineComposer = td.everyLineComposer;
    info.leadingType = __enumName(td.leadingType); info.direction = __enumName(td.direction); info.lineOrientation = __enumName(td.lineOrientation);
    info.composerEngine = __enumName(td.composerEngine);
  } catch (e) {}
  try {
    var fo = td.fontObject;
    info.fontObject = { postScriptName: fo.postScriptName, familyName: fo.familyName, styleName: fo.styleName, hasDesignAxes: fo.hasDesignAxes,
      designAxes: fo.hasDesignAxes ? fo.designAxesData : null, isSubstitute: fo.isSubstitute, isFromAdobeFonts: fo.isFromAdobeFonts };
  } catch (e) {}
  try {
    var paras = [];
    for (k = 0; k < td.paragraphCount && k < 500; k++) { var pr = td.paragraphRange(k, k + 1); paras.push({ index: k, start: pr.characterStart, end: pr.characterEnd }); }
    info.paragraphs = paras;
    var lines = [];
    for (k = 0; k < td.composedLineCount && k < 500; k++) { var lr = td.composedLineRange(k, k + 1); lines.push({ index: k, start: lr.characterStart, end: lr.characterEnd, text: td.text.substring(lr.characterStart, lr.characterEnd) }); }
    info.lines = lines;
  } catch (e) {}
  out.push(info);
}
__result__ = { layers: out };`)),
    },
    {
        name: 'find_fonts',
        description: 'Search the fonts After Effects can use (Character panel font menu, app.fonts) by name, or list only variable fonts or missing and substituted fonts. Returns PostScript names for set_text, families and styles, variable font axes, and the favourite and recent font lists',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Text to find in the family, style, full or PostScript name; omit for all' },
                variableOnly: { type: 'boolean', description: 'Only variable fonts (with design axes)' },
                missing: { type: 'boolean', description: 'List the project\'s missing or substituted fonts instead' },
                limit: { type: 'integer', minimum: 1, maximum: 2000, description: 'Most fonts to return. Default 200' },
            },
        },
        auditArgs: { missing: false },
        hints: { readOnly: true },
        features: [
            'aftereffects.text.fonts_object',
            'aftereffects.text.font_object',
            'aftereffects.text.variable_font_axes',
            'aftereffects.text.recent_fonts',
        ],
        handler: (a) => {
            const limit = a.limit !== undefined ? index(a.limit, { name: 'limit', max: 2000 }) : '200';
            return run('Find fonts', script(`
var info = function (f) { return { postScriptName: f.postScriptName, family: f.familyName, style: f.styleName, fullName: f.fullName,
  variable: f.hasDesignAxes, axes: f.hasDesignAxes ? f.designAxesData : null, substitute: f.isSubstitute, adobeFonts: f.isFromAdobeFonts }; };
var q = ${str(String(a.query ?? '').toLowerCase())}, out = [], total = 0, i, j, f;
${a.missing ? `var m = app.fonts.missingOrSubstitutedFonts;
for (i = 0; i < m.length; i++) { total++; if (out.length < ${limit}) out.push(info(m[i])); }` : `var all = app.fonts.allFonts;
for (i = 0; i < all.length; i++) for (j = 0; j < all[i].length; j++) {
  f = all[i][j];
  if (q && (f.familyName + " " + f.styleName + " " + f.fullName + " " + f.postScriptName).toLowerCase().indexOf(q) < 0) continue;
  ${a.variableOnly ? 'if (!f.hasDesignAxes) continue;' : ''}
  total++;
  if (out.length < ${limit}) out.push(info(f));
}`}
var fav = null, recent = null;
try { fav = app.fonts.favoriteFontFamilyList; recent = app.fonts.mruFontFamilyList; } catch (e) {}
__result__ = { total: total, fonts: out, favorites: fav, recent: recent };`));
        },
    },
    {
        name: 'set_font_options',
        description: 'Set the favourite font families shown in the Character panel font menu, or have After Effects rescan font folders outside the system ones (such as the Adobe local Fonts folder) for added or removed fonts',
        inputSchema: {
            type: 'object',
            properties: {
                favorites: { type: 'array', items: { type: 'string' }, maxItems: 1000, description: 'Font family names: replaces the favourites list' },
                rescanFontFolders: { type: 'boolean', description: 'Rescan non-system font folders' },
            },
        },
        auditArgs: { favorites: ['Arial', 'Helvetica'] },
        hints: { idempotent: true },
        features: ['aftereffects.text.font_favorites', 'aftereffects.text.local_fonts_folder'],
        handler: (a) => {
            const L = [];
            if (a.favorites !== undefined) {
                if (!Array.isArray(a.favorites)) throw new Error("'favorites' must be a list of font family names");
                L.push(`app.fonts.favoriteFontFamilyList = ${json(a.favorites.map(String))};`);
            }
            if (a.rescanFontFolders) L.push('changed = app.fonts.pollForAndPushNonSystemFontFoldersChanges();');
            if (!L.length) throw new Error('Give favorites or rescanFontFolders: true');
            return run('Font options', script(`
var changed = null;
${L.join('\n')}
__result__ = { favorites: app.fonts.favoriteFontFamilyList, fontFoldersChanged: changed };`));
        },
    },
    {
        name: 'set_text_options',
        description: 'Set a text layer\'s Path Options (text on a mask path: Reverse Path, Perpendicular To Path, Force Alignment, First and Last Margin), More Options (Anchor Point Grouping, Grouping Alignment, Fill & Stroke, Inter-Character Blending, Variable Font Spacing), Enable Per-character 3D (Animation menu) and Orient Each Character Independently (Layer > Transform > Auto-Orient)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                path: { type: 'integer', minimum: 0, description: 'Path Options > Path: the index of a mask on the same layer; 0 for none' },
                reversePath: { type: 'boolean', description: 'Path Options > Reverse Path' },
                perpendicularToPath: { type: 'boolean', description: 'Path Options > Perpendicular To Path' },
                forceAlignment: { type: 'boolean', description: 'Path Options > Force Alignment' },
                firstMargin: { type: 'number', description: 'Path Options > First Margin, pixels' },
                lastMargin: { type: 'number', description: 'Path Options > Last Margin, pixels' },
                anchorPointGrouping: { type: 'string', enum: ['character', 'word', 'line', 'all'], description: 'More Options > Anchor Point Grouping' },
                groupingAlignment: { type: 'array', items: { type: 'number' }, description: 'More Options > Grouping Alignment, [x, y] percent' },
                fillAndStroke: { type: 'string', enum: ['per_character', 'all_fills_over_all_strokes', 'all_strokes_over_all_fills'], description: 'More Options > Fill & Stroke (needs per-character 3D off)' },
                interCharacterBlending: { type: 'integer', minimum: 1, maximum: 40, description: 'More Options > Inter-Character Blending: 1-based position in its blending mode menu (1 = Normal)' },
                variableFontSpacing: { type: 'integer', minimum: 1, maximum: 10, description: 'More Options > Variable Font Spacing: 1-based position in its menu; present only when a variable font axis is animated' },
                perCharacter3D: { type: 'boolean', description: 'Enable Per-character 3D' },
                orientCharacters: { type: 'boolean', description: 'true: Orient Each Character Independently toward the camera (turns on per-character 3D); false: turn it off' },
            },
            required: ['layers'],
        },
        auditArgs: { path: 1, groupingAlignment: [0, -50], interCharacterBlending: 1, variableFontSpacing: 1 },
        hints: { idempotent: true },
        features: [
            'aftereffects.text.text_on_path',
            'aftereffects.text.reverse_path',
            'aftereffects.text.perpendicular_to_path',
            'aftereffects.text.force_alignment',
            'aftereffects.text.first_margin',
            'aftereffects.text.last_margin',
            'aftereffects.text.anchor_point_grouping',
            'aftereffects.text.grouping_alignment',
            'aftereffects.text.all_fills_over_all_strokes',
            'aftereffects.text.inter_character_blending',
            'aftereffects.text.variable_font_spacing',
            'aftereffects.text.enable_per_character_3d',
            'aftereffects.text.orient_each_character',
        ],
        handler: (a) => {
            const L = [];
            if (a.orientCharacters === true || a.perCharacter3D !== undefined) L.push(`l.threeDPerChar = ${bool(a.orientCharacters === true || a.perCharacter3D)};`);
            if (a.orientCharacters === true && a.perCharacter3D === false) throw new Error('orientCharacters needs per-character 3D');
            if (a.orientCharacters === true) L.push('l.autoOrient = AutoOrientType.CHARACTERS_TOWARD_CAMERA;');
            if (a.orientCharacters === false) L.push('if (l.autoOrient === AutoOrientType.CHARACTERS_TOWARD_CAMERA) l.autoOrient = AutoOrientType.NO_AUTO_ORIENT;');
            if (a.path !== undefined) {
                const m = index(a.path, { name: 'path', max: 1000 });
                L.push(`if (${m} > l.property("ADBE Mask Parade").numProperties) throw new Error(l.name + " has no mask ${m}");`, `__set(c, l.text.pathOption.path, ${m});`);
            }
            const pathProps = { reversePath: 'ADBE Text Reverse Path', perpendicularToPath: 'ADBE Text Perpendicular To Path', forceAlignment: 'ADBE Text Force Align Path' };
            for (const [k, m] of Object.entries(pathProps)) if (a[k] !== undefined) L.push(`__set(c, l.property("ADBE Text Properties").property("ADBE Text Path Options").property(${str(m)}), ${a[k] ? 1 : 0});`);
            if (a.firstMargin !== undefined) L.push(`__set(c, l.property("ADBE Text Properties").property("ADBE Text Path Options").property("ADBE Text First Margin"), ${n(a.firstMargin, 'firstMargin')});`);
            if (a.lastMargin !== undefined) L.push(`__set(c, l.property("ADBE Text Properties").property("ADBE Text Path Options").property("ADBE Text Last Margin"), ${n(a.lastMargin, 'lastMargin')});`);
            const menu = (list, v, name) => list.indexOf(enumOf(v, list, { name })) + 1;
            if (a.anchorPointGrouping !== undefined) L.push(`__set(c, l.text.moreOption.anchorPointGrouping, ${menu(['character', 'word', 'line', 'all'], a.anchorPointGrouping, 'anchorPointGrouping')});`);
            if (a.groupingAlignment !== undefined) L.push(`__set(c, l.text.moreOption.groupingAlignment, ${pair(a.groupingAlignment, 'groupingAlignment', -10000, 10000)});`);
            if (a.fillAndStroke !== undefined) L.push(`if (l.threeDPerChar) throw new Error(l.name + ": Fill & Stroke is unavailable with per-character 3D"); __set(c, l.text.moreOption.fillANdStroke, ${menu(['per_character', 'all_fills_over_all_strokes', 'all_strokes_over_all_fills'], a.fillAndStroke, 'fillAndStroke')});`);
            if (a.interCharacterBlending !== undefined) L.push(`if (l.threeDPerChar) throw new Error(l.name + ": Inter-Character Blending is unavailable with per-character 3D"); __set(c, l.text.moreOption.interCharacterBlending, ${num(a.interCharacterBlending, { min: 1, max: 40, name: 'interCharacterBlending' })});`);
            if (a.variableFontSpacing !== undefined) L.push(`var vfs = l.property("ADBE Text Properties").property("ADBE Text More Options").property("ADBE Text Variable Font Spacing"); if (!vfs) throw new Error(l.name + ": Variable Font Spacing appears only when a variable font axis is animated"); __set(c, vfs, ${num(a.variableFontSpacing, { min: 1, max: 10, name: 'variableFontSpacing' })});`);
            if (!L.length) throw new Error('Give at least one option');
            return run('Text options', script(`${TEXT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var l = __textLayer(ls[i]);
  ${L.join('\n  ')}
  out.push({ layer: l.index, perCharacter3D: l.threeDPerChar, autoOrient: __enumName(l.autoOrient) });
}
__result__ = { layers: out };`, { undo: 'Text options' }));
        },
    },
    {
        name: 'set_text_animator',
        description: 'Add a text animator (Animation > Animate Text) with its properties (position, scale, rotation, opacity, fill colour, tracking, blur, character value, variable font axes, All Transform Properties...) and selectors (Animation > Add Text Selector: Range, Wiggly, Expression) with their settings; or add properties and selectors to an existing animator, or change an existing selector. A new animator without selectors gets a Range selector, as in the Animate menu',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                animator: { description: 'An existing animator to change: its 1-based index or name (list_text_animators). Omit to add a new animator', oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }] },
                name: { type: 'string', description: 'Name for the animator' },
                properties: {
                    type: 'object',
                    description: `Animator properties to add (or set, when already there), each to a value or true for its default. Numbers or [x, y, z] arrays; *_color take "#RRGGBB". Keys: ${Object.keys(ANIM_PROPS).join(', ')}, all_transform (true: All Transform Properties)`,
                    additionalProperties: {},
                },
                fontAxes: {
                    type: 'array',
                    description: 'Variable font axes to animate (Animate Text > Variable Font Axes)',
                    items: {
                        type: 'object',
                        properties: {
                            tag: { type: 'string', description: 'Four-letter axis tag, e.g. "wght" or "wdth" (find_fonts lists a font\'s axes)' },
                            value: { type: 'number', description: 'Axis value; omit for the default' },
                        },
                        required: ['tag'],
                    },
                },
                selectors: {
                    type: 'array',
                    description: 'Selectors to add, or with selector: n, to change',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: Object.keys(SELECTOR_TYPES), description: 'range, wiggly or expression' },
                            selector: { type: 'integer', minimum: 1, description: 'Change the animator\'s existing selector at this 1-based index instead of adding one' },
                            start: { type: 'number', description: 'Range: Start, percent or index depending on units' },
                            end: { type: 'number', description: 'Range: End' },
                            offset: { type: 'number', description: 'Range: Offset' },
                            ...Object.fromEntries(Object.entries(SELECTOR_KEYS).map(([k, d]) => [k, {
                                ...(d.menu ? { type: 'string', enum: d.menu } : d.bool ? { type: 'boolean' } : d.text ? { type: 'string' } : { type: 'number' }),
                                description: d.description,
                            }])),
                        },
                        required: ['type'],
                    },
                },
            },
            required: ['layers'],
        },
        auditArgs: {
            animator: undefined,
            properties: { position: [0, -100], opacity: 0, fill_color: '#FF0000', all_transform: true, blur: true },
            fontAxes: [{ tag: 'wght', value: 700 }],
            selectors: [
                { type: 'range', units: 'index', start: 0, end: 3, offset: 1, basedOn: 'words', mode: 'subtract', amount: 50, shape: 'ramp_up', smoothness: 50, easeHigh: 20, easeLow: -20, randomizeOrder: true, randomSeed: 3 },
                { type: 'wiggly', mode: 'intersect', maxAmount: 80, minAmount: -80, basedOn: 'characters', wigglesPerSecond: 2, correlation: 50, temporalPhase: 0, spatialPhase: 90, lockDimensions: true, randomSeed: 1 },
                { type: 'expression', basedOn: 'lines', expression: 'selectorValue * textIndex/textTotal' },
                { type: 'range', selector: 1, amount: 100 },
            ],
        },
        features: [
            'aftereffects.text.text_animator_group',
            'aftereffects.text.animate_anchor_point',
            'aftereffects.text.animate_position',
            'aftereffects.text.animate_scale',
            'aftereffects.text.animate_skew',
            'aftereffects.text.animate_rotation',
            'aftereffects.text.animate_opacity',
            'aftereffects.text.animate_all_transform',
            'aftereffects.text.animate_line_anchor',
            'aftereffects.text.animate_line_spacing',
            'aftereffects.text.animate_character_offset',
            'aftereffects.text.animate_character_value',
            'aftereffects.text.animate_blur',
            'aftereffects.text.animate_tracking',
            'aftereffects.text.animate_fill_color',
            'aftereffects.text.animate_variable_font_axes',
            'aftereffects.text.variable_font_axes',
            'aftereffects.text.add_text_selector',
            'aftereffects.text.range_selector',
            'aftereffects.text.wiggly_selector',
            'aftereffects.text.expression_selector',
            'aftereffects.text.selector_mode',
            'aftereffects.text.selector_amount',
            'aftereffects.text.selector_units_based_on',
            'aftereffects.text.selector_shape',
            'aftereffects.text.selector_smoothness',
            'aftereffects.text.selector_ease',
            'aftereffects.text.selector_randomize_order',
        ],
        handler: (a) => {
            const L = [];
            const props = a.properties ?? {};
            if (typeof props !== 'object' || Array.isArray(props)) throw new Error("'properties' must be an object of property: value");
            const entries = [];
            if (props.all_transform !== undefined) {
                if (props.all_transform !== true) throw new Error("'properties.all_transform' takes true");
                for (const k of ALL_TRANSFORM) entries.push([k, props[k] ?? true]);
            }
            for (const [k, v] of Object.entries(props)) if (k !== 'all_transform' && !(props.all_transform && ALL_TRANSFORM.includes(k))) entries.push([k, v]);
            for (const [k, v] of entries) {
                const def = ANIM_PROPS[k];
                if (!def) throw new Error(`'properties': unknown ${k}. Use ${Object.keys(ANIM_PROPS).join(', ')}, all_transform`);
                const value = v === true ? null : def.color ? colorValue(v, `properties.${k}`) : vec(v, `properties.${k}`);
                L.push(`var p = __animProps(l, ai).property(${str(def.m)}); if (!p) { if (!__animProps(l, ai).canAddProperty(${str(def.m)})) throw new Error(${str(`Cannot add ${k} to this animator${/^[xy]_rotation$/.test(k) ? ': X and Y Rotation need per-character 3D' : ''}`)}); p = __animProps(l, ai).addProperty(${str(def.m)}); }`);
                if (value !== null) L.push(`__set(c, p, ${value});`);
            }
            for (const [k, ax] of (a.fontAxes ?? []).entries()) {
                if (!ax || typeof ax.tag !== 'string' || !/^[A-Za-z0-9 ]{4}$/.test(ax.tag)) throw new Error(`'fontAxes[${k}].tag' must be a four-letter axis tag, e.g. "wght"`);
                L.push(`var ax = __animProps(l, ai).addVariableFontAxis(${str(ax.tag)});`);
                if (ax.value !== undefined) L.push(`__set(c, ax, ${n(ax.value, `fontAxes[${k}].value`)});`);
            }
            const sels = a.selectors ?? [];
            if (!Array.isArray(sels)) throw new Error("'selectors' must be a list");
            for (const [k, spec] of sels.entries()) L.push(`(function () {\n    ${selectorBlock(spec, k).join('\n    ')}\n  })();`);
            let find;
            if (a.animator === undefined) {
                find = 'var ai = __animators(l).addProperty("ADBE Text Animator").propertyIndex, isNew = true;';
            } else {
                const key = typeof a.animator === 'number' ? index(a.animator, { name: 'animator', max: 1000 }) : str(a.animator);
                if (key === '0') throw new Error("'animator' is 1-based");
                find = `var found = __animators(l).property(${key}); if (!found) throw new Error(l.name + " has no animator " + ${str(String(a.animator))}); var ai = found.propertyIndex, isNew = false;`;
            }
            if (!L.length && a.name === undefined && a.animator !== undefined) throw new Error('Give properties, fontAxes, selectors or name to change');
            return run('Text animator', script(`${TEXT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var l = __textLayer(ls[i]);
  ${find}
  ${a.name !== undefined ? `__animators(l).property(ai).name = ${str(a.name)};` : ''}
  ${L.join('\n  ')}
  ${sels.length ? '' : 'if (isNew && __animSels(l, ai).numProperties === 0) __animSels(l, ai).addProperty("ADBE Text Selector");'}
  var info = __animInfo(l, ai); info.layer = l.index; out.push(info);
}
__result__ = { animators: out };`, { undo: 'Text animator' }));
        },
    },
    {
        name: 'list_text_animators',
        description: 'List text layers\' animators (Text > Animator groups) with their properties and values and their selectors',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA, layers: LAYERS_SCHEMA }, required: ['layers'] },
        hints: { readOnly: true },
        features: ['aftereffects.text.text_animator_group'],
        handler: (a) => run('List text animators', script(`${TEXT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var l = __textLayer(ls[i]), list = [];
  for (var k = 1; k <= __animators(l).numProperties; k++) list.push(__animInfo(l, k));
  out.push({ layer: l.index, animators: list });
}
__result__ = { layers: out };`)),
    },
    {
        name: 'remove_text_animators',
        description: 'Remove text animators from text layers: chosen ones by index or name, or all of them (Animation > Remove All Text Animators)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                animators: { type: 'array', items: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }] }, description: 'Animators to remove: 1-based indexes or names' },
                all: { type: 'boolean', description: 'Remove every animator' },
            },
            required: ['layers'],
        },
        auditArgs: { animators: [1, 'Animator 2'], all: undefined },
        hints: { destructive: true },
        features: ['aftereffects.text.remove_all_text_animators'],
        handler: (a) => {
            const all = a.all === true;
            const list = a.animators ?? [];
            if (all === (list.length > 0)) throw new Error('Give animators, or all: true');
            const keys = list.map((x, k) => typeof x === 'number' ? Number(index(x, { name: `animators[${k}]`, max: 1000 })) : String(x));
            if (keys.includes(0)) throw new Error("'animators' are 1-based");
            return run('Remove text animators', script(`${TEXT_HELPERS}
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), keys = ${json(keys)}, out = [];
for (var i = 0; i < ls.length; i++) {
  var l = __textLayer(ls[i]), idx = [], k;
  ${all ? 'for (k = 1; k <= __animators(l).numProperties; k++) idx.push(k);' : `for (k = 0; k < keys.length; k++) {
    var an = __animators(l).property(keys[k]);
    if (!an) throw new Error(l.name + " has no animator " + keys[k]);
    idx.push(an.propertyIndex);
  }`}
  idx.sort(function (x, y) { return y - x; });
  for (k = 0; k < idx.length; k++) if (k === 0 || idx[k] !== idx[k - 1]) __animators(l).property(idx[k]).remove();
  out.push({ layer: l.index, removed: idx.length, remaining: __animators(l).numProperties });
}
__result__ = { layers: out };`, { undo: 'Remove text animators' }));
        },
    },
    {
        name: 'convert_text_layers',
        description: 'Convert layers with a Layer menu command: Create Shapes from Text (new shape layers with the outlines), Create Masks from Text (a solid with a mask per character), or Convert to Editable Text (Photoshop text layers to After Effects text). Selects the layers and runs the command in their composition',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                action: { type: 'string', enum: ['shapes', 'masks', 'editable'], description: 'shapes: Create Shapes from Text; masks: Create Masks from Text; editable: Convert to Editable Text' },
            },
            required: ['layers', 'action'],
        },
        features: [
            'aftereffects.text.create_shapes_from_text',
            'aftereffects.text.create_masks_from_text',
            'aftereffects.text.convert_to_editable_text',
        ],
        handler: (a) => {
            const action = enumOf(a.action, ['shapes', 'masks', 'editable'], { name: 'action' });
            const id = { shapes: 3781, masks: 2933, editable: 3799 }[action];
            return run('Convert text', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), k;
${action === 'editable' ? '' : 'for (k = 0; k < ls.length; k++) if (!(ls[k] instanceof TextLayer)) throw new Error(ls[k].name + " is not a text layer");'}
c.openInViewer();
for (k = 1; k <= c.numLayers; k++) c.layer(k).selected = false;
for (k = 0; k < ls.length; k++) ls[k].selected = true;
app.executeCommand(${id});
var out = [];
for (k = 1; k <= c.numLayers; k++) out.push(__layerInfo(c.layer(k)));
__result__ = { command: ${id}, layers: out };`, { undo: 'Convert text' }));
        },
    },
    {
        name: 'show_text_panels',
        description: 'Show the Character or Paragraph panel (Window > Character, Window > Paragraph), or toggle both text panels',
        inputSchema: {
            type: 'object',
            properties: { panel: { type: 'string', enum: ['character', 'paragraph', 'toggle'], description: 'character, paragraph, or toggle (show or hide both)' } },
            required: ['panel'],
        },
        features: ['aftereffects.text.character_panel', 'aftereffects.text.paragraph_panel', 'aftereffects.text.toggle_text_panels'],
        handler: (a) => {
            const id = { character: 3011, paragraph: 3012, toggle: 3013 }[enumOf(a.panel, ['character', 'paragraph', 'toggle'], { name: 'panel' })];
            return run('Text panels', script(`app.executeCommand(${id});\n__result__ = { command: ${id} };`));
        },
    },
];
