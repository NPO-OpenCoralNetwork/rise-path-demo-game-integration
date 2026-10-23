/**
 * Access-token verifier for the remote MCP endpoint (mcp-server/remote.js; Phase 1,
 * doc/brushup-2026/ai-access-plan.ja.md §5). Tokens come from Supabase's OAuth 2.1 server: user
 * JWTs signed with the project's asymmetric key, plus client_id, with aud set to the canonical MCP
 * URL by our Custom Access Token Hook (deploy/supabase/custom_access_token_hook.sql).
 *
 * verifyAccessToken(token), in order. Steps 1-2 run before any network call:
 * 1. Header: three base64url parts, alg ES256 or RS256, a kid. Anything else (HS256 tokens,
 *    which supabase-js would send to /auth/v1/user) is a 401.
 * 2. The kid must be in the JWKS we fetch from <issuer>/.well-known/jwks.json: cached 10 minutes,
 *    and an unknown kid refetches at most once a minute (else 401 without a call). No keys at all
 *    because Supabase did not answer: 503 (AuthUnavailableError), so clients do not re-authorize.
 * 3. supabase.auth.getClaims(token, { jwks: { keys } }): signature and exp, offline with our keys.
 *    It throws on an expired token; every verification failure becomes InvalidTokenError (401,
 *    so the client refreshes), a network failure AuthUnavailableError (503).
 * 4. Claims: iss === issuer; aud equals or includes the canonical resource URL; client_id and sub
 *    UUIDs; role 'authenticated'; is_anonymous !== true; numeric exp and iat.
 * 5. Not revoked: mcp_oauth_grants.revoked_at later than the token's iat for that user and client
 *    (the connected-apps page writes it before Supabase deletes the grant, and again after) is a
 *    401. A failed lookup is a 503 (fail closed). The answer is cached per (user, client, iat)
 *    and concurrent lookups share one query: this step runs before the per-minute limiters, so
 *    without the cache every request with a validly signed token, even one answered 429, would
 *    cost a database query. A 'not revoked' answer is reused for NOT_REVOKED_CACHE_MS only, so a
 *    revoke takes effect within a few seconds; a 'revoked' answer never turns back (revoked_at
 *    only moves forward) and is kept for REVOCATION_CACHE_MS.
 *
 * Returns the SDK's AuthInfo: { token, clientId, scopes: [], expiresAt, extra: { userId } }.
 * Error messages are generic and never contain the token: they reach WWW-Authenticate.
 */
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { getPool } from '../server/db.js';

/** Supabase did not answer (JWKS fetch, getClaims network error) or the grants lookup failed: 503. */
export class AuthUnavailableError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'AuthUnavailableError';
        if (cause !== undefined) this.cause = cause;
    }
}

export const JWKS_TTL_MS = 10 * 60 * 1000;
export const UNKNOWN_KID_REFETCH_MS = 60 * 1000;
/** While no keys could be fetched at all: retry this often, answering 503 in between. */
const EMPTY_JWKS_RETRY_MS = 5 * 1000;
/** How long a 'revoked' answer is reused for the same (user, client, iat). */
export const REVOCATION_CACHE_MS = 30 * 1000;
/**
 * How long a 'not revoked' answer is reused: the longest a disconnect can wait to apply on this
 * process (the api container writes revoked_at and cannot clear this cache). Keep it a few seconds.
 */
export const NOT_REVOKED_CACHE_MS = 5 * 1000;
/** Most cached revocation answers held at once (oldest dropped first). */
const REVOCATION_CACHE_MAX = 10000;
const FETCH_TIMEOUT_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KEY_TYPES = Object.freeze({ ES256: 'EC', RS256: 'RSA' });

/** @param {string} segment */
function decodeJson(segment) {
    try {
        const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * The JWT header when the token has the shape we accept, else null.
 * @param {unknown} token
 * @returns {{ alg: 'ES256' | 'RS256', kid: string } | null}
 */
export function parseTokenHeader(token) {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) return null;
    const header = decodeJson(parts[0]);
    if (!header || !(header.alg in KEY_TYPES)) return null;
    if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 256) return null;
    return { alg: header.alg, kid: header.kid };
}

/** @param {unknown} aud @param {string} resource */
const audienceMatches = (aud, resource) => aud === resource || (Array.isArray(aud) && aud.includes(resource));

/**
 * Whether an error from supabase-js is a failure to reach Supabase rather than a bad token.
 * @param {any} error
 */
function isNetworkError(error) {
    if (!error) return false;
    const name = String(error.name ?? '');
    if (name === 'AuthRetryableFetchError' || name === 'AbortError' || name === 'TimeoutError') return true;
    const status = Number(error.status);
    return Number.isInteger(status) && status >= 500;
}

/**
 * The grants lookup: true when the token's user revoked this client after the token was issued.
 * @param {{ query: Function }} pool @param {{ userId: string, clientId: string, iat: number }} token
 */
export async function isGrantRevoked(pool, { userId, clientId, iat }) {
    const result = await pool.query(
        `SELECT 1 FROM mcp_oauth_grants
         WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NOT NULL AND revoked_at > to_timestamp($3)`,
        [userId, clientId, iat],
    );
    return Boolean(result?.rows?.length);
}

/**
 * @param {{
 *   issuer: string,
 *   resource: string,
 *   supabase: { auth: { getClaims: Function } },
 *   fetch?: typeof fetch,
 *   now?: () => number,
 *   getPool?: () => any,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 *   revocationCacheMs?: number,
 *   notRevokedCacheMs?: number,
 * }} options
 *   issuer: SUPABASE_URL + '/auth/v1'; resource: MCP_PUBLIC_RESOURCE_URL (canonical, no trailing
 *   slash); supabase: a client for SUPABASE_URL (getClaims)
 */
export function createOAuthVerifier({
    issuer,
    resource,
    supabase,
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    getPool: poolFn = getPool,
    logger = console,
    revocationCacheMs = REVOCATION_CACHE_MS,
    notRevokedCacheMs = NOT_REVOKED_CACHE_MS,
}) {
    if (!issuer || !resource || !supabase?.auth?.getClaims) throw new TypeError('createOAuthVerifier needs issuer, resource and supabase');
    const jwksUrl = `${issuer}/.well-known/jwks.json`;
    /** @type {{ keys: any[], fetchedAt: number }} */
    let jwks = { keys: [], fetchedAt: -Infinity };
    let lastFetchAttempt = -Infinity;
    /** @type {Promise<void> | null} */
    let inflight = null;
    let fetchCount = 0;
    // A 'not revoked' answer never outlives a 'revoked' one.
    const notRevokedMs = Math.min(notRevokedCacheMs, revocationCacheMs);
    /**
     * ttl: revocationCacheMs while the lookup is pending (concurrent requests share it), then
     * revocationCacheMs for 'revoked' and notRevokedMs for 'not revoked'.
     * @type {Map<string, { at: number, ttl: number, answer: Promise<boolean> }>}
     */
    const revocations = new Map();

    /**
     * isGrantRevoked, reused per (user, client, iat) for the entry's ttl; a failed lookup is not
     * kept, so the next request asks again.
     * @param {any} pool @param {{ userId: string, clientId: string, iat: number }} grant
     */
    const revokedCached = (pool, grant) => {
        const key = `${grant.userId}|${grant.clientId}|${grant.iat}`;
        const t = now();
        const hit = revocations.get(key);
        if (hit && t - hit.at < hit.ttl) return hit.answer;
        if (hit) revocations.delete(key);
        if (revocations.size >= REVOCATION_CACHE_MAX) {
            for (const [k, v] of revocations) {
                if (revocations.size < REVOCATION_CACHE_MAX && t - v.at < v.ttl) break;
                revocations.delete(k);
            }
        }
        const answer = isGrantRevoked(pool, grant);
        const entry = { at: t, ttl: revocationCacheMs, answer };
        revocations.set(key, entry);
        answer.then(
            (revoked) => { if (!revoked) entry.ttl = notRevokedMs; },
            () => { if (revocations.get(key) === entry) revocations.delete(key); },
        );
        return answer;
    };

    const fetchKeys = async () => {
        lastFetchAttempt = now();
        fetchCount += 1;
        let response;
        try {
            response = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        } catch (error) {
            throw new AuthUnavailableError('JWKS fetch failed', error);
        }
        if (!response.ok) throw new AuthUnavailableError(`JWKS fetch answered ${response.status}`);
        let body;
        try {
            body = await response.json();
        } catch (error) {
            throw new AuthUnavailableError('JWKS is not JSON', error);
        }
        const keys = Array.isArray(body?.keys)
            ? body.keys.filter((key) => key && typeof key.kid === 'string' && (key.kty === 'EC' || key.kty === 'RSA'))
            : [];
        jwks = { keys, fetchedAt: now() };
    };

    /** Refetch once for concurrent callers; a failure keeps the keys we had. */
    const refresh = async () => {
        inflight ??= fetchKeys().finally(() => { inflight = null; });
        return inflight;
    };

    /**
     * The JWK for `kid`, or null when it is unknown. Throws AuthUnavailableError only when we hold
     * no keys at all and Supabase does not answer.
     * @param {string} kid
     */
    const keyFor = async (kid) => {
        // Requests that arrive during a fetch wait for it instead of starting their own.
        if (inflight) await inflight.catch(() => {});
        const find = () => jwks.keys.find((k) => k.kid === kid) ?? null;
        const t = now();
        const key = find();
        if (key && t - jwks.fetchedAt < JWKS_TTL_MS) return key;
        // Stale keys or an unknown kid: refetch at most once a minute (every few seconds while we
        // hold no keys at all), so neither bogus kids nor a Supabase outage cost a call each.
        const gap = jwks.keys.length === 0 ? EMPTY_JWKS_RETRY_MS : UNKNOWN_KID_REFETCH_MS;
        if (t - lastFetchAttempt < gap) {
            if (jwks.keys.length === 0) throw new AuthUnavailableError('Signing keys are not available yet');
            return key;
        }
        try {
            await refresh();
        } catch (error) {
            if (jwks.keys.length === 0) throw error;
            logger.warn(`[MCP remote] JWKS refresh failed (${error?.message ?? error}); using the keys fetched before.`);
        }
        return find();
    };

    /**
     * @param {string} token
     * @returns {Promise<import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo>}
     */
    async function verifyAccessToken(token) {
        const header = parseTokenHeader(token);
        if (!header) throw new InvalidTokenError('Unsupported access token');
        const jwk = await keyFor(header.kid);
        if (!jwk) throw new InvalidTokenError('Unknown signing key');
        if (jwk.kty !== KEY_TYPES[header.alg] || (jwk.alg && jwk.alg !== header.alg)) {
            throw new InvalidTokenError('Unsupported access token');
        }

        let claims;
        try {
            const { data, error } = await supabase.auth.getClaims(token, { jwks: { keys: [jwk] } });
            if (error) {
                if (isNetworkError(error)) throw new AuthUnavailableError('Supabase did not answer', error);
                throw new InvalidTokenError('Invalid or expired token');
            }
            claims = data?.claims;
        } catch (error) {
            if (error instanceof AuthUnavailableError || error instanceof InvalidTokenError) throw error;
            if (isNetworkError(error)) throw new AuthUnavailableError('Supabase did not answer', error);
            // 'JWT has expired', 'Invalid alg claim', a key WebCrypto refuses: the token is bad.
            throw new InvalidTokenError('Invalid or expired token');
        }
        if (!claims || typeof claims !== 'object') throw new InvalidTokenError('Invalid or expired token');

        if (claims.iss !== issuer) throw new InvalidTokenError('Token issuer is not accepted');
        if (!audienceMatches(claims.aud, resource)) throw new InvalidTokenError('Token audience is not this server');
        if (typeof claims.client_id !== 'string' || !UUID.test(claims.client_id)) throw new InvalidTokenError('Not an OAuth client access token');
        if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) throw new InvalidTokenError('Invalid token subject');
        if (claims.role !== 'authenticated') throw new InvalidTokenError('Invalid token role');
        if (claims.is_anonymous === true) throw new InvalidTokenError('Anonymous users cannot connect');
        if (!Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)) throw new InvalidTokenError('Invalid or expired token');
        if (claims.exp <= Math.floor(now() / 1000)) throw new InvalidTokenError('Invalid or expired token');

        const userId = claims.sub.toLowerCase();
        const clientId = claims.client_id.toLowerCase();
        const pool = poolFn();
        if (!pool) throw new AuthUnavailableError('Database not configured');
        let revoked;
        try {
            revoked = await revokedCached(pool, { userId, clientId, iat: claims.iat });
        } catch (error) {
            throw new AuthUnavailableError('Grant lookup failed', error);
        }
        if (revoked) throw new InvalidTokenError('Access for this app was revoked');

        return { token, clientId, scopes: [], expiresAt: claims.exp, extra: { userId, iat: claims.iat } };
    }

    return {
        verifyAccessToken,
        /** Fetch the JWKS now (startup); failures are the caller's to log. */
        refreshKeys: refresh,
        /** JWKS fetches so far (tests). */
        stats: () => ({ jwksFetches: fetchCount, keys: jwks.keys.length, revocationsCached: revocations.size }),
    };
}
