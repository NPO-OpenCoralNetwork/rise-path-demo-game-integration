import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { SUPPORT_CONTACT, type SupportContactInfo } from '../../config/support';

/**
 * The one "contact us" line (Phase 4, design §5.11): the channel set as VITE_SUPPORT_CONTACT
 * (config/support.ts), or, when it is unset or invalid, the honest fallback /ai-safety already
 * uses: tell the staff at the learning site. A form opens in a new tab (said for screen readers);
 * a mail address opens the mail app.
 */

const copy = {
  en: {
    contact: 'Contact:',
    staff: 'Please tell the staff at your learning site.',
    newTab: '(opens in a new tab)',
  },
  jp: {
    contact: 'お問い合わせ:',
    staff: 'ご利用の拠点のスタッフにお伝えください。',
    newTab: '（新しいタブで開きます）',
  },
} as const;

export type SupportContactProps = {
  className?: string;
  /** false under a heading that already says 「お問い合わせ」 / "Contact" (Settings): the link alone. */
  showLabel?: boolean;
  /** For tests; the app uses VITE_SUPPORT_CONTACT. */
  contact?: SupportContactInfo | null;
};

export const SupportContact: React.FC<SupportContactProps> = ({ className = '', showLabel = true, contact = SUPPORT_CONTACT }) => {
  const { language } = useLanguage();
  const t = copy[language];
  if (!contact) return <p className={`text-body text-fg-2 ${className}`}>{t.staff}</p>;
  const external = contact.kind === 'url';
  return (
    <p className={`text-body text-fg-2 ${className}`}>
      {showLabel ? <>{t.contact}{' '}</> : null}
      <a
        href={contact.href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="inline-flex items-center gap-1 break-all rounded-chip font-medium text-primary-text underline underline-offset-4"
      >
        {contact.label}
        {external ? <ExternalLink size={14} aria-hidden="true" className="shrink-0" /> : null}
        {external ? <span className="sr-only">{t.newTab}</span> : null}
      </a>
    </p>
  );
};

export default SupportContact;
