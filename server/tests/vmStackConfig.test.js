// VM stack config for the public edge: cloudflared (compose profile `tunnel`) publishes
// https://api.<domain> through Cloudflare Tunnel. It is pinned by tag and digest, reads only
// tunnel.env, publishes no ports and reaches api by name on the `edge` network. The stack
// publishes its ports on all host interfaces, so a tunnel route pointing at a host or gateway IP
// could reach them too: the tunnel's only Published application must be http://api:3006.
// tunnel.env stays out of git and, with stack.env, out of the Docker build context;
// deploy-stack.sh refuses the tunnel profile until the origin gate and the token are set.
// Text checks with node:fs only (no YAML dependency).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entryMap, parseEnvText } from '../../scripts/deploy/env-parse.mjs';
import { effectiveProfiles } from '../../scripts/deploy/preflight-rules.mjs';
import { DEPLOY_CODES, POSTDEPLOY_CODES } from '../../scripts/deploy/postdeploy-probe.mjs';
import { buildFiles } from './helpers/preflightFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STACK = path.join(ROOT, 'deploy/risepath-vm');
const read = (file) => fs.readFileSync(file, 'utf8');
const lines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

// Comment lines dropped, so the checks see only YAML that compose reads.
const compose = read(path.join(STACK, 'docker-compose.yml'))
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** Top-level `services:` entries → { name: block text }, split on two-space service keys. */
function serviceBlocks(text) {
  const body = text.split(/^services:\s*$/m)[1].split(/^\S/m)[0];
  const blocks = {};
  let current = null;
  for (const line of body.split('\n')) {
    const key = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      blocks[current] = '';
    } else if (current) {
      blocks[current] += `${line}\n`;
    }
  }
  return blocks;
}

/** Items of a `<key>:` list in a service block, e.g. networks or profiles. */
function listUnder(block, key) {
  const match = new RegExp(`^ {4}${key}:\\s*\\n((?: {6}- .*\\n)+)`, 'm').exec(block);
  return match ? match[1].split('\n').filter(Boolean).map((line) => line.replace(/^ {6}- /, '').trim()) : null;
}

const services = serviceBlocks(compose);

/**
 * deploy-stack.sh's ENV_KEY and ENV_EQ lines (set once, above every env-file guard), so a guard
 * block can run on its own under `set -euo pipefail`.
 * @param {string} script
 */
function envPatterns(script) {
  const key = /^ENV_KEY=.*$/m.exec(script);
  const eq = /^ENV_EQ=.*$/m.exec(script);
  assert.ok(key && eq, 'ENV_KEY and ENV_EQ at the top level of deploy-stack.sh');
  return `${key[0]}\n${eq[0]}`;
}

describe('docker-compose.yml: cloudflared', () => {
  const block = services.cloudflared || '';

  it('exists, pinned by version tag and digest', () => {
    assert.ok(block, 'cloudflared service');
    assert.match(block, /^ {4}image: cloudflare\/cloudflared:\d{4}\.\d{1,2}\.\d+@sha256:[a-f0-9]{64}\s*$/m);
  });

  it('starts only with the tunnel profile', () => {
    assert.deepEqual(listUnder(block, 'profiles'), ['tunnel']);
  });

  it('reads tunnel.env only and holds no stack values', () => {
    assert.match(block, /^ {4}env_file:\s*\n {6}- path: tunnel\.env\s*\n {8}required: false\s*$/m);
    assert.ok(!block.includes('stack.env'), 'no stack.env');
    assert.ok(!/^ {4}environment:/m.test(block), 'no environment block');
    assert.ok(!block.includes('${'), 'no variable interpolation');
  });

  it('publishes no ports and joins only the edge network', () => {
    assert.ok(!/^ {4}ports:/m.test(block), 'no ports');
    assert.deepEqual(listUnder(block, 'networks'), ['edge']);
  });

  it('has a healthcheck that runs `cloudflared tunnel ... ready` (distroless: no shell)', () => {
    const test = /^ {6}test: (\[.*\])\s*$/m.exec(block);
    assert.ok(test, 'healthcheck test');
    const argv = JSON.parse(test[1]);
    assert.equal(argv[0], 'CMD');
    assert.ok(argv.indexOf('tunnel') > 0 && argv.indexOf('ready') > argv.indexOf('tunnel'), argv.join(' '));
  });
});

describe('docker-compose.yml: edge network', () => {
  it('api joins default and edge', () => {
    assert.deepEqual(listUnder(services.api || '', 'networks'), ['default', 'edge']);
  });

  it('no other service joins edge (mcp-public, profile byoa, is the only addition)', () => {
    for (const [name, block] of Object.entries(services)) {
      if (name === 'api' || name === 'cloudflared' || name === 'mcp-public') continue;
      assert.ok(!(listUnder(block, 'networks') || []).includes('edge'), name);
    }
  });

  it('is declared at the top level', () => {
    assert.match(compose, /^networks:\s*\n {2}edge:/m);
  });
});

// Phase 1 (doc/guides/byoa-setup.ja.md): the public remote MCP for adults' own agents. It faces
// the internet, so it holds nothing it does not need: its own env file with a least-privilege DB
// role, no stack.env, no bridge token, no service-role or model keys, and no host port.
const SECRET_NAMES = [
  'RISE_PATH_BRIDGE_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_ALLOWED',
  'OPENROUTER_API_KEY',
  'HERMES_API_KEY',
  'MEMANTO',
  'ORIGIN_SECRET',
  'POSTGRES_PASSWORD',
  'PHASE1_USER_ID',
  'RISE_PATH_ACTIVE_SESSION_KEY',
  'AI_ACCESS_DEV_AUDIENCE',
];

describe('docker-compose.yml: mcp-public (profile byoa)', () => {
  const block = services['mcp-public'] || '';

  it('exists and starts only with the byoa profile', () => {
    assert.ok(block, 'mcp-public service');
    assert.deepEqual(listUnder(block, 'profiles'), ['byoa']);
  });

  it('runs the mcp image with --http (the remote entry), not the SSE command', () => {
    assert.match(block, /^ {6}dockerfile: deploy\/risepath-vm\/Dockerfile\s*$/m);
    assert.match(block, /^ {6}target: mcp\s*$/m);
    assert.match(block, /^ {4}command: \["node", "mcp-server\/index\.js", "--http"\]\s*$/m);
    assert.ok(!block.includes('--sse'));
  });

  it('reads its own env file, never stack.env', () => {
    assert.match(block, /^ {4}env_file:\s*\n {6}- path: mcp-public\.env\s*\n {8}required: false\s*$/m);
    assert.ok(!block.includes('stack.env'), 'no stack.env');
    assert.ok(!block.includes('${'), 'no interpolation from stack.env values');
  });

  it('fixes production and the learner-remote profile (not admin)', () => {
    assert.match(block, /^ {6}NODE_ENV: production\s*$/m);
    assert.match(block, /^ {6}RISE_PATH_MCP_PROFILE: learner-remote\s*$/m);
    assert.match(block, /^ {6}MCP_HTTP_PORT: "3200"\s*$/m);
    assert.ok(!/\badmin\b/.test(block), 'no admin profile');
  });

  it('holds no bridge token, service-role key, model, Hermes or Memanto settings', () => {
    for (const name of SECRET_NAMES) assert.ok(!block.includes(name), name);
  });

  it('publishes no host port and joins default and edge (the tunnel reaches it by name)', () => {
    assert.ok(!/^ {4}ports:/m.test(block), 'no ports');
    assert.deepEqual(listUnder(block, 'networks'), ['default', 'edge']);
  });

  it('runs as the node user, read-only, with no capabilities', () => {
    assert.match(block, /^ {4}user: node\s*$/m);
    assert.match(block, /^ {4}read_only: true\s*$/m);
    assert.deepEqual(listUnder(block, 'cap_drop'), ['ALL']);
    assert.deepEqual(listUnder(block, 'security_opt'), ['no-new-privileges:true']);
  });

  it('has a healthcheck on 127.0.0.1:3200/health (served before the Host check)', () => {
    const test = /^ {6}test: (\[.*\])\s*$/m.exec(block)
      || /^ {6}test:\s*\n((?: {8}.*\n)+)/m.exec(block);
    assert.ok(test, 'healthcheck test');
    assert.ok(block.includes("fetch('http://127.0.0.1:3200/health')"));
  });

  it('the admin mcp service keeps no edge network and no learner-remote profile', () => {
    const mcp = services.mcp || '';
    assert.ok(!(listUnder(mcp, 'networks') || []).includes('edge'));
    assert.ok(!mcp.includes('learner-remote'));
    assert.ok(!mcp.includes('--http'));
  });
});

describe('mcp-public.env.example', () => {
  const values = lines(read(path.join(STACK, 'mcp-public.env.example'))).filter((line) => !line.startsWith('#'));
  const keys = values.map((line) => line.split('=')[0]);

  it('sets exactly the variables the remote endpoint needs', () => {
    assert.deepEqual([...keys].sort(), [
      'APP_PUBLIC_URL',
      'DATABASE_URL_PHASE1',
      'MCP_ALLOWED_ORIGINS',
      'MCP_PUBLIC_RESOURCE_URL',
      'NODE_ENV',
      'RISE_PATH_MCP_PROFILE',
      'SUPABASE_ANON_KEY',
      'SUPABASE_URL',
    ]);
    assert.ok(values.includes('NODE_ENV=production'));
    assert.ok(values.includes('RISE_PATH_MCP_PROFILE=learner-remote'));
  });

  it('leaves the optional APP_PUBLIC_URL empty (a placeholder would reach every refusal)', () => {
    assert.ok(values.includes('APP_PUBLIC_URL='));
  });

  it('uses the least-privilege role, not the superuser risepath_app', () => {
    const url = values.find((line) => line.startsWith('DATABASE_URL_PHASE1='));
    assert.match(url, /^DATABASE_URL_PHASE1=postgresql:\/\/risepath_mcp_remote:/);
    assert.ok(!url.includes('risepath_app'));
  });

  it('has a canonical https resource URL with a path and no trailing slash', () => {
    const value = values.find((line) => line.startsWith('MCP_PUBLIC_RESOURCE_URL=')).split('=')[1];
    const url = new URL(value);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.pathname, '/mcp');
    assert.equal(url.href, value);
  });

  it('sets no secret beyond its own (even commented-out assignments)', () => {
    const text = read(path.join(STACK, 'mcp-public.env.example'));
    for (const name of SECRET_NAMES) {
      assert.ok(!new RegExp(`^#?\\s*${name}\\w*=`, 'm').test(text), name);
    }
  });

  it('mcp-public.env stays out of git and the build context', () => {
    assert.ok(lines(read(path.join(STACK, '.gitignore'))).includes('mcp-public.env'));
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/*.env'));
  });
});

describe('sql/mcp_remote_role.sql: least-privilege role for mcp-public', () => {
  const sql = read(path.join(STACK, 'sql/mcp_remote_role.sql'));
  const code = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
  /** Whole-table grants: the learner-remote tools' own tables, the caps and the auth stub. */
  const TABLE_GRANTS = new Map([
    ['auth.users', ['SELECT', 'INSERT']],
    ['ai_daily_usage', ['SELECT', 'INSERT', 'UPDATE']],
    ['user_progress', ['SELECT', 'INSERT', 'UPDATE']],
    ['lesson_progress', ['SELECT', 'INSERT', 'UPDATE']],
    ['learning_journal', ['SELECT', 'INSERT']],
    ['mcp_tool_calls', ['INSERT']],
  ]);
  /** Every other table is reachable through these column grants only, exactly. */
  const COLUMN_GRANTS = [
    'GRANT SELECT (user_id, client_id, revoked_at, first_seen_at, last_used_at) ON mcp_oauth_grants TO risepath_mcp_remote;',
    'GRANT INSERT (user_id, client_id), UPDATE (first_seen_at, last_used_at) ON mcp_oauth_grants TO risepath_mcp_remote;',
    'GRANT SELECT (user_id, birth_ym, declared_by) ON user_age TO risepath_mcp_remote;',
    'GRANT SELECT (user_id, kind, policy_version, given_at, method, relationship, revoked_at) ON account_consents TO risepath_mcp_remote;',
    'GRANT SELECT (user_id, deleted_at, reopened_at) ON account_deletions TO risepath_mcp_remote;',
    // Phase 8: the terms check (LEGAL_TERMS_REQUIRED, tools/core/legalAcceptance.js), never id.
    'GRANT SELECT (user_id, terms_version, privacy_version, accepted_at, account_deleted_at) ON legal_acceptances TO risepath_mcp_remote;',
    'GRANT SELECT (user_id, kind, category, created_at) ON ai_safety_events TO risepath_mcp_remote;',
    'GRANT SELECT (user_id, role) ON user_profiles TO risepath_mcp_remote;',
    // Phase 6: the review tools (course-review-due, course-review-grade), design §2.3.
    'GRANT SELECT (user_id, course_slug, lesson_id, card_id, learned_at, checked_at, due_day, stability, difficulty, reps, lapses, last_review_day) ON review_cards TO risepath_mcp_remote;',
    'GRANT INSERT (user_id, course_slug, lesson_id, card_id, learned_at, checked_at, prior_rating, stability, difficulty, due_day), UPDATE (learned_at, checked_at, prior_rating, due_day, stability, difficulty, reps, lapses, last_rating, last_review_day) ON review_cards TO risepath_mcp_remote;',
    'GRANT INSERT (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) ON review_log TO risepath_mcp_remote;',
    'GRANT SELECT (id, user_id, title) ON curricula TO risepath_mcp_remote;',
    'GRANT SELECT (id, user_id, status) ON materials TO risepath_mcp_remote;',
    'GRANT SELECT (material_id, chunk_index, content, embedding, embedding_model, created_at) ON material_chunks TO risepath_mcp_remote;',
  ];

  it('takes the password from a psql variable and stops without one', () => {
    assert.match(code, /PASSWORD :'mcp_password'/);
    assert.match(code, /\\if :\{\?mcp_password\}/);
    assert.match(code, /RAISE EXCEPTION/);
    assert.ok(!/PASSWORD '[^']*'/.test(code), 'no literal password');
  });

  it('creates a plain login role (no superuser, createdb, createrole, replication or bypassrls)', () => {
    assert.match(code, /ALTER ROLE risepath_mcp_remote WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT\s+NOREPLICATION NOBYPASSRLS/);
  });

  it('grants whole tables only from the allowed list, and never DELETE, TRUNCATE or ALL', () => {
    const grants = [...code.matchAll(/^GRANT ([A-Z, ]+) ON (?!SCHEMA|DATABASE)([a-z_., ]+) TO risepath_mcp_remote;$/gm)];
    const seen = new Set();
    for (const [, privileges, tables] of grants) {
      for (const table of tables.split(',').map((t) => t.trim())) {
        assert.ok(TABLE_GRANTS.has(table), `unexpected whole-table grant on ${table}`);
        for (const privilege of privileges.split(',').map((p) => p.trim())) {
          assert.ok(TABLE_GRANTS.get(table).includes(privilege), `${privilege} on ${table}`);
        }
        seen.add(table);
      }
    }
    assert.deepEqual([...seen].sort(), [...TABLE_GRANTS.keys()].sort());
    for (const line of code.split('\n').filter((l) => /^\s*GRANT\b/.test(l))) {
      assert.ok(!/\b(DELETE|TRUNCATE|ALL|REFERENCES|TRIGGER)\b/.test(line), line);
    }
  });

  it('Phase 5: the lesson generations, the XP ledger and learning days are never granted (AI apps see none of them)', () => {
    for (const table of ['lesson_progress_lesson_resets', 'xp_awards', 'learning_days']) {
      assert.ok(!new RegExp(`\\b${table}\\b`).test(code), `${table} in a statement`);
    }
    // The comment says why such state gets its own table: a column on a table granted whole is reachable at once.
    assert.match(sql, /a column added to a table granted whole \(auth\.users,\s+--\s+ai_daily_usage, user_progress, lesson_progress, learning_journal, mcp_tool_calls\) is reachable at\s+--\s+once/);
    assert.doesNotMatch(sql, /so a table or column\s+--\s+added later is not reachable/);
  });

  it('column grants only for the rest: no report text, guardian details, material titles, profile or course content', () => {
    const columnGrants = code.split('\n').filter((l) => /^GRANT\b.*\(/.test(l));
    assert.deepEqual(columnGrants, COLUMN_GRANTS);
    const tables = COLUMN_GRANTS.map((line) => / ON ([a-z_]+) TO /.exec(line)?.[1]);
    for (const table of tables) {
      assert.ok(!new RegExp(`^GRANT [A-Z, ]+ ON [a-z_., ]*\\b${table}\\b`, 'm').test(code), `no whole-table grant on ${table}`);
    }
    const columns = (table) => COLUMN_GRANTS.filter((line) => line.includes(` ON ${table} `)).join(' ');
    assert.ok(!/\bdetail\b/.test(columns('ai_safety_events')), 'ai_safety_events.detail (report text) stays admin-only');
    assert.ok(!/\b(title|storage_path)\b/.test(columns('materials')), 'no material title or storage path');
    assert.ok(!/\b(client_name)\b/.test(columns('mcp_oauth_grants')), 'no client_name');
    assert.ok(!/UPDATE \([^)]*revoked_at/.test(columns('mcp_oauth_grants')), 'never writes revoked_at');
  });

  it('ai_daily_usage: row level security limits the role to the remote kinds, idempotently', () => {
    assert.match(code, /^ALTER TABLE ai_daily_usage ENABLE ROW LEVEL SECURITY;$/m);
    assert.ok(!/FORCE ROW LEVEL SECURITY/.test(code), 'the table owner (risepath_app) keeps bypassing RLS');
    const policies = [...code.matchAll(/^CREATE POLICY (\w+) ON ai_daily_usage FOR (SELECT|INSERT|UPDATE) TO risepath_mcp_remote\n\s+(.+);$/gm)];
    assert.deepEqual(policies.map((m) => m[2]).sort(), ['INSERT', 'SELECT', 'UPDATE']);
    for (const [, name, command, clauses] of policies) {
      assert.match(code, new RegExp(`^DROP POLICY IF EXISTS ${name} ON ai_daily_usage;$`, 'm'), `re-run drops ${name} first`);
      const expected = { SELECT: ['USING'], INSERT: ['WITH CHECK'], UPDATE: ['USING', 'WITH CHECK'] }[command];
      for (const clause of expected) {
        assert.ok(clauses.includes(`${clause} (kind IN ('mcp', 'mcp_write'))`), `${command} ${clause}`);
      }
    }
    assert.equal((code.match(/CREATE POLICY/g) || []).length, 3, 'no other policy');
    assert.match(sql, /owner[^\n]*bypasses RLS/, 'the header says the owner bypasses RLS');
  });

  it('lesson progress: the course tools read and write lesson_progress, never the reset epochs', () => {
    assert.match(code, /^GRANT SELECT, INSERT, UPDATE ON lesson_progress TO risepath_mcp_remote;$/m);
    assert.ok(!/lesson_progress_resets/.test(code), 'the delete control\'s epochs stay app-only');
    assert.match(sql, /lesson_progress\s+the course-\* tools/, 'the header maps the grant to its tools');
  });

  it('Phase 6: the review tables by column only; never DELETE, never the log\'s rows, the entry time, the lesson mark or the last result', () => {
    const on = (table) => code.split('\n').filter((l) => /^\s*GRANT\b/.test(l) && new RegExp(` ON ${table} TO `).test(l));
    const cards = on('review_cards');
    const log = on('review_log');
    assert.equal(cards.length, 2);
    assert.equal(log.length, 1);
    for (const line of [...cards, ...log]) {
      assert.match(line, /^GRANT (SELECT|INSERT|UPDATE) \(/, `column grants only: ${line}`);
      assert.doesNotMatch(line, /\b(DELETE|TRUNCATE|ALL)\b/, line);
    }
    /** Columns a privilege names on a table (every grant line of that table). */
    const columns = (lines, privilege) => lines.flatMap((l) => [...l.matchAll(new RegExp(`\\b${privilege} \\(([^)]*)\\)`, 'g'))])
      .flatMap((m) => m[1].split(',').map((c) => c.trim()));
    assert.deepEqual(columns(log, 'SELECT'), [], 'the review history is never read by an AI app');
    assert.deepEqual(columns(log, 'UPDATE'), []);
    for (const column of ['review_day', 'reviewed_at']) assert.ok(!columns(log, 'INSERT').includes(column), `${column}: the database stamps it`);
    for (const c of ['prior_rating', 'last_rating']) assert.ok(!columns(cards, 'SELECT').includes(c), `${c} is written, never read back`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) assert.ok(!columns(cards, privilege).includes('entered_at'), `entered_at ${privilege}`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) assert.ok(columns(cards, privilege).includes('checked_at'), `checked_at ${privilege}: the entry reads, sets and moves it`);
    // SELECT … FOR UPDATE needs UPDATE on a column. The grade writes the memory columns; the entry's
    // ON CONFLICT DO UPDATE sets a card's first rating again (learned_at, prior_rating, memory, due_day)
    // and its next statement moves checked_at.
    assert.deepEqual(columns(cards, 'UPDATE').sort(), ['checked_at', 'difficulty', 'due_day', 'lapses', 'last_rating', 'last_review_day', 'learned_at', 'prior_rating', 'reps', 'stability']);
    for (const table of ['learning_days', 'xp_awards', 'lesson_progress_lesson_resets']) {
      assert.ok(!new RegExp(`\\b${table}\\b`).test(code), `${table} still never granted`);
    }
    assert.match(sql, /review_cards\s+course-review-due and course-review-grade/, 'the header maps review_cards to its tools');
    assert.match(sql, /review_log\s+course-review-grade appends one review/, 'the header maps review_log to its tool');
    assert.match(sql, /progress_changed_at \(Phase 6\) is kept by a trigger; a value this role sends\s+--\s+is ignored/);
    assert.match(sql, /020 review_cards and review_log\)/, 'run after migration 020');
  });

  it('starts from a clean slate on every run (revokes before it grants)', () => {
    const revoke = code.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM risepath_mcp_remote');
    assert.ok(revoke > 0 && revoke < code.indexOf('GRANT SELECT'));
  });
});

describe('deploy/supabase/custom_access_token_hook.sql', () => {
  const sql = read(path.join(ROOT, 'deploy/supabase/custom_access_token_hook.sql'));
  const code = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');

  it('changes aud only for OAuth client tokens and keeps the other claims', () => {
    assert.match(code, /claims->>'client_id'/);
    assert.match(code, /jsonb_set\(claims, '\{aud\}', to_jsonb\(mcp_resource\)\)/);
    assert.match(code, /return jsonb_set\(event, '\{claims\}', claims\);/);
    assert.match(code, /return event;/);
    assert.ok(!/jsonb_build_object\('claims'/.test(code), 'never a reduced claim set');
    assert.ok(!/authentication_method/.test(code), 'keys on client_id, not the method (refresh)');
  });

  it('uses a canonical MCP URL placeholder (https, /mcp, no trailing slash)', () => {
    const value = /mcp_resource constant text := '([^']+)'/.exec(code)?.[1];
    assert.ok(value, 'mcp_resource constant');
    assert.equal(new URL(value).href, value);
    assert.equal(new URL(value).pathname, '/mcp');
  });

  it('is not security definer, runs for supabase_auth_admin only', () => {
    assert.ok(!/security definer/i.test(code));
    assert.match(code, /grant execute on function public\.risepath_mcp_access_token_hook\(jsonb\) to supabase_auth_admin;/);
    assert.match(code, /revoke execute on function public\.risepath_mcp_access_token_hook\(jsonb\) from authenticated, anon, public;/);
  });
});

describe('VM secrets stay out of git and the build context', () => {
  it('deploy/risepath-vm/.gitignore lists stack.env and tunnel.env', () => {
    const ignored = lines(read(path.join(STACK, '.gitignore')));
    assert.ok(ignored.includes('stack.env'));
    assert.ok(ignored.includes('tunnel.env'));
  });

  it('tunnel.env.example holds only an empty TUNNEL_TOKEN=', () => {
    const values = lines(read(path.join(STACK, 'tunnel.env.example'))).filter((line) => !line.startsWith('#'));
    assert.deepEqual(values, ['TUNNEL_TOKEN=']);
  });

  it('.dockerignore lists deploy/risepath-vm/*.env', () => {
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/*.env'));
  });

  it('stack.env.example leaves the public edge off (empty secret, no tunnel profile)', () => {
    const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
    assert.ok(values.includes('ORIGIN_SECRET='));
    assert.ok(values.includes('LLM_ALLOWED_ORIGINS='));
    assert.ok(!values.some((line) => line.startsWith('RISE_PATH_PUBLIC_URL=')));
  });
});

// Phase 0 AI access (doc/brushup-2026/ai-access-plan.ja.md): the shared Hermes agent is not offered
// to learners, and Gemini stays off unless GEMINI_ALLOWED is exactly "true" (under-18 clause).
describe('stack.env.example: Phase 0 defaults', () => {
  const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
  const profiles = values.filter((line) => line.startsWith('COMPOSE_PROFILES='));

  it('sets COMPOSE_PROFILES=tts once: kokoro-tts without Hermes (no full)', () => {
    assert.deepEqual(profiles, ['COMPOSE_PROFILES=tts']);
  });

  it('leaves GEMINI_ALLOWED unset and GEMINI_API_KEY empty', () => {
    assert.ok(!values.some((line) => line.startsWith('GEMINI_ALLOWED=')), 'GEMINI_ALLOWED stays commented out');
    assert.ok(values.includes('GEMINI_API_KEY='));
  });

  it('does not set VITE_FEATURE_AGENT_CHAT', () => {
    assert.ok(!values.some((line) => line.startsWith('VITE_FEATURE_AGENT_CHAT=')));
  });

  it('the default profile starts no hermes service in docker-compose.yml', () => {
    assert.deepEqual(listUnder(services.hermes || '', 'profiles'), ['full']);
    const kokoro = listUnder(services['kokoro-tts'] || '', 'profiles') || [];
    assert.ok(kokoro.includes('tts'), 'kokoro-tts runs with tts');
  });

  it('passes GEMINI_ALLOWED to the api service next to GEMINI_API_KEY', () => {
    assert.match(services.api || '', /^ {6}GEMINI_ALLOWED: \$\{GEMINI_ALLOWED:-\}\s*$/m);
  });
});

// Phase 0.5 minor safeguards (doc/guides/safety-operations.ja.md): the learner-facing stack keeps
// guest AI off and never sets the development audience; the api receives all four settings.
describe('stack.env.example and docker-compose.yml: Phase 0.5 minor safeguards', () => {
  const values = lines(read(path.join(STACK, 'stack.env.example'))).filter((line) => !line.startsWith('#'));
  const SAFETY_VARS = ['LLM_GUEST_AI', 'SAFETY_BLOCKS_BEFORE_PAUSE', 'SAFETY_ALERT_WEBHOOK_URL', 'AI_ACCESS_DEV_AUDIENCE'];

  it('does not turn on guest AI or the development audience', () => {
    assert.ok(!values.some((line) => /^LLM_GUEST_AI=\s*true\s*$/i.test(line)), 'LLM_GUEST_AI is not true');
    assert.ok(!values.some((line) => line.startsWith('AI_ACCESS_DEV_AUDIENCE=')), 'AI_ACCESS_DEV_AUDIENCE stays unset');
  });

  it('passes each safety setting to the api service with an empty default', () => {
    for (const name of SAFETY_VARS) {
      assert.match(services.api || '', new RegExp(`^ {6}${name}: \\$\\{${name}:-\\}\\s*$`, 'm'), name);
    }
  });

  it('gives no other service the safety settings', () => {
    for (const [name, block] of Object.entries(services)) {
      if (name === 'api') continue;
      for (const variable of SAFETY_VARS) assert.ok(!block.includes(variable), `${name} has ${variable}`);
    }
  });
});

describe('deploy-stack.sh', () => {
  const script = read(path.join(STACK, 'scripts/deploy-stack.sh'));
  const guardAt = script.indexOf('== *",tunnel,"*');

  it('has the tunnel guard before the first compose call', () => {
    assert.ok(guardAt > script.indexOf('export COMPOSE_PROFILES'), 'after COMPOSE_PROFILES is final');
    const firstCompose = script.search(/^\s*compose \w/m);
    assert.ok(firstCompose > guardAt, 'before the first compose call');
    const guard = script.slice(guardAt, firstCompose);
    assert.ok(guard.includes("grep -Eq '^TUNNEL_TOKEN=.+' tunnel.env"));
    assert.match(guard, /#ORIGIN_SECRET_VALUE\} -lt 32/);
    assert.ok(guard.includes('change-me'));
    assert.ok(guard.includes('-z "${LLM_ALLOWED_ORIGINS:-}"'));
    assert.ok(guard.includes('-n "${RISE_PATH_PUBLIC_URL:-}"'));
    assert.ok(guard.includes('exit 1'));
  });

  it('refuses byoa without the tunnel, without mcp-public.env, or with stack.env secrets in it', () => {
    const at = script.indexOf('== *",byoa,"*');
    const firstCompose = script.search(/^\s*compose \w/m);
    assert.ok(at > guardAt && at < firstCompose, 'after the tunnel guard, before the first compose call');
    const guard = script.slice(at, script.indexOf('PLACEHOLDERS=()'));
    assert.ok(guard.includes('!= *",tunnel,"*'), 'needs the tunnel profile');
    assert.ok(guard.includes('! -f mcp-public.env'));
    for (const name of ['DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'MCP_PUBLIC_RESOURCE_URL']) {
      assert.match(guard, new RegExp(`for name in [A-Z0-9_ ]*\\b${name}\\b[A-Z0-9_ ]*; do\\n\\s*if ! grep`), `required ${name}`);
    }
    for (const name of ['RISE_PATH_BRIDGE_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'MEMANTO_', 'ORIGIN_SECRET', 'RISE_PATH_ACTIVE_SESSION_KEY']) {
      assert.ok(guard.includes(` ${name}`), `forbidden ${name}`);
    }
    assert.ok(guard.includes('risepath_app[:@]'), 'refuses the superuser role');
    assert.ok(guard.includes('grep -Eiq "${ENV_KEY}APP_PUBLIC_URL${ENV_EQ}.*(change-me|your-project|your-domain)" mcp-public.env'), 'refuses a template APP_PUBLIC_URL');
    assert.ok(guard.includes('exit 1'));
    for (const line of guard.split('\n').filter((l) => /^\s*(echo|printf)\b/.test(l))) {
      assert.ok(!line.includes('${value') && !line.includes('${!'), `prints no value: ${line.trim()}`);
    }
  });

  // The guard itself, run by bash on sample env files: Docker Compose reads `export NAME=…`,
  // spaces around '=' and quoted values, so none of them may slip past it (or be reported missing).
  describe('byoa guard on dotenv variants', () => {
    const start = script.indexOf('if [[ ",${COMPOSE_PROFILES// /}," == *",byoa,"* ]]; then');
    // ENV_KEY and ENV_EQ are set once above every guard (hoisted: the billing guard runs without byoa).
    const block = `${envPatterns(script)}\n${script.slice(start, script.indexOf('\nfi\n', start) + 4)}`;
    const VALID = [
      'DATABASE_URL_PHASE1=postgresql://risepath_mcp_remote:0123456789abcdef0123456789abcdef@db:5432/risepath',
      'SUPABASE_URL=https://abcdefghijklmnop.supabase.co',
      'SUPABASE_ANON_KEY=sb_publishable_test',
      'MCP_PUBLIC_RESOURCE_URL=https://mcp.example.org/mcp',
      'APP_PUBLIC_URL=',
      '# SUPABASE_SERVICE_ROLE_KEY= lives in stack.env only',
    ];
    const SECRET = 'do-not-print-0123456789';
    const runGuard = (envLines) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byoa-guard-'));
      try {
        fs.writeFileSync(path.join(dir, 'mcp-public.env'), `${envLines.join('\n')}\n`);
        const result = spawnSync('bash', ['-c', `set -euo pipefail\n${block}`], {
          cwd: dir,
          env: { PATH: process.env.PATH, COMPOSE_PROFILES: 'tts,tunnel,byoa' },
          encoding: 'utf8',
        });
        return { status: result.status, out: `${result.stdout}${result.stderr}` };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
    const replace = (name, line) => VALID.map((l) => (l.startsWith(`${name}=`) ? line : l));

    it('extracts the whole guard', () => {
      assert.ok(start > 0 && block.endsWith('\nfi\n') && block.includes('BYOA_PROBLEMS'));
      assert.ok(!script.slice(start, script.indexOf('\nfi\n', start)).includes("ENV_KEY='"), 'ENV_KEY is not (re)defined inside the byoa block');
    });

    it('passes a valid file, also written with export, spaces around = and quotes', () => {
      assert.equal(runGuard(VALID).status, 0, runGuard(VALID).out);
      const styled = [
        'export DATABASE_URL_PHASE1="postgresql://risepath_mcp_remote:0123456789abcdef0123456789abcdef@db:5432/risepath"',
        "SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'",
        '  SUPABASE_ANON_KEY= "sb_publishable_test"',
        'export MCP_PUBLIC_RESOURCE_URL =https://mcp.example.org/mcp',
      ];
      const result = runGuard(styled);
      assert.equal(result.status, 0, result.out);
    });

    for (const line of [
      'DATABASE_URL_PHASE1="postgresql://risepath_app:SECRET@db:5432/risepath"',
      "DATABASE_URL_PHASE1='postgres://risepath_app@db:5432/risepath'",
      'export DATABASE_URL_PHASE1 = postgresql://risepath_app:SECRET@db:5432/risepath',
      '  DATABASE_URL_PHASE1= "postgresql://risepath_app:SECRET@db/risepath"',
      'DATABASE_URL_PHASE1: postgresql://risepath_app:SECRET@db:5432/risepath',
    ]) {
      it(`refuses the superuser role: ${line.replace(/SECRET/g, '…')}`, () => {
        const result = runGuard(replace('DATABASE_URL_PHASE1', line.replace(/SECRET/g, SECRET)));
        assert.equal(result.status, 1, result.out);
        assert.match(result.out, /DATABASE_URL_PHASE1 \(mcp-public\.env: use risepath_mcp_remote/);
        assert.ok(!result.out.includes(SECRET), 'prints no value');
      });
    }

    for (const line of [
      'SUPABASE_SERVICE_ROLE_KEY = SECRET',
      'SUPABASE_SERVICE_ROLE_KEY="SECRET"',
      'export RISE_PATH_BRIDGE_TOKEN="SECRET"',
      '  GEMINI_API_KEY =SECRET',
      "export\tPOSTGRES_PASSWORD\t=\t'SECRET'",
      'ANTHROPIC_API_KEY=',
      // Compose also reads `NAME: value`, and a bare name copies the value from the environment.
      'ANTHROPIC_API_KEY: SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'export RISE_PATH_BRIDGE_TOKEN',
      'TUNNEL_TOKEN\r',
    ]) {
      it(`refuses a stack.env secret: ${JSON.stringify(line.replace(/SECRET/g, '…'))}`, () => {
        const result = runGuard([...VALID, line.replace(/SECRET/g, SECRET)]);
        assert.equal(result.status, 1, result.out);
        assert.match(result.out, /must not be there; it belongs to stack\.env only/);
        assert.ok(!result.out.includes(SECRET), 'prints no value');
      });
    }

    for (const [name, line] of [
      ['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY=""'],
      ['SUPABASE_ANON_KEY', "SUPABASE_ANON_KEY = ''"],
      ['SUPABASE_URL', 'SUPABASE_URL = "https://your-project.supabase.co"'],
      ['MCP_PUBLIC_RESOURCE_URL', "export MCP_PUBLIC_RESOURCE_URL='https://mcp.your-domain.example/mcp'"],
      ['DATABASE_URL_PHASE1', 'DATABASE_URL_PHASE1 = "postgresql://risepath_mcp_remote:change-me@db:5432/risepath"'],
    ]) {
      it(`refuses an empty or template ${name}: ${line}`, () => {
        const result = runGuard(replace(name, line));
        assert.equal(result.status, 1, result.out);
        assert.ok(result.out.includes(`${name} (mcp-public.env: missing or a template value)`), result.out);
      });
    }

    it('refuses a quoted template APP_PUBLIC_URL', () => {
      const result = runGuard(replace('APP_PUBLIC_URL', 'export APP_PUBLIC_URL = "https://app.your-domain.example"'));
      assert.equal(result.status, 1, result.out);
      assert.match(result.out, /APP_PUBLIC_URL \(mcp-public\.env: a template value/);
    });
  });

  it('removes a hermes container left from an earlier full deploy before `up` when full is not listed', () => {
    const removeAt = script.indexOf('compose --profile full rm -sf hermes');
    assert.ok(removeAt > 0, 'rm -sf hermes');
    const guard = script.lastIndexOf('if [[', removeAt);
    assert.match(script.slice(guard, removeAt), /"\$\{HERMES_PROFILE\}" -eq 0 && -n "\$\(compose --profile full ps -aq hermes/);
    const upAt = script.search(/^compose up -d$/m);
    assert.ok(upAt > removeAt, 'before the full `compose up -d`');
  });

  it('runs the stack smoke inside the api container (loopback, past the origin gate)', () => {
    assert.match(script, /compose exec -T api env[\s\S]*node scripts\/smoke-vm-stack\.mjs --target container/);
    assert.ok(!script.includes('--target host'));
  });

  it('refuses template values before the first compose call, naming variables only', () => {
    const at = script.indexOf('PLACEHOLDERS=()');
    const firstCompose = script.search(/^\s*compose \w/m);
    assert.ok(at > guardAt, 'after the tunnel guard');
    assert.ok(firstCompose > at, 'before the first compose call');
    assert.ok(script.indexOf('init-hermes-profile.sh"') > at, 'before Hermes gets the keys');
    const guard = script.slice(at, firstCompose);
    const names = /for name in ([A-Z0-9_ ]+); do/.exec(guard);
    assert.ok(names, 'for name in … loop');
    for (const name of ['POSTGRES_PASSWORD', 'DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RISE_PATH_BRIDGE_TOKEN']) {
      assert.ok(names[1].split(' ').includes(name), name);
    }
    assert.ok(guard.includes('*change-me*') && guard.includes('*your-project*'));
    assert.match(guard, /HERMES_API_KEY[\s\S]*-lt 16/);
    assert.ok(guard.includes('exit 1'));
    for (const line of guard.split('\n').filter((l) => /^\s*(echo|printf)\b/.test(l))) {
      assert.ok(!line.includes('${value') && !line.includes('${!'), `prints no value: ${line.trim()}`);
    }
  });

  it('refuses profile full without an OpenRouter key, and checks HERMES_API_KEY whenever full is listed', () => {
    const at = script.indexOf('PLACEHOLDERS=()');
    const guard = script.slice(at, script.search(/^\s*compose \w/m));
    assert.ok(guard.includes('if [[ ",${COMPOSE_PROFILES// /}," == *",full,"* ]]; then\n  HERMES_PROFILE=1'), 'full as a list item');
    assert.match(guard, /if \[\[ "\$\{HERMES_PROFILE\}" -eq 1 && "\$\{HERMES_KEYED\}" -eq 0 \]\]; then\n\s*PLACEHOLDERS\+=\("OPENROUTER_API_KEY [^"\n]*COMPOSE_PROFILES=tts[^"\n]*"\)/);
    assert.match(guard, /if \[\[ "\$\{HERMES_PROFILE\}" -eq 1 \]\]; then\n\s*value="\$\{HERMES_API_KEY:-\}"/);
  });

  it('starts Hermes only when COMPOSE_PROFILES lists full (an OpenRouter key alone does not)', () => {
    assert.ok(!script.includes('${COMPOSE_PROFILES:-full}'), 'no implicit full default');
    assert.ok(!/COMPOSE_PROFILES=["']?full/.test(script), 'never assigns full');
  });

  it('refuses Memanto unless stack.env sets MEMANTO_ENABLED=true (the boot unit reads it)', () => {
    const check = script.indexOf('"${MEMANTO_ENABLED:-}" != "true"');
    assert.ok(check > 0 && check < script.indexOf('COMPOSE_FILES+=(-f docker-compose.memanto.yml)'));
    assert.ok(!script.includes('export MEMANTO_ENABLED=true'));
  });

  it('has no `compose volume` call (not a compose subcommand)', () => {
    assert.ok(!script.includes('compose volume'));
  });

  it('waits for exactly the services the smoke requires before the smoke', () => {
    for (const [flag, service] of [['memanto', 'memanto'], ['kokoro', 'kokoro-tts'], ['hermes', 'hermes']]) {
      assert.match(script, new RegExp(`SMOKE_FLAGS\\+=\\(--require-${flag}\\)\\n\\s*WAIT\\+=\\(${service}\\)`), service);
    }
    const wait = script.indexOf('compose up -d --wait "${WAIT[@]}"');
    assert.ok(wait > script.indexOf('init-memanto-ollama.sh'), 'after the Ollama pull');
    assert.ok(wait < script.indexOf('node scripts/smoke-vm-stack.mjs'), 'before the smoke');
    assert.ok(!/compose up -d --wait\s*$/m.test(script), 'no wait on every service');
    const byoaWait = script.search(/if \[\[ ",\$\{COMPOSE_PROFILES\/\/ \/\}," == \*",byoa,"\* \]\]; then\n\s*WAIT\+=\(mcp-public\)\n/);
    assert.ok(byoaWait > 0 && byoaWait < wait, 'with byoa, an mcp-public that never gets healthy fails the deploy');
    // Phase 9 (P5): cloudflared has a healthcheck; with tunnel listed, a tunnel that never connects fails the deploy.
    const tunnelWait = script.search(/if \[\[ ",\$\{COMPOSE_PROFILES\/\/ \/\}," == \*",tunnel,"\* \]\]; then\n\s*WAIT\+=\(cloudflared\)\n/);
    assert.ok(tunnelWait > 0 && tunnelWait < wait, 'with tunnel, cloudflared is waited for');
  });
});

describe('init-hermes-profile.sh', () => {
  const script = read(path.join(STACK, 'scripts/init-hermes-profile.sh'));

  it('writes API_SERVER_KEY from HERMES_API_KEY, the key the api sends', () => {
    assert.match(script, /^API_SERVER_KEY=\$\{HERMES_API_KEY:-\}$/m);
  });

  it('writes as root and hands every file to the hermes UID', () => {
    assert.match(script, /H_UID="\$\{HERMES_UID:-1000\}"/);
    assert.match(script, /sudo install -d -o "\$\{H_UID\}" -g "\$\{H_GID\}"/);
    assert.match(script, /sudo install -m 644 -o "\$\{H_UID\}" -g "\$\{H_GID\}"[^\n]*\n?[^\n]*config\.yaml/);
    for (const target of ['/profiles/default/.env', '/.env']) {
      assert.ok(script.includes(`sudo install -m 600 -o "\${H_UID}" -g "\${H_GID}" "\${tmp}" "\${DATA_DIR}${target}"`), target);
    }
    assert.ok(!/^\s*(cp|mkdir|chmod)\b/m.test(script), 'no plain cp, mkdir or chmod into hermes-data');
    assert.ok(!/>\s*"\$\{DATA_DIR\}/.test(script), 'no plain redirect into hermes-data');
  });
});

describe('bootstrap-vm.sh', () => {
  const script = read(path.join(STACK, 'scripts/bootstrap-vm.sh'));

  it('adds /swapfile once and never a second fstab line', () => {
    assert.match(script, /if swapon --show=NAME --noheadings \| grep -x \/swapfile/);
    assert.ok(script.includes('sudo fallocate -l 4G /swapfile'));
    assert.match(script, /if ! grep -q '\^\/swapfile ' \/etc\/fstab; then/);
  });

  it('stops before the systemd unit and deploy until the docker group is active', () => {
    const check = script.indexOf('docker info >/dev/null 2>&1');
    assert.ok(check > 0 && check < script.indexOf('systemctl enable'));
  });

  it('runs deploy-stack.sh from INSTALL_DIR, where the systemd unit points', () => {
    assert.ok(script.includes('bash "${STACK_DIR}/scripts/deploy-stack.sh"'));
  });

  it('installs and enables the boot unit only after deploy-stack.sh succeeds', () => {
    assert.match(script, /^set -euo pipefail$/m);
    const deploy = script.indexOf('bash "${STACK_DIR}/scripts/deploy-stack.sh"');
    assert.ok(deploy > 0, 'deploy-stack.sh call');
    for (const step of ['sudo cp "${STACK_DIR}/systemd/risepath-stack.service"', 'systemctl daemon-reload', 'systemctl enable']) {
      assert.ok(script.indexOf(step) > deploy, `${step} after the deploy`);
    }
  });
});

describe('provision-gce.sh', () => {
  const script = read(path.join(STACK, 'scripts/provision-gce.sh'));
  const steps = script.slice(script.indexOf('Next steps'));

  it('lists Tailscale before the clone and bootstrap, and creates /opt/risepath with sudo', () => {
    const tailscale = steps.indexOf('tailscale up --hostname=risepath-vm');
    const install = steps.indexOf('sudo install -d');
    const clone = steps.indexOf('git clone');
    assert.ok(tailscale > 0 && tailscale < install && install < clone, 'tailscale, sudo install -d, git clone');
    assert.ok(clone < steps.indexOf('./bootstrap-vm.sh'));
    assert.ok(steps.includes('"\\$(id -un)"'), 'escaped so it runs on the VM, not when the heredoc prints');
  });
});

describe('Dockerfile: api stage', () => {
  const dockerfile = read(path.join(STACK, 'Dockerfile'));
  const api = dockerfile.split(/^FROM /m).find((stage) => /^\S+ AS api\s*$/m.test(stage)) || '';

  it('exists and copies no front-end build (Vercel serves the front end)', () => {
    assert.ok(api, 'api stage');
    assert.ok(!api.includes('/app/dist'), 'no /app/dist');
    assert.ok(!api.includes('--from=builder'), 'nothing from the builder stage');
  });
});

// Phase 3 (the supporter plan): the Stripe keys and billing switches live in billing.env, which
// only the api reads; every env file compose loads stays out of git; deploy-stack.sh refuses
// billing names elsewhere, a live key without BILLING_LIVE=true, and BILLING_ENABLED=true without
// its keys, whatever COMPOSE_PROFILES lists (run here with byoa off).
describe('billing.env (Phase 3)', () => {
  const composeFiles = ['docker-compose.yml', 'docker-compose.memanto.yml'];

  it('only the api service reads billing.env (after stack.env, so its values win)', () => {
    assert.match(services.api || '', /^ {4}env_file:\s*\n {6}- path: stack\.env\s*\n {8}required: false\s*\n {6}- path: billing\.env\s*\n {8}required: false\s*$/m);
    for (const [name, block] of Object.entries(services)) {
      if (name !== 'api') assert.ok(!block.includes('billing.env'), name);
    }
    assert.ok(!read(path.join(STACK, 'docker-compose.memanto.yml')).includes('billing.env'));
  });

  it('every env file a compose file loads is git-ignored and out of the build context', () => {
    const ignored = lines(read(path.join(STACK, '.gitignore')));
    const paths = new Set();
    for (const file of composeFiles) {
      for (const m of read(path.join(STACK, file)).matchAll(/^\s*- path: (\S+)\s*$/gm)) paths.add(m[1]);
      for (const m of read(path.join(STACK, file)).matchAll(/^\s*env_file:\s*(?!\s*$)(\S+)\s*$/gm)) paths.add(m[1]);
    }
    assert.ok(paths.has('billing.env') && paths.has('stack.env'), [...paths].join(', '));
    for (const envFile of paths) {
      assert.ok(ignored.includes(envFile), `${envFile} in deploy/risepath-vm/.gitignore`);
      const check = spawnSync('git', ['check-ignore', '-q', path.join('deploy/risepath-vm', envFile)], { cwd: ROOT });
      assert.equal(check.status, 0, `git check-ignore ${envFile}`);
    }
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/*.env'));
  });

  it('billing.env.example lists exactly the names billingConfig reads, all empty', async () => {
    const { BILLING_ENV_KEYS } = await import('../services/billingConfig.js');
    const values = lines(read(path.join(STACK, 'billing.env.example'))).filter((line) => !line.startsWith('#'));
    assert.deepEqual(values, BILLING_ENV_KEYS.map((key) => `${key}=`));
  });

  it('stack.env.example and mcp-public.env.example set no STRIPE_ or BILLING_ name', () => {
    for (const file of ['stack.env.example', 'mcp-public.env.example']) {
      assert.ok(!/^\s*(export\s+)?(STRIPE|BILLING)_/m.test(read(path.join(STACK, file))), file);
    }
  });

  describe('deploy-stack.sh billing guard', () => {
    const script = read(path.join(STACK, 'scripts/deploy-stack.sh'));
    const start = script.indexOf('BILLING_PROBLEMS=()');
    const endMarker = 'echo "==> Billing sales:';
    const end = script.indexOf('\n', script.indexOf(endMarker));
    const guard = `${envPatterns(script)}\n${script.slice(start, end + 1)}`;
    const SECRET = 'do-not-print-0123456789';
    const TEST_ON = [
      'BILLING_ENABLED=true',
      'BILLING_TEST_USER_IDS=aaaaaaaa-1111-4000-8000-000000000001',
      'STRIPE_SECRET_KEY=rk_test_fake1',
      'STRIPE_WEBHOOK_SECRET=whsec_fake1',
      'STRIPE_PRICE_ID=price_fake1',
      'BILLING_RETURN_ORIGIN=https://app.example.org',
    ];
    /** @param {Record<string, string[]>} files */
    const runGuard = (files) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-guard-'));
      try {
        for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), `${content.join('\n')}\n`);
        const result = spawnSync('bash', ['-c', `set -euo pipefail\n${guard}`], {
          cwd: dir,
          env: { PATH: process.env.PATH, COMPOSE_PROFILES: 'tts' },
          encoding: 'utf8',
        });
        return { status: result.status, out: `${result.stdout}${result.stderr}` };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    it('sits at the top level, after ENV_KEY/ENV_EQ and before the first compose call', () => {
      const firstCompose = script.search(/^\s*compose \w/m);
      assert.ok(start > 0 && end > start && start < firstCompose);
      assert.ok(script.search(/^ENV_KEY=/m) < script.indexOf('== *",tunnel,"*'), 'ENV_KEY is set before the first guard');
      assert.ok(!/^\s+ENV_KEY=/m.test(script), 'not redefined inside a block');
      assert.ok(!/^\s*if \[\[[^\n]*byoa/m.test(script.slice(start, end)), 'not inside the byoa block');
      for (const line of script.slice(start, end).split('\n').filter((l) => /^\s*(echo|printf)\b/.test(l))) {
        assert.ok(!line.includes('${value') && !line.includes('${!'), `prints no value: ${line.trim()}`);
      }
    });

    it('passes without billing.env (sales off) and with a complete test-mode file', () => {
      const off = runGuard({ 'stack.env': ['POSTGRES_PASSWORD=x'] });
      assert.equal(off.status, 0, off.out);
      assert.match(off.out, /Billing sales: off/);
      const test = runGuard({ 'billing.env': TEST_ON });
      assert.equal(test.status, 0, test.out);
      assert.match(test.out, /Billing sales: test/);
      const styled = runGuard({ 'billing.env': TEST_ON.map((l, i) => (i % 2 ? `export ${l.replace('=', ' = "')}"` : l.replace('=', ': '))) });
      assert.equal(styled.status, 0, styled.out);
      const disabled = runGuard({ 'billing.env': ['BILLING_ENABLED=', 'STRIPE_SECRET_KEY='] });
      assert.equal(disabled.status, 0, disabled.out);
      assert.match(disabled.out, /Billing sales: off/);
    });

    for (const [file, line] of [
      ['stack.env', `STRIPE_SECRET_KEY=${SECRET}`],
      ['stack.env', `export STRIPE_WEBHOOK_SECRET = "${SECRET}"`],
      ['stack.env', 'BILLING_ENABLED=true'],
      ['mcp-public.env', `STRIPE_SECRET_KEY: ${SECRET}`],
      ['mcp-public.env', 'BILLING_TEST_USER_IDS'],
    ]) {
      it(`refuses billing names outside billing.env: ${file} ${line.replace(SECRET, '…')}`, () => {
        const result = runGuard({ [file]: [line] });
        assert.equal(result.status, 1, result.out);
        assert.ok(result.out.includes(`(${file}: must not be there; they belong to billing.env only)`), result.out);
        assert.ok(!result.out.includes(SECRET), 'prints no value');
      });
    }

    it('refuses a live key unless BILLING_LIVE=true, even with sales off', () => {
      for (const key of ['sk_live_fake1', 'rk_live_fake1', '"sk_live_fake1"']) {
        const result = runGuard({ 'billing.env': ['BILLING_ENABLED=', `STRIPE_SECRET_KEY=${key}`] });
        assert.equal(result.status, 1, result.out);
        assert.match(result.out, /BILLING_LIVE \(billing\.env: a live Stripe key needs BILLING_LIVE=true/);
        assert.ok(!result.out.includes('fake1'), 'prints no value');
      }
      const live = runGuard({
        'billing.env': [...TEST_ON.filter((l) => !l.startsWith('STRIPE_SECRET_KEY=') && !l.startsWith('BILLING_TEST_USER_IDS=')),
          'STRIPE_SECRET_KEY=rk_live_fake1', 'BILLING_LIVE=true', 'BILLING_TOS_URL=https://app.example.org/terms'],
      });
      assert.equal(live.status, 0, live.out);
      assert.match(live.out, /Billing sales: live/);
    });

    it('with BILLING_ENABLED=true, names each missing key (testers in test mode, the terms URL in live mode)', () => {
      for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'BILLING_RETURN_ORIGIN', 'BILLING_TEST_USER_IDS']) {
        const result = runGuard({ 'billing.env': TEST_ON.map((l) => (l.startsWith(`${name}=`) ? `${name}=` : l)) });
        assert.equal(result.status, 1, `${name}: ${result.out}`);
        assert.ok(result.out.includes(`${name} (billing.env: missing; BILLING_ENABLED=true needs it)`), result.out);
      }
      const live = runGuard({ 'billing.env': [...TEST_ON.filter((l) => !l.startsWith('STRIPE_SECRET_KEY=')), 'STRIPE_SECRET_KEY=sk_live_fake1', 'BILLING_LIVE=true'] });
      assert.equal(live.status, 1, live.out);
      assert.ok(live.out.includes('BILLING_TOS_URL (billing.env: missing'), live.out);
    });

    it('refuses a publishable key or a swapped webhook secret', () => {
      const pk = runGuard({ 'billing.env': TEST_ON.map((l) => (l.startsWith('STRIPE_SECRET_KEY=') ? 'STRIPE_SECRET_KEY=pk_test_fake1' : l)) });
      assert.equal(pk.status, 1, pk.out);
      assert.match(pk.out, /STRIPE_SECRET_KEY \(billing\.env: not a secret or restricted key/);
      const swapped = runGuard({ 'billing.env': TEST_ON.map((l) => (l.startsWith('STRIPE_WEBHOOK_SECRET=') ? 'STRIPE_WEBHOOK_SECRET=rk_test_fake1' : l)) });
      assert.equal(swapped.status, 1, swapped.out);
      assert.match(swapped.out, /STRIPE_WEBHOOK_SECRET \(billing\.env: not a webhook signing secret/);
    });
  });
});

// Phase 4 (owner decision D4; design §6.6–6.7): every container's docker log is size-capped
// (json-file, 5 × 10 MB), Postgres logs errors without DETAIL (a foreign key refusal names the
// full account id there), and the account-deletion and retention settings reach the api only.
describe('docker-compose: log limits, db error verbosity and the Phase 4 settings', () => {
  const stripComments = (text) => text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
  const files = {
    'docker-compose.yml': stripComments(read(path.join(STACK, 'docker-compose.yml'))),
    'docker-compose.memanto.yml': stripComments(read(path.join(STACK, 'docker-compose.memanto.yml'))),
  };
  const PHASE4_VARS = ['ACCOUNT_DELETION_ENABLED', 'RETENTION_ENABLED', 'RETENTION_AI_USAGE_DAYS', 'RETENTION_PROCESSING_DAYS', 'RETENTION_DELETION_PROOF_YEARS', 'RETENTION_AI_APP_RECORD_YEARS'];

  it('both files define the json-file anchor at the top level, before services (anchors do not cross files)', () => {
    for (const [file, text] of Object.entries(files)) {
      assert.match(text, /^x-logging: &default-logging\n {2}driver: json-file\n {2}options:\n {4}max-size: "10m"\n {4}max-file: "5"\n/m, file);
      assert.ok(text.indexOf('x-logging:') < text.search(/^services:/m), `${file}: before services`);
    }
  });

  it('every service of both files uses it (the 10 services of every profile)', () => {
    const all = [];
    for (const [file, text] of Object.entries(files)) {
      for (const [name, block] of Object.entries(serviceBlocks(text))) {
        all.push(name);
        assert.match(block, /^ {4}logging: \*default-logging\s*$/m, `${file}: ${name}`);
        assert.doesNotMatch(block, /^ {4}logging:\s*$/m, `${file}: ${name} has no inline logging block`);
      }
    }
    assert.deepEqual(all.sort(), ['api', 'cloudflared', 'db', 'hermes', 'kokoro-tts', 'mcp', 'mcp-public', 'memanto', 'moorcheh', 'ollama']);
  });

  it('db logs errors with log_error_verbosity=terse (no DETAIL with the values)', () => {
    assert.match(services.db || '', /^ {4}command: \["postgres", "-c", "log_error_verbosity=terse"\]\s*$/m);
  });

  it('the six account-deletion and retention settings reach the api with empty defaults, and no other service', async () => {
    const { RETENTION_ENV_KEYS } = await import('../services/retention.js');
    assert.deepEqual(PHASE4_VARS, ['ACCOUNT_DELETION_ENABLED', ...RETENTION_ENV_KEYS], 'every name retention reads is passed');
    for (const name of PHASE4_VARS) {
      assert.match(services.api || '', new RegExp(`^ {6}${name}: \\$\\{${name}:-\\}\\s*$`, 'm'), name);
    }
    for (const [file, text] of Object.entries(files)) {
      for (const [name, block] of Object.entries(serviceBlocks(text))) {
        if (file === 'docker-compose.yml' && name === 'api') continue;
        for (const variable of PHASE4_VARS) assert.ok(!block.includes(variable), `${file}: ${name} has ${variable}`);
      }
    }
  });

  it('the api keeps NODE_ENV production by default, so retention there is on unless turned off (outside production it is opt-in)', () => {
    assert.match(services.api || '', /^ {6}NODE_ENV: \$\{NODE_ENV:-production\}\s*$/m);
  });

  it('ACCOUNT_DELETION_ENABLED starts off; "Require current password" and the production amr check come first in every deployment, not only with byoa', () => {
    const stack = read(path.join(STACK, 'stack.env.example'));
    const block = stack.slice(stack.indexOf('# --- Account deletion and retention'), stack.indexOf('# ACCOUNT_DELETION_ENABLED='));
    const text = block.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' ');
    const sentence = text.split(/(?<=\.)\s+/).find((part) => part.includes('Require current password'));
    assert.ok(sentence, 'the comment names the Supabase setting');
    assert.match(sentence, /whatever COMPOSE_PROFILES says/);
    assert.match(sentence, /§8\.2 items 2-3/);
    assert.match(sentence, /production amr check/);
    assert.doesNotMatch(sentence, /while COMPOSE_PROFILES lists byoa/);
    assert.match(text, /current_password_required/, 'the staging check');
    assert.match(text, /Deletion starts off/);
    assert.doesNotMatch(text, /unset or empty = on/);
    for (const file of [path.join(STACK, 'stack.env.example'), path.join(ROOT, '.env.example')]) {
      const documented = lines(read(file)).filter((line) => line.startsWith('# ACCOUNT_DELETION_ENABLED='));
      assert.deepEqual(documented, ['# ACCOUNT_DELETION_ENABLED=true'], `${file}: the line to uncomment turns it on`);
    }
  });

  it('ACCOUNT_DELETION_ENABLED: both env examples name its values and case rule as the api reads them (self-review, recheck 1)', async () => {
    const { readEnvSwitch } = await import('../../server/utils/envSwitch.js');
    for (const file of [path.join(STACK, 'stack.env.example'), path.join(ROOT, '.env.example')]) {
      const source = read(file);
      const block = source.slice(source.indexOf('# --- Account deletion and retention'), source.indexOf('# ACCOUNT_DELETION_ENABLED=true'));
      const text = block.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' ');
      const said = text.match(/true \(or ([^;)]+); any case, surrounding spaces ignored\) turns it on; unset, empty or false \(or ([^;)]+); any case\) keeps it off; any other value keeps it off/);
      assert.ok(said, `${file}: the comment names the values and the case rule`);
      assert.deepEqual([said[1], said[2]], ['1, on, yes', '0, off, no'], `${file}: every value the parser knows`);
      for (const value of ['true', ...said[1].split(', ')]) {
        for (const spelled of [value, value.toUpperCase(), ` ${value} `]) {
          assert.deepEqual(readEnvSwitch(spelled), { on: true, recognised: true }, `${file}: ${JSON.stringify(spelled)}`);
        }
      }
      for (const value of ['false', ...said[2].split(', ')]) {
        for (const spelled of [value, value.toUpperCase(), ` ${value} `]) {
          assert.deepEqual(readEnvSwitch(spelled), { on: false, recognised: true }, `${file}: ${JSON.stringify(spelled)}`);
        }
      }
      assert.deepEqual(readEnvSwitch('ture'), { on: false, recognised: false });
    }
  });

  it('stack.env.example documents them commented out; mcp-public.env.example never names them', () => {
    const stack = read(path.join(STACK, 'stack.env.example'));
    const values = lines(stack).filter((line) => !line.startsWith('#'));
    for (const name of PHASE4_VARS) {
      assert.ok(!values.some((line) => line.startsWith(`${name}=`)), `${name} is not set in stack.env.example`);
      assert.match(stack, new RegExp(`^# ${name}=`, 'm'), `${name} is documented`);
      assert.ok(!read(path.join(STACK, 'mcp-public.env.example')).includes(name), `${name} in mcp-public.env.example`);
      assert.match(read(path.join(ROOT, '.env.example')), new RegExp(`^# ${name}=`, 'm'), `${name} in .env.example`);
    }
  });

  it('TRAINING_ENABLED (training-plan D5) reaches the api with an empty default and no other service; documented commented out', () => {
    assert.match(services.api || '', /^ {6}TRAINING_ENABLED: \$\{TRAINING_ENABLED:-\}\s*$/m);
    for (const [file, text] of Object.entries(files)) {
      for (const [name, block] of Object.entries(serviceBlocks(text))) {
        if (file === 'docker-compose.yml' && name === 'api') continue;
        assert.ok(!block.includes('TRAINING_ENABLED'), `${file}: ${name} has TRAINING_ENABLED`);
      }
    }
    const stack = read(path.join(STACK, 'stack.env.example'));
    assert.ok(!lines(stack).some((line) => line.startsWith('TRAINING_ENABLED=')), 'not set in stack.env.example (the public stack leaves it off)');
    assert.deepEqual(lines(stack).filter((line) => line.startsWith('# TRAINING_ENABLED=')), ['# TRAINING_ENABLED=true']);
    assert.ok(!read(path.join(STACK, 'mcp-public.env.example')).includes('TRAINING_ENABLED'));
    assert.deepEqual(lines(read(path.join(ROOT, '.env.example'))).filter((line) => /^#? ?(TRAINING_ENABLED|VITE_FEATURE_TRAINING)=/.test(line)), ['# VITE_FEATURE_TRAINING=true', '# TRAINING_ENABLED=true']);
  });

  // The log limits put docker-compose.memanto.yml into scan-secrets' --diff, which reports the
  // memanto volume's mount point inside its container. The allowlist works per file and rule, so
  // this keeps that exemption from hiding a real personal path added to the file later.
  it('scan-secrets allowlists docker-compose.memanto.yml for one container path only: the memanto volume target', async () => {
    const { scanText, loadAllowlist } = await import('../../scripts/ci/scan-secrets.mjs');
    const rel = 'deploy/risepath-vm/docker-compose.memanto.yml';
    const raw = read(path.join(ROOT, rel));
    const rawLines = raw.split(/\r?\n/);
    const hits = scanText(raw).filter((f) => f.rule === 'absolute-personal-path').map((f) => rawLines[f.line - 1]);
    assert.equal(hits.length, 1, `exactly one absolute path in ${rel}: ${hits.length}`);
    assert.match(hits[0], /^ {6}- risepath_memanto_data:\/home\/memanto\/\.memanto$/, 'the memanto service volume target');
    assert.match(serviceBlocks(files['docker-compose.memanto.yml']).memanto || '', /^ {6}- risepath_memanto_data:\/home\/memanto\/\.memanto$/m, 'inside the memanto service');
    const entries = loadAllowlist(path.join(ROOT, 'scripts', 'ci', 'scan-secrets.allow.json')).filter((e) => e.re.test(rel));
    assert.deepEqual(entries.map((e) => [e.path, e.rule]), [[rel, 'absolute-personal-path']], 'one entry, this file and this rule only');
  });
});

// Phase 7 (owner decision P3; doc/brushup-2026/ai-access-plan.ja.md): "Server stack deploy" runs the
// real deploy-stack.sh on the commit it checked out (often a detached HEAD, where `git pull` fails),
// through scripts/ci/stack.sh deploy with RISEPATH_DEPLOY_SKIP_PULL=1. Only that step is skipped, and
// only for exactly 1 from the caller's environment; on the VM the variable is unset and every deploy
// pulls and re-runs a moved script, as before. CI never runs the pull or the re-run, so these tests are
// their only check: the whole script runs from a temporary copy with recording git and docker stubs.
// Phase 9 (owner decision D2; design §2.8, T5b, T11, T12): the caller's values are read once, before
// stack.env is sourced, and the re-run takes only the copies the first run forwarded; the 事前チェック
// (preflight.sh) runs before bash reads stack.env and before the pull; the commit line, DB1 before the
// migration, cloudflared in the wait list and the 事後の確かめ (postdeploy-check.sh) after the smoke.
describe('deploy-stack.sh: the caller values, the 事前チェック, the pull, DB1 and the 事後の確かめ (Phase 7 P3, Phase 9 D2)', () => {
  const script = read(path.join(STACK, 'scripts/deploy-stack.sh'));
  const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  // deploy-stack.sh uses ${var,,} (bash 4); stock macOS bash 3.2 stops with "bad substitution".
  const bash4 = spawnSync('bash', ['-c', 'x=A; : "${x,,}"']).status === 0;
  const skip = bash4 ? false : 'needs bash ≥ 4 (deploy-stack.sh uses ${var,,}); on a Mac: brew install bash';
  const COMPOSE = 'compose --env-file stack.env -f docker-compose.yml ';
  const TEMPLATE = read(path.join(STACK, 'ci/stack.ci.env'));
  const DB1 = 'exec -T db sh -c psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW server_encoding"';
  const PROBE = (mode) => `exec -T api node scripts/deploy/postdeploy-probe.mjs --mode ${mode}`;
  const sequence = (mode) => [
    'build',
    'up -d --wait db',
    DB1,
    'run --rm --no-deps -T api npm run db:migrate',
    'up -d --no-deps --force-recreate --wait api',
    '--profile full ps -aq hermes',
    'up -d',
    'up -d --wait mcp',
    'exec -T api env PORT=3006 MCP_SSE_PORT=3100 API_SERVER_PORT=8642 MEMANTO_API_PORT=8100 node scripts/smoke-vm-stack.mjs --target container --require-mcp',
    'logs --no-log-prefix api',
    PROBE(mode),
    'ps',
  ];
  const VM_SEQUENCE = sequence('prod');
  const CI_SEQUENCE = sequence('ci');
  const CI_CALLER = { COMPOSE_PROJECT_NAME: 'risepath-ci' };
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);

  /**
   * Runs a copy of deploy-stack.sh in <tmp>/repo (with a .git directory, so it would pull) next to copies
   * of preflight.sh, check-mode.sh, postdeploy-check.sh, the Dockerfile, ci/stack.ci.env and
   * scripts/deploy/*.mjs, with stack.env = ci/stack.ci.env unless `stackEnv` is given. preflight.sh and
   * postdeploy-check.sh are the real scripts behind a wrapper that records their arguments. git, docker,
   * id (uid 1000, so the harness also runs where npm test runs as root) and systemctl are stubs. git
   * `rev-parse HEAD` prints one sha, or with `moving` sha A on its first call and sha B afterwards (the pull
   * moved HEAD); `pull` exits 1 like a detached checkout with `pullFails`. docker logs every call with the
   * compose project and profiles it was given, and the argv of each `run` (the 事前チェック's container):
   * `preflight` 'pass' exits 0, 'fail' exits `preflightStatus` (1: errors; 2, 3: could not check), 'real' runs
   * the real check with this node, mapping the read-only mounts (the T8 shim). `id -u` answers `uid`. DB1's
   * query answers `dbEncoding` (null: the exec fails, no answer); the probe exec records its stdin and exits
   * `probeStatus`; `logs` prints the retention start-up line. `files` are more files in the stack folder
   * (tunnel.env, launch-record.env). `editOn`: the compose call (a substring) during which stack.env gets one more
   * line, as an edit from a second SSH session would. `waitFails`: the wait before the smoke fails with Compose's
   * English line; `ps --format {{.Health}} cloudflared` answers `cloudflaredHealth`.
   * @param {{ skipPull?: string, stackEnv?: string, moving?: boolean, pullFails?: boolean, env?: Record<string, string>,
   *   preflight?: 'pass' | 'fail' | 'real', preflightStatus?: number, uid?: number, dbEncoding?: string | null, probeStatus?: number,
   *   files?: Record<string, string>, editOn?: string, waitFails?: boolean, cloudflaredHealth?: string }} [opts]
   */
  const runDeploy = ({ skipPull, stackEnv, moving = false, pullFails = false, env: callerEnv = {}, preflight = 'pass', preflightStatus = 1, uid = 1000, dbEncoding = 'UTF8', probeStatus = 0, files = {}, editOn = '', waitFails = false, cloudflaredHealth = '' } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-stack-'));
    try {
      const repo = path.join(dir, 'repo');
      const stackDir = path.join(repo, 'deploy/risepath-vm');
      fs.mkdirSync(path.join(stackDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(stackDir, 'ci'), { recursive: true });
      fs.mkdirSync(path.join(repo, '.git'));
      fs.mkdirSync(path.join(repo, 'scripts/deploy'), { recursive: true });
      for (const f of fs.readdirSync(path.join(ROOT, 'scripts/deploy'))) fs.copyFileSync(path.join(ROOT, 'scripts/deploy', f), path.join(repo, 'scripts/deploy', f));
      for (const f of ['deploy-stack.sh', 'check-mode.sh']) fs.copyFileSync(path.join(STACK, 'scripts', f), path.join(stackDir, 'scripts', f));
      const argvLog = path.join(dir, 'argv.log');
      for (const name of ['preflight', 'postdeploy-check']) {
        fs.copyFileSync(path.join(STACK, `scripts/${name}.sh`), path.join(stackDir, `scripts/${name}.real.sh`));
        fs.writeFileSync(path.join(stackDir, `scripts/${name}.sh`), [
          '#!/usr/bin/env bash',
          `"${process.execPath}" -e 'require("node:fs").appendFileSync(process.env.STUB_ARGV, JSON.stringify(process.argv.slice(1)) + "\\n")' -- ${name} "$@"`,
          `exec bash "$(dirname "\${BASH_SOURCE[0]}")/${name}.real.sh" "$@"`,
        ].join('\n'), { mode: 0o755 });
      }
      fs.copyFileSync(path.join(STACK, 'Dockerfile'), path.join(stackDir, 'Dockerfile'));
      fs.writeFileSync(path.join(stackDir, 'ci/stack.ci.env'), TEMPLATE);
      fs.writeFileSync(path.join(stackDir, 'stack.env'), stackEnv ?? TEMPLATE, { mode: 0o600 });
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(stackDir, name), text, { mode: 0o600 });
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n');
      const log = path.join(dir, 'calls.log');
      const runs = path.join(dir, 'runs.log');
      const probeIn = path.join(dir, 'probe.log');
      for (const f of [log, runs, probeIn, argvLog]) fs.writeFileSync(f, '');
      const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
      stub('git', [
        'echo "git $*" >> "$STUB_LOG"',
        'if [[ "$1" == -C ]]; then shift 2; fi',
        'case "$1" in',
        '  rev-parse)',
        '    n=$(cat "$STUB_COUNT" 2> /dev/null || echo 0); echo $((n + 1)) > "$STUB_COUNT"',
        `    if [[ "$STUB_MOVING" == 1 && "$n" -gt 0 ]]; then echo ${SHA_B}; else echo ${SHA_A}; fi ;;`,
        '  pull) if [[ "$STUB_PULL_FAILS" == 1 ]]; then echo "You are not currently on a branch." >&2; exit 1; fi ;;',
        '  log) echo "bbbbbbb（2026-10-30・the pulled commit）" ;;',
        'esac',
      ].join('\n'));
      stub('id', `echo ${uid}`);
      stub('systemctl', 'case "$2" in risepath-stack.service) echo enabled ;; *) exit 1 ;; esac');
      // 100 GB free wherever the 事前チェック looks (F6 stays quiet on any machine that runs the tests).
      stub('df', 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nstub 200000000 1 100000000 1%% /\\n"');
      fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const env = process.env;
const shown = (v) => (v === undefined ? '<unset>' : v);
fs.appendFileSync(env.STUB_LOG, 'docker [' + shown(env.COMPOSE_PROJECT_NAME) + '|' + shown(env.COMPOSE_PROFILES) + '] ' + args.join(' ') + '\\n');
const stdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
if (args[0] === 'run') {
  fs.appendFileSync(env.STUB_RUNS, JSON.stringify(args) + '\\n');
  const input = stdin();
  if (env.STUB_PREFLIGHT === 'fail') process.exit(Number(env.STUB_PREFLIGHT_STATUS));
  if (env.STUB_PREFLIGHT === 'real') {
    const mounts = args.filter((a, i) => args[i - 1] === '--mount').map((m) => Object.fromEntries(m.split(',').map((kv) => kv.split('='))));
    const at = args.indexOf('node');
    const mapped = args.slice(at + 1).map((a) => { for (const m of mounts) if (a === m.dst || a.startsWith(m.dst + '/')) return m.src + a.slice(m.dst.length); return a; });
    const r = spawnSync(process.execPath, mapped, { input, stdio: ['pipe', 'inherit', 'inherit'] });
    process.exit(r.status ?? 1);
  }
  process.exit(0);
}
if (args[0] === 'compose') {
  const line = args.join(' ');
  if (env.STUB_EDIT_ON && line.includes(env.STUB_EDIT_ON)) fs.appendFileSync(env.STUB_STACK_ENV, '# edited during the deploy\\n');
  if (line.includes('SHOW server_encoding')) {
    if (env.STUB_DB_EXEC_FAILS === '1') { process.stderr.write('service "db" is not running\\n'); process.exit(1); }
    process.stdout.write(env.STUB_DB_ENCODING + '\\n'); process.exit(0);
  }
  if (env.STUB_WAIT_FAILS === '1' && line.includes('up -d --wait mcp')) { process.stderr.write('dependency failed to start: container risepath-cloudflared-1 is unhealthy\\n'); process.exit(1); }
  if (args.includes('ps') && args.includes('{{.Health}}')) { process.stdout.write(env.STUB_CF_HEALTH ? env.STUB_CF_HEALTH + '\\n' : ''); process.exit(0); }
  if (line.includes('postdeploy-probe.mjs')) { fs.appendFileSync(env.STUB_PROBE, stdin() + '\\n'); process.exit(Number(env.STUB_PROBE_STATUS)); }
  if (args.includes('logs')) { process.stdout.write('[Retention] on, hourly: stub\\n'); process.exit(0); }
}
process.exit(0);
`, { mode: 0o755 });
      const env = {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HOME: dir,
        STUB_LOG: log,
        STUB_RUNS: runs,
        STUB_PROBE: probeIn,
        STUB_ARGV: argvLog,
        STUB_COUNT: path.join(dir, 'count'),
        STUB_MOVING: moving ? '1' : '0',
        STUB_PULL_FAILS: pullFails ? '1' : '0',
        STUB_PREFLIGHT: preflight,
        STUB_PREFLIGHT_STATUS: String(preflightStatus),
        STUB_DB_ENCODING: dbEncoding ?? '',
        STUB_DB_EXEC_FAILS: dbEncoding === null ? '1' : '0',
        STUB_PROBE_STATUS: String(probeStatus),
        STUB_EDIT_ON: editOn,
        STUB_STACK_ENV: path.join(stackDir, 'stack.env'),
        STUB_WAIT_FAILS: waitFails ? '1' : '0',
        STUB_CF_HEALTH: cloudflaredHealth,
        ...(skipPull === undefined ? {} : { RISEPATH_DEPLOY_SKIP_PULL: skipPull }),
        ...callerEnv,
      };
      const result = spawnSync('bash', [path.join(stackDir, 'scripts/deploy-stack.sh')], { env, encoding: 'utf8', timeout: 60_000 });
      const calls = lines(read(log));
      const docker = calls.filter((line) => line.startsWith('docker '));
      const composeLines = docker.filter((line) => line.replace(/^docker \[[^\]]*\] /, '').startsWith('compose '));
      const argv = lines(read(argvLog)).map((line) => JSON.parse(line));
      const recordFile = path.join(stackDir, '.deploy/last-green.json');
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        calls,
        git: calls.filter((line) => line.startsWith('git ')),
        docker,
        // Every compose call, in order (a compose call with other files shows as such); the 事前チェック's
        // docker calls (image, info, ps, volume, run) are not compose calls.
        compose: composeLines.map((line) => line.replace(/^docker \[[^\]]*\] /, '')).map((line) => (line.startsWith(COMPOSE) ? line.slice(COMPOSE.length) : `(other files) ${line}`)),
        composeRaw: composeLines,
        runs: lines(read(runs)).map((line) => JSON.parse(line)),
        preflightArgv: argv.filter((a) => a[0] === 'preflight').map((a) => a.slice(1)),
        postdeployArgv: argv.filter((a) => a[0] === 'postdeploy-check').map((a) => a.slice(1)),
        probeFacts: lines(read(probeIn)).map((line) => JSON.parse(line)),
        record: fs.existsSync(recordFile) ? { text: read(recordFile), mode: fs.statSync(recordFile).mode & 0o777, dirMode: fs.statSync(path.dirname(recordFile)).mode & 0o777 } : null,
        stackSha: crypto.createHash('sha256').update(fs.readFileSync(path.join(stackDir, 'stack.env'))).digest('hex'),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  /** The value of a flag in a recorded argv. @param {string[]} argv @param {string} flag */
  const flagOf = (argv, flag) => argv[argv.indexOf(flag) + 1];
  /** The --mode of a recorded docker run (the 事前チェック's container). @param {string[]} run */
  const modeOf = (run) => run[run.indexOf('--mode') + 1];

  // --- T11: static pins (the pin at the Phase 7 lines moved, not weakened) -------------------------------

  it('T11: the caller values are read once, before the stack.env check, from the caller or (on the re-run) only from the forwarded copies', () => {
    const block = [
      'if [[ "${RISEPATH_DEPLOY_REEXEC:-}" == 1 ]]; then',
      '  readonly RISEPATH_CALLER_SKIP_PULL="${RISEPATH_REEXEC_SKIP_PULL:-}"',
      '  readonly RISEPATH_CALLER_PROJECT="${RISEPATH_REEXEC_PROJECT:-}"',
      '  readonly RISEPATH_CALLER_PROFILES="${RISEPATH_REEXEC_PROFILES:-}"',
      '  readonly RISEPATH_CALLER_EXPORTS="${RISEPATH_REEXEC_EXPORTS:-}"',
      'else',
      '  readonly RISEPATH_CALLER_SKIP_PULL="${RISEPATH_DEPLOY_SKIP_PULL:-}"',
      '  readonly RISEPATH_CALLER_PROJECT="${COMPOSE_PROJECT_NAME:-}"',
      '  readonly RISEPATH_CALLER_PROFILES="${COMPOSE_PROFILES:-}"',
      '  RISEPATH_CALLER_EXPORTS="$(compgen -e | tr \'\\n\' \' \' || true)"',
      '  readonly RISEPATH_CALLER_EXPORTS',
      'fi',
    ].join('\n');
    const at = code.indexOf(block);
    assert.ok(at > 0, 'the caller block');
    assert.ok(at < code.indexOf('if [[ ! -f stack.env ]]; then'), 'before the stack.env check');
    assert.ok(at < code.search(/^source stack\.env$/m), 'before stack.env is sourced');
    // RISEPATH_DEPLOY_SKIP_PULL: read in the else branch only, and named in the message.
    assert.equal(code.match(/RISEPATH_DEPLOY_SKIP_PULL/g)?.length, 2, 'read once, and named in the message');
    assert.match(code, /^ {2}echo "==> git pull skipped \(RISEPATH_DEPLOY_SKIP_PULL=1\): deploying the checked-out commit"$/m);
    for (const name of ['SKIP_PULL', 'PROJECT', 'PROFILES', 'EXPORTS']) {
      assert.equal(code.match(new RegExp(`^ {2}(?:readonly )?RISEPATH_CALLER_${name}=`, 'gm'))?.length, 2, `${name}: set once in each branch`);
      assert.equal(code.match(new RegExp(`RISEPATH_REEXEC_${name}=`, 'g'))?.length, 1, `${name}: forwarded once, on the exec line`);
    }
    // Compared once (the pull branch); forwarded to the two checks and the re-run, nowhere else.
    assert.equal(code.match(/RISEPATH_CALLER_SKIP_PULL/g)?.length, 2 + 1 + 2 + 1, 'set (2), compared (1), passed to both checks (2), forwarded (1)');
    assert.equal(code.match(/"\$\{RISEPATH_CALLER_SKIP_PULL\}" == "1"/g)?.length, 1, 'compared once');
    assert.match(code, /^if \[\[ "\$\{RISEPATH_CALLER_SKIP_PULL\}" == "1" \]\]; then\n {2}echo "==> git pull skipped[^\n]*\nelif \[\[ -d "\$\{REPO_ROOT\}\/\.git" \]\]; then\n {2}echo "==> git pull"\n/m,
      'a branch in front of the old pull block, which is unchanged');
  });

  it('T11: the 事前チェック runs before bash reads stack.env and before the pull, with the four caller values; a failure stops the deploy', () => {
    const call = [
      'if ! "${BASH}" "${SCRIPT_DIR}/preflight.sh" --from-deploy \\',
      '    --caller-skip-pull "${RISEPATH_CALLER_SKIP_PULL}" --caller-project "${RISEPATH_CALLER_PROJECT}" \\',
      '    --caller-profiles "${RISEPATH_CALLER_PROFILES}" --caller-exports "${RISEPATH_CALLER_EXPORTS}"; then',
      '  echo "❌ 事前チェックで止めました。上の直し方を見てください（何も変えていません）。"',
      '  exit 1',
      'fi',
    ].join('\n');
    const at = code.indexOf(call);
    assert.ok(at > 0, 'the call');
    assert.ok(at > code.indexOf('if [[ ! -f stack.env ]]; then'), 'after the stack.env check');
    assert.ok(at < code.search(/^source stack\.env$/m), 'before stack.env is sourced');
    assert.ok(at < code.indexOf('git -C "${REPO_ROOT}" pull --ff-only'), 'before the pull');
    assert.equal(code.match(/preflight\.sh/g)?.length, 1, 'one call');
  });

  // Review round 1 of Stage 2, finding 3: the record vouches only for the stack.env the 事前チェック read.
  it('stack.env\'s SHA-256 is taken once, read-only, right before the 事前チェック, and passed to the 事後の確かめ (P13, P16)', () => {
    const hash = code.indexOf([
      'RISEPATH_STACK_ENV_SHA="$({ sha256sum stack.env 2> /dev/null || shasum -a 256 stack.env 2> /dev/null; } | awk \'{print $1}\' || true)"',
      'readonly RISEPATH_STACK_ENV_SHA',
    ].join('\n'));
    assert.ok(hash > code.indexOf('if [[ ! -f stack.env ]]; then'), 'after the stack.env check');
    assert.ok(hash < code.indexOf('"${BASH}" "${SCRIPT_DIR}/preflight.sh"'), 'before the 事前チェック reads the file');
    assert.equal(code.match(/RISEPATH_STACK_ENV_SHA/g)?.length, 3, 'set, made read-only, passed once');
    assert.ok(code.includes('--stack-sha "${RISEPATH_STACK_ENV_SHA}" --profiles "${COMPOSE_PROFILES}"; then'));
  });

  it('T11: the re-run forwards the four caller values under re-run-only names; the commit line is in the pull branch, after it', () => {
    assert.ok(code.includes([
      '    RISEPATH_DEPLOY_REEXEC=1 RISEPATH_REEXEC_SKIP_PULL="${RISEPATH_CALLER_SKIP_PULL}" \\',
      '      RISEPATH_REEXEC_PROJECT="${RISEPATH_CALLER_PROJECT}" RISEPATH_REEXEC_PROFILES="${RISEPATH_CALLER_PROFILES}" \\',
      '      RISEPATH_REEXEC_EXPORTS="${RISEPATH_CALLER_EXPORTS}" exec "${BASH}" "${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")" "$@"',
    ].join('\n')), 'the exec line');
    const commit = code.indexOf('  echo "==> デプロイするコミット: $(git -C "${REPO_ROOT}" log -1 --abbrev=7 --format=\'%h（%cs・%s）\')"');
    assert.ok(commit > 0, 'the commit line');
    assert.ok(commit > code.indexOf('exec "${BASH}"'), 'after the re-run');
    const branchEnd = code.indexOf('\nfi\n', code.indexOf('elif [[ -d "${REPO_ROOT}/.git" ]]; then'));
    assert.ok(commit > code.indexOf('elif [[ -d "${REPO_ROOT}/.git" ]]; then') && commit < branchEnd, 'inside the pull branch (CI makes no git call)');
  });

  // The runbook's はじめに asks the owner to compare the 7 characters GitHub shows with this line; git's own
  // length grows with the clone (8 from about 16,000 objects), which core.abbrev=12 stands in for here.
  const hasGit = spawnSync('git', ['--version']).status === 0;
  it('the commit line prints the 7 characters GitHub shows, also where git would print more (real git, core.abbrev=12)', { skip: hasGit ? false : 'git is not installed' }, () => {
    const line = /^ {2}(echo "==> デプロイするコミット: .*)$/m.exec(code)?.[1];
    assert.ok(line, 'the commit line');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-commit-'));
    try {
      const when = '2026-10-30T12:00:00+0000';
      const env = {
        PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'),
        GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_COMMITTER_DATE: when,
      };
      const git = (/** @type {string[]} */ ...args) => spawnSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' });
      assert.equal(git('init', '-q').status, 0);
      assert.equal(git('config', 'core.abbrev', '12').status, 0);
      assert.equal(git('commit', '-q', '--allow-empty', '-m', 'Phase 9 test commit').status, 0);
      const full = git('rev-parse', 'HEAD').stdout.trim();
      assert.equal(git('log', '-1', '--format=%h').stdout.trim().length, 12, 'git alone prints 12 characters in this clone');
      const r = spawnSync('bash', ['-c', line], { env: { ...env, REPO_ROOT: dir }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `==> デプロイするコミット: ${full.slice(0, 7)}（2026-10-30・Phase 9 test commit）\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DB0, DB1: after db is healthy and before the migration; no answer (DB0) and another encoding (DB1) stop the deploy with the catalog\'s lines', () => {
    const at = code.indexOf('DB_ENCODING="$(compose exec -T db sh -c \'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW server_encoding"\' 2> /dev/null | tr -d \'[:space:]\' || true)"');
    assert.ok(at > code.indexOf('compose up -d --wait db') && at < code.indexOf('npm run db:migrate'), 'between db up and db:migrate');
    const guard = code.slice(at, code.indexOf('npm run db:migrate'));
    // The shell escapes the fix's backquotes; the printed line is the catalog's text.
    const lines = (/** @type {string} */ name) => {
      const db = /** @type {{ title: string, fix: string }} */ (DEPLOY_CODES.find((c) => c.code === name));
      return `  echo "❌ [${name}] ${db.title}"\n  echo "   直し方: ${db.fix.replace(/`/g, '\\`')}"\n  echo "   くわしく: 手順書 13 章の「${name}」"\n  exit 1`;
    };
    const empty = guard.indexOf('if [[ -z "${DB_ENCODING}" ]]; then');
    const other = guard.indexOf('if [[ "${DB_ENCODING}" != UTF8 ]]; then');
    assert.ok(empty > 0 && other > empty, 'the empty answer first');
    assert.ok(guard.slice(empty, other).includes(lines('DB0')), 'DB0: the catalog\'s title and fix');
    assert.ok(guard.slice(other).includes(lines('DB1')), 'DB1: the catalog\'s title and fix');
  });

  // Review round 1 of Stage 2, finding 5: a tunnel that never connects stops the wait before the 事後の確かめ.
  it('the wait before the smoke: a failure prints P5\'s catalog lines when tunnel is listed and cloudflared is not healthy, then the stop line', () => {
    const at = code.indexOf('if ! compose up -d --wait "${WAIT[@]}"; then');
    assert.ok(at > 0 && at < code.indexOf('node scripts/smoke-vm-stack.mjs'));
    const handler = code.slice(at, code.indexOf('\nfi\n', at));
    const p5 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P5'));
    assert.ok(handler.includes(`    echo "❌ [P5] ${p5.title}"\n    echo "   直し方: ${p5.fix.replace(/`/g, '\\`')}"\n    echo "   くわしく: 手順書 13 章の「P5」"`), 'P5: the catalog\'s text');
    assert.ok(handler.includes('"$(compose ps --format \'{{.Health}}\' cloudflared 2> /dev/null | head -n 1 || true)" != healthy'));
    assert.match(handler, /echo "❌ 待っていた部品が healthy になりませんでした（Rise Path は、もう新しい版に入れ替わっています）。"\n.*\n\s*exit 1$/);
  });

  it('T11: the 事後の確かめ runs after the smoke and before Done, with the caller values and the deploy\'s profiles', () => {
    const call = [
      'if ! "${BASH}" "${SCRIPT_DIR}/postdeploy-check.sh" --from-deploy \\',
      '    --caller-skip-pull "${RISEPATH_CALLER_SKIP_PULL}" --caller-project "${RISEPATH_CALLER_PROJECT}" \\',
      '    --stack-sha "${RISEPATH_STACK_ENV_SHA}" --profiles "${COMPOSE_PROFILES}"; then',
      '  echo "❌ デプロイは終わりましたが、確かめで問題が見つかりました。上のコードを手順書 13 章で見てください。"',
      '  exit 1',
      'fi',
    ].join('\n');
    const at = code.indexOf(call);
    assert.ok(at > code.indexOf('node scripts/smoke-vm-stack.mjs'), 'after the smoke');
    assert.ok(at < code.indexOf('echo "==> Done"'), 'before Done');
  });

  // --- T12: the whole script with stubs ---------------------------------------------------------------

  it('unset (the VM): the 事前チェック (prod), then git pull --ff-only before any compose call; a detached checkout stops the deploy there', { skip }, () => {
    const vm = runDeploy();
    assert.equal(vm.status, 0, vm.out);
    assert.deepEqual(vm.git.filter((line) => line.endsWith(' pull --ff-only')).length, 1);
    const pullAt = vm.calls.findIndex((line) => line.endsWith(' pull --ff-only'));
    const runAt = vm.calls.findIndex((line) => / run --rm -i --network none /.test(line));
    assert.ok(runAt >= 0 && runAt < pullAt, 'the 事前チェック comes first');
    assert.ok(pullAt < vm.calls.findIndex((line) => / compose /.test(line)), 'the pull comes before any compose call');
    assert.deepEqual(vm.compose, VM_SEQUENCE);
    assert.deepEqual(vm.runs.map(modeOf), ['prod'], 'T12d: one check, production rules');
    assert.match(vm.out, /==> git pull\n/);
    assert.match(vm.out, /==> デプロイするコミット: bbbbbbb（2026-10-30・the pulled commit）\n/);
    assert.doesNotMatch(vm.out, /git pull skipped/);

    const detached = runDeploy({ pullFails: true });
    assert.equal(detached.status, 1, detached.out);
    assert.match(detached.out, /You are not currently on a branch/);
    assert.deepEqual(detached.compose, [], 'nothing built or started');
  });

  it('unset (the VM), HEAD moved by the pull: one re-run of the pulled script, which checks, pulls again and deploys once', { skip }, () => {
    const moved = runDeploy({ moving: true });
    assert.equal(moved.status, 0, moved.out);
    assert.equal(moved.out.match(/==> HEAD moved — re-running the pulled deploy-stack\.sh/g)?.length, 1, 'one re-run');
    assert.equal(moved.git.filter((line) => line.endsWith(' pull --ff-only')).length, 2, 'the re-run pulls again (HEAD no longer moves)');
    // T12e: 6 before Phase 9, plus the commit line (the re-run only) and the deploy record's commit (P13).
    assert.equal(moved.git.length, 8, moved.git.join('\n'));
    assert.equal(moved.out.match(/==> デプロイするコミット: /g)?.length, 1, 'only the run that deploys names the commit');
    assert.deepEqual(moved.compose, VM_SEQUENCE, 'built and deployed once, by the re-run');
    assert.deepEqual(moved.runs.map(modeOf), ['prod', 'prod'], 'the first run and the pulled re-run each check before sourcing');
    assert.equal(JSON.parse(/** @type {{ text: string }} */ (moved.record).text).commit, SHA_B, 'P13 records the pulled commit');
  });

  it('RISEPATH_DEPLOY_SKIP_PULL=1 with the CI project skips only the pull: CI mode, no git call, the same compose sequence', { skip }, () => {
    for (const moving of [false, true]) {
      const ci = runDeploy({ skipPull: '1', moving, env: CI_CALLER });
      assert.equal(ci.status, 0, ci.out);
      assert.deepEqual(ci.git, [], 'T12d: no git call: no pull, no re-run, no commit line, no deploy record');
      assert.deepEqual(ci.compose, CI_SEQUENCE);
      assert.deepEqual(ci.runs.map(modeOf), ['ci'], 'T12d: CI mode');
      assert.equal(ci.record, null, 'no deploy record in CI mode');
      assert.match(ci.out, /==> git pull skipped \(RISEPATH_DEPLOY_SKIP_PULL=1\): deploying the checked-out commit\n/);
      assert.doesNotMatch(ci.out, /==> git pull\n|HEAD moved|デプロイするコミット/);
    }
    // Without the CI project (or with any other of the four conditions missing) the rules are production's.
    const noProject = runDeploy({ skipPull: '1' });
    assert.equal(noProject.status, 0, noProject.out);
    assert.deepEqual(noProject.runs.map(modeOf), ['prod']);
    assert.deepEqual(noProject.git.filter((line) => / pull /.test(line)), [], 'the pull is still skipped');
  });

  it('only exactly 1 skips: true, yes, 0, 01, " 1" and an empty value still pull', { skip }, () => {
    for (const value of ['true', 'yes', '0', '01', ' 1', '']) {
      const run = runDeploy({ skipPull: value });
      assert.equal(run.status, 0, `${JSON.stringify(value)}: ${run.out}`);
      assert.equal(run.git.filter((line) => line.endsWith(' pull --ff-only')).length, 1, JSON.stringify(value));
      assert.doesNotMatch(run.out, /git pull skipped/, JSON.stringify(value));
    }
  });

  it('stack.env cannot turn the pull off, and a stack.env that assigns a read-only name stops before any compose call', { skip }, () => {
    const viaEnv = runDeploy({ stackEnv: `${TEMPLATE}RISEPATH_DEPLOY_SKIP_PULL=1\n` });
    assert.equal(viaEnv.status, 0, viaEnv.out);
    assert.equal(viaEnv.git.filter((line) => line.endsWith(' pull --ff-only')).length, 1, 'stack.env is read after the variable');

    for (const line of ['RISEPATH_CALLER_SKIP_PULL=1', 'export RISEPATH_CALLER_SKIP_PULL=1', 'RISEPATH_CALLER_PROJECT=risepath-ci', 'RISEPATH_CALLER_EXPORTS=', `RISEPATH_STACK_ENV_SHA=${'0'.repeat(64)}`]) {
      const internal = runDeploy({ stackEnv: `${TEMPLATE}${line}\n` });
      assert.notEqual(internal.status, 0, `${line}: ${internal.out}`);
      assert.match(internal.out, /RISEPATH_(?:CALLER_[A-Z_]+|STACK_ENV_SHA): readonly variable/, line);
      assert.deepEqual(internal.compose, [], `${line}: nothing built or started`);
      assert.deepEqual(internal.git, [], `${line}: stopped at source stack.env`);
    }
  });

  it('stack.env cannot select CI mode (the real 事前チェック): the template plus RISEPATH_DEPLOY_SKIP_PULL=1 is checked as production and stops (A2, C9)', { skip }, () => {
    for (const env of [{}, CI_CALLER]) {
      const r = runDeploy({ stackEnv: `${TEMPLATE}RISEPATH_DEPLOY_SKIP_PULL=1\n`, preflight: 'real', env });
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(r.runs.map(modeOf), ['prod']);
      assert.match(r.out, /^❌ \[A2\] /m);
      assert.match(r.out, /^❌ \[C9\] .*RISEPATH_DEPLOY_SKIP_PULL/m);
      assert.match(r.out, /^❌ 事前チェックで止めました。/m);
      assert.deepEqual(r.git, [], 'stopped before the pull');
      assert.deepEqual(r.compose, [], 'nothing built or started');
    }
  });

  it('T12a: a failing 事前チェック stops the deploy before the pull and before any compose call', { skip }, () => {
    for (const opts of [{}, { skipPull: '1', env: CI_CALLER }, { moving: true }]) {
      const r = runDeploy({ ...opts, preflight: 'fail' });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /^❌ 事前チェックで止めました。上の直し方を見てください（何も変えていません）。$/m);
      assert.deepEqual(r.git, [], 'no git call');
      assert.deepEqual(r.compose, [], 'no compose line');
      assert.equal(r.record, null);
    }
  });

  it('T12a (design §2.7): a 事前チェック that could not check (exit 2, 3) stops the deploy like an error; as root, X5 stops it before the pull', { skip }, () => {
    for (const preflightStatus of [2, 3]) {
      const r = runDeploy({ preflight: 'fail', preflightStatus });
      assert.equal(r.status, 1, `${preflightStatus}: ${r.out}`);
      assert.match(r.out, /^❌ 事前チェックで止めました。/m, String(preflightStatus));
      assert.deepEqual([r.git, r.compose, r.record], [[], [], null], String(preflightStatus));
    }
    // The real preflight.sh as uid 0 (design §2.2: a root deploy would also leave root-owned files in .git
    // and .deploy/): X5, no docker call at all, nothing pulled, built or recorded.
    const root = runDeploy({ preflight: 'real', uid: 0 });
    assert.equal(root.status, 1, root.out);
    assert.match(root.out, /^❌ \[X5\] 事前チェックは sudo なしで実行します/m);
    assert.match(root.out, /^❌ 事前チェックで止めました。/m);
    assert.deepEqual([root.git, root.docker, root.record], [[], [], null]);
    assert.equal(root.preflightArgv.length, 1, 'the check ran once');
  });

  it('T12b: a bare value line in stack.env (the real 事前チェック) is A9 and is never printed; bash never runs the line', { skip }, () => {
    const S = `SENTINELX9F3${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const r = runDeploy({ stackEnv: `${TEMPLATE}${S}\n`, preflight: 'real' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^❌ \[A9\] stack\.env の \d+ 行目が読めません/m);
    assert.ok(!r.out.includes(S), 'the sentinel is in neither stdout nor stderr');
    assert.doesNotMatch(r.out, /command not found/, 'bash never sourced the file');
    assert.deepEqual(r.git, [], 'no git call');
    assert.deepEqual(r.compose, []);
  });

  it('the real 事前チェック in CI mode passes the CI template with the four conditions, and the deploy goes on', { skip }, () => {
    const r = runDeploy({ skipPull: '1', env: CI_CALLER, preflight: 'real' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^（CI モード: 本番だけの決まりを飛ばしています）$/m);
    assert.deepEqual(r.compose, CI_SEQUENCE);
  });

  it('T12c: the re-run takes the caller values the first run forwarded, never the names stack.env exported', { skip }, () => {
    // The template sets COMPOSE_PROJECT_NAME=risepath-ci and COMPOSE_PROFILES= (empty); the caller has no
    // project and COMPOSE_PROFILES=tts. Sourced with set -a, both reach the re-run's environment.
    const r = runDeploy({ moving: true, env: { COMPOSE_PROFILES: 'tts', P9_CALLER_ONLY_X: '1' } });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.preflightArgv.length, 2, 'the first run and the re-run');
    const [first, rerun] = r.preflightArgv;
    assert.deepEqual(rerun, first, 'the same caller values on both runs');
    assert.equal(flagOf(rerun, '--caller-project'), '', 'forwarded, not stack.env\'s risepath-ci');
    assert.equal(flagOf(rerun, '--caller-profiles'), 'tts', 'forwarded, not stack.env\'s empty list');
    assert.equal(flagOf(rerun, '--caller-skip-pull'), '');
    const exports = flagOf(rerun, '--caller-exports').split(' ');
    assert.ok(exports.includes('P9_CALLER_ONLY_X') && exports.includes('COMPOSE_PROFILES'), 'the caller\'s exported names');
    for (const name of ['COMPOSE_PROJECT_NAME', 'POSTGRES_PASSWORD', 'DATABASE_URL_PHASE1', 'RISEPATH_DEPLOY_REEXEC', 'RISEPATH_REEXEC_PROJECT']) {
      assert.ok(!exports.includes(name), `${name}: not the caller's`);
    }
    assert.deepEqual(r.postdeployArgv, [['--from-deploy', '--caller-skip-pull', '', '--caller-project', '', '--stack-sha', r.stackSha, '--profiles', '']], 'the 事後の確かめ gets the same values');
    assert.deepEqual(r.runs.map(modeOf), ['prod', 'prod']);
  });

  it('T12e: DB1 answers SQL_ASCII → the deploy stops before db:migrate with the DB1 lines; no answer is DB0, never DB1', { skip }, () => {
    const r = runDeploy({ dbEncoding: 'SQL_ASCII' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^❌ \[DB1\] DB の文字コードが UTF8 ではありません/m);
    assert.deepEqual(r.compose, VM_SEQUENCE.slice(0, VM_SEQUENCE.indexOf(DB1) + 1), 'nothing after the DB1 query');
    for (const encoding of ['utf8', 'UTF8 x', 'LATIN1']) {
      const other = runDeploy({ dbEncoding: encoding });
      assert.equal(other.status, 1, JSON.stringify(encoding));
      assert.match(other.out, /^❌ \[DB1\] /m, JSON.stringify(encoding));
      assert.doesNotMatch(other.out, /\[DB0\]/, JSON.stringify(encoding));
    }
    // Review round 1 of Stage 2, findings 2, 6, 10: an empty answer or a failed exec says nothing about the
    // encoding, so it never prints DB1's advice to make the DB again.
    for (const encoding of ['', ' \n ', null]) {
      const none = runDeploy({ dbEncoding: encoding });
      assert.equal(none.status, 1, `${JSON.stringify(encoding)}: ${none.out}`);
      assert.match(none.out, /^❌ \[DB0\] DB に文字コードをたずねましたが、答えがありませんでした（DB はまだ変わっていません）。$/m, JSON.stringify(encoding));
      assert.doesNotMatch(none.out, /\[DB1\]|作り直します/, JSON.stringify(encoding));
      assert.deepEqual(none.compose, VM_SEQUENCE.slice(0, VM_SEQUENCE.indexOf(DB1) + 1), `${JSON.stringify(encoding)}: nothing after the query`);
    }
  });

  // Review round 1 of Stage 2, finding 3: an edit to stack.env during the deploy (a second SSH session) is
  // never recorded as checked; the next 事前チェック still sees the old record, and the owner deploys again.
  it('P16: stack.env edited between the 事前チェック and P13 → no record, P16, the deploy fails; unedited → the record has the hash taken before the check', { skip }, () => {
    for (const editOn of [' build', 'up -d --wait mcp', 'postdeploy-probe.mjs']) {
      const r = runDeploy({ editOn });
      assert.equal(r.status, 1, `${editOn}: ${r.out}`);
      assert.match(r.out, /^❌ \[P16\] デプロイの途中で stack\.env が変わったので、通ったデプロイを記録しませんでした。$/m, editOn);
      assert.match(r.out, /^❌ デプロイは終わりましたが、確かめで問題が見つかりました。/m, editOn);
      assert.equal(r.record, null, `${editOn}: no record`);
      assert.doesNotMatch(r.out, /\[P13\]|==> Done/, editOn);
      const given = flagOf(r.postdeployArgv[0], '--stack-sha');
      assert.match(given, /^[0-9a-f]{64}$/);
      assert.notEqual(given, r.stackSha, `${editOn}: the file changed after the hash`);
    }
    const moved = runDeploy({ moving: true });
    assert.equal(moved.status, 0, moved.out);
    assert.equal(JSON.parse(/** @type {{ text: string }} */ (moved.record).text).stackEnvSha256, moved.stackSha, 'the re-run hashes before its own check');
  });

  // Review round 1 of Stage 2, finding 5.
  it('the wait fails: with tunnel listed and cloudflared not healthy, P5\'s lines and the stop line; no smoke, no 事後の確かめ, no record', { skip }, () => {
    const tunnelEnv = TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts,tunnel').replace(/^ORIGIN_SECRET=$/m, `ORIGIN_SECRET=${'5'.repeat(64)}`)
      .replace(/^LLM_ALLOWED_ORIGINS=$/m, 'LLM_ALLOWED_ORIGINS=https://app.example.org');
    const tunnel = { 'tunnel.env': 'TUNNEL_TOKEN=tunnel0123456789\n' };
    const p5 = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((c) => c.code === 'P5'));
    const ok = runDeploy({ stackEnv: tunnelEnv, files: tunnel });
    assert.equal(ok.status, 0, ok.out);
    assert.ok(ok.compose.includes('up -d --wait mcp kokoro-tts cloudflared'), ok.compose.join('\n'));
    for (const cloudflaredHealth of ['unhealthy', 'starting', '']) {
      const r = runDeploy({ stackEnv: tunnelEnv, files: tunnel, waitFails: true, cloudflaredHealth });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /dependency failed to start/, 'Compose\'s own line stays');
      assert.ok(r.out.includes(`❌ [P5] ${p5.title}\n   直し方: ${p5.fix}\n   くわしく: 手順書 13 章の「P5」\n`), r.out);
      assert.match(r.out, /^❌ 待っていた部品が healthy になりませんでした（Rise Path は、もう新しい版に入れ替わっています）。$/m);
      assert.ok(!r.compose.some((line) => line.includes('smoke-vm-stack.mjs')), 'no smoke');
      assert.deepEqual([r.postdeployArgv, r.record], [[], null], 'no 事後の確かめ, no record');
    }
    // cloudflared healthy (another part failed), or no tunnel: the stop line without P5.
    for (const opts of [{ stackEnv: tunnelEnv, files: tunnel, cloudflaredHealth: 'healthy' }, { stackEnv: TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts') }]) {
      const r = runDeploy({ ...opts, waitFails: true });
      assert.equal(r.status, 1, r.out);
      assert.doesNotMatch(r.out, /^❌ \[P5\]/m);
      assert.match(r.out, /^❌ 待っていた部品が healthy になりませんでした/m);
    }
    assert.ok(!runDeploy({ stackEnv: TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts'), waitFails: true }).docker.some((line) => line.includes('{{.Health}}')), 'cloudflared is not asked without tunnel');
  });

  // Review round 1 of Stage 2, finding 4: the caller's shell picks the Compose project and the Docker daemon.
  it('F12 (the real 事前チェック, production rules): a caller COMPOSE_PROJECT_NAME, COMPOSE_FILE, DOCKER_HOST or DOCKER_CONTEXT stops the deploy before any git or compose call', { skip }, () => {
    // The fixtures' finished stack at setup, its record dated in the past (A12 refuses a date after today).
    const stage = buildFiles('setup');
    const stackEnv = stage['stack.env'];
    const files = { 'tunnel.env': stage['tunnel.env'], 'launch-record.env': stage['launch-record.env'].replace(/=\d{4}-\d{2}-\d{2}$/gm, '=2026-01-05') };
    const clean = runDeploy({ stackEnv, files, preflight: 'real', env: { GIT_SSH_COMMAND: 'ssh -i key', COMPOSE_PROFILES: 'tts' } });
    assert.equal(clean.status, 0, clean.out);
    assert.doesNotMatch(clean.out, /\[F12\]/);
    assert.deepEqual(clean.runs.map(modeOf), ['prod']);
    assert.ok(clean.compose.length > 0, 'the control deploys');
    for (const [name, value] of [['COMPOSE_PROJECT_NAME', 'risepath-old'], ['COMPOSE_PROJECT_NAME', 'risepath'], ['COMPOSE_FILE', 'other.yml'], ['DOCKER_HOST', 'tcp://10.0.0.9:2375'], ['DOCKER_CONTEXT', 'other']]) {
      const r = runDeploy({ stackEnv, files, preflight: 'real', env: { [name]: value } });
      assert.equal(r.status, 1, `${name}: ${r.out}`);
      assert.match(r.out, new RegExp(`^❌ \\[F12\\] このシェルに、デプロイの道具（Compose、Docker）の動きを変える値があります（${name}。`, 'm'), name);
      assert.ok(!r.out.includes(value === 'risepath' ? '\u0000' : value), `${name}: the value is never printed`);
      assert.match(r.out, /^❌ 事前チェックで止めました。/m);
      assert.deepEqual([r.git, r.compose, r.record], [[], [], null], name);
    }
  });

  it('the 事後の確かめ: errors fail the deploy after the stack is up (no Done, no record); a clean production deploy writes the record', { skip }, () => {
    for (const probeStatus of [10, 11, 1, 125]) {
      const r = runDeploy({ probeStatus });
      assert.equal(r.status, 1, `${probeStatus}: ${r.out}`);
      assert.match(r.out, /^❌ デプロイは終わりましたが、確かめで問題が見つかりました。上のコードを手順書 13 章で見てください。$/m);
      assert.doesNotMatch(r.out, /==> Done/);
      assert.equal(r.record, null, `${probeStatus}: no deploy record`);
    }
    const ok = runDeploy();
    assert.equal(ok.status, 0, ok.out);
    const record = /** @type {{ text: string, mode: number, dirMode: number }} */ (ok.record);
    assert.deepEqual(Object.keys(JSON.parse(record.text)), ['at', 'commit', 'stackEnvSha256'], 'TR2: { at, commit, stackEnvSha256 }');
    assert.equal(JSON.parse(record.text).stackEnvSha256, ok.stackSha, 'the SHA-256 of stack.env, as the 事前チェック computes it (F5)');
    assert.equal(JSON.parse(record.text).commit, SHA_A);
    assert.match(JSON.parse(record.text).at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual([record.mode, record.dirMode], [0o644, 0o755]);
    assert.match(ok.out, /^ℹ️ \[P13\] 通ったデプロイを記録しました/m);
    assert.deepEqual(ok.probeFacts, [{ profiles: '', cloudflared: '', unitStack: 'enabled', retentionLines: 1 }]);
  });

  it('T12f: with COMPOSE_PROFILES=tts the deploy waits for kokoro-tts and the 事後の確かめ runs its tts branch (P4 asks the sidecar)', { skip }, () => {
    const r = runDeploy({ stackEnv: TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts') });
    assert.equal(r.status, 0, r.out);
    assert.ok(r.compose.includes('up -d --wait mcp kokoro-tts'), r.compose.join('\n'));
    assert.deepEqual(r.postdeployArgv.map((a) => flagOf(a, '--profiles')), ['tts']);
    assert.deepEqual(r.probeFacts.map((f) => f.profiles), ['tts']);
  });

  it('T5b: the 事前チェック\'s effective profiles equal what deploy-stack.sh gives Compose', { skip }, () => {
    const without = TEMPLATE.replace(/^COMPOSE_PROFILES=\n/m, '');
    assert.notEqual(without, TEMPLATE);
    const memanto = TEMPLATE.replace(/^MEMANTO_ENABLED=false$/m, 'MEMANTO_ENABLED=true').replace(/^MEMANTO_SECRET_KEY=$/m, `MEMANTO_SECRET_KEY=${'7'.repeat(40)}`);
    const cases = [
      { stackEnv: TEMPLATE, caller: 'tts' },
      { stackEnv: TEMPLATE, caller: undefined },
      { stackEnv: without, caller: 'tts' },
      { stackEnv: without, caller: '' },
      { stackEnv: without, caller: undefined },
      { stackEnv: without, caller: ' tts ' },
      { stackEnv: TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts'), caller: 'tts,full' },
      { stackEnv: TEMPLATE.replace(/^COMPOSE_PROFILES=$/m, 'export COMPOSE_PROFILES="tts"'), caller: '' },
      { stackEnv: memanto.replace(/^COMPOSE_PROFILES=$/m, 'COMPOSE_PROFILES=tts'), caller: '' },
      { stackEnv: memanto.replace(/^COMPOSE_PROFILES=\n/m, ''), caller: 'tts' },
    ];
    const norm = (/** @type {string} */ v) => v.split(',').map((p) => p.trim()).filter(Boolean).join(',');
    for (const { stackEnv, caller } of cases) {
      const r = runDeploy({ stackEnv, env: caller === undefined ? {} : { COMPOSE_PROFILES: caller } });
      assert.equal(r.status, 0, `${caller}: ${r.out}`);
      const build = r.composeRaw.find((line) => line.endsWith(' build'));
      assert.ok(build, r.composeRaw.join('\n'));
      const given = /^docker \[[^|]*\|([^\]]*)\]/.exec(/** @type {string} */ (build))?.[1] ?? '';
      const engine = effectiveProfiles({ stackEnv: entryMap(parseEnvText(stackEnv).entries), callerProfiles: caller ?? '' });
      assert.equal(norm(given), engine.join(','), `stack.env ${JSON.stringify(stackEnv.match(/^.*COMPOSE_PROFILES.*$/m)?.[0] ?? '(no line)')}, caller ${JSON.stringify(caller)}`);
    }
  });

  it('the CI env template passes every guard, deploys the risepath-ci project and starts no profile', { skip }, () => {
    const ci = runDeploy({ skipPull: '1', env: CI_CALLER });
    assert.equal(ci.status, 0, ci.out);
    assert.match(ci.out, /==> Billing sales: off /);
    assert.match(ci.out, /==> COMPOSE_PROFILES has no full: Hermes is not started/);
    assert.match(ci.out, /MEMANTO_SECRET_KEY unset — skipping Memanto overlay/);
    assert.doesNotMatch(ci.out, /❌|Public edge|byoa profile enabled|Memanto overlay enabled/);
    assert.ok(ci.composeRaw.length > 0);
    for (const line of ci.composeRaw) assert.match(line, /^docker \[risepath-ci\|\] compose /, 'project risepath-ci, no profile');
    assert.ok(!ci.compose.some((line) => line.includes('memanto')), 'one compose file');

    const placeholder = runDeploy({ skipPull: '1', stackEnv: TEMPLATE.replace('ci-dummy-bridge-token', 'change-me') });
    assert.equal(placeholder.status, 1, 'the placeholder guard still runs with the opt-out');
    assert.match(placeholder.out, /RISE_PATH_BRIDGE_TOKEN/);
    assert.deepEqual(placeholder.compose, []);
  });
});

// Phase 8 (S5; design §5.7): the terms check's server switch reaches the api (empty default: off)
// and mcp-public only through its own file (commented: off); the examples say how it pairs with the
// Vercel flag VITE_FEATURE_LEGAL_PAGES, which the server cannot see.
describe('LEGAL_TERMS_REQUIRED: compose and env wiring (Phase 8)', () => {
  const stripComments = (text) => text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
  const composeFiles = {
    'docker-compose.yml': stripComments(read(path.join(STACK, 'docker-compose.yml'))),
    'docker-compose.memanto.yml': stripComments(read(path.join(STACK, 'docker-compose.memanto.yml'))),
  };

  it('reaches the api with an empty default, and no other service has it in its environment', () => {
    assert.match(services.api || '', /^ {6}LEGAL_TERMS_REQUIRED: \$\{LEGAL_TERMS_REQUIRED:-\}\s*$/m);
    for (const [file, text] of Object.entries(composeFiles)) {
      for (const [name, block] of Object.entries(serviceBlocks(text))) {
        if (file === 'docker-compose.yml' && name === 'api') continue;
        assert.ok(!block.includes('LEGAL_TERMS_REQUIRED'), `${file}: ${name}`);
      }
    }
    assert.ok(!read(path.join(STACK, 'ci/stack.ci.env')).includes('LEGAL_TERMS_REQUIRED'), 'the E2E stack keeps it off');
  });

  it('mcp-public.env.example and stack.env.example name it only commented out (off), with the line that turns it on', () => {
    for (const file of ['mcp-public.env.example', 'stack.env.example']) {
      const text = read(path.join(STACK, file));
      assert.ok(!lines(text).some((line) => line.startsWith('LEGAL_TERMS_REQUIRED')), `${file}: not set`);
      assert.deepEqual(lines(text).filter((line) => /^#?\s*LEGAL_TERMS_REQUIRED=/.test(line)), ['# LEGAL_TERMS_REQUIRED=true'], file);
    }
    assert.deepEqual(lines(read(path.join(ROOT, '.env.example'))).filter((line) => /^#?\s*LEGAL_TERMS_REQUIRED=/.test(line)), ['# LEGAL_TERMS_REQUIRED=true']);
  });

  it('stack.env.example gives the order with VITE_FEATURE_LEGAL_PAGES and the role SQL, and says what happens out of order', () => {
    const stack = read(path.join(STACK, 'stack.env.example'));
    const block = stack.slice(stack.indexOf('# --- Terms check (Phase 8'), stack.indexOf('# LEGAL_TERMS_REQUIRED=true'));
    const text = block.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' ');
    assert.match(text, /\(1\) released texts \(the api ignores the switch while they are drafts, and logs it\); \(2\) VITE_FEATURE_LEGAL_PAGES=true on Vercel, redeploy, check the consent page; \(3\) with byoa, run sql\/mcp_remote_role\.sql again; \(4\) the switch on here and in mcp-public\.env, then deploy-stack\.sh\./);
    assert.match(text, /Turn off in reverse \(this switch first\)\./);
    assert.match(text, /On here with the Vercel flag off, learners are refused with no page to accept on\./);
    assert.match(text, /A new version that needs acceptance: turn it off in both files before deploying the texts, on again once the consent page shows/);
    assert.match(text, /server\/middleware\/termsGate\.js TERMS_EXEMPT/);
    // Final review, finding 3: the list names every kind of exempt route (termsGate.js), so an owner
    // reading it before turning the switch on sees that a guardian can still withdraw AI consent.
    assert.match(text, /withdrawing a guardian's AI consent/);
    assert.match(text, /reporting an AI answer/);
    const gate = read(path.join(ROOT, 'server/middleware/termsGate.js'));
    assert.match(gate, /\{ method: 'POST', path: '\/api\/v2\/user\/ai-access\/guardian-consent\/revoke', why: 'consent withdrawal' \}/);
    assert.match(gate, /\{ method: 'POST', path: '\/api\/v2\/safety\/reports', why: 'safety' \}/);
    const readme = read(path.join(STACK, 'README.md'));
    const row = readme.split('\n').find((line) => line.startsWith('| `LEGAL_TERMS_REQUIRED` |'));
    assert.ok(row, 'the README env table has the row');
    assert.match(row, /`mcp-public` は同じ名前を `mcp-public\.env` から読みます/);
    assert.match(row, /文面の公開 → Vercel の `VITE_FEATURE_LEGAL_PAGES=true` と同意の画面の確かめ → `byoa` なら `sql\/mcp_remote_role\.sql` を流し直す → `stack\.env` と `mcp-public\.env` に `true` → `deploy-stack\.sh`/);
    assert.match(row, /同意をお願いする新しい版を出すときは、先に両方で止め、同意の画面が出てから入れ直します/);
  });

  it('stack.env.example names the values that turn the switch on and keep it off, in any case, as the api reads them (self-review, finding 3 and recheck 1)', async () => {
    const { termsEnforcement, termsSwitchLine } = await import('../../tools/core/legalAcceptance.js');
    const stack = read(path.join(STACK, 'stack.env.example'));
    const block = stack.slice(stack.indexOf('# --- Terms check (Phase 8'), stack.indexOf('# LEGAL_TERMS_REQUIRED=true'));
    const text = block.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' ');
    const said = text.match(/Off by default: true \(or ([^;)]+); any case, surrounding spaces ignored, unlike TRAINING_ENABLED below\) turns it on; unset, empty or false \(or ([^;)]+); any case\) keeps it off; any other value keeps it off and the api logs a warning\./);
    assert.ok(said, 'the comment names the values and the case rule');
    // The spellings an owner may write: as listed, upper case, capitalised with spaces around.
    const spellings = (value) => [value, value.toUpperCase(), ` ${value.charAt(0).toUpperCase()}${value.slice(1)} `];
    // TRUE, Yes and ' on ' turn it on too (an owner who wrote them to keep it off would refuse learners).
    for (const value of ['true', ...said[1].split(', ')].flatMap(spellings)) {
      const env = { LEGAL_TERMS_REQUIRED: value, NODE_ENV: 'development' };
      assert.deepEqual(termsEnforcement(env), { on: true, reason: 'on' }, JSON.stringify(value));
    }
    // FALSE, No and OFF keep it off with no warning, as unset does.
    for (const value of [undefined, '', ...['false', ...said[2].split(', ')].flatMap(spellings)]) {
      const env = { LEGAL_TERMS_REQUIRED: value, NODE_ENV: 'development' };
      assert.deepEqual(termsEnforcement(env), { on: false, reason: 'off' }, JSON.stringify(value));
      assert.equal(termsSwitchLine(env), null, `${JSON.stringify(value)}: off, no line`);
    }
    for (const value of ['ture', 'enabled', 'TRUE!']) {
      const env = { LEGAL_TERMS_REQUIRED: value, NODE_ENV: 'development' };
      assert.deepEqual(termsEnforcement(env), { on: false, reason: 'unrecognised' }, value);
      assert.match(String(termsSwitchLine(env)), /unrecognised value/, value);
    }
    assert.deepEqual([said[1], said[2]], ['1, on, yes', '0, off, no'], 'every value the parser knows (server/utils/envSwitch.js)');
    // The contrast it draws is real: the training switch below takes only exactly true.
    const training = stack.slice(stack.indexOf('# --- Job training'), stack.indexOf('# TRAINING_ENABLED=true'));
    assert.match(training.split('\n').map((line) => line.replace(/^#\s?/, '')).join(' '), /exactly true \(TRUE, 1 or yes keep it off\)/);
    assert.match(read(path.join(ROOT, 'server/routes/training.js')), /env\.TRAINING_ENABLED === 'true'/);
  });
});

// Phase 9 (owner decision D2): the 事前チェック wrapper. The rules run in the api's base image with no
// network, a read-only file system, every capability dropped and the caller's uid (never root: root
// without CAP_DAC_OVERRIDE cannot open the deploy user's 0600 env files, and a root deploy would leave
// root-owned files in the checkout). CI mode needs all four conditions of check-mode.sh. The end-to-end
// runs with a docker shim are in preflightCli.test.js (T8); these are the static pins (T11).
describe('preflight.sh and check-mode.sh: the wrapper pins (Phase 9, D2)', () => {
  const script = read(path.join(STACK, 'scripts/preflight.sh'));
  const mode = read(path.join(STACK, 'scripts/check-mode.sh'));
  const code = (/** @type {string} */ text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

  it('runs under set -euo pipefail and parses with bash -n', () => {
    assert.match(script, /^set -euo pipefail$/m);
    for (const file of ['scripts/preflight.sh', 'scripts/check-mode.sh']) {
      const check = spawnSync('bash', ['-n', path.join(STACK, file)], { encoding: 'utf8' });
      assert.equal(check.status, 0, `${file}: ${check.stderr}`);
    }
  });

  // Review round 2, finding 6: the runbook runs them as ./scripts/<name>, so a lost exec bit is 'Permission denied'.
  it('preflight.sh, postdeploy-check.sh and deploy-stack.sh are executable in the tree, and in git once tracked (100755)', () => {
    for (const file of ['scripts/preflight.sh', 'scripts/postdeploy-check.sh', 'scripts/deploy-stack.sh']) {
      assert.ok(fs.statSync(path.join(STACK, file)).mode & 0o100, `${file}: owner exec bit`);
      const staged = spawnSync('git', ['ls-files', '-s', `deploy/risepath-vm/${file}`], { cwd: ROOT, encoding: 'utf8' });
      if (staged.status === 0 && staged.stdout.trim() !== '') assert.match(staged.stdout, /^100755 /, `${file}: git mode`);
    }
  });

  it('refuses uid 0 before any docker call', () => {
    const body = code(script);
    const refusal = body.indexOf('if [[ "$(id -u)" -eq 0 ]]; then');
    assert.ok(refusal > 0, 'the uid 0 refusal');
    assert.match(body.slice(refusal, body.indexOf('fi', refusal)), /say_code X5 [\s\S]*exit 2/);
    const firstDocker = body.search(/(?:^|[\s|(])docker /m);
    assert.ok(firstDocker > refusal, 'no docker call before the refusal');
  });

  it('the container: no network, read-only, every capability dropped, no new privileges, the caller\'s uid, limits', () => {
    const run = code(script).slice(code(script).indexOf('docker run'));
    for (const flag of ['--rm -i', '--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 64', '--memory 256m', '--user "$(id -u):$(id -g)"']) {
      assert.ok(run.includes(flag), flag);
    }
    assert.ok(!/(?:^|\s)(?:-v|--volume|--privileged|--cap-add|--network host)\b/m.test(code(script)), 'no -v, no added capability, no host network');
  });

  it('mounts only this folder and scripts/deploy, both read-only, with --mount (a missing source is an error)', () => {
    const mounts = [...code(script).matchAll(/--mount "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(mounts, ['type=bind,src=${STACK_DIR},dst=/stack,readonly', 'type=bind,src=${REPO_ROOT}/scripts/deploy,dst=/preflight,readonly']);
    assert.match(code(script), /"\$\{IMAGE\}" node \/preflight\/preflight-vm\.mjs --stack \/stack --mode "\$\{MODE\}" \|\| status=\$\?$/m);
  });

  it('takes the image from the Dockerfile\'s api line (one source, as scripts/ci/stack.sh auth)', () => {
    // `2> /dev/null … || true`: a missing Dockerfile reaches the X1 branch instead of stopping set -e (review round 2, finding 3).
    assert.ok(script.includes(`IMAGE="$(sed -nE 's/^FROM ([^ ]+) AS api$/\\1/p' "\${STACK_DIR}/Dockerfile" 2> /dev/null | head -n 1 || true)"`));
    assert.match(code(script), /IMAGE="[^\n]*\n\s*if \[\[ -z "\$\{IMAGE\}" \]\]; then\n\s*say_code X1 /);
    assert.match(read(path.join(STACK, 'Dockerfile')), /^FROM node:22-slim AS api$/m);
  });

  it('selects the mode only through check-mode.sh, sourced from this folder, and never sources an env file', () => {
    assert.match(code(script), /^source "\$\{SCRIPT_DIR\}\/check-mode\.sh"$/m);
    assert.match(code(script), /^MODE="\$\(risepath_check_mode "\$\{FROM_DEPLOY\}" "\$\{CALLER_SKIP_PULL\}" "\$\{CALLER_PROJECT\}" "\$\{STACK_DIR\}"\)"$/m);
    assert.equal([...code(script).matchAll(/^\s*(?:source|\.)\s/gm)].length, 1, 'check-mode.sh is the only file it sources');
  });

  it('check-mode.sh needs all four conditions in one test', () => {
    const body = code(mode);
    for (const part of ['"${from_deploy}" == 1', '"${skip_pull}" == 1', '"${project}" == risepath-ci', 'cmp -s "${stack_dir}/stack.env" "${stack_dir}/ci/stack.ci.env"']) {
      assert.ok(body.includes(part), part);
    }
    assert.equal([...body.matchAll(/echo ci\b/g)].length, 1, 'one way to ci');
    assert.match(body, /else\n\s+echo prod\n/);
  });

  it('no script sources launch-record.env (only the engine reads it)', () => {
    const dirs = [path.join(STACK, 'scripts'), path.join(ROOT, 'scripts/ci')];
    for (const dir of dirs) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sh'))) {
        assert.ok(!/(?:^|[\s;&|])(?:source|\.)\s+\S*launch-record\.env/m.test(read(path.join(dir, file))), file);
      }
    }
  });

  it('launch-record.env and the deploy record stay out of git and the build context', () => {
    assert.ok(lines(read(path.join(STACK, '.gitignore'))).includes('launch-record.env'));
    assert.ok(lines(read(path.join(STACK, '.gitignore'))).includes('.deploy/'));
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/.deploy'));
    assert.ok(lines(read(path.join(ROOT, '.dockerignore'))).includes('deploy/risepath-vm/*.env'), 'covers launch-record.env');
  });
});

// Phase 9 (design §6.1, §6.3; Scope guard TR2, TR10): the 事後の確かめ. The checks that need the stack's
// network run in the api container (scripts/deploy/postdeploy-probe.mjs; postdeployProbe.test.js runs both
// against fakes); these are the static pins of the wrapper.
describe('postdeploy-check.sh: the wrapper pins (Phase 9)', () => {
  const script = read(path.join(STACK, 'scripts/postdeploy-check.sh'));
  const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

  it('runs under set -euo pipefail and parses with bash -n', () => {
    assert.match(script, /^set -euo pipefail$/m);
    assert.equal(spawnSync('bash', ['-n', path.join(STACK, 'scripts/postdeploy-check.sh')]).status, 0);
  });

  it('refuses uid 0 before any docker call (P0)', () => {
    const refusal = code.indexOf('if [[ "$(id -u)" -eq 0 ]]; then cannot_check; fi');
    assert.ok(refusal > 0);
    // A call: `docker …` or `compose …` as a command (line start, after a pipe or in $( … )), not the fix text's `docker compose`.
    const firstCall = code.search(/(?:^\s*|\| |\$\()(?:docker|compose) /m);
    assert.ok(firstCall > refusal, 'no docker call before the refusal');
    assert.ok(firstCall > code.indexOf('docker compose --env-file stack.env -f docker-compose.yml "$@"') - 4, 'the first call is the compose function');
  });

  it('selects the mode only through check-mode.sh and never sources an env file', () => {
    assert.match(code, /^source "\$\{SCRIPT_DIR\}\/check-mode\.sh"$/m);
    assert.match(code, /^MODE="\$\(risepath_check_mode "\$\{FROM_DEPLOY\}" "\$\{CALLER_SKIP_PULL\}" "\$\{CALLER_PROJECT\}" "\$\{STACK_DIR\}"\)"$/m);
    assert.equal([...code.matchAll(/^\s*(?:source|\.)\s/gm)].length, 1, 'check-mode.sh is the only file it sources');
    assert.ok(!code.includes('launch-record.env'), 'reads nothing of the launch record (TR2, TR6, TR10 removed its readers)');
  });

  it('prints no log line: the api log goes only to a count; the probe gets facts, never a value of stack.env', () => {
    assert.ok(code.includes("compose logs --no-log-prefix api 2> /dev/null | grep -cF '[Retention] on, hourly' || true"), 'a count only');
    assert.equal(code.match(/compose logs/g)?.length, 1);
    assert.match(code, /printf '%s' "\$\{FACTS\}" \| compose exec -T api node scripts\/deploy\/postdeploy-probe\.mjs --mode "\$\{MODE\}" \|\| status=\$\?$/m);
    assert.match(code, /FACTS="\$\(printf '\{"profiles":"%s","cloudflared":"%s","unitStack":"%s","retentionLines":%s\}'/);
    // stack.env is read for one line only (COMPOSE_PROFILES), and the profile names are filtered.
    for (const m of code.matchAll(/\bstack\.env\b/g)) {
      const line = code.slice(code.lastIndexOf('\n', m.index) + 1, code.indexOf('\n', m.index));
      // (P16's catalog text names the file; say_code prints fixed text only.)
      assert.match(line, /--env-file stack\.env|-f stack\.env|COMPOSE_PROFILES|PROFILES_LINE|sha256sum stack\.env|shasum -a 256 stack\.env|^\s*say_code '❌' P16 /, line);
    }
    // Review round 1 of Stage 2, finding 1: a value it cannot read is sent as `unreadable` (P15), never ''.
    assert.match(code, /if \[\[ ! "\$\{PROFILES\}" =~ \^\[a-z0-9_,\.-\]\{0,256\}\$ \]\]; then PROFILES=unreadable; fi/);
    assert.match(code, /if \[\[ "\$\{PROFILES\}" == =\* \]\]; then PROFILES="\$\{PROFILES#=\}"; else PROFILES=unreadable; fi/);
    assert.ok(!/PROFILES=''/.test(code.slice(code.indexOf('if [[ "${PROFILES_GIVEN}" -eq 0 ]]; then'))), 'no path drops the list to empty');
  });

  it('writes the deploy record only from the deploy, in production mode, after the probe passed; as the deploy user, 0644 in a 0755 folder', () => {
    const at = code.indexOf('if [[ "${MODE}" == prod && "${FROM_DEPLOY}" == 1 ]]; then');
    assert.ok(at > code.indexOf('case "${status}" in'), 'after the probe\'s result');
    assert.match(code.slice(code.indexOf('case "${status}" in'), at), /0\) ;;\n\s*10\) exit 1 ;;\n\s*11\) exit 2 ;;\n\s*\*\) cannot_check ;;/);
    const record = code.slice(at);
    assert.ok(record.includes('chmod 755 "${RECORD_DIR}"') && record.includes('chmod 644 "${RECORD_DIR}/last-green.json.tmp"'));
    assert.ok(record.includes('mv -f "${RECORD_DIR}/last-green.json.tmp" "${RECORD_DIR}/last-green.json"'), 'replaced whole, never half written');
    assert.match(record, /printf '\{"at":"%s","commit":"%s","stackEnvSha256":"%s"\}\\n'/, 'TR2: { at, commit, stackEnvSha256 }');
    assert.equal(code.match(/last-green\.json"/g)?.length, 1, 'written in one place');
  });

  it('the record holds the hash deploy-stack.sh took before the 事前チェック, or nothing (P16, then exit 1)', () => {
    const record = code.slice(code.indexOf('if [[ "${MODE}" == prod && "${FROM_DEPLOY}" == 1 ]]; then'));
    const guard = record.indexOf('if [[ -z "${STACK_SHA}" || "${STACK_SHA}" != "${GIVEN_STACK_SHA}" ]]; then');
    assert.ok(guard > 0 && guard < record.indexOf('mkdir -p "${RECORD_DIR}"'), 'compared before anything is written');
    assert.match(record.slice(guard), /^if[^\n]*\n\s*say_code '❌' P16 [^\n]*\n\s*exit 1\n/);
    assert.match(code, /^ {4}--stack-sha\) GIVEN_STACK_SHA="\$2" ;;$/m);
  });

  it('prints exactly the catalog\'s titles and fixes for P0, P13 and P16', () => {
    for (const [mark, codeName] of [['❌', 'P0'], ['ℹ️', 'P13'], ['❌', 'P16']]) {
      const c = /** @type {{ title: string, fix: string }} */ (POSTDEPLOY_CODES.find((x) => x.code === codeName));
      assert.ok(script.includes(`say_code '${mark}' ${codeName} '${c.title}' '${c.fix}'`), codeName);
    }
  });
});

// Phase 9 (design §6.4): deploy-from-mac.sh's rsync mode copies the Mac's tree over /opt/risepath with
// --delete. Every VM env file (stack.env, tunnel.env, mcp-public.env, billing.env, launch-record.env) and the
// deploy record (.deploy/) exist only on the VM, so the excludes must keep all of them.
describe('deploy-from-mac.sh: rsync keeps every VM env file and the deploy record (Phase 9)', () => {
  const script = read(path.join(ROOT, 'scripts/deploy-from-mac.sh'));
  const rsyncCall = script.slice(script.indexOf('rsync -az --delete'), script.indexOf('"${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_DIR}/"'));
  const excludes = [...rsyncCall.matchAll(/--exclude (?:'([^']+)'|(\S+))/g)].map((m) => m[1] ?? m[2]);
  const hasRsync = spawnSync('rsync', ['--version']).status === 0;

  it('excludes deploy/risepath-vm/*.env and deploy/risepath-vm/.deploy (not two env files by name)', () => {
    assert.ok(excludes.includes('deploy/risepath-vm/*.env'), excludes.join(' '));
    assert.ok(excludes.includes('deploy/risepath-vm/.deploy'));
    assert.ok(!excludes.includes('deploy/risepath-vm/stack.env') && !excludes.includes('deploy/risepath-vm/tunnel.env'), 'covered by *.env');
    assert.match(script, /echo "==> rsync local tree \(preserving the VM's env files, launch-record\.env and \.deploy\/\)"/);
    assert.equal(spawnSync('bash', ['-n', path.join(ROOT, 'scripts/deploy-from-mac.sh')]).status, 0);
  });

  it('a real rsync with those excludes keeps the VM\'s five files and .deploy/, and still updates and deletes the rest', { skip: hasRsync ? false : 'rsync is not installed' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsync-excludes-'));
    try {
      const src = path.join(dir, 'mac');
      const dst = path.join(dir, 'vm');
      const VM_ONLY = ['stack.env', 'tunnel.env', 'mcp-public.env', 'billing.env', 'launch-record.env', '.deploy/last-green.json'];
      fs.mkdirSync(path.join(src, 'deploy/risepath-vm'), { recursive: true });
      fs.mkdirSync(path.join(dst, 'deploy/risepath-vm/.deploy'), { recursive: true });
      // Contents of other lengths than the VM's (rsync's quick check compares size and time).
      fs.writeFileSync(path.join(src, 'deploy/risepath-vm/stack.env.example'), 'new from the Mac\n');
      fs.writeFileSync(path.join(src, 'deploy/risepath-vm/launch-record.env.example'), 'new from the Mac\n');
      for (const f of VM_ONLY) fs.writeFileSync(path.join(dst, 'deploy/risepath-vm', f), 'vm\n');
      fs.writeFileSync(path.join(dst, 'deploy/risepath-vm/stack.env.example'), 'old\n');
      fs.writeFileSync(path.join(dst, 'deploy/risepath-vm/obsolete.sh'), 'old\n');
      const r = spawnSync('rsync', ['-a', '--delete', ...excludes.flatMap((e) => ['--exclude', e]), `${src}/`, `${dst}/`], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      for (const f of VM_ONLY) assert.equal(read(path.join(dst, 'deploy/risepath-vm', f)), 'vm\n', `${f} kept`);
      assert.equal(read(path.join(dst, 'deploy/risepath-vm/stack.env.example')), 'new from the Mac\n', '*.env.example is synced (not matched by *.env)');
      assert.equal(read(path.join(dst, 'deploy/risepath-vm/launch-record.env.example')), 'new from the Mac\n');
      assert.ok(!fs.existsSync(path.join(dst, 'deploy/risepath-vm/obsolete.sh')), '--delete still removes what the Mac no longer has');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
