/**
 * MCP tool annotations (title, readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint) for every tool. Clients use these to decide what needs the
 * user's confirmation, so the lists are explicit rather than inferred.
 *
 * - readOnly: does not change any document, book, file or app state.
 * - destructive: can delete or overwrite content in a way undo may not cover
 *   (only meaningful when not read-only).
 * - idempotent: calling again with the same arguments has no further effect.
 * - openWorld: talks to something beyond the local InDesign (cloud, printer).
 */
import { createAnnotations } from 'adobe-mcp-core';

const READ_ONLY = new Set([
    'help', 'indesign_status', 'get_session_info', 'view_document',
    'get_document_info', 'get_document_elements', 'get_document_styles', 'get_document_colors',
    'get_document_preferences', 'get_document_stories', 'get_document_layers', 'get_document_hyperlinks',
    'get_document_sections', 'get_document_xml_structure', 'get_document_grid_settings',
    'get_document_layout_preferences', 'validate_document',
    'get_page_info', 'get_page_content_summary', 'get_image_info', 'get_page_item_info', 'list_page_items',
    'get_group_info', 'list_groups', 'list_styles', 'list_object_styles', 'list_color_swatches',
    'list_master_spreads', 'get_master_spread_info', 'list_spreads', 'get_spread_info',
    'get_spread_content_summary', 'list_layers', 'list_books', 'get_book_info',
]);

const DESTRUCTIVE = new Set([
    'close_document', 'cleanup_document', 'organize_document_layers', 'find_text_in_document',
    'find_replace_text', 'edit_text_frame', 'populate_table', 'execute_indesign_code',
    'delete_page', 'delete_page_layout_snapshot', 'delete_all_page_layout_snapshots',
    'delete_page_item', 'ungroup', 'remove_item_from_group', 'delete_master_spread',
    'detach_master_items', 'remove_master_override', 'delete_spread',
    'save_document', 'export_pdf', 'export_images', 'export_epub', 'export_document_xml',
    'package_document', 'export_book', 'package_book', 'preflight_book', 'set_document_preferences',
]);

const IDEMPOTENT = new Set([
    'navigate_to_page', 'zoom_to_page', 'select_page', 'select_page_item', 'select_spread',
    'set_active_layer', 'clear_session', 'save_document', 'close_document',
    'set_document_preferences', 'set_document_grid_settings', 'set_document_layout_preferences',
    'set_page_properties', 'set_page_background', 'set_page_item_properties', 'set_group_properties',
    'set_spread_properties', 'set_book_properties', 'apply_paragraph_style', 'apply_character_style',
    'apply_object_style', 'apply_color', 'apply_master_spread', 'resize_page', 'move_page_item',
    'resize_page_item', 'export_pdf', 'export_images', 'export_epub', 'export_document_xml',
    'synchronize_book', 'repaginate_book', 'update_all_cross_references', 'update_all_numbers',
    'update_chapter_and_paragraph_numbers', 'cleanup_document', 'organize_document_layers',
    'delete_all_page_layout_snapshots', 'remove_master_override',
]);

const OPEN_WORLD = new Set(['save_document_to_cloud', 'open_cloud_document', 'print_book']);

const { titleFor, annotationsFor, unknownAnnotationNames } = createAnnotations({
    readOnly: READ_ONLY,
    destructive: DESTRUCTIVE,
    idempotent: IDEMPOTENT,
    openWorld: OPEN_WORLD,
    words: { pdf: 'PDF', xml: 'XML', epub: 'EPUB', indesign: 'InDesign', id: 'ID' },
});

/** "export_document_xml" -> "Export Document XML" */
export { titleFor, annotationsFor, unknownAnnotationNames };
