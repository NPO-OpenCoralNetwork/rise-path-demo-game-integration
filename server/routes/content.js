import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestMaterial } from '../ragService.js';
import { getPool } from '../db.js';
import { respondIfDbUnavailable } from '../dbUnavailable.js';
import {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_MB,
    UNSUPPORTED_UPLOAD,
    acceptedUpload,
    privateUploadStorage,
    storagePathFor,
    uploadTitle,
} from '../uploads.js';
import { isUuid } from '../../tools/core/ids.js';
// Phase 7: req.userId is set by server/middleware/auth.js
// ensurePhase1User() removed — JWT-authenticated users already exist in auth.users
import { generateImageWithGemini } from '../geminiBackendService.js';
import { errorDetail } from '../errorDetail.js';

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
// Uploaded materials are private (server/uploads.js): outside public/, under a random name, PDF /
// text / Markdown up to 20 MB. Generated images stay in public/generated, which the app serves.
const generatedDir = path.join(PROJECT_ROOT, 'public/generated');
const imageCache = new Map();
(async () => {
    try {
        await fs.access(generatedDir);
    } catch {
        await fs.mkdir(generatedDir, { recursive: true });
    }
})();

const upload = multer({
    storage: privateUploadStorage,
    // The file and nothing else: busboy kept any number of 1 MB fields in memory, and a second file
    // or any field now stops the upload before it is read. (busboy's `parts` limit fires when it is
    // reached, so `parts: 1` would refuse the file itself.)
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
    // Browsers send the file name in UTF-8; multer's default (latin1) garbled Japanese titles.
    defParamCharset: 'utf8',
    fileFilter: (req, file, cb) => {
        if (acceptedUpload(file.originalname, file.mimetype)) return cb(null, true);
        cb(Object.assign(new Error('Unsupported file type'), { code: UNSUPPORTED_UPLOAD }));
    },
});

// Errors from the disk rather than from what the client sent.
const DISK_ERRORS = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EDQUOT', 'EMFILE', 'ENFILE', 'EROFS', 'EIO', 'UPLOAD_DIR_SERVED']);

/**
 * Reads the upload (a failed or aborted upload leaves no file behind) and turns its errors into
 * answers: 413 too large, 415 not PDF / text / Markdown, 500 for the disk, and 400 for anything
 * else the client sent (malformed multipart, extra fields or files, an aborted request). Without a
 * database there is nowhere to record the material, so the body is not read at all.
 */
const receiveUpload = (req, res, next) => {
    if (!getPool()) return res.status(503).json({ error: 'DB not configured' });
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `The file is larger than ${MAX_UPLOAD_MB} MB.`, error_type: 'file_too_large' });
        }
        if (err.code === UNSUPPORTED_UPLOAD) {
            return res.status(415).json({
                error: 'Only PDF, text (.txt) and Markdown (.md) files can be uploaded.',
                error_type: UNSUPPORTED_UPLOAD,
            });
        }
        if (DISK_ERRORS.has(err.code)) {
            console.error('Upload Error:', err);
            return res.status(500).json({ error: 'Upload failed' });
        }
        return res.status(400).json({ error: 'Invalid upload', error_type: 'validation' });
    });
};

// --- Routes ---

// GET /api/v2/curricula
router.get('/curricula', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    try {
        const result = await pool.query(
            `select id, title, description, current_version_id, created_at, category, thumbnail, color
             from curricula
             where user_id = CAST($1 AS uuid)
             order by created_at desc
             limit $2 offset $3`,
            [req.userId, limit, offset]
        );
        res.json({ ok: true, curricula: result.rows });
    } catch (error) {
        if (respondIfDbUnavailable(res, error)) return;
        console.error('[Content API] List Error:', error.message, error.stack);
        res.status(500).json({ error: 'Failed to load curricula', ...errorDetail(error) });
    }
});

// GET /api/v2/curricula/:id
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
        if (respondIfDbUnavailable(res, error)) return;
        console.error('[Content API] Detail Error:', error.message);
        res.status(500).json({ error: 'Failed to load curriculum', ...errorDetail(error) });
    }
});

// POST /api/v2/upload
router.post('/upload', receiveUpload, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const kind = acceptedUpload(req.file.originalname, req.file.mimetype);
    try {
        const result = await pool.query(
            `insert into materials (user_id, type, title, storage_path, status)
             values (CAST($1 AS uuid), $2, $3, $4, 'uploaded') returning id, status`,
            [req.userId, kind.type, uploadTitle(req.file.originalname), storagePathFor(req.file.path)]
        ).catch(async (insertErr) => {
            // No material row will point at the file: remove it before answering.
            await fs.unlink(req.file.path).catch(() => {});
            throw insertErr;
        });
        const materialId = result.rows[0].id;

        try {
            await ingestMaterial(materialId, req.file.path, kind.mimeType, req.userId);
            res.json({ ok: true, material_id: materialId, status: 'ready' });
        } catch (ingestErr) {
            console.error('Immediate Ingestion failed:', ingestErr);
            res.json({ ok: true, material_id: materialId, status: 'uploaded' });
        }
    } catch (error) {
        if (respondIfDbUnavailable(res, error)) return;
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// POST /api/v2/image
router.post('/image', async (req, res) => {
    const rawPrompt = req.body?.prompt;
    const prompt = (rawPrompt || '').trim();
    console.log(`[Content API] Image request: ${prompt ? `${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}` : '<empty>'}`);
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    try {
        const aspectRatio = req.body?.aspect_ratio || '16:9';
        const imageSize = req.body?.image_size || '1K';
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
        console.error('[Content API] Image Error:', error.message);
        res.status(500).json({ error: 'Image generation failed', ...errorDetail(error) });
    }
});

// POST /api/v2/rag/index
router.post('/rag/index', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });
    
    const { material_id } = req.body;
    if (!material_id) return res.status(400).json({ error: 'material_id required' });
    if (!isUuid(material_id)) return res.status(404).json({ error: 'Material not found' });

    try {
        // Only the caller's own materials can be (re)ingested.
        const owned = await pool.query(
            'select id from materials where id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)',
            [material_id, req.userId]
        );
        if (!owned.rowCount) return res.status(404).json({ error: 'Material not found' });

        const result = await pool.query(
            `insert into jobs (user_id, type, status, payload)
             values (CAST($1 AS uuid), 'ingest', 'queued', $2)
             returning id, status`,
            [req.userId, JSON.stringify({ material_id })]
        );
        res.json({ job_id: result.rows[0].id, status: 'queued' });
    } catch (error) {
        if (respondIfDbUnavailable(res, error)) return;
        console.error('Job Queue Error:', error);
        res.status(500).json({ error: 'Failed to queue job' });
    }
});

// GET /api/v2/jobs/:id
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
        // jobs.error holds the worker's exception text (paths inside the container, database or
        // model messages): the owner sees that the job failed, and the text only while developing.
        const job = result.rows[0];
        res.json({ ...job, error: job.error ? 'Processing failed' : null, ...errorDetail(job.error) });
    } catch (error) {
        if (respondIfDbUnavailable(res, error)) return;
        res.status(500).json({ error: 'Failed to check job' });
    }
});

export default router;
