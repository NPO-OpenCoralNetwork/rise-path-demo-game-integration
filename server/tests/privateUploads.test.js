/**
 * Uploaded materials stay private (Phase 1 / P1-3b).
 *
 * - Uploads went to public/uploads under their original name, with no size or type limit, and
 *   express.static served them to anyone who could reach the API port (Tailscale peers today; the
 *   origin gate already keeps /uploads off the public edge).
 * - Inside the container they lived in the image's own file system, so a redeploy lost them.
 *
 * Now: stored outside public/ (RISE_PATH_UPLOAD_DIR, default <project>/uploads, a volume on the
 * VM) under a random name, 20 MB and PDF / text / Markdown only (413 / 415), one part per request,
 * written so an aborted upload leaves nothing open or on disk, and /uploads/* is 404 however the
 * path is spelled.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    MAX_UPLOAD_BYTES,
    acceptedUpload,
    privateUploadStorage,
    storagePathFor,
    uploadDir,
    uploadDirProblem,
    uploadTitle,
} from '../uploads.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_UPLOAD_DIR', 'DATABASE_URL_PHASE1', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024, 0x20)]);

describe('upload rules', () => {
    it('accepts PDF, text and Markdown, by extension and declared type', () => {
        assert.deepEqual(acceptedUpload('notes.pdf', 'application/pdf'), { ext: '.pdf', type: 'pdf', mimeType: 'application/pdf' });
        assert.equal(acceptedUpload('NOTES.PDF', 'application/pdf')?.ext, '.pdf');
        assert.deepEqual(acceptedUpload('readme.md', 'text/markdown'), { ext: '.md', type: 'txt', mimeType: 'text/plain' });
        // Browsers often send no type (or a generic one) for .md and .txt.
        assert.equal(acceptedUpload('readme.md', '')?.ext, '.md');
        assert.equal(acceptedUpload('log.txt', 'application/octet-stream')?.ext, '.txt');
        assert.equal(acceptedUpload('log.txt', 'text/plain')?.type, 'txt');
    });

    it('refuses everything else', () => {
        for (const [name, type] of [
            ['setup.exe', 'application/x-msdownload'],
            ['photo.png', 'image/png'],
            ['page.html', 'text/html'],
            ['notes.pdf', 'image/png'],
            ['notes.pdf', ''],
            ['song.mp3', 'audio/mpeg'],
            ['no-extension', 'text/plain'],
            ['', 'text/plain'],
        ]) {
            assert.equal(acceptedUpload(name, type), null, `${name} ${type}`);
        }
    });

    it('stores outside public/: RISE_PATH_UPLOAD_DIR (absolute or relative to the project), else <project>/uploads', () => {
        assert.equal(uploadDir({}), path.join(ROOT, 'uploads'));
        assert.equal(uploadDir({ RISE_PATH_UPLOAD_DIR: '/srv/rp-uploads' }), '/srv/rp-uploads');
        assert.equal(uploadDir({ RISE_PATH_UPLOAD_DIR: 'var/uploads' }), path.join(ROOT, 'var/uploads'));
        assert.equal(uploadDirProblem(uploadDir({})), null);
        assert.equal(uploadDirProblem('/srv/rp-uploads'), null);
    });

    it('refuses an upload directory that is served (project root, public/, dist/)', () => {
        for (const dir of [ROOT, path.join(ROOT, 'public'), path.join(ROOT, 'public', 'data'), path.join(ROOT, 'dist', 'x')]) {
            assert.ok(uploadDirProblem(dir), dir);
        }
        assert.match(read('server.js'), /const uploadProblem = uploadDirProblem\(uploadDir\(\)\);\n\s+if \(uploadProblem\) \{[\s\S]{0,120}process\.exit\(1\)/);
    });

    it('records storage_path relative to the project when inside it, else absolute (the worker resolves both)', () => {
        assert.equal(storagePathFor(path.join(ROOT, 'uploads', 'a.pdf')), path.join('uploads', 'a.pdf'));
        assert.equal(storagePathFor('/srv/rp-uploads/a.pdf'), '/srv/rp-uploads/a.pdf');
        assert.equal(path.resolve(ROOT, storagePathFor('/srv/rp-uploads/a.pdf')), '/srv/rp-uploads/a.pdf');
    });

    it('keeps the original name only as a title, without control characters', () => {
        assert.equal(uploadTitle('  講義ノート.pdf '), '講義ノート.pdf');
        assert.equal(uploadTitle('a\u0000b\u001fc\u007f.md'), 'abc.md');
        assert.equal(uploadTitle('x'.repeat(300)).length, 200);
        assert.equal(uploadTitle('\u0000'), 'Untitled');
        // A NUL in a text column fails the INSERT (22021), so the route stores the cleaned title.
        assert.match(read('server/routes/content.js'), /\[req\.userId, kind\.type, uploadTitle\(req\.file\.originalname\), storagePathFor\(req\.file\.path\)\]/);
    });
});

describe('storage', () => {
    let dir;
    const saved = {};
    beforeEach(() => {
        saved.dir = process.env.RISE_PATH_UPLOAD_DIR;
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-uploads-'));
        process.env.RISE_PATH_UPLOAD_DIR = dir;
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        if (saved.dir === undefined) delete process.env.RISE_PATH_UPLOAD_DIR;
        else process.env.RISE_PATH_UPLOAD_DIR = saved.dir;
    });

    const store = (file) => new Promise((resolve) => {
        privateUploadStorage._handleFile({}, file, (err, info) => resolve({ err, info }));
    });

    it('closes the file and removes it when the upload breaks off (multer only piped, leaving it open)', async (t) => {
        const opened = [];
        const createWriteStream = fs.createWriteStream;
        t.mock.method(fs, 'createWriteStream', (...args) => {
            const stream = createWriteStream(...args);
            opened.push(stream);
            return stream;
        });
        const source = new PassThrough();
        source.on('error', () => {}); // multer listens on the file stream before handing it over
        const file = { originalname: 'notes.pdf', mimetype: 'application/pdf', stream: source };
        const result = store(file);
        const deadline = Date.now() + 2000;
        while (opened.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
        source.write(pdfBytes);
        await new Promise((resolve) => setTimeout(resolve, 20));
        source.destroy(new Error('Unexpected end of form'));
        const { err } = await result;
        assert.match(String(err?.message), /Unexpected end of form/);
        assert.equal(opened.length, 1);
        assert.equal(opened[0].destroyed, true, 'the descriptor is closed');
        assert.equal(fs.existsSync(file.path), false);
    });

    it('writes owner-only files and refuses a PDF without the PDF signature', async () => {
        const good = new PassThrough();
        const goodResult = store({ originalname: 'a.pdf', mimetype: 'application/pdf', stream: good });
        good.end(pdfBytes);
        const { err, info } = await goodResult;
        assert.equal(err ?? null, null);
        assert.equal(fs.statSync(info.path).mode & 0o777, 0o600);

        const html = new PassThrough();
        const htmlFile = { originalname: 'a.pdf', mimetype: 'application/pdf', stream: html };
        const htmlResult = store(htmlFile);
        html.end(Buffer.from('<!doctype html><script>alert(1)</script>'));
        assert.equal((await htmlResult).err?.code, 'unsupported_file_type');
        assert.equal(fs.existsSync(htmlFile.path), false);
    });
});

describe('POST /api/v2/upload', () => {
    const saved = {};
    let dir;
    let inserts;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development'; // dev fallback user
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-uploads-'));
        process.env.RISE_PATH_UPLOAD_DIR = dir;
        inserts = [];
        // Records the materials INSERT; ingestion then fails (no connect, no model key) and the
        // route answers status 'uploaded', as it does when embedding is unavailable.
        setPoolForTests({
            query: async (sql, params) => {
                if (/insert into materials/i.test(sql)) {
                    inserts.push(params);
                    return { rowCount: 1, rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'uploaded' }] };
                }
                return { rowCount: 0, rows: [] };
            },
        });
    });
    afterEach(() => {
        resetPoolForTests();
        fs.rmSync(dir, { recursive: true, force: true });
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    const withServer = async (handler, options = { serveStatic: false }) => {
        const app = await createApp(options);
        const server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        try {
            await handler(`http://127.0.0.1:${server.address().port}`, server.address().port);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const post = (base, parts) => {
        const form = new FormData();
        for (const [field, value, name] of parts) {
            if (name === undefined) form.append(field, value);
            else form.append(field, value, name);
        }
        return fetch(`${base}/api/v2/upload`, { method: 'POST', body: form });
    };
    const postFile = (base, name, type, bytes) => post(base, [['file', new Blob([bytes], { type }), name]]);

    /** GET with the path sent exactly as written (fetch would normalize dot segments). */
    const rawGet = (port, rawPath) => new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
    });

    const stored = () => fs.readdirSync(dir);

    it('stores an accepted file under a random name in the upload directory', async () => {
        await withServer(async (base) => {
            const response = await postFile(base, '講義ノート.pdf', 'application/pdf', pdfBytes);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).ok, true);
        });
        const files = stored();
        assert.equal(files.length, 1);
        assert.match(files[0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
        const [userId, type, title, storagePath] = inserts[0];
        assert.ok(userId);
        assert.equal(type, 'pdf');
        assert.equal(title, '講義ノート.pdf', 'UTF-8 file names are kept, not read as latin1');
        assert.equal(path.resolve(ROOT, storagePath), path.join(dir, files[0]));
    });

    it('accepts Markdown sent without a type', async () => {
        await withServer(async (base) => {
            const response = await postFile(base, 'notes.md', '', Buffer.from('# Notes\n'));
            assert.equal(response.status, 200);
        });
        assert.equal(inserts[0][1], 'txt');
        assert.match(stored()[0], /\.md$/);
    });

    it('answers 413 for a file over 20 MB and keeps nothing', async () => {
        await withServer(async (base) => {
            const response = await postFile(base, 'big.pdf', 'application/pdf', Buffer.concat([pdfBytes, Buffer.alloc(MAX_UPLOAD_BYTES)]));
            assert.equal(response.status, 413);
            assert.equal((await response.json()).error_type, 'file_too_large');
        });
        assert.deepEqual(stored(), []);
        assert.equal(inserts.length, 0);
    });

    it('answers 415 for other file types, and for a PDF that is not one, and keeps nothing', async () => {
        await withServer(async (base) => {
            for (const [name, type, bytes] of [
                ['setup.exe', 'application/x-msdownload', Buffer.from('x')],
                ['page.html', 'text/html', Buffer.from('x')],
                ['photo.pdf', 'image/png', Buffer.from('x')],
                ['page.pdf', 'application/pdf', Buffer.from('<html><body>not a pdf</body></html>')],
            ]) {
                const response = await postFile(base, name, type, bytes);
                assert.equal(response.status, 415, name);
                assert.equal((await response.json()).error_type, 'unsupported_file_type');
            }
        });
        assert.deepEqual(stored(), []);
        assert.equal(inserts.length, 0);
    });

    it('answers 400 for extra fields, a second file or a malformed body, and keeps nothing', async () => {
        await withServer(async (base) => {
            const extraField = await post(base, [['note', 'x'], ['file', new Blob([pdfBytes], { type: 'application/pdf' }), 'a.pdf']]);
            assert.equal(extraField.status, 400);
            const twoFiles = await post(base, [
                ['file', new Blob([pdfBytes], { type: 'application/pdf' }), 'a.pdf'],
                ['file', new Blob([pdfBytes], { type: 'application/pdf' }), 'b.pdf'],
            ]);
            assert.equal(twoFiles.status, 400);
            const truncated = await fetch(`${base}/api/v2/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'multipart/form-data; boundary=rpboundary' },
                body: '--rpboundary\r\nContent-Disposition: form-data; name="file"; filename="a.md"\r\nContent-Type: text/markdown\r\n\r\n# cut off',
            });
            assert.equal(truncated.status, 400);
            assert.equal((await truncated.json()).error_type, 'validation');
        });
        assert.deepEqual(stored(), []);
        assert.equal(inserts.length, 0);
    });

    it('answers 400 without a file, and 503 without a database (before reading the upload)', async () => {
        await withServer(async (base) => {
            const empty = await fetch(`${base}/api/v2/upload`, { method: 'POST', body: new FormData() });
            assert.equal(empty.status, 400);
            setPoolForTests(null);
            const noDb = await postFile(base, 'notes.pdf', 'application/pdf', pdfBytes);
            assert.equal(noDb.status, 503);
        });
        assert.deepEqual(stored(), []);
    });

    it('removes the stored file when the material cannot be recorded', async (t) => {
        t.mock.method(console, 'error', () => {});
        setPoolForTests({
            query: async () => {
                throw Object.assign(new Error('null value in column "user_id"'), { code: '23502' });
            },
        });
        await withServer(async (base) => {
            const response = await postFile(base, 'notes.pdf', 'application/pdf', pdfBytes);
            assert.equal(response.status, 500);
        });
        assert.deepEqual(stored(), []);
    });

    it('never serves /uploads/*, however the path is spelled, even a file an older version left in public/uploads', async () => {
        const legacyDir = path.join(ROOT, 'public', 'uploads');
        const createdDir = !fs.existsSync(legacyDir);
        fs.mkdirSync(legacyDir, { recursive: true });
        const name = `rp-test-${crypto.randomUUID()}.txt`;
        const legacy = path.join(legacyDir, name);
        fs.writeFileSync(legacy, 'private material');
        try {
            await withServer(async (base, port) => {
                for (const spelling of [
                    `/uploads/${name}`,
                    `/UPLOADS/${name}`,
                    `/%75ploads/${name}`,
                    `/uploads%2f${name}`,
                    `//uploads/${name}`,
                    `/./uploads/${name}`,
                    `/x/../uploads/${name}`,
                ]) {
                    const response = await rawGet(port, spelling);
                    assert.equal(response.status, 404, spelling);
                    assert.doesNotMatch(response.body, /private material/, spelling);
                }
            }, { serveStatic: true });
        } finally {
            fs.rmSync(legacy, { force: true });
            if (createdDir) fs.rmSync(legacyDir, { recursive: true, force: true });
        }
    });
});

describe('client side', () => {
    it('the file picker offers only PDF, text and Markdown with the server limit, and the generator explains a refused upload', () => {
        const view = read('components/features/ai/CourseGeneratorView.tsx');
        assert.match(view, /type="file"[\s\S]{0,200}accept="\.pdf,\.txt,\.md,application\/pdf,text\/plain,text\/markdown"/);
        assert.match(view, /const MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024;/);
        assert.equal(MAX_UPLOAD_BYTES, 20 * 1024 * 1024, 'client and server use the same limit');
        assert.match(view, /const ACCEPTED_UPLOAD = \/\\\.\(pdf\|txt\|md\)\$\/i;/);
        assert.match(view, /fileTooLarge/);
        assert.match(view, /fileTypeUnsupported/);
        assert.match(view, /status === 413/);
        assert.match(view, /status === 415/);
        // A refused upload gives the user their message back instead of leaving it in the chat.
        assert.match(view, /setMessages\(prev => prev\.filter\(m => m\.id !== userMsg\.id\)\);\n\s+setInputValue\(msgText\);/);
        assert.match(read('services/curriculumApi.ts'), /export const uploadFile[\s\S]{0,400}aiHttpError\(/);
    });
});

describe('deployment', () => {
    it('the VM keeps uploads in a volume at a fixed path, and git, Docker, Vercel and the dev server leave them alone', () => {
        const compose = read('deploy/risepath-vm/docker-compose.yml');
        assert.match(compose, /RISE_PATH_UPLOAD_DIR: \/app\/uploads/);
        assert.match(compose, /- uploads:\/app\/uploads/);
        assert.match(compose, /\nvolumes:\n(?:\s+\S+:\n)*\s+uploads:/);
        assert.match(read('.gitignore'), /^\/uploads\/$/m);
        const dockerignore = read('.dockerignore');
        assert.match(dockerignore, /^uploads$/m);
        assert.match(dockerignore, /^public\/uploads$/m);
        assert.match(read('.vercelignore'), /^\/uploads$/m);
        const vite = read('vite.config.ts');
        assert.match(vite, /deny: \['\.env', '\.env\.\*', '\*\.\{crt,pem\}', '\*\*\/\.git\/\*\*', '\*\*\/uploads\/\*\*'\]/);
    });
});
