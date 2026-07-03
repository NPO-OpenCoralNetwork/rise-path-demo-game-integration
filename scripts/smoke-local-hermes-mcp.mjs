#!/usr/bin/env node
/**
 * Smoke test: local MCP SSE + Hermes API Server.
 * Usage: node scripts/smoke-local-hermes-mcp.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MCP = process.env.MCP_URL || 'http://127.0.0.1:3100';
const HERMES = process.env.HERMES_URL || 'http://127.0.0.1:8642';

async function loadEnv() {
  const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

async function main() {
  const env = await loadEnv();
  let ok = true;

  console.log('# Local Hermes + MCP smoke\n');

  const hermesConfig = await fs.readFile(
    path.join(process.env.HOME || '', '.hermes/profiles/rise-path/config.yaml'),
    'utf8',
  ).catch(() => '');
  const mcpViaStdio = hermesConfig.includes('command:') && !hermesConfig.includes('url:');

  if (mcpViaStdio) {
    console.log('ℹ️  Hermes stdio mode — MCP runs as subprocess (no separate :3100 server)');
  } else {
    try {
      const mcp = await fetch(`${MCP}/health`);
      const body = await mcp.json();
      if (mcp.ok) {
        console.log(`✅ MCP /health → ${body.status} db=${body.db ?? body.database}`);
      } else {
        console.log(`❌ MCP /health → ${mcp.status}`);
        ok = false;
      }
    } catch {
      console.log(`❌ MCP not running at ${MCP} — start: npm run mcp:local`);
      ok = false;
    }
  }

  try {
    const hermes = await fetch(`${HERMES}/health`);
    if (hermes.ok) {
      console.log('✅ Hermes /health → 200');
    } else {
      console.log(`❌ Hermes /health → ${hermes.status} — start: npm run hermes:local`);
      ok = false;
    }
  } catch {
    console.log(`❌ Hermes not running at ${HERMES} — start: npm run hermes:local`);
    ok = false;
  }

  const apiKey = env.HERMES_API_KEY || 'change-me-local-dev';
  if (ok && env.OPENROUTER_API_KEY) {
    const chat = await fetch(`${HERMES}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages: [{ role: 'user', content: 'Reply with exactly: RISE_PATH_OK' }],
        max_tokens: 32,
      }),
    });
    if (chat.ok) {
      console.log('✅ Hermes chat/completions → 200 (MCP tools available to agent)');
    } else {
      const err = await chat.text();
      console.log(`⚠️  Hermes chat → ${chat.status} ${err.slice(0, 120)}`);
    }
  } else if (!env.OPENROUTER_API_KEY) {
    console.log('⚠️  Skipping Hermes chat test (OPENROUTER_API_KEY not in .env.local)');
  }

  const express = env.PORT || '3006';
  try {
    const agent = await fetch(`http://127.0.0.1:${express}/api/v2/agent/health`);
    if (agent.status === 401) {
      console.log('✅ Express /agent/health → 401 without JWT (expected)');
    } else if (agent.ok) {
      const body = await agent.json();
      console.log(`✅ Express /agent/health → hermes_configured=${body.hermes_configured}`);
    }
  } catch {
    console.log(`⚠️  Express not running on :${express} — start: npm run dev`);
  }

  console.log(ok ? '\n✅ Local Hermes + MCP smoke passed' : '\n❌ Local Hermes + MCP smoke failed');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});