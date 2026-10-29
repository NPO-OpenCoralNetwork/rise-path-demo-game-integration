// @ts-check
/**
 * The terms check on the API and the remote MCP endpoint (Phase 8, S5; ai-access-plan §8.3/§8.4
 * terms_required). The consent page (App.tsx, components/legal/) asks every signed-in learner to
 * accept the current terms; with the server switch LEGAL_TERMS_REQUIRED on, the server refuses too:
 * the app API with 403 terms_required (server/middleware/termsGate.js, every route except its
 * TERMS_EXEMPT list) and the remote MCP endpoint with a terms_required tool error
 * (mcp-server/remotePolicy.js, before the AI access check).
 *
 * The switch (server/utils/envSwitch.js): off by default; only true/1/on/yes turn it on. In
 * production it is ignored while a current legal version is a draft (shared/legal/versions.js): POST
 * /api/v2/user/legal/acceptance answers 409 legal_not_published there, so nobody could accept and
 * every learner would be locked out. Turn it on after VITE_FEATURE_LEGAL_PAGES=true (the consent
 * page), never before: with the page off, a refused learner has nowhere to accept
 * (doc/legal/README.md「ページを公開する手順」).
 *
 * The rule is GET /api/v2/user/legal's: the newest live acceptance (rows of an earlier, deleted
 * account under the same id carry account_deleted_at) counts when its versions are acceptable
 * (acceptanceCounts). A read that fails refuses (legal_unavailable): the check fails closed.
 */
import { getPool } from '../../server/db.js';
import { readEnvSwitch } from '../../server/utils/envSwitch.js';
import {
    LEGAL_DOCUMENTS,
    LEGAL_HISTORY,
    acceptableLegalVersions,
    acceptanceCounts,
    isDraftLegalVersion,
} from '../../shared/legal/versions.js';
import { canonicalUserId } from './accountDeletions.js';

/** The server switch (api and mcp-public). */
export const TERMS_SWITCH = 'LEGAL_TERMS_REQUIRED';

/**
 * The newest live acceptance of an account ($1: canonical id). GET /api/v2/user/legal reads the
 * same statement (server/routes/legal.js LEGAL_SQL.latest). The remote MCP role may read these
 * columns only (deploy/risepath-vm/sql/mcp_remote_role.sql).
 */
export const LATEST_ACCEPTANCE_SQL = 'SELECT terms_version, privacy_version, accepted_at FROM legal_acceptances WHERE user_id = $1::uuid AND account_deleted_at IS NULL ORDER BY accepted_at DESC LIMIT 1';

/** How long an answer is kept: "accepted" changes only with a deploy; "not accepted" with an acceptance. */
export const ACCEPTED_CACHE_MS = 60_000;
export const REFUSED_CACHE_MS = 5_000;
/** Learners whose answers are kept at most (the oldest is dropped). */
export const ACCEPTANCE_CACHE_MAX = 1000;

/** Learner-facing text (the remote tool error; the API sends error_type and an English error). */
export const TERMS_MESSAGES = Object.freeze({
    terms_required: Object.freeze({
        en: 'To keep using Rise Path from this AI app, open Rise Path and accept the current terms of use.',
        jp: 'この AI アプリから Rise Path を使い続けるには、Rise Path を開いて、今の利用規約に同意してください。',
    }),
    legal_unavailable: Object.freeze({
        en: 'The terms cannot be checked right now. Please try again later.',
        jp: '今は利用規約への同意を確かめられません。しばらくしてからもう一度お試しください。',
    }),
});

/** @typedef {'off' | 'on' | 'unrecognised' | 'draft_in_production'} TermsEnforcementReason */
/** @typedef {Readonly<Record<'terms' | 'privacy', Readonly<{ version: string }>>>} CurrentDocuments */

/**
 * Whether the terms check runs, and why.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ documents?: CurrentDocuments }} [sources]  tests pass released documents
 * @returns {{ on: boolean, reason: TermsEnforcementReason }}
 */
export function termsEnforcement(env = process.env, { documents = LEGAL_DOCUMENTS } = {}) {
    const { on, recognised } = readEnvSwitch(env[TERMS_SWITCH]);
    if (!recognised) return { on: false, reason: 'unrecognised' };
    if (!on) return { on: false, reason: 'off' };
    const drafts = isDraftLegalVersion(documents.terms.version) || isDraftLegalVersion(documents.privacy.version);
    if (env.NODE_ENV === 'production' && drafts) return { on: false, reason: 'draft_in_production' };
    return { on: true, reason: 'on' };
}

/**
 * The one startup line about the switch, or null while it is unset or off (nothing changes then,
 * logs included). `label` names the process, e.g. '[Legal]' or '[MCP remote]'.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ label?: string, documents?: CurrentDocuments }} [options]
 * @returns {string | null}
 */
export function termsSwitchLine(env = process.env, { label = '[Legal]', documents = LEGAL_DOCUMENTS } = {}) {
    const { reason } = termsEnforcement(env, { documents });
    if (reason === 'off') return null;
    if (reason === 'unrecognised') {
        return `${label} terms check: off: ${TERMS_SWITCH} has an unrecognised value (use 'true' or 'false')`;
    }
    if (reason === 'draft_in_production') {
        return `${label} terms check: ignored: ${TERMS_SWITCH} is on, but the current terms are drafts and POST /api/v2/user/legal/acceptance answers 409 legal_not_published in production; publish the texts first (doc/legal/README.md)`;
    }
    return `${label} terms check: required (${TERMS_SWITCH}): a learner who has not accepted the current terms is refused with terms_required`;
}

/**
 * true when the learner's newest live acceptance counts; throws when the database cannot answer.
 * @param {string} userId canonical account id
 * @param {{
 *   query: (sql: string, params: unknown[]) => Promise<{ rows?: any[] }>,
 *   acceptable?: (document: 'terms' | 'privacy') => string[] | null,
 * }} options
 */
export async function termsAccepted(userId, { query, acceptable = (document) => acceptableLegalVersions(document) }) {
    const { rows } = await query(LATEST_ACCEPTANCE_SQL, [userId]);
    return acceptanceCounts(rows?.[0], acceptable);
}

/**
 * A small per-process cache of the answer, per learner and variant (the API keys the variant by the
 * account generation, so a re-opened account never reuses the deleted account's answer). "accepted"
 * is kept acceptedMs, "not accepted" refusedMs; errors are never kept. At most `max` keys (the
 * oldest is dropped). One read in flight per key: callers meanwhile share it.
 *
 * Versioned per learner: invalidate(learner) starts a new generation for that learner. It drops
 * their answers and their read in flight; that read still answers its own callers, but stores
 * nothing (it may have started before the acceptance committed), and a caller that comes after
 * invalidate() starts a new read instead of joining it. A read stores its answer only while it is
 * still the read of the current generation of its key.
 *
 * @param {{ acceptedMs?: number, refusedMs?: number, max?: number, now?: () => number }} [options]
 */
export function createAcceptanceCache({ acceptedMs = ACCEPTED_CACHE_MS, refusedMs = REFUSED_CACHE_MS, max = ACCEPTANCE_CACHE_MAX, now = Date.now } = {}) {
    /** @type {Map<string, { learner: string, value: boolean, until: number }>} */
    const answers = new Map();
    /** @type {Map<string, { learner: string, promise: Promise<boolean> }>} */
    const reading = new Map();
    /** @param {string} learner @param {string} variant */
    const keyOf = (learner, variant) => `${learner}|${variant}`;

    return {
        /**
         * The cached answer, or read() (shared with callers of the same generation).
         * @param {string} learner @param {string} variant @param {() => Promise<boolean>} read
         * @returns {Promise<boolean>}
         */
        get(learner, variant, read) {
            const key = keyOf(learner, variant);
            const cached = answers.get(key);
            if (cached && cached.until > now()) return Promise.resolve(cached.value);
            if (cached) answers.delete(key);
            const running = reading.get(key);
            if (running) return running.promise;
            // Registered before the read starts, so a read that fails at once still leaves the map.
            /** @type {{ learner: string, promise: Promise<boolean> }} */
            const entry = { learner, promise: /** @type {Promise<boolean>} */ (/** @type {unknown} */ (null)) };
            reading.set(key, entry);
            entry.promise = (async () => {
                try {
                    const value = await read();
                    if (reading.get(key) === entry) {
                        answers.delete(key);
                        answers.set(key, { learner, value, until: now() + (value ? acceptedMs : refusedMs) });
                        while (answers.size > max) {
                            const oldest = answers.keys().next().value;
                            if (oldest === undefined) break;
                            answers.delete(oldest);
                        }
                    }
                    return value;
                } finally {
                    if (reading.get(key) === entry) reading.delete(key);
                }
            })();
            return entry.promise;
        },
        /** A new generation for this learner (after their acceptance was recorded). @param {string} learner */
        invalidate(learner) {
            for (const [key, entry] of answers) if (entry.learner === learner) answers.delete(key);
            for (const [key, entry] of reading) if (entry.learner === learner) reading.delete(key);
        },
        /** Kept answers (tests). */
        get size() {
            return answers.size;
        },
    };
}

/** @typedef {ReturnType<typeof createAcceptanceCache>} AcceptanceCache */

/** The app's home page (any gated page shows the consent page), from APP_PUBLIC_URL, or null. */
export function termsSettingsUrl(env = process.env) {
    const raw = env.APP_PUBLIC_URL?.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return new URL('/', url.origin).href;
    } catch {
        return null;
    }
}

/**
 * The remote tool error (the shape of tools/core/mcpAiAccess.js accessRefusal): `error` carries both
 * languages, `message` keeps them apart, `settings_url` (the app) when APP_PUBLIC_URL is set.
 * @param {keyof typeof TERMS_MESSAGES} errorType
 * @param {{ settingsUrl?: string | null }} [options]
 */
export function termsRefusal(errorType, { settingsUrl = null } = {}) {
    const { en, jp } = TERMS_MESSAGES[errorType];
    const url = errorType === 'terms_required' ? settingsUrl : null;
    const link = url ? ` ${url}` : '';
    return {
        error: `${en}${link}\n${jp}${link}`,
        error_type: errorType,
        message: { en, jp },
        ...(url ? { settings_url: url } : {}),
    };
}

const WARN_INTERVAL_MS = 60_000;

/**
 * The remote MCP endpoint's check (mcp-server/remotePolicy.js). Read once per process: mcp-public
 * reads its own environment (mcp-public.env). It cannot see the api's acceptances as they happen,
 * so "not accepted" is kept REFUSED_CACHE_MS only. The read runs as the remote role
 * (DATABASE_URL_PHASE1 of mcp-public), which needs the column grant on legal_acceptances: a 42501
 * (permission denied) in the log means sql/mcp_remote_role.sql was not re-run.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   documents?: typeof LEGAL_DOCUMENTS,
 *   history?: typeof LEGAL_HISTORY,
 *   query?: (sql: string, params: unknown[]) => Promise<{ rows?: any[] }>,
 *   cache?: AcceptanceCache,
 *   logger?: Pick<Console, 'warn'>,
 *   now?: () => number,
 * }} [options]
 */
export function createRemoteTermsCheck({
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
    const enforcement = termsEnforcement(env, { documents });
    const settingsUrl = termsSettingsUrl(env);
    /** @param {'terms' | 'privacy'} document */
    const acceptable = (document) => acceptableLegalVersions(document, { documents, history });
    let lastWarnAt = Number.NEGATIVE_INFINITY;

    return {
        enforcement,
        /**
         * null when the check is off or the learner accepted; else the tool error.
         * @param {string} userId
         */
        async refusal(userId) {
            if (!enforcement.on) return null;
            const id = canonicalUserId(userId);
            if (!id) return termsRefusal('legal_unavailable');
            try {
                const accepted = await cache.get(id, '', () => termsAccepted(id, { query, acceptable }));
                return accepted ? null : termsRefusal('terms_required', { settingsUrl });
            } catch (error) {
                const t = now();
                if (t - lastWarnAt >= WARN_INTERVAL_MS) {
                    lastWarnAt = t;
                    logger.warn(`[MCP remote] terms check unavailable (${/** @type {any} */ (error)?.code ?? 'error'}); calls answer legal_unavailable`);
                }
                return termsRefusal('legal_unavailable');
            }
        },
    };
}
