# Premiere Pro MCP Server

An MCP server that drives Adobe Premiere Pro: projects and bins, sequences and
their settings, timeline edits, markers, effects, keyframes and transitions,
transcripts, metadata and export. It runs on the machine where Premiere Pro is
installed and talks to it through a small UXP plugin inside Premiere Pro.

**Status: untested against a real Premiere Pro.** Every script is checked
against Premiere Pro's UXP API reference and run against a stand-in DOM in the
tests, but none has been run in Premiere Pro yet. Expect rough edges; see
[What is not certain yet](#what-is-not-certain-yet).

Requires Premiere Pro 25.6 or later (macOS or Windows), the UXP Developer Tool
to load the plugin, and Node.js 18 or later.

## Why a plugin

Premiere Pro has no outside scripting route the other servers in this
repository use: no AppleScript dictionary, no COM object on Windows, and its
`/C es.processFile` command line works only while Premiere Pro launches,
returns no result and is unsupported. Adobe's supported way to automate
Premiere Pro is a plugin running inside it, and UXP is the plugin platform
Adobe is moving to (generally available from Premiere Pro 25.6; CEP stops
taking new Marketplace submissions in December 2027 and is removed from
December 2029).

A UXP plugin can open WebSocket connections but cannot accept them. So this
server listens on `127.0.0.1` and the plugin connects to it:

```
MCP client --stdio--> adobe-mcp-premiere --ws://127.0.0.1:3011--> MCP Bridge panel (in Premiere Pro)
```

There is one process to run: the MCP server is also the WebSocket server.

## Install

1. Add the server to your MCP client.

   Claude Code:

   ```bash
   claude mcp add premiere -- npx -y adobe-mcp-premiere
   ```

   Any client that reads an `mcpServers` block:

   ```json
   {
     "mcpServers": {
       "premiere": {
         "command": "npx",
         "args": ["-y", "adobe-mcp-premiere"],
         "env": { "BRIDGE_TOKEN": "a long random string" }
       }
     }
   }
   ```

2. Load the plugin in Premiere Pro. Until it is published, load it with the
   UXP Developer Tool:

   - In Premiere Pro, turn on Developer Mode in the Plugins settings.
   - Install and open the UXP Developer Tool from the Creative Cloud app.
   - **Add Plugin** and choose `uxp/plugin/manifest.json` from this package: in a
     clone, `packages/premiere/uxp/plugin`; after `npm install adobe-mcp-premiere`,
     `node_modules/adobe-mcp-premiere/uxp/plugin`. `premiere_status` prints the
     folder of the copy your server runs from.
   - Click **Load**, then open the **MCP Bridge** panel from Premiere Pro's Window menu.

3. In the panel, set the port (3011 unless you changed `PREMIERE_WS_PORT`) and
   the token (if you set `BRIDGE_TOKEN`), and click **Connect**. The panel
   remembers both and reconnects every 3 s whenever the connection drops, so
   it connects again by itself after the MCP server restarts.

4. Ask your client to run `premiere_status`. It shows the port, whether the
   plugin is connected, the Premiere Pro version and the active project.

## Conventions

- **Sequences** are chosen with `sequence`: `{ name }`, `{ guid }` (from
  `list_sequences`), or omitted for the active sequence.
- **Project items** are chosen with `item`: `{ id }` (from
  `list_project_items`), `{ path: "Footage/Interviews/a.mov" }` (bins from the
  project root), or `{ name }` when only one item has that name.
- **Clips in a sequence** are chosen with `clip: { track, trackIndex,
  clipIndex }`, as `list_clips` reports them: `track` is `video` or `audio`,
  indexes start at 0 (track 0 is V1 or A1). Tools that take several clips take
  `clips: { items: [...], selected: true }`, where `selected` adds the clips
  selected in the Timeline. Indexes shift after edits; list again.
- **Effects** are chosen by component index and parameter name (or index) from
  `list_clip_effects`.
- **Times** are seconds. **Files** must be absolute paths inside your home
  folder or a directory in `PREMIERE_ALLOWED_DIRS`; tools that write a file
  refuse to replace an existing one unless you pass `overwrite: true`.

## Tools

| Area | Tools |
|---|---|
| Project | `get_project_info`, `create_project` (empty or from a template), `open_project` (dialogs off), `save_project` (or Save As), `close_project` (or all projects), `revert_project`, `list_project_items` (or the Project panel selection), `search_project_items` (name, media path, kind, offline), `get_clip_info` (media path, in/out, offline, proxy, footage interpretation), `import_media` (any importable format, into a bin, image sequences), `create_bin` (or a search bin), `manage_items` (rename, move to a bin, label colour, delete) |
| Media | `import_project_sequences` (chosen sequences from another project), `import_after_effects_comps` (Dynamic Link), `relink_media` (one clip, or offline clips by file name), `manage_media` (refresh, make offline, attach proxy or full-resolution media), `modify_footage` (interpret footage, timecode, scale to frame size), `reveal_media_file` (Finder or Explorer), `get_project_media_settings`, `set_project_media_settings` (ingest, scratch disks, growing files) |
| Sequences | `list_sequences`, `create_sequence` (default settings, a `.sqpreset`, or from clips), `open_sequence`, `get_sequence_settings`, `set_sequence_settings` (frame size, frame rate, pixel aspect, fields, editing mode, display formats, sample rate, previews, bit depth, render quality, linear colour), `duplicate_sequence`, `delete_sequence`, `close_sequence`, `create_subsequence` (Make Subsequence), `set_sequence_times` (in/out, zero point, work area, playhead), `move_playhead` (frames, edit points, gaps, markers, in/out), `run_scene_edit_detection` (cuts, markers or subclips), `get_sequence_properties`, `set_sequence_properties` (custom properties)|
| Timeline | `list_tracks` (video, audio, caption), `list_clips` (or find by name), `insert_clip`, `overwrite_clip` (optionally a source range), `trim_clip` (source in/out, sequence start/end), `edit_clips` (slip, roll, slide, trim to playhead), `select_clips` (given clips, all, none, at the playhead, forward, backward, next, previous), `fit_clips_to_frame` (Set to Frame Size), `move_clips`, `remove_clips` (Clear or Ripple Delete), `set_clip_properties` (name, enable), `set_track_properties` (mute, rename), `insert_mogrt` |
| Markers | `list_markers`, `add_marker`, `edit_marker` (name, comments, type, duration, colour, move), `remove_markers` (sequence or clip markers), `mark_clips` (Mark Clip, Mark Selection) |
| Source | `create_subclip`, `set_source_in_out` (set or clear), `scale_to_frame_size`, `control_source_monitor` (open, play, close, Match Frame) |
| Effects | `list_available_effects` (video effects, audio effects, video transitions), `list_clip_effects`, `apply_effect` (video by match or display name, audio by display name), `remove_effect`, `set_effect_param`, `add_keyframes` (with interpolation), `remove_keyframes`, `add_transition` (start, end or both; duration; single-sided), `remove_transition` |
| Audio | `set_clip_volume` (the Volume effect's Level) |
| Transcripts | `transcribe_clip`, `export_transcript` (returned or written to `.json`) |
| Export | `export_sequence` (encoder preset; now, to Media Encoder's queue, or Premiere Pro's queue; full or in to out; XMP; import the result), `encode_media` (a project item or a media file to Media Encoder's queue), `export_frame` (PNG, JPEG, TIFF, DPX, EXR, ...), `export_timeline` (Final Cut Pro XML, OpenTimelineIO, AAF) |
| Metadata | `get_metadata` (project metadata and XMP), `set_metadata`, `get_metadata_display` (Project panel columns), `set_metadata_display` (columns, new schema fields) |
| Application | `wait_for_event` (project, sequence, Media Encoder, export and import events), `clear_media_cache`, `recover_project` (Auto-Save copies after a crash) |
| Utility | `premiere_status`, `execute_premiere_code`, `help` |

`help({ tool })` describes any tool's parameters.

Most tools work with Premiere Pro 25.6. These need a later version, and say so
in their descriptions: `export_timeline` (26.2; AAF 26.3), renaming a track
(26.3), `export_sequence`'s `startQueue` and `xmp` (26.3), the frame rate in
`set_sequence_settings` (26.2), `close_sequence` (26.2), `create_subclip` (26.3), positioning the Source Monitor (26.3), the work area in `set_sequence_times` (26.5),
`transcribe_clip` and `clear_media_cache` (26.5). On an older version those calls fail with a message
naming the version.

Not offered, because Premiere Pro's UXP API has no call for them: linking and
unlinking clips, audio transitions, playing the Program Monitor, clip speed, clip gain (other than the
Volume effect's Level), editing caption text, track targeting, nesting, menu
commands, and undo.

## How it stays out of your way

- **One undo step per call.** Edits are built inside `project.lockedAccess` and
  run with `project.executeTransaction`, as Premiere Pro requires from 26.3, so
  each call is one entry in Edit > Undo. The few steps Premiere Pro does not
  record (playhead, track mute, work area, saving) say so.
- **No dialogs.** Opening and closing projects turn Premiere Pro's prompts off;
  importing passes `suppressUI`.
- **One script at a time.** The plugin runs scripts in order, never two at once.
- **Timeouts say why.** If Premiere Pro does not answer within
  `PREMIERE_SCRIPT_TIMEOUT_MS` (default 120 s), the error says a dialog may be
  open. Raise it for long exports and transcriptions.
- **No raw input in scripts.** Every value a caller passes is validated and
  written into the script as a JSON literal.

## Configuration

| Variable | Purpose |
|---|---|
| `PREMIERE_WS_PORT` | Port on `127.0.0.1` the plugin connects to. Default 3011. Set the same port in the panel. |
| `BRIDGE_TOKEN` | A shared secret. When set, the plugin must send it to connect; enter it in the panel. `PREMIERE_BRIDGE_TOKEN` takes precedence if you need a different token from the InDesign bridge. |
| `PREMIERE_ALLOWED_DIRS` | Extra directories for importing, saving and exporting (`:`-separated on macOS, `;` on Windows). |
| `PREMIERE_SCRIPT_TIMEOUT_MS` | How long to wait for a script. Default 120000. |
| `PREMIERE_CONNECT_WAIT_MS` | How long a call waits for the plugin to connect before failing. Default 4000. |

## Security

- **Local only.** The server listens on `127.0.0.1`, never on other interfaces.
- **Token.** Without `BRIDGE_TOKEN`, any program on this machine can connect to
  the port as the plugin while none is connected (and would then receive the
  scripts and could answer them), and can send scripts through the HTTP
  endpoint described below. Set `BRIDGE_TOKEN` on any machine other people or
  untrusted software use. With a token, the plugin's first message must carry
  it (a wrong token closes the connection with code 4001, no message within
  5 s with 4002), and the HTTP endpoints require `Authorization: Bearer
  <token>`. Tokens are compared in constant time.
- **One plugin.** While a plugin is connected, any other connection is closed
  with code 4009, even with the right token.
- **No web pages.** HTTP requests that carry an `Origin` header (that is, from a
  browser page) are refused.
- **What the plugin can do.** The panel runs whatever the server sends, with the
  plugin's permissions: the Premiere Pro DOM and network access (the manifest
  allows all domains because the port is configurable; the plugin itself only
  connects to `127.0.0.1`). It asks for no file-system permission: Premiere Pro
  reads and writes files itself, at paths the server has checked.
  `execute_premiere_code` runs your own code unrestricted.
- The panel stores the token in its `localStorage`, in plain text.

## Two MCP clients at once

Each MCP client starts its own copy of the server, but only one process can
listen on the port. The first one listens; a later one finds the port held by
another copy of this server (it asks `GET /status`) and forwards its scripts
to it over HTTP (`POST /execute`, with the token). Scripts from both clients
then run one at a time through the one plugin connection. If the first server
exits, the next call from the other takes the port over and waits up to
`PREMIERE_CONNECT_WAIT_MS` for the panel, which reconnects within 3 s.

If the port is held by some other program, calls fail with a message saying
so: choose another `PREMIERE_WS_PORT` and set it in the panel too. A second
copy with a different token is told the tokens differ.

Inside `adobe-mcp-suite` the port opens on the first Premiere Pro call rather
than at startup.

## What is not certain yet

These follow Adobe's UXP reference but have not been seen working in Premiere
Pro:

- **Project items.** Bins are told apart from clips by `FolderItem.cast` plus a
  successful `getItems()`, and sequences by `ClipProjectItem.isSequence()`. The
  numeric `ProjectItem.type` is reported as-is because its values are not
  documented.
- **Moving clips.** `move_clips` passes the offset to `createMoveAction`, which
  the reference describes only by its TickTime argument.
- **Keyframe times.** `add_keyframes` sets `Keyframe.position`; whether that is
  measured from the clip or the sequence is not documented, so use the times
  `list_clip_effects` reports.
- **Volume.** `set_clip_volume` finds the Volume effect and its Level parameter
  by their English display names.
- **Exported frames.** `exportSequenceFrame` takes a file name and a folder; the
  server passes the base name and the folder separately.
- **Media.** Layered files import merged (`importFiles` has no layer option),
  and EDL, AAF and FCP XML go through `importFiles` like any file.
  `modify_footage` sets field order and alpha with the `FIELD_TYPE_*` and
  `ALPHACHANNEL_*` values the `FootageInterpretation` object carries.
  `set_project_media_settings` passes a scratch disk folder path where the
  reference names only the `ScratchDiskFolder` constants. Search bin queries
  are passed as given; their syntax is not documented.
- **Media Encoder jobs.** `encode_media` passes the range as 0 (whole), 1 (in
  to out) or 2 (work area), as Adobe's sample does; for a whole file it passes
  an invalid end time (made by dividing a TickTime by zero, which the reference
  says returns `TIME_INVALID`), as the sample passes `TickTime.TIME_INVALID`.
- **Events.** What `wait_for_event` reports about an event is whatever plain
  values the event object carries; the reference does not describe them.
- **Auto-Save copies.** `recover_project` looks for copies named after the
  project in the Auto Save scratch disk, or in "Adobe Premiere Pro Auto-Save"
  beside the project when Premiere Pro reports the default symbolically.
- **The panel's WebSocket.** Whether Premiere Pro's UXP sends an `Origin`
  header, and whether a narrower `network.domains` entry with a port would
  work, are not known; `premiere_status` shows the origin it saw.

Please report what you find, with the Premiere Pro version.

## Development

```bash
npm test         # bridge over real sockets, plugin runtime, definitions, arguments, scripts, static audit
npm run audit    # the audit alone, with findings listed
npm run check    # syntax check
```

The audit runs every tool with sample arguments and parses each script it
generates; every `ppro.<Class>`, static member, constructor and
`ppro.Constants.<Enum>.<VALUE>` must exist in `tests/fixtures/premiere-uxp-api.json`,
every other member must be a member of some UXP class or plain JavaScript, and
a tool that uses a member added after 25.6 must declare the version it needs.
The fixture lists the 67 classes the capability atlas records, with their
members and constants from Adobe's UXP for Premiere reference
(AdobeDocs/uxp-premiere-pro, Apache-2.0); `npm run fixtures` regenerates it
(see `scripts/generate-fixtures.js`). `tests/fixtures/feature-ids.json` lists the
atlas feature ids the tools may claim.
