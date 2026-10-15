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

## Adding an application

A new application gets its own package, `packages/<app>`, published as
`adobe-mcp-<app>` (for example `adobe-mcp-photoshop`), with the core as its only
runtime dependency. The InDesign server was published as `indesign-mcp-server` up
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
