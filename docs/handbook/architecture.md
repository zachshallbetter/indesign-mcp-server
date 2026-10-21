# Architecture

## Packages

| Package | npm | What it is |
|---|---|---|
| `packages/core` | `adobe-mcp-core` | Shared foundation: script-value escaping (`src/jsx.js`), path policy (`src/paths.js`), the executor that runs scripts through AppleScript or COM (`src/executor.js`), structured results and failure detection, argument aliases and warnings, annotations, and the MCP server shell. `src/testing/` holds the static audit used by the app packages' tests. |
| `packages/indesign` | `adobe-mcp-indesign` | InDesign. The oldest server: legacy handlers plus 28 module areas. Optional UXP backend under `uxp/`. |
| `packages/illustrator` | `adobe-mcp-illustrator` | Illustrator, module tools only. |
| `packages/photoshop` | `adobe-mcp-photoshop` | Photoshop, module tools; much of it through the Action Manager. |
| `packages/aftereffects` | `adobe-mcp-aftereffects` | After Effects, module tools. |
| `packages/premiere` | `adobe-mcp-premiere` | Premiere Pro, through a UXP plugin (no AppleScript or COM exists). |
| `packages/suite` | `adobe-mcp-suite` | MCP coordinator that connects to app servers and exposes only cross-application workflows. |

Every app package exports `src/module.js` with an `app` object describing its tool
inventory and safeguards. The coordinator starts selected standalone server
processes, connects over stdio MCP, and calls their public `execute_<app>_code` tools
for cross-app scripts. App tools and schemas are not copied into the coordinator.
Each app package depends on the core at run time; the coordinator also depends on the
MCP SDK client transport.

## How each server reaches its application

All but Premiere Pro send **ExtendScript** (ES3) and read a JSON result back.

| App | macOS | Windows |
|---|---|---|
| InDesign | AppleScript `do script` | COM `DoScript` (ProgIDs tried newest first) |
| Illustrator | AppleScript `do javascript` (Illustrator's `do script` plays an Action, not a script) | COM `DoJavaScriptFile` |
| Photoshop | AppleScript `do javascript` | COM `DoJavaScriptFile` |
| After Effects | AppleScript `DoScriptFile` | No COM: `AfterFX.exe -r <wrapper.jsx>` (located by `findAfterFx`, override `AFTEREFFECTS_EXE`); the wrapper writes the result to a file the server polls. This is the core executor's `winRun` hook. |
| Premiere Pro | A UXP plugin (`packages/premiere/uxp/plugin`) connects out to a WebSocket the MCP server listens on (`127.0.0.1:PREMIERE_WS_PORT`, default 3011, optional `BRIDGE_TOKEN`). Scripts are async UXP JavaScript with `ppro` in scope; edits go through `transact` (lockedAccess plus executeTransaction). A second MCP process finds the port taken and forwards over HTTP. |

InDesign also has an optional UXP backend (`INDESIGN_BACKEND=uxp|auto`, bridge in
`packages/indesign/uxp/bridge`), experimental.

## ArtCraft transparent adapter architecture

The servers support corresponding Storytold / ArtCraft desktop applications via loopback JSON-lines control channels:
- **PhotoCraft** for Photoshop (`127.0.0.1:7878`)
- **VectorCraft** for Illustrator (`127.0.0.1:7979`)
- **DesignCraft** for InDesign (`127.0.0.1:7979`)
- **EffectCraft** for After Effects (`127.0.0.1:9877`)
- **FilmCraft** for Premiere Pro (`127.0.0.1:9876`)

The shared foundation in `packages/core`:
- `ControlClient` (`src/control-client.js`): Loopback TCP client handling JSON-lines framing, request/reply correlation, timeouts, connection probing, and token authentication.
- `createCraftHarness` / `resolveExecutionRoute` (`src/craft-harness.js`): Standardizes execution routing between Adobe and ArtCraft, handler wrapping, and diagnostic status reporting.

Routing is controlled via:
1. `TARGET=craft` or `<APP>_TARGET=craft` (e.g. `PHOTOSHOP_TARGET=craft`, `DESIGNCRAFT_TARGET=craft`).
2. Automatic fallback: when the Adobe application is not running or reachable and the ArtCraft control port is responsive.

## The tool shape

Module tools (every app; InDesign's newer areas) are plain objects in
`src/tools/<area>.js`:

```js
{
  name: 'verb_noun',              // unique across the server and the suite
  description: 'User-facing, names the menu/panel/dialog in parentheses',
  inputSchema: { type: 'object', properties: { /* every property described */ }, required: [] },
  features: ['<app>.<domain>.<feature>'],   // atlas ids the tool performs
  hints: { readOnly, destructive, idempotent, openWorld },
  auditArgs: { /* arguments the static audit calls it with, when samples would be invalid */ },
  handler: (args) => run('Label', script(`...ES3 body assigning __result__...`, { undo: 'Label' })),
}
```

Areas are registered in `src/server.js` (`AREAS`), or for InDesign in
`src/tools/index.js` (`[id, tools, { name, description }]`, the last being its help
category; an id equal to a legacy help category merges into it).

### Script prelude

Each package's `src/script.js` wraps a body in a prelude that sets the application up
and restores it afterwards, and defines helpers:

- **InDesign** (`packages/indesign/src/tools/script.js`): `NEVER_INTERACT`,
  measurement unit millimetres; `__doc`, `__page`, `__pageOf`, `__toPage`,
  `__itemInfo`, `__item`, `__targets(doc, spec)` (ids, names or the selection),
  `__swatch(doc, spec)`.
- **Illustrator**: `userInteractionLevel = DONTDISPLAYALERTS`, document coordinates;
  `__doc`, `__sf` (large-canvas scale factor), `__artboard`, `__toDoc`, `__len`.
  Callers see points from an artboard's top-left, y down; the helpers convert to
  Illustrator's y-up document coordinates.
- **Photoshop**: `displayDialogs = DialogModes.NO`, ruler and type units pixels;
  `__doc`, `__px`, `__layerById`, `__targets`, `__color`, `__docInfo`. Action Manager
  helpers in `src/action-manager.js`, `src/actions.js`, `src/am.js`.
- **After Effects**: `beginSuppressDialogs`, and one undo group when given an `undo`
  label; `__comp`, `__layers` (1-based), `__prop(layer, path)`, `__itemInfo`.
- **Premiere Pro**: not ExtendScript; `src/script.js` builds async functions run by
  the plugin.

The body assigns `__result__`; the prelude serialises it (ES3 has no `JSON`).

### Arguments

`src/args.js` in each package holds the shared schemas and their conversions: targets
(InDesign items by id/name/selection; Photoshop layers by id/name/active; After
Effects compositions by id/name/active and layers 1-based), colours (`#RRGGBB`,
`rgb()`, plus CMYK/Lab/gray/HSB strings in Photoshop; 0–1 floats inside After Effects
scripts), and property paths (After Effects match names or shortcuts).

Units: InDesign millimetres from the page's top-left; Illustrator points from the
artboard's top-left; Photoshop
pixels from the document's top-left; After Effects pixels and seconds.

### Path policy

Every caller path goes through `createPathPolicy` (core): absolute, inside the
user's home folder or the package's `<APP>_ALLOWED_DIRS` (`INDESIGN_ALLOWED_DIRS`,
`ILLUSTRATOR_ALLOWED_DIRS`, `PHOTOSHOP_ALLOWED_DIRS`, `AFTEREFFECTS_ALLOWED_DIRS`,
`PREMIERE_ALLOWED_DIRS`), then into the script with `jsxPath()`.

## Static checks

`npm test` in a package runs:

- **Definition checks**: names, descriptions, every parameter described, hints valid,
  no duplicate names.
- **Feature checks**: every claimed id exists in `tests/fixtures/feature-ids.json`
  (regenerated from the atlas by `scripts/update-feature-ids.js` where present).
- **The script audit**: every tool runs against a stubbed executor with sample
  arguments (`auditArgs` overrides) and each generated script is parsed as ES3 and
  every global, property and method checked against the application's typings
  (types-for-adobe: InDesign 2023, Illustrator 2022, Photoshop 2015.5, After Effects
  26.0). Names a script defines itself go in the package audit's allowed list.
  Premiere Pro's audit checks member names against Adobe's UXP reference
  (`tests/fixtures/premiere-uxp-api.json`) and enforces `since`/`guarded` for
  members newer than 25.6.
- **Per-area tests** in `tests/<area>.test.js`, using `tests/helpers.js`
  (`scriptsFor(calls)` returns the generated scripts, already audited; `server()` for
  refusals).
- InDesign also checks that `docs/TOOLS.md` matches the definitions
  (`node scripts/generate-tool-reference.js`).

The suite's tests verify that app servers retain their own complete tool inventories,
the coordinator exposes only supported cross-app workflows, and workflow scripts
are delegated through the MCP client interface.
`npm test --workspaces` at the root runs everything; CI runs it on Ubuntu (Node 20,
22) and macOS (Node 22).
