/**
 * Transparent adapter routing Adobe Illustrator MCP tools to VectorCraft
 * over its loopback JSON-lines control channel (127.0.0.1:7979).
 */
import { createCraftHarness, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/**
 * Handlers implementing Illustrator tool signatures over VectorCraft's control protocol.
 */
export const handlers = {
    illustrator_status: async (args) => {
        return harness.getStatus(args);
    },

    create_document: async (args) => {
        const params = {
            width: args.width || 800,
            height: args.height || 600,
            name: args.title || 'Untitled',
            colorMode: (args.colorMode || 'rgb').toLowerCase(),
        };
        try {
            await client.execute('file.new', params);
            return formatResponse(params, 'Create document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create document');
        }
    },

    open_document: async (args) => {
        try {
            const reply = await client.call('file.open', { path: args.path });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Open document');
            return formatResponse(reply.result, 'Open document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Open document');
        }
    },

    save_document: async (args) => {
        try {
            const reply = await client.call('file.save', args.path ? { path: args.path } : {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Save document');
            return formatResponse(reply.result, 'Save document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Save document');
        }
    },

    close_document: async () => {
        try {
            await client.execute('file.close', {});
            return formatResponse({ closed: true }, 'Close document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Close document');
        }
    },

    get_document_info: async () => {
        try {
            const inspect = await client.call('doc_inspect', {});
            const doc = inspect.result;
            if (!doc) return formatErrorResponse('No document open in VectorCraft', 'Document info');
            return formatResponse({
                name: doc.name || 'Active Document',
                width: doc.width,
                height: doc.height,
                artboards: doc.artboards || [{ index: 0, width: doc.width, height: doc.height }],
                layerCount: doc.layers?.length || 0,
            }, 'Document info');
        } catch (err) {
            return formatErrorResponse(err.message, 'Document info');
        }
    },

    list_layers: async () => {
        try {
            const inspect = await client.call('doc_inspect', {});
            const doc = inspect.result;
            if (!doc) return formatErrorResponse('No document open in VectorCraft', 'List layers');
            const layers = (doc.layers || []).map((l, i) => ({
                id: l.id ?? i + 1,
                name: l.name || `Layer ${i + 1}`,
                visible: l.visible !== false,
                locked: Boolean(l.locked),
            }));
            return formatResponse({ layers }, 'List layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'List layers');
        }
    },

    create_rectangle: async (args) => {
        try {
            const params = {
                x: args.x || 0,
                y: args.y || 0,
                width: args.width,
                height: args.height,
                ...(args.cornerRadius ? { cornerRadius: args.cornerRadius } : {}),
            };
            const result = await client.execute('shape.rectangle', params);
            return formatResponse(result, 'Create rectangle');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create rectangle');
        }
    },

    create_ellipse: async (args) => {
        try {
            const params = {
                x: args.x || 0,
                y: args.y || 0,
                width: args.width,
                height: args.height,
            };
            const result = await client.execute('shape.ellipse', params);
            return formatResponse(result, 'Create ellipse');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create ellipse');
        }
    },

    export_document: async (args) => {
        try {
            const params = {
                path: args.path,
                format: (args.format || 'svg').toLowerCase(),
            };
            const reply = await client.call('app.export', params);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Export document');
            return formatResponse(reply.result, 'Export document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Export document');
        }
    },

    undo: async () => {
        try {
            await client.call('undo', {});
            return formatResponse({ undone: true }, 'Undo');
        } catch (err) {
            return formatErrorResponse(err.message, 'Undo');
        }
    },

    redo: async () => {
        try {
            await client.call('redo', {});
            return formatResponse({ redone: true }, 'Redo');
        } catch (err) {
            return formatErrorResponse(err.message, 'Redo');
        }
    },

    take_screenshot: async () => {
        try {
            const reply = await client.call('ui_screenshot', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Take screenshot');
            return formatResponse(reply.result, 'Take screenshot');
        } catch (err) {
            return formatErrorResponse(err.message, 'Take screenshot');
        }
    },
};

export const harness = createCraftHarness({
    appName: 'Illustrator',
    craftName: 'VectorCraft',
    appPrefix: 'VECTORCRAFT',
    defaultPort: 7979,
    handlers,
    inspectStatus: async (client, probe) => {
        if (!probe) return null;
        const inspect = await client.call('doc_inspect', {});
        const doc = inspect.result || null;
        return {
            activeDocument: doc?.name || (doc ? 'Active Document' : null),
            documents: doc ? 1 : 0,
            artboards: doc?.artboards?.length || (doc ? 1 : 0),
            layerCount: doc?.layers?.length || 0,
        };
    },
});

export const client = harness.client;
export const createRoutedHandlers = (adobeHandlers) => harness.createRoutedHandlers(adobeHandlers);
