/**
 * How this server runs a script in Illustrator.
 *
 * macOS: AppleScript `do javascript`. The script file is read in as UTF-8 text
 * and passed as source, so nothing in it needs AppleScript escaping. (In
 * Illustrator, AppleScript `do script` plays a recorded Action; it does not run
 * JavaScript.)
 * Windows: the COM object's DoJavaScriptFile(). DoScript() also plays an Action.
 */
import { createExecutor, appleScriptString, powerShellString, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

import { client as vectorcraftClient } from './artcraft/vectorcraft-adapter.js';

export const executor = createExecutor({
    label: 'Illustrator',
    envPrefix: 'ILLUSTRATOR',
    appNamePrefix: 'Adobe Illustrator',
    defaultAppName: 'Adobe Illustrator',
    macBundleId: 'com.adobe.illustrator',
    macScript: ({ scriptPath }) => `do javascript (read (POSIX file ${appleScriptString(scriptPath)}) as «class utf8»)`,
    winProgIds: ['Illustrator.Application'],
    winInvoke: ({ scriptPath }) => `$app.DoJavaScriptFile(${powerShellString(scriptPath)})`,
    winProcessName: 'Illustrator.exe',
    backends: [
        {
            name: 'artcraft',
            targetApp: 'VectorCraft',
            isAvailable: () => vectorcraftClient.isAvailable(),
            run: async () => {
                throw new Error('VectorCraft communicates via structured JSON-lines control channel rather than raw ExtendScript.');
            },
        },
    ],
});

// Under `node --test`, nothing may reach a real application: a test that forgets to stub the
// executor fails here instead of running a script in the user's copy of Illustrator.
if (process.env.NODE_TEST_CONTEXT) {
    executor.runScript = async () => {
        throw new Error('Tests must not run scripts in Illustrator: stub executor.runScript');
    };
}

/**
 * Run a script built with script() and return a tool result. The script's
 * __result__ is JSON; it is parsed into `result`.
 * @param {string} operation e.g. "Create rectangle"
 * @param {string} source
 */
export async function run(operation, source) {
    const r = await executor.runStructured(source);
    if (!r.ok) return formatErrorResponse(r.error, operation);
    let value = r.result;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            // a plain string result
        }
    }
    return formatResponse(value, operation);
}
