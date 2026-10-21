---
name: compile-context
description: Use after canonical source changes or before consequential execution when generated context may be stale. Rebuilds and verifies deterministic project context.
---

# Compile Context

## Requirements

Use in a project that documents a canonical-source policy and context compiler. This skill does not include or replace the target project's compiler.

1. Read the active project's context policy and source selection; correct canonical sources first.
2. Run the compiler documented by the project. In this repository, use `python3 scripts/gen-context.py`.
3. Run the compiler's read-only verification. In this repository, use `python3 scripts/gen-context.py --check`.
4. Verify the generated lock records the current selected-source digest and repository provenance.
5. Use the project's context index to locate relevant material; in this repository, that is `.agents/llms.txt`.
6. Load only bounded excerpts needed for the current work item.
7. Never patch generated context manually. If a project has no documented compiler or source policy, stop and report the missing operating contract rather than inventing one.
