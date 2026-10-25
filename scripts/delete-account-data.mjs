#!/usr/bin/env node
// @ts-check
/**
 * Staff: delete a person's Rise Path data (Phase 4, design §5.12–5.13; the guide is
 * doc/guides/account-deletion-operations.ja.md). The same deletion as Settings → Delete account
 * (server/services/accountDeletion.js deleteAccountData): the shared Supabase login (Nexloom,
 * P-School) is not touched; deleting it is a separate dashboard step, after this one.
 *
 * Run it in the running api container (uploaded files live in its layer; DATABASE_URL_PHASE1,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the billing env are already there):
 *
 *   docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --find-email someone@example.com
 *   docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --dry-run
 *   docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --user <uuid> --yes
 *   docker compose --env-file stack.env exec -T api node scripts/delete-account-data.mjs --orphans [--limit 500] [--after <8 characters>] [--expect-orphans <n>] [--yes]
 *
 * --find-email  the Supabase user(s) with that email: id, created, last sign-in. Deletes nothing.
 *               Needs SUPABASE_SERVICE_ROLE_KEY (the anon key cannot list users).
 * --user        the id is put in canonical (lower-case) form first; PHASE1_USER_ID and non-UUIDs
 *               are refused. --dry-run: rows per table and whether a renewing plan blocks.
 *               --yes: deletes (requested_by 'staff') and prints the result as JSON.
 * --orphans     Rise Path stubs whose shared login was deleted outside Rise Path (by Nexloom or
 *               P-School operators, or a dashboard delete). Each stub is looked up at Supabase; an
 *               id is an orphan only when Supabase answers 404 / user_not_found. Any other answer
 *               stops the run (exit 3) and lists nothing. When none of the checked stubs is known it
 *               refuses (exit 2): that is a wrong SUPABASE_URL, not mass deletion. When more than
 *               10 % (and more than 5) of them are unknown it refuses too (exit 2) and lists them,
 *               unless --expect-orphans gives exactly that count (Nexloom or P-School deleted that
 *               many logins: confirm the count with them first). --expect-orphans <n> always needs
 *               the count to match. Without --yes: the list (8-character ids). With --yes: deletes
 *               each (requested_by 'orphan'), one at a time. Needs SUPABASE_SERVICE_ROLE_KEY.
 *               Stubs are checked in id order, at most --limit (500) per run; when more remain it
 *               says so and names where to go on: --after <the first 8 characters it printed>.
 *
 * Exit: 0 done (deleted or already deleted, every one), 2 refused (a renewing plan, a refused id,
 * the --orphans guards), 3 unavailable (database, Supabase, Stripe or Memanto: the service's
 * payment_provider_unavailable and memory_service_unavailable too; try again later), 1 usage or
 * setup. A JSON line with memoryDeleted true (exit 2 or 3): the AI memories are gone and the rest
 * was kept; run the same --yes again. Works whatever ACCOUNT_DELETION_ENABLED says (it switches
 * only the Settings page, and starts off). Full ids are printed only for --find-email and --user
 * (the staff terminal).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPool, PHASE1_USER_ID } from '../server/db.js';
import { deleteAccountData, readDeletionState } from '../server/services/accountDeletion.js';
import { readBillingConfig } from '../server/services/billingConfig.js';
import { createStripeClient } from '../server/services/stripeClient.js';
import { canonicalUserId } from '../tools/core/accountDeletions.js';

export const USAGE = [
    'Usage:',
    '  node scripts/delete-account-data.mjs --find-email <email>',
    '  node scripts/delete-account-data.mjs --user <uuid> --dry-run',
    '  node scripts/delete-account-data.mjs --user <uuid> --yes',
    '  node scripts/delete-account-data.mjs --orphans [--limit <n>] [--after <id or its first 8 characters>] [--expect-orphans <n>] [--yes]',
].join('\n');

export const EXIT = Object.freeze({ ok: 0, usage: 1, refused: 2, unavailable: 3 });
export const ORPHAN_PAGE = 200;
export const ORPHAN_DEFAULT_LIMIT = 500;
const LIST_PAGE = 1000;
const LIST_MAX_PAGES = 200;

/** The stubs, by key set, never PHASE1_USER_ID. */
export const STUB_PAGE_SQL = 'SELECT id FROM auth.users WHERE id > $1::uuid AND id <> $2::uuid ORDER BY id LIMIT 200';
const FIRST_ID = '00000000-0000-0000-0000-000000000000';

/** Tables whose rows go with the account (or are marked), counted by --dry-run. Fixed names only. */
export const DRY_RUN_TABLES = Object.freeze([
    'user_profiles', 'user_age', 'account_consents', 'curricula', 'curriculum_progress', 'materials', 'jobs',
    'learning_journal', 'learning_events', 'user_progress', 'lesson_progress', 'lesson_progress_resets',
    'lesson_progress_lesson_resets', 'xp_awards', 'learning_days',
    'notifications', 'learner_profiles', 'daily_reflections', 'lifestyle_logs', 'analysis_snapshots',
    'ai_sessions', 'agent_chat_consent', 'agent_session_binding', 'learner_memory_meta', 'learning_portal_admins',
    'mcp_oauth_grants', 'mcp_sessions', 'billing_customers', 'billing_subscriptions', 'legal_acceptances',
]);

/** @param {string} id */
const tag = (id) => `${id.slice(0, 8)}…`;

/**
 * @typedef {{
 *   deleteAccountData: typeof deleteAccountData,
 *   readDeletionState?: typeof readDeletionState,
 *   createAdminClient: () => Promise<any> | any,
 *   getPool: () => any,
 *   readBillingDeps: () => import('../server/services/accountDeletion.js').BillingDeps,
 *   log: (line: string) => void,
 *   now?: () => number,
 * }} Deps
 */

/**
 * Where --orphans starts: after a full account id, or after the lowest id that begins with the
 * given 1–8 hex characters (the 8-character ids the script prints). Null when it is neither.
 * @param {string} value
 */
export function orphanStart(value) {
    const id = canonicalUserId(value);
    if (id) return id;
    const prefix = String(value).trim().toLowerCase();
    if (!/^[0-9a-f]{1,8}$/.test(prefix)) return null;
    return `${prefix.padEnd(8, '0')}-0000-0000-0000-000000000000`;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
    /** @type {{ findEmail?: string, user?: string, orphans: boolean, dryRun: boolean, yes: boolean, limit: number, after?: string, expectOrphans?: number, help: boolean, error?: string }} */
    const out = { orphans: false, dryRun: false, yes: false, limit: ORPHAN_DEFAULT_LIMIT, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = () => {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                out.error = `${arg} needs a value`;
                return '';
            }
            i += 1;
            return next;
        };
        if (arg === '--find-email') out.findEmail = value();
        else if (arg === '--user') out.user = value();
        else if (arg === '--orphans') out.orphans = true;
        else if (arg === '--dry-run') out.dryRun = true;
        else if (arg === '--yes') out.yes = true;
        else if (arg === '--limit') {
            const raw = value();
            const n = Number(raw);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > 100000) out.error = '--limit must be a whole number from 1 to 100000';
            else out.limit = n;
        } else if (arg === '--after') {
            const raw = value();
            const start = raw ? orphanStart(raw) : null;
            if (!start) out.error ??= '--after must be an account id or its first 1 to 8 characters';
            else out.after = start;
        } else if (arg === '--expect-orphans') {
            const raw = value();
            const n = Number(raw);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > 100000) out.error ??= '--expect-orphans must be a whole number from 1 to 100000';
            else out.expectOrphans = n;
        } else if (arg === '--help' || arg === '-h') out.help = true;
        else out.error = `unknown argument ${arg}`;
    }
    const modes = [out.findEmail !== undefined, out.user !== undefined, out.orphans].filter(Boolean).length;
    if (!out.error && !out.help && modes !== 1) out.error = 'choose exactly one of --find-email, --user, --orphans';
    if (!out.error && out.user !== undefined && out.dryRun === out.yes) out.error = '--user needs exactly one of --dry-run or --yes';
    if (!out.error && out.findEmail !== undefined && (out.dryRun || out.yes)) out.error = '--find-email deletes nothing (no --dry-run or --yes)';
    if (!out.error && out.orphans && out.dryRun) out.error = '--orphans lists without --yes (no --dry-run)';
    if (!out.error && out.after !== undefined && !out.orphans) out.error = '--after only goes with --orphans';
    if (!out.error && out.expectOrphans !== undefined && !out.orphans) out.error = '--expect-orphans only goes with --orphans';
    return out;
}

/** Refusals that mean a dependency is down, not a decision (the API answers 503 for them): try again later. */
const UNAVAILABLE_REASONS = new Set(['payment_provider_unavailable', 'memory_service_unavailable']);

/** @param {import('../server/services/accountDeletion.js').DeletionResult} result */
export const exitOf = (result) => {
    if (result.status === 'deleted' || result.status === 'already') return EXIT.ok;
    if (result.status === 'refused' && !UNAVAILABLE_REASONS.has(result.reason)) return EXIT.refused; // subscription_active, invalid_user
    return EXIT.unavailable;
};

/** @param {string} email @param {Deps} deps */
async function findEmail(email, deps) {
    const target = email.trim().toLowerCase();
    if (!target.includes('@')) {
        deps.log('Refused: that is not an email address.');
        return EXIT.usage;
    }
    const admin = await deps.createAdminClient();
    if (!admin) {
        deps.log('Refused: --find-email needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the anon key cannot list users).');
        return EXIT.usage;
    }
    /** @type {any[]} */
    const found = [];
    for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
        let answer;
        try {
            answer = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE });
        } catch {
            deps.log('Unavailable: Supabase could not be reached. Nothing was changed.');
            return EXIT.unavailable;
        }
        if (answer?.error) {
            deps.log(`Unavailable: Supabase refused the user list (${answer.error.status ?? '-'} ${answer.error.code ?? '-'}). Nothing was changed.`);
            return EXIT.unavailable;
        }
        const users = answer?.data?.users ?? [];
        for (const user of users) {
            if (typeof user?.email === 'string' && user.email.trim().toLowerCase() === target) found.push(user);
        }
        if (users.length < LIST_PAGE) break;
    }
    if (!found.length) {
        deps.log('No Supabase user has that email.');
        return EXIT.ok;
    }
    for (const user of found) {
        deps.log(`id ${user.id}  created ${user.created_at ?? '-'}  last sign-in ${user.last_sign_in_at ?? 'never'}`);
    }
    return EXIT.ok;
}

/** @param {string} id @param {Deps} deps */
async function dryRun(id, deps) {
    const pool = deps.getPool();
    if (!pool) {
        deps.log('Unavailable: no database (DATABASE_URL_PHASE1).');
        return EXIT.unavailable;
    }
    deps.log(`Account ${id} (dry run: nothing is deleted)`);
    try {
        const stub = (await pool.query('SELECT count(*)::int AS n FROM auth.users WHERE id = $1::uuid', [id]))?.rows?.[0]?.n ?? 0;
        deps.log(`  auth.users stub: ${stub}`);
        const tombstone = (await pool.query('SELECT deleted_at, reopened_at, requested_by FROM account_deletions WHERE user_id = $1::uuid', [id]))?.rows?.[0];
        deps.log(tombstone
            ? `  deleted before: ${new Date(tombstone.deleted_at).toISOString()} (${tombstone.requested_by})${tombstone.reopened_at ? `, re-opened ${new Date(tombstone.reopened_at).toISOString()}` : ', not re-opened'}`
            : '  deleted before: no');
        for (const table of DRY_RUN_TABLES) {
            let n;
            try {
                n = (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1::uuid`, [id]))?.rows?.[0]?.n ?? 0;
            } catch (error) {
                if (/** @type {any} */ (error)?.code !== '42P01') throw error;
                n = 'missing table';
            }
            deps.log(`  ${table}: ${n}`);
        }
        const usage = (await pool.query("SELECT count(*)::int AS n FROM ai_daily_usage WHERE subject = $1::uuid::text AND usage_day < (now() AT TIME ZONE 'Asia/Tokyo')::date", [id]))?.rows?.[0]?.n ?? 0;
        deps.log(`  ai_daily_usage (before today, JST): ${usage}`);
        // billing as the deletion gets it: a live api leaves test-mode plan rows out of the check.
        const state = await (deps.readDeletionState ?? readDeletionState)({ pool, userId: id, billing: deps.readBillingDeps() });
        deps.log(state.subscription === 'renewing'
            ? '  plan: a renewing supporter plan blocks the deletion. Cancel it in the Stripe Dashboard first.'
            : `  plan: ${state.subscription === 'ending' ? 'ending (does not block)' : 'none'}`);
    } catch (error) {
        deps.log(`Unavailable: the database could not answer (${/** @type {any} */ (error)?.code ?? 'error'}).`);
        return EXIT.unavailable;
    }
    return EXIT.ok;
}

/** @param {string} id @param {Deps} deps */
async function deleteOne(id, deps) {
    const result = await deps.deleteAccountData({ userId: id, requestedBy: 'staff', authTime: null, billing: deps.readBillingDeps() });
    deps.log(JSON.stringify({ userId: id, ...result }));
    return exitOf(result);
}

/** @param {{ limit: number, yes: boolean, after?: string, expectOrphans?: number }} options @param {Deps} deps */
async function orphans({ limit, yes, after: startAfter, expectOrphans }, deps) {
    const admin = await deps.createAdminClient();
    if (!admin) {
        deps.log('Refused: --orphans needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the anon key cannot look users up).');
        return EXIT.usage;
    }
    const pool = deps.getPool();
    if (!pool) {
        deps.log('Unavailable: no database (DATABASE_URL_PHASE1).');
        return EXIT.unavailable;
    }
    const phase1 = canonicalUserId(PHASE1_USER_ID) ?? FIRST_ID;
    let after = startAfter ?? FIRST_ID;
    let checked = 0;
    // Stubs left after --limit stopped the run (they are not checked: say so, and where to go on).
    let more = false;
    /** @type {string[]} */
    const found = [];
    try {
        for (;;) {
            const rows = (await pool.query(STUB_PAGE_SQL, [after, phase1]))?.rows ?? [];
            if (checked >= limit) {
                // The limit fell on the end of a full page: this page only tells whether more remain.
                more = rows.length > 0;
                break;
            }
            for (const row of rows) {
                if (checked >= limit) {
                    more = true;
                    break;
                }
                const id = canonicalUserId(String(row?.id ?? ''));
                if (!id) continue;
                after = id;
                if (id === phase1) continue;
                checked += 1;
                let answer;
                try {
                    answer = await admin.auth.admin.getUserById(id);
                } catch {
                    deps.log(`Unavailable: Supabase could not be reached while checking ${tag(id)}. No orphan is listed and nothing was deleted.`);
                    return EXIT.unavailable;
                }
                const error = answer?.error;
                if (error) {
                    if (error.status === 404 || error.code === 'user_not_found') {
                        found.push(id);
                        continue;
                    }
                    deps.log(`Unavailable: Supabase answered ${error.status ?? '-'} ${error.code ?? '-'} for ${tag(id)}. No orphan is listed and nothing was deleted.`);
                    return EXIT.unavailable;
                }
                if (!answer?.data?.user) {
                    deps.log(`Unavailable: Supabase gave no answer for ${tag(id)}. No orphan is listed and nothing was deleted.`);
                    return EXIT.unavailable;
                }
            }
            if (more || rows.length < ORPHAN_PAGE) break;
        }
    } catch (error) {
        deps.log(`Unavailable: the database could not answer (${/** @type {any} */ (error)?.code ?? 'error'}). Nothing was deleted.`);
        return EXIT.unavailable;
    }
    deps.log(`Checked ${checked} Rise Path stubs: ${found.length} unknown to this Supabase project.`);
    if (more) {
        deps.log(`Stopped at --limit ${limit}: more stubs were not checked. Raise --limit, or run again with --after ${after.slice(0, 8)} to go on from here.`);
    }
    // In the right project at least one checked stub is a live login (a small --limit keeps the
    // count at 5 or fewer, under the 10 % rule). Never bypassed by --expect-orphans.
    if (found.length && found.length === checked) {
        deps.log(`Refused: none of the ${checked} checked stubs is known to this Supabase project; check SUPABASE_URL, or check more stubs (a higher --limit or an earlier --after). Nothing was deleted.`);
        return EXIT.refused;
    }
    // More than 10 % unknown: a wrong project, or a real batch of shared-login deletions. Only the
    // count the other operator confirmed (--expect-orphans) lets the run go on; when it is given,
    // it must match whatever the count is.
    const tooMany = found.length > 5 && found.length * 10 > checked;
    if ((tooMany && expectOrphans === undefined) || (expectOrphans !== undefined && expectOrphans !== found.length)) {
        for (const id of found) deps.log(`  orphan ${tag(id)}`);
        deps.log(expectOrphans === undefined
            ? `Refused: ${found.length} of ${checked} checked stubs (more than 10 %) are unknown to this Supabase project. Check SUPABASE_URL. If Nexloom or P-School deleted that many logins, confirm the count with them and run again with --expect-orphans ${found.length}. Nothing was deleted.`
            : `Refused: --expect-orphans ${expectOrphans}, but ${found.length} of ${checked} checked stubs are unknown to this Supabase project. Confirm the count again (and SUPABASE_URL). Nothing was deleted.`);
        return EXIT.refused;
    }
    if (!yes) {
        for (const id of found) deps.log(`  orphan ${tag(id)}`);
        if (found.length) deps.log('Run again with --yes to delete their Rise Path data.');
        return EXIT.ok;
    }
    /** @type {number} */
    let exit = EXIT.ok;
    const billing = deps.readBillingDeps();
    for (const id of found) {
        const result = await deps.deleteAccountData({ userId: id, requestedBy: 'orphan', authTime: null, billing });
        deps.log(`  ${tag(id)}: ${result.status}${'reason' in result ? ` (${result.reason})` : ''}`);
        const code = exitOf(result);
        if (code === EXIT.unavailable || (code === EXIT.refused && exit === EXIT.ok)) exit = code;
    }
    return exit;
}

/**
 * @param {string[]} argv
 * @param {Deps} deps
 * @returns {Promise<number>} the exit code
 */
export async function run(argv, deps) {
    const args = parseArgs(argv);
    if (args.help) {
        deps.log(USAGE);
        return EXIT.ok;
    }
    if (args.error) {
        deps.log(`${args.error}\n${USAGE}`);
        return EXIT.usage;
    }
    if (args.findEmail !== undefined) return findEmail(args.findEmail, deps);
    if (args.orphans) return orphans(args, deps);
    const id = canonicalUserId(args.user);
    if (!id) {
        deps.log('Refused: --user needs an account id (a UUID).');
        return EXIT.usage;
    }
    if (id === canonicalUserId(PHASE1_USER_ID)) {
        deps.log('Refused: that is the shared dev and bridge user (PHASE1_USER_ID), which is never deleted.');
        return EXIT.usage;
    }
    return args.dryRun ? dryRun(id, deps) : deleteOne(id, deps);
}

/** The real dependencies: the api's pool, billing as server.js builds it, a service-role client. */
export function defaultDeps() {
    return /** @type {Deps & { close: () => Promise<void> }} */ ({
        deleteAccountData,
        readDeletionState,
        getPool,
        createAdminClient: async () => {
            const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!url || !key) return null;
            const { createClient } = await import('@supabase/supabase-js');
            return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
        },
        readBillingDeps: () => {
            const config = readBillingConfig(process.env, { nodeEnv: process.env.NODE_ENV });
            return { config, stripe: config.serviceable ? createStripeClient({ secretKey: config.secretKey }) : null };
        },
        log: (line) => console.log(line),
        now: () => Date.now(),
        close: async () => {
            await getPool()?.end?.().catch(() => {});
        },
    });
}

const isMainModule = (() => {
    try {
        return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
})();

if (isMainModule) {
    const deps = defaultDeps();
    try {
        process.exitCode = await run(process.argv.slice(2), deps);
    } finally {
        await deps.close();
    }
}
