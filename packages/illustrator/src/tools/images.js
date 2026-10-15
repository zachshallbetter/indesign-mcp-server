/**
 * Images and links: the Links panel, placing several files, Photoshop import
 * options, rasterizing, cropping and colorizing images.
 *
 * Linked files are PlacedItems; embedded images are RasterItems (embedding a
 * placed item deletes it and leaves native art). Reading a placed item's file
 * throws when the link is missing, so every read is guarded.
 *
 * Object > Rasterize and Create Object Mosaic open dialogs and Object > Crop
 * Image waits for the crop to be applied on the canvas, so rasterizing and
 * cropping go through Document.rasterize instead, the way the Rasterize dialog
 * describes its options. Create Object Mosaic, Edit Original and Mockup > Edit
 * are not offered.
 */
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec, colorSpec } from '../args.js';
import { paths } from './documents.js';

const KINDS = ['linked', 'embedded', 'embedded_file', 'non_native', 'plugin'];
const COLOR_MODELS = { default: 'DEFAULTCOLORMODEL', grayscale: 'GRAYSCALE', bitmap: 'BITMAP' };
const BACKGROUNDS = ['white', 'transparent', 'black'];
const ANTI_ALIASING = { none: 'None', art: 'ARTOPTIMIZED', type: 'TYPEOPTIMIZED' };

/** Object menu commands that act on a selected image and open no dialog. */
export const IMAGE_COMMANDS = {
    remove_background: 'Remove Background Object Menu',
    make_mockup: 'Make Vector Edge',
    release_mockup: 'Release Vector Edge',
};

/** A rectangle on an artboard, in points from its top-left corner. */
const RECT_SCHEMA = {
    type: 'object',
    description: 'A rectangle in points from the artboard\'s top-left corner, y down',
    properties: {
        x: { type: 'number' }, y: { type: 'number' },
        width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
    },
    required: ['x', 'y', 'width', 'height'],
};

/** A rect argument as JSX statements setting `clip` to document bounds [left, top, right, bottom]. */
function clipRect(rect, artboardIndex, name) {
    if (!rect || typeof rect !== 'object') throw new Error(`'${name}' needs x, y, width and height in points`);
    const x = num(rect.x, { name: `${name}.x` });
    const y = num(rect.y, { name: `${name}.y` });
    const w = num(rect.width, { min: 0.001, name: `${name}.width` });
    const h = num(rect.height, { min: 0.001, name: `${name}.height` });
    return `var ab = __artboard(doc, ${index(artboardIndex ?? 0, { name: 'artboardIndex' })});
var tl = __toDoc(doc, ab, ${x}, ${y}), br = __toDoc(doc, ab, ${x} + ${w}, ${y} + ${h});
var clip = [tl[0], tl[1], br[0], br[1]];`;
}

/** ES3: describe an image or other placed art the way the Links panel does. */
const IMAGE_INFO = `
function __fileInfo(f) {
  if (!f) return null;
  var out = { path: f.fsName, name: f.displayName, exists: f.exists, format: null, bytes: null, modified: null };
  var dot = f.displayName.lastIndexOf(".");
  if (dot > 0) out.format = f.displayName.substring(dot + 1).toLowerCase();
  if (f.exists) { out.bytes = f.length; try { out.modified = f.modified.toString(); } catch (e) {} }
  return out;
}
function __ppi(it) {
  try { var m = it.matrix, s = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB); return s > 0 ? 72 / s : null; } catch (e) { return null; }
}
function __imageInfo(doc, it, kind) {
  var info = __itemInfo(doc, it), f = null;
  info.kind = kind;
  if (kind === "linked" || kind === "embedded" || kind === "embedded_file") {
    try { f = it.file; } catch (e) { f = null; }
    info.file = __fileInfo(f);
  }
  if (kind === "linked") { info.missing = !f || !f.exists; info.ppi = __ppi(it); }
  if (kind === "embedded") {
    info.embedded = it.embedded; info.ppi = __ppi(it);
    info.status = String(it.status).replace("RasterLinkState.", "");
    info.colorSpace = String(it.imageColorSpace).replace("ImageColorSpace.", "");
    info.bitsPerChannel = it.bitsPerChannel; info.channels = it.channels;
    info.transparent = it.transparent; info.colorizedGrayscale = it.colorizedGrayscale;
  }
  if (kind === "plugin") { try { info.isTracing = it.isTracing; } catch (e) { info.isTracing = null; } }
  return info;
}`;

/** ES3: targets that must all be linked (placed) items. */
const PLACED_TARGETS = `
function __placed(items) {
  for (var i = 0; i < items.length; i++) if (items[i].typename !== "PlacedItem") throw new Error("Item " + (items[i].name || i) + " is a " + items[i].typename + ", not a linked file");
  return items;
}
function __linkPath(it) {
  try { return it.file.fsName; } catch (e) { return null; }
}`;

/** ES3: union of visible bounds, in document coordinates. */
const UNION = `
function __union(items) {
  var u = null;
  for (var i = 0; i < items.length; i++) {
    var b = items[i].visibleBounds;
    if (!u) u = [b[0], b[1], b[2], b[3]];
    else { u[0] = Math.min(u[0], b[0]); u[1] = Math.max(u[1], b[1]); u[2] = Math.max(u[2], b[2]); u[3] = Math.min(u[3], b[3]); }
  }
  return u;
}`;

/** RasterizeOptions as `o`, from rasterize_items' arguments (the Rasterize dialog's choices). */
export function rasterizeOptions(a) {
    const bg = enumOf(a.background ?? 'white', BACKGROUNDS, { name: 'background' });
    const model = enumOf(a.colorModel ?? 'default', Object.keys(COLOR_MODELS), { name: 'colorModel' });
    const aa = enumOf(a.antiAliasing ?? 'art', Object.keys(ANTI_ALIASING), { name: 'antiAliasing' });
    return `var o = new RasterizeOptions();
o.resolution = ${num(a.resolution ?? 300, { min: 72, max: 2400, name: 'resolution' })};
o.colorModel = RasterizationColorModel.${COLOR_MODELS[model]};
o.transparency = ${bool(bg === 'transparent')};
o.backgroundBlack = ${bool(bg === 'black')};
o.antiAliasingMethod = AntiAliasingMethod.${ANTI_ALIASING[aa]};
o.clippingMask = ${bool(a.clippingMask)};
o.padding = __len(doc, ${num(a.padding ?? 0, { min: 0, max: 1000, name: 'padding' })});
o.convertSpotColors = ${bool(!(a.preserveSpotColors ?? true))};
o.convertTextToOutlines = ${bool(a.convertTextToOutlines)};
o.includeLayers = ${bool(a.includeLayers)};`;
}

/** Photoshop import options (OpenOptionsPhotoshop) as a JSX literal, or null. */
function photoshopSpec(p, embed) {
    if (p === undefined || p === null) return null;
    if (typeof p !== 'object') throw new Error("'photoshop' is an object: { layersToObjects, hiddenLayers, slices, imageMaps, layerComp }");
    if (p.layersToObjects && !embed) {
        throw new Error('layersToObjects needs embed: true: Illustrator places a linked Photoshop file flattened');
    }
    const out = {};
    if (p.layersToObjects !== undefined) out.preserveLayers = !!p.layersToObjects;
    if (p.hiddenLayers !== undefined) out.preserveHiddenLayers = !!p.hiddenLayers;
    if (p.slices !== undefined) out.preserveSlices = !!p.slices;
    if (p.imageMaps !== undefined) out.preserveImageMaps = !!p.imageMaps;
    if (p.layerComp !== undefined) {
        const comp = String(p.layerComp);
        if (comp.length > 255) throw new Error("'photoshop.layerComp' is too long");
        out.layerComp = comp;
    }
    return json(out);
}

export const tools = [
    {
        name: 'list_images',
        description: 'List linked and embedded images and other non-native art (the Links panel and Links information): file name, path, format, size on disk, modified date, missing links, effective resolution, colour space and bits per channel of embedded images, embedded files, non-native art and plug-in art such as tracings',
        inputSchema: {
            type: 'object',
            properties: {
                kinds: {
                    type: 'array', items: { type: 'string', enum: KINDS },
                    description: 'linked: placed files; embedded: embedded images (raster items); embedded_file: embedded files; non_native: art Illustrator keeps but cannot edit; plugin: plug-in art such as Image Trace objects. Default all',
                },
                missingOnly: { type: 'boolean', description: 'Only linked files that are missing. Default false', default: false },
                limit: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
            },
        },
        features: [
            'illustrator.images.links_panel',
            'illustrator.images.link_info',
            'illustrator.images.raster_item',
            'illustrator.images.embedded_item',
            'illustrator.images.non_native_item',
            'illustrator.images.plugin_item',
        ],
        hints: { readOnly: true },
        handler: (a) => {
            const kinds = a.kinds?.length ? a.kinds.map((k) => enumOf(k, KINDS, { name: 'kinds' })) : KINDS;
            const want = (k) => (a.missingOnly ? k === 'linked' : kinds.includes(k));
            return run('List images', script(`${IMAGE_INFO}
var max = ${index(a.limit ?? 500, { name: 'limit', max: 2000 })}, out = [], total = 0, missing = 0;
var add = function (col, kind) {
  for (var i = 0; i < col.length; i++) {
    var info = __imageInfo(doc, col[i], kind);
    if (info.missing) missing++;
    if (${bool(a.missingOnly)} && !info.missing) continue;
    total++;
    if (out.length < max) out.push(info);
  }
};
${want('linked') ? 'add(doc.placedItems, "linked");' : ''}
${want('embedded') ? 'add(doc.rasterItems, "embedded");' : ''}
${want('embedded_file') ? 'add(doc.embeddedItems, "embedded_file");' : ''}
${want('non_native') ? 'add(doc.nonNativeItems, "non_native");' : ''}
${want('plugin') ? 'add(doc.pluginItems, "plugin");' : ''}
__result__ = { total: total, missingLinks: missing, items: out, truncated: total > out.length };`));
        },
    },
    {
        name: 'relink_images',
        description: 'Relink or replace linked files (Links panel > Relink). Give target and filePath to point the targets at another file; with allInstances, every placement of the same file is relinked too. Give folder to replace missing links at once: each missing link is relinked to the file with the same name in that folder',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: 'Linked items to relink. With folder, optional: default every missing link' },
                filePath: { type: 'string', description: 'Absolute path of the new file' },
                allInstances: { type: 'boolean', description: 'With filePath: also relink every other placement of the targets\' current file. Default false', default: false },
                folder: { type: 'string', description: 'Absolute folder to search for missing links by file name' },
            },
        },
        features: [
            'illustrator.images.relink',
            'illustrator.images.links_control.relink',
            'illustrator.images.relink_all_instances',
            'illustrator.images.replace_missing_links',
            'illustrator.images.relink_missing_at_once',
        ],
        hints: { destructive: true, idempotent: true },
        auditArgs: { target: { selection: true }, folder: undefined, allInstances: true },
        handler: (a) => {
            if (!!a.filePath === !!a.folder) throw new Error('Give either filePath (with target) to relink, or folder to replace missing links');
            if (a.filePath) {
                const p = paths.validate(a.filePath);
                return run('Relink images', script(`${PLACED_TARGETS}
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var items = __placed(__targets(doc, ${targetSpec(a.target)})), relinked = [];
${a.allInstances ? `var from = {}, i;
for (i = 0; i < items.length; i++) { var lp = __linkPath(items[i]); if (lp) from[lp] = true; }
for (i = 0; i < doc.placedItems.length; i++) {
  var pi = doc.placedItems[i], cp = __linkPath(pi), seen = false;
  for (var k = 0; k < items.length; k++) if (items[k] === pi) seen = true;
  if (!seen && cp && from[cp]) items.push(pi);
}` : ''}
for (var j = 0; j < items.length; j++) { items[j].relink(f); relinked.push(__itemInfo(doc, items[j])); }
__result__ = { file: f.fsName, relinked: relinked };`));
            }
            const folder = paths.validate(a.folder);
            return run('Replace missing links', script(`${PLACED_TARGETS}
var dir = new Folder(${jsxPath(folder)});
if (!dir.exists) throw new Error("Folder not found: " + dir.fsName);
var items = ${a.target ? `__placed(__targets(doc, ${targetSpec(a.target)}))` : 'doc.placedItems'};
var relinked = [], notFound = [], unknown = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], f = null, name = null;
  try { f = it.file; } catch (e) { f = null; }
  if (f && f.exists) continue;
  if (f) name = f.displayName;
  else if (/\\.[A-Za-z0-9]{2,5}$/.test(it.name)) name = it.name;
  var id = null;
  try { id = it.uuid; } catch (e2) {}
  if (!name) { unknown.push(id); continue; }
  var cand = new File(dir.fsName + "/" + name);
  if (!cand.exists) { notFound.push({ id: id, name: name }); continue; }
  it.relink(cand);
  relinked.push({ id: id, file: cand.fsName });
}
__result__ = { relinked: relinked, notFound: notFound, unknownName: unknown };`));
        },
    },
    {
        name: 'update_links',
        description: 'Update linked files that changed on disk (Links panel > Update Link), or embed them (Embed Image). Acts on the targets, or every linked file with all: true. Embedding replaces each placed item with native art, so its id changes',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['update', 'embed'], description: 'Default update' },
                target: TARGET_SCHEMA,
                all: { type: 'boolean', description: 'Every linked file in the document instead of target', default: false },
            },
        },
        features: [
            'illustrator.images.update_link',
            'illustrator.images.links_control.update_link',
            'illustrator.images.embed',
        ],
        hints: { destructive: true },
        auditArgs: { target: undefined, all: true },
        handler: (a) => {
            const op = enumOf(a.operation ?? 'update', ['update', 'embed'], { name: 'operation' });
            if (!a.all && !a.target) throw new Error('Choose the links: target, or all: true');
            const items = a.all ? 'var items = []; for (var n = 0; n < doc.placedItems.length; n++) items.push(doc.placedItems[n]);'
                : `var items = __placed(__targets(doc, ${targetSpec(a.target)}));`;
            return run(op === 'update' ? 'Update links' : 'Embed links', script(`${PLACED_TARGETS}
${items}
var done = [], skipped = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i], f = null;
  try { f = it.file; } catch (e) { f = null; }
  var info = __itemInfo(doc, it);
  if (!f || !f.exists) { skipped.push({ id: info.id, reason: "missing link" }); continue; }
  ${op === 'update' ? 'it.relink(f);' : 'it.embed(); info.embedded = true;'}
  info.file = f.fsName;
  done.push(info);
}
__result__ = { operation: ${str(op)}, ${op === 'update' ? 'updated' : 'embedded'}: done, skipped: skipped };`));
        },
    },
    {
        name: 'go_to_link',
        description: 'Select a linked or embedded image and centre the view on it (Links panel > Go To Link)',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                zoom: { type: 'number', minimum: 0.03125, maximum: 640, description: 'Zoom factor (1 = 100%). Default: keep the current zoom' },
            },
            required: ['target'],
        },
        features: ['illustrator.images.links_control.go_to_link'],
        hints: { idempotent: true },
        handler: (a) => run('Go to link', script(`
var items = __targets(doc, ${targetSpec(a.target)});
if (items.length !== 1) throw new Error("Go to one item: the target matched " + items.length);
var it = items[0], b = it.visibleBounds;
doc.selection = null;
it.selected = true;
var v = doc.activeView;
${a.zoom !== undefined ? `v.zoom = ${num(a.zoom, { min: 0.03125, max: 640, name: 'zoom' })};` : ''}
v.centerPoint = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
__result__ = { item: __itemInfo(doc, it), zoom: v.zoom };`)),
    },
    {
        name: 'place_images',
        description: 'Place several files at once (File > Place with multiple files), laid out in a grid from x, y on an artboard, linked or embedded. Photoshop files take the Photoshop Import Options: convert layers to objects (needs embed), import hidden layers, slices, image maps and a layer comp; Illustrator\'s own options are restored afterwards',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Absolute paths, placed in this order' },
                artboardIndex: ARTBOARD_SCHEMA,
                x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 },
                columns: { type: 'integer', minimum: 1, maximum: 100, description: 'Files per row. Default: all in one row' },
                gap: { type: 'number', minimum: 0, description: 'Space between files in points. Default 10', default: 10 },
                width: { type: 'number', minimum: 1, description: 'Scale each file proportionally to this width in points' },
                embed: { type: 'boolean', description: 'Embed instead of linking. Default false', default: false },
                layer: { type: 'string' },
                photoshop: {
                    type: 'object',
                    description: 'Photoshop Import Options for .psd files',
                    properties: {
                        layersToObjects: { type: 'boolean', description: 'Convert Layers to Objects (true) or flatten to a single image (false). Needs embed' },
                        hiddenLayers: { type: 'boolean', description: 'Import Hidden Layers' },
                        slices: { type: 'boolean', description: 'Import Slices' },
                        imageMaps: { type: 'boolean', description: 'Import Image Maps' },
                        layerComp: { type: 'string', description: 'Name of the layer comp to import' },
                    },
                },
            },
            required: ['files'],
        },
        features: [
            'illustrator.images.place_multiple',
            'illustrator.images.place_option.show_import_options',
            'illustrator.images.photoshop_import_options',
            'illustrator.images.psd_import_option.convert_layers_to_objects',
            'illustrator.images.psd_import_option.import_hidden_layers',
            'illustrator.images.psd_import_option.import_slices',
            'illustrator.images.psd_import_option.import_image_maps',
            'illustrator.images.psd_import_option.layer_comp',
            'illustrator.images.linked_psd',
        ],
        auditArgs: { files: ['a.psd', 'b.png'].map((f) => `${process.env.HOME ?? '/tmp'}/Documents/${f}`), columns: 2, width: 100, photoshop: { hiddenLayers: true, slices: false, imageMaps: false, layerComp: 'Web' } },
        handler: (a) => {
            if (!Array.isArray(a.files) || !a.files.length) throw new Error("'files' needs at least one absolute path");
            if (a.files.length > 100) throw new Error("'files' takes at most 100 paths");
            const files = a.files.map((f) => jsxPath(paths.validate(f)));
            const psd = photoshopSpec(a.photoshop, a.embed);
            const columns = a.columns === undefined ? files.length : Number(index(a.columns, { name: 'columns', max: 100 }));
            if (columns < 1) throw new Error("'columns' must be at least 1");
            return run('Place images', script(`
var files = [${files.join(', ')}], fs = [];
for (var n = 0; n < files.length; n++) {
  var ff = new File(files[n]);
  if (!ff.exists) throw new Error("File not found: " + ff.fsName);
  fs.push(ff);
}
var layer = __layer(doc, ${a.layer ? str(a.layer) : 'null'});
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var gap = ${num(a.gap ?? 10, { min: 0, name: 'gap' })}, cols = ${columns};
var x0 = ${num(a.x ?? 0, { name: 'x' })}, cx = x0, cy = ${num(a.y ?? 0, { name: 'y' })}, rowH = 0, placed = [];
var psd = ${psd ?? 'null'}, po = app.preferences.photoshopFileOptions, was = null;
if (psd) {
  was = { preserveLayers: po.preserveLayers, preserveHiddenLayers: po.preserveHiddenLayers, preserveSlices: po.preserveSlices, preserveImageMaps: po.preserveImageMaps, layerComp: po.layerComp };
  for (var key in psd) if (psd.hasOwnProperty(key)) po[key] = psd[key];
}
try {
  for (var i = 0; i < fs.length; i++) {
    if (i > 0 && i % cols === 0) { cx = x0; cy += rowH + gap; rowH = 0; }
    var it = layer.placedItems.add();
    it.file = fs[i];
    ${a.width !== undefined ? `var s = __len(doc, ${num(a.width, { min: 1, name: 'width' })}) / it.width * 100; it.resize(s, s);` : ''}
    it.position = __toDoc(doc, ab, cx, cy);
    var info = __itemInfo(doc, it);
    info.file = fs[i].fsName;
    cx += info.width + gap;
    if (info.height > rowH) rowH = info.height;
    ${a.embed ? 'it.embed(); info.embedded = true;' : ''}
    placed.push(info);
  }
} finally {
  if (was) for (var k2 in was) if (was.hasOwnProperty(k2)) po[k2] = was[k2];
}
__result__ = { placed: placed };`));
        },
    },
    {
        name: 'rasterize_items',
        description: 'Rasterize the targets into an embedded image (Object > Rasterize), with the dialog\'s options: colour model, resolution, background, anti-aliasing, clipping mask, space added around the object, spot colours, text to outlines and layer attributes. By default the targets become one image; clipBounds limits it to a rectangle. The vector originals are removed',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                resolution: { type: 'number', minimum: 72, maximum: 2400, description: 'Pixels per inch: 72 screen, 150 medium, 300 high. Default 300', default: 300 },
                colorModel: { type: 'string', enum: Object.keys(COLOR_MODELS), description: 'default: the document\'s colour mode. Default default' },
                background: { type: 'string', enum: BACKGROUNDS, description: 'Default white' },
                antiAliasing: { type: 'string', enum: Object.keys(ANTI_ALIASING), description: 'none, art (Art Optimized, supersampling) or type (Type Optimized, hinted). Default art' },
                clippingMask: { type: 'boolean', description: 'Create Clipping Mask: mask the background. Default false', default: false },
                padding: { type: 'number', minimum: 0, maximum: 1000, description: 'Add Around Object, in points. Default 0', default: 0 },
                preserveSpotColors: { type: 'boolean', description: 'Keep spot colours; false converts them to process. Default true', default: true },
                convertTextToOutlines: { type: 'boolean', description: 'Outline text before rasterizing. Default false', default: false },
                includeLayers: { type: 'boolean', description: 'Keep layer opacity and blending in the image. Default false', default: false },
                separately: { type: 'boolean', description: 'One image per target instead of one for all. Default false', default: false },
                clipBounds: { ...RECT_SCHEMA, description: 'Rasterize only this rectangle, in points from the artboard\'s top-left corner' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['target'],
        },
        features: [
            'illustrator.images.rasterize',
            'illustrator.images.rasterize_option.color_model',
            'illustrator.images.rasterize_option.resolution',
            'illustrator.images.rasterize_option.background_transparent',
            'illustrator.images.rasterize_option.background_black',
            'illustrator.images.rasterize_option.anti_aliasing',
            'illustrator.images.rasterize_option.create_clipping_mask',
            'illustrator.images.rasterize_option.add_around_object',
            'illustrator.images.rasterize_option.preserve_spot_colors_off_converts',
            'illustrator.images.rasterize_option.convert_text_to_outlines',
            'illustrator.images.rasterize_option.include_layers',
        ],
        hints: { destructive: true },
        auditArgs: { background: 'transparent', antiAliasing: 'type', clipBounds: { x: 0, y: 0, width: 200, height: 100 } },
        handler: (a) => {
            const opts = rasterizeOptions(a);
            const clip = a.clipBounds ? clipRect(a.clipBounds, a.artboardIndex, 'clipBounds') : 'var clip = null;';
            return run('Rasterize', script(`${UNION}
var items = __targets(doc, ${targetSpec(a.target)});
${opts}
${clip}
var out = [];
${a.separately
        ? 'for (var i = 0; i < items.length; i++) out.push(doc.rasterize(items[i], clip || items[i].visibleBounds, o));'
        : 'out.push(doc.rasterize(items.length === 1 ? items[0] : items, clip || __union(items), o));'}
var info = [];
for (var j = 0; j < out.length; j++) info.push(__itemInfo(doc, out[j]));
__result__ = { images: info };`));
        },
    },
    {
        name: 'crop_image',
        description: 'Crop linked or embedded images to a rectangle, discarding the pixels outside it (Object > Crop Image). The result is an embedded image at the given resolution; a linked file is embedded, as Crop Image does',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                bounds: { ...RECT_SCHEMA, description: 'The area to keep, in points from the artboard\'s top-left corner' },
                artboardIndex: ARTBOARD_SCHEMA,
                resolution: { type: 'number', minimum: 72, maximum: 2400, description: 'Pixels per inch of the cropped image. Default 300; list_images gives each image\'s current ppi', default: 300 },
            },
            required: ['target', 'bounds'],
        },
        features: ['illustrator.images.crop_image'],
        hints: { destructive: true },
        auditArgs: { bounds: { x: 10, y: 10, width: 200, height: 150 } },
        handler: (a) => run('Crop image', script(`
var items = __targets(doc, ${targetSpec(a.target)});
for (var n = 0; n < items.length; n++) if (items[n].typename !== "PlacedItem" && items[n].typename !== "RasterItem") throw new Error("Crop works on images: item " + (items[n].name || n) + " is a " + items[n].typename);
${clipRect(a.bounds, a.artboardIndex, 'bounds')}
var o = new RasterizeOptions();
o.resolution = ${num(a.resolution ?? 300, { min: 72, max: 2400, name: 'resolution' })};
o.transparency = true;
o.antiAliasingMethod = AntiAliasingMethod.None;
var out = [];
for (var i = 0; i < items.length; i++) {
  var b = items[i].visibleBounds;
  var r = [Math.max(b[0], clip[0]), Math.min(b[1], clip[1]), Math.min(b[2], clip[2]), Math.max(b[3], clip[3])];
  if (r[0] >= r[2] || r[3] >= r[1]) throw new Error("The crop rectangle does not overlap image " + (items[i].name || i));
  out.push(__itemInfo(doc, doc.rasterize(items[i], r, o)));
}
__result__ = { images: out };`)),
    },
    {
        name: 'colorize_image',
        description: 'Colour a grayscale or 1-bit embedded image with an RGB or CMYK colour (Colorize, the way a fill applies to such an image). Embed linked images first with update_links',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                color: { type: 'string', description: 'An RGB or CMYK colour: "#RRGGBB", "rgb(r,g,b)", "cmyk(c,m,y,k)" or a process swatch name' },
            },
            required: ['target', 'color'],
        },
        features: ['illustrator.images.raster_colorize'],
        hints: { idempotent: true },
        auditArgs: { color: 'cmyk(0,60,100,0)' },
        handler: (a) => {
            const spec = colorSpec(a.color, 'color');
            const kind = spec && JSON.parse(spec).kind;
            if (!spec || kind === 'none' || kind === 'gray') throw new Error("'color' must be an RGB or CMYK colour or a swatch");
            return run('Colorize image', script(`
var items = __targets(doc, ${targetSpec(a.target)}), c = __color(doc, ${spec}), out = [];
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (it.typename !== "RasterItem") throw new Error("Item " + (it.name || i) + " is a " + it.typename + ": only embedded images can be colorized; embed it first");
  if (it.imageColorSpace !== ImageColorSpace.GrayScale && it.bitsPerChannel !== 1) throw new Error("Image " + (it.name || i) + " is not grayscale or 1-bit");
  it.colorize(c);
  out.push(__itemInfo(doc, it));
}
__result__ = { colorized: out, color: __colorInfo(c) };`));
        },
    },
    {
        name: 'run_image_command',
        description: 'Run an Object menu image command on the targets: remove_background (Object > Remove Background, Illustrator 30.4 and later: keeps the subject of an image), make_mockup (Object > Mockup > Make / Preview: wrap the vector art onto the image beneath it; select both), release_mockup (Object > Mockup > Release). These features may download components or contact Adobe services on first use, so a call can take a while',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                operation: { type: 'string', enum: Object.keys(IMAGE_COMMANDS) },
            },
            required: ['target', 'operation'],
        },
        features: [
            'illustrator.images.remove_background',
            'illustrator.images.mockup_make',
            'illustrator.images.mockup_release',
        ],
        menuCommands: Object.values(IMAGE_COMMANDS),
        hints: { destructive: true, openWorld: true },
        handler: (a) => {
            const op = enumOf(a.operation, Object.keys(IMAGE_COMMANDS), { name: 'operation' });
            return run('Image command', script(`
var items = __targets(doc, ${targetSpec(a.target)});
${op === 'make_mockup' ? 'if (items.length < 2) throw new Error("make_mockup needs the vector art and the image: give both as targets");' : ''}
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand(${str(IMAGE_COMMANDS[op])});
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { operation: ${str(op)}, selected: out };`));
        },
    },
];
