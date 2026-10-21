---
name: github-projects
description: >-
  Fully manage GitHub Projects (ProjectsV2) — the org/user planning boards at
  github.com/orgs/<org>/projects/<n> — through the gh CLI and GraphQL API. Use
  this whenever the task involves a GitHub project board, roadmap, sprint, or
  backlog: creating or editing a project, adding issues/PRs to a board, creating
  draft issues, setting or reading Status / Priority / Estimate / iteration
  fields, moving items between columns, building or reporting on a board, bulk
  triage, or setting up custom fields and views. Trigger on phrases like "add
  this issue to the project", "set the status to In Progress", "what's on the
  board", "create a sprint field", "move done items", "Projects v2", "GitHub
  project board", or any github.com/orgs/.../projects/... URL — even when the
  user just says "the project" or "the board" in a GitHub context. Also covers
  multi-agent coordination on a board: claiming items so you can tell which agent
  works which, keeping a local board snapshot to avoid hammering the API, and
  running an autonomous coordinator that spawns cheap worker agents to resolve
  items (open PRs, verify, auto-merge). Trigger on "coordinate the board", "have
  agents work the backlog", "who's working what", "resolve the ready items". Covers
  everything the Projects feature can do, end to end.
---

# GitHub Projects (ProjectsV2)

## Requirements

Requires GitHub Projects v2 access and the GitHub CLI. Most board scripts also require `jq`; check each script's usage header. The optional ACP read path needs a configured gateway. Worker orchestration is optional and requires the Claude CLI. All scripts and references named below are included in this skill bundle.

> **Check for repository board policy first.** Before designing a board or
> choosing its field vocabulary, inspect the repository's agent guidance and
> board documentation (for example, `AGENTS.md` or `docs/PROJECT_BOARDS.md`).
> Follow local requirements for field templates, status values, evidence, and
> board creation. This skill provides general operating guidance; repository
> policy controls local conventions.

## Data handling and privacy

The bundled scripts make requests to GitHub using the active `gh` identity.
When the optional ACP read path is configured, board-read requests and the
configured bearer token go to that gateway. When optional worker orchestration
is used, the ticket prompt and selected role instructions are passed to the
locally installed Claude CLI. Local snapshots and coordinator logs can contain
board data. Use only services approved for the repository, minimize copied
issue content, and do not include credentials, private source files, or
unrelated personal data in tickets, prompts, logs, or board fields. Review the
destination and permissions before enabling automated workers or writes.

## Mental model

A project is `owner` (org or user login) + `number` (the integer in its URL).
It contains:
- **Fields** — columns. Built-in (Title, Status, Assignees, Labels, Milestone,
  Repository, Linked PRs) and custom (text, number, date, single-select, iteration).
- **Items** — rows. Each is a real **issue**, a real **PR**, or a **draft issue**.
- **Field values** — an item's value for a field (its Status, its Estimate…).

Everything is addressed by **opaque node IDs**. Setting one field value needs the
project ID + field ID + item ID together — and for single-select/iteration fields,
the option/iteration ID too. That ID-juggling is the whole difficulty; the bundled
scripts exist to erase it.

> **ProjectsV2 is GraphQL-only. There is no REST API.** The REST `/…/projects`
> endpoints are *classic* Projects (deprecated) and return 404/410 here. Use
> `gh project …` for common work and `gh api graphql` for the rest — never
> `gh api /orgs/.../projects`.

## Preflight (do this first)

Check the active GitHub host and account before working with a board:
```bash
gh auth status
```
Confirm that this identity can access the selected board and has the permissions
needed for the requested operation. Some `gh` authentication methods require the
`project` scope; an environment token may override the stored login. If access or
scope is missing, explain what is needed and let the operator choose whether to
change credentials. Private organization boards also require membership or an
installation with access; a 404 can indicate missing access.

Keep board changes limited to the user's requested work and the project's
authorization rules. Never put credentials, prompts, source files, or unrelated
private data into an issue, draft, field, or comment. Before using bulk, automated,
branch-protection, or merge operations, confirm the project's work item and
permissions authorize that exact effect.

## Reading through an ACP gateway (optional)

If the repository (or the environment) sets `ACP_GATEWAY_URL` — `lib.sh` also
reads it and `ACP_GATEWAY_TOKEN` from `<git-root>/.env.local` — every board
**read** goes through that gateway instead of your `gh` credentials:
`snapshot.sh`, `project-ids.sh` and `claims.sh` switch automatically, and no
`project` scope or GitHub App key is needed locally. Writes are unaffected:
the gateway is pull-only by design, so `add-item.sh`, `new-item.sh`,
`set-field.sh` and `claim.sh` keep using your own `gh` credentials.

With no gateway configured nothing changes — the scripts behave exactly as
documented everywhere else in this file.

**When a gateway read fails, read what it says.** Every refusal is JSON with a
stable `error` code, a `detail`, a `remedy` and the context needed to retry;
`lib.sh` prints all of it to stderr and exits `78`. Act on that text rather
than retrying or reaching for `ACP_ALLOW_NATIVE_GITHUB=1`:

| `error` | what it means |
|---|---|
| `OWNER_REQUIRED` / `PROJECT_REQUIRED` | the call named no board; the body lists the owners and boards the gateway can see |
| `PROJECT_NOT_ALLOWED` | the board is outside the gateway's `ACP_PROJECT_ALLOWLIST` — a deployment change, not a skill bug |
| `OWNER_NOT_INSTALLED` | the App is not installed on that account; the body carries the install URL |
| `PROJECTS_PERMISSION_MISSING` | the installation exists but holds no owner-level Projects permission |
| `APP_NOT_CONFIGURED` / `UPSTREAM_FAILURE` | gateway-side; check its `/internal/app-probe` |

With no board selected, the "no project selected" error also lists the owners
the gateway can read — or, when an owner is known, that owner's boards and
their numbers (`/internal/installations`, `/internal/projects?owner=`).

`tests/test_acp_context.sh` covers this path with a stubbed `curl`.

## Selecting the project (switch between boards)

Commands take `--owner <org-or-user> --project <number>`, but you can avoid repeating
them: pick an **active project** once and the scripts fall back to it.
```bash
scripts/project.sh use example-org 2     # set the active project (validated before saving)
scripts/project.sh current           # show it
scripts/project.sh list              # list the active owner's projects (★ = active)
scripts/project.sh list someorg      # list another owner's projects to switch to
scripts/project.sh use someorg 5     # switch boards
scripts/project.sh clear             # forget it
```
After `use`, the four scripts below run with **no** `--owner/--project`. Precedence:
an explicit flag **>** env `GH_PROJECT_OWNER`/`GH_PROJECT_NUMBER` (one-off override)
**>** the saved active project (`~/.config/github-projects/current`). Owner and
project values in examples are placeholders; select the board you intend to
manage before running a write command.

## The fast path: bundled scripts

Four scripts in `scripts/` handle the node-ID resolution that otherwise has to be
redone by hand every time. Prefer them over raw `item-edit`. They need `gh` + `jq`.
All accept `--owner/--project`, but fall back to the active project (above) when omitted.

**`new-item.sh`** — create an item and set its fields in **one command**. Pass `--repo`
to make a real issue (built-in fields auto-fill from it — the easy, recommended path);
omit it for a draft. See `references/conventions.md` for why real issues beat drafts.
```bash
scripts/new-item.sh --owner example-org --project 2 --repo example-org/generation \
  --title "SSRF guard on fetch-time URL allowlist" --label security \
  --set "Status=To triage" --set "Band=Wave 0" --set "Severity=High"
```

**`project-ids.sh <owner> <number>`** — the Rosetta stone. Resolves the project node
ID and every field's ID, data type, single-select options, and iterations in one
call (auto-detecting org vs user; `@me` works too). Run once, cache the JSON, reuse it.
```bash
scripts/project-ids.sh example-org 2
# → { projectId, title, fields:[{name,id,dataType,options,iterations}] }
```

**`set-field.sh`** — set item fields by **plain names**. Resolves the field ID and,
for single-select/iteration, the option/iteration ID; picks the right typed value
flag. Use repeatable `--set "Field=Value"` to set many fields in **one call** (it
resolves the project once) — prefer this in bulk loops. It prints a line per field
and exits non-zero if any field fails, so don't suppress its output.
```bash
scripts/set-field.sh --owner example-org --project 2 --item PVTI_xxx --field Status --value "In progress"
scripts/set-field.sh --owner example-org --project 2 --item PVTI_xxx --field "Target date" --value 2026-07-01
scripts/set-field.sh --owner example-org --project 2 --item PVTI_xxx --field Status --clear
# many fields at once:
scripts/set-field.sh --owner example-org --project 2 --item PVTI_xxx \
  --set "Status=In progress" --set "Effort=M" --set "Repos=generation"
```

**`add-item.sh`** — add an issue/PR by URL and print the new item ID, ready to pipe
into `set-field.sh` (idempotent — re-adding returns the same ID).
```bash
ITEM=$(scripts/add-item.sh --owner example-org --project 2 \
         --url https://github.com/example-org/systems/issues/42)
scripts/set-field.sh --owner example-org --project 2 --item "$ITEM" --field Status --value Ready
```

## Common operations at a glance

| Goal | How |
|------|-----|
| List an owner's projects | `gh project list --owner <o>` |
| View a project / its fields | `gh project view <n> --owner <o> [--format json]` |
| Create / edit / close a project | `gh project create\|edit\|close <n> --owner <o> …` |
| List items (raise the limit!) | `gh project item-list <n> --owner <o> --limit 500 --format json` |
| Add an existing issue/PR | `scripts/add-item.sh …` (or `gh project item-add`) |
| Create a draft issue | `gh project item-create <n> --owner <o> --title "…"` |
| Set a field value | `scripts/set-field.sh …` |
| Read custom field values | CLI list (lowercased keys) or GraphQL `fieldValues` for node IDs — `references/graphql.md` |
| Create a field | `gh project field-create <n> --owner <o> --name … --data-type …` |
| Archive / delete an item | `gh project item-archive\|item-delete <n> --owner <o> --id PVTI_xxx` |
| Link project to a repo | `gh project link <n> --owner <o> --repo <repo>` |
| Convert draft → real issue | GraphQL `convertProjectV2DraftIssueItemToIssue` — see `references/graphql.md` |
| Claim an item for an agent | `scripts/claim.sh --item PVTI_xxx` (id = git branch/worktree; `--agent` to override) |
| See who's working what | `scripts/claims.sh` · hand off with `scripts/release.sh --item … --status …` |
| Look up an item id by name | `scripts/snapshot.sh id "W0.7"` (offline, from the local snapshot) |
| Refresh the local board model | `scripts/snapshot.sh` → `<git-root>/.board_snapshot.jsonl` (+ `.tsv` view) |
| Coordinator views (offline) | `scripts/coord.sh summary\|ready\|orphans\|stale\|mine\|prs\|done-open` |

## Traps that waste the most time

- **`item-list` defaults to 30 items** — pass `--limit` or you process a partial board.
- **`item-list --format json` keys custom fields by lowercased name** — `"Estimate"`
  → `.estimate`, `"Target date"` → `."target date"` (it does *not* omit them). Use the
  GraphQL `fieldValues` query only when you need node IDs or exact name mapping.
- **`field-list --format json` uses `type` (a typename), not `dataType`** — the
  GraphQL API and `project-ids.sh` use `dataType`. Don't cross the two in jq.
- **`updateProjectV2Field` replaces the whole option/iteration set** — omitting an
  existing option deletes it. Fetch current options first, pass them all back.
- **Single-select needs the option *ID*, not its label** — `set-field.sh` handles it.
- **Assignees/Labels/Milestone/Repository live on the issue, not the item** — set
  them with `gh issue edit`, not `item-edit`; they then appear as board columns.
- **Built-in workflows (auto-add, auto-archive, "closed → Done") aren't API-scriptable**
  — configure once in the UI or replicate with your own scheduled script/Action.
- **Reserved field names** — you can't create a custom field named `Repo`, `Repository`,
  `Status`, or any built-in (error: "Name cannot have a reserved value"). Use `Repos`,
  `Component`, etc.
- **Bulk loops run in *your* shell (often zsh), not bash** — in zsh, unquoted `$var`
  doesn't word-split (don't stash a command in a variable and call it), and `status` is
  a reserved read-only variable (don't use it as a loop var). These cause silent loader
  failures; see the bulk-load recipe and `references/gotchas.md` #14.

Full list with explanations: `references/gotchas.md`.

## Script index

Each script has a usage header. Board scripts generally need `gh` and `jq`; other
prerequisites vary by script. Check its usage header before running it. Scripts
accept `--owner/--project` where applicable or fall back to the active project.

**Items & fields**

| Script | Does |
|--------|------|
| `project-ids.sh` | Resolve a project's node IDs — project + every field/option/iteration (the "Rosetta stone") |
| `new-item.sh` | Create an item (real issue with `--repo`, else a draft) and set its fields in one call |
| `add-item.sh` | Add an existing issue/PR by URL; print the new project-item ID |
| `set-field.sh` | Set field value(s) by plain name (`--set "F=V"`, repeatable) or `--clear` |
| `project.sh` | Pick/switch the active project: `use` / `current` / `list` / `clear` |
| `lib.sh` | Shared helpers (sourced, not run directly): active-project resolution + free snapshot auto-align |

**Local board model**

| Script | Does |
|--------|------|
| `snapshot.sh` | Build/refresh the rich `.board_snapshot.jsonl` (+ `.tsv` view); `find` / `id` / `get` lookups |
| `coord.sh` | Offline views over the snapshot: `summary` `ready` `orphans` `stale` `mine` `prs` `done-open` |
| `repo-map.sh` | `generate` / `resolve` — turn a `Repos` hint into repo path + owner/name + crate |

**Multi-agent & autonomy**

| Script | Does |
|--------|------|
| `claim.sh` | Claim an item (Agent=branch + In progress) with pre-check + post-verify |
| `release.sh` | Release a claim (clear Agent), optionally move Status |
| `claims.sh` | Who's working what, grouped by agent (+ orphaned / stale-claim anomalies) |
| `spawn.sh` | Spawn a headless Claude CLI worker for one ticket (`--role`, `--resume` for rework; requires the Claude CLI) |
| `coordinator.sh` | Autonomous loop: pick → claim → worktree → resolve → verify → PR → CI-gated auto-merge → blame/retry |
| `protect.sh` | Enable a required CI check on a repo branch (opt a repo into safe auto-merge) |

Worker role prompts live in `assets/roles/{resolver,verifier,triager}.md`.

## Files this skill creates

Caches/artifacts written at the fleet root — all safe to add to `.gitignore`:

- `.board_snapshot.jsonl` / `.board_snapshot.tsv` — the local board model (`snapshot.sh`)
- `.repo_map.tsv` — category/service → repo path · owner/name · crate (`repo-map.sh`)
- `.coord-log/<item-id>.log` — the coordinator's blame / attempt trail
- `~/.config/github-projects/current` — the active project (`project.sh`; machine-local, per-user)

## Binding a repository to its board

Drop `<git-root>/.agents/board.env` in a repo and every script in this skill
targets that board from anywhere inside it — no flags, no active-project state:

```bash
# .agents/board.env — committed; the gateway secret lives in .env.local
GH_PROJECT_OWNER=example-org
GH_PROJECT_NUMBER=37
GP_FIELD_STATUS=Lifecycle          # this board's workflow field
GP_STATUS_ACTIVE=In Progress       # ...and its state names
GP_STATUS_REVIEW=In Review
GP_FIELD_BAND=Phase
```

Only `GH_PROJECT_OWNER`, `GH_PROJECT_NUMBER` and `GP_*` keys are honoured, the
file is parsed rather than sourced (a repo file must not run code), and an
exported environment variable always wins over it.

## Using it on another board

Nothing is hardwired to a specific org or project. **Owner + project** are fully
parameterized — pass `--owner <org-or-user> --project <number>` to any command, or set a
default once with `project.sh use <owner> <number>`.

The **coordinator / claim layer** additionally assumes a field schema — an `Agent` field,
`Status` values `Ready` / `In progress` / `In review`, and the `Band` / `Repos` / `Gate`
customs. Those are **configurable via env vars** (defaults are illustrative), so a
board with a different schema just exports the differences:
```bash
export GP_FIELD_AGENT=Owner   GP_FIELD_STATUS=Status   GP_FIELD_REPOS=Repos
export GP_STATUS_READY=Todo   GP_STATUS_ACTIVE="In Progress"   GP_STATUS_REVIEW="In review"
```
The full set with defaults is at the top of `scripts/lib.sh`. The low-level
project/item/field/snapshot scripts need no vocabulary — they already work on any board.
(The board it manages also needs an `Agent` text field for claiming; add one with
`gh project field-create <n> --owner <o> --name Agent --data-type TEXT`.)

## Where to go next

Stay in this file for the common 80%. Read a reference file when you need depth:

- **`references/conventions.md`** — how to create items so it's easy and the fields
  fill themselves: prefer real issues over drafts (auto-fill table), keep the field
  set minimal, single-selects for manual fields, body ≠ data. Also covers **multi-agent
  claiming** — how agents stamp the `Agent` field so you can tell who's working what,
  and why claiming is best-effort. Read this before designing a board or bulk-loading.
- **`references/coordinator.md`** — the full coordinator story: the local board model
  (`snapshot.sh` → `.board_snapshot.jsonl`) kept aligned for free, offline `coord.sh`
  views (ready/orphans/stale/prs/done-open), the repo map (`repo-map.sh`), PR
  verification, spawning cheap `claude -p` workers (`spawn.sh` + `assets/roles/`), and
  the autonomous `coordinator.sh` runner (claim → resolve → verify → PR → CI-gated
  auto-merge → blame/retry). Read this to drive the kanban or automate resolution.
- **`references/cli.md`** — every `gh project` subcommand, its flags, and JSON
  parsing patterns. Start here for routine board operations.
- **`references/graphql.md`** — the GraphQL queries/mutations for what the CLI can't
  do: reading custom field values, pagination, creating iteration fields, editing
  single-select options, converting drafts, views, bulk updates.
- **`references/recipes.md`** — copy-paste end-to-end workflows (triage an issue with
  a status, bulk-add by label, move a whole column, snapshot the board as a report,
  stand up a project with custom fields).
- **`references/gotchas.md`** — the complete failure-mode catalog. Read it when an
  error or empty result doesn't make sense.

For destructive changes (delete, bulk move), verify the exact target and obtain
explicit authorization for that effect. On a shared board, use a reversible probe
only when its creation and cleanup are authorized and the probe cannot affect
other users' work.

## About the author

Created by **Zach Shallbetter**, a Product & Systems Engineer who builds
software systems, applied AI tools, and digital products. More about his work:
[zachshallbetter.com](https://zachshallbetter.com/) ·
[GitHub](https://github.com/zachshallbetter).
