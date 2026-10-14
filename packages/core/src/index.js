/**
 * Shared foundation for MCP servers that drive desktop Adobe applications
 * through ExtendScript: script escaping, file path policy, structured results,
 * argument aliases, tool annotations, the script executor and the server shell.
 *
 * Application-specific code (tool definitions, handlers, enum lists, how the
 * application is told to run a script file) stays in each server.
 */
export { str, num, index, bool, enumOf, json, numList, measure } from './jsx.js';
export { buildAllowedDirs, validateFilePath, jsxPath, createPathPolicy } from './paths.js';
export { autoCaptureResult, wrapScriptForStructuredResult, parseStructuredResult } from './structured.js';
export { createFailureDetector, looksLikeFailure, formatResponse, formatErrorResponse, withWarnings } from './result.js';
export { createArgNormalizer, distance } from './args.js';
export { createAnnotations } from './annotations.js';
export { createExecutor, runProcess, appleScriptString, powerShellString } from './executor.js';
export { createMcpServer } from './server.js';
