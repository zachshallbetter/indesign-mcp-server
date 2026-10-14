/**
 * MCP tool annotations (title, readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint). Clients use these to decide what needs the user's
 * confirmation, so each server lists its tools explicitly rather than having
 * them inferred:
 *
 * - readOnly: does not change any document, file or app state.
 * - destructive: can delete or overwrite content in a way undo may not cover
 *   (only meaningful when not read-only).
 * - idempotent: calling again with the same arguments has no further effect.
 * - openWorld: talks to something beyond the local application (cloud, printer).
 */

/**
 * @param {object} lists
 * @param {Iterable<string>} [lists.readOnly]
 * @param {Iterable<string>} [lists.destructive]
 * @param {Iterable<string>} [lists.idempotent]
 * @param {Iterable<string>} [lists.openWorld]
 * @param {Record<string, string>} [lists.words] title-case overrides, e.g. { pdf: 'PDF' }
 */
export function createAnnotations({ readOnly = [], destructive = [], idempotent = [], openWorld = [], words = {} } = {}) {
    const READ_ONLY = new Set(readOnly);
    const DESTRUCTIVE = new Set(destructive);
    const IDEMPOTENT = new Set(idempotent);
    const OPEN_WORLD = new Set(openWorld);
    const WORDS = { pdf: 'PDF', xml: 'XML', svg: 'SVG', png: 'PNG', jpg: 'JPG', id: 'ID', ...words };

    /** "export_document_xml" -> "Export Document XML" */
    function titleFor(name) {
        return name.split('_').map((w) => WORDS[w] ?? w[0].toUpperCase() + w.slice(1)).join(' ');
    }

    function annotationsFor(name) {
        const ro = READ_ONLY.has(name);
        return {
            title: titleFor(name),
            readOnlyHint: ro,
            destructiveHint: !ro && DESTRUCTIVE.has(name),
            idempotentHint: ro || IDEMPOTENT.has(name),
            openWorldHint: OPEN_WORLD.has(name),
        };
    }

    /** Names in the lists that are not real tools (for a test to catch). */
    function unknownAnnotationNames(toolNames) {
        const known = new Set(toolNames);
        return [...READ_ONLY, ...DESTRUCTIVE, ...IDEMPOTENT, ...OPEN_WORLD].filter((n) => !known.has(n));
    }

    /** Tool definitions with `title` and `annotations` filled in. */
    function annotate(definitions) {
        return definitions.map((t) => {
            const { title, ...hints } = annotationsFor(t.name);
            return { ...t, title: t.title ?? title, annotations: { ...hints, ...(t.annotations ?? {}) } };
        });
    }

    return { titleFor, annotationsFor, unknownAnnotationNames, annotate };
}
