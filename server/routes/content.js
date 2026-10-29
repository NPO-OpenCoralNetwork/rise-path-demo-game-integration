import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestMaterial } from '../ragService.js';
import { getPool } from '../db.js';
// Phase 7: req.userId is set by server/middleware/auth.js
// ensurePhase1User() removed — JWT-authenticated users already exist in auth.users
import {
    IMAGE_GENERATION_UNAVAILABLE,
    generateImageWithGemini,
    isImageGenerationAvailable,
} from '../geminiBackendService.js';
import { isEmbeddingConfigured } from '../../tools/core/ragSearch.js';
import { LESSON_UI_TEMPLATE_ID } from '../../tools/core/lessons.js';
import { dailyCap, reserveDailyCap } from '../middleware/dailyCaps.js';
import { isUuid } from '../utils/ids.js';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../'); 

const router = express.Router();

// --- Configuration ---
const DEFAULT_COURSE_CARD = {
    category: 'AI Generated',
    thumbnail: 'https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&q=80&w=800',
    color: 'bg-indigo-500',
};

// --- Upload Setup ---
const uploadDir = path.join(PROJECT_ROOT, 'public/uploads');
const generatedDir = path.join(PROJECT_ROOT, 'public/generated');
const imageCache = new Map();
(async () => {
    try {
        await fs.access(uploadDir);
    } catch {
        await fs.mkdir(uploadDir, { recursive: true });
    }
    try {
        await fs.access(generatedDir);
    } catch {
        await fs.mkdir(generatedDir, { recursive: true });
    }
})();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
// One file per request, at most MAX_UPLOAD_MB: an 'embeddings' unit then covers a bounded file
// (and ragService.js embeds at most MAX_CHUNKS_PER_MATERIAL chunks of it).
const MAX_UPLOAD_MB = 10;
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

/** upload.single('file') with multer's limit errors as JSON: 413 too large, 400 anything else. */
const receiveFile = (req, res, next) => upload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `The file is larger than ${MAX_UPLOAD_MB} MB.`, error_type: 'file_too_large' });
        }
        return res.status(400).json({ error: 'Send one file in the "file" field.', error_type: 'invalid_body' });
    }
    return next(error);
});

// --- Image request limits ---
// 4K costs more per image, and the app only ever asks for 16:9 at 1K.
const IMAGE_PROMPT_MAX_CHARS = 4000;
const IMAGE_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
const IMAGE_SIZES = new Set(['1K', '2K']);

/**
 * Daily 'embeddings' cap: one unit per file processed (server/middleware/dailyCaps.js).
 * - /upload: the unit is kept once the file is stored, whether or not anything was embedded
 *   (embeddings off, or the text could not be read): the cap is also what bounds how many files
 *   an account can store in a day.
 * - /rag/index: the job re-reads a file that is already stored (and was counted at upload), so the
 *   unit pays for embedding only. When embeddings are off (Gemini is not allowed, or no key) the
 *   job embeds nothing and the unit is given back; the per-minute AI limiter still applies.
 * Both give it back when the route ends before the work (400, 404, 413, 500, 503).
 */
const embeddingsCap = dailyCap('embeddings', { refundOnStatus: [400, 404, 413, 500, 503] });

/** The /image answer when this deployment does not generate images (Gemini not allowed, or no key). */
const sendImageUnavailable = (res) => res.status(503).json({
    error: 'Image generation is not available on this server.',
    error_type: IMAGE_GENERATION_UNAVAILABLE,
});

/**
 * Gemini refused an image call before generating anything: no key, a key it does not accept
 * (Gemini answers 400 API_KEY_INVALID, 401 or 403), or its own rate limit (429). Not counted.
 */
const geminiImageNeverRan = (error) => error?.code === 'GEMINI_NOT_CONFIGURED' || [400, 401, 403, 429].includes(error?.status);

// --- Routes ---

// GET /api/v2/curricula — the library: the learner's generated courses, newest first, with their
// lesson count. Left out: a lesson draft (risepath.lesson/v1, previewed at /preview/), and a
// generation still in progress (status draft_<stage>, listed by GET /api/v2/ai/drafts) until it
// has content.
router.get('/curricula', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    try {
        const result = await pool.query(
            `select id, title, description, current_version_id, created_at, category, thumbnail, color, total_lessons
             from curricula
             where user_id = CAST($1 AS uuid)
               and ui_template_id is distinct from $4
               and (not starts_with(coalesce(status, ''), 'draft_') or current_version_id is not null)
             order by created_at desc
             limit $2 offset $3`,
            [req.userId, limit, offset, LESSON_UI_TEMPLATE_ID]
        );
        res.json({ ok: true, curricula: result.rows });
    } catch (error) {
        console.error('[Content API] List Error:', error.message, error.stack);
        res.status(500).json({ error: 'Failed to load curricula' });
    }
});

// GET /api/v2/curricula/:id — an id that is not a UUID is the same 404 as an unknown one.
router.get('/curricula/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

    try {
        const detailRes = await pool.query(`
            SELECT c.*, v.content_json, v.status
            FROM curricula c
            LEFT JOIN curriculum_versions v ON c.current_version_id = v.id
            WHERE c.id = CAST($1 AS uuid) AND c.user_id = CAST($2 AS uuid)
        `, [req.params.id, req.userId]);

        if (detailRes.rowCount === 0) return res.status(404).json({ error: 'Not found' });
        
        const row = detailRes.rows[0];
        const finalContent = row.content_json || row.content;
        
        res.json({
            ok: true,
            course: {
                ...row,
                ...(typeof finalContent === 'object' ? finalContent : {})
            }
        });
    } catch (error) {
        console.error('[Content API] Detail Error:', error.message);
        res.status(500).json({ error: 'Failed to load curriculum' });
    }
});

// POST /api/v2/upload — the daily cap runs before multer, so nothing is stored when it is used up.
router.post('/upload', embeddingsCap, receiveFile, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    try {
        const type = req.file.mimetype.includes('pdf') ? 'pdf' : 
                     req.file.mimetype.includes('audio') ? 'audio' : 'txt';
        const storagePath = `public/uploads/${req.file.filename}`;
        const absolutePath = path.join(PROJECT_ROOT, storagePath);

        const result = await pool.query(
            `insert into materials (user_id, type, title, storage_path, status)
             values (CAST($1 AS uuid), $2, $3, $4, 'uploaded') returning id, status`,
            [req.userId, type, req.file.originalname, storagePath]
        );
        const materialId = result.rows[0].id;

        try {
            // With embeddings off the chunks are stored without vectors (keyword search finds them).
            await ingestMaterial(materialId, absolutePath, req.file.mimetype, req.userId);
            res.json({ ok: true, material_id: materialId, status: 'ready' });
        } catch (ingestErr) {
            console.error('Immediate Ingestion failed:', ingestErr);
            // The unit stays charged even when nothing was embedded: the file and its material row
            // are kept, and the daily cap is what bounds how many files an account can store.
            res.json({ ok: true, material_id: materialId, status: 'uploaded' });
        }
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// POST /api/v2/image
router.post('/image', async (req, res) => {
    const rawPrompt = req.body?.prompt;
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
    console.log(`[Content API] Image request: ${prompt ? `${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}` : '<empty>'}`);
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const aspectRatio = req.body?.aspect_ratio || '16:9';
    const imageSize = req.body?.image_size || '1K';
    const invalid = prompt.length > IMAGE_PROMPT_MAX_CHARS
        ? `prompt must be at most ${IMAGE_PROMPT_MAX_CHARS} characters`
        : !IMAGE_ASPECT_RATIOS.has(aspectRatio)
            ? `aspect_ratio must be one of ${[...IMAGE_ASPECT_RATIOS].join(', ')}`
            : !IMAGE_SIZES.has(imageSize)
                ? `image_size must be one of ${[...IMAGE_SIZES].join(', ')}`
                : null;
    if (invalid) return res.status(400).json({ error: invalid, error_type: 'invalid_body' });

    // Daily 'image' cap: charged only when Gemini is called (cache hits are free). Images already
    // cached on disk are still served when image generation is off.
    let cap = null;
    try {
        const cacheKey = crypto
            .createHash('sha256')
            .update(`${prompt}|${aspectRatio}|${imageSize}`)
            .digest('hex');
        if (imageCache.has(cacheKey)) {
            const cached = imageCache.get(cacheKey);
            return res.json({ ok: true, url: cached.url, mimeType: cached.mimeType, text: '', cached: true });
        }

        await fs.mkdir(generatedDir, { recursive: true });
        const cachedFiles = await fs.readdir(generatedDir).catch(() => []);
        const cachedFile = cachedFiles.find((file) => file.startsWith(`img_${cacheKey}.`));
        if (cachedFile) {
            const ext = cachedFile.split('.').pop();
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
            const url = `/generated/${cachedFile}`;
            imageCache.set(cacheKey, { url, mimeType });
            console.log(`[Content API] Image cache hit: ${url}`);
            return res.json({ ok: true, url, mimeType, text: '', cached: true });
        }

        // Not generated on this deployment: answered before the cap, so nothing is charged.
        if (!isImageGenerationAvailable()) return sendImageUnavailable(res);
        cap = await reserveDailyCap(req, res, 'image');
        if (!cap) return;
        const result = await generateImageWithGemini({
            prompt,
            aspectRatio,
            imageSize
        });
        console.log(`[Content API] Image generated: mime=${result.mimeType || 'image/png'} text=${(result.text || '').slice(0, 60)}`);
        const mimeType = result.mimeType || 'image/png';
        const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
        const fileName = `img_${cacheKey}.${ext}`;
        const outputPath = path.join(generatedDir, fileName);
        try {
            await fs.writeFile(outputPath, Buffer.from(result.data, 'base64'));
        } catch (writeErr) {
            console.warn('[Content API] Failed to write cached image:', writeErr.message);
        }
        const url = `/generated/${fileName}`;
        imageCache.set(cacheKey, { url, mimeType });
        res.json({ ok: true, image: result.data, mimeType, text: result.text, url });
    } catch (error) {
        // The provider's own text stays in this log; the client gets a fixed answer.
        console.error('[Content API] Image Error:', error?.status ?? '', error?.message);
        if (geminiImageNeverRan(error)) void cap?.refund();
        if (error?.code === 'GEMINI_NOT_CONFIGURED') return sendImageUnavailable(res);
        res.status(error?.status === 429 ? 503 : 500).json({ error: 'Image generation failed', error_type: 'image_failed' });
    }
});

// POST /api/v2/rag/index — the indexing job embeds the whole file, so it takes an 'embeddings' unit
// (given back when embeddings are off: see embeddingsCap).
router.post('/rag/index', embeddingsCap, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    
    const materialId = req.body?.material_id;
    if (!isUuid(materialId)) {
        return res.status(400).json({ error: 'material_id must be a UUID', error_type: 'invalid_body' });
    }

    try {
        // Only the caller's own material: the job re-embeds it and rewrites its chunks.
        const owned = await pool.query(
            'select 1 from materials where id = $1::uuid and user_id = $2::uuid',
            [materialId, req.userId]
        );
        if (!owned.rowCount) return res.status(404).json({ error: 'Material not found' });
        const result = await pool.query(
            `insert into jobs (user_id, type, status, payload)
             values (CAST($1 AS uuid), 'ingest', 'queued', $2)
             returning id, status`,
            [req.userId, JSON.stringify({ material_id: materialId })]
        );
        // Embeddings off: the job re-chunks the file and embeds nothing (and keeps a material's
        // stored vectors: ragService.js ingestMaterial), so the unit goes back.
        const embeddingsOn = isEmbeddingConfigured();
        if (!embeddingsOn) void res.locals.refundDailyCap?.();
        res.json({ job_id: result.rows[0].id, status: 'queued', ...(embeddingsOn ? {} : { embeddings: 'off' }) });
    } catch (error) {
        console.error('Job Queue Error:', error);
        res.status(500).json({ error: 'Failed to queue job' });
    }
});

// GET /api/v2/jobs/:id — the caller's own jobs only (an id that is not a UUID: 404, no query);
// `error` is a short code (server/jobWorker.js).
// A job that failed before the worker stored codes may still hold a raw message (absolute paths,
// file names): anything that is not a code reads as 'job_failed'.
const JOB_ERROR_CODE_RE = /^[a-z_]+$/;
router.get('/jobs/:id', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Job not found' });

    try {
        const result = await pool.query(
            'select status, progress, error from jobs where id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)',
            [req.params.id, req.userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Job not found' });
        const job = result.rows[0];
        if (job.error != null && !JOB_ERROR_CODE_RE.test(job.error)) job.error = 'job_failed';
        res.json(job);
    } catch (error) {
        console.error('[Content API] Job status error:', error.message);
        res.status(500).json({ error: 'Failed to check job' });
    }
});

export default router;
