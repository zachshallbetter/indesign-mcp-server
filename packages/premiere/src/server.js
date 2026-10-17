/**
 * The Premiere Pro MCP server: tool list, annotations and instructions.
 */
import { readFileSync } from 'node:fs';
import { createMcpServer, createAnnotations } from 'adobe-mcp-core';
import { executor } from './executor.js';
import { tools as projectTools } from './tools/project.js';
import { tools as mediaTools } from './tools/media.js';
import { tools as sequenceTools } from './tools/sequences.js';
import { tools as timelineTools } from './tools/timeline.js';
import { tools as markerTools } from './tools/markers.js';
import { tools as sourceTools } from './tools/source.js';
import { tools as effectTools, audioTools } from './tools/effects.js';
import { tools as transcriptTools } from './tools/transcripts.js';
import { tools as exportTools } from './tools/export.js';
import { tools as metadataTools } from './tools/metadata.js';
import { tools as applicationTools } from './tools/application.js';
import { tools as utilityTools, helpTool } from './tools/utility.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Sent to clients at initialize; MCP clients give these to the model.
export const SERVER_INSTRUCTIONS = `Tools drive a running Adobe Premiere Pro (25.6 or later, macOS or Windows) through a plugin inside Premiere Pro that connects to this server.

Start with premiere_status if you are unsure Premiere Pro is connected. get_project_info and list_project_items describe the project; list_sequences, list_tracks and list_clips describe the edit.

Conventions:
- Sequences are chosen with sequence: { name } or { guid } (from list_sequences), or omitted for the active sequence.
- Project items are chosen with item: { id } (from list_project_items), { path: "Bin/Sub/clip.mov" }, or { name } when the name is unique.
- Clips in a sequence are chosen with clip: { track: "video" | "audio", trackIndex, clipIndex } as list_clips reports them (all from 0; trackIndex 0 = V1 or A1), or clips: { items: [...], selected: true } for several.
- Effects and parameters are chosen by component index and parameter name from list_clip_effects.
- Times are seconds. File paths must be absolute and inside the user's home folder or PREMIERE_ALLOWED_DIRS.

Each call that changes the project is one undo step in Premiere Pro unless its description says otherwise. A call that fails returns isError with a message: read it and fix the arguments rather than retrying unchanged. Indexes shift after edits; list again before the next edit. Annotations mark destructive tools (remove_clips, delete_sequence, manage_items, close_project, execute_premiere_code, ...); confirm with the user before using them on unsaved work. Some tools need a newer Premiere Pro than 25.6; their descriptions say which.

help({ tool }) describes any tool's parameters.`;

const AREAS = [
    ['project', projectTools],
    ['media', mediaTools],
    ['sequences', sequenceTools],
    ['timeline', timelineTools],
    ['markers', markerTools],
    ['source', sourceTools],
    ['effects', effectTools],
    ['audio', audioTools],
    ['transcripts', transcriptTools],
    ['export', exportTools],
    ['metadata', metadataTools],
    ['application', applicationTools],
    ['utility', utilityTools],
];

/** Every tool with its area, features and handler. */
export const toolTable = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));
toolTable.push({ ...helpTool(toolTable), area: 'utility' });

/** Each tool declares its own hints: { readOnly, destructive, idempotent, openWorld }. */
const hinted = (kind) => toolTable.filter((t) => t.hints?.[kind]).map((t) => t.name);

const annotations = createAnnotations({
    readOnly: hinted('readOnly'),
    destructive: hinted('destructive'),
    idempotent: hinted('idempotent'),
    openWorld: hinted('openWorld'),
    words: { mogrt: 'Motion Graphics Template', xmp: 'XMP' },
});

/** Tool definitions as advertised: name, description, schema, title, annotations. */
export const toolDefinitions = annotations.annotate(
    toolTable.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
);

export { annotations };

export function createServer() {
    const mcp = createMcpServer({
        info: { name: pkg.name, version: pkg.version },
        instructions: SERVER_INSTRUCTIONS,
        tools: toolDefinitions,
        handlers: Object.fromEntries(toolTable.map((t) => [t.name, t.handler])),
    });
    return {
        ...mcp,
        /** Connect over stdio, then listen for the plugin. */
        async run() {
            await mcp.run();
            try {
                await executor.start();
            } catch (error) {
                // Reported again by every call and by premiere_status; the MCP connection stays up.
                process.stderr.write(`[premiere] ${error.message}\n`);
            }
        },
    };
}
