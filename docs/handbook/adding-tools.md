# Adding tools

The short version for every application: find the atlas features you want to cover,
design a few grouped tools, write the ES3 (or, for Premiere Pro, UXP) script through
the core helpers, claim the features, add tests, run the checks. The per-application
briefs in [briefs/](briefs/) are the complete version.

## Design

- **Few tools, grouped by panel or dialog**, with enums and option objects, rather
  than one tool per property. `verb_noun` snake_case.
- **Names are unique within each app server.** Coordinator workflow names are unique
  within the suite; app tool names live on separate MCP servers and are not copied.
  Before naming a tool, list every existing name:
  `node -e` over the app's `src/tools/*.js` (and, for InDesign, `allToolDefinitions`
  in `src/types/index.js`). When two contributors add the same tool, keep the richer
  one and move the other's `features` onto it.
- **Descriptions are user-facing**: say what the tool changes and returns, and name
  the menu, panel or dialog in parentheses. Every parameter has a description.
- **Validate early**: throw a clear error for a bad argument before building a
  script.
- **`hints`**: `readOnly` if nothing changes; `destructive` if it can delete or
  overwrite work (closing without saving, quitting, deleting, running arbitrary menu
  commands or code); `idempotent` if repeating has no further effect; `openWorld` if
  it reaches beyond the local app (printing, network, generative features).
- **Extend existing tools only compatibly**: earlier calls must generate the same
  script. Adding feature ids an existing tool already performs is fine.

## Scripts

- **ES3**: `var` and `function` only; no `let`, `const`, arrows, template strings,
  classes or `JSON`. A function declared inside a block is `var f = function () {}`.
  (Template strings are fine in the Node code that builds the script.)
- **Only real object-model names**; the audit rejects anything not in the typings.
  Names your script invents (fields of your own objects) go in the package audit's
  allowed list.
- **No dialogs.** InDesign menu actions and Illustrator `executeMenuCommand` strings,
  Photoshop `runMenuItem` and After Effects `executeCommand` ids must come from the
  atlas command catalogue and must not open a modal dialog (a label ending in "…"
  usually does). Prefer the object model; if a feature's only route is a dialog,
  record it as not scriptable.
- **Restore what you change**: preferences, units, export settings, selections where
  practical.
- **Results describe the change** (ids, names, counts) so the caller needs no
  follow-up lookup.

Application specifics:

- **InDesign**: new work goes in module areas (`src/tools/<area>.js`, registered in
  `src/tools/index.js`), not the legacy handlers. Millimetres, page-relative
  positions, 0-based page indexes, items by `PageItem.id`. Regenerate
  `docs/TOOLS.md` with `node scripts/generate-tool-reference.js`. Newer (2025–2026)
  members aren't in the 2023 typings: set them by name, check the version, and add
  the names to the audit's allowed list.
- **Illustrator**: points from the artboard's top-left, y down (helpers convert).
  Many features exist only as menu commands or Live Effect XML; preference keys reach
  settings the object model doesn't list.
- **Photoshop**: the DOM first, then the **Action Manager**:
  `app.executeAction(app.stringIDToTypeID("event"), desc, DialogModes.NO)` with
  `ActionDescriptor`/`ActionReference`/`ActionList`. Use the `app.` forms of
  `charIDToTypeID`, `stringIDToTypeID`, `executeAction`, `executeActionGet`; the
  globals aren't in the typings. Event ids and descriptor keys come from the atlas
  (`automation.event_ids`, notes, `commands.json`) and the sources it cites; many are
  unverified, so say which you were unsure of. `LabColor` uses `L`, `A`, `B`.
- **After Effects**: properties by match name (`ADBE …`) or shortcut; effects with
  `addProperty(matchName)` (the package has a catalogue in `src/data/effects.json`);
  1-based layers; menu commands in the 5000–5999 range and negative ids are
  install-specific, so look them up with `app.findMenuCommandId(name)`.
  `PropertyValueType` and `ToolType` have mixed-case members; the core audit
  accepts them.
- **Premiere Pro**: async UXP JavaScript, `ppro` and `transact` in scope; members
  newer than 25.6 need `since` or a guard. No menu commands exist.

## Tests

Put tests in `packages/<app>/tests/<area>.test.js` using `tests/helpers.js`:
check the generated scripts contain the right statements (`assert.match`), and that
bad arguments are refused (`server().handleToolCall(...)` rejects). Assert that a
tool *includes* a feature rather than equals a fixed list: other areas may add ids
to the same tool.

Then run, in the package and at the root:

```bash
npm test
npm run check
cd ../.. && npm test --workspaces
```

If you claim an atlas id the fixture doesn't have, regenerate
`tests/fixtures/feature-ids.json` (`node scripts/update-feature-ids.js` where the
package has it).

## Pull requests

- Rebase on `origin/main` first; in `src/server.js` and `src/tools/index.js` keep
  every area.
- Body: the tools added, per ticket how many features are claimed by new tools, by
  existing tools, and recorded as findings, and `Closes #n` for each ticket whose
  features are all accounted for.
- Say plainly that nothing has been run in the real application, if that's the case,
  and list what you were unsure of.
