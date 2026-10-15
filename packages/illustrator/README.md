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
| Documents | `get_document_info`, `list_documents`, `create_document`, `open_document` (AI, PDF pages with crop box, EPS, SVG, AutoCAD with import options, images, CGM, CorelDRAW, EMF/WMF, Word, RTF, text), `save_document` (.ai or .eps, each artboard to its own file, transparency for legacy versions), `close_document` |
| Document commands | `new_from_template`, `save_document_copy`, `revert_document`, `close_all_documents`, `list_document_presets`, `create_document_from_preset` (name, size, orientation, units, colour mode, raster effects, preview mode, transparency grid, bleed), `get_document_setup`, `set_document_setup` (colour mode, ruler origin, large canvas, Edit Artboards), `open_document_with_options` (legacy files, recent files, open as a library), `get_file_info`, `set_file_info` (File Info and XMP), `use_clipboard` (cut, copy, paste, paste in place, on all artboards, without formatting), `switch_document` |
| Artboards | `list_artboards`, `add_artboard`, `set_artboard` (orientation, scale artwork with it), `delete_artboard`, `set_active_artboard`, `fit_artboard_to_artwork` (selected art or artwork bounds), `rearrange_artboards`, `copy_artboard` (duplicate, cut, copy to another document), `delete_empty_artboards`, `align_artboards`, `reorder_artboards`, `convert_to_artboards`, `set_artboard_display` (centre mark, cross hairs, video safe areas and rulers, ruler origin, border, Show / Hide Artboards), `view_artboard` |
| Layers | `list_layers`, `create_layer`, `set_layer_properties` (Layer Options, knockout), `set_active_layer`, `delete_layer`, `move_items_to_layer` (or Send to Current Layer), `organize_layers` (merge, flatten, collect in new layer, release to layers, reverse order), `set_other_layers` (hide, lock or outline others), `select_layer_artwork`, `paste_artwork` (Paste in Front or Back) |
| Shapes and paths | `create_rectangle`, `create_ellipse`, `create_polygon`, `create_star`, `create_line` (end point, or length and angle), `create_path`, `create_arc`, `create_spiral`, `create_rectangular_grid`, `create_polar_grid` (each with its tool's dialog options) |
| Live shapes | `convert_live_shapes` (Convert to Shape, Expand Shape), `toggle_corner_widget` |
| Text | `create_text`, `set_text_style`, `set_text_contents`, `convert_text_to_outlines`, `list_fonts` |
| Typography | `set_character_attributes` (Character, OpenType and CJK options, on frames, character ranges or selected text), `adjust_text` (size, kerning and tracking steps, Clear Tracking, Uniform Type, Fit Headline), `set_paragraph_attributes` (indents, spacing, hyphenation, justification, composers, CJK options), `set_tab_stops`, `get_text_attributes`, `list_text_styles`, `create_text_style`, `edit_text_style`, `delete_text_styles`, `apply_text_style` (and Clear Overrides), `load_text_styles`, `set_text_frame_options` (point/area conversion, Area Type Options, optical margin, anti-aliasing), `thread_text_frames` |
| Type | `create_path_text` (type on a path, area type in a shape), `set_path_text` (path effects, start and end, spacing, flip, legacy update), `change_case`, `insert_special_character` (symbols, dashes, quotes, spaces, forced line break), `apply_smart_punctuation`, `fill_placeholder_text`, `run_type_command` (convert bullets to text, show hidden characters, auto spell check), `list_document_fonts` (with missing fonts), `replace_font`, `find_replace_text` (match case, whole word), `set_text_wrap`, `list_stories`, `update_legacy_text`, `set_text_orientation`, `import_text`, `export_text`, `set_asian_type` (composer, kinsoku, mojikumi, tsume, aki, tate-chu-yoko, warichu), `set_right_to_left_text` (direction, Middle Eastern composer, digits, kashidas) |
| Appearance | `set_fill`, `set_stroke` (both with a tint for spot and global swatches, or a gradient swatch), `set_opacity`, `get_appearance`, `create_gradient` |
| Graphic styles and fill/stroke controls | `list_graphic_styles`, `apply_graphic_style` (replace or merge), `rename_graphic_style`, `delete_graphic_styles`, `save_graphic_style_library`, `open_graphic_styles` (panel or a built-in library), `add_appearance_attribute` (another fill or stroke), `set_transparency_group` (knockout, isolate blending), `toggle_view_option` (transparency grid, Live Paint gaps), `get_default_fill_stroke`, `set_default_fill_stroke`, `swap_fill_stroke`, `reset_fill_stroke` |
| Live Paint | `make_live_paint` (make or merge), `release_live_paint`, `expand_live_paint` |
| Colour | `list_swatches`, `create_swatch` (process, global, spot, spot from Lab values), `create_swatch_group`, `delete_swatches`, `add_used_colors`, `edit_colors` (convert to CMYK, RGB or grayscale, invert, blend) |
| Swatch management | `edit_swatch` (Swatch Options: name, colour, process/global/spot), `duplicate_swatches`, `merge_swatches`, `find_unused_swatches`, `add_current_color`, `edit_swatch_group` (colour groups), `open_swatch_library`, `load_swatch_library` (built-in libraries or .ai files, gradient presets), `save_swatch_library` (Save Swatch Library as AI, or add to one) |
| Recolouring and gradients | `adjust_colors` (by script: saturate, adjust colour balance, complement, web-safe, printable; on items or a colour group), `overprint_black`, `apply_gradient` (Gradient tool placement, one gradient across several objects, predefined gradients) |
| Colour management | `get_color_settings` (settings files, document profile), `load_color_settings`, `set_color_view` (Proof Setup, Proof Colors, gradient annotator) |
| Selecting and arranging | `list_items`, `get_selection`, `select_items`, `select_same`, `select_all`, `deselect_all`, `delete_items`, `duplicate_items`, `move_items`, `scale_items`, `rotate_items`, `reflect_items`, `align_items` (to selection, artboard or key object), `arrange_items`, `group_items`, `ungroup_items` (one level, or every level with Ungroup All) |
| Combining | `make_clipping_mask`, `make_compound_path`, `pathfinder` (also hard mix, soft mix and trap) |
| Paths | `path_operation` (outline stroke, join, add anchor points, reverse direction, divide objects below, release compound path, make pixel perfect, expand appearance), `average_points` (and join), `clean_up`, `split_into_grid`, `split_path`, `set_path_options` (fill rule, guides, pixel alignment), `get_path_info` (area, length, anchors) |
| Effects | `apply_effect` (drop shadow, inner and outer glow, feather, scribble, round corners, convert to shape, free distort, pucker & bloat, roughen, transform, tweak, twist, zig zag, the fifteen warps, offset path, outline object and stroke, crop marks, rasterize, Gaussian blur, NTSC colors), `apply_svg_filter`, `apply_last_effect`, `set_raster_effect_settings` |
| Transforming | `transform_each` (random, copies), `shear_items`, `apply_matrix`, `repeat_transform` (Transform Again), `resize_items` (width and height, relative or absolute), `get_bounds` (geometric, visible, control), `nudge_items`, `set_transform_options` (reference point, scale corners, bounding box), `reset_bounding_box`, `distribute_items` (edges, centres, spacing, exact gap), `distort_items` (free and perspective distort) |
| Envelopes and objects on a path | `make_envelope` (with top object), `edit_envelope` (release, expand, edit contents), `expand_objects_on_path` |
| Selection | `select_by_type` (Select > Object: text, point and area type, clipping masks, stray points, brush strokes, not pixel-aligned, same layers, direction handles), `change_selection` (reselect, inverse, next object above or below), `select_nested_items` (inside groups, or the group above), `select_similar_items` (stroke weight and opacity within a tolerance, blending mode), `toggle_global_edit`, `lock_items` and `hide_items` (the targets, artwork above, or everything else), `unlock_all`, `show_all`, `set_isolation_mode` |
| Clipping masks | `release_clipping_mask`, `edit_clipping_mask` (Edit Mask, Edit Contents), `add_to_clipping_mask` (into a clip group, or around a path as Draw Inside does), `remove_from_clipping_mask` |
| Graphs and meshes | `list_graphs`, `apply_graph_data` (load a variable library, display a data set), `list_meshes` |
| Path editing | `edit_anchor_points` (remove, convert to corner or smooth, set anchor and handles), `copy_items` (to another document or the clipboard), `simplify_path` (curve precision, angle threshold, straight lines), `compound_shape` (make with a shape mode, release, expand), `repeat_pathfinder`, `intertwine` (make, release) |
| Blends | `make_blend` (optionally outlining text for blended lettering), `set_blend_options` (steps, orientation), `release_blend`, `expand_blend`, `reverse_blend`, `replace_blend_spine` |
| Preferences and tools | `get_preferences`, `set_preferences`, `select_tool` (including the graph, mesh, blend and print tiling tools) |
| Placing and export | `place_image` (images, PDF pages, EPS and DCS, SVG, AI, AutoCAD, CGM, CorelDRAW, EMF/WMF), `export_png` (scale or fit, matte, HTML), `export_jpeg`, `export_svg` (Save As SVG: profile, font subsetting, encoding, XMP, slices, text options), `export_web_svg` (Export As SVG: styling, IDs, minify, responsive), `export_for_screens` (artboards, assets and the full document; scale by factor, width, height or resolution; Advanced Settings per format), `export_pdf` (preset plus PDF/X, compression and downsampling, font subsetting, bleed, marks, colour conversion, output intent, flattening, passwords and permissions, Acrobat layers) |
| Variables and data sets | `list_variables`, `create_variable`, `bind_variable`, `delete_variables`, `create_data_sets` (from records: text, image files, visibility), `show_data_set`, `delete_data_sets`, `export_data_sets` (each data set to PNG or JPEG), `import_variables`, `export_variables`, `set_variables_locked` |
| Prepress and printing | `set_overprint`, `make_trap_stroke`, `flatten_transparency`, `toggle_prepress_view` (Overprint Preview, print tiling, Separations Preview, Flattener Preview, Attributes), `create_trim_marks`, `list_print_settings`, `print_document` (to a printer or a PostScript file; preset plus each Print dialog page, with document ink options) |
| 3D | `apply_3d_effect` (extrude, revolve, inflate, rotate: the 3D and Materials effect or 3D Classic with rotation, perspective and surface) |
| Brushes | `list_brushes`, `apply_brush` (and expand to outlines), `import_brushes` (from a library file), `save_brush_library`, `open_brush_library` |
| Perspective grid | `set_perspective_grid` (presets, show or hide, active plane, match plane to object, View menu toggles), `attach_to_perspective`, `release_perspective`, `import_perspective_presets`, `export_perspective_presets` |
| Patterns and repeats | `create_pattern` (Object > Pattern > Make), `apply_pattern` (fill or stroke), `rename_pattern`, `edit_pattern` (enter or leave pattern editing mode), `transform_pattern` (move, scale, rotate, reflect or shear the pattern only), `make_repeat` (radial, grid or mirror, with options), `set_repeat_options`, `release_repeat` |
| Image Trace | `trace_image` (preset plus every Image Trace panel option, optionally expanded), `set_trace_options` (re-trace, save as a preset), `get_trace_info` (paths, anchors, colours), `expand_trace`, `release_trace`, `list_tracing_presets` |
| Symbols | `list_symbols` (instance counts, unused), `create_symbol` (registration point, replace the art), `place_symbol`, `replace_symbol`, `select_symbol_instances`, `break_symbol_link`, `rename_symbol`, `duplicate_symbol`, `delete_symbols` (or every unused one), `open_symbol_library` (built-in or a file), `save_symbol_library` |
| Other formats | `export_psd` (layers, editable text, colour model, resolution), `export_tiff` (LZW, byte order, colour model, resolution), `export_web_image` (GIF and PNG-8 with colours, reduction, dither, matte, lossy GIF), `export_autocad` (DWG or DXF: version, scale, colours, raster format), `export_selection_as_ai`, `place_text_file` |
| Asset export and slices | `list_assets`, `collect_assets` (as one asset or one per item), `rename_asset`, `remove_assets`, `export_selection` (PNG or .ai), `list_slices`, `edit_slices` (make, release, create from selection or guides, duplicate, combine, clip to artboard, delete all, show/hide, lock, slice a rectangle), `set_item_url` (image map and slice URLs) |
| Images and links | `list_images` (links with status and file details, embedded images, embedded files, non-native and plug-in art), `relink_images` (one file, all instances, missing links from a folder), `update_links` (update or embed), `go_to_link`, `place_images` (several files in a grid, Photoshop import options), `rasterize_items` (every Rasterize option), `crop_image`, `colorize_image`, `run_image_command` (remove background, make or release a mockup) |
| Actions and automation | `list_actions` (sets in the Actions panel, or the steps in an .aia file), `play_action`, `load_actions` (Load or Replace Actions; rename actions, remove them or their steps, and switch steps or their dialogs on or off before loading), `create_action_set` (new actions from saved steps), `unload_actions` (an action, a set, or Clear Actions), `run_batch` (Batch by script: a folder of files or every data set, to a destination), `run_script_file`, `import_csv_data` (a CSV data source as data sets), `get_item_data` and `set_item_data` (tags and notes) |
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
  Illustrator's menu commands with `method: "menu"`. The Photoshop effects
  (Effect Gallery, Artistic, Sketch, Texture and the rest) are not offered:
  each command opens a dialog, and their LiveEffect parameters are stored as
  encoded binary that no published script sets. NTSC Colors, which has no
  dialog, is the exception.
- **Commands through a temporary Action.** The object model cannot set a
  blend's steps or orientation, run Simplify, make a Pathfinder compound shape
  or flatten transparency, so `make_blend`, `set_blend_options`,
  `simplify_path`, `compound_shape` and `flatten_transparency` write a one-step
  Action, play it with its dialog closed and unload it again. The Action
  parameters are the ones published scripts and recorded action sets use.
- **Dialogs done by script.** Average, Clean Up, Split Into Grid, Transform
  Each, Batch and several Edit Colors commands open a dialog, so the server does
  what each dialog describes through the object model instead. Smooth and
  Offset Path have no such route and are not offered (`apply_effect` with
  `offset_path` and `expand` covers Offset Path).
- **Actions edited as files.** Illustrator can play, load and unload an action
  but cannot list or change a loaded one. `list_actions` reads the sets from
  Illustrator's preferences, as AiCommandPalette does, and `load_actions` and
  `create_action_set` make their changes to the .aia file before loading it.
  `run_batch` does what the Batch dialog does, one call per file, so a long
  batch does not time out.
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
