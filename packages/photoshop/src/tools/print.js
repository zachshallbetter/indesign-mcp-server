/**
 * Printing: the document's print settings (printer, copies, colour handling,
 * position and scale, marks, output functions), printing without the Print
 * dialog, and Image > Trap.
 */
import { str, num, bool, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COLOR_SCHEMA, colorSpec } from '../args.js';
import { optionLines } from '../options.js';

const INTENT = { type: 'Intent', values: { perceptual: 'PERCEPTUAL', saturation: 'SATURATION', relative_colorimetric: 'RELATIVECOLORIMETRIC', absolute_colorimetric: 'ABSOLUTECOLORIMETRIC' } };
const POSITION = { centered: 'PRINTCENTERED', fit: 'SIZETOFIT', custom: 'USERDEFINED' };

/** DocumentPrintSettings properties set directly, by parameter name. */
const SETTINGS = {
    printer: { kind: 'str', prop: 'activePrinter', description: 'Printer name, from get_print_options' },
    copies: { kind: 'int', min: 1, max: 999, description: 'Number of copies' },
    colorHandling: { kind: 'enum', type: 'PrintColorHandling', values: { photoshop: 'PHOTOSHOPMANAGED', printer: 'PRINTERMANAGED', separations: 'SEPARATIONS' }, description: 'Photoshop manages colours, the printer manages colours, or print each channel as a separation' },
    printSpace: { kind: 'str', description: 'Printer profile (print space) name; empty string for the same as the source' },
    renderingIntent: { kind: 'enum', prop: 'renderIntent', ...INTENT, description: 'Rendering intent when the print space differs from the source' },
    blackPointCompensation: { kind: 'bool', prop: 'mapBlack', description: 'Black point compensation' },
    hardProof: { kind: 'bool', description: 'Print a hard proof that simulates the Proof Setup device' },
    cornerCropMarks: { kind: 'bool', description: 'Printing marks: corner crop marks' },
    centerCropMarks: { kind: 'bool', description: 'Printing marks: centre crop marks' },
    registrationMarks: { kind: 'bool', description: 'Printing marks: registration marks' },
    description: { kind: 'bool', prop: 'caption', description: 'Printing marks: print the File Info description' },
    labels: { kind: 'bool', description: 'Printing marks: print the document title' },
    flip: { kind: 'bool', description: 'Functions: emulsion down (flip horizontally)' },
    negative: { kind: 'bool', description: 'Functions: negative' },
    border: { kind: 'px', prop: 'printBorder', max: 10000, description: 'Functions: border width, pixels' },
    bleed: { kind: 'px', prop: 'bleedWidth', max: 10000, description: 'Functions: bleed width, pixels' },
    colorBars: { kind: 'bool', description: 'PostScript: colour calibration bars' },
    interpolate: { kind: 'bool', description: 'PostScript: interpolation' },
    vectorData: { kind: 'bool', description: 'PostScript: include vector data' },
};

const READ = `
var ps = doc.printSettings, out = {};
try { out.printer = ps.activePrinter; } catch (e) {}
try { out.printerName = ps.printerName; } catch (e) {}
try { var list = []; for (var i = 0; i < ps.printers.length; i++) list.push(String(ps.printers[i])); out.printers = list; } catch (e) {}
try { out.copies = ps.copies; } catch (e) {}
try { out.colorHandling = __enumName(ps.colorHandling); out.printSpace = ps.printSpace; out.renderingIntent = __enumName(ps.renderIntent); out.blackPointCompensation = ps.mapBlack; out.hardProof = ps.hardProof; } catch (e) {}
try { out.position = { style: __enumName(ps.docPosition), x: __px(ps.posX), y: __px(ps.posY), scale: ps.scale }; } catch (e) {}
try { out.marks = { cornerCropMarks: ps.cornerCropMarks, centerCropMarks: ps.centerCropMarks, registrationMarks: ps.registrationMarks, description: ps.caption, labels: ps.labels }; } catch (e) {}
try { out.functions = { flip: ps.flip, negative: ps.negative, border: __px(ps.printBorder), bleed: __px(ps.bleedWidth), background: __colorInfo(ps.backgroundColor) }; } catch (e) {}
try { out.postscript = { colorBars: ps.colorBars, interpolate: ps.interpolate, vectorData: ps.vectorData }; } catch (e) {}`;

export const tools = [
    {
        name: 'get_print_options',
        description: 'Read the active document\'s print settings (File > Print): the printer and the printers available, copies, colour handling, print space, rendering intent, position and scale, printing marks, functions and PostScript options',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['photoshop.print.print_settings_object', 'photoshop.print.printer'],
        handler: () => run('Print settings', script(`${READ}\n__result__ = out;`)),
    },
    {
        name: 'set_print_options',
        description: 'Change the active document\'s print settings (File > Print) without the dialog: printer, copies, colour handling (including separations), print space, rendering intent, black point compensation, hard proof, position and scale, printing marks, functions (emulsion down, negative, background, border, bleed) and PostScript options. Only the settings given change',
        inputSchema: {
            type: 'object',
            properties: {
                ...Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, {
                    ...(s.kind === 'bool' ? { type: 'boolean' } : s.kind === 'int' ? { type: 'integer', minimum: s.min, maximum: s.max } : s.kind === 'px' ? { type: 'number', minimum: 0 } : { type: 'string' }),
                    ...(s.values ? { enum: Object.keys(s.values) } : {}),
                    description: s.description,
                }])),
                background: { ...COLOR_SCHEMA, description: `Functions: page background colour. ${COLOR_SCHEMA.description}` },
                position: {
                    type: 'object',
                    description: 'Position and scale on the page: centered, fit (scale to fit the media), or custom with x and y (pixels from the page\'s top-left) and scale (percent)',
                    properties: {
                        style: { type: 'string', enum: Object.keys(POSITION) },
                        x: { type: 'number' },
                        y: { type: 'number' },
                        scale: { type: 'number', minimum: 1, maximum: 1000 },
                    },
                    required: ['style'],
                },
            },
        },
        hints: { idempotent: true },
        auditArgs: { position: { style: 'custom', x: 20, y: 30, scale: 80 }, background: '#FFFFFF', printSpace: 'U.S. Web Coated (SWOP) v2' },
        features: ['photoshop.print.print_settings_object', 'photoshop.print.printer', 'photoshop.print.copies', 'photoshop.print.color_handling', 'photoshop.print.printer_profile', 'photoshop.print.print_rendering_intent', 'photoshop.print.print_black_point_compensation', 'photoshop.print.hard_proofing', 'photoshop.print.position_and_size', 'photoshop.print.printing_marks', 'photoshop.print.print_functions', 'photoshop.print.postscript_options', 'photoshop.print.print_separations'],
        handler: (a) => {
            const given = Object.fromEntries(Object.keys(SETTINGS).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
            const lines = [optionLines(SETTINGS, given, { name: 'settings', target: 'ps', what: 'Print settings' })];
            if (a.background !== undefined) lines.push(`ps.backgroundColor = __color(${colorSpec(a.background, 'background')});`);
            if (a.position !== undefined) {
                const pos = a.position;
                if (!pos || typeof pos !== 'object') throw new Error("'position' must be { style, x, y, scale }");
                const style = enumOf(pos.style, Object.keys(POSITION), { name: 'position.style' });
                if (style === 'custom') {
                    if (pos.x === undefined || pos.y === undefined) throw new Error('A custom position needs x and y');
                    lines.push(`ps.setPagePosition(DocPositionStyle.USERDEFINED, new UnitValue(${num(pos.x, { name: 'position.x' })}, "px"), new UnitValue(${num(pos.y, { name: 'position.y' })}, "px"), ${num(pos.scale ?? 100, { min: 1, max: 1000, name: 'position.scale' })});`);
                } else {
                    if (pos.x !== undefined || pos.y !== undefined || pos.scale !== undefined) throw new Error('x, y and scale are for a custom position');
                    lines.push(`ps.setPagePosition(DocPositionStyle.${POSITION[style]});`);
                }
            }
            if (lines.join('').trim() === '') throw new Error('Give at least one setting to change (get_print_options reads them)');
            return run('Set print settings', script(`
var ps = doc.printSettings;
${lines.filter(Boolean).join('\n')}
${READ}
__result__ = out;`));
        },
    },
    {
        name: 'print_image',
        description: 'Print the active document with its print settings and no Print dialog (File > Print), or print one copy with the current settings (File > Print One Copy). Set the printer and options first with set_print_options',
        inputSchema: {
            type: 'object',
            properties: {
                oneCopy: { type: 'boolean', description: 'Print One Copy with the current settings; the other options do not apply. Default false', default: false },
                source: { type: 'string', enum: ['document', 'proof'], description: 'Print the document\'s colours, or a hard proof of the Proof Setup. Default document' },
                printSpace: { type: 'string', description: 'Printer profile name. Default: the print settings\' print space' },
                renderingIntent: { type: 'string', enum: Object.keys(INTENT.values), description: 'Default relative_colorimetric' },
                blackPointCompensation: { type: 'boolean', description: 'Default true' },
            },
        },
        hints: { openWorld: true },
        auditArgs: { oneCopy: false, source: 'proof', printSpace: 'U.S. Web Coated (SWOP) v2' },
        features: ['photoshop.print.print', 'photoshop.print.print_one_copy', 'photoshop.print.hard_proofing', 'photoshop.print.printer_profile', 'photoshop.print.print_rendering_intent', 'photoshop.print.print_black_point_compensation'],
        handler: (a) => {
            if (a.oneCopy) {
                if (['source', 'printSpace', 'renderingIntent', 'blackPointCompensation'].some((k) => a[k] !== undefined)) throw new Error('oneCopy prints with the current settings: drop source, printSpace, renderingIntent and blackPointCompensation');
                return run('Print one copy', script('doc.printOneCopy();\n__result__ = { printed: doc.name, copies: 1 };'));
            }
            const source = enumOf(a.source ?? 'document', ['document', 'proof'], { name: 'source' }).toUpperCase();
            const intent = INTENT.values[enumOf(a.renderingIntent ?? 'relative_colorimetric', Object.keys(INTENT.values), { name: 'renderingIntent' })];
            return run('Print', script(`
var space = ${a.printSpace !== undefined ? str(a.printSpace) : 'doc.printSettings.printSpace'};
doc.print(SourceSpaceType.${source}, space, Intent.${intent}, ${bool(a.blackPointCompensation ?? true)});
__result__ = { printed: doc.name, copies: doc.printSettings.copies, printer: doc.printSettings.activePrinter };`));
        },
    },
    {
        name: 'apply_trap',
        description: 'Add trapping to a CMYK document (Image > Trap): overlaps between adjacent colours that hide misregistration on press. The document must be in CMYK mode',
        inputSchema: { type: 'object', properties: { width: { type: 'number', minimum: 0.1, maximum: 100, description: 'Trap width in pixels' } }, required: ['width'] },
        features: ['photoshop.print.trap'],
        handler: (a) => run('Trap', script(`
if (doc.mode !== DocumentMode.CMYK) throw new Error("Trap needs a CMYK document; this one is " + __enumName(doc.mode));
doc.trap(${num(a.width, { min: 0.1, max: 100, name: 'width' })});
__result__ = { trapped: doc.name, width: ${num(a.width, { min: 0.1, max: 100, name: 'width' })} };`)),
    },
];
