/**
 * Images and links: the Links panel (listing links with their paths and XMP
 * metadata, relinking, updating, embedding, unembedding, opening and
 * revealing sources, InCopy check-in and check-out, and the panel's own
 * commands), placing images, PDF, InDesign pages, EPS and SVG with their
 * import options, image import and object layer options on placed graphics,
 * cropping and moving frame content, contact sheets and the loaded
 * place cursor.
 *
 * Positions, offsets and crops are millimetres; scales are percentages.
 */
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { validateFilePath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';

const F = 'indesign.images_links.';
const ids = (...names) => names.map((n) => F + n);

/** Link statuses as callers name them, and their LinkStatus members. */
export const LINK_STATUS = {
    normal: 'NORMAL',
    out_of_date: 'LINK_OUT_OF_DATE',
    missing: 'LINK_MISSING',
    embedded: 'LINK_EMBEDDED',
    inaccessible: 'LINK_INACCESSIBLE',
};

/** Links panel menu commands run as menu actions (none opens a dialog). */
export const PANEL_COMMANDS = {
    search_for_missing_links: 132634,
    copy_all_link_information: 132618,
    copy_info_for_selected_links: 132619,
    show_link_information_pane: 132617,
    auto_size_link_information: 132616,
    hide_thumbnail: 132636,
};

/** Caption commands: Object > Captions (acts on the page selection), then the Links panel menu equivalent. */
export const CAPTION_COMMANDS = {
    live: [132644, 132643],
    static: [132651, 132652],
};

const FIT_OPTIONS = ['PROPORTIONALLY', 'FILL_PROPORTIONALLY', 'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'CENTER_CONTENT', 'APPLY_FRAME_FITTING_OPTIONS'];
const PDF_CROPS = ['CROP_PDF', 'CROP_ART', 'CROP_TRIM', 'CROP_BLEED', 'CROP_MEDIA', 'CROP_CONTENT_ALL_LAYERS', 'CROP_CONTENT_VISIBLE_LAYERS'];
const PAGE_CROPS = ['CROP_CONTENT', 'CROP_BLEED', 'CROP_SLUG'];
const INTENTS = ['USE_COLOR_SETTINGS', 'PERCEPTUAL', 'SATURATION', 'RELATIVE_COLORIMETRIC', 'ABSOLUTE_COLORIMETRIC'];
const PROFILES = ['USE_DOCUMENT', 'WORKING', 'NO_CMS', 'POSTSCRIPT_CMS'];
const UPDATE_LINK = ['KEEP_OVERRIDES', 'APPLICATION_SETTINGS'];
const DISPLAY = ['DEFAULT_VALUE', 'HIGH_QUALITY', 'TYPICAL', 'OPTIMIZED'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'psd', 'gif', 'bmp', 'pdf', 'ai', 'eps', 'svg', 'indd', 'heic', 'webp'];

/** Script helpers for links and graphics, ahead of each body. */
const HELPERS = String.raw`
function __addLink(out, seen, l) {
  if (!l || !l.isValid) return;
  if (seen["k" + l.id]) return;
  seen["k" + l.id] = true;
  out.push(l);
}

function __itemLinks(it, out, seen) {
  if (it.constructor.name === "TextFrame") { try { __addLink(out, seen, it.parentStory.itemLink); } catch (e) {} return; }
  try { __addLink(out, seen, it.itemLink); } catch (e) {}
  try { var gs = it.allGraphics; for (var i = 0; i < gs.length; i++) { try { __addLink(out, seen, gs[i].itemLink); } catch (e) {} } } catch (e) {}
}

function __links(doc, ids, names, itemIds, statuses, useSel, every) {
  var out = [], seen = {}, i, j, all = doc.links;
  if (every || (statuses.length && !ids.length && !names.length && !itemIds.length && !useSel)) for (i = 0; i < all.length; i++) __addLink(out, seen, all[i]);
  for (i = 0; i < ids.length; i++) {
    var l = all.itemByID(ids[i]);
    if (!l.isValid) throw new Error("Link " + ids[i] + " not found");
    __addLink(out, seen, l);
  }
  for (i = 0; i < names.length; i++) {
    var hit = false;
    for (j = 0; j < all.length; j++) if (all[j].name === names[i]) { __addLink(out, seen, all[j]); hit = true; }
    if (!hit) throw new Error("No link named " + names[i]);
  }
  for (i = 0; i < itemIds.length; i++) __itemLinks(__item(doc, itemIds[i]), out, seen);
  if (useSel) for (i = 0; i < app.selection.length; i++) __itemLinks(app.selection[i], out, seen);
  if (statuses.length) {
    var kept = [];
    for (i = 0; i < out.length; i++) for (j = 0; j < statuses.length; j++) if (out[i].status == statuses[j]) { kept.push(out[i]); break; }
    out = kept;
  }
  return out;
}

function __linkInfo(l, withXmp, xmpProps) {
  var r = { id: l.id, name: l.name, status: __enumName(l.status), filePath: null, platformPath: null, uri: null, isUrl: false };
  try { r.filePath = String(l.filePath); } catch (e) {}
  try { r.platformPath = File(l.filePath).fsName; } catch (e) {}
  try { r.uri = l.linkResourceURI; r.isUrl = /^https?:/i.test(r.uri); } catch (e) {}
  try { r.linkType = l.linkType; r.size = l.size; } catch (e) {}
  try { r.modified = l.date ? l.date.toUTCString() : null; } catch (e) {}
  try { r.needed = l.needed; r.edited = l.edited; } catch (e) {}
  try { r.editingState = __enumName(l.editingState); } catch (e) {}
  var p = l.parent;
  r.content = p.constructor.name;
  if (r.content === "Story") {
    r.storyId = p.id;
    try { r.lockState = __enumName(p.lockState); } catch (e) {}
    try { r.item = __itemInfo(p.textContainers[0]); } catch (e) {}
  } else {
    try { r.item = __itemInfo(p.parent); } catch (e) {}
    try { r.actualPpi = p.actualPpi; r.effectivePpi = p.effectivePpi; } catch (e) {}
  }
  if (withXmp) {
    try {
      var x = l.linkXmp;
      r.xmp = {
        documentTitle: x.documentTitle, author: x.author, creator: x.creator, description: x.description,
        keywords: x.keywords, copyrightNotice: x.copyrightNotice, copyrightStatus: __enumName(x.copyrightStatus),
        copyrightInfoURL: x.copyrightInfoURL, format: x.format, jobName: x.jobName,
        creationDate: x.creationDate ? String(x.creationDate) : null,
        modificationDate: x.modificationDate ? String(x.modificationDate) : null
      };
      if (xmpProps.length) {
        var props = [];
        for (var k = 0; k < xmpProps.length; k++) {
          var v = null;
          try { v = x.getProperty(xmpProps[k][0], xmpProps[k][1]); } catch (e) {}
          props.push({ namespace: xmpProps[k][0], path: xmpProps[k][1], value: v });
        }
        r.xmp.properties = props;
      }
    } catch (e) { r.xmp = null; }
  }
  return r;
}

function __graphics(it) {
  var c = it.constructor.name;
  if (c === "Image" || c === "PDF" || c === "EPS" || c === "SVG" || c === "ImportedPage" || c === "WMF" || c === "PICT") return [it];
  var out = [];
  try { var gs = it.allGraphics; for (var i = 0; i < gs.length; i++) out.push(gs[i]); } catch (e) {}
  return out;
}

function __gLayer(coll, path) {
  var parts = path.split("/"), hit = null;
  for (var i = 0; i < parts.length; i++) {
    hit = coll.itemByName(parts[i]);
    if (!hit.isValid) return null;
    coll = hit.graphicLayers;
  }
  return hit;
}

function __layerTree(coll, depth) {
  var out = [];
  for (var i = 0; i < coll.length; i++) {
    var gl = coll[i], n = { name: gl.name, visible: gl.currentVisibility, originalVisibility: gl.originalVisibility };
    if (depth < 8 && gl.graphicLayers.length) n.layers = __layerTree(gl.graphicLayers, depth + 1);
    out.push(n);
  }
  return out;
}

function __menu(ids, label) {
  for (var i = 0; i < ids.length; i++) {
    var ma = app.menuActions.itemByID(ids[i]);
    if (ma.isValid && ma.enabled) { ma.invoke(); return ids[i]; }
  }
  throw new Error(label + " is not available now (open the Links panel or select linked graphics first)");
}

function __find(dir, name, deep) {
  var f = File(dir.fsName + "/" + name);
  if (f.exists) return f;
  if (!deep) return null;
  var subs = dir.getFiles();
  for (var k = 0; k < subs.length; k++) {
    if (subs[k] instanceof Folder) { var hit = __find(subs[k], name, true); if (hit) return hit; }
  }
  return null;
}

function __withExt(name, ext) {
  var dot = name.lastIndexOf(".");
  return (dot > 0 ? name.substring(0, dot) : name) + "." + ext;
}
`;

/** A script with the image and link helpers ahead of the body. */
const imgScript = (body, opts) => script(HELPERS + body, opts);

/** A caller's path as a JSX string literal, through the server's path policy. */
function pathLit(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required: a path`);
    return jsxPath(validateFilePath(value));
}

/** Refuse keys an option object does not have. */
function known(obj, allowed, name) {
    if (obj === undefined) return;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`'${name}' must be an object`);
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`Unknown option '${name}.${k}'. Allowed: ${allowed.join(', ')}`);
}

function flag(value, name) {
    if (typeof value !== 'boolean') throw new Error(`'${name}' must be true or false`);
    return bool(value);
}

function text(value, name, max = 500) {
    if (typeof value !== 'string' || value.length > max) throw new Error(`'${name}' must be a string of at most ${max} characters`);
    return str(value);
}

function extension(value, name = 'extension') {
    const v = String(value ?? '').replace(/^\./, '');
    if (!/^[A-Za-z0-9]{1,10}$/.test(v)) throw new Error(`'${name}' must be a file extension such as "tif" or ".psd"`);
    return v;
}

const LINKS_SCHEMA = {
    type: 'object',
    description: 'Which links to act on (rows of the Links panel): link ids or names from list_document_links, the page items whose placed content is linked, the links of the selected items, or every link; status narrows the choice',
    properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Link ids, from list_document_links' },
        names: { type: 'array', items: { type: 'string' }, description: 'Link names as the Links panel shows them (every link with each name)' },
        itemIds: { type: 'array', items: { type: 'integer' }, description: 'Page item ids: the links of the graphics or text placed in these frames' },
        selection: { type: 'boolean', description: 'The links of the selected items' },
        all: { type: 'boolean', description: 'Every link in the document' },
        status: { type: 'array', items: { type: 'string', enum: Object.keys(LINK_STATUS) }, description: 'Keep only links with these statuses; given alone it chooses among every link' },
    },
};

/** The arguments of __links() for a links spec. */
function linkArgs(spec, { optional = false } = {}) {
    const s = spec ?? {};
    known(s, Object.keys(LINKS_SCHEMA.properties), 'links');
    const list = (v, name, f) => {
        if (v === undefined) return [];
        if (!Array.isArray(v) || v.length > 1000) throw new Error(`'links.${name}' must be a list`);
        return v.map(f);
    };
    const lids = list(s.ids, 'ids', (v) => index(v, { name: 'links.ids', max: 1e9 }));
    const names = list(s.names, 'names', (v) => text(v, 'links.names', 300));
    const items = list(s.itemIds, 'itemIds', (v) => index(v, { name: 'links.itemIds', max: 1e9 }));
    const statuses = list(s.status, 'status', (v) => `LinkStatus.${LINK_STATUS[enumOf(v, Object.keys(LINK_STATUS), { name: 'links.status' })]}`);
    const every = s.all === true || (optional && !lids.length && !names.length && !items.length && !s.selection);
    if (!every && !lids.length && !names.length && !items.length && !s.selection && !statuses.length) {
        throw new Error('Choose the links: links.ids, links.names, links.itemIds, links.selection, links.all or links.status');
    }
    return `[${lids.join(', ')}], [${names.join(', ')}], [${items.join(', ')}], [${statuses.join(', ')}], ${bool(s.selection)}, ${bool(every)}`;
}

/** Statements writing the image import options to the graphic `g` (frame `fr`); notes go to `notes`. */
function graphicOptionLines(o, name) {
    const lines = [];
    if (o.applyClippingPath !== undefined) {
        lines.push(`if (gc === "Image") g.imageIOPreferences.applyPhotoshopClippingPath = ${flag(o.applyClippingPath, `${name}.applyClippingPath`)}; else notes.push("applyClippingPath applies to images");`);
    }
    if (o.alphaChannel !== undefined) {
        lines.push(`if (gc === "Image") g.imageIOPreferences.alphaChannelName = ${text(o.alphaChannel, `${name}.alphaChannel`, 200)}; else notes.push("alphaChannel applies to images");`);
    }
    if (o.profile !== undefined) {
        const p = text(o.profile, `${name}.profile`, 300);
        const lit = PROFILES.includes(o.profile) ? `Profile.${o.profile}` : p;
        lines.push(`if (gc === "Image") g.profile = ${lit}; else notes.push("profile applies to images");`);
    }
    if (o.renderingIntent !== undefined) {
        lines.push(`if (gc === "Image") g.imageRenderingIntent = RenderingIntent.${enumOf(o.renderingIntent, INTENTS, { name: `${name}.renderingIntent` })}; else notes.push("renderingIntent applies to images");`);
    }
    const layered = 'gc === "Image" || gc === "PDF" || gc === "ImportedPage"';
    if (o.whenUpdatingLink !== undefined) {
        lines.push(`if (${layered}) g.graphicLayerOptions.updateLinkOption = UpdateLinkOptions.${enumOf(o.whenUpdatingLink, UPDATE_LINK, { name: `${name}.whenUpdatingLink` })}; else notes.push("whenUpdatingLink applies to layered images, PDF and InDesign pages");`);
    }
    if (o.layers !== undefined) {
        if (!Array.isArray(o.layers) || !o.layers.length || o.layers.length > 500) throw new Error(`'${name}.layers' must be a non-empty list of { name, visible }`);
        const sets = o.layers.map((l, i) => {
            known(l, ['name', 'visible'], `${name}.layers[${i}]`);
            return `[${text(l?.name, `${name}.layers[${i}].name`, 500)}, ${flag(l?.visible, `${name}.layers[${i}].visible`)}]`;
        });
        // Changing a layer's visibility replaces the graphic, so it is fetched again from the frame each time.
        lines.push(`if (${layered}) {
  var lsets = [${sets.join(', ')}];
  for (var li = 0; li < lsets.length; li++) {
    var cur = fr.allGraphics[0], gl = __gLayer(cur.graphicLayerOptions.graphicLayers, lsets[li][0]);
    if (!gl) { notes.push("No layer " + lsets[li][0]); continue; }
    gl.currentVisibility = lsets[li][1];
  }
  g = fr.allGraphics[0];
} else notes.push("layers apply to layered images, PDF and InDesign pages");`);
    }
    return lines;
}

const GRAPHIC_OPTION_KEYS = ['applyClippingPath', 'alphaChannel', 'profile', 'renderingIntent', 'layers', 'whenUpdatingLink'];

const IMAGE_OPTIONS_SCHEMA = {
    applyClippingPath: { type: 'boolean', description: 'Apply Photoshop Clipping Path saved in the image' },
    alphaChannel: { type: 'string', description: 'Alpha Channel to mask the image with, by name' },
    profile: { type: 'string', description: 'Colour profile (Enable Color Management / Profile): USE_DOCUMENT (Use Document Default), WORKING, NO_CMS, POSTSCRIPT_CMS, or a profile name from the image\'s profileList (get_placed_graphic_options)' },
    renderingIntent: { type: 'string', enum: INTENTS, description: 'Rendering Intent' },
    layers: {
        type: 'array', description: 'Show Layers: layer visibility by name; a nested layer as "Group/Layer"',
        items: { type: 'object', properties: { name: { type: 'string', description: 'Layer name or "Group/Layer" path' }, visible: { type: 'boolean', description: 'Show the layer' } }, required: ['name', 'visible'] },
    },
    whenUpdatingLink: { type: 'string', enum: UPDATE_LINK, description: 'When Updating Link: keep these layer visibility overrides, or use the file\'s own visibility' },
};

/** Profile and rendering intent of placed images are set_image_color_settings' (Object > Image Color Settings). */
const SET_OPTIONS_SCHEMA = Object.fromEntries(Object.entries(IMAGE_OPTIONS_SCHEMA).filter(([k]) => k !== 'profile' && k !== 'renderingIntent'));

/** Place options groups: the preference object, and per field its property and kind. */
const PLACE_GROUPS = {
    pdf: {
        target: 'app.pdfPlacePreferences', label: 'Place PDF / Illustrator options',
        fields: {
            page: { prop: 'pageNumber', kind: 'int', min: 1, max: 100000, description: 'Page to place (1-based)' },
            crop: { prop: 'pdfCrop', kind: 'enum', type: 'PDFCrop', values: PDF_CROPS, description: 'Crop to: bounding box (CROP_CONTENT_*), art, crop (CROP_PDF), trim, bleed or media' },
            transparentBackground: { prop: 'transparentBackground', kind: 'bool', description: 'Transparent Background' },
            password: { prop: 'openDocumentPassword', kind: 'secret', description: 'Password to open a protected PDF (put back after placing; never returned)' },
        },
    },
    indesignPage: {
        target: 'app.importedPageAttributes', label: 'Place InDesign document options',
        fields: {
            page: { prop: 'pageNumber', kind: 'int', min: 1, max: 100000, description: 'Page to place (1-based)' },
            crop: { prop: 'importedPageCrop', kind: 'enum', type: 'ImportedPageCropOptions', values: PAGE_CROPS, description: 'Crop to: page bounding box, bleed or slug' },
        },
    },
    eps: {
        target: 'app.epsImportPreferences', label: 'EPS Import Options',
        fields: {
            readOpiLinks: { prop: 'opiComments', kind: 'bool', description: 'Read Embedded OPI Image Links' },
            proxy: { prop: 'epsProxy', kind: 'enum', type: 'CreateProxy', values: ['AS_NEEDED', 'ALWAYS'], description: 'Proxy Generation: AS_NEEDED uses the TIFF or PICT preview, ALWAYS rasterizes the PostScript' },
            createFrames: { prop: 'epsFrames', kind: 'bool', description: 'Create Frames from EPS bounding box' },
        },
    },
};

/** Statements setting one place group, remembering the previous values. */
function placeGroupLines(key, values) {
    const g = PLACE_GROUPS[key];
    known(values, Object.keys(g.fields), key);
    const out = [];
    for (const [k, v] of Object.entries(values)) {
        const f = g.fields[k];
        const name = `${key}.${k}`;
        let lit;
        if (f.kind === 'int') { lit = index(v, { name, max: f.max }); if (Number(lit) < f.min) throw new Error(`'${name}' must be at least ${f.min}`); }
        else if (f.kind === 'bool') lit = flag(v, name);
        else if (f.kind === 'enum') lit = `${f.type}.${enumOf(v, f.values, { name })}`;
        else lit = text(v, name, 200);
        out.push(`__keep(${g.target}, "${f.prop}", ${g.target}.${f.prop}); ${g.target}.${f.prop} = ${lit};`);
    }
    return out;
}

const groupSchema = (key) => {
    const g = PLACE_GROUPS[key];
    const properties = {};
    for (const [k, f] of Object.entries(g.fields)) {
        if (f.kind === 'int') properties[k] = { type: 'integer', minimum: f.min, description: f.description };
        else if (f.kind === 'bool') properties[k] = { type: 'boolean', description: f.description };
        else if (f.kind === 'enum') properties[k] = { type: 'string', enum: f.values, description: f.description };
        else properties[k] = { type: 'string', description: f.description };
    }
    return { type: 'object', description: g.label, properties };
};

export const tools = [
    {
        name: 'list_document_links',
        description: 'List the document\'s links as the Links panel shows them: name, status, full and platform-style path, URL links, size, date, the item that holds each link, image resolution, InCopy lock state, and optionally the linked file\'s XMP metadata (Links panel; Link Info; Utilities > XMP File Info; Copy Full Path / Copy Platform Style Path)',
        inputSchema: {
            type: 'object',
            properties: {
                links: { ...LINKS_SCHEMA, description: `${LINKS_SCHEMA.description}. Default: every link` },
                includeXmp: { type: 'boolean', default: false, description: 'Include each linked file\'s XMP metadata (title, author, description, keywords, copyright, dates)' },
                xmpProperties: {
                    type: 'array', maxItems: 50, description: 'Further XMP properties to read, as { namespace, path } (for example namespace "http://ns.adobe.com/photoshop/1.0/", path "City")',
                    items: { type: 'object', properties: { namespace: { type: 'string', description: 'XMP namespace URI' }, path: { type: 'string', description: 'Property path within the namespace' } }, required: ['namespace', 'path'] },
                },
                limit: { type: 'integer', minimum: 1, maximum: 5000, default: 500, description: 'Most links to return' },
            },
        },
        features: ids('link', 'link_metadata', 'links_menu_utilities_xmp_file_info', 'links_menu_copy_full_path', 'links_menu_copy_platform_style_path', 'http_links'),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => {
            const props = (a.xmpProperties ?? []).map((p, i) => {
                known(p, ['namespace', 'path'], `xmpProperties[${i}]`);
                return `[${text(p?.namespace, `xmpProperties[${i}].namespace`)}, ${text(p?.path, `xmpProperties[${i}].path`)}]`;
            });
            if (props.length > 50) throw new Error("'xmpProperties' takes at most 50 entries");
            const withXmp = a.includeXmp === true || props.length > 0;
            const limit = index(a.limit ?? 500, { name: 'limit', max: 5000 });
            return run('List links', imgScript(`
var links = __links(doc, ${linkArgs(a.links, { optional: true })}), out = [], counts = {};
for (var i = 0; i < links.length; i++) {
  var s = __enumName(links[i].status);
  counts[s] = (counts[s] || 0) + 1;
  if (out.length < ${limit}) out.push(__linkInfo(links[i], ${bool(withXmp)}, [${props.join(', ')}]));
}
__result__ = { total: links.length, byStatus: counts, links: out };`));
        },
    },
    {
        name: 'relink_document_links',
        description: 'Point links at other files: relink one link to a file or a web URL, relink links to files of the same name in a folder (optionally searching subfolders or with another extension), relink to the same names with another extension, or copy the linked files to a folder and relink to the copies (Links panel menu > Relink, Relink to Folder, Relink File Extension, Copy Link(s) To)',
        inputSchema: {
            type: 'object',
            properties: {
                links: LINKS_SCHEMA,
                mode: { type: 'string', enum: ['file', 'url', 'folder', 'extension', 'copy_to_folder'], description: 'file: one link to filePath; url: one link to a web URL; folder: same names in folder; extension: same names with another extension beside the original; copy_to_folder: copy files into folder and relink' },
                filePath: { type: 'string', description: 'The new file (mode file)' },
                url: { type: 'string', description: 'An http or https URL (mode url)' },
                folder: { type: 'string', description: 'The folder (modes folder and copy_to_folder; created for copy_to_folder if missing)' },
                extension: { type: 'string', description: 'The extension to relink to, such as "psd" (mode extension; in mode folder, match the same name with this extension)' },
                searchSubfolders: { type: 'boolean', default: false, description: 'Also look in subfolders of folder (mode folder)' },
            },
            required: ['links', 'mode'],
        },
        features: ids('links_menu_relink', 'links_menu_relink_to_folder', 'links_menu_relink_file_extension', 'links_menu_copy_link_s_to', 'http_links'),
        hints: { readOnly: false },
        auditArgs: { links: { ids: [3] }, mode: 'folder', filePath: undefined, url: undefined, extension: 'psd' },
        handler: (a) => {
            const mode = enumOf(a.mode, ['file', 'url', 'folder', 'extension', 'copy_to_folder'], { name: 'mode' });
            const largs = linkArgs(a.links);
            const extra = { file: ['filePath'], url: ['url'], folder: ['folder', 'extension', 'searchSubfolders'], extension: ['extension'], copy_to_folder: ['folder'] }[mode];
            for (const k of ['filePath', 'url', 'folder', 'extension', 'searchSubfolders']) {
                if (a[k] !== undefined && !extra.includes(k)) throw new Error(`'${k}' does not apply to mode ${mode}`);
            }
            let prep = '', pick;
            if (mode === 'file') {
                prep = `var target = File(${pathLit(a.filePath, 'filePath')});
if (!target.exists) throw new Error("File not found: " + target.fsName);
if (links.length !== 1) throw new Error("Relink to a file takes exactly one link; " + links.length + " chosen");`;
                pick = 'to = target;';
            } else if (mode === 'url') {
                const u = String(a.url ?? '');
                if (!/^https?:\/\/[^\s"'<>]{1,2000}$/i.test(u)) throw new Error("'url' must be an http or https URL");
                prep = 'if (links.length !== 1) throw new Error("Relink to a URL takes exactly one link; " + links.length + " chosen");';
                pick = `l.reinitLink(${str(u)});
  out.push({ id: lid, name: lname, from: from, to: ${str(u)} });
  continue;`;
            } else if (mode === 'folder') {
                const ext = a.extension === undefined ? null : extension(a.extension);
                prep = `var dir = Folder(${pathLit(a.folder, 'folder')});
if (!dir.exists) throw new Error("Folder not found: " + dir.fsName);`;
                pick = `to = __find(dir, ${ext ? `__withExt(lname, ${str(ext)})` : 'lname'}, ${bool(a.searchSubfolders)});`;
            } else if (mode === 'extension') {
                const ext = extension(a.extension);
                pick = `try { var orig = File(l.filePath); to = File(orig.parent.fsName + "/" + __withExt(orig.name, ${str(ext)})); } catch (e) {}`;
            } else {
                prep = `var dir = Folder(${pathLit(a.folder, 'folder')});
if (!dir.exists && !dir.create()) throw new Error("Could not create " + dir.fsName);`;
                pick = `if (l.status == LinkStatus.LINK_MISSING || l.status == LinkStatus.LINK_EMBEDDED) { skipped.push({ id: lid, name: lname, reason: __enumName(l.status) }); continue; }
  var dest = File(dir.fsName + "/" + File(l.filePath).name);
  if (!dest.exists) l.copyLink(dest, "", false);
  to = dest;`;
            }
            return run('Relink links', imgScript(`
var links = __links(doc, ${largs}), out = [], skipped = [];
if (!links.length) throw new Error("No links matched");
${prep}
for (var i = 0; i < links.length; i++) {
  var l = links[i], lid = l.id, lname = l.name, from = null, to = null;
  try { from = File(l.filePath).fsName; } catch (e) {}
  ${pick}
  if (!to || !to.exists) { skipped.push({ id: lid, name: lname, reason: "no matching file" }); continue; }
  l.relink(to);
  out.push({ id: lid, name: lname, from: from, to: to.fsName });
}
__result__ = { mode: "${mode}", relinked: out, skipped: skipped };`));
        },
    },
    {
        name: 'run_document_link_action',
        description: 'Act on links: update modified links or all of them, embed or unembed, open the original in its editor, reveal the file in Finder/Explorer or Bridge, select the linked item on its page, go to the source of a shared-content link, and check InCopy content out, in, or cancel the check-out (Links panel menu > Update Link, Update All Links, Embed Link, Unembed Link, Edit Original, Reveal in Finder, Reveal in Bridge, Go To Link, Go to Source, Check Out, Check In, Cancel Check Out; Edit > Edit Original)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['update', 'update_all', 'embed', 'unembed', 'edit_original', 'reveal_in_system', 'reveal_in_bridge', 'go_to_link', 'go_to_source', 'check_out', 'check_in', 'cancel_check_out'], description: 'What to do; update_all needs no links and updates every out-of-date link. cancel_check_out discards changes made since the check-out' },
                links: { ...LINKS_SCHEMA, description: `${LINKS_SCHEMA.description}. Not used by update_all` },
                folder: { type: 'string', description: 'unembed: write the files into this folder and link to them (default: link back to the original files)' },
                comment: { type: 'string', description: 'check_in: version comment' },
            },
            required: ['action'],
        },
        features: ids('links_menu_update_link', 'links_menu_update_all_links', 'links_menu_go_to_link', 'links_menu_unembed_link', 'links_menu_edit_original',
            'edit_original', 'links_menu_reveal_in_finder', 'links_menu_reveal_in_bridge', 'links_menu_go_to_source', 'links_menu_check_out',
            'links_menu_check_in', 'links_menu_cancel_check_out'),
        hints: { readOnly: false, destructive: true, openWorld: true },
        auditArgs: { links: { ids: [3] }, action: 'unembed', comment: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['update', 'update_all', 'embed', 'unembed', 'edit_original', 'reveal_in_system', 'reveal_in_bridge', 'go_to_link', 'go_to_source', 'check_out', 'check_in', 'cancel_check_out'], { name: 'action' });
            if (a.folder !== undefined && action !== 'unembed') throw new Error("'folder' applies to unembed");
            if (a.comment !== undefined && action !== 'check_in') throw new Error("'comment' applies to check_in");
            if (action === 'update_all' && a.links !== undefined) throw new Error("update_all updates every out-of-date link; leave out 'links' or use update");
            const largs = action === 'update_all' ? '[], [], [], [LinkStatus.LINK_OUT_OF_DATE], false, true' : linkArgs(a.links);
            const managed = `var p = l.parent, m = null;
  if (p.constructor.name === "Story") m = p;
  else { try { if (p.parent.lockState != LockStateValues.NONE) m = p.parent; } catch (e) {} }
  if (!m) { skipped.push({ id: lid, name: lname, reason: "not an InCopy link" }); continue; }`;
            const acts = {
                update: `if (l.status != LinkStatus.LINK_OUT_OF_DATE) { skipped.push({ id: lid, name: lname, reason: __enumName(l.status) }); continue; }
  l.update();`,
                embed: `if (l.status == LinkStatus.LINK_EMBEDDED || l.status == LinkStatus.LINK_MISSING) { skipped.push({ id: lid, name: lname, reason: __enumName(l.status) }); continue; }
  l.unlink();`,
                unembed: `if (l.status != LinkStatus.LINK_EMBEDDED) { skipped.push({ id: lid, name: lname, reason: "not embedded" }); continue; }
  ${a.folder !== undefined ? 'l.unembed(dir, "", false);' : 'l.unembed();'}`,
                edit_original: 'l.editOriginal();',
                reveal_in_system: 'l.revealInSystem();',
                reveal_in_bridge: 'l.revealInBridge();',
                go_to_link: 'l.show();',
                go_to_source: 'l.goToSource();',
                check_out: `${managed}
  if (!m.checkOut()) { skipped.push({ id: lid, name: lname, reason: "could not check out" }); continue; }`,
                check_in: `${managed}
  if (!m.checkIn(${a.comment === undefined ? '""' : text(a.comment, 'comment', 2000)}, false)) { skipped.push({ id: lid, name: lname, reason: "could not check in" }); continue; }`,
                cancel_check_out: `${managed}
  if (!m.revert()) { skipped.push({ id: lid, name: lname, reason: "could not cancel the check-out" }); continue; }`,
            };
            acts.update_all = acts.update;
            const prep = action === 'unembed' && a.folder !== undefined
                ? `var dir = Folder(${pathLit(a.folder, 'folder')});
if (!dir.exists && !dir.create()) throw new Error("Could not create " + dir.fsName);`
                : '';
            const single = ['edit_original', 'go_to_link', 'go_to_source', 'reveal_in_system', 'reveal_in_bridge'].includes(action);
            return run('Link action', imgScript(`
var links = __links(doc, ${largs}), done = [], skipped = [];
${action === 'update_all' ? '' : 'if (!links.length) throw new Error("No links matched");'}
${single ? `if (links.length > 20) throw new Error("${action} opens or selects each link; choose at most 20 (" + links.length + " chosen)");` : ''}
${prep}
for (var i = 0; i < links.length; i++) {
  var l = links[i], lid = l.id, lname = l.name;
  ${acts[action]}
  done.push({ id: lid, name: lname });
}
__result__ = { action: "${action}", done: done, skipped: skipped };`));
        },
    },
    {
        name: 'run_links_panel_command',
        description: 'Run a Links panel menu command: Search for Missing Links, copy link information as text (Utilities > Copy All Link Information, Copy Info for Selected Links), or change the panel display (Show Link Information Pane, Auto-Size Link Information, Hide Thumbnail). Optionally select items first so the command acts on their links',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(PANEL_COMMANDS), description: 'The command to run' },
                target: { ...TARGET_SCHEMA, description: `Optional items to select first. ${TARGET_SCHEMA.description}` },
            },
            required: ['command'],
        },
        features: ids('links_menu_search_for_missing_links', 'links_menu_utilities_copy_all_link_information', 'links_menu_utilities_copy_info_for_selected_links',
            'links_menu_show_link_information_pane', 'links_menu_auto_size_link_information', 'links_menu_hide_thumbnail'),
        hints: { readOnly: false },
        handler: (a) => {
            const command = enumOf(a.command, Object.keys(PANEL_COMMANDS), { name: 'command' });
            const select = a.target === undefined ? '' : `doc.select(__targets(doc, ${targetSpec(a.target)}), SelectionOptions.REPLACE_WITH);`;
            return run('Links panel command', imgScript(`
${select}
var before = 0;
for (var i = 0; i < doc.links.length; i++) if (doc.links[i].status == LinkStatus.LINK_MISSING) before++;
__menu([${PANEL_COMMANDS[command]}], "${command}");
var after = 0;
for (var j = 0; j < doc.links.length; j++) if (doc.links[j].status == LinkStatus.LINK_MISSING) after++;
__result__ = { command: "${command}", missingBefore: before, missingAfter: after };`));
        },
    },
    {
        name: 'place_graphic_with_options',
        description: 'Place an image, PDF or Illustrator page, InDesign page, EPS or SVG with its import options set without the dialog, on a page or into an existing frame (replacing its content), then optionally fit it and add a static caption (File > Place > Show Import Options: Image Import Options, Place PDF, Place InDesign Document, EPS Import Options; Replace Selected Item; Create Static Captions)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'The file to place (inside the allowed directories)' },
                pageIndex: { type: 'integer', minimum: 0, default: 0, description: 'Page to place on (0-based), unless frameId or intoSelection is given' },
                x: { type: 'number', default: 10, description: 'Left of the placed graphic, mm from the page\'s left edge' },
                y: { type: 'number', default: 10, description: 'Top of the placed graphic, mm from the page\'s top edge' },
                frameId: { type: 'integer', minimum: 0, description: 'Place into this frame, replacing its content (Replace Selected Item)' },
                intoSelection: { type: 'boolean', description: 'Place into the selected frame, replacing its content (Replace Selected Item)' },
                pdf: groupSchema('pdf'),
                indesignPage: groupSchema('indesignPage'),
                eps: groupSchema('eps'),
                image: { type: 'object', description: 'Image Import Options, also used for EPS clipping paths (applyClippingPath)', properties: IMAGE_OPTIONS_SCHEMA },
                fit: { type: 'string', enum: FIT_OPTIONS, description: 'Fit the placed graphic in its frame afterwards (Object > Fitting)' },
                staticCaption: { type: 'boolean', description: 'Add a static caption from the image\'s metadata after placing (Create Static Captions)' },
            },
            required: ['filePath'],
        },
        features: ids('replace_selected_item', 'create_static_captions_on_place', 'imported_page', 'pdf_graphic', 'svg_graphic', 'eps_graphic',
            'img_import_apply_photoshop_clipping_path', 'img_import_alpha_channel', 'img_import_enable_color_management_image_import',
            'img_import_rendering_intent_image_import', 'img_import_show_layers_image_import', 'img_import_when_updating_link',
            'pdf_place_pages_place_pdf', 'pdf_place_crop_to', 'pdf_place_transparent_background', 'pdf_place_password_place_pdf',
            'pdf_place_crop_to_indesign_page', 'eps_import_read_embedded_opi_image_links', 'eps_import_apply_photoshop_clipping_path_eps',
            'eps_import_proxy_generation', 'eps_import_create_frames_from_eps_bounding_box', 'image_import_options'),
        hints: { readOnly: false },
        auditArgs: { frameId: undefined, intoSelection: undefined, pdf: { page: 2, crop: 'CROP_TRIM', transparentBackground: true, password: 'secret' }, indesignPage: { page: 3, crop: 'CROP_BLEED' }, image: { applyClippingPath: true, alphaChannel: 'Alpha 1', profile: 'USE_DOCUMENT', renderingIntent: 'PERCEPTUAL', layers: [{ name: 'Background', visible: false }], whenUpdatingLink: 'KEEP_OVERRIDES' } },
        handler: (a) => {
            const file = pathLit(a.filePath, 'filePath');
            if (a.frameId !== undefined && a.intoSelection) throw new Error("Give frameId or intoSelection, not both");
            const into = a.frameId !== undefined || a.intoSelection === true;
            for (const k of ['pageIndex', 'x', 'y']) if (into && a[k] !== undefined) throw new Error(`'${k}' does not apply when placing into a frame`);
            const img = a.image ?? {};
            known(a.image, GRAPHIC_OPTION_KEYS, 'image');
            const pre = [];
            for (const key of Object.keys(PLACE_GROUPS)) if (a[key] !== undefined) pre.push(...placeGroupLines(key, a[key]));
            if (img.applyClippingPath !== undefined) pre.push(`__keep(app.imageIOPreferences, "applyPhotoshopClippingPath", app.imageIOPreferences.applyPhotoshopClippingPath); app.imageIOPreferences.applyPhotoshopClippingPath = ${flag(img.applyClippingPath, 'image.applyClippingPath')};`);
            if (img.alphaChannel !== undefined) pre.push(`__keep(app.imageIOPreferences, "alphaChannelName", app.imageIOPreferences.alphaChannelName); app.imageIOPreferences.alphaChannelName = ${text(img.alphaChannel, 'image.alphaChannel', 200)};`);
            const post = graphicOptionLines({ ...img, applyClippingPath: undefined, alphaChannel: undefined }, 'image');
            const fit = a.fit === undefined ? null : enumOf(a.fit, FIT_OPTIONS, { name: 'fit' });
            let where;
            if (a.frameId !== undefined) {
                where = `var frame = __item(doc, ${index(a.frameId, { name: 'frameId', max: 1e9 })});
  placed = frame.place(f, false);`;
            } else if (a.intoSelection) {
                where = `if (app.selection.length !== 1) throw new Error("Select one frame to place into");
  placed = app.selection[0].place(f, false);`;
            } else {
                const p = index(a.pageIndex ?? 0, { name: 'pageIndex' });
                where = `var page = __page(doc, ${p});
  placed = page.place(f, __toPage(page, ${num(a.x ?? 10, { name: 'x' })}, ${num(a.y ?? 10, { name: 'y' })}), doc.activeLayer, false, false);`;
            }
            const caption = a.staticCaption === undefined ? false : flag(a.staticCaption, 'staticCaption') === 'true';
            return run('Place graphic', imgScript(`
var f = File(${file});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var __kept = [];
var __keep = function (o, p, v) { __kept.push([o, p, v]); };
var placed = [];
try {
  ${pre.join('\n  ')}
  ${where}
} finally {
  for (var k = __kept.length - 1; k >= 0; k--) { try { __kept[k][0][__kept[k][1]] = __kept[k][2]; } catch (e) {} }
}
var out = [], frames = [];
for (var i = 0; i < placed.length; i++) {
  var g = placed[i], gc = g.constructor.name, notes = [];
  var fr = gc === "Story" ? null : g.parent;
  if (fr) {
    ${post.join('\n    ')}
    ${fit ? `fr.fit(FitOptions.${fit});${fit === 'PROPORTIONALLY' || fit === 'FILL_PROPORTIONALLY' ? ' fr.fit(FitOptions.CENTER_CONTENT);' : ''}` : ''}
    frames.push(fr);
  }
  var info = fr ? __itemInfo(fr) : { type: gc };
  info.content = gc;
  if (notes.length) info.notes = notes;
  try { info.link = __linkInfo(g.itemLink, false, []); } catch (e) {}
  out.push(info);
}
var caption = null;
${caption ? `if (frames.length) {
  var n0 = doc.allPageItems.length;
  doc.select(frames, SelectionOptions.REPLACE_WITH);
  __menu([${CAPTION_COMMANDS.static.join(', ')}], "Generate Static Caption");
  caption = { newItems: doc.allPageItems.length - n0 };
}` : ''}
__result__ = { file: f.fsName, placed: out, caption: caption };`));
        },
    },
    {
        name: 'get_placed_graphic_options',
        description: 'Read the import and display options of placed graphics: type (image, PDF, InDesign page, EPS, SVG), link, resolution, colour profile and the profiles available, rendering intent, clipping path and alpha channels, layers and their visibility, the PDF or InDesign page and crop placed, and display quality (Object > Image Import Options, Object Layer Options, Display Performance)',
        inputSchema: {
            type: 'object',
            properties: { target: { ...TARGET_SCHEMA, description: `Frames or graphics to read. ${TARGET_SCHEMA.description}` } },
            required: ['target'],
        },
        features: ids('imported_page', 'pdf_graphic', 'svg_graphic', 'eps_graphic', 'object_layer_options', 'image_import_options'),
        hints: { readOnly: true, idempotent: true },
        handler: (a) => run('Get graphic options', imgScript(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var gs = __graphics(items[i]);
  if (!gs.length) { out.push({ item: __itemInfo(items[i]), graphics: [] }); continue; }
  var list = [];
  for (var j = 0; j < gs.length; j++) {
    var g = gs[j], gc = g.constructor.name, r = { id: g.id, type: gc };
    try { r.link = __linkInfo(g.itemLink, false, []); } catch (e) {}
    try { r.displayQuality = __enumName(g.parent.localDisplaySetting); } catch (e) {}
    try { r.actualPpi = g.actualPpi; r.effectivePpi = g.effectivePpi; r.space = g.space; } catch (e) {}
    if (gc === "Image") {
      try { r.profile = __enumName(g.profile); r.profileList = g.profileList; r.renderingIntent = __enumName(g.imageRenderingIntent); } catch (e) {}
      try { r.applyClippingPath = g.imageIOPreferences.applyPhotoshopClippingPath; r.alphaChannel = g.imageIOPreferences.alphaChannelName; } catch (e) {}
    }
    try {
      var cp = g.clippingPath;
      r.clippingPath = { type: __enumName(cp.clippingType), applied: cp.appliedPathName, photoshopPaths: cp.photoshopPathNames, alphaChannels: cp.alphaChannelPathNames };
    } catch (e) {}
    if (gc === "Image" || gc === "PDF" || gc === "ImportedPage") {
      try { r.layers = __layerTree(g.graphicLayerOptions.graphicLayers, 0); r.whenUpdatingLink = __enumName(g.graphicLayerOptions.updateLinkOption); } catch (e) {}
    }
    if (gc === "PDF" || gc === "ImportedPage") {
      try { var pa = g.pdfAttributes; r.pdf = { page: pa.pageNumber, crop: __enumName(pa.pdfCrop), transparentBackground: pa.transparentBackground }; } catch (e) {}
    }
    if (gc === "ImportedPage") { try { r.indesignPage = { page: g.pageNumber, crop: __enumName(g.importedPageCrop) }; } catch (e) {} }
    if (gc === "SVG") { try { r.useSVGAs = __enumName(g.useSVGAs); } catch (e) {} }
    list.push(r);
  }
  var holder = gs[0].parent;
  out.push({ item: __itemInfo(holder), graphics: list });
}
__result__ = { items: out };`)),
    },
    {
        name: 'set_placed_graphic_options',
        description: 'Change the import options of placed graphics without the dialog: Photoshop clipping path, alpha channel, which layers are visible and what happens to them when the link updates, and the item\'s display quality (Object > Image Import Options, Object > Object Layer Options, Object > Display Performance). For colour profile and rendering intent use set_image_color_settings',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `Frames holding the graphics, or the graphics. ${TARGET_SCHEMA.description}` },
                ...SET_OPTIONS_SCHEMA,
                displayQuality: { type: 'string', enum: DISPLAY, description: 'Display Performance for these items: DEFAULT_VALUE (use the view setting), HIGH_QUALITY, TYPICAL or OPTIMIZED (fast)' },
            },
            required: ['target'],
        },
        features: ids('image_import_options', 'object_layer_options', 'img_import_apply_photoshop_clipping_path', 'img_import_alpha_channel',
            'img_import_show_layers_image_import',
            'img_import_when_updating_link', 'image_quality_display'),
        hints: { readOnly: false, idempotent: true },
        auditArgs: { layers: [{ name: 'Group/Shadow', visible: false }] },
        handler: (a) => {
            for (const k of ['profile', 'renderingIntent']) if (a[k] !== undefined) throw new Error(`'${k}' is set with set_image_color_settings`);
            const lines = graphicOptionLines(a, 'options');
            const display = a.displayQuality === undefined ? null : enumOf(a.displayQuality, DISPLAY, { name: 'displayQuality' });
            if (!lines.length && !display) throw new Error('Nothing to set: give at least one option');
            return run('Set graphic options', imgScript(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  ${display ? `items[i].localDisplaySetting = DisplaySettingOptions.${display};` : ''}
  var gs = __graphics(items[i]), notes = [];
  ${lines.length ? `if (!gs.length) notes.push("no placed graphic");
  for (var j = 0; j < gs.length; j++) {
    var g = gs[j], gc = g.constructor.name, fr = g.parent;
    ${lines.join('\n    ')}
  }` : ''}
  var info = __itemInfo(items[i]);
  if (notes.length) info.notes = notes;
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'adjust_frame_content',
        description: 'Crop a placed graphic by moving its frame\'s edges while the graphic stays put, move the graphic inside its frame, or scale it within the frame, as with the Direct Selection tool or content grabber',
        inputSchema: {
            type: 'object',
            properties: {
                target: { ...TARGET_SCHEMA, description: `Frames holding graphics. ${TARGET_SCHEMA.description}` },
                crop: {
                    type: 'object', description: 'Move each frame edge inward by this many mm (negative moves it outward, uncovering more of the graphic)',
                    properties: {
                        top: { type: 'number', description: 'Top edge (mm)' }, left: { type: 'number', description: 'Left edge (mm)' },
                        bottom: { type: 'number', description: 'Bottom edge (mm)' }, right: { type: 'number', description: 'Right edge (mm)' },
                    },
                },
                moveContent: {
                    type: 'object', description: 'Move the graphic inside the frame by an offset',
                    properties: { dx: { type: 'number', description: 'Rightward (mm)' }, dy: { type: 'number', description: 'Downward (mm)' } },
                },
                scaleContent: {
                    type: 'object', description: 'Scale the graphic inside the frame',
                    properties: { horizontal: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Horizontal scale (%)' }, vertical: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Vertical scale (%)' } },
                },
            },
            required: ['target'],
        },
        features: ids('crop_objects', 'move_frame_content'),
        hints: { readOnly: false },
        handler: (a) => {
            known(a.crop, ['top', 'left', 'bottom', 'right'], 'crop');
            known(a.moveContent, ['dx', 'dy'], 'moveContent');
            known(a.scaleContent, ['horizontal', 'vertical'], 'scaleContent');
            const steps = [];
            if (a.scaleContent) {
                const s = a.scaleContent;
                if (s.horizontal === undefined && s.vertical === undefined) throw new Error("'scaleContent' needs horizontal or vertical");
                if (s.horizontal !== undefined) steps.push(`g.horizontalScale = ${num(s.horizontal, { min: 0.1, max: 10000, name: 'scaleContent.horizontal' })};`);
                if (s.vertical !== undefined) steps.push(`g.verticalScale = ${num(s.vertical, { min: 0.1, max: 10000, name: 'scaleContent.vertical' })};`);
            }
            if (a.moveContent) {
                const dx = num(a.moveContent.dx ?? 0, { name: 'moveContent.dx', min: -10000, max: 10000 });
                const dy = num(a.moveContent.dy ?? 0, { name: 'moveContent.dy', min: -10000, max: 10000 });
                steps.push(`g.move(undefined, [${dx}, ${dy}]);`);
            }
            if (a.crop) {
                const c = (k) => num(a.crop[k] ?? 0, { name: `crop.${k}`, min: -10000, max: 10000 });
                steps.push(`var gb = g.geometricBounds, b = fr.geometricBounds;
  var nb = [b[0] + ${c('top')}, b[1] + ${c('left')}, b[2] - ${c('bottom')}, b[3] - ${c('right')}];
  if (nb[2] - nb[0] <= 0 || nb[3] - nb[1] <= 0) throw new Error("Cropping item " + fr.id + " leaves no area");
  fr.geometricBounds = nb;
  var ng = g.geometricBounds;
  if (ng[0] !== gb[0] || ng[1] !== gb[1]) g.move(undefined, [gb[1] - ng[1], gb[0] - ng[0]]);`);
            }
            if (!steps.length) throw new Error('Nothing to do: give crop, moveContent or scaleContent');
            return run('Adjust frame content', imgScript(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var gs = __graphics(items[i]);
  if (!gs.length) throw new Error("Item " + items[i].id + " holds no placed graphic");
  var g = gs[0], fr = g.parent;
  ${steps.join('\n  ')}
  var info = __itemInfo(fr), fb = fr.geometricBounds, cb = g.geometricBounds;
  info.content = { x: cb[1] - fb[1], y: cb[0] - fb[0], width: cb[3] - cb[1], height: cb[2] - cb[0], horizontalScale: g.horizontalScale, verticalScale: g.verticalScale };
  out.push(info);
}
__result__ = { items: out };`));
        },
    },
    {
        name: 'place_contact_sheet',
        description: 'Place many images as a contact sheet: an evenly spaced grid of frames, one file in each, fitted, flowing onto further pages as needed, optionally captioned (the place cursor\'s grid placing)',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, maxItems: 1000, description: 'The files to place, in order' },
                folder: { type: 'string', description: 'Place every image in this folder instead (sorted by name)' },
                extensions: { type: 'array', items: { type: 'string' }, description: `With folder: the extensions to take (default: ${IMAGE_EXTENSIONS.join(', ')})` },
                pageIndex: { type: 'integer', minimum: 0, default: 0, description: 'First page to fill (0-based)' },
                columns: { type: 'integer', minimum: 1, maximum: 50, default: 3, description: 'Columns in the grid' },
                rows: { type: 'integer', minimum: 1, maximum: 50, default: 3, description: 'Rows in the grid' },
                gutter: { type: 'number', minimum: 0, maximum: 200, default: 4, description: 'Space between cells (mm)' },
                area: {
                    type: 'object', description: 'The area to fill on each page, mm from the page\'s top-left, with all four of x, y, width and height (default: inside the margins)',
                    properties: {
                        x: { type: 'number', description: 'Left (mm)' }, y: { type: 'number', description: 'Top (mm)' },
                        width: { type: 'number', minimum: 1, description: 'Width (mm)' }, height: { type: 'number', minimum: 1, description: 'Height (mm)' },
                    },
                },
                fit: { type: 'string', enum: FIT_OPTIONS, default: 'PROPORTIONALLY', description: 'How each image fits its cell' },
                addPages: { type: 'boolean', default: true, description: 'Add pages at the end when the files outrun the pages (otherwise stop and report the rest)' },
                caption: { type: 'string', enum: ['none', 'live', 'static'], default: 'none', description: 'Caption each image from its metadata (Caption Setup settings)' },
            },
        },
        features: ids('contact_sheets'),
        hints: { readOnly: false },
        auditArgs: { folder: undefined, extensions: undefined, caption: 'static' },
        handler: (a) => {
            if ((a.files === undefined) === (a.folder === undefined)) throw new Error('Give files or folder');
            if (a.extensions !== undefined && a.folder === undefined) throw new Error("'extensions' goes with folder");
            let source;
            if (a.files !== undefined) {
                if (!Array.isArray(a.files) || !a.files.length || a.files.length > 1000) throw new Error("'files' must be a list of 1 to 1000 paths");
                source = `var files = [${a.files.map((p, i) => pathLit(p, `files[${i}]`)).join(', ')}];
for (var fi = 0; fi < files.length; fi++) files[fi] = File(files[fi]);`;
            } else {
                const exts = (a.extensions ?? IMAGE_EXTENSIONS).map((e, i) => extension(e, `extensions[${i}]`).toLowerCase());
                if (!exts.length) throw new Error("'extensions' is empty");
                source = `var dir = Folder(${pathLit(a.folder, 'folder')});
if (!dir.exists) throw new Error("Folder not found: " + dir.fsName);
var exts = "|${exts.join('|')}|", all = dir.getFiles(), files = [];
for (var fi = 0; fi < all.length; fi++) {
  var nm = all[fi].name, dot = nm.lastIndexOf(".");
  if (all[fi] instanceof File && dot > 0 && exts.indexOf("|" + nm.substring(dot + 1).toLowerCase() + "|") >= 0) files.push(all[fi]);
}
files.sort(function (p, q) { return p.name < q.name ? -1 : (p.name > q.name ? 1 : 0); });
if (!files.length) throw new Error("No images in " + dir.fsName);`;
            }
            const cols = index(a.columns ?? 3, { name: 'columns', max: 50 });
            const rows = index(a.rows ?? 3, { name: 'rows', max: 50 });
            if (Number(cols) < 1 || Number(rows) < 1) throw new Error("'columns' and 'rows' must be at least 1");
            const gutter = num(a.gutter ?? 4, { name: 'gutter', min: 0, max: 200 });
            const fit = enumOf(a.fit ?? 'PROPORTIONALLY', FIT_OPTIONS, { name: 'fit' });
            const caption = enumOf(a.caption ?? 'none', ['none', 'live', 'static'], { name: 'caption' });
            let area = 'var mp = page.marginPreferences, pb = page.bounds; var ax = mp.left, ay = mp.top, aw = pb[3] - pb[1] - mp.left - mp.right, ah = pb[2] - pb[0] - mp.top - mp.bottom;';
            if (a.area !== undefined) {
                known(a.area, ['x', 'y', 'width', 'height'], 'area');
                area = `var ax = ${num(a.area.x, { name: 'area.x' })}, ay = ${num(a.area.y, { name: 'area.y' })}, aw = ${num(a.area.width, { name: 'area.width', min: 1 })}, ah = ${num(a.area.height, { name: 'area.height', min: 1 })};`;
            }
            return run('Place contact sheet', imgScript(`
${source}
var cols = ${cols}, rows = ${rows}, gut = ${gutter}, per = cols * rows;
var pi = ${index(a.pageIndex ?? 0, { name: 'pageIndex' })}, page = __page(doc, pi);
var frames = [], out = [], failed = [], unplaced = [];
for (var i = 0; i < files.length; i++) {
  var cell = i % per;
  if (cell === 0 && i > 0) {
    pi++;
    if (pi >= doc.pages.length) {
      if (!${bool(a.addPages ?? true)}) { for (var u = i; u < files.length; u++) unplaced.push(files[u].fsName); break; }
      doc.pages.add(LocationOptions.AT_END);
    }
    page = doc.pages[pi];
  }
  ${area}
  var cw = (aw - gut * (cols - 1)) / cols, ch = (ah - gut * (rows - 1)) / rows;
  if (cw <= 0 || ch <= 0) throw new Error("The cells have no room: reduce the gutter, columns or rows");
  var c = cell % cols, r = Math.floor(cell / cols);
  var tl = __toPage(page, ax + c * (cw + gut), ay + r * (ch + gut));
  var rect = page.rectangles.add();
  rect.geometricBounds = [tl[1], tl[0], tl[1] + ch, tl[0] + cw];
  try {
    rect.place(files[i], false);
    rect.fit(FitOptions.${fit});${fit === 'PROPORTIONALLY' || fit === 'FILL_PROPORTIONALLY' ? '\n    rect.fit(FitOptions.CENTER_CONTENT);' : ''}
    frames.push(rect);
    out.push({ id: rect.id, file: files[i].fsName, page: page.name });
  } catch (e) {
    rect.remove();
    failed.push({ file: files[i].fsName, error: e.message });
  }
}
var captions = null;
${caption === 'none' ? '' : `if (frames.length) {
  var n0 = doc.allPageItems.length;
  doc.select(frames, SelectionOptions.REPLACE_WITH);
  __menu([${CAPTION_COMMANDS[caption].join(', ')}], "Generate ${caption} caption");
  captions = { kind: "${caption}", newItems: doc.allPageItems.length - n0 };
}`}
__result__ = { placed: out, failed: failed, unplaced: unplaced, captions: captions };`));
        },
    },
    {
        name: 'manage_place_cursor',
        description: 'Load files into the place cursor (loaded graphics) so they can be placed by clicking in InDesign, see what it holds, rotate through its contents, or empty it (File > Place with several files; the place cursor)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['load', 'status', 'rotate', 'clear'], description: 'load files, report its status, rotate to the next or previous file, or clear it' },
                files: { type: 'array', items: { type: 'string' }, maxItems: 500, description: 'load: the files to load' },
                direction: { type: 'string', enum: ['FORWARD', 'BACKWARD'], default: 'FORWARD', description: 'rotate: which way' },
            },
            required: ['action'],
        },
        features: ids('place_gun'),
        hints: { readOnly: false },
        auditArgs: { action: 'load', direction: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['load', 'status', 'rotate', 'clear'], { name: 'action' });
            if (a.files !== undefined && action !== 'load') throw new Error("'files' applies to load");
            if (a.direction !== undefined && action !== 'rotate') throw new Error("'direction' applies to rotate");
            let body;
            if (action === 'load') {
                if (!Array.isArray(a.files) || !a.files.length || a.files.length > 500) throw new Error("load needs 'files': a list of 1 to 500 paths");
                body = `var files = [${a.files.map((p, i) => pathLit(p, `files[${i}]`)).join(', ')}];
for (var i = 0; i < files.length; i++) {
  files[i] = File(files[i]);
  if (!files[i].exists) throw new Error("File not found: " + files[i].fsName);
}
gun.loadPlaceGun(files, false);`;
            } else if (action === 'rotate') {
                body = `if (!gun.loaded) throw new Error("The place cursor is empty");
gun.rotate(RotationDirection.${enumOf(a.direction ?? 'FORWARD', ['FORWARD', 'BACKWARD'], { name: 'direction' })});`;
            } else if (action === 'clear') {
                body = 'if (gun.loaded) gun.abortPlaceGun();';
            } else body = '';
            return run('Place cursor', imgScript(`
var gun = doc.placeGuns;
${body}
var held = [];
for (var k = 0; k < gun.pageItems.length; k++) {
  var it = gun.pageItems[k], h = { type: it.constructor.name, link: null };
  try { h.link = it.allGraphics.length ? it.allGraphics[0].itemLink.name : null; } catch (e) {}
  held.push(h);
}
__result__ = { action: "${action}", loaded: gun.loaded, count: held.length, items: held };`));
        },
    },
];
