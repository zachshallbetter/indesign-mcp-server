# Basic flyer workflow

Prerequisites: InDesign running, MCP server configured, macOS or Windows.

1. Confirm the bridge is healthy:

```text
Use indesign_status with probe=true
```

2. Create an A4 document:

```text
create_document width=210 height=297 pages=1
```

3. Add a title:

```text
create_text_frame content="Spring Collection" fontSize=36 alignment=CENTER
```

4. Place a hero image (path must be under your home directory or INDESIGN_ALLOWED_DIRS):

```text
place_image filePath="/Users/you/Pictures/hero.jpg" scale=100 fitMode=PROPORTIONALLY
```

5. Export PDF:

```text
export_pdf filePath="/Users/you/Desktop/flyer.pdf" preset="High Quality Print"
```

## Claude Desktop tip

After tools load, start with: "Call indesign_status with probe true, then create an A4 flyer with a centered title."
