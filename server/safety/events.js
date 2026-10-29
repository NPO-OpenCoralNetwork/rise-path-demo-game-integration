// @ts-check
/**
 * Safety events (Phase 0.5): blocked inputs and outputs, learner reports, support lines shown and
 * failed checks, in ai_safety_events (server/migrations/014_minor_safeguards.sql).
 *
 * - Blocked events never store learner or model text: only the surface, category and audience.
 *   `detail` is kept only for 'user_report' ({reason, answer, question, note, context}).
 * - Retention: report text is cleared after REPORT_TEXT_DAYS (90), events are deleted after
 *   EVENT_DAYS (365). Pruning runs opportunistically, at most once an hour per process, when an
 *   event is recorded or an admin reads the safety pages.
 * - Alerts go to SAFETY_ALERT_WEBHOOK_URL (https only), or AI_CAP_ALERT_WEBHOOK_URL when unset,
 *   with no learner text: the kind, surface, category, audience and an 8-character user prefix.
 *   Each kind alerts at most once a minute per process; the next line counts the ones skipped.
 * - A blocked input invalidates the learner's cached access state (server/safety/access.js), so
 *   reaching SAFETY_BLOCKS_BEFORE_PAUSE pauses their AI at once; reaching it also alerts.
 *   Personal-information blocks never count towards the pause (access.js).
 *
 * Without a database pool nothing is stored (dev and tests); a line is logged instead. A failed
 * insert is logged and never fails the request that recorded it.
 */
import { getPool } from '../db.js';
import { ipSubject, parseAlertWebhook, postAlert } from '../middleware/dailyCaps.js';
import { PAUSE_EXEMPT_CATEGORY, blocksBeforePause, invalidateAiAccess, tokyoDayBounds } from './access.js';

/** @typedef {'input_blocked'|'output_blocked'|'user_report'|'support_shown'|'check_failed'} SafetyEventKind */
/**
 * @typedef {{
 *   kind: SafetyEventKind,
 *   surface: string,
 *   userId?: string | null,
 *   ip?: string | null,
 *   audience?: 'adult'|'minor'|null,
 *   category?: string | null,
 *   detail?: Record<string, unknown> | null,
 * }} SafetyEventInput
 */

export const SAFETY_EVENT_KINDS = Object.freeze(['input_blocked', 'output_blocked', 'user_report', 'support_shown', 'check_failed']);
export const REPORT_TEXT_DAYS = 90;
export const EVENT_DAYS = 365;

const HOUR_MS = 60 * 60 * 1000;
const ALERT_INTERVAL_MS = 60 * 1000;
/** Kinds that alert the operators (blocked inputs alert only when they pause someone). */
const ALERT_KINDS = new Set(['user_report', 'support_shown', 'output_blocked', 'check_failed']);

const SQL_INSERT = `INSERT INTO ai_safety_events (user_id, subject, audience, surface, kind, category, detail)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`;
const SQL_CLEAR_REPORT_TEXT = `UPDATE ai_safety_events SET detail = NULL
WHERE kind = 'user_report' AND detail IS NOT NULL AND created_at < now() - make_interval(days => $1::int)`;
const SQL_DELETE_OLD = 'DELETE FROM ai_safety_events WHERE created_at < now() - make_interval(days => $1::int)';
const SQL_COUNT_TODAY = `SELECT count(*)::int AS n FROM ai_safety_events
WHERE user_id = $1 AND kind = $2 AND created_at >= $3`;
/** Blocked inputs that count towards the pause, as access.js counts them. */
const SQL_COUNT_PAUSE_TODAY = `SELECT count(*)::int AS n FROM ai_safety_events
WHERE user_id = $1 AND kind = 'input_blocked' AND category IS DISTINCT FROM $3 AND created_at >= $2`;

/**
 * The subject column: 'ip:<address or /56 prefix>' (or 'ip:unknown') for a guest, NULL for a
 * signed-in user. A signed-in event is tied to the user only through user_id, which becomes NULL
 * when the account is deleted, so no copy of the user id survives the account.
 * @param {string | null | undefined} userId @param {string | null | undefined} ip
 * @returns {string | null}
 */
export const eventSubject = (userId, ip) => (userId ? null : ipSubject(ip) ?? 'ip:unknown');

/**
 * @param {{
 *   getPool?: () => any,
 *   env?: Record<string, string | undefined>,
 *   now?: () => number,
 *   logger?: Pick<Console, 'warn' | 'error' | 'info'>,
 *   fetch?: typeof fetch,
 * }} [options]
 */
export function createSafetyEvents({
  getPool: poolFn = getPool,
  env = process.env,
  now = () => Date.now(),
  logger = console,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  let lastPruneAt = -Infinity;
  /** @type {Map<string, { at: number, skipped: number }>} */
  const lastAlert = new Map();
  let warnedWebhook = '';

  /** The webhook URL (an href), or null. Never logs the URL. */
  const webhookUrl = () => {
    const name = env.SAFETY_ALERT_WEBHOOK_URL?.trim() ? 'SAFETY_ALERT_WEBHOOK_URL' : 'AI_CAP_ALERT_WEBHOOK_URL';
    const raw = env[name]?.trim() ?? '';
    if (!raw) return null;
    const parsed = parseAlertWebhook(raw, { name, httpsOnly: true });
    if (typeof parsed === 'string') {
      if (warnedWebhook !== raw) {
        warnedWebhook = raw;
        logger.warn(`[AI safety] ${parsed}: safety alerts are not posted.`);
      }
      return null;
    }
    return parsed.href;
  };

  /**
   * Post one alert line (no learner text), at most once a minute per key.
   * @param {string} key @param {string} line
   */
  function alert(key, line) {
    const t = now();
    const previous = lastAlert.get(key);
    if (previous && t - previous.at < ALERT_INTERVAL_MS) {
      previous.skipped += 1;
      return false;
    }
    const skipped = previous?.skipped ?? 0;
    lastAlert.set(key, { at: t, skipped: 0 });
    const full = skipped > 0 ? `${line} (+${skipped} more of this kind in the last minutes)` : line;
    logger.warn(full);
    const url = webhookUrl();
    if (url && fetchImpl) void postAlert(url, full, fetchImpl, logger);
    return true;
  }

  /**
   * Clear old report text and delete old events, at most once an hour per process.
   * @param {any} [pool]
   * @param {{ force?: boolean }} [options]
   */
  async function maybePrune(pool = poolFn(), { force = false } = {}) {
    if (!pool) return false;
    const t = now();
    if (!force && t - lastPruneAt < HOUR_MS) return false;
    lastPruneAt = t;
    try {
      await pool.query(SQL_CLEAR_REPORT_TEXT, [REPORT_TEXT_DAYS]);
      await pool.query(SQL_DELETE_OLD, [EVENT_DAYS]);
      return true;
    } catch (error) {
      logger.warn(`[AI safety] pruning old safety events failed (${error instanceof Error ? error.message : String(error)}).`);
      return false;
    }
  }

  /**
   * How many events of `kind` the user has today (Japan time). 0 without a pool.
   * @param {string} userId @param {SafetyEventKind} kind @param {any} [pool]
   */
  async function countToday(userId, kind, pool = poolFn()) {
    if (!pool || !userId) return 0;
    const { start } = tokyoDayBounds(now());
    const result = await pool.query(SQL_COUNT_TODAY, [userId, kind, new Date(start).toISOString()]);
    return Number(result?.rows?.[0]?.n ?? 0) || 0;
  }

  /**
   * Store one event (never throws). Returns whether a row was written.
   * @param {SafetyEventInput} event
   */
  async function record(event) {
    const { kind, surface, userId = null, ip = null, audience = null, category = null } = event;
    if (!SAFETY_EVENT_KINDS.includes(kind)) throw new Error(`Unknown safety event kind: ${kind}`);
    // Learner text is stored only for reports.
    const detail = kind === 'user_report' && event.detail ? event.detail : null;
    const who = userId ? `user ${String(userId).slice(0, 8)}` : 'a guest';
    const tag = [`surface=${surface}`, category ? `category=${category}` : '', audience ? `audience=${audience}` : ''].filter(Boolean).join(' ');

    let written = false;
    const pool = poolFn();
    if (pool) {
      try {
        await pool.query(SQL_INSERT, [userId || null, eventSubject(userId, ip), audience, surface, kind, category, detail ? JSON.stringify(detail) : null]);
        written = true;
      } catch (error) {
        logger.error(`[AI safety] recording a ${kind} event failed (${error instanceof Error ? error.message : String(error)}).`);
      }
      void maybePrune(pool);
    } else {
      logger.info?.(`[AI safety] ${kind} ${tag} (${who}; no database, not stored)`);
    }

    if (ALERT_KINDS.has(kind)) {
      const lines = {
        user_report: `[AI safety] new report about an AI answer: ${tag} from ${who}. Review it on the admin safety page.`,
        support_shown: `[AI safety] support lines shown (distress or self-harm signal): ${tag} for ${who}.`,
        output_blocked: `[AI safety] an AI answer was blocked before a minor saw it: ${tag}.`,
        check_failed: `[AI safety] a safety check failed, so a minor's AI request was refused: ${tag}. Check the classifier (task safety.screen).`,
      };
      alert(kind, lines[/** @type {keyof typeof lines} */ (kind)]);
    }

    if (kind === 'input_blocked' && userId) {
      invalidateAiAccess(String(userId));
      const threshold = blocksBeforePause(env);
      if (written && threshold > 0 && category !== PAUSE_EXEMPT_CATEGORY) {
        try {
          const result = await pool.query(SQL_COUNT_PAUSE_TODAY, [String(userId), new Date(tokyoDayBounds(now()).start).toISOString(), PAUSE_EXEMPT_CATEGORY]);
          if ((Number(result?.rows?.[0]?.n ?? 0) || 0) === threshold) {
            alert(`paused|${userId}`, `[AI safety] AI paused until 00:00 JST for ${who}: ${threshold} blocked inputs today (SAFETY_BLOCKS_BEFORE_PAUSE).`);
          }
        } catch {
          // The pause itself is enforced by access.js; the alert is best effort.
        }
      }
    }
    return written;
  }

  function reset() {
    lastPruneAt = -Infinity;
    lastAlert.clear();
    warnedWebhook = '';
  }

  return { record, countToday, maybePrune, alert, reset };
}

const events = createSafetyEvents();

export const recordSafetyEvent = events.record;
export const countSafetyEventsToday = events.countToday;
export const pruneSafetyEvents = events.maybePrune;
export const resetSafetyEventsForTests = events.reset;
