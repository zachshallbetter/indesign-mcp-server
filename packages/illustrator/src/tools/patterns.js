/**
 * Patterns and repeats: Object > Pattern, pattern fills, and Object > Repeat.
 *
 * Make and Edit Pattern are menu commands on the selection; they enter pattern
 * editing mode, which Exit Isolation Mode leaves. The tile options (type, size,
 * spacing, overlap, copies) live only in the Pattern Options panel: the Pattern
 * class exposes nothing but its name, so they are not offered.
 *
 * A pattern fill moves, scales and rotates on its own through the PageItem
 * transform methods with the object flags off and the pattern flags on.
 *
 * Repeats are made with the Object > Repeat commands, which open no dialog, and
 * their options (Object > Repeat > Options, a dialog) are set through the
 * RadialRepeatItem, GridRepeatItem and SymmetryRepeatItem configurations
 * (Illustrator 2023 and later).
 */
import { str, num, index, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { ORIGINS, ORIGIN_SCHEMA } from './arrange.js';

/** Select exactly the targets. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: the pattern with a name, or the pattern of the pattern swatch with that name. */
const FIND_PATTERN = `
function __pattern(doc, name) {
  for (var s = 0; s < doc.swatches.length; s++) {
    var c = doc.swatches[s].color;
    if (c.typename === "PatternColor" && (doc.swatches[s].name === name || c.pattern.name === name)) return { pattern: c.pattern, color: c, swatch: doc.swatches[s].name };
  }
  for (var p = 0; p < doc.patterns.length; p++) if (doc.patterns[p].name === name) return { pattern: doc.patterns[p], color: null, swatch: null };
  throw new Error("Pattern " + name + " not found: list_swatches shows the pattern swatches (kind pattern)");
}
function __patternSwatch(doc, pattern) {
  for (var s = 0; s < doc.swatches.length; s++) {
    var c = doc.swatches[s].color;
    if (c.typename === "PatternColor" && c.pattern.name === pattern.name) return doc.swatches[s].name;
  }
  return null;
}`;

const PAINT_SCHEMA = { type: 'string', enum: ['fill', 'stroke', 'both'], description: 'Which paint the pattern is in. Default fill' };

/** Object > Repeat commands. */
export const REPEATS = {
    radial: { command: 'Make Radial Repeat', type: 'RadialRepeatItem', collection: 'radialRepeatItems' },
    grid: { command: 'Make Grid Repeat', type: 'GridRepeatItem', collection: 'gridRepeatItems' },
    mirror: { command: 'Make Symmetry Repeat', type: 'SymmetryRepeatItem', collection: 'symmetryRepeatItems' },
};

/** Grid Type, as RepeatGridShiftFlipType (the shift of alternate rows or columns). */
export const GRID_TYPES = { grid: 'NOSF', brick_by_row: 'HORIZONTALSF', brick_by_column: 'VERTICALSF' };
/** Flip Row and Flip Column, as RepeatGridShiftFlipType. */
export const FLIPS = { none: 'NOSF', horizontal: 'HORIZONTALSF', vertical: 'VERTICALSF', both: 'HORIZONTALANDVERTICALSF' };

/** Repeat options, with the kind of repeat each belongs to. */
const REPEAT_OPTIONS = {
    instances: { kind: 'radial', schema: { type: 'integer', minimum: 1, maximum: 1000, description: 'Radial: number of instances' } },
    radius: { kind: 'radial', schema: { type: 'number', minimum: 0, description: 'Radial: radius in points' } },
    reverseOverlap: { kind: 'radial', schema: { type: 'boolean', description: 'Radial: reverse the overlap of the instances' } },
    horizontalSpacing: { kind: 'grid', schema: { type: 'number', description: 'Grid: horizontal spacing between tiles in points (negative overlaps)' } },
    verticalSpacing: { kind: 'grid', schema: { type: 'number', description: 'Grid: vertical spacing between tiles in points (negative overlaps)' } },
    gridType: { kind: 'grid', schema: { type: 'string', enum: Object.keys(GRID_TYPES), description: 'Grid: Grid Type' } },
    flipRows: { kind: 'grid', schema: { type: 'string', enum: Object.keys(FLIPS), description: 'Grid: Flip Row, mirroring alternate rows' } },
    flipColumns: { kind: 'grid', schema: { type: 'string', enum: Object.keys(FLIPS), description: 'Grid: Flip Column, mirroring alternate columns' } },
    axisAngle: { kind: 'mirror', schema: { type: 'number', minimum: -360, maximum: 360, description: 'Mirror: angle of the mirror axis in degrees, anticlockwise from horizontal' } },
};
const OPTION_SCHEMA = Object.fromEntries(Object.entries(REPEAT_OPTIONS).map(([k, v]) => [k, v.schema]));
const OPTION_FEATURES = [
    'illustrator.patterns.radial_repeat_option.number_of_instances',
    'illustrator.patterns.radial_repeat_option.radius',
    'illustrator.patterns.grid_repeat_option.horizontal_spacing',
    'illustrator.patterns.grid_repeat_option.vertical_spacing',
    'illustrator.patterns.grid_repeat_option.grid_type',
    'illustrator.patterns.grid_repeat_option.flip_rows',
    'illustrator.patterns.grid_repeat_option.flip_column',
    'illustrator.patterns.mirror_repeat_option.angle_of_mirror_axis',
];

/** The repeat kind the given options belong to, or null when none are given. */
function optionKind(a) {
    const kinds = new Set(Object.keys(REPEAT_OPTIONS).filter((k) => a[k] !== undefined).map((k) => REPEAT_OPTIONS[k].kind));
    if (kinds.size > 1) throw new Error(`Options for ${[...kinds].join(' and ')} repeats cannot be mixed: give the options of one kind of repeat`);
    return kinds.size ? [...kinds][0] : null;
}

/**
 * ES3 statements that set the given options on the repeat item `it`. Each
 * option is set with its own update flag where the object model has one; Grid
 * Type and the flips have none, so they update the whole grid from its current
 * configuration.
 */
function optionStatements(a, kind) {
    const lines = [];
    if (kind === 'radial') {
        if (a.instances !== undefined) {
            const n = index(a.instances, { name: 'instances', max: 1000 });
            if (Number(n) < 1) throw new Error("'instances' must be at least 1");
            lines.push(`c = it.radialConfig; c.numberOfInstances = ${n}; it.setRadialConfiguration(c, RadialRepeatUpdate.NUMBEROFINSTANCES);`);
        }
        if (a.radius !== undefined) lines.push(`c = it.radialConfig; c.radius = __len(doc, ${num(a.radius, { min: 0, max: 100000, name: 'radius' })}); it.setRadialConfiguration(c, RadialRepeatUpdate.RADIUSOFART);`);
        if (a.reverseOverlap !== undefined) lines.push(`c = it.radialConfig; c.reverseOverlap = ${bool(a.reverseOverlap)}; it.setRadialConfiguration(c, RadialRepeatUpdate.REVERSEOVERLAP);`);
    } else if (kind === 'grid') {
        if (a.horizontalSpacing !== undefined) lines.push(`c = it.gridConfig; c.horizontalSpacing = __len(doc, ${num(a.horizontalSpacing, { min: -100000, max: 100000, name: 'horizontalSpacing' })}); it.setGridConfiguration(c, GridRepeatUpdate.HORIZONTALSPACING);`);
        if (a.verticalSpacing !== undefined) lines.push(`c = it.gridConfig; c.verticalSpacing = __len(doc, ${num(a.verticalSpacing, { min: -100000, max: 100000, name: 'verticalSpacing' })}); it.setGridConfiguration(c, GridRepeatUpdate.VERTICALSPACING);`);
        const whole = [];
        if (a.gridType !== undefined) whole.push(`c.patternType = RepeatGridShiftFlipType.${GRID_TYPES[enumOf(a.gridType, Object.keys(GRID_TYPES), { name: 'gridType' })]};`);
        if (a.flipRows !== undefined) whole.push(`c.rowFlipType = RepeatGridShiftFlipType.${FLIPS[enumOf(a.flipRows, Object.keys(FLIPS), { name: 'flipRows' })]};`);
        if (a.flipColumns !== undefined) whole.push(`c.columnFlipType = RepeatGridShiftFlipType.${FLIPS[enumOf(a.flipColumns, Object.keys(FLIPS), { name: 'flipColumns' })]};`);
        if (whole.length) lines.push(`c = it.gridConfig; ${whole.join(' ')} it.setGridConfiguration(c, GridRepeatUpdate.GRIDALL);`);
    } else if (kind === 'mirror') {
        lines.push(`c = it.symmetryConfig; c.axisRotationAngleInRadians = ${num(a.axisAngle, { min: -360, max: 360, name: 'axisAngle' })} * Math.PI / 180; it.setSymmetryConfiguration(c, SymmetryRepeatUpdate.AXISROTATION);`);
    }
    return lines.join('\n');
}

/** ES3: a repeat item's kind and options, in points and degrees. */
const REPEAT_INFO = `
function __shiftFlip(v, names) {
  var k = String(v).replace("RepeatGridShiftFlipType.", "");
  return names[k] || k;
}
function __repeatInfo(doc, it) {
  var info = __itemInfo(doc, it), f = __sf(doc), c;
  if (it.typename === "RadialRepeatItem") {
    c = it.radialConfig;
    info.kind = "radial"; info.options = { instances: c.numberOfInstances, radius: c.radius * f, reverseOverlap: c.reverseOverlap };
  } else if (it.typename === "GridRepeatItem") {
    c = it.gridConfig;
    info.kind = "grid";
    info.options = { horizontalSpacing: c.horizontalSpacing * f, verticalSpacing: c.verticalSpacing * f,
      gridType: __shiftFlip(c.patternType, ${json(Object.fromEntries(Object.entries(GRID_TYPES).map(([k, v]) => [v, k])))}),
      flipRows: __shiftFlip(c.rowFlipType, ${json(Object.fromEntries(Object.entries(FLIPS).map(([k, v]) => [v, k])))}),
      flipColumns: __shiftFlip(c.columnFlipType, ${json(Object.fromEntries(Object.entries(FLIPS).map(([k, v]) => [v, k])))}) };
  } else if (it.typename === "SymmetryRepeatItem") {
    c = it.symmetryConfig;
    info.kind = "mirror"; info.options = { axisAngle: c.axisRotationAngleInRadians * 180 / Math.PI };
  }
  return info;
}`;

const REPEAT_TYPES = Object.values(REPEATS).map((r) => r.type);

export const tools = [
    {
        name: 'create_pattern',
        description: 'Make a pattern swatch from the targets (Object > Pattern > Make), optionally naming it. The artwork stays where it is. By default Illustrator leaves pattern editing mode at once; with keepEditing it stays there so tile type, size, spacing and overlap can be set by hand in the Pattern Options panel, and edit_pattern with mode exit finishes',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                name: { type: 'string', description: 'Name for the pattern swatch. Default Illustrator\'s ("New Pattern")' },
                keepEditing: { type: 'boolean', description: 'Stay in pattern editing mode. Default false', default: false },
            },
            required: ['target'],
        },
        features: ['illustrator.patterns.pattern_make', 'illustrator.patterns.pattern_object', 'illustrator.patterns.pattern_option.name_pattern'],
        menuCommands: ['Adobe Make Pattern', 'exitFocus'],
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
        auditArgs: { name: 'Dots', keepEditing: false },
        handler: (a) => {
            if (a.name !== undefined && !String(a.name).trim()) throw new Error("'name' cannot be empty");
            return run('Create pattern', script(`${FIND_PATTERN}
var items = __targets(doc, ${targetSpec(a.target)}), before = {};
${a.name !== undefined ? `for (var q = 0; q < doc.patterns.length; q++) if (doc.patterns[q].name === ${str(a.name)}) throw new Error("A pattern named " + ${str(a.name)} + " already exists");` : ''}
for (var b = 0; b < doc.patterns.length; b++) before[doc.patterns[b].name] = true;
${SELECT}
app.executeMenuCommand("Adobe Make Pattern");
var made = null;
for (var p = 0; p < doc.patterns.length; p++) if (!before[doc.patterns[p].name]) { made = doc.patterns[p].name; break; }
${a.keepEditing ? '' : 'app.executeMenuCommand("exitFocus");'}
if (made === null) throw new Error("Illustrator made no pattern from these items");
var pat = doc.patterns.getByName(made);
${a.name !== undefined ? `pat.name = ${str(a.name)};` : ''}
__result__ = { pattern: pat.name, swatch: __patternSwatch(doc, pat), editing: ${bool(a.keepEditing)} };`));
        },
    },
    {
        name: 'apply_pattern',
        description: 'Fill or stroke paths, compound paths, groups (every path inside) and text with a pattern swatch in the document, by pattern or swatch name: one made with create_pattern or a predefined one (list_swatches shows them as kind pattern). Library patterns must first be added to the document\'s Swatches panel. transform_pattern then moves, scales or rotates the pattern inside the objects',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, pattern: { type: 'string', description: 'Pattern or pattern swatch name' }, paint: PAINT_SCHEMA },
            required: ['target', 'pattern'],
        },
        features: ['illustrator.patterns.pattern_object', 'illustrator.patterns.predefined_pattern', 'illustrator.patterns.pattern_swatches_new'],
        hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
        auditArgs: { pattern: 'Dots', paint: 'both' },
        handler: (a) => {
            if (!String(a.pattern ?? '').trim()) throw new Error("Give 'pattern': the name of a pattern swatch");
            const paint = enumOf(a.paint ?? 'fill', ['fill', 'stroke', 'both'], { name: 'paint' });
            const fill = paint !== 'stroke', stroke = paint !== 'fill';
            return run('Apply pattern', script(`${EACH_PATH}${FIND_PATTERN}
var items = __targets(doc, ${targetSpec(a.target)}), found = __pattern(doc, ${str(a.pattern)}), counts = { paths: 0, text: 0, skipped: [] };
var pc = found.color;
if (!pc) { pc = new PatternColor(); pc.pattern = found.pattern; }
for (var i = 0; i < items.length; i++) {
  if (items[i].typename === "TextFrame") {
    var ca = items[i].textRange.characterAttributes;
    ${fill ? 'ca.fillColor = pc;' : ''} ${stroke ? 'ca.strokeColor = pc;' : ''}
    counts.text++;
    continue;
  }
  __eachPath(items[i], function (p) { ${fill ? 'p.filled = true; p.fillColor = pc;' : ''} ${stroke ? 'p.stroked = true; p.strokeColor = pc;' : ''} }, counts);
}
__result__ = { pattern: found.pattern.name, swatch: found.swatch, paint: ${str(paint)}, paths: counts.paths, textFrames: counts.text, skipped: counts.skipped };`));
        },
    },
    {
        name: 'rename_pattern',
        description: 'Rename a pattern swatch (the Name field of the Pattern Options panel)',
        inputSchema: {
            type: 'object',
            properties: { pattern: { type: 'string', description: 'Current pattern or pattern swatch name' }, newName: { type: 'string' } },
            required: ['pattern', 'newName'],
        },
        features: ['illustrator.patterns.pattern_option.name_pattern'],
        hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
        handler: (a) => {
            if (!String(a.pattern ?? '').trim() || !String(a.newName ?? '').trim()) throw new Error("Give 'pattern' and a non-empty 'newName'");
            return run('Rename pattern', script(`${FIND_PATTERN}
var found = __pattern(doc, ${str(a.pattern)});
for (var q = 0; q < doc.patterns.length; q++) if (doc.patterns[q].name === ${str(a.newName)} && doc.patterns[q] !== found.pattern) throw new Error("A pattern named " + ${str(a.newName)} + " already exists");
var old = found.pattern.name;
found.pattern.name = ${str(a.newName)};
__result__ = { from: old, pattern: found.pattern.name, swatch: __patternSwatch(doc, found.pattern) };`));
        },
    },
    {
        name: 'edit_pattern',
        description: 'Enter pattern editing mode for the pattern that fills the target (Object > Pattern > Edit Pattern), or leave it (mode exit, like Done). In the mode, the tile options are set by hand in the Pattern Options panel and other tools act on the pattern\'s artwork',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['enter', 'exit'] },
                target: { ...TARGET_SCHEMA, description: 'For enter: one object filled with the pattern' },
            },
            required: ['mode'],
        },
        features: ['illustrator.patterns.pattern_edit'],
        menuCommands: ['Adobe Edit Pattern', 'exitFocus'],
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
        auditArgs: { mode: 'enter', target: { ids: ['a'] } },
        handler: (a) => {
            const mode = enumOf(a.mode, ['enter', 'exit'], { name: 'mode' });
            if (mode === 'exit') {
                return run('Leave pattern editing', script(`
app.executeMenuCommand("exitFocus");
__result__ = { editing: false };`));
            }
            if (!a.target) throw new Error("mode enter needs 'target': an object filled with the pattern");
            return run('Edit pattern', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), pattern = null, counts = { paths: 0, skipped: [] };
if (items.length !== 1) throw new Error("Edit Pattern works on one object: give a single target");
__eachPath(items[0], function (p) { if (!pattern && p.filled && p.fillColor.typename === "PatternColor") pattern = p.fillColor.pattern.name; }, counts);
if (!pattern) throw new Error("The target is not filled with a pattern");
${SELECT}
app.executeMenuCommand("Adobe Edit Pattern");
__result__ = { pattern: pattern, editing: true };`));
        },
    },
    {
        name: 'transform_pattern',
        description: 'Move, scale, rotate, reflect or shear the pattern inside objects without changing the objects (like the Transform options with Transform Objects off and Transform Patterns on, or dragging with the ` key held). Steps apply in that order: reflect, scale, rotate, shear, move',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                paint: PAINT_SCHEMA,
                dx: { type: 'number', description: 'Move the pattern right by this many points' },
                dy: { type: 'number', description: 'Move the pattern down by this many points' },
                scale: { type: 'number', minimum: 0.01, description: 'Uniform scale in percent, e.g. 50' },
                scaleX: { type: 'number', minimum: 0.01, description: 'Horizontal scale in percent; overrides scale' },
                scaleY: { type: 'number', minimum: 0.01, description: 'Vertical scale in percent; overrides scale' },
                angle: { type: 'number', description: 'Rotate the pattern by this many degrees, anticlockwise' },
                reflect: { type: 'string', enum: ['horizontal', 'vertical'], description: 'horizontal flips the pattern left-right' },
                shear: { type: 'number', minimum: -89, maximum: 89, description: 'Shear the pattern horizontally by this angle in degrees' },
                origin: ORIGIN_SCHEMA,
            },
            required: ['target'],
        },
        features: ['illustrator.patterns.pattern_transform', 'illustrator.patterns.transform_pattern_only'],
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
        auditArgs: { paint: 'both', dx: 5, dy: 5, scale: 50, angle: 30, reflect: 'horizontal', shear: 15, origin: 'topLeft' },
        handler: (a) => {
            const paint = enumOf(a.paint ?? 'fill', ['fill', 'stroke', 'both'], { name: 'paint' });
            const F = bool(paint !== 'stroke'), S = bool(paint !== 'fill');
            const about = `Transformation.${ORIGINS[enumOf(a.origin ?? 'center', Object.keys(ORIGINS), { name: 'origin' })]}`;
            const steps = [];
            if (a.reflect !== undefined) {
                const [x, y] = enumOf(a.reflect, ['horizontal', 'vertical'], { name: 'reflect' }) === 'horizontal' ? [-100, 100] : [100, -100];
                steps.push(`it.resize(${x}, ${y}, false, ${F}, false, ${S}, 100, ${about});`);
            }
            const sx = a.scaleX ?? a.scale, sy = a.scaleY ?? a.scale;
            if (sx !== undefined || sy !== undefined) {
                steps.push(`it.resize(${num(sx ?? 100, { min: 0.01, max: 100000, name: 'scaleX' })}, ${num(sy ?? 100, { min: 0.01, max: 100000, name: 'scaleY' })}, false, ${F}, false, ${S}, 100, ${about});`);
            }
            if (a.angle !== undefined) steps.push(`it.rotate(${num(a.angle, { min: -3600, max: 3600, name: 'angle' })}, false, ${F}, false, ${S}, ${about});`);
            if (a.shear !== undefined) {
                steps.push(`var m = app.getIdentityMatrix(); m.mValueC = Math.tan(${num(a.shear, { min: -89, max: 89, name: 'shear' })} * Math.PI / 180); it.transform(m, false, ${F}, false, ${S}, 100, ${about});`);
            }
            if (a.dx !== undefined || a.dy !== undefined) {
                steps.push(`it.translate(__len(doc, ${num(a.dx ?? 0, { name: 'dx' })}), -__len(doc, ${num(a.dy ?? 0, { name: 'dy' })}), false, ${F}, false, ${S});`);
            }
            if (!steps.length) throw new Error('Give at least one of dx, dy, scale, scaleX, scaleY, angle, reflect, shear');
            return run('Transform pattern', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  ${steps.join('\n  ')}
}
var out = [];
for (var j = 0; j < items.length; j++) out.push(__itemInfo(doc, items[j]));
__result__ = { paint: ${str(paint)}, items: out };`));
        },
    },
    {
        name: 'make_repeat',
        description: 'Repeat the targets as a live radial, grid or mirror repeat (Object > Repeat > Radial, Grid, Mirror; Illustrator 2023 or later), optionally setting its options: instances, radius and reverseOverlap for radial; horizontalSpacing, verticalSpacing, gridType, flipRows and flipColumns for grid; axisAngle for mirror',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, kind: { type: 'string', enum: Object.keys(REPEATS) }, ...OPTION_SCHEMA },
            required: ['target', 'kind'],
        },
        features: [
            'illustrator.patterns.repeat_radial',
            'illustrator.patterns.repeat_grid',
            'illustrator.patterns.repeat_mirror',
            'illustrator.patterns.repeat_object',
            ...OPTION_FEATURES,
        ],
        menuCommands: Object.values(REPEATS).map((r) => r.command),
        hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
        auditArgs: { kind: 'radial', instances: 12, radius: 80, reverseOverlap: true, horizontalSpacing: undefined, verticalSpacing: undefined, gridType: undefined, flipRows: undefined, flipColumns: undefined, axisAngle: undefined },
        handler: (a) => {
            const kind = enumOf(a.kind, Object.keys(REPEATS), { name: 'kind' });
            const given = optionKind(a);
            if (given && given !== kind) throw new Error(`Those are ${given} repeat options; a ${kind} repeat takes ${Object.keys(REPEAT_OPTIONS).filter((k) => REPEAT_OPTIONS[k].kind === kind).join(', ')}`);
            const r = REPEATS[kind];
            return run('Make repeat', script(`${REPEAT_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), n0 = doc.${r.collection}.length;
${SELECT}
app.executeMenuCommand(${str(r.command)});
// Mirror leaves nothing selected; the newest repeat is first in its collection.
var it = null, sel = doc.selection;
if (sel && sel.length === 1 && sel[0].typename === ${str(r.type)}) it = sel[0];
else if (doc.${r.collection}.length > n0) it = doc.${r.collection}[0];
if (!it) throw new Error("Illustrator made no ${kind} repeat from these items");
var c;
${optionStatements(a, given)}
__result__ = __repeatInfo(doc, it);`));
        },
    },
    {
        name: 'set_repeat_options',
        description: 'Change the options of radial, grid or mirror repeats (Object > Repeat > Options): instances, radius and reverseOverlap for radial; horizontalSpacing, verticalSpacing, gridType, flipRows and flipColumns for grid; axisAngle for mirror. With no options, report the current ones',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, ...OPTION_SCHEMA }, required: ['target'] },
        features: ['illustrator.patterns.repeat_options', 'illustrator.patterns.repeat_object', ...OPTION_FEATURES],
        hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
        auditArgs: { instances: undefined, radius: undefined, reverseOverlap: undefined, axisAngle: undefined, horizontalSpacing: 12, verticalSpacing: -4, gridType: 'brick_by_row', flipRows: 'horizontal', flipColumns: 'both' },
        handler: (a) => {
            const kind = optionKind(a);
            const type = kind ? REPEATS[kind].type : null;
            return run('Set repeat options', script(`${REPEAT_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), out = [], types = ${json(REPEAT_TYPES)}, c;
for (var i = 0; i < items.length; i++) {
  var ok = false;
  for (var t = 0; t < types.length; t++) if (items[i].typename === types[t]) ok = true;
  if (!ok) throw new Error("Item " + (items[i].name || i) + " is a " + items[i].typename + ", not a repeat");
  ${type ? `if (items[i].typename !== ${str(type)}) throw new Error("Item " + (items[i].name || i) + " is a " + items[i].typename + "; these options are for a ${kind} repeat");` : ''}
}
for (var j = 0; j < items.length; j++) {
  var it = items[j];
  ${optionStatements(a, kind)}
  out.push(__repeatInfo(doc, it));
}
__result__ = { repeats: out };`));
        },
    },
    {
        name: 'release_repeat',
        description: 'Release radial, grid or mirror repeats back into their source artwork (Object > Repeat > Release)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.patterns.repeat_release'],
        menuCommands: ['Release Repeat Art'],
        hints: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
        handler: (a) => run('Release repeat', script(`
var items = __targets(doc, ${targetSpec(a.target)}), types = ${json(REPEAT_TYPES)};
for (var i = 0; i < items.length; i++) {
  var ok = false;
  for (var t = 0; t < types.length; t++) if (items[i].typename === types[t]) ok = true;
  if (!ok) throw new Error("Item " + (items[i].name || i) + " is a " + items[i].typename + ", not a repeat");
}
${SELECT}
app.executeMenuCommand("Release Repeat Art");
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { released: items.length, items: out };`)),
    },
];
