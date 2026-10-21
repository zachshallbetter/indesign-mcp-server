# Builder brief: the parts every application shares

You are closing GitHub tickets in `zachshallbetter/adobe-mcp` by adding tools to one
application's server. Your assignment gives you a **slug**, an **epic** and its
**tickets**, a **PR title**, and what other builders are doing at the same time. Read
this file and your application's brief ([indesign.md](indesign.md),
[illustrator.md](illustrator.md), [photoshop.md](photoshop.md),
[aftereffects.md](aftereffects.md), [premiere.md](premiere.md)).

Read your tickets with `gh issue view <n> --repo zachshallbetter/adobe-mcp`. Each
lists exact atlas feature ids. **Every feature id in your tickets must end up claimed
by a tool's `features` (a new tool, or an existing tool that already performs it), or
recorded in your findings file as not scriptable, with the reason.**

## Set up

```bash
git -C ~/Projects/adobe-mcp fetch -q origin
git -C ~/Projects/adobe-mcp worktree add ~/Projects/adobe-mcp-wt/<slug> -b <app>-<slug> origin/main
cd ~/Projects/adobe-mcp-wt/<slug> && npm install
```

Work only in your worktree. Never touch `~/Projects/adobe-mcp` itself, other
worktrees, or `main`. Don't tag, merge, bump versions, or edit the root README or
`packages/suite`. Never delete files outside your worktree.

The atlas is at `~/Projects/adobe-capability-atlas` (read only for you):
`corpus/<app>/features/<domain>.json` has each feature's route, `dom_refs` or
`event_ids`, menu path and notes; `corpus/<app>/commands/commands.json` the menu
commands; `corpus/<app>/api/` the object model.

## Design

- Few well-grouped tools with enums and option objects, not one tool per property.
  `verb_noun` snake_case names that don't clash with **any** tool in the server or in
  the other packages (list them first; each standalone server owns its own tool list).
- Descriptions are plain and user-facing, naming the menu/panel/dialog in
  parentheses. Every parameter has a description. Validate arguments early with clear
  errors.
- Claim in `features` only what the tool performs. You may add feature ids to an
  **existing** tool's `features` when it already performs them; keep its behaviour
  unchanged.
- `hints`: `{ readOnly, destructive, idempotent, openWorld }`. `auditArgs` when generic
  sample arguments would be invalid.
- Match the surrounding code: a short JSDoc summary on each module and helper.

## Scripts

- Every caller value goes into a script through the core helpers (`str`, `num`,
  `index`, `bool`, `enumOf`, `json`, `jsxPath`). Never interpolate raw input. Every
  caller path goes through the package's path policy first.
- Never run a command that opens a modal dialog. If a feature's only route is a
  dialog, do it through the object model as the dialog describes, or record it as a
  finding.

## Tests and checks

Add `packages/<app>/tests/<slug>.test.js` using `tests/helpers.js` (`scriptsFor`
runs calls against a stubbed executor and audits each script; `server()` for
refusals). Check generated scripts carry the right statements, and that bad
arguments are refused. Assert a tool's `features` *include* an id rather than equal a
list. Then:

```bash
cd packages/<app> && npm test && npm run check
cd ../.. && npm test --workspaces
```

If you claim an atlas id the package's `tests/fixtures/feature-ids.json` lacks,
regenerate it (`node scripts/update-feature-ids.js` where present).

## Findings

Features nothing can reach unattended go in
`~/Projects/adobe-mcp-wt/_coord/atlas-notes/<app>-<slug>.json`:
`[{ "id", "route", "reason", "sources": [] }]`, sources as `https://` URLs only. Use
route `none` when nothing reaches it unattended (including a dialog-only command,
which you name); keep an existing route only when explaining a limit on a feature you
claimed. Don't edit the atlas.

## Commit and PR

- Plain imperative commit messages describing the change. **No attribution lines,
  and nothing about how the work was produced, in commits, the PR, code or
  comments.** Never bypass git hooks.
- Before committing, `git fetch origin && git rebase origin/main`, keeping every area
  in the registration file.
- Push and open a PR: `gh pr create --base main --title "<App>: <epic name>"`, body
  describing the tools and `Closes #<n>` for each ticket whose features are all
  accounted for. Don't merge.

## Report back

The PR URL; tools added; per ticket, how many features are claimed by new tools, by
existing tools, and in findings; the findings file path; anything uncertain (keys,
ids or values you took from memory or a single unverified source).
