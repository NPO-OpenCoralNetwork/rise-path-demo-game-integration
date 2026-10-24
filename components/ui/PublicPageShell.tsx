import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage, type SelectedLanguage } from '../../context/LanguageContext';
import { features } from '../../config/features';
import BrandMark from '../common/BrandMark';

/**
 * The frame of a public page shown signed out (Phase 4, design §2.4): skip link, the Rise Path
 * mark linking home, the language buttons and `<main id="public-main">` (focusable, so the skip
 * link lands there). Extracted from the identical headers of AiSafetyGuideView and
 * CommerceDisclosureView, which keep their own copy for now. Used by AccountDeletedView (and, in
 * later stages, the legal pages and the re-consent page). Signed in, those pages render inside the
 * Layout without this frame.
 *
 * The page window scrolls here (no Layout, so no <main id="main-content">).
 */

const copy = {
  en: { skip: 'Skip to content', language: 'Language', home: 'Rise Path home' },
  jp: { skip: '本文へ移動', language: '言語', home: 'Rise Path のトップへ' },
} as const;

export const PUBLIC_MAIN_ID = 'public-main';

export const PublicPageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language, selectedLanguage, setLanguage } = useLanguage();
  const t = copy[language];
  const languages: SelectedLanguage[] = features.frLocale ? ['en', 'jp', 'fr'] : ['en', 'jp'];

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-fg">
      <a
        href={`#${PUBLIC_MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-3"
      >
        {t.skip}
      </a>
      <header className="mx-auto flex max-w-wide items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10 print:hidden">
        <Link to="/" aria-label={t.home} className="flex items-center gap-2.5 rounded-control text-h3 font-bold text-fg">
          <BrandMark size={30} />
          <span>Rise Path</span>
        </Link>
        <div role="group" aria-label={t.language} className="flex items-center gap-1 text-small">
          {languages.map((lang) => {
            const active = selectedLanguage === lang;
            return (
              <button
                key={lang}
                type="button"
                lang={lang === 'jp' ? 'ja' : lang}
                aria-pressed={active}
                onClick={() => setLanguage(lang)}
                className={`h-8 min-w-10 rounded-full px-2.5 font-semibold transition-colors duration-120 motion-reduce:transition-none ${
                  active ? 'border border-line bg-surface text-fg shadow-1' : 'text-fg-3 hover:text-fg'
                }`}
              >
                {lang.toUpperCase()}
              </button>
            );
          })}
        </div>
      </header>
      <main id={PUBLIC_MAIN_ID} tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </div>
  );
};

export default PublicPageShell;
