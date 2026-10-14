# adobe-mcp

MCP servers for Adobe applications. Each application has its own server you
can install on its own; a suite that combines them into one server is on the
way.

| Package | What it drives | npm |
|---|---|---|
| [indesign-mcp-server](packages/indesign) | Adobe InDesign: documents, pages, text, styles, tables, books, PDF and EPUB export (137 tools) | [`indesign-mcp-server`](https://www.npmjs.com/package/indesign-mcp-server) |
| [illustrator-mcp-server](packages/illustrator) | Adobe Illustrator: artboards, layers, shapes and paths, text, colour, pathfinder, export (64 tools) | `illustrator-mcp-server` |
| [adobe-mcp-core](packages/core) | The shared foundation: script escaping, the script runner, the server shell and the static script audit | `adobe-mcp-core` |

Each server runs on the machine where the Adobe application is installed and
talks to it through ExtendScript, the scripting interface the applications ship
with. macOS and Windows are supported.

## Install one application

Claude Code:

```bash
claude mcp add indesign -- npx -y indesign-mcp-server
```

```bash
claude mcp add illustrator -- npx -y illustrator-mcp-server
```

Any client that reads an `mcpServers` block:

```json
{
  "mcpServers": {
    "indesign": { "command": "npx", "args": ["-y", "indesign-mcp-server"] },
    "illustrator": { "command": "npx", "args": ["-y", "illustrator-mcp-server"] }
  }
}
```

Each package's README covers its tools, conventions and configuration.

## How the repository is organised

```
packages/
  core/          adobe-mcp-core           shared by every server
  indesign/      indesign-mcp-server
  illustrator/   illustrator-mcp-server
```

The servers share their infrastructure through `adobe-mcp-core`, so a fix to
escaping, path checks, result handling or the script runner reaches every
server. What differs between applications stays in each package: its tools,
its instructions, and how the application is told to run a script.

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
