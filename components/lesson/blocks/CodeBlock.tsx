import React, { useMemo } from 'react';
import { Check, Copy, FileCode2, Sparkles } from 'lucide-react';
import type { BlockProps } from './registry';
import { useReader } from '../ReaderContext';
import { useCopy } from './useCopy';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * Baseline code block: filename · language header, copy (announced via aria-live), highlighted
 * lines, line numbers past 5 lines, keyboard-scrollable <pre>. WP-05 adds Shiki highlighting,
 * folding past 25 lines and the output panel in place.
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
    code: 'Code',
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
    code: 'コード',
  },
} as const;

export default function CodeBlock({ block, section }: BlockProps<'code'>) {
  const { language } = useLanguage();
  const { askTutor } = useReader();
  const { copied, copy: copyText } = useCopy();
  const text = copy[language];
  const lines = useMemo(() => block.code.replace(/\n$/, '').split('\n'), [block.code]);
  const highlight = useMemo(() => new Set(block.highlight ?? []), [block.highlight]);
  const numbered = lines.length > 5;
  const label = block.filename || block.lang || text.code;

  return (
    <figure className="rp-code" data-theme="dark">
      <figcaption className="rp-code-head">
        <FileCode2 size={15} aria-hidden="true" className="shrink-0 text-fg-3" />
        <span className="rp-code-file">{label}</span>
        {block.filename && block.lang && <span className="rp-code-lang">{block.lang}</span>}
        <span className="flex-1" />
        <button
          type="button"
          className="rp-code-btn"
          aria-label={text.explainLabel}
          onClick={() => askTutor({
            message: text.explainMessage,
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
          aria-label={copied === 'ok' ? text.copied : text.copyCode}
          onClick={() => void copyText(block.code)}
        >
          {copied === 'ok' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span className="rp-code-btn-label">{copied === 'ok' ? text.copied : text.copy}</span>
        </button>
      </figcaption>
      <pre className="rp-code-pre" tabIndex={0} aria-label={`${text.code}: ${label}`}>
        <code className={numbered ? 'rp-code-numbered' : undefined}>
          {lines.map((line, i) => (
            <span key={i} className="rp-code-line" data-hl={highlight.has(i + 1) || undefined}>
              {numbered && <span className="rp-code-ln" aria-hidden="true">{i + 1}</span>}
              {line || '​'}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      <span role="status" aria-live="polite" className="sr-only">
        {copied === 'ok' ? text.copiedLive : copied === 'error' ? text.copyFailed : ''}
      </span>
    </figure>
  );
}
