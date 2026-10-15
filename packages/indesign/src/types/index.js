/**
 * Tool definitions index for InDesign MCP Server
 * Central import and export of all tool definitions
 */

import { pageToolDefinitions } from './toolDefinitionsPage.js';
import { contentToolDefinitions } from './toolDefinitionsContent.js';
import { documentToolDefinitions } from './toolDefinitionsDocument.js';
import { exportToolDefinitions } from './toolDefinitionsExport.js';
import { bookToolDefinitions } from './toolDefinitionsBook.js';
import { utilityToolDefinitions } from './toolDefinitionsUtility.js';
import { pageItemGroupToolDefinitions } from './toolDefinitionsPageItemGroup.js';
import { masterSpreadToolDefinitions } from './toolDefinitionsMasterSpread.js';
import { spreadToolDefinitions } from './toolDefinitionsSpread.js';
import { layerToolDefinitions } from './toolDefinitionsLayer.js';

import { annotationsFor } from './annotations.js';
import { moduleTools } from '../tools/index.js';

// Combine all tool definitions into a single array; every tool gets a title
// and MCP annotations (see annotations.js).
export const allToolDefinitions = [
    ...pageToolDefinitions,
    ...contentToolDefinitions,
    ...documentToolDefinitions,
    ...exportToolDefinitions,
    ...bookToolDefinitions,
    ...utilityToolDefinitions,
    ...pageItemGroupToolDefinitions,
    ...masterSpreadToolDefinitions,
    ...spreadToolDefinitions,
    ...layerToolDefinitions,
    ...moduleTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
].map((tool) => ({ ...tool, title: tool.title ?? annotationsFor(tool.name).title, annotations: annotationsFor(tool.name) }));

// Export individual modules for specific use cases
export { pageToolDefinitions } from './toolDefinitionsPage.js';
export { contentToolDefinitions } from './toolDefinitionsContent.js';
export { documentToolDefinitions } from './toolDefinitionsDocument.js';
export { exportToolDefinitions } from './toolDefinitionsExport.js';
export { bookToolDefinitions } from './toolDefinitionsBook.js';
export { utilityToolDefinitions } from './toolDefinitionsUtility.js';
export { pageItemGroupToolDefinitions } from './toolDefinitionsPageItemGroup.js';
export { masterSpreadToolDefinitions } from './toolDefinitionsMasterSpread.js';
export { spreadToolDefinitions } from './toolDefinitionsSpread.js';
export { layerToolDefinitions } from './toolDefinitionsLayer.js'; 