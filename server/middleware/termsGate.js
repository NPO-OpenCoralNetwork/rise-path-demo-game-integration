// @ts-check
/**
 * The terms check on the app API (Phase 8, S5; rules in tools/core/legalAcceptance.js). Off unless
 * LEGAL_TERMS_REQUIRED is on (and, in production, the current texts are released): then a real
 * learner's Supabase session that has not accepted the current terms gets
 *   403 { error, error_type: 'terms_required', current: { terms, privacy } }
 * on every route except TERMS_EXEMPT (method + exact path), and
 *   503 { error, error_type: 'legal_unavailable' } + Retry-After: 60 when the acceptance cannot be
 *   read (fail closed, as the AI access gate).
 * 403, never 401: the browser and the lesson sync read 401 as sign-in trouble.
 *
 * One choke point: the three auth middlewares (requireAuth and optionalAuth in auth.js,
 * requireBridgeOrAuth in bridgeAuth.js) call termsGateStep instead of next() after a Supabase
 * session was accepted. Auth runs per mount, per router and per route, so a check per mount would
 * miss routes; here every route a learner's session reaches is gated, and a new route is gated
 * until it is listed below (as the consent page gates every page outside LEGAL_GATE_EXEMPT,
 * App.tsx). Exempt a route only when the UI exempts its page or the app shell calls it there.
 *
 * Never gated: guests and anonymous callers, the dev fallbacks, the bridge (Hermes, the operator),
 * an anonymous Supabase user (isRealLearner: requireSignedIn's learner). The acceptance read is
 * cached per learner and account generation (accepted 60 s, not accepted 5 s); this process's own
 * acceptance (server/routes/legal.js) invalidates it at once.
 */
import { getPool, PHASE1_USER_ID } from '../db.js';
import { canonicalUserId } from '../../tools/core/accountDeletions.js';
import { LEGAL_DOCUMENTS, LEGAL_HISTORY, acceptableLegalVersions } from '../../shared/legal/versions.js';
import { createAcceptanceCache, termsAccepted, termsEnforcement, termsSwitchLine } from '../../tools/core/legalAcceptance.js';

/**
 * A real learner's Supabase session (the rule of requireSignedIn, server/middleware/signedIn.js):
 * not the dev fallback, not the bridge user (PHASE1_USER_ID), not an anonymous Supabase user.
 * @param {import('express').Request} req
 */
export const isRealLearner = (req) => {
    const r = /** @type {any} */ (req);
    const id = canonicalUserId(r.userId);
    return r.authMethod === 'supabase-jwt' && id !== null && id !== canonicalUserId(PHASE1_USER_ID) && r.isAnonymous !== true;
};

/** @typedef {Readonly<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, why: string }>} TermsExemptEntry */

/**
 * What a learner may still do without accepting: what the pages the consent page leaves open
 * (App.tsx PUBLIC_PATHS and LEGAL_GATE_EXEMPT) and the app shell call there. `:id` is one path
 * segment. Everything else is gated.
 * @type {readonly TermsExemptEntry[]}
 */
export const TERMS_EXEMPT = Object.freeze(/** @type {TermsExemptEntry[]} */ ([
    // Health and status probes (/api/v2/health is answered before any auth).
    { method: 'GET', path: '/api/v2/tts/health', why: 'health' },
    { method: 'GET', path: '/api/v2/agent/health', why: 'health' },
    { method: 'GET', path: '/api/v2/llm/status', why: 'status' },
    // Reading and accepting the terms: the consent page and the sign-up marker.
    { method: 'GET', path: '/api/v2/user/legal', why: 'legal read' },
    { method: 'POST', path: '/api/v2/user/legal/acceptance', why: 'legal accept' },
    // Account deletion (/settings/delete-account).
    { method: 'GET', path: '/api/v2/user/account/deletion', why: 'account deletion' },
    { method: 'POST', path: '/api/v2/user/account/deletion', why: 'account deletion' },
    // /settings/ai-access: reading it and withdrawing a guardian's AI consent (an age or a new
    // consent stays gated: neither is a withdrawal).
    { method: 'GET', path: '/api/v2/user/ai-access', why: 'AI access page' },
    { method: 'POST', path: '/api/v2/user/ai-access/guardian-consent/revoke', why: 'consent withdrawal' },
    // Connected apps (/settings/connected-apps).
    { method: 'GET', path: '/api/v2/user/connected-apps', why: 'connected apps' },
    { method: 'POST', path: '/api/v2/user/connected-apps/:id/revoke', why: 'connected apps' },
    // The plan: read, cancel (in the Stripe portal) and the sync after it (/settings/plan); a new
    // checkout stays gated.
    { method: 'GET', path: '/api/v2/billing/me', why: 'plan' },
    { method: 'POST', path: '/api/v2/billing/portal', why: 'plan cancel' },
    { method: 'POST', path: '/api/v2/billing/sync', why: 'plan' },
    // The learner's own lesson records: the sync's read, its upload (also the save before sign-out)
    // and the privacy delete. A one-lesson reset stays gated.
    { method: 'GET', path: '/api/v2/user/lesson-progress', why: 'own records' },
    { method: 'PUT', path: '/api/v2/user/lesson-progress', why: 'own records, sign-out' },
    { method: 'DELETE', path: '/api/v2/user/lesson-progress', why: 'privacy delete' },
    // The profile: the app shell reads it on every page; the display name right after sign-up; the
    // journal privacy switch of /settings/privacy.
    { method: 'GET', path: '/api/v2/user/profile', why: 'app shell' },
    { method: 'PUT', path: '/api/v2/user/profile', why: 'app shell, privacy' },
    // /settings/privacy: the life journal's privacy, export and delete.
    { method: 'GET', path: '/api/v2/life-journal/privacy', why: 'privacy' },
    { method: 'GET', path: '/api/v2/life-journal/export', why: 'privacy' },
    { method: 'DELETE', path: '/api/v2/life-journal/data', why: 'privacy delete' },
    // /settings/privacy and /settings/ai-memory: the AI memory's privacy, list and deletes.
    { method: 'GET', path: '/api/v2/learner-memory/privacy', why: 'privacy' },
    { method: 'PUT', path: '/api/v2/learner-memory/privacy', why: 'privacy' },
    { method: 'GET', path: '/api/v2/learner-memory', why: 'privacy' },
    { method: 'DELETE', path: '/api/v2/learner-memory', why: 'privacy delete' },
    { method: 'DELETE', path: '/api/v2/learner-memory/:id', why: 'privacy delete' },
    // Reporting a harmful AI answer always works.
    { method: 'POST', path: '/api/v2/safety/reports', why: 'safety' },
]).map((entry) => Object.freeze(entry)));

/** @param {string} path */
const patternOf = (path) => new RegExp(`^${path.split('/').map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
const EXEMPT_MATCHERS = TERMS_EXEMPT.map((entry) => ({ method: entry.method, test: patternOf(entry.path) }));

/**
 * Whether a request is exempt: HEAD counts as GET; the path is the URL without its query, in lower
 * case and without a trailing '/' (Express matches routes that way), compared whole (a path that
 * only starts with an exempt one, such as /api/v2/user/legal/../achievements, is gated).
 * @param {string} method
 * @param {string} originalUrl
 */
export function termsExempt(method, originalUrl) {
    const verb = String(method ?? '').toUpperCase() === 'HEAD' ? 'GET' : String(method ?? '').toUpperCase();
    let path = String(originalUrl ?? '').split('?')[0].toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return EXEMPT_MATCHERS.some((entry) => entry.method === verb && entry.test.test(path));
}

const REFUSAL_MESSAGES = Object.freeze({
    terms_required: 'Accept the current terms of use to continue.',
    legal_unavailable: 'The terms cannot be checked right now. Please try again later.',
});
const WARN_INTERVAL_MS = 60_000;

/**
 * Startup lines for server.js: nothing while LEGAL_TERMS_REQUIRED is unset or off.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ documents?: typeof LEGAL_DOCUMENTS }} [sources]
 * @returns {string[]}
 */
export function legalStartupWarnings(env = process.env, { documents = LEGAL_DOCUMENTS } = {}) {
    const line = termsSwitchLine(env, { label: '[Legal]', documents });
    return line ? [line] : [];
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   documents?: typeof LEGAL_DOCUMENTS,
 *   history?: typeof LEGAL_HISTORY,
 *   query?: (sql: string, params: unknown[]) => Promise<{ rows?: any[] }>,
 *   cache?: import('../../tools/core/legalAcceptance.js').AcceptanceCache,
 *   logger?: Pick<Console, 'warn'>,
 *   now?: () => number,
 * }} [options]  env is read on every request (tests flip process.env)
 */
export function createTermsGate({
    env = process.env,
    documents = LEGAL_DOCUMENTS,
    history = LEGAL_HISTORY,
    query = async (sql, params) => {
        const pool = getPool();
        if (!pool) throw new Error('no database');
        return pool.query(sql, params);
    },
    now = Date.now,
    cache = createAcceptanceCache({ now }),
    logger = console,
} = {}) {
    /** @param {'terms' | 'privacy'} document */
    const acceptable = (document) => acceptableLegalVersions(document, { documents, history });
    let lastWarnAt = Number.NEGATIVE_INFINITY;

    return {
        /**
         * Called by the auth middlewares instead of next() once a session was accepted. Calls
         * next() at once (synchronously) while the check is off, for anyone but a real learner and
         * on an exempt route.
         * @param {import('express').Request} req @param {import('express').Response} res @param {import('express').NextFunction} next
         */
        step(req, res, next) {
            if (!termsEnforcement(env, { documents }).on || !isRealLearner(req) || termsExempt(req.method, req.originalUrl)) return next();
            const r = /** @type {any} */ (req);
            const userId = /** @type {string} */ (canonicalUserId(r.userId));
            const variant = String(r.accountGeneration ?? '');
            return cache.get(userId, variant, () => termsAccepted(userId, { query, acceptable })).then(
                (accepted) => {
                    if (accepted) return next();
                    res.status(403).json({
                        error: REFUSAL_MESSAGES.terms_required,
                        error_type: 'terms_required',
                        current: { terms: documents.terms.version, privacy: documents.privacy.version },
                    });
                },
                (error) => {
                    const t = now();
                    if (t - lastWarnAt >= WARN_INTERVAL_MS) {
                        lastWarnAt = t;
                        logger.warn(`[Legal] terms check unavailable (${error?.code ?? 'error'}); signed-in calls answer 503 legal_unavailable`);
                    }
                    res.set('Retry-After', '60');
                    res.status(503).json({ error: REFUSAL_MESSAGES.legal_unavailable, error_type: 'legal_unavailable' });
                },
            );
        },
        /** This learner's acceptance was just recorded: the next call reads it again. @param {unknown} userId */
        invalidate(userId) {
            const id = canonicalUserId(userId);
            if (id) cache.invalidate(id);
        },
    };
}

/** The app's gate (one per process). */
const pageGate = createTermsGate();

/** @type {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} */
export const termsGateStep = (req, res, next) => pageGate.step(req, res, next);

/** After an acceptance this process recorded (server/routes/legal.js). @param {unknown} userId */
export const invalidateTermsAcceptance = (userId) => pageGate.invalidate(userId);
