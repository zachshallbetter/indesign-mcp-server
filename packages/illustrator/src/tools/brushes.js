/**
 * Brushes: list, apply, import from a library file, save as a library, and
 * open the brush libraries Illustrator ships.
 *
 * The object model reaches a brush only by name (Document.brushes) and can
 * apply it (Brush.applyTo); it cannot read a brush's type or create or edit
 * its settings. Brushes come into a document the way the ImportAndApplyBrush
 * script (swwwitch/illustrator-scripts) brings them in: open the library file,
 * apply the brush to a carrier path there, duplicate the path into the
 * document and delete it; the brush stays in the document's Brushes panel.
 */
import path from 'node:path';
import { str, bool, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';
import { EACH_PATH } from './appearance.js';
import { paths } from './documents.js';

/** Window > Brush Libraries entries: name, menu command, atlas feature. */
export const BRUSH_LIBRARIES = [
    ['Arrows_Special', '_Brush Library Menu Item 1', 'arrows_arrows_special'],
    ['Arrows_Standard', '_Brush Library Menu Item 2', 'arrows_arrows_standard'],
    ['Pattern Arrows', '_Brush Library Menu Item 3', 'arrows_pattern_arrows'],
    ['Artistic_Calligraphic', '_Brush Library Menu Item 5', 'artistic_artistic_calligraphic'],
    ['Artistic_ChalkCharcoalPencil', '_Brush Library Menu Item 6', 'artistic_artistic_chalkcharcoalpencil'],
    ['Artistic_Ink', '_Brush Library Menu Item 7', 'artistic_artistic_ink'],
    ['Artistic_Paintbrush', '_Brush Library Menu Item 8', 'artistic_artistic_paintbrush'],
    ['Artistic_ScrollPen', '_Brush Library Menu Item 9', 'artistic_artistic_scrollpen'],
    ['Artistic_Watercolor', '_Brush Library Menu Item 10', 'artistic_artistic_watercolor'],
    ['Borders_Dashed', '_Brush Library Menu Item 12', 'borders_borders_dashed'],
    ['Borders_Decorative', '_Brush Library Menu Item 13', 'borders_borders_decorative'],
    ['Borders_Frames', '_Brush Library Menu Item 14', 'borders_borders_frames'],
    ['Borders_Geometric', '_Brush Library Menu Item 15', 'borders_borders_geometric'],
    ['Borders_Indigenous', '_Brush Library Menu Item 16', 'borders_borders_indigenous'],
    ['Borders_Lines', '_Brush Library Menu Item 17', 'borders_borders_lines'],
    ['Borders_Novelty', '_Brush Library Menu Item 18', 'borders_borders_novelty'],
    ['Bristle Brush Library', '_Brush Library Menu Item 20', 'bristle_brush_bristle_brush_library'],
    ['Decorative_Banners and Seals', '_Brush Library Menu Item 22', 'decorative_decorative_banners_and_seals'],
    ['Decorative_Scatter', '_Brush Library Menu Item 23', 'decorative_decorative_scatter'],
    ['Decorative_Text Dividers', '_Brush Library Menu Item 24', 'decorative_decorative_text_dividers'],
    ['Elegant Curl & Floral Brush Set', '_Brush Library Menu Item 25', 'decorative_elegant_curl_and_floral_brush_set'],
    ['Image Brush Library', '_Brush Library Menu Item 27', 'image_brush_image_brush_library'],
    ['Grunge brushes vector pack', '_Brush Library Menu Item 29', 'vector_packs_grunge_brushes_vector_pack'],
    ['Hand Drawn brushes vector pack', '_Brush Library Menu Item 30', 'vector_packs_hand_drawn_brushes_vector_pack'],
    ['6d Art Pen Brushes', '_Brush Library Menu Item 32', 'wacom_6d_brushes_6d_art_pen_brushes'],
];

/** Brush kinds the panel holds; each is applied the same way, by name. */
const BRUSH_KINDS = ['calligraphic_brush', 'scatter_brush', 'art_brush', 'pattern_brush', 'bristle_brush'].map((k) => `illustrator.brushes.${k}`);

/** ES3: whether the document has a brush with this name. */
const HAS_BRUSH = `
function __hasBrush(d, name) {
  for (var i = 0; i < d.brushes.length; i++) if (d.brushes[i].name === name) return true;
  return false;
}`;

/** An absolute .ai path inside the allowed folders. */
function aiFile(value, name = 'filePath') {
    if (typeof value !== 'string' || !value) throw new Error(`Give ${name}: an absolute path to an .ai file`);
    const p = paths.validate(value);
    if (path.extname(p).toLowerCase() !== '.ai') throw new Error(`${name} must end in .ai`);
    return p;
}

export const tools = [
    {
        name: 'list_brushes',
        description: 'List the brushes in the active document\'s Brushes panel, by name. Illustrator\'s scripting does not report a brush\'s type (calligraphic, scatter, art, pattern, bristle) or its settings',
        inputSchema: { type: 'object', properties: {} },
        features: ['illustrator.brushes.brush_object'],
        hints: { readOnly: true },
        handler: () => run('List brushes', script(`
var names = [];
for (var i = 0; i < doc.brushes.length; i++) names.push(doc.brushes[i].name);
__result__ = { count: names.length, brushes: names };`)),
    },
    {
        name: 'apply_brush',
        description: 'Apply a brush from the document\'s Brushes panel to paths (as clicking a brush in the Brushes panel does): calligraphic, scatter, art, pattern or bristle. Paths inside groups and compound paths are brushed too. With expand, the brush strokes become ordinary artwork (Object > Expand Appearance). Use import_brushes first for a brush from a library file',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                brush: { type: 'string', description: 'Brush name, as list_brushes reports it' },
                expand: { type: 'boolean', description: 'Expand the brushed paths into outlines (Object > Expand Appearance). Default false', default: false },
            },
            required: ['target', 'brush'],
        },
        features: ['illustrator.brushes.brush_object', 'illustrator.brushes.apply_brush', ...BRUSH_KINDS, 'illustrator.brushes.brush_to_outline'],
        menuCommands: ['expandStyle'],
        auditArgs: { brush: '5 pt. Round', expand: true },
        handler: (a) => {
            if (typeof a.brush !== 'string' || !a.brush) throw new Error('Give brush: a brush name from list_brushes');
            return run('Apply brush', script(`${EACH_PATH}${HAS_BRUSH}
var items = __targets(doc, ${targetSpec(a.target)}), counts = { paths: 0, skipped: [] }, brushed = [];
if (!__hasBrush(doc, ${str(a.brush)})) throw new Error("No brush named " + ${str(a.brush)} + " in this document: list_brushes shows the names, import_brushes brings one in from a library");
var b = doc.brushes.getByName(${str(a.brush)});
for (var i = 0; i < items.length; i++) __eachPath(items[i], function (p) { b.applyTo(p); brushed.push(p); }, counts);
if (!brushed.length) throw new Error("No paths to brush among the targets");
var out = [];
${a.expand ? `doc.selection = null;
for (var k = 0; k < brushed.length; k++) brushed[k].selected = true;
app.executeMenuCommand("expandStyle");
var sel = doc.selection;
if (sel && sel.length) for (var j = 0; j < sel.length && j < 500; j++) out.push(__itemInfo(doc, sel[j]));` : ''}
__result__ = { brush: b.name, paths: counts.paths, skipped: counts.skipped, expanded: ${bool(a.expand)}, result: out };`));
        },
    },
    {
        name: 'import_brushes',
        description: 'Bring brushes from a brush library file (an .ai file, such as one saved with save_brush_library or a library from Illustrator\'s Presets folder) into the active document\'s Brushes panel, as Window > Brush Libraries > Other Library does. Give names to import only those; brushes the document already has are skipped',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the library .ai file' },
                names: { type: 'array', items: { type: 'string' }, description: 'Brush names to import. Default: every brush in the library' },
            },
            required: ['filePath'],
        },
        features: ['illustrator.brushes.brush_libraries_import', 'illustrator.brushes.library.other_library'],
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit-brushes.ai'), names: ['Charcoal'] },
        handler: (a) => {
            const p = aiFile(a.filePath);
            const names = a.names === undefined ? null : a.names;
            if (names !== null && (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string' || !n))) {
                throw new Error('names must be a list of brush names');
            }
            return run('Import brushes', script(`${HAS_BRUSH}
var f = new File(${jsxPath(p)}), same = false;
if (!f.exists) throw new Error("File not found: " + f.fsName);
try { same = doc.fullName.fsName === f.fsName; } catch (e) { same = false; }
if (same) throw new Error("That file is the active document");
var before = app.documents.length;
var lib = app.open(f);
var wasOpen = app.documents.length === before;
var want = ${json(names)}, imported = [], present = [], missing = [], copies = [];
try {
  if (want === null) { want = []; for (var i = 0; i < lib.brushes.length; i++) want.push(lib.brushes[i].name); }
  for (var n = 0; n < want.length; n++) {
    if (__hasBrush(doc, want[n])) { present.push(want[n]); continue; }
    if (!__hasBrush(lib, want[n])) { missing.push(want[n]); continue; }
    var carrier = lib.pathItems.add();
    carrier.setEntirePath([[0, 0], [10, 0]]);
    carrier.filled = false;
    carrier.stroked = true;
    lib.brushes.getByName(want[n]).applyTo(carrier);
    copies.push(carrier.duplicate(doc.activeLayer, ElementPlacement.PLACEATEND));
    carrier.remove();
  }
} finally {
  if (!wasOpen) lib.close(SaveOptions.DONOTSAVECHANGES);
  app.activeDocument = doc;
}
for (var c = 0; c < copies.length; c++) copies[c].remove();
var failed = [];
for (var m = 0; m < want.length; m++) {
  var known = false;
  for (var q = 0; q < present.length; q++) if (present[q] === want[m]) known = true;
  for (var r = 0; r < missing.length; r++) if (missing[r] === want[m]) known = true;
  if (known) continue;
  if (__hasBrush(doc, want[m])) imported.push(want[m]); else failed.push(want[m]);
}
__result__ = { library: f.fsName, imported: imported, alreadyPresent: present, notInLibrary: missing, failed: failed };`));
        },
    },
    {
        name: 'save_brush_library',
        description: 'Save the active document\'s brushes as a brush library file (Brushes panel menu > Save Brush Library). Open it later with import_brushes or Window > Brush Libraries > Other Library',
        inputSchema: {
            type: 'object',
            properties: { filePath: { type: 'string', description: 'Absolute .ai path to write' } },
            required: ['filePath'],
        },
        features: ['illustrator.brushes.brushes_menu.save_brush_library', 'illustrator.brushes.brush_libraries_create'],
        hints: { idempotent: true },
        auditArgs: { filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'audit-brushes.ai') },
        handler: (a) => {
            const p = aiFile(a.filePath);
            return run('Save brush library', script(`
if (!doc.brushes.length) throw new Error("The document has no brushes");
var f = new File(${jsxPath(p)});
doc.writeAsLibrary(f, LibraryType.BRUSHES);
__result__ = { saved: f.fsName, brushes: doc.brushes.length };`));
        },
    },
    {
        name: 'open_brush_library',
        description: 'Open one of the brush libraries Illustrator ships as a panel (Window > Brush Libraries), for the user to pick brushes from. Clicking a brush there adds it to the document; to bring brushes in by script, use import_brushes with the library\'s file',
        inputSchema: {
            type: 'object',
            properties: { library: { type: 'string', enum: BRUSH_LIBRARIES.map(([n]) => n) } },
            required: ['library'],
        },
        features: ['illustrator.brushes.brush_libraries', 'illustrator.brushes.brushes_menu.open_brush_library', ...BRUSH_LIBRARIES.map(([, , f]) => `illustrator.brushes.library.${f}`)],
        menuCommands: BRUSH_LIBRARIES.map(([, c]) => c),
        hints: { idempotent: true },
        handler: (a) => {
            const name = enumOf(a.library, BRUSH_LIBRARIES.map(([n]) => n), { name: 'library' });
            const command = BRUSH_LIBRARIES.find(([n]) => n === name)[1];
            return run('Open brush library', script(`
app.executeMenuCommand(${str(command)});
__result__ = { opened: ${str(name)} };`, { needsDocument: false }));
        },
    },
];
