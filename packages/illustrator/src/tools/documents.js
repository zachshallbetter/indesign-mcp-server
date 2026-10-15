/**
 * Documents, artboards and layers.
 */
import { str, num, index, bool, enumOf, createPathPolicy, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec } from '../args.js';

export const paths = createPathPolicy({ envVar: 'ILLUSTRATOR_ALLOWED_DIRS' });

const COLOR_MODES = ['CMYK', 'RGB'];
const AI_VERSIONS = { '24': 'ILLUSTRATOR24', '17': 'ILLUSTRATOR17', '16': 'ILLUSTRATOR16', '15': 'ILLUSTRATOR15', '10': 'ILLUSTRATOR10', '8': 'ILLUSTRATOR8', '3': 'ILLUSTRATOR3' };
const LAYOUTS = ['GridByRow', 'GridByCol', 'Row', 'Column', 'RLGridByRow', 'RLGridByCol', 'RLRow'];

const rect = (x, y, w, h) => ({ x, y, width: w, height: h });

export const tools = [
    {
        name: 'get_document_info',
        description: 'Describe the active document: name, file, colour mode, artboards with their sizes, layers, item counts and selection',
        inputSchema: { type: 'object', properties: {} },
        features: [
            'illustrator.documents.document_object',
            'illustrator.documents.document_info_panel',
            'illustrator.documents.document_color_space',
            'illustrator.documents.document_saved_state',
        ],
        handler: () => run('Document info', script(`
var abs = [];
for (var i = 0; i < doc.artboards.length; i++) {
  var a = __artboard(doc, i), f = __sf(doc);
  abs.push({ index: i, name: a.name, width: (a.right - a.left) * f, height: (a.top - a.bottom) * f });
}
var layers = [];
for (var j = 0; j < doc.layers.length; j++) layers.push(doc.layers[j].name);
var file = null;
try { file = doc.fullName ? doc.fullName.fsName : null; } catch (e) { file = null; }
__result__ = {
  name: doc.name, file: file, saved: doc.saved,
  colorMode: String(doc.documentColorSpace).replace("DocumentColorSpace.", ""),
  scaleFactor: __sf(doc), activeArtboard: doc.artboards.getActiveArtboardIndex(),
  artboards: abs, layers: layers, activeLayer: doc.activeLayer.name,
  counts: { pageItems: doc.pageItems.length, paths: doc.pathItems.length, text: doc.textFrames.length, placed: doc.placedItems.length, raster: doc.rasterItems.length, groups: doc.groupItems.length, symbols: doc.symbolItems.length, swatches: doc.swatches.length },
  selection: doc.selection ? doc.selection.length : 0
};`)),
    },
    {
        name: 'list_documents',
        description: 'List the open documents and which one is active',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.documents.document_object', 'illustrator.documents.document_saved_state'],
        handler: () => run('List documents', script(`
var out = [];
for (var i = 0; i < app.documents.length; i++) {
  var d = app.documents[i];
  out.push({ index: i, name: d.name, saved: d.saved, active: d === app.activeDocument });
}
__result__ = out;`, { needsDocument: false })),
    },
    {
        name: 'create_document',
        description: 'Create a document. The colour mode cannot be changed later without converting every colour, so choose CMYK for print and RGB for screen',
        inputSchema: {
            type: 'object',
            properties: {
                colorMode: { type: 'string', enum: COLOR_MODES, description: 'CMYK for print, RGB for screen' },
                width: { type: 'number', description: 'Artboard width in points (72 pt = 1 in). Default 612', default: 612 },
                height: { type: 'number', description: 'Artboard height in points. Default 792', default: 792 },
                artboards: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of artboards. Default 1', default: 1 },
                artboardLayout: { type: 'string', enum: LAYOUTS, description: 'How several artboards are arranged. Default GridByRow' },
                artboardSpacing: { type: 'number', description: 'Space between artboards in points. Default 20' },
                columns: { type: 'integer', minimum: 1, description: 'Columns (or rows, for column layouts) in a grid' },
            },
            required: ['colorMode'],
        },
        features: [
            'illustrator.documents.new',
            'illustrator.documents.new_no_dialog',
            'illustrator.documents.document_object',
            'illustrator.documents.document_color_space',
            'illustrator.documents.newdoc.color_mode',
            'illustrator.documents.newdoc.width',
            'illustrator.documents.newdoc.height',
            'illustrator.documents.newdoc.artboards',
            'illustrator.documents.newdoc.artboard_layout',
            'illustrator.documents.newdoc.artboard_spacing',
            'illustrator.documents.newdoc.artboard_rows_or_columns',
        ],
        handler: (a) => run('Create document', script(`
var d = app.documents.add(DocumentColorSpace.${enumOf(a.colorMode, COLOR_MODES, { name: 'colorMode' })}, ${num(a.width ?? 612, { min: 1, max: 16383, name: 'width' })}, ${num(a.height ?? 792, { min: 1, max: 16383, name: 'height' })}, ${index(a.artboards ?? 1, { name: 'artboards', max: 1000 })}, DocumentArtboardLayout.${enumOf(a.artboardLayout ?? 'GridByRow', LAYOUTS, { name: 'artboardLayout' })}, ${num(a.artboardSpacing ?? 20, { min: 0, max: 10000, name: 'artboardSpacing' })}, ${index(a.columns ?? Math.max(1, Math.ceil(Math.sqrt(a.artboards ?? 1))), { name: 'columns', max: 1000 })});
__result__ = { name: d.name, colorMode: ${str(a.colorMode)}, artboards: d.artboards.length };`, { needsDocument: false })),
    },
    {
        name: 'open_document',
        description: 'Open an .ai, .pdf, .eps or .svg file',
        inputSchema: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute path' } }, required: ['filePath'] },
        features: [
            'illustrator.documents.open',
            'illustrator.import_export.open_ai',
            'illustrator.import_export.open_pdf',
            'illustrator.import_export.open_eps',
            'illustrator.import_export.open_svg',
        ],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            return run('Open document', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = app.open(f);
__result__ = { name: d.name, artboards: d.artboards.length };`, { needsDocument: false }));
        },
    },
    {
        name: 'save_document',
        description: 'Save the active document. With filePath, save it as an Illustrator file there (the document then refers to that file)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .ai path. Omit to save in place' },
                compatibility: { type: 'string', enum: Object.keys(AI_VERSIONS), description: 'Illustrator version to save for: 24 = Illustrator 2020 and later (default), 17 = CC, 16 = CS6' },
                pdfCompatible: { type: 'boolean', description: 'Embed a PDF-compatible copy so other apps can preview it. Default true', default: true },
                embedLinkedFiles: { type: 'boolean', description: 'Embed linked images. Default false', default: false },
            },
        },
        features: [
            'illustrator.documents.save',
            'illustrator.documents.save_as',
            'illustrator.import_export.save_ai',
            'illustrator.import_export.ai_option.version',
            'illustrator.import_export.ai_option.create_pdf_compatible_file',
            'illustrator.import_export.ai_option.include_linked_files',
        ],
        handler: (a) => {
            if (!a.filePath) {
                return run('Save document', script(`
try { if (!doc.fullName || !doc.fullName.exists) throw 0; } catch (e) { throw new Error("The document has never been saved: pass filePath"); }
doc.save();
__result__ = { saved: true, file: doc.fullName.fsName };`));
            }
            const p = paths.validate(a.filePath);
            return run('Save document', script(`
var o = new IllustratorSaveOptions();
o.compatibility = Compatibility.${AI_VERSIONS[enumOf(a.compatibility ?? '24', Object.keys(AI_VERSIONS), { name: 'compatibility' })]};
o.pdfCompatible = ${bool(a.pdfCompatible ?? true)};
o.embedLinkedFiles = ${bool(a.embedLinkedFiles)};
doc.saveAs(new File(${jsxPath(p)}), o);
__result__ = { saved: true, file: doc.fullName.fsName };`));
        },
    },
    {
        name: 'close_document',
        description: 'Close the active document. Unsaved changes are discarded unless save is true',
        inputSchema: { type: 'object', properties: { save: { type: 'boolean', description: 'Save before closing. Default false', default: false } } },
        features: ['illustrator.documents.close'],
        handler: (a) => run('Close document', script(`
var n = doc.name;
doc.close(SaveOptions.${a.save ? 'SAVECHANGES' : 'DONOTSAVECHANGES'});
__result__ = { closed: n };`)),
    },

    // Artboards
    {
        name: 'list_artboards',
        description: 'List artboards with their position and size in points. x and y are measured from artboard 0\'s top-left corner',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.artboards.artboards_panel', 'illustrator.artboards.artboard_object'],
        handler: () => run('List artboards', script(`
var a0 = __artboard(doc, 0), f = __sf(doc), out = [];
for (var i = 0; i < doc.artboards.length; i++) {
  var a = __artboard(doc, i);
  out.push({ index: i, name: a.name, x: (a.left - a0.left) * f, y: (a0.top - a.top) * f, width: (a.right - a.left) * f, height: (a.top - a.bottom) * f });
}
__result__ = { active: doc.artboards.getActiveArtboardIndex(), artboards: out };`)),
    },
    {
        name: 'add_artboard',
        description: 'Add an artboard. x and y are measured from artboard 0\'s top-left corner, in points',
        inputSchema: {
            type: 'object',
            properties: {
                x: { type: 'number' }, y: { type: 'number' },
                width: { type: 'number' }, height: { type: 'number' },
                name: { type: 'string' },
            },
            required: ['x', 'y', 'width', 'height'],
        },
        features: ['illustrator.artboards.add_artboard', 'illustrator.artboards.artboard_object'],
        handler: (a) => run('Add artboard', script(`
var a0 = __artboard(doc, 0), p = __toDoc(doc, a0, ${num(a.x, { name: 'x' })}, ${num(a.y, { name: 'y' })});
var ab = doc.artboards.add([p[0], p[1], p[0] + __len(doc, ${num(a.width, { min: 1, name: 'width' })}), p[1] - __len(doc, ${num(a.height, { min: 1, name: 'height' })})]);
${a.name ? `ab.name = ${str(a.name)};` : ''}
__result__ = { index: doc.artboards.length - 1, name: ab.name };`)),
    },
    {
        name: 'set_artboard',
        description: 'Rename, move or resize an artboard. Position is measured from artboard 0\'s top-left corner',
        inputSchema: {
            type: 'object',
            properties: {
                artboardIndex: ARTBOARD_SCHEMA,
                name: { type: 'string' },
                x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
            },
            required: ['artboardIndex'],
        },
        features: [
            'illustrator.artboards.artboard_options',
            'illustrator.artboards.artboard_object',
            'illustrator.artboards.rename_artboard',
            'illustrator.artboards.resize_artboard',
            'illustrator.artboards.artboard_move',
        ],
        handler: (a) => {
            const geo = ['x', 'y', 'width', 'height'].some((k) => a[k] !== undefined);
            return run('Set artboard', script(`
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })}, cur = __artboard(doc, i), a0 = __artboard(doc, 0), f = __sf(doc);
${a.name !== undefined ? `doc.artboards[i].name = ${str(a.name)};` : ''}
${geo ? `
var x = ${a.x !== undefined ? num(a.x, { name: 'x' }) : '(cur.left - a0.left) * f'};
var y = ${a.y !== undefined ? num(a.y, { name: 'y' }) : '(a0.top - cur.top) * f'};
var w = ${a.width !== undefined ? num(a.width, { min: 1, name: 'width' }) : '(cur.right - cur.left) * f'};
var h = ${a.height !== undefined ? num(a.height, { min: 1, name: 'height' }) : '(cur.top - cur.bottom) * f'};
var p = __toDoc(doc, a0, x, y);
doc.artboards[i].artboardRect = [p[0], p[1], p[0] + __len(doc, w), p[1] - __len(doc, h)];` : ''}
__result__ = { index: i, name: doc.artboards[i].name };`));
        },
    },
    {
        name: 'delete_artboard',
        description: 'Delete an artboard. Its artwork stays on the canvas. The last artboard cannot be deleted',
        inputSchema: { type: 'object', properties: { artboardIndex: ARTBOARD_SCHEMA }, required: ['artboardIndex'] },
        features: ['illustrator.artboards.delete_artboards'],
        handler: (a) => run('Delete artboard', script(`
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })};
__artboard(doc, i);
if (doc.artboards.length === 1) throw new Error("Cannot delete the only artboard");
doc.artboards.remove(i);
__result__ = { deleted: i, remaining: doc.artboards.length };`)),
    },
    {
        name: 'set_active_artboard',
        description: 'Make an artboard active (the one Illustrator\'s artboard commands and menu commands act on)',
        inputSchema: { type: 'object', properties: { artboardIndex: ARTBOARD_SCHEMA }, required: ['artboardIndex'] },
        features: ['illustrator.artboards.artboards_panel', 'illustrator.artboards.select_artboards'],
        handler: (a) => run('Set active artboard', script(`
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })};
__artboard(doc, i);
doc.artboards.setActiveArtboardIndex(i);
__result__ = { active: i };`)),
    },
    {
        name: 'fit_artboard_to_artwork',
        description: 'Resize an artboard to the bounds of the selected artwork',
        inputSchema: { type: 'object', properties: { artboardIndex: ARTBOARD_SCHEMA, target: TARGET_SCHEMA }, required: ['artboardIndex', 'target'] },
        features: ['illustrator.artboards.fit_to_selected_art'],
        handler: (a) => run('Fit artboard to artwork', script(`
var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })};
__artboard(doc, i);
doc.fitArtboardToSelectedArt(i);
var r = __artboard(doc, i), f = __sf(doc);
__result__ = { index: i, width: (r.right - r.left) * f, height: (r.top - r.bottom) * f };`)),
    },
    {
        name: 'rearrange_artboards',
        description: 'Arrange all artboards in a grid, row or column',
        inputSchema: {
            type: 'object',
            properties: {
                layout: { type: 'string', enum: LAYOUTS, description: 'Default GridByRow' },
                columns: { type: 'integer', minimum: 1, description: 'Columns (rows for column layouts). Default 1' },
                spacing: { type: 'number', description: 'Points between artboards. Default 20' },
                moveArtwork: { type: 'boolean', description: 'Move artwork with its artboard. Default true', default: true },
            },
        },
        features: ['illustrator.artboards.rearrange_artboards'],
        handler: (a) => run('Rearrange artboards', script(`
doc.rearrangeArtboards(DocumentArtboardLayout.${enumOf(a.layout ?? 'GridByRow', LAYOUTS, { name: 'layout' })}, ${index(a.columns ?? 1, { name: 'columns', max: 1000 })}, ${num(a.spacing ?? 20, { min: 0, name: 'spacing' })}, ${bool(a.moveArtwork ?? true)});
__result__ = { artboards: doc.artboards.length };`)),
    },

    // Layers
    {
        name: 'list_layers',
        description: 'List top-level layers and their sublayers, with visibility, lock state and item counts',
        inputSchema: { type: 'object', properties: {} },
        features: [
            'illustrator.layers.layers_panel',
            'illustrator.layers.layer_object',
            'illustrator.layers.sublayer_object',
        ],
        handler: () => run('List layers', script(`
function info(l) {
  var subs = [];
  for (var i = 0; i < l.layers.length; i++) subs.push(info(l.layers[i]));
  return { name: l.name, visible: l.visible, locked: l.locked, printable: l.printable, opacity: l.opacity, items: l.pageItems.length, sublayers: subs };
}
var out = [];
for (var i = 0; i < doc.layers.length; i++) out.push(info(doc.layers[i]));
__result__ = { active: doc.activeLayer.name, layers: out };`)),
    },
    {
        name: 'create_layer',
        description: 'Create a layer at the top of the stack, or as a sublayer of parentLayer',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parentLayer: { type: 'string', description: 'Create inside this layer' },
                visible: { type: 'boolean', default: true },
                locked: { type: 'boolean', default: false },
                printable: { type: 'boolean', default: true },
            },
            required: ['name'],
        },
        features: [
            'illustrator.layers.new_layer',
            'illustrator.layers.new_sublayer',
            'illustrator.layers.layer_object',
            'illustrator.layers.sublayer_object',
            'illustrator.layers.layer_option.name',
            'illustrator.layers.layer_option.show',
            'illustrator.layers.layer_option.lock',
            'illustrator.layers.layer_option.print',
        ],
        handler: (a) => run('Create layer', script(`
var parent = ${a.parentLayer ? `__layer(doc, ${str(a.parentLayer)})` : 'doc'};
var l = parent.layers.add();
l.name = ${str(a.name)};
l.visible = ${bool(a.visible ?? true)};
l.locked = ${bool(a.locked)};
l.printable = ${bool(a.printable ?? true)};
__result__ = { name: l.name };`)),
    },
    {
        name: 'set_layer_properties',
        description: 'Rename a layer, show or hide it, lock it, set whether it prints, its opacity, or move it in the stack',
        inputSchema: {
            type: 'object',
            properties: {
                layer: { type: 'string', description: 'Layer name' },
                newName: { type: 'string' },
                visible: { type: 'boolean' },
                locked: { type: 'boolean' },
                printable: { type: 'boolean' },
                opacity: { type: 'number', minimum: 0, maximum: 100 },
                arrange: { type: 'string', enum: ['BRINGTOFRONT', 'BRINGFORWARD', 'SENDBACKWARD', 'SENDTOBACK'] },
            },
            required: ['layer'],
        },
        features: [
            'illustrator.layers.layer_options',
            'illustrator.layers.layer_option.name',
            'illustrator.layers.layer_option.show',
            'illustrator.layers.layer_option.lock',
            'illustrator.layers.layer_option.print',
            'illustrator.layers.layer_opacity_blend',
            'illustrator.layers.hide_show_layers',
            'illustrator.layers.lock_unlock_layers',
            'illustrator.layers.layer_zorder',
        ],
        handler: (a) => run('Set layer properties', script(`
var l = __layer(doc, ${str(a.layer)});
${a.newName !== undefined ? `l.name = ${str(a.newName)};` : ''}
${a.visible !== undefined ? `l.visible = ${bool(a.visible)};` : ''}
${a.locked !== undefined ? `l.locked = ${bool(a.locked)};` : ''}
${a.printable !== undefined ? `l.printable = ${bool(a.printable)};` : ''}
${a.opacity !== undefined ? `l.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};` : ''}
${a.arrange ? `l.zOrder(ZOrderMethod.${enumOf(a.arrange, ['BRINGTOFRONT', 'BRINGFORWARD', 'SENDBACKWARD', 'SENDTOBACK'], { name: 'arrange' })});` : ''}
__result__ = { name: l.name, visible: l.visible, locked: l.locked, printable: l.printable, opacity: l.opacity };`)),
    },
    {
        name: 'set_active_layer',
        description: 'Make a layer active: new artwork goes on it when a tool is not given a layer',
        inputSchema: { type: 'object', properties: { layer: { type: 'string' } }, required: ['layer'] },
        features: ['illustrator.layers.layers_panel'],
        handler: (a) => run('Set active layer', script(`
var l = __layer(doc, ${str(a.layer)});
doc.activeLayer = l;
__result__ = { active: l.name };`)),
    },
    {
        name: 'delete_layer',
        description: 'Delete a layer and everything on it',
        inputSchema: { type: 'object', properties: { layer: { type: 'string' } }, required: ['layer'] },
        features: ['illustrator.layers.delete_layer'],
        handler: (a) => run('Delete layer', script(`
var l = __layer(doc, ${str(a.layer)});
if (doc.layers.length === 1 && l.parent === doc) throw new Error("Cannot delete the only layer");
var n = l.pageItems.length;
l.remove();
__result__ = { deleted: ${str(a.layer)}, itemsRemoved: n };`)),
    },
    {
        name: 'move_items_to_layer',
        description: 'Move items to the top of another layer',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA, layer: { type: 'string' } }, required: ['target', 'layer'] },
        features: ['illustrator.layers.move_to_layer'],
        handler: (a) => run('Move items to layer', script(`
var items = __targets(doc, ${targetSpec(a.target)}), l = __layer(doc, ${str(a.layer)});
if (l.locked) throw new Error("Layer " + l.name + " is locked");
for (var i = items.length - 1; i >= 0; i--) items[i].move(l, ElementPlacement.PLACEATBEGINNING);
__result__ = { moved: items.length, layer: l.name };`)),
    },
];

export { rect };
