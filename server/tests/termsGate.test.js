// @ts-check
// The terms check on the app API (Phase 8, S5; server/middleware/termsGate.js, rules in
// tools/core/legalAcceptance.js): the switch (LEGAL_TERMS_REQUIRED, off by default, ignored in
// production while the texts are drafts, logged only when set), who is gated (a real learner's
// Supabase session only), the TERMS_EXEMPT list (method + exact path), the 403/503 bodies, the
// per-learner cache with its generations (an acceptance invalidates; a read that started before it
// stores nothing), and the whole server.js stack: one gated route per kind of auth (requireAuth
// mounts, billing's per-route requireAuth, optionalAuth, per-route, router-level and mount-level
// requireBridgeOrAuth, the catch-all), the exempt routes, an acceptance that lets the next call
// through at once, and the switch off (today's behaviour: no refusal, no acceptance read).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server.js';
import { PHASE1_USER_ID, resetPoolForTests, setPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { readEnvSwitch } from '../utils/envSwitch.js';
import { readDeletionSwitch } from '../routes/account.js';
import {
    TERMS_EXEMPT,
    createTermsGate,
    invalidateTermsAcceptance,
    isRealLearner,
    legalStartupWarnings,
    termsExempt,
} from '../middleware/termsGate.js';
import {
    LATEST_ACCEPTANCE_SQL,
    TERMS_SWITCH,
    createAcceptanceCache,
    termsAccepted,
    termsEnforcement,
    termsSwitchLine,
} from '../../tools/core/legalAcceptance.js';
import { LEGAL_DOCUMENTS, currentLegalVersions } from '../../shared/legal/versions.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { LEGAL_POOL_SQL, createLegalPool } from './helpers/legalPool.js';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const B = 'bcdef012-3456-4789-8bcd-ef0123456789';
const ANON = 'cdef0123-4567-489a-9bcd-ef0123456789';
const ID = '11111111-2222-4000-8000-000000000001';
const CURRENT = currentLegalVersions();
const RELEASED = Object.freeze({
    terms: { ...LEGAL_DOCUMENTS.terms, version: 'terms-2026-12-01' },
    privacy: { ...LEGAL_DOCUMENTS.privacy, version: 'privacy-2026-12-01' },
});
const ON = Object.freeze({ [TERMS_SWITCH]: 'true', NODE_ENV: 'test' });

// ---------------------------------------------------------------------------------------------
// The switch and the startup lines

describe('LEGAL_TERMS_REQUIRED: the switch', () => {
    it('readEnvSwitch: on only for true/1/on/yes (trimmed, any case); the deletion switch is the same parser', () => {
        for (const raw of ['true', 'TRUE', ' yes ', '1', 'On']) assert.deepEqual(readEnvSwitch(raw), { on: true, recognised: true }, raw);
        for (const raw of [undefined, '', '  ', 'false', 'OFF', '0', 'no']) assert.deepEqual(readEnvSwitch(raw), { on: false, recognised: true }, String(raw));
        for (const raw of ['nope', 'ture', 'enabled']) assert.deepEqual(readEnvSwitch(raw), { on: false, recognised: false }, raw);
        assert.equal(readDeletionSwitch, readEnvSwitch, 'account.js keeps readDeletionSwitch as the shared parser');
    });

    it('termsEnforcement: off unless on; production ignores it while a current version is a draft', () => {
        assert.deepEqual(termsEnforcement({}), { on: false, reason: 'off' });
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: '' }), { on: false, reason: 'off' });
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'false' }), { on: false, reason: 'off' });
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'nope' }), { on: false, reason: 'unrecognised' });
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'TRUE' }), { on: true, reason: 'on' }, 'outside production, drafts are allowed (dev, tests)');
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: ' yes ', NODE_ENV: 'development' }), { on: true, reason: 'on' });
        assert.ok(LEGAL_DOCUMENTS.terms.version.includes('-draft-'), 'the current texts are drafts');
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }), { on: false, reason: 'draft_in_production' });
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }, { documents: RELEASED }), { on: true, reason: 'on' });
        const oneDraft = { terms: RELEASED.terms, privacy: LEGAL_DOCUMENTS.privacy };
        assert.deepEqual(termsEnforcement({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }, { documents: oneDraft }), { on: false, reason: 'draft_in_production' }, 'either draft');
    });

    it('startup lines: nothing while unset or off (logs included); one line when set', () => {
        for (const value of [undefined, '', 'false', 'off', 'no', '0', ' OFF ']) {
            const env = value === undefined ? { NODE_ENV: 'production' } : { NODE_ENV: 'production', [TERMS_SWITCH]: value };
            assert.deepEqual(legalStartupWarnings(env), [], `api: ${String(value)}`);
            assert.equal(termsSwitchLine(env, { label: '[MCP remote]' }), null, `remote: ${String(value)}`);
        }
        const unrecognised = legalStartupWarnings({ [TERMS_SWITCH]: 'nope' });
        assert.deepEqual(unrecognised, ["[Legal] terms check: off: LEGAL_TERMS_REQUIRED has an unrecognised value (use 'true' or 'false')"]);
        assert.doesNotMatch(unrecognised[0], /nope/, 'the value is not logged');
        const drafts = legalStartupWarnings({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' });
        assert.equal(drafts.length, 1);
        assert.match(drafts[0], /^\[Legal\] terms check: ignored: LEGAL_TERMS_REQUIRED is on, but the current terms are drafts and POST \/api\/v2\/user\/legal\/acceptance answers 409 legal_not_published in production/);
        assert.match(legalStartupWarnings({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }, { documents: RELEASED })[0], /^\[Legal\] terms check: required \(LEGAL_TERMS_REQUIRED\)/);
        assert.match(termsSwitchLine({ [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }, { label: '[MCP remote]' }) ?? '', /^\[MCP remote\] terms check: ignored: /);
        assert.match(termsSwitchLine({ [TERMS_SWITCH]: '1' }, { label: '[MCP remote]' }) ?? '', /^\[MCP remote\] terms check: required /);
    });
});

// ---------------------------------------------------------------------------------------------
// Who is gated and what is exempt

/** @param {Record<string, unknown>} [over] */
const learnerReq = (over = {}) => /** @type {any} */ ({
    method: 'GET', originalUrl: '/api/v2/user/achievements', userId: A, authMethod: 'supabase-jwt', isAnonymous: false, accountGeneration: null, ...over,
});

/**
 * What the task exempts (withdrawal of guardian AI consent, privacy deletes, connected apps, plan
 * cancel/portal, account deletion, legal read/accept, health) and the design adds (D-B own lesson
 * records and the sign-out flush, D-C profile, D-D safety reports), written out here on their own:
 * dropping one from TERMS_EXEMPT fails a named row.
 */
const REQUIRED_EXEMPT = [
    ['GET', '/api/v2/tts/health', 'health'],
    ['GET', '/api/v2/agent/health', 'health'],
    ['GET', '/api/v2/llm/status', 'status'],
    ['GET', '/api/v2/user/legal', 'legal read'],
    ['POST', '/api/v2/user/legal/acceptance', 'legal accept'],
    ['GET', '/api/v2/user/account/deletion', 'account deletion'],
    ['POST', '/api/v2/user/account/deletion', 'account deletion'],
    ['GET', '/api/v2/user/ai-access', 'the page that offers the withdrawal'],
    ['POST', '/api/v2/user/ai-access/guardian-consent/revoke', 'withdrawal of guardian AI consent'],
    ['GET', '/api/v2/user/connected-apps', 'connected apps'],
    ['POST', `/api/v2/user/connected-apps/${ID}/revoke`, 'connected apps'],
    ['GET', '/api/v2/billing/me', 'plan'],
    ['POST', '/api/v2/billing/portal', 'plan cancel (portal)'],
    ['POST', '/api/v2/billing/sync', 'plan'],
    ['GET', '/api/v2/user/lesson-progress', 'own records (D-B)'],
    ['PUT', '/api/v2/user/lesson-progress', 'own records and the sign-out flush (D-B)'],
    ['DELETE', '/api/v2/user/lesson-progress', 'privacy delete'],
    ['GET', '/api/v2/user/profile', 'app shell (D-C)'],
    ['PUT', '/api/v2/user/profile', 'display name, journal privacy switch (D-C)'],
    ['GET', '/api/v2/life-journal/privacy', 'privacy'],
    ['GET', '/api/v2/life-journal/export', 'privacy export'],
    ['DELETE', '/api/v2/life-journal/data', 'privacy delete'],
    ['GET', '/api/v2/learner-memory/privacy', 'privacy'],
    ['PUT', '/api/v2/learner-memory/privacy', 'privacy'],
    ['GET', '/api/v2/learner-memory', 'privacy'],
    ['DELETE', '/api/v2/learner-memory', 'privacy delete'],
    ['DELETE', `/api/v2/learner-memory/${ID}`, 'privacy delete'],
    ['POST', '/api/v2/safety/reports', 'safety (D-D)'],
];

describe('isRealLearner and TERMS_EXEMPT', () => {
    it('the exemptions the task and the design require, each named (and nothing else: a new entry is a deliberate change here)', () => {
        for (const [method, url, why] of REQUIRED_EXEMPT) assert.equal(termsExempt(method, url), true, `${method} ${url} (${why})`);
        assert.deepEqual(
            TERMS_EXEMPT.map((e) => `${e.method} ${e.path}`),
            REQUIRED_EXEMPT.map(([method, url]) => `${method} ${url.replace(ID, ':id')}`),
        );
    });

    it('isRealLearner: only a Supabase session of a real account (requireSignedIn uses the same rule)', () => {
        assert.equal(isRealLearner(learnerReq()), true);
        assert.equal(isRealLearner(learnerReq({ userId: A.toUpperCase() })), true);
        assert.equal(isRealLearner(learnerReq({ isAnonymous: undefined })), true, 'optionalAuth and the bridge never set it');
        for (const over of [
            { authMethod: 'dev-fallback' }, { authMethod: 'no-supabase-fallback' }, { authMethod: 'bridge-token' }, { authMethod: 'bridge-bearer' },
            { authMethod: 'anonymous', userId: null }, { isAnonymous: true }, { userId: PHASE1_USER_ID }, { userId: 'not-a-uuid' }, { userId: null },
        ]) assert.equal(isRealLearner(learnerReq(over)), false, JSON.stringify(over));
    });

    it('every TERMS_EXEMPT entry is exempt for its method only (HEAD counts as GET; query, case and a trailing slash do not matter)', () => {
        assert.ok(TERMS_EXEMPT.length >= 25);
        for (const { method, path } of TERMS_EXEMPT) {
            const url = path.replace(':id', ID);
            assert.equal(termsExempt(method, url), true, `${method} ${url}`);
            assert.equal(termsExempt(method.toLowerCase(), `${url.toUpperCase()}/?x=1&y=/z`), true, `${method} ${url} (case, slash, query)`);
            if (method === 'GET') assert.equal(termsExempt('HEAD', url), true, `HEAD ${url}`);
            for (const other of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
                // Another entry may name the same URL (DELETE /learner-memory/:id also matches /privacy).
                if (TERMS_EXEMPT.some((e) => e.method === other && new RegExp(`^${e.path.replace(':id', '[^/]+')}$`).test(url))) continue;
                assert.equal(termsExempt(other, url), false, `${other} ${url} is gated`);
            }
        }
    });

    it('gated: the writes the task does not exempt, near misses, and paths that only start with an exempt one', () => {
        for (const [method, url] of [
            ['PUT', '/api/v2/user/ai-access/age'],
            ['POST', '/api/v2/user/ai-access/guardian-consent'],
            ['POST', '/api/v2/user/lesson-progress/lesson-reset'],
            ['POST', '/api/v2/billing/checkout'],
            ['GET', '/api/v2/user/achievements'],
            ['GET', '/api/v2/user/review'],
            ['POST', '/api/v2/user/legal'],
            ['GET', '/api/v2/user/legal/../achievements'],
            ['GET', '/api/v2/user/legalx'],
            ['GET', '/api/v2/user/legal/acceptance'],
            ['POST', `/api/v2/user/connected-apps/${ID}/revoke/x`],
            ['POST', '/api/v2/user/connected-apps//revoke'],
            ['DELETE', `/api/v2/learner-memory/${ID}/x`],
            ['POST', '/api/v2/learner-memory'],
            ['GET', '/api/v2/life-journal/range'],
            ['GET', '//api/v2/user/legal'],
            ['GET', '/api/v2/user/legal%2F'],
            ['GET', '/api/v2/health/../user/achievements'],
        ]) assert.equal(termsExempt(method, url), false, `${method} ${url}`);
    });
});

// ---------------------------------------------------------------------------------------------
// The gate on its own

const fakeRes = () => {
    const res = {
        statusCode: 200,
        /** @type {any} */ body: undefined,
        /** @type {Record<string, string>} */ headers: {},
        /** @param {number} code */ status(code) { res.statusCode = code; return res; },
        /** @param {unknown} body */ json(body) { res.body = body; return res; },
        /** @param {string} k @param {string} v */ set(k, v) { res.headers[k] = v; return res; },
    };
    return res;
};

/**
 * A fake acceptance reader: `accepted` lists the users whose newest live acceptance counts.
 * hold() makes the next reads wait until release(answer) (a read in flight).
 */
function fakeReader() {
    const accepted = new Set();
    /** @type {{ sql: string, params: unknown[] }[]} */
    const calls = [];
    /** @type {null | { wait: Promise<void>, release: () => void }} */
    let held = null;
    let fail = null;
    const reader = {
        accepted,
        calls,
        /** @param {any} error */
        failWith(error) { fail = error; },
        hold() {
            /** @type {() => void} */
            let release = () => {};
            const wait = new Promise((resolve) => { release = () => resolve(undefined); });
            held = { wait, release };
            return () => { held = null; release(); };
        },
        /** @param {string} sql @param {unknown[]} params */
        async query(sql, params) {
            calls.push({ sql, params });
            const h = held;
            const snapshot = new Set(accepted);
            if (h) await h.wait;
            if (fail) throw fail;
            const id = String(params[0]);
            return { rows: snapshot.has(id) ? [{ terms_version: CURRENT.terms, privacy_version: CURRENT.privacy, accepted_at: new Date() }] : [] };
        },
    };
    return reader;
}

/** @param {ReturnType<typeof createTermsGate>} gate @param {any} req */
async function step(gate, req) {
    const res = fakeRes();
    let next = 0;
    const out = gate.step(req, /** @type {any} */ (res), () => { next += 1; });
    const sync = next;
    await out;
    return { res, next, sync };
}

describe('createTermsGate (injected reader and clock)', () => {
    /** @type {ReturnType<typeof fakeReader>} */
    let reader;
    let t = 1_000_000;
    const now = () => t;
    const warnings = [];
    const logger = { warn: (/** @type {string} */ line) => warnings.push(line) };
    /** @param {Record<string, string | undefined>} [env] @param {Record<string, unknown>} [extra] */
    const gateWith = (env = ON, extra = {}) => createTermsGate({ env, query: reader.query, now, logger, ...extra });

    beforeEach(() => {
        reader = fakeReader();
        t = 1_000_000;
        warnings.length = 0;
    });

    it('a learner who has not accepted: 403 terms_required with the current versions, next() never called', async () => {
        const { res, next } = await step(gateWith(), learnerReq());
        assert.equal(next, 0);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { error: 'Accept the current terms of use to continue.', error_type: 'terms_required', current: { terms: CURRENT.terms, privacy: CURRENT.privacy } });
        assert.deepEqual(reader.calls, [{ sql: LATEST_ACCEPTANCE_SQL, params: [A] }]);
    });

    it('the versions in the body are the gate\'s documents (a release names its own)', async () => {
        const { res } = await step(gateWith({ ...ON, NODE_ENV: 'production' }, { documents: RELEASED }), learnerReq());
        assert.deepEqual(res.body.current, { terms: 'terms-2026-12-01', privacy: 'privacy-2026-12-01' });
    });

    it('accepted: next(); an upper-case id reads the canonical one', async () => {
        reader.accepted.add(A);
        const { res, next } = await step(gateWith(), learnerReq({ userId: A.toUpperCase() }));
        assert.equal(next, 1);
        assert.equal(res.body, undefined);
        assert.deepEqual(reader.calls.map((c) => c.params), [[A]]);
    });

    it('guests, the dev fallbacks, the bridge, an anonymous user and PHASE1: next() at once, no read', async () => {
        const gate = gateWith();
        for (const over of [
            { authMethod: 'anonymous', userId: null }, { authMethod: 'dev-fallback', userId: PHASE1_USER_ID }, { authMethod: 'no-supabase-fallback', userId: PHASE1_USER_ID },
            { authMethod: 'bridge-token', userId: PHASE1_USER_ID }, { authMethod: 'bridge-bearer', userId: PHASE1_USER_ID }, { isAnonymous: true }, { userId: PHASE1_USER_ID },
        ]) {
            const { sync, next } = await step(gate, learnerReq(over));
            assert.deepEqual([sync, next], [1, 1], JSON.stringify(over));
        }
        assert.equal(reader.calls.length, 0);
    });

    it('every exempt route (PUT /user/lesson-progress included): next() at once, no read; the same path with another method is refused', async () => {
        const gate = gateWith();
        for (const { method, path } of TERMS_EXEMPT) {
            const { sync } = await step(gate, learnerReq({ method, originalUrl: path.replace(':id', ID) }));
            assert.equal(sync, 1, `${method} ${path}`);
        }
        const { sync } = await step(gate, learnerReq({ method: 'PUT', originalUrl: '/api/v2/user/lesson-progress?x=1' }));
        assert.equal(sync, 1, 'the upload and the save before sign-out (D-B)');
        assert.equal(reader.calls.length, 0);
        for (const [method, originalUrl] of [
            ['PUT', '/api/v2/user/ai-access/age'], ['POST', '/api/v2/user/ai-access/guardian-consent'],
            ['POST', '/api/v2/user/lesson-progress/lesson-reset'], ['POST', '/api/v2/billing/checkout'],
            ['GET', '/api/v2/user/legal/../achievements'],
        ]) {
            const { res, next } = await step(gate, learnerReq({ method, originalUrl }));
            assert.deepEqual([res.statusCode, res.body?.error_type, next], [403, 'terms_required', 0], `${method} ${originalUrl}`);
        }
    });

    it('switch off (unset, false, unrecognised, production with drafts): next() at once and no read, for everyone', async () => {
        for (const env of [{}, { [TERMS_SWITCH]: 'false' }, { [TERMS_SWITCH]: 'nope' }, { [TERMS_SWITCH]: 'true', NODE_ENV: 'production' }]) {
            const { sync, res } = await step(gateWith(env), learnerReq());
            assert.equal(sync, 1, JSON.stringify(env));
            assert.equal(res.statusCode, 200);
        }
        assert.equal(reader.calls.length, 0);
    });

    it('env is read on every request (process.env can change under the app)', async () => {
        const env = /** @type {Record<string, string | undefined>} */ ({ NODE_ENV: 'test' });
        const gate = gateWith(env);
        assert.equal((await step(gate, learnerReq())).sync, 1);
        env[TERMS_SWITCH] = 'true';
        assert.equal((await step(gate, learnerReq())).res.statusCode, 403);
    });

    it('a read that fails: 503 legal_unavailable with Retry-After 60 (fail closed), logged at most once a minute, never cached', async () => {
        const gate = gateWith();
        reader.failWith(Object.assign(new Error('permission denied for table legal_acceptances'), { code: '42501' }));
        const first = await step(gate, learnerReq());
        assert.equal(first.next, 0);
        assert.equal(first.res.statusCode, 503);
        assert.deepEqual(first.res.body, { error: 'The terms cannot be checked right now. Please try again later.', error_type: 'legal_unavailable' });
        assert.equal(first.res.headers['Retry-After'], '60');
        await step(gate, learnerReq());
        assert.deepEqual(warnings, ['[Legal] terms check unavailable (42501); signed-in calls answer 503 legal_unavailable']);
        t += 60_000;
        await step(gate, learnerReq());
        assert.equal(warnings.length, 2);
        assert.equal(reader.calls.length, 3, 'an error is never kept');
    });

    it('cache: one read for two calls; "not accepted" read again after 5 s, "accepted" kept 60 s', async () => {
        const gate = gateWith();
        await step(gate, learnerReq());
        await step(gate, learnerReq());
        assert.equal(reader.calls.length, 1);
        reader.accepted.add(A);
        t += 4_999;
        assert.equal((await step(gate, learnerReq())).res.statusCode, 403, 'still the kept answer');
        t += 1;
        assert.equal((await step(gate, learnerReq())).next, 1, 'read again after 5 s');
        assert.equal(reader.calls.length, 2);
        reader.accepted.delete(A);
        t += 59_999;
        assert.equal((await step(gate, learnerReq())).next, 1, 'accepted kept 60 s');
        t += 1;
        assert.equal((await step(gate, learnerReq())).res.statusCode, 403, 'read again after 60 s');
        assert.equal(reader.calls.length, 3);
    });

    it('cache: calls in flight share one read', async () => {
        const gate = gateWith();
        const release = reader.hold();
        const all = Promise.all([step(gate, learnerReq()), step(gate, learnerReq()), step(gate, learnerReq())]);
        await Promise.resolve();
        release();
        const results = await all;
        assert.deepEqual(results.map((r) => r.res.statusCode), [403, 403, 403]);
        assert.equal(reader.calls.length, 1);
    });

    it('cache: invalidate(userId) makes the next call read again (an acceptance this process recorded)', async () => {
        const gate = gateWith();
        await step(gate, learnerReq());
        reader.accepted.add(A);
        gate.invalidate(A.toUpperCase());
        assert.equal((await step(gate, learnerReq())).next, 1);
        assert.equal(reader.calls.length, 2);
        gate.invalidate('not-a-uuid');
        gate.invalidate(null);
    });

    it('cache generations: a read that started before invalidate() answers its own call but stores nothing; a later call never joins it', async () => {
        const gate = gateWith();
        const release = reader.hold();
        const early = step(gate, learnerReq()); // started before the acceptance: reads "not accepted"
        await Promise.resolve();
        reader.accepted.add(A);
        gate.invalidate(A); // the acceptance committed: a new generation
        const between = step(gate, learnerReq()); // arrives before the old read answers
        assert.equal(reader.calls.length, 2, 'the call after invalidate() started its own read');
        release();
        const [old, fresh] = await Promise.all([early, between]);
        assert.equal(old.res.statusCode, 403, 'the old read answers its own request');
        assert.equal(fresh.next, 1, 'the new read sees the acceptance');
        const again = await step(gate, learnerReq());
        assert.equal(again.next, 1, 'and the old "not accepted" was never stored');
        assert.equal(reader.calls.length, 2, 'the new answer is kept');
    });

    it('cache generations: invalidate() while the only read is in flight → the next call reads again and passes', async () => {
        const gate = gateWith();
        const release = reader.hold();
        const early = step(gate, learnerReq());
        await Promise.resolve();
        gate.invalidate(A);
        reader.accepted.add(A);
        release();
        assert.equal((await early).res.statusCode, 403);
        const next = await step(gate, learnerReq());
        assert.equal(next.next, 1);
        assert.equal(reader.calls.length, 2);
    });

    it('cache keys: another account generation (a re-opened account) and another learner are their own keys', async () => {
        const gate = gateWith();
        reader.accepted.add(A);
        assert.equal((await step(gate, learnerReq({ accountGeneration: null }))).next, 1);
        reader.accepted.delete(A);
        assert.equal((await step(gate, learnerReq({ accountGeneration: 1_790_000_000 }))).res.statusCode, 403, 're-opened: never the old answer');
        assert.equal((await step(gate, learnerReq({ userId: B }))).res.statusCode, 403);
        assert.equal(reader.calls.length, 3);
        gate.invalidate(A);
        await step(gate, learnerReq({ accountGeneration: null }));
        await step(gate, learnerReq({ accountGeneration: 1_790_000_000 }));
        assert.equal(reader.calls.length, 5, 'invalidate drops every generation of that learner');
        await step(gate, learnerReq({ userId: B }));
        assert.equal(reader.calls.length, 5, 'and only theirs');
    });
});

describe('createAcceptanceCache and termsAccepted', () => {
    it('keeps at most `max` answers (the oldest goes)', async () => {
        const cache = createAcceptanceCache({ max: 2, now: () => 0 });
        let reads = 0;
        const read = async () => { reads += 1; return true; };
        await cache.get('a', '', read);
        await cache.get('b', '', read);
        await cache.get('c', '', read);
        assert.equal(cache.size, 2);
        await cache.get('a', '', read);
        assert.equal(reads, 4, 'a was dropped');
        await cache.get('c', '', read);
        assert.equal(reads, 4);
    });

    it('a read that throws at once leaves no read in flight', async () => {
        const cache = createAcceptanceCache();
        const throwing = () => { throw new Error('sync'); };
        await assert.rejects(cache.get('a', '', /** @type {any} */ (throwing)), /sync/);
        assert.equal(await cache.get('a', '', async () => true), true);
    });

    it('termsAccepted: the newest live acceptance counts when its versions are acceptable', async () => {
        /** @param {any[]} rows */
        const q = (rows) => async () => ({ rows });
        assert.equal(await termsAccepted(A, { query: q([]) }), false, 'no acceptance');
        assert.equal(await termsAccepted(A, { query: q([{ terms_version: CURRENT.terms, privacy_version: 'privacy-draft-2026-10-22.2' }]) }), true, 'any privacy version');
        assert.equal(await termsAccepted(A, { query: q([{ terms_version: 'terms-draft-2026-10-01', privacy_version: CURRENT.privacy }]) }), false, 'an older terms version');
        assert.equal(await termsAccepted(A, { query: q([{ terms_version: 'x', privacy_version: 'y' }]), acceptable: () => null }), true, 'null = any');
        await assert.rejects(termsAccepted(A, { query: async () => { throw new Error('down'); } }), /down/);
    });
});

// ---------------------------------------------------------------------------------------------
// The server.js stack

const nowS = () => Math.floor(Date.now() / 1000);
/** @param {unknown} value */
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A Supabase session token (unsigned: the stand-in below does not check signatures). @param {string} sub */
const token = (sub) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({
    sub, aud: 'authenticated', role: 'authenticated', iat: nowS(), exp: 4_000_000_000, amr: [{ method: 'password', timestamp: nowS() - 3600 }],
})}.c2ln`;
/** @param {string} sub */
const auth = (sub) => ({ Authorization: `Bearer ${token(sub)}` });
const supabase = {
    auth: {
        getUser: async (/** @type {string} */ t) => {
            const id = decodeTokenClaims(t)?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: id === ANON } }, error: null };
        },
    },
};
const BRIDGE = 'test-bridge-token-for-terms-gate';
const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET',
    'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'LEGAL_TERMS_REQUIRED', 'LLM_GUEST_AI', 'AI_ACCESS_DEV_AUDIENCE', 'VITE_FEATURE_AGENT_CHAT',
    'KOKORO_TTS_URL', 'MEMANTO_ENABLED'];

/**
 * One request to the stack. A request that gets no answer (a network error, or no answer within
 * 10 s: a middleware that never calls next) throws, so a check that a call was not refused for the
 * terms always means the stack answered (self-review, finding 5).
 * @param {string} base @param {string} method @param {string} path
 * @param {{ headers?: Record<string, string>, body?: unknown }} [options]
 */
async function call(base, method, path, { headers = {}, body } = {}) {
    /** @type {RequestInit} */
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(10_000) };
    if (body !== undefined) {
        init.headers = { ...headers, 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    /** @type {Response} */
    let response;
    try {
        response = await fetch(`${base}${path}`, init);
    } catch (error) {
        throw new Error(`${method} ${path}: no answer from the stack`, { cause: error });
    }
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, headers: response.headers };
}

/** @param {(base: string) => Promise<void>} handler */
async function withServer(handler) {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${/** @type {any} */ (server).address().port}`);
    } finally {
        await new Promise((resolve, reject) => /** @type {any} */ (server).close((/** @type {any} */ error) => (error ? reject(error) : resolve(undefined))));
    }
}

const VALID_PUT = { epoch: null, records: [{ courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', progress: { v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: '2026-10-20T00:00:00.000Z' } }] };

/** One gated route per kind of auth (the row names the middleware a missing step would let through). */
const GATED = [
    ['requireAuth mount (+ requireSignedIn)', 'GET', '/api/v2/user/achievements'],
    ['requireAuth mount (+ requireSignedIn)', 'GET', '/api/v2/user/review'],
    ['requireAuth mount (+ requireSignedIn)', 'POST', '/api/v2/user/review/grade', { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1', cardId: 'c1', rating: 'good' }],
    ['requireAuth mount', 'POST', '/api/v2/user/events', { events: [] }],
    ['requireAuth mount', 'POST', '/api/v2/user/lesson-progress/lesson-reset', { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1' }],
    ['requireAuth mount', 'GET', '/api/v2/user/notifications'],
    ['requireAuth mount (D-A)', 'PUT', '/api/v2/user/ai-access/age', { birthYearMonth: '1990-01' }],
    ['requireAuth mount (D-A)', 'POST', '/api/v2/user/ai-access/guardian-consent', { relationship: 'parent' }],
    ['requireAuth mount (D-E)', 'GET', '/api/v2/admin/safety/reports'],
    ['requireAuth mount (AI)', 'POST', '/api/v2/ai/generate', { topic: 'x' }],
    ['requireAuth mount (AI)', 'POST', '/api/v2/image', { prompt: 'x' }],
    ['billing per-route requireAuth', 'POST', '/api/v2/billing/checkout', {}],
    ['optionalAuth', 'POST', '/api/v2/llm/tutor', { question: 'x' }],
    ['requireBridgeOrAuth per route', 'GET', '/api/v2/life-journal/range?from=2026-10-01&to=2026-10-02'],
    ['requireBridgeOrAuth router-level', 'POST', '/api/v2/learner-memory', { content: 'x' }],
    ['requireBridgeOrAuth mount', 'POST', '/api/v2/agent/chat', { message: 'x' }],
    ['requireAuth catch-all', 'GET', '/api/v2/curricula'],
    ['requireAuth catch-all', 'POST', '/api/v2/tts/synthesize', { text: 'x' }],
    ['requireAuth catch-all (fail closed)', 'GET', '/api/v2/no-such-route-yet'],
];

describe('the terms check on the server.js stack', () => {
    /** @type {Record<string, string | undefined>} */
    const saved = {};
    /** @type {ReturnType<typeof createLegalPool>} */
    let pool;
    const quiet = { log: console.log, warn: console.warn, error: console.error };
    const latestReads = () => pool.queries.filter((q) => q.sql === LEGAL_POOL_SQL.latest).length;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        process.env.LEGAL_TERMS_REQUIRED = 'true';
        process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE;
        process.env.KOKORO_TTS_URL = 'http://127.0.0.1:9';
        pool = createLegalPool({ stubs: [A, B, ANON] });
        setPoolForTests(pool);
        setSupabaseForTests(supabase);
        // The app's gate is one per process: start every test from nothing.
        for (const id of [A, B, ANON]) invalidateTermsAcceptance(id);
        console.log = () => {};
        console.warn = () => {};
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

    it('one gated route per kind of auth: 403 terms_required for a learner who has not accepted', async () => {
        await withServer(async (base) => {
            for (const [kind, method, path, body] of GATED) {
                const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (path), { headers: auth(A), body });
                assert.deepEqual([res.status, res.json?.error_type], [403, 'terms_required'], `${kind}: ${method} ${path}`);
                assert.deepEqual(res.json?.current, { terms: CURRENT.terms, privacy: CURRENT.privacy });
            }
        });
        assert.equal(latestReads(), 1, 'one acceptance read, then the kept answer');
    });

    it('the exempt routes never answer terms_required (any other status is fine) and read no acceptance', async () => {
        await withServer(async (base) => {
            for (const [method, url] of REQUIRED_EXEMPT) {
                const body = method === 'GET' || method === 'DELETE' ? undefined : (url.endsWith('/lesson-progress') ? VALID_PUT : {});
                const res = await call(base, method, url, { headers: auth(A), body });
                assert.notEqual(res.json?.error_type, 'terms_required', `${method} ${url}: ${res.status}`);
            }
        });
        assert.equal(latestReads(), 1, 'only GET /user/legal itself read the acceptance');
    });

    it('PUT /user/lesson-progress (the upload and the save before sign-out) is never refused for the terms', async () => {
        await withServer(async (base) => {
            const res = await call(base, 'PUT', '/api/v2/user/lesson-progress', { headers: auth(A), body: VALID_PUT });
            assert.notEqual(res.status, 403);
            assert.notEqual(res.json?.error_type, 'terms_required');
        });
    });

    it('after POST /user/legal/acceptance (201) the same gated call passes at once (this process\'s acceptance invalidates)', async () => {
        await withServer(async (base) => {
            const before = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(B) });
            assert.equal(before.json?.error_type, 'terms_required');
            const accepted = await call(base, 'POST', '/api/v2/user/legal/acceptance', { headers: auth(B), body: { termsVersion: CURRENT.terms, privacyVersion: CURRENT.privacy } });
            assert.equal(accepted.status, 201);
            for (const [kind, method, path, body] of GATED) {
                const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (path), { headers: auth(B), body });
                assert.notEqual(res.json?.error_type, 'terms_required', `${kind}: ${method} ${path}`);
            }
            const other = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(A) });
            assert.equal(other.json?.error_type, 'terms_required', 'another learner still has to accept');
        });
    });

    it('never gated: the bridge token, the dev fallback, guests and an anonymous Supabase user', async () => {
        await withServer(async (base) => {
            const bridge = await call(base, 'GET', '/api/v2/life-journal/range?from=2026-10-01&to=2026-10-02', { headers: { 'x-nexloom-bridge-token': BRIDGE } });
            assert.notEqual(bridge.json?.error_type, 'terms_required');
            const bridgeMemory = await call(base, 'POST', '/api/v2/learner-memory', { headers: { 'x-nexloom-bridge-token': BRIDGE }, body: { content: 'x' } });
            assert.notEqual(bridgeMemory.json?.error_type, 'terms_required');
            const dev = await call(base, 'GET', '/api/v2/curricula');
            assert.notEqual(dev.json?.error_type, 'terms_required', 'the dev fallback (development, no token)');
            const guest = await call(base, 'POST', '/api/v2/llm/tutor', { body: { question: 'x' } });
            assert.notEqual(guest.json?.error_type, 'terms_required', 'a guest on optionalAuth');
            for (const [, method, path, body] of GATED) {
                const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (path), { headers: auth(ANON), body });
                assert.notEqual(res.json?.error_type, 'terms_required', `anonymous: ${method} ${path}`);
            }
        });
        assert.equal(latestReads(), 0, 'nobody of these was checked');
    });

    it('switch off: the same routes never answer terms_required and the acceptance is never read (today\'s behaviour)', async () => {
        for (const value of [undefined, 'false', 'nope']) {
            if (value === undefined) delete process.env.LEGAL_TERMS_REQUIRED;
            else process.env.LEGAL_TERMS_REQUIRED = value;
            await withServer(async (base) => {
                for (const [kind, method, path, body] of GATED) {
                    const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (path), { headers: auth(A), body });
                    assert.notEqual(res.json?.error_type, 'terms_required', `${String(value)} ${kind}: ${method} ${path}`);
                }
            });
        }
        assert.equal(latestReads(), 0);
    });

    it('production with the draft texts: the switch is ignored (no refusal, no read) and the startup line says so', async () => {
        process.env.NODE_ENV = 'production';
        await withServer(async (base) => {
            for (const [, method, path] of [GATED[0], GATED[12], GATED[13]]) {
                const res = await call(base, /** @type {string} */ (method), /** @type {string} */ (path), { headers: auth(A), body: method === 'GET' ? undefined : {} });
                assert.notEqual(res.json?.error_type, 'terms_required', `${method} ${path}`);
            }
        });
        assert.equal(latestReads(), 0);
        const lines = legalStartupWarnings(process.env);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /ignored: LEGAL_TERMS_REQUIRED is on, but the current terms are drafts/);
    });

    it('a database error on the acceptance read: 503 legal_unavailable with Retry-After, never the route', async () => {
        pool.failOn(/^select terms_version, privacy_version, accepted_at from legal_acceptances/, Object.assign(new Error('down'), { code: '57P01' }));
        await withServer(async (base) => {
            const res = await call(base, 'GET', '/api/v2/user/achievements', { headers: auth(A) });
            assert.deepEqual([res.status, res.json?.error_type], [503, 'legal_unavailable']);
            assert.equal(res.headers.get('retry-after'), '60');
        });
    });
});
