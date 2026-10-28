// The fixtures every learner flow runs with (Phase 7; e2e/learner.spec.ts imports test and expect from
// here only, so the guards below run for every test; server/tests/e2eSuite.test.js pins that).
// - db: the CI stack's database (e2e/support/env.ts), for assertions and the one SQL time nudge.
// - context: the Japanese UI (the stored-language default is en: context/LanguageContext.tsx).
// - learner: a fresh e2e-…@example.org per test; the stand-in accepts it with the dummy password.
// - guards (auto): fails a test that saw a 429 (server.js: 200 /api requests a minute per IP), a 5xx
//   on a learner route, or an auth call the stand-in does not model; attaches the request log with the
//   peak per-minute count and the lowest RateLimit-Remaining per RateLimit-Limit (a route's own
//   limiter, e.g. 5 deletions a minute, answers with its headers instead of the global 200's).
import { test as base, expect } from 'playwright/test';
import pg from 'pg';
import { E2E } from './support/env.ts';
import { STANDIN_PASSWORD, userIdFor } from './support/auth-stand-in.mjs';

export type Learner = { id: string; email: string; password: string };
export type Db = { q: (sql: string, params?: unknown[]) => Promise<any[]>; pool: any; todayJst: () => Promise<string> };

export const test = base.extend<{ learner: Learner; guards: void }, { db: Db }>({
  db: [async ({}, use) => {
    const pool = new pg.Pool({ connectionString: E2E.databaseUrl, max: 2 });
    await use({
      pool,
      q: async (sql, params = []) => (await pool.query(sql, params)).rows,
      todayJst: async () => (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS d")).rows[0].d,
    });
    await pool.end();
  }, { scope: 'worker' }],

  // The stored-language default is en (context/LanguageContext.tsx; progressSyncClient.ts): the suite reads JP copy.
  context: async ({ context }, use) => {
    await context.addInitScript(() => { try { if (!localStorage.getItem('risepath:language')) localStorage.setItem('risepath:language', 'jp'); } catch {} });
    await use(context);
  },

  // A fresh learner per test: the stand-in accepts any e2e-…@example.org with the dummy password.
  learner: async ({}, use, testInfo) => {
    const email = `e2e-t${testInfo.testId.slice(0, 8).toLowerCase()}-${Date.now().toString(36)}@example.org`;
    await use({ id: userIdFor(email), email, password: STANDIN_PASSWORD });
  },

  guards: [async ({ context }, use, testInfo) => {
    const api: { at: number; method: string; path: string; status: number; limit: number | null; remaining: number | null }[] = [];
    const auth: { method: string; path: string; status: number }[] = [];
    context.on('response', (r) => {
      const u = new URL(r.url());
      if (u.origin === E2E.authUrl) auth.push({ method: r.request().method(), path: u.pathname, status: r.status() });
      if (!u.pathname.startsWith('/api/')) return;
      const header = (name: string) => (r.headers()[name] === undefined ? null : Number(r.headers()[name]));
      api.push({ at: Date.now(), method: r.request().method(), path: u.pathname, status: r.status(), limit: header('ratelimit-limit'), remaining: header('ratelimit-remaining') });
    });
    await use();
    const peakPerMinute = Math.max(0, ...api.map((s) => api.filter((x) => x.at > s.at - 60_000 && x.at <= s.at).length));
    const lowestRemaining: Record<string, number> = {};
    for (const s of api) if (s.limit !== null && s.remaining !== null) lowestRemaining[s.limit] = Math.min(lowestRemaining[s.limit] ?? s.remaining, s.remaining);
    await testInfo.attach('api-requests.json', { contentType: 'application/json', body: JSON.stringify({ peakPerMinute, lowestRemaining, api, auth }, null, 2) });
    expect(api.filter((s) => s.status === 429), 'rate limited (server.js: 200 /api requests a minute per IP): split or slow the flows').toEqual([]);
    expect(api.filter((s) => s.status >= 500 && s.path.startsWith('/api/v2/user/')), 'a 5xx on a learner route').toEqual([]);
    expect(auth.filter((s) => s.status === 404), 'the app called an auth endpoint the stand-in does not model: extend e2e/support/auth-stand-in.mjs').toEqual([]);
  }, { auto: true }],
});
export { expect };
export type { Page, Response } from 'playwright/test';
