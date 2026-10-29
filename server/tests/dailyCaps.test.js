// Daily caps on paid AI features (server/middleware/dailyCaps.js): the Japan-time day, limits from
// env, the in-memory and Postgres stores, the per-address and global caps, admins, guests,
// refunds, the database-outage fallback and the owner alerts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CAP_KINDS,
    createDailyCaps,
    ipSubject,
    jstDay,
    nextJstMidnight,
    refundDailyCap,
    resolveCapLimits,
    sendDailyLimit,
} from '../middleware/dailyCaps.js';
import { LlmError } from '../llm/errors.js';
import { SUPPORTER_GLOBAL_SUBJECT, dailyLimitRefusal, resetDailyCapsForTests, setPlanResolver } from '../middleware/dailyCaps.js';

const quiet = { warn: () => {}, error: () => {} };
const NOON_JST = Date.parse('2026-10-22T03:00:00Z');

/** Records warnings. */
const recorder = () => {
    const lines = [];
    return { lines, warn: (...args) => lines.push(args.join(' ')), error: (...args) => lines.push(args.join(' ')) };
};

/** The parts of an Express response the caps use, plus emit() for 'finish'. */
const fakeRes = () => {
    const listeners = new Map();
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        locals: {},
        headersSent: false,
        set(name, value) { res.headers[name.toLowerCase()] = value; return res; },
        status(code) { res.statusCode = code; return res; },
        json(body) { res.body = body; res.headersSent = true; return res; },
        once(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); return res; },
        emit(event) {
            const fns = listeners.get(event) ?? [];
            listeners.delete(event);
            for (const fn of fns) fn();
        },
    };
    return res;
};

/**
 * A pg pool stand-in that keeps ai_daily_usage like the real table (same SQL semantics) and
 * records every statement, whitespace-normalized and lowercased.
 * @param {{ role?: string | null, fail?: RegExp, emptyReserve?: boolean }} [options]
 */
const fakePool = ({ role = null, fail = null, emptyReserve = false } = {}) => {
    const rows = new Map();
    const queries = [];
    const state = { fail };
    return {
        queries,
        rows,
        sql: () => queries.map((q) => q.sql),
        /** Statements matching `re` throw from now on (null: the database answers again). */
        setFail(re) { state.fail = re; },
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
            queries.push({ sql, params });
            if (state.fail && state.fail.test(sql)) throw new Error('relation "ai_daily_usage" does not exist');
            if (sql.startsWith('select role from user_profiles')) return { rows: role ? [{ role }] : [] };
            if (sql.startsWith('insert into ai_daily_usage')) {
                if (emptyReserve) return { rows: [] };
                const [day, kind, subject, limit] = params;
                const key = `${day}|${kind}|${subject}`;
                const count = rows.get(key);
                if (count === undefined) {
                    rows.set(key, 1);
                    return { rows: [{ count: 1 }] };
                }
                if (count < limit) {
                    rows.set(key, count + 1);
                    return { rows: [{ count: count + 1 }] };
                }
                return { rows: [] };
            }
            if (sql.startsWith('update ai_daily_usage')) {
                const [day, kind, subjects] = params;
                for (const subject of subjects) {
                    const key = `${day}|${kind}|${subject}`;
                    if ((rows.get(key) ?? 0) > 0) rows.set(key, rows.get(key) - 1);
                }
                return { rows: [] };
            }
            return { rows: [] };
        },
    };
};

/**
 * createDailyCaps with a movable clock; call(kind, userId?, options?, ip?) runs one reservation
 * (`ip` becomes req.ip).
 */
const setup = ({ env = {}, pool = null, logger = quiet, at = NOON_JST, fetch } = {}) => {
    const clock = { now: at };
    const caps = createDailyCaps({ env, now: () => clock.now, getPool: () => pool, logger, fetch });
    const call = async (kind, userId = 'user-a', options, ip) => {
        const res = fakeRes();
        const handle = await caps.reserve({ userId, ip }, res, kind, options);
        return { handle, res, status: handle ? 200 : res.statusCode, body: res.body };
    };
    return { caps, clock, call };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Japan-time day', () => {
    it('rolls over at 15:00 UTC (00:00 JST)', () => {
        assert.equal(jstDay(Date.parse('2026-10-22T14:59:59Z')), '2026-10-22');
        assert.equal(jstDay(Date.parse('2026-10-22T15:00:00Z')), '2026-10-23');
        assert.equal(jstDay(Date.parse('2026-10-21T15:00:00Z')), '2026-10-22');
    });

    it('next reset is the coming 00:00 JST', () => {
        assert.equal(new Date(nextJstMidnight(Date.parse('2026-10-22T10:00:00Z'))).toISOString(), '2026-10-22T15:00:00.000Z');
        assert.equal(new Date(nextJstMidnight(Date.parse('2026-10-22T15:00:00Z'))).toISOString(), '2026-10-23T15:00:00.000Z');
        assert.equal(new Date(nextJstMidnight(Date.parse('2026-10-22T00:00:00Z'))).toISOString(), '2026-10-22T15:00:00.000Z');
    });

    it('sendDailyLimit answers 429 with reset_at and Retry-After', () => {
        const res = fakeRes();
        sendDailyLimit(res, { kind: 'image', scope: 'user', now: Date.parse('2026-10-22T14:00:00Z') });
        assert.equal(res.statusCode, 429);
        assert.equal(res.headers['retry-after'], '3600');
        assert.deepEqual(Object.keys(res.body).sort(), ['error', 'error_type', 'kind', 'reset_at', 'scope']);
        assert.equal(res.body.error_type, 'daily_limit_reached');
        assert.equal(res.body.reset_at, '2026-10-22T15:00:00.000Z');
        assert.match(res.body.error, /Japan time/);
        const late = fakeRes();
        sendDailyLimit(late, { kind: 'llm', scope: 'guest', now: Date.parse('2026-10-22T14:59:59.900Z'), message: 'guest text' });
        assert.equal(late.headers['retry-after'], '1', 'at least one second');
        assert.equal(late.body.error, 'guest text');
        assert.equal(late.body.scope, 'guest');
    });

    it("scope 'off' promises no reset: no reset_at and no Retry-After", () => {
        const res = fakeRes();
        sendDailyLimit(res, { kind: 'image', scope: 'off', now: Date.parse('2026-10-22T14:00:00Z') });
        assert.equal(res.statusCode, 429);
        assert.equal(res.headers['retry-after'], undefined);
        assert.deepEqual(Object.keys(res.body).sort(), ['error', 'error_type', 'kind', 'scope']);
        assert.equal(res.body.error_type, 'daily_limit_reached');
        assert.doesNotMatch(res.body.error, /resets|00:00/);
    });
});

describe('resolveCapLimits', () => {
    it('has a default for every kind', () => {
        const limits = resolveCapLimits({});
        assert.deepEqual(Object.keys(limits), [...CAP_KINDS]);
        assert.deepEqual(limits, {
            llm: { user: 50, ip: 150, global: 1500 },
            course_generation: { user: 20, ip: 60, global: 300 },
            image: { user: 30, ip: 90, global: 300 },
            agent_chat: { user: 40, ip: 120, global: 800 },
            embeddings: { user: 10, ip: 30, global: 100 },
            mcp: { user: 300, ip: null, global: 20000 },
            mcp_write: { user: 50, ip: null, global: 5000 },
        });
    });

    it('reads overrides; 0 is 0; anything that is not a whole number falls back with one warning per key', () => {
        const logger = recorder();
        const warned = new Set();
        const env = {
            AI_CAP_USER_LLM: '7',
            AI_CAP_GLOBAL_LLM: '0',
            AI_CAP_USER_IMAGE: 'abc',
            AI_CAP_GLOBAL_IMAGE: '-1',
            AI_CAP_USER_EMBEDDINGS: '1.5',
            AI_CAP_GLOBAL_EMBEDDINGS: '',
            AI_CAP_USER_AGENT_CHAT: ' 12 ',
            AI_CAP_IP_COURSE_GENERATION: '5',
            AI_CAP_IP_AGENT_CHAT: 'many',
        };
        const limits = resolveCapLimits(env, { logger, warned });
        assert.deepEqual(limits.llm, { user: 7, ip: 21, global: 0 }, 'the address cap follows the user cap');
        assert.deepEqual(limits.image, { user: 30, ip: 90, global: 300 });
        assert.deepEqual(limits.embeddings, { user: 10, ip: 30, global: 100 });
        assert.deepEqual(limits.course_generation, { user: 20, ip: 5, global: 300 });
        assert.deepEqual(limits.agent_chat, { user: 12, ip: 36, global: 800 });
        assert.equal(logger.lines.length, 5);
        assert.match(logger.lines.join('\n'), /AI_CAP_USER_IMAGE="abc"/);
        resolveCapLimits(env, { logger, warned });
        assert.equal(logger.lines.length, 5, 'no second warning for the same key');
    });
});

describe('createDailyCaps (in memory)', () => {
    it('refuses the call over the user cap with 429 daily_limit_reached, and allows it again the next JST day', async () => {
        const { call, clock } = setup({ env: { AI_CAP_USER_IMAGE: '2' } });
        assert.equal((await call('image')).status, 200);
        assert.equal((await call('image')).status, 200);
        const third = await call('image');
        assert.equal(third.status, 429);
        assert.equal(third.body.error_type, 'daily_limit_reached');
        assert.equal(third.body.kind, 'image');
        assert.equal(third.body.scope, 'user');
        assert.equal(third.body.reset_at, '2026-10-22T15:00:00.000Z');
        assert.ok(Number(third.res.headers['retry-after']) > 0);
        assert.equal((await call('image', 'user-b')).status, 200, 'another user has their own count');
        assert.equal((await call('llm')).status, 200, 'another kind has its own count');

        clock.now = Date.parse('2026-10-22T15:00:01Z');
        assert.equal((await call('image')).status, 200, 'a new Japan-time day');
    });

    it('the global cap stops everyone, and a refused attempt does not use the caller\'s own slot', async () => {
        const logger = recorder();
        const { call } = setup({ env: { AI_CAP_USER_AGENT_CHAT: '1', AI_CAP_GLOBAL_AGENT_CHAT: '1' }, logger });
        const a = await call('agent_chat', 'user-a');
        assert.equal(a.status, 200);
        const b = await call('agent_chat', 'user-b');
        assert.equal(b.status, 429);
        assert.equal(b.body.scope, 'global');
        assert.equal(b.body.kind, 'agent_chat');
        await a.handle.refund();
        assert.equal((await call('agent_chat', 'user-b')).status, 200, "B's user slot was given back");
        assert.equal((await call('agent_chat', 'user-c')).status, 429);
        assert.equal(logger.lines.filter((line) => line.includes('global daily cap reached: agent_chat (1)')).length, 1, 'logged once a day');
        assert.equal(logger.lines.filter((line) => line.includes('global daily cap 80% used: agent_chat (1)')).length, 1, 'warned once at 80%');
    });

    it('refund() gives back once, and a refund after midnight does not add to the new day', async () => {
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '2' } });
        const first = await call('image');
        await call('image');
        await first.handle.refund();
        await first.handle.refund();
        assert.equal((await call('image')).status, 200);
        assert.equal((await call('image')).status, 429, 'the second refund did nothing');

        const { call: call2, clock: clock2 } = setup({ env: { AI_CAP_USER_IMAGE: '1' }, at: Date.parse('2026-10-22T14:59:59Z') });
        const yesterday = await call2('image');
        clock2.now = Date.parse('2026-10-22T15:00:01Z');
        assert.equal((await call2('image')).status, 200, 'new day');
        await yesterday.handle.refund();
        assert.equal((await call2('image')).status, 429, "yesterday's refund is not added to today");
    });

    it("a late request stamped with yesterday's day does not wipe today's counts", async () => {
        const clock = { now: Date.parse('2026-10-22T15:00:01Z') };
        const caps = createDailyCaps({ env: { AI_CAP_USER_IMAGE: '1' }, now: () => clock.now, getPool: () => null, logger: quiet });
        const call = async (userId) => {
            const res = fakeRes();
            return (await caps.reserve({ userId }, res, 'image')) ? 200 : res.statusCode;
        };
        assert.equal(await call('user-a'), 200, 'today (2026-10-23 JST)');
        clock.now = Date.parse('2026-10-22T14:59:59Z');
        assert.equal(await call('user-b'), 200, 'a request that started at 23:59:59 JST counts under yesterday');
        clock.now = Date.parse('2026-10-22T15:00:02Z');
        assert.equal(await call('user-a'), 429, "today's count survived the late request");
    });

    it('refundDailyCap refunds only when no model ran', async () => {
        const { call } = setup({ env: { AI_CAP_USER_LLM: '1' } });
        const charged = await call('llm');
        assert.equal(typeof charged.res.locals.refundDailyCap, 'function');
        refundDailyCap(charged.res, new LlmError('timeout', 'slow'));
        refundDailyCap(charged.res, new LlmError('provider_unavailable', 'down', { modelRan: true }));
        refundDailyCap(charged.res, new Error('unknown'));
        await tick();
        assert.equal((await call('llm')).status, 429, 'timeout, modelRan and unknown errors stay charged');
        refundDailyCap(charged.res, new LlmError('provider_unavailable', 'down'));
        await tick();
        assert.equal((await call('llm')).status, 200, 'provider_unavailable is refunded');
        refundDailyCap(fakeRes(), new LlmError('no_provider', 'none'));
    });

    it('refundOnStatus gives the slot back when the response finishes with one of those statuses', async () => {
        const { call } = setup({ env: { AI_CAP_USER_EMBEDDINGS: '1' } });
        const rejected = await call('embeddings', 'user-a', { refundOnStatus: [400, 503] });
        assert.equal(rejected.status, 200);
        rejected.res.statusCode = 400;
        rejected.res.emit('finish');
        await tick();
        const kept = await call('embeddings', 'user-a', { refundOnStatus: [400, 503] });
        assert.equal(kept.status, 200, 'the 400 was refunded');
        kept.res.statusCode = 200;
        kept.res.emit('finish');
        await tick();
        assert.equal((await call('embeddings')).status, 429, 'a 200 stays charged');
    });

    it("a limit of 0 turns the feature off for everyone, admins included, without a query (scope 'off')", async () => {
        for (const env of [{ AI_CAP_USER_IMAGE: '0' }, { AI_CAP_IP_IMAGE: '0' }, { AI_CAP_GLOBAL_IMAGE: '0' }]) {
            const pool = fakePool({ role: 'admin' });
            const { call } = setup({ env, pool });
            const off = await call('image', 'admin-1');
            assert.equal(off.status, 429);
            assert.equal(off.body.scope, 'off');
            assert.equal(off.body.kind, 'image');
            assert.equal(off.body.reset_at, undefined);
            assert.deepEqual(pool.queries, []);
        }
    });

    it('guests (no userId) pass without being counted', async () => {
        const pool = fakePool();
        const { caps } = setup({ env: { AI_CAP_USER_LLM: '1', AI_CAP_GLOBAL_LLM: '1' }, pool });
        for (const userId of [null, undefined, '', null]) {
            const res = fakeRes();
            const handle = await caps.reserve({ userId, ip: '203.0.113.7' }, res, 'llm');
            assert.ok(handle, 'over the limits of 1: guests are not counted');
            await handle.refund();
            assert.equal(res.body, undefined);
            assert.equal(res.locals.refundDailyCap, undefined);
        }
        assert.deepEqual(pool.queries, []);
    });

    it("a feature turned off (a limit of 0) is off for guests too (429 scope 'off', no query)", async () => {
        for (const env of [{ AI_CAP_USER_LLM: '0' }, { AI_CAP_IP_LLM: '0' }, { AI_CAP_GLOBAL_LLM: '0' }]) {
            const pool = fakePool();
            const { caps } = setup({ env, pool });
            for (const userId of [null, undefined, '']) {
                const res = fakeRes();
                assert.equal(await caps.reserve({ userId, ip: '203.0.113.7' }, res, 'llm'), null, JSON.stringify(env));
                assert.equal(res.statusCode, 429);
                assert.equal(res.body.error_type, 'daily_limit_reached');
                assert.equal(res.body.scope, 'off');
                assert.equal(res.body.reset_at, undefined);
            }
            assert.deepEqual(pool.queries, []);
        }
    });

    it('reset() clears the counts', async () => {
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '1' } });
        await call('llm');
        assert.equal((await call('llm')).status, 429);
        caps.reset();
        assert.equal((await call('llm')).status, 200);
    });

    it('middleware() calls next only when the slot was reserved', async () => {
        const { caps } = setup({ env: { AI_CAP_USER_IMAGE: '1' } });
        const run = async () => {
            const res = fakeRes();
            let passed = false;
            await caps.middleware('image')({ userId: 'user-a' }, res, () => { passed = true; });
            return passed ? 200 : res.statusCode;
        };
        assert.equal(await run(), 200);
        assert.equal(await run(), 429);
        assert.throws(() => caps.middleware('video'), /Unknown daily cap kind/);
    });
});

describe('createDailyCaps (Postgres)', () => {
    it('reserves with one atomic upsert per subject and refunds the same rows', async () => {
        const pool = fakePool();
        const { call } = setup({ env: { AI_CAP_USER_COURSE_GENERATION: '2', AI_CAP_GLOBAL_COURSE_GENERATION: '9' }, pool });
        const first = await call('course_generation', 'user-a');
        assert.equal(first.status, 200);
        const inserts = pool.queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage'));
        assert.equal(inserts.length, 2);
        for (const { sql } of inserts) {
            assert.match(sql, /^insert into ai_daily_usage \(usage_day, kind, subject, count\) values \(\$1::date, \$2, \$3, 1\) on conflict \(usage_day, kind, subject\) do update set count = ai_daily_usage\.count \+ 1, updated_at = now\(\) where ai_daily_usage\.count < \$4 returning count$/);
        }
        assert.deepEqual(inserts.map((q) => q.params), [
            ['2026-10-22', 'course_generation', 'user-a', 2],
            ['2026-10-22', 'course_generation', '*', 9],
        ]);
        assert.equal(pool.rows.get('2026-10-22|course_generation|user-a'), 1);

        await first.handle.refund();
        const update = pool.queries.find((q) => q.sql.startsWith('update ai_daily_usage'));
        assert.match(update.sql, /where usage_day = \$1::date and kind = \$2 and subject = any\(\$3::text\[\]\) and count > 0$/);
        assert.deepEqual(update.params, ['2026-10-22', 'course_generation', ['user-a', '*']]);
        assert.equal(pool.rows.get('2026-10-22|course_generation|user-a'), 0);
        assert.equal(pool.rows.get('2026-10-22|course_generation|*'), 0);
    });

    it('no row back from the upsert means the cap is reached', async () => {
        const { call } = setup({ pool: fakePool({ emptyReserve: true }) });
        const refused = await call('image');
        assert.equal(refused.status, 429);
        assert.equal(refused.body.scope, 'user');
    });

    it('admins skip the user cap but not the global one; the role is cached', async () => {
        const pool = fakePool({ role: 'admin' });
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '1', AI_CAP_GLOBAL_IMAGE: '2' }, pool });
        assert.equal((await call('image', 'admin-1')).status, 200);
        assert.equal((await call('image', 'admin-1')).status, 200, 'over the user cap of 1');
        const third = await call('image', 'admin-1');
        assert.equal(third.status, 429);
        assert.equal(third.body.scope, 'global');
        assert.equal(pool.queries.filter((q) => q.sql.startsWith('select role')).length, 1, 'cached for 5 minutes');
        assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert') && q.params[2] === 'admin-1'), 'no per-user row for an admin');
    });

    it('a learner role is not an admin', async () => {
        const pool = fakePool({ role: 'learner' });
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '1' }, pool });
        assert.equal((await call('image')).status, 200);
        assert.equal((await call('image')).body.scope, 'user');
    });

    it('falls back to memory when a query fails, keeps the cap, warns at most once a minute, and refunds memory', async () => {
        const logger = recorder();
        const pool = fakePool({ fail: /ai_daily_usage/ });
        const { call, clock } = setup({ env: { AI_CAP_USER_LLM: '1' }, pool, logger });
        const first = await call('llm');
        assert.equal(first.status, 200, 'the request passes');
        assert.equal((await call('llm')).status, 429, 'the cap is still enforced in memory');
        assert.equal(logger.lines.filter((line) => line.includes('[AI caps]') && line.includes('failed')).length, 1);
        assert.match(logger.lines[0], /migration 013/);

        await first.handle.refund();
        assert.ok(!pool.queries.some((q) => q.sql.startsWith('update ai_daily_usage')), 'the refund goes to the store that charged it');
        assert.equal((await call('llm')).status, 200, 'refunded in memory');

        clock.now += 61 * 1000;
        await call('llm');
        assert.equal(logger.lines.filter((line) => line.includes('failed')).length, 2, 'warns again after a minute');
    });

    it('a failed role lookup counts the caller as a learner and is not cached', async () => {
        const logger = recorder();
        const pool = fakePool({ fail: /user_profiles/ });
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '1' }, pool, logger });
        assert.equal((await call('image')).status, 200);
        assert.equal((await call('image')).body.scope, 'user');
        assert.equal(pool.queries.filter((q) => q.sql.startsWith('select role')).length, 2, 'asked again');
        assert.match(logger.lines.join('\n'), /reading the user role failed .*not an admin/);
    });

    it('without a pool, logs once that the caps are in memory', async () => {
        const logger = recorder();
        const { call } = setup({ logger });
        await call('llm');
        await call('image');
        assert.equal(logger.lines.filter((line) => line.includes('DATABASE_URL_PHASE1 is not set')).length, 1);
    });
});

describe('per-address cap', () => {
    it('ipSubject: public addresses only; IPv4-mapped IPv6 as IPv4; IPv6 by its /56', () => {
        assert.equal(ipSubject('203.0.113.7'), 'ip:203.0.113.7');
        assert.equal(ipSubject('::ffff:203.0.113.7'), 'ip:203.0.113.7');
        assert.equal(ipSubject('2001:db8:1:2::5'), 'ip:2001:db8:1::/56');
        assert.equal(ipSubject('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'), 'ip:2001:db8:1::/56');
        assert.equal(ipSubject('2001:db8:1:2ff:aaaa::1'), 'ip:2001:db8:1:200::/56');
        assert.equal(ipSubject('2001:db8::1'), 'ip:2001:db8::/56');
        assert.equal(ipSubject('2001:db8:1:2::5%eth0'), 'ip:2001:db8:1::/56', 'zone id ignored');
        for (const internal of ['127.0.0.1', '::ffff:127.0.0.1', '::1', '10.1.2.3', '172.20.0.5', '192.168.1.9', '100.100.1.1', '169.254.1.1', 'fd12::1', 'fe80::1%eth0', '', undefined, null, 'unknown']) {
            assert.equal(ipSubject(internal), null, String(internal));
        }
    });

    it('stops several accounts from one address, and gives the refused caller their user slot back', async () => {
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '5', AI_CAP_IP_IMAGE: '2' } });
        assert.equal((await call('image', 'user-a', undefined, '203.0.113.7')).status, 200);
        assert.equal((await call('image', 'user-b', undefined, '203.0.113.7')).status, 200);
        const third = await call('image', 'user-c', undefined, '203.0.113.7');
        assert.equal(third.status, 429);
        assert.equal(third.body.scope, 'ip');
        assert.equal(third.body.kind, 'image');
        assert.match(third.body.reset_at, /T15:00:00\.000Z$/);
        assert.equal((await call('image', 'user-c', undefined, '198.51.100.4')).status, 200, 'another address');
        assert.equal((await call('image', 'user-a', undefined, '2001:db8:1:2::5')).status, 200);
        assert.equal((await call('image', 'user-b', undefined, '2001:db8:1:2:aaaa::9')).status, 200);
        assert.equal((await call('image', 'user-c', undefined, '2001:db8:1:2:ffff::1')).status, 429, 'same IPv6 /64');
        assert.equal((await call('image', 'user-d', undefined, '10.0.0.8')).status, 200, 'private addresses are not counted');
        assert.equal((await call('image', 'user-e', undefined, '10.0.0.8')).status, 200);
        assert.equal((await call('image', 'user-f', undefined, '10.0.0.8')).status, 200);
    });

    it('groups IPv6 callers by their /56: addresses in one /56 share the cap, other /56s do not', async () => {
        const { call } = setup({ env: { AI_CAP_USER_IMAGE: '5', AI_CAP_IP_IMAGE: '2' } });
        assert.equal((await call('image', 'user-a', undefined, '2001:db8:1:2::5')).status, 200);
        assert.equal((await call('image', 'user-b', undefined, '2001:db8:1:7f::9')).status, 200, 'another /64, same /56');
        const third = await call('image', 'user-c', undefined, '2001:db8:1:ff:1234::1');
        assert.equal(third.status, 429, 'a third /64 inside the same /56');
        assert.equal(third.body.scope, 'ip');
        assert.equal((await call('image', 'user-c', undefined, '2001:db8:1:100::1')).status, 200, 'the next /56');
        assert.equal((await call('image', 'user-d', undefined, '2001:db8:2::1')).status, 200, 'another network');
    });

    it('refund gives the address slot back too; admins skip the address cap', async () => {
        const pool = fakePool({ role: 'admin' });
        const { call } = setup({ env: { AI_CAP_IP_LLM: '1' }, pool });
        assert.equal((await call('llm', 'admin-1', undefined, '203.0.113.7')).status, 200);
        assert.equal((await call('llm', 'admin-1', undefined, '203.0.113.7')).status, 200, 'admin: no address cap');
        assert.ok(!pool.queries.some((q) => q.sql.startsWith('insert') && q.params[2] === 'ip:203.0.113.7'));

        const { call: learner } = setup({ env: { AI_CAP_IP_LLM: '1' } });
        const first = await learner('llm', 'user-a', undefined, '203.0.113.7');
        assert.equal((await learner('llm', 'user-b', undefined, '203.0.113.7')).body.scope, 'ip');
        await first.handle.refund();
        assert.equal((await learner('llm', 'user-b', undefined, '203.0.113.7')).status, 200);
    });

    it('charges the address subject in Postgres with its own limit', async () => {
        const pool = fakePool();
        const { call } = setup({ env: { AI_CAP_USER_EMBEDDINGS: '4' }, pool });
        await call('embeddings', 'user-a', undefined, '203.0.113.7');
        const inserts = pool.queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage'));
        assert.deepEqual(inserts.map((q) => q.params.slice(2)), [['user-a', 4], ['ip:203.0.113.7', 12], ['*', 100]]);
    });
});

describe('database outage and owner alerts', () => {
    it('during an outage the all-users cap is a tenth of its value in this process; past it, 503 (not the daily cap)', async () => {
        const pool = fakePool({ fail: /ai_daily_usage/ });
        const { call } = setup({ env: { AI_CAP_GLOBAL_LLM: '20' }, pool });
        assert.equal((await call('llm', 'user-a')).status, 200);
        assert.equal((await call('llm', 'user-b')).status, 200);
        const third = await call('llm', 'user-c');
        assert.equal(third.status, 503);
        assert.deepEqual(Object.keys(third.body).sort(), ['error', 'error_type']);
        assert.equal(third.body.error_type, 'ai_unavailable');
        assert.equal(third.res.headers['retry-after'], '60', 'a short wait, no reset time');
    });

    it('an outage does not send a false "reached" alert, so the real one still goes out once', async () => {
        const posted = [];
        const fetch = async (url, init) => {
            posted.push(JSON.parse(init.body).text);
            return { ok: true, status: 200 };
        };
        const logger = recorder();
        const pool = fakePool({ fail: /ai_daily_usage/ });
        const { call, clock } = setup({
            env: { AI_CAP_GLOBAL_LLM: '20', AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/alert' },
            pool,
            logger,
            fetch,
        });
        const reached = () => logger.lines.filter((line) => line.includes('global daily cap reached: llm')).length;

        // The database throws: this process may use 2 of 20 from memory, then answers 503.
        assert.equal((await call('llm', 'outage-1')).status, 200);
        assert.equal((await call('llm', 'outage-2')).status, 200);
        assert.equal((await call('llm', 'outage-3')).status, 503);
        assert.equal((await call('llm', 'outage-4')).status, 503);
        assert.equal(reached(), 0, 'the outage share is not the daily cap');
        assert.equal(logger.lines.filter((line) => line.includes('all-users outage share used up: llm')).length, 1, 'warned once a minute');

        // The database answers again; then the real cap of 20 is used up.
        clock.now += 61 * 1000;
        pool.setFail(null);
        for (let i = 0; i < 20; i += 1) assert.equal((await call('llm', `user-${i}`)).status, 200, `call ${i + 1}`);
        const refused = await call('llm', 'user-late');
        assert.equal(refused.status, 429);
        assert.equal(refused.body.scope, 'global');
        await call('llm', 'user-later');
        await tick();
        assert.equal(reached(), 1, 'exactly one reached alert, for the real cap');
        assert.equal(posted.filter((text) => text.includes('global daily cap reached: llm')).length, 1);
    });

    it('posts the 80% and reached alerts once a day to AI_CAP_ALERT_WEBHOOK_URL', async () => {
        const posted = [];
        const fetch = async (url, init) => {
            posted.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200 };
        };
        const logger = recorder();
        const { call, clock } = setup({
            env: { AI_CAP_GLOBAL_IMAGE: '5', AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/alert' },
            logger,
            fetch,
        });
        for (const user of ['a', 'b', 'c']) assert.equal((await call('image', user)).status, 200);
        assert.equal(posted.length, 0, 'below 80%');
        await call('image', 'd');
        await call('image', 'e');
        await call('image', 'f');
        await call('image', 'g');
        await tick();
        assert.equal(posted.length, 2);
        assert.equal(posted[0].url, 'https://hooks.example/alert');
        assert.match(posted[0].body.text, /global daily cap 80% used: image \(5\)/);
        assert.equal(posted[0].body.content, posted[0].body.text);
        assert.match(posted[1].body.text, /global daily cap reached: image \(5\) on 2026-10-22 JST/);
        assert.equal(logger.lines.filter((line) => line.includes('global daily cap')).length, 2);

        clock.now = Date.parse('2026-10-22T15:00:01Z');
        for (const user of ['a', 'b', 'c', 'd', 'e', 'f']) await call('image', user);
        await tick();
        assert.equal(posted.length, 4, 'a new Japan-time day alerts again');
    });

    it('does not post without a webhook, or to a URL that is not https (http only to localhost)', async () => {
        const urls = [];
        const fetch = async (url) => {
            urls.push(url);
            return { ok: true, status: 200 };
        };
        const logger = recorder();
        const { call } = setup({ env: { AI_CAP_GLOBAL_IMAGE: '1' }, logger, fetch });
        await call('image', 'a');
        await call('image', 'b');
        for (const url of ['file:///etc/passwd', 'http://hooks.example/alert']) {
            const bad = setup({ env: { AI_CAP_GLOBAL_IMAGE: '1', AI_CAP_ALERT_WEBHOOK_URL: url }, logger, fetch });
            await bad.call('image', 'a');
        }
        await tick();
        assert.deepEqual(urls, []);
        assert.match(logger.lines.join('\n'), /must use https:\/\//);
        const local = setup({ env: { AI_CAP_GLOBAL_IMAGE: '1', AI_CAP_ALERT_WEBHOOK_URL: 'http://127.0.0.1:9/alert' }, logger, fetch });
        await local.call('image', 'a');
        await tick();
        assert.deepEqual(urls, ['http://127.0.0.1:9/alert'], 'a relay on this machine may use http://');
    });

    it('never logs the webhook URL (a secret): not when it is invalid, refused, or the post fails', async () => {
        const secret = 'T0SECRET/B0SECRET/xoxSECRET';
        const fetch = async (url) => {
            throw Object.assign(new TypeError(`fetch failed for ${url}`), {
                cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url}`), { code: 'ENOTFOUND' }),
            });
        };
        const logger = recorder();
        for (const url of [`https://hooks.example/services/${secret}`, `https://hooks example/${secret}`, `http://hooks.example/${secret}`]) {
            const { call } = setup({ env: { AI_CAP_GLOBAL_IMAGE: '1', AI_CAP_ALERT_WEBHOOK_URL: url }, logger, fetch });
            await call('image', 'a');
            await call('image', 'b');
        }
        await tick();
        const log = logger.lines.join('\n');
        assert.match(log, /the alert webhook failed \(ENOTFOUND\)/);
        assert.match(log, /AI_CAP_ALERT_WEBHOOK_URL is not a valid URL/);
        assert.match(log, /AI_CAP_ALERT_WEBHOOK_URL must use https:\/\//);
        assert.ok(!log.includes('SECRET'), log);
        assert.ok(!log.includes('hooks.example'), log);
    });
});

// Phase 3: supporters (the paid plan). The resolver is the only seam: without one (mcp-public, and
// the API while billing is off) nothing changes; with one, only the kinds it answers for get the
// supporter's limit, no per-address charge and the '*supporter' pool.
describe('supporter plan resolver', () => {
    /** A resolver answering supporter for `users` on llm and course_generation, null for others. */
    const resolverFor = (users, { user = 100, global = 1000, calls = [] } = {}) => async ({ kind, userId }) => {
        calls.push([kind, userId]);
        if (kind !== 'llm' && kind !== 'course_generation') return null;
        return users.includes(userId) ? { plan: 'supporter', user, global } : { plan: 'free' };
    };

    it('without a resolver the 429 body and the SQL are exactly as before (no plan field)', async () => {
        const pool = fakePool();
        const { call } = setup({ env: { AI_CAP_USER_LLM: '1' }, pool });
        assert.equal((await call('llm', 'user-a', undefined, '203.0.113.7')).status, 200);
        const refused = await call('llm', 'user-a', undefined, '203.0.113.7');
        assert.deepEqual(Object.keys(refused.body).sort(), ['error', 'error_type', 'kind', 'reset_at', 'scope']);
        assert.deepEqual(pool.queries.filter((q) => q.sql.startsWith('insert')).map((q) => q.params.slice(1)), [
            ['llm', 'user-a', 1], ['llm', 'ip:203.0.113.7', 3], ['llm', '*', 1500], ['llm', 'user-a', 1],
        ]);
        assert.equal('plan' in dailyLimitRefusal({ kind: 'llm', scope: 'user' }).body, false);
    });

    it('a free user keeps exactly today\'s subjects and SQL; the 429 says plan free', async () => {
        const pool = fakePool();
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '1' }, pool });
        caps.setPlanResolver(resolverFor([]));
        assert.equal((await call('llm', 'user-a', undefined, '203.0.113.7')).status, 200);
        const refused = await call('llm', 'user-a', undefined, '203.0.113.7');
        assert.equal(refused.status, 429);
        assert.equal(refused.body.scope, 'user');
        assert.equal(refused.body.plan, 'free');
        assert.deepEqual(pool.queries.map((q) => [q.sql.split(' ').slice(0, 3).join(' '), ...q.params.slice(1)]), [
            ['select role from', undefined, undefined],
            ['insert into ai_daily_usage', 'llm', 'user-a', 1],
            ['insert into ai_daily_usage', 'llm', 'ip:203.0.113.7', 3],
            ['insert into ai_daily_usage', 'llm', '*', 1500],
            ['insert into ai_daily_usage', 'llm', 'user-a', 1],
        ].map((r) => r.filter((v) => v !== undefined)));
    });

    it("a supporter: the resolver's user limit, no per-address charge, the '*supporter' pool", async () => {
        const pool = fakePool();
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '1', AI_CAP_IP_LLM: '1' }, pool });
        caps.setPlanResolver(resolverFor(['fan'], { user: 2, global: 1000 }));
        assert.equal((await call('llm', 'fan', undefined, '203.0.113.7')).status, 200);
        assert.equal((await call('llm', 'fan', undefined, '203.0.113.7')).status, 200, 'past the free cap of 1 and the address cap of 1');
        const third = await call('llm', 'fan', undefined, '203.0.113.7');
        assert.equal(third.status, 429);
        assert.equal(third.body.scope, 'user');
        assert.equal(third.body.plan, 'supporter');
        const inserts = pool.queries.filter((q) => q.sql.startsWith('insert into ai_daily_usage')).map((q) => q.params);
        assert.deepEqual(inserts.slice(0, 2), [['2026-10-22', 'llm', 'fan', 2], ['2026-10-22', 'llm', SUPPORTER_GLOBAL_SUBJECT, 1000]]);
        assert.ok(!inserts.some((p) => String(p[2]).startsWith('ip:')), 'no address subject');
        assert.ok(!inserts.some((p) => p[2] === '*'), 'not the free pool');
        assert.equal(SUPPORTER_GLOBAL_SUBJECT, '*supporter');
        // A free user at the same address is still counted there and in '*'.
        assert.equal((await call('llm', 'free-1', undefined, '203.0.113.7')).status, 200);
        assert.deepEqual(pool.queries.filter((q) => q.sql.startsWith('insert')).slice(-3).map((q) => q.params[2]), ['free-1', 'ip:203.0.113.7', '*']);
    });

    it('the supporter pool stops supporters only; the free pool does not stop them', async () => {
        const { caps, call } = setup({ env: { AI_CAP_GLOBAL_COURSE_GENERATION: '1' } });
        caps.setPlanResolver(resolverFor(['fan-1', 'fan-2'], { user: 30, global: 1 }));
        assert.equal((await call('course_generation', 'free-1')).status, 200);
        assert.equal((await call('course_generation', 'free-2')).body.scope, 'global', 'the free pool of 1 is used up');
        assert.equal((await call('course_generation', 'fan-1')).status, 200, 'supporters have their own pool');
        const refused = await call('course_generation', 'fan-2');
        assert.equal(refused.body.scope, 'global');
        assert.equal(refused.body.plan, 'supporter');
    });

    it('0 in the free caps turns the kind off for supporters too; a supporter pool of 0 only for supporters', async () => {
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '0' } });
        caps.setPlanResolver(resolverFor(['fan'], { user: 100, global: 1000 }));
        const off = await call('llm', 'fan');
        assert.equal(off.body.scope, 'off');
        assert.equal(off.body.plan, 'supporter');
        const second = setup({});
        second.caps.setPlanResolver(resolverFor(['fan'], { user: 100, global: 0 }));
        assert.equal((await second.call('llm', 'fan')).body.scope, 'off');
        assert.equal((await second.call('llm', 'free')).status, 200);
    });

    it('the mcp kinds never consult the resolver; other kinds get null and stay free', async () => {
        const calls = [];
        const { caps, call } = setup({ env: { AI_CAP_USER_IMAGE: '1' } });
        caps.setPlanResolver(async (caller) => {
            calls.push(caller.kind);
            return { plan: 'supporter', user: 9999, global: 9999 };
        });
        for (const kind of ['mcp', 'mcp_write']) {
            const { handle } = await caps.reserveFor({ kind, userId: 'fan' });
            assert.ok(handle, kind);
        }
        assert.deepEqual(calls, [], 'mcp kinds are not looked up');
        const nullCaps = setup({ env: { AI_CAP_USER_IMAGE: '1' } });
        nullCaps.caps.setPlanResolver(resolverFor(['fan']));
        assert.equal((await nullCaps.call('image', 'fan')).status, 200);
        const refused = await nullCaps.call('image', 'fan');
        assert.equal(refused.body.scope, 'user', 'image keeps the free cap of 1');
        assert.equal(refused.body.plan, 'free');
    });

    it('a resolver that fails or answers nonsense counts the caller as free (warned once a minute)', async () => {
        const logger = recorder();
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '1' }, logger });
        caps.setPlanResolver(async () => {
            throw new Error('billing db down');
        });
        assert.equal((await call('llm', 'fan')).status, 200);
        const refused = await call('llm', 'fan');
        assert.equal(refused.body.scope, 'user');
        assert.equal(refused.body.plan, 'free');
        assert.equal(logger.lines.filter((l) => l.includes('plan lookup failed')).length, 1);
        for (const answer of [{ plan: 'supporter', user: -1, global: 10 }, { plan: 'supporter', user: 1.5, global: 10 }, { plan: 'gold', user: 10, global: 10 }]) {
            const other = setup({ env: { AI_CAP_USER_LLM: '1' } });
            other.caps.setPlanResolver(async () => answer);
            await other.call('llm', 'fan');
            assert.equal((await other.call('llm', 'fan')).body.plan, 'free', JSON.stringify(answer));
        }
    });

    it('an admin supporter skips the user cap and is charged to the supporter pool', async () => {
        const pool = fakePool({ role: 'admin' });
        const { caps, call } = setup({ pool });
        caps.setPlanResolver(resolverFor(['admin-1'], { user: 100, global: 1000 }));
        assert.equal((await call('llm', 'admin-1', undefined, '203.0.113.7')).status, 200);
        assert.deepEqual(pool.queries.filter((q) => q.sql.startsWith('insert')).map((q) => q.params[2]), [SUPPORTER_GLOBAL_SUBJECT]);
    });

    it("the outage share and the owner alerts cover '*supporter' on their own", async () => {
        const logger = recorder();
        const posted = [];
        const pool = fakePool({ fail: /ai_daily_usage/ });
        const { caps, call } = setup({
            env: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/alert', AI_CAP_GLOBAL_LLM: '5' },
            pool,
            logger,
            fetch: async (url, init) => {
                posted.push(JSON.parse(init.body).text);
                return { ok: true, status: 200 };
            },
        });
        caps.setPlanResolver(resolverFor(['fan-1', 'fan-2', 'fan-3'], { user: 100, global: 20 }));
        assert.equal((await call('llm', 'fan-1')).status, 200);
        assert.equal((await call('llm', 'fan-2')).status, 200);
        const busy = await call('llm', 'fan-3');
        assert.equal(busy.status, 503, 'a tenth of the supporter pool of 20');
        assert.match(logger.lines.join('\n'), /supporter all-users outage share used up: llm \(2 of AI_CAP_SUPPORTER_GLOBAL_LLM=20\)/);
        assert.equal((await call('llm', 'free-1')).status, 200, 'the free outage share is separate');

        pool.setFail(null);
        const fans = setup({ env: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.example/alert' }, logger, fetch: async (url, init) => {
            posted.push(JSON.parse(init.body).text);
            return { ok: true, status: 200 };
        } });
        fans.caps.setPlanResolver(resolverFor(['a', 'b', 'c', 'd', 'e', 'f'], { user: 100, global: 5 }));
        for (const user of ['a', 'b', 'c', 'd', 'e', 'f']) await fans.call('llm', user);
        await tick();
        assert.ok(posted.some((t) => /supporter global daily cap 80% used: llm \(5\).*AI_CAP_SUPPORTER_GLOBAL_LLM/.test(t)), posted.join('\n'));
        assert.ok(posted.some((t) => /supporter global daily cap reached: llm \(5\).*Supporters are refused/.test(t)), posted.join('\n'));
        assert.ok(!posted.some((t) => t.startsWith('[AI caps] global daily cap')), 'the free pool alert stays free for the real one');
    });

    it('usageFor reads the caller\'s count with the plan-aware limit (memory and Postgres)', async () => {
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '40' } });
        assert.deepEqual(await caps.usageFor({ kind: 'llm', userId: 'fan' }), { used: 0, limit: 40, plan: 'free' });
        caps.setPlanResolver(resolverFor(['fan'], { user: 100, global: 1000 }));
        await call('llm', 'fan');
        await call('llm', 'fan');
        assert.deepEqual(await caps.usageFor({ kind: 'llm', userId: 'fan' }), { used: 2, limit: 100, plan: 'supporter' });
        assert.deepEqual(await caps.usageFor({ kind: 'course_generation', userId: 'other' }), { used: 0, limit: 20, plan: 'free' });
        assert.deepEqual(await caps.usageFor({ kind: 'llm', userId: '' }), { used: 0, limit: 40, plan: 'free' });

        const pool = fakePool();
        const pg = setup({ env: { AI_CAP_USER_COURSE_GENERATION: '0' }, pool });
        pool.rows.set('2026-10-22|llm|user-a', 7);
        const orig = pool.query.bind(pool);
        pool.query = async (text, params) => {
            const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
            if (sql.startsWith('select count from ai_daily_usage')) {
                pool.queries.push({ sql, params });
                const count = pool.rows.get(`${params[0]}|${params[1]}|${params[2]}`);
                return { rows: count === undefined ? [] : [{ count }] };
            }
            return orig(text, params);
        };
        assert.deepEqual(await pg.caps.usageFor({ kind: 'llm', userId: 'user-a' }), { used: 7, limit: 50, plan: 'free' });
        assert.equal(pool.queries.at(-1).sql, 'select count from ai_daily_usage where usage_day = $1::date and kind = $2 and subject = $3');
        assert.deepEqual(pool.queries.at(-1).params, ['2026-10-22', 'llm', 'user-a']);
        assert.deepEqual(await pg.caps.usageFor({ kind: 'course_generation', userId: 'user-a' }), { used: 0, limit: 0, plan: 'free' }, 'off: limit 0');
        await assert.rejects(pg.caps.usageFor({ kind: 'nope', userId: 'x' }));
    });

    it('reset() clears the resolver; the process-wide setter is the singleton\'s', async () => {
        const { caps, call } = setup({ env: { AI_CAP_USER_LLM: '1' } });
        caps.setPlanResolver(resolverFor(['fan'], { user: 5, global: 1000 }));
        caps.reset();
        await call('llm', 'fan');
        const refused = await call('llm', 'fan');
        assert.equal(refused.body.scope, 'user');
        assert.equal('plan' in refused.body, false, 'no resolver after reset');
        assert.equal(typeof setPlanResolver, 'function');
        setPlanResolver(resolverFor(['fan']));
        resetDailyCapsForTests();
        caps.setPlanResolver(null);
    });
});
