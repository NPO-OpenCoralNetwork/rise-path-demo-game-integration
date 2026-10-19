import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getLevel, getXpForNextLevel } from '../../services/gamificationService';
import { getLearningEvents } from '../../services/progressService';
import { getLastLesson, parseProgress, PROGRESS_EVENT } from '../lesson/progressStore';
import { activeDaysFrom, streakFromDays, type StreakInfo } from './activity';

/**
 * Streak and level chips for the page header. Real data only:
 * - Streak: days with a learning event (gamificationService's source) or with lesson-reader
 *   progress (`rp:progress:*`, `rp:lastLesson`), counted in local days. The reader saves its
 *   progress there, so reading one lesson today starts a streak.
 * - Level and XP: gamificationService.
 * Zero states say what to do instead of showing an empty number.
 */

const PROGRESS_PREFIX = 'rp:progress:';

function readerTimestamps(): string[] {
  const out: string[] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      const progress = parseProgress(storage.getItem(key));
      const touched = progress.seen.length > 0 || Object.keys(progress.answers).length > 0;
      if (touched) out.push(progress.updatedAt);
    }
  } catch {
    // Storage blocked: no reader activity to count.
  }
  const last = getLastLesson();
  if (last) out.push(last.at);
  return out;
}

type Snapshot = { streak: StreakInfo; level: number; xp: { current: number; goal: number } };

function readSnapshot(): Snapshot {
  let eventTimes: string[] = [];
  try {
    eventTimes = getLearningEvents().map((event) => event.timestamp);
  } catch {
    eventTimes = [];
  }
  return {
    streak: streakFromDays(activeDaysFrom([...eventTimes, ...readerTimestamps()])),
    level: getLevel(),
    xp: getXpForNextLevel(),
  };
}

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

const ProgressCluster: React.FC<ProgressClusterProps> = ({ className = '' }) => {
  const { language } = useLanguage();
  const t = copy[language];
  const [data, setData] = useState<Snapshot>(readSnapshot);

  useEffect(() => {
    const refresh = () => setData(readSnapshot());
    window.addEventListener(PROGRESS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const { streak, level, xp } = data;
  const xpPct = xp.goal > 0 ? Math.max(0, Math.min(100, Math.round((xp.current / xp.goal) * 100))) : 0;

  return (
    <ul aria-label={t.label} className={`flex flex-wrap items-center gap-2 ${className}`}>
      <li className={chip}>
        <Flame size={16} aria-hidden="true" className={streak.days > 0 ? 'text-sun-text' : 'text-fg-3'} />
        {streak.days === 0 ? (
          <span>{t.streakZero}</span>
        ) : (
          <span>
            <span className="tabular font-semibold text-fg">{t.streak(streak.days)}</span>
            {!streak.activeToday ? <span> — {t.keepGoing}</span> : null}
          </span>
        )}
      </li>
      <li className={chip}>
        <span>
          {t.level} <span className="tabular font-semibold text-fg">{level}</span>
        </span>
        <span aria-hidden="true" className="text-fg-3">·</span>
        <span className="tabular">
          {xp.current} / {xp.goal} XP
        </span>
        <span
          role="progressbar"
          aria-label={t.xpBar}
          aria-valuemin={0}
          aria-valuemax={xp.goal}
          aria-valuenow={xp.current}
          className="h-1 w-10 overflow-hidden rounded-full bg-sunken"
        >
          <span className="block h-full rounded-full bg-sun" style={{ width: `${xpPct}%` }} />
        </span>
      </li>
    </ul>
  );
};

export default ProgressCluster;
