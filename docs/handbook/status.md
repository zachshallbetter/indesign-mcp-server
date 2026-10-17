# Status (16 October 2026)

| App | Package | Version | Published | Tools | Atlas features | Scriptable | Claimed by tools |
|---|---|---|---|---:|---:|---:|---:|
| InDesign | adobe-mcp-indesign | 2.5.0 | npm, MCP Registry | 423 | 2,742 | 2,609 | 2,524 (92%) |
| Illustrator | adobe-mcp-illustrator | 0.9.0 | npm, MCP Registry | 308 | 2,540 | 1,951 | 1,562 (61%) |
| Photoshop | adobe-mcp-photoshop | 0.1.0 | **not yet** | 205 | 2,609 | 1,456 | 1,413 (54%) |
| After Effects | adobe-mcp-aftereffects | 0.1.0 | **not yet** | 164 | 3,198 | 2,559 | 2,555 (80%) |
| Premiere Pro | adobe-mcp-premiere | 0.1.0 | **not yet** | 52 | 925 | 475 | 222 (24%) |
| Suite | adobe-mcp-suite | 0.1.7 | npm (InDesign + Illustrator) | all, prefixed | | | |
| Core | adobe-mcp-core | 0.2.0 | npm | | | | |

"Scriptable" counts features whose atlas route is the object model, a menu command,
the Action Manager or a recorded Action. Most of the gap between scriptable and
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

## Deliberately not ticketed

- **Illustrator**: panel-opening menu items, swatch-library menu entries (the generic
  `execute_menu_command` runs them), tool-picker features with no scripted
  equivalent, help and account menus, cloud integrations.
- **Photoshop**: 710 features are route `unknown`; 3D features are route `none`
  (removed from Photoshop).
- **After Effects**: 331 `unknown`, mostly undocumented preferences.
- **Premiere Pro**: no second round yet. Its atlas routes describe the ExtendScript
  object model, while the server uses UXP; the next round should first record which
  features the UXP API reaches (13 claimed features already sit at route `unknown`
  for this reason) and then plan from that.

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

1. The owner publishes Photoshop, After Effects and Premiere Pro to npm
   ([releasing.md](releasing.md)), then core and the suite are released.
2. Validation passes on real installs, starting with the lists above; the atlas has
   a `validated` state per feature for recording the results.
3. A Premiere Pro UXP coverage pass in the atlas, then a ticketed round.
4. Research the `unknown` routes for Photoshop and After Effects.
5. A flaky Premiere bridge test (port takeover) to harden.
