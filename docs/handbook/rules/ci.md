# Verification Craft & Quality Gates

## 1. Quality Gates That Cannot Fail

- **Prove Failure Capability**: Every gate or test must be proven capable of failing when fed a defect before being trusted in CI.
- **No-Op Protection**: CI workflows must report how many assertions actually executed, ensuring skipped or category-error jobs cannot produce a false green check.
- **Cross-Toolchain Determinism**: Compare build outputs and conformance vectors across distinct engines or runtime environments to prove platform determinism.

## 2. Standard Repository Gates

Before proposing or merging changes, execute the authoritative verification suite:

```bash
python3 scripts/validate-bootstrap.py --check-context
python3 scripts/validate-formal-files.py
python3 scripts/check-protocol-integrity.py
python3 scripts/check-negative-results.py
```

## 3. Ephemeral Worktree Isolation

- Autonomous verification tasks must run in isolated worktrees (`git worktree add`) or temporary directory environments to avoid dirtying developer working state.
- Automatically clean up temporary worktrees and test harnesses upon completion or interruption.
