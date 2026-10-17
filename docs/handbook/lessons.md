# Lessons

Problems met while building this repository, and what fixed them.

## Applications and scripting

- **Illustrator's AppleScript `do script` plays an Action**, not a script. Use
  `do javascript` on macOS and `DoJavaScriptFile` on Windows.
- **After Effects has no COM interface on Windows.** The core executor's `winRun`
  hook runs `AfterFX.exe -r` with a wrapper script that writes the result to a file,
  which the server polls.
- **Premiere Pro has no external script route at all**: no AppleScript dictionary, no
  COM, and `/C es.processFile` works only at launch and returns nothing. A UXP plugin
  can only be a WebSocket *client*, so the MCP server listens and the plugin dials
  out. CEP is being retired (no new Marketplace submissions from Dec 2027, off by
  default Dec 2028, removed Dec 2029), so the server is UXP only. Since 26.3, edits
  must be built inside `lockedAccess` and run with `executeTransaction`.
- **Photoshop's typings lack the global `charIDToTypeID`, `stringIDToTypeID` and
  `executeAction`**: use the `app.` forms. `LabColor` fields are `L`, `A`, `B`.
  Action Manager descriptor keys are mostly undocumented: take them from the atlas's
  cited recordings, prefer stringIDs, always pass `DialogModes.NO`, and say what you
  were unsure of.
- **After Effects enums with mixed-case members** (`PropertyValueType`, `ToolType`,
  `PREFType`) were rejected by the audit; the core audit now accepts them. Use
  `isSpatial` rather than mixed-case `PropertyValueType` names where possible.
- **After Effects menu ids 5000–5999 and negative Effect-menu ids are
  install-specific**; look them up with `app.findMenuCommandId(name)`.
- **InDesign 2025–2026 members aren't in the 2023 typings.** Set them by name, check
  the version first, and list them in the audit's allowed names.
- **An InDesign module area whose id equals a legacy help category** used to hide the
  legacy tools; `helpHandlers.js` now merges them. Prefer distinct area ids anyway
  (`layout_tools`, not `layout`).

## Building in parallel

- **Duplicate tool names** came up four times (`manage_notes`, `set_inks`,
  `sample_color`, `create_fill_layer`). The suite test catches them; tell every
  builder to check names against all of `main` and to run `npm test --workspaces`.
  Keep the richer tool and move the other's features onto it.
- **Shared tables invite conflicts**: give one builder each table, and keep shared
  helper changes minimal and additive.
- **Tests that pin an exact `features` list break** when another area adds an id;
  test for inclusion.
- **The attribution check matched "Keyframe Assistant"**, an After Effects menu;
  `resolve-land.sh` allows it. MCP client names in install docs ("Claude Code",
  "claude mcp add") are allowed the same way.
- **"socket hang up" in the Premiere bridge test** (a second server taking over the
  port) was Node's keep-alive agent reusing a socket to the first server after it
  stopped: the reset hid that the port was free. The bridge now opens a fresh
  connection per request (`agent: false`), so takeover sees ECONNREFUSED.

## Machines and files

- **`/tmp` (and `/private/tmp`) is wiped on reboot.** Plans, state, findings and
  scripts kept there were lost once and rebuilt from GitHub issues. Keep the work
  folder next to the worktrees.
- **`git worktree remove --force` deleted the main checkout** once: a worktree path
  in the cleanup list was a symlink to `~/Projects/adobe-mcp`, and the removal
  followed it, taking ignored files with it, with no Trash copy. Skip symlinks, never
  use `--force`, and move worktrees to the Trash, then `git worktree prune`.
- **`~/Projects/adobe-mcp` is itself a worktree** of `~/Projects/indesign-mcp-server`
  (the repository's original clone). Add new worktrees from either; they share one
  object store.
- **Concurrent `git fetch` in several worktrees** can fail on a ref lock; retry after
  a moment.

## Research for the atlas

- **helpx.adobe.com and adobe.com refuse direct downloads (403), and the Wayback
  Machine rate-limits (429) after a few requests.** Common Crawl captures and the
  Portuguese web archive (arquivo.pt, `https://arquivo.pt/noFrame/replay/<timestamp>id_/<url>`)
  serve the help pages; cite the original helpx URL.
- **Researchers overlap**: after parallel research, merge duplicate feature records
  across domain files (same name and meaning), keeping the one the taxonomy assigns.
- **Only `https://` sources are citations**; builders sometimes cite local corpus
  paths, which the validator rejects.

## Releases

- **Tags must be annotated** (`tag.gpgsign` is on).
- **The first npm publish needs the owner's two-factor approval**; everything after
  is OIDC.
- **The suite pins exact app versions**: bumping an app without the suite makes the
  workspace install the published copy of the old version for the suite.
- **Transient signing errors** in the release job pass on re-run.
