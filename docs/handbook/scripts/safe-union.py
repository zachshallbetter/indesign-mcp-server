# Keep both sides of conflicts only when every conflicting line is a quoted list
# entry (e.g. a feature id) or a comment; exit 1 if any block is anything else.
import re, sys
COMMENT = re.compile(r'^\s*//')
LINE = re.compile(r"^\s*(('[^']*'|\"[^\"]*\"),\s*)*('[^']*'|\"[^\"]*\"),?\s*$")
ok = True
for p in sys.argv[1:]:
    s = open(p, encoding='utf-8').read()
    def fix(m):
        global ok
        # One-line lists on both sides (e.g. features: [...]): merge their items.
        A = re.match(r"^(\s*\w+: \[)(.*)(\],?\s*)$", m.group(1).rstrip('\n'))
        B = re.match(r"^(\s*\w+: \[)(.*)(\],?\s*)$", m.group(2).rstrip('\n'))
        if A and B and A.group(1) == B.group(1) and m.group(1).count('\n') == 1 and m.group(2).count('\n') == 1:
            items = []
            for part in (A.group(2) + ', ' + B.group(2)).split(','):
                part = part.strip()
                if part and part not in items: items.append(part)
            return A.group(1) + ', '.join(items) + A.group(3) + '\n'
        lines = (m.group(1) + m.group(2)).splitlines()
        if not all(LINE.match(l) or COMMENT.match(l) or not l.strip() for l in lines): ok = False; return m.group(0)
        # Keep each comment line and each list item once, in first-seen order.
        seen, out = set(), []
        for l in lines:
            if not l.strip(): continue
            if COMMENT.match(l):
                if l.strip() not in seen: seen.add(l.strip()); out.append(l)
                continue
            indent = l[:len(l) - len(l.lstrip())]
            items = [i for i in re.findall(r"'[^']*'|\"[^\"]*\"", l) if i not in seen]
            seen.update(items)
            if items: out.append(indent + ', '.join(items) + ',')
        return '\n'.join(out) + '\n'
    s2 = re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', fix, s, flags=re.S)
    open(p, 'w', encoding='utf-8').write(s2)
sys.exit(0 if ok else 1)
