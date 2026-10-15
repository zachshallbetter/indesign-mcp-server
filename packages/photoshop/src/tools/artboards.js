/**
 * Artboards and frames: list artboards, create them (new, from layers, from a
 * group, or a new artboard document), change their size, position,
 * background and auto-nesting, duplicate and ungroup them, artboard guides,
 * the Artboard and Frame tools, frames from layers or a group, and export of
 * artboards to files or PDF.
 *
 * ExtendScript has no artboard class: an artboard is a top-level group whose
 * layer descriptor carries an "artboard" object with its artboardRect and
 * background. Artboards are made with the make event on an artboardSection
 * class reference, and changed with editArtboardEvent, as in Adobe community
 * scripts (ArtboardsFromCSV, Size-Marks, GUI Automation Toolbox).
 */
import path from 'node:path';
import { str, num, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, COLOR_SCHEMA, targetSpec, colorSpec } from '../args.js';
import { paths } from './documents.js';

/** Action Manager helpers shared by the artboard scripts. */
const AM = String.raw`
var __c = function (id) { return app.charIDToTypeID(id); };
var __s = function (id) { return app.stringIDToTypeID(id); };
var __layerDesc = function (id) {
  var r = new ActionReference();
  r.putIdentifier(__c("Lyr "), id);
  return app.executeActionGet(r);
};
var __isArtboard = function (l) {
  if (l.typename !== "LayerSet") return false;
  var d = __layerDesc(l.id), k = __s("artboardEnabled");
  return d.hasKey(k) ? d.getBoolean(k) : false;
};
var __val = function (d, key) {
  var id = __s(key);
  return d.getType(id) === DescValueType.UNITDOUBLE ? d.getUnitDoubleValue(id) : d.getDouble(id);
};
var __abRect = function (l) {
  var r = __layerDesc(l.id).getObjectValue(__s("artboard")).getObjectValue(__s("artboardRect"));
  return [__val(r, "left"), __val(r, "top"), __val(r, "right"), __val(r, "bottom")];
};
var __BACKGROUNDS = ["", "white", "black", "transparent", "other"];
var __abBackground = function (l) {
  var a = __layerDesc(l.id).getObjectValue(__s("artboard")), out = { type: 1, rgb: null };
  if (a.hasKey(__s("artboardBackgroundType"))) out.type = a.getInteger(__s("artboardBackgroundType"));
  if (a.hasKey(__c("Clr "))) {
    var c = a.getObjectValue(__c("Clr "));
    try { out.rgb = [c.getDouble(__c("Rd  ")), c.getDouble(__c("Grn ")), c.getDouble(__c("Bl  "))]; } catch (e) {}
  }
  return out;
};
var __abInfo = function (l) {
  var r = __abRect(l), bg = __abBackground(l);
  return { id: l.id, name: l.name, x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], layers: l.layers.length, visible: l.visible,
    background: __BACKGROUNDS[bg.type] || bg.type, backgroundColor: bg.rgb };
};
var __artboards = function (d) {
  var out = [];
  for (var i = 0; i < d.layers.length; i++) if (__isArtboard(d.layers[i])) out.push(d.layers[i]);
  return out;
};
var __selectLayers = function (layers) {
  var r = new ActionReference(), d = new ActionDescriptor();
  for (var i = 0; i < layers.length; i++) r.putIdentifier(__c("Lyr "), layers[i].id);
  d.putReference(__c("null"), r);
  d.putBoolean(__c("MkVs"), false);
  app.executeAction(__c("slct"), d, DialogModes.NO);
};
var __onTarget = function (eventId) {
  var r = new ActionReference(), d = new ActionDescriptor();
  r.putEnumerated(__c("Lyr "), __c("Ordn"), __c("Trgt"));
  d.putReference(__c("null"), r);
  app.executeAction(__s(eventId), d, DialogModes.NO);
};
var __rectDesc = function (rc) {
  var d = new ActionDescriptor();
  d.putDouble(__c("Top "), rc[1]);
  d.putDouble(__c("Left"), rc[0]);
  d.putDouble(__c("Btom"), rc[3]);
  d.putDouble(__c("Rght"), rc[2]);
  return d;
};
var __editArtboard = function (l, rect, bg, autoNest) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putIdentifier(__c("Lyr "), l.id);
  d.putReference(__c("null"), r);
  if (rect || bg) {
    var a = new ActionDescriptor();
    a.putObject(__s("artboardRect"), __s("classFloatRect"), __rectDesc(rect || __abRect(l)));
    if (bg) {
      a.putInteger(__s("artboardBackgroundType"), bg.type);
      if (bg.color) {
        var c = new ActionDescriptor(), sc = __color(bg.color);
        c.putDouble(__c("Rd  "), sc.rgb.red);
        c.putDouble(__c("Grn "), sc.rgb.green);
        c.putDouble(__c("Bl  "), sc.rgb.blue);
        a.putObject(__c("Clr "), __c("RGBC"), c);
      }
    }
    d.putObject(__s("artboard"), __s("artboard"), a);
    if (rect) d.putInteger(__s("changeSizes"), 5);
  }
  if (autoNest !== null) d.putBoolean(__s("autoNestEnabled"), autoNest);
  app.executeAction(__s("editArtboardEvent"), d, DialogModes.NO);
};
var __onlyArtboards = function (items) {
  for (var i = 0; i < items.length; i++) if (!__isArtboard(items[i])) throw new Error(items[i].name + " is not an artboard");
  return items;
};
`;

/**
 * Run statements as one History state (Document.suspendHistory). Errors
 * inside are carried out and rethrown.
 */
function oneState(label, body) {
    return `
var __err = null;
var __step = function () {
  try {
${body}
  } catch (e) { __err = e; }
};
doc.suspendHistory(${str(label)}, "__step()");
if (__err) throw __err;`;
}

const BACKGROUND_TYPES = { white: 1, black: 2, transparent: 3 };
const BACKGROUND_SCHEMA = { type: 'string', description: 'Artboard background: "white", "black", "transparent", or a colour ("#RRGGBB", "rgb(r,g,b)", ...)' };

/** A background argument as a JSX literal for __editArtboard, or 'null'. */
function backgroundSpec(value) {
    if (value === undefined) return 'null';
    const v = String(value).trim().toLowerCase();
    if (v in BACKGROUND_TYPES) return `{ type: ${BACKGROUND_TYPES[v]}, color: null }`;
    return `{ type: 4, color: ${colorSpec(value, 'background')} }`;
}

const EXPORT_FORMATS = {
    png: ['.png', 'var o = new PNGSaveOptions();\no.compression = 6;'],
    jpg: ['.jpg', 'var o = new JPEGSaveOptions();\no.quality = 10;\no.embedColorProfile = true;'],
    psd: ['.psd', 'var o = new PhotoshopSaveOptions();\no.layers = true;'],
    tif: ['.tif', 'var o = new TiffSaveOptions();\no.imageCompression = TIFFEncoding.TIFFLZW;\no.layers = true;'],
    pdf: ['.pdf', 'var o = new PDFSaveOptions();\no.layers = false;\no.view = false;'],
};

export const tools = [
    {
        name: 'get_artboards',
        description: 'List the active document\'s artboards with id, name, position and size in pixels, layer count and background (Artboard properties in the Properties panel)',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.artboards.artboard_properties'],
        handler: () => run('List artboards', script(`${AM}
var list = __artboards(doc), out = [];
for (var i = 0; i < list.length; i++) out.push(__abInfo(list[i]));
__result__ = { artboards: out };`)),
    },
    {
        name: 'create_artboard',
        description: 'Create an artboard: new at a position and size (Layer > New > Artboard), from layers (Artboard from Layers), from a group (Artboard from Group), or a new document of type Artboard (File > New). The steps in the document form one history state',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', enum: ['new', 'layers', 'group', 'document'], description: 'Default new' },
                target: { ...TARGET_SCHEMA, description: 'layers: the layers to put on the artboard. group: the group to convert' },
                name: { type: 'string', description: 'Artboard (or document) name' },
                x: { type: 'number', description: 'new: left edge in pixels. Default to the right of the existing artboards' },
                y: { type: 'number', description: 'new: top edge in pixels. Default 0' },
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'new, document: width in pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'new, document: height in pixels' },
                resolution: { type: 'number', minimum: 1, maximum: 10000, description: 'document: pixels per inch. Default 72' },
                background: BACKGROUND_SCHEMA,
            },
        },
        auditArgs: { from: 'new', target: undefined, resolution: undefined, background: '#336699' },
        features: ['photoshop.artboards.new_artboard', 'photoshop.artboards.artboard_from_layers', 'photoshop.artboards.artboard_from_group', 'photoshop.artboards.artboard_document', 'photoshop.artboards.artboard_document_type', 'photoshop.history.suspend_history'],
        handler: (a) => {
            const from = enumOf(a.from ?? 'new', ['new', 'layers', 'group', 'document'], { name: 'from' });
            const sized = from === 'new' || from === 'document';
            if (sized && (a.width === undefined || a.height === undefined)) throw new Error(`${from} needs width and height`);
            if (!sized && (a.width !== undefined || a.height !== undefined)) throw new Error(`width and height do not apply to ${from}: the artboard fits its layers`);
            if (from !== 'new' && (a.x !== undefined || a.y !== undefined)) throw new Error("'x' and 'y' apply to from new");
            if (from !== 'document' && a.resolution !== undefined) throw new Error("'resolution' applies to from document");
            if ((from === 'layers' || from === 'group') && !a.target) throw new Error(`from ${from} needs 'target'`);
            if ((from === 'new' || from === 'document') && a.target !== undefined) throw new Error(`'target' does not apply to from ${from}`);
            if (from === 'document') {
                const res = num(a.resolution ?? 72, { min: 1, max: 10000, name: 'resolution' });
                const bg = a.background === undefined ? 'white' : String(a.background).trim().toLowerCase();
                const fill = { white: 'white', transparent: 'transparency' }[bg];
                if (!fill) throw new Error("A new artboard document's background is white or transparent");
                const w = num(a.width, { min: 1, max: 300000, name: 'width' });
                const h = num(a.height, { min: 1, max: 300000, name: 'height' });
                return run('Create artboard document', script(`${AM}
var d = new ActionDescriptor(), n = new ActionDescriptor();
n.putBoolean(__s("artboard"), true);
n.putClass(__s("mode"), __s("RGBColorMode"));
n.putUnitDouble(__s("width"), __s("distanceUnit"), ${w} * 72 / ${res});
n.putUnitDouble(__s("height"), __s("distanceUnit"), ${h} * 72 / ${res});
n.putUnitDouble(__s("resolution"), __s("densityUnit"), ${res});
n.putDouble(__s("pixelScaleFactor"), 1);
n.putEnumerated(__s("fill"), __s("fill"), __s(${str(fill)}));
n.putInteger(__s("depth"), 8);
${a.name !== undefined ? `n.putString(__s("name"), ${str(a.name)});` : ''}
d.putObject(__s("new"), __s("document"), n);
app.executeAction(__s("make"), d, DialogModes.NO);
var made = app.activeDocument, list = __artboards(made), out = [];
for (var i = 0; i < list.length; i++) out.push(__abInfo(list[i]));
__result__ = { document: __docInfo(made), artboards: out };`, { needsDocument: false }));
            }
            let make;
            if (from === 'new') {
                const w = num(a.width, { min: 1, max: 300000, name: 'width' });
                const h = num(a.height, { min: 1, max: 300000, name: 'height' });
                const y = a.y !== undefined ? num(a.y, { name: 'y' }) : '0';
                const x = a.x !== undefined ? num(a.x, { name: 'x' }) : null;
                make = `
    var left = ${x ?? 'null'};
    if (left === null) {
      left = 0;
      var others = __artboards(doc);
      for (var i = 0; i < others.length; i++) { var rr = __abRect(others[i]); if (rr[2] + 100 > left) left = rr[2] + 100; }
    }
    var d = new ActionDescriptor(), r = new ActionReference();
    r.putClass(__s("artboardSection"));
    d.putReference(__c("null"), r);
    d.putObject(__s("artboardRect"), __s("classFloatRect"), __rectDesc([left, ${y}, left + ${w}, ${y} + ${h}]));
    app.executeAction(__c("Mk  "), d, DialogModes.NO);`;
            } else if (from === 'layers') {
                make = `
    __selectLayers(__targets(doc, ${targetSpec(a.target)}));
    var d = new ActionDescriptor(), r = new ActionReference(), f = new ActionReference();
    r.putClass(__s("artboardSection"));
    d.putReference(__c("null"), r);
    f.putEnumerated(__c("Lyr "), __c("Ordn"), __c("Trgt"));
    d.putReference(__c("From"), f);
    app.executeAction(__c("Mk  "), d, DialogModes.NO);`;
            } else {
                make = `
    var g = __targets(doc, ${targetSpec(a.target)});
    if (g.length !== 1 || g[0].typename !== "LayerSet") throw new Error("Give one group");
    __selectLayers(g);
    __onTarget("artboardFromLayerGroupEvent");`;
            }
            return run('Create artboard', script(`${AM}${oneState('Create Artboard', `${make}
    var ab = doc.activeLayer;
    ${a.name !== undefined ? `ab.name = ${str(a.name)};` : ''}
    ${a.background !== undefined ? `__editArtboard(ab, null, ${backgroundSpec(a.background)}, null);` : ''}
    __result__ = __abInfo(ab);`)}`));
        },
    },
    {
        name: 'edit_artboards',
        description: 'Change artboards: set name, position, size, background colour and auto-nesting (Properties panel), duplicate one, ungroup them back to layers (Layer > Ungroup Artboards), clear their guides (View > Guides > Clear Selected Artboard Guides), add guides from a shape (New Artboard Guides From Shape), or pick the Artboard or Frame tool',
        inputSchema: {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['set', 'duplicate', 'ungroup', 'clear_guides', 'guides_from_shape', 'select_tool'] },
                target: { ...TARGET_SCHEMA, description: 'The artboards (ids from get_artboards); for guides_from_shape, the shape layer' },
                name: { type: 'string', description: 'set, duplicate: new name' },
                x: { type: 'number', description: 'set, duplicate: left edge in pixels' },
                y: { type: 'number', description: 'set, duplicate: top edge in pixels' },
                width: { type: 'number', minimum: 1, maximum: 300000, description: 'set: width in pixels' },
                height: { type: 'number', minimum: 1, maximum: 300000, description: 'set: height in pixels' },
                background: BACKGROUND_SCHEMA,
                autoNest: { type: 'boolean', description: 'set: let layers moved onto or off the artboard nest into or out of it automatically (false prevents auto-nesting)' },
                tool: { type: 'string', enum: ['artboard', 'frame'], description: 'select_tool: the Artboard tool or the Frame tool' },
            },
            required: ['operation'],
        },
        auditArgs: { operation: 'set', target: { ids: [7] }, tool: undefined, background: 'white' },
        features: ['photoshop.artboards.artboard_properties', 'photoshop.artboards.artboard_background', 'photoshop.artboards.artboard_auto_nest', 'photoshop.artboards.artboard_auto_nest_lock', 'photoshop.artboards.duplicate_artboard', 'photoshop.artboards.ungroup_artboards', 'photoshop.artboards.clear_selected_artboard_guides', 'photoshop.artboards.new_artboard_guides_from_shape', 'photoshop.artboards.artboard_tool', 'photoshop.artboards.frame_tool', 'photoshop.history.suspend_history'],
        handler: (a) => {
            const op = enumOf(a.operation, ['set', 'duplicate', 'ungroup', 'clear_guides', 'guides_from_shape', 'select_tool'], { name: 'operation' });
            const allowed = {
                set: ['target', 'name', 'x', 'y', 'width', 'height', 'background', 'autoNest'],
                duplicate: ['target', 'name', 'x', 'y'],
                ungroup: ['target'], clear_guides: ['target'], guides_from_shape: ['target'], select_tool: ['tool'],
            }[op];
            for (const k of ['target', 'name', 'x', 'y', 'width', 'height', 'background', 'autoNest', 'tool']) {
                if (a[k] !== undefined && !allowed.includes(k)) throw new Error(`'${k}' does not apply to ${op}`);
            }
            if (op === 'select_tool') {
                const tool = enumOf(a.tool, ['artboard', 'frame'], { name: 'tool' });
                return run('Select tool', script(`
app.currentTool = ${str(tool === 'artboard' ? 'artboardTool' : 'framedGroupTool')};
__result__ = { tool: app.currentTool };`, { needsDocument: false }));
            }
            if (!a.target) throw new Error(`${op} needs 'target'`);
            const spec = targetSpec(a.target);
            const coord = (k) => (a[k] !== undefined ? num(a[k], { name: k, min: k === 'width' || k === 'height' ? 1 : -1e9, max: k === 'width' || k === 'height' ? 300000 : 1e9 }) : 'null');
            let body;
            if (op === 'set') {
                if (['name', 'x', 'y', 'width', 'height', 'background', 'autoNest'].every((k) => a[k] === undefined)) throw new Error('Give name, x, y, width, height, background or autoNest');
                const moved = ['x', 'y', 'width', 'height'].some((k) => a[k] !== undefined);
                body = `
    var items = __onlyArtboards(__targets(doc, ${spec})), out = [];
    ${a.name !== undefined ? 'if (items.length > 1) throw new Error("Rename one artboard at a time");' : ''}
    for (var i = 0; i < items.length; i++) {
      var l = items[i], cur = __abRect(l), rect = null;
      ${moved ? `var nx = ${coord('x')}, ny = ${coord('y')}, nw = ${coord('width')}, nh = ${coord('height')};
      if (nx === null) nx = cur[0];
      if (ny === null) ny = cur[1];
      if (nw === null) nw = cur[2] - cur[0];
      if (nh === null) nh = cur[3] - cur[1];
      rect = [nx, ny, nx + nw, ny + nh];` : ''}
      ${a.name !== undefined ? `l.name = ${str(a.name)};` : ''}
      __editArtboard(l, rect, ${backgroundSpec(a.background)}, ${a.autoNest === undefined ? 'null' : bool(a.autoNest)});
      out.push(__abInfo(l));
    }
    __result__ = { artboards: out };`;
            } else if (op === 'duplicate') {
                body = `
    var items = __onlyArtboards(__targets(doc, ${spec}));
    if (items.length !== 1) throw new Error("Duplicate one artboard at a time");
    var src = items[0], cur = __abRect(src);
    var d = new ActionDescriptor(), r = new ActionReference();
    r.putIdentifier(__c("Lyr "), src.id);
    d.putReference(__c("null"), r);
    ${a.name !== undefined ? `d.putString(__c("Nm  "), ${str(a.name)});` : ''}
    app.executeAction(__s("duplicate"), d, DialogModes.NO);
    var copy = doc.activeLayer;
    ${a.name !== undefined ? `copy.name = ${str(a.name)};` : ''}
    var nx = ${coord('x')}, ny = ${coord('y')};
    if (nx !== null || ny !== null) {
      var now = __abRect(copy);
      if (nx === null) nx = now[0];
      if (ny === null) ny = now[1];
      __editArtboard(copy, [nx, ny, nx + cur[2] - cur[0], ny + cur[3] - cur[1]], null, null);
    }
    __result__ = __abInfo(copy);`;
            } else if (op === 'ungroup') {
                body = `
    var items = __onlyArtboards(__targets(doc, ${spec})), names = [];
    for (var i = 0; i < items.length; i++) {
      names.push(items[i].name);
      __selectLayers([items[i]]);
      __onTarget("ungroupLayersEvent");
    }
    __result__ = { ungrouped: names };`;
            } else if (op === 'clear_guides') {
                body = `
    var items = __onlyArtboards(__targets(doc, ${spec}));
    __selectLayers(items);
    app.executeAction(__s("clearSelectedArtboardGuides"), new ActionDescriptor(), DialogModes.NO);
    __result__ = { cleared: items.length, guides: doc.guides.length };`;
            } else {
                body = `
    var items = __targets(doc, ${spec});
    __selectLayers(items);
    var before = doc.guides.length;
    app.executeAction(__s("newArtboardGuidesFromTarget"), new ActionDescriptor(), DialogModes.NO);
    __result__ = { added: doc.guides.length - before, guides: doc.guides.length };`;
            }
            const labels = { set: 'Edit Artboard', duplicate: 'Duplicate Artboard', ungroup: 'Ungroup Artboards', clear_guides: 'Clear Artboard Guides', guides_from_shape: 'New Artboard Guides' };
            return run('Edit artboards', script(`${AM}${oneState(labels[op], body)}`));
        },
    },
    {
        name: 'create_frame',
        description: 'Put layers inside a frame (Add Frame to Layers) or turn a group into a frame (Add Frame To Layer Group); the frame clips its contents to its shape',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', enum: ['layers', 'group'], description: 'Default layers' },
                target: { ...TARGET_SCHEMA, description: 'layers: the layers to frame. group: the group to convert' },
            },
            required: ['target'],
        },
        auditArgs: { target: { ids: [7] } },
        features: ['photoshop.artboards.frame_from_layers', 'photoshop.artboards.frame_from_group'],
        handler: (a) => {
            const from = enumOf(a.from ?? 'layers', ['layers', 'group'], { name: 'from' });
            return run('Create frame', script(`${AM}
var items = __targets(doc, ${targetSpec(a.target)});
${from === 'group' ? 'if (items.length !== 1 || items[0].typename !== "LayerSet") throw new Error("Give one group");' : ''}
__selectLayers(items);
__onTarget(${str(from === 'group' ? 'framedGroupFromLayerGroupEvent' : 'framedGroupFromLayersEvent')});
__result__ = __layerInfo(doc.activeLayer);`));
        },
    },
    {
        name: 'export_artboards',
        description: 'Save each artboard as its own file, cropped to the artboard with its background, as PNG, JPEG, PSD, TIFF or PDF (File > Export > Artboards to Files), or all of them as one multi-page PDF (Artboards to PDF). The document is not changed',
        inputSchema: {
            type: 'object',
            properties: {
                folder: { type: 'string', description: 'Absolute folder path' },
                format: { type: 'string', enum: Object.keys(EXPORT_FORMATS), description: 'Default png' },
                singlePdf: { type: 'boolean', description: 'pdf: one multi-page PDF instead of one PDF per artboard. Default false' },
                pdfName: { type: 'string', description: 'singlePdf: the PDF file name. Default the document name' },
                prefix: { type: 'string', description: 'Text before each artboard name in the file names' },
                target: { ...TARGET_SCHEMA, description: 'Only these artboards. Default all' },
                includeBackground: { type: 'boolean', description: 'Fill with the artboard background colour (unless it is transparent). Default true' },
            },
            required: ['folder'],
        },
        auditArgs: { format: 'pdf', singlePdf: true, pdfName: 'Boards.pdf', prefix: 'web_', target: { ids: [7] } },
        features: ['photoshop.artboards.artboards_to_files', 'photoshop.artboards.artboards_to_pdf'],
        handler: (a) => {
            const folder = paths.validate(a.folder);
            const format = enumOf(a.format ?? 'png', Object.keys(EXPORT_FORMATS), { name: 'format' });
            if (a.singlePdf && format !== 'pdf') throw new Error("'singlePdf' applies to format pdf");
            if (a.pdfName !== undefined && !a.singlePdf) throw new Error("'pdfName' applies to singlePdf");
            const prefix = a.prefix ?? '';
            if (/[\\/:*?"<>|]/.test(prefix)) throw new Error("'prefix' cannot contain path characters");
            let pdfFile = null;
            if (a.pdfName !== undefined) {
                const n = String(a.pdfName).replace(/\.pdf$/i, '');
                if (!n || /[\\/:*?"<>|]/.test(n)) throw new Error("'pdfName' is a file name without a folder");
                pdfFile = paths.validate(path.join(folder, `${n}.pdf`));
            }
            const [ext, options] = EXPORT_FORMATS[a.singlePdf ? 'psd' : format];
            return run('Export artboards', script(`${AM}
var src = doc;
var boards = ${a.target ? `__onlyArtboards(__targets(doc, ${targetSpec(a.target)}))` : '__artboards(doc)'};
if (!boards.length) throw new Error("The document has no artboards");
var dir = new Folder(${jsxPath(folder)});
if (!dir.exists) dir.create();
${options}
var work = ${a.singlePdf ? 'Folder.temp' : 'dir'}, saved = [];
for (var b = 0; b < boards.length; b++) {
  var ab = boards[b], rect = __abRect(ab), bg = __abBackground(ab), at = -1;
  for (var i = 0; i < src.layers.length; i++) if (src.layers[i].id === ab.id) at = i;
  app.activeDocument = src;
  var copy = src.duplicate(ab.name, false);
  app.activeDocument = copy;
  for (var j = copy.layers.length - 1; j >= 0; j--) if (j !== at) { try { copy.layers[j].allLocked = false; } catch (e) {} copy.layers[j].remove(); }
  __selectLayers([copy.layers[0]]);
  __onTarget("ungroupLayersEvent");
  copy.crop(rect);
  if (${bool(a.includeBackground ?? true)} && bg.type !== 3) {
    var fillColor = new SolidColor();
    var rgb = bg.type === 2 ? [0, 0, 0] : (bg.type === 4 && bg.rgb ? bg.rgb : [255, 255, 255]);
    fillColor.rgb.red = rgb[0]; fillColor.rgb.green = rgb[1]; fillColor.rgb.blue = rgb[2];
    var fl = copy.artLayers.add();
    fl.name = "Artboard Background";
    fl.move(copy.layers[copy.layers.length - 1], ElementPlacement.PLACEAFTER);
    copy.selection.selectAll();
    copy.selection.fill(fillColor);
    copy.selection.deselect();
  }
  var out = new File(work.fsName + "/" + ${str(prefix)} + ab.name.replace(/[\\\\\\/:*?"<>|]/g, "_") + ${str(ext)});
  copy.saveAs(out, o, true, Extension.LOWERCASE);
  copy.close(SaveOptions.DONOTSAVECHANGES);
  saved.push(out);
}
app.activeDocument = src;
${a.singlePdf ? `var base = src.name.lastIndexOf(".") > 0 ? src.name.substring(0, src.name.lastIndexOf(".")) : src.name;
var pdf = ${pdfFile ? `new File(${jsxPath(pdfFile)})` : 'new File(dir.fsName + "/" + base.replace(/[\\\\\\/:*?"<>|]/g, "_") + ".pdf")'};
var po = new PresentationOptions();
po.presentation = false;
po.PDFFileOptions = new PDFSaveOptions();
app.makePDFPresentation(saved, pdf, po);
for (var k = 0; k < saved.length; k++) saved[k].remove();
__result__ = { pdf: pdf.fsName, pages: saved.length };` : `var files = [];
for (var k = 0; k < saved.length; k++) files.push(saved[k].fsName);
__result__ = { files: files };`}`));
        },
    },
];
