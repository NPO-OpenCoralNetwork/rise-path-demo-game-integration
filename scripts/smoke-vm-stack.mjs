#!/usr/bin/env node
/**
 * Smoke test for risepath-vm Docker stack (Phase 15-6 / Phase 19 Memanto).
 * Run on the VM host after `docker compose up` or from Mac via Tailscale.
 *
 * Usage:
 *   node scripts/smoke-vm-stack.mjs --target host --require-mcp
 *   docker compose exec api node scripts/smoke-vm-stack.mjs --target container --require-mcp
 *   node scripts/smoke-vm-stack.mjs --base http://risepath-vm:3006 --mcp http://risepath-vm:3100
 */
import { existsSync } from 'node:fs';

function resolveTarget(args) {
  const idx = args.indexOf('--target');
  if (idx >= 0) {
    const value = args[idx + 1];
    if (value === 'host' || value === 'container') return value;
    throw new Error('--target must be "host" or "container"');
  }
  if (process.env.SMOKE_TARGET === 'container') return 'container';
  if (existsSync('/.dockerenv')) return 'container';
  return 'host';
}

/** @param {'host'|'container'} target */
function endpointPresets(target) {
  const apiPort = process.env.PORT || '3006';
  const mcpPort = process.env.MCP_SSE_PORT || '3100';
  const hermesPort = process.env.API_SERVER_PORT || process.env.HERMES_PORT || '8642';
  const memantoHostPort = process.env.MEMANTO_API_PORT || '8100';

  if (target === 'container') {
    return {
      api: `http://127.0.0.1:${apiPort}`,
      mcp: `http://mcp:${mcpPort}`,
      kokoro: 'http://kokoro-tts:8880',
      hermes: `http://hermes:${hermesPort}`,
      memanto: 'http://memanto:8000',
    };
  }

  return {
    api: `http://127.0.0.1:${apiPort}`,
    mcp: `http://127.0.0.1:${mcpPort}`,
    kokoro: 'http://127.0.0.1:8880',
    hermes: `http://127.0.0.1:${hermesPort}`,
    memanto: `http://127.0.0.1:${memantoHostPort}`,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const read = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : fallback;
  };
  const target = resolveTarget(args);
  const preset = endpointPresets(target);

  return {
    target,
    apiBase: read('--base', process.env.E2E_API_URL || preset.api).replace(/\/$/, ''),
    mcpBase: read('--mcp', process.env.E2E_MCP_URL || preset.mcp).replace(/\/$/, ''),
    kokoroBase: read('--kokoro', process.env.E2E_KOKORO_URL || preset.kokoro).replace(/\/$/, ''),
    hermesBase: read('--hermes', process.env.E2E_HERMES_URL || preset.hermes).replace(/\/$/, ''),
    memantoBase: read('--memanto', process.env.E2E_MEMANTO_URL || preset.memanto).replace(/\/$/, ''),
    requireMcp: args.includes('--require-mcp'),
    requireKokoro: args.includes('--require-kokoro'),
    requireHermes: args.includes('--require-hermes'),
    requireMemanto: args.includes('--require-memanto'),
  };
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { res, body, error: null };
  } catch (error) {
    return { res: null, body: null, error };
  }
}

async function main() {
  const {
    target,
    apiBase, mcpBase, kokoroBase, hermesBase, memantoBase,
    requireMcp, requireKokoro, requireHermes, requireMemanto,
  } = parseArgs();
  let ok = true;

  console.log('# Rise Path VM stack smoke (Phase 15-6 / 19)');
  console.log(`Target: ${target}`);
  console.log(`API:    ${apiBase}`);
  console.log(`MCP:    ${mcpBase}`);
  console.log(`Kokoro: ${kokoroBase}`);
  console.log(`Hermes:   ${hermesBase}`);
  console.log(`Memanto:  ${memantoBase}\n`);

  const health = await fetchJson(`${apiBase}/api/v2/health`);
  let strictAuth = health.body?.auth_policy?.strict_auth_mode === true;
  if (health.res?.status === 200 && health.body?.ok) {
    const { auth_policy, database, frontend } = health.body;
    strictAuth = auth_policy?.strict_auth_mode === true;
    console.log('✅ API /api/v2/health → 200');
    console.log(`   strict_auth=${strictAuth} demo_mode=${frontend?.demo_mode}`);
    console.log(`   db=${database?.status} migrations_pending=${database?.migrations?.pending ?? '?'}`);
    if (!strictAuth) {
      console.log('⚠️  strict_auth_mode=false — set VITE_DEMO_MODE=false in stack.env');
      ok = false;
    }
    if (database?.migrations?.pending > 0) {
      console.log('❌ Pending migrations — run: docker compose exec api npm run db:migrate');
      ok = false;
    }
  } else if (health.res?.status === 401) {
    console.log('⚠️  API /api/v2/health → 401 (legacy image — redeploy with Phase 15-1 health route)');
  } else if (health.error) {
    console.log(`❌ API /api/v2/health unreachable (${health.error.message})`);
    ok = false;
  } else {
    console.log(`❌ API /api/v2/health → ${health.res?.status ?? 'unreachable'}`);
    const pending = health.body?.database?.migrations?.pending_versions;
    if (pending?.length) {
      console.log(`   pending migrations: ${pending.join(', ')} — apply them before the new api image starts (deploy-stack.sh does)`);
    }
    ok = false;
  }

  const portals = await fetchJson(`${apiBase}/api/learning-portals`);
  if (portals.res.status === 200 && portals.body?.ok) {
    console.log(`✅ API /api/learning-portals → 200 (count=${portals.body.portals?.length ?? 0})`);
    if (portals.body.portals?.some((portal) => portal.id === 'claude-code')) {
      console.log('✅ Learning Hub portal claude-code present');
    } else {
      console.log('⚠️  Learning Hub portal claude-code missing — migration 011 may be pending (npm run db:migrate:status)');
    }
  } else {
    console.log(`❌ API /api/learning-portals → ${portals.res.status}`);
    ok = false;
  }

  const curricula = await fetchJson(`${apiBase}/api/v2/curricula`);
  if (!strictAuth && curricula.res.status === 401) {
    strictAuth = true;
    console.log('ℹ️  strict auth inferred from curricula → 401');
  }
  if (strictAuth && curricula.res.status === 401) {
    console.log('✅ API /api/v2/curricula → 401 without JWT (strict auth)');
  } else if (curricula.res.status === 200 && curricula.body?.ok) {
    console.log(`✅ API /api/v2/curricula → 200 (count=${curricula.body.curricula?.length ?? 0})`);
  } else if (curricula.res.status === 503) {
    console.log('❌ API /api/v2/curricula → 503 DB not configured');
    ok = false;
  } else {
    console.log(`❌ API /api/v2/curricula → ${curricula.res.status}`);
    ok = false;
  }

  // The api image serves the built front end (dist/) with an SPA fallback; without dist/ the
  // route is a plain 404 and the front end is deployed elsewhere, so there is nothing to check.
  const page = await fetchJson(`${apiBase}/claude-code`);
  const pageType = page.res?.headers.get('content-type') ?? '';
  if (page.res?.status === 200 && pageType.includes('text/html')) {
    console.log('✅ Front end /claude-code → 200 (HTML)');
  } else if (page.error || page.res.status === 404) {
    console.log('ℹ️  Front end /claude-code skipped (API does not serve dist/)');
  } else {
    console.log(`❌ Front end /claude-code → ${page.res.status} ${pageType}`.trimEnd());
    ok = false;
  }

  const llm = await fetchJson(`${apiBase}/api/v2/llm/status`);
  if (llm.error) {
    console.log(`⚠️  LLM /api/v2/llm/status unreachable (${llm.error.message})`);
  } else if (llm.res.status >= 500) {
    console.log(`❌ LLM /api/v2/llm/status → ${llm.res.status}`);
    ok = false;
  } else if (llm.res.status === 200 && llm.body) {
    const { providers, tasks, mock, forced_provider: forced } = llm.body;
    // `ok` only says some key (or the mock) exists; a pinned provider without a key leaves the
    // tutor task with no route, and those calls answer 503 no_provider.
    const tutorProvider = tasks?.['tutor.chat']?.provider;
    const usable = llm.body.ok === true && mock !== true && Boolean(tutorProvider);
    const state = [
      `anthropic=${providers?.anthropic?.configured === true}`,
      `gemini=${providers?.gemini?.configured === true}`,
      `mock=${mock === true}`,
      ...(forced ? [`forced=${forced}`] : []),
      `tutor=${tutorProvider ?? 'none'}`,
    ].join(' ');
    console.log(`${usable ? '✅' : '⚠️ '} LLM /api/v2/llm/status → 200 (${state})`);
    if (llm.body.ok !== true) {
      console.log('   No LLM provider configured — AI tutor calls answer 503 (set ANTHROPIC_API_KEY or GEMINI_API_KEY in stack.env)');
    } else if (!tutorProvider) {
      console.log(`   No provider for tutor.chat — AI tutor calls answer 503 (check LLM_PROVIDER${forced ? `=${forced}` : ''} and LLM_TASK_TUTOR_CHAT against ANTHROPIC_API_KEY / GEMINI_API_KEY in stack.env)`);
    } else if (mock === true) {
      console.log('   The built-in mock answers AI tutor calls (no provider key, or LLM_PROVIDER=mock)');
    }
  } else {
    console.log(`⚠️  LLM /api/v2/llm/status → ${llm.res.status} (image without the LLM gateway?)`);
  }

  const mcpHealth = await fetchJson(`${mcpBase}/health`);
  if (mcpHealth.error) {
    const msg = `MCP not reachable at ${mcpBase}`;
    if (requireMcp) {
      console.log(`❌ ${msg}`);
      ok = false;
    } else {
      console.log(`⚠️  ${msg} (start: docker compose up mcp, or pass --require-mcp on VM)`);
    }
  } else if (mcpHealth.res.status === 200) {
    console.log(`✅ MCP /health → 200 (db=${mcpHealth.body?.db ?? mcpHealth.body?.database ?? 'ok'})`);
  } else {
    console.log(`❌ MCP /health → ${mcpHealth.res.status}`);
    ok = false;
  }

  const kokoro = await fetchJson(`${kokoroBase}/health`);
  if (kokoro.error) {
    const msg = `Kokoro not reachable at ${kokoroBase}`;
    if (requireKokoro) {
      console.log(`❌ ${msg}`);
      ok = false;
    } else {
      console.log(`⚠️  ${msg} (optional — included in full VM compose)`);
    }
  } else if (kokoro.res.status === 200 && kokoro.body?.status === 'ok') {
    console.log(`✅ Kokoro /health → 200 (${kokoro.body.engine ?? 'kokoro'})`);
  } else if (requireKokoro) {
    console.log(`❌ Kokoro /health → ${kokoro.res?.status ?? 'error'}`);
    ok = false;
  } else {
    console.log(`⚠️  Kokoro /health → ${kokoro.res?.status ?? 'error'} (optional)`);
  }

  const hermesHealth = await fetchJson(`${hermesBase}/health`);
  if (hermesHealth.error) {
    const msg = `Hermes not reachable at ${hermesBase}`;
    if (requireHermes) {
      console.log(`❌ ${msg}`);
      ok = false;
    } else {
      console.log(`⚠️  ${msg} (enable: docker compose --profile full up hermes)`);
    }
  } else if (hermesHealth.res.status === 200) {
    console.log(`✅ Hermes /health → 200`);
  } else if (requireHermes) {
    console.log(`❌ Hermes /health → ${hermesHealth.res.status}`);
    ok = false;
  } else {
    console.log(`⚠️  Hermes /health → ${hermesHealth.res.status} (optional)`);
  }

  const memantoReady = await fetchJson(`${memantoBase}/ready`);
  if (memantoReady.error) {
    const msg = `Memanto not reachable at ${memantoBase}`;
    if (requireMemanto) {
      console.log(`❌ ${msg}`);
      ok = false;
    } else {
      console.log(`⚠️  ${msg} (optional — Phase 19 memory overlay)`);
    }
  } else if (memantoReady.res.status === 200) {
    console.log('✅ Memanto /ready → 200');
  } else if (requireMemanto) {
    console.log(`❌ Memanto /ready → ${memantoReady.res?.status ?? 'error'}`);
    ok = false;
  } else {
    console.log(`⚠️  Memanto /ready → ${memantoReady.res?.status ?? 'error'} (optional)`);
  }

  const agentHealth = await fetchJson(`${apiBase}/api/v2/agent/health`);
  if (agentHealth.error) {
    console.log(`⚠️  Agent /agent/health unreachable`);
  } else if (agentHealth.res.status === 401 && health.body?.auth_policy?.strict_auth_mode) {
    console.log('✅ Agent /agent/health → 401 without JWT (strict auth; Hermes check via authenticated proxy)');
  } else if (agentHealth.res.status === 200) {
    const configured = agentHealth.body?.hermes_configured;
    console.log(`${configured ? '✅' : '⚠️ '} Agent /agent/health → hermes_configured=${configured}`);
    if (!configured) {
      console.log('   Hermes gateway not reachable — run on Mac or enable hermes service on VM');
    }
  } else {
    console.log(`⚠️  Agent /agent/health → ${agentHealth.res.status}`);
  }

  console.log(ok ? '\n✅ VM stack smoke passed' : '\n❌ VM stack smoke failed');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});