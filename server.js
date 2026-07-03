import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg'; // For legacy pool if needed, or remove
import { generateAudioContent } from './scripts/kokoro_tts_node.js';
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
import { logStartupDiagnostics } from './server/services/runtimeHealth.js';
import { requireAuth, optionalAuth, initSupabase } from './server/middleware/auth.js';
import { requireBridgeOrAuth } from './server/middleware/bridgeAuth.js';
import rateLimit from 'express-rate-limit';

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
await loadEnvFile('.env.local');
await initSupabase(); // Initialize Supabase client for JWT validation (Phase 7)
await logStartupDiagnostics();

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3006;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Logging Middleware (Phase 8: includes authMethod)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        const auth = req.authMethod || '-';
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${ms}ms auth=${auth}`);
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
app.use('/api/v2/ai', aiLimiter, aiRoutes);             // deprecated (410 Gone) + AI rate limit
app.use('/api/v2/image', requireAuth, aiLimiter);        // AI rate limit for image generation
app.use('/api/v2/user', requireAuth, userRoutes);       // Phase 7: JWT auth
app.use('/api/v2', chatgptCurriculumRoutes);             // uses own Bridge/JWT auth (§4.6)
app.use('/api/v2', lifeJournalRoutes);                   // Phase 16: life journal (Bridge/JWT auth)
app.use('/api/v2', learnerMemoryRoutes);                 // Phase 19: learner semantic memory (Bridge/JWT auth)
app.use('/api/v2', requireBridgeOrAuth, aiLimiter, agentRoutes); // Phase 16-6d: auth before AI rate limit
app.use('/api/v2', requireAuth, contentRoutes);          // Phase 7: JWT auth
app.get('/api/v2/tts/health', optionalAuth, ttsHealthHandler); // lightweight probe — no rate limit
app.use('/api/v2', optionalAuth, aiLimiter, ttsRoutes);  // Issue #3: Kokoro TTS (+ user prefs when authed)

// --- Legacy / Other Routes (Keeping for compatibility) ---

// Audio Generation (could be moved to content.js but keeping here for simplicity)
app.post('/api/generate-audio', async (req, res) => {
    const courseData = req.body;
    const courseId = courseData.id;
    if (!courseId) return res.status(400).json({ error: 'Course ID is missing' });

    res.json({ message: 'Audio generation started (Kokoro TTS)', courseId, engine: 'kokoro-82m-onnx' });
    console.log(`Starting Kokoro TTS for course: ${courseId}`);

    // Background process
    (async () => {
        try {
            const baseDir = path.join(__dirname, 'public/data/audio', courseId);
            await fs.mkdir(baseDir, { recursive: true });
            const chapters = courseData.chapters || [];
            for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
                const slides = chapters[chIdx].slides || [];
                for (let sIdx = 0; sIdx < slides.length; sIdx++) {
                    const slide = slides[sIdx];
                    let text = slide.speechScript;
                    if (!text || text.trim().length === 0) {
                        const bullets = slide.bullets || [];
                        text = bullets.length > 0 ? bullets.join(". ") : slide.title;
                    }
                    if (!text) continue;
                    const filename = `${chIdx}_${sIdx}.mp3`;
                    const filepath = path.join(baseDir, filename);
                    try {
                        const audioBase64 = await generateAudioContent(text, { language: 'ja' });
                        const audioBuffer = Buffer.from(audioBase64, 'base64');
                        await fs.writeFile(filepath, audioBuffer);
                    } catch (err) {
                        console.error(`Audio Error ${filename}:`, err);
                    }
                }
            }
            console.log(`Audio generation done for: ${courseId}`);
        } catch (error) {
            console.error(`Audio Fatal Error:`, error);
        }
    })();
});

// Legacy Learning Portals (Using Phase 1 Pool directly here for read compatibility)
// Note: Frontend mostly uses /api/v2 now, but LearningHub might still hit /api/learning-portals
// We can redirect or reimplement using db.js if needed.
// For now, let's include a minimal legacy handler using the shared pool.
import { getPool } from './server/db.js';

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

// --- Server Start ---
jobWorker.start();

app.listen(PORT, () => {
    console.log(`Rise Path Server running on http://localhost:${PORT}`);
    console.log(`- V2 AI Routes: /api/v2/ai`);
    console.log(`- V2 Content Routes: /api/v2`);
    console.log(`- V2 User Routes: /api/v2/user`);
    console.log(`- Environment: ${process.env.NODE_ENV || 'development'}`);
});
