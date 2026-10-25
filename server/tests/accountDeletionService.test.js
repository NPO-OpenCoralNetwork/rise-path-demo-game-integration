// Account deletion service (Phase 4, server/services/accountDeletion.js) against a stateful
// database (helpers/deletionPool.js, exact SQL), a fake Stripe (helpers/fakeStripe.js through the
// real stripeClient.js) and a fake Memanto (learnerMemoryBridge.js's test fetch). The pool and both
// fakes write to one event list, so the order of every statement and HTTP call is checked: every
// refusal check before anything is deleted, Memanto before the transaction, no HTTP call inside
// it, and the post-COMMIT steps after it.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { PHASE1_USER_ID } from '../db.js';
import { AFTER_COMMIT_WAIT_MS, deleteAccountData, isRenewing, readDeletionState, removeUploadFile, SQL as SERVICE_SQL } from '../services/accountDeletion.js';
import { setMemantoFetchForTests } from '../services/learnerMemoryBridge.js';
import { createStripeClient } from '../services/stripeClient.js';
import { TERMINAL_STATUSES } from '../services/billingEntitlement.js';
import { createDeletionPool, jstDay, norm, shiftDay, SQL } from './helpers/deletionPool.js';
import { createFakeStripe, subscription } from './helpers/fakeStripe.js';
import { createBillingAlerts } from '../services/billingAlerts.js';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const B = 'bcdef012-3456-4789-8bcd-ef0123456789';
const NOW = new Date('2026-10-24T05:00:00Z'); // 14:00 in Japan
const TODAY = jstDay(NOW);
const clock = () => NOW;
const MEMANTO = 'http://memanto.test';

const quietStripeLogger = { warn: () => {} };

/** A learner A with rows of every kind, and B, who must keep everything. */
const seedFor = (id = A, extra = {}) => ({
    stubs: [id, B],
    materials: [
        { user_id: id, storage_path: 'public/uploads/1700000000000-notes.txt' },
        { user_id: B, storage_path: 'public/uploads/1700000000009-b.txt' },
    ],
    acceptances: [
        { user_id: id, terms_version: 'terms-draft-2026-10-22', privacy_version: 'privacy-draft-2026-10-22' },
        { user_id: B, terms_version: 'terms-draft-2026-10-22', privacy_version: 'privacy-draft-2026-10-22' },
    ],
    consents: [{ id: 'c0000000-0000-4000-8000-000000000001', user_id: id }, { id: 'c0000000-0000-4000-8000-000000000002', user_id: B }],
    grants: [
        { user_id: id, client_id: '11111111-0000-4000-8000-000000000001', client_name: 'used app', first_seen_at: new Date('2026-10-02T00:00:00Z'), last_used_at: new Date('2026-10-20T00:00:00Z') },
        { user_id: id, client_id: '11111111-0000-4000-8000-000000000002', client_name: 'never used' },
    ],
    usage: [
        { usage_day: TODAY, kind: 'llm', subject: id, count: 3 },
        { usage_day: shiftDay(TODAY, -3), kind: 'llm', subject: id, count: 2 },
        { usage_day: shiftDay(TODAY, -3), kind: 'llm', subject: B, count: 1 },
        { usage_day: shiftDay(TODAY, -3), kind: 'llm', subject: 'ip:198.51.100.7', count: 1 },
    ],
    owned: { lesson_progress: [id, B], curricula: [id, B], learning_events: [id] },
    clock,
    ...extra,
});

let events;
let logs;
let invalidated;
let memanto;
let uploadRoot;
const saved = {};

const logger = {
    log: (line) => logs.push(['log', line]),
    warn: (line) => logs.push(['warn', line]),
};

/** Memanto at MEMANTO answering `status` (200: the agent was deleted). */
function memantoAt(status = 200) {
    process.env.MEMANTO_API_URL = MEMANTO;
    memanto.status = status;
}

function stripeWith(fake) {
    return createStripeClient({
        secretKey: ['rk', 'test', 'deletion1'].join('_'),
        logger: quietStripeLogger,
        fetch: async (url, init) => {
            const u = new URL(String(url));
            events.push(`stripe:${init.method} ${u.pathname}`);
            return fake.fetch(url, init);
        },
    });
}

const run = (pool, overrides = {}) => deleteAccountData({
    pool,
    userId: A,
    requestedBy: 'self',
    authTime: null,
    billing: { config: null, stripe: null },
    logger,
    uploadRoot,
    invalidateCaches: (id) => invalidated.push(id),
    now: () => NOW.getTime(),
    ...overrides,
});

const httpEvents = () => events.filter((e) => !e.startsWith('sql:'));
const between = (list, from, to) => list.slice(list.indexOf(from) + 1, list.lastIndexOf(to));

beforeEach(() => {
    events = [];
    logs = [];
    invalidated = [];
    for (const key of ['MEMANTO_API_URL', 'MEMANTO_ENABLED']) saved[key] = process.env[key];
    delete process.env.MEMANTO_API_URL;
    delete process.env.MEMANTO_ENABLED;
    memanto = { status: 200, calls: [] };
    setMemantoFetchForTests(async (url, init) => {
        const u = new URL(String(url));
        memanto.calls.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search}`);
        events.push(`memanto:${init?.method ?? 'GET'} ${u.pathname}`);
        return new Response(JSON.stringify(memanto.status === 200 ? { ok: true } : { detail: 'down (internal host memanto-1)' }), {
            status: memanto.status,
            headers: { 'content-type': 'application/json' },
        });
    });
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-delete-'));
    fs.mkdirSync(path.join(uploadRoot, 'public/uploads'), { recursive: true });
    fs.writeFileSync(path.join(uploadRoot, 'public/uploads/1700000000000-notes.txt'), 'A');
    fs.writeFileSync(path.join(uploadRoot, 'public/uploads/1700000000009-b.txt'), 'B');
});

afterEach(() => {
    setMemantoFetchForTests(null);
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    fs.rmSync(uploadRoot, { recursive: true, force: true });
});

describe('deleteAccountData: the order of the pipeline', () => {
    it('refusal checks → Stripe (expire, list) → Memanto → one transaction → post-COMMIT steps, with no HTTP call inside the transaction', async () => {
        memantoAt(200);
        const fake = createFakeStripe();
        fake.state.sessions.set('cs_open_1', { id: 'cs_open_1', status: 'open', customer: 'cus_a', url: 'https://checkout.stripe.com/c/pay/cs_open_1' });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        pool.addMemoryMeta(A);
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.deepEqual(result, { status: 'deleted', deletedAt: NOW.toISOString() });

        const commit = events.indexOf('sql:commit');
        assert.deepEqual(events.slice(0, commit + 1), [
            'sql:tombstone', 'sql:renewingLocal', 'sql:customers',
            'stripe:GET /v1/checkout/sessions', 'stripe:POST /v1/checkout/sessions/cs_open_1/expire', 'stripe:GET /v1/subscriptions',
            `memanto:DELETE /api/v2/agents/rp-user-${A}`, 'sql:memoryMeta',
            // The stub, consents and grants are locked right after the account lock, before the copies (finding: a
            // consent or grant written between the copies and the stub DELETE was cascaded with no proof).
            'sql:begin', 'sql:lockTimeout', 'sql:statementTimeout', 'sql:lock', 'sql:lockStub', 'sql:lockConsents', 'sql:lockGrants', 'sql:tombstoneForUpdate', 'sql:renewingLocal', 'sql:uploads',
            'sql:writeTombstone', 'sql:markAcceptances', 'sql:copyConsents', 'sql:copyGrants', 'sql:deleteOldUsage', 'sql:customers', 'sql:deleteStub', 'sql:commit',
        ]);
        assert.deepEqual(between(events, 'sql:begin', 'sql:commit').filter((e) => !e.startsWith('sql:')), [], 'no HTTP call while the account lock is held');
        // After COMMIT: Checkout Sessions again, the subscriptions again, Memanto again.
        assert.deepEqual(events.slice(commit + 1).filter((e) => !e.startsWith('sql:')), ['stripe:GET /v1/checkout/sessions', 'stripe:GET /v1/subscriptions', `memanto:DELETE /api/v2/agents/rp-user-${A}`]);
        const tx = pool.queries.filter((q) => q.tx).map((q) => q.sql);
        assert.equal(tx[0], 'begin');
        assert.equal(tx.at(-1), 'commit');
        assert.ok(pool.queries.filter((q) => !q.tx).every((q) => !['begin', 'commit'].includes(q.sql)));
        assert.equal(pool.releases, 1);
    });

    it('what goes, what stays: own rows gone, B untouched, proofs kept, today\'s usage kept, billing unlinked', async () => {
        const pool = createDeletionPool(seedFor(A, {
            customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }],
            subscriptions: [{ user_id: A, status: 'canceled' }],
        }));
        assert.equal((await run(pool)).status, 'deleted');
        const s = pool.state;
        assert.deepEqual([...s.stubs], [B]);
        assert.deepEqual(s.owned, { lesson_progress: [B], curricula: [B], learning_events: [] });
        assert.deepEqual(s.materials.map((m) => m.user_id), [B]);
        assert.deepEqual(s.consents.map((c) => c.user_id), [B]);
        assert.deepEqual([...s.consentProofs.values()].map((p) => [p.user_id, p.policy_version, p.account_deleted_at.toISOString()]), [[A, 'guardian-ai-2026-10', NOW.toISOString()]]);
        assert.deepEqual(s.provision.map((p) => p.client_name), ['used app'], 'only grants that were used');
        assert.deepEqual(s.usage.map((u) => `${u.subject}@${u.usage_day === TODAY ? 'today' : 'earlier'}`), [`${A}@today`, `${B}@earlier`, 'ip:198.51.100.7@earlier']);
        assert.deepEqual(s.customers, [{ stripe_customer_id: 'cus_a', user_id: null, livemode: false }]);
        assert.equal(s.subscriptions[0].user_id, null);
        assert.deepEqual(s.tombstones.get(A), { deleted_at: NOW, reopened_at: null, requested_by: 'self' });
    });

    it('legal_acceptances are marked with the deletion time, never deleted; B\'s stay live', async () => {
        const pool = createDeletionPool(seedFor());
        await run(pool);
        assert.equal(pool.state.acceptances.length, 2);
        assert.deepEqual(pool.state.acceptances.map((a) => [a.user_id, a.account_deleted_at?.toISOString() ?? null]), [[A, NOW.toISOString()], [B, null]]);
        assert.ok(pool.queries.every((q) => !/^delete from legal_acceptances/.test(q.sql)));
        assert.match(SERVICE_SQL.markAcceptances, /^UPDATE legal_acceptances SET account_deleted_at = \(SELECT deleted_at FROM account_deletions WHERE user_id = \$1::uuid\)/);
        const at = pool.state.tombstones.get(A).deleted_at.getTime();
        assert.ok([pool.state.acceptances[0], ...pool.state.consentProofs.values(), ...pool.state.provision].every((row) => row.account_deleted_at.getTime() === at), 'every proof carries the tombstone time');
    });

    it('an upper-case id reaches every statement lower-cased (the lock key, the stub, ai_daily_usage.subject)', async () => {
        const pool = createDeletionPool(seedFor());
        const result = await run(pool, { userId: A.toUpperCase(), requestedBy: 'staff' });
        assert.equal(result.status, 'deleted');
        const withId = pool.queries.filter((q) => q.params.length);
        assert.ok(withId.length >= 12);
        for (const q of withId) assert.equal(q.params[0], A, q.sql);
        for (const name of ['markAcceptances', 'copyConsents', 'copyGrants']) {
            const sent = pool.queries.filter((q) => q.sql === SQL[name]);
            assert.equal(sent.length, 1, name);
            assert.deepEqual(sent[0].params, name === 'copyGrants' ? [A, [], []] : [A], `${name}: only the id is sent (copyGrants: no app names from staff)`);
        }
        const lock = pool.queries.find((q) => q.sql === SQL.lock);
        assert.match(lock.sql, /hashtextextended\('rp:account:' \|\| \$1::uuid::text, 0\)/);
        assert.ok(pool.queries.some((q) => q.sql === SQL.deleteOldUsage), 'subject = $1::uuid::text');
        assert.deepEqual(pool.state.usage.filter((u) => u.subject === A).map((u) => u.usage_day), [TODAY]);
        assert.equal(pool.state.tombstones.get(A).requested_by, 'staff');
        assert.deepEqual(invalidated, [A]);
    });

    it('every statement casts the id ($1::uuid) and the module builds the lock key from $1::uuid::text', () => {
        for (const [name, text] of Object.entries(SERVICE_SQL)) {
            if (name === 'lockTimeout' || name === 'statementTimeout') continue;
            assert.match(text, /\$1::uuid/, name);
            assert.doesNotMatch(text.replace(/\$1::uuid/g, ''), /\$1\b/, `${name}: no uncast $1`);
            assert.equal(norm(text), SQL[name], `${name} matches the helper's independent text`);
        }
        assert.equal(SERVICE_SQL.lock, "SELECT pg_advisory_xact_lock(hashtextextended('rp:account:' || $1::uuid::text, 0))");
        assert.match(SERVICE_SQL.writeTombstone, /clock_timestamp\(\)/);
        // The proofs take deleted_at from the tombstone row in the database (microseconds kept), never a
        // JavaScript Date passed back as a parameter (node-pg keeps milliseconds only).
        for (const name of ['markAcceptances', 'copyConsents', 'copyGrants']) {
            assert.match(SERVICE_SQL[name], /, \(SELECT deleted_at FROM account_deletions WHERE user_id = \$1::uuid\)|= \(SELECT deleted_at FROM account_deletions WHERE user_id = \$1::uuid\)/, name);
            // copyGrants' $2/$3 are the page's app ids and names (unnest), never a time.
            assert.doesNotMatch(SERVICE_SQL[name].replace('unnest($2::uuid[], $3::text[])', ''), /\$[2-9]/, `${name}: no second parameter`);
        }
        assert.match(SERVICE_SQL.deleteOldUsage, /usage_day < \(now\(\) AT TIME ZONE 'Asia\/Tokyo'\)::date/);
        assert.deepEqual([...TERMINAL_STATUSES], ['canceled', 'incomplete_expired']);
    });
});

describe('deleteAccountData: the AI apps\' names in the provision records', () => {
    const USED = '11111111-0000-4000-8000-00000000000a';
    const NAMED = '11111111-0000-4000-8000-00000000000b';
    // As mcp-server/remote.js writes a used app (it cannot write client_name), and as the revoke route
    // writes a name.
    const grants = [
        { user_id: A, client_id: USED, client_name: null, first_seen_at: new Date('2026-10-02T00:00:00Z'), last_used_at: new Date('2026-10-20T00:00:00Z') },
        { user_id: A, client_id: NAMED, client_name: 'Name at revocation', first_seen_at: new Date('2026-10-02T00:00:00Z'), last_used_at: new Date('2026-10-03T00:00:00Z'), revoked_at: new Date('2026-10-04T00:00:00Z') },
    ];
    const names = (pool) => Object.fromEntries(pool.state.provision.map((p) => [p.client_id, p.client_name]));

    it('a used app that was never disconnected keeps the name the page read from Supabase; a stored name wins', async () => {
        const pool = createDeletionPool(seedFor(A, { grants }));
        const result = await run(pool, { appNames: [{ clientId: USED.toUpperCase(), clientName: 'Claude Code' }, { clientId: NAMED, clientName: 'Other name' }] });
        assert.equal(result.status, 'deleted');
        assert.deepEqual(names(pool), { [USED]: 'Claude Code', [NAMED]: 'Name at revocation' });
        const sent = pool.queries.find((q) => q.sql === SQL.copyGrants);
        assert.deepEqual(sent.params, [A, [USED, NAMED], ['Claude Code', 'Other name']]);
    });

    it('without names (staff, orphans) the record keeps the id; entries that are not an id and a name are left out', async () => {
        const pool = createDeletionPool(seedFor(A, { grants }));
        await run(pool, { appNames: [{ clientId: 'not-a-uuid', clientName: 'x' }, { clientId: USED, clientName: 42 }, { clientId: USED, clientName: '' }, null, 'str'] });
        assert.deepEqual(names(pool), { [USED]: null, [NAMED]: 'Name at revocation' });
        assert.deepEqual(pool.queries.find((q) => q.sql === SQL.copyGrants).params, [A, [], []]);
        const staff = createDeletionPool(seedFor(A, { grants }));
        await run(staff, { requestedBy: 'staff' });
        assert.deepEqual(names(staff), { [USED]: null, [NAMED]: 'Name at revocation' });
    });

    it('at most 20 names, one per id, each at most 100 characters', async () => {
        const many = Array.from({ length: 25 }, (_, i) => ({ clientId: `22222222-0000-4000-8000-${String(i).padStart(12, '0')}`, clientName: `app ${i}` }));
        const pool = createDeletionPool(seedFor(A, { grants }));
        await run(pool, { appNames: [{ clientId: USED, clientName: 'first' }, { clientId: USED, clientName: 'second' }, { clientId: NAMED, clientName: 'x'.repeat(101) }, ...many] });
        const [, ids, sentNames] = pool.queries.find((q) => q.sql === SQL.copyGrants).params;
        assert.equal(ids.length, 20);
        assert.equal(ids[0], USED);
        assert.equal(sentNames[0], 'first');
        assert.ok(!ids.includes(NAMED), 'a name over 100 characters is left out');
    });
});

describe('deleteAccountData: refusals before anything is deleted', () => {
    it('a renewing plan in the local copy → subscription_active: no Stripe write, no Memanto call, no transaction', async () => {
        memantoAt(200);
        const fake = createFakeStripe();
        const pool = createDeletionPool(seedFor(A, {
            events,
            subscriptions: [{ user_id: A, status: 'active' }],
            customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }],
        }));
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.deepEqual(result, { status: 'refused', reason: 'subscription_active', memoryDeleted: false });
        assert.deepEqual(httpEvents(), []);
        assert.deepEqual(memanto.calls, []);
        assert.equal(pool.connects, 0);
        assert.equal(pool.state.tombstones.size, 0);
        assert.ok(pool.state.stubs.has(A));
    });

    it('the local copy is empty but Stripe lists an active subscription (webhook not arrived) → subscription_active', async () => {
        memantoAt(200);
        const fake = createFakeStripe({ subscriptions: [subscription({ id: 'sub_late', customer: 'cus_a', status: 'active' })] });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.deepEqual(result, { status: 'refused', reason: 'subscription_active', memoryDeleted: false });
        assert.deepEqual(memanto.calls, []);
        assert.equal(pool.connects, 0);
        assert.ok(pool.state.stubs.has(A));
    });

    it('a plan already set to end (cancel_at_period_end or cancel_at), locally or at Stripe, does not block', async () => {
        const fake = createFakeStripe({
            subscriptions: [
                subscription({ id: 'sub_end1', customer: 'cus_a', status: 'active', cancel_at_period_end: true }),
                subscription({ id: 'sub_end2', customer: 'cus_a', status: 'active', cancel_at: 1_800_000_000 }),
                subscription({ id: 'sub_done', customer: 'cus_a', status: 'canceled' }),
            ],
        });
        const pool = createDeletionPool(seedFor(A, {
            customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }],
            subscriptions: [
                { user_id: A, status: 'active', cancel_at_period_end: true },
                { user_id: A, status: 'past_due', cancel_at: new Date('2026-11-01T00:00:00Z') },
                { user_id: A, status: 'incomplete_expired' },
            ],
        }));
        assert.equal((await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } })).status, 'deleted');
    });

    it('an open Checkout Session is expired before the transaction, and one opened meanwhile after COMMIT', async () => {
        const fake = createFakeStripe();
        fake.state.sessions.set('cs_before', { id: 'cs_before', status: 'open', customer: 'cus_a' });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        // A Session created between the checks and COMMIT (the person was still signed in elsewhere).
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    if (norm(sql) === SQL.deleteStub) fake.state.sessions.set('cs_meanwhile', { id: 'cs_meanwhile', status: 'open', customer: 'cus_a' });
                    return client.query(sql, params);
                },
            };
        };
        assert.equal((await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } })).status, 'deleted');
        assert.equal(fake.state.sessions.get('cs_before').status, 'expired');
        assert.equal(fake.state.sessions.get('cs_meanwhile').status, 'expired');
        const expiries = events.filter((e) => e.endsWith('/expire'));
        assert.deepEqual(expiries, ['stripe:POST /v1/checkout/sessions/cs_before/expire', 'stripe:POST /v1/checkout/sessions/cs_meanwhile/expire']);
        assert.ok(events.indexOf(expiries[0]) < events.indexOf('sql:begin'));
        assert.ok(events.indexOf(expiries[1]) > events.indexOf('sql:commit'));
    });

    it('Stripe 5xx (or a network error) → payment_provider_unavailable, nothing deleted, no Memanto call', async () => {
        memantoAt(200);
        for (const failure of [{ status: 500 }, 'network', { status: 429 }]) {
            events.length = 0;
            memanto.calls.length = 0;
            const fake = createFakeStripe({ subscriptions: [subscription({ id: 'sub_x', customer: 'cus_a', status: 'canceled' })] });
            fake.fail(/GET \/v1\/subscriptions/, failure);
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.deepEqual(result, { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }, JSON.stringify(failure));
            assert.equal(pool.connects, 0);
            assert.deepEqual(memanto.calls, []);
            assert.ok(pool.state.stubs.has(A));
        }
        assert.ok(logs.some(([, line]) => line.startsWith('[Account] could not check the plan at Stripe for abcdef01…')));
    });

    it('Stripe refusing an expiry because the Session is no longer open (400) or gone (404) is not an error; the subscription read decides', async () => {
        for (const failure of [{ status: 400, code: 'checkout_session_not_open' }, { status: 404, code: 'resource_missing' }]) {
            const fake = createFakeStripe();
            fake.state.sessions.set('cs_done', { id: 'cs_done', status: 'open', customer: 'cus_a' });
            fake.fail(/POST \/v1\/checkout\/sessions\/cs_done\/expire/, failure, { once: true });
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            assert.equal((await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } })).status, 'deleted', JSON.stringify(failure));
        }
    });

    it('expiring an open Checkout Session fails (5xx, 429, 401, 403, timeout, network) → payment_provider_unavailable before anything is deleted', async () => {
        memantoAt(200);
        for (const failure of [
            { status: 500 },
            { status: 503 },
            { status: 429, type: 'invalid_request_error', code: 'rate_limit' },
            { status: 401, type: 'invalid_request_error' },
            { status: 403, type: 'invalid_request_error', code: 'secret_key_required' },
            'timeout',
            'network',
        ]) {
            events.length = 0;
            memanto.calls.length = 0;
            const fake = createFakeStripe();
            fake.state.sessions.set('cs_x', { id: 'cs_x', status: 'open', customer: 'cus_a' });
            fake.fail(/POST \/v1\/checkout\/sessions\/cs_x\/expire/, failure);
            const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            const label = JSON.stringify(failure);
            assert.deepEqual(result, { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }, label);
            assert.equal(pool.connects, 0, label);
            assert.deepEqual(memanto.calls, [], label);
            assert.ok(pool.state.stubs.has(A), label);
            assert.equal(pool.state.tombstones.size, 0, label);
            assert.equal(fake.state.sessions.get('cs_x').status, 'open', label);
            assert.deepEqual(httpEvents(), ['stripe:GET /v1/checkout/sessions', 'stripe:POST /v1/checkout/sessions/cs_x/expire'], `${label}: no subscription read, no Memanto`);
        }
    });

    it('a subscription list with more pages (has_more) → payment_provider_unavailable: a renewing plan on page 2 is never missed', async () => {
        memantoAt(200);
        const fake = createFakeStripe({ subscriptions: [subscription({ id: 'sub_old', customer: 'cus_a', status: 'canceled' })], hasMore: { subscriptions: true } });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.deepEqual(result, { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false });
        assert.equal(pool.connects, 0);
        assert.deepEqual(memanto.calls, []);
        assert.ok(pool.state.stubs.has(A));
        assert.equal(pool.state.tombstones.size, 0);
        assert.deepEqual(httpEvents(), ['stripe:GET /v1/checkout/sessions', 'stripe:GET /v1/subscriptions']);
    });

    it('open Checkout Sessions still listed after three pages → payment_provider_unavailable (one may stay payable)', async () => {
        memantoAt(200);
        const fake = createFakeStripe({ hasMore: { sessions: true } });
        fake.state.sessions.set('cs_stuck', { id: 'cs_stuck', status: 'open', customer: 'cus_a' });
        fake.fail(/POST \/v1\/checkout\/sessions\/cs_stuck\/expire/, { status: 400, code: 'checkout_session_not_open' });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.deepEqual(result, { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false });
        assert.equal(fake.calls(/GET \/v1\/checkout\/sessions$/).length, 3);
        assert.equal(fake.calls(/GET \/v1\/subscriptions$/).length, 0);
        assert.equal(pool.connects, 0);
        assert.deepEqual(memanto.calls, []);
        assert.ok(pool.state.stubs.has(A));
    });

    it('a customer of the other mode, or no Stripe client, or no known mode: the local check only, with one log line naming the reason', async () => {
        for (const billing of [
            { config: { live: false }, stripe: 'fake', livemode: true, why: 'a customer of the other Stripe mode' },
            { config: null, stripe: null, livemode: true, why: 'billing not serviceable' },
            // A Stripe client but no boolean config.live: no Customer can be matched to a mode.
            { config: null, stripe: 'fake', livemode: false, why: 'billing not serviceable' },
            { config: {}, stripe: 'fake', livemode: false, why: 'billing not serviceable' },
        ]) {
            const label = JSON.stringify(billing);
            logs.length = 0;
            events.length = 0;
            const fake = createFakeStripe();
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_x', user_id: A, livemode: billing.livemode }] }));
            const result = await run(pool, { billing: { config: billing.config, stripe: billing.stripe ? stripeWith(fake) : null } });
            assert.equal(result.status, 'deleted', label);
            assert.deepEqual(httpEvents(), [], `${label}: Stripe is not called`);
            const lines = logs.filter(([, line]) => line.startsWith('[Account] renewing check used the local copy only'));
            assert.deepEqual(lines.map(([, line]) => line), [`[Account] renewing check used the local copy only (${billing.why})`], label);
        }
    });

    it('Memanto 503 → memory_service_unavailable before BEGIN: no tombstone, memoryDeleted false', async () => {
        memantoAt(503);
        const pool = createDeletionPool(seedFor(A, { events }));
        const result = await run(pool);
        assert.deepEqual(result, { status: 'refused', reason: 'memory_service_unavailable', memoryDeleted: false });
        assert.equal(memanto.calls.length, 1);
        assert.equal(pool.connects, 0);
        assert.ok(!events.includes('sql:begin'));
        assert.equal(pool.state.tombstones.size, 0);
        assert.ok(pool.state.stubs.has(A));
    });

    it('Memanto off (default): no Memanto HTTP call; the meta row cascades with the stub', async () => {
        const pool = createDeletionPool(seedFor());
        pool.addMemoryMeta(A);
        assert.equal((await run(pool)).status, 'deleted');
        assert.deepEqual(memanto.calls, []);
        assert.equal(pool.state.memoryMeta.has(A), false);
        assert.ok(logs.some(([, line]) => line.includes('memory skipped')));
    });

    it('PHASE1_USER_ID (any case), a non-UUID and no database are refused with no statement', async () => {
        const pool = createDeletionPool(seedFor());
        for (const userId of [PHASE1_USER_ID, PHASE1_USER_ID.toUpperCase(), 'not-a-uuid', '', null]) {
            assert.deepEqual(await run(pool, { userId }), { status: 'refused', reason: 'invalid_user', memoryDeleted: false }, String(userId));
        }
        assert.equal(pool.queries.length, 0);
        assert.deepEqual(await run(null), { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: false });
        await assert.rejects(run(pool, { requestedBy: 'admin' }), TypeError);
    });
});

describe('deleteAccountData: failures, repeats and races', () => {
    it('a failure inside the transaction rolls everything back; with Memanto on it says the memories are gone', async () => {
        memantoAt(200);
        const pool = createDeletionPool(seedFor());
        pool.failOn(/^delete from auth\.users/, Object.assign(new Error('update or delete on table "users" violates foreign key constraint "x_fkey"'), { code: '23503' }));
        const result = await run(pool);
        assert.deepEqual(result, { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: true });
        assert.deepEqual(pool.names().slice(-4), ['deleteOldUsage', 'customers', 'deleteStub', 'rollback']);
        assert.equal(pool.state.tombstones.size, 0, 'the tombstone is rolled back');
        assert.ok(pool.state.stubs.has(A));
        assert.equal(pool.state.acceptances[0].account_deleted_at, null);
        assert.equal(pool.state.consentProofs.size, 0);
        assert.ok(logs.some(([level, line]) => level === 'warn' && line === '[Account] partial: AI memories deleted, other data kept for abcdef01… (deletion_unavailable)'));
        assert.deepEqual(invalidated, []);
    });

    it('a lock wait over 10 s (55P03) → account_busy; another error → deletion_unavailable; Memanto off → memoryDeleted false', async () => {
        const busy = createDeletionPool(seedFor());
        busy.failOn(/^select pg_advisory_xact_lock\(/, Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }));
        assert.deepEqual(await run(busy), { status: 'failed', reason: 'account_busy', memoryDeleted: false });
        assert.equal(busy.names().at(-1), 'rollback');
        const broken = createDeletionPool(seedFor());
        broken.failOn(/^insert into account_deletions/, Object.assign(new Error('relation "account_deletions" does not exist'), { code: '42P01' }));
        assert.deepEqual(await run(broken), { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: false });
        assert.ok(broken.state.stubs.has(A));
        const noConnection = createDeletionPool(seedFor());
        noConnection.failConnect(new Error('connect ECONNREFUSED'));
        assert.deepEqual(await run(noConnection), { status: 'failed', reason: 'deletion_unavailable', memoryDeleted: false });
        assert.ok(logs.every(([, line]) => !line.includes('ECONNREFUSED')), 'no driver text beyond the code');
    });

    it('a second call answers already with the first deletion time; a session newer than the deletion + 30 s deletes again', async () => {
        const pool = createDeletionPool(seedFor());
        const first = await run(pool);
        const again = await run(pool);
        assert.deepEqual(again, { status: 'already', deletedAt: first.deletedAt });
        const old = await run(pool, { authTime: NOW.getTime() / 1000 + 30 });
        assert.equal(old.status, 'already', 'within the 30 s margin');
        // A re-opened account (reopened_at set) is a new account: deleting it again works.
        pool.state.tombstones.get(A).reopened_at = new Date(NOW.getTime() + 60_000);
        pool.state.stubs.add(A);
        const later = await run(pool, { authTime: NOW.getTime() / 1000 + 90 });
        assert.equal(later.status, 'deleted');
        assert.equal(pool.state.tombstones.get(A).reopened_at, null);
    });

    it('a deletion that committed while this one waited for the lock: already, rolled back, nothing written twice', async () => {
        const pool = createDeletionPool(seedFor());
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    if (norm(sql) === SQL.lock) pool.state.tombstones.set(A, { deleted_at: new Date(NOW.getTime() - 1000), reopened_at: null, requested_by: 'staff' });
                    return client.query(sql, params);
                },
            };
        };
        const result = await run(pool);
        assert.deepEqual(result, { status: 'already', deletedAt: new Date(NOW.getTime() - 1000).toISOString() });
        assert.deepEqual(pool.names().slice(-2), ['tombstoneForUpdate', 'rollback']);
    });

    it('a subscription synced between the checks and the lock is caught inside the transaction (409, rolled back)', async () => {
        memantoAt(200);
        const pool = createDeletionPool(seedFor());
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    if (norm(sql) === SQL.lock) pool.state.subscriptions.push({ user_id: A, status: 'active', cancel_at_period_end: false, cancel_at: null });
                    return client.query(sql, params);
                },
            };
        };
        const result = await run(pool);
        assert.deepEqual(result, { status: 'refused', reason: 'subscription_active', memoryDeleted: true });
        assert.deepEqual(pool.names().slice(-2), ['renewingLocal', 'rollback']);
        assert.equal(pool.state.tombstones.size, 0);
        assert.ok(logs.some(([, line]) => line === '[Account] partial: AI memories deleted, other data kept for abcdef01… (subscription_active)'));
    });
});

describe('deleteAccountData: after COMMIT', () => {
    it('upload files: only public/uploads/<13 digits>-<name> regular files inside the upload folder; ENOENT counts as done', async () => {
        // Every path outside the upload folder points at a canary inside this test's temp dir (never a
        // system file), so the test stays harmless when the path guard is reverted to prove it.
        const outside = path.join(uploadRoot, 'server.js');
        fs.writeFileSync(outside, 'keep me');
        const canary = path.join(uploadRoot, 'outside-canary.txt');
        fs.writeFileSync(canary, 'canary');
        fs.symlinkSync(outside, path.join(uploadRoot, 'public/uploads/1700000000001-link.txt'));
        fs.mkdirSync(path.join(uploadRoot, 'public/uploads/1700000000002-dir'));
        const pool = createDeletionPool(seedFor(A, {
            materials: [
                { user_id: A, storage_path: 'public/uploads/1700000000000-notes.txt' },
                { user_id: A, storage_path: 'public/uploads/../../server.js' },
                { user_id: A, storage_path: 'public/uploads/1700000000001-link.txt' },
                { user_id: A, storage_path: 'public/uploads/1700000000002-dir' },
                { user_id: A, storage_path: 'public/uploads/1700000000003-gone.txt' },
                { user_id: A, storage_path: canary },
                { user_id: B, storage_path: 'public/uploads/1700000000009-b.txt' },
            ],
        }));
        assert.equal((await run(pool)).status, 'deleted');
        assert.equal(fs.existsSync(path.join(uploadRoot, 'public/uploads/1700000000000-notes.txt')), false);
        assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
        assert.equal(fs.readFileSync(canary, 'utf8'), 'canary', 'an absolute path outside the upload folder is never removed');
        assert.equal(fs.lstatSync(path.join(uploadRoot, 'public/uploads/1700000000001-link.txt')).isSymbolicLink(), true, 'a symlink is never followed or removed');
        assert.ok(fs.existsSync(path.join(uploadRoot, 'public/uploads/1700000000002-dir')));
        assert.ok(fs.existsSync(path.join(uploadRoot, 'public/uploads/1700000000009-b.txt')), "B's file stays");
        assert.ok(logs.some(([, line]) => line.includes('(self; files 2/6; memory skipped)')), JSON.stringify(logs));
    });

    it('removeUploadFile refuses traversal, absolute paths, other folders, NUL and non-regular files', async () => {
        // Canaries inside the temp dir only (never a system path): they must survive every refusal.
        const canary = path.join(uploadRoot, 'x');
        fs.writeFileSync(canary, 'canary');
        fs.mkdirSync(path.join(uploadRoot, 'public/generated'), { recursive: true });
        fs.writeFileSync(path.join(uploadRoot, 'public/generated/1700000000000-a.png'), 'canary');
        fs.writeFileSync(path.join(uploadRoot, 'server.js'), 'canary');
        for (const p of ['public/uploads/../../server.js', 'public/uploads/1700000000000-a/../../x', canary, 'public/generated/1700000000000-a.png',
            'public/uploads/170000000000-short.txt', 'public/uploads/1700000000000-a\0b', 'public/uploads\\1700000000000-a', null, 42]) {
            assert.equal(await removeUploadFile(p, uploadRoot), 'refused', String(p));
        }
        for (const file of ['x', 'public/generated/1700000000000-a.png', 'server.js']) {
            assert.equal(fs.readFileSync(path.join(uploadRoot, file), 'utf8'), 'canary', `${file} survives`);
        }
        assert.equal(await removeUploadFile('public/uploads/1700000000005-missing.txt', uploadRoot), 'missing');
        assert.equal(await removeUploadFile('public/uploads/1700000000009-b.txt', uploadRoot), 'removed');
    });

    it('caches are invalidated with the canonical id; the one log line has an 8-character id and no file name', async () => {
        const pool = createDeletionPool(seedFor());
        await run(pool, { userId: A.toUpperCase(), requestedBy: 'orphan' });
        assert.deepEqual(invalidated, [A]);
        const done = logs.filter(([level]) => level === 'log').map(([, line]) => line);
        assert.equal(done.length, 1);
        assert.match(done[0], /^\[Account\] Rise Path data deleted for abcdef01… \(orphan; files 1\/1; memory skipped\) in \d+ms$/);
        for (const [, line] of logs) {
            assert.ok(!line.includes(A) && !line.includes(A.toUpperCase()), `no full id: ${line}`);
            assert.ok(!line.includes('notes.txt') && !line.includes('public/uploads'), `no file name: ${line}`);
        }
        const source = readFileSync(new URL('../services/accountDeletion.js', import.meta.url), 'utf8');
        assert.match(source, /invalidateAiAccess\(id\);\s*invalidatePlan\(id\);/, 'the default invalidator clears both caches');
    });

    it('a post-COMMIT failure (Stripe, Memanto) is logged and never undoes the deletion', async () => {
        memantoAt(200);
        const fake = createFakeStripe();
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        let commits = 0;
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    const out = await client.query(sql, params);
                    if (norm(sql) === 'commit') {
                        commits += 1;
                        fake.fail(/GET \/v1\/checkout\/sessions/, { status: 503 });
                        memanto.status = 503;
                    }
                    return out;
                },
            };
        };
        const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
        assert.equal(commits, 1);
        assert.equal(result.status, 'deleted');
        assert.ok(logs.some(([, line]) => line === '[Account] could not expire checkout sessions after deleting abcdef01…'));
        assert.ok(logs.some(([, line]) => line === '[Account] could not re-check AI memories after deleting abcdef01…'));
        assert.equal(pool.state.stubs.has(A), false);
    });

    it('after COMMIT, Stripe refusing an expiry with 401 or 403 (the key lost Checkout Sessions write) is logged, not ignored', async () => {
        for (const failure of [{ status: 403, type: 'invalid_request_error' }, { status: 401, type: 'invalid_request_error' }]) {
            logs.length = 0;
            const fake = createFakeStripe();
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const realConnect = pool.connect;
            pool.connect = async () => {
                const client = await realConnect();
                return {
                    ...client,
                    query: async (sql, params) => {
                        const out = await client.query(sql, params);
                        if (norm(sql) === 'commit') {
                            fake.state.sessions.set('cs_late', { id: 'cs_late', status: 'open', customer: 'cus_a' });
                            fake.fail(/POST \/v1\/checkout\/sessions\/cs_late\/expire/, failure);
                        }
                        return out;
                    },
                };
            };
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.equal(result.status, 'deleted', JSON.stringify(failure));
            assert.equal(fake.calls(/POST \/v1\/checkout\/sessions\/cs_late\/expire/).length, 1);
            assert.ok(logs.some(([level, line]) => level === 'warn' && line === '[Account] could not expire checkout sessions after deleting abcdef01…'), JSON.stringify(failure));
        }
    });

    it('a Stripe Customer stored by a checkout after the step-1 read is read again before the stub goes, and its Session expired after COMMIT', async () => {
        const fake = createFakeStripe();
        fake.state.sessions.set('cs_a', { id: 'cs_a', status: 'open', customer: 'cus_a' });
        const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    // A checkout in another tab (it passed requireAuth before this deletion) stores its
                    // new Customer while this deletion waits for the lock, and opens a Session.
                    if (norm(sql) === SQL.lock) {
                        pool.state.customers.push({ stripe_customer_id: 'cus_new', user_id: A, livemode: false });
                        pool.state.customers.push({ stripe_customer_id: 'cus_live', user_id: A, livemode: true });
                        fake.state.sessions.set('cs_new', { id: 'cs_new', status: 'open', customer: 'cus_new' });
                    }
                    return client.query(sql, params);
                },
            };
        };
        assert.equal((await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } })).status, 'deleted');
        const inTx = between(events, 'sql:begin', 'sql:commit');
        assert.ok(inTx.indexOf('sql:customers') !== -1 && inTx.indexOf('sql:customers') < inTx.indexOf('sql:deleteStub'), 'read again inside the transaction, before the stub');
        assert.equal(fake.state.sessions.get('cs_new').status, 'expired');
        assert.equal(fake.state.sessions.get('cs_a').status, 'expired');
        const afterCommit = events.slice(events.indexOf('sql:commit') + 1);
        assert.ok(afterCommit.includes('stripe:POST /v1/checkout/sessions/cs_new/expire'));
        // Only this api's mode: the live-mode Customer is not sent to the test-mode key.
        assert.equal(fake.requests.filter((r) => r.form.get('customer') === 'cus_live').length, 0);
        assert.deepEqual(pool.state.customers.map((c) => c.user_id), [null, null, null], 'every Customer row is unlinked by the cascade');
    });

    it('a Session paid during the transaction (its webhook not arrived): the deletion stands and the renewing subscription raises the owner alert', async () => {
        // An owner alert (AI_CAP_ALERT_WEBHOOK_URL), not only a log line: a deploy recreates the api
        // container and erases its log before anyone reads it.
        const ALERT = '[Billing] deleted_account_renewing: a renewing subscription exists after deleting abcdef01…: cancel it in the Stripe Dashboard';
        // cus_a: a Customer step 1 saw; cus_new: one first seen by the read inside the transaction.
        for (const [customer, sub, wantLine] of [
            ['cus_a', { status: 'active' }, true],
            ['cus_new', { status: 'trialing' }, true],
            ['cus_a', { status: 'active', cancel_at_period_end: true }, false],
            ['cus_new', { status: 'canceled' }, false],
        ]) {
            const label = `${customer} ${JSON.stringify(sub)}`;
            events.length = 0;
            logs.length = 0;
            const alertLines = [];
            const posted = [];
            const alerts = createBillingAlerts({
                env: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example.org/billing' },
                fetch: async (url, init) => {
                    posted.push(JSON.parse(String(init.body)));
                    return new Response('ok');
                },
                logger: { warn: (line) => alertLines.push(['warn', line]), error: (line) => alertLines.push(['error', line]) },
                now: () => NOW.getTime(),
            });
            const fake = createFakeStripe();
            const pool = createDeletionPool(seedFor(A, { events, customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const realConnect = pool.connect;
            pool.connect = async () => {
                const client = await realConnect();
                return {
                    ...client,
                    query: async (sql, params) => {
                        if (norm(sql) === SQL.lock && customer === 'cus_new') pool.state.customers.push({ stripe_customer_id: 'cus_new', user_id: A, livemode: false });
                        if (norm(sql) === SQL.deleteStub) {
                            // A checkout opened after step 1 is paid now: Stripe made the subscription,
                            // the webhook has not reached billing_subscriptions yet.
                            fake.state.sessions.set('cs_paid', { id: 'cs_paid', status: 'complete', customer });
                            fake.putSubscription(subscription({ id: 'sub_paid', customer, ...sub }));
                        }
                        return client.query(sql, params);
                    },
                };
            };
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) }, alerts });
            await new Promise((resolve) => setImmediate(resolve)); // the webhook post is not awaited
            assert.equal(result.status, 'deleted', label);
            assert.equal(pool.state.stubs.has(A), false, label);
            const afterCommit = events.slice(events.indexOf('sql:commit') + 1);
            assert.ok(afterCommit.includes('stripe:GET /v1/subscriptions'), `${label}: the subscriptions are read again after COMMIT`);
            assert.ok(fake.calls(/GET \/v1\/subscriptions$/).some((r) => r.form.get('customer') === customer && r.form.get('status') === 'all'), label);
            assert.deepEqual(alertLines, wantLine ? [['error', ALERT]] : [], label);
            assert.equal(posted.length, wantLine ? 1 : 0, `${label}: posted to the owner webhook`);
            assert.ok([...logs, ...alertLines].every(([, line]) => !line.includes(A)) && !JSON.stringify(posted).includes(A), `${label}: 8 characters only`);
        }
    });

    it('after COMMIT, a subscription read that fails or has more pages is logged; the deletion stands', async () => {
        for (const breakRead of [
            (fake) => fake.fail(/GET \/v1\/subscriptions/, { status: 503 }),
            (fake) => fake.fail(/GET \/v1\/subscriptions/, 'network'),
            (fake, hasMore) => {
                hasMore.subscriptions = true;
            },
        ]) {
            logs.length = 0;
            const hasMore = {};
            const fake = createFakeStripe({ hasMore });
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const realConnect = pool.connect;
            pool.connect = async () => {
                const client = await realConnect();
                return {
                    ...client,
                    query: async (sql, params) => {
                        const out = await client.query(sql, params);
                        if (norm(sql) === 'commit') breakRead(fake, hasMore);
                        return out;
                    },
                };
            };
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.equal(result.status, 'deleted', String(breakRead));
            assert.deepEqual(logs.filter(([, line]) => line.includes('subscription')).map(([level, line]) => [level, line]),
                [['warn', '[Account] could not re-check subscriptions at Stripe after deleting abcdef01…']], String(breakRead));
        }
    });
});

describe('deleteAccountData: plan rows by Stripe mode, Customers Stripe no longer has, the wait after COMMIT', () => {
    /** Wraps a pool so `onSql(text)` runs before each statement inside the transaction. */
    const hookTx = (pool, onSql) => {
        const realConnect = pool.connect;
        pool.connect = async () => {
            const client = await realConnect();
            return {
                ...client,
                query: async (sql, params) => {
                    onSql(norm(sql));
                    return client.query(sql, params);
                },
            };
        };
        return pool;
    };

    it('a live api leaves a test-mode plan row out (it is never synced again); a live row blocks; a test api or an unknown mode counts every row', async () => {
        const fake = createFakeStripe();
        const LIVE = { config: { live: true }, stripe: stripeWith(fake) };
        const TEST = { config: { live: false }, stripe: stripeWith(fake) };
        for (const [label, billing, livemode, want] of [
            ['live api, a tester\'s test-mode row still active', LIVE, false, 'deleted'],
            ['live api, a live row', LIVE, true, 'subscription_active'],
            ['test api, a live row', TEST, true, 'subscription_active'],
            ['test api, a test-mode row', TEST, false, 'subscription_active'],
            ['billing not serviceable (no client), a test-mode row', { config: { live: false }, stripe: null }, false, 'subscription_active'],
            ['config.live true but no client (mode not known)', { config: { live: true }, stripe: null }, false, 'subscription_active'],
            ['no billing config', { config: null, stripe: null }, false, 'subscription_active'],
        ]) {
            const pool = createDeletionPool(seedFor(A, { subscriptions: [{ user_id: A, status: 'active', livemode }] }));
            const result = await run(pool, { billing });
            assert.equal(result.status === 'refused' ? result.reason : result.status, want, label);
            assert.equal(pool.state.stubs.has(A), want !== 'deleted', label);
            if (want === 'deleted') assert.equal(pool.state.subscriptions[0].user_id, null, `${label}: the row stays, unlinked`);
            const sent = pool.queries.filter((q) => q.sql === SQL.renewingLocal);
            assert.ok(sent.length >= 1 && sent.every((q) => q.params[1] === (billing === LIVE)), `${label}: $2 is whether the api is live`);
        }
    });

    it('the plan check inside the transaction uses the same rule: a test-mode row synced meanwhile does not stop a live api; a live one does', async () => {
        const fake = createFakeStripe();
        for (const [livemode, want] of [[false, 'deleted'], [true, 'subscription_active']]) {
            const pool = createDeletionPool(seedFor());
            hookTx(pool, (text) => {
                if (text === SQL.lock) pool.state.subscriptions.push({ user_id: A, status: 'active', cancel_at_period_end: false, cancel_at: null, livemode });
            });
            const result = await run(pool, { billing: { config: { live: true }, stripe: stripeWith(fake) } });
            assert.equal(result.status === 'refused' ? result.reason : result.status, want, `livemode ${livemode}`);
        }
    });

    it('a stored Customer Stripe no longer has (resource_missing on its list) has nothing there: deleted, one line, no "could not" lines; other Customers are still checked', async () => {
        const MISSING = '[Account] a Stripe customer of abcdef01… no longer exists at Stripe (nothing to check there)';
        // 400 resource_missing (param customer), from the fake's missingCustomers.
        {
            logs.length = 0;
            const fake = createFakeStripe({ missingCustomers: ['cus_gone'] });
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_gone', user_id: A, livemode: false }] }));
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.equal(result.status, 'deleted');
            assert.deepEqual(logs.filter(([, line]) => line === MISSING).map(([level]) => level), ['warn'], 'one line before the deletion');
            assert.deepEqual(logs.filter(([, line]) => /could not|renewing subscription/.test(line)), [], 'after COMMIT the missing Customer is not a failure either');
            assert.ok(fake.calls(/GET \/v1\/checkout\/sessions$/).length >= 2, 'asked before and after COMMIT');
        }
        // 404 resource_missing on either list.
        for (const pattern of [/GET \/v1\/checkout\/sessions$/, /GET \/v1\/subscriptions$/]) {
            logs.length = 0;
            const fake = createFakeStripe();
            fake.fail(pattern, { status: 404, type: 'invalid_request_error', code: 'resource_missing' });
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_gone', user_id: A, livemode: false }] }));
            assert.equal((await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } })).status, 'deleted', String(pattern));
            assert.deepEqual(logs.filter(([, line]) => /could not/.test(line)), [], String(pattern));
        }
        // A missing Customer does not skip the others: cus_a still has a renewing plan at Stripe.
        {
            const fake = createFakeStripe({ missingCustomers: ['cus_gone'], subscriptions: [subscription({ id: 'sub_a', customer: 'cus_a', status: 'active' })] });
            const pool = createDeletionPool(seedFor(A, {
                customers: [{ stripe_customer_id: 'cus_gone', user_id: A, livemode: false }, { stripe_customer_id: 'cus_a', user_id: A, livemode: false }],
            }));
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.deepEqual(result, { status: 'refused', reason: 'subscription_active', memoryDeleted: false });
            assert.ok(pool.state.stubs.has(A));
        }
    });

    it('other failures of the list calls still refuse: 404 without resource_missing (a wrong URL), another 400, 401, 403', async () => {
        for (const failure of [
            { status: 404, type: 'invalid_request_error' },
            { status: 400, type: 'invalid_request_error', code: 'parameter_invalid_empty' },
            { status: 401, type: 'invalid_request_error' },
            { status: 403, type: 'invalid_request_error', code: 'resource_missing' },
        ]) {
            const fake = createFakeStripe();
            fake.fail(/GET \/v1\/(checkout\/sessions|subscriptions)$/, failure);
            const pool = createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] }));
            const result = await run(pool, { billing: { config: { live: false }, stripe: stripeWith(fake) } });
            assert.deepEqual(result, { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }, JSON.stringify(failure));
            assert.ok(pool.state.stubs.has(A), JSON.stringify(failure));
        }
    });

    it('the answer waits at most afterCommitWaitMs for the re-checks after COMMIT (a hanging Memanto, a Stripe that does not answer); the data is already gone', async () => {
        assert.equal(AFTER_COMMIT_WAIT_MS, 10_000);
        const LATE = '[Account] re-checks after deleting abcdef01… did not finish within 40 ms: answered without them (they log their own result)';
        /** Fails the test instead of hanging when the answer waits for the re-checks. */
        const answered = async (promise) => {
            let timer;
            try {
                return await Promise.race([promise, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('the answer waited for the re-checks after COMMIT')), 3000);
                })]);
            } finally {
                clearTimeout(timer);
            }
        };
        const never = () => new Promise(() => {});
        // Memanto: the first purge (before the transaction) answers, the one after COMMIT never does.
        {
            logs.length = 0;
            invalidated.length = 0;
            let purges = 0;
            const memory = { enabled: () => true, purge: async () => (purges++ === 0 ? { ok: true } : never()) };
            const pool = createDeletionPool(seedFor());
            const result = await answered(run(pool, { memory, afterCommitWaitMs: 40 }));
            assert.equal(result.status, 'deleted');
            assert.equal(purges, 2);
            assert.equal(pool.state.stubs.has(A), false);
            assert.deepEqual(invalidated, [A], 'the caches are cleared before the re-checks');
            assert.deepEqual(logs.filter(([, line]) => line === LATE).map(([level]) => level), ['warn']);
            assert.ok(logs.some(([level, line]) => level === 'log' && line.startsWith('[Account] Rise Path data deleted for abcdef01… (self; files 1/1; memory deleted)')));
        }
        // Stripe: the subscription read after COMMIT never answers.
        {
            logs.length = 0;
            const fake = createFakeStripe();
            const real = stripeWith(fake);
            let committed = false;
            const stripe = { ...real, listSubscriptions: (input) => (committed ? never() : real.listSubscriptions(input)) };
            const pool = hookTx(createDeletionPool(seedFor(A, { customers: [{ stripe_customer_id: 'cus_a', user_id: A, livemode: false }] })), (text) => {
                if (text === 'commit') committed = true;
            });
            const result = await answered(run(pool, { billing: { config: { live: false }, stripe }, afterCommitWaitMs: 40 }));
            assert.equal(result.status, 'deleted');
            assert.deepEqual(logs.filter(([, line]) => line === LATE).map(([level]) => level), ['warn']);
        }
        // Re-checks that finish in time: no such line.
        {
            logs.length = 0;
            const pool = createDeletionPool(seedFor());
            assert.equal((await run(pool, { afterCommitWaitMs: 40 })).status, 'deleted');
            assert.ok(!logs.some(([, line]) => line.includes('did not finish')));
        }
    });
});

describe('readDeletionState and isRenewing', () => {
    it('none / ending / renewing from the local copy', async () => {
        const cases = [
            [[], 'none'],
            [[{ user_id: A, status: 'canceled' }], 'none'],
            [[{ user_id: A, status: 'active', cancel_at_period_end: true }], 'ending'],
            [[{ user_id: A, status: 'active', cancel_at: new Date() }, { user_id: A, status: 'incomplete_expired' }], 'ending'],
            [[{ user_id: A, status: 'active', cancel_at_period_end: true }, { user_id: A, status: 'trialing' }], 'renewing'],
            [[{ user_id: B, status: 'active' }], 'none'],
        ];
        for (const [subscriptions, want] of cases) {
            const pool = createDeletionPool({ subscriptions });
            assert.deepEqual(await readDeletionState({ pool, userId: A.toUpperCase() }), { subscription: want }, JSON.stringify(subscriptions));
        }
        await assert.rejects(readDeletionState({ pool: createDeletionPool(), userId: 'x' }), TypeError);
    });

    it('the same rows as the deletion: a live api leaves a test-mode row out; a live row counts; without a known mode every row counts', async () => {
        const live = { config: { live: true }, stripe: stripeWith(createFakeStripe()) };
        const testMode = { config: { live: false }, stripe: stripeWith(createFakeStripe()) };
        for (const [billing, livemode, want] of [
            [live, false, 'none'],
            [live, true, 'renewing'],
            [testMode, false, 'renewing'],
            [testMode, true, 'renewing'],
            [{ config: { live: true }, stripe: null }, false, 'renewing'],
            [undefined, false, 'renewing'],
        ]) {
            const pool = createDeletionPool({ subscriptions: [{ user_id: A, status: 'active', livemode }] });
            assert.deepEqual(await readDeletionState({ pool, userId: A, billing }), { subscription: want }, `${JSON.stringify(billing?.config)} livemode ${livemode}`);
        }
    });

    it('isRenewing: the local rule on Stripe objects', () => {
        assert.equal(isRenewing({ status: 'active', cancel_at_period_end: false, cancel_at: null }), true);
        assert.equal(isRenewing({ status: 'incomplete' }), true);
        assert.equal(isRenewing({ status: 'active', cancel_at_period_end: true }), false);
        assert.equal(isRenewing({ status: 'active', cancel_at: 1_800_000_000 }), false);
        for (const status of TERMINAL_STATUSES) assert.equal(isRenewing({ status }), false);
        assert.equal(isRenewing(null), false);
    });
});
