#!/usr/bin/env bash
#
# project.sh — choose which project the other scripts act on by default.
#
#   project.sh use <owner> <number>   pick the active project (validated; remembers it)
#   project.sh current                show the active project
#   project.sh list [owner]           list projects to switch to (default owner: active, else @me)
#   project.sh clear                  forget the active project
#
# Once set, project-ids.sh / set-field.sh / add-item.sh / new-item.sh may be called
# WITHOUT --owner/--project — they fall back to this. Env GH_PROJECT_OWNER /
# GH_PROJECT_NUMBER override it for a one-off; an explicit flag overrides everything.
# The active project is stored at $GH_PROJECT_CONFIG (default
# ~/.config/github-projects/current).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

cmd="${1:-current}"; [ $# -gt 0 ] && shift || true

case "$cmd" in
  use)
    owner="${1:?usage: project.sh use <owner> <number>}"
    number="${2:?usage: project.sh use <owner> <number>}"
    # Validate it exists (and grab the title) before saving.
    meta="$("$SCRIPT_DIR/project-ids.sh" "$owner" "$number")" \
      || { echo "error: no project #$number for owner '$owner' — not saved." >&2; exit 1; }
    title="$(echo "$meta" | jq -r '.title')"
    mkdir -p "$(dirname "$GP_CONFIG")"
    printf 'owner=%s\nnumber=%s\ntitle=%s\n' "$owner" "$number" "$title" > "$GP_CONFIG"
    echo "active project → $owner #$number — $title"
    ;;
  current)
    if [ -f "$GP_CONFIG" ]; then
      echo "active project → $(gp_config_get owner) #$(gp_config_get number) — $(gp_config_get title)"
      echo "  ($GP_CONFIG)"
    else
      echo "no active project set. Choose one with:  project.sh use <owner> <number>"
    fi
    ;;
  list)
    owner="${1:-$(gp_config_get owner)}"; owner="${owner:-@me}"
    active_owner="$(gp_config_get owner)"; star=""
    [ "$owner" = "$active_owner" ] && star="$(gp_config_get number)"
    echo "projects for $owner  (★ = active):"
    # Listing boards is a read, so it goes through the gateway when one is set;
    # it also marks the boards that gateway is not allowed to serve.
    if gp_acp_enabled; then
      gp_gateway_get "/internal/projects?owner=$(gp_uri "$owner")" \
        | jq -r --arg a "$star" '.projects[] |
            "  \(if (.number|tostring)==$a then "★" else " " end) #\(.number)  \(.title)"
            + (if .allowed then "" else "   [not in the gateway allowlist]" end)'
      exit 0
    fi
    gh project list --owner "$owner" --format json \
      | jq -r --arg a "$star" '.projects[] |
          "  \(if (.number|tostring)==$a then "★" else " " end) #\(.number)  \(.title)"'
    ;;
  clear)
    rm -f "$GP_CONFIG" && echo "cleared active project"
    ;;
  *)
    echo "usage: project.sh {use <owner> <number> | current | list [owner] | clear}" >&2
    exit 2 ;;
esac
