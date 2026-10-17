#!/bin/zsh
# Land PRs one at a time from <work>/queue.txt ("<slug> <pr>" per line, appended by whoever
# coordinates); results go to <work>/queue.log. Run it in the background and leave it running.
S=${0:A:h}
WT=${ADOBE_MCP_WT:-$(cd ${S:h:h:h}/.. && d=$PWD && while [[ $d != / && ! -d $d/adobe-mcp-wt ]]; do d=${d:h}; done && echo $d/adobe-mcp-wt)}
WORK=${ADOBE_MCP_WORK:-$WT/_coord}
mkdir -p $WORK
Q=$WORK/queue.txt; L=$WORK/queue.log
touch $Q $L
while true; do
  line=$(head -n 1 $Q)
  if [[ -z $line ]]; then sleep 30; continue; fi
  sed -i '' 1d $Q 2>/dev/null || sed -i 1d $Q
  slug=${line%% *}; pr=${line##* }
  state=$(gh pr view $pr --repo ${GITHUB_REPO:-zachshallbetter/adobe-mcp} --json state -q .state 2>/dev/null)
  if [[ $state == MERGED ]]; then echo "$(date +%H:%M) #$pr already merged" >> $L; continue; fi
  out=$($S/resolve-land.sh $slug $pr 2>&1 | tail -3)
  echo "$(date +%H:%M) $slug #$pr: $out" >> $L
done
