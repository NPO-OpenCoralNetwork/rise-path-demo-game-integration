import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Lesson } from '../../shared/lesson/schema.js';
import {
  answerKey,
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
  type LessonProgress,
  type SelfRating,
} from './progressStore.ts';
import { lessonPct, lessonState, sectionByBlock, type LessonState } from './model.ts';

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
};

const blockElements = (article: HTMLElement | null) =>
  article ? Array.from(article.querySelectorAll<HTMLElement>('[data-rp-block]')) : [];

export function useLessonProgress({ courseSlug, lesson, title, articleRef, container, trackPosition }: Options): LessonProgressApi {
  const [progress, setProgress] = useState<LessonProgress>(() => readProgress(courseSlug, lesson.id));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [topBlockId, setTopBlockId] = useState<string | null>(null);
  const loadedKey = useRef(`${courseSlug}/${lesson.id}`);
  const dirty = useRef(false);

  // Another lesson in the same reader instance: reload its progress.
  useEffect(() => {
    const key = `${courseSlug}/${lesson.id}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    dirty.current = false;
    setProgress(readProgress(courseSlug, lesson.id));
    setActiveBlockId(null);
    setTopBlockId(null);
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

  // Persist after each change (with the pct/state snapshot for course maps), and remember this
  // lesson for "continue" on the dashboard.
  useEffect(() => {
    if (dirty.current) {
      dirty.current = false;
      writeProgress(courseSlug, lesson.id, withSummary(progress, { pct, state }));
    }
    setLastLesson({ courseSlug, lessonId: lesson.id, title, pct });
  }, [courseSlug, lesson.id, progress, title, pct, state]);

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
    // progress.seen is read once per lesson on purpose: re-observing on every mark would reset timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleRef, container, lesson, update]);

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
  };
}
