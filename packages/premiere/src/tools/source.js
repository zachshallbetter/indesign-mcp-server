/**
 * Source clips and the Source Monitor: make subclips, set or clear a clip
 * project item's in and out points, scale items to the frame size, and open,
 * play and match frames in the Source Monitor.
 */
import { bool, str, enumOf, num } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { SEQUENCE_SCHEMA, ITEM_SCHEMA, CLIP_SCHEMA, sequenceSpec, itemSpec, itemSpecs, clipSpec, seconds } from '../args.js';

const MONITOR_ACTIONS = ['open', 'play', 'close', 'close_all', 'status', 'match_frame'];

/** Script lines that read a clip project item's in and out points (video, else audio) into `range`. */
const RANGE_HELPER = String.raw`
async function __range(clip) {
  const read = async (fn) => {
    try { return __s(await fn(__C.MediaType.VIDEO)); } catch (e) {}
    try { return __s(await fn(__C.MediaType.AUDIO)); } catch (e) {}
    return null;
  };
  return { inPoint: await read((t) => clip.getInPoint(t)), outPoint: await read((t) => clip.getOutPoint(t)) };
}`;

function itemList(a) {
    if (a.item !== undefined && a.items !== undefined) throw new Error('Give item or items, not both');
    if (a.item !== undefined) return `[${itemSpec(a.item)}]`;
    if (!Array.isArray(a.items) || !a.items.length) throw new Error('Choose the clip project items: item, or items');
    return itemSpecs(a.items);
}

export const tools = [
    {
        name: 'create_subclip',
        description: 'Make a subclip of a clip project item (Clip > Make Subclip): a new project item limited to a range of the source, optionally restricted so it cannot be trimmed past it (Premiere Pro 26.3 or later). Returns the new item',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                name: { type: 'string', description: 'Name of the subclip' },
                start: { type: 'number', minimum: 0, description: 'Start, seconds into the media' },
                end: { type: 'number', minimum: 0, description: 'End, seconds into the media' },
                restrictTrims: { type: 'boolean', description: 'Restrict Trims to Subclip Boundaries. Default false', default: false },
                video: { type: 'boolean', description: 'Include the video. Default true', default: true },
                audio: { type: 'boolean', description: 'Include the audio. Default true', default: true },
            },
            required: ['item', 'name', 'start', 'end'],
        },
        auditArgs: { item: { path: 'Footage/Interview.mov' }, name: 'Answer 1', start: 12, end: 31.5, restrictTrims: true },
        since: '26.3',
        features: ['premiere.editing.make_subclip'],
        handler: (a) => {
            if (typeof a.name !== 'string' || !a.name.trim()) throw new Error("'name' is empty");
            const start = seconds(a.start, 'start');
            const end = seconds(a.end, 'end');
            if (Number(end) <= Number(start)) throw new Error('end must be after start');
            if (a.video === false && a.audio === false) throw new Error('A subclip needs video or audio: video and audio are both false');
            return run('Create subclip', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
const before = new Set((await __walk(project, null, 100)).map((e) => e.id));
transact(project, "Make Subclip", (add) => add(clip.createSubClipAction(${str(a.name)}, __t(${start}), __t(${end}), ${bool(a.restrictTrims)}, { takeVideo: ${bool(a.video ?? true)}, takeAudio: ${bool(a.audio ?? true)} })));
const made = (await __walk(project, null, 100)).filter((e) => !before.has(e.id));
return { source: entry.path, start: ${start}, end: ${end}, created: made.map(__itemInfo) };`), { since: '26.3' });
        },
    },
    {
        name: 'set_source_in_out',
        description: 'Set or clear the in and out points of clip project items, as marking them in the Source Monitor does (Markers > Mark In, Mark Out, Clear In and Out). Used to choose the part of a clip to edit in, or to line up camera angles for synchronising. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                items: { type: 'array', items: ITEM_SCHEMA, maxItems: 500, description: 'Several clip project items instead of item' },
                inPoint: { type: 'number', minimum: 0, description: 'In point, seconds into the media' },
                outPoint: { type: 'number', minimum: 0, description: 'Out point, seconds into the media' },
                clear: { type: 'boolean', description: 'Clear both points (Clear In and Out)', default: false },
            },
        },
        auditArgs: { item: undefined, items: [{ path: 'Footage/Cam A.mov' }, { path: 'Footage/Cam B.mov' }], inPoint: 4.2, outPoint: undefined, clear: false },
        hints: { idempotent: true },
        features: ['premiere.markers.clear_in_and_out', 'premiere.multicam.mark_for_sync'],
        handler: (a) => {
            const list = itemList(a);
            const inP = a.inPoint === undefined ? null : seconds(a.inPoint, 'inPoint');
            const outP = a.outPoint === undefined ? null : seconds(a.outPoint, 'outPoint');
            if (a.clear && (inP !== null || outP !== null)) throw new Error('clear cannot be combined with inPoint or outPoint');
            if (!a.clear && inP === null && outP === null) throw new Error('Nothing to set: give inPoint, outPoint, or clear: true');
            if (inP !== null && outP !== null && Number(outP) <= Number(inP)) throw new Error('outPoint must be after inPoint');
            return run('Set source in and out', script(`${RANGE_HELPER}
const project = await __project();
const plan = [];
for (const spec of ${list}) {
  const entry = await __item(project, spec);
  const clip = __clipItem(entry);
  const now = await __range(clip);
  const inP = ${inP === null ? 'now.inPoint' : inP}, outP = ${outP === null ? 'now.outPoint' : outP};
  ${a.clear ? '' : `if (inP === null || outP === null) throw new Error("Could not read the in and out points of " + entry.path + ": give inPoint and outPoint");
  if (outP <= inP) throw new Error("The out point of " + entry.path + " (" + outP + " s) would not be after its in point (" + inP + " s)");`}
  plan.push({ entry: entry, clip: clip, inP: inP, outP: outP });
}
transact(project, ${str(a.clear ? 'Clear In and Out' : 'Set In and Out')}, (add) => {
  for (const p of plan) add(${a.clear ? 'p.clip.createClearInOutPointsAction()' : 'p.clip.createSetInOutPointsAction(__t(p.inP), __t(p.outP))'});
});
const out = [];
for (const p of plan) out.push({ item: p.entry.path, ...(await __range(p.clip)) });
return { cleared: ${bool(a.clear)}, items: out };`));
        },
    },
    {
        name: 'scale_to_frame_size',
        description: 'Turn on Scale to Frame Size for clip project items (Clip > Video Options > Scale to Frame Size): clips placed from them afterwards are resampled to the sequence frame size. Clips already in a sequence are not changed; fit_clips_to_frame sets their scale. One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                items: { type: 'array', items: ITEM_SCHEMA, maxItems: 500, description: 'Several clip project items instead of item' },
            },
        },
        auditArgs: { item: { path: 'Stills/Logo.png' }, items: undefined },
        hints: { idempotent: true },
        features: ['premiere.editing.scale_to_frame_size'],
        handler: (a) => run('Scale to frame size', script(`
const project = await __project();
const entries = [];
for (const spec of ${itemList(a)}) {
  const entry = await __item(project, spec);
  __clipItem(entry);
  entries.push(entry);
}
transact(project, "Scale to Frame Size", (add) => { for (const e of entries) add(e.clip.createSetScaleToFrameSizeAction()); });
return { scaled: entries.map((e) => e.path) };`)),
    },
    {
        name: 'control_source_monitor',
        description: 'Work the Source Monitor: open a clip project item (optionally at a time), play it at a speed (Play-Stop Toggle; negative plays backward, as the J, K and L shuttle keys do), close the clip or every clip, report what is open, or Match Frame (Sequence > Match Frame: open the source of a sequence clip at the frame under the playhead). Positioning needs Premiere Pro 26.3 or later. Playback is the Source Monitor only: the Program Monitor cannot be played from a script',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: MONITOR_ACTIONS },
                item: { ...ITEM_SCHEMA, description: 'With open: the clip project item to open' },
                position: { type: 'number', minimum: 0, description: 'With open: show this time, seconds into the media (26.3 or later)' },
                speed: { type: 'number', minimum: -4, maximum: 4, description: 'With play: playback speed, 1 = normal, negative plays backward, 0 stops. Default 1', default: 1 },
                sequence: { ...SEQUENCE_SCHEMA, description: 'With match_frame: the sequence (default the active one)' },
                clip: { ...CLIP_SCHEMA, description: 'With match_frame: the clip; default the clip under the playhead on the highest video track that has one, else on the first audio track that has one' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'match_frame', item: undefined, position: undefined, speed: undefined, clip: undefined },
        guarded: ['setPosition'],
        features: ['premiere.editing.play_stop', 'premiere.editing.shuttle', 'premiere.sequences.match_frame'],
        handler: (a) => {
            const action = enumOf(a.action, MONITOR_ACTIONS, { name: 'action' });
            const allowed = { open: ['item', 'position'], play: ['speed'], match_frame: ['sequence', 'clip'] }[action] ?? [];
            for (const k of ['item', 'position', 'speed', 'sequence', 'clip']) {
                if (a[k] !== undefined && !allowed.includes(k)) throw new Error(`'${k}' does not apply to action ${action}`);
            }
            const position = `async (t) => {
  if (typeof ppro.SourceMonitor.setPosition !== "function") return false;
  return Boolean(await ppro.SourceMonitor.setPosition(t));
}`;
            const status = `const shown = await ppro.SourceMonitor.getProjectItem();
let at = null;
try { at = __s(await ppro.SourceMonitor.getPosition()); } catch (e) {}
const state = { item: shown ? { name: shown.name, id: shown.getId() } : null, position: at };`;
            let body;
            if (action === 'open') {
                if (a.item === undefined) throw new Error('open needs item');
                const at = a.position === undefined ? null : seconds(a.position, 'position');
                body = `const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
__clipItem(entry);
if (!(await ppro.SourceMonitor.openProjectItem(entry.item))) throw new Error("Premiere Pro did not open " + entry.path + " in the Source Monitor");
const setPosition = ${position};
const positioned = ${at === null ? 'null' : `await setPosition(__t(${at}))`};
${at === null ? '' : 'if (positioned === false) throw new Error("Opened, but moving the Source Monitor to a time needs Premiere Pro 26.3 or later");'}
${status}
return { action: "open", opened: entry.path, ...state };`;
            } else if (action === 'play') {
                const speed = num(a.speed ?? 1, { min: -4, max: 4, name: 'speed' });
                body = `const shown = await ppro.SourceMonitor.getProjectItem();
if (!shown) throw new Error("Nothing is open in the Source Monitor: open a clip first (action open)");
if (!(await ppro.SourceMonitor.play(${speed}))) throw new Error("Premiere Pro did not play the Source Monitor");
return { action: "play", speed: ${speed}, item: { name: shown.name, id: shown.getId() } };`;
            } else if (action === 'close' || action === 'close_all') {
                body = `const closed = await ppro.SourceMonitor.${action === 'close' ? 'closeClip' : 'closeAllClips'}();
${status}
return { action: ${str(action)}, closed: Boolean(closed), ...state };`;
            } else if (action === 'status') {
                body = `${status}
return state;`;
            } else {
                body = `const project = await __project();
const seq = await __sequence(project, ${sequenceSpec(a.sequence)});
const head = await seq.getPlayerPosition();
const ph = __s(head);
let clip = null;
${a.clip !== undefined ? `[clip] = await __clips(seq, ${clipSpec(a.clip)});` : `const under = async (kind, t) => {
  for (const c of await __trackClips(await __track(seq, kind, t))) {
    if (__s(await c.getStartTime()) <= ph && ph < __s(await c.getEndTime())) return c;
  }
  return null;
};
for (let t = (await seq.getVideoTrackCount()) - 1; t >= 0 && !clip; t--) clip = await under("video", t);
for (let t = 0, n = await seq.getAudioTrackCount(); t < n && !clip; t++) clip = await under("audio", t);
if (!clip) throw new Error("No clip is under the playhead");`}
const item = await clip.getProjectItem();
if (!item) throw new Error((await clip.getName()) + " has no project item to match");
const sourceTime = (await clip.getInPoint()).add(head.subtract(await clip.getStartTime()));
if (!(await ppro.SourceMonitor.openProjectItem(item))) throw new Error("Premiere Pro did not open " + item.name + " in the Source Monitor");
const setPosition = ${position};
const positioned = await setPosition(sourceTime);
return { action: "match_frame", clip: await clip.getName(), item: { name: item.name, id: item.getId() }, sourceTime: __s(sourceTime), positioned: positioned, note: positioned ? null : "Opened at its last position: moving the Source Monitor needs Premiere Pro 26.3 or later" };`;
            }
            return run('Source Monitor', script(body));
        },
    },
];
