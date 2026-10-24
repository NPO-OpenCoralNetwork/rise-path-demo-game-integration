import React from 'react';
import { Link } from 'react-router-dom';
import { Info, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { features } from '../../config/features';
import { formatEffectiveDate } from './legalDate';
import { legalGate, useLegalGate } from './legalGateClient';
import type { LegalNotice } from '../../services/legalConsentApi';

/**
 * The bar above the page content in the Layout (Phase 4, design §4.3), from the legal gate:
 *   - accepted with a notice (a privacy change, an editorial terms change, a filled-in item: no new
 *     agreement needed): 「プライバシーポリシーを改定しました（…から）。」 + "Read" + "Close"; closing
 *     is remembered per version on this device;
 *   - needed, on a page that stays open without agreeing (App.tsx LEGAL_GATE_EXEMPT, e.g.
 *     /settings/ai-access): 「Rise Path を使い続けるには、利用規約への同意が必要です。」 + "Review",
 *     which goes to the re-consent page.
 * role="status": announced politely, never steals focus. The live region is always there while the
 * flag is on (empty, with no height, when there is nothing to say): screen readers announce what
 * appears inside a region that already exists, not a region that mounts already filled. Nothing at
 * all while the flag is off.
 */

const copy = {
  en: {
    updated: { terms: 'We updated the Terms of Use', privacy: 'We updated the Privacy Policy' },
    from: (date: string) => ` (from ${date})`,
    read: 'Read',
    close: 'Close',
    closeLabel: (document: string) => `Close the notice about the ${document}`,
    names: { terms: 'Terms of Use', privacy: 'Privacy Policy' },
    needed: 'To keep using Rise Path, please agree to the Terms of Use.',
    review: 'Review',
  },
  jp: {
    updated: { terms: '利用規約を改定しました', privacy: 'プライバシーポリシーを改定しました' },
    from: (date: string) => `（${date}から）`,
    read: '読む',
    close: '閉じる',
    closeLabel: (document: string) => `${document}のお知らせを閉じる`,
    names: { terms: '利用規約', privacy: 'プライバシーポリシー' },
    needed: 'Rise Path を使い続けるには、利用規約への同意が必要です。',
    review: '確認する',
  },
} as const;

type Lang = keyof typeof copy;

const barClasses = 'mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-sunken px-4 py-3 text-body text-fg print:hidden';
const linkClasses = 'rounded-chip font-medium text-primary-text underline underline-offset-4';

/** The bar's content (exported for server/tests/legalConsentFront.test.js). */
export const LegalNoticeBarBody: React.FC<{
  language: Lang;
  status: string;
  notice: LegalNotice[];
  onDismiss: (version: string) => void;
}> = ({ language, status, notice, onDismiss }) => {
  const t = copy[language];
  let content: React.ReactNode = null;
  if (status === 'needed') {
    content = (
      <div className={barClasses}>
        <Info size={18} aria-hidden="true" className="shrink-0 text-primary-text" />
        <p className="min-w-0 flex-1">{t.needed}</p>
        <Link to="/" className={linkClasses}>
          {t.review}
        </Link>
      </div>
    );
  } else if (status === 'accepted' && notice.length > 0) {
    content = notice.map((item) => {
      const date = formatEffectiveDate(item.effectiveDate, language);
      return (
        <div key={item.version} className={barClasses}>
          <Info size={18} aria-hidden="true" className="shrink-0 text-primary-text" />
          <p className="min-w-0 flex-1">
            {t.updated[item.document]}
            {date ? t.from(date) : ''}
            {language === 'jp' ? '。' : '.'}
          </p>
          <Link to={item.document === 'terms' ? '/terms' : '/privacy'} className={linkClasses}>
            {t.read}
          </Link>
          <button
            type="button"
            onClick={() => onDismiss(item.version)}
            aria-label={t.closeLabel(t.names[item.document])}
            className="inline-flex h-8 items-center gap-1 rounded-control px-2 font-medium text-fg-2 hover:bg-surface hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
            <span>{t.close}</span>
          </button>
        </div>
      );
    });
  }
  // The same element in every state: only its content changes.
  return <div role="status">{content}</div>;
};

const LegalNoticeBar: React.FC = () => {
  const { language } = useLanguage();
  const state = useLegalGate(features.legalPages);
  if (!features.legalPages) return null;
  return (
    <LegalNoticeBarBody
      language={language}
      status={state.status}
      notice={state.notice}
      onDismiss={(version) => legalGate(features.legalPages).dismissNotice(version)}
    />
  );
};

export default LegalNoticeBar;
