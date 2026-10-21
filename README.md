# adobe-mcp

MCP servers for Adobe applications. Install each app's server for direct control,
and add the Suite coordinator for workflows that span InDesign and Illustrator.

The InDesign server was published as `indesign-mcp-server` up to 2.3.0. It is
now `adobe-mcp-indesign`, with the same tools; replace the package name in your
client configuration.

| Package | What it drives | npm |
|---|---|---|
| [adobe-mcp-indesign](packages/indesign) | Adobe InDesign: documents, pages, text, styles, tables, books, PDF and EPUB export (423 tools) | [`adobe-mcp-indesign`](https://www.npmjs.com/package/adobe-mcp-indesign) |
| [adobe-mcp-illustrator](packages/illustrator) | Adobe Illustrator: documents, artboards, layers, shapes and paths, typography, colour and swatches, effects and 3D, symbols, patterns, Image Trace, images and links, variables and data sets, actions, export, prepress and printing (308 tools) | [`adobe-mcp-illustrator`](https://www.npmjs.com/package/adobe-mcp-illustrator) |
| [adobe-mcp-photoshop](packages/photoshop) | Adobe Photoshop: documents and formats, image and canvas, layers, masks, smart objects and layer styles, selections and channels, adjustments and fill layers, filters, painting and retouching, type and paths, video timeline, actions and batch, artboards, export, printing and preferences (207 tools) | [`adobe-mcp-photoshop`](https://www.npmjs.com/package/adobe-mcp-photoshop) |
| [adobe-mcp-aftereffects](packages/aftereffects) | Adobe After Effects: projects and footage, compositions, layers and time, keyframes and expressions, every effect and its controls, text animators, masks and shape layers, paint and roto, 3D, tracking, colour, render queue and Essential Graphics (164 tools) | [`adobe-mcp-aftereffects`](https://www.npmjs.com/package/adobe-mcp-aftereffects) |
| [adobe-mcp-premiere](packages/premiere) | Adobe Premiere Pro: projects and bins, sequences, timeline edits, markers, effects, keyframes and transitions, transcripts, metadata and export, through a UXP plugin (96 tools; not yet tested against Premiere Pro) | [`adobe-mcp-premiere`](https://www.npmjs.com/package/adobe-mcp-premiere) |
| [adobe-mcp-suite](packages/suite) | MCP coordinator for two InDesign and Illustrator workflows: place Illustrator artwork in InDesign and copy swatches with exact values | [`adobe-mcp-suite`](https://www.npmjs.com/package/adobe-mcp-suite) |
| [adobe-mcp-core](packages/core) | The shared foundation: script escaping, the script runner, the server shell and the static script audit | [`adobe-mcp-core`](https://www.npmjs.com/package/adobe-mcp-core) |

Each server runs on the machine where the Adobe application is installed and
talks to it through ExtendScript, the scripting interface the applications ship
with. Premiere Pro has no outside scripting route, so its server talks to a
UXP plugin inside Premiere Pro instead. macOS and Windows are supported.

The servers also support corresponding ArtCraft applications:
- **PhotoCraft** for Photoshop (`PHOTOCRAFT_CONTROL_PORT`, default `7878`)
- **VectorCraft** for Illustrator (`VECTORCRAFT_CONTROL_PORT`, default `7979`)
- **DesignCraft** for InDesign (`DESIGNCRAFT_CONTROL_PORT`, default `7979`)
- **EffectCraft** for After Effects (`EFFECTCRAFT_CONTROL_PORT`, default `9877`)
- **FilmCraft** for Premiere Pro (`FILMCRAFT_CONTROL_PORT`, default `9876`)

When an ArtCraft application is running or explicitly configured via `TARGET=craft` or `<APP>_TARGET=craft` (e.g. `PHOTOSHOP_TARGET=craft`, `DESIGNCRAFT_TARGET=craft`), compatible tools route transparently to ArtCraft over its loopback JSON-lines control channel.

## Requirements

- **Node.js 18+** (LTS recommended). `npx` comes with it.
- The Adobe application(s) you want to drive, installed on the same machine:
  InDesign, Illustrator, Photoshop, and/or After Effects **2023 or later**, or
  Premiere Pro **25.6+** with its UXP plugin loaded (see
  [packages/premiere](packages/premiere)).
- An MCP client (Claude Code, Warp, Cursor, Claude Desktop, or any client that
  reads an `mcpServers` block).

Servers speak **MCP over stdio**. Your client starts the process; there is no
hosted endpoint and no API key for the package itself. Tool calls that touch
the application need that app open (or launchable) on the machine.

## Install from npm

### One application

Claude Code:

```bash
claude mcp add --scope user indesign -- npx -y adobe-mcp-indesign
claude mcp add --scope user illustrator -- npx -y adobe-mcp-illustrator
claude mcp add --scope user photoshop -- npx -y adobe-mcp-photoshop
claude mcp add --scope user aftereffects -- npx -y adobe-mcp-aftereffects
claude mcp add --scope user premiere -- npx -y adobe-mcp-premiere
```

Any client that reads an `mcpServers` block:

```json
{
  "mcpServers": {
    "indesign": { "command": "npx", "args": ["-y", "adobe-mcp-indesign"] },
    "illustrator": { "command": "npx", "args": ["-y", "adobe-mcp-illustrator"] },
    "photoshop": { "command": "npx", "args": ["-y", "adobe-mcp-photoshop"] },
    "aftereffects": { "command": "npx", "args": ["-y", "adobe-mcp-aftereffects"] },
    "premiere": { "command": "npx", "args": ["-y", "adobe-mcp-premiere"] }
  }
}
```

### Suite coordinator

One coordinator process connects to the InDesign and Illustrator MCP server
implementations and exposes the cross-application workflows. Add the individual
servers below when you also need direct app-specific tools:

```bash
claude mcp add --scope user adobe -- npx -y adobe-mcp-suite
```

```json
{
  "mcpServers": {
    "adobe": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-suite"]
    }
  }
}
```

Optional global install (puts `adobe-mcp-suite` on your `PATH`):

```bash
npm install -g adobe-mcp-suite
```

### Homebrew or curl

On macOS or Linux, install the same suite release with Homebrew:

```bash
brew tap zachshallbetter/adobe-mcp https://github.com/zachshallbetter/adobe-mcp.git
brew install zachshallbetter/adobe-mcp/adobe-mcp-suite
```

Or use the installer script, which installs the latest npm release globally:

```bash
curl -fsSL https://raw.githubusercontent.com/zachshallbetter/adobe-mcp/main/scripts/install.sh | sh
```

Both methods require Node.js 18 or later. The curl installer supports macOS and
Linux shells; Windows users can use `npm install -g adobe-mcp-suite`.

Then point the client at the binary instead of `npx`:

```json
{
  "mcpServers": {
    "adobe": {
      "command": "adobe-mcp-suite",
      "args": ["--apps", "indesign,illustrator"]
    }
  }
}
```

Marketplace listing: [mcprush.com/zachshallbetter/adobe-mcp-suite](https://mcprush.com/zachshallbetter/adobe-mcp-suite).

Each package's README covers its tools, conventions and per-app configuration.

## Usage

### Choosing applications (suite only)

The coordinator connects to apps selected by `--apps` or `ADOBE_MCP_APPS`
(comma-separated ids: `indesign`, `illustrator`, `photoshop`, `aftereffects`,
`premiere`). Its current workflows require both `indesign` and `illustrator`:

```bash
npx -y adobe-mcp-suite --apps indesign,illustrator
# equivalent
ADOBE_MCP_APPS=indesign,illustrator npx -y adobe-mcp-suite
```

Client config:

```json
{
  "mcpServers": {
    "adobe": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-suite", "--apps", "indesign,illustrator"],
      "env": {
        "INDESIGN_ALLOWED_DIRS": "/Users/you/Work:/Users/you/Desktop",
        "ILLUSTRATOR_ALLOWED_DIRS": "/Users/you/Work:/Users/you/Desktop"
      }
    }
  }
}
```

On Windows, separate allowed directories with `;` instead of `:`.

### What the model sees

- **Single-app servers** expose that app's tools under their original names
  (for example `create_text_frame`, `export_pdf`).
- **The Suite coordinator** exposes only cross-app workflows and delegates their
  steps to the standalone app servers over MCP. It does not re-export app tools.
- **Cross-application tools** (coordinator, when both apps are selected):
  - `place_illustrator_artwork_in_indesign` — place an artboard of the active
    Illustrator document on an InDesign page, linked to the `.ai` file.
  - `copy_swatches_illustrator_to_indesign` — copy colour swatches with exact
    process/spot values.

Reconnect or start a new client session after changing MCP config so the tool
list refreshes.

### Environment variables

Common knobs (see each package README for the full set):

| Variable | Purpose |
|---|---|
| `ADOBE_MCP_APPS` | Suite only: which apps to load (`indesign,illustrator,…`) |
| `INDESIGN_ALLOWED_DIRS` | Extra directories InDesign tools may read/write |
| `ILLUSTRATOR_ALLOWED_DIRS` | Extra directories Illustrator tools may read/write |
| `INDESIGN_APP_NAME` / `ILLUSTRATOR_APP_NAME` | Override the target application name |
| `INDESIGN_SCRIPT_TIMEOUT_MS` / `ILLUSTRATOR_SCRIPT_TIMEOUT_MS` | Per-script timeout |
| `PREMIERE_WS_PORT`, `BRIDGE_TOKEN`, `PREMIERE_ALLOWED_DIRS` | Premiere UXP bridge |
| `ADOBE_TARGET`, `ADOBE_BACKEND` | Optional shared target/backend choice, including local ArtCraft adapters |
| `ARTCRAFT_ENABLED`, `ARTCRAFT_CONTROL_*` | Enable or configure fallback local ArtCraft control connections |
| `UXP_BRIDGE_URL` | InDesign UXP bridge address |

### Smoke-check without an MCP client

The process waits on stdin for MCP JSON-RPC; it is not a conventional CLI with
`--help` output. To confirm a binary starts and lists tools, send an
`initialize` request then `tools/list` over stdio, or run the package tests
(they stub the Adobe apps and do not need them installed):

```bash
npm test -w packages/suite
```

Real layout/work calls need the target Adobe application running on this
machine.

## Install and run from this repository

Use this when developing the servers or when you want the monorepo versions
before they are published.

```bash
git clone https://github.com/zachshallbetter/adobe-mcp.git
cd adobe-mcp
npm install
```

Run a server from source (stdio; suitable as a client `command`):

```bash
# suite (optionally limit apps)
node packages/suite/src/index.js --apps indesign,illustrator

# one application
node packages/indesign/src/index.js
node packages/illustrator/src/index.js
```

Point a client at the monorepo entry instead of `npx`:

```json
{
  "mcpServers": {
    "adobe": {
      "command": "node",
      "args": [
        "/absolute/path/to/adobe-mcp/packages/suite/src/index.js",
        "--apps",
        "indesign,illustrator"
      ]
    }
  }
}
```

## How the repository is organised

```
packages/
  core/          adobe-mcp-core           shared by every server
  indesign/      adobe-mcp-indesign
  illustrator/   adobe-mcp-illustrator
  photoshop/     adobe-mcp-photoshop
  aftereffects/  adobe-mcp-aftereffects
  premiere/      adobe-mcp-premiere       with its UXP plugin in uxp/plugin
  suite/         adobe-mcp-suite          coordinator for cross-app workflows
```

The servers share their infrastructure through `adobe-mcp-core`, so a fix to
escaping, path checks, result handling or the script runner reaches every
server. What differs between applications stays in each package: its tools,
its instructions, and how the application is told to run a script. Each
application package exports its standalone server factory; coordinator workflows
call that server through MCP instead of copying its tool inventory.

## Development

```bash
npm install      # installs every package and links them together
npm run check    # syntax check, every package
npm test         # every package's tests, including each server's static script audit
```

Run one package's tests with `npm test -w packages/illustrator`. The static
audits run every tool against a stubbed application and check each generated
script against the application's scripting object model; they do not need
the applications installed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for releasing and for each package's guide,
and [docs/handbook/](docs/handbook/README.md) for the full handbook: architecture, per-application
rules for writing tools, how work is planned from the capability atlas and landed,
current status, and lessons learned.

## Licence

MIT. See each package's LICENSE.
