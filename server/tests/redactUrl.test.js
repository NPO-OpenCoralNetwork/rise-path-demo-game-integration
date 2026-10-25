// What the api logs about a request (Phase 4, owner decision D4; server/utils/redactUrl.js): the
// request line and the last-resort 5xx line carry no query string, only 8 characters of an id, no
// dates, emails, upload file names or tokens, and never a pg error's detail.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeError, redactUrl } from '../utils/redactUrl.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ID = 'aaaaaaaa-1111-4bbb-8ccc-0123456789ab';

describe('redactUrl', () => {
    it('drops the query string and the hash', () => {
        assert.equal(redactUrl('/api/v2/search?q=my+diary&token=abc'), '/api/v2/search');
        assert.equal(redactUrl('/api/v2/x#section'), '/api/v2/x');
        assert.equal(redactUrl('/api/v2/x?a=1#b'), '/api/v2/x');
        assert.equal(redactUrl('/api/v2/health'), '/api/v2/health');
    });

    it('keeps only the edge smoke id of a query (scripts/smoke-public-edge.mjs check 8: 12 hex characters, no personal data)', () => {
        assert.equal(redactUrl('/api/v2/llm/status?smoke=0123456789ab'), '/api/v2/llm/status?smoke=0123456789ab');
        assert.equal(redactUrl('/api/v2/llm/status?q=diary&smoke=0123456789ab'), '/api/v2/llm/status?smoke=0123456789ab', 'other parameters are still dropped');
        assert.equal(redactUrl('/api/v2/llm/status?smoke=0123456789ab&q=diary#x'), '/api/v2/llm/status?smoke=0123456789ab');
        for (const value of ['me@example.org', '0123456789abcdef', '0123456789AB', '0123456789a', 'zzzzzzzzzzzz']) {
            assert.equal(redactUrl(`/x?smoke=${value}`), '/x', value);
        }
        assert.equal(redactUrl('/x?notsmoke=0123456789ab'), '/x');
    });

    it('keeps 8 characters of a UUID, in any case', () => {
        assert.equal(redactUrl(`/api/v2/admin/safety/learners/${ID}/age`), '/api/v2/admin/safety/learners/aaaaaaaa…/age');
        assert.equal(redactUrl(`/api/v2/curricula/${ID.toUpperCase()}/publish`), '/api/v2/curricula/AAAAAAAA…/publish');
        assert.equal(redactUrl(`/a/${ID}/b/${ID}`), '/a/aaaaaaaa…/b/aaaaaaaa…');
    });

    it('dates, emails (also %40), upload file names and long tokens', () => {
        assert.equal(redactUrl('/api/v2/life-journal/daily/2026-01-05'), '/api/v2/life-journal/daily/:date');
        assert.equal(redactUrl('/api/v2/users/someone@example.org/x'), '/api/v2/users/:email/x');
        assert.equal(redactUrl('/api/v2/users/someone%40example.org'), '/api/v2/users/:email');
        assert.equal(redactUrl('/uploads/1700000000000-%E5%B1%B1%E7%94%B0.pdf'), '/uploads/1700000000000-:name');
        assert.equal(redactUrl(`/api/v2/oauth/${'A1b2_C3d4-'.repeat(4)}`), '/api/v2/oauth/:token');
        assert.equal(redactUrl('/api/v2/ab'.padEnd(31, 'c')), '/api/v2/ab'.padEnd(31, 'c'), 'shorter runs stay');
    });

    it('at most 200 characters; anything that is not a string is ""', () => {
        assert.equal(redactUrl(`/${'a/'.repeat(300)}`).length, 200);
        assert.equal(redactUrl(undefined), '');
        assert.equal(redactUrl(null), '');
    });
});

describe('describeError', () => {
    it('name, code and message only: never detail, the query or the stack', () => {
        const pgError = Object.assign(new Error('insert or update on table "lesson_progress" violates foreign key constraint "lesson_progress_user_id_fkey"'), {
            code: '23503',
            detail: `Key (user_id)=(${ID}) is not present in table "users".`,
            table: 'lesson_progress',
            where: 'SQL statement',
        });
        const line = describeError(pgError);
        assert.equal(line, 'Error 23503: insert or update on table "lesson_progress" violates foreign key constraint "lesson_progress_user_id_fkey"');
        assert.ok(!line.includes(ID));
        assert.equal(describeError(Object.assign(new TypeError('x is not a function'), {})), 'TypeError: x is not a function');
        assert.equal(describeError(undefined), 'Error: ');
        assert.equal(describeError({ name: 'N'.repeat(80), code: 'C'.repeat(40), message: 'm'.repeat(400) }).length, 40 + 1 + 20 + 2 + 300);
    });
});

describe('server.js: the request logger and the 5xx line', () => {
    it('R: both go through redactUrl, and the 5xx line through describeError (no raw originalUrl, no error object)', () => {
        assert.match(SERVER, /console\.log\(`\[\$\{new Date\(\)\.toISOString\(\)\}\] \$\{req\.method\} \$\{redactUrl\(req\.originalUrl\)\} \$\{res\.statusCode\} \$\{ms\}ms auth=\$\{auth\}`\);/);
        assert.match(SERVER, /console\.error\(`\[Server\] \$\{req\.method\} \$\{redactUrl\(req\.originalUrl\)\} failed: \$\{describeError\(err\)\}`\);/);
        assert.ok(!SERVER.includes('${req.originalUrl}'), 'no raw originalUrl in a template');
        assert.doesNotMatch(SERVER, /console\.(error|warn|log)\([^;]*, err\)/, 'no error object handed to console');
    });

    describe('on the real stack (createApp)', () => {
        const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1', 'ORIGIN_SECRET', 'AI_ACCESS_DEV_AUDIENCE'];
        const saved = {};
        const quiet = { log: console.log, error: console.error, warn: console.warn };
        let logged;
        let mods;

        beforeEach(async () => {
            process.env.KOKORO_TTS_URL ??= 'http://127.0.0.1:1';
            mods = {
                ...(await import('../../server.js')),
                ...(await import('../db.js')),
                ...(await import('../middleware/auth.js')),
            };
            for (const key of ENV_KEYS) saved[key] = process.env[key];
            for (const key of ENV_KEYS) delete process.env[key];
            process.env.NODE_ENV = 'development';
            process.env.AI_ACCESS_DEV_AUDIENCE = 'adult';
            mods.setSupabaseForTests({ auth: { getUser: async () => ({ data: { user: { id: ID } }, error: null }) } });
            // The sign-in checks read with pool.query (no tombstone); pool.connect() fails like Postgres
            // refusing a foreign key, with the full id in detail.
            const fkError = Object.assign(new Error('insert or update on table "curriculum_versions" violates foreign key constraint "x_fkey"'), {
                code: '23503',
                detail: `Key (user_id)=(${ID}) is not present in table "users".`,
            });
            mods.setPoolForTests({
                query: async () => ({ rowCount: 0, rows: [] }),
                connect: async () => { throw fkError; },
            });
            logged = [];
            console.log = (...args) => logged.push(['log', args]);
            console.error = (...args) => logged.push(['error', args]);
            console.warn = () => {};
        });

        afterEach(() => {
            Object.assign(console, quiet);
            for (const key of ENV_KEYS) {
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
            }
            mods.setSupabaseForTests(null);
            mods.resetPoolForTests();
        });

        it('R: a 500 logs the redacted path and the error\'s name, code and message; the request line is redacted too', async () => {
            const app = await mods.createApp({ serveStatic: false });
            const server = await new Promise((resolve) => {
                const s = app.listen(0, '127.0.0.1', () => resolve(s));
            });
            try {
                const base = `http://127.0.0.1:${server.address().port}`;
                const response = await fetch(`${base}/api/v2/curricula/${ID}/publish?email=someone@example.org`, {
                    method: 'POST',
                    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ curriculum_version_id: ID }),
                });
                assert.equal(response.status, 500);
                assert.deepEqual(await response.json(), { error: 'Internal Server Error' });
                await new Promise((resolve) => setTimeout(resolve, 20)); // the request line is written on 'finish'
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
            const errors = logged.filter(([kind]) => kind === 'error');
            assert.deepEqual(errors.map(([, args]) => args), [[
                '[Server] POST /api/v2/curricula/aaaaaaaa…/publish failed: Error 23503: insert or update on table "curriculum_versions" violates foreign key constraint "x_fkey"',
            ]]);
            const requests = logged.filter(([kind, args]) => kind === 'log' && /\] POST /.test(String(args[0])));
            assert.equal(requests.length, 1);
            assert.match(String(requests[0][1][0]), /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] POST \/api\/v2\/curricula\/aaaaaaaa…\/publish 500 \d+ms auth=\S+$/);
            const everything = JSON.stringify(logged);
            for (const leak of [ID, 'someone@example.org', 'email=', 'is not present in table']) assert.ok(!everything.includes(leak), leak);
        });
    });
});
