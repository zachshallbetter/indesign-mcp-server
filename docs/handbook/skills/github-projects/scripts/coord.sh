#!/usr/bin/env bash
#
# coord.sh — coordinator views over the local snapshot (no API calls; reads the JSONL
# that snapshot.sh maintains). For an agent that resolves drafts/issues, runs the
# kanban, and verifies PRs.
#
#   coord.sh summary        counts by Status, Band, and who's claiming what
#   coord.sh ready          claimable work: Status=Ready with no Agent  (id  title)
#   coord.sh mine [agent]   items claimed by <agent> (default: current git branch)
#   coord.sh orphans        Status=In progress but NO Agent (active, unattributed)
#   coord.sh stale          Agent set but Status≠In progress (likely a dead claim)
#   coord.sh prs            items with linked PRs:  state  url  title  (for verification)
#   coord.sh done-open      Status=Done but a linked PR isn't MERGED (needs attention)
#
# Field/status names come from the board vocabulary (lib.sh: GP_FIELD_*, GP_STATUS_*),
# so this works on any board's schema — override those env vars for a non-example-org board.
# Refresh the model first with `snapshot.sh`; coord.sh never hits the API itself.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

VIEW="${1:-summary}"; [ $# -gt 0 ] && shift || true
ARG="${1:-}"
J="$(gp_snapshot_jsonl)"
[ -f "$J" ] || { echo "no snapshot at $J — run: scripts/snapshot.sh" >&2; exit 1; }

# jq helpers reading the configured vocabulary via env:
#   S = the item's status   A = the item's agent
case "$VIEW" in
  summary)
    echo "by $GP_FIELD_STATUS:"; jq -r '.fields[env.GP_FIELD_STATUS] // "—"' "$J" | sort | uniq -c | sort -rn | sed 's/^/  /'
    echo "by $GP_FIELD_BAND:";   jq -r '.fields[env.GP_FIELD_BAND]   // "—"' "$J" | sort | uniq -c | sort -rn | sed 's/^/  /'
    echo "claimed by:"; c=$(jq -r 'select((.fields[env.GP_FIELD_AGENT]//"")!="")|.fields[env.GP_FIELD_AGENT]' "$J" | sort | uniq -c | sort -rn)
    [ -n "$c" ] && echo "$c" | sed 's/^/  /' || echo "  (no active claims)"
    ;;
  ready)
    jq -r 'select(((.fields[env.GP_FIELD_STATUS]//"")|ascii_downcase==(env.GP_STATUS_READY|ascii_downcase)) and ((.fields[env.GP_FIELD_AGENT]//"")=="")) | "\(.id)\t\(.title)"' "$J"
    ;;
  triage)
    jq -r 'select(((.fields[env.GP_FIELD_STATUS]//"")|ascii_downcase==(env.GP_STATUS_TRIAGE|ascii_downcase)) and ((.fields[env.GP_FIELD_AGENT]//"")=="")) | "\(.id)\t\(.title)"' "$J"
    ;;
  mine)
    a="${ARG:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
    [ -n "$a" ] || { echo "no agent given and no git branch" >&2; exit 2; }
    jq -r --arg a "$a" 'select((.fields[env.GP_FIELD_AGENT]//"")==$a) | "[\(.fields[env.GP_FIELD_STATUS]//"—")] \(.title)"' "$J"
    ;;
  orphans)
    jq -r 'select(((.fields[env.GP_FIELD_STATUS]//"")|ascii_downcase==(env.GP_STATUS_ACTIVE|ascii_downcase)) and ((.fields[env.GP_FIELD_AGENT]//"")=="")) | "\(.id)\t\(.title)"' "$J"
    ;;
  stale)
    jq -r 'select(((.fields[env.GP_FIELD_AGENT]//"")!="") and ((.fields[env.GP_FIELD_STATUS]//"")|ascii_downcase!=(env.GP_STATUS_ACTIVE|ascii_downcase))) | "[\(.fields[env.GP_FIELD_STATUS]//"—")] \(.fields[env.GP_FIELD_AGENT]): \(.title)"' "$J"
    ;;
  prs)
    jq -r 'select((.linkedPRs|length)>0) | .title as $t | .linkedPRs[] | "\(.state)\t\(.url)\t\($t)"' "$J"
    ;;
  done-open)
    jq -r 'select((.fields[env.GP_FIELD_STATUS]//"")|ascii_downcase==(env.GP_STATUS_DONE|ascii_downcase))
           | select((.linkedPRs|length)>0)
           | select(([.linkedPRs[]|select(.state=="MERGED")]|length)==0)
           | "\(.title) → PRs: \([.linkedPRs[].state]|join(","))"' "$J"
    ;;
  *) echo "usage: coord.sh {summary|ready|triage|mine [agent]|orphans|stale|prs|done-open}" >&2; exit 2;;
esac
