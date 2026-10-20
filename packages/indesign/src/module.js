/**
 * The InDesign server as a module: what the standalone server (src/index.js)
 * and adobe-mcp-suite build on. Importing it starts nothing.
 */
import { allToolDefinitions } from './types/index.js';
import { SERVER_INSTRUCTIONS, TOOL_HANDLERS } from './core/InDesignMCPServer.js';
import { PARAM_ALIASES, normalizeValues } from './handlers/aliases.js';
import { ScriptExecutor } from './core/scriptExecutor.js';
import { validateFilePath } from './utils/jsxSafe.js';
import { createRoutedHandlers, handlers as designcraftHandlers } from './artcraft/designcraft-adapter.js';

export const app = {
    id: 'indesign',
    label: 'InDesign',
    instructions: SERVER_INSTRUCTIONS,
    tools: allToolDefinitions,
    handlers: createRoutedHandlers(TOOL_HANDLERS),
    aliases: PARAM_ALIASES,
    normalizeValues,
    /** Run ExtendScript in InDesign; resolves with the script's result as a string. */
    runScript: (source) => ScriptExecutor.executeInDesignScript(source),
    /** Run ExtendScript wrapped for a structured result: { ok, result | error }. */
    runStructured: (source) => ScriptExecutor.executeInDesignScriptStructured(source),
    /** Resolve and check a path against INDESIGN_ALLOWED_DIRS. */
    validatePath: (filePath) => validateFilePath(filePath),
    cleanup: () => ScriptExecutor.cleanupTempScripts(),
};

export { ScriptExecutor, SERVER_INSTRUCTIONS, TOOL_HANDLERS, allToolDefinitions, createRoutedHandlers, designcraftHandlers };
export default app;
