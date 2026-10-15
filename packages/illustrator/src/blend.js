/**
 * Blend options through a generated Action.
 *
 * Illustrator's object model has no member for blend options, and the Blend
 * Options menu command only opens its dialog. The recordable Blend Options
 * event, ai_plugin_liveblend, does carry them, so a script writes a one-step
 * Action (.aia text), loads it, plays it on the selected blend and unloads it.
 * The format and parameter codes follow BlendSp (Masahiro Takano, MIT; see
 * NOTICE) and are recorded with that source in the adobe-capability-atlas.
 *
 * Parameters (four-character codes as integers):
 *   'menu' 1835363957  spacing, enumerated: 5 = specified steps
 *   'step' 1937007984  number of steps, integer
 *   'rota' 1919906913  orientation, enumerated: 0 align to page, 1 align to path
 * Smooth Color and Specified Distance are other spacing values; theirs are not
 * established, so they are not offered.
 */
import { index, enumOf } from 'adobe-mcp-core';

export const ACTION_SET = 'adobe-mcp-blend';
export const ACTION_NAME = 'setBlendOptions';
export const ORIENTATION = { page: 0, path: 1 };

const SPACING_SPECIFIED_STEPS = 5;
const KEY = { menu: 1835363957, step: 1937007984, rota: 1919906913 };

/** A name as Actions store it: the UTF-8 bytes in hex, preceded by the byte count. */
function nameLines(indent, field, text) {
    const hex = Buffer.from(text, 'utf8').toString('hex');
    return [`${indent}/${field} [ ${hex.length / 2}`, `${indent}\t${hex}`, `${indent}]`];
}

/** The .aia text for one Blend Options event with specified steps. */
export function blendOptionsAction({ steps, orientation = 'page' }) {
    const stepCount = Number(index(steps, { name: 'steps', max: 1000 }));
    if (stepCount < 1) throw new Error("'steps' must be at least 1");
    const rota = ORIENTATION[enumOf(orientation, Object.keys(ORIENTATION), { name: 'orientation' })];
    return [
        '/version 3',
        ...nameLines('', 'name', ACTION_SET),
        '/isOpen 1',
        '/actionCount 1',
        '/action-1 {',
        ...nameLines('\t', 'name', ACTION_NAME),
        '\t/keyIndex 0',
        '\t/colorIndex 0',
        '\t/isOpen 1',
        '\t/eventCount 1',
        '\t/event-1 {',
        '\t\t/useRulersIn1stQuadrant 0',
        '\t\t/internalName (ai_plugin_liveblend)',
        ...nameLines('\t\t', 'localizedName', 'Blend Options'),
        '\t\t/isOpen 0',
        '\t\t/isOn 1',
        '\t\t/hasDialog 1',
        '\t\t/showDialog 0',
        '\t\t/parameterCount 3',
        '\t\t/parameter-1 {',
        `\t\t\t/key ${KEY.menu}`,
        '\t\t\t/showInPalette 4294967295',
        '\t\t\t/type (enumerated)',
        ...nameLines('\t\t\t', 'name', 'Specified Steps'),
        `\t\t\t/value ${SPACING_SPECIFIED_STEPS}`,
        '\t\t}',
        '\t\t/parameter-2 {',
        `\t\t\t/key ${KEY.step}`,
        '\t\t\t/showInPalette 4294967295',
        '\t\t\t/type (integer)',
        `\t\t\t/value ${stepCount}`,
        '\t\t}',
        '\t\t/parameter-3 {',
        `\t\t\t/key ${KEY.rota}`,
        '\t\t\t/showInPalette 4294967295',
        '\t\t\t/type (enumerated)',
        ...nameLines('\t\t\t', 'name', rota ? 'Align to Path' : 'Align to Page'),
        `\t\t\t/value ${rota}`,
        '\t\t}',
        '\t}',
        '}',
    ].join('\n');
}

/**
 * ES3 statements that write the action to a temporary file, load it, play it
 * on the current selection, and always unload it and remove the file.
 * `actionLiteral` is the .aia text as a JSX string literal.
 */
export function playActionStatements(actionLiteral) {
    return `
var __aia = new File(Folder.temp + "/${ACTION_SET}-" + new Date().getTime() + ".aia");
__aia.encoding = "UTF-8";
if (!__aia.open("w")) throw new Error("Cannot write a temporary action file in " + Folder.temp.fsName);
__aia.write(${actionLiteral});
__aia.close();
try { app.unloadAction(${JSON.stringify(ACTION_SET)}, ""); } catch (e) {}
try {
  app.loadAction(__aia);
  app.doScript(${JSON.stringify(ACTION_NAME)}, ${JSON.stringify(ACTION_SET)});
} finally {
  try { app.unloadAction(${JSON.stringify(ACTION_SET)}, ""); } catch (e) {}
  try { __aia.remove(); } catch (e) {}
}`;
}
