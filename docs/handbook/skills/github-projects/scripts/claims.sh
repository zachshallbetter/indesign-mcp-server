#!/usr/bin/env bash
#
# claims.sh — who is working on what. Lists claimed items grouped by agent, and
# flags two anomalies: items In progress with NO agent (unclaimed-but-active), and
# items with an agent but NOT In progress (possibly a stale claim to clean up).
#
# Usage:  claims.sh [--limit 500]
#   (--owner/--project optional — falls back to the active project)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

OWNER="" PROJECT="" LIMIT=500
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --limit)   LIMIT="$2"; shift 2;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
gp_resolve; gp_require_target

# With a gateway configured, read the board through the local snapshot it feeds
# (snapshot records key fields by their real name, not lowercased).
if gp_acp_enabled; then
  "$SCRIPT_DIR/snapshot.sh" --owner "$OWNER" --project "$PROJECT" >/dev/null
  jq -s -r '
  (env.GP_FIELD_AGENT) as $ak |
  (env.GP_FIELD_STATUS) as $sk |
  (env.GP_STATUS_ACTIVE) as $active |
  ([.[] | select((.fields[$ak] // "")|length>0)] | sort_by(.fields[$ak])) as $claimed
  | "CLAIMED  (\($claimed|length)):",
    ($claimed | group_by(.fields[$ak])[] |
       "  ▸ \(.[0].fields[$ak])  (\(length))",
       (.[] | "      [\(.fields[$sk] // "—")] \(.title)")),
    "",
    "⚠ \(env.GP_STATUS_ACTIVE) with NO agent:",
    ([.[] | select((.fields[$sk]//"") == $active and ((.fields[$ak]//"")|length)==0)]
       | if length==0 then "  none" else (.[] | "  - \(.title)") end),
    "",
    "⚠ Agent set but not \(env.GP_STATUS_ACTIVE) (possibly stale):",
    ([.[] | select(((.fields[$ak]//"")|length)>0 and (.fields[$sk]//"") != $active)]
       | if length==0 then "  none" else (.[] | "  - [\(.fields[$sk] // "—")] \(.fields[$ak]): \(.title)") end)
  ' "$(gp_snapshot_jsonl)"
  exit 0
fi

# Item-list keys fields by lowercased name, so the configured Agent/Status fields are
# `.<agent-name-lowercased>` / `.<status-name-lowercased>`. Pipe to EXTERNAL jq (gh's
# embedded jq doesn't expose env) and bind those keys from the board vocabulary.
gh project item-list "$PROJECT" --owner "$OWNER" --limit "$LIMIT" --format json \
| jq -r '
  (env.GP_FIELD_AGENT  | ascii_downcase) as $ak |
  (env.GP_FIELD_STATUS | ascii_downcase) as $sk |
  (env.GP_STATUS_ACTIVE| ascii_downcase) as $active |
  ([.items[] | select((.[$ak] // "")|length>0)] | sort_by(.[$ak])) as $claimed
  | "CLAIMED  (\($claimed|length)):",
    ($claimed | group_by(.[$ak])[] |
       "  ▸ \(.[0][$ak])  (\(length))",
       (.[] | "      [\(.[$sk] // "—")] \(.title)")),
    "",
    "⚠ \(env.GP_STATUS_ACTIVE) with NO agent:",
    ([.items[] | select((((.[$sk]//"")|ascii_downcase)==$active) and (((.[$ak]//"")|length)==0))]
       | if length==0 then "  none" else (.[] | "  - \(.title)") end),
    "",
    "⚠ Agent set but not \(env.GP_STATUS_ACTIVE) (possibly stale):",
    ([.items[] | select((((.[$ak]//"")|length)>0) and (((.[$sk]//"")|ascii_downcase)!=$active))]
       | if length==0 then "  none" else (.[] | "  - [\(.[$sk] // "—")] \(.[$ak]): \(.title)") end)
'
