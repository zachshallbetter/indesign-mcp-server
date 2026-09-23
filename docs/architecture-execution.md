# Execution backends

This server can drive InDesign through **ExtendScript host automation** or an optional **UXP bridge**.

## Selection

| `INDESIGN_BACKEND` | Behavior |
| --- | --- |
| `extendscript` (default) | macOS AppleScript or Windows COM |
| `uxp` | HTTP bridge → UXP plugin inside InDesign |
| `auto` | Prefer UXP when the plugin is connected; otherwise ExtendScript |

Related env:

| Variable | Purpose |
| --- | --- |
| `UXP_BRIDGE_URL` | Bridge base URL (default `http://127.0.0.1:3000`) |
| `BRIDGE_TOKEN` | Optional Bearer token (must match bridge) |
| `UXP_HTTP_PORT` / `UXP_WS_PORT` | Bridge listen ports |

`indesign_status` reports `backend.configured`, `backend.resolved`, and `backend.uxpConnected`.

## ExtendScript (default)

| | |
| --- | --- |
| **Bridge** | macOS `osascript` / Windows COM `DoScript` |
| **Runtime** | ExtendScript |
| **Setup** | InDesign installed; no plugin |
| **Code** | `src/core/scriptExecutor.js` |

## UXP (optional)

| | |
| --- | --- |
| **Bridge** | `uxp/bridge/server.js` (HTTP `/execute`, `/status` + WebSocket) |
| **Plugin** | `uxp/plugin` loaded in InDesign via UXP Developer Tool |
| **Runtime** | Modern JS in the plugin sandbox (`app` + limited `require`) |

### Run UXP mode

```bash
npm install
npm run uxp:bridge
# Load uxp/plugin in InDesign, open Bridge panel
INDESIGN_BACKEND=uxp npm start
```

See `uxp/README.md`. Bridge/plugin adapted from [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server) (`uxp/NOTICE`).

## Compatibility notes

Handler scripts still use the InDesign DOM via `app`. Many work under both backends. UXP differences to watch:

- Collections often need `.item(n)` instead of bracket access
- Some paths/properties are async under UXP
- Prefer modern syntax when authoring UXP-only helpers

## Issue #1

UXP is a **first-class optional backend** in this repository, not only an external fork. The community UXP server remains a useful reference and alternative packaging.
