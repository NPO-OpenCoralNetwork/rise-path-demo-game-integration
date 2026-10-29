/**
 * Uploaded materials are private (server/uploads.js).
 *
 * - They were stored in public/uploads as <Date.now()>-<original name>, which the API's static
 *   server (and the Vite dev server, on every interface) served to anyone, and any file type was
 *   accepted. Now: <project>/uploads/<random UUID>.<pdf|txt|md>, 0600 in a 0700 directory, only
 *   PDF (with the PDF signature), text and Markdown files (415 otherwise), UTF-8 file names.
 * - Paths under /uploads answer 404 however they are spelled, for the files older versions left.
 * - Account deletion and the retention sweep remove files in both places, and nothing else.
 * - On the VM the directory is a volume (uploads were lost with the container on each redeploy).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

// Read when kokoroTts.js is imported (through server.js): a port where no TTS sidecar listens.
process.env.KOKORO_TTS_URL = 'http://127.0.0.1:1';
const { createApp } = await import('../../server.js');
const { setPoolForTests, resetPoolForTests } = await import('../db.js');
const { resetDailyCapsForTests } = await import('../middleware/dailyCaps.js');
const uploads = await import('../uploads.js');
const { removeUploadFile } = await import('../services/accountDeletion.js');
const { sweepOrphanUploads, ORPHAN_UPLOAD_HOURS } = await import('../services/retention.js');
const { JobWorker } = await import('../jobWorker.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const MATERIAL = 'b0000000-0000-4000-8000-000000000002';
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|txt|md)$/;
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'GEMINI_ALLOWED', 'GEMINI_API_KEY',
    'AI_CAP_USER_EMBEDDINGS', 'AI_CAP_IP_EMBEDDINGS', 'AI_CAP_GLOBAL_EMBEDDINGS', 'ORIGIN_SECRET', 'TRUST_PROXY'];

const tmpRoot = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `rp-uploads-${label}-`));
const mode = (file) => fs.statSync(file).mode & 0o777;

describe('what an upload may be', () => {
    it('accepts PDF, text and Markdown files by extension and declared type, and nothing else', () => {
        assert.deepEqual(uploads.acceptedUpload('notes.pdf', 'application/pdf'), { ext: '.pdf', type: 'pdf', mimeType: 'application/pdf' });
        assert.deepEqual(uploads.acceptedUpload('NOTES.PDF', 'application/x-pdf'), { ext: '.pdf', type: 'pdf', mimeType: 'application/pdf' });
        // Some systems send a PDF as octet-stream or with no type; the stored file is checked for its signature.
        assert.deepEqual(uploads.acceptedUpload('notes.pdf', 'application/octet-stream'), { ext: '.pdf', type: 'pdf', mimeType: 'application/pdf' });
        assert.deepEqual(uploads.acceptedUpload('notes.pdf', ''), { ext: '.pdf', type: 'pdf', mimeType: 'application/pdf' });
        assert.deepEqual(uploads.acceptedUpload('a.txt', 'text/plain'), { ext: '.txt', type: 'txt', mimeType: 'text/plain' });
        assert.deepEqual(uploads.acceptedUpload('readme.md', ''), { ext: '.md', type: 'txt', mimeType: 'text/plain' });
        assert.deepEqual(uploads.acceptedUpload('readme.md', 'text/markdown'), { ext: '.md', type: 'txt', mimeType: 'text/plain' });
        for (const [name, type] of [['page.html', 'text/html'], ['a.pdf', 'text/html'], ['song.mp3', 'audio/mpeg'], ['run.exe', 'application/octet-stream'],
            ['a.txt', 'application/pdf'], ['no-extension', 'text/plain'], ['image.svg', 'image/svg+xml'], ['', '']]) {
            assert.equal(uploads.acceptedUpload(name, type), null, `${name} ${type}`);
        }
    });

    it('stores under a random name and keeps the original only as a clean title', () => {
        assert.match(uploads.randomUploadName('.md'), UUID_NAME);
        assert.notEqual(uploads.randomUploadName('.md'), uploads.randomUploadName('.md'));
        assert.equal(uploads.uploadTitle('日本語のメモ.md'), '日本語のメモ.md');
        assert.equal(uploads.uploadTitle('a\u0000b\nc.txt'), 'abc.txt');
        assert.equal(uploads.uploadTitle('x'.repeat(300)).length, 200);
        assert.equal(uploads.uploadTitle('\u0007'), 'Untitled');
    });

    it('knows the two places uploads live, and refuses every other path', () => {
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
        assert.equal(uploads.uploadLocationOf(`uploads/${id}.pdf`)?.dir, 'uploads');
        assert.equal(uploads.uploadLocationOf('public/uploads/1700000000000-a.txt')?.dir, 'public/uploads');
        for (const bad of [`uploads/${id}.exe`, `uploads/${id}`, `uploads/../${id}.pdf`, `uploads/x/${id}.pdf`, `/uploads/${id}.pdf`,
            'public/uploads/170000000000-a.txt', 'public/uploads/1700000000000-a/../../x', 'public/uploads/1700000000000-', 'server.js',
            `uploads/${id}.pdf\u0000`, '', null, 42]) {
            assert.equal(uploads.uploadLocationOf(bad), null, String(bad));
        }
    });

    it('spots a request for the old public/uploads however it is spelled', () => {
        for (const p of ['/uploads/1700000000000-a.pdf', '/uploads', '/UPLOADS/x', '/%75ploads/x', '//uploads/x', '/a/../uploads/x',
            '/uploads/x?download=1', '/./uploads/x', '/uploads%2fx', '\\uploads\\x',
            // a name with a bare "%" does not decode as a whole; each segment still does
            '/uploads/1700000000000-100%.txt', '/%75ploads/1700000000000-100%.txt',
            // what a case-insensitive file system (APFS) also matches: "ſ" is "s", fullwidth letters
            '/upload%C5%BF/x', '/%EF%BD%95ploads/x']) {
            assert.equal(uploads.isLegacyUploadPath(p), true, p);
        }
        for (const p of ['/', '/upload', '/uploadsx', '/api/v2/upload', '/generated/img.png', '/%E0%A4%A', '/a/uploads/x']) {
            assert.equal(uploads.isLegacyUploadPath(p), false, p);
        }
    });

    it('spots any "uploads" segment, for the Vite dev server (which serves every project file)', () => {
        for (const p of ['/uploads/x', '/public/uploads/1700000000000-a.txt', '/@fs/srv/rise-path/uploads/0f8fad5b.pdf',
            '/@fs/srv/app/public/uploads/x', '/public/%75ploads/x', '/public/upload%C5%BF/x', '/a/b/uploads']) {
            assert.equal(uploads.hasUploadsSegment(p), true, p);
        }
        for (const p of ['/', '/src/App.tsx', '/server/uploads.js', '/api/v2/upload', '/uploadsx/y', '/@vite/client', '/node_modules/.vite/deps/react.js']) {
            assert.equal(uploads.hasUploadsSegment(p), false, p);
        }
    });

    it('the Vite middleware answers 404 for them, below an app base path too', () => {
        const call = (url) => {
            const res = { statusCode: 200, ended: false, end() { this.ended = true; } };
            let passed = false;
            uploads.blockUploadRequests()({ url }, res, () => { passed = true; });
            return passed ? 'next' : `${res.statusCode}${res.ended ? '' : ' (open)'}`;
        };
        assert.equal(call('/public/uploads/1700000000000-a.txt'), '404');
        assert.equal(call('/@fs/srv/app/uploads/x.pdf?import'), '404');
        assert.equal(call('/src/App.tsx'), 'next');
        assert.equal(call('/app/uploads/x'), '404');
        assert.equal(call('/app/index.html'), 'next');
        assert.equal(call(undefined), 'next');
    });
});

describe('POST /api/v2/upload', () => {
    const saved = {};
    let root;
    let pool;

    /** A pool for the upload: the daily cap, the materials row, and ingestion with embeddings off. */
    const uploadPool = ({ insertFails = false } = {}) => {
        const queries = [];
        const run = async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
            queries.push({ sql: text, params });
            if (text.startsWith('insert into ai_daily_usage')) return { rowCount: 1, rows: [{ count: 1 }] };
            if (text.startsWith('insert into materials')) {
                if (insertFails) throw Object.assign(new Error('relation "materials" is broken'), { code: 'XX000' });
                return { rowCount: 1, rows: [{ id: MATERIAL, status: 'uploaded' }] };
            }
            if (text.startsWith('select count(*)::int as embedded')) return { rowCount: 1, rows: [{ embedded: 0 }] };
            return { rowCount: 0, rows: [] };
        };
        return { queries, query: run, connect: async () => ({ query: run, release: () => {} }) };
    };

    const withServer = async (handler) => {
        const app = await createApp({ serveStatic: false });
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
            await handler(`http://127.0.0.1:${server.address().port}/api/v2`);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const send = async (base, parts) => {
        const form = new FormData();
        for (const [field, value, name] of parts) {
            if (name === undefined) form.append(field, value);
            else form.append(field, value, name);
        }
        const response = await fetch(`${base}/upload`, { method: 'POST', body: form });
        return { status: response.status, json: await response.json().catch(() => null) };
    };

    const stored = () => {
        const dir = path.join(root, 'uploads');
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    };
    const inserts = () => pool.queries.filter((q) => q.sql.startsWith('insert into materials'));

    let quiet;
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development'; // the dev fallback user
        resetDailyCapsForTests();
        root = tmpRoot('route');
        uploads.setUploadRootForTests(root);
        pool = uploadPool();
        setPoolForTests(pool);
        quiet = { log: console.log, warn: console.warn, error: console.error };
        console.log = () => {};
        console.warn = () => {};
        console.error = () => {};
    });
    afterEach(() => {
        Object.assign(console, quiet);
        uploads.resetUploadRootForTests();
        resetPoolForTests();
        resetDailyCapsForTests();
        fs.rmSync(root, { recursive: true, force: true });
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('stores a Markdown file privately under a random name, with its UTF-8 name as the title', async () => {
        await withServer(async (base) => {
            const result = await send(base, [['file', new Blob(['# 見出し\n\n本文です。\n'], { type: 'text/markdown' }), '日本語のメモ.md']]);
            assert.equal(result.status, 200, JSON.stringify(result.json));
            assert.equal(result.json.material_id, MATERIAL);
        });
        const files = stored();
        assert.equal(files.length, 1);
        assert.match(files[0], UUID_NAME);
        const [insert] = inserts();
        assert.deepEqual(insert.params.slice(1), ['txt', '日本語のメモ.md', `uploads/${files[0]}`]);
        assert.equal(fs.readFileSync(path.join(root, 'uploads', files[0]), 'utf8'), '# 見出し\n\n本文です。\n');
        if (process.platform !== 'win32') {
            assert.equal(mode(path.join(root, 'uploads', files[0])), 0o600, 'only the server user reads the file');
            assert.equal(mode(path.join(root, 'uploads')), 0o700, 'or lists the directory');
        }
    });

    it('makes an existing upload directory (the mount point of a volume) private too', async () => {
        if (process.platform === 'win32') return;
        fs.mkdirSync(path.join(root, 'uploads'), { mode: 0o755 });
        fs.chmodSync(path.join(root, 'uploads'), 0o755);
        await withServer(async (base) => {
            const result = await send(base, [['file', new Blob(['text'], { type: 'text/plain' }), 'a.txt']]);
            assert.equal(result.status, 200, JSON.stringify(result.json));
        });
        assert.equal(mode(path.join(root, 'uploads')), 0o700);
    });

    it('stores a PDF that starts like one', async () => {
        await withServer(async (base) => {
            const result = await send(base, [['file', new Blob(['%PDF-1.4\n%binary…'], { type: 'application/pdf' }), 'slides.pdf']]);
            assert.equal(result.status, 200, JSON.stringify(result.json));
        });
        assert.equal(inserts()[0].params[1], 'pdf');
        assert.match(stored()[0], /\.pdf$/);
    });

    it('refuses other file types, and a .pdf without the PDF signature, with 415 and stores nothing', async () => {
        await withServer(async (base) => {
            for (const [content, type, name] of [['<html></html>', 'text/html', 'page.html'], ['MZ…', 'application/octet-stream', 'run.exe'],
                ['ID3…', 'audio/mpeg', 'talk.mp3'], ['<html>not a pdf</html>', 'application/pdf', 'fake.pdf']]) {
                const result = await send(base, [['file', new Blob([content], { type }), name]]);
                assert.equal(result.status, 415, name);
                assert.equal(result.json.error_type, 'unsupported_file_type', name);
            }
        });
        assert.deepEqual(stored(), [], 'nothing written, the refused PDF removed');
        assert.equal(inserts().length, 0);
        const refunds = pool.queries.filter((q) => q.sql.startsWith('update ai_daily_usage'));
        assert.equal(refunds.length, 4, 'each 415 gives the daily unit back');
    });

    it('refuses any field besides the file', async () => {
        await withServer(async (base) => {
            const result = await send(base, [['note', 'hello'], ['file', new Blob(['text'], { type: 'text/plain' }), 'a.txt']]);
            assert.equal(result.status, 400);
            assert.equal(result.json.error_type, 'invalid_body');
        });
        assert.deepEqual(stored(), []);
    });

    it('removes the file when its materials row cannot be written', async () => {
        pool = uploadPool({ insertFails: true });
        setPoolForTests(pool);
        await withServer(async (base) => {
            const result = await send(base, [['file', new Blob(['text'], { type: 'text/plain' }), 'a.txt']]);
            assert.equal(result.status, 500);
        });
        assert.deepEqual(stored(), [], 'no file without its row');
    });

    it('answers 503 before storing anything when there is no database', async () => {
        setPoolForTests(null);
        await withServer(async (base) => {
            const result = await send(base, [['file', new Blob(['text'], { type: 'text/plain' }), 'a.txt']]);
            assert.equal(result.status, 503);
        });
        assert.deepEqual(stored(), []);
    });

    it('accepts a PDF sent without its type, and finds the signature only in the first KiB', async () => {
        await withServer(async (base) => {
            const typeless = await send(base, [['file', new Blob(['%PDF-1.7\n…'], { type: 'application/octet-stream' }), 'scan.pdf']]);
            assert.equal(typeless.status, 200, JSON.stringify(typeless.json));
            const late = await send(base, [['file', new Blob([' '.repeat(4000), '%PDF-1.7\n…'], { type: 'application/pdf' }), 'late.pdf']]);
            assert.equal(late.status, 415, 'pdf.js would not find it either');
        });
        assert.equal(stored().length, 1);
    });

    it('keeps no partial file when the client goes away in the middle of the upload', async () => {
        await withServer(async (base) => {
            const { port } = new URL(base);
            const boundary = 'rpBoundary1234';
            const head = [
                `--${boundary}`,
                'Content-Disposition: form-data; name="file"; filename="big.txt"',
                'Content-Type: text/plain',
                '',
                '',
            ].join('\r\n');
            await new Promise((resolve) => {
                const socket = net.connect(Number(port), '127.0.0.1', () => {
                    socket.write([
                        'POST /api/v2/upload HTTP/1.1',
                        `Host: 127.0.0.1:${port}`,
                        `Content-Type: multipart/form-data; boundary=${boundary}`,
                        'Content-Length: 5000000',
                        '',
                        '',
                    ].join('\r\n'));
                    socket.write(head);
                    socket.write('x'.repeat(200_000));
                    setTimeout(() => {
                        socket.destroy();
                        resolve();
                    }, 100);
                });
                socket.on('error', () => {});
            });
            const until = Date.now() + 2000;
            while (stored().length > 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
        });
        assert.deepEqual(stored(), [], 'the half-written file was removed');
        assert.equal(inserts().length, 0);
    });
});

describe('old uploads are not served', () => {
    let root;
    beforeEach(() => {
        root = tmpRoot('static');
        fs.mkdirSync(path.join(root, 'uploads'));
        fs.writeFileSync(path.join(root, 'uploads', '1700000000000-a.txt'), 'an old upload');
        fs.writeFileSync(path.join(root, 'uploads', '1700000000000-100%.txt'), 'an old upload');
        fs.writeFileSync(path.join(root, 'index.txt'), 'public file');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** express.static over the temporary folder, as server.js serves public/, with or without the block. */
    const fetchAll = async (paths, { block }) => {
        const app = express();
        if (block) app.use(uploads.blockLegacyUploads());
        app.use(express.static(root));
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
            const base = `http://127.0.0.1:${server.address().port}`;
            const results = [];
            for (const p of paths) {
                const response = await fetch(`${base}${p}`);
                results.push({ p, status: response.status, text: await response.text() });
            }
            return results;
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const SPELLINGS = ['/uploads/1700000000000-a.txt', '/%75ploads/1700000000000-a.txt', '//uploads/1700000000000-a.txt',
        '/x/../uploads/1700000000000-a.txt', '/uploads/1700000000000-100%25.txt'];

    it('the static server would serve them; with the block every spelling answers 404', async () => {
        const open = await fetchAll(SPELLINGS, { block: false });
        assert.ok(open.some((r) => r.status === 200 && r.text === 'an old upload'), 'the files are there to serve');
        for (const r of await fetchAll(SPELLINGS, { block: true })) {
            assert.equal(r.status, 404, r.p);
            assert.notEqual(r.text, 'an old upload', r.p);
        }
        const [publicFile] = await fetchAll(['/index.txt'], { block: true });
        assert.equal(publicFile.text, 'public file', 'other public files are still served');
    });

    it('server.js puts the block before both static servers (dist/ and public/)', () => {
        const server = read('server.js');
        const block = server.indexOf('app.use(blockLegacyUploads());');
        assert.ok(block > 0, 'mounted');
        assert.ok(block < server.indexOf('app.use(express.static(distPath));'), 'before dist/');
        assert.ok(block < server.indexOf("app.use(express.static(path.join(__dirname, 'public')));"), 'before public/');
    });

    it('vite.config.ts uses the Vite middleware on the dev and preview servers', () => {
        const config = read('vite.config.ts');
        assert.match(config, /configureServer\(server\) \{\s*server\.middlewares\.use\(blockUploadRequests\(\)\);/);
        assert.match(config, /configurePreviewServer\(server\) \{\s*server\.middlewares\.use\(blockUploadRequests\(\)\);/);
    });
});

describe('the job worker reads only upload paths', () => {
    /** A pool for handleJob: the material row it reads, and the error code it stores for the job. */
    const workerPool = (storagePath) => {
        const queries = [];
        return {
            queries,
            stored: () => queries.find((q) => q.sql.includes("status = 'error'"))?.params[1],
            async query(sql, params = []) {
                const text = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
                queries.push({ sql: text, params });
                if (text.startsWith('select storage_path, type from materials')) return { rowCount: 1, rows: [{ storage_path: storagePath, type: 'txt' }] };
                return { rowCount: 0, rows: [] };
            },
        };
    };

    it('stores file_missing for a path the upload route never writes (or none), without reading it', async () => {
        const { error } = console;
        console.error = () => {};
        try {
            for (const storagePath of ['server.js', '../etc/passwd', 'public/uploads/no-timestamp.txt', null]) {
                const pool = workerPool(storagePath);
                const worker = new JobWorker({ getPool: () => pool });
                await worker.handleJob({ id: 'job-1', user_id: MATERIAL, type: 'ingest', payload: { material_id: MATERIAL } });
                assert.equal(pool.stored(), 'file_missing', String(storagePath));
            }
        } finally {
            console.error = error;
        }
    });
});

describe('account deletion removes uploads in both places', () => {
    let root;
    beforeEach(() => {
        root = tmpRoot('deletion');
        fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
        fs.mkdirSync(path.join(root, 'public', 'uploads'), { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('removes a private upload and an old one; refuses anything else', async () => {
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
        fs.writeFileSync(path.join(root, 'uploads', `${id}.pdf`), 'x');
        fs.writeFileSync(path.join(root, 'public', 'uploads', '1700000000000-a.txt'), 'x');
        fs.writeFileSync(path.join(root, 'keep.txt'), 'x');
        assert.equal(await removeUploadFile(`uploads/${id}.pdf`, root), 'removed');
        assert.equal(await removeUploadFile('public/uploads/1700000000000-a.txt', root), 'removed');
        assert.equal(await removeUploadFile(`uploads/${id}.pdf`, root), 'missing');
        for (const bad of ['keep.txt', 'uploads/../keep.txt', `uploads/${id}.exe`, '/etc/passwd', `public/uploads/../../keep.txt`]) {
            assert.equal(await removeUploadFile(bad, root), 'refused', bad);
        }
        assert.ok(fs.existsSync(path.join(root, 'keep.txt')));
    });

    it('never follows a symlink or removes a directory', async () => {
        const id = '1f8fad5b-d9cb-469f-a165-70867728950e';
        fs.writeFileSync(path.join(root, 'target.txt'), 'x');
        fs.symlinkSync(path.join(root, 'target.txt'), path.join(root, 'uploads', `${id}.txt`));
        fs.mkdirSync(path.join(root, 'uploads', '2f8fad5b-d9cb-469f-a165-70867728950e.md'));
        assert.equal(await removeUploadFile(`uploads/${id}.txt`, root), 'refused');
        assert.equal(await removeUploadFile('uploads/2f8fad5b-d9cb-469f-a165-70867728950e.md', root), 'refused');
        assert.ok(fs.existsSync(path.join(root, 'target.txt')));
    });
});

describe('the retention sweep removes orphan uploads in both places', () => {
    let root;
    beforeEach(() => {
        root = tmpRoot('retention');
        fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
        fs.mkdirSync(path.join(root, 'public', 'uploads'), { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const NOW = Date.UTC(2026, 9, 29, 12);
    const oldEnough = (NOW - (ORPHAN_UPLOAD_HOURS + 1) * 3600_000) / 1000;
    const put = (rel, old = true) => {
        const file = path.join(root, ...rel.split('/'));
        fs.writeFileSync(file, 'x');
        if (old) fs.utimesSync(file, oldEnough, oldEnough);
    };

    it('removes old files no materials row names; keeps named, recent and foreign ones', async () => {
        const [orphan, named, recent] = ['3f8fad5b-d9cb-469f-a165-70867728950e.txt', '4f8fad5b-d9cb-469f-a165-70867728950e.pdf', '5f8fad5b-d9cb-469f-a165-70867728950e.md'];
        put(`uploads/${orphan}`);
        put(`uploads/${named}`);
        put(`uploads/${recent}`, false);
        put('uploads/notes.txt'); // not a name the upload route gives
        put('public/uploads/1700000000000-old-orphan.txt');
        put('public/uploads/1700000000001-old-named.txt');
        const asked = [];
        const client = {
            async query(sql, params) {
                asked.push(params[0]);
                const names = new Set([`uploads/${named}`, 'public/uploads/1700000000001-old-named.txt']);
                return { rows: params[0].filter((p) => names.has(p)).map((storage_path) => ({ storage_path })) };
            },
        };
        const result = await sweepOrphanUploads({ client, uploadRoot: root, now: () => NOW });
        assert.deepEqual(result, { removed: 2, failed: 0 });
        assert.deepEqual(fs.readdirSync(path.join(root, 'uploads')).sort(), [named, recent, 'notes.txt'].sort());
        assert.deepEqual(fs.readdirSync(path.join(root, 'public', 'uploads')), ['1700000000001-old-named.txt']);
        assert.deepEqual(asked, [[`uploads/${named}`, `uploads/${orphan}`].sort(), ['public/uploads/1700000000000-old-orphan.txt', 'public/uploads/1700000000001-old-named.txt']]);
    });
});

describe('the retention sweep keeps going after a directory fails', () => {
    let root;
    beforeEach(() => {
        root = tmpRoot('retention-error');
        fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
        fs.mkdirSync(path.join(root, 'public', 'uploads'), { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('sweeps the old directory when the private one fails, then reports the failure', async () => {
        const NOW = Date.UTC(2026, 9, 29, 12);
        const old = (NOW - (ORPHAN_UPLOAD_HOURS + 1) * 3600_000) / 1000;
        for (const rel of ['uploads/6f8fad5b-d9cb-469f-a165-70867728950e.txt', 'public/uploads/1700000000002-legacy-orphan.txt']) {
            const file = path.join(root, ...rel.split('/'));
            fs.writeFileSync(file, 'x');
            fs.utimesSync(file, old, old);
        }
        const client = {
            async query(sql, params) {
                if (params[0].some((p) => p.startsWith('uploads/'))) throw new Error('materials unavailable');
                return { rows: [] };
            },
        };
        await assert.rejects(sweepOrphanUploads({ client, uploadRoot: root, now: () => NOW }), /materials unavailable/);
        assert.deepEqual(fs.readdirSync(path.join(root, 'public', 'uploads')), [], 'the old directory was still swept');
        assert.equal(fs.readdirSync(path.join(root, 'uploads')).length, 1, 'nothing of the failed chunk was removed');
    });
});

describe('deployment', () => {
    it('keeps uploads in a volume on the VM and out of git, images and Vercel', () => {
        const compose = read('deploy/risepath-vm/docker-compose.yml');
        assert.match(compose, /\n {4}volumes:\n {6}- uploads:\/app\/uploads\n/);
        assert.match(compose, /\nvolumes:\n {2}pgdata:\n {2}uploads:\n/);
        assert.match(read('.gitignore'), /^\/uploads\/$/m);
        assert.match(read('.dockerignore'), /^uploads$/m);
        assert.match(read('.dockerignore'), /^public\/uploads$/m);
        assert.match(read('.vercelignore'), /^\/uploads$/m);
        // The volume starts with the mode of the image's directory.
        assert.match(read('deploy/risepath-vm/Dockerfile'), /^RUN mkdir -m 700 \/app\/uploads$/m);
    });

    it('the course generator offers only these files and explains a 415', () => {
        const view = read('components/features/ai/CourseGeneratorView.tsx');
        assert.match(view, /accept="\.pdf,\.txt,\.md,application\/pdf,text\/plain,text\/markdown"/);
        assert.match(view, /if \(status === 415\) return 'upload_unsupported';/);
        assert.match(view, /if \(selectedFile && !ACCEPTED_UPLOAD\.test\(selectedFile\.name\)\) \{/);
        assert.match(view, /uploadUnsupported: 'Only PDF, text \(\.txt\) and Markdown \(\.md\) files can be attached/);
        assert.match(view, /uploadUnsupported: '添付できるのは、PDF、テキスト（\.txt）、Markdown（\.md）のファイルだけです/);
    });
});
