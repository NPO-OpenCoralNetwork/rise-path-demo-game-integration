import React, { useMemo, useState } from 'react';
import { Check, Copy, MessageSquareText, PencilLine, RotateCcw, SquareTerminal } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { splitPromptVars } from '../model';
import { useCopy } from './useCopy';
import { claudeCommand, fillPrompt, promptVarNames } from './blockText';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * A prompt to give an AI: `{{variables}}` are inline text fields the learner fills in, [Copy]
 * copies the filled prompt, [Use in Claude Code] copies a ready-to-paste terminal command
 * (`claude '<prompt>'`, POSIX single-quoted), and the expected result sits in a disclosure.
 * Both copies are announced via aria-live.
 */

const TARGETS: Record<string, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

/** Targets where the Claude Code command makes sense. */
const CLAUDE_CODE_TARGETS = new Set([undefined, 'any', 'claude', 'claude-code']);

const copy = {
  en: {
    title: 'Prompt example',
    copy: 'Copy',
    copyPrompt: 'Copy the prompt',
    copied: 'Copied',
    copiedLive: 'Prompt copied to the clipboard.',
    copyFailed: 'Could not copy. Select the text and copy it manually.',
    claude: 'Use in Claude Code',
    claudeLabel: 'Copy a terminal command that starts Claude Code with this prompt',
    claudeCopied: 'Command copied. Paste it into your terminal and press Enter.',
    claudeLive: 'Claude Code command copied to the clipboard. Paste it into your terminal and press Enter.',
    expect: 'What a good answer looks like',
    variable: (name: string) => `Fill in: ${name}`,
    fillHint: 'Edit the highlighted fields, then copy. Empty fields stay as {{…}}.',
    left: (n: number) => (n === 1 ? '1 field left' : `${n} fields left`),
    allFilled: 'All fields filled',
    reset: 'Reset',
    resetLabel: 'Clear the fields',
  },
  jp: {
    title: 'AIへの指示の例',
    copy: 'コピー',
    copyPrompt: '指示文をコピー',
    copied: 'コピーしました',
    copiedLive: '指示文をクリップボードにコピーしました。',
    copyFailed: 'コピーできませんでした。テキストを選択して手動でコピーしてください。',
    claude: 'Claude Codeで使う',
    claudeLabel: 'この指示で Claude Code を起動するコマンドをコピー',
    claudeCopied: 'コマンドをコピーしました。ターミナルに貼り付けて Enter で実行できます。',
    claudeLive: 'Claude Code 用のコマンドをコピーしました。ターミナルに貼り付けて Enter キーで実行できます。',
    expect: '期待される結果',
    variable: (name: string) => `入力欄：${name}`,
    fillHint: '色付きの欄を書き換えてからコピーできます。空欄は {{…}} のまま残ります。',
    left: (n: number) => `未入力 ${n}`,
    allFilled: 'すべて入力済み',
    reset: 'リセット',
    resetLabel: '入力欄を空に戻す',
  },
} as const;

type VarFieldProps = {
  name: string;
  value: string;
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
};

/** Inline text field that grows with its content (CSS grid sizer, see blocks.css). */
function VarField({ name, value, hint, label, onChange, onFocus, onBlur }: VarFieldProps) {
  return (
    <span className="rp-var" data-filled={value.trim() ? '' : undefined} data-size={value || name}>
      <input
        type="text"
        className="rp-var-input"
        value={value}
        placeholder={name}
        aria-label={hint ? `${label} (${hint})` : label}
        title={hint || undefined}
        size={1}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </span>
  );
}

export default function PromptBlock({ block }: BlockProps<'prompt'>) {
  const { language } = useLanguage();
  const { tx, t } = useReader();
  const promptCopy = useCopy();
  const commandCopy = useCopy(6000);
  const text = copy[language];
  const prompt = tx(block.prompt);
  const parts = useMemo(() => splitPromptVars(prompt.value), [prompt.value]);
  const names = useMemo(() => promptVarNames(prompt.value), [prompt.value]);
  const hints = useMemo(() => new Map((block.vars ?? []).map((v) => [v.name, t(v.hint)])), [block.vars, t]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const titleId = `${block.id}-title`;
  const target = block.target ? TARGETS[block.target] : undefined;
  const showClaude = CLAUDE_CODE_TARGETS.has(block.target);
  const filled = fillPrompt(prompt.value, values);
  const left = names.filter((name) => !values[name]?.trim()).length;
  const edited = names.some((name) => values[name]);
  const focusedHint = focused ? hints.get(focused) : undefined;

  const live = commandCopy.copied === 'ok'
    ? text.claudeLive
    : promptCopy.copied === 'ok'
      ? text.copiedLive
      : promptCopy.copied === 'error' || commandCopy.copied === 'error'
        ? text.copyFailed
        : '';

  return (
    <section className="rp-prompt" aria-labelledby={titleId}>
      <div className="rp-prompt-head">
        <MessageSquareText size={16} aria-hidden="true" className="shrink-0 text-primary-text" />
        <h3 id={titleId} className="rp-prompt-title">
          {block.title ? <Txt value={block.title} /> : text.title}
        </h3>
        {target && <span className="rp-chip">{target}</span>}
        <span className="rp-prompt-spacer" />
        <div className="rp-prompt-actions">
          <button
            type="button"
            className="rp-btn rp-btn-sm"
            data-copied={promptCopy.copied === 'ok' || undefined}
            aria-label={promptCopy.copied === 'ok' ? text.copied : text.copyPrompt}
            onClick={() => void promptCopy.copy(filled)}
          >
            {promptCopy.copied === 'ok' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {promptCopy.copied === 'ok' ? text.copied : text.copy}
          </button>
          {showClaude && (
            <button
              type="button"
              className="rp-btn rp-btn-sm"
              data-copied={commandCopy.copied === 'ok' || undefined}
              aria-label={text.claudeLabel}
              title={text.claudeLabel}
              onClick={() => void commandCopy.copy(claudeCommand(filled))}
            >
              {commandCopy.copied === 'ok' ? <Check size={14} aria-hidden="true" /> : <SquareTerminal size={14} aria-hidden="true" />}
              {text.claude}
            </button>
          )}
        </div>
      </div>

      {commandCopy.copied === 'ok' && (
        <p className="rp-prompt-toast" aria-hidden="true">
          <Check size={14} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0">
            {text.claudeCopied}
            <code className="rp-prompt-cmd">{claudeCommand(filled)}</code>
          </span>
        </p>
      )}

      <p className="rp-prompt-body" lang={prompt.lang}>
        {parts.map((part, i) => (part.kind === 'text'
          ? <React.Fragment key={i}>{part.value}</React.Fragment>
          : (
            <VarField
              key={i}
              name={part.name}
              value={values[part.name] ?? ''}
              hint={hints.get(part.name) || undefined}
              label={text.variable(part.name)}
              onChange={(value) => setValues((prev) => ({ ...prev, [part.name]: value }))}
              onFocus={() => setFocused(part.name)}
              onBlur={() => setFocused((current) => (current === part.name ? null : current))}
            />
          )))}
      </p>

      {names.length > 0 && (
        <div className="rp-prompt-fill">
          <PencilLine size={14} aria-hidden="true" className="mt-1 shrink-0" />
          <p className="rp-prompt-fill-text">
            {focused && focusedHint ? <><strong>{focused}</strong>{language === 'jp' ? '：' : ': '}{focusedHint}</> : text.fillHint}
          </p>
          <span className="rp-prompt-left tabular" data-done={left === 0 || undefined}>
            {left === 0 ? text.allFilled : text.left(left)}
          </span>
          {edited && (
            <button type="button" className="rp-link-btn" aria-label={text.resetLabel} onClick={() => setValues({})}>
              <RotateCcw size={13} aria-hidden="true" />{text.reset}
            </button>
          )}
        </div>
      )}

      {block.note && <MdText value={block.note} className="rp-prompt-note" />}
      {block.expect && (
        <details className="rp-details rp-prompt-expect">
          <summary>{text.expect}</summary>
          <MdText value={block.expect} className="rp-details-body" />
        </details>
      )}
      <span role="status" aria-live="polite" className="sr-only">{live}</span>
    </section>
  );
}
