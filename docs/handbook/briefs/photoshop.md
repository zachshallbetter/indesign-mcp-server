# Builder brief: Photoshop

Read [common.md](common.md) first. Branch `photoshop-<slug>`; findings
`atlas-notes/photoshop-<slug>.json`; PR title "Photoshop: <epic>".

## How Photoshop tools work

Tools live in `packages/photoshop/src/tools/<area>.js` and are registered in
`src/server.js` (`AREAS`). Read first:

- `src/script.js`: the prelude. Scripts run with `app.displayDialogs = DialogModes.NO`
  and ruler and type units in pixels, all restored afterwards. Helpers: `__json`,
  `__doc()`, `__px`, `__enumName`, `__bounds`, `__layerInfo`, `__eachLayer`,
  `__layerById`, `__targets(doc, spec)`, `__color(spec)`, `__colorInfo`,
  `__docInfo`. The body assigns `__result__`.
- `src/args.js`: `TARGET_SCHEMA` (layer ids, names, or the active layer),
  `COLOR_SCHEMA` (`#RRGGBB`, `rgb()`, `cmyk()`, `gray()`, `hsb()`, `lab()`).
- Action Manager helpers: `src/action-manager.js`, `src/actions.js`, `src/am.js`
  (shared by several areas; reuse rather than adding another).
- Examples: `src/tools/adjust.js` (the ADJUSTMENTS and FILTERS tables: one tool,
  many entries, each listing its own features), `layers.js`, `video.js` (all Action
  Manager), `history.js`.
- Paths: `paths.validate()` from `src/tools/documents.js` (`PHOTOSHOP_ALLOWED_DIRS`),
  then `jsxPath()`.

Conventions: pixels from the document's top-left; layers by id, name or active.

## Rules for Photoshop scripts

- ES3 only (see common rules).
- Use the DOM where it has the feature; otherwise the **Action Manager**:
  `app.executeAction(app.stringIDToTypeID("event"), desc, DialogModes.NO)` with
  `ActionDescriptor`, `ActionReference`, `ActionList`. Use the `app.` forms of
  `charIDToTypeID`, `stringIDToTypeID`, `executeAction` and `executeActionGet`; the
  globals aren't in the typings (Photoshop 2015.5, `tests/audit.js`).
- Event ids and descriptor keys: the feature record's `automation.event_ids` and
  notes, `corpus/photoshop/commands/commands.json`, and the sources the atlas cites
  (Alchemist, Adobe's UXP event docs, published scripts). Prefer stringIDs over
  charIDs. Report every key you took from memory.
- Menu items: `app.runMenuItem(app.stringIDToTypeID("..."))`, or a numeric id only
  when the atlas lists it and it opens no dialog.
- `LabColor` fields are `L`, `A`, `B`.
- Generative features need a signed-in account and the network: mark them
  `openWorld`.
