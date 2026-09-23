# Optional UXP backend

Run InDesign scripts through a UXP plugin instead of AppleScript/COM.

## Quick start

1. Install bridge deps (from repo root or this folder):

```bash
npm install
# express and ws are dependencies of the main package
```

2. Start the bridge:

```bash
npm run uxp:bridge
# or: node uxp/bridge/server.js
```

Optional auth:

```bash
BRIDGE_TOKEN=secret npm run uxp:bridge
```

3. Load the plugin in InDesign (UXP Developer Tool → add `uxp/plugin` → load/watch). Open the Bridge panel so it connects to `ws://127.0.0.1:3001`.

4. Start the MCP server with UXP backend:

```bash
INDESIGN_BACKEND=uxp npm start
# or auto-prefer UXP when the plugin is connected:
INDESIGN_BACKEND=auto npm start
```

If `BRIDGE_TOKEN` is set on the bridge, set the same value for the MCP process.

## Ports

| Service | Default | Env override |
| --- | --- | --- |
| HTTP execute/status | `http://127.0.0.1:3000` | `UXP_BRIDGE_URL` |
| WebSocket (plugin) | `ws://127.0.0.1:3001` | set in bridge + plugin |

## Notes

- Handler scripts still target the InDesign DOM via `app`. Many ExtendScript-oriented handlers work; some ES3-only patterns or CEP-only APIs may need adjustment under UXP.
- Default backend remains `extendscript` (AppleScript/COM) when `INDESIGN_BACKEND` is unset.
