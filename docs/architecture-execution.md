# Execution models

This repository and the community UXP fork solve the same problem (drive InDesign from MCP clients) with different bridges.

## This project: ExtendScript via host automation

| | |
| --- | --- |
| **Bridge** | macOS AppleScript (`osascript` → `do script`) or Windows COM (`DoScript`) |
| **Script runtime** | ExtendScript (ES3-era) |
| **Platforms** | macOS + Windows |
| **Returns** | Primarily strings (structured JSON helpers available) |
| **Strengths** | Broad tool surface already implemented; no InDesign UXP plugin install |
| **Limits** | Temp `.jsx` files; ES3 constraints; Adobe is moving away from ExtendScript/CEP |

Entry points: `src/core/scriptExecutor.js`, handlers under `src/handlers/`.

## Community fork: UXP-native

**Repo:** [theloniuser/indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server)

| | |
| --- | --- |
| **Bridge** | Node HTTP/WebSocket ↔ UXP plugin inside InDesign |
| **Script runtime** | Modern JS (async/await, structured objects) |
| **Platforms** | macOS + Windows |
| **Returns** | Structured JSON |
| **Strengths** | Aligns with Adobe’s current platform; better DX for new code |
| **Limits** | Separate plugin install; tool surface may differ |

Useful UXP details called out by the fork author (and worth keeping if you port code either way):

- InDesign collections need `.item(n)` — bracket access often returns `undefined`
- `doc.filePath` is async in UXP — must `await`
- Path strings work directly for `place()` / `exportFile()` in many cases
- Enums via `require('indesign')`

## Decision (issue #1)

**Status: resolved as dual-track, not merge.**

1. **This repo stays on ExtendScript/COM** for the existing ~120 wired MCP tools, Windows/macOS host automation, and users who want MCP without a UXP plugin.
2. **UXP is the recommended direction for greenfield work** that needs modern JS and long-term Adobe alignment. Prefer [indesign-uxp-server](https://github.com/theloniuser/indesign-uxp-server) when starting fresh or when structured JSON returns matter more than this repo’s tool catalog.
3. **No immediate monorepo merge.** Convergence (shared tool schemas, dual backend, or absorbing UXP) remains optional follow-up if maintainers align — not blocked work for either project.
4. Collaboration is welcome: PRs here, contributions upstream to the UXP fork, or a future shared `tools` schema package.

See GitHub issue [#1](https://github.com/zachshallbetter/indesign-mcp-server/issues/1).
