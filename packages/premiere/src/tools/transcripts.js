/**
 * Transcripts of source clips: transcribe a clip with Speech to Text, and read
 * a clip's transcript as JSON (to return or to save to a file).
 */
import { writeFileSync } from 'node:fs';
import { formatResponse, formatErrorResponse } from 'adobe-mcp-core';
import { script } from '../script.js';
import { executor, run } from '../executor.js';
import { ITEM_SCHEMA, itemSpec } from '../args.js';
import { checkedPath } from './project.js';

export const tools = [
    {
        name: 'transcribe_clip',
        description: 'Transcribe a clip project item\'s audio with Speech to Text (Premiere Pro 26.5 or later). Needs the language pack Premiere Pro uses; waits until the transcript is done, so raise PREMIERE_SCRIPT_TIMEOUT_MS for long clips',
        inputSchema: { type: 'object', properties: { item: ITEM_SCHEMA }, required: ['item'] },
        auditArgs: { item: { path: 'Footage/Interview.mov' } },
        since: '26.5',
        guarded: ['hasTranscript'],
        features: ['premiere.editing.transcribe', 'premiere.graphics_captions.speech_to_text', 'premiere.ai_features.speech_to_text_ai'],
        handler: (a) => run('Transcribe clip', script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
if (!(await ppro.Transcript.transcribeClipProjectItem(clip))) throw new Error("Premiere Pro did not transcribe " + entry.path + " (check the language pack in Preferences > Media Analysis & Transcription)");
const has = typeof ppro.Transcript.hasTranscript === "function" ? ppro.Transcript.hasTranscript(clip) : true;
return { item: entry.path, transcribed: Boolean(has) };`), { since: '26.5' }),
    },
    {
        name: 'export_transcript',
        description: 'Read a clip project item\'s transcript as JSON (the Text panel\'s transcript, with word timings). Returns it, or writes it to a .json file when outputFile is given',
        inputSchema: {
            type: 'object',
            properties: {
                item: ITEM_SCHEMA,
                outputFile: { type: 'string', description: 'Absolute path of a .json file to write instead of returning the transcript' },
            },
            required: ['item'],
        },
        auditArgs: { item: { path: 'Footage/Interview.mov' }, outputFile: undefined },
        hints: { readOnly: true },
        features: ['premiere.export.export_transcripts', 'premiere.editing.text_panel_transcript', 'premiere.editing.text_based_editing'],
        handler: async (a) => {
            const out = a.outputFile === undefined ? null : checkedPath(a.outputFile, 'outputFile', ['.json']);
            const r = await executor.runStructured(script(`
const project = await __project();
const entry = await __item(project, ${itemSpec(a.item)});
const clip = __clipItem(entry);
const text = await ppro.Transcript.exportToJSON(clip);
if (!text) throw new Error(entry.path + " has no transcript: transcribe it first (transcribe_clip, or Text panel > Transcribe)");
return { item: entry.path, json: text };`));
            if (!r.ok) return formatErrorResponse(r.error, 'Export transcript');
            const { item, json: text } = r.result ?? {};
            if (typeof text !== 'string') return formatErrorResponse('Premiere Pro returned no transcript', 'Export transcript');
            let transcript;
            try { transcript = JSON.parse(text); } catch { transcript = text; }
            if (out) {
                writeFileSync(out, typeof transcript === 'string' ? transcript : `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
                return formatResponse({ item, written: out, bytes: Buffer.byteLength(text) }, 'Export transcript', () => false);
            }
            return formatResponse({ item, transcript }, 'Export transcript', () => false);
        },
    },
];
