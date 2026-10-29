// Where uploaded materials live and what is accepted. Uploads are private: stored outside public/
// under a random name in <project>/uploads (git-ignored; a volume on the VM), never served over
// HTTP, read only by ingestion (ragService, jobWorker) and removed by account deletion and the
// retention sweep. Older versions stored them in public/uploads as <Date.now()>-<original name>;
// those files stay readable through their materials rows but are not served any more.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline, Transform } from 'stream';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One file per request, at most this size (the daily 'embeddings' unit covers a bounded file). */
export const MAX_UPLOAD_MB = 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Error code for a file that is not a PDF, text or Markdown file (the route answers 415). */
export const UNSUPPORTED_UPLOAD = 'unsupported_file_type';

/**
 * Where uploads are, relative to the project, and the names the upload route gives files there:
 * - uploads/<random UUID>.<pdf|txt|md> (private, this version)
 * - public/uploads/<13-digit Date.now()>-<one path segment> (older versions; still read and removed)
 * Account deletion and the retention sweep touch nothing else.
 */
export const UPLOAD_LOCATIONS = Object.freeze([
    Object.freeze({ dir: 'uploads', name: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|txt|md)$/ }),
    Object.freeze({ dir: 'public/uploads', name: /^[0-9]{13}-[^/\\]+$/ }),
]);

/**
 * The location of a materials.storage_path the upload route wrote, or null for anything else.
 * @param {unknown} storagePath
 */
export const uploadLocationOf = (storagePath) => {
    if (typeof storagePath !== 'string' || storagePath.includes('\0')) return null;
    return UPLOAD_LOCATIONS.find(({ dir, name }) => storagePath.startsWith(`${dir}/`) && name.test(storagePath.slice(dir.length + 1))) ?? null;
};

// Extension → material type, the MIME type ingestion reads it as, and the types a browser may send
// for it (often none, or a generic one: some systems send a PDF as application/octet-stream; the
// stored PDF is checked for its signature anyway).
const ACCEPTED = {
    '.pdf': { type: 'pdf', mimeType: 'application/pdf', sent: ['application/pdf', 'application/x-pdf', 'application/octet-stream', ''] },
    '.txt': { type: 'txt', mimeType: 'text/plain', sent: ['text/plain', 'application/octet-stream', ''] },
    '.md': { type: 'txt', mimeType: 'text/plain', sent: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream', ''] },
};

/** @type {string | null} tests: another project root for the uploads directory */
let rootOverride = null;

/** Tests: store uploads under <root>/uploads instead of the project's. */
export function setUploadRootForTests(root) {
    rootOverride = root;
}

export function resetUploadRootForTests() {
    rootOverride = null;
}

/** The root that storage paths are relative to: the project (tests may point it elsewhere). */
export const uploadRoot = () => rootOverride ?? PROJECT_ROOT;

/** The directory private uploads are written to: <root>/uploads. */
export const uploadDir = () => path.join(uploadRoot(), 'uploads');

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

/** The original file name, kept only as the material's title: no control characters, ≤ 200 characters. */
export const uploadTitle = (originalname) =>
    String(originalname ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Untitled';

const unsupported = () => Object.assign(new Error('Unsupported file type'), { code: UNSUPPORTED_UPLOAD });

/** pdf.js looks for the signature in the first KiB only. */
const PDF_SIGNATURE_WINDOW = 1024;

/**
 * Passes the stream through once its first KiB holds the PDF signature (pdf.js looks there too), so
 * an HTML page renamed to .pdf is refused instead of sitting in storage unreadable.
 */
const pdfSignature = () => {
    const signature = Buffer.from('%PDF-');
    let head = Buffer.alloc(0);
    let checked = false;
    const check = (cb, ending) => {
        const at = head.subarray(0, PDF_SIGNATURE_WINDOW).indexOf(signature);
        if (at !== -1) {
            checked = true;
            const data = head;
            head = null;
            return cb(null, data);
        }
        if (ending || head.length >= PDF_SIGNATURE_WINDOW) return cb(unsupported());
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
 * aborted request left the file open until the process restarted; here the file is written with
 * stream.pipeline, which closes it on any error. The path is set before the first byte so multer
 * can remove the file when the request fails, and only the server's user can read it (0700
 * directory, 0600 file).
 */
export const privateUploadStorage = {
    _handleFile(req, file, cb) {
        const kind = acceptedUpload(file.originalname, file.mimetype);
        if (!kind) return cb(unsupported()); // the route's fileFilter refuses these first
        const dir = uploadDir();
        // mkdir's mode applies only to a directory it creates (a volume's mount point already exists).
        fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }).then(() => fs.promises.chmod(dir, 0o700).catch(() => {})).then(() => {
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
 * The forms a request path can take once a static server has read it: each segment decoded where it
 * decodes ("/%75ploads/100%.txt" still names uploads/), backslashes as slashes, "." and ".."
 * resolved, and folded the ways a case-insensitive file system may fold it: lower case, and NFKC
 * then lower case (APFS matches "ſ" with "s").
 * @param {string} urlPath the path part of the request URL (a query or hash is dropped)
 * @returns {string[]}
 */
const foldedPaths = (urlPath) => {
    const raw = String(urlPath ?? '').split(/[?#]/)[0];
    const decoded = raw.split('/').map((segment) => {
        try {
            return decodeURIComponent(segment);
        } catch {
            return segment;
        }
    }).join('/');
    const slashed = `/${decoded.replace(/\\/g, '/')}`;
    return [slashed.toLowerCase(), slashed.normalize('NFKC').toLowerCase()].map((form) => path.posix.normalize(form));
};

/**
 * Whether a request path reaches public/uploads, however it is spelled ("/%75ploads/x",
 * "//uploads/x", "/a/../uploads/x", any case). Older versions stored uploads there, and their files
 * may still be on disk; the static servers would serve them.
 * @param {string} urlPath
 */
export const isLegacyUploadPath = (urlPath) =>
    foldedPaths(urlPath).some((form) => form === '/uploads' || form.startsWith('/uploads/'));

/**
 * Whether any segment of a request path is "uploads". The Vite dev server serves every file of the
 * project from its root ("/public/uploads/…", "/uploads/…") and through /@fs/<absolute path>, so it
 * refuses them all.
 * @param {string} urlPath
 */
export const hasUploadsSegment = (urlPath) => foldedPaths(urlPath).some((form) => form.split('/').includes('uploads'));

/** Express middleware for the static section: 404 for anything under the old public/uploads. */
export const blockLegacyUploads = () => (req, res, next) => (isLegacyUploadPath(req.path) ? res.status(404).end() : next());

/**
 * Connect middleware for the Vite dev and preview servers (vite.config.ts): 404 for any request with
 * an "uploads" segment (whatever the app's base path, which only adds segments in front).
 * @returns {(req: { url?: string }, res: { statusCode: number, end: () => void }, next: () => void) => void}
 */
export const blockUploadRequests = () => (req, res, next) => {
    if (!hasUploadsSegment(req.url ?? '')) return next();
    res.statusCode = 404;
    res.end();
};
