/**
 * The Premiere Pro server as a module: what the standalone server
 * (src/index.js) and adobe-mcp-suite build on. Importing it starts nothing:
 * the plugin connection opens with the standalone server, or on the first
 * Premiere Pro call inside the suite.
 */
import { SERVER_INSTRUCTIONS, toolDefinitions, toolTable } from './server.js';
import { executor, PLUGIN_DIR } from './executor.js';
import { script } from './script.js';
import { paths } from './tools/project.js';

export const app = {
    id: 'premiere',
    label: 'Premiere Pro',
    instructions: SERVER_INSTRUCTIONS,
    tools: toolDefinitions,
    handlers: Object.fromEntries(toolTable.map((t) => [t.name, t.handler])),
    aliases: [],
    normalizeValues: undefined,
    /** Run UXP JavaScript (an async function body with ppro and transact in scope); resolves { ok, result | error }. */
    runScript: (source) => executor.runScript(source),
    /** The same, normalised to { ok, result | error }. */
    runStructured: (source) => executor.runStructured(source),
    /** Resolve and check a path against PREMIERE_ALLOWED_DIRS. */
    validatePath: (filePath) => paths.validate(filePath),
    cleanup: () => executor.cleanupTempScripts(),
};

/** Wrap a tool body in the helpers every script runs with. */
export { script, executor, PLUGIN_DIR, SERVER_INSTRUCTIONS, toolDefinitions, toolTable };
export default app;
