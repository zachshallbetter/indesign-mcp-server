/**
 * Colour: Lumetri Color settings on clips (the Lumetri Color panel acts on a
 * Lumetri Color effect, whose settings are its parameters) and a clip's Input
 * LUT override.
 *
 * Lumetri parameters are found by display name within a section of the panel
 * (Basic Correction, Creative, Curves, Color Wheels & Match, HSL Secondary,
 * Vignette). Several names repeat across sections (Saturation, Temperature,
 * Tint, Contrast, Sharpen), so the section is taken from the group parameters
 * that head each one when Premiere Pro lists them; byIndex sets any parameter
 * by the index list_clip_effects reports.
 */
import { bool, json, index } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, CLIPS_SCHEMA, ITEM_SCHEMA, PARAM_VALUE_SCHEMA, sequenceSpec, clipsSpec, itemSpec, itemSpecs, paramValue } from '../args.js';
import { FX_HELPERS } from '../fx.js';

/** The Lumetri Color panel's sections: the key a call uses, the section's heading, and the settings it shows. */
export const LUMETRI_SECTIONS = {
    basic: { header: 'Basic Correction', names: 'Input LUT, HDR White, Temperature, Tint, Saturation, Exposure, Contrast, Highlights, Shadows, Whites, Blacks' },
    creative: { header: 'Creative', names: 'Look, Intensity, Faded Film, Sharpen, Vibrance, Saturation, Shadow Tint, Highlight Tint, Tint Balance' },
    wheels: { header: 'Color Wheels & Match', names: 'the shadow, midtone and highlight wheels and their lightness' },
    hsl: { header: 'HSL Secondary', names: 'Denoise, Blur, Temperature, Tint, Contrast, Sharpen, Saturation' },
    vignette: { header: 'Vignette', names: 'Amount, Midpoint, Roundness, Feather' },
};
const HEADERS = { ...Object.fromEntries(Object.entries(LUMETRI_SECTIONS).map(([k, v]) => [v.header, k])), Curves: 'curves' };

const sectionSchema = (key) => ({
    type: 'object',
    description: `${LUMETRI_SECTIONS[key].header}: settings by display name, e.g. ${LUMETRI_SECTIONS[key].names}`,
    additionalProperties: PARAM_VALUE_SCHEMA,
});

export const tools = [
    {
        name: 'set_lumetri_color',
        description: 'Grade video clips with Lumetri Color (Window > Lumetri Color): set Basic Correction (Input LUT, white balance, tone), Creative (Look, intensity, faded film, vibrance, tints), Color Wheels & Match, HSL Secondary corrections and Vignette settings by their display names, or any Lumetri parameter by index. Adds a Lumetri Color effect to clips that have none. Values as list_clip_effects reports them. One undo step, two when an effect is added',
        inputSchema: {
            type: 'object',
            properties: {
                sequence: SEQUENCE_SCHEMA,
                clips: CLIPS_SCHEMA,
                basic: sectionSchema('basic'),
                creative: sectionSchema('creative'),
                wheels: sectionSchema('wheels'),
                hsl: sectionSchema('hsl'),
                vignette: sectionSchema('vignette'),
                byIndex: {
                    type: 'array',
                    maxItems: 200,
                    description: 'Lumetri parameters by index (from list_clip_effects), for any setting the sections do not name',
                    items: { type: 'object', properties: { paramIndex: { type: 'integer', minimum: 0, description: 'Parameter index' }, value: PARAM_VALUE_SCHEMA }, required: ['paramIndex', 'value'] },
                },
                component: { type: 'integer', minimum: 0, description: 'Index of the Lumetri Color effect to set (from list_clip_effects). Default: the clip\'s first Lumetri Color' },
                add: { type: 'boolean', description: 'Add a Lumetri Color effect to clips without one. Default true', default: true },
                clearKeyframes: { type: 'boolean', description: 'Turn animation off for animated settings given (removes their keyframes). Default false', default: false },
            },
            required: ['clips'],
        },
        auditArgs: { clips: { items: [{ track: 'video', trackIndex: 0, clipIndex: 0 }] }, basic: { Exposure: 0.5, Temperature: -10 }, creative: { 'Faded Film': 20 }, vignette: { Amount: -1.5 }, byIndex: [{ paramIndex: 40, value: 1 }], component: undefined, clearKeyframes: true },
        hints: { idempotent: true },
        features: [
            'premiere.color.lumetri_color_panel', 'premiere.color.basic_correction', 'premiere.color.input_lut', 'premiere.color.creative',
            'premiere.color.looks', 'premiere.color.color_wheels', 'premiere.color.hsl_secondary', 'premiere.color.vignette',
            'premiere.color.lumetri_color_effect', 'premiere.effects_transitions.vignettes',
        ],
        handler: (a) => {
            const settings = [];
            for (const key of Object.keys(LUMETRI_SECTIONS)) {
                const section = a[key];
                if (section === undefined) continue;
                if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error(`'${key}' must be an object of settings by display name`);
                for (const [name, value] of Object.entries(section)) {
                    if (!name.trim()) throw new Error(`'${key}' has an empty setting name`);
                    settings.push({ section: key, header: LUMETRI_SECTIONS[key].header, name, v: JSON.parse(paramValue(value, `${key}.${name}`)) });
                }
            }
            if (a.byIndex !== undefined && !Array.isArray(a.byIndex)) throw new Error("'byIndex' must be a list of { paramIndex, value }");
            const byIndex = (a.byIndex ?? []).map((b, i) => {
                if (!b || typeof b !== 'object') throw new Error(`byIndex[${i}] must be { paramIndex, value }`);
                return { paramIndex: Number(index(b.paramIndex, { name: `byIndex[${i}].paramIndex`, max: 999 })), v: JSON.parse(paramValue(b.value, `byIndex[${i}].value`)) };
            });
            if (!settings.length && !byIndex.length) throw new Error('Nothing to set: give basic, creative, wheels, hsl, vignette or byIndex settings');
            const component = a.component === undefined ? null : index(a.component, { name: 'component', max: 999 });
            const add = a.add === undefined ? true : a.add;
            return run('Set Lumetri Color', script(`${FX_HELPERS}
const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const clips = await __clips(seq, ${clipsSpec(a.clips)});
const settings = ${json(settings)};
const byIndex = ${json(byIndex)};
const headers = ${json(HEADERS)};
const isLumetri = (displayName, matchName) => displayName === "Lumetri Color" || String(matchName).toLowerCase().includes("lumetri");
let lumetriMatch = null;
const plans = [];
for (const clip of clips) {
  const clipName = await clip.getName();
  if (!__isVideo(clip)) throw new Error(clipName + " is an audio clip: Lumetri Color grades video clips");
  const chain = await __chain(clip);
  let at = ${component === null ? 'null' : component};
  if (at !== null) {
    const c = __component(chain, at);
    if (!isLumetri(await c.getDisplayName(), await c.getMatchName())) throw new Error("Component " + at + " on " + clipName + " is " + (await c.getDisplayName()) + ", not Lumetri Color");
  } else {
    for (let i = 0; i < chain.getComponentCount() && at === null; i++) {
      const c = chain.getComponentAtIndex(i);
      if (isLumetri(await c.getDisplayName(), await c.getMatchName())) at = i;
    }
  }
  const plan = { clip: clip, clipName: clipName, chain: chain, at: at, created: null };
  if (at === null) {
    if (!${bool(add)}) throw new Error(clipName + " has no Lumetri Color effect (pass add: true to add one)");
    if (lumetriMatch === null) {
      const matchNames = await ppro.VideoFilterFactory.getMatchNames();
      const displayNames = await ppro.VideoFilterFactory.getDisplayNames();
      const d = displayNames.indexOf("Lumetri Color");
      lumetriMatch = matchNames.length === displayNames.length && d >= 0 ? matchNames[d] : (matchNames.find((m) => m.toLowerCase().includes("lumetri")) || null);
      if (lumetriMatch === null) throw new Error("Premiere Pro lists no Lumetri Color effect (list_available_effects shows the video effects)");
    }
    plan.created = await ppro.VideoFilterFactory.createComponent(lumetriMatch);
    if (!plan.created) throw new Error("Premiere Pro could not create Lumetri Color for " + clipName);
    plan.at = chain.getComponentCount();
  }
  plans.push(plan);
}
const adding = plans.filter((p) => p.created);
if (adding.length) transact(project, "Apply Lumetri Color", (add) => { for (const p of adding) add(p.chain.createAppendComponentAction(p.created)); });
const targets = [];
for (const p of plans) {
  const lumetri = __component(await __chain(p.clip), p.at);
  const params = [];
  let section = null;
  for (const e of __fxParams(lumetri)) {
    if (headers[e.name] !== undefined) section = headers[e.name];
    params.push({ param: e.param, index: e.index, name: String(e.name), section: section });
  }
  for (const s of settings) {
    const wanted = s.name.toLowerCase();
    let hits = params.filter((e) => e.section === s.section && e.name.toLowerCase() === wanted);
    if (!hits.length) {
      hits = params.filter((e) => e.name.toLowerCase() === wanted);
      if (hits.length > 1) throw new Error("Lumetri Color on " + p.clipName + " has " + hits.length + " parameters named " + s.name + " (indexes " + hits.map((e) => e.index).join(", ") + ") and its " + s.header + " section could not be told apart: use byIndex");
    }
    if (!hits.length) {
      const inSection = params.filter((e) => e.section === s.section).map((e) => e.name);
      throw new Error("Lumetri Color on " + p.clipName + " has no " + s.name + " in " + s.header + "; " + (inSection.length ? "that section has: " + inSection.join(", ") : "its parameters are: " + params.map((e) => e.name).join(", ")));
    }
    targets.push({ clipName: p.clipName, setting: s.header + " > " + hits[0].name, paramIndex: hits[0].index, sectionFound: hits[0].section === s.section, param: hits[0].param, v: s.v });
  }
  for (const b of byIndex) {
    if (b.paramIndex >= params.length) throw new Error("Lumetri Color has " + params.length + " parameters; index " + b.paramIndex + " does not exist");
    const e = params[b.paramIndex];
    targets.push({ clipName: p.clipName, setting: "#" + e.index + " " + e.name, paramIndex: e.index, sectionFound: true, param: e.param, v: b.v });
  }
}
for (const t of targets) {
  if (t.param.isTimeVarying() && !${bool(a.clearKeyframes)}) throw new Error(t.setting + " is animated on " + t.clipName + ": use add_keyframes, or pass clearKeyframes: true");
}
transact(project, "Lumetri Color", (add) => {
  for (const t of targets) {
    const kf = t.param.createKeyframe(__paramValue(t.v));
    if (t.param.isTimeVarying()) add(t.param.createSetTimeVaryingAction(false));
    add(t.param.createSetValueAction(kf, true));
  }
});
const out = [];
for (const p of plans) {
  const set = [];
  for (const t of targets.filter((x) => x.clipName === p.clipName)) set.push({ setting: t.setting, paramIndex: t.paramIndex, sectionFound: t.sectionFound, value: __value(await t.param.getStartValue()) });
  out.push({ clip: p.clipName, component: p.at, added: Boolean(p.created), set: set });
}
return { graded: out };`));
        },
    },
    {
        name: 'set_clip_input_lut',
        description: 'Set the Input LUT override of clip project items (Clip > Modify > Input LUT), which converts the footage before any grading: a LUT id, or the override (or embedded LUT) another clip uses. Returns each clip\'s override and embedded LUT ids before and after. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', items: ITEM_SCHEMA, minItems: 1, maxItems: 500, description: 'Video clip project items' },
                lutId: { type: 'string', description: 'The LUT id (a guid, as these results report it)' },
                fromItem: { ...ITEM_SCHEMA, description: 'Use the Input LUT this clip has instead of lutId' },
                embedded: { type: 'boolean', description: 'With fromItem, use the LUT embedded in its media rather than its override. Default false', default: false },
            },
            required: ['items'],
        },
        auditArgs: { items: [{ path: 'Footage/A001.mov' }], lutId: undefined, fromItem: { path: 'Footage/A002.mov' }, embedded: false },
        hints: { idempotent: true },
        features: ['premiere.color.clip_input_lut_override'],
        handler: (a) => {
            if (!Array.isArray(a.items) || !a.items.length) throw new Error("'items' must list at least one clip");
            if ((a.lutId === undefined) === (a.fromItem === undefined)) throw new Error('Give lutId or fromItem');
            if (a.lutId !== undefined && (typeof a.lutId !== 'string' || !a.lutId.trim())) throw new Error("'lutId' is empty");
            const lut = a.lutId !== undefined
                ? json(a.lutId.trim())
                : `await __clipItem(await __item(project, ${itemSpec(a.fromItem, 'fromItem')})).${a.embedded ? 'getEmbeddedLUTID' : 'getInputLUTID'}()`;
            return run('Set clip Input LUT', script(`
const project = await __project();
const entries = await __items(project, ${itemSpecs(a.items)}, false);
const lutId = ${lut};
if (!lutId) throw new Error("The source clip has no ${a.embedded ? 'embedded LUT' : 'Input LUT override'}");
const before = [];
for (const e of entries) {
  const clip = __clipItem(e);
  before.push({ entry: e, clip: clip, inputLUT: await clip.getInputLUTID(), embeddedLUT: await clip.getEmbeddedLUTID() });
}
transact(project, "Input LUT", (add) => { for (const b of before) add(b.clip.createSetInputLUTIDAction(lutId)); });
const out = [];
for (const b of before) out.push({ item: b.entry.path, before: b.inputLUT, inputLUT: await b.clip.getInputLUTID(), embeddedLUT: b.embeddedLUT });
return { lutId: lutId, items: out };`));
        },
    },
];
