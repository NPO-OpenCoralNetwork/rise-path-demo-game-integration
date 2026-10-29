import React from 'react';

/**
 * Page heading block: a small eyebrow line (a date, a section name), the page's single h1,
 * an optional description and a slot for actions or status chips on the right.
 *
 * Gothic (font-sans) only. The eyebrow is plain small text, not letter-spaced, so it reads
 * naturally in Japanese ("10月18日（土）").
 */
export type PageHeaderProps = {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-hand slot: buttons, ProgressCluster, … Wraps below the title on narrow screens. */
  actions?: React.ReactNode;
  /** id for the h1, e.g. for aria-labelledby on the page. */
  titleId?: string;
  /** Makes the h1 a focus target (tabIndex -1) for a page that moves focus to its title. */
  titleRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
};

const PageHeader: React.FC<PageHeaderProps> = ({ title, eyebrow, description, actions, titleId, titleRef, className = '' }) => (
  <header className={`flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6 ${className}`}>
    <div className="min-w-0">
      {eyebrow ? <p className="text-small font-medium text-fg-3">{eyebrow}</p> : null}
      <h1
        id={titleId}
        ref={titleRef}
        tabIndex={titleRef ? -1 : undefined}
        className={`mt-0.5 break-words text-h1 text-fg${titleRef ? ' focus:outline-none' : ''}`}
      >
        {title}
      </h1>
      {description ? <p className="mt-1 max-w-measure text-body text-fg-2">{description}</p> : null}
    </div>
    {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">{actions}</div> : null}
  </header>
);

export default PageHeader;
