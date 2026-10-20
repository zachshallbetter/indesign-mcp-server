# Photoshop MCP Server

An MCP server that drives Adobe Photoshop: documents, image and canvas size,
layers and groups, selections, adjustments and filters, type, export and
history. It runs on the machine where Photoshop is installed and talks to it
through ExtendScript, the scripting interface Photoshop ships with.

Requires Photoshop 2023 or later on macOS or Windows, and Node.js 18 or later.

## Install

Claude Code:

```bash
claude mcp add photoshop -- npx -y adobe-mcp-photoshop
```

Any client that reads an `mcpServers` block (Claude Desktop, Cursor, Warp, …):

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-photoshop"]
    }
  }
}
```

On macOS the first call asks for permission to control Photoshop (System
Settings > Privacy & Security > Automation).

## Conventions

- **Positions and sizes are pixels**, measured from the document's top-left
  corner with y increasing downward, whatever ruler units you use.
- **Layers** are chosen with `target`: `{ ids: [...] }`, `{ names: [...] }` or
  `{ active: true }`. Ids are Photoshop's own layer ids; they come from
  `list_layers` and from every tool that creates a layer.
- **Colours** are `"#RRGGBB"`, `"rgb(r,g,b)"`, `"cmyk(c,m,y,k)"`, `"gray(g)"`,
  `"hsb(h,s,b)"` or `"lab(L,a,b)"`.
- **Adjustments, filters, fills and strokes** change pixel layers, inside the
  selection when there is one.
- **Timeline times** are `{ seconds, frames }` at the timeline's frame rate.
- **Fonts** are PostScript names; `list_fonts` finds them.
- **Files** must be inside your home folder or a directory in
  `PHOTOSHOP_ALLOWED_DIRS`.

## Tools

| Area | Tools |
|---|---|
| Documents | `list_documents`, `get_document_info`, `create_document` (with pixel aspect ratio, or with an artboard), `open_document` (any format Photoshop reads, optionally as a smart object; PDF, EPS, Photoshop Raw and DICOM with their open options), `save_document` (PSD, PSB, TIFF, PNG, JPEG, PDF, GIF, EPS, DCS 1.0 and 2.0, BMP, Targa, Pixar or Photoshop Raw, with each format's options; or a copy), `duplicate_document`, `set_active_document`, `close_document`, `set_colors` (foreground and background) |
| Files | `manage_recent_files` (list, open, clear), `close_documents` (Close All), `go_to_bridge`, `get_document_metadata` and `set_document_metadata` (File Info and XMP), `manage_document_notes` (import, clear, Note tool, Notes panel), `set_file_handling_preferences` (image previews, recent files, History Log), `place_file` (Place Embedded or Linked, positioned, scaled and rotated) |
| Image | `resize_image` (Image Size: pixels, percent, resolution, resampling), `resize_canvas` (Canvas Size with an anchor), `crop_image`, `trim_image`, `rotate_canvas` (or flip), `change_mode` (colour mode and bit depth), `convert_profile`, `flatten_image` (or merge visible), `reveal_all` |
| Layers | `list_layers`, `create_layer` (pixel layer or group), `set_layer_properties` (name, opacity, fill, blend mode, visibility, locks), `set_active_layer`, `arrange_layers`, `group_layers`, `ungroup_layers`, `duplicate_layers`, `delete_layers`, `merge_layers`, `transform_layers` (move, scale, rotate, flip), `rasterize_layers`, `link_layers`, `convert_background_layer`, `layer_comps` |
| Selection | `select_area` (rectangle, ellipse or polygon, combined with the current selection), `select_all` (all, none, inverse), `modify_selection` (expand, contract, feather, smooth, border, grow, similar), `transform_selection`, `fill_selection`, `stroke_selection`, `save_selection` (to or from an alpha channel), `clipboard` (copy, copy merged, cut, clear, paste, paste into) |
| Adjustments and filters | `adjust_layers` (brightness/contrast, levels, curves, exposure, vibrance, hue/saturation, colour balance, black & white, photo filter, channel mixer, gradient map, selective colour, shadows/highlights, posterize, threshold, desaturate, invert, equalize, auto tone, auto contrast, auto colour), `apply_filter` (blurs, sharpening, high pass, noise, median, dust and scratches, maximum, minimum, distortions, offset, clouds and more) |
| Adjustment and fill layers | `create_adjustment_layer` (every adjustment type, with its settings, optionally clipped), `edit_adjustment_layer`, `create_fill_layer` (solid colour, gradient or pattern), `edit_fill_layer` |
| Colour | `swap_colors` (or reset to black and white), `pick_color` (values in every colour model, web-safe colours), `sample_color` (Eyedropper and Color Sampler), `define_pattern`, `assign_profile`, `set_color_preferences` (colour settings, dynamic sliders, gamut warning opacity), `set_proof_view` (Proof Setup, Proof Colors, Gamut Warning) |
| Selection | `select_area` (rectangle, ellipse or polygon, combined with the current selection), `select_all` (all, none, inverse), `modify_selection` (expand, contract, feather, smooth, border, grow, similar), `transform_selection`, `fill_selection`, `stroke_selection`, `save_selection` (to or from an alpha channel), `clipboard` (copy, copy merged, cut, clear, paste, paste into, paste in place, paste outside) |
| Adjustments and filters | `adjust_layers` (brightness/contrast, levels, curves, colour balance, photo filter, shadows/highlights, posterize, threshold, desaturate, invert, equalize, auto levels, auto contrast), `apply_filter` (blurs, sharpening, high pass, noise, median, dust and scratches, maximum, minimum, distortions, offset, clouds and more) |
| Painting and retouching | `fill_contents` (Edit > Fill: foreground, background, black, 50% gray, white, pattern, History, Content-Aware, and the scripted patterns Brick Fill, Cross Weave, Place Along Path, Random Fill and Symmetry Fill), `draw_gradient` (classic gradients with colour and opacity stops), `stroke_path` (paint along a path with the Brush, Pencil, Eraser, Clone Stamp, Healing Brush, Pattern Stamp, Dodge, Burn and other tools), `fill_path`, `fill_at_point` (Paint Bucket, Magic Eraser), `set_tool_options` (tool, brush preset, size, hardness, opacity, flow, mode, pressure buttons, Smoothing and its options, Mixer Brush Wet and Mix, Tolerance, Contiguous, painting cursors), `set_brush_settings` (the Brush Settings panel: tip shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose and the checkboxes), `manage_brushes` (import, export, Define Brush Preset, new, rename, delete and reset presets), `set_clone_source_options` (Clone Source panel: source, Reset Transform, overlay options), `retouch_selection` (Patch, Content-Aware Move) |
| Adjustments and filters | `adjust_layers` (brightness/contrast, levels, curves, colour balance, photo filter, shadows/highlights, posterize, threshold, desaturate, invert, equalize, auto levels, auto contrast, Auto Color Correction Options, Match Color, Replace Color), `apply_filter` (blurs, sharpening, high pass, noise, median, dust and scratches, maximum, minimum, distortions, offset, clouds, Lens Correction, Adaptive Wide Angle, Filter Gallery and more) |
| Painting and retouching | `fill_contents` (Edit > Fill: foreground, background, black, 50% gray, white, pattern, History, Content-Aware), `draw_gradient` (classic gradients with colour and opacity stops), `stroke_path` (paint along a path with the Brush, Pencil, Eraser, Clone Stamp, Healing Brush, Dodge, Burn and other tools), `fill_path`, `fill_at_point` (Paint Bucket, Magic Eraser), `set_tool_options` (tool, brush preset, size, hardness, opacity, flow, painting cursors), `manage_brushes` (import, export, Define Brush Preset), `retouch_selection` (Patch, Content-Aware Move) |
| Type | `create_text_layer` (point or paragraph type), `set_text` (text, formatting, position, warp), `list_fonts` |
| Video and animation | `get_timeline`, `create_timeline` (video timeline or frame animation, or convert), `set_timeline` (Timeline panel, frame rate, playhead, Animation Options), `run_timeline_command` (Move & Trim, split, work area, keyframes, onion skins, video layer frames), `edit_frame_animation` (new, delete, copy, paste, reverse and tween frames, frames to and from layers), `add_video_layer`, `import_video_frames`, `set_clip_timing` (in and out points, duration), `add_video_transition`, `render_video` |
| History | `list_history`, `undo` (back, forward, or to a state), `make_snapshot`, `edit_history` (revert, delete or clear states, new document from a state, history brush source, purge), `set_history_options` (History Options and the History Log) |
| Automation | `list_action_sets`, `edit_actions` (new set, delete, clear, reset, load or save .atn), `set_action_options` (playback options, Button Mode, tool recording), `run_action_batch` (Batch), `create_droplet`, `run_automate_command` (Crop and Straighten Photos, Fit Image, Conditional Mode Change, Lens Correction, Delete All Empty Layers, Flatten All Layer Effects, Flatten All Masks), `combine_images` (Load Files into Stack, Photomerge, Merge to HDR Pro, Statistics), `manage_script_events` (Script Events Manager), `manage_data_sets` (import, apply and export variable data sets) |
| Artboards | `get_artboards`, `create_artboard` (new, from layers, from a group, or an artboard document), `edit_artboards` (size, position, background, auto-nesting, duplicate, ungroup, guides, Artboard and Frame tools), `create_frame` (from layers or a group), `export_artboards` (to files or one PDF) |
| Export | `export_image` (Save for Web: PNG, PNG-8, JPEG, GIF, optionally resized), `export_layers` (one file per layer or group), `quick_export` (the document or chosen layers), `export_layer_comps` (to files or one PDF), `export_paths_to_illustrator`, `make_pdf_presentation` (multi-page PDF or slideshow), `generate_image_assets` (Generator asset layer names, defaults layer, on or off) |
| Print | `get_print_options`, `set_print_options` (printer, copies, colour handling and separations, print space, position and scale, marks, functions), `print_image` (with the settings, or one copy), `apply_trap` |
| History | `list_history`, `undo` (back, forward, or to a state), `make_snapshot` |
| Application | `get_photoshop_info` (version, memory, System Info, file types, feature checks), `get_photoshop_preferences`, `set_photoshop_preferences` (general, interface and colour theme, file handling, performance, cursors, transparency, units and rulers, guides and grid, plug-ins, type, script dialogs), `purge_photoshop_caches`, `run_photoshop_command` (beep, bring to front, refresh, hide, Help, account), `run_photoshop_menu_item`, `manage_script_options` (values kept between sessions), `quit_photoshop` |
| Interface | `arrange_photoshop_windows` (tile, 2-up to 6-up, tabs, float, match zoom and location), `set_zoom_and_screen_mode`, `toggle_view_extras` (extras, show items, rulers, snapping, locks), `show_photoshop_panels` (show or hide panels, Essentials workspace, Histogram and Info panel options), `select_view_tool`, `edit_photoshop_guides` (add, guide layout, from shape, clear guides or slices) |
| Camera Raw | `open_raw_file` (Camera Raw settings and workflow options), `apply_camera_raw_settings` (Camera Raw Filter: Basic, Curve, Detail, Color Mixer, Color Grading, Optics, Effects, Masking), `apply_neural_filter` (Depth Blur, Style Transfer, Photo Restoration), `replace_sky`, `remove_background` |
| Generative | `generative_fill`, `generate_image`, `harmonize_layer` (need an Adobe account and an internet connection; use generative credits) |
| Utility | `photoshop_status`, `play_action`, `execute_photoshop_code`, `help` |

`help({ tool })` describes any tool's parameters.

## How it stays out of your way

- **No dialogs.** Every script runs with `displayDialogs` off, so a command uses
  its settings instead of waiting for a click, and restores your setting
  afterwards, even when the script fails.
- **Your units come back.** Scripts work in pixels and restore your ruler and
  type units afterwards.
- **Exports don't touch the document.** `export_image` and `export_layers` work
  on a temporary copy and close it.
- **Timeouts say why.** If Photoshop does not answer within
  `PHOTOSHOP_SCRIPT_TIMEOUT_MS` (default 120 s), the error says a dialog is
  probably open in Photoshop.
- **No raw input in scripts.** Every value a caller passes is validated and
  written into the script as a literal.

## Configuration

| Variable | Purpose |
|---|---|
| `PHOTOSHOP_APP_NAME` | macOS: address a specific copy, e.g. `Adobe Photoshop 2025`. By default the server addresses Photoshop by its bundle id. |
| `PHOTOSHOP_ALLOWED_DIRS` | Extra directories for opening, saving and exporting files (`:`-separated on macOS, `;` on Windows). |
| `PHOTOSHOP_SCRIPT_TIMEOUT_MS` | How long to wait for Photoshop. Default 120000. |

## Development

```bash
npm test         # definitions, argument parsing, protocol, and the static script audit
npm run audit    # the audit alone, with findings listed
npm run check    # syntax check
```

The audit runs every tool with sample arguments against a stubbed executor and
checks each generated script against Photoshop's scripting object model
(types-for-adobe, Photoshop 2015.5). Nothing is validated against Photoshop
itself yet.
