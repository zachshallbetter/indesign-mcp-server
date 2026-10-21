# Context Compilation

Compiled context is required operating infrastructure after project initialization. It is never normative authority.

## Outputs

```text
.agents/llms.txt
.agents/llms-full.txt
.agents/context-lock.json
```

`llms.txt` is the search/navigation index. `llms-full.txt` is the deterministic transport/search corpus. `context-lock.json` binds those projections to the exact selected source contents and records Git repository state observed when compilation occurred.

The compiler validates its source policy, ignores symlinks and sensitive-file patterns, rejects unreadable or changing eligible sources, and redacts credentials from Git remote provenance. Exclusions are reported during generation. Generated artifacts are published only after successful compilation; `--check` is read-only.

## Validity

Context validity is determined by the aggregate digest of selected canonical sources. Repository HEAD is retained as **provenance**, not used as a self-referential validity predicate: a tracked generated file cannot contain the hash of the commit that contains itself.

A changed branch or commit therefore triggers reconciliation, not automatic semantic invalidity. If selected source contents changed, the digest changes and the context is stale. If Git state changed but selected sources did not, the corpus remains content-valid, while branch-specific/absence claims must still be rechecked against live repository state.

## Rules

- Never edit generated context to fix authority.
- Regenerate after material canonical-source changes.
- Record exact repository/nested-repository state before consequential work.
- Treat null search results as bounded by the checkout represented, not as universal absence.
- Active workers load only issue-relevant excerpts even though the full corpus is available.

## Commands

```bash
python3 scripts/gen-context.py
python3 scripts/gen-context.py --check
# Optional bounded compilation:
python3 scripts/gen-context.py --path docs --path scripts/gen-context.py
```

The source policy may add `excludePatterns` for project-specific sensitive files. The default patterns exclude environment variants, private-key/certificate containers, and common credentials/secrets JSON files. Canonical sources remain authoritative; repair stale context by correcting the source and regenerating it.

The lock records selected paths, included byte/file counts, and exclusion counts. Checks compare those fields, the complete source manifest, and both projections, so a partial or mixed generation is reported stale.
