#!/usr/bin/env bash
#
# coordinator.sh — autonomously work a project board by spawning cheap micro-agents.
# The coordinator owns versioning: it pre-creates the worktree, and after the Resolver
# edits+commits there, it strips lockfile collateral, pushes, opens the PR, runs a
# Verifier, and (on green) arms an auto-merge. Failures are blamed and the same worker
# is resumed with feedback, bounded by --max-retries.
#
#   coordinator.sh [--project-dir DIR] [--owner O --project N]
#                  [--queue ready|triage | --item <id>] [--note "<extra ticket context>"]
#                  [--repo owner/name --repo-path <local repo> [--crate <name>] [--base main]]
#                  [--max-items N] [--max-retries N] [--model haiku]
#                  [--apply] [--no-merge] [--allow-lockfile]
#
# SAFETY: dry-run by default (refresh + plan only). --apply executes but: processes at
# most --max-items (default 1); SKIPS items whose title/gate signals a hold; works only
# in worktrees (never main); strips unintended Cargo.lock churn; merges via
# `gh pr merge --auto` so GitHub completes the merge only once required CI passes.
# A single item's failure never aborts the run (no `set -e`); it's logged and skipped.
set -uo pipefail   # deliberately NOT -e: per-item failures are contained, not fatal.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

OWNER="" PROJECT="" PDIR="" QUEUE="ready" ITEM="" NOTE="" REPO="" REPO_PATH="" CRATE="" BASE="main"
MAXI=1 MAXR=2 MODEL="haiku" APPLY=0 MERGE=1 ALLOW_LOCK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir) PDIR="$2"; shift 2;;
    --owner) OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --queue) QUEUE="$2"; shift 2;;
    --item) ITEM="$2"; shift 2;;
    --note) NOTE="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --repo-path) REPO_PATH="$2"; shift 2;;
    --crate) CRATE="$2"; shift 2;;
    --base) BASE="$2"; shift 2;;
    --max-items) MAXI="$2"; shift 2;;
    --max-retries) MAXR="$2"; shift 2;;
    --model) MODEL="$2"; shift 2;;
    --apply) APPLY=1; shift;;
    --no-merge) MERGE=0; shift;;
    --allow-lockfile) ALLOW_LOCK=1; shift;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
gp_resolve; gp_require_target
PDIR="${PDIR:-$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")}"
[ -n "$REPO_PATH" ] && [ ! -d "$REPO_PATH" ] && REPO_PATH="$PDIR/$REPO_PATH"
LOGDIR="$PDIR/.coord-log"; mkdir -p "$LOGDIR"
AGENT_ID="coord:$(hostname -s 2>/dev/null || echo coord)"

slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-//; s/-$//' | cut -c1-40; }
blame() { printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$2" >> "$LOGDIR/$1.log"; echo "  blame: $2"; }
# robust: pull the last well-formed JSON object out of a worker's (maybe fenced) output.
last_json() { grep -oE '\{.*\}' | while IFS= read -r l; do printf '%s' "$l" | jq -ce . 2>/dev/null; done | tail -1; }
jget() { jq -r "$1 // \"\"" 2>/dev/null; }
# True only if the repo's base branch has REQUIRED status checks, so "auto-merge on
# green" actually gates on CI. Without this, `gh pr merge --auto` would merge a PR with
# no checks immediately — so we withhold auto-merge where green isn't enforced.
has_required_checks() {
  local n
  n="$(gh api "repos/$1/branches/$2/protection/required_status_checks" \
        --jq '((.contexts // [])|length) + ((.checks // [])|length)' 2>/dev/null)"
  [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null
}

echo "coordinator: project=$OWNER #$PROJECT  dir=$PDIR  queue=$QUEUE  apply=$APPLY  merge=$MERGE  max-items=$MAXI"
echo "refreshing snapshot…"; "$SCRIPT_DIR/snapshot.sh" --owner "$OWNER" --project "$PROJECT" >/dev/null 2>&1

process_item() {
  local ID="$1" TITLE="$2" REC GATE REPOS CLAIMED BRANCH WT checkcmd ticket rp on cr res
  REC="$("$SCRIPT_DIR/snapshot.sh" get "$ID" 2>/dev/null)"
  GATE="$(printf '%s' "$REC" | jget '.fields[env.GP_FIELD_GATE]')"
  REPOS="$(printf '%s' "$REC" | jget '.fields[env.GP_FIELD_REPOS]')"
  CLAIMED="$(printf '%s' "$REC" | jget '.fields[env.GP_FIELD_AGENT]')"
  rp="$REPO_PATH"; on="$REPO"; cr="$CRATE"
  echo; echo "▸ $ID  $TITLE"

  # Hold guard: match real hold *conventions*, not loose words (e.g. a "Must Never"
  # doc-section name must NOT trip it). Portable (no \b — BSD grep).
  if printf '%s %s' "$TITLE" "$GATE" | grep -qiE 'held for|\(held|on hold|do not (proceed|merge|start|auto|touch)|blocked on|\[wip\]|do-not-'; then
    echo "  SKIP: hold/blocked signal"; return 0; fi
  if [ -n "$CLAIMED" ] && [ "$CLAIMED" != "$AGENT_ID" ]; then
    echo "  SKIP: already claimed by '$CLAIMED'"; return 0; fi

  # Genuinely fleet-wide / multi-repo items aren't single-PR work — skip (unless --repo
  # was given explicitly, which overrides).
  if [ -z "$REPO" ] && printf '%s' "$REPOS" | grep -qiE 'all [0-9]+|fleet-wide|across all|every (one )?of|[0-9]{2,} repos|polyrepo'; then
    echo "  SKIP: fleet-wide/multi-repo item (Repos='$REPOS')"; return 0; fi
  # Resolve the target repo from the item's Repos hint when not given explicitly.
  if [ -z "$rp" ] || [ -z "$on" ]; then
    res="$("$SCRIPT_DIR/repo-map.sh" resolve "$REPOS" 2>/dev/null)"
    [ -n "$res" ] && { [ -z "$rp" ] && rp="$(printf '%s' "$res" | cut -f1)"; [ -z "$on" ] && on="$(printf '%s' "$res" | cut -f2)"; [ -z "$cr" ] && cr="$(printf '%s' "$res" | cut -f3)"; }
  fi
  if [ -z "$on" ] || [ -z "$rp" ]; then
    echo "  SKIP: couldn't resolve a repo from Repos='${REPOS:-—}' (multi-repo or unmapped)"; return 0; fi

  if [ "$APPLY" -ne 1 ]; then
    echo "  WOULD: claim → worktree in $on → resolver → verify → $([ "$MERGE" = 1 ] && echo 'auto-merge if CI-gated' || echo 'PR only')"; return 0; fi
  echo "  repo: $on  ($rp)${cr:+  crate=$cr}"

  BRANCH="coord/$(slug "$TITLE")"; WT="$rp/.wt/coord-$(slug "$TITLE")"
  "$SCRIPT_DIR/claim.sh" --owner "$OWNER" --project "$PROJECT" --item "$ID" --agent "$AGENT_ID" --verify-delay 0 >/dev/null 2>&1 \
    || { echo "  could not claim — skipping"; return 0; }

  # Coordinator owns the worktree (so it knows repo+branch deterministically).
  if ! git -C "$rp" worktree list 2>/dev/null | grep -qF "$WT"; then
    git -C "$rp" worktree add "$WT" -b "$BRANCH" "$BASE" >/dev/null 2>&1 \
      || git -C "$rp" worktree add "$WT" "$BRANCH" >/dev/null 2>&1 \
      || { echo "  worktree create failed"; "$SCRIPT_DIR/release.sh" --owner "$OWNER" --project "$PROJECT" --item "$ID" --status "$GP_STATUS_READY" >/dev/null 2>&1; return 0; }
  fi
  checkcmd="cargo check${cr:+ -p $cr}"
  ticket="You are in an isolated git worktree at: $WT  (branch $BRANCH). Work ONLY here.
Board item: $TITLE
Gate / acceptance: ${GATE:-<infer from the title>}
${NOTE}

1. Make the smallest change that satisfies the gate. Match style; no version bumps.
2. Prove it compiles: run \`$checkcmd\` in the worktree. If that regenerated Cargo.lock and you did not intend a dependency change, restore it (git checkout -- Cargo.lock).
3. Commit to branch $BRANCH (end the message with a Co-Authored-By: Claude trailer). Do NOT push and do NOT open a PR — the coordinator does that.
If blocked or ambiguous, STOP and report."

  local SESSION="" FEEDBACK="" ok=0 PR="" attempt OUT V rv VOUT vv
  for attempt in $(seq 1 "$MAXR"); do
    echo "  resolver attempt $attempt…"
    if [ -z "$SESSION" ]; then
      OUT="$("$SCRIPT_DIR/spawn.sh" --role resolver --model "$MODEL" --dir "$WT" --ticket "$ticket" 2>/dev/null)"
    else
      OUT="$("$SCRIPT_DIR/spawn.sh" --role resolver --resume "$SESSION" --dir "$WT" --ticket "$FEEDBACK" 2>/dev/null)"
    fi
    SESSION="$(printf '%s' "$OUT" | sed -n 's/.*session=\([0-9a-f-]*\).*/\1/p' | head -1)"
    V="$(printf '%s' "$OUT" | last_json)"
    rv="$(printf '%s' "$V" | jget '.verdict')"
    if [ "$rv" != "done" ]; then
      blame "$ID" "resolver $attempt: ${rv:-no-verdict} — $(printf '%s' "$V" | jget '.note')"
      FEEDBACK="Your previous attempt did not complete (verdict=${rv:-none}). Finish it; same rules."
      continue
    fi

    # Strip unintended lockfile churn (unless --allow-lockfile).
    if [ "$ALLOW_LOCK" -ne 1 ]; then
      git -C "$WT" diff --name-only "$BASE" 2>/dev/null | grep -E '(^|/)Cargo\.lock$' | while IFS= read -r lf; do
        git -C "$WT" checkout "$BASE" -- "$lf" >/dev/null 2>&1
      done
      git -C "$WT" diff --cached --quiet 2>/dev/null || git -C "$WT" commit -aqm "chore: drop unintended Cargo.lock regen (coordinator)" >/dev/null 2>&1
    fi
    # Coordinator pushes + opens (or reuses) the PR — it knows REPO and BRANCH for sure.
    # gh pr create can race a fresh push (GitHub hasn't registered the branch yet), so
    # retry a few times and reuse an existing PR if there is one. Log the real error.
    git -C "$WT" push -q -u origin "$BRANCH" >/dev/null 2>&1
    PR="" pr_err=""
    for try in 1 2 3 4; do
      PR="$(gh pr view "$BRANCH" -R "$on" --json url -q .url 2>/dev/null)"; [ -n "$PR" ] && break
      PR="$(gh pr create -R "$on" --base "$BASE" --head "$BRANCH" --fill 2>/tmp/coord-prerr)"; [ -n "$PR" ] && break
      pr_err="$(tail -1 /tmp/coord-prerr 2>/dev/null)"; sleep 3
    done
    [ -n "$PR" ] || blame "$ID" "pr-create failed after retries: ${pr_err:-unknown}"
    echo "  PR: ${PR:-<none: $pr_err>}"

    VOUT="$("$SCRIPT_DIR/spawn.sh" --role verifier --dir "$WT" \
      --ticket "Verify board item: $TITLE. Worktree $WT (branch $BRANCH); PR ${PR:-n/a}. Gate: ${GATE:-infer}. Run \`$checkcmd\` and read \`git diff $BASE\`; judge independently." 2>/dev/null)"
    vv="$(printf '%s' "$VOUT" | last_json | jget '.verdict')"
    if [ "$vv" = "pass" ]; then
      if [ "$MERGE" = 1 ] && [ -n "$PR" ]; then
        if has_required_checks "$on" "$BASE"; then
          gh pr merge "$PR" -R "$on" --squash --auto >/dev/null 2>&1 \
            && echo "  auto-merge armed (GitHub merges once required checks pass)" \
            || echo "  could not arm auto-merge (permissions?)"
        else
          echo "  auto-merge WITHHELD: $on has no required status checks on '$BASE' — 'green' isn't enforced; leaving PR for human merge."
          blame "$ID" "auto-merge withheld: no required checks on $on/$BASE"
        fi
      fi
      "$SCRIPT_DIR/set-field.sh" --owner "$OWNER" --project "$PROJECT" --item "$ID" --set "$GP_FIELD_STATUS=$GP_STATUS_REVIEW" >/dev/null 2>&1
      "$SCRIPT_DIR/release.sh" --owner "$OWNER" --project "$PROJECT" --item "$ID" >/dev/null 2>&1
      echo "  ✓ resolved → ${PR:-(PR pending)}  (verifier passed; $([ "$MERGE" = 1 ] && echo 'auto-merge armed' || echo 'merge held'))"
      ok=1; break
    else
      blame "$ID" "verifier $attempt: FAIL — $(printf '%s' "$VOUT" | last_json | jq -r '.reasons // [] | join("; ")' 2>/dev/null)"
      FEEDBACK="The verifier rejected your change: $(printf '%s' "$VOUT" | last_json | jq -r '.reasons // [] | join("; ")' 2>/dev/null). Fix and re-verify in the same worktree."
    fi
  done
  if [ "$ok" -ne 1 ]; then
    echo "  ✗ gave up after $MAXR attempts → back to Ready (worktree kept: $WT; log: $LOGDIR/$ID.log)"
    "$SCRIPT_DIR/release.sh" --owner "$OWNER" --project "$PROJECT" --item "$ID" --status "$GP_STATUS_READY" >/dev/null 2>&1
  fi
}

# Build the work list: one --item, or the queue (bash 3.2 has no mapfile).
ROWS=()
if [ -n "$ITEM" ]; then
  ROWS=("$ITEM"$'\t'"$("$SCRIPT_DIR/snapshot.sh" get "$ITEM" 2>/dev/null | jq -r '.title // ""')")
else
  while IFS= read -r line; do [ -n "$line" ] && ROWS+=("$line"); done \
    < <("$SCRIPT_DIR/coord.sh" "$QUEUE" 2>/dev/null | head -n "$MAXI")
fi
[ "${#ROWS[@]}" -gt 0 ] || { echo "queue '$QUEUE' is empty — nothing to do."; exit 0; }

for row in "${ROWS[@]}"; do
  process_item "${row%%	*}" "${row#*	}" || echo "  (item errored — continuing)"
done
echo; echo "coordinator: run complete."
