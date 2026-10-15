/**
 * Blends: make, release, expand, reverse, replace spine, and blend options.
 *
 * Making, releasing, expanding, reversing and replacing the spine of a blend
 * are menu commands on the selection; the object model shows a blend only as a PluginItem. Blend options
 * are set by playing a generated Action (see src/blend.js).
 */
import { str, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { blendOptionsAction, playActionStatements, ORIENTATION } from '../blend.js';

/** Select exactly the targets. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** The selection afterwards, as item info. */
const RESULT = `
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));`;

const OPTION_SCHEMA = {
    steps: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of steps between the blended objects (Blend Options > Spacing: Specified Steps)' },
    orientation: { type: 'string', enum: Object.keys(ORIENTATION), description: 'page: steps stay upright; path: steps turn with the spine. Default page' },
};

/** Statements that set blend options on the current selection, when steps is given. */
function optionStatements(a) {
    if (a.steps === undefined) return '';
    return playActionStatements(str(blendOptionsAction({ steps: a.steps, orientation: a.orientation ?? 'page' })));
}

function isBlendCheck(label) {
    return `
for (var b = 0; b < items.length; b++) if (items[b].typename !== "PluginItem") throw new Error("${label}: item " + (items[b].name || b) + " is a " + items[b].typename + ", not a blend");`;
}

export const tools = [
    {
        name: 'make_blend',
        description: 'Blend two or more objects (Object > Blend > Make), optionally setting the number of steps and the orientation. The objects blend in stacking order. For text designs, outlineText converts text to outlines first',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                ...OPTION_SCHEMA,
                outlineText: { type: 'boolean', description: 'Convert text frames among the objects to outlines before blending (Type > Create Outlines), for blended lettering. The text is no longer editable. Default false' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.blends.blend_text',
            'illustrator.blends.blend_make',
            'illustrator.blends.blend_object',
            'illustrator.blends.blend_option.spacing',
            'illustrator.blends.blend_option.specified_steps',
            'illustrator.blends.blend_option.orientation',
            'illustrator.blends.blend_option.align_to_page',
            'illustrator.blends.blend_option.align_to_path',
        ],
        menuCommands: ['Path Blend Make'],
        handler: (a) => run('Make blend', script(`
var items = __targets(doc, ${targetSpec(a.target)}), outlined = 0;
if (items.length < 2) throw new Error("A blend needs at least two objects");
if (${bool(a.outlineText)}) for (var t = 0; t < items.length; t++) if (items[t].typename === "TextFrame") { items[t] = items[t].createOutline(); outlined++; }
${SELECT}
app.executeMenuCommand("Path Blend Make");
if (!doc.selection || doc.selection.length !== 1 || doc.selection[0].typename !== "PluginItem") throw new Error("Illustrator did not make a blend from these objects");
${optionStatements(a)}
${RESULT}
__result__ = { blend: out[0], steps: ${a.steps === undefined ? 'null' : Number(a.steps)}, outlinedText: outlined };`)),
    },
    {
        name: 'set_blend_options',
        description: 'Set the number of steps and the orientation of existing blends (Object > Blend > Blend Options)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, ...OPTION_SCHEMA }, required: ['target', 'steps'] },
        features: [
            'illustrator.blends.blend_options',
            'illustrator.blends.blend_option.spacing',
            'illustrator.blends.blend_option.specified_steps',
            'illustrator.blends.blend_option.orientation',
            'illustrator.blends.blend_option.align_to_page',
            'illustrator.blends.blend_option.align_to_path',
        ],
        handler: (a) => run('Set blend options', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isBlendCheck('Blend options')}
${SELECT}
${optionStatements(a)}
${RESULT}
__result__ = { blends: out, steps: ${Number(a.steps)}, orientation: ${str(a.orientation ?? 'page')} };`)),
    },
    {
        name: 'release_blend',
        description: 'Release blends back into their original objects (Object > Blend > Release)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.blends.blend_release'],
        menuCommands: ['Path Blend Release'],
        handler: (a) => run('Release blend', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isBlendCheck('Release')}
${SELECT}
app.executeMenuCommand("Path Blend Release");
${RESULT}
__result__ = { released: items.length, items: out };`)),
    },
    {
        name: 'expand_blend',
        description: 'Expand blends so every step becomes an ordinary object (Object > Blend > Expand)',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.blends.blend_expand'],
        menuCommands: ['Path Blend Expand'],
        handler: (a) => run('Expand blend', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isBlendCheck('Expand')}
${SELECT}
app.executeMenuCommand("Path Blend Expand");
${RESULT}
__result__ = { expanded: items.length, items: out };`)),
    },
    {
        name: 'reverse_blend',
        description: 'Reverse a blend\'s spine (the order along the path) or its stacking order (front to back)',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, what: { type: 'string', enum: ['spine', 'stack'], description: 'spine: Reverse Spine; stack: Reverse Front to Back' } },
            required: ['target', 'what'],
        },
        features: ['illustrator.blends.blend_reverse_spine', 'illustrator.blends.blend_reverse_front_back'],
        menuCommands: ['Path Blend Reverse Spine', 'Path Blend Reverse Stack'],
        handler: (a) => run('Reverse blend', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${isBlendCheck('Reverse')}
${SELECT}
app.executeMenuCommand(${str(enumOf(a.what, ['spine', 'stack'], { name: 'what' }) === 'spine' ? 'Path Blend Reverse Spine' : 'Path Blend Reverse Stack')});
${RESULT}
__result__ = { reversed: ${str(a.what)}, items: out };`)),
    },
    {
        name: 'replace_blend_spine',
        description: 'Make a blend follow a path (Object > Blend > Replace Spine): the path becomes the blend\'s spine and the steps are spread along it',
        inputSchema: {
            type: 'object',
            properties: {
                blendId: { type: 'string', description: 'Id of the blend' },
                pathId: { type: 'string', description: 'Id of the path to use as the spine (an open or closed path)' },
            },
            required: ['blendId', 'pathId'],
        },
        features: ['illustrator.blends.blend_replace_spine'],
        menuCommands: ['Path Blend Replace Spine'],
        handler: (a) => {
            if (!a.blendId || !a.pathId) throw new Error('Give blendId and pathId');
            if (String(a.blendId) === String(a.pathId)) throw new Error('blendId and pathId must be different items');
            return run('Replace spine', script(`
var blend = null, spine = null;
try { blend = doc.getPageItemFromUuid(${str(a.blendId)}); } catch (e) { blend = null; }
try { spine = doc.getPageItemFromUuid(${str(a.pathId)}); } catch (e) { spine = null; }
if (!blend) throw new Error("Blend " + ${str(a.blendId)} + " not found");
if (!spine) throw new Error("Path " + ${str(a.pathId)} + " not found");
if (blend.typename !== "PluginItem") throw new Error("blendId is a " + blend.typename + ", not a blend");
if (spine.typename !== "PathItem") throw new Error("pathId is a " + spine.typename + "; the spine must be a single path");
doc.selection = null;
blend.selected = true;
spine.selected = true;
app.executeMenuCommand("Path Blend Replace Spine");
${RESULT}
if (out.length !== 1) throw new Error("Illustrator did not replace the spine: " + out.length + " items are selected afterwards");
__result__ = { blend: out[0] };`));
        },
        hints: { destructive: false, idempotent: false },
        auditArgs: { blendId: 'blend-id', pathId: 'path-id' },
    },
];
