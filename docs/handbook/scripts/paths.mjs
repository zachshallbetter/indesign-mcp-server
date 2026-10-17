// Where the coordination scripts find things. Override with environment variables.
//   ADOBE_MCP_REPO   this repository                 (default: three levels above this file)
//   ADOBE_MCP_WT     folder holding the worktrees    (default: the nearest adobe-mcp-wt beside the repo or a parent)
//   ADOBE_MCP_WORK   durable work folder             (default: <worktrees>/_coord)
//   ATLAS_DIR        the capability atlas checkout   (default: the nearest adobe-capability-atlas beside the repo or a parent)
// The work folder holds plans, issue state, cached ticket bodies, findings and the landing
// queue. Keep it out of /tmp: it must survive a reboot.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
export const REPO = path.resolve(process.env.ADOBE_MCP_REPO ?? path.join(here, '../../..'));
/** The first `name` found beside `from` or beside one of its parents (works from inside a worktree). */
function nearest(name, from) {
    for (let d = from; d !== path.dirname(d); d = path.dirname(d)) {
        const c = path.join(path.dirname(d), name);
        if (fs.existsSync(c)) return c;
    }
    return path.join(path.dirname(from), name);
}
export const WORKTREES = path.resolve(process.env.ADOBE_MCP_WT ?? nearest('adobe-mcp-wt', REPO));
export const WORK = path.resolve(process.env.ADOBE_MCP_WORK ?? path.join(WORKTREES, '_coord'));
export const ATLAS = path.resolve(process.env.ATLAS_DIR ?? nearest('adobe-capability-atlas', REPO));
export const GITHUB_REPO = process.env.GITHUB_REPO ?? 'zachshallbetter/adobe-mcp';

for (const d of [WORK, path.join(WORK, 'atlas-notes'), path.join(WORK, 'tickets')]) fs.mkdirSync(d, { recursive: true });

/** Every feature record of an application in the atlas. */
export function atlasFeatures(app) {
    const dir = path.join(ATLAS, 'corpus', app, 'features');
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (f === 'taxonomy.json' || !f.endsWith('.json')) continue;
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push(...(Array.isArray(j) ? j : j.features));
    }
    return out;
}
