/**
 * Kokoro TTS client — shared by Express, MCP, and scripts.
 * Spec: doc/ai-curriculum-spec/09_content_types_tts.md
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const KOKORO_TTS_URL = (process.env.KOKORO_TTS_URL || 'http://127.0.0.1:8880').replace(/\/$/, '');
const DEFAULT_VOICE_JA = process.env.KOKORO_TTS_DEFAULT_VOICE_JA || 'jf_alpha';
const DEFAULT_VOICE_EN = process.env.KOKORO_TTS_DEFAULT_VOICE_EN || 'af_bella';
const PUBLIC_BASE_URL = (process.env.RISE_PATH_PUBLIC_URL || '').replace(/\/$/, '');

function getCacheDir() {
    return process.env.KOKORO_TTS_CACHE_DIR
        ? path.resolve(process.env.KOKORO_TTS_CACHE_DIR)
        : path.join(REPO_ROOT, 'public', 'audio', 'cache');
}

export const VOICE_ID_PATTERN = /^(af_|am_|bf_|bm_|jf_|jm_|zf_|zm_|ef_|em_|ff_|hf_|hm_|if_|im_|pf_|pm_)[a-z0-9_]+$/;

const LANG_CODE_PATTERN = /^[jabzefhip]$/;
const LANGUAGE_PATTERN = /^(ja|en)$/;

export function validateSynthesisParams({ voice_id, language, lang_code, speed, output_format } = {}) {
    if (voice_id != null && (typeof voice_id !== 'string' || !VOICE_ID_PATTERN.test(voice_id))) {
        return { error: `Invalid voice_id: ${voice_id}`, error_type: 'validation' };
    }
    if (language != null && (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language))) {
        return { error: `Invalid language: ${language}`, error_type: 'validation' };
    }
    if (lang_code != null && (typeof lang_code !== 'string' || !LANG_CODE_PATTERN.test(lang_code))) {
        return { error: `Invalid lang_code: ${lang_code}`, error_type: 'validation' };
    }
    if (speed != null && (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2.0)) {
        return { error: 'speed must be a number between 0.5 and 2.0', error_type: 'validation' };
    }
    if (output_format != null && output_format !== 'mp3' && output_format !== 'wav') {
        return { error: 'output_format must be mp3 or wav', error_type: 'validation' };
    }
    return null;
}

export function resolveLangCode(language = 'ja', langCode) {
    if (langCode) return langCode;
    if (language === 'ja') return 'j';
    if (language === 'en') return 'a';
    return 'a';
}

export function resolveVoiceId({ language = 'ja', voice_id: voiceId } = {}) {
    if (voiceId) return voiceId;
    return language === 'ja' ? DEFAULT_VOICE_JA : DEFAULT_VOICE_EN;
}

export function normalizeText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
}

export function buildCacheKey({ voice_id, lang_code, speed, text }) {
    const payload = `${voice_id}|${lang_code}|${speed}|${normalizeText(text)}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
}

export function buildPublicAudioUrl(relativePath) {
    if (PUBLIC_BASE_URL) {
        return `${PUBLIC_BASE_URL}/${relativePath}`;
    }
    return `/${relativePath}`;
}

async function ensureCacheDir() {
    await fs.mkdir(getCacheDir(), { recursive: true });
}

async function readCachedAudio(cacheKey, outputFormat) {
    const ext = outputFormat === 'wav' ? 'wav' : 'mp3';
    const filePath = path.join(getCacheDir(), `${cacheKey}.${ext}`);
    try {
        const [buffer, metaRaw] = await Promise.all([
            fs.readFile(filePath),
            fs.readFile(`${filePath}.meta.json`, 'utf8').catch(() => null),
        ]);
        const meta = metaRaw ? JSON.parse(metaRaw) : {};
        const relativePath = `audio/cache/${cacheKey}.${ext}`;
        return {
            audio_url: buildPublicAudioUrl(relativePath),
            duration_seconds: meta.duration_seconds ?? null,
            cached: true,
            engine: 'kokoro-82m-onnx',
            cache_key: cacheKey,
            buffer,
        };
    } catch {
        return null;
    }
}

async function writeCachedAudio(cacheKey, outputFormat, buffer, durationSeconds) {
    await ensureCacheDir();
    const ext = outputFormat === 'wav' ? 'wav' : 'mp3';
    const filePath = path.join(getCacheDir(), `${cacheKey}.${ext}`);
    await fs.writeFile(filePath, buffer);
    await fs.writeFile(
        `${filePath}.meta.json`,
        JSON.stringify({ duration_seconds: durationSeconds, engine: 'kokoro-82m-onnx' }, null, 2),
    );
    const relativePath = `audio/cache/${cacheKey}.${ext}`;
    return {
        audio_url: buildPublicAudioUrl(relativePath),
        duration_seconds: durationSeconds,
        cached: false,
        engine: 'kokoro-82m-onnx',
        cache_key: cacheKey,
        buffer,
    };
}

export async function checkKokoroHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${KOKORO_TTS_URL}/health`, { signal: controller.signal });
        if (!response.ok) {
            return { ok: false, status: 'unavailable', models_ready: false };
        }
        const body = await response.json();
        const modelsReady = body.models_ready !== false;
        return {
            ok: body.status === 'ok' && modelsReady,
            status: body.status,
            engine: body.engine || 'kokoro-82m-onnx',
            models_ready: modelsReady,
        };
    } catch (err) {
        return {
            ok: false,
            status: 'unavailable',
            models_ready: false,
            error: err?.message || 'Kokoro sidecar unreachable',
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function callKokoroSidecar({
    text,
    voice_id,
    lang_code,
    speed = 1.0,
    output_format = 'mp3',
}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
        const response = await fetch(`${KOKORO_TTS_URL}/tts/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                voice_id,
                lang_code,
                speed,
                output_format,
            }),
            signal: controller.signal,
        });
        const bodyText = await response.text();
        if (!response.ok) {
            return {
                error: `Kokoro sidecar error (${response.status})`,
                error_type: 'tts_unavailable',
                details: bodyText,
            };
        }
        try {
            return JSON.parse(bodyText);
        } catch {
            return {
                error: 'Kokoro sidecar returned invalid JSON',
                error_type: 'tts_unavailable',
                details: bodyText.slice(0, 500),
            };
        }
    } catch (err) {
        const message = err?.name === 'AbortError'
            ? 'Kokoro sidecar request timed out'
            : (err?.message || 'Kokoro sidecar unreachable');
        return {
            error: message,
            error_type: 'tts_unavailable',
            details: String(err),
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function synthesize({
    text,
    language = 'ja',
    voice_id,
    lang_code,
    speed = 1.0,
    output_format = 'mp3',
    lesson_id: lessonId,
}) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return { error: 'text is required', error_type: 'validation' };
    }

    const resolvedVoice = resolveVoiceId({ language, voice_id });
    const paramError = validateSynthesisParams({
        voice_id: resolvedVoice,
        language,
        lang_code,
        speed,
        output_format,
    });
    if (paramError) return paramError;

    const resolvedLang = resolveLangCode(language, lang_code);
    const cacheKey = lessonId
        ? buildCacheKey({ voice_id: resolvedVoice, lang_code: resolvedLang, speed, text: `${lessonId}|${normalized}` })
        : buildCacheKey({ voice_id: resolvedVoice, lang_code: resolvedLang, speed, text: normalized });

    const cached = await readCachedAudio(cacheKey, output_format);
    if (cached) return cached;

    const sidecar = await callKokoroSidecar({
        text: normalized,
        voice_id: resolvedVoice,
        lang_code: resolvedLang,
        speed,
        output_format,
    });
    if (sidecar.error_type) return sidecar;

    if (!sidecar.audio_base64 || typeof sidecar.audio_base64 !== 'string') {
        return {
            error: 'Kokoro sidecar response missing audio_base64',
            error_type: 'tts_unavailable',
        };
    }

    const audioBuffer = Buffer.from(sidecar.audio_base64, 'base64');
    return writeCachedAudio(cacheKey, output_format, audioBuffer, sidecar.duration_seconds);
}

/** Back-compat for scripts that expect base64 audio from Gemini era. */
export async function generateAudioContent(speechScript, options = {}) {
    const result = await synthesize({
        text: speechScript,
        language: options.language || 'ja',
        voice_id: options.voice_id,
        lang_code: options.lang_code,
        speed: options.speed,
        output_format: options.output_format || 'mp3',
    });
    if (result.error_type) {
        throw new Error(result.error || 'Kokoro TTS synthesis failed');
    }
    return result.buffer.toString('base64');
}

/**
 * Merge explicit TTS args with saved user preferences.
 * Explicit args win when provided (non-null / non-undefined).
 */
export function applyTtsRequestOptions(explicit = {}, ttsPrefs = null) {
    const prefs = ttsPrefs && typeof ttsPrefs === 'object' ? ttsPrefs : {};
    const language = explicit.language ?? prefs.language ?? 'ja';

    return {
        text: explicit.text,
        language,
        voice_id: explicit.voice_id ?? prefs.voice_id,
        lang_code: explicit.lang_code ?? prefs.lang_code,
        speed: explicit.speed ?? prefs.speed,
        output_format: explicit.output_format ?? prefs.output_format ?? 'mp3',
        lesson_id: explicit.lesson_id,
    };
}

export async function loadUserTtsPreferences(userId) {
    if (!userId) return null;
    try {
        const { getPool } = await import('../../server/db.js');
        const pool = getPool?.();
        if (!pool) return null;
        const { getUserTtsPreferences } = await import('../../server/services/userPreferences.js');
        return getUserTtsPreferences(pool, userId);
    } catch (err) {
        console.warn('[kokoroTts] loadUserTtsPreferences failed:', err.message);
        return null;
    }
}

export async function requestTts({
    userId,
    text,
    language,
    voice_id,
    lang_code,
    speed,
    output_format = 'mp3',
    lesson_id,
}) {
    const ttsPrefs = userId ? await loadUserTtsPreferences(userId) : null;
    const opts = applyTtsRequestOptions({
        text,
        language,
        voice_id,
        lang_code,
        speed,
        output_format,
        lesson_id,
    }, ttsPrefs);

    return synthesize(opts);
}