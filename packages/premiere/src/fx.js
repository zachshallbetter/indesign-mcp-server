/**
 * Script helpers shared by the tools that work on effect parameters by name
 * and copy or move keyframes (effects, keyframes, colour and audio tools).
 * Prepend FX_HELPERS to a tool body; it uses the shared helpers in script.js.
 *
 * Keyframe times are what ComponentParam reports (Keyframe.position). Where a
 * tool relates them to a clip's place in the sequence it assumes they are in
 * the clip's source time, as in ExtendScript: the clip's In point is its first
 * frame. Adobe's UXP reference does not say.
 */

export const FX_HELPERS = String.raw`
// A component on the chain by display name or match name: { component, index, displayName, matchName } or null.
async function __fxFind(chain, names) {
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const c = chain.getComponentAtIndex(i);
    const displayName = await c.getDisplayName();
    const matchName = await c.getMatchName();
    if (names.includes(displayName) || names.includes(matchName)) return { component: c, index: i, displayName: displayName, matchName: matchName };
  }
  return null;
}

// Every parameter of a component: [{ param, index, name }].
function __fxParams(component) {
  const out = [];
  for (let i = 0; i < component.getParamCount(); i++) {
    const p = component.getParam(i);
    out.push({ param: p, index: i, name: p.displayName });
  }
  return out;
}

// A parameter by display name (exact, then ignoring case), or null.
function __fxParam(component, name) {
  const all = __fxParams(component);
  const hit = all.find((e) => e.name === name) || all.find((e) => String(e.name).toLowerCase() === String(name).toLowerCase());
  return hit ? hit.param : null;
}

// A clip's times in seconds.
async function __clipTimes(clip) {
  return { start: __s(await clip.getStartTime()), end: __s(await clip.getEndTime()), inPoint: __s(await clip.getInPoint()), outPoint: __s(await clip.getOutPoint()) };
}

// A parameter's keyframes: [{ t, v, mode }] (seconds, plain value, interpolation or null). [] when not animated.
async function __kfRead(param) {
  const out = [];
  if (!param.isTimeVarying()) return out;
  for (const time of (param.getKeyframeListAsTickTimes() || [])) {
    const kf = await param.getKeyframePtr(time);
    let mode = null;
    try { mode = await kf.getTemporalInterpolationMode(); } catch (e) {}
    out.push({ t: __s(time), v: __value(kf.value), mode: mode });
  }
  return out;
}

// Inside transact's build: add keyframes [{ t, v }], turning animation on if needed. With replace, the
// parameter's keyframes are cleared first (animation off, then on). Every keyframe is made before any
// action is added, so a value the parameter refuses throws before anything changes.
function __kfAdd(param, keys, add, replace) {
  const made = keys.map((k) => {
    const kf = param.createKeyframe(__paramValue(k.v));
    kf.position = __t(k.t);
    return kf;
  });
  if (replace && param.isTimeVarying()) add(param.createSetTimeVaryingAction(false));
  if (replace || !param.isTimeVarying()) add(param.createSetTimeVaryingAction(true));
  for (const kf of made) add(param.createAddKeyframeAction(kf));
}

// Inside transact's build: set the interpolation of keyframes [{ t, mode }] that have one.
function __kfModes(param, keys, add) {
  for (const k of keys) if (k.mode !== null && k.mode !== undefined) add(param.createSetInterpolationAtKeyframeAction(__t(k.t), k.mode, true));
}
`;
