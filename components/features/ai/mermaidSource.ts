// Mermaid source of a generated-lesson block. No imports, so node:test can check it.

/**
 * The generator writes the diagram to `chart`. Drafts saved over MCP are not checked block by block,
 * so `code` (the field v1 diagram blocks use) is read too. A block with neither is not drawn: an
 * undefined source made the diagram helpers throw and took the whole reader down.
 */
export const resolveMermaidSource = (block: { chart?: unknown; code?: unknown } | null | undefined): string | null => {
    for (const value of [block?.chart, block?.code]) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
};
