import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, CircleAlert, CornerDownRight, Layers, Lightbulb, LogIn, RotateCcw, Send, Sparkles, Square, X } from 'lucide-react';
import type { Block, Section } from '../../shared/lesson/schema.js';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useReader } from './ReaderContext';
import { Markdown } from './Md';
import { ReaderSheet } from './ReaderSheet';
import { splitSectionTitle } from './model';
import {
  CHECK_BLOCK_TYPES,
  draftTutorCard,
  isTutorLimitKind,
  plainAnswer,
  saveTutorCard,
  type TutorErrorKind,
  type TutorLimitKind,
  type TutorStreamApi,
  type TutorThread,
  type TutorTurn,
} from './useTutorStream';

/**
 * Inline AI tutor (WP-11, PLAN §5.7): the quoted excerpt, a streamed answer, suggestion chips
 * (simpler / another example / quiz me / make a card), a follow-up field and a "根拠 §n" chip
 * that scrolls the text to the block the answer is grounded in.
 *
 * Layouts: a card in the reader's right margin (≥1280px), a right drawer (1024–1279px) or a
 * bottom sheet (<1024px). Drawer and sheet are ReaderSheet dialogs (portal to <body>, focus
 * trap, Esc, focus back to the ✦ that opened them). In the margin, Esc ends the conversation and
 * the reader returns focus to the ✦.
 */

const copy = {
  en: {
    title: 'AI tutor',
    closeSheet: 'Close the AI tutor',
    end: 'End this conversation',
    newQuestion: 'New question',
    aboutParagraph: 'About this paragraph',
    aboutSection: 'About this section',
    aboutCode: 'About this code',
    aboutCheck: 'About this check',
    aboutTerm: 'About this term',
    quoteLabel: 'Quoted from the lesson',
    intro: 'Press ✦ next to a paragraph, or ask here. The tutor answers from this lesson.',
    introTap: 'Tap a paragraph and choose "Ask AI tutor", or ask here. The tutor answers from this lesson.',
    hintMode: 'Hint mode',
    hintModeDetail: 'Hints first. The check shows the answer after your second try.',
    you: 'You',
    tutor: 'AI tutor',
    thinking: 'Thinking…',
    suggestions: [
      { id: 'simpler', label: 'Simpler', message: 'Can you explain this more simply?' },
      { id: 'example', label: 'Another example', message: 'Can you give me a different example?' },
      { id: 'quiz', label: 'Quiz me', message: 'Ask me one short question to check I understood this. Do not tell me the answer yet.' },
    ],
    makeCard: 'Make a card',
    makeCardHint: 'Available after the first answer',
    suggestionsLabel: 'Suggested questions',
    placeholderIdle: 'Ask about this part…',
    placeholder: 'Ask a follow-up…',
    inputLabel: 'Your question for the AI tutor',
    send: 'Send',
    stop: 'Stop',
    stopped: 'Stopped.',
    retry: 'Try again',
    source: (n: string) => `Source §${n}`,
    sourceLabel: (n: string, title: string) => `Show the source in the text: section ${n}, ${title}`,
    demo: 'Demo answer (no AI key on the server)',
    truncated: 'The answer stopped at the length limit. Ask for the rest if you need it.',
    errors: {
      unavailable: 'The AI tutor is not available right now. The lesson and the glossary still work.',
      rate_limited: 'Too many questions in a short time. Wait a moment, then try again.',
      timeout: 'The answer took too long. Please try again.',
      network: 'Could not reach the server. Check your connection and try again.',
      refused: 'The tutor could not answer this. Try asking another way.',
      rejected: 'This question could not be sent. Try a shorter question.',
      interrupted: 'The answer stopped partway. Please try again.',
      daily_limit: "Today's limit for AI tutor questions has been reached. It resets at midnight Japan time. The lesson and the glossary still work.",
      daily_limit_guest: "Today's limit for guest questions to the AI tutor has been reached. Sign in to keep asking. The lesson and the glossary still work.",
      paused: 'The AI tutor is paused for now. The lesson and the glossary still work.',
      failed: 'Something went wrong. Please try again.',
    } satisfies Record<TutorErrorKind, string>,
    signIn: 'Sign in',
    card: {
      title: 'Make a flashcard',
      tip: 'Put it in your own words: that is what makes it stick.',
      front: 'Front (question)',
      back: 'Back (answer)',
      frontDraft: (lead: string) => `What is the key point of "${lead.replace(/"/g, "'")}"?`,
      save: 'Save card',
      cancel: 'Cancel',
      saved: (n: number) => `Card saved. This lesson has ${n} card${n === 1 ? '' : 's'}.`,
      failed: 'The card could not be saved in this browser.',
    },
  },
  jp: {
    title: 'AI先生',
    closeSheet: 'AI先生を閉じる',
    end: '会話を閉じる',
    newQuestion: '新しい質問',
    aboutParagraph: 'この段落について',
    aboutSection: 'このセクションについて',
    aboutCode: 'このコードについて',
    aboutCheck: 'この問題について',
    aboutTerm: 'この用語について',
    quoteLabel: 'レッスンからの引用',
    intro: '段落の横の ✦ を押すか、ここから質問できます。AI先生はこのレッスンの内容をふまえて答えます。',
    introTap: '段落をタップして「AI先生に聞く」を押すか、ここから質問できます。AI先生はこのレッスンの内容をふまえて答えます。',
    hintMode: 'ヒントモード',
    hintModeDetail: 'まずはヒントで考えます。答えは2回挑戦したあとに問題の中で表示されます。',
    you: 'あなた',
    tutor: 'AI先生',
    thinking: '考えています…',
    suggestions: [
      { id: 'simpler', label: 'もっと簡単に', message: 'もっと簡単な言葉で説明してください。' },
      { id: 'example', label: '別の例', message: '別の例で説明してください。' },
      { id: 'quiz', label: 'クイズを出して', message: '理解できたか確かめる短い問題を1問出してください。答えはまだ言わないでください。' },
    ],
    makeCard: 'カードにする',
    makeCardHint: '最初の回答のあとで使えます',
    suggestionsLabel: '質問の候補',
    placeholderIdle: 'この部分について質問…',
    placeholder: '続けて質問…',
    inputLabel: 'AI先生への質問',
    send: '送信',
    stop: '停止',
    stopped: '停止しました。',
    retry: 'もう一度',
    source: (n: string) => `根拠 §${n}`,
    sourceLabel: (n: string, title: string) => `根拠の §${n}「${title}」を本文で表示`,
    demo: 'デモ応答（AIキー未設定）',
    truncated: '回答は長さの上限でここまでになりました。続きが必要なら聞いてください。',
    errors: {
      unavailable: 'AI先生は今は使えません。本文と用語集はそのまま使えます。',
      rate_limited: '短い時間に質問が続きました。少し待ってから、もう一度お試しください。',
      timeout: '回答に時間がかかりすぎました。もう一度お試しください。',
      network: 'サーバーに接続できませんでした。通信状況を確認して、もう一度お試しください。',
      refused: 'この質問には答えられませんでした。聞き方を変えてみてください。',
      rejected: '質問を送れませんでした。短くして、もう一度お試しください。',
      interrupted: '回答が途中で止まりました。もう一度お試しください。',
      daily_limit: '今日のAI先生への質問は上限に達しました。日本時間の0時にリセットされます。本文と用語集はそのまま使えます。',
      daily_limit_guest: 'ゲストのAI先生への質問は、今日の上限に達しました。ログインすると、続けて質問できます。本文と用語集はそのまま使えます。',
      paused: 'AI先生は、今は停止しています。本文と用語集はそのまま使えます。',
      failed: 'うまくいきませんでした。もう一度お試しください。',
    } satisfies Record<TutorErrorKind, string>,
    signIn: 'ログイン',
    card: {
      title: 'カードにする',
      tip: '自分の言葉に直すと、記憶に残りやすくなります。',
      front: '表（問い）',
      back: '裏（答え）',
      frontDraft: (lead: string) => `「${lead.replace(/「/g, '『').replace(/」/g, '』')}」のポイントは？`,
      save: 'カードを保存',
      cancel: 'やめる',
      saved: (n: number) => `カードを保存しました（このレッスンで${n}枚）。`,
      failed: 'このブラウザにはカードを保存できませんでした。',
    },
  },
} as const;

type Copy = (typeof copy)['en'] | (typeof copy)['jp'];

/** Markdown inside an answer: compact paragraphs, lists, inline code and small code blocks. */
const ANSWER_MD = [
  '[&_p]:mb-2 [&_p:last-child]:mb-0',
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5',
  '[&_strong]:font-bold',
  '[&_a]:text-primary-text [&_a]:underline [&_a]:underline-offset-2',
  '[&_:not(pre)>code]:rounded-chip [&_:not(pre)>code]:bg-sunken [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.88em]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-small',
].join(' ');

const QUOTE_MAX = 160;

/** Margin thread: fade the edge where more of the conversation is scrolled out of view. */
const EDGE_FADE = '1.75rem';
const edgeMask = (top: boolean, bottom: boolean): string | undefined => {
  if (!top && !bottom) return undefined;
  const start = top ? `transparent, black ${EDGE_FADE}` : 'black';
  const end = bottom ? `black calc(100% - ${EDGE_FADE}), transparent` : 'black';
  return `linear-gradient(to bottom, ${start}, ${end})`;
};

/** Scroll `el` into view inside its scrolling panel (margin column or sheet body), not <main>. */
const revealInPanel = (el: HTMLElement | null) => {
  const scroller = el?.closest<HTMLElement>('.rp-col-sticky, .rp-sheet-body');
  if (!el || !scroller) return;
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const below = box.bottom - view.bottom + 12;
  const above = box.top - view.top - 12;
  // Bring the bottom into view, but never push the top out of it.
  if (below > 0) scroller.scrollTop += Math.min(below, Math.max(0, above));
};

/**
 * Drawer: fills the drawer under its title, so the field sits at the bottom. Sheet: a steady
 * height while an answer streams in (it grows up to the sheet's 85dvh), compact when idle.
 */
const BODY_HEIGHT: Record<'margin' | 'drawer' | 'sheet', (active: boolean) => string> = {
  margin: () => '',
  drawer: () => 'min-h-[calc(100dvh-7rem)]',
  sheet: (active) => (active ? 'min-h-[46dvh]' : ''),
};
const clip = (value: string, max: number) => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export type TutorLayout = 'margin' | 'drawer' | 'sheet';

type TutorPanelProps = {
  tutor: TutorStreamApi;
  layout: TutorLayout;
  /** Drawer / sheet only. */
  open: boolean;
  /** Close the drawer / sheet; the conversation stays. */
  onClose: () => void;
  /** End the conversation. `returnFocus`: move focus back to the ✦ that started it (margin). */
  onDismiss: (returnFocus: boolean) => void;
  /** The ✦ (or button) that opened the drawer / sheet. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Attributes copied from the reader root onto the portal. */
  scope: { theme: string; world?: string; lang: string };
  /** Where the learner is reading: the idle panel asks about this. */
  current: { block?: Block; section?: Section };
  /** "根拠 §n": show that block in the text. */
  onShowSource: (blockId: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** The margin card, so the reader can move focus to it. */
  panelRef?: React.RefObject<HTMLElement | null>;
};

export function TutorPanel(props: TutorPanelProps) {
  const { tutor, layout, open, onClose, onDismiss, returnFocusRef, scope, panelRef } = props;
  const { language } = useLanguage();
  const text = copy[language];
  const uid = useId();
  const titleId = `${uid}-title`;
  const scopeLabel = scopeLabelFor(tutor.thread, text);
  const [cardOpen, setCardOpen] = useState(false);

  if (layout === 'margin') {
    return (
      <div role="group"
        ref={panelRef as React.RefObject<HTMLDivElement | null> | undefined}
        tabIndex={-1}
        aria-labelledby={titleId}
        className="rp-margin-card focus-visible:outline-offset-4"
        data-rp-tutor="margin"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          if (cardOpen) {
            event.stopPropagation();
            setCardOpen(false);
            return;
          }
          if (!tutor.thread) return;
          event.stopPropagation();
          onDismiss(true);
        }}
      >
        <div className="rp-tutor-head">
          <Sparkles size={15} aria-hidden="true" className="shrink-0 text-primary-text" />
          <h2 id={titleId} className="rp-margin-title">{text.title}</h2>
          <span className="rp-tutor-scope">{scopeLabel}</span>
          {tutor.thread && (
            <button
              type="button"
              className="-my-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-chip text-fg-3 hover:bg-sunken hover:text-fg"
              aria-label={text.end}
              title={text.end}
              onClick={() => onDismiss(true)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <TutorBody {...props} text={text} cardOpen={cardOpen} setCardOpen={setCardOpen} />
      </div>
    );
  }

  return (
    <ReaderSheet
      id="rp-tutor-sheet"
      open={open}
      onClose={onClose}
      variant={layout === 'drawer' ? 'drawer-end' : 'sheet'}
      title={text.title}
      closeLabel={text.closeSheet}
      scope={scope}
      returnFocusRef={returnFocusRef}
    >
      <div className="flex items-center gap-2 text-small text-fg-3" data-rp-tutor={layout}>
        <span>{scopeLabel}</span>
        {tutor.thread && (
          <button type="button" className="rp-link-btn ml-auto" onClick={() => onDismiss(false)}>
            <RotateCcw size={14} aria-hidden="true" />
            {text.newQuestion}
          </button>
        )}
      </div>
      <TutorBody {...props} text={text} cardOpen={cardOpen} setCardOpen={setCardOpen} />
    </ReaderSheet>
  );
}

function scopeLabelFor(thread: TutorThread | null, text: Copy): string {
  if (!thread) return text.aboutSection;
  const type = thread.anchor?.blockType?.toLowerCase();
  if (!thread.anchor) return thread.context ? text.aboutTerm : text.aboutSection;
  if (type === 'code') return text.aboutCode;
  if (type && CHECK_BLOCK_TYPES.has(type)) return text.aboutCheck;
  return text.aboutParagraph;
}

type BodyProps = TutorPanelProps & {
  text: Copy;
  cardOpen: boolean;
  setCardOpen: (open: boolean) => void;
};

function TutorBody({ tutor, layout, current, onShowSource, inputRef, text, cardOpen, setCardOpen }: BodyProps) {
  const reader = useReader();
  const { askTutor, tx, lesson, course } = reader;
  const { thread, busy } = tutor;
  const [draft, setDraft] = useState('');
  const [cardNotice, setCardNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const uid = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const dialog = layout !== 'margin';

  // Send and Stop are separate buttons that take turns in one slot. When the focused one is
  // removed (the answer starts or ends), focus goes back to the question field instead of <body>,
  // so the keyboard user stays in the panel (and inside the sheet dialog).
  const controlsRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const setFieldRef = (el: HTMLInputElement | null) => {
    fieldRef.current = el;
    if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      lastFocused.current = target && controlsRef.current?.contains(target) ? target : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  useEffect(() => {
    const last = lastFocused.current;
    const active = document.activeElement;
    if (!last || last.isConnected || (active && active !== document.body)) return;
    lastFocused.current = null;
    fieldRef.current?.focus({ preventScroll: true });
  }, [busy]);

  // Leaving a thread closes its card editor and notice.
  const threadKey = thread?.key ?? null;
  const cardButtonRef = useRef<HTMLButtonElement>(null);
  const cardFocusBack = useRef(false);
  useEffect(() => {
    cardFocusBack.current = false;
    setCardOpen(false);
    setCardNotice(null);
  }, [threadKey, setCardOpen]);
  // Saving, cancelling or Esc in the card editor puts focus back on "Make a card".
  useEffect(() => {
    if (cardOpen || !cardFocusBack.current) return;
    cardFocusBack.current = false;
    cardButtonRef.current?.focus({ preventScroll: true });
  }, [cardOpen]);

  // Quote: the asked excerpt, or the title of the section being read.
  const sectionTitle = current.section ? tx(current.section.title) : null;
  const excerpt = thread ? (thread.anchor?.excerpt || thread.context || '') : '';
  const quoteIsCode = thread?.anchor?.blockType === 'code';
  const quote = thread
    ? (quoteIsCode ? excerpt.trim().slice(0, QUOTE_MAX) : clip(excerpt, QUOTE_MAX))
    : (sectionTitle ? splitSectionTitle(sectionTitle.value).title : '');

  const turns = thread?.turns ?? [];
  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant');
  // A daily cap holds (useTutorStream refuses new questions): chips and Send are off, and one
  // notice explains why, unless this thread's last answer already says it.
  const limited = Boolean(tutor.limit);
  const lastTurn = turns[turns.length - 1];
  const limitNotice: TutorLimitKind | null = tutor.limit && !(lastTurn?.status === 'error' && isTutorLimitKind(lastTurn.error))
    ? tutor.limit.kind
    : null;
  const socratic = Boolean(thread) && (lastAnswer?.mode ?? thread?.mode) === 'socratic';
  const hasAnswer = turns.some((t) => t.role === 'assistant' && t.status === 'done' && t.text.trim());

  // A new question is pinned to the top of the scroll area and its answer streams in below it,
  // so the learner reads from the start (the first question shows the quote instead). The pin
  // is re-applied as the answer grows, until the learner scrolls by hand.
  const turnCount = turns.length;
  const lastLength = turns[turns.length - 1]?.text.length ?? 0;
  const pinRef = useRef<HTMLElement | null>(null);
  const scrollerOf = (thread: HTMLElement | null) => (dialog ? thread?.closest<HTMLElement>('.rp-sheet-body') : thread) ?? null;
  const applyPin = () => {
    const scroller = scrollerOf(threadRef.current);
    const pinned = pinRef.current;
    if (!scroller) return;
    if (!pinned) {
      scroller.scrollTop = 0;
      return;
    }
    const offset = pinned.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    if (offset > 1) scroller.scrollTop += offset;
  };
  useLayoutEffect(() => {
    const questions = threadRef.current?.querySelectorAll<HTMLElement>('[data-turn="user"]');
    pinRef.current = questions && questions.length > 1 ? questions[questions.length - 1] : null;
    applyPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnCount, threadKey, dialog]);
  useLayoutEffect(() => {
    if (pinRef.current) applyPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLength]);
  useEffect(() => {
    const scroller = scrollerOf(threadRef.current);
    if (!scroller) return;
    const release = () => {
      pinRef.current = null;
    };
    scroller.addEventListener('wheel', release, { passive: true });
    scroller.addEventListener('touchmove', release, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', release);
      scroller.removeEventListener('touchmove', release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey, dialog]);

  // Margin only (drawer and sheet scroll their whole body): which edges hide more text.
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measureEdges = () => {
    const el = threadRef.current;
    if (dialog || !el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  };
  useLayoutEffect(() => {
    measureEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnCount, lastLength, threadKey, dialog]);
  const mask = dialog ? undefined : edgeMask(edges.top, edges.bottom);

  const ask = (message: string, typed = false) => {
    const value = message.trim();
    if (!value) return;
    if (thread) {
      tutor.send(value, { typed });
    } else {
      if (typed) tutor.markNextTyped();
      askTutor({ message: value, block: current.block, section: current.section, mode: 'explain' });
    }
  };

  const sourceChip = (turn: TutorTurn) => {
    const grounding = turn.grounding;
    if (!grounding?.blockId) return null;
    const index = lesson.sections.findIndex((s) => s.id === grounding.sectionId);
    if (index < 0) return null;
    const title = splitSectionTitle(tx(lesson.sections[index].title).value);
    const n = title.num ?? String(index + 1);
    return (
      <button
        type="button"
        className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-caption font-semibold text-primary-text hover:border-primary hover:bg-primary-soft"
        aria-label={text.sourceLabel(n, title.title)}
        onClick={() => onShowSource(grounding.blockId)}
      >
        <CornerDownRight size={13} aria-hidden="true" />
        {text.source(n)}
      </button>
    );
  };

  // Screen readers hear the finished answer once, not every streamed piece.
  const announcement = limitNotice
    ? text.errors[limitNotice]
    : !thread || !lastAnswer
    ? ''
    : lastAnswer.status === 'streaming'
      ? text.thinking
      : lastAnswer.status === 'error'
        ? text.errors[lastAnswer.error ?? 'failed']
        : lastAnswer.status === 'stopped'
          ? text.stopped
          : `${text.tutor}: ${plainAnswer(lastAnswer.text)}`;

  return (
    <div className={`flex flex-col ${BODY_HEIGHT[layout](Boolean(thread))}`}>
      {quote && (
        <blockquote
          className={`rp-tutor-quote ${quoteIsCode ? 'font-mono text-small' : ''}`}
          aria-label={text.quoteLabel}
          lang={!thread ? sectionTitle?.lang : undefined}
        >
          <span className={`${dialog ? 'line-clamp-4' : 'line-clamp-3'} ${quoteIsCode ? 'whitespace-pre-wrap' : ''}`}>{quote}</span>
        </blockquote>
      )}

      {socratic && (
        <p className="mb-2 flex items-start gap-1.5 text-small text-fg-2">
          <Lightbulb size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-primary-text" />
          <span><strong className="font-semibold text-fg">{text.hintMode}</strong> · {text.hintModeDetail}</span>
        </p>
      )}

      {!thread && <p className="rp-tutor-intro mt-0">{layout === 'sheet' ? text.introTap : text.intro}</p>}

      {thread && (
        <div
          ref={threadRef}
          className={`flex flex-col gap-2.5 ${dialog ? '' : 'max-h-[min(50dvh,30rem)] overflow-y-auto overscroll-contain pr-1'}`}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          onScroll={dialog ? undefined : measureEdges}
          aria-busy={busy}
          data-rp-tutor-thread=""
        >
          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              text={text}
              sourceChip={turn.role === 'assistant' && turn.status === 'done' ? sourceChip(turn) : null}
              onRetry={turn === turns[turns.length - 1] ? tutor.retry : undefined}
            />
          ))}
        </div>
      )}
      {limitNotice && (
        <div className="mt-2 rounded-control border border-line bg-surface p-3 text-small text-fg-2" data-rp-tutor-limit="">
          <LimitMessage kind={limitNotice} text={text} />
        </div>
      )}
      <p className="sr-only" role="status">{announcement}</p>

      {cardOpen && thread ? (
        <CardEditor
          key={thread.key}
          thread={thread}
          text={text}
          onCancel={() => setCardOpen(false)}
          onSave={(front, back) => {
            const count = saveTutorCard({
              courseId: thread.lesson?.courseId ?? course.id,
              lessonId: thread.lesson?.lessonId ?? lesson.id,
              ...(thread.anchor?.blockId ? { blockId: thread.anchor.blockId } : {}),
              front,
              back,
            });
            setCardNotice(count === null ? { ok: false, message: text.card.failed } : { ok: true, message: text.card.saved(count) });
            setCardOpen(false);
          }}
        />
      ) : (
        <div ref={controlsRef} className={dialog ? 'sticky bottom-0 -mx-5 mt-auto border-t border-line bg-raised px-5 pb-1 pt-1' : ''}>
          {cardNotice && (
            <p className={`mt-2 flex items-start gap-1.5 text-small ${cardNotice.ok ? 'text-success' : 'text-danger'}`}>
              {cardNotice.ok
                ? <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                : <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />}
              <span role="status">{cardNotice.message}</span>
            </p>
          )}
          <ul className="rp-tutor-chips" aria-label={text.suggestionsLabel}>
            {text.suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="rp-suggestion rp-suggestion-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  // aria-disabled, not disabled: a disabled button would drop the keyboard focus.
                  aria-disabled={busy || limited || undefined}
                  onClick={() => {
                    if (!busy && !limited) ask(s.message);
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
            {thread && (
              <li>
                <button
                  ref={cardButtonRef}
                  type="button"
                  className="rp-suggestion rp-suggestion-sm gap-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  aria-disabled={busy || !hasAnswer || undefined}
                  title={hasAnswer ? undefined : text.makeCardHint}
                  onClick={() => {
                    if (busy || !hasAnswer) return;
                    setCardNotice(null);
                    cardFocusBack.current = true;
                    setCardOpen(true);
                  }}
                >
                  <Layers size={13} aria-hidden="true" />
                  {text.makeCard}
                </button>
              </li>
            )}
          </ul>
          <form
            className="rp-tutor-form"
            onSubmit={(event) => {
              event.preventDefault();
              // While a daily cap holds, the typed question stays in the field for later.
              if (busy || limited) return;
              ask(draft, true);
              setDraft('');
            }}
          >
            <label htmlFor={`${uid}-input`} className="sr-only">{text.inputLabel}</label>
            <input
              ref={setFieldRef}
              id={`${uid}-input`}
              type="text"
              className="rp-input pointer-coarse:h-11 pointer-coarse:text-base"
              placeholder={thread ? text.placeholder : text.placeholderIdle}
              value={draft}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
              enterKeyHint="send"
            />
            {busy ? (
              <button key="stop" type="button" className="rp-btn rp-btn-sm" onClick={tutor.stop}>
                <Square size={12} aria-hidden="true" className="fill-current" />
                {text.stop}
              </button>
            ) : (
              <button
                key="send"
                type="submit"
                className="rp-btn rp-btn-primary rp-btn-sm"
                aria-disabled={!draft.trim() || limited || undefined}
              >
                <Send size={14} aria-hidden="true" />
                {text.send}
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function TurnView({ turn, text, sourceChip, onRetry }: {
  turn: TutorTurn;
  text: Copy;
  sourceChip: React.ReactNode;
  onRetry?: () => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="rounded-control bg-sunken px-3 py-2 text-small text-fg" data-turn="user">
        <span className="sr-only">{text.you}: </span>
        {turn.text}
      </div>
    );
  }

  const showDemo = turn.demo && turn.status === 'done' && !/デモ|demo/i.test(turn.text);
  return (
    <div className="text-body text-fg" data-turn="assistant">
      <span className="sr-only">{text.tutor}: </span>
      {turn.text ? (
        <div className={ANSWER_MD}>
          <Markdown source={turn.text} untrusted />
        </div>
      ) : turn.status === 'streaming' ? (
        <p className="flex items-center gap-2 text-small text-fg-3">
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
            <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:300ms]" />
          </span>
          {text.thinking}
        </p>
      ) : null}

      {turn.truncated && turn.status === 'done' && (
        <p className="mt-1 text-caption text-fg-3">{text.truncated}</p>
      )}

      {turn.status === 'error' && (
        <div className="mt-2 rounded-control border border-line bg-surface p-3 text-small text-fg-2">
          {isTutorLimitKind(turn.error) ? (
            <LimitMessage kind={turn.error} text={text} />
          ) : (
            <p className="flex items-start gap-1.5">
              <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              <span>{text.errors[turn.error ?? 'failed']}</span>
            </p>
          )}
          {onRetry && !isTutorLimitKind(turn.error) && (
            <button type="button" className="rp-btn rp-btn-sm mt-2" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" />
              {text.retry}
            </button>
          )}
        </div>
      )}

      {turn.status === 'stopped' && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-small text-fg-3">
          <span>{text.stopped}</span>
          {onRetry && (
            <button type="button" className="rp-link-btn" onClick={onRetry}>
              <RotateCcw size={13} aria-hidden="true" />
              {text.retry}
            </button>
          )}
        </p>
      )}

      {(sourceChip || showDemo) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sourceChip}
          {showDemo && <span className="text-caption text-fg-3">{text.demo}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * A daily cap (not a failure): a calendar icon in the body colour, no Retry. Guests get a sign-in
 * button: signing in ends the guest session (as the course generator's sign-in does) and lifts
 * the guest budget.
 */
function LimitMessage({ kind, text }: { kind: TutorLimitKind; text: Copy }) {
  const { logout } = useAuth();
  return (
    <>
      <p className="flex items-start gap-1.5">
        <CalendarClock size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-2" />
        <span>{text.errors[kind]}</span>
      </p>
      {kind === 'daily_limit_guest' && (
        <button type="button" className="rp-btn rp-btn-sm mt-2" onClick={() => { void logout(); }}>
          <LogIn size={14} aria-hidden="true" />
          {text.signIn}
        </button>
      )}
    </>
  );
}

function CardEditor({ thread, text, onSave, onCancel }: {
  thread: TutorThread;
  text: Copy;
  onSave: (front: string, back: string) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const initial = useMemo(
    () => draftTutorCard(thread, { frontFromExcerpt: text.card.frontDraft }) ?? { front: '', back: '' },
    // The draft is taken once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [front, setFront] = useState(initial.front);
  const [back, setBack] = useState(initial.back);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // The editor opens under the thread, often below the fold of the margin column or sheet.
    revealInPanel(formRef.current);
    frontRef.current?.focus({ preventScroll: true });
  }, []);

  const field = 'w-full resize-y rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-small text-fg placeholder:text-fg-3';
  return (
    <form
      ref={formRef}
      className="mt-3 rounded-card border border-line bg-canvas p-3"
      aria-labelledby={`${uid}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (front.trim() && back.trim()) onSave(front, back);
      }}
    >
      <p id={`${uid}-title`} className="flex items-center gap-1.5 text-small font-semibold text-fg">
        <Layers size={14} aria-hidden="true" className="text-primary-text" />
        {text.card.title}
      </p>
      <p className="mt-0.5 text-caption text-fg-3">{text.card.tip}</p>
      <label htmlFor={`${uid}-front`} className="mt-2 block text-caption font-semibold text-fg-2">{text.card.front}</label>
      <textarea
        ref={frontRef}
        id={`${uid}-front`}
        className={field}
        rows={2}
        maxLength={500}
        value={front}
        onChange={(event) => setFront(event.target.value)}
      />
      <label htmlFor={`${uid}-back`} className="mt-2 block text-caption font-semibold text-fg-2">{text.card.back}</label>
      <textarea
        id={`${uid}-back`}
        className={field}
        rows={4}
        maxLength={1000}
        value={back}
        onChange={(event) => setBack(event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="rp-btn rp-btn-sm" onClick={onCancel}>{text.card.cancel}</button>
        <button type="submit" className="rp-btn rp-btn-primary rp-btn-sm" disabled={!front.trim() || !back.trim()}>
          {text.card.save}
        </button>
      </div>
    </form>
  );
}
