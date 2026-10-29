// @ts-check
/**
 * Accepting the terms of use (Phase 4, owner decisions D1 and D5; design §4.4). Mounted by
 * server.js at /api/v2/user/legal behind requireAuth and requireSignedIn (the dev fallback, the
 * bridge user and an anonymous user get 401 sign_in_required; an agent's own OAuth token 401
 * oauth_client_token), with its own 4 kb JSON body parser registered before the 50 MB one
 * (server/middleware/smallBody.js: 413 body_too_large, 400 invalid_body).
 *
 * The versions are shared/legal/versions.js (one module for the browser and the server). What a
 * person accepts is recorded with three fields only (D5): account id, versions, time. No IP
 * address, user agent, email or name.
 *
 * GET  / → 200 { ok, published, current: { terms, privacy }, accepted, acceptedAt, lastAccepted, notice }
 *      published: neither current version is a draft. The newest live acceptance of this account
 *      (rows of an earlier, deleted account under the same id carry account_deleted_at and never
 *      count) is `accepted` when its versions are among acceptableLegalVersions() (from the newest
 *      version that requires acceptance up to the current one). notice: the documents whose current
 *      version differs from the accepted one (only when accepted), with their effective date; the
 *      browser shows a dismissible bar for them instead of the re-consent page.
 *      lastAccepted: { termsVersion, privacyVersion, acceptedAt } of that row, or null.
 * POST /acceptance body { termsVersion, privacyVersion } (the versions the person was shown).
 *      Per-learner limit 10/min (429 rate_limited). In order: 400 invalid_body; 409
 *      legal_not_published in production while a current version is a draft (no draft ever
 *      reaches the production archive); 409 legal_version_mismatch with `current` when either
 *      differs from the current versions (the text changed while the page was open); then one
 *      transaction under the shared account lock, so it waits for a deletion in progress and never
 *      writes a proof for an account deleted meanwhile (findings 3, 10; verify script R9):
 *        the version rows (append only; an id stored with another hash → 500
 *        legal_version_conflict), the acceptance (only while the auth.users stub exists;
 *        idempotent: 201 inserted, 200 it already existed), and when nothing was inserted and
 *        nothing existed: a deleted account → 401 account_deleted, anything else → 503.
 *      503 legal_unavailable on a database error, never the driver's text.
 *      After a 201 or 200 the terms check's answer for this learner is dropped
 *      (invalidateTermsAcceptance, Phase 8), so their next call passes at once.
 *
 * Both routes are exempt from the terms check (server/middleware/termsGate.js TERMS_EXEMPT).
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../db.js';
import { ACCOUNT_DELETED_REFUSAL } from '../middleware/auth.js';
import { accountLockKey, canonicalUserId } from '../../tools/core/accountDeletions.js';
import { LATEST_ACCEPTANCE_SQL } from '../../tools/core/legalAcceptance.js';
import { invalidateTermsAcceptance } from '../middleware/termsGate.js';
import {
    LEGAL_DOCUMENTS,
    LEGAL_DOCUMENT_NAMES,
    LEGAL_HISTORY,
    acceptanceCounts,
    acceptableLegalVersions,
    currentLegalVersions,
    isDraftLegalVersion,
    legalVersionDocument,
} from '../../shared/legal/versions.js';

/** Largest body (two version ids). */
export const LEGAL_BODY_LIMIT = '4kb';
/** Acceptance attempts per learner per minute. */
export const LEGAL_ACCEPTANCES_PER_MINUTE = 10;
/** How long the acceptance waits for the account lock (a deletion in progress) before giving up. */
export const LEGAL_LOCK_TIMEOUT = '10s';

/** The statements, exactly as sent ($1 is the canonical account id, except for the two version statements). */
export const LEGAL_SQL = Object.freeze({
    // The newest live acceptance: the same statement as the terms check (tools/core/legalAcceptance.js).
    latest: LATEST_ACCEPTANCE_SQL,
    lockTimeout: `SET LOCAL lock_timeout = '${LEGAL_LOCK_TIMEOUT}'`,
    // Waits for a deletion in progress: the deletion holds the exclusive lock on the same key.
    lock: `SELECT pg_advisory_xact_lock_shared(${accountLockKey(1)})`,
    // Parameters of their own (every $n must be used): $1 terms, $2 privacy, $3 and $4 their hashes.
    insertVersions: "INSERT INTO legal_document_versions (version, document, sha256) VALUES ($1, 'terms', $3), ($2, 'privacy', $4) ON CONFLICT (version) DO NOTHING",
    readVersions: 'SELECT version, sha256 FROM legal_document_versions WHERE version IN ($1, $2)',
    // Only while the stub exists: a deleted account has none (migration 018's trigger keeps it away).
    insertAcceptance: 'INSERT INTO legal_acceptances (user_id, terms_version, privacy_version) SELECT $1::uuid, $2, $3 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) ON CONFLICT (user_id, terms_version, privacy_version) WHERE account_deleted_at IS NULL DO NOTHING RETURNING accepted_at',
    existingAcceptance: 'SELECT accepted_at FROM legal_acceptances WHERE user_id = $1::uuid AND terms_version = $2 AND privacy_version = $3 AND account_deleted_at IS NULL',
    deletedAccount: 'SELECT 1 FROM account_deletions WHERE user_id = $1::uuid AND reopened_at IS NULL',
});

const UNAVAILABLE = Object.freeze({ error: 'The terms cannot be checked right now. Please try again later.', error_type: 'legal_unavailable' });

/** @param {import('express').Response} res @param {number} status @param {Record<string, unknown>} body */
const answer = (res, status, body) => {
    if (status === 503) res.set('Retry-After', '60');
    return res.status(status).json(body);
};

/** @param {unknown} value */
const iso = (value) => {
    if (!value) return null;
    const date = new Date(/** @type {any} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Whether an acceptance still counts: the shared rule (shared/legal/versions.js), kept exported here. */
export { acceptanceCounts };

/**
 * The GET answer for the newest live acceptance row (or none).
 * @param {{ terms_version: string, privacy_version: string, accepted_at: unknown } | undefined} row
 * @param {{ documents?: typeof LEGAL_DOCUMENTS, acceptable?: (document: 'terms' | 'privacy') => string[] | null }} [sources]
 */
export function legalStatus(row, { documents = LEGAL_DOCUMENTS, acceptable = acceptableLegalVersions } = {}) {
    const current = { terms: documents.terms.version, privacy: documents.privacy.version };
    const accepted = acceptanceCounts(row, acceptable);
    const rowVersions = row ? { terms: row.terms_version, privacy: row.privacy_version } : null;
    const notice = accepted && rowVersions
        ? LEGAL_DOCUMENT_NAMES.filter((document) => rowVersions[document] !== current[document]).map((document) => ({
            document,
            version: current[document],
            effectiveDate: documents[document].effectiveDate,
        }))
        : [];
    return {
        ok: true,
        published: !isDraftLegalVersion(current.terms) && !isDraftLegalVersion(current.privacy),
        current,
        accepted,
        acceptedAt: accepted ? iso(row?.accepted_at) : null,
        lastAccepted: row ? { termsVersion: row.terms_version, privacyVersion: row.privacy_version, acceptedAt: iso(row.accepted_at) } : null,
        notice,
    };
}

/**
 * The body's versions, or null when they are not two version ids of the right documents.
 * @param {unknown} body
 * @returns {{ termsVersion: string, privacyVersion: string } | null}
 */
export function readAcceptanceBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const { termsVersion, privacyVersion } = /** @type {Record<string, unknown>} */ (body);
    if (typeof termsVersion !== 'string' || typeof privacyVersion !== 'string') return null;
    if (legalVersionDocument(termsVersion) !== 'terms' || legalVersionDocument(privacyVersion) !== 'privacy') return null;
    return { termsVersion, privacyVersion };
}

/** @param {import('express').Request} req */
const userIdOf = (req) => String(/** @type {any} */ (req).userId ?? '');

/**
 * @param {{
 *   getPool?: () => any,
 *   documents?: typeof LEGAL_DOCUMENTS,
 *   history?: typeof LEGAL_HISTORY,
 *   env?: Record<string, string | undefined>,
 *   logger?: Pick<Console, 'warn'>,
 *   invalidateAcceptance?: (userId: string) => void,
 * }} [options]
 *   documents, history: the version tables (tests pass released or changed ones; the app uses
 *   shared/legal/versions.js)
 *   invalidateAcceptance: called after a recorded acceptance (201 or 200), so the terms check
 *   (server/middleware/termsGate.js) reads it again on the learner's next call
 */
export function createLegalRouter({
    getPool: poolFn = getPool,
    documents = LEGAL_DOCUMENTS,
    history = LEGAL_HISTORY,
    env = process.env,
    logger = console,
    invalidateAcceptance = invalidateTermsAcceptance,
} = {}) {
    const router = express.Router();
    const current = () => (documents === LEGAL_DOCUMENTS ? currentLegalVersions() : { terms: documents.terms.version, privacy: documents.privacy.version });
    /** @param {'terms' | 'privacy'} document */
    const acceptable = (document) => acceptableLegalVersions(document, { documents, history });

    const limitAcceptance = rateLimit({
        windowMs: 60 * 1000,
        limit: LEGAL_ACCEPTANCES_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `legal:${canonicalUserId(userIdOf(req)) ?? userIdOf(req)}`,
        message: { error: 'Too many tries. Please wait a minute and try again.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    router.get('/', async (req, res) => {
        const pool = poolFn();
        const userId = canonicalUserId(userIdOf(req));
        if (!pool || !userId) return answer(res, 503, UNAVAILABLE);
        try {
            const { rows } = await pool.query(LEGAL_SQL.latest, [userId]);
            return res.json(legalStatus(rows?.[0], { documents, acceptable }));
        } catch (error) {
            logger.warn(`[Legal] status read failed (${/** @type {any} */ (error)?.code ?? 'error'})`);
            return answer(res, 503, UNAVAILABLE);
        }
    });

    router.post('/acceptance', limitAcceptance, async (req, res) => {
        const versions = readAcceptanceBody(req.body);
        if (!versions) {
            return answer(res, 400, { error: 'Send { "termsVersion": "terms-…", "privacyVersion": "privacy-…" }.', error_type: 'invalid_body' });
        }
        const now = current();
        if (env.NODE_ENV === 'production' && (isDraftLegalVersion(now.terms) || isDraftLegalVersion(now.privacy))) {
            return answer(res, 409, { error: 'These terms are not published yet.', error_type: 'legal_not_published' });
        }
        if (versions.termsVersion !== now.terms || versions.privacyVersion !== now.privacy) {
            return answer(res, 409, { error: 'The text has changed. Please read it again.', error_type: 'legal_version_mismatch', current: now });
        }
        const pool = poolFn();
        const userId = canonicalUserId(userIdOf(req));
        if (!pool || !userId) return answer(res, 503, UNAVAILABLE);

        const params = [userId, now.terms, now.privacy];
        const hashes = { [now.terms]: documents.terms.sha256, [now.privacy]: documents.privacy.sha256 };
        let client;
        try {
            client = await pool.connect();
        } catch (error) {
            logger.warn(`[Legal] acceptance failed (${/** @type {any} */ (error)?.code ?? 'error'})`);
            return answer(res, 503, UNAVAILABLE);
        }
        let open = false;
        // A failed ROLLBACK leaves the connection unusable: release(error) destroys it instead of handing
        // it to the next request (as tools/core/lessonProgress.js and server/services/accountDeletion.js).
        /** @type {unknown} */
        let broken = null;
        /** @param {number} status @param {Record<string, unknown>} body */
        const rollback = async (status, body) => {
            if (open) {
                await client.query('ROLLBACK').catch((/** @type {unknown} */ rollbackError) => {
                    broken = rollbackError ?? new Error('ROLLBACK failed');
                });
            }
            open = false;
            return answer(res, status, body);
        };
        try {
            // Open before BEGIN: a BEGIN that failed on a dead connection is then probed by ROLLBACK too.
            open = true;
            await client.query('BEGIN');
            await client.query(LEGAL_SQL.lockTimeout);
            await client.query(LEGAL_SQL.lock, [userId]);
            await client.query(LEGAL_SQL.insertVersions, [now.terms, now.privacy, documents.terms.sha256, documents.privacy.sha256]);
            const stored = (await client.query(LEGAL_SQL.readVersions, [now.terms, now.privacy])).rows ?? [];
            for (const version of [now.terms, now.privacy]) {
                const row = stored.find((r) => r.version === version);
                if (!row) return await rollback(503, UNAVAILABLE);
                if (row.sha256 !== hashes[version]) {
                    logger.warn(`[Legal] version ${version} is stored with another hash`);
                    return await rollback(500, { error: 'This version of the terms is stored with another text.', error_type: 'legal_version_conflict' });
                }
            }
            const inserted = (await client.query(LEGAL_SQL.insertAcceptance, params)).rows?.[0];
            if (inserted) {
                await client.query('COMMIT');
                open = false;
                invalidateAcceptance(userId);
                return res.status(201).json({ ok: true, accepted: true, acceptedAt: iso(inserted.accepted_at) });
            }
            const existing = (await client.query(LEGAL_SQL.existingAcceptance, params)).rows?.[0];
            if (existing) {
                await client.query('COMMIT');
                open = false;
                invalidateAcceptance(userId);
                return res.status(200).json({ ok: true, accepted: true, acceptedAt: iso(existing.accepted_at) });
            }
            // Nothing inserted and nothing there: the stub is gone. A deletion committed while this
            // request ran (it waited on the lock), or the stub could not be written at sign-in.
            const deleted = ((await client.query(LEGAL_SQL.deletedAccount, [userId])).rowCount ?? 0) > 0;
            if (deleted) return await rollback(401, { ...ACCOUNT_DELETED_REFUSAL });
            logger.warn(`[Legal] no account row for ${userId.slice(0, 8)}… (acceptance not recorded)`);
            return await rollback(503, UNAVAILABLE);
        } catch (error) {
            logger.warn(`[Legal] acceptance failed (${/** @type {any} */ (error)?.code ?? 'error'})`);
            return await rollback(503, UNAVAILABLE);
        } finally {
            client.release(/** @type {any} */ (broken ?? undefined));
        }
    });

    return router;
}

export default createLegalRouter;
