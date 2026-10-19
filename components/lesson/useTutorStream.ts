import { useCallback, useEffect, useRef, useState } from 'react';
import type { LlmLocale, TutorDone, TutorGrounding, TutorMeta, TutorRequest as LlmTutorRequest } from '../../services/llmApi';
import type {
  TutorAnchor,
  TutorLearnerState,
  TutorLessonRef,
  TutorMode,
  TutorRequest as BridgeTutorRequest,
} from '../../services/tutorBridge';

/**
 * State for the inline AI tutor (WP-11, PLAN §5.7).
 *
 * One thread per lesson block: asking about the same paragraph again continues its thread.
 * Answers stream from /api/v2/llm/tutor (services/llmApi.ts streamTutor, injected so the pure
 * helpers below stay importable from node tests). Follow-ups resend the anchor, so every turn
 * stays grounded in the excerpt, plus the finished turns as history.
 *
 * Socratic mode: on a check (quiz) the tutor gives hints until the learner has tried twice.
 */

export type StreamTutorFn = (
  request: LlmTutorRequest,
  handlers: { onDelta?: (text: string) => void; onMeta?: (meta: TutorMeta) => void; signal?: AbortSignal },
) => Promise<TutorDone>;

export type TutorErrorKind =
  | 'unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'refused'
  | 'rejected'
  | 'interrupted'
  | 'failed';

export type TutorTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'error' | 'stopped';
  error?: TutorErrorKind;
  grounding?: TutorGrounding | null;
  mode?: TutorMode;
  /** Answer came from the mock provider (no AI key on the server). */
  demo?: boolean;
  /** The learner typed this question (not a chip or a ✦ preset). */
  typed?: boolean;
};

export type TutorThread = {
  key: string;
  lesson?: TutorLessonRef;
  anchor?: TutorAnchor;
  learner?: TutorLearnerState;
  /** Free-text context from a legacy glossary request (used when there is no anchor). */
  context?: string;
  mode: TutorMode;
  turns: TutorTurn[];
};

/** Block types the tutor treats as checks (the server's ASSESSMENT_BLOCK_TYPES). */
export const CHECK_BLOCK_TYPES: ReadonlySet<string> = new Set(['quiz', 'exercise', 'sandbox', 'check', 'reflection']);

export const TUTOR_MESSAGE_MAX = 2000;
export const TUTOR_HISTORY_MAX = 12;
const HISTORY_CONTENT_MAX = 4000;

/**
 * Socratic while the learner has tried a check fewer than two times (PLAN §5.7); explain once
 * they have tried twice. Without learner state, checks are socratic and the rest follows `mode`.
 */
export function resolveClientMode(detail: { mode?: TutorMode; anchor?: Pick<TutorAnchor, 'blockType'>; learner?: TutorLearnerState }): TutorMode {
  const attempts = detail.learner?.attemptsOnBlock;
  if (attempts !== undefined) return attempts < 2 ? 'socratic' : 'explain';
  const blockType = detail.anchor?.blockType?.toLowerCase();
  if (blockType && CHECK_BLOCK_TYPES.has(blockType)) return 'socratic';
  return detail.mode ?? 'explain';
}

export function threadKey(lessonId: string | undefined, anchor: Pick<TutorAnchor, 'blockId'> | undefined): string {
  return `${lessonId ?? 'lesson'}::${anchor?.blockId ?? 'general'}`;
}

/** Finished question/answer pairs, newest last, within the server's history limits. */
export function threadHistory(turns: readonly TutorTurn[]): NonNullable<LlmTutorRequest['history']> {
  const pairs: NonNullable<LlmTutorRequest['history']> = [];
  for (let i = 0; i < turns.length - 1; i += 1) {
    const question = turns[i];
    const answer = turns[i + 1];
    if (question.role !== 'user' || answer.role !== 'assistant') continue;
    if (answer.status !== 'done' || !answer.text.trim()) continue;
    pairs.push(
      { role: 'user', content: question.text.slice(0, HISTORY_CONTENT_MAX) },
      { role: 'assistant', content: answer.text.slice(0, HISTORY_CONTENT_MAX) },
    );
    i += 1;
  }
  return pairs.slice(-TUTOR_HISTORY_MAX);
}

/** The /llm/tutor body for the next question in `thread`. */
export function buildTutorRequest(thread: TutorThread, message: string, locale: LlmLocale): LlmTutorRequest {
  const history = threadHistory(thread.turns);
  return {
    message: message.trim().slice(0, TUTOR_MESSAGE_MAX),
    mode: thread.mode,
    ...(thread.lesson ? { lesson: thread.lesson } : {}),
    ...(thread.anchor ? { anchor: thread.anchor } : {}),
    ...(thread.learner ? { learner: thread.learner } : {}),
    ...(!thread.anchor && thread.context ? { context: thread.context } : {}),
    ...(history.length ? { history } : {}),
    locale,
  };
}

/** Maps an LlmApiError (status / errorType), a fetch TypeError or anything else to a UI message key. */
export function classifyTutorError(error: unknown): TutorErrorKind {
  const err = (error ?? {}) as { status?: unknown; errorType?: unknown; name?: unknown };
  const type = typeof err.errorType === 'string' ? err.errorType : '';
  const status = typeof err.status === 'number' ? err.status : 0;
  if (type === 'rate_limited' || status === 429) return 'rate_limited';
  if (type === 'timeout' || status === 504) return 'timeout';
  if (type === 'refusal' || status === 422) return 'refused';
  if (type === 'incomplete_stream' || type === 'empty_stream' || type === 'max_tokens') return 'interrupted';
  if (type === 'invalid_body' || type === 'bad_request' || status === 400 || status === 413) return 'rejected';
  if (['no_provider', 'provider_unavailable', 'auth'].includes(type) || status === 503 || status === 401 || status === 403) return 'unavailable';
  if (err.name === 'TypeError') return 'network';
  return 'failed';
}

// --- Flashcards ("カードにする") ----------------------------------------------------------

export const TUTOR_CARDS_KEY = 'rp:tutorCards';
const TUTOR_CARDS_MAX = 300;

export type TutorCard = {
  id: string;
  courseId: string;
  lessonId: string;
  blockId?: string;
  front: string;
  back: string;
  createdAt: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readTutorCards(storage: StorageLike | null = defaultStorage()): TutorCard[] {
  try {
    const parsed = JSON.parse(storage?.getItem(TUTOR_CARDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is TutorCard => Boolean(c)
      && typeof c.front === 'string' && typeof c.back === 'string'
      && typeof c.courseId === 'string' && typeof c.lessonId === 'string');
  } catch {
    return [];
  }
}

/** Saves a card; returns how many cards this lesson has now, or null when storage failed. */
export function saveTutorCard(
  card: Omit<TutorCard, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  storage: StorageLike | null = defaultStorage(),
): number | null {
  if (!storage) return null;
  const front = card.front.trim().slice(0, 500);
  const back = card.back.trim().slice(0, 1000);
  if (!front || !back) return null;
  const next: TutorCard = {
    ...card,
    front,
    back,
    id: card.id ?? `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: card.createdAt ?? new Date().toISOString(),
  };
  const cards = [...readTutorCards(storage), next].slice(-TUTOR_CARDS_MAX);
  try {
    storage.setItem(TUTOR_CARDS_KEY, JSON.stringify(cards));
  } catch {
    return null;
  }
  return cards.filter((c) => c.courseId === next.courseId && c.lessonId === next.lessonId).length;
}

/** Markdown answer → plain text for a card: no code fences, emphasis, links or the demo note. */
export function plainAnswer(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[（(](?:デモ|Demo)[^\n]*$/gim, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** First sentence of the excerpt, for a card front such as 「…」とはどういうこと？ */
export function excerptLead(excerpt: string, max = 40): string {
  const flat = excerpt.replace(/\s+/g, ' ').trim();
  const sentence = flat.split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/)[0] ?? flat;
  return clipText(sentence.replace(/[。．.]$/, ''), max);
}

/**
 * A card to edit before saving: the learner's own typed question (or a prompt about the
 * excerpt) on the front, the latest answer on the back. Rewriting it in their own words is
 * the point, so it is a draft, not a finished card.
 */
export function draftTutorCard(
  thread: TutorThread,
  options: { frontFromExcerpt: (lead: string) => string },
): { front: string; back: string } | null {
  const answerIndex = thread.turns.map((t) => t.role === 'assistant' && t.status === 'done' && Boolean(t.text.trim())).lastIndexOf(true);
  if (answerIndex < 0) return null;
  const answer = thread.turns[answerIndex];
  const asked = thread.turns.slice(0, answerIndex).reverse();
  const typed = asked.find((t) => t.role === 'user' && t.typed);
  const excerpt = thread.anchor?.excerpt || thread.context || '';
  const lastQuestion = asked.find((t) => t.role === 'user');
  const front = typed
    ? typed.text.trim()
    : excerpt
      ? options.frontFromExcerpt(excerptLead(excerpt))
      : lastQuestion?.text.trim() ?? '';
  return { front: clipText(front, 200), back: clipText(plainAnswer(answer.text), 400) };
}

// --- Hook -----------------------------------------------------------------------------------

export type TutorStreamApi = {
  /** The conversation on screen, or null (idle). */
  thread: TutorThread | null;
  /** An answer is streaming. */
  busy: boolean;
  /** Start or continue the thread for a request from openTutor(). */
  ask: (request: BridgeTutorRequest) => void;
  /** Follow-up in the current thread. */
  send: (message: string, options?: { typed?: boolean }) => void;
  /** The next ask() comes from the learner's own words (the idle panel's input). */
  markNextTyped: () => void;
  /** Re-ask the last question after an error or a stop. */
  retry: () => void;
  /** Stop the answer that is streaming. */
  stop: () => void;
  /** End the conversation on screen (it is kept for the block, and the stream stops). */
  dismiss: () => void;
};

let turnSeq = 0;
const nextTurnId = () => {
  turnSeq += 1;
  return `tt-${turnSeq}`;
};

const patchTurn = (thread: TutorThread, id: string, patch: (turn: TutorTurn) => TutorTurn): TutorThread => ({
  ...thread,
  turns: thread.turns.map((turn) => (turn.id === id ? patch(turn) : turn)),
});

export function useTutorStream({ locale, stream }: { locale: LlmLocale; stream: StreamTutorFn }): TutorStreamApi {
  const threads = useRef(new Map<string, TutorThread>());
  const activeKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const nextTyped = useRef(false);
  const [thread, setThread] = useState<TutorThread | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest values for the stable callbacks below.
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const update = useCallback((key: string, fn: (t: TutorThread) => TutorThread) => {
    const current = threads.current.get(key);
    if (!current) return;
    const next = fn(current);
    threads.current.set(key, next);
    if (activeKey.current === key) setThread(next);
  }, []);

  const run = useCallback(async (key: string, message: string, typed = false) => {
    const base = threads.current.get(key);
    const text = message.trim().slice(0, TUTOR_MESSAGE_MAX);
    if (!base || !text) return;
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;

    const request = buildTutorRequest(base, text, localeRef.current);
    const answerId = nextTurnId();
    update(key, (t) => ({
      ...t,
      turns: [
        ...t.turns,
        { id: nextTurnId(), role: 'user', text, status: 'done', ...(typed ? { typed } : {}) },
        { id: answerId, role: 'assistant', text: '', status: 'streaming', mode: t.mode },
      ],
    }));
    setBusy(true);

    try {
      const done = await streamRef.current(request, {
        signal: own.signal,
        onMeta: (meta) => update(key, (t) => patchTurn(t, answerId, (turn) => ({ ...turn, mode: meta.mode, grounding: meta.grounding }))),
        onDelta: (delta) => update(key, (t) => patchTurn(t, answerId, (turn) => ({ ...turn, text: turn.text + delta }))),
      });
      update(key, (t) => patchTurn(t, answerId, (turn) => ({
        ...turn,
        text: done.text || turn.text,
        status: 'done',
        mode: done.mode ?? turn.mode,
        grounding: done.grounding ?? turn.grounding ?? null,
        demo: done.provider === 'mock',
      })));
    } catch (error) {
      if (own.signal.aborted) {
        update(key, (t) => patchTurn(t, answerId, (turn) => ({ ...turn, status: 'stopped' })));
      } else {
        update(key, (t) => patchTurn(t, answerId, (turn) => ({ ...turn, status: 'error', error: classifyTutorError(error) })));
      }
    } finally {
      if (controller.current === own) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, [update]);

  const ask = useCallback((request: BridgeTutorRequest) => {
    const typed = nextTyped.current;
    nextTyped.current = false;
    const { lesson, anchor, learner } = request.tutor;
    const key = threadKey(lesson?.lessonId, anchor);
    const existing = threads.current.get(key);
    // A double press on ✦ while the same question is still streaming: just show the thread.
    const [question, answer] = existing?.turns.slice(-2) ?? [];
    if (existing && answer?.status === 'streaming' && question?.text === request.message.trim()) {
      activeKey.current = key;
      setThread(existing);
      return;
    }
    const base: TutorThread = {
      key,
      turns: existing?.turns ?? [],
      lesson: lesson ?? existing?.lesson,
      anchor: anchor ?? existing?.anchor,
      learner: learner ?? existing?.learner,
      context: request.legacyContext ?? existing?.context,
      mode: resolveClientMode({ ...request.tutor, learner: learner ?? existing?.learner }),
    };
    threads.current.set(key, base);
    activeKey.current = key;
    setThread(base);
    void run(key, request.message, typed);
  }, [run]);

  const send = useCallback((message: string, options: { typed?: boolean } = {}) => {
    if (activeKey.current) void run(activeKey.current, message, options.typed);
  }, [run]);

  const markNextTyped = useCallback(() => {
    nextTyped.current = true;
  }, []);

  const retry = useCallback(() => {
    const key = activeKey.current;
    const current = key ? threads.current.get(key) : null;
    if (!key || !current) return;
    const last = current.turns[current.turns.length - 1];
    const question = current.turns[current.turns.length - 2];
    if (!last || !question || last.role !== 'assistant' || question.role !== 'user') return;
    if (last.status !== 'error' && last.status !== 'stopped') return;
    update(key, (t) => ({ ...t, turns: t.turns.slice(0, -2) }));
    void run(key, question.text, question.typed);
  }, [run, update]);

  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    controller.current?.abort();
    activeKey.current = null;
    setThread(null);
  }, []);

  // Stop streaming when the reader unmounts (another lesson, another route).
  useEffect(() => () => controller.current?.abort(), []);

  return { thread, busy, ask, send, markNextTyped, retry, stop, dismiss };
}
