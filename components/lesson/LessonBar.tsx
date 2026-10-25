import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ListTree, Sparkles } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ProgressRing } from './ProgressRing';
import { useOptionalReader } from './ReaderContext';
import { practiceProgress } from './blocks/blockText';
import { SaveChip } from './SaveChip';

/**
 * Sticky (never fixed) bar inside <main>: back, breadcrumb, mode tabs (only "Read" works yet;
 * "Practice" already counts answered checks, 練習 x/y), where the record is saved (Phase 5,
 * SaveChip, for lessons the server stores), reading progress, Aa settings and the AI tutor. A 3px
 * progress line runs along its bottom.
 */

const copy = {
  en: {
    back: 'Back to the course',
    breadcrumb: 'Breadcrumb',
    modes: 'View mode',
    read: 'Read',
    slides: 'Slides',
    practice: 'Practice',
    soon: 'Coming soon',
    practiceCount: (n: number, m: number) => `${n} of ${m} questions answered`,
    progress: (pct: number) => `${pct}% of this lesson done`,
    outline: 'Contents',
    outlineLabel: (n: number, m: number) => `Open the contents (section ${n} of ${m})`,
    settings: 'Reading settings',
    tutor: 'AI tutor',
    tutorLabel: 'Ask the AI tutor about the section you are reading',
  },
  jp: {
    back: 'コースに戻る',
    breadcrumb: 'パンくずリスト',
    modes: '表示モード',
    read: '読む',
    slides: 'スライド',
    practice: '練習',
    soon: '準備中',
    practiceCount: (n: number, m: number) => `${m}問中 ${n}問回答済み`,
    progress: (pct: number) => `このレッスンの ${pct}% を学習済み`,
    outline: '目次',
    outlineLabel: (n: number, m: number) => `目次を開く（${m}セクション中 ${n}）`,
    settings: '表示設定',
    tutor: 'AI先生',
    tutorLabel: '今読んでいるセクションについてAI先生に質問する',
  },
} as const;

type LessonBarProps = {
  backTo: string;
  courseTitle: string;
  lessonTitle: string;
  pct: number;
  sectionIndex: number;
  sectionCount: number;
  onOpenOutline: () => void;
  outlineButtonRef: React.RefObject<HTMLButtonElement | null>;
  outlineOpen: boolean;
  onOpenSettings: () => void;
  settingsButtonRef: React.RefObject<HTMLButtonElement | null>;
  settingsOpen: boolean;
  onAskTutor: () => void;
  tutorButtonRef: React.RefObject<HTMLButtonElement | null>;
  tutorExpanded: boolean;
  /** Transient message under the bar (e.g. "resumed where you left off"), and the reader's status line. */
  notice?: React.ReactNode;
  /** Phase 5: show where the record is saved (SaveChip): only for lessons the server stores. */
  showSaveState?: boolean;
};

export function LessonBar({
  backTo,
  courseTitle,
  lessonTitle,
  pct,
  sectionIndex,
  sectionCount,
  onOpenOutline,
  outlineButtonRef,
  outlineOpen,
  onOpenSettings,
  settingsButtonRef,
  settingsOpen,
  onAskTutor,
  tutorButtonRef,
  tutorExpanded,
  notice,
  showSaveState = false,
}: LessonBarProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const reader = useOptionalReader();
  const lesson = reader?.lesson;
  const progressData = reader?.progress.progress;
  const practice = useMemo(
    () => (lesson && progressData ? practiceProgress(lesson, progressData) : { answered: 0, total: 0 }),
    [lesson, progressData],
  );

  return (
    <header className="rp-bar">
      <div className="rp-bar-inner">
        <div className="rp-bar-start">
          <Link to={backTo} className="rp-icon-btn" aria-label={text.back} title={text.back}>
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <nav aria-label={text.breadcrumb} className="min-w-0">
            <ol className="rp-crumbs">
              <li className="rp-crumb-course">
                <Link to={backTo}>{courseTitle}</Link>
              </li>
              <li className="rp-crumb-sep" aria-hidden="true">›</li>
              <li className="rp-crumb-current" aria-current="page">{lessonTitle}</li>
            </ol>
          </nav>
        </div>

        <div className="rp-modes" role="group" aria-label={text.modes}>
          <button type="button" className="rp-mode" aria-pressed="true">{text.read}</button>
          <button type="button" className="rp-mode" disabled aria-describedby="rp-mode-soon" title={text.soon}>
            {text.slides}
            <span className="rp-soon" aria-hidden="true">{text.soon}</span>
          </button>
          <button type="button" className="rp-mode" disabled aria-describedby="rp-mode-soon" title={text.soon}>
            {text.practice}
            {practice.total > 0 && (
              <>
                <span className="rp-mode-count tabular" aria-hidden="true">{practice.answered}/{practice.total}</span>
                <span className="sr-only">{text.practiceCount(practice.answered, practice.total)}</span>
              </>
            )}
            <span className="rp-soon" aria-hidden="true">{text.soon}</span>
          </button>
          <span id="rp-mode-soon" className="sr-only">{text.soon}</span>
        </div>

        <div className="rp-bar-end">
          <button
            ref={outlineButtonRef}
            type="button"
            className="rp-chip-btn rp-outline-toggle"
            onClick={onOpenOutline}
            aria-haspopup="dialog"
            aria-expanded={outlineOpen}
            aria-label={text.outlineLabel(sectionIndex + 1, sectionCount)}
          >
            <ListTree size={16} aria-hidden="true" />
            <span>{text.outline}</span>
            <span className="tabular text-fg-3">{sectionIndex + 1}/{sectionCount}</span>
          </button>
          {showSaveState ? <SaveChip /> : null}
          <ProgressRing pct={pct} label={text.progress(pct)} />
          <button
            ref={settingsButtonRef}
            type="button"
            className="rp-chip-btn rp-aa-btn"
            onClick={onOpenSettings}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-label={text.settings}
            title={text.settings}
          >
            <span aria-hidden="true" className="rp-aa">Aa</span>
          </button>
          <button
            ref={tutorButtonRef}
            type="button"
            className="rp-chip-btn rp-chip-primary rp-bar-desktop"
            onClick={onAskTutor}
            aria-label={text.tutorLabel}
            aria-expanded={tutorExpanded}
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>{text.tutor}</span>
          </button>
        </div>
      </div>
      <div className="rp-hairline" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      {notice}
    </header>
  );
}
