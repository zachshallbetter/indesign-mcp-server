/**
 * Layer tool definitions for InDesign MCP Server
 * Layer management and functionality
 */

export const layerToolDefinitions = [
    // =================== LAYERS MANAGEMENT ===================
    {
        name: 'create_layer',
        description: 'Create a new layer in the active document (fails if a layer with that name exists)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Layer name' },
                visible: { type: 'boolean', description: 'Layer visibility', default: true },
                locked: { type: 'boolean', description: 'Layer locked state', default: false },
                color: { type: 'string', description: 'Layer color: a UIColors name (e.g. BLUE, LIGHT_BLUE, RED) or "R,G,B" with each value 0-255', default: 'BLUE' },
            },
            required: ['name'],
        },
    },
    {
        name: 'set_active_layer',
        description: 'Make an existing layer the active layer of the active document',
        inputSchema: {
            type: 'object',
            properties: {
                layerName: { type: 'string', description: 'Layer name to activate' },
            },
            required: ['layerName'],
        },
    },
    {
        name: 'list_layers',
        description: 'List all layers in the active document (top of the stack first) with visibility, lock, printable, color, item and guide counts',
        inputSchema: { type: 'object', properties: {} },
    },
]; 