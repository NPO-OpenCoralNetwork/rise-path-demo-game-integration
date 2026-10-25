import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import PageHeader from '../../ui/PageHeader';
import { ButtonLink } from '../../ui/Button';
import { PublicPageShell } from '../../ui/PublicPageShell';
import { legalPageTitle, setPageTitle } from './pageTitle';

/**
 * /terms and /privacy while the legal pages are off (Phase 4, design §2.3): production builds
 * without VITE_FEATURE_LEGAL_PAGES=true get this page instead of the text (lazyRoutes.tsx), so an
 * early bookmark or BILLING_TOS_URL still answers, never with a 404. It holds no legal text and
 * none of the draft markers (the CI bundle grep), and asks search engines not to index it while it
 * is shown. The tab title names the page.
 */

const copy = {
  en: {
    titles: { terms: 'Terms of Use', privacy: 'Privacy Policy' },
    body: 'This page is being prepared. It will appear here once it is published.',
    home: 'Go to the home page',
    aiSafety: 'About AI safety',
  },
  jp: {
    titles: { terms: '利用規約', privacy: 'プライバシーポリシー' },
    body: 'このページは準備中です。公開したら、ここに載せます。',
    home: 'トップページへ',
    aiSafety: 'AI の安全について',
  },
} as const;

/**
 * Adds `<meta name="robots" content="noindex">` to the document head; the returned function removes
 * it again (exported for server/tests/legalPagesFront.test.js).
 */
export function addNoIndexMeta(doc: Pick<Document, 'createElement' | 'head'>): () => void {
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'robots');
  meta.setAttribute('content', 'noindex');
  doc.head.appendChild(meta);
  return () => meta.remove();
}

/** The page body (exported for the tests). */
export const LegalPagesOffBody: React.FC<{ language: keyof typeof copy; document: 'terms' | 'privacy' }> = ({ language, document }) => {
  const t = copy[language];
  return (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <PageHeader title={t.titles[document]} titleId="legal-off-title" />
      <p className="mt-4 text-body-lg text-fg">{t.body}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink to="/" variant="secondary" size="sm">
          {t.home}
        </ButtonLink>
        <ButtonLink to="/ai-safety" variant="secondary" size="sm">
          {t.aiSafety}
        </ButtonLink>
      </div>
    </div>
  );
};

const LegalPagesOff: React.FC = () => {
  const { language } = useLanguage();
  const { isLoggedIn } = useAuth();
  const { pathname } = useLocation();
  const document: 'terms' | 'privacy' = pathname.startsWith('/privacy') ? 'privacy' : 'terms';

  useEffect(() => (typeof window === 'undefined' ? undefined : addNoIndexMeta(window.document)), []);
  const title = copy[language].titles[document];
  useEffect(() => (typeof window === 'undefined' ? undefined : setPageTitle(window.document, legalPageTitle(title))), [title]);

  const body = <LegalPagesOffBody language={language} document={document} />;
  return isLoggedIn ? body : <PublicPageShell>{body}</PublicPageShell>;
};

export default LegalPagesOff;
