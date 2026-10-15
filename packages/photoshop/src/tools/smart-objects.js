/**
 * Smart objects: convert layers, describe smart objects, edit, replace,
 * export, relink, update, embed and unpack them, choose a placed document's
 * layer comp, stack modes, and smart-filter visibility. All of it is Action
 * Manager (the placedLayer... events); the object model only reports
 * LayerKind.SMARTOBJECT.
 */
import path from 'node:path';
import { num, enumOf, str, jsxPath, index, bool } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM } from '../action-manager.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

const ACTIVE = { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}. Default the active layer` };

/** The smartObject descriptor of a layer, and its placed layer comps and smart filters. */
const SO = String.raw`
var __soDesc = function (l) {
  var d = __layerDesc(l.id);
  if (!d.hasKey(__s("smartObject"))) throw new Error(l.name + " is not a smart object");
  return d.getObjectValue(__s("smartObject"));
};
var __soComps = function (so) {
  var out = [];
  if (!so.hasKey(__s("compsList"))) return out;
  var cl = so.getObjectValue(__s("compsList"));
  if (!cl.hasKey(__s("compList"))) return out;
  var list = cl.getList(__s("compList"));
  for (var i = 0; i < list.count; i++) {
    var c = list.getObjectValue(i), item = { name: null, id: null };
    if (c.hasKey(__s("name"))) item.name = c.getString(__s("name"));
    if (c.hasKey(__s("ID"))) item.id = c.getInteger(__s("ID"));
    out.push(item);
  }
  return out;
};
var __soFilters = function (so) {
  var out = [];
  if (!so.hasKey(__s("filterFX"))) return out;
  var list = so.getList(__s("filterFX"));
  for (var i = 0; i < list.count; i++) {
    var f = list.getObjectValue(i), item = { index: i + 1, name: null, enabled: null };
    if (f.hasKey(__s("name"))) item.name = f.getString(__s("name"));
    if (f.hasKey(__s("enabled"))) item.enabled = f.getBoolean(__s("enabled"));
    out.push(item);
  }
  return out;
};
var __soInfo = function (l) {
  if (!__isSmartObject(l)) return { layer: __layerInfo(l), smartObject: null };
  var so = __soDesc(l), o = { linked: null, file: null, comps: __soComps(so), filters: __soFilters(so) };
  if (so.hasKey(__s("linked"))) o.linked = so.getBoolean(__s("linked"));
  if (so.hasKey(__s("fileReference"))) o.file = so.getString(__s("fileReference"));
  if (so.hasKey(__s("compsList"))) {
    var cl = so.getObjectValue(__s("compsList"));
    if (cl.hasKey(__s("compID"))) o.comp = cl.getInteger(__s("compID"));
  }
  return { layer: __layerInfo(l), smartObject: o };
};
`;

/** edit_smart_object actions: [event, needs a smart object, file use]. */
const ACTIONS = {
    new_copy: ['placedLayerMakeCopy', true, null],
    edit_contents: ['placedLayerEditContents', true, null],
    replace_contents: ['placedLayerReplaceContents', true, 'in'],
    export_contents: ['placedLayerExportContents', true, 'out'],
    relink: ['placedLayerRelinkToFile', true, 'in'],
    update: ['placedLayerUpdateModified', true, null],
    update_all: ['placedLayerUpdateAllModified', false, null],
    embed: ['placedLayerConvertToEmbedded', true, null],
    embed_all: ['placedLayerEmbedAll', false, null],
    convert_to_linked: ['placedLayerConvertToLinked', true, 'out'],
    reset_transform: ['placedLayerResetTransforms', true, null],
    convert_to_layers: ['placedLayerConvertToLayers', true, null],
    set_layer_comp: ['setPlacedLayerComp', true, null],
};

/** Stack modes and the image stack plug-in ids Adobe's Statistics script uses. */
const STACK_MODES = {
    mean: ['avrg', 'Mean'], median: ['medn', 'Median'], maximum: ['maxx', 'Maximum'], minimum: ['minn', 'Minimum'], range: ['rang', 'Range'],
    entropy: ['entr', 'Entropy'], kurtosis: ['kurt', 'Kurtosis'], skewness: ['skew', 'Skewness'], standard_deviation: ['stdv', 'Standard Deviation'],
    summation: ['summ', 'Summation'], variance: ['vari', 'Variance'],
};

export const tools = [
    {
        name: 'convert_to_smart_object',
        description: 'Bundle layers into one embedded smart object (Layer > Smart Objects > Convert to Smart Object), or convert a layer so filters applied to it stay editable as Smart Filters (Filter > Convert for Smart Filters)',
        inputSchema: { type: 'object', properties: { target: ACTIVE, name: { type: 'string', description: 'Name for the smart object layer' } } },
        features: ['photoshop.smart_objects.smart_object', 'photoshop.smart_objects.convert_to_smart_object', 'photoshop.smart_objects.convert_for_smart_filters'],
        handler: (a) => run('Convert to smart object', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
__selectLayers(items, false);
__play("newPlacedLayer");
var l = doc.activeLayer;
${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
__result__ = __layerInfo(l);`)),
    },
    {
        name: 'get_smart_object_info',
        description: 'Describe smart object layers: whether they are linked or embedded, their source file, the layer comps of the placed document and which one shows, and their Smart Filters in order with whether each is on',
        inputSchema: { type: 'object', properties: { target: ACTIVE } },
        hints: { readOnly: true },
        features: ['photoshop.smart_objects.smart_object', 'photoshop.smart_objects.smart_filters'],
        handler: (a) => run('Smart object info', script(`${AM}
${SO}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) out.push(__soInfo(items[i]));
__result__ = { layers: out };`)),
    },
    {
        name: 'edit_smart_object',
        description: 'Smart object commands (Layer > Smart Objects): New Smart Object via Copy, Edit Contents (opens the source as the active document; save and close it to update the layer), Replace Contents, Export Contents, Relink to File (also resolves a broken link), Update Modified Content, Update All Modified Content, Embed Linked, Embed All Linked, Convert to Linked, Reset Transform, Convert to Layers, and choosing which layer comp of the placed document shows (Properties panel)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: Object.keys(ACTIONS) },
                target: { ...TARGET_SCHEMA, description: 'One smart object layer. Default the active layer' },
                file: { type: 'string', description: 'Absolute path. replace_contents and relink: the source file to use; export_contents and convert_to_linked: the file to write' },
                page: { type: 'integer', minimum: 1, description: 'replace_contents: page of a multi-page file (PDF, Illustrator)' },
                comp: { type: 'string', description: 'set_layer_comp: name of a layer comp in the placed document (get_smart_object_info lists them)' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'replace_contents', file: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.psd'), page: undefined, comp: undefined },
        features: [
            'photoshop.smart_objects.new_smart_object_via_copy', 'photoshop.smart_objects.edit_contents', 'photoshop.smart_objects.replace_contents',
            'photoshop.smart_objects.export_contents', 'photoshop.smart_objects.relink_to_file', 'photoshop.smart_objects.resolve_broken_link',
            'photoshop.smart_objects.update_modified_content', 'photoshop.smart_objects.update_all_modified_content', 'photoshop.smart_objects.embed_linked',
            'photoshop.smart_objects.embed_all_linked', 'photoshop.smart_objects.convert_to_linked', 'photoshop.smart_objects.reset_transform',
            'photoshop.smart_objects.convert_to_layers', 'photoshop.smart_objects.smart_object_layer_comp',
        ],
        handler: (a) => {
            const action = enumOf(a.action, Object.keys(ACTIONS), { name: 'action' });
            const [event, needsSmartObject, fileUse] = ACTIONS[action];
            if (fileUse && !a.file) throw new Error(`'${action}' needs file`);
            if (!fileUse && a.file !== undefined) throw new Error(`'${action}' takes no file`);
            if (a.page !== undefined && action !== 'replace_contents') throw new Error("'page' is for replace_contents");
            if (action === 'set_layer_comp' && !a.comp) throw new Error("'set_layer_comp' needs comp");
            if (action !== 'set_layer_comp' && a.comp !== undefined) throw new Error("'comp' is for set_layer_comp");
            let fileLines = '';
            if (fileUse) {
                const p = paths.validate(a.file);
                fileLines = `var f = new File(${jsxPath(p)});\n${fileUse === 'in' ? 'if (!f.exists) throw new Error("File not found: " + f.fsName);' : 'if (!f.parent.exists) throw new Error("Folder not found: " + f.parent.fsName);'}`;
            }
            const call = {
                replace_contents: `var d = new ActionDescriptor(); d.putPath(__s("null"), f);${a.page !== undefined ? ` d.putInteger(__s("pageNumber"), ${index(a.page, { name: 'page' })});` : ''} __play("${event}", d);`,
                export_contents: `if (__soDesc(l).getBoolean(__s("linked"))) throw new Error(l.name + " is linked; its source is already a file"); var d = new ActionDescriptor(); d.putPath(__s("null"), f); __play("${event}", d);`,
                relink: `var d = new ActionDescriptor(); d.putPath(__s("null"), f); __play("${event}", d);`,
                convert_to_linked: `var d = __onTarget(); d.putPath(__s("using"), f); __play("${event}", d);`,
                set_layer_comp: `
var comps = __soComps(__soDesc(l)), id = null;
for (var i = 0; i < comps.length; i++) if (comps[i].name === ${str(a.comp ?? '')}) id = comps[i].id;
if (id === null) throw new Error(l.name + " has no layer comp named " + ${str(a.comp ?? '')});
var d = __onTarget(); d.putInteger(__s("compID"), id); __play("${event}", d);`,
                edit_contents: `var before = app.activeDocument; __play("${event}");`,
            }[action] ?? `__play("${event}");`;
            const result = action === 'edit_contents'
                ? '__result__ = { opened: app.activeDocument !== before ? __docInfo(app.activeDocument) : null, note: app.activeDocument !== before ? "Edit this document, then save and close it to update the smart object" : "The contents opened in another application" };'
                : action === 'update_all' || action === 'embed_all'
                    ? 'var out = []; __eachLayer(doc, function (x) { if (__isSmartObject(x)) out.push(__soInfo(x)); }); __result__ = { layers: out };'
                    : '__result__ = __soInfo(doc.activeLayer);';
            return run('Smart object', script(`${AM}
${SO}
${fileLines}
${needsSmartObject ? `var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
if (items.length !== 1) throw new Error("Choose one smart object layer");
var l = items[0];
if (!__isSmartObject(l)) throw new Error(l.name + " is not a smart object");
doc.activeLayer = l;` : ''}
${call}
${result}`));
        },
    },
    {
        name: 'set_stack_mode',
        description: 'Render a multi-layer smart object with a statistical stack mode (Layer > Smart Objects > Stack Mode), for example median to remove moving objects or mean to reduce noise. Give several aligned layers and they are first converted into one smart object (an image stack)',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'A smart object, or the layers to stack. Default the active layer' },
                mode: { type: 'string', enum: Object.keys(STACK_MODES) },
            },
            required: ['mode'],
        },
        features: ['photoshop.smart_objects.stack_mode', 'photoshop.smart_objects.image_stack'],
        handler: (a) => {
            const [id, label] = STACK_MODES[enumOf(a.mode, Object.keys(STACK_MODES), { name: 'mode' })];
            return run('Stack mode', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })});
if (items.length > 1 || !__isSmartObject(items[0])) { __selectLayers(items, false); __play("newPlacedLayer"); }
else doc.activeLayer = items[0];
var d = new ActionDescriptor();
d.putClass(__s("imageStackPlugin"), __c(${str(id)}));
d.putString(__s("name"), ${str(label)});
__play("applyImageStackPluginRenderer", d);
__result__ = __layerInfo(doc.activeLayer);`));
        },
    },
    {
        name: 'set_smart_filter_visibility',
        description: 'Turn one Smart Filter on a smart object, or all of them, off or on (the eye icons under the layer in the Layers panel)',
        inputSchema: {
            type: 'object',
            properties: {
                target: ACTIVE,
                visible: { type: 'boolean', description: 'true shows, false hides' },
                index: { type: 'integer', minimum: 1, description: 'Which filter, 1 = the first listed by get_smart_object_info. Default all' },
            },
            required: ['visible'],
        },
        auditArgs: { index: 2 },
        hints: { idempotent: true },
        features: ['photoshop.smart_objects.smart_filters', 'photoshop.smart_objects.smart_filter_visibility'],
        handler: (a) => {
            if (typeof a.visible !== 'boolean') throw new Error("'visible' must be true or false");
            const which = a.index !== undefined ? `[${num(a.index, { min: 1, max: 1000, name: 'index' })}]` : 'null';
            return run('Smart filter visibility', script(`${AM}
${SO}
var items = __targets(doc, ${targetSpec(a.target ?? { active: true })}), out = [];
for (var i = 0; i < items.length; i++) {
  var l = items[i], filters = __soFilters(__soDesc(l)), which = ${which};
  if (!filters.length) throw new Error(l.name + " has no smart filters");
  if (!which) { which = []; for (var j = 0; j < filters.length; j++) which.push(j + 1); }
  doc.activeLayer = l;
  var d = new ActionDescriptor(), list = new ActionList();
  for (var k = 0; k < which.length; k++) {
    if (which[k] > filters.length) throw new Error(l.name + " has " + filters.length + " smart filters");
    var r = new ActionReference();
    r.putIndex(__s("filterFX"), which[k]);
    r.putEnumerated(__s("layer"), __s("ordinal"), __s("targetEnum"));
    list.putReference(r);
  }
  d.putList(__s("null"), list);
  __play(${a.visible ? '"show"' : '"hide"'}, d);
  out.push(__soInfo(l));
}
__result__ = { layers: out, visible: ${bool(a.visible)} };`));
        },
    },
];
