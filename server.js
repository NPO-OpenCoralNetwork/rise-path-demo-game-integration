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
import { isStrictAuthMode } from './server/middleware/authPolicy.js';
import { createOriginGate, readOriginSecrets, tunnelProfileWithoutSecret } from './server/middleware/originGate.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment ---
const loadEnvFile = async (filename) => {
    const envPath = path.join(__dirname, filename);
    try {
        const raw = await fs.readFile(envPath, 'utf8');
        raw.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
            const separatorIndex = normalized.indexOf('=');
            if (separatorIndex === -1) return;
            const key = normalized.slice(0, separatorIndex).trim();
            if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
            let value = normalized.slice(separatorIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        });
    } catch (error) {
        if (error?.code !== 'ENOENT') console.warn(`Failed to load ${filename}:`, error);
    }
};
// Legacy Learning Portals read the Phase 1 pool directly (see the route in createApp).
import { getPool } from './server/db.js';

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

    // AI Heavy: 10 req/min/userId (Gemini API cost protection). Guests are keyed by IP, with IPv6
    // addresses grouped by subnet so rotating addresses within one network does not reset the limit.
    const aiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: isDev ? 100 : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
        message: { error: 'AI rate limit exceeded. Max 10 requests/min.' },
    });

    // TTS: guests may synthesize outside strict mode only. Strict mode (production) has always
    // required a user here; opening it to guests is an owner decision, not a side effect of the
    // mount order.
    const ttsAuth = (req, res, next) => (isStrictAuthMode() ? requireAuth : optionalAuth)(req, res, next);

    // --- Mount V2 Routes ---
    // Every guard covers only the paths it protects. A mount on the bare /api/v2 prefix runs for
    // every later /api/v2 request, which used to stack up to four guards on one request and spend
    // the AI budget on ordinary reads. Guards that do run on the same request share one Supabase
    // getUser call (verifyJwtOnce). The AI limiter runs after auth (keyed by user) and only on the
    // POSTs that spend model or TTS time: /ai/generate, /image, /upload and /rag/index (embeddings),
    // /tts/synthesize and /agent/chat.
    app.use('/api/v2', healthRoutes);                         // Phase 15-1: readiness probe (no auth)
    // LLM gateway: optionalAuth sets req.userId when a token is present, so guests are not 401'd in
    // strict mode; the gateway router applies the AI limiter to its own POSTs.
    app.use(
        '/api/v2/llm',
        optionalAuth,
        originGuard(isAllowedLlmOrigin),
        createLlmRouter({ limiter: aiLimiter, guestBudget: createGuestBudget() }),
    );
    // Course generator (ai.js) requires auth. Scoped to its own paths: chatgptCurriculumRoutes also
    // serves /api/v2/ai/* (generation-kit, curriculum-drafts…) with bridge-token auth further down.
    app.use(['/api/v2/ai/generate', '/api/v2/ai/drafts'], requireAuth);
    app.post('/api/v2/ai/generate', aiLimiter);
    app.use('/api/v2/ai', aiRoutes);
    app.post('/api/v2/image', requireAuth, aiLimiter);       // the route itself is in contentRoutes
    app.use('/api/v2/user', requireAuth, userRoutes);       // Phase 7: JWT auth
    app.use('/api/v2', chatgptCurriculumRoutes);             // per-route Bridge/JWT auth (§4.6)
    app.use('/api/v2', lifeJournalRoutes);                   // Phase 16: per-route Bridge/JWT auth
    app.use('/api/v2', learnerMemoryRoutes);                 // Phase 19: Bridge/JWT auth on /learner-memory
    app.use('/api/v2/agent', requireBridgeOrAuth);           // Phase 16-6d: agent paths only
    app.post('/api/v2/agent/chat', aiLimiter);
    app.use('/api/v2', agentRoutes);
    app.get('/api/v2/tts/health', ttsHealthHandler);         // public probe — no auth, no rate limit
    app.use('/api/v2/tts', ttsAuth);                         // Issue #3: every other TTS path (user prefs when authed)
    app.post('/api/v2/tts/synthesize', aiLimiter);
    app.use('/api/v2', ttsRoutes);
    // Content POSTs that spend embeddings (the routes themselves are in contentRoutes).
    app.post(['/api/v2/upload', '/api/v2/rag/index'], requireAuth, aiLimiter);
    // Last: requireAuth on the bare prefix also answers every unmatched /api/v2 path.
    app.use('/api/v2', requireAuth, contentRoutes);          // Phase 7: JWT auth

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

    return app;
}

// --- Server Start (only when run as `node server.js`, not when imported by tests) ---
async function main() {
    await loadEnvFile('.env.local');
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
