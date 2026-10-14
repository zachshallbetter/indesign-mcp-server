/**
 * Path confinement: every string parameter that names a file or folder must be
 * validated before it reaches a script. Each such parameter is called with a
 * path outside the allowed directories; no generated script may contain it.
 */
import assert from 'node:assert/strict';
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { InDesignMCPServer } from '../../src/core/InDesignMCPServer.js';
import { allToolDefinitions } from '../../src/types/index.js';

const OUTSIDE = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
const PATH_PARAM = /path|file|folder|dataSource|outputDir/i;
const NOT_A_PATH = /fileType|profile/i;

let captured = [];
ScriptExecutor.executeInDesignScript = async (script) => {
    captured.push(script);
    return 'OK';
};
const server = new InDesignMCPServer();

const checked = [];
const leaks = [];
for (const tool of allToolDefinitions) {
    const props = tool.inputSchema?.properties || {};
    const keys = Object.keys(props).filter((k) => PATH_PARAM.test(k) && !NOT_A_PATH.test(k) && props[k].type === 'string');
    for (const key of keys) {
        const args = {};
        for (const [p, s] of Object.entries(props)) if (s.default !== undefined && s.default !== null) args[p] = s.default;
        for (const r of tool.inputSchema?.required || []) {
            if (args[r] !== undefined) continue;
            const s = props[r] || {};
            args[r] = s.enum ? s.enum[0] : s.type === 'number' || s.type === 'integer' ? 0 : 'x';
        }
        args[key] = OUTSIDE;
        captured = [];
        try {
            await server.handleToolCall(tool.name, args);
        } catch {
            // rejected by validation: fine
        }
        checked.push(`${tool.name}.${key}`);
        if (captured.some((s) => s.includes(OUTSIDE.replace(/\\/g, '/')) || s.includes(OUTSIDE))) leaks.push(`${tool.name}.${key}`);
    }
}

try {
    assert.ok(checked.length >= 25, `expected 25+ path parameters, found ${checked.length}`);
    assert.deepEqual(leaks, []);
    console.log(`ok - ${checked.length} path parameters reject ${OUTSIDE}`);
} catch (e) {
    console.error('not ok - path confinement');
    console.error('  ', e.message);
    process.exitCode = 1;
}
