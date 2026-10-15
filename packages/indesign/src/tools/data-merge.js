/**
 * Data merge: text, image and QR code field placeholders in the target
 * document, the data source (update, remove, preview), the merge layout and
 * content placement options, a missing-images report and merging straight to
 * PDF. Selecting a data source and merging into a new document is the
 * existing data_merge tool.
 */
import { str, num } from 'adobe-mcp-core';
import { script } from './script.js';
import { run } from './run.js';
import { has, obj, known, int, flag, text, pick, filePath } from './checks.js';

/** Script helpers: the merge object, a field by name, and a summary of the setup. */
const MERGE_JSX = String.raw`
var __dm = function (doc) { return doc.dataMergeProperties; };
var __field = function (doc, name) {
  var fields = __dm(doc).dataMergeFields, names = [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].fieldName === name) return fields[i];
    names.push(fields[i].fieldName);
  }
  if (!fields.length) throw new Error("The document has no data source: select one first (data_merge with mergeRecords: false)");
  throw new Error("No data merge field " + name + ". Fields: " + names.join(", "));
};
var __mergeInfo = function (doc) {
  var dm = __dm(doc), p = dm.dataMergePreferences, o = doc.dataMergeOptions, out = { fields: [], placeholders: [] }, i;
  for (i = 0; i < dm.dataMergeFields.length; i++) out.fields.push({ name: dm.dataMergeFields[i].fieldName, type: __enumName(dm.dataMergeFields[i].fieldType) });
  var t = doc.dataMergeTextPlaceholders;
  for (i = 0; i < t.length; i++) out.placeholders.push({ kind: "text", field: t[i].field.fieldName, storyId: t[i].parentStory.id, offset: t[i].storyOffset.index });
  var g = doc.dataMergeImagePlaceholders;
  for (i = 0; i < g.length; i++) out.placeholders.push({ kind: "image", field: g[i].field.fieldName, itemId: g[i].placeholderPageItem.id });
  var q = doc.dataMergeQrcodePlaceholders;
  for (i = 0; i < q.length; i++) out.placeholders.push({ kind: "qr", field: q[i].field.fieldName, itemId: q[i].placeholderPageItem.id });
  out.records = {
    selection: __enumName(p.recordSelection), recordNumber: p.recordNumber, recordRange: p.recordRange,
    recordsPerPage: __enumName(p.recordsPerPage)
  };
  out.layout = {
    arrangeBy: __enumName(p.arrangeBy), topMargin: p.topMargin, bottomMargin: p.bottomMargin, leftMargin: p.leftMargin,
    rightMargin: p.rightMargin, columnSpacing: p.columnSpacing, rowSpacing: p.rowSpacing
  };
  out.placement = {
    fitting: __enumName(o.fittingOption), centerImage: o.centerImage, linkImages: o.linkImages,
    recordLimit: o.documentSize, removeBlankLines: o.removeBlankLines, createNewDocument: o.createNewDocument
  };
  return out;
};
`;

const mergeScript = (body, opts) => script(MERGE_JSX + body, opts);

const FITTING = {
    proportional: 'Fitting.PROPORTIONAL',
    fill_proportional: 'Fitting.FILL_PROPORTIONAL',
    fit_content_to_frame: 'Fitting.FIT_CONTENT_TO_FRAME',
    fit_frame_to_content: 'Fitting.FIT_FRAME_TO_CONTENT',
    content_aware: 'Fitting.CONTENT_AWARE_FITTING',
    preserve_sizes: 'Fitting.PRESERVE_SIZES',
    frame_fitting_options: 'Fitting.HONOUR_EXISTING_STYLE',
};
const ARRANGE = { rows_first: 'ArrangeBy.ROWS_FIRST', columns_first: 'ArrangeBy.COLUMNS_FIRST' };

const LAYOUT_KEYS = ['arrangeBy', 'topMargin', 'bottomMargin', 'leftMargin', 'rightMargin', 'columnSpacing', 'rowSpacing'];
const PLACEMENT_KEYS = ['fitting', 'centerImage', 'linkImages', 'recordLimit', 'removeBlankLines'];

/** Record selection statements (Records to Merge) on `p`, the DataMergePreference. */
function recordLines(a) {
    if (!has(a.records)) return [];
    const r = obj(a.records, 'records');
    known(r, ['selection', 'recordNumber', 'range'], 'records');
    const sel = pick(r.selection ?? 'all', { all: 'ALL_RECORDS', one: 'ONE_RECORD', range: 'RANGE' }, 'records.selection');
    const lines = [`p.recordSelection = RecordSelection.${sel};`];
    if (sel === 'ONE_RECORD') {
        if (!has(r.recordNumber)) throw new Error("'records.recordNumber' is required when records.selection is one");
        lines.push(`p.recordNumber = ${int(r.recordNumber, 'records.recordNumber', { min: 1 })};`);
    }
    if (sel === 'RANGE') {
        if (typeof r.range !== 'string' || !/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(r.range)) {
            throw new Error(`'records.range' must look like "1-5,8"; got ${JSON.stringify(r.range)}`);
        }
        lines.push(`p.recordRange = ${str(r.range.replace(/\s+/g, ''))};`);
    }
    return lines;
}

const RECORDS_SCHEMA = {
    type: 'object',
    description: 'Records to Merge (default: all records)',
    properties: {
        selection: { type: 'string', enum: ['all', 'one', 'range'], description: 'All records, one record, or a range' },
        recordNumber: { type: 'integer', minimum: 1, description: 'For one: the record number (1-based)' },
        range: { type: 'string', description: 'For range: records such as "1-5,8"' },
    },
};

export const tools = [
    {
        name: 'add_data_merge_placeholder',
        description: 'Set up the target document for a data merge: insert a text field placeholder into a text frame, or make a graphic frame an image or QR code field placeholder (Data Merge panel). The document needs a data source first (data_merge with mergeRecords: false); returns every placeholder in the document',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['text', 'image', 'qr'], description: 'text inserts the field into text; image fills a frame with the image the record names; qr fills a frame with a QR code made from the record' },
                field: { type: 'string', description: 'Data merge field name (a column of the data source)' },
                frameId: { type: 'integer', minimum: 0, description: 'For text: the text frame to insert into; for image and qr: the frame to use as the placeholder' },
                offset: { type: 'integer', minimum: 0, description: 'For text: the insertion point within the frame text, 0-based (default: the end of the frame text)' },
            },
            required: ['kind', 'field', 'frameId'],
        },
        features: [
            'indesign.data_merge.text_placeholder',
            'indesign.data_merge.image_placeholder',
            'indesign.data_merge.qr_placeholder',
            'indesign.data_merge.target_document',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        handler: (a) => {
            const kind = pick(a.kind, { text: 'text', image: 'image', qr: 'qr' }, 'kind');
            const field = text(a.field, 'field', 200);
            const frame = int(a.frameId, 'frameId');
            if (kind !== 'text' && has(a.offset)) throw new Error("'offset' applies to text placeholders only");
            const offset = has(a.offset) ? int(a.offset, 'offset', { max: 1e8 }) : 'null';
            const add = {
                text: [
                    'if (!(it instanceof TextFrame)) throw new Error("Item " + it.id + " is not a text frame");',
                    'var ips = it.insertionPoints, at = ' + offset + ';',
                    'if (at !== null && at >= ips.length) throw new Error("offset " + at + " is past the end of the frame text (" + (ips.length - 1) + ")");',
                    'var ip = at === null ? ips[ips.length - 1] : ips[at];',
                    'doc.dataMergeTextPlaceholders.add(it.parentStory, ip.index, f);',
                ],
                image: ['doc.dataMergeImagePlaceholders.add(it, f);'],
                qr: ['doc.dataMergeQrcodePlaceholders.add(it, f);'],
            }[kind];
            return run('Add data merge placeholder', mergeScript([
                `var f = __field(doc, ${field});`,
                `var it = __item(doc, ${frame});`,
                ...add,
                `__result__ = { added: "${kind}", placeholders: __mergeInfo(doc).placeholders };`,
            ].join('\n')));
        },
    },
    {
        name: 'manage_data_merge',
        description: 'Work with a document\'s data merge: report the fields, placeholders and options; update or remove the data source; preview a record in the placeholders; update the content of data fields in a merged document; or write a report of image files the records name that cannot be found (Data Merge panel menu: Update Data Source, Remove Data Source, Preview, Update Content in Data Fields)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['info', 'update_source', 'remove_source', 'preview', 'update_content', 'missing_images_report'], description: 'What to do' },
                recordNumber: { type: 'integer', minimum: 1, description: 'For preview: the record to show (1-based)' },
                show: { type: 'boolean', description: 'For preview: turn Preview on (default) or off', default: true },
                reportPath: { type: 'string', description: 'For missing_images_report: the text file to write the report to' },
            },
            required: ['action'],
        },
        features: [
            'indesign.data_merge.data_merge_menu_update_data_source',
            'indesign.data_merge.data_merge_menu_remove_data_source',
            'indesign.data_merge.data_merge_menu_preview',
            'indesign.data_merge.data_merge_menu_update_content_in_data_fields',
            'indesign.data_merge.dm_records_alert_when_images_are_missing',
        ],
        hints: { readOnly: false, destructive: false, idempotent: false },
        auditArgs: { action: 'preview', recordNumber: 2 },
        handler: (a) => {
            const action = pick(a.action, { info: 'info', update_source: 'update_source', remove_source: 'remove_source', preview: 'preview', update_content: 'update_content', missing_images_report: 'missing_images_report' }, 'action');
            let body;
            if (action === 'info') body = '__result__ = __mergeInfo(doc);';
            if (action === 'update_source') body = '__dm(doc).updateDataSource();\n__result__ = __mergeInfo(doc);';
            if (action === 'remove_source') body = '__dm(doc).removeDataSource();\n__result__ = { removed: true, fields: __dm(doc).dataMergeFields.length };';
            if (action === 'preview') {
                const show = has(a.show) ? flag(a.show, 'show') : 'true';
                body = [
                    'var p = __dm(doc).dataMergePreferences;',
                    'if (!__dm(doc).dataMergeFields.length) throw new Error("The document has no data source");',
                    ...(has(a.recordNumber) ? [`p.recordNumber = ${int(a.recordNumber, 'recordNumber', { min: 1 })};`] : []),
                    'var ma = app.menuActions.itemByID(108035);',
                    `if (ma.isValid && ma.enabled && ma.checked !== ${show}) ma.invoke();`,
                    '__result__ = { preview: ma.isValid ? ma.checked : null, recordNumber: p.recordNumber };',
                ].join('\n');
            }
            if (action === 'update_content') {
                body = [
                    'var ma = app.menuActions.itemByID(108042);',
                    'if (!ma.isValid || !ma.enabled) throw new Error("Update Content in Data Fields is not available: it works in a merged document whose data source has changed");',
                    'ma.invoke();',
                    '__result__ = { updated: true };',
                ].join('\n');
            }
            if (action === 'missing_images_report') {
                const path = filePath(a.reportPath, 'reportPath', ['.txt']);
                body = [
                    `var f = File(${path});`,
                    '__dm(doc).dataMergePreferences.alertMissingImages(f);',
                    '__result__ = { report: f.fsName, written: f.exists };',
                ].join('\n');
            }
            return run('Data merge', mergeScript(body));
        },
    },
    {
        name: 'set_data_merge_options',
        description: 'Set the data merge layout and content placement options and return them: Layout of Records (rows or columns first), margins and spacing between columns and rows for multiple records per page, image fitting, Center in Frame, Link Images, Remove Blank Lines and the record limit per document (Create Merged Document > Multiple Record Layout and Options; Content Placement Options)',
        inputSchema: {
            type: 'object',
            properties: {
                layout: {
                    type: 'object',
                    description: 'Multiple Record Layout',
                    properties: {
                        arrangeBy: { type: 'string', enum: Object.keys(ARRANGE), description: 'Layout of Records: fill rows first or columns first' },
                        topMargin: { type: 'number', minimum: 0, description: 'Top margin in mm' },
                        bottomMargin: { type: 'number', minimum: 0, description: 'Bottom margin in mm' },
                        leftMargin: { type: 'number', minimum: 0, description: 'Left (inside) margin in mm' },
                        rightMargin: { type: 'number', minimum: 0, description: 'Right (outside) margin in mm' },
                        columnSpacing: { type: 'number', minimum: 0, description: 'Spacing between columns in mm' },
                        rowSpacing: { type: 'number', minimum: 0, description: 'Spacing between rows in mm' },
                    },
                },
                placement: {
                    type: 'object',
                    description: 'Content Placement Options',
                    properties: {
                        fitting: { type: 'string', enum: Object.keys(FITTING), description: 'How merged images fit their frames (frame_fitting_options keeps each frame\'s own Frame Fitting Options)' },
                        centerImage: { type: 'boolean', description: 'Center in Frame' },
                        linkImages: { type: 'boolean', description: 'Link Images (false embeds them)' },
                        recordLimit: { type: 'integer', minimum: 1, description: 'Record Limit per Document: split the merge into documents of this many records' },
                        removeBlankLines: { type: 'boolean', description: 'Remove Blank Lines for Empty Fields' },
                    },
                },
            },
        },
        features: [
            'indesign.data_merge.data_merge_menu_content_placement_options',
            'indesign.data_merge.dm_layout_margins_multiple_record_layout',
            'indesign.data_merge.dm_layout_layout_of_records',
            'indesign.data_merge.dm_layout_spacing_between_columns',
            'indesign.data_merge.dm_layout_spacing_between_rows',
            'indesign.data_merge.dm_placement_fitting_image_placement',
            'indesign.data_merge.dm_placement_center_in_frame',
            'indesign.data_merge.dm_placement_link_images',
            'indesign.data_merge.dm_placement_record_limit_per_document',
        ],
        hints: { readOnly: false, destructive: false, idempotent: true },
        handler: (a) => {
            const l = obj(a.layout, 'layout') ?? {};
            const p = obj(a.placement, 'placement') ?? {};
            known(l, LAYOUT_KEYS, 'layout');
            known(p, PLACEMENT_KEYS, 'placement');
            const lines = ['var p = __dm(doc).dataMergePreferences, o = doc.dataMergeOptions;'];
            if (has(l.arrangeBy)) lines.push(`p.arrangeBy = ${pick(l.arrangeBy, ARRANGE, 'layout.arrangeBy')};`);
            for (const k of LAYOUT_KEYS.slice(1)) if (has(l[k])) lines.push(`p.${k} = ${num(l[k], { min: 0, max: 5000, name: `layout.${k}` })};`);
            if (has(p.fitting)) lines.push(`o.fittingOption = ${pick(p.fitting, FITTING, 'placement.fitting')};`);
            for (const k of ['centerImage', 'linkImages', 'removeBlankLines']) if (has(p[k])) lines.push(`o.${k} = ${flag(p[k], `placement.${k}`)};`);
            if (has(p.recordLimit)) lines.push(`o.documentSize = ${int(p.recordLimit, 'placement.recordLimit', { min: 1, max: 1e7 })};`);
            if (lines.length === 1) throw new Error('Give layout or placement options to set');
            lines.push('var info = __mergeInfo(doc);', '__result__ = { layout: info.layout, placement: info.placement };');
            return run('Set data merge options', mergeScript(lines.join('\n')));
        },
    },
    {
        name: 'export_data_merge_pdf',
        description: 'Merge records straight to a PDF file without creating a merged document (Data Merge panel menu > Export to PDF), with a PDF export preset and an optional overset text report',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The PDF file to write' },
                preset: { type: 'string', description: 'PDF export preset name', default: '[High Quality Print]' },
                records: RECORDS_SCHEMA,
                recordsPerPage: { type: 'string', enum: ['single', 'multiple'], description: 'One record per page, or multiple records per page (see set_data_merge_options layout)' },
                oversetReportPath: { type: 'string', description: 'A text file for the report of records whose text is overset' },
            },
            required: ['path'],
        },
        features: ['indesign.data_merge.data_merge_menu_export_to_pdf'],
        hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
        auditArgs: { path: `${process.env.HOME ?? '/tmp'}/Documents/merged.pdf`, records: { selection: 'range', range: '1-3' }, oversetReportPath: `${process.env.HOME ?? '/tmp'}/Documents/overset.txt` },
        handler: (a) => {
            const path = filePath(a.path, 'path', ['.pdf']);
            const preset = text(a.preset ?? '[High Quality Print]', 'preset', 200);
            const report = has(a.oversetReportPath) ? filePath(a.oversetReportPath, 'oversetReportPath', ['.txt']) : null;
            const lines = [
                'var dm = __dm(doc), p = dm.dataMergePreferences;',
                'if (!dm.dataMergeFields.length) throw new Error("The document has no data source");',
                `var preset = app.pdfExportPresets.itemByName(${preset});`,
                `if (!preset.isValid) throw new Error("No PDF export preset named " + ${preset});`,
                ...recordLines(a),
            ];
            if (has(a.recordsPerPage)) lines.push(`p.recordsPerPage = ${pick(a.recordsPerPage, { single: 'RecordsPerPage.SINGLE_RECORD', multiple: 'RecordsPerPage.MULTIPLE_RECORD' }, 'recordsPerPage')};`);
            lines.push(
                `var out = File(${path});`,
                report ? `dm.exportFile(out, preset, File(${report}));` : 'dm.exportFile(out, preset);',
                `__result__ = { pdf: out.fsName, written: out.exists, oversetReport: ${report ? `File(${report}).fsName` : 'null'}, records: __enumName(p.recordSelection) };`,
            );
            return run('Export data merge to PDF', mergeScript(lines.join('\n')));
        },
    },
];

