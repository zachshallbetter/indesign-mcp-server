/**
 * Documents, artboards and layers.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, createPathPolicy, jsxPath } from 'adobe-mcp-core';
import { script, WRITTEN_FN } from '../script.js';
import { run } from '../executor.js';
import { ARTBOARD_SCHEMA, TARGET_SCHEMA, targetSpec, artboardRange, colorSpec } from '../args.js';
import { ART_ON } from './layers.js';

export const paths = createPathPolicy({ envVar: 'ILLUSTRATOR_ALLOWED_DIRS' });

const COLOR_MODES = ['CMYK', 'RGB'];
const EPS_PREVIEWS = { none: 'None', tiff_bw: 'BWTIFF', tiff_color: 'COLORTIFF', tiff_transparent: 'TRANSPARENTCOLORTIFF' };
const AI_ONLY = ['pdfCompatible', 'compressed', 'embedIccProfile', 'fontSubsetThreshold'];
const EPS_ONLY = ['preview', 'postScript', 'embedFonts', 'cmykPostScript', 'compatibleGradientPrinting', 'thumbnails', 'overprint'];
const AI_VERSIONS = { '24': 'ILLUSTRATOR24', '17': 'ILLUSTRATOR17', '16': 'ILLUSTRATOR16', '15': 'ILLUSTRATOR15', '10': 'ILLUSTRATOR10', '8': 'ILLUSTRATOR8', '3': 'ILLUSTRATOR3' };
const LAYOUTS = ['GridByRow', 'GridByCol', 'Row', 'Column', 'RLGridByRow', 'RLGridByCol', 'RLRow'];

const rect = (x, y, w, h) => ({ x, y, width: w, height: h });
const KNOCKOUT = { enabled: 'ENABLED', disabled: 'DISABLED', inherited: 'INHERITED' };
const ORIENTATIONS = ['portrait', 'landscape', 'switch'];

/** Layer Options settings shared by create_layer and set_layer_properties. */
const LAYER_OPTIONS = {
    color: { type: 'string', description: 'Highlight colour of the layer\'s selections and outlines, "#RRGGBB" or "rgb(r,g,b)"' },
    preview: { type: 'boolean', description: 'false shows the layer in Outline mode' },
    dimPlacedImages: { type: 'boolean', description: 'Dim placed images on the layer (Dim Images to). Illustrator uses its own percentage; scripts cannot set it' },
};

/** ES3 statements setting Layer Options on the layer \`l\`. */
function layerOptions(a) {
    const out = [];
    if (a.color !== undefined) {
        const spec = JSON.parse(colorSpec(a.color, 'color'));
        if (spec?.kind !== 'rgb') throw new Error("'color': give a layer colour as \"#RRGGBB\" or \"rgb(r,g,b)\"");
        out.push(`var lc = new RGBColor(); lc.red = ${spec.v[0]}; lc.green = ${spec.v[1]}; lc.blue = ${spec.v[2]}; l.color = lc;`);
    }
    if (a.preview !== undefined) out.push(`l.preview = ${bool(a.preview)};`);
    if (a.dimPlacedImages !== undefined) out.push(`l.dimPlacedImages = ${bool(a.dimPlacedImages)};`);
    return out.join('\n');
}

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
  counts: { pageItems: doc.pageItems.length, paths: doc.pathItems.length, text: doc.textFrames.length, placed: doc.placedItems.length, raster: doc.rasterItems.length, embeddedFiles: doc.embeddedItems.length, nonNative: doc.nonNativeItems.length, plugin: doc.pluginItems.length, groups: doc.groupItems.length, symbols: doc.symbolItems.length, swatches: doc.swatches.length },
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
        description: 'Save the active document. With filePath, save it as an Illustrator (.ai) or Illustrator EPS (.eps) file there; the document then refers to that file. Can also save each artboard to its own file',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute .ai or .eps path. Omit to save in place' },
                compatibility: { type: 'string', enum: Object.keys(AI_VERSIONS), description: 'Illustrator version to save for: 24 = Illustrator 2020 and later (default), 17 = CC, 16 = CS6' },
                separateArtboards: { type: 'boolean', description: 'Also save each artboard to its own file, named after the artboard. Default false', default: false },
                artboards: { type: 'string', description: 'With separateArtboards: the artboards to save, 1-based: "1", "1-3,5". Default all' },
                embedLinkedFiles: { type: 'boolean', description: 'Embed linked images. Default false', default: false },
                pdfCompatible: { type: 'boolean', description: '.ai: embed a PDF-compatible copy so other apps can preview it. Default true', default: true },
                compressed: { type: 'boolean', description: '.ai: compress the file. Default true', default: true },
                embedIccProfile: { type: 'boolean', description: '.ai: embed the document\'s colour profile. Default true', default: true },
                fontSubsetThreshold: { type: 'number', minimum: 0, maximum: 100, description: '.ai: subset embedded fonts when less than this percent of their characters is used. Default 100' },
                preview: { type: 'string', enum: Object.keys(EPS_PREVIEWS), description: '.eps: preview format. Default tiff_color' },
                postScript: { type: 'integer', enum: [2, 3], description: '.eps: PostScript level. Default 3' },
                embedFonts: { type: 'boolean', description: '.eps: include document fonts. Default true', default: true },
                cmykPostScript: { type: 'boolean', description: '.eps: include CMYK PostScript in RGB files. Default true', default: true },
                compatibleGradientPrinting: { type: 'boolean', description: '.eps: rasterise gradients and meshes for older PostScript printers. Default false', default: false },
                thumbnails: { type: 'boolean', description: '.eps: include a thumbnail. Default true', default: true },
                overprint: { type: 'string', enum: ['preserve', 'discard'], description: '.eps: keep or discard overprints. Default preserve' },
            },
        },
        features: [
            'illustrator.documents.save',
            'illustrator.documents.save_as',
            'illustrator.import_export.save_ai',
            'illustrator.import_export.ai_option.version',
            'illustrator.import_export.ai_option.create_pdf_compatible_file',
            'illustrator.import_export.ai_option.include_linked_files',
            'illustrator.import_export.ai_option.use_compression',
            'illustrator.import_export.ai_option.embed_icc_profiles',
            'illustrator.import_export.ai_option.subset_embedded_fonts_when_percent_of_characters_used_is_less_than',
            'illustrator.import_export.ai_option.save_each_artboard_to_a_separate_file',
            'illustrator.import_export.save_artboards_range',
            'illustrator.import_export.save_eps',
            'illustrator.import_export.eps_option.version_eps',
            'illustrator.import_export.eps_option.preview_format',
            'illustrator.import_export.eps_option.adobe_postscript',
            'illustrator.import_export.eps_option.include_document_fonts',
            'illustrator.import_export.eps_option.include_cmyk_postscript_in_rgb_files',
            'illustrator.import_export.eps_option.compatible_gradient_and_gradient_mesh_printing',
            'illustrator.import_export.eps_option.include_document_thumbnails',
            'illustrator.import_export.eps_option.include_linked_files_eps',
            'illustrator.import_export.eps_option.overprints_eps',
            'illustrator.import_export.eps_option.use_artboards_eps',
        ],
        handler: (a) => {
            // Options the caller set to something other than the default.
            const props = tools.find((t) => t.name === 'save_document').inputSchema.properties;
            const given = Object.keys(a).filter((k) => k !== 'filePath' && a[k] !== undefined && a[k] !== props[k]?.default);
            if (!a.filePath) {
                if (given.length) throw new Error(`Saving in place keeps the file's options; pass filePath to use ${given.join(', ')}`);
                return run('Save document', script(`
try { if (!doc.fullName || !doc.fullName.exists) throw 0; } catch (e) { throw new Error("The document has never been saved: pass filePath"); }
doc.save();
__result__ = { saved: true, file: doc.fullName.fsName };`));
            }
            const p = paths.validate(a.filePath);
            const ext = path.extname(p).toLowerCase();
            if (ext !== '.ai' && ext !== '.eps') throw new Error('filePath must end in .ai or .eps');
            const other = ext === '.ai' ? EPS_ONLY : AI_ONLY;
            const wrong = given.filter((k) => other.includes(k));
            if (wrong.length) throw new Error(`${wrong.join(', ')} ${wrong.length > 1 ? 'apply' : 'applies'} only to ${ext === '.ai' ? '.eps' : '.ai'} files`);
            if (a.artboards !== undefined && !a.separateArtboards) throw new Error("'artboards' applies with separateArtboards: true");
            const range = a.artboards === undefined ? '' : artboardRange(a.artboards);
            const lines = ext === '.ai' ? [
                'var o = new IllustratorSaveOptions();',
                `o.pdfCompatible = ${bool(a.pdfCompatible ?? true)};`,
                `o.compressed = ${bool(a.compressed ?? true)};`,
                `o.embedICCProfile = ${bool(a.embedIccProfile ?? true)};`,
                a.fontSubsetThreshold !== undefined ? `o.fontSubsetThreshold = ${num(a.fontSubsetThreshold, { min: 0, max: 100, name: 'fontSubsetThreshold' })};` : '',
            ] : [
                'var o = new EPSSaveOptions();',
                `o.preview = EPSPreview.${EPS_PREVIEWS[enumOf(a.preview ?? 'tiff_color', Object.keys(EPS_PREVIEWS), { name: 'preview' })]};`,
                `o.postScript = EPSPostScriptLevelEnum.LEVEL${enumOf(String(a.postScript ?? 3), ['2', '3'], { name: 'postScript' })};`,
                `o.embedAllFonts = ${bool(a.embedFonts ?? true)};`,
                `o.cmykPostScript = ${bool(a.cmykPostScript ?? true)};`,
                `o.compatibleGradientPrinting = ${bool(a.compatibleGradientPrinting)};`,
                `o.includeDocumentThumbnails = ${bool(a.thumbnails ?? true)};`,
                `o.overprint = PDFOverprint.${enumOf(a.overprint ?? 'preserve', ['preserve', 'discard'], { name: 'overprint' }) === 'preserve' ? 'PRESERVEPDFOVERPRINT' : 'DISCARDPDFOVERPRINT'};`,
            ];
            return run('Save document', script(`${WRITTEN_FN}
var target = new File(${jsxPath(p)}), since = new Date().getTime();
${lines.filter(Boolean).join('\n')}
o.compatibility = Compatibility.${AI_VERSIONS[enumOf(a.compatibility ?? '24', Object.keys(AI_VERSIONS), { name: 'compatibility' })]};
o.embedLinkedFiles = ${bool(a.embedLinkedFiles)};
o.saveMultipleArtboards = ${bool(a.separateArtboards)};
${range ? `o.artboardRange = ${str(range)};` : ''}
doc.saveAs(target, o);
__result__ = { saved: true, file: doc.fullName.fsName, files: ${a.separateArtboards ? `__written(target.parent, "*${ext}", since)` : '[doc.fullName.fsName]'} };`));
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
        description: 'Rename, move or resize an artboard, or switch it between portrait and landscape (Object > Artboards > Switch Orientation). Position is measured from artboard 0\'s top-left corner. scaleArtwork scales and moves the artwork on it with it',
        inputSchema: {
            type: 'object',
            properties: {
                artboardIndex: ARTBOARD_SCHEMA,
                name: { type: 'string' },
                x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
                orientation: { type: 'string', enum: ORIENTATIONS, description: 'Swap width and height to make it portrait or landscape, or switch whichever it is. The top-left corner stays put' },
                scaleArtwork: { type: 'boolean', description: 'Scale and move the artwork whose centre lies on the artboard along with it. Default false', default: false },
            },
            required: ['artboardIndex'],
        },
        features: [
            'illustrator.artboards.artboard_options',
            'illustrator.artboards.artboard_object',
            'illustrator.artboards.rename_artboard',
            'illustrator.artboards.resize_artboard',
            'illustrator.artboards.artboard_move',
            'illustrator.artboards.switch_orientation',
            'illustrator.artboards.scale_artwork_with_artboard',
        ],
        auditArgs: { orientation: 'switch', scaleArtwork: true },
        handler: (a) => {
            const geo = ['x', 'y', 'width', 'height', 'orientation'].some((k) => a[k] !== undefined);
            if (a.scaleArtwork && !geo) throw new Error("'scaleArtwork' applies when x, y, width, height or orientation changes");
            const turn = a.orientation === undefined ? '' : {
                portrait: 'if (w > h) { var t = w; w = h; h = t; }',
                landscape: 'if (h > w) { var t = w; w = h; h = t; }',
                switch: 'var t = w; w = h; h = t;',
            }[enumOf(a.orientation, ORIENTATIONS, { name: 'orientation' })];
            return run('Set artboard', script(`${a.scaleArtwork ? ART_ON : ''}
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })}, cur = __artboard(doc, i), a0 = __artboard(doc, 0), f = __sf(doc), skipped = 0;
${a.name !== undefined ? `doc.artboards[i].name = ${str(a.name)};` : ''}
${geo ? `
var x = ${a.x !== undefined ? num(a.x, { name: 'x' }) : '(cur.left - a0.left) * f'};
var y = ${a.y !== undefined ? num(a.y, { name: 'y' }) : '(a0.top - cur.top) * f'};
var w = ${a.width !== undefined ? num(a.width, { min: 1, name: 'width' }) : '(cur.right - cur.left) * f'};
var h = ${a.height !== undefined ? num(a.height, { min: 1, name: 'height' }) : '(cur.top - cur.bottom) * f'};
${turn}
var p = __toDoc(doc, a0, x, y), old = doc.artboards[i].artboardRect, nr = [p[0], p[1], p[0] + __len(doc, w), p[1] - __len(doc, h)];
${a.scaleArtwork ? 'var art = __artOn(doc, old, true);' : ''}
doc.artboards[i].artboardRect = nr;
${a.scaleArtwork ? 'skipped = __scaleArt(art, old, nr);' : ''}` : ''}
var r = __artboard(doc, i);
__result__ = { index: i, name: r.name, width: (r.right - r.left) * f, height: (r.top - r.bottom) * f${a.scaleArtwork ? ', artworkScaled: art.length - skipped, artworkSkipped: skipped' : ''} };`));
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
        description: 'Resize an artboard to the bounds of the given artwork (Object > Artboards > Fit to Selected Art), or without target, to all the artwork on it (Fit to Artwork Bounds)',
        inputSchema: {
            type: 'object',
            properties: { artboardIndex: ARTBOARD_SCHEMA, target: { ...TARGET_SCHEMA, description: 'Fit to these items. Default: all the artwork on the artboard' } },
            required: ['artboardIndex'],
        },
        features: ['illustrator.artboards.fit_to_selected_art', 'illustrator.artboards.fit_to_artwork_bounds'],
        menuCommands: ['Fit Artboard to artwork bounds'],
        handler: (a) => run('Fit artboard to artwork', script(`
var i = ${index(a.artboardIndex, { name: 'artboardIndex' })};
__artboard(doc, i);
${a.target !== undefined ? `
var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
doc.fitArtboardToSelectedArt(i);` : `
var was = doc.artboards.getActiveArtboardIndex();
doc.artboards.setActiveArtboardIndex(i);
app.executeMenuCommand("Fit Artboard to artwork bounds");
doc.artboards.setActiveArtboardIndex(was);`}
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
        description: 'List top-level layers and their sublayers, with visibility, lock state, Layer Options and item counts',
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
  return { name: l.name, visible: l.visible, locked: l.locked, printable: l.printable, preview: l.preview, dimPlacedImages: l.dimPlacedImages, color: __colorInfo(l.color), opacity: l.opacity, items: l.pageItems.length, sublayers: subs };
}
var out = [];
for (var i = 0; i < doc.layers.length; i++) out.push(info(doc.layers[i]));
__result__ = { active: doc.activeLayer.name, layers: out };`)),
    },
    {
        name: 'create_layer',
        description: 'Create a layer at the top of the stack, or as a sublayer of parentLayer, with the Layer Options settings (Layers panel menu > New Layer, New Layer with Dialog)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parentLayer: { type: 'string', description: 'Create inside this layer' },
                visible: { type: 'boolean', default: true },
                locked: { type: 'boolean', default: false },
                printable: { type: 'boolean', default: true },
                ...LAYER_OPTIONS,
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
            'illustrator.layers.new_layer_dialog',
            'illustrator.layers.layer_option.color',
            'illustrator.layers.layer_option.preview',
            'illustrator.layers.layer_option.dim_images_to',
        ],
        auditArgs: { color: '#4F80FF' },
        handler: (a) => run('Create layer', script(`
var parent = ${a.parentLayer ? `__layer(doc, ${str(a.parentLayer)})` : 'doc'};
var l = parent.layers.add();
l.name = ${str(a.name)};
l.visible = ${bool(a.visible ?? true)};
l.locked = ${bool(a.locked)};
l.printable = ${bool(a.printable ?? true)};
${layerOptions(a)}
__result__ = { name: l.name };`)),
    },
    {
        name: 'set_layer_properties',
        description: 'Rename a layer, show or hide it, lock it, set whether it prints, its opacity, Layer Options (colour, preview, dim images), knockout group, or move it in the stack',
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
                ...LAYER_OPTIONS,
                knockout: { type: 'string', enum: Object.keys(KNOCKOUT), description: 'Knockout Group (Transparency panel): whether the layer\'s objects knock each other out' },
            },
            required: ['layer'],
        },
        features: [
            'illustrator.prepress.nonprintable_artwork',
            'illustrator.layers.layer_options',
            'illustrator.layers.layer_option.name',
            'illustrator.layers.layer_option.show',
            'illustrator.layers.layer_option.lock',
            'illustrator.layers.layer_option.print',
            'illustrator.layers.layer_opacity_blend',
            'illustrator.layers.hide_show_layers',
            'illustrator.layers.lock_unlock_layers',
            'illustrator.layers.layer_zorder',
            'illustrator.layers.layer_option.color',
            'illustrator.layers.layer_option.preview',
            'illustrator.layers.layer_option.dim_images_to',
            'illustrator.layers.layer_knockout',
        ],
        auditArgs: { color: 'rgb(255,77,77)' },
        handler: (a) => run('Set layer properties', script(`
var l = __layer(doc, ${str(a.layer)});
${a.newName !== undefined ? `l.name = ${str(a.newName)};` : ''}
${a.visible !== undefined ? `l.visible = ${bool(a.visible)};` : ''}
${a.locked !== undefined ? `l.locked = ${bool(a.locked)};` : ''}
${a.printable !== undefined ? `l.printable = ${bool(a.printable)};` : ''}
${a.opacity !== undefined ? `l.opacity = ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })};` : ''}
${a.arrange ? `l.zOrder(ZOrderMethod.${enumOf(a.arrange, ['BRINGTOFRONT', 'BRINGFORWARD', 'SENDBACKWARD', 'SENDTOBACK'], { name: 'arrange' })});` : ''}
${layerOptions(a)}
${a.knockout !== undefined ? `l.artworkKnockout = KnockoutState.${KNOCKOUT[enumOf(a.knockout, Object.keys(KNOCKOUT), { name: 'knockout' })]};` : ''}
__result__ = { name: l.name, visible: l.visible, locked: l.locked, printable: l.printable, opacity: l.opacity, preview: l.preview, dimPlacedImages: l.dimPlacedImages, color: __colorInfo(l.color), knockout: String(l.artworkKnockout).replace("KnockoutState.", "") };`)),
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
        description: 'Move items to the top of another layer, or of the active layer when layer is omitted (Object > Arrange > Send to Current Layer)',
        inputSchema: {
            type: 'object',
            properties: { target: TARGET_SCHEMA, layer: { type: 'string', description: 'Top-level layer name. Default the active layer' } },
            required: ['target'],
        },
        features: ['illustrator.layers.move_to_layer', 'illustrator.layers.send_to_current_layer'],
        handler: (a) => run('Move items to layer', script(`
var items = __targets(doc, ${targetSpec(a.target)}), l = __layer(doc, ${str(a.layer)});
if (l.locked) throw new Error("Layer " + l.name + " is locked");
for (var i = items.length - 1; i >= 0; i--) items[i].move(l, ElementPlacement.PLACEATBEGINNING);
__result__ = { moved: items.length, layer: l.name };`)),
    },
];

export { rect };
