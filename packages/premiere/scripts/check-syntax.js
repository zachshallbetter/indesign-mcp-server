#!/usr/bin/env node
/** Syntax-check every .js file under src/, uxp/ and scripts/ with `node --check`. */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const files = [];
function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
    }
}
for (const dir of ['src', 'uxp', 'scripts']) walk(dir);

let failed = 0;
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
        failed++;
        console.error(`${f}\n${e.stderr}`);
    }
}
console.log(`${files.length - failed}/${files.length} files OK`);
if (failed) process.exit(1);
