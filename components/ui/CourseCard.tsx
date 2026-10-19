import React, { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Track / course card (PLAN §9 WP-09).
 *
 * - The cover is generated from the world accent: a dark-to-bright gradient plus a glyph, so
 *   every card has a cover even without an image. An `image` is optional and decorative
 *   (`alt=""`); if it fails to load, the generated cover stays.
 * - The whole card is one link or button (stretched over the card), so it is a single tab
 *   stop, works with Enter/Space and shows the focus ring around the card.
 * - The world accent is scoped to the card with `data-world`; the badge uses the AA-safe
 *   `text-world` on `bg-world-soft`.
 * - Meta (lesson count, time) and progress are optional: pass only real numbers.
 */
export type CourseCardProps = {
  /** `data-world` value: vibe, unity, blender, art, ai, sonic, pschool, web. */
  world: string;
  title: React.ReactNode;
  /** Track label shown as a chip above the title. */
  badge?: React.ReactNode;
  description?: React.ReactNode;
  /** One line under the title, e.g. "12レッスン · 約3時間". */
  meta?: React.ReactNode;
  /** Decorative glyph on the cover (an icon element). */
  glyph?: React.ReactNode;
  /** Optional cover photo. Decorative; falls back to the generated cover on error. */
  image?: string;
  /** 0–100. Rendered with its number, never as a bare bar. */
  progress?: number;
  /** Accessible label for the progress bar, e.g. "進捗". */
  progressLabel?: string;
  /** In-app route. */
  to?: string;
  /** External URL (opens in a new tab). */
  href?: string;
  onClick?: () => void;
  /** Extra controls rendered above the stretched link (e.g. admin buttons). */
  footer?: React.ReactNode;
  /** Heading level of the title. */
  headingLevel?: 2 | 3 | 4;
  /** Muted look for hidden/unavailable items (still focusable). */
  dimmed?: boolean;
  className?: string;
};

/** Dark-to-bright cover gradient built from the scoped world accent. */
export const WORLD_COVER_STYLE: React.CSSProperties = {
  backgroundImage: [
    'radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, var(--world-accent, var(--rp-primary)) 55%, white) 0%, transparent 45%)',
    'linear-gradient(150deg, color-mix(in oklab, var(--world-accent, var(--rp-primary)) 28%, black) 0%, color-mix(in oklab, var(--world-accent, var(--rp-primary)) 70%, black) 45%, var(--world-accent, var(--rp-primary)) 100%)',
  ].join(', '),
};

/** The title's link covers the whole card; the card draws the focus ring (has-[:focus-visible]). */
const STRETCH = 'after:absolute after:inset-0 after:rounded-card focus-visible:outline-none';

const CourseCard: React.FC<CourseCardProps> = ({
  world,
  title,
  badge,
  description,
  meta,
  glyph,
  image,
  progress,
  progressLabel,
  to,
  href,
  onClick,
  footer,
  headingLevel = 3,
  dimmed = false,
  className = '',
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const pct = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null;
  const interactive = Boolean(to || href || onClick);

  let titleNode: React.ReactNode = title;
  if (to) {
    titleNode = (
      <Link to={to} className={STRETCH}>
        {title}
      </Link>
    );
  } else if (href) {
    titleNode = (
      <a href={href} target="_blank" rel="noopener noreferrer" className={STRETCH}>
        {title}
      </a>
    );
  } else if (onClick) {
    titleNode = (
      <button type="button" onClick={onClick} className={`text-left ${STRETCH}`}>
        {title}
      </button>
    );
  }

  return (
    <article
      data-world={world}
      className={[
        'group relative flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-1',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
        interactive ? 'transition-[box-shadow,transform] duration-200 ease-rise hover:-translate-y-0.5 hover:shadow-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0' : '',
        dimmed ? 'opacity-60' : '',
        className,
      ].join(' ')}
    >
      <div className="relative h-20 shrink-0 overflow-hidden sm:h-28" style={WORLD_COVER_STYLE} aria-hidden="true">
        {image && !imageFailed ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        {glyph && (!image || imageFailed) ? (
          <span className="absolute bottom-2.5 right-3 text-white/85 sm:bottom-3 sm:right-4 [&>svg]:size-8 sm:[&>svg]:size-11">{glyph}</span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5 sm:px-4 sm:pb-4 sm:pt-3">
        {badge ? (
          <span className="mb-1.5 inline-flex max-w-full self-start truncate rounded-full bg-world-soft px-2.5 py-0.5 text-caption font-semibold text-world">
            {badge}
          </span>
        ) : null}
        <Heading className="line-clamp-2 text-body font-bold text-fg">{titleNode}</Heading>
        {description ? <p className="mt-1 line-clamp-2 text-small text-fg-2">{description}</p> : null}
        {meta ? <p className="tabular mt-1 text-caption font-normal text-fg-3">{meta}</p> : null}
        {pct !== null ? (
          <div className="mt-3 flex items-center gap-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={progressLabel}
              className="h-1 flex-1 overflow-hidden rounded-full bg-sunken"
            >
              <div className="h-full rounded-full bg-world-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular text-caption text-fg-3">{pct}%</span>
          </div>
        ) : null}
        {footer ? <div className="relative z-10 mt-3">{footer}</div> : null}
      </div>
    </article>
  );
};

export default CourseCard;
