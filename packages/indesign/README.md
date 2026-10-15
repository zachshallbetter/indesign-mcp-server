# InDesign MCP Server

[![npm](https://img.shields.io/npm/v/adobe-mcp-indesign.svg)](https://www.npmjs.com/package/adobe-mcp-indesign)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/zachshallbetter/adobe-mcp)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue.svg)](https://modelcontextprotocol.io/)
[![GitHub stars](https://img.shields.io/github/stars/zachshallbetter/adobe-mcp?style=social)](https://github.com/zachshallbetter/adobe-mcp/stargazers)

**Turn Adobe InDesign into an AI design automation platform** — 135+ MCP tools for documents, layout, styles, images, books, and PDF export. Drive InDesign from Claude, Cursor, Warp, or any MCP client using natural language.

## Why this exists

Design ops still means repeating the same layout chores by hand. This server exposes InDesign as structured tools an agent can call: create pages, place assets, apply brand styles, export PDF — without leaving the chat.

## Perfect for

- Design teams automating layout tasks and brand consistency
- Content creators generating documents at scale
- AI assistants that need real InDesign control
- Developers building design automation workflows
- Publishers streamlining production

## Key features

### Core

- **Document management** — create, open, save, close, preferences, preflight, XML
- **Page management** — add, delete, duplicate, move, guides, navigation
- **Content** — text frames, tables, find/replace, shapes, images
- **Styles** — paragraph, character, object styles and color swatches
- **Layout** — spreads, master spreads, layers, groups, page items, guides and grids
- **Export** — PDF, JPEG/PNG images, EPUB (reflowable or fixed layout), package for print
- **Books** — multi-document books, sync, repaginate, cross-references

### Platform

- **macOS** — AppleScript (`osascript`) bridge; InDesign version is auto-detected (or set via `INDESIGN_APP_NAME`)
- **Windows** — COM automation via PowerShell (`New-Object -ComObject`); tries current and recent InDesign ProgIDs
- **UXP (optional)** — `INDESIGN_BACKEND=uxp|auto` via local bridge + plugin under `uxp/`
- **Session manager** — tracks page dimensions and fills in positions and sizes you leave out
- **Help tool** — parameters for every tool and category, generated from the same definitions as `tools/list`
- **Safe JSX helpers** — `src/utils/jsxSafe.js` for validated string/number/path interpolation into ExtendScript

## Quick start

### Prerequisites

- Adobe InDesign (2023 or later recommended)
- Node.js 18+
- **macOS** or **Windows**

#### macOS

Uses AppleScript. Grant Automation permissions for your terminal/Node if prompted (System Settings → Privacy & Security → Automation).

InDesign version is resolved in order:

1. `INDESIGN_APP_NAME` environment variable (e.g. `Adobe InDesign 2026`)
2. A running InDesign process
3. Newest `Adobe InDesign *.app` under `/Applications` or `~/Applications`
4. Fallback: `Adobe InDesign 2025`

#### Windows

Uses COM automation through PowerShell. No extra install steps. InDesign should be installed; the server will attach to a running instance or launch via COM.

### Installation

Nothing to clone. MCP clients start the server with `npx`, which downloads it from [npm](https://www.npmjs.com/package/adobe-mcp-indesign) on first run. It is listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.zachshallbetter/adobe-mcp-indesign`.

Claude Code:

```bash
claude mcp add indesign -- npx -y adobe-mcp-indesign
```

### MCP client config

Any other client (Claude Desktop `claude_desktop_config.json`, Cursor, Warp, …):

```json
{
  "mcpServers": {
    "indesign": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-indesign"]
    }
  }
}
```

Optional environment overrides:

```json
{
  "mcpServers": {
    "indesign": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-indesign"],
      "env": {
        "INDESIGN_APP_NAME": "Adobe InDesign 2026",
        "INDESIGN_ALLOWED_DIRS": "/Users/you/Projects:/Users/you/Documents"
      }
    }
  }
}
```

- `INDESIGN_APP_NAME` — macOS only; force a specific app name for AppleScript
- `INDESIGN_ALLOWED_DIRS` — extra directories allowed for file operations (delimiter is `:` on macOS, `;` on Windows)

Restart the client, open InDesign, then try: *Create an A4 doc and add a centered title.*

To run from a clone instead (for development), use `"command": "node"` with `"args": ["/ABSOLUTE/PATH/TO/adobe-mcp-indesign/src/index.js"]` after `npm install`.

### Help system

```javascript
await tools.call("help");
await tools.call("help", { tool: "create_document" });
await tools.call("help", { category: "text" });
await tools.call("help", { format: "detailed" });
await tools.call("help", { format: "examples" });
```

### Example calls

```javascript
await callTool('create_document', {
  width: 210,
  height: 297,
  pages: 1
});

await callTool('create_text_frame', {
  content: 'Hello, InDesign!',
  fontSize: 14
});

await callTool('create_paragraph_style', {
  name: 'Heading',
  fontSize: 24,
  alignment: 'CENTER_ALIGN'
});
```

## Tools

137 tools in seven areas. The full reference, with every parameter, is [docs/TOOLS.md](docs/TOOLS.md) (generated from the same definitions the server advertises).

| Area | Tools | Examples |
| --- | --- | --- |
| Documents & books | 46 | `create_document`, `open_document`, `save_document`, `preflight_document`, `data_merge`, `validate_document`, `create_book`, `export_book` |
| Pages & spreads | 30 | `add_page`, `resize_page`, `create_page_guides`, `place_file_on_page`, `list_spreads`, `duplicate_spread` |
| Text & tables | 5 | `create_text_frame`, `edit_text_frame`, `create_table`, `populate_table`, `find_replace_text` |
| Graphics & images | 8 | `place_image`, `create_rectangle`, `create_polygon`, `create_object_style` |
| Styles & colors | 8 | `create_paragraph_style`, `create_character_style`, `create_color_swatch`, `apply_color` |
| Layout, masters & layers | 30 | `move_page_item`, `create_group`, `create_master_spread`, `detach_master_items`, `create_layer` |
| Export & utilities | 10 | `export_pdf`, `export_images`, `export_epub`, `package_document`, `indesign_status`, `execute_indesign_code` |

## For AI agents

- **Instructions at connect.** The server sends usage instructions in its `initialize` response (units, indexes, colors, fonts, paths, errors), which MCP clients pass to the model.
- **Annotations on every tool.** `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` let clients ask before destructive calls such as `delete_page`, `cleanup_document` or `close_document` (which discards unsaved changes).
- **Real errors.** A failed call returns `isError: true` with a message such as "No document open" or "Error: color swatch 'Brand' not found".
- **Self-describing.** `help({ tool })` returns any tool's parameters; `help({ category })` lists tools by area.
- **Conventions.** Millimeters from the target page's top-left corner, 0-based indexes, swatch names or `"#RRGGBB"`, fonts as `"Family\tStyle"`. See [docs/LLM_PROMPT.md](docs/LLM_PROMPT.md) for workflows.

## Session management

The server tracks page dimensions and active document metadata so tools can place content with sensible defaults when coordinates are omitted.

```javascript
await callTool('get_session_info', {});
await callTool('clear_session', {});

await callTool('create_text_frame', {
  content: 'Auto-positioned text',
  fontSize: 12
});
```

## Architecture

```text
src/
├── core/
│   ├── InDesignMCPServer.js    # MCP server
│   ├── scriptExecutor.js       # macOS AppleScript + Windows COM
│   └── sessionManager.js       # Session state
├── handlers/                   # Tools by domain
│   ├── documentHandlers.js
│   ├── pageHandlers.js
│   ├── textHandlers.js
│   ├── styleHandlers.js
│   ├── graphicsHandlers.js
│   ├── bookHandlers.js
│   ├── pageItemHandlers.js
│   ├── groupHandlers.js
│   ├── masterSpreadHandlers.js
│   ├── spreadHandlers.js
│   ├── layerHandlers.js
│   ├── exportHandlers.js
│   ├── utilityHandlers.js
│   ├── helpHandlers.js
│   └── index.js
├── types/                      # Tool definitions
├── utils/
│   ├── stringUtils.js          # Response helpers, escapeJsxString
│   └── jsxSafe.js              # Validated ExtendScript literals / paths
└── index.js
```

### Script execution

| Platform | Mechanism | Notes |
| --- | --- | --- |
| macOS | `osascript` → `do script` | App name auto-detected; temp `.jsx` in OS temp dir |
| Windows | PowerShell COM `DoScript` | ProgIDs tried newest-first; temp `.jsx` in OS temp dir |

### ExtendScript safety

Tool arguments that flow into JSX should go through `src/utils/jsxSafe.js`:

- `str()`, `num()`, `bool()`, `index()`, `enumOf()`, `measure()`, `json()`, `numList()`
- `validateFilePath()` / `jsxPath()` for filesystem paths (`INDESIGN_ALLOWED_DIRS`)

Every handler uses these helpers; raw argument strings never reach a script.

### Errors

Scripts report failures as text ("No document open", "Error …", "… not found"). The server recognizes these (`looksLikeFailure` in `src/utils/stringUtils.js`) and returns them with `success: false` and MCP `isError: true`, so clients can tell a failed call from a successful one.

## Real-world applications

- Automated report generation with consistent styles
- Brand asset and template systems
- Multi-page publications and books
- Design-system driven layout

## Testing

```bash
npm run check          # syntax check core modules
npm test               # everything below that needs no InDesign
npm run test:audit     # script audit only; pass a regex to audit some tools
npm run test:integration   # full suite — requires InDesign running
npm run test:unified       # single-document unified runner
```

`npm test` covers:

- **Tool definitions:** every tool has a description, title, annotations and a typed, described parameter list
- **Path confinement:** every file or folder parameter rejects paths outside your home folder and `INDESIGN_ALLOWED_DIRS`
- **MCP protocol:** the server starts over stdio, sends instructions, lists all tools and answers `help` for each
- **Error detection:** failure messages become `isError` results
- **Tool reference:** `docs/TOOLS.md` matches the definitions
- **Script audit:** see below

The script audit (`tests/audit/scripts.audit.js`) calls every tool with arguments built from its schema, captures the ExtendScript it would send, and fails if any advertised tool is not dispatched, if a script is not valid ES5 (ExtendScript has no `let`, arrow functions or `JSON`), or if a script uses a property, method, enum or global that does not exist in the InDesign 2023 scripting DOM ([types-for-adobe](https://www.npmjs.com/package/types-for-adobe)).

CI runs `check` and `npm test` on every push and pull request. The audit checks scripts against Adobe's published DOM; it does not run them, so the integration suite against a live InDesign remains the final check.

## Related projects

### Execution backends

| Backend | How to enable |
| --- | --- |
| ExtendScript / COM (default) | unset or `INDESIGN_BACKEND=extendscript` |
| UXP bridge + plugin | `INDESIGN_BACKEND=uxp` (or `auto`) + `npx -p adobe-mcp-indesign adobe-mcp-indesign-uxp-bridge` + load `uxp/plugin` |

Details: [`docs/architecture-execution.md`](./docs/architecture-execution.md) and [`uxp/README.md`](./uxp/README.md).

Optional packaging reference: [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server) (bridge/plugin adapted into `uxp/` with attribution).

## Examples

See `examples/basic-flyer.md` and `examples/mcp-config.json` for a first-run workflow and client config.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Credits

This server began as [lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server) by Lukas Drechsel-Burkhard, released under the MIT License. This project builds on that work; the original copyright notice is kept in [LICENSE](./LICENSE).

## License

MIT. See [LICENSE](./LICENSE).

## Documentation

- [docs/MCP_INSTRUCTIONS.md](docs/MCP_INSTRUCTIONS.md): setup for each client, environment variables, troubleshooting
- [docs/TOOLS.md](docs/TOOLS.md): every tool and parameter
- [docs/LLM_PROMPT.md](docs/LLM_PROMPT.md): conventions and workflows for agents
- [docs/architecture-execution.md](docs/architecture-execution.md): how scripts reach InDesign
- [docs/CHANGELOG.md](docs/CHANGELOG.md)

Issues: https://github.com/zachshallbetter/adobe-mcp/issues
