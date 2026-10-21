/**
 * Building blocks of the database-outage handling (Phase 1 / P1-4): which errors count as an
 * outage, the pool timeouts, the 503 helpers and where they are used, the job worker's backoff,
 * the shared .env loader and the server-only Gemini key. The end-to-end checks with real pools
 * live in dbOutage.test.js.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDbError, isDbUnavailable } from '../../tools/core/dbErrors.js';
import { loadEnv } from '../../tools/core/env.js';
import { getPool, poolConfig, resetPoolForTests } from '../db.js';
import { DB_UNAVAILABLE_BODY, dbUnavailableErrorHandler, respondIfDbUnavailable } from '../dbUnavailable.js';
import { pollDelay } from '../jobWorker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const withCode = (code, message = code) => Object.assign(new Error(message), { code });

describe('isDbUnavailable', () => {
    it('recognises a database that cannot be reached or dropped the connection', () => {
        const outages = [
            withCode('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'),
            withCode('ENOTFOUND', 'getaddrinfo ENOTFOUND db'),
            withCode('ETIMEDOUT'),
            withCode('ECONNRESET'),
            withCode('57P01', 'terminating connection due to administrator command'),
            withCode('57P03', 'the database system is starting up'),
            withCode('53300', 'sorry, too many clients already'),
            withCode('08006', 'connection failure'),
            new Error('timeout exceeded when trying to connect'),
            new Error('Connection terminated due to connection timeout', { cause: new Error('timeout expired') }),
            new Error('Connection terminated unexpectedly'),
            new Error('Query read timeout'),
            // "localhost" resolves to ::1 and 127.0.0.1: Node reports both refusals together.
            new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')], ''),
        ];
        for (const err of outages) assert.equal(isDbUnavailable(err), true, `${err.code ?? ''} ${err.message}`);
    });

    it('leaves query errors, other services and plain bugs alone', () => {
        const others = [
            null,
            undefined,
            'ECONNREFUSED',
            withCode('23505', 'duplicate key'),
            withCode('42P01', 'relation "jobs" does not exist'),
            withCode('22P02', 'invalid input syntax for type uuid'),
            withCode('57014', 'canceling statement due to statement timeout'),
            withCode('28P01', 'password authentication failed'),
            new Error('boom'),
            new Error('Gemini request timeout'),
            // fetch (Gemini, Supabase, TTS) wraps socket errors: not the database.
            new TypeError('fetch failed', { cause: withCode('ECONNREFUSED') }),
            new Error('wrapped', { cause: withCode('ECONNREFUSED') }),
        ];
        for (const err of others) assert.equal(isDbUnavailable(err), false, String(err?.message ?? err));
    });

    it('classifyDbError reports outages as db_connection for the MCP tools', () => {
        assert.equal(classifyDbError(new Error('timeout exceeded when trying to connect'), 'getLesson').error_type, 'db_connection');
        assert.equal(classifyDbError(withCode('ECONNREFUSED'), 'getLesson').error_type, 'db_connection');
        assert.equal(classifyDbError(withCode('42P01'), 'getLesson').error_type, 'table_not_found');
        assert.equal(classifyDbError(new Error('boom'), 'getLesson').error_type, 'unknown');
    });
});

describe('pool settings', () => {
    it('fails fast by default', () => {
        assert.deepEqual(poolConfig('postgresql://db/rp', {}), {
            connectionString: 'postgresql://db/rp',
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            keepAlive: true,
            statement_timeout: 30000,
            query_timeout: 35000,
        });
    });

    it('takes PG_CONNECT_TIMEOUT_MS and PG_STATEMENT_TIMEOUT_MS from the environment', () => {
        const config = poolConfig('postgresql://db/rp', { PG_CONNECT_TIMEOUT_MS: '1500', PG_STATEMENT_TIMEOUT_MS: '10000' });
        assert.equal(config.connectionTimeoutMillis, 1500);
        assert.equal(config.statement_timeout, 10000);
        assert.equal(config.query_timeout, 15000);
    });

    it('never waits forever to connect, and can turn the statement limit off', () => {
        for (const value of ['0', '-1', 'abc', '']) {
            assert.equal(poolConfig('postgresql://db/rp', { PG_CONNECT_TIMEOUT_MS: value }).connectionTimeoutMillis, 5000, value);
        }
        const off = poolConfig('postgresql://db/rp', { PG_STATEMENT_TIMEOUT_MS: '0' });
        assert.equal('statement_timeout' in off, false);
        assert.equal('query_timeout' in off, false);
    });

    it('getPool builds the shared pool with these settings and an idle-client error handler', async () => {
        const saved = { url: process.env.DATABASE_URL_PHASE1, connect: process.env.PG_CONNECT_TIMEOUT_MS };
        process.env.DATABASE_URL_PHASE1 = 'postgresql://rp:rp@127.0.0.1:1/rp';
        process.env.PG_CONNECT_TIMEOUT_MS = '1234';
        resetPoolForTests();
        try {
            const pool = getPool();
            assert.equal(pool.options.connectionTimeoutMillis, 1234);
            assert.equal(pool.options.statement_timeout, 30000);
            assert.ok(pool.listenerCount('error') >= 1);
            await pool.end();
        } finally {
            resetPoolForTests();
            if (saved.url === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = saved.url;
            if (saved.connect === undefined) delete process.env.PG_CONNECT_TIMEOUT_MS;
            else process.env.PG_CONNECT_TIMEOUT_MS = saved.connect;
        }
    });
});

describe('503 helpers', () => {
    const fakeRes = () => {
        const res = {
            headersSent: false,
            statusCode: 200,
            headers: {},
            body: undefined,
            set(name, value) {
                res.headers[name.toLowerCase()] = value;
                return res;
            },
            status(code) {
                res.statusCode = code;
                return res;
            },
            json(body) {
                res.body = body;
                res.headersSent = true;
                return res;
            },
        };
        return res;
    };

    it('respondIfDbUnavailable answers 503 for an outage and leaves other errors to the route', () => {
        const res = fakeRes();
        assert.equal(respondIfDbUnavailable(res, withCode('ECONNREFUSED')), true);
        assert.equal(res.statusCode, 503);
        assert.equal(res.headers['retry-after'], '10');
        assert.deepEqual(res.body, DB_UNAVAILABLE_BODY);

        const other = fakeRes();
        assert.equal(respondIfDbUnavailable(other, new Error('boom')), false);
        assert.equal(other.statusCode, 200);
        assert.equal(other.body, undefined);
    });

    it('the last error handler answers 503 for an outage and passes everything else on', () => {
        const res = fakeRes();
        let passed = null;
        dbUnavailableErrorHandler(new Error('timeout exceeded when trying to connect'), {}, res, (err) => {
            passed = err;
        });
        assert.equal(res.statusCode, 503);
        assert.equal(passed, null);

        const bug = new Error('boom');
        dbUnavailableErrorHandler(bug, {}, fakeRes(), (err) => {
            passed = err;
        });
        assert.equal(passed, bug);

        const streaming = fakeRes();
        streaming.headersSent = true;
        const outage = withCode('ECONNRESET');
        dbUnavailableErrorHandler(outage, {}, streaming, (err) => {
            passed = err;
        });
        assert.equal(passed, outage, 'after headers went out, Express closes the response');
    });
});

describe('where the helpers are used', () => {
    /** Each `catch (name) { … }` block: its variable name and body (braces matched). */
    const catchBlocks = (src) => {
        const blocks = [];
        const re = /\} catch \((\w+)\) \{/g;
        let m;
        while ((m = re.exec(src))) {
            const open = m.index + m[0].length - 1;
            let depth = 0;
            let close = open;
            for (; close < src.length; close++) {
                if (src[close] === '{') depth += 1;
                else if (src[close] === '}' && --depth === 0) break;
            }
            blocks.push({ name: m[1], body: src.slice(open + 1, close) });
        }
        return blocks;
    };

    const DB_ROUTE_FILES = ['server/routes/user.js', 'server/routes/content.js', 'server/routes/chatgptCurriculum.js', 'server/routes/ai.js', 'server.js'];

    it('every catch that answers 500 in a database route checks for an outage first', () => {
        for (const file of DB_ROUTE_FILES) {
            const blocks = catchBlocks(read(file)).filter((b) => b.body.includes('status(500)'));
            assert.ok(blocks.length > 0, `${file}: no catch blocks found`);
            for (const block of blocks) {
                if (block.body.includes('Image generation failed')) continue; // no database in /image
                const first = block.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes("query('ROLLBACK')"))[0];
                assert.equal(first, `if (respondIfDbUnavailable(res, ${block.name})) return;`, `${file}: ${block.body.slice(0, 120)}`);
            }
        }
        for (const file of ['server/routes/lifeJournal.js', 'server/routes/learnerMemory.js']) {
            assert.match(read(file), /const respondServerError = \(res, label, error\) => \{\n\s+if \(respondIfDbUnavailable\(res, error\)\) return;/, file);
        }
    });

    it('a ROLLBACK in a catch cannot throw and hide the original error', () => {
        for (const file of [...DB_ROUTE_FILES, 'server/ragService.js', 'server/jobWorker.js']) {
            for (const block of catchBlocks(read(file))) {
                for (const line of block.body.split('\n').filter((l) => l.includes("query('ROLLBACK')"))) {
                    assert.match(line, /query\('ROLLBACK'\)\.catch\(/, `${file}: ${line.trim()}`);
                }
            }
        }
    });

    it('server.js mounts the 503 error handler after every route', () => {
        const src = read('server.js');
        const handler = src.indexOf('app.use(dbUnavailableErrorHandler);');
        assert.ok(handler > src.lastIndexOf("app.use('/api"), 'after the API routes');
        const rest = src.slice(handler + 1, src.indexOf('return app;', handler));
        assert.doesNotMatch(rest, /app\.(use|get|post|put|patch|delete)\(/, 'nothing mounted after it');
    });
});

describe('job worker backoff', () => {
    it('doubles the wait per failed poll up to a minute', () => {
        assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(pollDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    });

    it('uses the shared pool', () => {
        const src = read('server/jobWorker.js');
        assert.match(src, /import \{ getPool \} from '\.\/db\.js';/);
        assert.doesNotMatch(src, /new Pool\(/);
    });
});

describe('.env loading', () => {
    const KEYS = ['RP_TEST_A', 'RP_TEST_EMPTY', 'RP_TEST_QUOTED', 'DATABASE_URL_PHASE1'];
    const saved = {};
    let dir;
    beforeEach(() => {
        for (const key of KEYS) saved[key] = process.env[key];
        for (const key of KEYS) delete process.env[key];
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-env-'));
        fs.writeFileSync(path.join(dir, '.env.local'), [
            '# comment',
            'RP_TEST_A=from-file',
            'RP_TEST_EMPTY=filled',
            'export RP_TEST_QUOTED="two words"',
            'DATABASE_URL_PHASE1=postgresql://from-file/rp',
        ].join('\n'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const key of KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('the API server (force: []) fills unset or empty variables and never overrides the environment', async () => {
        process.env.RP_TEST_EMPTY = '';
        process.env.DATABASE_URL_PHASE1 = 'postgresql://from-env/rp';
        await loadEnv({ dir, force: [] });
        assert.equal(process.env.RP_TEST_A, 'from-file');
        assert.equal(process.env.RP_TEST_EMPTY, 'filled');
        assert.equal(process.env.RP_TEST_QUOTED, 'two words');
        assert.equal(process.env.DATABASE_URL_PHASE1, 'postgresql://from-env/rp');
    });

    it('the MCP server (default) still prefers the file for its forced keys', async () => {
        process.env.DATABASE_URL_PHASE1 = 'postgresql://from-env/rp';
        await loadEnv({ dir });
        assert.equal(process.env.DATABASE_URL_PHASE1, 'postgresql://from-file/rp');
    });

    it('falls back to .env when there is no .env.local', async () => {
        fs.rmSync(path.join(dir, '.env.local'));
        fs.writeFileSync(path.join(dir, '.env'), 'RP_TEST_A=from-dotenv\n');
        await loadEnv({ dir, force: [] });
        assert.equal(process.env.RP_TEST_A, 'from-dotenv');
    });

    it('server.js uses the shared loader without forced keys', () => {
        const src = read('server.js');
        assert.match(src, /import \{ loadEnv \} from '\.\/tools\/core\/env\.js';/);
        assert.match(src, /await loadEnv\(\{ force: \[\] \}\);/);
        assert.doesNotMatch(src, /loadEnvFile|readFile\([^)]*\.env/);
    });
});

describe('model keys on the server', () => {
    it('server code never reads a VITE_* model key (VITE_* values belong to the browser bundle)', () => {
        const offenders = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const rel = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'tests' && entry.name !== 'node_modules') walk(rel);
                } else if (/\.(?:m?js|ts)$/.test(entry.name) && /VITE_(?:GEMINI|GOOGLE|ANTHROPIC|OPENAI)_API_KEY/.test(read(rel))) {
                    offenders.push(rel);
                }
            }
        };
        for (const dir of ['server', 'tools', 'mcp-server']) walk(dir);
        assert.deepEqual(offenders, []);
        assert.doesNotMatch(read('server.js'), /VITE_(?:GEMINI|GOOGLE|ANTHROPIC|OPENAI)_API_KEY/);
    });
});
