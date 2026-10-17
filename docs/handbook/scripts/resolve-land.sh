#!/bin/zsh
# Usage: resolve-land.sh <slug> <pr> ... (pairs). For each worktree <worktrees>/<slug>: check the
# commits and diff for attribution text, merge origin/main, resolve the conflicts that are safe to
# resolve mechanically, regenerate the InDesign tool reference if needed, run every test, push,
# then wait for CI and merge. Stops with a message when a conflict needs a person.
S=${0:A:h}
WT=${ADOBE_MCP_WT:-$(cd ${S:h:h:h}/.. && d=$PWD && while [[ $d != / && ! -d $d/adobe-mcp-wt ]]; do d=${d:h}; done && echo $d/adobe-mcp-wt)}
while (( $# >= 2 )); do
  slug=$1; pr=$2; shift 2
  cd $WT/$slug || exit 1
  git fetch -q origin
  # No attribution in commits or added lines. MCP client names in install docs ("Claude Code",
  # "claude mcp add") and After Effects' "Keyframe Assistant" menu are product names, not attribution.
  if git log --format=%B origin/main..HEAD | grep -viE "keyframe assistant" | grep -qiE "co-authored-by|generated with|claude|anthropic|\bassistant\b"; then echo "#$pr $slug: attribution text in commits"; exit 5; fi
  if git diff origin/main...HEAD | grep -iE "^\+.*(claude|anthropic|\bassistant\b|co-authored-by)" | grep -viE "claude (code|desktop)|claude mcp add|keyframe assistant" | grep -q .; then echo "#$pr $slug: attribution text in the diff"; exit 5; fi
  if ! git merge --no-edit origin/main >/dev/null 2>&1; then
    files=(${(f)"$(git diff --name-only --diff-filter=U)"})
    for f in $files; do
      case $f in
        */docs/TOOLS.md) git checkout --theirs $f 2>/dev/null ;;   # regenerated below
        packages/*/src/server.js|packages/*/README.md|packages/*/NOTICE|packages/indesign/src/tools/index.js) python3 $S/union.py $f >/dev/null ;;
        *) python3 $S/safe-union.py $f || { echo "#$pr $slug: conflict in $f needs a look"; exit 3; } ;;
      esac
    done
    if grep -rq '^<<<<<<<\|^>>>>>>>' packages/ README.md; then echo "#$pr markers left"; exit 3; fi
    git add -A && git commit -q --no-edit || exit 1
  fi
  if [[ -f packages/indesign/scripts/generate-tool-reference.js ]] && ! node packages/indesign/scripts/generate-tool-reference.js --check >/dev/null 2>&1; then
    node packages/indesign/scripts/generate-tool-reference.js >/dev/null && git add -A && git commit -q -m "Regenerate the InDesign tool reference" || exit 1
  fi
  log=$(mktemp)
  (npm install -q >/dev/null 2>&1; npm test --workspaces >$log 2>&1) || { echo "#$pr $slug: tests fail after merge"; grep -E "not ok|findings|✖|FAILED|Error" $log | head; exit 4; }
  git push -q 2>&1 | grep -v '^remote:'
  sleep 20
  $S/merge-pr.sh $pr || exit 1
done
