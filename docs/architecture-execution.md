# Execution backends

Every tool call ends up as a script that runs inside InDesign. This page describes how a script gets there and how its result comes back. The code is in `src/core/scriptExecutor.js`.

## Request path

```text
MCP client --stdio--> InDesignMCPServer.handleToolCall(name, args)
                        |
                        v
                      Handler (src/handlers/*.js)
                        validates args, builds an ExtendScript string
                        |
                        v
                      ScriptExecutor.executeInDesignScript(script)
                        |
          +-------------+--------------------+
          |                                  |
   backend = extendscript               backend = uxp
          |                                  |
   macOS: osascript                     HTTP POST /execute
     "do script ... language javascript"     -> uxp/bridge/server.js
   Windows: PowerShell + COM                 -> WebSocket
     $app.DoScript(file, JavaScript)         -> uxp/plugin (inside InDesign)
          |                                  |
          +-------------+--------------------+
                        v
               result string -> formatResponse() -> { success, operation, result, timestamp }
```

The server returns the response object as JSON text. `isError` is `true` when `success` is `false`. A handler that throws, for example on an invalid argument or a rejected path, becomes `{ success: false, error }` with `isError: true`.

## Backend selection

`INDESIGN_BACKEND` selects the backend:

| Value | Behavior |
| --- | --- |
| `extendscript` (default, also used for any unknown value) | AppleScript on macOS, COM on Windows |
| `uxp` | Always uses the UXP bridge |
| `auto` | Calls `GET {UXP_BRIDGE_URL}/status` (1.5 s timeout). Uses UXP if `connected` is `true`, otherwise ExtendScript. |

With `extendscript` and `uxp` the choice is fixed for the process. With `auto` it is cached for 5 s (`ScriptExecutor.autoRecheckMs`) and then checked again, so starting or stopping the bridge or plugin takes effect without a restart. If a UXP call in `auto` mode fails because the bridge is unreachable or the plugin is not connected, which means the script never ran, that call goes through ExtendScript instead. Any other UXP error, including a timeout, is returned as is so a script is never run twice. `indesign_status` re-resolves the backend and reports `backend.configured`, `backend.resolved`, `backend.uxpBridgeUrl` and `backend.uxpConnected`.

## ExtendScript on macOS

1. `resolveAppName()` picks the AppleScript target. It tries these in order and caches the first match:
   1. `INDESIGN_APP_NAME`
   2. A running `Adobe InDesign*` process, found through System Events
   3. The newest `Adobe InDesign*.app` in `/Applications` or `~/Applications`
   4. `Adobe InDesign 2025`
2. The script is written to `os.tmpdir()` as `indesign_mcp_<timestamp>_<pid>.jsx`.
3. `osascript` runs:

   ```applescript
   tell application "<app name>"
     activate
     do script POSIX file "<temp file>" language javascript
   end tell
   ```

4. The value of the script's last expression comes back on stdout as a string.
5. The temp file is deleted. The `osascript` call has a 120 s timeout.

This path needs the macOS Automation permission for InDesign and System Events.

## ExtendScript on Windows

1. The script is written to the same kind of temp file.
2. PowerShell runs with `-NoProfile -NonInteractive -ExecutionPolicy Bypass`.
3. It creates the first COM object that works from `InDesign.Application.2026`, `.2025`, `.2024`, `.2023` and `InDesign.Application`.
4. It calls `DoScript(<file>, 1246973031)`. The second argument is `ScriptLanguage.JAVASCRIPT`.
5. PowerShell writes the return value to stdout. Errors go to stderr and come back as `COM execution failed: ...`.

The timeout is 120 s, and the temp file is deleted afterwards. `INDESIGN_APP_NAME` is not used on Windows.

## UXP bridge (optional)

| Part | Role |
| --- | --- |
| `uxp/bridge/server.js` (`indesign-mcp-uxp-bridge`) | Express on `127.0.0.1:${UXP_HTTP_PORT:-3000}` serves `GET /status` and `POST /execute`. A WebSocket server listens on `127.0.0.1:${UXP_WS_PORT:-3001}`. Executions run one at a time from a queue, with a 30 s limit each. When `BRIDGE_TOKEN` is set, `/execute` and `/status` require `Authorization: Bearer <token>`. |
| `uxp/plugin` | A UXP panel (manifest v5, InDesign 18.0+) that connects to `ws://127.0.0.1:<port>`; the port defaults to 3001 and is set in the panel. `runtime.js` runs each request with a 25 s limit, as described below. `require` is limited to `indesign` and `uxp`. |
| `ScriptExecutor.executeViaUXP` | Posts `{ code }` with the optional bearer token and a 35 s timeout. `executeUXPScript` turns the returned `result` into a string, trimming strings as the AppleScript/COM paths trim stdout. |

The bridge binds to loopback only. Without `BRIDGE_TOKEN`, any local process can send code to InDesign through it.

### How the plugin runs ExtendScript

The handler scripts are written for ExtendScript. They use `File`, `Folder`, global enums such as `MeasurementUnits.POINTS`, and a final bare expression as the result. The server sends them to the bridge unchanged, and `uxp/plugin/runtime.js` bridges the differences:

- It evaluates the script with direct `eval` inside a function, so the result is the script's completion value, as with `do script` and `DoScript`, and the script's variables do not outlive the call.
- It passes in, as local names, every capitalized identifier the script uses that `require('indesign')` provides (enums and classes), plus `File`, `Folder` and `$` shims. `File.exists` and `Folder.create()` use UXP's `fs` module; the manifest requests `localFileSystem: fullAccess` for it.
- It wraps `app` in a proxy: `collection[i]` falls back to `collection.item(i)`, `constructor.name` falls back to `constructorName` when the native name is empty, `fullName` strings come back as `File` shims, and shims and proxies are unwrapped (a `File` becomes its path string) before they reach a DOM method.
- Code that does not parse as a classic script (top-level `return` or `await`) runs as the body of an async function, as the plugin did before, and returns only what it `return`s.

`tests/unit/uxp.test.js` (`npm run test:uxp`, part of `npm test`) starts the real bridge, connects a fake plugin that loads `runtime.js` in a Node `vm`, and gives it a fake DOM shaped like UXP's: collections without `[i]`, an empty `constructor.name`, and no `File`/`Folder` globals. Every generated handler script (132) must return through `ScriptExecutor` exactly what the same script returns when evaluated ExtendScript-style against the same data, with no document open and with a one-page document. With no document open, 129 scripts reach the result InDesign would give (mostly `No document open`); `create_document`, `create_book` and `open_cloud_document` stop at methods the fake DOM does not have. With the document open, 16 scripts run to their normal output, including `list_page_items` and `export_pdf`; the rest stop at members the small fake DOM does not model. Where a script stops early, the error must still match between the two runs. The test also covers the token on `/status`, the `auto` re-check and fallback, and the shims.

This has not been run against a real InDesign. Known gaps:

- Adobe documents that `==` and `===` on DOM objects compare references. If enum values come back as objects, enum comparisons fail; six handler scripts compare enums (`detach_master_items`, `get_page_info`, `get_master_spread_info`, `list_master_spreads`, `list_object_styles`, `validate_document`).
- It has not been checked that every DOM method taking a file accepts a path string.
- DOM methods that return a Promise under UXP are not awaited.
- The shim's `File.fullName` is the plain path, not ExtendScript's URI-style path.
- The WebSocket port is not covered by `BRIDGE_TOKEN`: any local process can connect as the plugin.

Treat the UXP backend as experimental, and use `extendscript` for normal work until it has been tested against InDesign.

## Result handling

- Handler scripts report failures as strings such as `No document open`, `Error ...` or `Page index 3 out of range ...`. `looksLikeFailure()` in `src/utils/stringUtils.js` recognizes them, and they set `success: false`. The pattern list in that file is the contract: a failure message must start with one of its prefixes, or be a short single line containing one of its phrases.
- Errors from the transport, such as osascript or COM failures, timeouts and an unreachable bridge, are thrown as `Error executing tool: ...`.
- `executeInDesignScriptStructured()` wraps a script so it always returns `{"ok":...,"result"|"error":...}`. The unit tests cover it, but the current handlers do not use it.

## Temp files and cleanup

Temp scripts use the `indesign_mcp_` prefix in `os.tmpdir()`. Each call deletes its own file, and `ScriptExecutor.cleanupTempScripts()` removes any leftovers when the server starts.

## Credits

The UXP bridge and plugin are adapted from [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server). See `uxp/NOTICE`.
