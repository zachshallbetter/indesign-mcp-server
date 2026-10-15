/**
 * Live Effects, Pathfinder, preferences and tools.
 *
 * These use routes the object model does not list but published scripts rely
 * on: LiveEffect definitions passed to PageItem.applyEffect, preference keys
 * read and written through app.preferences, and tool ids for app.selectTool.
 * See src/effects.js and the adobe-capability-atlas records they come from.
 */
import { readFileSync } from 'node:fs';
import { str, num, bool, enumOf, json, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { EFFECTS, PATHFINDER_COMMANDS, pathfinderEffect, effectOptionsHelp } from '../effects.js';

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
    highlightAnchorsOnHover: { key: 'highlightAnchorOnMouseOver', type: 'Boolean', description: 'Highlight anchors on mouse over' },
    preciseCursors: { key: 'usePreciseCursors', type: 'Boolean', description: 'Use precise cursors' },
    toolTips: { key: 'showToolTips', type: 'Boolean', description: 'Show tool tips' },
    japaneseCropMarks: { key: 'cropMarkStyle', type: 'Boolean', description: 'Use Japanese crop marks' },
    englishFontNames: { key: 'text/useEnglishFontNames', type: 'Boolean', description: 'Show font names in English' },
};

const SHAPE_MODES = ['unite', 'intersect', 'exclude', 'minus_front'];

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
        description: `Apply a Live Effect to items: it stays editable in the Appearance panel unless expand is true, which turns the result into plain artwork. Options per effect: ${effectOptionsHelp()}`,
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
            'illustrator.geometry.offset_path_option.offset', 'illustrator.geometry.offset_path_option.joins',
            'illustrator.geometry.offset_path_option.miter_limit', 'illustrator.effects.live_effect',
            'illustrator.effects.offset_path', 'illustrator.effects.round_corners', 'illustrator.effects.roughen',
            'illustrator.effects.transform', 'illustrator.effects.drop_shadow', 'illustrator.effects.ps_gaussian_blur',
        ],
        handler: (a) => {
            const effect = EFFECTS[enumOf(a.effect, Object.keys(EFFECTS), { name: 'effect' })];
            const options = a.options && typeof a.options === 'object' ? a.options : {};
            for (const k of effect.required ?? []) if (options[k] === undefined) throw new Error(`${a.effect} needs options.${k}`);
            const unknown = Object.keys(options).filter((k) => !(k in effect.params));
            if (unknown.length) throw new Error(`${a.effect} has no option ${unknown.join(', ')}. Options: ${Object.keys(effect.params).join(', ')}`);
            return run('Apply effect', script(`
var items = __targets(doc, ${targetSpec(a.target)}), xml = ${effect.build(options)}, out = [];
for (var i = 0; i < items.length; i++) {
  var target = items[i];
  target.applyEffect(xml);
  ${a.expand ? `${EXPAND}
  for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));` : 'out.push(__itemInfo(doc, target));'}
}
__result__ = { effect: ${str(a.effect)}, expanded: ${bool(a.expand)}, items: out };`));
        },
    },
    {
        name: 'pathfinder',
        description: 'Combine shapes as the Pathfinder panel does: unite, minus front, intersect, exclude, divide, trim, merge, crop, outline, minus back. The items are grouped and the Pathfinder effect applied; with expand (default) the result becomes plain paths, otherwise it stays a live effect on the group',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(PATHFINDER_COMMANDS) },
                expand: { type: 'boolean', description: 'Expand the result to plain paths. Default true', default: true },
                precision: { type: 'number', minimum: 0.001, maximum: 100, description: 'Pathfinder Options > Precision. Default 10' },
                removeRedundantPoints: { type: 'boolean', description: 'Pathfinder Options > Remove Redundant Points. Default false' },
                removeUnpainted: { type: 'boolean', description: 'Divide and Outline: remove unpainted artwork. Default false' },
                method: { type: 'string', enum: ['effect', 'menu'], description: 'effect (default) applies the Pathfinder effect; menu runs the Live Pathfinder menu command on the selection instead', default: 'effect' },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.geometry.pathfinder_panel', 'illustrator.geometry.pf_unite', 'illustrator.geometry.pf_minus_front',
            'illustrator.geometry.pf_intersect', 'illustrator.geometry.pf_exclude', 'illustrator.geometry.pf_divide',
            'illustrator.geometry.pf_trim', 'illustrator.geometry.pf_merge', 'illustrator.geometry.pf_crop',
            'illustrator.geometry.pf_outline', 'illustrator.geometry.pf_minus_back', 'illustrator.geometry.pathfinder_options',
            'illustrator.geometry.pathfinder_option.precision', 'illustrator.geometry.pathfinder_option.remove_redundant_points',
            'illustrator.geometry.pathfinder_option.divide_and_outline_will_remove_unpainted_artwork',
            'illustrator.effects.pf_add', 'illustrator.effects.pf_intersect', 'illustrator.effects.pf_exclude',
            'illustrator.effects.pf_subtract', 'illustrator.effects.pf_minus_back', 'illustrator.effects.pf_divide',
            'illustrator.effects.pf_trim', 'illustrator.effects.pf_merge', 'illustrator.effects.pf_crop', 'illustrator.effects.pf_outline',
        ],
        menuCommands: ['expandStyle', 'ungroup', 'Live Pathfinder Add', 'Live Pathfinder Subtract', 'Live Pathfinder Intersect',
            'Live Pathfinder Exclude', 'Live Pathfinder Divide', 'Live Pathfinder Trim', 'Live Pathfinder Merge',
            'Live Pathfinder Crop', 'Live Pathfinder Outline', 'Live Pathfinder Minus Back'],
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(PATHFINDER_COMMANDS), { name: 'operation' });
            const expand = a.expand ?? true;
            const minItems = op === 'divide' || op === 'outline' ? 1 : 2;
            const menu = {
                unite: 'Live Pathfinder Add', minus_front: 'Live Pathfinder Subtract', intersect: 'Live Pathfinder Intersect',
                exclude: 'Live Pathfinder Exclude', divide: 'Live Pathfinder Divide', trim: 'Live Pathfinder Trim',
                merge: 'Live Pathfinder Merge', crop: 'Live Pathfinder Crop', outline: 'Live Pathfinder Outline', minus_back: 'Live Pathfinder Minus Back',
            }[op];
            const viaMenu = (a.method ?? 'effect') === 'menu';
            return run('Pathfinder', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length < ${minItems}) throw new Error("${op} needs at least ${minItems} item(s)");
${viaMenu ? `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand(${str(menu)});
var target = doc.selection[0];` : `${GROUP_TARGETS}
var target = g;
target.applyEffect(${pathfinderEffect(op, { precision: a.precision ?? 10, removeRedundantPoints: Boolean(a.removeRedundantPoints), removeUnpainted: Boolean(a.removeUnpainted) })});`}
${expand ? `${EXPAND}
var result = sel[0];
${SHAPE_MODES.includes(op) ? `if (sel.length === 1 && result.typename === "GroupItem" && result.pageItems.length === 1) { app.executeMenuCommand("ungroup"); sel = doc.selection; }` : ''}
for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { operation: ${str(op)}, method: ${str(viaMenu ? 'menu' : 'effect')}, expanded: true, result: out };` : `
__result__ = { operation: ${str(op)}, method: ${str(viaMenu ? 'menu' : 'effect')}, expanded: false, result: [__itemInfo(doc, target)] };`}`));
        },
    },
    {
        name: 'get_preferences',
        description: `Read Illustrator preferences: ${Object.keys(PREFERENCES).join(', ')}. Omit names to read them all`,
        inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', enum: Object.keys(PREFERENCES) } } } },
        features: ['illustrator.application.prefs_dialog'],
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
        features: ['illustrator.application.prefs_dialog'],
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
        description: 'Switch Illustrator to a tool, ready for the user to draw with it. Name it as Illustrator does, e.g. "Pen Tool", "Shape Builder Tool", "Width Tool"',
        inputSchema: { type: 'object', properties: { tool: { type: 'string', description: 'Tool name' } }, required: ['tool'] },
        features: ['illustrator.geometry.pen_tool'],
        handler: (a) => {
            const want = String(a.tool ?? '').toLowerCase().replace(/^adobe\s+/, '').replace(/\s+tool$/, '').trim();
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
