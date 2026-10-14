# Example: a one-page flyer

This walkthrough builds an A5 flyer with a colored background, a headline, body text, a photo and an accent bar. It then saves the flyer and exports a PDF and a PNG preview. Each step is a real tool call. Paste the steps into an agent as a plan, or send the calls from your own MCP client.

**Before you start:**

- Set up the server ([docs/MCP_INSTRUCTIONS.md](../docs/MCP_INSTRUCTIONS.md)).
- Have a photo at an absolute path inside your home folder. Replace `/Users/you/...` below with your own paths. On Windows, use `C:/Users/you/...`.
- The calls use Arial. If Arial is not installed, use another installed font.

## 1. Check the connection

```javascript
await tools.call("indesign_status", { probe: true });
```

Check that `indesign.reachable` is `true`.

## 2. Create the document

A5 portrait (148 x 210 mm) with 3 mm bleed and 12 mm margins:

```javascript
await tools.call("create_document", {
  width: 148, height: 210, pages: 1,
  bleedTop: 3, bleedBottom: 3, bleedInside: 3, bleedOutside: 3,
  marginTop: 12, marginBottom: 12, marginLeft: 12, marginRight: 12
});
```

## 3. Colors and styles

```javascript
await tools.call("create_color_swatch", { name: "Flyer Navy", red: 20, green: 33, blue: 61 });
await tools.call("create_color_swatch", { name: "Flyer Gold", red: 242, green: 169, blue: 0 });

await tools.call("create_paragraph_style", {
  name: "Flyer Title", fontName: "Arial\tBold", fontSize: 34, leading: 38,
  textColor: "Paper", alignment: "CENTER_ALIGN", spaceAfter: 4
});
await tools.call("create_paragraph_style", {
  name: "Flyer Body", fontName: "Arial\tRegular", fontSize: 11, leading: 15,
  textColor: "Paper", alignment: "CENTER_ALIGN"
});
```

## 4. Background and accent bar

`set_page_background` adds a full-page rectangle filled with the swatch and sends it to the back:

```javascript
await tools.call("set_page_background", { pageIndex: 0, backgroundColor: "Flyer Navy" });
await tools.call("create_rectangle", { pageIndex: 0, x: 12, y: 58, width: 124, height: 2, fillColor: "Flyer Gold" });
```

## 5. Text

```javascript
await tools.call("create_text_frame", {
  pageIndex: 0, content: "Spring Market",
  x: 12, y: 18, width: 124, height: 36, paragraphStyle: "Flyer Title"
});
await tools.call("create_text_frame", {
  pageIndex: 0, content: "Saturday 12 April, 9:00 to 15:00\rRiverside Hall, free entry",
  x: 12, y: 64, width: 124, height: 20, paragraphStyle: "Flyer Body"
});
```

`\r` starts a new paragraph in InDesign. If a result says `text overflows`, make the frame taller, for example with `resize_page_item`.

## 6. Photo

```javascript
await tools.call("place_image", {
  pageIndex: 0, filePath: "/Users/you/Pictures/market.jpg",
  x: 12, y: 90, width: 124, height: 100, fitMode: "FILL_PROPORTIONALLY"
});
```

## 7. Review

```javascript
await tools.call("list_page_items", { pageIndex: 0 });
await tools.call("validate_document", { minImagePpi: 200 });
```

`validate_document` reports missing fonts or links, low-resolution images and overset text.

## 8. Save and export

```javascript
await tools.call("save_document", { filePath: "/Users/you/Documents/spring-market.indd" });
await tools.call("export_pdf", { filePath: "/Users/you/Documents/spring-market.pdf", quality: "PRESS", includeBleed: true, includeMarks: true });
await tools.call("export_images", { outputPath: "/Users/you/Documents/spring-market-preview", format: "PNG", resolution: 150 });
```

`export_images` writes `page_1.png` into the output folder and creates the folder if it is missing. `save_document` and the export tools overwrite existing files at those paths.

## As a single prompt

> Check InDesign with indesign_status (probe true). Create an A5 flyer with 3 mm bleed and 12 mm margins. Add swatches "Flyer Navy" (20,33,61) and "Flyer Gold" (242,169,0). Add paragraph styles for a centered 34 pt Arial Bold title and 11 pt body, both in Paper. Set a navy background, title "Spring Market", a thin gold rule under it, two lines of event details, and /Users/you/Pictures/market.jpg filling the lower half. Validate, save to ~/Documents/spring-market.indd and export a press-quality PDF with bleed.
