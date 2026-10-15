/**
 * Exporting: Save for Web (PNG-24, PNG-8, JPEG, GIF) of the whole document or
 * each layer, optionally resized, without changing the document; Quick Export;
 * layer comps to files or PDF; paths to Illustrator; PDF Presentation; and
 * Generator image assets.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths, saveOptionLines } from './documents.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { optionLines, describeOptions } from '../options.js';

const FORMATS = { png: 'png', png8: 'png', jpeg: 'jpg', gif: 'gif' };
const REDUCTION = { perceptual: 'PERCEPTUAL', selective: 'SELECTIVE', adaptive: 'ADAPTIVE', restrictive: 'RESTRICTIVE' };
const DITHER = { none: 'NONE', diffusion: 'DIFFUSION', pattern: 'PATTERN', noise: 'NOISE' };

const OPTIONS = {
    format: { type: 'string', enum: Object.keys(FORMATS), description: 'png (PNG-24), png8, jpeg or gif. Default png' },
    width: { type: 'number', minimum: 1, maximum: 30000, description: 'Resize the export to this width in pixels (height follows)' },
    height: { type: 'number', minimum: 1, maximum: 30000, description: 'Resize the export to this height in pixels (width follows)' },
    quality: { type: 'integer', minimum: 0, maximum: 100, description: 'JPEG quality, 0-100. Default 80' },
    colors: { type: 'integer', minimum: 2, maximum: 256, description: 'PNG-8 and GIF colours. Default 256' },
    colorReduction: { type: 'string', enum: Object.keys(REDUCTION), description: 'PNG-8 and GIF. Default selective' },
    dither: { type: 'string', enum: Object.keys(DITHER), description: 'PNG-8 and GIF. Default diffusion' },
    transparency: { type: 'boolean', description: 'Keep transparency (PNG, GIF). Default true' },
    interlaced: { type: 'boolean', description: 'Default false' },
    includeProfile: { type: 'boolean', description: 'Embed the colour profile. Default false' },
    blur: { type: 'number', minimum: 0, maximum: 2, description: 'JPEG: blur before compressing, 0-2 pixels, to make the file smaller' },
    lossy: { type: 'integer', minimum: 0, maximum: 100, description: 'GIF: lossy compression, 0-100' },
    webSnap: { type: 'integer', minimum: 0, maximum: 100, description: 'PNG-8 and GIF: shift colours to web-safe ones within this tolerance, percent' },
};

/** ES3 statements building Save for Web options as `o`. */
function webOptionLines(a) {
    const fmt = enumOf(a.format ?? 'png', Object.keys(FORMATS), { name: 'format' });
    const lines = ['var o = new ExportOptionsSaveForWeb();'];
    const set = (p, v) => lines.push(`o.${p} = ${v};`);
    if (fmt === 'png' || fmt === 'png8') { set('format', 'SaveDocumentType.PNG'); set('PNG8', String(fmt === 'png8')); }
    if (fmt === 'jpeg') { set('format', 'SaveDocumentType.JPEG'); set('quality', index(a.quality ?? 80, { name: 'quality', max: 100 })); set('optimized', 'true'); }
    if (fmt === 'gif') set('format', 'SaveDocumentType.COMPUSERVEGIF');
    if (fmt === 'png8' || fmt === 'gif') {
        set('colors', index(a.colors ?? 256, { name: 'colors', max: 256 }));
        set('colorReduction', `ColorReductionType.${REDUCTION[enumOf(a.colorReduction ?? 'selective', Object.keys(REDUCTION), { name: 'colorReduction' })]}`);
        set('dither', `Dither.${DITHER[enumOf(a.dither ?? 'diffusion', Object.keys(DITHER), { name: 'dither' })]}`);
    }
    if (fmt !== 'jpeg') set('transparency', bool(a.transparency ?? true));
    set('interlaced', bool(a.interlaced));
    set('includeProfile', bool(a.includeProfile));
    if (a.blur !== undefined) {
        if (fmt !== 'jpeg') throw new Error('blur is for JPEG');
        set('blur', num(a.blur, { min: 0, max: 2, name: 'blur' }));
    }
    if (a.lossy !== undefined) {
        if (fmt !== 'gif') throw new Error('lossy is for GIF');
        set('lossy', index(a.lossy, { name: 'lossy', max: 100 }));
    }
    if (a.webSnap !== undefined) {
        if (fmt !== 'png8' && fmt !== 'gif') throw new Error('webSnap is for PNG-8 and GIF');
        set('webSnap', index(a.webSnap, { name: 'webSnap', max: 100 }));
    }
    return { fmt, ext: FORMATS[fmt], lines: lines.join('\n') };
}

/** ES3: resize the working copy in variable `v` to the requested width or height. */
function resizeLines(a, v = 'd') {
    if (a.width !== undefined && a.height !== undefined) throw new Error('Give width or height, not both: the other follows the aspect ratio');
    if (a.width !== undefined) return `${v}.resizeImage(new UnitValue(${num(a.width, { min: 1, max: 30000, name: 'width' })}, "px"), undefined, undefined, ResampleMethod.AUTOMATIC);`;
    if (a.height !== undefined) return `${v}.resizeImage(undefined, new UnitValue(${num(a.height, { min: 1, max: 30000, name: 'height' })}, "px"), undefined, ResampleMethod.AUTOMATIC);`;
    return '';
}

/** ES3: select the target layers (by id) so a command acts on them. */
function selectLayersLines(target) {
    return `var sel = __targets(doc, ${targetSpec(target)}), sr = new ActionReference();
for (var si = 0; si < sel.length; si++) sr.putIdentifier(app.stringIDToTypeID("layer"), sel[si].id);
var sd = new ActionDescriptor();
sd.putReference(app.stringIDToTypeID("null"), sr);
sd.putBoolean(app.stringIDToTypeID("makeVisible"), false);
app.executeAction(app.stringIDToTypeID("select"), sd, DialogModes.NO);`;
}

const COMP_TYPES = { psd: '.psd', tiff: '.tif', jpeg: '.jpg', png: '.png', pdf: '.pdf' };
const TRANSITIONS = { none: 'NONE', blinds_horizontal: 'BLINDSHORIZONTAL', blinds_vertical: 'BLINDSVERTICAL', box_in: 'BOXIN', box_out: 'BOXOUT', dissolve: 'DISSOLVE', glitter_down: 'GLITTERDOWN', glitter_right: 'GLITTERRIGHT', glitter_right_down: 'GLITTERRIGHTDOWN', random: 'RANDOM', split_horizontal_in: 'SPLITHORIZONTALIN', split_horizontal_out: 'SPLITHORIZONTALOUT', split_vertical_in: 'SPLITVERTICALIN', split_vertical_out: 'SPLITVERTICALOUT', wipe_down: 'WIPEDOWN', wipe_left: 'WIPELEFT', wipe_right: 'WIPERIGHT', wipe_up: 'WIPEUP' };

/** PDF Presentation options (PresentationOptions), by parameter name. */
const PRESENTATION = {
    slideshow: { kind: 'bool', prop: 'presentation', description: 'A full-screen slideshow instead of a multi-page document. Default false', default: false },
    advanceSeconds: { kind: 'num', prop: 'interval', min: 1, max: 3600, description: 'Slideshow: advance every this many seconds' },
    loop: { kind: 'bool', description: 'Slideshow: loop after the last page' },
    transition: { kind: 'enum', type: 'TransitionType', values: TRANSITIONS, description: 'Slideshow: transition between pages' },
    includeFilename: { kind: 'bool', description: 'Print each file\'s name on its page' },
    magnification: { kind: 'enum', type: 'MagnificationType', values: { fit_page: 'FITPAGE', actual_size: 'ACTUALSIZE' }, description: 'Slideshow: page view' },
};

/** Generator asset layer names: each comma-separated part ends in an image file extension, optionally with quality. */
const ASSET_NAME = /\.(png(8|24|32)?|jpe?g([1-9]|10|\d{1,3}%)?|gif|svg|webp)$/i;

/** ES3 for a PDF Presentation's options as `po`, PDF options included. */
function presentationLines(a) {
    const opts = Object.fromEntries(Object.keys(PRESENTATION).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
    if (opts.advanceSeconds !== undefined) opts.autoAdvance = true;
    const table = { ...PRESENTATION, autoAdvance: { kind: 'bool' } };
    return `var po = new PresentationOptions();
${optionLines(table, opts, { name: 'presentation', target: 'po' })}
${saveOptionLines('.pdf', { preset: a.pdfPreset, standard: a.pdfStandard, options: a.pdfOptions })}
po.PDFFileOptions = o;`;
}

export const tools = [
    {
        name: 'export_image',
        description: 'Export the document as one PNG, PNG-8, JPEG or GIF file (Save for Web), optionally resized. Works on a temporary copy, so the document is unchanged',
        inputSchema: { type: 'object', properties: { outputFile: { type: 'string', description: 'Absolute path; the extension must match the format' }, ...OPTIONS }, required: ['outputFile'] },
        hints: { idempotent: true },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/audit.jpg`, format: 'jpeg', height: undefined, blur: 0.5, lossy: undefined, webSnap: undefined },
        features: ['photoshop.import_export.sfw_blur', 'photoshop.import_export.sfw_lossy', 'photoshop.import_export.sfw_web_snap', 'photoshop.import_export.save_for_web', 'photoshop.import_export.sfw_format', 'photoshop.import_export.sfw_quality', 'photoshop.import_export.sfw_color_reduction', 'photoshop.import_export.sfw_dither', 'photoshop.import_export.sfw_transparency', 'photoshop.import_export.sfw_interlaced', 'photoshop.import_export.sfw_profile', 'photoshop.import_export.format_png', 'photoshop.import_export.format_jpeg', 'photoshop.import_export.format_gif'],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            const { ext, lines } = webOptionLines(a);
            const got = path.extname(out).toLowerCase().replace('.jpeg', '.jpg');
            if (got !== `.${ext}`) throw new Error(`outputFile must end in .${ext} for this format`);
            return run('Export image', script(`
${lines}
var d = doc.duplicate(doc.name + " export", false);
try {
  ${resizeLines(a)}
  var f = new File(${jsxPath(out)});
  d.exportDocument(f, ExportType.SAVEFORWEB, o);
  __result__ = { exported: f.fsName, width: __px(d.width), height: __px(d.height) };
} finally {
  d.close(SaveOptions.DONOTSAVECHANGES);
  app.activeDocument = doc;
}`));
        },
    },
    {
        name: 'export_layers',
        description: 'Export each top-level layer or group (or the ones chosen) to its own file, named <prefix><layer name>.<ext>, by showing one at a time on a temporary copy (File > Export > Layers to Files)',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                ids: { type: 'array', items: { type: 'integer' }, description: 'Top-level layer or group ids. Default all visible ones' },
                prefix: { type: 'string', description: 'File name prefix' },
                trim: { type: 'boolean', description: 'Trim each export to the layer\'s pixels. Default false', default: false },
                ...OPTIONS,
            },
            required: ['outputFolder'],
        },
        hints: { idempotent: true },
        auditArgs: { format: 'png8', height: undefined, trim: true, blur: undefined, lossy: undefined },
        features: ['photoshop.import_export.sfw_blur', 'photoshop.import_export.sfw_lossy', 'photoshop.import_export.sfw_web_snap', 'photoshop.import_export.export_layers_to_files', 'photoshop.import_export.sfw_format', 'photoshop.import_export.sfw_quality', 'photoshop.import_export.sfw_color_reduction', 'photoshop.import_export.sfw_dither', 'photoshop.import_export.sfw_transparency', 'photoshop.import_export.sfw_interlaced', 'photoshop.import_export.sfw_profile'],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const { ext, lines } = webOptionLines(a);
            const ids = (a.ids ?? []).map((id) => Number(index(id, { name: 'ids' })));
            return run('Export layers', script(`
${lines}
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
var wanted = ${json(ids)}, files = [];
var d = doc.duplicate(doc.name + " export", false);
try {
  var top = [];
  for (var i = 0; i < d.layers.length; i++) {
    var l = d.layers[i];
    if (wanted.length ? (function (id) { for (var w = 0; w < wanted.length; w++) if (wanted[w] === id) return true; return false; })(doc.layers[i].id) : l.visible) top.push(i);
  }
  if (!top.length) throw new Error("No layers to export");
  for (var t = 0; t < top.length; t++) {
    for (var j = 0; j < d.layers.length; j++) d.layers[j].visible = (j === top[t]);
    var copy = d.duplicate(d.name + " layer", false);
    try {
      ${a.trim ? 'try { copy.trim(TrimType.TRANSPARENT); } catch (e) {}' : ''}
      ${resizeLines(a, 'copy')}
      var safe = String(doc.layers[top[t]].name).replace(/[\\\\/:*?"<>|]/g, "_");
      var f = new File(folder.fsName + "/" + ${str(a.prefix ?? '')} + safe + ".${ext}");
      copy.exportDocument(f, ExportType.SAVEFORWEB, o);
      files.push(f.fsName);
    } finally { copy.close(SaveOptions.DONOTSAVECHANGES); }
  }
} finally {
  d.close(SaveOptions.DONOTSAVECHANGES);
  app.activeDocument = doc;
}
__result__ = { files: files };`));
        },
    },
    {
        name: 'quick_export',
        description: 'Quick Export the whole document, or chosen layers, groups or artboards, as PNG, JPG or GIF into a folder in one step (File > Export > Quick Export As; Layers panel > Quick Export As). Files are named after the document or each layer',
        inputSchema: {
            type: 'object',
            properties: {
                outputFolder: { type: 'string', description: 'Absolute folder path' },
                fileType: { type: 'string', enum: ['png', 'jpg', 'gif'], description: 'Default png' },
                quality: { type: 'integer', minimum: 1, maximum: 100, description: 'JPG quality, 1-100. Default 90' },
                includeMetadata: { type: 'boolean', description: 'Include copyright and contact metadata. Default false' },
                sRGB: { type: 'boolean', description: 'Convert to sRGB. Default true' },
                layers: { ...TARGET_SCHEMA, description: `Export these layers, groups or artboards, each to its own file. ${TARGET_SCHEMA.description}. Default: the whole document` },
            },
            required: ['outputFolder'],
        },
        hints: { idempotent: true },
        auditArgs: { fileType: 'jpg', layers: { ids: [3, 4] } },
        features: ['photoshop.import_export.quick_export', 'photoshop.import_export.quick_export_layers'],
        handler: (a) => {
            const folder = paths.validate(a.outputFolder);
            const type = enumOf(a.fileType ?? 'png', ['png', 'jpg', 'gif'], { name: 'fileType' });
            if (a.quality !== undefined && type !== 'jpg') throw new Error('quality is for jpg');
            // PNG and GIF pass 32, as Adobe's and emptykid's published calls do; JPG passes its quality.
            const quality = type === 'jpg' ? num(a.quality ?? 90, { min: 1, max: 100, name: 'quality' }) : '32';
            const S = (id) => `app.stringIDToTypeID(${str(id)})`;
            return run('Quick export', script(`
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${a.layers !== undefined ? selectLayersLines(a.layers) : ''}
var d = new ActionDescriptor();
${a.layers !== undefined ? `var tr = new ActionReference();
tr.putEnumerated(${S('layer')}, ${S('ordinal')}, ${S('targetEnum')});
d.putReference(${S('null')}, tr);` : ''}
d.putString(${S('fileType')}, ${str(type)});
d.putInteger(${S('quality')}, ${quality});
d.putInteger(${S('metadata')}, ${a.includeMetadata ? 1 : 0});
d.putString(${S('destFolder')}, folder.fsName);
d.putBoolean(${S('sRGB')}, ${bool(a.sRGB ?? true)});
d.putBoolean(${S('openWindow')}, false);
app.executeAction(${S(a.layers !== undefined ? 'exportSelectionAsFileTypePressed' : 'exportDocumentAsFileTypePressed')}, d, DialogModes.NO);
__result__ = { exported: folder.fsName, fileType: ${str(type)}${a.layers !== undefined ? ', layers: sel.length' : ''} };`));
        },
    },
    {
        name: 'export_layer_comps',
        description: 'Export layer comps, each to its own file (File > Export > Layer Comps to Files) or as the pages of one PDF (Layer Comps to PDF). The document is returned to its state before the export',
        inputSchema: {
            type: 'object',
            properties: {
                to: { type: 'string', enum: ['files', 'pdf'], description: 'Default files' },
                outputFolder: { type: 'string', description: 'files: absolute folder path' },
                outputFile: { type: 'string', description: 'pdf: absolute path ending in .pdf' },
                comps: { type: 'array', items: { type: 'string' }, description: 'Layer comp names. Default all' },
                fileType: { type: 'string', enum: Object.keys(COMP_TYPES), description: 'files: psd, tiff, jpeg (default), png or pdf' },
                quality: { type: 'integer', minimum: 0, maximum: 12, description: 'JPEG quality, 0-12. Default 10' },
                prefix: { type: 'string', description: 'files: file name prefix; each file is <prefix><comp name>' },
                ...Object.fromEntries(Object.entries(PRESENTATION).map(([k, s]) => [k, { type: s.kind === 'bool' ? 'boolean' : s.kind === 'num' ? 'number' : 'string', ...(s.values ? { enum: Object.keys(s.values) } : {}), description: `pdf: ${s.description}` }])),
            },
        },
        hints: { idempotent: true },
        auditArgs: { to: 'files', outputFile: undefined, fileType: 'jpeg', comps: ['Home', 'About'], slideshow: undefined, advanceSeconds: undefined, loop: undefined, transition: undefined, includeFilename: undefined, magnification: undefined },
        features: ['photoshop.import_export.layer_comps_to_files', 'photoshop.import_export.layer_comps_to_pdf'],
        handler: (a) => {
            const to = enumOf(a.to ?? 'files', ['files', 'pdf'], { name: 'to' });
            const names = (a.comps ?? []).map(String);
            const pick = `var wanted = ${json(names)}, comps = [];
for (var i = 0; i < doc.layerComps.length; i++) {
  var c = doc.layerComps[i], keep = !wanted.length;
  for (var w = 0; w < wanted.length; w++) if (wanted[w] === c.name) keep = true;
  if (keep) comps.push(c);
}
for (var m = 0; m < wanted.length; m++) {
  var hit = false;
  for (var n = 0; n < comps.length; n++) if (comps[n].name === wanted[m]) hit = true;
  if (!hit) throw new Error("No layer comp named " + wanted[m]);
}
if (!comps.length) throw new Error("The document has no layer comps");
var start = doc.activeHistoryState, files = [];`;
            if (to === 'files') {
                if (!a.outputFolder) throw new Error('to files needs outputFolder');
                if (a.outputFile !== undefined || Object.keys(PRESENTATION).some((k) => a[k] !== undefined)) throw new Error('outputFile and the slideshow options are for to: pdf');
                const folder = paths.validate(a.outputFolder);
                const ext = COMP_TYPES[enumOf(a.fileType ?? 'jpeg', Object.keys(COMP_TYPES), { name: 'fileType' })];
                if (a.quality !== undefined && ext !== '.jpg') throw new Error('quality is for jpeg');
                return run('Layer comps to files', script(`
var folder = new Folder(${jsxPath(folder)});
if (!folder.exists && !folder.create()) throw new Error("Cannot create " + folder.fsName);
${pick}
try {
  for (var k = 0; k < comps.length; k++) {
    comps[k].apply();
    var f = new File(folder.fsName + "/" + ${str(a.prefix ?? '')} + String(comps[k].name).replace(/[\\\\/:*?"<>|]/g, "_") + ${str(ext)});
    ${saveOptionLines(ext, { quality: a.quality })}
    doc.saveAs(f, o, true, Extension.LOWERCASE);
    files.push(f.fsName);
  }
} finally { doc.activeHistoryState = start; }
__result__ = { files: files };`));
            }
            if (!a.outputFile) throw new Error('to pdf needs outputFile');
            if (a.outputFolder !== undefined || a.fileType !== undefined || a.prefix !== undefined || a.quality !== undefined) throw new Error('outputFolder, fileType, prefix and quality are for to: files');
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.pdf') throw new Error('outputFile must end in .pdf');
            return run('Layer comps to PDF', script(`
${pick}
${presentationLines(a)}
var tmp = new Folder(Folder.temp.fsName + "/ps-comps-" + new Date().getTime());
tmp.create();
try {
  for (var k = 0; k < comps.length; k++) {
    comps[k].apply();
    var f = new File(tmp.fsName + "/" + k + ".psd");
    ${saveOptionLines('.psd', { layers: false }).replace(/\bo\b/g, 'so')}
    doc.saveAs(f, so, true, Extension.LOWERCASE);
    files.push(f);
  }
  var target = new File(${jsxPath(out)});
  app.makePDFPresentation(files, target, po);
} finally {
  doc.activeHistoryState = start;
  for (var r = 0; r < files.length; r++) files[r].remove();
  tmp.remove();
}
__result__ = { exported: target.fsName, pages: comps.length };`));
        },
    },
    {
        name: 'export_paths_to_illustrator',
        description: 'Export paths as an Adobe Illustrator file (File > Export > Paths to Illustrator): all paths, one named path, or just the document bounds',
        inputSchema: {
            type: 'object',
            properties: {
                outputFile: { type: 'string', description: 'Absolute path ending in .ai' },
                paths: { type: 'string', enum: ['all', 'named', 'document_bounds'], description: 'Default all' },
                pathName: { type: 'string', description: 'named: the path\'s name in the Paths panel' },
            },
            required: ['outputFile'],
        },
        hints: { idempotent: true },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/paths.ai`, paths: 'named', pathName: 'Outline' },
        features: ['photoshop.import_export.paths_to_illustrator'],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.ai') throw new Error('outputFile must end in .ai');
            const which = enumOf(a.paths ?? 'all', ['all', 'named', 'document_bounds'], { name: 'paths' });
            if (which === 'named' && !a.pathName) throw new Error('paths: named needs pathName');
            if (which !== 'named' && a.pathName !== undefined) throw new Error('pathName is for paths: named');
            return run('Paths to Illustrator', script(`
var o = new ExportOptionsIllustrator();
o.path = IllustratorPathType.${{ all: 'ALLPATHS', named: 'NAMEDPATH', document_bounds: 'DOCUMENTBOUNDS' }[which]};
${which === 'named' ? `try { doc.pathItems.getByName(${str(a.pathName)}); } catch (e) { throw new Error("No path named " + ${str(a.pathName)}); }
o.pathName = ${str(a.pathName)};` : ''}
var f = new File(${jsxPath(out)});
doc.exportDocument(f, ExportType.ILLUSTRATORPATHS, o);
__result__ = { exported: f.fsName, paths: ${str(which)} };`));
        },
    },
    {
        name: 'make_pdf_presentation',
        description: 'Combine image files into one multi-page PDF or a full-screen PDF slideshow (File > Automate > PDF Presentation), in the order given (a file may repeat), optionally adding the open documents, with slideshow timing, looping and transitions, file names on the pages, and Photoshop PDF save options',
        inputSchema: {
            type: 'object',
            properties: {
                files: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of the source files, in page order' },
                includeOpenFiles: { type: 'boolean', description: 'Add the open documents that have been saved (Add Open Files), after files. Default false' },
                outputFile: { type: 'string', description: 'Absolute path ending in .pdf' },
                ...Object.fromEntries(Object.entries(PRESENTATION).map(([k, s]) => [k, { type: s.kind === 'bool' ? 'boolean' : s.kind === 'num' ? 'number' : 'string', ...(s.values ? { enum: Object.keys(s.values) } : {}), description: s.description }])),
                pdfPreset: { type: 'string', description: 'Adobe PDF preset name, e.g. "[Smallest File Size]"' },
                pdfStandard: { type: 'string', enum: ['none', 'x1a-2001', 'x1a-2003', 'x3-2002', 'x3-2003', 'x4-2008'], description: 'PDF/X standard' },
                pdfOptions: { type: 'object', description: 'Photoshop PDF options, as for save_document\'s PDF options' },
            },
            required: ['outputFile'],
        },
        hints: { idempotent: true },
        auditArgs: { files: [`${process.env.HOME ?? '/tmp'}/Pictures/a.jpg`, `${process.env.HOME ?? '/tmp'}/Pictures/b.jpg`], outputFile: `${process.env.HOME ?? '/tmp'}/Documents/show.pdf`, slideshow: true, advanceSeconds: 5, transition: 'dissolve', magnification: 'fit_page', pdfStandard: undefined, pdfOptions: { compression: 'jpeg_high' } },
        features: ['photoshop.import_export.pdf_presentation', 'photoshop.import_export.pdf_presentation_source', 'photoshop.import_export.pdf_presentation_output', 'photoshop.import_export.pdf_presentation_advance', 'photoshop.import_export.pdf_presentation_transition', 'photoshop.import_export.pdf_presentation_filename', 'photoshop.import_export.pdf_presentation_pdf_options'],
        handler: (a) => {
            const out = paths.validate(a.outputFile);
            if (path.extname(out).toLowerCase() !== '.pdf') throw new Error('outputFile must end in .pdf');
            if (a.files !== undefined && !Array.isArray(a.files)) throw new Error("'files' must be a list of paths");
            const sources = (a.files ?? []).map((f) => paths.validate(f));
            if (!sources.length && !a.includeOpenFiles) throw new Error('Give files, includeOpenFiles: true, or both');
            if (!a.slideshow && ['advanceSeconds', 'loop', 'transition', 'magnification'].some((k) => a[k] !== undefined)) throw new Error('advanceSeconds, loop, transition and magnification are for slideshow: true');
            return run('PDF presentation', script(`
var files = [], paths = ${json(sources.map((p) => p.replace(/\\/g, '/')))};
for (var i = 0; i < paths.length; i++) {
  var f = new File(paths[i]);
  if (!f.exists) throw new Error("File not found: " + f.fsName);
  files.push(f);
}
${a.includeOpenFiles ? `for (var j = 0; j < app.documents.length; j++) { try { files.push(app.documents[j].fullName); } catch (e) {} }` : ''}
if (!files.length) throw new Error("No files to combine");
${presentationLines(a)}
var target = new File(${jsxPath(out)});
app.makePDFPresentation(files, target, po);
__result__ = { exported: target.fsName, pages: files.length };`, { needsDocument: false }));
        },
    },
    {
        name: 'generate_image_assets',
        description: 'Set up Generator image assets (File > Generate > Image Assets): name layers with asset specs such as "icon.png", "200% hero@2x.png24" or "50x50 thumb.jpg80%" so Generator writes them to a folder next to the PSD, set the document-wide defaults layer ("default 200% @2x/"), and turn Image Assets on or off for the document',
        inputSchema: {
            type: 'object',
            properties: {
                assets: {
                    type: 'array',
                    description: 'Layers to name as assets',
                    items: {
                        type: 'object',
                        properties: { id: { type: 'integer', description: 'Layer or group id' }, name: { type: 'string', description: 'Asset spec, comma-separated, each part ending in .png, .png8, .png24, .png32, .jpg (optionally a quality 1-10 or percent), .gif, .svg or .webp' } },
                        required: ['id', 'name'],
                    },
                },
                defaults: { type: 'string', description: 'Document-wide defaults written as an empty layer named "default <defaults>", e.g. "200% @2x/, 50% small/"' },
                toggle: { type: 'boolean', description: 'Switch Image Assets generation on or off for the document (it is a toggle). Default false' },
            },
        },
        auditArgs: { assets: [{ id: 4, name: '200% hero@2x.png24, thumb.jpg80%' }], defaults: '200% @2x/', toggle: true },
        features: ['photoshop.import_export.generate_image_assets', 'photoshop.import_export.generator_layer_naming', 'photoshop.import_export.generator_defaults_layer'],
        handler: (a) => {
            const assets = a.assets ?? [];
            if (!Array.isArray(assets)) throw new Error("'assets' must be a list of { id, name }");
            const named = assets.map((x, i) => {
                const id = Number(num(x?.id, { min: 1, name: `assets[${i}].id` }));
                const name = String(x?.name ?? '').trim();
                const parts = name.split(',').map((p) => p.trim());
                if (!name || parts.some((p) => !ASSET_NAME.test(p))) throw new Error(`assets[${i}].name: each comma-separated part must end in an image extension, e.g. "icon.png" or "thumb.jpg80%": ${JSON.stringify(name)}`);
                return { id, name };
            });
            let defaults = null;
            if (a.defaults !== undefined) {
                defaults = String(a.defaults).trim().replace(/^default\s+/i, '');
                if (!defaults) throw new Error("'defaults' is empty");
            }
            if (!named.length && defaults === null && !a.toggle) throw new Error('Give assets, defaults or toggle: true');
            return run('Image assets', script(`
var named = ${json(named)}, out = [];
for (var i = 0; i < named.length; i++) { var l = __layerById(doc, named[i].id); l.name = named[i].name; out.push({ id: l.id, name: l.name }); }
${defaults !== null ? `var was = doc.activeLayer, dl = null;
for (var j = 0; j < doc.layers.length; j++) if (String(doc.layers[j].name).indexOf("default ") === 0) dl = doc.layers[j];
if (!dl) { dl = doc.artLayers.add(); doc.activeLayer = was; }
dl.name = "default " + ${str(defaults)};
out.push({ id: dl.id, name: dl.name });` : ''}
${a.toggle ? `var g = new ActionDescriptor();
g.putString(app.stringIDToTypeID("name"), "assets");
app.executeAction(app.stringIDToTypeID("generateAssets"), g, DialogModes.NO);` : ''}
__result__ = { layers: out, toggled: ${bool(a.toggle)} };`));
        },
    },
];
