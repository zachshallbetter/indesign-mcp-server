/**
 * Audio: layer Audio Levels (static or keyframed), playback speed and pitch
 * through time remapping, and the Convert Audio to Keyframes and Edit in Adobe
 * Audition commands.
 */
import { str, num, enumOf, json } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { COMP_SCHEMA, LAYERS_SCHEMA, compSpec, layerSpec } from '../args.js';

const LEVELS_SCHEMA = {
    description: 'Decibels for both channels, or [left, right]; 0 leaves the audio unchanged',
    oneOf: [
        { type: 'number', minimum: -192, maximum: 48 },
        { type: 'array', items: { type: 'number', minimum: -192, maximum: 48 }, minItems: 2, maxItems: 2 },
    ],
};

/** Audio Levels as a [left, right] array of decibels. */
function levels(value, name = 'levels') {
    const pair = Array.isArray(value) ? value : [value, value];
    if (pair.length !== 2) throw new Error(`'${name}' must be a number or [left, right]`);
    return pair.map((v, i) => Number(num(v, { min: -192, max: 48, name: `${name}[${i}]` })));
}

/** ES3: fail unless layer `l` carries audio. */
const NEEDS_AUDIO = 'if (!(l instanceof AVLayer) || !l.hasAudio) throw new Error("Layer " + l.index + " (" + l.name + ") has no audio");';

const AUDIO_COMMANDS = {
    convert_to_keyframes: { name: 'Convert Audio to Keyframes', id: 4218 },
    edit_in_audition: { name: 'Edit in Adobe Audition', id: 3697 },
};

export const tools = [
    {
        name: 'set_audio_levels',
        description: 'Set layers\' Audio Levels (the Audio group, L in the Timeline) in decibels: a static value, or keyframes at times (Animation > Add Audio Levels Keyframe)',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                levels: LEVELS_SCHEMA,
                keyframes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    description: 'Instead of levels: keyframes, each a time and levels',
                    items: { type: 'object', properties: { time: { type: 'number', minimum: 0, description: 'Seconds' }, levels: LEVELS_SCHEMA }, required: ['time', 'levels'] },
                },
            },
            required: ['layers'],
        },
        auditArgs: { levels: undefined, keyframes: [{ time: 0, levels: -48 }, { time: 1, levels: [0, -3] }] },
        features: ['aftereffects.audio.audio_property_group', 'aftereffects.audio.audio_levels', 'aftereffects.audio.add_audio_levels_keyframe'],
        handler: (a) => {
            if ((a.levels === undefined) === (a.keyframes === undefined)) throw new Error('Give levels or keyframes');
            let set;
            if (a.levels !== undefined) {
                set = `var v = ${json(levels(a.levels))}; if (p.numKeys > 0) p.setValueAtTime(c.time, v); else p.setValue(v);`;
            } else {
                if (!Array.isArray(a.keyframes) || !a.keyframes.length) throw new Error("'keyframes' must list at least one keyframe");
                const keys = a.keyframes.map((k, i) => {
                    if (!k || typeof k !== 'object') throw new Error(`keyframes[${i}] must be an object`);
                    return { t: Number(num(k.time, { min: 0, name: `keyframes[${i}].time` })), v: levels(k.levels, `keyframes[${i}].levels`) };
                });
                set = `var keys = ${json(keys)}; for (var k = 0; k < keys.length; k++) p.setValueAtTime(keys[k].t, keys[k].v);`;
            }
            return run('Audio levels', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), out = [];
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  ${NEEDS_AUDIO}
  var p = l.property("ADBE Audio Group").property("ADBE Audio Levels");
  ${set}
  out.push({ layer: l.index, levels: p.value, keyframes: p.numKeys });
}
__result__ = { layers: out };`, { undo: 'Audio levels' }));
        },
    },
    {
        name: 'remap_layer_speed',
        description: 'Play layers faster or slower with time remapping (Layer > Time > Enable Time Remapping), which also raises or lowers the pitch of their audio. Replaces any Time Remap keyframes with a constant speed and moves the Out point to the new end',
        inputSchema: {
            type: 'object',
            properties: {
                comp: COMP_SCHEMA,
                layers: LAYERS_SCHEMA,
                speedPercent: { type: 'number', minimum: 1, maximum: 1000, description: 'Playback speed: 100 is normal, 200 twice as fast and an octave higher, 50 half speed. Keep audio under about 200' },
            },
            required: ['layers', 'speedPercent'],
        },
        auditArgs: { speedPercent: 150 },
        features: ['aftereffects.audio.time_remap_audio_pitch'],
        handler: (a) => run('Remap speed', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), speed = ${num(a.speedPercent, { min: 1, max: 1000, name: 'speedPercent' })}, out = [];
for (var i = 0; i < ls.length; i++) {
  var l = ls[i];
  if (!(l instanceof AVLayer) || !l.canSetTimeRemapEnabled) throw new Error("Layer " + l.index + " (" + l.name + ") cannot be time-remapped");
  if (!l.timeRemapEnabled) l.timeRemapEnabled = true;
  var tr = l.property("ADBE Time Remapping");
  var t0 = tr.keyTime(1), v0 = tr.keyValue(1), v1 = tr.keyValue(tr.numKeys);
  for (var k = tr.numKeys; k > 1; k--) tr.removeKey(k);
  var t1 = t0 + (v1 - v0) * 100 / speed;
  tr.setValueAtTime(t1, v1);
  l.outPoint = t1;
  out.push({ layer: l.index, speedPercent: speed, inPoint: l.inPoint, outPoint: l.outPoint });
}
__result__ = { layers: out };`, { undo: 'Remap speed' })),
    },
    {
        name: 'run_audio_command',
        description: 'Run an audio command on layers: Convert Audio to Keyframes (Animation > Keyframe Assistant), which adds an Audio Amplitude layer with Slider keyframes, or Edit in Adobe Audition (Edit menu), which opens the layer\'s audio file in Audition when it is installed',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: Object.keys(AUDIO_COMMANDS), description: 'The command' },
                comp: COMP_SCHEMA,
                layers: { ...LAYERS_SCHEMA, description: 'The audio layers to select first (1-based indexes, names, or selected: true)' },
            },
            required: ['command', 'layers'],
        },
        auditArgs: { command: 'convert_to_keyframes' },
        hints: { openWorld: true },
        features: ['aftereffects.audio.convert_audio_to_keyframes', 'aftereffects.audio.edit_in_adobe_audition'],
        handler: (a) => {
            const cmd = AUDIO_COMMANDS[enumOf(a.command, Object.keys(AUDIO_COMMANDS), { name: 'command' })];
            return run('Audio command', script(`
var c = __comp(${compSpec(a.comp)}), ls = __layers(c, ${layerSpec(a.layers)}), i;
for (i = 0; i < ls.length; i++) { var l = ls[i]; ${NEEDS_AUDIO} }
var vw = c.openInViewer(); if (vw) vw.setActive();
for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
for (i = 0; i < ls.length; i++) ls[i].selected = true;
var before = c.numLayers, id = app.findMenuCommandId(${str(cmd.name)}) || ${cmd.id};
app.executeCommand(id);
__result__ = { command: ${str(cmd.name)}, added: c.numLayers > before ? __layerInfo(c.layer(1)) : null };`, { undo: cmd.name }));
        },
    },
];
