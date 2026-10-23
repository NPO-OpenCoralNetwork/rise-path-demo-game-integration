/**
 * Public remote MCP endpoint (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5): adults connect
 * their own agent (Claude Code, Codex, Claude.ai/Desktop connectors, Cursor, VS Code, Hermes,
 * ChatGPT) with per-user OAuth through Supabase's OAuth 2.1 server. Started by
 * `node mcp-server/index.js --http` (compose service mcp-public, behind the Cloudflare tunnel).
 *
 * Environment (readRemoteConfig):
 *   MCP_PUBLIC_RESOURCE_URL  canonical resource URL, e.g. https://mcp.example.org/mcp (no trailing
 *                            slash, no query). Its host is the only Host accepted; its path is the
 *                            MCP endpoint. The Custom Access Token Hook writes the same string as aud.
 *   MCP_HTTP_PORT            default 3200
 *   MCP_ALLOWED_ORIGINS      comma list of browser origins allowed (CORS); any other Origin: 403
 *   SUPABASE_URL, SUPABASE_ANON_KEY   the issuer is SUPABASE_URL + '/auth/v1'
 *   APP_PUBLIC_URL           optional: the app origin, for the settings links in refusals
 *   DATABASE_URL_PHASE1      the least-privilege role (deploy/risepath-vm/sql/mcp_remote_role.sql)
 *   NODE_ENV=production      required; MCP_REMOTE_TEST=1 (tests only) allows any NODE_ENV but binds
 *                            127.0.0.1 and accepts http:// on loopback hosts
 * Ignored on purpose (removed from the environment at start): RISE_PATH_BRIDGE_TOKEN,
 * RISE_PATH_ACTIVE_SESSION_KEY (and its aliases), AI_ACCESS_DEV_AUDIENCE. There is no dev fallback.
 *
 * HTTP surface:
 *   GET  /health                                   { status } only; before the Host check (Docker)
 *   GET  /.well-known/oauth-protected-resource/mcp RFC 9728 metadata (also at the root path)
 *   POST /mcp                                      Streamable HTTP, stateless, JSON responses
 *   GET, DELETE /mcp                               405 (no sessions, no SSE stream)
 * POST /mcp, in order: Host check, Origin check (403) and CORS, access-token verification
 * (mcp-server/oauthVerifier.js: 401 with WWW-Authenticate resource_metadata via the SDK's
 * requireBearerAuth, 503 when Supabase or the database cannot answer), the per-address limit for
 * requests that are not authenticated (30/min, cf-connecting-ip), the per-user-and-client limit
 * (60/min), the connected-apps record (mcp_oauth_grants.last_used_at, at most once a minute), then
 * a new McpServer and transport for this request (createMcpServer, profile learner-remote, with
 * mcp-server/remotePolicy.js: adults only and the daily caps on every call).
 *
 * The access token is never logged and never passed to a tool.
 */
import net from 'node:net';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { getPool, ensureAuthUser } from '../server/db.js';
import { AuthUnavailableError, createOAuthVerifier } from './oauthVerifier.js';
import { REMOTE_PROFILE, requestedProfile } from './profileFilter.js';

export const DEFAULT_PORT = 3200;
/** Requests per minute per user and OAuth client. */
export const USER_LIMIT_PER_MINUTE = 60;
/** Requests per minute per address that do not carry a valid access token. */
export const UNAUTHENTICATED_LIMIT_PER_MINUTE = 30;
/** mcp_oauth_grants.last_used_at moves at most this often per user and client. */
export const GRANT_TOUCH_INTERVAL_MS = 60 * 1000;
const BODY_LIMIT = '256kb';
/** JSON-RPC messages per POST: a batch must not turn one request into many tool calls. */
export const MAX_BATCH = 10;
const SAFE_PATH = /^\/[A-Za-z0-9._~\/-]*[A-Za-z0-9._~-]$/;
const RETRY_AFTER_UNAVAILABLE_S = 30;

/** Variables a remote server must never act on. */
export const IGNORED_ENV = Object.freeze([
    'RISE_PATH_BRIDGE_TOKEN',
    'RISE_PATH_ACTIVE_SESSION_KEY',
    'HERMES_ACTIVE_SESSION_KEY',
    'X_HERMES_SESSION_KEY',
    'AI_ACCESS_DEV_AUDIENCE',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name';
const EXPOSE_HEADERS = 'WWW-Authenticate, Retry-After';

const jsonRpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * @param {string | undefined} raw @param {string} name @param {boolean} testMode @param {string[]} problems
 * @returns {URL | null}
 */
function parseServiceUrl(raw, name, testMode, problems) {
    const value = raw?.trim();
    if (!value) {
        problems.push(`${name} is not set`);
        return null;
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        problems.push(`${name} is not a URL`);
        return null;
    }
    const loopbackHttp = testMode && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) problems.push(`${name} must use https://`);
    if (url.username || url.password || url.search || url.hash) problems.push(`${name} must not carry credentials, a query or a fragment`);
    return url;
}

/**
 * The remote endpoint's settings, or an Error listing every problem.
 * @param {Record<string, string | undefined>} [env]
 */
export function readRemoteConfig(env = process.env) {
    const problems = [];
    const testMode = env.MCP_REMOTE_TEST === '1';
    if (env.NODE_ENV !== 'production' && !testMode) {
        problems.push('the remote endpoint runs only with NODE_ENV=production (MCP_REMOTE_TEST=1 is for tests and binds 127.0.0.1)');
    }

    const resourceUrl = parseServiceUrl(env.MCP_PUBLIC_RESOURCE_URL, 'MCP_PUBLIC_RESOURCE_URL', testMode, problems);
    let resource = '';
    if (resourceUrl) {
        resource = resourceUrl.href;
        if (resourceUrl.pathname === '/' || resourceUrl.pathname.endsWith('/')) {
            problems.push('MCP_PUBLIC_RESOURCE_URL needs a path without a trailing slash (e.g. https://mcp.example.org/mcp)');
        } else if (!SAFE_PATH.test(resourceUrl.pathname) || resourceUrl.pathname.startsWith('/.well-known/')) {
            problems.push('MCP_PUBLIC_RESOURCE_URL path may use only letters, digits and . _ ~ - /');
        } else if (env.MCP_PUBLIC_RESOURCE_URL.trim() !== resource) {
            problems.push(`MCP_PUBLIC_RESOURCE_URL must be written canonically: ${resource}`);
        }
    }

    const supabaseUrl = parseServiceUrl(env.SUPABASE_URL, 'SUPABASE_URL', testMode, problems);
    const supabaseBase = supabaseUrl ? supabaseUrl.href.replace(/\/+$/, '') : '';
    const anonKey = env.SUPABASE_ANON_KEY?.trim() ?? '';
    if (!anonKey) problems.push('SUPABASE_ANON_KEY is not set');

    const rawPort = env.MCP_HTTP_PORT?.trim();
    const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('MCP_HTTP_PORT must be a port number');

    const allowedOrigins = new Set();
    for (const entry of (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        let origin = null;
        try {
            origin = new URL(entry).origin;
        } catch { /* reported below */ }
        if (!origin || origin === 'null' || origin !== entry) problems.push(`MCP_ALLOWED_ORIGINS entry "${entry}" is not an origin (scheme://host[:port])`);
        else allowedOrigins.add(origin);
    }

    if (problems.length > 0) throw new Error(problems.join('; '));
    return {
        testMode,
        resource,
        resourceUrl: /** @type {URL} */ (resourceUrl),
        supabaseUrl: supabaseBase,
        issuer: `${supabaseBase}/auth/v1`,
        anonKey,
        port,
        host: testMode ? '127.0.0.1' : '0.0.0.0',
        allowedOrigins,
        appUrl: env.APP_PUBLIC_URL?.trim() || null,
    };
}

/** Protected Resource Metadata (RFC 9728). No scopes: Supabase has no custom scopes. */
export function protectedResourceMetadata(config) {
    return {
        resource: config.resource,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ['header'],
        resource_name: 'Rise Path',
    };
}

/** The caller's address for the unauthenticated limit: cf-connecting-ip (Cloudflare), else the socket. */
function clientAddress(req) {
    const cf = req.headers['cf-connecting-ip'];
    const value = typeof cf === 'string' ? cf.trim() : '';
    return net.isIP(value) ? value : (req.socket?.remoteAddress || 'unknown');
}

// A new row takes first_seen_at and last_used_at from the column defaults (now()), so the role
// needs INSERT (user_id, client_id) and UPDATE (first_seen_at, last_used_at) only.
const TOUCH_SQL = `INSERT INTO mcp_oauth_grants (user_id, client_id) VALUES ($1, $2)
ON CONFLICT (user_id, client_id) DO UPDATE SET first_seen_at = COALESCE(mcp_oauth_grants.first_seen_at, now()), last_used_at = now()`;

/**
 * Records (user, client) in mcp_oauth_grants and moves last_used_at, at most once a minute per
 * pair. first_seen_at is set on the first use only: a row the connected-apps page inserted when
 * the learner revoked an app that never called us has it NULL until then. revoked_at and
 * client_name (written by the app API) are never touched here. revoked_at is never cleared: the
 * verifier already lets tokens issued after it through (a new consent), and keeping it lets /settings/connected-apps tell a new consent
 * (Supabase granted_at later than revoked_at) from a disconnect whose revokeGrant step failed
 * and whose refresh token still works. Failures are logged and never fail the request.
 */
export function createGrantToucher({ getPool: poolFn = getPool, now = () => Date.now(), logger = console, intervalMs = GRANT_TOUCH_INTERVAL_MS } = {}) {
    const last = new Map();
    return async function touchGrant({ userId, clientId }) {
        const key = `${userId}:${clientId}`;
        const t = now();
        if (t - (last.get(key) ?? -Infinity) < intervalMs) return;
        if (last.size >= 10000) last.clear();
        last.set(key, t);
        const pool = poolFn();
        if (!pool) return;
        try {
            await ensureAuthUser(pool, userId);
            await pool.query(TOUCH_SQL, [userId, clientId]);
        } catch (error) {
            last.delete(key);
            logger.warn(`[MCP remote] could not record the connected app: ${error?.message ?? error}`);
        }
    };
}

/**
 * The Express app of the remote endpoint.
 * @param {{
 *   config: ReturnType<typeof readRemoteConfig>,
 *   createServer: () => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
 *   verifier: { verifyAccessToken: (token: string) => Promise<any> },
 *   touchGrant?: (grant: { userId: string, clientId: string }) => Promise<void>,
 *   logger?: Pick<Console, 'warn' | 'error'>,
 *   limits?: { userPerMinute?: number, unauthenticatedPerMinute?: number },
 * }} options
 */
export function createRemoteApp({
    config,
    createServer,
    verifier,
    touchGrant = createGrantToucher(),
    logger = console,
    limits = {},
}) {
    const resourcePath = config.resourceUrl.pathname;
    const prmUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);
    const prmPath = new URL(prmUrl).pathname;
    const prm = protectedResourceMetadata(config);
    const app = express();
    app.disable('x-powered-by');

    let lastUnavailableLog = -Infinity;
    const logUnavailable = (error) => {
        const t = Date.now();
        if (t - lastUnavailableLog < 60_000) return;
        lastUnavailableLog = t;
        logger.error(`[MCP remote] access tokens cannot be checked: ${error?.message ?? error}${error?.cause?.message ? ` (${error.cause.message})` : ''}`);
    };

    // 1. Health first: the Docker healthcheck calls 127.0.0.1, which the Host check refuses.
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));

    // 2. Host: only the public hostname (DNS rebinding).
    app.use(hostHeaderValidation([config.resourceUrl.hostname]));

    // 3. Origin: absent (server-side clients) or allow-listed; anything else 403. CORS only for
    // allow-listed origins, never reflected.
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin !== undefined) {
            if (!config.allowedOrigins.has(origin)) return res.status(403).json(jsonRpcError(-32000, 'Origin not allowed'));
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
            res.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
            res.set('Access-Control-Max-Age', '600');
        }
        res.vary('Origin');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    /** One verification per request, shared by the limiter and requireBearerAuth. */
    const verified = new WeakMap();
    const verifyOnce = async (req) => {
        if (verified.has(req)) return verified.get(req);
        const header = req.headers.authorization;
        const [type, token] = typeof header === 'string' ? header.split(' ') : [];
        let result = { token: null };
        if (token && type?.toLowerCase() === 'bearer') {
            try {
                result = { token, info: await verifier.verifyAccessToken(token) };
            } catch (error) {
                result = { token, error };
            }
        }
        verified.set(req, result);
        return result;
    };

    const unauthenticatedLimiter = rateLimit({
        windowMs: 60_000,
        limit: limits.unauthenticatedPerMinute ?? UNAUTHENTICATED_LIMIT_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        // Authenticated requests are neither counted nor refused here (vendor clouds share addresses).
        skip: (req) => Boolean(verified.get(req)?.info),
        keyGenerator: (req) => `addr:${ipKeyGenerator(clientAddress(req))}`,
        handler: (_req, res) => res.status(429).json(jsonRpcError(-32000, 'Too many requests. Try again in a minute.')),
        validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
    });

    const userLimiter = rateLimit({
        windowMs: 60_000,
        limit: limits.userPerMinute ?? USER_LIMIT_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `user:${req.auth?.extra?.userId}:${req.auth?.clientId}`,
        handler: (_req, res) => res.status(429).json(jsonRpcError(-32000, `Too many requests: at most ${limits.userPerMinute ?? USER_LIMIT_PER_MINUTE} a minute. Try again shortly.`)),
        validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
    });

    // 4. Protected Resource Metadata (RFC 9728 path form, plus the root form).
    const servePrm = (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.json(prm);
    };
    for (const path of new Set([prmPath, '/.well-known/oauth-protected-resource'])) {
        app.get(path, unauthenticatedLimiter, servePrm);
        app.all(path, (_req, res) => res.status(405).set('Allow', 'GET, OPTIONS').json({ error: 'Method not allowed' }));
    }

    // 5. The MCP endpoint.
    const verifyFirst = async (req, res, next) => {
        const result = await verifyOnce(req);
        if (result.error instanceof AuthUnavailableError) {
            logUnavailable(result.error);
            res.set('Retry-After', String(RETRY_AFTER_UNAVAILABLE_S));
            return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'Sign-in cannot be checked right now. Please try again shortly.' });
        }
        if (result.error && !(result.error instanceof Error && 'errorCode' in result.error)) {
            logger.error(`[MCP remote] access token check failed: ${result.error?.name ?? 'Error'}`);
        }
        next();
    };
    const bearer = (req, res, next) => requireBearerAuth({
        verifier: {
            verifyAccessToken: async (token) => {
                const result = verified.get(req);
                if (!result || result.token !== token) return verifier.verifyAccessToken(token);
                if (result.error) throw result.error;
                return result.info;
            },
        },
        resourceMetadataUrl: prmUrl,
    })(req, res, next);
    const recordGrant = async (req, _res, next) => {
        const { clientId, extra } = req.auth;
        await touchGrant({ userId: extra.userId, clientId });
        next();
    };
    const handleMcp = async (req, res) => {
        if (Array.isArray(req.body) && req.body.length > MAX_BATCH) {
            return res.status(400).json(jsonRpcError(-32600, `At most ${MAX_BATCH} messages per request`));
        }
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
            void transport.close().catch(() => {});
            void server.close().catch(() => {});
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error(`[MCP remote] request failed: ${error?.message ?? error}`);
            if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, 'Internal error'));
        }
    };

    app.post(resourcePath, verifyFirst, unauthenticatedLimiter, bearer, userLimiter, recordGrant, express.json({ limit: BODY_LIMIT }), handleMcp);
    app.all(resourcePath, (_req, res) => res.status(405).set('Allow', 'POST').json(jsonRpcError(-32000, 'Method not allowed: this server is stateless and answers POST only')));

    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

    // A body that is not JSON or too large: a JSON-RPC error with that status, never the parser's text.
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const code = err?.status ?? err?.statusCode;
        const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
        if (status >= 500) logger.error(`[MCP remote] ${req.method} ${req.path} failed: ${err?.message ?? err}`);
        res.status(status).json(jsonRpcError(status === 400 ? -32700 : -32600, status === 413 ? 'Request body too large' : status === 400 ? 'Parse error' : 'Request failed'));
    });

    return app;
}

/**
 * Start the endpoint from the environment (index.js --http). Rejects when the configuration is
 * not safe to serve (see readRemoteConfig) or the profile is not learner-remote.
 * @param {{ env?: Record<string, string | undefined>, logger?: Pick<Console, 'log' | 'warn' | 'error'> }} [options]
 */
export async function startRemoteServer({ env = process.env, logger = console } = {}) {
    const asked = requestedProfile(process.argv.slice(2), env);
    if (asked && asked !== REMOTE_PROFILE) {
        throw new Error(`the remote endpoint serves only the ${REMOTE_PROFILE} profile (asked for "${asked}")`);
    }
    const config = readRemoteConfig(env);
    const ignored = IGNORED_ENV.filter((name) => env[name] !== undefined);
    for (const name of IGNORED_ENV) delete env[name];
    if (ignored.length > 0) logger.warn(`[MCP remote] ignoring ${ignored.join(', ')} (never used by the remote endpoint)`);

    const [{ createMcpServer }, { createRemotePolicy }] = await Promise.all([
        import('./createMcpServer.js'),
        import('./remotePolicy.js'),
    ]);
    const supabase = createClient(config.supabaseUrl, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const verifier = createOAuthVerifier({ issuer: config.issuer, resource: config.resource, supabase, logger });
    try {
        await verifier.refreshKeys();
    } catch (error) {
        logger.warn(`[MCP remote] signing keys not fetched yet (${error?.message ?? error}); requests answer 503 until they are.`);
    }
    const policy = createRemotePolicy({ env });
    const app = createRemoteApp({
        config,
        verifier,
        logger,
        createServer: () => createMcpServer({ profile: REMOTE_PROFILE, remote: policy }),
    });
    const server = await new Promise((resolve, reject) => {
        const s = app.listen(config.port, config.host, () => resolve(s));
        s.once('error', reject);
    });
    logger.error(`[MCP remote] listening on ${config.host}:${config.port}; resource ${config.resource}; issuer ${config.issuer}; profile ${REMOTE_PROFILE}${config.testMode ? ' (MCP_REMOTE_TEST)' : ''}`);
    return { app, server, config };
}
