/**
 * Text layers: set the text and its character and paragraph formatting.
 */
import { str, num, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, COLOR_SCHEMA, compSpec, layerSpec, colorValue } from '../args.js';

const JUSTIFY = { left: 'LEFT_JUSTIFY', center: 'CENTER_JUSTIFY', right: 'RIGHT_JUSTIFY', justify_last_left: 'FULL_JUSTIFY_LASTLINE_LEFT', justify_last_center: 'FULL_JUSTIFY_LASTLINE_CENTER', justify_last_right: 'FULL_JUSTIFY_LASTLINE_RIGHT', justify_all: 'FULL_JUSTIFY_LASTLINE_FULL' };

export const tools = [
    {
        name: 'set_text',
        description: 'Set a text layer\'s Source Text and formatting (Character and Paragraph panels): font, size, fill and stroke colour, stroke width, tracking, leading, justification, faux bold and italic, all caps, small caps, baseline shift and scale. Applies to the whole layer, at the current time if Source Text is animated',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA, layers: LAYERS_SCHEMA,
                text: { type: 'string', description: 'New text; line breaks start new lines' },
                font: { type: 'string', description: 'PostScript font name' },
                fontSize: { type: 'number', minimum: 0.1, maximum: 1296 },
                fillColor: COLOR_SCHEMA,
                strokeColor: COLOR_SCHEMA,
                strokeWidth: { type: 'number', minimum: 0, maximum: 1000 },
                tracking: { type: 'number', minimum: -1000, maximum: 10000 },
                leading: { type: 'number', minimum: 0, maximum: 5000, description: 'Turns auto leading off' },
                justification: { type: 'string', enum: Object.keys(JUSTIFY) },
                fauxBold: { type: 'boolean' }, fauxItalic: { type: 'boolean' }, allCaps: { type: 'boolean' }, smallCaps: { type: 'boolean' },
                baselineShift: { type: 'number', minimum: -1000, maximum: 1000 },
                horizontalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent' },
                verticalScale: { type: 'number', minimum: 1, maximum: 1000, description: 'Percent' },
            },
            required: ['layers'],
        },
        auditArgs: { fillColor: '#FFFFFF', strokeColor: 'rgb(0,0,0)' },
        hints: { idempotent: true },
        features: [],
        handler: (a) => {
            const L = [];
            if (a.text !== undefined) L.push(`td.text = ${str(String(a.text).replace(/\r\n|\n/g, '\r'))};`);
            if (a.font !== undefined) L.push(`td.font = ${str(a.font)};`);
            if (a.fontSize !== undefined) L.push(`td.fontSize = ${num(a.fontSize, { min: 0.1, max: 1296, name: 'fontSize' })};`);
            if (a.fillColor !== undefined) L.push(`td.applyFill = true; td.fillColor = ${colorValue(a.fillColor, 'fillColor')};`);
            if (a.strokeColor !== undefined) L.push(`td.applyStroke = true; td.strokeColor = ${colorValue(a.strokeColor, 'strokeColor')};`);
            if (a.strokeWidth !== undefined) L.push(`td.strokeWidth = ${num(a.strokeWidth, { min: 0, max: 1000, name: 'strokeWidth' })};`);
            if (a.tracking !== undefined) L.push(`td.tracking = ${num(a.tracking, { min: -1000, max: 10000, name: 'tracking' })};`);
            if (a.leading !== undefined) L.push(`td.autoLeading = false; td.leading = ${num(a.leading, { min: 0, max: 5000, name: 'leading' })};`);
            if (a.justification !== undefined) L.push(`td.justification = ParagraphJustification.${JUSTIFY[enumOf(a.justification, Object.keys(JUSTIFY), { name: 'justification' })]};`);
            for (const k of ['fauxBold', 'fauxItalic', 'allCaps', 'smallCaps']) if (a[k] !== undefined) L.push(`td.${k} = ${bool(a[k])};`);
            if (a.baselineShift !== undefined) L.push(`td.baselineShift = ${num(a.baselineShift, { min: -1000, max: 1000, name: 'baselineShift' })};`);
            if (a.horizontalScale !== undefined) L.push(`td.horizontalScale = ${num(a.horizontalScale, { min: 1, max: 1000, name: 'horizontalScale' })} / 100;`);
            if (a.verticalScale !== undefined) L.push(`td.verticalScale = ${num(a.verticalScale, { min: 1, max: 1000, name: 'verticalScale' })} / 100;`);
            if (!L.length) throw new Error('Give text or formatting');
            return run('Set text', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  if (!(ls[i] instanceof TextLayer)) throw new Error(ls[i].name + " is not a text layer");
  var p = ls[i].property("ADBE Text Properties").property("ADBE Text Document"), td = p.value;
  ${L.join('\n  ')}
  if (p.numKeys > 0) p.setValueAtTime(c.time, td); else p.setValue(td);
  var v = p.value;
  out.push({ layer: ls[i].index, text: v.text, font: v.font, fontSize: v.fontSize });
}
__result__ = { layers: out };`, { undo: 'Set text' }));
        },
    },
];
