#!/usr/bin/env bash
#
# claim.sh — claim a board item for the current agent (self-claim + verify).
#
# Identity defaults to the current git branch/worktree name (your fleet runs each
# agent in its own `.wt/` worktree, so that's unique and links the item to the
# branch/PR). Override with --agent.
#
# Contention is handled best-effort in two steps, because ProjectsV2 has no atomic
# compare-and-set:
#   1. pre-check — if the item already shows a *different* agent, refuse (unless --force)
#   2. claim     — set Agent=<id> and Status=In progress in one call
#   3. verify    — after a short delay, re-read; if Agent isn't yours, you lost the race
#
# Usage:
#   claim.sh --item <PVTI_…> [--agent <id>] [--status "In progress"] [--force] [--verify-delay 2]
#   (--owner/--project optional — falls back to the active project; see project.sh)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

OWNER="" PROJECT="" ITEM="" AGENT="" STATUS="$GP_STATUS_ACTIVE" FORCE=0 DELAY=2
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)        OWNER="$2"; shift 2;;
    --project)      PROJECT="$2"; shift 2;;
    --item)         ITEM="$2"; shift 2;;
    --agent)        AGENT="$2"; shift 2;;
    --status)       STATUS="$2"; shift 2;;
    --force)        FORCE=1; shift;;
    --verify-delay) DELAY="$2"; shift 2;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
gp_resolve; gp_require_target
: "${ITEM:?--item required}"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

# Agent id = git branch/worktree name unless given.
if [ -z "$AGENT" ]; then
  AGENT="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [ "$AGENT" = "HEAD" ] && AGENT=""    # detached
fi
[ -n "$AGENT" ] || { echo "error: no --agent and no git branch detected. Pass --agent <id>." >&2; exit 2; }
case "$AGENT" in main|master|trunk)
  echo "warning: agent id is '$AGENT' — that's a shared branch, not a per-agent worktree; claims won't be unique." >&2 ;;
esac

# Read the item's current Agent (text) + Status (single-select) in one query.
read_item() {
  gh api graphql -f id="$ITEM" -f query='query($id:ID!){node(id:$id){... on ProjectV2Item{
    fieldValues(first:50){nodes{
      __typename
      ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}
      ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}
    }}}}}' 2>/dev/null \
  | jq -r '[.data.node.fieldValues.nodes[]?] as $n
    | (([$n[]|select(.field.name==env.GP_FIELD_AGENT)|.text]|first) // "") as $a
    | (([$n[]|select(.field.name==env.GP_FIELD_STATUS)|.name]|first) // "") as $s
    | "\($a)\t\($s)"'
}

cur="$(read_item)"; cur_agent="${cur%%	*}"; cur_status="${cur#*	}"
if [ -n "$cur_agent" ] && [ "$cur_agent" != "$AGENT" ] && [ "$FORCE" -ne 1 ]; then
  echo "refused: '$ITEM' already claimed by '$cur_agent' (status: ${cur_status:-—}). Use --force to steal." >&2
  exit 3
fi

"$SCRIPT_DIR/set-field.sh" --owner "$OWNER" --project "$PROJECT" --item "$ITEM" \
  --set "$GP_FIELD_AGENT=$AGENT" --set "$GP_FIELD_STATUS=$STATUS" >/dev/null

# Verify — a delay lets a competing write land so we can detect a lost race.
[ "${DELAY:-0}" -gt 0 ] 2>/dev/null && sleep "$DELAY" || true
after="$(read_item)"; after_agent="${after%%	*}"
if [ "$after_agent" != "$AGENT" ]; then
  echo "LOST RACE: '$ITEM' now shows '$after_agent', not '$AGENT'. Yield to them." >&2
  exit 3
fi
echo "claimed $ITEM as '$AGENT' (status: $STATUS)"
