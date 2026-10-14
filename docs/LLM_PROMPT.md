# Agent guide: InDesign MCP Server

A compact guide for an AI agent (or a system prompt) using this server. It expands on the instructions the server sends at initialize; the two agree. For every parameter of every tool, call `help` or read [TOOLS.md](./TOOLS.md).

## What the tools do

The server has 137 tools that drive a running Adobe InDesign on the user's computer (macOS or Windows). Each call runs a script inside InDesign. Most tools act on the **active document**, so the first step is always `create_document` or `open_document`.

If you are unsure InDesign is reachable, call `indesign_status` with `probe: true`. It reports the platform, the resolved app name, the backend, the InDesign version and the open documents.

## Conventions

- **Units.** Positions and sizes are millimeters, measured from the top-left corner of the target page. Stroke weights, font sizes, leading and paragraph spacing are points. A few tools take their own units: `adjust_page_layout` has `units`, `resize_page` takes factors or ratios for some `resizeMethod` values, and `place_file_on_spread` / `place_xml_on_spread` measure x/y from the spread's ruler origin.
- **Indexes are 0-based integers.** That covers `pageIndex`, `spreadIndex`, `itemIndex`, `frameIndex`, `groupIndex` and table rows and columns. There are two exceptions. Page *ranges* in `export_pdf.pages`, `export_images.pages` and `apply_master_spread.pageRange` are 1-based page numbers such as `"1-3,5"`. Master spreads are addressed by full name, such as `"A-Master"`.
- **Optional `pageIndex`** defaults to the page active in the layout window.
- **Item indexes depend on the tool:**
  - `list_page_items` numbers `page.allPageItems`. That list includes nested items, such as the image inside a frame and the members of a group. The `itemIndex` parameters of the page-item tools (`move_page_item`, `delete_page_item` and the like) use this numbering, and so does `groupIndex`, which `list_groups` reports.
  - Text tools (`edit_text_frame`, `apply_paragraph_style`, `apply_character_style`) take `frameIndex` in `page.textFrames` order: top-level text frames only, so it is usually not the `list_page_items` index.
  - `apply_color` (`targetType`) and `apply_object_style` (`itemType`) take `itemIndex` within the collection you choose: `pageItem` is `page.allPageItems`, `text`/`textFrame` is `page.textFrames`, and `rectangle`, `ellipse`, `polygon` are `page.rectangles`, `page.ovals`, `page.polygons`.
  - `get_image_info` counts `page.allGraphics`; `populate_table` counts the tables in `page.textFrames`; `remove_item_from_group` counts the group's own members as `get_group_info` lists them.
  - Every index parameter's description names its collection.
- **Colors** are swatch names that exist in the document (`list_color_swatches`), such as `"Black"`, `"Paper"`, `"None"` or a custom swatch. You can also pass `"#RRGGBB"`, which creates an RGB swatch with that name when it does not exist yet. `create_color_swatch` makes named swatches from 0-255 RGB values.
- **Fonts** are `fontName`: `"Family\tStyle"` with a real tab between family and style (InDesign's `Font.name`), for example `"Arial\tBold"`, or a family name alone. A font that is not installed returns an error, except in `create_master_text_frame`, which applies the name as given.
- **Stroke weight** is `strokeWeight`, in points, on every tool that sets a stroke.
- **Alignment** is `alignment` with InDesign `Justification` names on every tool: `LEFT_ALIGN`, `CENTER_ALIGN`, `RIGHT_ALIGN`, `LEFT_JUSTIFIED`, `RIGHT_JUSTIFIED`, `CENTER_JUSTIFIED`, `FULLY_JUSTIFIED`. `LEFT_JUSTIFIED` is justified text with the last line left.
- **Older names still work.** Calls written for 2.1 and earlier keep working: `strokeWidth` (now `strokeWeight`), `fontFamily` and `fontFamily` + `fontStyle` (now `fontName`), `objectIndex` (now `itemIndex` in `apply_color`), `folderPath` (now `outputPath` in `export_images` and `package_document`), `pageRange` (now `pages` in `export_images`), `applyObjectStyle` (now `objectStyle` in `place_image`), `transparency` (now `opacity` in `create_object_style`), and the alignment values `LEFT`, `CENTER`, `RIGHT`, `JUSTIFY` (now `LEFT_ALIGN`, `CENTER_ALIGN`, `RIGHT_ALIGN`, `LEFT_JUSTIFIED`). They are not in the schemas, and each use adds a deprecation warning to the result; use the canonical names in new calls.
- **File paths** must be absolute and inside the user's home folder or a directory listed in `INDESIGN_ALLOWED_DIRS`. System folders are always refused. Other paths are rejected with `Access denied: ...`.
- **Omitted geometry.** If you leave out `x`, `y`, `width` or `height` on a create tool, the server picks values that fit the page. Pass explicit values when the layout matters.

## Reading results and errors

Every result is a JSON text block. A success looks like this:

```json
{ "success": true, "operation": "Create Text Frame", "result": "Text frame created on page 1 (ID 231, 17 characters)", "timestamp": "..." }
```

When an argument was not used as written, the result also has a `warnings` list. An unknown name is ignored and the warning suggests the closest valid one, for example `Unknown parameter 'strokeColour' was ignored; did you mean 'strokeColor'?`. An older name still works and gets a deprecation note, such as `'strokeWidth' is deprecated; use 'strokeWeight'`. Fix the argument in later calls. A warning does not make a call fail, so check whether the ignored argument mattered. There is no `warnings` key when every argument was used.

A failure sets MCP `isError: true` and `success: false`. The message is in `result` when InDesign reported the problem, or in `error` when the server rejected the call before running it. Typical messages and what to do about them:

| Message | Meaning / fix |
| --- | --- |
| `No document open` | Call `create_document` or `open_document` first. |
| `Page index 3 out of range (document has 2 pages)` | Check `get_document_info` or `list_page_items` and use a valid 0-based index. |
| `Error: color swatch 'Brand Blue' not found in document` | Create it with `create_color_swatch`, or pass `"#RRGGBB"`. |
| `Error: font '...' is not installed` | Use an installed font: `"Family\tStyle"` or a family name. |
| `Error: paragraph style 'Body' not found` | Create the style first, or check `list_styles`. |
| `Access denied: '...' is outside the allowed directories` | Use an absolute path inside home or `INDESIGN_ALLOWED_DIRS`. |
| `Invalid number for 'x'`, `Invalid value for 'alignment'` | Fix the argument type or the enum value. |
| `Error executing tool: AppleScript execution failed: ...` / `COM execution failed: ...` | InDesign could not be reached. Run `indesign_status` with `probe: true` and tell the user. |

Read the message and change the arguments. Do not retry a call unchanged. If text overflows its frame, the result says `text overflows`: enlarge the frame or shorten the text.

## Destructive tools

Tool annotations mark these as destructive. Check with the user before you use them on work that is not saved.

- **Delete content:** `delete_page`, `delete_spread`, `delete_page_item`, `delete_master_spread`, `delete_page_layout_snapshot`, `delete_all_page_layout_snapshots`, `cleanup_document`, `organize_document_layers`, `ungroup`, `remove_item_from_group`, `detach_master_items`, `remove_master_override`
- **Rewrite text:** `edit_text_frame` (replaces content), `find_replace_text`, `find_text_in_document` (when `replaceText` is given), `populate_table`
- **Discard work:** `close_document` (closes **without saving**)
- **Overwrite files on disk:** `save_document`, `export_pdf`, `export_images`, `export_epub`, `export_document_xml`, `package_document`, `export_book`, `package_book`, `preflight_book`
- **Change all pages:** `set_document_preferences` (margin changes apply to every page and master)
- **Run arbitrary code:** `execute_indesign_code` (runs any ExtendScript). Prefer a dedicated tool.

`cleanup_document` has a `dryRun` option. Run it first.

## Workflow: new document, styles, content, export

```javascript
await tools.call("create_document", { width: 210, height: 297, pages: 2, marginTop: 15, marginBottom: 15, marginLeft: 15, marginRight: 15 });

// Define colors and styles before content
await tools.call("create_color_swatch", { name: "Brand Blue", red: 0, green: 82, blue: 155 });
await tools.call("create_paragraph_style", { name: "Heading", fontName: "Arial\tBold", fontSize: 28, leading: 32, textColor: "Brand Blue", spaceAfter: 6 });
await tools.call("create_paragraph_style", { name: "Body", fontName: "Arial\tRegular", fontSize: 10, leading: 14, alignment: "LEFT_ALIGN" });

// Content on page 0
await tools.call("create_text_frame", { pageIndex: 0, content: "Annual Report", x: 15, y: 15, width: 180, height: 20, paragraphStyle: "Heading" });
await tools.call("create_text_frame", { pageIndex: 0, content: "Body copy...", x: 15, y: 40, width: 180, height: 120, paragraphStyle: "Body" });
await tools.call("place_image", { pageIndex: 0, filePath: "/Users/me/Pictures/cover.jpg", x: 15, y: 170, width: 180, height: 100, fitMode: "FILL_PROPORTIONALLY" });

// Check, save, export
await tools.call("validate_document", { minImagePpi: 200 });
await tools.call("save_document", { filePath: "/Users/me/Documents/report.indd" });
await tools.call("export_pdf", { filePath: "/Users/me/Documents/report.pdf", quality: "PRESS", includeBleed: true });
```

For repeated page furniture, set up masters with `create_master_spread`, `create_master_text_frame` and `create_master_rectangle`, then call `apply_master_spread`. Add a table with `create_table`, then `populate_table` with a 2-D array.

## Workflow: editing an existing document

Inspect before you change anything:

```javascript
await tools.call("open_document", { filePath: "/Users/me/Documents/brochure.indd" });
await tools.call("get_document_info");
await tools.call("list_page_items", { pageIndex: 1 });
await tools.call("get_document_stories", { oversetOnly: true });
await tools.call("list_styles", { styleType: "PARAGRAPH" });
```

Then make targeted edits with indexes from those listings:

```javascript
await tools.call("edit_text_frame", { pageIndex: 1, frameIndex: 0, content: "Updated headline" });
await tools.call("apply_paragraph_style", { pageIndex: 1, frameIndex: 0, styleName: "Heading" });
await tools.call("move_page_item", { pageIndex: 1, itemIndex: 2, x: 20, y: 60 });
await tools.call("find_text_in_document", { searchText: "2025" });
await tools.call("find_replace_text", { findText: "2025", replaceText: "2026", wholeWord: true });
await tools.call("save_document");
```

`save_document` with no `filePath` saves in place. That only works if the document has been saved before.

## Workflow: books

```javascript
await tools.call("create_book", { filePath: "/Users/me/Books/manual.indb" });
await tools.call("add_document_to_book", { bookPath: "/Users/me/Books/manual.indb", documentPath: "/Users/me/Books/ch1.indd" });
await tools.call("add_document_to_book", { bookPath: "/Users/me/Books/manual.indb", documentPath: "/Users/me/Books/ch2.indd" });
await tools.call("synchronize_book", { bookPath: "/Users/me/Books/manual.indb" });
await tools.call("update_all_numbers", { bookPath: "/Users/me/Books/manual.indb" });
await tools.call("export_book", { bookPath: "/Users/me/Books/manual.indb", outputPath: "/Users/me/Books/manual.pdf", format: "PDF" });
```

A tool that gets a `bookPath` for a book that is not open opens it, does the work and closes it again.

## Things that block InDesign

Modal dialogs stop scripts until someone closes them in InDesign, and the call times out (about 120 s) in the meantime. Avoid them:

- `print_book` shows the print dialog unless you pass `printDialog: false`.
- `place_file_on_page` and `place_file_on_spread` show import options when `showingOptions: true`.
- Opening documents with missing fonts or links can raise InDesign alerts.

If a call times out, ask the user to check InDesign for an open dialog.

## Finding the right tool

```javascript
await tools.call("help", { category: "styles" });
await tools.call("help", { tool: "place_image", format: "detailed" });
```

The categories are `document`, `page`, `text`, `graphics`, `styles`, `layout`, `export` and `all`.
