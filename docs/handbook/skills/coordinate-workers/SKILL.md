---
name: coordinate-workers
description: Use when two or more workers operate concurrently, exchange findings, hand off work, supersede approaches, or need shared namespace allocation.
---

# Coordinate Workers

## Requirements

Use when multiple workers share a project that defines workspace isolation, message format, and claim handoff. This repository's schema and procedures are examples; they are not included in this skill bundle.

1. Read the active project's coordination rules and use its declared worker, workspace, messaging, and claim interfaces.
2. Allocate disjoint workspaces and mutable scopes; reserve scarce identifiers using the project's allocation rules.
3. Send evidence-bearing messages in the project's declared format. This repository uses `AgentMessage`; see `schemas/agent-message.schema.json` and `docs/MULTI_AGENT_COORDINATION.md`. Share only task-relevant evidence and identifiers; exclude credentials, full prompts, and unrelated private data.
4. Revalidate work whose assumptions were invalidated by peer evidence.
5. Transfer or release claims explicitly through the project's work-graph provider when handing work off.
6. Preserve superseded or reverted work as evidence when it remains useful.
7. Serialize project-wide state transitions according to the project's coordination contract.
8. Never treat peer consensus as authority. If the project does not define a coordination or claim interface, report the gap before coordinating shared mutations.
