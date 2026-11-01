import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    TTS_MAX_CHARS,
    applyTtsRequestOptions,
    buildCacheKey,
    callKokoroSidecar,
    checkKokoroHealth,
    generateAudioContent,
    normalizeText,
    resolveLangCode,
    resolveVoiceId,
    requestTts,
    synthesize,
    validateSynthesisParams,
} from '../../tools/core/kokoroTts.js';
import { VOICE_CATALOG } from '../../data/tts/voiceCatalog.ts';
import { resetPoolForTests, setPoolForTests } from '../db.js';

/** A fresh, empty cache folder under the OS temp folder (removed when the process exits). */
const tempCacheDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `kokoro-tts-test-${label}-`));
const made = [];
process.on('exit', () => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});
const useTempCache = (label) => {
    const dir = tempCacheDir(label);
    made.push(dir);
    process.env.KOKORO_TTS_CACHE_DIR = dir;
    return dir;
};

describe('kokoroTts helpers', () => {
    it('resolveLangCode maps ja/en defaults', () => {
        assert.equal(resolveLangCode('ja'), 'j');
        assert.equal(resolveLangCode('en'), 'a');
        assert.equal(resolveLangCode('en', 'b'), 'b');
    });

    it('resolveVoiceId falls back to env defaults', () => {
        assert.equal(resolveVoiceId({ language: 'ja' }), 'jf_alpha');
        assert.equal(resolveVoiceId({ language: 'en' }), 'af_bella');
        assert.equal(resolveVoiceId({ language: 'ja', voice_id: 'jf_tebukuro' }), 'jf_tebukuro');
    });

    it('buildCacheKey is stable for normalized text', () => {
        const a = buildCacheKey({
            voice_id: 'jf_alpha',
            lang_code: 'j',
            speed: 1,
            text: '  hello   world ',
        });
        const b = buildCacheKey({
            voice_id: 'jf_alpha',
            lang_code: 'j',
            speed: 1,
            text: 'hello world',
        });
        assert.equal(a, b);
        assert.equal(normalizeText('  hello   world '), 'hello world');
    });
});

describe('validateSynthesisParams', () => {
    it('rejects out-of-range speed', () => {
        const result = validateSynthesisParams({ voice_id: 'jf_alpha', speed: 5 });
        assert.equal(result.error_type, 'validation');
    });
});

describe('checkKokoroHealth', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('returns ok when sidecar reports healthy models', async () => {
        mock.method(globalThis, 'fetch', async () => ({
            ok: true,
            json: async () => ({
                status: 'ok',
                engine: 'kokoro-82m-onnx',
                models_ready: true,
            }),
        }));

        const result = await checkKokoroHealth();
        assert.equal(result.ok, true);
        assert.equal(result.models_ready, true);
    });

    it('returns unavailable when models are missing', async () => {
        mock.method(globalThis, 'fetch', async () => ({
            ok: true,
            json: async () => ({
                status: 'degraded',
                engine: 'kokoro-82m-onnx',
                models_ready: false,
            }),
        }));

        const result = await checkKokoroHealth();
        assert.equal(result.ok, false);
        assert.equal(result.models_ready, false);
    });

    it('returns unavailable when fetch fails', async () => {
        mock.method(globalThis, 'fetch', async () => {
            throw new Error('connection refused');
        });

        const result = await checkKokoroHealth();
        assert.equal(result.ok, false);
        assert.match(result.error, /connection refused/i);
    });
});

describe('callKokoroSidecar', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('returns tts_unavailable on invalid JSON body', async () => {
        mock.method(globalThis, 'fetch', async () => ({
            ok: true,
            text: async () => '<html>not json</html>',
        }));

        const result = await callKokoroSidecar({
            text: 'hello',
            voice_id: 'jf_alpha',
            lang_code: 'j',
        });

        assert.equal(result.error_type, 'tts_unavailable');
        assert.match(result.error, /invalid JSON/i);
    });
});

describe('applyTtsRequestOptions integration', () => {
    it('resolves voice from preferences through synthesize path', () => {
        const opts = applyTtsRequestOptions(
            { text: 'test', language: 'ja' },
            { voice_id: 'jf_tebukuro', lang_code: 'j' },
        );
        assert.equal(resolveVoiceId(opts), 'jf_tebukuro');
        assert.equal(resolveLangCode(opts.language, opts.lang_code), 'j');
    });
});

describe('synthesize', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('rejects empty text', async () => {
        const result = await synthesize({ text: '   ' });
        assert.equal(result.error_type, 'validation');
    });

    it('returns cached result without calling sidecar', async () => {
        const cacheKey = buildCacheKey({
            voice_id: 'jf_alpha',
            lang_code: 'j',
            speed: 1,
            text: 'cached phrase',
        });
        const cacheDir = useTempCache('hit');
        fs.writeFileSync(path.join(cacheDir, `${cacheKey}.mp3`), Buffer.from('cached-audio'));
        fs.writeFileSync(
            path.join(cacheDir, `${cacheKey}.mp3.meta.json`),
            JSON.stringify({ duration_seconds: 12.3 }),
        );

        const fetchMock = mock.fn(async () => {
            throw new Error('fetch should not be called for cache hit');
        });
        mock.method(globalThis, 'fetch', fetchMock);

        const result = await synthesize({
            text: 'cached phrase',
            language: 'ja',
        });

        assert.equal(result.cached, true);
        assert.equal(result.duration_seconds, 12.3);
        assert.match(result.audio_url, /audio\/cache\//);
        assert.equal(fetchMock.mock.callCount(), 0);
    });

    it('calls sidecar and writes cache on miss', async () => {
        const cacheDir = useTempCache('miss');

        const fetchMock = mock.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify({
                audio_base64: Buffer.from('fresh-audio').toString('base64'),
                duration_seconds: 4.2,
                content_type: 'audio/mpeg',
                engine: 'kokoro-82m-onnx',
            }),
        }));
        mock.method(globalThis, 'fetch', fetchMock);

        const result = await synthesize({
            text: 'fresh phrase',
            language: 'ja',
        });

        assert.equal(result.cached, false);
        assert.equal(result.duration_seconds, 4.2);
        assert.equal(fetchMock.mock.callCount(), 1);

        const files = fs.readdirSync(cacheDir);
        assert.ok(files.some((name) => name.endsWith('.mp3')));
    });
});

describe('requestTts (the MCP request-tts tool and POST /tts/synthesize)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    const UNAVAILABLE = { error: 'Voice service is unavailable', error_type: 'tts_unavailable' };
    const SECRET = 'Traceback: /srv/kokoro/app.py line 42: model file /models/kokoro.onnx missing (host 10.0.0.7)';

    /** requestTts with console.error captured; the cache dir is empty so the sidecar is called. */
    const run = async (args) => {
        useTempCache('request');
        const logged = [];
        mock.method(console, 'error', (...parts) => { logged.push(parts.join(' ')); });
        const result = await requestTts({ userId: null, language: 'ja', ...args });
        return { result, logged: logged.join('\n') };
    };

    it('answers a sidecar error with a fixed text; the sidecar body goes to the log only', async () => {
        mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, text: async () => SECRET }));
        const { result, logged } = await run({ text: `sidecar error ${Date.now()}` });
        assert.deepEqual(result, UNAVAILABLE);
        assert.match(logged, /model file/, 'logged server-side');
    });

    it('answers an unreachable sidecar (exception text) and invalid JSON with the same fixed text', async () => {
        mock.method(globalThis, 'fetch', async () => { throw new TypeError(`fetch failed: connect ECONNREFUSED ${SECRET}`); });
        assert.deepEqual((await run({ text: `unreachable ${Date.now()}` })).result, UNAVAILABLE);
        mock.restoreAll();
        mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => `<html>${SECRET}</html>` }));
        assert.deepEqual((await run({ text: `invalid json ${Date.now()}` })).result, UNAVAILABLE);
    });

    it('keeps validation errors as they are, without calling the sidecar', async () => {
        const fetchMock = mock.fn(async () => { throw new Error('fetch should not be called'); });
        mock.method(globalThis, 'fetch', fetchMock);
        const { result } = await run({ text: 'hello', voice_id: 'nope' });
        assert.deepEqual(result, { error: 'Invalid voice_id: nope', error_type: 'validation' });
        assert.equal(fetchMock.mock.callCount(), 0);
    });
});

describe('requestTts: the text cap (Phase 9, D3; design §4.1, SG-0)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    const TOO_LONG = { error: 'text is too long', error_type: 'validation', code: 'text_too_long', max_chars: 1000 };
    /** A fake sidecar that answers audio and counts its calls. */
    const fakeSidecar = () => {
        const fetchMock = mock.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify({ audio_base64: Buffer.from('audio').toString('base64'), duration_seconds: 1 }),
        }));
        mock.method(globalThis, 'fetch', fetchMock);
        return fetchMock;
    };
    const audioFiles = (dir) => fs.readdirSync(dir).filter((name) => /\.(mp3|wav)$/.test(name));

    it('is 1,000 characters', () => {
        assert.equal(TTS_MAX_CHARS, 1000);
    });

    it('lets 1,000 code points through (kanji and emoji, one code point each) to the sidecar', async () => {
        for (const [label, text] of [['kanji', '漢'.repeat(1000)], ['emoji', '😀'.repeat(1000)], ['mixed', `${'あ'.repeat(500)}${'😀'.repeat(499)}x`]]) {
            const dir = useTempCache(`ok-${label}`);
            const fetchMock = fakeSidecar();
            const result = await requestTts({ userId: null, language: 'ja', voice_id: 'jf_alpha', text });
            assert.equal(result.error_type, undefined, `${label}: ${JSON.stringify(result.error)}`);
            assert.equal(result.cached, false, label);
            assert.equal(fetchMock.mock.callCount(), 1, label);
            assert.equal([...JSON.parse(fetchMock.mock.calls[0].arguments[1].body).text].length, 1000, `${label}: the whole text sent`);
            assert.equal(audioFiles(dir).length, 1, label);
            mock.restoreAll();
        }
    });

    it('answers 1,001 code points with the validation object: no sidecar call, no preference read, no cache file', async () => {
        // A signed-in learner: requestTts reads the saved voice (loadUserTtsPreferences) before synthesizing.
        const queries = [];
        setPoolForTests({ query: async (sql) => { queries.push(sql); return { rowCount: 0, rows: [] }; } });
        try {
            const learner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
            for (const [label, text] of [['kanji', '漢'.repeat(1001)], ['emoji', '😀'.repeat(1001)], ['ascii', 'a'.repeat(1001)], ['huge', 'x'.repeat(2_000_000)]]) {
                const dir = useTempCache(`long-${label}`);
                const fetchMock = fakeSidecar();
                const result = await requestTts({ userId: learner, language: 'ja', text });
                assert.deepEqual(result, TOO_LONG, label);
                assert.equal(fetchMock.mock.callCount(), 0, `${label}: the sidecar is never called`);
                assert.deepEqual(fs.readdirSync(dir), [], `${label}: nothing cached`);
                mock.restoreAll();
            }
            assert.deepEqual(queries, [], 'no preference read for a refused text');
            // The same learner with 1,000 characters: the preferences are read (the fake pool is in use).
            useTempCache('long-control');
            fakeSidecar();
            assert.equal((await requestTts({ userId: learner, language: 'ja', text: '漢'.repeat(1000) })).cached, false);
            assert.equal(queries.length, 1);
        } finally {
            resetPoolForTests();
        }
    });

    it('counts the text after normalizeText: runs of whitespace count once, ends are trimmed', async () => {
        const dir = useTempCache('spaces');
        const fetchMock = fakeSidecar();
        // 1,000 code points once normalized ('a a … a ab'), 2,503 as typed.
        const text = `   ${Array.from({ length: 500 }, () => 'a').join(' \n\t ')}b   `;
        assert.equal([...normalizeText(text)].length, 1000);
        assert.ok(text.length > 1500);
        const result = await requestTts({ userId: null, language: 'ja', voice_id: 'jf_alpha', text });
        assert.equal(result.error_type, undefined, JSON.stringify(result));
        assert.equal(fetchMock.mock.callCount(), 1);
        assert.equal(audioFiles(dir).length, 1);
        mock.restoreAll();
        const tooLong = await requestTts({ userId: null, language: 'ja', voice_id: 'jf_alpha', text: `${text}c` });
        assert.deepEqual(tooLong, TOO_LONG);
    });

    it('generateAudioContent (the staff slide script) has no cap: 1,001 characters still reach the sidecar', async () => {
        useTempCache('slides');
        const fetchMock = fakeSidecar();
        const base64 = await generateAudioContent('漢'.repeat(1001));
        assert.equal(Buffer.from(base64, 'base64').toString(), 'audio');
        assert.equal(fetchMock.mock.callCount(), 1);
        assert.equal([...JSON.parse(fetchMock.mock.calls[0].arguments[1].body).text].length, 1001);
    });

    it('every voice preview text of the catalog fits the cap', () => {
        assert.ok(VOICE_CATALOG.length > 0);
        for (const voice of VOICE_CATALOG) {
            for (const lang of ['jp', 'en']) {
                const length = [...normalizeText(voice.previewText[lang])].length;
                assert.ok(length > 0 && length <= TTS_MAX_CHARS, `${voice.id} ${lang}: ${length}`);
            }
        }
    });
});
