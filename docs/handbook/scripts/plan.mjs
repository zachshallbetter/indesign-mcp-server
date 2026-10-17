// Builds an epic/ticket plan from the atlas features that have a scripting route but that no
// tool claims yet. The epic layout comes from a config file (see epics.example.json).
// Usage: node plan.mjs <app> <epics.json>   -> writes <work>/plan-<app>.json and prints a summary
import fs from 'node:fs';
import path from 'node:path';
import { WORK, ATLAS, atlasFeatures } from './paths.mjs';

const [app, configFile] = process.argv.slice(2);
if (!app || !configFile) { console.error('Usage: node plan.mjs <app> <epics.json>'); process.exit(2); }
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

const SCRIPTABLE = new Set(config.routes ?? ['dom', 'menu_command', 'action_manager', 'uxp', 'action']);
const ROUTE = { dom: 'object model', menu_command: 'menu command', action_manager: 'Action Manager', uxp: 'UXP API', action: 'Action' };
const toolsFile = path.join(ATLAS, 'corpus', app, 'capabilities', 'tools.json');
const claimed = new Set(fs.existsSync(toolsFile) ? JSON.parse(fs.readFileSync(toolsFile, 'utf8')).tools.flatMap((t) => t.feature_ids ?? []) : []);
const all = atlasFeatures(app);

// Menu category of a feature (e.g. Filter > Blur), so option records group with their item.
const category = {};
for (const x of all) if (Array.isArray(x.menu_path) && x.menu_path.length >= 3) category[`${x.domain}:${x.id.split('.')[2]}`] = x.menu_path;
function menuOf(x) {
    const rest = x.id.split('.')[2];
    return category[`${x.domain}:${rest.split('_option')[0]}`] ?? category[`${x.domain}:${rest}`] ?? null;
}

const rows = {};
for (const x of all) {
    rows[x.domain] ??= { total: 0, claimed: 0, open: [] };
    rows[x.domain].total++;
    if (claimed.has(x.id)) { rows[x.domain].claimed++; continue; }
    if (SCRIPTABLE.has(x.automation?.route)) rows[x.domain].open.push(x);
}

function matches(sel, x) {
    if (sel === '*') return true;
    if (sel.idPattern) return new RegExp(sel.idPattern).test(x.id.split('.').slice(2).join('.'));
    if (sel.menuCategory) { const m = menuOf(x); return !!m && (!sel.menuRoot || m[0] === sel.menuRoot) && sel.menuCategory.includes(m[1]); }
    throw new Error(`Unknown selector ${JSON.stringify(sel)}`);
}

const used = new Set();
const plan = [];
for (const e of config.epics) {
    const epic = { title: e.title, summary: e.summary, tickets: [], domains: [...new Set(e.tickets.map((t) => t.domain))] };
    for (const t of e.tickets) {
        const pool = (rows[t.domain]?.open ?? []).filter((x) => !used.has(x.id));
        const take = pool.filter((x) => matches(t.select ?? '*', x));
        take.forEach((x) => used.add(x.id));
        if (take.length) epic.tickets.push({ title: t.title, scope: t.scope, features: take.map((x) => ({ id: x.id, name: x.name, route: ROUTE[x.automation.route] ?? x.automation.route })) });
    }
    if (epic.tickets.length) plan.push(epic);
}
const leftovers = Object.values(rows).flatMap((r) => r.open.filter((x) => !used.has(x.id)).map((x) => x.id));
const coverage = Object.fromEntries(Object.entries(rows).map(([d, r]) => [d, { total: r.total, claimed: r.claimed }]));
const out = path.join(WORK, `plan-${app}.json`);
fs.writeFileSync(out, JSON.stringify({ app, plan, leftovers, coverage }, null, 1));
for (const e of plan) console.log(e.title, '|', e.tickets.map((t) => `${t.title} (${t.features.length})`).join('; '));
console.log(`leftovers ${leftovers.length}; written ${out}`);
