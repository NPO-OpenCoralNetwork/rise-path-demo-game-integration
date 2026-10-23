// Who is a supporter (server/services/billingEntitlement.js): isEntitled for every status (past_due
// from the period start, active and trialing from the period end, with the grace), the price and
// mode checks; planForUser's refusals (billing off, guests, PHASE1_USER_ID, non-testers in test
// mode, minors and learners without an age, with the owner alert), the 60 s cache and its write
// generations, database errors (free, not cached); the summary GET /me shows; and the daily caps'
// resolver (only the raised kinds are looked up).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests, PHASE1_USER_ID } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { readBillingConfig } from '../services/billingConfig.js';
import { createBillingAlerts } from '../services/billingAlerts.js';
import { BILLING_GRACE_MS } from '../services/billingPlan.js';
import {
    TERMINAL_STATUSES,
    computePlan,
    createSupporterCapResolver,
    eligibilityOf,
    invalidatePlan,
    isEntitled,
    planForUser,
    resetPlanCacheForTests,
    subscriptionSummary,
} from '../services/billingEntitlement.js';
import { createBillingPool, SQL } from './helpers/billingPool.js';

const ADULT = 'aaaaaaaa-1111-4000-8000-000000000001';
const MINOR = 'aaaaaaaa-1111-4000-8000-000000000002';
const NO_AGE = 'aaaaaaaa-1111-4000-8000-000000000003';
const OTHER = 'aaaaaaaa-1111-4000-8000-000000000004';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-23T03:00:00Z');

const config = (overrides = {}) => readBillingConfig({
    BILLING_ENABLED: 'true',
    BILLING_TEST_USER_IDS: [ADULT, MINOR, NO_AGE].join(','),
    STRIPE_SECRET_KEY: ['rk', 'test', 'entkey1'].join('_'),
    STRIPE_WEBHOOK_SECRET: 'whsec_ent1',
    STRIPE_PRICE_ID: 'price_supporter',
    STRIPE_PRICE_IDS_ACCEPTED: 'price_old',
    BILLING_RETURN_ORIGIN: 'https://app.example.org',
    ...overrides,
}, { nodeEnv: 'production' });

const row = (overrides = {}) => ({
    stripe_subscription_id: 'sub_1',
    stripe_customer_id: 'cus_1',
    user_id: ADULT,
    status: 'active',
    price_id: 'price_supporter',
    livemode: false,
    current_period_start: new Date(NOW - 10 * DAY),
    current_period_end: new Date(NOW + 20 * DAY),
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    stripe_created: new Date(NOW - 40 * DAY),
    ...overrides,
});

const recorder = () => {
    const lines = [];
    return { lines, warn: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
};

describe('isEntitled', () => {
    const cfg = config();

    it('active and trialing: until the period end plus the grace', () => {
        for (const status of ['active', 'trialing']) {
            assert.equal(isEntitled(row({ status }), NOW, cfg), true, status);
            assert.equal(isEntitled(row({ status, current_period_end: new Date(NOW - BILLING_GRACE_MS + 1000) }), NOW, cfg), true, `${status} in the grace`);
            assert.equal(isEntitled(row({ status, current_period_end: new Date(NOW - BILLING_GRACE_MS) }), NOW, cfg), false, `${status} after the grace`);
            assert.equal(isEntitled(row({ status, current_period_end: null }), NOW, cfg), false, `${status} without a period`);
        }
    });

    it('past_due: from the start of the unpaid period, not its end (C3/C33/C47)', () => {
        const pastDue = (startDaysAgo) => row({ status: 'past_due', current_period_start: new Date(NOW - startDaysAgo * DAY), current_period_end: new Date(NOW + (30 - startDaysAgo) * DAY) });
        assert.equal(isEntitled(pastDue(1), NOW, cfg), true, 'day 1 of a failed renewal');
        assert.equal(isEntitled(pastDue(3), NOW, cfg), false, 'day 3, although the period ends in 27 days');
        assert.equal(isEntitled(row({ status: 'past_due', current_period_start: null }), NOW, cfg), false);
    });

    it('no other status counts, a scheduled cancellation keeps the plan until the period ends', () => {
        for (const status of ['incomplete', 'incomplete_expired', 'canceled', 'unpaid', 'paused']) {
            assert.equal(isEntitled(row({ status }), NOW, cfg), false, status);
        }
        assert.equal(isEntitled(row({ cancel_at_period_end: true }), NOW, cfg), true);
        assert.equal(isEntitled(row({ cancel_at: new Date(NOW + 20 * DAY) }), NOW, cfg), true);
        assert.deepEqual([...TERMINAL_STATUSES], ['canceled', 'incomplete_expired']);
    });

    it('the price must be accepted and the mode must match', () => {
        assert.equal(isEntitled(row({ price_id: 'price_old' }), NOW, cfg), true, 'an earlier price still listed');
        assert.equal(isEntitled(row({ price_id: 'price_other' }), NOW, cfg), false);
        assert.equal(isEntitled(row({ price_id: null }), NOW, cfg), false);
        assert.equal(isEntitled(row({ livemode: true }), NOW, cfg), false, 'a live row in test mode');
        assert.equal(isEntitled(row(), NOW, { ...cfg, live: true }), false, 'a test row in live mode');
        assert.equal(isEntitled(null, NOW, cfg), false);
        assert.equal(isEntitled(row({ current_period_end: '2026-11-12T03:00:00Z' }), NOW, cfg), true, 'dates as strings');
    });
});

describe('eligibilityOf and subscriptionSummary', () => {
    it('maps AI access to the purchase eligibility', () => {
        assert.deepEqual(eligibilityOf({ status: 'ready', audience: 'adult', birthYm: '1990-01' }), { eligibility: 'ok' });
        assert.deepEqual(eligibilityOf({ status: 'needs_age', audience: null, birthYm: null }), { eligibility: 'age_required' });
        assert.deepEqual(eligibilityOf({ status: 'ready', audience: 'adult', birthYm: null }), { eligibility: 'age_required' }, 'a dev bypass is no age');
        assert.deepEqual(eligibilityOf({ status: 'ready', audience: 'minor', birthYm: '2012-01' }), { eligibility: 'adults_only' });
        assert.deepEqual(eligibilityOf({ status: 'needs_guardian_consent', audience: 'minor', birthYm: '2012-01' }), { eligibility: 'adults_only' });
        assert.deepEqual(eligibilityOf({ status: 'paused', audience: 'adult', birthYm: '1990-01', pausedUntil: '2026-10-23T15:00:00.000Z' }), { eligibility: 'paused', pausedUntil: '2026-10-23T15:00:00.000Z' });
    });

    it('shows the subscription that is not ended (active first), else the newest; endsAt for both cancel styles (C22)', () => {
        assert.equal(subscriptionSummary([]), null);
        const rows = [
            row({ stripe_subscription_id: 'sub_new', status: 'incomplete', stripe_created: new Date(NOW) }),
            row({ stripe_subscription_id: 'sub_1', status: 'active' }),
            row({ stripe_subscription_id: 'sub_old', status: 'canceled', stripe_created: new Date(NOW - 400 * DAY) }),
        ];
        assert.equal(subscriptionSummary(rows).status, 'active');
        const end = new Date(NOW + 20 * DAY).toISOString();
        assert.deepEqual(subscriptionSummary([row()]), { status: 'active', currentPeriodEnd: end, endsAt: null, cancelAtPeriodEnd: false, canceledAt: null });
        assert.equal(subscriptionSummary([row({ cancel_at_period_end: true })]).endsAt, end, 'classic mode');
        const cancelAt = new Date(NOW + 5 * DAY);
        assert.equal(subscriptionSummary([row({ cancel_at: cancelAt })]).endsAt, cancelAt.toISOString(), 'flexible mode: cancel_at, cancel_at_period_end false');
        assert.equal(subscriptionSummary([row({ status: 'canceled', canceled_at: new Date(NOW) })]).canceledAt, new Date(NOW).toISOString());
    });
});

describe('planForUser', () => {
    let pool;
    let logger;
    let alerts;

    beforeEach(() => {
        resetPlanCacheForTests();
        resetAiAccessForTests();
        resetPoolForTests();
        pool = createBillingPool({
            ages: { [ADULT]: '1990-04', [MINOR]: '2012-04', [OTHER]: '1990-04' },
            subscriptions: [
                row(),
                row({ stripe_subscription_id: 'sub_minor', user_id: MINOR, stripe_customer_id: 'cus_m' }),
                row({ stripe_subscription_id: 'sub_noage', user_id: NO_AGE, stripe_customer_id: 'cus_n' }),
                row({ stripe_subscription_id: 'sub_other', user_id: OTHER, stripe_customer_id: 'cus_o' }),
            ],
        });
        setPoolForTests(pool);
        logger = recorder();
        alerts = createBillingAlerts({ env: {}, logger, now: () => NOW });
    });

    afterEach(() => {
        resetPlanCacheForTests();
        resetAiAccessForTests();
        resetPoolForTests();
    });

    const plan = (userId, options = {}) => planForUser(userId, { config: config(), now: NOW, pool, alerts, logger, ...options });

    it('an adult tester with an entitled row is a supporter, also while sales are closed (C2)', async () => {
        assert.equal(await plan(ADULT), 'supporter');
        assert.equal(await plan(ADULT, { config: config({ BILLING_ENABLED: 'false' }) }), 'supporter');
    });

    it('free without billing, for guests, for PHASE1_USER_ID and for non-testers in test mode (C1/C31/C42)', async () => {
        assert.equal(await plan(ADULT, { config: config({ STRIPE_SECRET_KEY: '' }) }), 'free');
        assert.equal(await plan(''), 'free');
        assert.equal(await plan(null), 'free');
        assert.equal(await plan(PHASE1_USER_ID, { config: config({ BILLING_TEST_USER_IDS: PHASE1_USER_ID }) }), 'free');
        assert.equal(await plan(OTHER), 'free', 'an adult with an active test row who is not a tester');
        assert.equal(pool.queries.filter((q) => q.sql === SQL.selectSubscriptions).length, 0, 'none of these read the database');
    });

    it('a minor or a learner without an age is free, and the owner is alerted once a day (C5/C23/C32)', async () => {
        assert.equal(await plan(MINOR), 'free');
        assert.equal(await plan(NO_AGE), 'free');
        resetPlanCacheForTests();
        assert.equal(await plan(MINOR), 'free');
        const minorAlerts = logger.lines.filter((l) => l.includes('minor_with_subscription'));
        assert.equal(minorAlerts.length, 2, minorAlerts.join('\n'));
        assert.match(minorAlerts[0], /user aaaaaaaa has a test subscription that counts \(sub_minor\) but is not a recorded adult \(needs_guardian_consent, minor\)/);
        assert.ok(minorAlerts.every((l) => !l.includes(MINOR)), 'a user id prefix only');
    });

    it('caches 60 s per user; invalidatePlan drops it', async () => {
        assert.equal(await plan(ADULT), 'supporter');
        pool.subscriptions.get('sub_1').status = 'canceled';
        assert.equal(await plan(ADULT, { now: NOW + 59_000 }), 'supporter', 'cached');
        assert.equal(await plan(ADULT, { now: NOW + 61_000 }), 'free', 'expired');
        pool.subscriptions.get('sub_1').status = 'active';
        assert.equal(await plan(ADULT, { now: NOW + 62_000 }), 'free', 'cached again');
        invalidatePlan(ADULT);
        assert.equal(await plan(ADULT, { now: NOW + 63_000 }), 'supporter');
    });

    it('a read that ran across a write is answered but not cached (write generations, C28)', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const slowPool = {
            ...pool,
            query: async (sql, params) => {
                const result = await pool.query(sql, params);
                if (String(sql).includes('FROM billing_subscriptions')) await gate;
                return result;
            },
        };
        pool.subscriptions.get('sub_1').status = 'canceled';
        const pending = plan(ADULT, { pool: slowPool });
        await new Promise((resolve) => setImmediate(resolve));
        pool.subscriptions.get('sub_1').status = 'active';
        invalidatePlan(ADULT);
        release();
        assert.equal(await pending, 'free', 'the stale read answers what it read');
        assert.equal(await plan(ADULT), 'supporter', 'but was not cached');
    });

    it('a database error is free and not cached', async () => {
        pool.failOn(/billing_subscriptions/);
        assert.equal(await plan(ADULT), 'free');
        assert.match(logger.lines.join('\n'), /reading the subscriptions failed/);
        pool.failOn(null);
        assert.equal(await plan(ADULT), 'supporter');
        resetPlanCacheForTests();
        resetAiAccessForTests();
        pool.failOn(/user_age/);
        assert.equal(await plan(ADULT), 'free', 'the age cannot be read');
        pool.failOn(null);
        assert.equal(await plan(ADULT), 'supporter');
        assert.equal(await plan(ADULT, { pool: null }), 'supporter', 'cached; without a pool a fresh read is free');
        resetPlanCacheForTests();
        assert.equal(await plan(ADULT, { pool: null }), 'free');
    });

    it('ignores the development audience: only a recorded adult age counts', async () => {
        const result = await computePlan(NO_AGE, { config: config(), now: NOW, env: { AI_ACCESS_DEV_AUDIENCE: 'adult', NODE_ENV: 'development' }, pool, alerts, logger });
        assert.equal(result.plan, 'free');
    });
});

describe('createSupporterCapResolver', () => {
    beforeEach(() => {
        resetPlanCacheForTests();
        resetAiAccessForTests();
        setPoolForTests(createBillingPool({ ages: { [ADULT]: '1990-04' }, subscriptions: [row({ current_period_end: new Date(Date.now() + 20 * DAY) })] }));
    });
    afterEach(() => {
        resetPlanCacheForTests();
        resetAiAccessForTests();
        resetPoolForTests();
    });

    it('answers null for kinds the plan does not raise (no lookup), the limits for supporters, free otherwise', async () => {
        const resolve = createSupporterCapResolver({ config: config(), env: { AI_CAP_USER_LLM: '120', AI_CAP_SUPPORTER_GLOBAL_LLM: '900' } });
        for (const kind of ['mcp', 'mcp_write', 'image', 'agent_chat', 'embeddings']) assert.equal(await resolve({ kind, userId: ADULT }), null, kind);
        assert.deepEqual(await resolve({ kind: 'llm', userId: ADULT }), { plan: 'supporter', user: 120, global: 900 });
        assert.deepEqual(await resolve({ kind: 'course_generation', userId: ADULT }), { plan: 'supporter', user: 30, global: 200 });
        assert.deepEqual(await resolve({ kind: 'llm', userId: OTHER }), { plan: 'free' });
    });
});
