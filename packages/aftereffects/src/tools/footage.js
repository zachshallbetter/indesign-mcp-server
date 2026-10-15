/**
 * Footage: describe footage items and their sources, interpret footage (alpha,
 * frame rate, fields and pulldown, pixel aspect, loop), replace footage, set and
 * create proxies, make placeholders and solids, reload, open footage in the
 * Footage panel or other applications, detect scene edits, and paste SVG.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';
import { paths } from './project.js';

/** ES3: look up footage and AV items by id, and describe a footage source. */
const FOOTAGE = `
function __footage(id) {
  var it = app.project.itemByID(id);
  if (!it) throw new Error("No item with id " + id);
  if (!(it instanceof FootageItem)) throw new Error(it.name + " is not a footage item");
  return it;
}
function __avItem(id) {
  var it = app.project.itemByID(id);
  if (!it) throw new Error("No item with id " + id);
  if (!(it instanceof AVItem)) throw new Error(it.name + " is not footage or a composition");
  return it;
}
function __sourceInfo(s) {
  if (!s) return null;
  var o = { kind: s instanceof FileSource ? "file" : (s instanceof SolidSource ? "solid" : (s instanceof PlaceholderSource ? "placeholder" : "other")) };
  try { o.isStill = s.isStill; o.hasAlpha = s.hasAlpha; } catch (e) {}
  try { o.alphaMode = __enumName(s.alphaMode); o.invertAlpha = s.invertAlpha; o.premulColor = s.premulColor; } catch (e) {}
  try { o.fields = __enumName(s.fieldSeparationType); o.preserveEdges = s.highQualityFieldSeparation; o.pulldown = __enumName(s.removePulldown); } catch (e) {}
  try { o.loop = s.loop; o.nativeFrameRate = s.nativeFrameRate; o.conformFrameRate = s.conformFrameRate; o.displayFrameRate = s.displayFrameRate; } catch (e) {}
  try { o.file = s.file ? s.file.fsName : null; } catch (e) {}
  if (s instanceof FileSource) o.missingFootagePath = s.missingFootagePath;
  if (s instanceof SolidSource) o.color = s.color;
  return o;
}
function __footageInfo(it) {
  var info = __itemInfo(it);
  info.pixelAspect = it.pixelAspect; info.frameRate = it.frameRate; info.hasVideo = it.hasVideo; info.hasAudio = it.hasAudio;
  info.footageMissing = it.footageMissing; info.useProxy = it.useProxy;
  if (it instanceof FootageItem) info.main = __sourceInfo(it.mainSource);
  info.proxy = it.proxySource ? __sourceInfo(it.proxySource) : null;
  var used = [];
  for (var i = 0; i < it.usedIn.length; i++) used.push({ id: it.usedIn[i].id, name: it.usedIn[i].name });
  info.usedIn = used;
  return info;
}
function __selectOnly(it) {
  var sel = app.project.selection;
  for (var i = 0; i < sel.length; i++) sel[i].selected = false;
  it.selected = true;
}`;

const ITEMS_SCHEMA = { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 500, description: 'Footage item ids (from list_items or get_footage_info)' };

const ALPHA = { ignore: 'IGNORE', straight: 'STRAIGHT', premultiplied: 'PREMULTIPLIED' };
const FIELDS = { off: 'OFF', upper_first: 'UPPER_FIELD_FIRST', lower_first: 'LOWER_FIELD_FIRST' };
const PULLDOWN_PHASES = ['OFF', 'WSSWW', 'SSWWW', 'SWWWS', 'WWWSS', 'WWSSW', 'WWWSW_24P_ADVANCE', 'WWSWW_24P_ADVANCE', 'WSWWW_24P_ADVANCE', 'SWWWW_24P_ADVANCE', 'WWWWS_24P_ADVANCE'];
const PULLDOWN_GUESS = { guess_3_2: 'PULLDOWN_3_2', guess_24pa: 'ADVANCE_24P' };
const SED_MODES = { markers: 'MARKERS', split: 'SPLIT', split_precomp: 'SPLIT_PRECOMP', none: 'NONE' };

/** Ids as a JSX array literal. */
function ids(list, name) {
    if (!Array.isArray(list) || !list.length) throw new Error(`'${name}' must list at least one item id`);
    return json(list.map((i) => Number(index(i, { name }))));
}

/** A size in pixels as a JSX number. */
const px = (v, name) => num(v, { min: 1, max: 30000, name });

/** An existing file for footage or a proxy, validated against the allowed folders. */
function filePath(value, name = 'file') {
    if (typeof value !== 'string' || !value) throw new Error(`'${name}' is required: an absolute path`);
    return jsxPath(paths.validate(value));
}

export const tools = [
    {
        name: 'get_footage_info',
        description: 'Describe footage items (Project panel, Interpret Footage): source kind (file, solid, placeholder), file and missing path, alpha, frame rates, fields and pulldown, pixel aspect, loop, proxy and the compositions that use each item',
        inputSchema: {
            type: 'object',
            properties: {
                items: { ...ITEMS_SCHEMA, description: 'Footage item ids. Omit for every footage item' },
                missingOnly: { type: 'boolean', description: 'Only items whose source file is missing. Default false', default: false },
            },
        },
        hints: { readOnly: true },
        features: [
            'aftereffects.footage.footage_item_object',
            'aftereffects.footage.footage_source_object',
            'aftereffects.footage.file_source_object',
            'aftereffects.footage.solid_source_object',
            'aftereffects.footage.placeholder_item_object',
        ],
        handler: (a) => run('Footage info', script(`${FOOTAGE}
var want = ${a.items !== undefined ? ids(a.items, 'items') : 'null'}, list = [], out = [];
if (want) for (var i = 0; i < want.length; i++) list.push(__footage(want[i]));
else for (var j = 1; j <= proj.numItems; j++) if (proj.item(j) instanceof FootageItem) list.push(proj.item(j));
for (var k = 0; k < list.length; k++) {
  if (${bool(a.missingOnly)} && !list[k].footageMissing) continue;
  var info = __footageInfo(list[k]);
  info.placeholder = list[k] instanceof PlaceholderItem;
  out.push(info);
}
__result__ = { count: out.length, items: out };`)),
    },
    {
        name: 'interpret_footage',
        description: 'Change how footage is interpreted (File > Interpret Footage > Main or Proxy): alpha (ignore, straight, premultiplied with a matte colour, or guess), invert alpha, frame rate, field order, Preserve Edges, pulldown removal or guessing, pixel aspect ratio and loop count. copyFrom applies another item\'s interpretation first (Remember Interpretation, then Apply Interpretation)',
        inputSchema: {
            type: 'object',
            properties: {
                items: ITEMS_SCHEMA,
                source: { type: 'string', enum: ['main', 'proxy'], description: 'Interpret the main footage or the item\'s proxy. Default main', default: 'main' },
                copyFrom: { type: 'integer', minimum: 1, description: 'Footage item id whose main interpretation is copied first: alpha, matte colour, invert alpha, frame rate, fields, Preserve Edges, pulldown, loop and pixel aspect' },
                alpha: { type: 'string', enum: ['ignore', 'straight', 'premultiplied', 'guess'], description: 'Alpha: Ignore, Straight - Unmatted, Premultiplied - Matted With Color, or Guess' },
                matteColor: { ...COLOR_SCHEMA, description: 'Matte colour for premultiplied alpha: "#RRGGBB" or "rgb(r,g,b)"' },
                invertAlpha: { type: 'boolean', description: 'Invert Alpha' },
                frameRate: { type: 'number', minimum: 0, maximum: 999, description: 'Conform to this frame rate (Assume This Frame Rate for stills); 0 returns to the file\'s own rate' },
                fields: { type: 'string', enum: Object.keys(FIELDS), description: 'Separate Fields: off, upper field first, lower field first' },
                preserveEdges: { type: 'boolean', description: 'Preserve Edges (Best Quality Only) for separated fields' },
                pulldown: { type: 'string', enum: [...PULLDOWN_PHASES, ...Object.keys(PULLDOWN_GUESS)], description: 'Remove pulldown: a phase (W = whole frame, S = split frame; _24P_ADVANCE for 24Pa), OFF, or guess_3_2 / guess_24pa to let After Effects pick. Needs separated fields' },
                pixelAspect: { type: 'number', minimum: 0.01, maximum: 10, description: 'Pixel aspect ratio, e.g. 1 (square), 0.9091 (D1/DV NTSC), 1.0940 (D1/DV PAL), 2 (anamorphic 2:1), 1.3333 (HDV 1080). Main footage only' },
                loop: { type: 'integer', minimum: 1, maximum: 9999, description: 'Loop the footage this many times' },
            },
            required: ['items'],
        },
        auditArgs: { matteColor: '#000000' },
        hints: { idempotent: true },
        features: [
            'aftereffects.footage.interpret_footage_main',
            'aftereffects.footage.interpret_footage_proxy',
            'aftereffects.footage.remember_interpretation',
            'aftereffects.footage.apply_interpretation',
            'aftereffects.footage.alpha_interpretation',
            'aftereffects.footage.invert_alpha',
            'aftereffects.footage.conform_frame_rate',
            'aftereffects.footage.separate_fields',
            'aftereffects.footage.preserve_edges',
            'aftereffects.footage.remove_pulldown',
            'aftereffects.footage.guess_pulldown',
            'aftereffects.footage.pixel_aspect_ratio_interpretation',
            'aftereffects.footage.loop_footage',
        ],
        handler: (a) => {
            const list = ids(a.items, 'items');
            const proxy = enumOf(a.source ?? 'main', ['main', 'proxy'], { name: 'source' }) === 'proxy';
            const changes = ['copyFrom', 'alpha', 'matteColor', 'invertAlpha', 'frameRate', 'fields', 'preserveEdges', 'pulldown', 'pixelAspect', 'loop'];
            if (!changes.some((k) => a[k] !== undefined)) throw new Error(`Nothing to change: pass one of ${changes.join(', ')}`);
            if (proxy && a.pixelAspect !== undefined) throw new Error('pixelAspect belongs to the item, not its proxy: use source "main"');
            if (proxy && a.copyFrom !== undefined) throw new Error('copyFrom applies to the main footage only');
            const alpha = a.alpha !== undefined ? enumOf(a.alpha, [...Object.keys(ALPHA), 'guess'], { name: 'alpha' }) : null;
            const fields = a.fields !== undefined ? FIELDS[enumOf(a.fields, Object.keys(FIELDS), { name: 'fields' })] : null;
            const pulldown = a.pulldown !== undefined ? enumOf(a.pulldown, [...PULLDOWN_PHASES, ...Object.keys(PULLDOWN_GUESS)], { name: 'pulldown' }) : null;
            const lines = [];
            if (alpha === 'guess') lines.push('s.guessAlphaMode();');
            else if (alpha) lines.push(`s.alphaMode = AlphaMode.${ALPHA[alpha]};`);
            if (a.matteColor !== undefined) lines.push(`s.premulColor = ${colorValue(a.matteColor, 'matteColor')};`);
            if (a.invertAlpha !== undefined) lines.push(`s.invertAlpha = ${bool(a.invertAlpha)};`);
            if (a.frameRate !== undefined) lines.push(`s.conformFrameRate = ${num(a.frameRate, { min: 0, max: 999, name: 'frameRate' })};`);
            if (fields) lines.push(`s.fieldSeparationType = FieldSeparationType.${fields};`);
            if (a.preserveEdges !== undefined) lines.push(`s.highQualityFieldSeparation = ${bool(a.preserveEdges)};`);
            if (pulldown && PULLDOWN_GUESS[pulldown]) lines.push(`s.guessPulldown(PulldownMethod.${PULLDOWN_GUESS[pulldown]});`);
            else if (pulldown) lines.push(`s.removePulldown = PulldownPhase.${pulldown};`);
            if (a.loop !== undefined) lines.push(`s.loop = ${index(a.loop, { name: 'loop', max: 9999 })};`);
            if (a.pixelAspect !== undefined) lines.push(`it.pixelAspect = ${num(a.pixelAspect, { min: 0.01, max: 10, name: 'pixelAspect' })};`);
            const copy = a.copyFrom !== undefined ? `var from = __footage(${index(a.copyFrom, { name: 'copyFrom' })}), fs = from.mainSource;` : 'var from = null, fs = null;';
            return run('Interpret footage', script(`${FOOTAGE}
var ids = ${list}, out = [];
${copy}
for (var i = 0; i < ids.length; i++) {
  var it = ${proxy ? '__avItem(ids[i])' : '__footage(ids[i])'};
  var s = ${proxy ? 'it.proxySource' : 'it.mainSource'};
  if (!s) throw new Error(it.name + " has no proxy: set one with set_proxy");
  var skipped = [];
  if (fs) {
    if (fs.hasAlpha && s.hasAlpha) { s.alphaMode = fs.alphaMode; s.invertAlpha = fs.invertAlpha; try { s.premulColor = fs.premulColor; } catch (e) { skipped.push("matte colour"); } }
    try { s.conformFrameRate = fs.conformFrameRate; } catch (e) { skipped.push("frame rate"); }
    try { s.fieldSeparationType = fs.fieldSeparationType; s.highQualityFieldSeparation = fs.highQualityFieldSeparation; s.removePulldown = fs.removePulldown; } catch (e) { skipped.push("fields and pulldown"); }
    try { s.loop = fs.loop; } catch (e) { skipped.push("loop"); }
    it.pixelAspect = from.pixelAspect;
  }
  ${lines.join('\n  ')}
  var info = { id: it.id, name: it.name, pixelAspect: it.pixelAspect, source: __sourceInfo(s) };
  if (skipped.length) info.notCopied = skipped;
  out.push(info);
}
__result__ = { items: out };`, { undo: 'Interpret footage' }));
        },
    },
    {
        name: 'replace_footage',
        description: 'Replace a footage item\'s source everywhere it is used, keeping layer changes (File > Replace Footage): with another file or image sequence, a colour-bar placeholder, a solid, or a composition built from a layered Photoshop or Illustrator file (With Layered Comp)',
        inputSchema: {
            type: 'object',
            properties: {
                item: { type: 'integer', minimum: 1, description: 'Footage item id' },
                with: { type: 'string', enum: ['file', 'sequence', 'placeholder', 'solid', 'layered_comp'], description: 'What replaces it' },
                file: { type: 'string', description: 'file, sequence: absolute path (for a sequence, its first file)' },
                forceAlphabetical: { type: 'boolean', description: 'sequence: Force alphabetical order, so gaps in the numbering do not become placeholder frames. Default false', default: false },
                name: { type: 'string', description: 'placeholder, solid: name. Default the item\'s name' },
                width: { type: 'integer', minimum: 1, maximum: 30000, description: 'placeholder, solid: pixels. Default the item\'s width' },
                height: { type: 'integer', minimum: 1, maximum: 30000, description: 'placeholder, solid: pixels. Default the item\'s height' },
                frameRate: { type: 'number', minimum: 1, maximum: 999, description: 'placeholder: frames per second. Default the item\'s rate, or 30' },
                duration: { type: 'number', minimum: 0.01, maximum: 86400, description: 'placeholder: seconds. Default the item\'s duration, or 10' },
                color: { ...COLOR_SCHEMA, description: 'solid: colour, "#RRGGBB" or "rgb(r,g,b)"' },
                pixelAspect: { type: 'number', minimum: 0.01, maximum: 10, description: 'solid: pixel aspect ratio. Default the item\'s' },
            },
            required: ['item', 'with'],
        },
        auditArgs: { with: 'file', file: `${process.env.HOME ?? '/tmp'}/Documents/footage.mov`, color: '#808080' },
        hints: { destructive: true },
        features: [
            'aftereffects.footage.replace_footage_file',
            'aftereffects.footage.replace_footage_placeholder',
            'aftereffects.footage.replace_footage_solid',
            'aftereffects.footage.replace_footage_with_layered_comp',
            'aftereffects.footage.force_alphabetical_order',
        ],
        handler: (a) => {
            const kind = enumOf(a.with, ['file', 'sequence', 'placeholder', 'solid', 'layered_comp'], { name: 'with' });
            const id = index(a.item, { name: 'item' });
            let body;
            if (kind === 'file' || kind === 'sequence') {
                body = `var f = new File(${filePath(a.file)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
${kind === 'file' ? 'it.replace(f);' : `it.replaceWithSequence(f, ${bool(a.forceAlphabetical)});`}`;
            } else if (kind === 'placeholder') {
                body = `it.replaceWithPlaceholder(${a.name !== undefined ? str(a.name) : 'it.name'}, ${a.width !== undefined ? px(a.width, 'width') : 'it.width'}, ${a.height !== undefined ? px(a.height, 'height') : 'it.height'}, ${a.frameRate !== undefined ? num(a.frameRate, { min: 1, max: 999, name: 'frameRate' }) : '(it.frameRate > 0 ? it.frameRate : 30)'}, ${a.duration !== undefined ? num(a.duration, { min: 0.01, max: 86400, name: 'duration' }) : '(it.duration > 0 ? it.duration : 10)'});`;
            } else if (kind === 'solid') {
                if (a.color === undefined) throw new Error("with: solid needs 'color'");
                body = `it.replaceWithSolid(${colorValue(a.color)}, ${a.name !== undefined ? str(a.name) : 'it.name'}, ${a.width !== undefined ? px(a.width, 'width') : 'it.width'}, ${a.height !== undefined ? px(a.height, 'height') : 'it.height'}, ${a.pixelAspect !== undefined ? num(a.pixelAspect, { min: 0.01, max: 10, name: 'pixelAspect' }) : 'it.pixelAspect'});`;
            } else {
                body = `var before = proj.numItems;
__selectOnly(it);
app.executeCommand(3070);
if (proj.numItems === before) throw new Error(it.name + " was not replaced: With Layered Comp needs footage from a layered Photoshop or Illustrator file");`;
            }
            return run('Replace footage', script(`${FOOTAGE}
var it = __footage(${id});
${body}
__result__ = __footageInfo(it);`, { undo: 'Replace footage' }));
        },
    },
    {
        name: 'set_proxy',
        description: 'Give footage items or compositions a proxy (File > Set Proxy): a file or image sequence, a solid or a placeholder, or remove it (None). useProxy switches between the proxy and the original (the proxy indicator in the Project panel)',
        inputSchema: {
            type: 'object',
            properties: {
                items: { ...ITEMS_SCHEMA, description: 'Footage or composition item ids' },
                proxy: { type: 'string', enum: ['file', 'sequence', 'solid', 'placeholder', 'none'], description: 'What becomes the proxy; none removes it. Omit to only switch useProxy' },
                file: { type: 'string', description: 'file, sequence: absolute path (one item only)' },
                forceAlphabetical: { type: 'boolean', description: 'sequence: Force alphabetical order. Default false', default: false },
                name: { type: 'string', description: 'solid, placeholder: name. Default the item\'s name' },
                width: { type: 'integer', minimum: 1, maximum: 30000, description: 'solid, placeholder: pixels. Default the item\'s width' },
                height: { type: 'integer', minimum: 1, maximum: 30000, description: 'solid, placeholder: pixels. Default the item\'s height' },
                frameRate: { type: 'number', minimum: 1, maximum: 999, description: 'placeholder: frames per second. Default the item\'s rate, or 30' },
                duration: { type: 'number', minimum: 0.01, maximum: 86400, description: 'placeholder: seconds. Default the item\'s duration, or 10' },
                color: { ...COLOR_SCHEMA, description: 'solid: colour, "#RRGGBB" or "rgb(r,g,b)"' },
                pixelAspect: { type: 'number', minimum: 0.01, maximum: 10, description: 'solid: pixel aspect ratio. Default the item\'s' },
                useProxy: { type: 'boolean', description: 'Use the proxy (true) or the original (false) everywhere in the project' },
            },
            required: ['items'],
        },
        auditArgs: { items: [1], proxy: 'file', file: `${process.env.HOME ?? '/tmp'}/Documents/proxy.mov` },
        features: ['aftereffects.footage.set_proxy_file', 'aftereffects.footage.set_proxy_none', 'aftereffects.footage.toggle_proxy'],
        handler: (a) => {
            const list = ids(a.items, 'items');
            const kind = a.proxy !== undefined ? enumOf(a.proxy, ['file', 'sequence', 'solid', 'placeholder', 'none'], { name: 'proxy' }) : null;
            if (!kind && a.useProxy === undefined) throw new Error('Pass proxy, useProxy, or both');
            let body = '';
            if (kind === 'file' || kind === 'sequence') {
                if (a.items.length > 1) throw new Error('A proxy file is set on one item at a time');
                body = `var f = new File(${filePath(a.file)});
  if (!f.exists) throw new Error("File not found: " + f.fsName);
  ${kind === 'file' ? 'it.setProxy(f);' : `it.setProxyWithSequence(f, ${bool(a.forceAlphabetical)});`}`;
            } else if (kind === 'solid') {
                if (a.color === undefined) throw new Error("proxy: solid needs 'color'");
                body = `it.setProxyWithSolid(${colorValue(a.color)}, ${a.name !== undefined ? str(a.name) : 'it.name'}, ${a.width !== undefined ? px(a.width, 'width') : 'it.width'}, ${a.height !== undefined ? px(a.height, 'height') : 'it.height'}, ${a.pixelAspect !== undefined ? num(a.pixelAspect, { min: 0.01, max: 10, name: 'pixelAspect' }) : 'it.pixelAspect'});`;
            } else if (kind === 'placeholder') {
                body = `it.setProxyWithPlaceholder(${a.name !== undefined ? str(a.name) : 'it.name'}, ${a.width !== undefined ? px(a.width, 'width') : 'it.width'}, ${a.height !== undefined ? px(a.height, 'height') : 'it.height'}, ${a.frameRate !== undefined ? num(a.frameRate, { min: 1, max: 999, name: 'frameRate' }) : '(it.frameRate > 0 ? it.frameRate : 30)'}, ${a.duration !== undefined ? num(a.duration, { min: 0.01, max: 86400, name: 'duration' }) : '(it.duration > 0 ? it.duration : 10)'});`;
            } else if (kind === 'none') {
                body = 'it.setProxyToNone();';
            }
            return run('Set proxy', script(`${FOOTAGE}
var ids = ${list}, out = [];
for (var i = 0; i < ids.length; i++) {
  var it = __avItem(ids[i]);
  ${body}
  ${a.useProxy !== undefined ? `if (${bool(a.useProxy)} && !it.proxySource) throw new Error(it.name + " has no proxy to use");
  it.useProxy = ${bool(a.useProxy)};` : ''}
  out.push({ id: it.id, name: it.name, useProxy: it.useProxy, proxy: it.proxySource ? __sourceInfo(it.proxySource) : null });
}
__result__ = { items: out };`, { undo: 'Set proxy' }));
        },
    },
    {
        name: 'create_proxy',
        description: 'Queue a composition to render as its own proxy (File > Create Proxy > Still or Movie): adds a Render Queue item whose post-render action is Set Proxy. Render it with render_queue',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                kind: { type: 'string', enum: ['still', 'movie'], description: 'still: one frame; movie: the whole composition' },
                outputFile: { type: 'string', description: 'Absolute path of the proxy file; the extension should match the output module' },
                time: { type: 'number', minimum: 0, description: 'still: the frame, in seconds. Default the current time' },
                renderSettings: { type: 'string', description: 'Render settings template, e.g. "Draft Settings"' },
                outputModule: { type: 'string', description: 'Output module template. Default "Photoshop" for a still when it exists, otherwise the default template' },
            },
            required: ['kind', 'outputFile'],
        },
        auditArgs: { kind: 'still', outputFile: `${process.env.HOME ?? '/tmp'}/Documents/proxy.psd`, renderSettings: 'Draft Settings', outputModule: 'Photoshop' },
        features: ['aftereffects.footage.create_proxy_still', 'aftereffects.footage.create_proxy_movie'],
        handler: (a) => {
            const kind = enumOf(a.kind, ['still', 'movie'], { name: 'kind' });
            const out = filePath(a.outputFile, 'outputFile');
            if (kind === 'movie' && a.time !== undefined) throw new Error("'time' is for a still proxy");
            return run('Create proxy', script(`
var c = __comp(${compSpec(a.comp)}), rq = proj.renderQueue.items.add(c);
${a.renderSettings ? `rq.applyTemplate(${str(a.renderSettings)});` : ''}
var om = rq.outputModule(1);
${a.outputModule ? `om.applyTemplate(${str(a.outputModule)});` : (kind === 'still' ? 'for (var i = 0; i < om.templates.length; i++) if (om.templates[i] === "Photoshop") { om.applyTemplate("Photoshop"); break; }' : '')}
${kind === 'still' ? `rq.timeSpanStart = ${a.time !== undefined ? num(a.time, { min: 0, name: 'time' }) : 'c.time'};
rq.timeSpanDuration = c.frameDuration;` : ''}
om.file = new File(${out});
om.postRenderAction = PostRenderAction.SET_PROXY;
__result__ = { renderQueueItem: proj.renderQueue.numItems, comp: c.name, kind: ${str(kind)}, file: om.file.fsName, outputModule: om.name };`, { undo: 'Create proxy' }));
        },
    },
    {
        name: 'create_footage_item',
        description: 'Add a footage item without adding a layer: a colour-bar placeholder for footage that is not available yet (File > Import > Placeholder) or a solid (File > Import > Solid), optionally into a folder',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['placeholder', 'solid'], description: 'What to add' },
                name: { type: 'string', description: 'Item name' },
                width: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels. Default 1920', default: 1920 },
                height: { type: 'integer', minimum: 1, maximum: 30000, description: 'Pixels. Default 1080', default: 1080 },
                frameRate: { type: 'number', minimum: 1, maximum: 999, description: 'placeholder: frames per second. Default 30', default: 30 },
                duration: { type: 'number', minimum: 0.01, maximum: 86400, description: 'placeholder: seconds. Default 10', default: 10 },
                color: { ...COLOR_SCHEMA, description: 'solid: colour, "#RRGGBB" or "rgb(r,g,b)"' },
                pixelAspect: { type: 'number', minimum: 0.01, maximum: 10, description: 'solid: pixel aspect ratio. Default 1', default: 1 },
                folder: { type: 'integer', minimum: 1, description: 'Put the item in this folder (id)' },
            },
            required: ['kind', 'name'],
        },
        auditArgs: { kind: 'solid', color: '#336699' },
        features: ['aftereffects.footage.import_placeholder', 'aftereffects.footage.import_solid'],
        handler: (a) => {
            const kind = enumOf(a.kind, ['placeholder', 'solid'], { name: 'kind' });
            if (typeof a.name !== 'string' || !a.name.trim()) throw new Error("'name' is required");
            if (kind === 'solid' && a.color === undefined) throw new Error("kind: solid needs 'color'");
            const w = px(a.width ?? 1920, 'width'), h = px(a.height ?? 1080, 'height');
            const fr = num(a.frameRate ?? 30, { min: 1, max: 999, name: 'frameRate' });
            const dur = num(a.duration ?? 10, { min: 0.01, max: 86400, name: 'duration' });
            return run('Create footage item', script(`${FOOTAGE}
var folder = ${a.folder !== undefined ? `proj.itemByID(${index(a.folder, { name: 'folder' })})` : 'null'};
if (folder !== null && !(folder instanceof FolderItem)) throw new Error("folder must be a folder item");
var it = proj.importPlaceholder(${str(a.name)}, ${w}, ${h}, ${fr}, ${dur});
${kind === 'solid' ? `it.replaceWithSolid(${colorValue(a.color)}, ${str(a.name)}, ${w}, ${h}, ${num(a.pixelAspect ?? 1, { min: 0.01, max: 10, name: 'pixelAspect' })});` : ''}
if (folder) it.parentFolder = folder;
__result__ = __footageInfo(it);`, { undo: 'Create footage item' }));
        },
    },
    {
        name: 'reload_footage',
        description: 'Re-read footage items from disk so changes made in other applications appear (File > Reload Footage)',
        inputSchema: { type: 'object', properties: { items: ITEMS_SCHEMA }, required: ['items'] },
        hints: { idempotent: true },
        features: ['aftereffects.footage.reload_footage'],
        handler: (a) => run('Reload footage', script(`${FOOTAGE}
var ids = ${ids(a.items, 'items')}, out = [];
for (var i = 0; i < ids.length; i++) {
  var it = __footage(ids[i]);
  if (!(it.mainSource instanceof FileSource)) throw new Error(it.name + " is not file footage");
  it.mainSource.reload();
  out.push({ id: it.id, name: it.name, footageMissing: it.footageMissing });
}
__result__ = { items: out };`)),
    },
    {
        name: 'open_footage',
        description: 'Open a footage item in the Footage panel, reveal its file in Finder or Explorer (Reveal in Finder / Reveal in Explorer) or in Adobe Bridge (File > Reveal in Bridge), or open it in the application that made it (Edit > Edit Original). With target bridge and no item, opens Adobe Bridge (File > Browse in Bridge)',
        inputSchema: {
            type: 'object',
            properties: {
                item: { type: 'integer', minimum: 1, description: 'Footage item id. Optional only for target bridge' },
                target: { type: 'string', enum: ['footage_panel', 'finder', 'bridge', 'original_application'], description: 'Where to open it' },
            },
            required: ['target'],
        },
        auditArgs: { item: 1, target: 'finder' },
        hints: { idempotent: true, openWorld: true },
        features: [
            'aftereffects.footage.footage_panel',
            'aftereffects.footage.reveal_in_explorer_finder',
            'aftereffects.footage.edit_original',
            'aftereffects.projects.reveal_in_bridge',
            'aftereffects.projects.browse_in_bridge',
        ],
        handler: (a) => {
            const target = enumOf(a.target, ['footage_panel', 'finder', 'bridge', 'original_application'], { name: 'target' });
            if (a.item === undefined) {
                if (target !== 'bridge') throw new Error(`target ${target} needs 'item'`);
                return run('Browse in Bridge', script('app.executeCommand(3689);\n__result__ = { opened: "Adobe Bridge" };'));
            }
            const command = { finder: 2562, bridge: 3690, original_application: 2142 }[target];
            return run('Open footage', script(`${FOOTAGE}
var it = __footage(${index(a.item, { name: 'item' })});
${target === 'footage_panel' ? 'it.openInViewer();' : `if (!(it.mainSource instanceof FileSource)) throw new Error(it.name + " has no source file");
__selectOnly(it);
app.executeCommand(${command});`}
__result__ = { id: it.id, name: it.name, target: ${str(target)}, file: it.file ? it.file.fsName : null };`));
        },
    },
    {
        name: 'detect_scene_edits',
        description: 'Find the cuts in video footage layers (Layer > Scene Edit Detection) and add a marker at each, split the layer at each cut, or split and pre-compose each scene; none only returns the cut times',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                mode: { type: 'string', enum: Object.keys(SED_MODES), description: 'markers: Create Layer Markers; split: Split Layer; split_precomp: Split Layer and Create Pre-comps; none: report the cuts only. Default markers', default: 'markers' },
            },
            required: ['layers'],
        },
        features: [
            'aftereffects.footage.scene_edit_detection',
            'aftereffects.footage.sed_create_layer_markers',
            'aftereffects.footage.sed_split_layer',
            'aftereffects.footage.sed_create_precomps',
        ],
        handler: (a) => {
            const mode = SED_MODES[enumOf(a.mode ?? 'markers', Object.keys(SED_MODES), { name: 'mode' })];
            return run('Scene edit detection', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof AVLayer) || !(ls[i].source instanceof FootageItem) || !ls[i].hasVideo) throw new Error("Layer " + ls[i].index + " is not a video footage layer");
}
for (var j = 0; j < ls.length; j++) {
  var name = ls[j].name, cuts = ls[j].doSceneEditDetection(SceneEditDetectionMode.${mode});
  out.push({ layer: name, cuts: cuts });
}
__result__ = { mode: ${str(a.mode ?? 'markers')}, layers: out, layerCount: c.numLayers };`, { undo: 'Scene edit detection' }));
        },
    },
    {
        name: 'paste_svg_as_shapes',
        description: 'Paste SVG artwork from the clipboard (for example copied from Illustrator) into a composition as shape layers (Edit > Paste). Opens the composition first',
        inputSchema: { type: 'object', properties: { comp: COMP_SCHEMA } },
        features: ['aftereffects.footage.paste_svg_from_clipboard'],
        handler: (a) => run('Paste SVG', script(`
var c = __comp(${compSpec(a.comp)}), before = c.numLayers;
c.openInViewer();
app.executeCommand(20);
if (c.numLayers === before) throw new Error("Nothing was pasted: copy SVG artwork to the clipboard first");
__result__ = { comp: c.name, layersAdded: c.numLayers - before, layers: c.numLayers };`, { undo: 'Paste SVG' })),
    },
];
