# Builder brief: After Effects

Read [common.md](common.md) first. Branch `aftereffects-<slug>`; findings
`atlas-notes/aftereffects-<slug>.json`; PR title "After Effects: <epic>".

## How After Effects tools work

Tools live in `packages/aftereffects/src/tools/<area>.js` and are registered in
`src/server.js` (`AREAS`). Read first:

- `src/script.js`: the prelude. Scripts run with `app.beginSuppressDialogs()` and,
  given an `undo` label, inside one undo group. Helpers: `__json`, `__enumName`,
  `__itemType`, `__itemInfo`, `__comp(spec)`, `__layerInfo`, `__layers(comp, spec)`
  (1-based, as in the Timeline), `__prop(layer, path)`. The body assigns
  `__result__`.
- `src/args.js`: `COMP_SCHEMA`/`compSpec`, `LAYERS_SCHEMA`/`layerSpec`,
  `PROPERTY_SCHEMA`/`propertyPath` (a shortcut such as `position`, or a path of match
  names or names), `COLOR_SCHEMA`/`colorValue` (0–1 floats in scripts),
  `propertyValue`.
- `src/data/effects.json`: the effect catalogue (display name, match name, category,
  controls), generated from the atlas by `scripts/update-effects.js`.
- Examples: `src/tools/animation.js`, `effects.js`, `effect-controls.js`,
  `layers.js`.
- Paths: `paths.validate()` from `src/tools/project.js`
  (`AFTEREFFECTS_ALLOWED_DIRS`), then `jsxPath()`.

Conventions: seconds; pixels from the composition's top-left; layers 1-based; project
items by id.

## Rules for After Effects scripts

- ES3 only; object-model names from the After Effects 26.0 typings
  (`tests/audit.js`, `corpus/aftereffects/api/`). Mixed-case enum members
  (`ToolType.Tool_Rotate`, `PREFType`) are accepted.
- Effects: `layer.property("ADBE Effect Parade").addProperty(matchName)`. Match
  names from the catalogue or the scripting guide; where none is published, look up
  by display name at run time (note it only works in English installs).
- Menu commands: `app.executeCommand(id)` with ids from
  `corpus/aftereffects/commands/commands.json`, never one that opens a dialog. Ids
  5000–5999 and negative ids are install-specific: use
  `app.findMenuCommandId(name)`.
- Preferences: only keys the scripting guide documents.
- Long renders block until they finish; mention it in the description.
