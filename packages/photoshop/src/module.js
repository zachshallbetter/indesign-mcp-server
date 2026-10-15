/**
 * The Photoshop server as a module: what the standalone server (src/index.js)
 * and adobe-mcp-suite build on. Importing it starts nothing.
 */
import { SERVER_INSTRUCTIONS, toolDefinitions, toolTable } from './server.js';
import { executor } from './executor.js';
import { script } from './script.js';
import { paths } from './tools/documents.js';

export const app = {
    id: 'photoshop',
    label: 'Photoshop',
    instructions: SERVER_INSTRUCTIONS,
    tools: toolDefinitions,
    handlers: Object.fromEntries(toolTable.map((t) => [t.name, t.handler])),
    aliases: [],
    normalizeValues: undefined,
    /** Run ExtendScript in Photoshop; resolves with the script's result as a string. */
    runScript: (source) => executor.runScript(source),
    /** Run ExtendScript wrapped for a structured result: { ok, result | error }. */
    runStructured: (source) => executor.runStructured(source),
    /** Resolve and check a path against PHOTOSHOP_ALLOWED_DIRS. */
    validatePath: (filePath) => paths.validate(filePath),
    cleanup: () => executor.cleanupTempScripts(),
};

/** Wrap an ExtendScript body in Photoshop's prelude (dialogs off, pixel units, JSON result). */
export { script, executor, SERVER_INSTRUCTIONS, toolDefinitions, toolTable };
export default app;
