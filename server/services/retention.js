// @ts-check
/**
 * Retention (Phase 4, owner decisions D4 and D5; doc/brushup-2026/ai-access-plan.ja.md §8): old
 * records are deleted on a timer in the api (server.js main(), hourly; never in createApp, so tests
 * never start it). Only the rows below go; learner data of live accounts is never touched here
 * (inactive accounts are kept, D4), and account deletion has its own service
 * (server/services/accountDeletion.js).
 *
 *   ai_daily_usage            AI usage counts (user ids, ip: subjects, * totals)   30 days (JST days)
 *   jobs                      processing records, every status                       1 year
 *   mcp_tool_calls            AI-app tool records                                    1 year
 *   mcp_sessions              MCP sessions (cascade their tool calls)                1 year
 *   legal_acceptances         terms proofs of a deleted account                      5 years after the deletion
 *   account_consent_proofs    guardian consent proofs of a deleted account           5 years after the deletion
 *   ai_app_provision_records  AI apps a deleted account had used                     3 years after the deletion
 *   account_deletions         tombstones                                             5 years
 *   public/uploads            files no materials row names, older than 24 hours
 *
 * Not here on purpose (design §6.3): ai_safety_events (own prune, server/safety/events.js),
 * billing rows (tax), legal_document_versions (append-only, not personal), live accounts'
 * consents, learning events and profiles, live accounts' XP ledger, learning days and lesson reset
 * rows (Phase 5, migration 019: kept while the account exists, deleted with it by the cascade),
 * generated images and the TTS cache.
 *
 * Env (api only; none is a secret): RETENTION_ENABLED (false/0/off/no turn it all off; unset,
 * empty, true/1/on/yes leave it on; any other value turns it off with a warning: this job deletes;
 * the api outside NODE_ENV=production treats unset or empty as off, so a developer's local api on
 * the VM database never deletes with the laptop's settings: only an explicit true/1/on/yes runs it),
 * and per rule a whole number within its range (RETENTION_RULES). A value that is not one turns
 * THAT rule off and is reported at start and on every run: deleting with a fallback would be
 * irreversible, keeping is not.
 *
 * One run: a pooled client takes a session advisory lock with pg_try_advisory_lock (a second api
 * container during a deploy, or a slow run, skips instead of doubling), each step deletes in
 * batches of BATCH_LIMIT rows (at most MAX_BATCHES_PER_STEP per run), a failing step is logged and
 * the next one runs, then one summary line with counts only. runRetention never rejects.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../db.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @typedef {{ name: 'ai_daily_usage' | 'processing' | 'deletion_proof' | 'ai_app_records', env: string,
 *   unit: 'days' | 'years', def: number, min: number, max: number, kept: string }} RetentionRule
 */
/** @type {readonly RetentionRule[]} */
export const RETENTION_RULES = Object.freeze([
    { name: 'ai_daily_usage', env: 'RETENTION_AI_USAGE_DAYS', unit: 'days', def: 30, min: 2, max: 400, kept: 'AI usage counts are kept' },
    { name: 'processing', env: 'RETENTION_PROCESSING_DAYS', unit: 'days', def: 365, min: 30, max: 3650, kept: 'jobs and AI-app tool records are kept' },
    { name: 'deletion_proof', env: 'RETENTION_DELETION_PROOF_YEARS', unit: 'years', def: 5, min: 1, max: 10, kept: 'deletion records and consent proofs of deleted accounts are kept' },
    { name: 'ai_app_records', env: 'RETENTION_AI_APP_RECORD_YEARS', unit: 'years', def: 3, min: 1, max: 10, kept: 'AI-app records of deleted accounts are kept' },
].map((rule) => Object.freeze(/** @type {RetentionRule} */ (rule))));

/** The env names retention reads (api only): docker-compose.yml, stack.env.example, .env.example. */
export const RETENTION_ENV_KEYS = Object.freeze(['RETENTION_ENABLED', ...RETENTION_RULES.map((rule) => rule.env)]);

export const ORPHAN_UPLOAD_HOURS = 24;
export const BATCH_LIMIT = 5000;
export const MAX_BATCHES_PER_STEP = 20;
/** Upload files looked at (lstat) per materials query; at most MAX_BATCHES_PER_STEP such chunks per run. */
export const UPLOAD_CHUNK = 1000;
export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/** One lock for every api process on the database (session level, on the run's own client). */
export const RETENTION_LOCK_SQL = "SELECT pg_try_advisory_lock(hashtextextended('risepath:retention', 0)) AS locked";
export const RETENTION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended('risepath:retention', 0))";

/**
 * The steps in run order, each with the rule that gives its period ($1) and the batch size ($2).
 * Proofs go before the tombstones they belong to.
 * @typedef {{ step: string, rule: RetentionRule['name'], sql: string }} RetentionStep
 * @type {readonly RetentionStep[]}
 */
export const RETENTION_STEPS = Object.freeze(/** @type {RetentionStep[]} */ ([
    {
        step: 'ai_daily_usage',
        rule: 'ai_daily_usage',
        // Keeps today (Japan time) and the $1 days before; the primary key starts with usage_day (013).
        sql: "WITH doomed AS (SELECT usage_day, kind, subject FROM ai_daily_usage WHERE usage_day < (now() AT TIME ZONE 'Asia/Tokyo')::date - $1::int LIMIT $2) DELETE FROM ai_daily_usage u USING doomed d WHERE u.usage_day = d.usage_day AND u.kind = d.kind AND u.subject = d.subject",
    },
    {
        step: 'jobs',
        rule: 'processing',
        // Every status: a job left 'running' by a stopped worker is pruned too (jobs_updated_idx, 018).
        sql: 'DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE updated_at < now() - make_interval(days => $1) ORDER BY updated_at LIMIT $2)',
    },
    {
        step: 'mcp_tool_calls',
        rule: 'processing',
        sql: 'DELETE FROM mcp_tool_calls WHERE id IN (SELECT id FROM mcp_tool_calls WHERE created_at < now() - make_interval(days => $1) ORDER BY created_at LIMIT $2)',
    },
    {
        step: 'mcp_sessions',
        rule: 'processing',
        sql: 'DELETE FROM mcp_sessions WHERE id IN (SELECT id FROM mcp_sessions WHERE started_at < now() - make_interval(days => $1) LIMIT $2)',
    },
    {
        step: 'legal_acceptances',
        rule: 'deletion_proof',
        sql: 'DELETE FROM legal_acceptances WHERE id IN (SELECT id FROM legal_acceptances WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2)',
    },
    {
        step: 'account_consent_proofs',
        rule: 'deletion_proof',
        sql: 'DELETE FROM account_consent_proofs WHERE consent_id IN (SELECT consent_id FROM account_consent_proofs WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2)',
    },
    {
        step: 'ai_app_provision_records',
        rule: 'ai_app_records',
        sql: 'DELETE FROM ai_app_provision_records r USING (SELECT user_id, client_id, account_deleted_at FROM ai_app_provision_records WHERE account_deleted_at < now() - make_interval(years => $1) LIMIT $2) d WHERE r.user_id = d.user_id AND r.client_id = d.client_id AND r.account_deleted_at = d.account_deleted_at',
    },
    {
        step: 'account_deletions',
        rule: 'deletion_proof',
        // The age test is repeated on the target row: a deletion that rewrites an expired tombstone
        // (re-opened, deleted again) while this statement waits on its row lock commits a fresh
        // deleted_at, and READ COMMITTED re-checks only the outer WHERE on that new row version.
        sql: 'DELETE FROM account_deletions WHERE deleted_at < now() - make_interval(years => $1) AND user_id IN (SELECT user_id FROM account_deletions WHERE deleted_at < now() - make_interval(years => $1) LIMIT $2)',
    },
]).map((step) => Object.freeze(step)));

/** Which upload files a materials row still names (storage_path as server/routes/content.js writes it). */
export const UPLOAD_REFERENCES_SQL = 'SELECT storage_path FROM materials WHERE storage_path = ANY($1)';
/** The upload route's names: <Date.now(), 13 digits>-<original name>. */
const UPLOAD_NAME = /^[0-9]{13}-/;

const SWITCH_ON = ['', 'true', '1', 'on', 'yes'];
const SWITCH_OFF = ['false', '0', 'off', 'no'];

/**
 * @typedef {{ enabled: boolean, values: Record<RetentionRule['name'], number | null>, problems: string[], notProduction?: true }} RetentionConfig
 * @typedef {Pick<Console, 'log' | 'warn'>} Logger
 * @typedef {{ query: (sql: string, params?: unknown[]) => Promise<any>, release: (error?: unknown) => void }} PoolClient
 * @typedef {{ connect: () => Promise<PoolClient> }} RetentionPool
 */

/** At most 20 printable characters of a setting, for a warning line (no setting here is a secret). @param {string} text */
const shown = (text) => text.slice(0, 20).replace(/[^\x20-\x7e]/g, '?');

/** @param {unknown} error */
const messageOf = (error) => String(/** @type {any} */ (error)?.message ?? error).slice(0, 300);

/**
 * Reads the retention settings. Never throws.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ nodeEnv?: string | undefined }} [options] when the key is given (server.js passes
 *   process.env.NODE_ENV) and is not 'production', an unset or empty RETENTION_ENABLED means off
 *   (optIn): only the VM api deletes unless a developer turns it on on purpose. Without the key
 *   (the verify script, runRetention's default) unset means on.
 * @returns {RetentionConfig}
 */
export function readRetentionConfig(env = process.env, options = {}) {
    /** @type {string[]} */
    const problems = [];
    const raw = String(env.RETENTION_ENABLED ?? '').trim().toLowerCase();
    const optIn = 'nodeEnv' in options && options.nodeEnv !== 'production';
    let enabled = true;
    if (raw === '' && optIn) enabled = false;
    else if (SWITCH_OFF.includes(raw)) enabled = false;
    else if (!SWITCH_ON.includes(raw)) {
        enabled = false;
        problems.push("RETENTION_ENABLED has an unrecognised value: retention is off (use 'true' or 'false')");
    }
    /** @type {Record<string, number | null>} */
    const values = {};
    for (const rule of RETENTION_RULES) {
        const value = env[rule.env];
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) {
            values[rule.name] = rule.def;
            continue;
        }
        const n = /^[0-9]{1,6}$/.test(text) ? Number(text) : Number.NaN;
        if (Number.isInteger(n) && n >= rule.min && n <= rule.max) {
            values[rule.name] = n;
        } else {
            values[rule.name] = null;
            problems.push(`${rule.env}=${shown(text)} is not a whole number from ${rule.min} to ${rule.max}: ${rule.kept} until it is fixed`);
        }
    }
    return { enabled, values: /** @type {RetentionConfig['values']} */ (values), problems, ...(raw === '' && optIn ? { notProduction: true } : {}) };
}

/**
 * The api's start-up line (names and periods only).
 * @param {RetentionConfig} config
 */
export function retentionStartupLine(config) {
    if (!config.enabled) {
        if (config.notProduction) return '[Retention] off (not production; set RETENTION_ENABLED=true to run it here)';
        return config.problems.some((p) => p.startsWith('RETENTION_ENABLED'))
            ? '[Retention] off (RETENTION_ENABLED has an unrecognised value)'
            : '[Retention] off (RETENTION_ENABLED=false)';
    }
    const parts = RETENTION_RULES.map((rule) => {
        const value = config.values[rule.name];
        return `${rule.name} ${value === null ? 'kept (setting invalid)' : `${value} ${rule.unit}`}`;
    });
    return `[Retention] on, hourly: ${parts.join(', ')}, orphan uploads after ${ORPHAN_UPLOAD_HOURS} h`;
}

/**
 * Removes upload files that no materials row names any more (an unlink that failed after an
 * account deletion, a crash between the file and its row, older code): only direct entries of
 * <uploadRoot>/public/uploads named like the upload route names them, regular files (lstat: never a
 * symlink or a directory) last modified more than ORPHAN_UPLOAD_HOURS ago. Looked at in chunks of
 * UPLOAD_CHUNK, oldest name first, each chunk with one materials query; a failing query throws and
 * nothing of that chunk is removed.
 * @param {{ client: Pick<PoolClient, 'query'>, uploadRoot: string, now: () => number }} input
 * @returns {Promise<{ removed: number, failed: number }>}
 */
export async function sweepOrphanUploads({ client, uploadRoot, now }) {
    const dir = path.join(uploadRoot, 'public', 'uploads');
    /** @type {string[]} */
    let names;
    try {
        names = await fs.readdir(dir);
    } catch (error) {
        if (/** @type {any} */ (error)?.code === 'ENOENT') return { removed: 0, failed: 0 };
        throw error;
    }
    const cutoff = now() - ORPHAN_UPLOAD_HOURS * 60 * 60 * 1000;
    const candidates = names.filter((name) => UPLOAD_NAME.test(name) && !name.includes('/') && !name.includes('\\')).sort();
    let removed = 0;
    let failed = 0;
    for (let start = 0, chunks = 0; start < candidates.length && chunks < MAX_BATCHES_PER_STEP; start += UPLOAD_CHUNK, chunks += 1) {
        /** @type {string[]} */
        const old = [];
        for (const name of candidates.slice(start, start + UPLOAD_CHUNK)) {
            try {
                const stat = await fs.lstat(path.join(dir, name));
                if (stat.isFile() && stat.mtimeMs < cutoff) old.push(name);
            } catch {
                // gone meanwhile, or unreadable: not a candidate
            }
        }
        if (old.length === 0) continue;
        const result = await client.query(UPLOAD_REFERENCES_SQL, [old.map((name) => `public/uploads/${name}`)]);
        const referenced = new Set((result?.rows ?? []).map((/** @type {any} */ row) => row.storage_path));
        for (const name of old) {
            if (referenced.has(`public/uploads/${name}`)) continue;
            try {
                await fs.unlink(path.join(dir, name));
                removed += 1;
            } catch (error) {
                if (/** @type {any} */ (error)?.code !== 'ENOENT') failed += 1;
            }
        }
    }
    return { removed, failed };
}

let running = false;

/**
 * One retention run. Never rejects: every failure is logged and the result says what happened.
 * @param {{ pool?: RetentionPool | null, config?: RetentionConfig, logger?: Logger, uploadRoot?: string, now?: () => number }} [options]
 * @returns {Promise<{ ran: boolean, deleted: Record<string, number> }>}
 */
export async function runRetention({
    pool = /** @type {RetentionPool | null} */ (getPool()),
    config = readRetentionConfig(),
    logger = console,
    uploadRoot = PROJECT_ROOT,
    now = Date.now,
} = {}) {
    /** @type {Record<string, number>} */
    const deleted = {};
    if (!config.enabled || !pool || running) return { ran: false, deleted };
    running = true;
    /** @type {PoolClient | null} */
    let client = null;
    /** @type {unknown} */
    let broken = null;
    try {
        try {
            client = await pool.connect();
        } catch (error) {
            logger.warn(`[Retention] skipped: no database connection (${messageOf(error)})`);
            return { ran: false, deleted };
        }
        let locked = false;
        try {
            locked = (await client.query(RETENTION_LOCK_SQL))?.rows?.[0]?.locked === true;
        } catch (error) {
            broken = error;
            logger.warn(`[Retention] skipped: the lock could not be read (${messageOf(error)})`);
            return { ran: false, deleted };
        }
        if (!locked) return { ran: false, deleted };
        try {
            for (const problem of config.problems) logger.warn(`[Retention] ${problem}`);
            for (const { step, rule, sql } of RETENTION_STEPS) {
                const period = config.values[rule];
                if (period === null || period === undefined) continue; // the rule is off
                deleted[step] = 0;
                try {
                    for (let batch = 0; batch < MAX_BATCHES_PER_STEP; batch += 1) {
                        const n = Number((await client.query(sql, [period, BATCH_LIMIT]))?.rowCount ?? 0) || 0;
                        deleted[step] += n;
                        if (n < BATCH_LIMIT) break;
                    }
                } catch (error) {
                    logger.warn(`[Retention] ${step} failed: ${messageOf(error)}`);
                }
            }
            deleted.uploads = 0;
            try {
                const { removed, failed } = await sweepOrphanUploads({ client, uploadRoot, now });
                deleted.uploads = removed;
                if (failed > 0) logger.warn(`[Retention] uploads: ${failed} orphan file(s) could not be removed`);
            } catch (error) {
                logger.warn(`[Retention] uploads failed: ${messageOf(error)}`);
            }
            if (Object.values(deleted).some((n) => n > 0)) {
                logger.log(`[Retention] deleted ${Object.entries(deleted).map(([step, n]) => `${step}=${n}`).join(' ')}`);
            }
            return { ran: true, deleted };
        } finally {
            try {
                await client.query(RETENTION_UNLOCK_SQL);
            } catch (error) {
                broken = error; // the session ends with the client, and its lock with it
            }
        }
    } catch (error) {
        logger.warn(`[Retention] run failed: ${messageOf(error)}`);
        return { ran: false, deleted };
    } finally {
        try {
            client?.release(broken ?? undefined);
        } catch {
            // a client that cannot be released is dropped by the pool
        }
        running = false;
    }
}
