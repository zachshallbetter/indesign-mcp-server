/**
 * Transparent adapter routing Adobe Premiere Pro MCP tools to FilmCraft
 * over its loopback JSON-lines bridge/control channel (127.0.0.1:9876).
 */
import { createCraftHarness, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/**
 * Handlers implementing Premiere Pro tool signatures over FilmCraft's protocol.
 */
export const handlers = {
    premiere_status: async (args) => {
        return harness.getStatus(args);
    },

    create_sequence: async (args) => {
        const params = {
            name: args.name || 'Sequence 01',
            preset: args.presetPath || args.preset,
            width: args.frameWidth,
            height: args.frameHeight,
            timebase: args.timebase,
        };
        try {
            const reply = await client.call('command_run', { id: 'sequence.new', params });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Create sequence');
            return formatResponse(reply.result || params, 'Create sequence');
        } catch (err) {
            return formatErrorResponse(err.message, 'Create sequence');
        }
    },

    import_media: async (args) => {
        try {
            const files = args.filePaths || (args.filePath ? [args.filePath] : []);
            const reply = await client.call('command_run', { id: 'file.import', params: { paths: files } });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Import media');
            return formatResponse(reply.result || { imported: files }, 'Import media');
        } catch (err) {
            return formatErrorResponse(err.message, 'Import media');
        }
    },

    edit_clips: async (args) => {
        try {
            const action = args.action || 'trim';
            const cmdId = action === 'cut' || action === 'razor' ? 'sequence.addEdit' : 'timeline.trim';
            const reply = await client.call('command_run', { id: cmdId, params: args });
            if (!reply.ok) return formatErrorResponse(reply.error, 'Edit clips');
            return formatResponse(reply.result, 'Edit clips');
        } catch (err) {
            return formatErrorResponse(err.message, 'Edit clips');
        }
    },

    render_frame: async (args) => {
        try {
            const params = {
                seconds: args.seconds !== undefined ? args.seconds : 0,
                max_side: args.maxSide || 960,
            };
            const reply = await client.call('render_frame', params);
            if (!reply.ok) return formatErrorResponse(reply.error, 'Render frame');
            return formatResponse(reply.result, 'Render frame');
        } catch (err) {
            return formatErrorResponse(err.message, 'Render frame');
        }
    },

    execute_premiere_code: async (args) => {
        try {
            let cmdObj;
            try {
                cmdObj = JSON.parse(args.code || args.script);
            } catch {
                return formatErrorResponse('FilmCraft requires structured JSON commands: {"id": "...", "params": {...}}', 'Execute code');
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
    appName: 'Premiere Pro',
    craftName: 'FilmCraft',
    appPrefix: 'FILMCRAFT',
    defaultPort: 9876,
    handlers,
    inspectStatus: async (client, probe) => {
        if (!probe) return null;
        const list = await client.call('command_list', {});
        return {
            commandsAvailable: list.result?.commands?.length || 0,
        };
    },
});

export const client = harness.client;
export const createRoutedHandlers = (adobeHandlers) => harness.createRoutedHandlers(adobeHandlers);
