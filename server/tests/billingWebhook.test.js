// Stripe's webhook (server/services/billingWebhook.js at POST /api/v2/billing/webhook). The
// signature check, with expected headers computed here with createHmac and the whole whsec_ string
// (never the module's own helper); then on the real server.js stack: the raw body survives the
// global JSON parser, the request is logged and counted by the global limiter, the requireAuth
// catch-all does not catch it, 503 while billing is not serviceable, dedupe, the mode check, each
// event type, the owner alerts, and 500 leaving a failed event unprocessed for Stripe's retry.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { resetDailyCapsForTests } from '../middleware/dailyCaps.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { BILLING_ENV_KEYS } from '../services/billingConfig.js';
import { resetBillingAlertsForTests } from '../services/billingAlerts.js';
import { resetPlanCacheForTests } from '../services/billingEntitlement.js';
import { setStripeFetchForTests } from '../services/stripeClient.js';
import { BILLING_WEBHOOK_PATH, subscriptionIdOf, verifyStripeSignature } from '../services/billingWebhook.js';
import { createBillingPool, SQL } from './helpers/billingPool.js';
import { createFakeStripe, subscription } from './helpers/fakeStripe.js';

const SECRET = 'whsec_test_secret_a';
const SECRET_NEW = 'whsec_test_secret_b';
const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';

/** Stripe's v1 signature, computed independently: HMAC-SHA256 keyed with the whole whsec_ string. */
const v1 = (raw, secret, t) => createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
const header = (raw, secret, t, extra = '') => `t=${t},v1=${v1(raw, secret, t)}${extra}`;

describe('verifyStripeSignature', () => {
    const raw = Buffer.from('{"id":"evt_1","object":"event"}');
    const now = Date.parse('2026-10-23T03:00:00Z');
    const t = Math.floor(now / 1000);
    const verify = (h, secrets = [SECRET], options = {}) => verifyStripeSignature(raw, h, secrets, { now, ...options });

    it('accepts a valid v1 signature made with the whole whsec_ string', () => {
        assert.deepEqual(verify(header(raw, SECRET, t)), { ok: true, timestamp: t });
        assert.deepEqual(verify(` t=${t} , v1=${v1(raw, SECRET, t)} `), { ok: true, timestamp: t }, 'spaces around parts');
        const stripped = createHmac('sha256', SECRET.slice('whsec_'.length)).update(`${t}.`).update(raw).digest('hex');
        assert.equal(verify(`t=${t},v1=${stripped}`).reason, 'mismatch', 'a key without the whsec_ prefix is not Stripe\'s scheme');
    });

    it('refuses a wrong secret and an altered body', () => {
        assert.equal(verify(header(raw, 'whsec_other_secret', t)).reason, 'mismatch');
        assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_1","object":"event" }'), header(raw, SECRET, t), [SECRET], { now }).reason, 'mismatch');
    });

    it('rotation: any configured secret against any v1', () => {
        assert.equal(verify(header(raw, SECRET_NEW, t), [SECRET, SECRET_NEW]).ok, true);
        assert.equal(verify(`t=${t},v1=${v1(raw, 'whsec_x', t)},v1=${v1(raw, SECRET, t)}`, [SECRET_NEW, SECRET]).ok, true, 'several v1, the second matches');
    });

    it('ignores v0 and other schemes', () => {
        assert.equal(verify(`t=${t},v0=${v1(raw, SECRET, t)}`).reason, 'no_v1', 'a valid v0 alone is not accepted');
        assert.equal(verify(`t=${t},v0=${v1(raw, SECRET, t)},v1=${'0'.repeat(64)}`).reason, 'mismatch');
        assert.equal(verify(`t=${t},v1=${v1(raw, SECRET, t)},v0=deadbeef,v2=x`).ok, true);
    });

    it('5-minute tolerance both ways; 0 is never used', () => {
        assert.equal(verify(header(raw, SECRET, t - 300)).ok, true);
        assert.equal(verify(header(raw, SECRET, t - 301)).reason, 'too_old');
        assert.equal(verify(header(raw, SECRET, t + 300)).ok, true);
        assert.equal(verify(header(raw, SECRET, t + 301)).reason, 'too_new');
        assert.equal(verify(header(raw, SECRET, t - 200), [SECRET], { toleranceSec: 0 }).ok, true, 'a tolerance of 0 falls back to 300 s');
    });

    it('malformed headers and length mismatches are refused without throwing', () => {
        assert.equal(verify(undefined).reason, 'no_header');
        assert.equal(verify('').reason, 'no_header');
        assert.equal(verify(`v1=${v1(raw, SECRET, t)}`).reason, 'malformed', 'no t');
        assert.equal(verify(`t=${t},t=${t},v1=${v1(raw, SECRET, t)}`).reason, 'malformed', 't twice');
        assert.equal(verify(`t=abc,v1=${v1(raw, SECRET, t)}`).reason, 'malformed');
        assert.equal(verify(`t=${t}`).reason, 'no_v1');
        assert.equal(verify(`t=${t},v1=${v1(raw, SECRET, t).slice(0, 62)}`).reason, 'mismatch', 'shorter: no timingSafeEqual on unequal lengths');
        assert.equal(verify(`t=${t},v1=${v1(raw, SECRET, t)}00`).reason, 'mismatch', 'longer');
        assert.equal(verify(`t=${t},v1=zz${v1(raw, SECRET, t).slice(2)}`).reason, 'mismatch', 'not hex');
        assert.equal(verify(header(raw, SECRET, t), []).reason, 'no_secret');
        assert.equal(verifyStripeSignature(raw.toString(), header(raw, SECRET, t), [SECRET], { now }).ok, true, 'a string body is the same bytes');
    });
});

describe('subscriptionIdOf', () => {
    it('finds the subscription for each handled event type', () => {
        assert.equal(subscriptionIdOf({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_1' } } }), 'sub_1');
        assert.equal(subscriptionIdOf({ type: 'checkout.session.completed', data: { object: { subscription: { id: 'sub_2' } } } }), 'sub_2');
        for (const type of ['created', 'updated', 'deleted', 'paused', 'resumed']) {
            assert.equal(subscriptionIdOf({ type: `customer.subscription.${type}`, data: { object: { id: 'sub_3' } } }), 'sub_3');
        }
        assert.equal(subscriptionIdOf({ type: 'invoice.paid', data: { object: { parent: { subscription_details: { subscription: 'sub_4' } } } } }), 'sub_4');
        assert.equal(subscriptionIdOf({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_5' } } }), 'sub_5', 'pre-Basil field as a fallback');
        assert.equal(subscriptionIdOf({ type: 'customer.created', data: { object: { id: 'cus_1' } } }), null);
    });
});

describe('POST /api/v2/billing/webhook (server.js stack)', () => {
    const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'AI_CAP_ALERT_WEBHOOK_URL', ...BILLING_ENV_KEYS];
    const saved = {};
    let pool;
    let stripe;
    let logs;
    let restoreConsole;

    const enable = (overrides = {}) => Object.assign(process.env, {
        BILLING_ENABLED: 'true',
        BILLING_TEST_USER_IDS: ALICE,
        STRIPE_SECRET_KEY: ['rk', 'test', 'hookkey1'].join('_'),
        STRIPE_WEBHOOK_SECRET: `${SECRET},${SECRET_NEW}`,
        STRIPE_PRICE_ID: 'price_supporter',
        BILLING_RETURN_ORIGIN: 'https://app.example.org',
        ...overrides,
    });

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        resetPoolForTests();
        resetDailyCapsForTests();
        resetPlanCacheForTests();
        resetAiAccessForTests();
        resetBillingAlertsForTests();
        pool = createBillingPool({ customers: [{ stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false }], ages: { [ALICE]: '1990-01' } });
        setPoolForTests(pool);
        stripe = createFakeStripe();
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: Math.floor(Date.now() / 1000) - 86400 }));
        setStripeFetchForTests(stripe.fetch);
        setSupabaseForTests({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
        logs = [];
        const { log, warn, error } = console;
        console.log = (...a) => logs.push(a.join(' '));
        console.warn = (...a) => logs.push(a.join(' '));
        console.error = (...a) => logs.push(a.join(' '));
        restoreConsole = () => Object.assign(console, { log, warn, error });
    });

    afterEach(() => {
        restoreConsole();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setStripeFetchForTests(null);
        setSupabaseForTests(null);
        resetPoolForTests();
        resetDailyCapsForTests();
        resetPlanCacheForTests();
        resetAiAccessForTests();
        resetBillingAlertsForTests();
    });

    const withServer = async (handler) => {
        const app = await createApp({ serveStatic: false });
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
            await handler(`http://127.0.0.1:${server.address().port}${BILLING_WEBHOOK_PATH}`);
        } finally {
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    };

    /** POST an event (JSON text exactly as given), signed unless `signature` is passed. */
    const deliver = async (url, event, { secret = SECRET, signature, contentType = 'application/json', text } = {}) => {
        const raw = text ?? JSON.stringify(event, null, 1);
        const t = Math.floor(Date.now() / 1000);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': contentType, 'stripe-signature': signature ?? header(Buffer.from(raw), secret, t) },
            body: raw,
        });
        const body = await response.text();
        let json = null;
        try {
            json = JSON.parse(body);
        } catch {
            // not JSON
        }
        return { status: response.status, json, headers: response.headers };
    };
    const event = (id, type, object, livemode = false) => ({ id, object: 'event', type, livemode, data: { object } });

    it('verifies the exact bytes (raw parser before the JSON parser), is logged and counted by the global limiter, needs no JWT', async () => {
        enable();
        await withServer(async (url) => {
            const result = await deliver(url, event('evt_1', 'customer.subscription.updated', { id: 'sub_1' }));
            assert.equal(result.status, 200, JSON.stringify(result.json));
            assert.deepEqual(result.json, { received: true, outcome: 'synced' });
            assert.ok(result.headers.get('ratelimit-limit'), 'the global limiter ran');
            assert.equal(result.headers.get('cache-control'), 'no-store');
        });
        assert.ok(logs.some((l) => /POST \/api\/v2\/billing\/webhook 200 \d+ms/.test(l)), logs.join('\n'));
        assert.equal(pool.subscriptions.get('sub_1').status, 'active');
        assert.equal(pool.events.get('evt_1').outcome, 'synced');
        assert.ok(pool.events.get('evt_1').processed_at);
    });

    it('a body the raw parser did not read (another content type) is 400; a body over 512 kb is 413', async () => {
        enable();
        await withServer(async (url) => {
            const text = await deliver(url, event('evt_2', 'customer.subscription.updated', { id: 'sub_1' }), { contentType: 'text/plain' });
            assert.equal(text.status, 400);
            assert.equal(text.json.error_type, 'bad_request');
            const big = await deliver(url, null, { text: JSON.stringify({ id: 'evt_big', pad: 'x'.repeat(600 * 1024) }) });
            assert.equal(big.status, 413);
        });
        assert.equal(pool.events.size, 0);
    });

    it('503 billing_off while billing is not serviceable, so Stripe retries (never 404)', async () => {
        enable({ STRIPE_SECRET_KEY: '' });
        await withServer(async (url) => {
            const result = await deliver(url, event('evt_3', 'customer.subscription.updated', { id: 'sub_1' }));
            assert.equal(result.status, 503);
            assert.equal(result.json.error_type, 'billing_off');
            assert.ok(result.headers.get('retry-after'));
        });
        enable({ BILLING_ENABLED: 'false' });
        await withServer(async (url) => {
            assert.equal((await deliver(url, event('evt_4', 'customer.subscription.updated', { id: 'sub_1' }))).status, 200, 'sales closed: still served');
        });
    });

    it('400 bad_signature for a wrong secret or an altered body; the reason is logged only', async () => {
        enable();
        await withServer(async (url) => {
            const wrong = await deliver(url, event('evt_5', 'customer.subscription.updated', { id: 'sub_1' }), { secret: 'whsec_not_ours' });
            assert.equal(wrong.status, 400);
            assert.deepEqual(Object.keys(wrong.json).sort(), ['error', 'error_type']);
            assert.equal(wrong.json.error_type, 'bad_signature');
            const raw = JSON.stringify(event('evt_6', 'customer.subscription.updated', { id: 'sub_1' }));
            const t = Math.floor(Date.now() / 1000);
            const altered = await deliver(url, null, { text: raw.replace('evt_6', 'evt_7'), signature: header(Buffer.from(raw), SECRET, t) });
            assert.equal(altered.status, 400);
            assert.equal((await deliver(url, event('evt_8', 'customer.subscription.updated', { id: 'sub_1' }), { secret: SECRET_NEW })).status, 200, 'the second secret of a rotation');
        });
        assert.ok(logs.some((l) => l.includes('webhook signature refused (mismatch)')));
        assert.equal(pool.events.has('evt_5'), false);
    });

    it('dedupes by event id: a processed event is answered once more without work', async () => {
        enable();
        await withServer(async (url) => {
            const e = event('evt_9', 'customer.subscription.updated', { id: 'sub_1' });
            assert.equal((await deliver(url, e)).json.outcome, 'synced');
            assert.deepEqual((await deliver(url, e)).json, { received: true, outcome: 'duplicate' });
        });
        assert.equal(stripe.calls(/GET \/v1\/subscriptions\/sub_1/).length, 1);
        assert.deepEqual(pool.queries.filter((q) => q.sql.includes('billing_events')).map((q) => q.sql), [SQL.recordEvent, SQL.markProcessed, SQL.recordEvent, SQL.eventProcessedAt]);
    });

    it('an event of the other mode is ignored and not recorded', async () => {
        enable();
        await withServer(async (url) => {
            assert.deepEqual((await deliver(url, event('evt_10', 'customer.subscription.updated', { id: 'sub_1' }, true))).json, { received: true, outcome: 'ignored_mode' });
        });
        assert.equal(pool.events.size, 0);
        assert.equal(stripe.requests.length, 0);
    });

    it('each type: subscription events sync, refunds and disputes alert, others are ignored', async () => {
        enable();
        await withServer(async (url) => {
            const cases = [
                [event('evt_a', 'checkout.session.completed', { id: 'cs_1', subscription: 'sub_1' }), 'synced'],
                [event('evt_b', 'checkout.session.completed', { id: 'cs_2', subscription: null, mode: 'payment' }), 'no_subscription'],
                [event('evt_c', 'invoice.paid', { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } }), 'synced'],
                [event('evt_d', 'invoice.payment_failed', { id: 'in_2', subscription: 'sub_1' }), 'synced'],
                [event('evt_e', 'customer.subscription.deleted', { id: 'sub_gone' }), 'missing'],
                [event('evt_f', 'charge.refunded', { id: 'ch_1' }), 'alerted'],
                [event('evt_g', 'charge.dispute.created', { id: 'dp_1', charge: 'ch_2' }), 'alerted'],
                [event('evt_h', 'customer.created', { id: 'cus_x' }), 'ignored_type'],
            ];
            for (const [e, outcome] of cases) {
                const result = await deliver(url, e);
                assert.equal(result.status, 200, e.type);
                assert.equal(result.json.outcome, outcome, e.type);
                assert.equal(pool.events.get(e.id).outcome, outcome);
            }
        });
        const alerts = logs.filter((l) => l.startsWith('[Billing] charge_'));
        assert.equal(alerts.length, 2);
        assert.match(alerts[0], /charge_refunded: charge ch_1 was refunded \(event evt_f\)\. A refund does not cancel the subscription/);
        assert.match(alerts[1], /charge_dispute: a dispute was opened on charge ch_2 \(event evt_g\)/);
    });

    it('Stripe or the database failing: 500, the event stays unprocessed, the retry processes it', async () => {
        enable();
        await withServer(async (url) => {
            const e = event('evt_11', 'customer.subscription.updated', { id: 'sub_1' });
            stripe.fail(/subscriptions/, { status: 500, type: 'api_error' }, { once: true });
            const failed = await deliver(url, e);
            assert.equal(failed.status, 500);
            assert.equal(failed.json.error_type, 'billing_failed');
            assert.equal(pool.events.get('evt_11').processed_at, null);
            assert.equal((await deliver(url, e)).json.outcome, 'synced', 'a retry is not a duplicate');
            assert.ok(pool.events.get('evt_11').processed_at);

            pool.failOn(/billing_events/);
            assert.equal((await deliver(url, event('evt_12', 'customer.subscription.updated', { id: 'sub_1' }))).status, 500);
        });
        assert.ok(logs.some((l) => /webhook event evt_11 \(customer\.subscription\.updated\) failed \(Stripe 500\): left unprocessed/.test(l)));
        assert.ok(!logs.some((l) => l.includes('db.internal') && l.includes('500 ')), 'no driver text in the answer line');
    });

    it('without a database: 503, so Stripe retries', async () => {
        enable();
        setPoolForTests(null);
        await withServer(async (url) => {
            const result = await deliver(url, event('evt_13', 'customer.subscription.updated', { id: 'sub_1' }));
            assert.equal(result.status, 503);
            assert.equal(result.json.error_type, 'billing_unavailable');
        });
    });
});
