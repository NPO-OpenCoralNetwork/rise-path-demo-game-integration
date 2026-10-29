import React, { useState } from 'react';
import { ArrowRight, BookOpenText, CircleCheck, PenTool } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage, type SelectedLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { allowGuestLogin } from '../../services/authPolicy';
import { features } from '../../config/features';
import BrandMark from './BrandMark';
import { Button, ButtonLink } from '../ui/Button';
import { authoringGuideUrl } from '../ui/links';

export type AuthEntryMode = 'login' | 'signup';

interface LandingViewProps {
  /** Opens sign-in/sign-up; `returnTo` is the in-app path to open after signing in. */
  onAuthClick: (mode: AuthEntryMode, returnTo?: string) => void;
}

/** Where the guest CTA lands: the first real chapter in the lesson reader. */
const FIRST_CHAPTER = '/learn/vibe-coding/vibe-ch1';

const copy = {
  en: {
    skip: 'Skip to content',
    language: 'Language',
    signIn: 'Sign in',
    pill: 'A Japanese-first learning studio',
    titleLead: 'Every page you read,',
    titleRest: { before: 'more ', em: 'clicks into place', after: '.' },
    lead:
      'Lessons made by people and AI, set in the most readable form. Ask the AI tutor about any paragraph, and make it stick with check questions and review cards.',
    guestCta: 'Read Chapter 1 as a guest',
    signInCta: 'Sign in to read Chapter 1',
    authorCta: 'For lesson authors',
    opensInNewTab: '(opens in a new tab)',
    noteGuest: 'Read Chapter 1 without signing up. All AI processing happens on our server.',
    noteSignIn: 'All AI processing happens on our server.',
    shotAlt:
      'The Rise Path lesson reader: chapter contents on the left, the lesson text with its learning goals in the middle, and the AI tutor and glossary on the right.',
    featuresLabel: 'What you can do',
    features: [
      {
        key: 'read',
        num: '01',
        label: 'Read',
        title: 'A reader built for focus',
        body: 'Japanese typesetting at about 40 characters per line with 1.9 line spacing. Contents, progress and resume work the same in every chapter.',
      },
      {
        key: 'check',
        num: '02',
        label: 'Check',
        title: 'Questions while you read',
        body: 'Short questions between sections. Pick a wrong answer and you get an explanation of that specific mix-up.',
      },
      {
        key: 'create',
        num: '03',
        label: 'Create',
        title: 'Author lessons with Claude Code and MCP',
        body: 'Write to one schema, then validate and preview with a command. Only lessons that pass appear in this reader.',
      },
    ],
    footerSignIn: 'Already have an account? Sign in',
    footerSafety: 'AI safety (for children and guardians)',
    footerTerms: 'Terms of Use',
    footerPrivacy: 'Privacy Policy',
  },
  jp: {
    skip: '本文へ移動',
    language: '言語',
    signIn: 'ログイン',
    pill: '日本語ファーストの学習スタジオ',
    titleLead: '読むたびに、',
    titleRest: { before: '', em: 'わかる', after: 'が増えていく。' },
    lead:
      'AIと人がつくった教材を、いちばん読みやすい形で。段落ごとに AI先生 に質問でき、確認問題と復習カードで「わかった」を定着させます。',
    guestCta: 'ゲストで第1章を読む',
    signInCta: 'ログインして第1章を読む',
    authorCta: '教材をつくる人へ',
    opensInNewTab: '（新しいタブで開きます）',
    noteGuest: '登録なしで第1章を読めます。AIの処理はすべてサーバー側で行います。',
    noteSignIn: 'AIの処理はすべてサーバー側で行います。',
    shotAlt: 'Rise Path のレッスンリーダー。左に章の目次、中央に学習目標と本文、右に AI先生 と用語のパネルが並びます。',
    featuresLabel: 'できること',
    features: [
      {
        key: 'read',
        num: '01',
        label: '読む',
        title: '集中できる教材リーダー',
        body: '1行約40字・行間1.9の日本語組版。目次・進捗・続きからを、どの章でも同じ操作で使えます。',
      },
      {
        key: 'check',
        num: '02',
        label: '確かめる',
        title: '読みながら確認問題',
        body: 'セクションの合間に小さな問題。間違えたら、選んだ答えに合わせて考え方を説明します。',
      },
      {
        key: 'create',
        num: '03',
        label: 'つくる',
        title: 'Claude Code・MCPで教材制作',
        body: '同じスキーマで書き、検証とプレビューをコマンドで実行。通った教材だけがこのリーダーに載ります。',
      },
    ],
    footerSignIn: 'アカウントをお持ちの方はログイン',
    footerSafety: 'AI の安全について（子どもと保護者の方へ）',
    footerTerms: '利用規約',
    footerPrivacy: 'プライバシーポリシー',
  },
} as const;

const FEATURE_ICONS = { read: BookOpenText, check: CircleCheck, create: PenTool } as const;

/** Soft morning sun behind the screenshot. Decorative. */
const GLOW_STYLE: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle, color-mix(in oklab, var(--rp-sun) 45%, white) 0%, var(--rp-sun-soft) 38%, transparent 68%)',
};

const ExperienceLandingView: React.FC<LandingViewProps> = ({ onAuthClick }) => {
  const { language, selectedLanguage, setLanguage } = useLanguage();
  const { loginAsGuest } = useAuth();
  const navigate = useNavigate();
  const t = copy[language];
  const [guestAllowed] = useState(() => {
    try {
      return allowGuestLogin();
    } catch {
      return false;
    }
  });

  const shotLang = language === 'jp' ? 'jp' : 'en';
  const languages: SelectedLanguage[] = features.frLocale ? ['en', 'jp', 'fr'] : ['en', 'jp'];

  const startReading = () => {
    if (!guestAllowed) {
      onAuthClick('login', FIRST_CHAPTER);
      return;
    }
    try {
      loginAsGuest();
      navigate(FIRST_CHAPTER);
    } catch (error) {
      // Guest access can be switched off (Supabase auth, strict mode): fall back to sign-in.
      console.warn('Guest login unavailable, opening sign-in:', error);
      onAuthClick('login', FIRST_CHAPTER);
    }
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-fg">
      <a
        href="#landing-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-3"
      >
        {t.skip}
      </a>

      <header className="relative z-10 mx-auto flex max-w-wide items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-2.5 text-h3 font-bold text-fg">
          <BrandMark size={30} />
          <span>Rise Path</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
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
                  className={`h-8 min-w-10 rounded-full px-2.5 font-semibold transition-colors duration-120 ${
                    active ? 'border border-line bg-surface text-fg shadow-1' : 'text-fg-3 hover:text-fg'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              );
            })}
          </div>
          <Button variant="secondary" size="md" onClick={() => onAuthClick('login')}>
            {t.signIn}
          </Button>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1} className="focus:outline-none">
        <section
          aria-labelledby="landing-title"
          className="relative mx-auto grid max-w-wide items-center gap-10 px-4 pb-8 pt-6 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12 lg:px-10 lg:pt-10"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-70 sm:-top-16 sm:right-0 sm:size-128 sm:opacity-90 lg:right-16"
            style={GLOW_STYLE}
          />

          <div className="relative min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-sun-soft px-3 py-1 text-small font-semibold text-sun-text">
              <span aria-hidden="true" className="size-2 rounded-full bg-sun-text" />
              {t.pill}
            </span>
            <h1 id="landing-title" className="mt-4 text-[2.125rem] font-bold leading-[1.35] text-fg sm:text-display">
              <span className="block">{t.titleLead}</span>
              <span className="block">
                {t.titleRest.before}
                <em className="not-italic text-primary-text">{t.titleRest.em}</em>
                {t.titleRest.after}
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-body-lg text-fg-2">{t.lead}</p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <Button variant="primary" size="lg" onClick={startReading} trailingIcon={<ArrowRight size={18} aria-hidden="true" />}>
                {guestAllowed ? t.guestCta : t.signInCta}
              </Button>
              <ButtonLink href={authoringGuideUrl(language)} external variant="secondary" size="lg">
                {t.authorCta}
                <span className="sr-only">{t.opensInNewTab}</span>
              </ButtonLink>
            </div>
            <p className="mt-3.5 text-small text-fg-3">{guestAllowed ? t.noteGuest : t.noteSignIn}</p>
          </div>

          <figure className="relative m-0 min-w-0">
            {/* Real captures of /learn/vibe-coding/vibe-ch1 (see components/ui/README.md). */}
            <picture className="mx-auto block max-w-72 overflow-hidden rounded-hero border border-line bg-surface shadow-3 sm:max-w-none">
              <source
                media="(max-width: 639px)"
                srcSet={`/marketing/reader-${shotLang}-mobile.webp`}
                width={780}
                height={1440}
              />
              <img
                src={`/marketing/reader-${shotLang}.webp`}
                alt={t.shotAlt}
                width={1440}
                height={900}
                fetchPriority="high"
                decoding="async"
                className="block h-auto w-full"
              />
            </picture>
          </figure>
        </section>

        <section aria-label={t.featuresLabel} className="mx-auto max-w-wide px-4 pb-12 pt-4 sm:px-6 lg:px-10">
          <ul className="grid gap-4 md:grid-cols-3">
            {t.features.map((feature) => {
              const Icon = FEATURE_ICONS[feature.key];
              return (
                <li key={feature.key} className="rounded-card border border-line bg-surface p-5 shadow-1">
                  <p className="flex items-center gap-2 text-small font-semibold text-primary-text">
                    <Icon size={16} aria-hidden="true" />
                    <span className="tabular">{feature.num}</span>
                    <span>{feature.label}</span>
                  </p>
                  <h2 className="mt-2 text-h3 text-fg">{feature.title}</h2>
                  <p className="mt-1 text-small text-fg-2">{feature.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      <footer className="mx-auto flex max-w-wide flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-6 text-small text-fg-3 sm:px-6 lg:px-10">
        <span>© 2026 Rise Path</span>
        <Link to="/ai-safety" className="rounded-chip font-medium text-primary-text underline-offset-4 hover:underline">
          {t.footerSafety}
        </Link>
        {/* Phase 4: only once the texts are published (VITE_FEATURE_LEGAL_PAGES=true). */}
        {features.legalPages && (
          <>
            <Link to="/terms" className="rounded-chip font-medium text-primary-text underline-offset-4 hover:underline">
              {t.footerTerms}
            </Link>
            <Link to="/privacy" className="rounded-chip font-medium text-primary-text underline-offset-4 hover:underline">
              {t.footerPrivacy}
            </Link>
          </>
        )}
        <button type="button" onClick={() => onAuthClick('login')} className="rounded-chip font-medium text-primary-text hover:underline underline-offset-4">
          {t.footerSignIn}
        </button>
      </footer>
    </div>
  );
};

export default ExperienceLandingView;
