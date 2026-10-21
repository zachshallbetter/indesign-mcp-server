---
name: operate-frontier
description: Use to autonomously execute Ready work across a project. Handles selection, claim, isolation, bounded execution, localized blockers, release and frontier reselection.
---

# Operate Frontier

## Requirements

Use in a project with a live work graph, claim and isolation mechanisms, acceptance/evidence rules, and a bound authorization path for governed effects. If any required contract is missing, stop at that boundary.

1. Reconcile using the active project's profile and provider bindings.
2. Select a work item that satisfies the project's Ready predicate, is unclaimed, has satisfied dependencies, and is within authority and budget. Provider-specific state labels may differ; use their declared mapping.
3. Acquire the claim and isolated workspace through the configured work-graph/execution providers, then re-read live state to confirm ownership.
4. Compile work context using the active project's context policy and current source lock.
5. Execute the smallest correct change.
6. Before any governed effect, use `authorize-protected-effect` and the provider bound by the active project's profile; proceed only within the exact authorization returned.
7. On a local blocker (including refused or unavailable authorization): record it, release or park the claim, notify affected peers with only task-relevant details, then reselect.
8. On a global stop (including `QUARANTINE`/`LOCKED` for the resource in scope): prepare the smallest decision packet and stop.
9. On candidate completion: submit for evaluation/qualification required by the issue.
10. Record disposition using the project's work/evidence contracts, release the claim through its provider, and reselect if lawful work remains.
