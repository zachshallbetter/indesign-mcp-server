#!/usr/bin/env bash
#
# repo-map.sh — turn a board "Repos" hint (a category/service/crate name, or a path,
# or "owner/name") into a concrete target: local repo path + GitHub owner/name + crate.
# This is what lets the coordinator work the Ready queue WITHOUT being told --repo.
#
# Cached at <fleet-root>/.repo_map.tsv:  key <TAB> repo_path <TAB> owner/name <TAB> crate
#
#   repo-map.sh generate        scan the fleet and (re)write the map
#   repo-map.sh resolve <hint>  print  repo_path <TAB> owner/name <TAB> crate  (best match)
#   repo-map.sh show            print the whole map
#
# Regenerate after adding/moving repos. Multi-repo hints ("a, b, c") resolve to the
# first that maps — the coordinator treats genuinely multi-repo items as out of scope.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")"
MAP="${GH_REPO_MAP:-$ROOT/.repo_map.tsv}"
TAB="$(printf '\t')"

owner_name() { git -C "$1" remote get-url origin 2>/dev/null | sed -E 's#^git@github\.com:#https://github.com/#; s#.*github\.com/##; s#\.git$##'; }
pkg_name() {
  if [ -f "$1/Cargo.toml" ]; then
    awk -F= '/^\[package\]/{p=1;next} p&&/^[[:space:]]*name[[:space:]]*=/{gsub(/[ "]/,"",$2);print $2;exit}' "$1/Cargo.toml"
  elif [ -f "$1/package.json" ] && command -v jq >/dev/null; then
    jq -r '.name // empty' "$1/package.json" 2>/dev/null
  fi
}

generate() {
  : > "$MAP.tmp"
  find "$ROOT" \( -name target -o -name node_modules -o -name .wt \) -prune -o -name .git -print 2>/dev/null \
  | while IFS= read -r gitpath; do
      repo="$(dirname "$gitpath")"; own="$(owner_name "$repo")"; [ -n "$own" ] || continue
      printf '%s\t%s\t%s\t%s\n' "$(basename "$repo")" "$repo" "$own" "" >> "$MAP.tmp"
      # Only THIS repo's own tracked manifests — ls-files stops at nested repo/submodule
      # boundaries, so a parent never absorbs a child repo's crates.
      git -C "$repo" ls-files 2>/dev/null | grep -E '(^|/)(Cargo\.toml|package\.json)$' \
      | while IFS= read -r rel; do
          sub="$(dirname "$rel")"; [ "$sub" = "." ] && continue   # repo-root manifest already keyed
          d="$repo/$sub"
          printf '%s\t%s\t%s\t%s\n' "$(basename "$sub")" "$repo" "$own" "$(pkg_name "$d")" >> "$MAP.tmp"
        done
    done
  # one row per key; prefer the row carrying a crate (more specific) via reverse sort on col4
  sort -t"$TAB" -k1,1 -k4,4r "$MAP.tmp" | awk -F"$TAB" '!seen[$1]++' > "$MAP"
  rm -f "$MAP.tmp"
  echo "wrote $(grep -c . "$MAP" 2>/dev/null || echo 0) keys → $MAP"
}

resolve() {
  local hint="$1" cand row best=""
  [ -f "$MAP" ] || generate >/dev/null 2>&1
  # 1) an explicit path inside the hint
  for cand in $(printf '%s' "$hint" | tr ',()' '   '); do
    [ -n "$cand" ] && [ -d "$ROOT/$cand" ] || continue
    rp="$(git -C "$ROOT/$cand" rev-parse --show-toplevel 2>/dev/null)"
    [ -n "$rp" ] && { printf '%s\t%s\t%s\n' "$rp" "$(owner_name "$rp")" ""; return 0; }
  done
  # 2) token match; prefer a key whose row carries a crate (more specific)
  for cand in $(printf '%s' "$hint" | tr ',()/ ' '\n' | grep -v '^$' | sort -u); do
    row="$(awk -F"$TAB" -v k="$cand" '$1==k{print;exit}' "$MAP" 2>/dev/null)"
    [ -n "$row" ] || continue
    [ -n "$(printf '%s' "$row" | cut -f4)" ] && { printf '%s' "$row" | cut -f2-4; return 0; }
    [ -z "$best" ] && best="$row"
  done
  [ -n "$best" ] && { printf '%s' "$best" | cut -f2-4; return 0; }
  return 1
}

case "${1:-}" in
  generate) generate ;;
  resolve)  shift; resolve "${1:?usage: repo-map.sh resolve <hint>}" || { echo "no repo match for: ${1:-}" >&2; exit 1; } ;;
  show)     cat "$MAP" 2>/dev/null || echo "no map yet — run: repo-map.sh generate" ;;
  *) echo "usage: repo-map.sh {generate|resolve <hint>|show}" >&2; exit 2 ;;
esac
