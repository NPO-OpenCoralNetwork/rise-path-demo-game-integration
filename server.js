import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import { STATUS_CODES } from 'http';
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
import userRoutes, { LEARNING_EVENTS_BODY_LIMIT, createLearningEventsRouter } from './server/routes/user.js';
import healthRoutes from './server/routes/health.js';
import aiAccessRoutes from './server/routes/aiAccess.js';
import connectedAppsRoutes from './server/routes/connectedApps.js';
import {
    createLessonProgressRouter,
    lessonProgressBodyErrors,
    LESSON_PROGRESS_BODY_LIMIT,
    LESSON_PROGRESS_WRITES_PER_MINUTE,
} from './server/routes/lessonProgress.js';
import { ACCOUNT_BODY_LIMIT, createAccountRouter } from './server/routes/account.js';
import { LEGAL_BODY_LIMIT, createLegalRouter } from './server/routes/legal.js';
import { ACHIEVEMENTS_READS_PER_MINUTE, createAchievementsRouter } from './server/routes/achievements.js';
import { REVIEW_BODY_LIMIT, REVIEW_REQUESTS_PER_MINUTE, createReviewRouter } from './server/routes/review.js';
import { TRAINING_BODY_LIMIT, createTrainingRouter } from './server/routes/training.js';
import safetyRoutes from './server/routes/safety.js';
import { pruneSafetyEvents } from './server/safety/events.js';
import { readRetentionConfig, retentionStartupLine, runRetention, RETENTION_INTERVAL_MS } from './server/services/retention.js';
import { maybePruneTtsCache, TTS_CACHE_SWEEP_INTERVAL_MS } from './tools/core/kokoroTts.js';
import { describeError, redactUrl } from './server/utils/redactUrl.js';
import { isDbUnavailable } from './tools/core/dbErrors.js';
import { blockLegacyUploads } from './server/uploads.js';
import adminSafetyRoutes from './server/routes/adminSafety.js';
import { createLlmRouter } from './server/routes/llm.js';
import { createGuestBudget, createOriginPolicy, originGuard } from './server/llm/guestAccess.js';
import { dailyCap, setPlanResolver } from './server/middleware/dailyCaps.js';
import { createBillingRouter } from './server/routes/billing.js';
import { billingStartupLine, checkBillingServiceable, readBillingConfig } from './server/services/billingConfig.js';
import { createSupporterCapResolver } from './server/services/billingEntitlement.js';
import { BILLING_WEBHOOK_BODY_LIMIT, BILLING_WEBHOOK_PATH, createBillingWebhook } from './server/services/billingWebhook.js';
import { createStripeClient } from './server/services/stripeClient.js';
import { logStartupDiagnostics } from './server/services/runtimeHealth.js';
import { requireAuth, optionalAuth, initSupabase } from './server/middleware/auth.js';
import { requireBridgeOrAuth } from './server/middleware/bridgeAuth.js';
import { requireSignedIn } from './server/middleware/signedIn.js';
import { smallBodyErrors } from './server/middleware/smallBody.js';
import { aiAccessGate, aiAccessStartupWarnings } from './server/middleware/aiAccessGate.js';
import { legalStartupWarnings } from './server/middleware/termsGate.js';
import { pilotStartupLines } from './server/middleware/pilotGate.js';
import { requireAdmin } from './server/middleware/requireAdmin.js';
import { createOriginGate, readOriginSecrets, tunnelProfileWithoutSecret } from './server/middleware/originGate.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Retry-After of a 503 for a database that cannot be reached (the last error handler). */
const DB_RETRY_AFTER_SECONDS = 10;
/** The JSON body limit of every route without a smaller one of its own (createApp). */
const JSON_BODY_LIMIT = '2mb';

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
 * @param {{ serveStatic?: boolean, originGate?: Parameters<typeof createOriginGate>[0],
 *   lessonProgress?: { afterSave?: (params: { userId: string }) => unknown },
 *   review?: { afterGrade?: (params: { userId: string, day: string }) => unknown } }} [options]
 *   serveStatic: dist/ + public/ (off in tests); originGate: options for the origin gate
 *   (server/middleware/originGate.js; tests pass exemptLoopback: false); lessonProgress.afterSave:
 *   the hook after a lesson-progress save that taught something (default: XP and the learning day,
 *   tools/core/achievements.js noteLearning; route tests pass a no-op or a recorder);
 *   review.afterGrade: the hook after a review graded on the web (Phase 6; default: the grade's
 *   Japan-time day as a learning day, tools/core/achievements.js noteReviewDay; route tests pass a
 *   recorder)
 */
export async function createApp({ serveStatic = true, originGate = {}, lessonProgress: { afterSave } = {}, review: { afterGrade } = {} } = {}) {
    const app = express();
    app.disable('x-powered-by');

    // Behind a reverse proxy, TRUST_PROXY (hop count, or true/false) makes req.ip the client IP, so
    // the per-IP limits below key on real addresses.
    const trustProxy = process.env.TRUST_PROXY;
    if (trustProxy) {
        const hops = Number.parseInt(trustProxy, 10);
        app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy === 'true');
    }

    // Billing (Phase 3): read once per app. The supporter caps resolve through it on the shared
    // daily caps (dailyCaps.js); mcp-public never sets a resolver. Off (no resolver, no plan field in
    // 429 bodies) unless billing is serviceable (server/services/billingConfig.js).
    const billingConfig = readBillingConfig(process.env, { nodeEnv: process.env.NODE_ENV });
    const stripe = billingConfig.serviceable ? createStripeClient({ secretKey: billingConfig.secretKey }) : null;
    setPlanResolver(billingConfig.serviceable ? createSupporterCapResolver({ config: billingConfig }) : null);

    // --- Middleware ---
    // Origin gate first: with ORIGIN_SECRET set, non-loopback requests without the edge's secret
    // get 403 before CORS, body parsing, logging or the limiters run (and before any body is read).
    // Without it, only requests that came through Cloudflare get 403.
    app.use(createOriginGate({ ...originGate }));
    // Every response: no MIME sniffing. API responses: not cached by Vercel, Cloudflare or the
    // browser unless a route sets its own Cache-Control later (llm.js, agent.js streams).
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // CORS: the whole API answers only the app's own origins (server/llm/guestAccess.js
    // createOriginPolicy: LLM_ALLOWED_ORIGINS, the same host, and outside production localhost,
    // 127.0.0.1 and port 3007 on any host). A page on another site can then neither read the
    // API's answers nor send it JSON or an Authorization header, which need a preflight. (CORS is
    // not access control: a simple request still runs. The LLM gateway also refuses a POST from
    // another origin: originGuard below.)
    const isAllowedOrigin = createOriginPolicy();
    const apiCors = cors((req, callback) => callback(null, { origin: isAllowedOrigin(req.headers.origin, req) }));
    app.use((req, res, next) => {
        // The CORS headers depend on the Origin, also when there are none.
        res.vary('Origin');
        // apiCors ends every OPTIONS it allows with 204; a refused one ends here, without CORS
        // headers, before auth (a 401 in the log) and the rate limits.
        if (req.method === 'OPTIONS' && !isAllowedOrigin(req.headers.origin, req)) return res.status(204).end();
        return apiCors(req, res, next);
    });
    // Lesson progress has its own, smaller body limit. Registered first: the 2 MB parser below
    // then sees the body as already read and skips it.
    app.use('/api/v2/user/lesson-progress', express.json({ limit: LESSON_PROGRESS_BODY_LIMIT }), lessonProgressBodyErrors);
    // Account deletion (Phase 4) takes a confirm word and the AI apps' names: 16 kb, refused before the 2 MB parser.
    app.use('/api/v2/user/account', express.json({ limit: ACCOUNT_BODY_LIMIT }), smallBodyErrors(ACCOUNT_BODY_LIMIT));
    // Accepting the terms (Phase 4) takes two version ids: 4 kb, refused before the 2 MB parser too.
    app.use('/api/v2/user/legal', express.json({ limit: LEGAL_BODY_LIMIT }), smallBodyErrors(LEGAL_BODY_LIMIT));
    // A learning-history event (Phase 5: history only) is a type and two short texts: 8 kb, refused before the 2 MB parser.
    app.use('/api/v2/user/events', express.json({ limit: LEARNING_EVENTS_BODY_LIMIT }), smallBodyErrors(LEARNING_EVENTS_BODY_LIMIT));
    // The review queue (Phase 6) takes three ids and a rating: 2 kb, refused before the 2 MB parser.
    app.use('/api/v2/user/review', express.json({ limit: REVIEW_BODY_LIMIT }), smallBodyErrors(REVIEW_BODY_LIMIT));
    // Job training (training-plan §4.2): small bodies only, refused before the 2 MB parser.
    app.use('/api/v2/training', express.json({ limit: TRAINING_BODY_LIMIT }), smallBodyErrors(TRAINING_BODY_LIMIT));
    // Stripe's webhook needs the exact bytes it signed: only the raw parser here (the 2 MB JSON
    // parser below then skips the body); the handler is mounted with the billing routes, after the
    // logger and the global limiter.
    app.post(BILLING_WEBHOOK_PATH, express.raw({ type: 'application/json', limit: BILLING_WEBHOOK_BODY_LIMIT }));
    // Every other JSON body: 2 MB (the last handler answers a refusal as JSON). The largest real
    // one, a curriculum draft (titles and goals of at most 12 x 10 lessons), is far smaller;
    // uploads are multipart, which no JSON parser reads.
    app.use(express.json({ limit: JSON_BODY_LIMIT }));

    // Logging Middleware (Phase 8: includes authMethod). originalUrl: req.url is cut to the mount
    // path when a scoped middleware (e.g. /api/v2/agent auth) answers. redactUrl (Phase 4): no query
    // string, ids cut to 8 characters, no dates, emails, file names or tokens (server/utils/redactUrl.js).
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const ms = Date.now() - start;
            const auth = req.authMethod || '-';
            console.log(`[${new Date().toISOString()}] ${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${ms}ms auth=${auth}`);
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
        // Guests by address, an IPv6 one by its /56 (one connection can switch inside it).
        keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip ?? ''),
        message: { error: 'AI rate limit exceeded. Max 10 requests/min.' },
        validate: { keyGeneratorIpFallback: false },
    });

    // Lesson progress writes: per learner (after requireAuth), so a classroom behind one address
    // shares only the global limit above. Not relaxed in dev: the client saves at most every 20 s.
    const lessonProgressLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: LESSON_PROGRESS_WRITES_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `lesson-progress:${req.userId}`,
        message: { error: 'Too many progress saves. Please try again in a minute.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    // XP and badges (Phase 5): each read reconciles the learner's ledger, so per learner, after
    // requireAuth and requireSignedIn. Not relaxed in dev.
    const achievementsLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: ACHIEVEMENTS_READS_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `achievements:${req.userId}`,
        message: { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    // The review queue (Phase 6): reads (each enters the learner's due cards) and grades together,
    // per learner, after requireAuth and requireSignedIn. Not relaxed in dev.
    const reviewLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: REVIEW_REQUESTS_PER_MINUTE,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `review:${req.userId}`,
        message: { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' },
        validate: { keyGeneratorIpFallback: false },
    });

    // --- Mount V2 Routes ---
    // AI access gate (Phase 0.5 minor safeguards, server/middleware/aiAccessGate.js): every POST
    // that calls a model needs sign-in (guests only with LLM_GUEST_AI=true), a recorded age and, under
    // 18, a guardian's consent. It runs after auth and before the daily caps, so a refused call is
    // never charged, and sets res.locals.aiAudience for the safety checks.
    // Terms check (Phase 8, server/middleware/termsGate.js; off unless LEGAL_TERMS_REQUIRED): it runs
    // inside requireAuth, optionalAuth and requireBridgeOrAuth, so every route below that a learner's
    // session reaches is gated, except its TERMS_EXEMPT list. A new learner route: decide there.
    app.use('/api/v2', healthRoutes);                         // Phase 15-1: readiness probe (no auth)
    // The supporter plan (Phase 3): Stripe's webhook (signed, no JWT) and the billing routes (public
    // GET /plan; requireAuth inside for the rest). Before the requireAuth catch-all below.
    app.post(BILLING_WEBHOOK_PATH, createBillingWebhook({ config: billingConfig, stripe }));
    app.use('/api/v2/billing', createBillingRouter({ config: billingConfig, stripe }));
    // LLM gateway: mounted before the blanket /api/v2 auth below so guests are not 401'd in strict
    // mode; optionalAuth sets req.userId when a token is present; the AI limiter covers its POSTs.
    // GET /status stays public and ungated; the POSTs run the gate inside guarded() (llm.js).
    app.use(
        '/api/v2/llm',
        optionalAuth,
        originGuard(isAllowedOrigin),
        createLlmRouter({
            limiter: aiLimiter,
            guestBudget: createGuestBudget(),
            userCap: dailyCap('llm'),
            aiAccess: aiAccessGate(),
        }),
    );
    // Course generator (ai.js) requires auth. Scoped to its own paths: chatgptCurriculumRoutes also
    // serves /api/v2/ai/* (generation-kit, curriculum-drafts…) with bridge-token auth further down.
    app.use(['/api/v2/ai/generate', '/api/v2/ai/drafts'], requireAuth);
    app.use('/api/v2/ai', aiLimiter);                        // AI rate limit (keyed by req.userId once authed)
    app.post('/api/v2/ai/generate', aiAccessGate());          // before its daily cap (inside ai.js)
    app.use('/api/v2/ai', aiRoutes);
    // AI rate limit for image generation, uploads and RAG indexing (served by contentRoutes below).
    app.use(['/api/v2/image', '/api/v2/upload', '/api/v2/rag'], requireAuth, aiLimiter);
    // Image generation and Hermes (/agent/chat) have no minor screening and no child-safety prompt
    // part, so they are adults only (403 adults_only for a minor, even with a guardian consent).
    app.post('/api/v2/image', aiAccessGate({ adultsOnly: true })); // before its daily cap (content.js)
    // The learner's age and guardian consent (server/routes/aiAccess.js).
    app.use('/api/v2/user/ai-access', requireAuth, aiAccessRoutes);
    // Agents the learner connected to the remote MCP endpoint with OAuth (Phase 1). requireAuth
    // refuses an agent's own OAuth token (401 oauth_client_token), so an agent cannot revoke or list.
    app.use('/api/v2/user/connected-apps', requireAuth, connectedAppsRoutes);
    // The lesson reader's progress, synced across the learner's devices (Phase 2). Not AI-gated:
    // progress is not an AI feature. requireAuth refuses an agent's OAuth token (agents use the
    // MCP course-* tools). Before the /api/v2/user mount, whose legacy /progress routes stay.
    app.use('/api/v2/user/lesson-progress', requireAuth, createLessonProgressRouter({ writeLimiter: lessonProgressLimiter, afterSave }));
    // Deleting one's own Rise Path account (Phase 4, server/routes/account.js): a real learner's
    // session only, re-authenticated with the password; the shared Supabase login stays.
    app.use(
        '/api/v2/user/account',
        requireAuth,
        requireSignedIn('Sign in with a Rise Path account to delete it.'),
        createAccountRouter({ billing: { config: billingConfig, stripe } }),
    );
    // Accepting the terms of use (Phase 4, server/routes/legal.js): a real learner's session only;
    // the acceptance is recorded under the shared account lock (never for an account deleted meanwhile).
    app.use(
        '/api/v2/user/legal',
        requireAuth,
        requireSignedIn('Sign in with a Rise Path account to accept the terms.'),
        createLegalRouter(),
    );
    // XP, level, streak and badges (Phase 5, server/routes/achievements.js), from the server's own
    // records: a real learner's session only (the ledger is a permanent account record; dev guests
    // would share one). GET only, no body. AI apps get nothing (requireAuth refuses their token).
    app.use(
        '/api/v2/user/achievements',
        requireAuth,
        requireSignedIn('Sign in with a Rise Path account to see your XP.'),
        achievementsLimiter,
        createAchievementsRouter(),
    );
    // The review queue (Phase 6, server/routes/review.js): a real learner's session only (the queue is an
    // account record); each read enters the cards the learner's lesson records imply. AI apps use the
    // MCP course-review-* tools (requireAuth refuses their token here).
    app.use(
        '/api/v2/user/review',
        requireAuth,
        requireSignedIn('Sign in with a Rise Path account to use reviews.'),
        reviewLimiter,
        createReviewRouter({ afterGrade }),
    );
    // Job training (training-plan D1, D5; server/routes/training.js): 404 unless TRAINING_ENABLED=true,
    // then requireAuth, requireSignedIn and a per-learner limit inside the router. Before /api/v2/user
    // and the /api/v2 catch-alls, whose AI limiter would count training calls.
    app.use('/api/v2/training', createTrainingRouter());
    // The learning history (Phase 5: history only, no XP and no learning day; server/routes/user.js):
    // its own router so its per-learner limit lives with this app, after the 8 kb parser above.
    app.use('/api/v2/user/events', requireAuth, createLearningEventsRouter());
    app.use('/api/v2/user', requireAuth, userRoutes);       // Phase 7: JWT auth
    // Reports on AI answers (any signed-in user), and the admin side: safety reports, a learner's
    // age and a guardian's paper consent. The admin role is read on the server (requireAdmin.js).
    app.use('/api/v2/safety', requireAuth, safetyRoutes);
    app.use('/api/v2/admin', requireAuth, requireAdmin, adminSafetyRoutes);
    app.use('/api/v2', chatgptCurriculumRoutes);             // uses own Bridge/JWT auth (§4.6)
    app.use('/api/v2', lifeJournalRoutes);                   // Phase 16: life journal (Bridge/JWT auth)
    app.use('/api/v2', learnerMemoryRoutes);                 // Phase 19: learner semantic memory (Bridge/JWT auth)
    app.use('/api/v2/agent', requireBridgeOrAuth, aiLimiter); // Phase 16-6d: auth before AI rate limit
    app.post('/api/v2/agent/chat', aiAccessGate({ adultsOnly: true })); // adults only (see /image); before its daily cap (agent.js)
    app.use('/api/v2', agentRoutes);
    app.use('/api/v2', requireAuth, contentRoutes);          // Phase 7: JWT auth
    // TTS: in strict mode the requireAuth just above already answered a guest with 401, the health
    // probe too, so the app shows voice as unavailable to guests (synthesize refuses them as well).
    // optionalAuth reuses that check of the session (auth.js: one check per request).
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
            console.error("Legacy Portal Error", e);
            res.status(500).json({ error: "Legacy Error" });
        }
    });

    if (serveStatic) {
        // --- Static File Serving (Production) ---
        // Uploads are private (server/uploads.js): files older versions left in public/uploads (and
        // copied into dist/ by a build made next to them) answer 404, before either static server.
        app.use(blockLegacyUploads());
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

        // Also serve public/ for generated assets (not uploads: see above)
        app.use(express.static(path.join(__dirname, 'public')));
    }

    // Last: an error no route answered (a handler that rejected, pool.connect() failing, a body the
    // JSON parser refused) gets JSON with its status's standard text. The error is logged, never
    // sent: Express's own handler sends the stack (database text included) outside production. The
    // line has its name, code and message only: a pg error's detail holds values (Phase 4). A
    // database that cannot be reached is a 503 with Retry-After, so clients try again later.
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const code = err?.status ?? err?.statusCode;
        const unavailable = isDbUnavailable(err);
        if (unavailable) res.set('Retry-After', String(DB_RETRY_AFTER_SECONDS));
        const status = unavailable ? 503 : Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
        if (status >= 500) console.error(`[Server] ${req.method} ${redactUrl(req.originalUrl)} failed: ${describeError(err)}`);
        res.status(status).json({ error: STATUS_CODES[status] ?? 'Internal Server Error' });
    });

    return app;
}

// --- Server Start (only when run as `node server.js`, not when imported by tests) ---
async function main() {
    await loadEnvFile('.env.local');
    await initSupabase(); // Initialize Supabase client for JWT validation (Phase 7)
    await logStartupDiagnostics();
    for (const warning of aiAccessStartupWarnings(process.env)) console.warn(warning);
    // The terms check (Phase 8, LEGAL_TERMS_REQUIRED): one line only when the switch is set.
    for (const warning of legalStartupWarnings(process.env)) console.warn(warning);
    // The pilot list (Phase 9, D1; PILOT_ACCOUNT_IDS): '[Pilot] off' or the count, never an id.
    for (const line of pilotStartupLines(process.env)) console.log(line);
    // One line, names only; an owner alert when subscribers exist but billing cannot serve them.
    const billingConfig = readBillingConfig(process.env, { nodeEnv: process.env.NODE_ENV });
    console.log(billingStartupLine(billingConfig));
    void checkBillingServiceable(billingConfig);

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
    // Safety-event retention (90-day report text, 365-day events) on a timer, not only when traffic
    // records a new event; the admin queries also enforce it.
    void pruneSafetyEvents(undefined, { force: true });
    setInterval(() => void pruneSafetyEvents(undefined, { force: true }), 60 * 60 * 1000).unref();
    // Retention (Phase 4, server/services/retention.js): old usage counts, processing records and
    // the proofs of deleted accounts, hourly. An invalid setting turns its rule off (logged). Outside
    // NODE_ENV=production it runs only with RETENTION_ENABLED=true (a laptop api on the VM database).
    const retention = readRetentionConfig(process.env, { nodeEnv: process.env.NODE_ENV });
    for (const problem of retention.problems) console.warn(`[Retention] ${problem}`);
    console.log(retentionStartupLine(retention));
    if (retention.enabled) {
        void runRetention({ config: retention });
        setInterval(() => void runRetention({ config: retention }), RETENTION_INTERVAL_MS).unref();
    }
    // The TTS audio cache (tools/core/kokoroTts.js, Phase 9 D3) also prunes on a timer, so audio older
    // than 30 days goes within about an hour even when no new audio is written. Local files only.
    void maybePruneTtsCache();
    setInterval(() => void maybePruneTtsCache(), TTS_CACHE_SWEEP_INTERVAL_MS).unref();

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
