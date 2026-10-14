# InDesign MCP Server

[![npm](https://img.shields.io/npm/v/indesign-mcp-server.svg)](https://www.npmjs.com/package/indesign-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/zachshallbetter/indesign-mcp-server)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue.svg)](https://modelcontextprotocol.io/)
[![GitHub stars](https://img.shields.io/github/stars/zachshallbetter/indesign-mcp-server?style=social)](https://github.com/zachshallbetter/indesign-mcp-server/stargazers)

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

Nothing to clone. MCP clients start the server with `npx`, which downloads it from npm on first run. It is also listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.zachshallbetter/indesign-mcp-server`.

Claude Code:

```bash
claude mcp add indesign -- npx -y indesign-mcp-server
```

### MCP client config

Any other client (Claude Desktop `claude_desktop_config.json`, Cursor, Warp, …):

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

Optional environment overrides:

```json
{
  "mcpServers": {
    "indesign": {
      "command": "npx",
      "args": ["-y", "indesign-mcp-server"],
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

To run from a clone instead (for development), use `"command": "node"` with `"args": ["/ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js"]` after `npm install`.

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

## Handler categories

### Document (`documentHandlers.js`)

- Basic: `create_document`, `open_document`, `save_document`, `close_document`
- Info: `get_document_info`, `get_document_preferences`, `set_document_preferences`
- Advanced: `preflight_document`, `data_merge`, `validate_document`
- Grid: `get_document_grid_settings`, `set_document_grid_settings`
- XML: `get_document_xml_structure`, `export_document_xml`
- Cloud: `save_document_to_cloud`, `open_cloud_document`

### Page (`pageHandlers.js`)

- Operations: `add_page`, `delete_page`, `duplicate_page`, `move_page`
- Properties: `get_page_info`, `set_page_properties`, `adjust_page_layout`
- Content: `place_file_on_page`, `place_xml_on_page`, `get_page_content_summary`
- Layout: `create_page_guides`, `snapshot_page_layout`, `reframe_page`
- Navigation: `navigate_to_page`, `select_page`

### Text (`textHandlers.js`)

- Frames: `create_text_frame`, `edit_text_frame`
- Tables: `create_table`, `populate_table`
- Other: `find_replace_text`
- Text frames, shapes and images are placed automatically when you omit their position or size

### Style (`styleHandlers.js`)

- Create: `create_paragraph_style`, `create_character_style`
- Apply: `apply_paragraph_style`, `apply_character_style`
- Color: `create_color_swatch`, `list_color_swatches`, `apply_color`
- List: `list_styles`

### Graphics (`graphicsHandlers.js`)

- Shapes: `create_rectangle`, `create_ellipse`, `create_polygon`
- Images: `place_image`, `get_image_info` (scale 1–1000%, fit modes)
- Object styles: `create_object_style`, `list_object_styles`, `apply_object_style`

### Book (`bookHandlers.js`)

- `create_book`, `open_book`, `list_books`
- `add_document_to_book`, `synchronize_book`
- `repaginate_book`, `update_all_cross_references`
- `export_book`, `package_book`, `print_book`
- `update_all_numbers`, `update_chapter_and_paragraph_numbers`

### Page items (`pageItemHandlers.js`)

- `get_page_item_info`, `select_page_item`, `move_page_item`
- `resize_page_item`, `set_page_item_properties`
- `duplicate_page_item`, `delete_page_item`, `list_page_items`

### Groups (`groupHandlers.js`)

- `create_group`, `create_group_from_items`, `ungroup`
- `get_group_info`, `add_item_to_group`, `remove_item_from_group`
- `list_groups`, `set_group_properties`

### Master spreads (`masterSpreadHandlers.js`)

- `create_master_spread`, `list_master_spreads`, `delete_master_spread`
- `create_master_text_frame`, `create_master_rectangle`, `create_master_guides`
- `apply_master_spread`, `duplicate_master_spread`, `get_master_spread_info`
- `detach_master_items`, `remove_master_override`

### Spreads (`spreadHandlers.js`)

- `list_spreads`, `get_spread_info`, `get_spread_content_summary`
- `duplicate_spread`, `move_spread`, `delete_spread`, `set_spread_properties`
- `create_spread_guides`, `place_file_on_spread`, `place_xml_on_spread`, `select_spread`

### Layers (`layerHandlers.js`)

- `create_layer`, `set_active_layer`, `list_layers`

### Export (`exportHandlers.js`)

- `export_pdf`, `export_images`, `export_epub`, `package_document`

### Utility (`utilityHandlers.js`)

- `indesign_status` — host/app health (`probe: true` for live round-trip)
- `execute_indesign_code` — custom ExtendScript
- `view_document`, `get_session_info`, `clear_session`

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
npm test               # unit, MCP protocol and script audit (no InDesign required)
npm run test:audit     # script audit only; pass a regex to audit some tools
npm run test:integration   # full suite — requires InDesign running
npm run test:unified       # single-document unified runner
```

The script audit (`tests/audit/scripts.audit.js`) calls every tool with arguments built from its schema, captures the ExtendScript it would send, and fails if any advertised tool is not dispatched, if a script is not valid ES5 (ExtendScript has no `let`, arrow functions or `JSON`), or if a script uses a property, method, enum or global that does not exist in the InDesign 2023 scripting DOM ([types-for-adobe](https://www.npmjs.com/package/types-for-adobe)).

CI runs `check` and `npm test` on every push and pull request. The audit checks scripts against Adobe's published DOM; it does not run them, so the integration suite against a live InDesign remains the final check.

## Related projects

### Execution backends

| Backend | How to enable |
| --- | --- |
| ExtendScript / COM (default) | unset or `INDESIGN_BACKEND=extendscript` |
| UXP bridge + plugin | `INDESIGN_BACKEND=uxp` (or `auto`) + `npx -p indesign-mcp-server indesign-mcp-uxp-bridge` + load `uxp/plugin` |

Details: [`docs/architecture-execution.md`](./docs/architecture-execution.md) and [`uxp/README.md`](./uxp/README.md).

Optional packaging reference: [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server) (bridge/plugin adapted into `uxp/` with attribution).

## Examples

See `examples/basic-flyer.md` and `examples/mcp-config.json` for a first-run workflow and client config.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commits
4. Add or update tests where practical
5. Open a pull request

Bug reports and feature requests are welcome via GitHub Issues.

## License

MIT — see [LICENSE](./LICENSE).

## Support

- Issues: https://github.com/zachshallbetter/indesign-mcp-server/issues
- Discussions / PRs welcome
- Docs: `docs/MCP_INSTRUCTIONS.md`, `docs/LLM_PROMPT.md`, `docs/CHANGELOG.md`
