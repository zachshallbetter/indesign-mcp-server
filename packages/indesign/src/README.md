# Source layout

This is a map of `src/` for contributors. To add a tool, follow the checklist in [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-tool).

```text
src/
  index.js                    Entry point (bin: indesign-mcp-server); starts the stdio server
  core/
    InDesignMCPServer.js      MCP Server: SERVER_INSTRUCTIONS, tools/list, tools/call: handleToolCall (aliases, warnings) and the dispatch switch
    scriptExecutor.js         Runs scripts in InDesign: AppleScript (macOS), COM (Windows), UXP bridge; indesign_status data
    sessionManager.js         In-process state: last document page size, last created item, default positioning
  handlers/                   One class of static async methods per area; each method implements one tool
    index.js                  Re-exports the handler classes
    documentHandlers.js       Documents: create/open/save, preferences, stories, layers, hyperlinks, sections, XML, validation
    pageHandlers.js           Pages: add/move/delete/resize, guides, placement, snapshots, background
    spreadHandlers.js         Spreads
    masterSpreadHandlers.js   Master spreads and master items
    textHandlers.js           Text frames, tables, find/replace
    graphicsHandlers.js       Shapes, placed images, object styles
    styleHandlers.js          Paragraph/character styles, swatches, apply_color
    pageItemHandlers.js       Page items; also exports the shared JSX scaffolding (jsxProgram, jsxPage, jsxSwatch, jsxFont, ...)
    groupHandlers.js          Groups
    layerHandlers.js          Layers
    bookHandlers.js           Books
    exportHandlers.js         PDF, images, EPUB, package
    utilityHandlers.js        indesign_status, execute_indesign_code, view_document, session tools
    helpHandlers.js           help: built from the tool definitions, so it always matches tools/list
  types/
    toolDefinitions*.js       Tool schemas (name, description, inputSchema), grouped by area
    index.js                  Assembles allToolDefinitions and attaches title + annotations
    annotations.js            Explicit READ_ONLY / DESTRUCTIVE / IDEMPOTENT / OPEN_WORLD lists
  utils/
    jsxSafe.js                Escaping and validation for values interpolated into scripts; path allow-list
    stringUtils.js            Re-exports jsxSafe; looksLikeFailure, formatResponse, formatErrorResponse
```

## Request flow

1. `tools/list` returns `allToolDefinitions`. Each entry has `name`, `title`, `description`, `inputSchema` and `annotations`.
2. `tools/call` runs `InDesignMCPServer.handleToolCall(name, args)`. It maps older parameter names to the canonical ones (`handlers/aliases.js`) and collects a warning for each alias and each argument the tool does not take. `dispatch(name, args)` then sends the call to its handler method through a `switch`. Unknown tool names return an error result.
3. The handler validates the arguments, builds an ExtendScript string and calls `ScriptExecutor.executeInDesignScript(script)`.
4. The executor runs the script through the selected backend and returns its result as a string. See [docs/architecture-execution.md](../docs/architecture-execution.md).
5. The handler returns `formatResponse(result, "Operation Name")`. `success` is `!looksLikeFailure(result)`.
6. `handleToolCall` adds `warnings` to the result when there are any. The server serializes the object as JSON text and sets `isError` when `success === false`. If the handler threw, the server returns `{ success: false, error }` (plus `warnings`) with `isError: true`.

## Handler conventions

- **Never interpolate raw input into a script.** Use the `jsxSafe` helpers:
  - `str()` for strings
  - `num()` and `index()` for numbers and indexes, with ranges
  - `bool()` for booleans
  - `enumOf(value, allowed)` for anything written as an identifier, such as `Justification.${...}`
  - `validateFilePath()` then `jsxPath()` for every file path
  - `json()` and `numList()` for structures
- **Generated scripts must be ES5 (ExtendScript).** Do not use `let`, `const`, arrow functions, template literals, classes, or the `JSON` object inside the script text. Node-side code can use modern JavaScript.
- **Units.** Callers pass millimeters from the page's top-left corner. The shared scaffolding helps:
  - `jsxProgram()` sets `app.scriptPreferences.measurementUnit` to points for the run and restores it afterwards.
  - `mmToPt()` and `jsxBounds()` convert millimeter values to points relative to `page.bounds`.
  - `__mm()` converts back for output.
- **The page.** `jsxPage(pageIndex)` binds `page`. It uses the given 0-based index with a range check, or the active page when no index is given.
- **Failures are strings** that `looksLikeFailure()` recognizes:
  - Messages starting with `No document open`, `Error ...`, `Failed ...`, `Invalid ...`, `Cannot ...`, `Could not ...` or `Unable to ...`.
  - Short single-line messages containing `not found`, `out of range`, `does not exist` or `not open`.

  A failure in any other wording is reported as a success.
- **Success strings** should say what changed and identify the result, such as an ID, a page or a count, so the agent can continue without another lookup.

## How a script is built

The text, graphics, style, group, page-item and export handlers build scripts with `jsxProgram(bodyLines, { errorPrefix })` from `pageItemHandlers.js`. It does four things:

- wraps the body in `function __run() { ... }`
- returns `No document open` when no document is open
- binds `doc` to the active document
- turns uncaught exceptions into `<errorPrefix>: <message>`

The body must `return` a string. `JSX_HELPERS` adds `__swatch`, which also creates `#RRGGBB` swatches, as well as `__font`, `__styleByName`, `__mm` and `__name`.

Other handlers, such as document, page, spread, master and book, build their scripts directly from arrays of lines. Those scripts end with a bare expression (for example `out;`), and that expression's value is the result.

## Session state

`sessionManager` keeps the page size from the last `create_document` or `open_document` call. `resolveBox()` uses it to fill in a missing `x`, `y`, `width` or `height` that fits on the page. It also records the last created item for `get_session_info`. The state is per process and is never sent to InDesign. `clear_session` resets it.

## Tool metadata

- `src/types/index.js` gives every tool a `title`, which comes from its name, and MCP `annotations` from `annotations.js`.
- A tool that is not in `READ_ONLY` counts as a write.
- Add a tool to `DESTRUCTIVE` if it can delete or overwrite content or files.
- Add it to `IDEMPOTENT` if repeating the call has no further effect.
- `unknownAnnotationNames()` (checked by `tests/unit/definitions.test.js`) catches names in these lists that are not real tools.
