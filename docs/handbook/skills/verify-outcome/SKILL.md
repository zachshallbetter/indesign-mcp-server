---
name: verify-outcome
description: Use before recommending Done/Verified, promotion, release, or a consequential claim. Evaluates a frozen candidate against declared acceptance and evidence requirements.
---

# Verify Outcome

## Requirements

Requires a frozen candidate and a work item that defines acceptance, evidence, and evaluator authority. Use that project's checks and lifecycle terms; this skill does not prescribe a specific test runner or service.

1. Freeze candidate identity and revision using the project's identity rules.
2. Read the work item's acceptance criteria, evidence requirements, and evaluator authority.
3. Run the exact checks and negative paths required by that contract, using its declared tools and environments. Do not upload candidate contents or full logs unless acceptance explicitly requires it and the destination is authorized; redact secrets from retained evidence.
4. Bind results to the observed environment and candidate revision.
5. Distinguish executed, skipped, contradicted, inconclusive, and human-required evidence using the project's evidence vocabulary.
6. Do not edit the candidate during verification; report defects for a new implementation pass.
7. Return only the maturity supported by the project's lifecycle, with limitations and missing evidence.
