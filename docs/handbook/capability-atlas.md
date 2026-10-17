# The capability atlas

`adobe-capability-atlas` is a private repository (github.com/zachshallbetter/adobe-capability-atlas)
expected next to this one (`../adobe-capability-atlas`). It is the inventory every
tool's `features` refer to: what each application can do, how a script can reach each
feature, and how much the servers here cover, with a source for each claim. Its own
`docs/handbook/` folder explains how to research and extend it; this page covers how this
repository uses it.

## What it holds, per application (`corpus/<app>/`)

| Layer | Path | Use here |
|---|---|---|
| Features | `features/<domain>.json`, `taxonomy.json` | Feature ids (`<app>.<domain>.<feature>`), names, menu paths, and the **automation route**: `dom`, `menu_command`, `action_manager` (Photoshop), `action`, `native_sdk`, `uxp` (Premiere Pro: the UXP API, members in `uxp_refs`), `none` (established as not automatable), `unknown`. Notes and `dom_refs`/`event_ids` tell you how to reach it. |
| API | `api/` | The object model from types-for-adobe, per version where available. |
| Commands | `commands/commands.json` | Menu command ids/strings and Photoshop Action Manager events, with `opens_dialog` where known. Unverified until run. |
| Limitations | `limitations/` | How automation fails and the workaround. |
| Surfaces | `surfaces/` | What AppleScript, COM, UXP, CEP and the SDK reach. |
| Community scripts | `scripts/` | Object-model names and commands published scripts use (names only). |
| Capabilities | `capabilities/tools.json` | Generated from this repo's tools: names, features claimed, members used, tested state. |

Apps: InDesign, Illustrator, Photoshop, After Effects, Premiere Pro. Workflows
(`corpus/workflows/`) span applications.

## How this repository uses it

- **Feature ids**: tools claim them in `features`; each package's
  `tests/fixtures/feature-ids.json` is a snapshot of the atlas ids so tests run
  without the atlas. Regenerate it when the atlas gains ids (`scripts/update-feature-ids.js`).
- **Planning**: epics and tickets are generated from the atlas features that have a
  scripting route but no tool yet ([workflow.md](workflow.md)).
- **Routes and refs**: when writing a tool, read the feature's record for its route,
  `dom_refs`, `event_ids`, menu path and notes.

## Findings flow back

When a ticket's feature can't be reached unattended (a dialog-only command, a tool
that needs a person on the canvas, a removed feature), the builder records it as a
**finding**: `[{ "id", "route", "reason", "sources": ["https://…"] }]` in
`<work>/atlas-notes/<app>-<slug>.json`. Route `none` means nothing reaches it
unattended; a kept route with a reason records a limit on a claimed feature. Sources
must be `https://` URLs (local paths are not citations).

After the PR lands, the coordinator applies them to the atlas:

```bash
APP=<app> node docs/handbook/scripts/apply-notes.mjs <work>/atlas-notes/<app>-*.json
```

then regenerates the app's capabilities from the merged code and validates:

```bash
cd ../adobe-capability-atlas
node scripts/extract/<app>-tools.mjs ../adobe-mcp/packages/<app>
node scripts/validate.mjs            # must print "valid"
node scripts/report.mjs && node scripts/atlas-data.mjs && node scripts/report-html.mjs
```

InDesign's legacy tools have their features curated in the atlas
(`capabilities/tools.json`), so claims for them come as a claims file
(`[{ "tool", "feature" }]`) merged into that file; module tools declare their own.

## Coverage page

`reports/coverage.html` in the atlas is the coverage page for all five applications
(support ladder, routes, domains, commands, limitations, surfaces). It is rebuilt by
`node scripts/atlas-data.mjs && node scripts/report-html.mjs` and published as a
private page; the atlas `docs/handbook/README.md` has the publishing steps.
