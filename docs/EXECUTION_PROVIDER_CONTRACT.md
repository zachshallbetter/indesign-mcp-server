# Execution Provider Contract

A provider is implementation infrastructure. It is not project authority.

## Required capabilities

A conformant provider can support:

```text
work graph read/write
claim/release
dependency state
isolated workspace
source/revision identity
bounded dispatch
cancellation
exact verification
evidence capture
protected-effect denial
live reconciliation
```

## Reference protection provider

`acp-gateway` is the reference provider for `protection`, `authorization` and `telemetry`. It supplies protected-effect denial, live verification of repository identity, work-graph read without local GitHub credentials, and containment/recovery state. Its binding is defined in `docs/ACP_INTEGRATION.md`; any replacement must preserve the decision vocabulary in `schemas/acp-decision.schema.json` or record a compatibility event.

## Official operational interfaces

Prefer the service owner's official CLI/API/connector when practical.

The project profile declares allowed interfaces and environments.

An official CLI is useful because it provides a stable, typed service boundary. It does not enlarge permission.

Before mutation the agent must identify:

```text
provider/account
project
environment
target resource
current state/revision
requested effect
authorized scope
rollback/recovery
```

## Credential posture

Prefer:

```text
short-lived
scope-bound
provider-mediated
not printed
not copied into project files
```

Agents do not create or widen credentials merely because a CLI supports it.

## Live state

Provider snapshots and local caches are hints.

Live provider state controls reconciliation.

## Failures

Classify provider failure once.

Do not continuously poll/retry quota, auth, billing, unavailable service or deterministic configuration failures.

A localized provider blocker should release only affected work. A provider failure that makes claims/state unsafe is a global stop.

## Replaceability

A provider may be replaced only if these survive:

```text
work-state meaning
authority
candidate identity
evidence lineage
context identity
recovery semantics
conformance checks
```
