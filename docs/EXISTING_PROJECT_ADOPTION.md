# Existing-Project Adoption

Existing-project adoption is reconciliation, not installation. FPB arrives as an operating substrate; it does not acquire authority merely because it is newer.

## Governing invariant

```text
existing project truth
+ FPB operating substrate
!= project replacement
```

The adoption sequence is:

```text
observe
→ classify
→ preserve
→ bind
→ fill only missing operating gaps
→ compile
→ run `python3 scripts/reconcile-project.py --project /path/to/project --pretty`, then reconcile
→ qualify
→ operate
```

## Phase A — Read-only discovery

Before consequential mutation, reconstruct from live project state where available:

- project/repository identity, remotes, branch, revision, dirty state, nested repositories;
- originating/current intent and explicit non-goals;
- authority hierarchy and protected effects;
- architecture, PRDs, schemas, design/token systems, policies, research, benchmarks;
- existing agent instructions and execution conventions;
- tests, CI, release/deployment surfaces and provider boundaries;
- work graph, claims, evidence, negative results, known limitations and rejected approaches.

Do not infer authority from filenames alone. Do not repair findings during discovery.

## Phase B — Bootstrap admission

Run the initializer with `--mode existing`.

The initializer is non-destructive. When an FPB candidate conflicts with an existing path, the existing path remains untouched and the FPB candidate is staged under `.formal-bootstrap/candidates/`. The collision is an unresolved alignment fact, not permission to copy the candidate over the project.

A non-zero collision disposition means **admitted but not reconciled**, not failed installation and not completed adoption.

## Phase C — Reconciliation and binding

For each collision or overlapping concept, determine the relationship before synthesis:

```text
exact
equivalent
constrained
extended
analogue
conflicting
unmapped
```

Prefer existing canonical project authority when it legitimately owns the concept. FPB should provide missing operating semantics by binding or specialization rather than by creating duplicate doctrine.

Do not create a second glossary, architecture map, work authority, evidence model, or agent contract merely to make adoption look clean.

If the project lacks a normalized `PROJECT_INTENT.md`, synthesize one from the strongest existing project evidence and record provenance. A generated placeholder is not project intent and must not be promoted as such.

## Phase D — Minimal gap closure

Introduce only missing operating primitives. Examples:

- existing issue workflow → bind it;
- existing CI/test gates → register them;
- existing evidence ledger → retain it;
- existing agent rules → reconcile them;
- missing compiled context → add it;
- missing negative-knowledge retention → add the smallest compatible record;
- missing blocker/frontier semantics → add only the required operating contract.

Tool availability never grants permission and provider access must not be widened merely to complete adoption.

## Phase E — Context and baseline

Compile context only after source authority and collisions are coherent enough to describe the project truthfully. Generated context is required for operation but remains non-normative.

Run the normal B0–B4 sequence. B5–B8 remain conditional observations and must not be manufactured for adoption.

## C4c qualification

Existing-project adoption is qualified only when:

```text
identity preserved
authority preserved
history/negative knowledge preserved
existing behavior preserved or regression classified
bindings explicit
contradictions retained
context reproducible
smallest Ready frontier established
one bounded cycle completed
```

A migration may be useful while still remaining `PARTIAL` because of unresolved authority, contradictory intent, stale evidence, unavailable providers, or unexecuted operational gates. Preserve the weaker claim.

## Stop conditions

Stop and require a genuine decision when adoption would require:

- replacing an existing canonical authority without precedence;
- choosing between materially conflicting project identities or intents;
- introducing a new canonical architecture/schema/service boundary;
- weakening existing tests, security, deployment, or evidence gates;
- widening provider permissions or creating credentials;
- discarding unresolved contradiction or historical negative knowledge.

Otherwise, unresolved local adoption findings become bounded work and the project continues through lawful Ready items.
