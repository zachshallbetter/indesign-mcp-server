# Contributing to InDesign MCP Server

Thanks for contributing.

## Quick start

1. Fork and clone the repository
2. `npm install`
3. `npm run check` — syntax check core modules
4. `npm test` — unit tests (no InDesign required)
5. With InDesign running: `npm run test:integration` (optional)

## Prerequisites

- Node.js 18+
- Adobe InDesign 2023+ recommended for integration tests
- macOS (AppleScript) or Windows (COM)

## Project structure

```text
src/
  core/       # MCP server, script executor, session
  handlers/   # Tool implementations by domain
  types/      # MCP tool schemas
  utils/      # stringUtils, jsxSafe
tests/
  unit/       # CI-safe tests
  *.js        # Integration tests (need InDesign)
examples/     # Starter workflows
docs/         # MCP instructions, changelog
```

## Development guidelines

### ExtendScript safety

Values interpolated into ExtendScript must go through `src/utils/jsxSafe.js`:

- Strings: `str()`
- Numbers: `num()` / `index()`
- Booleans: `bool()`
- Enums: `enumOf(..., ALLOWED.*)`
- Paths: `validateFilePath()` then `jsxPath()`

Do not concatenate raw `filePath` or free text into `File("...")` or string literals.

Prefer `ScriptExecutor.executeInDesignScriptStructured()` for new code that can consume `{ ok, result, error }`.

### Adding a tool

1. Define schema in the appropriate `src/types/toolDefinitions*.js`
2. Implement handler method
3. Wire `case` in `src/core/InDesignMCPServer.js`
4. Add unit coverage for any new pure helpers
5. Document in README handler list if user-facing

### Pull requests

- Keep diffs focused
- Run `npm run check && npm test` before opening a PR
- Describe platform impact (macOS / Windows) when touching `scriptExecutor.js`

## Code of conduct

Be respectful. Report security issues privately to the maintainer when possible.
