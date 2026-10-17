// Creates the epics and tickets of a plan (from plan.mjs) as GitHub issues, links each ticket
// to its epic as a sub-issue, and records numbers in <work>/state-<app>.json so a rerun resumes.
// Usage: APP_NAME="After Effects" PKG=adobe-mcp-aftereffects LABEL=aftereffects [LABEL_COLOR=9999FF] \
//        node create-issues.mjs <app>          (DRY=1 prints the first epic and ticket instead)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WORK, GITHUB_REPO as REPO } from './paths.mjs';

const app = process.argv[2];
const APP = process.env.APP_NAME ?? app;
const LABEL = process.env.LABEL ?? app;
const PKG = process.env.PKG ?? `adobe-mcp-${app}`;
const { plan, coverage } = JSON.parse(fs.readFileSync(path.join(WORK, `plan-${app}.json`), 'utf8'));
const stateFile = path.join(WORK, `state-${app}.json`);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { epics: {}, tickets: {}, linked: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function api(args, input) {
    for (let attempt = 0; ; attempt++) {
        try {
            return JSON.parse(execFileSync('gh', ['api', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) || 'null');
        } catch (e) {
            const msg = String(e.stderr || e.message);
            if (attempt < 4 && /rate limit|secondary|abuse|502|503|timeout/i.test(msg)) { sleep(30000 * (attempt + 1)); continue; }
            throw new Error(msg);
        }
    }
}

function ticketBody(epicNumber, t) {
    return [
        `Part of #${epicNumber}.`, '', t.scope, '',
        `**Atlas features (${t.features.length})**, with the route the capability atlas records for each: object model, menu command, Action Manager or Action.`, '',
        ...t.features.map((f) => `- [ ] \`${f.id}\` ${f.name} (${f.route})`), '',
        '**Done when**',
        '- Each feature above is claimed by a tool\'s `features`, or recorded in the capability atlas as not scriptable, with the reason.',
        '- Every generated script passes the static object-model audit, and tests cover argument checking.',
        `- Released in \`${PKG}\`. Validation in ${APP} itself waits for a machine with ${APP} installed.`,
    ].join('\n');
}

function epicBody(epic, refs) {
    const cov = epic.domains.map((d) => `${d.replace(/_/g, ' ')} ${coverage[d]?.claimed ?? 0} of ${coverage[d]?.total ?? '?'}`).join(', ');
    const total = epic.tickets.reduce((n, t) => n + t.features.length, 0);
    return [
        `Epic for ${APP}: ${epic.summary}`, '',
        `Coverage in ${PKG} now: ${cov} atlas features claimed. These tickets cover ${total} more.`, '',
        '**Tickets**', '',
        ...(refs.length ? refs.map((r) => `- [ ] #${r.number} ${r.title} (${r.count})`) : ['_Being created._']), '',
        `Source: the capability atlas features with a scripting route that no ${APP} tool claims yet.`,
    ].join('\n');
}

if (process.env.DRY) {
    const e = plan[0];
    console.log(epicBody(e, e.tickets.map((t, i) => ({ number: 100 + i, title: t.title, count: t.features.length }))));
    console.log('\n=========\n');
    console.log(ticketBody(99, e.tickets[0]));
    process.exit(0);
}

for (const [name, color, description] of [['epic', '5319e7', 'A group of related tickets'], [LABEL, process.env.LABEL_COLOR ?? 'ff9a00', PKG]]) {
    try { api(['repos/' + REPO + '/labels', '-f', `name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`]); }
    catch (e) { if (!/already_exists|422/.test(String(e.message))) throw e; }
}

for (const epic of plan) {
    if (!state.epics[epic.title]) {
        const r = api(['repos/' + REPO + '/issues', '--input', '-'], JSON.stringify({ title: `Epic: ${APP} ${epic.title}`, body: epicBody(epic, []), labels: ['epic', LABEL] }));
        state.epics[epic.title] = { number: r.number, id: r.id };
        save();
        console.log('epic', r.number, epic.title);
    }
    const e = state.epics[epic.title];
    const refs = [];
    for (const t of epic.tickets) {
        const key = `${epic.title} / ${t.title}`;
        if (!state.tickets[key]) {
            const r = api(['repos/' + REPO + '/issues', '--input', '-'], JSON.stringify({ title: `${APP}: ${t.title}`, body: ticketBody(e.number, t), labels: [LABEL] }));
            state.tickets[key] = { number: r.number, id: r.id };
            save();
            console.log('  ticket', r.number, t.title);
        }
        const s = state.tickets[key];
        if (!state.linked[key]) {
            try { api(['-X', 'POST', `repos/${REPO}/issues/${e.number}/sub_issues`, '-F', `sub_issue_id=${s.id}`]); }
            catch (err) { if (!/already|422/.test(String(err.message))) throw err; }
            state.linked[key] = true;
            save();
        }
        refs.push({ number: s.number, title: t.title, count: t.features.length });
    }
    api(['-X', 'PATCH', `repos/${REPO}/issues/${e.number}`, '--input', '-'], JSON.stringify({ body: epicBody(epic, refs) }));
}
console.log('done', Object.keys(state.epics).length, 'epics', Object.keys(state.tickets).length, 'tickets; state in', stateFile);
