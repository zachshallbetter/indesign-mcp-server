# Releasing

The procedure is in the root [CONTRIBUTING.md](../CONTRIBUTING.md#releasing): bump
`version` in the package's `package.json` and `server.json` (both fields), update its
changelog and README tool count (and the root README's table), commit, then push an
**annotated** tag `<package>@<version>` (`git tag -a … -m …`; `tag.gpgsign` is on, so
lightweight tags fail). `release.yml` checks the versions, runs every test, publishes
to npm and publishes `server.json` to the MCP Registry, both through GitHub OIDC.

## What needs a person

- **The first npm publish of a package.** npm trusted publishing can only be set up
  for a package that exists, and publishing needs the owner's npm two-factor
  approval in a browser. Run it from a terminal (not from captured output), then set
  the trusted publisher on npmjs.com (repository `zachshallbetter/adobe-mcp`, workflow
  `release.yml`). After that, pushing the tag finishes the job: the workflow sees the
  version is already on npm, skips that step, and publishes to the MCP Registry.
- **Deprecations** on npm need the owner's browser approval too.
- Releases of packages with trusted publishing set need nobody: just the tag.

Trusted publishing is set for `adobe-mcp-core`, `adobe-mcp-indesign`,
`adobe-mcp-illustrator`, `adobe-mcp-suite`, `adobe-mcp-photoshop`,
`adobe-mcp-aftereffects` and `adobe-mcp-premiere`, all for `release.yml` in
`zachshallbetter/adobe-mcp`.

## Core versions

Every app package and the suite pin `adobe-mcp-core@0.2.0`. In the workspace, npm
links the local core because the pin matches its version. When an app needs a newer
core, release the core first, then move that app's pin.

## Order

A server that needs a newer core is released after the core. The suite pins exact
versions of every app, so it is released last, and only when every app it depends on
is on npm.

## Current release state (21 October 2026)

All five app packages, `adobe-mcp-core@0.2.0`, and `adobe-mcp-suite@0.2.1` are published
to npm. Suite `0.2.1` is also published to the MCP Registry and Homebrew. Its registry
description is within the limit. The Homebrew formula checksum is for the published npm
tarball. The MCPRush suite listing currently reports the two cross-app tools; its manual
tool-list editor has a 500-tool cap, below the suite's dynamic 1,200-tool inventory.

## Retries

A release job that fails on a transient error (for example
`TLOG_CREATE_ENTRY_ERROR` from the signing service) succeeds when re-run:
`gh run rerun <run id> --repo zachshallbetter/adobe-mcp --failed`.
