/**
 * Documents: new documents with every New Document option, document presets,
 * Save a Copy, Save All, Revert, Close All, saving for earlier versions (IDML),
 * File Info, document windows, and margins and columns.
 *
 * Option objects are keyed by the object-model property names. Measurements
 * are millimetres.
 */
import { str, num, bool, enumOf, index, json } from 'adobe-mcp-core';
import { run } from './run.js';
import { B, N, S, E, groupSchema, assign } from './formatOptions.js';
import { commandScript, pathLit, has, nameArg } from './commands.js';

const D = 'indesign.documents.';
const ids = (...names) => names.map((n) => D + n);

/** Document preset and New Document settings (DocumentPreset). */
export const PRESET_SETTINGS = {
    pageWidth: N('Page width, mm', 0.4, 5486.4),
    pageHeight: N('Page height, mm', 0.4, 5486.4),
    pageOrientation: E('PageOrientation', ['PORTRAIT', 'LANDSCAPE'], 'Orientation'),
    pagesPerDocument: N('Number of pages', 1, 9999),
    facingPages: B('Facing pages'),
    startPageNumber: N('Start # (first page number)', 1, 999999),
    createPrimaryTextFrame: B('Primary Text Frame on the parent page'),
    intent: E('DocumentIntentOptions', ['PRINT_INTENT', 'WEB_INTENT', 'MOBILE_INTENT'], 'Intent: the Print / Web / Mobile preset category'),
    columnCount: N('Columns', 1, 216),
    columnGutter: N('Column gutter, mm', 0, 1500),
    top: N('Top margin, mm', 0, 5486.4),
    bottom: N('Bottom margin, mm', 0, 5486.4),
    left: N('Left (inside, with facing pages) margin, mm', 0, 5486.4),
    right: N('Right (outside, with facing pages) margin, mm', 0, 5486.4),
    documentBleedUniformSize: B('Use the same bleed on every side'),
    documentBleedTopOffset: N('Top bleed, mm', 0, 152.4),
    documentBleedBottomOffset: N('Bottom bleed, mm', 0, 152.4),
    documentBleedInsideOrLeftOffset: N('Inside (left) bleed, mm', 0, 152.4),
    documentBleedOutsideOrRightOffset: N('Outside (right) bleed, mm', 0, 152.4),
    documentSlugUniformSize: B('Use the same slug on every side'),
    slugTopOffset: N('Top slug, mm', 0, 152.4),
    slugBottomOffset: N('Bottom slug, mm', 0, 152.4),
    slugInsideOrLeftOffset: N('Inside (left) slug, mm', 0, 152.4),
    slugRightOrOutsideOffset: N('Outside (right) slug, mm', 0, 152.4),
};
const WHOLE = ['pagesPerDocument', 'startPageNumber', 'columnCount'];
const MARGINS = ['top', 'bottom', 'left', 'right'];

/** Ruler units (MeasurementUnits) a new document can show. */
export const UNITS = ['MILLIMETERS', 'CENTIMETERS', 'INCHES', 'INCHES_DECIMAL', 'POINTS', 'AMERICAN_POINTS', 'PICAS', 'PIXELS', 'CICEROS', 'AGATES', 'Q', 'HA', 'BAI', 'MILS', 'U'];

const SETTINGS_SCHEMA = groupSchema(PRESET_SETTINGS, 'New Document / Document Preset settings, by object-model name (DocumentPreset); measurements in mm');
const MARGIN_SCHEMA = { type: 'number', minimum: 0, maximum: 5486.4, description: 'One margin for all four sides, mm ("Make all settings the same"); not together with top/bottom/left/right' };

/** Assignments of settings (and an all-sides margin) to the preset `target`. */
function presetStatements(target, settings, margin) {
    const s = settings ?? {};
    if (typeof s !== 'object' || Array.isArray(s)) throw new Error("'settings' must be an object of options");
    for (const k of WHOLE) if (has(s[k]) && !Number.isInteger(s[k])) throw new Error(`'settings.${k}' must be a whole number`);
    const lines = [assign(target, PRESET_SETTINGS, s, 'settings')];
    if (has(margin)) {
        if (MARGINS.some((k) => has(s[k]))) throw new Error("Give 'margin' (all sides the same) or settings.top/bottom/left/right, not both");
        const m = num(margin, { min: 0, max: 5486.4, name: 'margin' });
        lines.push(MARGINS.map((k) => `${target}.${k} = ${m};`).join(' '));
    }
    return lines.filter(Boolean).join('\n');
}

const PRESET_NAMES = json(Object.keys(PRESET_SETTINGS));

/** Read a preset's settings. */
const READ_PRESET = String.raw`
var __presetInfo = function (p, names) {
  var o = { name: p.name };
  for (var i = 0; i < names.length; i++) {
    var v = p[names[i]];
    o[names[i]] = (typeof v === "object" && v !== null && !(v instanceof Array)) ? __enumName(v) : v;
  }
  return o;
};
`;

const FILE_COMMANDS = ['save_a_copy', 'save_all', 'revert', 'close_all', 'save_for_earlier_versions', 'remove_from_recent'];

const FILE_INFO = {
    documentTitle: S('Document Title', 2000),
    author: S('Author', 2000),
    description: S('Description', 20000),
    jobName: S('Job name', 2000),
    copyrightStatus: E('CopyrightStatus', ['UNKNOWN', 'YES', 'NO'], 'Copyright Status'),
    copyrightNotice: S('Copyright Notice', 20000),
    copyrightInfoURL: S('Copyright Info URL', 2000),
};

/** Window > Arrange commands. */
const WINDOW_ACTIONS = ['list', 'new_window', 'tile', 'cascade', 'minimize', 'consolidate_all', 'next_window', 'previous_window'];

const MARGIN_FIELDS = {
    top: N('Top margin, mm', 0, 5486.4),
    bottom: N('Bottom margin, mm', 0, 5486.4),
    left: N('Left (inside) margin, mm', 0, 5486.4),
    right: N('Right (outside) margin, mm', 0, 5486.4),
    columnCount: N('Number of columns', 1, 216),
    columnGutter: N('Gutter, mm', 0, 1500),
    columnDirection: E('HorizontalOrVertical', ['HORIZONTAL', 'VERTICAL'], 'Column direction'),
    customColumns: B('Keep custom (dragged) column guide positions; false spaces columns evenly'),
};

export const tools = [
    {
        name: 'create_document_with_options',
        description: 'Create a document with the options of the New Document dialog (File > New > Document): start from a document preset, set the intent (Print / Web / Mobile preset category), ruler units, page size, pages, facing pages, Start #, primary text frame, columns and gutter, margins (or one value for all sides), bleed and slug, and optionally save the settings as a document preset. With no options it makes a new default document without the dialog',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', description: 'Document preset to start from, e.g. "[Default]" or a saved preset name' },
                settings: SETTINGS_SCHEMA,
                margin: MARGIN_SCHEMA,
                units: { type: 'string', enum: UNITS, description: 'Ruler units for the new document (horizontal and vertical)' },
                savePreset: { type: 'string', description: 'Save these settings as a new document preset with this name (Save Document Preset)' },
            },
        },
        features: ids(
            'new_default_document', 'newdoc_preset_category_print_web_mobile', 'newdoc_units_new_document', 'newdoc_start',
            'newdoc_primary_text_frame_new_document', 'newdoc_columns_new_document', 'newdoc_column_gutter_new_document', 'newdoc_save_document_preset',
        ),
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { settings: { pageWidth: 210, pageHeight: 297, pagesPerDocument: 4, facingPages: true, startPageNumber: 3, createPrimaryTextFrame: true, intent: 'PRINT_INTENT', columnCount: 2, columnGutter: 5 }, margin: 15 },
        handler: (a) => {
            const body = presetStatements('p', a.settings, a.margin);
            const units = has(a.units) ? enumOf(a.units, UNITS, { name: 'units' }) : null;
            const preset = has(a.preset) ? nameArg(a.preset, 'preset') : null;
            const keep = has(a.savePreset) ? nameArg(a.savePreset, 'savePreset') : null;
            const plain = !body && !preset && !keep;
            return run('Create document', commandScript(`
${plain ? 'var d = app.documents.add(true);' : `
var base = ${preset ? `app.documentPresets.itemByName(${str(preset)})` : 'null'};
if (base !== null && !base.isValid) throw new Error("No document preset named " + ${str(preset ?? '')});
var keep = ${keep ? str(keep) : 'null'};
if (keep !== null && app.documentPresets.itemByName(keep).isValid) throw new Error("A document preset named " + keep + " already exists; change it with manage_document_presets");
var pname = keep !== null ? keep : "New document " + new Date().getTime();
var p;
if (base !== null) { p = base.duplicate(); p.name = pname; } else p = app.documentPresets.add({ name: pname });
var d;
try {
${body}
  d = app.documents.add(true, p);
} finally {
  if (keep === null) { try { p.remove(); } catch (e) {} }
}`}
${units ? `d.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.${units};\nd.viewPreferences.verticalMeasurementUnits = MeasurementUnits.${units};` : ''}
var dp = d.documentPreferences, mp = d.marginPreferences;
__result__ = {
  name: d.name, pages: d.pages.length, pageWidth: dp.pageWidth, pageHeight: dp.pageHeight, facingPages: dp.facingPages,
  startPageNumber: dp.startPageNumber, intent: __enumName(dp.intent), columnCount: mp.columnCount, columnGutter: mp.columnGutter,
  margins: { top: mp.top, bottom: mp.bottom, left: mp.left, right: mp.right },
  units: __enumName(d.viewPreferences.horizontalMeasurementUnits), presetSaved: ${keep ? str(keep) : 'null'}
};`, { needsDocument: false }));
        },
    },
    {
        name: 'manage_document_presets',
        description: 'List, read, save (create or update), delete document presets, or save the active document\'s setup as a preset (File > Document Presets > Define)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'get', 'save', 'delete', 'save_from_document'], description: 'list every preset; get one; save creates or updates one from settings; delete one; save_from_document stores the active document\'s page size, pages, columns, margins, bleed and slug' },
                name: { type: 'string', description: 'Preset name (for get, save, delete and save_from_document)' },
                settings: SETTINGS_SCHEMA,
                margin: MARGIN_SCHEMA,
            },
            required: ['action'],
        },
        features: ids('document_presets'),
        hints: { readOnly: false, destructive: true, idempotent: false },
        handler: (a) => {
            const action = enumOf(a.action, ['list', 'get', 'save', 'delete', 'save_from_document'], { name: 'action' });
            if (action === 'list') {
                return run('List document presets', commandScript(`${READ_PRESET}
var out = [];
for (var i = 0; i < app.documentPresets.length; i++) out.push(__presetInfo(app.documentPresets[i], ["pageWidth", "pageHeight", "pagesPerDocument", "facingPages", "columnCount", "intent"]));
__result__ = { presets: out };`, { needsDocument: false }));
            }
            const name = nameArg(a.name, 'name');
            if (action === 'get') {
                return run('Read document preset', commandScript(`${READ_PRESET}
var p = app.documentPresets.itemByName(${str(name)});
if (!p.isValid) throw new Error("No document preset named " + ${str(name)});
__result__ = __presetInfo(p, ${PRESET_NAMES});`, { needsDocument: false }));
            }
            if (action === 'delete') {
                if (/^\[.*\]$/.test(name)) throw new Error(`${name} is a built-in preset and cannot be deleted`);
                return run('Delete document preset', commandScript(`
var p = app.documentPresets.itemByName(${str(name)});
if (!p.isValid) throw new Error("No document preset named " + ${str(name)});
p.remove();
__result__ = { deleted: ${str(name)} };`, { needsDocument: false }));
            }
            if (action === 'save_from_document') {
                return run('Save document preset', commandScript(`${READ_PRESET}
var p = app.documentPresets.itemByName(${str(name)});
if (!p.isValid) p = app.documentPresets.add({ name: ${str(name)} });
var dp = doc.documentPreferences, mp = doc.marginPreferences;
var fromDoc = ["pageWidth", "pageHeight", "pageOrientation", "facingPages", "startPageNumber", "intent", "documentBleedUniformSize",
  "documentBleedTopOffset", "documentBleedBottomOffset", "documentBleedInsideOrLeftOffset", "documentBleedOutsideOrRightOffset",
  "documentSlugUniformSize", "slugTopOffset", "slugBottomOffset", "slugInsideOrLeftOffset", "slugRightOrOutsideOffset", "createPrimaryTextFrame"];
for (var i = 0; i < fromDoc.length; i++) { try { p[fromDoc[i]] = dp[fromDoc[i]]; } catch (e) {} }
p.pagesPerDocument = doc.pages.length;
var fromMargins = ["top", "bottom", "left", "right", "columnCount", "columnGutter"];
for (var j = 0; j < fromMargins.length; j++) p[fromMargins[j]] = mp[fromMargins[j]];
__result__ = __presetInfo(p, ${PRESET_NAMES});`));
            }
            const body = presetStatements('p', a.settings, a.margin);
            if (!body) throw new Error('Nothing to save: pass settings or margin');
            if (/^\[.*\]$/.test(name) && name !== '[Default]') throw new Error(`${name} is a built-in preset and cannot be changed`);
            return run('Save document preset', commandScript(`${READ_PRESET}
var p = app.documentPresets.itemByName(${str(name)}), created = false;
if (!p.isValid) { p = app.documentPresets.add({ name: ${str(name)} }); created = true; }
${body}
var info = __presetInfo(p, ${PRESET_NAMES});
info.created = created;
__result__ = info;`, { needsDocument: false }));
        },
    },
    {
        name: 'run_file_command',
        description: 'File menu commands on documents: Save a Copy (the open document keeps its name), Save All (every open document that has a file), Revert (back to the last save), Close All (saving or discarding changes), save for earlier InDesign versions as IDML, or remove a file from File > Open Recent (the recent list itself cannot be read by scripts)',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: FILE_COMMANDS, description: 'The command to run' },
                filePath: { type: 'string', description: 'For save_a_copy: an .indd or .indt file; for save_for_earlier_versions: an .idml file; for remove_from_recent: the file to drop from the recent list' },
                saving: { type: 'string', enum: ['discard', 'save'], description: 'For close_all: discard unsaved changes, or save every document first (documents never saved to a file are refused)', default: 'discard' },
            },
            required: ['command'],
        },
        features: ids('save_a_copy', 'save_all', 'revert', 'close_all', 'versions_save_backward', 'open_recent'),
        hints: { readOnly: false, destructive: true, idempotent: false },
        auditArgs: { command: 'save_a_copy', filePath: `${process.env.HOME ?? '/tmp'}/Documents/audit-copy.indd` },
        handler: (a) => {
            const command = enumOf(a.command, FILE_COMMANDS, { name: 'command' });
            const ext = (re, what) => {
                if (typeof a.filePath !== 'string' || !re.test(a.filePath)) throw new Error(`'filePath' must be ${what}`);
                return pathLit(a.filePath);
            };
            switch (command) {
                case 'save_a_copy': {
                    const p = ext(/\.(indd|indt)$/i, 'an .indd or .indt file');
                    return run('Save a copy', commandScript(`
doc.saveACopy(File(${p}), ${bool(/\.indt$/i.test(a.filePath))});
__result__ = { document: doc.name, copy: File(${p}).fsName };`));
                }
                case 'save_for_earlier_versions': {
                    const p = ext(/\.idml$/i, 'an .idml file');
                    return run('Save for earlier versions', commandScript(`
doc.exportFile(ExportFormat.INDESIGN_MARKUP, File(${p}));
__result__ = { document: doc.name, idml: File(${p}).fsName };`));
                }
                case 'remove_from_recent': {
                    const p = pathLit(a.filePath);
                    return run('Remove from Open Recent', commandScript(`
__result__ = { file: File(${p}).fsName, removed: app.removeFileFromRecentFiles(File(${p})) };`, { needsDocument: false }));
                }
                case 'revert':
                    return run('Revert', commandScript(`
if (!doc.saved) throw new Error("The document has never been saved, so there is nothing to revert to");
var wasModified = doc.modified;
doc.revert();
__result__ = { document: app.activeDocument.name, reverted: wasModified };`));
                case 'save_all':
                    return run('Save all', commandScript(`
var saved = [], skipped = [];
for (var i = 0; i < app.documents.length; i++) {
  var d = app.documents[i];
  if (!d.saved) { skipped.push(d.name); continue; }
  if (d.modified) { d.save(); saved.push(d.name); }
}
__result__ = { saved: saved, neverSaved: skipped };`, { needsDocument: false }));
                case 'close_all': {
                    const saving = enumOf(a.saving ?? 'discard', ['discard', 'save'], { name: 'saving' });
                    return run('Close all', commandScript(`
var docs = app.documents.everyItem().getElements(), closed = [];
${saving === 'save' ? `var unsaved = [];
for (var u = 0; u < docs.length; u++) if (!docs[u].saved) unsaved.push(docs[u].name);
if (unsaved.length) throw new Error("These documents have never been saved; save them first or close with saving: discard: " + unsaved.join(", "));` : ''}
for (var i = 0; i < docs.length; i++) { closed.push(docs[i].name); docs[i].close(SaveOptions.${saving === 'save' ? 'YES' : 'NO'}); }
__result__ = { closed: closed, saved: ${bool(saving === 'save')} };`, { needsDocument: false }));
                }
                default:
                    throw new Error(`Unknown command ${command}`);
            }
        },
    },
    {
        name: 'manage_file_info',
        description: 'Read or set the document\'s File Info metadata (File > File Info): title, author, description, keywords, job name and copyright. Reading also reports the file, whether it is modified, converted from another version, or was opened from document recovery data after a crash',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set'], description: 'Read the metadata, or set the fields given' },
                metadata: groupSchema(FILE_INFO, 'File Info fields to set (MetadataPreference)'),
                keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords (replace the existing list)' },
            },
            required: ['action'],
        },
        features: ids('file_info', 'recovery'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const action = enumOf(a.action, ['get', 'set'], { name: 'action' });
            let body = '';
            if (action === 'set') {
                body = assign('mp', FILE_INFO, a.metadata, 'metadata');
                if (has(a.keywords)) {
                    if (!Array.isArray(a.keywords) || a.keywords.some((k) => typeof k !== 'string' || k.length > 500) || a.keywords.length > 500) throw new Error("'keywords' must be a list of short strings");
                    body += `\nmp.keywords = ${json(a.keywords)};`;
                }
                if (!body.trim()) throw new Error('Nothing to set: pass metadata or keywords');
            }
            return run(action === 'get' ? 'Read file info' : 'Set file info', commandScript(`
var mp = doc.metadataPreferences;
${body}
var info = { document: doc.name, file: null, saved: doc.saved, modified: doc.modified, converted: doc.converted, recovered: doc.recovered };
try { if (doc.saved) info.file = doc.fullName.fsName; } catch (e) {}
var fields = ["documentTitle", "author", "description", "jobName", "copyrightNotice", "copyrightInfoURL", "creator", "format"];
for (var i = 0; i < fields.length; i++) { try { info[fields[i]] = mp[fields[i]]; } catch (e) {} }
try { info.copyrightStatus = __enumName(mp.copyrightStatus); } catch (e) {}
try { info.keywords = mp.keywords; } catch (e) {}
try { info.creationDate = String(mp.creationDate); info.modificationDate = String(mp.modificationDate); } catch (e) {}
__result__ = info;`));
        },
    },
    {
        name: 'arrange_document_windows',
        description: 'Arrange document windows (Window > Arrange): open a new window on the active document, tile or cascade windows, minimise the active window, consolidate all windows into tabs, bring the next or previous document window to the front, or list the open windows',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: WINDOW_ACTIONS, description: 'The arrangement to apply' },
            },
            required: ['action'],
        },
        features: ids('new_window', 'tile_windows', 'cascade_windows', 'minimize_window', 'consolidate_windows', 'next_window'),
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const action = enumOf(a.action, WINDOW_ACTIONS, { name: 'action' });
            const steps = {
                list: '',
                new_window: 'if (app.documents.length === 0) throw new Error("No document open"); app.activeDocument.windows.add();',
                tile: 'app.tileWindows();',
                cascade: 'app.cascadeWindows();',
                minimize: 'if (app.windows.length === 0) throw new Error("No window open"); app.activeWindow.minimize();',
                consolidate_all: '__invoke(91222, "Consolidate All Windows");',
                next_window: 'if (app.windows.length < 2) throw new Error("Only one window is open"); app.windows[1].bringToFront();',
                previous_window: 'if (app.windows.length < 2) throw new Error("Only one window is open"); app.windows[app.windows.length - 1].bringToFront();',
            };
            return run('Arrange windows', commandScript(`
${steps[action]}
var out = [];
for (var i = 0; i < app.windows.length; i++) out.push({ index: i, name: app.windows[i].name, type: app.windows[i].constructor.name });
__result__ = { action: ${str(action)}, windows: out };`, { needsDocument: false }));
        },
    },
    {
        name: 'set_margins_and_columns',
        description: 'Read or set margins and columns (Layout > Margins and Columns) on document pages, on the pages of parent spreads, or as the document default for new pages: each margin or one value for all sides ("Make all settings the same"), columns, gutter, direction, and custom column positions (column guides moved by hand)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set'], description: 'Read the settings, or set the ones given', default: 'set' },
                pages: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Document page indexes (0-based)' },
                parents: { type: 'array', items: { type: 'string' }, description: 'Parent (master) spread names, e.g. "A-Parent"; every page of each is changed' },
                documentDefault: { type: 'boolean', description: 'Change the document default used for new pages' },
                margins: groupSchema(MARGIN_FIELDS, 'Margins and columns to set (MarginPreference); measurements in mm'),
                margin: { type: 'number', minimum: 0, maximum: 5486.4, description: 'One margin for all four sides, mm ("Make all settings the same")' },
                columnsPositions: { type: 'array', items: { type: 'number' }, description: 'Custom column guide positions in mm from the left margin, in the form InDesign reports them (read them with action get first); sets customColumns' },
            },
        },
        features: ids('margins_make_all_settings_the_same_margins', 'margins_custom_column_positions'),
        hints: { readOnly: false, destructive: false, idempotent: true },
        auditArgs: { action: 'set', pages: [0], parents: undefined, margins: { columnCount: 3, columnGutter: 4, columnDirection: 'HORIZONTAL', customColumns: false }, margin: 12, columnsPositions: undefined },
        handler: (a) => {
            const action = enumOf(a.action ?? 'set', ['get', 'set'], { name: 'action' });
            const pages = Array.isArray(a.pages) ? a.pages.map((p) => Number(index(p, { name: 'pages', max: 99999 }))) : [];
            const parents = Array.isArray(a.parents) ? a.parents.map((n) => nameArg(n, 'parents')) : [];
            if (!pages.length && !parents.length && !a.documentDefault) throw new Error('Choose where: pages, parents or documentDefault: true');
            let body = '';
            if (action === 'set') {
                const m = a.margins ?? {};
                if (has(m.columnCount) && !Number.isInteger(m.columnCount)) throw new Error("'margins.columnCount' must be a whole number");
                body = assign('mp', MARGIN_FIELDS, m, 'margins');
                if (has(a.margin)) {
                    if (MARGINS.some((k) => has(m[k]))) throw new Error("Give 'margin' (all sides the same) or margins.top/bottom/left/right, not both");
                    const v = num(a.margin, { min: 0, max: 5486.4, name: 'margin' });
                    body += `\n${MARGINS.map((k) => `mp.${k} = ${v};`).join(' ')}`;
                }
                if (has(a.columnsPositions)) {
                    if (!Array.isArray(a.columnsPositions) || a.columnsPositions.length < 2) throw new Error("'columnsPositions' must be a list of at least two positions");
                    const list = a.columnsPositions.map((v) => Number(num(v, { min: 0, max: 5486.4, name: 'columnsPositions' })));
                    for (let i = 1; i < list.length; i++) if (list[i] < list[i - 1]) throw new Error("'columnsPositions' must be in increasing order");
                    body += `\nmp.customColumns = true;\nmp.columnsPositions = ${json(list)};`;
                }
                if (!body.trim()) throw new Error('Nothing to set: pass margins, margin or columnsPositions');
            }
            return run(action === 'get' ? 'Read margins and columns' : 'Set margins and columns', commandScript(`
var targets = [];
${a.documentDefault ? 'targets.push(["document default", doc.marginPreferences]);' : ''}
var pageList = ${json(pages)}, parentList = ${json(parents)};
for (var i = 0; i < pageList.length; i++) { var pg = __page(doc, pageList[i]); targets.push(["page " + pg.name, pg.marginPreferences]); }
for (var j = 0; j < parentList.length; j++) {
  var ms = doc.masterSpreads.itemByName(parentList[j]);
  if (!ms.isValid) throw new Error("No parent spread named " + parentList[j]);
  for (var k = 0; k < ms.pages.length; k++) targets.push([parentList[j] + " page " + (k + 1), ms.pages[k].marginPreferences]);
}
var out = [];
for (var t = 0; t < targets.length; t++) {
  var mp = targets[t][1];
${body.split('\n').map((l) => '  ' + l).join('\n')}
  out.push({ target: targets[t][0], top: mp.top, bottom: mp.bottom, left: mp.left, right: mp.right, columnCount: mp.columnCount,
    columnGutter: mp.columnGutter, columnDirection: __enumName(mp.columnDirection), customColumns: mp.customColumns, columnsPositions: mp.columnsPositions });
}
__result__ = { targets: out };`));
        },
    },
];
