# Resolve every conflict in a file by keeping both sides (ours, then theirs, without
# repeating lines theirs shares with ours). For registration lists and README tables.
import re, sys
for p in sys.argv[1:]:
    s = open(p, encoding='utf-8').read()
    def keep(m):
        ours, theirs = m.group(1).splitlines(True), m.group(2).splitlines(True)
        return ''.join(ours + [l for l in theirs if l not in ours])
    open(p, 'w', encoding='utf-8').write(re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', keep, s, flags=re.S))
