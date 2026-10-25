// Accepting the terms of use (Phase 4, server/routes/legal.js at /api/v2/user/legal; design §4.4,
// §8 legalRoutes) on the real server.js stack: requireAuth and requireSignedIn, the 4 kb body parser
// registered before the 50 MB one, the per-learner limit, the version handshake, drafts refused in
// production, and the acceptance transaction against helpers/legalPool.js: the shared account lock
// first, the insert only while the auth.users stub exists, a deletion that committed meanwhile →
// 401 account_deleted and ROLLBACK. Version tables of a later release (history, requiresAcceptance)
// are checked on the router alone.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, resetPoolForTests, setPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { LEGAL_ACCEPTANCES_PER_MINUTE, LEGAL_SQL, acceptanceCounts, createLegalRouter, legalStatus, readAcceptanceBody } from '../routes/legal.js';
import { LEGAL_DOCUMENTS, currentLegalVersions, isDraftLegalVersion } from '../../shared/legal/versions.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createLegalPool, norm } from './helpers/legalPool.js';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const B = 'bcdef012-3456-4789-8bcd-ef0123456789';
const ANON = 'cdef0123-4567-489a-9bcd-ef0123456789';
const CLIENT = '11111111-2222-4000-8000-000000000001';
const nowS = () => Math.floor(Date.now() / 1000);
const CURRENT = currentLegalVersions();
const ACCEPT = { termsVersion: CURRENT.terms, privacyVersion: CURRENT.privacy };

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A Supabase session token (unsigned: the fake Supabase below does not check signatures). */
const token = (sub, { amr = [{ method: 'password', timestamp: nowS() - 3600 }], ...extra } = {}) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr, ...extra,
})}.c2ln`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** Supabase accepts every token and names its sub. */
const supabase = {
    auth: {
        getUser: async (t) => {
            const id = decodeTokenClaims(t)?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET',
    'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];

async function call(base, path, { method = 'GET', headers = {}, body, rawBody } = {}) {
    const init = { method, headers: { ...headers } };
    if (rawBody !== undefined || body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = rawBody ?? JSON.stringify(body);
    }
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text };
}

const listen = async (app, handler) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};
const withServer = async (handler) => listen(await createApp({ serveStatic: false }), handler);

const STATUS = '/api/v2/user/legal';
const ACCEPTANCE = '/api/v2/user/legal/acceptance';

/** The SQL the route sends inside its transaction, in order (BEGIN … COMMIT/ROLLBACK). */
const TX_ACCEPT = ['begin', 'lockTimeout', 'lock', 'insertVersions', 'readVersions', 'insertAcceptance', 'commit'];

describe('/api/v2/user/legal on the server.js stack', () => {
    const saved = {};
    let pool;
    let quiet;
    let warnings;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        pool = createLegalPool({ stubs: [A, B] });
        setPoolForTests(pool);
        setSupabaseForTests(supabase);
        warnings = [];
        quiet = { log: console.log, warn: console.warn, error: console.error };
        console.log = () => {};
        console.warn = (...args) => warnings.push(args.join(' '));
        console.error = () => {};
    });

    afterEach(() => {
        Object.assign(console, quiet);
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    it('no token 401; an agent\'s OAuth token 401 oauth_client_token; an anonymous user and the dev fallback 401 sign_in_required', async () => {
        await withServer(async (base) => {
            assert.equal((await call(base, STATUS)).status, 401);
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', body: ACCEPT })).status, 401);
            const agent = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A, { aud: 'https://mcp.example.org/mcp', client_id: CLIENT })), body: ACCEPT });
            assert.deepEqual([agent.status, agent.json.error_type], [401, 'oauth_client_token'], 'an agent never accepts for the person');
            for (const path of [STATUS, ACCEPTANCE]) {
                const anon = await call(base, path, { method: path === STATUS ? 'GET' : 'POST', headers: auth(token(ANON)), body: path === STATUS ? undefined : ACCEPT });
                assert.deepEqual([anon.status, anon.json], [401, { error: 'Sign in with a Rise Path account to accept the terms.', error_type: 'sign_in_required' }], path);
            }
            const bridgeUser = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(PHASE1_USER_ID)), body: ACCEPT });
            assert.deepEqual([bridgeUser.status, bridgeUser.json.error_type], [401, 'sign_in_required']);
        });
        setSupabaseForTests(null);
        await withServer(async (base) => {
            const dev = await call(base, ACCEPTANCE, { method: 'POST', body: ACCEPT });
            assert.deepEqual([dev.status, dev.json.error_type], [401, 'sign_in_required'], 'the dev fallback (PHASE1) never records');
        });
        assert.equal(pool.state.acceptances.length, 0);
    });

    it('GET: today (drafts) → not published, not accepted, no row; the current versions come from shared/legal/versions.js', async () => {
        await withServer(async (base) => {
            const res = await call(base, STATUS, { headers: auth(token(A)) });
            assert.equal(res.status, 200);
            assert.deepEqual(res.json, {
                ok: true,
                published: !isDraftLegalVersion(CURRENT.terms) && !isDraftLegalVersion(CURRENT.privacy),
                current: CURRENT,
                accepted: false,
                acceptedAt: null,
                lastAccepted: null,
                notice: [],
            });
            assert.equal(res.json.published, false, 'the texts are drafts today');
        });
    });

    it('POST in development: 201 with the server time, then 200 for the same versions (double click, two tabs); GET says accepted', async () => {
        await withServer(async (base) => {
            const first = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.equal(first.status, 201);
            assert.equal(first.json.ok, true);
            assert.equal(first.json.accepted, true);
            assert.ok(Number.isFinite(Date.parse(first.json.acceptedAt)));
            const again = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([again.status, again.json], [200, { ok: true, accepted: true, acceptedAt: first.json.acceptedAt }]);
            assert.equal(pool.state.acceptances.length, 1, 'one proof row');
            assert.deepEqual(Object.keys(pool.state.acceptances[0]).sort(), ['accepted_at', 'account_deleted_at', 'privacy_version', 'terms_version', 'user_id'],
                'D5: account id, versions and time only (no IP, user agent, email or name)');
            const status = await call(base, STATUS, { headers: auth(token(A)) });
            assert.equal(status.json.accepted, true);
            assert.equal(status.json.acceptedAt, first.json.acceptedAt);
            assert.deepEqual(status.json.notice, []);
            assert.deepEqual(status.json.lastAccepted, { termsVersion: CURRENT.terms, privacyVersion: CURRENT.privacy, acceptedAt: first.json.acceptedAt });
            // The version archive got both ids with the hashes of versions.js.
            assert.deepEqual([...pool.state.versions.values()].map((v) => [v.version, v.document, v.sha256]), [
                [CURRENT.terms, 'terms', LEGAL_DOCUMENTS.terms.sha256],
                [CURRENT.privacy, 'privacy', LEGAL_DOCUMENTS.privacy.sha256],
            ]);
        });
    });

    it('the transaction takes the shared account lock first and inserts only while the stub exists; an upper-case id is lower-cased', async () => {
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A.toUpperCase())), body: ACCEPT });
            assert.equal(res.status, 201);
        });
        assert.deepEqual(pool.txNames(), TX_ACCEPT);
        const tx = pool.queries.filter((q) => q.tx);
        assert.equal(tx[2].sql, norm("SELECT pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || $1::uuid::text, 0))"));
        assert.match(tx[5].sql, /^insert into legal_acceptances \(user_id, terms_version, privacy_version\) select \$1::uuid, \$2, \$3 where exists \(select 1 from auth\.users where id = \$1::uuid\) on conflict/);
        for (const q of [tx[2], tx[5]]) assert.equal(q.params[0], A, 'the canonical (lower-case) id');
        assert.equal(pool.state.acceptances[0].user_id, A);
        assert.equal(pool.connects, pool.releases, 'the client goes back to the pool');
    });

    it('a deletion that committed while the request waited on the lock → no row, 401 account_deleted, ROLLBACK', async () => {
        // What the deletion leaves (migration 018 + server/services/accountDeletion.js): no stub, a tombstone.
        pool.onStatement('lock', (state) => {
            state.stubs.delete(A);
            state.tombstones.set(A, { deleted_at: new Date(), reopened_at: null });
        });
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json], [401, { error: 'This Rise Path account was deleted. Sign in again to start a new, empty account.', error_type: 'account_deleted' }]);
        });
        assert.deepEqual(pool.txNames(), ['begin', 'lockTimeout', 'lock', 'insertVersions', 'readVersions', 'insertAcceptance', 'existingAcceptance', 'deletedAccount', 'rollback']);
        assert.equal(pool.state.acceptances.length, 0, 'no proof for a deleted account');
    });

    it('no row and no tombstone (the stub could not be written at sign-in) → 503 legal_unavailable, ROLLBACK', async () => {
        pool.state.stubs.delete(B);
        pool.failOn(/^insert into auth\.users/, Object.assign(new Error('stub insert failed'), { code: '08006' }));
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(B)), body: ACCEPT });
            assert.deepEqual([res.status, res.json.error_type], [503, 'legal_unavailable']);
        });
        assert.equal(pool.txNames().at(-1), 'rollback');
        assert.equal(pool.state.acceptances.length, 0);
    });

    it('a version id stored with another hash → 500 legal_version_conflict, ROLLBACK, one log line, no acceptance', async () => {
        pool.state.versions.set(CURRENT.terms, { version: CURRENT.terms, document: 'terms', sha256: 'f'.repeat(64) });
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json], [500, { error: 'This version of the terms is stored with another text.', error_type: 'legal_version_conflict' }]);
        });
        assert.deepEqual(pool.txNames(), ['begin', 'lockTimeout', 'lock', 'insertVersions', 'readVersions', 'rollback']);
        assert.equal(pool.state.acceptances.length, 0);
        assert.equal(pool.state.versions.get(CURRENT.terms).sha256, 'f'.repeat(64), 'the stored row is never overwritten');
        assert.ok(warnings.includes(`[Legal] version ${CURRENT.terms} is stored with another hash`), warnings.join('\n'));
    });

    it('drafts are never recorded in production: 409 legal_not_published before any SQL', async () => {
        process.env.NODE_ENV = 'production';
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json], [409, { error: 'These terms are not published yet.', error_type: 'legal_not_published' }]);
            // GET still answers (published: false), so the browser can tell.
            const status = await call(base, STATUS, { headers: auth(token(A)) });
            assert.deepEqual([status.status, status.json.published], [200, false]);
        });
        assert.equal(pool.connects, 0);
        assert.equal(pool.state.versions.size, 0, 'no draft row in the production archive');
    });

    it('400 invalid_body for anything but two version ids of the right documents; 409 legal_version_mismatch with the current ones', async () => {
        await withServer(async (base) => {
            for (const body of [
                {}, [], { termsVersion: CURRENT.terms }, { termsVersion: 1, privacyVersion: 2 },
                { termsVersion: CURRENT.privacy, privacyVersion: CURRENT.terms },
                { termsVersion: 'terms-2026-1-1', privacyVersion: CURRENT.privacy },
                { termsVersion: `${CURRENT.terms}x`, privacyVersion: CURRENT.privacy },
            ]) {
                const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body });
                assert.deepEqual([res.status, res.json.error_type], [400, 'invalid_body'], JSON.stringify(body));
            }
            const stale = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: { termsVersion: 'terms-draft-2026-10-01', privacyVersion: CURRENT.privacy } });
            assert.deepEqual([stale.status, stale.json], [409, { error: 'The text has changed. Please read it again.', error_type: 'legal_version_mismatch', current: CURRENT }]);
            const bad = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), rawBody: '{"termsVersion":' });
            assert.deepEqual([bad.status, bad.json], [400, { error: 'The request body is not valid JSON.', error_type: 'invalid_body' }]);
        });
        assert.equal(pool.connects, 0);
    });

    it('an 8 KB body → 413 body_too_large (JSON) from the 4 kb parser, before auth and the route', async () => {
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: { ...ACCEPT, pad: 'x'.repeat(8 * 1024) } });
            assert.deepEqual([res.status, res.json], [413, { error: 'The request body is larger than 4kb.', error_type: 'body_too_large' }]);
        });
        assert.equal(pool.connects, 0);
        assert.equal(pool.state.acceptances.length, 0);
    });

    it('a database error → 503 legal_unavailable with fixed text (never the driver\'s), ROLLBACK, the client released', async () => {
        const driver = Object.assign(new Error('relation "legal_acceptances" does not exist at character 13 SECRET_DETAIL'), { code: '42P01' });
        pool.failOn(/^insert into legal_acceptances/, driver);
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json], [503, { error: 'The terms cannot be checked right now. Please try again later.', error_type: 'legal_unavailable' }]);
            assert.doesNotMatch(res.text, /SECRET_DETAIL|relation|42P01/);
            pool.failOn(/^select terms_version/, driver);
            const status = await call(base, STATUS, { headers: auth(token(A)) });
            assert.deepEqual([status.status, status.json.error_type], [503, 'legal_unavailable']);
            assert.doesNotMatch(status.text, /SECRET_DETAIL|relation/);
        });
        assert.equal(pool.txNames().at(-1), 'rollback');
        assert.equal(pool.connects, pool.releases);
        assert.ok(warnings.every((w) => !w.includes('SECRET_DETAIL')), 'the log line has the code only');
    });

    it('a ROLLBACK that fails destroys the client (release(error)); a good one returns it to the pool healthy', async () => {
        const dead = Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' });
        pool.failOn(/^insert into legal_acceptances/, Object.assign(new Error('insert failed'), { code: '08006' }));
        pool.failOn(/^rollback$/, dead);
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json.error_type], [503, 'legal_unavailable']);
            assert.doesNotMatch(res.text, /terminated/);
        });
        assert.equal(pool.txNames().at(-1), 'rollback', 'the ROLLBACK was tried');
        assert.equal(pool.connects, pool.releases);
        assert.equal(pool.releasedWith.at(-1), dead, 'a broken connection is never handed to the next request');

        // The deleted-account path rolls back too: a failed ROLLBACK there still answers 401 and destroys the client.
        pool = createLegalPool({ stubs: [A] });
        setPoolForTests(pool);
        pool.onStatement('lock', (state) => {
            state.stubs.delete(A);
            state.tombstones.set(A, { deleted_at: new Date(), reopened_at: null });
        });
        pool.failOn(/^rollback$/, dead);
        await withServer(async (base) => {
            const res = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([res.status, res.json.error_type], [401, 'account_deleted']);
        });
        assert.equal(pool.releasedWith.at(-1), dead);

        // A BEGIN that fails on a dead connection is probed by ROLLBACK as well.
        pool = createLegalPool({ stubs: [A] });
        setPoolForTests(pool);
        pool.failOn(/^begin$/, dead);
        pool.failOn(/^rollback$/, dead);
        await withServer(async (base) => {
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT })).status, 503);
        });
        assert.deepEqual(pool.txNames(), ['begin', 'rollback']);
        assert.equal(pool.releasedWith.at(-1), dead);

        // A ROLLBACK that works, and a COMMIT: release() with nothing (the client stays in the pool).
        pool = createLegalPool({ stubs: [A] });
        setPoolForTests(pool);
        pool.failOn(/^insert into legal_acceptances/, Object.assign(new Error('insert failed'), { code: '08006' }));
        await withServer(async (base) => {
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT })).status, 503);
        });
        assert.equal(pool.txNames().at(-1), 'rollback');
        assert.deepEqual(pool.releasedWith, [undefined]);
        pool = createLegalPool({ stubs: [A] });
        setPoolForTests(pool);
        await withServer(async (base) => {
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT })).status, 201);
        });
        assert.deepEqual(pool.releasedWith, [undefined]);
    });

    it(`the ${LEGAL_ACCEPTANCES_PER_MINUTE + 1}th POST in a minute → 429 rate_limited, per learner`, async () => {
        await withServer(async (base) => {
            for (let i = 0; i < LEGAL_ACCEPTANCES_PER_MINUTE; i += 1) {
                assert.ok([200, 201].includes((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT })).status));
            }
            const limited = await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT });
            assert.deepEqual([limited.status, limited.json.error_type], [429, 'rate_limited']);
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(B)), body: ACCEPT })).status, 201, 'another learner is not limited');
        });
    });

    it('rows of an earlier, deleted account under the same id never count', async () => {
        pool = createLegalPool({
            stubs: [A],
            acceptances: [{ user_id: A, terms_version: CURRENT.terms, privacy_version: CURRENT.privacy, accepted_at: new Date('2026-10-01T00:00:00Z'), account_deleted_at: new Date('2026-10-02T00:00:00Z') }],
        });
        setPoolForTests(pool);
        await withServer(async (base) => {
            const res = await call(base, STATUS, { headers: auth(token(A)) });
            assert.deepEqual([res.json.accepted, res.json.lastAccepted], [false, null]);
            assert.equal((await call(base, ACCEPTANCE, { method: 'POST', headers: auth(token(A)), body: ACCEPT })).status, 201, 'the re-opened account accepts anew');
        });
        assert.equal(pool.state.acceptances.length, 2);
    });
});

// ---------------------------------------------------------------------------------------------
// Later releases: requiresAcceptance and the notice (the router with version tables of its own)

const entry = (document, version, { requiresAcceptance, effectiveDate = version.slice(-10) }) => ({
    version,
    sha256: (document === 'terms' ? 'a' : 'b').repeat(64),
    effectiveDate,
    requiresAcceptance,
    include: { billing: false, byoa: false },
    source: `doc/legal/${document}.draft.ja.md`,
    generated: `content/legal/${document}.ja.md`,
});
const history = (document, version, requiresAcceptance) => ({ document, version, sha256: 'c'.repeat(64), effectiveDate: version.slice(-10), requiresAcceptance });
const T1 = 'terms-2026-12-01';
const P1 = 'privacy-2026-12-01';
const RELEASE_1 = { terms: entry('terms', T1, { requiresAcceptance: true }), privacy: entry('privacy', P1, { requiresAcceptance: false }) };

async function withRouter(options, userId, handler) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.userId = userId;
        next();
    });
    app.use('/legal', createLegalRouter({ logger: { warn: () => {} }, env: { NODE_ENV: 'production' }, ...options }));
    await listen(app, handler);
}

describe('createLegalRouter with released versions (requiresAcceptance, notice)', () => {
    const acceptedRow = (terms, privacy) => ({ user_id: A, terms_version: terms, privacy_version: privacy, accepted_at: new Date('2026-12-02T00:00:00Z') });

    it('a privacy-only change keeps accepted: true and sets a notice with its effective date', async () => {
        const documents = { terms: RELEASE_1.terms, privacy: entry('privacy', 'privacy-2027-04-01', { requiresAcceptance: false }) };
        const pool = createLegalPool({ stubs: [A], acceptances: [acceptedRow(T1, P1)] });
        await withRouter({ getPool: () => pool, documents, history: [history('privacy', P1, false)] }, A, async (base) => {
            const res = await call(base, '/legal');
            assert.equal(res.json.published, true);
            assert.equal(res.json.accepted, true);
            assert.deepEqual(res.json.notice, [{ document: 'privacy', version: 'privacy-2027-04-01', effectiveDate: '2027-04-01' }]);
        });
    });

    it('an editorial terms change (requiresAcceptance false) is a notice; a terms change that requires acceptance → accepted: false', async () => {
        const editorial = { terms: entry('terms', 'terms-2027-04-01', { requiresAcceptance: false }), privacy: RELEASE_1.privacy };
        const requiring = { terms: entry('terms', 'terms-2027-04-01', { requiresAcceptance: true }), privacy: RELEASE_1.privacy };
        const pool = createLegalPool({ stubs: [A], acceptances: [acceptedRow(T1, P1)] });
        await withRouter({ getPool: () => pool, documents: editorial, history: [history('terms', T1, true)] }, A, async (base) => {
            const res = await call(base, '/legal');
            assert.deepEqual([res.json.accepted, res.json.notice.map((n) => n.document)], [true, ['terms']]);
        });
        await withRouter({ getPool: () => pool, documents: requiring, history: [history('terms', T1, true)] }, A, async (base) => {
            const res = await call(base, '/legal');
            assert.deepEqual([res.json.accepted, res.json.notice], [false, []]);
            assert.deepEqual(res.json.lastAccepted.termsVersion, T1, 'the page says "we updated the terms"');
        });
    });

    it('released versions are recorded in production; a released mismatch is 409 with the current ones', async () => {
        const pool = createLegalPool({ stubs: [A] });
        await withRouter({ getPool: () => pool, documents: RELEASE_1 }, A, async (base) => {
            const ok = await call(base, '/legal/acceptance', { method: 'POST', body: { termsVersion: T1, privacyVersion: P1 } });
            assert.equal(ok.status, 201);
            const old = await call(base, '/legal/acceptance', { method: 'POST', body: { termsVersion: 'terms-2026-11-01', privacyVersion: P1 } });
            assert.deepEqual([old.status, old.json.current], [409, { terms: T1, privacy: P1 }]);
        });
        assert.deepEqual([...pool.state.versions.keys()], [T1, P1]);
    });

    it('acceptanceCounts / legalStatus / readAcceptanceBody (pure)', () => {
        const acceptable = (d) => (d === 'terms' ? [T1, 'terms-2027-04-01'] : null);
        assert.equal(acceptanceCounts(undefined, acceptable), false, 'no row never counts');
        assert.equal(acceptanceCounts({ terms_version: T1, privacy_version: 'privacy-draft-2026-10-22' }, acceptable), true, 'privacy: any (null)');
        assert.equal(acceptanceCounts({ terms_version: 'terms-2026-11-01', privacy_version: P1 }, acceptable), false);
        const status = legalStatus(undefined, { documents: RELEASE_1, acceptable: () => [T1] });
        assert.deepEqual(status, { ok: true, published: true, current: { terms: T1, privacy: P1 }, accepted: false, acceptedAt: null, lastAccepted: null, notice: [] });
        assert.deepEqual(readAcceptanceBody({ termsVersion: T1, privacyVersion: P1, extra: 1 }), { termsVersion: T1, privacyVersion: P1 });
        for (const body of [null, 'x', [T1, P1], { termsVersion: P1, privacyVersion: T1 }]) assert.equal(readAcceptanceBody(body), null);
    });

    it('the statements: the lock key is built from $1::uuid::text, the insert needs the stub', () => {
        assert.equal(LEGAL_SQL.lock, "SELECT pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || $1::uuid::text, 0))");
        assert.match(LEGAL_SQL.insertAcceptance, /WHERE EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)/);
        assert.match(LEGAL_SQL.insertAcceptance, /ON CONFLICT \(user_id, terms_version, privacy_version\) WHERE account_deleted_at IS NULL DO NOTHING/);
        assert.match(LEGAL_SQL.latest, /AND account_deleted_at IS NULL ORDER BY accepted_at DESC LIMIT 1$/);
        assert.match(LEGAL_SQL.deletedAccount, /reopened_at IS NULL$/);
    });
});
