# Running a coordinator over the board

A coordinator agent resolves drafts/issues, drives the kanban, and verifies PRs. The
trick to doing that without hammering the GitHub API is to keep a **local model of the
board** and read from it, refreshing only as needed.

## The model: `.board_snapshot.jsonl`

`snapshot.sh` writes one rich JSON object per item to `<git-root>/.board_snapshot.jsonl`
(plus a flat `.board_snapshot.tsv` view). Each record:

```json
{ "id":"PVTI_…", "type":"DRAFT_ISSUE|ISSUE|PULL_REQUEST", "title":"…",
  "number":42, "url":"…", "state":"OPEN|MERGED|CLOSED", "repository":"example-org/generation",
  "isArchived":false, "createdAt":"…", "updatedAt":"…",
  "assignees":["…"], "labels":["…"], "milestone":"…",
  "linkedPRs":[{"url":"…","number":5,"state":"OPEN"}],
  "fields":{"Status":"Ready","Band":"Wave 0","Effort":"M","Severity":"…","Gate":"…","Repos":"…","Agent":"…"} }
```

This is the coordinator's source of truth between refreshes — query it with `jq` or
`coord.sh`, never re-paginate the board just to read.

## Keeping it aligned (the API economy)

- **Your own writes are free.** `set-field.sh` (and thus `claim.sh`/`release.sh`/
  `new-item.sh`) patch the changed item's line in the JSONL using the value they just
  wrote — no extra API call. So as the coordinator works, its model stays current.
- **Outside changes need a refresh.** Edits from other agents or the web UI aren't
  visible until you run `snapshot.sh` (a full pull: ~⌈items/100⌉ GraphQL calls). Refresh
  at the top of each coordinator cycle, or after a batch — not per item.
- **`coord.sh` and lookups cost zero API** — they read the local files.
- New items appear only after a refresh (auto-align updates existing lines, not new ones).
- Disable auto-align with `GH_SNAPSHOT=off`; relocate the file with `GH_SNAPSHOT_FILE`.

> The snapshot is a **cache, not the truth**. Before a decision that depends on
> freshness (e.g. "is this still unclaimed?"), refresh — or rely on `claim.sh`'s own
> pre-check/verify, which reads the live item.

## Coordinator views (`coord.sh`, all offline)

```bash
scripts/snapshot.sh            # refresh the model first
scripts/coord.sh summary       # counts by Status, Band, and who's claiming what
scripts/coord.sh ready         # claimable: Status=Ready, no Agent   → id  title
scripts/coord.sh orphans       # Status=In progress but NO Agent (active, unattributed)
scripts/coord.sh stale         # Agent set but Status≠In progress (dead claim → release)
scripts/coord.sh mine          # items claimed by the current branch
scripts/coord.sh prs           # items with linked PRs:  state  url  title
scripts/coord.sh done-open     # Status=Done but a linked PR isn't MERGED (needs a look)
```

## A coordinator cycle

```bash
scripts/snapshot.sh                                   # 1. reconcile the model
scripts/coord.sh orphans; scripts/coord.sh stale      # 2. heal: attribute/clear bad claims
for row in $(scripts/coord.sh ready | cut -f1); do    # 3. dispatch ready work
  scripts/claim.sh --item "$row" --agent dispatcher   #    (or hand the id to a worker)
done
scripts/coord.sh prs                                  # 4. verify PRs (state from the snapshot)
#    deeper check status, per PR:  gh pr checks <url>  /  gh pr view <url> --json reviewDecision,mergeable
scripts/coord.sh done-open                            # 5. catch Done items whose PR never merged
```

## Verifying PRs

The snapshot carries each item's `linkedPRs` and their `state` (and for PR-type items,
`reviewDecision`/`isDraft`). That's enough to triage. For the actual check run — green
or red — call the CLI on demand (it's authoritative and cheap per PR):

```bash
gh pr checks <pr-url>                                  # CI status
gh pr view  <pr-url> --json state,reviewDecision,mergeable,statusCheckRollup
```

Fold the result back onto the item with `set-field.sh` (e.g. `--set "Status=In review"`
or `Done`), which keeps the snapshot aligned for free.

## Autonomous mode: spawning micro-agents

Everything above is the coordinator's *senses* (the model) and *hands* (the board
scripts). To actually resolve work it **spawns cheap headless `claude -p` workers** —
one per ticket, minimal context, smallest sufficient model — via `spawn.sh`.

### Roles (`assets/roles/<role>.md` = each worker's system prompt)

| Role | Model | Tools | Job |
|------|-------|-------|-----|
| **Resolver** | haiku→sonnet | Read/Edit/Write/Bash in a worktree | smallest correct change, build/test, commit+push a branch |
| **Verifier** | haiku | Read/Bash (no Edit) | independently build/test + read the diff; judge pass/fail |
| **Triager** | haiku | Read/Bash (board only) | classify To-triage; set Band/Effort/Severity; dedupe |

Each role prompt ends in a required JSON verdict the coordinator parses. `spawn.sh`
prints the worker's `session=<id>` — capture it to **resume the same worker** with
failure feedback (`spawn.sh --role resolver --resume <id> --ticket "what was wrong"`):
that reuses its context and is the send-back-on-incorrect rework loop.

```bash
scripts/spawn.sh --role resolver --dir "$PROJECT_DIR" --ticket "<assembled ticket>"
scripts/spawn.sh --role verifier --dir "$PROJECT_DIR" --ticket "verify item X, PR <url>, gate <…>"
```

### The runner (`coordinator.sh`)

Give it the project dir + board and it drives the loop: refresh → pick Ready →
hold-guard → claim → spawn Resolver (worktree/branch) → spawn Verifier → green: open PR
+ `gh pr merge --auto` + Status → red: blame to `.coord-log/<id>.log` and resume the
Resolver, bounded by `--max-retries` → exhausted: return to Ready.

```bash
scripts/coordinator.sh --queue ready --max-items 3            # DRY RUN — plan only, no spawns
scripts/coordinator.sh --queue ready --max-items 1 --apply    # do ONE item, supervised
scripts/coordinator.sh --queue triage --apply --no-merge      # triage only, never merge
```

**Safety rails:** dry-run by default; bounded by `--max-items`/`--max-retries`; skips
HELD/blocked items; merges via `--auto` so red/required-pending CI never merges;
worktrees only (never the main checkout); yields on a lost claim race. The `--apply`
path makes real, auto-merging changes on the live fleet — **supervise the first runs.**

## Queue mode (the repo map) and merge safety

**Working the queue unattended.** The coordinator no longer needs `--repo`/`--repo-path`.
`repo-map.sh` builds `<fleet-root>/.repo_map.tsv` (`key → repo_path, owner/name, crate`)
by scanning each repo's *own* tracked manifests (`git ls-files`, so a parent never
absorbs a nested repo/submodule's crates). For each Ready item the coordinator resolves
the board's `Repos` hint through it:

```bash
scripts/repo-map.sh generate            # (re)scan the fleet; rerun after adding/moving repos
scripts/repo-map.sh resolve "compute (geometry-runtime)"   # → repo_path  owner/name  crate
scripts/coordinator.sh --queue ready --max-items 5 --apply # now resolves each item's repo itself
```
Genuinely fleet-wide items (`all 39 repos`, `fleet-wide`, `… across all …`) are **skipped**
as not-single-PR work. An explicit `--repo`/`--repo-path` always overrides the map.

**Auto-merge is gated on real CI.** `--auto` only completes a merge once *required* checks
pass — but a repo with **no** required checks would merge immediately. So the coordinator
checks `has_required_checks(repo, base)` first and **withholds** auto-merge where green
isn't enforced (the PR is left for a human). To opt a repo into safe auto-merge, enable a
required check:

```bash
scripts/protect.sh example-org/compute main "build"   # require the "build" CI check (needs repo admin)
```
Until you do that, `--apply` (even with merge on) behaves as propose-only for that repo —
which is the safe default.
