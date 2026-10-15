/**
 * Channels panel: list, create (alpha and spot), set options and visibility,
 * select, duplicate, delete, merge spot channels, split and merge channels,
 * and the channel blending commands Apply Image and Calculations.
 */
import { str, num, bool, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { AM_HELPERS } from '../actions.js';
import { COLOR_SCHEMA, TARGET_SCHEMA, colorSpec, targetSpec } from '../args.js';

const KINDS = { masked_areas: 'MASKEDAREA', selected_areas: 'SELECTEDAREA', spot: 'SPOTCOLOR' };
const CHANNEL_ACTIONS = ['select', 'duplicate', 'delete', 'merge_spot'];
// mergeChannels colorSpace values, by charID.
const MERGE_MODES = { rgb: ['RGBC', 3, 3], cmyk: ['ECMY', 4, 4], lab: ['LbCl', 3, 3], multichannel: ['Mlth', 2, 56] };
// calculationType values for Apply Image and Calculations.
const CALC_BLEND = [
    'normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'colorDodge', 'colorBurn', 'linearBurn', 'linearDodge',
    'vividLight', 'linearLight', 'pinLight', 'hardMix', 'darken', 'lighten', 'difference', 'exclusion', 'add', 'subtract', 'divide',
];
const BLEND_NAMES = Object.fromEntries(CALC_BLEND.map((b) => [b.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), b]));

const SOURCE_SCHEMA = {
    type: 'object',
    description: 'A source channel',
    properties: {
        document: { type: 'string', description: 'Open document name (same pixel size). Default the active document' },
        layer: { type: 'string', description: 'Layer name, or "merged" for all visible layers. Default the active layer' },
        channel: { type: 'string', description: '"composite", "red", "green", "blue", "cyan", "magenta", "yellow", "black", "gray", "transparency", or an alpha channel name. Default composite' },
        invert: { type: 'boolean', description: 'Invert this source. Default false' },
    },
};

/** Channel info and lookup helpers for scripts. */
const CHANNEL_HELPERS = String.raw`
function __channelInfo(ch, i) {
  var info = { index: i, name: ch.name, kind: __enumName(ch.kind), visible: ch.visible, opacity: null, color: null, active: false };
  try { info.opacity = ch.opacity; } catch (e) {}
  try { info.color = __colorInfo(ch.color); } catch (e2) {}
  try { for (var j = 0; j < doc.activeChannels.length; j++) if (doc.activeChannels[j].name === ch.name) info.active = true; } catch (e3) {}
  return info;
}
function __channel(name) {
  try { return doc.channels.getByName(name); } catch (e) { throw new Error("No channel named " + name); }
}
function __channelList() {
  var out = [];
  for (var i = 0; i < doc.channels.length; i++) out.push(__channelInfo(doc.channels[i], i));
  return out;
}
`;

/** ActionReference builder for a source spec { channel, layer, document }. */
const CHANNEL_REF = String.raw`
function __chanRef(spec) {
  var r = new ActionReference(), c = spec.channel || "composite";
  var ids = { red: "Rd  ", green: "Grn ", blue: "Bl  ", cyan: "Cyn ", magenta: "Mgnt", yellow: "Yllw", black: "Blck", gray: "Gry ", transparency: "Trsp" };
  if (c === "composite") {
    var m = __enumName(doc.mode);
    r.putEnumerated(__c("Chnl"), __c("Chnl"), __c(m === "CMYK" ? "CMYK" : m === "LAB" ? "Lab " : m === "GRAYSCALE" ? "Gry " : "RGB "));
  } else if (ids.hasOwnProperty(c)) {
    r.putEnumerated(__c("Chnl"), __c("Chnl"), __c(ids[c]));
  } else {
    r.putName(__c("Chnl"), c);
  }
  if (spec.layer === "merged") r.putEnumerated(__c("Lyr "), __c("Ordn"), __c("Mrgd"));
  else if (spec.layer) r.putName(__c("Lyr "), spec.layer);
  if (spec.document) r.putName(__c("Dcmn"), spec.document);
  return r;
}
`;

/** A source spec as a JSX literal, checked. */
function sourceSpec(s, name) {
    const src = s ?? {};
    if (typeof src !== 'object') throw new Error(`'${name}' must be { document, layer, channel, invert }`);
    for (const k of ['document', 'layer', 'channel']) if (src[k] !== undefined && (typeof src[k] !== 'string' || !src[k])) throw new Error(`'${name}.${k}' must be a name`);
    return json({ document: src.document ?? null, layer: src.layer ?? null, channel: src.channel ?? 'composite' });
}

/** A calculationType stringID from a blend name. */
function blend(value) {
    return BLEND_NAMES[enumOf(value ?? 'normal', Object.keys(BLEND_NAMES), { name: 'blendMode' })];
}

export const tools = [
    {
        name: 'list_channels',
        description: 'List the Channels panel: each channel\'s name, kind (component, alpha masked or selected areas, spot colour), visibility, opacity or spot solidity, colour, and whether it is targeted',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.channels.channels_panel'],
        handler: () => run('List channels', script(`${CHANNEL_HELPERS}
__result__ = { channels: __channelList() };`)),
    },
    {
        name: 'create_channel',
        description: 'Add an alpha channel (Channels panel > New Channel) whose colour shows masked or selected areas, or a spot colour channel (New Spot Channel) with its ink colour and solidity; optionally filled from the selection (Save Selection as Channel)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Channel name; spot channels are usually named after the ink' },
                kind: { type: 'string', enum: Object.keys(KINDS), description: 'Default masked_areas (an alpha channel)' },
                color: { ...COLOR_SCHEMA, description: 'Overlay colour of an alpha channel, or ink colour of a spot channel. ' + COLOR_SCHEMA.description },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Overlay opacity of an alpha channel, or Solidity of a spot channel, percent' },
                fromSelection: { type: 'boolean', description: 'Fill the channel from the current selection. Default false', default: false },
            },
        },
        auditArgs: { color: '#00A0E0', fromSelection: false },
        features: ['photoshop.channels.new_channel', 'photoshop.channels.new_spot_channel', 'photoshop.channels.spot_channel', 'photoshop.channels.save_selection_as_channel'],
        handler: (a) => {
            const kind = KINDS[enumOf(a.kind ?? 'masked_areas', Object.keys(KINDS), { name: 'kind' })];
            if (kind === 'SPOTCOLOR' && a.color === undefined) throw new Error('A spot channel needs its ink color');
            return run('Create channel', script(`${CHANNEL_HELPERS}
${a.fromSelection ? 'try { var b = doc.selection.bounds; } catch (e) { throw new Error("fromSelection needs a selection"); }' : ''}
var ch = doc.channels.add();
ch.kind = ChannelType.${kind};
${a.name !== undefined ? `ch.name = ${str(a.name)};` : ''}
${a.color !== undefined ? `ch.color = __color(${colorSpec(a.color)});` : ''}
${a.opacity !== undefined ? `ch.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};` : ''}
${a.fromSelection ? 'doc.selection.store(ch, SelectionType.REPLACE);' : ''}
__result__ = __channelInfo(ch, doc.channels.length - 1);`));
        },
    },
    {
        name: 'set_channel',
        description: 'Change a channel\'s options (Channels panel > Channel Options): name, kind (converting an alpha channel to a spot channel or back), colour, opacity or solidity, and show or hide it (the eye icon). Colour channels such as Red can only be shown or hidden',
        inputSchema: {
            type: 'object',
            properties: {
                channel: { type: 'string', description: 'The channel\'s current name (list_channels)' },
                name: { type: 'string' },
                kind: { type: 'string', enum: Object.keys(KINDS) },
                color: COLOR_SCHEMA,
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent' },
                visible: { type: 'boolean' },
            },
            required: ['channel'],
        },
        auditArgs: { color: '#FF0000' },
        hints: { idempotent: true },
        features: ['photoshop.channels.channel_options', 'photoshop.channels.show_hide_channel', 'photoshop.channels.convert_alpha_to_spot', 'photoshop.channels.spot_channel'],
        handler: (a) => {
            const lines = [];
            if (a.name !== undefined) lines.push(`ch.name = ${str(a.name)};`);
            if (a.kind !== undefined) lines.push(`ch.kind = ChannelType.${KINDS[enumOf(a.kind, Object.keys(KINDS), { name: 'kind' })]};`);
            if (a.color !== undefined) lines.push(`ch.color = __color(${colorSpec(a.color)});`);
            if (a.opacity !== undefined) lines.push(`ch.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};`);
            const options = lines.length;
            if (a.visible !== undefined) lines.push(`ch.visible = ${bool(a.visible)};`);
            if (!lines.length) throw new Error('Give at least one of name, kind, color, opacity, visible');
            return run('Set channel', script(`${CHANNEL_HELPERS}
var ch = __channel(${str(a.channel)});
${options ? 'if (ch.kind === ChannelType.COMPONENT) throw new Error(ch.name + " is a colour channel: only visible can change");' : ''}
${lines.join('\n')}
__result__ = { channels: __channelList() };`));
        },
    },
    {
        name: 'manage_channels',
        description: 'Target channels for editing (clicking them in the Channels panel), duplicate a channel (into this or another open document), delete alpha or spot channels, or merge spot channels into the colour channels (Merge Spot Channel, which flattens the image)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: CHANNEL_ACTIONS },
                channels: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Channel names (list_channels)' },
                name: { type: 'string', description: 'duplicate: name for the copy (one channel)' },
                toDocument: { type: 'string', description: 'duplicate: an open document of the same pixel size to copy into. Default this one' },
            },
            required: ['action', 'channels'],
        },
        auditArgs: { action: 'duplicate', channels: ['Alpha 1'], toDocument: undefined },
        hints: { destructive: true },
        features: ['photoshop.channels.select_channel', 'photoshop.channels.duplicate_channel', 'photoshop.channels.delete_channel', 'photoshop.channels.merge_spot_channel'],
        handler: (a) => {
            const action = enumOf(a.action, CHANNEL_ACTIONS, { name: 'action' });
            if (!Array.isArray(a.channels) || !a.channels.length) throw new Error('channels must list channel names');
            if (action !== 'duplicate' && (a.name !== undefined || a.toDocument !== undefined)) throw new Error('name and toDocument are for duplicate');
            if (a.name !== undefined && a.channels.length > 1) throw new Error('Name one copy at a time');
            const each = {
                select: '',
                duplicate: `var c = ${a.toDocument !== undefined ? 'ch.duplicate(dest)' : 'ch.duplicate()'};${a.name !== undefined ? ` c.name = ${str(a.name)};` : ''}`,
                delete: 'if (ch.kind === ChannelType.COMPONENT) throw new Error(ch.name + " is a colour channel and cannot be deleted"); ch.remove();',
                merge_spot: 'if (ch.kind !== ChannelType.SPOTCOLOR) throw new Error(ch.name + " is not a spot channel"); ch.merge();',
            }[action];
            return run('Manage channels', script(`${CHANNEL_HELPERS}
var names = ${json(a.channels.map(String))}, list = [];
for (var i = 0; i < names.length; i++) list.push(__channel(names[i]));
${a.toDocument !== undefined ? `var dest = null;
for (var n = 0; n < app.documents.length; n++) if (app.documents[n].name === ${str(a.toDocument)}) dest = app.documents[n];
if (!dest) throw new Error("No open document named " + ${str(a.toDocument)});` : ''}
${action === 'select' ? 'doc.activeChannels = list;' : `for (var k = 0; k < list.length; k++) { var ch = list[k]; ${each} }`}
__result__ = { channels: __channelList() };`));
        },
    },
    {
        name: 'split_channels',
        description: 'Split the image into one grayscale document per channel (Channels panel > Split Channels). The original closes; the image must be flattened first (flatten_image)',
        inputSchema: { type: 'object', properties: {} },
        hints: { destructive: true },
        features: ['photoshop.channels.split_channels'],
        handler: () => run('Split channels', script(`
if (doc.layers.length > 1 || !doc.activeLayer.isBackgroundLayer) throw new Error("Split Channels needs a flattened image: flatten_image first");
var docs = doc.splitChannels(), names = [];
for (var i = 0; i < docs.length; i++) names.push(docs[i].name);
__result__ = { documents: names };`)),
    },
    {
        name: 'merge_channels',
        description: 'Combine open grayscale documents of the same pixel size into one image (Channels panel > Merge Channels): three into RGB or Lab, four into CMYK, or two or more into Multichannel, in channel order (e.g. red, green, blue)',
        inputSchema: {
            type: 'object',
            properties: {
                documents: { type: 'array', items: { type: 'string' }, minItems: 2, description: 'Open grayscale document names, in channel order' },
                mode: { type: 'string', enum: Object.keys(MERGE_MODES), description: 'Default rgb' },
            },
            required: ['documents'],
        },
        auditArgs: { documents: ['R.psd', 'G.psd', 'B.psd'] },
        features: ['photoshop.channels.merge_channels'],
        handler: (a) => {
            const mode = enumOf(a.mode ?? 'rgb', Object.keys(MERGE_MODES), { name: 'mode' });
            const [space, min, max] = MERGE_MODES[mode];
            if (!Array.isArray(a.documents) || a.documents.length < min || a.documents.length > max) throw new Error(`${mode} needs ${min === max ? min : `${min} to ${max}`} documents`);
            return run('Merge channels', script(`${AM_HELPERS}
var names = ${json(a.documents.map(String))}, list = new ActionList();
for (var i = 0; i < names.length; i++) {
  var found = null;
  for (var j = 0; j < app.documents.length; j++) if (app.documents[j].name === names[i]) found = app.documents[j];
  if (!found) throw new Error("No open document named " + names[i]);
  if (__enumName(found.mode) !== "GRAYSCALE") throw new Error(names[i] + " is not grayscale");
  var r = new ActionReference();
  r.putName(__s("document"), names[i]);
  list.putReference(r);
}
var d = new ActionDescriptor();
d.putList(__s("null"), list);
d.putEnumerated(__s("mode"), __s("colorSpace"), __c(${str(space)}));
__do(__s("mergeChannels"), d);
__result__ = __docInfo(app.activeDocument);`, { needsDocument: false }));
        },
    },
    {
        name: 'apply_image',
        description: 'Blend a source layer and channel, from this or another open document of the same pixel size, into the active layer (Image > Apply Image), with a blending mode, opacity, invert and preserve transparency; add and subtract take scale and offset. Works inside the selection when there is one',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'The layer to change. Default the active layer' },
                source: SOURCE_SCHEMA,
                blendMode: { type: 'string', enum: Object.keys(BLEND_NAMES), description: 'Default normal' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent. Default 100' },
                preserveTransparency: { type: 'boolean', description: 'Default false', default: false },
                scale: { type: 'number', minimum: 1, maximum: 2, description: 'add and subtract: divide the result by this. Default 1' },
                offset: { type: 'integer', minimum: -255, maximum: 255, description: 'add and subtract: add this brightness. Default 0' },
            },
        },
        auditArgs: { target: { ids: [3] }, source: { layer: 'merged', channel: 'red', invert: true }, blendMode: 'add', scale: 2 },
        features: ['photoshop.channels.apply_image'],
        handler: (a) => {
            const mode = blend(a.blendMode);
            if ((a.scale !== undefined || a.offset !== undefined) && mode !== 'add' && mode !== 'subtract') throw new Error('scale and offset are for the add and subtract modes');
            return run('Apply image', script(`${AM_HELPERS}${CHANNEL_REF}
${a.target !== undefined ? `doc.activeLayer = __targets(doc, ${targetSpec(a.target)})[0];` : ''}
var calc = new ActionDescriptor(), d = new ActionDescriptor();
calc.putReference(__c("T   "), __chanRef(${sourceSpec(a.source, 'source')}));
calc.putBoolean(__c("Invr"), ${bool(a.source?.invert)});
calc.putEnumerated(__c("Clcl"), __c("Clcn"), __s(${str(mode)}));
calc.putUnitDouble(__c("Opct"), __c("#Prc"), ${num(a.opacity ?? 100, { min: 0, max: 100, name: 'opacity' })});
calc.putBoolean(__c("PrsT"), ${bool(a.preserveTransparency)});
${a.scale !== undefined ? `calc.putDouble(__c("Scl "), ${num(a.scale, { min: 1, max: 2, name: 'scale' })});` : ''}
${a.offset !== undefined ? `calc.putInteger(__c("Ofst"), ${num(a.offset, { min: -255, max: 255, name: 'offset' })});` : ''}
d.putObject(__c("With"), __c("Clcl"), calc);
__do(__s("applyImageEvent"), d);
__result__ = __layerInfo(doc.activeLayer);`));
        },
    },
    {
        name: 'calculate_channels',
        description: 'Blend two source channels into a new alpha channel (Image > Calculations): each source is a layer (or merged) and channel, from this or another open document of the same pixel size, optionally inverted; with a blending mode and opacity',
        inputSchema: {
            type: 'object',
            properties: {
                source1: SOURCE_SCHEMA,
                source2: SOURCE_SCHEMA,
                blendMode: { type: 'string', enum: Object.keys(BLEND_NAMES), description: 'Default multiply' },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Percent. Default 100' },
                name: { type: 'string', description: 'Name for the new channel' },
            },
            required: ['source1', 'source2'],
        },
        auditArgs: { source1: { layer: 'merged', channel: 'red' }, source2: { channel: 'blue', invert: true } },
        features: ['photoshop.channels.calculations'],
        handler: (a) => {
            for (const k of ['source1', 'source2']) if (!a[k]?.channel) throw new Error(`'${k}.channel' is required: a colour channel or alpha channel name`);
            return run('Calculations', script(`${AM_HELPERS}${CHANNEL_REF}${CHANNEL_HELPERS}
var calc = new ActionDescriptor(), d = new ActionDescriptor(), before = doc.channels.length;
calc.putReference(__s("to"), __chanRef(${sourceSpec(a.source1, 'source1')}));
calc.putBoolean(__s("invert"), ${bool(a.source1?.invert)});
calc.putEnumerated(__s("calculation"), __s("calculationType"), __s(${str(blend(a.blendMode ?? 'multiply'))}));
calc.putUnitDouble(__s("opacity"), __s("percentUnit"), ${num(a.opacity ?? 100, { min: 0, max: 100, name: 'opacity' })});
calc.putReference(__s("source2"), __chanRef(${sourceSpec(a.source2, 'source2')}));
calc.putBoolean(__s("invertSource2"), ${bool(a.source2?.invert)});
d.putClass(__s("new"), __s("channel"));
d.putObject(__s("using"), __s("calculation"), calc);
__do(__s("make"), d);
if (doc.channels.length <= before) throw new Error("Calculations made no channel");
var ch = doc.channels[doc.channels.length - 1];
${a.name !== undefined ? `ch.name = ${str(a.name)};` : ''}
__result__ = __channelInfo(ch, doc.channels.length - 1);`));
        },
    },
];
