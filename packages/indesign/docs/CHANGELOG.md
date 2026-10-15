# Changelog

## 2.4.0

### Renamed
- The package is now `adobe-mcp-indesign` (MCP Registry: `io.github.zachshallbetter/adobe-mcp-indesign`), matching the other servers in the adobe-mcp repository. Tools, parameters and behaviour are unchanged. Replace `indesign-mcp-server` with `adobe-mcp-indesign` in your client configuration; the old package is deprecated and stays at 2.3.0.
- The UXP bridge command is `adobe-mcp-indesign-uxp-bridge`.

### Changed
- The server now runs on adobe-mcp-core, the foundation it shares with the other servers in the adobe-mcp repository: script escaping, path checks, the structured result wrapper, failure detection, argument aliases and warnings, annotations, the ExtendScript transport and the MCP server shell. Every tool generates exactly the same script as in 2.3.0.
- ExtendScript calls no longer block the server while InDesign works: the transport starts osascript or PowerShell asynchronously and without a shell.
- Tool dispatch is a table, `TOOL_HANDLERS` in `src/core/InDesignMCPServer.js`; the server refuses to start if an advertised tool has no handler.

### Added
- `INDESIGN_SCRIPT_TIMEOUT_MS` (default 120000): how long to wait for InDesign. A timeout now says a dialog is probably open in InDesign.

## 2.3.0

### Added
- Tool results carry a `warnings` list when an argument was not used as written: unknown parameters (ignored, with the closest valid name suggested) and deprecated aliases. Results without warnings are unchanged, and a warning never fails a call. Errors thrown before a call runs include the warnings too.
- `tests/unit/warnings.test.js`, which also checks that handlers read only advertised parameters, so "was ignored" is accurate
- UXP capability probe: `indesign_status` with `probe: true` on the UXP backend returns `backend.uxpProbe`, which reports whether the completion value comes back, how enums compare, native `[i]`, `constructor.name`, `fs` path forms and Promise-returning methods. It also lists `problems` (tools that will misbehave) and `handled` differences. It is read-only and runs from the plugin (version 1.2.0).

### Changed
- `objectIndex` is accepted only by `apply_color`; on other tools it is reported as an unknown parameter
- Older names that individual handlers read silently are now aliases in `src/handlers/aliases.js`, with deprecation warnings: `folderPath` -> `outputPath` (`export_images`, `package_document`), `pageRange` -> `pages` (`export_images`), `applyObjectStyle` -> `objectStyle` (`place_image`), `transparency` -> `opacity` (`create_object_style`)
- Server instructions and `docs/LLM_PROMPT.md` describe `warnings`
- UXP plugin version 1.2.0
- `tests/unit/uxp.test.js` also covers the token on the bridge's WebSocket port

### Security
- With `BRIDGE_TOKEN` set, the bridge's WebSocket port requires it too. A connection must send `{ "type": "auth", "token": ... }` as its first message; a wrong token or another message closes it (code 4001), and no message within 5 s (`UXP_AUTH_TIMEOUT_MS`) closes it (4002). Before, any local process could connect as the plugin, receive every script and return fake results. The Bridge Panel has a token field next to the port, stored in `localStorage`; the plugin and bridge must come from the same version.
- A connected plugin is no longer replaced by a new connection: other connections are closed (4009) while it is open. A connection that closes before authenticating no longer disconnects the plugin.
- The bridge compares tokens in constant time.

## 2.2.0

### Canonical parameter names

One parameter name and one enum vocabulary per concept, so agents stop guessing. The older names and values are still accepted as aliases (mapped in `src/handlers/aliases.js` before a handler runs) and generate exactly the same scripts; they are no longer advertised in the schemas.

#### Names

| Concept | Canonical | Still accepted | Tools |
| --- | --- | --- | --- |
| Stroke weight (points) | `strokeWeight` | `strokeWidth` | `create_rectangle`, `create_ellipse`, `create_polygon`, `create_master_rectangle` (already `strokeWeight`: `create_object_style`, `set_page_item_properties`) |
| Font | `fontName` (`"Family\tStyle"`, InDesign's `Font.name`, or a family name) | `fontFamily`; `fontFamily` + `fontStyle` | `create_paragraph_style`, `create_character_style`, `create_master_text_frame` (already `fontName`: `create_text_frame`, `edit_text_frame`) |
| Alignment | `alignment` with InDesign `Justification` names: `LEFT_ALIGN`, `CENTER_ALIGN`, `RIGHT_ALIGN`, `LEFT_JUSTIFIED`, `RIGHT_JUSTIFIED`, `CENTER_JUSTIFIED`, `FULLY_JUSTIFIED` | `LEFT`, `CENTER`, `RIGHT`, `JUSTIFY` (= `LEFT_JUSTIFIED`), any case | `create_text_frame`, `edit_text_frame` (already Justification: `create_paragraph_style`, `create_master_text_frame`) |
| Item index | `itemIndex` | `objectIndex` | `apply_color` |

#### Changed
- `create_text_frame` and `edit_text_frame` now also accept `RIGHT_JUSTIFIED`, `CENTER_JUSTIFIED` and `FULLY_JUSTIFIED`
- Every index parameter is an `integer` with `minimum: 0` (`spreadIndex`, `referenceSpreadIndex` and `matchIndex` were `number`; the page-item and group indexes had no minimum)
- Every item index description names its collection: `page.allPageItems` (the `list_page_items` / `list_groups` numbering) for the page-item and group tools, `page.textFrames` for `frameIndex`, `page.allGraphics` for `get_image_info`, and the chosen collection for `apply_color` / `apply_object_style`
- Server instructions and `docs/LLM_PROMPT.md` describe the canonical names and index spaces

#### Added
- `tests/unit/aliases.test.js`: each alias generates the same script as its canonical name
- Definition tests: index parameters are bounded integers, aliases are not advertised, alignment enums are the Justification names

### UXP backend returns tool results

Under `INDESIGN_BACKEND=uxp`, most tools returned an empty result: the plugin only passed back an explicit `return`, while the handler scripts end with a bare expression, and the scripts used ExtendScript globals that UXP does not have. The plugin now runs them with ExtendScript semantics. This is tested against a fake InDesign DOM only; the backend stays experimental until it has been run against InDesign.

#### Changed
- The UXP plugin (`uxp/plugin/runtime.js`, plugin version 1.1.0) evaluates each script with `eval` and returns its completion value, as `do script` / `DoScript` do. Code with a top-level `return` or `await` still runs as an async function body.
- Enums and classes a script names come from `require('indesign')`; `File`, `Folder` and `$` are shims. `File.exists` and `Folder.create()` use UXP's `fs` module, so the plugin manifest now requests `localFileSystem: fullAccess`.
- `app` is wrapped so `collection[i]` falls back to `item(i)` and `constructor.name` to `constructorName` (UXP DOM differences documented by Adobe); `File` shims reach DOM methods as path strings.
- UXP string results are trimmed, as the AppleScript/COM paths trim stdout.
- The plugin's WebSocket port is set in the Bridge Panel (default 3001, remembered), so `UXP_WS_PORT` on the bridge no longer breaks the connection. The bridge prints the port to enter when it is not 3001.
- `auto` re-checks the bridge every 5 s instead of once per process, and falls back to ExtendScript for a call only when the bridge is unreachable or the plugin is not connected (the script cannot have run).
- With `BRIDGE_TOKEN` set, the bridge requires it on `/status` as well as `/execute`.
- A UXP bridge timeout is reported as a timeout, not as "bridge not reachable".

#### Added
- `tests/unit/uxp.test.js` (`npm run test:uxp`, part of `npm test`): the real bridge with a fake plugin running `runtime.js` in a Node `vm` against a UXP-shaped fake DOM. Every handler script must return over UXP what it returns when evaluated ExtendScript-style. It also covers the token, `auto` re-check and fallback, and the shims.
- `tests/audit/collectScripts.js`: the script capture shared by the audit and the UXP test.

#### Known gaps
- Enum comparisons with `==` may fail if UXP enum values are objects (six handler scripts compare enums). Whether every DOM method that takes a file accepts a path string is unverified. Details in `uxp/README.md`.

## 2.1.0

Ready for public and agent use: agents get instructions, tool annotations and a full reference; docs are rewritten against the code.

### Added
- Server instructions sent at `initialize` (units, indexes, colors, fonts, paths, errors, destructive tools)
- MCP tool annotations and a title on all 137 tools (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), defined in `src/types/annotations.js`
- `docs/TOOLS.md`: generated reference for every tool and parameter (`npm run docs:tools`; `npm test` fails when it is stale)
- Tests: tool definition quality (descriptions, types, titles, annotations) and path confinement for all 30 file/folder parameters
- `SECURITY.md`, issue and pull request templates

### Changed
- `print_book` no longer opens the print dialog by default (it blocked unattended calls)
- `open_document` suppresses InDesign alerts while opening, so missing fonts or links cannot block the call
- `create_text_frame` and `place_image` no longer advertise fixed `x`/`y`/size defaults; omitted values are placed automatically, as the server does
- `npm run check` syntax-checks every JavaScript file (it skipped most handlers)
- Descriptions for 10 terse tools and 16 undocumented parameters
- Docs rewritten against the code: setup and troubleshooting (`docs/MCP_INSTRUCTIONS.md`), agent guide (`docs/LLM_PROMPT.md`), architecture, examples, contributor guides. The UXP backend is documented as experimental.

## 2.0.0

An audit of every tool against the InDesign 2023 scripting DOM found that 17 of the 136 advertised tools were never implemented, about 40 generated scripts used properties, methods or enums that do not exist in InDesign, and failed calls were reported as successes. This release fixes all of it and adds checks so it cannot drift again. Scripts are verified statically against Adobe's published DOM; run `npm run test:integration` against a live InDesign before relying on a tool in production.

### Added
- 17 tools that were listed but returned "not implemented": the 11 spread tools (`list_spreads`, `get_spread_info`, `duplicate_spread`, `move_spread`, `delete_spread`, `set_spread_properties`, `create_spread_guides`, `place_file_on_spread`, `place_xml_on_spread`, `select_spread`, `get_spread_content_summary`), `create_layer`, `set_active_layer`, `list_layers`, `export_epub`, `detach_master_items`, `remove_master_override`
- `apply_character_style` is now advertised (it was implemented but missing from `tools/list`)
- Script audit (`npm run test:audit`, part of `npm test` and CI): every advertised tool must dispatch, generate valid ES5, and use only names that exist in the InDesign 2023 DOM
- Optional `pageIndex` on text, shape, image and page-item tools (defaults to the active page)
- `"#RRGGBB"` colors create an RGB swatch where a color is accepted
- `dryRun` for `cleanup_document`; GREP search (`useRegex`) for `find_text_in_document`; `oversetOnly` for `get_document_stories`

### Fixed
- Failed calls reported success: "No document open", "Error …" and "… not found" results now return `success: false` and MCP `isError: true`
- Nonexistent InDesign APIs replaced with real ones, including grid, guide, text and layout preferences, slug offsets, `FitOptions` in `place_image`, polygon creation, rounded corners, table header rows, `resize()` constraints, layout snapshots, page `adjustLayout`, section numbering style, XML export, zoom, data merge and preflight
- `validate_document` and `cleanup_document` used `JSON`, which InDesign's ExtendScript does not have
- Enum and color arguments were spliced into scripts as bare identifiers (`BLUE`, `Black`), which threw at runtime
- `place_file_on_page` passed arguments to `place()` in the wrong order; `export_images` and `package_document` read an argument the schema never defined; master spread tools read `masterIndex` while their schemas said `name`
- `cleanup_document` only counted items; it now removes them. `organize_document_layers` deleted a layer before reading its name and never implemented merge or sort
- Case-sensitive and whole-word options in find tools were set on the wrong object and ignored
- `create_document` ignored `pages`; sizes and margins are now applied in millimeters regardless of the document's ruler units
- `view_document` read properties that do not exist; `indesign_status` deleted temp scripts that running calls were still using
- `help` documented about 30 tools (one of them nonexistent); it is now generated from the tool definitions and covers all 137
- Shape tools accept omitted position and size again, as documented (automatic placement)
- Every argument that reaches a script goes through the validated `jsxSafe` helpers

### Changed (breaking)
- `set_document_preferences` takes grouped settings (`general`, `margins`, `guides`, `text`, `grid`) instead of `preferenceType` + `preferences`
- Grid and layout preference parameters use InDesign's own property names
- `adjust_page_layout` takes numbers plus `units`; `resize_page` requires `width` and `height`
- `create_object_style`: `transparency` is now `opacity` (the old name is still accepted)
- `export_images` supports JPEG and PNG (InDesign has no TIFF or GIF export); `export_pdf` drops the `DIGITAL` option
- Removed parameters that no InDesign API could honor (for example `spreadHidden`, `includeImages` on EPUB, several `data_merge` options)
- `create_color_swatch` stores RGB by default; `colorSpace: "CMYK"` keeps the previous conversion

## 1.4.0

### Added
- Published to npm: run with `npx -y indesign-mcp-server`, no clone needed (`bin` + `files` in `package.json`)
- `indesign-mcp-uxp-bridge` command for the UXP bridge
- `server.json` and `mcpName` for the official MCP Registry (`io.github.zachshallbetter/indesign-mcp-server`)
- MCP protocol test (`tests/unit/protocol.test.js`): handshake, tool list and schemas over stdio, no InDesign required; runs in `npm test` and CI

### Changed
- `@modelcontextprotocol/sdk` upgraded from 0.5 to 1.32
- Server name and version over MCP are read from `package.json`
- README install instructions use `npx`

### Fixed
- UXP bridge crashed on start: it used CommonJS `require` inside an ES module package and imported `uuid`, which was not a dependency. It now uses ES imports and `crypto.randomUUID`.

## 1.3.0

### Added
- Optional **UXP execution backend** (`INDESIGN_BACKEND=uxp|auto|extendscript`)
- Vendored bridge + plugin under `uxp/` (adapted from theloniuser/indesign-uxp-server)
- `npm run uxp:bridge`, `start:uxp`, `start:auto`
- `indesign_status` reports backend configured/resolved and UXP connection

### Changed
- `ScriptExecutor` routes scripts through UXP HTTP bridge when selected
- Architecture docs describe multi-backend setup (issue #1 follow-up)


## 1.2.1

### Documentation
- Resolved issue #1: documented ExtendScript/COM vs UXP dual-track decision
- Added `docs/architecture-execution.md` and expanded README related projects

## 1.2.0

### Added
- Windows COM execution path and macOS InDesign auto-detect (env / running / newest app)
- `indesign_status` health tool (optional live probe)
- `src/utils/jsxSafe.js` helpers for safe ExtendScript interpolation
- Structured result helpers: `executeInDesignScriptStructured`, `autoCaptureResult`, `parseStructuredResult`
- Unit test suite (`npm test`) and GitHub Actions CI
- `examples/basic-flyer.md` and sample MCP config
- Temp script cleanup on server start

### Changed
- High-risk path/text tools use `validateFilePath` / `jsxPath` / `str` / `num` (document open/save, place image, text frames, export, place file)
- README and CONTRIBUTING updated for dual platform, no emoji marketing fluff
- Package version 1.2.0; server reports the same version over MCP

### Security
- File operations confined to home + `INDESIGN_ALLOWED_DIRS`
- Reject path traversal and system directories on macOS and Windows


All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-07-27

### 🚀 Added
- **Help System**: Comprehensive `help` command with tool-specific help, category filtering, and multiple output formats
- **Image Scaling**: Advanced image placement with precise scaling (1-1000%) and multiple fit modes
- **Smart Positioning**: Enhanced session management with automatic bounds checking and optimal content placement
- **Color Management**: Fixed RGB to CMYK conversion with proper color swatch creation
- **Style Application**: Direct style application during text frame creation
- **Page Backgrounds**: Full-page background color application with opacity control
- **Enhanced Error Handling**: Improved error reporting and validation across all handlers
- **Comprehensive Documentation**: Added MCP_INSTRUCTIONS.md and LLM_PROMPT.md for better user guidance

### 🔧 Enhanced
- **Session Management**: Upgraded to EventTarget-based system with import/export capabilities
- **Tool Definitions**: Expanded from 35+ to 50+ professional tools
- **Image Handling**: Robust image placement with absolute path support and error recovery
- **Font Management**: Improved font application with fallback handling
- **Style System**: Enhanced paragraph, character, and object style creation and application
- **Layout Tools**: Advanced positioning and grouping capabilities
- **Export Functions**: Comprehensive PDF and image export options

### 🐛 Fixed
- **Color Creation**: Fixed RGB to CMYK conversion formula for accurate color representation
- **Font Application**: Resolved font name formatting issues in ExtendScript
- **Image Placement**: Fixed file path resolution and error handling for image placement
- **Style Application**: Corrected style application during text frame creation
- **Error Reporting**: Improved error message clarity and debugging information
- **Session Persistence**: Fixed session management across tool calls

### 📚 Documentation
- **MCP Instructions**: Comprehensive setup and usage guide for MCP integration
- **LLM Prompt**: Concise instructions for AI assistants using the MCP server
- **README Updates**: Enhanced documentation with examples and best practices
- **Help System**: Built-in documentation accessible via the `help` command

### 🧪 Testing
- **Unified Test Runner**: Single-document test suite for better session management testing
- **Comprehensive Coverage**: Tests for all major functionality including edge cases
- **Error Handling Tests**: Validation of error scenarios and recovery
- **Performance Tests**: Verification of scaling and positioning accuracy

### 🔧 Technical Improvements
- **Modular Architecture**: Clean separation of concerns with dedicated handler classes
- **Type Safety**: Comprehensive tool definitions with parameter validation
- **Error Recovery**: Graceful handling of missing resources and invalid inputs
- **Performance**: Optimized ExtendScript execution and response handling

## [1.0.0] - 2025-07-26

### 🎉 Initial Release
- **Core MCP Server**: Model Context Protocol implementation for Adobe InDesign
- **Document Management**: Create, open, save, and manage InDesign documents
- **Page Operations**: Add, delete, and manipulate pages
- **Content Creation**: Text frames, graphics, and basic styling
- **Basic Export**: PDF and image export capabilities
- **35+ Tools**: Comprehensive set of InDesign automation tools

---

## Version History

### v1.1.0 (Current)
- Major feature release with help system, image scaling, and enhanced color management
- 50+ professional tools for comprehensive InDesign automation
- Improved documentation and user guidance

### v1.0.0
- Initial release with core MCP functionality
- Basic InDesign automation capabilities
- 35+ tools for document and content management

---

## Migration Guide

### From v1.0.0 to v1.1.0

#### New Features
- Use the `help` command to explore new functionality
- Leverage image scaling with `place_image` tool
- Take advantage of smart positioning for better layouts
- Use the enhanced color management system

#### Breaking Changes
- None - all existing functionality remains compatible

#### Deprecations
- None in this release

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 