---
name: reconcile-project
description: Use at project/session start, after material source changes, after external provider changes, or when state may be stale. Reconstructs current state read-only before mutation.
---

# Reconcile Project

## Requirements

Use in an initialized project with declared intent, authority, profile, context policy, and provider interfaces. Provider-specific tools and records must be supplied by the target project.

1. Verify project identity, intent, profile, authority, and pinned formal sources.
2. Verify repository, branch, commit, submodules, and dirty state for each in-scope target.
3. Check compiled context against its declared source policy; regenerate only after canonical sources are reconciled.
4. Check each provider named in the active profile using its documented health and identity procedures. For this repository's ACP binding, run `scripts/acp-check.py`; when `reportOnSessionStart` is true, use `scripts/acp.py report` and `scripts/acp.py snapshot`. Send only the metadata required by the provider contract; do not upload prompts, source files, or secrets. Treat refusal or unavailable state as a typed blocker; never bypass a provider boundary with another credential path.
5. Refresh the live work graph through the configured work-graph read path (this repository routes board reads through `scripts/acp.py board`), then reconcile claims, execution-provider state, evidence, and blockers. Treat local snapshots as hints, not live state.
6. Record contradictions, bounded searches, and null-result limitations using the project's evidence conventions.
7. Keep reconciliation read-only; do not repair authority, provider, or source state in this pass.
8. Return the current Ready frontier under the provider's state mapping and any localized or global stop condition. If the profile or required provider contracts are absent, report that as a setup blocker instead of assuming a default.
