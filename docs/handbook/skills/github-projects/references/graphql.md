# ProjectsV2 GraphQL reference

Use GraphQL for everything the `gh project` CLI cannot do: **reading custom field
values per item, creating/configuring views and iteration fields, editing
single-select options, converting drafts to issues, bulk updates, and full
pagination.** Run it through `gh api graphql` so it inherits your auth.

> REST does not exist for ProjectsV2. The REST `/orgs/{org}/projects` and
> `/projects/*` endpoints are **classic Projects** (a different, deprecated
> product). Never reach for them — they return 410/404 for new projects.

Pattern for every call:
```bash
gh api graphql -f owner=example-org -F number=2 -f query='…'
```
`-f` passes a string variable, `-F` a typed (int/bool) variable. Inside the query,
GraphQL variables are `$owner`, `$number`, etc.

## Contents
- [Resolve project + field IDs](#resolve-project--field-ids)
- [Read items with custom field values](#read-items-with-custom-field-values)
- [Pagination](#pagination)
- [Set field values (the canonical mutation)](#set-field-values-the-canonical-mutation)
- [Add / create / archive / delete items](#add--create--archive--delete-items)
- [Convert a draft into a real issue](#convert-a-draft-into-a-real-issue)
- [Iteration fields](#iteration-fields)
- [Single-select option editing](#single-select-option-editing)
- [Views](#views)
- [Built-in fields and sub-issues](#built-in-fields-and-sub-issues)

> **Every query below uses the `organization(login:)` root.** For a **user-owned**
> project, swap it to `user(login:)` — the org root returns `{"organization": null}`
> with **no `errors` key**, which looks like success but yields nothing. Also note
> `@me` is a gh-CLI-ism, *not* a valid GraphQL login: resolve it first with
> `gh api user -q .login`. `scripts/project-ids.sh` handles both for you (tries each
> root, translates `@me`), so prefer it when you can.

## Resolve project + field IDs

`scripts/project-ids.sh <owner> <number>` wraps this and auto-detects org vs user.
The raw query (org form):
```graphql
query($owner: String!, $number: Int!) {
  organization(login: $owner) {           # or: user(login: $owner)
    projectV2(number: $number) {
      id title
      fields(first: 50) { nodes {
        ... on ProjectV2FieldCommon { id name dataType }
        ... on ProjectV2SingleSelectField { options { id name } }
        ... on ProjectV2IterationField { configuration { iterations { id title startDate } } }
      } }
    }
  }
}
```

## Read items with custom field values

The CLI list already includes custom values (lowercased keys — see cli.md), so reach
for this query when you need the field/option **node IDs**, an exact case-sensitive
name mapping, or full iteration internals. `fieldValues` returns the typed value for
every populated field on each item:
```bash
gh api graphql -f owner=example-org -F number=2 -f query='
query($owner: String!, $number: Int!) {
  organization(login: $owner) { projectV2(number: $number) {
    items(first: 50) { nodes {
      id
      content { __typename
        ... on Issue        { number title url state }
        ... on PullRequest  { number title url state }
        ... on DraftIssue   { title body }
      }
      fieldValues(first: 20) { nodes {
        __typename
        ... on ProjectV2ItemFieldTextValue        { text       field { ... on ProjectV2FieldCommon { name } } }
        ... on ProjectV2ItemFieldNumberValue      { number     field { ... on ProjectV2FieldCommon { name } } }
        ... on ProjectV2ItemFieldDateValue        { date       field { ... on ProjectV2FieldCommon { name } } }
        ... on ProjectV2ItemFieldSingleSelectValue{ name       field { ... on ProjectV2FieldCommon { name } } }
        ... on ProjectV2ItemFieldIterationValue   { title      field { ... on ProjectV2FieldCommon { name } } }
      } }
    } }
  } }
}'
```

## Pagination

Both `items` and `fields` cap at 100 per page. Loop on `pageInfo`:
```graphql
items(first: 100, after: $cursor) {
  pageInfo { hasNextPage endCursor }
  nodes { id }
}
```
Pass `-F cursor=<endCursor>` on each subsequent call until `hasNextPage` is false.
The CLI's `--limit` does this for you on `item-list`; GraphQL you drive yourself.

## Set field values (the canonical mutation)

`scripts/set-field.sh` wraps this for plain names. The raw mutation:
```bash
gh api graphql -f query='
mutation($project:ID!, $item:ID!, $field:ID!) {
  updateProjectV2ItemFieldValue(input:{
    projectId:$project, itemId:$item, fieldId:$field,
    value:{ singleSelectOptionId: "47fc9ee4" }   # one of the value shapes below
  }) { projectV2Item { id } }
}' -f project=PVT_xxx -f item=PVTI_xxx -f field=PVTSSF_xxx
```
`value` accepts exactly one of:
- `text: "…"`
- `number: 5`
- `date: "2026-07-01"`
- `singleSelectOptionId: "<option-id>"`
- `iterationId: "<iteration-id>"`

To clear a value use `clearProjectV2ItemFieldValue(input:{projectId, itemId, fieldId})`.

## Add / create / archive / delete items

```graphql
# add existing issue/PR (you need the content's node ID, e.g. from `gh issue view --json id`)
mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item{ id } } }

# create a draft
mutation($p:ID!){ addProjectV2DraftIssue(input:{projectId:$p, title:"…", body:"…"}){ projectItem{ id } } }

# edit a draft's title/body in bulk (CLI does one at a time via item-edit --title/--body).
# Needs the DRAFT's node ID (the DI_… content id), not the PVTI_ item id.
mutation($d:ID!){ updateProjectV2DraftIssue(input:{draftIssueId:$d, title:"…", body:"…"}){ draftIssue{ id } } }

mutation($p:ID!,$i:ID!){ archiveProjectV2Item(input:{projectId:$p, itemId:$i}){ item{ id } } }
mutation($p:ID!,$i:ID!){ unarchiveProjectV2Item(input:{projectId:$p, itemId:$i}){ item{ id } } }
mutation($p:ID!,$i:ID!){ deleteProjectV2Item(input:{projectId:$p, itemId:$i}){ deletedItemId } }
```

`gh project item-list` hides archived items, so to **find what's archived** (e.g. to
restore it) query `isArchived` directly — it's the only way to enumerate them:
```bash
gh api graphql -f owner=example-org -F number=2 -f query='
query($owner:String!,$number:Int!){ organization(login:$owner){ projectV2(number:$number){
  items(first:100){ nodes { id isArchived content{ ... on Issue { title } ... on DraftIssue { title } } } } } } }' \
  | jq -r '.data.organization.projectV2.items.nodes[] | select(.isArchived) | "\(.id)\t\(.content.title)"'
```

## Convert a draft into a real issue

The CLI can't do this. Draft → issue requires the target repository's node ID:
```graphql
mutation($item:ID!, $repo:ID!) {
  convertProjectV2DraftIssueItemToIssue(input:{ itemId:$item, repositoryId:$repo }) {
    item { id content { ... on Issue { number url } } }
  }
}
```
Get the repo node ID with `gh repo view OWNER/REPO --json id -q .id`.

## Iteration fields

The CLI cannot create iteration fields. Two things to know, both verified against
the live API:

- Creating one **without** `iterationConfiguration` succeeds but yields an **empty**
  field (`iterations: []`) — GitHub does **not** auto-seed a cadence. You then can't
  assign a sprint until iterations exist (set the cadence in the project UI, or pass
  a configuration as below).
- If you pass `iterationConfiguration`, its `iterations` list is **required**
  (`[ProjectV2Iteration!]!`); each element needs `startDate` (YYYY-MM-DD),
  `duration` (days), and `title`, all non-null.

Create a *usable* iteration field with two sprints:
```bash
gh api graphql -f query='
mutation($p:ID!){
  createProjectV2Field(input:{
    projectId:$p, dataType:ITERATION, name:"Sprint",
    iterationConfiguration:{ startDate:"2026-06-09", duration:14, iterations:[
      { startDate:"2026-06-09", duration:14, title:"Sprint 1" },
      { startDate:"2026-06-23", duration:14, title:"Sprint 2" }
    ] }
  }){ projectV2Field { ... on ProjectV2IterationField { id
        configuration { iterations { id title startDate } } } } }
}' -f p=PVT_xxx
```
After creating, read the iteration IDs back with `scripts/project-ids.sh` before
assigning them — `scripts/set-field.sh --field Sprint --value "Sprint 2"` matches by
title and will error clearly if the field has no iterations yet.

**Add/replace iterations on an *existing* field** with the same
`iterationConfiguration` on `updateProjectV2Field`. Like option editing below, this is
a **full replacement** — list every iteration you want to keep, or it's dropped:
```bash
gh api graphql -f query='
mutation($f:ID!){
  updateProjectV2Field(input:{ fieldId:$f, iterationConfiguration:{
    startDate:"2026-06-09", duration:14,
    iterations:[ { startDate:"2026-06-09", duration:14, title:"Sprint 1" } ] } }){
    projectV2Field { ... on ProjectV2IterationField { configuration { iterations { id title } } } } }
}' -f f=PVTIF_xxx
```

## Single-select option editing

The CLI can only set options at field-create time. To add/rename/reorder options
later, `updateProjectV2Field` takes the option list — but this is a **full
replacement, not a merge**. ⚠️ Any existing option you leave out is **deleted**, and
every item that held it loses that value. So **always fetch the current options first
and pass them all back**, editing within the complete list:
```bash
# 1. read current options (keep their ids to preserve history)
scripts/project-ids.sh example-org 2 | jq '.fields[] | select(.name=="Priority").options'
# 2. send the FULL set — existing entries keep their id; new ones omit id
gh api graphql -f query='
mutation($f:ID!){
  updateProjectV2Field(input:{ fieldId:$f, singleSelectOptions:[
    { id:"<existing-id>", name:"P0", color:RED,    description:"" }
    { id:"<existing-id>", name:"P1", color:ORANGE, description:"" }
    {                     name:"P2", color:GRAY,   description:"" }   # new option
  ] }){ projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } }
}' -f f=PVTSSF_xxx
```
Colors are an enum (RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE, PINK, GRAY). `name`,
`color`, and `description` are all **required** per option (use `""` for no description).

> Build this list as a **GraphQL literal** — unquoted keys, bare enum colors:
> `{ name:"P0", color:RED, description:"" }`. Do **not** splice `jq` output straight
> in: JSON's quoted keys (`{"name":"P0","color":"RED"}`) are invalid GraphQL and fail
> with `Expected NAME, actual: STRING`. To build it programmatically, either emit the
> literal yourself or pass the options as a typed query **variable**
> (`$opts:[ProjectV2SingleSelectFieldOptionInput!]!`) rather than interpolating text.

## Views

Views (Board/Table/Roadmap layouts, their grouping/sorting/filters) are read-only
through the public API for the most part:
```graphql
views(first: 20) { nodes { id name layout number } }
```
Creating and fully configuring views (`createProjectV2View`, slice/group settings)
is partially supported and changes between schema versions — confirm against the
current schema (`gh api graphql -f query='query{__type(name:"Mutation"){fields{name}}}' | jq` )
before relying on a mutation. For most automation you set filters in the UI once and
drive items/fields via the API.

## Built-in fields and sub-issues

Assignees, Labels, Milestone, and Repository are **properties of the underlying
issue/PR**, not project-item field values. Set them on the issue itself:
```bash
gh issue edit 42 --repo example-org/systems --add-assignee alice --add-label bug --milestone "v1"
```
They then surface as columns on the board automatically. Sub-issue progress and
Parent issue likewise derive from the issue graph (`gh issue edit --add-sub-issue`).
