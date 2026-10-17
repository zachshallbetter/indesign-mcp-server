# Builder brief: InDesign

Read [common.md](common.md) first. Branch `indesign-<slug>`; findings
`atlas-notes/indesign-<slug>.json`; PR title "InDesign: <epic>".

## How InDesign module tools work

New tools are **modules**: `packages/indesign/src/tools/<area>.js` exports `tools`.
Register a new area in `src/tools/index.js` (`AREAS`: `[id, tools, { name,
description }]`, the last being its help category; choose an id that isn't an
existing help category, or its tools merge into that category). Don't rewrite the
legacy handlers (`src/handlers/*.js`, `src/types/toolDefinitions*.js`); add modules
beside them. Read first:

- `src/tools/script.js`: the prelude. Scripts run with dialogs off (`NEVER_INTERACT`)
  and `scriptPreferences.measurementUnit` millimetres, both restored. Helpers:
  `__json`, `__doc`, `__enumName`, `__page(doc, i)`, `__pageOf(item)`,
  `__toPage(page, x, y)` (page-relative mm to document coordinates), `__itemInfo`,
  `__item(doc, id)`, `__targets(doc, spec)`, `__swatch(doc, spec)`.
- `src/tools/run.js`: `run(label, source)`, `TARGET_SCHEMA`/`targetSpec` (items by
  `PageItem.id`, name or selection), `COLOR_SCHEMA`/`colorSpec`.
- Existing areas (28) for examples and helpers to reuse: `paragraph.js` exports
  `TEXT_HELPERS`, `tables.js` exports its text-location helper.
- Paths: `validateFilePath()` from `src/utils/jsxSafe.js`, then `jsxPath()`.

List every existing name before naming a tool:
`node -e "import('./src/types/index.js').then(m => console.log(m.allToolDefinitions.map(t => t.name).join('\n')))"`.

Conventions: millimetres from the item's page top-left (geometricBounds are
`[top, left, bottom, right]`); point sizes and stroke weights in points; pages
0-based; items by id.

## Rules for InDesign scripts

- ES3 only; names from the 2023 object model
  (`~/Projects/adobe-capability-atlas/corpus/indesign/api/object-model.json`) and
  `api/versions/` (2023–2026). The audit (`tests/audit/scripts.audit.js`) rejects
  unknown names; it allows the helper spec fields in `ALLOWED_NAMES`. Members added in
  2025–2026 are set by name after a version check and listed there.
- Menu actions (`app.menuActions.itemByID(n).invoke()`): only ids in
  `corpus/indesign/commands/commands.json` (mostly from a CS5-era list, unverified),
  never one that opens a dialog. Check `enabled` first and fail clearly.
- Most features are properties of a preferences object, style or item: set them
  directly.
- Regenerate the tool reference: `node scripts/generate-tool-reference.js`.

## Claims for existing (legacy) tools

Legacy tools' features are curated in the atlas, not in code. If an existing legacy
tool already performs a feature in your tickets, don't change the tool: write
`[{ "tool": "<name>", "feature": "<id>" }]` to
`~/Projects/adobe-mcp-wt/_coord/indesign-claims/<slug>.json`.
