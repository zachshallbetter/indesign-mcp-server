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
`adobe-mcp-illustrator` and `adobe-mcp-suite`.

## Core versions

Each app pins an exact `adobe-mcp-core` version: InDesign, Illustrator, Photoshop and
the suite pin `0.1.0`; After Effects and Premiere Pro pin `0.2.0` (they need its
`winRun` hook and the audit's mixed-case enum support). In the workspace, npm links
the local core only where the pin matches its version; the others install the
published version they pin, so their tests run against that. When an app needs
something newer, release the core first, then move that app's pin.

## Order

A server that needs a newer core is released after the core. The suite pins exact
versions of every app, so it is released last, and only when every app it depends on
is on npm.

## Not yet published (October 2026)

`adobe-mcp-photoshop`, `adobe-mcp-aftereffects` and `adobe-mcp-premiere` are merged
at 0.1.0 but have never been published, so the suite (which depends on them) can't be
released either. `adobe-mcp-core` has an unreleased change to its test audit since
0.2.0 (it accepts mixed-case enum members); it doesn't affect the published servers.

To publish them, the owner runs, from the repository root on an up-to-date `main`:

```bash
npm publish -w packages/photoshop --access public
```

```bash
npm publish -w packages/aftereffects --access public
```

```bash
npm publish -w packages/premiere --access public
```

then sets the trusted publisher for each on npmjs.com, and pushes the tags so the
MCP Registry gets them:

```bash
git tag -a adobe-mcp-photoshop@0.1.0 -m "adobe-mcp-photoshop 0.1.0" && git push origin adobe-mcp-photoshop@0.1.0
```

(and the same for `adobe-mcp-aftereffects@0.1.0` and `adobe-mcp-premiere@0.1.0`).
Bump the versions first if the packages should go out at a higher number given how
much they've grown since 0.1.0. Then release the core and the suite by tag as usual.

## Retries

A release job that fails on a transient error (for example
`TLOG_CREATE_ENTRY_ERROR` from the signing service) succeeds when re-run:
`gh run rerun <run id> --repo zachshallbetter/adobe-mcp --failed`.
