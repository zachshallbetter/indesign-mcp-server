/**
 * Effects and transitions: what is installed, what a clip has, applying and
 * removing effects, setting parameters and keyframes, adding and removing
 * video transitions, and an audio clip's volume level.
 *
 * A clip's effects are its component chain (Effect Controls): fixed effects
 * first (Motion, Opacity, Time Remapping for video; Volume, Channel Volume,
 * Panner for audio), then applied ones. Components and parameters are chosen
 * by index or name as list_clip_effects reports them.
 */
import { bool, json, str, enumOf, index, num } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, CLIP_SCHEMA, CLIPS_SCHEMA, PARAM_VALUE_SCHEMA, sequenceSpec, clipSpec, clipsSpec, paramValue, seconds } from '../args.js';
import { VIDEO_EFFECT_FEATURES, AUDIO_EFFECT_FEATURES, TRANSITION_FEATURES } from '../features.js';

const INTERPOLATION = ['LINEAR', 'BEZIER', 'HOLD', 'TIME'];

const COMPONENT_PROPS = {
    component: { type: 'integer', minimum: 0, description: 'Component index from list_clip_effects' },
    param: { type: 'string', description: 'Parameter name as list_clip_effects reports it, e.g. "Scale"' },
    paramIndex: { type: 'integer', minimum: 0, description: 'Parameter index instead of a name' },
};

function paramSpec(a) {
    if ((a.param === undefined) === (a.paramIndex === undefined)) throw new Error('Choose the parameter: param (name) or paramIndex');
    return a.param !== undefined ? json({ param: String(a.param) }) : json({ paramIndex: Number(index(a.paramIndex, { name: 'paramIndex', max: 999 })) });
}

/** Script lines that find `param` on each clip: [{ clip, param }] in `targets`. */
function targetLines(a) {
    return `const targets = [];
for (const clip of clips) {
  const chain = await __chain(clip);
  const component = __component(chain, ${index(a.component, { name: 'component', max: 999 })});
  targets.push({ clip: clip, param: __param(component, ${paramSpec(a)}) });
}`;
}

export const tools = [
    {
        name: 'list_available_effects',
        description: 'List the video effects (match names and display names), audio effects (display names) or video transitions (match names) Premiere Pro has installed. These are the names apply_effect and add_transition take',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['video_effects', 'audio_effects', 'video_transitions'] },
                filter: { type: 'string', description: 'Only names containing this text (case-insensitive)' },
            },
            required: ['kind'],
        },
        auditArgs: { kind: 'video_effects', filter: 'blur' },
        hints: { readOnly: true },
        features: ['premiere.effects_transitions.effects_panel', 'premiere.effects_transitions.transitions_overview'],
        handler: (a) => {
            const kind = enumOf(a.kind, ['video_effects', 'audio_effects', 'video_transitions'], { name: 'kind' });
            const body = {
                video_effects: `const matchNames = await ppro.VideoFilterFactory.getMatchNames();
const displayNames = await ppro.VideoFilterFactory.getDisplayNames();
const same = matchNames.length === displayNames.length;
list = matchNames.map((m, i) => ({ matchName: m, displayName: same ? displayNames[i] : null }));`,
                audio_effects: 'list = (await ppro.AudioFilterFactory.getDisplayNames()).map((d) => ({ displayName: d }));',
                video_transitions: 'list = (await ppro.TransitionFactory.getVideoTransitionMatchNames()).map((m) => ({ matchName: m }));',
            }[kind];
            return run('List available effects', script(`
let list;
${body}
const filter = ${a.filter === undefined ? 'null' : str(String(a.filter).toLowerCase())};
const out = list.filter((e) => filter === null || [e.matchName, e.displayName].some((n) => n && n.toLowerCase().includes(filter)));
return { kind: ${str(kind)}, count: out.length, effects: out };`));
        },
    },
    {
        name: 'list_clip_effects',
        description: 'List a clip\'s effects (its component chain, as in Effect Controls) with each parameter\'s name, value and keyframe times. Component and parameter indexes are what the other effect tools take',
        inputSchema: { type: 'object', properties: { sequence: SEQUENCE_SCHEMA, clip: CLIP_SCHEMA }, required: ['clip'] },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 } },
        hints: { readOnly: true },
        features: ['premiere.effects_transitions.effect_controls_panel', 'premiere.effects_transitions.component', 'premiere.effects_transitions.component_param'],
        handler: (a) => run('List clip effects', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const [clip] = await __clips(seq, ${clipSpec(a.clip)});
const chain = await __chain(clip);
const components = [];
for (let i = 0; i < chain.getComponentCount(); i++) components.push(await __componentInfo(chain.getComponentAtIndex(i), i));
return { clip: await clip.getName(), kind: __isVideo(clip) ? "video" : "audio", components: components };`)),
    },
    {
        name: 'apply_effect',
        description: 'Apply an effect to clips: a video effect by match name or display name to video clips, an audio effect by display name to audio clips (names from list_available_effects). Appended to the end of the chain, or inserted at position. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                effect: { type: 'string', description: 'Video: match name (e.g. "AE.ADBE Gaussian Blur 2") or display name; audio: display name' },
                position: { type: 'integer', minimum: 0, description: 'Insert at this component index instead of appending' },
            },
            required: ['clips', 'effect'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }, { track: 'audio', trackIndex: 0, clipIndex: 0 }] }, effect: 'Gaussian Blur', position: 3 },
        features: ['premiere.effects_transitions.apply_effect', 'premiere.effects_transitions.component', ...VIDEO_EFFECT_FEATURES, ...AUDIO_EFFECT_FEATURES],
        handler: (a) => {
            if (typeof a.effect !== 'string' || !a.effect.trim()) throw new Error("'effect' is empty");
            const position = a.position === undefined ? null : index(a.position, { name: 'position', max: 999 });
            return run('Apply effect', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const effect = ${str(a.effect)};
let videoMatch = null;
const prepared = [];
for (const clip of clips) {
  const chain = await __chain(clip);
  let component;
  if (__isVideo(clip)) {
    if (videoMatch === null) {
      const matchNames = await ppro.VideoFilterFactory.getMatchNames();
      const displayNames = await ppro.VideoFilterFactory.getDisplayNames();
      if (matchNames.includes(effect)) videoMatch = effect;
      else if (matchNames.length === displayNames.length && displayNames.includes(effect)) videoMatch = matchNames[displayNames.indexOf(effect)];
      else throw new Error("No video effect named " + effect + " (list_available_effects lists them)");
    }
    component = await ppro.VideoFilterFactory.createComponent(videoMatch);
  } else {
    component = await ppro.AudioFilterFactory.createComponentByDisplayName(effect, clip);
  }
  if (!component) throw new Error("Premiere Pro could not create " + effect + " for " + (await clip.getName()));
  prepared.push({ clip: clip, chain: chain, component: component });
}
const position = ${position === null ? 'null' : position};
transact(project, "Apply " + effect, (add) => {
  for (const p of prepared) add(position === null ? p.chain.createAppendComponentAction(p.component) : p.chain.createInsertComponentAction(p.component, position));
});
const out = [];
for (const p of prepared) out.push({ clip: await p.clip.getName(), components: (await __chain(p.clip)).getComponentCount() });
return { effect: effect, applied: out };`));
        },
    },
    {
        name: 'remove_effect',
        description: 'Remove an applied effect from clips, by component index (from list_clip_effects). One undo step',
        inputSchema: {
            type: 'object',
            properties: { sequence: SEQUENCE_SCHEMA, clips: CLIPS_SCHEMA, component: COMPONENT_PROPS.component },
            required: ['clips', 'component'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }] }, component: 3 },
        hints: { destructive: true },
        features: ['premiere.effects_transitions.remove_effect', 'premiere.editing.remove_attributes'],
        handler: (a) => run('Remove effect', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const prepared = [];
for (const clip of clips) {
  const chain = await __chain(clip);
  const component = __component(chain, ${index(a.component, { name: 'component', max: 999 })});
  prepared.push({ clip: clip, chain: chain, component: component, name: await component.getDisplayName() });
}
transact(project, "Remove effect", (add) => { for (const p of prepared) add(p.chain.createRemoveComponentAction(p.component)); });
const out = [];
for (const p of prepared) out.push({ clip: await p.clip.getName(), removed: p.name });
return { removed: out };`)),
    },
    {
        name: 'set_effect_param',
        description: 'Set an effect parameter on clips to one value (not animated). An animated parameter keeps its keyframes unless clearKeyframes is true. Values: numbers, text, true/false, points { x, y }, colours { red, green, blue, alpha } from 0 to 1. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                ...COMPONENT_PROPS,
                value: PARAM_VALUE_SCHEMA,
                clearKeyframes: { type: 'boolean', description: 'Turn animation off first (removes the parameter\'s keyframes). Default false', default: false },
            },
            required: ['clips', 'component', 'value'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }] }, component: 1, param: 'Scale', paramIndex: undefined, value: 120, clearKeyframes: true },
        hints: { idempotent: true },
        features: ['premiere.effects_transitions.component_param', 'premiere.effects_transitions.toggle_animation', 'premiere.editing.properties_panel_editing'],
        handler: (a) => {
            const value = paramValue(a.value);
            return run('Set effect parameter', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
${targetLines(a)}
for (const t of targets) {
  if (t.param.isTimeVarying() && !${bool(a.clearKeyframes)}) throw new Error(t.param.displayName + " is animated on " + (await t.clip.getName()) + ": use add_keyframes, or pass clearKeyframes: true");
}
transact(project, "Set " + targets[0].param.displayName, (add) => {
  for (const t of targets) {
    if (t.param.isTimeVarying()) add(t.param.createSetTimeVaryingAction(false));
    add(t.param.createSetValueAction(t.param.createKeyframe(__paramValue(${value})), true));
  }
});
const out = [];
for (const t of targets) out.push({ clip: await t.clip.getName(), param: t.param.displayName, value: __value(await t.param.getStartValue()) });
return { set: out };`));
        },
    },
    {
        name: 'add_keyframes',
        description: 'Animate an effect parameter on a clip: turn animation on and add keyframes at times (seconds, as list_clip_effects reports keyframe times) with values and optional interpolation. Keyframes are one undo step, interpolation a second',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: CLIP_SCHEMA,
                ...COMPONENT_PROPS,
                keyframes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    items: {
                        type: 'object',
                        properties: { time: { type: 'number', minimum: 0 }, value: PARAM_VALUE_SCHEMA, interpolation: { type: 'string', enum: INTERPOLATION.map((s) => s.toLowerCase()) } },
                        required: ['time', 'value'],
                    },
                },
            },
            required: ['clip', 'component', 'keyframes'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 }, component: 1, param: 'Position', paramIndex: undefined, keyframes: [{ time: 0, value: { x: 960, y: 540 } }, { time: 2, value: { x: 1200, y: 540 }, interpolation: 'bezier' }] },
        features: ['premiere.effects_transitions.keyframes', 'premiere.effects_transitions.toggle_animation', 'premiere.effects_transitions.keyframe_interpolation', 'premiere.editing.pen_tool_timeline'],
        handler: (a) => {
            if (!Array.isArray(a.keyframes) || !a.keyframes.length) throw new Error("'keyframes' must list at least one keyframe");
            const keys = a.keyframes.map((k, i) => {
                if (!k || typeof k !== 'object') throw new Error(`keyframes[${i}] must be { time, value }`);
                const out = `{ t: ${seconds(k.time, `keyframes[${i}].time`)}, v: ${paramValue(k.value, `keyframes[${i}].value`)}`;
                const mode = k.interpolation === undefined ? null : enumOf(String(k.interpolation).toUpperCase(), INTERPOLATION, { name: `keyframes[${i}].interpolation` });
                return `${out}${mode ? `, mode: __C.InterpolationMode.${mode}` : ''} }`;
            });
            return run('Add keyframes', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipSpec(a.clip)});
${targetLines(a)}
const param = targets[0].param;
if (!(await param.areKeyframesSupported())) throw new Error(param.displayName + " cannot be animated");
const keys = [${keys.join(', ')}];
transact(project, "Keyframes for " + param.displayName, (add) => {
  if (!param.isTimeVarying()) add(param.createSetTimeVaryingAction(true));
  for (const k of keys) {
    const kf = param.createKeyframe(__paramValue(k.v));
    kf.position = __t(k.t);
    add(param.createAddKeyframeAction(kf));
  }
});
const eased = keys.filter((k) => k.mode !== undefined);
if (eased.length) transact(project, "Keyframe interpolation", (add) => { for (const k of eased) add(param.createSetInterpolationAtKeyframeAction(__t(k.t), k.mode, true)); });
return { param: param.displayName, keyframes: (param.getKeyframeListAsTickTimes() || []).map(__s) };`));
        },
    },
    {
        name: 'remove_keyframes',
        description: 'Remove keyframes from an effect parameter on a clip: at given times, in a time range, or all of them (turns animation off, keeping the value at the start). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clip: CLIP_SCHEMA,
                ...COMPONENT_PROPS,
                times: { type: 'array', items: { type: 'number', minimum: 0 }, maxItems: 500, description: 'Keyframe times, seconds' },
                from: { type: 'number', minimum: 0, description: 'Range start, seconds (with to)' },
                to: { type: 'number', minimum: 0, description: 'Range end, seconds (with from)' },
                all: { type: 'boolean', default: false },
            },
            required: ['clip', 'component'],
        },
        auditArgs: { clip: { track: 'video', trackIndex: 0, clipIndex: 0 }, component: 1, param: 'Scale', paramIndex: undefined, times: [1, 2], from: 3, to: 5, all: false },
        hints: { destructive: true },
        features: ['premiere.effects_transitions.delete_keyframes', 'premiere.effects_transitions.toggle_animation'],
        handler: (a) => {
            const times = (a.times ?? []).map((t, i) => seconds(t, `times[${i}]`));
            if ((a.from === undefined) !== (a.to === undefined)) throw new Error('Give from and to together');
            const range = a.from === undefined ? null : [seconds(a.from, 'from'), seconds(a.to, 'to')];
            if (range && Number(range[1]) <= Number(range[0])) throw new Error("'to' must be after 'from'");
            if (!a.all && !times.length && !range) throw new Error('Choose the keyframes: times, from and to, or all: true');
            if (a.all && (times.length || range)) throw new Error('all cannot be combined with times or a range');
            return run('Remove keyframes', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipSpec(a.clip)});
${targetLines(a)}
const param = targets[0].param;
if (!param.isTimeVarying()) throw new Error(param.displayName + " has no keyframes");
transact(project, "Remove keyframes", (add) => {
  ${a.all ? 'add(param.createSetTimeVaryingAction(false));' : ''}
  for (const t of ${json(times.map(Number))}) add(param.createRemoveKeyframeAction(__t(t), true));
  ${range ? `add(param.createRemoveKeyframeRangeAction(__t(${range[0]}), __t(${range[1]}), true));` : ''}
});
return { param: param.displayName, keyframes: param.isTimeVarying() ? (param.getKeyframeListAsTickTimes() || []).map(__s) : [] };`));
        },
    },
    {
        name: 'add_transition',
        description: 'Add a video transition (by match name, from list_available_effects) at the start, end or both ends of video clips, with a duration and optionally single-sided. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                transition: { type: 'string', description: 'Transition match name' },
                at: { type: 'string', enum: ['start', 'end', 'both'], description: 'Default end', default: 'end' },
                duration: { type: 'number', minimum: 0.01, maximum: 600, description: 'Seconds. Default 1', default: 1 },
                singleSided: { type: 'boolean', description: 'Keep the transition on this clip only. Default false', default: false },
            },
            required: ['clips', 'transition'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 1 }] }, transition: 'AE.ADBE Cross Dissolve New', at: 'both' },
        features: ['premiere.effects_transitions.apply_video_transition', 'premiere.effects_transitions.transitions_overview', 'premiere.effects_transitions.transition_duration', 'premiere.effects_transitions.single_sided_transitions', ...TRANSITION_FEATURES, 'premiere.ai_features.morph_cut_ai'],
        handler: (a) => {
            if (typeof a.transition !== 'string' || !a.transition.trim()) throw new Error("'transition' is empty");
            const at = enumOf(a.at ?? 'end', ['start', 'end', 'both'], { name: 'at' });
            const ends = at === 'both' ? [true, false] : [at === 'start'];
            const duration = num(a.duration ?? 1, { min: 0.01, max: 600, name: 'duration' });
            return run('Add transition', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
for (const c of clips) if (!__isVideo(c)) throw new Error((await c.getName()) + " is an audio clip: Premiere Pro's UXP API adds video transitions only");
const names = await ppro.TransitionFactory.getVideoTransitionMatchNames();
if (!names.includes(${str(a.transition)})) throw new Error("No video transition with match name " + ${str(a.transition)} + " (list_available_effects lists them)");
transact(project, "Add transition", (add) => {
  for (const c of clips) {
    for (const atStart of ${json(ends)}) {
      const options = new ppro.AddTransitionOptions();
      options.setApplyToStart(atStart);
      options.setDuration(__t(${duration}));
      options.setForceSingleSided(${bool(a.singleSided)});
      add(c.createAddVideoTransitionAction(ppro.TransitionFactory.createVideoTransition(${str(a.transition)}), options));
    }
  }
});
return { transition: ${str(a.transition)}, at: ${str(at)}, duration: ${duration}, clips: clips.length };`));
        },
    },
    {
        name: 'remove_transition',
        description: 'Remove the video transition at the start, end or both ends of video clips. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                at: { type: 'string', enum: ['start', 'end', 'both'], description: 'Default both', default: 'both' },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 1 }] } },
        hints: { destructive: true },
        features: ['premiere.effects_transitions.transitions_overview'],
        handler: (a) => {
            const at = enumOf(a.at ?? 'both', ['start', 'end', 'both'], { name: 'at' });
            const ends = at === 'both' ? ['START', 'END'] : [at.toUpperCase()];
            return run('Remove transition', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = (await __clips(seq, ${clipsSpec(a.clips)})).filter(__isVideo);
if (!clips.length) throw new Error("No video clips: transitions are removed from video clips");
transact(project, "Remove transition", (add) => {
  for (const c of clips) {
    ${ends.map((e) => `add(c.createRemoveVideoTransitionAction(__C.TransitionPosition.${e}));`).join('\n    ')}
  }
});
return { at: ${str(at)}, clips: clips.length };`));
        },
    },
];

/** Audio clip levels: the built-in Volume effect's Level. */
export const audioTools = [
    {
        name: 'set_clip_volume',
        description: 'Set the Level of audio clips\' built-in Volume effect. Premiere Pro stores Level as a linear amplitude, not decibels; read the current value with list_clip_effects first and scale it. Turns off Level keyframes. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                level: { type: 'number', minimum: 0, maximum: 1000, description: 'The Level parameter\'s value (linear amplitude)' },
            },
            required: ['clips', 'level'],
        },
        auditArgs: { clips: { items: [{ track: 'audio', trackIndex: 0, clipIndex: 0 }] }, level: 0.5 },
        hints: { idempotent: true },
        features: ['premiere.audio.clip_volume', 'premiere.audio.audio_clip'],
        handler: (a) => {
            const level = num(a.level, { min: 0, max: 1000, name: 'level' });
            return run('Set clip volume', script(`
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = (await __clips(seq, ${clipsSpec(a.clips)})).filter((c) => !__isVideo(c));
if (!clips.length) throw new Error("No audio clips: give clips on audio tracks");
const targets = [];
for (const clip of clips) {
  const chain = await __chain(clip);
  let volume = null;
  for (let i = 0; i < chain.getComponentCount() && !volume; i++) {
    const c = chain.getComponentAtIndex(i);
    if ((await c.getDisplayName()) === "Volume") volume = c;
  }
  if (!volume) throw new Error((await clip.getName()) + " has no Volume effect (list_clip_effects shows its components; set_effect_param can set any of them)");
  targets.push({ clip: clip, param: __param(volume, { param: "Level" }) });
}
transact(project, "Clip volume", (add) => {
  for (const t of targets) {
    if (t.param.isTimeVarying()) add(t.param.createSetTimeVaryingAction(false));
    add(t.param.createSetValueAction(t.param.createKeyframe(${level}), true));
  }
});
const out = [];
for (const t of targets) out.push({ clip: await t.clip.getName(), level: __value(await t.param.getStartValue()) });
return { set: out };`));
        },
    },
];
