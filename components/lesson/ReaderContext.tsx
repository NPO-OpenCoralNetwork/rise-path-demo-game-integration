import { createContext, useContext } from 'react';
import type { Block, Course, LText, Lesson, Section } from '../../shared/lesson/schema.js';
import type { TutorLearnerState, TutorMode } from '../../services/tutorBridge';
import type { LessonProgressApi } from './useLessonProgress';
import type { ContentLocale, ResolvedText } from './model';

export type AskTutorArgs = {
  message: string;
  block?: Block;
  section?: Section;
  /** Plain-text excerpt of the block (≤1,500 chars). */
  excerpt?: string;
  mode?: TutorMode;
  learner?: TutorLearnerState;
  codeLang?: string;
  highlightedLines?: number[];
};

export type ReaderContextValue = {
  course: Course;
  courseSlug: string;
  lesson: Lesson;
  /** Content locale the learner reads in (UI language). */
  locale: ContentLocale;
  /** lesson.locale: what plain strings are written in. */
  fallback: ContentLocale;
  /** Resolves localized text; `lang` is set when it fell back to another locale. */
  tx: (text: LText | null | undefined) => ResolvedText;
  t: (text: LText | null | undefined) => string;
  /**
   * Answers, checks, ratings and pct. Its activeBlockId / topBlockId / activeSectionId may lag
   * behind scrolling (they are kept out of the context's change detection on purpose).
   */
  progress: LessonProgressApi;
  /** Reader theme (Aa settings); diagrams re-render when it changes. */
  appearance: 'light' | 'sepia' | 'dark';
  /** 図n numbers for diagrams and images. */
  figures: Map<string, number>;
  /** 確認しよう n/total numbering for inline quizzes. */
  checks: { numbers: Map<string, number>; total: number };
  askTutor: (args: AskTutorArgs) => void;
  /** Block the learner last asked the tutor about (highlighted, shown in the margin). */
  askedBlockId: string | null;
  /** Block whose ✦ is revealed by tap or click (touch has no hover). */
  armedBlockId: string | null;
  setArmedBlockId: (id: string | null) => void;
  selectTerm: (term: string) => void;
  scrollToBlock: (blockId: string) => void;
};

export const ReaderContext = createContext<ReaderContextValue | null>(null);

export function useReader(): ReaderContextValue {
  const value = useContext(ReaderContext);
  if (!value) throw new Error('useReader must be used inside <LessonReader>');
  return value;
}

/** For components that also render outside the reader (e.g. markdown in a dev gallery). */
export function useOptionalReader(): ReaderContextValue | null {
  return useContext(ReaderContext);
}
