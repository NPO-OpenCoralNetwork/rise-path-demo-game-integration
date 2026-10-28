// @ts-check
/**
 * Age from a birth year and month (Phase 0.5 minor safeguards; doc/brushup-2026/ai-access-plan.ja.md §4).
 *
 * Only the year and month are stored (user_age.birth_ym, server/migrations/014_minor_safeguards.sql),
 * so the age rounds toward younger: the birthday counts as the last day of the birth month. Someone
 * born in October 2008 turns 18 on 31 October 2026 (Japan time), never earlier than the real date.
 * The date is always the Japan-time date (Asia/Tokyo, UTC+9 with no daylight saving time since 1951),
 * whatever the host's time zone.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const ADULT_AGE = 18;
const MIN_YEAR = 1900;
const BIRTH_YM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The Japan-time calendar date of `now`.
 * @param {Date} now
 * @returns {{ year: number, month: number, day: number }} month 1-12
 */
export function tokyoDate(now) {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** @param {number} year @param {number} month 1-12 */
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Splits a 'YYYY-MM' string. No range check beyond the pattern.
 * @param {unknown} value
 * @returns {{ year: number, month: number } | null}
 */
function splitBirthYm(value) {
  if (typeof value !== 'string') return null;
  const match = BIRTH_YM_PATTERN.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * A valid birth month as 'YYYY-MM', or null: the 'YYYY-MM' form, not before 1900-01 and not after
 * the current Japan-time month.
 * @param {unknown} input
 * @param {Date} [now]
 * @returns {string | null}
 */
export function parseBirthYm(input, now = new Date()) {
  const parts = splitBirthYm(input);
  if (!parts || parts.year < MIN_YEAR) return null;
  const today = tokyoDate(now);
  if (parts.year > today.year || (parts.year === today.year && parts.month > today.month)) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
}

/**
 * Whole years of age on the Japan-time date of `now`, with the birthday on the last day of the
 * birth month. null when `birthYm` is not a valid 'YYYY-MM' (a future month gives a negative age
 * only through this function; parseBirthYm refuses it).
 * @param {unknown} birthYm 'YYYY-MM'
 * @param {Date} [now]
 * @returns {number | null}
 */
export function ageFromBirthYm(birthYm, now = new Date()) {
  const parts = splitBirthYm(birthYm);
  if (!parts) return null;
  const today = tokyoDate(now);
  let age = today.year - parts.year;
  if (today.month < parts.month) age -= 1;
  else if (today.month === parts.month && today.day < lastDayOfMonth(today.year, parts.month)) age -= 1;
  return age;
}

/**
 * Under 18 on the Japan-time date of `now`. An invalid value counts as a minor (the safe side).
 * @param {unknown} birthYm 'YYYY-MM'
 * @param {Date} [now]
 */
export function isMinorBirthYm(birthYm, now = new Date()) {
  const age = ageFromBirthYm(birthYm, now);
  return age === null || age < ADULT_AGE;
}
