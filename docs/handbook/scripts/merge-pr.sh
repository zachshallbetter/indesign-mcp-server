#!/bin/zsh
# Usage: merge-pr.sh <pr>. Wait for the PR's checks, then merge it with a merge commit titled
# "<PR title> (#pr)". Refuses when any check did not pass.
pr=$1; R=${GITHUB_REPO:-zachshallbetter/adobe-mcp}
sleep 10
gh pr checks $pr --repo $R --watch --interval 20 >/dev/null 2>&1
if gh pr checks $pr --repo $R 2>/dev/null | awk -F'\t' '{print $2}' | grep -qv '^pass$'; then echo "#$pr checks failed"; exit 1; fi
title=$(gh pr view $pr --repo $R --json title -q .title)
gh pr merge $pr --repo $R --merge --subject "$title (#$pr)" >/dev/null 2>&1 || { echo "#$pr merge refused"; exit 1; }
echo "#$pr merged"
