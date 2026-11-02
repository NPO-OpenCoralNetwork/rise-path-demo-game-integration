import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../../context/LanguageContext';
import PageHeader from '../../ui/PageHeader';
import type { StudyTime, TrainingCohort } from '../../../services/trainingApi';
import StudyTimeNotice from './StudyTimeNotice';
import { useStudyTimeRead } from './useStudyTime';
import { formatDay, formatDuration, studyCopy } from './studyTimeText';

const LINK = 'text-small font-medium text-primary-text underline underline-offset-4';

/**
 * /training/:cohortId (doc/brushup-2026/training-plan.ja.md §4.9): the learner's study time in a
 * class, from GET …/time: today, each unit's time against its set time with a link to study it
 * (while the class is in session), the newest days (final once closed) and the class's total over
 * every day. The status region holds the state line only (today's time in session; else loading, a
 * refusal or why nothing is recorded), so the lists are not read out again on every change.
 */
export default function CohortTimeView({ learnerId, cohorts, onSignIn }: {
  learnerId: string | null;
  /** GET /training/me's classes, for the class's name (null while loading). */
  cohorts: TrainingCohort[] | null;
  onSignIn: () => void;
}) {
  const { cohortId = '' } = useParams();
  const { language } = useLanguage();
  const t = studyCopy[language];
  const { state, retry, titleRef } = useStudyTimeRead(cohortId, learnerId);
  const name = cohorts?.find((c) => c.cohortId === cohortId.toLowerCase())?.name;

  return (
    <>
      <p><Link to="/training" className={LINK}>{t.toClasses}</Link></p>
      <PageHeader title={name ?? t.studyTime} description={name ? t.studyTime : undefined} titleRef={titleRef} />
      <div role="status">
        {state.kind === 'ready' ? <p className="text-body text-fg-2">{statusLine(state.time, language)}</p> : (
          <StudyTimeNotice state={state} language={language} onRetry={retry} onSignIn={onSignIn} />
        )}
      </div>
      {state.kind === 'ready' ? <CohortTime time={state.time} language={language} /> : null}
    </>
  );
}

/** The state line: today's time in session, else why nothing is recorded. */
function statusLine(time: StudyTime, language: 'en' | 'jp'): string {
  const t = studyCopy[language];
  if (time.status === 'not_configured') return t.notConfigured;
  if (time.status === 'not_in_session') return t.notInSession;
  const todayMs = time.days.find((d) => d.day === time.today)?.countedMs ?? 0;
  return `${t.today}: ${formatDuration(todayMs, language)}`;
}

function CohortTime({ time, language }: { time: StudyTime; language: 'en' | 'jp' }) {
  const t = studyCopy[language];
  return (
    <>
      {time.units.length > 0 ? (
        <section aria-labelledby="units-heading" className="flex flex-col gap-3">
          <h2 id="units-heading" className="text-h2 text-fg">{t.units}</h2>
          <ul className="flex flex-col gap-3">
            {time.units.map((unit) => (
              <li key={unit.unitKey} className="rounded-card border border-line bg-surface p-5 shadow-1">
                <h3 className="text-h3 text-fg">{unit.title[language]}</h3>
                <p className="tabular mt-1 text-body text-fg-2">
                  {formatDuration(unit.countedMs, language)} / {formatDuration(unit.setMs, language)}
                </p>
                {unit.capReached ? <p className="text-small text-fg-3">{t.capReached}</p> : null}
                {time.status === 'ready' ? (
                  <p className="mt-2">
                    <Link to={`units/${encodeURIComponent(unit.unitKey)}`} className={LINK} aria-label={`${t.study}: ${unit.title[language]}`}>
                      {t.study}
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="days-heading" className="flex flex-col gap-3">
        <h2 id="days-heading" className="text-h2 text-fg">{t.recent}</h2>
        {time.days.length === 0 ? <p className="text-body text-fg-2">{t.noDays}</p> : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-1">
            {time.days.map((day) => (
              <li key={day.day} className="flex items-baseline justify-between gap-3 px-5 py-3">
                <span className="text-body text-fg">{formatDay(day.day, language)}</span>
                <span className="text-right">
                  <span className="tabular block text-body text-fg">{formatDuration(day.countedMs, language)}</span>
                  <span className="block text-small text-fg-3">{day.final ? t.final : t.notFinal}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="tabular text-body text-fg-2">{t.total}: {formatDuration(time.totalMs, language)}</p>
    </>
  );
}
