import React, { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, FilePen } from 'lucide-react';
import remarkCjkEmphasis from '../../lesson/remarkCjkEmphasis';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import PageHeader from '../../ui/PageHeader';
import { PublicPageShell } from '../../ui/PublicPageShell';
import { LEGAL_DOCUMENTS, isDraftLegalVersion, type LegalDocumentName } from '../../../shared/legal/versions.js';
import { legalHeadingId } from '../../../shared/legal/headingId.js';
import { legalTextProblems, problemCount } from '../../../scripts/legal/legalText.mjs';
import { legalPageTitle, setPageTitle } from './pageTitle';
import { formatEffectiveDate } from '../../legal/legalDate';

/**
 * One legal text page, /terms or /privacy (Phase 4, design §2.4). The text is the generated
 * content/legal/*.ja.md (scripts/legal/build-legal-text.mjs), passed in by TermsPage / PrivacyPage,
 * the only modules that import it; this module never names a draft.
 *
 * - The text is Japanese only and always sits in `<article lang="ja">`; the English UI shows a
 *   notice that the Japanese text is the official one (no machine translation).
 * - Headings get stable ids (shared/legal/headingId.js: 第 N 条 → article-N, N. → section-N), so
 *   /privacy#section-3 opens the purposes. On load and whenever the hash changes, the heading is
 *   scrolled into view (smooth unless the reader prefers reduced motion) and focused. That works in
 *   both scroll contexts: the window (signed out) and <main id="main-content"> (signed in).
 * - Tables scroll sideways inside a labelled, focusable region (three wide tables at 390 px).
 * - Raw HTML is never rendered (skipHtml; the sentinel comment is removed first).
 * - Dev builds and drafts show a banner with the markers still left (legalTextProblems).
 * - The tab title names the page (「利用規約 | Rise Path」) while it is shown.
 * Signed out it has the public frame (PublicPageShell); signed in it renders inside the Layout.
 */

const copy = {
  en: {
    /** The language of the UI strings below: they sit inside <article lang="ja">. */
    lang: 'en',
    titles: { terms: 'Terms of Use', privacy: 'Privacy Policy' } as Record<LegalDocumentName, string>,
    version: (version: string, from: string | null) => (from ? `Version ${version} (from ${from})` : `Version ${version} (draft)`),
    japaneseOnly:
      'This page is in Japanese. The Japanese text is the official version; there is no reviewed English translation yet.',
    toc: 'Contents',
    tableLabel: 'Table (scrolls sideways)',
    newTab: '(opens in a new tab)',
    draftBanner: (fill: number, check: number) =>
      `Development view. This is a draft and is not published yet. Markers left: ${fill} to fill in, ${check} to check.`,
    footer: (version: string, hash: string) =>
      `The Japanese text is the official version of this document. Version: ${version} / first 12 characters of the SHA-256: ${hash}`,
  },
  jp: {
    lang: 'ja',
    titles: { terms: '利用規約', privacy: 'プライバシーポリシー' } as Record<LegalDocumentName, string>,
    version: (version: string, from: string | null) => (from ? `版 ${version}（${from}から）` : `版 ${version}（下書き）`),
    japaneseOnly: '',
    toc: '目次',
    tableLabel: '表（横にスクロールできます）',
    newTab: '（新しいタブで開きます）',
    draftBanner: (fill: number, check: number) =>
      `開発用の表示です。下書きで、まだ公開していません。残っている印: 要記入 ${fill} か所・要確認 ${check} か所`,
    footer: (version: string, hash: string) => `この文書の正式な版は日本語です。版: ${version} ／ SHA-256 の先頭 12 文字: ${hash}`,
  },
} as const;

type Lang = keyof typeof copy;
type Copy = (typeof copy)[Lang];

/** 'YYYY-MM-DD' → 「2026 年 12 月 1 日」 / "December 1, 2026" (components/legal/legalDate.ts, shared with the consent flow). */
export { formatEffectiveDate };

/** The generated text without its first line when that is an HTML comment (the sentinel). */
export const legalBody = (text: string) => text.replace(/^<!--[^\n]*-->\n+/, '');

/** The `##` headings that have an id, for the table of contents. */
export function legalToc(body: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const line of body.split('\n')) {
    const match = /^## (.+)$/.exec(line);
    const title = match?.[1].trim();
    const id = title ? legalHeadingId(title) : null;
    if (title && id) out.push({ id, title });
  }
  return out;
}

/** Scrolls a heading into view (no smooth scroll for reduced motion) and moves focus to it. */
export function focusLegalHeading(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const target = document.getElementById(id);
  if (!target) return false;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  return true;
}

const hashId = (hash: string) => {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
};

type HastLike = { type?: string; value?: unknown; children?: HastLike[] };
const textOfNode = (node?: HastLike): string =>
  !node ? '' : node.type === 'text' ? String(node.value ?? '') : (node.children ?? []).map(textOfNode).join('');

const linkClasses = 'font-medium text-primary-text underline underline-offset-4 wrap-anywhere';

/** The markdown elements of a legal text (exported for server/tests/legalPagesFront.test.js). */
export function legalComponents(t: Copy): Components {
  return {
    h1: ({ node, children }) => {
      const id = legalHeadingId(textOfNode(node)) ?? undefined;
      return (
        <h2 id={id} tabIndex={id ? -1 : undefined} className="mt-10 scroll-mt-6 text-h2 text-fg focus:outline-none">
          {children}
        </h2>
      );
    },
    h2: ({ node, children }) => {
      const id = legalHeadingId(textOfNode(node)) ?? undefined;
      return (
        <h2 id={id} tabIndex={id ? -1 : undefined} className="mt-10 scroll-mt-6 text-h2 text-fg focus:outline-none">
          {children}
        </h2>
      );
    },
    h3: ({ node, children }) => {
      const id = legalHeadingId(textOfNode(node)) ?? undefined;
      return (
        <h3 id={id} tabIndex={id ? -1 : undefined} className="mt-6 scroll-mt-6 text-h3 text-fg focus:outline-none">
          {children}
        </h3>
      );
    },
    p: ({ node: _node, ...props }) => <p className="mt-3 text-body-lg text-fg" {...props} />,
    ul: ({ node: _node, ...props }) => <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-fg-3" {...props} />,
    ol: ({ node: _node, ...props }) => <ol className="mt-3 list-decimal space-y-2 pl-8 marker:text-fg-3" {...props} />,
    li: ({ node: _node, ...props }) => <li className="text-body-lg text-fg" {...props} />,
    strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
    hr: () => <hr className="mt-8 border-line" />,
    code: ({ node: _node, ...props }) => <code className="rounded-chip bg-sunken px-1 font-mono text-body wrap-anywhere" {...props} />,
    table: ({ node: _node, ...props }) => (
      // The region's name is in the UI language; the table itself stays Japanese.
      <div
        role="region"
        lang={t.lang}
        aria-label={t.tableLabel}
        tabIndex={0}
        className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus print:overflow-visible"
      >
        <table lang="ja" className="w-full min-w-160 border-collapse text-left" {...props} />
      </div>
    ),
    th: ({ node: _node, ...props }) => <th className="border-b border-line bg-sunken px-3 py-2 align-top text-body font-semibold text-fg" {...props} />,
    td: ({ node: _node, ...props }) => <td className="border-b border-line px-3 py-2 align-top text-body text-fg" {...props} />,
    a: ({ href = '', children }) => {
      if (href.startsWith('/') && !href.startsWith('//')) {
        return (
          <Link to={href} className={linkClasses}>
            {children}
          </Link>
        );
      }
      if (href.startsWith('#')) {
        return (
          <Link to={href} className={linkClasses} onClick={() => focusLegalHeading(hashId(href))}>
            {children}
          </Link>
        );
      }
      if (/^https:\/\//i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className={linkClasses}>
            {children}
            <ExternalLink size={14} aria-hidden="true" className="ml-0.5 inline align-baseline" />
            <span lang={t.lang} className="sr-only">{t.newTab}</span>
          </a>
        );
      }
      return <span>{children}</span>;
    },
  };
}

const REMARK_PLUGINS = [remarkGfm, remarkCjkEmphasis];

export type LegalDocumentProps = {
  document: LegalDocumentName;
  /** The generated content/legal/<document>.ja.md (with its sentinel line). */
  text: string;
};

/** The page body without the public frame (exported for the tests). */
export const LegalDocumentBody: React.FC<LegalDocumentProps & { language: Lang; currentHash?: string }> = ({
  document,
  text,
  language,
  currentHash = '',
}) => {
  const t = copy[language];
  const entry = LEGAL_DOCUMENTS[document];
  const body = useMemo(() => legalBody(text), [text]);
  const toc = useMemo(() => legalToc(body), [body]);
  const problems = useMemo(() => legalTextProblems(text), [text]);
  const components = useMemo(() => legalComponents(t), [t]);
  const draft = isDraftLegalVersion(entry.version);
  const from = draft ? null : formatEffectiveDate(entry.effectiveDate, language);
  const titleId = `legal-${document}-title`;

  return (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <PageHeader eyebrow={t.version(entry.version, from)} title={t.titles[document]} titleId={titleId} />

      {draft || problems.length > 0 ? (
        <p role="note" className="mt-4 flex items-start gap-2 rounded-card border border-line bg-sun-soft p-4 text-body text-fg">
          <FilePen size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-text" />
          <span>{t.draftBanner(problemCount(problems, 'to_fill'), problemCount(problems, 'to_check'))}</span>
        </p>
      ) : null}

      {t.japaneseOnly ? (
        <p role="note" className="mt-4 rounded-card border border-line bg-sunken p-4 text-body text-fg print:hidden">
          {t.japaneseOnly}
        </p>
      ) : null}

      {toc.length > 0 ? (
        <nav aria-label={t.toc} className="mt-6 rounded-card border border-line bg-sunken p-4 print:hidden">
          <p className="text-small font-semibold text-fg-2">{t.toc}</p>
          <ol lang="ja" className="mt-2 grid gap-1 text-body sm:grid-cols-2">
            {toc.map((item) => (
              <li key={item.id}>
                <Link
                  to={`#${item.id}`}
                  onClick={() => {
                    // The same hash again does not change the location: scroll here instead.
                    if (currentHash === `#${item.id}`) focusLegalHeading(item.id);
                  }}
                  className="rounded-chip text-primary-text underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <article lang="ja" aria-labelledby={titleId} className="mt-6 break-words">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={components}>
          {body}
        </ReactMarkdown>
      </article>

      <footer className="mt-10 border-t border-line pt-4 text-small text-fg-2">
        <p>{t.footer(entry.version, entry.sha256.slice(0, 12))}</p>
      </footer>
    </div>
  );
};

const LegalDocument: React.FC<LegalDocumentProps> = ({ document, text }) => {
  const { language } = useLanguage();
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  const title = copy[language].titles[document];

  // The tab title names the page (WCAG 2.4.2); the previous title comes back on leaving.
  useEffect(() => (typeof window === 'undefined' ? undefined : setPageTitle(window.document, legalPageTitle(title))), [title]);

  useEffect(() => {
    const id = hashId(location.hash);
    if (!id) return undefined;
    // After every effect of this commit (the Layout scrolls to the top on a new path).
    const frame = window.requestAnimationFrame(() => {
      focusLegalHeading(id);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  useEffect(() => {
    const onHashChange = () => {
      const id = hashId(window.location.hash);
      if (id) focusLegalHeading(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const body = <LegalDocumentBody document={document} text={text} language={language} currentHash={location.hash} />;
  return isLoggedIn ? body : <PublicPageShell>{body}</PublicPageShell>;
};

export default LegalDocument;
