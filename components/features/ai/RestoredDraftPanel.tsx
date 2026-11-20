import React, { useId } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { AiNotice } from '../../ui/AiNotice';
import { restoredDraftContent, restoredDraftText, type Amount, type RestoredDraftSource } from './restoredDraft';

/**
 * A restored draft's pending requirements or roadmap, under the restore message of the course
 * generator (CourseGeneratorView.tsx), so the approval card's 「上記の内容を確認してください」 has the
 * content above it. Built from the saved draft (restoredDraft.ts) without calling the model: the
 * draft keeps the stage's structured result, not the AI's message. It is AI output, so it carries
 * the AI notice (doc/brushup-2026/ai-access-plan.ja.md §4.1). When no result could be read from the
 * AI's reply (the server saved null), the panel says so and what to type before approving.
 */

const copy = {
  en: {
    // The restore message above says the stage is pending; the panel stays in the conversation after
    // the learner approves or changes it, so its title does not call it pending.
    title: { requirements: 'Requirements from your previous session', roadmap: 'Roadmap from your previous session' },
    unreadable: {
      // A requirements change is written from the typed text alone (server/routes/ai.js, decision
      // 'revise'), so the learner is asked for the topic again, not for a change.
      requirements: 'The requirements could not be read from the AI\'s last reply, so they cannot be shown here. Before approving, type what you want to learn again, and the AI will write new requirements.',
      roadmap: 'The roadmap could not be read from the AI\'s last reply, so it cannot be shown here. Before approving, type the changes you want, and the AI will draft the roadmap again.',
    },
    labels: {
      fields: {
        goal: 'Goal',
        target_audience: 'Who it is for',
        current_level: 'Current level',
        duration_weeks: 'Length',
        delivery_style: 'Format',
        constraints: 'Constraints',
      },
      docChapter: 'Reading, chapter by chapter',
      weeks: (n: Amount) => `${n} ${n === 1 ? 'week' : 'weeks'}`,
      module: (n: number) => `Module ${n}`,
      hours: (n: Amount) => `about ${n} ${n === 1 ? 'hour' : 'hours'}`,
      minutes: (n: Amount) => `${n} min`,
    },
  },
  jp: {
    title: { requirements: '前回の学習要件', roadmap: '前回のロードマップ' },
    unreadable: {
      requirements: '前回のAIの返答から学習要件を読み取れなかったため、ここには表示できません。承認する前に、学びたいことをもう一度入力してください。AIが学習要件を作り直します。',
      roadmap: '前回のAIの返答からロードマップを読み取れなかったため、ここには表示できません。承認する前に修正点を入力すると、AIがロードマップを作り直します。',
    },
    labels: {
      fields: {
        goal: '学習目標',
        target_audience: '対象者',
        current_level: '現在のレベル',
        duration_weeks: '期間',
        delivery_style: '形式',
        constraints: '制約・条件',
      },
      docChapter: '章ごとの読み物',
      weeks: (n: Amount) => `${n}週間`,
      module: (n: number) => `モジュール ${n}`,
      hours: (n: Amount) => `約${n}時間`,
      minutes: (n: Amount) => `${n}分`,
    },
  },
} as const;

interface RestoredDraftPanelProps {
  draft: RestoredDraftSource;
  /** The draft's id, sent with a report of it. */
  courseId?: string;
}

export const RestoredDraftPanel: React.FC<RestoredDraftPanelProps> = ({ draft, courseId }) => {
  const { language } = useLanguage();
  const t = copy[language];
  const headingId = useId();
  const content = restoredDraftContent(draft, { locale: language, ...t.labels });

  return (
    <section aria-labelledby={headingId} data-restored-draft={draft.stage} className="mt-3 rounded-card border border-line bg-sunken p-4">
      <h2 id={headingId} className="text-small font-bold text-fg">{t.title[draft.stage]}</h2>
      {!content ? (
        <p className="mt-2 text-small text-fg-2">{t.unreadable[draft.stage]}</p>
      ) : content.stage === 'requirements' ? (
        // Label and value side by side when the panel is wide enough; in a narrow chat column the
        // value wraps under its label (the panel's width, not the window's, decides).
        <dl className="mt-3 space-y-2">
          {content.rows.map((row) => (
            <div key={row.key} className="flex flex-wrap gap-x-3">
              <dt lang={row.lang} className="w-28 shrink-0 text-small font-bold text-fg-2">{row.label}</dt>
              <dd className="min-w-0 grow basis-40 text-small text-fg whitespace-pre-line break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        // role="list": without list markers, Safari drops the list from the accessibility tree.
        <ol role="list" className="mt-3 space-y-3">
          {content.modules.map((module, index) => {
            // The module number goes under its title, unless the title already starts with it; a
            // module the model gave no title is headed by its number.
            const numbered = module.title && !module.title.startsWith(module.label);
            const meta = [numbered ? module.label : '', module.hours].filter(Boolean).join(' · ');
            return (
              <li key={index} className="rounded-control border border-line bg-surface p-3">
                <h3 className="text-small font-bold text-fg break-words">{module.title || module.label}</h3>
                {meta && <p className="text-caption text-fg-3 tabular">{meta}</p>}
                {module.objective && <p className="mt-1 text-small text-fg-2 whitespace-pre-line break-words">{module.objective}</p>}
                {module.lessons.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-small text-fg marker:text-fg-3">
                    {module.lessons.map((lesson, lessonIndex) => (
                      <li key={lessonIndex} className="break-words">
                        {lesson.title}
                        {/* The separator is text, so the title and the minutes are not read as one number. */}
                        {lesson.minutes && <span className="text-caption text-fg-3 tabular"> · {lesson.minutes}</span>}
                        {lesson.subtitle && <span className="block text-fg-2">{lesson.subtitle}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {content && (
        <AiNotice
          surface="course_generation"
          answer={restoredDraftText(content)}
          context={courseId ? { courseId } : undefined}
          className="mt-3 border-t border-line pt-2"
        />
      )}
    </section>
  );
};
