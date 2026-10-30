// The terms check on the remote MCP endpoint (Phase 8, S5; mcp-server/remotePolicy.js with
// tools/core/legalAcceptance.js createRemoteTermsCheck), in process as mcpRemote.test.js: a fake
// Supabase, a fake pg pool that answers the acceptance read (the default reader, through getPool()),
// the AI access, grants and tool queries, and the MCP SDK client.
// - LEGAL_TERMS_REQUIRED on, not accepted: every tools/call is a terms_required tool error (both
//   languages, a link to the app) charged nothing; resources/read and prompts/get answer -32003;
//   the terms come before the AI access (an unaccepted minor is told about the terms);
// - accepted: the tools work; a read error: legal_unavailable (fail closed, logged);
// - the cache: "not accepted" read again after 5 s, "accepted" kept 60 s;
// - switch off: no acceptance read and no startup line (the endpoint behaves as before).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createRemotePolicy } from '../../mcp-server/remotePolicy.js';
import { REMOTE_ACCESS_REFUSED } from '../../mcp-server/createMcpServer.js';
import {
    LATEST_ACCEPTANCE_SQL,
    TERMS_MESSAGES,
    createRemoteTermsCheck,
    termsRefusal,
    termsSettingsUrl,
    termsSwitchLine,
} from '../../tools/core/legalAcceptance.js';
import { currentLegalVersions } from '../../shared/legal/versions.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';
import { connectRemoteClient, startRemoteEndpoint } from './helpers/remoteMcpEndpoint.js';

const ADULT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const ADULT_ACCEPTED = 'a2a2a2a2-0000-4000-8000-0000000000a2';
const MINOR = 'b1b1b1b1-0000-4000-8000-0000000000b1';
const ADULT_FAIL = 'a3a3a3a3-0000-4000-8000-0000000000a3';
const CURRENT = currentLegalVersions();
const LATEST = LATEST_ACCEPTANCE_SQL.replace(/\s+/g, ' ').toLowerCase();

const logs = [];
const capture = (...args) => logs.push(args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
const logger = { log: capture, warn: capture, error: capture };
const parse = (result) => JSON.parse(result.content[0].text);

/** The AI access pool plus the acceptance read and the learner-remote tool queries. */
function termsPool({ accepted = [], failFor = [] } = {}) {
    const acceptedSet = new Set(accepted);
    const failing = new Set(failFor);
    return createAiAccessPool({
        ages: { [ADULT]: '1990-01', [ADULT_ACCEPTED]: '1985-06', [ADULT_FAIL]: '1980-03', [MINOR]: '2012-05' },
        answer: (sql, params) => {
            if (sql === LATEST) {
                if (failing.has(params[0])) throw Object.assign(new Error('permission denied for table legal_acceptances'), { code: '42501' });
                return acceptedSet.has(params[0])
                    ? { rowCount: 1, rows: [{ terms_version: CURRENT.terms, privacy_version: CURRENT.privacy, accepted_at: new Date() }] }
                    : { rowCount: 0, rows: [] };
            }
            if (sql.startsWith('select 1 from mcp_oauth_grants')) return { rows: [] };
            if (sql.startsWith('insert into mcp_oauth_grants')) return { rowCount: 1, rows: [] };
            if (sql.startsWith('select course_id, completed_stages')) return { rows: [] };
            return undefined;
        },
    });
}

describe('remote MCP: the terms check (LEGAL_TERMS_REQUIRED on)', () => {
    let fake;
    let endpoint;
    let pool;
    const clients = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    const connect = async (sub) => {
        const client = await connectRemoteClient(endpoint, fake.accessToken({ resource: endpoint.resource, sub }));
        clients.push(client);
        return client;
    };
    const acceptanceReads = () => pool.queries.filter((q) => q.sql === LATEST);
    /** Every daily-cap reservation the policy made (the refusal must come before any). */
    const charges = [];
    const reserveCap = async ({ kind, userId }) => {
        charges.push(`${kind} ${userId}`);
        return { handle: { refund: async () => {} } };
    };

    before(async () => {
        console.log = capture;
        console.warn = capture;
        console.error = capture;
        fake = await startFakeSupabase();
        endpoint = await startRemoteEndpoint({ fake, logger, policyEnv: { LEGAL_TERMS_REQUIRED: 'true' }, reserveCap });
    });

    after(async () => {
        for (const client of clients) await client.close().catch(() => {});
        await endpoint.close();
        await fake.close();
        resetPoolForTests();
        resetAiAccessForTests();
        Object.assign(console, saved);
    });

    beforeEach(() => {
        pool = termsPool({ accepted: [ADULT_ACCEPTED], failFor: [ADULT_FAIL] });
        setPoolForTests(pool);
        resetAiAccessForTests();
        charges.length = 0;
    });

    it('not accepted: every tool call is a terms_required tool error in both languages with the app link, and nothing is charged', async () => {
        const client = await connect(ADULT);
        const { tools } = await client.listTools();
        assert.ok(tools.length > 5, 'initialize and the list methods are not gated');
        for (const name of ['learner-state-get', 'journal-recent', 'course-list']) {
            const result = await client.callTool({ name, arguments: {} });
            assert.equal(result.isError, true, name);
            const body = parse(result);
            assert.equal(body.error_type, 'terms_required', name);
            assert.deepEqual(body.message, TERMS_MESSAGES.terms_required);
            assert.equal(body.settings_url, 'https://app.example.org/');
            assert.equal(body.error, `${TERMS_MESSAGES.terms_required.en} https://app.example.org/\n${TERMS_MESSAGES.terms_required.jp} https://app.example.org/`);
        }
        assert.deepEqual(charges, [], 'a refused call is never counted against the daily caps');
        assert.equal(pool.queries.filter((q) => q.sql.startsWith('select course_id')).length, 0, 'no tool ran');
        assert.deepEqual(acceptanceReads().map((q) => q.params), [[ADULT]], 'one read (the default reader, through getPool()), then the kept answer');
        assert.equal(pool.accessQueries().length, 0, 'the terms come first: the AI access was not read');
    });

    it('resources/read and prompts/get answer -32003 with error_type terms_required', async () => {
        const client = await connect(ADULT);
        const text = parse(await client.callTool({ name: 'learner-state-get', arguments: {} })).error;
        const refused = (error) => error.code === REMOTE_ACCESS_REFUSED
            && error.message === `MCP error ${REMOTE_ACCESS_REFUSED}: ${text}`
            && error.data?.error_type === 'terms_required'
            && error.data?.settings_url === 'https://app.example.org/';
        await assert.rejects(client.readResource({ uri: 'content://domains' }), refused);
        await assert.rejects(client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 't' } }), refused);
    });

    it('terms before AI access: a minor who has not accepted is told about the terms, not sent to /settings/ai-access', async () => {
        const client = await connect(MINOR);
        const body = parse(await client.callTool({ name: 'learner-state-get', arguments: {} }));
        assert.equal(body.error_type, 'terms_required');
        assert.equal(pool.accessQueries().length, 0);
    });

    it('accepted: the tools work (the AI access check still runs after the terms)', async () => {
        const client = await connect(ADULT_ACCEPTED);
        const result = await client.callTool({ name: 'learner-state-get', arguments: {} });
        assert.ok(!result.isError, result.content[0].text);
        assert.equal(acceptanceReads().length, 1);
        assert.ok(pool.accessQueries().length > 0, 'then the adults-only check');
        assert.deepEqual(charges, [`mcp ${ADULT_ACCEPTED}`], 'and the daily cap');
    });

    it('a read that fails: legal_unavailable (fail closed), the SQLSTATE in the log, nothing charged', async () => {
        const before = logs.length;
        const client = await connect(ADULT_FAIL);
        const body = parse(await client.callTool({ name: 'learner-state-get', arguments: {} }));
        assert.equal(body.error_type, 'legal_unavailable');
        assert.deepEqual(body.message, TERMS_MESSAGES.legal_unavailable);
        assert.equal(body.settings_url, undefined, 'nothing to do in the app');
        assert.deepEqual(charges, []);
        assert.ok(logs.slice(before).some((line) => line === '[MCP remote] terms check unavailable (42501); calls answer legal_unavailable'), logs.slice(before).join('\n'));
    });
});

describe('createRemoteTermsCheck (injected reader and clock)', () => {
    const ON = { LEGAL_TERMS_REQUIRED: 'true', APP_PUBLIC_URL: 'https://app.example.org/some/path?x=1' };
    const reader = (accepted) => {
        const calls = [];
        return {
            calls,
            query: async (sql, params) => {
                calls.push([sql, params]);
                return { rows: accepted.has(params[0]) ? [{ terms_version: CURRENT.terms, privacy_version: CURRENT.privacy }] : [] };
            },
        };
    };

    it('"not accepted" is read again after 5 s (mcp-public cannot see the api\'s acceptance), "accepted" kept 60 s', async () => {
        let t = 0;
        const accepted = new Set();
        const r = reader(accepted);
        const check = createRemoteTermsCheck({ env: ON, query: r.query, now: () => t, logger: { warn: () => {} } });
        assert.equal((await check.refusal(ADULT))?.error_type, 'terms_required');
        accepted.add(ADULT);
        t = 4_999;
        assert.equal((await check.refusal(ADULT))?.error_type, 'terms_required');
        t = 5_000;
        assert.equal(await check.refusal(ADULT), null);
        accepted.delete(ADULT);
        t = 64_999;
        assert.equal(await check.refusal(ADULT.toUpperCase()), null, 'kept, under the canonical id');
        t = 65_000;
        assert.equal((await check.refusal(ADULT))?.error_type, 'terms_required');
        assert.equal(r.calls.length, 3);
        assert.deepEqual(r.calls[0], [LATEST_ACCEPTANCE_SQL, [ADULT]]);
    });

    it('off (unset, false, unrecognised, production with the drafts): null without a read', async () => {
        const r = reader(new Set());
        for (const env of [{}, { LEGAL_TERMS_REQUIRED: 'false' }, { LEGAL_TERMS_REQUIRED: 'nope' }, { LEGAL_TERMS_REQUIRED: 'true', NODE_ENV: 'production' }]) {
            const check = createRemoteTermsCheck({ env, query: r.query });
            assert.equal(check.enforcement.on, false, JSON.stringify(env));
            assert.equal(await check.refusal(ADULT), null);
        }
        assert.equal(r.calls.length, 0);
    });

    it('an id that is not a uuid: legal_unavailable without a read; the link is the app\'s home page', async () => {
        const r = reader(new Set());
        const check = createRemoteTermsCheck({ env: ON, query: r.query });
        assert.equal((await check.refusal('nope'))?.error_type, 'legal_unavailable');
        assert.equal(r.calls.length, 0);
        assert.equal(termsSettingsUrl(ON), 'https://app.example.org/');
        assert.equal(termsSettingsUrl({ APP_PUBLIC_URL: 'javascript:alert(1)' }), null);
        assert.equal(termsSettingsUrl({ APP_PUBLIC_URL: ' ' }), null);
        assert.deepEqual(termsRefusal('terms_required'), { error: `${TERMS_MESSAGES.terms_required.en}\n${TERMS_MESSAGES.terms_required.jp}`, error_type: 'terms_required', message: TERMS_MESSAGES.terms_required });
    });

    it('a read that fails: legal_unavailable every time, never kept, and the warning naming the SQLSTATE at most once a minute', async () => {
        let t = 0;
        let reads = 0;
        const warnings = [];
        const check = createRemoteTermsCheck({
            env: ON,
            query: async () => {
                reads += 1;
                throw Object.assign(new Error('permission denied for table legal_acceptances'), { code: '42501' });
            },
            now: () => t,
            logger: { warn: (line) => warnings.push(line) },
        });
        const line = '[MCP remote] terms check unavailable (42501); calls answer legal_unavailable';
        assert.equal((await check.refusal(ADULT))?.error_type, 'legal_unavailable');
        t = 1_000;
        assert.equal((await check.refusal(ADULT))?.error_type, 'legal_unavailable');
        assert.deepEqual(warnings, [line], 'one line for two refusals 1 s apart');
        t = 59_999;
        assert.equal((await check.refusal(ADULT))?.error_type, 'legal_unavailable');
        assert.equal(warnings.length, 1, 'still within the minute of the first line');
        t = 60_000;
        assert.equal((await check.refusal(ADULT))?.error_type, 'legal_unavailable');
        assert.deepEqual(warnings, [line, line], 'a minute after the first line: one more');
        assert.equal(reads, 4, 'an error is never kept');
    });

    it('createRemotePolicy: the terms refusal comes before the AI access check and the caps', async () => {
        const order = [];
        const policy = createRemotePolicy({
            env: {},
            terms: { refusal: async (userId) => { order.push(`terms ${userId}`); return termsRefusal('terms_required'); } },
            reserveCap: async () => { order.push('cap'); return { handle: { refund: async () => {} } }; },
        });
        const gate = await policy.gate({ authInfo: { token: 't', clientId: 'c', scopes: [], extra: { userId: ADULT } } });
        assert.equal(gate.refusal?.error_type, 'terms_required', JSON.stringify(gate));
        assert.deepEqual(order, [`terms ${ADULT}`]);
    });
});

describe('remote MCP with the switch off (the default)', () => {
    let fake;
    let endpoint;
    const clients = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };

    let logsBefore = 0;

    before(async () => {
        console.log = capture;
        console.warn = capture;
        console.error = capture;
        logsBefore = logs.length;
        fake = await startFakeSupabase();
        endpoint = await startRemoteEndpoint({ fake, logger });
    });

    after(async () => {
        for (const client of clients) await client.close().catch(() => {});
        await endpoint.close();
        await fake.close();
        resetPoolForTests();
        resetAiAccessForTests();
        Object.assign(console, saved);
    });

    it('a learner who never accepted uses the tools as before, and the acceptance is never read', async () => {
        const pool = termsPool();
        setPoolForTests(pool);
        const client = await connectRemoteClient(endpoint, fake.accessToken({ resource: endpoint.resource, sub: ADULT }));
        clients.push(client);
        const result = await client.callTool({ name: 'learner-state-get', arguments: {} });
        assert.ok(!result.isError, result.content[0].text);
        assert.equal(pool.queries.filter((q) => /legal_acceptances/.test(q.sql)).length, 0);
    });

    it('no startup line while the switch is unset or off (SG-6)', () => {
        for (const env of [{}, { LEGAL_TERMS_REQUIRED: '' }, { LEGAL_TERMS_REQUIRED: 'false' }, { LEGAL_TERMS_REQUIRED: 'off', NODE_ENV: 'production' }]) {
            assert.equal(termsSwitchLine(env, { label: '[MCP remote]' }), null, JSON.stringify(env));
        }
        assert.ok(!logs.slice(logsBefore).some((line) => /terms check/.test(line)), 'nothing logged about the terms while off');
    });
});
