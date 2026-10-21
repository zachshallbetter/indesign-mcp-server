# Authority Model

## Principle

Authority is the right to cause a protected effect under scope.

```text
CAPABILITY != PERMISSION != EVIDENCE != QUALIFICATION != PROMOTION AUTHORITY
```

Tool access, repository access, model capability, expertise, confidence and peer consensus do not create authority.

## Instrument stratification

Wherever two record types can attach to one consequential effect, the governing state declares which instrument **authorizes** the effect and which merely observes, remembers, or pressures. The weaker instrument grants nothing.

A debt entry, receipt, evidence record, observation, or claim never substitutes for the authorizing instrument, however faithfully it is recorded. **Authorization by the cheaper record** is a named illegal pattern; every normative change is checked against it.

(Incident provenance: a debt-ratchet clause once permitted deploying a locally patched dependency merely by recording the debt, bypassing the deviation requirement — caught in owner review, not by drafting or verification. semantic-cms NR-scms-001, 2026-08-28.)

## Effect classes

```text
E0  observational
E1  reversible internal mutation
E2  reversible/compensable operational mutation
E3  consequential external commitment
E4  durable/irreversible effect
```

Projects may refine these classes but must not silently weaken a higher-level protected effect.

## Minimum generic authorities

A project should bind effects rather than proliferating role names.

```text
project mutation
qualification
promotion
production operation
deviation
```

Domain profiles add only the authorities they actually need.

## Protected-effect rule

An operation is applicable only when all are true:

```text
operation exists
∧ current state permits it
∧ dependencies permit it
∧ actor has scoped authority
∧ budget permits it
∧ required evidence/checks exist
∧ recovery requirements are satisfied
```

Technical possibility is irrelevant.

## Human deviation

A human may intentionally change the governing state. The safe form is a recorded deviation:

```ts
interface Deviation {
  id: string;
  authorityRef: string;
  ruleRef: string;
  reason: string;
  scope: string[];
  allowedEffects: string[];
  createdAt: string;
  expiresAt?: string;
  recovery?: string;
  evidenceRequired?: string[];
}
```

A deviation does not rewrite the original rule. It is bounded, owned, visible and closable.

## Bound authorizing instrument

When `PROJECT_PROFILE.json` binds `authorizationProvider`, that provider's decision is the authorizing instrument for governed effects (E2 and above by default). Deviations, evidence, receipts and reports attach to the same effect but never authorize it. See `docs/ACP_INTEGRATION.md`.

The repository owner's explicit one-time `adobe-mcp-suite@0.3.0` outage release in `PROJECT_PROFILE.json` is a separate, bounded authorizing instrument while ACP is unreachable. Its work item, allowed effects, closure condition and evidence are recorded in `records/local-work-items.jsonl` and `records/deviations.jsonl`. It does not turn a synthetic ACP denial into `ALLOW` and cannot override a real ACP refusal or containment decision.

## Failure

If an effect is possible but unauthorized:

```text
AUTHORITY_MISSING
mutation = none
record blocker
release/park claim
continue unrelated Ready work
```
