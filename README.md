# InDesign MCP Server

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
- **Layout** — master spreads, groups, page items, grids
- **Export** — PDF, images, package document
- **Books** — multi-document books, sync, repaginate, cross-references

### Platform

- **macOS** — AppleScript (`osascript`) bridge; InDesign version is auto-detected (or set via `INDESIGN_APP_NAME`)
- **Windows** — COM automation via PowerShell (`New-Object -ComObject`); tries current and recent InDesign ProgIDs
- **UXP (optional)** — `INDESIGN_BACKEND=uxp|auto` via local bridge + plugin under `uxp/`
- **Session manager** — tracks page dimensions and helps keep content on-page
- **Help tool** — discover tools and categories from the client
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

```bash
git clone https://github.com/zachshallbetter/indesign-mcp-server.git
cd indesign-mcp-server
npm install
npm start
```

### MCP client config

Add to your MCP config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js"]
    }
  }
}
```

Optional environment overrides:

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js"],
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

Replace the path with your local clone. Restart the client, open InDesign, then try: *Create an A4 doc and add a centered title.*

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
- Smart positioning when coordinates are omitted

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

### Export (`exportHandlers.js`)

- `export_pdf`, `export_images`, `package_document`

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

Existing handlers also use `escapeJsxString` from `stringUtils.js`. Prefer `jsxSafe` for new code.

## Real-world applications

- Automated report generation with consistent styles
- Brand asset and template systems
- Multi-page publications and books
- Design-system driven layout

## Testing

```bash
npm run check          # syntax check core modules
npm test               # unit tests (no InDesign required)
npm run test:integration   # full suite — requires InDesign running
npm run test:unified       # single-document unified runner
```

CI runs `check` + unit tests on every push/PR.

## Related projects

### Execution backends

| Backend | How to enable |
| --- | --- |
| ExtendScript / COM (default) | unset or `INDESIGN_BACKEND=extendscript` |
| UXP bridge + plugin | `INDESIGN_BACKEND=uxp` (or `auto`) + `npm run uxp:bridge` + load `uxp/plugin` |

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
