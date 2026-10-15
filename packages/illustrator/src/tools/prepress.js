/**
 * Prepress: overprint, trapping, flattening, trim marks, previews and printing.
 *
 * print_document fills a PrintOptions object page by page, the way the Print
 * dialog is laid out (General, Media, Placement, Marks and Bleed, Output,
 * Graphics, Fonts, Color Management, Advanced). A print preset is the base and
 * the options given override it.
 */
import path from 'node:path';
import { str, num, index, bool, enumOf, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec, artboardRange } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { paths } from './documents.js';
import { playActionStatements } from '../blend.js';
import { flattenAction, FLATTEN_SET, FLATTEN_ACTION } from '../flatten.js';

const LAYERS = { visible_printable: 'VISIBLEPRINTABLELAYERS', visible: 'VISIBLELAYERS', all: 'ALLLAYERS' };
const BOUNDS = { artboard: 'ARTBOARDBOUNDS', artwork: 'ARTWORKBOUNDS', crop: 'CROPBOUNDS' };
const ORIENTATIONS = { auto: 'AUTOROTATE', portrait: 'PORTRAIT', landscape: 'LANDSCAPE', reverse_portrait: 'REVERSEPORTRAIT', reverse_landscape: 'REVERSELANDSCAPE' };
const POSITIONS = {
    center: 'TRANSLATECENTER', top_left: 'TRANSLATETOPLEFT', top: 'TRANSLATETOP', top_right: 'TRANSLATETOPRIGHT', left: 'TRANSLATELEFT',
    right: 'TRANSLATERIGHT', bottom_left: 'TRANSLATEBOTTOMLEFT', bottom: 'TRANSLATEBOTTOM', bottom_right: 'TRANSLATEBOTTOMRIGHT',
};
const TILING = { single_full_page: 'TILESINGLEFULLPAGE', full_pages: 'TILEFULLPAGES', imageable_areas: 'TILEIMAGEABLEAREAS' };
const MARKS = { trim: 'trimMarks', registration: 'registrationMarks', color_bars: 'colorBars', page_info: 'pageInfoMarks' };
const MODES = { composite: 'COMPOSITE', separations: 'HOSTBASEDSEPARATION', in_rip_separations: 'INRIPSEPARATION' };
const COMPRESSION = { none: 'IMAGECOMPRESSIONNONE', rle: 'RLE', jpeg: 'JPEG' };
const FONT_DOWNLOAD = { none: 'DOWNLOADNONE', subset: 'DOWNLOADSUBSET', complete: 'DOWNLOADCOMPLETE' };
const FONT_SUBSTITUTION = { oblique: 'SUBSTITUTEOBLIQUE', tint: 'SUBSTITUTETINT', device: 'SUBSTITUTEDEVICE' };
const PROFILES = { source: 'SOURCEPROFILE', printer: 'PRINTERPROFILE', custom: 'CUSTOMPROFILE' };
const INTENTS = { perceptual: 'PERCEPTUALINTENT', saturation: 'SATURATIONINTENT', relative_colorimetric: 'RELATIVECOLORIMETRIC', absolute_colorimetric: 'ABSOLUTECOLORIMETRIC' };
const INK_STATUS = { print: 'ENABLEINK', skip: 'DISABLEINK', convert: 'CONVERTINK' };

/** Views and panels toggled by toggle_prepress_view, with their menu commands. */
const VIEWS = {
    overprint_preview: 'ink',
    print_tiling: 'pagetiling',
    separations_preview: 'Adobe Separation Preview Panel',
    flattener_preview: 'Adobe Flattening Preview',
    attributes: 'internal palettes posing as plug-in menus-attributes',
};

const RANGE = { type: 'string', description: 'Artboards, 1-based: "1", "1-3,5". Default all' };

/** The Print dialog's pages and their options, as accepted by print_document. */
const PAGES = {
    general: {
        description: 'General: copies, artboards, layers, bounds, job name',
        properties: {
            copies: { type: 'integer', minimum: 1, maximum: 9999 },
            collate: { type: 'boolean' },
            reverseOrder: { type: 'boolean' },
            artboards: RANGE,
            layers: { type: 'string', enum: Object.keys(LAYERS), description: 'Which layers print. Default visible_printable' },
            bounds: { type: 'string', enum: Object.keys(BOUNDS), description: 'artboard; artwork (Ignore Artboards); or crop' },
            printAsBitmap: { type: 'boolean' },
            bitmapResolution: { type: 'number', minimum: 72, maximum: 2400 },
            jobName: { type: 'string' },
        },
    },
    media: {
        description: 'Media: paper size by name, or width and height in points; offset; transverse',
        properties: {
            size: { type: 'string', description: 'Paper size name as the printer lists it, e.g. "A4", "Letter"' },
            width: { type: 'number', minimum: 1 },
            height: { type: 'number', minimum: 1 },
            offset: { type: 'number', minimum: 0 },
            transverse: { type: 'boolean' },
        },
    },
    placement: {
        description: 'Placement and scaling',
        properties: {
            orientation: { type: 'string', enum: Object.keys(ORIENTATIONS) },
            position: { type: 'string', enum: Object.keys(POSITIONS) },
            fitToPage: { type: 'boolean' },
            scaleX: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent' },
            scaleY: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent' },
            tiling: { type: 'string', enum: Object.keys(TILING) },
            emulsionDown: { type: 'boolean', description: 'Flip for emulsion down' },
        },
    },
    marks: {
        description: 'Marks and bleed',
        properties: {
            marks: { type: 'array', items: { type: 'string', enum: [...Object.keys(MARKS), 'all'] }, description: 'Printer\'s marks: trim, registration, color_bars, page_info or all. An empty list removes them' },
            markType: { type: 'string', enum: ['roman', 'japanese'] },
            trimMarkWeight: { type: 'number', minimum: 0.125, maximum: 2, description: 'Points' },
            markOffset: { type: 'number', minimum: 0, maximum: 72, description: 'Distance from the artboard, points, all sides' },
            bleed: { type: 'number', minimum: 0, maximum: 72, description: 'Bleed, points, all sides' },
        },
    },
    output: {
        description: 'Output: composite or separations',
        properties: {
            mode: { type: 'string', enum: Object.keys(MODES) },
            convertSpotColors: { type: 'boolean', description: 'Convert all spot colours to process' },
            overprintBlack: { type: 'boolean' },
            inks: {
                type: 'array',
                description: 'Document Ink Options: per ink (by name, e.g. "Process Cyan" or a spot colour), whether it prints, and its screen frequency and angle. Inks not listed keep the document\'s settings',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        status: { type: 'string', enum: Object.keys(INK_STATUS), description: 'print, skip (do not print), or convert (to process)' },
                        frequency: { type: 'number', minimum: 1, maximum: 1000, description: 'Lines per inch' },
                        angle: { type: 'number', minimum: -360, maximum: 360, description: 'Degrees' },
                    },
                    required: ['name'],
                },
            },
        },
    },
    graphics: {
        description: 'Graphics: PostScript and image data',
        properties: {
            postScriptLevel: { type: 'integer', enum: [1, 2, 3] },
            binary: { type: 'boolean', description: 'Send binary data' },
            compression: { type: 'string', enum: Object.keys(COMPRESSION) },
            compatibleGradientPrinting: { type: 'boolean' },
            forceContinuousTone: { type: 'boolean' },
            negative: { type: 'boolean' },
            shadingResolution: { type: 'number', minimum: 1, maximum: 9600 },
        },
    },
    fonts: {
        description: 'Fonts',
        properties: {
            download: { type: 'string', enum: Object.keys(FONT_DOWNLOAD) },
            substitution: { type: 'string', enum: Object.keys(FONT_SUBSTITUTION) },
        },
    },
    colorManagement: {
        description: 'Color management',
        properties: {
            profile: { type: 'string', enum: Object.keys(PROFILES), description: 'source (the document\'s), printer, or custom (named by profileName)' },
            profileName: { type: 'string' },
            intent: { type: 'string', enum: Object.keys(INTENTS) },
        },
    },
    flattener: {
        description: 'Advanced: transparency flattening. Give a preset, or the settings',
        properties: {
            preset: { type: 'string', description: 'Flattener preset name, e.g. "[High Resolution]"' },
            balance: { type: 'number', minimum: 0, maximum: 100, description: 'Raster/vector balance: 0 all raster, 100 all vector' },
            lineArtResolution: { type: 'number', minimum: 1, maximum: 9600 },
            gradientResolution: { type: 'number', minimum: 1, maximum: 9600 },
            textToOutlines: { type: 'boolean' },
            strokesToOutlines: { type: 'boolean' },
            clipComplexRegions: { type: 'boolean' },
            overprint: { type: 'string', enum: ['preserve', 'discard'] },
        },
    },
};

/** Check one page object: known keys only. */
function page(a, key) {
    const value = a[key];
    if (value === undefined) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${key}' must be an object`);
    const known = Object.keys(PAGES[key].properties);
    const unknown = Object.keys(value).filter((k) => !known.includes(k));
    if (unknown.length) throw new Error(`'${key}' has no option ${unknown.join(', ')}. Options: ${known.join(', ')}`);
    return value;
}

/** Statements that adjust the document's inks and hand them to the separation options. */
function inkLines(inks) {
    if (!Array.isArray(inks) || !inks.length) throw new Error("'output.inks' must list at least one ink");
    const lines = [
        'var __inks = doc.inkList;',
        'var __ink = function (name) { var all = []; for (var i = 0; i < __inks.length; i++) { if (__inks[i].name === name) return __inks[i].inkInfo; all.push(__inks[i].name); } throw new Error("Ink not found: " + name + ". Inks: " + all.join(", ")); };',
    ];
    inks.forEach((ink, i) => {
        if (!ink || typeof ink !== 'object' || typeof ink.name !== 'string' || !ink.name) throw new Error(`output.inks[${i}] needs a name`);
        const unknown = Object.keys(ink).filter((k) => !['name', 'status', 'frequency', 'angle'].includes(k));
        if (unknown.length) throw new Error(`output.inks[${i}] has no option ${unknown.join(', ')}. Options: name, status, frequency, angle`);
        if (ink.status === undefined && ink.frequency === undefined && ink.angle === undefined) throw new Error(`output.inks[${i}]: give status, frequency or angle`);
        const ref = `__ink(${str(ink.name)})`;
        if (ink.status !== undefined) lines.push(`${ref}.printingStatus = InkPrintStatus.${INK_STATUS[enumOf(ink.status, Object.keys(INK_STATUS), { name: `output.inks[${i}].status` })]};`);
        if (ink.frequency !== undefined) lines.push(`${ref}.frequency = ${num(ink.frequency, { min: 1, max: 1000, name: `output.inks[${i}].frequency` })};`);
        if (ink.angle !== undefined) lines.push(`${ref}.angle = ${num(ink.angle, { min: -360, max: 360, name: `output.inks[${i}].angle` })};`);
    });
    lines.push('o.colorSeparationOptions.inkList = __inks;');
    return lines.join('\n');
}

/** PrintOptions statements for the options given; the preset supplies the rest. */
function printOptionLines(a) {
    const lines = [];
    const set = (obj, prop, value) => lines.push(`o.${obj}.${prop} = ${value};`);
    const pick = (value, table, name) => table[enumOf(value, Object.keys(table), { name })];
    const g = page(a, 'general');
    if (g) {
        if (g.copies !== undefined) set('jobOptions', 'copies', index(g.copies, { name: 'general.copies', max: 9999 }));
        if (g.collate !== undefined) set('jobOptions', 'collate', bool(g.collate));
        if (g.reverseOrder !== undefined) set('jobOptions', 'reversePages', bool(g.reverseOrder));
        if (g.artboards !== undefined) {
            const range = artboardRange(g.artboards);
            set('jobOptions', 'printAllArtboards', String(!range));
            if (range) set('jobOptions', 'artboardRange', str(range));
        }
        if (g.layers !== undefined) set('jobOptions', 'designation', `PrintArtworkDesignation.${pick(g.layers, LAYERS, 'general.layers')}`);
        if (g.bounds !== undefined) set('jobOptions', 'printArea', `PrintingBounds.${pick(g.bounds, BOUNDS, 'general.bounds')}`);
        if (g.printAsBitmap !== undefined) set('jobOptions', 'printAsBitmap', bool(g.printAsBitmap));
        if (g.bitmapResolution !== undefined) set('jobOptions', 'bitmapResolution', num(g.bitmapResolution, { min: 72, max: 2400, name: 'general.bitmapResolution' }));
        if (g.jobName !== undefined) set('jobOptions', 'name', str(g.jobName));
    }
    const m = page(a, 'media');
    if (m) {
        if (m.size !== undefined) set('paperOptions', 'name', str(m.size));
        if (m.width !== undefined) set('paperOptions', 'width', num(m.width, { min: 1, name: 'media.width' }));
        if (m.height !== undefined) set('paperOptions', 'height', num(m.height, { min: 1, name: 'media.height' }));
        if (m.offset !== undefined) set('paperOptions', 'offset', num(m.offset, { min: 0, name: 'media.offset' }));
        if (m.transverse !== undefined) set('paperOptions', 'transverse', bool(m.transverse));
    }
    const p = page(a, 'placement');
    if (p) {
        if (p.orientation !== undefined) set('coordinateOptions', 'orientation', `PrintOrientation.${pick(p.orientation, ORIENTATIONS, 'placement.orientation')}`);
        if (p.position !== undefined) set('coordinateOptions', 'position', `PrintPosition.${pick(p.position, POSITIONS, 'placement.position')}`);
        if (p.fitToPage !== undefined) set('coordinateOptions', 'fitToPage', bool(p.fitToPage));
        if (p.scaleX !== undefined) set('coordinateOptions', 'horizontalScale', num(p.scaleX, { min: 1, max: 1000, name: 'placement.scaleX' }));
        if (p.scaleY !== undefined) set('coordinateOptions', 'verticalScale', num(p.scaleY, { min: 1, max: 1000, name: 'placement.scaleY' }));
        if (p.tiling !== undefined) set('coordinateOptions', 'tiling', `PrintTiling.${pick(p.tiling, TILING, 'placement.tiling')}`);
        if (p.emulsionDown !== undefined) set('coordinateOptions', 'emulsion', bool(p.emulsionDown));
    }
    const k = page(a, 'marks');
    if (k) {
        if (k.marks !== undefined) {
            if (!Array.isArray(k.marks)) throw new Error("'marks.marks' must be a list");
            const wanted = new Set(k.marks.map((x) => enumOf(x, [...Object.keys(MARKS), 'all'], { name: 'marks.marks' })));
            for (const [mark, prop] of Object.entries(MARKS)) set('pageMarksOptions', prop, String(wanted.has('all') || wanted.has(mark)));
        }
        if (k.markType !== undefined) set('pageMarksOptions', 'pageMarksType', `PageMarksTypes.${enumOf(k.markType, ['roman', 'japanese'], { name: 'marks.markType' }) === 'roman' ? 'Roman' : 'Japanese'}`);
        if (k.trimMarkWeight !== undefined) set('pageMarksOptions', 'trimMarksWeight', num(k.trimMarkWeight, { min: 0.125, max: 2, name: 'marks.trimMarkWeight' }));
        if (k.markOffset !== undefined) { const v = num(k.markOffset, { min: 0, max: 72, name: 'marks.markOffset' }); set('pageMarksOptions', 'marksOffsetRect', `[${v}, ${v}, ${v}, ${v}]`); }
        if (k.bleed !== undefined) { const v = num(k.bleed, { min: 0, max: 72, name: 'marks.bleed' }); set('pageMarksOptions', 'bleedOffsetRect', `[${v}, ${v}, ${v}, ${v}]`); }
    }
    const out = page(a, 'output');
    if (out) {
        if (out.mode !== undefined) set('colorSeparationOptions', 'colorSeparationMode', `PrintColorSeparationMode.${pick(out.mode, MODES, 'output.mode')}`);
        if (out.convertSpotColors !== undefined) set('colorSeparationOptions', 'convertSpotColors', bool(out.convertSpotColors));
        if (out.overprintBlack !== undefined) set('colorSeparationOptions', 'overPrintBlack', bool(out.overprintBlack));
        if (out.inks !== undefined) lines.push(inkLines(out.inks));
    }
    const gr = page(a, 'graphics');
    if (gr) {
        if (gr.postScriptLevel !== undefined) set('postScriptOptions', 'postScriptLevel', `PrinterPostScriptLevelEnum.PSLEVEL${enumOf(String(gr.postScriptLevel), ['1', '2', '3'], { name: 'graphics.postScriptLevel' })}`);
        if (gr.binary !== undefined) set('postScriptOptions', 'binaryPrinting', bool(gr.binary));
        if (gr.compression !== undefined) set('postScriptOptions', 'imageCompression', `PostScriptImageCompressionType.${pick(gr.compression, COMPRESSION, 'graphics.compression')}`);
        if (gr.compatibleGradientPrinting !== undefined) set('postScriptOptions', 'compatibleShading', bool(gr.compatibleGradientPrinting));
        if (gr.forceContinuousTone !== undefined) set('postScriptOptions', 'forceContinuousTone', bool(gr.forceContinuousTone));
        if (gr.negative !== undefined) set('postScriptOptions', 'negativePrinting', bool(gr.negative));
        if (gr.shadingResolution !== undefined) set('postScriptOptions', 'shadingResolution', num(gr.shadingResolution, { min: 1, max: 9600, name: 'graphics.shadingResolution' }));
    }
    const f = page(a, 'fonts');
    if (f) {
        if (f.download !== undefined) set('fontOptions', 'downloadFonts', `PrintFontDownloadMode.${pick(f.download, FONT_DOWNLOAD, 'fonts.download')}`);
        if (f.substitution !== undefined) set('fontOptions', 'fontSubstitution', `FontSubstitutionPolicy.${pick(f.substitution, FONT_SUBSTITUTION, 'fonts.substitution')}`);
    }
    const c = page(a, 'colorManagement');
    if (c) {
        if (c.profile === 'custom' && c.profileName === undefined) throw new Error("colorManagement.profile custom needs profileName");
        if (c.profile !== undefined) set('colorManagementOptions', 'colorProfileMode', `PrintColorProfile.${pick(c.profile, PROFILES, 'colorManagement.profile')}`);
        if (c.profileName !== undefined) set('colorManagementOptions', 'name', str(c.profileName));
        if (c.intent !== undefined) set('colorManagementOptions', 'intent', `PrintColorIntent.${pick(c.intent, INTENTS, 'colorManagement.intent')}`);
    }
    const fl = page(a, 'flattener');
    if (fl) {
        if (fl.preset !== undefined) lines.push(`o.flattenerPreset = ${str(fl.preset)};`);
        if (fl.balance !== undefined) set('flattenerOptions', 'flatteningBalance', num(fl.balance, { min: 0, max: 100, name: 'flattener.balance' }));
        if (fl.lineArtResolution !== undefined) set('flattenerOptions', 'rasterizationResolution', num(fl.lineArtResolution, { min: 1, max: 9600, name: 'flattener.lineArtResolution' }));
        if (fl.gradientResolution !== undefined) set('flattenerOptions', 'gradientResolution', num(fl.gradientResolution, { min: 1, max: 9600, name: 'flattener.gradientResolution' }));
        if (fl.textToOutlines !== undefined) set('flattenerOptions', 'convertTextToOutlines', bool(fl.textToOutlines));
        if (fl.strokesToOutlines !== undefined) set('flattenerOptions', 'convertStrokesToOutlines', bool(fl.strokesToOutlines));
        if (fl.clipComplexRegions !== undefined) set('flattenerOptions', 'clipComplexRegions', bool(fl.clipComplexRegions));
        if (fl.overprint !== undefined) set('flattenerOptions', 'overprint', `PDFOverprint.${enumOf(fl.overprint, ['preserve', 'discard'], { name: 'flattener.overprint' }) === 'preserve' ? 'PRESERVEPDFOVERPRINT' : 'DISCARDPDFOVERPRINT'}`);
    }
    return lines.join('\n');
}

/** The sub-objects PrintOptions needs before its members can be set. */
const PRINT_OPTION_OBJECTS = {
    jobOptions: 'PrintJobOptions', paperOptions: 'PrintPaperOptions', coordinateOptions: 'PrintCoordinateOptions',
    pageMarksOptions: 'PrintPageMarksOptions', colorSeparationOptions: 'PrintColorSeparationOptions', postScriptOptions: 'PrintPostScriptOptions',
    fontOptions: 'PrintFontOptions', colorManagementOptions: 'PrintColorManagementOptions', flattenerOptions: 'PrintFlattenerOptions',
};

export const tools = [
    {
        name: 'set_overprint',
        description: 'Set Overprint Fill and Overprint Stroke (Attributes panel) on paths, compound paths, groups and text frames, so the colour prints over the inks beneath instead of knocking them out',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                fill: { type: 'boolean', description: 'Overprint the fill' },
                stroke: { type: 'boolean', description: 'Overprint the stroke' },
            },
            required: ['target'],
        },
        features: ['illustrator.prepress.overprint_fill', 'illustrator.prepress.overprint_stroke'],
        handler: (a) => {
            if (a.fill === undefined && a.stroke === undefined) throw new Error('Give fill, stroke or both');
            const pathLines = [], textLines = [];
            if (a.fill !== undefined) { pathLines.push(`p.fillOverprint = ${bool(a.fill)};`); textLines.push(`ca.overprintFill = ${bool(a.fill)};`); }
            if (a.stroke !== undefined) { pathLines.push(`p.strokeOverprint = ${bool(a.stroke)};`); textLines.push(`ca.overprintStroke = ${bool(a.stroke)};`); }
            return run('Set overprint', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, text: 0, skipped: [] };
for (var i = 0; i < items.length; i++) {
  if (items[i].typename === "TextFrame") { var ca = items[i].textRange.characterAttributes; ${textLines.join(' ')} counts.text++; continue; }
  __eachPath(items[i], function (p) { ${pathLines.join(' ')} }, counts);
}
__result__ = counts;`));
        },
    },
    {
        name: 'create_trim_marks',
        description: 'Draw trim marks around the targets\' bounds (Object > Create Trim Marks). The marks are editable artwork',
        inputSchema: { type: 'object', properties: { target: TARGET_SCHEMA }, required: ['target'] },
        features: ['illustrator.prepress.trim_marks', 'illustrator.prepress.crop_marks'],
        menuCommands: ['TrimMark v25'],
        handler: (a) => run('Create trim marks', script(`
var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
app.executeMenuCommand("TrimMark v25");
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { marks: out };`)),
    },
    {
        name: 'make_trap_stroke',
        description: 'Trap paths by hand (spread traps): give each filled path an overprinting stroke in its own fill colour, so the colour spreads into the inks around it by half the stroke weight. Paths with gradient, pattern or no fill are skipped',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                weight: { type: 'number', minimum: 0.01, maximum: 72, description: 'Stroke weight in points; the trap is half of it. Default 0.5' },
                round: { type: 'boolean', description: 'Round caps and joins. Default true' },
            },
            required: ['target'],
        },
        features: ['illustrator.prepress.trapping'],
        hints: { destructive: false, idempotent: true },
        handler: (a) => run('Make trap stroke', script(`${EACH_PATH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, trapped: 0, noSolidFill: 0, skipped: [] };
var solid = { RGBColor: 1, CMYKColor: 1, GrayColor: 1, SpotColor: 1, LabColor: 1 };
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) {
  if (!p.filled || !solid[p.fillColor.typename]) { counts.noSolidFill++; return; }
  p.stroked = true;
  p.strokeColor = p.fillColor;
  p.strokeWidth = ${num(a.weight ?? 0.5, { min: 0.01, max: 72, name: 'weight' })};
  ${(a.round ?? true) ? 'p.strokeCap = StrokeCap.ROUNDENDCAP; p.strokeJoin = StrokeJoin.ROUNDENDJOIN;' : ''}
  p.strokeOverprint = true;
  counts.trapped++;
}, counts);
__result__ = counts;`)),
    },
    {
        name: 'flatten_transparency',
        description: 'Flatten transparency in the targets permanently (Object > Flatten Transparency), without the dialog: transparent artwork becomes opaque vector and raster pieces. Resolution is the one setting offered; the dialog\'s other settings stay at the values published scripts record for this command',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                resolution: { type: 'number', minimum: 72, maximum: 2400, description: 'Resolution for rasterised parts, ppi. Default 300' },
            },
            required: ['target'],
        },
        features: ['illustrator.prepress.flatten_transparency'],
        hints: { destructive: true, idempotent: false },
        auditArgs: { resolution: 300 },
        handler: (a) => {
            const resolution = num(a.resolution ?? 300, { min: 72, max: 2400, name: 'resolution' });
            return run('Flatten transparency', script(`
var items = __targets(doc, ${targetSpec(a.target)});
doc.selection = null;
for (var k = 0; k < items.length; k++) items[k].selected = true;
${playActionStatements(str(flattenAction(resolution)), FLATTEN_SET, FLATTEN_ACTION)}
var sel = doc.selection, out = [];
if (sel && sel.length) for (var j = 0; j < sel.length; j++) out.push(__itemInfo(doc, sel[j]));
__result__ = { flattened: items.length, resolution: ${resolution}, selection: out };`));
        },
    },
    {
        name: 'toggle_prepress_view',
        description: 'Toggle a prepress view or panel: overprint_preview (View > Overprint Preview), print_tiling (View > Show/Hide Print Tiling), separations_preview, flattener_preview or attributes (Window menu panels). Illustrator does not report whether Overprint Preview or a panel is showing, so those simply switch; print_tiling can be set with show',
        inputSchema: {
            type: 'object',
            properties: {
                view: { type: 'string', enum: Object.keys(VIEWS) },
                show: { type: 'boolean', description: 'print_tiling only: show (true) or hide (false) instead of switching' },
            },
            required: ['view'],
        },
        features: [
            'illustrator.prepress.overprint_preview',
            'illustrator.prepress.separations_preview_option.overprint_preview',
            'illustrator.prepress.show_print_tiling',
            'illustrator.prepress.separations_preview',
            'illustrator.prepress.flattener_preview',
            'illustrator.prepress.attributes_panel',
        ],
        menuCommands: Object.values(VIEWS),
        hints: { destructive: false, idempotent: false },
        auditArgs: { view: 'print_tiling', show: true },
        handler: (a) => {
            const view = enumOf(a.view, Object.keys(VIEWS), { name: 'view' });
            if (a.show !== undefined && view !== 'print_tiling') throw new Error("'show' applies to print_tiling only; the other views can only be switched");
            const command = str(VIEWS[view]);
            return run('Toggle prepress view', script(view === 'print_tiling' ? `
var before = doc.printTiles;
if (${a.show === undefined ? 'true' : `before !== ${bool(a.show)}`}) app.executeMenuCommand(${command});
__result__ = { view: "print_tiling", showing: doc.printTiles, changed: doc.printTiles !== before };` : `
app.executeMenuCommand(${command});
__result__ = { view: ${str(view)}, toggled: true };`));
        },
    },
    {
        name: 'list_print_settings',
        description: 'List what printing can use: printers with their capabilities, PPD files, print presets, transparency flattener presets and PDF presets',
        inputSchema: { type: 'object', properties: {} },
        features: [
            'illustrator.prepress.printer_info',
            'illustrator.prepress.ppd_files',
            'illustrator.prepress.print_presets',
            'illustrator.prepress.flattener_presets',
            'illustrator.import_export.pdf_presets',
        ],
        handler: () => run('List print settings', script(`
function names(list) { var out = []; if (list) for (var i = 0; i < list.length; i++) out.push(list[i].name !== undefined ? list[i].name : String(list[i])); return out; }
var printers = [], list = app.printerList;
for (var i = 0; i < list.length; i++) {
  var info = { name: list[i].name };
  try {
    var pi = list[i].printerInfo;
    info.type = String(pi.printerType).replace("PrinterTypeEnum.", "");
    info.color = String(pi.colorSupport).replace("PrinterColorMode.", "");
    info.postScriptLevel = String(pi.postScriptLevel).replace("PrinterPostScriptLevelEnum.", "");
    info.resolution = pi.deviceResolution;
    info.customPaper = pi.customPaperSupport;
    info.inRipSeparations = pi.inRIPSeparationSupport;
  } catch (e) {}
  printers.push(info);
}
__result__ = {
  printers: printers,
  ppdFiles: names(app.PPDFileList),
  printPresets: names(app.printPresetsList),
  flattenerPresets: names(app.flattenerPresetsList),
  pdfPresets: names(app.PDFPresetsList)
};`, { needsDocument: false })),
    },
    {
        name: 'print_document',
        description: 'Print the active document to a printer, or to a PostScript file with outputFile. A print preset is the base; options are grouped like the Print dialog\'s pages and override it',
        inputSchema: {
            type: 'object',
            properties: {
                printer: { type: 'string', description: 'Printer name from list_print_settings. Default the preset\'s or the system default' },
                outputFile: { type: 'string', description: 'Absolute .ps path: print to this file instead of sending the job to the printer' },
                preset: { type: 'string', description: 'Print preset name from list_print_settings' },
                ppd: { type: 'string', description: 'PPD name for a PostScript printer' },
                ...Object.fromEntries(Object.entries(PAGES).map(([key, { description, properties }]) => [key, { type: 'object', description, properties }])),
            },
        },
        features: [
            'illustrator.prepress.print',
            'illustrator.prepress.print_option.print_preset',
            'illustrator.prepress.print_option.printer',
            'illustrator.prepress.print_option.ppd',
            'illustrator.prepress.print_general.copies',
            'illustrator.prepress.print_general.collate',
            'illustrator.prepress.print_general.reverse_order',
            'illustrator.prepress.print_general.artboards_all',
            'illustrator.prepress.print_general.artboards_range',
            'illustrator.prepress.print_general.print_layers',
            'illustrator.prepress.print_general.ignore_artboards_printing_bounds',
            'illustrator.prepress.print_general.print_as_bitmap',
            'illustrator.prepress.print_general.bitmap_resolution',
            'illustrator.prepress.print_general.print_to_file',
            'illustrator.prepress.print_general.job_name',
            'illustrator.prepress.print_media.size_media',
            'illustrator.prepress.print_media.width_media',
            'illustrator.prepress.print_media.height_media',
            'illustrator.prepress.print_media.offset_media',
            'illustrator.prepress.print_media.transverse',
            'illustrator.prepress.page_size_orientation',
            'illustrator.prepress.print_placement.orientation_print',
            'illustrator.prepress.print_placement.placement',
            'illustrator.prepress.print_placement.fit_to_page',
            'illustrator.prepress.print_placement.custom_scale_width',
            'illustrator.prepress.print_placement.custom_scale_height',
            'illustrator.prepress.print_placement.tiling',
            'illustrator.prepress.print_placement.emulsion_flip',
            'illustrator.prepress.print_marks.trim_marks_print',
            'illustrator.prepress.print_marks.trim_mark_weight_print',
            'illustrator.prepress.print_marks.registration_marks_print',
            'illustrator.prepress.print_marks.color_bars_print',
            'illustrator.prepress.print_marks.page_information_print',
            'illustrator.prepress.print_marks.printer_mark_type_print',
            'illustrator.prepress.print_marks.offset_from_artboard',
            'illustrator.prepress.print_marks.bleeds_print',
            'illustrator.prepress.print_output.mode',
            'illustrator.prepress.print_output.convert_all_spot_colors_to_process',
            'illustrator.prepress.print_output.overprint_black',
            'illustrator.prepress.print_output.document_ink_options',
            'illustrator.prepress.color_separations',
            'illustrator.prepress.composite_print',
            'illustrator.prepress.print_graphics.postscript',
            'illustrator.prepress.print_graphics.data_format_compression',
            'illustrator.prepress.print_graphics.binary_data',
            'illustrator.prepress.print_graphics.compatible_gradient_and_gradient_mesh_printing',
            'illustrator.prepress.print_graphics.force_continuous_tone',
            'illustrator.prepress.print_graphics.negative',
            'illustrator.prepress.print_graphics.shading_resolution',
            'illustrator.prepress.print_gradients_meshes',
            'illustrator.prepress.print_fonts.fonts_download',
            'illustrator.prepress.print_fonts.font_substitution',
            'illustrator.prepress.print_color_management',
            'illustrator.prepress.print_color_management.printer_profile',
            'illustrator.prepress.print_color_management.rendering_intent',
            'illustrator.prepress.print_color_management.profile_name',
            'illustrator.prepress.print_option.transparency_flattener_preset_print',
            'illustrator.prepress.print_flattener.raster_vector_balance',
            'illustrator.prepress.print_flattener.line_art_and_text_resolution',
            'illustrator.prepress.print_flattener.gradient_and_mesh_resolution',
            'illustrator.prepress.print_flattener.convert_all_text_to_outlines',
            'illustrator.prepress.print_flattener.convert_all_strokes_to_outlines',
            'illustrator.prepress.print_flattener.clip_complex_regions',
            'illustrator.prepress.print_flattener.overprints_flattener',
        ],
        handler: (a) => {
            let file = null;
            if (a.outputFile !== undefined) {
                file = paths.validate(a.outputFile);
                if (path.extname(file).toLowerCase() !== '.ps') throw new Error('outputFile must end in .ps');
            }
            const options = printOptionLines(a) + (file ? `\no.jobOptions.file = new File(${jsxPath(file)});` : '');
            // Create only the pages being set, so the preset keeps the rest.
            const used = Object.entries(PRINT_OPTION_OBJECTS).filter(([prop]) => options.includes(`o.${prop}.`));
            return run('Print', script(`
var o = new PrintOptions();
${a.preset !== undefined ? `
var presets = app.printPresetsList, found = false;
for (var i = 0; i < presets.length; i++) if (presets[i] === ${str(a.preset)}) found = true;
if (!found) throw new Error("Print preset not found: " + ${str(a.preset)} + ". Available: " + presets.join(", "));
o.printPreset = ${str(a.preset)};` : ''}
${a.printer !== undefined ? `
var printers = app.printerList, known = false, all = [];
for (var p = 0; p < printers.length; p++) { all.push(printers[p].name); if (printers[p].name === ${str(a.printer)}) known = true; }
if (!known) throw new Error("Printer not found: " + ${str(a.printer)} + ". Available: " + all.join(", "));
o.printerName = ${str(a.printer)};` : ''}
${a.ppd !== undefined ? `o.PPDName = ${str(a.ppd)};` : ''}
${used.map(([prop, cls]) => `o.${prop} = new ${cls}();`).join('\n')}
${options}
doc.print(o);
__result__ = { printed: doc.name, printer: ${a.printer !== undefined ? str(a.printer) : 'null'}, file: ${file ? str(file) : 'null'}, preset: ${a.preset !== undefined ? str(a.preset) : 'null'} };`));
        },
    },
];
