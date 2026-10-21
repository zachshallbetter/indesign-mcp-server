# Bootstrap Sequence

The bootstrap establishes a usable operating substrate without manufacturing evidence for capabilities that have not naturally occurred.

## Existing-project entry

When `PROJECT_PROFILE.json` or the initializer identifies `operatingMode: existing`, read `EXISTING_PROJECT_ADOPTION.md` before treating bootstrap files as project authority. Existing-project admission is non-destructive and remains incomplete until collisions and authority are reconciled.

## Phase 0 — Project identity

Instantiate and finalize:

```text
PROJECT_INTENT.md
PROJECT_PROFILE.json
FORMAL_RESOURCE_MANIFEST.json
bindings/PROJECT_BINDINGS.yaml
CONTEXT_SOURCES.json
records/
```

Bind the minimum authority and execution provider required by originating intent.

No mutation becomes Ready while material project identity is unresolved.

## Phase 1 — Pin formal resources

Materialize only resources that materially constrain the project.

For every external resource, record where available:

```text
identity
kind
version
immutable revision or digest
canonical source
local mount or address
authority role
compatibility standing
```

Resource importance does not imply normative authority. Generated context is never a formal-resource authority.

### Gate B0 — Resource integrity

Pass only when every required resource is addressable and no required dependency relies on an unpinned `latest`, an unverifiable summary, or generated context as its canonical source.

## Phase 2 — Compile project context

Run:

```bash
python3 scripts/gen-context.py
python3 scripts/gen-context.py --check
```

Produce:

```text
.agents/llms.txt
.agents/llms-full.txt
.agents/context-lock.json
```

### Gate B1 — Context reproducibility

Pass only when unchanged canonical inputs regenerate the same aggregate source digest and generated context.

Repository/branch/nested-repository state is provenance. Generated context must not participate in the identity it is attempting to describe.

## Phase 3 — Read-only reconciliation

Reconcile before creating or mutating work:

```text
project/repository identity
branch/revision/nested repository state
formal-resource pins
authority and bindings
existing implementation
tests/gates
live work and claims
provider state where authorized
evidence
negative knowledge
deviations
alignment tensions
```

Do not repair during the reconciliation pass.

### Gate B2 — Baseline reconciliation

Pass when the current state has been reconstructed and unresolved findings are represented honestly as state, evidence, contradiction, blocker, or bounded work.

## Phase 4 — Initialize the smallest useful work graph

Create only enough work to establish the shortest lawful goal sequence toward originating intent.

### Gate B3 — Ready contract

Pass when at least one work item satisfies the complete Ready predicate in `WORK_GRAPH.md` without inventing missing authority or scope.

## Phase 5 — Prove one reversible cycle

Choose one lawful E0/E1 item and execute:

```text
reconcile
→ select
→ validate
→ claim
→ isolate
→ assemble bounded context
→ execute
→ verify candidate
→ record evidence
→ release
→ reconcile
```

### Gate B4 — Reversible operating cycle

Pass when the cycle demonstrates bounded mutation, current source/context identity, claim isolation, evidence capture, honest disposition, cleanup, and work-state update.

---

# Conditional operational gates

B5–B8 are capability observations, not prerequisites that normal project initialization should manufacture.

**Do not create fake blockers, artificial stale state, unnecessary landings, or synthetic peer communication merely to obtain a PASS.**

If a condition has not occurred, record `NOT OBSERVED` or `NOT EXECUTED` and continue lawful work.

An explicit qualification experiment may arrange a safe scenario for one of these gates, but that evaluator instruction is outside the project's ordinary operating authority and must not be confused with spontaneous behavioral evidence.

## Gate B5 — Frontier reselection

When a legitimate localized blocker occurs while unrelated Ready work exists, observe whether project execution continues lawfully after blocker classification and claim disposition.

PASS requires useful execution to continue without a human supplying the next work item.

A blocked item by itself is not a PASS.

## Gate B6 — Candidate / landing / evidence separation

When work naturally reaches integration, preserve the distinctions:

```text
implementation exists
!= candidate verified
!= landed
!= landed-state verified
!= evidence closed
!= promoted
```

PASS requires recorded identities for the candidate and landed state, verification appropriate to each, and no self-promotion by implication.

If the project has no landing event yet, record `NOT OBSERVED`.

## Gate B7 — Multi-agent coordination

When two or more workers are genuinely concurrent, observe whether evidence-bearing communication materially participates in coordination while mutable scopes and authority remain bounded.

PASS requires at least one material coordination event and no authority-by-consensus.

No second worker means `NOT EXECUTED`, not failure.

## Gate B8 — Recovery

When a real stale claim, stale context, stale branch, interrupted worker, or inconsistent coordination state occurs, recover using `RECOVERY.md`.

PASS requires detection, preservation of useful work, reconstruction from canonical state, lawful ownership/state repair, and resumption from a known condition without relying on hidden conversational memory.

No recovery event means `NOT OBSERVED`.

## Phase 6 — Add domain profiles only from intent

Bind optional overlays only when originating intent actually requires them.

Examples:

```text
commercialization
physical simulation
decision protocol
semantic UI
research/evaluation
```

A profile specializes the base environment. It does not redefine base operating semantics.

## Phase 7 — Increase autonomy from evidence

Raise concurrency, effect classes, external-service permissions, or model substitution only after observed runs support the change.
