// For a checkout of adobe-mcp, report each ticket's atlas features that are neither claimed by a
// tool's `features` nor recorded as not scriptable (a finding, or route `none` in the atlas).
// Ticket bodies are fetched once and cached in <work>/tickets/<n>.json.
// Usage: node check-tickets.mjs <app> <checkout dir> <ticket numbers...>
// InDesign also counts the atlas's curated feature_ids for legacy tools, and claims files
// (<work>/indesign-claims/*.json, [{ tool, feature }]).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WORK, ATLAS, GITHUB_REPO, atlasFeatures } from './paths.mjs';

const [app, repoArg, ...nums] = process.argv.slice(2);
if (!app || !repoArg || !nums.length) { console.error('Usage: node check-tickets.mjs <app> <checkout dir> <ticket numbers...>'); process.exit(2); }
const repo = path.resolve(repoArg);

const claimed = new Set();
const toolsDir = path.join(repo, 'packages', app, 'src/tools');
for (const f of fs.readdirSync(toolsDir).filter((n) => n.endsWith('.js'))) {
    const m = await import(pathToFileURL(path.join(toolsDir, f)));
    for (const t of m.tools ?? []) for (const id of t.features ?? []) claimed.add(id);
}
if (app === 'indesign') {
    const tools = path.join(ATLAS, 'corpus/indesign/capabilities/tools.json');
    for (const t of JSON.parse(fs.readFileSync(tools, 'utf8')).tools) for (const id of t.feature_ids ?? []) claimed.add(id);
    const claimsDir = path.join(WORK, 'indesign-claims');
    for (const f of fs.existsSync(claimsDir) ? fs.readdirSync(claimsDir) : []) for (const c of JSON.parse(fs.readFileSync(path.join(claimsDir, f), 'utf8'))) claimed.add(c.feature);
}
const noted = new Set();
const notesDir = path.join(WORK, 'atlas-notes');
for (const f of fs.readdirSync(notesDir).filter((n) => n.startsWith(`${app}-`))) for (const n of JSON.parse(fs.readFileSync(path.join(notesDir, f), 'utf8'))) noted.add(n.id);
for (const x of atlasFeatures(app)) if (x.automation?.route === 'none') noted.add(x.id);

for (const n of nums) {
    const cache = path.join(WORK, 'tickets', `${n}.json`);
    if (!fs.existsSync(cache)) fs.writeFileSync(cache, execFileSync('gh', ['issue', 'view', n, '--repo', GITHUB_REPO, '--json', 'number,title,body,state'], { encoding: 'utf8' }));
    const t = JSON.parse(fs.readFileSync(cache, 'utf8'));
    const ids = [...t.body.matchAll(new RegExp('`(' + app + '\\.[a-z0-9_.]+)`', 'g'))].map((m) => m[1]);
    const missing = ids.filter((id) => !claimed.has(id) && !noted.has(id));
    const c = ids.filter((id) => claimed.has(id)).length;
    console.log(`#${n} ${missing.length ? 'OPEN ' : 'DONE '} claimed ${c}/${ids.length}, findings ${ids.length - c - missing.length}${missing.length ? ', missing: ' + missing.slice(0, 10).join(' ') + (missing.length > 10 ? ' …' : '') : ''}  ${t.title}`);
}
