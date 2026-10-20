/**
 * Transparent adapter routing Adobe After Effects MCP tools to EffectCraft
 * over its loopback JSON-lines bridge/control channel (127.0.0.1:9877).
 */
import { createCraftHarness, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/**
 * Handlers implementing After Effects tool signatures over EffectCraft's protocol.
 */
export const handlers = {
    aftereffects_status: async (args) => {
        return harness.getStatus(args);
    },

    get_project_info: async () => {
        try {
            const reply = await client.call('doc_inspect', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'Get project info');
            const doc = reply.result || {};
            return formatResponse({
                name: doc.name || 'Untitled Project',
                items: doc.items?.length || 0,
                compositions: doc.compositions?.length || 0,
                activeComp: doc.activeComp || null,
            }, 'Get project info');
        } catch (err) {
            return formatErrorResponse(err.message, 'Get project info');
        }
    },

    create_composition: async (args) => {
        const params = {
            name: args.name || 'Comp 1',
            width: args.width || 1920,
            height: args.height || 1080,
            pixelAspect: args.pixelAspect || 1.0,
            duration: args.duration || 10.0,
            frameRate: args.frameRate || 30.0,
        };
        try {
            const reply = await client.call('command_run', { id: 'comp.new', params });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Create composition');
            return formatResponse(reply.result || params, 'Create composition');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create composition');
        }
    },

    list_compositions: async () => {
        try {
            const reply = await client.call('doc_inspect', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'List compositions');
            return formatResponse(reply.result?.compositions || [], 'List compositions');
        } catch (err) {
            return formatErrorResponse(err.message, 'List compositions');
        }
    },

    list_layers: async () => {
        try {
            const reply = await client.call('doc_inspect', {});
            if (!reply.ok) return formatErrorResponse(reply.error, 'List layers');
            const activeComp = reply.result?.activeComp;
            return formatResponse(activeComp?.layers || [], 'List layers');
        } catch (err) {
            return formatErrorResponse(err.message, 'List layers');
        }
    },

    add_solid_layer: async (args) => {
        const params = {
            name: args.name || 'Solid',
            width: args.width,
            height: args.height,
            color: args.color || '#000000',
        };
        try {
            const reply = await client.call('command_run', { id: 'solid.new', params });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Add solid layer');
            return formatResponse(reply.result || params, 'Add solid layer');
        } catch (err) {
            return formatErrorResponse(err.message, 'Add solid layer');
        }
    },

    render_frame: async (args) => {
        try {
            const params = {
                time: args.time !== undefined ? args.time : 0,
                max_side: args.maxSide || 1280,
            };
            const reply = await client.call('render_preview', params);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Render frame');
            return formatResponse(reply.result, 'Render frame');
        } catch (err) {
            return formatErrorResponse(err.message, 'Render frame');
        }
    },

    render_queue: async (args) => {
        try {
            const reply = await client.call('command_run', { id: 'renderQueue.render', params: args });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Render queue');
            return formatResponse(reply.result, 'Render queue');
        } catch (err) {
            return formatErrorResponse(err.message, 'Render queue');
        }
    },

    execute_aftereffects_code: async (args) => {
        try {
            let cmdObj;
            try {
                cmdObj = JSON.parse(args.code || args.script);
            } catch {
                return formatErrorResponse('EffectCraft requires structured JSON commands: {"id": "...", "params": {...}}', 'Execute code');
            }
            const reply = await client.call('command_run', cmdObj);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Execute code');
            return formatResponse(reply.result, 'Execute code');
        } catch (err) {
            return formatErrorResponse(err.message, 'Execute code');
        }
    },
};

export const harness = createCraftHarness({
    appName: 'After Effects',
    craftName: 'EffectCraft',
    appPrefix: 'EFFECTCRAFT',
    defaultPort: 9877,
    handlers,
    inspectStatus: async (client, probe) => {
        if (!probe) return null;
        const inspect = await client.call('doc_inspect', {});
        const doc = inspect.result || null;
        return {
            name: doc?.name || null,
            compositions: doc?.compositions?.length || 0,
            activeComp: doc?.activeComp?.name || null,
        };
    },
});

export const client = harness.client;
export const createRoutedHandlers = (adobeHandlers) => harness.createRoutedHandlers(adobeHandlers);
