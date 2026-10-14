# Contributing

Bug reports, fixes and new tools are welcome. This page covers how to set up, what a change has to pass, and how to add a tool.

## Development setup

You need:

- Node.js 18 or newer
- npm
- macOS or Windows with Adobe InDesign. You only need InDesign for integration tests; unit tests, the protocol test and the script audit run on any OS.

```bash
git clone https://github.com/zachshallbetter/indesign-mcp-server.git
cd indesign-mcp-server
npm install
npm run check   # syntax check of the main modules
npm test        # unit, path, protocol, script audit, TOOLS.md check; no InDesign needed
```

To try your working copy in a client, point the client at `node /ABSOLUTE/PATH/TO/indesign-mcp-server/src/index.js` instead of `npx`. [docs/MCP_INSTRUCTIONS.md](docs/MCP_INSTRUCTIONS.md) has the setup details. With InDesign running, `npm run test:integration` drives it for real. See [tests/README.md](tests/README.md).

The code map and request flow are in [src/README.md](src/README.md). The execution backends are described in [docs/architecture-execution.md](docs/architecture-execution.md).

## Adding a tool

1. **Define it** in the matching `src/types/toolDefinitions*.js`. Give it:
   - a snake_case `name`
   - a `description` of at least 35 characters that says what the tool changes and returns
   - an `inputSchema` in which every property has a `type` and a `description`
   - `required` names that exist in the schema, and enum defaults that are in their enum

   Follow the conventions: millimeters from the page's top-left corner, 0-based indexes, swatch names or `#RRGGBB`, `"Family\tStyle"` fonts, and absolute paths.
2. **Implement it** as a `static async` method in the right `src/handlers/*.js` class.
   - Pass every caller value through the `jsxSafe` helpers: `str`, `num`, `index`, `bool`, `enumOf`, `json`.
   - Pass every path through `validateFilePath()`, then `jsxPath()`.
   - Build page-level scripts with `jsxProgram` and `jsxPage` from `pageItemHandlers.js` where they fit.
   - Return `formatResponse(result, "Operation Name")`.
3. **Dispatch it.** Add a `case 'tool_name':` to `InDesignMCPServer.handleToolCall` in `src/core/InDesignMCPServer.js`.
4. **Annotate it** in `src/types/annotations.js`.
   - Add it to `READ_ONLY` if it changes nothing.
   - Otherwise add it to `DESTRUCTIVE` if it can delete or overwrite content or files.
   - Add it to `IDEMPOTENT` if repeating the call has no further effect.
   - Add it to `OPEN_WORLD` if it reaches beyond the local InDesign.
5. **Check help.** `help` categories come from the definition files, but `text`, `graphics` and `styles` filter `toolDefinitionsContent.js` by name pattern in `src/handlers/helpHandlers.js`. The protocol test fails if a tool is missing from help.
6. **Regenerate the reference** with `npm run docs:tools`, which rewrites `docs/TOOLS.md`.
7. **Run `npm test`.** The definitions test, the path test, the script audit and the TOOLS.md check enforce steps 1 to 6.

### Rules for generated scripts

- **ES5 only.** ExtendScript has no `let`, `const`, arrow functions, template literals, classes, or `JSON` object. Template literals are fine in the Node code that *builds* the script, but not inside the script text. The audit parses every generated script as ES5.
- **Use only real DOM names.** The audit checks every property, method and global against the InDesign 2023 type definitions. If a name is the script's own field, add it to `ALLOWED_NAMES` in `tests/audit/scripts.audit.js`.
- **Report failures as strings that `looksLikeFailure()` recognizes** (see `src/utils/stringUtils.js`):
  - Messages starting with `No document open`, `Error ...`, `Failed ...`, `Invalid ...`, `Cannot ...`, `Could not ...` or `Unable to ...`.
  - Short single-line messages containing `not found`, `out of range`, `does not exist` or `not open`.

  Any other wording is reported to the agent as a success.
- **Describe the result on success.** Say what changed and give an ID, page or count, so the agent does not need another lookup.
- **Avoid modal dialogs.** A dialog blocks the call until it times out. Set `userInteractionLevel` to `NEVER_INTERACT` around operations that can prompt, and restore it afterwards.
- **Restore what you change.** Put back any application preferences the script changes, such as measurement units or export preferences.

## Code style

- ES modules, 4-space indentation, single quotes in Node code.
- Keep handlers small. Put shared script scaffolding in `pageItemHandlers.js` (`jsxProgram`, `JSX_HELPERS`) rather than copying it.
- Server code must never write to stdout. stdout carries the MCP protocol, so use `console.error` for diagnostics.
- Tool descriptions and messages are for agents: plain, specific and short. No emoji.

## Pull requests

- Keep each PR to one change, and explain what it changes and why.
- `npm run check && npm test` must pass. CI runs both on every push and pull request.
- If you change `scriptExecutor.js` or anything platform-specific, say whether you tested on macOS, Windows or both, and with which InDesign version.
- If you ran integration tests or tried the change in a client against a real InDesign, say so. The audit checks scripts against the DOM types but does not run them.
- Update the docs your change affects:
  - `docs/TOOLS.md` (generated)
  - `docs/LLM_PROMPT.md`, if conventions or workflows change
  - `SERVER_INSTRUCTIONS` in `src/core/InDesignMCPServer.js`, if agent-facing conventions change
- Add a line to `docs/CHANGELOG.md` for user-visible changes.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md) to report it privately. Examples include a way around the path allow-list, script injection through tool arguments, or problems with the UXP bridge.

## Conduct

Be respectful and constructive in issues, reviews and discussions.
