// Records builders' not-scriptable findings in the atlas feature records.
// Usage: APP=<app> node apply-notes.mjs <work>/atlas-notes/<app>-*.json
import fs from 'node:fs';
import path from 'node:path';
import { ATLAS } from './paths.mjs';

if (!process.env.APP) { console.error('Set APP to the application (indesign, illustrator, photoshop, aftereffects, premiere)'); process.exit(2); }
const dir = path.join(ATLAS, 'corpus', process.env.APP, 'features');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'taxonomy.json');
const docs = Object.fromEntries(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
const list = (j) => (Array.isArray(j) ? j : j.features);
const index = {};
for (const [f, j] of Object.entries(docs)) for (const x of list(j)) index[x.id] = { file: f, feature: x };

const ROUTES = new Set(['dom', 'menu_command', 'action_manager', 'uxp', 'action', 'native_sdk', 'none', 'unknown']);
const changed = new Set();
let applied = 0;
for (const notesFile of process.argv.slice(2)) {
    for (const n of JSON.parse(fs.readFileSync(notesFile, 'utf8'))) {
        const hit = index[n.id];
        if (!hit) { console.error('unknown feature', n.id, 'in', notesFile); process.exitCode = 1; continue; }
        if (!ROUTES.has(n.route)) { console.error('bad route', n.route, n.id); process.exitCode = 1; continue; }
        const x = hit.feature;
        x.automation ??= {};
        x.automation.route = n.route;
        const reason = String(n.reason).trim();
        if (!x.automation.notes) x.automation.notes = reason;
        else if (!x.automation.notes.includes(reason)) x.automation.notes = `${x.automation.notes} ${reason}`;
        // Sources must be URLs; local corpus paths are not citations.
        for (const s of (n.sources ?? []).filter((u) => /^https?:\/\//.test(u))) {
            x.sources ??= [];
            if (!x.sources.includes(s)) x.sources.push(s);
        }
        changed.add(hit.file);
        applied++;
    }
}
// Keep each file's indentation and trailing newline as found.
for (const f of changed) {
    const before = fs.readFileSync(path.join(dir, f), 'utf8');
    const indent = (before.match(/\n( +)\S/) ?? [, '  '])[1].length;
    fs.writeFileSync(path.join(dir, f), JSON.stringify(docs[f], null, indent) + (before.endsWith('\n') ? '\n' : ''));
}
console.log('applied', applied, 'notes to', [...changed].join(', '));
