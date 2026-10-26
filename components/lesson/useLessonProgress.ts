import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LText, Lesson } from '../../shared/lesson/schema.js';
import { resolveText } from '../../shared/lesson/text.js';
import { mergeProgress, progressContentEqual } from '../../shared/lesson/progressMerge.js';
import { addLearningEvent } from '../../services/progressService';
import {
  PROGRESS_EVENT,
  answerKey,
  lessonGenOf,
  parseProgress,
  progressKey,
  readProgress,
  setLastLesson,
  withAnswer,
  withCheck,
  withLastBlock,
  withRating,
  withRevealed,
  withSeen,
  withSummary,
  writeProgress,
  type AnswerRecord,
  type LessonGen,
  type LessonProgress,
  type ProgressEventDetail,
  type SelfRating,
} from './progressStore.ts';
import { lessonPct, lessonState, lessonStateEvents, sectionByBlock, type LessonEventType, type LessonState } from './model.ts';
import {
  SYNC_ACCOUNT_EVENT,
  SYNC_ACCOUNT_KEY,
  isSignedOutAccount,
  readerGenChange,
  readerMustDrop,
  readerStartGen,
  type LessonResetResult,
  type ReaderGen,
} from './progressSync.ts';
import { resetLessonProgress } from './progressSyncClient';

/** A block counts as seen after ≥60% of it (or of the viewport) is visible for this long. */
const SEEN_DWELL_MS = 1500;
const SEEN_RATIO = 0.6;
/** Sticky LessonBar height (56px + 3px progress line). */
const BAR_HEIGHT = 59;
/** Above this scrollTop the reader resumes at a block; below it, at the top. */
const TOP_ZONE = 120;
/** A block counts as "at the top" while its bottom is this far below the bar. */
const TOP_SLACK = 24;

export type LessonProgressApi = {
  progress: LessonProgress;
  seen: ReadonlySet<string>;
  /** Block at the reading line (about a third of the way down the viewport). */
  activeBlockId: string | null;
  /** First block visible under the bar: what "resume" returns to. */
  topBlockId: string | null;
  activeSectionId: string | null;
  pct: number;
  state: LessonState;
  getAnswer: (blockId: string, questionId: string) => AnswerRecord | undefined;
  recordAnswer: (
    blockId: string,
    questionId: string,
    submission: { chosen: string[]; correct: boolean; revealed?: boolean },
  ) => void;
  revealAnswer: (blockId: string, questionId: string) => void;
  getCheck: (id: string) => boolean | undefined;
  setCheck: (id: string, value: boolean) => void;
  setRating: (objectiveId: string, rating: SelfRating) => void;
  /**
   * How many times synced server data was merged into this lesson's progress since it loaded.
   * LessonReader re-applies the resume position on a change while the learner has not
   * interacted yet.
   */
  serverMerges: number;
  /**
   * Phase 5: how many times the in-memory record was dropped for the stored one (the lesson was
   * started over here or elsewhere, or another learner took the browser). LessonReader keys the
   * sections with it, so quiz, flashcard and step blocks drop their local state.
   */
  drops: number;
  /** Phase 5: start this lesson over (server first; see progressSync.ts resetLesson). */
  resetLesson: () => Promise<LessonResetResult>;
};

type Options = {
  courseSlug: string;
  lesson: Lesson;
  /** Lesson title in the UI language, stored with rp:lastLesson. */
  title: string;
  articleRef: RefObject<HTMLElement | null>;
  container: HTMLElement | null;
  /** False until the reader has restored the resume position; the position is not saved before. */
  trackPosition: boolean;
  /**
   * False keeps this lesson out of rp:lastLesson (dev gallery), so "continue" is not replaced,
   * and out of the learning events.
   */
  recordLastLesson?: boolean;
  /** Course title for the learning events' description. */
  courseTitle?: LText;
};

const EVENT_COPY: Record<LessonEventType, { en: string; jp: string }> = {
  lesson_start: { en: 'Started', jp: '開始' },
  lesson_complete: { en: 'Completed', jp: '完了' },
};

/** lesson_start / lesson_complete for the learning history (Phase 5: history only, never XP). */
function recordLessonEvent(type: LessonEventType, lesson: Lesson, courseTitle: LText | undefined) {
  const title = (locale: 'en' | 'jp') => resolveText(lesson.title, locale, lesson.locale).value;
  const course = (locale: 'en' | 'jp') => (courseTitle ? resolveText(courseTitle, locale, lesson.locale).value : '');
  try {
    addLearningEvent({
      type,
      title: { en: `${EVENT_COPY[type].en}: ${title('en')}`, jp: `${EVENT_COPY[type].jp}: ${title('jp')}` },
      description: { en: course('en'), jp: course('jp') },
    });
  } catch {
    // Storage full or blocked: the event is lost, the lesson stays readable.
  }
}

const blockElements = (article: HTMLElement | null) =>
  article ? Array.from(article.querySelectorAll<HTMLElement>('[data-rp-block]')) : [];

/** Whose progress this browser holds (progressSync.ts), as stored. */
function readSyncAccount(): string | null {
  try {
    return window.localStorage.getItem(SYNC_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/** The lesson's stored record as raw JSON (its lessonGen stamp included), or null. */
function readRawRecord(courseSlug: string, lessonId: string): string | null {
  try {
    return window.localStorage.getItem(progressKey(courseSlug, lessonId));
  } catch {
    return null;
  }
}

export function useLessonProgress({ courseSlug, lesson, title, articleRef, container, trackPosition, recordLastLesson = true, courseTitle }: Options): LessonProgressApi {
  const [progress, setProgress] = useState<LessonProgress>(() => readProgress(courseSlug, lesson.id));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [topBlockId, setTopBlockId] = useState<string | null>(null);
  const [serverMerges, setServerMerges] = useState(0);
  const [drops, setDrops] = useState(0);
  const loadedKey = useRef(`${courseSlug}/${lesson.id}`);
  const dirty = useRef(false);
  // Whose progress the in-memory record belongs to (rp:progressSync:account when it was read).
  const account = useRef<string | null>(readSyncAccount());
  // The record as this reader last read or wrote it in storage (readerMustDrop: was it cleared?).
  const persisted = useRef<LessonProgress>(progress);
  // The learner signed out (in another tab) while this reader is open: rp:lastLesson stays cleared.
  const signedOut = useRef(false);
  // Phase 5: the generation the in-memory record builds on (progressSync.ts readerStartGen).
  const [startGen] = useState<ReaderGen>(() => readerStartGen(readRawRecord(courseSlug, lesson.id)));
  const loadedGen = useRef<ReaderGen>(startGen);
  // The unstamped write of this lesson last merged in ('merge'): the write that follows stamps it.
  const mergedRaw = useRef<string | null>(null);

  /** The stamp to write with: a pending born stamp gets the time of its first write. */
  const writeGen = useCallback((): LessonGen => {
    const gen = loadedGen.current;
    if (gen.kind === 'born' && gen.bornAt === null) {
      const born: LessonGen = { kind: 'born', bornAt: new Date().toISOString() };
      loadedGen.current = born;
      return born;
    }
    return gen as LessonGen;
  }, []);

  // Another lesson in the same reader instance: reload its progress.
  useEffect(() => {
    const key = `${courseSlug}/${lesson.id}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    dirty.current = false;
    account.current = readSyncAccount();
    const raw = readRawRecord(courseSlug, lesson.id);
    loadedGen.current = readerStartGen(raw);
    mergedRaw.current = null;
    const stored = parseProgress(raw);
    persisted.current = stored;
    setProgress(stored);
    setActiveBlockId(null);
    setTopBlockId(null);
    setServerMerges(0);
  }, [courseSlug, lesson.id]);

  const update = useCallback((fn: (p: LessonProgress) => LessonProgress) => {
    setProgress((prev) => {
      const next = fn(prev);
      if (next !== prev) dirty.current = true;
      return next;
    });
  }, []);

  const pct = useMemo(() => lessonPct(lesson, progress), [lesson, progress]);
  const state = useMemo(() => lessonState(lesson, progress), [lesson, progress]);
  const lastState = useRef<LessonState>(state);

  /** The in-memory record goes for the stored one (never written back), without learning events. */
  const restartFrom = useCallback((raw: string | null) => {
    const stored = parseProgress(raw);
    loadedGen.current = readerStartGen(raw);
    mergedRaw.current = null;
    dirty.current = false;
    persisted.current = stored;
    lastState.current = lessonState(lesson, stored);
    setProgress(stored);
    setDrops((n) => n + 1);
  }, [lesson]);

  /**
   * Another learner signed in (this tab or another), or the progress was deleted or reset: the
   * in-memory record belongs to the old owner. It is dropped for what is stored now (never
   * written back), without learning events. Returns true when that happened.
   * Phase 5, the lesson's generation (progressSync.ts readerGenChange): `reset` (this lesson was
   * started over) or a stored record of another generation → restart; a born or legacy record the
   * sync kept and stamped → adopt the stamp and merge (returns true: the merge's render writes);
   * a write that took this reader's known stamp off (an old bundle) → with rewriteForeign, write
   * the reader's own record again with its stamp; for a lesson never started over (known(null))
   * the write is merged in instead (returns true: the merge's render writes it back stamped).
   * Decided by content, never by clocks.
   */
  const dropIfAccountSwitched = useCallback(({ rewriteForeign = false, reset = false }: { rewriteForeign?: boolean; reset?: boolean } = {}): boolean => {
    const before = account.current;
    const now = readSyncAccount();
    account.current = now;
    if (before !== now) {
      const stored = readProgress(courseSlug, lesson.id);
      if (readerMustDrop(before, now, stored, persisted.current)) {
        signedOut.current = isSignedOutAccount(now);
        restartFrom(readRawRecord(courseSlug, lesson.id));
        return true;
      }
    }
    const raw = readRawRecord(courseSlug, lesson.id);
    if (reset) {
      restartFrom(raw);
      return true;
    }
    const change = readerGenChange(loadedGen.current, raw, persisted.current);
    if (change === 'restart') {
      restartFrom(raw);
      return true;
    }
    if (change === 'adopt') {
      const stored = parseProgress(raw);
      loadedGen.current = lessonGenOf(raw);
      persisted.current = stored;
      setProgress((prev) => {
        const merged = mergeProgress(stored, prev);
        lastState.current = lessonState(lesson, merged);
        dirty.current = dirty.current || !progressContentEqual(merged, stored);
        return merged;
      });
      setServerMerges((n) => n + 1);
      return true;
    }
    if (change === 'merge' && raw !== mergedRaw.current) {
      // Never started over (as far as this reader knows): another tab's unstamped write of this
      // lesson (an old bundle) is kept, not reverted. If the lesson was reset meanwhile, the
      // server refuses the null stamp and the sync drops the record (G10).
      mergedRaw.current = raw;
      const stored = parseProgress(raw);
      persisted.current = stored;
      setProgress((prev) => {
        const merged = { ...mergeProgress(stored, prev) };
        lastState.current = lessonState(lesson, merged);
        dirty.current = true;
        return merged;
      });
      setServerMerges((n) => n + 1);
      return true;
    }
    if (change === 'foreign' && rewriteForeign) {
      dirty.current = true;
      setProgress((p) => ({ ...p }));
    }
    return false;
  }, [courseSlug, lesson, restartFrom]);

  useEffect(() => {
    const check = () => {
      dropIfAccountSwitched();
    };
    const key = progressKey(courseSlug, lesson.id);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SYNC_ACCOUNT_KEY || event.key === null) check();
      // Phase 5: another tab wrote this lesson (its sync, its reader, or an older bundle).
      else if (event.key === key) dropIfAccountSwitched({ rewriteForeign: true });
    };
    window.addEventListener(SYNC_ACCOUNT_EVENT, check);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SYNC_ACCOUNT_EVENT, check);
      window.removeEventListener('storage', onStorage);
    };
  }, [courseSlug, lesson.id, dropIfAccountSwitched]);

  // Synced server data for this lesson (PROGRESS_EVENT source 'server'): merge it into the
  // in-memory record. The merged state becomes the baseline first, so server data never fires
  // lesson_start / lesson_complete; it is written back only when it holds more than the stored one.
  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<ProgressEventDetail | undefined>).detail;
      if (!detail || detail.source !== 'server' || detail.courseSlug !== courseSlug || detail.lessonId !== lesson.id) return;
      if (dropIfAccountSwitched({ reset: detail.reset === true })) return;
      const stored = readProgress(courseSlug, lesson.id);
      persisted.current = stored;
      setProgress((prev) => {
        const merged = mergeProgress(stored, prev);
        lastState.current = lessonState(lesson, merged);
        dirty.current = dirty.current || !progressContentEqual(merged, stored);
        return merged;
      });
      setServerMerges((n) => n + 1);
    };
    window.addEventListener(PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_EVENT, onProgress);
  }, [courseSlug, lesson, dropIfAccountSwitched]);

  // Persist after each change (with the pct/state snapshot for course maps), and remember this
  // lesson for "continue" on the dashboard. Only changes the learner made (dirty, not a reload)
  // add learning events.
  useEffect(() => {
    const before = lastState.current;
    lastState.current = state;
    if (dirty.current) {
      dirty.current = false;
      // Never write another learner's (or deleted) progress back: re-read instead.
      if (dropIfAccountSwitched()) return;
      const record = withSummary(progress, { pct, state });
      if (writeProgress(courseSlug, lesson.id, record, undefined, writeGen())) persisted.current = record;
      if (recordLastLesson) {
        for (const type of lessonStateEvents(before, state)) recordLessonEvent(type, lesson, courseTitle);
      }
    }
    if (recordLastLesson && !signedOut.current) setLastLesson({ courseSlug, lessonId: lesson.id, title, pct });
  }, [courseSlug, lesson, progress, title, pct, state, recordLastLesson, courseTitle, dropIfAccountSwitched, writeGen]);

  // --- seen: IntersectionObserver rooted on the scrolling <main> ---
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !container || typeof IntersectionObserver === 'undefined') return;
    const timers = new Map<string, number>();
    const already = new Set(progress.seen);
    const thresholds = Array.from({ length: 21 }, (_, i) => i / 20);

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.rpBlock;
        if (!id || already.has(id)) continue;
        const viewport = entry.rootBounds?.height ?? container.clientHeight;
        const visible = entry.intersectionRect.height;
        const qualifies = entry.isIntersecting
          && (entry.intersectionRatio >= SEEN_RATIO || (viewport > 0 && visible >= viewport * SEEN_RATIO));
        if (qualifies && !timers.has(id)) {
          timers.set(id, window.setTimeout(() => {
            timers.delete(id);
            already.add(id);
            observer.unobserve(entry.target);
            update((p) => withSeen(p, [id]));
          }, SEEN_DWELL_MS));
        } else if (!qualifies && timers.has(id)) {
          window.clearTimeout(timers.get(id));
          timers.delete(id);
        }
      }
    }, { root: container, rootMargin: `-${BAR_HEIGHT}px 0px 0px 0px`, threshold: thresholds });

    for (const el of blockElements(article)) {
      if (!already.has(el.dataset.rpBlock ?? '')) observer.observe(el);
    }
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
    // progress.seen is read once per lesson (and once per drop: the record was replaced) on
    // purpose: re-observing on every mark would reset timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleRef, container, lesson, update, drops]);

  // --- active block (reading line) and top block (resume point) ---
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !container) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const elements = blockElements(article);
      if (!elements.length) return;
      const top = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const line = top + BAR_HEIGHT + Math.min(240, container.clientHeight * 0.3);
      const topLine = top + BAR_HEIGHT + TOP_SLACK;
      let active: HTMLElement | null = null;
      let first: HTMLElement | null = null;
      for (const el of elements) {
        const bottom = el.getBoundingClientRect().bottom;
        if (!first && bottom > topLine) first = el;
        if (bottom > line) {
          active = el;
          break;
        }
      }
      // Near the end of the lesson the reading line can sit below the last block.
      const atEnd = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      const last = elements[elements.length - 1];
      setActiveBlockId((atEnd ? last : active ?? last).dataset.rpBlock ?? null);
      setTopBlockId((first ?? last).dataset.rpBlock ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [articleRef, container, lesson]);

  // --- resume position (debounced; only after the reader restored the previous one) ---
  useEffect(() => {
    if (!trackPosition || !container) return;
    const timer = window.setTimeout(() => {
      const atTop = container.scrollTop < TOP_ZONE;
      update((p) => withLastBlock(p, atTop ? null : topBlockId));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [topBlockId, container, trackPosition, update]);

  const sections = useMemo(() => sectionByBlock(lesson), [lesson]);
  const seen = useMemo(() => new Set(progress.seen), [progress.seen]);

  const getAnswer = useCallback(
    (blockId: string, questionId: string) => progress.answers[answerKey(blockId, questionId)],
    [progress.answers],
  );
  const recordAnswer = useCallback<LessonProgressApi['recordAnswer']>(
    (blockId, questionId, submission) => update((p) => withAnswer(p, answerKey(blockId, questionId), submission)),
    [update],
  );
  const revealAnswer = useCallback(
    (blockId: string, questionId: string) => update((p) => withRevealed(p, answerKey(blockId, questionId))),
    [update],
  );
  const getCheck = useCallback((id: string) => progress.checks[id], [progress.checks]);
  const setCheck = useCallback((id: string, value: boolean) => update((p) => withCheck(p, id, value)), [update]);
  const setRating = useCallback(
    (objectiveId: string, rating: SelfRating) => update((p) => withRating(p, objectiveId, rating)),
    [update],
  );
  const resetLesson = useCallback(() => resetLessonProgress(courseSlug, lesson.id), [courseSlug, lesson.id]);

  return {
    progress,
    seen,
    activeBlockId,
    topBlockId,
    activeSectionId: activeBlockId ? sections.get(activeBlockId)?.id ?? null : lesson.sections[0]?.id ?? null,
    pct,
    state,
    getAnswer,
    recordAnswer,
    revealAnswer,
    getCheck,
    setCheck,
    setRating,
    serverMerges,
    drops,
    resetLesson,
  };
}
