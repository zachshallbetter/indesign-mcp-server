#!/usr/bin/env bash
# lib.sh — shared helpers, sourced by the github-projects scripts.
#
# It lets you pick an "active project" once (with project.sh) and then omit
# --owner/--project on the other scripts. Resolution precedence, highest first:
#   1. explicit --owner/--project (or positional args)
#   2. env GH_PROJECT_OWNER / GH_PROJECT_NUMBER
#   3. the active project saved by `project.sh use` (a small config file)

GP_CONFIG="${GH_PROJECT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/github-projects/current}"

# ── Per-repository board profile ────────────────────────────────────────────────
# <git-root>/.agents/board.env, when present, binds this repository to its board
# and names that board's field vocabulary. It is committed (unlike .env.local,
# which carries the gateway secret), so the binding travels with the repo.
# Parsed, never sourced -- a repo file must not be able to run code here.
# Only GH_PROJECT_OWNER / GH_PROJECT_NUMBER / GP_* keys are honoured, and the
# environment still wins: an exported value is never overwritten.
_gp_profile="$(git rev-parse --show-toplevel 2>/dev/null)/.agents/board.env"
if [ -f "$_gp_profile" ]; then
  while IFS='=' read -r _gp_k _gp_v; do
    _gp_k="${_gp_k#"${_gp_k%%[![:space:]]*}"}"   # trim leading space from the key
    case "$_gp_k" in
      \#*|"") continue;;
      GH_PROJECT_OWNER|GH_PROJECT_NUMBER|GP_*)
        # Strip an inline `# comment`, surrounding space, and quotes -- a value
        # like `4   # Infinite Studio` must bind the number, not the comment.
        _gp_v="$(printf '%s' "$_gp_v" | sed -e 's/[[:space:]][[:space:]]*#.*$//' \
                                            -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
                                            -e 's/^"//' -e 's/"$//')"
        [ -n "${!_gp_k:-}" ] || export "$_gp_k=$_gp_v";;
    esac
  done < "$_gp_profile"
  unset _gp_k _gp_v
fi
unset _gp_profile

# ── Board field vocabulary ──────────────────────────────────────────────────────
# The claim/coord/coordinator layer needs to know which fields/values mean what.
# Defaults match the example-org board; override via env for any other board's schema.
# Exported so jq filters can read them as `env.GP_FIELD_STATUS`, etc.
export GP_FIELD_STATUS="${GP_FIELD_STATUS:-Status}"   # the workflow single-select
export GP_FIELD_AGENT="${GP_FIELD_AGENT:-Agent}"      # text field holding the claiming agent's id
export GP_FIELD_BAND="${GP_FIELD_BAND:-Band}"         # grouping (wave/epic/phase)
export GP_FIELD_REPOS="${GP_FIELD_REPOS:-Repos}"      # repo hint the coordinator resolves
export GP_FIELD_GATE="${GP_FIELD_GATE:-Gate}"         # acceptance/done condition
export GP_STATUS_READY="${GP_STATUS_READY:-Ready}"        # claimable
export GP_STATUS_ACTIVE="${GP_STATUS_ACTIVE:-In progress}" # being worked
export GP_STATUS_REVIEW="${GP_STATUS_REVIEW:-In review}"  # done, PR open
export GP_STATUS_DONE="${GP_STATUS_DONE:-Done}"          # completed/merged
export GP_STATUS_TRIAGE="${GP_STATUS_TRIAGE:-To triage}"  # the triage queue

# ── ACP gateway (optional read path) ────────────────────────────────────────────
# With ACP_GATEWAY_URL set, board READS go through a hosted gateway that holds
# the GitHub App credentials, so no agent ever holds them. Writes are unaffected:
# the gateway is pull-only by design, and add-item/set-field/claim/new-item keep
# using the operator's own `gh` credentials. Everything here is inert when
# ACP_GATEWAY_URL is unset -- the skill behaves exactly as before.
#
# ACP_GATEWAY_URL / ACP_GATEWAY_TOKEN normally live in the repository's
# .env.local (never committed). Load them from there when not already exported.
if [ -z "${ACP_GATEWAY_URL:-}" ]; then
  _gp_env="$(git rev-parse --show-toplevel 2>/dev/null)/.env.local"
  if [ -f "$_gp_env" ]; then
    ACP_GATEWAY_URL="$(sed -n 's/^ACP_GATEWAY_URL=//p' "$_gp_env" | tr -d '"' | head -1)"
    ACP_GATEWAY_TOKEN="${ACP_GATEWAY_TOKEN:-$(sed -n 's/^ACP_GATEWAY_TOKEN=//p' "$_gp_env" | tr -d '"' | head -1)}"
    export ACP_GATEWAY_URL ACP_GATEWAY_TOKEN
  fi
  unset _gp_env
fi

# ACP is on when a gateway is configured -- unless the operator has explicitly
# asked for the native fallback. Without that second clause the documented
# escape hatch did nothing: the read paths short-circuited to the gateway on the
# URL alone, so a board the gateway cannot serve (an installation without
# owner-level Projects permission, say) was unreachable even with credentials
# that could read it perfectly well.
gp_acp_enabled() {
  [ -n "${ACP_GATEWAY_URL:-}" ] && [ "${ACP_ALLOW_NATIVE_GITHUB:-0}" != 1 ]
}

gp_uri() { printf '%s' "$1" | jq -sRr @uri; }

# gp_gateway_get <path> — one authenticated gateway read, body on stdout.
#
# The gateway answers a refusal with JSON saying what to do about it: an error
# code, a detail, a remedy, and the context needed to retry (which owners it can
# read, the allowlist entry to add, the App install URL). `curl -f` throws that
# body away and reports only its own exit code, so a fixable misconfiguration
# reaches the caller as an unexplained failure. Capture body and status instead.
gp_gateway_get() {
  [ -n "${ACP_GATEWAY_TOKEN:-}" ] || {
    echo "error: ACP_GATEWAY_URL is set but ACP_GATEWAY_TOKEN is missing; refusing local GitHub Project fallback" >&2
    return 78
  }
  local response status body
  response="$(curl -sS --max-time "${ACP_GATEWAY_TIMEOUT:-20}" -w '\n%{http_code}' \
    -H "Authorization: Bearer ${ACP_GATEWAY_TOKEN}" "${ACP_GATEWAY_URL%/}$1")" || {
    echo "error: ACP gateway unreachable at ${ACP_GATEWAY_URL%/} (curl exit $?)" >&2
    return 78
  }
  status="${response##*$'\n'}"; body="${response%$'\n'*}"
  case "$status" in
    2*) printf '%s\n' "$body"; return 0;;
  esac
  gp_gateway_explain "$status" "$1" "$body"
  return 78
}

# gp_gateway_explain — print the gateway's own account of the refusal.
gp_gateway_explain() {
  {
    echo "error: ACP gateway refused GET $2 (HTTP $1)"
    if command -v jq >/dev/null 2>&1 && printf '%s' "$3" | jq -e . >/dev/null 2>&1; then
      printf '%s' "$3" | jq -r '
        "  code:   \(.error // "?")",
        "  detail: \(.detail // .message // "-")",
        (if .remedy then "  remedy: \(.remedy)" else empty end),
        (if .owners_available then "  owners available: \(.owners_available | join(", "))" else empty end),
        (if .allowlist then "  gateway allowlist: \(.allowlist)" else empty end),
        (if .permissions then "  installation permissions: \(.permissions | to_entries | map("\(.key)=\(.value)") | join(", "))" else empty end)'
    else
      printf '  %s\n' "$3"
    fi
  } >&2
}

# gp_acp_context — the live board snapshot for the active project.
gp_acp_context() {
  gp_require_target
  gp_gateway_get "/internal/project-context?owner=$(gp_uri "$OWNER")&project=$(gp_uri "$PROJECT")"
}

# gp_target_hint — when no board is selected, ask the gateway what it can see
# rather than leaving the caller to guess an owner or a number. Best effort.
gp_target_hint() {
  gp_acp_enabled && [ -n "${ACP_GATEWAY_TOKEN:-}" ] && command -v jq >/dev/null 2>&1 || return 0
  if [ -n "${OWNER:-}" ]; then
    gp_gateway_get "/internal/projects?owner=$(gp_uri "$OWNER")" 2>/dev/null | jq -r '
      "  boards on \(.owner):",
      (.projects[]? | "    --project \(.number)  \(.title)"
        + (if .allowed then "" else "   [not in the gateway allowlist]" end))' >&2
  else
    gp_gateway_get "/internal/installations" 2>/dev/null | jq -r '
      "  owners this gateway can read:", (.installations[]? | "    --owner \(.login)")' >&2
  fi
  return 0
}

# gp_config_get <key> — read one value (owner|number|title) from the config file.
gp_config_get() { [ -f "$GP_CONFIG" ] && sed -n "s/^$1=//p" "$GP_CONFIG" | head -1; }

# gp_resolve — fill the OWNER and PROJECT globals from env/config if still empty.
gp_resolve() {
  OWNER="${OWNER:-${GH_PROJECT_OWNER:-$(gp_config_get owner)}}"
  PROJECT="${PROJECT:-${GH_PROJECT_NUMBER:-$(gp_config_get number)}}"
}

# gp_require_target — friendly error if no project could be resolved.
gp_require_target() {
  if [ -z "${OWNER:-}" ] || [ -z "${PROJECT:-}" ]; then
    {
      echo "error: no project selected."
      echo "  pass --owner/--project, set GH_PROJECT_OWNER/GH_PROJECT_NUMBER,"
      echo "  or choose a default once:  scripts/project.sh use <owner> <number>"
    } >&2
    gp_target_hint
    exit 2
  fi
}

# ── Local board snapshot (the coordinator's cached model of the board) ──────────
# Canonical = JSONL (one item per line); a flat TSV view is derived alongside it.
# Base path: $GH_SNAPSHOT_FILE, else <git-root>/.board_snapshot (so .jsonl/.tsv sit
# at the project root). Resolved lazily so it tracks the caller's repo.
gp_snapshot_base() {
  if [ -n "${GH_SNAPSHOT_FILE:-}" ]; then printf '%s' "$GH_SNAPSHOT_FILE";
  else printf '%s/.board_snapshot' "$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")"; fi
}
gp_snapshot_jsonl() { printf '%s.jsonl' "$(gp_snapshot_base)"; }
gp_snapshot_tsv()   { printf '%s.tsv'   "$(gp_snapshot_base)"; }

# gp_snapshot_set_field <itemId> <fieldName> <value>
# Keep the local snapshot aligned with a write WE just made — no extra API call.
# Best-effort: silently no-ops if there's no snapshot or the item isn't in it (new
# items reconcile on the next full `snapshot.sh`). Atomic (tmp+mv) so concurrent
# writers can't corrupt the file; a lost concurrent patch reconciles on refresh.
# Set GH_SNAPSHOT=off to disable.
gp_snapshot_set_field() {
  [ "${GH_SNAPSHOT:-on}" = "off" ] && return 0
  command -v jq >/dev/null 2>&1 || return 0
  local f; f="$(gp_snapshot_jsonl)"
  [ -f "$f" ] || return 0
  jq -c --arg id "$1" --arg n "$2" --arg v "$3" \
    'if .id==$id then (.fields[$n]=$v) else . end' "$f" > "$f.tmp" 2>/dev/null \
    && mv "$f.tmp" "$f" || rm -f "$f.tmp" 2>/dev/null
  return 0
}
