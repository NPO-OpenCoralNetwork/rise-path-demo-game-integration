import React from 'react';
import { Flame } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAchievements, type AchievementsSnapshot } from './achievementsClient';

/**
 * Streak and level chips for the page header (Phase 5: from the server, useAchievements). The
 * server counts XP from its own records (a lesson started 10, finished 40, a Blender stage 80,
 * each once) and the streak from the days learning reached it (Japan time). Nothing is computed
 * in the browser.
 * Only with an answer for this learner ('ready'); while loading, signed out, on an older server
 * or after an error it renders nothing (no made-up zero).
 * Zero states say what to do instead of showing an empty number.
 */

const copy = {
  en: {
    label: 'Your learning record',
    streakZero: 'Streak 0 days — read one lesson today to start',
    streak: (n: number) => `Streak ${n} ${n === 1 ? 'day' : 'days'}`,
    keepGoing: 'read today to keep it',
    level: 'Lv',
    xpBar: 'XP to next level',
  },
  jp: {
    label: 'あなたの学習記録',
    streakZero: '連続 0 日 — 今日の1レッスンでスタート',
    streak: (n: number) => `連続 ${n} 日`,
    keepGoing: '今日読むと続きます',
    level: 'Lv',
    xpBar: '次のレベルまでの XP',
  },
} as const;

export type ProgressClusterProps = { className?: string };

const chip = 'inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-small text-fg-2 shadow-1';

/** The chips for a snapshot (exported for server/tests/phase5Front.test.js). */
export function ProgressClusterView({ snapshot, language, className = '' }: {
  snapshot: AchievementsSnapshot;
  language: 'en' | 'jp';
  className?: string;
}) {
  const t = copy[language];
  const data = snapshot.status === 'ready' ? snapshot.data : null;
  if (!data) return null;
  const { streak, xp } = data;
  const xpPct = xp.levelSize > 0 ? Math.max(0, Math.min(100, Math.round((xp.intoLevel / xp.levelSize) * 100))) : 0;

  return (
    <ul aria-label={t.label} className={`flex flex-wrap items-center gap-2 ${className}`}>
      <li className={chip}>
        <Flame size={16} aria-hidden="true" className={streak.current > 0 ? 'text-sun-text' : 'text-fg-3'} />
        {streak.current === 0 ? (
          <span>{t.streakZero}</span>
        ) : (
          <span>
            <span className="tabular font-semibold text-fg">{t.streak(streak.current)}</span>
            {!streak.activeToday ? <span> — {t.keepGoing}</span> : null}
          </span>
        )}
      </li>
      <li className={chip}>
        <span>
          {t.level} <span className="tabular font-semibold text-fg">{xp.level}</span>
        </span>
        <span aria-hidden="true" className="text-fg-3">·</span>
        <span className="tabular">
          {xp.intoLevel} / {xp.levelSize} XP
        </span>
        <span
          role="progressbar"
          aria-label={t.xpBar}
          aria-valuemin={0}
          aria-valuemax={xp.levelSize}
          aria-valuenow={xp.intoLevel}
          className="h-1 w-10 overflow-hidden rounded-full bg-sunken"
        >
          <span className="block h-full rounded-full bg-sun" style={{ width: `${xpPct}%` }} />
        </span>
      </li>
    </ul>
  );
}

const ProgressCluster: React.FC<ProgressClusterProps> = ({ className = '' }) => {
  const { language } = useLanguage();
  const snapshot = useAchievements();
  return <ProgressClusterView snapshot={snapshot} language={language} className={className} />;
};

export default ProgressCluster;
