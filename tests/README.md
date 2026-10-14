# Tests

The tests come in two groups. One runs anywhere, including CI, and does not need InDesign. The other drives a real InDesign.

## Without InDesign: `npm test`

`npm test` runs these files in order and stops at the first failure:

| File | Covers |
| --- | --- |
| `unit/jsxSafe.test.js` | Escaping and validation helpers (`str`, `num`, `index`, `bool`, `enumOf`, `json`, `measure`), the path allow-list (`validateFilePath`, `jsxPath`, `buildAllowedDirs`), structured-result wrapping and parsing, backend selection, and `getStatus` without a probe |
| `unit/failure.test.js` | The `looksLikeFailure` contract: which result strings count as failures, and how `formatResponse` sets `success` |
| `unit/definitions.test.js` | Tool definition quality:<br>• snake_case unique names<br>• descriptions of 35 characters or more<br>• titles and full annotations<br>• no unknown names in the annotation lists<br>• typed, described parameters<br>• required parameters that exist<br>• enums that contain their defaults |
| `unit/paths.test.js` | Path confinement. Every parameter that names a file or folder is called with a path outside the allowed directories, and no generated script may contain that path. |
| `unit/protocol.test.js` | Starts the real server over stdio with the MCP SDK client. Checks the handshake (name, version, instructions), that `tools/list` returns every definition with titles and annotations, that an unknown tool returns an error result, and that `help` documents every tool. |
| `audit/scripts.audit.js` | Calls every tool handler with arguments built from its schema, with the executor stubbed out. Checks that:<br>• every advertised tool dispatches to a handler<br>• every generated script parses as ES5<br>• every property, method and global the script uses exists in the InDesign 2023 and ExtendScript type definitions (`types-for-adobe`) |
| `scripts/generate-tool-reference.js --check` | Fails if `docs/TOOLS.md` no longer matches the tool definitions. Regenerate the file with `npm run docs:tools`. |

Useful variants:

```bash
npm run test:unit                         # the four unit files, without protocol and audit
npm run test:protocol                     # protocol test only
npm run test:audit                        # audit only
node tests/audit/scripts.audit.js export_ # audit tools matching a regex
node tests/audit/scripts.audit.js --dump /tmp/jsx   # write each generated script to a folder
npm run check                             # node --check on the main modules
```

The audit checks scripts against Adobe's published DOM types, but it does not run them. A script can pass the audit and still fail in InDesign.

## With InDesign: integration tests

These tests start the server, send real tool calls, and change real documents. Before you run them:

- Open InDesign.
- Close any work you have not saved.
- On macOS, grant the Automation permission.

```bash
npm run test:integration    # node tests/index.js: every suite in order
npm run test:unified        # one shared document across suites
node tests/index.js --help  # list the suites
```

`tests/index.js` runs the `test-*.js` files grouped into suites:

- **Required:** connectivity, document foundation, preferences, grid and layout
- **Optional:** content, page items and groups, advanced features, standard document, workflow, error handling, bounds checking, swatches, images, absolute paths

`tests/index.js` always runs every suite. Its help text mentions `--required` and `--suite`, but those flags are not implemented yet. To run one file, use `node tests/<file>`. Some tests save documents and read test images through relative paths, so run them from the repository root, which must be inside your home folder or `INDESIGN_ALLOWED_DIRS`.
