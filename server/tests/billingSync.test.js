// One subscription re-read from Stripe and stored (server/services/billingSync.js): the user comes
// only from billing_customers, the upsert keeps the read that started last (synced_at ordering
// guard), unknown customers are not stored, a metadata mismatch, an unaccepted price and a second
// open subscription alert the owner, Stripe's 404 is 'missing', and other failures throw.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readBillingConfig } from '../services/billingConfig.js';
import { createBillingAlerts } from '../services/billingAlerts.js';
import { planForUser, resetPlanCacheForTests } from '../services/billingEntitlement.js';
import { createStripeClient } from '../services/stripeClient.js';
import { syncSubscription } from '../services/billingSync.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { createBillingPool, SQL } from './helpers/billingPool.js';
import { createFakeStripe, subscription } from './helpers/fakeStripe.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const NOW = Date.parse('2026-10-23T03:00:00Z');
const START = Math.floor(NOW / 1000) - 5 * 86400;

const config = readBillingConfig({
    BILLING_ENABLED: 'true',
    BILLING_TEST_USER_IDS: `${ALICE},${BOB}`,
    STRIPE_SECRET_KEY: ['rk', 'test', 'synckey1'].join('_'),
    STRIPE_WEBHOOK_SECRET: 'whsec_sync1',
    STRIPE_PRICE_ID: 'price_supporter',
    STRIPE_PRICE_IDS_ACCEPTED: 'price_old',
    BILLING_RETURN_ORIGIN: 'https://app.example.org',
}, { nodeEnv: 'production' });

const quiet = { warn: () => {}, error: () => {} };

describe('syncSubscription', () => {
    let pool;
    let stripe;
    let client;
    let logger;
    let alerts;
    let clock;

    beforeEach(() => {
        resetPlanCacheForTests();
        resetAiAccessForTests();
        pool = createBillingPool({
            customers: [
                { stripe_customer_id: 'cus_alice', user_id: ALICE, livemode: false },
                { stripe_customer_id: 'cus_bob', user_id: BOB, livemode: false },
                { stripe_customer_id: 'cus_alice_live', user_id: ALICE, livemode: true },
            ],
            ages: { [ALICE]: '1990-01', [BOB]: '1990-01' },
        });
        setPoolForTests(pool); // the age lookup (access.js) reads the shared pool
        clock = { now: NOW };
        stripe = createFakeStripe({ now: () => clock.now });
        client = createStripeClient({ secretKey: config.secretKey, fetch: stripe.fetch, logger: quiet });
        const lines = [];
        logger = { lines, warn: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
        alerts = createBillingAlerts({ env: {}, logger, now: () => NOW });
    });

    afterEach(() => {
        resetPoolForTests();
        resetPlanCacheForTests();
        resetAiAccessForTests();
    });

    const sync = (id, extra = {}) => syncSubscription(id, { stripe: client, pool, config, now: () => clock.now, alerts, logger, ...extra });

    it('stores the fresh state, mapped through billing_customers, with synced_at = when the read started', async () => {
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, metadata: { user_id: ALICE }, cancel_at: START + 30 * 86400 }));
        const result = await sync('sub_1');
        assert.deepEqual(result, { outcome: 'synced', subscriptionId: 'sub_1', userId: ALICE, status: 'active', priceAccepted: true, createdMs: START * 1000 });
        const row = pool.subscriptions.get('sub_1');
        assert.equal(row.user_id, ALICE);
        assert.equal(row.stripe_customer_id, 'cus_alice');
        assert.equal(row.price_id, 'price_supporter');
        assert.equal(row.livemode, false);
        assert.equal(row.current_period_start.getTime(), START * 1000);
        assert.equal(row.current_period_end.getTime(), (START + 30 * 86400) * 1000);
        assert.equal(row.cancel_at.getTime(), (START + 30 * 86400) * 1000);
        assert.equal(row.synced_at.getTime(), NOW);
        const sqls = pool.queries.map((q) => q.sql);
        assert.deepEqual(sqls, [SQL.customerOwner, SQL.upsert, SQL.openForUser]);
        assert.deepEqual(pool.queries[0].params, ['cus_alice', false]);
        assert.equal(stripe.calls(/GET \/v1\/subscriptions\/sub_1/).length, 1);
        assert.equal(logger.lines.length, 0, 'no alert');
    });

    it('a read that started earlier never overwrites a later one (the synced_at guard)', async () => {
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, status: 'active' }));
        // A slow read starts first (t0) and finishes last, with the old state.
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const slowFetch = async (url, init) => {
            const response = await stripe.fetch(url, init);
            await gate;
            return response;
        };
        const slow = createStripeClient({ secretKey: config.secretKey, fetch: slowFetch, logger: quiet });
        const pending = sync('sub_1', { stripe: slow });
        await new Promise((resolve) => setImmediate(resolve));

        clock.now = NOW + 1000;
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, status: 'canceled', canceled_at: START + 86400 }));
        assert.equal((await sync('sub_1')).outcome, 'synced');
        release();
        assert.equal((await pending).outcome, 'stale', 'the earlier read lost');
        assert.equal(pool.subscriptions.get('sub_1').status, 'canceled');
        assert.equal(pool.subscriptions.get('sub_1').synced_at.getTime(), NOW + 1000);

        clock.now = NOW + 2000;
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, status: 'active' }));
        assert.equal((await sync('sub_1')).outcome, 'synced', 'a later read wins');
        assert.equal(pool.subscriptions.get('sub_1').status, 'active');
    });

    it('a customer Rise Path did not create (or another mode\'s) is not stored and alerts once', async () => {
        stripe.putSubscription(subscription({ id: 'sub_x', customer: 'cus_donation', start: START }));
        assert.equal((await sync('sub_x')).outcome, 'unknown_customer');
        assert.equal((await sync('sub_x')).outcome, 'unknown_customer');
        assert.equal(pool.subscriptions.size, 0);
        const lines = logger.lines.filter((l) => l.includes('unknown_customer'));
        assert.equal(lines.length, 1, 'once a day per subscription');
        assert.match(lines[0], /subscription sub_x \(test\) belongs to customer cus_donation, which Rise Path did not create: not stored/);

        stripe.putSubscription(subscription({ id: 'sub_y', customer: 'cus_alice_live', start: START }));
        assert.equal((await sync('sub_y')).outcome, 'unknown_customer', 'a live customer row does not map a test subscription');
    });

    it('a metadata user that differs from the customer mapping alerts; the mapping wins', async () => {
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, metadata: { user_id: BOB } }));
        assert.equal((await sync('sub_1')).userId, ALICE);
        assert.equal(pool.subscriptions.get('sub_1').user_id, ALICE);
        assert.match(logger.lines.join('\n'), /user_mismatch: subscription sub_1 names another user in its metadata than its customer cus_alice maps to \(user aaaaaaaa\)/);
        assert.ok(!logger.lines.join('\n').includes(BOB), 'no full user id');
    });

    it('a price that is not accepted is stored, alerts, and gives no supporter caps', async () => {
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START, price: 'price_donation' }));
        const result = await sync('sub_1');
        assert.equal(result.outcome, 'synced');
        assert.equal(result.priceAccepted, false);
        assert.equal(pool.subscriptions.get('sub_1').price_id, 'price_donation');
        assert.match(logger.lines.join('\n'), /unknown_price: subscription sub_1 \(user aaaaaaaa\) is on price price_donation/);
        assert.equal(await planForUser(ALICE, { config, now: NOW, pool, alerts, logger }), 'free');
        stripe.putSubscription(subscription({ id: 'sub_2', customer: 'cus_bob', start: START, price: 'price_old' }));
        assert.equal((await sync('sub_2')).priceAccepted, true, 'an earlier accepted price');
    });

    it('invalidates the cached plan, so the new state applies at the next call', async () => {
        assert.equal(await planForUser(ALICE, { config, now: NOW, pool, alerts, logger }), 'free');
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START }));
        await sync('sub_1');
        assert.equal(await planForUser(ALICE, { config, now: NOW, pool, alerts, logger }), 'supporter');
    });

    it('a second subscription that is not ended alerts duplicate_subscription', async () => {
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START }));
        stripe.putSubscription(subscription({ id: 'sub_2', customer: 'cus_alice', start: START + 60 }));
        await sync('sub_1');
        assert.ok(!logger.lines.some((l) => l.includes('duplicate_subscription')));
        await sync('sub_2');
        assert.match(logger.lines.join('\n'), /duplicate_subscription: user aaaaaaaa has 2 subscriptions that are not ended \(sub_1, sub_2\)/);
    });

    it("Stripe's 404 is 'missing' (nothing stored); an unknown status is not stored; other failures throw", async () => {
        assert.deepEqual(await sync('sub_gone'), { outcome: 'missing', subscriptionId: 'sub_gone' });
        stripe.putSubscription({ ...subscription({ id: 'sub_new', customer: 'cus_alice', start: START }), status: 'frozen' });
        assert.equal((await sync('sub_new')).outcome, 'unknown_status');
        assert.equal(pool.subscriptions.size, 0);
        stripe.fail(/subscriptions/, { status: 500, type: 'api_error' }, { once: true });
        await assert.rejects(sync('sub_new'), (e) => e.name === 'StripeError' && e.status === 500);
        stripe.putSubscription(subscription({ id: 'sub_1', customer: 'cus_alice', start: START }));
        pool.failOn(/billing_subscriptions/);
        await assert.rejects(sync('sub_1'), /ECONNREFUSED/);
    });

    it('a subscription of the other mode is ignored', async () => {
        stripe.putSubscription(subscription({ id: 'sub_live', customer: 'cus_alice_live', start: START, livemode: true }));
        assert.equal((await sync('sub_live')).outcome, 'ignored_mode');
        assert.equal(pool.queries.length, 0);
    });
});
