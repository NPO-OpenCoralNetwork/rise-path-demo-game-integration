import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkEmphasis from './remarkCjkEmphasis';
import type { LText } from '../../shared/lesson/schema.js';
import { useLanguage } from '../../context/LanguageContext';
import { useOptionalReader } from './ReaderContext';
import { TERM_HREF_PREFIX, linkGlossaryTerms } from './model';

/**
 * Lesson markdown: GFM (tables, strikethrough, autolinks), raw HTML skipped, unsafe URLs
 * dropped by react-markdown's default urlTransform, external links in a new tab,
 * `[[term]]` rendered as a glossary button, and `**…**` next to Japanese brackets still bold.
 */

const REMARK_PLUGINS = [remarkGfm, remarkCjkEmphasis];

const copy = {
  en: { newTab: '(opens in a new tab)', term: 'Show the definition of' },
  jp: { newTab: '（新しいタブで開きます）', term: '用語の説明を表示：' },
} as const;

const isExternal = (href: string) => /^https?:\/\//i.test(href);

function MdLink({ href = '', children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const reader = useOptionalReader();
  const { language } = useLanguage();
  const text = copy[language];

  if (href.startsWith(TERM_HREF_PREFIX)) {
    const term = decodeURIComponent(href.slice(TERM_HREF_PREFIX.length));
    if (!reader) return <span className="rp-term">{children}</span>;
    return (
      <button
        type="button"
        className="rp-term"
        aria-label={`${text.term} ${term}`}
        onClick={(event) => {
          event.stopPropagation();
          reader.selectTerm(term);
        }}
      >
        {children}
      </button>
    );
  }
  if (!href) return <span>{children}</span>;
  if (isExternal(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> {text.newTab}</span>
      </a>
    );
  }
  return <a {...rest} href={href}>{children}</a>;
}

const baseComponents: Components = {
  a: ({ node: _node, ...props }) => <MdLink {...props} />,
  // Headings inside a paragraph block would break the outline; render them as strong text.
  h1: ({ node: _node, ...props }) => <p className="rp-md-heading" {...props} />,
  h2: ({ node: _node, ...props }) => <p className="rp-md-heading" {...props} />,
  h3: ({ node: _node, ...props }) => <p className="rp-md-heading" {...props} />,
  h4: ({ node: _node, ...props }) => <p className="rp-md-heading" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="rp-table-scroll" tabIndex={0}>
      <table className="rp-table" {...props} />
    </div>
  ),
  img: ({ node: _node, alt, ...props }) => <img {...props} alt={alt ?? ''} loading="lazy" decoding="async" />,
};

const inlineComponents: Components = {
  ...baseComponents,
  p: ({ children }) => <>{children}</>,
};

type MarkdownProps = {
  source: string;
  /** Render without wrapping paragraphs (titles, options, table cells). */
  inline?: boolean;
};

/** Memoized: a block re-render (progress, theme) does not re-parse unchanged markdown. */
export const Markdown = React.memo(function Markdown({ source, inline = false }: MarkdownProps) {
  const linked = useMemo(() => linkGlossaryTerms(source), [source]);
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      skipHtml
      components={inline ? inlineComponents : baseComponents}
    >
      {linked}
    </ReactMarkdown>
  );
});

type TextProps = {
  value: LText | null | undefined;
  as?: 'span' | 'div' | 'p';
  className?: string;
  id?: string;
};

/** Localized plain text with `lang` when it fell back to another locale. */
export function Txt({ value, as: Tag = 'span', className, id }: TextProps) {
  const reader = useOptionalReader();
  const { language } = useLanguage();
  const resolved = reader
    ? reader.tx(value)
    : { value: typeof value === 'string' ? value : (value?.[language] ?? value?.jp ?? value?.en ?? ''), lang: undefined };
  if (!resolved.value) return null;
  return <Tag className={className} id={id} lang={resolved.lang}>{resolved.value}</Tag>;
}

/** Localized markdown. Block mode wraps in a div (with `lang` on fallback). */
export function MdText({ value, inline = false, className, as }: TextProps & { inline?: boolean }) {
  const reader = useOptionalReader();
  const { language } = useLanguage();
  const resolved = reader
    ? reader.tx(value)
    : { value: typeof value === 'string' ? value : (value?.[language] ?? value?.jp ?? value?.en ?? ''), lang: undefined };
  if (!resolved.value) return null;
  const Tag = as ?? (inline ? 'span' : 'div');
  if (inline && !resolved.lang && !className && !as) return <Markdown source={resolved.value} inline />;
  return (
    <Tag className={className} lang={resolved.lang}>
      <Markdown source={resolved.value} inline={inline} />
    </Tag>
  );
}
