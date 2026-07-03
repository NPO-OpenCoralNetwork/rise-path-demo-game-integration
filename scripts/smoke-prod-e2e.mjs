#!/usr/bin/env node
/**
 * Production E2E smoke (VITE_DEMO_MODE=false).
 * Covers prod_readiness_plan.md Step 4:
 *   register → login → profile → learning hub → generation-kit → curriculum save
 *   → progress → notifications → re-login restoration
 *
 * Usage:
 *   node scripts/smoke-prod-e2e.mjs
 *   node scripts/smoke-prod-e2e.mjs --ui          # include Playwright login
 *   node scripts/smoke-prod-e2e.mjs --keep-user   # skip test user cleanup
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

const API = process.env.E2E_API_URL || 'http://localhost:3006';
const WEB = process.env.E2E_BASE_URL || 'http://localhost:3007';

const args = new Set(process.argv.slice(2));
const includeUi = args.has('--ui');
const keepUser = args.has('--keep-user');

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

async function apiFetch(url, { token, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { res, json };
}

function richCurriculumDraft() {
  const explanation = 'このレッスンでは、学習目標を明確にし、実践的なステップで理解を深めます。'.repeat(8);
  return {
    title: 'E2E Test Curriculum',
    summary: 'Automated production E2E validation curriculum.',
    modules: [
      {
        title: 'Module 1',
        goal: '基礎理解',
        lessons: [
          {
            title: 'Lesson 1',
            objective: '核心概念を理解する',
            explanation,
            key_points: ['概念A', '概念B', '概念C'],
            examples: ['具体例1'],
            practice: ['演習1', '演習2'],
            checklist: ['確認1'],
            cautions: ['注意1'],
            reflection: ['振り返り1'],
            takeaway: '要点を自分の言葉で説明できる',
          },
        ],
      },
    ],
  };
}

async function runPlaywrightLogin({ email, password }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const landingCta = page.getByRole('button', {
      name: /Enter System|Initialize Profile|システムに入る|プロファイルを初期化/i,
    }).first();
    await landingCta.click({ timeout: 15000 });

    const emailInput = page.locator('input[type="email"]');
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(email);
    await page.locator('input[type="password"]').fill(password);

    await page.getByRole('button', { name: /Verify Identity|アイデンティティを確認/i }).click();

    await page.waitForTimeout(4000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const loggedIn = !/System Authentication|システム認証/.test(body)
      && (body.includes('Dashboard') || body.includes('Learning') || body.includes('Mission') || body.includes('ダッシュボード') || body.includes('学習'));
    record('UI login → dashboard', loggedIn, loggedIn ? 'dashboard visible' : body.slice(0, 120));
    return loggedIn;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log('# Rise Path production E2E (VITE_DEMO_MODE=false)\n');

  let env;
  try {
    env = await loadEnvLocal();
  } catch {
    console.error('❌ .env.local not found');
    process.exit(1);
  }

  if (env.VITE_DEMO_MODE !== 'false') {
    record('VITE_DEMO_MODE=false', false, `current=${env.VITE_DEMO_MODE ?? '(unset)'}`);
    process.exit(1);
  }
  record('VITE_DEMO_MODE=false', true);

  const health = await apiFetch(`${API}/api/v2/health`);
  let strictAuth = health.json?.auth_policy?.strict_auth_mode === true;
  const healthOk = health.res.status === 200 && health.json?.ok;
  if (healthOk) {
    record(
      'GET /api/v2/health',
      Boolean(health.json?.ready_for_prod_data),
      `strict_auth=${strictAuth}`,
    );
  } else {
    console.log(`⚠️  GET /api/v2/health → ${health.res.status} (redeploy API for Phase 15-1 probe)`);
  }

  const unauth = await apiFetch(`${API}/api/v2/curricula`);
  if (!strictAuth && unauth.res.status === 401) {
    strictAuth = true;
    record('strict auth inferred', true, 'curricula → 401 without JWT');
  }
  record('GET /api/v2/curricula without JWT → 401', unauth.res.status === 401);

  if (!strictAuth) {
    console.error('\n❌ strict_auth_mode is false — set VITE_DEMO_MODE=false and redeploy API');
    process.exit(1);
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
  const email = `e2e+${stamp}@risepath.test`;
  const password = `E2e!${stamp}Aa`;

  // 1. Registration (admin create — mirrors confirmed email signup)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'smoke-prod-e2e' },
  });
  record('1. メール登録 (Supabase createUser)', !createErr && created?.user?.id, createErr?.message || email);
  if (createErr || !created?.user?.id) process.exit(1);

  const userId = created.user.id;
  let token = null;

  try {
    // 2. Login
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    token = session?.session?.access_token ?? null;
    record('2. ログイン (signInWithPassword)', !signInErr && Boolean(token), signInErr?.message || `user=${userId.slice(0, 8)}…`);
    if (!token) process.exit(1);

    // 3. Profile GET + PUT
    const profileGet = await apiFetch(`${API}/api/v2/user/profile`, { token });
    record(
      '3a. プロフィール取得',
      profileGet.res.status === 200 && profileGet.json?.ok,
      `display_name=${profileGet.json?.profile?.display_name ?? '?'}`,
    );

    const displayName = `E2E Learner ${stamp}`;
    const profilePut = await apiFetch(`${API}/api/v2/user/profile`, {
      token,
      method: 'PUT',
      body: { display_name: displayName, avatar_url: 'https://example.com/e2e-avatar.png' },
    });
    const profileVerify = await apiFetch(`${API}/api/v2/user/profile`, { token });
    const savedName = profileVerify.json?.profile?.display_name;
    record(
      '3b. プロフィール更新',
      profilePut.res.status === 200 && savedName === displayName,
      `put=${profilePut.res.status} saved=${savedName ?? '?'}`,
    );

    // 4. Learning Hub
    const portals = await apiFetch(`${API}/api/learning-portals`, { token });
    const portalCount = portals.json?.portals?.length ?? 0;
    record(
      '4. Learning Hub (learning-portals)',
      portals.res.status === 200 && portals.json?.ok && portalCount > 0,
      `portals=${portalCount}`,
    );

    // 5. AI Course Generator (generation-kit — no LLM required)
    const kitRes = await apiFetch(`${API}/api/v2/ai/generation-kit`, {
      token,
      method: 'POST',
      body: { portal_id: 'general', template_id: 'default', locale: 'ja' },
    });
    record(
      '5. AI Course Generator (generation-kit)',
      kitRes.res.status === 200 && kitRes.json?.policy_version,
      `policy=${kitRes.json?.policy_version ?? kitRes.json?.error ?? kitRes.res.status}`,
    );

    // 6. Curriculum save
    const draftBody = {
      portal_id: 'general',
      template_id: 'default',
      policy_version: '2026-03-10.a',
      locale: 'ja',
      intake: {
        target_audience: '初学者',
        goal: 'E2Eテスト用の学習目標',
        current_level: '初学者',
        duration_weeks: 4,
      },
      curriculum: richCurriculumDraft(),
      generation_meta: { provider: 'e2e', model: 'smoke-prod-e2e', source_connector: 'local_e2e' },
    };
    const draftRes = await apiFetch(`${API}/api/v2/ai/curriculum-drafts`, {
      token,
      method: 'POST',
      body: draftBody,
    });
    const curriculumId = draftRes.json?.curriculum_id ?? draftRes.json?.id;
    record(
      '6. カリキュラム保存',
      draftRes.res.status === 200 && Boolean(curriculumId),
      curriculumId ? `id=${curriculumId}` : JSON.stringify(draftRes.json || {}).slice(0, 200),
    );

    const curriculaList = await apiFetch(`${API}/api/v2/curricula`, { token });
    const found = (curriculaList.json?.curricula ?? []).some((c) => c.id === curriculumId);
    record(
      '6b. カリキュラム一覧に反映',
      curriculaList.res.status === 200 && found,
      `count=${curriculaList.json?.curricula?.length ?? 0}`,
    );

    // 7. Progress save
    const courseId = `e2e-course-${stamp}`;
    const progressPut = await apiFetch(`${API}/api/v2/user/progress/${encodeURIComponent(courseId)}`, {
      token,
      method: 'PUT',
      body: {
        completedStages: ['stage-1'],
        completedSteps: { 'lesson-1': true, 'lesson-2': false },
      },
    });
    record('7. 学習進捗保存', progressPut.res.status === 200 && progressPut.json?.ok);

    const eventPost = await apiFetch(`${API}/api/v2/user/events`, {
      token,
      method: 'POST',
      body: {
        type: 'lesson_complete',
        title: { en: 'E2E lesson', ja: 'E2Eレッスン' },
        description: { courseId },
      },
    });
    record('7b. 学習イベント保存', eventPost.res.status === 200 && eventPost.json?.ok);

    // 8. Notifications
    const notifPost = await apiFetch(`${API}/api/v2/user/notifications`, {
      token,
      method: 'POST',
      body: {
        type: 'system',
        title: { en: 'E2E notice', ja: 'E2E通知' },
        body: { en: 'Production E2E test', ja: '本番E2Eテスト' },
      },
    });
    const notifId = notifPost.json?.notification?.id;
    record('8a. 通知作成', notifPost.res.status === 200 && Boolean(notifId));

    const notifRead = await apiFetch(`${API}/api/v2/user/notifications/${notifId}/read`, {
      token,
      method: 'PUT',
    });
    record('8b. 通知既読', notifRead.res.status === 200 && notifRead.json?.ok);

    // Snapshot for re-login verification
    const snapshot = {
      displayName,
      curriculumId,
      courseId,
      notifId,
      portalCount,
    };

    // 9. Logout + re-login restoration
    await anon.auth.signOut();
    record('9a. ログアウト', true);

    const { data: session2, error: signIn2Err } = await anon.auth.signInWithPassword({ email, password });
    const token2 = session2?.session?.access_token ?? null;
    record('9b. 再ログイン', !signIn2Err && Boolean(token2), signIn2Err?.message || '');

    const profile2 = await apiFetch(`${API}/api/v2/user/profile`, { token: token2 });
    record(
      '9c. プロフィール復元',
      profile2.json?.profile?.display_name === snapshot.displayName,
      profile2.json?.profile?.display_name,
    );

    const progress2 = await apiFetch(`${API}/api/v2/user/progress`, { token: token2 });
    const restoredProgress = progress2.json?.progress?.[snapshot.courseId];
    record(
      '9d. 進捗復元',
      Array.isArray(restoredProgress?.completedStages)
        && restoredProgress.completedStages.includes('stage-1'),
      JSON.stringify(restoredProgress || {}).slice(0, 120),
    );

    const curricula2 = await apiFetch(`${API}/api/v2/curricula`, { token: token2 });
    const curriculumRestored = (curricula2.json?.curricula ?? []).some((c) => c.id === snapshot.curriculumId);
    record('9e. カリキュラム復元', curriculumRestored, snapshot.curriculumId);

    const notifs2 = await apiFetch(`${API}/api/v2/user/notifications`, { token: token2 });
    const notifRestored = (notifs2.json?.notifications ?? []).find((n) => n.id === snapshot.notifId);
    record(
      '9f. 通知復元（既読）',
      Boolean(notifRestored) && notifRestored.read === true,
      `read=${notifRestored?.read}`,
    );

    const portals2 = await apiFetch(`${API}/api/learning-portals`, { token: token2 });
    record(
      '9g. Learning Hub 復元',
      (portals2.json?.portals?.length ?? 0) === snapshot.portalCount,
      `portals=${portals2.json?.portals?.length ?? 0}`,
    );

    if (includeUi) {
      await runPlaywrightLogin({ email, password });
    }
  } finally {
    if (!keepUser) {
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      record('cleanup test user', !delErr, delErr?.message || userId.slice(0, 8));
    } else {
      console.log(`\nℹ️  --keep-user: ${email}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n❌ Production E2E failed (${failed.length}/${results.length})` : `\n✅ Production E2E passed (${results.length} checks)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ E2E fatal:', err);
  process.exit(1);
});