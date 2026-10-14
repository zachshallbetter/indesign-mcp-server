# Optional UXP backend

Run InDesign scripts through a UXP plugin instead of AppleScript/COM. The tools generate the same ExtendScript either way; the plugin runs it with ExtendScript semantics, so a tool's result string should match what the AppleScript/COM path returns.

**Status: experimental, not yet tested against a real InDesign.** The plugin's evaluation, shims and DOM compatibility layer are tested only against a fake InDesign DOM (`npm run test:uxp`). Use the default `extendscript` backend for normal work until it has been run against InDesign. See [Known gaps](#known-gaps).

## Quick start

1. Start the bridge. It ships in the npm package, so there is nothing to install:

```bash
npx -p indesign-mcp-server indesign-mcp-uxp-bridge
# from a clone: npm run uxp:bridge
```

Optional auth (recommended):

```bash
BRIDGE_TOKEN="$(openssl rand -hex 32)" npx -p indesign-mcp-server indesign-mcp-uxp-bridge
```

2. Get the plugin folder: `uxp/plugin` in a clone, or `node_modules/indesign-mcp-server/uxp/plugin` after `npm install indesign-mcp-server`.

3. Load the plugin in InDesign (UXP Developer Tool → add the plugin folder → load/watch). Open the **Bridge Panel**. It connects to the bridge's WebSocket port, 3001 by default. If you started the bridge with another `UXP_WS_PORT`, type that port in the panel. If you set `BRIDGE_TOKEN`, type the token in the panel's token field. Click **Connect**; the panel remembers both.

4. Start the MCP server with the UXP backend by setting `INDESIGN_BACKEND` in your MCP client config (`"env": { "INDESIGN_BACKEND": "uxp" }`, or `"auto"` to prefer UXP whenever the plugin is connected). From a clone: `INDESIGN_BACKEND=uxp npm start`.

If `BRIDGE_TOKEN` is set on the bridge, set the same value for the MCP process and in the Bridge Panel. See [Authentication](#authentication).

## Authentication

With `BRIDGE_TOKEN` set on the bridge:

- `/execute` and `/status` require `Authorization: Bearer <token>`.
- A WebSocket connection becomes the plugin only after its first message is `{ "type": "auth", "token": "<token>" }` with the right token. The bridge answers `{ "type": "auth-ok" }`. A wrong token or any other first message closes the connection with code 4001; no message within 5 s (`UXP_AUTH_TIMEOUT_MS`) closes it with 4002. Until a connection authenticates, the bridge sends it no scripts.
- The panel stores the token in its `localStorage`, next to the port. After a 4001 or 4002 it stops retrying and asks for the token; enter it and click **Connect**.

Without `BRIDGE_TOKEN`, the first connection becomes the plugin and the panel's token is ignored.

In both cases a connected plugin is never replaced: while it is connected, any other connection is closed with code 4009, even with the right token. The panel retries every 3 s, so it takes over once the other connection goes away.

## Ports

| Service | Default | Override |
| --- | --- | --- |
| HTTP execute/status | `http://127.0.0.1:3000` | `UXP_HTTP_PORT` on the bridge, `UXP_BRIDGE_URL` on the MCP server |
| WebSocket (plugin) | `ws://127.0.0.1:3001` | `UXP_WS_PORT` on the bridge, the port field in the Bridge Panel |

## How scripts run in the plugin

`uxp/plugin/runtime.js` runs each script:

- **Completion value.** The script is evaluated with `eval`, so its result is the value of its last statement, as with `do script` / `DoScript`. Variables stay local to the call.
- **Globals.** Enums and classes the script names (`MeasurementUnits`, `ExportFormat`, `TextFrame`, ...) are taken from `require('indesign')`. `File` and `Folder` are shims with the members the handlers use (`fsName`, `fullName`, `name`, `path`, `parent`, `exists`, `create()`, `remove()`); `exists` and `create()` use UXP's `fs` module, which is why the manifest asks for `localFileSystem: fullAccess`. `$.writeln` logs to the plugin console.
- **DOM differences.** `app` is wrapped so that `collection[i]` falls back to `collection.item(i)` and `constructor.name` falls back to `constructorName` when the native value is missing; Adobe documents both as UXP differences. File shims are passed to DOM methods as path strings, and a `fullName` that comes back as a string is turned into a `File`.
- **UXP-style code.** Code that is not a valid classic script (a top-level `return` or `await`) runs as before: as the body of an async function, with only its `return` value coming back.

The MCP server trims a string result and turns other values into strings, as the AppleScript/COM paths do.

## Checking a real InDesign

Call `indesign_status` with `probe: true` while the UXP backend is active. Besides the usual version and document check, the response has `backend.uxpProbe`, a report from the plugin (`probe()` in `runtime.js`, plugin 1.2.0 or later):

| Field | What it checks |
| --- | --- |
| `pluginVersion`, `uxpVersion`, `inDesignVersion`, `domVersion` | Versions |
| `scriptEval` | A script's completion value comes back (`{ ok: true, value: 42 }`); if not, no tool works |
| `enums` | Type of `MeasurementUnits.POINTS`, whether `==` holds after setting and reading it back, and whether `.equals()` exists and works. The probe restores `app.scriptPreferences.measurementUnit` |
| `collections` | `app.swatches[0]` natively, `item(0)`, and `[0]` through the compat proxy |
| `classNames` | `constructor.name`, `constructorName`, the compat proxy's `constructor.name`, `instanceof Swatch` |
| `fileProperties` | What `app.filePath` returns (ExtendScript returns a `Folder`) |
| `fs` | Whether the `fs` module loads and whether `lstatSync` takes a plain path and/or a `file:` URL (tested on the plugin folder) |
| `asyncMethods` | Whether read-only methods (`count()`, `toSpecifier()`, `everyItem().getElements()`) return values or Promises |
| `problems` | Differences that will make tools misbehave, e.g. enum `==` failing (names the six affected tools) or Promise-returning methods |
| `handled` | Differences the runtime already covers, e.g. no native `[i]` |
| `notChecked` | What the probe cannot check without side effects: whether DOM methods accept a path string for a file. Run `export_pdf` to see |

The probe changes nothing in the document. If the plugin is older than 1.2.0, `uxpProbe.error` says to reload it.

## Known gaps

- **Untested against InDesign.** The fake DOM in the test has UXP's documented shape, but the real DOM may differ in ways it does not model. The probe above answers most of the questions below in one call.
- **Enum comparisons.** Adobe documents that `==` and `===` on DOM objects compare references and recommends `.equals()`. If enum values come back as objects, comparisons such as `link.status != LinkStatus.NORMAL` give the wrong answer. Handler scripts that compare enums: `detach_master_items`, `get_page_info`, `get_master_spread_info`, `list_master_spreads`, `list_object_styles`, `validate_document`.
- **File arguments.** The shims pass plain path strings to DOM methods such as `exportFile`, `place` and `app.open`. Whether every such method accepts a string in UXP has not been checked.
- **Async DOM methods.** If a DOM method returns a Promise under UXP, an ExtendScript-style script does not wait for it.
- **`fullName`.** The shim returns the plain path; ExtendScript returns a URI-style path (`~/Documents/...`). `fsName` is the same in both.
- **Timeouts.** 25 s in the plugin, 30 s in the bridge and 35 s in the server, against 120 s for AppleScript/COM.
- **No `BRIDGE_TOKEN`, no auth.** Without a token, any local process can send scripts to `/execute`, and can connect as the plugin when no plugin is connected (it then receives every script and returns its own results). Set `BRIDGE_TOKEN` on any machine other users or untrusted software can reach.
- **The token in the panel** is stored in plain text in the plugin's `localStorage`.

Default backend remains `extendscript` (AppleScript/COM) when `INDESIGN_BACKEND` is unset.
