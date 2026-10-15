/**
 * The InDesign MCP server: tool definitions, one handler per tool, and the
 * instructions sent to clients. The protocol handling (tools/list, tools/call,
 * argument aliases and warnings, error results) is adobe-mcp-core's server shell.
 */
import { createMcpServer } from 'adobe-mcp-core';
import { allToolDefinitions } from '../types/index.js';
import {
    BookHandlers,
    DocumentHandlers,
    ExportHandlers,
    GraphicsHandlers,
    GroupHandlers,
    HelpHandlers,
    LayerHandlers,
    MasterSpreadHandlers,
    PageHandlers,
    PageItemHandlers,
    SpreadHandlers,
    StyleHandlers,
    TextHandlers,
    UtilityHandlers
} from '../handlers/index.js';
import { ScriptExecutor } from './scriptExecutor.js';
import { PARAM_ALIASES, normalizeValues } from '../handlers/aliases.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// Sent to clients at initialize; MCP clients give these to the model.
export const SERVER_INSTRUCTIONS = `Tools drive a running Adobe InDesign (macOS or Windows) on the user's machine.

Start with indesign_status if you are unsure InDesign is reachable. Most tools act on the active document: create_document or open_document first, and check get_document_info when you need page size or count.

Conventions:
- Positions and sizes are millimeters from the top-left corner of the target page unless a parameter says otherwise (strokes and font sizes are points).
- Indexes are 0-based integers; pageIndex defaults to the active page where it is optional. Page ranges in export_pdf, export_images and apply_master_spread are 1-based page numbers ("1-3,5").
- The page-item and group tools take itemIndex/groupIndex in page.allPageItems, the numbering list_page_items and list_groups return (nested items included). frameIndex counts page.textFrames only. apply_color, apply_object_style and get_image_info count the collection their description names.
- Colors are swatch names that exist in the document (see list_color_swatches), or "#RRGGBB", which creates an RGB swatch.
- Fonts are fontName: "Family\\tStyle" (for example "Arial\\tBold") or a family name. Stroke weight is strokeWeight, in points. alignment takes InDesign Justification names: LEFT_ALIGN, CENTER_ALIGN, RIGHT_ALIGN, LEFT_JUSTIFIED, RIGHT_JUSTIFIED, CENTER_JUSTIFIED, FULLY_JUSTIFIED.
- File paths must be absolute and inside the user's home folder or INDESIGN_ALLOWED_DIRS.

A call that fails returns isError with a message such as "No document open" or "Error ...": read it and fix the arguments rather than retrying unchanged. A result with a "warnings" list names arguments that were ignored (unknown names, with the closest valid one) or deprecated: correct them in later calls. Tool annotations mark destructive tools (delete_*, cleanup_document, close_document discards unsaved changes, execute_indesign_code); confirm with the user before using them on work that is not saved.

help({ tool }) describes any tool's parameters; help({ category }) lists tools by area.`;

/** Every advertised tool's handler, called with canonical argument names. */
export const TOOL_HANDLERS = {
    get_document_info: () => DocumentHandlers.getDocumentInfo(),
    create_document: (args) => DocumentHandlers.createDocument(args),
    open_document: (args) => DocumentHandlers.openDocument(args),
    save_document: (args) => DocumentHandlers.saveDocument(args),
    close_document: () => DocumentHandlers.closeDocument(),

    // Document Advanced Tools
    preflight_document: (args) => DocumentHandlers.preflightDocument(args),
    zoom_to_page: (args) => DocumentHandlers.zoomToPage(args),
    data_merge: (args) => DocumentHandlers.dataMerge(args),

    // Document Elements & Styles
    get_document_elements: (args) => DocumentHandlers.getDocumentElements(args),
    get_document_styles: (args) => DocumentHandlers.getDocumentStyles(args),
    get_document_colors: (args) => DocumentHandlers.getDocumentColors(args),

    // Document Preferences
    get_document_preferences: (args) => DocumentHandlers.getDocumentPreferences(args),
    set_document_preferences: (args) => DocumentHandlers.setDocumentPreferences(args),

    // Document Stories & Text
    get_document_stories: (args) => DocumentHandlers.getDocumentStories(args),
    find_text_in_document: (args) => DocumentHandlers.findTextInDocument(args),

    // Document Layers & Organization
    get_document_layers: (args) => DocumentHandlers.getDocumentLayers(args),
    organize_document_layers: (args) => DocumentHandlers.organizeDocumentLayers(args),

    // Document Hyperlinks & Interactivity
    get_document_hyperlinks: (args) => DocumentHandlers.getDocumentHyperlinks(args),
    create_document_hyperlink: (args) => DocumentHandlers.createDocumentHyperlink(args),

    // Document Sections & Numbering
    get_document_sections: () => DocumentHandlers.getDocumentSections(),
    create_document_section: (args) => DocumentHandlers.createDocumentSection(args),

    // Document XML & Structure
    get_document_xml_structure: (args) => DocumentHandlers.getDocumentXmlStructure(args),
    export_document_xml: (args) => DocumentHandlers.exportDocumentXml(args),

    // Document Cloud & Collaboration
    save_document_to_cloud: (args) => DocumentHandlers.saveDocumentToCloud(args),
    open_cloud_document: (args) => DocumentHandlers.openCloudDocument(args),

    // Document Grid & Layout
    get_document_grid_settings: () => DocumentHandlers.getDocumentGridSettings(),
    set_document_grid_settings: (args) => DocumentHandlers.setDocumentGridSettings(args),
    get_document_layout_preferences: () => DocumentHandlers.getDocumentLayoutPreferences(),
    set_document_layout_preferences: (args) => DocumentHandlers.setDocumentLayoutPreferences(args),

    // Document Validation & Cleanup
    validate_document: (args) => DocumentHandlers.validateDocument(args),
    cleanup_document: (args) => DocumentHandlers.cleanupDocument(args),

    // Page Management
    add_page: (args) => PageHandlers.addPage(args),
    get_page_info: (args) => PageHandlers.getPageInfo(args),
    navigate_to_page: (args) => PageHandlers.navigateToPage(args),

    // Advanced Page Management
    duplicate_page: (args) => PageHandlers.duplicatePage(args),
    move_page: (args) => PageHandlers.movePage(args),
    delete_page: (args) => PageHandlers.deletePage(args),
    set_page_properties: (args) => PageHandlers.setPageProperties(args),
    set_page_background: (args) => PageHandlers.setPageBackground(args),
    adjust_page_layout: (args) => PageHandlers.adjustPageLayout(args),
    resize_page: (args) => PageHandlers.resizePage(args),
    create_page_guides: (args) => PageHandlers.createPageGuides(args),
    place_file_on_page: (args) => PageHandlers.placeFileOnPage(args),
    place_xml_on_page: (args) => PageHandlers.placeXmlOnPage(args),
    snapshot_page_layout: (args) => PageHandlers.snapshotPageLayout(args),
    delete_page_layout_snapshot: (args) => PageHandlers.deletePageLayoutSnapshot(args),
    delete_all_page_layout_snapshots: (args) => PageHandlers.deleteAllPageLayoutSnapshots(args),
    reframe_page: (args) => PageHandlers.reframePage(args),
    select_page: (args) => PageHandlers.selectPage(args),
    get_page_content_summary: (args) => PageHandlers.getPageContentSummary(args),

    // Text Management
    create_text_frame: (args) => TextHandlers.createTextFrame(args),
    edit_text_frame: (args) => TextHandlers.editTextFrame(args),
    create_table: (args) => TextHandlers.createTable(args),
    populate_table: (args) => TextHandlers.populateTable(args),
    find_replace_text: (args) => TextHandlers.findReplaceText(args),

    // Graphics Management
    create_rectangle: (args) => GraphicsHandlers.createRectangle(args),
    create_ellipse: (args) => GraphicsHandlers.createEllipse(args),
    create_polygon: (args) => GraphicsHandlers.createPolygon(args),
    place_image: (args) => GraphicsHandlers.placeImage(args),
    create_object_style: (args) => GraphicsHandlers.createObjectStyle(args),
    list_object_styles: () => GraphicsHandlers.listObjectStyles(),
    apply_object_style: (args) => GraphicsHandlers.applyObjectStyle(args),
    get_image_info: (args) => GraphicsHandlers.getImageInfo(args),

    // Style Management
    create_paragraph_style: (args) => StyleHandlers.createParagraphStyle(args),
    create_character_style: (args) => StyleHandlers.createCharacterStyle(args),
    apply_paragraph_style: (args) => StyleHandlers.applyParagraphStyle(args),
    apply_character_style: (args) => StyleHandlers.applyCharacterStyle(args),
    apply_color: (args) => StyleHandlers.applyColor(args),
    create_color_swatch: (args) => StyleHandlers.createColorSwatch(args),
    list_styles: (args) => StyleHandlers.listStyles(args),
    list_color_swatches: () => StyleHandlers.listColorSwatches(),

    // Export Functions
    export_pdf: (args) => ExportHandlers.exportPDF(args),
    export_images: (args) => ExportHandlers.exportImages(args),
    export_epub: (args) => ExportHandlers.exportEPUB(args),
    package_document: (args) => ExportHandlers.packageDocument(args),

    // Master Spread Management
    create_master_spread: (args) => MasterSpreadHandlers.createMasterSpread(args),
    list_master_spreads: (args) => MasterSpreadHandlers.listMasterSpreads(args),
    delete_master_spread: (args) => MasterSpreadHandlers.deleteMasterSpread(args),
    duplicate_master_spread: (args) => MasterSpreadHandlers.duplicateMasterSpread(args),
    apply_master_spread: (args) => MasterSpreadHandlers.applyMasterSpread(args),
    create_master_text_frame: (args) => MasterSpreadHandlers.createMasterTextFrame(args),
    create_master_rectangle: (args) => MasterSpreadHandlers.createMasterRectangle(args),
    create_master_guides: (args) => MasterSpreadHandlers.createMasterGuides(args),
    get_master_spread_info: (args) => MasterSpreadHandlers.getMasterSpreadInfo(args),
    detach_master_items: (args) => MasterSpreadHandlers.detachMasterItems(args),
    remove_master_override: (args) => MasterSpreadHandlers.removeMasterOverride(args),

    // Spread Management
    list_spreads: (args) => SpreadHandlers.listSpreads(args),
    get_spread_info: (args) => SpreadHandlers.getSpreadInfo(args),
    duplicate_spread: (args) => SpreadHandlers.duplicateSpread(args),
    move_spread: (args) => SpreadHandlers.moveSpread(args),
    delete_spread: (args) => SpreadHandlers.deleteSpread(args),
    set_spread_properties: (args) => SpreadHandlers.setSpreadProperties(args),
    create_spread_guides: (args) => SpreadHandlers.createSpreadGuides(args),
    place_file_on_spread: (args) => SpreadHandlers.placeFileOnSpread(args),
    place_xml_on_spread: (args) => SpreadHandlers.placeXmlOnSpread(args),
    select_spread: (args) => SpreadHandlers.selectSpread(args),
    get_spread_content_summary: (args) => SpreadHandlers.getSpreadContentSummary(args),

    // Layer Management
    create_layer: (args) => LayerHandlers.createLayer(args),
    set_active_layer: (args) => LayerHandlers.setActiveLayer(args),
    list_layers: (args) => LayerHandlers.listLayers(args),

    // Book Management
    create_book: (args) => BookHandlers.createBook(args),
    open_book: (args) => BookHandlers.openBook(args),
    list_books: (args) => BookHandlers.listBooks(args),
    add_document_to_book: (args) => BookHandlers.addDocumentToBook(args),
    synchronize_book: (args) => BookHandlers.synchronizeBook(args),
    repaginate_book: (args) => BookHandlers.repaginateBook(args),
    update_all_cross_references: (args) => BookHandlers.updateAllCrossReferences(args),
    update_all_numbers: (args) => BookHandlers.updateAllNumbers(args),
    update_chapter_and_paragraph_numbers: (args) => BookHandlers.updateChapterAndParagraphNumbers(args),
    export_book: (args) => BookHandlers.exportBook(args),
    package_book: (args) => BookHandlers.packageBook(args),
    preflight_book: (args) => BookHandlers.preflightBook(args),
    print_book: (args) => BookHandlers.printBook(args),
    get_book_info: (args) => BookHandlers.getBookInfo(args),
    set_book_properties: (args) => BookHandlers.setBookProperties(args),

    // PageItem Management
    get_page_item_info: (args) => PageItemHandlers.getPageItemInfo(args),
    select_page_item: (args) => PageItemHandlers.selectPageItem(args),
    move_page_item: (args) => PageItemHandlers.movePageItem(args),
    resize_page_item: (args) => PageItemHandlers.resizePageItem(args),
    set_page_item_properties: (args) => PageItemHandlers.setPageItemProperties(args),
    duplicate_page_item: (args) => PageItemHandlers.duplicatePageItem(args),
    delete_page_item: (args) => PageItemHandlers.deletePageItem(args),
    list_page_items: (args) => PageItemHandlers.listPageItems(args),

    // Group Management
    create_group: (args) => GroupHandlers.createGroup(args),
    create_group_from_items: (args) => GroupHandlers.createGroupFromItems(args),
    ungroup: (args) => GroupHandlers.ungroup(args),
    get_group_info: (args) => GroupHandlers.getGroupInfo(args),
    add_item_to_group: (args) => GroupHandlers.addItemToGroup(args),
    remove_item_from_group: (args) => GroupHandlers.removeItemFromGroup(args),
    list_groups: (args) => GroupHandlers.listGroups(args),
    set_group_properties: (args) => GroupHandlers.setGroupProperties(args),

    // Utility Functions
    indesign_status: (args) => UtilityHandlers.getIndesignStatus(args),
    execute_indesign_code: (args) => UtilityHandlers.executeInDesignCode(args),
    view_document: () => UtilityHandlers.viewDocument(),
    get_session_info: () => UtilityHandlers.getSessionInfo(),
    clear_session: () => UtilityHandlers.clearSession(),

    // Help System
    help: (args) => HelpHandlers.getHelp(args),
};

export class InDesignMCPServer {
    constructor() {
        this.mcp = createMcpServer({
            info: { name: pkg.name, version: pkg.version },
            instructions: SERVER_INSTRUCTIONS,
            tools: allToolDefinitions,
            handlers: TOOL_HANDLERS,
            aliases: PARAM_ALIASES,
            normalizeValues,
        });
        this.server = this.mcp.server;
        ScriptExecutor.cleanupTempScripts();
    }

    /**
     * Run a tool. Older parameter names and values are mapped to the canonical
     * ones first (src/handlers/aliases.js); the result lists any deprecated or
     * unknown arguments under `warnings`.
     */
    async handleToolCall(name, args) {
        return this.mcp.handleToolCall(name, args);
    }

    async run() {
        // Nothing may be written to stdout once connected: it carries the protocol.
        await this.mcp.run();
    }
}
