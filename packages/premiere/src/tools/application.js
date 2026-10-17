/**
 * The application: wait for a Premiere Pro event, clear the media cache, and
 * find (and open) the Auto-Save copies of a project after a crash.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { formatResponse, formatErrorResponse, enumOf, index, num, str } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { SEQUENCE_SCHEMA, sequenceSpec } from '../args.js';
import { checkedPath } from './project.js';

/**
 * Events a caller can wait for: [where the listener goes, Constants enum, value].
 * project and operation events are global (any open project); sequence
 * events go on one sequence, or are global without one; encoder events go on
 * the EncoderManager.
 */
const EVENTS = {
    project_opened: ['global', 'ProjectEvent', 'OPENED'],
    project_closed: ['global', 'ProjectEvent', 'CLOSED'],
    project_changed: ['global', 'ProjectEvent', 'DIRTY'],
    project_activated: ['global', 'ProjectEvent', 'ACTIVATED'],
    project_selection_changed: ['global', 'ProjectEvent', 'PROJECT_ITEM_SELECTION_CHANGED'],
    sequence_activated: ['sequence', 'SequenceEvent', 'ACTIVATED'],
    sequence_closed: ['sequence', 'SequenceEvent', 'CLOSED'],
    sequence_selection_changed: ['sequence', 'SequenceEvent', 'SELECTION_CHANGED'],
    render_queued: ['encoder', 'EncoderEvent', 'RENDER_QUEUE'],
    render_progress: ['encoder', 'EncoderEvent', 'RENDER_PROGRESS'],
    render_complete: ['encoder', 'EncoderEvent', 'RENDER_COMPLETE'],
    render_error: ['encoder', 'EncoderEvent', 'RENDER_ERROR'],
    render_cancelled: ['encoder', 'EncoderEvent', 'RENDER_CANCEL'],
    export_complete: ['global', 'OperationCompleteEvent', 'EXPORT_MEDIA_COMPLETE'],
    import_complete: ['global', 'OperationCompleteEvent', 'IMPORT_MEDIA_COMPLETE'],
};

const AUTO_SAVE_FOLDER = 'Adobe Premiere Pro Auto-Save';
const docs = path.join(process.env.HOME ?? '/tmp', 'Documents');

/** The Auto-Save copies of a project in a folder, newest first. */
function autoSaves(folder, projectFile) {
    if (!existsSync(folder)) return [];
    const base = projectFile ? path.basename(projectFile, path.extname(projectFile)) : null;
    return readdirSync(folder)
        .filter((n) => n.toLowerCase().endsWith('.prproj') && (base === null || n.startsWith(`${base}-`)))
        .map((n) => {
            const file = path.join(folder, n);
            const st = statSync(file);
            return { file, modified: st.mtime.toISOString(), bytes: st.size, ms: st.mtimeMs };
        })
        .sort((x, y) => y.ms - x.ms)
        .map(({ ms, ...rest }) => rest);
}

const OPEN_COPY = (file) => script(`
const options = new ppro.OpenProjectOptions();
options.setShowConvertProjectDialog(false);
options.setShowLocateFileDialog(false);
options.setShowWarningDialog(false);
options.setAddToMRUList(false);
const project = await ppro.Project.open(${str(file)}, options);
if (!project) throw new Error("Premiere Pro did not open " + ${str(file)});
return { name: project.name, path: project.path, guid: __id(project.guid) };`);

export const tools = [
    {
        name: 'wait_for_event',
        description: 'Wait until Premiere Pro reports an event (script events), or until the timeout: a project opening, closing, changing, being activated or its Project panel selection changing; a sequence being activated, closed or its selection changing; a Media Encoder job being queued, progressing, completing, failing or being cancelled; an export or import finishing. Returns whether it happened and the event\'s details. Other calls wait while this one runs',
        inputSchema: {
            type: 'object',
            properties: {
                event: { type: 'string', enum: Object.keys(EVENTS), description: 'The event to wait for' },
                sequence: { ...SEQUENCE_SCHEMA, description: 'Sequence events: listen on this sequence. Default: any sequence' },
                timeout: { type: 'number', minimum: 1, maximum: 3600, description: 'Give up after this many seconds. Default 60', default: 60 },
            },
            required: ['event'],
        },
        auditArgs: { event: 'sequence_selection_changed', sequence: { name: 'Main edit' }, timeout: 5 },
        hints: { readOnly: true },
        features: ['premiere.automation.events'],
        handler: (a) => {
            const event = enumOf(a.event, Object.keys(EVENTS), { name: 'event' });
            const [where, group, value] = EVENTS[event];
            if (a.sequence !== undefined && where !== 'sequence') throw new Error(`sequence goes with the sequence_ events, not ${event}`);
            const timeout = Math.round(Number(num(a.timeout ?? 60, { min: 1, max: 3600, name: 'timeout' })));
            const onTarget = where === 'encoder' || (where === 'sequence' && a.sequence !== undefined);
            const target = where === 'encoder' ? 'const target = ppro.EncoderManager.getManager();'
                : onTarget ? `const project = await __project();\nconst target = await __sequence(project, ${sequenceSpec(a.sequence)});` : '';
            const add = onTarget ? 'ppro.EventManager.addEventListener(target, name, handler, false);' : 'ppro.EventManager.addGlobalEventListener(name, handler, false);';
            const remove = onTarget ? 'ppro.EventManager.removeEventListener(target, name, handler);' : 'ppro.EventManager.removeGlobalEventListener(name, handler);';
            return run('Wait for event', script(`
${target}
const name = __C.${group}.${value};
let handler = null, timer = null;
const outcome = await new Promise((resolve) => {
  handler = (e) => resolve({ fired: true, detail: e });
  ${add}
  timer = setTimeout(() => resolve({ fired: false, detail: null }), ${timeout * 1000});
});
clearTimeout(timer);
${remove}
const details = {};
if (outcome.detail && typeof outcome.detail === "object") {
  for (const k of Object.keys(outcome.detail)) {
    const v = outcome.detail[k];
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) details[k] = v;
  }
}
return { event: ${str(event)}, fired: outcome.fired, timeout: ${timeout}, details: details };`), { timeoutMs: (timeout + 30) * 1000 });
        },
    },
    {
        name: 'clear_media_cache',
        description: 'Delete Premiere Pro\'s media cache files (Settings > Media Cache > Delete): conformed audio, peak files and indexes, which Premiere Pro rebuilds as needed. Premiere Pro 26.5 or later. The cache folder and automatic clean-up settings cannot be changed by script',
        inputSchema: { type: 'object', properties: {} },
        since: '26.5',
        hints: { idempotent: true },
        features: ['premiere.application.media_cache'],
        handler: () => run('Clear media cache', script(`
if (typeof ppro.MediaManager === "undefined") throw new Error("Clearing the media cache needs Premiere Pro 26.5 or later");
if (!(await ppro.MediaManager.purgeMediaCache())) throw new Error("Premiere Pro did not clear the media cache");
return { cleared: true };`), { since: '26.5' }),
    },
    {
        name: 'recover_project',
        description: 'Recover a project after a crash: list the copies in its Auto-Save folder (the Auto Save scratch disk, by default "Adobe Premiere Pro Auto-Save" beside the project), newest first, and with open: true open the newest (or a chosen one) as a separate project, with Premiere Pro\'s dialogs turned off. The original project file is not changed',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Absolute path of the project (.prproj) to recover. Default: the active project' },
                folder: { type: 'string', description: 'Absolute path of the Auto-Save folder, when it is not the project\'s' },
                open: { type: 'boolean', description: 'Open a copy: the newest, or openFile. Default false', default: false },
                openFile: { type: 'string', description: 'With open: the copy to open, from the list' },
                limit: { type: 'integer', minimum: 1, maximum: 500, description: 'List at most this many copies. Default 20', default: 20 },
            },
        },
        auditArgs: { project: path.join(docs, 'audit.prproj'), folder: undefined, open: false, openFile: undefined },
        features: ['premiere.application.recover_after_crash'],
        handler: async (a) => {
            const projectFile = a.project === undefined ? null : checkedPath(a.project, 'project', ['.prproj']);
            const limit = Number(index(a.limit ?? 20, { name: 'limit', max: 500 }));
            if (a.openFile !== undefined && a.open !== true) throw new Error('openFile goes with open: true');
            let folder = a.folder === undefined ? null : checkedPath(a.folder, 'folder');
            let source = folder ? 'folder' : null;
            let file = projectFile;
            if (!folder) {
                // Premiere Pro knows the Auto Save scratch disk of the active project.
                const r = await executor.runStructured(script(`
const project = await ppro.Project.getActiveProject();
if (!project) return { path: null, autoSave: null };
const settings = await ppro.ProjectSettings.getScratchDiskSettings(project);
return { path: project.path, autoSave: settings ? settings.getScratchDiskPath(__C.ScratchDiskFolderType.AUTO_SAVE) : null };`));
                if (!r.ok) return formatErrorResponse(r.error, 'Recover project');
                const active = r.result ?? {};
                const isActive = typeof active.path === 'string' && (file === null || path.resolve(active.path) === file);
                if (file === null && !isActive) throw new Error('No project is open: pass project (the .prproj to recover) or folder (its Auto-Save folder)');
                if (file === null) file = checkedPath(active.path, 'project', ['.prproj']);
                if (isActive && typeof active.autoSave === 'string' && path.isAbsolute(active.autoSave)) {
                    folder = checkedPath(active.autoSave, 'folder');
                    source = 'scratch disk';
                } else {
                    // "Same as Project" (the default) is reported symbolically.
                    folder = checkedPath(path.join(path.dirname(file), AUTO_SAVE_FOLDER), 'folder');
                    source = 'beside the project';
                }
            }
            const copies = autoSaves(folder, file);
            const result = { project: file, folder, folderFrom: source, folderExists: existsSync(folder), count: copies.length, copies: copies.slice(0, limit) };
            if (a.open !== true) return formatResponse(result, 'Recover project', () => false);
            let chosen;
            if (a.openFile !== undefined) {
                chosen = checkedPath(a.openFile, 'openFile', ['.prproj']);
                if (!existsSync(chosen)) throw new Error(`${chosen} does not exist`);
            } else {
                if (!copies.length) throw new Error(`No Auto-Save copies${file ? ` of ${path.basename(file)}` : ''} in ${folder}`);
                chosen = copies[0].file;
            }
            const opened = await executor.runStructured(OPEN_COPY(chosen));
            if (!opened.ok) return formatErrorResponse(opened.error, 'Recover project');
            return formatResponse({ ...result, opened: opened.result, openedFile: chosen }, 'Recover project', () => false);
        },
    },
];
