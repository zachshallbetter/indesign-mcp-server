#!/usr/bin/env bash
#
# spawn.sh — spawn a cheap headless micro-agent (a worker) for one ticket, via
# `claude -p`. This is the coordinator's mechanism for delegating work with minimal
# context and the smallest sufficient model, to save tokens.
#
#   spawn.sh --role <resolver|verifier|triager> --ticket "<text>" \
#            [--dir <worktree>] [--model haiku] [--max-turns N] \
#            [--permission-mode <m>] [--allow "<tools>"] [--disallow "<tools>"] \
#            [--resume <session-id>] [--out <file>] [--dry-run]
#
# Role files (assets/roles/<role>.md) are injected as the worker's system prompt; the
# --ticket carries the item-specific instructions the coordinator assembles (item id,
# worktree path, build/test commands, gate condition, board-script invocations).
#
# Prints a one-line header (ok / turns / cost / SESSION-ID) then the worker's final
# result. Capture the SESSION-ID to RESUME the same worker with failure feedback
# (`spawn.sh --role … --resume <id> --ticket "<what was wrong; fix it>"`) — that's the
# send-back-on-incorrect rework loop, and it reuses the worker's existing context.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/assets/roles"
command -v claude >/dev/null || { echo "error: claude CLI not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

ROLE="" TICKET="" DIR="" MODEL="" MAXT="" PERM="" ALLOW="" DISALLOW="" RESUME="" OUT="" DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --role)            ROLE="$2"; shift 2;;
    --ticket)          TICKET="$2"; shift 2;;
    --dir)             DIR="$2"; shift 2;;
    --model)           MODEL="$2"; shift 2;;
    --max-turns)       MAXT="$2"; shift 2;;
    --permission-mode) PERM="$2"; shift 2;;
    --allow)           ALLOW="$2"; shift 2;;
    --disallow)        DISALLOW="$2"; shift 2;;
    --resume)          RESUME="$2"; shift 2;;
    --out)             OUT="$2"; shift 2;;
    --dry-run)         DRY=1; shift;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
: "${ROLE:?--role required}" "${TICKET:?--ticket required}"

# Per-role defaults (overridable by flags). Workers default to the cheapest model.
case "$ROLE" in
  resolver) : "${MODEL:=haiku}"; : "${MAXT:=30}"; : "${PERM:=acceptEdits}"; : "${ALLOW:=Read,Edit,Write,Grep,Glob,Bash}";;
  verifier) : "${MODEL:=haiku}"; : "${MAXT:=12}"; : "${PERM:=acceptEdits}"; : "${ALLOW:=Read,Grep,Glob,Bash}"; : "${DISALLOW:=Edit,Write}";;
  triager)  : "${MODEL:=haiku}"; : "${MAXT:=8}";  : "${PERM:=acceptEdits}"; : "${ALLOW:=Read,Grep,Glob,Bash}";;
  *)        : "${MODEL:=haiku}"; : "${MAXT:=10}"; : "${PERM:=acceptEdits}"; : "${ALLOW:=Read,Grep,Glob,Bash}";;
esac

cmd=(claude -p "$TICKET" --model "$MODEL" --max-turns "$MAXT" --permission-mode "$PERM" --output-format json)
[ -f "$ROLES_DIR/$ROLE.md" ] && cmd+=(--append-system-prompt "$(cat "$ROLES_DIR/$ROLE.md")")
[ -n "$ALLOW" ]    && cmd+=(--allowedTools "$ALLOW")
[ -n "$DISALLOW" ] && cmd+=(--disallowedTools "$DISALLOW")
[ -n "$DIR" ]      && cmd+=(--add-dir "$DIR")
[ -n "$RESUME" ]   && cmd+=(--resume "$RESUME")

if [ "$DRY" -eq 1 ]; then printf 'WOULD RUN: '; printf '%q ' "${cmd[@]}"; echo; exit 0; fi

OUT="${OUT:-$(mktemp -t spawn)}"
# Run in the worktree if given, so relative paths resolve there.
( [ -n "$DIR" ] && cd "$DIR"; "${cmd[@]}" ) > "$OUT" 2>"$OUT.err" || true
res="$(jq -c '.[-1] // {}' "$OUT" 2>/dev/null || echo '{}')"
if [ -z "$res" ] || [ "$res" = "{}" ]; then
  echo "spawn produced no result (role=$ROLE). stderr:" >&2; head -3 "$OUT.err" >&2; exit 1
fi
echo "$res" | jq -r '"role='"$ROLE"' ok=\(.is_error|not) turns=\(.num_turns) cost=$\(.total_cost_usd) session=\(.session_id)"'
echo "--- result ---"
echo "$res" | jq -r '.result'
