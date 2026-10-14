# Optional UXP backend

Run InDesign scripts through a UXP plugin instead of AppleScript/COM.

## Quick start

1. Start the bridge. It ships in the npm package, so there is nothing to install:

```bash
npx -p indesign-mcp-server indesign-mcp-uxp-bridge
# from a clone: npm run uxp:bridge
```

Optional auth:

```bash
BRIDGE_TOKEN=secret npx -p indesign-mcp-server indesign-mcp-uxp-bridge
```

2. Get the plugin folder: `uxp/plugin` in a clone, or `node_modules/indesign-mcp-server/uxp/plugin` after `npm install indesign-mcp-server`.

3. Load the plugin in InDesign (UXP Developer Tool → add the plugin folder → load/watch). Open the Bridge panel so it connects to `ws://127.0.0.1:3001`.

4. Start the MCP server with the UXP backend by setting `INDESIGN_BACKEND` in your MCP client config (`"env": { "INDESIGN_BACKEND": "uxp" }`, or `"auto"` to prefer UXP whenever the plugin is connected). From a clone: `INDESIGN_BACKEND=uxp npm start`.

If `BRIDGE_TOKEN` is set on the bridge, set the same value for the MCP process.

## Ports

| Service | Default | Env override |
| --- | --- | --- |
| HTTP execute/status | `http://127.0.0.1:3000` | `UXP_BRIDGE_URL` |
| WebSocket (plugin) | `ws://127.0.0.1:3001` | set in bridge + plugin |

## Notes

- Handler scripts still target the InDesign DOM via `app`. Many ExtendScript-oriented handlers work; some ES3-only patterns or CEP-only APIs may need adjustment under UXP.
- Default backend remains `extendscript` (AppleScript/COM) when `INDESIGN_BACKEND` is unset.
