# `gh project` CLI reference

The `gh project` command group covers ~80% of GitHub Projects work without touching
GraphQL. Every command takes the project **number** (the integer in the URL, e.g. `2`
in `/orgs/example-org/projects/2`) plus `--owner`. The owner is an **org login**
or a **user login**; use `@me` for the authenticated user's own projects.

All read commands accept `--format json` and `-q/--jq <expr>` for parsing. Prefer
JSON + jq over scraping the human table output.

## Contents
- [Preflight](#preflight)
- [Project lifecycle](#project-lifecycle)
- [Fields](#fields)
- [Items](#items)
- [Linking](#linking)
- [Output and parsing](#output-and-parsing)

## Preflight

```bash
gh auth status                      # confirm logged in; look for 'project' in token scopes
gh auth refresh -s project          # add project scope if missing (interactive)
```
The token MUST carry the `project` scope (read+write) or `read:project` (read only).
Without it every command fails with a scope error. `GITHUB_TOKEN` in the environment
overrides the keyring token — verify *that* token's scopes if results surprise you.

## Project lifecycle

```bash
# List projects for an owner (number, title, state, node ID)
gh project list --owner example-org
gh project list --owner @me --closed          # include closed

# View one project (fields, counts, URL). --web opens it in a browser.
gh project view 2 --owner example-org
gh project view 2 --owner example-org --format json

# Create. Prints the new project's URL and number.
gh project create --owner example-org --title "Q3 Roadmap"

# Edit metadata
gh project edit 2 --owner example-org --title "New title"
gh project edit 2 --owner example-org --description "..." --readme "## How we work…"
gh project edit 2 --owner example-org --visibility PUBLIC   # or PRIVATE

# Copy (duplicate fields/views into a new project; --drafts keeps draft items)
gh project copy 2 --source-owner example-org --target-owner example-org --title "Q4 Roadmap"

# Templates
gh project mark-template 2 --owner example-org            # org templates only
gh project close 2 --owner example-org                    # --undo to reopen
gh project delete 2 --owner example-org                   # irreversible
```

## Fields

```bash
# List fields (id, name, type; single-select options included in JSON)
gh project field-list 2 --owner example-org --format json

# Create fields. data-type ∈ {TEXT, SINGLE_SELECT, DATE, NUMBER}
gh project field-create 2 --owner example-org --name "Estimate" --data-type NUMBER
gh project field-create 2 --owner example-org --name "Target date" --data-type DATE
gh project field-create 2 --owner example-org --name "Priority" --data-type SINGLE_SELECT \
  --single-select-options "P0,P1,P2,P3"

# Delete a field (needs the field's node ID from field-list)
gh project field-delete --id PVTF_xxxxx
```

The CLI **cannot create ITERATION fields**, edit a field's name, or add/remove
single-select options after creation. Those need GraphQL — see `graphql.md`.

**Reserved names:** a custom field cannot reuse a built-in or reserved name —
`field-create` returns `GraphQL: Name cannot have a reserved value`. That includes
every built-in (Title, Assignees, Status, Labels, Linked pull requests, Milestone,
Repository, Reviewers, Parent issue, Sub-issues progress, Created, Updated, Closed)
**and abbreviations like `Repo`**. Use a distinct name (`Repos`, `Component`, …).

## Items

An "item" is a row on the board: a real issue, a real PR, or a draft issue. Every
item has its own node ID (`PVTI_…`), distinct from the issue/PR's own node ID.

```bash
# List items. DEFAULT LIMIT IS 30 — always raise it for real boards.
gh project item-list 2 --owner example-org --limit 200 --format json

# Add an existing issue/PR by URL (idempotent — re-adding returns the same item)
gh project item-add 2 --owner example-org --url https://github.com/example-org/systems/issues/42

# Create a draft issue (lives only inside the project until "converted")
gh project item-create 2 --owner example-org --title "Spike: evaluate X" --body "notes…"

# Edit a single field value per call. Needs item ID + project ID + field ID.
# Value flag must match the field's data type:
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTF_xxx --text "hello"
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTF_xxx --number 5
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTF_xxx --date 2026-07-01
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTSSF_xxx --single-select-option-id 47fc9ee4
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTIF_xxx --iteration-id <iter-id>
gh project item-edit --id PVTI_xxx --project-id PVT_xxx --field-id PVTF_xxx --clear   # unset

# Edit a DRAFT item's own title/body (no project-id needed for these)
gh project item-edit --id PVTI_xxx --title "new title" --body "new body"

# Archive keeps the item (recoverable); delete removes the row from the project.
gh project item-archive 2 --owner example-org --id PVTI_xxx          # --undo to restore
gh project item-delete 2 --owner example-org --id PVTI_xxx
```

> The fiddly part is supplying three node IDs and the right value flag — especially
> mapping a single-select *name* ("In progress") to its *option ID* (`47fc9ee4`).
> Use `scripts/set-field.sh` instead; it resolves everything from plain names.

## Linking

Link a project to a repo or team so it appears in that repo/team's Projects tab and
can power auto-add workflows.

```bash
gh project link   2 --owner example-org --repo systems
gh project link   2 --owner example-org --team platform
gh project unlink 2 --owner example-org --repo systems
```

## Output and parsing

```bash
# Map every item to "status | title"
gh project item-list 2 --owner example-org --limit 200 --format json \
  | jq -r '.items[] | "\(.status // "—") | \(.title)"'

# Just the IDs of items currently "In progress"
gh project item-list 2 --owner example-org --limit 200 --format json \
  | jq -r '.items[] | select(.status=="In progress") | .id'

# Field node IDs by name
gh project field-list 2 --owner example-org --format json \
  | jq -r '.fields[] | "\(.name)\t\(.id)"'
```

Two parsing facts worth knowing (both verified, easy to trip on):

- **`item-list --format json` *includes* custom field values**, keyed by the field
  name **lowercased, spaces preserved** — `"Estimate"` → `.estimate`, `"Target date"`
  → `."target date"`. Single-select → option-name string; iteration → an object
  `{title,startDate,duration}`. Reach for the GraphQL `fieldValues` query (graphql.md)
  only when you need node IDs, an exact (case-sensitive) name mapping, or to
  disambiguate fields whose lowercased names collide.
- **`field-list --format json` uses `type`, not `dataType`.** The key is `type` with
  a GraphQL *typename* value (`"ProjectV2SingleSelectField"`), and `dataType` is null
  here. The GraphQL API and `scripts/project-ids.sh` use `dataType`
  (`"SINGLE_SELECT"`). Don't write jq against `field-list` expecting `.dataType`.

```bash
# correct: read every item's Estimate from the CLI list (lowercased key)
gh project item-list 2 --owner example-org --limit 200 --format json \
  | jq -r '.items[] | "\(.title): \(.estimate // "—")"'
```
