# Status (21 October 2026)

| App | Package | Version | Published | Tools | Atlas features | Scriptable | Claimed by tools |
|---|---|---|---|---:|---:|---:|---:|
| InDesign | adobe-mcp-indesign | 2.5.0 | npm | 423 | 2,742 | 2,609 | 2,524 (92%) |
| Illustrator | adobe-mcp-illustrator | 0.9.0 | npm | 308 | 2,540 | 1,951 | 1,562 (61%) |
| Photoshop | adobe-mcp-photoshop | 0.1.0 | npm | 207 | 2,609 | 1,720 | 1,413 (54%) |
| After Effects | adobe-mcp-aftereffects | 0.1.0 | npm | 164 | 3,198 | 2,595 | 2,555 (80%) |
| Premiere Pro | adobe-mcp-premiere | 0.1.0 | npm | 96 | 925 | 494 | 413 (45%) |
| Suite | adobe-mcp-suite | 0.3.0 candidate | not published | 2 coordinator workflows | — | — | — |
| Core | adobe-mcp-core | 0.2.0 | npm | | | | |

Suite `0.2.1` remains the published version. The working `0.3.0` candidate changes the
suite into a coordinator: it connects to standalone app MCP servers and exposes the two
InDesign/Illustrator workflows. Direct app tools remain in their standalone servers.
The MCPRush listing should report only those two coordinator tools.

"Scriptable" counts features whose atlas route is the object model, a menu command,
the Action Manager, the UXP API (Premiere Pro) or a recorded Action. Most of the gap between scriptable and
claimed is now features recorded as findings (no unattended route) plus the
deliberately unticketed items below. Every claimed feature is **statically tested**
(the audit checks each script against the object model); **none is validated**
against the real applications yet, because none was installed on the machine these
were built on.

## Planned work, all closed

Every epic and ticket on GitHub for these rounds is closed (label `epic` plus the app
label):

- Illustrator: 19 epics, issues #19–#128.
- InDesign: 18 epics, 72 tickets, issues #152–#241.
- After Effects: 10 epics, 31 tickets, issues #266–#306.
- Photoshop: 10 epics, 30 tickets, issues #319–#358.
- Premiere Pro (UXP round): 4 epics, 16 tickets, issues #372–#391.

## Deliberately not ticketed

- **Illustrator**: panel-opening menu items, swatch-library menu entries (the generic
  `execute_menu_command` runs them), tool-picker features with no scripted
  equivalent, help and account menus, cloud integrations.
- **Photoshop**: 433 features are still route `unknown` (down from 710); 3D features
  are route `none` (removed from Photoshop). About 300 newly routed features (mostly
  Action Manager) have no tool yet: material for the next round. Research leads and
  the ids not yet reached are in the work folder (`ps-proposals/remaining-unknown.json`).
- **After Effects**: 191 `unknown` (down from 331), mostly preferences without a
  documented key, aerender options, parametric meshes (26.3, not yet in the typings)
  and colour. Notes in the work folder (`resume-ae-research.md`).
- **Premiere Pro**: every feature the UXP API reaches is claimed; the rest are
  ExtendScript/QE-only (route `dom`, with a "Not reachable through UXP" note), `none`
  or `unknown` (246).

## Unverified, to check first on a machine with the applications

Each PR lists what its author was unsure of; the biggest groups:

- **Photoshop Action Manager descriptors** taken from community recordings or
  memory: Camera Raw filter version keys (recorded from Camera Raw 18.2.2), Render
  Video (its dialog may still appear on 2023+), gradient and pattern fill keys,
  artboard background codes, stack modes, Blur Gallery, Neural Filters output.
- **InDesign menu-action ids** from the CS5-era list (panel commands especially).
- **After Effects** control names from help-page labels, Layer Styles group name,
  shape-operator menu values, render-setting names, Team Projects availability.
- **Premiere Pro UXP** semantics: `createMoveAction` offsets, `Keyframe.position`
  reference, `exportSequenceFrame` arguments, whether `lockedAccess` is synchronous.
- **Illustrator** PDF bleed side order (only uniform bleed is exposed).

## Next

1. Validation passes on real installs, starting with the lists above; the atlas has
   a `validated` state per feature for recording the results.
2. A Photoshop round for the newly routed Action Manager features.
3. Finish researching the remaining `unknown` routes (Photoshop, After Effects,
   Premiere Pro preferences).
