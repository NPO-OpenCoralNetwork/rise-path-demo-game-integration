// Where uploaded materials live and what is accepted. Uploads are private: stored outside public/
// under a random name, never served over HTTP, read only by ingestion (ragService, jobWorker).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline, Transform } from 'stream';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MAX_UPLOAD_MB = 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Error code for a file that is not a PDF, text or Markdown file (the route answers 415). */
export const UNSUPPORTED_UPLOAD = 'unsupported_file_type';

// Extension → material type, the MIME type ingestion reads it as, and the types a browser may send
// for it (often none, or a generic one, for .md and .txt).
const ACCEPTED = {
    '.pdf': { type: 'pdf', mimeType: 'application/pdf', sent: ['application/pdf', 'application/x-pdf'] },
    '.txt': { type: 'txt', mimeType: 'text/plain', sent: ['text/plain', 'application/octet-stream', ''] },
    '.md': { type: 'txt', mimeType: 'text/plain', sent: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream', ''] },
};

/**
 * RISE_PATH_UPLOAD_DIR (absolute, or relative to the project), else <project>/uploads (git-ignored;
 * a volume on the VM). Read on every upload, so tests and deployments can point it elsewhere.
 * @param {Record<string, string | undefined>} [env]
 */
export const uploadDir = (env = process.env) => {
    const configured = env.RISE_PATH_UPLOAD_DIR?.trim();
    return configured ? path.resolve(PROJECT_ROOT, configured) : path.join(PROJECT_ROOT, 'uploads');
};

const isInside = (dir, parent) => dir === parent || dir.startsWith(`${parent}${path.sep}`);

/**
 * Why `dir` cannot hold uploads, or null. The project root, public/ and dist/ are served (by the
 * API or the Vite dev server), so a directory there would publish the files.
 * @param {string} dir
 */
export const uploadDirProblem = (dir) => {
    const resolved = path.resolve(dir);
    if (resolved === PROJECT_ROOT) return 'RISE_PATH_UPLOAD_DIR is the project root';
    for (const served of ['public', 'dist']) {
        if (isInside(resolved, path.join(PROJECT_ROOT, served))) return `RISE_PATH_UPLOAD_DIR is inside ${served}/, which is served`;
    }
    return null;
};

/**
 * What an upload is stored and ingested as, or null when it is not a PDF, text or Markdown file.
 * @param {string} originalname
 * @param {string} mimetype as the browser declared it
 * @returns {{ ext: string, type: string, mimeType: string } | null}
 */
export const acceptedUpload = (originalname, mimetype) => {
    const ext = path.extname(String(originalname ?? '')).toLowerCase();
    const kind = Object.hasOwn(ACCEPTED, ext) ? ACCEPTED[ext] : null;
    if (!kind || !kind.sent.includes(String(mimetype ?? '').toLowerCase())) return null;
    return { ext, type: kind.type, mimeType: kind.mimeType };
};

/** A stored file name that says nothing about the upload and cannot collide or escape the directory. */
export const randomUploadName = (ext) => `${crypto.randomUUID()}${ext}`;

/**
 * materials.storage_path: relative to the project when the file is inside it (like the old
 * public/uploads rows), else absolute. The job worker resolves both against the project.
 * @param {string} absolutePath
 */
export const storagePathFor = (absolutePath) => {
    const relative = path.relative(PROJECT_ROOT, absolutePath);
    return relative.startsWith('..') || path.isAbsolute(relative) ? absolutePath : relative;
};

/** The original file name, kept only as the material's title: no control characters, ≤ 200 characters. */
export const uploadTitle = (originalname) =>
    String(originalname ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Untitled';

const unsupported = () => Object.assign(new Error('Unsupported file type'), { code: UNSUPPORTED_UPLOAD });

/**
 * Passes the stream through once its first KiB holds the PDF signature (pdf.js looks there too), so
 * an HTML page renamed to .pdf is refused instead of sitting in storage unreadable.
 */
const pdfSignature = () => {
    const signature = Buffer.from('%PDF-');
    let head = Buffer.alloc(0);
    let checked = false;
    const check = (cb, ending) => {
        if (head.includes(signature)) {
            checked = true;
            const data = head;
            head = null;
            return cb(null, data);
        }
        if (ending || head.length >= 1024) return cb(unsupported());
        return cb();
    };
    return new Transform({
        transform(chunk, encoding, cb) {
            if (checked) return cb(null, chunk);
            head = Buffer.concat([head, chunk]);
            return check(cb, false);
        },
        flush(cb) {
            if (checked) return cb();
            return check(cb, true);
        },
    });
};

/**
 * multer storage for materials. multer's disk storage only pipes the upload into the file, so an
 * aborted request left the (already deleted) file open until the process restarted; here the file
 * is written with stream.pipeline, which closes it on any error. The path is set before the first
 * byte so multer can remove the file when the request fails, and only the server's user can read
 * it (0700 directory, 0600 file).
 */
export const privateUploadStorage = {
    _handleFile(req, file, cb) {
        const kind = acceptedUpload(file.originalname, file.mimetype);
        if (!kind) return cb(unsupported()); // fileFilter refuses these first
        const dir = uploadDir();
        const problem = uploadDirProblem(dir);
        if (problem) return cb(Object.assign(new Error(problem), { code: 'UPLOAD_DIR_SERVED' }));
        fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }).then(() => {
            const target = path.join(dir, randomUploadName(kind.ext));
            file.path = target;
            const out = fs.createWriteStream(target, { mode: 0o600 });
            const steps = kind.type === 'pdf' ? [file.stream, pdfSignature(), out] : [file.stream, out];
            pipeline(...steps, (err) => {
                if (err) return fs.unlink(target, () => cb(err));
                return cb(null, { destination: dir, filename: path.basename(target), path: target, size: out.bytesWritten });
            });
        }, cb);
    },
    _removeFile(req, file, cb) {
        fs.unlink(file.path, (err) => cb(err && err.code !== 'ENOENT' ? err : null));
    },
};

/**
 * Express middleware for the static section: 404 for anything that resolves into public/uploads
 * once decoded and normalized the way the static server does it ("/%75ploads/x", "//uploads/x",
 * "/a/../uploads/x", and any case, for case-insensitive file systems). Older versions stored
 * uploads there, and their files may still be on disk.
 * @param {string} publicDir
 */
export const blockLegacyUploads = (publicDir) => {
    const legacy = path.join(publicDir, 'uploads').toLowerCase();
    return (req, res, next) => {
        let decoded;
        try {
            decoded = decodeURIComponent(req.path);
        } catch {
            return next(); // the static server answers 400 for a malformed path
        }
        const resolved = path.normalize(path.join(publicDir, decoded)).toLowerCase();
        if (isInside(resolved, legacy)) return res.status(404).end();
        return next();
    };
};
