import React, { useEffect, useId, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, FileCode2, Sparkles } from 'lucide-react';
import type { BlockProps } from './registry';
import { useReader } from '../ReaderContext';
import { useCopy } from './useCopy';
import { useLanguage } from '../../../context/LanguageContext';
import { cachedTokens, highlightCode, type CodeTokenLines } from './highlighter';
import { FOLD_AFTER, FOLD_VISIBLE, LINE_NUMBERS_AFTER, codeLines, formatLineRanges } from './blockText';

/**
 * Code: filename · language header, ✦ explain (sends the code and highlighted lines to the
 * tutor), copy (announced via aria-live), Shiki highlighting loaded lazily (plain text until
 * it arrives or if it fails), highlighted lines with a left bar, line numbers past 5 lines,
 * and blocks longer than 25 lines folded to their first 12 lines.
 */

const copy = {
  en: {
    copy: 'Copy',
    copyCode: 'Copy code',
    copied: 'Copied',
    copiedLive: 'Code copied to the clipboard.',
    copyFailed: 'Could not copy. Select the code and copy it manually.',
    explain: 'Explain',
    explainLabel: 'Ask the AI tutor to explain this code',
    explainMessage: 'Explain what this code does, step by step.',
    explainLines: (lines: string) => `Explain what this code does, step by step. Focus on the highlighted lines (${lines}).`,
    code: 'Code',
    showAll: (n: number) => `Show all ${n} lines`,
    showLess: 'Show less',
    highlighted: (lines: string) => `Highlighted lines: ${lines}`,
  },
  jp: {
    copy: 'コピー',
    copyCode: 'コードをコピー',
    copied: 'コピーしました',
    copiedLive: 'コードをクリップボードにコピーしました。',
    copyFailed: 'コピーできませんでした。コードを選択して手動でコピーしてください。',
    explain: '説明',
    explainLabel: 'このコードの説明をAI先生に頼む',
    explainMessage: 'このコードが何をしているか、順を追って説明してください。',
    explainLines: (lines: string) => `このコードが何をしているか、順を追って説明してください。特に強調された行（${lines}行目）を詳しく。`,
    code: 'コード',
    showAll: (n: number) => `すべて表示（${n}行）`,
    showLess: '折りたたむ',
    highlighted: (lines: string) => `強調されている行：${lines}行目`,
  },
} as const;

function useHighlighted(code: string, lang: string): CodeTokenLines | null {
  const [tokens, setTokens] = useState<CodeTokenLines | null>(() => cachedTokens(code, lang));
  useEffect(() => {
    let cancelled = false;
    setTokens(cachedTokens(code, lang));
    highlightCode(code, lang)
      .then((lines) => {
        if (!cancelled) setTokens(lines);
      })
      .catch(() => {
        // Shiki could not load: the plain text stays.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  return tokens;
}

export default function CodeBlock({ block, section }: BlockProps<'code'>) {
  const { language } = useLanguage();
  const { askTutor } = useReader();
  const { copied, copy: copyText } = useCopy();
  const text = copy[language];
  const preId = `${useId()}-pre`;
  const lines = useMemo(() => codeLines(block.code), [block.code]);
  const tokens = useHighlighted(lines.join('\n'), block.lang);
  const highlight = useMemo(() => new Set(block.highlight ?? []), [block.highlight]);
  const ranges = formatLineRanges(block.highlight);
  const numbered = lines.length > LINE_NUMBERS_AFTER;
  const foldable = lines.length > FOLD_AFTER;
  const [expanded, setExpanded] = useState(false);
  const folded = foldable && !expanded;
  const label = block.filename || block.lang || text.code;
  // Highlighted tokens only when they match the plain lines (same code, same line count).
  const rows = tokens && tokens.length === lines.length ? tokens : null;

  return (
    <figure className="rp-code" data-theme="dark" data-folded={folded || undefined} data-highlighted={rows ? '' : undefined}>
      <figcaption className="rp-code-head">
        <FileCode2 size={15} aria-hidden="true" className="shrink-0 text-fg-3" />
        <span className="rp-code-file">{label}</span>
        {block.filename && block.lang && <span className="rp-code-lang">{block.lang}</span>}
        <span className="flex-1" />
        <button
          type="button"
          className="rp-code-btn"
          aria-label={text.explainLabel}
          title={text.explainLabel}
          onClick={() => askTutor({
            message: ranges ? text.explainLines(ranges) : text.explainMessage,
            block,
            section,
            excerpt: block.code.slice(0, 1500),
            codeLang: block.lang,
            highlightedLines: block.highlight,
          })}
        >
          <Sparkles size={14} aria-hidden="true" />
          <span className="rp-code-btn-label">{text.explain}</span>
        </button>
        <button
          type="button"
          className="rp-code-btn"
          data-copied={copied === 'ok' || undefined}
          aria-label={copied === 'ok' ? text.copied : text.copyCode}
          onClick={() => void copyText(block.code)}
        >
          {copied === 'ok' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span className="rp-code-btn-label">{copied === 'ok' ? text.copied : text.copy}</span>
        </button>
      </figcaption>
      <pre
        id={preId}
        className="rp-code-pre"
        tabIndex={0}
        aria-label={`${text.code}: ${label}`}
        aria-describedby={ranges ? `${preId}-hl` : undefined}
      >
        <code className={numbered ? 'rp-code-numbered' : undefined}>
          {lines.map((line, i) => (
            <span
              key={i}
              className="rp-code-line"
              data-hl={highlight.has(i + 1) || undefined}
              data-fold-hidden={folded && i >= FOLD_VISIBLE ? '' : undefined}
            >
              {numbered && <span className="rp-code-ln" aria-hidden="true">{i + 1}</span>}
              {rows ? (
                rows[i].length
                  ? rows[i].map((token, ti) => (
                    <span key={ti} className="rp-tok" style={token.style as React.CSSProperties | undefined}>{token.content}</span>
                  ))
                  : '​'
              ) : (line || '​')}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      {ranges && <span id={`${preId}-hl`} className="sr-only">{text.highlighted(ranges)}</span>}
      {foldable && (
        <div className="rp-code-fold">
          <button
            type="button"
            className="rp-code-fold-btn"
            aria-expanded={expanded}
            aria-controls={preId}
            onClick={() => setExpanded((open) => !open)}
          >
            <ChevronDown size={16} aria-hidden="true" className="rp-code-fold-icon" />
            {expanded ? text.showLess : text.showAll(lines.length)}
          </button>
        </div>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copied === 'ok' ? text.copiedLive : copied === 'error' ? text.copyFailed : ''}
      </span>
    </figure>
  );
}
