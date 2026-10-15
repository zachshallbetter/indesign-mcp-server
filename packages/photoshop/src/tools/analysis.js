/**
 * Image > Analysis: the measurement scale, recording measurements, the
 * Measurement Log, and the Count tool's count items.
 */
import path from 'node:path';
import { str, num, index, enumOf, json, jsxPath } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { paths } from './documents.js';

const SOURCES = { selection: 'MEASURESELECTION', ruler: 'MEASURERULERTOOL', count: 'MEASURECOUNTTOOL' };
const RANGES = { all: 'ALLMEASUREMENTS', selected: 'ACTIVEMEASUREMENTS' };
const LOG_MENU = {
    select_all: 'measurementLogSelectAll',
    deselect_all: 'measurementLogDeselectAll',
    toggle_auto_display: 'measurementLogAutoDisplayPalette',
    toggle_panel: 'toggleMeasurementLogPalette',
};
const LOG_ACTIONS = ['export', 'delete', ...Object.keys(LOG_MENU)];
const COUNT_ACTIONS = ['list', 'add', 'remove', 'clear'];

const DATA_POINTS_SCHEMA = {
    type: 'array',
    items: { type: 'string' },
    description: 'Data points (Image > Analysis > Select Data Points), by their names in the Measurement Log, e.g. "Area", "Perimeter", "Count", "Length", "Angle". Default: the current choice',
};

/** Data point names as a JSX array literal, or undefined. */
function dataPoints(list) {
    if (list === undefined) return 'undefined';
    if (!Array.isArray(list) || !list.length) throw new Error('dataPoints must be a list of names');
    return json(list.map(String));
}

/** The measurement scale as a result object. */
const SCALE = `
var ms = doc.measurementScale;
__result__ = { pixelLength: ms.pixelLength, logicalLength: ms.logicalLength, logicalUnits: ms.logicalUnits, name: ms.name };`;

/** The count items as a result object. */
const COUNTS = `
var items = [];
for (var i = 0; i < doc.countItems.length; i++) { var p = doc.countItems[i].position; items.push({ index: i, x: __px(p[0]), y: __px(p[1]) }); }
__result__ = { count: items.length, items: items };`;

export const tools = [
    {
        name: 'set_measurement_scale',
        description: 'Set the document\'s measurement scale (Image > Analysis > Set Measurement Scale): how many pixels make a length in logical units, e.g. 100 pixels = 2 millimeters. Without arguments, returns the current scale',
        inputSchema: {
            type: 'object',
            properties: {
                pixelLength: { type: 'number', minimum: 1, maximum: 300000, description: 'Pixels' },
                logicalLength: { type: 'number', minimum: 0.0001, maximum: 1e9, description: 'The length those pixels stand for' },
                logicalUnits: { type: 'string', description: 'Unit name, e.g. "mm", "microns", "km"' },
                name: { type: 'string', description: 'Name for this scale preset' },
                reset: { type: 'boolean', description: 'Reset to the default: 1 pixel = 1 pixel' },
            },
        },
        auditArgs: { reset: undefined },
        hints: { idempotent: true },
        features: ['photoshop.image.set_measurement_scale'],
        handler: (a) => {
            const lines = [];
            if (a.reset) {
                if (a.pixelLength !== undefined || a.logicalLength !== undefined || a.logicalUnits !== undefined) throw new Error('Give reset or new values, not both');
                lines.push('ms.pixelLength = 1;', 'ms.logicalLength = 1;', 'ms.logicalUnits = "pixels";');
            }
            if (a.pixelLength !== undefined) lines.push(`ms.pixelLength = ${num(a.pixelLength, { min: 1, max: 300000, name: 'pixelLength' })};`);
            if (a.logicalLength !== undefined) lines.push(`ms.logicalLength = ${num(a.logicalLength, { min: 0.0001, max: 1e9, name: 'logicalLength' })};`);
            if (a.logicalUnits !== undefined) lines.push(`ms.logicalUnits = ${str(a.logicalUnits)};`);
            if (a.name !== undefined) lines.push(`ms.name = ${str(a.name)};`);
            return run('Set measurement scale', script(`
var ms = doc.measurementScale;
${lines.join('\n')}
${SCALE}`));
        },
    },
    {
        name: 'record_measurements',
        description: 'Record measurements to the Measurement Log (Image > Analysis > Record Measurements) from the selection, the Ruler tool\'s line or the Count tool\'s items, with a chosen set of data points. The ruler source needs a line drawn with the Ruler tool',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', enum: Object.keys(SOURCES), description: 'What to measure. Default selection' },
                dataPoints: DATA_POINTS_SCHEMA,
            },
        },
        features: ['photoshop.image.record_measurements', 'photoshop.image.select_data_points'],
        handler: (a) => {
            const source = enumOf(a.source ?? 'selection', Object.keys(SOURCES), { name: 'source' });
            return run('Record measurements', script(`
${source === 'selection' ? 'try { var b = doc.selection.bounds; } catch (e) { throw new Error("Nothing is selected to measure"); }' : ''}
doc.recordMeasurements(MeasurementSource.${SOURCES[source]}, ${dataPoints(a.dataPoints)});
__result__ = { recorded: ${str(source)} };`));
        },
    },
    {
        name: 'manage_measurement_log',
        description: 'Work with the Measurement Log panel (Window > Measurement Log): export all or the selected measurements to a tab-delimited text file, delete them, select or deselect all rows, toggle Auto Display Panel, or show or hide the panel',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: LOG_ACTIONS },
                range: { type: 'string', enum: Object.keys(RANGES), description: 'export and delete: all rows or the selected ones. Default all' },
                filePath: { type: 'string', description: 'export: absolute path of a .txt or .csv file' },
                dataPoints: DATA_POINTS_SCHEMA,
            },
            required: ['action'],
        },
        auditArgs: { action: 'export', filePath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'measurements.txt') },
        hints: { destructive: true },
        features: ['photoshop.image.measurement_log_panel', 'photoshop.image.measurement_log_export_selected', 'photoshop.image.measurement_log_delete_selected', 'photoshop.image.measurement_log_select_all', 'photoshop.image.measurement_log_deselect_all', 'photoshop.image.measurement_log_auto_display_panel'],
        handler: (a) => {
            const action = enumOf(a.action, LOG_ACTIONS, { name: 'action' });
            const range = `MeasurementRange.${RANGES[enumOf(a.range ?? 'all', Object.keys(RANGES), { name: 'range' })]}`;
            let body;
            if (action === 'export') {
                if (!a.filePath) throw new Error("'export' needs filePath");
                const p = paths.validate(a.filePath);
                if (!['.txt', '.csv'].includes(path.extname(p).toLowerCase())) throw new Error('filePath must end in .txt or .csv');
                body = `app.measurementLog.exportMeasurements(new File(${jsxPath(p)}), ${range}, ${dataPoints(a.dataPoints)});
__result__ = { exported: ${jsxPath(p)} };`;
            } else if (action === 'delete') {
                body = `app.measurementLog.deleteMeasurements(${range});
__result__ = { deleted: ${str(a.range ?? 'all')} };`;
            } else {
                body = `app.runMenuItem(app.stringIDToTypeID(${str(LOG_MENU[action])}));
__result__ = { done: ${str(action)} };`;
            }
            return run('Measurement log', script(body, { needsDocument: false }));
        },
    },
    {
        name: 'manage_count_items',
        description: 'List, add, remove or clear the Count tool\'s numbered markers (count items) in the document. Positions are pixels from the top-left corner; indexes start at 0',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: COUNT_ACTIONS },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 1, description: 'add: positions, [[x, y], ...]' },
                index: { type: 'integer', minimum: 0, description: 'remove: the count item\'s index' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'add', points: [[10, 20]] },
        features: ['photoshop.image.count_tool', 'photoshop.image.count_clear'],
        handler: (a) => {
            const action = enumOf(a.action, COUNT_ACTIONS, { name: 'action' });
            let body = '';
            if (action === 'add') {
                if (!Array.isArray(a.points) || !a.points.length) throw new Error("'add' needs points");
                const pts = a.points.map((p, i) => [Number(num(p?.[0], { min: 0, max: 300000, name: `points[${i}][0]` })), Number(num(p?.[1], { min: 0, max: 300000, name: `points[${i}][1]` }))]);
                body = `var pts = ${json(pts)};
for (var n = 0; n < pts.length; n++) doc.countItems.add([new UnitValue(pts[n][0], "px"), new UnitValue(pts[n][1], "px")]);`;
            } else if (action === 'remove') {
                if (a.index === undefined) throw new Error("'remove' needs index");
                body = `var at = ${index(a.index, { name: 'index' })};
if (at >= doc.countItems.length) throw new Error("There are only " + doc.countItems.length + " count items");
doc.countItems[at].remove();`;
            } else if (action === 'clear') {
                body = 'while (doc.countItems.length) doc.countItems[doc.countItems.length - 1].remove();';
            }
            return run('Count items', script(`${body}
${COUNTS}`));
        },
    },
];
