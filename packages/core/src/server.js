/**
 * The MCP server shell: stdio transport, tools/list, tools/call.
 *
 * A server supplies its tool definitions and a handler per tool name. A call
 * maps deprecated argument names first, collects warnings for unknown
 * arguments, runs the handler, and returns its result as JSON text with
 * isError set when the result reports `success: false`.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createArgNormalizer } from './args.js';
import { formatErrorResponse, withWarnings } from './result.js';

/**
 * @param {object} opts
 * @param {{ name: string, version: string }} opts.info          server name and version (from package.json)
 * @param {string} [opts.instructions]                            sent to clients at initialize
 * @param {Array<object>} opts.tools                              tool definitions (name, description, inputSchema, title, annotations)
 * @param {Record<string, (args: object) => Promise<any>>} opts.handlers  one handler per tool name
 * @param {Array<{ old: string, canonical: string, tools?: string[] }>} [opts.aliases]
 * @param {Function} [opts.normalizeValues]                       see createArgNormalizer
 */
export function createMcpServer({ info, instructions, tools, handlers, aliases = [], normalizeValues }) {
    const missing = tools.map((t) => t.name).filter((n) => typeof handlers[n] !== 'function');
    if (missing.length) throw new Error(`No handler for advertised tool(s): ${missing.join(', ')}`);

    const args = createArgNormalizer({ tools, aliases, normalizeValues });
    const server = new Server(
        { name: info.name, version: info.version },
        { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) }
    );

    /**
     * Run a tool by name. Older parameter names are mapped to the canonical
     * ones first; the result lists deprecated or unknown arguments under `warnings`.
     */
    async function handleToolCall(name, input) {
        const handler = handlers[name];
        if (typeof handler !== 'function') {
            return formatErrorResponse(`Tool '${name}' not found. Use 'help' to see available tools.`, 'Tool Call');
        }
        const warnings = [];
        const normalized = args.normalizeArgs(name, input ?? {}, warnings);
        warnings.push(...args.unknownArgWarnings(name, normalized));
        let result;
        try {
            result = await handler(normalized ?? {});
        } catch (error) {
            if (warnings.length) error.warnings = warnings;
            throw error;
        }
        return withWarnings(result, warnings);
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: input } = request.params;
        try {
            const result = await handleToolCall(name, input);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                isError: result?.success === false,
            };
        } catch (error) {
            const body = { success: false, error: error.message, ...(error.warnings ? { warnings: error.warnings } : {}) };
            return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: true };
        }
    });

    return {
        server,
        tools,
        handleToolCall,
        aliasesFor: args.aliasesFor,
        /** Connect over stdio. Nothing may be written to stdout after this. */
        async run() {
            await server.connect(new StdioServerTransport());
        },
    };
}
