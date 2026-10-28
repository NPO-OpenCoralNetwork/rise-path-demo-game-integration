// The Stripe REST client on fetch (server/services/stripeClient.js): Stripe's nested form
// encoding, the headers (Bearer key, the pinned Stripe-Version), Idempotency-Key on POST only,
// GET parameters in the query string, errors as StripeError without the key or Stripe's message
// (logged, masked), the timeout and network errors as status 0, and setStripeFetchForTests.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    STRIPE_API_VERSION,
    StripeError,
    createStripeClient,
    encodeStripeForm,
    redactStripeText,
    setStripeFetchForTests,
} from '../services/stripeClient.js';
import { createFakeStripe } from './helpers/fakeStripe.js';

const KEY = ['rk', 'test', 'unitkey1'].join('_');
const recorder = () => {
    const lines = [];
    return { lines, warn: (line) => lines.push(String(line)) };
};

describe('encodeStripeForm', () => {
    it('encodes nested objects, arrays of objects with indices and plain arrays with []', () => {
        const body = encodeStripeForm({
            mode: 'subscription',
            line_items: [{ price: 'price_1', quantity: 1 }],
            subscription_data: { metadata: { user_id: 'u-1' } },
            expand: ['currency_options', 'product'],
            adaptive_pricing: { enabled: false },
            skipped: undefined,
            nothing: null,
            empty: '',
        });
        assert.equal(body, [
            'mode=subscription',
            'line_items[0][price]=price_1',
            'line_items[0][quantity]=1',
            'subscription_data[metadata][user_id]=u-1',
            'expand[]=currency_options',
            'expand[]=product',
            'adaptive_pricing[enabled]=false',
            'empty=',
        ].join('&'));
    });

    it('percent-encodes values (and keys) but keeps the brackets readable', () => {
        assert.equal(encodeStripeForm({ custom_text: { submit: { message: '月額 500 円 & [link](https://x.example/a?b=c)' } } }),
            `custom_text[submit][message]=${encodeURIComponent('月額 500 円 & [link](https://x.example/a?b=c)')}`);
        assert.equal(encodeStripeForm({ 'a b': 'c' }), 'a%20b=c');
        assert.equal(encodeStripeForm({ at: new Date(1_790_000_000_000) }), 'at=1790000000');
    });
});

describe('createStripeClient', () => {
    afterEach(() => setStripeFetchForTests(null));

    it('POST: Bearer key, pinned Stripe-Version, form body, Idempotency-Key when given', async () => {
        const stripe = createFakeStripe();
        const client = createStripeClient({ secretKey: KEY, fetch: stripe.fetch });
        const customer = await client.createCustomer({ metadata: { user_id: 'u-1' }, idempotencyKey: 'customer:test:u-1' });
        assert.match(customer.id, /^cus_/);
        const [req] = stripe.requests;
        assert.equal(req.method, 'POST');
        assert.equal(req.path, '/v1/customers');
        assert.equal(req.headers.authorization, `Bearer ${KEY}`);
        assert.equal(req.headers['stripe-version'], STRIPE_API_VERSION);
        assert.equal(STRIPE_API_VERSION, '2026-09-30.endive');
        assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
        assert.equal(req.headers['idempotency-key'], 'customer:test:u-1');
        assert.equal(req.rawBody, 'metadata[user_id]=u-1');
        assert.equal(req.query, '');
    });

    it('GET: parameters in the query string, no body, no Idempotency-Key, no Content-Type', async () => {
        const stripe = createFakeStripe();
        const client = createStripeClient({ secretKey: KEY, fetch: stripe.fetch });
        await client.retrievePrice('price_supporter');
        await client.listSubscriptions({ customer: 'cus_1' });
        await client.listCheckoutSessions({ customer: 'cus_1' });
        await client.request('GET', '/v1/prices/price_supporter', { idempotencyKey: 'ignored-on-get' });
        const [price, subs, sessions] = stripe.requests;
        assert.equal(stripe.requests.length, 4);
        assert.equal(price.path, '/v1/prices/price_supporter');
        assert.equal(decodeURIComponent(price.query), '?expand[]=currency_options');
        assert.equal(decodeURIComponent(subs.query), '?customer=cus_1&status=all&limit=100');
        assert.equal(decodeURIComponent(sessions.query), '?customer=cus_1&status=open&limit=100');
        for (const req of stripe.requests) {
            assert.equal(req.method, 'GET');
            assert.equal(req.rawBody, '');
            assert.equal(req.headers['idempotency-key'], undefined);
            assert.equal(req.headers['content-type'], undefined);
            assert.equal(req.headers['stripe-version'], STRIPE_API_VERSION);
        }
    });

    it('an id never changes the path it is sent to', async () => {
        const stripe = createFakeStripe();
        const client = createStripeClient({ secretKey: KEY, fetch: stripe.fetch, logger: recorder() });
        await assert.rejects(client.retrieveSubscription('../customers/cus_1'), StripeError);
        assert.equal(stripe.requests[0].path, '/v1/subscriptions/..%2Fcustomers%2Fcus_1');
        assert.throws(() => client.retrieveSubscription(''), TypeError);
    });

    it('a Stripe error becomes StripeError { status, type, code, requestId }; the message and the key stay out of it', async () => {
        const stripe = createFakeStripe();
        const logger = recorder();
        const client = createStripeClient({ secretKey: KEY, fetch: stripe.fetch, logger });
        stripe.fail(/subscriptions/, { status: 401, type: 'invalid_request_error', code: 'api_key_expired', message: `Expired API Key provided: ${KEY}` });
        const error = await client.retrieveSubscription('sub_1').catch((e) => e);
        assert.ok(error instanceof StripeError);
        assert.equal(error.status, 401);
        assert.equal(error.type, 'invalid_request_error');
        assert.equal(error.code, 'api_key_expired');
        assert.match(error.requestId, /^req_/);
        const serialized = `${error.message} ${JSON.stringify(error)} ${error.stack}`;
        assert.ok(!serialized.includes(KEY), 'no key in the error');
        assert.ok(!serialized.includes('Expired API Key'), "Stripe's message is not in the error");
        assert.equal(logger.lines.length, 1);
        assert.match(logger.lines[0], /Stripe GET \/v1\/subscriptions\/… answered 401 invalid_request_error api_key_expired/);
        assert.ok(logger.lines[0].includes('Expired API Key provided: rk_test_…'), logger.lines[0]);
        assert.ok(!logger.lines[0].includes(KEY), 'the key is masked in the log too');
    });

    it('a timeout or a network error is status 0', async () => {
        const stripe = createFakeStripe();
        const logger = recorder();
        const client = createStripeClient({ secretKey: KEY, fetch: stripe.fetch, logger });
        stripe.fail(/prices/, 'timeout', { once: true });
        const timeout = await client.retrievePrice('price_supporter').catch((e) => e);
        assert.equal(timeout.status, 0);
        assert.equal(timeout.code, 'timeout');
        stripe.fail(/prices/, 'network', { once: true });
        const network = await client.retrievePrice('price_supporter').catch((e) => e);
        assert.equal(network.status, 0);
        assert.equal(network.code, 'network');
        assert.match(logger.lines.join('\n'), /timeout[\s\S]*network error/);

        // AbortSignal.timeout's timer does not keep the process alive (the server does): hold it here.
        const slow = createStripeClient({ secretKey: KEY, timeoutMs: 20, logger, fetch: (url, init) => new Promise((resolve, reject) => {
            const alive = setTimeout(() => {}, 5000);
            init.signal.addEventListener('abort', () => {
                clearTimeout(alive);
                reject(init.signal.reason);
            });
        }) });
        const aborted = await slow.retrievePrice('price_x').catch((e) => e);
        assert.equal(aborted.status, 0);
        assert.equal(aborted.code, 'timeout');
    });

    it('uses the fetch from setStripeFetchForTests when none is given, resolved per request', async () => {
        const client = createStripeClient({ secretKey: KEY });
        const stripe = createFakeStripe();
        setStripeFetchForTests(stripe.fetch);
        await client.createPortalSession({ customer: 'cus_1', return_url: 'https://app.example.org/settings/plan', locale: 'ja' });
        assert.equal(stripe.requests.length, 1);
        assert.equal(decodeURIComponent(stripe.requests[0].rawBody), 'customer=cus_1&return_url=https://app.example.org/settings/plan&locale=ja');
        assert.throws(() => createStripeClient({ secretKey: '' }), TypeError);
    });

    it('redactStripeText masks keys and webhook secrets', () => {
        assert.equal(redactStripeText(`bad ${['sk', 'live', 'abc123XYZ'].join('_')} and ${['whsec', 'abc'].join('_')}`), 'bad sk_live_… and whsec_…');
    });
});
