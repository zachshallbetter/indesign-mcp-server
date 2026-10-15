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
| Documents | `list_documents`, `get_document_info`, `create_document`, `open_document` (optionally as a smart object), `save_document` (PSD, TIFF, PNG, JPEG or PDF, with each format's options; or a copy), `duplicate_document`, `set_active_document`, `close_document`, `set_colors` (foreground and background) |
| Image | `resize_image` (Image Size: pixels, percent, resolution, resampling), `resize_canvas` (Canvas Size with an anchor), `crop_image`, `trim_image`, `rotate_canvas` (or flip), `change_mode` (colour mode and bit depth), `convert_profile`, `flatten_image` (or merge visible), `reveal_all` |
| Layers | `list_layers`, `create_layer` (pixel layer or group), `set_layer_properties` (name, opacity, fill, blend mode, visibility, locks), `set_active_layer`, `arrange_layers`, `group_layers`, `ungroup_layers`, `duplicate_layers`, `delete_layers`, `merge_layers`, `transform_layers` (move, scale, rotate, flip), `rasterize_layers`, `link_layers`, `convert_background_layer`, `layer_comps` |
| Selection | `select_area` (rectangle, ellipse or polygon, combined with the current selection), `select_all` (all, none, inverse), `modify_selection` (expand, contract, feather, smooth, border, grow, similar), `transform_selection`, `fill_selection`, `stroke_selection`, `save_selection` (to or from an alpha channel), `clipboard` (copy, copy merged, cut, clear, paste, paste into) |
| Adjustments and filters | `adjust_layers` (brightness/contrast, levels, curves, colour balance, photo filter, shadows/highlights, posterize, threshold, desaturate, invert, equalize, auto levels, auto contrast), `apply_filter` (blurs, sharpening, high pass, noise, median, dust and scratches, maximum, minimum, distortions, offset, clouds and more) |
| Painting and retouching | `fill_contents` (Edit > Fill: foreground, background, black, 50% gray, white, pattern, History, Content-Aware), `draw_gradient` (classic gradients with colour and opacity stops), `stroke_path` (paint along a path with the Brush, Pencil, Eraser, Clone Stamp, Healing Brush, Dodge, Burn and other tools), `fill_path`, `fill_at_point` (Paint Bucket, Magic Eraser), `set_tool_options` (tool, brush preset, size, hardness, opacity, flow, painting cursors), `manage_brushes` (import, export, Define Brush Preset), `retouch_selection` (Patch, Content-Aware Move) |
| Type | `create_text_layer` (point or paragraph type), `set_text` (text, formatting, position, warp), `list_fonts` |
| Export | `export_image` (Save for Web: PNG, PNG-8, JPEG, GIF, optionally resized), `export_layers` (one file per layer or group) |
| Video and animation | `get_timeline`, `create_timeline` (video timeline or frame animation, or convert), `set_timeline` (Timeline panel, frame rate, playhead, Animation Options), `run_timeline_command` (Move & Trim, split, work area, keyframes, onion skins, video layer frames), `edit_frame_animation` (new, delete, copy, paste, reverse and tween frames, frames to and from layers), `add_video_layer`, `import_video_frames`, `set_clip_timing` (in and out points, duration), `add_video_transition`, `render_video` |
| History | `list_history`, `undo` (back, forward, or to a state), `make_snapshot` |
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
