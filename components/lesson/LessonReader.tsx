import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CircleDot, ListTree, Sparkles } from 'lucide-react';
import type { Block, Course, LText, Lesson, Section } from '../../shared/lesson/schema.js';
import { toBcp47 } from '../../shared/lesson/text.js';
import { useLanguage } from '../../context/LanguageContext';
import { onTutorRequest, openTutor, TUTOR_EXCERPT_MAX } from '../../services/tutorBridge';
import { streamTutor, toLlmLocale } from '../../services/llmApi';
import type { LessonEntry } from '../../content';
import { ReaderContext, type AskTutorArgs, type ReaderContextValue } from './ReaderContext';
import { useLessonProgress } from './useLessonProgress';
import { scrollElementIntoContainer, useScrollContainer, READER_SCROLL_OFFSET } from './useScrollContainer';
import {
  blockPlainText,
  checkNumbers,
  figureNumbers,
  findGlossaryItem,
  glossaryItems,
  resolveLText,
  resumeTarget,
  safeDecode,
  sectionByBlock,
  sectionStatuses,
  splitSectionTitle,
  type ContentLocale,
  type GlossaryItem,
} from './model';
import { BlockView } from './blocks/registry';
import { nextPracticeBlockId, practiceProgress } from './blocks/blockText';
import { LessonBar } from './LessonBar';
import { LessonHeader, lessonTitleId } from './LessonHeader';
import { LessonEnd, type LessonLinkInfo } from './LessonEnd';
import { ReaderStatus, stallKeyOf, stallMessageOf, type ReaderStatusMessage } from './ReaderStatus';
import { getProgressSaveView, isSyncableLesson, subscribeProgressSaveView } from './progressSyncClient';
import { Outline } from './Outline';
import { MarginPanel, type MarginAnchor } from './MarginPanel';
import { ReaderSheet } from './ReaderSheet';
import { TutorPanel, type TutorLayout } from './TutorPanel';
import { lessonLearnerState, useTutorStream, type LiveLearnerFn } from './useTutorStream';
import ReaderSettings, { useReaderSettings } from './ReaderSettings';
import OfflineReloadNotice from '../common/OfflineReloadNotice';
import './reader.css';

/**
 * The one lesson reader for risepath.lesson/v1 (PLAN §5, WP-04).
 *
 * Layout: a sticky LessonBar inside <main>, then outline | prose | margin at ≥1280px. Below
 * 1280px the outline and the margin open as drawers; below 768px as bottom sheets, with a
 * bottom bar for prev / contents / tutor / next. The reader scopes its own theme
 * (data-theme light | sepia | dark) and world accent (data-world) to its root.
 *
 * AI tutor (WP-11): openTutor() requests that carry `lesson` stream into TutorPanel, a card at
 * the top of the margin at ≥1280px, a right drawer at 1024–1279px and a bottom sheet below
 * (also a drawer in focus mode, which hides the margin). The glossary card is MarginPanel.
 *
 * Phase 5 (lessons the server stores): the LessonBar shows where the record is saved (SaveChip);
 * a status line under it (ReaderStatus) says when saving moved to "this device" or stopped with
 * something unsaved, and that the lesson was started over. LessonEnd offers 「最初からやり直す」
 * where `allowReset` (LearnRoute in learn mode). When the in-memory record is dropped for the
 * stored one (a reset here or elsewhere, another learner), the sections remount (keyed by
 * `progress.drops`), so quiz, flashcard and step blocks drop their own state.
 */

const copy = {
  en: {
    article: 'Lesson',
    outline: 'Contents',
    outlineTitle: 'Lesson contents',
    side: 'AI tutor and terms',
    close: 'Close',
    closeOutline: 'Close the contents',
    closeSide: 'Close the terms',
    terms: 'Terms',
    prev: 'Previous',
    next: 'Next',
    prevLesson: 'Previous lesson',
    nextLesson: 'Next lesson',
    tutor: 'AI tutor',
    practice: 'Practice',
    soon: 'Coming soon',
    lessonActions: 'Lesson actions',
    resumed: 'Picked up where you left off.',
    fromStart: 'Start from the top',
    dismiss: 'Dismiss',
    sectionLabel: (n: number, m: number) => `${n}/${m}`,
    practiceCount: (n: number, m: number) => `${n} of ${m} questions answered`,
    practiceGo: (n: number, m: number) => `Go to the next open question (${n} of ${m} answered)`,
    practiceDone: (m: number) => `All ${m} questions answered`,
  },
  jp: {
    article: 'レッスン本文',
    outline: '目次',
    outlineTitle: 'レッスンの目次',
    side: 'AI先生と用語',
    close: '閉じる',
    closeOutline: '目次を閉じる',
    closeSide: '用語を閉じる',
    terms: '用語',
    prev: '前へ',
    next: '次へ',
    prevLesson: '前のレッスン',
    nextLesson: '次のレッスン',
    tutor: 'AI先生',
    practice: '練習',
    soon: '準備中',
    lessonActions: 'レッスンの操作',
    resumed: '前回の続きから表示しています。',
    fromStart: '最初から読む',
    dismiss: '閉じる',
    sectionLabel: (n: number, m: number) => `${n}/${m}`,
    practiceCount: (n: number, m: number) => `${m}問中 ${n}問回答済み`,
    practiceGo: (n: number, m: number) => `次の未回答の問題へ移動（${m}問中 ${n}問回答済み）`,
    practiceDone: (m: number) => `${m}問すべて回答済み`,
  },
} as const;

function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

export type LessonReaderProps = {
  course: Course;
  courseSlug: string;
  lesson: Lesson;
  /** Course page the back button and breadcrumb lead to. */
  backTo: string;
  entry?: LessonEntry;
  next: LessonLinkInfo | null;
  prev: LessonLinkInfo | null;
  /** Dev preview: validation report under the bar. */
  banner?: React.ReactNode;
  /** False keeps the lesson out of the dashboard's "continue" record (dev gallery). Default true. */
  recordLastLesson?: boolean;
  /** Phase 5: LessonEnd may offer to start the lesson over (LearnRoute in learn mode). Default false. */
  allowReset?: boolean;
};

export default function LessonReader({ course, courseSlug, lesson, backTo, entry, next, prev, banner, recordLastLesson = true, allowReset = false }: LessonReaderProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const locale: ContentLocale = language;
  const fallback: ContentLocale = lesson.locale;

  const tx = useCallback((value: LText | null | undefined) => resolveLText(value, locale, fallback), [locale, fallback]);
  const t = useCallback((value: LText | null | undefined) => tx(value).value, [tx]);
  const lessonTitle = t(lesson.title);
  const courseTitle = t(course.title);

  const rootRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const outlineButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const tutorButtonRef = useRef<HTMLButtonElement>(null);
  const bottomOutlineRef = useRef<HTMLButtonElement>(null);
  const bottomTutorRef = useRef<HTMLButtonElement>(null);
  const tutorInputRef = useRef<HTMLInputElement>(null);
  const tutorPanelRef = useRef<HTMLElement>(null);
  const tutorReturnRef = useRef<HTMLElement | null>(null);

  const wide = useMediaQuery('(min-width: 1280px)');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const tablet = useMediaQuery('(min-width: 768px)');

  const [settings, updateSettings] = useReaderSettings();
  // Focus mode hides the margin column; the tutor and glossary then open as drawers.
  const marginShown = wide && !settings.focus;
  const [trackPosition, setTrackPosition] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [asked, setAsked] = useState<MarginAnchor>(null);
  const [armedBlockId, setArmedBlockId] = useState<string | null>(null);
  const [selectedTermKey, setSelectedTermKey] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const sideReturnRef = useRef<HTMLElement | null>(null);
  const outlineReturnRef = useRef<HTMLElement | null>(null);

  const { container, scrollToElement, scrollToTop } = useScrollContainer(rootRef);
  const progress = useLessonProgress({ courseSlug, lesson, title: lessonTitle, articleRef, container, trackPosition, recordLastLesson, courseTitle: course.title });
  const initialProgress = useRef(progress.progress);
  // Synced progress that arrives after the reader opened (a new device) moves the resume
  // position, but only until the learner scrolls, taps or types.
  const interacted = useRef(false);
  const [resumeRun, setResumeRun] = useState(0);

  const sections = useMemo(() => sectionByBlock(lesson), [lesson]);
  const figures = useMemo(() => figureNumbers(lesson), [lesson]);
  const checks = useMemo(() => checkNumbers(lesson), [lesson]);
  const glossary = useMemo(() => glossaryItems(lesson, course), [lesson, course]);
  const selectedTerm = useMemo(
    () => glossary.find((item) => item.key === selectedTermKey) ?? null,
    [glossary, selectedTermKey],
  );
  const statuses = useMemo(
    () => sectionStatuses(lesson, progress.progress, progress.activeSectionId),
    [lesson, progress.progress, progress.activeSectionId],
  );
  // Same "練習 x/y" count as the desktop LessonBar, for the mobile bottom bar.
  const practice = useMemo(() => practiceProgress(lesson, progress.progress), [lesson, progress.progress]);
  const nextPractice = nextPracticeBlockId(lesson, progress.progress, progress.activeBlockId);

  const activeSection = lesson.sections.find((s) => s.id === progress.activeSectionId) ?? lesson.sections[0];
  const activeBlock = useMemo<Block | undefined>(() => {
    const id = progress.activeBlockId;
    return id ? activeSection?.blocks.find((b) => b.id === id) ?? activeSection?.blocks[0] : activeSection?.blocks[0];
  }, [activeSection, progress.activeBlockId]);
  const sectionIndex = Math.max(0, lesson.sections.findIndex((s) => s.id === activeSection?.id));

  // --- Scrolling ---------------------------------------------------------------------------

  // Set while a programmatic (smooth) scroll runs, so passing sections do not count as reading.
  const jumpedAt = useRef(0);

  const scrollToSection = useCallback((sectionId: string, { focus = true } = {}) => {
    const heading = document.getElementById(`s-${sectionId}-title`);
    if (!heading) return;
    jumpedAt.current = Date.now();
    scrollToElement(heading);
    try {
      window.history.replaceState(window.history.state, '', `#s-${sectionId}`);
    } catch {
      // ignore (sandboxed iframes)
    }
    if (focus) heading.focus({ preventScroll: true });
  }, [scrollToElement]);

  const scrollToBlock = useCallback((blockId: string) => {
    const el = document.getElementById(`b-${blockId}`);
    if (!el) return;
    jumpedAt.current = Date.now();
    scrollToElement(el);
    const focusable = el.querySelector<HTMLElement>('h3, [tabindex], button, a[href], input');
    focusable?.focus({ preventScroll: true });
  }, [scrollToElement]);

  useEffect(() => {
    interacted.current = false;
    if (!container) return;
    const mark = () => {
      interacted.current = true;
    };
    const interactions = ['wheel', 'touchstart', 'pointerdown'] as const;
    interactions.forEach((type) => container.addEventListener(type, mark, { passive: true }));
    window.addEventListener('keydown', mark);
    return () => {
      interactions.forEach((type) => container.removeEventListener(type, mark));
      window.removeEventListener('keydown', mark);
    };
  }, [container, lesson]);

  useEffect(() => {
    if (!progress.serverMerges || interacted.current) return;
    initialProgress.current = progress.progress;
    setResumeRun((n) => n + 1);
    // Only a new merge counts; progress.progress is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.serverMerges]);

  // Resume: URL hash first, then the saved block. Layout shifts while diagrams render, so the
  // target is re-aligned until the learner interacts (or 2.5 s pass). Runs again (resumeRun)
  // when synced progress arrives before the learner interacted.
  useEffect(() => {
    if (!container) return;
    const target = resumeTarget(window.location.hash, initialProgress.current, lesson);
    if (!target) {
      setTrackPosition(true);
      return;
    }
    const find = () => (target.kind === 'section'
      ? document.getElementById(`s-${target.id}-title`)
      : document.getElementById(`b-${target.id}`));
    let done = false;
    const align = () => {
      const el = find();
      if (el && !done) scrollElementIntoContainer(container, el, { offset: READER_SCROLL_OFFSET, smooth: false });
    };
    const frame = window.requestAnimationFrame(align);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(align) : null;
    if (articleRef.current) observer?.observe(articleRef.current);
    const stop = () => {
      if (done) return;
      done = true;
      cleanup();
      setTrackPosition(true);
    };
    const interactions = ['wheel', 'touchstart', 'pointerdown'] as const;
    interactions.forEach((type) => container.addEventListener(type, stop, { passive: true }));
    window.addEventListener('keydown', stop);
    const timer = window.setTimeout(stop, 2500);
    function cleanup() {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      interactions.forEach((type) => container?.removeEventListener(type, stop));
      window.removeEventListener('keydown', stop);
      window.clearTimeout(timer);
    }
    if (target.kind === 'block') setResumed(true);
    return () => {
      done = true;
      cleanup();
    };
  }, [container, lesson, resumeRun]);

  // The notice fades on its own.
  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(false), 8000);
    return () => window.clearTimeout(timer);
  }, [resumed]);

  // --- Phase 5: save state and the status line ---------------------------------------------

  const syncable = useMemo(() => isSyncableLesson(courseSlug, lesson.id), [courseSlug, lesson.id]);
  const stallKey = useSyncExternalStore(
    subscribeProgressSaveView,
    () => stallKeyOf(getProgressSaveView(), syncable),
    () => null,
  );
  const [statusMessage, setStatusMessage] = useState<ReaderStatusMessage | null>(null);
  const messageCount = useRef(0);
  const showStatus = useCallback((message: ReaderStatusMessage) => {
    setStatusMessage(message);
    setResumed(false); // one message at a time
  }, []);
  // Saving moved to "on this device" or stopped while something is unsaved (or its reason
  // changed): said once. Saving ↔ saved flips are never announced; a stall message goes when
  // saving works again.
  const lastStallKey = useRef<string | null>(null);
  useEffect(() => {
    const before = lastStallKey.current;
    lastStallKey.current = stallKey;
    if (stallKey === before) return;
    if (stallKey === null) {
      setStatusMessage((message) => (message?.kind === 'stall' ? null : message));
      return;
    }
    messageCount.current += 1;
    showStatus(stallMessageOf(stallKey, messageCount.current));
  }, [stallKey, showStatus]);
  // The status line clears itself, like the "resumed" pill.
  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  // Once the learner reads past a #s-/#b- deep link, drop it so a reload resumes where they are.
  useEffect(() => {
    if (!trackPosition || !progress.topBlockId) return;
    if (Date.now() - jumpedAt.current < 1500) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#s-') && !hash.startsWith('#b-')) return;
    const sectionOfTop = sections.get(progress.topBlockId)?.id;
    const hashed = safeDecode(hash.slice(3));
    const stillThere = hash.startsWith('#s-') ? sectionOfTop === hashed : progress.topBlockId === hashed;
    if (stillThere) return;
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    } catch {
      // ignore
    }
  }, [progress.topBlockId, trackPosition, sections]);

  // LessonEnd started the lesson over (its dialog has closed): say so, go to the top and put
  // focus on the title (the sections remounted empty; focus was on the dialog).
  const onLessonReset = useCallback(() => {
    messageCount.current += 1;
    showStatus({ kind: 'reset', id: messageCount.current });
    scrollToTop();
    document.getElementById(lessonTitleId(lesson.id))?.focus({ preventScroll: true });
  }, [showStatus, scrollToTop, lesson.id]);

  // --- Tutor -------------------------------------------------------------------------------

  // Read through refs so askTutor (and with it the context) stays stable while scrolling.
  const activeRef = useRef<{ block?: Block; section?: Section }>({});
  activeRef.current = { block: activeBlock, section: activeSection };

  const askTutor = useCallback((args: AskTutorArgs) => {
    const block = args.block ?? activeRef.current.block;
    const section: Section | undefined = args.section ?? (block ? sections.get(block.id) : undefined) ?? activeRef.current.section;
    const excerpt = (args.excerpt ?? (block ? blockPlainText(block, t) : '')).slice(0, TUTOR_EXCERPT_MAX);
    const codeLang = args.codeLang ?? (block?.type === 'code' ? block.lang : undefined);
    openTutor({
      message: args.message,
      mode: args.mode ?? 'explain',
      lesson: {
        courseId: course.id,
        lessonId: lesson.id,
        title: lessonTitle,
        objectives: lesson.objectives.map((o) => t(o.text)).filter(Boolean),
        ...(lesson.level ? { level: lesson.level } : {}),
      },
      ...(block && section ? {
        anchor: {
          sectionId: section.id,
          blockId: block.id,
          blockType: block.type,
          excerpt,
          ...(codeLang ? { codeLang } : {}),
          ...(args.highlightedLines?.length ? { highlightedLines: args.highlightedLines } : {}),
        },
      } : {}),
      ...(args.learner ? { learner: args.learner } : {}),
    });
    if (args.block && section) setAsked({ block: args.block, section, excerpt });
  }, [course.id, lesson, lessonTitle, sections, t]);

  const selectTerm = useCallback((term: string) => {
    const item = findGlossaryItem(glossary, term);
    if (!item) return;
    setSelectedTermKey(item.key);
    if (!marginShown) {
      sideReturnRef.current = document.activeElement as HTMLElement | null;
      setTutorOpen(false);
      setSideOpen(true);
    }
  }, [glossary, marginShown]);

  const onSelectGlossary = useCallback((item: GlossaryItem) => setSelectedTermKey(item.key), []);

  // The inline tutor (WP-11). Lesson requests from openTutor() land here; the floating chat
  // ignores them on lesson routes.
  // Quiz state for each tutor turn comes from the answers in memory (not localStorage), so a
  // reveal is seen even when storage is unavailable.
  const answersRef = useRef(progress.progress.answers);
  answersRef.current = progress.progress.answers;
  const tutorLearnerState = useCallback<LiveLearnerFn>(
    (anchor, questionId) => lessonLearnerState(lesson, answersRef.current, anchor, questionId),
    [lesson],
  );
  const tutor = useTutorStream({ locale: toLlmLocale(language), stream: streamTutor, learnerState: tutorLearnerState });
  const { ask: tutorAsk, dismiss: tutorDismiss } = tutor;
  const tutorLayout: TutorLayout = marginShown ? 'margin' : desktop ? 'drawer' : 'sheet';
  const tutorLayoutRef = useRef(tutorLayout);
  tutorLayoutRef.current = tutorLayout;

  useEffect(() => onTutorRequest((request) => {
    if (!request.tutor.lesson) return; // legacy glossary questions stay with the chat panel
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const inPanel = active?.closest('[data-rp-tutor], #rp-tutor-sheet');
    if (!inPanel) {
      const blockId = request.tutor.anchor?.blockId;
      const block = blockId ? document.getElementById(`b-${blockId}`) : null;
      const opener = active?.closest('.rp-sheet-root')
        ? sideReturnRef.current // e.g. "Ask the tutor" in the glossary sheet
        : active;
      tutorReturnRef.current = opener ?? block?.querySelector<HTMLElement>('.rp-ask-btn, button') ?? null;
    } else if (tutorLayoutRef.current === 'margin') {
      tutorReturnRef.current = tutorInputRef.current;
    }
    tutorAsk(request);
    if (tutorLayoutRef.current === 'margin') {
      window.requestAnimationFrame(() => {
        const panel = tutorPanelRef.current;
        panel?.closest('.rp-col-sticky')?.scrollTo({ top: 0 });
        if (!inPanel) panel?.focus({ preventScroll: true });
      });
    } else {
      setSideOpen(false);
      setTutorOpen(true);
    }
  }), [tutorAsk]);

  const dismissTutor = useCallback((returnFocus: boolean) => {
    tutorDismiss();
    setAsked(null);
    if (returnFocus) {
      const target = tutorReturnRef.current;
      if (target && document.contains(target)) target.focus({ preventScroll: true });
    } else {
      window.requestAnimationFrame(() => tutorInputRef.current?.focus());
    }
  }, [tutorDismiss]);

  const showTutorSource = useCallback((blockId: string) => {
    if (tutorOpen) {
      setTutorOpen(false);
      // Let the sheet close (and return focus) before moving to the block.
      window.requestAnimationFrame(() => scrollToBlock(blockId));
    } else {
      scrollToBlock(blockId);
    }
  }, [tutorOpen, scrollToBlock]);

  const openTutorPanel = useCallback((returnTo: HTMLElement | null) => {
    if (marginShown) {
      tutorPanelRef.current?.closest('.rp-col-sticky')?.scrollTo({ top: 0 });
      tutorInputRef.current?.focus();
      return;
    }
    tutorReturnRef.current = returnTo;
    setSideOpen(false);
    setTutorOpen(true);
  }, [marginShown]);

  const openOutline = useCallback((returnTo: HTMLElement | null) => {
    outlineReturnRef.current = returnTo;
    setOutlineOpen(true);
  }, []);

  // Close drawers that no longer apply after a resize.
  useEffect(() => {
    if (wide) setOutlineOpen(false);
  }, [wide]);

  useEffect(() => {
    if (marginShown) {
      setSideOpen(false);
      setTutorOpen(false);
    }
  }, [marginShown]);

  // F toggles focus mode (WCAG 2.1.4): only while reading (focus on the page or in the
  // article), never while typing or with a dialog open, and it can be turned off in Aa.
  useEffect(() => {
    if (!settings.focusKey) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'f' && event.key !== 'F') return;
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      if (outlineOpen || sideOpen || tutorOpen || settingsOpen) return;
      const active = document.activeElement;
      const reading = !active || active === document.body || active.id === 'main-content'
        || Boolean(articleRef.current?.contains(active));
      if (!reading) return;
      updateSettings({ focus: !settings.focus });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [outlineOpen, sideOpen, tutorOpen, settingsOpen, settings.focus, settings.focusKey, updateSettings]);

  // Focus mode hides the outline and margin columns: move focus out of them before it is lost.
  useEffect(() => {
    if (!settings.focus) return;
    const active = document.activeElement;
    if (!active?.closest('.rp-col-outline, .rp-col-margin')) return;
    const id = activeRef.current.section?.id ?? lesson.sections[0]?.id;
    document.getElementById(`s-${id}-title`)?.focus({ preventScroll: true });
  }, [settings.focus, lesson]);

  // The reader theme also colours the app shell (the rail), so a dark page never sits in a
  // light frame (design-system.md §3). Removed again when the reader unmounts.
  useEffect(() => {
    if (settings.theme === 'light') return undefined;
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    return () => root.removeAttribute('data-theme');
  }, [settings.theme]);

  // --- Context -----------------------------------------------------------------------------

  // Blocks read answers and checks, never the active/top block ids, so the context only changes
  // when the progress data does; scrolling re-renders the chrome, not every block.
  const blockProgress = useMemo(
    () => progress,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress.progress, progress.pct, progress.state],
  );

  const contextValue = useMemo<ReaderContextValue>(() => ({
    course,
    courseSlug,
    lesson,
    locale,
    fallback,
    tx,
    t,
    progress: blockProgress,
    appearance: settings.theme,
    figures,
    checks,
    askTutor,
    askedBlockId: asked?.block.id ?? null,
    armedBlockId,
    setArmedBlockId,
    selectTerm,
    scrollToBlock,
  }), [course, courseSlug, lesson, locale, fallback, tx, t, blockProgress, settings.theme, figures, checks, askTutor, asked, armedBlockId, selectTerm, scrollToBlock]);

  const scope = { theme: settings.theme, world: course.world, lang: toBcp47(locale) };
  const outlineProps = {
    lesson,
    statuses,
    activeSectionId: activeSection?.id ?? null,
    pct: progress.pct,
    next,
    onSelect: (id: string) => {
      setOutlineOpen(false);
      // Let the drawer close (and return focus) before moving focus to the heading.
      window.requestAnimationFrame(() => scrollToSection(id));
    },
  };
  const marginProps = {
    asked,
    current: { block: activeBlock, section: activeSection },
    glossary,
    selectedTerm,
    onSelectTerm: onSelectGlossary,
  };
  const variantSide = tablet ? 'drawer-end' : 'sheet';
  const tutorProps = {
    tutor,
    layout: tutorLayout,
    open: tutorOpen,
    onClose: () => setTutorOpen(false),
    onDismiss: dismissTutor,
    returnFocusRef: tutorReturnRef,
    scope,
    current: { block: activeBlock, section: activeSection },
    onShowSource: showTutorSource,
    inputRef: tutorInputRef,
    panelRef: tutorPanelRef,
  };

  return (
    <ReaderContext.Provider value={contextValue}>
      <div
        ref={rootRef}
        className="rp-reader"
        data-world={course.world}
        data-theme={settings.theme}
        data-size={settings.size}
        data-font={settings.font}
        data-leading={settings.leading}
        data-focus={settings.focus || undefined}
        lang={toBcp47(locale)}
      >
        <LessonBar
          backTo={backTo}
          courseTitle={courseTitle}
          lessonTitle={lessonTitle}
          pct={progress.pct}
          sectionIndex={sectionIndex}
          sectionCount={lesson.sections.length}
          onOpenOutline={() => openOutline(outlineButtonRef.current)}
          outlineButtonRef={outlineButtonRef}
          outlineOpen={outlineOpen}
          onOpenSettings={() => setSettingsOpen((open) => !open)}
          settingsButtonRef={settingsButtonRef}
          settingsOpen={settingsOpen}
          onAskTutor={() => openTutorPanel(tutorButtonRef.current)}
          tutorButtonRef={tutorButtonRef}
          tutorExpanded={tutorOpen}
          showSaveState={syncable}
          notice={(
            <>
              {/* Phase 8 (S1): a part failed to load offline; in the bar's flow, so always in view. */}
              <OfflineReloadNotice />
              {resumed && !statusMessage ? (
                <div className="rp-notice" role="status">
                  <span>{text.resumed}</span>
                  <button
                    type="button"
                    className="rp-link-btn"
                    onClick={() => {
                      setResumed(false);
                      scrollToTop();
                    }}
                  >
                    {text.fromStart}
                  </button>
                  <button type="button" className="rp-link-btn rp-notice-x" aria-label={text.dismiss} onClick={() => setResumed(false)}>
                    ×
                  </button>
                </div>
              ) : null}
              <ReaderStatus message={statusMessage} onDismiss={() => setStatusMessage(null)} />
            </>
          )}
        />

        {/* Phones: fixed to the bottom of the screen, but early in the tab order (right after the
            bar), so Contents and the AI tutor are a few Tabs away, not after the whole article. */}
        <nav className="rp-bottombar" aria-label={text.lessonActions}>
          {prev ? (
            <Link to={prev.href} className="rp-bottom-btn" aria-label={`${text.prevLesson}: ${prev.title}`}>
              <ChevronLeft size={20} aria-hidden="true" />
              <span>{text.prev}</span>
            </Link>
          ) : (
            <span className="rp-bottom-btn" aria-disabled="true">
              <ChevronLeft size={20} aria-hidden="true" />
              <span>{text.prev}</span>
            </span>
          )}
          <button
            ref={bottomOutlineRef}
            type="button"
            className="rp-bottom-btn"
            aria-haspopup="dialog"
            aria-expanded={outlineOpen}
            onClick={() => openOutline(bottomOutlineRef.current)}
          >
            <ListTree size={20} aria-hidden="true" />
            <span>{text.outline} <span className="tabular">{text.sectionLabel(sectionIndex + 1, lesson.sections.length)}</span></span>
          </button>
          <button
            ref={bottomTutorRef}
            type="button"
            className="rp-bottom-btn rp-bottom-ai"
            aria-haspopup="dialog"
            aria-expanded={tutorOpen}
            onClick={() => openTutorPanel(bottomTutorRef.current)}
          >
            <Sparkles size={20} aria-hidden="true" />
            <span>{text.tutor}</span>
          </button>
          <button
            type="button"
            className="rp-bottom-btn"
            aria-disabled={!nextPractice || undefined}
            aria-label={practice.total > 0
              ? (nextPractice ? text.practiceGo(practice.answered, practice.total) : text.practiceDone(practice.total))
              : text.practice}
            onClick={() => {
              if (nextPractice) scrollToBlock(nextPractice);
            }}
          >
            <CircleDot size={20} aria-hidden="true" />
            <span>
              {text.practice}
              {practice.total > 0 && (
                <>
                  {' '}
                  <span className="tabular">{practice.answered}/{practice.total}</span>
                </>
              )}
            </span>
          </button>
          {next ? (
            <Link to={next.href} className="rp-bottom-btn" aria-label={`${text.nextLesson}: ${next.title}`}>
              <ChevronRight size={20} aria-hidden="true" />
              <span>{text.next}</span>
            </Link>
          ) : (
            <span className="rp-bottom-btn" aria-disabled="true">
              <ChevronRight size={20} aria-hidden="true" />
              <span>{text.next}</span>
            </span>
          )}
        </nav>

        {banner}

        <div className="rp-grid">
          <aside className="rp-col-outline" aria-label={text.outlineTitle}>
            <div className="rp-col-sticky">
              <Outline {...outlineProps} idPrefix="rp-outline-aside" />
            </div>
          </aside>

          <article ref={articleRef} className="rp-prose" aria-label={text.article}>
            <LessonHeader lesson={lesson} entry={entry} />
            {/* Keyed by drops (Phase 5, G16): a dropped record remounts the blocks, so quiz,
                flashcard and step state from before goes with it. The header and LessonEnd stay. */}
            <React.Fragment key={progress.drops}>
              {lesson.sections.map((section) => {
                const title = tx(section.title);
                const { num, title: label } = splitSectionTitle(title.value);
                return (
                  <section
                    key={section.id}
                    id={`s-${section.id}`}
                    className="rp-section"
                    data-role={section.role}
                    aria-labelledby={`s-${section.id}-title`}
                  >
                    <h2 id={`s-${section.id}-title`} className="rp-h2" tabIndex={-1} lang={title.lang}>
                      {num && <span className="rp-h2-num">{num}</span>}
                      <span>{label}</span>
                    </h2>
                    {section.blocks.map((block) => (
                      <BlockView key={block.id} block={block} section={section} />
                    ))}
                  </section>
                );
              })}
            </React.Fragment>
            <LessonEnd next={next} prev={prev} backTo={backTo} resettable={allowReset && syncable} onLessonReset={onLessonReset} />
          </article>

          <aside className="rp-col-margin" aria-label={text.side}>
            <div className="rp-col-sticky">
              <div className="rp-margin-stack">
                {tutorLayout === 'margin' && <TutorPanel {...tutorProps} />}
                <MarginPanel {...marginProps} />
              </div>
            </div>
          </aside>
        </div>

      </div>

      <ReaderSheet
        id="rp-outline-sheet"
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        variant={tablet ? 'drawer' : 'sheet'}
        title={text.outlineTitle}
        closeLabel={text.closeOutline}
        scope={scope}
        returnFocusRef={outlineReturnRef}
      >
        <Outline {...outlineProps} idPrefix="rp-outline-sheet" showHeading={false} />
      </ReaderSheet>

      <ReaderSheet
        id="rp-side-sheet"
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        variant={variantSide}
        title={text.terms}
        closeLabel={text.closeSide}
        scope={scope}
        returnFocusRef={sideReturnRef}
      >
        <MarginPanel {...marginProps} onDone={() => setSideOpen(false)} />
      </ReaderSheet>

      {tutorLayout !== 'margin' && <TutorPanel {...tutorProps} />}

      <ReaderSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        variant={tablet ? 'popover' : 'sheet'}
        settings={settings}
        onChange={updateSettings}
        scope={scope}
        anchorRef={settingsButtonRef}
        returnFocusRef={settingsButtonRef}
      />
    </ReaderContext.Provider>
  );
}
