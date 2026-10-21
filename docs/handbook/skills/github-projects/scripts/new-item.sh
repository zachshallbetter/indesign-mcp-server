#!/usr/bin/env bash
#
# new-item.sh — Create a board item the easy way, in one command.
#
# Two modes, picked by whether you pass --repo:
#   * --repo owner/name  → creates a REAL issue, then adds it. The built-in fields
#     (Repository, Assignees, Labels, Milestone, Created, Updated, Linked PRs) then
#     populate themselves — nothing to type. This is the recommended path.
#   * no --repo          → creates a DRAFT issue (for an unscoped idea). Drafts leave
#     all those built-ins empty ("None yet"), so only use them when there's no repo yet.
#
# Either way, --set "Field=Value" (repeatable) fills the project-only fields in the
# same call. Prints the project item ID (and the issue URL, in --repo mode).
#
# Usage:
#   new-item.sh --owner <o> --project <n> --title "<t>" [--body "<b>"] \
#     [--repo owner/name] [--label <l> ...] [--set "Field=Value" ...]
#
# Examples:
#   # real issue — Repository/Assignees/Labels auto-fill from the issue:
#   new-item.sh --owner example-org --project 2 --repo example-org/generation \
#     --title "SSRF guard on fetch-time URL allowlist" --label security \
#     --set "Status=To triage" --set "Band=Wave 0" --set "Severity=High" --set "Effort=M"
#
#   # draft — only the project fields you set:
#   new-item.sh --owner example-org --project 2 --title "Spike: cache layer" \
#     --set "Status=Backlog" --set "Band=Wave 0" --set "Effort=S"
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OWNER="" PROJECT="" TITLE="" BODY="" REPO=""
LABELS=() SETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --title)   TITLE="$2"; shift 2;;
    --body)    BODY="$2"; shift 2;;
    --repo)    REPO="$2"; shift 2;;
    --label)   LABELS+=("$2"); shift 2;;
    --set)     SETS+=("$2"); shift 2;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
. "$SCRIPT_DIR/lib.sh"
gp_resolve; gp_require_target          # --owner/--project optional; fall back to active project
: "${TITLE:?--title required}"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

if [ -n "$REPO" ]; then
  iargs=(gh issue create -R "$REPO" --title "$TITLE" --body "$BODY")
  if [ "${#LABELS[@]}" -gt 0 ]; then for l in "${LABELS[@]}"; do iargs+=(--label "$l"); done; fi
  URL="$("${iargs[@]}")"
  echo "issue: $URL"
  ITEM="$("$SCRIPT_DIR/add-item.sh" --owner "$OWNER" --project "$PROJECT" --url "$URL")"
else
  dargs=(gh project item-create "$PROJECT" --owner "$OWNER" --title "$TITLE")
  [ -n "$BODY" ] && dargs+=(--body "$BODY")
  dargs+=(--format json)
  ITEM="$("${dargs[@]}" | jq -r '.id')"
fi

if [ "${#SETS[@]}" -gt 0 ]; then
  sargs=("$SCRIPT_DIR/set-field.sh" --owner "$OWNER" --project "$PROJECT" --item "$ITEM")
  for s in "${SETS[@]}"; do sargs+=(--set "$s"); done
  "${sargs[@]}"
fi
echo "$ITEM"
