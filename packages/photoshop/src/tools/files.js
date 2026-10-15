/**
 * File commands: recent files, Close All, Bridge, File Info metadata, notes,
 * Place Embedded and Place Linked, and file-handling preferences.
 */
import { str, num, index, bool, enumOf, json, jsxPath, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { paths } from './documents.js';
import { optionLines } from '../options.js';

const RECENT = `
var files = [];
for (var i = 0; i < app.recentFiles.length; i++) files.push({ index: i, name: app.recentFiles[i].name, path: app.recentFiles[i].fsName });`;

/** File Info fields (DocumentInfo), by parameter name. */
const INFO_FIELDS = {
    title: { kind: 'str', description: 'Document title' },
    author: { kind: 'str', description: 'Creator (author) name' },
    authorPosition: { kind: 'str', description: 'Creator\'s job title' },
    headline: { kind: 'str', description: 'Headline' },
    caption: { kind: 'str', description: 'Caption (description)' },
    captionWriter: { kind: 'str', description: 'Description writer' },
    instructions: { kind: 'str', description: 'Special instructions' },
    keywords: { kind: 'strings', description: 'Keywords (replaces the list)' },
    copyrighted: { kind: 'enum', type: 'CopyrightedType', values: { copyrighted: 'COPYRIGHTEDWORK', public_domain: 'PUBLICDOMAIN', unmarked: 'UNMARKED' }, description: 'Copyright status' },
    copyrightNotice: { kind: 'str', description: 'Copyright notice' },
    ownerUrl: { kind: 'str', description: 'Copyright info URL' },
    creationDate: { kind: 'str', description: 'Date created, YYYYMMDD' },
    city: { kind: 'str', description: 'City' },
    provinceState: { kind: 'str', description: 'State or province' },
    country: { kind: 'str', description: 'Country' },
    credit: { kind: 'str', description: 'Credit line' },
    source: { kind: 'str', description: 'Source' },
    transmissionReference: { kind: 'str', description: 'Job identifier (transmission reference)' },
    jobName: { kind: 'str', description: 'Job name' },
    category: { kind: 'str', description: 'Legacy IPTC category (up to 3 characters)' },
    supplementalCategories: { kind: 'strings', description: 'Supplemental categories (replaces the list)' },
    urgency: { kind: 'enum', type: 'Urgency', values: { none: 'NONE', 1: 'HIGH', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'NORMAL', 6: 'SIX', 7: 'SEVEN', 8: 'LOW' }, description: 'Urgency: 1 (high) to 8 (low), 5 normal, or none' },
};

const READ_INFO = `
var inf = doc.info, info = {};
var names = ${json(Object.keys(INFO_FIELDS))};
for (var i = 0; i < names.length; i++) {
  try {
    var v = inf[names[i]];
    if (names[i] === "copyrighted" || names[i] === "urgency") v = __enumName(v);
    else if (v instanceof Array) { var copy = []; for (var j = 0; j < v.length; j++) copy.push(String(v[j])); v = copy; }
    else v = String(v);
    info[names[i]] = v;
  } catch (e) { info[names[i]] = null; }
}`;

/** File-handling preferences (Preferences > File Handling and History Log), by parameter name. */
const PREFERENCES = {
    imagePreviews: { kind: 'enum', type: 'SaveBehavior', values: { always: 'ALWAYSSAVE', never: 'NEVERSAVE', ask: 'ASKWHENSAVING' }, description: 'Save image previews: always, never or ask when saving' },
    iconPreview: { kind: 'bool', description: 'macOS: save an icon preview' },
    fullSizePreview: { kind: 'bool', description: 'macOS: save a full-size preview' },
    macThumbnail: { kind: 'bool', prop: 'macOSThumbnail', description: 'macOS: save a Macintosh thumbnail' },
    windowsThumbnail: { kind: 'bool', description: 'Save a Windows thumbnail' },
    recentFileListLength: { kind: 'int', min: 0, max: 100, description: 'Files listed in File > Open Recent' },
    historyLog: { kind: 'bool', prop: 'useHistoryLog', description: 'Keep the edit history log' },
    historyLogSaveTo: { kind: 'enum', prop: 'saveLogItems', type: 'SaveLogItemsType', values: { metadata: 'METADATA', text_file: 'LOGFILE', both: 'LOGFILEANDMETADATA' }, description: 'Where the history log goes: the file\'s metadata (readable in File Info), a text file, or both' },
    historyLogDetail: { kind: 'enum', prop: 'editLogItems', type: 'EditLogItemsType', values: { sessions: 'SESSIONONLY', concise: 'CONCISE', detailed: 'DETAILED' }, description: 'Edit log items' },
};

const READ_PREFERENCES = `
var p = app.preferences, prefs = {};
try { prefs.imagePreviews = __enumName(p.imagePreviews); } catch (e) {}
try { prefs.iconPreview = p.iconPreview; prefs.fullSizePreview = p.fullSizePreview; prefs.macThumbnail = p.macOSThumbnail; } catch (e) {}
try { prefs.windowsThumbnail = p.windowsThumbnail; } catch (e) {}
prefs.recentFileListLength = p.recentFileListLength;
prefs.historyLog = p.useHistoryLog;
try { prefs.historyLogSaveTo = __enumName(p.saveLogItems); prefs.historyLogDetail = __enumName(p.editLogItems); } catch (e) {}
try { prefs.historyLogFile = p.saveLogItemsFile.fsName; } catch (e) { prefs.historyLogFile = null; }`;

const pick = (a, table) => Object.fromEntries(Object.keys(table).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const schemaFor = (table) => Object.fromEntries(Object.entries(table).map(([k, s]) => [k, {
    ...(s.kind === 'bool' ? { type: 'boolean' } : s.kind === 'int' ? { type: 'integer', minimum: s.min, maximum: s.max } : s.kind === 'strings' ? { type: 'array', items: { type: 'string' } } : { type: 'string' }),
    ...(s.values ? { enum: Object.keys(s.values) } : {}),
    description: s.description,
}]));

export const tools = [
    {
        name: 'manage_recent_files',
        description: 'List the files in File > Open Recent, open one of them by its index, or clear the list (Clear Recent File List)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'open', 'clear'], description: 'Default list' },
                index: { type: 'integer', minimum: 0, description: 'open: the file\'s index in the list' },
            },
        },
        auditArgs: { action: 'list' },
        features: ['photoshop.documents.open_recent', 'photoshop.documents.clear_recent_files'],
        handler: async (a) => {
            const action = enumOf(a.action ?? 'list', ['list', 'open', 'clear'], { name: 'action' });
            if (action === 'clear') {
                return run('Clear recent files', script(`
app.runMenuItem(app.stringIDToTypeID("clearRecentFiles"));
__result__ = { cleared: true, files: app.recentFiles.length };`, { needsDocument: false }));
            }
            if (action === 'list') return run('Recent files', script(`${RECENT}\n__result__ = { files: files };`, { needsDocument: false }));
            if (a.index === undefined) throw new Error('open needs index (from action: list)');
            const at = Number(index(a.index, { name: 'index' }));
            // Read the list first, so the file's path goes through the path policy like any other.
            const r = await executor.runStructured(script(`${RECENT}\n__result__ = { files: files };`, { needsDocument: false }));
            if (!r.ok) return formatErrorResponse(r.error, 'Open recent file');
            const files = (typeof r.result === 'string' ? JSON.parse(r.result) : r.result)?.files ?? [];
            if (at >= files.length) throw new Error(`The recent file list has ${files.length} file(s)`);
            const p = paths.validate(files[at].path);
            return run('Open recent file', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
__result__ = __docInfo(app.open(f));`, { needsDocument: false }));
        },
    },
    {
        name: 'close_documents',
        description: 'Close every open document (File > Close All). Unsaved changes are discarded unless save is true; with save, documents that have never been saved are refused before anything closes',
        inputSchema: { type: 'object', properties: { save: { type: 'boolean', description: 'Save each document before closing it. Default false', default: false } } },
        hints: { destructive: true },
        features: ['photoshop.documents.close_all'],
        handler: (a) => run('Close all documents', script(`
${a.save ? `var unsaved = [];
for (var i = 0; i < app.documents.length; i++) { try { app.documents[i].fullName; } catch (e) { unsaved.push(app.documents[i].name); } }
if (unsaved.length) throw new Error("Never saved, so cannot be saved in place: " + unsaved.join(", ") + ". Save them with save_document first");` : ''}
var closed = [];
while (app.documents.length) {
  var d = app.documents[0];
  closed.push(d.name);
  d.close(SaveOptions.${a.save ? 'SAVECHANGES' : 'DONOTSAVECHANGES'});
}
__result__ = { closed: closed };`, { needsDocument: false })),
    },
    {
        name: 'go_to_bridge',
        description: 'Open Adobe Bridge (File > Browse in Bridge), or close the active document and switch to Bridge (File > Close and Go to Bridge). Needs Bridge installed',
        inputSchema: { type: 'object', properties: { closeDocument: { type: 'boolean', description: 'Close the active document first. It must have no unsaved changes. Default false', default: false } } },
        hints: { openWorld: true },
        features: ['photoshop.documents.browse_in_bridge', 'photoshop.documents.close_and_go_to_bridge'],
        handler: (a) => run('Go to Bridge', script(a.closeDocument ? `
var doc = __doc(), n = doc.name;
if (!doc.saved) throw new Error(n + " has unsaved changes: save or close it first");
app.runMenuItem(app.stringIDToTypeID("browseAndClose"));
__result__ = { closed: n, bridge: true };` : `
app.runMenuItem(app.stringIDToTypeID("toggleFileBrowserPalette"));
__result__ = { bridge: true };`, { needsDocument: false })),
    },
    {
        name: 'get_document_metadata',
        description: 'Read the active document\'s File Info metadata: title, author, description, keywords, copyright, IPTC origin, categories, the camera data (Exif), and optionally the raw XMP packet',
        inputSchema: { type: 'object', properties: { includeXmp: { type: 'boolean', description: 'Include the raw XMP packet. Default false', default: false } } },
        hints: { readOnly: true },
        features: ['photoshop.documents.file_info', 'photoshop.documents.file_info_author', 'photoshop.documents.file_info_title', 'photoshop.documents.file_info_description', 'photoshop.documents.file_info_keywords', 'photoshop.documents.file_info_copyright', 'photoshop.documents.file_info_origin', 'photoshop.documents.file_info_categories', 'photoshop.documents.file_info_camera_data', 'photoshop.documents.xmp_metadata'],
        handler: (a) => run('Read metadata', script(`${READ_INFO}
var exif = [];
try { for (var k = 0; k < inf.exif.length; k++) exif.push({ tag: String(inf.exif[k][0]), value: String(inf.exif[k][1]) }); } catch (e) {}
info.exif = exif;
${a.includeXmp ? 'try { info.xmp = doc.xmpMetadata.rawData; } catch (e) { info.xmp = null; }' : ''}
__result__ = info;`)),
    },
    {
        name: 'set_document_metadata',
        description: 'Set the active document\'s File Info metadata: title, author, description, keywords, copyright, IPTC origin and categories, or replace its whole XMP packet. Only the fields given change. Camera data (Exif) is read-only',
        inputSchema: {
            type: 'object',
            properties: {
                ...schemaFor(INFO_FIELDS),
                xmp: { type: 'string', description: 'A complete XMP packet (<x:xmpmeta ...>) that replaces the document\'s metadata. Applied before the fields above' },
            },
        },
        hints: { idempotent: true },
        auditArgs: { creationDate: '20260115', urgency: '5', copyrighted: 'copyrighted', xmp: undefined },
        features: ['photoshop.documents.file_info', 'photoshop.documents.file_info_author', 'photoshop.documents.file_info_title', 'photoshop.documents.file_info_description', 'photoshop.documents.file_info_keywords', 'photoshop.documents.file_info_copyright', 'photoshop.documents.file_info_origin', 'photoshop.documents.file_info_categories', 'photoshop.documents.xmp_metadata'],
        handler: (a) => {
            const given = pick(a, INFO_FIELDS);
            if (!Object.keys(given).length && a.xmp === undefined) throw new Error(`Give at least one field: ${Object.keys(INFO_FIELDS).join(', ')}, or xmp`);
            if (given.creationDate !== undefined && !/^\d{8}$/.test(String(given.creationDate))) throw new Error("'creationDate' is YYYYMMDD, e.g. 20260115");
            if (a.xmp !== undefined && (typeof a.xmp !== 'string' || !/<x:xmpmeta[\s>]/.test(a.xmp))) throw new Error("'xmp' must be a complete XMP packet containing <x:xmpmeta>");
            return run('Set metadata', script(`
${a.xmp !== undefined ? `doc.xmpMetadata.rawData = ${str(a.xmp)};` : ''}
${optionLines(INFO_FIELDS, given, { name: 'metadata', target: 'doc.info', what: 'File Info' })}
${READ_INFO}
__result__ = info;`));
        },
    },
    {
        name: 'manage_document_notes',
        description: 'Work with notes (non-printing annotations): import the notes from a PDF or FDF file into the active document (File > Import > Notes), delete all of its notes (Note tool: Clear All), choose the Note tool, or show or hide the Notes panel (Window > Notes). Writing a note\'s text is done by hand with the Note tool',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['import', 'clear_all', 'select_tool', 'toggle_panel'], description: 'What to do' },
                file: { type: 'string', description: 'import: absolute path of a PDF or FDF file with notes' },
            },
            required: ['action'],
        },
        hints: { destructive: true },
        auditArgs: { action: 'import', file: `${process.env.HOME ?? '/tmp'}/Documents/notes.pdf` },
        features: ['photoshop.documents.notes_annotations', 'photoshop.documents.import_notes', 'photoshop.documents.delete_all_notes', 'photoshop.documents.note_tool', 'photoshop.documents.notes_panel'],
        handler: (a) => {
            const action = enumOf(a.action, ['import', 'clear_all', 'select_tool', 'toggle_panel'], { name: 'action' });
            if (action === 'import') {
                if (!a.file) throw new Error('import needs file');
                const p = paths.validate(a.file);
                if (!/\.(pdf|fdf)$/i.test(p)) throw new Error('Notes are imported from a .pdf or .fdf file');
                return run('Import notes', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
doc.importAnnotations(f);
__result__ = { imported: f.fsName };`));
            }
            if (a.file !== undefined) throw new Error('file is only for import');
            return run('Notes', script({
                clear_all: 'app.executeAction(app.stringIDToTypeID("deleteAllAnnot"), new ActionDescriptor(), DialogModes.NO);\n__result__ = { cleared: true };',
                select_tool: 'app.currentTool = "textAnnotTool";\n__result__ = { tool: app.currentTool };',
                toggle_panel: 'app.runMenuItem(app.stringIDToTypeID("toggleAnnotationPalette"));\n__result__ = { toggled: true };',
            }[action], { needsDocument: action === 'clear_all' }));
        },
    },
    {
        name: 'set_file_handling_preferences',
        description: 'Set and read file-handling preferences: image previews saved with files (macOS icon and full-size previews, Mac and Windows thumbnails), the length of File > Open Recent, and the History Log (on or off, saved to the file\'s metadata or a text file, and its detail). Call with no settings to read them',
        inputSchema: {
            type: 'object',
            properties: {
                ...schemaFor(PREFERENCES),
                historyLogFile: { type: 'string', description: 'Absolute path of the text file the History Log is written to' },
            },
        },
        hints: { idempotent: true },
        auditArgs: { historyLogFile: `${process.env.HOME ?? '/tmp'}/Documents/history-log.txt` },
        features: ['photoshop.documents.macos_preview_options', 'photoshop.documents.history_log_metadata'],
        handler: (a) => {
            const logFile = a.historyLogFile !== undefined ? paths.validate(a.historyLogFile) : null;
            return run('File handling preferences', script(`
${optionLines(PREFERENCES, pick(a, PREFERENCES), { name: 'preferences', target: 'app.preferences', what: 'File handling preferences' })}
${logFile ? `app.preferences.saveLogItemsFile = new File(${jsxPath(logFile)});` : ''}
${READ_PREFERENCES}
__result__ = prefs;`, { needsDocument: false }));
        },
    },
    {
        name: 'place_file',
        description: 'Place an image, PDF, vector or other file in the active document as a smart object (File > Place Embedded), or as a smart object linked to the file (File > Place Linked), positioned, scaled and rotated',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the file to place' },
                linked: { type: 'boolean', description: 'Link to the file instead of embedding it. Default false', default: false },
                center: { type: 'object', description: 'Where the placed item\'s centre goes, in pixels from the top-left. Default the document centre', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
                scale: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Scale in percent, both directions' },
                scaleX: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Horizontal scale in percent' },
                scaleY: { type: 'number', minimum: 0.1, maximum: 10000, description: 'Vertical scale in percent' },
                angle: { type: 'number', minimum: -360, maximum: 360, description: 'Rotation in degrees' },
            },
            required: ['filePath'],
        },
        auditArgs: { filePath: `${process.env.HOME ?? '/tmp'}/Documents/logo.ai`, scale: undefined, scaleX: 50, scaleY: 40, center: { x: 100, y: 80 }, angle: 15, linked: true },
        features: ['photoshop.import_export.place_embedded', 'photoshop.import_export.place_linked', 'photoshop.import_export.place_transform_options'],
        handler: (a) => {
            const p = paths.validate(a.filePath);
            if (a.scale !== undefined && (a.scaleX !== undefined || a.scaleY !== undefined)) throw new Error('Give scale, or scaleX and scaleY');
            const sx = a.scale ?? a.scaleX, sy = a.scale ?? a.scaleY;
            const pct = (v, n) => num(v, { min: 0.1, max: 10000, name: n });
            const S = (id) => `app.stringIDToTypeID(${str(id)})`;
            const lines = [];
            if (a.center !== undefined) {
                if (typeof a.center !== 'object' || a.center === null) throw new Error("'center' must be { x, y }");
                // The offset moves the placed item from the document's centre.
                lines.push(`var off = new ActionDescriptor();
off.putUnitDouble(${S('horizontal')}, ${S('pixelsUnit')}, ${num(a.center.x, { name: 'center.x' })} - __px(doc.width) / 2);
off.putUnitDouble(${S('vertical')}, ${S('pixelsUnit')}, ${num(a.center.y, { name: 'center.y' })} - __px(doc.height) / 2);
d.putObject(${S('offset')}, ${S('offset')}, off);`);
            }
            if (sx !== undefined) lines.push(`d.putUnitDouble(${S('width')}, ${S('percentUnit')}, ${pct(sx, a.scale !== undefined ? 'scale' : 'scaleX')});`);
            if (sy !== undefined) lines.push(`d.putUnitDouble(${S('height')}, ${S('percentUnit')}, ${pct(sy, a.scale !== undefined ? 'scale' : 'scaleY')});`);
            if (a.angle !== undefined) lines.push(`d.putUnitDouble(${S('angle')}, ${S('angleUnit')}, ${num(a.angle, { min: -360, max: 360, name: 'angle' })});`);
            return run('Place file', script(`
var f = new File(${jsxPath(p)});
if (!f.exists) throw new Error("File not found: " + f.fsName);
var d = new ActionDescriptor();
d.putPath(${S('null')}, f);
${a.linked ? `d.putBoolean(${S('linked')}, true);` : ''}
d.putEnumerated(${S('freeTransformCenterState')}, ${S('quadCenterState')}, ${S('QCSAverage')});
${lines.join('\n')}
app.executeAction(${S('placeEvent')}, d, DialogModes.NO);
__result__ = { placed: f.fsName, linked: ${bool(a.linked)}, layer: __layerInfo(doc.activeLayer) };`));
        },
    },
];
