/**
 * Pure helpers for the dashboard's streak chip (ProgressCluster). No React, DOM or service
 * imports, so server/tests can import this file directly.
 *
 * A "day" is a local calendar date (YYYY-MM-DD in the learner's time zone), so a lesson read
 * at 08:00 in Tokyo counts for that morning, not for the previous UTC day.
 */

/** Local YYYY-MM-DD for a Date. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local day of an ISO timestamp, or null when it does not parse or is the epoch placeholder. */
export function dayOfTimestamp(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || time <= 0) return null;
  return localDateKey(new Date(time));
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d - 1));
}

export type StreakInfo = {
  /** Consecutive active days ending today (or yesterday, while today is still open). */
  days: number;
  /** Whether there is activity today. */
  activeToday: boolean;
};

/**
 * Streak over a set of active days. Like gamificationService.getStreak, a streak survives
 * until the end of the day after the last activity.
 */
export function streakFromDays(activeDays: Iterable<string>, now: Date = new Date()): StreakInfo {
  const days = new Set(activeDays);
  const today = localDateKey(now);
  const activeToday = days.has(today);
  let cursor = activeToday ? today : previousDay(today);
  if (!days.has(cursor)) return { days: 0, activeToday: false };
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return { days: count, activeToday };
}

/** Collects active days from any list of ISO timestamps (unparseable ones are skipped). */
export function activeDaysFrom(timestamps: Iterable<unknown>): Set<string> {
  const out = new Set<string>();
  for (const value of timestamps) {
    const day = dayOfTimestamp(value);
    if (day) out.add(day);
  }
  return out;
}
