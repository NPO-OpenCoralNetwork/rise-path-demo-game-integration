import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyTtsRequestOptions,
    buildCacheKey,
    callKokoroSidecar,
    checkKokoroHealth,
    normalizeText,
    resolveLangCode,
    resolveVoiceId,
    requestTts,
    synthesize,
    validateSynthesisParams,
} from '../../tools/core/kokoroTts.js';

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
        process.env.KOKORO_TTS_CACHE_DIR = `/tmp/kokoro-tts-test-${Date.now()}`;
        const fs = await import('fs/promises');
        const path = await import('path');
        const cacheDir = process.env.KOKORO_TTS_CACHE_DIR;
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(path.join(cacheDir, `${cacheKey}.mp3`), Buffer.from('cached-audio'));
        await fs.writeFile(
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
        const cacheDir = `/tmp/kokoro-tts-test-${Date.now()}-miss`;
        process.env.KOKORO_TTS_CACHE_DIR = cacheDir;

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

        const fs = await import('fs/promises');
        const files = await fs.readdir(cacheDir);
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
        process.env.KOKORO_TTS_CACHE_DIR = `/tmp/kokoro-tts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
