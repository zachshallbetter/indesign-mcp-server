/**
 * Runs every test file for module tools (tests/modules/*.test.js), each in its
 * own process, and fails if any of them fails. Each area adds its own file.
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
    try {
        execFileSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
    } catch {
        failed++;
        console.error(`FAILED: tests/modules/${f}`);
    }
}
if (failed) process.exit(1);
