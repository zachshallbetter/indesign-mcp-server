/**
 * Media in the project: importing sequences from other projects and After
 * Effects compositions, relinking, refreshing, taking media offline,
 * proxies, footage interpretation and clip timecode, revealing a clip's file,
 * and the project's ingest, scratch disk and growing-file settings.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { json, bool, num, index, str, enumOf, formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run, executor } from '../executor.js';
import { ITEM_SCHEMA, itemSpec, itemSpecs } from '../args.js';
import { checkedPath, paths } from './project.js';

const ITEMS_SCHEMA = { type: 'array', items: ITEM_SCHEMA, maxItems: 500, description: 'The clip items (from list_project_items)' };
const SELECTED_SCHEMA = { type: 'boolean', description: 'Also act on the items selected in the Project panel', default: false };

/** A folder the caller names: absolute, allowed, and an existing directory. */
function checkedFolder(value, name) {
    const dir = checkedPath(value, name);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`'${name}' must be an existing folder: ${value}`);
    return dir;
}

/** The file name at the end of a macOS or Windows path. */
const baseName = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

/**
 * Files under the folders whose names (lower case) are in `wanted`, to the
 * given depth: name -> [paths]. Hidden folders are skipped; at most `limit`
 * entries are read.
 */
export function findFiles(folders, wanted, depth, limit = 200000) {
    const found = new Map();
    let seen = 0;
    const visit = (dir, level) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (++seen > limit) return;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (level < depth && !e.name.startsWith('.')) visit(full, level + 1);
            } else if (wanted.has(e.name.toLowerCase())) {
                const key = e.name.toLowerCase();
                if (!found.has(key)) found.set(key, []);
                if (!found.get(key).includes(full)) found.get(key).push(full);
            }
        }
    };
    for (const f of folders) visit(f, 1);
    return found;
}

/** How a file is shown in Finder or Explorer. Tests replace reveal. */
export const revealer = {
    reveal(file) {
        return new Promise((resolve, reject) => {
            if (process.platform === 'darwin') {
                execFile('/usr/bin/open', ['-R', file], { timeout: 15000 }, (error) => (error ? reject(error) : resolve()));
            } else if (process.platform === 'win32') {
                if (file.includes('"')) { reject(new Error(`Cannot reveal a path containing a quote: ${file}`)); return; }
                // Explorer exits with 1 even when it opens the window, so its exit code is ignored.
                execFile('explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true, timeout: 15000 }, () => resolve());
            } else {
                reject(new Error('Revealing a file needs macOS or Windows'));
            }
        });
    },
};

const FIELD_ORDERS = { default: 'FIELD_TYPE_DEFAULT', progressive: 'FIELD_TYPE_PROGRESSIVE', upper_first: 'FIELD_TYPE_UPPERFIRST', lower_first: 'FIELD_TYPE_LOWERFIRST' };
const ALPHA_USAGES = { straight: 'ALPHACHANNEL_STRAIGHT', premultiplied: 'ALPHACHANNEL_PREMULTIPLIED', none: 'ALPHACHANNEL_NONE', ignore: 'ALPHACHANNEL_IGNORE' };

const SCRATCH_DISKS = {
    capture: 'CAPTURE', videoPreview: 'VIDEO_PREVIEW', audioPreview: 'AUDIO_PREVIEW',
    autoSave: 'AUTO_SAVE', cclLibraries: 'CCL_LIBRARIES', capsuleMedia: 'CAPSULE_MEDIA',
};
const SCRATCH_DISK_LABELS = {
    capture: 'Captured Video and Audio', videoPreview: 'Video Previews', audioPreview: 'Audio Previews',
    autoSave: 'Project Auto Save', cclLibraries: 'CC Libraries Downloads', capsuleMedia: 'Motion Graphics Template Media',
};
const SCRATCH_FOLDERS = { same_as_project: 'SAME_AS_PROJECT', my_documents: 'MY_DOCUMENTS' };

/** A scratch disk value as a script literal: a ScratchDiskFolder constant or an existing folder. */
function scratchValue(value, name) {
    if (typeof value === 'string' && value in SCRATCH_FOLDERS) return `__C.ScratchDiskFolder.${SCRATCH_FOLDERS[value]}`;
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`'${name}' must be "same_as_project", "my_documents" or an absolute folder path`);
    return str(checkedFolder(value, name));
}

const READ_INTERPRETATION = `async (clip) => {
  const fi = await clip.getFootageInterpretation();
  if (!fi) return null;
  return {
    frameRate: fi.getFrameRate(), pixelAspectRatio: fi.getPixelAspectRatio(), fieldType: fi.getFieldType(),
    alphaUsage: fi.getAlphaUsage(), ignoreAlpha: fi.getIgnoreAlpha(), invertAlpha: fi.getInvertAlpha(), removePulldown: fi.getRemovePullDown(),
  };
}`;

export const tools = [
    {
        name: 'import_project_sequences',
        description: 'Import chosen sequences, with the clips they use, from another Premiere Pro project (File > Import of a .prproj, Import Selected Sequences) without the Import Premiere Pro Project dialog. Give the sequences\' guids: open that project and run list_sequences to see them. To import a whole project, pass the .prproj to import_media',
        inputSchema: {
            type: 'object',
            properties: {
                projectPath: { type: 'string', description: 'Absolute path of the .prproj to import from' },
                sequences: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 500, description: 'Guids of the sequences to import, as list_sequences reports them in that project' },
            },
            required: ['projectPath', 'sequences'],
        },
        auditArgs: { projectPath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'other.prproj'), sequences: ['b6b3d1a2-0000-4000-8000-000000000000'] },
        features: ['premiere.media_import.import_sequences_from_project'],
        handler: (a) => {
            const file = checkedPath(a.projectPath, 'projectPath', ['.prproj']);
            if (!Array.isArray(a.sequences) || !a.sequences.length) throw new Error("'sequences' must list at least one sequence guid");
            const guids = a.sequences.map((g, i) => {
                const s = String(g).trim();
                if (!/^\{?[0-9A-Fa-f]{8}(-?[0-9A-Fa-f]{4}){3}-?[0-9A-Fa-f]{12}\}?$/.test(s)) throw new Error(`'sequences[${i}]' is not a sequence guid: ${g}`);
                return s;
            });
            return run('Import sequences', script(`
const project = await __project();
const before = new Set((await project.getSequences()).map((s) => __id(s.guid)));
const ids = ${json(guids)}.map((g) => ppro.Guid.fromString(g));
const ok = await project.importSequences(${str(file)}, ids);
if (!ok) throw new Error("Premiere Pro did not import the sequences (check the project path and the guids)");
const added = (await project.getSequences()).filter((s) => !before.has(__id(s.guid))).map((s) => ({ name: s.name, guid: __id(s.guid) }));
return { imported: added.length, from: ${str(file)}, sequences: added };`));
        },
    },
    {
        name: 'import_after_effects_comps',
        description: 'Import compositions from an After Effects project (.aep, .aepx) as Dynamic Link clips (File > Adobe Dynamic Link > Import After Effects Composition) without the dialog: named compositions, or all of them, into the root or a bin',
        inputSchema: {
            type: 'object',
            properties: {
                aepPath: { type: 'string', description: 'Absolute path of the .aep or .aepx' },
                comps: { type: 'array', items: { type: 'string' }, maxItems: 500, description: 'Composition names to import. Omit to import every composition' },
                bin: { ...ITEM_SCHEMA, description: 'Import into this bin. Default: the project root' },
            },
            required: ['aepPath'],
        },
        auditArgs: { aepPath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'motion.aep'), comps: ['Title', 'Lower third'], bin: { path: 'Graphics' } },
        features: ['premiere.media_import.import_ae_comps', 'premiere.media_import.format_aep'],
        handler: (a) => {
            const file = checkedPath(a.aepPath, 'aepPath', ['.aep', '.aepx']);
            if (a.comps !== undefined && (!Array.isArray(a.comps) || !a.comps.length)) throw new Error("'comps' must list at least one composition name (omit it to import all)");
            const comps = a.comps?.map((c, i) => {
                if (typeof c !== 'string' || !c.trim()) throw new Error(`'comps[${i}]' is empty`);
                return c;
            });
            const call = comps
                ? `await project.importAEComps(${str(file)}, ${json(comps)}, target.item)`
                : `await project.importAllAEComps(${str(file)}, target.item)`;
            return run('Import After Effects compositions', script(`
const project = await __project();
const target = await __bin(project, ${a.bin ? itemSpec(a.bin, 'bin') : 'null'});
const before = new Set((target.children || []).map((c) => c.getId()));
const ok = ${call};
if (!ok) throw new Error("Premiere Pro did not import the compositions (check the file and the composition names)");
const after = await __entry(target.item, target.path);
const added = (after.children || []).filter((c) => !before.has(c.getId())).map((c) => ({ name: c.name, id: c.getId() }));
return { imported: added.length, bin: target.path || "(root)", items: added };`));
        },
    },
    {
        name: 'relink_media',
        description: 'Point clips at different media files (File > Link Media, Clip > Replace Footage) without the Link Media or Where Is the File dialogs: one clip to newPath, or every offline clip (or the items given) to the file of the same name found in searchFolders. Not undoable',
        inputSchema: {
            type: 'object',
            properties: {
                item: { ...ITEM_SCHEMA, description: 'With newPath: the clip to relink' },
                newPath: { type: 'string', description: 'Absolute path of the new media file for item' },
                searchFolders: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Relink offline clips to the file with the same name found in these folders (absolute paths)' },
                items: { ...ITEMS_SCHEMA, description: 'With searchFolders: only these clips (still only the offline ones). Default: every offline clip in the project' },
                depth: { type: 'integer', minimum: 1, maximum: 20, description: 'With searchFolders: how many folder levels to search. Default 5', default: 5 },
                overrideChecks: { type: 'boolean', description: 'Relink even when Premiere Pro finds the new file incompatible (different media type or duration). Default false', default: false },
            },
        },
        auditArgs: { item: { path: 'Footage/a.mov' }, newPath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'a.mov'), searchFolders: undefined, items: undefined },
        hints: { destructive: true },
        features: ['premiere.media_import.link_media', 'premiere.media_import.replace_footage', 'premiere.media_import.relink_automatically', 'premiere.projects.where_is_the_file'],
        handler: async (a) => {
            const override = bool(a.overrideChecks === true);
            if ((a.newPath === undefined) === (a.searchFolders === undefined)) throw new Error('Give newPath (with item) to relink one clip, or searchFolders to relink offline clips by file name');
            if (a.newPath !== undefined) {
                if (!a.item) throw new Error("newPath needs 'item': the clip to relink");
                if (a.items !== undefined) throw new Error("'items' goes with searchFolders; give one clip as item with newPath");
                const file = checkedPath(a.newPath, 'newPath');
                return run('Relink media', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
if (!(await clip.canChangeMediaPath())) throw new Error("Premiere Pro cannot change the media of " + entry.path);
const previous = await clip.getMediaFilePath();
if (!(await clip.changeMediaFilePath(${str(file)}, ${override}))) throw new Error("Premiere Pro did not relink " + entry.path + " (check the file exists and suits the clip, or pass overrideChecks)");
return { ...__itemInfo(entry), previousPath: previous, mediaPath: await clip.getMediaFilePath(), offline: await clip.isOffline() };`));
            }
            if (!Array.isArray(a.searchFolders) || !a.searchFolders.length) throw new Error("'searchFolders' must list at least one folder");
            const folders = a.searchFolders.map((f, i) => checkedFolder(f, `searchFolders[${i}]`));
            const depth = Number(index(a.depth ?? 5, { name: 'depth', max: 20 }));
            const listing = await executor.runStructured(script(`
const project = await __project();
const entries = ${a.items !== undefined ? `await __items(project, ${itemSpecs(a.items)}, false)` : 'await __walk(project, null, 100)'};
const offline = [];
for (const e of entries) {
  if (!e.clip || e.kind !== "clip") continue;
  let off = false, file = null;
  try { off = await e.clip.isOffline(); } catch (x) {}
  if (!off) continue;
  try { file = await e.clip.getMediaFilePath(); } catch (x) {}
  offline.push({ id: e.id, name: e.name, path: e.path, mediaPath: file });
}
return { offline: offline };`));
            if (!listing.ok) return formatErrorResponse(listing.error, 'Relink media');
            const offline = Array.isArray(listing.result?.offline) ? listing.result.offline : [];
            if (!offline.length) return formatResponse({ relinked: [], failed: [], unresolved: [], message: 'No offline clips to relink' }, 'Relink media', () => false);
            const nameOf = (o) => baseName(o.mediaPath) || baseName(o.name);
            const found = findFiles(folders, new Set(offline.map((o) => nameOf(o).toLowerCase())), depth);
            const plan = [];
            const unresolved = [];
            for (const o of offline) {
                const name = nameOf(o);
                const hits = (found.get(name.toLowerCase()) ?? []).filter((f) => { try { paths.validate(f); return true; } catch { return false; } });
                if (hits.length === 1) plan.push({ id: String(o.id), path: hits[0] });
                else unresolved.push({ ...o, reason: hits.length ? `${hits.length} files are named ${name}: relink it with item and newPath` : `No file named ${name} in searchFolders`, candidates: hits.slice(0, 10) });
            }
            if (!plan.length) return formatResponse({ relinked: [], failed: [], unresolved }, 'Relink media', () => false);
            const r = await executor.runStructured(script(`
const project = await __project();
const plan = ${json(plan)};
const relinked = [], failed = [];
for (const p of plan) {
  const entry = await __item(project, { id: p.id });
  const clip = __clipItem(entry);
  let ok = false;
  try { ok = (await clip.canChangeMediaPath()) && (await clip.changeMediaFilePath(p.path, ${override})); } catch (x) {}
  (ok ? relinked : failed).push({ ...__itemInfo(entry), mediaPath: p.path });
}
return { relinked: relinked, failed: failed };`));
            if (!r.ok) return formatErrorResponse(r.error, 'Relink media');
            return formatResponse({ ...(r.result ?? {}), unresolved }, 'Relink media', () => false);
        },
    },
    {
        name: 'manage_media',
        description: 'Refresh clips\' media from disk (Refresh Media), take them offline keeping the files (Clip > Make Offline, one undo step), or attach a proxy or the full-resolution file to one clip (Proxy > Attach Proxies, Reconnect Full Resolution Media; not undoable)',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['refresh', 'make_offline', 'attach_proxy', 'attach_full_resolution'], description: 'What to do' },
                items: ITEMS_SCHEMA,
                selected: SELECTED_SCHEMA,
                mediaPath: { type: 'string', description: 'With attach_proxy or attach_full_resolution: absolute path of the proxy or full-resolution file' },
            },
            required: ['action'],
        },
        auditArgs: { action: 'attach_proxy', items: [{ path: 'Footage/a.mov' }], selected: false, mediaPath: path.join(process.env.HOME ?? '/tmp', 'Documents', 'Proxies', 'a_proxy.mov') },
        hints: { destructive: true },
        features: ['premiere.media_import.refresh_media', 'premiere.media_import.make_offline', 'premiere.media_import.attach_proxies', 'premiere.media_import.ingest_proxy_workflow', 'premiere.media_import.reconnect_full_resolution'],
        handler: (a) => {
            const action = enumOf(a.action, ['refresh', 'make_offline', 'attach_proxy', 'attach_full_resolution'], { name: 'action' });
            const attach = action.startsWith('attach_');
            if (attach !== (a.mediaPath !== undefined)) throw new Error(attach ? `${action} needs 'mediaPath'` : `'mediaPath' goes only with attach_proxy or attach_full_resolution`);
            if (attach && ((a.items?.length ?? 0) !== 1 || a.selected)) throw new Error(`${action} takes one clip, given in items`);
            const file = attach ? checkedPath(a.mediaPath, 'mediaPath') : null;
            let body;
            if (action === 'refresh') {
                body = `const done = [];
for (const e of entries) done.push({ ...__itemInfo(e), refreshed: Boolean(await __clipItem(e).refreshMedia()) });
return { refreshed: done };`;
            } else if (action === 'make_offline') {
                body = `const clips = entries.map(__clipItem);
transact(project, "Make offline", (add) => { for (const c of clips) add(c.createSetOfflineAction()); });
const done = [];
for (const e of entries) done.push({ ...__itemInfo(e), offline: await e.clip.isOffline() });
return { madeOffline: done };`;
            } else {
                const hiRes = action === 'attach_full_resolution';
                body = `const e = entries[0];
const clip = __clipItem(e);
${hiRes ? '' : 'if (!(await clip.canProxy())) throw new Error("Premiere Pro cannot attach a proxy to " + e.path);\n'}if (!(await clip.attachProxy(${str(file)}, ${bool(hiRes)}, false))) throw new Error("Premiere Pro did not attach " + ${str(file)} + " to " + e.path);
return { ...__itemInfo(e), mediaPath: await clip.getMediaFilePath(), hasProxy: await clip.hasProxy(), proxyPath: await clip.getProxyPath() };`;
            }
            return run('Manage media', script(`
const project = await __project();
const entries = await __items(project, ${itemSpecs(a.items)}, ${bool(a.selected)});
${body}`));
        },
    },
    {
        name: 'modify_footage',
        description: 'Change how clips\' media is interpreted (Clip > Modify > Interpret Footage: frame rate, pixel aspect ratio, field order, alpha channel, remove pulldown), set their starting timecode (Clip > Modify > Timecode), or scale them to the sequence frame size (Clip > Video Options > Scale to Frame Size). One undo step',
        inputSchema: {
            type: 'object',
            properties: {
                items: ITEMS_SCHEMA,
                selected: SELECTED_SCHEMA,
                frameRate: { type: 'number', minimum: 1, maximum: 1000, description: 'Assume this frame rate, frames per second (e.g. 23.976)' },
                pixelAspectRatio: { type: 'number', minimum: 0.1, maximum: 10, description: 'Conform to this pixel aspect ratio, e.g. 1 for square pixels or 2 for 2:1 anamorphic' },
                fieldOrder: { type: 'string', enum: Object.keys(FIELD_ORDERS), description: 'Field order: default uses the file\'s own' },
                alphaUsage: { type: 'string', enum: Object.keys(ALPHA_USAGES), description: 'How the alpha channel is interpreted' },
                ignoreAlpha: { type: 'boolean', description: 'Ignore the alpha channel' },
                invertAlpha: { type: 'boolean', description: 'Invert the alpha channel' },
                removePulldown: { type: 'boolean', description: 'Remove 3:2 pulldown' },
                startTime: { type: 'number', minimum: 0, maximum: 864000, description: 'Media start timecode, in seconds (3600 = 01:00:00:00)' },
                scaleToFrameSize: { type: 'boolean', description: 'true: scale to the sequence frame size (only true is accepted)' },
            },
        },
        auditArgs: {
            items: [{ path: 'Footage/a.mov' }], selected: false, frameRate: 23.976, pixelAspectRatio: 1, fieldOrder: 'progressive', alphaUsage: 'premultiplied',
            ignoreAlpha: false, invertAlpha: false, removePulldown: false, startTime: 3600, scaleToFrameSize: true,
        },
        hints: { idempotent: true },
        guarded: ['getStart'],
        features: [
            'premiere.media_import.interpret_footage', 'premiere.media_import.change_frame_rate', 'premiere.media_import.pixel_aspect_ratio',
            'premiere.media_import.field_order', 'premiere.media_import.alpha_channel', 'premiere.media_import.resize_imported_images', 'premiere.projects.set_clip_timecode',
        ],
        handler: (a) => {
            const fi = [];
            const changed = [];
            const set = (key, call) => { fi.push(`if (!fi.${call}) throw new Error("Premiere Pro refused ${key} for " + e.path);`); changed.push(key); };
            if (a.frameRate !== undefined) set('frameRate', `setFrameRate(${num(a.frameRate, { min: 1, max: 1000, name: 'frameRate' })})`);
            if (a.pixelAspectRatio !== undefined) set('pixelAspectRatio', `setPixelAspectRatio(${num(a.pixelAspectRatio, { min: 0.1, max: 10, name: 'pixelAspectRatio' })})`);
            if (a.fieldOrder !== undefined) set('fieldOrder', `setFieldType(fi.${FIELD_ORDERS[enumOf(a.fieldOrder, Object.keys(FIELD_ORDERS), { name: 'fieldOrder' })]})`);
            if (a.alphaUsage !== undefined) set('alphaUsage', `setAlphaUsage(fi.${ALPHA_USAGES[enumOf(a.alphaUsage, Object.keys(ALPHA_USAGES), { name: 'alphaUsage' })]})`);
            if (a.ignoreAlpha !== undefined) set('ignoreAlpha', `setIgnoreAlpha(${bool(a.ignoreAlpha)})`);
            if (a.invertAlpha !== undefined) set('invertAlpha', `setInvertAlpha(${bool(a.invertAlpha)})`);
            if (a.removePulldown !== undefined) set('removePulldown', `setRemovePullDown(${bool(a.removePulldown)})`);
            if (a.scaleToFrameSize !== undefined && a.scaleToFrameSize !== true) throw new Error("'scaleToFrameSize' can only be true: Premiere Pro's API turns it on, not off");
            const scale = a.scaleToFrameSize === true;
            const start = a.startTime === undefined ? null : num(a.startTime, { min: 0, max: 864000, name: 'startTime' });
            if (scale) changed.push('scaleToFrameSize');
            if (start !== null) changed.push('startTime');
            if (!changed.length) throw new Error('Nothing to change: give frameRate, pixelAspectRatio, fieldOrder, alphaUsage, ignoreAlpha, invertAlpha, removePulldown, startTime or scaleToFrameSize');
            const actions = [
                fi.length ? 'add(c.clip.createSetFootageInterpretationAction(c.fi));' : '',
                scale ? 'add(c.clip.createSetScaleToFrameSizeAction());' : '',
                start !== null ? `add(c.media.createSetStartAction(__t(${start})));` : '',
            ].filter(Boolean);
            return run('Modify footage', script(`
const project = await __project();
const entries = await __items(project, ${itemSpecs(a.items)}, ${bool(a.selected)});
const readInterpretation = ${READ_INTERPRETATION};
const changes = [];
for (const e of entries) {
  const clip = __clipItem(e);
  let fi = null, media = null;
  ${fi.length ? `fi = await clip.getFootageInterpretation();
  if (!fi) throw new Error(e.path + " has no footage to interpret");
  ${fi.join('\n  ')}` : ''}
  ${start !== null ? 'media = await clip.getMedia();\n  if (!media) throw new Error(e.path + " has no media to set a timecode on");' : ''}
  changes.push({ entry: e, clip: clip, fi: fi, media: media });
}
transact(project, "Modify footage", (add) => {
  for (const c of changes) {
    ${actions.join('\n    ')}
  }
});
const out = [];
for (const c of changes) {
  let interpretation = null, mediaStart = null;
  try { interpretation = await readInterpretation(c.clip); } catch (x) {}
  try { if (c.media && typeof c.media.getStart === "function") mediaStart = __s(await c.media.getStart()); } catch (x) {}
  out.push({ ...__itemInfo(c.entry), interpretation: interpretation, mediaStart: mediaStart });
}
return { changed: ${json(changed)}, items: out };`));
        },
    },
    {
        name: 'reveal_media_file',
        description: 'Show a clip\'s media file in Finder or File Explorer (Reveal in Finder, Reveal in Explorer). Returns the path',
        inputSchema: { type: 'object', properties: { item: ITEM_SCHEMA }, required: ['item'] },
        auditArgs: { item: { path: 'Footage/a.mov' } },
        hints: { readOnly: true },
        features: ['premiere.projects.reveal_in_finder'],
        handler: async (a) => {
            const r = await executor.runStructured(script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
return { item: entry.path, mediaPath: await clip.getMediaFilePath(), offline: await clip.isOffline() };`));
            if (!r.ok) return formatErrorResponse(r.error, 'Reveal media');
            const file = r.result?.mediaPath;
            if (typeof file !== 'string' || !path.isAbsolute(file)) return formatErrorResponse({ ...(r.result ?? {}), error: 'The item has no media file on disk' }, 'Reveal media');
            if (!existsSync(file)) return formatErrorResponse({ ...r.result, error: 'The media file is missing: relink the clip with relink_media' }, 'Reveal media');
            try {
                await revealer.reveal(file);
            } catch (error) {
                return formatErrorResponse({ ...r.result, error: error.message }, 'Reveal media');
            }
            return formatResponse({ ...r.result, revealed: true }, 'Reveal media', () => false);
        },
    },
    {
        name: 'get_project_media_settings',
        description: 'Read the active project\'s ingest setting and scratch disk folders (File > Project Settings > Ingest Settings, Scratch Disks)',
        inputSchema: { type: 'object', properties: {} },
        hints: { readOnly: true },
        features: ['premiere.media_import.ingest_settings', 'premiere.projects.scratch_disks'],
        handler: () => run('Project media settings', script(`
const project = await __project();
const out = { ingestEnabled: null, scratchDisks: {} };
try { out.ingestEnabled = await (await ppro.ProjectSettings.getIngestSettings(project)).getIsIngestEnabled(); } catch (x) {}
let disks = null;
try { disks = await ppro.ProjectSettings.getScratchDiskSettings(project); } catch (x) {}
for (const [key, type] of [${Object.entries(SCRATCH_DISKS).map(([k, v]) => `[${json(k)}, __C.ScratchDiskFolderType.${v}]`).join(', ')}]) {
  try { out.scratchDisks[key] = disks ? disks.getScratchDiskPath(type) : null; } catch (x) { out.scratchDisks[key] = null; }
}
return out;`)),
    },
    {
        name: 'set_project_media_settings',
        description: 'Turn ingest on or off (File > Project Settings > Ingest Settings), choose scratch disk folders (Scratch Disks), and pause or resume refreshing growing files. Settings are one undo step; pausing growing files is not undoable',
        inputSchema: {
            type: 'object',
            properties: {
                ingestEnabled: { type: 'boolean', description: 'Run the project\'s ingest operation (copy, transcode or create proxies, as set in Premiere Pro) on import' },
                scratchDisks: {
                    type: 'object',
                    description: 'Scratch disk folders to change. Each is "same_as_project", "my_documents" or an absolute path of an existing folder',
                    properties: Object.fromEntries(Object.keys(SCRATCH_DISKS).map((k) => [k, { type: 'string', description: SCRATCH_DISK_LABELS[k] }])),
                },
                pauseGrowing: { type: 'boolean', description: 'true pauses refreshing growing files (media still being written); false resumes' },
            },
        },
        auditArgs: { ingestEnabled: true, scratchDisks: { capture: 'same_as_project', videoPreview: process.env.HOME ?? '/tmp', audioPreview: 'my_documents' }, pauseGrowing: false },
        hints: { idempotent: true },
        features: ['premiere.media_import.ingest_settings', 'premiere.media_import.ingest_proxy_workflow', 'premiere.media_import.growing_files', 'premiere.projects.scratch_disks'],
        handler: (a) => {
            if (a.scratchDisks !== undefined && (typeof a.scratchDisks !== 'object' || a.scratchDisks === null || Array.isArray(a.scratchDisks))) throw new Error("'scratchDisks' must be an object such as { videoPreview: \"same_as_project\" }");
            const disks = Object.entries(a.scratchDisks ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => {
                if (!(k in SCRATCH_DISKS)) throw new Error(`Unknown scratch disk '${k}': use ${Object.keys(SCRATCH_DISKS).join(', ')}`);
                return `if (!disks.setScratchDiskPath(__C.ScratchDiskFolderType.${SCRATCH_DISKS[k]}, ${scratchValue(v, `scratchDisks.${k}`)})) throw new Error("Premiere Pro refused the ${SCRATCH_DISK_LABELS[k]} folder");`;
            });
            const ingest = a.ingestEnabled === undefined ? null : bool(a.ingestEnabled);
            const pause = a.pauseGrowing === undefined ? null : bool(a.pauseGrowing);
            if (ingest === null && !disks.length && pause === null) throw new Error('Nothing to change: give ingestEnabled, scratchDisks or pauseGrowing');
            const actions = [
                ingest !== null ? 'add(ppro.ProjectSettings.createSetIngestSettingsAction(project, ingest));' : '',
                disks.length ? 'add(ppro.ProjectSettings.createSetScratchDiskSettingsAction(project, disks));' : '',
            ].filter(Boolean);
            return run('Set project media settings', script(`
const project = await __project();
const out = { changed: [] };
${ingest !== null ? `const ingest = await ppro.ProjectSettings.getIngestSettings(project);
if (!(await ingest.setIngestEnabled(${ingest}))) throw new Error("Premiere Pro refused the ingest setting");
out.changed.push("ingestEnabled");` : ''}
${disks.length ? `const disks = await ppro.ProjectSettings.getScratchDiskSettings(project);
${disks.join('\n')}
out.changed.push("scratchDisks");` : ''}
${actions.length ? `transact(project, "Project media settings", (add) => {\n  ${actions.join('\n  ')}\n});` : ''}
${pause !== null ? `if (!(await project.pauseGrowing(${pause}))) throw new Error("Premiere Pro did not ${a.pauseGrowing ? 'pause' : 'resume'} growing files");
out.changed.push("pauseGrowing");` : ''}
return out;`));
        },
    },
];
