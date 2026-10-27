/**
 * The learner's review queue (Phase 6, doc/brushup-2026/ai-access-plan.ja.md §10; owner decisions
 * R1-R4): GET /api/v2/user/review and POST /api/v2/user/review/grade (server/routes/review.js),
 * through apiFetch (the primary Supabase session's Bearer token). The server decides every day,
 * the daily cap and which cards are due; the browser sends three ids and a rating, never a time.
 * components/review/reviewClient.ts is the only caller (it sends requests only for the learner the
 * lesson-progress sync runs for).
 *
 * Failures throw ReviewApiError { status, errorType, … }: status 0 for a network error; a 404
 * without errorType means this server has no such route (an older one). The 409 refusals carry
 * learnerId and, when the server read one, the summary of today's counts (reviewedToday and dueOn
 * for not_due). A 200 whose body is not the documented shape throws 'bad_response'.
 */
import { apiFetch } from './apiClient';

/** Fired on window when the server removed review cards (a one-lesson reset, or a delete-all). */
export const REVIEW_STALE_EVENT = 'rp:review-stale';

/** The two buttons (R3): 'again' is 「もう一度」, 'good' is 「覚えた」. */
export type ReviewRating = 'again' | 'good';

/** Card and title text as written in the lesson: a string (in lessonLocale) or { jp?, en?, fr? }. */
export type ReviewText = string | { jp?: string; en?: string; fr?: string };
export type ReviewLocale = 'jp' | 'en' | 'fr';

export type ReviewCard = {
  courseSlug: string;
  lessonId: string;
  cardId: string;
  lessonTitle: ReviewText;
  lessonLocale: ReviewLocale;
  front: ReviewText;
  back: ReviewText;
  /** The card's due day (YYYY-MM-DD, Japan time). */
  dueOn: string;
};

/** Today's counts (Japan time, the server's clock). */
export type ReviewSummary = {
  today: string;
  dailyLimit: number;
  /** Cards graded today (any device or AI app). */
  doneToday: number;
  /** Cards still to grade today (the list's length). */
  remainingToday: number;
  dueTotal: number;
  /** Due cards beyond today's cap: they wait for the coming days. */
  carriedOver: number;
  /** Cards in the learner's queue (shown ones). */
  inQueue: number;
  /** The earliest due day of a card not due today, or null. */
  nextDueOn: string | null;
};

export type ReviewQueue = ReviewSummary & {
  /** The learner the server answered for (lower case). */
  learnerId: string;
  timeZone: string;
  cards: ReviewCard[];
};

export type GradeResult = {
  learnerId: string;
  graded: { courseSlug: string; lessonId: string; cardId: string; rating: ReviewRating; dueOn: string; intervalDays: number };
  summary: ReviewSummary;
};

export class ReviewApiError extends Error {
  status: number;
  errorType?: string;
  learnerId?: string;
  summary?: ReviewSummary;
  reviewedToday?: boolean;
  dueOn?: string;

  constructor(message: string, status: number, errorType?: string, extra: Partial<Pick<ReviewApiError, 'learnerId' | 'summary' | 'reviewedToday' | 'dueOn'>> = {}) {
    super(message);
    this.name = 'ReviewApiError';
    this.status = status;
    this.errorType = errorType;
    if (extra.learnerId !== undefined) this.learnerId = extra.learnerId;
    if (extra.summary !== undefined) this.summary = extra.summary;
    if (extra.reviewedToday !== undefined) this.reviewedToday = extra.reviewedToday;
    if (extra.dueOn !== undefined) this.dueOn = extra.dueOn;
  }
}

const PATH = '/user/review';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCALES: readonly string[] = ['jp', 'en', 'fr'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const day = (value: unknown): string | null => (typeof value === 'string' && DAY.test(value) ? value : null);
const id = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function textOf(value: unknown): ReviewText | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  const out: { jp?: string; en?: string; fr?: string } = {};
  for (const key of LOCALES) {
    const v = value[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') return null;
    out[key as ReviewLocale] = v;
  }
  return out;
}

/** The documented summary, or null. */
export function parseReviewSummary(value: unknown): ReviewSummary | null {
  if (!isRecord(value)) return null;
  const today = day(value.today);
  const nums = ['dailyLimit', 'doneToday', 'remainingToday', 'dueTotal', 'carriedOver', 'inQueue'] as const;
  const counts = {} as Record<(typeof nums)[number], number>;
  for (const key of nums) {
    const n = count(value[key]);
    if (n === null) return null;
    counts[key] = n;
  }
  const nextDueOn = value.nextDueOn === null ? null : day(value.nextDueOn);
  if (!today || (value.nextDueOn !== null && nextDueOn === null)) return null;
  return { today, ...counts, nextDueOn };
}

function cardOf(value: unknown): ReviewCard | null {
  if (!isRecord(value)) return null;
  const courseSlug = id(value.courseSlug);
  const lessonId = id(value.lessonId);
  const cardId = id(value.cardId);
  const lessonTitle = textOf(value.lessonTitle);
  const front = textOf(value.front);
  const back = textOf(value.back);
  const dueOn = day(value.dueOn);
  const lessonLocale = typeof value.lessonLocale === 'string' && LOCALES.includes(value.lessonLocale) ? value.lessonLocale as ReviewLocale : null;
  if (!courseSlug || !lessonId || !cardId || lessonTitle === null || front === null || back === null || !dueOn || !lessonLocale) return null;
  return { courseSlug, lessonId, cardId, lessonTitle, lessonLocale, front, back, dueOn };
}

/** The documented GET body, or null (a card that is not the documented shape fails the whole answer). */
export function parseReviewQueue(body: unknown): ReviewQueue | null {
  if (!isRecord(body) || !id(body.learnerId) || typeof body.timeZone !== 'string') return null;
  const summary = parseReviewSummary(body);
  if (!summary || !Array.isArray(body.cards)) return null;
  const cards: ReviewCard[] = [];
  for (const item of body.cards) {
    const card = cardOf(item);
    if (!card) return null;
    cards.push(card);
  }
  return { ...summary, learnerId: (body.learnerId as string).toLowerCase(), timeZone: body.timeZone, cards };
}

/** The documented POST 200 body, or null. */
export function parseGradeResult(body: unknown): GradeResult | null {
  if (!isRecord(body) || !id(body.learnerId) || !isRecord(body.graded)) return null;
  const graded = body.graded;
  const summary = parseReviewSummary(body.summary);
  const rating = graded.rating === 'again' || graded.rating === 'good' ? graded.rating : null;
  const dueOn = day(graded.dueOn);
  const intervalDays = count(graded.intervalDays);
  const courseSlug = id(graded.courseSlug);
  const lessonId = id(graded.lessonId);
  const cardId = id(graded.cardId);
  if (!summary || !rating || !dueOn || intervalDays === null || !courseSlug || !lessonId || !cardId) return null;
  return {
    learnerId: (body.learnerId as string).toLowerCase(),
    graded: { courseSlug, lessonId, cardId, rating, dueOn, intervalDays },
    summary,
  };
}

async function send(subPath: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await apiFetch(`${PATH}${subPath}`, init);
  } catch {
    throw new ReviewApiError('Network error', 0, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: an older server's HTML 404, or a proxy page.
  }
  if (!res.ok) {
    const data = isRecord(body) ? body : {};
    const summary = parseReviewSummary(data.summary);
    throw new ReviewApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.error_type === 'string' ? data.error_type : undefined,
      {
        ...(typeof data.learnerId === 'string' && data.learnerId ? { learnerId: data.learnerId.toLowerCase() } : {}),
        ...(summary ? { summary } : {}),
        ...(typeof data.reviewedToday === 'boolean' ? { reviewedToday: data.reviewedToday } : {}),
        ...(day(data.dueOn) ? { dueOn: data.dueOn as string } : {}),
      },
    );
  }
  return body;
}

/** Today's list and counts (the read also enters the cards the learner's lesson records imply). */
export async function getReviewQueue(): Promise<ReviewQueue> {
  const body = await send('', { method: 'GET' });
  const parsed = parseReviewQueue(body);
  if (!parsed) throw new ReviewApiError('Unexpected response', 200, 'bad_response');
  return parsed;
}

/** Records the learner's own button for one of today's cards. Only these four fields are sent. */
export async function gradeReviewCard({ courseSlug, lessonId, cardId, rating }: {
  courseSlug: string;
  lessonId: string;
  cardId: string;
  rating: ReviewRating;
}): Promise<GradeResult> {
  const body = await send('/grade', { method: 'POST', body: JSON.stringify({ courseSlug, lessonId, cardId, rating }) });
  const parsed = parseGradeResult(body);
  if (!parsed) throw new ReviewApiError('Unexpected response', 200, 'bad_response');
  return parsed;
}
