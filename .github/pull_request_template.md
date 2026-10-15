## What changed

<!-- The tool(s) affected and why. -->

## Checklist

- [ ] `npm test` passes (unit, protocol, script audit, path confinement, tool reference check)
- [ ] New or changed tools follow the package's CONTRIBUTING.md (InDesign: definition, handler, entry in `TOOL_HANDLERS`, and annotations in `src/types/annotations.js`)
- [ ] `npm run docs:tools` run if any tool definition changed
- [ ] Tested against the running application (InDesign: `npm run test:integration -w packages/indesign`, or by hand): app and version ______ on ______
- [ ] The package's changelog updated
