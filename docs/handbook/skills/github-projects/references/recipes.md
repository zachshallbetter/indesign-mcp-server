# Recipes — end-to-end project workflows

Copy-paste workflows that chain the primitives. They assume `OWNER=example-org`
and a project `NUM`. Scripts referenced live in `../scripts/`.

## 1. Triage an issue onto the board with a status

The most common operation: take an existing issue, put it on the board, set Status.
```bash
ITEM=$(scripts/add-item.sh --owner "$OWNER" --project "$NUM" \
         --url https://github.com/example-org/systems/issues/42)
scripts/set-field.sh --owner "$OWNER" --project "$NUM" --item "$ITEM" --field Status --value "To triage"
```

## 2. Capture a quick idea as a draft, then promote it later

```bash
# create a draft (no repo needed yet)
ITEM=$(gh project item-create "$NUM" --owner "$OWNER" --title "Spike: cache layer" --format json | jq -r '.id')
scripts/set-field.sh --owner "$OWNER" --project "$NUM" --item "$ITEM" --field Status --value Backlog

# later: convert it into a real tracked issue in a repo
REPO_ID=$(gh repo view example-org/systems --json id -q .id)
gh api graphql -f query='
mutation($item:ID!,$repo:ID!){
  convertProjectV2DraftIssueItemToIssue(input:{itemId:$item, repositoryId:$repo}){
    item{ content{ ... on Issue { number url } } } } }' \
  -f item="$ITEM" -f repo="$REPO_ID"
```

## 3. Bulk-add every open issue with a label

```bash
gh issue list --repo example-org/systems --label "needs-triage" --state open \
  --json url -q '.[].url' | while read -r url; do
  scripts/add-item.sh --owner "$OWNER" --project "$NUM" --url "$url" >/dev/null
  echo "added $url"
done
```

## 4. Move all "In review" items to "Done"

```bash
PROJECT_ID=$(scripts/project-ids.sh "$OWNER" "$NUM" | jq -r '.projectId')
gh project item-list "$NUM" --owner "$OWNER" --limit 500 --format json \
  | jq -r '.items[] | select(.status=="In review") | .id' \
  | while read -r item; do
      scripts/set-field.sh --owner "$OWNER" --project "$NUM" --item "$item" --field Status --value Done
    done
```

## 5. Snapshot the board as a status report

Reads custom field values with their field node IDs via GraphQL. (The CLI list also
carries the values as lowercased keys; use GraphQL when you need the IDs or exact
names.) This assumes an **org** owner — for a user/`@me` project, swap
`organization(login:)` → `user(login:)` (and `.data.organization` → `.data.user` in
the jq), resolving `@me` first with `gh api user -q .login`:
```bash
gh api graphql -f owner="$OWNER" -F number="$NUM" -f query='
query($owner:String!,$number:Int!){
  organization(login:$owner){ projectV2(number:$number){
    items(first:100){ nodes {
      content{ __typename
        ... on Issue { number title url }
        ... on DraftIssue { title } }
      fieldValues(first:20){ nodes{
        ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon { name } } } } } } } } } }' \
  | jq -r '.data.organization.projectV2.items.nodes[]
           | (.content.title) as $t
           | (.fieldValues.nodes[] | select(.field.name=="Status") | .name) as $s
           | "\($s // "—")\t\($t)"' | sort
```

## 6. Set up a fresh project with custom fields

```bash
gh project create --owner "$OWNER" --title "Refinement Board"      # note the new NUM in output
gh project field-create "$NUM" --owner "$OWNER" --name "Priority" --data-type SINGLE_SELECT \
  --single-select-options "P0,P1,P2,P3"
gh project field-create "$NUM" --owner "$OWNER" --name "Estimate"    --data-type NUMBER
gh project field-create "$NUM" --owner "$OWNER" --name "Target date" --data-type DATE
gh project link "$NUM" --owner "$OWNER" --repo systems              # show it on the repo's Projects tab
```

## 7. Find an item's ID from its issue URL

You often have the issue URL but need the project-item ID to edit fields:
```bash
ISSUE_URL="https://github.com/example-org/systems/issues/42"
ITEM=$(gh project item-list "$NUM" --owner "$OWNER" --limit 500 --format json \
        | jq -r --arg u "$ISSUE_URL" '.items[] | select(.content.url==$u) | .id')
```
(Re-adding via `add-item.sh` is simpler and idempotent — it returns the same ID.)

## 8. Sync Status into a repo label (one-way mirror)

```bash
# Note: loop var is `st`, NOT `status` — `status` is read-only in zsh (gotchas.md #14).
gh api graphql -f owner="$OWNER" -F number="$NUM" -f query='…items+Status+content.number…' \
  | jq -r '… "\(.number) \(.status)"' \
  | while read -r num st; do
      gh issue edit "$num" --repo example-org/systems --add-label "status:$st"
    done
```
(Expand the first line with the query from recipe 5; this is a sketch of the join.)

## 9. Bulk-load a backlog of draft items with fields (zsh-safe)

The common "seed N items, each with Status/Effort/Repos" flow. The traps that bite
here are all shell-level (gotchas.md #14), so this pattern is deliberately defensive:
loop var names avoid zsh reserved words, the scripts are called directly (never via a
command-in-a-variable), and each item's fields land in a single `--set` call.

```bash
OWNER=example-org; NUM=2

# 1. Use the project's REAL Status options (they differ per project). Print them first:
scripts/project-ids.sh "$OWNER" "$NUM" | jq -r '.fields[] | select(.name=="Status").options[].name'

# 2. Rows are TAB-separated: title <TAB> status <TAB> effort <TAB> repos
#    (set-field exits non-zero on a bad value, so a typo in a Status name is loud.)
while IFS=$'\t' read -r title st eff repos; do
  [ -z "$title" ] && continue
  item=$(gh project item-create "$NUM" --owner "$OWNER" --title "$title" --format json | jq -r '.id')
  scripts/set-field.sh --owner "$OWNER" --project "$NUM" --item "$item" \
    --set "Status=$st" --set "Effort=$eff" --set "Repos=$repos"
done <<'ROWS'
W0.1 freeze clean-main	Done	S	generation
W0.2 build convention	Done	M	compute
W0.3 retire cloudbuild	Ready	S	brokers
ROWS

# 3. Verify with gh's built-in --jq (valid JSON, no external pipe):
gh project item-list "$NUM" --owner "$OWNER" --limit 500 --format json \
  --jq '.items[] | "\(.title) | \(.status) | \(.effort) | \(.repos)"'
```

If you're more comfortable in `bash`, wrap the whole loop in `bash -c '…'` to sidestep
the zsh word-split / reserved-variable quirks entirely.
