# After Effects MCP Server

An MCP server that drives Adobe After Effects: projects and footage,
compositions, layers, keyframes and expressions, effects, text, masks and the
Render Queue. It runs on the machine where After Effects is installed and talks
to it through ExtendScript, the scripting interface After Effects ships with.

Requires After Effects 2023 or later on macOS or Windows, and Node.js 18 or later.

## Install

Claude Code:

```bash
claude mcp add aftereffects -- npx -y adobe-mcp-aftereffects
```

Any client that reads an `mcpServers` block (Claude Desktop, Cursor, Warp, …):

```json
{
  "mcpServers": {
    "aftereffects": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-aftereffects"]
    }
  }
}
```

On macOS the first call asks for permission to control After Effects (System
Settings > Privacy & Security > Automation). In After Effects, turn on
Settings > Scripting & Expressions > Allow Scripts to Write Files and Access
Network, which file operations need.

## Conventions

- **Compositions** are chosen with `comp`: `{ id }` (item ids come from
  `list_items`), `{ name }`, or omitted for the active composition.
- **Layers** are chosen with `layers`: `{ indexes: [...] }` (1 = top, as in
  the Timeline), `{ names: [...] }` or `{ selected: true }`.
- **Properties** are a shortcut (`position`, `scale`, `rotation`, `opacity`,
  `anchor_point`, `source_text`, …) or a path of match names or names, such as
  `["ADBE Effect Parade", "Gaussian Blur", "Blurriness"]`.
- **Positions** are pixels from the composition's top-left; **times** are
  seconds; **colours** are `"#RRGGBB"` or `"rgb(r,g,b)"`.
- **Files** must be inside your home folder or a directory in
  `AFTEREFFECTS_ALLOWED_DIRS`.

## Tools

| Area | Tools |
|---|---|
| Project | `get_project_info`, `list_items`, `import_files` (footage, sequences, layered files as compositions, projects), `create_folder`, `manage_items` (rename, move, label, delete), `save_project`, `open_project` (or a new project), `tidy_project` (remove unused, consolidate, reduce) |
| Compositions | `create_comp`, `set_comp_settings` (size, duration, frame rate, resolution, start timecode, background, motion blur, nesting, work area, Timeline switches), `create_comp_from_items` (New Comp from Selection), `duplicate_comp`, `precompose`, `open_comp`, `run_comp_command` (trim, crop, poster time, lift and extract work area, flowchart, reveal), `add_comp_marker`, `edit_markers` (composition and layer markers, cue points, labels), `save_frame` (PNG) |
| Layers | `list_layers`, `add_layer` (solid, null, adjustment, text, shape, camera, light, or a project item), `set_layer_properties` (switches, comment, quality and sampling, blending mode, Auto-Orient, label, timing, stretch), `set_transform`, `parent_layers` (or with jump), `set_track_matte`, `arrange_layers`, `duplicate_layers` (or copy to another composition), `delete_layers`, `select_layers`, `switch_all_layers`, `open_layer`, `trim_layers`, `move_layers` (align, nudge, Quick Offset, slip), `split_layers`, `reframe_layers` (fit, centre, flip), `replace_layer_source`, `set_solid_settings`, `set_layer_styles`, `choose_layer_tool` |
| Time | `remap_layer_time` (time remapping, freeze frames), `stretch_layers` (time stretch, keeping keyframes, conform frame rate), `set_frame_blending`, `align_video_to_data` |
| Animation | `get_property`, `set_property`, `set_keyframes` (interpolation and easing), `remove_keyframes`, `set_expression` |
| Effects | `list_effects`, `apply_effect` (with property values), `list_layer_effects`, `remove_effects` (or turn off), `apply_preset` (.ffx) |
| Text | `set_text` (Source Text and Character and Paragraph formatting) |
| Masks | `add_mask` (rectangle, ellipse or path, with mode, feather, opacity, expansion) |
| 3D | `set_camera_options` (zoom, F-Stop, depth of field, iris, highlights, Point of Interest), `set_light_options` (type, colour, intensity, cone, falloff, shadows, environment source), `set_material_options` (shadows, lights, reflections, transparency; environment layer), `set_geometry_options` (bevel, extrusion, curvature), `set_comp_3d_settings` (3D renderer, Draft 3D), `set_3d_view` (View > Switch 3D View, Reset, Look at, Create Camera from 3D View), `run_camera_command` (focus links, orbit null, stereo rig, cameras and lights from 3D models), `set_camera_tool` |
| Render | `list_render_templates`, `queue_render`, `render_queue` (in After Effects or Adobe Media Encoder), `manage_render_queue` |
| Tracking | `start_tracking` (Track Motion, Track Mask, Track this Property, Mocha, Tracker panel, Motion Tracking workspace), `apply_warp_stabilizer`, `apply_camera_tracker` (3D Camera Tracker), `get_tracking_data` (track points, face measurements), `set_track_point` |
| Colour | `get_color_management` (and colour profiles), `set_color_management` (bit depth, working space, gamma, linearize, blending), `set_display_color` (display colour management, Simulate Output, Lumetri Scopes), `apply_color_effect` (grading, broadcast-safe, output simulation on an adjustment layer) |
| Utility | `aftereffects_status`, `run_menu_command`, `execute_aftereffects_code`, `help` |

`help({ tool })` describes any tool's parameters.

## How it stays out of your way

- **No dialogs.** Every script runs with After Effects' dialogs suppressed.
- **One undo step per call.** Each call that changes the project is one entry
  in Edit > Undo.
- **Windows without COM.** After Effects has no COM interface, so on Windows the
  server hands scripts to `AfterFX.exe -r` and reads the result back from a
  file. Set `AFTEREFFECTS_EXE` if After Effects is not in the default location.
- **Timeouts say why.** If After Effects does not answer within
  `AFTEREFFECTS_SCRIPT_TIMEOUT_MS` (default 120 s), the error says a dialog is
  probably open. Raise it for long renders.
- **No raw input in scripts.** Every value a caller passes is validated and
  written into the script as a literal.

## Configuration

| Variable | Purpose |
|---|---|
| `AFTEREFFECTS_APP_NAME` | macOS: address a specific copy, e.g. `Adobe After Effects 2025`. By default the server addresses After Effects by its bundle id. |
| `AFTEREFFECTS_EXE` | Windows: path to `AfterFX.exe`. |
| `AFTEREFFECTS_ALLOWED_DIRS` | Extra directories for importing, saving and rendering (`:`-separated on macOS, `;` on Windows). |
| `AFTEREFFECTS_SCRIPT_TIMEOUT_MS` | How long to wait for After Effects. Default 120000. |

## Development

```bash
npm test         # definitions, argument parsing, protocol, and the static script audit
npm run audit    # the audit alone, with findings listed
npm run check    # syntax check
```

The audit checks each generated script against After Effects' scripting object
model (types-for-adobe, After Effects 26.0). Nothing is validated against After
Effects itself yet.
