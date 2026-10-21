# Project Intent

**Project ID:** `adobe-mcp`
**Project Name:** `Adobe MCP`
**Status:** Active

## Originating intent

Adobe MCP provides local MCP servers that let creative professionals and AI
clients control Adobe desktop applications through the applications' supported
automation interfaces. Each app server owns its direct-control tools; the Adobe
MCP Suite coordinates workflows that span apps by delegating to those standalone
servers. The project exists to make creative automation practical to install,
understand, and use while keeping application control on the user's machine. It
succeeds when each published app server exposes its documented capabilities and
the Suite reliably completes supported cross-app workflows. It does not succeed
by copying every app tool into the Suite or by describing unimplemented or
unverified capabilities as available.

## Desired state

```text
Separate local app servers provide direct application tools; the Suite delegates
cross-app workflows to those servers and exposes only the workflows it implements.
```

## Constraints

- App-specific tools remain in the corresponding standalone server; coordinator
  tools belong in the Suite only when they coordinate multiple apps.
- MCP servers run locally over stdio. Application calls execute on the user's
  machine; Premiere Pro uses its local UXP bridge.
- Claim only capabilities supported by the package and its evidence. Static
  checks do not count as validation against a running Adobe application.
- Releases follow the repository's documented npm, MCP Registry, and Homebrew
  workflow, with versions and tool inventories kept aligned.
- Preserve the repository's existing license, privacy, security, and human
  authorization boundaries.

## Non-goals

- The Suite is not a second copy of all standalone app tools.
- The Suite does not host Adobe application control remotely.
- A static test result is not a claim of validation against a running desktop app.

## Success questions

The maintained project state answers:

```text
What is true?
What is authoritative?
What is unresolved?
What is Ready?
What is blocked and why?
What evidence supports current claims?
What effects are currently allowed?
What requires a human decision?
```

## Termination / dormancy

Retire or supersede a package when its supported application route is no longer
maintainable or when a successor preserves the documented user capabilities and
release obligations. Keep the remaining app servers usable independently of the
Suite.
