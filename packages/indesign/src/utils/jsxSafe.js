/**
 * Escaping and validation helpers for values that end up in ExtendScript.
 *
 * ExtendScript is not sandboxed: it can read/write files and run system
 * commands. Values interpolated into script text must never be raw caller
 * input. Prefer str(), num(), enumOf(), bool(), and jsxPath() at call sites.
 *
 * The helpers are adobe-mcp-core's, shared with every server; the InDesign
 * enum allow-lists below and the INDESIGN_ALLOWED_DIRS variable are this
 * server's own.
 */
import {
    str, num, index, bool, enumOf, json, numList, measure, jsxPath,
    buildAllowedDirs as coreAllowedDirs, validateFilePath as coreValidateFilePath,
} from 'adobe-mcp-core';

export { str, num, index, bool, enumOf, json, numList, measure, jsxPath };

/** Common InDesign enum allow-lists used by tools. */
export const ALLOWED = {
    alignment: [
        'LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN',
        'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED',
    ],
    fitOption: [
        'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'PROPORTIONALLY',
        'FILL_PROPORTIONALLY', 'CENTER_CONTENT', 'APPLY_FRAME_FITTING_OPTIONS',
    ],
    colorSpace: ['CMYK', 'RGB', 'LAB'],
    colorModel: ['PROCESS', 'SPOT', 'REGISTRATION'],
    imageFormat: ['PNG', 'JPG', 'JPEG', 'TIFF', 'GIF'],
    pdfPreset: [
        'HighQualityPrint', 'PressQuality', 'SmallestFileSize',
        'PDFX1a2001', 'PDFX32002', 'PDFX42008',
    ],
    pageOrientation: ['PORTRAIT', 'LANDSCAPE'],
    uiColor: [
        'LIGHT_BLUE', 'RED', 'GREEN', 'BLUE', 'YELLOW', 'MAGENTA', 'CYAN',
        'GRAY', 'BLACK', 'ORANGE', 'DARK_GREEN', 'TEAL', 'TAN', 'BROWN',
        'VIOLET', 'GOLD', 'DARK_BLUE', 'PINK', 'LAVENDER', 'BRICK_RED',
        'OLIVE_GREEN', 'PEACH', 'BURGUNDY', 'GRASS_GREEN', 'OCHRE',
        'PURPLE', 'LIGHT_GRAY', 'CHARCOAL', 'GRID_BLUE', 'GRID_ORANGE',
        'FIESTA', 'LIGHT_OLIVE', 'LIPSTICK', 'CUTE_TEAL', 'SULPHUR',
        'GRID_GREEN', 'WHITE',
    ],
};

/**
 * Directories file operations are confined to: home plus INDESIGN_ALLOWED_DIRS.
 * Split on path.delimiter (';' on Windows) so drive letters stay intact.
 */
export function buildAllowedDirs() {
    return coreAllowedDirs('INDESIGN_ALLOWED_DIRS');
}

/**
 * Path validation for Windows and macOS.
 * Platform-aware deny-list; case-insensitive comparison on Windows.
 */
export function validateFilePath(filePath, allowedDirs = buildAllowedDirs()) {
    return coreValidateFilePath(filePath, allowedDirs);
}
