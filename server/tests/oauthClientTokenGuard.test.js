// The app API refuses tokens Supabase's OAuth 2.1 server issued to a connected agent (Phase 1,
// doc/brushup-2026/ai-access-plan.ja.md §5). supabase.auth.getUser accepts them, so the fake
// Supabase here accepts every token too: the refusal must come from our own check
// (tools/core/oauthToken.js), in requireAuth, optionalAuth and requireBridgeOrAuth, in production
// and in development (where the dev fallback must not turn them into PHASE1_USER_ID).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { isOAuthClientToken } from '../../tools/core/oauthToken.js';
import { requireAuth, optionalAuth, setSupabaseForTests } from '../middleware/auth.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import { PHASE1_USER_ID, setPoolForTests, resetPoolForTests } from '../db.js';

const USER = 'cccccccc-0000-4000-8000-000000000001';
const CLIENT = 'dddddddd-0000-4000-8000-000000000001';
const MCP_URL = 'https://mcp.example.org/mcp';
const BRIDGE_TOKEN = 'test-bridge-token-for-oauth-guard';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** An unsigned JWT-shaped token; the fake Supabase below does not check signatures. */
const jwt = (payload, header = { alg: 'ES256', kid: 'k1', typ: 'JWT' }) => `${b64(header)}.${b64(payload)}.c2ln`;

const base = { sub: USER, role: 'authenticated', iat: 1_790_000_000, exp: 4_000_000_000, session_id: 'eeeeeeee-0000-4000-8000-000000000001' };
const TOKENS = {
    session: jwt({ ...base, aud: 'authenticated' }),
    sessionArrayAud: jwt({ ...base, aud: ['authenticated'] }),
    sessionNullClient: jwt({ ...base, aud: 'authenticated', client_id: null }),
    // What Supabase issues to an agent without our hook (aud stays 'authenticated') and with it.
    agentNoHook: jwt({ ...base, aud: 'authenticated', client_id: CLIENT }),
    agentWithHook: jwt({ ...base, aud: MCP_URL, client_id: CLIENT }),
    agentAudArray: jwt({ ...base, aud: ['authenticated', MCP_URL], client_id: CLIENT }),
    otherAud: jwt({ ...base, aud: MCP_URL }),
    noAud: jwt({ ...base }),
    garbledPayload: 'eyJhbGciOiJFUzI1NiJ9.!!!not-json!!!.c2ln',
};

/** Accepts every token, like Supabase's /user endpoint does for agent tokens. */
const acceptEverything = {
    calls: 0,
    auth: {
        getUser: async () => {
            acceptEverything.calls += 1;
            return { data: { user: { id: USER } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'RISE_PATH_BRIDGE_TOKEN', 'DATABASE_URL_PHASE1'];

const withApp = async (handler) => {
    const app = express();
    const answer = (req, res) => res.json({ userId: req.userId ?? null, authMethod: req.authMethod });
    app.get('/required', requireAuth, answer);
    app.get('/optional', optionalAuth, answer);
    app.get('/bridge', requireBridgeOrAuth, answer);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(async (path, token, headers = {}) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
            });
            return { status: response.status, json: await response.json() };
        });
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

describe('isOAuthClientToken', () => {
    it('passes a learner session token (aud authenticated, no client_id)', () => {
        assert.equal(isOAuthClientToken(TOKENS.session), false);
        assert.equal(isOAuthClientToken(TOKENS.sessionArrayAud), false);
        assert.equal(isOAuthClientToken(TOKENS.sessionNullClient), false);
    });

    it('flags a token with client_id, whatever its aud', () => {
        assert.equal(isOAuthClientToken(TOKENS.agentNoHook), true);
        assert.equal(isOAuthClientToken(TOKENS.agentWithHook), true);
        assert.equal(isOAuthClientToken(TOKENS.agentAudArray), true);
        assert.equal(isOAuthClientToken(jwt({ ...base, aud: 'authenticated', client_id: '' })), true);
    });

    it('flags a token whose aud is missing or not exactly authenticated', () => {
        assert.equal(isOAuthClientToken(TOKENS.otherAud), true);
        assert.equal(isOAuthClientToken(TOKENS.noAud), true);
        assert.equal(isOAuthClientToken(jwt({ ...base, aud: ['authenticated', 'authenticated'] })), true);
        assert.equal(isOAuthClientToken(jwt({ ...base, aud: 'Authenticated' })), true);
    });

    it('fails closed on a JWT-shaped token whose payload does not decode', () => {
        assert.equal(isOAuthClientToken(TOKENS.garbledPayload), true);
        assert.equal(isOAuthClientToken(`${b64({ alg: 'ES256' })}.${b64(['array'])}.c2ln`), true);
    });

    it('leaves values that are not JWT-shaped to the auth provider', () => {
        for (const value of ['', 'opaque-token', USER, 'a.b', 'a.b.c.d', undefined, null, 42]) {
            assert.equal(isOAuthClientToken(value), false, String(value));
        }
    });
});

for (const mode of ['production', 'development']) {
    describe(`app API token guard (${mode})`, () => {
        const saved = {};

        beforeEach(() => {
            for (const key of ENV_KEYS) saved[key] = process.env[key];
            for (const key of ENV_KEYS) delete process.env[key];
            process.env.NODE_ENV = mode;
            process.env.RISE_PATH_BRIDGE_TOKEN = BRIDGE_TOKEN;
            resetPoolForTests();
            setPoolForTests(null);
            acceptEverything.calls = 0;
            setSupabaseForTests(acceptEverything);
        });

        afterEach(() => {
            for (const key of ENV_KEYS) {
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
            }
            setSupabaseForTests(null);
            resetPoolForTests();
        });

        it('a learner session token still signs in everywhere', async () => {
            await withApp(async (get) => {
                for (const path of ['/required', '/optional', '/bridge']) {
                    for (const token of [TOKENS.session, TOKENS.sessionArrayAud, TOKENS.sessionNullClient]) {
                        const { status, json } = await get(path, token);
                        assert.equal(status, 200, path);
                        assert.deepEqual(json, { userId: USER, authMethod: 'supabase-jwt' }, path);
                    }
                }
            });
        });

        it('requireAuth answers 401 oauth_client_token without asking Supabase', async () => {
            await withApp(async (get) => {
                for (const name of ['agentNoHook', 'agentWithHook', 'agentAudArray', 'otherAud', 'noAud', 'garbledPayload']) {
                    const { status, json } = await get('/required', TOKENS[name]);
                    assert.equal(status, 401, name);
                    assert.equal(json.error_type, 'oauth_client_token', name);
                }
            });
            assert.equal(acceptEverything.calls, 0);
        });

        it('optionalAuth treats an agent token as anonymous (no dev fallback user)', async () => {
            await withApp(async (get) => {
                for (const name of ['agentNoHook', 'agentWithHook', 'otherAud', 'noAud']) {
                    const { status, json } = await get('/optional', TOKENS[name]);
                    assert.equal(status, 200, name);
                    assert.deepEqual(json, { userId: null, authMethod: 'anonymous' }, name);
                }
            });
            assert.equal(acceptEverything.calls, 0);
        });

        it('requireBridgeOrAuth answers 401 oauth_client_token (no dev fallback user)', async () => {
            await withApp(async (get) => {
                for (const name of ['agentNoHook', 'agentWithHook', 'otherAud', 'noAud']) {
                    const { status, json } = await get('/bridge', TOKENS[name]);
                    assert.equal(status, 401, name);
                    assert.equal(json.error_type, 'oauth_client_token', name);
                }
            });
            assert.equal(acceptEverything.calls, 0);
        });

        it('the bridge token keeps working on the bridge routes', async () => {
            await withApp(async (get) => {
                const header = await get('/bridge', null, { 'x-nexloom-bridge-token': BRIDGE_TOKEN });
                assert.deepEqual(header.json, { userId: PHASE1_USER_ID, authMethod: 'bridge-token' });
                const bearer = await get('/bridge', BRIDGE_TOKEN);
                assert.deepEqual(bearer.json, { userId: PHASE1_USER_ID, authMethod: 'bridge-bearer' });
            });
        });
    });
}

describe('app API token guard without Supabase (development)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'development';
        resetPoolForTests();
        setPoolForTests(null);
        setSupabaseForTests(null);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        resetPoolForTests();
    });

    it('an agent token never becomes the dev fallback user; no token still does', async () => {
        await withApp(async (get) => {
            const required = await get('/required', TOKENS.agentWithHook);
            assert.equal(required.status, 401);
            assert.equal(required.json.error_type, 'oauth_client_token');
            assert.deepEqual((await get('/optional', TOKENS.agentWithHook)).json, { userId: null, authMethod: 'anonymous' });
            assert.equal((await get('/bridge', TOKENS.agentWithHook)).status, 401);
            assert.deepEqual((await get('/required', null)).json, { userId: PHASE1_USER_ID, authMethod: 'dev-fallback' });
        });
    });
});
