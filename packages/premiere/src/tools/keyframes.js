/**
 * Keyframe work on one effect parameter: moving the playhead to the next or
 * previous keyframe, copying keyframes to another parameter or clip, changing
 * how fast an animation runs by spacing its keyframes, and fading clips in and
 * out with Opacity or Volume keyframes.
 *
 * Parameters are chosen as in effects.js: component index and parameter name
 * (or index) from list_clip_effects. Keyframe times are seconds as
 * list_clip_effects reports them; where a tool relates them to the clip's place
 * in the sequence it treats them as the clip's source time (see src/fx.js).
 */
import { bool, enumOf, index, num } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, CLIP_SCHEMA, CLIPS_SCHEMA, sequenceSpec, clipSpec, clipsSpec, seconds } from '../args.js';
import { FX_HELPERS } from '../fx.js';
import { COMPONENT_PROPS, paramSpec, targetLines } from './effects.js';

export const tools = [
    {
        name: 'jump_to_keyframe',
        description: 'Move the playhead to the next or previous keyframe of an effect parameter on a clip (Effect Controls, Go to Next or Previous Keyframe), from the playhead or a given sequence time. Returns the keyframe\'s time and the new playhead',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: CLIP_SCHEMA,
                ...COMPONENT_PROPS,
                direction: { type: 'string', enum: ['next', 'previous'] },
                from: { type: 'number', minimum: 0, description: 'Sequence time to search from, seconds. Default: the playhead' },
            },
            required: ['clip', 'component', 'direction'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 }, component: 1, param: 'Scale', paramIndex: undefined, direction: 'next', from: 2 },
        features: ['premiere.effects_transitions.navigate_keyframes'],
        handler: (a) => {
            const direction = enumOf(a.direction, ['next', 'previous'], { name: 'direction' });
            const from = a.from === undefined ? null : seconds(a.from, 'from');
            return run('Jump to keyframe', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipSpec(a.clip)});
${targetLines(a)}
const clip = targets[0].clip;
const param = targets[0].param;
if (!param.isTimeVarying()) throw new Error(param.displayName + " is not animated: it has no keyframes");
const times = await __clipTimes(clip);
const from = ${from === null ? '__s(await seq.getPlayerPosition())' : from};
const local = __t(times.inPoint + (from - times.start));
const kf = await param.${direction === 'next' ? 'findNextKeyframe' : 'findPreviousKeyframe'}(local);
if (!kf || !kf.position) throw new Error("No ${direction} keyframe of " + param.displayName + " from " + from + " s");
const keyframe = __s(kf.position);
const target = times.start + (keyframe - times.inPoint);
if (!(await seq.setPlayerPosition(__t(Math.max(0, target))))) throw new Error("Premiere Pro did not move the playhead");
return { param: param.displayName, keyframe: keyframe, playhead: __s(await seq.getPlayerPosition()) };`));
        },
    },
    {
        name: 'copy_keyframes',
        description: 'Copy an effect parameter\'s keyframes (values and interpolation) to the same or another parameter on other clips or the same clip (Effect Controls, copy and paste keyframes). Times keep their offset from each clip\'s In point, plus offset. Keyframes are one undo step, interpolation a second',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: { ...CLIP_SCHEMA, description: 'The clip to copy from' },
                ...COMPONENT_PROPS,
                to: { ...CLIPS_SCHEMA, description: 'The clips to paste onto. Default: the source clip' },
                toComponent: { type: 'integer', minimum: 0, description: 'Target component index. Default: the source\'s' },
                toParam: { type: 'string', description: 'Target parameter name. Default: the source\'s' },
                toParamIndex: { type: 'integer', minimum: 0, description: 'Target parameter index instead of a name' },
                offset: { type: 'number', minimum: -86400, maximum: 86400, description: 'Shift the pasted keyframes by this many seconds. Default 0', default: 0 },
                replace: { type: 'boolean', description: 'Remove the target parameter\'s own keyframes first. Default false', default: false },
            },
            required: ['clip', 'component'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 }, component: 1, param: 'Position', paramIndex: undefined, to: { items: [{ track: 'video', trackIndex: 0, clipIndex: 2 }] }, toComponent: undefined, toParam: undefined, toParamIndex: undefined, offset: 0.5, replace: true },
        features: ['premiere.effects_transitions.copy_paste_keyframes'],
        handler: (a) => {
            if (a.toParam !== undefined && a.toParamIndex !== undefined) throw new Error('Give toParam or toParamIndex, not both');
            const toComponent = a.toComponent === undefined ? index(a.component, { name: 'component', max: 999 }) : index(a.toComponent, { name: 'toComponent', max: 999 });
            const toParam = a.toParam !== undefined || a.toParamIndex !== undefined ? paramSpec({ param: a.toParam, paramIndex: a.toParamIndex }) : paramSpec(a);
            const offset = num(a.offset ?? 0, { min: -86400, max: 86400, name: 'offset' });
            const toClips = a.to === undefined ? clipSpec(a.clip) : clipsSpec(a.to);
            return run('Copy keyframes', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipSpec(a.clip)});
${targetLines(a)}
const source = targets[0];
const keys = await __kfRead(source.param);
if (!keys.length) throw new Error(source.param.displayName + " has no keyframes to copy");
const sourceTimes = await __clipTimes(source.clip);
const pastes = [];
for (const clip of await __clips(seq, ${toClips})) {
  const times = await __clipTimes(clip);
  const param = __param(__component(await __chain(clip), ${toComponent}), ${toParam});
  if (!(await param.areKeyframesSupported())) throw new Error(param.displayName + " cannot be animated");
  const shift = times.inPoint - sourceTimes.inPoint + ${offset};
  const moved = keys.map((k) => ({ t: k.t + shift, v: k.v, mode: k.mode }));
  if (moved.some((k) => k.t < 0)) throw new Error("The offset moves keyframes before time 0 on " + (await clip.getName()));
  pastes.push({ clipName: await clip.getName(), param: param, keys: moved });
}
transact(project, "Paste keyframes", (add) => { for (const p of pastes) __kfAdd(p.param, p.keys, add, ${bool(a.replace)}); });
if (keys.some((k) => k.mode !== null)) transact(project, "Paste keyframe interpolation", (add) => { for (const p of pastes) __kfModes(p.param, p.keys, add); });
const out = [];
for (const p of pastes) out.push({ clip: p.clipName, param: p.param.displayName, keyframes: (p.param.getKeyframeListAsTickTimes() || []).map(__s) });
return { from: source.param.displayName, copied: keys.length, pasted: out };`));
        },
    },
    {
        name: 'retime_keyframes',
        description: 'Change how fast an effect animates by spreading its keyframes further apart or closer together (scale) from the first or last keyframe, and optionally shifting them all (offset), keeping each keyframe\'s value and interpolation. Keyframes are one undo step, interpolation a second',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: CLIP_SCHEMA,
                ...COMPONENT_PROPS,
                scale: { type: 'number', minimum: 0.01, maximum: 100, description: 'Spacing factor: 2 makes the animation take twice as long, 0.5 half as long. Default 1', default: 1 },
                anchor: { type: 'string', enum: ['first', 'last'], description: 'The keyframe that stays put when scaling. Default first', default: 'first' },
                offset: { type: 'number', minimum: -86400, maximum: 86400, description: 'Then move every keyframe by this many seconds. Default 0', default: 0 },
            },
            required: ['clip', 'component'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 }, component: 1, param: 'Scale', paramIndex: undefined, scale: 2, anchor: 'first', offset: 0 },
        features: ['premiere.effects_transitions.adjust_effect_speed'],
        handler: (a) => {
            const scale = num(a.scale ?? 1, { min: 0.01, max: 100, name: 'scale' });
            const anchor = enumOf(a.anchor ?? 'first', ['first', 'last'], { name: 'anchor' });
            const offset = num(a.offset ?? 0, { min: -86400, max: 86400, name: 'offset' });
            if (Number(scale) === 1 && Number(offset) === 0) throw new Error('Nothing to change: give a scale other than 1, or an offset');
            return run('Retime keyframes', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipSpec(a.clip)});
${targetLines(a)}
const param = targets[0].param;
const keys = await __kfRead(param);
if (keys.length < 1) throw new Error(param.displayName + " has no keyframes");
const pivot = ${anchor === 'first' ? 'keys[0].t' : 'keys[keys.length - 1].t'};
const moved = keys.map((k) => ({ t: Math.round((pivot + (k.t - pivot) * ${scale} + ${offset}) * 1000000) / 1000000, v: k.v, mode: k.mode }));
if (moved.some((k) => k.t < 0)) throw new Error("The new timing moves keyframes before time 0");
transact(project, "Retime keyframes", (add) => __kfAdd(param, moved, add, true));
if (moved.some((k) => k.mode !== null)) transact(project, "Keyframe interpolation", (add) => __kfModes(param, moved, add));
return { param: param.displayName, before: keys.map((k) => k.t), keyframes: (param.getKeyframeListAsTickTimes() || []).map(__s) };`));
        },
    },
    {
        name: 'fade_clips',
        description: 'Fade clips in and/or out with keyframes: video clips on Opacity (from 0 to their opacity), audio clips on the Volume effect\'s Level (from silence to their level), over the given seconds at the start and end of each clip (Effect Controls keyframes; a cross-fade transition is add_transition). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                fadeIn: { type: 'number', minimum: 0.01, maximum: 3600, description: 'Fade-in length, seconds' },
                fadeOut: { type: 'number', minimum: 0.01, maximum: 3600, description: 'Fade-out length, seconds' },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }, { track: 'audio', trackIndex: 0, clipIndex: 0 }] }, fadeIn: 1, fadeOut: 2 },
        features: ['premiere.effects_transitions.create_fade_in', 'premiere.audio.fade_audio'],
        handler: (a) => {
            if (a.fadeIn === undefined && a.fadeOut === undefined) throw new Error('Give fadeIn, fadeOut or both');
            const fadeIn = a.fadeIn === undefined ? 0 : num(a.fadeIn, { min: 0.01, max: 3600, name: 'fadeIn' });
            const fadeOut = a.fadeOut === undefined ? 0 : num(a.fadeOut, { min: 0.01, max: 3600, name: 'fadeOut' });
            return run('Fade clips', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const fadeIn = ${fadeIn};
const fadeOut = ${fadeOut};
const fades = [];
for (const clip of clips) {
  const clipName = await clip.getName();
  const isVideo = __isVideo(clip);
  const found = await __fxFind(await __chain(clip), [isVideo ? "Opacity" : "Volume"]);
  const param = found ? __fxParam(found.component, isVideo ? "Opacity" : "Level") : null;
  if (!param) throw new Error(clipName + " has no " + (isVideo ? "Opacity > Opacity" : "Volume > Level") + " (list_clip_effects shows its components)");
  if (!(await param.areKeyframesSupported())) throw new Error(param.displayName + " cannot be animated on " + clipName);
  const times = await __clipTimes(clip);
  if (fadeIn + fadeOut > times.outPoint - times.inPoint + 0.000001) throw new Error("The fades (" + (fadeIn + fadeOut) + " s) are longer than " + clipName + " (" + (times.outPoint - times.inPoint) + " s)");
  const keys = [];
  if (fadeIn) {
    const full = __value(await param.getValueAtTime(__t(times.inPoint + fadeIn)));
    keys.push({ t: times.inPoint, v: 0 }, { t: times.inPoint + fadeIn, v: full });
  }
  if (fadeOut) {
    const full = __value(await param.getValueAtTime(__t(times.outPoint - fadeOut)));
    keys.push({ t: times.outPoint - fadeOut, v: full }, { t: times.outPoint, v: 0 });
  }
  fades.push({ clipName: clipName, kind: isVideo ? "video" : "audio", param: param, keys: keys });
}
transact(project, "Fade clips", (add) => { for (const f of fades) __kfAdd(f.param, f.keys, add, false); });
return { faded: fades.map((f) => ({ clip: f.clipName, kind: f.kind, param: f.param.displayName, keyframes: f.keys.map((k) => ({ time: k.t, value: k.v })) })) };`));
        },
    },
];
