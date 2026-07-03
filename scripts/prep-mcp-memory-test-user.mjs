#!/usr/bin/env node
/**
 * Prepare a test user for rise-path MCP learner-memory tools (opt-in only).
 * Register agent_session_binding separately (VM docker exec or agent/chat).
 *
 * Usage:
 *   node scripts/prep-mcp-memory-test-user.mjs
 *   E2E_API_URL=http://risepath-vm:3006 node scripts/prep-mcp-memory-test-user.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API = (process.env.E2E_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');

async function loadEnvLocal() {
  const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
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

async function main() {
  const env = await loadEnvLocal();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error('Missing Supabase env in .env.local');
    process.exit(1);
  }

  const stamp = Date.now();
  const email = `mcp-memory+${stamp}@risepath.test`;
  const password = `E2e!${stamp}Mx`;
  const marker = `MCP_GROK_${stamp}`;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'prep-mcp-memory-test-user' },
  });
  if (createErr || !created?.user?.id) {
    console.error('createUser failed:', createErr?.message || 'no user id');
    process.exit(1);
  }

  const userId = created.user.id;
  const sessionKey = `rp:user:${userId}`;

  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  const token = session?.session?.access_token;
  if (signInErr || !token) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error('signIn failed:', signInErr?.message || 'no token');
    process.exit(1);
  }

  const privacy = await fetch(`${API}/api/v2/learner-memory/privacy`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ enabled: true, allow_conversation_capture: true }),
  });
  const privacyJson = privacy.ok ? await privacy.json() : null;
  if (!privacy.ok || privacyJson?.privacy?.enabled !== true) {
    const body = privacy.ok ? JSON.stringify(privacyJson) : await privacy.text();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error('privacy opt-in failed:', privacy.status, body.slice(0, 200));
    process.exit(1);
  }

  console.log(JSON.stringify({ userId, sessionKey, email, marker }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});