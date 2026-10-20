/**
 * Transparent adapter routing Adobe InDesign MCP tools to DesignCraft
 * over its loopback JSON-lines control channel (127.0.0.1:7979 or configurable).
 */
import { createCraftHarness, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/**
 * Handlers implementing InDesign tool signatures over DesignCraft's control protocol.
 */
export const handlers = {
    indesign_status: async (args) => {
        return harness.getStatus(args);
    },

    create_document: async (args) => {
        const params = {
            width: args.pageWidth || args.width || 210,
            height: args.pageHeight || args.height || 297,
            pages: args.pages || args.pageCount || 1,
            facingPages: args.facingPages !== undefined ? Boolean(args.facingPages) : false,
            margins: args.margins ? {
                top: args.margins.top || 12.7,
                bottom: args.margins.bottom || 12.7,
                left: args.margins.left || args.margins.inside || 12.7,
                right: args.margins.right || args.margins.outside || 12.7,
            } : undefined,
        };
        try {
            const reply = await client.call('new_document', params);
            if (!reply.ok) return formatErrorResponse(reply.error || 'Failed to create document', 'Create document');
            return formatResponse(reply.result || params, 'Create document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create document');
        }
    },

    open_document: async (args) => {
        try {
            const reply = await client.call('open_document', { path: args.filePath || args.path });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Open document');
            return formatResponse(reply.result, 'Open document');
        } catch (err) {
            return formatErrorResponse(err.message, 'Open document');
        }
    },

    save_document: async (args) => {
        try {
            const reply = await client.call('save_document', args.filePath || args.path ? { path: args.filePath || args.path } : {});
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
            const reply = await client.call('inspect_document', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Get document info');
            const doc = reply.result || {};
            return formatResponse({
                name: doc.title || 'Untitled',
                pages: doc.pages?.length || 1,
                spreads: doc.spreads?.length || 1,
                layers: doc.layers || [],
                swatches: doc.swatches || [],
                styles: doc.styles || {},
                stories: doc.stories?.length || 0,
            }, 'Get document info');
        } catch (err) {
            return formatErrorResponse(err.message, 'Get document info');
        }
    },

    get_document_stories: async () => {
        try {
            const reply = await client.call('inspect_document', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Get document stories');
            return formatResponse({ stories: reply.result?.stories || [] }, 'Get document stories');
        } catch (err) {
            return formatErrorResponse(err.message, 'Get document stories');
        }
    },

    get_document_styles: async () => {
        try {
            const reply = await client.call('inspect_document', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Get document styles');
            return formatResponse({ styles: reply.result?.styles || {} }, 'Get document styles');
        } catch (err) {
            return formatErrorResponse(err.message, 'Get document styles');
        }
    },

    get_document_colors: async () => {
        try {
            const reply = await client.call('inspect_document', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Get document colors');
            return formatResponse({ swatches: reply.result?.swatches || [] }, 'Get document colors');
        } catch (err) {
            return formatErrorResponse(err.message, 'Get document colors');
        }
    },

    place_image: async (args) => {
        try {
            const params = {
                path: args.filePath || args.path,
                frame: args.frameId || args.frameIndex,
                x: args.x,
                y: args.y,
                width: args.width,
            };
            const reply = await client.call('place_image', params);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Place image');
            return formatResponse(reply.result, 'Place image');
        } catch (err) {
            return formatErrorResponse(err.message, 'Place image');
        }
    },

    export_pdf: async (args) => {
        try {
            const params = {
                path: args.outputPath || args.path,
                preset: args.preset,
            };
            const reply = await client.call('file.exportPdf', params);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Export PDF');
            return formatResponse(reply.result, 'Export PDF');
        } catch (err) {
            return formatErrorResponse(err.message, 'Export PDF');
        }
    },

    view_document: async (args) => {
        try {
            const reply = await client.call('export_png', { page: args?.pageIndex || 0 });
            if (!reply.ok) return formatErrorResponse(reply.error, 'View document');
            return formatResponse(reply.result, 'View document');
        } catch (err) {
            return formatErrorResponse(err.message, 'View document');
        }
    },

    execute_indesign_code: async (args) => {
        try {
            // When routed to DesignCraft, execute as an engine command or batch if JSON
            let cmdObj;
            try {
                cmdObj = JSON.parse(args.code || args.script);
            } catch {
                return formatErrorResponse('DesignCraft requires structured JSON commands: {"command": "...", "params": {...}}', 'Execute code');
            }
            const reply = await client.call('execute', cmdObj);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Execute code');
            return formatResponse(reply.result, 'Execute code');
        } catch (err) {
            return formatErrorResponse(err.message, 'Execute code');
        }
    },
};

export const harness = createCraftHarness({
    appName: 'InDesign',
    craftName: 'DesignCraft',
    appPrefix: 'DESIGNCRAFT',
    defaultPort: 7979,
    handlers,
    inspectStatus: async (client, probe) => {
        if (!probe) return null;
        const inspect = await client.call('inspect_document', {});
        const doc = inspect.result || null;
        return {
            title: doc?.title || null,
            pages: doc?.pages?.length || 0,
            spreads: doc?.spreads?.length || 0,
            layers: doc?.layers?.length || 0,
        };
    },
});

export const client = harness.client;
export const createRoutedHandlers = (adobeHandlers) => harness.createRoutedHandlers(adobeHandlers);
