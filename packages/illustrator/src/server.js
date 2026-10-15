/**
 * The Illustrator MCP server: tool list, annotations and instructions.
 */
import { readFileSync } from 'node:fs';
import { createMcpServer, createAnnotations } from 'adobe-mcp-core';
import { executor } from './executor.js';
import { tools as documentTools } from './tools/documents.js';
import { tools as artworkTools } from './tools/artwork.js';
import { tools as appearanceTools } from './tools/appearance.js';
import { tools as arrangeTools } from './tools/arrange.js';
import { tools as outputTools } from './tools/output.js';
import { tools as effectTools } from './tools/effects.js';
import { tools as utilityTools, helpTool } from './tools/utility.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Sent to clients at initialize; MCP clients give these to the model.
export const SERVER_INSTRUCTIONS = `Tools drive a running Adobe Illustrator (2023 or later, macOS or Windows) on the user's machine.

Start with illustrator_status if you are unsure Illustrator is reachable. Most tools act on the active document: create_document or open_document first, and get_document_info for its artboards and layers.

Conventions:
- Positions and sizes are points (72 pt = 1 in), measured from the top-left corner of an artboard (artboardIndex, default 0) with y increasing downward. Results report positions the same way.
- Items are chosen with target: { ids: [...] } (ids come from list_items and from every tool that creates artwork), { names: [...] }, or { selection: true }.
- Colours are a swatch name, "#RRGGBB", "rgb(r,g,b)", "cmyk(c,m,y,k)", "gray(g)" or "none". A document's colour mode (CMYK or RGB) is fixed when it is created; colours given in the other model are converted.
- Fonts are PostScript names (list_fonts).
- File paths must be absolute and inside the user's home folder or ILLUSTRATOR_ALLOWED_DIRS.

Illustrator gives no result from menu commands: execute_menu_command reports the selection and document afterwards, and an unknown command name does nothing. A command that opens a dialog waits for the user; if a call times out, a dialog is probably open in Illustrator.

A call that fails returns isError with a message: read it and fix the arguments rather than retrying unchanged. A result with "warnings" names arguments that were ignored. Annotations mark destructive tools (delete_*, close_document, set_text_contents, convert_text_to_outlines, execute_illustrator_code); confirm with the user before using them on unsaved work.

help({ tool }) describes any tool's parameters.`;

const AREAS = [
    ['documents', documentTools],
    ['artwork', artworkTools],
    ['appearance', appearanceTools],
    ['arrange', arrangeTools],
    ['effects', effectTools],
    ['output', outputTools],
    ['utility', utilityTools],
];

/** Every tool with its area, features and handler. */
export const toolTable = AREAS.flatMap(([area, list]) => list.map((t) => ({ ...t, area })));
const help = { ...helpTool(toolTable), area: 'utility' };
toolTable.push(help);

const annotations = createAnnotations({
    readOnly: [
        'help', 'illustrator_status', 'find_menu_commands', 'get_document_info', 'list_documents', 'list_artboards',
        'list_layers', 'list_items', 'get_selection', 'get_appearance', 'list_swatches', 'list_fonts', 'get_preferences',
    ],
    destructive: [
        'close_document', 'delete_artboard', 'delete_layer', 'delete_items', 'set_text_contents',
        'convert_text_to_outlines', 'ungroup_items', 'pathfinder', 'make_compound_path', 'execute_illustrator_code',
        'execute_menu_command', 'save_document', 'set_preferences',
    ],
    idempotent: [
        'save_document', 'set_artboard', 'set_active_artboard', 'set_active_layer', 'set_layer_properties',
        'select_items', 'deselect_all', 'set_fill', 'set_stroke', 'set_opacity', 'set_text_style', 'set_text_contents',
        'arrange_items', 'align_items', 'set_preferences', 'select_tool', 'export_png', 'export_svg', 'export_for_screens', 'export_pdf', 'move_items_to_layer',
    ],
    words: { svg: 'SVG', png: 'PNG', pdf: 'PDF', illustrator: 'Illustrator' },
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
