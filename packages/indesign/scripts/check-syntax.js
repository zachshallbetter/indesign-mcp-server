#!/usr/bin/env node
/** `node --check` every JavaScript file in src/, uxp/bridge/, scripts/ and tests/. */
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const roots = ['src', 'uxp/bridge', 'scripts', 'tests'];
const files = [];
const walk = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
    }
};
roots.forEach(walk);

let failed = 0;
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
        failed++;
        console.error(`${f}\n${e.stderr}`);
    }
}
console.log(`${files.length - failed}/${files.length} files pass syntax check`);
if (failed) process.exitCode = 1;
