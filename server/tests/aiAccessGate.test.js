// AI access rules (server/safety/access.js) and the gate (server/middleware/aiAccessGate.js):
// every outcome, the cache and its invalidation, the safety pause, the dev and no-database
// policies, and requireAdmin.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    AiAccessUnavailableError,
    CONSENT_POLICY_VERSION,
    blocksBeforePause,
    invalidateAiAccess,
    recordGuardianConsent,
    resetAiAccessForTests,
    resolveAiAccess,
    revokeGuardianConsent,
    setBirthYm,
    tokyoDayBounds,
} from '../safety/access.js';
import { aiAccessGate, aiAccessStartupWarnings } from '../middleware/aiAccessGate.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';

const ADULT = 'aaaaaaaa-0000-4000-8000-000000000001';
const MINOR = 'aaaaaaaa-0000-4000-8000-000000000002';
const NO_AGE = 'aaaaaaaa-0000-4000-8000-000000000003';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000009';
// 22 Oct 2026 12:00 JST.
const NOW = new Date('2026-10-22T03:00:00.000Z');
const DEV = { NODE_ENV: 'development' };
const PROD = { NODE_ENV: 'production' };
const ENV_KEYS = ['NODE_ENV', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', 'SAFETY_BLOCKS_BEFORE_PAUSE'];

const basePool = (extra = {}) => createAiAccessPool({
    ages: { [ADULT]: '1990-05', [MINOR]: '2013-04' },
    ...extra,
});

const blockedEvents = (userId, n, at = NOW) => Array.from({ length: n }, (_, i) => ({
    user_id: userId,
    kind: 'input_blocked',
    created_at: new Date(at.getTime() - i * 1000),
}));

describe('resolveAiAccess', () => {
    beforeEach(() => {
        resetAiAccessForTests();
    });
    afterEach(() => {
        resetPoolForTests();
        resetAiAccessForTests();
    });

    it('needs an age first; the learner can still set it', async () => {
        setPoolForTests(basePool());
        assert.deepEqual(await resolveAiAccess(NO_AGE, { env: DEV, now: NOW }), {
            status: 'needs_age', audience: null, birthYm: null, consent: null, ageEditable: true,
        });
    });

    it('an adult is ready with no consent and cannot change the recorded age', async () => {
        const pool = basePool();
        setPoolForTests(pool);
        assert.deepEqual(await resolveAiAccess(ADULT, { env: DEV, now: NOW }), {
            status: 'ready', audience: 'adult', birthYm: '1990-05', consent: null, ageEditable: false,
        });
        assert.ok(!pool.queries.some((q) => q.sql.includes('account_consents')), 'adults need no consent lookup');
    });

    it('a minor needs an active guardian consent for the current policy version', async () => {
        const pool = basePool({
            consents: [
                { user_id: MINOR, policy_version: 'guardian-ai-2025-01' },
                { user_id: MINOR, revoked_at: new Date('2026-09-01T00:00:00Z') },
            ],
        });
        setPoolForTests(pool);
        const access = await resolveAiAccess(MINOR, { env: DEV, now: NOW });
        assert.equal(access.status, 'needs_guardian_consent');
        assert.equal(access.audience, 'minor');
        assert.equal(access.consent, null, 'an old version or a revoked consent does not count');

        await recordGuardianConsent({ userId: MINOR, method: 'guardian_on_device', relationship: 'parent' });
        const ready = await resolveAiAccess(MINOR, { env: DEV, now: NOW });
        assert.equal(ready.status, 'ready');
        assert.equal(ready.audience, 'minor');
        assert.equal(ready.consent.method, 'guardian_on_device');
        assert.equal(ready.consent.relationship, 'parent');
        assert.match(ready.consent.givenAt, /^\d{4}-\d{2}-\d{2}T/);
        const insert = pool.queries.find((q) => q.sql.startsWith('insert into account_consents'));
        assert.equal(insert.params[2], CONSENT_POLICY_VERSION);
        assert.equal(insert.params[5], null, 'no recorded_by on the device');

        await revokeGuardianConsent({ userId: MINOR });
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: NOW })).status, 'needs_guardian_consent', 'revoking stops AI again');
    });

    it('a learner who turns 18 no longer needs the consent', async () => {
        setPoolForTests(basePool({ ages: { [MINOR]: '2008-10' } }));
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: new Date('2026-10-30T14:59:00Z') })).status, 'needs_guardian_consent');
        resetAiAccessForTests();
        const adult = await resolveAiAccess(MINOR, { env: DEV, now: new Date('2026-10-30T15:00:00Z') });
        assert.equal(adult.status, 'ready');
        assert.equal(adult.audience, 'adult');
    });

    it('pauses after SAFETY_BLOCKS_BEFORE_PAUSE blocked inputs today, until 00:00 JST', async () => {
        const yesterday = new Date('2026-10-21T14:00:00.000Z'); // 23:00 JST on the 21st
        setPoolForTests(basePool({
            consents: [{ user_id: MINOR }],
            events: [...blockedEvents(MINOR, 9), ...blockedEvents(MINOR, 5, yesterday)],
        }));
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: NOW })).status, 'ready', '9 today, 5 yesterday');

        setPoolForTests(basePool({ consents: [{ user_id: MINOR }], events: blockedEvents(MINOR, 10) }));
        resetAiAccessForTests();
        const paused = await resolveAiAccess(MINOR, { env: DEV, now: NOW });
        assert.equal(paused.status, 'paused');
        assert.equal(paused.audience, 'minor');
        assert.equal(paused.pausedUntil, '2026-10-22T15:00:00.000Z', 'next 00:00 JST');

        resetAiAccessForTests();
        assert.equal((await resolveAiAccess(MINOR, { env: { ...DEV, SAFETY_BLOCKS_BEFORE_PAUSE: '11' }, now: NOW })).status, 'ready');
        resetAiAccessForTests();
        assert.equal((await resolveAiAccess(MINOR, { env: { ...DEV, SAFETY_BLOCKS_BEFORE_PAUSE: '3' }, now: NOW })).status, 'paused');
    });

    it('personal-information blocks never count towards the pause', async () => {
        const personal = blockedEvents(MINOR, 10).map((e) => ({ ...e, category: 'personal_info' }));
        const misuse = blockedEvents(MINOR, 9).map((e) => ({ ...e, category: 'bullying' }));
        const pool = basePool({ consents: [{ user_id: MINOR }], events: [...personal, ...misuse] });
        setPoolForTests(pool);
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: NOW })).status, 'ready', '10 personal_info + 9 others');
        const count = pool.queries.find((q) => q.sql.startsWith('select count(*)::int as blocked'));
        assert.match(count.sql, /category is distinct from \$3/);
        assert.equal(count.params[2], 'personal_info');

        pool.events.push(...blockedEvents(MINOR, 1).map((e) => ({ ...e, category: 'other' })));
        resetAiAccessForTests();
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: NOW })).status, 'paused', 'the tenth classifier block pauses');
    });

    it('SAFETY_BLOCKS_BEFORE_PAUSE=0 never pauses and skips the count', async () => {
        const pool = basePool({ events: blockedEvents(ADULT, 50) });
        setPoolForTests(pool);
        assert.equal((await resolveAiAccess(ADULT, { env: { ...DEV, SAFETY_BLOCKS_BEFORE_PAUSE: '0' }, now: NOW })).status, 'ready');
        assert.ok(!pool.queries.some((q) => q.sql.includes('ai_safety_events')));
        assert.equal(blocksBeforePause({}), 10);
        assert.equal(blocksBeforePause({ SAFETY_BLOCKS_BEFORE_PAUSE: '-1' }), 10, 'not a whole number: the default');
        assert.equal(blocksBeforePause({ SAFETY_BLOCKS_BEFORE_PAUSE: 'abc' }), 10);
        assert.equal(blocksBeforePause({ SAFETY_BLOCKS_BEFORE_PAUSE: ' 4 ' }), 4);
    });

    it('caches for 60 s, never past 00:00 JST, and every write invalidates', async () => {
        const pool = basePool();
        setPoolForTests(pool);
        await resolveAiAccess(NO_AGE, { env: DEV, now: NOW });
        const reads = () => pool.accessQueries().length;
        const first = reads();
        await resolveAiAccess(NO_AGE, { env: DEV, now: new Date(NOW.getTime() + 59_000) });
        assert.equal(reads(), first, 'served from the cache');
        await resolveAiAccess(NO_AGE, { env: DEV, now: new Date(NOW.getTime() + 60_000) });
        assert.ok(reads() > first, 'read again after 60 s');

        // A write invalidates at once.
        assert.equal((await setBirthYm({ userId: NO_AGE, birthYm: '2012-01', declaredBy: 'self', now: NOW })).ok, true);
        assert.equal((await resolveAiAccess(NO_AGE, { env: DEV, now: NOW })).status, 'needs_guardian_consent');

        // invalidateAiAccess (called by the code that records a blocked input).
        pool.events.push(...blockedEvents(ADULT, 10));
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: NOW })).status, 'paused');
        pool.events.length = 0;
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: NOW })).status, 'paused', 'still cached');
        invalidateAiAccess(ADULT);
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: NOW })).status, 'ready');

        // An entry made at 23:59:30 JST expires at 00:00 JST, not 60 s later.
        resetAiAccessForTests();
        const lateNight = new Date('2026-10-22T14:59:30.000Z');
        pool.events.push(...blockedEvents(ADULT, 10, lateNight));
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: lateNight })).status, 'paused');
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: new Date('2026-10-22T15:00:00.000Z') })).status, 'ready', 'the pause ends at midnight');
    });

    it('a read that started before a revoke never caches the old ready state', async () => {
        const pool = basePool({ consents: [{ user_id: MINOR }] });
        let hold = null;
        const query = pool.query.bind(pool);
        pool.query = async (sql, params) => {
            const result = await query(sql, params);
            // The consent SELECT has its answer (consent active), but finishes only after the revoke.
            if (hold && /select given_at/i.test(String(sql))) await hold;
            return result;
        };
        setPoolForTests(pool);
        let release;
        hold = new Promise((resolve) => { release = resolve; });
        const inFlight = resolveAiAccess(MINOR, { env: DEV, now: NOW });
        await new Promise((resolve) => setImmediate(resolve));
        hold = null;
        await revokeGuardianConsent({ userId: MINOR });
        release();
        assert.equal((await inFlight).status, 'ready', 'the in-flight read answers what it read');

        const reads = pool.accessQueries().length;
        assert.equal((await resolveAiAccess(MINOR, { env: DEV, now: NOW })).status, 'needs_guardian_consent', 'the old state was not cached');
        assert.ok(pool.accessQueries().length > reads, 'read again');
    });

    it('AI_ACCESS_DEV_AUDIENCE sets the audience outside production only', async () => {
        const pool = basePool();
        setPoolForTests(pool);
        const minor = await resolveAiAccess(NO_AGE, { env: { ...DEV, AI_ACCESS_DEV_AUDIENCE: 'minor' }, now: NOW });
        assert.equal(minor.status, 'ready');
        assert.equal(minor.audience, 'minor');
        assert.equal((await resolveAiAccess(NO_AGE, { env: { AI_ACCESS_DEV_AUDIENCE: 'adult' }, now: NOW })).audience, 'adult', 'NODE_ENV unset is not production');
        assert.equal(pool.queries.length, 0, 'no database read');
        assert.equal((await resolveAiAccess(NO_AGE, { env: { ...PROD, AI_ACCESS_DEV_AUDIENCE: 'adult' }, now: NOW })).status, 'needs_age', 'ignored in production');
        resetAiAccessForTests();
        assert.equal((await resolveAiAccess(NO_AGE, { env: { ...DEV, AI_ACCESS_DEV_AUDIENCE: 'child' }, now: NOW })).status, 'needs_age', 'unknown values are ignored');
    });

    it('without a database: adult outside production, unavailable in production', async () => {
        setPoolForTests(null);
        assert.equal((await resolveAiAccess(NO_AGE, { env: DEV, now: NOW })).audience, 'adult');
        await assert.rejects(resolveAiAccess(NO_AGE, { env: PROD, now: NOW }), AiAccessUnavailableError);
    });

    it('a failed query is unavailable (fail closed) and is not cached', async () => {
        let failing = true;
        const pool = basePool({ fail: (sql) => failing && sql.includes('user_age') });
        setPoolForTests(pool);
        await assert.rejects(resolveAiAccess(ADULT, { env: DEV, now: NOW }), (error) => error instanceof AiAccessUnavailableError && error.code === 'ai_access_unavailable');
        failing = false;
        assert.equal((await resolveAiAccess(ADULT, { env: DEV, now: NOW })).status, 'ready');
    });

    it('setBirthYm: once by the learner, any time by a guardian or staff', async () => {
        const pool = basePool();
        setPoolForTests(pool);
        assert.deepEqual(await setBirthYm({ userId: NO_AGE, birthYm: '2012-07', declaredBy: 'self', now: NOW }), { ok: true, birthYm: '2012-07' });
        assert.equal(pool.queries.at(-1).params[1], '2012-07-01', 'stored as the first of the month');
        assert.deepEqual(await setBirthYm({ userId: NO_AGE, birthYm: '1990-07', declaredBy: 'self', now: NOW }), { ok: false, error_type: 'age_already_set' });
        assert.equal(pool.ages[NO_AGE], '2012-07');
        assert.deepEqual(await setBirthYm({ userId: NO_AGE, birthYm: '2011-07', declaredBy: 'staff', now: NOW }), { ok: true, birthYm: '2011-07' });
        assert.equal(pool.ages[NO_AGE], '2011-07');
        assert.deepEqual(await setBirthYm({ userId: NO_AGE, birthYm: '2030-01', declaredBy: 'guardian', now: NOW }), { ok: false, error_type: 'invalid_birth_ym' });
        assert.deepEqual(await setBirthYm({ userId: NO_AGE, birthYm: '2011-07', declaredBy: 'teacher', now: NOW }), { ok: false, error_type: 'invalid_declared_by' });
    });

    it('recordGuardianConsent: validates the method, relationship and recorder', async () => {
        const pool = basePool();
        setPoolForTests(pool);
        const invalid = { ok: false, error_type: 'invalid_consent' };
        assert.deepEqual(await recordGuardianConsent({ userId: MINOR, method: 'email', relationship: 'parent' }), invalid);
        assert.deepEqual(await recordGuardianConsent({ userId: MINOR, method: 'guardian_on_device', relationship: 'aunt' }), invalid);
        assert.deepEqual(await recordGuardianConsent({ userId: MINOR, method: 'guardian_on_device' }), invalid, 'relationship required on the device');
        assert.deepEqual(await recordGuardianConsent({ userId: MINOR, method: 'staff_paper_form', relationship: 'parent' }), invalid, 'staff need recordedBy');
        const staff = await recordGuardianConsent({ userId: MINOR, method: 'staff_paper_form', relationship: 'guardian', recordedBy: ADMIN });
        assert.equal(staff.ok, true);
        assert.equal(staff.consent.method, 'staff_paper_form');
        assert.equal(pool.consents.at(-1).recorded_by, ADMIN);
    });

    it('tokyoDayBounds gives 00:00 JST to 00:00 JST', () => {
        assert.deepEqual(tokyoDayBounds(NOW.getTime()), {
            start: Date.parse('2026-10-21T15:00:00.000Z'),
            end: Date.parse('2026-10-22T15:00:00.000Z'),
        });
    });
});

/** A tiny app: sets req.userId from x-user, then the gate, then echoes res.locals.aiAudience. */
const withGate = async (options, handler) => {
    const app = express();
    app.use((req, _res, next) => {
        req.userId = req.headers['x-user'] || null;
        next();
    });
    app.post('/ai', aiAccessGate(options), (_req, res) => res.json({ audience: res.locals.aiAudience }));
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const call = async (user) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/ai`, {
            method: 'POST',
            headers: user ? { 'x-user': user } : {},
        });
        return { status: response.status, body: await response.json(), headers: response.headers };
    };
    try {
        await handler(call);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
};

describe('aiAccessGate', () => {
    const saved = {};
    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        resetAiAccessForTests();
    });
    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetPoolForTests();
        resetAiAccessForTests();
    });

    it('guests: 401 sign_in_required unless LLM_GUEST_AI is exactly "true" (then adults)', async () => {
        setPoolForTests(basePool());
        await withGate({}, async (call) => {
            assert.deepEqual((await call()).body.error_type, 'sign_in_required');
            assert.equal((await call()).status, 401);
            process.env.LLM_GUEST_AI = 'TRUE';
            assert.equal((await call()).status, 401, 'only the exact value');
            process.env.LLM_GUEST_AI = '1';
            assert.equal((await call()).status, 401);
            process.env.LLM_GUEST_AI = 'true';
            const guest = await call();
            assert.equal(guest.status, 200);
            assert.equal(guest.body.audience, 'adult');
        });
    });

    it('signed-in outcomes: ready adult, ready minor, age, consent, pause', async () => {
        const PAUSED = 'aaaaaaaa-0000-4000-8000-000000000004';
        setPoolForTests(basePool({
            ages: { [ADULT]: '1990-05', [MINOR]: '2013-04', [ADMIN]: '2012-01', [PAUSED]: '2014-02' },
            consents: [{ user_id: MINOR }, { user_id: PAUSED }],
            events: blockedEvents(PAUSED, 10, new Date()),
        }));
        await withGate({}, async (call) => {
            assert.deepEqual(await call(ADULT).then((r) => [r.status, r.body.audience]), [200, 'adult']);
            assert.deepEqual(await call(MINOR).then((r) => [r.status, r.body.audience]), [200, 'minor']);
            const noAge = await call(NO_AGE);
            assert.equal(noAge.status, 403);
            assert.equal(noAge.body.error_type, 'age_required');
            assert.ok(noAge.body.error);
            const noConsent = await call(ADMIN);
            assert.equal(noConsent.status, 403);
            assert.equal(noConsent.body.error_type, 'guardian_consent_required');
            const paused = await call(PAUSED);
            assert.equal(paused.status, 403);
            assert.equal(paused.body.error_type, 'ai_paused_safety');
            assert.match(paused.body.paused_until, /T15:00:00\.000Z$/, 'next 00:00 JST');
        });
    });

    it('adultsOnly: a minor is refused even with consent; no age still asks for the age', async () => {
        setPoolForTests(basePool({ consents: [{ user_id: MINOR }] }));
        await withGate({ adultsOnly: true }, async (call) => {
            assert.equal((await call(ADULT)).status, 200);
            const minor = await call(MINOR);
            assert.equal(minor.status, 403);
            assert.equal(minor.body.error_type, 'adults_only');
            assert.equal((await call(NO_AGE)).body.error_type, 'age_required');
        });
    });

    it('fails closed with 503 ai_access_unavailable: production without a database, or a failed lookup', async () => {
        process.env.NODE_ENV = 'production';
        setPoolForTests(null);
        await withGate({}, async (call) => {
            const response = await call(ADULT);
            assert.equal(response.status, 503);
            assert.equal(response.body.error_type, 'ai_access_unavailable');
            assert.equal(response.headers.get('retry-after'), '60');
        });
        setPoolForTests(basePool({ fail: () => true }));
        await withGate({}, async (call) => {
            assert.equal((await call(ADULT)).body.error_type, 'ai_access_unavailable');
        });
    });

    it('development: no database means adult; AI_ACCESS_DEV_AUDIENCE overrides; production ignores it', async () => {
        setPoolForTests(null);
        await withGate({}, async (call) => {
            assert.equal((await call(NO_AGE)).body.audience, 'adult');
            process.env.AI_ACCESS_DEV_AUDIENCE = 'minor';
            assert.equal((await call(NO_AGE)).body.audience, 'minor');
            process.env.NODE_ENV = 'production';
            setPoolForTests(basePool());
            assert.equal((await call(NO_AGE)).body.error_type, 'age_required', 'no bypass in production');
        });
    });
});

describe('aiAccessStartupWarnings', () => {
    it('warns about AI_ACCESS_DEV_AUDIENCE and LLM_GUEST_AI=true in production only', () => {
        assert.deepEqual(aiAccessStartupWarnings({ NODE_ENV: 'development', AI_ACCESS_DEV_AUDIENCE: 'adult', LLM_GUEST_AI: 'true' }), []);
        assert.deepEqual(aiAccessStartupWarnings({ NODE_ENV: 'production' }), []);
        const warnings = aiAccessStartupWarnings({ NODE_ENV: 'production', AI_ACCESS_DEV_AUDIENCE: 'adult', LLM_GUEST_AI: 'true' });
        assert.equal(warnings.length, 2);
        assert.match(warnings[0], /AI_ACCESS_DEV_AUDIENCE/);
        assert.match(warnings[1], /LLM_GUEST_AI/);
    });
});

describe('requireAdmin', () => {
    afterEach(() => resetPoolForTests());

    const withAdminApp = async (handler) => {
        const app = express();
        app.use((req, _res, next) => {
            req.userId = req.headers['x-user'] || null;
            next();
        });
        app.get('/admin', requireAdmin, (_req, res) => res.json({ ok: true }));
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const call = async (user) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/admin`, { headers: user ? { 'x-user': user } : {} });
            return { status: response.status, body: await response.json() };
        };
        try {
            await handler(call);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    it('reads the role on the server: admin passes, others get 403 admin_only', async () => {
        const pool = createAiAccessPool({ roles: { [ADMIN]: 'admin', [ADULT]: 'learner' } });
        setPoolForTests(pool);
        await withAdminApp(async (call) => {
            assert.equal((await call(ADMIN)).status, 200);
            const learner = await call(ADULT);
            assert.equal(learner.status, 403);
            assert.equal(learner.body.error_type, 'admin_only');
            assert.equal((await call(NO_AGE)).body.error_type, 'admin_only', 'no profile row');
            assert.equal((await call()).status, 401);
            pool.roles[ADMIN] = 'learner';
            assert.equal((await call(ADMIN)).status, 403, 'a removed role stops at once (no cache)');
        });
    });

    it('fails closed: no database is 403, a failed lookup 503', async () => {
        setPoolForTests(null);
        await withAdminApp(async (call) => {
            assert.equal((await call(ADMIN)).body.error_type, 'admin_only');
        });
        setPoolForTests(createAiAccessPool({ fail: () => true }));
        await withAdminApp(async (call) => {
            const response = await call(ADMIN);
            assert.equal(response.status, 503);
            assert.equal(response.body.error_type, 'admin_check_unavailable');
        });
    });
});
