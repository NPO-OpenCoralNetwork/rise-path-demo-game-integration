import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ALLOWED_SKILLS,
    validateAgentChatBody,
    buildHermesInput,
    buildConversationKey,
    buildTurnSessionKey,
    extractAnswerFromHermesResponse,
    extractEvidenceFromHermesResponse,
    buildResponseCaveats,
    callHermesResponses,
    streamHermesChatCompletions,
    getHermesConfig,
    hermesFetchFailure,
} from '../services/hermesAgentService.js';
import {
    setAgentChatConsent,
    getAgentChatConsent,
    registerAgentSession,
    clearAgentChatConsentForTests,
} from '../../tools/core/agentSessionStore.js';
import { clearMcpUserScopeForTests, resolveMcpUserId, isTurnToken, getPhase1UserId } from '../../tools/core/mcpUserScope.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const USER_CONSENT = '00000000-0000-0000-0000-000000000099';
const LEARNER_A = 'a0000000-0000-4000-8000-00000000000a';
const LEARNER_B = 'b0000000-0000-4000-8000-00000000000b';

/** The rp_turn token in a Hermes request's instructions (buildTurnInstruction), or null. */
const turnInInstructions = (body) => /rp_turn="([^"]+)"/.exec(body.instructions)?.[1] ?? null;

/** A pool whose agent_session_binding writes fail (database down, constraint, permissions). */
const bindingWriteFails = () => ({
    async query(sql) {
        if (/INSERT INTO agent_session_binding/.test(sql)) throw new Error('connection terminated unexpectedly');
        return { rowCount: 0, rows: [] };
    },
});

describe('validateAgentChatBody', () => {
    it('accepts valid life-habit-analyst request', () => {
        const result = validateAgentChatBody({
            skill: 'life-habit-analyst',
            message: '今月の傾向は？',
            context: { from: '2026-06-01', to: '2026-06-30', timezone: 'Asia/Tokyo' },
            include_diary_excerpts: false,
        });
        assert.equal(result.valid, true);
        assert.equal(result.parsed.skill, 'life-habit-analyst');
        assert.equal(result.parsed.includeDiaryExcerpts, false);
    });

    it('rejects unknown skill', () => {
        const result = validateAgentChatBody({
            skill: 'unknown-skill',
            message: 'hello',
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('skill')));
    });

    it('rejects invalid date in context', () => {
        const result = validateAgentChatBody({
            skill: 'learning-coach',
            message: 'help',
            context: { from: '06-01-2026' },
        });
        assert.equal(result.valid, false);
    });

    it('accepts learning-coach without date range in context', () => {
        const result = validateAgentChatBody({
            skill: 'learning-coach',
            message: 'How do I rotate a cube in Blender?',
            context: { timezone: 'Asia/Tokyo' },
        });
        assert.equal(result.valid, true);
        assert.equal(result.parsed.skill, 'learning-coach');
    });

    it('rejects invalid ui_language in context', () => {
        const result = validateAgentChatBody({
            skill: 'learning-coach',
            message: 'help',
            context: { ui_language: 'fr' },
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('ui_language')));
    });

    it('accepts en and jp ui_language', () => {
        for (const ui_language of ['en', 'jp']) {
            const result = validateAgentChatBody({
                skill: 'learning-coach',
                message: 'help',
                context: { ui_language },
            });
            assert.equal(result.valid, true, ui_language);
        }
    });
});

describe('buildHermesInput', () => {
    it('includes skill slash command and period without diary consent hint', () => {
        const input = buildHermesInput({
            skill: 'life-habit-analyst',
            message: '睡眠と集中の関係は？',
            context: { from: '2026-06-01', to: '2026-06-30', timezone: 'Asia/Tokyo' },
        });
        assert.ok(input.startsWith('/life-habit-analyst'));
        assert.ok(input.includes('睡眠と集中の関係は？'));
        assert.ok(input.includes('Period: 2026-06-01 to 2026-06-30'));
        assert.ok(!input.includes('Include diary excerpts'));
        assert.ok(!input.includes('UI language:'));
    });

    it('learning-coach omits Period and includes timezone and ui_language', () => {
        const input = buildHermesInput({
            skill: 'learning-coach',
            message: 'What is a GameObject?',
            context: { timezone: 'Asia/Tokyo', ui_language: 'en' },
        });
        assert.ok(input.startsWith('/learning-coach'));
        assert.ok(input.includes('Timezone: Asia/Tokyo'));
        assert.ok(input.includes('UI language: en'));
        assert.ok(!input.includes('Period:'));
    });

    it('includes UI language line when ui_language is jp', () => {
        const input = buildHermesInput({
            skill: 'life-habit-analyst',
            message: '傾向は？',
            context: {
                from: '2026-06-01',
                to: '2026-06-30',
                timezone: 'Asia/Tokyo',
                ui_language: 'jp',
            },
        });
        assert.ok(input.includes('UI language: jp'));
    });
});

describe('session keys', () => {
    it('builds a stable conversation key and a per-turn session key', () => {
        const uid = '00000000-0000-0000-0000-000000000099';
        assert.equal(buildConversationKey(uid, 'life-habit-analyst'), `rp:user:${uid}:life-habit-analyst`);
        assert.equal(buildTurnSessionKey('abc'), 'rp:turn:abc');
    });
});

describe('extractEvidenceFromHermesResponse', () => {
    it('extracts correlation and rule evidence from tool output JSON', () => {
        const evidence = extractEvidenceFromHermesResponse({
            output: [{
                type: 'message',
                content: [{
                    type: 'output_text',
                    text: JSON.stringify({
                        top_correlations: [{ pair: 'sleep_hours×focus', r: 0.42, n: 21 }],
                        rule_advice: [{ evidence: 'exercise days avg_focus=3.8' }],
                    }),
                }],
            }],
        });
        assert.deepEqual(evidence, [
            'sleep_hours×focus: r=0.42, n=21',
            'exercise days avg_focus=3.8',
        ]);
    });
});

describe('buildResponseCaveats', () => {
    it('adds missing-evidence caveat when evidence is empty', () => {
        const caveats = buildResponseCaveats([]);
        assert.ok(caveats.some((c) => c.includes('根拠データ')));
    });
});

describe('extractAnswerFromHermesResponse', () => {
    it('extracts output_text from responses API shape', () => {
        const answer = extractAnswerFromHermesResponse({
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: '睡眠7h以上の日は集中が高い傾向があります。' }],
                },
            ],
        });
        assert.equal(answer, '睡眠7h以上の日は集中が高い傾向があります。');
    });

    it('extracts chat completions shape', () => {
        const answer = extractAnswerFromHermesResponse({
            choices: [{ message: { content: 'Hello from Hermes' } }],
        });
        assert.equal(answer, 'Hello from Hermes');
    });
});

describe('callHermesResponses', () => {
    const prevKey = process.env.HERMES_API_KEY;
    const prevUrl = process.env.HERMES_API_URL;

    beforeEach(() => {
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
        process.env.HERMES_API_KEY = 'test-key';
        process.env.HERMES_API_URL = 'http://hermes.test';
    });

    afterEach(() => {
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
        if (prevKey === undefined) delete process.env.HERMES_API_KEY;
        else process.env.HERMES_API_KEY = prevKey;
        if (prevUrl === undefined) delete process.env.HERMES_API_URL;
        else process.env.HERMES_API_URL = prevUrl;
    });

    it('returns not configured when HERMES_API_KEY is missing', async () => {
        delete process.env.HERMES_API_KEY;
        const result = await callHermesResponses({
            userId: 'u1',
            skill: 'life-habit-analyst',
            message: 'test',
            context: {},
            includeDiaryExcerpts: false,
        });
        assert.equal(result.ok, false);
        assert.equal(result.error_type, 'hermes_not_configured');
    });

    it('forwards request with session headers and parses answer', async () => {
        let capturedUrl;
        let capturedInit;
        const mockFetch = async (url, init) => {
            capturedUrl = url;
            capturedInit = init;
            return {
                ok: true,
                json: async () => ({
                    id: 'resp_1',
                    output: [{
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: '分析結果です。' }],
                    }],
                }),
            };
        };

        const result = await callHermesResponses({
            userId: 'user-abc',
            skill: 'life-habit-analyst',
            message: '傾向は？',
            context: { from: '2026-06-01', to: '2026-06-10' },
            includeDiaryExcerpts: false,
            fetchImpl: mockFetch,
        });

        assert.equal(result.ok, true);
        assert.equal(result.answer, '分析結果です。');
        assert.equal(capturedUrl, 'http://hermes.test/v1/responses');
        assert.equal(capturedInit.headers.Authorization, 'Bearer test-key');
        const body = JSON.parse(capturedInit.body);
        const turn = turnInInstructions(body);
        assert.ok(isTurnToken(turn), body.instructions);
        assert.equal(capturedInit.headers['X-Hermes-Session-Key'], `rp:turn:${turn}`);
        assert.equal(body.conversation, 'rp:user:user-abc:life-habit-analyst');
        assert.ok(body.input.includes('/life-habit-analyst'));
        assert.ok(!body.input.includes(turn), 'the token is not in the learner-controlled input');
        assert.equal(await getAgentChatConsent('user-abc'), false);
    });

    it("mints a turn token per call that the MCP server resolves to the caller while another learner chats", async () => {
        const prevNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const bodies = [];
            const mockFetch = async (_url, init) => {
                bodies.push(JSON.parse(init.body));
                return { ok: true, json: async () => ({ output_text: 'ok' }) };
            };
            for (const userId of [LEARNER_A, LEARNER_B, LEARNER_A]) {
                const result = await callHermesResponses({
                    userId, skill: 'content-search', message: 'find my notes', context: {}, includeDiaryExcerpts: false, fetchImpl: mockFetch,
                });
                assert.equal(result.ok, true);
            }
            const [turnA, turnB, turnA2] = bodies.map(turnInInstructions);
            assert.ok([turnA, turnB, turnA2].every(isTurnToken));
            assert.equal(new Set([turnA, turnB, turnA2]).size, 3, 'a new token every turn');
            assert.ok(bodies[0].instructions.startsWith('You are Lumina'), 'the skill instructions come first');

            // A and B both have live bindings, so only the token tells the MCP server who is calling.
            const bridge = { extra: { sessionId: 'bridge' }, sessions: new Map([['bridge', { userId: getPhase1UserId() }]]) };
            assert.equal((await resolveMcpUserId({ ...bridge, turnToken: turnA })).userId, LEARNER_A);
            assert.equal((await resolveMcpUserId({ ...bridge, turnToken: turnB })).userId, LEARNER_B);
            assert.equal((await resolveMcpUserId({ ...bridge, turnToken: turnA2, argsUserId: LEARNER_B })).userId, LEARNER_A);
            const without = await resolveMcpUserId(bridge);
            assert.equal(without.userId, undefined, 'no token: no learner in production');
            assert.equal(without.error_type, 'session_binding_required');
        } finally {
            if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prevNodeEnv;
        }
    });

    it('never calls Hermes when the turn binding cannot be written', async () => {
        setPoolForTests(bindingWriteFails());
        const { error } = console;
        console.error = () => {};
        try {
            let calls = 0;
            const mockFetch = async () => {
                calls += 1;
                return { ok: true, json: async () => ({ output_text: 'should not happen' }) };
            };
            for (const call of [callHermesResponses, streamHermesChatCompletions]) {
                const result = await call({
                    userId: LEARNER_A, skill: 'content-search', message: 'find my notes', context: {}, includeDiaryExcerpts: false, fetchImpl: mockFetch,
                });
                assert.deepEqual(result, {
                    ok: false, status: 503, error: 'Agent session could not be started', error_type: 'agent_session_unavailable',
                }, call.name);
            }
            assert.equal(calls, 0, 'fetchImpl was never called');
        } finally {
            console.error = error;
            resetPoolForTests();
        }
    });

    it('registers diary consent before forwarding to Hermes', async () => {
        const mockFetch = async () => ({
            ok: true,
            json: async () => ({
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: 'ok' }],
                }],
            }),
        });

        await callHermesResponses({
            userId: USER_CONSENT,
            skill: 'life-habit-analyst',
            message: 'test',
            context: {},
            includeDiaryExcerpts: true,
            fetchImpl: mockFetch,
        });

        assert.equal(await getAgentChatConsent(USER_CONSENT), true);
    });
});

describe('streamHermesChatCompletions', () => {
    const prevKey = process.env.HERMES_API_KEY;
    const prevUrl = process.env.HERMES_API_URL;

    beforeEach(() => {
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
        process.env.HERMES_API_KEY = 'test-key';
        process.env.HERMES_API_URL = 'http://hermes.test';
    });

    afterEach(() => {
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
        if (prevKey === undefined) delete process.env.HERMES_API_KEY;
        else process.env.HERMES_API_KEY = prevKey;
        if (prevUrl === undefined) delete process.env.HERMES_API_URL;
        else process.env.HERMES_API_URL = prevUrl;
    });

    it('uses /v1/responses with conversation and stream flag', async () => {
        let capturedUrl;
        let capturedBody;
        const mockFetch = async (url, init) => {
            capturedUrl = url;
            capturedBody = JSON.parse(init.body);
            return { ok: true, body: new ReadableStream() };
        };

        const result = await streamHermesChatCompletions({
            userId: 'user-stream',
            skill: 'life-habit-analyst',
            message: 'stream me',
            context: { from: '2026-06-01', to: '2026-06-10' },
            includeDiaryExcerpts: false,
            fetchImpl: mockFetch,
        });

        assert.equal(result.ok, true);
        assert.equal(capturedUrl, 'http://hermes.test/v1/responses');
        assert.equal(capturedBody.conversation, 'rp:user:user-stream:life-habit-analyst');
        assert.equal(capturedBody.stream, true);
        assert.equal(capturedBody.store, true);
        assert.ok(isTurnToken(turnInInstructions(capturedBody)), capturedBody.instructions);
    });
});

describe('getHermesConfig', () => {
    it('reports configured when API key is set', () => {
        const prev = process.env.HERMES_API_KEY;
        process.env.HERMES_API_KEY = 'x';
        const cfg = getHermesConfig();
        assert.equal(cfg.configured, true);
        if (prev === undefined) delete process.env.HERMES_API_KEY;
        else process.env.HERMES_API_KEY = prev;
    });
});

describe('ALLOWED_SKILLS', () => {
    it('includes life-habit-analyst and learning-coach', () => {
        assert.ok(ALLOWED_SKILLS.has('life-habit-analyst'));
        assert.ok(ALLOWED_SKILLS.has('learning-coach'));
    });
});
describe('hermesFetchFailure', () => {
    const failed = (cause) => Object.assign(new TypeError('fetch failed'), { cause });
    const coded = (code) => Object.assign(new Error(code), { code });

    it("is 'hermes_unreachable' only when the connection never opened", () => {
        for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH']) {
            const result = hermesFetchFailure(failed(coded(code)));
            assert.equal(result.error_type, 'hermes_unreachable', code);
            assert.equal(result.status, 503);
        }
        const multi = Object.assign(new AggregateError([coded('ECONNREFUSED'), coded('ECONNREFUSED')]), { code: 'ECONNREFUSED' });
        assert.equal(hermesFetchFailure(failed(multi)).error_type, 'hermes_unreachable', 'IPv4 and IPv6 both refused');
    });

    it("is 'hermes_interrupted' after the request was sent, or when the cause is unknown", () => {
        for (const cause of [coded('UND_ERR_HEADERS_TIMEOUT'), coded('UND_ERR_SOCKET'), coded('ECONNRESET'), coded('UND_ERR_BODY_TIMEOUT'), undefined]) {
            const result = hermesFetchFailure(failed(cause));
            assert.equal(result.error_type, 'hermes_interrupted', String(cause?.code));
            assert.equal(result.status, 503);
        }
        const mixed = new AggregateError([coded('ECONNREFUSED'), coded('ECONNRESET')]);
        assert.equal(hermesFetchFailure(failed(mixed)).error_type, 'hermes_interrupted');
    });
});
