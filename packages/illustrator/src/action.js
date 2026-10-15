/**
 * One-event Actions, generated and played by a script.
 *
 * Some Illustrator commands are reachable only through the Actions panel. A
 * script writes the event as Action text (.aia), loads it, plays it on the
 * current selection and unloads it again, so nothing stays in the user's
 * Actions panel. The layout is the one Illustrator writes when it saves an
 * action set; src/blend.js uses the same layout for Blend Options.
 *
 * Only events and parameter codes that published scripts and recorded action
 * sets establish are used; each caller cites its sources.
 */
import { str } from 'adobe-mcp-core';

/** A name as Actions store it: the UTF-8 bytes in hex, preceded by the byte count. */
function nameLines(indent, field, text) {
    const hex = Buffer.from(text, 'utf8').toString('hex');
    return [`${indent}/${field} [ ${hex.length / 2}`, `${indent}\t${hex}`, `${indent}]`];
}

/** One parameter: { key, type: 'integer' | 'boolean' | 'enumerated' | 'unit real', value, unit?, name? }. */
function parameterLines(p, i) {
    const t = '\t\t\t';
    const value = p.type === 'boolean' ? Number(Boolean(p.value))
        : p.type === 'unit real' && Number.isInteger(p.value) ? p.value.toFixed(1) : p.value;
    return [
        `\t\t/parameter-${i + 1} {`,
        `${t}/key ${p.key}`,
        `${t}/showInPalette 4294967295`,
        `${t}/type (${p.type})`,
        ...(p.name ? nameLines(t, 'name', p.name) : []),
        `${t}/value ${value}`,
        ...(p.unit ? [`${t}/unit ${p.unit}`] : []),
        '\t\t}',
    ];
}

/**
 * The .aia text for an action set with one action holding one event.
 * hasDialog marks events whose command has a dialog; the dialog stays closed.
 */
export function actionText({ set, action, internalName, localizedName, hasDialog = false, parameters = [] }) {
    if (!/^[a-z_A-Z0-9]+$/.test(internalName)) throw new Error(`Bad action event name: ${internalName}`);
    return [
        '/version 3',
        ...nameLines('', 'name', set),
        '/isOpen 1',
        '/actionCount 1',
        '/action-1 {',
        ...nameLines('\t', 'name', action),
        '\t/keyIndex 0',
        '\t/colorIndex 0',
        '\t/isOpen 1',
        '\t/eventCount 1',
        '\t/event-1 {',
        '\t\t/useRulersIn1stQuadrant 0',
        `\t\t/internalName (${internalName})`,
        ...nameLines('\t\t', 'localizedName', localizedName),
        '\t\t/isOpen 0',
        '\t\t/isOn 1',
        `\t\t/hasDialog ${hasDialog ? 1 : 0}`,
        ...(hasDialog ? ['\t\t/showDialog 0'] : []),
        `\t\t/parameterCount ${parameters.length}`,
        ...parameters.flatMap(parameterLines),
        '\t}',
        '}',
    ].join('\n');
}

/**
 * ES3 statements that write the action to a temporary file, load it, play it
 * on the current selection, and always unload it and remove the file.
 */
export function playAction(spec) {
    const set = str(spec.set), action = str(spec.action);
    return `
var __aia = new File(Folder.temp + "/" + ${set} + "-" + new Date().getTime() + ".aia");
__aia.encoding = "UTF-8";
if (!__aia.open("w")) throw new Error("Cannot write a temporary action file in " + Folder.temp.fsName);
__aia.write(${str(actionText(spec))});
__aia.close();
try { app.unloadAction(${set}, ""); } catch (e) {}
try {
  app.loadAction(__aia);
  app.doScript(${action}, ${set});
} finally {
  try { app.unloadAction(${set}, ""); } catch (e) {}
  try { __aia.remove(); } catch (e) {}
}`;
}
