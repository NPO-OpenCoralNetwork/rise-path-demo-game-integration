/**
 * An in-memory database for the billing tests: billing_customers, billing_subscriptions and
 * billing_events (server/migrations/017_billing.sql) with the semantics the modules rely on
 * (ON CONFLICT DO NOTHING on any unique key, the upsert that keeps a newer synced_at, the status
 * CHECK, NULL-ordering), plus what the routes read on the way: user_age, account_consents and
 * ai_safety_events (server/safety/access.js), user_profiles.role and ai_daily_usage
 * (dailyCaps.js, counted like the real upsert) and the auth.users stub.
 *
 * Billing statements must match SQL below exactly (whitespace-collapsed, lower case); any other
 * statement that names a billing table throws, so a changed query fails loudly instead of matching
 * a looser mock. failOn(re) makes matching statements throw (a database outage).
 * Not a test file (npm test runs *.test.js).
 */

export const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

/** Every billing statement the modules send, written out independently of them. */
export const SQL = Object.freeze({
    selectSubscriptions: norm(`select stripe_subscription_id, stripe_customer_id, status, price_id, livemode,
        current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, stripe_created, synced_at
        from billing_subscriptions where user_id = $1 and livemode = $2
        order by stripe_created desc nulls last, stripe_subscription_id`),
    customerOwner: 'select user_id from billing_customers where stripe_customer_id = $1 and livemode = $2',
    upsert: norm(`insert into billing_subscriptions (stripe_subscription_id, stripe_customer_id, user_id, status, price_id, livemode,
        current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, stripe_created, synced_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (stripe_subscription_id) do update set
        stripe_customer_id = excluded.stripe_customer_id, user_id = excluded.user_id, status = excluded.status,
        price_id = excluded.price_id, livemode = excluded.livemode, current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
        cancel_at = excluded.cancel_at, canceled_at = excluded.canceled_at, stripe_created = excluded.stripe_created,
        synced_at = excluded.synced_at
        where billing_subscriptions.synced_at <= excluded.synced_at
        returning stripe_subscription_id`),
    openForUser: norm(`select stripe_subscription_id from billing_subscriptions
        where user_id = $1 and livemode = $2 and status <> all($3::text[]) and price_id = any($4::text[])
        order by stripe_subscription_id`),
    recordEvent: 'insert into billing_events (event_id, type, livemode) values ($1, $2, $3) on conflict (event_id) do nothing returning event_id',
    eventProcessedAt: 'select processed_at from billing_events where event_id = $1',
    markProcessed: 'update billing_events set processed_at = now(), outcome = $2 where event_id = $1',
    customerOfUser: 'select stripe_customer_id from billing_customers where user_id = $1 and livemode = $2',
    insertCustomer: 'insert into billing_customers (stripe_customer_id, user_id, livemode) values ($1, $2, $3) on conflict (user_id, livemode) do nothing',
    openCounts: norm(`select livemode, count(*)::int as n from billing_subscriptions
        where status not in ('canceled', 'incomplete_expired') group by livemode order by livemode`),
});

const STATUSES = new Set(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
const BILLING_TABLE = /billing_(customers|subscriptions|events)/;
const toDate = (value) => (value == null ? null : value instanceof Date ? value : new Date(value));

/**
 * @param {{
 *   customers?: Array<{ stripe_customer_id: string, user_id: string | null, livemode: boolean }>,
 *   subscriptions?: Array<object>,
 *   events?: Array<{ event_id: string, type: string, livemode: boolean, processed_at?: Date | null, outcome?: string | null }>,
 *   ages?: Record<string, string>,        user id → 'YYYY-MM'
 *   consents?: Record<string, boolean>,   user id → has an active guardian consent
 *   roles?: Record<string, string>,
 *   blocked?: Record<string, number>,     user id → blocked inputs today
 * }} [seed]
 */
export function createBillingPool(seed = {}) {
    const customers = new Map((seed.customers ?? []).map((c) => [c.stripe_customer_id, { created_at: new Date(), ...c }]));
    const subscriptions = new Map((seed.subscriptions ?? []).map((s) => [s.stripe_subscription_id, normalizeSub(s)]));
    const events = new Map((seed.events ?? []).map((e) => [e.event_id, { processed_at: null, outcome: null, received_at: new Date(), ...e }]));
    const ages = { ...(seed.ages ?? {}) };
    const consents = { ...(seed.consents ?? {}) };
    const roles = { ...(seed.roles ?? {}) };
    const blocked = { ...(seed.blocked ?? {}) };
    const usage = new Map();
    const queries = [];
    const hooks = {};
    let failure = null;

    function normalizeSub(s) {
        return {
            price_id: null,
            current_period_start: null,
            current_period_end: null,
            cancel_at_period_end: false,
            cancel_at: null,
            canceled_at: null,
            stripe_created: null,
            synced_at: new Date('2026-10-01T00:00:00Z'),
            ...s,
            current_period_start: toDate(s.current_period_start),
            current_period_end: toDate(s.current_period_end),
            cancel_at: toDate(s.cancel_at),
            canceled_at: toDate(s.canceled_at),
            stripe_created: toDate(s.stripe_created),
            synced_at: toDate(s.synced_at ?? '2026-10-01T00:00:00Z'),
        };
    }

    const subRow = (s) => ({
        stripe_subscription_id: s.stripe_subscription_id,
        stripe_customer_id: s.stripe_customer_id,
        status: s.status,
        price_id: s.price_id,
        livemode: s.livemode,
        current_period_start: s.current_period_start,
        current_period_end: s.current_period_end,
        cancel_at_period_end: s.cancel_at_period_end,
        cancel_at: s.cancel_at,
        canceled_at: s.canceled_at,
        stripe_created: s.stripe_created,
        synced_at: s.synced_at,
    });

    async function query(sql, params = []) {
        const text = norm(sql);
        queries.push({ sql: text, params });
        if (failure && failure.test(text)) throw new Error('connect ECONNREFUSED 10.0.0.5:5432 (db.internal)');

        switch (text) {
            case SQL.selectSubscriptions: {
                const [userId, livemode] = params;
                const rows = [...subscriptions.values()].filter((s) => s.user_id === userId && s.livemode === livemode)
                    .sort((a, b) => {
                        const ac = a.stripe_created?.getTime() ?? null;
                        const bc = b.stripe_created?.getTime() ?? null;
                        if (ac !== bc) {
                            if (ac === null) return 1;
                            if (bc === null) return -1;
                            return bc - ac;
                        }
                        return a.stripe_subscription_id < b.stripe_subscription_id ? -1 : 1;
                    });
                return { rowCount: rows.length, rows: rows.map(subRow) };
            }
            case SQL.customerOwner: {
                const c = customers.get(params[0]);
                return c && c.livemode === params[1] ? { rowCount: 1, rows: [{ user_id: c.user_id }] } : { rowCount: 0, rows: [] };
            }
            case SQL.customerOfUser: {
                const c = [...customers.values()].find((row) => row.user_id === params[0] && row.livemode === params[1]);
                return c ? { rowCount: 1, rows: [{ stripe_customer_id: c.stripe_customer_id }] } : { rowCount: 0, rows: [] };
            }
            case SQL.insertCustomer: {
                await hooks.beforeInsertCustomer?.(params);
                const [id, userId, livemode] = params;
                if (!id || id.length > 255) throw Object.assign(new Error('violates check constraint'), { code: '23514' });
                // ON CONFLICT (user_id, livemode): only that key is the arbiter; the primary key is not.
                if ([...customers.values()].some((row) => row.user_id === userId && row.livemode === livemode)) return { rowCount: 0, rows: [] };
                if (customers.has(id)) throw Object.assign(new Error('duplicate key value violates unique constraint "billing_customers_pkey"'), { code: '23505' });
                customers.set(id, { stripe_customer_id: id, user_id: userId, livemode, created_at: new Date() });
                return { rowCount: 1, rows: [] };
            }
            case SQL.upsert: {
                const [id, customer, userId, status, priceId, livemode, start, end, cape, cancelAt, canceledAt, created, syncedAt] = params;
                if (!STATUSES.has(status)) throw Object.assign(new Error('violates check constraint "billing_subscriptions_status_check"'), { code: '23514' });
                const next = normalizeSub({
                    stripe_subscription_id: id, stripe_customer_id: customer, user_id: userId, status, price_id: priceId, livemode,
                    current_period_start: start, current_period_end: end, cancel_at_period_end: cape, cancel_at: cancelAt,
                    canceled_at: canceledAt, stripe_created: created, synced_at: syncedAt,
                });
                const existing = subscriptions.get(id);
                if (existing && !(existing.synced_at.getTime() <= next.synced_at.getTime())) return { rowCount: 0, rows: [] };
                subscriptions.set(id, next);
                return { rowCount: 1, rows: [{ stripe_subscription_id: id }] };
            }
            case SQL.openForUser: {
                const [userId, livemode, terminal, prices] = params;
                const rows = [...subscriptions.values()]
                    .filter((s) => s.user_id === userId && s.livemode === livemode && !terminal.includes(s.status) && prices.includes(s.price_id))
                    .map((s) => ({ stripe_subscription_id: s.stripe_subscription_id }))
                    .sort((a, b) => (a.stripe_subscription_id < b.stripe_subscription_id ? -1 : 1));
                return { rowCount: rows.length, rows };
            }
            case SQL.recordEvent: {
                const [id, type, livemode] = params;
                if (events.has(id)) return { rowCount: 0, rows: [] };
                events.set(id, { event_id: id, type, livemode, received_at: new Date(), processed_at: null, outcome: null });
                return { rowCount: 1, rows: [{ event_id: id }] };
            }
            case SQL.eventProcessedAt: {
                const e = events.get(params[0]);
                return e ? { rowCount: 1, rows: [{ processed_at: e.processed_at }] } : { rowCount: 0, rows: [] };
            }
            case SQL.markProcessed: {
                const e = events.get(params[0]);
                if (e) Object.assign(e, { processed_at: new Date(), outcome: params[1] });
                return { rowCount: e ? 1 : 0, rows: [] };
            }
            case SQL.openCounts: {
                const counts = new Map();
                for (const s of subscriptions.values()) {
                    if (s.status === 'canceled' || s.status === 'incomplete_expired') continue;
                    counts.set(s.livemode, (counts.get(s.livemode) ?? 0) + 1);
                }
                const rows = [...counts.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([livemode, n]) => ({ livemode, n }));
                return { rowCount: rows.length, rows };
            }
            default:
                break;
        }
        if (BILLING_TABLE.test(text)) throw new Error(`billingPool: unexpected billing statement: ${text}`);

        if (text.startsWith("select to_char(birth_ym, 'yyyy-mm') as birth_ym")) {
            const ym = ages[params[0]];
            return ym ? { rowCount: 1, rows: [{ birth_ym: ym, declared_by: 'self' }] } : { rowCount: 0, rows: [] };
        }
        if (text.startsWith('select given_at, method, relationship from account_consents')) {
            return consents[params[0]]
                ? { rowCount: 1, rows: [{ given_at: new Date('2026-01-01T00:00:00Z'), method: 'guardian_on_device', relationship: 'parent' }] }
                : { rowCount: 0, rows: [] };
        }
        if (text.startsWith('select count(*)::int as blocked from ai_safety_events')) {
            return { rowCount: 1, rows: [{ blocked: blocked[params[0]] ?? 0 }] };
        }
        if (text.startsWith('select role from user_profiles')) {
            const role = roles[params[0]];
            return role ? { rowCount: 1, rows: [{ role }] } : { rowCount: 0, rows: [] };
        }
        if (text.startsWith('insert into auth.users')) return { rowCount: 1, rows: [] };
        if (text.startsWith('insert into ai_daily_usage')) {
            const [day, kind, subject, limit] = params;
            const key = `${day}|${kind}|${subject}`;
            const count = usage.get(key) ?? 0;
            if (count >= limit) return { rowCount: 0, rows: [] };
            usage.set(key, count + 1);
            return { rowCount: 1, rows: [{ count: count + 1 }] };
        }
        if (text.startsWith('update ai_daily_usage')) {
            const [day, kind, subjects] = params;
            for (const subject of subjects) {
                const key = `${day}|${kind}|${subject}`;
                if ((usage.get(key) ?? 0) > 0) usage.set(key, usage.get(key) - 1);
            }
            return { rowCount: 1, rows: [] };
        }
        if (text === 'select count from ai_daily_usage where usage_day = $1::date and kind = $2 and subject = $3') {
            const count = usage.get(`${params[0]}|${params[1]}|${params[2]}`);
            return count === undefined ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ count }] };
        }
        return { rowCount: 0, rows: [] };
    }

    return {
        query,
        connect: async () => ({ query, release: () => {} }),
        customers,
        subscriptions,
        events,
        ages,
        consents,
        roles,
        usage,
        queries,
        hooks,
        /** Statements matching `re` throw from now on (null: the database answers again). @param {RegExp | null} re */
        failOn(re) {
            failure = re;
        },
        /** ai_daily_usage inserts, as [kind, subject] pairs. */
        charged: () => queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage')).map((q) => [q.params[1], q.params[2]]),
    };
}
