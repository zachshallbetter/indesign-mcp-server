/**
 * Formats Illustrator opens and places, and the PDF and AutoCAD import options
 * that go with them.
 *
 * Illustrator reads import options from app.preferences (PDFFileOptions,
 * AutoCADFileOptions) rather than from arguments to open() or place. Those are
 * persistent application settings, so withImportOptions() sets them for one
 * call and puts the user's values back in a finally block.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf } from 'adobe-mcp-core';
import { artboardRange } from './args.js';

/** Extensions PlacedItems.add and PlacedItem.file accept, as Illustrator's Place lists them. */
export const PLACE_EXTENSIONS = [
    'ai', 'pdf', 'eps', 'epsf', 'ps', 'svg', 'svgz', 'png', 'pns', 'jpg', 'jpe', 'jpeg', 'tif', 'tiff', 'psd', 'pdd',
    'gif', 'bmp', 'rle', 'dib', 'dwg', 'dxf', 'avif', 'cgm', 'cdr', 'emf', 'wmf', 'heic', 'heif',
    'jpf', 'jpx', 'jp2', 'j2k', 'j2c', 'jpc', 'pcx', 'pxr', 'tga', 'vda', 'icb', 'vst', 'webp',
];

/** Extensions Application.open accepts: everything Place takes, plus templates, Word, RTF and text. */
export const OPEN_EXTENSIONS = [...PLACE_EXTENSIONS, 'ait', 'doc', 'docx', 'rtf', 'txt'];

const PDF_BOXES = { bounding: 'PDFBOUNDINGBOX', art: 'PDFARTBOX', crop: 'PDFCROPBOX', trim: 'PDFTRIMBOX', bleed: 'PDFBLEEDBOX', media: 'PDFMEDIABOX' };
export const AUTOCAD_UNITS = { points: 'Points', picas: 'Picas', inches: 'Inches', millimeters: 'Millimeters', centimeters: 'Centimeters', pixels: 'Pixels' };
const AUTOCAD_SCALES = { fit_artboard: 'FitArtboard', original_size: 'OriginalSize', by_value: 'ScaleByValue' };

export const PDF_IMPORT_SCHEMA = {
    type: 'object',
    description: 'PDF files only (the PDF Import Options dialog)',
    properties: {
        page: { type: 'integer', minimum: 1, description: 'The page to open or place, 1-based. Default 1' },
        cropTo: { type: 'string', enum: Object.keys(PDF_BOXES), description: 'Which PDF box bounds the artwork: bounding, art, crop, trim, bleed or media (default)' },
    },
};

/** Opening can also bring in several pages, one artboard each (Illustrator 2023 and later). */
export const PDF_OPEN_SCHEMA = {
    ...PDF_IMPORT_SCHEMA,
    properties: {
        ...PDF_IMPORT_SCHEMA.properties,
        pages: { type: 'string', description: 'Pages to open into one document, one artboard each: "all" or a range like "1-3,5". Instead of page' },
        linkPages: { type: 'boolean', description: 'With pages: bring the pages in as links, which is faster. Illustrator\'s default is true for "all", false otherwise' },
    },
};

export const AUTOCAD_IMPORT_SCHEMA = {
    type: 'object',
    description: 'DWG and DXF files only (the DXF/DWG Options dialog)',
    properties: {
        layout: { type: 'string', description: 'Name of the drawing layout to import. Default the model layout' },
        scale: { type: 'string', enum: Object.keys(AUTOCAD_SCALES), description: 'fit_artboard (default), original_size, or by_value (give scalePercent)' },
        scalePercent: { type: 'number', minimum: 0.001, maximum: 100000, description: 'With scale by_value: the scale to apply' },
        unit: { type: 'string', enum: Object.keys(AUTOCAD_UNITS), description: 'Unit drawing units map to. Default millimeters' },
        unitRatio: { type: 'number', minimum: 0.001, maximum: 100000, description: 'How many of unit one drawing unit equals. Default 1' },
        scaleLineweights: { type: 'boolean', description: 'Scale line weights with the drawing. Default false' },
        center: { type: 'boolean', description: 'Centre the artwork on the artboard. Default true' },
        mergeLayers: { type: 'boolean', description: 'Merge the drawing\'s layers into one. Default false' },
    },
};

/** The lower-case extension of a validated path, without the dot. */
export function extOf(p) {
    return path.extname(p).slice(1).toLowerCase();
}

/**
 * Wrap body so the PDF and AutoCAD import options in `a` apply to it and the
 * user's preferences come back afterwards. `pages` (a page range, open only)
 * is allowed when allowRange is true.
 */
export function withImportOptions(a, ext, body, { allowRange = false } = {}) {
    const sets = [];
    const pdf = a.pdf ?? {};
    const cad = a.autocad ?? {};
    if (Object.keys(pdf).length && ext !== 'pdf') throw new Error("'pdf' options apply only to .pdf files");
    if (Object.keys(cad).length && ext !== 'dwg' && ext !== 'dxf') throw new Error("'autocad' options apply only to .dwg and .dxf files");
    if (pdf.page !== undefined && pdf.pages !== undefined) throw new Error("Give pdf.page or pdf.pages, not both");
    if (pdf.page !== undefined) {
        const page = index(pdf.page, { name: 'pdf.page', max: 100000 });
        if (page === '0') throw new Error("'pdf.page' is 1-based: the first page is 1");
        sets.push(['P', 'pageToOpen', page]);
    }
    if (pdf.pages !== undefined) {
        if (!allowRange) throw new Error("'pdf.pages' applies when opening; place one page with pdf.page");
        const range = /^all$/i.test(String(pdf.pages).trim()) ? 'all' : artboardRange(pdf.pages);
        if (!range) throw new Error("'pdf.pages' must be \"all\" or a range like \"1-3,5\"");
        sets.push(['P', 'pageRangeToOpen', str(range)]);
    }
    if (pdf.linkPages !== undefined) {
        if (pdf.pages === undefined) throw new Error("'pdf.linkPages' applies with pdf.pages");
        sets.push(['P', 'placeAsLinks', bool(pdf.linkPages)]);
    }
    if (pdf.cropTo !== undefined) sets.push(['P', 'pDFCropToBox', `PDFBoxType.${PDF_BOXES[enumOf(pdf.cropTo, Object.keys(PDF_BOXES), { name: 'pdf.cropTo' })]}`]);

    if (cad.scalePercent !== undefined && cad.scale !== 'by_value') throw new Error("'autocad.scalePercent' needs autocad.scale: \"by_value\"");
    if (cad.layout !== undefined) sets.push(['A', 'selectedLayoutName', str(cad.layout)]);
    if (cad.scale !== undefined) sets.push(['A', 'globalScaleOption', `AutoCADGlobalScaleOption.${AUTOCAD_SCALES[enumOf(cad.scale, Object.keys(AUTOCAD_SCALES), { name: 'autocad.scale' })]}`]);
    if (cad.scalePercent !== undefined) sets.push(['A', 'globalScalePercent', num(cad.scalePercent, { min: 0.001, max: 100000, name: 'autocad.scalePercent' })]);
    if (cad.unit !== undefined) sets.push(['A', 'unit', `AutoCADUnit.${AUTOCAD_UNITS[enumOf(cad.unit, Object.keys(AUTOCAD_UNITS), { name: 'autocad.unit' })]}`]);
    if (cad.unitRatio !== undefined) sets.push(['A', 'unitScaleRatio', num(cad.unitRatio, { min: 0.001, max: 100000, name: 'autocad.unitRatio' })]);
    if (cad.scaleLineweights !== undefined) sets.push(['A', 'scaleLineweights', bool(cad.scaleLineweights)]);
    if (cad.center !== undefined) sets.push(['A', 'centerArtwork', bool(cad.center)]);
    if (cad.mergeLayers !== undefined) sets.push(['A', 'mergeLayers', bool(cad.mergeLayers)]);

    if (!sets.length) return body;
    const owner = { P: 'app.preferences.PDFFileOptions', A: 'app.preferences.AutoCADFileOptions' };
    const save = sets.map(([o, prop], i) => `__was[${i}] = ${owner[o]}.${prop};`);
    const apply = sets.map(([o, prop, v]) => `${owner[o]}.${prop} = ${v};`);
    const restore = sets.map(([o, prop], i) => `  try { ${owner[o]}.${prop} = __was[${i}]; } catch (e) {}`);
    return `var __was = [];
${save.join('\n')}
try {
${apply.join('\n')}
${body}
} finally {
${restore.join('\n')}
}`;
}
