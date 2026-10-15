import { formatResponse, formatErrorResponse } from '../utils/stringUtils.js';
import { moduleCategories } from '../tools/index.js';
import {
    allToolDefinitions,
    bookToolDefinitions,
    contentToolDefinitions,
    documentToolDefinitions,
    exportToolDefinitions,
    layerToolDefinitions,
    masterSpreadToolDefinitions,
    pageItemGroupToolDefinitions,
    pageToolDefinitions,
    spreadToolDefinitions,
    utilityToolDefinitions,
} from '../types/index.js';

const names = (defs, pattern) => defs.map((t) => t.name).filter((n) => !pattern || pattern.test(n));

/**
 * Help Handlers
 * Built from the tool definitions the server advertises, so help always
 * matches tools/list.
 */
export class HelpHandlers {

    // Category keys match the `category` enum in the help tool's schema.
    static toolCategories = {
        document: {
            name: 'Documents & Books',
            description: 'Create, open, save, inspect and validate documents; manage books',
            tools: [...names(documentToolDefinitions), ...names(bookToolDefinitions)],
        },
        page: {
            name: 'Pages & Spreads',
            description: 'Add, move, resize and inspect pages and spreads; guides and placement',
            tools: [...names(pageToolDefinitions), ...names(spreadToolDefinitions)],
        },
        text: {
            name: 'Text & Tables',
            description: 'Text frames, tables and find/replace',
            tools: names(contentToolDefinitions, /text|table|find|story/),
        },
        graphics: {
            name: 'Graphics & Images',
            description: 'Shapes, placed images and object styles',
            tools: names(contentToolDefinitions, /rectangle|ellipse|polygon|image|object_style/),
        },
        styles: {
            name: 'Styles & Colors',
            description: 'Paragraph and character styles, swatches and colors',
            tools: names(contentToolDefinitions, /paragraph_style|character_style|color|swatch|list_styles/),
        },
        layout: {
            name: 'Layout, Masters & Layers',
            description: 'Page items, groups, master spreads and layers',
            tools: [...names(pageItemGroupToolDefinitions), ...names(masterSpreadToolDefinitions), ...names(layerToolDefinitions)],
        },
        export: {
            name: 'Export & Utilities',
            description: 'PDF, image, EPUB and package export; status, custom code and session tools',
            tools: [...names(exportToolDefinitions), ...names(utilityToolDefinitions), 'help'],
        },
    };

    static {
        // Module areas join the category with the same key, or add their own.
        for (const [key, cat] of Object.entries(moduleCategories)) {
            const base = this.toolCategories[key];
            this.toolCategories[key] = base ? { ...base, description: cat.description, tools: [...base.tools, ...cat.tools] } : cat;
        }
    }

    static findTool(name) {
        return allToolDefinitions.find((t) => t.name === name);
    }

    static describeParam(name, schema, required) {
        const parts = [schema.type ? `${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}` : 'any'];
        if (required) parts.push('required');
        if (schema.enum) parts.push(`one of ${schema.enum.join(', ')}`);
        if (schema.default !== undefined && schema.default !== null) parts.push(`default ${JSON.stringify(schema.default)}`);
        return `- **${name}** (${parts.join('; ')})${schema.description ? `: ${schema.description}` : ''}`;
    }

    static exampleArgs(tool) {
        const props = tool.inputSchema?.properties || {};
        const example = {};
        for (const key of tool.inputSchema?.required || []) {
            const s = props[key] || {};
            if (s.default !== undefined && s.default !== null) example[key] = s.default;
            else if (s.enum) example[key] = s.enum[0];
            else if (s.type === 'number' || s.type === 'integer') example[key] = 0;
            else if (s.type === 'boolean') example[key] = true;
            else if (s.type === 'array') example[key] = [];
            else example[key] = `<${key}>`;
        }
        return example;
    }

    /**
     * Get help information
     */
    static async getHelp(args = {}) {
        const { tool, category, format = 'summary' } = args;

        try {
            if (tool) {
                return this.getToolHelp(tool, format);
            }
            if (category && category !== 'all') {
                return this.getCategoryHelp(category, format);
            }
            return this.getAllToolsHelp(format);
        } catch (error) {
            return formatErrorResponse(`Error getting help: ${error.message}`, 'Get Help');
        }
    }

    /**
     * Get help for a specific tool
     */
    static getToolHelp(toolName, format = 'summary') {
        const tool = this.findTool(toolName);

        if (!tool) {
            return formatErrorResponse(`Tool '${toolName}' not found. Use 'help' without parameters to see all available tools.`, 'Get Help');
        }

        const props = tool.inputSchema?.properties || {};
        const required = new Set(tool.inputSchema?.required || []);
        let helpText = `# ${tool.name}\n\n${tool.description}\n\n`;

        helpText += `## Parameters\n\n`;
        const entries = Object.entries(props);
        helpText += entries.length
            ? entries.map(([k, v]) => this.describeParam(k, v, required.has(k))).join('\n') + '\n\n'
            : 'None.\n\n';

        if (format === 'examples' || format === 'detailed') {
            helpText += `## Minimal call\n\n`;
            helpText += '```json\n';
            helpText += JSON.stringify({ name: tool.name, arguments: this.exampleArgs(tool) }, null, 2);
            helpText += '\n```\n';
        }

        return formatResponse(helpText, 'Get Help');
    }

    /**
     * Get help for a specific category
     */
    static getCategoryHelp(category, format = 'summary') {
        const catInfo = this.toolCategories[category];

        if (!catInfo) {
            return formatErrorResponse(`Category '${category}' not found. Available categories: ${Object.keys(this.toolCategories).join(', ')}`, 'Get Help');
        }

        let helpText = `# ${catInfo.name}\n\n${catInfo.description}\n\n## Tools (${catInfo.tools.length})\n\n`;
        for (const toolName of catInfo.tools) {
            const tool = this.findTool(toolName);
            helpText += `- **${toolName}**: ${tool?.description ?? ''}\n`;
            if (format === 'detailed' && tool) {
                const required = new Set(tool.inputSchema?.required || []);
                for (const [k, v] of Object.entries(tool.inputSchema?.properties || {})) {
                    helpText += `  ${this.describeParam(k, v, required.has(k))}\n`;
                }
            }
        }

        return formatResponse(helpText, 'Get Help');
    }

    /**
     * Get help for all tools
     */
    static getAllToolsHelp(format = 'summary') {
        let helpText = `# InDesign MCP Server: ${allToolDefinitions.length} tools\n\n`;
        helpText += `Programmatic access to Adobe InDesign through the Model Context Protocol.\n\n`;

        helpText += `## Quick start\n\n`;
        helpText += `1. Check the connection: \`indesign_status\`\n`;
        helpText += `2. Create a document: \`create_document\`\n`;
        helpText += `3. Add text: \`create_text_frame\`; add images: \`place_image\`\n`;
        helpText += `4. Create styles: \`create_paragraph_style\`, \`create_color_swatch\`\n`;
        helpText += `5. Save or export: \`save_document\`, \`export_pdf\`\n\n`;

        helpText += `## Categories\n\n`;
        for (const [key, info] of Object.entries(this.toolCategories)) {
            helpText += `### ${info.name} (\`${key}\`, ${info.tools.length} tools)\n${info.description}\n\n`;
            if (format === 'summary') {
                helpText += `${info.tools.join(', ')}\n\n`;
            } else {
                for (const toolName of info.tools) {
                    helpText += `- **${toolName}**: ${this.findTool(toolName)?.description ?? ''}\n`;
                }
                helpText += '\n';
            }
        }

        helpText += `## Help options\n\n`;
        helpText += `- \`help({ tool: "create_document" })\`: parameters for one tool\n`;
        helpText += `- \`help({ tool: "create_document", format: "examples" })\`: plus a minimal call\n`;
        helpText += `- \`help({ category: "text" })\`: tools in one category (${Object.keys(this.toolCategories).join(', ')})\n`;
        helpText += `- \`help({ format: "detailed" })\`: every tool with its description\n\n`;

        helpText += `## Notes\n\n`;
        helpText += `- Positions and sizes are in millimeters unless a parameter says otherwise\n`;
        helpText += `- Font names use the form "Family\\tStyle", for example "Arial\\tBold"\n`;
        helpText += `- File paths must be absolute and inside your home folder or INDESIGN_ALLOWED_DIRS\n`;

        return formatResponse(helpText, 'Get Help');
    }
}
