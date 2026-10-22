import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveMcpUserId,
    registerAgentSession,
    registerAgentTurn,
    buildTurnInstruction,
    getActiveSessionKeyFromEnv,
    clearMcpUserScopeForTests,
    isBridgePlaceholderUserId,
    isTurnToken,
    learnerForTurn,
    TURN_KEY_PREFIX,
} from '../../tools/core/mcpUserScope.js';
import { parseSessionKey } from '../../tools/core/agentSessionStore.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

// USER_A is the bridge placeholder (PHASE1_USER_ID) in these tests; B and C are learners.
const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';
const USER_C = '00000000-0000-0000-0000-0000000000cc';
const ATTACKER = '00000000-0000-0000-0000-0000000000ff';

/** A bridge-token SSE session (authenticated as PHASE1), as mcp-server/index.js stores it. */
const bridgeSessions = (fields = {}) => new Map([['bridge-sse', { userId: USER_A, ...fields }]]);
/** The `extra` the MCP SDK passes for a POST /messages request on that session. */
const bridgeExtra = (headers = {}) => ({ sessionId: 'bridge-sse', requestInfo: { headers } });

describe('parseSessionKey', () => {
    it('parses rp:user session keys', () => {
        assert.equal(parseSessionKey(`rp:user:${USER_A}`), USER_A);
    });
});

describe('resolveMcpUserId', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPhase1 = process.env.PHASE1_USER_ID;
    const prevSessionKey = process.env.RISE_PATH_ACTIVE_SESSION_KEY;

    beforeEach(() => {
        clearMcpUserScopeForTests();
        process.env.NODE_ENV = 'development';
        process.env.PHASE1_USER_ID = USER_A;
        delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
    });

    afterEach(() => {
        clearMcpUserScopeForTests();
        resetPoolForTests();
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
        if (prevPhase1 === undefined) delete process.env.PHASE1_USER_ID;
        else process.env.PHASE1_USER_ID = prevPhase1;
        if (prevSessionKey === undefined) delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
        else process.env.RISE_PATH_ACTIVE_SESSION_KEY = prevSessionKey;
    });

    it('uses SSE session userId over attacker args', async () => {
        const sessions = new Map([['sess-1', { userId: USER_B }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'sess-1' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('scopes learner-profile style resource reads via SSE extra.sessionId', async () => {
        const sessions = new Map([['sse-route-id', { userId: USER_B }]]);
        const result = await resolveMcpUserId({
            argsUserId: undefined,
            extra: { sessionId: 'sse-route-id' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('ignores attacker args in stdio dev and uses session key env', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_B}`;
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.userId, USER_B);
    });

    it('uses the only chatting learner in dev stdio when the env key is absent', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.userId, USER_B);
    });

    it('fails closed in production without session binding', async () => {
        process.env.NODE_ENV = 'production';
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('reads active session key from env helper', () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_A}`;
        assert.equal(getActiveSessionKeyFromEnv(), `rp:user:${USER_A}`);
    });

    it('detects bridge placeholder user ids', () => {
        assert.equal(isBridgePlaceholderUserId(USER_A), true);
        assert.equal(isBridgePlaceholderUserId(USER_B), false);
    });

    it('fails closed for bridge SSE in production without binding', async () => {
        process.env.NODE_ENV = 'production';
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: bridgeExtra(),
            sessions: bridgeSessions(),
        });
        assert.equal(result.error_type, 'session_binding_required');
    });

    describe('bridge SSE without rp_turn', () => {
        it('in production, fails closed even when exactly one learner is chatting', async () => {
            process.env.NODE_ENV = 'production';
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            await registerAgentTurn(USER_B);
            const result = await resolveMcpUserId({ argsUserId: ATTACKER, extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.userId, undefined, 'a bridge-token holder never becomes the chatting learner');
            assert.equal(result.error_type, 'session_binding_required');
            assert.match(result.error, /rp_turn/);
        });

        it('in production, asks the database for no recent learner', async () => {
            process.env.NODE_ENV = 'production';
            const queries = [];
            setPoolForTests({
                async query(sql, params) {
                    queries.push({ sql: String(sql).replace(/\s+/g, ' '), params });
                    return { rowCount: 1, rows: [{ user_id: USER_B, live: true }] };
                },
            });
            const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.error_type, 'session_binding_required');
            assert.ok(!queries.some((q) => /GROUP BY user_id/.test(q.sql)), 'no sole-learner lookup');
            assert.ok(!queries.some((q) => /ORDER BY updated_at DESC LIMIT 1/.test(q.sql)), 'no latest-binding lookup');
        });

        it('in development, acts for the learner when exactly one is chatting', async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            const result = await resolveMcpUserId({ argsUserId: ATTACKER, extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.userId, USER_B);
        });

        it('in development, a learner whose turn started recently still counts after the binding expired', async () => {
            // B's turn is still running past the 5-minute binding TTL; C starts chatting.
            await registerAgentSession(`rp:user:${USER_B}`, USER_B, { ttlMs: -1 });
            await registerAgentSession(`rp:user:${USER_C}`, USER_C);
            const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.error_type, 'session_binding_required', "B's late tool call must not run as C");
        });

        it('in development, two chatting learners fail closed (no PHASE1 or latest fallback)', async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            await registerAgentSession(`rp:user:${USER_C}`, USER_C);
            const sse = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(sse.error_type, 'session_binding_required');
            const stdio = await resolveMcpUserId({ extra: undefined, sessions: new Map() });
            assert.equal(stdio.error_type, 'session_binding_required');
        });

        it('in development, one learner with several bindings (turn tokens, tabs) is still one learner', async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            await registerAgentTurn(USER_B);
            const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.userId, USER_B);
        });

        it('in development, asks the database for at most two recent learners, not the latest binding', async () => {
            const queries = [];
            setPoolForTests({
                async query(sql, params) {
                    queries.push({ sql: String(sql).replace(/\s+/g, ' '), params });
                    if (/GROUP BY user_id/.test(sql)) {
                        return { rowCount: 2, rows: [{ user_id: USER_C, live: true }, { user_id: USER_B, live: true }] };
                    }
                    return { rowCount: 0, rows: [] };
                },
            });
            const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions() });
            assert.equal(result.error_type, 'session_binding_required');
            const recent = queries.find((q) => /GROUP BY user_id/.test(q.sql));
            assert.match(recent.sql, /WHERE expires_at > NOW\(\) OR updated_at > NOW\(\) - \$1::int \* INTERVAL '1 millisecond'/);
            assert.match(recent.sql, /LIMIT 2/);
            assert.ok(!queries.some((q) => /ORDER BY updated_at DESC LIMIT 1/.test(q.sql)), 'no latest-binding lookup');
        });
    });

    describe('a client cannot name the learner with an rp:user key', () => {
        it('ignores X-Hermes-Session-Key: rp:user:<uuid> for a learner who never chatted', async () => {
            process.env.NODE_ENV = 'production';
            const headers = { 'x-hermes-session-key': `rp:user:${ATTACKER}` };
            // The old code stored the header on the shared session (activeSessionKey); neither is trusted.
            const result = await resolveMcpUserId({
                extra: bridgeExtra(headers),
                sessions: bridgeSessions({ activeSessionKey: `rp:user:${ATTACKER}` }),
            });
            assert.notEqual(result.userId, ATTACKER);
            assert.equal(result.error_type, 'session_binding_required');
        });

        it('ignores an rp:user key naming a chatting learner while another one chats', async () => {
            process.env.NODE_ENV = 'production';
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            await registerAgentSession(`rp:user:${USER_C}`, USER_C);
            const result = await resolveMcpUserId({
                extra: bridgeExtra({ 'x-hermes-session-key': `rp:user:${USER_B}` }),
                sessions: bridgeSessions({ activeSessionKey: `rp:user:${USER_B}` }),
            });
            assert.equal(result.userId, undefined);
            assert.equal(result.error_type, 'session_binding_required');
        });

        it('in development too: the rp:user header does not pick the learner', async () => {
            const result = await resolveMcpUserId({
                extra: bridgeExtra({ 'x-hermes-session-key': `rp:user:${ATTACKER}` }),
                sessions: bridgeSessions({ activeSessionKey: `rp:user:${ATTACKER}` }),
            });
            assert.notEqual(result.userId, ATTACKER);
        });
    });

    describe('rp_turn (per-turn token minted by Express)', () => {
        it('registerAgentTurn binds a random rp:turn key; buildTurnInstruction carries it', async () => {
            const first = await registerAgentTurn(USER_B);
            const second = await registerAgentTurn(USER_B);
            assert.ok(isTurnToken(first), first);
            assert.notEqual(first, second);
            assert.ok(!first.includes(USER_B), 'the token does not contain the user id');
            assert.match(buildTurnInstruction(first), new RegExp(`rp_turn="${first}"`));
            assert.equal(await registerAgentTurn(''), null);
        });

        it('a valid rp_turn resolves to its learner even while another learner chats', async () => {
            process.env.NODE_ENV = 'production';
            const turnB = await registerAgentTurn(USER_B);
            await registerAgentSession(`rp:user:${USER_C}`, USER_C);
            const result = await resolveMcpUserId({ argsUserId: USER_C, extra: bridgeExtra(), sessions: bridgeSessions(), turnToken: turnB });
            assert.equal(result.userId, USER_B);
        });

        it('works for stdio and from an X-Hermes-Session-Key: rp:turn:<token> header', async () => {
            process.env.NODE_ENV = 'production';
            const turnC = await registerAgentTurn(USER_C);
            const stdio = await resolveMcpUserId({ extra: undefined, sessions: new Map(), turnToken: turnC });
            assert.equal(stdio.userId, USER_C);
            const header = await resolveMcpUserId({
                extra: bridgeExtra({ 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnC}` }),
                sessions: bridgeSessions(),
            });
            assert.equal(header.userId, USER_C);
        });

        it('a well-formed rp_turn that is unknown or expired fails closed, with no fallback', async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B); // the development fallback would pick B
            const expired = await registerAgentTurn(USER_C, { ttlMs: -1 });
            for (const env of ['development', 'production']) {
                process.env.NODE_ENV = env;
                for (const turnToken of ['x'.repeat(32), expired, USER_B]) {
                    assert.ok(isTurnToken(turnToken), turnToken);
                    const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions(), turnToken });
                    assert.equal(result.error_type, 'session_binding_required', `${env} ${turnToken}`);
                    assert.match(result.error, /rp_turn is unknown or expired/);
                    assert.equal(result.userId, undefined);
                }
            }
        });

        it('an rp_turn that is not token-shaped (an LLM guess) counts as absent', async () => {
            // A sole learner plus a guessed value: the development fallback still finds the learner.
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            for (const turnToken of ['current', 'short', `rp:user:${USER_B}`, `${TURN_KEY_PREFIX}abc`, '<rp_turn>', '']) {
                assert.equal(isTurnToken(turnToken), false, turnToken);
                const result = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions(), turnToken });
                assert.equal(result.userId, USER_B, turnToken);
            }
            // A guessed argument does not hide a valid rp:turn header.
            const turnC = await registerAgentTurn(USER_C);
            const viaHeader = await resolveMcpUserId({
                extra: bridgeExtra({ 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnC}` }),
                sessions: bridgeSessions(),
                turnToken: 'current',
            });
            assert.equal(viaHeader.userId, USER_C);
            // In production there is no fallback: the guess fails closed like no rp_turn at all.
            process.env.NODE_ENV = 'production';
            const prod = await resolveMcpUserId({ extra: bridgeExtra(), sessions: bridgeSessions(), turnToken: 'current' });
            assert.equal(prod.error_type, 'session_binding_required');
            assert.equal(prod.userId, undefined);
        });

        it('learnerForTurn resolves only a live minted token (argument first, then header)', async () => {
            const turnB = await registerAgentTurn(USER_B);
            const turnC = await registerAgentTurn(USER_C);
            assert.equal(await learnerForTurn({ turnToken: turnB }), USER_B);
            assert.equal(await learnerForTurn({ headers: { 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnC}` } }), USER_C);
            assert.equal(await learnerForTurn({ turnToken: turnB, headers: { 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnC}` } }), USER_B);
            assert.equal(await learnerForTurn({ turnToken: 'current', headers: { 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnC}` } }), USER_C);
            assert.equal(await learnerForTurn({ turnToken: 'x'.repeat(32) }), null);
            assert.equal(await learnerForTurn({ headers: { 'x-hermes-session-key': `rp:user:${USER_B}` } }), null);
            assert.equal(await learnerForTurn({}), null);
        });

        it('a learner JWT session ignores rp_turn', async () => {
            const turnB = await registerAgentTurn(USER_B);
            const sessions = new Map([['jwt-sse', { userId: USER_C }]]);
            const result = await resolveMcpUserId({ extra: { sessionId: 'jwt-sse' }, sessions, turnToken: turnB });
            assert.equal(result.userId, USER_C);
        });

        it('a binding write that fails is reported, and leaves no binding behind', async () => {
            setPoolForTests({
                async query(sql) {
                    if (/INSERT INTO agent_session_binding/.test(sql)) throw new Error('connection terminated unexpectedly');
                    return { rowCount: 0, rows: [] };
                },
            });
            const { error } = console;
            console.error = () => {};
            try {
                assert.equal(await registerAgentSession(`rp:user:${USER_B}`, USER_B), false);
                assert.equal(await registerAgentTurn(USER_B), null);
            } finally {
                console.error = error;
            }
            resetPoolForTests();
            // Nothing stayed in memory: the development fallback finds nobody chatting.
            const result = await resolveMcpUserId({ extra: undefined, sessions: new Map() });
            assert.equal(result.userId, USER_A, 'PHASE1 (no learner bound), not B');
        });

        it('registerAgentSession reports success: true in memory without a database, false without a key or user', async () => {
            assert.equal(await registerAgentSession(`rp:user:${USER_B}`, USER_B), true);
            assert.equal(await registerAgentSession('', USER_B), false);
            assert.equal(await registerAgentSession(`rp:user:${USER_B}`, ''), false);
        });

        it('persists the turn binding and purges day-old turn rows', async () => {
            const queries = [];
            setPoolForTests({
                async query(sql, params) {
                    queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
                    return { rowCount: 0, rows: [] };
                },
            });
            const token = await registerAgentTurn(USER_B);
            const insert = queries.find((q) => q.sql.startsWith('INSERT INTO agent_session_binding'));
            assert.deepEqual(insert.params.slice(0, 2), [`${TURN_KEY_PREFIX}${token}`, USER_B]);
            assert.ok(queries.some((q) => /^DELETE FROM agent_session_binding WHERE session_key LIKE 'rp:turn:%' AND expires_at < NOW\(\) - INTERVAL '1 day'$/.test(q.sql)));
        });
    });
});
