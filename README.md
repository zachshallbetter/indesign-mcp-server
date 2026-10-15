# adobe-mcp

MCP servers for Adobe applications. Install one application's server on its
own, or the suite: one server for every application, with tools that work
across them.

The InDesign server was published as `indesign-mcp-server` up to 2.3.0. It is
now `adobe-mcp-indesign`, with the same tools; replace the package name in your
client configuration.

| Package | What it drives | npm |
|---|---|---|
| [adobe-mcp-indesign](packages/indesign) | Adobe InDesign: documents, pages, text, styles, tables, books, PDF and EPUB export (137 tools) | [`adobe-mcp-indesign`](https://www.npmjs.com/package/adobe-mcp-indesign) |
| [adobe-mcp-illustrator](packages/illustrator) | Adobe Illustrator: artboards, layers, shapes and paths, text, colour, pathfinder, effects, export (68 tools) | `adobe-mcp-illustrator` |
| [adobe-mcp-suite](packages/suite) | InDesign and Illustrator in one server, plus cross-application tools: Illustrator artwork into InDesign layouts, swatches with exact values | `adobe-mcp-suite` |
| [adobe-mcp-core](packages/core) | The shared foundation: script escaping, the script runner, the server shell and the static script audit | `adobe-mcp-core` |

Each server runs on the machine where the Adobe application is installed and
talks to it through ExtendScript, the scripting interface the applications ship
with. macOS and Windows are supported.

## Install one application

Claude Code:

```bash
claude mcp add indesign -- npx -y adobe-mcp-indesign
```

```bash
claude mcp add illustrator -- npx -y adobe-mcp-illustrator
```

Any client that reads an `mcpServers` block:

```json
{
  "mcpServers": {
    "indesign": { "command": "npx", "args": ["-y", "adobe-mcp-indesign"] },
    "illustrator": { "command": "npx", "args": ["-y", "adobe-mcp-illustrator"] }
  }
}
```

## Install everything

```bash
claude mcp add adobe -- npx -y adobe-mcp-suite
```

The suite offers every application's tools, prefixed with the application
(`indesign_…`, `illustrator_…`), and the cross-application tools. Load only some
applications with `--apps indesign` or `ADOBE_MCP_APPS`.

Each package's README covers its tools, conventions and configuration.

## How the repository is organised

```
packages/
  core/          adobe-mcp-core           shared by every server
  indesign/      adobe-mcp-indesign
  illustrator/   adobe-mcp-illustrator
  suite/         adobe-mcp-suite          every application in one server
```

The servers share their infrastructure through `adobe-mcp-core`, so a fix to
escaping, path checks, result handling or the script runner reaches every
server. What differs between applications stays in each package: its tools,
its instructions, and how the application is told to run a script. Each
application package exports a module (its tools, handlers, instructions and
script runner); its own server and the suite are both built from it, so a tool
is written once.

## Development

```bash
npm install      # installs every package and links them together
npm run check    # syntax check, every package
npm test         # every package's tests, including each server's static script audit
```

Run one package's tests with `npm test -w packages/illustrator`. The static
audits run every tool against a stubbed application and check each generated
script against the application's scripting object model; they do not need
InDesign or Illustrator installed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for releasing and for each package's guide.

## Licence

MIT. See each package's LICENSE.
