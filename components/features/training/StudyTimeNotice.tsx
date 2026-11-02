import React from 'react';
import { CloudOff, LogIn } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { Button } from '../../ui/Button';
import type { StudyTimePageState } from './trainingModel';
import { studyCopy } from './studyTimeText';

/**
 * A study time page's state other than 'ready' (CohortTimeView, UnitTimeView), for their status
 * region: loading, the sign-in lines, not offered, no such class, not a trainee, or a failure with
 * 「もう一度読み込む」.
 */
export default function StudyTimeNotice({ state, language, onRetry, onSignIn }: {
  state: Exclude<StudyTimePageState, { kind: 'ready' }>;
  language: 'en' | 'jp';
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const t = studyCopy[language];
  switch (state.kind) {
    case 'loading':
      return <p className="text-small text-fg-3">{t.loading}</p>;
    case 'account':
      return <EmptyState headingLevel={2} tone="primary" icon={<LogIn size={18} />} title={t.account} />;
    case 'signin':
      return (
        <EmptyState
          headingLevel={2}
          tone="primary"
          icon={<LogIn size={18} />}
          title={t.signIn}
          action={<Button size="sm" onClick={onSignIn}>{t.signInAgain}</Button>}
        />
      );
    case 'deleted':
      return <EmptyState headingLevel={2} icon={<LogIn size={18} />} title={t.deleted} />;
    case 'off':
      return <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.off} />;
    case 'not_found':
      return <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.notFound} />;
    case 'not_learner':
      return <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.notLearner} />;
    default:
      return (
        <EmptyState
          headingLevel={2}
          icon={<CloudOff size={18} />}
          title={t.failed}
          action={<Button variant="secondary" size="sm" onClick={onRetry}>{t.retry}</Button>}
        />
      );
  }
}
