# Formal Resources

Formal resources are external or project-local bodies of knowledge that materially constrain the project.

They are registered in `FORMAL_RESOURCE_MANIFEST.json`.

## Resource kinds

Typical kinds include:

```text
protocol
PRD
architecture
design-system
token-system
schema-pack
policy
research-corpus
benchmark
reference
```

The list is open. Do not create a new kind when an existing one is sufficient.

## Resource record

A resource records, when applicable:

```text
id
kind
required
version
immutable revision or digest
canonical source
local mount or address
authority role
resource inventory
compatibility standing
```

## Authority is separate from importance

A research corpus can be highly valuable while remaining non-normative.
A schema may be normative for serialization while irrelevant to project strategy.
A generated context corpus is operationally important but never source authority.

Do not collapse these distinctions.

## Pinning

Prefer immutable revisions or content digests. `latest` is not a pin.

If an immutable revision cannot be established, record the limitation instead of fabricating one.

## Consumption

Resources are consumed as pinned dependencies: a package or crate dependency, a schema-pack import, or a mechanical sync from the pinned revision. A synced copy is a cache of the pin, not a fork.

Local modification of consumed code or specifications is prohibited except under a recorded deviation (see the authority model).

## Upstream-first repair

When a capability is needed, broken, or missing in a resource, the change is made in the owning project under that project's own authority and process; the consuming project then re-pins the new revision.

A re-pin is a compatibility event: it carries a declared compatibility statement and may trigger re-qualification.

## Upstream debt

The debt record is memory and pressure, never permission.

Deploying a locally patched resource requires the deviation instrument **first** — owner-authorized, bounded, with the upstream fix landing as its reversal trigger. At deviation approval, the patch is captured as a diff against the owning project (a receipt, never a vendored fork) and a debt is registered (e.g. `records/upstream-debts.jsonl`, optional) **referencing the deviation**.

Registered debts age: a standing warning that escalates, so neither the deviation nor its debt sits open indefinitely. Closing the debt (upstream fix landed, re-pinned) discharges the deviation. A deployed local patch without a live deviation is a violation however faithfully its debt is recorded.

## Missing companions

Do not invent missing schemas, conformance fixtures, companion protocols, or research conclusions to make a resource look complete.

Missing remains explicit until supplied by the resource owner or project authority.
