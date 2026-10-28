/**
 * The learner's XP, level, streak and badges (Phase 5, doc/brushup-2026/ai-access-plan.ja.md §9):
 * GET /api/v2/user/achievements (server/routes/achievements.js), through apiFetch (the primary
 * Supabase session's Bearer token). The server counts everything from its own records; the
 * browser computes no XP. components/ui/achievementsClient.ts is the only caller (it runs the
 * request only for the learner the lesson-progress sync runs for).
 *
 * Failures throw AchievementsApiError { status, errorType }: status 0 for a network error; a 404
 * without errorType means this server has no such route (an older one). A 200 whose body is not
 * the documented shape throws 'bad_response'.
 */
import { apiFetch } from './apiClient';

/** Fired on window when something the server counts changed outside the lesson sync (a Blender stage, a review grade's learning day). */
export const ACHIEVEMENTS_STALE_EVENT = 'rp:achievements-stale';

export type BadgeId = 'first_lesson' | 'five_lessons' | 'fifteen_lessons' | 'first_course' | 'three_courses' | 'streak_3' | 'streak_7';

export type Badge = {
  id: BadgeId;
  earned: boolean;
  /** Progress toward goal (never above it). Streak badges: the current streak, or goal once earned. */
  current: number;
  goal: number;
  /** first_course: the course nearest to complete. */
  course?: string;
};

export type Achievements = {
  /** The learner the server counted for (lower case). */
  learnerId: string;
  xp: { total: number; level: number; intoLevel: number; levelSize: number; toNextLevel: number };
  counts: { lessonsStarted: number; lessonsDone: number; stagesDone: number };
  streak: { current: number; best: number; activeToday: boolean; today: string; timeZone: string };
  badges: Badge[];
  /**
   * Phase 8: the XP of each lesson's done award in the server's ledger, keyed by
   * '<course>/<lesson>' (LessonEnd's line). Absent: an older server that does not send it (the
   * line is not shown). `{}`: a newer server, no lesson done yet.
   */
  lessonXp?: Readonly<Record<string, number>>;
};

export class AchievementsApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'AchievementsApiError';
    this.status = status;
    this.errorType = errorType;
  }
}

const PATH = '/user/achievements';
const BADGE_IDS: readonly string[] = ['first_lesson', 'five_lessons', 'fifteen_lessons', 'first_course', 'three_courses', 'streak_3', 'streak_7'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function numbers<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isRecord(value)) return null;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = count(value[key]);
    if (n === null) return null;
    out[key] = n;
  }
  return out;
}

function badgeOf(value: unknown): Badge | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !BADGE_IDS.includes(value.id) || typeof value.earned !== 'boolean') return null;
  const current = count(value.current);
  const goal = count(value.goal);
  if (current === null || goal === null || goal < 1) return null;
  return {
    id: value.id as BadgeId,
    earned: value.earned,
    current: Math.min(current, goal),
    goal,
    ...(typeof value.course === 'string' && value.course ? { course: value.course } : {}),
  };
}

/** A lesson key as the server's ledger writes it (xp_awards.item_key for source 'lesson'). */
const LESSON_KEY = /^[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * The lessonXp field: undefined unless a plain object; entries with a lesson key and a positive
 * whole XP are kept, others dropped. The browser takes the server's figures as they are.
 */
export function lessonXpOf(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, xp] of Object.entries(value)) {
    if (LESSON_KEY.test(key) && typeof xp === 'number' && Number.isSafeInteger(xp) && xp > 0) out[key] = xp;
  }
  return Object.freeze(out);
}

/**
 * The documented 200 body, or null. Unknown badges are left out (a newer server). A malformed
 * lessonXp is dropped on its own (Phase 8): the rest of the answer stays usable.
 */
export function parseAchievements(body: unknown): Achievements | null {
  if (!isRecord(body) || typeof body.learnerId !== 'string' || !body.learnerId) return null;
  const xp = numbers(body.xp, ['total', 'level', 'intoLevel', 'levelSize', 'toNextLevel'] as const);
  const counts = numbers(body.counts, ['lessonsStarted', 'lessonsDone', 'stagesDone'] as const);
  const streak = isRecord(body.streak) ? body.streak : null;
  const streakCounts = numbers(streak, ['current', 'best'] as const);
  if (!xp || xp.level < 1 || xp.levelSize < 1 || !counts || !streak || !streakCounts) return null;
  if (typeof streak.activeToday !== 'boolean' || typeof streak.today !== 'string' || typeof streak.timeZone !== 'string') return null;
  if (!Array.isArray(body.badges)) return null;
  const badges = body.badges.map(badgeOf).filter((badge): badge is Badge => badge !== null);
  const lessonXp = lessonXpOf(body.lessonXp);
  return {
    learnerId: body.learnerId.toLowerCase(),
    xp,
    counts,
    streak: { ...streakCounts, activeToday: streak.activeToday, today: streak.today, timeZone: streak.timeZone },
    badges,
    ...(lessonXp ? { lessonXp } : {}),
  };
}

export async function getAchievements(): Promise<Achievements> {
  let res: Response;
  try {
    res = await apiFetch(PATH, { method: 'GET' });
  } catch {
    throw new AchievementsApiError('Network error', 0, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: an older server's HTML 404, or a proxy page.
  }
  if (!res.ok) {
    const data = isRecord(body) ? body : {};
    throw new AchievementsApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.error_type === 'string' ? data.error_type : undefined,
    );
  }
  const parsed = parseAchievements(body);
  if (!parsed) throw new AchievementsApiError('Unexpected response', res.status, 'bad_response');
  return parsed;
}
