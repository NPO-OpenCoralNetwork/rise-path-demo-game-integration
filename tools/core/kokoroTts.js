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

// Phase 9 (owner decision D3): a learner's request (requestTts: POST /api/v2/tts/synthesize and the MCP
// request-tts tool) sends at most TTS_MAX_CHARS characters to the sidecar, and the audio cache prunes itself
// (pruneTtsCache, at most once per TTS_CACHE_PRUNE_INTERVAL_MS per process) after a new file is written and on
// the api's hourly timer (server.js main()); a cached file older than the age limit is never served.
// Retention does not touch the cache (server/services/retention.js). Kept below the module header so the
// line numbers doc/legal/ai-data-inventory.ja.md cites (KOKORO_TTS_URL, getCacheDir) stay where they were.

/**
 * The most text one learner request may send to the sidecar: Unicode code points after normalizeText
 * (design §4.1; today's longest real text is a 20-40 character voice preview). Checked in requestTts
 * only, never in synthesize(): the staff script scripts/regenerate_slides_audio.js reaches synthesize()
 * through generateAudioContent with whole slide narrations.
 */
export const TTS_MAX_CHARS = 1000;

/** What requestTts answers for a longer text: a validation result (400 on the REST route, the MCP tool result). */
export const TTS_TEXT_TOO_LONG = Object.freeze({
    error: 'text is too long',
    error_type: 'validation',
    code: 'text_too_long',
    max_chars: TTS_MAX_CHARS,
});

/** True when `text` has more than `max` Unicode code points (stops counting at max + 1). */
function longerThan(text, max) {
    let count = 0;
    for (const _ of text) {
        count += 1;
        if (count > max) return true;
    }
    return false;
}

/**
 * The audio cache's limits (design §4.1). The cache lives in the api container's writable layer and
 * every deploy empties it; between deploys these keep it bounded. Age is the file's mtime (a cache hit
 * does not refresh it, and a file older than maxAgeDays is a cache miss, written again); size and count
 * are of audio files; a prune over either limit goes down to TTS_CACHE_PRUNE_TARGET of both, oldest first.
 */
export const TTS_CACHE_LIMITS = Object.freeze({ maxAgeDays: 30, maxBytes: 256 * 1024 * 1024, maxFiles: 4000 });
export const TTS_CACHE_PRUNE_TARGET = 0.9;
export const TTS_CACHE_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/**
 * How often the api's timer (server.js main()) calls maybePruneTtsCache, so audio past maxAgeDays goes
 * within about an hour even when nothing new is written (design §4.2: kept at most 30 days).
 */
export const TTS_CACHE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** The only names the cache writes (writeCachedAudio): `<sha256>.<mp3|wav>` and its `.meta.json`. */
const CACHE_FILE_RE = /^[a-f0-9]{64}\.(?:mp3|wav)(?:\.meta\.json)?$/;
const META_SUFFIX = '.meta.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when a cache file's mtime is more than maxAgeDays before now. */
function tooOld(mtimeMs, now, maxAgeDays) {
    return now - mtimeMs > maxAgeDays * DAY_MS;
}

/**
 * Deletes cache files older than limits.maxAgeDays, then, when the audio files left are over
 * limits.maxBytes or limits.maxFiles, the oldest until both are at TTS_CACHE_PRUNE_TARGET of their
 * limit. Only regular files (lstat) whose names the cache writes; an audio file and its .meta.json go
 * together (a .meta.json without audio counts as its own, empty entry); an entry whose first file
 * changed since the listing (written again meanwhile) stays. Never throws; logs counts or an error
 * code only, never a name or a path.
 * @param {{ dir?: string, now?: number, limits?: { maxAgeDays: number, maxBytes: number, maxFiles: number } }} [options]
 * @returns {Promise<{ removed: number, failed: number }>} files removed, files that could not be removed
 */
export async function pruneTtsCache({ dir = getCacheDir(), now = Date.now(), limits = TTS_CACHE_LIMITS } = {}) {
    let removed = 0;
    let failed = 0;
    try {
        let names;
        try {
            names = await fs.readdir(dir);
        } catch (err) {
            if (err?.code === 'ENOENT') return { removed, failed };
            throw err;
        }
        /** @type {Map<string, { files: string[], audio: boolean, bytes: number, mtimeMs: number }>} */
        const entries = new Map();
        for (const name of names) {
            if (!CACHE_FILE_RE.test(name)) continue;
            let stat;
            try {
                stat = await fs.lstat(path.join(dir, name));
            } catch {
                continue;
            }
            if (!stat.isFile()) continue;
            const isMeta = name.endsWith(META_SUFFIX);
            const key = isMeta ? name.slice(0, -META_SUFFIX.length) : name;
            const entry = entries.get(key) ?? { files: [], audio: false, bytes: 0, mtimeMs: stat.mtimeMs };
            if (isMeta) {
                entry.files.push(name);
            } else {
                // The audio file goes first, so a failed unlink keeps its .meta.json too.
                entry.files.unshift(name);
                entry.audio = true;
                entry.bytes = stat.size;
                entry.mtimeMs = stat.mtimeMs;
            }
            entries.set(key, entry);
        }

        const remove = async (entry) => {
            // Right before the first unlink, its first file (the audio, or a lone .meta.json) again: a
            // learner's request may have written the entry again while this prune ran (a stale file is
            // a miss and writeCachedAudio keeps the path, with a new mtime). Then the whole entry stays
            // (final review, finding 10). Gone or no longer a regular file: nothing to remove either.
            try {
                const current = await fs.lstat(path.join(dir, entry.files[0]));
                if (!current.isFile() || current.mtimeMs !== entry.mtimeMs) return;
            } catch {
                return;
            }
            for (const name of entry.files) {
                try {
                    await fs.unlink(path.join(dir, name));
                    removed += 1;
                } catch (err) {
                    if (err?.code === 'ENOENT') continue;
                    failed += 1;
                    return;
                }
            }
        };

        const oldest = [...entries.entries()]
            .sort(([a, x], [b, y]) => x.mtimeMs - y.mtimeMs || (a < b ? -1 : a > b ? 1 : 0))
            .map(([, entry]) => entry);
        const kept = [];
        for (const entry of oldest) {
            if (tooOld(entry.mtimeMs, now, limits.maxAgeDays)) await remove(entry);
            else kept.push(entry);
        }

        let bytes = kept.reduce((sum, entry) => sum + entry.bytes, 0);
        let files = kept.filter((entry) => entry.audio).length;
        if (bytes > limits.maxBytes || files > limits.maxFiles) {
            const targetBytes = Math.floor(limits.maxBytes * TTS_CACHE_PRUNE_TARGET);
            const targetFiles = Math.floor(limits.maxFiles * TTS_CACHE_PRUNE_TARGET);
            for (const entry of kept) {
                if (bytes <= targetBytes && files <= targetFiles) break;
                await remove(entry);
                // Counted as gone even when the unlink failed, so a read-only file never makes
                // the prune take everything newer with it.
                bytes -= entry.bytes;
                if (entry.audio) files -= 1;
            }
        }
    } catch (err) {
        console.warn('[kokoroTts] cache prune failed:', typeof err?.code === 'string' ? err.code : 'error');
        return { removed, failed };
    }
    if (removed > 0) console.log(`[kokoroTts] cache prune: ${removed} removed`);
    if (failed > 0) console.warn(`[kokoroTts] cache prune: ${failed} could not be removed`);
    return { removed, failed };
}

let pruneClock = () => Date.now();
/** @type {number | null} */
let lastPruneAt = null;
/** @type {Promise<{ removed: number, failed: number }> | null} */
let lastPrune = null;

/**
 * Starts pruneTtsCache unless this process started one less than TTS_CACHE_PRUNE_INTERVAL_MS ago.
 * writeCachedAudio calls it without waiting, and so does the api's timer (server.js main(), every
 * TTS_CACHE_SWEEP_INTERVAL_MS). Returns the prune's promise, or null when skipped.
 */
export function maybePruneTtsCache() {
    const now = pruneClock();
    if (lastPruneAt !== null && now - lastPruneAt < TTS_CACHE_PRUNE_INTERVAL_MS) return null;
    lastPruneAt = now;
    lastPrune = pruneTtsCache({ now });
    return lastPrune;
}

/** Tests only: the clock maybePruneTtsCache and the cache read's age check use (none: Date.now), and no prune started yet. */
export function setTtsCachePruneClockForTests(clock) {
    pruneClock = typeof clock === 'function' ? clock : () => Date.now();
    lastPruneAt = null;
    lastPrune = null;
}

/** Tests only: settles when the prune maybePruneTtsCache started last has finished. */
export function lastTtsCachePruneForTests() {
    return lastPrune ?? Promise.resolve(null);
}

async function ensureCacheDir() {
    await fs.mkdir(getCacheDir(), { recursive: true });
}

async function readCachedAudio(cacheKey, outputFormat) {
    const ext = outputFormat === 'wav' ? 'wav' : 'mp3';
    const filePath = path.join(getCacheDir(), `${cacheKey}.${ext}`);
    try {
        // Older than the age limit: a miss, so the audio is made and written again (a new mtime). No
        // learner gets audio kept longer than that, even before a prune removes the file (the write's
        // prune or the api's hourly timer). No prune starts here; one already running checks each
        // file's mtime again right before removing it, so a file written again meanwhile is kept.
        const stat = await fs.stat(filePath);
        if (tooOld(stat.mtimeMs, pruneClock(), TTS_CACHE_LIMITS.maxAgeDays)) return null;
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
    // Not awaited: the learner's answer never waits for the prune (it never rejects).
    void maybePruneTtsCache();
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
        // Awaited here so a failed read lands in the catch below (default voice), not in the caller.
        return await getUserTtsPreferences(pool, userId);
    } catch (err) {
        console.warn('[kokoroTts] loadUserTtsPreferences failed:', err.message);
        return null;
    }
}

/** What requestTts answers when the sidecar fails: no sidecar text, status or exception message. */
export const TTS_UNAVAILABLE = Object.freeze({ error: 'Voice service is unavailable', error_type: 'tts_unavailable' });

/**
 * Synthesize for a learner (the MCP request-tts tool and POST /api/v2/tts/synthesize). A text longer
 * than TTS_MAX_CHARS is answered with TTS_TEXT_TOO_LONG first: no preference read, no cache, no
 * sidecar. Validation errors are returned as they are. Any other failure is logged here with the
 * sidecar's own error and response body, and answered with TTS_UNAVAILABLE only: an MCP tool result
 * reaches the LLM and can be quoted to the learner.
 */
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
    if (longerThan(normalizeText(text), TTS_MAX_CHARS)) return { ...TTS_TEXT_TOO_LONG };
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

    const result = await synthesize(opts);
    if (result.error_type && result.error_type !== 'validation') {
        console.error(
            '[kokoroTts] synthesis unavailable:',
            result.error_type,
            result.error,
            String(result.details ?? '').slice(0, 500),
        );
        return { ...TTS_UNAVAILABLE };
    }
    return result;
}