/**
 * Helpers for module-tool tests: a tiny test runner, the stubbed executor, and
 * the script audit applied to the scripts a call generates.
 */
import { ScriptExecutor } from '../../src/core/scriptExecutor.js';
import { moduleTools } from '../../src/tools/index.js';

export const home = process.env.HOME ?? '/tmp';
let passed = 0;

/** Run one named test; failures set the exit code. */
export async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`ok - ${name}`);
    } catch (e) {
        console.error(`not ok - ${name}`);
        console.error('  ', e.message);
        process.exitCode = 1;
    }
}

export function done() {
    console.log(`${passed} passed`);
}

/** A module tool's handler by name. */
export function tool(name) {
    const t = moduleTools.find((x) => x.name === name);
    if (!t) throw new Error(`No module tool ${name}`);
    return t;
}

/**
 * Call module tools with the executor stubbed (InDesign is never contacted);
 * returns the script each call generated. A call that throws rejects.
 */
export async function scriptsFor(calls) {
    const original = ScriptExecutor.executeInDesignScript;
    const sent = [];
    ScriptExecutor.executeInDesignScript = async (s) => { sent.push(s); return '{"ok":true,"result":"{}"}'; };
    try {
        for (const [name, args] of calls) await tool(name).handler(args);
    } finally {
        ScriptExecutor.executeInDesignScript = original;
    }
    return sent;
}
