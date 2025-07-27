/**
 * Utility functions for string handling and escaping.
 */

/**
 * Escapes backslashes, double quotes, and control characters for JSX/AppleScript.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeJsxString(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

/**
 * Formats a response with a consistent structure.
 * @param {any} result - The result to format.
 * @param {string} [operation="Operation"] - The operation name.
 * @returns {object} Formatted response object.
 */
export function formatResponse(result, operation = "Operation") {
    return {
        success: true,
        operation,
        result,
        timestamp: new Date().toISOString()
    };
}

/**
 * Formats an error response with a consistent structure.
 * @param {any} error - The error to format.
 * @param {string} [operation="Operation"] - The operation name.
 * @returns {object} Formatted error response object.
 */
export function formatErrorResponse(error, operation = "Operation") {
    return {
        success: false,
        operation,
        result: error,
        timestamp: new Date().toISOString()
    };
}

/**
 * Removes emoticons (emoji characters) from a string.
 * @param {string} str - The string to process.
 * @returns {string} The string with emoticons removed.
 */
export function removeEmoticons(str) {
    if (typeof str !== 'string') return '';
    // Remove most emoji and emoticon Unicode ranges.
    return str
        .replace(
            /([\u203C-\u3299]|[\uD83C-\uDBFF\uDC00-\uDFFF]+|[\u200D\uFE0F])/g,
            ''
        )
        .replace(
            /([\u231A-\u231B]|\u23E9|\u23EA|\u23EB|\u23EC|\u23F0|\u23F3|\u25FD|\u25FE|\u2614|\u2615|\u2648-\u2653|\u267F|\u2693|\u26A1|\u26AA|\u26AB|\u26BD|\u26BE|\u26C4|\u26C5|\u26CE|\u26D4|\u26EA|\u26F2|\u26F3|\u26F5|\u26FA|\u26FD|\u2705|\u270A|\u270B|\u2728|\u274C|\u274E|\u2753-\u2755|\u2757|\u2795-\u2797|\u27B0|\u27BF|\u2B1B|\u2B1C|\u2B50|\u2B55|\u3030|\u303D|\u3297|\u3299)/g,
            ''
        );
}

/**
 * Converts a Markdown string to plain text by stripping Markdown syntax.
 * This is a simple implementation and does not cover all edge cases.
 * @param {string} markdown - The Markdown string to convert.
 * @returns {string} The plain text result.
 */
export function markdownToPlainText(markdown) {
    if (typeof markdown !== 'string') return '';
    let text = markdown;

    // Remove code blocks
    text = text.replace(/```[\s\S]*?```/g, '');

    // Remove inline code
    text = text.replace(/`([^`]+)`/g, '$1');

    // Remove images ![alt](url)
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');

    // Remove links [text](url)
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove emphasis (bold, italics, strikethrough)
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');

    // Remove headings
    text = text.replace(/^#{1,6}\s*/gm, '');

    // Remove blockquotes
    text = text.replace(/^\s*>+\s?/gm, '');

    // Remove horizontal rules
    text = text.replace(/^(-\s*?){3,}|^(_\s*?){3,}|^(\*\s*?){3,}$/gm, '');

    // Remove unordered list markers
    text = text.replace(/^\s*[-*+]\s+/gm, '');

    // Remove ordered list markers
    text = text.replace(/^\s*\d+\.\s+/gm, '');

    // Remove extra newlines
    text = text.replace(/\n{2,}/g, '\n');

    // Trim leading/trailing whitespace
    return text.trim();
}

/**
 * Finds all occurrences of a word or words in a string.
 * @param {string} text - The text to search in.
 * @param {string|string[]} words - The word or array of words to find.
 * @param {Object} [options] - Optional settings.
 * @param {boolean} [options.caseSensitive=false] - Whether the search is case sensitive.
 * @param {boolean} [options.wholeWord=true] - Whether to match whole words only.
 * @returns {Array<{word: string, index: number}>} Array of objects with found word and its index in the text.
 */
export function findWords(text, words, options = {}) {
    if (typeof text !== 'string' || !words) return [];
    const {
        caseSensitive = false,
        wholeWord = true
    } = options;

    const wordList = Array.isArray(words) ? words : [words];
    const results = [];

    for (const word of wordList) {
        if (!word) continue;
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = wholeWord ? `\\b${escapedWord}\\b` : escapedWord;
        const flags = 'g' + (caseSensitive ? '' : 'i');
        const regex = new RegExp(pattern, flags);

        let match;
        while ((match = regex.exec(text)) !== null) {
            results.push({ word, index: match.index });
            // Prevent infinite loop for zero-width matches
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
    }
    return results;
}
