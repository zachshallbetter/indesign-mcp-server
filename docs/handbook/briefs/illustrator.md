# Builder brief: Illustrator

Read [common.md](common.md) first. Branch `illustrator-<slug>`; findings
`atlas-notes/illustrator-<slug>.json`; PR title "Illustrator: <epic>".

## How Illustrator tools work

Tools live in `packages/illustrator/src/tools/<area>.js` and are registered in
`src/server.js` (`AREAS`). Read first:

- `src/script.js`: the prelude suppresses alerts
  (`userInteractionLevel = DONTDISPLAYALERTS`) and switches to document coordinates,
  restoring both. Callers see points from the artboard's top-left, y down; helpers
  `__doc`, `__sf` (large-canvas scale factor), `__artboard`, `__toDoc`, `__len`
  convert to Illustrator's y-up document coordinates.
- `src/args.js`: targets and colours.
- Live Effects are applied as XML (`src/effects.js`); some operations (blends,
  certain path operations) run as a generated Action (`src/aia.js`, `src/action.js`).
- Paths: the package's path policy (`ILLUSTRATOR_ALLOWED_DIRS`), then `jsxPath()`.

## Rules for Illustrator scripts

- ES3 only; names from the Illustrator 2022 typings (`tests/audit.js`).
- Illustrator's object model is small: many features are reached only by
  `app.executeMenuCommand("<string>")` (strings from
  `corpus/illustrator/commands/commands.json`, never one that opens a dialog), by
  Live Effect XML, or by preference keys published scripts use.
- Panel-opening menu items and swatch-library entries are already run by the generic
  `execute_menu_command`; don't build tools for them.
- PDF bleed is uniform only (the side order of `bleedOffsetRect` is not established).
