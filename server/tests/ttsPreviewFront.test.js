// @ts-check
// The voice preview's answer to the server's TTS text cap (Phase 9, owner decision D3; design §4.2,
// §4.3 "front harness"): services/ttsPreferencesService.ts previewVoice turns a 400 whose code is
// text_too_long into the learner's message in their UI language (copy { en, jp }); other answers keep
// today's handling. The service is bundled with esbuild (a Vite dependency) with apiClient and
// userProfileService stubbed; globalThis.__answer is what /tts/synthesize answers.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const STUBS = /** @type {Record<string, string>} */ ({
  api: `
    export const apiFetch = async (url, init) => {
      (globalThis.__calls ??= []).push({ url, body: init && init.body });
      const { status, body } = globalThis.__answer;
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
    export const apiGet = async () => null;
    export const isApiAvailable = () => true;
  `,
  profile: 'export const clearUserProfileCache = () => {};',
});

async function bundle() {
  const result = await build({
    stdin: { contents: "export * from './services/ttsPreferencesService';", resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /\/apiClient$/ }, () => ({ path: 'api', namespace: 'stub' }));
        b.onResolve({ filter: /\/userProfileService$/ }, () => ({ path: 'profile', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
      },
    }],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const TOO_LONG_BODY = { error: 'text is too long', error_type: 'validation', code: 'text_too_long', max_chars: 1000 };
const MESSAGES = /** @type {Record<string, string>} */ ({
  jp: 'この文は長すぎて、読み上げられません（1,000 文字まで）。',
  en: 'This text is too long to read aloud (up to 1,000 characters).',
});

describe('previewVoice: the TTS text cap (text_too_long)', () => {
  /** @type {any} */
  let service;
  before(async () => {
    service = await bundle();
  });

  /**
   * previewVoice's rejection for an answer.
   * @param {{ status: number, body: object }} answer @param {string} language
   * @returns {Promise<any>}
   */
  const refusal = async (answer, language) => {
    globalThis.__answer = answer;
    globalThis.__calls = [];
    try {
      await service.previewVoice('jf_alpha', language);
    } catch (error) {
      return error;
    }
    assert.fail('previewVoice resolved');
  };

  it('shows the learner the cap in their language (jp and en), not the server text', async () => {
    for (const language of ['jp', 'en']) {
      const error = await refusal({ status: 400, body: TOO_LONG_BODY }, language);
      assert.equal(error.message, MESSAGES[language], language);
      assert.equal(service.isTtsUnavailableError(error), false, 'not "voice unavailable": the voice service still works');
      assert.equal(globalThis.__calls.length, 1);
      assert.equal(globalThis.__calls[0].url, '/tts/synthesize');
    }
  });

  it('keeps every other answer as before: another 400 shows its text; 503 is TtsUnavailableError', async () => {
    const invalid = await refusal({ status: 400, body: { error: 'Invalid voice_id: nope', error_type: 'validation' } }, 'jp');
    assert.equal(invalid.message, 'Invalid voice_id: nope');
    // The code alone decides, only on a 400.
    const notCap = await refusal({ status: 500, body: { ...TOO_LONG_BODY, error: 'TTS synthesis failed' } }, 'en');
    assert.equal(notCap.message, 'TTS synthesis failed');
    const unavailable = await refusal({ status: 503, body: { error: 'Voice service is unavailable', error_type: 'tts_unavailable' } }, 'jp');
    assert.equal(service.isTtsUnavailableError(unavailable), true);
  });
});
