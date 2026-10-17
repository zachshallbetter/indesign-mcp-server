/**
 * How this server runs a script in Photoshop.
 *
 * macOS: AppleScript `do javascript`. The script file is read in as UTF-8 text
 * and passed as source, so nothing in it needs AppleScript escaping.
 * Windows: the COM object's DoJavaScriptFile().
 */
import { createExecutor, appleScriptString, powerShellString, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

export const executor = createExecutor({
    label: 'Photoshop',
    envPrefix: 'PHOTOSHOP',
    appNamePrefix: 'Adobe Photoshop',
    defaultAppName: 'Adobe Photoshop',
    macBundleId: 'com.adobe.Photoshop',
    macScript: ({ scriptPath }) => `do javascript (read (POSIX file ${appleScriptString(scriptPath)}) as «class utf8»)`,
    winProgIds: ['Photoshop.Application'],
    winInvoke: ({ scriptPath }) => `$app.DoJavaScriptFile(${powerShellString(scriptPath)})`,
    winProcessName: 'Photoshop.exe',
});

// Under `node --test`, nothing may reach a real application: a test that forgets to stub the
// executor fails here instead of running a script in the user's copy of Photoshop.
if (process.env.NODE_TEST_CONTEXT) {
    executor.runScript = async () => {
        throw new Error('Tests must not run scripts in Photoshop: stub executor.runScript');
    };
}

/**
 * Run a script built with script() and return a tool result. The script's
 * __result__ is JSON; it is parsed into `result`.
 * @param {string} operation e.g. "Resize image"
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
