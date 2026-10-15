/**
 * Every tool's script runs inside one prelude.
 *
 * Scripts are UXP JavaScript, not ExtendScript: the plugin runs each one as
 * the body of an async function with two names in scope:
 *
 *   ppro      require("premierepro")
 *   transact  transact(project, undoName, build): opens project.lockedAccess,
 *             calls build(add) so every Action is created inside the lock (as
 *             Premiere Pro requires from 26.3), and runs them with
 *             project.executeTransaction as one undo step. Returns how many
 *             actions ran; throws if Premiere Pro refuses the transaction.
 *
 * The script's return value is the tool's result; the plugin makes it JSON-safe.
 * The helpers below find the project, sequences, project items and clips the
 * tools name, and turn Premiere's TickTime, Guid and parameter values into
 * plain values. Times are seconds.
 */

const HELPERS = String.raw`
const __C = ppro.Constants;
const __t = (seconds) => ppro.TickTime.createWithSeconds(seconds);
const __s = (time) => (time && typeof time.seconds === "number" ? Math.round(time.seconds * 1000000) / 1000000 : null);
const __id = (guid) => (guid ? guid.toString() : null);

async function __project() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No project is open in Premiere Pro");
  return project;
}

async function __sequence(project, spec) {
  if (spec.name === undefined && spec.guid === undefined) {
    const active = await project.getActiveSequence();
    if (!active) throw new Error("No active sequence: open one in the Timeline, or pass sequence.name or sequence.guid");
    return active;
  }
  const all = await project.getSequences();
  const hits = all.filter((s) => (spec.guid !== undefined ? __id(s.guid) === spec.guid : s.name === spec.name));
  if (!hits.length) throw new Error(spec.guid !== undefined ? "No sequence with guid " + spec.guid : "No sequence named " + spec.name);
  if (hits.length > 1) throw new Error(hits.length + " sequences are named " + spec.name + ": pass sequence.guid (list_sequences shows it)");
  return hits[0];
}

async function __sequenceInfo(project, seq) {
  const active = await project.getActiveSequence();
  const size = await seq.getFrameSize();
  return {
    name: seq.name, guid: __id(seq.guid), active: Boolean(active) && __id(active.guid) === __id(seq.guid),
    width: size ? size.width : null, height: size ? size.height : null, timebase: await seq.getTimebase(),
    end: __s(await seq.getEndTime()), inPoint: __s(await seq.getInPoint()), outPoint: __s(await seq.getOutPoint()),
    zeroPoint: __s(await seq.getZeroPoint()), playhead: __s(await seq.getPlayerPosition()),
    videoTracks: await seq.getVideoTrackCount(), audioTracks: await seq.getAudioTrackCount(), captionTracks: await seq.getCaptionTrackCount(),
  };
}

// A project item is a bin, a clip or a sequence. FolderItem.cast and
// ClipProjectItem.cast give the typed view; an item that is not a bin cannot
// list children, which is how bins are told apart.
async function __entry(item, path) {
  const entry = { item: item, name: item.name, id: item.getId(), path: path, type: item.type, kind: "item", bin: null, clip: null, children: null };
  let bin = null, clip = null;
  try { bin = ppro.FolderItem.cast(item); } catch (e) {}
  if (bin) {
    try { entry.children = await bin.getItems(); entry.bin = bin; entry.kind = "bin"; return entry; } catch (e) { entry.children = null; }
  }
  try { clip = ppro.ClipProjectItem.cast(item); } catch (e) {}
  if (clip) {
    entry.clip = clip;
    entry.kind = "clip";
    try { if (await clip.isSequence()) entry.kind = "sequence"; } catch (e) {}
  }
  return entry;
}

async function __root(project) {
  return __entry(ppro.ProjectItem.cast(await project.getRootItem()), "");
}

async function __walk(project, under, depth) {
  const out = [];
  const start = under || (await __root(project));
  async function visit(entry, level) {
    for (const child of entry.children || []) {
      const e = await __entry(child, entry.path ? entry.path + "/" + child.name : child.name);
      out.push(e);
      if (e.kind === "bin" && level < depth) await visit(e, level + 1);
    }
  }
  await visit(start, 1);
  return out;
}

async function __item(project, spec) {
  if (spec.path !== undefined) {
    let entry = await __root(project);
    for (const part of String(spec.path).split("/").filter((p) => p.length)) {
      const hits = (entry.children || []).filter((c) => c.name === part);
      if (!hits.length) throw new Error("No project item at " + spec.path + " (" + part + " not found)");
      if (hits.length > 1) throw new Error(hits.length + " items are named " + part + " in that bin: pass item.id");
      entry = await __entry(hits[0], entry.path ? entry.path + "/" + part : part);
    }
    if (!entry.path) throw new Error("item.path is empty");
    return entry;
  }
  if (spec.id === undefined && spec.name === undefined) throw new Error("Choose the project item: id, path or name");
  const all = await __walk(project, null, 100);
  const hits = all.filter((e) => (spec.id !== undefined ? e.id === spec.id : e.name === spec.name));
  if (!hits.length) throw new Error(spec.id !== undefined ? "No project item with id " + spec.id : "No project item named " + spec.name);
  if (hits.length > 1) throw new Error(hits.length + " project items are named " + spec.name + ": pass item.path or item.id (list_project_items shows them)");
  return hits[0];
}

async function __items(project, specs, selected) {
  const out = [];
  if (selected) {
    const selection = await ppro.ProjectUtils.getSelection(project);
    for (const it of (selection ? await selection.getItems() : [])) out.push(await __entry(it, it.name));
  }
  for (const spec of specs) out.push(await __item(project, spec));
  if (!out.length) throw new Error("No project items to act on: pass items, or selected: true");
  return out;
}

async function __bin(project, spec) {
  if (!spec) return __root(project);
  const entry = await __item(project, spec);
  if (entry.kind !== "bin") throw new Error(entry.path + " is not a bin");
  return entry;
}

function __clipItem(entry) {
  if (!entry.clip) throw new Error(entry.path + " is a " + entry.kind + ", not a clip or sequence item");
  return entry.clip;
}

function __itemInfo(entry) {
  return { name: entry.name, id: entry.id, path: entry.path, kind: entry.kind, type: entry.type };
}

async function __track(seq, kind, index) {
  const count = kind === "video" ? await seq.getVideoTrackCount() : kind === "audio" ? await seq.getAudioTrackCount() : await seq.getCaptionTrackCount();
  if (index >= count) throw new Error("The sequence has " + count + " " + kind + " track" + (count === 1 ? "" : "s") + "; index " + index + " does not exist (0 is the first)");
  if (kind === "video") return seq.getVideoTrack(index);
  if (kind === "audio") return seq.getAudioTrack(index);
  return seq.getCaptionTrack(index);
}

async function __trackClips(track) {
  return (await track.getTrackItems(__C.TrackItemType.CLIP, false)) || [];
}

const __isVideo = (clip) => typeof clip.createAddVideoTransitionAction === "function";

async function __clips(seq, spec) {
  const out = [];
  if (spec.selected) {
    const selection = await seq.getSelection();
    for (const c of (selection ? await selection.getTrackItems() : [])) out.push(c);
  }
  for (const c of spec.items || []) {
    const clips = await __trackClips(await __track(seq, c.track, c.trackIndex));
    if (c.clipIndex >= clips.length) throw new Error(c.track + " track " + c.trackIndex + " has " + clips.length + " clip" + (clips.length === 1 ? "" : "s") + "; clip " + c.clipIndex + " does not exist (list_clips shows them)");
    out.push(clips[c.clipIndex]);
  }
  if (!out.length) throw new Error("No clips to act on: pass clips.items, or clips.selected: true");
  return out;
}

async function __clipInfo(clip) {
  const info = {
    name: await clip.getName(), kind: __isVideo(clip) ? "video" : "audio", trackIndex: await clip.getTrackIndex(),
    start: __s(await clip.getStartTime()), end: __s(await clip.getEndTime()), duration: __s(await clip.getDuration()),
    inPoint: __s(await clip.getInPoint()), outPoint: __s(await clip.getOutPoint()),
    disabled: await clip.isDisabled(), selected: await clip.getIsSelected(), speed: await clip.getSpeed(),
  };
  try { info.adjustmentLayer = await clip.isAdjustmentLayer(); } catch (e) {}
  try {
    const item = await clip.getProjectItem();
    info.projectItem = item ? { name: item.name, id: item.getId() } : null;
  } catch (e) { info.projectItem = null; }
  return info;
}

function __newSelection() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) reject(new Error("Premiere Pro did not create a track item selection")); }, 5000);
    const ok = ppro.TrackItemSelection.createEmptySelection((selection) => { settled = true; clearTimeout(timer); resolve(selection); });
    if (ok === false && !settled) { clearTimeout(timer); reject(new Error("Premiere Pro could not create a track item selection")); }
  });
}

async function __selectionOf(clips) {
  const selection = await __newSelection();
  for (const c of clips) selection.addItem(c, true);
  return selection;
}

function __value(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return v;
  if ("x" in v && "y" in v) return { x: v.x, y: v.y };
  if ("red" in v && "green" in v) return { red: v.red, green: v.green, blue: v.blue, alpha: v.alpha };
  if ("value" in v) return __value(v.value);
  return String(v);
}

function __paramValue(spec) {
  if (spec && typeof spec === "object") {
    if ("x" in spec) return new ppro.PointF(spec.x, spec.y);
    return new ppro.Color(spec.red, spec.green, spec.blue, spec.alpha);
  }
  return spec;
}

async function __chain(clip) {
  const chain = await clip.getComponentChain();
  if (!chain) throw new Error("The clip has no effects chain");
  return chain;
}

async function __componentInfo(component, index) {
  const info = { index: index, displayName: await component.getDisplayName(), matchName: await component.getMatchName(), params: [] };
  const count = component.getParamCount();
  for (let i = 0; i < count; i++) {
    const p = component.getParam(i);
    const param = { index: i, name: p.displayName, timeVarying: false, value: null, keyframes: [] };
    try { param.timeVarying = Boolean(p.isTimeVarying()); } catch (e) {}
    try { param.value = __value(await p.getStartValue()); } catch (e) {}
    if (param.timeVarying) {
      try { param.keyframes = (p.getKeyframeListAsTickTimes() || []).map(__s); } catch (e) {}
    }
    info.params.push(param);
  }
  return info;
}

function __component(chain, index) {
  const count = chain.getComponentCount();
  if (index >= count) throw new Error("The clip has " + count + " component" + (count === 1 ? "" : "s") + "; index " + index + " does not exist (list_clip_effects shows them)");
  return chain.getComponentAtIndex(index);
}

function __param(component, spec) {
  const count = component.getParamCount();
  if (spec.paramIndex !== undefined) {
    if (spec.paramIndex >= count) throw new Error("The effect has " + count + " parameters; index " + spec.paramIndex + " does not exist");
    return component.getParam(spec.paramIndex);
  }
  for (let i = 0; i < count; i++) {
    const p = component.getParam(i);
    if (p.displayName === spec.param) return p;
  }
  throw new Error("The effect has no parameter named " + spec.param + " (list_clip_effects shows them)");
}
`;

/**
 * Wrap a tool body. The body runs after the helpers, inside an async
 * function, and returns the tool's result.
 * @param {string} body
 */
export function script(body) {
    return `${HELPERS}\n// ---- tool\n${body.trim()}\n`;
}

export { HELPERS };
