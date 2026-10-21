# Protocol adapters

Formal Project Bootstrap is a composition and operating substrate. It does not copy the doctrine of an external protocol into its own authority model. An adapter declares how a pinned protocol is imported, projected, checked, and reconciled.

Each adapter is `profiles/<adapter-id>/adapter.json` and validates against `schemas/protocol-adapter.schema.json`.

The contract requires immutable protocol identity, supported FPB versions, authority role, imported and projected concepts, lifecycle and evidence mappings, explicit unsupported behavior, six-dimensional compatibility, conformance checks, and adoption/re-pin/deviation behavior.

IEPE is the primary operating adapter. EQP qualifies evidence, ICP governs consequential interaction contracts, ESP/RCP govern external-state obligations, and SES/SSS/SPS govern semantic publication. ACP remains the authorization boundary for protected effects.

Generated context may summarize adapter records but never becomes their authority. A protocol re-pin is a compatibility event and may require re-qualification.

Runtime checks are deliberately separate from the adapter declarations:

- `scripts/validate-qualification.py` validates EQP qualification records and refuses unsupported `QUALIFIED` outcomes.
- `scripts/validate-interaction-contract.py` requires ACP authorization, idempotency, recovery, and receipts for protected ICP effects.
- `scripts/recipient-status.py` derives RCP status from an explicit as-of date.
- `scripts/validate-semantic-surface.py` refuses SES/SSS projections that lack source provenance, collapse access states, or leak renderer/domain authority.
- `scripts/check-protocol-integrity.py` checks project manifests and JSONL records without mutating them.

For existing projects, `scripts/reconcile-project.py` reports canonical documents, missing records, adapter pin drift, declared unsupported features, context freshness, authority conflicts, and recommended migration steps. Its first pass is read-only; it does not install an adapter or rewrite a source document.

These checks do not promote work. They establish that a record is structurally and procedurally eligible for the authority that must still make the decision.
