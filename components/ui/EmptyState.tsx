import React from 'react';

/**
 * An honest "nothing here yet" panel: an icon tile, a short title, one or two sentences
 * that say what will appear here and how, and an optional action.
 *
 * - `layout="inline"` (default): icon left, text right, inside a card. Dashboard side cards.
 * - `layout="centered"`: stacked and centered, for an empty page or list.
 * - `tone` colors the icon tile only: `sun` (achievement-related, e.g. review), `primary`
 *   (AI / product features) or `neutral`.
 */
export type EmptyStateTone = 'primary' | 'sun' | 'neutral';

export type EmptyStateProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Decorative icon (aria-hidden is applied to the tile). */
  icon?: React.ReactNode;
  tone?: EmptyStateTone;
  action?: React.ReactNode;
  layout?: 'inline' | 'centered';
  /** Heading level for the title; pick the one that fits the page outline. */
  headingLevel?: 2 | 3 | 4;
  /** Render without the card border/background (when the parent is already a card). */
  bare?: boolean;
  className?: string;
};

const TONES: Record<EmptyStateTone, string> = {
  primary: 'bg-primary-soft text-primary-text',
  sun: 'bg-sun-soft text-sun-text',
  neutral: 'bg-sunken text-fg-2',
};

const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  tone = 'neutral',
  action,
  layout = 'inline',
  headingLevel = 3,
  bare = false,
  className = '',
}) => {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const centered = layout === 'centered';
  const frame = bare ? '' : 'rounded-card border border-line bg-surface shadow-1';
  const padding = centered ? 'px-6 py-10' : 'p-5';

  return (
    <section
      className={`${frame} ${padding} ${centered ? 'flex flex-col items-center text-center' : 'flex items-start gap-4'} ${className}`}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={`grid size-10 shrink-0 place-items-center rounded-control ${TONES[tone]} ${centered ? 'mb-3' : ''}`}
        >
          {icon}
        </div>
      ) : null}
      <div className={`min-w-0 ${centered ? 'max-w-form' : 'flex-1'}`}>
        <Heading className={centered ? 'text-h3 text-fg' : 'text-body font-bold text-fg'}>{title}</Heading>
        {description ? <p className="mt-1 text-small text-fg-3">{description}</p> : null}
        {action ? <div className={`mt-3 flex flex-wrap gap-2 ${centered ? 'justify-center' : ''}`}>{action}</div> : null}
      </div>
    </section>
  );
};

export default EmptyState;
