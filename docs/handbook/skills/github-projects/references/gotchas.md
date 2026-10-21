# Gotchas — why project automation fails

These are the failure modes that turn a five-minute task into an hour. Read this
before debugging a confusing error.

## 1. ProjectsV2 is GraphQL-only — there is no REST
The REST `/orgs/{org}/projects` and `/projects/{id}` endpoints are **classic
Projects**, a separate deprecated product. They return 404/410 for the boards you
see in the modern UI. Anything you can't do with `gh project …` goes through
`gh api graphql`, never `gh api /…/projects`.

## 2. The `project` token scope is mandatory
Every command fails without it. Classic PATs and `GITHUB_TOKEN` often lack it.
Check `gh auth status` for `project` in the scope list; add with
`gh auth refresh -s project`. If a `GITHUB_TOKEN` env var is set, *that* token is
used over the keyring one — verify the right token's scopes.

## 3. Three different IDs, easy to confuse
- **Project node ID** — `PVT_…` (the board itself)
- **Field node ID** — `PVTF_…` / `PVTSSF_…` (single-select) / `PVTIF_…` (iteration)
- **Item node ID** — `PVTI_…` (a row on the board)
- **Option / iteration ID** — short hex like `47fc9ee4` (a choice *within* a field)

`updateProjectV2ItemFieldValue` and `gh project item-edit` need **project + field +
item** IDs together, and for single-select/iteration also the **option/iteration**
ID. The item ID is *not* the issue's node ID — an issue gets a fresh `PVTI_…` per
project it's added to. `scripts/set-field.sh` resolves all of this from names.

## 4. Single-select wants the option ID, not the label
`--single-select-option-id 47fc9ee4`, never `--single-select-option-id "In progress"`.
Map the name to its ID first (`project-ids.sh` lists them). Same for iterations
(`--iteration-id`, matched by iteration title).

## 5. `item-list` defaults to 30 items
Real boards have more. Always pass `--limit` (e.g. `--limit 500`) or you'll silently
process a partial board. GraphQL pages cap at 100 — loop on `pageInfo.endCursor`.

## 6. The CLI item-list keys custom fields by lowercased name
`gh project item-list --format json` **does** include custom field values (verified) —
but each is keyed by the field name **lowercased, spaces preserved**: a field named
"Target date" appears as `."target date"`, "Estimate" as `.estimate`. Single-select
shows the option name string; iteration shows an object `{title,startDate,duration}`.
That's fine for quick reads, but it's lossy — two fields differing only in case
collide, and you don't get node IDs. When you need the field/option **node IDs**, an
exact name→value mapping, or iteration internals, use the GraphQL `fieldValues` query
(graphql.md / recipe 5) instead.

## 7. Built-in fields aren't set on the project item
Assignees, Labels, Milestone, Repository are properties of the underlying issue/PR.
Setting them means `gh issue edit …`, not `item-edit`. They then appear as board
columns automatically. Trying to `item-edit` them fails with a data-type error.

## 8. Draft issues are second-class until converted
A draft (`item-create`) has no number, no repo, no assignees/labels, and can't be
referenced from code. To make it real, `convertProjectV2DraftIssueItemToIssue`
(GraphQL, needs a repo node ID). The CLI can't convert.

## 9. Built-in workflows aren't scriptable via the API
The project's automation ("auto-add items", "when issue closed → Done", auto-archive)
is configured in the web UI and is **not** exposed for create/edit through the public
GraphQL schema. If you need that behavior in automation, either configure it once in
the UI, or replicate it yourself with a scheduled `gh` script / GitHub Action.

## 10. Org vs user owner
`--owner` is an org login *or* a user login; the GraphQL root differs
(`organization(login:)` vs `user(login:)`). A query written for one returns `null`
for the other — that null is not an error, just the wrong root. `project-ids.sh`
tries both so you don't have to know which it is.

## 11. Eventual consistency on counts
`item-list`'s `totalCount` and a board's item count can lag a few seconds after a
create/delete. If a count looks off right after a mutation, re-query before
concluding something failed.

## 11a. Destructive and silent commands print nothing on success
`gh project delete`, `item-archive`, and `item-delete` succeed **silently** (exit 0,
no stdout) — absence of output is not failure; re-query to confirm. More dangerous:
`updateProjectV2Field` with `singleSelectOptions` **replaces the entire option set**.
Any existing option you omit is deleted (and its item values lost). Always fetch the
current options first (`project-ids.sh`) and pass them all back, adding/renaming
within that full list. The same full-replacement rule applies to `iterationConfiguration`.

## 12. Visibility and permissions
Private org projects are invisible to tokens without org membership/permission even
*with* `project` scope. A 404 on a project you can see in the browser usually means
the token's account lacks access, not that the number is wrong.

## 13. Reserved field names
You cannot create a custom field named after a built-in or a reserved word —
`field-create` fails with `GraphQL: Name cannot have a reserved value` (verified).
Reserved/taken names include every built-in (**Title, Assignees, Status, Labels,
Linked pull requests, Milestone, Repository, Reviewers, Parent issue, Sub-issues
progress, Created, Updated, Closed**) **and abbreviations like `Repo`**. Pick a
distinct name — e.g. `Repos`, `Component`, `Service`, `Workstream`.

## 14. Scripting in a loop? Your shell is the trap, not the API
The bundled scripts run under `bash` (shebang), but **a loop you type runs in your
interactive shell, which is often `zsh`** on macOS. Three zsh behaviors silently
break project-loading loops (each has bitten real runs):

- **Unquoted `$var` does NOT word-split in zsh.** Stashing a command in a variable
  and calling it (`SF="scripts/set-field.sh --owner …"; $SF`) tries to run one
  program literally named `scripts/set-field.sh --owner …` → "command not found",
  often swallowed. Call the script directly with normal arguments; don't build a
  command string. (In `for x in $list`, words also won't split — use an array or
  literal words.)
- **`status`, `path`, `pipestatus` are reserved/read-only in zsh.** `read -r title status …`
  or `for status in …` fails or silently misbehaves. Name loop variables something
  else (`st`, `state`).
- **`printf -v VAR` is a bashism** zsh lacks. Build multi-line strings with `$'…\n…'`.

Two more safety habits, both learned the hard way:
- **`gh … --format json` is always valid JSON** (newlines in draft bodies are
  escaped — verified; it is *not* a gh bug). Prefer gh's built-in `--jq '…'` for
  filtering: it parses internally, with no external pipe or shell-quoting risk.
  If you do pipe to external `jq`, quote the producer/variable.
- **Don't suppress `set-field.sh` output.** It prints a confirmation per field on
  success and a clear error on failure, and now exits non-zero if any field fails —
  but only if you let those signals through. Hiding stdout/stderr reintroduces the
  silent-failure trap. When setting many fields, use one `--set "A=x" --set "B=y"`
  call per item (see recipes.md) so there's less loop to get wrong.

## 15. A live working board should not be marked as a template
`projectV2.template` is a real flag (shown as a "Private template" badge). A template
is meant to be **copied** to spawn new projects, not used as your day-to-day board.
If your live board shows that badge, it was marked by mistake (`gh project mark-template`
or the UI). Check and unset it — note `updateProjectV2` has **no** `template` field; use
the dedicated mutation (verified):
```bash
# is it a template?
gh api graphql -f query='query{organization(login:"OWNER"){projectV2(number:N){template}}}'
# unset it:
gh api graphql -f query='mutation($p:ID!){unmarkProjectV2AsTemplate(input:{projectId:$p}){projectV2{template}}}' -f p=PVT_xxx
# (markProjectV2AsTemplate sets it.)
```

## 16. All-drafts board: the symptom cluster
If a board's items are all **draft issues**, you'll see empty `Created`/`Updated`
("None yet"), an empty built-in `Repository` (prompting someone to bolt on a manual
"Repos" field), no assignees/labels, and no link from code. That's not a bug — it's
the cost of drafts. Make actionable items **real issues** instead; the built-ins then
fill themselves. See `references/conventions.md`.
