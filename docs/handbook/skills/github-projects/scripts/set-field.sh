#!/usr/bin/env bash
#
# set-field.sh — Set a project item's field value(s) by human-readable name.
#
# The raw `gh project item-edit` call needs the project node ID, the field node
# ID, and (for single-select / iteration fields) the *option* or *iteration*
# node ID — none of which you carry in your head. This wrapper resolves all of
# them from plain names, picks the right typed value flag for the field's data
# type, and makes the edit. It is the single most-reused project operation.
#
# Usage:
#   # one field
#   set-field.sh --owner <o> --project <n> --item <itemID> --field <name> --value <value>
#   set-field.sh --owner <o> --project <n> --item <itemID> --field <name> --clear
#   # many fields in ONE call (resolves the project once) — repeat --set:
#   set-field.sh --owner <o> --project <n> --item <itemID> \
#     --set "Status=In progress" --set "Effort=M" --set "Repos=generation"
#
# Examples:
#   set-field.sh --owner example-org --project 2 --item PVTI_xxx --field Status --value "In progress"
#   set-field.sh --owner example-org --project 2 --item PVTI_xxx --set "Status=Done" --set "Effort=L"
#
# `--set` splits on the FIRST `=`, so values may contain `=`. Single-select and
# iteration matching is case-insensitive by name. Prefer `--set` in bulk loops:
# fewer invocations means fewer shell-quoting mistakes (see references/gotchas.md).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OWNER="" PROJECT="" ITEM="" FIELD_NAME="" VALUE="" CLEAR=0
PAIRS=()   # each entry: "FieldName=Value"
while [ $# -gt 0 ]; do
  case "$1" in
    --owner)   OWNER="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --item)    ITEM="$2"; shift 2;;
    --field)   FIELD_NAME="$2"; shift 2;;
    --value)   VALUE="$2"; shift 2;;
    --set)     PAIRS+=("$2"); shift 2;;
    --clear)   CLEAR=1; shift;;
    *) echo "error: unknown argument '$1'" >&2; exit 2;;
  esac
done
. "$SCRIPT_DIR/lib.sh"
gp_resolve; gp_require_target          # --owner/--project optional; fall back to active project
: "${ITEM:?--item required}"
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

# Resolve the project + all field metadata ONCE, reused for every field below.
META="$("$SCRIPT_DIR/project-ids.sh" "$OWNER" "$PROJECT")"
PROJECT_ID="$(echo "$META" | jq -r '.projectId')"

# apply_one <field-name> <value>  — resolve the field's id/type and set the value.
apply_one() {
  local name="$1" value="$2" field id dtype opt iter
  field="$(echo "$META" | jq -c --arg n "$name" '.fields[] | select(.name == $n)')"
  if [ -z "$field" ]; then
    echo "error: field '$name' not found. Available: $(echo "$META" | jq -r '[.fields[].name] | join(", ")')" >&2
    return 1
  fi
  id="$(echo "$field" | jq -r '.id')"
  dtype="$(echo "$field" | jq -r '.dataType')"
  local base=(gh project item-edit --id "$ITEM" --project-id "$PROJECT_ID" --field-id "$id")
  # apply_one is always called under `|| rc=1`, which switches `set -e` off for
  # the whole call -- so a failed item-edit used to fall through to the snapshot
  # patch and the "set ..." line, reporting a write that never landed.
  local edit=0
  case "$dtype" in
    TEXT)   "${base[@]}" --text "$value" >/dev/null || edit=$? ;;
    NUMBER) "${base[@]}" --number "$value" >/dev/null || edit=$? ;;
    DATE)   "${base[@]}" --date "$value" >/dev/null || edit=$? ;;
    SINGLE_SELECT)
      opt="$(echo "$field" | jq -r --arg v "$value" '.options[]? | select((.name|ascii_downcase) == ($v|ascii_downcase)) | .id' | head -1)"
      [ -n "$opt" ] || { echo "error: option '$value' not found for '$name'. Options: $(echo "$field" | jq -r '[.options[].name] | join(", ")')" >&2; return 1; }
      "${base[@]}" --single-select-option-id "$opt" >/dev/null || edit=$? ;;
    ITERATION)
      iter="$(echo "$field" | jq -r --arg v "$value" '.iterations[]? | select((.title|ascii_downcase) == ($v|ascii_downcase)) | .id' | head -1)"
      [ -n "$iter" ] || { echo "error: iteration '$value' not found for '$name'. Iterations: $(echo "$field" | jq -r '[.iterations[]?.title] | join(", ")')" >&2; return 1; }
      "${base[@]}" --iteration-id "$iter" >/dev/null || edit=$? ;;
    *)
      echo "error: field '$name' has data type $dtype, which item-edit cannot set directly." >&2
      echo "       Editable types: TEXT, NUMBER, DATE, SINGLE_SELECT, ITERATION. Built-in fields" >&2
      echo "       (Assignees, Labels, Milestone, Repository) are set on the issue/PR — see references/graphql.md." >&2
      return 1 ;;
  esac
  [ "$edit" -eq 0 ] || {
    echo "error: gh project item-edit failed for '$name' on $ITEM (exit $edit); the board was not changed" >&2
    return 1
  }
  gp_snapshot_set_field "$ITEM" "$name" "$value"   # keep local snapshot aligned (free, best-effort)
  echo "set '$name' = '$value' on $ITEM"
}

# --clear targets a single --field.
if [ "$CLEAR" -eq 1 ]; then
  : "${FIELD_NAME:?--clear requires --field <name>}"
  fid="$(echo "$META" | jq -r --arg n "$FIELD_NAME" '.fields[] | select(.name==$n) | .id')"
  [ -n "$fid" ] || { echo "error: field '$FIELD_NAME' not found." >&2; exit 1; }
  gh project item-edit --id "$ITEM" --project-id "$PROJECT_ID" --field-id "$fid" --clear >/dev/null
  gp_snapshot_set_field "$ITEM" "$FIELD_NAME" ""   # keep local snapshot aligned with the clear
  echo "cleared '$FIELD_NAME' on $ITEM"
  exit 0
fi

# Need at least one thing to do.
if [ -z "$FIELD_NAME" ] && [ "${#PAIRS[@]}" -eq 0 ]; then
  echo "error: nothing to set — pass --field/--value, --set \"Name=Value\", or --clear." >&2
  exit 2
fi

# A single --field/--value, plus any --set pairs. Apply every field even if one
# fails (so the valid ones still land), but remember the failure and exit non-zero
# so callers — and `set -e` loops — can't mistake a partial apply for success.
rc=0
[ -n "$FIELD_NAME" ] && { apply_one "$FIELD_NAME" "$VALUE" || rc=1; }
if [ "${#PAIRS[@]}" -gt 0 ]; then
  for pair in "${PAIRS[@]}"; do
    apply_one "${pair%%=*}" "${pair#*=}" || rc=1
  done
fi
exit "$rc"
