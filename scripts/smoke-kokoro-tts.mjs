#!/usr/bin/env node
/**
 * Kokoro TTS smoke test (Issue #3).
 *
 * Usage:
 *   KOKORO_TTS_URL=http://127.0.0.1:8880 node scripts/smoke-kokoro-tts.mjs
 *   node scripts/smoke-kokoro-tts.mjs --api   # also hits Express /api/v2/tts/synthesize
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const args = new Set(process.argv.slice(2));
const checkApi = args.has('--api');

async function loadEnvLocal() {
    try {
        const raw = await fs.readFile(ENV_PATH, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            if (!key || process.env[key]) continue;
            let value = trimmed.slice(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    } catch {
        // optional
    }
}

function fail(message) {
    console.error(`[smoke:tts] FAIL: ${message}`);
    process.exit(1);
}

function ok(message) {
    console.log(`[smoke:tts] OK: ${message}`);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = { raw: text };
    }
    return { response, body };
}

await loadEnvLocal();

const sidecarUrl = (process.env.KOKORO_TTS_URL || 'http://127.0.0.1:8880').replace(/\/$/, '');
const apiBase = (process.env.RISE_PATH_API_URL || `http://127.0.0.1:${process.env.PORT || 3006}`).replace(/\/$/, '');

console.log(`[smoke:tts] sidecar=${sidecarUrl}${checkApi ? ` api=${apiBase}` : ''}`);

const health = await fetchJson(`${sidecarUrl}/health`);
if (!health.response.ok) {
    fail(`GET /health -> ${health.response.status}`);
}
if (health.body.status !== 'ok') {
    fail(`sidecar unhealthy: ${JSON.stringify(health.body)}`);
}
if (!health.body.models_ready) {
    fail('Kokoro model files not ready in sidecar container');
}
ok(`sidecar health (${health.body.engine}, uptime ${health.body.uptime_sec}s)`);

const synth = await fetchJson(`${sidecarUrl}/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        text: 'スモークテストです。Kokoro TTS は正常に動作しています。',
        voice_id: process.env.KOKORO_TTS_DEFAULT_VOICE_JA || 'jf_alpha',
        lang_code: 'j',
        speed: 1.0,
        output_format: 'mp3',
    }),
});

if (!synth.response.ok) {
    fail(`POST /tts/synthesize -> ${synth.response.status} ${JSON.stringify(synth.body)}`);
}
if (!synth.body.audio_base64 || !synth.body.duration_seconds) {
    fail(`unexpected synthesize payload: ${JSON.stringify(synth.body)}`);
}
const audioBytes = Buffer.from(synth.body.audio_base64, 'base64').length;
if (audioBytes < 500) {
    fail(`audio too small (${audioBytes} bytes)`);
}
ok(`sidecar synthesize (${audioBytes} bytes, ${synth.body.duration_seconds}s)`);

if (checkApi) {
    const api = await fetchJson(`${apiBase}/api/v2/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: 'API smoke test.',
            language: 'ja',
        }),
    });
    if (!api.response.ok) {
        fail(`POST /api/v2/tts/synthesize -> ${api.response.status} ${JSON.stringify(api.body)}`);
    }
    if (!api.body.audio_url) {
        fail(`API response missing audio_url: ${JSON.stringify(api.body)}`);
    }
    ok(`Express route -> ${api.body.audio_url}`);
}

console.log('[smoke:tts] All checks passed.');