import React from 'react';

interface BrandMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name. Omit when the mark sits next to the visible "Rise Path" text. */
  title?: string;
}

/**
 * Rise Path mark: a path rising toward the morning sun.
 * Ink tile, canvas-colored path and the achievement amber for the sun, all from
 * tokens, so the mark inverts cleanly inside a [data-theme="dark"] scope.
 */
const BrandMark: React.FC<BrandMarkProps> = ({ size = 32, className = '', title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    className={`shrink-0 ${className}`}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    <rect width="32" height="32" rx="9" fill="var(--rp-fg)" />
    <circle cx="21.5" cy="11" r="4" fill="var(--rp-sun)" />
    <path
      d="M6 25c5-1 8-4 10-8s4-6 9-6.5"
      stroke="var(--rp-canvas)"
      strokeWidth="2.6"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export default BrandMark;
