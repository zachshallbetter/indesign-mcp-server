# Illustrator MCP Server

An MCP server that drives Adobe Illustrator: documents, artboards, layers,
shapes and paths, text, colour, pathfinder operations and export. It runs on
the machine where Illustrator is installed and talks to it through
ExtendScript, the scripting interface Illustrator ships with.

Requires Illustrator 2023 or later on macOS or Windows, and Node.js 18 or later.

## Install

Claude Code:

```bash
claude mcp add illustrator -- npx -y adobe-mcp-illustrator
```

Any client that reads an `mcpServers` block (Claude Desktop, Cursor, Warp, …):

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "npx",
      "args": ["-y", "adobe-mcp-illustrator"]
    }
  }
}
```

On macOS the first call asks for permission to control Illustrator (System
Settings > Privacy & Security > Automation).

## Conventions

- **Positions and sizes are points** (72 pt = 1 in), measured from the top-left
  corner of an artboard (`artboardIndex`, default 0), with y increasing
  downward. Illustrator's own document coordinates run upward; the server
  converts both ways and accounts for large-canvas documents.
- **Items** are chosen with `target`: `{ ids: [...] }`, `{ names: [...] }` or
  `{ selection: true }`. Ids are Illustrator's own item ids (`PageItem.uuid`);
  they come from `list_items` and from every tool that creates artwork.
- **Colours** are a swatch name, `"#RRGGBB"`, `"rgb(r,g,b)"`,
  `"cmyk(c,m,y,k)"`, `"gray(g)"` or `"none"`. A document's colour mode is fixed
  when it is created, so `create_document` asks for it.
- **Fonts** are PostScript names; `list_fonts` finds them.
- **Files** must be inside your home folder or a directory in
  `ILLUSTRATOR_ALLOWED_DIRS`.

## Tools

| Area | Tools |
|---|---|
| Documents | `get_document_info`, `list_documents`, `create_document`, `open_document`, `save_document` (.ai or .eps, each artboard to its own file), `close_document` |
| Artboards | `list_artboards`, `add_artboard`, `set_artboard`, `delete_artboard`, `set_active_artboard`, `fit_artboard_to_artwork`, `rearrange_artboards` |
| Layers | `list_layers`, `create_layer`, `set_layer_properties`, `set_active_layer`, `delete_layer`, `move_items_to_layer` |
| Shapes and paths | `create_rectangle`, `create_ellipse`, `create_polygon`, `create_star`, `create_line`, `create_path` |
| Text | `create_text`, `set_text_style`, `set_text_contents`, `convert_text_to_outlines`, `list_fonts` |
| Appearance | `set_fill`, `set_stroke` (both with a tint for spot and global swatches), `set_opacity`, `get_appearance`, `create_gradient` |
| Colour | `list_swatches`, `create_swatch` (process, global, spot, spot from Lab values), `create_swatch_group`, `delete_swatches`, `add_used_colors`, `edit_colors` (convert to CMYK, RGB or grayscale, invert, blend) |
| Selecting and arranging | `list_items`, `get_selection`, `select_items`, `select_same`, `select_all`, `deselect_all`, `delete_items`, `duplicate_items`, `move_items`, `scale_items`, `rotate_items`, `reflect_items`, `align_items`, `arrange_items`, `group_items`, `ungroup_items` (one level, or every level with Ungroup All) |
| Selection | `select_by_type` (Select > Object: text, point and area type, clipping masks, stray points, brush strokes, not pixel-aligned, same layers, direction handles), `change_selection` (reselect, inverse, next object above or below), `select_nested_items` (inside groups, or the group above), `select_similar_items` (stroke weight and opacity within a tolerance, blending mode), `toggle_global_edit`, `lock_items` and `hide_items` (the targets, artwork above, or everything else), `unlock_all`, `show_all`, `set_isolation_mode` |
| Combining | `make_clipping_mask`, `make_compound_path`, `pathfinder` |
| Paths | `path_operation` (outline stroke, join, add anchor points, reverse direction, divide objects below, release compound path, make pixel perfect, expand appearance), `average_points` (and join), `clean_up`, `split_into_grid`, `split_path`, `set_path_options` (fill rule, guides, pixel alignment), `get_path_info` (area, length, anchors) |
| Effects | `apply_effect` (drop shadow, offset path, round corners, roughen, transform, Gaussian blur) |
| Blends | `make_blend`, `set_blend_options` (steps, orientation), `release_blend`, `expand_blend`, `reverse_blend` |
| Image Trace | `trace_image` (preset plus every Image Trace panel option, optionally expanded), `set_trace_options` (re-trace, save as a preset), `get_trace_info` (paths, anchors, colours), `expand_trace`, `release_trace`, `list_tracing_presets` |
| Symbols | `list_symbols` (instance counts, unused), `create_symbol` (registration point, replace the art), `place_symbol`, `replace_symbol`, `select_symbol_instances`, `break_symbol_link`, `rename_symbol`, `duplicate_symbol`, `delete_symbols` (or every unused one), `open_symbol_library` (built-in or a file), `save_symbol_library` |
| Preferences and tools | `get_preferences`, `set_preferences`, `select_tool` |
| Images and links | `list_images` (links with status and file details, embedded images, embedded files, non-native and plug-in art), `relink_images` (one file, all instances, missing links from a folder), `update_links` (update or embed), `go_to_link`, `place_images` (several files in a grid, Photoshop import options), `rasterize_items` (every Rasterize option), `crop_image`, `colorize_image`, `run_image_command` (remove background, make or release a mockup) |
| Placing and export | `place_image`, `export_png`, `export_jpeg`, `export_svg` (Save As SVG), `export_web_svg` (Export As SVG: styling, IDs, minify, responsive), `export_for_screens`, `export_pdf` (preset plus PDF/X, bleed, marks, colour conversion, output intent, Acrobat layers) |
| Variables and data sets | `list_variables`, `create_variable`, `bind_variable`, `delete_variables`, `create_data_sets` (from records: text, image files, visibility), `show_data_set`, `delete_data_sets`, `export_data_sets` (each data set to PNG or JPEG), `import_variables`, `export_variables`, `set_variables_locked` |
| Prepress and printing | `set_overprint`, `create_trim_marks`, `list_print_settings`, `print_document` (to a printer or a PostScript file; preset plus each Print dialog page) |
| Utility | `illustrator_status`, `execute_menu_command`, `find_menu_commands`, `execute_illustrator_code`, `help` |

`help({ tool })` describes any tool's parameters.

## How it stays out of your way

- **No dialogs.** Every script switches Illustrator's alerts off while it runs
  and restores your setting afterwards, even when the script fails, so a
  warning cannot leave a call waiting.
- **Your settings come back.** The coordinate system a script uses is set for
  that script and restored afterwards.
- **Timeouts say why.** If Illustrator does not answer within
  `ILLUSTRATOR_SCRIPT_TIMEOUT_MS` (default 120 s), the error says a dialog is
  probably open in Illustrator.
- **Menu commands are checked.** Illustrator ignores a menu command name it does
  not know and reports nothing for one it does. `execute_menu_command` accepts
  only the 859 known names (unless you pass `allowUnknown`) and returns the
  selection and document state after the command, so you can see what it did.
- **Live Effects and preferences come from published practice.** Adobe does not
  document the LiveEffect XML that `apply_effect` and `pathfinder` pass to
  `applyEffect`, nor the preference keys behind `set_preferences`; the server
  uses only parameters and keys that published scripts rely on, recorded with
  their sources in the capability atlas. `pathfinder` can fall back to
  Illustrator's menu commands with `method: "menu"`.
- **Blend options through a temporary Action.** The object model cannot set a
  blend's steps or orientation, so `make_blend` and `set_blend_options` write a
  one-step Action, play it on the blend and unload it again.
- **Dialogs done by script.** Average, Clean Up and Split Into Grid open a
  dialog, so the server does what each dialog describes through the object
  model instead. Simplify, Smooth and Offset Path have no such route and are
  not offered (`apply_effect` with `offset_path` and `expand` covers Offset Path).
- **Data sets from records.** Illustrator captures a data set from the artwork as
  it is, so `create_data_sets` sets each record's values on the bound objects and
  then captures it, the way published variable scripts do.
- **No raw input in scripts.** Every value a caller passes is validated and
  written into the script as a literal.

## Configuration

| Variable | Purpose |
|---|---|
| `ILLUSTRATOR_APP_NAME` | macOS: address a specific copy, e.g. `Adobe Illustrator 2025`. By default the server addresses Illustrator by its bundle id. |
| `ILLUSTRATOR_ALLOWED_DIRS` | Extra directories for opening, placing and exporting files (`:`-separated on macOS, `;` on Windows). |
| `ILLUSTRATOR_SCRIPT_TIMEOUT_MS` | How long to wait for Illustrator. Default 120000. |

## Development

```bash
npm test         # definitions, argument parsing, protocol, and the static script audit
npm run audit    # the audit alone, with findings listed
npm run check    # syntax check
```

The static audit runs every tool with sample arguments against a stubbed
Illustrator and checks that each generated script parses as ES5 and uses only
names in Illustrator's scripting object model (2022 to 2025). It does not run
anything in Illustrator: a tool that passes it has not necessarily been run
against the application.

Shared infrastructure (script escaping, the executor, the server shell, the
audit) comes from [adobe-mcp-core](https://github.com/zachshallbetter/adobe-mcp-core),
the foundation shared with
[adobe-mcp-indesign](../indesign).

## Licence

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the menu command data.
