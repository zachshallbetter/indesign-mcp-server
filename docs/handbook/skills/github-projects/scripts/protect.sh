#!/usr/bin/env bash
#
# protect.sh — opt a repo into safe auto-merge by enabling a REQUIRED status check on a
# branch. The coordinator's auto-merge only arms where required checks exist (so "on
# green" is enforced by GitHub, not just the agent); this is how you enable that gate.
#
#   protect.sh <owner/name> <branch> <check-context> [<check-context> ...]
#
# Example:  protect.sh example-org/compute main "build"   # require the "build" check
#
# Needs admin on the repo. This is an explicit, deliberate action — review before running;
# it turns on branch protection (required checks, strict up-to-date, admins enforced).
set -euo pipefail
REPO="${1:?usage: protect.sh <owner/name> <branch> <check-context> [...]}"
BRANCH="${2:?usage: protect.sh <owner/name> <branch> <check-context> [...]}"
shift 2
[ $# -gt 0 ] || { echo "error: give at least one required check context (e.g. the CI job name)" >&2; exit 2; }
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

body="$(jq -n --argjson ctx "$(printf '%s\n' "$@" | jq -R . | jq -s .)" '{
  required_status_checks:        { strict: true, contexts: $ctx },
  enforce_admins:                true,
  required_pull_request_reviews: null,
  restrictions:                  null
}')"

echo "Enabling branch protection on $REPO @ $BRANCH — required checks: $*"
printf '%s' "$body" | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - \
  --jq '"  protected: required checks = " + ((.required_status_checks.contexts // [])|join(", "))'
echo "Done. The coordinator will now arm auto-merge for $REPO (merges only once these checks pass)."
