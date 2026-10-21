# Repository Governance & Change Control

## 1. Change Classes

- **Editorial Correction**: Restores an existing rule or corrects documentation typos. May land as a patch.
- **Repository Capability**: Adds tooling, checks, examples, or optional profiles without changing the core operating contract.
- **Normative Change**: Modifies authority, work authorization, evidence semantics, autonomy boundaries, context rules, or operating invariants. Requires a dedicated issue and explicit compatibility assessment.

## 2. Anti-Bloat Test

Before adding a canonical concept or abstraction, determine whether the need can be represented by:
- reference;
- binding;
- specialization;
- constraint;
- projection;
- qualification;
- composition.

Only an irreducible distinction earns a new canonical concept.

## 3. Evidence Requirement

A change must state the problem it closes and provide empirical evidence that the problem exists. New abstractions without an observed failure mode remain proposals.

## 4. Human Authority

Repository maintainers retain release, tagging, and normative-change authority. Automation may prepare, verify, and recommend; it does not manufacture approval.
