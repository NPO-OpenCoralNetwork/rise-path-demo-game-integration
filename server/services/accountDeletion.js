// @ts-check
/**
 * Deleting a Rise Path account's data (Phase 4, owner decisions D1–D5; doc/brushup-2026/ai-access-plan.ja.md §8).
 * Every learner data deletion goes through deleteAccountData: the Settings page
 * (POST /api/v2/user/account/deletion, server/routes/account.js, requestedBy 'self') and the staff
 * script (scripts/delete-account-data.mjs: 'staff' with --user, 'orphan' with --orphans).
 *
 * The Supabase login is shared with Nexloom and P-School and is not deleted (D2): the auth.users
 * stub in the VM database goes, with everything that cascades from it (migration 018 made the last
 * four blocking foreign keys SET NULL / CASCADE), and a tombstone in account_deletions makes every
 * session from before the deletion answer 401 account_deleted (tools/core/accountDeletions.js).
 *
 * Order (each step only after the one before succeeded):
 *   0. the id in canonical (lower-case) form; never PHASE1_USER_ID
 *   1. every refusal check, nothing deleted yet: already deleted (tombstone), a renewing plan in
 *      the local copy (live-mode rows always; test-mode rows unless this api runs in live mode,
 *      which never syncs them again), then at Stripe (open Checkout Sessions are expired first, so
 *      one paid meanwhile shows up as a subscription; any Stripe error refuses, except 400/404 on
 *      expiring a Session that is no longer open and resource_missing for a Customer Stripe no
 *      longer has; a list with more pages than read refuses too)
 *   2. Memanto (when enabled): the learner's memories, before anything else, because no HTTP call
 *      may run inside the transaction (it would hold the account lock)
 *   3. one transaction under the exclusive account lock (the auth.users trigger and every re-open
 *      take it shared): the stub row, then the learner's consents and grants, locked FOR UPDATE (a
 *      consent, AI-app grant or upload whose INSERT is in flight holds a KEY SHARE lock on the stub
 *      for its foreign key: the deletion waits for it, so the copies below see it; one started
 *      later waits for COMMIT and then fails its foreign key; an UPDATE of a consent or grant row
 *      waits too), tombstone again (FOR UPDATE), the plan again, the upload paths, the
 *      tombstone row (clock_timestamp: after the lock wait), the proofs kept by D5 (legal
 *      acceptances marked, guardian consents and used AI-app grants copied, each with the
 *      tombstone's exact deleted_at; an app's name from the page when the grant row has none),
 *      older AI usage counts, the Stripe Customers again, then the stub. A lock wait over 10 s is
 *      account_busy; any other error rolls back.
 *   4. after COMMIT, best effort (a failure is logged and never undoes the deletion): upload files,
 *      this process's caches, then the network re-checks: open Checkout Sessions again and the
 *      subscriptions read again (a renewing one, paid before COMMIT, raises the owner alert
 *      deleted_account_renewing: server/services/billingAlerts.js), Memanto
 *      again. The answer waits for them at most AFTER_COMMIT_WAIT_MS (they go on and log their own
 *      result after it); one log line with an 8-character id and no file names.
 *
 * Kept on purpose (design §5.7): today's ai_daily_usage row (abuse prevention, 30 days by
 * retention), legal_acceptances / account_consent_proofs / ai_app_provision_records (D5),
 * billing rows with user_id NULL (tax), safety events with user_id NULL, the tombstone itself.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, PHASE1_USER_ID } from '../db.js';
import { invalidateAiAccess } from '../safety/access.js';
import { accountLockKey, canonicalUserId, signedInBeforeDeletion } from '../../tools/core/accountDeletions.js';
import { billingAlerts as defaultBillingAlerts } from './billingAlerts.js';
import { invalidatePlan, TERMINAL_STATUSES } from './billingEntitlement.js';
import { isMemantoEnabled, purgeLearnerMemories } from './learnerMemoryBridge.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A password sign-in at most this old counts as re-authenticated (server/routes/account.js). */
export const REAUTH_MAX_AGE_S = 120;

/** Who asked: the person in Settings, staff by id, or staff for a login deleted outside Rise Path. */
export const DELETION_REQUESTERS = Object.freeze(['self', 'staff', 'orphan']);

/** How long the answer waits after COMMIT for the Stripe and Memanto re-checks (they go on after it). */
export const AFTER_COMMIT_WAIT_MS = 10_000;

/** Statuses after which a subscription never renews (the local rule and the Stripe rule). */
const ENDED = `('${TERMINAL_STATUSES.join("', '")}')`;
/**
 * The local plan rows that count, with $2 = whether this api runs in Stripe live mode (liveApi):
 * a live-mode row always; a test-mode row unless the api is live. A live api ignores test-mode
 * webhooks (billingSync.js ignored_mode), so a tester's test subscription would stay 'active' in
 * the local copy for good and block that person's deletion; it never charges anyone.
 */
const PLAN_ROWS = 'user_id = $1::uuid AND (livemode OR NOT $2::boolean)';
/**
 * The tombstone's own deleted_at, read in the database: a value passed back from JavaScript would
 * lose its microseconds (node-pg gives a Date), so the proofs would name an earlier time than the
 * tombstone, and legal_acceptances' CHECK (account_deleted_at >= accepted_at) could fail.
 */
const TOMBSTONE_TIME = '(SELECT deleted_at FROM account_deletions WHERE user_id = $1::uuid)';

/** Every statement, in the order the deletion sends them. $1 is always the canonical id; $2 of the plan checks is liveApi(billing). */
export const SQL = Object.freeze({
    tombstone: 'SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid',
    renewingLocal: `SELECT 1 FROM billing_subscriptions WHERE ${PLAN_ROWS} AND status NOT IN ${ENDED} AND NOT cancel_at_period_end AND cancel_at IS NULL LIMIT 1`,
    openSubscriptions: `SELECT status, cancel_at_period_end, cancel_at FROM billing_subscriptions WHERE ${PLAN_ROWS} AND status NOT IN ${ENDED}`,
    customers: 'SELECT stripe_customer_id, livemode FROM billing_customers WHERE user_id = $1::uuid',
    lockTimeout: "SET LOCAL lock_timeout = '10s'",
    statementTimeout: "SET LOCAL statement_timeout = '60s'",
    lock: `SELECT pg_advisory_xact_lock(${accountLockKey(1)})`,
    // FOR UPDATE conflicts with the KEY SHARE lock of a foreign key check (a consent, grant or
    // upload INSERT), and the row locks below with an UPDATE of a consent or grant (a revocation,
    // an AI app's first use of a grant row the revoke route wrote): those finish first or wait.
    lockStub: 'SELECT 1 FROM auth.users WHERE id = $1::uuid FOR UPDATE',
    lockConsents: 'SELECT 1 FROM account_consents WHERE user_id = $1::uuid FOR UPDATE',
    lockGrants: 'SELECT 1 FROM mcp_oauth_grants WHERE user_id = $1::uuid FOR UPDATE',
    tombstoneForUpdate: 'SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid FOR UPDATE',
    uploads: 'SELECT storage_path FROM materials WHERE user_id = $1::uuid AND storage_path IS NOT NULL',
    writeTombstone: `INSERT INTO account_deletions (user_id, deleted_at, requested_by) VALUES ($1::uuid, clock_timestamp(), $2)
     ON CONFLICT (user_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at, requested_by = EXCLUDED.requested_by, reopened_at = NULL
     RETURNING deleted_at`,
    markAcceptances: `UPDATE legal_acceptances SET account_deleted_at = ${TOMBSTONE_TIME} WHERE user_id = $1::uuid AND account_deleted_at IS NULL`,
    copyConsents: `INSERT INTO account_consent_proofs (consent_id, user_id, kind, policy_version, method, given_at, revoked_at, account_deleted_at)
     SELECT id, user_id, kind, policy_version, method, given_at, revoked_at, ${TOMBSTONE_TIME} FROM account_consents WHERE user_id = $1::uuid
     ON CONFLICT (consent_id) DO NOTHING`,
    // $2/$3: the app ids and names the delete page read from Supabase (only the revoke route
    // stores a name; the remote MCP server cannot): a name stored at revocation wins.
    copyGrants: `INSERT INTO ai_app_provision_records (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at, account_deleted_at)
     SELECT g.user_id, g.client_id, COALESCE(g.client_name, n.client_name), g.first_seen_at, g.last_used_at, g.revoked_at, ${TOMBSTONE_TIME} FROM mcp_oauth_grants g
      LEFT JOIN unnest($2::uuid[], $3::text[]) AS n(client_id, client_name) ON n.client_id = g.client_id
      WHERE g.user_id = $1::uuid AND (g.first_seen_at IS NOT NULL OR g.last_used_at IS NOT NULL)
     ON CONFLICT DO NOTHING`,
    deleteOldUsage: "DELETE FROM ai_daily_usage WHERE subject = $1::uuid::text AND usage_day < (now() AT TIME ZONE 'Asia/Tokyo')::date",
    deleteStub: 'DELETE FROM auth.users WHERE id = $1::uuid',
});

/** Only files the upload route wrote: public/uploads/<13-digit Date.now()>-<one path segment>. */
const UPLOAD_PATH = /^public\/uploads\/[0-9]{13}-[^/\\]+$/;
/** SQLSTATE lock_not_available (lock_timeout). */
const LOCK_TIMEOUT = '55P03';

/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<any> }} Queryable */
/** @typedef {Queryable & { connect?: () => Promise<Queryable & { release: (error?: unknown) => void }> }} DeletionPool */
/** @typedef {{ config: { live?: boolean } | null, stripe: import('./stripeClient.js').StripeClient | null }} BillingDeps */
/** @typedef {Pick<Console, 'log' | 'warn'>} Logger */
/**
 * @typedef {{ status: 'deleted' | 'already', deletedAt: string | null }
 *   | { status: 'refused', reason: 'invalid_user' | 'subscription_active' | 'payment_provider_unavailable' | 'memory_service_unavailable', memoryDeleted: boolean }
 *   | { status: 'failed', reason: 'account_busy' | 'deletion_unavailable', memoryDeleted: boolean }} DeletionResult
 */

/** 8 characters of an id, for log lines. @param {string} id */
const tag = (id) => `${id.slice(0, 8)}…`;

/** @param {unknown} value @returns {string | null} */
const toIso = (value) => {
    if (!value) return null;
    const ms = new Date(/** @type {any} */ (value)).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** The most app names one deletion takes (server/routes/account.js caps the body the same way). */
export const DELETION_APP_NAMES_MAX = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The app names for copyGrants: lower-case UUID ids, string names of at most 100 characters (the
 * route cleaned them), one per id, at most DELETION_APP_NAMES_MAX; anything else is left out.
 * @param {unknown} appNames
 * @returns {{ ids: string[], names: string[] }}
 */
export function appNameParams(appNames) {
    /** @type {Map<string, string>} */
    const byId = new Map();
    for (const entry of Array.isArray(appNames) ? appNames : []) {
        if (byId.size >= DELETION_APP_NAMES_MAX) break;
        const clientId = typeof entry?.clientId === 'string' ? entry.clientId.toLowerCase() : '';
        const clientName = entry?.clientName;
        if (!UUID.test(clientId) || byId.has(clientId) || typeof clientName !== 'string' || !clientName || Array.from(clientName).length > 100) continue;
        byId.set(clientId, clientName);
    }
    return { ids: [...byId.keys()], names: [...byId.values()] };
}

/**
 * A subscription that will charge again: not ended, and no cancellation scheduled (neither
 * cancel_at_period_end nor cancel_at). The same rule for a local row and a Stripe object.
 * @param {{ status?: unknown, cancel_at_period_end?: unknown, cancel_at?: unknown } | null | undefined} sub
 */
export const isRenewing = (sub) => Boolean(sub)
    && !TERMINAL_STATUSES.includes(String(sub?.status))
    && sub?.cancel_at_period_end !== true
    && (sub?.cancel_at === null || sub?.cancel_at === undefined);

/**
 * Whether this api runs in Stripe live mode: a Stripe client (billing serviceable) and config.live
 * true. Only then are test-mode plan rows left out (PLAN_ROWS); with the mode unknown every row counts.
 * @param {BillingDeps | undefined} billing
 */
export const liveApi = (billing) => Boolean(billing?.stripe) && billing?.config?.live === true;

/**
 * What the delete page shows before asking for the password (local copy only; Stripe is read at
 * the deletion itself), with the same rows as the deletion's own check. Throws on a database error.
 * @param {{ pool: Queryable, userId: unknown, billing?: BillingDeps }} input
 * @returns {Promise<{ subscription: 'none' | 'renewing' | 'ending' }>}
 */
export async function readDeletionState({ pool, userId, billing = { config: null, stripe: null } }) {
    const id = canonicalUserId(userId);
    if (!id) throw new TypeError('readDeletionState: the account id is not a UUID');
    const rows = (await pool.query(SQL.openSubscriptions, [id, liveApi(billing)]))?.rows ?? [];
    return { subscription: rows.some(isRenewing) ? 'renewing' : rows.length ? 'ending' : 'none' };
}

/**
 * Removes one collected upload: only a path the upload route writes, resolved inside
 * <uploadRoot>/public/uploads, and only a regular file (never a symlink or a directory).
 * @param {unknown} storagePath
 * @param {string} uploadRoot
 * @returns {Promise<'removed' | 'missing' | 'refused' | 'failed'>}
 */
export async function removeUploadFile(storagePath, uploadRoot) {
    if (typeof storagePath !== 'string' || !UPLOAD_PATH.test(storagePath) || storagePath.includes('\0')) return 'refused';
    const dir = path.resolve(uploadRoot, 'public/uploads') + path.sep;
    const file = path.resolve(uploadRoot, storagePath);
    if (!file.startsWith(dir)) return 'refused';
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile()) return 'refused';
        await fs.unlink(file);
        return 'removed';
    } catch (error) {
        return /** @type {any} */ (error)?.code === 'ENOENT' ? 'missing' : 'failed';
    }
}

/**
 * Stripe answers 400 for a Session that is no longer open (it completed or expired meanwhile) and
 * 404 for one that no longer exists. Every other failure (401 or 403: the key lost Checkout
 * Sessions write; 429; 5xx; a timeout or network error) means the Session may still be payable.
 * @param {unknown} error
 */
const sessionNoLongerOpen = (error) => {
    const status = /** @type {any} */ (error)?.status;
    return status === 400 || status === 404;
};

/**
 * Stripe's answer to a list filtered by a Customer it does not have (deleted in the Dashboard, or
 * by "Delete all test data"): 400 or 404 with code resource_missing (the list's only object
 * parameter is the Customer). Such a Customer has no Session and no subscription at Stripe. A 404
 * without that code (a wrong URL), 401, 403, 429, 5xx, other 400s and network errors still count
 * as failures.
 * @param {unknown} error
 */
const customerMissing = (error) => {
    const e = /** @type {any} */ (error);
    return e?.code === 'resource_missing' && (e?.status === 400 || e?.status === 404);
};

/**
 * Expires every open Checkout Session of a Customer (a Session opened before the deletion stays
 * payable for up to 32 minutes, server/routes/billing.js). A Session that is no longer open is
 * fine: the subscription read that follows sees a completed one. Any other Stripe failure throws,
 * and so does a fourth page of open Sessions.
 * @param {import('./stripeClient.js').StripeClient} stripe @param {string} customer
 */
async function expireOpenCheckoutSessions(stripe, customer) {
    for (let page = 0; page < 3; page += 1) {
        const open = await stripe.listCheckoutSessions({ customer, status: 'open' });
        for (const session of open?.data ?? []) {
            if (typeof session?.id !== 'string') continue;
            try {
                await stripe.expireCheckoutSession(session.id);
            } catch (error) {
                if (!sessionNoLongerOpen(error)) throw error;
            }
        }
        if (!open?.has_more) return;
    }
    throw new Error('more open Checkout Sessions than three pages');
}

/**
 * The Stripe Customer ids of this api's mode among billing_customers rows.
 * @param {any[]} rows @param {BillingDeps | undefined} billing
 */
const customersOfMode = (rows, billing) => {
    const live = billing?.config?.live;
    return billing?.stripe && typeof live === 'boolean'
        ? rows.filter((c) => c?.livemode === live && typeof c?.stripe_customer_id === 'string').map((c) => String(c.stripe_customer_id))
        : [];
};

/**
 * The renewing check at Stripe for each Customer of this api's mode: open Checkout Sessions
 * expired, then every subscription read. 'renewing' when one would charge again. A Customer that
 * Stripe no longer has (customerMissing) has nothing there: onMissing() and the next one.
 * @param {import('./stripeClient.js').StripeClient} stripe @param {string[]} customers @param {() => void} onMissing
 * @returns {Promise<'renewing' | 'clear'>}
 */
async function checkAtStripe(stripe, customers, onMissing) {
    for (const customer of customers) {
        /** @type {any} */
        let list;
        try {
            await expireOpenCheckoutSessions(stripe, customer);
            list = await stripe.listSubscriptions({ customer, status: 'all' });
        } catch (error) {
            if (!customerMissing(error)) throw error;
            onMissing();
            continue;
        }
        if (list?.has_more) throw new Error('more subscriptions than one page');
        if ((list?.data ?? []).some(isRenewing)) return 'renewing';
    }
    return 'clear';
}

/**
 * Step 4's network re-checks, best effort (each failure is logged; nothing is undone), never
 * throws: for each Customer, open Checkout Sessions expired again and the subscriptions read again
 * (a renewing one, paid between step 1 and COMMIT, raises the owner alert deleted_account_renewing:
 * a log line alone is lost when a deploy recreates the api container); then Memanto again.
 * @param {{ id: string, stripe: import('./stripeClient.js').StripeClient | null, customers: string[], memory: { purge: (input: { pool: any, userId: string }) => Promise<any> } | null, pool: unknown, logger: Logger, alerts: Pick<import('./billingAlerts.js').BillingAlerts, 'alert'> }} input
 */
async function recheckAfterCommit({ id, stripe, customers, memory, pool, logger, alerts }) {
    if (stripe && customers.length) {
        let expiryFailed = false;
        let renewing = false;
        let readFailed = false;
        for (const customer of customers) {
            try {
                await expireOpenCheckoutSessions(stripe, customer);
            } catch (error) {
                if (!customerMissing(error)) expiryFailed = true;
            }
            // A Session paid between step 1 and COMMIT is a subscription now; when its webhook came
            // after the plan check inside the transaction, nothing refused the deletion. Staff are told.
            try {
                const list = await stripe.listSubscriptions({ customer, status: 'all' });
                if ((list?.data ?? []).some(isRenewing)) renewing = true;
                else if (list?.has_more) readFailed = true;
            } catch (error) {
                if (!customerMissing(error)) readFailed = true;
            }
        }
        if (expiryFailed) logger.warn(`[Account] could not expire checkout sessions after deleting ${tag(id)}`);
        if (renewing) {
            try {
                alerts.alert('deleted_account_renewing', tag(id), `a renewing subscription exists after deleting ${tag(id)}: cancel it in the Stripe Dashboard`);
            } catch {
                logger.warn(`[Account] a renewing subscription exists after deleting ${tag(id)} (cancel it in the Stripe Dashboard)`);
            }
        }
        if (readFailed) logger.warn(`[Account] could not re-check subscriptions at Stripe after deleting ${tag(id)}`);
    }
    if (memory) {
        try {
            const again = await memory.purge({ pool, userId: id });
            if (!again?.ok) logger.warn(`[Account] could not re-check AI memories after deleting ${tag(id)}`);
        } catch {
            logger.warn(`[Account] could not re-check AI memories after deleting ${tag(id)}`);
        }
    }
}

/**
 * Whether `work` settled within `ms`. The timer is cleared when it does, and never keeps the
 * process alive on its own.
 * @param {Promise<unknown>} work @param {number} ms
 * @returns {Promise<boolean>}
 */
async function settlesWithin(work, ms) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
        timer?.unref?.();
    });
    try {
        return /** @type {boolean} */ (await Promise.race([work.then(() => true, () => true), deadline]));
    } finally {
        clearTimeout(timer);
    }
}

const defaultMemory = Object.freeze({ enabled: isMemantoEnabled, purge: purgeLearnerMemories });
/** @param {string} id */
const defaultInvalidate = (id) => {
    invalidateAiAccess(id);
    invalidatePlan(id);
};

/**
 * @param {{
 *   pool?: DeletionPool | null,
 *   userId: unknown,
 *   requestedBy: 'self' | 'staff' | 'orphan',
 *   authTime?: number | null,
 *   appNames?: ReadonlyArray<{ clientId: string, clientName: string }>,
 *   billing?: BillingDeps,
 *   alerts?: Pick<import('./billingAlerts.js').BillingAlerts, 'alert'>,
 *   logger?: Logger,
 *   uploadRoot?: string,
 *   memory?: { enabled: () => boolean, purge: (input: { pool: any, userId: string }) => Promise<any> },
 *   invalidateCaches?: (id: string) => void,
 *   now?: () => number,
 *   afterCommitWaitMs?: number,
 * }} input
 *   authTime: the session's sign-in time (tools/core/oauthToken.js sessionAuthTime) for a
 *   deletion from Settings; null for staff. A tombstone that is not re-opened answers 'already'
 *   when authTime is null or not later than deleted_at + 30 s (the same rule as sign-in).
 *   appNames: the names of the learner's AI apps as the delete page read them from Supabase
 *   (server/routes/account.js); used only for a grant row without a name. Staff: none.
 *   alerts: the billing owner alerts (a renewing subscription found after COMMIT).
 *   memory, invalidateCaches, now, afterCommitWaitMs: test seams (Memanto, this process's caches,
 *   the clock, how long the answer waits for the re-checks after COMMIT).
 * @returns {Promise<DeletionResult>}
 */
export async function deleteAccountData({
    pool = getPool(),
    userId,
    requestedBy,
    authTime = null,
    appNames = [],
    billing = { config: null, stripe: null },
    alerts = defaultBillingAlerts,
    logger = console,
    uploadRoot = PROJECT_ROOT,
    memory = defaultMemory,
    invalidateCaches = defaultInvalidate,
    now = Date.now,
    afterCommitWaitMs = AFTER_COMMIT_WAIT_MS,
}) {
    const started = now();
    if (!DELETION_REQUESTERS.includes(requestedBy)) throw new TypeError(`deleteAccountData: requestedBy must be one of ${DELETION_REQUESTERS.join(', ')}`);
    // 0. Canonical id: every statement gets the lower-case id and casts it, so the lock key equals
    // the trigger's and ai_daily_usage.subject (the id as the caps stored it) matches.
    const id = canonicalUserId(userId);
    if (!id || id === canonicalUserId(PHASE1_USER_ID)) return { status: 'refused', reason: 'invalid_user', memoryDeleted: false };
    if (!pool) return { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: false };

    // 1. Every refusal check, before anything is deleted.
    /** @type {string[]} */
    let stripeCustomers = [];
    const live = liveApi(billing);
    try {
        const tombstone = (await pool.query(SQL.tombstone, [id]))?.rows?.[0];
        if (tombstone && !tombstone.reopened_at && signedInBeforeDeletion(authTime, tombstone.deleted_at)) {
            return { status: 'already', deletedAt: toIso(tombstone.deleted_at) };
        }
        if ((await pool.query(SQL.renewingLocal, [id, live]))?.rows?.length) {
            return { status: 'refused', reason: 'subscription_active', memoryDeleted: false };
        }
        const customers = (await pool.query(SQL.customers, [id]))?.rows ?? [];
        const stripe = billing?.stripe ?? null;
        stripeCustomers = customersOfMode(customers, billing);
        if (customers.length > stripeCustomers.length) {
            // Without a Stripe client or a known mode (config.live) no Customer is checked at Stripe.
            const modeKnown = Boolean(stripe) && typeof billing?.config?.live === 'boolean';
            logger.warn(`[Account] renewing check used the local copy only (${modeKnown ? 'a customer of the other Stripe mode' : 'billing not serviceable'})`);
        }
        if (stripe && stripeCustomers.length) {
            let atStripe;
            try {
                atStripe = await checkAtStripe(stripe, stripeCustomers, () => {
                    logger.warn(`[Account] a Stripe customer of ${tag(id)} no longer exists at Stripe (nothing to check there)`);
                });
            } catch (error) {
                logger.warn(`[Account] could not check the plan at Stripe for ${tag(id)} (${/** @type {any} */ (error)?.name ?? 'Error'} ${/** @type {any} */ (error)?.status ?? ''}): nothing deleted`);
                return { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false };
            }
            if (atStripe === 'renewing') return { status: 'refused', reason: 'subscription_active', memoryDeleted: false };
        }
    } catch (error) {
        logger.warn(`[Account] deletion checks failed for ${tag(id)} (${/** @type {any} */ (error)?.code ?? 'error'}): nothing deleted`);
        return { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: false };
    }

    // 2. Memanto before anything else is deleted (no HTTP call inside the transaction below).
    const memoryOn = memory.enabled();
    if (memoryOn) {
        let purge;
        try {
            purge = await memory.purge({ pool, userId: id });
        } catch (error) {
            // Memanto answered (its errors are caught inside); the meta row delete then failed.
            logger.warn(`[Account] partial: AI memories deleted, other data kept for ${tag(id)} (deletion_unavailable)`);
            return { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: true };
        }
        if (!purge?.ok) return { status: 'refused', reason: 'memory_service_unavailable', memoryDeleted: false };
    }
    /** @param {'subscription_active'} reason */
    const refusedLate = (reason) => {
        if (memoryOn) logger.warn(`[Account] partial: AI memories deleted, other data kept for ${tag(id)} (${reason})`);
        return /** @type {DeletionResult} */ ({ status: 'refused', reason, memoryDeleted: memoryOn });
    };
    /** @param {'account_busy' | 'deletion_unavailable'} reason */
    const failedLate = (reason) => {
        if (memoryOn) logger.warn(`[Account] partial: AI memories deleted, other data kept for ${tag(id)} (${reason})`);
        return /** @type {DeletionResult} */ ({ status: 'failed', reason, memoryDeleted: memoryOn });
    };

    // 3. One transaction under the exclusive account lock.
    if (typeof pool.connect !== 'function') return failedLate('deletion_unavailable');
    let client;
    try {
        client = await pool.connect();
    } catch (error) {
        logger.warn(`[Account] deletion failed for ${tag(id)} (no database connection)`);
        return failedLate('deletion_unavailable');
    }
    /** @type {unknown[]} */
    let paths = [];
    /** @type {unknown} */
    let deletedAt = null;
    /** @type {unknown} */
    let releaseError;
    try {
        await client.query('BEGIN');
        await client.query(SQL.lockTimeout);
        await client.query(SQL.statementTimeout);
        await client.query(SQL.lock, [id]);
        await client.query(SQL.lockStub, [id]);
        await client.query(SQL.lockConsents, [id]);
        await client.query(SQL.lockGrants, [id]);
        const tombstone = (await client.query(SQL.tombstoneForUpdate, [id]))?.rows?.[0];
        if (tombstone && !tombstone.reopened_at && signedInBeforeDeletion(authTime, tombstone.deleted_at)) {
            // Another request deleted it while this one waited for the lock.
            await client.query('ROLLBACK');
            return { status: 'already', deletedAt: toIso(tombstone.deleted_at) };
        }
        if ((await client.query(SQL.renewingLocal, [id, live]))?.rows?.length) {
            // A subscription synced between the checks above and the lock.
            await client.query('ROLLBACK');
            return refusedLate('subscription_active');
        }
        paths = ((await client.query(SQL.uploads, [id]))?.rows ?? []).map((row) => row?.storage_path);
        deletedAt = (await client.query(SQL.writeTombstone, [id, requestedBy]))?.rows?.[0]?.deleted_at ?? null;
        if (!deletedAt) throw Object.assign(new Error('the tombstone was not written'), { code: 'no_tombstone' });
        // The proofs take deleted_at from the tombstone row itself (TOMBSTONE_TIME), not from JavaScript.
        await client.query(SQL.markAcceptances, [id]);
        await client.query(SQL.copyConsents, [id]);
        const apps = appNameParams(appNames);
        await client.query(SQL.copyGrants, [id, apps.ids, apps.names]);
        await client.query(SQL.deleteOldUsage, [id]);
        // The Customers again, just before the stub (its cascade sets their user_id NULL): a checkout
        // that passed requireAuth before this deletion may have stored one after step 1, and its
        // Session is expired after COMMIT with the others.
        for (const customer of customersOfMode((await client.query(SQL.customers, [id]))?.rows ?? [], billing)) {
            if (!stripeCustomers.includes(customer)) stripeCustomers.push(customer);
        }
        await client.query(SQL.deleteStub, [id]);
        await client.query('COMMIT');
    } catch (error) {
        const code = /** @type {any} */ (error)?.code;
        await client.query('ROLLBACK').catch((rollbackError) => {
            releaseError = rollbackError;
        });
        logger.warn(`[Account] deletion rolled back for ${tag(id)} (${code ?? 'error'}: ${String(/** @type {any} */ (error)?.message ?? '').slice(0, 200)})`);
        return failedLate(code === LOCK_TIMEOUT ? 'account_busy' : 'deletion_unavailable');
    } finally {
        client.release(releaseError);
    }

    // 4. After COMMIT: best effort, never undone.
    let removed = 0;
    for (const storagePath of paths) {
        const outcome = await removeUploadFile(storagePath, uploadRoot);
        if (outcome === 'removed' || outcome === 'missing') removed += 1;
    }
    if (paths.length > removed) logger.warn(`[Account] ${paths.length - removed} upload file(s) of ${tag(id)} not removed (retention removes orphans)`);
    try {
        invalidateCaches(id);
    } catch {
        // caches expire on their own (60 s)
    }
    // The data is gone: a slow Stripe (8 s per call) or a hanging Memanto must not hold the answer.
    const rechecks = recheckAfterCommit({
        id,
        stripe: billing?.stripe ?? null,
        customers: stripeCustomers,
        memory: memoryOn ? memory : null,
        pool,
        logger,
        alerts,
    });
    if (!(await settlesWithin(rechecks, afterCommitWaitMs))) {
        logger.warn(`[Account] re-checks after deleting ${tag(id)} did not finish within ${afterCommitWaitMs} ms: answered without them (they log their own result)`);
    }
    logger.log(`[Account] Rise Path data deleted for ${tag(id)} (${requestedBy}; files ${removed}/${paths.length}; memory ${memoryOn ? 'deleted' : 'skipped'}) in ${Math.max(0, now() - started)}ms`);
    return { status: 'deleted', deletedAt: toIso(deletedAt) };
}
