#!/usr/bin/env bash
#
# snapshot.sh — maintain a local model of the board so agents (especially a
# coordinator) don't hammer the API. Canonical output is JSONL — one rich object per
# item — at <git-root>/.board_snapshot.jsonl, with a flat TSV view derived alongside
# (.board_snapshot.tsv: nodeID  band  status  agent  title).
#
# Each JSONL record:
#   { id, type, title, number, url, state, repository, isArchived, createdAt,
#     updatedAt, assignees[], labels[], milestone, linkedPRs[{url,number,state}],
#     fields{Status,Band,Effort,Severity,Gate,Repos,Agent,…} }
#
#   snapshot.sh                 regenerate JSONL + TSV (full pull — the reconcile)
#   snapshot.sh find <query>    rows matching <query> (id status agent title)
#   snapshot.sh id   <query>    just the node id(s) matching <query>
#   snapshot.sh get  <id>       the full JSON record for one item
#
# --owner/--project optional (active project). Our own writes patch the JSONL for free
# (see lib.sh gp_snapshot_set_field); run a full regen to pick up outside changes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

SUB="generate"; case "${1:-}" in find|id|get) SUB="$1"; shift;; generate) shift;; esac
OWNER="" PROJECT="" BASE="" QUERY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --out)     BASE="$2"; shift 2;;          # base path; .jsonl/.tsv appended
    -*) echo "error: unknown flag '$1'" >&2; exit 2;;
    *)  QUERY="$1"; shift;;
  esac
done
gp_resolve; gp_require_target
[ "$OWNER" = "@me" ] && OWNER="$(gh api user -q .login)"
[ -n "$BASE" ] && { GH_SNAPSHOT_FILE="$BASE"; }
JSONL="$(gp_snapshot_jsonl)"; TSV="$(gp_snapshot_tsv)"

# Per-item → one JSON record. Shared by every page.
JQ_RECORD='.[] | . as $n | ($n.content // {}) as $c | {
  id: $n.id, type: $n.type, title: ($c.title // "—"),
  number: ($c.number // null), url: ($c.url // null), state: ($c.state // null),
  repository: ($c.repository.nameWithOwner // null),
  isArchived: $n.isArchived, createdAt: $n.createdAt, updatedAt: $n.updatedAt,
  assignees: [ $c.assignees.nodes[]?.login ],
  labels: [ $c.labels.nodes[]?.name ],
  milestone: ($c.milestone.title // null),
  linkedPRs: ( [ $c.closedByPullRequestsReferences.nodes[]? | {url,number,state} ]
    + (if $n.type=="PULL_REQUEST" then [{url:$c.url, number:$c.number, state:$c.state, isDraft:$c.isDraft, reviewDecision:$c.reviewDecision}] else [] end) ),
  fields: ( [ $n.fieldValues.nodes[]? | select(.field.name!=null)
              | {(.field.name): (.name // .text // .date // .title // .number)} ] | add // {} )
}'

content_frag='content{ __typename
  ... on DraftIssue{ title }
  ... on Issue{ title number url state repository{nameWithOwner}
    assignees(first:10){nodes{login}} labels(first:20){nodes{name}} milestone{title}
    closedByPullRequestsReferences(first:10){nodes{url number state}} }
  ... on PullRequest{ title number url state isDraft reviewDecision repository{nameWithOwner}
    assignees(first:10){nodes{login}} labels(first:20){nodes{name}} milestone{title} } }'
fv_frag='fieldValues(first:50){nodes{ __typename
  ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}
  ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}
  ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2FieldCommon{name}}}
  ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{name}}}
  ... on ProjectV2ItemFieldIterationValue{title field{... on ProjectV2FieldCommon{name}}} }}'

# Org or user root? probe once.
# Native path only: the gateway resolves the owner root itself, and that mode
# must not need gh auth.
ROOT="organization"
if ! gp_acp_enabled && [ -z "$(gh api graphql -f query="query{organization(login:\"$OWNER\"){projectV2(number:$PROJECT){id}}}" 2>/dev/null | jq -r '.data.organization.projectV2.id // empty')" ]; then
  ROOT="user"
fi

regen() {
  : > "$JSONL.tmp"
  if gp_acp_enabled; then
    gp_acp_context | jq -c '.snapshot.items.nodes' | jq -c "$JQ_RECORD" > "$JSONL.tmp"
    mv "$JSONL.tmp" "$JSONL"
    jq -r '[.id, (.fields[env.GP_FIELD_BAND]//""), (.fields[env.GP_FIELD_STATUS]//""), (.fields[env.GP_FIELD_AGENT]//""), .title] | @tsv' "$JSONL" > "$TSV"
    return 0
  fi
  local cursor="" A r
  while :; do
    if [ -z "$cursor" ]; then A="null"; else A="\"$cursor\""; fi
    r=$(gh api graphql -f query="query{${ROOT}(login:\"$OWNER\"){projectV2(number:$PROJECT){items(first:100,after:$A){
      pageInfo{hasNextPage endCursor}
      nodes{ id type isArchived createdAt updatedAt $content_frag $fv_frag } }}}}" 2>/dev/null)
    echo "$r" | jq -c ".data.${ROOT}.projectV2.items.nodes | $JQ_RECORD" >> "$JSONL.tmp"
    [ "$(echo "$r" | jq -r ".data.${ROOT}.projectV2.items.pageInfo.hasNextPage")" = "true" ] || break
    cursor="$(echo "$r" | jq -r ".data.${ROOT}.projectV2.items.pageInfo.endCursor")"
  done
  mv "$JSONL.tmp" "$JSONL"
  # derive the flat TSV view
  jq -r '[.id, (.fields[env.GP_FIELD_BAND]//""), (.fields[env.GP_FIELD_STATUS]//""), (.fields[env.GP_FIELD_AGENT]//""), .title] | @tsv' "$JSONL" > "$TSV"
}

if [ "$SUB" = "generate" ]; then
  regen
  echo "wrote $(grep -c . "$JSONL" 2>/dev/null || echo 0) items → $JSONL (+ .tsv view)"
  exit 0
fi

# Lookups read the JSONL (fall back to the TSV if that's all there is).
: "${QUERY:?usage: snapshot.sh $SUB <query>}"
if [ -f "$JSONL" ]; then
  case "$SUB" in
    get)  jq -c --arg id "$QUERY" 'select(.id==$id)' "$JSONL" | jq . ;;
    find) grep -i -- "$QUERY" "$JSONL" | jq -r '[.id,(.fields[env.GP_FIELD_STATUS]//"—"),(.fields[env.GP_FIELD_AGENT]//"-"),.title]|@tsv' ;;
    id)   grep -i -- "$QUERY" "$JSONL" | jq -r '.id' ;;
  esac
elif [ -f "$TSV" ]; then
  m="$(grep -i -- "$QUERY" "$TSV" || true)"
  [ -n "$m" ] || { echo "no match for '$QUERY'" >&2; exit 1; }
  case "$SUB" in find) printf '%s\n' "$m";; id) printf '%s\n' "$m"|cut -f1;; get) printf '%s\n' "$m";; esac
else
  echo "no snapshot yet — run: snapshot.sh" >&2; exit 1
fi
