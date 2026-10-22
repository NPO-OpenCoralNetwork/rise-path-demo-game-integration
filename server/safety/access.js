// @ts-check
/**
 * Who may use the AI features, and as which audience (Phase 0.5 minor safeguards;
 * doc/brushup-2026/ai-access-plan.ja.md §4). The gate (server/middleware/aiAccessGate.js), the
 * learner's routes (server/routes/aiAccess.js) and the admin routes (server/routes/adminSafety.js)
 * all read and write through this module, so the rules live in one place:
 *
 *   - No age recorded: no AI ('needs_age'); learning without AI stays open.
 *   - Under 18 (server/safety/age.js, Japan time, birthday = last day of the birth month): a
 *     guardian's consent for CONSENT_POLICY_VERSION that is not revoked ('needs_guardian_consent'
 *     until then). The audience is 'minor': child-safety prompt part, input and output screening.
 *   - SAFETY_BLOCKS_BEFORE_PAUSE (default 10; 0 = never) blocked inputs in one Japan-time day:
 *     AI is paused until the next 00:00 JST ('paused'). Personal-information blocks do not count:
 *     the local pre-filter cannot tell a sample number or address in an exercise from a real one,
 *     and sending one's own details is a privacy slip to stop, not misuse to pause.
 *
 * Tables: user_age, account_consents, ai_safety_events (server/migrations/014_minor_safeguards.sql).
 * Results are cached per user for 60 s (never past the next 00:00 JST); every write here
 * invalidates the user's entry, and code that records a blocked input calls invalidateAiAccess()
 * so a pause starts at once.
 *
 * Outside production, AI_ACCESS_DEV_AUDIENCE ('adult' | 'minor') answers 'ready' with that audience
 * without reading the database, and with no pool the audience is 'adult'. In production the
 * variable is ignored (server.js warns at startup) and no pool means AiAccessUnavailableError.
 */
import { getPool } from '../db.js';
import { isMinorBirthYm, parseBirthYm, tokyoDate } from './age.js';

/** Version of the guardian consent text. The front end shows the same version; a new one needs a new consent. */
export const CONSENT_POLICY_VERSION = 'guardian-ai-2026-10';

export const CONSENT_KIND = 'guardian_ai';
export const CONSENT_METHODS = Object.freeze(['guardian_on_device', 'staff_paper_form']);
export const CONSENT_RELATIONSHIPS = Object.freeze(['parent', 'guardian', 'other']);
export const AGE_DECLARERS = Object.freeze(['self', 'guardian', 'staff']);
export const DEFAULT_BLOCKS_BEFORE_PAUSE = 10;

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {'ready'|'needs_age'|'needs_guardian_consent'|'paused'} AiAccessState
 * @typedef {'adult'|'minor'} AiAudience
 * @typedef {{ givenAt: string, method: string, relationship: string | null }} ConsentSummary
 * @typedef {{
 *   status: AiAccessState,
 *   audience: AiAudience | null,
 *   birthYm: string | null,
 *   consent: ConsentSummary | null,
 *   ageEditable: boolean,
 *   pausedUntil?: string,
 * }} AiAccess
 * @typedef {Record<string, string | undefined>} Env
 */

/** The access state cannot be read (production without a database, or a query that failed). */
export class AiAccessUnavailableError extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message);
    this.name = 'AiAccessUnavailableError';
    this.code = 'ai_access_unavailable';
    if (cause !== undefined) this.cause = cause;
  }
}

/** @type {Map<string, { value: AiAccess, expires: number }>} */
const cache = new Map();

/** @param {Env} env */
const isProduction = (env) => env.NODE_ENV === 'production';

/**
 * AI_ACCESS_DEV_AUDIENCE when it applies (not in production, and a known value), else null.
 * @param {Env} [env]
 * @returns {AiAudience | null}
 */
export function devAudience(env = process.env) {
  if (isProduction(env)) return null;
  const value = env.AI_ACCESS_DEV_AUDIENCE?.trim();
  return value === 'adult' || value === 'minor' ? value : null;
}

/**
 * SAFETY_BLOCKS_BEFORE_PAUSE: a whole number ≥ 0 (0 = never pause); anything else is the default.
 * @param {Env} [env]
 */
export function blocksBeforePause(env = process.env) {
  const raw = env.SAFETY_BLOCKS_BEFORE_PAUSE?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_BLOCKS_BEFORE_PAUSE;
  return Number(raw);
}

/**
 * Start of the Japan-time day of `nowMs`, and the next 00:00 JST, in milliseconds.
 * @param {number} nowMs
 */
export function tokyoDayBounds(nowMs) {
  const { year, month, day } = tokyoDate(new Date(nowMs));
  const start = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

/** @param {unknown} value */
const toIso = (value) => {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

/** @returns {import('pg').Pool} */
function requirePool() {
  const pool = getPool();
  if (!pool) throw new AiAccessUnavailableError('Database not configured');
  return /** @type {any} */ (pool);
}

/**
 * Write generations: invalidateAiAccess bumps a user's number, and resolveAiAccess caches a read
 * only when the number did not change while it ran, so a read that started before a revoke (or a
 * pause, or an age change) never puts the old state back. `epoch` covers the map being cleared.
 */
const generations = new Map();
let epoch = 0;

/** @param {string} userId */
const generationOf = (userId) => `${epoch}:${generations.get(userId) ?? 0}`;

/** Drop the cached access state of one user (after any write that changes it). @param {string} userId */
export function invalidateAiAccess(userId) {
  if (!userId) return;
  cache.delete(userId);
  if (generations.size >= CACHE_MAX && !generations.has(userId)) {
    generations.clear();
    epoch += 1;
  }
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
}

/** For tests: forget every cached state. */
export function resetAiAccessForTests() {
  cache.clear();
  generations.clear();
  epoch += 1;
}

/**
 * The recorded birth month, or null when none is recorded.
 * @param {string} userId
 * @returns {Promise<{ birthYm: string, declaredBy: string } | null>}
 */
export async function readBirthYm(userId) {
  const pool = requirePool();
  const result = await pool.query(
    "SELECT to_char(birth_ym, 'YYYY-MM') AS birth_ym, declared_by FROM user_age WHERE user_id = $1",
    [userId],
  );
  const row = result?.rows?.[0];
  if (!row?.birth_ym) return null;
  return { birthYm: String(row.birth_ym), declaredBy: String(row.declared_by ?? 'self') };
}

/**
 * The latest guardian consent for the current policy version that is not revoked.
 * @param {any} pool @param {string} userId
 * @returns {Promise<ConsentSummary | null>}
 */
async function readActiveConsent(pool, userId) {
  const result = await pool.query(
    `SELECT given_at, method, relationship FROM account_consents
     WHERE user_id = $1 AND kind = $2 AND policy_version = $3 AND revoked_at IS NULL
     ORDER BY given_at DESC LIMIT 1`,
    [userId, CONSENT_KIND, CONSENT_POLICY_VERSION],
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  return { givenAt: toIso(row.given_at), method: String(row.method), relationship: row.relationship ?? null };
}

/** Blocked-input categories that never count towards the pause. */
export const PAUSE_EXEMPT_CATEGORY = 'personal_info';

/**
 * Blocked inputs today (Japan time) that count towards the pause (personal_info excluded; the
 * pause alert in events.js counts the same way).
 * @param {any} pool @param {string} userId @param {number} dayStartMs
 */
async function countBlockedToday(pool, userId, dayStartMs) {
  const result = await pool.query(
    `SELECT count(*)::int AS blocked FROM ai_safety_events
     WHERE user_id = $1 AND kind = 'input_blocked' AND category IS DISTINCT FROM $3 AND created_at >= $2`,
    [userId, new Date(dayStartMs).toISOString(), PAUSE_EXEMPT_CATEGORY],
  );
  return Number(result?.rows?.[0]?.blocked ?? 0) || 0;
}

/**
 * @param {any} pool @param {string} userId @param {Env} env @param {Date} now
 * @returns {Promise<AiAccess>}
 */
async function readAccess(pool, userId, env, now) {
  const age = await readBirthYm(userId);
  if (!age) return { status: 'needs_age', audience: null, birthYm: null, consent: null, ageEditable: true };

  const audience = isMinorBirthYm(age.birthYm, now) ? 'minor' : 'adult';
  /** @type {AiAccess} */
  const base = { status: 'ready', audience, birthYm: age.birthYm, consent: null, ageEditable: false };
  if (audience === 'minor') {
    base.consent = await readActiveConsent(pool, userId);
    if (!base.consent) return { ...base, status: 'needs_guardian_consent' };
  }

  const threshold = blocksBeforePause(env);
  if (threshold > 0) {
    const { start, end } = tokyoDayBounds(now.getTime());
    if ((await countBlockedToday(pool, userId, start)) >= threshold) {
      return { ...base, status: 'paused', pausedUntil: new Date(end).toISOString() };
    }
  }
  return base;
}

/**
 * The AI access state of a signed-in user.
 * @param {string} userId
 * @param {{ env?: Env, now?: Date }} [options]
 * @returns {Promise<AiAccess>}
 * @throws {AiAccessUnavailableError} production without a database, or a query that failed
 */
export async function resolveAiAccess(userId, { env = process.env, now = new Date() } = {}) {
  if (!userId) throw new TypeError('resolveAiAccess needs a user id');
  const forced = devAudience(env);
  if (forced) return { status: 'ready', audience: forced, birthYm: null, consent: null, ageEditable: false };

  const pool = getPool();
  if (!pool) {
    if (isProduction(env)) throw new AiAccessUnavailableError('Database not configured');
    return { status: 'ready', audience: 'adult', birthYm: null, consent: null, ageEditable: false };
  }

  const nowMs = now.getTime();
  const cached = cache.get(userId);
  if (cached && cached.expires > nowMs) return cached.value;

  const generation = generationOf(userId);
  let value;
  try {
    value = await readAccess(pool, userId, env, now);
  } catch (error) {
    throw new AiAccessUnavailableError('AI access could not be read', error);
  }
  // Never past 00:00 JST: a pause ends there, and an age can change there.
  const expires = Math.min(nowMs + CACHE_TTL_MS, tokyoDayBounds(nowMs).end);
  // A write landed while this read ran: answer with what was read, but do not cache it.
  if (generationOf(userId) !== generation) return value;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(userId, { value, expires });
  return value;
}

/**
 * Records the birth month. The learner ('self') can set it once; a guardian or staff
 * ('guardian', 'staff', through the admin routes) can set or correct it at any time.
 * @param {{ userId: string, birthYm: unknown, declaredBy: string, now?: Date }} input
 * @returns {Promise<{ ok: boolean, birthYm?: string, error_type?: 'invalid_birth_ym' | 'invalid_declared_by' | 'age_already_set' }>}
 *   ok: false comes with error_type; ok: true with birthYm.
 */
export async function setBirthYm({ userId, birthYm, declaredBy, now = new Date() }) {
  const parsed = parseBirthYm(birthYm, now);
  if (!parsed) return { ok: false, error_type: 'invalid_birth_ym' };
  if (!AGE_DECLARERS.includes(declaredBy)) return { ok: false, error_type: 'invalid_declared_by' };
  const pool = requirePool();
  const date = `${parsed}-01`;
  if (declaredBy === 'self') {
    const result = await pool.query(
      `INSERT INTO user_age (user_id, birth_ym, declared_by) VALUES ($1, $2::date, 'self')
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [userId, date],
    );
    invalidateAiAccess(userId);
    if (!result?.rowCount) return { ok: false, error_type: 'age_already_set' };
    return { ok: true, birthYm: parsed };
  }
  await pool.query(
    `INSERT INTO user_age (user_id, birth_ym, declared_by) VALUES ($1, $2::date, $3)
     ON CONFLICT (user_id) DO UPDATE SET birth_ym = EXCLUDED.birth_ym, declared_by = EXCLUDED.declared_by, declared_at = now()`,
    [userId, date, declaredBy],
  );
  invalidateAiAccess(userId);
  return { ok: true, birthYm: parsed };
}

/**
 * Records a guardian's consent for the current policy version. On the learner's device the
 * relationship is required; a paper form recorded by staff needs recordedBy (the admin's id).
 * No guardian name or contact is stored.
 * @param {{ userId: string, method: string, relationship?: string | null, recordedBy?: string | null }} input
 * @returns {Promise<{ ok: boolean, consent?: ConsentSummary, error_type?: 'invalid_consent' }>}
 *   ok: false comes with error_type; ok: true with consent.
 */
export async function recordGuardianConsent({ userId, method, relationship = null, recordedBy = null }) {
  const invalid = /** @type {{ ok: boolean, error_type: 'invalid_consent' }} */ ({ ok: false, error_type: 'invalid_consent' });
  if (!CONSENT_METHODS.includes(method)) return invalid;
  if (relationship !== null && !CONSENT_RELATIONSHIPS.includes(relationship)) return invalid;
  if (method === 'guardian_on_device' && relationship === null) return invalid;
  if (method === 'staff_paper_form' && !(typeof recordedBy === 'string' && UUID_PATTERN.test(recordedBy))) return invalid;
  const pool = requirePool();
  const result = await pool.query(
    `INSERT INTO account_consents (user_id, kind, policy_version, method, relationship, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING given_at`,
    [userId, CONSENT_KIND, CONSENT_POLICY_VERSION, method, relationship, method === 'staff_paper_form' ? recordedBy : null],
  );
  invalidateAiAccess(userId);
  const givenAt = result?.rows?.[0]?.given_at;
  return { ok: true, consent: { givenAt: givenAt ? toIso(givenAt) : new Date().toISOString(), method, relationship } };
}

/**
 * Revokes every active guardian consent of the user; AI stops again for a minor.
 * @param {{ userId: string }} input
 * @returns {Promise<{ ok: true, revoked: number }>}
 */
export async function revokeGuardianConsent({ userId }) {
  const pool = requirePool();
  const result = await pool.query(
    'UPDATE account_consents SET revoked_at = now() WHERE user_id = $1 AND kind = $2 AND revoked_at IS NULL',
    [userId, CONSENT_KIND],
  );
  invalidateAiAccess(userId);
  return { ok: true, revoked: Number(result?.rowCount ?? 0) };
}
