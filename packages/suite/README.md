# Adobe MCP Suite

An MCP coordinator for workflows that span Adobe InDesign and Illustrator. It
starts those applications' standalone MCP servers and exposes two coordinated workflows.
For direct application tools, install the matching standalone server:
([adobe-mcp-indesign](../indesign), [adobe-mcp-illustrator](../illustrator),
[adobe-mcp-photoshop](../photoshop), [adobe-mcp-aftereffects](../aftereffects),
[adobe-mcp-premiere](../premiere)).

Requires Node.js 18 or later and InDesign and Illustrator on this computer.
Install the other app servers separately for direct access.

## Install

Install the published suite with npm:

```bash
npm install --global adobe-mcp-suite
```

Or use the pinned Homebrew formula (macOS and Linux):

```bash
brew install --formula https://raw.githubusercontent.com/zachshallbetter/adobe-mcp/main/Formula/adobe-mcp-suite.rb
```

The curl installer installs the current npm release globally:

```bash
curl -fsSL https://raw.githubusercontent.com/zachshallbetter/adobe-mcp/main/scripts/install.sh | sh
```

All three methods install the same suite package. It runs locally and still
requires Node.js 18 or later and the Adobe apps you plan to use.

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

By default the coordinator starts the InDesign and Illustrator MCP servers. Select
different servers with `--apps` (or `ADOBE_MCP_APPS`); its current workflows require
both InDesign and Illustrator:

```json
{ "command": "npx", "args": ["-y", "adobe-mcp-suite", "--apps", "illustrator"] }
```

## Tools

The coordinator exposes only cross-application workflows. It calls the standalone
InDesign and Illustrator servers as local stdio MCP processes, so their tools, schemas, argument
normalization, and safeguards remain defined by those servers. The coordinator does
not proxy their full tool inventories. Add individual app servers to your MCP client
when you also need direct app-specific tools.

Tools across applications, offered when both are loaded:

| Tool | What it does |
|---|---|
| `place_illustrator_artwork_in_indesign` | Places an artboard of the active Illustrator document on an InDesign page, linked to the `.ai` file, so later edits in Illustrator reach the layout when the link is updated. Saves the Illustrator document first unless you say not to. |
| `copy_swatches_illustrator_to_indesign` | Copies colour swatches with their exact values: CMYK and RGB process colours, spot colours as spot inks, grays as CMYK black. Gradients and patterns are listed, not copied; InDesign's built-in swatches are never changed. |

## Configuration

The coordinator forwards each child server only its own app-prefixed variables,
plus the shared routing variables `ADOBE_TARGET`, `ADOBE_BACKEND`, `TARGET`,
`BACKEND`, and `ARTCRAFT_*`. `UXP_BRIDGE_URL` and `BRIDGE_TOKEN` go only to the
servers that use those local bridges. Allowed-path variables are
`INDESIGN_ALLOWED_DIRS`, `ILLUSTRATOR_ALLOWED_DIRS`, `PHOTOSHOP_ALLOWED_DIRS`,
`AFTEREFFECTS_ALLOWED_DIRS` and `PREMIERE_ALLOWED_DIRS`. App names, timeouts,
backends and ArtCraft control settings are forwarded to their matching app server;
see each app's README for exact behavior. `ADOBE_MCP_APPS` chooses the applications.

## Development

```bash
npm test -w packages/suite
```

The tests verify that the coordinator lists only its supported workflows, standalone
servers retain their complete tool inventories, calls delegate through MCP clients,
and generated scripts pass the static checks for both application object models.
They do not exercise a live Adobe installation.

## Licence

MIT. See [LICENSE](LICENSE).
