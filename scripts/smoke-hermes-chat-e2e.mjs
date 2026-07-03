#!/usr/bin/env node
/**
 * Hermes chat E2E: diagnosis → agent chat → learner-memory recall.
 *
 * Usage:
 *   node scripts/smoke-hermes-chat-e2e.mjs
 *   E2E_API_URL=http://risepath-vm:3006 node scripts/smoke-hermes-chat-e2e.mjs
 *   node scripts/smoke-hermes-chat-e2e.mjs --keep-user
 *   node scripts/smoke-hermes-chat-e2e.mjs --skip-chat   # recall API only (no LLM)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const args = new Set(process.argv.slice(2));
const keepUser = args.has('--keep-user');
const skipChat = args.has('--skip-chat');

const API = (process.env.E2E_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');
const apiUrl = new URL(API);
const HERMES = (process.env.E2E_HERMES_URL || `${apiUrl.protocol}//${apiUrl.hostname}:8642`).replace(/\/$/, '');
const MCP = (process.env.E2E_MCP_URL || `${apiUrl.protocol}//${apiUrl.hostname}:3100`).replace(/\/$/, '');

const CHAT_TIMEOUT_MS = Number(process.env.E2E_HERMES_CHAT_TIMEOUT_MS || 180_000);

const results = [];

function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function loadEnvLocal() {
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function apiFetch(url, { token, method = 'GET', body, timeoutMs } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text.slice(0, 400) };
    }
    return { res, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  console.log('# Hermes chat E2E (diagnosis → chat → recall)\n');
  console.log(`API:    ${API}`);
  console.log(`Hermes: ${HERMES}`);
  console.log(`MCP:    ${MCP}\n`);

  let env;
  try {
    env = await loadEnvLocal();
  } catch {
    record('load .env.local', false);
    process.exit(1);
  }

  // --- 1. Diagnosis ---
  const health = await apiFetch(`${API}/api/v2/health`);
  record(
    'API /api/v2/health',
    health.res.ok && health.json?.ok,
    `strict_auth=${health.json?.auth_policy?.strict_auth_mode ?? '?'}`,
  );

  try {
    const hermesHealth = await fetch(`${HERMES}/health`, { signal: AbortSignal.timeout(15_000) });
    record('Hermes /health', hermesHealth.ok, `status=${hermesHealth.status}`);
  } catch (err) {
    record('Hermes /health', false, err.message || 'unreachable');
  }

  try {
    const mcpHealth = await fetch(`${MCP}/health`, { signal: AbortSignal.timeout(15_000) });
    const mcpBody = mcpHealth.ok ? await mcpHealth.json() : null;
    record(
      'MCP /health',
      mcpHealth.ok,
      mcpBody ? `db=${mcpBody.db ?? mcpBody.database ?? '?'}` : `status=${mcpHealth.status}`,
    );
  } catch (err) {
    record('MCP /health', false, err.message || 'unreachable');
  }

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    record('Supabase env', false, 'missing URL or keys');
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const email = `hermes-e2e+${stamp}@risepath.test`;
  const password = `E2e!${stamp}Hx`;
  const recallMarker = `E2E_RECALL_${stamp}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'smoke-hermes-chat-e2e' },
  });
  record('test user created', !createErr && Boolean(created?.user?.id), createErr?.message || email);
  if (createErr || !created?.user?.id) process.exit(1);

  const userId = created.user.id;
  let token = null;

  try {
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    token = session?.session?.access_token ?? null;
    record('test user login', !signInErr && Boolean(token), signInErr?.message || `user=${userId.slice(0, 8)}…`);
    if (!token) process.exit(1);

    const agentHealth = await apiFetch(`${API}/api/v2/agent/health`, { token });
    const hermesConfigured = agentHealth.json?.hermes_configured === true;
    record(
      'Agent /agent/health (JWT)',
      agentHealth.res.ok && hermesConfigured,
      `hermes_configured=${agentHealth.json?.hermes_configured} model=${agentHealth.json?.model ?? '?'}`,
    );
    if (!hermesConfigured) process.exit(1);

    // --- 2. Seed memory for recall ---
    const privacyPut = await apiFetch(`${API}/api/v2/learner-memory/privacy`, {
      token,
      method: 'PUT',
      body: { enabled: true, allow_conversation_capture: true },
    });
    record(
      'learner-memory privacy opt-in',
      privacyPut.res.ok && privacyPut.json?.privacy?.enabled === true,
      `enabled=${privacyPut.json?.privacy?.enabled}`,
    );

    const rememberBody = {
      content: `${recallMarker}: 短いセッションと図解での説明を好む（E2E smoke）`,
      confidence: 0.95,
      type: 'preference',
    };
    let remember = null;
    let remembered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      remember = await apiFetch(`${API}/api/v2/learner-memory`, {
        token,
        method: 'POST',
        body: rememberBody,
      });
      remembered = remember.res.ok
        && (remember.json?.memory_id
          || (remember.json?.ok === true && !remember.json?.skipped));
      if (remembered) break;
      if (remember.json?.error_type === 'service_unavailable' && attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      break;
    }
    record(
      'seed learner-memory',
      remembered,
      remember.json?.semantic_memory_status
        || remember.json?.error_type
        || remember.json?.error
        || `status=${remember.res.status}`,
    );

    // --- 3. Recall (REST list + marker match, allow Memanto indexing lag) ---
    let listed = null;
    let found = false;
    let memories = [];
    if (!remembered) {
      record('GET /learner-memory recall', false, 'seed learner-memory failed');
    } else {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        listed = await apiFetch(`${API}/api/v2/learner-memory?limit=20`, { token });
        memories = listed.json?.memories ?? [];
        found = memories.some((m) => {
          const text = `${m?.content ?? ''} ${m?.title ?? ''}`;
          return text.includes(recallMarker);
        });
        if (listed.res.ok && found) break;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      record(
        'GET /learner-memory recall',
        listed?.res.ok && found,
        `count=${listed?.json?.count ?? memories.length} marker=${found ? 'hit' : 'miss'} status=${listed?.json?.semantic_memory_status ?? 'n/a'}`,
      );
    }

    // --- 4. Chat (Hermes via Express proxy) ---
    if (!remembered || !found) {
      record('agent chat (skipped)', false, !remembered ? 'seed failed' : 'recall list miss');
    } else if (skipChat) {
      record('agent chat (skipped)', true, '--skip-chat');
    } else {
      const chat = await apiFetch(`${API}/api/v2/agent/chat`, {
        token,
        method: 'POST',
        timeoutMs: CHAT_TIMEOUT_MS,
        body: {
          skill: 'learning-coach',
          message: `記憶している私の学習の好みを1文で教えてください。マーカー ${recallMarker} に関連する内容があれば含めてください。`,
          context: { ui_language: 'jp' },
        },
      });

      const answer = typeof chat.json?.answer === 'string' ? chat.json.answer.trim() : '';
      const evidenceText = JSON.stringify(chat.json?.evidence ?? []);
      const recallHints = [recallMarker, '短いセッション', '図解', 'セッション', '好む'];
      const recallsSeed = recallHints.some((hint) => answer.includes(hint) || evidenceText.includes(hint));
      const looksLikeHttpError = /^HTTP \d{3}\b/.test(answer);
      const chatResponds = chat.res.ok && chat.json?.ok === true && answer.length > 10 && !looksLikeHttpError;
      record(
        'POST /agent/chat (learning-coach)',
        chatResponds,
        chatResponds
          ? `answer_len=${answer.length} evidence=${chat.json?.evidence?.length ?? 0}`
          : chat.json?.error_type || chat.json?.error || chat.json?.detail || `status=${chat.res.status}`,
      );
      record(
        'agent chat recalls seeded preference',
        chatResponds && recallsSeed,
        chatResponds
          ? `recall=${recallsSeed ? 'hit' : 'miss'} preview=${answer.slice(0, 80)}`
          : 'chat did not respond',
      );
    }

    const failed = results.filter((r) => !r.ok && !r.step?.includes('recalls seeded')).length;
    const recallChatMiss = results.some((r) => r.step === 'agent chat recalls seeded preference' && !r.ok);
    if (recallChatMiss) {
      console.log('⚠️  Chat responded but did not echo seeded preference (non-blocking)');
    }
    console.log(failed ? `\n❌ ${failed} step(s) failed` : '\n✅ Hermes chat E2E passed');
    process.exit(failed ? 1 : 0);
  } finally {
    if (!keepUser) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});