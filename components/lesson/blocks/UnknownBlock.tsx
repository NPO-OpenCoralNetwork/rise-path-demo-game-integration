import React from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * A block type this reader cannot render (newer content, typo). Dev builds show a warning so
 * authors notice; production renders nothing. `data-unknown-block` lets checks count them.
 */
export default function UnknownBlock({ block }: { block: { id?: unknown; type?: unknown } }) {
  const type = typeof block.type === 'string' ? block.type : '(missing)';
  if (!import.meta.env.DEV) return <div hidden data-unknown-block={type} />;
  return (
    <div
      data-unknown-block={type}
      role="note"
      lang="en"
      className="flex items-start gap-3 rounded-card border border-dashed border-danger/50 bg-danger/5 p-4 text-small text-fg-2"
    >
      <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <p className="m-0">
        Unsupported block type <code>{type}</code>
        {typeof block.id === 'string' ? <> (id <code>{block.id}</code>)</> : null}. Add a renderer in
        {' '}<code>components/lesson/blocks/registry.tsx</code> or fix the lesson JSON.
      </p>
    </div>
  );
}
