/**
 * Text frames and stories: Text Frame Options, Text Wrap, notes, track
 * changes, threading, type on a path, Story Editor, editorial preferences and
 * moving the text cursor.
 */
import { enumOf, json, num, str, bool } from 'adobe-mcp-core';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec, COLOR_SCHEMA, colorSpec } from './run.js';

const has = (v) => v !== undefined && v !== null;

/** A page item, story or note id: an integer from 0 to 2^31. */
function id(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 2147483647) throw new Error(`Invalid id for '${name}': ${JSON.stringify(value)}`);
    return String(n);
}

/** A list of ids, at least `min` long. */
function ids(list, name, min = 1) {
    if (!Array.isArray(list) || list.length < min) throw new Error(`'${name}' needs at least ${min} id${min > 1 ? 's' : ''}`);
    return list.map((v) => id(v, name));
}

/** A length in millimetres. */
const mm = (v, name, min = 0, max = 5000) => num(v, { name, min, max });

/** A snake_case choice mapped to an InDesign enum member: `Enum.MEMBER`. */
function pick(value, map, name) {
    return map[enumOf(value, Object.keys(map), { name })];
}

/** Keys of an option object that are set. */
const given = (o) => Object.keys(o ?? {}).filter((k) => has(o[k]));

/** Refuse option keys a group does not know. */
function known(o, keys, name) {
    for (const k of Object.keys(o ?? {})) {
        if (!keys.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Known: ${keys.join(', ')}`);
    }
}

const UI_COLORS = ['BLACK', 'BLUE', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CHARCOAL', 'CUTE_TEAL', 'CYAN', 'DARK_BLUE', 'DARK_GREEN', 'FIESTA', 'GOLD', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE', 'GRID_GREEN', 'GRID_ORANGE', 'LAVENDER', 'LIGHT_BLUE', 'LIGHT_GRAY', 'LIGHT_OLIVE', 'LIPSTICK', 'MAGENTA', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'PURPLE', 'RED', 'SULPHUR', 'TAN', 'TEAL', 'VIOLET', 'WHITE', 'YELLOW'];
const INCOPY_COLORS = ['AMBER', 'AQUA', 'BLACK', 'BLUE', 'BLUEBERRY', 'BRICK_RED', 'BROWN', 'BURGUNDY', 'CANARY', 'CARNATION', 'CHARCOAL', 'CIRRUS', 'CORNSTARCH', 'CUTE_TEAL', 'CYAN', 'DARK_BLUE', 'DARK_GREEN', 'EGGPLANT', 'ELECTROLYTE', 'ETHER', 'FIESTA', 'FOREST', 'FUCHSIA', 'GOLD', 'GRAPE', 'GRAPHITE', 'GRASS_GREEN', 'GRAY', 'GREEN', 'GRID_BLUE', 'GRID_GREEN', 'GRID_ORANGE', 'GUNMETAL', 'IRIS', 'JADE', 'LAVENDER', 'LEMON', 'LICHEN', 'LIGHT_BLUE', 'LIGHT_GRAY', 'LIGHT_OLIVE', 'LIME', 'LIPSTICK', 'MAGENTA', 'MIDNIGHT', 'MOCHA', 'MUSTARD', 'OCHRE', 'OLIVE_GREEN', 'ORANGE', 'PEACH', 'PINK', 'POWDER', 'PURPLE', 'RED', 'SLATE', 'SMOKE', 'SULPHUR', 'TAN', 'TEAL', 'ULTRAMARINE', 'VIOLET', 'WHEAT', 'WHITE', 'YELLOW'];

/** A UI colour (grid, note, Story Editor): an enum name such as "light_blue", or "#RRGGBB". */
function uiColor(value, enumName, allowed, name) {
    const v = String(value ?? '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return `[${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}]`;
    }
    return `${enumName}.${enumOf(v.toUpperCase().replace(/[\s-]+/g, '_'), allowed, { name })}`;
}

const uiColorSchema = (what) => ({ type: 'string', description: `${what}: a colour name such as "light_blue" or "grid_orange", or "#RRGGBB"` });

/** Which story to act on. */
export const STORY_SCHEMA = {
    type: 'object',
    description: 'Which story: frameId (any text frame of the story), storyId (from get_document_stories), or selection: true (the story of the selected text or text frame)',
    properties: {
        frameId: { type: 'integer', minimum: 0, description: 'Id of a text frame in the story' },
        storyId: { type: 'integer', minimum: 0, description: 'Story id' },
        selection: { type: 'boolean', description: 'Use the story of the current selection' },
    },
};

/** A story as a JSX expression, or null when none is given and `optional`. */
function storyExpr(s, { optional = false } = {}) {
    const o = s ?? {};
    if (has(o.storyId)) return `__storyById(doc, ${id(o.storyId, 'story.storyId')})`;
    if (has(o.frameId)) return `__storyOf(__item(doc, ${id(o.frameId, 'story.frameId')}))`;
    if (o.selection) return '__storyOf(__selected())';
    if (optional) return null;
    throw new Error('Choose the story: story.frameId, story.storyId or story.selection: true');
}

/** ES3 helpers shared by the tools of this module (function expressions: the body runs inside a block). */
const HELPERS = String.raw`
var __selected = function () {
  var sel = app.selection;
  if (!sel.length) throw new Error("Nothing is selected");
  return sel[0];
};
var __storyById = function (doc, id) {
  var s = doc.stories.itemByID(id);
  if (!s.isValid) throw new Error("Story " + id + " not found");
  return s;
};
var __storyOf = function (obj) {
  if (obj.hasOwnProperty("parentStory")) return obj.parentStory;
  throw new Error(obj.constructor.name + " holds no text");
};
var __textFrames = function (doc, spec) {
  var all = __targets(doc, spec), out = [];
  for (var i = 0; i < all.length; i++) {
    var it = all[i];
    if (it.constructor.name === "TextFrame") out.push(it);
    else if (it.hasOwnProperty("parentTextFrames") && it.parentTextFrames.length) out.push(it.parentTextFrames[0]);
    else throw new Error(it.constructor.name + " is not a text frame");
  }
  return out;
};
var __frameRef = function (doc, id) {
  var f = __item(doc, id);
  if (f.constructor.name !== "TextFrame") throw new Error("Item " + id + " is a " + f.constructor.name + ", not a text frame");
  return f;
};
var __excerpt = function (t) {
  var s = "";
  try { s = String(t.contents); } catch (e) {}
  return s.length > 80 ? s.substring(0, 80) + "..." : s;
};
var __color = function (c) {
  return c instanceof Array ? c : __enumName(c);
};
var __menuState = function (m) {
  var t = String(m.title).replace(/&/g, "");
  if (/^Hide /.test(t)) return true;
  if (/^Show /.test(t)) return false;
  return m.checked;
};
var __menu = function (id, want) {
  var m = app.menuActions.itemByID(id);
  if (!m.isValid) throw new Error("Menu action " + id + " is not available in this version of InDesign");
  var before = __menuState(m);
  if ((want === true || want === false) && before === want) return { id: id, title: String(m.title).replace(/&/g, ""), on: before, changed: false };
  if (!m.enabled) throw new Error(String(m.title).replace(/&/g, "") + " is not available in the current context");
  m.invoke();
  return { id: id, title: String(m.title).replace(/&/g, ""), on: __menuState(m), changed: true };
};
`;

/** script() with this module's helpers in front of the body. */
const body = (code, opts) => script(HELPERS + code, opts);

// ---------------------------------------------------------------------------
// Text Frame Options

const COLUMN_MODES = ['fixed_number', 'fixed_width', 'flexible_width'];
const VJ = { top: 'VerticalJustification.TOP_ALIGN', center: 'VerticalJustification.CENTER_ALIGN', bottom: 'VerticalJustification.BOTTOM_ALIGN', justify: 'VerticalJustification.JUSTIFY_ALIGN' };
const FIRST_BASELINE = { ascent: 'FirstBaseline.ASCENT_OFFSET', cap_height: 'FirstBaseline.CAP_HEIGHT', leading: 'FirstBaseline.LEADING_OFFSET', x_height: 'FirstBaseline.X_HEIGHT', em_box_height: 'FirstBaseline.EMBOX_HEIGHT', fixed: 'FirstBaseline.FIXED_HEIGHT' };
const GRID_RELATIVE = { top_of_page: 'BaselineFrameGridRelativeOption.TOP_OF_PAGE', top_of_margin: 'BaselineFrameGridRelativeOption.TOP_OF_MARGIN', top_of_frame: 'BaselineFrameGridRelativeOption.TOP_OF_FRAME', top_of_inset: 'BaselineFrameGridRelativeOption.TOP_OF_INSET' };
const AUTO_SIZE = { off: 'AutoSizingTypeEnum.OFF', height_only: 'AutoSizingTypeEnum.HEIGHT_ONLY', width_only: 'AutoSizingTypeEnum.WIDTH_ONLY', height_and_width: 'AutoSizingTypeEnum.HEIGHT_AND_WIDTH', height_and_width_proportionally: 'AutoSizingTypeEnum.HEIGHT_AND_WIDTH_PROPORTIONALLY' };
const REF_POINT = {
    top_left: 'AutoSizingReferenceEnum.TOP_LEFT_POINT', top_center: 'AutoSizingReferenceEnum.TOP_CENTER_POINT', top_right: 'AutoSizingReferenceEnum.TOP_RIGHT_POINT',
    left_center: 'AutoSizingReferenceEnum.LEFT_CENTER_POINT', center: 'AutoSizingReferenceEnum.CENTER_POINT', right_center: 'AutoSizingReferenceEnum.RIGHT_CENTER_POINT',
    bottom_left: 'AutoSizingReferenceEnum.BOTTOM_LEFT_POINT', bottom_center: 'AutoSizingReferenceEnum.BOTTOM_CENTER_POINT', bottom_right: 'AutoSizingReferenceEnum.BOTTOM_RIGHT_POINT',
};

const SIDES_SCHEMA = (what) => ({
    type: 'object',
    description: `${what} in mm. Give all, or any of top, left, bottom, right (sides not given keep their value)`,
    properties: {
        all: { type: 'number', minimum: 0, description: 'The same value on every side, in mm' },
        top: { type: 'number', minimum: 0, description: 'Top, in mm' },
        left: { type: 'number', minimum: 0, description: 'Left, in mm' },
        bottom: { type: 'number', minimum: 0, description: 'Bottom, in mm' },
        right: { type: 'number', minimum: 0, description: 'Right, in mm' },
    },
});

/** JSX that overrides sides of the [top, left, bottom, right] array `v`. */
function sideLines(o, v, name) {
    known(o, ['all', 'top', 'left', 'bottom', 'right'], name);
    const out = [];
    if (has(o.all)) {
        const a = mm(o.all, `${name}.all`);
        out.push(`${v} = [${a}, ${a}, ${a}, ${a}];`);
    }
    ['top', 'left', 'bottom', 'right'].forEach((side, i) => {
        if (has(o[side])) out.push(`${v}[${i}] = ${mm(o[side], `${name}.${side}`)};`);
    });
    return out;
}

/** Statements that apply set_text_frame_options arguments to `tf` (its preferences are `p`, its grid `g`). */
function frameOptionLines(a, needsDoc) {
    const L = [];
    const c = a.columns ?? {};
    known(c, ['mode', 'count', 'width', 'maxWidth', 'gutter', 'balance'], 'columns');
    if (has(c.mode)) {
        const m = enumOf(c.mode, COLUMN_MODES, { name: 'columns.mode' });
        L.push(`p.useFlexibleColumnWidth = ${bool(m === 'flexible_width')};`);
        L.push(`p.useFixedColumnWidth = ${bool(m === 'fixed_width')};`);
    }
    if (has(c.count)) L.push(`p.textColumnCount = ${num(c.count, { name: 'columns.count', min: 1, max: 40 })};`);
    if (has(c.gutter)) L.push(`p.textColumnGutter = ${mm(c.gutter, 'columns.gutter')};`);
    if (has(c.width)) L.push(`p.textColumnFixedWidth = ${mm(c.width, 'columns.width', 0.1)};`);
    if (has(c.maxWidth)) L.push(`p.textColumnMaxWidth = ${mm(c.maxWidth, 'columns.maxWidth')};`);
    if (has(c.balance)) L.push(`p.verticalBalanceColumns = ${bool(c.balance)};`);

    if (has(a.inset)) {
        const lines = sideLines(a.inset, 'ins', 'inset');
        if (lines.length) L.push('var ins = p.insetSpacing; ins = ins instanceof Array ? [ins[0], ins[1], ins[2], ins[3]] : [ins, ins, ins, ins];', ...lines, 'p.insetSpacing = ins;');
    }

    const v = a.verticalJustification ?? {};
    known(v, ['align', 'paragraphSpacingLimit'], 'verticalJustification');
    if (has(v.align)) L.push(`p.verticalJustification = ${pick(v.align, VJ, 'verticalJustification.align')};`);
    if (has(v.paragraphSpacingLimit)) L.push(`p.verticalThreshold = ${mm(v.paragraphSpacingLimit, 'verticalJustification.paragraphSpacingLimit')};`);
    if (has(a.ignoreWrap)) L.push(`p.ignoreWrap = ${bool(a.ignoreWrap)};`);

    const b = a.baseline ?? {};
    known(b, ['firstBaseline', 'minimum', 'customGrid', 'gridStart', 'gridRelativeTo', 'gridIncrement', 'gridColor'], 'baseline');
    if (has(b.firstBaseline)) L.push(`p.firstBaselineOffset = ${pick(b.firstBaseline, FIRST_BASELINE, 'baseline.firstBaseline')};`);
    if (has(b.minimum)) L.push(`p.minimumFirstBaselineOffset = ${mm(b.minimum, 'baseline.minimum')};`);
    const gridSet = ['gridStart', 'gridRelativeTo', 'gridIncrement', 'gridColor'].some((k) => has(b[k]));
    if (has(b.customGrid) || gridSet) L.push(`g.useCustomBaselineFrameGrid = ${bool(has(b.customGrid) ? b.customGrid : true)};`);
    if (has(b.gridStart)) L.push(`g.startingOffsetForBaselineFrameGrid = ${mm(b.gridStart, 'baseline.gridStart')};`);
    if (has(b.gridRelativeTo)) L.push(`g.baselineFrameGridRelativeOption = ${pick(b.gridRelativeTo, GRID_RELATIVE, 'baseline.gridRelativeTo')};`);
    if (has(b.gridIncrement)) L.push(`g.baselineFrameGridIncrement = ${mm(b.gridIncrement, 'baseline.gridIncrement', 0.1, 500)};`);
    if (has(b.gridColor)) L.push(`g.baselineFrameGridColor = ${uiColor(b.gridColor, 'UIColors', UI_COLORS, 'baseline.gridColor')};`);

    const s = a.autoSize ?? {};
    known(s, ['type', 'referencePoint', 'minimumHeight', 'minimumWidth', 'noLineBreaks'], 'autoSize');
    if (has(s.type)) L.push(`p.autoSizingType = ${pick(s.type, AUTO_SIZE, 'autoSize.type')};`);
    if (has(s.referencePoint)) L.push(`p.autoSizingReferencePoint = ${pick(s.referencePoint, REF_POINT, 'autoSize.referencePoint')};`);
    for (const [k, prop] of [['minimumHeight', 'Height'], ['minimumWidth', 'Width']]) {
        if (!has(s[k])) continue;
        const n = Number(mm(s[k], `autoSize.${k}`));
        L.push(`p.useMinimum${prop}ForAutoSizing = ${bool(n > 0)};`);
        if (n > 0) L.push(`p.minimum${prop}ForAutoSizing = ${n};`);
    }
    if (has(s.noLineBreaks)) L.push(`p.useNoLineBreaksForAutoSizing = ${bool(s.noLineBreaks)};`);

    const f = a.footnotes ?? {};
    known(f, ['enableOverrides', 'spanColumns', 'spaceBetween', 'minimumSpacing'], 'footnotes');
    const fnSet = ['spanColumns', 'spaceBetween', 'minimumSpacing'].some((k) => has(f[k]));
    if (has(f.enableOverrides) || fnSet) L.push(`p.footnotesEnableOverrides = ${bool(has(f.enableOverrides) ? f.enableOverrides : true)};`);
    if (has(f.spanColumns)) L.push(`p.footnotesSpanAcrossColumns = ${bool(f.spanColumns)};`);
    if (has(f.spaceBetween)) L.push(`p.footnotesSpaceBetween = ${mm(f.spaceBetween, 'footnotes.spaceBetween')};`);
    if (has(f.minimumSpacing)) L.push(`p.footnotesMinimumSpacing = ${mm(f.minimumSpacing, 'footnotes.minimumSpacing')};`);

    const r = a.columnRules ?? {};
    known(r, ['enabled', 'topInset', 'bottomInset', 'insetChain', 'offset', 'strokeWeight', 'strokeType', 'strokeColor', 'strokeTint', 'overprint'], 'columnRules');
    const ruleSet = given(r).some((k) => k !== 'enabled');
    if (has(r.enabled) || ruleSet) L.push(`p.columnRuleOverride = ${bool(has(r.enabled) ? r.enabled : true)};`);
    if (has(r.insetChain)) L.push(`p.columnRuleInsetChainOverride = ${bool(r.insetChain)};`);
    if (has(r.topInset)) L.push(`p.columnRuleTopInset = ${mm(r.topInset, 'columnRules.topInset')};`);
    if (has(r.bottomInset)) L.push(`p.columnRuleBottomInset = ${mm(r.bottomInset, 'columnRules.bottomInset')};`);
    if (has(r.offset)) L.push(`p.columnRuleOffset = ${mm(r.offset, 'columnRules.offset', -500, 500)};`);
    if (has(r.strokeWeight)) {
        // Stroke weights are points: measure in points for this one assignment.
        L.push('app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;');
        L.push(`try { p.columnRuleStrokeWidth = ${num(r.strokeWeight, { name: 'columnRules.strokeWeight', min: 0, max: 800 })}; } finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }`);
    }
    if (has(r.strokeType)) {
        const t = String(r.strokeType);
        if (!t || t.length > 200) throw new Error("'columnRules.strokeType' must be a stroke style name");
        needsDoc.strokeType = t;
        L.push('p.columnRuleStrokeType = ruleType;');
    }
    if (has(r.strokeColor)) {
        needsDoc.strokeColor = colorSpec(r.strokeColor, 'columnRules.strokeColor');
        L.push('p.columnRuleStrokeColor = ruleColor;');
    }
    if (has(r.strokeTint)) L.push(`p.columnRuleStrokeTint = ${num(r.strokeTint, { name: 'columnRules.strokeTint', min: 0, max: 100 })};`);
    if (has(r.overprint)) L.push(`p.columnRuleOverprintOverride = ${bool(r.overprint)};`);
    return L;
}

/** JSX: a text frame's Text Frame Options as a plain object. */
const FRAME_INFO = String.raw`
var __frameOptions = function (tf) {
  var p = tf.textFramePreferences, g = tf.baselineFrameGridOptions, ins = p.insetSpacing;
  if (!(ins instanceof Array)) ins = [ins, ins, ins, ins];
  var o = { id: tf.id };
  o.columns = { count: p.textColumnCount, mode: p.useFlexibleColumnWidth ? "flexible_width" : (p.useFixedColumnWidth ? "fixed_width" : "fixed_number"), width: p.textColumnFixedWidth, maxWidth: p.textColumnMaxWidth, gutter: p.textColumnGutter, balance: p.verticalBalanceColumns };
  o.inset = { top: ins[0], left: ins[1], bottom: ins[2], right: ins[3] };
  o.verticalJustification = { align: __enumName(p.verticalJustification), paragraphSpacingLimit: p.verticalThreshold };
  o.ignoreWrap = p.ignoreWrap;
  o.baseline = { firstBaseline: __enumName(p.firstBaselineOffset), minimum: p.minimumFirstBaselineOffset, customGrid: g.useCustomBaselineFrameGrid, gridStart: g.startingOffsetForBaselineFrameGrid, gridRelativeTo: __enumName(g.baselineFrameGridRelativeOption), gridIncrement: g.baselineFrameGridIncrement, gridColor: __color(g.baselineFrameGridColor) };
  o.autoSize = { type: __enumName(p.autoSizingType), referencePoint: __enumName(p.autoSizingReferencePoint), minimumHeight: p.useMinimumHeightForAutoSizing ? p.minimumHeightForAutoSizing : 0, minimumWidth: p.useMinimumWidthForAutoSizing ? p.minimumWidthForAutoSizing : 0, noLineBreaks: p.useNoLineBreaksForAutoSizing };
  o.footnotes = { enableOverrides: p.footnotesEnableOverrides, spanColumns: p.footnotesSpanAcrossColumns, spaceBetween: p.footnotesSpaceBetween, minimumSpacing: p.footnotesMinimumSpacing };
  var rule = { enabled: p.columnRuleOverride, topInset: p.columnRuleTopInset, bottomInset: p.columnRuleBottomInset, insetChain: p.columnRuleInsetChainOverride, offset: p.columnRuleOffset, strokeTint: p.columnRuleStrokeTint, overprint: p.columnRuleOverprintOverride };
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try { rule.strokeWeight = p.columnRuleStrokeWidth; } finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }
  try { rule.strokeType = p.columnRuleStrokeType.name; } catch (e) {}
  try { rule.strokeColor = p.columnRuleStrokeColor.name; } catch (e) {}
  o.columnRules = rule;
  return o;
};
`;

const FRAME_OPTION_SCHEMA = {
    columns: {
        type: 'object',
        description: 'Columns (General tab)',
        properties: {
            mode: { type: 'string', enum: COLUMN_MODES, description: 'Fixed Number keeps the count when the frame is resized, Fixed Width keeps the column width, Flexible Width adds columns past the maximum width' },
            count: { type: 'integer', minimum: 1, maximum: 40, description: 'Number of columns' },
            width: { type: 'number', description: 'Column width in mm' },
            maxWidth: { type: 'number', description: 'Maximum column width in mm, for flexible width (0 = no limit)' },
            gutter: { type: 'number', description: 'Gutter between columns in mm' },
            balance: { type: 'boolean', description: 'Balance Columns' },
        },
    },
    inset: SIDES_SCHEMA('Inset Spacing'),
    verticalJustification: {
        type: 'object',
        description: 'Vertical Justification (General tab)',
        properties: {
            align: { type: 'string', enum: Object.keys(VJ), description: 'Align text to the top, centre or bottom, or justify it vertically' },
            paragraphSpacingLimit: { type: 'number', description: 'Paragraph Spacing Limit in mm (for justify)' },
        },
    },
    ignoreWrap: { type: 'boolean', description: 'Ignore Text Wrap from other objects' },
    baseline: {
        type: 'object',
        description: 'Baseline Options tab. Setting any grid option turns on the custom baseline grid unless customGrid is false',
        properties: {
            firstBaseline: { type: 'string', enum: Object.keys(FIRST_BASELINE), description: 'First Baseline Offset' },
            minimum: { type: 'number', description: 'First baseline minimum in mm' },
            customGrid: { type: 'boolean', description: 'Use Custom Baseline Grid' },
            gridStart: { type: 'number', description: 'Grid start offset in mm' },
            gridRelativeTo: { type: 'string', enum: Object.keys(GRID_RELATIVE), description: 'What the grid start is measured from' },
            gridIncrement: { type: 'number', description: 'Increment Every, in mm' },
            gridColor: uiColorSchema('Grid colour'),
        },
    },
    autoSize: {
        type: 'object',
        description: 'Auto-Size tab',
        properties: {
            type: { type: 'string', enum: Object.keys(AUTO_SIZE), description: 'Auto-Sizing' },
            referencePoint: { type: 'string', enum: Object.keys(REF_POINT), description: 'The point that stays put while the frame resizes' },
            minimumHeight: { type: 'number', description: 'Minimum height in mm (0 turns the minimum off)' },
            minimumWidth: { type: 'number', description: 'Minimum width in mm (0 turns the minimum off)' },
            noLineBreaks: { type: 'boolean', description: 'No Line Breaks (widen instead of wrapping)' },
        },
    },
    footnotes: {
        type: 'object',
        description: 'Footnotes tab. Setting any option turns on Enable Overrides unless enableOverrides is false',
        properties: {
            enableOverrides: { type: 'boolean', description: 'Enable Overrides of the document footnote options' },
            spanColumns: { type: 'boolean', description: 'Span Footnotes Across Columns' },
            spaceBetween: { type: 'number', description: 'Space Between Footnotes in mm' },
            minimumSpacing: { type: 'number', description: 'Minimum spacing before the first footnote in mm' },
        },
    },
    columnRules: {
        type: 'object',
        description: 'Column Rules tab. Setting any option turns on Insert Column Rule unless enabled is false',
        properties: {
            enabled: { type: 'boolean', description: 'Insert Column Rule' },
            topInset: { type: 'number', description: 'Rule top inset in mm' },
            bottomInset: { type: 'number', description: 'Rule bottom inset in mm' },
            insetChain: { type: 'boolean', description: 'Keep top and bottom insets the same' },
            offset: { type: 'number', description: 'Horizontal offset in mm from the centre of the gutter' },
            strokeWeight: { type: 'number', description: 'Rule stroke weight in points' },
            strokeType: { type: 'string', description: 'Stroke style name, such as "Solid" or "Dashed"' },
            strokeColor: COLOR_SCHEMA,
            strokeTint: { type: 'number', minimum: 0, maximum: 100, description: 'Rule tint in percent' },
            overprint: { type: 'boolean', description: 'Overprint the rule stroke' },
        },
    },
};

// ---------------------------------------------------------------------------
// Text wrap

const WRAP_MODE = { none: 'TextWrapModes.NONE', bounding_box: 'TextWrapModes.BOUNDING_BOX_TEXT_WRAP', object_shape: 'TextWrapModes.CONTOUR', jump_object: 'TextWrapModes.JUMP_OBJECT_TEXT_WRAP', next_column: 'TextWrapModes.NEXT_COLUMN_TEXT_WRAP' };
const WRAP_SIDE = { both_sides: 'TextWrapSideOptions.BOTH_SIDES', left_side: 'TextWrapSideOptions.LEFT_SIDE', right_side: 'TextWrapSideOptions.RIGHT_SIDE', towards_spine: 'TextWrapSideOptions.SIDE_TOWARDS_SPINE', away_from_spine: 'TextWrapSideOptions.SIDE_AWAY_FROM_SPINE', largest_area: 'TextWrapSideOptions.LARGEST_AREA' };
const CONTOUR = { bounding_box: 'ContourOptionsTypes.BOUNDING_BOX', detect_edges: 'ContourOptionsTypes.DETECT_EDGES', alpha_channel: 'ContourOptionsTypes.ALPHA_CHANNEL', photoshop_path: 'ContourOptionsTypes.PHOTOSHOP_PATH', graphic_frame: 'ContourOptionsTypes.GRAPHIC_FRAME', same_as_clipping: 'ContourOptionsTypes.SAME_AS_CLIPPING', select_subject: 'ContourOptionsTypes.SELECT_SUBJECT' };

const WRAP_INFO = String.raw`
var __wrapInfo = function (it) {
  var w = it.textWrapPreferences, off = w.textWrapOffset;
  var o = { id: it.id, type: it.constructor.name, mode: __enumName(w.textWrapMode), invert: w.inverse, wrapTo: __enumName(w.textWrapSide), applyToParentPageOnly: w.applyToMasterPageOnly };
  o.offset = off instanceof Array ? { top: off[0], left: off[1], bottom: off[2], right: off[3] } : { all: off };
  try { var c = w.contourOptions; o.contour = { type: __enumName(c.contourType), pathName: c.contourPathName, includeInsideEdges: c.includeInsideEdges, photoshopPaths: c.photoshopPathNames, alphaChannels: c.alphaChannelPathNames }; } catch (e) {}
  return o;
};
`;

// ---------------------------------------------------------------------------
// Notes and track changes

const NOTE_INFO = String.raw`
var __noteInfo = function (n, s) {
  var o = { id: n.id, storyId: s.id, user: n.userName, collapsed: n.collapsed, text: "" };
  try { o.text = String(n.texts[0].contents); } catch (e) {}
  try { o.position = n.storyOffset.index; } catch (e) {}
  try { o.created = n.creationDate.toUTCString(); o.modified = n.modificationDate.toUTCString(); } catch (e) {}
  return o;
};
var __findNote = function (doc, id) {
  for (var i = 0; i < doc.stories.length; i++) {
    var s = doc.stories[i], n = s.notes.itemByID(id);
    if (n.isValid) return { note: n, story: s };
  }
  throw new Error("Note " + id + " not found");
};
var __caret = function (s) {
  var sel = app.selection;
  if (sel.length && sel[0].hasOwnProperty("parentStory") && sel[0].parentStory.id === s.id) return sel[0].insertionPoints[0].index;
  return -1;
};
`;

const CHANGE_INFO = String.raw`
var __changeInfo = function (c, i, s) {
  var o = { index: i, storyId: s.id, type: __enumName(c.changeType), user: c.userName, text: __excerpt(c.texts[0]) };
  try { o.position = c.storyOffset.index; } catch (e) {}
  try { o.date = c.date.toUTCString(); } catch (e) {}
  return o;
};
`;

const NOTE_ACTIONS = ['add', 'list', 'convert_text_to_note', 'convert_to_text', 'split', 'set_collapsed', 'remove', 'select', 'notes_mode'];
const CHANGE_ACTIONS = ['enable', 'disable', 'list', 'accept', 'reject', 'select'];
const WHICH = ['next', 'previous', 'first', 'last'];

// ---------------------------------------------------------------------------
// Editorial preferences

const NOTE_BG = { galley: 'NoteBackgrounds.GALLEY_BACKGROUND_COLOR', note_color: 'NoteBackgrounds.USE_NOTE_COLOR' };
const NOTE_COLOR_CHOICE = { note_color: 'NoteColorChoices.USE_NOTE_PREF_COLOR', user_color: 'NoteColorChoices.USE_USER_COLOR' };
const MARKING = { none: 'ChangeMarkings.NONE', outline: 'ChangeMarkings.OUTLINE', strikethrough: 'ChangeMarkings.STRIKETHROUGH', underline: 'ChangeMarkings.UNDERLINE_SINGLE' };
const BAR_SIDE = { left: 'ChangebarLocations.LEFT_ALIGN', right: 'ChangebarLocations.RIGHT_ALIGN' };
const LINE_SPACING = { single: 'LineSpacingType.SINGLE_SPACE', one_and_half: 'LineSpacingType.ONE_AND_HALF_SPACE', double: 'LineSpacingType.DOUBLE_SPACE', triple: 'LineSpacingType.TRIPLE_SPACE' };
const CURSOR = { standard: 'CursorTypes.STANDARD_CURSOR', thick: 'CursorTypes.THICK_CURSOR', barbell: 'CursorTypes.BARBELL_CURSOR', block: 'CursorTypes.BLOCK_CURSOR' };
const ANTI_ALIAS = { color: 'AntiAliasType.COLOR_ANTIALIASING', gray: 'AntiAliasType.GRAY_ANTIALIASING', thicker: 'AntiAliasType.THICKER_ANTIALIASING' };

const PREFS_INFO = String.raw`
var np = app.notePreferences, tp = app.trackChangesPreferences, gp = app.galleyPreferences, ep = app.textEditingPreferences;
var gsize;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
try { gsize = gp.displayFontSize; } finally { app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS; }
__result__ = {
  userName: app.userName,
  notes: { color: __color(np.noteColor), colorChoice: __enumName(np.noteColorChoices), showTips: np.showNoteTips, spellCheck: np.spellCheckNotes, findReplace: np.findAndReplaceNoteContents, background: __enumName(np.noteBackgroundColor) },
  trackChanges: { showAdded: tp.showAddedText, showDeleted: tp.showDeletedText, showMoved: tp.showMovedText, showChangeBars: tp.showChangeBars, changeBarColor: __color(tp.changeBarColor), changeBarLocation: __enumName(tp.locationForChangeBar), addedMarking: __enumName(tp.markingForAddedText), deletedMarking: __enumName(tp.markingForDeletedText), movedMarking: __enumName(tp.markingForMovedText), spellCheckDeletedText: tp.spellCheckDeletedText, preventDuplicateColor: tp.preventDuplicateColor },
  storyEditor: { font: gp.displayFont, fontSize: gsize, lineSpacing: __enumName(gp.lineSpacingValue), textColor: __color(gp.textColor), backgroundColor: __color(gp.backgroundColor), cursor: __enumName(gp.cursorType), blinkCursor: gp.blinkCursor, antiAlias: __enumName(gp.antiAliasType), smoothText: gp.smoothText, showStyleNameColumn: gp.showInfoColumn, showDepthRuler: gp.showDepthRuler, showParagraphBreakMarks: gp.showParagraphBreakMarks },
  typing: { singleClickConvertsFrames: ep.singleClickConvertsFramesToTextFrames, tripleClickSelectsLine: ep.tripleClickSelectsLine, smartCutAndPaste: ep.smartCutAndPaste, dragAndDropInLayout: ep.dragAndDropTextInLayout, dragAndDropInStoryEditor: ep.allowDragAndDropTextInStory }
};
`;

const PREF_SCHEMA = {
    userName: { type: 'string', description: 'User name recorded with notes and tracked changes (File > User)' },
    notes: {
        type: 'object',
        description: 'Notes preferences',
        properties: {
            color: uiColorSchema('Note colour'),
            colorChoice: { type: 'string', enum: Object.keys(NOTE_COLOR_CHOICE), description: 'Colour notes with the note colour or each user\'s colour' },
            showTips: { type: 'boolean', description: 'Show Note Tooltips' },
            spellCheck: { type: 'boolean', description: 'Include note content when checking spelling' },
            findReplace: { type: 'boolean', description: 'Include note content in Find/Change' },
            background: { type: 'string', enum: Object.keys(NOTE_BG), description: 'Note background in Story Editor' },
        },
    },
    trackChanges: {
        type: 'object',
        description: 'Track Changes preferences',
        properties: {
            showAdded: { type: 'boolean', description: 'Show added text' },
            showDeleted: { type: 'boolean', description: 'Show deleted text' },
            showMoved: { type: 'boolean', description: 'Show moved text' },
            showChangeBars: { type: 'boolean', description: 'Show change bars' },
            changeBarColor: uiColorSchema('Change bar colour'),
            changeBarLocation: { type: 'string', enum: Object.keys(BAR_SIDE), description: 'Change bar margin' },
            addedMarking: { type: 'string', enum: Object.keys(MARKING), description: 'Marking for added text' },
            deletedMarking: { type: 'string', enum: Object.keys(MARKING), description: 'Marking for deleted text' },
            movedMarking: { type: 'string', enum: Object.keys(MARKING), description: 'Marking for moved text' },
            spellCheckDeletedText: { type: 'boolean', description: 'Include deleted text when checking spelling' },
            preventDuplicateColor: { type: 'boolean', description: 'Prevent duplicate user colours' },
        },
    },
    storyEditor: {
        type: 'object',
        description: 'Story Editor Display preferences and View > Story Editor options',
        properties: {
            font: { type: 'string', description: 'Display font family name' },
            fontSize: { type: 'number', description: 'Display font size in points' },
            lineSpacing: { type: 'string', enum: Object.keys(LINE_SPACING), description: 'Line spacing' },
            textColor: uiColorSchema('Text colour'),
            backgroundColor: uiColorSchema('Background colour'),
            cursor: { type: 'string', enum: Object.keys(CURSOR), description: 'Cursor type' },
            blinkCursor: { type: 'boolean', description: 'Blink the cursor' },
            antiAlias: { type: 'string', enum: Object.keys(ANTI_ALIAS), description: 'Anti-aliasing type' },
            smoothText: { type: 'boolean', description: 'Enable anti-aliasing' },
            showStyleNameColumn: { type: 'boolean', description: 'Show Style Name Column' },
            showDepthRuler: { type: 'boolean', description: 'Show Depth Ruler' },
            showParagraphBreakMarks: { type: 'boolean', description: 'Show paragraph break marks' },
        },
    },
    typing: {
        type: 'object',
        description: 'Type preferences',
        properties: {
            singleClickConvertsFrames: { type: 'boolean', description: 'Type Tool Converts Frames to Text Frames' },
            tripleClickSelectsLine: { type: 'boolean', description: 'Triple Click to Select a Line (otherwise a paragraph)' },
            smartCutAndPaste: { type: 'boolean', description: 'Adjust Spacing Automatically When Cutting and Pasting Words' },
            dragAndDropInLayout: { type: 'boolean', description: 'Drag and drop text editing in layout view' },
            dragAndDropInStoryEditor: { type: 'boolean', description: 'Drag and drop text editing in Story Editor' },
        },
    },
};

function prefLines(a) {
    const L = [];
    if (has(a.userName)) {
        const u = String(a.userName);
        if (!u.trim() || u.length > 200) throw new Error("'userName' must be 1 to 200 characters");
        L.push(`app.userName = ${str(u)};`);
    }
    const n = a.notes ?? {};
    known(n, Object.keys(PREF_SCHEMA.notes.properties), 'notes');
    if (has(n.color)) L.push(`np.noteColor = ${uiColor(n.color, 'InCopyUIColors', INCOPY_COLORS, 'notes.color')};`);
    if (has(n.colorChoice)) L.push(`np.noteColorChoices = ${pick(n.colorChoice, NOTE_COLOR_CHOICE, 'notes.colorChoice')};`);
    if (has(n.showTips)) L.push(`np.showNoteTips = ${bool(n.showTips)};`);
    if (has(n.spellCheck)) L.push(`np.spellCheckNotes = ${bool(n.spellCheck)};`);
    if (has(n.findReplace)) L.push(`np.findAndReplaceNoteContents = ${bool(n.findReplace)};`);
    if (has(n.background)) L.push(`np.noteBackgroundColor = ${pick(n.background, NOTE_BG, 'notes.background')};`);

    const t = a.trackChanges ?? {};
    known(t, Object.keys(PREF_SCHEMA.trackChanges.properties), 'trackChanges');
    for (const [k, prop] of [['showAdded', 'showAddedText'], ['showDeleted', 'showDeletedText'], ['showMoved', 'showMovedText'], ['showChangeBars', 'showChangeBars'], ['spellCheckDeletedText', 'spellCheckDeletedText'], ['preventDuplicateColor', 'preventDuplicateColor']]) {
        if (has(t[k])) L.push(`tp.${prop} = ${bool(t[k])};`);
    }
    if (has(t.changeBarColor)) L.push(`tp.changeBarColor = ${uiColor(t.changeBarColor, 'InCopyUIColors', INCOPY_COLORS, 'trackChanges.changeBarColor')};`);
    if (has(t.changeBarLocation)) L.push(`tp.locationForChangeBar = ${pick(t.changeBarLocation, BAR_SIDE, 'trackChanges.changeBarLocation')};`);
    for (const [k, prop] of [['addedMarking', 'markingForAddedText'], ['deletedMarking', 'markingForDeletedText'], ['movedMarking', 'markingForMovedText']]) {
        if (has(t[k])) L.push(`tp.${prop} = ${pick(t[k], MARKING, `trackChanges.${k}`)};`);
    }

    const g = a.storyEditor ?? {};
    known(g, Object.keys(PREF_SCHEMA.storyEditor.properties), 'storyEditor');
    if (has(g.font)) {
        const f = String(g.font);
        if (!f.trim() || f.length > 200) throw new Error("'storyEditor.font' must be a font family name");
        L.push(`gp.displayFont = ${str(f)};`);
    }
    if (has(g.fontSize)) L.push(`gp.displayFontSize = "${num(g.fontSize, { name: 'storyEditor.fontSize', min: 6, max: 72 })}pt";`);
    if (has(g.lineSpacing)) L.push(`gp.lineSpacingValue = ${pick(g.lineSpacing, LINE_SPACING, 'storyEditor.lineSpacing')};`);
    if (has(g.textColor)) L.push(`gp.textColor = ${uiColor(g.textColor, 'InCopyUIColors', INCOPY_COLORS, 'storyEditor.textColor')};`);
    if (has(g.backgroundColor)) L.push(`gp.backgroundColor = ${uiColor(g.backgroundColor, 'InCopyUIColors', INCOPY_COLORS, 'storyEditor.backgroundColor')};`);
    if (has(g.cursor)) L.push(`gp.cursorType = ${pick(g.cursor, CURSOR, 'storyEditor.cursor')};`);
    if (has(g.antiAlias)) L.push(`gp.antiAliasType = ${pick(g.antiAlias, ANTI_ALIAS, 'storyEditor.antiAlias')};`);
    for (const [k, prop] of [['blinkCursor', 'blinkCursor'], ['smoothText', 'smoothText'], ['showStyleNameColumn', 'showInfoColumn'], ['showDepthRuler', 'showDepthRuler'], ['showParagraphBreakMarks', 'showParagraphBreakMarks']]) {
        if (has(g[k])) L.push(`gp.${prop} = ${bool(g[k])};`);
    }

    const e = a.typing ?? {};
    known(e, Object.keys(PREF_SCHEMA.typing.properties), 'typing');
    for (const [k, prop] of [['singleClickConvertsFrames', 'singleClickConvertsFramesToTextFrames'], ['tripleClickSelectsLine', 'tripleClickSelectsLine'], ['smartCutAndPaste', 'smartCutAndPaste'], ['dragAndDropInLayout', 'dragAndDropTextInLayout'], ['dragAndDropInStoryEditor', 'allowDragAndDropTextInStory']]) {
        if (has(e[k])) L.push(`ep.${prop} = ${bool(e[k])};`);
    }
    return L;
}

// ---------------------------------------------------------------------------
// View extras, threading, type on a path, cursor movement

/** View/Window toggles: [option, menu action id, description]. */
const EXTRAS_MENU = [
    ['textThreads', 24332, 'Show Text Threads (View > Extras)'],
    ['changes', 42254, 'Show Changes (View)'],
    ['notesPanel', 47903, 'Notes panel (Window > Editorial)'],
    ['trackChangesPanel', 42250, 'Track Changes panel (Window > Editorial)'],
    ['textWrapPanel', 13569, 'Text Wrap panel (Window)'],
    ['textWrapOptions', 13570, 'Show Options in the Text Wrap panel (the panel must be open)'],
];

const PLACEHOLDER = { latin: 'TextFrameContents.PLACEHOLDER_TEXT', arabic: 'TextFrameContents.PLACEHOLDER_TEXT_ARABIC', cyrillic: 'TextFrameContents.PLACEHOLDER_TEXT_CYRILLIC', greek: 'TextFrameContents.PLACEHOLDER_TEXT_GREEK', hebrew: 'TextFrameContents.PLACEHOLDER_TEXT_HEBREW' };

const PATH_EFFECT = { rainbow: 'TextPathEffects.RAINBOW_PATH_EFFECT', skew: 'TextPathEffects.SKEW_PATH_EFFECT', ribbon_3d: 'TextPathEffects.RIBBON_PATH_EFFECT', stair_step: 'TextPathEffects.STAIR_STEP_PATH_EFFECT', gravity: 'TextPathEffects.GRAVITY_PATH_EFFECT' };
const PATH_ALIGN = { top: 'PathTypeAlignments.TOP_PATH_ALIGNMENT', center: 'PathTypeAlignments.CENTER_PATH_ALIGNMENT', bottom: 'PathTypeAlignments.BOTTOM_PATH_ALIGNMENT' };
const TEXT_ALIGN = {
    baseline: 'TextTypeAlignments.BASELINE_TEXT_ALIGNMENT', ascender: 'TextTypeAlignments.ASCENDER_TEXT_ALIGNMENT', descender: 'TextTypeAlignments.DESCENDER_TEXT_ALIGNMENT', center: 'TextTypeAlignments.CENTER_TEXT_ALIGNMENT',
    em_box_above: 'TextTypeAlignments.ABOVE_RIGHT_EM_BOX_TEXT_ALIGNMENT', em_box_below: 'TextTypeAlignments.BELOW_LEFT_EM_BOX_TEXT_ALIGNMENT', icf_box_above: 'TextTypeAlignments.ABOVE_RIGHT_ICF_BOX_TEXT_ALIGNMENT', icf_box_below: 'TextTypeAlignments.BELOW_LEFT_ICF_BOX_TEXT_ALIGNMENT',
};

const TEXT_PATH_INFO = String.raw`
var __pathInfo = function (it, tp) {
  return { itemId: it.id, textPathId: tp.id, storyId: tp.parentStory.id, effect: __enumName(tp.pathEffect), alignTo: __enumName(tp.textAlignment), toPath: __enumName(tp.pathAlignment), spacing: tp.pathSpacing, flip: tp.flipPathEffect === FlipValues.FLIPPED, text: __excerpt(tp), overflows: tp.overflows };
};
`;

const UNITS = ['character', 'word', 'line', 'paragraph', 'story'];
const SELECT_OPS = ['move', 'extend', 'select_line', 'select_range'];

const THREAD_INFO = String.raw`
var __containerInfo = function (c) {
  var o = { id: c.id, type: c.constructor.name, characters: 0, overflows: false };
  try { o.characters = c.characters.length; o.overflows = c.overflows; } catch (e) {}
  var pg = __pageOf(c);
  o.page = pg ? pg.name : null;
  o.pageIndex = pg ? pg.documentOffset : null;
  return o;
};
var __chain = function (tf) {
  var out = [], c = tf.startTextFrame, guard = 0;
  while (c && c.isValid && guard < 10000) {
    out.push(__containerInfo(c));
    var nx = c.nextTextFrame;
    if (!nx || nx === NothingEnum.NOTHING) break;
    c = nx; guard++;
  }
  return out;
};
`;

export const tools = [
    {
        name: 'set_text_frame_options',
        description: 'Set Text Frame Options on text frames: columns (fixed number, fixed width or flexible width, count, width, maximum, gutter, balance), inset spacing, vertical justification and paragraph spacing limit, ignore text wrap, baseline options and a custom baseline grid, auto-sizing, footnote overrides and column rules (Object > Text Frame Options)',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, ...FRAME_OPTION_SCHEMA },
            required: ['target'],
        },
        features: [
            'indesign.text_frames.text_frame_options',
            'indesign.text_frames.column_rules',
            'indesign.text_frames.tfo_general_columns_fixed_number_fixed_width_flexible_width',
            'indesign.text_frames.tfo_general_number',
            'indesign.text_frames.tfo_general_width',
            'indesign.text_frames.tfo_general_maximum',
            'indesign.text_frames.tfo_general_gutter',
            'indesign.text_frames.tfo_general_balance_columns',
            'indesign.text_frames.tfo_general_inset_spacing',
            'indesign.text_frames.tfo_general_vertical_justification_align',
            'indesign.text_frames.tfo_general_paragraph_spacing_limit',
            'indesign.text_frames.tfo_general_ignore_text_wrap',
            'indesign.text_frames.tfo_baseline_first_baseline_offset',
            'indesign.text_frames.tfo_baseline_first_baseline_min',
            'indesign.text_frames.tfo_baseline_use_custom_baseline_grid',
            'indesign.text_frames.tfo_baseline_baseline_grid_start',
            'indesign.text_frames.tfo_baseline_baseline_grid_relative_to',
            'indesign.text_frames.tfo_baseline_baseline_grid_increment_every',
            'indesign.text_frames.tfo_baseline_baseline_grid_color',
            'indesign.text_frames.tfo_autosize_auto_sizing',
            'indesign.text_frames.tfo_autosize_auto_size_reference_point',
            'indesign.text_frames.tfo_autosize_minimum_height',
            'indesign.text_frames.tfo_autosize_minimum_width',
            'indesign.text_frames.tfo_autosize_no_line_breaks',
            'indesign.text_frames.tfo_footnotes_enable_overrides',
            'indesign.text_frames.tfo_footnotes_span_footnotes_across_columns',
            'indesign.text_frames.tfo_footnotes_space_between_footnotes',
            'indesign.text_frames.tfo_footnotes_minimum_spacing_footnotes',
            'indesign.text_frames.tfo_column_rules_insert_column_rule',
            'indesign.text_frames.tfo_column_rules_rule_top_inset',
            'indesign.text_frames.tfo_column_rules_rule_bottom_inset',
            'indesign.text_frames.tfo_column_rules_inset_chain',
            'indesign.text_frames.tfo_column_rules_horizontal_offset',
            'indesign.text_frames.tfo_column_rules_stroke_weight_column_rule',
            'indesign.text_frames.tfo_column_rules_stroke_type_column_rule',
            'indesign.text_frames.tfo_column_rules_stroke_color_column_rule',
            'indesign.text_frames.tfo_column_rules_stroke_tint_column_rule',
            'indesign.text_frames.tfo_column_rules_overprint_stroke_column_rule',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            target: { ids: [1] },
            columns: { mode: 'flexible_width', count: 2, width: 40, maxWidth: 60, gutter: 4, balance: true },
            inset: { all: 2, top: 3 },
            verticalJustification: { align: 'justify', paragraphSpacingLimit: 5 },
            ignoreWrap: false,
            baseline: { firstBaseline: 'cap_height', minimum: 1, gridStart: 0, gridRelativeTo: 'top_of_inset', gridIncrement: 4.2, gridColor: 'light_blue' },
            autoSize: { type: 'height_only', referencePoint: 'top_center', minimumHeight: 20, minimumWidth: 0, noLineBreaks: false },
            footnotes: { spanColumns: true, spaceBetween: 2, minimumSpacing: 4 },
            columnRules: { topInset: 1, bottomInset: 1, insetChain: true, offset: 0, strokeWeight: 0.5, strokeType: 'Solid', strokeColor: 'Black', strokeTint: 50, overprint: false },
        },
        handler: (a) => {
            const refs = {};
            const lines = frameOptionLines(a, refs);
            if (!lines.length) throw new Error('Nothing to change: pass columns, inset, verticalJustification, ignoreWrap, baseline, autoSize, footnotes or columnRules');
            const pre = [];
            if (refs.strokeType) pre.push(`var ruleType = doc.strokeStyles.itemByName(${str(refs.strokeType)}); if (!ruleType.isValid) throw new Error("No stroke style named " + ${str(refs.strokeType)});`);
            if (refs.strokeColor) pre.push(`var ruleColor = __swatch(doc, ${refs.strokeColor});`);
            return run('Set text frame options', body(`${FRAME_INFO}
${pre.join('\n')}
var frames = __textFrames(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < frames.length; i++) {
  var tf = frames[i], p = tf.textFramePreferences, g = tf.baselineFrameGridOptions;
  ${lines.join('\n  ')}
  out.push(__frameOptions(tf));
}
__result__ = { frames: out };`));
        },
    },
    {
        name: 'get_text_frame_options',
        description: 'Read the Text Frame Options of text frames: columns, inset, vertical justification, baseline options, auto-sizing, footnotes and column rules (Object > Text Frame Options). Lengths in mm, stroke weight in points',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['indesign.text_frames.text_frame_options'],
        hints: { readOnly: true },
        handler: (a) => run('Get text frame options', body(`${FRAME_INFO}
var frames = __textFrames(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < frames.length; i++) out.push(__frameOptions(frames[i]));
__result__ = { frames: out };`)),
    },
    {
        name: 'set_text_wrap',
        description: 'Set text wrap on page items: no wrap, wrap around the bounding box, wrap around the object shape, jump object or jump to next column; invert, offsets, wrap to (sides, towards or away from the spine, largest area), contour options and Apply to Parent Page Only (Window > Text Wrap)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                mode: { type: 'string', enum: Object.keys(WRAP_MODE), description: 'Wrap type' },
                offset: SIDES_SCHEMA('Wrap offset (a wrap around an object shape uses one value: all, or top)'),
                invert: { type: 'boolean', description: 'Invert: wrap text inside the shape' },
                wrapTo: { type: 'string', enum: Object.keys(WRAP_SIDE), description: 'Wrap To: which sides of the object text wraps on' },
                contour: {
                    type: 'object',
                    description: 'Contour Options, for a wrap around the object shape',
                    properties: {
                        type: { type: 'string', enum: Object.keys(CONTOUR), description: 'Contour type' },
                        pathName: { type: 'string', description: 'Alpha channel or Photoshop path name, for those contour types' },
                        includeInsideEdges: { type: 'boolean', description: 'Include Inside Edges' },
                    },
                },
                applyToParentPageOnly: { type: 'boolean', description: 'Apply to Parent Page Only (items on parent pages)' },
            },
            required: ['target'],
        },
        features: [
            'indesign.text_frames.text_wrap_panel',
            'indesign.text_frames.text_wrap_apply_to_parent_only',
            'indesign.text_frames.wrap_no_text_wrap',
            'indesign.text_frames.wrap_wrap_around_bounding_box',
            'indesign.text_frames.wrap_wrap_around_object_shape',
            'indesign.text_frames.wrap_jump_object',
            'indesign.text_frames.wrap_jump_to_next_column',
            'indesign.text_frames.wrap_invert',
            'indesign.text_frames.wrap_offset',
            'indesign.text_frames.wrap_wrap_to',
            'indesign.text_frames.wrap_contour_options_type',
            'indesign.text_frames.wrap_include_inside_edges',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { target: { ids: [1] }, mode: 'object_shape', offset: { all: 2, left: 3 }, invert: false, wrapTo: 'largest_area', contour: { type: 'photoshop_path', pathName: 'Path 1', includeInsideEdges: true }, applyToParentPageOnly: false },
        handler: (a) => {
            const L = [];
            if (has(a.mode)) L.push(`w.textWrapMode = ${pick(a.mode, WRAP_MODE, 'mode')};`);
            if (has(a.invert)) L.push(`w.inverse = ${bool(a.invert)};`);
            if (has(a.wrapTo)) L.push(`w.textWrapSide = ${pick(a.wrapTo, WRAP_SIDE, 'wrapTo')};`);
            if (has(a.offset)) {
                const lines = sideLines(a.offset, 'off', 'offset');
                const one = has(a.offset.all) ? a.offset.all : a.offset.top;
                if (lines.length) {
                    L.push('var off = w.textWrapOffset;');
                    L.push(`if (off instanceof Array) { off = [off[0], off[1], off[2], off[3]]; ${lines.join(' ')} w.textWrapOffset = off; }`);
                    if (has(one)) L.push(`else w.textWrapOffset = ${mm(one, 'offset')};`);
                }
            }
            const c = a.contour ?? {};
            known(c, ['type', 'pathName', 'includeInsideEdges'], 'contour');
            if (has(c.type)) L.push(`w.contourOptions.contourType = ${pick(c.type, CONTOUR, 'contour.type')};`);
            if (has(c.pathName)) {
                if (!String(c.pathName) || String(c.pathName).length > 200) throw new Error("'contour.pathName' must be a path or channel name");
                L.push(`w.contourOptions.contourPathName = ${str(c.pathName)};`);
            }
            if (has(c.includeInsideEdges)) L.push(`w.contourOptions.includeInsideEdges = ${bool(c.includeInsideEdges)};`);
            if (has(a.applyToParentPageOnly)) L.push(`w.applyToMasterPageOnly = ${bool(a.applyToParentPageOnly)};`);
            if (!L.length) throw new Error('Nothing to change: pass mode, offset, invert, wrapTo, contour or applyToParentPageOnly');
            return run('Set text wrap', body(`${WRAP_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], w = it.textWrapPreferences;
  ${L.join('\n  ')}
  out.push(__wrapInfo(it));
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'get_text_wrap',
        description: 'Read the text wrap of page items: wrap type, invert, offsets, wrap to, contour options and the paths and alpha channels a placed image offers (Window > Text Wrap)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['indesign.text_frames.text_wrap_panel'],
        hints: { readOnly: true },
        handler: (a) => run('Get text wrap', body(`${WRAP_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) out.push(__wrapInfo(items[i]));
__result__ = { items: out };`)),
    },
    {
        name: 'manage_notes',
        description: 'Work with notes (Type > Notes, Notes panel, Note tool): add a note at a text position, list notes with author and dates, convert text to a note or a note to text, split a note, expand or collapse notes, remove notes from a story or the document, go to the next, previous, first or last note, or invoke Notes Mode at a text position',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: NOTE_ACTIONS, description: 'add | list | convert_text_to_note | convert_to_text | split | set_collapsed | remove | select (go to a note) | notes_mode' },
                story: STORY_SCHEMA,
                position: { type: 'integer', minimum: 0, description: 'Character position in the story (add, notes_mode); defaults to the selection\'s insertion point, else the end of the story' },
                text: { type: 'string', description: 'Note text (add)' },
                start: { type: 'integer', minimum: 0, description: 'First character of the text to convert (convert_text_to_note)' },
                length: { type: 'integer', minimum: 1, description: 'Number of characters to convert (convert_text_to_note)' },
                noteIds: { type: 'array', items: { type: 'integer' }, description: 'Note ids from list (convert_to_text, split, set_collapsed, remove, select)' },
                splitAt: { type: 'integer', minimum: 1, description: 'Character in the note text where the second note begins (split)' },
                collapsed: { type: 'boolean', description: 'Collapse (true) or expand (false) the notes in Story Editor (set_collapsed); without noteIds, every note in the story' },
                which: { type: 'string', enum: WHICH, description: 'select: the note after or before the selection, or the first or last note of the story' },
                all: { type: 'boolean', description: 'remove: every note in the document (Remove All Notes)' },
            },
            required: ['action'],
        },
        features: [
            'indesign.text_frames.note',
            'indesign.text_frames.note_tool',
            'indesign.text_frames.new_note',
            'indesign.text_frames.notes_panel',
            'indesign.text_frames.notes_mode',
            'indesign.text_frames.convert_to_note',
            'indesign.text_frames.convert_to_text',
            'indesign.text_frames.split_note',
            'indesign.text_frames.next_previous_note',
            'indesign.text_frames.expand_collapse_notes',
            'indesign.text_frames.remove_notes',
        ],
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'add', story: { frameId: 1 }, position: 0, text: 'Check this' },
        handler: (a) => {
            const action = enumOf(a.action, NOTE_ACTIONS, { name: 'action' });
            const s = storyExpr(a.story, { optional: ['list', 'remove', 'convert_to_text', 'split', 'set_collapsed', 'select'].includes(action) });
            const noteIds = has(a.noteIds) ? ids(a.noteIds, 'noteIds') : null;
            const pos = has(a.position) ? id(a.position, 'position') : null;
            const posExpr = pos !== null ? `Math.min(${pos}, s.insertionPoints.length - 1)` : '(__caret(s) >= 0 ? __caret(s) : s.insertionPoints.length - 1)';
            let code;
            switch (action) {
                case 'add': {
                    if (!has(a.text) || !String(a.text).length) throw new Error("add needs 'text'");
                    code = `var s = ${s}, ip = s.insertionPoints[${posExpr}];
var n = ip.notes.add();
n.insertionPoints[0].contents = ${str(a.text)};
__result__ = { added: __noteInfo(n, s) };`;
                    break;
                }
                case 'list':
                    code = `var stories = ${s ? `[${s}]` : '(doc.stories.length ? doc.stories.everyItem().getElements() : [])'}, out = [];
for (var i = 0; i < stories.length; i++) for (var j = 0; j < stories[i].notes.length; j++) out.push(__noteInfo(stories[i].notes[j], stories[i]));
__result__ = { count: out.length, notes: out };`;
                    break;
                case 'convert_text_to_note': {
                    if (!has(a.start) || !has(a.length)) throw new Error("convert_text_to_note needs 'start' and 'length'");
                    const st = id(a.start, 'start');
                    const len = num(a.length, { name: 'length', min: 1, max: 10000000 });
                    code = `var s = ${s};
if (${st} + ${len} > s.characters.length) throw new Error("The range runs past the end of the story (" + s.characters.length + " characters)");
var n = s.characters.itemByRange(${st}, ${st} + ${len} - 1).texts[0].convertToNote();
__result__ = { converted: __noteInfo(n, s) };`;
                    break;
                }
                case 'convert_to_text':
                case 'split':
                case 'set_collapsed':
                case 'remove': {
                    if (action === 'split' && (!noteIds || !has(a.splitAt))) throw new Error("split needs 'noteIds' (one note) and 'splitAt'");
                    if (action === 'set_collapsed' && !has(a.collapsed)) throw new Error("set_collapsed needs 'collapsed'");
                    if (!noteIds && !s && !(action === 'remove' && a.all)) {
                        throw new Error(`${action} needs 'noteIds'${action === 'remove' ? ", 'story' or all: true" : action === 'split' ? '' : " or 'story'"}`);
                    }
                    const pickNotes = noteIds
                        ? `var ids = ${json(noteIds.map(Number))}, found = [];
for (var i = 0; i < ids.length; i++) { var f = __findNote(doc, ids[i]); found.push([f.note, f.story]); }`
                        : `var stories = ${s ? `[${s}]` : '(doc.stories.length ? doc.stories.everyItem().getElements() : [])'}, found = [];
for (var i = 0; i < stories.length; i++) { var all = stories[i].notes.length ? stories[i].notes.everyItem().getElements() : []; for (var j = all.length - 1; j >= 0; j--) found.push([all[j], stories[i]]); }`;
                    let each;
                    if (action === 'convert_to_text') each = 'var info = __noteInfo(n, ns); n.convertToText(); out.push(info);';
                    else if (action === 'remove') each = 'out.push(__noteInfo(n, ns)); n.remove();';
                    else if (action === 'set_collapsed') each = `n.collapsed = ${bool(a.collapsed)}; out.push(__noteInfo(n, ns));`;
                    else {
                        const k = id(a.splitAt, 'splitAt');
                        each = `var len = n.characters.length;
  if (${k} < 1 || ${k} >= len) throw new Error("splitAt must be between 1 and " + (len - 1) + " for note " + n.id);
  var tail = n.texts.itemByRange(n.insertionPoints[${k}], n.insertionPoints[len]);
  var rest = String(tail.contents);
  var second = ns.insertionPoints[n.storyOffset.index + 1].notes.add();
  second.insertionPoints[0].contents = rest;
  tail.remove();
  out.push(__noteInfo(n, ns)); out.push(__noteInfo(second, ns));`;
                    }
                    code = `${pickNotes}
var out = [];
for (var i = 0; i < found.length; i++) {
  var n = found[i][0], ns = found[i][1];
  ${each}
}
__result__ = { action: "${action}", count: ${action === 'split' ? '1' : 'found.length'}, notes: out };`;
                    break;
                }
                case 'select': {
                    if (!noteIds && !has(a.which)) throw new Error("select needs 'noteIds' (one note) or 'which'");
                    if (noteIds) {
                        code = `var f = __findNote(doc, ${noteIds[0]}), n = f.note, s = f.story;`;
                    } else {
                        const which = enumOf(a.which, WHICH, { name: 'which' });
                        code = `var s = ${s ?? '__storyOf(__selected())'}, all = [], caret = __caret(s), n = null;
if (!s.notes.length) throw new Error("The story has no notes");
all = s.notes.everyItem().getElements();
all.sort(function (x, y) { return x.storyOffset.index - y.storyOffset.index; });
var which = "${which}";
if (which === "first") n = all[0];
else if (which === "last") n = all[all.length - 1];
else if (which === "next") { for (var i = 0; i < all.length; i++) if (all[i].storyOffset.index > caret) { n = all[i]; break; } }
else { for (var j = all.length - 1; j >= 0; j--) if (all[j].storyOffset.index < caret) { n = all[j]; break; } }
if (!n) throw new Error("There is no ${which} note");`;
                    }
                    code += `
s.insertionPoints[n.storyOffset.index].select();
__result__ = { selected: __noteInfo(n, s) };`;
                    break;
                }
                case 'notes_mode':
                    code = `var s = ${s}, ip = s.insertionPoints[${posExpr}];
ip.select();
__result__ = { menu: __menu(47892, null), position: ip.index, storyId: s.id };`;
                    break;
                default:
                    throw new Error(`Unhandled action ${action}`);
            }
            return run('Manage notes', body(`${NOTE_INFO}\n${code}`));
        },
    },
    {
        name: 'manage_tracked_changes',
        description: 'Track changes (Type > Track Changes, Track Changes panel): turn tracking on or off for a story or every story, list tracked changes with type, author and date, accept or reject one change, all changes in a story or document, or only those by one user, and go to the next, previous, first or last change',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: CHANGE_ACTIONS, description: 'enable | disable | list | accept | reject | select (go to a change)' },
                story: STORY_SCHEMA,
                indexes: { type: 'array', items: { type: 'integer' }, description: 'accept/reject/select: change indexes within the story, as list reports them (needs story)' },
                userName: { type: 'string', description: 'accept/reject: only changes by this user (Accept/Reject All Changes by This User)' },
                which: { type: 'string', enum: WHICH, description: 'select: the change after or before the selection, or the first or last change of the story' },
                limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'list: most changes to return', default: 500 },
            },
            required: ['action'],
        },
        features: [
            'indesign.text_frames.track_changes_panel',
            'indesign.text_frames.track_changes_in_story',
            'indesign.text_frames.track_changes_all',
            'indesign.text_frames.accept_change',
            'indesign.text_frames.reject_change',
            'indesign.text_frames.accept_all_changes',
            'indesign.text_frames.reject_all_changes',
            'indesign.text_frames.changes_by_user',
            'indesign.text_frames.change_object',
            'indesign.text_frames.next_previous_change',
        ],
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'accept', story: { storyId: 1 }, userName: 'Editor' },
        handler: (a) => {
            const action = enumOf(a.action, CHANGE_ACTIONS, { name: 'action' });
            const s = storyExpr(a.story, { optional: action !== 'select' || !has(a.indexes) });
            const storiesExpr = s ? `[${s}]` : '(doc.stories.length ? doc.stories.everyItem().getElements() : [])';
            const indexes = has(a.indexes) ? ids(a.indexes, 'indexes').map(Number) : null;
            if (indexes && !s) throw new Error("'indexes' need a story");
            let user = null;
            if (has(a.userName)) {
                user = String(a.userName);
                if (!user || user.length > 200) throw new Error("'userName' must be 1 to 200 characters");
            }
            let code;
            if (action === 'enable' || action === 'disable') {
                code = `var stories = ${storiesExpr};
for (var i = 0; i < stories.length; i++) stories[i].trackChanges = ${bool(action === 'enable')};
__result__ = { trackChanges: ${bool(action === 'enable')}, stories: stories.length };`;
            } else if (action === 'list') {
                const limit = has(a.limit) ? num(a.limit, { name: 'limit', min: 1, max: 5000 }) : '500';
                code = `${CHANGE_INFO}
var stories = ${storiesExpr}, out = [], total = 0, tracking = [];
for (var i = 0; i < stories.length; i++) {
  var st = stories[i];
  if (st.trackChanges) tracking.push(st.id);
  for (var j = 0; j < st.changes.length; j++) { total++; if (out.length < ${limit}) out.push(__changeInfo(st.changes[j], j, st)); }
}
__result__ = { total: total, changes: out, trackingStories: tracking };`;
            } else if (action === 'accept' || action === 'reject') {
                const filter = user !== null ? `if (c.userName !== ${str(user)}) continue;` : '';
                const pickIdx = indexes
                    ? `var idx = ${json(indexes)}.sort(function (x, y) { return y - x; });
  for (var k = 0; k < idx.length; k++) { if (idx[k] >= st.changes.length) throw new Error("Change " + idx[k] + " not found; the story has " + st.changes.length); }`
                    : 'var idx = []; for (var k = st.changes.length - 1; k >= 0; k--) idx.push(k);';
                code = `${CHANGE_INFO}
var stories = ${storiesExpr}, out = [];
for (var i = 0; i < stories.length; i++) {
  var st = stories[i];
  ${pickIdx}
  for (var k = 0; k < idx.length; k++) {
    var c = st.changes[idx[k]];
    ${filter}
    out.push(__changeInfo(c, idx[k], st));
    c.${action}();
  }
}
__result__ = { action: "${action}", count: out.length, changes: out };`;
            } else {
                if (!indexes && !has(a.which)) throw new Error("select needs 'indexes' (one change) or 'which'");
                const which = indexes ? null : enumOf(a.which, WHICH, { name: 'which' });
                code = `${CHANGE_INFO}
var s = ${s ?? '__storyOf(__selected())'}, n = s.changes.length, at = -1;
if (!n) throw new Error("The story has no tracked changes");
var sel = app.selection, caret = -1;
if (sel.length && sel[0].hasOwnProperty("parentStory") && sel[0].parentStory.id === s.id) caret = sel[0].insertionPoints[0].index;
${indexes ? `at = ${indexes[0]}; if (at >= n) throw new Error("Change " + at + " not found; the story has " + n);` : `var which = "${which}";
if (which === "first") at = 0;
else if (which === "last") at = n - 1;
else if (which === "next") { for (var i = 0; i < n; i++) if (s.changes[i].storyOffset.index > caret) { at = i; break; } }
else { for (var j = n - 1; j >= 0; j--) if (s.changes[j].storyOffset.index < caret) { at = j; break; } }
if (at < 0) throw new Error("There is no ${which} change");`}
var c = s.changes[at];
c.texts[0].select();
__result__ = { selected: __changeInfo(c, at, s) };`;
            }
            return run('Manage tracked changes', body(code));
        },
    },
    {
        name: 'get_editorial_preferences',
        description: 'Read the editorial preferences: Notes, Track Changes, Story Editor Display (font, size, spacing, colours, cursor, style name column, depth ruler) and Type preferences for text editing, plus the user name for notes and changes',
        inputSchema: { type: 'object', properties: {} },
        features: ['indesign.text_frames.notes_prefs', 'indesign.text_frames.track_changes_prefs', 'indesign.text_frames.story_editor_display'],
        hints: { readOnly: true },
        handler: () => run('Get editorial preferences', body(PREFS_INFO, { needsDocument: false })),
    },
    {
        name: 'set_editorial_preferences',
        description: 'Set editorial preferences (Preferences > Notes, Track Changes, Story Editor Display and Type; View > Story Editor): note colour and tooltips, which changes show and how they are marked, Story Editor font, colours and cursor, the style name column and depth ruler, triple-click and smart cut and paste behaviour, and the user name',
        inputSchema: { type: 'object', properties: PREF_SCHEMA },
        features: [
            'indesign.text_frames.notes_prefs',
            'indesign.text_frames.track_changes_prefs',
            'indesign.text_frames.story_editor_display',
            'indesign.text_frames.story_editor_style_column',
            'indesign.text_frames.story_editor_depth_ruler',
            'indesign.text_frames.single_click_converts',
            'indesign.text_frames.triple_click_line',
            'indesign.text_frames.smart_cut_paste',
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: {
            userName: 'Editor',
            notes: { color: 'gold', colorChoice: 'user_color', showTips: true, spellCheck: true, findReplace: true, background: 'note_color' },
            trackChanges: { showAdded: true, showDeleted: true, showMoved: true, showChangeBars: true, changeBarColor: '#FF0000', changeBarLocation: 'left', addedMarking: 'underline', deletedMarking: 'strikethrough', movedMarking: 'outline', spellCheckDeletedText: false, preventDuplicateColor: true },
            storyEditor: { font: 'Courier', fontSize: 12, lineSpacing: 'single', textColor: 'black', backgroundColor: 'white', cursor: 'thick', blinkCursor: true, antiAlias: 'gray', smoothText: true, showStyleNameColumn: true, showDepthRuler: true, showParagraphBreakMarks: false },
            typing: { singleClickConvertsFrames: true, tripleClickSelectsLine: true, smartCutAndPaste: true, dragAndDropInLayout: false, dragAndDropInStoryEditor: true },
        },
        handler: (a) => {
            const lines = prefLines(a);
            if (!lines.length) throw new Error('Nothing to change: pass userName, notes, trackChanges, storyEditor or typing');
            return run('Set editorial preferences', body(`var np = app.notePreferences, tp = app.trackChangesPreferences, gp = app.galleyPreferences, ep = app.textEditingPreferences;
${lines.join('\n')}
${PREFS_INFO}`, { needsDocument: false }));
        },
    },
    {
        name: 'show_text_extras',
        description: 'Show or hide text extras and editorial panels: text threads (View > Extras > Show Text Threads), note anchors (View > Extras > Show Notes), tracked changes (View > Show Changes), the Notes, Track Changes and Text Wrap panels, and the Text Wrap panel options. Each option is true to show, false to hide',
        inputSchema: {
            type: 'object',
            properties: {
                notes: { type: 'boolean', description: 'Show Notes: note anchors in layout view' },
                ...Object.fromEntries(EXTRAS_MENU.map(([k, , d]) => [k, { type: 'boolean', description: d }])),
            },
        },
        features: [
            'indesign.text_frames.show_text_threads',
            'indesign.text_frames.show_notes',
            'indesign.text_frames.show_changes',
            'indesign.text_frames.notes_panel',
            'indesign.text_frames.track_changes_panel',
            'indesign.text_frames.text_wrap_panel',
            'indesign.text_frames.text_wrap_show_options',
        ],
        hints: { readOnly: false, idempotent: true },
        handler: (a) => {
            const L = [];
            if (has(a.notes)) L.push(`doc.viewPreferences.showNotes = ${bool(a.notes)}; out.notes = { on: doc.viewPreferences.showNotes };`);
            for (const [k, menuId] of EXTRAS_MENU) {
                if (has(a[k])) L.push(`out.${k} = __menu(${menuId}, ${bool(a[k])});`);
            }
            if (!L.length) throw new Error(`Nothing to change: pass any of notes, ${EXTRAS_MENU.map(([k]) => k).join(', ')}`);
            return run('Show text extras', body(`var out = {};
${L.join('\n')}
__result__ = out;`));
        },
    },
    {
        name: 'thread_text_frames',
        description: 'Thread text frames so a story flows through them, unthread a frame from the next or previous one, flow overset text into new frames on the following pages (adding pages if asked), list a thread, or go to the next, previous, first or last frame in a thread',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['thread', 'unthread', 'flow', 'list', 'select'], description: 'thread | unthread | flow | list | select' },
                frameIds: { type: 'array', items: { type: 'integer' }, description: 'thread: frames in reading order (at least two). Other actions: the frame to act on (the first id)' },
                side: { type: 'string', enum: ['after', 'before'], description: 'unthread: break the thread after the frame (default) or before it', default: 'after' },
                which: { type: 'string', enum: WHICH, description: 'select: the frame to go to, relative to frameIds[0]' },
                addPages: { type: 'boolean', description: 'flow: add pages at the end of the document when the text runs past the last page', default: false },
                maxFrames: { type: 'integer', minimum: 1, maximum: 500, description: 'flow: most frames to add', default: 50 },
            },
            required: ['action', 'frameIds'],
        },
        features: ['indesign.text_frames.thread_text_frames', 'indesign.text_frames.unthread', 'indesign.text_frames.thread_navigation'],
        hints: { readOnly: false },
        auditArgs: { action: 'flow', frameIds: [1], addPages: true, maxFrames: 5 },
        handler: (a) => {
            const action = enumOf(a.action, ['thread', 'unthread', 'flow', 'list', 'select'], { name: 'action' });
            const frames = ids(a.frameIds, 'frameIds', action === 'thread' ? 2 : 1);
            let code;
            if (action === 'thread') {
                code = `var ids = ${json(frames.map(Number))}, fr = [];
for (var i = 0; i < ids.length; i++) fr.push(__frameRef(doc, ids[i]));
for (var j = 0; j < fr.length - 1; j++) fr[j].nextTextFrame = fr[j + 1];
__result__ = { thread: __chain(fr[0]), storyId: fr[0].parentStory.id };`;
            } else if (action === 'unthread') {
                const side = enumOf(a.side ?? 'after', ['after', 'before'], { name: 'side' });
                const prop = side === 'after' ? 'nextTextFrame' : 'previousTextFrame';
                code = `var tf = __frameRef(doc, ${frames[0]});
tf.${prop} = NothingEnum.NOTHING;
__result__ = { thread: __chain(tf), storyId: tf.parentStory.id };`;
            } else if (action === 'flow') {
                const max = has(a.maxFrames) ? num(a.maxFrames, { name: 'maxFrames', min: 1, max: 500 }) : '50';
                code = `var last = __frameRef(doc, ${frames[0]}).endTextFrame, made = [];
var pg = __pageOf(last);
if (!pg) throw new Error("The last frame of the thread is not on a page");
var pi = pg.documentOffset;
while (last.overflows && made.length < ${max}) {
  pi++;
  if (pi >= doc.pages.length) { if (!${bool(a.addPages)}) break; doc.pages.add(LocationOptions.AT_END); }
  var p = doc.pages[pi], mp = p.marginPreferences, b = p.bounds;
  var inside = mp.left, outside = mp.right;
  var l = p.side === PageSideOptions.LEFT_HAND ? outside : inside, r = p.side === PageSideOptions.LEFT_HAND ? inside : outside;
  var nf = p.textFrames.add({ geometricBounds: [b[0] + mp.top, b[1] + l, b[2] - mp.bottom, b[3] - r] });
  nf.textFramePreferences.textColumnCount = mp.columnCount;
  nf.textFramePreferences.textColumnGutter = mp.columnGutter;
  last.nextTextFrame = nf;
  last.parentStory.recompose();
  made.push(__itemInfo(nf));
  last = nf;
}
__result__ = { added: made, overset: last.overflows, thread: __chain(last) };`;
            } else if (action === 'list') {
                code = `var tf = __frameRef(doc, ${frames[0]});
__result__ = { storyId: tf.parentStory.id, overset: tf.parentStory.overflows, thread: __chain(tf) };`;
            } else {
                const which = enumOf(a.which, WHICH, { name: 'which' });
                const prop = { next: 'nextTextFrame', previous: 'previousTextFrame', first: 'startTextFrame', last: 'endTextFrame' }[which];
                code = `var tf = __frameRef(doc, ${frames[0]}), to = tf.${prop};
if (!to || to === NothingEnum.NOTHING || !to.isValid) throw new Error("Frame " + tf.id + " has no ${which} frame in its thread");
to.select();
try { var tp = __pageOf(to); if (tp) app.activeWindow.activePage = tp; } catch (e) {}
__result__ = { selected: __containerInfo(to) };`;
            }
            return run('Thread text frames', body(`${THREAD_INFO}\n${code}`));
        },
    },
    {
        name: 'get_story_statistics',
        description: 'Count the words, characters, lines and paragraphs of a story, or of the selected text, including how much is overset (the word and character counts of the Info panel)',
        inputSchema: { type: 'object', properties: { story: STORY_SCHEMA }, required: ['story'] },
        features: ['indesign.text_frames.word_count'],
        hints: { readOnly: true },
        auditArgs: { story: { frameId: 1 } },
        handler: (a) => {
            const s = storyExpr(a.story);
            return run('Get story statistics', body(`var s = ${s}, t = s;
var sel = app.selection, ofSelection = false;
if (${bool(a.story?.selection)} && sel.length && sel[0].hasOwnProperty("parentStory") && sel[0].hasOwnProperty("words") && sel[0].characters.length > 0) { t = sel[0]; ofSelection = true; }
var r = { storyId: s.id, ofSelection: ofSelection, words: t.words.length, characters: t.characters.length, lines: t.lines.length, paragraphs: t.paragraphs.length, frames: s.textContainers.length };
if (!ofSelection && s.overflows) {
  var shown = 0, tc = s.textContainers;
  for (var i = 0; i < tc.length; i++) shown += tc[i].characters.length;
  r.overset = { characters: s.characters.length - shown, words: 0 };
  if (s.characters.length > shown) r.overset.words = s.characters.itemByRange(shown, s.characters.length - 1).texts[0].words.length;
} else r.overset = null;
__result__ = r;`));
        },
    },
    {
        name: 'manage_story_editor',
        description: 'Open a story in Story Editor (Edit > Edit in Story Editor), close Story Editor windows and return to the same place in the layout (Edit > Edit in Layout), or expand/collapse all footnotes in the active Story Editor window',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['open', 'close', 'toggle_footnotes'], description: 'open | close (edit in layout) | toggle_footnotes' },
                story: STORY_SCHEMA,
            },
            required: ['action'],
        },
        features: ['indesign.text_frames.story_editor', 'indesign.text_frames.edit_in_layout', 'indesign.text_frames.story_editor_expand_footnotes'],
        hints: { readOnly: false, idempotent: false },
        auditArgs: { action: 'close', story: { storyId: 1 } },
        handler: (a) => {
            const action = enumOf(a.action, ['open', 'close', 'toggle_footnotes'], { name: 'action' });
            let code;
            if (action === 'open') {
                code = `var s = ${storyExpr(a.story)}, w = s.storyEdit();
__result__ = { storyId: s.id, window: w.name };`;
            } else if (action === 'close') {
                const s = storyExpr(a.story, { optional: true });
                code = `var target = ${s ? `${s}.id` : '-1'}, closed = [], back = null;
for (var i = app.storyWindows.length - 1; i >= 0; i--) {
  var w = app.storyWindows[i], sel = w.selection, sid = -1;
  try { if (sel.length && sel[0].hasOwnProperty("parentStory")) sid = sel[0].parentStory.id; } catch (e) {}
  if (target >= 0 && sid !== target) continue;
  if (sel.length && !back) back = sel[0];
  closed.push(w.name);
  w.close();
}
if (back) try { back.select(); } catch (e) {}
__result__ = { closed: closed };`;
            } else {
                code = `var w = app.activeWindow;
if (w.constructor.name !== "StoryWindow") throw new Error("The active window is not a Story Editor window: open one with action open");
__result__ = { menu: __menu(137108, null) };`;
            }
            return run('Story Editor', body(code));
        },
    },
    {
        name: 'fill_with_placeholder_text',
        description: 'Fill text frames with placeholder text (Type > Fill with Placeholder Text), in Latin, Arabic, Cyrillic, Greek or Hebrew script; existing text in the frames is replaced',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                script: { type: 'string', enum: Object.keys(PLACEHOLDER), description: 'Script of the placeholder text', default: 'latin' },
            },
            required: ['target'],
        },
        features: ['indesign.text_frames.fill_with_placeholder_text'],
        hints: { readOnly: false, destructive: true },
        handler: (a) => run('Fill with placeholder text', body(`var frames = __textFrames(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < frames.length; i++) { frames[i].contents = ${pick(a.script ?? 'latin', PLACEHOLDER, 'script')}; out.push({ id: frames[i].id, characters: frames[i].characters.length }); }
__result__ = { frames: out };`)),
    },
    {
        name: 'select_text',
        description: 'Move the text cursor or extend the text selection by characters, words, lines or paragraphs, or to the start or end of the story (the arrow-key and Shift-arrow shortcuts), select the line at the cursor, or select a character range',
        inputSchema: {
            type: 'object',
            properties: {
                story: STORY_SCHEMA,
                operation: { type: 'string', enum: SELECT_OPS, description: 'move (the insertion point) | extend (the selection) | select_line | select_range' },
                unit: { type: 'string', enum: UNITS, description: 'move/extend: step by character, word, line or paragraph, or jump to the story start or end', default: 'character' },
                count: { type: 'integer', minimum: -100000, maximum: 100000, description: 'move/extend: steps forward (positive) or back (negative); with unit story, positive goes to the end, negative to the start', default: 1 },
                start: { type: 'integer', minimum: 0, description: 'select_range: first character; move/extend/select_line: the starting position when the story has no selection' },
                length: { type: 'integer', minimum: 0, description: 'select_range: number of characters (0 places the insertion point)' },
            },
            required: ['story', 'operation'],
        },
        features: ['indesign.text_frames.text_navigation_keys', 'indesign.text_frames.text_selection_keys', 'indesign.text_frames.select_current_line'],
        hints: { readOnly: false, idempotent: false },
        auditArgs: { story: { selection: true }, operation: 'extend', unit: 'word', count: -2 },
        handler: (a) => {
            const s = storyExpr(a.story);
            const op = enumOf(a.operation, SELECT_OPS, { name: 'operation' });
            const unit = enumOf(a.unit ?? 'character', UNITS, { name: 'unit' });
            const count = num(a.count ?? 1, { name: 'count', min: -100000, max: 100000 });
            if (!Number.isInteger(Number(count))) throw new Error("'count' must be a whole number");
            const start = has(a.start) ? id(a.start, 'start') : null;
            let code = `var s = ${s}, last = s.insertionPoints.length - 1, sel = app.selection, from = ${start ?? 0}, to = ${start ?? 0};
if (sel.length && sel[0].hasOwnProperty("parentStory") && sel[0].parentStory.id === s.id) { from = sel[0].insertionPoints[0].index; to = sel[0].insertionPoints[-1].index; }
from = Math.min(from, last); to = Math.min(to, last);
var __range = function (x, y) {
  if (y > x) s.characters.itemByRange(x, y - 1).select(); else s.insertionPoints[x].select();
  return { storyId: s.id, start: x, end: y, text: y > x ? __excerpt(s.characters.itemByRange(x, y - 1).texts[0]) : "" };
};
`;
            if (op === 'select_range') {
                if (!has(a.start) || !has(a.length)) throw new Error("select_range needs 'start' and 'length'");
                const len = num(a.length, { name: 'length', min: 0, max: 100000000 });
                code += `var x = ${start}, y = ${start} + ${len};
if (y > last) throw new Error("The range runs past the end of the story (" + last + " characters)");
__result__ = __range(x, y);`;
            } else if (op === 'select_line') {
                code += `var ln = s.insertionPoints[from].lines[0];
ln.select();
__result__ = { storyId: s.id, start: ln.insertionPoints[0].index, end: ln.insertionPoints[-1].index, text: __excerpt(ln) };`;
            } else {
                const coll = { word: 'words', line: 'lines', paragraph: 'paragraphs' }[unit];
                code += `var n = ${count}, pos = n >= 0 ? to : from;
${unit === 'character' ? 'pos = Math.max(0, Math.min(last, pos + n));'
        : unit === 'story' ? 'pos = n >= 0 ? last : 0;'
            : `var starts = [];
if (s.${coll}.length) { starts = s.${coll}.everyItem().index; if (!(starts instanceof Array)) starts = [starts]; }
for (var k = 0; k < Math.abs(n); k++) {
  var nx = n > 0 ? last : 0;
  if (n > 0) { for (var i = 0; i < starts.length; i++) if (starts[i] > pos) { nx = starts[i]; break; } }
  else { for (var j = starts.length - 1; j >= 0; j--) if (starts[j] < pos) { nx = starts[j]; break; } }
  pos = nx;
}`}
${op === 'move' ? '__result__ = __range(pos, pos);' : `var anchor = n >= 0 ? from : to;
__result__ = __range(Math.min(anchor, pos), Math.max(anchor, pos));`}`;
            }
            return run('Select text', body(code));
        },
    },
    {
        name: 'apply_type_on_path',
        description: 'Put type on a path (Type on a Path tool) or change its options (Type > Type on a Path > Options): effect (rainbow, skew, 3D ribbon, stair step, gravity), what part of the type aligns to which part of the path, spacing and flip. Works on rectangles, ovals, polygons, lines and frames; an item that already has type on its path is updated',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                text: { type: 'string', description: 'Text to put on the path (replaces existing path text)' },
                effect: { type: 'string', enum: Object.keys(PATH_EFFECT), description: 'Effect' },
                alignTo: { type: 'string', enum: Object.keys(TEXT_ALIGN), description: 'Align: which part of the type sits on the path' },
                toPath: { type: 'string', enum: Object.keys(PATH_ALIGN), description: 'To Path: top, centre or bottom of the stroke' },
                spacing: { type: 'number', description: 'Spacing around sharp curves (InDesign\'s path spacing value)' },
                flip: { type: 'boolean', description: 'Flip the type to the other side of the path' },
            },
            required: ['target'],
        },
        features: ['indesign.text_frames.type_on_path_tool', 'indesign.text_frames.type_on_path_options'],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { target: { ids: [1] }, text: 'Along the curve', effect: 'gravity', alignTo: 'center', toPath: 'center', spacing: 2, flip: true },
        handler: (a) => {
            const L = [];
            if (has(a.effect)) L.push(`tp.pathEffect = ${pick(a.effect, PATH_EFFECT, 'effect')};`);
            if (has(a.alignTo)) L.push(`tp.textAlignment = ${pick(a.alignTo, TEXT_ALIGN, 'alignTo')};`);
            if (has(a.toPath)) L.push(`tp.pathAlignment = ${pick(a.toPath, PATH_ALIGN, 'toPath')};`);
            if (has(a.spacing)) L.push(`tp.pathSpacing = ${num(a.spacing, { name: 'spacing', min: -1000, max: 1000 })};`);
            if (has(a.flip)) L.push(`tp.flipPathEffect = ${a.flip ? 'FlipValues.FLIPPED' : 'FlipValues.NOT_FLIPPED'};`);
            if (has(a.text)) L.unshift(`tp.contents = ${str(a.text)};`);
            if (!L.length) throw new Error('Nothing to do: pass text and/or effect, alignTo, toPath, spacing or flip');
            return run('Type on a path', body(`${TEXT_PATH_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (!it.hasOwnProperty("textPaths")) throw new Error(it.constructor.name + " cannot carry type on a path");
  var created = it.textPaths.length === 0;
  if (created && ${bool(!has(a.text))}) throw new Error("Item " + it.id + " has no type on its path: pass text to add it");
  var tp = created ? it.textPaths.add() : it.textPaths[0];
  ${L.join('\n  ')}
  var info = __pathInfo(it, tp); info.created = created; out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'remove_type_on_path',
        description: 'Delete type from paths, leaving the paths (Type > Type on a Path > Delete Type from Path)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['indesign.text_frames.type_on_path_delete'],
        hints: { readOnly: false, destructive: true, idempotent: true },
        handler: (a) => run('Delete type from path', body(`var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], n = 0;
  if (it.hasOwnProperty("textPaths")) { n = it.textPaths.length; for (var j = n - 1; j >= 0; j--) it.textPaths[j].remove(); }
  out.push({ id: it.id, removed: n });
}
__result__ = { items: out };`)),
    },
];
