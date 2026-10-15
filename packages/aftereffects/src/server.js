/**
 * The After Effects MCP server: tool list, annotations and instructions.
 */
import { readFileSync } from 'node:fs';
import { createMcpServer, createAnnotations } from 'adobe-mcp-core';
import { executor } from './executor.js';
import { tools as projectTools } from './tools/project.js';
import { tools as compTools } from './tools/comps.js';
import { tools as layerTools } from './tools/layers.js';
import { tools as layerEditTools } from './tools/layer-edits.js';
import { tools as compEditTools } from './tools/comp-edits.js';
import { tools as timeTools } from './tools/time.js';
import { tools as animationTools } from './tools/animation.js';
import { tools as effectTools } from './tools/effects.js';
import { tools as textTools } from './tools/text.js';
import { tools as maskTools } from './tools/masks.js';
import { tools as renderTools } from './tools/render.js';
import { tools as threeDTools } from './tools/threed.js';
import { tools as trackingTools } from './tools/tracking.js';
import { tools as colorTools } from './tools/color.js';
import { tools as utilityTools, helpTool } from './tools/utility.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Sent to clients at initialize; MCP clients give these to the model.
export const SERVER_INSTRUCTIONS = `Tools drive a running Adobe After Effects (2023 or later, macOS or Windows) on the user's machine.

Start with aftereffects_status if you are unsure After Effects is reachable. get_project_info and list_items describe the project; list_layers describes a composition.

Conventions:
- Compositions are chosen with comp: { id } (item ids come from list_items), { name }, or omitted for the active composition.
- Layers are chosen with layers: { indexes: [...] } (1 = top, as in the Timeline), { names: [...] }, or { selected: true }.
- Properties are a shortcut (position, scale, rotation, opacity, anchor_point, source_text, ...) or a path of match names or names, e.g. ["ADBE Effect Parade", "Gaussian Blur", "Blurriness"].
- Positions are pixels from the composition's top-left; times are seconds; colours are "#RRGGBB" or "rgb(r,g,b)".
- File paths must be absolute and inside the user's home folder or AFTEREFFECTS_ALLOWED_DIRS.

Each call is one undo step in After Effects, and dialogs are suppressed while it runs. A call that fails returns isError with a message: read it and fix the arguments rather than retrying unchanged. Annotations mark destructive tools (delete_layers, manage_items, open_project, execute_aftereffects_code); confirm with the user before using them on unsaved work. render_queue blocks until rendering finishes.

help({ tool }) describes any tool's parameters.`;

const AREAS = [
    ['project', projectTools],
    ['compositions', compTools],
    ['compositions', compEditTools],
    ['layers', layerTools],
    ['layers', layerEditTools],
    ['time', timeTools],
    ['animation', animationTools],
    ['effects', effectTools],
    ['text', textTools],
    ['masks', maskTools],
    ['render', renderTools],
    ['three_d', threeDTools],
    ['tracking', trackingTools],
    ['color', colorTools],
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
    words: { png: 'PNG', aftereffects: 'After Effects' },
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
