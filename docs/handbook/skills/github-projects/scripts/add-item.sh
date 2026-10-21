#!/usr/bin/env bash
#
# add-item.sh — Add an existing issue or PR to a project and print its item ID.
#
# `gh project item-add` adds the content but you usually want the new project
# *item* node ID immediately so you can set its fields (Status, Sprint, …) in the
# same breath. This prints just that ID on stdout, ready to feed into set-field.sh.
#
# Usage:   add-item.sh --owner <o> --project <n> --url <issue-or-pr-url>
# Example:
#   ITEM=$(add-item.sh --owner example-org --project 2 \
#            --url https://github.com/example-org/systems/issues/42)
#   set-field.sh --owner example-org --project 2 --item "$ITEM" --field Status --value Ready
#
# Note: adding the same content twice is idempotent — GitHub returns the existing
# item's ID rather than creating a duplicate.
set -euo pipefail

OWNER="" PROJECT="" URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --url)     URL="$2"; shift 2;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
gp_resolve; gp_require_target          # --owner/--project optional; fall back to active project
: "${URL:?--url required}"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

gh project item-add "$PROJECT" --owner "$OWNER" --url "$URL" --format json | jq -r '.id'
