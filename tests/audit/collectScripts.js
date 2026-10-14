/**
 * Runs every tool handler with sample arguments derived from its input schema
 * and captures the scripts it would send to InDesign (the executor is stubbed
 * for the duration of the call; InDesign is not contacted).
 * Used by the script audit and the UXP backend test.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { InDesignMCPServer } from '../../src/core/InDesignMCPServer.js';
import { allToolDefinitions } from '../../src/types/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function sample(name, schema) {
    if (!schema) return 'Sample';
    if (schema.enum) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    const n = name.toLowerCase();
    switch (schema.type) {
        case 'number':
        case 'integer':
            return /index|page|spread|position|row|column/.test(n) ? 0 : 10;
        case 'boolean':
            return true;
        case 'array': {
            const one = (i) => {
                const v = sample(name, schema.items ?? { type: 'string' });
                return typeof v === 'number' ? v + i : v;
            };
            return Array.from({ length: Math.max(2, schema.minItems ?? 0) }, (_, i) => one(i));
        }
        case 'object': {
            const o = {};
            for (const [k, v] of Object.entries(schema.properties || {})) o[k] = sample(k, v);
            return o;
        }
        default:
            if (/folder|directory|outputdir/.test(n)) return path.join(process.env.HOME || root, 'Documents');
            if (/path|file/.test(n)) return path.join(process.env.HOME || root, 'Documents', 'audit.indd');
            if (/colou?r|swatch/.test(n)) return 'Black';
            return 'Sample';
    }
}

/**
 * @param {{ filter?: RegExp|null }} [opts]
 * @returns {Promise<Array<{ tool: object, args: object, scripts: string[], result?: any, error?: Error }>>}
 */
export async function collectToolScripts({ filter = null } = {}) {
    const server = new InDesignMCPServer();
    const original = {
        executeInDesignScript: ScriptExecutor.executeInDesignScript,
        executeViaUXP: ScriptExecutor.executeViaUXP,
    };
    let captured = [];
    ScriptExecutor.executeInDesignScript = async (script) => {
        captured.push(script);
        return 'OK';
    };
    ScriptExecutor.executeViaUXP = ScriptExecutor.executeInDesignScript;

    const out = [];
    try {
        for (const tool of allToolDefinitions) {
            if (filter && !filter.test(tool.name)) continue;
            const args = {};
            for (const [k, v] of Object.entries(tool.inputSchema?.properties || {})) args[k] = sample(k, v);
            captured = [];
            const entry = { tool, args, scripts: captured };
            try {
                entry.result = await server.handleToolCall(tool.name, args);
            } catch (e) {
                entry.error = e;
            }
            out.push(entry);
        }
    } finally {
        Object.assign(ScriptExecutor, original);
    }
    return out;
}
