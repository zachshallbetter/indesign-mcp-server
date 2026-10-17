# Planned work: epics, tickets, builders, landing

Most of the tools in this repository were built in planned rounds: the atlas lists
every feature with a scripting route that no tool claims yet; those features are
grouped into epics and tickets on GitHub; several builders (one per epic, each in its
own worktree) write the tools in parallel; a coordinator lands their pull requests one
at a time, checks every ticket's features are accounted for, closes the tickets and
epics, and records the findings in the atlas. The scripts for each step are in
[scripts/](scripts/README.md).

## Folders

```
~/Projects/
  adobe-mcp/                 this repository (main checkout)
  adobe-capability-atlas/    the atlas (private)
  adobe-mcp-wt/              one worktree per piece of work
    _coord/                  the work folder: plans, issue state, ticket cache, findings, landing queue
    <slug>/                  a builder's worktree, branch <app>-<slug>
    main-view/               a detached checkout of origin/main for checks (read only)
```

The work folder must survive a reboot: never keep it in `/tmp`. Override any of these
with `ADOBE_MCP_REPO`, `ADOBE_MCP_WT`, `ADOBE_MCP_WORK` and `ATLAS_DIR`.

## 1. Plan

Write an epic layout for the app (copy `scripts/epics.example.json`): epics, and for
each ticket the atlas domain and a selector. Aim for tickets of 10–100 features and
epics a single builder can finish in one sitting. Then:

```bash
node docs/handbook/scripts/plan.mjs <app> <epics.json>      # writes <work>/plan-<app>.json
```

It reports leftovers (open features no ticket took); adjust the layout until there are
none, or until what's left is deliberately unticketed (panel-opening menu items that a
generic menu-command tool already runs, interactive tools with no scripted
equivalent).

## 2. Create the issues

```bash
DRY=1 APP_NAME="Photoshop" PKG=adobe-mcp-photoshop LABEL=photoshop node docs/handbook/scripts/create-issues.mjs photoshop
APP_NAME="Photoshop" PKG=adobe-mcp-photoshop LABEL=photoshop LABEL_COLOR=31A8FF node docs/handbook/scripts/create-issues.mjs photoshop
```

Epics are labelled `epic` and the app label; tickets are sub-issues of their epic and
list their feature ids. `<work>/state-<app>.json` records the numbers, so a rerun
resumes.

## 3. Build

Give each builder its app's brief from [briefs/](briefs/) plus: its slug, its epic and
ticket numbers, the PR title, and what other builders are doing at the same time (so
they don't overlap). Builders:

- create their worktree from `origin/main`, work only there;
- write tools and tests, claim features, record findings in
  `<work>/atlas-notes/<app>-<slug>.json`;
- rebase on `origin/main`, run `npm test --workspaces`, push, open a PR with
  `Closes #n` for each finished ticket, and report back. They don't merge.

Up to about ten builders at once works well; keep two builders off the same tool
table (for example Photoshop's ADJUSTMENTS and FILTERS in `adjust.js` were split
between two builders who were each told to touch only their own table).

## 4. Land

Start the landing worker once and leave it running:

```bash
docs/handbook/scripts/land-queue.sh &        # reads <work>/queue.txt, logs to <work>/queue.log
echo "<slug> <pr>" >> <work>/queue.txt
```

For each PR it checks commits and added lines for attribution text, merges
`origin/main` into the branch, resolves the conflicts that are safe to resolve
mechanically (registration lists in `src/server.js` and InDesign's
`src/tools/index.js`, README tables and NOTICE files by keeping both sides; one-line or
multi-line lists of quoted ids such as `features` by union; `docs/TOOLS.md` by
regenerating), runs every test, pushes, waits for CI and merges with a merge commit.
Anything else stops with "conflict in <file> needs a look": resolve it by hand in the
worktree, commit, and put the line back at the head of the queue.

Typical hand fixes:

- **Two builders made the same tool** (`sample_color`, `create_fill_layer`,
  `set_inks`, `manage_notes`): keep the richer one, delete the other with its tests,
  and add the deleted tool's feature ids to the kept tool's `features`.
- **Two builders edited the same tool's description or schema**: combine both
  changes by hand.
- **A test pinned an exact `features` list** and another area added an id: change the
  test to check the id is included.

## 5. Verify and close

```bash
git -C <worktrees>/main-view fetch -q && git -C <worktrees>/main-view checkout -q --detach origin/main
node docs/handbook/scripts/check-tickets.mjs <app> <worktrees>/main-view <ticket numbers...>
```

Every ticket should be `DONE` (each feature claimed or recorded as a finding). Merged
PRs close their tickets through `Closes #n`; close a ticket by hand when its PR only
referenced it, and close each epic once all its tickets are done:

```bash
gh issue close <epic> --repo zachshallbetter/adobe-mcp -c "All tickets in this epic are done: every feature is covered by a tool or recorded as not scriptable."
```

## 6. Record in the atlas

```bash
APP=<app> node docs/handbook/scripts/apply-notes.mjs <work>/atlas-notes/<app>-*.json
cd ../adobe-capability-atlas
node scripts/extract/<app>-tools.mjs <worktrees>/main-view/packages/<app>
node scripts/validate.mjs && node scripts/report.mjs && node scripts/atlas-data.mjs && node scripts/report-html.mjs
git add corpus/<app> reports && git commit -m "<App>: record the server's tools and findings" && git push
```

Then republish the coverage page (see the atlas's `docs/handbook/README.md`) and, if the app
is published, release it ([releasing.md](releasing.md)).

## Clean up

Remove a builder's worktree only after its PR has merged, and only if it holds nothing
but `node_modules` beyond the committed files:

```bash
git -C <worktree> status --porcelain --ignored     # nothing but node_modules
mv <worktree> ~/.Trash/ && git -C ~/Projects/adobe-mcp worktree prune
```

Never `git worktree remove --force`, and never run it on a symlink.
