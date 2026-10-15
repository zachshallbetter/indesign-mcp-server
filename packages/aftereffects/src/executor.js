/**
 * How this server runs a script in After Effects.
 *
 * macOS: AppleScript `DoScriptFile`, which runs the .jsx and returns its result.
 * Windows: After Effects has no COM scripting object. AfterFX.exe -r hands a
 * script to the running After Effects (starting it if needed) but returns
 * nothing, so a small wrapper runs the script and writes its result to a file
 * the server waits for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExecutor, appleScriptString, formatResponse, formatErrorResponse } from 'adobe-mcp-core';

/** AfterFX.exe: AFTEREFFECTS_EXE, else the newest Adobe After Effects install under Program Files. */
export function findAfterFx(env = process.env) {
    if (env.AFTEREFFECTS_EXE) return env.AFTEREFFECTS_EXE;
    const base = path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Adobe');
    let installs = [];
    try {
        installs = fs.readdirSync(base).filter((n) => /^Adobe After Effects/i.test(n)).sort().reverse();
    } catch {
        // not installed here
    }
    for (const dir of installs) {
        const exe = path.join(base, dir, 'Support Files', 'AfterFX.exe');
        if (fs.existsSync(exe)) return exe;
    }
    throw new Error('AfterFX.exe not found: install After Effects or set AFTEREFFECTS_EXE to its path');
}

/** ES3 wrapper that runs scriptPath and writes its result, as text, to resultPath. */
export function resultWrapper(scriptPath, resultPath) {
    const q = (p) => JSON.stringify(p.replace(/\\/g, '/'));
    return [
        'var __r;',
        `try { __r = $.evalFile(new File(${q(scriptPath)})); } catch (e) { __r = "Error: " + e.message; }`,
        `var __f = new File(${q(resultPath)});`,
        '__f.encoding = "UTF-8";',
        '__f.open("w");',
        '__f.write(__r === undefined ? "" : String(__r));',
        '__f.close();',
    ].join('\n');
}

async function winRun({ scriptPath, run, timeoutMs }) {
    const stem = scriptPath.replace(/\.jsx$/, '');
    const resultPath = `${stem}.result.txt`;
    const wrapperPath = `${stem}.wrapper.jsx`;
    fs.writeFileSync(wrapperPath, resultWrapper(scriptPath, resultPath), 'utf8');
    try {
        await run(findAfterFx(), ['-r', wrapperPath], { timeoutMs });
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (fs.existsSync(resultPath)) {
                await new Promise((r) => setTimeout(r, 50));
                return fs.readFileSync(resultPath, 'utf8').trim();
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        const error = new Error('no result');
        error.timedOut = true;
        throw error;
    } finally {
        for (const p of [resultPath, wrapperPath]) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    }
}

export const executor = createExecutor({
    label: 'After Effects',
    envPrefix: 'AFTEREFFECTS',
    appNamePrefix: 'Adobe After Effects',
    defaultAppName: 'Adobe After Effects',
    macBundleId: 'com.adobe.AfterEffects',
    macScript: ({ scriptPath }) => `DoScriptFile ${appleScriptString(scriptPath)}`,
    winRun,
    winProcessName: 'AfterFX.exe',
});

/**
 * Run a script built with script() and return a tool result. The script's
 * __result__ is JSON; it is parsed into `result`.
 */
export async function run(operation, source) {
    const r = await executor.runStructured(source);
    if (!r.ok) return formatErrorResponse(r.error, operation);
    let value = r.result;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { /* a plain string result */ }
    }
    return formatResponse(value, operation);
}

