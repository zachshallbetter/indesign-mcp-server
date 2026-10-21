#!/usr/bin/env bash
#
# project-ids.sh — Resolve a GitHub ProjectV2's opaque node IDs in one call.
#
# ProjectsV2 lives entirely in GitHub's GraphQL API; every project, field, and
# single-select option is addressed by an opaque node ID (PVT_…, PVTF_…, etc.).
# Setting a field value requires those IDs, so the very first thing any project
# workflow needs is this "Rosetta stone". Run it once, cache the JSON, reuse it.
#
# Usage:   project-ids.sh <owner> <project-number>
# Example: project-ids.sh example-org 2
#
# Works for both organization-owned and user-owned projects (auto-detected).
# Output: JSON with { projectId, title, number, url, fields:[{name,id,dataType,
#         options:[{id,name}]|null, iterations:[{id,title,startDate}]|null}] }
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Owner/number are positional, but optional: fall back to the active project
# (env GH_PROJECT_* or `project.sh use`) when omitted.
OWNER="${1:-}"; PROJECT="${2:-}"
gp_resolve; gp_require_target
NUMBER="$PROJECT"

command -v jq >/dev/null || { echo "error: jq not found (brew install jq)" >&2; exit 1; }

# With a gateway configured, the board's IDs come from it -- no gh, no GraphQL.
if gp_acp_enabled; then
  gp_acp_context | jq '{
    projectId: .snapshot.id,
    title: .snapshot.title,
    number: .snapshot.number,
    url: null,
    fields: [ .snapshot.fields.nodes[] | {
      name, id, dataType,
      options: (.options // null),
      iterations: ((.configuration.iterations // null) | if . then map({id, title, startDate}) else null end)
    } ]
  }'
  exit 0
fi

command -v gh >/dev/null || { echo "error: gh CLI not found (brew install gh)" >&2; exit 1; }

# `@me` is a gh-CLI convenience, not a valid GraphQL login. Resolve it to the
# authenticated account's real login so the user/organization queries below work.
[ "$OWNER" = "@me" ] && OWNER="$(gh api user -q .login)"

# Fetch under either the organization or user root. We try both rather than make
# the caller know which one the owner is — one will resolve, the other returns null.
fetch() {
  local root="$1"
  gh api graphql -f owner="$OWNER" -F number="$NUMBER" -f query="
  query(\$owner: String!, \$number: Int!) {
    ${root}(login: \$owner) {
      projectV2(number: \$number) {
        id title number url
        fields(first: 50) { nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name } }
          ... on ProjectV2IterationField {
            configuration { iterations { id title startDate duration } }
          }
        } }
      }
    }
  }" 2>/dev/null | jq -e ".data.${root}.projectV2 // empty"
}

RESULT="$(fetch organization || true)"
[ -z "$RESULT" ] && RESULT="$(fetch user || true)"
[ -n "$RESULT" ] || { echo "error: project #$NUMBER not found for owner '$OWNER' (checked org and user). Check the number, owner login, and that your token has 'project' scope (gh auth refresh -s project)." >&2; exit 1; }

echo "$RESULT" | jq '{
  projectId: .id,
  title, number, url,
  fields: [ .fields.nodes[] | {
    name, id, dataType,
    options:    (.options // null),
    iterations: (.configuration.iterations // null)
  } ]
}'
