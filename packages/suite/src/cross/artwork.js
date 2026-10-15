/**
 * Illustrator artwork into InDesign layouts.
 */
import { num, index, bool, enumOf, jsxPath, formatResponse } from 'adobe-mcp-core';
import { script as illustratorScript } from 'adobe-mcp-illustrator';
import { JSON_FN, runIn } from './jsx.js';

const CROPS = { art: 'CROP_ART', trim: 'CROP_TRIM', bleed: 'CROP_BLEED', media: 'CROP_MEDIA', content: 'CROP_CONTENT_VISIBLE_LAYERS' };

export const placeArtwork = {
    name: 'place_illustrator_artwork_in_indesign',
    requires: ['illustrator', 'indesign'],
    description: 'Place an artboard of the active Illustrator document on a page of the active InDesign document, linked to the .ai file so edits in Illustrator update the layout when the link is updated. The Illustrator document must already be saved as .ai (with "Create PDF Compatible File", Illustrator\'s default). Position and width are millimetres from the InDesign page\'s top-left corner',
    inputSchema: {
        type: 'object',
        properties: {
            artboardIndex: { type: 'integer', minimum: 0, description: 'Illustrator artboard (0-based). Default 0' },
            pageIndex: { type: 'integer', minimum: 0, description: 'InDesign page (0-based)' },
            x: { type: 'number', description: 'mm from the page\'s left edge. Default 10' },
            y: { type: 'number', description: 'mm from the page\'s top edge. Default 10' },
            width: { type: 'number', minimum: 1, description: 'Scale the artwork proportionally to this width in mm. Default: placed at 100%' },
            crop: { type: 'string', enum: Object.keys(CROPS), description: 'Which bounds of the artboard to place: art (the artwork itself, default), trim (the artboard), bleed, media, or content' },
            saveFirst: { type: 'boolean', description: 'Save unsaved changes in the Illustrator document first, so the layout gets the current artwork. Default true' },
        },
        required: ['pageIndex'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(apps, a) {
        const { illustrator, indesign } = apps;
        const ab = Number(index(a.artboardIndex ?? 0, { name: 'artboardIndex', max: 1000 }));
        const saveFirst = a.saveFirst ?? true;

        const source = await runIn(illustrator, illustratorScript(`
var idx = ${ab};
if (idx >= doc.artboards.length) throw new Error("Artboard " + idx + " not found; the Illustrator document has " + doc.artboards.length);
var f = null;
try { f = doc.fullName; } catch (e) { f = null; }
if (!f || !f.exists || !/\\.ai$/i.test(f.name)) throw new Error("Save the Illustrator document as an .ai file first (illustrator_save_document)");
if (!doc.saved) {
  ${bool(saveFirst) === 'true' ? 'doc.save();' : 'throw new Error("The Illustrator document has unsaved changes: save it, or pass saveFirst: true");'}
}
__result__ = { file: f.fsName, artboard: doc.artboards[idx].name, artboards: doc.artboards.length };`));

        const file = indesign.validatePath(source.file);
        const crop = CROPS[enumOf(a.crop ?? 'art', Object.keys(CROPS), { name: 'crop' })];
        const x = num(a.x ?? 10, { name: 'x' });
        const y = num(a.y ?? 10, { name: 'y' });
        const width = a.width === undefined ? null : num(a.width, { min: 1, max: 100000, name: 'width' });

        const placed = await runIn(indesign, `${JSON_FN}
if (app.documents.length === 0) throw new Error("No document open in InDesign");
var doc = app.activeDocument;
var pg = doc.pages.item(${index(a.pageIndex, { name: 'pageIndex' })});
if (!pg.isValid) throw new Error("Page ${Number(a.pageIndex)} not found; the document has " + doc.pages.length + " page(s)");
var file = File(${jsxPath(file)});
if (!file.exists) throw new Error("File not found: " + file.fsName);
var prefs = app.pdfPlacePreferences;
var oldPage = prefs.pageNumber, oldCrop = prefs.pdfCrop, oldBackground = prefs.transparentBackground;
var vp = doc.viewPreferences, oldUnitsH = vp.horizontalMeasurementUnits, oldUnitsV = vp.verticalMeasurementUnits;
var out;
try {
  prefs.pageNumber = ${ab + 1};
  prefs.pdfCrop = PDFCrop.${crop};
  prefs.transparentBackground = true;
  vp.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
  vp.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
  var b = pg.bounds;
  var graphic = pg.place(file, [(b[1] + ${x}) + "mm", (b[0] + ${y}) + "mm"])[0];
  var frame = graphic.parent;
  ${width === null ? '' : `var g = frame.geometricBounds, s = ${width} / (g[3] - g[1]);
  frame.geometricBounds = [g[0], g[1], g[0] + (g[2] - g[0]) * s, g[1] + ${width}];
  frame.fit(FitOptions.PROPORTIONALLY);`}
  var gb = frame.geometricBounds;
  out = { page: pg.name, x: gb[1] - b[1], y: gb[0] - b[0], width: gb[3] - gb[1], height: gb[2] - gb[0], linked: graphic.itemLink.filePath };
} finally {
  prefs.pageNumber = oldPage;
  prefs.pdfCrop = oldCrop;
  prefs.transparentBackground = oldBackground;
  vp.horizontalMeasurementUnits = oldUnitsH;
  vp.verticalMeasurementUnits = oldUnitsV;
}
__json(out);`);

        return formatResponse({ illustrator: source, indesign: placed }, 'Place Illustrator artwork in InDesign');
    },
};
