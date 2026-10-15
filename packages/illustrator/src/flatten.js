/**
 * Object > Flatten Transparency as a one-step Action, played without its dialog.
 *
 * The object model has no flatten method and the menu command only opens the
 * dialog. The recordable event, ai_plugin_flatten_transparency, carries the
 * dialog's settings; its parameters here are as published scripts record them
 * (FlattenOpacityPro and AI_PS_Library, both MIT; see NOTICE):
 *   'rstz' 1920169082 integer    100, as recorded
 *   'rezl' 1919253100 unit real  resolution in ppi, unit 592342629; AI_PS_Library
 *                                passes it as "dpi" (300, 150, 72)
 *   'ottx' 1869902968, 'otsk' 1869902699, 'ccxr' 1667463282  booleans, 1 as recorded
 * Only the resolution is offered; the other values stay as recorded.
 */
import { nameLines } from './blend.js';

export const FLATTEN_SET = 'adobe-mcp-flatten';
export const FLATTEN_ACTION = 'flattenTransparency';

/** The .aia text for one Flatten Transparency event at a resolution in ppi. */
export function flattenAction(resolution) {
    const param = (n, key, type, value, extra = []) => [
        `\t\t/parameter-${n} {`, `\t\t\t/key ${key}`, '\t\t\t/showInPalette 4294967295', `\t\t\t/type (${type})`, `\t\t\t/value ${value}`, ...extra, '\t\t}',
    ];
    return [
        '/version 3',
        ...nameLines('', 'name', FLATTEN_SET),
        '/isOpen 1',
        '/actionCount 1',
        '/action-1 {',
        ...nameLines('\t', 'name', FLATTEN_ACTION),
        '\t/keyIndex 0',
        '\t/colorIndex 0',
        '\t/isOpen 1',
        '\t/eventCount 1',
        '\t/event-1 {',
        '\t\t/useRulersIn1stQuadrant 0',
        '\t\t/internalName (ai_plugin_flatten_transparency)',
        ...nameLines('\t\t', 'localizedName', 'Flatten Transparency'),
        '\t\t/isOpen 0',
        '\t\t/isOn 1',
        '\t\t/hasDialog 1',
        '\t\t/showDialog 0',
        '\t\t/parameterCount 5',
        ...param(1, 1920169082, 'integer', 100),
        ...param(2, 1919253100, 'unit real', Number(resolution).toFixed(1), ['\t\t\t/unit 592342629']),
        ...param(3, 1869902968, 'boolean', 1),
        ...param(4, 1869902699, 'boolean', 1),
        ...param(5, 1667463282, 'boolean', 1),
        '\t}',
        '}',
    ].join('\n');
}
