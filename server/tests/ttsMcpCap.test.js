// @ts-check
// The TTS text cap on the MCP path (Phase 9, owner decision D3; design §4.2 and Scope guard SG-0): the
// request-tts tool reaches the sidecar only through requestTts(), so a text over TTS_MAX_CHARS comes back
// as the same validation object the REST route answers with 400 (here an error tool result), with no
// sidecar call and no cache file, for a call without a learner (voice_id given) and for one with the
// learner from rp_turn. The tool's zod schema is unchanged (z.string()). In process, local learner
// profile (as server/tests/mcpCourseTools.test.js); the sidecar is a fake fetch.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resetPoolForTests } from '../db.js';
import { createMcpServer } from '../../mcp-server/createMcpServer.js';
import { TTS_MAX_CHARS, TTS_TEXT_TOO_LONG } from '../../tools/core/kokoroTts.js';
import { clearMcpUserScopeForTests, registerAgentTurn } from '../../tools/core/mcpUserScope.js';

const LEARNER = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const TOO_LONG = { error: 'text is too long', error_type: 'validation', code: 'text_too_long', max_chars: 1000 };

const made = /** @type {string[]} */ ([]);
process.on('exit', () => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
const savedCacheDir = process.env.KOKORO_TTS_CACHE_DIR;

/** The JSON of a tool result's first text. @param {any} result */
const parse = (result) => JSON.parse(result.content[0].text);

describe('MCP request-tts: the text cap (design §4.2, SG-0)', () => {
    const clients = /** @type {Client[]} */ ([]);
    const savedConsole = { log: console.log, warn: console.warn, error: console.error };
    let cacheDir = '';
    /** @type {any} */
    let fetchMock;

    const open = async () => {
        const server = createMcpServer({ profile: 'learner' });
        const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'tts-cap-test', version: '1.0.0' });
        await client.connect(clientSide);
        clients.push(client);
        return client;
    };

    beforeEach(() => {
        console.log = () => {};
        console.warn = () => {};
        console.error = () => {};
        resetPoolForTests();
        clearMcpUserScopeForTests();
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-mcp-cap-'));
        made.push(cacheDir);
        process.env.KOKORO_TTS_CACHE_DIR = cacheDir;
        fetchMock = mock.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify({ audio_base64: Buffer.from('audio').toString('base64'), duration_seconds: 1 }),
        }));
        mock.method(globalThis, 'fetch', /** @type {any} */ (fetchMock));
    });

    afterEach(async () => {
        for (const client of clients.splice(0)) await client.close().catch(() => {});
        mock.restoreAll();
        clearMcpUserScopeForTests();
        Object.assign(console, savedConsole);
        if (savedCacheDir === undefined) delete process.env.KOKORO_TTS_CACHE_DIR;
        else process.env.KOKORO_TTS_CACHE_DIR = savedCacheDir;
    });

    it('is the constant the tool answers with', () => {
        assert.equal(TTS_MAX_CHARS, 1000);
        assert.deepEqual({ ...TTS_TEXT_TOO_LONG }, TOO_LONG);
    });

    it('answers 1,001 characters with the validation object as an error result: no sidecar call, no cache file', async () => {
        const client = await open();
        const turn = await registerAgentTurn(LEARNER);
        assert.ok(turn, 'a turn for the learner');
        const cases = /** @type {Array<[string, Record<string, unknown>]>} */ ([
            ['no learner, voice_id given', { text: '読'.repeat(1001), language: 'ja', voice_id: 'jf_alpha' }],
            ['the learner from rp_turn, saved voice', { text: '😀'.repeat(1001), language: 'ja', rp_turn: turn }],
            ['a 2,000,000-character text', { text: 'x'.repeat(2_000_000), language: 'en', voice_id: 'af_bella' }],
        ]);
        for (const [label, args] of cases) {
            const result = await client.callTool({ name: 'request-tts', arguments: args });
            assert.equal(result.isError, true, label);
            assert.deepEqual(parse(result), TOO_LONG, label);
        }
        assert.equal(fetchMock.mock.callCount(), 0, 'the sidecar is never called');
        assert.deepEqual(fs.readdirSync(cacheDir), [], 'nothing cached');
    });

    it('lets 1,000 characters through to the sidecar (the cap is not lower on this path)', async () => {
        const client = await open();
        const result = await client.callTool({ name: 'request-tts', arguments: { text: '読'.repeat(1000), language: 'ja', voice_id: 'jf_alpha' } });
        assert.ok(!result.isError, JSON.stringify(result.content));
        assert.equal(parse(result).cached, false);
        assert.equal(fetchMock.mock.callCount(), 1);
        assert.equal([...JSON.parse(fetchMock.mock.calls[0].arguments[1].body).text].length, 1000, 'the whole text sent');
        assert.equal(fs.readdirSync(cacheDir).filter((name) => /\.(?:mp3|wav)$/.test(name)).length, 1);
    });
});
