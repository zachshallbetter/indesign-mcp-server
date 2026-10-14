# adobe-mcp-core

The shared foundation for MCP servers that drive desktop Adobe applications
through ExtendScript: illustrator-mcp-server, and
[indesign-mcp-server](https://github.com/zachshallbetter/indesign-mcp-server),
whose infrastructure it was extracted from.

Each server keeps what is specific to its application: tool definitions,
handlers, enum lists, server instructions, and how the application is told to
run a script file. Everything else lives here, so a fix to escaping, path
checks, result handling or the script runner reaches every server at once.

## What it provides

| Module | Purpose |
|---|---|
| `str`, `num`, `index`, `bool`, `enumOf`, `json`, `numList`, `measure` | Turn caller input into safe ExtendScript literals. ExtendScript is not sandboxed, so no caller value is ever interpolated raw. |
| `createPathPolicy({ envVar })` | Confine file paths to the home folder plus the directories in `envVar`, and never a system directory. |
| `wrapScriptForStructuredResult`, `parseStructuredResult` | Make any script evaluate to `{"ok":…,"result"|"error":…}` using only ES3, and parse it back. |
| `looksLikeFailure`, `createFailureDetector`, `formatResponse` | One result shape; failure strings ("No document open", "Error …") become `success: false`. |
| `createArgNormalizer` | Canonical parameter names, deprecated aliases with warnings, and "did you mean" for unknown arguments. |
| `createAnnotations` | MCP tool annotations from explicit read-only, destructive, idempotent and open-world lists. |
| `createExecutor(app)` | Run a script in the application: AppleScript on macOS, COM through PowerShell on Windows, optional extra backends. |
| `createMcpServer` | The stdio server: `tools/list`, `tools/call`, alias mapping, warnings, error results. |
| `adobe-mcp-core/testing` | The static script audit: run every tool with sample arguments against a stubbed executor, then check each generated script parses as ES5 and uses only names in the application's type definitions. |

## The executor

```js
import { createExecutor, appleScriptString, powerShellString } from 'adobe-mcp-core';

export const executor = createExecutor({
    label: 'Illustrator',
    envPrefix: 'ILLUSTRATOR',              // ILLUSTRATOR_APP_NAME, ILLUSTRATOR_SCRIPT_TIMEOUT_MS, ILLUSTRATOR_BACKEND
    appNamePrefix: 'Adobe Illustrator',
    defaultAppName: 'Adobe Illustrator',
    macScript: ({ scriptPath }) => `do javascript (POSIX file ${appleScriptString(scriptPath)})`,
    winProgIds: ['Illustrator.Application'],
    winInvoke: ({ scriptPath }) => `$app.DoJavaScriptFile(${powerShellString(scriptPath)})`,
    winProcessName: 'Illustrator.exe',
});

const name = await executor.runScript('app.activeDocument.name;');
const { ok, result, error } = await executor.runStructured('app.documents.length;');
```

- Scripts go to the application as a temporary `.jsx` file, removed afterwards.
- Processes start with `execFile`, never a shell, and never block the event loop.
- Every run has a timeout (`<PREFIX>_SCRIPT_TIMEOUT_MS`, default 120 s). On
  timeout the error says a dialog may be open in the application, which is the
  usual cause.
- `backends` adds alternatives to ExtendScript, such as InDesign's UXP bridge.
  `<PREFIX>_BACKEND=auto` uses the first available one and falls back to
  ExtendScript only when the backend could not have run the script.

## The server

```js
import { createMcpServer } from 'adobe-mcp-core';

const mcp = createMcpServer({
    info: { name: pkg.name, version: pkg.version },
    instructions: SERVER_INSTRUCTIONS,
    tools,                                  // definitions with title and annotations
    handlers: { get_document_info: getDocumentInfo, /* one per tool */ },
    aliases: [{ old: 'strokeWidth', canonical: 'strokeWeight' }],
});
await mcp.run();
```

Construction fails if an advertised tool has no handler.

## Tests

```bash
npm test        # node --test
npm run check   # syntax check of src/
```

## Licence

MIT. See [LICENSE](LICENSE).
