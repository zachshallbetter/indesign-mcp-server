/**
 * Layout tools: liquid layout constraints, alternate layouts, flex layouts,
 * named grids, frame grids and the layout grid, linked content (place and
 * link, link options, style mappings, the Content Collector and Placer),
 * rulers and ruler units, ruler guides, measuring, the gap between items, and
 * accessible context breaks.
 *
 * Positions, sizes, gaps and padding are millimetres from the top-left of the
 * page; text and character-count sizes are points. Pages and spreads are
 * 0-based indexes.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { validateFilePath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

/** Atlas feature ids of this area. */
const L = (ids) => ids.map((id) => `indesign.layout_tools.${id}`);

// ---------------------------------------------------------------------------
// Option fields: each names the property it sets and how its value is checked.
// The same tables build the input schema and the setter statements.

const mm = (prop, description, min = -1000, max = 1000) => ({ kind: 'mm', prop, description: `${description} (mm)`, min, max });
const pt = (prop, description, min = 0.1, max = 1296) => ({ kind: 'pt', prop, description: `${description} (points)`, min, max });
const pct = (prop, description, min = 1, max = 1000) => ({ kind: 'num', prop, description: `${description} (%)`, min, max });
const text = (prop, description) => ({ kind: 'str', prop, description });
const flag = (prop, description) => ({ kind: 'bool', prop, description });
/** An enum option: `values` maps each allowed value to its JSX expression. */
const pick = (prop, description, values) => ({ kind: 'enum', prop, description, values });
/** An enum option whose values are the DOM enum's own member names. */
const domEnum = (prop, description, type, names) => pick(prop, description, Object.fromEntries(names.map((n) => [n, `${type}.${n}`])));

/** A JSON schema property for a field. */
function fieldSchema(f) {
    if (f.kind === 'bool') return { type: 'boolean', description: f.description };
    if (f.kind === 'str') return { type: 'string', description: f.description };
    if (f.kind === 'enum') return { type: 'string', enum: Object.keys(f.values), description: f.description };
    return { type: 'number', minimum: f.min, maximum: f.max, description: f.description };
}

/** The schema of an option object. */
function optionsSchema(fields, description) {
    return { type: 'object', description, properties: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, fieldSchema(f)])) };
}

/**
 * Validate an option object and return the statements that write it to `obj`:
 * `mm` statements run in the script's millimetres, `pt` ones in points.
 */
function writeOptions(obj, fields, values, name) {
    const out = { mm: [], pt: [] };
    if (values === undefined) return out;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`'${name}' must be an object`);
    for (const [k, v] of Object.entries(values)) {
        const f = fields[k];
        if (!f) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${Object.keys(fields).join(', ')}`);
        if (v === undefined) continue;
        const n = `${name}.${k}`;
        if (f.kind === 'bool') {
            if (typeof v !== 'boolean') throw new Error(`'${n}' must be true or false`);
            out.mm.push(`${obj}.${f.prop} = ${bool(v)};`);
        } else if (f.kind === 'str') {
            if (typeof v !== 'string' || !v.trim()) throw new Error(`'${n}' must be a non-empty string`);
            out.mm.push(`${obj}.${f.prop} = ${str(v)};`);
        } else if (f.kind === 'enum') {
            out.mm.push(`${obj}.${f.prop} = ${f.values[enumOf(v, Object.keys(f.values), { name: n })]};`);
        } else {
            out[f.kind === 'pt' ? 'pt' : 'mm'].push(`${obj}.${f.prop} = ${num(v, { min: f.min, max: f.max, name: n })};`);
        }
    }
    return out;
}

/** Join option statements, wrapping the point-valued ones in a points block. */
function applyOptions(...sets) {
    const m = sets.flatMap((s) => s.mm);
    const p = sets.flatMap((s) => s.pt);
    if (!p.length) return m.join('\n');
    return [...m, 'app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;', 'try {', ...p, '} finally {',
        '  app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;', '}'].join('\n');
}

const count = (o) => o.mm.length + o.pt.length;

/** A boolean argument, or undefined when it is not given. */
function optBool(v, name) {
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return v;
}

/** A non-empty trimmed string argument. */
function name(v, label) {
    const s = String(v ?? '').trim();
    if (!s) throw new Error(`'${label}' is required`);
    if (s.length > 200) throw new Error(`'${label}' is too long`);
    return s;
}

/** A list of non-empty names. */
function names(v, label) {
    if (!Array.isArray(v) || !v.length) throw new Error(`'${label}' must be a non-empty list of names`);
    return v.map((x, i) => name(x, `${label}[${i}]`));
}

// ---------------------------------------------------------------------------
// Grids

/** Grid format options shared by named grids and frame grids (GridDataInformation). */
const GRID_FIELDS = {
    appliedFont: text('appliedFont', 'Font family of the grid'),
    fontStyle: text('fontStyle', 'Font style of the grid'),
    pointSize: pt('pointSize', 'Character size'),
    horizontalScale: pct('horizontalScale', 'Horizontal scale of the characters'),
    verticalScale: pct('verticalScale', 'Vertical scale of the characters'),
    characterAki: mm('characterAki', 'Character aki: space between characters'),
    lineAki: mm('lineAki', 'Line aki: space between lines'),
    characterAlignment: domEnum('characterAlignment', 'Alignment of small characters to the largest in the line', 'CharacterAlignment',
        ['ALIGN_BASELINE', 'ALIGN_EM_BOTTOM', 'ALIGN_EM_CENTER', 'ALIGN_EM_TOP', 'ALIGN_ICF_BOTTOM', 'ALIGN_ICF_TOP']),
    lineAlignment: domEnum('lineAlignment', 'Line alignment and justification', 'LineAlignment',
        ['LEFT_OR_TOP_LINE_ALIGN', 'CENTER_LINE_ALIGN', 'RIGHT_OR_BOTTOM_LINE_ALIGN', 'LEFT_OR_TOP_LINE_JUSTIFY', 'CENTER_LINE_JUSTIFY', 'RIGHT_OR_BOTTOM_LINE_JUSTIFY', 'FULL_LINE_JUSTIFY']),
    gridAlignment: domEnum('gridAlignment', 'What the text aligns to on the grid', 'GridAlignment',
        ['NONE', 'ALIGN_BASELINE', 'ALIGN_EM_BOTTOM', 'ALIGN_EM_CENTER', 'ALIGN_EM_TOP', 'ALIGN_ICF_BOTTOM', 'ALIGN_ICF_TOP']),
    gridView: domEnum('gridView', 'View: grid, N/Z view, grid and N/Z view, or alignment view', 'GridViewSettings',
        ['GRID_VIEW_ENUM', 'ZN_VIEW_ENUM', 'GRID_AND_ZN_VIEW_ENUM', 'ALIGN_VIEW_ENUM']),
    characterCountLocation: domEnum('characterCountLocation', 'Where the character count shows', 'CharacterCountLocation',
        ['NONE', 'TOP_ALIGN', 'BOTTOM_ALIGN', 'LEFT_ALIGN', 'RIGHT_ALIGN']),
    characterCountSize: pt('characterCountSize', 'Size of the character count display'),
};

/** Layout grid options (Layout > Layout Grid, LayoutGridDataInformation). */
const LAYOUT_GRID_FIELDS = Object.fromEntries(['appliedFont', 'fontStyle', 'pointSize', 'horizontalScale', 'verticalScale', 'characterAki', 'lineAki']
    .map((k) => [k, GRID_FIELDS[k]]));

/** Grid views (View > Grids & Guides, CjkGridPreference). */
const GRID_VIEW_FIELDS = {
    showLayoutGrids: flag('showAllLayoutGrids', 'Show Layout Grid'),
    snapToLayoutGrid: flag('snapToLayoutGrid', 'Snap to Layout Grid'),
    showFrameGrids: flag('showAllFrameGrids', 'Show Frame Grid'),
    showCharacterCount: flag('showCharacterCount', 'Show Character Count of frame grids'),
};

/**
 * Script helper: __grid(d) reads grid data (any of the grid data objects)
 * into a plain object; sizes are points, aki millimetres.
 */
const GRID_READ = String.raw`
var __grid = function (d) {
  var o = {}, keys = ["appliedFont", "fontStyle", "horizontalScale", "verticalScale", "characterAki", "lineAki", "characterAlignment", "lineAlignment", "gridAlignment", "gridView", "characterCountLocation"];
  for (var i = 0; i < keys.length; i++) {
    var v;
    try { v = d[keys[i]]; } catch (e) { continue; }
    if (v === undefined) continue;
    if (keys[i] === "appliedFont") { try { v = v.name; } catch (e2) { v = String(v); } }
    o[keys[i]] = (typeof v === "number" || typeof v === "string") ? v : __enumName(v);
  }
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    o.pointSize = d.pointSize;
    try { o.characterCountSize = d.characterCountSize; } catch (e3) {}
  } finally {
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
  }
  return o;
};
`;

/** Every grid data property, for copying a grid from one document to another. */
const GRID_COPY = ['appliedFont', 'fontStyle', 'pointSize', 'horizontalScale', 'verticalScale', 'characterAki', 'lineAki', 'characterAlignment',
    'lineAlignment', 'gridAlignment', 'gridView', 'characterCountLocation', 'characterCountSize'];

// ---------------------------------------------------------------------------
// Flex layout (InDesign 2026, 21.0)

const FLEX_SIZE = { fixed: 'FlexWidthHeightMode.FLEX_FIXED', fill: 'FlexWidthHeightMode.FLEX_FILL', auto: 'FlexEnum.FLEX_AUTO' };
const FLEX_ALIGN = { start: 'FlexPosition.FLEX_START', center: 'FlexPosition.FLEX_CENTER', end: 'FlexPosition.FLEX_END', auto: 'FlexEnum.FLEX_AUTO' };

/** Flex container options (Object > Flex Layout). */
const FLEX_FIELDS = {
    direction: pick('flexDirection', 'Direction the items run', {
        row: 'FlexDirection.FLEX_ROW', row_reverse: 'FlexDirection.FLEX_ROW_REVERSE',
        column: 'FlexDirection.FLEX_COLUMN', column_reverse: 'FlexDirection.FLEX_COLUMN_REVERSE',
    }),
    wrap: pick('flexWrap', 'Keep the items on one line, or wrap them onto more lines', {
        no_wrap: 'FlexWrap.NO_WRAP', wrap: 'FlexWrap.WRAP', wrap_reverse: 'FlexWrap.WRAP_REVERSE',
    }),
    alignItems: pick('alignItems', 'How items line up across the direction', FLEX_ALIGN),
    alignContent: pick('alignContent', 'How wrapped lines share extra space across the direction', FLEX_ALIGN),
    justifyContent: pick('justifyContent', 'How items share space along the direction', {
        start: 'FlexPosition.FLEX_START', center: 'FlexPosition.FLEX_CENTER', end: 'FlexPosition.FLEX_END',
        space_between: 'FlexSpacing.FLEX_SPACE_BETWEEN', space_around: 'FlexSpacing.FLEX_SPACE_AROUND', space_evenly: 'FlexSpacing.FLEX_SPACE_EVENLY',
    }),
    rowGap: mm('flexGapRow', 'Gap between rows', 0, 1000),
    columnGap: mm('flexGapColumn', 'Gap between columns', 0, 1000),
    paddingTop: mm('flexPaddingTop', 'Top padding', 0, 1000),
    paddingBottom: mm('flexPaddingBottom', 'Bottom padding', 0, 1000),
    paddingLeft: mm('flexPaddingLeft', 'Left padding', 0, 1000),
    paddingRight: mm('flexPaddingRight', 'Right padding', 0, 1000),
    width: pick('flexWidthMode', 'Width of the container: fixed, fill the space, or hug its items (auto)', FLEX_SIZE),
    height: pick('flexHeightMode', 'Height of the container: fixed, fill the space, or hug its items (auto)', FLEX_SIZE),
};

/** Sizing of each item inside a container. */
const FLEX_ITEM_FIELDS = {
    width: pick('flexItemWidthMode', 'Width of the item: fixed, fill the space, or fit its content (auto)', FLEX_SIZE),
    height: pick('flexItemHeightMode', 'Height of the item: fixed, fill the space, or fit its content (auto)', FLEX_SIZE),
};

const FLEX_SCHEMA = optionsSchema(FLEX_FIELDS, 'Flex layout settings (Object > Flex Layout); only the ones you pass change');
const FLEX_ITEM_SCHEMA = optionsSchema(FLEX_ITEM_FIELDS, 'Sizing of each item in the container');

/** DOM enum names back to this area's option values. */
const FLEX_NAMES = {
    FLEX_ROW: 'row', FLEX_ROW_REVERSE: 'row_reverse', FLEX_COLUMN: 'column', FLEX_COLUMN_REVERSE: 'column_reverse',
    NO_WRAP: 'no_wrap', WRAP: 'wrap', WRAP_REVERSE: 'wrap_reverse',
    FLEX_START: 'start', FLEX_CENTER: 'center', FLEX_END: 'end', FLEX_AUTO: 'auto',
    FLEX_SPACE_BETWEEN: 'space_between', FLEX_SPACE_AROUND: 'space_around', FLEX_SPACE_EVENLY: 'space_evenly',
    FLEX_FIXED: 'fixed', FLEX_FILL: 'fill',
};

/**
 * Script helpers for flex layout: __needFlex() refuses versions before 2026,
 * __flexInfo(fx) reads a container, its items, and the liquid layout settings
 * that also act on it.
 */
const FLEX_HELPERS = String.raw`
var __flexNames = ${json(FLEX_NAMES)};
var __fn = function (v) { var s = __enumName(v); return __flexNames[s] === undefined ? s : __flexNames[s]; };
var __needFlex = function () {
  if (parseFloat(app.version) < 21) throw new Error("Flex layout needs InDesign 2026 (21.0) or later; this is InDesign " + app.version);
};
var __flexBox = function (it) {
  if (it.constructor.name !== "FlexObject") throw new Error("Item " + it.id + " is a " + it.constructor.name + ", not a flex layout container");
  return it;
};
var __flexInfo = function (fx) {
  var o = {
    item: __itemInfo(fx), direction: __fn(fx.flexDirection), wrap: __fn(fx.flexWrap),
    alignItems: __fn(fx.alignItems), alignContent: __fn(fx.alignContent), justifyContent: __fn(fx.justifyContent),
    rowGap: fx.flexGapRow, columnGap: fx.flexGapColumn,
    padding: { top: fx.flexPaddingTop, bottom: fx.flexPaddingBottom, left: fx.flexPaddingLeft, right: fx.flexPaddingRight },
    widthMode: __fn(fx.flexWidthMode), heightMode: __fn(fx.flexHeightMode), items: [], conflicts: [], pageLiquidRule: null, constraints: null
  }, i;
  var kids = fx.pageItems.everyItem().getElements();
  for (i = 0; i < kids.length; i++) o.items.push({ id: kids[i].id, type: kids[i].constructor.name, width: __fn(kids[i].flexItemWidthMode), height: __fn(kids[i].flexItemHeightMode) });
  var pg = __pageOf(fx);
  if (pg && pg.layoutRule != LayoutRuleOptions.OFF) {
    o.pageLiquidRule = __enumName(pg.layoutRule);
    o.conflicts.push("The page's liquid layout rule (" + o.pageLiquidRule + ") also moves or resizes this container when the page size changes; the container then reflows its items. Set the page rule to OFF to keep only the flex layout.");
    if (pg.layoutRule == LayoutRuleOptions.OBJECT_BASED) {
      var h = fx.horizontalLayoutConstraints, v = fx.verticalLayoutConstraints;
      o.constraints = { horizontal: [__enumName(h[0]), __enumName(h[1]), __enumName(h[2])], vertical: [__enumName(v[0]), __enumName(v[1]), __enumName(v[2])] };
    }
  }
  return o;
};
`;

// ---------------------------------------------------------------------------
// Linked content

const LINK_ITEM_FIELDS = {
    updateWhileSaving: { item: 'updateLinkWhileSaving', story: 'updateWhileSaving', description: 'Update Link When Saving Document' },
    warnOnUpdate: { item: 'warnOnUpdateOfEditedPageItem', story: 'warnOnUpdateOfEditedStory', description: 'Warn if Link Update Will Overwrite Local Edits' },
    preserveAppearance: { item: 'preserveAppearance', description: 'Preserve Local Edits: Appearance (fill, stroke, effects)' },
    preserveSizeAndShape: { item: 'preserveSizeAndShape', description: 'Preserve Local Edits: Size and Shape' },
    preserveInteractivity: { item: 'preserveInteractivity', description: 'Preserve Local Edits: Interactivity' },
    preserveFrameContent: { item: 'preserveFrameContent', description: 'Preserve Local Edits: Frame Content' },
    preserveOthers: { item: 'preserveOthers', description: 'Preserve Local Edits: Others' },
    removeForcedLineBreaks: { story: 'removeForcedLineBreaks', description: 'Remove Forced Line Breaks from Story (linked stories)' },
    mapStyles: { story: 'applyStyleMappings', description: 'Apply the custom style mappings to linked stories (Define Custom Style Mapping; see manage_style_mappings)' },
};

/** Script helper: __linkRead(po, so) reads link options of a page item and/or a story. */
const LINK_READ = String.raw`
var __linkRead = function (po, so) {
  var o = {};
  if (po) o.pageItem = { updateWhileSaving: po.updateLinkWhileSaving, warnOnUpdate: po.warnOnUpdateOfEditedPageItem, preserveAppearance: po.preserveAppearance, preserveSizeAndShape: po.preserveSizeAndShape, preserveInteractivity: po.preserveInteractivity, preserveFrameContent: po.preserveFrameContent, preserveOthers: po.preserveOthers };
  if (so) o.story = { updateWhileSaving: so.updateWhileSaving, warnOnUpdate: so.warnOnUpdateOfEditedStory, removeForcedLineBreaks: so.removeForcedLineBreaks, mapStyles: so.applyStyleMappings };
  return o;
};
`;

const MAPPING_KINDS = { paragraph: 'paraStyleMappings', character: 'charStyleMappings', table: 'tableStyleMappings', cell: 'cellStyleMappings' };
const MAPPING_RULES = { style: 'STYLE_MAPPING_RULE', group: 'GROUP_MAPPING_RULE', style_to_group: 'STYLE_TO_GROUP_MAPPING_RULE', group_to_style: 'GROUP_TO_STYLE_MAPPING_RULE' };

// ---------------------------------------------------------------------------
// Rulers and guides

/** Ruler units, in the order of the ruler context menu (the order cycling steps through). */
const RULER_UNITS = ['POINTS', 'PICAS', 'INCHES', 'INCHES_DECIMAL', 'MILLIMETERS', 'CENTIMETERS', 'CICEROS', 'AGATES', 'PIXELS'];
const OTHER_UNITS = ['AMERICAN_POINTS', 'BAI', 'HA', 'MILS', 'Q', 'U'];

/** Script helper: __guideInfo(g) describes a guide, its position relative to its page. */
const GUIDE_HELPERS = String.raw`
var __guideInfo = function (g) {
  var o = { id: g.id, orientation: __enumName(g.orientation), type: __enumName(g.guideType), locked: g.locked, location: g.location };
  var pg = null;
  try { if (g.parentPage && g.parentPage.isValid) pg = g.parentPage; } catch (e) {}
  o.page = pg ? pg.name : null;
  o.pageIndex = pg ? pg.documentOffset : null;
  if (pg) o.position = g.location - (g.orientation == HorizontalOrVertical.HORIZONTAL ? pg.bounds[0] : pg.bounds[1]);
  try { o.spreadIndex = g.parent.index; } catch (e2) {}
  return o;
};
var __guides = function (doc, spec) {
  var out = [], i;
  if (spec.guideIds) {
    for (i = 0; i < spec.guideIds.length; i++) {
      var g = doc.guides.itemByID(spec.guideIds[i]);
      if (!g.isValid) throw new Error("Guide " + spec.guideIds[i] + " not found");
      out.push(g.getElements()[0]);
    }
    return out;
  }
  if (spec.page !== null) return __page(doc, spec.page).guides.everyItem().getElements();
  if (spec.spread !== null) {
    if (spec.spread >= doc.spreads.length) throw new Error("Spread index " + spec.spread + " is out of range; the document has " + doc.spreads.length + " spreads");
    return doc.spreads[spec.spread].guides.everyItem().getElements();
  }
  return doc.guides.everyItem().getElements();
};
`;

/** Reference points on an item: [fraction across, fraction down]. */
const POINTS = {
    top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
    bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1],
};

const POINT_SCHEMA = (what) => ({
    type: 'object',
    description: `${what}: an item (id, and which point of it) or a point on a page (pageIndex, x, y)`,
    properties: {
        id: { type: 'integer', minimum: 0, description: 'Page item id' },
        point: { type: 'string', enum: Object.keys(POINTS), description: 'Which point of the item (default center)' },
        pageIndex: { type: 'integer', minimum: 0, description: 'Page of a free point (0-based)' },
        x: { type: 'number', description: 'Free point: mm from the left of the page' },
        y: { type: 'number', description: 'Free point: mm from the top of the page' },
    },
});

/** A measuring point as a JSX literal for __pt(). */
function pointSpec(p, label) {
    if (!p || typeof p !== 'object') throw new Error(`'${label}' is required`);
    if (p.id !== undefined) {
        if (p.pageIndex !== undefined || p.x !== undefined || p.y !== undefined) throw new Error(`'${label}': give an item id or pageIndex, x and y, not both`);
        const [fx, fy] = POINTS[enumOf(p.point ?? 'center', Object.keys(POINTS), { name: `${label}.point` })];
        return json({ id: Number(index(p.id, { name: `${label}.id`, max: 1e9 })), fx, fy, page: null, x: 0, y: 0 });
    }
    if (p.point !== undefined) throw new Error(`'${label}.point' applies to an item`);
    if (p.pageIndex === undefined || p.x === undefined || p.y === undefined) throw new Error(`'${label}' needs an item id, or pageIndex, x and y`);
    return json({
        id: null, fx: 0, fy: 0, page: Number(index(p.pageIndex, { name: `${label}.pageIndex` })),
        x: Number(num(p.x, { min: -10000, max: 10000, name: `${label}.x` })), y: Number(num(p.y, { min: -10000, max: 10000, name: `${label}.y` })),
    });
}

const LAYOUT_RULES = ['OFF', 'SCALE', 'RECENTER', 'GUIDE_BASED', 'OBJECT_BASED', 'PRESERVE_EXISTING'];

/** Script helper: __layouts(doc) lists the alternate layouts with their page counts and page size. */
const LAYOUTS_READ = String.raw`
var __layoutOf = function (p) {
  var s = p.appliedAlternateLayout;
  return (s && s.isValid) ? s.alternateLayout : "";
};
var __layouts = function (doc) {
  var out = [], seen = {}, i;
  for (i = 0; i < doc.pages.length; i++) {
    var p = doc.pages[i], n = __layoutOf(p);
    if (seen[n] === undefined) {
      seen[n] = out.length;
      var b = p.bounds;
      out.push({ name: n, firstPageIndex: i, pageCount: 0, width: b[3] - b[1], height: b[2] - b[0] });
    }
    out[seen[n]].pageCount++;
  }
  return out;
};
`;

// ---------------------------------------------------------------------------

export const tools = [
    // ----- #222 Alternate, liquid and flex layouts -----
    {
        name: 'set_liquid_layout',
        description: 'Set how items adapt when their page is resized under the object-based liquid page rule: resize with the page (width, height) and pin to the page edges, plus Auto-Fit of frame content (Liquid Layout panel). The page rule itself is set with set_page_properties (layoutRule).',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                resizeWidth: { type: 'boolean', description: 'Resize with Page: Width (the width is flexible)' },
                resizeHeight: { type: 'boolean', description: 'Resize with Page: Height (the height is flexible)' },
                pinTop: { type: 'boolean', description: 'Pin: Top (the top margin stays fixed)' },
                pinBottom: { type: 'boolean', description: 'Pin: Bottom (the bottom margin stays fixed)' },
                pinLeft: { type: 'boolean', description: 'Pin: Left (the left margin stays fixed)' },
                pinRight: { type: 'boolean', description: 'Pin: Right (the right margin stays fixed)' },
                autoFit: { type: 'boolean', description: 'Auto-Fit: refit the frame content when the frame resizes (graphic frames)' },
            },
            required: ['target'],
        },
        features: L(['liquid_layout']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const t = targetSpec(a.target);
            const F = 'DimensionsConstraints.FIXED_DIMENSION', X = 'DimensionsConstraints.FLEXIBLE_DIMENSION';
            const h = [], v = [];
            const put = (list, i, key, fixedWhenTrue) => {
                const b = optBool(a[key], key);
                if (b !== undefined) list.push(`H[${i}] = ${(b === fixedWhenTrue) ? F : X};`);
            };
            put(h, 0, 'pinLeft', true); put(h, 1, 'resizeWidth', false); put(h, 2, 'pinRight', true);
            put(v, 0, 'pinTop', true); put(v, 1, 'resizeHeight', false); put(v, 2, 'pinBottom', true);
            const fit = optBool(a.autoFit, 'autoFit');
            if (!h.length && !v.length && fit === undefined) throw new Error('Nothing to set: give resizeWidth, resizeHeight, a pin option or autoFit');
            const axis = (prop, list) => (list.length ? `var c = it.${prop}, H = [c[0], c[1], c[2]];\n${list.join('\n')}\nit.${prop} = H;` : '');
            return run('Set liquid layout', script(`
var items = __targets(doc, ${t}), out = [];
var fixed = function (c) { return c == DimensionsConstraints.FIXED_DIMENSION; };
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${axis('horizontalLayoutConstraints', h)}
  ${axis('verticalLayoutConstraints', v)}
  ${fit === undefined ? '' : `try { it.frameFittingOptions.autoFit = ${bool(fit)}; } catch (e) { throw new Error("Item " + it.id + " (" + it.constructor.name + ") has no Auto-Fit"); }`}
  var hc = it.horizontalLayoutConstraints, vc = it.verticalLayoutConstraints, pg = __pageOf(it);
  out.push({
    item: __itemInfo(it), pageLiquidRule: pg ? __enumName(pg.layoutRule) : null,
    liquid: { pinLeft: fixed(hc[0]), resizeWidth: !fixed(hc[1]), pinRight: fixed(hc[2]), pinTop: fixed(vc[0]), resizeHeight: !fixed(vc[1]), pinBottom: fixed(vc[2]) }
  });
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'create_alternate_layout',
        description: 'Create an alternate layout: copy the pages of a layout to a new page size and orientation in the same document, with a liquid page rule, linked stories and copied text styles (Layout > Create Alternate Layout)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the new layout' },
                from: { type: 'string', description: 'From Source Pages: the layout to copy (default the first page\'s layout); see manage_alternate_layouts' },
                width: { type: 'number', minimum: 1, maximum: 5486.4, description: 'Page width of the new layout (mm)' },
                height: { type: 'number', minimum: 1, maximum: 5486.4, description: 'Page height of the new layout (mm)' },
                orientation: { type: 'string', enum: ['portrait', 'landscape'], description: 'Orientation; swaps width and height when they do not match it' },
                liquidPageRule: { type: 'string', enum: LAYOUT_RULES, default: 'PRESERVE_EXISTING', description: 'Liquid Page Rule applied to the new pages' },
                linkStories: { type: 'boolean', default: true, description: 'Link Stories: the new stories are linked copies of the source stories' },
                copyTextStyles: { type: 'boolean', default: true, description: 'Copy Text Styles to New Style Group' },
                smartTextReflow: { type: 'boolean', description: 'Smart Text Reflow: add or remove pages as text reflows (the document\'s Type preference, which covers every layout)' },
            },
            required: ['name', 'width', 'height'],
        },
        features: L(['alternate_layouts', 'alt_layout_name_alternate_layout', 'alt_layout_from_source_pages', 'alt_layout_page_size_and_orientation_alternate_layout',
            'alt_layout_liquid_page_rule_alternate_layout', 'alt_layout_link_stories', 'alt_layout_copy_text_styles_to_new_style_group',
            'alt_layout_smart_text_reflow_alternate_layout']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const n = name(a.name, 'name');
            const from = a.from === undefined ? null : name(a.from, 'from');
            let w = Number(num(a.width, { min: 1, max: 5486.4, name: 'width' }));
            let h = Number(num(a.height, { min: 1, max: 5486.4, name: 'height' }));
            if (a.orientation !== undefined) {
                const o = enumOf(a.orientation, ['portrait', 'landscape'], { name: 'orientation' });
                if ((o === 'portrait' && w > h) || (o === 'landscape' && h > w)) [w, h] = [h, w];
            }
            const rule = enumOf(a.liquidPageRule ?? 'PRESERVE_EXISTING', LAYOUT_RULES, { name: 'liquidPageRule' });
            const link = optBool(a.linkStories, 'linkStories') ?? true;
            const styles = optBool(a.copyTextStyles, 'copyTextStyles') ?? true;
            const reflow = optBool(a.smartTextReflow, 'smartTextReflow');
            return run('Create alternate layout', script(`${LAYOUTS_READ}
var name = ${str(n)}, from = ${from === null ? 'null' : str(from)}, spreads = [], i;
var before = __layouts(doc);
if (from === null) from = before[0].name;
for (i = 0; i < before.length; i++) if (before[i].name == name) throw new Error("A layout named " + name + " already exists");
for (i = 0; i < doc.spreads.length; i++) if (__layoutOf(doc.spreads[i].pages[0]) == from) spreads.push(doc.spreads[i]);
if (!spreads.length) throw new Error("No layout named " + from);
${reflow === undefined ? '' : `doc.textPreferences.smartTextReflow = ${bool(reflow)};`}
doc.createAlternateLayout(spreads, name, ${w}, ${h}, ${bool(styles)}, ${bool(link)}, LayoutRuleOptions.${rule});
__result__ = { created: name, from: from, smartTextReflow: doc.textPreferences.smartTextReflow, layouts: __layouts(doc) };`));
        },
    },
    {
        name: 'manage_alternate_layouts',
        description: 'List the document\'s layouts (alternate layouts) with their page counts and page sizes, or delete an alternate layout and its pages (Pages panel > Alternate Layout menu > Delete Alternate Layout)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'delete'], description: 'list the layouts, or delete one' },
                name: { type: 'string', description: 'delete: the layout to delete' },
            },
            required: ['action'],
        },
        features: L(['alternate_layouts']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'delete', name: 'iPad H' },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'delete'], { name: 'action' });
            if (action === 'list') {
                if (a.name !== undefined) throw new Error("'name' applies to delete");
                return run('List alternate layouts', script(`${LAYOUTS_READ}\n__result__ = { layouts: __layouts(doc) };`));
            }
            const n = name(a.name, 'name');
            return run('Delete alternate layout', script(`${LAYOUTS_READ}
var name = ${str(n)}, all = __layouts(doc), found = false;
for (var i = 0; i < all.length; i++) if (all[i].name == name) found = true;
if (!found) throw new Error("No layout named " + name);
if (all.length < 2) throw new Error("The document has only one layout; it cannot be deleted");
doc.deleteAlternateLayout(name);
__result__ = { deleted: name, layouts: __layouts(doc) };`));
        },
    },
    {
        name: 'create_flex_layout',
        description: 'Put items in a flex layout container that arranges them in rows or columns which resize and reflow together, for example a wrapping grid of profile cards for team pages; a group is converted (Flex Layout > Convert to Flex Layout / Add to Flex Layout). Needs InDesign 2026 (21.0) or later.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The items to arrange, in order; a group\'s items are taken out of the group (Convert to Flex Layout)' },
                container: { type: 'integer', minimum: 0, description: 'Add the items to this existing flex container (its id) instead of creating one' },
                layout: FLEX_SCHEMA,
                itemSizing: FLEX_ITEM_SCHEMA,
                ungroup: { type: 'boolean', default: true, description: 'Take the items out of a chosen group and add them one by one (false adds the group as one item)' },
            },
            required: ['target'],
        },
        features: L(['flex_layout', 'flex_team_pages', 'context_convert_to_flex_layout', 'context_add_to_flex_layout']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { container: undefined },
        handler: (a) => {
            const t = targetSpec(a.target);
            const cid = a.container === undefined ? null : index(a.container, { name: 'container', max: 1e9 });
            const lay = writeOptions('fx', FLEX_FIELDS, a.layout, 'layout');
            const sizing = writeOptions('add[i]', FLEX_ITEM_FIELDS, a.itemSizing, 'itemSizing');
            const ungroup = optBool(a.ungroup, 'ungroup') ?? true;
            return run('Create flex layout', script(`${FLEX_HELPERS}
__needFlex();
var items = __targets(doc, ${t}), add = [], i, j;
for (i = 0; i < items.length; i++) {
  var it = items[i];
  if (${bool(ungroup)} && it.constructor.name === "Group") {
    var kids = it.pageItems.everyItem().getElements();
    it.ungroup();
    for (j = 0; j < kids.length; j++) add.push(kids[j]);
  } else add.push(it);
}
var fx, created = false, top = 1e9, left = 1e9;
${cid === null ? `var pg = __pageOf(add[0]);
if (!pg) throw new Error("The items must be on a page");
for (i = 0; i < add.length; i++) { var g = add[i].geometricBounds; if (g[0] < top) top = g[0]; if (g[1] < left) left = g[1]; }
fx = pg.flexObjects.add();
created = true;
try { fx.itemLayer = add[0].itemLayer; } catch (e) {}` : `fx = __flexBox(__item(doc, ${cid}));`}
${applyOptions(lay)}
for (i = 0; i < add.length; i++) {
  fx.addFlexObject(add[i]);
  ${applyOptions(sizing)}
}
if (created) fx.move([left, top]);
__result__ = { created: created, container: __flexInfo(fx) };`));
        },
    },
    {
        name: 'set_flex_layout',
        description: 'Set a flex layout container\'s direction, wrapping, alignment, gaps, padding and sizing, and how its items size (Object > Flex Layout). Needs InDesign 2026 (21.0) or later.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The flex containers (ids from create_flex_layout or get_flex_layout)' },
                layout: FLEX_SCHEMA,
                items: {
                    type: 'array',
                    description: 'Sizing for individual items in the containers',
                    items: {
                        type: 'object',
                        properties: { id: { type: 'integer', minimum: 0, description: 'The item id' }, ...FLEX_ITEM_SCHEMA.properties },
                        required: ['id'],
                    },
                },
            },
            required: ['target'],
        },
        features: L(['flex_layout_properties']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const t = targetSpec(a.target);
            const lay = writeOptions('fx', FLEX_FIELDS, a.layout, 'layout');
            if (a.items !== undefined && !Array.isArray(a.items)) throw new Error("'items' must be a list");
            const per = (a.items ?? []).map((e, k) => {
                if (!e || typeof e !== 'object') throw new Error(`'items[${k}]' must be an object`);
                const { id, ...rest } = e;
                const s = writeOptions('x', FLEX_ITEM_FIELDS, rest, `items[${k}]`);
                if (!count(s)) throw new Error(`'items[${k}]' sets nothing: give width or height`);
                return `x = __item(doc, ${index(id, { name: `items[${k}].id`, max: 1e9 })});\n${applyOptions(s)}`;
            });
            if (!count(lay) && !per.length) throw new Error('Nothing to set: give layout options or items');
            return run('Set flex layout', script(`${FLEX_HELPERS}
__needFlex();
var boxes = __targets(doc, ${t}), out = [], x, i;
for (i = 0; i < boxes.length; i++) {
  var fx = __flexBox(boxes[i]);
  ${applyOptions(lay)}
}
${per.join('\n')}
for (i = 0; i < boxes.length; i++) out.push(__flexInfo(boxes[i]));
__result__ = { containers: out };`));
        },
    },
    {
        name: 'get_flex_layout',
        description: 'Read flex layout containers: their settings, their items and how each sizes, and the liquid layout settings that also act on them and can conflict with the flex layout (Object > Flex Layout). Needs InDesign 2026 (21.0) or later.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The flex containers to read (default every container on the page, or in the document)' },
                pageIndex: { type: 'integer', minimum: 0, description: 'Read the containers on this page (0-based)' },
            },
        },
        features: L(['flex_conflicts', 'flex_layout_properties']),
        hints: { readOnly: true, destructive: false, idempotent: true },
        auditArgs: { target: undefined },
        handler: (a) => {
            if (a.target !== undefined && a.pageIndex !== undefined) throw new Error('Give target or pageIndex, not both');
            const pick = a.target !== undefined ? `var boxes = __targets(doc, ${targetSpec(a.target)});`
                : a.pageIndex !== undefined ? `var boxes = __page(doc, ${index(a.pageIndex, { name: 'pageIndex' })}).flexObjects.everyItem().getElements();`
                    : 'var boxes = doc.flexObjects.everyItem().getElements();';
            return run('Get flex layout', script(`${FLEX_HELPERS}
__needFlex();
${pick}
var out = [];
for (var i = 0; i < boxes.length; i++) out.push(__flexInfo(__flexBox(boxes[i])));
__result__ = { containers: out };`));
        },
    },

    // ----- #223 Named grids, frame grids, linked content, Content Collector -----
    {
        name: 'manage_named_grids',
        description: 'List, create, edit or delete named grids (frame grid formats), or load all named grids from another InDesign document (Named Grids panel: New Named Grid, Named Grid Options, Delete Named Grids, Load All Named Grids)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'load'], description: 'What to do' },
                name: { type: 'string', description: 'create, update, delete: the named grid' },
                newName: { type: 'string', description: 'update: rename the grid' },
                grid: optionsSchema(GRID_FIELDS, 'create, update: grid format options (Named Grid Options); only the ones you pass change'),
                filePath: { type: 'string', description: 'load: the InDesign document (.indd) to load named grids from' },
                replace: { type: 'boolean', default: false, description: 'load: replace grids with the same name (otherwise they are skipped)' },
            },
            required: ['action'],
        },
        features: L(['named_grids', 'named_grids_menu_new_named_grid', 'named_grids_menu_named_grid_options', 'named_grids_menu_delete_named_grids', 'named_grids_menu_load_all_named_grids']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'update', name: 'Body grid', newName: 'Body grid 2', filePath: undefined, replace: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'create', 'update', 'delete', 'load'], { name: 'action' });
            const allow = { list: [], create: ['name', 'grid'], update: ['name', 'newName', 'grid'], delete: ['name'], load: ['filePath', 'replace'] }[action];
            for (const k of ['name', 'newName', 'grid', 'filePath', 'replace']) {
                if (a[k] !== undefined && !allow.includes(k)) throw new Error(`'${k}' does not apply to ${action}`);
            }
            const read = `${GRID_READ}
var __list = function () {
  var out = [], all = doc.namedGrids.everyItem().getElements();
  for (var i = 0; i < all.length; i++) out.push({ name: all[i].name, grid: __grid(all[i].gridData) });
  return out;
};`;
            if (action === 'list') return run('List named grids', script(`${read}\n__result__ = { namedGrids: __list() };`));
            if (action === 'load') {
                const file = jsxPath(validateFilePath(a.filePath));
                const replace = optBool(a.replace, 'replace') ?? false;
                const copy = GRID_COPY.map((p) => `    t.gridData.${p} = d.${p};`).join('\n');
                return run('Load named grids', script(`${read}
var f = File(${file});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var src = null, opened = false, i;
for (i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName == f.fsName) src = app.documents[i]; } catch (e) {} }
if (src === null) { src = app.open(f, false); opened = true; }
var loaded = [], skipped = [];
try {
  if (src == doc) throw new Error("That is the active document");
  var grids = src.namedGrids.everyItem().getElements();
  for (i = 0; i < grids.length; i++) {
    var g = grids[i], d = g.gridData, t = doc.namedGrids.itemByName(g.name);
    if (t.isValid && !${bool(replace)}) { skipped.push(g.name); continue; }
    if (!t.isValid) t = doc.namedGrids.add({ name: g.name });
${copy}
    loaded.push(g.name);
  }
} finally {
  if (opened) src.close(SaveOptions.NO);
}
__result__ = { loaded: loaded, skipped: skipped, namedGrids: __list() };`));
            }
            const n = name(a.name, 'name');
            const find = `var g = doc.namedGrids.itemByName(${str(n)});\nif (!g.isValid) throw new Error("No named grid called " + ${str(n)});`;
            if (action === 'delete') {
                return run('Delete named grid', script(`${read}\n${find}\ng.remove();\n__result__ = { deleted: ${str(n)}, namedGrids: __list() };`));
            }
            const opts = writeOptions('g.gridData', GRID_FIELDS, a.grid, 'grid');
            const newName = a.newName === undefined ? undefined : name(a.newName, 'newName');
            if (action === 'update' && !count(opts) && newName === undefined) throw new Error('update needs grid options or newName');
            const clash = (x) => `if (doc.namedGrids.itemByName(${str(x)}).isValid) throw new Error("A named grid called " + ${str(x)} + " already exists");`;
            const head = action === 'create' ? `${clash(n)}\nvar g = doc.namedGrids.add({ name: ${str(n)} });`
                : `${find}${newName !== undefined && newName !== n ? `\n${clash(newName)}\ng.name = ${str(newName)};` : ''}`;
            return run(action === 'create' ? 'Create named grid' : 'Edit named grid', script(`${read}
${head}
${applyOptions(opts)}
__result__ = { action: "${action}", name: g.name, grid: __grid(g.gridData) };`));
        },
    },
    {
        name: 'set_frame_grid',
        description: 'Set frame grid options (font, size, scale, aki, alignment, view and character count), apply a named grid, or apply the grid format to the text so it matches the grid (Object > Frame Grid Options, Edit > Apply Grid Format)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The frame grids (text frames)' },
                namedGrid: { type: 'string', description: 'Apply this named grid to the frames\' stories' },
                grid: optionsSchema(GRID_FIELDS, 'Frame Grid Options; only the ones you pass change'),
                applyGridFormat: { type: 'boolean', description: 'Apply Grid Format: set the stories\' font, size and scaling to the grid\'s' },
            },
            required: ['target'],
        },
        features: L(['frame_grid_options', 'frame_grid_character_count', 'apply_grid_format']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { namedGrid: 'Body grid' },
        handler: (a) => {
            const t = targetSpec(a.target);
            const opts = writeOptions('it.gridData', GRID_FIELDS, a.grid, 'grid');
            const ng = a.namedGrid === undefined ? null : name(a.namedGrid, 'namedGrid');
            const fmt = optBool(a.applyGridFormat, 'applyGridFormat');
            if (!count(opts) && ng === null && !fmt) throw new Error('Nothing to set: give grid options, namedGrid or applyGridFormat: true');
            const apply = ng === null ? '' : 'it.parentStory.appliedNamedGrid = ng;';
            return run('Set frame grid', script(`${GRID_READ}
var items = __targets(doc, ${t}), out = [], i;
${ng !== null ? `var ng = doc.namedGrids.itemByName(${str(ng)});\nif (!ng.isValid) throw new Error("No named grid called " + ${str(ng)});` : ''}
for (i = 0; i < items.length; i++) {
  var it = items[i];
  if (it.constructor.name !== "TextFrame") throw new Error("Item " + it.id + " is a " + it.constructor.name + ", not a frame grid");
  ${apply}
  ${applyOptions(opts)}
  ${fmt ? `var d = it.gridData, tx = it.parentStory.texts[0];
  tx.appliedFont = d.appliedFont;
  try { tx.fontStyle = d.fontStyle; } catch (e) {}
  tx.pointSize = d.pointSize;
  tx.horizontalScale = d.horizontalScale;
  tx.verticalScale = d.verticalScale;` : ''}
  var gn = null;
  try { gn = it.parentStory.appliedNamedGrid.name; } catch (e2) {}
  out.push({ item: __itemInfo(it), namedGrid: gn, grid: __grid(it.gridData) });
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'set_layout_grid',
        description: 'Set the document\'s layout grid (font, size, scale and aki of its character cells) and which grids show: layout grid, frame grids, character counts, and snapping to the layout grid (Layout > Layout Grid; View > Grids & Guides). Layout and frame grids are part of the Japanese (CJK) feature set.',
        inputSchema: {
            type: 'object',
            properties: {
                grid: optionsSchema(LAYOUT_GRID_FIELDS, 'Layout Grid options; only the ones you pass change'),
                view: optionsSchema(GRID_VIEW_FIELDS, 'Grid display (View > Grids & Guides)'),
            },
        },
        features: L(['layout_grid', 'show_layout_grid', 'frame_grid_character_count']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const g = writeOptions('doc.layoutGridData', LAYOUT_GRID_FIELDS, a.grid, 'grid');
            const v = writeOptions('doc.cjkGridPreferences', GRID_VIEW_FIELDS, a.view, 'view');
            return run('Set layout grid', script(`${GRID_READ}
${applyOptions(g, v)}
var c = doc.cjkGridPreferences;
__result__ = { grid: __grid(doc.layoutGridData), view: { showLayoutGrids: c.showAllLayoutGrids, snapToLayoutGrid: c.snapToLayoutGrid, showFrameGrids: c.showAllFrameGrids, showCharacterCount: c.showCharacterCount } };`));
        },
    },
    {
        name: 'place_linked_copies',
        description: 'Place copies of items or stories on a page, in this or another open document, as linked content that updates when the source changes (Edit > Place and Link; the Content Placer tool)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The source items (text frames place their stories)' },
                pageIndex: { type: 'integer', minimum: 0, description: 'The page to place on (0-based)' },
                toDocument: { type: 'string', description: 'Name of another open document to place into (default the active document)' },
                x: { type: 'number', description: 'mm from the left of the page (default the source\'s position on its own page)' },
                y: { type: 'number', description: 'mm from the top of the page (default the source\'s position on its own page)' },
                linkItems: { type: 'boolean', default: true, description: 'Create Link for page items: the copies stay linked to their source' },
                linkStories: { type: 'boolean', default: true, description: 'Create Link for stories: the copied stories stay linked to their source' },
                mapStyles: { type: 'boolean', default: false, description: 'Map Styles: apply the custom style mappings (manage_style_mappings) to the copies' },
                layer: { type: 'string', description: 'Layer to place on (default the source\'s layer, if the target document has it)' },
            },
            required: ['target', 'pageIndex'],
        },
        features: L(['place_and_link', 'content_placer', 'linked_content']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { toDocument: undefined },
        handler: (a) => {
            const t = targetSpec(a.target);
            const p = index(a.pageIndex, { name: 'pageIndex' });
            if ((a.x === undefined) !== (a.y === undefined)) throw new Error('Give both x and y, or neither');
            const at = a.x === undefined ? null : [num(a.x, { min: -10000, max: 10000, name: 'x' }), num(a.y, { min: -10000, max: 10000, name: 'y' })];
            const li = optBool(a.linkItems, 'linkItems') ?? true;
            const ls = optBool(a.linkStories, 'linkStories') ?? true;
            const ms = optBool(a.mapStyles, 'mapStyles') ?? false;
            const dest = a.toDocument === undefined ? null : name(a.toDocument, 'toDocument');
            const layer = a.layer === undefined ? null : name(a.layer, 'layer');
            return run('Place linked copies', script(`
var items = __targets(doc, ${t}), dest = doc;
${dest === null ? '' : `dest = app.documents.itemByName(${str(dest)});\nif (!dest.isValid) throw new Error("No open document named " + ${str(dest)});`}
var pg = __page(dest, ${p});
var first = __itemInfo(items[0]);
var pt = ${at === null ? '__toPage(pg, first.x || 0, first.y || 0)' : `__toPage(pg, ${at[0]}, ${at[1]})`};
var ly = dest.layers.itemByName(${layer === null ? 'items[0].itemLayer.name' : str(layer)});
if (!ly.isValid) ${layer === null ? 'ly = dest.activeLayer;' : `throw new Error("No layer named " + ${str(layer)})`}
var placed = pg.contentPlace(items, ${bool(li)}, ${bool(ls)}, ${bool(ms)}, pt, ly, false), out = [];
for (var i = 0; i < placed.length; i++) { try { out.push(__itemInfo(placed[i])); } catch (e) {} }
__result__ = { document: dest.name, placed: out };`));
        },
    },
    {
        name: 'set_link_options',
        description: 'Set the link options of linked items and linked stories, or the document defaults: update when saving, warn before overwriting local edits, which local edits to preserve, removing forced line breaks and applying style mappings (Links panel > Link Options). Pass no options to read them.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The linked items; text frames set their story\'s options' },
                documentDefaults: { type: 'boolean', description: 'Set the document\'s default link options instead of (or as well as) items\'' },
                ...Object.fromEntries(Object.entries(LINK_ITEM_FIELDS).map(([k, f]) => [k, { type: 'boolean', description: `${f.description}${f.item && f.story ? ' (items and stories)' : f.story ? ' (stories)' : ' (page items)'}` }])),
            },
        },
        features: L(['linked_content', 'link_options_update_link_when_saving_document', 'link_options_warn_if_link_update_will_overwrite_local_edits',
            'link_options_preserve_local_edits_appearance', 'link_options_preserve_local_edits_size_and_shape', 'link_options_preserve_local_edits_interactivity',
            'link_options_preserve_local_edits_frame_content', 'link_options_preserve_local_edits_others', 'link_options_remove_forced_line_breaks_from_story']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const defaults = optBool(a.documentDefaults, 'documentDefaults') ?? false;
            if (a.target === undefined && !defaults) throw new Error('Choose target items, or documentDefaults: true');
            const item = [], story = [];
            for (const [k, f] of Object.entries(LINK_ITEM_FIELDS)) {
                const v = optBool(a[k], k);
                if (v === undefined) continue;
                if (f.item) item.push(`po.${f.item} = ${bool(v)};`);
                if (f.story) story.push(`so.${f.story} = ${bool(v)};`);
            }
            const items = a.target === undefined ? '' : `
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var it = items[i], po = it.linkedPageItemOptions, so = null;
  if (it.constructor.name === "TextFrame") so = it.parentStory.linkedStoryOptions;
  ${item.join(' ')}
  if (so) { ${story.join(' ')} }
  out.items.push({ id: it.id, options: __linkRead(po, so) });
}`;
            return run('Set link options', script(`${LINK_READ}
var out = { items: [], documentDefaults: null }, po, so;
${defaults ? `po = doc.linkedPageItemOptions; so = doc.linkedStoryOptions;\n${item.join('\n')}\n${story.join('\n')}\nout.documentDefaults = __linkRead(po, so);` : ''}
${items}
__result__ = out;`));
        },
    },
    {
        name: 'manage_style_mappings',
        description: 'List, add or remove the document\'s custom style mappings, which map source styles to other styles when linked content is placed or updated with style mapping on (Link Options > Define Custom Style Mapping; Content Placer > Edit Custom Style Mapping)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'add (or change) a mapping, remove one, or list them' },
                kind: { type: 'string', enum: Object.keys(MAPPING_KINDS), description: 'add, remove: paragraph, character, table or cell styles' },
                source: { type: 'string', description: 'add, remove: the source style (or style group) name' },
                destination: { type: 'string', description: 'add: the style (or style group) it maps to' },
                rule: { type: 'string', enum: Object.keys(MAPPING_RULES), default: 'style', description: 'add: map style to style, group to group, style to group, or group to style' },
            },
            required: ['action'],
        },
        features: L(['link_options_define_custom_style_mapping', 'content_placer_opt_edit_custom_style_mapping']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'add', kind: 'paragraph', source: 'Heading', destination: 'Heading Tablet' },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'add', 'remove'], { name: 'action' });
            const list = `
var __maps = function () {
  var out = [], kinds = ${json(MAPPING_KINDS)};
  for (var k in kinds) {
    if (!kinds.hasOwnProperty(k)) continue;
    var c = doc[kinds[k]];
    for (var i = 0; i < c.length; i++) { var m = c.item(i); out.push({ kind: k, source: m.sourceStyleName, destination: m.destinationStyleName, rule: __enumName(m.mappingRuleType) }); }
  }
  return out;
};`;
            if (action === 'list') {
                for (const k of ['kind', 'source', 'destination', 'rule']) if (a[k] !== undefined) throw new Error(`'${k}' does not apply to list`);
                return run('List style mappings', script(`${list}\n__result__ = { mappings: __maps() };`));
            }
            const coll = MAPPING_KINDS[enumOf(a.kind, Object.keys(MAPPING_KINDS), { name: 'kind' })];
            const src = name(a.source, 'source');
            const find = `var c = doc.${coll}, hit = null;\nfor (var i = 0; i < c.length; i++) if (c.item(i).sourceStyleName == ${str(src)}) hit = c.item(i);`;
            if (action === 'remove') {
                if (a.destination !== undefined || a.rule !== undefined) throw new Error("'destination' and 'rule' apply to add");
                return run('Remove style mapping', script(`${list}\n${find}\nif (!hit) throw new Error("No ${a.kind} style mapping from " + ${str(src)});\nhit.remove();\n__result__ = { mappings: __maps() };`));
            }
            const dst = name(a.destination, 'destination');
            const rule = MAPPING_RULES[enumOf(a.rule ?? 'style', Object.keys(MAPPING_RULES), { name: 'rule' })];
            return run('Add style mapping', script(`${list}
${find}
if (hit) { hit.destinationStyleName = ${str(dst)}; hit.mappingRuleType = MapType.${rule}; }
else c.add(${str(src)}, ${str(dst)}, MapType.${rule});
__result__ = { mappings: __maps() };`));
        },
    },
    {
        name: 'load_content_conveyor',
        description: 'Collect items onto the Content Collector conveyor, ready to place with the Content Placer, optionally as linked copies with style mapping (Content Collector tool; Load Conveyor)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The items to collect' },
                linkItems: { type: 'boolean', default: false, description: 'Create Link: page items placed from the conveyor stay linked to the source' },
                linkStories: { type: 'boolean', default: false, description: 'Create Link for stories placed from the conveyor' },
                mapStyles: { type: 'boolean', default: false, description: 'Map Styles when placing from the conveyor' },
            },
            required: ['target'],
        },
        features: L(['content_collector', 'content_placer_opt_load_conveyor']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const t = targetSpec(a.target);
            const li = optBool(a.linkItems, 'linkItems') ?? false;
            const ls = optBool(a.linkStories, 'linkStories') ?? false;
            const ms = optBool(a.mapStyles, 'mapStyles') ?? false;
            return run('Load content conveyor', script(`
var items = __targets(doc, ${t});
app.contentPlacer.load(items, ${bool(li)}, ${bool(ls)}, ${bool(ms)}, false);
__result__ = { collected: items.length, loaded: app.contentPlacer.loaded };`));
        },
    },
    {
        name: 'set_content_placer_options',
        description: 'Set the Content Collector and Content Placer options: show the conveyor, create links and map styles when placing (Content Placer options, View > Extras > Show Conveyor). Pass no options to read them.',
        inputSchema: {
            type: 'object',
            properties: {
                showConveyor: { type: 'boolean', description: 'Show the conveyor when the Content Collector or Placer tool is chosen' },
                createLinks: { type: 'boolean', description: 'Create Link: placed items stay linked to their source' },
                mapStyles: { type: 'boolean', description: 'Map Styles: apply custom style mappings to placed items' },
            },
        },
        features: L(['conveyor', 'content_placer_opt_create_link_placer', 'content_placer_opt_map_styles_placer']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const props = { showConveyor: 'showConveyor', createLinks: 'createLinksOnContentPlace', mapStyles: 'mapStylesOnContentPlace' };
            const set = Object.entries(props).flatMap(([k, p]) => {
                const v = optBool(a[k], k);
                return v === undefined ? [] : [`gp.${p} = ${bool(v)};`];
            });
            return run('Set content placer options', script(`
var gp = app.generalPreferences;
${set.join('\n')}
__result__ = { showConveyor: gp.showConveyor, createLinks: gp.createLinksOnContentPlace, mapStyles: gp.mapStylesOnContentPlace, loaded: app.contentPlacer.loaded };`, { needsDocument: false }));
        },
    },

    // ----- #224 Rulers, guides, measuring, gaps, context breaks -----
    {
        name: 'set_rulers',
        description: 'Show or hide the rulers and set their units, for both rulers or each one, or step both to the next unit (View > Show/Hide Rulers; ruler context menu; Preferences > Units & Increments). Pass no options to read them.',
        inputSchema: {
            type: 'object',
            properties: {
                show: { type: 'boolean', description: 'Show (true) or hide (false) the rulers' },
                units: { type: 'string', enum: [...RULER_UNITS, ...OTHER_UNITS], description: 'Units for both rulers' },
                horizontalUnits: { type: 'string', enum: [...RULER_UNITS, ...OTHER_UNITS], description: 'Units for the horizontal ruler' },
                verticalUnits: { type: 'string', enum: [...RULER_UNITS, ...OTHER_UNITS], description: 'Units for the vertical ruler' },
                cycle: { type: 'boolean', description: 'Step both rulers to the next unit (points, picas, inches, inches decimal, millimetres, centimetres, ciceros, agates, pixels)' },
            },
        },
        features: L(['rulers', 'ruler_units', 'cycle_units', 'context_ruler_units_both']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { horizontalUnits: undefined, verticalUnits: undefined, cycle: undefined },
        handler: (a) => {
            const all = [...RULER_UNITS, ...OTHER_UNITS];
            const show = optBool(a.show, 'show');
            const cycle = optBool(a.cycle, 'cycle') ?? false;
            const both = a.units === undefined ? undefined : enumOf(a.units, all, { name: 'units' });
            const hz = a.horizontalUnits === undefined ? both : enumOf(a.horizontalUnits, all, { name: 'horizontalUnits' });
            const vt = a.verticalUnits === undefined ? both : enumOf(a.verticalUnits, all, { name: 'verticalUnits' });
            if (both !== undefined && (a.horizontalUnits !== undefined || a.verticalUnits !== undefined)) throw new Error("Give 'units' for both rulers, or horizontalUnits/verticalUnits, not both");
            if (cycle && (hz !== undefined || vt !== undefined)) throw new Error("'cycle' steps the units; do not give units as well");
            const set = [];
            if (show !== undefined) set.push(`vp.showRulers = ${bool(show)};`);
            if (hz !== undefined) set.push(`vp.horizontalMeasurementUnits = MeasurementUnits.${hz};`);
            if (vt !== undefined) set.push(`vp.verticalMeasurementUnits = MeasurementUnits.${vt};`);
            if (cycle) {
                set.push(`var order = ${json(RULER_UNITS)}, k = -1;
for (var i = 0; i < order.length; i++) if (vp.horizontalMeasurementUnits == MeasurementUnits[order[i]]) k = i;
var next = MeasurementUnits[order[(k + 1) % order.length]];
vp.horizontalMeasurementUnits = next;
vp.verticalMeasurementUnits = next;`);
            }
            return run('Set rulers', script(`
var vp = doc.viewPreferences;
${set.join('\n')}
__result__ = { showRulers: vp.showRulers, horizontalUnits: __enumName(vp.horizontalMeasurementUnits), verticalUnits: __enumName(vp.verticalMeasurementUnits) };`));
        },
    },
    {
        name: 'manage_guides',
        description: 'List ruler guides, move them, lock or unlock them, make them liquid or ruler guides, or delete them, including every guide on a spread (select guides and drag, Lock Guide, View > Grids & Guides > Delete All Guides on Spread). Positions are mm from the top or left of the guide\'s page.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'move', 'set', 'delete'], description: 'What to do with the guides' },
                guideIds: { type: 'array', items: { type: 'integer' }, description: 'The guides (ids from action list)' },
                pageIndex: { type: 'integer', minimum: 0, description: 'All guides on this page (0-based)' },
                spreadIndex: { type: 'integer', minimum: 0, description: 'All guides on this spread (0-based); delete with only spreadIndex is Delete All Guides on Spread' },
                to: { type: 'number', description: 'move: the new position, mm from the top (horizontal guide) or left (vertical guide) of its page' },
                by: { type: 'number', description: 'move: distance to move (mm; down or right is positive)' },
                locked: { type: 'boolean', description: 'set: lock or unlock the guides' },
                type: { type: 'string', enum: ['liquid', 'ruler'], description: 'set: liquid guides tell the guide-based liquid rule what may stretch; ruler guides are plain guides' },
            },
            required: ['action'],
        },
        features: L(['manage_ruler_guides', 'context_delete_all_guides', 'liquid_guides']),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { action: 'move', guideIds: [3, 4], pageIndex: undefined, spreadIndex: undefined, to: 20, by: undefined, locked: undefined, type: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'move', 'set', 'delete'], { name: 'action' });
            const chosen = ['guideIds', 'pageIndex', 'spreadIndex'].filter((k) => a[k] !== undefined);
            if (chosen.length > 1) throw new Error('Choose guides by one of guideIds, pageIndex or spreadIndex');
            if (action !== 'list' && !chosen.length) throw new Error(`${action} needs guideIds, pageIndex or spreadIndex`);
            if (a.guideIds !== undefined && (!Array.isArray(a.guideIds) || !a.guideIds.length)) throw new Error("'guideIds' must be a non-empty list");
            const spec = json({
                guideIds: a.guideIds === undefined ? null : a.guideIds.map((id, i) => Number(index(id, { name: `guideIds[${i}]`, max: 1e9 }))),
                page: a.pageIndex === undefined ? null : Number(index(a.pageIndex, { name: 'pageIndex' })),
                spread: a.spreadIndex === undefined ? null : Number(index(a.spreadIndex, { name: 'spreadIndex' })),
            });
            const own = { list: [], move: ['to', 'by'], set: ['locked', 'type'], delete: [] }[action];
            for (const k of ['to', 'by', 'locked', 'type']) if (a[k] !== undefined && !own.includes(k)) throw new Error(`'${k}' does not apply to ${action}`);
            let body;
            if (action === 'list') body = '';
            else if (action === 'delete') body = 'var removed = gs.length;\nfor (i = gs.length - 1; i >= 0; i--) gs[i].remove();\n__result__ = { deleted: removed };';
            else if (action === 'move') {
                if ((a.to === undefined) === (a.by === undefined)) throw new Error('move needs to or by (one of them)');
                const step = a.to !== undefined
                    ? `var pg = null;\n  try { if (g.parentPage && g.parentPage.isValid) pg = g.parentPage; } catch (e) {}\n  if (!pg) throw new Error("Guide " + g.id + " is not on a page; move it with by");\n  g.location = (g.orientation == HorizontalOrVertical.HORIZONTAL ? pg.bounds[0] : pg.bounds[1]) + ${num(a.to, { min: -10000, max: 10000, name: 'to' })};`
                    : `g.location = g.location + ${num(a.by, { min: -10000, max: 10000, name: 'by' })};`;
                body = `for (i = 0; i < gs.length; i++) {\n  var g = gs[i];\n  if (g.locked) throw new Error("Guide " + g.id + " is locked; unlock it first");\n  ${step}\n}`;
            } else {
                const lock = optBool(a.locked, 'locked');
                const type = a.type === undefined ? undefined : enumOf(a.type, ['liquid', 'ruler'], { name: 'type' });
                if (lock === undefined && type === undefined) throw new Error('set needs locked or type');
                body = `for (i = 0; i < gs.length; i++) {\n${type === undefined ? '' : `  gs[i].guideType = GuideTypeOptions.${type.toUpperCase()};\n`}${lock === undefined ? '' : `  gs[i].locked = ${bool(lock)};\n`}}`;
            }
            const read = action === 'delete' ? '' : 'var out = [];\nfor (i = 0; i < gs.length; i++) out.push(__guideInfo(gs[i]));\n__result__ = { guides: out };';
            return run(`${action[0].toUpperCase()}${action.slice(1)} guides`, script(`${GUIDE_HELPERS}
var gs = __guides(doc, ${spec}), i;
${body}
${read}`));
        },
    },
    {
        name: 'measure_between',
        description: 'Measure the distance and angle between two points, items or an item and a point, as the Measure tool shows them in the Info panel; for two items also the gaps between their edges',
        inputSchema: {
            type: 'object',
            properties: {
                from: POINT_SCHEMA('Where to measure from'),
                to: POINT_SCHEMA('Where to measure to'),
            },
            required: ['from', 'to'],
        },
        features: L(['measure_tool']),
        hints: { readOnly: true, destructive: false, idempotent: true },
        auditArgs: { from: { id: 5, point: 'center' }, to: { pageIndex: 0, x: 10, y: 20 } },
        handler: (a) => {
            const f = pointSpec(a.from, 'from');
            const t = pointSpec(a.to, 'to');
            return run('Measure', script(`
var __pt = function (s) {
  if (s.id !== null) {
    var it = __item(doc, s.id), g = it.geometricBounds;
    return { x: g[1] + (g[3] - g[1]) * s.fx, y: g[0] + (g[2] - g[0]) * s.fy, page: __pageOf(it), bounds: g };
  }
  var pg = __page(doc, s.page), p = __toPage(pg, s.x, s.y);
  return { x: p[0], y: p[1], page: pg, bounds: null };
};
var rel = function (p) { return p.page ? { page: p.page.name, x: p.x - p.page.bounds[1], y: p.y - p.page.bounds[0] } : { page: null, x: p.x, y: p.y }; };
var a = __pt(${f}), b = __pt(${t});
var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
var r = { from: rel(a), to: rel(b), dx: dx, dy: dy, distance: d, distancePoints: d * 72 / 25.4, angle: d ? Math.atan2(-dy, dx) * 180 / Math.PI : 0 };
if (a.bounds && b.bounds) {
  r.horizontalGap = Math.max(b.bounds[1] - a.bounds[3], a.bounds[1] - b.bounds[3]);
  r.verticalGap = Math.max(b.bounds[0] - a.bounds[2], a.bounds[0] - b.bounds[2]);
}
__result__ = r;`));
        },
    },
    {
        name: 'adjust_gap',
        description: 'Change the gap between items as the Gap tool does: resize the gap (the facing edges move apart or together and the items resize), move the gap (both facing edges move the same way), or move the items on one side so the gap is a set size',
        inputSchema: {
            type: 'object',
            properties: {
                before: { ...TARGET_SCHEMA, description: 'Items on the left of the gap (side_by_side) or above it (stacked)' },
                after: { ...TARGET_SCHEMA, description: 'Items on the right of the gap (side_by_side) or below it (stacked)' },
                arrangement: { type: 'string', enum: ['side_by_side', 'stacked'], description: 'side_by_side: the gap runs up and down between items left and right of it; stacked: it runs across between items above and below' },
                mode: { type: 'string', enum: ['resize_gap', 'move_gap', 'move_items'], description: 'resize_gap: make the gap `size` wide by moving both facing edges (items resize); move_gap: shift the gap `by` mm (items on both sides resize); move_items: move the after items so the gap is `size`' },
                size: { type: 'number', minimum: 0, maximum: 5000, description: 'resize_gap, move_items: the new gap (mm)' },
                by: { type: 'number', description: 'move_gap: how far to move the gap (mm; right or down is positive)' },
            },
            required: ['before', 'after', 'arrangement', 'mode'],
        },
        features: L(['gap_tool']),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { mode: 'resize_gap', size: 5, by: undefined },
        handler: (a) => {
            const B = targetSpec(a.before), A = targetSpec(a.after);
            const side = enumOf(a.arrangement, ['side_by_side', 'stacked'], { name: 'arrangement' }) === 'side_by_side';
            const mode = enumOf(a.mode, ['resize_gap', 'move_gap', 'move_items'], { name: 'mode' });
            const [LO, HI] = side ? [1, 3] : [0, 2];
            let shift;
            if (mode === 'move_gap') {
                if (a.size !== undefined) throw new Error("'size' applies to resize_gap and move_items");
                if (a.by === undefined) throw new Error("move_gap needs 'by'");
                shift = `var dB = ${num(a.by, { min: -5000, max: 5000, name: 'by' })}, dA = dB, mA = 0;`;
            } else {
                if (a.by !== undefined) throw new Error("'by' applies to move_gap");
                if (a.size === undefined) throw new Error(`${mode} needs 'size'`);
                const s = num(a.size, { min: 0, max: 5000, name: 'size' });
                shift = mode === 'resize_gap' ? `var d = (${s} - gap) / 2, dB = -d, dA = d, mA = 0;` : `var dB = 0, dA = 0, mA = ${s} - gap;`;
            }
            return run('Adjust gap', script(`
var bs = __targets(doc, ${B}), as = __targets(doc, ${A}), i, g;
var edgeB = -1e9, edgeA = 1e9;
for (i = 0; i < bs.length; i++) { g = bs[i].geometricBounds; if (g[${HI}] > edgeB) edgeB = g[${HI}]; }
for (i = 0; i < as.length; i++) { g = as[i].geometricBounds; if (g[${LO}] < edgeA) edgeA = g[${LO}]; }
var gap = edgeA - edgeB;
if (gap < 0) throw new Error("The items overlap in that direction; there is no gap between them");
${shift}
var nb = [], na = [];
for (i = 0; i < bs.length; i++) { g = bs[i].geometricBounds; g[${HI}] += dB; if (g[${HI}] <= g[${LO}]) throw new Error("Item " + bs[i].id + " would have no size left"); nb.push(g); }
for (i = 0; i < as.length; i++) { g = as[i].geometricBounds; g[${LO}] += dA + mA; g[${HI}] += mA; if (g[${HI}] <= g[${LO}]) throw new Error("Item " + as[i].id + " would have no size left"); na.push(g); }
for (i = 0; i < bs.length; i++) bs[i].geometricBounds = nb[i];
for (i = 0; i < as.length; i++) as[i].geometricBounds = na[i];
var out = [];
for (i = 0; i < bs.length; i++) out.push(__itemInfo(bs[i]));
for (i = 0; i < as.length; i++) out.push(__itemInfo(as[i]));
__result__ = { gapBefore: gap, gapAfter: (edgeA + dA + mA) - (edgeB + dB), items: out };`));
        },
    },
    {
        name: 'set_context_break_styles',
        description: 'Mark paragraph styles as accessible context breaks: their paragraphs export to EPUB as thematic breaks (<hr>), or remove the mark (Layout > Accessible context breaks; Paragraph Style Options > Export Tagging)',
        inputSchema: {
            type: 'object',
            properties: {
                styles: { type: 'array', items: { type: 'string' }, description: 'Paragraph style names, e.g. the style of a "* * *" separator paragraph' },
                remove: { type: 'boolean', default: false, description: 'Remove the context-break mark instead of adding it' },
                exportClass: { type: 'string', description: 'CSS class to give the exported break' },
            },
            required: ['styles'],
        },
        features: L(['accessible_context_breaks']),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { exportClass: 'break' },
        handler: (a) => {
            const list = names(a.styles, 'styles');
            const remove = optBool(a.remove, 'remove') ?? false;
            if (remove && a.exportClass !== undefined) throw new Error("'exportClass' does not apply when removing");
            const cls = a.exportClass === undefined ? null : String(a.exportClass).trim();
            if (cls !== null && !/^[A-Za-z_][\w-]*$/.test(cls)) throw new Error("'exportClass' must be a CSS class name");
            return run('Set context break styles', script(`
var wanted = ${json(list)}, all = doc.allParagraphStyles, out = [], i, j;
for (i = 0; i < wanted.length; i++) {
  var s = null;
  for (j = 0; j < all.length; j++) if (all[j].name == wanted[i]) { s = all[j]; break; }
  if (!s) throw new Error("No paragraph style named " + wanted[i]);
  var maps = s.styleExportTagMaps, hit = null;
  for (j = 0; j < maps.length; j++) if (maps.item(j).exportType == "EPUB") hit = maps.item(j);
  ${remove
        ? 'if (hit && hit.exportTag == "hr") { hit.remove(); hit = null; }'
        : `if (hit) { hit.exportTag = "hr";${cls === null ? '' : ` hit.exportClass = ${str(cls)};`} }\n  else hit = maps.add("EPUB", "hr", ${str(cls ?? '')}, "");`}
  out.push({ style: s.name, contextBreak: !!(hit && hit.exportTag == "hr"), exportClass: hit ? hit.exportClass : null });
}
__result__ = { styles: out };`));
        },
    },
];
