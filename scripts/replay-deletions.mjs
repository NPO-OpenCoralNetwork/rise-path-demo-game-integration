#!/usr/bin/env node
// @ts-check
/**
 * 削除の記録の当て直し: after a database restore, re-apply the deletions learners asked for after the backup
 * was taken (Phase 9, owner decision D4; design §5.4, §5.8; doc/guides/first-launch.ja.md 16.2). Only
 * deploy/risepath-vm/scripts/restore-db.sh runs it (step RS8), after the migrations and before any learner-facing
 * service starts, in a one-off api container with the journal CSV on stdin:
 *
 *   docker compose --env-file stack.env run --rm --no-deps -T api \
 *     node scripts/replay-deletions.mjs --since <the manifest's dumpStartedAt> [--yes]  < journal.csv
 *
 * The journal (backup.sh journal, hourly, and the export just before the restore) holds, per row:
 *   kind,user_id,time,requested_by,reopened_at,course_slug,lesson_id,ref_id   (UTC ISO times, ids, slugs only)
 * with five kinds: account (account_deletions), progress (lesson_progress_resets), lesson
 * (lesson_progress_lesson_resets), consent (withdrawn guardian consents) and grant (disconnected AI apps).
 *
 * What it does (design §5.4, Scope guard TR9a):
 *   - keeps rows whose time is later than --since minus 15 minutes: a change that started before the dump's
 *     snapshot and committed after it is in neither the dump nor a `time > since` filter (design N6);
 *   - drops identical rows (the journals overlap), every other row of a user who has an account row (the
 *     deletion removes the rest), and for each account, learner or lesson every row but the newest;
 *   - consent and grant rows stop it with exit 2 before anything is changed or read: this version cannot
 *     re-apply them (none can exist at the first launch: adults only, the remote MCP off). The agent restores
 *     them by hand (手順書 16.2); plan 13.5 adds them before the minors stage and before BYOA;
 *   - applies the rest in time order, each only when the restored database does not already show it or
 *     something later (so the 15-minute margin never applies twice what the dump holds):
 *       account  skip when the restored tombstone's deleted_at is at or after the row's time; else
 *                deleteAccountData with the row's requested_by (scripts/delete-account-data.mjs defaultDeps).
 *                The tombstone and the proofs get the replay time (fail closed: every older session is refused);
 *       progress skip when the account is not in the restored database or its reset_at is at or after the
 *                time; else deleteAllLessonProgress;
 *       lesson   skip as progress (per lesson), or when the lesson is no longer published; else
 *                resetLessonProgress with the learner's current progress epoch (it also deletes that lesson's
 *                review cards).
 * Without --yes it only reads and prints what it would do. It prints counts, 8 characters of an id, kinds,
 * lesson slugs and the original times (Japan time, as restore-db.sh shows times, with the journal's UTC time in
 * brackets), never a full id.
 *
 * Exit (as scripts/delete-account-data.mjs): 0 all done, 1 usage or a journal line it cannot read (its number
 * only), 2 refused (consent or grant rows, nothing changed; or an account deletion refused), 3 unavailable
 * (the database: stop, then run the restore step again; every step skips what is already applied).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXIT = Object.freeze({ ok: 0, usage: 1, refused: 2, unavailable: 3 });
export const MARGIN_MINUTES = 15;
export const HEADER = Object.freeze(['kind', 'user_id', 'time', 'requested_by', 'reopened_at', 'course_slug', 'lesson_id', 'ref_id']);
export const KINDS = Object.freeze(['account', 'progress', 'lesson', 'consent', 'grant']);
/** Applied by this version (TR9a); the others stop it. */
export const APPLIED_KINDS = Object.freeze(['account', 'progress', 'lesson']);
export const REQUESTERS = Object.freeze(['self', 'staff', 'orphan']);

export const USAGE = 'Usage: node scripts/replay-deletions.mjs --since <ISO time, the manifest\'s dumpStartedAt> [--yes]  < journal.csv';
/** The last line of a run without --yes (restore-db.sh's RS8 asks its yes question right after it). */
export const DRY_RUN_LINE = 'これは確かめだけです（何も変えていません）。数が合っていれば、当てます。';
/** TR9a: printed when consent or grant rows are in the window (exit 2, nothing changed). */
export const STOP_CONSENT_GRANT = '保護者の同意の取り消しか、AI アプリの切断の記録があります。この版では自動で戻せません。エージェントと手で戻します（手順書 16.2）';

/** Why a row is not applied, in the order they are printed. */
export const SKIP_REASONS = Object.freeze({
  in_dump: '控えに入っていました',
  no_account: '控えにないアカウント（控えのあとに作られたか、削除ずみ）',
  unpublished: '公開をやめたレッスン',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::?00)?)$/;

/**
 * A UTC ISO time in microseconds since 1970 (Postgres keeps microseconds; a Date keeps milliseconds), or null.
 * @param {string} text
 * @returns {bigint | null}
 */
export function isoMicros(text) {
  const m = ISO_RE.exec(String(text));
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac = ''] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const back = new Date(ms);
  if (Number.isNaN(ms) || back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)
      || back.getUTCHours() !== Number(h) || back.getUTCMinutes() !== Number(mi) || back.getUTCSeconds() !== Number(s)) return null;
  return BigInt(ms) * 1000n + BigInt(frac.padEnd(6, '0'));
}

/** 8 characters of an id, for every printed line. @param {string} id */
export const tag = (id) => `${id.slice(0, 8)}…`;

/**
 * A time as the owner reads it (review round 3, finding 7): Japan time to the minute, in restore-db.sh's bk_jst form
 * (「日本時間 2026-11-03 03:23」; Japan has no summer time), then the exact UTC time from the journal in brackets marked
 * UTC, so the incident record is never 9 hours off and still has the microseconds.
 * @param {string} iso a UTC ISO time (isoMicros reads it)
 */
export function jstLabel(iso) {
  const micros = isoMicros(iso);
  if (micros === null) return iso;
  const japan = new Date(Number(micros / 1000n) + 9 * 3_600_000).toISOString();
  return `日本時間 ${japan.slice(0, 10)} ${japan.slice(11, 16)}（UTC: ${iso}）`;
}

/**
 * @typedef {{ kind: string, userId: string, time: string, micros: bigint, requestedBy: string, reopenedAt: string,
 *   courseSlug: string, lessonId: string, refId: string, line: number }} JournalRow
 */

/** A journal line that cannot be read: only its number is ever printed. */
export class JournalError extends Error {
  /** @param {number} line */
  constructor(line) {
    super(`削除の記録の ${line} 行目が読めません（形がちがいます）。`);
    this.name = 'JournalError';
    this.line = line;
  }
}

/**
 * The fields of one CSV line (RFC 4180 quoting, as Postgres COPY … CSV writes it), or null when the quoting is broken.
 * @param {string} line
 * @returns {string[] | null}
 */
function csvFields(line) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  for (;;) {
    let value = '';
    if (line[i] === '"') {
      i += 1;
      for (;;) {
        if (i >= line.length) return null;
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += line[i];
        i += 1;
      }
      if (i < line.length && line[i] !== ',') return null;
    } else {
      const end = line.indexOf(',', i);
      value = end < 0 ? line.slice(i) : line.slice(i, end);
      if (value.includes('"')) return null;
      i = end < 0 ? line.length : end;
    }
    out.push(value);
    if (i >= line.length) return out;
    i += 1; // the comma
  }
}

/**
 * Reads journal CSV text: one or more journals, each starting with HEADER (repeated header lines are skipped).
 * Throws JournalError with the first line it cannot read.
 * @param {string} text
 * @returns {JournalRow[]}
 */
export function parseJournal(text) {
  /** @type {JournalRow[]} */
  const rows = [];
  const lines = String(text).split('\n');
  let sawHeader = false;
  lines.forEach((raw, index) => {
    const number = index + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') return;
    const fields = csvFields(line);
    if (!fields || fields.length !== HEADER.length) throw new JournalError(number);
    if (fields.every((f, i) => f === HEADER[i])) {
      sawHeader = true;
      return;
    }
    if (!sawHeader) throw new JournalError(number);
    const [kind, userIdRaw, time, requestedBy, reopenedAt, courseSlug, lessonId, refIdRaw] = fields;
    const micros = isoMicros(time);
    if (!KINDS.includes(kind) || !UUID_RE.test(userIdRaw) || micros === null) throw new JournalError(number);
    const userId = userIdRaw.toLowerCase();
    const refId = refIdRaw.toLowerCase();
    const empty = (/** @type {string[]} */ ...values) => values.every((v) => v === '');
    if (kind === 'account') {
      if (!REQUESTERS.includes(requestedBy) || (reopenedAt !== '' && isoMicros(reopenedAt) === null) || !empty(courseSlug, lessonId, refId)) throw new JournalError(number);
    } else if (kind === 'lesson') {
      if (!SLUG_RE.test(courseSlug) || !SLUG_RE.test(lessonId) || !empty(requestedBy, reopenedAt, refId)) throw new JournalError(number);
    } else if (kind === 'progress') {
      if (!empty(requestedBy, reopenedAt, courseSlug, lessonId, refId)) throw new JournalError(number);
    } else if (!UUID_RE.test(refId) || !empty(requestedBy, reopenedAt, courseSlug, lessonId)) {
      throw new JournalError(number);
    }
    rows.push({ kind, userId, time, micros, requestedBy, reopenedAt, courseSlug, lessonId, refId, line: number });
  });
  if (!sawHeader) throw new JournalError(1);
  return rows;
}

/**
 * Which rows to look at, in time order (design §5.4): the window, identical rows, account precedence, newest per key.
 * @param {JournalRow[]} rows @param {bigint} sinceMicros
 */
export function planReplay(rows, sinceMicros) {
  const from = sinceMicros - BigInt(MARGIN_MINUTES) * 60n * 1_000_000n;
  const counts = { read: rows.length, before: 0, identical: 0, coveredByAccount: 0, olderSameKey: 0 };
  const inWindow = rows.filter((r) => {
    if (r.micros > from) return true;
    counts.before += 1;
    return false;
  });
  /** @type {Map<string, JournalRow>} */
  const unique = new Map();
  for (const r of inWindow) {
    const key = [r.kind, r.userId, r.time, r.requestedBy, r.reopenedAt, r.courseSlug, r.lessonId, r.refId].join('|');
    if (unique.has(key)) counts.identical += 1;
    else unique.set(key, r);
  }
  const withAccount = new Set([...unique.values()].filter((r) => r.kind === 'account').map((r) => r.userId));
  /** @type {Map<string, JournalRow>} */
  const newest = new Map();
  for (const r of unique.values()) {
    if (r.kind !== 'account' && withAccount.has(r.userId)) {
      counts.coveredByAccount += 1;
      continue;
    }
    const key = r.kind === 'lesson' ? `${r.kind}|${r.userId}|${r.courseSlug}|${r.lessonId}`
      : r.kind === 'consent' || r.kind === 'grant' ? `${r.kind}|${r.userId}|${r.refId}` : `${r.kind}|${r.userId}`;
    const seen = newest.get(key);
    if (!seen) newest.set(key, r);
    else {
      counts.olderSameKey += 1;
      if (r.micros > seen.micros) newest.set(key, r);
    }
  }
  const order = (/** @type {JournalRow} */ a, /** @type {JournalRow} */ b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.line - b.line);
  const planned = [...newest.values()].sort(order);
  return {
    counts,
    apply: planned.filter((r) => APPLIED_KINDS.includes(r.kind)),
    stop: planned.filter((r) => !APPLIED_KINDS.includes(r.kind)),
  };
}

/**
 * @typedef {{
 *   hasAccount: (userId: string) => Promise<boolean>,
 *   accountCovered: (userId: string, time: string) => Promise<boolean>,
 *   progressCovered: (userId: string, time: string) => Promise<boolean>,
 *   lessonCovered: (userId: string, courseSlug: string, lessonId: string, time: string) => Promise<boolean>,
 *   isPublished: (courseSlug: string, lessonId: string) => boolean,
 *   progressEpoch: (userId: string) => Promise<string | null>,
 * }} StateReader
 * @typedef {{ status: string, reason?: string }} AccountResult
 * @typedef {{
 *   state: StateReader,
 *   deleteAccount: (input: { userId: string, requestedBy: 'self' | 'staff' | 'orphan' }) => Promise<AccountResult>,
 *   deleteAllProgress: (input: { userId: string }) => Promise<{ error_type?: string } & Record<string, unknown>>,
 *   resetLesson: (input: { userId: string, epoch: string | null, courseSlug: string, lessonId: string }) => Promise<{ error_type?: string } & Record<string, unknown>>,
 *   log: (line: string) => void,
 * }} Deps
 */

/** Account results the staff script reads as "try again later" (scripts/delete-account-data.mjs exitOf). */
const ACCOUNT_UNAVAILABLE = new Set(['payment_provider_unavailable', 'memory_service_unavailable']);

/**
 * What the restored database says about one row: a skip reason, or null (apply it).
 * @param {JournalRow} row @param {StateReader} state
 * @returns {Promise<keyof typeof SKIP_REASONS | null>}
 */
async function decide(row, state) {
  if (row.kind === 'account') return (await state.accountCovered(row.userId, row.time)) ? 'in_dump' : null;
  if (!(await state.hasAccount(row.userId))) return 'no_account';
  if (row.kind === 'progress') return (await state.progressCovered(row.userId, row.time)) ? 'in_dump' : null;
  if (await state.lessonCovered(row.userId, row.courseSlug, row.lessonId, row.time)) return 'in_dump';
  return state.isPublished(row.courseSlug, row.lessonId) ? null : 'unpublished';
}

/** @param {JournalRow} r */
const describe = (r) => `${r.kind} ${tag(r.userId)}${r.kind === 'lesson' ? ` ${r.courseSlug}/${r.lessonId}` : ''}${r.kind === 'account' ? ` (${r.requestedBy})` : ''} もとの時刻 ${jstLabel(r.time)}`;

/**
 * The replay. Returns the exit code.
 * @param {{ text: string, since: string, yes: boolean, deps: Deps }} input
 * @returns {Promise<number>}
 */
export async function replayDeletions({ text, since, yes, deps }) {
  const log = deps.log;
  const sinceMicros = isoMicros(since);
  if (sinceMicros === null) {
    log(USAGE);
    return EXIT.usage;
  }
  /** @type {JournalRow[]} */
  let rows;
  try {
    rows = parseJournal(text);
  } catch (error) {
    log(error instanceof JournalError ? error.message : '削除の記録が読めません。');
    return EXIT.usage;
  }
  const { counts, apply, stop } = planReplay(rows, sinceMicros);
  log(`# 削除の記録の当て直し（控えの始まり ${jstLabel(since)}、余白 ${MARGIN_MINUTES} 分）${yes ? '' : ' — 確かめだけです（何も変えません）'}`);
  log(`読んだ行: ${counts.read}（控えより前: ${counts.before}、同じ行: ${counts.identical}、アカウントの削除に含まれる行: ${counts.coveredByAccount}、同じものの古い行: ${counts.olderSameKey}）`);
  if (stop.length) {
    const consent = stop.filter((r) => r.kind === 'consent');
    const grant = stop.filter((r) => r.kind === 'grant');
    log(`❌ ${STOP_CONSENT_GRANT}`);
    log(`   consent: ${consent.length}、grant: ${grant.length}（${stop.map((r) => `${r.kind} ${tag(r.userId)} もとの時刻 ${jstLabel(r.time)}`).join('、')}）`);
    log('   何も変えていません。');
    return EXIT.refused;
  }

  const done = { account: 0, progress: 0, lesson: 0, already: 0 };
  /** @type {Record<string, number>} */
  const skipped = Object.fromEntries(Object.keys(SKIP_REASONS).map((k) => [k, 0]));
  /** @type {string[]} */
  const applied = [];
  /** @type {number} */
  let exit = EXIT.ok;
  try {
    for (const row of apply) {
      const reason = await decide(row, deps.state);
      if (reason) {
        skipped[reason] += 1;
        continue;
      }
      if (!yes) {
        applied.push(describe(row));
        done[/** @type {'account' | 'progress' | 'lesson'} */ (row.kind)] += 1;
        continue;
      }
      if (row.kind === 'account') {
        const result = await deps.deleteAccount({ userId: row.userId, requestedBy: /** @type {'self' | 'staff' | 'orphan'} */ (row.requestedBy) });
        if (result.status === 'deleted') done.account += 1;
        else if (result.status === 'already') done.already += 1;
        else if (result.status === 'refused' && !ACCOUNT_UNAVAILABLE.has(String(result.reason))) {
          log(`❌ account ${tag(row.userId)}: 削除を断られました（${String(result.reason).replace(/[^a-z_]/g, '')}）。`);
          exit = EXIT.refused;
          continue;
        } else {
          log(`❌ account ${tag(row.userId)}: DB か外のサービスが答えません（${String(result.reason ?? result.status).replace(/[^a-z_]/g, '')}）。ここで止めます。`);
          return finish(EXIT.unavailable);
        }
      } else if (row.kind === 'progress') {
        const result = await deps.deleteAllProgress({ userId: row.userId });
        if (result.error_type) return failCore(row, result.error_type);
        done.progress += 1;
      } else {
        const epoch = await deps.state.progressEpoch(row.userId);
        const result = await deps.resetLesson({ userId: row.userId, epoch, courseSlug: row.courseSlug, lessonId: row.lessonId });
        if (result.error_type) return failCore(row, result.error_type);
        done.lesson += 1;
      }
      applied.push(describe(row));
    }
  } catch {
    log('❌ DB が答えません（読み取りか書き込みが失敗しました）。ここで止めます。');
    return finish(EXIT.unavailable);
  }
  return finish(exit);

  /** @param {JournalRow} row @param {string} type */
  function failCore(row, type) {
    log(`❌ ${row.kind} ${tag(row.userId)}: 当て直せませんでした（${String(type).replace(/[^a-z_]/g, '')}）。ここで止めます。`);
    return finish(EXIT.unavailable);
  }

  /** Prints the summary (also after a stop: what was applied so far) and returns `code`. @param {number} code */
  function finish(code) {
    const verb = yes ? '当てた' : '当てる';
    log(`${verb}: account ${done.account}、progress ${done.progress}、lesson ${done.lesson}${done.already ? `（account のうち、すでに削除ずみ: ${done.already}）` : ''}`);
    const total = Object.values(skipped).reduce((a, b) => a + b, 0);
    log(`とばした: ${total}（${Object.entries(SKIP_REASONS).map(([k, words]) => `${words}: ${skipped[k]}`).join('、')}）`);
    for (const line of applied) log(`- ${line}`);
    if (yes && applied.length) log('もとの時刻（日本時間。かっこの中は UTC）は、事故の記録に書きます（手順書 16.2）。');
    // Worded for both callers (review round 2, finding 12): restore-db.sh asks its own yes question next, so no --yes here.
    if (!yes) log(DRY_RUN_LINE);
    return code;
  }
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ since?: string, yes: boolean, error?: string }} */
  const out = { yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes' && !out.yes) out.yes = true;
    else if (arg === '--since' && out.since === undefined && argv[i + 1] !== undefined) {
      out.since = argv[i + 1];
      i += 1;
    } else out.error = 'usage';
  }
  if (out.since === undefined) out.error = 'usage';
  return out;
}

/** @param {AsyncIterable<Buffer | string>} input */
async function readText(input) {
  /** @type {Buffer[]} */
  const parts = [];
  for await (const part of input) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(parts).toString('utf8');
}

/** The real dependencies: the api's pool, the staff script's deletion and the lesson-progress core. */
export async function defaultDeps() {
  const [{ getPool }, staff, progress, catalog] = await Promise.all([
    import('../server/db.js'),
    import('./delete-account-data.mjs'),
    import('../tools/core/lessonProgress.js'),
    import('../tools/core/courseCatalog.js'),
  ]);
  const staffDeps = staff.defaultDeps();
  /** @param {string} sql @param {unknown[]} params */
  const exists = async (sql, params) => {
    const pool = getPool();
    if (!pool) throw new Error('no database');
    return ((await pool.query(sql, params))?.rows?.length ?? 0) > 0;
  };
  /** @type {Deps & { close: () => Promise<void> }} */
  const deps = {
    state: {
      hasAccount: (userId) => exists('SELECT 1 FROM auth.users WHERE id = $1::uuid', [userId]),
      accountCovered: (userId, time) => exists('SELECT 1 FROM account_deletions WHERE user_id = $1::uuid AND deleted_at >= $2::timestamptz', [userId, time]),
      progressCovered: (userId, time) => exists('SELECT 1 FROM lesson_progress_resets WHERE user_id = $1::uuid AND reset_at >= $2::timestamptz', [userId, time]),
      lessonCovered: (userId, courseSlug, lessonId, time) => exists(
        'SELECT 1 FROM lesson_progress_lesson_resets WHERE user_id = $1::uuid AND course_slug = $2 AND lesson_id = $3 AND reset_at >= $4::timestamptz',
        [userId, courseSlug, lessonId, time],
      ),
      isPublished: (courseSlug, lessonId) => catalog.isPublishedLesson(courseSlug, lessonId),
      progressEpoch: async (userId) => {
        const pool = getPool();
        if (!pool) throw new Error('no database');
        const epoch = (await pool.query('SELECT epoch FROM lesson_progress_resets WHERE user_id = $1::uuid', [userId]))?.rows?.[0]?.epoch;
        return epoch ? String(epoch) : null;
      },
    },
    deleteAccount: ({ userId, requestedBy }) => staffDeps.deleteAccountData({ userId, requestedBy, authTime: null, billing: staffDeps.readBillingDeps() }),
    deleteAllProgress: ({ userId }) => progress.deleteAllLessonProgress({ userId }),
    resetLesson: (input) => progress.resetLessonProgress(input),
    log: (line) => console.log(line),
    close: () => staffDeps.close(),
  };
  return deps;
}

/**
 * @param {string[]} argv
 * @param {{ stdin: AsyncIterable<Buffer | string>, deps?: Deps, log?: (line: string) => void }} io
 */
export async function run(argv, io) {
  const log = io.deps?.log ?? io.log ?? ((line) => console.log(line));
  const args = parseArgs(argv);
  if (args.error || isoMicros(String(args.since)) === null) {
    log(USAGE);
    return EXIT.usage;
  }
  const text = await readText(io.stdin);
  if (io.deps) return replayDeletions({ text, since: String(args.since), yes: args.yes, deps: io.deps });
  const deps = await defaultDeps();
  try {
    return await replayDeletions({ text, since: String(args.since), yes: args.yes, deps });
  } finally {
    await deps.close();
  }
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  process.exitCode = await run(process.argv.slice(2), { stdin: process.stdin });
}
