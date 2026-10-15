# Adobe MCP Suite

One MCP server for Adobe InDesign, Illustrator, Photoshop, After Effects and
Premiere Pro together, with tools that work across them. Use it when you work in both applications; to drive only one,
install that application's server instead
([adobe-mcp-indesign](../indesign), [adobe-mcp-illustrator](../illustrator),
[adobe-mcp-photoshop](../photoshop), [adobe-mcp-aftereffects](../aftereffects),
[adobe-mcp-premiere](../premiere)).

Requires Node.js 18 or later, and InDesign, Illustrator, Photoshop and/or After
Effects 2023 or later, or Premiere Pro 25.6 or later with its plugin loaded (see
[adobe-mcp-premiere](../premiere)), on macOS or Windows.

## Install

Claude Code:

```bash
claude mcp add adobe -- npx -y adobe-mcp-suite
```

Any client that reads an `mcpServers` block:

```json
{
  "mcpServers": {
    "adobe": { "command": "npx", "args": ["-y", "adobe-mcp-suite"] }
  }
}
```

Load only some applications with `--apps` (or `ADOBE_MCP_APPS`):

```json
{ "command": "npx", "args": ["-y", "adobe-mcp-suite", "--apps", "illustrator"] }
```

## Tools

Every tool of each application is included, unchanged, with the application's
name in front: `indesign_create_text_frame`, `illustrator_create_rectangle`,
`indesign_export_pdf`. A tool that already names its application keeps it once:
`indesign_status`, `illustrator_execute_code`. Each application keeps its own
units and conventions (InDesign: millimetres from the page's top-left;
Illustrator: points from the artboard's top-left; Photoshop: pixels from the
document's top-left; After Effects: pixels from the composition's top-left and
seconds; Premiere Pro: seconds, with clips chosen by track and clip index), and
the server's instructions describe each. Premiere Pro's plugin port opens on
the first Premiere Pro call.

Tools across applications, offered when both are loaded:

| Tool | What it does |
|---|---|
| `place_illustrator_artwork_in_indesign` | Places an artboard of the active Illustrator document on an InDesign page, linked to the `.ai` file, so later edits in Illustrator reach the layout when the link is updated. Saves the Illustrator document first unless you say not to. |
| `copy_swatches_illustrator_to_indesign` | Copies colour swatches with their exact values: CMYK and RGB process colours, spot colours as spot inks, grays as CMYK black. Gradients and patterns are listed, not copied; InDesign's built-in swatches are never changed. |

## Configuration

Each application's variables apply as they do in its own server:
`INDESIGN_ALLOWED_DIRS`, `ILLUSTRATOR_ALLOWED_DIRS`, `INDESIGN_APP_NAME`,
`ILLUSTRATOR_APP_NAME`, `INDESIGN_SCRIPT_TIMEOUT_MS`,
`ILLUSTRATOR_SCRIPT_TIMEOUT_MS`, `INDESIGN_BACKEND` and the UXP bridge settings,
and Premiere Pro's `PREMIERE_WS_PORT`, `BRIDGE_TOKEN` and `PREMIERE_ALLOWED_DIRS`.
`ADOBE_MCP_APPS` chooses the applications.

## Development

```bash
npm test -w packages/suite
```

The tests check tool naming, that each application's argument aliases stay
with its own tools, that each application's `help` accepts the suite's names,
and that the cross-application tools generate valid scripts for both
applications' object models, with both applications stubbed. Nothing here has
been run against InDesign or Illustrator.

## Licence

MIT. See [LICENSE](LICENSE).
