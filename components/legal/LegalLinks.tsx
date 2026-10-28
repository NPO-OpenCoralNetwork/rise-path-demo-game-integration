import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

/**
 * A link to /terms or /privacy (Phase 4) that opens in a new tab, so a half-filled form (sign-up,
 * re-consent, agent connection) stays as it is. The icon is decorative; screen readers hear
 * `newTab` 「（新しいタブで開きます）」 / "(opens in a new tab)". The caller passes the classes
 * (the sign-up screen has its own dark style). Holds no legal text.
 */
export const LegalNewTabLink: React.FC<{
  to: string;
  newTab: string;
  className: string;
  children: React.ReactNode;
}> = ({ to, newTab, className, children }) => (
  <Link to={to} target="_blank" rel="noopener" className={className}>
    {children}
    <ExternalLink size={14} aria-hidden="true" className="ml-0.5 inline-block shrink-0 align-text-bottom" />
    <span className="sr-only">{newTab}</span>
  </Link>
);

export default LegalNewTabLink;
