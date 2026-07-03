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