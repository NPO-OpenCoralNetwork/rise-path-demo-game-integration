import React, { useEffect, useRef, useState } from 'react';
import { CloudOff, GraduationCap, LogIn } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import PageHeader from '../../ui/PageHeader';
import EmptyState from '../../ui/EmptyState';
import { Button } from '../../ui/Button';
import { getTrainingMe, type TrainingRole } from '../../../services/trainingApi';
import { stateForAnswer, stateForFailure, type TrainingPageState } from './trainingModel';

/**
 * /training (doc/brushup-2026/training-plan.ja.md D1, §4.6): the cohorts the signed-in learner is
 * in, and their role in each (GET /api/v2/training/me). Ships only with VITE_FEATURE_TRAINING=true
 * (components/routes/lazyRoutes.tsx). No AI tutor here (D6). Every state is shown inside one
 * status region, so a change is announced; after 「もう一度読み込む」 (its button leaves with the old
 * state) focus that was lost goes to the page title.
 */

/** On the page root: CI greps the flag-off build for it (.github/workflows/ci.yml). */
const TRAINING_UI_MARKER = 'risepath-training-ui';

const copy = {
  en: {
    title: 'Job training',
    description: 'The classes you are in, and your part in each.',
    loading: 'Loading…',
    none: 'You are not in a training class yet.',
    off: 'Job training is not offered here.',
    account: 'Sign in with a Rise Path account to see your training classes.',
    signIn: 'Your sign-in could not be confirmed. Sign in again to see your classes.',
    signInAgain: 'Sign in again',
    deleted: 'This Rise Path account was deleted.',
    failed: 'Your classes could not be loaded.',
    retry: 'Try again',
    roles: { learner: 'Trainee', instructor: 'Instructor', examiner: 'Review account', staff: 'Staff' } as Record<TrainingRole, string>,
  },
  jp: {
    title: '職業訓練',
    description: '登録している期と、それぞれの役割です。',
    loading: '読み込んでいます…',
    none: 'まだ、どの期にも登録されていません。',
    off: 'ここでは、職業訓練を提供していません。',
    account: 'Rise Path のアカウントでログインすると、職業訓練の期が表示されます。',
    signIn: 'ログインを確認できませんでした。ログインし直すと、期が表示されます。',
    signInAgain: 'ログインし直す',
    deleted: 'この Rise Path のアカウントは削除されています。',
    failed: '期の情報を読み込めませんでした。',
    retry: 'もう一度読み込む',
    roles: { learner: '受講者', instructor: '講師', examiner: '確認用アカウント', staff: '職員' } as Record<TrainingRole, string>,
  },
} as const;

export default function TrainingView() {
  const { language } = useLanguage();
  const { logout, user } = useAuth();
  const t = copy[language];
  const [state, setState] = useState<TrainingPageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
  // A demo-mode guest has no account: the server would answer 401 sign_in_required.
  const learnerId = user && !user.isGuest ? user.id : null;

  useEffect(() => {
    if (!learnerId) {
      setState({ kind: 'account' });
      return undefined;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getTrainingMe(controller.signal).then(
      (me) => { if (!controller.signal.aborted) setState(stateForAnswer(me, learnerId)); },
      (error) => { if (!controller.signal.aborted) setState(stateForFailure(error)); },
    );
    return () => controller.abort();
  }, [attempt, learnerId]);

  useEffect(() => {
    if (state.kind === 'loading' || !refocus.current) return;
    refocus.current = false;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (!active || active === document.body) titleRef.current?.focus({ preventScroll: true });
  }, [state.kind]);

  const retry = () => {
    refocus.current = true;
    setAttempt((n) => n + 1);
  };

  let body: React.ReactNode;
  switch (state.kind) {
    case 'loading':
      body = <p className="text-small text-fg-3">{t.loading}</p>;
      break;
    case 'account':
      body = <EmptyState headingLevel={2} tone="primary" icon={<LogIn size={18} />} title={t.account} />;
      break;
    case 'signin':
      body = (
        <EmptyState
          headingLevel={2}
          tone="primary"
          icon={<LogIn size={18} />}
          title={t.signIn}
          action={<Button size="sm" onClick={() => { void logout({ reason: 'reauth' }); }}>{t.signInAgain}</Button>}
        />
      );
      break;
    case 'deleted':
      body = <EmptyState headingLevel={2} icon={<LogIn size={18} />} title={t.deleted} />;
      break;
    case 'off':
      body = <EmptyState headingLevel={2} icon={<CloudOff size={18} />} title={t.off} />;
      break;
    case 'error':
      body = (
        <EmptyState
          headingLevel={2}
          icon={<CloudOff size={18} />}
          title={t.failed}
          action={<Button variant="secondary" size="sm" onClick={retry}>{t.retry}</Button>}
        />
      );
      break;
    default:
      body = state.me.cohorts.length === 0
        ? <EmptyState headingLevel={2} icon={<GraduationCap size={18} />} title={t.none} />
        : (
          <ul className="flex flex-col gap-3">
            {state.me.cohorts.map((cohort) => (
              <li key={cohort.cohortId} className="rounded-card border border-line bg-surface p-5 shadow-1">
                <h2 className="text-h3 text-fg">{cohort.name}</h2>
                {cohort.role ? <p className="mt-1 text-small text-fg-3">{t.roles[cohort.role]}</p> : null}
              </li>
            ))}
          </ul>
        );
  }

  return (
    <div data-rp-section={TRAINING_UI_MARKER} className="mx-auto flex max-w-2xl flex-col gap-6 py-6 sm:py-8">
      <PageHeader title={t.title} description={t.description} titleRef={titleRef} />
      <div role="status">{body}</div>
    </div>
  );
}
