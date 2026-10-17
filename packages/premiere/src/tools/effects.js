/**
 * Effects and transitions: what is installed, what a clip has, applying and
 * removing effects, setting parameters and keyframes, Motion and Opacity,
 * copying effects between clips, source clip effects, adding, replacing and
 * removing video transitions, and audio clips' volume and pan.
 *
 * A clip's effects are its component chain (Effect Controls): fixed effects
 * first (Motion, Opacity, Time Remapping for video; Volume, Channel Volume,
 * Panner for audio), then applied ones. Components and parameters are chosen
 * by index or name as list_clip_effects reports them.
 */
import { bool, json, str, enumOf, index, num } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, CLIP_SCHEMA, CLIPS_SCHEMA, ITEM_SCHEMA, PARAM_VALUE_SCHEMA, sequenceSpec, clipSpec, clipsSpec, itemSpec, paramValue, seconds } from '../args.js';
import { VIDEO_EFFECT_FEATURES, AUDIO_EFFECT_FEATURES, TRANSITION_FEATURES } from '../features.js';
import { FX_HELPERS } from '../fx.js';

const INTERPOLATION = ['LINEAR', 'BEZIER', 'HOLD', 'TIME'];

/** The Opacity effect's Blend Mode menu, in menu order; a mode's index here is the value set_clip_transform writes. */
export const BLEND_MODES = [
    'normal', 'dissolve', 'darken', 'multiply', 'color_burn', 'linear_burn', 'darker_color', 'lighten', 'screen',
    'color_dodge', 'linear_dodge', 'lighter_color', 'overlay', 'soft_light', 'hard_light', 'vivid_light', 'linear_light',
    'pin_light', 'hard_mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity',
];

/** set_clip_transform's motion settings and the Motion (and Vector Motion) parameters they set, by display name. */
const MOTION_PARAMS = {
    position: 'Position', scale: 'Scale', scaleWidth: 'Scale Width', uniformScale: 'Uniform Scale',
    rotation: 'Rotation', anchorPoint: 'Anchor Point', antiFlicker: 'Anti-flicker Filter',
};

/** The fixed effects every clip has, by display name; copy_clip_effects pastes their values instead of adding them. */
const VIDEO_FIXED = ['Motion', 'Opacity', 'Time Remapping', 'Vector Motion'];
const AUDIO_FIXED = ['Volume', 'Channel Volume', 'Panner'];

export const COMPONENT_PROPS = {
    component: { type: 'integer', minimum: 0, description: 'Component index from list_clip_effects' },
    param: { type: 'string', description: 'Parameter name as list_clip_effects reports it, e.g. "Scale"' },
    paramIndex: { type: 'integer', minimum: 0, description: 'Parameter index instead of a name' },
};

/** The parameter a call names (param or paramIndex) as a literal spec for __param(). */
export function paramSpec(a) {
    if ((a.param === undefined) === (a.paramIndex === undefined)) throw new Error('Choose the parameter: param (name) or paramIndex');
    return a.param !== undefined ? json({ param: String(a.param) }) : json({ paramIndex: Number(index(a.paramIndex, { name: 'paramIndex', max: 999 })) });
}

/** Script lines that find `param` on each clip: [{ clip, param }] in `targets`. */
export function targetLines(a) {
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
        description: 'Add a video transition (by match name, from list_available_effects) at the start, end or both ends of video clips, with a duration and optionally single-sided, or replace the transition already there. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                transition: { type: 'string', description: 'Transition match name' },
                at: { type: 'string', enum: ['start', 'end', 'both'], description: 'Default end', default: 'end' },
                duration: { type: 'number', minimum: 0.01, maximum: 600, description: 'Seconds. Default 1', default: 1 },
                singleSided: { type: 'boolean', description: 'Keep the transition on this clip only. Default false', default: false },
                replace: { type: 'boolean', description: 'Remove the transition already at that end first (Replace transition); there must be one. Default false', default: false },
            },
            required: ['clips', 'transition'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 1 }] }, transition: 'AE.ADBE Cross Dissolve New', at: 'both', replace: true },
        features: ['premiere.effects_transitions.apply_video_transition', 'premiere.effects_transitions.transitions_overview', 'premiere.effects_transitions.transition_duration', 'premiere.effects_transitions.single_sided_transitions', 'premiere.effects_transitions.replace_transitions', ...TRANSITION_FEATURES],
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
transact(project, ${a.replace ? '"Replace transition"' : '"Add transition"'}, (add) => {
  for (const c of clips) {
    for (const atStart of ${json(ends)}) {
      ${a.replace ? 'add(c.createRemoveVideoTransitionAction(atStart ? __C.TransitionPosition.START : __C.TransitionPosition.END));\n      ' : ''}const options = new ppro.AddTransitionOptions();
      options.setApplyToStart(atStart);
      options.setDuration(__t(${duration}));
      options.setForceSingleSided(${bool(a.singleSided)});
      add(c.createAddVideoTransitionAction(ppro.TransitionFactory.createVideoTransition(${str(a.transition)}), options));
    }
  }
});
return { transition: ${str(a.transition)}, at: ${str(at)}, duration: ${duration}, clips: clips.length${a.replace ? ', replaced: true' : ''} };`));
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
    {
        name: 'set_clip_transform',
        description: 'Set video clips\' built-in Motion (or Vector Motion, for graphics) and Opacity settings (Effect Controls): position, scale, rotation, anchor point, anti-flicker, opacity and blend mode, for placing and compositing clips over the tracks below. Values are in the units list_clip_effects reports. An animated setting is refused unless clearKeyframes is true. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                motion: {
                    type: 'object',
                    description: 'Motion settings (Vector Motion with vectorMotion: true)',
                    properties: {
                        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], description: 'Position { x, y }' },
                        scale: { type: 'number', description: 'Scale (Scale Height when uniform scale is off)' },
                        scaleWidth: { type: 'number', description: 'Scale Width (used when uniform scale is off)' },
                        uniformScale: { type: 'boolean', description: 'Uniform Scale' },
                        rotation: { type: 'number', description: 'Rotation, degrees' },
                        anchorPoint: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], description: 'Anchor Point { x, y }' },
                        antiFlicker: { type: 'number', description: 'Anti-flicker Filter' },
                    },
                },
                vectorMotion: { type: 'boolean', description: 'Set the Vector Motion effect of graphics clips instead of Motion. Default false', default: false },
                opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Opacity, percent' },
                blendMode: { type: 'string', enum: BLEND_MODES, description: 'Blend Mode, by its name in the Opacity menu' },
                blendModeIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Blend Mode as the index Premiere Pro stores, instead of blendMode' },
                clearKeyframes: { type: 'boolean', description: 'Turn animation off for the settings given (removes their keyframes). Default false', default: false },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 1, clipIndex: 0 }] }, motion: { position: { x: 0.25, y: 0.25 }, scale: 50, rotation: 15 }, opacity: 80, blendMode: 'screen', blendModeIndex: undefined, clearKeyframes: true },
        hints: { idempotent: true },
        features: ['premiere.effects_transitions.intrinsic_motion', 'premiere.effects_transitions.intrinsic_opacity', 'premiere.effects_transitions.blend_modes', 'premiere.effects_transitions.vector_motion', 'premiere.effects_transitions.compositing'],
        handler: (a) => {
            const motionName = a.vectorMotion ? 'Vector Motion' : 'Motion';
            const settings = [];
            const motion = a.motion ?? {};
            if (typeof motion !== 'object' || Array.isArray(motion)) throw new Error("'motion' must be an object");
            for (const [key, value] of Object.entries(motion)) {
                if (value === undefined) continue;
                const name = MOTION_PARAMS[key];
                if (!name) throw new Error(`Unknown motion setting '${key}': use ${Object.keys(MOTION_PARAMS).join(', ')}`);
                if ((key === 'position' || key === 'anchorPoint') && (typeof value !== 'object' || !('x' in value))) throw new Error(`'motion.${key}' must be { x, y }`);
                if (key === 'uniformScale' && typeof value !== 'boolean') throw new Error("'motion.uniformScale' must be true or false");
                if (!['position', 'anchorPoint', 'uniformScale'].includes(key) && typeof value !== 'number') throw new Error(`'motion.${key}' must be a number`);
                settings.push(`{ component: ${str(motionName)}, name: ${str(name)}, v: ${paramValue(value, `motion.${key}`)} }`);
            }
            if (a.opacity !== undefined) settings.push(`{ component: "Opacity", name: "Opacity", v: ${num(a.opacity, { min: 0, max: 100, name: 'opacity' })} }`);
            if (a.blendMode !== undefined && a.blendModeIndex !== undefined) throw new Error('Give blendMode or blendModeIndex, not both');
            const blend = a.blendMode !== undefined ? BLEND_MODES.indexOf(enumOf(a.blendMode, BLEND_MODES, { name: 'blendMode' })) : a.blendModeIndex !== undefined ? Number(index(a.blendModeIndex, { name: 'blendModeIndex', max: 99 })) : null;
            if (blend !== null) settings.push(`{ component: "Opacity", name: "Blend Mode", v: ${blend} }`);
            if (!settings.length) throw new Error('Nothing to change: give motion, opacity, blendMode or blendModeIndex');
            return run('Set clip transform', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const settings = [${settings.join(', ')}];
const targets = [];
for (const clip of clips) {
  const clipName = await clip.getName();
  if (!__isVideo(clip)) throw new Error(clipName + " is an audio clip: Motion and Opacity are video effects");
  const chain = await __chain(clip);
  for (const s of settings) {
    const found = await __fxFind(chain, [s.component]);
    if (!found) throw new Error(clipName + " has no " + s.component + " effect (list_clip_effects shows its components)");
    const param = __fxParam(found.component, s.name);
    if (!param) throw new Error(s.component + " on " + clipName + " has no " + s.name + " parameter; it has: " + __fxParams(found.component).map((e) => e.name).join(", "));
    if (param.isTimeVarying() && !${bool(a.clearKeyframes)}) throw new Error(s.component + " > " + s.name + " is animated on " + clipName + ": use add_keyframes, or pass clearKeyframes: true");
    targets.push({ clip: clip, clipName: clipName, setting: s.component + " > " + s.name, param: param, v: s.v });
  }
}
transact(project, "Motion and opacity", (add) => {
  for (const t of targets) {
    const kf = t.param.createKeyframe(__paramValue(t.v));
    if (t.param.isTimeVarying()) add(t.param.createSetTimeVaryingAction(false));
    add(t.param.createSetValueAction(kf, true));
  }
});
const out = [];
for (const t of targets) out.push({ clip: t.clipName, setting: t.setting, value: __value(await t.param.getStartValue()) });
return { set: out };`));
        },
    },
    {
        name: 'copy_clip_effects',
        description: 'Copy a clip\'s effects to other clips of the same kind (Edit > Copy, then Paste Attributes): applied effects are added to each target with the source\'s values and keyframes; with intrinsic: true, Motion, Opacity, Time Remapping (video) or Volume, Channel Volume, Panner (audio) values are copied onto the targets\' own. Keyframes keep their offset from the clip\'s In point. Up to three undo steps: adding effects, values, keyframe interpolation',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                from: { ...CLIP_SCHEMA, description: 'The clip to copy from, as list_clips reports it' },
                to: { ...CLIPS_SCHEMA, description: 'The clips to paste onto' },
                components: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 100, description: 'Only these component indexes of the source (from list_clip_effects). Default: every applied effect, plus the fixed ones with intrinsic' },
                intrinsic: { type: 'boolean', description: 'Also copy the fixed effects\' values when components is not given. Default false', default: false },
                keyframes: { type: 'boolean', description: 'Copy keyframes of animated parameters (otherwise their value at the clip start). Default true', default: true },
            },
            required: ['from', 'to'],
        },
        auditArgs: { from: { track: 'video', trackIndex: 0, clipIndex: 0 }, to: { items: [{ track: 'video', trackIndex: 0, clipIndex: 1 }] }, components: undefined, intrinsic: true },
        features: ['premiere.effects_transitions.copy_paste_effects', 'premiere.effects_transitions.copy_paste_keyframes'],
        handler: (a) => {
            const pick = a.components === undefined ? null : (Array.isArray(a.components) ? a.components : [a.components]).map((c, i) => Number(index(c, { name: `components[${i}]`, max: 999 })));
            if (pick && !pick.length) throw new Error("'components' is empty: omit it to copy every applied effect");
            const keyframes = a.keyframes === undefined ? true : a.keyframes;
            return run('Copy clip effects', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const [source] = await __clips(seq, ${clipSpec(a.from, 'from')});
const targets = await __clips(seq, ${clipsSpec(a.to)});
const isVideo = __isVideo(source);
const sourceTimes = await __clipTimes(source);
const sourceChain = await __chain(source);
const fixedNames = isVideo ? ${json(VIDEO_FIXED)} : ${json(AUDIO_FIXED)};
const pick = ${json(pick)};
const copied = [];
for (let i = 0; i < sourceChain.getComponentCount(); i++) {
  if (pick !== null && !pick.includes(i)) continue;
  const c = sourceChain.getComponentAtIndex(i);
  const displayName = await c.getDisplayName();
  const fixed = fixedNames.includes(displayName);
  if (pick === null && fixed && !${bool(a.intrinsic)}) continue;
  const params = [];
  for (const e of __fxParams(c)) {
    let start = null;
    try { start = __value(await e.param.getStartValue()); } catch (err) {}
    params.push({ index: e.index, name: e.name, start: start, keys: ${bool(keyframes)} ? await __kfRead(e.param) : [] });
  }
  copied.push({ index: i, displayName: displayName, matchName: await c.getMatchName(), fixed: fixed, params: params });
}
for (const i of pick || []) if (!copied.some((c) => c.index === i)) throw new Error("The source clip has no component " + i + " (list_clip_effects shows them)");
if (!copied.length) throw new Error("The source clip has no applied effects to copy (pass intrinsic: true to copy the fixed effects' values)");
const plans = [];
for (const clip of targets) {
  const clipName = await clip.getName();
  if (__isVideo(clip) !== isVideo) throw new Error(clipName + " is " + (isVideo ? "an audio" : "a video") + " clip; the source is " + (isVideo ? "video" : "audio"));
  const chain = await __chain(clip);
  const plan = { clip: clip, clipName: clipName, before: chain.getComponentCount(), times: await __clipTimes(clip), fixed: [], created: [] };
  for (const c of copied) {
    if (c.fixed) {
      const found = await __fxFind(chain, [c.displayName]);
      if (!found) throw new Error(clipName + " has no " + c.displayName + " effect to paste onto");
      plan.fixed.push({ copy: c, index: found.index });
    } else {
      const component = isVideo ? await ppro.VideoFilterFactory.createComponent(c.matchName) : await ppro.AudioFilterFactory.createComponentByDisplayName(c.displayName, clip);
      if (!component) throw new Error("Premiere Pro could not create " + c.displayName + " for " + clipName);
      plan.created.push({ copy: c, component: component });
    }
  }
  plan.chain = chain;
  plans.push(plan);
}
transact(project, "Paste effects", (add) => {
  for (const p of plans) for (const n of p.created) add(p.chain.createAppendComponentAction(n.component));
});
const sets = [];
for (const p of plans) {
  const chain = await __chain(p.clip);
  const pairs = p.fixed.map((f) => ({ copy: f.copy, component: chain.getComponentAtIndex(f.index) }));
  p.created.forEach((n, k) => pairs.push({ copy: n.copy, component: chain.getComponentAtIndex(p.before + k) }));
  const shift = p.times.inPoint - sourceTimes.inPoint;
  p.skipped = [];
  p.values = 0;
  for (const pair of pairs) {
    for (const sp of pair.copy.params) {
      if (sp.index >= pair.component.getParamCount() || (sp.start === null && !sp.keys.length)) continue;
      sets.push({ plan: p, label: pair.copy.displayName + " > " + sp.name, param: pair.component.getParam(sp.index), start: sp.start, keys: sp.keys.map((k) => ({ t: k.t + shift, v: k.v, mode: k.mode })) });
    }
  }
}
transact(project, "Paste effect values", (add) => {
  for (const s of sets) {
    try {
      if (s.keys.length) __kfAdd(s.param, s.keys, add, true);
      else {
        const kf = s.param.createKeyframe(__paramValue(s.start));
        if (s.param.isTimeVarying()) add(s.param.createSetTimeVaryingAction(false));
        add(s.param.createSetValueAction(kf, true));
      }
      s.plan.values++;
    } catch (e) {
      s.plan.skipped.push(s.label);
    }
  }
});
const eased = sets.filter((s) => s.keys.some((k) => k.mode !== null));
if (eased.length) transact(project, "Paste keyframe interpolation", (add) => { for (const s of eased) __kfModes(s.param, s.keys, add); });
const out = [];
for (const p of plans) out.push({ clip: p.clipName, added: p.created.map((n) => n.copy.displayName), pastedOnto: p.fixed.map((f) => f.copy.displayName), values: p.values, skipped: p.skipped });
return { from: await source.getName(), components: copied.map((c) => c.displayName), pasted: out };`));
        },
    },
    {
        name: 'manage_source_effects',
        description: 'List, apply or remove source clip effects: effects on a clip project item itself (applied in the Source Monitor or Project panel), which every use of the clip in sequences inherits. Video effects only for apply. Applying and removing are one undo step each',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                action: { type: 'string', enum: ['list', 'apply', 'remove'], description: 'Default list', default: 'list' },
                media: { type: 'string', enum: ['video', 'audio'], description: 'Which chain to list or remove from. Default video', default: 'video' },
                effect: { type: 'string', description: 'For apply: video effect match name or display name (from list_available_effects)' },
                component: { type: 'integer', minimum: 0, description: 'For remove: component index from the list' },
            },
            required: ['item'],
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, action: 'apply', effect: 'AE.ADBE Gaussian Blur 2', component: undefined },
        hints: { destructive: true },
        features: ['premiere.effects_transitions.source_clip_effects'],
        handler: (a) => {
            const action = enumOf(a.action ?? 'list', ['list', 'apply', 'remove'], { name: 'action' });
            const media = enumOf(a.media ?? 'video', ['video', 'audio'], { name: 'media' });
            if (action === 'apply' && (typeof a.effect !== 'string' || !a.effect.trim())) throw new Error("apply needs 'effect'");
            if (action === 'apply' && media === 'audio') throw new Error('Premiere Pro\'s UXP API creates audio effects only for clips in a sequence: apply audio effects with apply_effect');
            if (action === 'remove' && a.component === undefined) throw new Error("remove needs 'component' (the index from action: list)");
            const component = action === 'remove' ? index(a.component, { name: 'component', max: 999 }) : null;
            const edit = {
                list: '',
                apply: `const effect = ${str(a.effect ?? '')};
const matchNames = await ppro.VideoFilterFactory.getMatchNames();
const displayNames = await ppro.VideoFilterFactory.getDisplayNames();
let matchName = null;
if (matchNames.includes(effect)) matchName = effect;
else if (matchNames.length === displayNames.length && displayNames.includes(effect)) matchName = matchNames[displayNames.indexOf(effect)];
else throw new Error("No video effect named " + effect + " (list_available_effects lists them)");
const created = await ppro.VideoFilterFactory.createComponent(matchName);
if (!created) throw new Error("Premiere Pro could not create " + effect);
const before = chain.getComponentCount();
transact(project, "Apply source effect", (add) => add(chain.createAppendComponentAction(created)));
chain = await __sourceChain();
if (chain.getComponentCount() <= before) throw new Error("Premiere Pro accepted the change but " + entry.path + "'s source effects did not change");
changed = { applied: effect };`,
                remove: `const target = __component(chain, ${component});
const removed = await target.getDisplayName();
transact(project, "Remove source effect", (add) => add(chain.createRemoveComponentAction(target)));
chain = await __sourceChain();
changed = { removed: removed };`,
            }[action];
            return run('Source clip effects', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
const __sourceChain = async () => {
  const c = await clip.getComponentChain(__C.MediaType.${media.toUpperCase()});
  if (!c) throw new Error(entry.path + " has no ${media} effects chain");
  return c;
};
let chain = await __sourceChain();
let changed = null;
${edit}
const components = [];
for (let i = 0; i < chain.getComponentCount(); i++) components.push(await __componentInfo(chain.getComponentAtIndex(i), i));
return { item: entry.path, media: ${str(media)}, changed: changed, components: components };`));
        },
    },
];

/** Audio clips: the built-in Volume effect's Level and the Panner. */
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
    {
        name: 'adjust_clip_audio',
        description: 'Change audio clips\' volume by a number of decibels (Clip > Audio Options > Increase or Decrease Clip Volume; the Audio Clip Mixer\'s and Properties panel\'s volume), scaling every Level keyframe when the volume is animated, and set their pan or balance (the Panner\'s Balance, or Pan). Volume and pan are one undo step, keyframe interpolation a second',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                gainDb: { type: 'number', minimum: -96, maximum: 96, description: 'Raise (positive) or lower (negative) the Volume Level by this many dB' },
                pan: { type: 'number', minimum: -100, maximum: 100, description: 'Panner Balance (stereo clips) or Pan (mono): -100 full left, 0 centre, 100 full right, as Effect Controls shows it' },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'audio', trackIndex: 0, clipIndex: 0 }] }, gainDb: 3, pan: -25 },
        features: ['premiere.audio.increase_clip_volume', 'premiere.audio.audio_clip_mixer', 'premiere.audio.pan_balance', 'premiere.audio.properties_panel_audio', 'premiere.audio.clip_volume'],
        handler: (a) => {
            if (a.gainDb === undefined && a.pan === undefined) throw new Error('Nothing to change: give gainDb or pan');
            const factor = a.gainDb === undefined ? null : 10 ** (Number(num(a.gainDb, { min: -96, max: 96, name: 'gainDb' })) / 20);
            const pan = a.pan === undefined ? null : num(a.pan, { min: -100, max: 100, name: 'pan' });
            return run('Adjust clip audio', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = (await __clips(seq, ${clipsSpec(a.clips)})).filter((c) => !__isVideo(c));
if (!clips.length) throw new Error("No audio clips: give clips on audio tracks");
const factor = ${factor === null ? 'null' : json(factor)};
const pan = ${pan === null ? 'null' : pan};
const targets = [];
for (const clip of clips) {
  const clipName = await clip.getName();
  const chain = await __chain(clip);
  const t = { clip: clip, clipName: clipName, level: null, keys: [], start: null, panParam: null };
  if (factor !== null) {
    const volume = await __fxFind(chain, ["Volume"]);
    t.level = volume ? __fxParam(volume.component, "Level") : null;
    if (!t.level) throw new Error(clipName + " has no Volume > Level (list_clip_effects shows its components)");
    t.keys = (await __kfRead(t.level)).map((k) => ({ t: k.t, v: k.v * factor, mode: k.mode }));
    t.start = __value(await t.level.getStartValue());
  }
  if (pan !== null) {
    const panner = await __fxFind(chain, ["Panner"]);
    t.panParam = panner ? (__fxParam(panner.component, "Balance") || __fxParam(panner.component, "Pan")) : null;
    if (!t.panParam) throw new Error(clipName + " has no Panner > Balance or Pan (list_clip_effects shows its components)");
    if (t.panParam.isTimeVarying()) throw new Error(t.panParam.displayName + " is animated on " + clipName + ": use add_keyframes");
  }
  targets.push(t);
}
transact(project, "Adjust clip audio", (add) => {
  for (const t of targets) {
    if (t.level && t.keys.length) __kfAdd(t.level, t.keys, add, true);
    else if (t.level) add(t.level.createSetValueAction(t.level.createKeyframe(t.start * factor), true));
    if (t.panParam) add(t.panParam.createSetValueAction(t.panParam.createKeyframe(pan), true));
  }
});
const eased = targets.filter((t) => t.keys.some((k) => k.mode !== null));
if (eased.length) transact(project, "Volume keyframe interpolation", (add) => { for (const t of eased) __kfModes(t.level, t.keys, add); });
const out = [];
for (const t of targets) {
  const r = { clip: t.clipName };
  if (t.level) { r.level = __value(await t.level.getStartValue()); r.levelKeyframes = t.keys.length; }
  if (t.panParam) { r.pan = __value(await t.panParam.getStartValue()); r.panParam = t.panParam.displayName; }
  out.push(r);
}
return { gainDb: ${a.gainDb === undefined ? 'null' : json(Number(a.gainDb))}, adjusted: out };`));
        },
    },
];
