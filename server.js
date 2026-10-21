import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg'; // For legacy pool if needed, or remove
import ttsRoutes, { ttsHealthHandler } from './server/routes/tts.js';
import { jobWorker } from './server/jobWorker.js';

// New Routes
import aiRoutes from './server/routes/ai.js';
import chatgptCurriculumRoutes from './server/routes/chatgptCurriculum.js';
import lifeJournalRoutes from './server/routes/lifeJournal.js';
import learnerMemoryRoutes from './server/routes/learnerMemory.js';
import agentRoutes from './server/routes/agent.js';
import contentRoutes from './server/routes/content.js';
import userRoutes from './server/routes/user.js';
import healthRoutes from './server/routes/health.js';
import { createLlmRouter } from './server/routes/llm.js';
import { createGuestBudget, createOriginPolicy, originGuard } from './server/llm/guestAccess.js';
import { logStartupDiagnostics } from './server/services/runtimeHealth.js';
import { requireAuth, optionalAuth, initSupabase } from './server/middleware/auth.js';
import { requireBridgeOrAuth } from './server/middleware/bridgeAuth.js';
import { createOriginGate, readOriginSecrets, tunnelProfileWithoutSecret } from './server/middleware/originGate.js';
import rateLimit from 'express-rate-limit';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment ---
// One loader with the MCP server (tools/core/env.js); main() passes force: [] so the deployment's
// own environment always wins over .env.local.
import { loadEnv } from './tools/core/env.js';
// Legacy Learning Portals read the Phase 1 pool directly (see the route in createApp).
import { getPool } from './server/db.js';
import { dbUnavailableErrorHandler, respondIfDbUnavailable } from './server/dbUnavailable.js';

/**
 * Builds the Express app: middleware, rate limits and every route, in mount order. No listen,
 * no job worker and no env loading, so tests (server/tests/llmRoute.test.js) run the real stack.
 * @param {{ serveStatic?: boolean, originGate?: Parameters<typeof createOriginGate>[0] }} [options]
 *   serveStatic: dist/ + public/ (off in tests); originGate: options for the origin gate
 *   (server/middleware/originGate.js; tests pass exemptLoopback: false)
 */
export async function createApp({ serveStatic = true, originGate = {} } = {}) {
    const app = express();
    app.disable('x-powered-by');

    // Behind a reverse proxy, TRUST_PROXY (hop count, or true/false) makes req.ip the client IP, so
    // the per-IP limits below key on real addresses.
    const trustProxy = process.env.TRUST_PROXY;
    if (trustProxy) {
        const hops = Number.parseInt(trustProxy, 10);
        app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy === 'true');
    }

    // --- Middleware ---
    // Origin gate first: with ORIGIN_SECRET set, non-loopback requests without the edge's secret
    // get 403 before CORS, body parsing, logging or the limiters run (and before a 50 MB body is read).
    // Without it, only requests that came through Cloudflare get 403.
    app.use(createOriginGate({ ...originGate }));
    // Every response: no MIME sniffing. API responses: not cached by Vercel, Cloudflare or the
    // browser unless a route sets its own Cache-Control later (llm.js, agent.js streams).
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // CORS: open for the existing API, but the LLM gateway answers only the app's own origins
    // (server/llm/guestAccess.js), so other sites cannot use visitors' browsers as a model proxy.
    const isAllowedLlmOrigin = createOriginPolicy();
    const openCors = cors();
    const llmCors = cors((req, callback) => callback(null, { origin: isAllowedLlmOrigin(req.headers.origin, req) }));
    app.use((req, res, next) => (req.path.startsWith('/api/v2/llm') ? llmCors : openCors)(req, res, next));
    app.use(express.json({ limit: '50mb' }));

    // Logging Middleware (Phase 8: includes authMethod). originalUrl: req.url is cut to the mount
    // path when a scoped middleware (e.g. /api/v2/agent auth) answers.
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const ms = Date.now() - start;
            const auth = req.authMethod || '-';
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms auth=${auth}`);
        });
        next();
    });

    // --- Rate Limiting (Phase 8) ---
    const isDev = process.env.NODE_ENV !== 'production';

    // Global: 200 req/min/IP (relaxed in dev: 1000)
    const globalLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: isDev ? 1000 : 200,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests. Please slow down.' },
    });
    app.use('/api/', globalLimiter);

    // AI Heavy: 10 req/min/userId (Gemini API cost protection)
    const aiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: isDev ? 100 : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.userId || req.ip,
        message: { error: 'AI rate limit exceeded. Max 10 requests/min.' },
        validate: { keyGeneratorIpFallback: false },
    });

    // --- Mount V2 Routes ---
    app.use('/api/v2', healthRoutes);                         // Phase 15-1: readiness probe (no auth)
    // LLM gateway: mounted before the blanket /api/v2 auth below so guests are not 401'd in strict
    // mode; optionalAuth sets req.userId when a token is present; the AI limiter covers its POSTs.
    app.use(
        '/api/v2/llm',
        optionalAuth,
        originGuard(isAllowedLlmOrigin),
        createLlmRouter({ limiter: aiLimiter, guestBudget: createGuestBudget() }),
    );
    // Course generator (ai.js) requires auth. Scoped to its own paths: chatgptCurriculumRoutes also
    // serves /api/v2/ai/* (generation-kit, curriculum-drafts…) with bridge-token auth further down.
    app.use(['/api/v2/ai/generate', '/api/v2/ai/drafts'], requireAuth);
    app.use('/api/v2/ai', aiLimiter, aiRoutes);              // AI rate limit (keyed by req.userId once authed)
    // AI rate limit for image generation, uploads and RAG indexing (served by contentRoutes below).
    app.use(['/api/v2/image', '/api/v2/upload', '/api/v2/rag'], requireAuth, aiLimiter);
    app.use('/api/v2/user', requireAuth, userRoutes);       // Phase 7: JWT auth
    app.use('/api/v2', chatgptCurriculumRoutes);             // uses own Bridge/JWT auth (§4.6)
    app.use('/api/v2', lifeJournalRoutes);                   // Phase 16: life journal (Bridge/JWT auth)
    app.use('/api/v2', learnerMemoryRoutes);                 // Phase 19: learner semantic memory (Bridge/JWT auth)
    app.use('/api/v2/agent', requireBridgeOrAuth, aiLimiter); // Phase 16-6d: auth before AI rate limit
    app.use('/api/v2', agentRoutes);
    app.use('/api/v2', requireAuth, contentRoutes);          // Phase 7: JWT auth
    app.get('/api/v2/tts/health', optionalAuth, ttsHealthHandler); // lightweight probe — no rate limit
    app.use('/api/v2', optionalAuth, aiLimiter, ttsRoutes);  // Issue #3: Kokoro TTS (+ user prefs when authed)

    // --- Legacy / Other Routes (Keeping for compatibility) ---

    // Legacy Learning Portals (Using Phase 1 Pool directly here for read compatibility)
    // Note: Frontend mostly uses /api/v2 now, but LearningHub might still hit /api/learning-portals
    app.get('/api/learning-portals', async (req, res) => {
        const pool = getPool();
        if (!pool) return res.json({ ok: true, portals: [] }); // Graceful fail
        try {
            const result = await pool.query(
                `SELECT id, title, subtitle, description, view_state, icon_key, color_class, bg_class, border_class, image_url, is_active, sort_order
                 FROM learning_portals WHERE is_active = true ORDER BY sort_order ASC`
            );
            // Simple mapper
            const portals = result.rows.map(row => ({
                id: row.id,
                title: typeof row.title === 'string' ? JSON.parse(row.title) : row.title,
                subtitle: typeof row.subtitle === 'string' ? JSON.parse(row.subtitle) : row.subtitle,
                description: typeof row.description === 'string' ? JSON.parse(row.description) : row.description,
                view: row.view_state,
                icon: row.icon_key,
                color: row.color_class,
                bg: row.bg_class,
                borderColor: row.border_class,
                image: row.image_url,
                isActive: row.is_active,
                sortOrder: row.sort_order
            }));
            res.json({ ok: true, portals });
        } catch (e) {
            if (respondIfDbUnavailable(res, e)) return;
            console.error("Legacy Portal Error", e);
            res.status(500).json({ error: "Legacy Error" });
        }
    });

    if (serveStatic) {
        // --- Static File Serving (Production) ---
        // In production, serve the built frontend from dist/
        const distPath = path.join(__dirname, 'dist');
        try {
            await fs.access(distPath);
            app.use(express.static(distPath));
            // SPA fallback: serve index.html for all non-API, non-asset GET requests.
            app.use((req, res, next) => {
                if (req.method !== 'GET') return next();
                if (req.path.startsWith('/api')) return next();
                if (path.extname(req.path)) return next();
                res.sendFile(path.join(distPath, 'index.html'));
            });
            console.log('[Static] Serving frontend from dist/');
        } catch {
            console.log('[Static] No dist/ found — frontend served separately (dev mode)');
        }

        // Also serve public/ for uploaded/generated assets
        app.use(express.static(path.join(__dirname, 'public')));
    }

    // Last: a database outage no route caught (e.g. pool.connect() before a route's try) still
    // answers 503 JSON instead of Express's HTML 500.
    app.use(dbUnavailableErrorHandler);

    return app;
}

// --- Server Start (only when run as `node server.js`, not when imported by tests) ---
async function main() {
    await loadEnv({ force: [] });
    await initSupabase(); // Initialize Supabase client for JWT validation (Phase 7)
    await logStartupDiagnostics();

    // Checked before createApp so a weak value stops startup with a clear error; never logs values.
    const originSecrets = readOriginSecrets(process.env).length;
    // COMPOSE_PROFILES reaches the api through stack.env: a tunnel without the gate stops here.
    if (tunnelProfileWithoutSecret(process.env)) {
        console.error('[OriginGate] COMPOSE_PROFILES lists tunnel but ORIGIN_SECRET is not set; refusing to start.');
        process.exit(1);
    }
    console.log(originSecrets > 0 ? `[OriginGate] on (${originSecrets} accepted secrets)` : '[OriginGate] off');

    const app = await createApp();
    const PORT = Number.parseInt(process.env.PORT, 10) || 3006;
    jobWorker.start();

    app.listen(PORT, () => {
        console.log(`Rise Path Server running on http://localhost:${PORT}`);
        console.log(`- V2 AI Routes: /api/v2/ai`);
        console.log(`- V2 LLM Gateway: /api/v2/llm`);
        console.log(`- V2 Content Routes: /api/v2`);
        console.log(`- V2 User Routes: /api/v2/user`);
        console.log(`- Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

const isMainModule = (() => {
    try {
        return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(__filename);
    } catch {
        return false;
    }
})();

if (isMainModule) await main();
