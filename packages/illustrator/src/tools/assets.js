/**
 * Asset export and slices: the Asset Export panel, Export Selection, Object > Slice,
 * and the URLs that make image maps.
 *
 * The Asset Export panel's list is Document.assets; its export is
 * Document.exportForScreens with the asset ids (export_for_screens, assets).
 * Slice commands that open no dialog go through executeMenuCommand on the
 * selection. Divide Slices, Slice Options and Save Selected Slices open a
 * dialog and are not offered.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, ARTBOARD_SCHEMA, targetSpec } from '../args.js';
import { paths } from './documents.js';

/** Export for Screens scale types, by the suffix the dialog shows (2x, 512w, 512h, 144ppi). */
const SCALE_TYPES = {
    factor: { type: 'SCALEBYFACTOR', min: 0.1, max: 10, tag: (v) => `@${v}x-` },
    width: { type: 'SCALEBYWIDTH', min: 1, max: 20000, tag: (v) => `${v}w-` },
    height: { type: 'SCALEBYHEIGHT', min: 1, max: 20000, tag: (v) => `${v}h-` },
    resolution: { type: 'SCALEBYRESOLUTION', min: 1, max: 2400, tag: (v) => `${v}ppi-` },
};

const ANTI_ALIAS = { none: 'None', art: 'ARTOPTIMIZED', type: 'TYPEOPTIMIZED' };
const JPEG_METHODS = { baseline: 'BASELINESTANDARD', optimized: 'BASELINEOPTIMIZED', progressive: 'PROGRESSIVE' };
const SVG_STYLING = { internal_css: 'STYLEELEMENTS', inline_style: 'STYLEATTRIBUTES', presentation_attributes: 'PRESENTATIONATTRIBUTES' };
const SVG_FONTS = { svg: 'SVGFONT', outlines: 'OUTLINEFONT' };
const SVG_IMAGES = { embed: 'EMBED', link: 'LINK', preserve: 'PRESERVE' };
const SVG_IDS = { layer_names: 'SVGIDREGULAR', minimal: 'SVGIDMINIMAL', unique: 'SVGIDUNIQUE' };

/** Export for Screens > Advanced Settings, one object per format. */
export const SCREEN_ADVANCED_SCHEMA = {
    type: 'object',
    description: 'Advanced Settings per format; options not given keep Illustrator\'s defaults',
    properties: {
        png: {
            type: 'object',
            description: 'PNG (24-bit)',
            properties: {
                antiAliasing: { type: 'string', enum: Object.keys(ANTI_ALIAS) },
                transparency: { type: 'boolean' },
                interlaced: { type: 'boolean' },
                backgroundBlack: { type: 'boolean', description: 'Without transparency, rasterise against black instead of white' },
            },
        },
        png8: {
            type: 'object',
            description: 'PNG 8-bit',
            properties: {
                antiAliasing: { type: 'string', enum: Object.keys(ANTI_ALIAS) },
                transparency: { type: 'boolean' },
                interlaced: { type: 'boolean' },
                colors: { type: 'integer', minimum: 2, maximum: 256 },
            },
        },
        jpeg: {
            type: 'object',
            description: 'Every JPEG quality',
            properties: {
                antiAliasing: { type: 'string', enum: Object.keys(ANTI_ALIAS) },
                compression: { type: 'string', enum: Object.keys(JPEG_METHODS) },
                scans: { type: 'integer', minimum: 3, maximum: 5, description: 'Progressive scans' },
                embedProfile: { type: 'boolean', description: 'Embed the ICC profile' },
            },
        },
        svg: {
            type: 'object',
            properties: {
                styling: { type: 'string', enum: Object.keys(SVG_STYLING) },
                fonts: { type: 'string', enum: Object.keys(SVG_FONTS) },
                images: { type: 'string', enum: Object.keys(SVG_IMAGES) },
                objectIds: { type: 'string', enum: Object.keys(SVG_IDS) },
                decimals: { type: 'integer', minimum: 1, maximum: 7 },
                minify: { type: 'boolean' },
                responsive: { type: 'boolean' },
            },
        },
        pdf: {
            type: 'object',
            properties: { preset: { type: 'string', description: 'PDF preset name, e.g. "[High Quality Print]"' } },
        },
    },
};

/** Check one advanced-settings group: an object with known keys only. */
function group(adv, key) {
    const value = adv[key];
    if (value === undefined) return null;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`'advanced.${key}' must be an object`);
    const known = Object.keys(SCREEN_ADVANCED_SCHEMA.properties[key].properties);
    const unknown = Object.keys(value).filter((k) => !known.includes(k));
    if (unknown.length) throw new Error(`'advanced.${key}' has no option ${unknown.join(', ')}. Options: ${known.join(', ')}`);
    return value;
}

/**
 * ES3: var __advanced = function (fmt, o) sets the Advanced Settings given on
 * the options object made for one ExportForScreensType.
 */
export function screenAdvanced(advanced) {
    const adv = advanced ?? {};
    if (typeof adv !== 'object' || Array.isArray(adv)) throw new Error("'advanced' must be an object: { png, png8, jpeg, svg, pdf }");
    const unknown = Object.keys(adv).filter((k) => !(k in SCREEN_ADVANCED_SCHEMA.properties));
    if (unknown.length) throw new Error(`'advanced' has no format ${unknown.join(', ')}. Formats: png, png8, jpeg, svg, pdf`);
    const pick = (value, table, name) => table[enumOf(value, Object.keys(table), { name })];
    const blocks = [];
    const add = (test, lines) => { if (lines.length) blocks.push(`  if (${test}) { ${lines.join(' ')} }`); };
    const raster = (g, key) => {
        const lines = [];
        if (g.antiAliasing !== undefined) lines.push(`o.antiAliasing = AntiAliasingMethod.${pick(g.antiAliasing, ANTI_ALIAS, `advanced.${key}.antiAliasing`)};`);
        if (g.transparency !== undefined) lines.push(`o.transparency = ${bool(g.transparency)};`);
        if (g.interlaced !== undefined) lines.push(`o.interlaced = ${bool(g.interlaced)};`);
        return lines;
    };
    const png = group(adv, 'png');
    if (png) {
        const lines = raster(png, 'png');
        if (png.backgroundBlack !== undefined) lines.push(`o.backgroundBlack = ${bool(png.backgroundBlack)};`);
        add('fmt === "SE_PNG24"', lines);
    }
    const png8 = group(adv, 'png8');
    if (png8) {
        const lines = raster(png8, 'png8');
        if (png8.colors !== undefined) lines.push(`o.colorCount = ${num(png8.colors, { min: 2, max: 256, name: 'advanced.png8.colors' })};`);
        add('fmt === "SE_PNG8"', lines);
    }
    const jpeg = group(adv, 'jpeg');
    if (jpeg) {
        const lines = [];
        if (jpeg.antiAliasing !== undefined) lines.push(`o.antiAliasing = AntiAliasingMethod.${pick(jpeg.antiAliasing, ANTI_ALIAS, 'advanced.jpeg.antiAliasing')};`);
        if (jpeg.compression !== undefined) lines.push(`o.compressionMethod = JPEGCompressionMethodType.${pick(jpeg.compression, JPEG_METHODS, 'advanced.jpeg.compression')};`);
        if (jpeg.scans !== undefined) lines.push(`o.progressiveScan = ${num(jpeg.scans, { min: 3, max: 5, name: 'advanced.jpeg.scans' })};`);
        if (jpeg.embedProfile !== undefined) lines.push(`o.embedICCProfile = ${bool(jpeg.embedProfile)};`);
        add('fmt.indexOf("SE_JPEG") === 0', lines);
    }
    const svg = group(adv, 'svg');
    if (svg) {
        const lines = [];
        if (svg.styling !== undefined) lines.push(`o.cssProperties = SVGCSSPropertyLocation.${pick(svg.styling, SVG_STYLING, 'advanced.svg.styling')};`);
        if (svg.fonts !== undefined) lines.push(`o.fontType = SVGFontType.${pick(svg.fonts, SVG_FONTS, 'advanced.svg.fonts')};`);
        if (svg.images !== undefined) lines.push(`o.rasterImageLocation = RasterImageLocation.${pick(svg.images, SVG_IMAGES, 'advanced.svg.images')};`);
        if (svg.objectIds !== undefined) lines.push(`o.svgId = SVGIdType.${pick(svg.objectIds, SVG_IDS, 'advanced.svg.objectIds')};`);
        if (svg.decimals !== undefined) lines.push(`o.coordinatePrecision = ${num(svg.decimals, { min: 1, max: 7, name: 'advanced.svg.decimals' })};`);
        if (svg.minify !== undefined) lines.push(`o.svgMinify = ${bool(svg.minify)};`);
        if (svg.responsive !== undefined) lines.push(`o.svgResponsive = ${bool(svg.responsive)};`);
        add('fmt === "SE_SVG"', lines);
    }
    const pdf = group(adv, 'pdf');
    if (pdf?.preset !== undefined) {
        add('fmt === "SE_PDF"', [
            `var preset = ${str(pdf.preset)}, known = app.PDFPresetsList, found = false;`,
            'for (var p = 0; p < known.length; p++) if (known[p] === preset) found = true;',
            'if (!found) throw new Error("PDF preset not found: " + preset + ". Available: " + known.join(", "));',
            'o.pdfPreset = preset;',
        ]);
    }
    return `var __advanced = function (fmt, o) {\n${blocks.join('\n')}\n};`;
}

/** Scales for export_for_screens: the scale type and validated values, with a file-name tag for each. */
export function screenScales(a) {
    const by = SCALE_TYPES[enumOf(a.scaleBy ?? 'factor', Object.keys(SCALE_TYPES), { name: 'scaleBy' })];
    if (a.scales === undefined && by !== SCALE_TYPES.factor) throw new Error(`Give scales for scaleBy ${a.scaleBy}, e.g. [512, 1024]`);
    const list = a.scales ?? [1];
    if (!Array.isArray(list) || !list.length) throw new Error("'scales' must be a non-empty list of numbers");
    const values = list.map((s) => Number(num(s, { min: by.min, max: by.max, name: 'scales' })));
    return { type: by.type, values, tags: values.map(by.tag) };
}

/**
 * ES3 statements making `item`, the ExportForScreensItemToExport: artboards
 * (default all, unless only assets or the full document are asked for),
 * asset ids, and the full document.
 */
export function screenItem(a, range) {
    const ids = a.assets === undefined ? [] : a.assets;
    if (!Array.isArray(ids)) throw new Error("'assets' must be a list of asset ids (list_assets)");
    const assets = ids.map((id) => Number(index(id, { name: 'assets', max: 1e9 })));
    const artboards = range || (assets.length || a.fullDocument ? '' : 'all');
    return `
var item = new ExportForScreensItemToExport();
item.artboards = ${str(artboards)};
item.document = ${bool(a.fullDocument)};
var assetIds = ${json(assets)};
for (var ai = 0; ai < assetIds.length; ai++) {
  var asset = null;
  try { asset = doc.assets.getByID(assetIds[ai]); } catch (e) { asset = null; }
  if (!asset) throw new Error("Asset " + assetIds[ai] + " not found (list_assets)");
}
if (assetIds.length) item.assets = assetIds;`;
}

/** ES3: an Asset as plain data. */
const ASSET_INFO = `
var __assetInfo = function (s) {
  var file = null;
  try { file = s.getNormalizedName(); } catch (e) { file = null; }
  return { id: s.assetID, name: s.assetName, fileName: file };
};`;

/** ES3: select exactly `items`. */
const SELECT = `
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;`;

/** ES3: object-based slices and sliced layers, as plain data. */
const SLICED = `
var __sliced = function () {
  var out = [], layers = [];
  for (var i = 0; i < doc.pageItems.length && out.length < 500; i++) {
    var it = doc.pageItems[i], on = false;
    try { on = it.sliced; } catch (e) { on = false; }
    if (on) { var info = __itemInfo(doc, it); info.url = it.URL; out.push(info); }
  }
  for (var j = 0; j < doc.layers.length; j++) if (doc.layers[j].sliced) layers.push(doc.layers[j].name);
  return { items: out, layers: layers };
};`;

/** Object > Slice and View commands that open no dialog. */
const SLICE_COMMANDS = {
    make: 'AISlice Make Slice',
    release: 'AISlice Release Slice',
    create_from_selection: 'AISlice Create from Selection',
    create_from_guides: 'AISlice Create from Guides',
    duplicate: 'AISlice Duplicate',
    combine: 'AISlice Combine',
    clip_to_artboard: 'AISlice Clip to Artboard',
    delete_all: 'AISlice Delete All Slices',
    toggle_visibility: 'AISlice Feedback Menu',
    toggle_lock: 'AISlice Lock Menu',
};
const NEEDS_SELECTION = ['make', 'release', 'create_from_selection', 'duplicate', 'combine'];
const SLICE_ACTIONS = [...Object.keys(SLICE_COMMANDS), 'create_region'];

export const tools = [
    {
        name: 'list_assets',
        description: 'List the assets collected for export in the document (Window > Asset Export): id, name and the file name they export as. Pass the ids to export_for_screens to export them',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.asset_export.asset_export_panel'],
        hints: { readOnly: true },
        handler: () => run('List assets', script(`${ASSET_INFO}
var out = [];
for (var i = 0; i < doc.assets.length; i++) out.push(__assetInfo(doc.assets[i]));
__result__ = { count: out.length, assets: out };`)),
    },
    {
        name: 'collect_assets',
        description: 'Add artwork to the Asset Export panel (Collect for Export > As Single Asset, or As Multiple Assets). Returns the new asset ids for export_for_screens',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                as: { type: 'string', enum: ['single', 'multiple'], description: 'single: one asset from all the targets; multiple: one asset per target. Default single', default: 'single' },
                names: { type: 'array', items: { type: 'string' }, description: 'Asset names: one for single, one per target (in target order) for multiple. Default Illustrator\'s names' },
            },
            required: ['target'],
        },
        features: [
            'illustrator.asset_export.collect_single',
            'illustrator.asset_export.collect_multiple',
            'illustrator.asset_export.asset_export_panel',
        ],
        auditArgs: { target: { selection: true }, as: 'multiple', names: ['Icon', 'Logo'] },
        handler: (a) => {
            const single = enumOf(a.as ?? 'single', ['single', 'multiple'], { name: 'as' }) === 'single';
            const names = a.names ?? [];
            if (!Array.isArray(names)) throw new Error("'names' must be a list of strings");
            if (single && names.length > 1) throw new Error("A single asset takes one name: give names: [\"name\"]");
            for (const n of names) if (!String(n).trim() || String(n).length > 200) throw new Error(`Invalid asset name: ${JSON.stringify(n)}`);
            return run('Collect assets', script(`${ASSET_INFO}
var items = __targets(doc, ${targetSpec(a.target)}), names = ${json(names.map(String))}, made = [];
if (${bool(single)}) {
  var one = doc.assets.add(items.length === 1 ? items[0] : items);
  if (names.length) one.assetName = names[0];
  made.push(__assetInfo(one));
} else {
  if (names.length && names.length !== items.length) throw new Error("Give one name per item: " + items.length + " items, " + names.length + " names");
  for (var i = 0; i < items.length; i++) {
    var each = doc.assets.add(items[i]);
    if (names.length) each.assetName = names[i];
    made.push(__assetInfo(each));
  }
}
__result__ = { added: made.length, assets: made, total: doc.assets.length };`));
        },
    },
    {
        name: 'rename_asset',
        description: 'Rename an asset in the Asset Export panel. The name is the exported file name',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'integer', minimum: 0, description: 'Asset id (list_assets)' },
                name: { type: 'string', description: 'New name' },
            },
            required: ['id', 'name'],
        },
        features: ['illustrator.asset_export.asset_export_panel'],
        hints: { idempotent: true },
        auditArgs: { id: 3, name: 'Hero' },
        handler: (a) => {
            const name = String(a.name ?? '');
            if (!name.trim() || name.length > 200) throw new Error("Give 'name': 1 to 200 characters");
            const id = index(a.id, { name: 'id', max: 1e9 });
            return run('Rename asset', script(`${ASSET_INFO}
var s = null;
try { s = doc.assets.getByID(${id}); } catch (e) { s = null; }
if (!s) throw new Error("Asset ${id} not found (list_assets)");
s.assetName = ${str(name)};
__result__ = __assetInfo(s);`));
        },
    },
    {
        name: 'remove_assets',
        description: 'Remove assets from the Asset Export panel. The artwork stays in the document',
        inputSchema: {
            type: 'object',
            properties: {
                ids: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Asset ids (list_assets)' },
                all: { type: 'boolean', description: 'Remove every asset' },
            },
        },
        features: ['illustrator.asset_export.asset_export_panel'],
        hints: { destructive: true, idempotent: true },
        auditArgs: { ids: [3, 4], all: undefined },
        handler: (a) => {
            const ids = a.ids ?? [];
            if (!Array.isArray(ids)) throw new Error("'ids' must be a list of asset ids");
            if (!a.all && !ids.length) throw new Error("Give ids (from list_assets) or all: true");
            if (a.all && ids.length) throw new Error("Give ids or all: true, not both");
            const list = ids.map((id) => Number(index(id, { name: 'ids', max: 1e9 })));
            return run('Remove assets', script(a.all ? `
var n = doc.assets.length;
if (n) doc.assets.removeAll();
__result__ = { removed: n, total: doc.assets.length };` : `
var ids = ${json(list)}, found = [];
for (var i = 0; i < ids.length; i++) {
  var s = null;
  try { s = doc.assets.getByID(ids[i]); } catch (e) { s = null; }
  if (!s) throw new Error("Asset " + ids[i] + " not found (list_assets)");
  found.push(s);
}
for (var j = 0; j < found.length; j++) found[j].remove();
__result__ = { removed: found.length, total: doc.assets.length };`));
        },
    },
    {
        name: 'export_selection',
        description: 'Export the selected artwork on its own (File > Export Selection), as a PNG at 100% or as an Illustrator file. For other formats and scales, collect_assets and export_for_screens with the asset ids',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute path ending in .png or .ai' },
                target: { ...TARGET_SCHEMA, description: 'Select these items first. Default the current selection' },
            },
            required: ['outputFile'],
        },
        features: ['illustrator.asset_export.export_selection'],
        hints: { idempotent: true },
        auditArgs: { outputFile: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit.png'), target: { ids: ['a'] } },
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const ext = path.extname(out).toLowerCase();
            if (ext !== '.png' && ext !== '.ai') throw new Error('outputFile must end in .png or .ai');
            return run('Export selection', script(`
${a.target ? `var items = __targets(doc, ${targetSpec(a.target)});${SELECT}` : ''}
if (!doc.selection || !doc.selection.length) throw new Error("Nothing is selected: select artwork or pass target");
var f = new File(${jsxPath(out)});
if (!f.parent.exists && !f.parent.create()) throw new Error("Cannot create " + f.parent.fsName);
${ext === '.png' ? 'doc.exportSelectionAsPNG(f);' : 'doc.exportSelectionAsAi(f);'}
__result__ = { file: f.fsName, written: f.exists, items: doc.selection.length };`));
        },
    },
    {
        name: 'list_slices',
        description: 'List object-based slices (items made into slices with Object > Slice > Make) and sliced layers, with each slice\'s URL. User slices drawn with the Slice Tool are not listed',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.asset_export.slice_object'],
        hints: { readOnly: true },
        handler: () => run('List slices', script(`${SLICED}
__result__ = __sliced();`)),
    },
    {
        name: 'edit_slices',
        description: 'Run an Object > Slice command: make (object-based slices from the targets), release, create_from_selection, create_from_guides, duplicate, combine, clip_to_artboard (toggle), delete_all; or View > Show / Hide Slices (toggle_visibility) and Lock Slices (toggle_lock). create_region makes a slice over a rectangle, as dragging the Slice Tool does',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: SLICE_ACTIONS },
                target: { ...TARGET_SCHEMA, description: 'Select these items first. make, release, create_from_selection, duplicate and combine act on the selection' },
                x: { type: 'number', description: 'create_region: left edge, points from the artboard\'s left' },
                y: { type: 'number', description: 'create_region: top edge, points from the artboard\'s top' },
                width: { type: 'number', minimum: 1, description: 'create_region: points' },
                height: { type: 'number', minimum: 1, description: 'create_region: points' },
                artboardIndex: ARTBOARD_SCHEMA,
            },
            required: ['action'],
        },
        features: [
            'illustrator.asset_export.slice_object',
            'illustrator.asset_export.slice_tool',
            'illustrator.asset_export.slice_make',
            'illustrator.asset_export.slice_release',
            'illustrator.asset_export.slice_from_guides',
            'illustrator.asset_export.slice_from_selection',
            'illustrator.asset_export.slice_duplicate',
            'illustrator.asset_export.slice_combine',
            'illustrator.asset_export.slice_delete_all',
            'illustrator.asset_export.slice_clip_to_artboard',
            'illustrator.asset_export.show_hide_slices',
            'illustrator.asset_export.lock_slices',
        ],
        hints: { destructive: true },
        auditArgs: { action: 'create_region', target: undefined, x: 10, y: 20, width: 100, height: 50, artboardIndex: 0 },
        handler: (a) => {
            const action = enumOf(a.action, SLICE_ACTIONS, { name: 'action' });
            const select = a.target ? `var items = __targets(doc, ${targetSpec(a.target)});${SELECT}` : '';
            let body;
            if (action === 'create_region') {
                for (const k of ['x', 'y', 'width', 'height']) if (a[k] === undefined) throw new Error(`create_region needs x, y, width and height (points); '${k}' is missing`);
                body = `
var ab = __artboard(doc, ${index(a.artboardIndex ?? 0, { name: 'artboardIndex' })});
var tl = __toDoc(doc, ab, ${num(a.x, { name: 'x' })}, ${num(a.y, { name: 'y' })});
var box = doc.activeLayer.pathItems.rectangle(tl[1], tl[0], __len(doc, ${num(a.width, { min: 1, name: 'width' })}), __len(doc, ${num(a.height, { min: 1, name: 'height' })}));
box.filled = false; box.stroked = false;
doc.selection = null; box.selected = true;
app.executeMenuCommand("AISlice Create from Selection");
box.remove();`;
            } else {
                const check = NEEDS_SELECTION.includes(action)
                    ? `if (!doc.selection || !doc.selection.length) throw new Error("${action} acts on the selection: select slices or artwork, or pass target");`
                    : '';
                body = `${select}\n${check}\napp.executeMenuCommand(${str(SLICE_COMMANDS[action])});`;
            }
            return run('Slices', script(`${SLICED}
${body}
var s = __sliced();
__result__ = { action: ${str(action)}, selection: doc.selection ? doc.selection.length : 0, objectSlices: s.items.length, slicedLayers: s.layers };`));
        },
    },
    {
        name: 'set_item_url',
        description: 'Set the URL of items (Attributes panel URL, used for image maps, and the URL of object-based slices). An empty url clears it',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                url: { type: 'string', description: 'e.g. "https://example.com/page". Empty to clear' },
            },
            required: ['target', 'url'],
        },
        features: ['illustrator.asset_export.image_map', 'illustrator.asset_export.slice_option.url'],
        hints: { idempotent: true },
        auditArgs: { target: { names: ['Button'] }, url: 'https://example.com/' },
        handler: (a) => {
            const url = String(a.url ?? '');
            if (url.length > 2048) throw new Error("'url' is longer than 2048 characters");
            if (/[\u0000-\u001f]/.test(url)) throw new Error("'url' contains control characters");
            return run('Set URL', script(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) { items[i].URL = ${str(url)}; out.push({ id: __itemInfo(doc, items[i]).id, url: items[i].URL }); }
__result__ = { updated: out.length, items: out };`));
        },
    },
];
