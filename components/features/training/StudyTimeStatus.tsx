import React from 'react';
import { Button } from '../../ui/Button';
import type { RecordingView, StudyNumbers } from './studyTimeCore';
import { formatDuration, studyCopy } from './studyTimeText';

/**
 * The unit page's study time (doc/brushup-2026/training-plan.ja.md §4.9, D13): today's time and the
 * unit's time against its set time, as the server's last answer gave them (nothing advances them in
 * between), and whether the time is counted now, and why not. Only that line is in the status
 * region, so it is announced when it changes, not at every signal. Other-place: 「この画面で記録する」;
 * a refused sign-in: 「ログインし直す」.
 */
export function recordingText(view: RecordingView, language: 'en' | 'jp'): string {
  const t = studyCopy[language];
  switch (view.kind) {
    case 'not_counting':
      return t.reasons[view.reason];
    case 'retrying':
      return t.retrying[view.cause];
    case 'stopped':
      return t.stopped[view.cause];
    default:
      return t.recording[view.kind];
  }
}

export default function StudyTimeStatus({ view, numbers, language, onRecordHere, onSignIn }: {
  view: RecordingView;
  numbers: StudyNumbers | null;
  language: 'en' | 'jp';
  onRecordHere: () => void;
  onSignIn: () => void;
}) {
  const t = studyCopy[language];
  return (
    <section aria-labelledby="study-time-heading" className="rounded-card border border-line bg-surface p-5 shadow-1">
      <h2 id="study-time-heading" className="text-h3 text-fg">{t.studyTime}</h2>
      {numbers ? (
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-small text-fg-3">{t.today}</dt>
            <dd className="tabular text-h3 text-fg">{formatDuration(numbers.todayMs, language)}</dd>
          </div>
          <div>
            <dt className="text-small text-fg-3">{t.thisUnit}</dt>
            <dd className="tabular text-h3 text-fg">
              {formatDuration(numbers.unit.countedMs, language)} / {formatDuration(numbers.unit.setMs, language)}
            </dd>
            {numbers.unit.capReached ? <dd className="text-small text-fg-2">{t.capReached}</dd> : null}
          </div>
        </dl>
      ) : null}
      <div role="status" className="mt-3 flex flex-col items-start gap-2">
        <p className="text-body text-fg-2">{recordingText(view, language)}</p>
        {view.kind === 'other_place' ? <Button size="sm" onClick={onRecordHere}>{t.recordHere}</Button> : null}
        {view.kind === 'stopped' && view.cause === 'signin' ? <Button size="sm" onClick={onSignIn}>{t.signInAgain}</Button> : null}
      </div>
    </section>
  );
}
