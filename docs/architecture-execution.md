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

The resolved backend is cached for the life of the process. `indesign_status` re-resolves it and reports `backend.configured`, `backend.resolved`, `backend.uxpBridgeUrl` and `backend.uxpConnected`.

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
| `uxp/bridge/server.js` (`indesign-mcp-uxp-bridge`) | Express on `127.0.0.1:${UXP_HTTP_PORT:-3000}` serves `GET /status` and `POST /execute`. A WebSocket server listens on `127.0.0.1:${UXP_WS_PORT:-3001}`. Executions run one at a time from a queue, with a 30 s limit each. When `BRIDGE_TOKEN` is set, `/execute` requires `Authorization: Bearer <token>`. `/status` is always open. |
| `uxp/plugin` | A UXP panel (manifest v5, InDesign 18.0+) that connects to `ws://127.0.0.1:3001`. It runs each request as `new Function('app', 'require', 'return (async () => { <code> })()')` with a 25 s limit. `require` is limited to `indesign` and `uxp`. |
| `ScriptExecutor.executeViaUXP` | Posts `{ code }` with the optional bearer token and a 35 s timeout. The returned `result` is converted to a string. |

The bridge binds to loopback only. Without `BRIDGE_TOKEN`, any local process can send code to InDesign through it.

### Compatibility

The handler scripts are written for ExtendScript. They use `File`, `Folder`, global enums such as `MeasurementUnits.POINTS`, and a final bare expression as the result. In UXP, a script's result is only what it `return`s, and the ExtendScript file globals do not exist. Expect many tools to return empty or failed results under UXP until the handlers are adapted. Treat the UXP backend as experimental, and use `extendscript` for normal work.

## Result handling

- Handler scripts report failures as strings such as `No document open`, `Error ...` or `Page index 3 out of range ...`. `looksLikeFailure()` in `src/utils/stringUtils.js` recognizes them, and they set `success: false`. The pattern list in that file is the contract: a failure message must start with one of its prefixes, or be a short single line containing one of its phrases.
- Errors from the transport, such as osascript or COM failures, timeouts and an unreachable bridge, are thrown as `Error executing tool: ...`.
- `executeInDesignScriptStructured()` wraps a script so it always returns `{"ok":...,"result"|"error":...}`. The unit tests cover it, but the current handlers do not use it.

## Temp files and cleanup

Temp scripts use the `indesign_mcp_` prefix in `os.tmpdir()`. Each call deletes its own file, and `ScriptExecutor.cleanupTempScripts()` removes any leftovers when the server starts.

## Credits

The UXP bridge and plugin are adapted from [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server). See `uxp/NOTICE`.
