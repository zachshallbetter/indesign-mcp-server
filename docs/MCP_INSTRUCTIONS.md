# Setup and configuration

This page covers installing the InDesign MCP server, connecting it to an MCP client, configuring it, and fixing common problems. To learn how an agent should use the tools, see [LLM_PROMPT.md](./LLM_PROMPT.md). For the full tool list, see [TOOLS.md](./TOOLS.md).

## Prerequisites

- **Adobe InDesign** on macOS or Windows, installed on the same machine as the MCP client. InDesign does not have to be running: the first tool call starts it.
- **Node.js 18 or newer**, which provides `npx`.
- An MCP client that runs local stdio servers, such as Claude Desktop, Claude Code, Cursor or VS Code.

The npm package is `indesign-mcp-server` and the MCP Registry name is `io.github.zachshallbetter/indesign-mcp-server`. Clients start it with `npx -y indesign-mcp-server`, so you do not have to clone anything.

> **Before the first npm release** `npx` cannot find the package yet. Until then, clone the repository, run `npm install`, and point your client at `node /ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js`.

## Client configuration

### Claude Code

```bash
claude mcp add indesign -- npx -y indesign-mcp-server
```

With an environment variable:

```bash
claude mcp add indesign -e INDESIGN_ALLOWED_DIRS=/Volumes/Work -- npx -y indesign-mcp-server
```

### Claude Desktop

Edit `claude_desktop_config.json`, then restart Claude Desktop. The file is in one of these places:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "indesign": {
      "command": "npx",
      "args": ["-y", "indesign-mcp-server"]
    }
  }
}
```

### Cursor and other `mcpServers` clients

Cursor reads the same shape from `~/.cursor/mcp.json` for all projects, or from `.cursor/mcp.json` for one project. Most other clients, Windsurf and Warp among them, take the same `mcpServers` block. See [`examples/mcp-config.json`](../examples/mcp-config.json) for a version with environment variables.

### VS Code

VS Code reads `.vscode/mcp.json` (or the user-level MCP configuration). It uses a `servers` key:

```json
{
  "servers": {
    "indesign": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "indesign-mcp-server"]
    }
  }
}
```

### Running from a clone

For development, or to run unreleased code:

```bash
git clone https://github.com/zachshallbetter/indesign-mcp-server.git
cd indesign-mcp-server
npm install
```

Then point the client at the entry file: `"command": "node"`, `"args": ["/ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js"]`.

## Environment variables

Set these in the client's `env` block, or with `-e` for Claude Code.

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDESIGN_APP_NAME` | auto-detected | **macOS only.** The application name for AppleScript, such as `Adobe InDesign 2026`. Without it, the server uses the running InDesign process, then the newest `Adobe InDesign*.app` in `/Applications` or `~/Applications`, then `Adobe InDesign 2025`. Windows ignores it. |
| `INDESIGN_ALLOWED_DIRS` | none | More directories for file operations: open, save, place, export, data merge and books. Your home folder is always allowed. Separate entries with `:` on macOS and `;` on Windows. |
| `INDESIGN_BACKEND` | `extendscript` | `extendscript` uses AppleScript (macOS) or COM (Windows). `uxp` uses the UXP bridge. `auto` uses UXP if the bridge reports a connected plugin and ExtendScript otherwise. Any other value means `extendscript`. |
| `UXP_BRIDGE_URL` | `http://127.0.0.1:3000` | The UXP bridge's HTTP address. Only used with `uxp` or `auto`. |
| `BRIDGE_TOKEN` | none | A bearer token sent to the UXP bridge. Set the same value on the bridge process. |

The bridge process also reads `UXP_HTTP_PORT` (default 3000) and `UXP_WS_PORT` (default 3001). If you change `UXP_WS_PORT`, enter the same port in the plugin's Bridge Panel.

### File access rules

All file paths must be absolute. A path is accepted only if both of these hold:

1. It is inside your home folder or an `INDESIGN_ALLOWED_DIRS` entry.
2. It is not inside a system directory. These are always refused:
   - macOS: `/etc`, `/System`, `/usr`, `/bin`, `/sbin`, `/Library`
   - Windows: `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`

External volumes such as `/Volumes/...`, shared folders and `/tmp` need an `INDESIGN_ALLOWED_DIRS` entry.

## macOS: Automation permission

The server sends Apple events to InDesign and to System Events, which it uses to find the running InDesign process. The first time, macOS asks whether the client app may control them. The client app is whatever started the server: Claude, Terminal, iTerm, Cursor or Code.

Click **OK**. If you denied it earlier, open **System Settings > Privacy & Security > Automation**, find the client app, and turn on **Adobe InDesign** and **System Events**. Then restart the client.

Each call activates InDesign, so InDesign comes to the front while tools run.

## Windows notes

- The server drives InDesign through COM from PowerShell, with `-NoProfile -ExecutionPolicy Bypass`.
- It tries these ProgIDs in order:
  - `InDesign.Application.2026`, `.2025`, `.2024`, `.2023`
  - `InDesign.Application`, which is version-independent
- Scripts are written to `%TEMP%` as `indesign_mcp_*.jsx`. They are removed after each call and again when the server starts.
- In JSON, write paths with forward slashes (`C:/Users/me/Documents/file.indd`) or escaped backslashes (`C:\\Users\\me\\...`).
- Separate `INDESIGN_ALLOWED_DIRS` entries with `;`.
- If the client cannot start `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "indesign-mcp-server"]`.

## Optional UXP backend

The default backend runs ExtendScript and needs no plugin. The optional UXP backend sends scripts to a small local bridge instead. The bridge relays them to a UXP plugin running inside InDesign.

1. Start the bridge. It ships in the package:

   ```bash
   BRIDGE_TOKEN=change-me npx -p indesign-mcp-server indesign-mcp-uxp-bridge
   ```

2. Load `uxp/plugin` in InDesign with the UXP Developer Tool, then open its **Bridge Panel**.
3. Add `"INDESIGN_BACKEND": "uxp"` (or `"auto"`) and the same `"BRIDGE_TOKEN"` to the MCP server's `env`. See [`examples/mcp-config-uxp.json`](../examples/mcp-config-uxp.json).
4. Run `indesign_status`. `backend.resolved` should be `uxp` and `backend.uxpConnected` should be `true`.

The handler scripts are written for ExtendScript; the plugin runs them with ExtendScript semantics (completion value as the result, `File`/`Folder` shims, enums from `require('indesign')`). This is tested against a fake DOM only, not yet against InDesign, so treat the UXP backend as experimental. [architecture-execution.md](./architecture-execution.md) explains the differences, and [`uxp/README.md`](../uxp/README.md) has the bridge details.

## Verifying the setup

Ask the agent to call `indesign_status` with `probe: true`. A healthy result shows:

- `indesign.reachable: true`
- the InDesign version
- the number of open documents

Then try a prompt such as: *Create an A4 document and add a centered title.*

## Troubleshooting

**The tools do not appear in the client.**

- Check that `node --version` reports 18 or newer.
- GUI apps on macOS do not inherit your shell `PATH`. If Node comes from nvm, Volta or Homebrew, set `"command"` to the absolute path of `npx`, which `which npx` prints.
- Restart the client after you edit its config.

**InDesign not found.**

- On macOS, an error mentioning `Can't get application` or `Application isn't running` means the resolved app name is wrong.
- `indesign_status` shows `appName` and `appNameSource`.
- Set `INDESIGN_APP_NAME` to the exact app name without `.app`, for example `Adobe InDesign 2026`.
- On Windows, `Adobe InDesign not found. Check installation.` means no InDesign COM ProgID could be created. Repair the InDesign installation.

**Permission denied (macOS).** An error such as `Not authorized to send Apple events` (-1743) means Automation access was denied. See [macOS: Automation permission](#macos-automation-permission).

**`No document open`.** The tool needs an active document. Ask the agent to call `create_document` or `open_document`.

**Path rejected (`Access denied: '...' is outside the allowed directories`).**

- Use an absolute path inside your home folder.
- Or add the directory to `INDESIGN_ALLOWED_DIRS` and restart the client.
- Paths in system directories are always refused.

**Timeouts.**

- An ExtendScript call times out after 120 seconds, and the error mentions `ETIMEDOUT`.
- Under UXP, the plugin limit is 25 s, the bridge's 30 s and the server's 35 s.
- The usual cause is a modal dialog waiting in InDesign: missing fonts or links, import options, or the print dialog. Close it and retry.
- InDesign may still finish the operation after the server has given up, so check the document before you repeat a call.

**`UXP bridge not reachable`.**

- Start the bridge.
- Check that `UXP_BRIDGE_URL` matches its address.
- Check that the Bridge Panel is open in InDesign.
- An `Unauthorized: missing or invalid BRIDGE_TOKEN` error means `BRIDGE_TOKEN` differs between the bridge and the MCP server.
