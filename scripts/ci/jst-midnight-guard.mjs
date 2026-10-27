#!/usr/bin/env node
// @ts-check
/**
 * Waits past 00:00 JST when a run would cross it (Phase 7, doc/brushup-2026/ai-access-plan.ja.md).
 * Learning days, review days and the verify scripts' day checks use Japan time (UTC+9, no daylight
 * saving; tools/core/reviewQueue.js), read from PostgreSQL's now(), so the guard reads the time there.
 * A run with less than `budget` seconds left before 00:00 JST waits until 00:00:05 JST: one computed,
 * logged wait, never a retry.
 *   node scripts/ci/jst-midnight-guard.mjs --url <postgres url> --budget <seconds, 1-900>
 * Used by scripts/ci/db-checks.sh (180 s).
 */
import { fileURLToPath } from 'node:url';

export const JST_OFFSET_S = 9 * 3600;
const DAY_S = 86_400;

/** Seconds from nowMs (UTC epoch ms) to the next 00:00 JST, 1..86400. @param {number} nowMs */
export function secondsToJstMidnight(nowMs) {
  return DAY_S - ((Math.floor(nowMs / 1000) + JST_OFFSET_S) % DAY_S);
}

/**
 * @param {{ query: (sql: string) => Promise<{ rows: any[] }>, budgetS: number,
 *   log?: (line: string) => void, sleep?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ leftS: number, waitedS: number }>}
 */
export async function waitPastJstMidnight({ query, budgetS, log = console.log, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!Number.isInteger(budgetS) || budgetS < 1 || budgetS > 900) throw new RangeError('budget must be 1..900 s');
  const { rows: [row] } = await query('SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms');
  const leftS = secondsToJstMidnight(Number(row.ms));
  if (leftS >= budgetS) {
    log(`# 00:00 JST is ${leftS} s away (budget ${budgetS} s): no wait`);
    return { leftS, waitedS: 0 };
  }
  const waitedS = leftS + 5;
  log(`::notice title=00:00 JST::${leftS} s to 00:00 JST, less than this run's ${budgetS} s: waiting ${waitedS} s so it runs on one Japan-time day`);
  await sleep(waitedS * 1000);
  return { leftS, waitedS };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  /** @param {string} name */
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const url = arg('--url');
  const budgetS = Number(arg('--budget'));
  if (!url || !Number.isInteger(budgetS)) {
    console.error('Usage: node scripts/ci/jst-midnight-guard.mjs --url <postgres url> --budget <seconds, 1-900>');
    process.exit(2);
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await waitPastJstMidnight({ query: (sql) => pool.query(sql), budgetS });
  } finally {
    await pool.end();
  }
}
