/**
 * Tool result shapes and failure detection.
 *
 * Handler scripts report failures as strings ("No document open",
 * "Error adding page: ..."), so these patterns are the contract: a failure
 * message starts with one of FAILURE_START, or is a short single line
 * containing one of FAILURE_SHORT. A server can add its own patterns.
 */

const FAILURE_START = /^(no document open|no documents? (is )?open|no active document|there is no document|error\b|failed\b|invalid\b|cannot\b|could not\b|unable to\b)/i;
const FAILURE_SHORT = /\b(not found|out of range|does not exist|not open)\b/i;

/**
 * Failure detection with optional extra patterns.
 * @param {{ start?: RegExp[], short?: RegExp[] }} [extra]
 * @returns {(result: any) => boolean}
 */
export function createFailureDetector(extra = {}) {
    const starts = [FAILURE_START, ...(extra.start ?? [])];
    const shorts = [FAILURE_SHORT, ...(extra.short ?? [])];
    return function looksLikeFailure(result) {
        if (typeof result !== 'string') return false;
        const text = result.trim();
        if (starts.some((re) => re.test(text))) return true;
        return text.length <= 200 && !text.includes('\n') && shorts.some((re) => re.test(text));
    };
}

/** True when a script's string result reports a failure. */
export const looksLikeFailure = createFailureDetector();

/**
 * A result with a consistent structure. `success` is false when the result
 * string reports a failure.
 */
export function formatResponse(result, operation = 'Operation', detect = looksLikeFailure) {
    return {
        success: !detect(result),
        operation,
        result,
        timestamp: new Date().toISOString(),
    };
}

/** An error result with the same structure. */
export function formatErrorResponse(error, operation = 'Operation') {
    return {
        success: false,
        operation,
        result: error,
        timestamp: new Date().toISOString(),
    };
}

/** Add `warnings` to a tool result object when there are any. */
export function withWarnings(result, warnings) {
    if (!warnings.length || !result || typeof result !== 'object' || Array.isArray(result)) return result;
    return { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
}
