#!/usr/bin/env bash
#
# release.sh — give up a claim: clear the Agent field, optionally move Status.
#
# Usage:
#   release.sh --item <PVTI_…> [--status "In review"]
#   (--owner/--project optional — falls back to the active project)
#
# Clears Agent so the item shows as unclaimed. Pass --status to record the outcome
# (e.g. "In review" when handing off to a reviewer, "Done", or "Ready" to requeue).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

OWNER="" PROJECT="" ITEM="" STATUS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --item)    ITEM="$2"; shift 2;;
    --status)  STATUS="$2"; shift 2;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
gp_resolve; gp_require_target
: "${ITEM:?--item required}"

"$SCRIPT_DIR/set-field.sh" --owner "$OWNER" --project "$PROJECT" --item "$ITEM" --field "$GP_FIELD_AGENT" --clear >/dev/null
echo "released $ITEM (Agent cleared)"
[ -n "$STATUS" ] && "$SCRIPT_DIR/set-field.sh" --owner "$OWNER" --project "$PROJECT" --item "$ITEM" --set "$GP_FIELD_STATUS=$STATUS"
