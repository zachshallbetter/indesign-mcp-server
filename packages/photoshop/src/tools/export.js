/**
 * Exporting images: Save for Web (PNG-24, PNG-8, JPEG, GIF) of the whole
 * document or each layer, optionally resized, without changing the document.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './documents.js';

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
    return { fmt, ext: FORMATS[fmt], lines: lines.join('\n') };
}

/** ES3: resize the working copy in variable `v` to the requested width or height. */
function resizeLines(a, v = 'd') {
    if (a.width !== undefined && a.height !== undefined) throw new Error('Give width or height, not both: the other follows the aspect ratio');
    if (a.width !== undefined) return `${v}.resizeImage(new UnitValue(${num(a.width, { min: 1, max: 30000, name: 'width' })}, "px"), undefined, undefined, ResampleMethod.AUTOMATIC);`;
    if (a.height !== undefined) return `${v}.resizeImage(undefined, new UnitValue(${num(a.height, { min: 1, max: 30000, name: 'height' })}, "px"), undefined, ResampleMethod.AUTOMATIC);`;
    return '';
}

export const tools = [
    {
        name: 'export_image',
        description: 'Export the document as one PNG, PNG-8, JPEG or GIF file (Save for Web), optionally resized. Works on a temporary copy, so the document is unchanged',
        inputSchema: { type: 'object', properties: { outputFile: { type: 'string', description: 'Absolute path; the extension must match the format' }, ...OPTIONS }, required: ['outputFile'] },
        hints: { idempotent: true },
        auditArgs: { outputFile: `${process.env.HOME ?? '/tmp'}/Documents/audit.jpg`, format: 'jpeg', height: undefined },
        features: [],
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
        auditArgs: { format: 'png8', height: undefined, trim: true },
        features: [],
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
];
