# Landing and Promotion

Implementation, integration, evidence closure, and promotion are separate state transitions.

## Required distinction

```text
candidate exists
      ↓
candidate verified
      ↓
landed/integrated
      ↓
landed state verified
      ↓
evidence closed
      ↓
promotion authorized
```

A project may omit stages that genuinely do not exist, but it may not silently merge stages that do.

## Candidate identity

Evaluation binds to a frozen candidate revision or artifact identity.

Changing the candidate invalidates evaluation that depended on the prior identity.

## Landing

Landing means the candidate became part of the project system of record: for example a merge/fast-forward, accepted package revision, schema migration, or equivalent integration event.

Landing does not prove the landed state behaves as the candidate did.

## Post-landing verification

Verify the actual landed identity when acceptance depends on integration.

## Promotion

Promotion is an authority decision. Passing tests, evaluator agreement, peer consensus, or landed status does not manufacture promotion authority.
