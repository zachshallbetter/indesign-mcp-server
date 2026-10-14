/**
 * Structured script results.
 *
 * A handler script's last expression is its result. wrapScriptForStructuredResult()
 * makes the script always evaluate to a JSON string, {"ok":true,"result":...} or
 * {"ok":false,"error":"..."}, using only ES3 so it runs in ExtendScript, and
 * parseStructuredResult() turns that back into an object on the Node side.
 */

/**
 * Last code character of a line, strings and comments skipped.
 * Returns '' for lines without code.
 */
function lastCodeChar(line) {
    let last = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '/' && line[i + 1] === '/') break;
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < line.length) {
                if (line[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (line[i] === quote) break;
                i++;
            }
            last = quote;
            continue;
        }
        if (!/\s/.test(ch)) last = ch;
    }
    return last;
}

const NON_EXPRESSION =
    /^(var|let|const|if|for|while|do|switch|function|try|return|throw|break|continue|with)\b/;

/**
 * Assign a script's trailing expression to __result__.
 * Scripts that already set __result__ are left alone.
 */
export function autoCaptureResult(script) {
    if (/\b__result__\b/.test(script)) return script;

    const lines = script.split('\n');

    let end = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t && !t.startsWith('//') && !t.startsWith('}')) {
            end = i;
            break;
        }
    }
    if (end < 0) return script;

    let start = end;
    for (;;) {
        let prev = -1;
        for (let i = start - 1; i >= 0; i--) {
            if (lines[i].trim()) {
                prev = i;
                break;
            }
        }
        if (prev < 0) break;
        const ch = lastCodeChar(lines[prev]);
        if (ch === '' || ch === ';' || ch === '{' || ch === '}') break;
        start = prev;
    }

    const head = lines[start].trim();
    if (NON_EXPRESSION.test(head) || /^[)\]}]/.test(head)) return script;

    lines[start] = lines[start].replace(/^(\s*)/, '$1var __result__ = ');
    return lines.join('\n');
}

/**
 * Wrap a handler script so ExtendScript always yields a JSON string:
 * {"ok":true,"result":...} or {"ok":false,"error":"..."}.
 */
export function wrapScriptForStructuredResult(script) {
    const captured = autoCaptureResult(script);
    return [
        'var __result__;',
        'try {',
        captured,
        '  if (typeof __result__ === "undefined") { __result__ = ""; }',
        '  function __mcpEscape(s) {',
        '    s = String(s);',
        '    var out = "";',
        '    for (var i = 0; i < s.length; i++) {',
        '      var c = s.charAt(i);',
        '      var code = s.charCodeAt(i);',
        '      if (c === "\\\\") out += "\\\\\\\\";',
        '      else if (c === "\\"") out += "\\\\\\"";',
        '      else if (c === "\\n") out += "\\\\n";',
        '      else if (c === "\\r") out += "\\\\r";',
        '      else if (c === "\\t") out += "\\\\t";',
        '      else if (code < 32) out += "\\\\u" + ("0000" + code.toString(16)).slice(-4);',
        '      else out += c;',
        '    }',
        '    return out;',
        '  }',
        '  var __payload = "{\\"ok\\":true,\\"result\\":\\"" + __mcpEscape(__result__) + "\\"}";',
        '  __payload;',
        '} catch (__mcpErr) {',
        '  var __msg = (__mcpErr && __mcpErr.message) ? __mcpErr.message : String(__mcpErr);',
        '  function __mcpEscapeErr(s) {',
        '    s = String(s);',
        '    var out = "";',
        '    for (var i = 0; i < s.length; i++) {',
        '      var c = s.charAt(i);',
        '      if (c === "\\\\") out += "\\\\\\\\";',
        '      else if (c === "\\"") out += "\\\\\\"";',
        '      else if (c === "\\n") out += "\\\\n";',
        '      else if (c === "\\r") out += "\\\\r";',
        '      else out += c;',
        '    }',
        '    return out;',
        '  }',
        '  "{\\"ok\\":false,\\"error\\":\\"" + __mcpEscapeErr(__msg) + "\\"}";',
        '}',
    ].join('\n');
}

/**
 * Parse what a wrapped script returned.
 * @param {any} raw the transport's output
 * @param {{ appLabel?: string }} [opts] used in the empty-response message
 * @returns {{ ok: boolean, result?: any, error?: string, raw: string }}
 */
export function parseStructuredResult(raw, { appLabel = 'the application' } = {}) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) {
        return { ok: false, error: `Empty response from ${appLabel}`, raw: text };
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
            return {
                ok: Boolean(parsed.ok),
                result: parsed.result,
                error: parsed.error,
                raw: text,
            };
        }
        return { ok: true, result: parsed, raw: text };
    } catch {
        const isError =
            /^ERROR:/i.test(text) ||
            /^Error /i.test(text) ||
            (/failed/i.test(text) && /error/i.test(text));
        if (isError) {
            return { ok: false, error: text, raw: text };
        }
        return { ok: true, result: text, raw: text };
    }
}
