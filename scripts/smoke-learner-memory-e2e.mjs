#!/usr/bin/env node
/**
 * Phase 19 learner-memory API contract smoke (bridge auth).
 *
 * Usage:
 *   node scripts/smoke-learner-memory-e2e.mjs
 *   E2E_API_URL=http://risepath-vm:3006 node scripts/smoke-learner-memory-e2e.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API = (process.env.E2E_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');

const results = [];

function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function loadBridgeToken() {
  if (process.env.RISE_PATH_BRIDGE_TOKEN) return process.env.RISE_PATH_BRIDGE_TOKEN;
  const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8').catch(() => '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('RISE_PATH_BRIDGE_TOKEN=')) {
      return trimmed.slice('RISE_PATH_BRIDGE_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

async function apiFetch(pathname, { method = 'GET', body } = {}, token) {
  const headers = {
    Accept: 'application/json',
    'x-nexloom-bridge-token': token,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { res, json };
}

async function main() {
  console.log(`# Phase 19 learner-memory E2E (API=${API})\n`);

  const token = await loadBridgeToken();
  if (!token) {
    record('bridge token configured', false, 'set RISE_PATH_BRIDGE_TOKEN');
    process.exit(1);
  }
  record('bridge token configured', true);

  const health = await fetch(`${API}/api/v2/health`);
  record('API /health', health.ok, `status=${health.status}`);

  const privacyGet = await apiFetch('/api/v2/learner-memory/privacy', {}, token);
  record(
    'GET /learner-memory/privacy',
    privacyGet.res.ok && privacyGet.json?.privacy,
    `enabled=${privacyGet.json?.privacy?.enabled}`,
  );

  const privacyPut = await apiFetch(
    '/api/v2/learner-memory/privacy',
    { method: 'PUT', body: { enabled: true, allow_conversation_capture: false } },
    token,
  );
  record('PUT /learner-memory/privacy (opt-in)', privacyPut.res.ok, `enabled=${privacyPut.json?.privacy?.enabled}`);

  // REST POST is always explicit UI (source=rise-path-ui); capture gate applies to MCP/Hermes only.
  const rememberUiWithCaptureOff = await apiFetch(
    '/api/v2/learner-memory',
    {
      method: 'POST',
      body: { content: 'UI explicit remember with capture off', confidence: 0.9, type: 'preference' },
    },
    token,
  );
  const uiRememberOk = rememberUiWithCaptureOff.res.ok
    && (rememberUiWithCaptureOff.json?.ok || rememberUiWithCaptureOff.json?.memory_id);
  record(
    'POST remember (UI path, capture off)',
    uiRememberOk,
    rememberUiWithCaptureOff.json?.semantic_memory_status
      || rememberUiWithCaptureOff.json?.error_type
      || `status=${rememberUiWithCaptureOff.res.status}`,
  );

  const rememberExplicit = await apiFetch(
    '/api/v2/learner-memory',
    {
      method: 'POST',
      body: {
        content: `E2E smoke preference ${Date.now()}`,
        confidence: 0.9,
        type: 'preference',
      },
    },
    token,
  );
  const rememberOk = rememberExplicit.res.ok
    && (rememberExplicit.json?.ok || rememberExplicit.json?.memory_id);
  record(
    'POST explicit remember (UI path)',
    rememberOk,
    rememberExplicit.json?.semantic_memory_status
      || rememberExplicit.json?.error_type
      || rememberExplicit.json?.error
      || `status=${rememberExplicit.res.status}`,
  );

  const listed = await apiFetch('/api/v2/learner-memory?limit=10', {}, token);
  record(
    'GET /learner-memory list',
    listed.res.ok,
    `count=${listed.json?.count ?? 0} status=${listed.json?.semantic_memory_status ?? 'n/a'}`,
  );

  const recallProxy = await apiFetch(
    '/api/v2/learner-memory',
    { method: 'GET' },
    token,
  );
  record('GET list after remember', recallProxy.res.ok, `memories=${recallProxy.json?.memories?.length ?? 0}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n❌ ${failed} step(s) failed` : '\n✅ Phase 19 learner-memory E2E passed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});