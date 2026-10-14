# Changelog

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