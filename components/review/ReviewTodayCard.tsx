import React from 'react';
import { RotateCw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import EmptyState from '../ui/EmptyState';
import { Button, ButtonLink } from '../ui/Button';
import type { ReviewQueue } from '../../services/reviewApi';
import type { AchievementsSnapshot } from '../ui/achievementsClient';
import { reloadReviewQueue, useReviewQueue } from './reviewClient';
import { reviewCopy } from './reviewCopy';
import { formatDueDay, reviewMinutes, todayCardOf } from './reviewModel';

/**
 * The dashboard's 「今日の復習」 card (Phase 6): what the server says about today's review cards,
 * never a made-up zero (loading, unavailable, unsupported and no_account say so without numbers).
 * 「復習する」 is secondary: the dashboard's one primary action is ContinueCard.
 */
export function ReviewTodayCardView({ language, snapshot, onReload }: {
  language: 'jp' | 'en';
  snapshot: Pick<AchievementsSnapshot<ReviewQueue>, 'status' | 'data'>;
  onReload: () => void;
}) {
  const t = reviewCopy[language];
  const c = t.card;
  const data = snapshot.data;
  const state = todayCardOf(snapshot);
  const next = data?.nextDueOn ? t.next(formatDueDay(data.nextDueOn, language)) : undefined;
  const common = { tone: 'sun' as const, icon: <RotateCw size={18} />, headingLevel: 2 as const };
  switch (state) {
    case 'due': {
      const n = data?.remainingToday ?? 0;
      return (
        <EmptyState
          {...common}
          title={c.dueTitle(n, reviewMinutes(n))}
          description={c.dueBody}
          action={<ButtonLink to="/review" variant="secondary">{c.start}</ButtonLink>}
        />
      );
    }
    case 'done': {
      const carried = data && data.carriedOver > 0 ? t.carried(data.carriedOver) : next;
      return <EmptyState {...common} title={c.doneTitle} description={carried} />;
    }
    case 'none_today':
      return <EmptyState {...common} title={c.noneTodayTitle} description={next} />;
    case 'empty':
      return <EmptyState {...common} title={c.emptyTitle} description={t.emptyBody} />;
    case 'no_account':
      return <EmptyState {...common} title={c.title} description={c.noAccountBody} />;
    case 'unavailable':
      return (
        <EmptyState
          {...common}
          title={c.title}
          description={c.unavailableBody}
          action={<Button variant="ghost" size="sm" onClick={onReload}>{t.reload}</Button>}
        />
      );
    case 'unsupported':
      return <EmptyState {...common} title={c.title} description={c.unsupportedBody} />;
    case 'loading':
    default:
      return <EmptyState {...common} title={c.title} description={c.loadingBody} />;
  }
}

export default function ReviewTodayCard() {
  const { language } = useLanguage();
  const snapshot = useReviewQueue();
  return <ReviewTodayCardView language={language} snapshot={snapshot} onReload={() => void reloadReviewQueue()} />;
}
