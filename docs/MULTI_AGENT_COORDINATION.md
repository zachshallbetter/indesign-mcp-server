# Multi-Agent Coordination

## Principle

Multiple workers are concurrent partial observers of one project, not independent authorities.

Communication exists to exchange evidence and update planning assumptions.

## Isolation

Every mutation worker has:

```text
work item
claim
repository/artifact scope
isolated workspace
owned paths/namespaces
context digest
```

Disjoint ownership is the default.

Allocate scarce namespaces—migration numbers, gate IDs, ports, fixture keys, release names—before dispatch.

## Communication

Use `AgentMessage` for facts that may affect another worker.

Message impacts:

```text
informational
blocks
unblocks
supersedes
requests_handoff
requests_review
invalidates_assumption
```

Messages carry source/revision/context identity so stale observations are visible.

## Receiving a material message

If the message intersects a live assumption:

```text
pause at safe checkpoint
→ preserve current candidate
→ inspect evidence
→ re-read live state
→ re-evaluate approach
```

Possible disposition:

```text
continue
pause
handoff
supersede
revert
abandon
```

Reversion is not failure when a peer has established a better path.

## Handoff

A handoff names:

```text
from / to
work item
candidate/checkpoint
owned paths
what is complete
what remains
evidence
known risks
claim release/acquisition order
```

The receiving worker does not mutate until the old claim is released or the coordinator has transferred it.

## Shared-state writes

Coordinator or provider-native atomic mechanisms serialize:

```text
claims
status promotion
shared namespace allocation
canonical evidence replacement
project-wide decisions
```

Peers do not race to “help.”

## No authority by coalition

Two or twenty agents agreeing does not create:

```text
promotion authority
permission
ownership
contract authority
publication authority
deviation authority
```

## Contradiction

When peers disagree, preserve both claims and their evidence. Use existing precedence/evaluation. Do not erase disagreement through averaging or consensus prose.
