// Billing settings (server/services/billingConfig.js): two states (serviceable for subscribers,
// salesOpen for new sales), the live-key guard (BILLING_LIVE), testers required in test mode,
// placeholders and the terms URL blocking live sales only, https return origins, accepted prices,
// the startup line (names only) and the startup alert when subscribers exist but billing cannot
// serve them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { billingAudienceAllows, billingStartupLine, checkBillingServiceable, readBillingConfig } from '../services/billingConfig.js';
import { OWNER_FACTS } from '../services/billingDisclosure.js';
import { createBillingAlerts } from '../services/billingAlerts.js';
import { createBillingPool } from './helpers/billingPool.js';

const TESTER = 'aaaaaaaa-1111-4000-8000-000000000001';
const KEY_TEST = ['rk', 'test', 'cfgkey1'].join('_');
const KEY_LIVE = ['sk', 'live', 'cfgkey1'].join('_');
const WHSEC = ['whsec', 'cfgsecret1'].join('_');
const FILLED = Object.fromEntries(Object.keys(OWNER_FACTS).map((k) => [k, { jp: `記入済み ${k}`, en: `filled ${k}` }]));

const testEnv = (overrides = {}) => ({
    BILLING_ENABLED: 'true',
    BILLING_TEST_USER_IDS: TESTER,
    STRIPE_SECRET_KEY: KEY_TEST,
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_ID: 'price_supporter',
    BILLING_RETURN_ORIGIN: 'https://app.example.org',
    ...overrides,
});
const liveEnv = (overrides = {}) => testEnv({
    STRIPE_SECRET_KEY: KEY_LIVE, BILLING_LIVE: 'true', BILLING_TEST_USER_IDS: '', BILLING_TOS_URL: 'https://app.example.org/terms', ...overrides,
});
const read = (env, options = {}) => readBillingConfig(env, { nodeEnv: 'production', ...options });

describe('readBillingConfig', () => {
    it('nothing set: off, not serviceable, nothing secret kept', () => {
        const config = read({});
        assert.equal(config.configured, false);
        assert.equal(config.serviceable, false);
        assert.equal(config.salesOpen, false);
        assert.equal(config.mode, null);
        assert.equal(config.secretKey, '');
        assert.deepEqual(config.serviceProblems, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'BILLING_RETURN_ORIGIN']);
        assert.equal(billingStartupLine(config), '[Billing] billing: off');
    });

    it('test mode with testers: serviceable and sales open', () => {
        const config = read(testEnv());
        assert.equal(config.serviceable, true);
        assert.equal(config.salesOpen, true);
        assert.equal(config.live, false);
        assert.equal(config.mode, 'test');
        assert.equal(config.secretKey, KEY_TEST);
        assert.deepEqual(config.webhookSecrets, [WHSEC]);
        assert.equal(config.returnOrigin, 'https://app.example.org');
        assert.deepEqual([...config.testUserIds], [TESTER]);
        assert.deepEqual(config.salesProblems, []);
        assert.equal(billingStartupLine(config), '[Billing] billing: test (serviceable, sales open, 1 test users)');
        assert.ok(!billingStartupLine(config).includes(KEY_TEST));
    });

    it('BILLING_ENABLED other than exactly "true" closes sales only; subscribers stay served (C2/C15/C30)', () => {
        for (const value of [undefined, '', 'false', 'TRUE', '1', ' true']) {
            const config = read(testEnv({ BILLING_ENABLED: value }));
            assert.equal(config.serviceable, true, String(value));
            assert.equal(config.salesOpen, false, String(value));
            assert.deepEqual(config.salesProblems, ['sales_closed'], String(value));
        }
    });

    it('test mode needs a non-empty list of uuids in BILLING_TEST_USER_IDS', () => {
        for (const value of [undefined, '', ' , ', `${TESTER},not-a-uuid`]) {
            const config = read(testEnv({ BILLING_TEST_USER_IDS: value }));
            assert.equal(config.serviceable, true);
            assert.equal(config.salesOpen, false, String(value));
            assert.ok(config.salesProblems.includes('test_user_ids'), String(value));
        }
        const two = read(testEnv({ BILLING_TEST_USER_IDS: ` ${TESTER.toUpperCase()} , bbbbbbbb-1111-4000-8000-000000000002 ` }));
        assert.deepEqual([...two.testUserIds], [TESTER, 'bbbbbbbb-1111-4000-8000-000000000002']);
        assert.ok(billingAudienceAllows(two, TESTER.toUpperCase()));
        assert.ok(!billingAudienceAllows(two, 'cccccccc-1111-4000-8000-000000000003'));
        assert.ok(!billingAudienceAllows(two, ''));
        const repeated = read(testEnv({ BILLING_TEST_USER_IDS: `${TESTER},${TESTER.toUpperCase()}` }));
        assert.equal(repeated.salesOpen, true, 'a repeated id is not an invalid list');
        assert.deepEqual([...repeated.testUserIds], [TESTER]);
    });

    it('a live key needs BILLING_LIVE=true, or billing is not serviceable at all', () => {
        for (const value of [undefined, '', 'yes', 'TRUE']) {
            const config = read(liveEnv({ BILLING_LIVE: value }), { ownerFacts: FILLED });
            assert.equal(config.serviceable, false, String(value));
            assert.equal(config.live, false);
            assert.ok(config.serviceProblems.includes('BILLING_LIVE'));
            assert.equal(config.secretKey, '', 'the key is not kept');
        }
        const live = read(liveEnv(), { ownerFacts: FILLED });
        assert.equal(live.serviceable, true);
        assert.equal(live.salesOpen, true);
        assert.equal(live.live, true);
        assert.equal(live.mode, 'live');
        assert.equal(live.testUserIds.size, 0, 'testers do not matter in live mode');
        assert.ok(billingAudienceAllows(live, 'cccccccc-1111-4000-8000-000000000003'));
        assert.equal(read(liveEnv({ STRIPE_SECRET_KEY: ['rk', 'live', 'x1'].join('_') }), { ownerFacts: FILLED }).live, true);
    });

    it('placeholders and a missing terms URL block live sales only; they never make billing unserviceable', () => {
        const live = read(liveEnv());
        assert.equal(live.serviceable, true);
        assert.equal(live.salesOpen, false);
        assert.deepEqual(live.salesProblems, ['disclosure_placeholders']);
        const noTos = read(liveEnv({ BILLING_TOS_URL: '' }), { ownerFacts: FILLED });
        assert.equal(noTos.serviceable, true);
        assert.deepEqual(noTos.salesProblems, ['tos_url']);
        const test = read(testEnv());
        assert.equal(test.salesOpen, true, 'test mode sells to testers with the placeholders still in');
        assert.deepEqual(read(testEnv({ BILLING_TOS_URL: 'ftp://x.example/terms' })).salesProblems, ['tos_url']);
        assert.equal(read(testEnv({ BILLING_TOS_URL: 'https://app.example.org/terms' })).tosUrl, 'https://app.example.org/terms');
    });

    it('key, secret, price and origin formats', () => {
        for (const key of [['pk', 'test', 'x1'].join('_'), 'sk_test_', ['sk', 'prod', 'x1'].join('_'), ['sk', 'test', 'x-1'].join('_'), ` ${KEY_TEST}x`.slice(0, 3)]) {
            assert.ok(read(testEnv({ STRIPE_SECRET_KEY: key })).serviceProblems.includes('STRIPE_SECRET_KEY'), key);
        }
        assert.ok(read(testEnv({ STRIPE_WEBHOOK_SECRET: 'secret_x' })).serviceProblems.includes('STRIPE_WEBHOOK_SECRET'));
        const rotation = read(testEnv({ STRIPE_WEBHOOK_SECRET: ` ${WHSEC} , whsec_second1 ` }));
        assert.deepEqual(rotation.webhookSecrets, [WHSEC, 'whsec_second1']);
        const typo = read(testEnv({ STRIPE_WEBHOOK_SECRET: `${WHSEC},oops` }));
        assert.equal(typo.serviceable, true, 'one bad entry during a rotation does not stop billing');
        assert.deepEqual(typo.webhookSecrets, [WHSEC]);
        assert.match(billingStartupLine(typo), /ignored: STRIPE_WEBHOOK_SECRET/);
        assert.ok(read(testEnv({ STRIPE_PRICE_ID: 'price 1' })).serviceProblems.includes('STRIPE_PRICE_ID'));
        assert.ok(read(testEnv({ STRIPE_PRICE_ID: 'p'.repeat(256) })).serviceProblems.includes('STRIPE_PRICE_ID'));
    });

    it('the return origin is https (http only to localhost outside production), with no path', () => {
        for (const origin of ['http://app.example.org', 'https://app.example.org/settings', 'https://u:p@app.example.org', 'https://app.example.org?x=1', 'app.example.org', 'javascript:alert(1)']) {
            assert.ok(read(testEnv({ BILLING_RETURN_ORIGIN: origin })).serviceProblems.includes('BILLING_RETURN_ORIGIN'), origin);
        }
        assert.equal(read(testEnv({ BILLING_RETURN_ORIGIN: 'https://app.example.org/' })).returnOrigin, 'https://app.example.org');
        assert.ok(read(testEnv({ BILLING_RETURN_ORIGIN: 'http://localhost:3007' })).serviceProblems.includes('BILLING_RETURN_ORIGIN'), 'not in production');
        assert.equal(readBillingConfig(testEnv({ BILLING_RETURN_ORIGIN: 'http://localhost:3007' }), { nodeEnv: 'development' }).returnOrigin, 'http://localhost:3007');
    });

    it('accepted prices: STRIPE_PRICE_IDS_ACCEPTED plus STRIPE_PRICE_ID (C10/C21/C39)', () => {
        assert.deepEqual([...read(testEnv()).acceptedPriceIds], ['price_supporter']);
        const both = read(testEnv({ STRIPE_PRICE_IDS_ACCEPTED: 'price_old1, price_old2,,bad id' }));
        assert.deepEqual([...both.acceptedPriceIds].sort(), ['price_old1', 'price_old2', 'price_supporter']);
        assert.match(billingStartupLine(both), /ignored: STRIPE_PRICE_IDS_ACCEPTED/);
    });

    it('caps that would not raise anything close sales, by name', () => {
        const config = read(testEnv({ AI_CAP_USER_LLM: '120', AI_CAP_SUPPORTER_GLOBAL_COURSE_GENERATION: '0' }));
        assert.equal(config.serviceable, true);
        assert.deepEqual(config.salesProblems, ['supporter_caps_not_above_free:llm', 'supporter_caps_off:course_generation']);
    });

    it('the startup line names problems, never values', () => {
        const line = billingStartupLine(read(testEnv({ STRIPE_WEBHOOK_SECRET: '', BILLING_RETURN_ORIGIN: 'http://x' })));
        assert.equal(line, '[Billing] billing: off, not serviceable (missing or invalid: STRIPE_WEBHOOK_SECRET, BILLING_RETURN_ORIGIN)');
        const closed = billingStartupLine(read(liveEnv()));
        assert.equal(closed, '[Billing] billing: live (serviceable, sales closed: disclosure_placeholders)');
        for (const text of [line, closed]) assert.ok(!text.includes(KEY_TEST) && !text.includes(KEY_LIVE) && !text.includes(WHSEC));
    });
});

describe('checkBillingServiceable', () => {
    const lines = () => {
        const out = [];
        return { out, warn: (l) => out.push(String(l)), error: (l) => out.push(String(l)) };
    };

    it('alerts the owner when billing is not serviceable while subscriptions are not ended', async () => {
        const logger = lines();
        const alerts = createBillingAlerts({ env: {}, logger });
        const pool = createBillingPool({
            subscriptions: [
                { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: TESTER, status: 'active', livemode: false },
                { stripe_subscription_id: 'sub_2', stripe_customer_id: 'cus_2', user_id: TESTER, status: 'canceled', livemode: true },
            ],
        });
        const config = read(testEnv({ STRIPE_SECRET_KEY: '' }));
        assert.equal(await checkBillingServiceable(config, { pool, alerts, logger }), true);
        assert.equal(logger.out.length, 1);
        assert.match(logger.out[0], /^\[Billing\] billing_unserviceable: billing is not serviceable \(STRIPE_SECRET_KEY\) while subscriptions are not ended \(test 1\)/);
        assert.equal(await checkBillingServiceable(config, { pool, alerts, logger }), true);
        assert.equal(logger.out.length, 1, 'once a day');
    });

    it('stays quiet when serviceable, without rows, or without a pool; a failed query only warns', async () => {
        const logger = lines();
        const alerts = createBillingAlerts({ env: {}, logger });
        const pool = createBillingPool({ subscriptions: [{ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: TESTER, status: 'past_due', livemode: false }] });
        assert.equal(await checkBillingServiceable(read(testEnv()), { pool, alerts, logger }), false);
        assert.equal(await checkBillingServiceable(read({}), { pool: createBillingPool(), alerts, logger }), false);
        assert.equal(await checkBillingServiceable(read({}), { pool: null, alerts, logger }), false);
        pool.failOn(/billing_subscriptions/);
        assert.equal(await checkBillingServiceable(read({}), { pool, alerts, logger }), false);
        assert.equal(logger.out.length, 1);
        assert.match(logger.out[0], /could not check for open subscriptions .*Is migration 017 applied\?/);
    });
});
