/**
 * The Photoshop MCP server: tool list, annotations and instructions.
 */
import { readFileSync } from 'node:fs';
import { createMcpServer, createAnnotations } from 'adobe-mcp-core';
import { executor } from './executor.js';
import { tools as documentTools } from './tools/documents.js';
import { tools as imageTools } from './tools/image.js';
import { tools as layerTools } from './tools/layers.js';
import { tools as maskTools } from './tools/masks.js';
import { tools as smartObjectTools } from './tools/smart-objects.js';
import { tools as layerStyleTools } from './tools/layer-styles.js';
import { tools as selectionTools } from './tools/selection.js';
import { tools as channelTools } from './tools/channels.js';
import { tools as transformTools } from './tools/transform.js';
import { tools as analysisTools } from './tools/analysis.js';
import { tools as adjustTools } from './tools/adjust.js';
import { tools as filterTools } from './tools/filters.js';
import { tools as paintTools } from './tools/paint.js';
import { tools as textTools } from './tools/text.js';
import { tools as vectorTools } from './tools/vector.js';
import { tools as exportTools } from './tools/export.js';
import { tools as historyTools } from './tools/history.js';
import { tools as videoTools } from './tools/video.js';
import { tools as automationTools } from './tools/automation.js';
import { tools as artboardTools } from './tools/artboards.js';
import { tools as fileTools } from './tools/files.js';
import { tools as printTools } from './tools/print.js';
import { tools as applicationTools } from './tools/application.js';
import { tools as interfaceTools } from './tools/interface.js';
import { tools as cameraRawTools } from './tools/cameraraw.js';
import { tools as generativeTools } from './tools/generative.js';
import { tools as utilityTools, helpTool } from './tools/utility.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Sent to clients at initialize; MCP clients give these to the model.
export const SERVER_INSTRUCTIONS = `Tools drive a running Adobe Photoshop (2023 or later, macOS or Windows) on the user's machine.

Start with photoshop_status if you are unsure Photoshop is reachable. Most tools act on the active document: create_document or open_document first, and get_document_info and list_layers to see it.

Conventions:
- Positions and sizes are pixels, measured from the document's top-left corner with y increasing downward.
- Layers are chosen with target: { ids: [...] } (ids come from list_layers and from every tool that creates a layer), { names: [...] }, or { active: true }.
- Colours are "#RRGGBB", "rgb(r,g,b)", "cmyk(c,m,y,k)", "gray(g)", "hsb(h,s,b)" or "lab(L,a,b)".
- Adjustments, filters, fills and strokes work on pixel layers, inside the selection when there is one.
- Timeline times are { seconds, frames } at the timeline's frame rate (get_timeline).
- Fonts are PostScript names (list_fonts).
- File paths must be absolute and inside the user's home folder or PHOTOSHOP_ALLOWED_DIRS.

Every script runs with Photoshop's dialogs off and in pixel units, and restores the user's settings afterwards. A call that fails returns isError with a message: read it and fix the arguments rather than retrying unchanged. Annotations mark destructive tools (delete_layers, flatten_image, crop_image, close_document, quit_photoshop, purge_photoshop_caches, execute_photoshop_code); confirm with the user before using them on unsaved work. undo steps back through the history.

Generative tools (generative_fill, generate_image, harmonize_layer) need Photoshop signed in to an Adobe account and an internet connection, and use generative credits.

help({ tool }) describes any tool's parameters.`;

const AREAS = [
    ['documents', documentTools],
    ['image', imageTools],
    ['layers', layerTools],
    ['masks', maskTools],
    ['smart objects', smartObjectTools],
    ['layer styles', layerStyleTools],
    ['selection', selectionTools],
    ['channels', channelTools],
    ['transformations', transformTools],
    ['analysis', analysisTools],
    ['adjustments', adjustTools],
    ['filters', filterTools],
    ['painting', paintTools],
    ['type', textTools],
    ['vector', vectorTools],
    ['export', exportTools],
    ['history', historyTools],
    ['video', videoTools],
    ['automation', automationTools],
    ['artboards', artboardTools],
    ['files', fileTools],
    ['print', printTools],
    ['application', applicationTools],
    ['interface', interfaceTools],
    ['camera raw', cameraRawTools],
    ['generative', generativeTools],
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
    words: { png: 'PNG', jpeg: 'JPEG', pdf: 'PDF', photoshop: 'Photoshop' },
});

/** Tool definitions as advertised: name, description, schema, title, annotations. */
export const toolDefinitions = annotations.annotate(
    toolTable.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
);

export { annotations };

export function createServer() {
    executor.cleanupTempScripts();
    return createMcpServer({
        info: { name: pkg.name, version: pkg.version },
        instructions: SERVER_INSTRUCTIONS,
        tools: toolDefinitions,
        handlers: Object.fromEntries(toolTable.map((t) => [t.name, t.handler])),
    });
}
