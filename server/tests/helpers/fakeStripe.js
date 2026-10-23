/**
 * A fake Stripe API for the billing tests, used as the `fetch` of server/services/stripeClient.js
 * (injected, or through setStripeFetchForTests). It records every request (method, path, query,
 * parsed form body, headers) and answers the calls billing makes from in-memory objects:
 * customers (Idempotency-Key replays), prices, Checkout Sessions (a reused key with other
 * parameters is an idempotency_error, as at Stripe), the portal, and subscriptions (404
 * resource_missing for an unknown id). fail(pattern, error) makes matching requests fail.
 * Not a test file (npm test runs *.test.js).
 */

/** A recurring ¥500 JPY monthly tax-inclusive Price, as the plan needs it. */
export const goodPrice = (overrides = {}) => ({
    id: 'price_supporter',
    object: 'price',
    active: true,
    currency: 'jpy',
    unit_amount: 500,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    tax_behavior: 'inclusive',
    livemode: false,
    currency_options: { jpy: { unit_amount: 500, tax_behavior: 'inclusive' } },
    ...overrides,
});

/**
 * A subscription object as GET /v1/subscriptions/{id} returns it (API 2025-03-31.basil and later:
 * the period lives on the items).
 * @param {{ id: string, customer: string, status?: string, price?: string, start?: number, end?: number, livemode?: boolean, created?: number, metadata?: object, cancel_at?: number | null, cancel_at_period_end?: boolean, canceled_at?: number | null }} input
 */
export function subscription({ id, customer, status = 'active', price = 'price_supporter', start, end, livemode = false, created, metadata = {}, cancel_at = null, cancel_at_period_end = false, canceled_at = null }) {
    const s = start ?? 1_790_000_000;
    return {
        id,
        object: 'subscription',
        customer,
        status,
        livemode,
        created: created ?? s,
        metadata,
        cancel_at,
        cancel_at_period_end,
        canceled_at,
        items: {
            object: 'list',
            data: [{ id: `si_${id}`, price: { id: price }, current_period_start: s, current_period_end: end ?? s + 30 * 86400 }],
        },
    };
}

/**
 * @param {{ prices?: object[], subscriptions?: object[], now?: () => number }} [seed]
 */
export function createFakeStripe({ prices = [goodPrice()], subscriptions = [], now = () => Date.now() } = {}) {
    const state = {
        customers: new Map(),
        prices: new Map(prices.map((p) => [p.id, p])),
        subscriptions: new Map(subscriptions.map((s) => [s.id, s])),
        sessions: new Map(),
        portalSessions: [],
    };
    /** Idempotency-Key → { body, response } */
    const keys = new Map();
    const requests = [];
    const failures = [];
    let seq = 0;

    const json = (status, body, requestId = `req_${++seq}`) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'request-id': requestId },
    });
    const error = (status, type, code, message) => json(status, { error: { type, code, message } });

    async function fakeFetch(input, init = {}) {
        const url = new URL(String(input));
        const method = String(init.method ?? 'GET').toUpperCase();
        const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
        const rawBody = typeof init.body === 'string' ? init.body : '';
        const form = new URLSearchParams(method === 'GET' ? url.search : rawBody);
        const request = { method, path: url.pathname, query: url.search, rawBody, form, headers };
        requests.push(request);

        for (const failure of failures) {
            if (failure.pattern.test(`${method} ${url.pathname}`)) {
                if (failure.once) failures.splice(failures.indexOf(failure), 1);
                if (failure.error === 'network') throw new TypeError('fetch failed');
                if (failure.error === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
                const { status, type = 'api_error', code = null, message = 'failure' } = failure.error;
                return error(status, type, code, message);
            }
        }

        const idempotencyKey = headers['idempotency-key'];
        if (method === 'POST' && idempotencyKey && keys.has(idempotencyKey)) {
            const saved = keys.get(idempotencyKey);
            if (saved.body !== rawBody) {
                return error(400, 'idempotency_error', null, 'Keys for idempotent requests can only be used with the same parameters they were first used with.');
            }
            return json(200, saved.response);
        }
        const remember = (response) => {
            if (method === 'POST' && idempotencyKey) keys.set(idempotencyKey, { body: rawBody, response });
            return json(200, response);
        };

        const p = url.pathname;
        let m;
        if (method === 'POST' && p === '/v1/customers') {
            const id = `cus_fake${++seq}`;
            const customer = { id, object: 'customer', livemode: false, metadata: { user_id: form.get('metadata[user_id]') } };
            state.customers.set(id, customer);
            return remember(customer);
        }
        if (method === 'GET' && (m = /^\/v1\/prices\/([^/]+)$/.exec(p))) {
            const price = state.prices.get(decodeURIComponent(m[1]));
            return price ? json(200, price) : error(404, 'invalid_request_error', 'resource_missing', `No such price: '${m[1]}'`);
        }
        if (method === 'POST' && p === '/v1/checkout/sessions') {
            const id = `cs_test_fake${++seq}`;
            const session = {
                id,
                object: 'checkout.session',
                url: `https://checkout.stripe.com/c/pay/${id}`,
                created: Math.floor(now() / 1000),
                status: 'open',
                customer: form.get('customer'),
                expires_at: Number(form.get('expires_at')),
            };
            state.sessions.set(id, session);
            return remember(session);
        }
        if (method === 'GET' && p === '/v1/checkout/sessions') {
            const data = [...state.sessions.values()].filter((s) => s.customer === form.get('customer') && (!form.get('status') || s.status === form.get('status')));
            return json(200, { object: 'list', data, has_more: false });
        }
        if (method === 'POST' && (m = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(p))) {
            const session = state.sessions.get(decodeURIComponent(m[1]));
            if (!session || session.status !== 'open') return error(400, 'invalid_request_error', 'checkout_session_not_open', 'Only open sessions can be expired.');
            session.status = 'expired';
            return remember(session);
        }
        if (method === 'POST' && p === '/v1/billing_portal/sessions') {
            const session = { id: `bps_fake${++seq}`, url: `https://billing.stripe.com/p/session/fake${seq}`, customer: form.get('customer'), return_url: form.get('return_url'), locale: form.get('locale') };
            state.portalSessions.push(session);
            return remember(session);
        }
        if (method === 'GET' && (m = /^\/v1\/subscriptions\/([^/]+)$/.exec(p))) {
            const sub = state.subscriptions.get(decodeURIComponent(m[1]));
            return sub ? json(200, sub) : error(404, 'invalid_request_error', 'resource_missing', `No such subscription: '${m[1]}'`);
        }
        if (method === 'GET' && p === '/v1/subscriptions') {
            const data = [...state.subscriptions.values()].filter((s) => s.customer === form.get('customer'));
            return json(200, { object: 'list', data, has_more: false });
        }
        return error(404, 'invalid_request_error', 'resource_missing', `Unrecognized request URL (${method}: ${p})`);
    }

    return {
        fetch: fakeFetch,
        state,
        requests,
        /** Requests whose "METHOD /path" matches. @param {RegExp} pattern */
        calls: (pattern) => requests.filter((r) => pattern.test(`${r.method} ${r.path}`)),
        /** @param {RegExp} pattern @param {'network'|'timeout'|{ status: number, type?: string, code?: string, message?: string }} err @param {{ once?: boolean }} [options] */
        fail(pattern, err, { once = false } = {}) {
            failures.push({ pattern, error: err, once });
        },
        clearFailures() {
            failures.length = 0;
        },
        /** Add or replace a subscription at "Stripe". @param {object} sub */
        putSubscription(sub) {
            state.subscriptions.set(sub.id, sub);
        },
    };
}
