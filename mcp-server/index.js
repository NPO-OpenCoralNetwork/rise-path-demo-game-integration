#!/usr/bin/env node
/**
 * Rise Path MCP Server (v2.4.0 — incl. request-tts and the lesson-* authoring tools)
 *
 * Exposes learning platform tools and resources via Model Context Protocol.
 * Can be connected from ChatGPT, Claude Desktop, Cursor, or any MCP client.
 *
 * Usage:
 *   node mcp-server/index.js              # stdio transport (Claude Desktop, etc.)
 *   node mcp-server/index.js --sse 3100   # SSE transport (Hermes bridge, a learner's own JWT)
 *   node mcp-server/index.js --http       # public remote endpoint: Streamable HTTP, OAuth,
 *                                         # adults only, profile learner-remote (remote.js)
 *
 * Environment:
 *   DATABASE_URL_PHASE1  — PostgreSQL connection string
 *   PHASE1_USER_ID       — Default user ID (dev mode)
 *   RP_LESSON_STORE      — lesson-upsert-draft store: fs (default, content/courses/<slug>/drafts/) or db
 *   RP_CONTENT_DIR       — content/ root for the lesson tools (default: repo content/)
 *   RP_LESSON_FS_WRITE   — 1 allows file drafts on a production SSE server (refused by default)
 *   RISE_PATH_PREVIEW_BASE_URL — base of lesson-preview-url (default http://localhost:3007)
 *
 * Tools, resources and prompts: mcp-server/createMcpServer.js (one server per profile).
 *
 * Auth (user scope): tools/core/mcpUserScope.js resolveMcpUserId, once per tool call
 *   --http with a Supabase OAuth access token — its user, always (mcp-server/oauthVerifier.js)
 *   SSE with a learner's JWT — that learner (syncAuthUserStub at /sse connect); a session of a
 *     deleted Rise Path account is refused on connect and on every message (sseUserAuth.js)
 *   SSE with the bridge token (Hermes) — the learner bound to the call's rp_turn argument, which
 *     Express mints per chat turn (registerAgentTurn); without one, session_binding_required in
 *     production (development only: the sole chatting learner, else PHASE1_USER_ID)
 *   stdio — RISE_PATH_ACTIVE_SESSION_KEY or rp_turn; PHASE1_USER_ID in development only
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID } from 'crypto';

// --- Phase 11: Profile filtering & policy ---
import { activeProfile } from './profileFilter.js';
import { clearSession } from './policy.js';
import { createMcpServer as buildMcpServer } from './createMcpServer.js';
import { verifyMessagesSessionAuth } from './sseMessagesAuth.js';
import { createSseUserResolver } from './sseUserAuth.js';
import { loadEnv } from '../tools/core/env.js';
import { decodeTokenClaims, isOAuthClientToken, sessionAuthTime } from '../tools/core/oauthToken.js';

const args = process.argv.slice(2);
const REMOTE_MODE = args.includes('--http');

// The remote endpoint reads only its own environment (deploy/risepath-vm/mcp-public.env), never a
// checkout's .env.local (which would set DATABASE_URL_PHASE1 or RISE_PATH_ACTIVE_SESSION_KEY).
if (!REMOTE_MODE) await loadEnv();

// File drafts (lesson-upsert-draft) are for local authoring. A production SSE server refuses
// them unless RP_LESSON_FS_WRITE=1; set RP_LESSON_STORE=db there instead.
const LESSON_FS_WRITE = !process.argv.includes('--sse')
    || process.env.NODE_ENV !== 'production'
    || process.env.RP_LESSON_FS_WRITE === '1';

// Session map — populated in SSE mode, empty in stdio mode
let sessions = new Map();

// Server lifecycle state (Phase 10)
const startedAt = Date.now();
let isShuttingDown = false;
let httpServer = null;

/** A server for stdio or one SSE connection: the active profile, the SSE sessions map. */
const createMcpServer = () => buildMcpServer({ profile: activeProfile, sessions, lessonFsWrite: LESSON_FS_WRITE });

// ============================================================
// Start Server
// ============================================================

if (REMOTE_MODE && args.includes('--sse')) {
    console.error('[MCP] --http and --sse cannot be combined.');
    process.exit(1);
}

if (REMOTE_MODE) {
    // Public remote endpoint: OAuth (Supabase), adults only, profile learner-remote
    // (mcp-server/remote.js). Refuses to start outside production unless MCP_REMOTE_TEST=1.
    const { startRemoteServer } = await import('./remote.js');
    try {
        const remote = await startRemoteServer();
        httpServer = remote.server;
    } catch (err) {
        console.error(`[MCP remote] not started: ${err?.message || err}`);
        process.exit(1);
    }
} else if (args.includes('--sse')) {
    // SSE transport for remote connections (ChatGPT, etc.)
    const portIdx = args.indexOf('--sse');
    const port = Number(args[portIdx + 1]) || 3100;

    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const express = (await import('express')).default;
    const { STATUS_CODES } = await import('node:http');
    const { createMessageRateLimiter } = await import('./messageRateLimit.js');
    const { initSupabase, getSupabase, extractBearerToken } = await import('../server/middleware/auth.js');
    const { PHASE1_USER_ID, syncAuthUserStub, getPool } = await import('../server/db.js');
    const app = express();

    // Phase 10-8: CORS configuration
    const ALLOWED_ORIGINS = (process.env.MCP_CORS_ORIGINS || '').split(',').filter(Boolean);
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (process.env.NODE_ENV !== 'production' || !origin || ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin || '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hermes-Session-Key');
            res.setHeader('Access-Control-Max-Age', '86400');
        }
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    // Initialize Supabase for JWT validation
    await initSupabase();

    // Rate limit: 30 calls/min (Phase 8) per learner JWT session, and per learner (rp_turn) on the
    // shared bridge session (mcp-server/messageRateLimit.js).
    const mcpLimiter = createMessageRateLimiter({
        sessions,
        limit: process.env.NODE_ENV !== 'production' ? 300 : 30,
    });
    // An unknown session answers 404 before its body is read.
    const requireKnownSession = (req, res, next) => (
        sessions.has(req.params.sessionId) ? next() : res.status(404).json({ error: 'Session not found' })
    );
    // The body is parsed here (the SDK's own 4 MB limit) so the limiter can read a bridge call's
    // rp_turn; the transport gets it as parsedBody.
    const parseMessageBody = express.json({ limit: '4mb' });

    // Resolve user ID from Bearer token or fallback (mcp-server/sseUserAuth.js)
    // Priority: Bridge Token > Supabase JWT (refused for a deleted Rise Path account) > dev fallback
    // ChatGPT Apps & Connectors uses a fixed token, so Bridge Token is essential.
    const { allowDevAuthFallback } = await import('../server/middleware/authPolicy.js');
    const { readAccountState } = await import('../tools/core/accountDeletions.js');
    const resolveUserId = createSseUserResolver({
        getSupabase,
        getPool,
        readAccountState,
        decodeTokenClaims,
        sessionAuthTime,
        isOAuthClientToken,
        extractBearerToken,
        bridgeToken: () => process.env.RISE_PATH_BRIDGE_TOKEN,
        allowDevFallback: allowDevAuthFallback,
        phase1UserId: PHASE1_USER_ID,
    });

    // Use the module-level sessions Map (declared near resolveToolUserId)
    // so that tool handlers can look up authenticated userId by sessionId

    // ── Phase 10: Health Check Endpoint ─────────────────────────
    // Unauthenticated on the published port: the body says only whether the database answers.
    // The driver's error text (host, database, role names) goes to stderr.
    app.get('/health', async (_req, res) => {
        const { getPool } = await import('../server/db.js');
        const pool = getPool();
        let dbStatus = 'not_configured';

        if (pool) {
            try {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 3000)
                );
                await Promise.race([pool.query('SELECT 1'), timeout]);
                dbStatus = 'connected';
            } catch (err) {
                dbStatus = err?.message === 'timeout' ? 'timeout' : 'disconnected';
                console.error('[MCP] /health database check failed:', err?.message || err);
            }
        }

        const status = dbStatus === 'connected' || dbStatus === 'not_configured' ? 'ok' : 'degraded';
        res.json({
            status: isShuttingDown ? 'shutting_down' : status,
            version: '2.4.0',
            profile: activeProfile,
            uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
            active_sessions: Math.floor(sessions.size / 2),
            db: dbStatus,
            timestamp: new Date().toISOString(),
        });
    });

    app.get('/sse', async (req, res) => {
        // Phase 10: Reject new connections during shutdown
        if (isShuttingDown) {
            return res.status(503).json({ error: 'Server is shutting down' });
        }
        const userId = await resolveUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        await syncAuthUserStub(userId);

        // --- Anti-buffering for Cloudflare Tunnel / nginx reverse proxies ---
        res.setHeader('X-Accel-Buffering', 'no');

        // Disable Nagle's algorithm for minimal SSE latency
        if (res.socket) res.socket.setNoDelay(true);

        // Patch res.write to auto-flush after each SSE chunk.
        const _origWrite = res.write.bind(res);
        res.write = function (...writeArgs) {
            const result = _origWrite(...writeArgs);
            if (typeof res.flush === 'function') res.flush();
            return result;
        };

        const routeSessionId = randomUUID();
        const transport = new SSEServerTransport(`/messages/${routeSessionId}`, res);

        // Create a dedicated McpServer per connection (SDK: 1 Server = 1 Transport)
        const mcpInstance = createMcpServer();

        // Store session by both route sessionId (for Express routing)
        // and transport.sessionId (for MCP SDK extra.sessionId → resolveMcpUserId)
        const sessionData = { transport, userId, mcpInstance };
        sessions.set(routeSessionId, sessionData);
        sessions.set(transport.sessionId, sessionData); // SDK uses this in extra.sessionId

        // Clean up on disconnect
        res.on('close', async () => {
            sessions.delete(routeSessionId);
            sessions.delete(transport.sessionId);
            clearSession(routeSessionId);
            clearSession(transport.sessionId);
            try { await mcpInstance.close(); } catch { /* ignore */ }
            console.error(`[MCP] Session ${routeSessionId.slice(0, 8)} disconnected (${Math.floor(sessions.size / 2)} active)`);
        });

        console.error(`[MCP] Session ${routeSessionId.slice(0, 8)} connected user=${userId.slice(0, 8)} (${Math.ceil(sessions.size / 2)} active)`);
        await mcpInstance.connect(transport);
    });

    app.post('/messages/:sessionId', requireKnownSession, parseMessageBody, mcpLimiter, async (req, res) => {
        const session = sessions.get(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // X-Hermes-Session-Key is not stored on the session: one bridge session carries every
        // learner's calls. resolveMcpUserId reads an rp:turn key from each request's own headers.
        const resolvedUserId = await resolveUserId(req);

        const authFailure = verifyMessagesSessionAuth(resolvedUserId, session.userId);
        if (authFailure) {
            if (authFailure.status === 403) {
                console.error(
                    `[MCP] Session ${req.params.sessionId.slice(0, 8)} userId mismatch: token=${resolvedUserId?.slice(0, 8)} session=${session.userId.slice(0, 8)}`,
                );
            }
            return res.status(authFailure.status).json({ error: authFailure.error });
        }

        await session.transport.handlePostMessage(req, res, req.body);
    });

    // Last: an error no route answered (a body that is not JSON or too large) gets JSON with its
    // status's standard text, never the parser's message or a stack.
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const code = err?.status ?? err?.statusCode;
        const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
        if (status >= 500) console.error(`[MCP] ${req.method} ${req.path} failed:`, err);
        res.status(status).json({ error: STATUS_CODES[status] ?? 'Internal Server Error' });
    });

    httpServer = app.listen(port, () => {
        console.log(`🚀 Rise Path MCP Server (SSE) running on http://localhost:${port}/sse`);
        console.log(`   Sessions endpoint: POST /messages/:sessionId`);
        console.log(`   Health check: GET /health`);
    });
} else {
    // stdio transport (default, for Claude Desktop / local)
    const mcpInstance = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpInstance.connect(transport);
    console.error(`🚀 Rise Path MCP Server (stdio) started [profile: ${activeProfile}]`);
}

// ============================================================
// Phase 10: Graceful Shutdown
// ============================================================

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`\n[MCP] ${signal} received. Shutting down gracefully...`);

    // Force exit after 10 seconds
    const forceTimer = setTimeout(() => {
        console.error('[MCP] Shutdown timeout (10s). Forcing exit.');
        process.exit(1);
    }, 10_000);
    forceTimer.unref(); // Don't keep process alive just for this timer

    // 1. Close all active MCP sessions
    const sessionCount = Math.floor(sessions.size / 2);
    if (sessionCount > 0) {
        console.error(`[MCP] Closing ${sessionCount} active session(s)...`);
        const closePromises = [];
        const seen = new Set();
        for (const [id, session] of sessions) {
            if (seen.has(session)) continue; // Skip duplicate entries (route + transport)
            seen.add(session);
            closePromises.push(
                session.mcpInstance?.close().catch(() => {})
            );
        }
        await Promise.allSettled(closePromises);
        sessions.clear();
    }

    // 2. Close HTTP server (stop accepting new connections)
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
        console.error('[MCP] HTTP server closed.');
    }

    // 3. Close DB pool
    try {
        const { getPool } = await import('./server/db.js').catch(() =>
            import('../server/db.js')
        );
        const pool = getPool?.();
        if (pool) {
            await pool.end();
            console.error('[MCP] DB pool closed.');
        }
    } catch { /* ignore */ }

    console.error('[MCP] Shutdown complete.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
