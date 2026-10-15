/**
 * Import and export formats: Adobe PDF with every option and PDF presets,
 * interactive PDF, EPUB (reflowable and fixed layout), HTML and HTML5, placing
 * Word, Excel and text files with their import options, text export, JPEG, PNG
 * and EPS export, Object Export Options, articles, and library, preflight
 * profile, swatch and snippet files.
 *
 * Export tools set the preferences an export dialog would, export, and put the
 * preferences back unless keepSettings is true (InDesign's dialogs keep them).
 * Option objects are keyed by the object-model property names; see
 * formatOptions.js for the tables.
 */
import { str, num, bool, enumOf, index, json } from 'adobe-mcp-core';
import { validateFilePath, jsxPath } from '../utils/jsxSafe.js';
import { script } from './script.js';
import { run, TARGET_SCHEMA, targetSpec } from './run.js';
import {
    FORMAT_HELPERS, groupSchema, assign, without, sampleOptions as S, NOT_IN_PRESET,
    PDF_GENERAL, PDF_COMPRESSION, PDF_MARKS, PDF_OUTPUT, PDF_ADVANCED, PDF_SECURITY,
    INTERACTIVE_PDF, EPUB_GENERAL, EPUB_IMAGES, EPUB_CSS, EPUB_METADATA, EPUB_ACCESSIBILITY,
    EPUB_FIXED_LAYOUT, HTML_OPTIONS, HTML_FIXED_LAYOUT, WORD_IMPORT, EXCEL_IMPORT, TEXT_IMPORT,
    TAGGED_TEXT_IMPORT, TEXT_EXPORT, TAGGED_TEXT_EXPORT, JPEG_EXPORT, PNG_EXPORT, EPS_EXPORT,
    OEO_ALT_TEXT, OEO_PDF, OEO_EPUB,
} from './formatOptions.js';

const F = 'indesign.import_export.';
const ids = (...names) => names.map((n) => F + n);

/** A script with the format helpers ahead of the body. */
const formatScript = (body, opts) => script(FORMAT_HELPERS + body, opts);

/** A caller's output or input file as a JSX string literal, through the path policy. */
function pathLit(value, name = 'filePath') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is required: a file path`);
    return jsxPath(validateFilePath(value));
}

/** "all" (or nothing) gives null; otherwise a checked page-name range. */
function pageRange(value, name = 'pages') {
    if (value === undefined || value === null || /^\s*all\s*$/i.test(String(value))) return null;
    const s = String(value).trim();
    if (!/^[\p{L}\p{N} ,+\-.:]{1,500}$/u.test(s)) throw new Error(`Invalid '${name}': ${JSON.stringify(value)}. Use "all" or page names such as "1-3,5" or "+1-+4"`);
    return s;
}

/** Refuse option groups that do not apply to the chosen mode. */
function refuse(a, groups, why) {
    for (const g of groups) if (a[g] !== undefined) throw new Error(`'${g}' does not apply ${why}`);
}

/** Keep-or-restore tail shared by the export tools. */
const restore = (keep) => (keep ? '' : '__restorePrefs();');

const KEEP_SCHEMA = { type: 'boolean', default: false, description: 'Leave the settings in place after the export, as the dialog does (default: put the previous settings back)' };
const PAGES_SCHEMA = { type: 'string', default: 'all', description: 'Pages: "all", or page names as in the Pages panel such as "1-3,5"; prefix + for absolute positions ("+1-+3")' };
const OUT_SCHEMA = (what) => ({ type: 'string', description: `Output ${what} path (inside the allowed directories)` });

// ---------------------------------------------------------------------------

/** Ink Manager lines: convert spot inks to process and set ink aliases on the document. */
function inkLines(spec) {
    if (spec === undefined) return '';
    if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error("'inkManager' must be an object");
    const unknown = Object.keys(spec).filter((k) => !['allToProcess', 'inks'].includes(k));
    if (unknown.length) throw new Error(`Unknown option in 'inkManager': ${unknown.join(', ')}. Allowed: allToProcess, inks`);
    const lines = [];
    if (spec.allToProcess !== undefined) {
        if (typeof spec.allToProcess !== 'boolean') throw new Error("'inkManager.allToProcess' must be true or false");
        lines.push(`for (var __n = 0; __n < doc.inks.length; __n++) { if (!doc.inks[__n].isProcessInk) doc.inks[__n].convertToProcess = ${bool(spec.allToProcess)}; }`);
    }
    if (spec.inks !== undefined) {
        if (!Array.isArray(spec.inks) || spec.inks.length > 200) throw new Error("'inkManager.inks' must be a list of up to 200 inks");
        for (const ink of spec.inks) {
            if (!ink || typeof ink.name !== 'string' || !ink.name) throw new Error("Each ink in 'inkManager.inks' needs a name");
            const extra = Object.keys(ink).filter((k) => !['name', 'convertToProcess', 'aliasInkName'].includes(k));
            if (extra.length) throw new Error(`Unknown ink option: ${extra.join(', ')}. Allowed: name, convertToProcess, aliasInkName`);
            lines.push(`var __ink = doc.inks.itemByName(${str(ink.name)}); if (!__ink.isValid) throw new Error(${str(`No ink named ${ink.name}`)});`);
            if (ink.convertToProcess !== undefined) {
                if (typeof ink.convertToProcess !== 'boolean') throw new Error(`Ink ${ink.name}: convertToProcess must be true or false`);
                lines.push(`__ink.convertToProcess = ${bool(ink.convertToProcess)};`);
            }
            if (ink.aliasInkName !== undefined) {
                if (typeof ink.aliasInkName !== 'string' || ink.aliasInkName.length > 300) throw new Error(`Ink ${ink.name}: aliasInkName must be an ink name`);
                lines.push(`__ink.aliasInkName = ${str(ink.aliasInkName)};`);
            }
        }
    }
    return lines.join('\n');
}

const INK_SCHEMA = {
    type: 'object',
    description: 'Ink Manager (Output panel): convert spot inks to process or alias them. These are document settings and stay after the export, as in InDesign',
    properties: {
        allToProcess: { type: 'boolean', description: 'All Spots to Process' },
        inks: {
            type: 'array',
            description: 'Per-ink settings',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Ink name, e.g. "PANTONE 185 C"' },
                    convertToProcess: { type: 'boolean', description: 'Convert this spot ink to process' },
                    aliasInkName: { type: 'string', description: 'Ink Alias: print this ink as another ink' },
                },
                required: ['name'],
            },
        },
    },
};

/** The PDF option groups, by parameter name. */
const PDF_GROUPS = {
    general: [PDF_GENERAL, 'General panel'],
    compression: [PDF_COMPRESSION, 'Compression panel'],
    marksAndBleeds: [PDF_MARKS, 'Marks and Bleeds panel'],
    output: [PDF_OUTPUT, 'Output panel (colour conversion and PDF/X)'],
    advanced: [PDF_ADVANCED, 'Advanced panel (fonts, OPI, transparency flattener, accessibility)'],
    security: [PDF_SECURITY, 'Security panel. Passwords are written into the PDF and never returned'],
};

/** Statements copying a PDF export preset's settings onto `prefs`. */
const COPY_PRESET = `
var __pp = __preset.properties;
for (var __k in __pp) {
  if (__k === "name" || __k === "fullName" || __k === "parent" || __k === "index" || __k === "id" || __k === "isValid" || __k === "properties" || __k === "events" || __k === "eventListeners") continue;
  try { prefs[__k] = __pp[__k]; } catch (__e) {}
}`;

/** A PDF export preset by name, or an error naming what exists. */
const presetLookup = (name) => `
var __preset = app.pdfExportPresets.itemByName(${str(name)});
if (!__preset.isValid) throw new Error(${str(`No PDF export preset named ${name}`)} + "; presets: " + app.pdfExportPresets.everyItem().name.join(", "));`;

/** Snapshot of a preferences object or preset, with enumerations and objects as names. */
const DESCRIBE_PROPS = `
var __describeProps = function (o, skip) {
  var p = o.properties, out = {};
  for (var k in p) {
    if (skip[k]) continue;
    var v = p[k], t = typeof v;
    if (v === null || t === "undefined" || t === "boolean" || t === "number" || t === "string") { out[k] = v; continue; }
    if (v instanceof Array) { out[k] = v; continue; }
    var n = null;
    try { n = v.name; } catch (e) {}
    out[k] = (typeof n === "string") ? n : __enumName(v);
  }
  return out;
};
var __skip = { parent: 1, isValid: 1, properties: 1, events: 1, eventListeners: 1, index: 1, id: 1, openDocumentPassword: 1, changeSecurityPassword: 1 };`;

// ---------------------------------------------------------------------------

export const tools = [
    {
        name: 'export_pdf_with_options',
        description: 'Export the document as Adobe PDF (Print) with any option of the Export Adobe PDF dialog: General, Compression, Marks and Bleeds, Output (with Ink Manager), Advanced and Security, optionally starting from a preset and exporting in the background (File > Export > Adobe PDF (Print))',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('PDF file'),
                preset: { type: 'string', description: 'Start from this PDF export preset, e.g. "[High Quality Print]" or "[PDF/X-4:2008]"; the options below override it (default: the current settings)' },
                pages: PAGES_SCHEMA,
                ...Object.fromEntries(Object.entries(PDF_GROUPS).map(([k, [t, d]]) => [k, groupSchema(t, d)])),
                inkManager: INK_SCHEMA,
                background: { type: 'boolean', default: false, description: 'Export in the background (Background Tasks panel) and return the task; follow it with background_exports' },
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath'],
        },
        features: [
            ...ids('pdf_general_standard', 'pdf_general_compatibility', 'pdf_general_pages_spreads', 'pdf_general_create_separate_pdf_files',
                'pdf_general_view_pdf', 'pdf_general_layout_pdf', 'pdf_general_open_in_full_screen_mode', 'pdf_general_view_pdf_after_exporting',
                'pdf_general_embed_page_thumbnails', 'pdf_general_optimize_for_fast_web_view', 'pdf_general_create_tagged_pdf',
                'pdf_general_create_acrobat_layers', 'pdf_general_export_layers', 'pdf_general_include_bookmarks', 'pdf_general_include_hyperlinks',
                'pdf_general_visible_guides_and_baseline_grids', 'pdf_general_non_printing_objects', 'pdf_general_interactive_elements'),
            ...ids('pdf_compression_color_images_downsampling', 'pdf_compression_color_images_compression', 'pdf_compression_color_images_image_quality',
                'pdf_compression_color_images_tile_size', 'pdf_compression_grayscale_images_downsampling', 'pdf_compression_grayscale_images_compression',
                'pdf_compression_grayscale_images_image_quality', 'pdf_compression_grayscale_images_tile_size', 'pdf_compression_monochrome_images_downsampling',
                'pdf_compression_monochrome_images_compression', 'pdf_compression_compress_text_and_line_art', 'pdf_compression_crop_image_data_to_frames'),
            ...ids('pdf_marks_type_marks', 'pdf_marks_weight_marks', 'pdf_marks_offset_marks', 'pdf_marks_bleed_top_bottom_inside_outside', 'pdf_marks_include_slug_area'),
            ...ids('pdf_output_color_conversion', 'pdf_output_destination', 'pdf_output_profile_inclusion_policy', 'pdf_output_simulate_overprint',
                'pdf_output_ink_manager_pdf', 'pdf_output_output_intent_profile_name', 'pdf_output_output_condition_name',
                'pdf_output_output_condition_identifier', 'pdf_output_registry_name'),
            ...ids('pdf_advanced_subset_fonts_when_percent_of_characters_used_is_less_than', 'pdf_advanced_opi_omit_for_eps_pdf_bitmap_images',
                'pdf_advanced_transparency_flattener_preset_pdf', 'pdf_advanced_ignore_spread_overrides_pdf', 'pdf_advanced_display_title', 'pdf_advanced_language_pdf'),
            ...ids('pdf_security_require_a_password_to_open_the_document', 'pdf_security_use_a_password_to_restrict_printing_editing_and_other_tasks',
                'pdf_security_printing_allowed', 'pdf_security_changes_allowed', 'pdf_security_enable_copying_of_text_images_and_other_content',
                'pdf_security_enable_text_access_of_screen_reader_devices', 'pdf_security_enable_plaintext_metadata'),
            ...ids('pdf_background_export', 'tagged_pdf', 'accessible_pdf'),
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: {
            pages: 'all', general: S(PDF_GENERAL), compression: S(PDF_COMPRESSION), marksAndBleeds: S(PDF_MARKS), output: S(PDF_OUTPUT),
            advanced: S(PDF_ADVANCED), security: S(PDF_SECURITY), inkManager: { allToProcess: true, inks: [{ name: 'PANTONE 185 C', convertToProcess: false, aliasInkName: 'Black' }] },
        },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const pages = pageRange(a.pages);
            const sets = Object.entries(PDF_GROUPS).map(([k, [t]]) => assign('prefs', t, a[k], k)).filter(Boolean).join('\n');
            const inks = inkLines(a.inkManager);
            if (a.preset !== undefined && (typeof a.preset !== 'string' || !a.preset || a.preset.length > 300)) throw new Error("'preset' must be a preset name");
            const background = Boolean(a.background);
            return run('Export PDF with options', formatScript(`
var prefs = app.pdfExportPreferences;
__keepPrefs(prefs);
var file = __outFile(${file});
var task = null;
try {
${a.preset ? presetLookup(a.preset) + COPY_PRESET : ''}
  prefs.pageRange = ${pages ? str(pages) : 'PageRange.ALL_PAGES'};
${sets}
${inks}
  ${background ? 'task = doc.asynchronousExportFile(ExportFormat.PDF_TYPE, file, false);' : 'doc.exportFile(ExportFormat.PDF_TYPE, file, false);'}
} finally {
  ${restore(a.keepSettings)}
}
var res = { file: file.fsName, pages: ${pages ? str(pages) : '"all"'}, preset: ${a.preset ? str(a.preset) : 'null'}, settingsKept: ${bool(a.keepSettings)} };
if (task) res.background = { id: task.id, name: task.name, status: __enumName(task.status) };
else res.written = file.exists;
__result__ = res;`));
        },
    },
    {
        name: 'manage_pdf_export_presets',
        description: 'List, read, create or update, delete, import and export Adobe PDF presets (File > Adobe PDF Presets > Define). save takes the same option groups as export_pdf_with_options, without security',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'get', 'save', 'delete', 'import', 'export'], description: 'list names; get one preset\'s settings; save (create or update) a preset; delete one; import presets from a .joboptions file; export the presets to a file' },
                name: { type: 'string', description: 'Preset name (get, save, delete). Built-in presets in [brackets] cannot be changed or deleted' },
                basedOn: { type: 'string', description: 'save: copy the settings of this preset first (default: a new preset starts from the current settings)' },
                filePath: { type: 'string', description: 'import / export: the preset file' },
                ...Object.fromEntries(Object.entries(PDF_GROUPS).filter(([k]) => k !== 'security').map(([k, [t, d]]) => [k, groupSchema(without(t, NOT_IN_PRESET), d)])),
            },
            required: ['action'],
        },
        features: ids('pdf_presets'),
        hints: { readOnly: false, destructive: true },
        auditArgs: {
            action: 'save', name: 'Audit preset', basedOn: '[High Quality Print]', general: S(without(PDF_GENERAL, NOT_IN_PRESET)),
            compression: S(PDF_COMPRESSION), marksAndBleeds: S(PDF_MARKS), output: S(PDF_OUTPUT), advanced: S(PDF_ADVANCED),
        },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'get', 'save', 'delete', 'import', 'export'], { name: 'action' });
            const needName = () => {
                if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 300) throw new Error(`'name' is required for ${action}`);
                return a.name;
            };
            if (a.security !== undefined) throw new Error('PDF presets do not hold security settings; set them with export_pdf_with_options');
            if (action !== 'save') for (const k of ['general', 'compression', 'marksAndBleeds', 'output', 'advanced', 'basedOn']) if (a[k] !== undefined) throw new Error(`'${k}' applies to save only`);
            let body;
            if (action === 'list') {
                body = '__result__ = { presets: app.pdfExportPresets.everyItem().name };';
            } else if (action === 'get') {
                body = `${DESCRIBE_PROPS}${presetLookup(needName())}
__result__ = { name: __preset.name, settings: __describeProps(__preset, __skip) };`;
            } else if (action === 'save') {
                const n = needName();
                if (/^\[/.test(n)) throw new Error('Built-in presets in [brackets] cannot be changed; save under another name');
                const sets = Object.entries(PDF_GROUPS).filter(([k]) => k !== 'security')
                    .map(([k, [t]]) => assign('prefs', without(t, NOT_IN_PRESET), a[k], k)).filter(Boolean).join('\n');
                if (a.basedOn !== undefined && (typeof a.basedOn !== 'string' || !a.basedOn)) throw new Error("'basedOn' must be a preset name");
                body = `
var prefs = app.pdfExportPresets.itemByName(${str(n)});
var created = !prefs.isValid;
if (created) prefs = app.pdfExportPresets.add({ name: ${str(n)} });
${a.basedOn ? presetLookup(a.basedOn) + COPY_PRESET : ''}
${sets}
__result__ = { name: prefs.name, created: created };`;
            } else if (action === 'delete') {
                const n = needName();
                if (/^\[/.test(n)) throw new Error('Built-in presets in [brackets] cannot be deleted');
                body = `${presetLookup(n)}
__preset.remove();
__result__ = { deleted: ${str(n)} };`;
            } else if (action === 'import') {
                body = `var f = File(${pathLit(a.filePath)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var before = app.pdfExportPresets.length;
app.importFile(ExportPresetFormat.PDF_EXPORT_PRESETS_FORMAT, f);
__result__ = { file: f.fsName, added: app.pdfExportPresets.length - before, presets: app.pdfExportPresets.everyItem().name };`;
            } else {
                body = `var f = __outFile(${pathLit(a.filePath)});
app.exportPresets(ExportPresetFormat.PDF_EXPORT_PRESETS_FORMAT, f, "", false);
__result__ = { file: f.fsName, written: f.exists };`;
            }
            return run('Manage PDF export presets', formatScript(body, { needsDocument: false }));
        },
    },
    {
        name: 'background_exports',
        description: 'List background export tasks with their status and progress, wait for them to finish, or cancel them (Window > Utilities > Background Tasks)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'wait', 'cancel'], default: 'list', description: 'list tasks; wait until tasks finish; cancel tasks' },
                taskId: { type: 'integer', minimum: 0, description: 'Only this task (the id export_pdf_with_options returned); default all tasks' },
            },
        },
        features: ids('pdf_background_export'),
        hints: { readOnly: false },
        handler: (a) => {
            const action = enumOf(a.action ?? 'list', ['list', 'wait', 'cancel'], { name: 'action' });
            const only = a.taskId === undefined ? 'null' : index(a.taskId, { name: 'taskId', max: 1e9 });
            return run('Background exports', formatScript(`
var only = ${only}, out = [];
var tasks = app.backgroundTasks.everyItem().getElements();
for (var i = 0; i < tasks.length; i++) {
  var t = tasks[i];
  if (only !== null && t.id !== only) continue;
  ${action === 'wait' ? 't.waitForTask();' : action === 'cancel' ? 'try { t.cancelTask(); } catch (e) {}' : ''}
  var info = { id: t.id, name: t.name, document: null, status: null, percentDone: null };
  try { info.document = t.documentName; info.status = __enumName(t.status); info.percentDone = t.percentDone; } catch (e) { info.status = "finished"; }
  out.push(info);
}
if (only !== null && !out.length) throw new Error("No background task " + only);
__result__ = { action: "${action}", tasks: out };`, { needsDocument: false }));
        },
    },
    {
        name: 'export_interactive_pdf',
        description: 'Export the document as an interactive PDF with buttons, forms, media, hyperlinks and page transitions, setting any option of the Export to Interactive PDF dialog (File > Export > Adobe PDF (Interactive))',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('PDF file'),
                pages: PAGES_SCHEMA,
                options: groupSchema(INTERACTIVE_PDF, 'Export to Interactive PDF options'),
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath'],
        },
        features: [
            ...ids('ipdf_pages_spreads_interactive', 'ipdf_view_after_exporting_interactive', 'ipdf_embed_page_thumbnails_interactive',
                'ipdf_create_acrobat_layers_interactive', 'ipdf_create_tagged_pdf_interactive', 'ipdf_use_structure_for_tab_order',
                'ipdf_view_interactive', 'ipdf_layout_interactive', 'ipdf_presentation_open_in_full_screen_mode', 'ipdf_flip_pages_every',
                'ipdf_page_transitions_interactive', 'ipdf_forms_and_media', 'ipdf_compression_interactive', 'ipdf_jpeg_quality_interactive',
                'ipdf_resolution_interactive', 'ipdf_display_title_interactive', 'ipdf_language_interactive', 'ipdf_create_separate_pdf_files_interactive'),
            ...ids('format_pdf_interactive'),
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { pages: 'all', options: S(INTERACTIVE_PDF) },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const pages = pageRange(a.pages);
            const sets = assign('prefs', INTERACTIVE_PDF, a.options, 'options');
            return run('Export interactive PDF', formatScript(`
var prefs = app.interactivePDFExportPreferences;
__keepPrefs(prefs);
var file = __outFile(${file});
try {
  prefs.pageRange = ${pages ? str(pages) : 'PageRange.ALL_PAGES'};
${sets}
  doc.exportFile(ExportFormat.INTERACTIVE_PDF, file, false);
} finally {
  ${restore(a.keepSettings)}
}
__result__ = { file: file.fsName, written: file.exists, pages: ${pages ? str(pages) : '"all"'}, settingsKept: ${bool(a.keepSettings)} };`));
        },
    },
    {
        name: 'export_epub_with_options',
        description: 'Export the document as a reflowable or fixed-layout EPUB with any option of the EPUB export dialogs: General, Text, Object and image conversion, CSS and JavaScript, Metadata, accessibility metadata, and fixed-layout range, cover, navigation and spreads (File > Export > EPUB (Reflowable / Fixed Layout))',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('EPUB file'),
                layout: { type: 'string', enum: ['reflowable', 'fixed_layout'], default: 'reflowable', description: 'Reflowable or fixed-layout EPUB' },
                general: groupSchema(EPUB_GENERAL, 'Reflowable: General and Text panels'),
                images: groupSchema(EPUB_IMAGES, 'Reflowable: Object panel (image conversion)'),
                css: groupSchema(EPUB_CSS, 'Reflowable: HTML & CSS and JavaScript panels'),
                fixedLayout: groupSchema(EPUB_FIXED_LAYOUT, 'Fixed layout: General, Conversion Settings, CSS and JavaScript panels'),
                metadata: groupSchema(EPUB_METADATA, 'Metadata panel (either layout)'),
                accessibility: groupSchema(EPUB_ACCESSIBILITY, 'Accessibility metadata (either layout); alt text and ARIA roles are set per object with set_object_export_options'),
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath'],
        },
        features: [
            ...ids('epub_general_version_epub', 'epub_general_cover', 'epub_general_navigation_toc', 'epub_general_content_order',
                'epub_general_split_document', 'epub_general_footnotes_epub', 'epub_general_remove_forced_line_breaks', 'epub_general_bullets_epub',
                'epub_general_numbers_epub', 'epub_general_margins_epub'),
            ...ids('epub_object_preserve_appearance_from_layout', 'epub_object_resolution_epub_images', 'epub_object_size_epub_images',
                'epub_object_image_alignment_and_spacing_epub', 'epub_object_insert_page_break_epub', 'epub_object_ignore_object_export_settings',
                'epub_object_format_epub_images', 'epub_object_jpeg_options_epub', 'epub_object_gif_options_epub',
                'epub_object_use_existing_image_for_graphic_objects', 'epub_object_svg_export_epub'),
            ...ids('epub_css_preserve_local_overrides', 'epub_css_additional_css', 'epub_css_additional_javascript'),
            ...ids('epub_meta_identifier', 'epub_meta_creator', 'epub_meta_date_epub', 'epub_meta_description_epub', 'epub_meta_publisher',
                'epub_meta_rights', 'epub_meta_subject'),
            ...ids('epub_fxl_range_fixed_layout', 'epub_fxl_cover_fixed_layout', 'epub_fxl_navigation_toc_fixed_layout', 'epub_fxl_navigation_styles',
                'epub_fxl_spread_control', 'epub_fxl_image_format_fixed_layout', 'epub_fxl_additional_css_javascript_fixed_layout'),
            ...ids('epub_accessibility', 'accessible_indexes'),
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: {
            layout: 'reflowable', general: S(EPUB_GENERAL), images: S(EPUB_IMAGES), css: S(EPUB_CSS), fixedLayout: undefined,
            metadata: S(EPUB_METADATA), accessibility: S(EPUB_ACCESSIBILITY),
        },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const layout = enumOf(a.layout ?? 'reflowable', ['reflowable', 'fixed_layout'], { name: 'layout' });
            const fixed = layout === 'fixed_layout';
            if (fixed) refuse(a, ['general', 'images', 'css'], 'to a fixed-layout EPUB; use fixedLayout');
            else refuse(a, ['fixedLayout'], 'to a reflowable EPUB; use general, images and css');
            const sets = fixed
                ? [assign('prefs', EPUB_FIXED_LAYOUT, a.fixedLayout, 'fixedLayout')]
                : [assign('prefs', EPUB_GENERAL, a.general, 'general'), assign('prefs', EPUB_IMAGES, a.images, 'images'), assign('prefs', EPUB_CSS, a.css, 'css')];
            sets.push(assign('prefs', EPUB_METADATA, a.metadata, 'metadata'), assign('prefs', EPUB_ACCESSIBILITY, a.accessibility, 'accessibility'));
            return run('Export EPUB with options', formatScript(`
var prefs = doc.${fixed ? 'epubFixedLayoutExportPreferences' : 'epubExportPreferences'};
__keepPrefs(prefs);
var file = __outFile(${file});
try {
${sets.filter(Boolean).join('\n')}
  doc.exportFile(ExportFormat.${fixed ? 'FIXED_LAYOUT_EPUB' : 'EPUB'}, file, false);
} finally {
  ${restore(a.keepSettings)}
}
__result__ = { file: file.fsName, written: file.exists, layout: "${layout}", settingsKept: ${bool(a.keepSettings)} };`));
        },
    },
    {
        name: 'manage_epub_viewing_apps',
        description: 'List, add or remove the e-reader applications that open an EPUB after export (EPUB export dialog > View EPUB after Exporting > Viewing Apps). Applications must be inside the allowed directories',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'list the apps; add one; remove one by its index' },
                appPath: { type: 'string', description: 'add: the application (.app on macOS, .exe on Windows)' },
                reflowable: { type: 'boolean', default: true, description: 'add: use it for reflowable EPUB' },
                fixedLayout: { type: 'boolean', default: true, description: 'add: use it for fixed-layout EPUB' },
                appIndex: { type: 'integer', minimum: 0, description: 'remove: 0-based index from list' },
            },
            required: ['action'],
        },
        features: ids('epub_viewing_apps'),
        hints: { readOnly: false },
        auditArgs: { action: 'list' },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'add', 'remove'], { name: 'action' });
            let change = '';
            if (action === 'add') {
                if (typeof a.appPath !== 'string' || !/\.(app|exe)\/?$/i.test(a.appPath.trim())) throw new Error("'appPath' must be an application (.app or .exe)");
                change = `var appFile = File(${pathLit(a.appPath, 'appPath')});
if (!appFile.exists) throw new Error("Application not found: " + appFile.fsName);
prefs.addApplication(appFile.fsName, ${bool(a.reflowable ?? true)}, ${bool(a.fixedLayout ?? true)});`;
            } else if (action === 'remove') {
                change = `var at = ${index(a.appIndex, { name: 'appIndex', max: 1000 })};
if (at >= prefs.getApplicationCount()) throw new Error("No viewing app at index " + at);
prefs.removeApplication(at);`;
            }
            return run('EPUB viewing apps', formatScript(`
var prefs = app.epubViewingAppsPreferences;
${change}
var apps = [];
for (var i = 0; i < prefs.getApplicationCount(); i++) apps.push(String(prefs.getApplicationAtIndex(i)));
__result__ = { action: "${action}", apps: apps };`, { needsDocument: false }));
        },
    },
    {
        name: 'export_html',
        description: 'Export the document or selection as HTML with any option of the HTML Export dialog (content order, lists, images, CSS, JavaScript), or as HTML5 fixed layout (File > Export > HTML / HTML5)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('HTML file'),
                format: { type: 'string', enum: ['html', 'html5_fixed_layout'], default: 'html', description: 'HTML (reflowing content) or HTML5 fixed layout (pages as laid out)' },
                options: groupSchema(HTML_OPTIONS, 'HTML Export options (format html)'),
                fixedLayout: groupSchema(HTML_FIXED_LAYOUT, 'HTML5 fixed-layout options (format html5_fixed_layout)'),
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath'],
        },
        features: [
            ...ids('html_export_selection_or_document', 'html_content_order_html', 'html_bullets_html', 'html_numbers_html', 'html_view_html_using',
                'html_copy_images', 'html_preserve_appearance_from_layout_html', 'html_resolution_html_images', 'html_image_size_html',
                'html_image_alignment_and_spacing_html', 'html_image_format_html', 'html_ignore_object_export_settings_html', 'html_generate_css_html',
                'html_preserve_local_overrides_html', 'html_include_style_classes_in_html_html', 'html_additional_css_html',
                'html_link_to_external_javascript', 'html_svg_html'),
            ...ids('export_html', 'format_html', 'export_html5', 'format_html5'),
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { format: 'html', options: S(HTML_OPTIONS), fixedLayout: undefined },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const format = enumOf(a.format ?? 'html', ['html', 'html5_fixed_layout'], { name: 'format' });
            const fxl = format === 'html5_fixed_layout';
            if (fxl) refuse(a, ['options'], 'to HTML5 fixed layout; use fixedLayout');
            else refuse(a, ['fixedLayout'], 'to HTML; use options');
            const sets = fxl ? assign('prefs', HTML_FIXED_LAYOUT, a.fixedLayout, 'fixedLayout') : assign('prefs', HTML_OPTIONS, a.options, 'options');
            return run('Export HTML', formatScript(`
var prefs = doc.${fxl ? 'htmlFXLExportPreferences' : 'htmlExportPreferences'};
__keepPrefs(prefs);
var file = __outFile(${file});
try {
${sets}
  doc.exportFile(ExportFormat.${fxl ? 'HTMLFXL' : 'HTML'}, file, false);
} finally {
  ${restore(a.keepSettings)}
}
__result__ = { file: file.fsName, written: file.exists, format: "${format}", settingsKept: ${bool(a.keepSettings)} };`));
        },
    },
    {
        name: 'place_with_import_options',
        description: 'Place a Word, RTF, Excel, text or InDesign Tagged Text file (or any placeable file) with the options of its import dialog, on a page or into a frame; optionally apply a table style to imported tables and generate alt text for placed images (File > Place > Show Import Options)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'The file to place (inside the allowed directories)' },
                pageIndex: { type: 'integer', minimum: 0, default: 0, description: 'Page to place on (0-based), unless frameId is given' },
                x: { type: 'number', default: 10, description: 'Left of the placed content, mm from the page\'s left edge' },
                y: { type: 'number', default: 10, description: 'Top of the placed content, mm from the page\'s top edge' },
                frameId: { type: 'integer', minimum: 0, description: 'Place into this existing frame instead of onto the page' },
                autoflow: { type: 'boolean', default: false, description: 'Autoflow text, adding pages as needed' },
                word: groupSchema(WORD_IMPORT, 'Microsoft Word / RTF Import Options (.docx, .doc, .rtf)'),
                excel: groupSchema(EXCEL_IMPORT, 'Microsoft Excel Import Options (.xlsx, .xls)'),
                text: groupSchema(TEXT_IMPORT, 'Text Import Options (.txt)'),
                taggedText: groupSchema(TAGGED_TEXT_IMPORT, 'Tagged Text Import Options'),
                tableStyle: { type: 'string', description: 'Apply this table style to the tables the file brings in (Excel Import Options > Table Style)' },
                generateAltText: { type: 'boolean', description: 'Generate alt text for placed images with Adobe\'s generative AI (InDesign 2026 (21.5) or later; needs sign-in and network)' },
                markGeneratedAltText: { type: 'boolean', description: 'Tag generated alt text as generated by AI (with generateAltText)' },
                keepSettings: { type: 'boolean', default: false, description: 'Leave the import options in place for later placing (default: put the previous options back)' },
            },
            required: ['filePath'],
        },
        features: [
            ...ids('word_import_include_table_of_contents_text', 'word_import_include_index_text', 'word_import_include_footnotes',
                'word_import_include_endnotes', 'word_import_import_endnotes_as_static_text', 'word_import_use_typographer_s_quotes_word_import',
                'word_import_remove_styles_and_formatting_from_text_and_tables', 'word_import_preserve_local_overrides', 'word_import_convert_tables_to',
                'word_import_preserve_styles_and_formatting_from_text_and_tables', 'word_import_manual_page_breaks', 'word_import_import_inline_graphics',
                'word_import_import_unused_styles', 'word_import_track_changes_word_import', 'word_import_convert_bullets_and_numbers_to_text',
                'word_import_style_name_conflicts'),
            ...ids('text_import_character_set', 'text_import_platform', 'text_import_set_dictionary_to',
                'text_import_extra_carriage_returns_remove_at_end_of_every_line', 'text_import_extra_carriage_returns_remove_between_paragraphs',
                'text_import_replace_spaces_with_a_tab', 'text_import_use_typographer_s_quotes_text_import'),
            ...ids('excel_import_sheet', 'excel_import_view', 'excel_import_cell_range', 'excel_import_import_hidden_cells_not_saved_in_view',
                'excel_import_table_formatting', 'excel_import_table_style_excel_import', 'excel_import_cell_alignment',
                'excel_import_include_inline_graphics_excel', 'excel_import_number_of_decimal_places_to_include',
                'excel_import_use_typographer_s_quotes_excel_import'),
            ...ids('tagged_import_use_typographer_s_quotes_tagged_text', 'tagged_import_remove_text_formatting', 'tagged_import_resolve_text_style_conflicts_using'),
            ...ids('format_docx', 'format_xlsx', 'format_rtf', 'format_txt', 'format_tagged_text', 'generate_alt_text'),
        ],
        hints: { readOnly: false },
        auditArgs: {
            frameId: undefined, word: S(WORD_IMPORT), excel: S(EXCEL_IMPORT), text: S(TEXT_IMPORT), taggedText: S(TAGGED_TEXT_IMPORT),
            generateAltText: true, markGeneratedAltText: true,
        },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const groups = [
                ['word', 'app.wordRTFImportPreferences', WORD_IMPORT],
                ['excel', 'app.excelImportPreferences', EXCEL_IMPORT],
                ['text', 'app.textImportPreferences', TEXT_IMPORT],
                ['taggedText', 'app.taggedTextImportPreferences', TAGGED_TEXT_IMPORT],
            ].filter(([k]) => a[k] !== undefined);
            const sets = groups.map(([k, target, table]) => `__keepPrefs(${target});\n${assign(target, table, a[k], k)}`).join('\n');
            let where;
            if (a.frameId !== undefined) {
                where = `var frame = __item(doc, ${index(a.frameId, { name: 'frameId', max: 1e9 })});
  placed = frame.place(f, false);`;
            } else {
                const p = index(a.pageIndex ?? 0, { name: 'pageIndex' });
                where = `var page = __page(doc, ${p});
  placed = page.place(f, __toPage(page, ${num(a.x ?? 10, { name: 'x' })}, ${num(a.y ?? 10, { name: 'y' })}), doc.activeLayer, false, ${bool(a.autoflow)});`;
            }
            if (a.tableStyle !== undefined && (typeof a.tableStyle !== 'string' || !a.tableStyle || a.tableStyle.length > 300)) throw new Error("'tableStyle' must be a table style name");
            const alt = a.generateAltText !== undefined;
            if (a.markGeneratedAltText !== undefined && !alt) throw new Error("'markGeneratedAltText' goes with generateAltText");
            return run('Place with import options', formatScript(`
var f = File(${file});
if (!f.exists) throw new Error("File not found: " + f.fsName);
${a.tableStyle ? `var ts = doc.tableStyles.itemByName(${str(a.tableStyle)});
if (!ts.isValid) throw new Error(${str(`No table style named ${a.tableStyle}`)});` : ''}
var gp = app.generalPreferences, altBefore = null, tagBefore = null;
var placed = [];
try {
${sets}
${alt ? `  altBefore = gp["autoGenerateAltText"];
  __setNew(gp, "autoGenerateAltText", ${bool(a.generateAltText)}, "InDesign 2026 (21.5)");
${a.markGeneratedAltText !== undefined ? `  tagBefore = gp["addAITagToAltText"];
  __setNew(gp, "addAITagToAltText", ${bool(a.markGeneratedAltText)}, "InDesign 2026 (21.5)");` : ''}` : ''}
  ${where}
} finally {
  ${a.keepSettings ? '' : '__restorePrefs();'}
  if (altBefore !== null) { try { gp["autoGenerateAltText"] = altBefore; } catch (e) {} }
  if (tagBefore !== null) { try { gp["addAITagToAltText"] = tagBefore; } catch (e) {} }
}
var FRAMES = "|Rectangle|Oval|Polygon|GraphicLine|TextFrame|Group|";
var out = [], tablesStyled = 0;
for (var i = 0; i < placed.length; i++) {
  var it = placed[i], c = it.constructor.name, info;
  if (c === "Story") {
    info = { type: "Story", id: it.id, tables: it.tables.length, characters: it.characters.length };
  } else {
    var fr = FRAMES.indexOf("|" + c + "|") >= 0 ? it : it.parent;
    try { info = __itemInfo(fr); } catch (e) { info = { type: c }; }
    info.content = c;
    ${alt ? 'try { info.altText = fr.objectExportOptions.customAltText; info.altTextGenerationError = fr.objectExportOptions["altTextGenerationError"]; } catch (e) {}' : ''}
  }
  ${a.tableStyle ? `try { for (var j = 0; j < it.tables.length; j++) { it.tables[j].appliedTableStyle = ts; tablesStyled++; } } catch (e) {}` : ''}
  out.push(info);
}
__result__ = { file: f.fsName, placed: out${a.tableStyle ? ', tablesStyled: tablesStyled' : ''} };`));
        },
    },
    {
        name: 'export_story',
        description: 'Export a story or the selected text as Rich Text (.rtf), Text Only (.txt) with a chosen platform and encoding, InDesign Tagged Text, or an InCopy document (.icml) (File > Export with text selected)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('file'),
                format: { type: 'string', enum: ['rtf', 'text', 'tagged_text', 'incopy'], description: 'Rich Text Format, Text Only, InDesign Tagged Text, or InCopy Document' },
                frameId: { type: 'integer', minimum: 0, description: 'A text frame of the story to export' },
                selectedText: { type: 'boolean', description: 'Export the selected text instead of a whole story (not for incopy)' },
                text: groupSchema(TEXT_EXPORT, 'Text Export Options (format text): platform and encoding'),
                taggedText: groupSchema(TAGGED_TEXT_EXPORT, 'Tagged Text Export Options (format tagged_text)'),
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath', 'format'],
        },
        features: ids('text_export_platform_text_export', 'text_export_encoding_text_export', 'text_export_tagged_text_encoding',
            'text_export_tagged_text_form', 'save_with_encoding', 'format_rtf', 'format_txt', 'format_tagged_text', 'format_icml'),
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { format: 'text', frameId: 1, selectedText: undefined, text: S(TEXT_EXPORT), taggedText: undefined },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const format = enumOf(a.format, ['rtf', 'text', 'tagged_text', 'incopy'], { name: 'format' });
            if ((a.frameId === undefined) === !a.selectedText) throw new Error('Give frameId or selectedText: true (one of them)');
            if (format === 'incopy' && a.selectedText) throw new Error('InCopy export takes a whole story: give frameId');
            if (format !== 'text') refuse(a, ['text'], `to ${format}`);
            if (format !== 'tagged_text') refuse(a, ['taggedText'], `to ${format}`);
            const EF = { rtf: 'RTF', text: 'TEXT_TYPE', tagged_text: 'TAGGED_TEXT', incopy: 'INCOPY_MARKUP' }[format];
            const prefs = format === 'text' ? ['app.textExportPreferences', TEXT_EXPORT, a.text, 'text']
                : format === 'tagged_text' ? ['app.taggedTextExportPreferences', TAGGED_TEXT_EXPORT, a.taggedText, 'taggedText'] : null;
            const source = a.selectedText
                ? `var sel = app.selection;
if (sel.length !== 1 || "|Text|Character|Word|Line|Paragraph|TextColumn|TextStyleRange|".indexOf("|" + sel[0].constructor.name + "|") < 0) throw new Error("Select some text first");
var src = sel[0];`
                : `var fr = __item(doc, ${index(a.frameId, { name: 'frameId', max: 1e9 })});
if (fr.constructor.name !== "TextFrame") throw new Error("Item " + fr.id + " is a " + fr.constructor.name + ", not a text frame");
var src = fr.parentStory;`;
            return run('Export story', formatScript(`
${source}
var file = __outFile(${file});
${prefs ? `__keepPrefs(${prefs[0]});` : ''}
try {
${prefs ? assign(prefs[0], prefs[1], prefs[2], prefs[3]) : ''}
  src.exportFile(ExportFormat.${EF}, file);
} finally {
  ${restore(a.keepSettings)}
}
__result__ = { file: file.fsName, written: file.exists, format: "${format}", characters: src.characters.length };`));
        },
    },
    {
        name: 'set_object_export_options',
        description: 'Set or read Object Export Options on items: alt text and its source, PDF tagging and actual text, and EPUB/HTML conversion (custom rasterization, size, resolution, format, alignment and spacing, page breaks, layout, epub:type, ARIA role and label) (Object > Object Export Options). With no option groups, reports the current settings',
        inputSchema: {
            type: 'object',
            properties: {
                target: TARGET_SCHEMA,
                altText: groupSchema(OEO_ALT_TEXT, 'Alt Text tab'),
                pdf: groupSchema(OEO_PDF, 'Tagged PDF tab'),
                epub: groupSchema(OEO_EPUB, 'EPUB and HTML tab'),
            },
            required: ['target'],
        },
        features: [
            ...ids('object_export_options', 'context_object_export_options_context', 'oeo_alt_alt_text_source', 'oeo_alt_custom_alt_text',
                'oeo_pdf_apply_tag', 'oeo_pdf_actual_text_source', 'oeo_pdf_custom_actual_text', 'oeo_epub_custom_rasterization',
                'oeo_epub_size_rasterization', 'oeo_epub_resolution_rasterization', 'oeo_epub_format_rasterization', 'oeo_epub_quality_method_jpeg',
                'oeo_epub_palette_interlace_gif', 'oeo_epub_custom_image_alignment_and_spacing', 'oeo_epub_insert_page_break',
                'oeo_epub_custom_layout', 'oeo_epub_epub_type', 'oeo_epub_aria_role_and_label'),
            ...ids('accessible_pdf', 'epub_accessibility'),
        ],
        hints: { readOnly: false, idempotent: true },
        auditArgs: { target: { ids: [1] }, altText: S(OEO_ALT_TEXT), pdf: S(OEO_PDF), epub: S(OEO_EPUB) },
        handler: (a) => {
            const sets = [assign('o', OEO_ALT_TEXT, a.altText, 'altText'), assign('o', OEO_PDF, a.pdf, 'pdf'), assign('o', OEO_EPUB, a.epub, 'epub')].filter(Boolean).join('\n');
            return run('Object export options', formatScript(`
var items = __targets(doc, ${targetSpec(a.target)}), out = [];
for (var i = 0; i < items.length; i++) {
  var o = items[i].objectExportOptions;
${sets}
  var info = { id: items[i].id, type: items[i].constructor.name,
    altTextSourceType: __enumName(o.altTextSourceType), customAltText: o.customAltText,
    applyTagType: __enumName(o.applyTagType), actualTextSourceType: __enumName(o.actualTextSourceType), customActualText: o.customActualText,
    preserveAppearanceFromLayout: __enumName(o.preserveAppearanceFromLayout), imageConversionType: __enumName(o.imageConversionType),
    sizeType: __enumName(o.sizeType), customLayout: o.customLayout, epubType: o.epubType };
  try { info.altText = o.altText(); } catch (e) {}
  try { info.actualText = o.actualText(); } catch (e) {}
  out.push(info);
}
__result__ = { changed: ${bool(sets.length > 0)}, items: out };`));
        },
    },
    {
        name: 'manage_articles',
        description: 'Work with the Articles panel: list articles and their members, create an article, add items or all document content, include or exclude it when exporting, rename, reorder, remove members, delete, and use articles for the reading order of tagged PDF (Window > Articles)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'add_items', 'add_all_content', 'set_export_status', 'rename', 'move', 'remove_items', 'delete', 'set_reading_order'], description: 'What to do' },
                article: { type: 'string', description: 'Article name (all actions but list and set_reading_order)' },
                items: { ...TARGET_SCHEMA, description: 'create / add_items / remove_items: the page items (ids, names or selection: true)' },
                includeWhenExporting: { type: 'boolean', description: 'create / set_export_status: Include When Exporting (default true on create)' },
                newName: { type: 'string', description: 'rename: the new name' },
                position: { type: 'string', enum: ['first', 'last', 'before', 'after'], description: 'move: where the article goes in the panel' },
                reference: { type: 'string', description: 'move with before / after: the other article' },
                readingOrder: { type: 'string', enum: ['USE_ARTICLES', 'USE_XML_STRUCTURE'], description: 'set_reading_order: Use for Reading Order in Tagged PDF (articles) or the XML structure' },
            },
            required: ['action'],
        },
        features: ids('articles_panel', 'articles_menu_new_article', 'articles_menu_add_selection_to_articles', 'articles_menu_include_when_exporting',
            'articles_menu_use_for_reading_order_in_tagged_pdf', 'reading_order', 'tagged_pdf'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'create', article: 'Story', items: { ids: [1, 2] }, includeWhenExporting: true },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'create', 'add_items', 'add_all_content', 'set_export_status', 'rename', 'move', 'remove_items', 'delete', 'set_reading_order'], { name: 'action' });
            const name = () => {
                if (typeof a.article !== 'string' || !a.article.trim() || a.article.length > 300) throw new Error(`'article' is required for ${action}`);
                return str(a.article);
            };
            const find = () => `var art = doc.articles.itemByName(${name()});
if (!art.isValid) throw new Error("No article named " + ${name()});`;
            const statusBool = () => {
                if (typeof a.includeWhenExporting !== 'boolean') throw new Error(`'includeWhenExporting' (true or false) is required for ${action}`);
                return bool(a.includeWhenExporting);
            };
            let body = '';
            if (action === 'create') {
                const status = a.includeWhenExporting === undefined ? 'true' : statusBool();
                body = `if (doc.articles.itemByName(${name()}).isValid) throw new Error("An article named " + ${name()} + " already exists");
var art = doc.articles.add(${name()}, ${status});
${a.items ? `var its = __targets(doc, ${targetSpec(a.items)});
for (var i = 0; i < its.length; i++) art.articleMembers.add(its[i]);` : ''}`;
            } else if (action === 'add_items') {
                body = `${find()}
var its = __targets(doc, ${targetSpec(a.items)});
for (var i = 0; i < its.length; i++) art.articleMembers.add(its[i]);`;
            } else if (action === 'add_all_content') {
                body = `${find()}\nart.addDocumentContent();`;
            } else if (action === 'set_export_status') {
                body = `${find()}\nart.articleExportStatus = ${statusBool()};`;
            } else if (action === 'rename') {
                if (typeof a.newName !== 'string' || !a.newName.trim() || a.newName.length > 300) throw new Error("'newName' is required for rename");
                body = `${find()}\nart.name = ${str(a.newName)};`;
            } else if (action === 'move') {
                const pos = enumOf(a.position, ['first', 'last', 'before', 'after'], { name: 'position' });
                let ref;
                if (pos === 'first' || pos === 'last') ref = `doc.articles.${pos === 'first' ? 'firstItem' : 'lastItem'}()`;
                else {
                    if (typeof a.reference !== 'string' || !a.reference) throw new Error(`'reference' is required to move ${pos} another article`);
                    ref = `doc.articles.itemByName(${str(a.reference)})`;
                }
                body = `${find()}
var ref = ${ref};
if (!ref.isValid) throw new Error("Reference article not found");
if (ref.id !== art.id) art.move(LocationOptions.${pos === 'first' || pos === 'before' ? 'BEFORE' : 'AFTER'}, ref);`;
            } else if (action === 'remove_items') {
                body = `${find()}
var its = __targets(doc, ${targetSpec(a.items)}), want = {}, removed = 0;
for (var i = 0; i < its.length; i++) want[its[i].id] = true;
var ms = art.articleMembers.everyItem().getElements();
for (var m = ms.length - 1; m >= 0; m--) { if (want[ms[m].itemRef.id]) { ms[m].remove(); removed++; } }`;
            } else if (action === 'delete') {
                body = `${find()}\nart.remove();`;
            } else if (action === 'set_reading_order') {
                body = `doc.taggedPDFPreferences.structureOrder = TaggedPDFStructureOrderOptions.${enumOf(a.readingOrder, ['USE_ARTICLES', 'USE_XML_STRUCTURE'], { name: 'readingOrder' })};`;
            }
            return run('Manage articles', formatScript(`
${body}
var list = [], arts = doc.articles.everyItem().getElements();
for (var a = 0; a < arts.length; a++) {
  var members = [], ms2 = arts[a].articleMembers.everyItem().getElements();
  for (var k = 0; k < ms2.length; k++) { try { members.push({ id: ms2[k].itemRef.id, type: ms2[k].itemRef.constructor.name }); } catch (e) {} }
  list.push({ name: arts[a].name, includeWhenExporting: arts[a].articleExportStatus, members: members });
}
__result__ = { action: "${action}", readingOrder: __enumName(doc.taggedPDFPreferences.structureOrder), articles: list${action === 'remove_items' ? ', removed: removed' : ''} };`));
        },
    },
    {
        name: 'export_image_file',
        description: 'Export pages or spreads as JPEG, PNG or EPS with every option of the export dialog: quality, format method, resolution, colour space, profile, anti-aliasing, bleed, overprint, transparent background, PostScript level, preview, fonts, OPI and flattener (File > Export > JPEG / PNG / EPS)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: OUT_SCHEMA('file (with several pages InDesign numbers the files)'),
                format: { type: 'string', enum: ['jpeg', 'png', 'eps'], description: 'Image format' },
                pages: PAGES_SCHEMA,
                spreads: { type: 'boolean', default: false, description: 'Export spreads instead of pages' },
                jpeg: groupSchema(JPEG_EXPORT, 'Export JPEG options (format jpeg)'),
                png: groupSchema(PNG_EXPORT, 'Export PNG options (format png)'),
                eps: groupSchema(EPS_EXPORT, 'Export EPS options (format eps)'),
                keepSettings: KEEP_SCHEMA,
            },
            required: ['filePath', 'format'],
        },
        features: [
            ...ids('jpeg_format_method', 'jpeg_color_space_jpeg', 'jpeg_embed_color_profile', 'jpeg_anti_alias_jpeg',
                'jpeg_use_document_bleed_settings_jpeg', 'jpeg_simulate_overprint_jpeg'),
            ...ids('png_color_space_png', 'png_transparent_background', 'png_anti_alias_png', 'png_use_document_bleed_settings_png', 'png_simulate_overprint_png'),
            ...ids('eps_export_pages_eps', 'eps_export_spreads_eps', 'eps_export_postscript_level_eps', 'eps_export_color_eps', 'eps_export_preview_eps',
                'eps_export_embed_fonts_eps', 'eps_export_data_format_eps', 'eps_export_images_eps', 'eps_export_opi_eps',
                'eps_export_transparency_flattener_eps', 'eps_export_bleed_eps'),
            ...ids('format_eps'),
        ],
        hints: { readOnly: false, destructive: true, idempotent: true },
        auditArgs: { format: 'eps', pages: '1-2', jpeg: undefined, png: undefined, eps: S(EPS_EXPORT) },
        handler: (a) => {
            const file = pathLit(a.filePath);
            const format = enumOf(a.format, ['jpeg', 'png', 'eps'], { name: 'format' });
            refuse(a, ['jpeg', 'png', 'eps'].filter((g) => g !== format), `to ${format}`);
            const pages = pageRange(a.pages);
            const spreads = bool(a.spreads);
            let setup;
            if (format === 'jpeg') {
                setup = `var prefs = app.jpegExportPreferences;
__keepPrefs(prefs);
try {
  ${pages ? `prefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE; prefs.pageString = ${str(pages)};` : 'prefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_ALL;'}
  prefs.exportingSpread = ${spreads};
${assign('prefs', JPEG_EXPORT, a.jpeg, 'jpeg')}
  doc.exportFile(ExportFormat.JPG, file, false);`;
            } else if (format === 'png') {
                setup = `var prefs = app.pngExportPreferences;
__keepPrefs(prefs);
try {
  ${pages ? `prefs.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE; prefs.pageString = ${str(pages)};` : 'prefs.pngExportRange = PNGExportRangeEnum.EXPORT_ALL;'}
  prefs.exportingSpread = ${spreads};
${assign('prefs', PNG_EXPORT, a.png, 'png')}
  doc.exportFile(ExportFormat.PNG_FORMAT, file, false);`;
            } else {
                setup = `var prefs = app.epsExportPreferences;
__keepPrefs(prefs);
try {
  prefs.pageRange = ${pages ? str(pages) : 'PageRange.ALL_PAGES'};
  prefs.epsSpreads = ${spreads};
${assign('prefs', EPS_EXPORT, a.eps, 'eps')}
  doc.exportFile(ExportFormat.EPS_TYPE, file, false);`;
            }
            return run('Export image file', formatScript(`
var file = __outFile(${file});
${setup}
} finally {
  ${restore(a.keepSettings)}
}
__result__ = { file: file.fsName, written: file.exists, format: "${format}", pages: ${pages ? str(pages) : '"all"'}, spreads: ${spreads}, settingsKept: ${bool(a.keepSettings)} };`));
        },
    },
    {
        name: 'transfer_resource_file',
        description: 'Open or create an object library (.indl), load or save a preflight profile (.idpp), load or save swatches (.ase), or export items as a snippet (.idms) (Library panel, Preflight panel, Swatches panel, File > Export > InDesign Snippet)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['open_library', 'create_library', 'load_preflight_profile', 'save_preflight_profile', 'load_swatches', 'save_swatches', 'export_snippet'], description: 'What to do' },
                filePath: { type: 'string', description: 'The file to read or write (inside the allowed directories)' },
                profileName: { type: 'string', description: 'save_preflight_profile: the profile to save' },
                swatches: { type: 'array', items: { type: 'string' }, description: 'save_swatches: swatch names (default: every swatch except the built-in [bracketed] ones)' },
                target: { ...TARGET_SCHEMA, description: 'export_snippet: the items to export (ids, names or selection: true)' },
            },
            required: ['action', 'filePath'],
        },
        features: ids('format_indl', 'format_idpp', 'format_ase', 'export_selection_snippet'),
        hints: { readOnly: false, destructive: true },
        auditArgs: { action: 'export_snippet', target: { ids: [1, 2] }, swatches: undefined },
        handler: (a) => {
            const action = enumOf(a.action, ['open_library', 'create_library', 'load_preflight_profile', 'save_preflight_profile', 'load_swatches', 'save_swatches', 'export_snippet'], { name: 'action' });
            const file = pathLit(a.filePath);
            const reading = ['open_library', 'load_preflight_profile', 'load_swatches'].includes(action);
            let body;
            let needsDocument = true;
            if (action === 'open_library') {
                needsDocument = false;
                body = `var lib = app.open(f);
__result__ = { library: lib.name, assets: lib.assets.length };`;
            } else if (action === 'create_library') {
                needsDocument = false;
                body = `if (f.exists) throw new Error("File already exists: " + f.fsName);
var lib = app.libraries.add(f);
__result__ = { library: lib.name, file: f.fsName };`;
            } else if (action === 'load_preflight_profile') {
                needsDocument = false;
                body = `var prof = app.loadPreflightProfile(f);
__result__ = { profile: prof.name };`;
            } else if (action === 'save_preflight_profile') {
                needsDocument = false;
                if (typeof a.profileName !== 'string' || !a.profileName || a.profileName.length > 300) throw new Error("'profileName' is required for save_preflight_profile");
                body = `var prof = app.preflightProfiles.itemByName(${str(a.profileName)});
if (!prof.isValid) throw new Error(${str(`No preflight profile named ${a.profileName}`)});
prof.save(f);
__result__ = { profile: prof.name, file: f.fsName, written: f.exists };`;
            } else if (action === 'load_swatches') {
                body = `var before = doc.swatches.length;
doc.loadSwatches(f);
__result__ = { file: f.fsName, added: doc.swatches.length - before };`;
            } else if (action === 'save_swatches') {
                let pick;
                if (a.swatches !== undefined) {
                    if (!Array.isArray(a.swatches) || !a.swatches.length || a.swatches.some((s) => typeof s !== 'string' || !s)) throw new Error("'swatches' must be a list of swatch names");
                    pick = `var names = ${json(a.swatches)}, list = [];
for (var i = 0; i < names.length; i++) { var s = doc.swatches.itemByName(names[i]); if (!s.isValid) throw new Error("No swatch named " + names[i]); list.push(s); }`;
                } else {
                    pick = `var all = doc.swatches.everyItem().getElements(), list = [];
for (var i = 0; i < all.length; i++) if (all[i].name.charAt(0) !== "[") list.push(all[i]);`;
                }
                body = `${pick}
if (!list.length) throw new Error("No swatches to save");
doc.saveSwatches(f, list, "", false);
__result__ = { file: f.fsName, written: f.exists, swatches: list.length };`;
            } else {
                body = `var its = __targets(doc, ${targetSpec(a.target)});
var prev = app.selection;
app.select(its);
try { doc.exportPageItemsSelectionToSnippet(f); }
finally { try { app.select(prev.length ? prev : NothingEnum.NOTHING); } catch (e) {} }
__result__ = { file: f.fsName, written: f.exists, items: its.length };`;
            }
            return run('Transfer resource file', formatScript(`
var f = ${reading ? `File(${file});
if (!f.exists) throw new Error("File not found: " + f.fsName);` : `__outFile(${file});`}
${body}`, { needsDocument }));
        },
    },
];
