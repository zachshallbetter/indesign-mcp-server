# Conventions for creating items

Goal: make adding a board item fast, consistent, and **as automatic as possible**.
The big lever is using **real issues instead of drafts** — that alone makes most
fields fill themselves.

## The one rule that does the most work: prefer real issues over drafts

When a board item is a real issue (or PR), GitHub auto-populates the built-in fields
from the issue. When it's a draft, every one of them stays empty. Verified:

| Field | Real issue | Draft issue |
|---|---|---|
| Repository | **auto** (from the issue's repo) | empty — you'd need a manual field |
| Assignees / Labels / Milestone | **auto** (carried from the issue) | empty |
| Created / Updated | **auto** (real timestamps) | "None yet" |
| Linked pull requests / sub-issues | **auto** | empty |
| Can be referenced by `Fixes #`, commits, PRs | yes | no |

So: file the issue in its repo, add it to the board, set only the few *project-only*
fields. Reserve drafts for ideas with no repo yet — and convert them
(`convertProjectV2DraftIssueItemToIssue`, see graphql.md) once they're real work.
Security findings and anything actionable should be real issues in the owning repo,
not drafts on a board.

## The easy path: `new-item.sh`

One command creates the item and sets its fields. Pass `--repo` to make a real issue
(built-ins auto-fill); omit it for a draft.

```bash
# real issue — Repository/Assignees/Labels fill themselves:
scripts/new-item.sh --owner example-org --project 2 --repo example-org/generation \
  --title "SSRF guard on fetch-time URL allowlist" --label security \
  --set "Status=To triage" --set "Band=Wave 0" --set "Severity=High" --set "Effort=M"

# draft — only for an unscoped idea:
scripts/new-item.sh --owner example-org --project 2 --title "Spike: cache layer" \
  --set "Status=Backlog" --set "Band=Wave 0" --set "Effort=S"
```
For many items at once, see the bulk-load recipe (recipes.md #9).

## Keep the field set minimal

Every field you keep is a field someone has to consider on every item. Audit the board
and **delete fields nothing uses** — empty fields are safe to delete (no data lost).
Check what actually holds values before deciding:

```bash
# count how many items populate each field (single-select / number / date / iteration)
gh api graphql -f query='query{organization(login:"OWNER"){projectV2(number:N){items(first:100){nodes{fieldValues(first:40){nodes{
  __typename ... on ProjectV2ItemFieldSingleSelectValue{field{... on ProjectV2FieldCommon{name}}}}}}}}}}' ... # paginate
```

Guidelines:
- **One field per concept.** Don't keep `Size` *and* `Estimate` *and* `Effort` — pick one.
- **Don't shadow built-ins.** A manual `Repos` text field duplicates the built-in
  `Repository` (which auto-fills for real issues). Drop the manual one once items are issues.
- **Drop the template defaults you don't use.** New projects ship with `Priority`,
  `Size`, `Estimate`, `Iteration`, `Start date`, `Target date`. Delete the ones you
  won't fill rather than leaving them empty on every card.

## Make manual fields one-click

For the fields you *do* keep that need a human (program phase, sizing, severity), use
**single-select** types, not free text. One click, constrained values, no typos, and
`set-field.sh` resolves them by name. Free-text fields (like `Gate`) are fine for prose
that has no fixed vocabulary.

## The body is for description, not data

Don't restate structured fields in the draft/issue body (e.g. a body that says
"Gate: …  Repos: …" when those are already fields). It's double entry that drifts out
of sync. Put the *why/context* in the body; put structured values in fields.

## Let creation defaults do their job

- New items inherit the project's **default Status** automatically — you usually don't
  need to set it unless it differs.
- With real issues, Repository/Assignees/Labels/Milestone need no action at all.
- That typically leaves only 2–3 project-only fields to set per item (e.g. Band,
  Effort, Severity) — one `--set …` call.

## Who's working which item (multi-agent claiming)

All agents act through the **same GitHub token**, so `creator` and `Assignees` are
identical across them — GitHub-native attribution can't tell agents apart. The only
way to know which agent owns an item is for the agent to **stamp an identifier into a
field**. The board carries an `Agent` (text) field for this; the id is the agent's
**git branch / worktree name** (each agent runs in its own `.wt/` worktree, so it's
unique and links the item to its branch/PR).

```bash
scripts/claim.sh   --item PVTI_xxx                 # claim for the current branch (auto-detected)
scripts/claim.sh   --item PVTI_xxx --agent wave0-w07   # or name it explicitly
scripts/claims.sh                                  # report: who's working what (+ anomalies)
scripts/release.sh --item PVTI_xxx --status "In review"  # done — clear Agent, move Status
```

**Claiming is best-effort, not a lock.** ProjectsV2 has no atomic compare-and-set, so
`claim.sh` does what it can: it **pre-checks** (refuses if another agent already holds
the item, unless `--force`), writes `Agent` + `Status=In progress`, then **re-reads**
after a short delay to catch a lost race (exit 3 = you lost, yield). Two agents can
still occasionally collide; if you need a hard guarantee, partition the work up front
or route claims through a single coordinator instead of self-claiming.

`claims.sh` also flags two things worth watching: items **In progress with no Agent**
(active but unattributed) and items with an **Agent but not In progress** (a likely
stale claim — `release.sh` it). Treat a claim as stale if its branch is gone or its
PR merged.

## A local board snapshot for fast lookup

On a board with hundreds of items, paginating the API just to answer "what's the node
id of W0.7?" is slow. Keep a local snapshot — a TSV of every item — at the project root
and look items up offline. Columns: `nodeID  band  status  agent  title`.

```bash
scripts/snapshot.sh                # refresh <git-root>/.board_snapshot.tsv
scripts/snapshot.sh id   "W0.7"    # → node id (pipe into claim.sh)
scripts/snapshot.sh find "auth"    # → every row mentioning "auth"

# claim an item by name, no full-board query:
ID=$(scripts/snapshot.sh id "W0.7"); scripts/claim.sh --item "$ID"
```

The snapshot is a **cache, not the source of truth** — its one failure mode is
staleness, so regenerate after bulk changes and treat a missing/odd lookup as "refresh
first." Generate it cleanly with `snapshot.sh` rather than ad-hoc exports (an appended
loop can triple the file). It's a generated artifact — add `.board_snapshot.tsv` to
`.gitignore` so it doesn't clutter a clean `main`.
