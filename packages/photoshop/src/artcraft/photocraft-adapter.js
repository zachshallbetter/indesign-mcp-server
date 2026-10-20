/**
 * Transparent adapter routing Adobe Photoshop MCP tools to PhotoCraft
 * over its loopback JSON-lines control channel (127.0.0.1:7878).
 */
import { createCraftHarness, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/**
 * Handlers implementing Photoshop tool signatures over PhotoCraft's control protocol.
 */
export const handlers = {
    photoshop_status: async (args) => {
        return harness.getStatus(args);
    },

    create_document: async (args) => {
        const params = {
            width: args.width,
            height: args.height,
            resolution: args.resolution || 72,
            mode: (args.mode || 'rgb').toLowerCase(),
            depth: args.depth || 8,
            background: args.fill || 'white',
            name: args.name || 'Untitled',
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
            const reply = await client.call('app.open', { path: args.path });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Open document');
            return formatResponse(reply.result, 'Open document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Open document');
        }
    },

    save_document: async (args) => {
        try {
            const reply = await client.call('app.save', args.path ? { path: args.path } : {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Save document');
            return formatResponse(reply.result, 'Save document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Save document');
        }
    },

    close_document: async (args) => {
        try {
            await client.execute('file.close', {});
            return formatResponse({ closed: true }, 'Close document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Close document');
        }
    },

    get_document_info: async () => {
        try {
            const inspect = await client.call('ui.inspect', {});
            const doc = inspect.result?.document;
            if (!doc) return formatErrorResponse('No document open in PhotoCraft', 'Document info');
            return formatResponse({
                name: doc.name,
                width: doc.width,
                height: doc.height,
                resolution: doc.resolution,
                colorMode: doc.colorMode,
                layerCount: doc.layers?.length || 0,
            }, 'Document info');
        } catch (err) {
            return formatErrorResponse(err.message, 'Document info');
        }
    },

    list_layers: async () => {
        try {
            const inspect = await client.call('ui.inspect', {});
            const doc = inspect.result?.document;
            if (!doc) return formatErrorResponse('No document open in PhotoCraft', 'List layers');
            const layers = (doc.layers || []).map((l, i) => ({
                id: l.id ?? i + 1,
                name: l.name || `Layer ${i + 1}`,
                visible: l.visible !== false,
                opacity: l.opacity ?? 100,
                kind: l.kind || 'normal',
            }));
            return formatResponse({ layers }, 'List layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'List layers');
        }
    },

    resize_image: async (args) => {
        try {
            const params = {
                width: args.width,
                height: args.height,
                resolution: args.resolution,
                resample: args.resampleMethod || 'bicubic',
            };
            const result = await client.execute('image.imageSize', params);
            return formatResponse(result, 'Resize image');
        } catch (err) {
            return formatErrorResponse(err.message, 'Resize image');
        }
    },

    resize_canvas: async (args) => {
        try {
            const params = {
                width: args.width,
                height: args.height,
                relative: Boolean(args.relative),
                anchor: args.anchor || 'center',
            };
            const result = await client.execute('image.canvasSize', params);
            return formatResponse(result, 'Resize canvas');
        } catch (err) {
            return formatErrorResponse(err.message, 'Resize canvas');
        }
    },

    crop_image: async (args) => {
        try {
            const [left, top, right, bottom] = args.bounds || [0, 0, 100, 100];
            const params = {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            };
            const result = await client.execute('image.crop', params);
            return formatResponse(result, 'Crop image');
        } catch (err) {
            return formatErrorResponse(err.message, 'Crop image');
        }
    },

    duplicate_document: async (args) => {
        try {
            const result = await client.execute('image.duplicate', { name: args.name || 'Copy' });
            return formatResponse(result, 'Duplicate document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Duplicate document');
        }
    },

    undo: async () => {
        try {
            await client.execute('history.undo', {});
            return formatResponse({ undone: true }, 'Undo');
        } catch (err) {
            return formatErrorResponse(err.message, 'Undo');
        }
    },

    redo: async () => {
        try {
            await client.execute('history.redo', {});
            return formatResponse({ redone: true }, 'Redo');
        } catch (err) {
            return formatErrorResponse(err.message, 'Redo');
        }
    },

    take_screenshot: async (args) => {
        try {
            const reply = await client.call('ui.screenshot', args?.path ? { path: args.path } : {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Take screenshot');
            return formatResponse(reply.result, 'Take screenshot');
        } catch (err) {
            return formatErrorResponse(err.message, 'Take screenshot');
        }
    },

    select_all: async () => {
        try {
            await client.execute('select.all', {});
            return formatResponse({ selected: 'all' }, 'Select all');
        } catch (err) {
            return formatErrorResponse(err.message, 'Select all');
        }
    },

    deselect: async () => {
        try {
            await client.execute('select.deselect', {});
            return formatResponse({ deselected: true }, 'Deselect');
        } catch (err) {
            return formatErrorResponse(err.message, 'Deselect');
        }
    },

    invert_selection: async () => {
        try {
            await client.execute('select.invert', {});
            return formatResponse({ inverted: true }, 'Invert selection');
        } catch (err) {
            return formatErrorResponse(err.message, 'Invert selection');
        }
    },

    flatten_image: async () => {
        try {
            await client.execute('layer.flatten', {});
            return formatResponse({ flattened: true }, 'Flatten image');
        } catch (err) {
            return formatErrorResponse(err.message, 'Flatten image');
        }
    },

    delete_layers: async () => {
        try {
            await client.execute('layer.delete', {});
            return formatResponse({ deleted: true }, 'Delete layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'Delete layers');
        }
    },

    duplicate_layers: async () => {
        try {
            await client.execute('layer.duplicate', {});
            return formatResponse({ duplicated: true }, 'Duplicate layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'Duplicate layers');
        }
    },

    merge_layers: async () => {
        try {
            await client.execute('layer.merge', {});
            return formatResponse({ merged: true }, 'Merge layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'Merge layers');
        }
    },
};

export const harness = createCraftHarness({
    appName: 'Photoshop',
    craftName: 'PhotoCraft',
    appPrefix: 'PHOTOCRAFT',
    defaultPort: 7878,
    handlers,
    inspectStatus: async (client, probe) => {
        if (!probe) return null;
        const inspect = await client.call('ui.inspect', {});
        const doc = inspect.result?.document || null;
        return {
            activeDocument: doc?.name || null,
            documents: doc ? 1 : 0,
            width: doc?.width,
            height: doc?.height,
            zoom: inspect.result?.view?.zoom,
            tool: inspect.result?.tool,
        };
    },
});

export const client = harness.client;
export const createRoutedHandlers = (adobeHandlers) => harness.createRoutedHandlers(adobeHandlers);
