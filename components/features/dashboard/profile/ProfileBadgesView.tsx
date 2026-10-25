import React, { useEffect } from 'react';
import {
  Award,
  BookOpenCheck,
  CircleCheck,
  CloudOff,
  Flame,
  GraduationCap,
  LockKeyhole,
  Medal,
  RotateCw,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage, type Language } from '../../../../context/LanguageContext';
import { useTheme } from '../../../../context/ThemeContext';
import { getCourse } from '../../../../content';
import { resolveText } from '../../../../shared/lesson/text.js';
import PageHeader from '../../../ui/PageHeader';
import EmptyState from '../../../ui/EmptyState';
import { Button } from '../../../ui/Button';
import { trackCopy } from '../../../ui/tracks';
import { reloadAchievements, useAchievements, type AchievementsSnapshot } from '../../../ui/achievementsClient';
import type { Badge, BadgeId } from '../../../../services/achievementsApi';

/**
 * Badges (Phase 5, design §3.5, §3.7): counted by the server from the learning records saved to
 * the account (useAchievements), never from this browser. Seven badges: lessons or Blender stages
 * finished (1, 5, 15), one course and three courses finished (the lessons published now), and
 * learning 3 or 7 days in a row (Japan time). A badge once earned stays (a reset or delete keeps
 * it). Words of an award appear only on earned badges (G20); an unearned badge shows its
 * progress (streak badges: the current streak, not the best, finding 8). The "next badge" card
 * shows the unearned badge nearest to done.
 * States: loading (a status line), unavailable (try again), unsupported (an older server) and
 * no_account (no Rise Path account signed in) say so without numbers.
 */

const copy = {
  en: {
    title: 'Badges',
    subtitle: 'Counted from the learning records saved to your account.',
    longest: (n: number) => (n === 1 ? 'Longest streak: 1 day' : `Longest streak: ${n} days`),
    next: (name: string) => `Next badge: ${name}`,
    allEarned: 'You have every badge',
    earned: 'Earned',
    toGo: (current: number, goal: number) => `${current} / ${goal} · ${goal - current} to go`,
    streakToGo: (c: number, r: number) => `${c} ${c === 1 ? 'day' : 'days'} in a row now; ${r} more ${r === 1 ? 'day' : 'days'} in a row to earn it`,
    course: (name: string) => `${name}: `,
    loading: 'Loading…',
    unavailableTitle: "Badges can't be shown right now.",
    unavailableBody: 'Please try again later.',
    retry: 'Try again',
    unsupported: 'Badges will be available soon.',
    noAccount: 'XP and badges are recorded when you sign in with a Rise Path account.',
    listLabel: 'All badges',
    badges: {
      first_lesson: { name: 'First lesson done', rule: 'Finish one lesson or stage' },
      five_lessons: { name: 'Five lessons done', rule: 'Finish five lessons or stages' },
      fifteen_lessons: { name: 'Fifteen lessons done', rule: 'Finish fifteen lessons or stages' },
      first_course: { name: 'Course complete', rule: 'Finish every lesson now published in one course' },
      three_courses: { name: 'Three courses complete', rule: 'Finish every lesson of three courses' },
      streak_3: { name: '3-day streak', rule: 'Learn three days in a row (Japan time)' },
      streak_7: { name: '7-day streak', rule: 'Learn seven days in a row (Japan time)' },
    } as Record<BadgeId, { name: string; rule: string }>,
  },
  jp: {
    title: 'バッジ',
    subtitle: 'アカウントに保存された学習の記録から数えています。',
    longest: (n: number) => `いちばん長い連続: ${n} 日`,
    next: (name: string) => `次のバッジ: ${name}`,
    allEarned: 'すべてのバッジを獲得しました',
    earned: '獲得済み',
    toGo: (current: number, goal: number) => `${current} / ${goal}・あと ${goal - current}`,
    streakToGo: (c: number, r: number) => `いまの連続 ${c} 日。あと ${r} 日つづけると獲得`,
    course: (name: string) => `${name}：`,
    loading: '読み込んでいます…',
    unavailableTitle: 'いまはバッジを表示できません。',
    unavailableBody: 'しばらくしてから、もう一度お試しください。',
    retry: 'もう一度読み込む',
    unsupported: 'バッジは、まもなく使えるようになります。',
    noAccount: 'XP とバッジは、Rise Path のアカウントでログインすると記録されます。',
    listLabel: 'すべてのバッジ',
    badges: {
      first_lesson: { name: 'はじめてのレッスン完了', rule: 'レッスンかステージを 1 つ終える' },
      five_lessons: { name: '5 つのレッスン完了', rule: 'レッスンかステージを 5 つ終える' },
      fifteen_lessons: { name: '15 のレッスン完了', rule: 'レッスンかステージを 15 終える' },
      first_course: { name: 'コース修了', rule: '1 つのコースの、いま公開されているレッスンをすべて終える' },
      three_courses: { name: '3 コース修了', rule: '3 つのコースのレッスンをすべて終える' },
      streak_3: { name: '3 日つづけて学習', rule: '3 日つづけて学ぶ（日本時間）' },
      streak_7: { name: '7 日つづけて学習', rule: '7 日つづけて学ぶ（日本時間）' },
    } as Record<BadgeId, { name: string; rule: string }>,
  },
} as const;

const ICONS: Record<BadgeId, LucideIcon> = {
  first_lesson: BookOpenCheck,
  five_lessons: Medal,
  fifteen_lessons: Trophy,
  first_course: GraduationCap,
  three_courses: Award,
  streak_3: Flame,
  streak_7: Flame,
};

const STREAK_BADGES: ReadonlySet<BadgeId> = new Set<BadgeId>(['streak_3', 'streak_7']);
/** Course slugs with a track name (components/ui/tracks.ts). */
const TRACK_OF: Record<string, 'vibe' | 'claude-code' | 'blender'> = { 'vibe-coding': 'vibe', 'claude-code': 'claude-code', blender: 'blender' };

/** A course's name in the UI language (the badge's `course`). */
export function courseName(slug: string, language: Language): string {
  const track = TRACK_OF[slug];
  const course = getCourse(slug);
  if (track) return trackCopy(track, language, course).title;
  if (course) return resolveText(course.title, language, course.locale ?? 'jp').value;
  return slug;
}

/** The progress line of an unearned badge. */
export function badgeProgressText(language: Language, badge: Badge): string {
  const t = copy[language];
  if (STREAK_BADGES.has(badge.id)) return t.streakToGo(badge.current, badge.goal - badge.current);
  const prefix = badge.id === 'first_course' && badge.course ? t.course(courseName(badge.course, language)) : '';
  return `${prefix}${t.toGo(badge.current, badge.goal)}`;
}

/** The unearned badge nearest to done (the first of equals), or null when all are earned. */
export function nextBadge(badges: readonly Badge[]): Badge | null {
  let best: Badge | null = null;
  for (const badge of badges) {
    if (badge.earned) continue;
    if (!best || badge.current * best.goal > best.current * badge.goal) best = badge;
  }
  return best;
}

const pct = (badge: Badge) => (badge.goal > 0 ? Math.max(0, Math.min(100, Math.round((badge.current / badge.goal) * 100))) : 0);

function ProgressBar({ badge, label }: { badge: Badge; label: string }) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={badge.goal}
      aria-valuenow={badge.current}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <span className="block h-full rounded-full bg-sun" style={{ width: `${pct(badge)}%` }} />
    </span>
  );
}

function BadgeItem({ badge, language }: { badge: Badge; language: Language }) {
  const t = copy[language];
  const { name, rule } = t.badges[badge.id];
  const Icon = ICONS[badge.id];
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-1" data-earned={badge.earned || undefined}>
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-control ${badge.earned ? 'bg-sun-soft text-sun-text' : 'bg-sunken text-fg-3'}`}
      >
        {badge.earned ? <Icon size={20} /> : <LockKeyhole size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-body font-bold text-fg">{name}</h3>
        <p className="mt-0.5 text-small text-fg-2">{rule}</p>
        {badge.earned ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-small font-semibold text-fg">
            <CircleCheck size={16} aria-hidden="true" className="text-success" />
            {t.earned}
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            <ProgressBar badge={badge} label={name} />
            <p className="tabular text-small text-fg-2">{badgeProgressText(language, badge)}</p>
          </div>
        )}
      </div>
    </li>
  );
}

/** The page body for a snapshot (exported for server/tests/phase5Front.test.js). */
export function ProfileBadgesBody({ language, snapshot, onRetry }: {
  language: Language;
  snapshot: AchievementsSnapshot;
  onRetry: () => void;
}) {
  const t = copy[language];
  const data = snapshot.status === 'ready' ? snapshot.data : null;
  if (!data) {
    if (snapshot.status === 'unavailable') {
      return (
        <EmptyState
          headingLevel={2}
          icon={<CloudOff size={20} />}
          title={t.unavailableTitle}
          description={t.unavailableBody}
          action={(
            <Button variant="secondary" size="sm" leadingIcon={<RotateCw size={14} aria-hidden="true" />} onClick={onRetry}>
              {t.retry}
            </Button>
          )}
        />
      );
    }
    if (snapshot.status === 'unsupported') return <EmptyState headingLevel={2} icon={<Award size={20} />} title={t.unsupported} />;
    if (snapshot.status === 'no_account') return <EmptyState headingLevel={2} icon={<Award size={20} />} title={t.noAccount} />;
    return <p role="status" className="text-body text-fg-2">{t.loading}</p>;
  }

  const upcoming = nextBadge(data.badges);
  const upcomingCopy = upcoming ? t.badges[upcoming.id] : null;
  return (
    <div className="space-y-6">
      <p className="tabular text-body text-fg-2">{t.longest(data.streak.best)}</p>

      <section className="rounded-card border border-line bg-surface p-5 shadow-1" aria-labelledby="rp-next-badge">
        {upcoming && upcomingCopy ? (
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-control bg-sunken text-fg-3">
              <LockKeyhole size={22} />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h2 id="rp-next-badge" className="text-h3 text-fg">{t.next(upcomingCopy.name)}</h2>
              <p className="text-small text-fg-2">{upcomingCopy.rule}</p>
              <ProgressBar badge={upcoming} label={upcomingCopy.name} />
              <p className="tabular text-small text-fg-2">{badgeProgressText(language, upcoming)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-control bg-sun-soft text-sun-text">
              <Trophy size={22} />
            </span>
            <h2 id="rp-next-badge" className="text-h3 text-fg">{t.allEarned}</h2>
          </div>
        )}
      </section>

      <ul aria-label={t.listLabel} className="grid gap-3 sm:grid-cols-2">
        {data.badges.map((badge) => <BadgeItem key={badge.id} badge={badge} language={language} />)}
      </ul>
    </div>
  );
}

const ProfileBadgesView: React.FC = () => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const snapshot = useAchievements();

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  const t = copy[language];
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8 md:py-12">
      <PageHeader title={t.title} description={t.subtitle} />
      <ProfileBadgesBody language={language} snapshot={snapshot} onRetry={() => void reloadAchievements()} />
    </div>
  );
};

export default ProfileBadgesView;
