import React, { useMemo } from 'react';
import { Check, Copy, MessageSquareText } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { splitPromptVars } from '../model';
import { useCopy } from './useCopy';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * A prompt to give an AI. Baseline: `{{variables}}` shown as chips, copy (aria-live), and the
 * expected result in a disclosure. WP-05 makes the chips editable and adds "use in Claude Code".
 */

const TARGETS: Record<string, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

const copy = {
  en: {
    title: 'Prompt example',
    copy: 'Copy',
    copyPrompt: 'Copy the prompt',
    copied: 'Copied',
    copiedLive: 'Prompt copied to the clipboard.',
    copyFailed: 'Could not copy. Select the text and copy it manually.',
    expect: 'What a good answer looks like',
    variable: 'Replace with your own:',
  },
  jp: {
    title: 'AIへの指示の例',
    copy: 'コピー',
    copyPrompt: '指示文をコピー',
    copied: 'コピーしました',
    copiedLive: '指示文をクリップボードにコピーしました。',
    copyFailed: 'コピーできませんでした。テキストを選択して手動でコピーしてください。',
    expect: '期待される結果',
    variable: '自分の内容に置き換える：',
  },
} as const;

export default function PromptBlock({ block }: BlockProps<'prompt'>) {
  const { language } = useLanguage();
  const { tx, t } = useReader();
  const { copied, copy: copyText } = useCopy();
  const text = copy[language];
  const prompt = tx(block.prompt);
  const parts = useMemo(() => splitPromptVars(prompt.value), [prompt.value]);
  const hints = useMemo(() => new Map((block.vars ?? []).map((v) => [v.name, t(v.hint)])), [block.vars, t]);
  const titleId = `${block.id}-title`;
  const target = block.target ? TARGETS[block.target] : undefined;

  return (
    <section className="rp-prompt" aria-labelledby={titleId}>
      <div className="rp-prompt-head">
        <MessageSquareText size={16} aria-hidden="true" className="shrink-0 text-primary-text" />
        <h3 id={titleId} className="rp-prompt-title">
          {block.title ? <Txt value={block.title} /> : text.title}
        </h3>
        {target && <span className="rp-chip">{target}</span>}
        <span className="flex-1" />
        <button
          type="button"
          className="rp-btn rp-btn-sm"
          aria-label={copied === 'ok' ? text.copied : text.copyPrompt}
          onClick={() => void copyText(prompt.value)}
        >
          {copied === 'ok' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied === 'ok' ? text.copied : text.copy}
        </button>
      </div>
      <p className="rp-prompt-body" lang={prompt.lang}>
        {parts.map((part, i) => (part.kind === 'text'
          ? <React.Fragment key={i}>{part.value}</React.Fragment>
          : (
            <span key={i} className="rp-prompt-var" title={hints.get(part.name) || undefined}>
              <span className="sr-only">{text.variable} </span>
              {part.name}
            </span>
          )))}
      </p>
      {block.note && <MdText value={block.note} className="rp-prompt-note" />}
      {block.expect && (
        <details className="rp-details rp-prompt-expect">
          <summary>{text.expect}</summary>
          <MdText value={block.expect} className="rp-details-body" />
        </details>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copied === 'ok' ? text.copiedLive : copied === 'error' ? text.copyFailed : ''}
      </span>
    </section>
  );
}
