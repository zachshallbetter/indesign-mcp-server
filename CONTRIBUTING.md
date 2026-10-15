# Contributing

Each package has its own guide for adding tools:

- [InDesign](packages/indesign/CONTRIBUTING.md)
- Illustrator: tools live in `packages/illustrator/src/tools/<area>.js`. Each
  tool has a definition, a handler, and the atlas feature ids it performs
  (`features`). A tool can declare its annotations with `hints`
  (`{ readOnly, destructive, idempotent, openWorld }`) and the arguments the
  static audit should call it with (`auditArgs`); new areas are registered in
  `src/server.js`. Tests for an area can go in their own `tests/<area>.test.js`,
  using `tests/helpers.js`. `npm test -w packages/illustrator` checks the
  definitions, the feature ids and every generated script.
- Premiere Pro: tools live in `packages/premiere/src/tools/<area>.js` with the
  same fields. Their scripts are UXP JavaScript (async, `ppro` and `transact`
  in scope), not ExtendScript; edits go through `transact` so they are built
  inside the project lock. A tool that needs a Premiere Pro newer than 25.6
  declares it (`since`), or checks for the member first and lists it in
  `guarded`; the audit enforces this against
  `tests/fixtures/premiere-uxp-api.json`.

## Adding an application

A new application gets its own package, `packages/<app>`, published as
`adobe-mcp-<app>` (for example `adobe-mcp-photoshop`), with the core as its only
runtime dependency. Premiere Pro is the exception: it also needs `ws`, because
its scripts reach Premiere Pro through a UXP plugin that connects to the server
over a WebSocket. The InDesign server was published as `indesign-mcp-server` up
to 2.3.0; that package is deprecated in favour of `adobe-mcp-indesign`.

## The suite

`packages/suite` loads application modules (`src/module.js` in each package) and
prefixes their tools. To add an application to it, register its loader in
`packages/suite/src/apps.js`. Cross-application tools live in
`packages/suite/src/cross/`: each declares the applications it `requires`, runs
its scripts through each application's `runStructured`, and is tested with both
applications stubbed.

## Before a pull request

- `npm run check && npm test` pass at the repository root. CI runs both.
- Say whether you ran the change against the real application, which one and
  which version. The static audits check scripts against the object model; they
  do not prove a tool works in the application.

## Releasing

Packages are released one at a time by tag. For a package:

1. Bump `version` in its `package.json`, and in its `server.json` (both the
   top-level `version` and `packages[0].version`) if it has one.
2. Update its changelog.
3. Commit, then tag and push:

   ```bash
   git tag -a adobe-mcp-illustrator@0.1.0 -m "adobe-mcp-illustrator 0.1.0"
   git push origin adobe-mcp-illustrator@0.1.0
   ```

The release workflow checks that the tag matches the package's versions, runs
every check and test, publishes the package to npm, and publishes its
`server.json` to the MCP Registry. Both use GitHub OIDC.

When a server needs a new `adobe-mcp-core`, release the core first, then the
server with its dependency updated.

To deprecate, delete or restore a server in the MCP Registry (for example after
a rename), run the Registry status workflow:

```bash
gh workflow run registry-status.yml -f server=io.github.zachshallbetter/<name> \
  -f status=deprecated -f message="Renamed to ..."
```
