import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../../context/LanguageContext';
import PageHeader from '../../ui/PageHeader';
import type { StudyTime } from '../../../services/trainingApi';
import StudyTimeNotice from './StudyTimeNotice';
import StudyTimeStatus from './StudyTimeStatus';
import { initialNumbers } from './trainingModel';
import { useStudyTime, useStudyTimeRead } from './useStudyTime';
import { studyCopy } from './studyTimeText';

const LINK = 'text-small font-medium text-primary-text underline underline-offset-4';

/**
 * /training/:cohortId/units/:unitKey (doc/brushup-2026/training-plan.ja.md §4.9): a unit's page.
 * It reads GET …/time once, then, while the class is in session and today's unit list has the
 * unit, records the learner's study time on it (useStudyTime) and shows it (StudyTimeStatus).
 */
export default function UnitTimeView({ learnerId, onSignIn }: { learnerId: string | null; onSignIn: () => void }) {
  const { cohortId = '', unitKey = '' } = useParams();
  const { language } = useLanguage();
  const t = studyCopy[language];
  const { state, retry, titleRef } = useStudyTimeRead(cohortId, learnerId);
  const unit = state.kind === 'ready' ? state.time.units.find((u) => u.unitKey === unitKey) : undefined;

  let body: React.ReactNode;
  if (state.kind !== 'ready') {
    body = <div role="status"><StudyTimeNotice state={state} language={language} onRetry={retry} onSignIn={onSignIn} /></div>;
  } else if (state.time.status !== 'ready' || !unit || !learnerId) {
    const line = state.time.status === 'not_configured' ? t.notConfigured : state.time.status === 'not_in_session' ? t.notInSession : t.notListed;
    body = <div role="status"><p className="text-body text-fg-2">{line}</p></div>;
  } else {
    body = <UnitRecorder key={`${cohortId}/${unitKey}`} cohortId={cohortId} unitKey={unitKey} learnerId={learnerId} time={state.time} language={language} onSignIn={onSignIn} />;
  }

  return (
    <>
      <p><Link to={`/training/${encodeURIComponent(cohortId)}`} className={LINK}>{t.toUnits}</Link></p>
      <PageHeader title={unit ? unit.title[language] : t.studyTime} titleRef={titleRef} />
      {body}
    </>
  );
}

function UnitRecorder({ cohortId, unitKey, learnerId, time, language, onSignIn }: {
  cohortId: string;
  unitKey: string;
  learnerId: string;
  time: StudyTime;
  language: 'en' | 'jp';
  onSignIn: () => void;
}) {
  const { view, numbers, recordHere } = useStudyTime({ cohortId, unitKey, learnerId, beatMs: time.beatMs ?? 0, numbers: initialNumbers(time, unitKey) });
  return <StudyTimeStatus view={view} numbers={numbers} language={language} onRecordHere={recordHere} onSignIn={onSignIn} />;
}
