/**
 * The Illustrator server as a module: what the standalone server (src/index.js)
 * and adobe-mcp-suite build on. Importing it starts nothing.
 */
import { SERVER_INSTRUCTIONS, toolDefinitions, toolTable, createRoutedHandlers } from './server.js';
import { executor } from './executor.js';
import { script } from './script.js';
import { paths } from './tools/documents.js';

export const app = {
    id: 'illustrator',
    label: 'Illustrator',
    instructions: SERVER_INSTRUCTIONS,
    tools: toolDefinitions,
    handlers: createRoutedHandlers(toolTable),
    aliases: [],
    normalizeValues: undefined,
    /** Run ExtendScript in Illustrator; resolves with the script's result as a string. */
    runScript: (source) => executor.runScript(source),
    /** Run ExtendScript wrapped for a structured result: { ok, result | error }. */
    runStructured: (source) => executor.runStructured(source),
    /** Resolve and check a path against ILLUSTRATOR_ALLOWED_DIRS. */
    validatePath: (filePath) => paths.validate(filePath),
    cleanup: () => executor.cleanupTempScripts(),
};

/** Wrap an ExtendScript body in Illustrator's prelude (alerts off, document coordinates, JSON result). */
export { script, executor, SERVER_INSTRUCTIONS, toolDefinitions, toolTable };
export default app;
