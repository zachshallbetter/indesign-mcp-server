# Coordination scripts

Used by [../workflow.md](../workflow.md). Node 18+ and the `gh` CLI (signed in, with
issue and PR rights on the repository). Paths come from `paths.mjs`: override with
`ADOBE_MCP_REPO`, `ADOBE_MCP_WT`, `ADOBE_MCP_WORK`, `ATLAS_DIR`, `GITHUB_REPO`.

| Script | Does |
|---|---|
| `plan.mjs <app> <epics.json>` | Groups the atlas's open scriptable features (no tool claims them) into epics and tickets per the layout file; writes `<work>/plan-<app>.json`. Layout format: `epics.example.json`. |
| `create-issues.mjs <app>` | Creates the plan's epics and tickets as GitHub issues, links tickets as sub-issues, updates each epic's ticket list; resumable through `<work>/state-<app>.json`. `DRY=1` previews. Env: `APP_NAME`, `PKG`, `LABEL`, `LABEL_COLOR`. |
| `check-tickets.mjs <app> <checkout> <n...>` | Per ticket, which features are claimed, recorded as findings, or still missing. Caches ticket bodies in `<work>/tickets/`. |
| `apply-notes.mjs` (`APP=<app>`) | Writes builders' findings into the atlas feature records (route, notes, `https://` sources only), keeping each file's formatting. |
| `land-queue.sh` | Background worker: lands `<slug> <pr>` lines from `<work>/queue.txt` one at a time; log in `<work>/queue.log`. |
| `resolve-land.sh <slug> <pr> ...` | One landing: attribution check, merge main, safe conflict resolution, tests, push, `merge-pr.sh`. Exit 3 = conflict needs a person, 4 = tests fail, 5 = attribution text. |
| `merge-pr.sh <pr>` | Waits for CI, refuses unless every check passed, merges with a merge commit "<title> (#pr)". |
| `union.py <file>` | Resolves every conflict in a file by keeping both sides (registration lists, README tables). |
| `safe-union.py <file>` | Resolves conflicts made only of quoted-list lines (feature ids, allowed names) or comments, and one-line `key: [...]` lists, by union; exits 1 for anything else. |
