// Mermaid source of a generated-lesson block. No imports, so node:test can check it.

/**
 * The generator writes the diagram to `chart`. Drafts saved over MCP are not checked block by block,
 * so a block can arrive without one: it is not drawn. An undefined source made the diagram helpers
 * throw and took the whole reader down.
 */
export const resolveMermaidSource = (block: { chart?: unknown } | null | undefined): string | null => {
    const chart = block?.chart;
    return typeof chart === 'string' && chart.trim() ? chart : null;
};
