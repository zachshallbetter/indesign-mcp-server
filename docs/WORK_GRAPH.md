# Work Graph

## States

```text
Backlog
Ready
In progress
In review
Done
Verified
```

Provider labels may differ; meanings must not.

## Ready predicate

For the single owner-authorized `adobe-mcp-suite@0.3.0` outage release, the complete item in `records/local-work-items.jsonl` supplies Ready state while the bound ProjectsV2 board is unset. Other items still require the bound work graph.

```text
scope complete
∧ exclusions complete
∧ dependencies satisfied
∧ acceptance defined
∧ evidence requirements defined
∧ permissions/effect class valid
∧ target workspace resolvable
∧ budget valid
∧ stop conditions present
```

Evaluator identity is required when independent evaluation is part of acceptance.

## Work item

```ts
interface WorkItem {
  id: string;
  intentRef: string;
  parentRef?: string;

  objectiveOrHypothesis: string;
  scope: string[];
  exclusions: string[];
  dependencies: string[];

  acceptance: string[];
  evidenceRequirements: string[];
  evaluatorRef?: string;

  permissions: string[];
  effectClass: "E0" | "E1" | "E2" | "E3" | "E4";

  target: {
    repositoryOrArtifact: string;
    authorizedPaths?: string[];
  };

  budget: {
    retries?: number;
    money?: number;
    humanAttentionMinutes?: number;
  };

  stopConditions: string[];
}
```

Domain profiles may attach candidate/asset/etc. references without modifying the base work-state meaning.

## Claim semantics

```text
read live item
→ acquire claim
→ reread
→ execute only if ownership still holds
```

One active mutation claim per worker. Controlled batching must be explicit.

## Blocker semantics

A blocker records:

```text
type
scope
evidence
recovery condition
affected dependencies
whether unrelated work may proceed
```

Blocked state does not erase the item.

## Frontier

The coordinator selects from all currently Ready, unclaimed, dependency-satisfied items within authority and budget.

A blocked item removes only itself and its dependents from the frontier unless the blocker is global.
