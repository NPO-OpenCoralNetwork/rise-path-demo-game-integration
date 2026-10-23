// The supporter plan's API (server/routes/billing.js at /api/v2/billing) with a fake Stripe
// (helpers/fakeStripe.js) and an in-memory database (helpers/billingPool.js, exact SQL). On the
// real server.js stack: billing off, sales closed, test mode limited to testers, the auth refusals
// (no token, dev fallback, PHASE1_USER_ID, anonymous, an agent's token), eligibility, GET /plan and
// /me, the portal without an eligibility check, /sync, the per-user limit, and the supporter caps
// on /llm and /ai/generate through the shared daily caps. With the router alone and a moving
// clock: the checkout (Price check, Customer with ON CONFLICT and the stored id, 409 cases from a
// fresh Stripe read, expiry of older open Sessions, identical parameters within a minute). Also
// pins migration 017.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests, PHASE1_USER_ID } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { resetDailyCapsForTests, reserveDailyCapFor } from '../middleware/dailyCaps.js';
import { resetGatewayForTests } from '../llm/index.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { BILLING_ENV_KEYS, readBillingConfig } from '../services/billingConfig.js';
import { CHECKOUT_TEXT_MAX, OWNER_FACTS } from '../services/billingDisclosure.js';
import { createBillingAlerts, resetBillingAlertsForTests } from '../services/billingAlerts.js';
import { resetPlanCacheForTests } from '../services/billingEntitlement.js';
import { SUBSCRIPTION_STATUSES } from '../services/billingSync.js';
import { createStripeClient, setStripeFetchForTests } from '../services/stripeClient.js';
import { BILLING_REQUESTS_PER_MINUTE, createBillingRouter } from '../routes/billing.js';
import { createBillingPool, SQL } from './helpers/billingPool.js';
import { createFakeStripe, goodPrice, subscription } from './helpers/fakeStripe.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001'; // adult tester
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002'; // adult, not a tester
const MINA = 'aaaaaaaa-1111-4000-8000-000000000003'; // minor tester (guardian consent)
const NOAGE = 'aaaaaaaa-1111-4000-8000-000000000004'; // tester without an age
const PAUSY = 'aaaaaaaa-1111-4000-8000-000000000005'; // paused adult tester
const ANON = 'aaaaaaaa-1111-4000-8000-000000000006'; // anonymous Supabase user (tester)
const TESTERS = [ALICE, MINA, NOAGE, PAUSY, ANON, PHASE1_USER_ID];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const AGENT_TOKEN = `${b64({ alg: 'ES256' })}.${b64({ sub: ALICE, aud: 'https://mcp.example.org/mcp', client_id: '11111111-2222-4000-8000-000000000001', exp: 4_000_000_000 })}.c2ln`;
const USERS = {
    'tok-alice': { id: ALICE },
    'tok-bob': { id: BOB },
    'tok-mina': { id: MINA },
    'tok-noage': { id: NOAGE },
    'tok-pausy': { id: PAUSY },
    'tok-anon': { id: ANON, is_anonymous: true },
    'tok-phase1': { id: PHASE1_USER_ID },
};
const as = (who) => ({ Authorization: `Bearer tok-${who}` });
const ORIGIN = 'https://app.example.org';
const quiet = { warn: () => {}, error: () => {} };
const FILLED = Object.fromEntries(Object.keys(OWNER_FACTS).map((k) => [k, { jp: `記入済み ${k}`, en: `filled ${k}` }]));
const BILLING_ENV = {
    BILLING_ENABLED: 'true',
    BILLING_TEST_USER_IDS: TESTERS.join(','),
    STRIPE_SECRET_KEY: ['rk', 'test', 'routekey1'].join('_'),
    STRIPE_WEBHOOK_SECRET: 'whsec_route1',
    STRIPE_PRICE_ID: 'price_supporter',
    BILLING_RETURN_ORIGIN: ORIGIN,
};

const seedPool = (extra = {}) => createBillingPool({
    ages: { [ALICE]: '1990-04', [BOB]: '1991-05', [MINA]: '2012-04', [PAUSY]: '1985-01', [ANON]: '1990-01', [PHASE1_USER_ID]: '1990-01' },
    consents: { [MINA]: true },
    blocked: { [PAUSY]: 10 },
    ...extra,
});

/** fetch a JSON route: { status, json, text, headers }. */
async function call(url, { method = 'GET', headers = {}, body } = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text, headers: response.headers };
}

const listen = async (app, handler, prefix) => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}${prefix}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const ENV_KEYS = [
    'NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY',
    'AI_CAP_USER_LLM', 'AI_CAP_IP_LLM', 'AI_CAP_GLOBAL_LLM', 'AI_CAP_USER_COURSE_GENERATION', 'AI_CAP_GLOBAL_COURSE_GENERATION',
    'AI_CAP_ALERT_WEBHOOK_URL', 'AI_ACCESS_DEV_AUDIENCE', 'LLM_GUEST_AI', 'LLM_PROVIDER', 'LLM_MOCK_DELAY_MS', 'LLM_ALLOWED_ORIGINS',
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GEMINI_ALLOWED', ...BILLING_ENV_KEYS,
];

let pool;
let stripe;
const saved = {};

const resetAll = () => {
    resetPoolForTests();
    resetDailyCapsForTests();
    resetPlanCacheForTests();
    resetAiAccessForTests();
    resetBillingAlertsForTests();
    resetGatewayForTests();
};

beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'production';
    resetAll();
    pool = seedPool();
    setPoolForTests(pool);
    stripe = createFakeStripe();
    setStripeFetchForTests(stripe.fetch);
    setSupabaseForTests({ auth: { getUser: async (token) => ({ data: { user: USERS[token] ?? null }, error: null }) } });
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    setStripeFetchForTests(null);
    setSupabaseForTests(null);
    resetAll();
});

const withApp = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    try {
        await listen(app, handler, '/api/v2');
    } finally {
        console.error = error;
        console.warn = warn;
    }
};

describe('/api/v2/billing on the server.js stack', () => {
    it('billing off: GET /plan says so publicly, every other route is 404 billing_off after auth', async () => {
        await withApp(async (api) => {
            const plan = await call(`${api}/billing/plan`);
            assert.equal(plan.status, 200);
            assert.deepEqual(plan.json, { serviceable: false, salesOpen: false });
            assert.equal(plan.headers.get('cache-control'), 'no-store');
            assert.equal((await call(`${api}/billing/me`)).status, 401, 'requireAuth first');
            for (const [method, route] of [['GET', 'me'], ['POST', 'checkout'], ['POST', 'portal'], ['POST', 'sync']]) {
                const result = await call(`${api}/billing/${route}`, { method, headers: as('alice'), body: method === 'POST' ? {} : undefined });
                assert.equal(result.status, 404, route);
                assert.equal(result.json.error_type, 'billing_off', route);
            }
        });
        assert.equal(stripe.requests.length, 0);
    });

    it('GET /plan in test mode: the plan as enforced, the disclosure and terms, but no sales to the public', async () => {
        Object.assign(process.env, BILLING_ENV, { AI_CAP_USER_LLM: '40', BILLING_TOS_URL: `${ORIGIN}/terms` });
        await withApp(async (api) => {
            const { status, json } = await call(`${api}/billing/plan`);
            assert.equal(status, 200);
            assert.equal(json.serviceable, true);
            assert.equal(json.salesOpen, false, 'test mode sells to nobody publicly');
            assert.equal(json.mode, 'test');
            assert.equal(json.plan.priceJpy, 500);
            assert.equal(json.plan.yearlyJpy, 6000);
            assert.equal(json.plan.interval, 'month');
            assert.deepEqual(json.plan.caps, { llm: 100, course_generation: 30 });
            assert.deepEqual(json.plan.freeCaps, { llm: 40, course_generation: 20 }, 'from env');
            assert.equal(json.plan.resetsAt, '00:00 JST');
            assert.deepEqual(json.plan.uses.llm.jp, ['AI チューター', '作文フィードバック', '診断の解説']);
            assert.match(json.plan.quantity.llm.jp, /1 日 100 回/);
            assert.equal(json.plan.name.jp, 'サポータープラン');
            assert.ok(json.disclosure.rows.some((r) => r.key === 'conditions'));
            assert.match(json.terms.cancellation.jp, /次の更新日より前に/);
            assert.equal(json.termsUrl, `${ORIGIN}/terms`);
            assert.deepEqual(json.problems, []);
            assert.ok(!JSON.stringify(json).includes(BILLING_ENV.STRIPE_SECRET_KEY) && !JSON.stringify(json).includes('whsec_'), 'no secret');
        });
    });

    it('auth: no token, the dev fallback, PHASE1_USER_ID, an anonymous user and an agent token are refused', async () => {
        Object.assign(process.env, BILLING_ENV);
        await withApp(async (api) => {
            assert.equal((await call(`${api}/billing/me`)).status, 401);
            for (const who of ['phase1', 'anon']) {
                const result = await call(`${api}/billing/me`, { headers: as(who) });
                assert.equal(result.status, 401, who);
                assert.equal(result.json.error_type, 'sign_in_required', who);
            }
            const agent = await call(`${api}/billing/checkout`, { method: 'POST', headers: { Authorization: `Bearer ${AGENT_TOKEN}` }, body: {} });
            assert.equal(agent.status, 401);
            assert.equal(agent.json.error_type, 'oauth_client_token');
        });
        process.env.NODE_ENV = 'development';
        await withApp(async (api) => {
            const fallback = await call(`${api}/billing/checkout`, { method: 'POST', body: {} });
            assert.equal(fallback.status, 401, 'the dev fallback user cannot buy');
            assert.equal(fallback.json.error_type, 'sign_in_required');
        });
        assert.equal(stripe.requests.length, 0);
    });

    it('test mode: everyone but the testers sees no paid service, even with a test subscription row (C1/C31/C42)', async () => {
        Object.assign(process.env, BILLING_ENV);
        pool.customers.set('cus_bob', { stripe_customer_id: 'cus_bob', user_id: BOB, livemode: false });
        pool.subscriptions.set('sub_bob', {
            stripe_subscription_id: 'sub_bob', stripe_customer_id: 'cus_bob', user_id: BOB, status: 'active', price_id: 'price_supporter', livemode: false,
            current_period_start: new Date(Date.now() - 86400000), current_period_end: new Date(Date.now() + 20 * 86400000),
            cancel_at_period_end: false, cancel_at: null, canceled_at: null, stripe_created: new Date(), synced_at: new Date(),
        });
        await withApp(async (api) => {
            const me = await call(`${api}/billing/me`, { headers: as('bob') });
            assert.equal(me.status, 200);
            assert.deepEqual(me.json, { plan: 'free', eligibility: 'unavailable', salesOpen: false, subscription: null, hasCustomer: false, usage: null });
            for (const route of ['checkout', 'portal', 'sync']) {
                const result = await call(`${api}/billing/${route}`, { method: 'POST', headers: as('bob'), body: {} });
                assert.equal(result.status, 404, route);
                assert.equal(result.json.error_type, 'billing_off', route);
            }
            const { handle } = await reserveDailyCapFor({ kind: 'llm', userId: BOB });
            assert.ok(handle);
        });
        assert.deepEqual(pool.charged().filter(([, s]) => s.startsWith('*')), [['llm', '*']], 'the non-tester is charged as free');
        assert.equal(stripe.requests.length, 0);
    });

    it('eligibility: no age, a minor and a paused adult cannot start a checkout (403 with the reason)', async () => {
        Object.assign(process.env, BILLING_ENV);
        await withApp(async (api) => {
            for (const [who, type] of [['noage', 'age_required'], ['mina', 'adults_only'], ['pausy', 'paused']]) {
                const result = await call(`${api}/billing/checkout`, { method: 'POST', headers: as(who), body: { locale: 'jp' } });
                assert.equal(result.status, 403, who);
                assert.equal(result.json.error_type, type, who);
                const me = await call(`${api}/billing/me`, { headers: as(who) });
                assert.equal(me.json.eligibility, type, `${who} /me`);
                if (type === 'paused') {
                    assert.ok(result.json.paused_until && me.json.pausedUntil, 'when the pause ends');
                }
            }
            const alice = await call(`${api}/billing/me`, { headers: as('alice') });
            assert.equal(alice.json.eligibility, 'ok');
        });
        assert.equal(stripe.requests.length, 0);
    });

    it('sales closed (BILLING_ENABLED not "true"): checkout 404, but /me, /portal and /sync keep working (C2)', async () => {
        Object.assign(process.env, BILLING_ENV, { BILLING_ENABLED: 'false' });
        pool.customers.set('cus_alice', { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false });
        await withApp(async (api) => {
            const checkout = await call(`${api}/billing/checkout`, { method: 'POST', headers: as('alice'), body: { locale: 'jp' } });
            assert.equal(checkout.status, 404);
            assert.equal(checkout.json.error_type, 'billing_off');
            const me = await call(`${api}/billing/me`, { headers: as('alice') });
            assert.equal(me.status, 200);
            assert.equal(me.json.salesOpen, false);
            assert.equal(me.json.hasCustomer, true);
            assert.equal((await call(`${api}/billing/portal`, { method: 'POST', headers: as('alice'), body: { locale: 'en' } })).status, 200);
            assert.equal((await call(`${api}/billing/sync`, { method: 'POST', headers: as('alice') })).status, 200);
        });
    });

    it('a sales problem other than "closed" is 503 billing_misconfigured', async () => {
        Object.assign(process.env, BILLING_ENV, { AI_CAP_USER_LLM: '100' });
        await withApp(async (api) => {
            const result = await call(`${api}/billing/checkout`, { method: 'POST', headers: as('alice'), body: { locale: 'jp' } });
            assert.equal(result.status, 503);
            assert.equal(result.json.error_type, 'billing_misconfigured');
            assert.deepEqual((await call(`${api}/billing/plan`)).json.problems, ['supporter_caps_not_above_free:llm']);
        });
    });

    it('a checkout on the stack: one Customer, a Session, the URL; the JSON body is parsed', async () => {
        Object.assign(process.env, BILLING_ENV);
        await withApp(async (api) => {
            const bad = await call(`${api}/billing/checkout`, { method: 'POST', headers: as('alice'), body: { locale: 'fr' } });
            assert.equal(bad.status, 400);
            assert.equal(bad.json.error_type, 'validation');
            const result = await call(`${api}/billing/checkout`, { method: 'POST', headers: as('alice'), body: { locale: 'jp' } });
            assert.equal(result.status, 200, result.text);
            assert.match(result.json.url, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
            assert.deepEqual(Object.keys(result.json), ['url']);
        });
        const [customer] = stripe.calls(/POST \/v1\/customers/);
        assert.equal(customer.rawBody, `metadata[user_id]=${ALICE}`, 'no email or name');
        assert.equal(customer.headers['idempotency-key'], `customer:test:${ALICE}`);
        assert.equal([...pool.customers.values()].filter((c) => c.user_id === ALICE).length, 1);
    });

    it('/me: the plan, the subscription summary, the customer flag and today\'s usage with the plan\'s limits', async () => {
        Object.assign(process.env, BILLING_ENV);
        pool.customers.set('cus_alice', { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false });
        const end = new Date(Date.now() + 20 * 86400000);
        pool.subscriptions.set('sub_a', {
            stripe_subscription_id: 'sub_a', stripe_customer_id: 'cus_alice', user_id: ALICE, status: 'active', price_id: 'price_supporter', livemode: false,
            current_period_start: new Date(Date.now() - 86400000), current_period_end: end, cancel_at_period_end: false, cancel_at: end,
            canceled_at: null, stripe_created: new Date(), synced_at: new Date(),
        });
        await withApp(async (api) => {
            await reserveDailyCapFor({ kind: 'llm', userId: ALICE });
            const me = await call(`${api}/billing/me`, { headers: as('alice') });
            assert.equal(me.status, 200, me.text);
            assert.deepEqual(me.json, {
                plan: 'supporter',
                eligibility: 'ok',
                salesOpen: true,
                subscription: { status: 'active', currentPeriodEnd: end.toISOString(), endsAt: end.toISOString(), cancelAtPeriodEnd: false, canceledAt: null },
                hasCustomer: true,
                usage: { llm: { used: 1, limit: 100 }, course_generation: { used: 0, limit: 30 } },
            });
        });
    });

    it('a minor with a subscription: /me shows it (so the page offers the portal), the portal works without eligibility, the owner is alerted (C5/C23/C32)', async () => {
        Object.assign(process.env, BILLING_ENV);
        pool.customers.set('cus_mina', { stripe_customer_id: 'cus_mina', user_id: MINA, livemode: false });
        pool.subscriptions.set('sub_m', {
            stripe_subscription_id: 'sub_m', stripe_customer_id: 'cus_mina', user_id: MINA, status: 'active', price_id: 'price_supporter', livemode: false,
            current_period_start: new Date(Date.now() - 86400000), current_period_end: new Date(Date.now() + 20 * 86400000),
            cancel_at_period_end: false, cancel_at: null, canceled_at: null, stripe_created: new Date(), synced_at: new Date(),
        });
        const lines = [];
        const { error } = console;
        await withApp(async (api) => {
            console.error = (l) => lines.push(String(l));
            const me = await call(`${api}/billing/me`, { headers: as('mina') });
            assert.equal(me.json.plan, 'free');
            assert.equal(me.json.eligibility, 'adults_only');
            assert.equal(me.json.subscription.status, 'active');
            const portal = await call(`${api}/billing/portal`, { method: 'POST', headers: as('mina'), body: { locale: 'jp' } });
            assert.equal(portal.status, 200, portal.text);
            assert.match(portal.json.url, /^https:\/\/billing\.stripe\.com\//);
            console.error = error;
        });
        assert.ok(lines.some((l) => l.includes('minor_with_subscription')), lines.join('\n'));
        const [session] = stripe.state.portalSessions;
        assert.deepEqual([session.customer, session.return_url, session.locale], ['cus_mina', `${ORIGIN}/settings/plan`, 'ja']);
    });

    it('/portal needs a Customer in this mode; /sync without one calls nobody, with one re-reads every subscription', async () => {
        Object.assign(process.env, BILLING_ENV);
        await withApp(async (api) => {
            const portal = await call(`${api}/billing/portal`, { method: 'POST', headers: as('alice'), body: { locale: 'jp' } });
            assert.equal(portal.status, 404);
            assert.equal(portal.json.error_type, 'no_customer');
            assert.deepEqual((await call(`${api}/billing/sync`, { method: 'POST', headers: as('alice') })).json, { ok: true, synced: 0 });
            assert.equal(stripe.requests.length, 0);

            pool.customers.set('cus_alice', { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false });
            stripe.putSubscription(subscription({ id: 'sub_a', customer: 'cus_alice', start: Math.floor(Date.now() / 1000) - 86400 }));
            stripe.putSubscription(subscription({ id: 'sub_b', customer: 'cus_alice', status: 'canceled', start: Math.floor(Date.now() / 1000) - 90 * 86400 }));
            assert.deepEqual((await call(`${api}/billing/sync`, { method: 'POST', headers: as('alice') })).json, { ok: true, synced: 2 });
            assert.equal(pool.subscriptions.get('sub_a').status, 'active');
            assert.equal((await call(`${api}/billing/me`, { headers: as('alice') })).json.plan, 'supporter');
        });
        assert.deepEqual(stripe.requests.map((r) => `${r.method} ${r.path}`), ['GET /v1/subscriptions', 'GET /v1/subscriptions/sub_a', 'GET /v1/subscriptions/sub_b']);
    });

    it('a test-mode Customer never serves a live checkout (one row per user and mode, C6/C17/C46)', async () => {
        Object.assign(process.env, BILLING_ENV, { STRIPE_SECRET_KEY: ['rk', 'live', 'routekey1'].join('_'), BILLING_LIVE: 'true', BILLING_TOS_URL: `${ORIGIN}/terms` });
        pool.customers.set('cus_test_alice', { stripe_customer_id: 'cus_test_alice', user_id: ALICE, livemode: false });
        await withApp(async (api) => {
            const portal = await call(`${api}/billing/portal`, { method: 'POST', headers: as('bob'), body: {} });
            assert.equal(portal.json.error_type, 'no_customer', 'live mode serves everyone (no testers), but Bob has no live Customer');
            assert.equal((await call(`${api}/billing/portal`, { method: 'POST', headers: as('alice'), body: {} })).json.error_type, 'no_customer');
            const checkout = await call(`${api}/billing/checkout`, { method: 'POST', headers: as('alice'), body: {} });
            assert.equal(checkout.status, 503, 'live sales stay closed while the disclosure has placeholders');
            assert.equal(checkout.json.error_type, 'billing_misconfigured');
        });
    });

    it(`limits each route to ${BILLING_REQUESTS_PER_MINUTE} requests a minute per learner`, async () => {
        Object.assign(process.env, BILLING_ENV);
        await withApp(async (api) => {
            for (let i = 0; i < BILLING_REQUESTS_PER_MINUTE; i += 1) {
                assert.equal((await call(`${api}/billing/sync`, { method: 'POST', headers: as('alice') })).status, 200, `request ${i + 1}`);
            }
            const limited = await call(`${api}/billing/sync`, { method: 'POST', headers: as('alice') });
            assert.equal(limited.status, 429);
            assert.equal(limited.json.error_type, 'rate_limited');
            for (const spelling of ['sync/', 'SYNC', 'Sync/']) {
                const variant = await call(`${api}/billing/${spelling}`, { method: 'POST', headers: as('alice') });
                assert.equal(variant.status, 429, `${spelling}: Express routes it to /sync, so it shares the bucket`);
            }
            assert.equal((await call(`${api}/billing/sync`, { method: 'POST', headers: as('mina') })).status, 200, 'per learner');
            assert.equal((await call(`${api}/billing/me`, { headers: as('alice') })).status, 200, 'per route');
        });
    });

    it('a supporter gets the supporter caps on /llm and /ai/generate through the shared daily caps (C7/C19)', async () => {
        Object.assign(process.env, BILLING_ENV, { AI_CAP_USER_LLM: '1', AI_CAP_USER_COURSE_GENERATION: '1', LLM_PROVIDER: 'mock', LLM_MOCK_DELAY_MS: '0' });
        pool.customers.set('cus_alice', { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false });
        pool.subscriptions.set('sub_a', {
            stripe_subscription_id: 'sub_a', stripe_customer_id: 'cus_alice', user_id: ALICE, status: 'active', price_id: 'price_supporter', livemode: false,
            current_period_start: new Date(Date.now() - 86400000), current_period_end: new Date(Date.now() + 20 * 86400000),
            cancel_at_period_end: false, cancel_at: null, canceled_at: null, stripe_created: new Date(), synced_at: new Date(),
        });
        const FEEDBACK = { text: 'I want to learn React because I want to build my own apps for my team.', rubric: { clarity: 'State the goal', linking: 'Use because/so', tone: 'Confident' }, locale: 'en' };
        await withApp(async (api) => {
            for (let i = 0; i < 2; i += 1) {
                const result = await call(`${api}/llm/writing-feedback`, { method: 'POST', headers: as('alice'), body: FEEDBACK });
                assert.equal(result.status, 200, `writing feedback ${i + 1} over the free cap of 1: ${result.text.slice(0, 200)}`);
            }
            await call(`${api}/ai/generate`, { method: 'POST', headers: as('alice'), body: { stage: 'requirements' } });
            const bob = await call(`${api}/llm/writing-feedback`, { method: 'POST', headers: as('bob'), body: FEEDBACK });
            assert.equal(bob.status, 200);
            const bobAgain = await call(`${api}/llm/writing-feedback`, { method: 'POST', headers: as('bob'), body: FEEDBACK });
            assert.equal(bobAgain.status, 429);
            assert.equal(bobAgain.json.plan, 'free');
        });
        const charges = pool.queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage')).map((q) => q.params.slice(1));
        assert.deepEqual(charges.filter(([, subject]) => subject === ALICE || subject === '*supporter'), [
            ['llm', ALICE, 100], ['llm', '*supporter', 1000],
            ['llm', ALICE, 100], ['llm', '*supporter', 1000],
            ['course_generation', ALICE, 30], ['course_generation', '*supporter', 200],
        ]);
        assert.deepEqual(charges.filter(([, subject]) => subject === BOB || subject === '*'), [['llm', BOB, 1], ['llm', '*', 1500], ['llm', BOB, 1]]);
    });
});

describe('POST /checkout (the router, with a moving clock)', () => {
    /** @param {{ env?: object, ownerFacts?: object, at?: number }} [options] */
    const setup = ({ env = {}, ownerFacts, at = Date.parse('2026-10-23T03:00:10Z') } = {}) => {
        const config = readBillingConfig({ ...BILLING_ENV, ...env }, { nodeEnv: 'production', ...(ownerFacts ? { ownerFacts } : {}) });
        const clock = { now: at };
        stripe = createFakeStripe({ now: () => clock.now });
        const client = createStripeClient({ secretKey: config.secretKey, fetch: stripe.fetch, logger: quiet });
        const lines = [];
        const logger = { warn: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
        const alerts = createBillingAlerts({ env: {}, logger, now: () => clock.now });
        const app = express();
        app.use(express.json());
        app.use('/billing', createBillingRouter({ config, stripe: client, now: () => clock.now, env: {}, alerts, logger }));
        const run = (handler) => listen(app, handler, '/billing');
        const checkout = (base, who = 'alice', locale = 'jp') => call(`${base}/checkout`, { method: 'POST', headers: as(who), body: { locale } });
        return { config, clock, run, checkout, lines };
    };
    const sessions = () => stripe.calls(/POST \/v1\/checkout\/sessions$/);

    it('sends exactly the designed parameters, a pure function of the key (C25/C37/C40/C45)', async () => {
        const { run, checkout, clock } = setup({ env: { BILLING_TOS_URL: `${ORIGIN}/terms` } });
        await run(async (base) => {
            const result = await checkout(base, 'alice', 'en');
            assert.equal(result.status, 200, result.text);
        });
        const bucket = Math.floor(clock.now / 60000) * 60;
        const [req] = sessions();
        assert.equal(req.headers['idempotency-key'], `checkout:test:${ALICE}:en:${bucket}`);
        const form = Object.fromEntries(req.form.entries());
        const customer = [...pool.customers.values()].find((c) => c.user_id === ALICE).stripe_customer_id;
        const message = form['custom_text[submit][message]'];
        delete form['custom_text[submit][message]'];
        assert.deepEqual(form, {
            mode: 'subscription',
            customer,
            'line_items[0][price]': 'price_supporter',
            'line_items[0][quantity]': '1',
            client_reference_id: ALICE,
            'subscription_data[metadata][user_id]': ALICE,
            success_url: `${ORIGIN}/settings/plan?checkout=done`,
            cancel_url: `${ORIGIN}/settings/plan/confirm`,
            locale: 'en',
            expires_at: String(bucket + 32 * 60),
            submit_type: 'subscribe',
            'adaptive_pricing[enabled]': 'false',
            'consent_collection[terms_of_service]': 'required',
        });
        assert.ok(message.length <= CHECKOUT_TEXT_MAX);
        assert.ok(message.includes(`${ORIGIN}/legal/commerce`));
        assert.match(message, /up to 100 a day/);
        assert.ok(!req.rawBody.includes('email'), 'no email');
    });

    it('a second click in the same minute replays the same Session (identical bytes); a new minute expires the old one', async () => {
        const { run, checkout, clock } = setup();
        await run(async (base) => {
            const first = await checkout(base);
            clock.now += 40_000; // 03:00:50, same minute
            const second = await checkout(base);
            assert.equal(second.status, 200, second.text);
            assert.equal(second.json.url, first.json.url, 'the replay returns the first Session');
            const [a, b] = sessions();
            assert.equal(a.rawBody, b.rawBody, 'byte-identical parameters');
            assert.equal(a.headers['idempotency-key'], b.headers['idempotency-key']);
            assert.equal(stripe.state.sessions.size, 1);
            assert.equal(stripe.calls(/expire$/).length, 0, 'the current minute\'s Session is never expired');

            const en = await checkout(base, 'alice', 'en');
            assert.notEqual(en.json.url, first.json.url, 'another locale is another key');
            assert.equal(stripe.calls(/expire$/).length, 1, "this minute's Session in another locale is expired: one payable Session at a time");
            assert.deepEqual([...stripe.state.sessions.values()].map((s) => s.status), ['expired', 'open']);

            clock.now += 30_000; // next minute
            const third = await checkout(base);
            assert.notEqual(third.json.url, first.json.url);
            assert.equal(stripe.calls(/expire$/).length, 2, 'both older open Sessions are expired (C24)');
            assert.deepEqual([...stripe.state.sessions.values()].map((s) => s.status), ['expired', 'expired', 'open']);
        });
        assert.equal(stripe.calls(/POST \/v1\/customers/).length, 1, 'one Customer');
    });

    for (const [label, failure, status] of [['a timeout', 'timeout', 503], ['a 5xx', { status: 500 }, 502]]) {
        it(`an older Session that cannot be expired (${label}) stops the checkout: never two payable Sessions (C24)`, async () => {
            const { run, checkout, clock } = setup();
            await run(async (base) => {
                assert.equal((await checkout(base)).status, 200);
                clock.now += 60_000; // next minute
                stripe.fail(/expire$/, failure);
                const second = await checkout(base);
                assert.equal(second.status, status, second.text);
            });
            assert.equal(sessions().length, 1, 'no second Session is created');
            assert.deepEqual([...stripe.state.sessions.values()].map((s) => s.status), ['open']);
        });
    }

    it('a Session that completes while checkout runs is seen by the subscription check: 409, no new Session', async () => {
        const { run, checkout, clock } = setup();
        await run(async (base) => {
            assert.equal((await checkout(base)).status, 200);
            const [first] = [...stripe.state.sessions.values()];
            clock.now += 60_000;
            // The learner pays in the first tab just as the second checkout lists the open Sessions.
            stripe.onRequest(/expire$/, () => {
                first.status = 'complete';
                const created = Math.floor(clock.now / 1000);
                stripe.putSubscription(subscription({ id: 'sub_paid', customer: first.customer, status: 'active', created, start: created }));
            });
            const second = await checkout(base);
            assert.equal(second.status, 409, second.text);
            assert.equal(second.json.error_type, 'already_subscribed');
        });
        assert.equal(sessions().length, 1);
    });

    it('two concurrent clicks are serialized per learner and get one Session', async () => {
        const { run, checkout } = setup();
        await run(async (base) => {
            const [a, b] = await Promise.all([checkout(base), checkout(base)]);
            assert.equal(a.status, 200);
            assert.equal(a.json.url, b.json.url);
        });
        assert.equal(stripe.calls(/POST \/v1\/customers/).length, 1);
        assert.equal(stripe.state.sessions.size, 1);
    });

    it('a Customer created by a racing process wins: ON CONFLICT DO NOTHING, then the stored id is used', async () => {
        const { run, checkout } = setup();
        pool.hooks.beforeInsertCustomer = ([, userId, livemode]) => {
            pool.customers.set('cus_other_process', { stripe_customer_id: 'cus_other_process', user_id: userId, livemode });
        };
        await run(async (base) => {
            assert.equal((await checkout(base)).status, 200);
        });
        const inserts = pool.queries.filter((q) => q.sql === SQL.insertCustomer);
        assert.equal(inserts.length, 1);
        assert.equal(inserts[0].params[0].startsWith('cus_fake'), true);
        assert.equal(sessions()[0].form.get('customer'), 'cus_other_process');
        assert.equal(pool.customers.has(inserts[0].params[0]), false, 'the orphan Stripe Customer is not stored');
    });

    it('409 already_subscribed from a fresh Stripe read: active, trialing, past_due, unpaid, paused, or incomplete under 23 h (C16/C34)', async () => {
        for (const [status, createdAgoH, blocks] of [
            ['active', 100, true], ['trialing', 100, true], ['past_due', 100, true], ['unpaid', 100, true], ['paused', 100, true],
            ['incomplete', 22, true], ['incomplete', 24, false], ['incomplete_expired', 1, false], ['canceled', 1, false],
        ]) {
            resetPlanCacheForTests();
            pool = seedPool({ customers: [{ stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false }] });
            setPoolForTests(pool);
            const { run, checkout, clock } = setup();
            const created = Math.floor(clock.now / 1000) - createdAgoH * 3600;
            stripe.putSubscription(subscription({ id: 'sub_x', customer: 'cus_alice', status, created, start: created }));
            await run(async (base) => {
                const result = await checkout(base);
                assert.equal(result.status, blocks ? 409 : 200, `${status} ${createdAgoH} h`);
                if (blocks) {
                    assert.equal(result.json.error_type, 'already_subscribed');
                    assert.equal(result.json.status, status);
                }
            });
            assert.equal(pool.subscriptions.get('sub_x').status, status, 'the read was stored');
            assert.equal(sessions().length, blocks ? 0 : 1);
        }
        assert.ok(SUBSCRIPTION_STATUSES.includes('paused'));
    });

    it('a subscription on a price that is not accepted does not block (it alerts)', async () => {
        pool.customers.set('cus_alice', { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false });
        const { run, checkout, lines } = setup();
        stripe.putSubscription(subscription({ id: 'sub_donation', customer: 'cus_alice', price: 'price_donation' }));
        await run(async (base) => {
            assert.equal((await checkout(base)).status, 200);
        });
        assert.ok(lines.some((l) => l.includes('unknown_price')));
    });

    it('a Price that does not match the plan is 503 billing_misconfigured, and nothing is created (C26)', async () => {
        for (const price of [
            goodPrice({ unit_amount: 980 }),
            goodPrice({ currency: 'usd' }),
            goodPrice({ currency_options: { jpy: {}, usd: { unit_amount: 4 } } }),
            goodPrice({ tax_behavior: 'exclusive' }),
            goodPrice({ tax_behavior: 'unspecified' }),
            goodPrice({ recurring: { interval: 'year', interval_count: 1 } }),
            goodPrice({ recurring: { interval: 'month', interval_count: 3 } }),
            goodPrice({ active: false }),
            goodPrice({ type: 'one_time', recurring: null }),
            goodPrice({ livemode: true }),
        ]) {
            const { run, checkout, lines } = setup();
            stripe.state.prices.set('price_supporter', price);
            await run(async (base) => {
                const result = await checkout(base);
                assert.equal(result.status, 503, JSON.stringify(price).slice(0, 120));
                assert.equal(result.json.error_type, 'billing_misconfigured');
            });
            assert.equal(stripe.calls(/POST/).length, 0);
            assert.ok(lines.some((l) => l.includes('STRIPE_PRICE_ID does not match the plan')));
        }
    });

    it('the Price check is cached for 10 minutes', async () => {
        const { run, checkout, clock } = setup();
        await run(async (base) => {
            await checkout(base);
            clock.now += 9 * 60_000;
            await checkout(base);
            clock.now += 2 * 60_000;
            await checkout(base);
        });
        assert.equal(stripe.calls(/GET \/v1\/prices/).length, 2);
    });

    it('live sales open once the disclosure is filled and the terms URL is set; anyone may buy', async () => {
        const { run, checkout } = setup({
            env: { STRIPE_SECRET_KEY: ['rk', 'live', 'routekey1'].join('_'), BILLING_LIVE: 'true', BILLING_TEST_USER_IDS: '', BILLING_TOS_URL: `${ORIGIN}/terms` },
            ownerFacts: FILLED,
        });
        stripe.state.prices.set('price_supporter', goodPrice({ livemode: true }));
        await run(async (base) => {
            const result = await checkout(base, 'bob');
            assert.equal(result.status, 200, result.text);
            const plan = await call(`${base}/plan`);
            assert.equal(plan.json.salesOpen, true);
            assert.equal(plan.json.mode, 'live');
        });
        assert.equal(sessions()[0].headers['idempotency-key'].split(':')[1], 'live');
        assert.equal([...pool.customers.values()].find((c) => c.user_id === BOB).livemode, true);
    });

    it("Stripe failures answer fixed error types, never Stripe's text; the database failing is 503", async () => {
        const { run, checkout } = setup();
        await run(async (base) => {
            stripe.fail(/prices/, { status: 401, type: 'invalid_request_error', message: 'Invalid API Key provided: rk_test_****' }, { once: true });
            const refused = await checkout(base);
            assert.equal(refused.status, 502);
            assert.deepEqual(Object.keys(refused.json).sort(), ['error', 'error_type']);
            assert.equal(refused.json.error_type, 'payment_provider_error');
            assert.ok(!refused.text.includes('Invalid API Key'));
            stripe.fail(/prices/, 'network', { once: true });
            assert.equal((await checkout(base)).json.error_type, 'payment_provider_unavailable');
            pool.failOn(/billing_customers/);
            const db = await checkout(base);
            assert.equal(db.status, 503);
            assert.equal(db.json.error_type, 'billing_unavailable');
            assert.ok(!db.text.includes('db.internal'));
        });
    });
});

describe('017_billing.sql', () => {
    const sql = readFileSync(new URL('../migrations/017_billing.sql', import.meta.url), 'utf8')
        .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    const lower = sql.replace(/\s+/g, ' ').toLowerCase();

    it('customers: one per Stripe id, one per user and mode; SET NULL on account deletion', () => {
        assert.match(lower, /create table if not exists billing_customers \( stripe_customer_id text primary key check \(length\(stripe_customer_id\) between 1 and 255\), user_id uuid null references auth\.users\(id\) on delete set null, livemode boolean not null, created_at timestamptz not null default now\(\), unique \(user_id, livemode\) \);/);
    });

    it('subscriptions: the status CHECK lists exactly the statuses billingSync stores; periods from the items; synced_at; the index', () => {
        const statuses = /status\s+text\s+NOT NULL CHECK \(status IN \(([^)]+)\)\)/.exec(sql);
        assert.ok(statuses);
        assert.deepEqual(statuses[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...SUBSCRIPTION_STATUSES]);
        for (const column of [
            'stripe_subscription_id text primary key check (length(stripe_subscription_id) between 1 and 255)',
            'stripe_customer_id text not null check (length(stripe_customer_id) between 1 and 255)',
            'user_id uuid null references auth.users(id) on delete set null',
            'price_id text null check (price_id is null or length(price_id) between 1 and 255)',
            'livemode boolean not null', 'current_period_start timestamptz null', 'current_period_end timestamptz null',
            'cancel_at_period_end boolean not null default false', 'cancel_at timestamptz null', 'canceled_at timestamptz null',
            'stripe_created timestamptz null', 'synced_at timestamptz not null',
        ]) assert.ok(lower.includes(column), column);
        assert.match(lower, /create index if not exists billing_subscriptions_user_idx on billing_subscriptions \(user_id, livemode\);/);
        assert.match(lower, /create trigger billing_subscriptions_updated_at before update on billing_subscriptions for each row execute function set_updated_at\(\); exception when duplicate_object then null;/);
    });

    it('events: one row per event id; ids are bounded by length, not by a regex (C27); no RLS, no grants, no sequences', () => {
        assert.match(lower, /create table if not exists billing_events \( event_id text primary key check \(length\(event_id\) between 1 and 255\), type text not null check \(length\(type\) between 1 and 255\), livemode boolean not null, received_at timestamptz not null default now\(\), processed_at timestamptz null, outcome text null/);
        assert.doesNotMatch(lower, / ~ /, 'no regex CHECK');
        assert.doesNotMatch(lower, /row level security|grant |serial|sequence|identity|on delete cascade/);
        const role = readFileSync(new URL('../../deploy/risepath-vm/sql/mcp_remote_role.sql', import.meta.url), 'utf8');
        assert.doesNotMatch(role, /billing_/, 'the remote MCP role gets nothing');
    });

    it('is listed in the migrations README chain', () => {
        const readme = readFileSync(new URL('../migrations/README.md', import.meta.url), 'utf8');
        assert.match(readme, /\| `017_billing\.sql` \|/);
    });
});
